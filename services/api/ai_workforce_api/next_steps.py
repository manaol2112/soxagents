"""Where an engagement stands and what to do next (decided by the product owner): the
engagement's stages as one journey, and one ordered list of what waits on the team.

The stages are set up, test plans, evidence, testing, review, and close, each with how
far it has come. The steps are the setup still to finish, the test plans to settle and
approve (master_plans), and everything the agent console's "Waiting on you" holds
(console._inbox), each placed in the stage it belongs to. The home page reads this; the
work itself stays where it is done.
"""

from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import Principal, _call, _session_principal
from ai_workforce_api.settings import Settings

StageKey = Literal["SETUP", "PLANS", "EVIDENCE", "TESTING", "REVIEW", "CLOSE"]
STAGES: tuple[tuple[StageKey, str], ...] = (
    ("SETUP", "Set up"),
    ("PLANS", "Test plans"),
    ("EVIDENCE", "Evidence"),
    ("TESTING", "Testing"),
    ("REVIEW", "Review"),
    ("CLOSE", "Close"),
)

# The stage each kind of waiting item (console._inbox) belongs to.
_WAITING_STAGES: dict[str, StageKey] = {
    "approval": "EVIDENCE",
    "drafts": "EVIDENCE",
    "contacts": "EVIDENCE",
    "late": "EVIDENCE",
    "reminders": "EVIDENCE",
    "replies": "EVIDENCE",
    "planning": "EVIDENCE",
    "samples": "TESTING",
    "results": "TESTING",
    "blocked": "TESTING",
    "review": "REVIEW",
    "control_review": "REVIEW",
}


class StageBody(BaseModel):
    key: StageKey
    label: str
    status: Literal["DONE", "CURRENT", "UPCOMING"]
    done: int
    total: int
    summary: str


class StepBody(BaseModel):
    """One thing waiting on the team, and where it is done: a page (`section` with its
    `query`), or, for a console item, its own link (`link`, `control_id`, `tab`)."""

    stage: StageKey
    kind: str
    title: str
    detail: str
    # Whether it holds the engagement up (a test plan that cannot be approved yet).
    blocks: bool = False
    section: str | None = None
    query: dict[str, str] = Field(default_factory=dict)
    control_ref: str | None = None
    link: str = ""
    control_id: UUID | None = None
    tab: str | None = None


class NextStepsBody(BaseModel):
    launched: bool
    current: StageKey
    stages: list[StageBody]
    steps: list[StepBody]


