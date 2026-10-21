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

Four buckets (M2b): MINE, the viewer may do it now; WAITING, someone else's turn, an
ordinary wait on a person; BLOCKED, a prerequisite is unmet or no one can act (no worker
for queued agent work, a task a person must unblock); UPCOMING, nothing is due yet (a
phase not released, a retest window not reached, agent work queued for a worker). Every
item carries an obligation code so the mapping from each obligation to its one item can
be checked (docs/milestone-2-plan.md §12).
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

Bucket = Literal["MINE", "WAITING", "BLOCKED", "UPCOMING"]
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
    # The obligation type the item represents (one code per obligation, §12).
    obligation: str = "CONTROL_STEP"
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
    # How many items match the filters, before any page is cut.
    total: int = 0
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


def _bucket(authorized: bool, ready: bool, role: str, upcoming: bool = False) -> Bucket:
    """MINE when the viewer may act and the record is ready; UPCOMING when nothing is
    due yet; BLOCKED when a prerequisite is unmet or no one can act; otherwise WAITING,
    an ordinary wait on the person whose turn it is."""
    if upcoming:
        return "UPCOMING"
    if authorized and ready:
        return "MINE"
    if not ready or role == "NONE":
        return "BLOCKED"
    return "WAITING"


# Holds that lift by themselves with time or a release, not by anyone's action now.
_UPCOMING_HOLDS = ("Not released yet", "must operate until")


def _upcoming_holds(blockers: list[str]) -> list[str]:
    """The holds among the blockers that lift only with time or a release: while one
    stands, nothing on the item is due, whatever else is also outstanding."""
    return [b for b in blockers if any(hold in b for hold in _UPCOMING_HOLDS)]


NO_WORKER = "Automation unavailable: no worker is configured to run the queued agent work"


def _agent_turn(automated: bool) -> tuple[Bucket, list[str]]:
    """Queued agent work: upcoming while a worker will pick it up, blocked when none."""
    return ("UPCOMING", []) if automated else ("BLOCKED", [NO_WORKER])


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
    ("Address the review notes", "review"),
    ("Clear the answered review notes", "review"),
    ("Sign off the review", "review"),
    ("Re-perform the testing for review", "review"),
    ("The reviewer is re-performing", "review"),
    ("Independent review", "review"),
    ("Decide the impact", "impact"),
    ("Confirm the round's testing basis", "round-basis"),
    ("Retest outstanding", "deficiency"),
    # Approving a submitted request is the approval record's item; a stopped tester
    # run, the sheet's; chasing an overdue request, the due reminder's; preparing a
    # workpaper whose draft stopped, the draft's.
    ("Approve the evidence request", "approval"),
    ("Approve the sample request", "approval"),
    ("Approve the follow-up", "approval"),
    ("Testing stopped", "run-stopped"),
    ("Chase the overdue", "request-overdue"),
    ("Chase the overdue", "reminder"),
    ("Prepare the workpapers", "draft-stopped"),
)
# Finality reasons that are a coverage assessment (control_journey.coverage_gaps).
_COVERAGE_TEXTS = (
    "since the review covered it",
    "since its review covered it",
    "did not record the testing version",
)

