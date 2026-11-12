"""Phase-based release (master test plans, milestone E; D&I release, B1).

Every applicable phase's evidence is planned in advance. Requests are released
progressively, each phase by a person's release of it for the control (`phase_releases`,
migrations 0081 and 0145). The agents never release a phase.

- Design and implementation (D&I): its own release, once Control Understanding is complete
  (decided by the product owner on 8 November 2026) and the control's attributes are settled
  (11 November 2026: D&I is a test of one against the attributes, and the attributes decide
  the evidence asked for). It does not wait for the rest of the test plan (scope, sampling),
  and revising the plan does not hold it. Releasing it requests the Design phase's evidence
  items, and the release's audit record keeps the attributes they were requested against.
  Since 12 November 2026 (B1e, the D&I requests list; the product owner: "Why do I need to
  have the release button? Simplify the workflow.") nobody presses a release: a person
  accepts each D&I request, every approved attribute is addressed by a request or has a
  recorded exception, and the request of the person who completes that list releases the
  D&I evidence (settle_design), recorded as theirs and marked automatic. Never an agent's
  decision: the one release a worker completes is for a list a person had already
  completed while the planner's run was still at work, recorded when that run ends as the
  last acceptor's and marked deferred (settle_design_after_run). There is no early D&I
  release any more.
- Interim and the roll-forward: on an approved test plan, once the D&I conclusion is signed
  off effective (B0); the roll-forward once interim testing is signed off (or, where interim
  does not apply, once D&I is). Their requests are prepared in advance and go for approval
  once released.

The platform recommends an operating phase's release when what comes before it is
complete. A person may release an operating phase before then, for one control, with the
reason recorded.

A released phase only lets its requests go for approval: each request is still approved,
and sent, by a person. Releasing never sends anything.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from ai_workforce_api.after_commit import after_commit, committed
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_planning import PHASE_LABELS
from ai_workforce_api.evidence_plans import (
    GATE_DESIGN_RELEASE,
    LISTED_STATUSES,
    PlanState,
    _audit,
)
from ai_workforce_api.settings import Settings

Released = Literal["DESIGN", "INTERIM", "ROLLFORWARD"]
RELEASED_PHASES: tuple[Released, ...] = ("DESIGN", "INTERIM", "ROLLFORWARD")
_OPERATING: tuple[str, ...] = ("INTERIM", "ROLLFORWARD")
GATE_RELEASE: dict[str, str] = {
    "DESIGN": GATE_DESIGN_RELEASE,
    "INTERIM": "release the interim phase first",
    "ROLLFORWARD": "release the roll-forward phase first",
}
_APPLIES = ("APPLICABLE", "CONDITIONAL")
_APPROVED = ("APPROVED", "CHANGES_PROPOSED")
PhaseStep = Literal[
    "NOT_APPLICABLE",
    "AWAITING_PLAN",
    "WAITING",
    "READY",
    "RELEASED",
    "COMPLETE",
]
STEP_LABELS: dict[str, str] = {
    "NOT_APPLICABLE": "Not applicable",
    "AWAITING_PLAN": "Waiting for the test plan",
    "WAITING": "Waiting for the earlier phase",
    "READY": "Ready to release",
    "RELEASED": "Released",
    "COMPLETE": "Complete",
}


def release_reason(
    connection: psycopg.Connection[Any], control_id: UUID, phase: str | None
) -> str | None:
    """Why the control's requests for an operating phase cannot go for approval yet, or
    None: the phase is released (or needs no release)."""
    if phase not in RELEASED_PHASES:
        return None
    row = connection.execute(
        "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = %s",
        (control_id, phase),
    ).fetchone()
    return release_reason_from(row is not None, phase)


def release_reason_from(released: bool, phase: str | None) -> str | None:
    """release_reason from whether the phase is released for the control."""
    if phase not in RELEASED_PHASES:
        return None
    return None if released else GATE_RELEASE[phase]


def released_phases(connection: psycopg.Connection[Any], project_id: UUID) -> set[tuple[UUID, str]]:
    """Every (control, phase) released on the engagement, read once."""
    return {
        (UUID(str(row[0])), str(row[1]))
        for row in connection.execute(
            """
            SELECT r.engagement_control_id, r.phase FROM phase_releases r
            JOIN engagement_controls c ON c.id = r.engagement_control_id
            WHERE c.project_id = %s
            """,
            (project_id,),
        ).fetchall()
    }


def understanding_waits(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, str]:
    """What each control's understanding still waits for, in a sentence; a control missing
    from the result is understood. Control Understanding is complete when every client value
    the control's statement asks is answered, no question on the control is open, for a
    business process control its process understanding is confirmed (as the workflow's
    Control Understanding step reads it), and every required walkthrough question asked for
    it has a confirmed answer (11 November 2026; walkthrough_answers). The walkthrough is
    checked last, so the earlier waits read as before; optional questions never hold it."""
    from ai_workforce_api.control_context import (
        classifications_of,
        needs_process_understanding,
    )
    from ai_workforce_api.control_design import unanswered_values
    from ai_workforce_api.walkthrough_answers import unanswered_required

    one = control_id is not None
    params = {"p": project_id, "c": control_id}
    which = "c.id = %(c)s" if one else "c.included"
    rows = connection.execute(
        f"""
        SELECT c.id, c.classifications, c.domain, c.nature, u.status,
               coalesce(c.library_key, ''), coalesce(c.frequency, '')
        FROM engagement_controls c
        LEFT JOIN process_understandings u ON u.engagement_control_id = c.id
        WHERE c.project_id = %(p)s AND {which}
        """,
        params,
    ).fetchall()
    questions = {
        UUID(str(row[0])): int(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, count(*) FROM control_context_issues "
            "WHERE project_id = %(p)s AND status = 'OPEN' GROUP BY 1",
            params,
        ).fetchall()
    }
    missing = unanswered_values(connection, project_id)
    # One read of the engagement's confirmed walkthrough answers (or the one control's).
    walkthrough = unanswered_required(
        connection,
        project_id,
        [(UUID(str(row[0])), str(row[5]), str(row[3] or ""), str(row[6])) for row in rows],
        control_id,
    )
    waits: dict[UUID, str] = {}
    for cid, classifications, domain, nature, understanding, _library, _frequency in rows:
        control = UUID(str(cid))
        if missing.get(control):
            count = missing[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} question"
                f"{' is' if count == 1 else 's are'} not answered."
            )
        elif questions.get(control):
            count = questions[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} question"
                f"{' is' if count == 1 else 's are'} open."
            )
        elif (
            needs_process_understanding(
                classifications_of(classifications, str(domain), str(nature or ""))
            )
            and understanding != "CONFIRMED"
        ):
            waits[control] = (
                "Control Understanding is not complete: the process understanding is not confirmed."
            )
        elif walkthrough.get(control):
            count = walkthrough[control]
            waits[control] = (
                f"Control Understanding is not complete: {count} walkthrough question"
                f"{' is' if count == 1 else 's are'} not answered."
            )
    return waits


def _counted(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


# An approved attribute's criteria that wait only for a person's acceptance, over
# control_attributes as `a`: the planner agent tailored them, or they were prepared with the
# demo, they are complete, and no person has accepted them. Accepting them owns them
# (control_attributes.CRITERIA_OWNED_SQL); any other unowned criteria (none at all, or a
# person's own left incomplete) still need tailoring.
_CRITERIA_TO_ACCEPT_SQL = """
    (a.criteria_origin IN ('AGENT', 'SEEDED') AND a.criteria_accepted_at IS NULL
     AND (a.judgment_required IS TRUE
          OR (a.condition <> '' AND a.pass_criteria <> '' AND a.fail_criteria <> '')))
