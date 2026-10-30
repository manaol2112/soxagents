"""The firm's synthetic demo engagement: the first-login invitation, the demo record, and
its initialization (Trial Management and Synthetic Demo Experience, Step 3).

A firm on the free trial may have one demo engagement, built for it by the server from
a versioned dataset (demo_datasets.py) and marked as a demo in the database, where only
this initialization can mark it (migration 0128). The demo is outside the trial's
allowances; it is never counted and never counts.

- `GET /organizations/{id}/demo`: where the firm's demo stands, whether this person is
  eligible to start it (the firm is on a running trial, and they may create engagements)
  and whether the invitation is still to be shown to them;
- `POST .../demo/invitation`: this person's answer, kept so the invitation is asked once;
- `POST .../demo/initialize`: start the demo. Decided on the server, under a lock on the
  firm's demo record, so requests arriving together make one engagement; asked again, it
  answers with the same one; after a failure, the next request tries again from the
  same record. Without a dataset configured, the firm's answer is kept and nothing is
  built: the web says the demo is being prepared.

Every change under an inactive subscription is already refused by the subscription gate
(subscriptions.py), so an ended trial cannot start a demo.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request, Response
from psycopg.types.json import Json
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from ai_workforce_api import subscriptions
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.demo_datasets import DemoContext, DemoDataset, configured
from ai_workforce_api.rate_limit import RateLimited, enforce_on, retry_detail
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

# Who may start the demo: the roles that create engagements.
INITIALIZE_ACTION = Action.PROJECT_CREATE
# How often a failed initialization is tried again before a person has to look.
MAX_ATTEMPTS = 5
# How often a firm may replace its demo with a fresh one during the trial (Step 6).
MAX_RESETS = 3

Invitation = Literal["PENDING", "ACCEPTED", "DISMISSED"]


class DemoNotAvailable(Exception):
    """The firm is not eligible: not on a trial, or the trial is over."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class DemoInitializationFailed(Exception):
    """The dataset could not be built; the record says so and the next request retries."""

    def __init__(self, note: str, attempts: int) -> None:
        super().__init__(note)
        self.note = note
        self.attempts = attempts


class DemoResetRefused(Exception):
    """The demo cannot be reset now: no live demo, the allowance is used, or the request
    was made against an earlier state of the record (a retry after a reset went
    through)."""

    def __init__(self, reason: str, resets: int) -> None:
        super().__init__(reason)
        self.reason = reason
        self.resets = resets


class DemoResetFailed(Exception):
    """The replacement could not be built; the firm keeps the demo it had."""

    def __init__(self, note: str) -> None:
        super().__init__(note)
        self.note = note


@dataclass(frozen=True)
class Demo:
    organization_id: UUID
    state: str
    dataset_key: str
    project_id: UUID | None
    attempts: int
    resets: int
    failure: str


def load(connection: Any, organization_id: UUID, *, lock: bool = False) -> Demo | None:
    row = connection.execute(
        """
        SELECT organization_id, state::text, dataset_key, project_id, attempts, resets, failure
        FROM organization_demos WHERE organization_id = %s
        """
        + (" FOR UPDATE" if lock else ""),
        (organization_id,),
    ).fetchone()
    if row is None:
        return None
    return Demo(
        organization_id=UUID(str(row[0])),
        state=str(row[1]),
        dataset_key=str(row[2]),
        project_id=UUID(str(row[3])) if row[3] is not None else None,
        attempts=int(row[4]),
        resets=int(row[5]),
        failure=str(row[6]),
    )


def eligibility(sub: subscriptions.Subscription | None) -> str:
    """Why the firm may not start a demo; '' when it may. Paid and internal firms are not
    offered the trial's demo."""
    if sub is None:
        return "no-subscription"
    if not sub.trial:
        return "not-trial"
    if sub.state == "TRIAL_EXPIRED":
        return "trial-ended"
    if sub.state != "TRIAL":
        return "subscription-inactive"
    return ""


class InvitationBody(BaseModel):
    response: Literal["DISMISSED"]


