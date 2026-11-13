"""Subscriptions and the free trial: the entitlement service (Trial Management and
Synthetic Demo Experience, Step 2; the product owner's decisions of 28 October 2026).

One row per firm (organization_subscriptions, migration 0127) says whether the firm is on
a trial, paid, or internal, and what a trial may have. Everything here reads that row:

- `load` and `state`: the subscription as it stands now, the trial's end judged by the
  server's clock, so signing in never restarts it and a browser cannot extend it;
- `start_trial`: the trial a firm gets when it signs itself up, with the deployment's
  length and limits, written in the sign-up's own transaction;
- `require_capacity`: a service's own check before it writes a counted resource, for a
  plain answer before the database's trigger would refuse the row anyway;
- the AI allowance: `reserve_call` and `settle_call` keep the ledger the agent caller
  consults before every model call a trial firm makes;
- `GET /organizations/{id}/subscription`, and the gate that answers every change under an
  inactive subscription with 402.

Nothing here decides anything about the audit: a trial's sign-offs, approvals and reviews
follow the same rules as everyone's, and an expired trial keeps every record, read-only.
"""

import logging
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool
from psycopg.conninfo import make_conninfo
from pydantic import BaseModel
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import JSONResponse

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import connect, require_one_row, transaction
from ai_workforce_api.entitlement_errors import (
    SubscriptionInactive,
    TrialLimitReached,
    inactive_detail,
)
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

WRITABLE = frozenset({"TRIAL", "ACTIVE", "PAST_DUE"})
# A job that made no call for this long is no longer running, for the concurrency count.
JOB_QUIET_SECONDS = 90
# A reservation never settled (a worker that died between reserving and settling) is
# abandoned once its run could no longer be running under the trial's own run limit;
# this is the fallback when a firm has no run limit (Step 6).
ABANDONED_AFTER_SECONDS = 3600
_WRITES = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_FIRM_PATH = re.compile(r"^/organizations/([0-9a-fA-F-]{36})(/[^?]*)?$")
# What stays open under an inactive subscription (the owner's policy of 29 October 2026):
# the subscription's own actions, so a firm can get back to work. Signing out and the
# account's own settings are not under /organizations and are never gated.
_OPEN_PATHS = re.compile(r"^/subscription(/|$)")


@dataclass(frozen=True)
class Limits:
    """A trial's allowances; None is no limit."""

    engagements: int | None
    systems: int | None
    controls: int | None
    members: int | None
    uploads: int | None
    upload_bytes: int | None
    ai_budget_micros: int | None
    ai_run_limit: int | None
    ai_concurrent_runs: int | None
    ai_run_seconds: int | None


@dataclass(frozen=True)
class Subscription:
    organization_id: UUID
    # As stored, and as it stands now: a trial past its end reads TRIAL_EXPIRED.
    status: str
    state: str
    plan_type: str
    trial_started_at: datetime | None
    trial_expires_at: datetime | None
    limits: Limits
    status_reason: str

    @property
    def trial(self) -> bool:
        return self.plan_type == "TRIAL"

    @property
    def writable(self) -> bool:
        return self.state in WRITABLE

    def days_left(self, now: datetime | None = None) -> int | None:
        """Whole days until the trial ends, counting a started day; 0 once it has ended."""
        if not self.trial or self.trial_expires_at is None:
            return None
        moment = now if now is not None else datetime.now(UTC)
        left = (self.trial_expires_at - moment) / timedelta(days=1)
        return max(0, math.ceil(left))


@dataclass(frozen=True)
class Usage:
    engagements: int
    systems: int
    controls: int
    members: int
    uploads: int
    upload_bytes: int
    ai_spent_micros: int
    ai_reserved_micros: int
    ai_runs: int
    ai_active_runs: int


_COLUMNS = """
    organization_id, status::text, subscription_state(organization_id), plan_type,
    trial_started_at, trial_expires_at, limit_engagements, limit_systems, limit_controls,
    limit_members, limit_uploads, limit_upload_bytes, ai_budget_micros, ai_run_limit,
    ai_concurrent_runs, ai_run_seconds, status_reason
"""


