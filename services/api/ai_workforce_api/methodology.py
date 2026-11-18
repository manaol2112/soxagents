"""The firm's testing methodology: the rules that size and conclude testing, in versions
(product owner, 8 November 2026, migration 0142).

No auditing standard prescribes these rules: AS 2315 sizes samples from tolerable and expected
deviation rates and the risk of relying on the control too much, and gives no table; AS 2201.48
allows a control to be effective with a deviation. They are the firm's methodology, so the firm
owns them:

- one methodology per firm, in numbered versions. Version 1 is the platform's default (today's
  rules, exactly), labelled as not approved by the firm until the firm approves a version of its
  own. Nothing waits on that approval;
- an Owner or Admin proposes a version with the reason for it, and a different Owner or Admin
  approves or rejects it. No one approves their own change (independence.py; development may
  turn that rule off, and the page says so);
- an engagement keeps the version it launched on. One already running when the methodology
  arrived keeps the version that was current the first time its rules were read, so nothing
  it had planned changes. Moving a running engagement to another approved version is a
  recorded decision with a reason; tests already sized keep their size;
- each test sheet and round records the version that sized it.

This version of the methodology holds the sample sizes (interim, roll-forward, and remediation
retest with its minimum days of operation), the deviation rule, and the rule for automated
controls. The deviation rule is zero tolerance and automated controls are tested once: allowing
deviations needs an expanded sample, and other rules for automated controls need the control's
risk; both come in later increments (phase-plan.md).
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ai_workforce_api import independence
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import SAMPLE_SIZES
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

FREQUENCIES = ("ANNUAL", "QUARTERLY", "MONTHLY", "WEEKLY", "DAILY", "RECURRING", "EVENT_DRIVEN")
# The frequency a control with none recognized is sized as: the most frequent.
FALLBACK = "EVENT_DRIVEN"
MAX_SAMPLE = 200
MAX_WAIT_DAYS = 365

# The platform's update-sample table for the roll-forward period.
ROLLFORWARD_SIZES = {
    "ANNUAL": 1,
    "QUARTERLY": 1,
    "MONTHLY": 1,
    "WEEKLY": 2,
    "DAILY": 5,
    "RECURRING": 10,
    "EVENT_DRIVEN": 10,
}
# Remediation retest: the sample size, and how many days the fixed control must have operated
# before it can be tested (two quarters, two months, five weeks, 20 days...).
RETEST_RULES: dict[str, tuple[int, int]] = {
    "ANNUAL": (1, 0),
    "QUARTERLY": (2, 180),
    "MONTHLY": (2, 60),
    "WEEKLY": (5, 35),
    "DAILY": (20, 28),
    "RECURRING": (25, 20),
    "EVENT_DRIVEN": (25, 30),
}

Status = Literal["PLATFORM_DEFAULT", "PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]
# The versions an engagement may follow.
FOLLOWABLE = ("PLATFORM_DEFAULT", "APPROVED")
# An engagement is pinned once it is running; a draft follows the firm's current version.
RUNNING = ("ACTIVE", "PAUSED")


class MethodologyState(Exception):
    """A 409: the request does not fit the methodology's state."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class SelfApproval(Exception):
    """A 403: the person who proposed a version cannot decide it."""


class Retest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    size: int = Field(ge=1, le=MAX_SAMPLE)
    days: int = Field(ge=0, le=MAX_WAIT_DAYS)