class ResetBody(BaseModel):
    # The resets the person saw: a retry after a reset went through does not reset again.
    expected_resets: int = Field(ge=0, le=MAX_RESETS)


class DemoBody(BaseModel):
    state: str
    eligible: bool
    reason: str
    can_initialize: bool
    invitation: Invitation
    # Whether the invitation is still to be shown to this person: eligible, allowed to
    # start it, not yet answered, and the demo not already made.
    invited: bool
    dataset_available: bool
    dataset_complete: bool
    dataset_key: str
    dataset_title: str
    project_id: UUID | None
    attempts: int
    failure: str
    # The replacements made and left during the trial (Step 6), and whether this
    # person may make one now.
    resets: int
    resets_left: int
    can_reset: bool


def _response(cursor: Any, organization_id: UUID, user_id: UUID) -> Invitation:
    row = cursor.execute(
        "SELECT response FROM demo_invitation_responses "
        "WHERE organization_id = %s AND user_id = %s",
        (organization_id, user_id),
    ).fetchone()
    if row is None:
        return "PENDING"
    return "ACCEPTED" if str(row[0]) == "ACCEPTED" else "DISMISSED"


def _respond(cursor: Any, organization_id: UUID, user_id: UUID, response: str) -> None:
    cursor.execute(
        """
        INSERT INTO demo_invitation_responses (organization_id, user_id, response)
        VALUES (%s, %s, %s)
        ON CONFLICT (organization_id, user_id)
        DO UPDATE SET response = EXCLUDED.response, responded_at = clock_timestamp()
        """,
        (organization_id, user_id, response),
    )


def _may_initialize(connection: Any, principal: Principal, organization_id: UUID) -> bool:
    try:
        authorize(
            connection,
            principal=principal,
            action=INITIALIZE_ACTION,
            organization_id=organization_id,
        )
    except AccessDenied:
        return False
    return True


def _live(cursor: Any, project_id: UUID | None) -> bool:
    if project_id is None:
        return False
    row = cursor.execute(
        "SELECT 1 FROM projects WHERE id = %s AND deleted_at IS NULL AND status <> 'ARCHIVED'",
        (project_id,),
    ).fetchone()
    return row is not None


def _body(
    connection: Any,
    principal: Principal,
    organization_id: UUID,
    settings: Settings,
    *,
    can_initialize: bool,
) -> DemoBody:
    sub = subscriptions.load(connection, organization_id)
    reason = eligibility(sub)
    demo = load(connection, organization_id)
    invitation = _response(connection, organization_id, principal.id)
    dataset = configured(settings)
    state = demo.state if demo is not None else "NOT_INITIALIZED"
    project_id = demo.project_id if demo is not None else None
    if state == "READY" and not _live(connection, project_id):
        # The demo engagement was archived or removed: the firm may make one again.
        state, project_id = "ARCHIVED", None
    resets = demo.resets if demo is not None else 0
    return DemoBody(
        state=state,
        eligible=reason == "",
        reason=reason,
        can_initialize=reason == "" and can_initialize,
        invitation=invitation,
        invited=reason == "" and can_initialize and invitation == "PENDING" and state != "READY",
        dataset_available=dataset is not None,
        dataset_complete=dataset is not None and dataset.complete,
        dataset_key=demo.dataset_key if demo is not None else "",
        dataset_title=dataset.title if dataset is not None else "",
        project_id=project_id,
        attempts=demo.attempts if demo is not None else 0,
        failure=demo.failure if demo is not None else "",
        resets=resets,
        resets_left=max(0, MAX_RESETS - resets),
        can_reset=reason == "" and can_initialize and state == "READY" and resets < MAX_RESETS,
    )


def read_demo(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    settings: Settings,
) -> DemoBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    allowed = _may_initialize(connection, principal, organization_id)
    return _body(connection, principal, organization_id, settings, can_initialize=allowed)


