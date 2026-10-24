"""Control readiness: whether a control can be tested, and if not, exactly why.

Readiness is assessed for one control at a time, in five separate checks:

1. Definition and criteria: a description, a set frequency, at least one approved test
   attribute, no proposed attribute change waiting for a decision, and no open question on
   the criteria.
2. Process understanding, only where the control depends on it (a business process
   control): a confirmed map with the step where the control operates, and no open
   question on the process. Not required of an ITGC, an automated control, or a report.
3. Evidence: for a sampled control, its population read (the tester then proposes the
   samples); for a control tested once, at least one read evidence file. Whether the
   evidence is sufficient is judged in testing, item by item; a file's existence is not.
4. Scope and population: the population's own checks. No data, or a file that cannot be
   read, blocks; a count short for the frequency, duplicate keys, or rows outside the
   period are warnings to look at.
5. Conflicts: sources that disagree (on frequency, approver, threshold) block until a
   person settles them.
6. Test plan approval: the control's master test plan, at its current revision, is
   approved by a person (master_plans.py). Nothing is tested on a plan no person approved,
   or on one changed since its approval.

The state follows from the checks: CONFLICT_REQUIRES_REVIEW, NEEDS_INFORMATION,
PLAN_NOT_APPROVED, PROCESS_UNDERSTANDING_INCOMPLETE, EVIDENCE_PENDING, READY; once testing
is signed off,
READY_FOR_REVIEW until the independent review signs off, then CONCLUDED. Approving
samples, and the tester's runs, wait while a control is in one of the blocking states.
A narrative's presence, or a file's, is never treated as readiness on its own.
"""

from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.control_context import (
    Classification,
    classifications_of,
    needs_process_understanding,
)
from ai_workforce_api.controls import FREQUENCIES
from ai_workforce_api.definition_registry import attribute_for

State = Literal[
    "READY",
    "NEEDS_INFORMATION",
    "PLAN_NOT_APPROVED",
    "PROCESS_UNDERSTANDING_INCOMPLETE",
    "EVIDENCE_PENDING",
    "CONFLICT_REQUIRES_REVIEW",
    "IMPACT_PENDING",
    "READY_FOR_REVIEW",
    "CONCLUDED",
]
BLOCKING: frozenset[str] = frozenset(
    {
        "IMPACT_PENDING",
        "NEEDS_INFORMATION",
        "PLAN_NOT_APPROVED",
        "PROCESS_UNDERSTANDING_INCOMPLETE",
        "CONFLICT_REQUIRES_REVIEW",
    }
)
CheckStatus = Literal["OK", "BLOCKED", "WARN", "PENDING", "NOT_APPLICABLE"]
CheckKey = Literal["criteria", "process", "evidence", "scope", "conflicts", "plan"]

STATE_LABELS: dict[str, str] = {
    "READY": "Ready to test",
    "NEEDS_INFORMATION": "Needs information",
    "PLAN_NOT_APPROVED": "Test plan awaiting approval",
    "PROCESS_UNDERSTANDING_INCOMPLETE": "Process understanding incomplete",
    "EVIDENCE_PENDING": "Evidence pending",
    "CONFLICT_REQUIRES_REVIEW": "Conflict to review",
    "IMPACT_PENDING": "Impact assessment pending",
    "READY_FOR_REVIEW": "Ready for review",
    "CONCLUDED": "Concluded",
}


class Blocker(BaseModel):
    """One thing in the way: what is missing, why it matters, and what resolves it."""

    detail: str
    why: str
    resolve: str


class CheckBody(BaseModel):
    key: CheckKey
    title: str
    status: CheckStatus
    summary: str
    blockers: list[Blocker] = []


class ReadinessBody(BaseModel):
    control_id: UUID
    state: State
    label: str
    classifications: list[Classification]
    process_required: bool
    checks: list[CheckBody]

    @property
    def blocking(self) -> bool:
        return self.state in BLOCKING

    def first_blocker(self) -> str:
        for check in self.checks:
            if check.status == "BLOCKED" and check.blockers:
                return check.blockers[0].detail
        return ""