def load(connection: Any, organization_id: UUID, *, lock: bool = False) -> Subscription | None:
    row = connection.execute(
        f"SELECT {_COLUMNS} FROM organization_subscriptions WHERE organization_id = %s"
        + (" FOR UPDATE" if lock else ""),
        (organization_id,),
    ).fetchone()
    return None if row is None else _from_row(row)


def _from_row(row: tuple[Any, ...]) -> Subscription:
    return Subscription(
        organization_id=UUID(str(row[0])),
        status=str(row[1]),
        state=str(row[2]),
        plan_type=str(row[3]),
        trial_started_at=row[4],
        trial_expires_at=row[5],
        limits=Limits(*(None if value is None else int(value) for value in row[6:16])),
        status_reason=str(row[16] or ""),
    )


def state(connection: Any, organization_id: UUID) -> str | None:
    """The subscription's state now, or None for a firm without one."""
    row = connection.execute("SELECT subscription_state(%s)", (organization_id,)).fetchone()
    return None if row is None or row[0] is None else str(row[0])


def start_trial(
    cursor: psycopg.Cursor[Any], organization_id: UUID, user_id: UUID, settings: Settings
) -> None:
    """The trial a firm gets when it signs itself up: the deployment's length and limits,
    on the row the database made when the firm was created, in the same transaction."""
    cursor.execute(
        """
        UPDATE organization_subscriptions
        SET trial_expires_at = trial_started_at + make_interval(days => %s),
            limit_engagements = %s, limit_systems = %s, limit_controls = %s,
            limit_members = %s, limit_uploads = %s, limit_upload_bytes = %s,
            ai_budget_micros = %s, ai_run_limit = %s, ai_concurrent_runs = %s,
            ai_run_seconds = %s, status_reason = 'sign-up', updated_by = %s,
            version = version + 1
        WHERE organization_id = %s AND status = 'TRIAL' AND plan_type = 'TRIAL'
        """,
        (
            settings.trial_days,
            settings.trial_limit_engagements,
            settings.trial_limit_systems,
            settings.trial_limit_controls,
            settings.trial_limit_members,
            settings.trial_limit_uploads,
            settings.trial_limit_upload_bytes,
            settings.trial_ai_budget_micros,
            settings.trial_ai_run_limit,
            settings.trial_ai_concurrent_runs,
            settings.trial_ai_run_seconds,
            user_id,
            organization_id,
        ),
    )
    require_one_row(cursor)


def make_internal(cursor: psycopg.Cursor[Any], organization_id: UUID, reason: str) -> None:
    """The platform's own firm (the preview workspace): active, no limits."""
    cursor.execute(
        """
        UPDATE organization_subscriptions
        SET status = 'ACTIVE', plan_type = 'INTERNAL',
            limit_engagements = NULL, limit_systems = NULL, limit_controls = NULL,
            limit_members = NULL, limit_uploads = NULL, limit_upload_bytes = NULL,
            ai_budget_micros = NULL, ai_run_limit = NULL, ai_concurrent_runs = NULL,
            ai_run_seconds = NULL, status_reason = %s, version = version + 1
        WHERE organization_id = %s AND plan_type <> 'INTERNAL'
        """,
        (reason, organization_id),
    )


def require_capacity(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    resource: str,
    project_id: UUID | None = None,
) -> None:
    """A service's own check before it writes one more of a counted resource, in the
    write's transaction and under the lock the database's trigger takes, so the answer is
    the same one the trigger would give. Nothing for a firm that is not on a trial."""
    sub = load(cursor, organization_id)
    if sub is None:
        raise TrialLimitReached("subscription", 0, 0)
    if not sub.trial:
        return
    sub = load(cursor, organization_id, lock=True) or sub
    allowed = getattr(sub.limits, resource)
    if allowed is None:
        return
    used = _used(cursor, organization_id, resource, project_id)
    if used >= allowed:
        raise TrialLimitReached(resource, used, allowed)