class Rules(BaseModel):
    """What one version of the methodology says. Every frequency has a value in every table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sample_sizes: dict[str, int]
    rollforward_sizes: dict[str, int]
    retest: dict[str, Retest]
    # ZERO: any confirmed exception concludes the control not effective.
    tolerance: Literal["ZERO"] = "ZERO"
    # TEST_OF_ONE: an automated control is tested once, by its configuration.
    automated: Literal["TEST_OF_ONE"] = "TEST_OF_ONE"

    @model_validator(mode="after")
    def _complete(self) -> Rules:
        for name, table in (
            ("sample sizes", self.sample_sizes),
            ("roll-forward sizes", self.rollforward_sizes),
            ("retest rules", self.retest),
        ):
            if set(table) != set(FREQUENCIES):
                raise ValueError(f"the {name} need a value for every frequency, and only those")
        for name, sizes in (
            ("sample size", self.sample_sizes),
            ("roll-forward size", self.rollforward_sizes),
        ):
            for frequency, size in sizes.items():
                if not 1 <= size <= MAX_SAMPLE:
                    raise ValueError(f"the {name} for {frequency} must be 1 to {MAX_SAMPLE}")
        return self

    def sample_size(self, frequency: str, nature: str) -> int:
        """How many instances a tester selects. An automated control is tested once."""
        if nature == "AUTOMATED":
            return 1
        return self.sample_sizes.get(frequency, self.sample_sizes[FALLBACK])

    def rollforward(self, frequency: str, nature: str) -> tuple[str, int]:
        if nature == "AUTOMATED":
            return "TEST_OF_ONE", 1
        return "SAMPLE", self.rollforward_sizes.get(frequency, self.rollforward_sizes[FALLBACK])

    def retest_rule(self, frequency: str, nature: str) -> tuple[str, int, int]:
        """Method, sample size, and minimum days of operation before the retest."""
        if nature == "AUTOMATED":
            return "TEST_OF_ONE", 1, 0
        rule = self.retest.get(frequency, self.retest[FALLBACK])
        return "SAMPLE", rule.size, rule.days


PLATFORM_DEFAULT = Rules(
    sample_sizes={key: SAMPLE_SIZES[key] for key in FREQUENCIES},
    rollforward_sizes=dict(ROLLFORWARD_SIZES),
    retest={key: Retest(size=size, days=days) for key, (size, days) in RETEST_RULES.items()},
)


@dataclass(frozen=True)
class Applied:
    """The version an engagement follows."""

    id: UUID
    number: int
    status: str
    rules: Rules

    @property
    def approved(self) -> bool:
        return self.status == "APPROVED"

    @property
    def label(self) -> str:
        if self.approved:
            return f"Firm methodology v{self.number}"
        return f"Firm methodology v{self.number}: platform default, not approved by the firm"


def _rules(raw: Any) -> Rules:
    """A stored version's rules. One that no longer reads (a later change to the shape) is
    an error to fix, never a silent fallback to other rules."""
    return Rules.model_validate(raw)


def ensure_default(cursor: psycopg.Cursor[Any], organization_id: UUID) -> None:
    """The firm's version 1, the platform default, written the first time it is needed."""
    cursor.execute(
        """
        INSERT INTO methodology_versions (organization_id, number, status, rules, rationale)
        SELECT %s, 1, 'PLATFORM_DEFAULT', %s, %s
        WHERE NOT EXISTS (SELECT 1 FROM methodology_versions WHERE organization_id = %s)
        ON CONFLICT DO NOTHING
        """,
        (
            organization_id,
            Json(PLATFORM_DEFAULT.model_dump()),
            "The platform's default rules. No auditing standard prescribes them: the firm "
            "confirms or replaces them.",
            organization_id,
        ),
    )


def _read_only(cursor: psycopg.Cursor[Any]) -> bool:
    """Whether the caller's transaction may not write (the console's read-only tools)."""
    row = cursor.execute("SELECT current_setting('transaction_read_only') = 'on'").fetchone()
    return row is not None and bool(row[0])


#: The platform default as a read sees it before the firm's version 1 is written: a firm
#: whose version 1 does not exist yet follows it, and it is written on the next write.
_UNWRITTEN_DEFAULT = UUID(int=0)


