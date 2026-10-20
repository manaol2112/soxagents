"""The engagement's one queue of work (Milestone 2a): every open obligation, read from
the records that already carry it and the rules that already decide it, each with a
stable identity, the engagement, control, phase or round it belongs to, the action and
its reason, whose it is, whether the viewer may act now and what holds it, and where in
the guided workspace it is done.

Nothing here decides anything: the approval, review, impact, readiness and whose-step
rules stay in their modules (approvals, control_reviews, plan_impact, round_readiness,
workspace.mark_yours) and are read once per request. Opening an item leads to the
record's own page, whose routes check authorization again; an item never acts.

Equivalent obligations appear once: a control's next step and the record it is about
(samples proposed, the control's own review) are the same obligation, so the more
specific item stands and the generic one is dropped. Separate obligations stay separate:
each round's review, each assessment, each request's approval, each reminder.
"""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import Action, Principal, _call, _session_principal
from ai_workforce_api.control_instances import control_label
from ai_workforce_api.settings import Settings

Bucket = Literal["MINE", "WAITING", "BLOCKED"]
Role = Literal["PREPARER", "REVIEWER", "APPROVER", "CLIENT", "OWNER", "AGENT", "NONE"]
StageKey = Literal["SETUP", "PLANS", "EVIDENCE", "TESTING", "REVIEW", "CLOSE"]

ROLE_WORDS: dict[str, str] = {
    "PREPARER": "the preparer",
    "REVIEWER": "the independent reviewer",
    "APPROVER": "an approver",
    "CLIENT": "the control owner (client)",
    "OWNER": "the engagement owner",
    "AGENT": "an agent",
    "NONE": "no one",
}

_STEP_SECTION: dict[str, str] = {
    "PLAN": "plan",
    "REQUEST": "request",
    "TEST": "test",
    "CONCLUDE": "conclude",
    "REVIEW": "review",
    "DONE": "review",
}
_STEP_STAGE: dict[str, StageKey] = {
    "PLAN": "PLANS",
    "REQUEST": "EVIDENCE",
    "TEST": "TESTING",
    "CONCLUDE": "TESTING",
    "REVIEW": "REVIEW",
    "DONE": "REVIEW",
}


class QueueSource(BaseModel):
    """The record the item is read from."""

    type: str
    id: UUID


class QueueOwner(BaseModel):
    role: Role
    # The people it is assigned to, by display name, when the records say.
    names: list[str] = Field(default_factory=list)


class QueueLink(BaseModel):
    """Where the item is done: a section and the query that opens the record there."""

    section: str
    query: dict[str, str] = Field(default_factory=dict)


class QueueItem(BaseModel):
    id: str
    kind: str
    source: QueueSource
    stage: StageKey
    control_id: UUID | None = None
    control_ref: str | None = None
    phase: str | None = None
    round_id: UUID | None = None
    round_kind: str | None = None
    # The required action, and why it is required now.
    title: str
    reason: str = ""
    owner: QueueOwner
    # Whether the viewer may do it now (the same rule the action applies), and whether
    # the record is ready for it; what holds it when not.
    authorized: bool
    ready: bool = True
    blockers: list[str] = Field(default_factory=list)
    # It holds the engagement up until settled.
    blocks: bool = False
    bucket: Bucket
    link: QueueLink
    at: datetime | None = None


class QueueBody(BaseModel):
    items: list[QueueItem]
    counts: dict[str, int]
    generated_at: datetime