def answer_invitation(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: InvitationBody,
    settings: Settings,
) -> DemoBody:
    """This person's answer to the invitation, kept on their membership of the firm. A
    dismissed invitation stays available from the account menu while the trial runs."""
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        _respond(cursor, organization_id, principal.id, body.response)
        _audit(cursor, organization_id, None, principal.id, "demo.invitation_dismissed", {})
    allowed = _may_initialize(connection, principal, organization_id)
    return _body(connection, principal, organization_id, settings, can_initialize=allowed)


def initialize_demo(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    settings: Settings,
) -> DemoBody:
    """Start the firm's demo, or answer with the one it has.

    The firm's demo record is locked for the whole decision, so two requests arriving
    together take turns: the second finds the first's engagement and answers with it.
    The build runs in a savepoint; when it fails, nothing of it stays, the record says
    FAILED with why (a class and a code, never row values), and the next request tries
    again from that record, up to MAX_ATTEMPTS."""
    authorize(
        connection,
        principal=principal,
        action=INITIALIZE_ACTION,
        organization_id=organization_id,
    )
    dataset = configured(settings)
    # A firm starts or resets its demo only so often (Step 7); a build is expensive.
    enforce_on(connection, settings, "demo", str(organization_id))
    failed: DemoInitializationFailed | None = None
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organization_demos (organization_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (organization_id,),
        )
        demo = load(cursor, organization_id, lock=True)
        assert demo is not None
        reason = eligibility(subscriptions.load(cursor, organization_id))
        if reason != "":
            raise DemoNotAvailable(reason)
        _respond(cursor, organization_id, principal.id, "ACCEPTED")
        if demo.state == "READY" and _live(cursor, demo.project_id):
            pass
        elif dataset is None:
            # No demo to build yet: the answer is kept, and the web says it is prepared.
            _audit(
                cursor, organization_id, None, principal.id, "demo.requested",
                {"dataset": "", "state": demo.state},
            )  # fmt: skip
        elif demo.attempts >= MAX_ATTEMPTS and demo.state == "FAILED":
            raise DemoInitializationFailed(demo.failure, demo.attempts)
        else:
            failed = _build(
                cursor, connection, demo, dataset, principal.id, organization_id, settings
            )
    if failed is not None:
        # The request's own transaction began before this (authorization read first), so
        # the record of the failure is committed here, or the error would roll it back.
        connection.commit()
        raise failed
    return _body(connection, principal, organization_id, settings, can_initialize=True)