@dataclass
class Facts:
    id: UUID
    control_ref: str
    title: str
    activity: str
    frequency: str
    nature: str
    domain: str
    classifications: list[Classification]
    application_id: UUID | None
    approved: int = 0
    proposed: int = 0
    # Library version 3 proposals: those whose answer testing needs (text, question), and
    # optional ones a person may take up without holding testing.
    questions: list[tuple[str, str]] = field(default_factory=list)
    optional: int = 0
    # Milestone 8.9: the client values in the control's statement testing waits for.
    values_missing: list[tuple[str, str]] = field(default_factory=list)
    understanding: str = "NONE"
    steps: int = 0
    control_points: int = 0
    documents: int = 0
    unreviewed: int = 0
    issues: list[tuple[str, str, str, str, str, str]] = field(default_factory=list)
    evidence_read: int = 0
    plan_status: str | None = None
    plan_checks: list[dict[str, Any]] = field(default_factory=list)
    frame_rows: int = 0
    sheet_status: str | None = None
    sheet_method: str | None = None
    review_status: str | None = None
    # The master test plan's status and revision (None: no plan).
    master_status: str | None = None
    master_revision: int = 0
    # Results signed off under an earlier (or unrecorded) plan revision await a reviewer's
    # impact assessment (plan_impact.py, W3): nothing relies on them until then.
    impact_pending: int = 0