# The obligation a control's next step represents, by its wording (workspace.step_of,
# control_reviews.REVIEW_STEPS, control_journey.finality).
_STEP_OBLIGATIONS: tuple[tuple[str, str], ...] = (
    ("Plan the evidence", "EVIDENCE_PLAN"),
    ("Reconcile the kickoff", "EVIDENCE_PLAN"),
    ("Revise the test plan", "PLAN_APPROVAL"),
    ("Approve the test plan", "PLAN_APPROVAL"),
    ("Test plan not approved", "PLAN_APPROVAL"),
    ("Settle the attributes", "PLAN_ATTRIBUTES"),
    ("Release the", "PHASE_RELEASE"),
    ("Request evidence", "EVIDENCE_REQUEST"),
    ("Submit the", "EVIDENCE_REQUEST"),
    ("Send the approved", "EVIDENCE_REQUEST"),
    ("Approve the samples", "SAMPLES_APPROVAL"),
    ("Approve the", "REQUEST_APPROVAL"),
    ("Chase the overdue", "EVIDENCE_RECEIPT"),
    ("Waiting for", "EVIDENCE_RECEIPT"),
    ("Link the sample evidence", "EVIDENCE_RECEIPT"),
    ("Confirm the population", "POPULATION"),
    ("Accept the population", "POPULATION"),
    ("Test the evidence", "TESTING_RUN"),
    ("Testing stopped", "TESTING_RUN_STOPPED"),
    ("Finish the", "TESTING_RUN"),
    ("testing in progress", "TESTING_RUN"),
    ("testing outstanding", "TESTING_RUN"),
    ("Decide the open test results", "TESTING_DECISION"),
    ("Sign off the testing", "TESTING_SIGNOFF"),
    ("testing not signed off", "TESTING_SIGNOFF"),
    ("Log the proposed deficiency", "DEFICIENCY_LOG"),
    ("Prepare the workpapers", "WORKPAPERS"),
    ("Retest outstanding", "DEFICIENCY_RETEST"),
    ("Roll-forward testing outstanding", "ROUND_OUTSTANDING"),
    ("impact assessment", "IMPACT_ASSESSMENT"),
    ("Decide the impact", "IMPACT_ASSESSMENT"),
    ("Confirm the round's testing basis", "ROUND_BASIS"),
)


# A step whose obligation is one of these restates the record's own item when that
# item exists on the control (semantic deduplication, M2c).
_OBLIGATION_KINDS: dict[str, str] = {
    "IMPACT_ASSESSMENT": "impact",
    "COVERAGE_ASSESSMENT": "coverage",
    "ROUND_BASIS": "round-basis",
    "SAMPLES_APPROVAL": "samples",
    "TESTING_RUN_STOPPED": "run-stopped",
    "REQUEST_APPROVAL": "approval",
    "DEFICIENCY_RETEST": "deficiency",
    "WORKPAPER_DRAFT_STOPPED": "draft-stopped",
}


def _step_obligation(text: str) -> str:
    if any(mark in text for mark in _COVERAGE_TEXTS):
        return "COVERAGE_ASSESSMENT"
    for mark, code in _STEP_OBLIGATIONS:
        if text.startswith(mark) or (mark[0].islower() and mark in text):
            return code
    if "review" in text.lower():
        return "CONTROL_REVIEW"
    return "CONTROL_STEP"