def reset_demo(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: ResetBody,
    settings: Settings,
) -> DemoBody:
    """Replace the firm's demo with a fresh one (Step 6), at most MAX_RESETS times during
    the trial, by a member who may create engagements.

    The record is locked for the whole decision, so requests arriving together take
    turns, and the second finds the resets count moved on and is refused rather than
    resetting again. The archive of the current demo and the build of its replacement run
    in one savepoint: a build that fails (or fails its readiness checks) rolls the archive
    back too, the firm keeps the demo it had, and the reset is not counted. The archived
    engagement keeps every record, signed or not; nothing is deleted. The trial's dates
    and allowances are never touched: the demo is outside them."""
    authorize(
        connection,
        principal=principal,
        action=INITIALIZE_ACTION,
        organization_id=organization_id,
    )
    dataset = configured(settings)
    enforce_on(connection, settings, "demo", str(organization_id))
    failed: DemoResetFailed | None = None
    with transaction(connection) as cursor:
        demo = load(cursor, organization_id, lock=True)
        reason = eligibility(subscriptions.load(cursor, organization_id))
        if reason != "":
            raise DemoNotAvailable(reason)
        if demo is None or demo.state != "READY" or not _live(cursor, demo.project_id):
            raise DemoResetRefused("no-demo", demo.resets if demo is not None else 0)
        if dataset is None:
            raise DemoNotAvailable("no-dataset")
        if demo.resets >= MAX_RESETS:
            raise DemoResetRefused("resets-exhausted", demo.resets)
        if demo.resets != body.expected_resets:
            raise DemoResetRefused("already-reset", demo.resets)
        previous = demo.project_id
        assert previous is not None
        context = DemoContext(
            organization_id=organization_id,
            requested_by=principal.id,
            sequence=demo.resets + 2,
            today=datetime.now(UTC).date(),
            settings=settings,
        )
        try:
            with connection.transaction():
                # The archive first, so the one-active-demo rule holds for the new one;
                # a failure below rolls it back and the firm keeps this demo.
                cursor.execute(
                    """
                    UPDATE projects SET status = 'ARCHIVED', updated_at = clock_timestamp()
                    WHERE id = %s AND organization_id = %s AND demo AND status <> 'ARCHIVED'
                    """,
                    (previous, organization_id),
                )
                cursor.execute(
                    "SELECT set_config('aw.demo_initialization', %s, true)",
                    (str(organization_id),),
                )
                project_id = dataset.build(cursor, context)
                cursor.execute("SELECT set_config('aw.demo_initialization', '', true)")
                cursor.execute(
                    """
                    UPDATE organization_demos
                    SET state = 'READY', project_id = %s, dataset_key = %s,
                        resets = resets + 1, requested_by = %s, failure = '',
                        ready_at = clock_timestamp(), archived_at = clock_timestamp(),
                        version = version + 1
                    WHERE organization_id = %s AND resets = %s
                    """,
                    (project_id, dataset.key, principal.id, organization_id, demo.resets),
                )
                if cursor.rowcount != 1:
                    raise DemoResetRefused("already-reset", demo.resets)
                _audit(
                    cursor, organization_id, project_id, principal.id, "demo.reset",
                    {
                        "dataset": dataset.key,
                        "archived_project_id": str(previous),
                        "resets": demo.resets + 1,
                    },
                )  # fmt: skip
        except DemoResetRefused:
            raise
        except Exception as error:  # noqa: BLE001 - whatever the build raised is the failure
            note = _failure_note(error)
            logger.warning("demo reset failed: %s", note)
            _audit(
                cursor, organization_id, previous, principal.id, "demo.reset_failed",
                {"dataset": dataset.key, "failure": note, "resets": demo.resets},
            )  # fmt: skip
            failed = DemoResetFailed(note)
    if failed is not None:
        connection.commit()
        raise failed
    return _body(connection, principal, organization_id, settings, can_initialize=True)


def _build(
    cursor: Any,
    connection: psycopg.Connection[Any],
    demo: Demo,
    dataset: DemoDataset,
    user_id: UUID,
    organization_id: UUID,
    settings: Settings,
) -> DemoInitializationFailed | None:
    cursor.execute(
        """
        UPDATE organization_demos
        SET state = 'INITIALIZING', started_at = clock_timestamp(), attempts = attempts + 1,
            requested_by = %s, dataset_key = %s, failure = '', project_id = NULL,
            version = version + 1
        WHERE organization_id = %s
        """,
        (user_id, dataset.key, organization_id),
    )
    context = DemoContext(
        organization_id=organization_id,
        requested_by=user_id,
        sequence=demo.resets + 1,
        today=datetime.now(UTC).date(),
        settings=settings,
    )
    try:
        with connection.transaction():
            # The marker the database lets only this transaction set (migration 0128).
            cursor.execute(
                "SELECT set_config('aw.demo_initialization', %s, true)", (str(organization_id),)
            )
            project_id = dataset.build(cursor, context)
            cursor.execute("SELECT set_config('aw.demo_initialization', '', true)")
            cursor.execute(
                """
                UPDATE organization_demos
                SET state = 'READY', project_id = %s, ready_at = clock_timestamp(),
                    version = version + 1
                WHERE organization_id = %s
                """,
                (project_id, organization_id),
            )
            _audit(
                cursor, organization_id, project_id, user_id, "demo.initialized",
                {"dataset": dataset.key, "attempt": demo.attempts + 1},
            )  # fmt: skip
    except Exception as error:  # noqa: BLE001 - whatever the build raised is the failure
        note = _failure_note(error)
        logger.warning("demo initialization failed: %s", note)
        cursor.execute(
            """
            UPDATE organization_demos
            SET state = 'FAILED', failed_at = clock_timestamp(), failure = %s,
                version = version + 1
            WHERE organization_id = %s
            """,
            (note, organization_id),
        )
        _audit(
            cursor, organization_id, None, user_id, "demo.failed",
            {"dataset": dataset.key, "attempt": demo.attempts + 1, "failure": note},
        )  # fmt: skip
        return DemoInitializationFailed(note, demo.attempts + 1)
    return None