def load_facts(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, Facts]:
    """The facts readiness rests on, for one control or every in-scope control."""
    rows = connection.execute(
        """
        SELECT id, control_ref, title, activity, frequency, nature, domain, classifications,
               engagement_application_id
        FROM engagement_controls
        WHERE project_id = %s AND (%s::uuid IS NULL AND included OR id = %s)
        """,
        (project_id, control_id, control_id),
    ).fetchall()
    facts: dict[UUID, Facts] = {}
    for row in rows:
        facts[UUID(str(row[0]))] = Facts(
            id=UUID(str(row[0])),
            control_ref=str(row[1]),
            title=str(row[2]),
            activity=str(row[3] or ""),
            frequency=str(row[4] or ""),
            nature=str(row[5] or ""),
            domain=str(row[6]),
            classifications=classifications_of(row[7], str(row[6]), str(row[5] or "")),
            application_id=row[8],
        )
    if not facts:
        return facts
    for cid, approved, proposed in connection.execute(
        """
        SELECT engagement_control_id, count(*) FILTER (WHERE status = 'APPROVED'),
               count(*) FILTER (WHERE status = 'PROPOSED')
        FROM control_attributes WHERE project_id = %s GROUP BY 1
        """,
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.approved, found.proposed = int(approved), int(proposed)
    for cid, text, key, library_key in connection.execute(
        """
        SELECT a.engagement_control_id, a.text, a.definition_key, c.library_key
        FROM control_attributes a JOIN engagement_controls c ON c.id = a.engagement_control_id
        WHERE a.project_id = %s AND a.status = 'PROPOSED' AND a.source_kind = 'LIBRARY'
          AND a.definition_key IS NOT NULL
        ORDER BY a.position
        """,
        (project_id,),
    ).fetchall():
        found = facts.get(UUID(str(cid)))
        definition = attribute_for(str(library_key or ""), str(key))
        if found is None or definition is None:
            continue
        found.proposed -= 1
        if definition.blocks:
            found.questions.append((str(text), definition.question))
        else:
            found.optional += 1
    from ai_workforce_api.control_design import missing_values

    for cid, missing in missing_values(connection, project_id).items():
        if (found := facts.get(cid)) is not None:
            found.values_missing = missing
    for cid, status, steps in connection.execute(
        "SELECT engagement_control_id, status, steps FROM process_understandings "
        "WHERE project_id = %s",
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            listed = steps if isinstance(steps, list) else []
            found.understanding = str(status)
            found.steps = len(listed)
            found.control_points = sum(
                1 for step in listed if isinstance(step, dict) and step.get("control_point")
            )
    for cid, origin, kind, topic, detail, why, resolve in connection.execute(
        """
        SELECT engagement_control_id, origin, kind, topic, detail, why, resolve
        FROM control_context_issues WHERE project_id = %s AND status = 'OPEN'
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.issues.append(
                (str(origin), str(kind), str(topic), str(detail), str(why), str(resolve))
            )
    for cid, linked, unreviewed in connection.execute(
        """
        SELECT engagement_control_id, count(*), count(*) FILTER (WHERE reviewed_at IS NULL)
        FROM source_document_controls WHERE project_id = %s GROUP BY 1
        """,
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.documents, found.unreviewed = int(linked), int(unreviewed)
    _evidence(connection, project_id, facts)
    for cid, status, checks, frame in connection.execute(
        "SELECT engagement_control_id, status, checks, frame_rows FROM control_tests "
        "WHERE project_id = %s AND test_round_id IS NULL",
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.plan_status = str(status)
            found.plan_checks = [item for item in checks or [] if isinstance(item, dict)]
            found.frame_rows = int(frame or 0)
    for cid, status, method in connection.execute(
        "SELECT engagement_control_id, status, method FROM test_sheets "
        "WHERE project_id = %s AND test_round_id IS NULL",
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.sheet_status, found.sheet_method = str(status), str(method)
    for cid, status, revision in connection.execute(
        "SELECT engagement_control_id, status, revision FROM evidence_plans WHERE project_id = %s",
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.master_status, found.master_revision = str(status), int(revision)
    from ai_workforce_api.control_reviews import review_states

    for cid, state in review_states(connection, project_id).items():
        if (found := facts.get(cid)) is not None:
            found.review_status = str(state[0])
    # Signed-off results whose plan revision is unknown or older than the approved one,
    # with no VALID assessment for the approved revision: pending, whether or not the
    # assessment row exists yet.
    for cid, count in connection.execute(
        """
        SELECT o.engagement_control_id, count(*)
        FROM test_sheet_signoffs o
        JOIN test_sheets s ON s.id = o.test_sheet_id AND s.status = 'SIGNED_OFF'
        JOIN evidence_plans p ON p.engagement_control_id = o.engagement_control_id
        WHERE o.project_id = %s AND o.reopened_at IS NULL AND p.approved_revision IS NOT NULL
          AND (o.plan_revision IS NULL OR o.plan_revision <> p.approved_revision)
          AND NOT EXISTS (
              SELECT 1 FROM plan_impact_assessments a
              WHERE a.signoff_id = o.id AND a.to_revision = p.approved_revision
                AND a.status = 'VALID'
          )
        GROUP BY 1
        """,
        (project_id,),
    ).fetchall():
        if (found := facts.get(UUID(str(cid)))) is not None:
            found.impact_pending = int(count)
    return facts


def _evidence(
    connection: psycopg.Connection[Any], project_id: UUID, facts: dict[UUID, Facts]
) -> None:
    """Read evidence per control: its own files, and those another instance of the same
    control shares with it (tagged for every application, or for this one)."""
    read = {
        UUID(str(row[0]))
        for row in connection.execute(
            "SELECT evidence_file_id FROM evidence_analyses WHERE project_id = %s "
            "AND status = 'READY'",
            (project_id,),
        ).fetchall()
    }
    tags = {
        UUID(str(row[0])): (str(row[1]), row[2], list(row[3] or []))
        for row in connection.execute(
            "SELECT evidence_file_id, scope, engagement_application_id, "
            "engagement_application_ids "
            "FROM evidence_file_applications WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    refs = {
        UUID(str(row[0])): str(row[1])
        for row in connection.execute(
            "SELECT id, control_ref FROM engagement_controls WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    by_ref: dict[str, set[UUID]] = {}
    own: dict[UUID, set[UUID]] = {}
    for file_id, cid in connection.execute(
        "SELECT evidence_file_id, engagement_control_id FROM evidence_file_links "
        "WHERE project_id = %s AND engagement_control_id IS NOT NULL",
        (project_id,),
    ).fetchall():
        file_uuid, control_uuid = UUID(str(file_id)), UUID(str(cid))
        if file_uuid not in read:
            continue
        own.setdefault(control_uuid, set()).add(file_uuid)
        by_ref.setdefault(refs.get(control_uuid, ""), set()).add(file_uuid)
    for found in facts.values():
        files = set(own.get(found.id, set()))
        for file_id in by_ref.get(found.control_ref, set()) - files:
            scope, application, several = tags.get(file_id, ("UNKNOWN", None, []))
            if (
                scope == "ALL"
                or (scope == "ONE" and application == found.application_id)
                or (scope == "SOME" and found.application_id in several)
            ):
                files.add(file_id)
        found.evidence_read = len(files)


def evaluate(facts: Facts) -> ReadinessBody:
    # Tested once, as the tester decides it (testing_engine.tested_once): an automated
    # control, or one whose configuration evidence opened a single test with no sample plan.
    sampled = facts.nature != "AUTOMATED" and not (
        facts.plan_status is None and facts.sheet_method == "TEST_OF_ONE"
    )
    process_required = needs_process_understanding(facts.classifications)
    criteria_issues = [i for i in facts.issues if i[0] == "ATTRIBUTES" and i[1] != "CONFLICT"]
    process_issues = [i for i in facts.issues if i[0] == "PROCESS" and i[1] != "CONFLICT"]
    conflicts = [i for i in facts.issues if i[1] == "CONFLICT"]

    # 1. Definition and criteria
    criteria: list[Blocker] = []
    if not facts.activity.strip():
        criteria.append(
            Blocker(
                detail="The control has no description of what is done.",
                why="Without it the tester cannot tell what operating the control means.",
                resolve="Add the control activity in the control editor or the RCM.",
            )
        )
    if facts.frequency not in FREQUENCIES:
        criteria.append(
            Blocker(
                detail="The control's frequency is not set.",
                why="The frequency decides the population and the sample size.",
                resolve="Set the frequency in the control editor.",
            )
        )
    if facts.approved == 0:
        criteria.append(
            Blocker(
                detail="The control has no approved test attributes.",
                why="The attributes are what each sample is tested against.",
                resolve=(
                    "Add attributes, or have the agent propose them from the sources and "
                    "approve them."
                ),
            )
        )
    if facts.proposed:
        criteria.append(
            Blocker(
                detail=f"{facts.proposed} proposed attribute change"
                f"{'s wait' if facts.proposed != 1 else ' waits'} for a decision.",
                why="Testing uses the approved attributes; a pending change may alter them.",
                resolve="Approve or reject each proposal on the Design tab.",
            )
        )
    for label, why in facts.values_missing:
        criteria.append(
            Blocker(
                detail=f"The control needs the client's value for {label}.",
                why=f"{why} The library cannot set it for the client.",
                resolve="Enter it under Client values on the Design tab.",
            )
        )
    for text, question in facts.questions:
        criteria.append(
            Blocker(
                detail=f"Proposed by the library: {text}",
                why=f"The library cannot know this for the client: {question} Until it is "
                "answered, testing would leave out a condition the control description "
                "requires.",
                resolve="On the Design tab, approve it with the client's value in place of the "
                "bracketed text, or reject it with the reason it does not apply.",
            )
        )
    criteria += [Blocker(detail=f"{topic}: {detail}", why=why, resolve=resolve)
                 for _o, _k, topic, detail, why, resolve in criteria_issues]  # fmt: skip
    criteria_check = CheckBody(
        key="criteria",
        title="Definition and criteria",
        status="BLOCKED" if criteria else "WARN" if facts.optional else "OK",
        summary=(
            f"{len(criteria)} open point{'s' if len(criteria) != 1 else ''}"
            if criteria
            else f"{facts.approved} approved attribute{'s' if facts.approved != 1 else ''}, "
            f"{facts.optional} optional proposal{'s' if facts.optional != 1 else ''} to consider"
            if facts.optional
            else f"{facts.approved} approved attribute{'s' if facts.approved != 1 else ''}"
        ),
        blockers=criteria,
    )

    # 2. Process understanding
    process: list[Blocker] = []
    if process_required:
        if facts.understanding != "CONFIRMED":
            process.append(
                Blocker(
                    detail=(
                        "The process understanding is a draft."
                        if facts.understanding == "DRAFT"
                        else "There is no process understanding yet."
                    ),
                    why=(
                        "A business process control is tested against how its process runs: "
                        "the flow, the handoffs, the approvals, and the exceptions."
                    ),
                    resolve=(
                        "Build the process map from the RCM and any supporting documents "
                        "(a narrative, flowchart, policy, procedure, or walkthrough notes), "
                        "review it, and confirm it."
                    ),
                )
            )
        elif facts.control_points == 0:
            process.append(
                Blocker(
                    detail="The process map does not show where the control operates.",
                    why="Testing needs the step the control is and what it checks.",
                    resolve="Mark the control point on the map and confirm it again.",
                )
            )
        process += [Blocker(detail=f"{topic}: {detail}", why=why, resolve=resolve)
                    for _o, _k, topic, detail, why, resolve in process_issues]  # fmt: skip
    process_check = CheckBody(
        key="process",
        title="Process understanding",
        status=(
            "NOT_APPLICABLE"
            if not process_required
            else "BLOCKED"
            if process
            else "WARN"
            if facts.unreviewed
            else "OK"
        ),
        summary=(
            "Not needed: the control's own criteria define it. Add documentation if useful."
            if not process_required
            else f"{len(process)} open point{'s' if len(process) != 1 else ''}"
            if process
            else f"{facts.unreviewed} new document{'s' if facts.unreviewed != 1 else ''} "
            "not reviewed against the map yet"
            if facts.unreviewed
            else f"Confirmed, {facts.steps} step{'s' if facts.steps != 1 else ''}"
        ),
        blockers=process,
    )

    # 3. Evidence
    evidence: list[Blocker] = []
    if sampled and facts.plan_status is None:
        evidence.append(
            Blocker(
                detail=(
                    "Evidence has been read, but no population was recognised yet."
                    if facts.evidence_read
                    else "No evidence has been read for this control yet."
                ),
                why="Samples are drawn from the population of the period.",
                resolve="Request the population from the control owner, or upload it here.",
            )
        )
    elif not sampled and facts.evidence_read == 0:
        evidence.append(
            Blocker(
                detail="No evidence has been read for this control yet.",
                why="A control tested once is tested from its configuration or a system extract.",
                resolve="Request the configuration evidence, or upload it here.",
            )
        )
    evidence_check = CheckBody(
        key="evidence",
        title="Evidence",
        status="PENDING" if evidence else "OK",
        summary=(
            "Waiting for evidence"
            if evidence
            else f"Population read: {facts.frame_rows:,} items in the period"
            if sampled
            else f"{facts.evidence_read} file{'s' if facts.evidence_read != 1 else ''} read"
        ),
        blockers=evidence,
    )

    # 4. Scope and population
    scope_blockers: list[Blocker] = []
    warnings: list[Blocker] = []
    for check in facts.plan_checks if sampled else []:
        if check.get("result") != "ISSUE":
            continue
        name = str(check.get("check", ""))
        item = Blocker(
            detail=str(check.get("detail", "")) or f"The population's {name} check failed.",
            why="The population must be complete and readable for the sample to stand.",
            resolve="Ask the control owner for a complete, readable population of the period.",
        )
        # An empty or unreadable population blocks: there is nothing to sample. A count
        # that looks short for the frequency, duplicate keys, or rows outside the period
        # are for a person to look at, not reasons to stop: a control can start mid-year.
        empty = name == "read" or "no data rows" in str(check.get("detail", ""))
        (scope_blockers if empty else warnings).append(item)
    scope_check = CheckBody(
        key="scope",
        title="Scope and population",
        status=(
            "NOT_APPLICABLE"
            if not sampled
            else "BLOCKED"
            if scope_blockers
            else "PENDING"
            if facts.plan_status is None
            else "WARN"
            if warnings
            else "OK"
        ),
        summary=(
            "Tested once: no population"
            if not sampled
            else "The population has not been read yet"
            if facts.plan_status is None
            else f"{len(scope_blockers) + len(warnings)} population check"
            f"{'s' if len(scope_blockers) + len(warnings) != 1 else ''} to look at"
            if scope_blockers or warnings
            else "The population's checks passed"
        ),
        blockers=scope_blockers + warnings,
    )

    # 5. Conflicts
    conflict_blockers = [Blocker(detail=f"{topic}: {detail}", why=why, resolve=resolve)
                         for _o, _k, topic, detail, why, resolve in conflicts]  # fmt: skip
    conflict_check = CheckBody(
        key="conflicts",
        title="Conflicts",
        status="BLOCKED" if conflict_blockers else "OK",
        summary=(
            f"{len(conflict_blockers)} conflict{'s' if len(conflict_blockers) != 1 else ''} "
            "between sources"
            if conflict_blockers
            else "No conflicts between sources"
        ),
        blockers=conflict_blockers,
    )

    # 6. Test plan approval
    plan_blockers: list[Blocker] = []
    if facts.master_status is None:
        plan_blockers.append(
            Blocker(
                detail="The control has no test plan yet.",
                why="Testing follows the procedures and attributes a person approved.",
                resolve="Plan the control, then review and approve its test plan.",
            )
        )
    elif facts.master_status == "CHANGES_REQUESTED":
        plan_blockers.append(
            Blocker(
                detail="The reviewer asked for changes to the test plan.",
                why="Testing follows the procedures and attributes a person approved.",
                resolve="Revise the test plan as asked, then submit it for review.",
            )
        )
    elif facts.master_status not in ("APPROVED", "CHANGES_PROPOSED"):
        plan_blockers.append(
            Blocker(
                detail="The test plan waits for a reviewer's approval.",
                why="Testing follows the procedures and attributes a person approved, at "
                "the plan's current revision.",
                resolve="Review the test plan and approve it.",
            )
        )
    plan_check = CheckBody(
        key="plan",
        title="Test plan approval",
        status="BLOCKED" if plan_blockers else "OK",
        summary=(
            "Not approved" if plan_blockers else f"Approved at revision {facts.master_revision}"
        ),
        blockers=plan_blockers,
    )

    if facts.impact_pending:
        plan_check.status = "BLOCKED"
        plan_check.summary = "Impact assessment pending"
        plan_check.blockers.append(
            Blocker(
                detail=f"{facts.impact_pending} signed-off result"
                f"{'' if facts.impact_pending == 1 else 's'} predate the plan's approved "
                "revision, or the revision tested under is not recorded.",
                why="Results are relied on only under the plan revision they were tested "
                "against, or once a reviewer confirms the revision does not affect them.",
                resolve="A reviewer decides the impact assessment: the results stand, or "
                "the testing is re-performed.",
            )
        )
    state: State
    if facts.impact_pending:
        # Nothing relies on the results, and nothing is tested further, until decided.
        state = "IMPACT_PENDING"
    elif facts.review_status == "SIGNED_OFF":
        state = "CONCLUDED"
    elif facts.sheet_status == "SIGNED_OFF":
        state = "READY_FOR_REVIEW"
    elif conflict_blockers:
        state = "CONFLICT_REQUIRES_REVIEW"
    elif criteria or scope_blockers:
        state = "NEEDS_INFORMATION"
    elif plan_blockers:
        state = "PLAN_NOT_APPROVED"
    elif process:
        state = "PROCESS_UNDERSTANDING_INCOMPLETE"
    elif evidence:
        state = "EVIDENCE_PENDING"
    else:
        state = "READY"
    return ReadinessBody(
        control_id=facts.id,
        state=state,
        label=STATE_LABELS[state],
        classifications=facts.classifications,
        process_required=process_required,
        checks=[
            plan_check,
            criteria_check,
            process_check,
            evidence_check,
            scope_check,
            conflict_check,
        ],  # fmt: skip
    )


def assess(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ReadinessBody | None:
    found = load_facts(connection, project_id, control_id).get(control_id)
    return None if found is None else evaluate(found)


def readiness_states(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, ReadinessBody]:
    return {cid: evaluate(found) for cid, found in load_facts(connection, project_id).items()}


class NotReady(Exception):
    def __init__(self, readiness: ReadinessBody) -> None:
        self.readiness = readiness
        self.detail = "control not ready"


def require_testable(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> None:
    """Testing starts only when the control is defined, understood where that matters, and
    free of unresolved conflicts."""
    found = assess(connection, project_id, control_id)
    if found is not None and found.blocking:
        raise NotReady(found)


def waiting_reason(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> str:
    """Why the tester waits for this control, or "" when it may test."""
    found = assess(connection, project_id, control_id)
    if found is None or not found.blocking:
        return ""
    first = found.first_blocker()
    return f"Testing waits: {found.label.lower()}." + (f" {first}" if first else "")


def resume_testing(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[UUID]:
    """Once a control is no longer blocked, its open sheets that waited are asked to run
    again. Returns the sheets for the caller to schedule."""
    if waiting_reason(connection, project_id, control_id):
        return []
    from ai_workforce_api.db import transaction
    from ai_workforce_api.testing_engine import request_run

    with transaction(connection) as cursor:
        waiting = cursor.execute(
            """
            UPDATE test_sheets SET waiting_note = ''
            WHERE project_id = %s AND engagement_control_id = %s AND status = 'OPEN'
              AND waiting_note <> ''
            RETURNING id
            """,
            (project_id, control_id),
        ).fetchall()
        return [
            sheet
            for row in waiting
            if (sheet := request_run(cursor, UUID(str(row[0])))) is not None
        ]
