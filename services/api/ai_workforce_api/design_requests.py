"""The D&I requests list (B1f; decided by the product owner on 12 November 2026,
docs/control-workflow-plan.md).

"Why do I need to have the release button? Simplify the workflow. After the attributes
approval, list down the evidences so that I can add, modify or update, or delete. Similar to
how I do in the attributes." and "Agent proposes, the human approves. For each request, I
want to show which specific attributes it is addressing to make sure I get coverage."

After the attributes are settled the D&I Evidence step is one list: the plan's live Design
requirements. Each is accepted (a person owns it) or to accept (the agent proposed or
changed it). A request a person adds, rewords, restores or links to attributes is accepted
by that act (evidence_plans.accept_request); the planner never overwrites an accepted
request (evidence_plans._merge_requirements). Here:

- one acceptance for a row or for the set (`accept`), all or none, at the versions the
  person saw, a pending change applied by it, each with its own audit record;
- coverage: why an approved attribute no request addresses is not evidenced at D&I, recorded
  by a person (`record_exception`, `clear_exception`).

Every act on the list is that person's decision on it, kept as the list's last decision
(evidence_plans.list_decided). When the list becomes settled, by whatever event, the D&I
evidence is released for the person of that last decision (phase_release.settle_design).
Nothing here is done by an agent.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.after_commit import after_commit, committed
from ai_workforce_api.authorization import (
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_plans import (
    LISTED_STATUSES,
    EvidencePlanBody,
    PlanState,
    _audit,
    _plan_row,
    accept_request,
    apply_change,
    issue,
    list_decided,
    plan_body,
    queue_drafts,
    with_live_email,
)
from ai_workforce_api.phase_release import (
    _LIVE_REQUIREMENT_SQL,
    DESIGN_ACCEPT_ACTION,
    planner_hold,
    settle_design,
)
from ai_workforce_api.settings import Settings

REASON_MIN = 20
REASON_MAX = 500


class RequestAccepted(BaseModel):
    requirement_id: UUID
    version: int = Field(ge=1)


class RequestsAccepted(BaseModel):
    """The D&I requests a person accepts as they stand, as one decision."""

    items: list[RequestAccepted] = Field(min_length=1, max_length=100)


class ExceptionBody(BaseModel):
    """Why an approved attribute is not evidenced at D&I. The reason is checked by
    `stated_reason`, so a refusal is a sentence a person can read (the page shows it as it
    is), not a schema error."""

    reason: str = Field(max_length=4000)


# What the routes answer when they refuse, each a sentence the page shows as it is. While
# the planner works, or its run stopped, the sentence is phase_release.planner_hold's.
STALE = "A request changed after you opened the list. Read the list again, then accept."
TWICE = "A request is listed twice."
NOT_DESIGN = "Only a D&I request is accepted here."
NOT_LISTED = "A request is no longer in the list. Read the list again, then accept."
NOT_PLANNED = "Plan the evidence first."
OUT_OF_SCOPE = "The control is out of scope."
NOT_APPROVED = "Only an approved attribute can have an exception."
COVERED = "A D&I request already addresses this attribute."
REASON_SHORT = f"Say why in at least {REASON_MIN} characters."
REASON_LONG = f"Keep the reason to {REASON_MAX} characters or fewer."
REASON_SECRET = "The reason must not contain a password or a key."


class Unprocessable(Exception):
    """What a person wrote cannot be recorded as it is (answered 422, with the sentence)."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


def stated_reason(text: str) -> str:
    """The reason as recorded: spacing normalised, 20 to 500 characters, no credential."""
    reason = " ".join(text.split())
    if len(reason) < REASON_MIN:
        raise Unprocessable(REASON_SHORT)
    if len(reason) > REASON_MAX:
        raise Unprocessable(REASON_LONG)
    if contains_secret({"reason": reason}):
        raise Unprocessable(REASON_SECRET)
    return reason