def _failure_note(error: Exception) -> str:
    """The class and the code only: a database message can carry row values."""
    if isinstance(error, psycopg.Error):
        parts = [type(error).__name__, error.sqlstate or "", error.diag.constraint_name or ""]
        return " ".join(part for part in parts if part)[:500]
    return f"{type(error).__name__}: {error}"[:500]


def _audit(
    cursor: Any,
    organization_id: UUID,
    project_id: UUID | None,
    actor_user_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'organization_demo', %s, %s)
        """,
        (organization_id, project_id, actor_user_id, action, organization_id, Json(payload)),
    )


def register_demo(app: FastAPI, settings: Settings) -> None:
    @app.get("/organizations/{organization_id}/demo", response_model=DemoBody)
    def read(organization_id: UUID, request: Request) -> DemoBody:
        principal = _session_principal(request)
        return _call(settings, lambda c: read_demo(c, principal, organization_id, settings))

    @app.post("/organizations/{organization_id}/demo/invitation", response_model=DemoBody)
    def answer(organization_id: UUID, body: InvitationBody, request: Request) -> DemoBody:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda c: answer_invitation(c, principal, organization_id, body, settings),
        )

    @app.post("/organizations/{organization_id}/demo/initialize", response_model=DemoBody)
    def initialize(organization_id: UUID, request: Request) -> DemoBody:
        principal = _session_principal(request)
        return _call(settings, lambda c: initialize_demo(c, principal, organization_id, settings))

    @app.post("/organizations/{organization_id}/demo/reset", response_model=DemoBody)
    def reset(organization_id: UUID, body: ResetBody, request: Request) -> DemoBody:
        principal = _session_principal(request)
        return _call(settings, lambda c: reset_demo(c, principal, organization_id, body, settings))

    @app.exception_handler(RateLimited)
    async def rate_limited(request: Request, error: RateLimited) -> Response:
        return JSONResponse(
            retry_detail(error),
            status_code=429,
            headers={"Retry-After": str(error.retry_after)},
        )

    @app.exception_handler(DemoResetRefused)
    async def reset_refused(request: Request, error: DemoResetRefused) -> Response:
        return JSONResponse(
            {
                "detail": {
                    "no-demo": "there is no demo engagement to reset",
                    "resets-exhausted": "the trial's demo resets are used",
                    "already-reset": "the demo was reset already; open the new one",
                }.get(error.reason, "the demo cannot be reset now"),
                "code": "DEMO_RESET_REFUSED",
                "reason": error.reason,
                "resets": error.resets,
                "resets_left": max(0, MAX_RESETS - error.resets),
            },
            status_code=409,
        )

    @app.exception_handler(DemoResetFailed)
    async def reset_failed(request: Request, error: DemoResetFailed) -> Response:
        return JSONResponse(
            {
                "detail": "the new demo could not be prepared; the current one is unchanged",
                "code": "DEMO_RESET_FAILED",
            },
            status_code=503,
        )

    @app.exception_handler(DemoNotAvailable)
    async def not_available(request: Request, error: DemoNotAvailable) -> Response:
        return JSONResponse(
            {
                "detail": "the demo is for firms on the free trial",
                "code": "DEMO_NOT_AVAILABLE",
                "reason": error.reason,
            },
            status_code=403,
        )

    @app.exception_handler(DemoInitializationFailed)
    async def failed(request: Request, error: DemoInitializationFailed) -> Response:
        return JSONResponse(
            {
                "detail": "the demo could not be prepared; try again in a moment",
                "code": "DEMO_FAILED",
                "attempts": error.attempts,
            },
            status_code=503,
        )