def _used(cursor: Any, organization_id: UUID, resource: str, project_id: UUID | None) -> int:
    if resource == "engagements":
        sql = (
            "SELECT count(*) FROM projects "
            "WHERE organization_id = %s AND deleted_at IS NULL AND NOT demo"
        )
        params: tuple[Any, ...] = (organization_id,)
    elif resource == "systems":
        sql = """
            SELECT count(*) FROM engagement_applications a
            JOIN projects p ON p.id = a.project_id
            WHERE a.organization_id = %s AND p.deleted_at IS NULL AND NOT p.demo
        """
        params = (organization_id,)
    elif resource == "controls":
        sql = "SELECT count(DISTINCT control_ref) FROM engagement_controls WHERE project_id = %s"
        params = (project_id,)
    elif resource == "members":
        sql = """
            SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = %s AND m.status = 'ACTIVE'
              AND u.demo_organization_id IS NULL
        """
        params = (organization_id,)
    elif resource == "uploads":
        sql = """
            SELECT count(*) FROM evidence_files f JOIN projects p ON p.id = f.project_id
            WHERE f.organization_id = %s AND NOT p.demo
        """
        params = (organization_id,)
    else:
        raise ValueError(f"unknown resource {resource}")
    row = cursor.execute(sql, params).fetchone()
    return int(row[0]) if row is not None else 0


def usage(connection: Any, organization_id: UUID, quiet_seconds: int | None = None) -> Usage:
    """What the firm has today, for the subscription page and the web's indicators. The
    firm's demo engagement (migration 0128) is outside the allowances and left out. A run
    counts as in progress while a call is in flight or for `quiet_seconds` after its last
    call settled (the deployment's trial_ai_quiet_seconds)."""
    row = connection.execute(
        """
        SELECT
            (SELECT count(*) FROM projects
             WHERE organization_id = %(o)s AND deleted_at IS NULL AND NOT demo),
            (SELECT count(*) FROM engagement_applications a JOIN projects p ON p.id = a.project_id
             WHERE a.organization_id = %(o)s AND p.deleted_at IS NULL AND NOT p.demo),
            (SELECT coalesce(max(n), 0) FROM (
                SELECT count(DISTINCT c.control_ref) AS n FROM engagement_controls c
                JOIN projects p ON p.id = c.project_id
                WHERE c.organization_id = %(o)s AND p.deleted_at IS NULL AND NOT p.demo
                GROUP BY c.project_id
            ) families),
            (SELECT count(*) FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = %(o)s AND m.status = 'ACTIVE'
               AND u.demo_organization_id IS NULL),
            (SELECT count(*) FROM evidence_files f JOIN projects p ON p.id = f.project_id
             WHERE f.organization_id = %(o)s AND NOT p.demo),
            -- Every stored document, not only evidence files (migration 0133).
            trial_stored_bytes(%(o)s),
            (SELECT coalesce(sum(settled_micros), 0) FROM model_call_reservations
             WHERE organization_id = %(o)s AND released_at IS NOT NULL),
            (SELECT coalesce(sum(estimate_micros), 0) FROM model_call_reservations
             WHERE organization_id = %(o)s AND released_at IS NULL),
            (SELECT count(DISTINCT job_id) FROM model_call_reservations
             WHERE organization_id = %(o)s),
            -- Running: unsettled and young enough to still be running, or settled within
            -- the quiet window. An abandoned reservation is released at the next call.
            (SELECT count(DISTINCT job_id) FROM model_call_reservations
             WHERE organization_id = %(o)s AND (
                 (released_at IS NULL AND created_at > clock_timestamp() - make_interval(
                     secs => coalesce((SELECT ai_run_seconds FROM organization_subscriptions
                                       WHERE organization_id = %(o)s), %(stale)s)))
                 OR released_at > clock_timestamp() - make_interval(secs => %(quiet)s)
             ))
        """,
        {
            "o": organization_id,
            "quiet": quiet_seconds or JOB_QUIET_SECONDS,
            "stale": ABANDONED_AFTER_SECONDS,
        },
    ).fetchone()
    assert row is not None
    return Usage(*(int(value) for value in row))