def queue(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    automated: bool = True,
    settings: Settings | None = None,
) -> QueueBody:
    """Every open obligation of the engagement for this viewer, authorized once.
    `automated` says whether a worker exists for queued agent work (workspace
    .automation_of): without one, queued agent turns are blocked, not upcoming.
    `settings` lets a drafted request's readiness be read with the approval endpoint's
    own rule (recipient allowlist, planning hold, quality checks); without it, only the
    record's own facts hold an item."""
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
                obligation="SETUP",
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
    items += _reviews(connection, project_id, viewer, refs, automated)
    items += _coverage(connection, project_id, viewer, refs, controls)
    rounds_by_id, items_rounds = _rounds(connection, project_id, viewer, refs, assigned)
    items += items_rounds
    items += _samples(connection, project_id, viewer, refs, assigned, rounds_by_id, controls)
    items += _runs(connection, project_id, viewer, refs, assigned)
    items += _drafts(connection, project_id, viewer, refs, assigned)
    items += _evidence_reviews(connection, project_id, viewer, refs, assigned)
    items += _deficiencies(connection, project_id, viewer, refs, assigned, rounds_by_id)
    items += _overdue(connection, project_id, viewer, refs, assigned)
    items += _requests(
        connection, organization_id, project_id, viewer, refs, controls, assigned, settings
    )
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
    # A round's window item stands only when nothing else on the round carries the hold.
    rounds_held = {
        item.round_id
        for item in items
        if item.round_id is not None and item.kind in ("samples", "round-basis")
    }
    items = [item for item in items if not (item.kind == "round" and item.round_id in rounds_held)]
    for control in controls.values():
        if not control.included or control.progress == "CONCLUDED" or control.drafted:
            continue
        step = control.journey.step if control.journey is not None else "PLAN"
        phase = control.journey.step_phase if control.journey is not None else None
        if control.next_step == "" or control.actor == "NONE":
            items += _finality(control, step, specific)
            continue
        same = next(
            (kind for prefix, kind in _STEP_TO_KIND if control.next_step.startswith(prefix)),
            None,
        )
        if same is None and any(mark in control.next_step for mark in _COVERAGE_TEXTS):
            same = "coverage"
        obligation = _step_obligation(control.next_step)
        if same is None:
            # The step's obligation class names a record kind (an impact assessment
            # pending, a stale basis, a stopped run): the record's item stands.
            same = _OBLIGATION_KINDS.get(obligation)
        if same is not None and specific.get((control.id, same)):
            continue
        role: Role = control.actor if control.actor in ROLE_WORDS else "NONE"
        ready = control.readiness_state not in ("IMPACT_PENDING", "CONFLICT_REQUIRES_REVIEW")
        blockers = [control.readiness_blocker] if control.readiness_blocker and not ready else []
        journey_blockers = list(control.journey.blockers) if control.journey is not None else []
        if journey_blockers and role == "CLIENT":
            blockers = journey_blockers[:2]
        # The holds on the step's own phase (never another phase's): the phase is not
        # released, or the retest window has not opened, so nothing is due on it yet.
        # Releasing the phase is itself an action, never upcoming.
        phase_blockers = (
            next(
                (list(p.blockers) for p in control.journey.phases if p.phase == phase),
                [],
            )
            if control.journey is not None and phase is not None
            else []
        )
        holds = _upcoming_holds(phase_blockers) if obligation != "PHASE_RELEASE" else []
        upcoming = False
        if role == "AGENT":
            # The records say it is an agent's turn: queued for a worker, or none exists.
            bucket, held = _agent_turn(automated)
            upcoming = bucket == "UPCOMING"
            ready = ready and not held
            blockers = blockers + held
        elif ready and holds:
            upcoming = True
            blockers = holds
            # The step carries the hold: the round's own window item is not repeated.
            items = [
                i
                for i in items
                if not (i.kind == "round" and i.control_id == control.id and i.phase == phase)
            ]
        items.append(
            QueueItem(
                id=f"control-step:{control.id}",
                kind="control-step",
                obligation=obligation,
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
                bucket=_bucket(control.yours, ready, role, upcoming),
                link=_control_link(control.id, step),
            )
        )
    return _finish(items)


def _finality(control: Any, step: str, specific: dict[tuple[UUID, str], bool]) -> list[QueueItem]:
    """A control with no step open today that is not final: what remains before its
    completion (a round or phase not yet due), listed once as upcoming, unless the
    remaining work is already an item of its own."""
    journey = control.journey
    if journey is None or control.final or not journey.not_final_because:
        return []
    if any(key[0] == control.id for key in specific):
        return []
    text = journey.not_final_because[0]
    return [
        QueueItem(
            id=f"finality:{control.id}",
            kind="finality",
            obligation="FINAL_COMPLETION",
            source=QueueSource(type="control", id=control.id),
            stage=_STEP_STAGE.get(step, "REVIEW"),
            control_id=control.id,
            control_ref=control.control_ref,
            phase=journey.step_phase,
            title=text,
            reason="Keeps the conclusion open; no action is due on it today.",
            owner=QueueOwner(role="NONE"),
            authorized=False,
            ready=False,
            blockers=[text],
            bucket="UPCOMING",
            link=_control_link(control.id, step),
        )
    ]