"""


# The approved narrative's run holds the control's attributes (engagement_controls as `c`):
# it waits, or works under a live lease (a WORKING run with no lease is held, as
# process_narrative never reclaims it); one whose lease ran out was interrupted and holds
# nothing. Read by attribute_waits and by the D&I requests list's `working`.
NARRATIVE_AT_WORK_SQL = """
    EXISTS (SELECT 1 FROM process_narrative_runs r
            WHERE r.engagement_control_id = c.id
              AND (r.run_status = 'PENDING'
                   OR (r.run_status = 'WORKING'
                       AND (r.run_lease_until IS NULL
                            OR r.run_lease_until >= clock_timestamp()))))
"""


def attribute_waits(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, str]:
    """What each control's attributes still wait for, in a sentence; a control missing from
    the result has its attributes settled. The D&I evidence is a test of one against them
    (product owner, 11 November 2026), so its release is recommended only once they are.
    Settled is evidence_plans.ATTRIBUTES_SETTLED_SQL's rule (approved attributes, none
    proposed, no open question about them), read here with its counts, with the attribute
    agent not still at work on the control (its proposals would follow), and with every
    approved attribute's criteria tailored to the control and owned by a person
    (control_attributes.CRITERIA_OWNED_SQL): the testers judge evidence against them. Unowned
    criteria are worded by what they wait for: a person's acceptance (_CRITERIA_TO_ACCEPT_SQL),
    or tailoring. A narrative run holds the attributes while it waits, or works under a live
    lease (a WORKING run with no lease is held, as process_narrative never reclaims it); one
    whose lease ran out was interrupted and is reclaimed, so it holds nothing. The plan's run
    that follows the understanding (12 November 2026: it has a run_stage; it proposes,
    tailors and reviews, evidence_plans.queue_for_understanding) reads the same way while
    criteria are not owned, with the same lease rule; the planner's plain run, which only
    plans evidence, never does: those attributes were waiting already, so the planner's run
    changes what they are said to wait for and never holds attributes that were settled."""
    from ai_workforce_api.control_attributes import CRITERIA_OWNED_SQL

    one = control_id is not None
    params = {"p": project_id, "c": control_id}
    which = "c.id = %(c)s" if one else "c.included"
    rows = connection.execute(
        f"""
        SELECT c.id,
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'),
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'PROPOSED'),
               (SELECT count(*) FROM control_context_issues i
                WHERE i.engagement_control_id = c.id AND i.status = 'OPEN'
                  AND i.origin IN ('ATTRIBUTES', 'SOURCES')),
               {NARRATIVE_AT_WORK_SQL},
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'
                  AND NOT coalesce({CRITERIA_OWNED_SQL}, false)
                  AND coalesce({_CRITERIA_TO_ACCEPT_SQL}, false)),
               (SELECT count(*) FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED'
                  AND NOT coalesce({CRITERIA_OWNED_SQL}, false)
                  AND NOT coalesce({_CRITERIA_TO_ACCEPT_SQL}, false)),
               EXISTS (SELECT 1 FROM evidence_plans p
                       WHERE p.engagement_control_id = c.id AND p.run_stage <> ''
                         AND (p.run_status = 'PENDING'
                              OR (p.run_status = 'WORKING'
                                  AND (p.run_lease_until IS NULL
                                       OR p.run_lease_until >= clock_timestamp()))))
        FROM engagement_controls c
        WHERE c.project_id = %(p)s AND {which}
        """,
        params,
    ).fetchall()
    waits: dict[UUID, str] = {}
    for cid, approved, proposed, questions, working, to_accept, untailored, planning in rows:
        control = UUID(str(cid))
        if working or (planning and (int(to_accept) > 0 or int(untailored) > 0)):
            waits[control] = "The attributes are not settled: the agent is still updating them."
        elif int(proposed) > 0:
            waits[control] = (
                f"The attributes are not settled: {_counted(int(proposed), 'proposed attribute')} "
                f"{'waits' if int(proposed) == 1 else 'wait'} for a decision."
            )
        elif int(questions) > 0:
            waits[control] = (
                f"The attributes are not settled: {_counted(int(questions), 'question')} about "
                f"them {'is' if int(questions) == 1 else 'are'} open."
            )
        elif int(approved) == 0:
            waits[control] = "The attributes are not settled: no attribute is approved."
        elif int(to_accept) > 0 or int(untailored) > 0:
            parts = []
            if int(to_accept) > 0:
                count = int(to_accept)
                parts.append(
                    f"{_counted(count, 'attribute')} {'has' if count == 1 else 'have'} "
                    "criteria to accept"
                )
            if int(untailored) > 0:
                count = int(untailored)
                parts.append(
                    f"{_counted(count, 'attribute')} {'needs' if count == 1 else 'need'} "
                    "criteria tailored to this control"
                )
            waits[control] = f"The attributes are not settled: {' and '.join(parts)}."
    return waits


# A D&I evidence item that will be, or was, obtained (evidence_requirements as `q`): planned,
# waiting for the item it depends on, or requested. Not a waived one (it will not be
# obtained, so it evidences nothing), not a removed one, and not one that exists only as an
# addition proposed on an approved plan, which a person has not accepted
# (pending_change.add, as evidence_plans.issue reads it).
_LIVE_REQUIREMENT_SQL = """
    (q.status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED')
     AND NOT coalesce((q.pending_change ->> 'add')::boolean, false))