# The AI allowance ledger


def reserve_call(
    caller: Any,
    organization_id: UUID,
    project_id: UUID | None,
    job_id: UUID,
    agent_key: str,
    estimate_micros: int,
    quiet_seconds: int | None = None,
) -> tuple[UUID | None, str]:
    """Reserve the worst case of one model call against the firm's allowance, on its own
    connection so the reservation is visible to every other caller at once. Returns the
    reservation's id and no reason when the call may go ahead; no id and no reason for a
    firm that is not on a trial (its project budgets still apply); no id and the reason
    when the call is refused. The decision is taken under a lock on the subscription row,
    so two calls arriving together cannot both pass."""
    if not isinstance(caller, psycopg.Connection):
        return None, ""
    # The caller's own database, on a connection of its own: the decision commits at once
    # and is visible to every other caller, whatever the caller's transaction is doing.
    dsn = make_conninfo(caller.info.dsn, password=caller.info.password)
    with connect(dsn) as connection, transaction(connection) as cursor:
        sub = load(cursor, organization_id)
        if sub is None:
            return None, "the firm has no subscription"
        if not sub.writable:
            return None, inactive_detail(sub.state)["detail"]
        if not sub.trial:
            return None, ""
        # Never wait long for the row: a request that holds it while it calls the model
        # would otherwise wait on itself. A busy allowance refuses the call instead.
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        try:
            with connection.transaction():
                sub = load(cursor, organization_id, lock=True) or sub
        except psycopg.errors.LockNotAvailable:
            return None, "the firm's AI allowance is in use; try again in a moment"
        limits = sub.limits
        # A worker that died between reserving and settling left a reservation open; once
        # its run could no longer be running, it is settled at its estimate (never less,
        # so the allowance is never given back) and stops counting as a run in progress.
        release_abandoned(cursor, organization_id, limits.ai_run_seconds or ABANDONED_AFTER_SECONDS)
        job = cursor.execute(
            """
            SELECT min(created_at), count(*) FROM model_call_reservations
            WHERE organization_id = %s AND job_id = %s
            """,
            (organization_id, job_id),
        ).fetchone()
        assert job is not None
        started, calls = job[0], int(job[1])
        if calls and limits.ai_run_seconds is not None and started is not None:
            age = (datetime.now(UTC) - started).total_seconds()
            if age > limits.ai_run_seconds:
                return None, (
                    f"the run has passed the trial's {limits.ai_run_seconds // 60} minutes"
                )
        totals = cursor.execute(
            """
            SELECT coalesce(sum(coalesce(settled_micros, estimate_micros)), 0),
                   count(DISTINCT job_id),
                   count(DISTINCT job_id) FILTER (
                       WHERE job_id <> %(job)s AND (
                           released_at IS NULL
                           OR released_at > clock_timestamp() - make_interval(secs => %(quiet)s)
                       )
                   )
            FROM model_call_reservations WHERE organization_id = %(o)s
            """,
            {"o": organization_id, "job": job_id, "quiet": quiet_seconds or JOB_QUIET_SECONDS},
        ).fetchone()
        assert totals is not None
        spent, runs, active = int(totals[0]), int(totals[1]), int(totals[2])
        if not calls:
            if limits.ai_run_limit is not None and runs >= limits.ai_run_limit:
                return None, f"the trial's {limits.ai_run_limit} agent runs are used"
            if limits.ai_concurrent_runs is not None and active >= limits.ai_concurrent_runs:
                return None, "another agent run is in progress; the trial runs one at a time"
        if (
            limits.ai_budget_micros is not None
            and spent + estimate_micros > limits.ai_budget_micros
        ):
            return None, (
                f"the trial's AI allowance of ${limits.ai_budget_micros / 1e6:.2f} is used"
                f" (${spent / 1e6:.2f} spent or reserved)"
            )
        row = cursor.execute(
            """
            INSERT INTO model_call_reservations (
                organization_id, project_id, job_id, agent_key, estimate_micros
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (organization_id, project_id, job_id, agent_key[:120], estimate_micros),
        ).fetchone()
        assert row is not None
        return UUID(str(row[0])), ""


def allowance_refusal(caller: Any, organization_id: UUID, estimate_micros: int) -> str:
    """Why the firm's allowance cannot cover a cost, before anything is reserved; empty
    when it can, or when the firm is not on a trial (its project budgets still apply).
    A read only: nothing is reserved or locked, so a job that needs several calls can ask
    whether all of them fit before it makes the first (evidence_assurance: a run that
    cannot pay for both readings starts neither). Each call is still reserved on its own
    when it is made (reserve_call)."""
    if not isinstance(caller, psycopg.Connection):
        return ""
    sub = load(caller, organization_id)
    if sub is None:
        return "the firm has no subscription"
    if not sub.writable:
        return str(inactive_detail(sub.state)["detail"])
    if not sub.trial or sub.limits.ai_budget_micros is None:
        return ""
    row = caller.execute(
        "SELECT coalesce(sum(coalesce(settled_micros, estimate_micros)), 0) "
        "FROM model_call_reservations WHERE organization_id = %s",
        (organization_id,),
    ).fetchone()
    spent = 0 if row is None else int(row[0])
    if spent + estimate_micros > sub.limits.ai_budget_micros:
        return (
            f"the trial's AI allowance of ${sub.limits.ai_budget_micros / 1e6:.2f} cannot "
            f"cover it (${spent / 1e6:.2f} spent or reserved)"
        )
    return ""


def release_abandoned(cursor: Any, organization_id: UUID, after_seconds: int) -> int:
    """Settle the firm's reservations left open longer than a run may last, at their
    estimate: the worst case stays charged, and the run stops counting as in progress.
    The release is dated when the run could last no longer, so it never reads as a run
    that just finished. Returns how many were released."""
    cursor.execute(
        """
        UPDATE model_call_reservations
        SET released_at = created_at + make_interval(secs => %s),
            settled_micros = estimate_micros
        WHERE organization_id = %s AND released_at IS NULL
          AND created_at < clock_timestamp() - make_interval(secs => %s)
        """,
        (after_seconds, organization_id, after_seconds),
    )
    released = int(cursor.rowcount or 0)
    if released:
        logger.warning(
            "released %d abandoned model call reservation(s) for firm %s at their estimate",
            released,
            organization_id,
        )
    return released


def release_abandoned_everywhere(connection: Any) -> int:
    """Housekeeping (migrate.py): every firm's abandoned reservations, by its own run
    limit, settled at their estimate."""
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE model_call_reservations r
            SET released_at = r.created_at + make_interval(secs => coalesce(s.ai_run_seconds, %s)),
                settled_micros = r.estimate_micros
            FROM organization_subscriptions s
            WHERE s.organization_id = r.organization_id AND r.released_at IS NULL
              AND r.created_at < clock_timestamp()
                  - make_interval(secs => coalesce(s.ai_run_seconds, %s))
            """,
            (ABANDONED_AFTER_SECONDS, ABANDONED_AFTER_SECONDS),
        )
        return int(cursor.rowcount or 0)