def current(cursor: psycopg.Cursor[Any], organization_id: UUID) -> Applied:
    """The version new engagements follow: the latest the firm approved, else the default.

    Read first, and the firm's version 1 written only when it has none (10 November 2026:
    the write on every read failed the console's read-only status tool). In a read-only
    transaction nothing is written: a firm with no version yet reads the platform default."""

    def latest() -> Any:
        return cursor.execute(
            """
            SELECT id, number, status, rules FROM methodology_versions
            WHERE organization_id = %s AND status IN ('PLATFORM_DEFAULT', 'APPROVED')
            ORDER BY (status = 'APPROVED') DESC, number DESC LIMIT 1
            """,
            (organization_id,),
        ).fetchone()

    row = latest()
    if row is None:
        if _read_only(cursor):
            return Applied(_UNWRITTEN_DEFAULT, 1, "PLATFORM_DEFAULT", PLATFORM_DEFAULT)
        ensure_default(cursor, organization_id)
        row = latest()
    assert row is not None
    return Applied(UUID(str(row[0])), int(row[1]), str(row[2]), _rules(row[3]))


def pin(cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID) -> Applied:
    """Fix the engagement to the firm's current version, unless it already follows one."""
    chosen = current(cursor, organization_id)
    row = cursor.execute(
        "UPDATE projects SET methodology_version_id = %s "
        "WHERE id = %s AND organization_id = %s AND methodology_version_id IS NULL "
        "RETURNING id",
        (chosen.id, project_id, organization_id),
    ).fetchone()
    if row is not None:
        _audit(cursor, organization_id, project_id, None, "methodology.pinned", project_id,
               {"version": chosen.number, "status": chosen.status})  # fmt: skip
    return chosen