"""


def uncovered_attributes(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, list[UUID]]:
    """Per control, its approved attributes that the D&I evidence does not cover, in the
    control's order: no live D&I request (_LIVE_REQUIREMENT_SQL) is linked to the attribute
    (evidence_requirement_attributes), and no person recorded why it is not evidenced at
    D&I (design_coverage_exceptions). A control every one of whose approved attributes is
    covered or excepted is not in the result."""
    one = control_id is not None
    which = "c.id = %(c)s" if one else "c.included"
    found: dict[UUID, list[UUID]] = {}
    for cid, attribute in connection.execute(
        f"""
        SELECT c.id, a.id
        FROM engagement_controls c
        JOIN control_attributes a ON a.engagement_control_id = c.id AND a.status = 'APPROVED'
        WHERE c.project_id = %(p)s AND {which}
          AND NOT EXISTS (
              SELECT 1 FROM evidence_requirement_attributes ra
              JOIN evidence_requirements q ON q.id = ra.requirement_id
              WHERE ra.attribute_id = a.id AND q.engagement_control_id = c.id
                AND q.phase = 'DESIGN' AND {_LIVE_REQUIREMENT_SQL})
          AND NOT EXISTS (
              SELECT 1 FROM design_coverage_exceptions x
              WHERE x.attribute_id = a.id AND x.engagement_control_id = c.id)
        ORDER BY c.id, a.position, a.created_at
        """,
        {"p": project_id, "c": control_id},
    ).fetchall():
        found.setdefault(UUID(str(cid)), []).append(UUID(str(attribute)))
    return found


def design_untraced(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, str]:
    """The controls whose D&I evidence cannot be tested against their attributes, with why,
    in a sentence.

    As first built (12 November 2026, the none-at-all rule): the control has approved
    attributes and D&I items, and no D&I item that is live (_LIVE_REQUIREMENT_SQL: planned,
    waiting for its dependency, or requested; not waived, removed, or only a proposed
    addition) is linked to any of them. D&I is a test of one against the attributes, so a
    release from such a plan would request evidence nobody could judge against them; it is
    not recommended, and it is an exception a person sees (found on 12 November 2026: a
    re-plan left the walkthrough instance with no attribute links, and the release still
    read as ready, "tested against 4 attributes"). The planner now puts every attribute on
    the instance (evidence_planning._instance_against_every_attribute), so planning the
    evidence again clears it. A control with no approved attribute is not listed: the
    attributes hold it already (attribute_waits).

    Since the D&I requests list (B1e, the same day; the product owner: "For each request, I
    want to show which specific attributes it is addressing to make sure I get coverage")
    the rule is per attribute: a control is listed when any approved attribute is addressed
    by no live D&I request and has no recorded exception (uncovered_attributes). The
    none-at-all case is the same rule with every attribute uncovered. Then there was no
    field to record why an attribute is not evidenced at D&I; there is one now
    (design_coverage_exceptions), recorded by a person with the reason. It is cleared by
    linking the attribute to a request, by planning the evidence again, or by the
    exception. Only a live request counts, as before."""
    return {
        control: (
            "The D&I requests do not cover the attributes: "
            f"{_counted(len(attributes), 'approved attribute')} "
            f"{'is' if len(attributes) == 1 else 'are'} not addressed by any D&I request. "
            "Add each to a request, or record why it is not evidenced at D&I."
        )
        for control, attributes in uncovered_attributes(connection, project_id, control_id).items()
    }


# A D&I request in the list that waits for a person (evidence_requirements as `q`): in the
# list (evidence_plans.LISTED_STATUSES; an addition the planner proposed included) and not
# accepted by a person, or carrying a change the planner proposed.
_TO_ACCEPT_SQL = f"""
    (q.phase = 'DESIGN' AND q.status IN ({", ".join(repr(item) for item in LISTED_STATUSES)})
     AND (q.accepted_at IS NULL OR q.pending_change IS NOT NULL))
"""

RequestWait = Literal["PLANNING", "ACCEPT", "NONE"]
_REQUEST_LABELS: dict[str, str] = {
    "PLANNING": "Requests being updated",
    "ACCEPT": "Requests to accept",
    "NONE": "No D&I request yet",
}


def request_waits(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, tuple[RequestWait, str]]:
    """What each planned control's D&I requests list still waits for, with the sentence; a
    control missing from the result has every live D&I request accepted by a person, with
    no change pending, and the planner not at work (B1e, 12 November 2026).

    PLANNING: the plan's run waits or works (run_status PENDING or WORKING), so the list
    may still change; nothing is settled, accepted or released under a run. ACCEPT: a
    request in the list is not accepted, or carries a change the planner proposed. NONE:
    there is no live D&I request to ask the client for. A control without a plan is not
    listed: the phase status says it is not planned."""
    one = control_id is not None
    which = "c.id = %(c)s" if one else "c.included"
    waits: dict[UUID, tuple[RequestWait, str]] = {}
    for cid, running, to_accept, live in connection.execute(
        f"""
        SELECT c.id, p.run_status IN ('PENDING', 'WORKING'),
               (SELECT count(*) FROM evidence_requirements q
                WHERE q.engagement_control_id = c.id AND {_TO_ACCEPT_SQL}),
               (SELECT count(*) FROM evidence_requirements q
                WHERE q.engagement_control_id = c.id AND q.phase = 'DESIGN'
                  AND {_LIVE_REQUIREMENT_SQL})
        FROM engagement_controls c
        JOIN evidence_plans p ON p.engagement_control_id = c.id
        WHERE c.project_id = %(p)s AND {which}
        """,
        {"p": project_id, "c": control_id},
    ).fetchall():
        control = UUID(str(cid))
        if running:
            waits[control] = ("PLANNING", "The planner is still updating the D&I requests.")
        elif int(to_accept) > 0:
            count = int(to_accept)
            waits[control] = (
                "ACCEPT",
                f"{_counted(count, 'D&I request')} {'waits' if count == 1 else 'wait'} "
                "to be accepted.",
            )
        elif int(live) == 0:
            waits[control] = ("NONE", "No D&I request is planned. Add a request.")
    return waits


DesignWaitingOn = Literal["UNDERSTANDING", "ATTRIBUTES", "EVIDENCE", "REQUESTS"]


class DesignWaits:
    """What each control's D&I requests list waits for before it is settled, read once for
    an engagement (or one control): the one rule the phase status, the plan's summary, the
    release route and settle_design all read, so they never disagree.

    Settled (B1e, product owner, 12 November 2026): Control Understanding complete; the
    attributes settled; the planner not at work on the plan; at least one live D&I
    request; every D&I request in the list accepted by a person with no change pending;
    and every approved attribute addressed by a live D&I request or excepted by a person.
    Checked in that order, except that an attribute left uncovered is said before the
    requests still to accept: it is the exception that needs a person's judgment, and the
    plan may have to change before its requests are accepted."""

    def __init__(
        self, connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
    ) -> None:
        self.understanding = understanding_waits(connection, project_id, control_id)
        self.attributes = attribute_waits(connection, project_id, control_id)
        self.requests = request_waits(connection, project_id, control_id)
        self.untraced = design_untraced(connection, project_id, control_id)

    def of(self, control: UUID) -> tuple[DesignWaitingOn, str, str] | None:
        """What the control's list waits on, the sentence, and the step's label; None when
        it is settled."""
        if control in self.understanding:
            return "UNDERSTANDING", self.understanding[control], "Waiting for understanding"
        if control in self.attributes:
            return "ATTRIBUTES", self.attributes[control], "Waiting for the attributes"
        request = self.requests.get(control)
        if request is not None and request[0] == "PLANNING":
            return "REQUESTS", request[1], _REQUEST_LABELS["PLANNING"]
        if control in self.untraced:
            return (
                "EVIDENCE",
                self.untraced[control],
                "Evidence not planned against the attributes",
            )
        if request is not None:
            return "REQUESTS", request[1], _REQUEST_LABELS[request[0]]
        return None


def design_wait(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> tuple[str, str] | None:
    """What the control's D&I requests list waits on and the sentence, or None when it is
    settled (DesignWaits), whether or not it is released already. A control with no plan,
    or whose plan says the D&I phase does not apply, has no list to settle."""
    phase = connection.execute(
        "SELECT applicability FROM evidence_plan_phases WHERE project_id = %s "
        "AND engagement_control_id = %s AND phase = 'DESIGN'",
        (project_id, control_id),
    ).fetchone()
    if phase is None:
        return "", "The control is not planned."
    if phase[0] not in _APPLIES:
        return "", "The test plan says the D&I phase does not apply."
    found = DesignWaits(connection, project_id, control_id).of(control_id)
    return None if found is None else (found[0], found[1])


def approved_attributes(connection: psycopg.Connection[Any], control_id: UUID) -> list[str]:
    """The control's approved attributes, in their order, as worded now."""
    return [
        str(row[0])
        for row in connection.execute(
            "SELECT text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            (control_id,),
        ).fetchall()
    ]


class PhaseStatus(BaseModel):
    phase: Literal["DESIGN", "INTERIM", "ROLLFORWARD"]
    label: str
    applicability: str | None
    complete: bool
    step: PhaseStep
    step_label: str
    released_by: str | None = None
    released_at: datetime | None = None
    early: bool = False
    reason: str = ""
    # What it waits for, in words, when it is not ready.
    waiting_for: str = ""
    # What the D&I release waits on, for the screens that point to it: Control
    # Understanding, or the attributes (11 November 2026). Empty otherwise.
    # EVIDENCE (12 November 2026): no D&I item evidences any approved attribute, so the
    # evidence could not be tested against them. Since the D&I requests list (B1e, the same
    # day) it is per attribute: an approved attribute is addressed by no live D&I request
    # and has no recorded exception.
    # REQUESTS (B1e): the D&I requests list is not settled: a request waits to be accepted
    # ("Requests to accept"), the planner is still updating the list, or there is no
    # request yet. The step's label and waiting_for say which.
    waiting_on: Literal["", "UNDERSTANDING", "ATTRIBUTES", "EVIDENCE", "REQUESTS"] = ""
    # The D&I release the server recorded in the request of the person who completed the
    # requests list (B1e); released_by names that person.
    automatic: bool = False


class ControlPhases(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    application: str
    # The units it operates in, when split by them (Release 1).
    units: str = ""
    plan_status: str | None
    phases: list[PhaseStatus]


def _statuses(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> list[ControlPhases]:
    one = control_id is not None
    where = "c.project_id = %(p)s AND " + ("c.id = %(c)s" if one else "c.included")
    params = {"p": project_id, "c": control_id}
    controls = connection.execute(
        f"""
        SELECT c.id, c.control_ref, c.title, coalesce(a.name, ''), p.status
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN evidence_plans p ON p.engagement_control_id = c.id
        WHERE {where}
        ORDER BY c.control_ref, a.name
        """,
        params,
    ).fetchall()
    from ai_workforce_api.implementations import operating_names

    units = operating_names(connection, project_id)
    scope = "project_id = %(p)s" + (" AND engagement_control_id = %(c)s" if one else "")
    applicability: dict[tuple[UUID, str], str] = {
        (UUID(str(row[0])), str(row[1])): str(row[2])
        for row in connection.execute(
            f"SELECT engagement_control_id, phase, applicability FROM evidence_plan_phases "
            f"WHERE {scope}",
            params,
        ).fetchall()
    }
    # D&I is complete once its conclusion is signed off effective (B0, 8 November 2026).
    from ai_workforce_api.design_conclusions import effective_controls

    designed = effective_controls(connection, project_id, control_id if one else None)
    design_waits = DesignWaits(connection, project_id, control_id if one else None)
    tested = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"SELECT engagement_control_id FROM test_sheets WHERE {scope} "
            "AND test_round_id IS NULL AND status = 'SIGNED_OFF'",
            params,
        ).fetchall()
    }
    rolled = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"""
            SELECT DISTINCT ON (engagement_control_id) engagement_control_id
            FROM test_rounds WHERE {scope} AND kind = 'ROLLFORWARD' AND status = 'SIGNED_OFF'
            ORDER BY engagement_control_id, number DESC
            """,
            params,
        ).fetchall()
    }
    releases: dict[tuple[UUID, str], tuple[Any, ...]] = {
        (UUID(str(row[0])), str(row[1])): tuple(row[2:])
        for row in connection.execute(
            f"""
            SELECT r.engagement_control_id, r.phase, u.display_name, r.released_at, r.early,
                   r.reason, r.automatic
            FROM phase_releases r LEFT JOIN users u ON u.id = r.released_by
            WHERE r.{scope}
            """,
            params,
        ).fetchall()
    }
    found: list[ControlPhases] = []
    for cid, ref, title, application, plan_status in controls:
        control = UUID(str(cid))
        approved = plan_status in _APPROVED
        complete = {
            "DESIGN": control in designed,
            "INTERIM": control in tested,
            "ROLLFORWARD": control in rolled,
        }
        phases: list[PhaseStatus] = []
        for phase in ("DESIGN", "INTERIM", "ROLLFORWARD"):
            decided = applicability.get((control, phase))
            applies = decided in _APPLIES
            release = releases.get((control, phase))
            status = PhaseStatus(
                phase=phase,
                label=PHASE_LABELS[phase],
                applicability=decided,
                complete=complete[phase],
                step="NOT_APPLICABLE",
                step_label="",
            )
            if release is not None:
                status.released_by = None if release[0] is None else str(release[0])
                status.released_at, status.early, status.reason = (
                    release[1],
                    bool(release[2]),
                    str(release[3]),
                )
                status.automatic = bool(release[4])
            label = ""
            if decided is None:
                status.step, status.waiting_for = "AWAITING_PLAN", "The control is not planned."
            elif not applies:
                status.step = "NOT_APPLICABLE"
            elif complete[phase]:
                status.step = "COMPLETE"
            elif release is not None:
                status.step = "RELEASED"
            elif phase == "DESIGN":
                # Its own release, once the control is understood (B1) and its attributes
                # are settled (11 November 2026); never the plan's approval. Since the
                # D&I requests list (B1e, 12 November 2026) also once every request is
                # accepted and every attribute covered (DesignWaits): READY is the
                # settled list, which the request that settles it releases at once, so
                # it is read only when nothing a person did was last to complete it.
                wait = design_waits.of(control)
                if wait is None:
                    status.step = "READY"
                else:
                    status.step = "WAITING"
                    status.waiting_on, status.waiting_for, label = wait
            elif not approved:
                status.step, status.waiting_for = "AWAITING_PLAN", "Approve the test plan."
            else:
                earlier = _earlier(phase, applicability, control, complete)
                status.step = "READY" if earlier is None else "WAITING"
                status.waiting_for = earlier or ""
            status.step_label = (
                "Released early"
                if status.step == "RELEASED" and status.early
                else label or STEP_LABELS[status.step]
            )
            phases.append(status)
        found.append(
            ControlPhases(
                control_id=control,
                control_ref=str(ref),
                title=str(title),
                application=str(application),
                units=units.get(control, ""),
                plan_status=plan_status,
                phases=phases,
            )  # fmt: skip
        )
    return found