def settle_call(
    connection: Any, reservation_id: UUID | None, model_call_id: UUID | None, cost_micros: int
) -> None:
    """Settle a reservation to what the call cost, on the caller's own connection so the
    recorded call it names is visible. A settlement that fails, or is rolled back with
    the job, leaves the reservation open at its worst case: never an under-count."""
    if reservation_id is None:
        return
    try:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE model_call_reservations
                SET released_at = clock_timestamp(), settled_micros = %s, model_call_id = %s
                WHERE id = %s AND released_at IS NULL
                """,
                (max(0, cost_micros), model_call_id, reservation_id),
            )
    except psycopg.Error as error:
        logger.warning("an AI reservation was not settled: %s", type(error).__name__)


# The route and the gate


class LimitsBody(BaseModel):
    engagements: int | None
    systems: int | None
    controls: int | None
    members: int | None
    uploads: int | None
    upload_bytes: int | None
    ai_budget_micros: int | None
    ai_run_limit: int | None
    ai_concurrent_runs: int | None
    ai_run_seconds: int | None


class UsageBody(BaseModel):
    engagements: int
    systems: int
    controls: int
    members: int
    uploads: int
    upload_bytes: int
    ai_spent_micros: int
    ai_reserved_micros: int
    ai_runs: int
    ai_active_runs: int


class SubscriptionBody(BaseModel):
    state: str
    plan_type: str
    trial_started_at: datetime | None
    trial_expires_at: datetime | None
    days_left: int | None
    writable: bool
    limits: LimitsBody
    usage: UsageBody


def read_subscription(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    quiet_seconds: int | None = None,
) -> SubscriptionBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    sub = load(connection, organization_id)
    if sub is None:
        raise NotVisible()
    used = usage(connection, organization_id, quiet_seconds)
    return SubscriptionBody(
        state=sub.state,
        plan_type=sub.plan_type,
        trial_started_at=sub.trial_started_at,
        trial_expires_at=sub.trial_expires_at,
        days_left=sub.days_left(),
        writable=sub.writable,
        limits=LimitsBody(**sub.limits.__dict__),
        usage=UsageBody(**used.__dict__),
    )


def register_subscriptions(app: FastAPI, settings: Settings) -> None:
    """The subscription route, and the answers every route gives to a refused change."""

    @app.get("/organizations/{organization_id}/subscription", response_model=SubscriptionBody)
    def read(organization_id: UUID, request: Request) -> SubscriptionBody:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda c: read_subscription(
                c, principal, organization_id, settings.trial_ai_quiet_seconds
            ),
        )

    @app.exception_handler(TrialLimitReached)
    async def trial_limit(request: Request, error: TrialLimitReached) -> Response:
        return JSONResponse(error.detail(), status_code=402)

    @app.exception_handler(SubscriptionInactive)
    async def inactive(request: Request, error: SubscriptionInactive) -> Response:
        return JSONResponse(error.detail(), status_code=402)


def register_subscription_gate(app: FastAPI, settings: Settings) -> None:
    """Refuse every change under a firm whose subscription is not active, in one place.

    Registered before the session middleware so it runs after it: the caller is signed
    in, and the state is told only to a member of the firm. Reads are never refused: an
    expired trial keeps its records and may look at them."""

    @app.middleware("http")
    async def refuse_inactive(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in _WRITES or settings.database_url == "":
            return await call_next(request)
        match = _FIRM_PATH.match(request.url.path)
        if match is None or _OPEN_PATHS.match(match.group(2) or ""):
            return await call_next(request)
        user_id = getattr(request.state, "user_id", None)
        if not isinstance(user_id, UUID):
            return await call_next(request)
        try:
            organization_id = UUID(match.group(1))
        except ValueError:
            return await call_next(request)
        current = await run_in_threadpool(
            _member_state, settings.database_url, user_id, organization_id
        )
        if current is not None and current not in WRITABLE:
            return JSONResponse(inactive_detail(current), status_code=402)
        return await call_next(request)


def _member_state(database_url: str, user_id: UUID, organization_id: UUID) -> str | None:
    with connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT coalesce(subscription_state(o.id), 'NONE')
            FROM organizations o
            JOIN memberships m ON m.organization_id = o.id AND m.user_id = %s
             AND m.status = 'ACTIVE'
            WHERE o.id = %s
            """,
            (user_id, organization_id),
        ).fetchone()
    return None if row is None else str(row[0])