def _finish(items: list[QueueItem]) -> QueueBody:
    seen: set[str] = set()
    unique: list[QueueItem] = []
    for item in items:
        if item.id in seen:
            continue
        seen.add(item.id)
        unique.append(item)
    order: dict[str, int] = {"MINE": 0, "BLOCKED": 1, "WAITING": 2, "UPCOMING": 3}
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
    return QueueBody(items=unique, counts=counts, total=len(unique), generated_at=datetime.now(UTC))


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
                obligation=(
                    "SEND_APPROVAL" if str(row[1]).startswith("mail.") else "ACTION_APPROVAL"
                ),
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
                obligation="IMPACT_ASSESSMENT",
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
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    automated: bool,
) -> list[QueueItem]:
    from ai_workforce_api.control_reviews import REPERFORM_FAILED

    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT r.id, r.engagement_control_id, r.test_round_id, t.kind, r.reperform_status,
               r.reperformed_at,
               count(*) FILTER (WHERE n.status = 'PROPOSED'),
               count(*) FILTER (WHERE n.status = 'OPEN'),
               count(*) FILTER (WHERE n.status = 'RESPONDED'),
               r.created_at, c.control_ref, a.name, r.reperform_note
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
        obligation = "CONTROL_REVIEW" if round_kind is None else "ROUND_REVIEW"
        upcoming = False
        held: list[str] = []
        if row[4] != "IDLE":
            title, reason, role = (
                "Re-performance queued for the reviewer agent",
                "The review opens for decisions once the agent has re-performed the testing.",
                "AGENT",
            )
            bucket, held = _agent_turn(automated)
            upcoming = bucket == "UPCOMING"
            ready = False
        elif row[5] is None and str(row[12]) == REPERFORM_FAILED:
            title, reason, role = (
                "Re-perform the testing for the review again",
                REPERFORM_FAILED,
                "REVIEWER",
            )
            obligation = "REPERFORMANCE_STOPPED"
            ready = True
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
                obligation=obligation,
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
                blockers=held if ready or upcoming else held or [reason],
                bucket=_bucket(authorized, ready, role, upcoming),
                link=_control_link(control_id, "REVIEW"),
                at=row[9],
            )
        )
    return found