def _earlier(
    phase: str,
    applicability: dict[tuple[UUID, str], str],
    control: UUID,
    complete: dict[str, bool],
) -> str | None:
    """What the phase waits for before its release is recommended, or None when ready."""
    if not complete["DESIGN"]:
        return "The D&I conclusion is not signed off as effective."
    if phase == "ROLLFORWARD" and applicability.get((control, "INTERIM")) in _APPLIES:
        if not complete["INTERIM"]:
            return "Interim testing is not signed off."
    return None


class PhaseProgress(BaseModel):
    controls: list[ControlPhases]
    # How many controls are ready to release each phase, and how many have it released.
    ready: dict[str, int]
    released: dict[str, int]
    # What to do next, as the platform recommends it (never done for the reviewer).
    recommendation: str
    viewer_can_release: bool = False


def progress(connection: psycopg.Connection[Any], project_id: UUID) -> PhaseProgress:
    rows = _statuses(connection, project_id)
    ready: dict[str, int] = {phase: 0 for phase in RELEASED_PHASES}
    released: dict[str, int] = {phase: 0 for phase in RELEASED_PHASES}
    for row in rows:
        for item in row.phases:
            if item.phase in ready and item.step == "READY":
                ready[item.phase] += 1
            if item.phase in released and item.step in ("RELEASED", "COMPLETE"):
                released[item.phase] += 1
    recommendation = ""
    if ready["DESIGN"]:
        count = ready["DESIGN"]
        recommendation = (
            f"Control Understanding is complete for {count} control"
            f"{'' if count == 1 else 's'}. The D&I evidence is ready to release."
        )
    elif ready["INTERIM"]:
        count = ready["INTERIM"]
        recommendation = (
            f"Design and implementation testing has been completed for {count} control"
            f"{'' if count == 1 else 's'}. The interim evidence requests are ready for review."
        )
    elif ready["ROLLFORWARD"]:
        count = ready["ROLLFORWARD"]
        recommendation = (
            f"Interim testing has been completed for {count} control"
            f"{'' if count == 1 else 's'}. The roll-forward evidence requests are ready for "
            "review."
        )
    return PhaseProgress(
        controls=rows, ready=ready, released=released, recommendation=recommendation
    )