def applied_on(cursor: psycopg.Cursor[Any], project_id: UUID) -> Applied:
    """The version an engagement follows, inside the caller's transaction. A running
    engagement not yet pinned is pinned now, to the firm's current version, so what it plans
    from here keeps the same rules."""
    row = cursor.execute(
        """
        SELECT p.organization_id, p.status, v.id, v.number, v.status, v.rules
        FROM projects p LEFT JOIN methodology_versions v ON v.id = p.methodology_version_id
        WHERE p.id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        raise MethodologyState("the engagement is not found")
    organization_id = UUID(str(row[0]))
    if row[2] is not None:
        return Applied(UUID(str(row[2])), int(row[3]), str(row[4]), _rules(row[5]))
    # A read that may not write reads the version it would be pinned to; the next write pins.
    if str(row[1]) in RUNNING and not _read_only(cursor):
        return pin(cursor, organization_id, project_id)
    return current(cursor, organization_id)


def for_project(connection: psycopg.Connection[Any], project_id: UUID) -> Applied:
    with transaction(connection) as cursor:
        return applied_on(cursor, project_id)


def rules_for(connection: psycopg.Connection[Any], project_id: UUID) -> Rules:
    return for_project(connection, project_id).rules


# What the page reads


class VersionBody(BaseModel):
    id: UUID
    number: int
    status: Status
    rules: dict[str, Any]
    rationale: str
    based_on: int | None
    proposed_by: str
    proposed_by_id: UUID | None
    proposed_at: datetime | None
    decided_by: str
    decided_at: datetime | None
    decision_note: str
    # How many of the firm's engagements follow it.
    engagements: int
    version: int


class MethodologyBody(BaseModel):
    current: VersionBody
    pending: VersionBody | None
    history: list[VersionBody]
    frequencies: list[str]
    # An Owner or Admin may propose a version.
    can_propose: bool
    # And decide one someone else proposed (or any, while independence is off).
    can_decide: bool
    # The person who proposed the waiting version may withdraw it.
    can_withdraw: bool
    independence: bool
    max_sample: int
    max_wait_days: int


class EngagementMethodologyBody(BaseModel):
    applied: VersionBody
    label: str
    pinned: bool
    # The approved versions it could move to.
    choices: list[VersionBody]
    can_move: bool


_VERSIONS = """
    SELECT v.id, v.number, v.status, v.rules, v.rationale, b.number,
           coalesce(pu.display_name, ''), v.proposed_by, v.proposed_at,
           coalesce(du.display_name, ''), v.decided_at, v.decision_note,
           (SELECT count(*) FROM projects p
            WHERE p.methodology_version_id = v.id AND p.deleted_at IS NULL),
           v.version
    FROM methodology_versions v
    LEFT JOIN methodology_versions b ON b.id = v.based_on
    LEFT JOIN users pu ON pu.id = v.proposed_by
    LEFT JOIN users du ON du.id = v.decided_by
"""


def _version(row: tuple[Any, ...]) -> VersionBody:
    return VersionBody(
        id=row[0],
        number=int(row[1]),
        status=row[2],
        rules=dict(row[3]),
        rationale=str(row[4]),
        based_on=None if row[5] is None else int(row[5]),
        proposed_by=str(row[6]),
        proposed_by_id=row[7],
        proposed_at=row[8],
        decided_by=str(row[9]),
        decided_at=row[10],
        decision_note=str(row[11]),
        engagements=int(row[12]),
        version=int(row[13]),
    )


def _may_manage(connection: psycopg.Connection[Any], principal: Principal, org: UUID) -> bool:
    try:
        authorize(
            connection, principal=principal, action=Action.METHODOLOGY_MANAGE, organization_id=org
        )
    except AccessDenied:
        return False
    return True


def read(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> MethodologyBody:
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    with transaction(connection) as cursor:
        chosen = current(cursor, organization_id)
    versions = [
        _version(row)
        for row in connection.execute(
            _VERSIONS + " WHERE v.organization_id = %s ORDER BY v.number DESC",
            (organization_id,),
        ).fetchall()
    ]
    pending = next((item for item in versions if item.status == "PENDING"), None)
    manage = _may_manage(connection, principal, organization_id)
    return MethodologyBody(
        current=next(item for item in versions if item.id == chosen.id),
        pending=pending,
        history=versions,
        frequencies=list(FREQUENCIES),
        can_propose=manage and pending is None,
        can_decide=manage
        and pending is not None
        and (pending.proposed_by_id != principal.id or not independence.required()),
        can_withdraw=manage and pending is not None and pending.proposed_by_id == principal.id,
        independence=independence.required(),
        max_sample=MAX_SAMPLE,
        max_wait_days=MAX_WAIT_DAYS,
    )


# Changing it


class ProposalBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rules: dict[str, Any]
    rationale: str = Field(min_length=1, max_length=2000)
    # The version the proposal changes: still the current one, or someone changed it first.
    based_on: UUID


class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["APPROVE", "REJECT"]
    note: str = Field(default="", max_length=1000)
    version: int = Field(ge=1)


class WithdrawBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


class MoveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: UUID
    reason: str = Field(min_length=1, max_length=500)


def _manage(connection: psycopg.Connection[Any], principal: Principal, org: UUID) -> None:
    authorize(
        connection, principal=principal, action=Action.METHODOLOGY_MANAGE, organization_id=org
    )


def _text(value: str, limit: int) -> str:
    return " ".join(value.split())[:limit]


def propose(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: ProposalBody,
) -> MethodologyBody:
    _manage(connection, principal, organization_id)
    rationale = _text(body.rationale, 2000)
    if len(rationale) < 10:
        raise MethodologyState("say why the methodology changes, and what it rests on")
    try:
        rules = Rules.model_validate(body.rules)
    except ValidationError as error:
        first = error.errors()[0]
        raise MethodologyState(str(first.get("msg", "the rules are not valid"))) from None
    with transaction(connection) as cursor:
        chosen = current(cursor, organization_id)
        if chosen.id != body.based_on:
            raise MethodologyState("the methodology changed since the page was read")
        if rules == chosen.rules:
            raise MethodologyState("the proposal changes nothing")
        try:
            row = cursor.execute(
                """
                INSERT INTO methodology_versions (
                    organization_id, number, status, rules, rationale, based_on, proposed_by,
                    proposed_at
                )
                SELECT %s, coalesce(max(number), 0) + 1, 'PENDING', %s, %s, %s, %s,
                       clock_timestamp()
                FROM methodology_versions WHERE organization_id = %s
                RETURNING id, number
                """,
                (organization_id, Json(rules.model_dump()), rationale, chosen.id, principal.id,
                 organization_id),
            ).fetchone()  # fmt: skip
        except psycopg.errors.UniqueViolation:
            raise MethodologyState("a proposal is already waiting for a decision") from None
        assert row is not None
        _audit(cursor, organization_id, None, principal.id, "methodology.proposed", row[0],
               {"number": int(row[1]), "based_on": chosen.number})  # fmt: skip
    return read(connection, principal, organization_id)


def decide(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    version_id: UUID,
    body: DecisionBody,
) -> MethodologyBody:
    _manage(connection, principal, organization_id)
    note = _text(body.note, 1000)
    if body.decision == "REJECT" and len(note) < 3:
        raise MethodologyState("say why the proposal is rejected")
    with transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT proposed_by, number, version, status FROM methodology_versions "
            "WHERE id = %s AND organization_id = %s FOR UPDATE",
            (version_id, organization_id),
        ).fetchone()
        if row is None:
            raise MethodologyState("the proposal is not found")
        if str(row[3]) != "PENDING" or int(row[2]) != body.version:
            raise MethodologyState("the proposal changed since the page was read")
        if independence.required() and row[0] == principal.id:
            raise SelfApproval()
        status = "APPROVED" if body.decision == "APPROVE" else "REJECTED"
        cursor.execute(
            """
            UPDATE methodology_versions
            SET status = %s, decided_by = %s, decided_at = clock_timestamp(),
                decision_note = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (status, principal.id, note, version_id),
        )
        _audit(cursor, organization_id, None, principal.id,
               "methodology.approved" if status == "APPROVED" else "methodology.rejected",
               version_id, {"number": int(row[1]), "own": row[0] == principal.id})  # fmt: skip
    return read(connection, principal, organization_id)