def _planned(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> UUID:
    """The control's plan, its row held; refused in a sentence when there is none."""
    try:
        return _plan_row(cursor, project_id, control_id)[0]
    except PlanState:
        raise PlanState(NOT_PLANNED) from None


def accept(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: RequestsAccepted,
) -> list[UUID]:
    """A person accepts D&I requests as they stand, one decision per request and one call
    for the set. A request the agent proposed becomes theirs; a request carrying a change
    the planner proposed (a change to its content, a proposed addition, or a proposed
    removal) has the change applied, as deciding it alone would (evidence_plans.apply_change),
    and is theirs as it then stands. Each item is checked at the version the person saw and
    leaves its own record with the person as the actor (evidence_requirement.accepted, and
    evidence_requirement.change_decided for a change); the group one more
    (design_requests.accepted). All or none.

    Refused while the planner works on the plan, or its run stopped before it finished: the
    list may still change under the person. An item already accepted at that version, with
    nothing pending, is left as it is, and still counts as this person standing behind the
    list: the acceptance is the list's last decision (evidence_plans.list_decided), which is
    how a list nobody eligible stands behind is accepted again. Returns the drafts to write
    for what an accepted addition asks of a released phase."""
    chosen = [item.requirement_id for item in body.items]
    if len(set(chosen)) != len(chosen):
        raise PlanState(TWICE)
    with transaction(connection) as cursor:
        # The plan's row first, then its requirements, as every writer takes them.
        plan_id = _planned(cursor, project_id, control_id)
        held = planner_hold(cursor, control_id)
        if held is not None:
            raise PlanState(held)
        rows = {
            UUID(str(row[0])): tuple(row)
            for row in cursor.execute(
                """
                SELECT q.id, q.status, q.version, q.pbc_request_id, r.status, q.pending_change,
                       q.depends_on, q.plan_id, q.phase, q.accepted_at IS NOT NULL
                FROM evidence_requirements q
                LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id
                WHERE q.plan_id = %s AND q.project_id = %s AND q.engagement_control_id = %s
                  AND q.id = ANY(%s)
                ORDER BY q.id
                FOR UPDATE OF q
                """,
                (plan_id, project_id, control_id, chosen),
            ).fetchall()
        }
        if len(rows) != len(chosen):
            raise NotVisible()
        recorded: list[dict[str, Any]] = []
        confirmed = 0
        for item in body.items:
            row = rows[item.requirement_id]
            if str(row[8]) != "DESIGN":
                raise PlanState(NOT_DESIGN)
            if int(row[2]) != item.version:
                raise PlanState(STALE)
            pending = isinstance(row[5], dict)
            if not pending and str(row[1]) not in LISTED_STATUSES:
                raise PlanState(NOT_LISTED)
            if not pending and bool(row[9]):
                # Theirs already, as it stands: nothing to decide again on the row.
                confirmed += 1
                continue
            kind: str | None = None
            if pending:
                kind = apply_change(
                    cursor, organization_id, project_id, control_id, item.requirement_id,
                    actor, row, "ACCEPT",
                )  # fmt: skip
            else:
                cursor.execute(
                    "UPDATE evidence_requirements SET version = version + 1 WHERE id = %s",
                    (item.requirement_id,),
                )
            if kind != "REMOVE":
                accept_request(
                    cursor, organization_id, project_id, item.requirement_id, actor,
                    "ACCEPT", kind,
                )  # fmt: skip
            recorded.append({"requirement": str(item.requirement_id), "change": kind})
        _audit(
            cursor, organization_id, project_id, actor, "design_requests.accepted",
            "engagement_control", control_id, {"items": recorded, "confirmed": confirmed},
        )  # fmt: skip
        list_decided(cursor, organization_id, project_id, control_id, actor)
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def record_exception(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    attribute_id: UUID,
    actor: UUID,
    body: ExceptionBody,
) -> None:
    """A person records why an approved attribute is not evidenced at D&I: the coverage
    then counts it as explained. Only for an approved attribute of the control that no live
    D&I request addresses (one a request addresses needs no exception; an exception is
    withdrawn the moment a request addresses its attribute, evidence_plans.list_decided).
    Recording it again replaces the reason. On the audit trail with the reason, and the
    person as the actor; it is their decision on the list."""
    reason = stated_reason(body.reason)
    with transaction(connection) as cursor:
        _planned(cursor, project_id, control_id)
        attribute = cursor.execute(
            "SELECT status FROM control_attributes WHERE id = %s AND project_id = %s "
            "AND engagement_control_id = %s FOR UPDATE",
            (attribute_id, project_id, control_id),
        ).fetchone()
        if attribute is None:
            raise NotVisible()
        if attribute[0] != "APPROVED":
            raise PlanState(NOT_APPROVED)
        covered = cursor.execute(
            f"""
            SELECT 1 FROM evidence_requirement_attributes ra
            JOIN evidence_requirements q ON q.id = ra.requirement_id
            WHERE ra.attribute_id = %s AND q.engagement_control_id = %s
              AND q.phase = 'DESIGN' AND {_LIVE_REQUIREMENT_SQL}
            LIMIT 1
            """,
            (attribute_id, control_id),
        ).fetchone()
        if covered is not None:
            raise PlanState(COVERED)
        before = cursor.execute(
            "SELECT reason FROM design_coverage_exceptions WHERE engagement_control_id = %s "
            "AND attribute_id = %s FOR UPDATE",
            (control_id, attribute_id),
        ).fetchone()
        if before is not None and str(before[0]) == reason:
            return
        cursor.execute(
            """
            INSERT INTO design_coverage_exceptions (
                organization_id, project_id, engagement_control_id, attribute_id, reason,
                recorded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (engagement_control_id, attribute_id) DO UPDATE
            SET reason = EXCLUDED.reason, recorded_by = EXCLUDED.recorded_by,
                recorded_at = clock_timestamp()
            """,
            (organization_id, project_id, control_id, attribute_id, reason, actor),
        )
        _audit(
            cursor, organization_id, project_id, actor, "design_coverage.exception_recorded",
            "control_attribute", attribute_id,
            {"control_id": str(control_id), "reason": reason, "replaced": before is not None},
        )  # fmt: skip
        list_decided(cursor, organization_id, project_id, control_id, actor)


def clear_exception(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    attribute_id: UUID,
    actor: UUID,
) -> None:
    """A person withdraws the exception: the attribute needs a D&I request again. The
    reason withdrawn stays on the audit trail. Nothing to do when none is recorded."""
    with transaction(connection) as cursor:
        _planned(cursor, project_id, control_id)
        attribute = cursor.execute(
            "SELECT 1 FROM control_attributes WHERE id = %s AND project_id = %s "
            "AND engagement_control_id = %s",
            (attribute_id, project_id, control_id),
        ).fetchone()
        if attribute is None:
            raise NotVisible()
        removed = cursor.execute(
            "DELETE FROM design_coverage_exceptions WHERE engagement_control_id = %s "
            "AND attribute_id = %s RETURNING reason",
            (control_id, attribute_id),
        ).fetchone()
        if removed is None:
            return
        _audit(
            cursor, organization_id, project_id, actor, "design_coverage.exception_cleared",
            "control_attribute", attribute_id,
            {"control_id": str(control_id), "reason": str(removed[0]), "why": "withdrawn"},
        )  # fmt: skip
        list_decided(cursor, organization_id, project_id, control_id, actor)


# Routes


def register_design_requests(app: FastAPI, settings: Settings, scheduler: Any = None) -> None:
    control = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            # Drafts a release queued are handed to the worker once the request committed.
            return with_live_email(
                settings,
                committed(lambda: _call(settings, lambda connection: work(connection, principal))),
            )
        except PlanState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except Unprocessable as error:
            raise HTTPException(status_code=422, detail=error.detail) from None

    def allowed(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID, control_id: UUID,
    ) -> None:  # fmt: skip
        """Who may accept D&I requests (phase_release.DESIGN_ACCEPT_ACTION, the one rule
        the release reads too), on a control of that engagement. A person only: an agent
        never accepts a request or excuses an attribute."""
        authorize(
            connection, principal=principal, action=DESIGN_ACCEPT_ACTION,
            organization_id=organization_id, project_id=project_id,
        )  # fmt: skip
        if principal.kind is not PrincipalKind.USER:
            raise NotVisible()
        found = connection.execute(
            "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s "
            "AND organization_id = %s",
            (control_id, project_id, organization_id),
        ).fetchone()
        if found is None:
            raise NotVisible()
        if not found[0]:
            raise PlanState(OUT_OF_SCOPE)

    def drafted(ids: list[UUID]) -> None:
        from ai_workforce_api.pbc_drafting import schedule

        after_commit(lambda: schedule(scheduler, ids))

    def settled(
        c: psycopg.Connection[Any], p: Principal, organization_id: UUID, project_id: UUID,
        control_id: UUID,
    ) -> None:  # fmt: skip
        settle_design(c, organization_id, project_id, control_id, "REQUEST", p.id, scheduler)

    @app.post(f"{control}/design-requests/accept")
    def accept_requests(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: RequestsAccepted,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        """Accept D&I requests as they stand, one or all, all or none. When that settles
        the list, the D&I evidence is released in this request, as this person's."""

        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(accept(c, organization_id, project_id, control_id, p.id, body))
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.put(f"{control}/design-coverage/{{attribute_id}}/exception")
    def exception_record(
        organization_id: UUID, project_id: UUID, control_id: UUID, attribute_id: UUID,
        body: ExceptionBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            record_exception(c, organization_id, project_id, control_id, attribute_id, p.id, body)
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.delete(f"{control}/design-coverage/{{attribute_id}}/exception")
    def exception_clear(
        organization_id: UUID, project_id: UUID, control_id: UUID, attribute_id: UUID,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            clear_exception(c, organization_id, project_id, control_id, attribute_id, p.id)
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)