class _Viewer:
    """The viewer's standing on the engagement, read once."""

    def __init__(
        self,
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
    ) -> None:
        from ai_workforce_api.control_reviews import _is_reviewer
        from ai_workforce_api.workspace import _allowed, _has_engagement_role

        self.id = principal.id
        self.prepare = _allowed(
            connection, principal, organization_id, project_id, Action.TASK_UPDATE
        )
        self.approve = _allowed(
            connection, principal, organization_id, project_id, Action.PROJECT_UPDATE
        )
        self.reviewer = _is_reviewer(connection, project_id, principal.id)
        self.preparer = _has_engagement_role(
            connection, project_id, principal.id, ("LEAD", "PREPARER")
        )
        self.prepared: set[UUID] = {
            UUID(str(row[0]))
            for row in connection.execute(
                """
                SELECT engagement_control_id FROM test_sheets
                WHERE project_id = %s AND signed_by = %s
                UNION
                SELECT engagement_control_id FROM workpapers
                WHERE project_id = %s AND prepared_by = %s
                """,
                (project_id, principal.id, project_id, principal.id),
            ).fetchall()
        }

    def may_prepare(self, assignees: set[UUID] | None) -> bool:
        if not self.prepare:
            return False
        return self.id in assignees if assignees else self.preparer

    def may_review(self, control_id: UUID) -> bool:
        from ai_workforce_api import independence

        return self.reviewer and not (independence.required() and control_id in self.prepared)


def _revision(value: int | None) -> str:
    return "(not recorded)" if value is None else str(value)


def _round_word(kind: str) -> str:
    return "retest" if kind == "RETEST" else "roll-forward"


def _bucket(authorized: bool, ready: bool, role: str) -> Bucket:
    if authorized and ready:
        return "MINE"
    if not ready or role == "NONE":
        return "BLOCKED"
    return "WAITING"


def _control_link(control_id: UUID, step: str) -> QueueLink:
    return QueueLink(
        section="controls",
        query={"control": str(control_id), "step": _STEP_SECTION.get(step, "plan")},
    )


# The control's next step and the record it is about are one obligation: the specific
# item stands, the generic one is dropped.
_STEP_TO_KIND: tuple[tuple[str, str], ...] = (
    ("Approve the samples", "samples"),
    ("Decide the reviewer's notes", "review"),
    ("Answer the review notes", "review"),
    ("Clear the answered notes", "review"),
    ("Sign off the review", "review"),
    ("Decide the impact", "impact"),
    ("Confirm the round's testing basis", "round-basis"),
)