def withdraw(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    version_id: UUID,
    body: WithdrawBody,
) -> MethodologyBody:
    _manage(connection, principal, organization_id)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            UPDATE methodology_versions
            SET status = 'WITHDRAWN', decided_by = %s, decided_at = clock_timestamp(),
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s AND organization_id = %s AND status = 'PENDING' AND version = %s
              AND proposed_by = %s
            RETURNING number
            """,
            (principal.id, version_id, organization_id, body.version, principal.id),
        ).fetchone()
        if row is None:
            raise MethodologyState("only the person who proposed it can withdraw it")
        _audit(cursor, organization_id, None, principal.id, "methodology.withdrawn", version_id,
               {"number": int(row[0])})  # fmt: skip
    return read(connection, principal, organization_id)


def engagement(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> EngagementMethodologyBody:
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    applied = for_project(connection, project_id)
    pinned = connection.execute(
        "SELECT methodology_version_id IS NOT NULL, status FROM projects WHERE id = %s",
        (project_id,),
    ).fetchone()
    versions = [
        _version(row)
        for row in connection.execute(
            _VERSIONS + " WHERE v.organization_id = %s AND v.status IN "
            "('PLATFORM_DEFAULT', 'APPROVED') ORDER BY v.number DESC",
            (organization_id,),
        ).fetchall()
    ]
    running = pinned is not None and str(pinned[1]) in RUNNING
    return EngagementMethodologyBody(
        applied=next(item for item in versions if item.id == applied.id),
        label=applied.label,
        pinned=bool(pinned[0]) if pinned is not None else False,
        choices=[item for item in versions if item.id != applied.id],
        can_move=running and _may_manage(connection, principal, organization_id),
    )


def move(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: MoveBody,
) -> EngagementMethodologyBody:
    """Move a running engagement to another approved version. What is already sized keeps its
    size; what it sizes from now follows the new version."""
    authorize(
        connection,
        principal=principal,
        action=Action.METHODOLOGY_MANAGE,
        organization_id=organization_id,
        project_id=project_id,
    )
    # The engagement is the caller's firm's: nothing is read or pinned for another's.
    authorize(
        connection,
        principal=principal,
        action=Action.PROJECT_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    reason = _text(body.reason, 500)
    if len(reason) < 10:
        raise MethodologyState("say why this engagement moves to another version")
    before = for_project(connection, project_id)
    with transaction(connection) as cursor:
        target = cursor.execute(
            "SELECT number, status FROM methodology_versions "
            "WHERE id = %s AND organization_id = %s",
            (body.version_id, organization_id),
        ).fetchone()
        if target is None or str(target[1]) not in FOLLOWABLE:
            raise MethodologyState("an engagement can follow only an approved version")
        if body.version_id == before.id:
            raise MethodologyState("the engagement already follows that version")
        row = cursor.execute(
            "UPDATE projects SET methodology_version_id = %s "
            "WHERE id = %s AND organization_id = %s AND status IN ('ACTIVE', 'PAUSED') "
            "RETURNING id",
            (body.version_id, project_id, organization_id),
        ).fetchone()
        if row is None:
            raise MethodologyState("only a running engagement moves to another version")
        moved = {"from": before.number, "to": int(target[0]), "reason": reason}
        _audit(cursor, organization_id, project_id, principal.id, "methodology.moved",
               project_id, moved)  # fmt: skip
    return engagement(connection, principal, organization_id, project_id)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID | None,
    actor: UUID | None,
    action: str,
    target: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'methodology', %s, %s)
        """,
        (organization_id, project_id, actor, action, target, Json(payload)),
    )