def phase_statuses(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, ControlPhases]:
    """Every in-scope control's phases, by control (the controls register reads them)."""
    return {row.control_id: row for row in _statuses(connection, project_id)}


def phases_of(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ControlPhases | None:
    found = _statuses(connection, project_id, control_id)
    return found[0] if found else None


class ReleaseBody(BaseModel):
    # Required (at least 20 characters) when the earlier phase is not complete.
    reason: str = Field(default="", max_length=1000)


def release(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: Released,
    actor: UUID,
    body: ReleaseBody,
) -> bool:
    """A person releases the control's phase. Idempotent: a released phase stays as it was.
    Returns whether this call released it. An operating phase needs the approved plan and
    the D&I conclusion signed off effective, and may be released early with a reason.

    The D&I evidence needs a plan, not its approval, and (B1e, product owner, 12 November
    2026: "Why do I need to have the release button? Simplify the workflow.") is released
    only once its requests list is settled: the same rule settle_design applies in the
    request of the person who completes the list, which is how it is normally released.
    This route stays for the list a person's own request was not the last to complete (the
    planner finished after their last change). There is no early D&I release: before the
    list is settled it is refused with what it waits for, reason or not."""
    reason = " ".join(body.reason.split())
    with transaction(connection) as cursor:
        plan = cursor.execute(
            "SELECT status, revision, run_status FROM evidence_plans WHERE project_id = %s "
            "AND engagement_control_id = %s FOR UPDATE",
            (project_id, control_id),
        ).fetchone()
        if plan is None:
            raise PlanState("plan the evidence first")
        if phase == "DESIGN" and str(plan[2]) in ("PENDING", "WORKING"):
            raise PlanState("The planner is still drafting the plan.")
        if phase != "DESIGN" and str(plan[0]) not in _APPROVED:
            raise PlanState("approve the test plan first")
        if (
            cursor.execute(
                "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = %s",
                (control_id, phase),
            ).fetchone()
            is not None
        ):
            return False
        status = phases_of(cursor.connection, project_id, control_id)
        current = (
            None
            if status is None
            else next((item for item in status.phases if item.phase == phase), None)
        )
        if current is None or current.step == "NOT_APPLICABLE":
            raise PlanState(f"the test plan says the {phase_word(phase)} phase does not apply")
        if phase == "DESIGN":
            if current.step != "READY":
                raise PlanState(
                    current.waiting_for
                    or "The D&I requests list is not settled, so the D&I evidence is not released."
                )
            _record_design_release(
                cursor, organization_id, project_id, control_id, actor, plan[1],
                automatic=False, reason=reason,
            )  # fmt: skip
            return True
        from ai_workforce_api.design_conclusions import oe_gate_reason

        gated = oe_gate_reason(cursor.connection, control_id)
        if gated is not None:
            raise PlanState(gated)
        early = current.step != "READY"
        if early and len(reason) < 20:
            raise PlanState(
                f"{current.waiting_for} Say why the {phase_word(phase)} phase is released now."
            )
        cursor.execute(
            """
            INSERT INTO phase_releases (
                organization_id, project_id, engagement_control_id, phase, early, reason,
                plan_revision, released_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, control_id, phase, early, reason, plan[1], actor),
        )
        _audit(
            cursor, organization_id, project_id, actor, "phase.released", "engagement_control",
            control_id, {"phase": phase, "early": early, "reason": reason},
        )  # fmt: skip
    return True


def _record_design_release(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    plan_revision: Any,
    automatic: bool,
    reason: str = "",
    deferred: dict[str, Any] | None = None,
) -> None:
    """Record the D&I release of a settled requests list, by the person named, with what
    was released on the audit trail: the approved attributes as worded then (a test of one
    is judged against them, 11 November 2026), each request with the attributes it
    addresses, and each exception a person recorded for an attribute no request addresses.
    The caller holds the plan's row and has checked the list is settled."""
    cursor.execute(
        """
        INSERT INTO phase_releases (
            organization_id, project_id, engagement_control_id, phase, early, reason,
            plan_revision, released_by, automatic
        )
        VALUES (%s, %s, %s, 'DESIGN', false, %s, %s, %s, %s)
        """,
        (organization_id, project_id, control_id, reason, plan_revision, actor, automatic),
    )
    requirements = [
        {"id": str(row[0]), "title": str(row[1]), "attribute_ids": [str(a) for a in row[2]]}
        for row in cursor.execute(
            f"""
            SELECT q.id, q.title,
                   (SELECT coalesce(array_agg(ra.attribute_id ORDER BY a.position, a.created_at),
                                    '{{}}'::uuid[])
                    FROM evidence_requirement_attributes ra
                    JOIN control_attributes a ON a.id = ra.attribute_id
                    WHERE ra.requirement_id = q.id AND a.status = 'APPROVED')
            FROM evidence_requirements q
            WHERE q.engagement_control_id = %s AND q.phase = 'DESIGN'
              AND {_LIVE_REQUIREMENT_SQL}
            ORDER BY q.created_at, q.requirement_key
            """,
            (control_id,),
        ).fetchall()
    ]
    exceptions = [
        {"attribute_id": str(row[0]), "reason": str(row[1]), "recorded_by": str(row[2])}
        for row in cursor.execute(
            """
            SELECT x.attribute_id, x.reason, x.recorded_by
            FROM design_coverage_exceptions x
            JOIN control_attributes a ON a.id = x.attribute_id
            WHERE x.engagement_control_id = %s AND a.status = 'APPROVED'
            ORDER BY a.position, a.created_at
            """,
            (control_id,),
        ).fetchall()
    ]
    _audit(
        cursor, organization_id, project_id, actor, "phase.released", "engagement_control",
        control_id,
        {
            "phase": "DESIGN",
            "early": False,
            "reason": reason,
            "automatic": automatic,
            # Recorded when the planner's run ended, for the person whose acceptance had
            # completed the list (settle_design_after_run); `run` then says which run.
            "deferred": deferred is not None,
            **({} if deferred is None else {"run": deferred}),
            "attributes": approved_attributes(cursor.connection, control_id),
            "requirements": requirements,
            "exceptions": exceptions,
        },
    )  # fmt: skip


def settle_design(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    scheduler: Any = None,
) -> bool:
    """Release the control's D&I evidence when the request a person just made left its
    requests list settled (DesignWaits), and the phase is not released yet (B1e, product
    owner, 12 November 2026: no release button; the acceptance is the approval). Called at
    the end of each request by a person that can complete the list: accepting requests,
    adding, rewording, removing, waiving or restoring one, setting the attributes one
    addresses, deciding a proposed change, recording or clearing a coverage exception, and
    what settles the attributes or completes the understanding. Returns whether this call
    released it.

    Only inside a request by an authorised person: the principal must be a person who may
    change the engagement's work (the authorization of the request that got here, checked
    again), and the release names them. Never from a worker, a scheduler or an agent: those
    have no such principal, and none of them calls this. The one release a worker completes
    is settle_design_after_run, for a list a person had already completed.

    The release is in the request's transaction; the Design phase's items are then
    requested (request_released) and their drafts handed to the worker once the request
    has committed (after_commit). Each drafted request still needs its own approval before
    it is sent: nothing is sent here. Idempotent under concurrent requests: the plan's row
    is locked, as release() locks it, and one release per control and phase is all the
    table holds."""
    if principal.kind is not PrincipalKind.USER:
        return False
    try:
        authorize(
            connection, principal=principal, action=Action.TASK_UPDATE,
            organization_id=organization_id, project_id=project_id,
        )  # fmt: skip
    except AccessDenied, NotVisible:
        return False
    with transaction(connection) as cursor:
        plan = cursor.execute(
            """
            SELECT p.revision FROM evidence_plans p
            JOIN engagement_controls c ON c.id = p.engagement_control_id
            WHERE p.project_id = %s AND p.engagement_control_id = %s
              AND p.organization_id = %s AND c.included
            FOR UPDATE OF p
            """,
            (project_id, control_id, organization_id),
        ).fetchone()
        if plan is None:
            return False
        if (
            cursor.execute(
                "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s "
                "AND phase = 'DESIGN'",
                (control_id,),
            ).fetchone()
            is not None
        ):
            return False
        status = phases_of(cursor.connection, project_id, control_id)
        current = (
            None
            if status is None
            else next((item for item in status.phases if item.phase == "DESIGN"), None)
        )
        if current is None or current.step != "READY":
            return False
        _record_design_release(
            cursor, organization_id, project_id, control_id, principal.id, plan[0],
            automatic=True,
        )  # fmt: skip
    from ai_workforce_api.pbc_drafting import DraftScheduler, schedule

    drafts = request_released(
        connection, organization_id, project_id, control_id, "DESIGN", principal.id
    )
    worker = scheduler if isinstance(scheduler, DraftScheduler) else None
    after_commit(lambda: schedule(worker, drafts))
    return True


def settle_design_after_run(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    plan_id: UUID,
) -> bool:
    """Record the D&I release of a requests list that a person completed while the planner
    was still at work, once the planner's run has ended and left it as they completed it
    (B1e; the product owner wants no release button at all, 12 November 2026). Called by
    the plan run when it finishes (evidence_plans.run_plan), and by nothing else. Returns
    whether it released.

    This is the one place a worker completes the release, and it decides nothing: the list
    is settled by the rule a person's request is held to (DesignWaits), which means every
    request on it was accepted by a person and carries no change, every approved attribute
    is addressed by an accepted request or excepted by a person, the attributes and the
    understanding are settled by people, and no run waits or works. A run that changed or
    added anything left a request unaccepted or a change pending, so the list is not
    settled and nothing is released: the person accepts, and their request releases it.

    The release is attributed to the person whose acceptance was the last on the list
    (the latest accepted_at among its live requests), recorded as automatic, and marked
    deferred on the audit trail with the run that ended and that acceptance, so the record
    says a worker wrote it and when the person's decision was made. That person must still
    be allowed to change the engagement's work now (authorize, as settle_design checks the
    person in a request); if they no longer are, nothing is released and the list waits
    for a person's request. A run that failed releases nothing either.

    The Design items are requested in the same step; their drafts wait in the database,
    where the worker that ran the plan picks them up (drafts_for_plan). Each drafted request
    still needs its own approval before it is sent."""
    with transaction(connection) as cursor:
        plan = cursor.execute(
            """
            SELECT p.revision, p.run_status FROM evidence_plans p
            JOIN engagement_controls c ON c.id = p.engagement_control_id
            JOIN projects j ON j.id = p.project_id
            WHERE p.id = %s AND p.project_id = %s AND p.engagement_control_id = %s
              AND p.organization_id = %s AND c.included
              -- Only a running engagement: a paused, completed or archived one waits.
              AND j.status::text = 'ACTIVE' AND j.deleted_at IS NULL
            FOR UPDATE OF p
            """,
            (plan_id, project_id, control_id, organization_id),
        ).fetchone()
        if plan is None or str(plan[1]) in ("PENDING", "WORKING", "FAILED"):
            return False
        if (
            cursor.execute(
                "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s "
                "AND phase = 'DESIGN'",
                (control_id,),
            ).fetchone()
            is not None
        ):
            return False
        status = phases_of(cursor.connection, project_id, control_id)
        current = (
            None
            if status is None
            else next((item for item in status.phases if item.phase == "DESIGN"), None)
        )
        if current is None or current.step != "READY":
            return False
        last = cursor.execute(
            f"""
            SELECT q.id, q.accepted_by, q.accepted_at FROM evidence_requirements q
            WHERE q.engagement_control_id = %s AND q.phase = 'DESIGN'
              AND {_LIVE_REQUIREMENT_SQL}
            ORDER BY q.accepted_at DESC NULLS FIRST, q.id DESC
            LIMIT 1
            """,
            (control_id,),
        ).fetchone()
        # Settled means every live request is accepted; a request with nobody named would
        # sort first, and then there is no person to attribute the release to.
        if last is None or last[1] is None:
            return False
        person = Principal(PrincipalKind.USER, UUID(str(last[1])))
        try:
            authorize(
                cursor.connection, principal=person, action=Action.TASK_UPDATE,
                organization_id=organization_id, project_id=project_id,
            )  # fmt: skip
        except AccessDenied, NotVisible:
            return False
        _record_design_release(
            cursor, organization_id, project_id, control_id, person.id, plan[0],
            automatic=True,
            deferred={
                "plan_id": str(plan_id),
                "last_acceptance": {"requirement": str(last[0]), "at": last[2].isoformat()},
            },
        )  # fmt: skip
    request_released(connection, organization_id, project_id, control_id, "DESIGN", person.id)
    return True


def phase_word(phase: str) -> str:
    return {"DESIGN": "D&I", "ROLLFORWARD": "roll-forward"}.get(phase, phase.lower())


def request_released(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: str,
    actor: UUID,
) -> list[UUID]:
    """After a D&I release, request the Design phase's evidence items and queue their drafts
    (evidence_plans.release). Each draft still goes for a person's approval before it is
    sent. An operating phase's requests are prepared already: nothing to request."""
    if phase != "DESIGN":
        return []
    from ai_workforce_api.evidence_plans import release as request_allowed

    return request_allowed(connection, organization_id, project_id, control_id, actor)


# Routes


class BatchRelease(BaseModel):
    """The controls a reviewer selected, each released on its own."""

    phase: Released
    control_ids: list[UUID] = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=1000)


class ReleaseOutcome(BaseModel):
    control_id: UUID
    control_ref: str
    released: bool
    detail: str


class BatchReleased(BaseModel):
    outcomes: list[ReleaseOutcome]
    released: int


def register_phase_release(app: FastAPI, settings: Settings, scheduler: Any = None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def requested(
        connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID,
        control_id: UUID, phase: str, actor: UUID,
    ) -> None:  # fmt: skip
        """A D&I release requests the Design items; their drafts go to the background, once
        the request has committed (after_commit)."""
        from ai_workforce_api.pbc_drafting import schedule

        drafts = request_released(connection, organization_id, project_id, control_id, phase, actor)
        after_commit(lambda: schedule(scheduler, drafts))

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return committed(
                lambda: _call(settings, lambda connection: work(connection, principal))
            )
        except PlanState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def allowed(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID, action: Action,
    ) -> None:  # fmt: skip
        authorize(
            connection, principal=principal, action=action,
            organization_id=organization_id, project_id=project_id,
        )  # fmt: skip
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            # An agent never releases a phase.
            raise NotVisible()

    def may_release(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID,
    ) -> bool:  # fmt: skip
        try:
            allowed(connection, principal, organization_id, project_id, Action.PROJECT_UPDATE)
        except Exception:
            return False
        return True

    def in_scope(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> str:
        row = connection.execute(
            "SELECT control_ref, included FROM engagement_controls WHERE id = %s "
            "AND project_id = %s",
            (control_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if not row[1]:
            raise PlanState("the control is out of scope")
        return str(row[0])

    @app.get(f"{base}/phase-progress")
    def read(organization_id: UUID, project_id: UUID, request: Request) -> PhaseProgress:
        def work(c: psycopg.Connection[Any], p: Principal) -> PhaseProgress:
            allowed(c, p, organization_id, project_id, Action.TASK_READ)
            body = progress(c, project_id)
            body.viewer_can_release = may_release(c, p, organization_id, project_id)
            return body

        return run(request, work)

    @app.post(f"{base}/controls/{{control_id}}/phases/{{phase}}/release")
    def release_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, phase: Released,
        body: ReleaseBody, request: Request,
    ) -> ControlPhases:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> ControlPhases:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            in_scope(c, project_id, control_id)
            release(c, organization_id, project_id, control_id, phase, p.id, body)
            requested(c, organization_id, project_id, control_id, phase, p.id)
            found = phases_of(c, project_id, control_id)
            assert found is not None
            return found

        return run(request, work)

    @app.post(f"{base}/phases/release")
    def release_many(
        organization_id: UUID, project_id: UUID, body: BatchRelease, request: Request
    ) -> BatchReleased:
        def work(c: psycopg.Connection[Any], p: Principal) -> BatchReleased:
            allowed(c, p, organization_id, project_id, Action.PROJECT_UPDATE)
            outcomes: list[ReleaseOutcome] = []
            for control_id in dict.fromkeys(body.control_ids):
                try:
                    ref = in_scope(c, project_id, control_id)
                except NotVisible, PlanState:
                    outcomes.append(ReleaseOutcome(
                        control_id=control_id, control_ref="", released=False,
                        detail="The control is not in scope.",
                    ))  # fmt: skip
                    continue
                try:
                    done = release(c, organization_id, project_id, control_id, body.phase,
                                   p.id, ReleaseBody(reason=body.reason))  # fmt: skip
                except PlanState as error:
                    outcomes.append(ReleaseOutcome(
                        control_id=control_id, control_ref=ref, released=False,
                        detail=error.detail,
                    ))  # fmt: skip
                    continue
                if done:
                    requested(c, organization_id, project_id, control_id, body.phase, p.id)
                outcomes.append(ReleaseOutcome(
                    control_id=control_id, control_ref=ref, released=done,
                    detail="" if done else "Already released.",
                ))  # fmt: skip
            return BatchReleased(
                outcomes=outcomes, released=sum(1 for item in outcomes if item.released)
            )

        return run(request, work)