def queue(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> QueueBody:
    """Every open obligation of the engagement for this viewer, authorized once."""
    from ai_workforce_api.workspace import _authorize, _controls

    _authorize(connection, principal, organization_id, project_id, Action.TASK_READ)
    viewer = _Viewer(connection, principal, organization_id, project_id)
    items: list[QueueItem] = []
    row = connection.execute(
        "SELECT status FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    launched = row is not None and str(row[0]) != "DRAFT"
    if not launched:
        items.append(
            QueueItem(
                id=f"setup:{project_id}",
                kind="setup",
                source=QueueSource(type="project", id=project_id),
                stage="SETUP",
                title="Finish setting up the engagement, then launch it",
                reason="The agents start once it is launched.",
                owner=QueueOwner(role="OWNER"),
                authorized=viewer.approve,
                blocks=True,
                bucket=_bucket(viewer.approve, True, "OWNER"),
                link=QueueLink(section="setup"),
            )
        )
        return _finish(items)

    controls = {c.id: c for c in _controls(connection, principal, organization_id, project_id)}
    refs = {cid: c.control_ref for cid, c in controls.items()}
    assigned: dict[UUID, set[UUID]] = {}
    for control_id, user_id in connection.execute(
        """
        SELECT engagement_control_id, assignee_user_id FROM tasks
        WHERE project_id = %s AND engagement_control_id IS NOT NULL
          AND assignee_user_id IS NOT NULL AND status NOT IN ('SUCCEEDED', 'CANCELLED')
        """,
        (project_id,),
    ).fetchall():
        assigned.setdefault(UUID(str(control_id)), set()).add(UUID(str(user_id)))

    items += _approvals(connection, project_id, viewer)
    items += _impact(connection, principal, organization_id, project_id, viewer, refs)
    items += _reviews(connection, project_id, viewer, refs)
    rounds_by_id, items_rounds = _rounds(connection, project_id, viewer, refs, assigned)
    items += items_rounds
    items += _samples(connection, project_id, viewer, refs, assigned, rounds_by_id, controls)
    items += _runs(connection, project_id, viewer, refs, assigned)
    items += _requests(connection, project_id, viewer, refs, controls)
    items += _reminders(connection, project_id, viewer, refs)
    items += _replies(connection, project_id, viewer)
    items += _tasks(connection, project_id, viewer, refs)

    specific: dict[tuple[UUID, str], bool] = {}
    for item in items:
        if item.control_id is not None:
            specific[(item.control_id, item.kind)] = True
    # A plan task "ready for review" on a control whose review is itself listed is the
    # same obligation seen from the schedule: the review item stands.
    items = [
        item
        for item in items
        if not (
            item.kind == "task"
            and item.ready
            and item.control_id is not None
            and specific.get((item.control_id, "review"))
        )
    ]
    for control in controls.values():
        if not control.included or control.progress == "CONCLUDED" or control.drafted:
            continue
        if control.next_step == "" or control.actor == "NONE":
            continue
        step = control.journey.step if control.journey is not None else "PLAN"
        phase = control.journey.step_phase if control.journey is not None else None
        same = next(
            (kind for prefix, kind in _STEP_TO_KIND if control.next_step.startswith(prefix)),
            None,
        )
        if same is not None and specific.get((control.id, same)):
            continue
        role: Role = control.actor if control.actor in ROLE_WORDS else "NONE"
        ready = control.readiness_state not in ("IMPACT_PENDING", "CONFLICT_REQUIRES_REVIEW")
        blockers = [control.readiness_blocker] if control.readiness_blocker and not ready else []
        if control.journey is not None and control.journey.blockers and role == "CLIENT":
            blockers = list(control.journey.blockers[:2])
        items.append(
            QueueItem(
                id=f"control-step:{control.id}",
                kind="control-step",
                source=QueueSource(type="control", id=control.id),
                stage=_STEP_STAGE.get(step, "TESTING"),
                control_id=control.id,
                control_ref=control.control_ref,
                phase=phase,
                title=control.next_step,
                reason=(
                    control.journey.not_final_because[0]
                    if control.journey is not None
                    and control.journey.not_final_because
                    and step in ("CONCLUDE", "REVIEW", "DONE")
                    else ("Overdue" if control.overdue else "")
                ),
                owner=QueueOwner(role=role, names=list(control.assignees)),
                authorized=control.yours,
                ready=ready,
                blockers=blockers,
                blocks=control.readiness_state == "PLAN_NOT_APPROVED" and step == "PLAN",
                bucket=_bucket(control.yours, ready, role),
                link=_control_link(control.id, step),
            )
        )
    return _finish(items)


def _finish(items: list[QueueItem]) -> QueueBody:
    seen: set[str] = set()
    unique: list[QueueItem] = []
    for item in items:
        if item.id in seen:
            continue
        seen.add(item.id)
        unique.append(item)
    order: dict[str, int] = {"MINE": 0, "BLOCKED": 1, "WAITING": 2}
    stage_order = {key: index for index, key in enumerate(StageKey.__args__)}  # type: ignore[attr-defined]
    unique.sort(
        key=lambda item: (
            order[item.bucket],
            not item.blocks,
            stage_order.get(item.stage, 9),
            item.control_ref or "~",
            item.title,
        )
    )
    counts = {bucket: sum(1 for item in unique if item.bucket == bucket) for bucket in order}
    return QueueBody(items=unique, counts=counts, generated_at=datetime.now(UTC))


def _approvals(
    connection: psycopg.Connection[Any], project_id: UUID, viewer: _Viewer
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT a.id, a.action_id, a.parameters->>'subject', u.display_name, a.target_resource,
               a.requesting_user_id, a.created_at, c.id, c.control_ref
        FROM approvals a
        JOIN users u ON u.id = a.requesting_user_id
        LEFT JOIN pbc_requests r
          ON r.project_id = a.project_id
         AND r.id::text = split_part(a.parameters ->> 'request_ref', '/', 2)
        LEFT JOIN engagement_controls c ON c.id = r.engagement_control_id
        WHERE a.project_id = %s AND a.decision = 'PENDING' AND a.expires_at > clock_timestamp()
        ORDER BY a.created_at
        """,
        (project_id,),
    ).fetchall():
        requester = UUID(str(row[5]))
        authorized = viewer.approve and requester != viewer.id
        found.append(
            QueueItem(
                id=f"approval:{row[0]}",
                kind="approval",
                source=QueueSource(type="approval", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=None if row[7] is None else UUID(str(row[7])),
                control_ref=None if row[8] is None else str(row[8]),
                title=f"Approve: {row[2] or str(row[1]).replace('.', ' ')}",
                reason=f"Asked by {row[3]}; the requester never approves their own request.",
                owner=QueueOwner(role="APPROVER"),
                authorized=authorized,
                bucket=_bucket(authorized, True, "APPROVER"),
                link=QueueLink(section="approvals"),
                at=row[6],
            )
        )
    return found


def _impact(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
) -> list[QueueItem]:
    from ai_workforce_api.plan_impact import assessments

    found: list[QueueItem] = []
    for body in assessments(connection, principal, organization_id, project_id):
        if body.status != "PENDING":
            continue
        found.append(
            QueueItem(
                id=f"impact:{body.id}",
                kind="impact",
                source=QueueSource(type="plan_impact_assessment", id=body.id),
                stage="PLANS",
                control_id=body.control_id,
                control_ref=refs.get(body.control_id, body.control_ref),
                phase=body.round_kind or "INTERIM",
                round_id=body.test_round_id,
                round_kind=body.round_kind,
                title="Decide the impact of the plan revision on the signed-off results",
                reason=(
                    f"Signed off under revision {_revision(body.from_revision)}; the plan is "
                    f"now at revision {body.to_revision}. Nothing relies on them until decided."
                ),
                owner=QueueOwner(role="REVIEWER"),
                authorized=body.viewer_can_decide,
                blocks=True,
                bucket=_bucket(body.viewer_can_decide, True, "REVIEWER"),
                link=_control_link(body.control_id, "PLAN"),
                at=body.signed_at,
            )
        )
    return found


def _reviews(
    connection: psycopg.Connection[Any], project_id: UUID, viewer: _Viewer, refs: dict[UUID, str]
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT r.id, r.engagement_control_id, r.test_round_id, t.kind, r.reperform_status,
               r.reperformed_at,
               count(*) FILTER (WHERE n.status = 'PROPOSED'),
               count(*) FILTER (WHERE n.status = 'OPEN'),
               count(*) FILTER (WHERE n.status = 'RESPONDED'),
               r.created_at, c.control_ref, a.name
        FROM control_reviews r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN test_rounds t ON t.id = r.test_round_id
        LEFT JOIN review_notes n ON n.control_review_id = r.id
        WHERE r.project_id = %s AND r.status = 'OPEN'
        GROUP BY r.id, t.kind, c.control_ref, a.name
        ORDER BY r.created_at
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[1]))
        proposed, open_, responded = int(row[6]), int(row[7]), int(row[8])
        round_kind = None if row[3] is None else str(row[3])
        label = control_label(str(row[10]), None if row[11] is None else str(row[11]))
        what = (
            label
            if round_kind is None
            else f"the {round_kind.lower().replace('rollforward', 'roll-forward')} round of {label}"
        )
        if row[4] != "IDLE":
            title, reason, role = (
                "Re-performance queued for the reviewer agent",
                "The review opens for decisions once the agent has re-performed the testing.",
                "AGENT",
            )
            ready = False
        elif proposed:
            title, reason, role = (
                f"Decide {proposed} reviewer note{'' if proposed == 1 else 's'} on {what}",
                "Proposed by the reviewer agent; a person accepts or dismisses each.",
                "REVIEWER",
            )
            ready = True
        elif open_:
            title, reason, role = (
                f"Answer {open_} review note{'' if open_ == 1 else 's'} on {what}",
                "Open for the preparer to answer.",
                "PREPARER",
            )
            ready = True
        elif responded:
            title, reason, role = (
                f"Clear {responded} answered note{'' if responded == 1 else 's'} on {what}",
                "Answered by the preparer; the reviewer clears or keeps each.",
                "REVIEWER",
            )
            ready = True
        elif row[5] is not None:
            title, reason, role = (
                f"Sign off the review of {what}",
                "Every note is cleared.",
                "REVIEWER",
            )
            ready = True
        else:
            title, reason, role = (
                "Re-perform the testing for the review",
                "The reviewer agent has not re-performed yet; a person starts it.",
                "REVIEWER",
            )
            ready = True
        authorized = (
            viewer.may_review(control_id)
            if role == "REVIEWER"
            else viewer.may_prepare(None)
            if role == "PREPARER"
            else False
        )
        found.append(
            QueueItem(
                id=f"review:{row[0]}",
                kind="review",
                source=QueueSource(type="control_review", id=UUID(str(row[0]))),
                stage="REVIEW",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=round_kind or "INTERIM",
                round_id=None if row[2] is None else UUID(str(row[2])),
                round_kind=round_kind,
                title=title,
                reason=reason,
                owner=QueueOwner(role=role),  # type: ignore[arg-type]
                authorized=authorized,
                ready=ready,
                blockers=[] if ready else [reason],
                bucket=_bucket(authorized, ready, role),
                link=_control_link(control_id, "REVIEW"),
                at=row[9],
            )
        )
    return found


def _rounds(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
) -> tuple[dict[UUID, Any], list[QueueItem]]:
    from ai_workforce_api.test_rounds import rounds

    by_id: dict[UUID, Any] = {}
    found: list[QueueItem] = []
    for item in rounds(connection, project_id):
        by_id[item.id] = item
        if item.status not in ("REQUESTED", "TESTING") or item.basis is None:
            continue
        if not item.basis.stale:
            continue
        authorized = viewer.may_prepare(assigned.get(item.control_id))
        reconstructed = item.basis.source == "RECONSTRUCTED"
        found.append(
            QueueItem(
                id=f"round-basis:{item.id}",
                kind="round-basis",
                source=QueueSource(type="test_round", id=item.id),
                stage="TESTING",
                control_id=item.control_id,
                control_ref=refs.get(item.control_id, item.control_ref),
                phase=item.kind,
                round_id=item.id,
                round_kind=item.kind,
                title=f"Confirm the testing basis of the {_round_word(item.kind)} round",
                reason=(
                    "The basis was reconstructed when basis records were introduced, "
                    "not approved at the time."
                    if reconstructed
                    else f"The test plan moved to revision {item.basis.current_plan_revision} "
                    f"after the basis was set at revision {item.basis.plan_revision}."
                ),
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                blocks=True,
                bucket=_bucket(authorized, True, "PREPARER"),
                link=_control_link(item.control_id, "TEST"),
            )
        )
    return by_id, found


def _samples(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
    rounds_by_id: dict[UUID, Any],
    controls: dict[UUID, Any],
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT t.id, t.engagement_control_id, t.sample_size, t.test_round_id, t.created_at
        FROM control_tests t
        WHERE t.project_id = %s AND t.status = 'PROPOSED'
        ORDER BY t.created_at
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[1]))
        round_id = None if row[3] is None else UUID(str(row[3]))
        round_body = rounds_by_id.get(round_id) if round_id is not None else None
        blockers = (
            list(round_body.readiness_blockers)
            if round_body is not None and round_body.readiness_state == "NOT_READY"
            else []
        )
        control = controls.get(control_id)
        if round_body is None and control is not None and control.population_pending:
            # Samples come only from a population a person accepted as complete.
            blockers.append("Accept the population on the evidence plan first")
        ready = not blockers
        authorized = viewer.may_prepare(assigned.get(control_id))
        found.append(
            QueueItem(
                id=f"samples:{row[0]}",
                kind="samples",
                source=QueueSource(type="control_test", id=UUID(str(row[0]))),
                stage="TESTING",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=round_body.kind if round_body is not None else "INTERIM",
                round_id=round_id,
                round_kind=round_body.kind if round_body is not None else None,
                title="Approve the samples",
                reason=(
                    f"{int(row[2])} samples proposed by the tester; testing starts only after "
                    "a person approves them."
                ),
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                ready=ready,
                blockers=blockers,
                bucket=_bucket(authorized, ready, "PREPARER"),
                link=_control_link(control_id, "TEST"),
                at=row[4],
            )
        )
    return found


def _runs(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT s.id, s.engagement_control_id, s.run_note, r.kind, s.test_round_id
        FROM test_sheets s LEFT JOIN test_rounds r ON r.id = s.test_round_id
        WHERE s.project_id = %s AND s.status = 'OPEN' AND s.run_note <> ''
          AND s.run_status = 'IDLE'
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[1]))
        authorized = viewer.may_prepare(assigned.get(control_id))
        found.append(
            QueueItem(
                id=f"run-stopped:{row[0]}",
                kind="run-stopped",
                source=QueueSource(type="test_sheet", id=UUID(str(row[0]))),
                stage="TESTING",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=None if row[3] is None else str(row[3]),
                round_id=None if row[4] is None else UUID(str(row[4])),
                round_kind=None if row[3] is None else str(row[3]),
                title="Run the tester again",
                reason=str(row[2]),
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                bucket=_bucket(authorized, True, "PREPARER"),
                link=_control_link(control_id, "TEST"),
            )
        )
    return found


def _requests(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    controls: dict[UUID, Any],
) -> list[QueueItem]:
    from ai_workforce_api.evidence_plans import reconcile_waiting, unplanned_controls

    held_controls = set(unplanned_controls(connection, project_id))
    held_controls |= reconcile_waiting(connection, project_id)
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, engagement_control_id, operation_key, recipient, testing_phase, created_at
        FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT'
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[1]))
        held = control_id in held_controls and str(row[2]).startswith(("kickoff-", "scope-"))
        unaddressed = str(row[3] or "").strip() == ""
        blockers: list[str] = []
        if held:
            blockers.append("Plan the evidence, then reconcile the kickoff draft with its plan")
        elif unaddressed:
            blockers.append("Assign the evidence coordinator or the control owner's address")
        ready = not blockers
        found.append(
            QueueItem(
                id=f"request-draft:{row[0]}",
                kind="request-draft",
                source=QueueSource(type="pbc_request", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=None if row[4] is None else str(row[4]),
                title="Review and approve the drafted evidence request",
                reason=(
                    "Drafted by the evidence coordinator; an approver checks the exact message "
                    "before it is sent."
                ),
                owner=QueueOwner(role="APPROVER"),
                authorized=viewer.approve,
                ready=ready,
                blockers=blockers,
                bucket=_bucket(viewer.approve, ready, "APPROVER"),
                link=QueueLink(
                    section="controls",
                    query={"control": str(control_id), "step": "request", "request": str(row[0])},
                ),
                at=row[5],
            )
        )
    return found


def _reminders(
    connection: psycopg.Connection[Any], project_id: UUID, viewer: _Viewer, refs: dict[UUID, str]
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT f.id, f.sequence, f.due_at, r.engagement_control_id, r.id, r.recipient
        FROM pbc_follow_ups f JOIN pbc_requests r ON r.id = f.pbc_request_id
        WHERE r.project_id = %s AND f.status = 'DUE' AND f.due_at <= clock_timestamp()
        ORDER BY f.due_at
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[3]))
        found.append(
            QueueItem(
                id=f"reminder:{row[0]}",
                kind="reminder",
                source=QueueSource(type="pbc_follow_up", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=control_id,
                control_ref=refs.get(control_id),
                title=f"Approve reminder {int(row[1])} to the evidence owner",
                reason=f"Due; it goes to {row[5]} once approved.",
                owner=QueueOwner(role="APPROVER"),
                authorized=viewer.approve,
                bucket=_bucket(viewer.approve, True, "APPROVER"),
                link=QueueLink(
                    section="evidence", query={"tab": "requests", "request": str(row[4])}
                ),
                at=row[2],
            )
        )
    return found


def _replies(
    connection: psycopg.Connection[Any], project_id: UUID, viewer: _Viewer
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT m.id, m.subject, m.sender, m.review_state, m.match_status, m.unmatched_reason,
               r.engagement_control_id, m.created_at
        FROM inbound_messages m LEFT JOIN pbc_requests r ON r.id = m.pbc_request_id
        WHERE m.project_id = %s
          AND (m.review_state = 'NEEDS_REVIEW' OR m.match_status = 'UNMATCHED')
        ORDER BY m.created_at
        """,
        (project_id,),
    ).fetchall():
        unmatched = str(row[4]) == "UNMATCHED"
        found.append(
            QueueItem(
                id=f"reply:{row[0]}",
                kind="reply",
                source=QueueSource(type="inbound_message", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=None if row[6] is None else UUID(str(row[6])),
                title=(
                    f"Match the email from {row[2]}"
                    if unmatched
                    else f"Read the reply from {row[2]}"
                ),
                reason=(
                    f"{str(row[5] or 'no request matched').replace('_', ' ').lower()}"
                    if unmatched
                    else f"Subject: {row[1] or '(no subject)'}"
                ),
                owner=QueueOwner(role="PREPARER"),
                authorized=viewer.may_prepare(None),
                bucket=_bucket(viewer.may_prepare(None), True, "PREPARER"),
                link=QueueLink(section="evidence", query={"tab": "mailbox"}),
                at=row[7],
            )
        )
    return found


def _tasks(
    connection: psycopg.Connection[Any], project_id: UUID, viewer: _Viewer, refs: dict[UUID, str]
) -> list[QueueItem]:
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, title, status::text, engagement_control_id, assignee_user_id, created_at
        FROM tasks WHERE project_id = %s AND status IN ('BLOCKED', 'REVIEW')
        ORDER BY status, created_at
        """,
        (project_id,),
    ).fetchall():
        blocked = str(row[2]) == "BLOCKED"
        control_id = None if row[3] is None else UUID(str(row[3]))
        assignees = {UUID(str(row[4]))} if row[4] is not None else None
        authorized = viewer.may_prepare(assignees)
        found.append(
            QueueItem(
                id=f"task:{row[0]}",
                kind="task",
                source=QueueSource(type="task", id=UUID(str(row[0]))),
                stage="TESTING",
                control_id=control_id,
                control_ref=None if control_id is None else refs.get(control_id),
                title=str(row[1]),
                reason="Blocked until someone clears it" if blocked else "Ready for review",
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                ready=not blocked,
                blockers=["Blocked until someone clears it"] if blocked else [],
                bucket=_bucket(authorized, not blocked, "PREPARER"),
                link=QueueLink(section="plan"),
                at=row[5],
            )
        )
    return found


def register_queue(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/queue")
    def read(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        bucket: str | None = Query(default=None, pattern="^(MINE|WAITING|BLOCKED)$"),
        stage: str | None = Query(default=None, pattern="^[A-Z]{4,8}$"),
        phase: str | None = Query(default=None, pattern="^[A-Z]{5,12}$"),
        control: UUID | None = None,
    ) -> QueueBody:
        principal = _session_principal(request)
        try:
            body = _call(
                settings,
                lambda connection: queue(connection, principal, organization_id, project_id),
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        # Filters narrow what is listed; they never widen what the viewer may see or do.
        items = [
            item
            for item in body.items
            if (bucket is None or item.bucket == bucket)
            and (stage is None or item.stage == stage)
            and (phase is None or item.phase == phase)
            and (control is None or item.control_id == control)
        ]
        return QueueBody(items=items, counts=body.counts, generated_at=body.generated_at)