def register_methodology(app: FastAPI, settings: Settings) -> None:
    # "Testing methodology": the engagement profile's "methodology" is the audit framework
    # (external ICFR audit, management's 404 assessment, internal audit), a different thing.
    base = "/organizations/{organization_id}/testing-methodology"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except MethodologyState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except SelfApproval:
            raise HTTPException(
                status_code=403, detail="the person who proposed a change cannot approve it"
            ) from None

    @app.get(base, response_model=MethodologyBody)
    def methodology(organization_id: UUID, request: Request) -> MethodologyBody:
        return run(request, lambda c, p: read(c, p, organization_id))

    @app.post(f"{base}/proposals", response_model=MethodologyBody)
    def proposed(organization_id: UUID, body: ProposalBody, request: Request) -> MethodologyBody:
        return run(request, lambda c, p: propose(c, p, organization_id, body))

    @app.post(f"{base}/versions/{{version_id}}/decision", response_model=MethodologyBody)
    def decided(
        organization_id: UUID, version_id: UUID, body: DecisionBody, request: Request
    ) -> MethodologyBody:
        return run(request, lambda c, p: decide(c, p, organization_id, version_id, body))

    @app.post(f"{base}/versions/{{version_id}}/withdraw", response_model=MethodologyBody)
    def withdrawn(
        organization_id: UUID, version_id: UUID, body: WithdrawBody, request: Request
    ) -> MethodologyBody:
        return run(request, lambda c, p: withdraw(c, p, organization_id, version_id, body))

    project = "/organizations/{organization_id}/projects/{project_id}/testing-methodology"

    @app.get(project, response_model=EngagementMethodologyBody)
    def followed(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> EngagementMethodologyBody:
        return run(request, lambda c, p: engagement(c, p, organization_id, project_id))

    @app.put(project, response_model=EngagementMethodologyBody)
    def moved(
        organization_id: UUID, project_id: UUID, body: MoveBody, request: Request
    ) -> EngagementMethodologyBody:
        return run(request, lambda c, p: move(c, p, organization_id, project_id, body))