def _plural(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def plan_steps(connection: psycopg.Connection[Any], project_id: UUID) -> list[StepBody]:
    """The test plans' work, most pressing first: what holds plans from approval, plans
    changed since approval, plans to approve, then the client values and descriptions
    that do not hold approval."""
    from ai_workforce_api.master_plans import (
        APPROVED_STATUSES,
        _load,
        blockers_of,
        state_of,
    )

    held = revised = ready = values = described = 0
    for plan in _load(connection, project_id).values():
        if plan.plan_id is None:
            continue
        blockers = blockers_of(plan)
        state = state_of(plan, blockers)
        if state == "APPROVED":
            continue
        if any(item.blocks for item in blockers):
            held += 1
            continue
        if plan.approved_revision is not None and plan.status not in APPROVED_STATUSES:
            revised += 1
        elif state in ("DRAFT_READY", "PENDING_REVIEW", "NEEDS_CLARIFICATION"):
            ready += 1
        values += sum(1 for item in blockers if item.resolve == "VALUES")
        if any(item.resolve == "FACTS" for item in blockers):
            described += 1
    steps: list[StepBody] = []
    # Results signed off under an earlier plan revision wait for a reviewer's impact
    # assessment (plan_impact.py, W3): nothing relies on them until decided.
    pending = connection.execute(
        "SELECT count(*) FROM plan_impact_assessments WHERE project_id = %s AND status = 'PENDING'",
        (project_id,),
    ).fetchone()
    impact = int(pending[0]) if pending is not None else 0
    if impact:
        steps.append(StepBody(
            stage="PLANS", kind="plans_impact", blocks=True,
            title=f"Decide the impact of plan revisions on {_plural(impact, 'signed-off result')}",
            detail="The plan changed after the results were signed off; a reviewer decides "
            "whether they stand or are re-performed.",
            section="testing",
        ))  # fmt: skip
    if held:
        steps.append(StepBody(
            stage="PLANS", kind="plans_held", blocks=True,
            title=f"Settle what holds {_plural(held, 'test plan')}",
            detail="Each needs something settled before it can be approved.",
            section="testing",
        ))  # fmt: skip
    if revised:
        steps.append(StepBody(
            stage="PLANS", kind="plans_revised",
            title=f"Re-approve {_plural(revised, 'test plan')} changed since approval",
            detail="Each says what changed since you approved it.",
            section="testing",
        ))  # fmt: skip
    if ready:
        steps.append(StepBody(
            stage="PLANS", kind="plans_ready",
            title=f"Approve {_plural(ready, 'test plan')}",
            detail="Nothing holds them; evidence is requested once a plan is approved.",
            section="testing",
            query={"filter": "DRAFT_READY,PENDING_REVIEW,NEEDS_CLARIFICATION"},
        ))  # fmt: skip
    if values:
        steps.append(StepBody(
            stage="PLANS", kind="plans_values",
            title=f"Answer {_plural(values, 'client value')}",
            detail="Asked on the test plans; testing waits for some of them.",
            section="testing",
        ))  # fmt: skip
    if described:
        steps.append(StepBody(
            stage="PLANS", kind="plans_describe",
            title=f"Describe {_plural(described, 'client control')}",
            detail="Optional: the client's RCM leaves how they operate unsaid. Each "
            "plan's Describe the control asks it; approval does not wait for it.",
            section="testing",
        ))  # fmt: skip
    return steps


def next_steps(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> NextStepsBody:
    """The engagement's journey and the team's next steps, in the order of the work."""
    from ai_workforce_api.console import _inbox
    from ai_workforce_api.workspace import _dashboard

    # The console's own check of who may read it stands for this page too.
    inbox = _inbox(connection, principal, organization_id, project_id)
    row = connection.execute(
        "SELECT status FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    status = str(row[0]) if row is not None else "DRAFT"
    launched = status != "DRAFT"
    closed = status in ("COMPLETED", "ARCHIVED")
    in_scope = int(
        (
            connection.execute(
                "SELECT count(*) FROM engagement_controls WHERE project_id = %s AND included",
                (project_id,),
            ).fetchone()
            or (0,)
        )[0]
    )
    approved = int(
        (
            connection.execute(
                "SELECT count(*) FROM evidence_plans p JOIN engagement_controls c "
                "ON c.id = p.engagement_control_id WHERE c.project_id = %s AND c.included "
                "AND p.status = 'APPROVED'",
                (project_id,),
            ).fetchone()
            or (0,)
        )[0]
    )
    board = _dashboard(connection, principal, organization_id, project_id) if launched else None
    evidence = board.evidence if board is not None else {}
    controls = board.controls if board is not None else {}
    review = board.review if board is not None else {}
    requested = int(evidence.get("total", 0) or 0)
    received = int(evidence.get("received", 0) or 0)
    concluded = int(controls.get("concluded", 0) or 0)
    signed = int(review.get("signed_off", 0) or 0)
    figures: dict[StageKey, tuple[int, int, str]] = {
        "SETUP": (1 if launched else 0, 1, "Launched" if launched else "Not launched yet"),
        "PLANS": (approved, in_scope, f"{approved} of {in_scope} approved"),
        "EVIDENCE": (received, requested, f"{received} of {requested} requests received"),
        "TESTING": (concluded, in_scope, f"{concluded} of {in_scope} concluded"),
        "REVIEW": (signed, in_scope, f"{signed} of {in_scope} signed off"),
        "CLOSE": (1 if closed else 0, 1, "Completed" if closed else "Not completed"),
    }
    stages: list[StageBody] = []
    current: StageKey | None = None
    for key, label in STAGES:
        done, total, summary = figures[key]
        finished = done >= total and (total > 0 or key in ("SETUP", "CLOSE"))
        if key == "EVIDENCE" and total == 0:
            finished = False
        state: Literal["DONE", "CURRENT", "UPCOMING"] = "DONE" if finished else "UPCOMING"
        if not finished and current is None:
            current, state = key, "CURRENT"
        stages.append(
            StageBody(
                key=key, label=label, status=state, done=done, total=total, summary=summary
            )  # fmt: skip
        )
    steps: list[StepBody] = []
    if not launched:
        steps.append(StepBody(
            stage="SETUP", kind="setup", blocks=True,
            title="Finish setting up the engagement, then launch it",
            detail="The agents start once it is launched.", section="setup",
        ))  # fmt: skip
    steps += plan_steps(connection, project_id)
    for item in inbox.waiting:
        steps.append(StepBody(
            stage=_WAITING_STAGES.get(item.kind, current or "EVIDENCE"), kind=item.kind,
            title=item.title, detail=item.detail, control_ref=item.control_ref,
            link=item.link, control_id=item.control_id, tab=item.tab,
        ))  # fmt: skip
    order = {key: index for index, (key, _label) in enumerate(STAGES)}
    steps.sort(key=lambda step: (order[step.stage], not step.blocks))
    return NextStepsBody(launched=launched, current=current or "CLOSE", stages=stages, steps=steps)


def register_next_steps(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    @app.get(f"{base}/next-steps")
    def read(organization_id: UUID, project_id: UUID, request: Request) -> NextStepsBody:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda connection: next_steps(connection, principal, organization_id, project_id),
        )