def _coverage(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    controls: dict[UUID, Any],
) -> list[QueueItem]:
    """A signed-off review whose coverage of later work is unassessed: the reviewer
    documents that it covers the current versions, or that a review is required
    (control_reviews.assess_coverage); the gap is the journey's own finding."""
    gaps: dict[UUID, list[Any]] = {}
    for control in controls.values():
        if control.journey is None or control.final:
            continue
        for reason in control.not_final:
            if reason.kind == "REVIEW" and any(mark in reason.text for mark in _COVERAGE_TEXTS):
                gaps.setdefault(control.id, []).append(reason)
    if not gaps:
        return []
    signed: dict[tuple[UUID, str | None], tuple[UUID, Any]] = {}
    for row in connection.execute(
        """
        SELECT DISTINCT ON (r.engagement_control_id, t.kind)
               r.id, r.engagement_control_id, t.kind, r.signed_at, r.test_round_id
        FROM control_reviews r LEFT JOIN test_rounds t ON t.id = r.test_round_id
        WHERE r.project_id = %s AND r.status = 'SIGNED_OFF'
        ORDER BY r.engagement_control_id, t.kind, r.signed_at DESC
        """,
        (project_id,),
    ).fetchall():
        kind = None if row[2] is None else str(row[2])
        signed[(UUID(str(row[1])), kind)] = (UUID(str(row[0])), row)
    found: list[QueueItem] = []
    for control_id, reasons in gaps.items():
        done: set[UUID] = set()
        for reason in reasons:
            phase = str(reason.phase) if reason.phase is not None else "INTERIM"
            kind = phase if phase in ("ROLLFORWARD", "RETEST") else None
            match = signed.get((control_id, kind))
            if match is None or match[0] in done:
                continue
            review_id, row = match
            done.add(review_id)
            authorized = viewer.may_review(control_id)
            found.append(
                QueueItem(
                    id=f"coverage:{review_id}",
                    kind="coverage",
                    obligation="COVERAGE_ASSESSMENT",
                    source=QueueSource(type="control_review", id=review_id),
                    stage="REVIEW",
                    control_id=control_id,
                    control_ref=refs.get(control_id),
                    phase=phase,
                    round_id=None if row[4] is None else UUID(str(row[4])),
                    round_kind=kind,
                    title="Assess whether the signed-off review covers the current work",
                    reason=f"{reason.text}. The reviewer records that it covers the current "
                    "versions, or that a review is required.",
                    owner=QueueOwner(role="REVIEWER"),
                    authorized=authorized,
                    blocks=True,
                    bucket=_bucket(authorized, True, "REVIEWER"),
                    link=_control_link(control_id, "REVIEW"),
                    at=row[3],
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
        if item.status not in ("REQUESTED", "TESTING"):
            continue
        holds = _upcoming_holds(list(item.readiness_blockers))
        if item.readiness_state == "NOT_READY" and holds:
            # The round is open but its window or release has not come: upcoming, no
            # one's action. Dropped later when the round's samples or basis, or the
            # control's step on this phase, already carry the hold.
            found.append(
                QueueItem(
                    id=f"round:{item.id}",
                    kind="round",
                    obligation="ROUND_WINDOW",
                    source=QueueSource(type="test_round", id=item.id),
                    stage="TESTING",
                    control_id=item.control_id,
                    control_ref=refs.get(item.control_id, item.control_ref),
                    phase=item.kind,
                    round_id=item.id,
                    round_kind=item.kind,
                    title=f"{_round_word(item.kind).capitalize()} testing not due yet",
                    reason=holds[0],
                    owner=QueueOwner(role="NONE"),
                    authorized=False,
                    ready=False,
                    blockers=holds,
                    bucket="UPCOMING",
                    link=_control_link(item.control_id, "TEST"),
                )
            )
        if item.basis is None or not item.basis.stale:
            continue
        authorized = viewer.may_prepare(assigned.get(item.control_id))
        reconstructed = item.basis.source == "RECONSTRUCTED"
        found.append(
            QueueItem(
                id=f"round-basis:{item.id}",
                kind="round-basis",
                obligation="ROUND_BASIS",
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
                obligation="SAMPLES_APPROVAL",
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
                bucket=_bucket(authorized, ready, "PREPARER", bool(_upcoming_holds(blockers))),
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
                obligation="TESTING_RUN_STOPPED",
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


def _drafts(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
) -> list[QueueItem]:
    """A workpaper draft the agent gave up on (workpaper_service.fail_draft): a person
    starts it again. An agent execution failure, not a testing result."""
    from ai_workforce_api.workpaper_service import DRAFT_FAILED

    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, engagement_control_id, stage, updated_at FROM workpapers
        WHERE project_id = %s AND status = 'DRAFT' AND draft_status = 'IDLE'
          AND draft_note = %s
        ORDER BY updated_at
        """,
        (project_id, DRAFT_FAILED),
    ).fetchall():
        control_id = UUID(str(row[1]))
        stage = str(row[2])
        authorized = viewer.may_prepare(assigned.get(control_id))
        step = "PLAN" if stage == "DESIGN" else "CONCLUDE"
        found.append(
            QueueItem(
                id=f"draft-stopped:{row[0]}",
                kind="draft-stopped",
                obligation="WORKPAPER_DRAFT_STOPPED",
                source=QueueSource(type="workpaper", id=UUID(str(row[0]))),
                stage="PLANS" if stage == "DESIGN" else "TESTING",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase="DESIGN" if stage == "DESIGN" else None,
                title=f"Draft the {stage.lower().replace('_', ' ')} workpaper again",
                reason=DRAFT_FAILED,
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                bucket=_bucket(authorized, True, "PREPARER"),
                link=_control_link(control_id, step),
                at=row[3],
            )
        )
    return found


def _evidence_reviews(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
) -> list[QueueItem]:
    """Evidence the agent reviewed for sufficiency, or could not: a person accepts or
    overrides the proposed conclusion (evidence_review.decide)."""
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT r.id, r.engagement_control_id, r.status, r.proposed, r.note, f.file_name,
               r.pbc_request_id, r.created_at
        FROM evidence_reviews r JOIN evidence_files f ON f.id = r.evidence_file_id
        WHERE r.project_id = %s AND r.decision IS NULL
        ORDER BY r.created_at
        """,
        (project_id,),
    ).fetchall():
        control_id = None if row[1] is None else UUID(str(row[1]))
        authorized = viewer.may_prepare(
            assigned.get(control_id) if control_id is not None else None
        )
        proposed = str(row[3]).replace("_", " ").lower()
        reason = (
            f"The evidence agent proposes: {proposed}. A person accepts or overrides it."
            if str(row[2]) == "READY"
            else f"The agent could not review it: {str(row[4]) or 'no reason recorded'}. "
            "A person concludes."
        )
        query = {"tab": "mailbox"}
        if row[6] is not None:
            query["request"] = str(row[6])
        found.append(
            QueueItem(
                id=f"evidence-review:{row[0]}",
                kind="evidence-review",
                obligation="EVIDENCE_SUFFICIENCY",
                source=QueueSource(type="evidence_review", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=control_id,
                control_ref=None if control_id is None else refs.get(control_id),
                title=f"Decide the sufficiency of {row[5]}",
                reason=reason,
                owner=QueueOwner(role="PREPARER"),
                authorized=authorized,
                bucket=_bucket(authorized, True, "PREPARER"),
                link=QueueLink(section="evidence", query=query),
                at=row[7],
            )
        )
    return found


def _deficiencies(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
    rounds_by_id: dict[UUID, Any],
) -> list[QueueItem]:
    """Remediation and retest of a logged deficiency (workspace._progress): starting
    remediation is the preparer's; the fix itself waits on the control owner; a retest
    with an open round is that round's own items, so it is not repeated here."""
    retesting = {
        item.deficiency_id
        for item in rounds_by_id.values()
        if item.kind == "RETEST" and item.status in ("REQUESTED", "TESTING")
    }
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, reference, title, status, engagement_control_id, remediation_owner,
               remediation_due, retest_result, updated_at
        FROM deficiencies WHERE project_id = %s
          AND status IN ('OPEN', 'REMEDIATION_IN_PROGRESS', 'READY_FOR_RETEST')
        ORDER BY reference
        """,
        (project_id,),
    ).fetchall():
        deficiency_id = UUID(str(row[0]))
        status = str(row[3])
        control_id = None if row[4] is None else UUID(str(row[4]))
        owner_name = str(row[5] or "").strip()
        due = row[6]
        if status == "READY_FOR_RETEST" and deficiency_id in retesting:
            continue
        authorized = viewer.may_prepare(
            assigned.get(control_id) if control_id is not None else None
        )
        if status == "OPEN":
            title = f"Start the remediation of {row[1]}: {row[2]}"
            reason = "Logged from the testing; the control owner fixes it before any retest."
            role: Role = "PREPARER"
            obligation = "DEFICIENCY_REMEDIATION"
        elif status == "REMEDIATION_IN_PROGRESS":
            title = f"Remediation of {row[1]} in progress: record the date the fix took effect"
            reason = (
                f"Retest failed on {row[7] and str(row[7]).lower()}; the control owner fixes it "
                "again."
                if str(row[7]) == "FAILED"
                else "The control owner is fixing it; the retest opens once a person records "
                "the date the fix took effect."
            )
            if due is not None:
                reason += f" Due {due.isoformat()}."
            role = "CLIENT"
            obligation = "DEFICIENCY_REMEDIATION"
            authorized = False
        else:
            title = f"Record the retest result of {row[1]}"
            reason = (
                "No retest round is open: a person records whether the fixed control "
                "operated, with its evidence."
            )
            role = "PREPARER"
            obligation = "DEFICIENCY_RETEST"
        link = (
            _control_link(control_id, "CONCLUDE")
            if control_id is not None
            else QueueLink(section="deficiencies")
        )
        found.append(
            QueueItem(
                id=f"deficiency:{deficiency_id}",
                kind="deficiency",
                obligation=obligation,
                source=QueueSource(type="deficiency", id=deficiency_id),
                stage="TESTING",
                control_id=control_id,
                control_ref=None if control_id is None else refs.get(control_id),
                phase="REMEDIATION" if status != "READY_FOR_RETEST" else "RETEST",
                title=title,
                reason=reason,
                owner=QueueOwner(role=role, names=[owner_name] if owner_name else []),
                authorized=authorized,
                bucket=_bucket(authorized, True, role),
                link=link,
                at=row[8],
            )
        )
    return found


def _requests(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    controls: dict[UUID, Any],
    assigned: dict[UUID, set[UUID]],
    settings: Settings | None,
) -> list[QueueItem]:
    """Each drafted request once. An agent's draft is an approver's to approve; a person's
    draft is the preparer's to submit for approval. The item is ready only when the
    approval endpoint's own rule finds nothing in the way (request_details.blocker: the
    recipient and the allowlist, the planning hold, the quality checks); when something
    is, the item is blocked with that reason and belongs to the preparer who resolves it.
    The endpoint applies the rule again when the action is taken, with its own settings
    and the record's version: the queue's reading never stands in for it."""
    from ai_workforce_api.evidence_plans import reconcile_waiting, unplanned_controls
    from ai_workforce_api.request_details import draft_blockers

    held_controls = set(unplanned_controls(connection, project_id))
    held_controls |= reconcile_waiting(connection, project_id)
    problems = (
        draft_blockers(connection, settings, organization_id, project_id)
        if settings is not None
        else {}
    )
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, engagement_control_id, operation_key, recipient, testing_phase, created_at,
               drafted_by
        FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT'
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        request_id = UUID(str(row[0]))
        control_id = UUID(str(row[1]))
        agent_draft = str(row[6] or "") == "AGENT"
        blockers: list[str] = []
        if settings is not None:
            problem = problems.get(request_id)
            if problem is not None:
                blockers.append(problem)
        else:
            held = control_id in held_controls and str(row[2]).startswith(("kickoff-", "scope-"))
            if held:
                blockers.append("Plan the evidence, then reconcile the kickoff draft with its plan")
            elif str(row[3] or "").strip() == "":
                blockers.append("Assign a recipient.")
        ready = not blockers
        # Whose it is: the approver's when ready; the preparer's while something they
        # resolve holds it; a person's own draft is the preparer's to submit.
        if not agent_draft:
            role: Role = "PREPARER"
            authorized = viewer.may_prepare(assigned.get(control_id))
            title = "Submit the evidence request for approval"
            reason = "Written by a person; someone else approves it once submitted."
            obligation = "EVIDENCE_REQUEST"
        elif ready:
            role = "APPROVER"
            authorized = viewer.approve
            title = "Review and approve the drafted evidence request"
            reason = (
                "Drafted by the evidence coordinator; an approver checks the exact message "
                "before it is sent."
            )
            obligation = "REQUEST_DRAFT_APPROVAL"
        else:
            role = "PREPARER"
            authorized = viewer.may_prepare(assigned.get(control_id))
            title = "Review and approve the drafted evidence request"
            reason = (
                "Drafted by the evidence coordinator; it cannot be approved until this is resolved."
            )
            obligation = "REQUEST_DRAFT_APPROVAL"
        found.append(
            QueueItem(
                id=f"request-draft:{request_id}",
                kind="request-draft",
                obligation=obligation,
                source=QueueSource(type="pbc_request", id=request_id),
                stage="EVIDENCE",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=None if row[4] is None else str(row[4]),
                title=title,
                reason=reason,
                owner=QueueOwner(role=role),
                authorized=authorized,
                ready=ready,
                blockers=blockers,
                bucket=_bucket(authorized, ready, role),
                link=QueueLink(
                    section="controls",
                    query={
                        "control": str(control_id),
                        "step": "request",
                        "request": str(request_id),
                    },
                ),
                at=row[5],
            )
        )
    return found


def _overdue(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    viewer: _Viewer,
    refs: dict[UUID, str],
    assigned: dict[UUID, set[UUID]],
) -> list[QueueItem]:
    """Each evidence request past due with the client (workspace.is_late's rule): the
    client's to answer, the team's to chase. The console's past-due figure counts these
    items; the control's "Chase the overdue" step defers to them."""
    found: list[QueueItem] = []
    for row in connection.execute(
        """
        SELECT id, engagement_control_id, recipient, due_at, testing_phase, title
        FROM pbc_requests
        WHERE project_id = %s AND (
            status IN ('OVERDUE', 'ESCALATED')
            OR (status NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED', 'DRAFT', 'APPROVAL_PENDING')
                AND due_at < clock_timestamp())
        )
        ORDER BY due_at
        """,
        (project_id,),
    ).fetchall():
        control_id = UUID(str(row[1]))
        authorized = viewer.may_prepare(assigned.get(control_id))
        recipient = str(row[2] or "").strip()
        due = row[3]
        found.append(
            QueueItem(
                id=f"request-overdue:{row[0]}",
                kind="request-overdue",
                obligation="EVIDENCE_RECEIPT",
                source=QueueSource(type="pbc_request", id=UUID(str(row[0]))),
                stage="EVIDENCE",
                control_id=control_id,
                control_ref=refs.get(control_id),
                phase=None if row[4] is None else str(row[4]),
                title="Chase the overdue evidence request",
                reason=(
                    f"Due {due.date().isoformat() if due is not None else 'date not set'}"
                    + (f"; with {recipient}" if recipient else "")
                    + (f": {str(row[5]).strip()}" if row[5] and str(row[5]).strip() else "")
                ),
                owner=QueueOwner(role="CLIENT", names=[recipient] if recipient else []),
                authorized=authorized,
                bucket=_bucket(authorized, True, "CLIENT"),
                link=QueueLink(
                    section="controls",
                    query={"control": str(control_id), "step": "request", "request": str(row[0])},
                ),
                at=due,
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
                obligation="REMINDER_APPROVAL",
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
                obligation="REPLY_TRIAGE",
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
                obligation="TASK_BLOCKED" if blocked else "TASK_REVIEW",
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
                link=QueueLink(section="reports", query={"view": "schedule"}),
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
        bucket: str | None = Query(default=None, pattern="^(MINE|WAITING|BLOCKED|UPCOMING)$"),
        stage: str | None = Query(default=None, pattern="^[A-Z]{4,8}$"),
        phase: str | None = Query(default=None, pattern="^[A-Z]{5,12}$"),
        control: UUID | None = None,
        limit: int | None = Query(default=None, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
    ) -> QueueBody:
        from ai_workforce_api.workspace import automation_of

        principal = _session_principal(request)
        automated = automation_of(settings).available
        try:
            body = _call(
                settings,
                lambda connection: queue(
                    connection, principal, organization_id, project_id, automated, settings
                ),
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
        total = len(items)
        # A page of the filtered list; the counts stay those of the whole queue.
        if limit is not None or offset:
            items = items[offset : offset + limit if limit is not None else None]
        return QueueBody(
            items=items, counts=body.counts, total=total, generated_at=body.generated_at
        )
