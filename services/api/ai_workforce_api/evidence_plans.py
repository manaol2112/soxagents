"""Evidence plans: each control's testing plan by phase, and the requests made from it.

A control's plan (evidence_planning.py writes it) is stored as one row per phase (design,
interim, roll-forward) and one row per evidence requirement. Requests are made from the
requirements, one request per phase at a time, so the design evidence, the interim
population, and the roll-forward evidence each go out on their own and each says why every
item is needed.

What the records keep apart:

- whether a phase applies, and why (a person's decision is kept over the planner's);
- whether a requirement was requested, received, and found sufficient: receipt never
  makes a requirement sufficient, and a phase is complete only when its testing is
  (the design workpaper prepared, the interim or roll-forward sheet signed off);
- what the planner recommended on each run, unchanged, and what a person decided.

Planning again never duplicates a requirement (the control, phase, and key identify it),
never rewrites one a person wrote or waived, and never changes one already sent or an
approved plan silently: the change waits on the requirement for a person.

Population, sample, and dependency rules: sample evidence waits for the sample, which waits
for the population; approving the samples requires the population to have been accepted
as complete and accurate (control_tests.py asks population_gate).
"""

import hashlib
import json
import logging
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.after_commit import committed
from ai_workforce_api.agent_answers import note_unusable, note_used, plain_problem
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import basis_of
from ai_workforce_api.db import independent_steps, transaction
from ai_workforce_api.evidence_apps import tag_covers
from ai_workforce_api.evidence_planning import (
    _MISSING_AS_REASON,
    CATEGORIES,
    CATEGORY_LABELS,
    PHASE_LABELS,
    PHASES,
    PLAN_SCHEMA,
    SYSTEM_PROMPT,
    Applicability,
    Category,
    ChangeKind,
    ControlChange,
    InterimResult,
    Necessity,
    Phase,
    PlanFacts,
    PlanOutput,
    RequirementPlan,
    check_plan,
    forced_decisions,
    phase_periods,
    prompt_for,
    rules_plan,
    suite_wording,
    unheld_quotes_left_out,
)
from ai_workforce_api.model_providers import (
    call_note,
    live_model,
    provider_for,
)
from ai_workforce_api.models import ModelProvider, ModelRequest
from ai_workforce_api.pbc import Delivery, delivery_of
from ai_workforce_api.provenance import AgentCaller, Call, Job, agent_actor
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

# The email template adds about 500 characters around the description.
# The full wording of a request (migration 0073); never shortened (pbc_drafting.py).
MAX_DESCRIPTION = 80_000
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_RECEIVED = ("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED")
# What the kickoff request asked for before requests were planned by phase (7.1d): its
# population, configuration, or report, and a walkthrough and the policy.
_LEGACY_KEYS = frozenset(
    {
        "design-walkthrough",
        "design-procedure",
        "design-policy",
        "design-configuration",
        "design-report-logic",
        "interim-population",
        "interim-population-support",
        "interim-configuration",
        "interim-change-history",
        "interim-report-run",
        "interim-report-reconciliation",
    }
)
_MATERIAL = ("title", "description", "categories", "necessity", "depends_on", "population_kind")

RequirementState = Literal[
    "NOT_GENERATED",
    "AWAITING_DEPENDENCY",
    "DRAFT",
    "READY_FOR_REVIEW",
    "APPROVAL_PENDING",
    "SENT",
    "OVERDUE",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "UNDER_REVIEW",
    "ACCEPTED",
    "INSUFFICIENT",
    "FOLLOW_UP_REQUIRED",
    "CANCELLED",
    "NOT_APPLICABLE",
    "REMOVED",
]
PhaseState = Literal[
    "NOT_PLANNED",
    "NOT_APPLICABLE",
    "AWAITING_CLARIFICATION",
    "CONDITIONAL",
    "NOT_GENERATED",
    "NOT_SENT",
    "OUTSTANDING",
    "RECEIVED_NOT_VALIDATED",
    "AWAITING_DEPENDENCY",
    "EVIDENCE_ACCEPTED",
    "COMPLETE",
]
Sufficiency = Literal[
    "NOT_REVIEWED", "UNDER_REVIEW", "ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED"
]  # fmt: skip

_PHASE_STATE_LABELS: dict[str, str] = {
    "NOT_PLANNED": "Evidence not planned yet",
    "NOT_APPLICABLE": "Not applicable",
    "AWAITING_CLARIFICATION": "Awaiting clarification",
    "CONDITIONAL": "Planned; requests wait for a condition",
    "NOT_GENERATED": "Requests not generated yet",
    "NOT_SENT": "Requests drafted, not sent",
    "OUTSTANDING": "Evidence outstanding",
    "RECEIVED_NOT_VALIDATED": "Evidence received, not yet validated",
    "AWAITING_DEPENDENCY": "Waiting on an earlier step",
    "EVIDENCE_ACCEPTED": "Evidence accepted; testing not complete",
    "COMPLETE": "Testing complete",
}
_REQUIREMENT_LABELS: dict[str, str] = {
    "NOT_GENERATED": "Not requested yet",
    "AWAITING_DEPENDENCY": "Waits for an earlier item",
    "DRAFT": "Being drafted",
    "READY_FOR_REVIEW": "Drafted, ready for review",
    "APPROVAL_PENDING": "Awaiting approval to send",
    "SENT": "Sent, waiting for the owner",
    "OVERDUE": "Overdue",
    "PARTIALLY_RECEIVED": "Partly received",
    "RECEIVED": "Received, not yet reviewed",
    "UNDER_REVIEW": "Under review",
    "ACCEPTED": "Accepted as sufficient",
    "INSUFFICIENT": "Insufficient",
    "FOLLOW_UP_REQUIRED": "Follow-up required",
    "CANCELLED": "Request cancelled",
    "NOT_APPLICABLE": "Not applicable",
    "REMOVED": "Removed from the plan",
}


def reference(request_id: Any) -> str:
    """The request's short reference, as its email subject carries it (outbound.py)."""
    return f"PBC-{UUID(str(request_id)).hex[-8:].upper()}"


class PlanState(Exception):
    """A 409: the plan changed, or the action does not fit its state."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


# Facts

# The approved attributes whose criteria the planner agent may write, over control_attributes
# as `a`: none a person stated (complete or not), none prepared with the demo (SEEDED), none a
# person accepted. One rule for the attributes the planner is asked to tailor (load_facts),
# for whether a run on an approved plan changes them (_criteria_differ), and for what it
# writes (_write_criteria), so the three cannot drift (review, 11 November 2026).
CRITERIA_WRITABLE_SQL = """
    (a.status = 'APPROVED'
     AND coalesce(a.criteria_origin, '') NOT IN ('PERSON', 'SEEDED')
     AND a.criteria_accepted_at IS NULL)
"""


def load_facts(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> PlanFacts:
    """Everything the planner reads about one control, from the records."""
    from ai_workforce_api.control_context import (
        applies_to,
        classifications_of,
        needs_process_understanding,
    )
    from ai_workforce_api.pbc_drafting import load_context
    from ai_workforce_api.understanding_authority import facts as understanding_facts
    from ai_workforce_api.walkthrough_answers import for_agents

    context = load_context(connection, project_id, control_id)
    row = connection.execute(
        f"""
        SELECT c.classifications,
               (SELECT p.status FROM process_understandings p
                WHERE p.engagement_control_id = c.id),
               ARRAY(
                   SELECT DISTINCT d.kind FROM source_documents d
                   WHERE d.project_id = c.project_id AND {applies_to("c.id")}
               ),
               s.status, s.conclusion,
               (SELECT t.covered_to FROM control_tests t
                WHERE t.engagement_control_id = c.id AND t.test_round_id IS NULL),
               (SELECT ARRAY[r.window_start, r.window_end] FROM test_rounds r
                WHERE r.engagement_control_id = c.id AND r.kind = 'ROLLFORWARD'
                  AND r.status <> 'CANCELLED'
                ORDER BY r.number DESC LIMIT 1)
        FROM engagement_controls c
        LEFT JOIN test_sheets s
          ON s.engagement_control_id = c.id AND s.test_round_id IS NULL
        WHERE c.id = %s AND c.project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    classes = classifications_of(row[0], context.domain, context.nature)
    changes = connection.execute(
        "SELECT effective_on, kind, description FROM control_changes "
        "WHERE engagement_control_id = %s ORDER BY effective_on, created_at",
        (control_id,),
    ).fetchall()
    window = row[6]
    library = connection.execute(
        "SELECT coalesce(library_key, ''), coalesce(source, ''), test_basis "
        "FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    keyed = tuple(
        (str(key), str(text))
        for key, text in connection.execute(
            "SELECT definition_key, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND definition_key IS NOT NULL ORDER BY position",
            (control_id,),
        ).fetchall()
    )
    # Approved attributes a person excepted from the D&I evidence: the planner proposes no
    # D&I request for them (evidence_planning.design_links_proposed).
    excepted = tuple(
        str(text)
        for (text,) in connection.execute(
            "SELECT a.text FROM control_attributes a "
            "JOIN design_coverage_exceptions x ON x.attribute_id = a.id "
            "WHERE a.engagement_control_id = %s AND a.status = 'APPROVED' "
            "ORDER BY a.position, a.created_at",
            (control_id,),
        ).fetchall()
    )
    writable = tuple(
        str(text)
        for (text,) in connection.execute(
            "SELECT a.text FROM control_attributes a WHERE a.engagement_control_id = %s "
            f"AND {CRITERIA_WRITABLE_SQL} ORDER BY a.position, a.created_at",
            (control_id,),
        ).fetchall()
    )
    return PlanFacts(
        control_ref=context.control_ref,
        title=context.title,
        activity=context.activity,
        risk=context.risk,
        domain=context.domain,
        frequency=context.frequency,
        nature=context.nature,
        key_control=context.key_control,
        owner_name=context.owner_name,
        applications=context.applications,
        attributes=context.test_attributes,
        criteria_writable=writable,
        design_excepted=excepted,
        pbc_items=context.pbc_items,
        classifications=tuple(classes),
        process_required=needs_process_understanding(classes),
        process_confirmed=row[1] == "CONFIRMED",
        documents=tuple(sorted(str(kind) for kind in row[2] or [])),
        period_end=context.period_end,
        interim=InterimResult(
            status="NOT_STARTED"
            if row[3] is None
            else ("SIGNED_OFF" if row[3] == "SIGNED_OFF" else "OPEN"),
            conclusion=None if row[4] is None else str(row[4]),
            covered_to=row[5],
        ),
        rollforward_window=None if window is None else (window[0], window[1]),
        changes=tuple(ControlChange(c[0], str(c[1]), str(c[2])) for c in changes),
        custom_fields=context.custom_fields,
        library_key="" if library is None else str(library[0]),
        test_basis="STANDARD" if library is None else basis_of(str(library[1]), library[2]),
        basis_decided=library is not None and library[2] is not None,
        attribute_keys=keyed,
        statement=statement_fields(connection, control_id),
        **narrative_facts(connection, control_id),
        walkthrough=for_agents(connection, control_id),
        confirmed=understanding_facts(connection, control_id),
        rules=context.rules,
    )


def narrative_facts(connection: psycopg.Connection[Any], control_id: UUID) -> dict[str, Any]:
    """The approved process narrative, for the planner: its sections and its steps, each
    step as one line with who, where, whether the control operates there, and the attributes
    evaluated at it."""
    from ai_workforce_api.process_understanding import approved_narrative

    found = approved_narrative(connection, control_id)
    if found is None:
        return {}
    steps = []
    for index, step in enumerate(found["steps"], start=1):
        where = ", ".join(part for part in (step["actor"], step["system"]) if part)
        line = f"{index}. {step['description']}" + (f" ({where})" if where else "")
        if step["control_point"]:
            line += " [the control operates here]"
        if step["attributes"]:
            line += " Evaluates " + ", ".join(step["attributes"]) + "."
        steps.append(line)
    return {
        "narrative": tuple((item["heading"], item["text"]) for item in found["sections"]),
        "narrative_steps": tuple(steps),
    }


def statement_fields(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[tuple[str, str], ...]:
    """The library statement as the control's documentation states it, with the client's
    values in place (a value still missing shows as its bracketed label). Empty for a
    client's own control."""
    from ai_workforce_api.control_design import design_for

    design = design_for(connection, control_id)
    if design is None:
        return ()
    found = (
        ("description", design.text), ("risk", design.risk), ("it_risk", design.it_risk),
        ("assertions", ", ".join(design.assertions)), ("type", design.control_type),
        ("nature", design.nature), ("frequency", design.frequency),
        ("performer", design.operator), ("reviewer", design.reviewer),
        ("precision", design.precision), ("investigation", design.investigation),
        ("evidence", design.evidence),
        ("information", "; ".join(
            f"{item.name} ({', '.join(item.elements)})" for item in design.information
        )),
        ("itgcs", "; ".join(design.itgcs)),
    )  # fmt: skip
    return tuple((name, " ".join(text.split())) for name, text in found if text.strip())


def fingerprint(facts: PlanFacts) -> str:
    data = json.dumps(asdict(facts), default=str, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


# Planning


@dataclass(frozen=True)
class Planned:
    output: PlanOutput
    # MODEL: the agent's checked plan. RULES: the rules by design (no model). FALLBACK:
    # the model failed or its plan was rejected, and the rules' plan stands in. SEEDED: a
    # plan prepared with the demo dataset (Step 4A), never a fresh model result.
    source: Literal["MODEL", "RULES", "FALLBACK", "SEEDED"]
    note: str
    call_id: UUID | None
    # FALLBACK only: what happened to the planner's answer, with nothing about what stood
    # in for it. A run that keeps the existing plan says this (generate, B1h).
    problem: str = ""
    # The planner's last call, for what the system made of its answer (agent_answers), and
    # MODEL only: the places of the facts left out because their quote is not in the
    # control's records (unheld_quotes_left_out).
    call: Call | None = None
    dropped: tuple[str, ...] = ()


# The planner's prompt version, recorded on every call (Milestone 3a).
# 5: tailors every attribute's criteria to the control, guided by the standard's (11 November
# 2026).
# 6: reads the walkthrough's confirmed answers as how the control operates here, for the
# evidence and the criteria (11 November 2026).
# /7 (12 November 2026): the design item that shows the control performed once lists every
# attribute (evidence_planning._instance_against_every_attribute enforces it).
# /8 (12 November 2026, B1e): the confirmed understanding with its dates, newest first; the
# planner follows it over the RCM record and the library's wording, the newer answer first.
# /10 (12 November 2026, B1h): the schema states every limit the plan is checked against,
# a linked procedure is said to be one of the phase's procedures, and a correction names
# the exact places that failed.
PLANNER_PROMPT_VERSION = "engagement-planner/10"
# Room for a whole plan: three phases, their procedures and evidence. At the provider's
# default of 4,096 a plan built on an approved narrative was cut off and the rules stood in
# (26 October 2026). The limit also holds the model's reasoning: on ITGC-AC-01 an answer
# used 5,700 to 8,600 of it and none was cut off (12 November 2026, B1h). Not raised: the
# whole allowance is reserved against the call's budget, and the call is not streamed, so
# more room would mostly be nominal. An answer that is cut off is now recorded as one.
PLANNER_TOKENS, PLANNER_SECONDS = 16000, 300
# A rejected plan is sent back to the planner with what was wrong this many times.
PLAN_CORRECTIONS = 2


def _correction(facts: PlanFacts, previous: Any, problem: str) -> str:
    """The planner's prompt again, with its rejected plan and why it was rejected: the
    exact places check_plan named (B1h), and the limits as the schema states them (it said
    14 evidence items a phase where the schema allows four)."""
    return (
        f"{prompt_for(facts)}\n\n<your_previous_plan>\n"
        f"{json.dumps(previous, ensure_ascii=False, default=str)}\n</your_previous_plan>\n\n"
        f"That plan was rejected: {problem}. Each place is named as it is in your answer "
        "(for example phases[1].requirements[0].title). Return the whole plan again with "
        "every problem fixed and everything else kept. understanding is an object and "
        "phases a list of three objects, each passed as structured data, never as text. "
        "Keep within every length and count limit the schema states: at most 4 evidence "
        "items, 10 procedures and 8 objectives in a phase. Every procedure named in links "
        "is also listed in that phase's procedures, word for word. Sample evidence must "
        "depend on the population evidence it is drawn from."
    )


def plan_for(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    facts: PlanFacts,
    requester: UUID,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID | None = None,
) -> Planned:
    """Claude's plan when a model is configured and its plan passes the checks; otherwise
    the rules planner's."""
    rules = check_plan(rules_plan(facts), facts)
    if provider is None:
        return Planned(
            rules, "RULES", "No model is configured, so the rules planned the evidence.", None
        )
    caller = AgentCaller(
        connection,
        provider,
        Job(
            "engagement-planner",
            "engagement_control" if control_id is not None else "project",
            control_id if control_id is not None else project_id,
            organization_id,
            project_id,
            requester,
            agent_instance_id=agent_actor(connection, project_id, "engagement-planner"),
        ),
    )
    request = ModelRequest(
        operation="generate",
        prompt=prompt_for(facts),
        output_schema=PLAN_SCHEMA,
        allowed_tool_ids=(),
        timeout_seconds=PLANNER_SECONDS,
        cancelled=False,
        system=SYSTEM_PROMPT,
        max_tokens=PLANNER_TOKENS,
        # A plan written one level too deep is read as written (models.unnested, B1h).
        unnest=True,
        lift=True,
    )
    call = caller.generate(
        request,
        PLANNER_PROMPT_VERSION,
        {
            "control": None if control_id is None else str(control_id),
            "control_ref": facts.control_ref,
        },
    )
    call_id = call.call_id
    # An answer that missed the generic shape check is still read: the plan's own checks
    # (its strict schema and every planning rule) decide, and reject what breaks a rule. A
    # rejected plan goes back to the planner with what was wrong, up to PLAN_CORRECTIONS
    # times, before the rules stand in; every check still applies to the corrected plan
    # (product owner, 26 October 2026: "agent should be smart enough to work on this").
    problem = happened = ""
    for attempt in range(PLAN_CORRECTIONS + 1):
        if call.status not in ("SUCCEEDED", "MALFORMED") or call.raw.output is None:
            happened = (
                "The planner's answer was cut off at the output limit."
                if call.raw.stopped == "max_tokens"
                else call_note(call.status)
            )
            note = (
                f"{happened} The model did not produce this; the reviewed rules planned the "
                "evidence instead."
            )
            break
        # A fact quoting words the records do not hold is a rejection, corrected like any
        # other, on every answer but the last. On the last it is left out (never kept,
        # never filled in) only when nothing else in the answer repeats what it claims;
        # otherwise the answer is rejected and the plan kept (unheld_quotes_left_out). The
        # plan's note and the call's outcome say what was left out.
        try:
            output, dropped = (
                unheld_quotes_left_out(call.raw.output, facts)
                if attempt == PLAN_CORRECTIONS
                else (call.raw.output, ())
            )
            return Planned(
                check_plan(output, facts), "MODEL", _dropped_note(dropped), call.call_id,
                call=call, dropped=dropped,
            )  # fmt: skip
        except ValueError as error:
            problem = str(error)
            happened = f"The agent's plan was rejected ({problem})."
            note = (
                f"{happened} The model did not produce this "
                "plan; the reviewed rules planned the evidence instead."
            )
        if attempt == PLAN_CORRECTIONS:
            break
        call = caller.generate(
            replace(request, prompt=_correction(facts, call.raw.output, problem)),
            PLANNER_PROMPT_VERSION,
            {
                "control": None if control_id is None else str(control_id),
                "control_ref": facts.control_ref,
                "correction": attempt + 1,
                # Why the answer before was rejected, kept with the call (B1h: only the
                # last rejection was on record). check_plan's words, as the plan's
                # note already keeps them: the rule and where in the answer it broke.
                "rejected": problem[:300],
            },
        )
        call_id = call.call_id
    # The rules' plan stands in for the model's: FALLBACK, with the failed call linked.
    # Whether it is written is generate's decision: never over a plan that stands.
    return Planned(rules, "FALLBACK", note[:500], call_id, happened[:400], call=call)


def _dropped_note(dropped: tuple[str, ...]) -> str:
    """The plan's note when facts of the planner's understanding were left out because
    their quote is not in the control's records; empty when none was."""
    if not dropped:
        return ""
    one = len(dropped) == 1
    return (
        f"{len(dropped)} fact{'' if one else 's'} of the planner's understanding quoted "
        f"words the control's records do not hold, so {'it was' if one else 'they were'} "
        "left out."
    )


@dataclass
class Changes:
    added: list[str]
    updated: list[str]
    flagged: list[str]
    removed: list[str]
    kept: list[str]

    def as_json(self) -> dict[str, list[str]]:
        return {
            "added": self.added,
            "updated": self.updated,
            "flagged": self.flagged,
            "removed": self.removed,
            "kept": self.kept,
        }


def _content(requirement: RequirementPlan) -> dict[str, Any]:
    return {
        "title": requirement.title,
        "description": requirement.description,
        "categories": list(requirement.categories),
        "objective": requirement.objective,
        "attributes": list(requirement.attributes),
        "risk": requirement.risk,
        "rationale": requirement.rationale,
        "necessity": requirement.necessity,
        "period_label": requirement.period_label,
        "population_kind": requirement.population_kind,
        "sample_selection": requirement.sample_selection,
        "depends_on": requirement.depends_on,
    }


def persist(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    planned: Planned,
    facts: PlanFacts,
    requester: UUID | None,
    settle: bool = False,
) -> Changes:
    """Store a plan, merging it into the existing one. Idempotent for the same plan.

    With `settle`, a plan that took effect with no approver goes back to proposed once
    something in it needs a person's judgment. A plan is never approved here."""
    output = planned.output
    understanding = output.understanding.model_dump(mode="json") | {
        "missing_information": output.missing_information,
        "assumptions": output.assumptions,
        "exceptions": output.exceptions,
        "approvals_required": output.approvals_required,
    }
    found = cursor.execute(
        "SELECT id, status, approved_by FROM evidence_plans WHERE project_id = %s "
        "AND engagement_control_id = %s FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    # A person approved it: the planner's later changes are proposed to them. A plan that
    # took effect on its own takes the planner's changes directly.
    person_approved = found is not None and found[1] in _APPROVED_PLAN and found[2] is not None
    if found is None:
        created = cursor.execute(
            """
            INSERT INTO evidence_plans (
                organization_id, project_id, engagement_control_id, source, provisional,
                understanding, note, fingerprint, model_call_id, generated_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, engagement_control_id) DO NOTHING
            RETURNING id, status
            """,
            (
                organization_id,
                project_id,
                control_id,
                planned.source,
                output.provisional,
                Json(understanding),
                planned.note,
                fingerprint(facts),
                planned.call_id,
                requester,
            ),
        ).fetchone()
        if created is None:
            raise PlanState("the plan is being generated")
        plan_id, status = UUID(str(created[0])), str(created[1])
    else:
        plan_id, status = UUID(str(found[0])), str(found[1])
        # What the run was is kept on the plan; what the plan says is changed only on a
        # plan no person approved (apply_plan_content below).
        cursor.execute(
            """
            UPDATE evidence_plans
            SET source = %s, note = %s, fingerprint = %s, model_call_id = %s,
                generated_by = %s, generated_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            """,
            (
                planned.source,
                planned.note,
                fingerprint(facts),
                planned.call_id,
                requester,
                plan_id,
            ),
        )
    origin = "AGENT" if planned.source == "MODEL" else "RULES"
    periods = phase_periods(facts)
    for phase_plan in output.phases:
        period = periods[phase_plan.phase]
        # Every plan has its three phases. Their periods follow the engagement's dates.
        cursor.execute(
            """
            INSERT INTO evidence_plan_phases (
                organization_id, project_id, plan_id, engagement_control_id, phase,
                applicability, rationale, condition, open_question, objectives, procedures,
                period_start, period_end, as_of, origin
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (plan_id, phase) DO UPDATE
            SET period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
                as_of = EXCLUDED.as_of
            """,
            (
                organization_id, project_id, plan_id, control_id, phase_plan.phase,
                phase_plan.applicability, phase_plan.rationale, phase_plan.condition,
                phase_plan.open_question, Json(phase_plan.objectives),
                Json(phase_plan.procedures), period.start, period.end, period.as_of, origin,
            ),
        )  # fmt: skip
    proposed = _plan_content(output, understanding, origin)
    if person_approved:
        # The planner never changes a plan a person approved: its understanding,
        # objectives, and procedures are proposed to the reviewer.
        if _content_differs(cursor, plan_id, proposed):
            cursor.execute(
                "UPDATE evidence_plans SET pending_revision = %s WHERE id = %s",
                (Json(proposed), plan_id),
            )
    else:
        apply_plan_content(cursor, organization_id, project_id, plan_id, control_id, proposed)
    changes = _merge_requirements(
        cursor, organization_id, project_id, plan_id, control_id,
        _as_decided(cursor, plan_id, output, facts), periods, origin,
        approved=person_approved, released=_released_phases(cursor, control_id),
    )  # fmt: skip
    if not person_approved:
        derive_requirement_procedures(cursor, organization_id, project_id, plan_id, control_id)
        _revise(cursor, plan_id)
    pending = cursor.execute(
        "SELECT pending_revision IS NOT NULL FROM evidence_plans WHERE id = %s", (plan_id,)
    ).fetchone()
    if (
        person_approved
        and status == "APPROVED"
        and (changes.flagged or changes.added or (pending is not None and pending[0]))
    ):
        cursor.execute(
            "UPDATE evidence_plans SET status = 'CHANGES_PROPOSED' WHERE id = %s", (plan_id,)
        )
    cursor.execute(
        """
        INSERT INTO evidence_plan_runs (
            organization_id, project_id, plan_id, source, model_call_id, output, changes, note,
            created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            organization_id, project_id, plan_id, planned.source, planned.call_id,
            Json(output.model_dump(mode="json")), Json(changes.as_json()), planned.note,
            requester,
        ),
    )  # fmt: skip
    _audit(
        cursor, organization_id, project_id, requester, "evidence_plan.generated",
        "evidence_plan", plan_id,
        {"source": planned.source, **{k: len(v) for k, v in changes.as_json().items()}},
    )  # fmt: skip
    if settle and not person_approved:
        settle_automatically(cursor, organization_id, project_id, plan_id)
    # A request the run linked now addresses an attribute a person had excepted: the
    # exception is withdrawn with a record, so it never applies again by itself later.
    clear_covered_exceptions(cursor, organization_id, project_id, control_id, None)
    return changes


# The master test plan's content (migration 0079, master_plans.py). A material change
# revises the plan; an approved plan then goes back for review. Database triggers do the
# same for its procedures, the control's attributes, and the links between them.


def _revise(cursor: psycopg.Cursor[Any], plan_id: UUID) -> None:
    cursor.execute("SELECT revise_evidence_plan(%s)", (plan_id,))


def _plan_content(output: PlanOutput, understanding: dict[str, Any], origin: str) -> dict[str, Any]:
    """The plan-level content a run proposes: its understanding and, per phase, the
    applicability, objectives, and procedures."""
    return {
        "origin": origin,
        "provisional": output.provisional,
        "understanding": understanding,
        "phases": [
            {
                "phase": item.phase,
                "applicability": item.applicability,
                "rationale": item.rationale,
                "condition": item.condition,
                "open_question": item.open_question,
                "objectives": list(item.objectives),
                "procedures": list(item.procedures),
                "links": [link.model_dump(mode="json") for link in item.links],
            }  # fmt: skip
            for item in output.phases
        ],
        "criteria": [item.model_dump(mode="json") for item in output.criteria],
    }


def _wanted_procedures(texts: list[str]) -> list[tuple[str, str]]:
    """(key, wording) per procedure, in order, one per wording."""
    from ai_workforce_api.master_plans import procedure_key

    seen: set[str] = set()
    wanted: list[tuple[str, str]] = []
    for raw in texts:
        text = " ".join(str(raw).split())[:1000]
        if len(text) < 3:
            continue
        key = procedure_key("x", text)
        if key in seen:
            continue
        seen.add(key)
        wanted.append((key, text))
    return wanted


def _content_differs(cursor: psycopg.Cursor[Any], plan_id: UUID, proposed: dict[str, Any]) -> bool:
    from ai_workforce_api.master_plans import procedure_key

    row = cursor.execute(
        "SELECT understanding, provisional FROM evidence_plans WHERE id = %s", (plan_id,)
    ).fetchone()
    if row is None:
        return True
    if dict(row[0]) != proposed["understanding"] or bool(row[1]) != proposed["provisional"]:
        return True
    phases = {
        str(r[0]): r
        for r in cursor.execute(
            "SELECT phase, applicability, rationale, condition, open_question, objectives, "
            "origin FROM evidence_plan_phases WHERE plan_id = %s",
            (plan_id,),
        ).fetchall()
    }
    active: dict[str, set[str]] = {}
    for phase, key in cursor.execute(
        "SELECT phase, procedure_key FROM plan_procedures WHERE plan_id = %s "
        "AND status = 'ACTIVE' AND origin <> 'PERSON' AND NOT person_edited",
        (plan_id,),
    ).fetchall():
        active.setdefault(str(phase), set()).add(str(key))
    for item in proposed["phases"]:
        current = phases.get(item["phase"])
        if current is None:
            return True
        if current[6] != "PERSON" and (
            (current[1], current[2], current[3], current[4])
            != (item["applicability"], item["rationale"], item["condition"],
                item["open_question"])
        ):  # fmt: skip
            return True
        if [str(i) for i in current[5]] != item["objectives"]:
            return True
        keys = {procedure_key(item["phase"], text) for _, text in
                _wanted_procedures(item["procedures"])}  # fmt: skip
        if keys != active.get(item["phase"], set()):
            return True
    linked: dict[str, set[str]] = {}
    for key, text in cursor.execute(
        """
        SELECT p.procedure_key, a.text FROM plan_procedure_attributes l
        JOIN plan_procedures p ON p.id = l.procedure_id
        JOIN control_attributes a ON a.id = l.attribute_id
        WHERE p.plan_id = %s AND p.status = 'ACTIVE' AND l.origin <> 'PERSON'
          AND NOT p.person_edited
        """,
        (plan_id,),
    ).fetchall():
        linked.setdefault(str(key), set()).add(" ".join(str(text).split()).lower())
    proposed_links: dict[str, set[str]] = {}
    for item in proposed["phases"]:
        for link in item.get("links") or []:
            key = procedure_key(item["phase"], " ".join(str(link["procedure"]).split()))
            proposed_links.setdefault(key, set()).update(
                " ".join(str(text).split()).lower() for text in link["attributes"]
            )
    if {k: v for k, v in proposed_links.items() if v} != linked:
        return True
    return bool(proposed.get("criteria")) and _criteria_differ(cursor, plan_id, proposed)


def _criteria_differ(cursor: psycopg.Cursor[Any], plan_id: UUID, proposed: dict[str, Any]) -> bool:
    """Whether the run's criteria would change an attribute _write_criteria may write: the
    same rows (CRITERIA_WRITABLE_SQL), matched by the same wording, compared on the same
    fields. A library attribute's tailored criteria are a change; criteria for one a person
    stated, accepted, or the demo prepared are not, since nothing would write them."""
    current = {
        str(row[0]): (row[1], row[2], row[3], row[4], row[5])
        for row in cursor.execute(
            f"""
            SELECT lower(regexp_replace(btrim(a.text), '\\s+', ' ', 'g')), a.condition,
                   a.pass_criteria, a.fail_criteria, a.judgment_required, a.automatable
            FROM control_attributes a JOIN evidence_plans p
              ON p.engagement_control_id = a.engagement_control_id
            WHERE p.id = %s AND {CRITERIA_WRITABLE_SQL}
            """,
            (plan_id,),
        ).fetchall()
    }
    for item in proposed.get("criteria") or []:
        key = " ".join(str(item["attribute"]).split()).lower()
        if key in current and current[key] != (
            item["condition"],
            item["pass_criteria"],
            item["fail_criteria"],
            bool(item.get("judgment_required")),
            item.get("automatable"),
        ):
            return True
    return False


def apply_plan_content(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    control_id: UUID,
    proposed: dict[str, Any],
) -> None:
    """Write a run's understanding, phase decisions, and procedures into the plan. A phase
    a person decided keeps their decision; a procedure a person wrote or edited stays."""
    from ai_workforce_api.master_plans import procedure_key

    origin = "AGENT" if proposed.get("origin") == "AGENT" else "RULES"
    cursor.execute(
        "UPDATE evidence_plans SET understanding = %s, provisional = %s WHERE id = %s",
        (Json(proposed.get("understanding") or {}), bool(proposed.get("provisional")), plan_id),
    )
    for item in proposed.get("phases") or []:
        phase = str(item["phase"])
        cursor.execute(
            """
            UPDATE evidence_plan_phases
            SET applicability = CASE WHEN origin = 'PERSON' THEN applicability ELSE %s END,
                rationale = CASE WHEN origin = 'PERSON' THEN rationale ELSE %s END,
                condition = CASE WHEN origin = 'PERSON' THEN condition ELSE %s END,
                open_question = CASE WHEN origin = 'PERSON' THEN open_question ELSE %s END,
                origin = CASE WHEN origin = 'PERSON' THEN 'PERSON' ELSE %s END,
                objectives = %s, procedures = %s, version = version + 1
            WHERE plan_id = %s AND phase = %s
            """,
            (
                item["applicability"], item["rationale"], item["condition"],
                item["open_question"], origin, Json(item["objectives"]),
                Json(item["procedures"]), plan_id, phase,
            ),
        )  # fmt: skip
        wanted = [
            (procedure_key(phase, text), text) for _, text in _wanted_procedures(item["procedures"])
        ]
        existing = {
            str(r[0]): (UUID(str(r[1])), str(r[2]), str(r[3]), bool(r[4]))
            for r in cursor.execute(
                "SELECT procedure_key, id, status, origin, person_edited FROM plan_procedures "
                "WHERE plan_id = %s AND phase = %s",
                (plan_id, phase),
            ).fetchall()
        }
        keys = {key for key, _ in wanted}
        for position, (key, text) in enumerate(wanted):
            found = existing.get(key)
            if found is None:
                cursor.execute(
                    """
                    INSERT INTO plan_procedures (
                        organization_id, project_id, plan_id, engagement_control_id, phase,
                        procedure_key, code, position, text, origin
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, '', %s, %s, %s)
                    """,
                    (organization_id, project_id, plan_id, control_id, phase, key, position,
                     text, origin),
                )  # fmt: skip
            elif found[1] == "REMOVED" and found[2] != "PERSON" and not found[3]:
                cursor.execute(
                    "UPDATE plan_procedures SET status = 'ACTIVE', removed_reason = '', "
                    "position = %s, version = version + 1 WHERE id = %s",
                    (position, found[0]),
                )
            elif found[1] == "ACTIVE":
                cursor.execute(
                    "UPDATE plan_procedures SET position = %s WHERE id = %s AND position <> %s",
                    (position, found[0], position),
                )
        for key, (procedure_id, status, row_origin, edited) in existing.items():
            if key in keys or status != "ACTIVE" or row_origin == "PERSON" or edited:
                continue
            cursor.execute(
                "UPDATE plan_procedures SET status = 'REMOVED', removed_reason = %s, "
                "version = version + 1 WHERE id = %s",
                ("No longer in the planner's plan.", procedure_id),
            )
        _write_procedure_links(
            cursor, organization_id, project_id, plan_id, control_id, phase,
            list(item.get("links") or []), origin,
        )  # fmt: skip
    _write_criteria(cursor, control_id, list(proposed.get("criteria") or []))


def _approved_by_wording(cursor: psycopg.Cursor[Any], control_id: UUID) -> dict[str, UUID]:
    return {
        " ".join(str(row[1]).split()).lower(): UUID(str(row[0]))
        for row in cursor.execute(
            "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED'",
            (control_id,),
        ).fetchall()
    }


def _write_procedure_links(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    control_id: UUID,
    phase: str,
    links: list[dict[str, Any]],
    origin: str,
) -> None:
    """The attributes each of the phase's procedures tests, as the run says. A procedure a
    person wrote, edited, or linked keeps its links."""
    from ai_workforce_api.master_plans import procedure_key

    approved = _approved_by_wording(cursor, control_id)
    wanted: dict[str, list[UUID]] = {}
    for link in links:
        key = procedure_key(phase, " ".join(str(link["procedure"]).split())[:1000])
        wanted[key] = sorted(
            {
                approved[name]
                for name in (" ".join(str(text).split()).lower() for text in link["attributes"])
                if name in approved
            }
        )
    for procedure_id, key in cursor.execute(
        """
        SELECT p.id, p.procedure_key FROM plan_procedures p
        WHERE p.plan_id = %s AND p.phase = %s AND p.status = 'ACTIVE' AND NOT p.person_edited
          AND p.origin <> 'PERSON'
          AND NOT EXISTS (SELECT 1 FROM plan_procedure_attributes l
                          WHERE l.procedure_id = p.id AND l.origin = 'PERSON')
        """,
        (plan_id, phase),
    ).fetchall():
        ids = wanted.get(str(key), [])
        cursor.execute(
            "DELETE FROM plan_procedure_attributes WHERE procedure_id = %s "
            "AND NOT (attribute_id = ANY(%s))",
            (procedure_id, ids),
        )
        for attribute_id in ids:
            cursor.execute(
                """
                INSERT INTO plan_procedure_attributes (
                    procedure_id, attribute_id, organization_id, project_id,
                    engagement_control_id, origin
                )
                VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
                """,
                (procedure_id, attribute_id, organization_id, project_id, control_id, origin),
            )


def _write_criteria(
    cursor: psycopg.Cursor[Any], control_id: UUID, criteria: list[dict[str, Any]]
) -> None:
    """The planner's criteria, tailored to the control, for an approved attribute no person
    has stated or accepted criteria for (migration 0122), the library's included since 11
    November 2026: the standard's wording is the requirement, the tailored criteria are what
    the tester applies. Marked as the agent's, for a person to accept. Only the attributes
    CRITERIA_WRITABLE_SQL names: never a person's, an accepted, or the demo's."""
    for item in criteria:
        cursor.execute(
            f"""
            UPDATE control_attributes a
            SET condition = %s, pass_criteria = %s, fail_criteria = %s,
                judgment_required = %s, automatable = %s, criteria_origin = 'AGENT',
                version = a.version + 1
            WHERE a.engagement_control_id = %s AND {CRITERIA_WRITABLE_SQL}
              AND lower(regexp_replace(btrim(a.text), '\\s+', ' ', 'g')) = %s
              AND (a.condition, a.pass_criteria, a.fail_criteria, a.judgment_required,
                   a.automatable)
                  IS DISTINCT FROM (%s, %s, %s, %s, %s)
            """,
            (
                item["condition"], item["pass_criteria"], item["fail_criteria"],
                bool(item.get("judgment_required")), item.get("automatable"), control_id,
                " ".join(str(item["attribute"]).split()).lower(),
                item["condition"], item["pass_criteria"], item["fail_criteria"],
                bool(item.get("judgment_required")), item.get("automatable"),
            ),
        )  # fmt: skip


def derive_requirement_procedures(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    control_id: UUID,
) -> None:
    """Each requirement serves the procedures of its phase that test an attribute it
    supports: derived from the links, never guessed. A person's links stay."""
    rows = cursor.execute(
        """
        SELECT q.id, coalesce(array_agg(DISTINCT p.id) FILTER (WHERE p.id IS NOT NULL), '{}')
        FROM evidence_requirements q
        LEFT JOIN evidence_requirement_attributes ra ON ra.requirement_id = q.id
        LEFT JOIN plan_procedure_attributes pa ON pa.attribute_id = ra.attribute_id
        LEFT JOIN plan_procedures p
          ON p.id = pa.procedure_id AND p.phase = q.phase AND p.status = 'ACTIVE'
        WHERE q.plan_id = %s AND q.status <> 'REMOVED' AND q.origin <> 'PERSON'
          AND NOT EXISTS (SELECT 1 FROM evidence_requirement_procedures l
                          WHERE l.requirement_id = q.id AND l.origin = 'PERSON')
        GROUP BY q.id
        """,
        (plan_id,),
    ).fetchall()
    for requirement_id, procedures in rows:
        ids = [UUID(str(item)) for item in procedures]
        cursor.execute(
            "DELETE FROM evidence_requirement_procedures WHERE requirement_id = %s "
            "AND NOT (procedure_id = ANY(%s))",
            (requirement_id, ids),
        )
        for procedure_id in ids:
            cursor.execute(
                """
                INSERT INTO evidence_requirement_procedures (
                    requirement_id, procedure_id, organization_id, project_id,
                    engagement_control_id, origin
                )
                VALUES (%s, %s, %s, %s, %s, 'RULES') ON CONFLICT DO NOTHING
                """,
                (requirement_id, procedure_id, organization_id, project_id, control_id),
            )


def _sync_named_links(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    names: list[str],
    origin: str,
) -> None:
    """Link a requirement to the control's approved attributes it names by wording
    (ignoring case and spacing). Links a person made stay; wording that matches no
    approved attribute stays unlinked, for the reviewer to see.

    A D&I request is never linked this way to an attribute a person excepted from the D&I
    evidence (design_coverage_exceptions): the planner's naming of it is not a reason to
    withdraw what the person recorded. Only a person's own links change addresses it."""
    wanted = {" ".join(str(name).split()).lower() for name in names}
    matched = sorted(
        UUID(str(row[0]))
        for row in cursor.execute(
            """
            SELECT a.id, a.text FROM control_attributes a
            WHERE a.engagement_control_id = %s AND a.status = 'APPROVED'
              AND NOT (
                  EXISTS (SELECT 1 FROM design_coverage_exceptions x
                          WHERE x.attribute_id = a.id
                            AND x.engagement_control_id = a.engagement_control_id)
                  AND EXISTS (SELECT 1 FROM evidence_requirements q
                              WHERE q.id = %s AND q.phase = 'DESIGN'))
            """,
            (control_id, requirement_id),
        ).fetchall()
        if " ".join(str(row[1]).split()).lower() in wanted
    )
    cursor.execute(
        "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
        "AND origin <> 'PERSON' AND NOT (attribute_id = ANY(%s))",
        (requirement_id, matched),
    )
    for attribute_id in matched:
        cursor.execute(
            """
            INSERT INTO evidence_requirement_attributes (
                requirement_id, attribute_id, organization_id, project_id,
                engagement_control_id, origin
            )
            VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            (requirement_id, attribute_id, organization_id, project_id, control_id, origin),
        )


# A plan waits for a person (decided by the product owner). Nothing here approves one.
# A plan that took effect with no approver, before that rule, goes back to proposed once
# something in it needs a person's judgment. Every request still needs an approver.

_MAX_ATTENTION = 8


def attention_of(
    executor: psycopg.Cursor[Any] | psycopg.Connection[Any], plan_id: UUID
) -> list[str]:
    """What in the stored plan needs a person's judgment; empty when nothing does."""
    row = executor.execute(
        "SELECT provisional, understanding FROM evidence_plans WHERE id = %s", (plan_id,)
    ).fetchone()
    if row is None:
        return []
    found: list[str] = []
    if row[0]:
        found.append("Critical information is missing, so the plan rests on assumptions.")
    understanding = row[1] if isinstance(row[1], dict) else {}
    for key, lead in (
        ("missing_information", "Missing"),
        ("exceptions", "Exception"),
        ("approvals_required", "To decide"),
    ):
        items = understanding.get(key)
        if isinstance(items, list):
            found.extend(f"{lead}: {item}" for item in items if isinstance(item, str) and item)
    for phase, applicability, question in executor.execute(
        "SELECT phase, applicability, open_question FROM evidence_plan_phases "
        "WHERE plan_id = %s ORDER BY phase",
        (plan_id,),
    ).fetchall():
        label = PHASE_LABELS.get(str(phase), str(phase))
        if question:
            found.append(f"{label}: {question}")
        elif applicability == "PENDING":
            found.append(f"{label}: whether it applies is undecided.")
    pending = executor.execute(
        "SELECT count(*) FROM evidence_requirements WHERE plan_id = %s "
        "AND pending_change IS NOT NULL",
        (plan_id,),
    ).fetchone()
    if pending is not None and int(pending[0]) > 0:
        count = int(pending[0])
        found.append(f"{count} proposed change{'' if count == 1 else 's'} to decide.")
    revised = executor.execute(
        "SELECT pending_revision IS NOT NULL FROM evidence_plans WHERE id = %s", (plan_id,)
    ).fetchone()
    if revised is not None and revised[0]:
        found.append("The planner proposed a revised understanding and procedures to decide.")
    return found[:_MAX_ATTENTION]


def settle_automatically(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, plan_id: UUID
) -> bool:
    """Leave a plan for a person to approve. Never approves one.

    A plan a person approved is left as they approved it. A plan that took effect with
    no approver goes back to proposed once something in it needs a person's judgment.
    True when the plan stands approved."""
    row = cursor.execute(
        "SELECT status, approved_by FROM evidence_plans WHERE id = %s FOR UPDATE",
        (plan_id,),
    ).fetchone()
    if row is None:
        return False
    status, approved_by = str(row[0]), row[1]
    if approved_by is not None:
        return status in _APPROVED_PLAN
    attention = attention_of(cursor, plan_id)
    if attention and status in _APPROVED_PLAN:
        cursor.execute(
            "UPDATE evidence_plans SET status = 'PROPOSED', approved_at = NULL, "
            "version = version + 1 WHERE id = %s",
            (plan_id,),
        )
        _audit(
            cursor, organization_id, project_id, None, "evidence_plan.needs_review",
            "evidence_plan", plan_id, {"attention": len(attention)},
        )  # fmt: skip
        return False
    return status in _APPROVED_PLAN


def drafts_for_plan(connection: psycopg.Connection[Any], plan_id: UUID) -> list[UUID]:
    """The plan's control's drafts that wait for the evidence coordinator."""
    return [
        UUID(str(item[0]))
        for item in connection.execute(
            """
            SELECT d.id FROM pbc_drafts d
            JOIN evidence_plans p ON p.engagement_control_id = d.engagement_control_id
            WHERE p.id = %s AND d.status = 'PENDING'
            ORDER BY d.created_at
            """,
            (plan_id,),
        ).fetchall()
    ]


def _as_decided(
    cursor: psycopg.Cursor[Any], plan_id: UUID, output: PlanOutput, facts: PlanFacts
) -> PlanOutput:
    """The plan's requirements under the decisions that stand: where a person decided a
    phase, its requirements follow that decision, not the planner's."""
    decided = {
        str(row[0]): str(row[1])
        for row in cursor.execute(
            "SELECT phase, applicability FROM evidence_plan_phases "
            "WHERE plan_id = %s AND origin = 'PERSON'",
            (plan_id,),
        ).fetchall()
    }
    if not decided:
        return output
    rules = rules_plan(facts, every_phase=True)
    phases = []
    for item in output.phases:
        applicability = decided.get(item.phase)
        if applicability == "NOT_APPLICABLE":
            item = item.model_copy(update={"requirements": []})
        elif applicability is not None and not item.requirements:
            item = item.model_copy(update={"requirements": rules.phase(item.phase).requirements})
        phases.append(item)
    return output.model_copy(update={"phases": phases})


def _released_phases(cursor: psycopg.Cursor[Any], control_id: UUID) -> frozenset[str]:
    """The phases whose items a person approved by releasing them: the D&I evidence (B1),
    which has its own release in place of the plan's approval. An operating phase's release
    follows the approved plan, which already holds its items."""
    return frozenset(
        str(row[0])
        for row in cursor.execute(
            "SELECT phase FROM phase_releases WHERE engagement_control_id = %s "
            "AND phase = 'DESIGN'",
            (control_id,),
        ).fetchall()
    )


def _merge_requirements(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    control_id: UUID,
    output: PlanOutput,
    periods: dict[str, Any],
    origin: str,
    approved: bool,
    released: frozenset[str] = frozenset(),
) -> Changes:
    """Merge a run's requirements into the plan. Under a plan a person approved, or in a
    phase a person released (the D&I evidence, B1), the run's changes are proposed to a
    person rather than applied: the agent never extends what a person approved. The same
    holds for one D&I request a person accepted (B1f, 12 November 2026), on any plan: its
    material change or its removal arrives as the request's pending change, and a request
    the run adds arrives unaccepted (accepted_by is never set here)."""
    changes = Changes([], [], [], [], [])
    rows = cursor.execute(
        """
        SELECT q.id, q.phase, q.requirement_key, q.status, q.origin, q.person_edited,
               r.status, q.title, q.description, q.categories, q.necessity, q.depends_on,
               q.population_kind, q.attributes, q.objective, q.sample_selection,
               q.accepted_at IS NOT NULL,
               coalesce((q.pending_change ->> 'add')::boolean, false)
        FROM evidence_requirements q
        LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE q.engagement_control_id = %s
        FOR UPDATE OF q
        """,
        (control_id,),
    ).fetchall()
    existing = {(str(row[1]), str(row[2])): row for row in rows}
    excepted = {
        " ".join(str(row[0]).split()).lower()
        for row in cursor.execute(
            "SELECT a.text FROM control_attributes a "
            "JOIN design_coverage_exceptions x ON x.attribute_id = a.id "
            "WHERE a.engagement_control_id = %s",
            (control_id,),
        ).fetchall()
    }
    planned_keys: set[tuple[str, str]] = set()
    for phase_plan in output.phases:
        period = periods[phase_plan.phase]
        phase_held = approved or phase_plan.phase in released
        for requirement in phase_plan.requirements:
            key = (phase_plan.phase, requirement.key)
            planned_keys.add(key)
            label = f"{phase_plan.phase.lower()}:{requirement.key}"
            content = _content(requirement)
            row = existing.get(key)
            # A D&I request a person accepted is theirs (12 November 2026: "Agent proposes,
            # the human approves"): the planner never overwrites it, whatever the plan's
            # status. Its change arrives as the request's pending change, to accept.
            accepted = (
                row is not None
                and phase_plan.phase == "DESIGN"
                and bool(row[16])
                and not bool(row[17])
            )
            held = phase_held or accepted
            if row is None:
                # Added to a plan a person approved (or a phase a person released): proposed
                # to them, not planned, until they accept it (decide_change). The agent never
                # extends an approved plan.
                inserted = cursor.execute(
                    """
                    INSERT INTO evidence_requirements (
                        organization_id, project_id, plan_id, engagement_control_id, phase,
                        requirement_key, title, description, categories, objective,
                        attributes, risk, rationale, necessity, period_label, period_start,
                        period_end, as_of, population_kind, sample_selection, depends_on,
                        status, origin, needs_review, pending_change
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        organization_id, project_id, plan_id, control_id, phase_plan.phase,
                        requirement.key, requirement.title, requirement.description,
                        list(requirement.categories), requirement.objective,
                        Json(list(requirement.attributes)), requirement.risk,
                        requirement.rationale, requirement.necessity,
                        requirement.period_label or period.label, period.start, period.end,
                        period.as_of, requirement.population_kind,
                        requirement.sample_selection, requirement.depends_on,
                        "AWAITING_DEPENDENCY" if requirement.depends_on else "PLANNED",
                        origin, held, Json({"add": True}) if held else None,
                    ),
                ).fetchone()  # fmt: skip
                assert inserted is not None
                if not held:
                    _sync_named_links(
                        cursor, organization_id, project_id, control_id,
                        UUID(str(inserted[0])), list(requirement.attributes), origin,
                    )  # fmt: skip
                changes.added.append(label)
                continue
            requirement_id, status, row_origin, edited, request_status = (
                row[0],
                str(row[3]),
                str(row[4]),
                bool(row[5]),
                row[6],
            )
            if status == "WAIVED" or row_origin == "PERSON" or edited:
                changes.kept.append(label)
                continue
            before = {
                "title": row[7], "description": row[8], "categories": list(row[9]),
                "necessity": row[10], "depends_on": row[11], "population_kind": row[12],
            }  # fmt: skip
            material = any(
                (sorted(before[f]) if f == "categories" else before[f])
                != (sorted(content[f]) if f == "categories" else content[f])
                for f in _MATERIAL
            )
            # The attributes it supports are part of an approved master test plan.
            named = [str(item) for item in row[13]] if isinstance(row[13], list) else []
            proposed_names = list(content["attributes"])
            if phase_plan.phase == "DESIGN" and excepted:
                # An attribute a person excepted from the D&I evidence is left alone: the
                # planner naming it, or no longer naming it, is not a change to propose.
                named = [n for n in named if " ".join(n.split()).lower() not in excepted]
                proposed_names = [
                    n for n in proposed_names if " ".join(n.split()).lower() not in excepted
                ]
            if held and (
                sorted(named) != sorted(proposed_names)
                or (row[14], row[15]) != (content["objective"], content["sample_selection"])
            ):
                material = True
            locked = status == "REQUESTED" and request_status not in ("DRAFT", "CANCELLED")
            if status == "REMOVED" and cursor.execute(
                "SELECT removed_by IS NOT NULL FROM evidence_requirements WHERE id = %s",
                (requirement_id,),
            ).fetchone() == (True,):
                # A person removed it: no run brings it back or proposes it again (product
                # owner, 26 October 2026). A person restores it.
                continue
            if status == "REMOVED" and held:
                # Planned again on a plan a person approved, or a D&I request a person had
                # accepted before it left the plan: proposed to them.
                cursor.execute(
                    "UPDATE evidence_requirements SET pending_change = %s, needs_review = true, "
                    "version = version + 1 WHERE id = %s AND pending_change IS NULL",
                    (Json({"add": True}), requirement_id),
                )
                changes.flagged.append(label)
                continue
            if status == "REMOVED" and not material and not locked:
                # Planned again after an earlier run removed it.
                cursor.execute(
                    "UPDATE evidence_requirements SET status = %s, version = version + 1 "
                    "WHERE id = %s",
                    ("AWAITING_DEPENDENCY" if content["depends_on"] else "PLANNED", requirement_id),
                )
                if not bool(row[17]):
                    # A proposal to add it again stays a proposal: no links until accepted.
                    _sync_named_links(
                        cursor, organization_id, project_id, control_id, requirement_id,
                        list(content["attributes"]), origin,
                    )  # fmt: skip
                changes.added.append(label)
                continue
            # An addition still only proposed to a person is the agent's own proposal: a
            # later run revises it in place and it stays proposed (below). Recorded as a
            # change to it instead, it would have read as part of the plan with a change
            # pending, and been requested as it first stood.
            # Whatever the plan's status or the row's acceptance says: no run ever clears a
            # proposed addition (pending_change.add). Only a person accepts or dismisses it.
            proposed = bool(row[17])
            if material and (locked or held) and not proposed:
                cursor.execute(
                    "UPDATE evidence_requirements SET pending_change = %s, needs_review = true, "
                    "version = version + 1 WHERE id = %s",
                    (Json(content), requirement_id),
                )
                changes.flagged.append(label)
                continue
            if accepted:
                # Nothing material changed: the accepted request stays exactly as the
                # person accepted it (its other words are not rewritten under them). A
                # change or removal an earlier run proposed and this run no longer plans
                # is the agent's own proposal withdrawn, so the request reads accepted again.
                cursor.execute(
                    "UPDATE evidence_requirements SET pending_change = NULL, "
                    "needs_review = false, version = version + 1 "
                    "WHERE id = %s AND pending_change IS NOT NULL",
                    (requirement_id,),
                )
                continue
            cursor.execute(
                """
                UPDATE evidence_requirements
                SET title = %s, description = %s, categories = %s, objective = %s,
                    attributes = %s, risk = %s, rationale = %s, necessity = %s,
                    period_label = %s, period_start = %s, period_end = %s, as_of = %s,
                    population_kind = %s, sample_selection = %s, depends_on = %s,
                    status = CASE WHEN status = 'REMOVED' AND removed_by IS NULL
                                  THEN CASE WHEN %s::text IS NULL THEN 'PLANNED'
                                            ELSE 'AWAITING_DEPENDENCY' END
                                  ELSE status END,
                    -- An addition proposed to a person stays proposed until they decide
                    -- it: planning it again, unchanged, is not their acceptance (12
                    -- November 2026; before, the second run cleared the proposal and the
                    -- addition joined the plan, and a released phase's requests, with no
                    -- person accepting it). Never cleared here, on any plan.
                    pending_change = CASE
                        WHEN coalesce((pending_change ->> 'add')::boolean, false)
                        THEN pending_change ELSE NULL END,
                    version = version + CASE WHEN %s THEN 1 ELSE 0 END
                WHERE id = %s
                """,
                (
                    content["title"], content["description"], content["categories"],
                    content["objective"], Json(content["attributes"]), content["risk"],
                    content["rationale"], content["necessity"],
                    content["period_label"] or period.label, period.start, period.end,
                    period.as_of, content["population_kind"], content["sample_selection"],
                    content["depends_on"], content["depends_on"], material, requirement_id,
                ),
            )  # fmt: skip
            if proposed:
                # Still only proposed: its links follow once a person accepts it.
                continue
            _sync_named_links(
                cursor, organization_id, project_id, control_id, requirement_id,
                list(content["attributes"]), origin,
            )  # fmt: skip
            if material:
                changes.updated.append(label)
    for known, row in existing.items():
        if known in planned_keys:
            continue
        status, row_origin, request_status = str(row[3]), str(row[4]), row[6]
        label = f"{known[0].lower()}:{known[1]}"
        if bool(row[17]) and row_origin != "PERSON" and status != "WAIVED":
            # An addition the planner proposed and no longer plans: its own proposal
            # withdrawn. It was never part of the plan, so it is not a removal to propose.
            cursor.execute(
                "UPDATE evidence_requirements SET pending_change = NULL, needs_review = false, "
                "status = 'REMOVED', version = version + 1 WHERE id = %s",
                (row[0],),
            )
            if status != "REMOVED":
                changes.removed.append(label)
            continue
        if status in ("WAIVED", "REMOVED") or row_origin == "PERSON":
            continue
        locked = status == "REQUESTED" and request_status not in ("DRAFT", "CANCELLED")
        # A D&I request a person accepted is not removed under them: the removal is
        # proposed, like any change to it.
        accepted = known[0] == "DESIGN" and bool(row[16])
        if locked or approved or known[0] in released or accepted:
            cursor.execute(
                "UPDATE evidence_requirements SET pending_change = %s, needs_review = true, "
                "version = version + 1 WHERE id = %s",
                (Json({"remove": True}), row[0]),
            )
            changes.flagged.append(label)
        else:
            cursor.execute(
                "UPDATE evidence_requirements SET status = 'REMOVED', version = version + 1 "
                "WHERE id = %s",
                (row[0],),
            )
            changes.removed.append(label)
    return changes


# Issuing requests


class RequestedPlanned(BaseModel):
    requested: int
    request_ids: list[UUID]


@dataclass(frozen=True)
class Issued:
    """Requests made or rewritten. Each needs its draft (re)written."""

    created: list[UUID]
    rewritten: list[UUID]

    @property
    def drafts(self) -> list[UUID]:
        return [*self.created, *self.rewritten]


def issue(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
    source: str,
    only: list[UUID] | None = None,
) -> Issued:
    """Request every planned requirement of the control's applicable phases. With `only`,
    just those requirements, under the same gates, and nothing else of the control is
    touched (evidence_receipts._request_again)."""
    # The plan's row before any of its requirements, as every writer takes them (one order,
    # so two requests on the same control wait for each other and never deadlock).
    cursor.execute(
        "SELECT 1 FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s "
        "FOR UPDATE",
        (project_id, control_id),
    )
    control = cursor.execute(
        """
        SELECT c.control_ref, c.title, c.owner_email, s.client_coordinator_email,
               s.pbc_due_days, s.pbc_follow_up_days, s.pbc_max_follow_ups, p.status, c.included
        FROM engagement_controls c
        JOIN engagement_settings s ON s.project_id = c.project_id
        JOIN projects p ON p.id = c.project_id
        WHERE c.id = %s AND c.project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    if control is None or control[7] != "ACTIVE" or not control[8]:
        return Issued([], [])
    # A requirement whose request was withdrawn (the control left scope and came back, a
    # reopened interim withdrew the roll-forward's draft, or a person cancelled it) is
    # still needed: it is requested again. To stop asking, a person waives it.
    cursor.execute(
        """
        UPDATE evidence_requirements q
        SET status = CASE WHEN q.depends_on IS NULL THEN 'PLANNED' ELSE 'AWAITING_DEPENDENCY' END,
            pbc_request_id = NULL,
            coverage_note = 'Its earlier request was withdrawn.', version = q.version + 1
        FROM pbc_requests r
        WHERE r.id = q.pbc_request_id AND q.engagement_control_id = %s
          AND q.status = 'REQUESTED' AND r.status = 'CANCELLED' AND %s
        """,
        (control_id, only is None),
    )
    created: list[UUID] = []
    rewritten: set[UUID] = set()
    phases = cursor.execute(
        """
        SELECT ph.phase, ph.applicability, ph.period_end
        FROM evidence_plan_phases ph JOIN evidence_plans p ON p.id = ph.plan_id
        WHERE p.project_id = %s AND p.engagement_control_id = %s
        """,
        (project_id, control_id),
    ).fetchall()
    for phase, applicability, end in phases:
        if only is None:
            _link_dependents(cursor, project_id, control_id, str(phase))
        if applicability != "APPLICABLE":
            continue
        if gate_reason(cursor.connection, control_id, str(phase)) is not None:
            continue
        waiting = cursor.execute(
            """
            SELECT q.id, q.requirement_key FROM evidence_requirements q
            WHERE q.engagement_control_id = %s AND q.phase = %s AND q.status = 'PLANNED'
              AND q.depends_on IS NULL
              -- Proposed for an approved plan and not yet accepted: not part of the plan.
              AND NOT coalesce((q.pending_change ->> 'add')::boolean, false)
              -- A file the control holds already serves it, and no person found it short:
              -- asking the owner again would duplicate the request.
              AND NOT (
                  q.sufficiency IN ('NOT_REVIEWED', 'UNDER_REVIEW', 'ACCEPTED')
                  AND EXISTS (
                      SELECT 1 FROM evidence_requirement_files ef
                      JOIN evidence_file_links l
                        ON l.evidence_file_id = ef.evidence_file_id
                       AND l.engagement_control_id = ef.engagement_control_id
                      WHERE ef.requirement_id = q.id AND ef.status = 'LINKED'
                  )
              )
              AND (%s::uuid[] IS NULL OR q.id = ANY(%s::uuid[]))
            ORDER BY q.created_at, q.requirement_key
            FOR UPDATE OF q
            """,
            (control_id, phase, only, only),
        ).fetchall()
        if not waiting:
            continue
        remaining = [UUID(str(row[0])) for row in waiting]
        keys = {UUID(str(row[0])): str(row[1]) for row in waiting}
        legacy = None if phase == "ROLLFORWARD" else _legacy_request(cursor, project_id, control_id)
        if legacy is not None:
            legacy_id, legacy_status = legacy
            if legacy_status == "DRAFT":
                # Drafted before the plan and never sent: a person decides whether the
                # plan's requests replace it or it stays the request for these items
                # (reconcile()). Until then the items wait; nothing is replaced on its own.
                continue
            else:
                covered = [item for item in remaining if keys[item] in _LEGACY_KEYS]
                _link(
                    cursor, covered, legacy_id,
                    "Asked in the kickoff request sent before requests were planned by phase.",
                )  # fmt: skip
                remaining = [item for item in remaining if item not in covered]
        if not remaining:
            continue
        target = _open_request(cursor, project_id, control_id, str(phase))
        if target is None:
            recipient = str(control[2]) if _EMAIL.fullmatch(str(control[2])) else str(control[3])
            if _EMAIL.fullmatch(recipient) is None:
                # No owner email and no evidence coordinator yet: the request is still
                # drafted, addressed to no one, so it is seen; setting the coordinator
                # addresses it (onboarding evidence-contacts), and it cannot be submitted
                # before then (outbound._submit).
                recipient = ""
            target = _create_request(
                cursor, organization_id, project_id, control_id, str(phase), recipient,
                str(control[0]), int(control[4]), int(control[5]), int(control[6]), end,
                requester, source,
            )  # fmt: skip
            created.append(target)
        else:
            rewritten.add(target)
        _link(cursor, remaining, target, "")
        render_into(cursor, project_id, control_id, target)
        # The approved plan revision the request was drafted from (migration 0079).
        cursor.execute(
            "UPDATE pbc_requests SET plan_revision = p.approved_revision FROM evidence_plans p "
            "WHERE pbc_requests.id = %s AND p.engagement_control_id = %s",
            (target, control_id),
        )
    return Issued(created, [item for item in rewritten if item not in created])


def _legacy_request(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID
) -> tuple[UUID, str] | None:
    """The kickoff request of a control launched before requests were planned by phase."""
    row = cursor.execute(
        """
        SELECT id, status FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id = %s AND status <> 'CANCELLED'
          AND (operation_key LIKE 'kickoff-%%' OR operation_key LIKE 'scope-%%')
        ORDER BY created_at LIMIT 1
        """,
        (project_id, control_id),
    ).fetchone()
    return None if row is None else (UUID(str(row[0])), str(row[1]))


def _open_request(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, phase: str
) -> UUID | None:
    """A request of this phase that is still a draft, so new requirements join it."""
    if phase == "ROLLFORWARD":
        row = cursor.execute(
            """
            SELECT r.id FROM test_rounds t JOIN pbc_requests r ON r.id = t.request_id
            WHERE t.project_id = %s AND t.engagement_control_id = %s
              AND t.kind = 'ROLLFORWARD' AND t.status IN ('REQUESTED', 'TESTING')
              AND r.status = 'DRAFT'
            """,
            (project_id, control_id),
        ).fetchone()
        if row is not None:
            return UUID(str(row[0]))
    row = cursor.execute(
        """
        SELECT id FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id = %s AND testing_phase = %s
          AND status = 'DRAFT' AND operation_key LIKE 'plan-%%'
        ORDER BY created_at LIMIT 1
        """,
        (project_id, control_id, phase),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def _create_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: str,
    recipient: str,
    control_ref: str,
    due_days: int,
    follow_up_days: int,
    max_follow_ups: int,
    phase_end: date | None,
    requester: UUID,
    source: str,
) -> UUID:
    from ai_workforce_api.onboarding import pbc_reference

    count = cursor.execute(
        "SELECT count(*) FROM pbc_requests WHERE project_id = %s AND operation_key LIKE %s",
        (project_id, f"plan-{control_id.hex}-{phase.lower()}-%"),
    ).fetchone()
    number = 1 + (int(count[0]) if count is not None else 0)
    # Operating evidence cannot be complete before its window ends.
    start = max(datetime.now(UTC).date(), phase_end or date.min) if phase == "ROLLFORWARD" else None
    due = datetime.combine(
        (start or datetime.now(UTC).date()) + timedelta(days=due_days),
        datetime.min.time().replace(hour=23, minute=59),
        tzinfo=UTC,
    )
    row = cursor.execute(
        """
        INSERT INTO pbc_requests (
            organization_id, project_id, operation_key, control_ref, owner_user_id,
            recipient, due_at, evidence_description, follow_up_after_days, max_follow_ups,
            engagement_control_id, testing_phase, drafted_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'AGENT')
        ON CONFLICT (project_id, operation_key) DO UPDATE SET version = pbc_requests.version
        RETURNING id
        """,
        (
            organization_id, project_id, f"plan-{control_id.hex}-{phase.lower()}-{number}",
            pbc_reference(control_ref), requester, recipient, due,
            f"{PHASE_LABELS[phase]} evidence for {control_ref}", follow_up_days, max_follow_ups,
            control_id, phase,
        ),
    ).fetchone()  # fmt: skip
    assert row is not None
    request_id = UUID(str(row[0]))
    _audit(
        cursor, organization_id, project_id, requester, "pbc.updated", "pbc_request", request_id,
        {"status": "DRAFT", "source": source, "phase": phase},
    )  # fmt: skip
    return request_id


def _link(cursor: psycopg.Cursor[Any], ids: list[UUID], request_id: UUID, note: str) -> None:
    """Mark requirements as asked for in a request: the one place it is done (issue, the
    kickoff draft's reconciliation, the items that wait for a sample request). Never an
    addition the planner proposed and no person accepted (pending_change.add): it is not
    part of the plan, whoever asks."""
    if not ids:
        return
    cursor.execute(
        """
        UPDATE evidence_requirements
        SET status = 'REQUESTED', pbc_request_id = %s, coverage_note = %s,
            version = version + 1
        WHERE id = ANY(%s)
          AND NOT coalesce((pending_change ->> 'add')::boolean, false)
        """,
        (request_id, note[:300], ids),
    )


def _link_dependents(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, phase: str
) -> None:
    """Sample evidence waits for the sample request; once it exists, link to it."""
    sample = _sample_request(cursor, project_id, control_id, phase)
    if sample is None:
        cursor.execute(
            "UPDATE evidence_requirements SET status = 'AWAITING_DEPENDENCY' "
            "WHERE engagement_control_id = %s AND phase = %s AND status = 'PLANNED' "
            "AND depends_on IS NOT NULL",
            (control_id, phase),
        )
        return
    rows = cursor.execute(
        "SELECT id FROM evidence_requirements WHERE engagement_control_id = %s AND phase = %s "
        "AND status IN ('PLANNED', 'AWAITING_DEPENDENCY') AND depends_on IS NOT NULL",
        (control_id, phase),
    ).fetchall()
    _link(
        cursor, [UUID(str(row[0])) for row in rows], sample,
        "Requested with the samples the audit team selected.",
    )  # fmt: skip


def _sample_request(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, phase: str
) -> UUID | None:
    if phase == "DESIGN":
        return None
    if phase == "INTERIM":
        row = cursor.execute(
            "SELECT sample_request_id FROM control_tests WHERE project_id = %s "
            "AND engagement_control_id = %s AND test_round_id IS NULL "
            "AND sample_request_id IS NOT NULL",
            (project_id, control_id),
        ).fetchone()
    else:
        row = cursor.execute(
            """
            SELECT t.sample_request_id FROM control_tests t
            JOIN test_rounds r ON r.id = t.test_round_id
            WHERE t.project_id = %s AND t.engagement_control_id = %s
              AND r.kind = 'ROLLFORWARD' AND r.status <> 'CANCELLED'
              AND t.sample_request_id IS NOT NULL
            ORDER BY r.number DESC LIMIT 1
            """,
            (project_id, control_id),
        ).fetchone()
    return None if row is None else UUID(str(row[0]))


# The request text


@dataclass(frozen=True)
class _Line:
    title: str
    description: str
    period_label: str
    necessity: str


def render(
    control_ref: str,
    title: str,
    phase: str,
    lines: list[_Line],
    window: tuple[date | None, date | None],
) -> str:
    """The request text the approved email template carries, one item per requirement."""
    start, end = window
    if phase == "ROLLFORWARD":
        header = f"Roll-forward for {control_ref}: {title}"
        intro = (
            f"Our interim testing covered the control up to {start - timedelta(days=1)}. To "
            f"cover the rest of the period, from {start} to {end}, please provide:"
            if start is not None and end is not None
            else "To cover the rest of the period after our interim testing, please provide:"
        )
    elif phase == "INTERIM":
        header = f"Interim testing evidence for {control_ref}: {title}"
        intro = (
            f"To test how this control operated from {start} to {end}, please provide:"
            if start is not None and end is not None
            else "To test how this control operated in the period, please provide:"
        )
    else:
        header = f"Design evidence for {control_ref}: {title}"
        intro = (
            "To understand how this control is designed and confirm it is in place, please provide:"
        )
    closing = "Please label each file with the number of the item it answers. Thank you."

    def block(number: int, line: _Line, full: bool) -> str:
        optional = {"OPTIONAL": " (if available)", "CONDITIONAL": " (if it applies)"}
        heading = f"{number}. {line.title}{optional.get(line.necessity, '')}"
        wording = suite_wording(line.description)
        if wording is not None:
            # A standard's evidence item: each part on its own labelled line, under the
            # period the item itself covers (request_details.parse_wording reads it back).
            # What is not sufficient stays in the plan for the audit team: the client is
            # told what to provide, not what the auditor would reject.
            parts = [heading, f"   Period: {wording.period}"]
            parts.append("   Include: " + "; ".join(wording.include))
            if wording.completeness:
                parts.append(f"   Completeness: {wording.completeness}")
            if wording.alternatives:
                parts.append("   If not available: " + "; ".join(wording.alternatives))
            if wording.note:
                parts.append(f"   {wording.note}")
            return "\n".join(parts)
        from ai_workforce_api.pbc_drafting import detail_lines

        # Every line of the description under the item, its own list as "- " lines.
        parts = [heading, *(detail_lines(line.description) or [f"   {line.description}"])]
        if full and line.period_label:
            parts.append(f"   Period: {line.period_label}")
        return "\n".join(parts)

    # Every item, whole, with its period: a phase's requirements always fit.
    text = "\n\n".join(
        [header, intro, *(block(i + 1, line, True) for i, line in enumerate(lines)), closing]
    )
    if len(text) > MAX_DESCRIPTION:
        raise ValueError("the request is longer than a request can hold")
    return text


def render_into(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    control_id: UUID,
    request_id: UUID,
    *,
    unsent: bool = False,
) -> None:
    """Rewrite a draft request from the requirements it carries. A sent one stays.
    `unsent` also rewrites one awaiting approval: only for a request that is being taken
    out of the approval it awaits in the same transaction (evidence_receipts._set_aside),
    never one that could still be sent on that approval."""
    request = cursor.execute(
        "SELECT status, testing_phase FROM pbc_requests WHERE id = %s AND project_id = %s",
        (request_id, project_id),
    ).fetchone()
    allowed = ("DRAFT", "APPROVAL_PENDING") if unsent else ("DRAFT",)
    if request is None or request[0] not in allowed or request[1] not in PHASES:
        return
    phase = str(request[1])
    lines = requirement_lines(cursor, request_id)
    if not lines:
        return
    control = cursor.execute(
        "SELECT control_ref, title FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    assert control is not None
    window = _window(cursor, project_id, control_id, phase, request_id)
    cursor.execute(
        "UPDATE pbc_requests SET evidence_description = %s, version = version + 1, "
        "updated_at = clock_timestamp() WHERE id = %s AND status = ANY(%s)",
        (render(str(control[0]), str(control[1]), phase, lines, window), request_id, list(allowed)),
    )


def requirement_lines(cursor: psycopg.Cursor[Any], request_id: UUID) -> list[_Line]:
    rows = cursor.execute(
        """
        SELECT title, description, period_label, necessity FROM evidence_requirements
        WHERE pbc_request_id = %s AND status = 'REQUESTED'
        ORDER BY CASE necessity WHEN 'REQUIRED' THEN 0 WHEN 'CONDITIONAL' THEN 1 ELSE 2 END,
                 created_at, requirement_key
        """,
        (request_id,),
    ).fetchall()
    return [_Line(str(r[0]), str(r[1]), str(r[2]), str(r[3])) for r in rows]


def _window(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, phase: str, request_id: UUID
) -> tuple[date | None, date | None]:
    if phase == "ROLLFORWARD":
        round_row = cursor.execute(
            "SELECT window_start, window_end FROM test_rounds WHERE request_id = %s",
            (request_id,),
        ).fetchone()
        if round_row is not None:
            return round_row[0], round_row[1]
    row = cursor.execute(
        """
        SELECT ph.period_start, ph.period_end FROM evidence_plan_phases ph
        JOIN evidence_plans p ON p.id = ph.plan_id
        WHERE p.project_id = %s AND p.engagement_control_id = %s AND ph.phase = %s
        """,
        (project_id, control_id, phase),
    ).fetchone()
    return (None, None) if row is None else (row[0], row[1])


def queue_drafts(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    requester: UUID,
    control_id: UUID,
    request_ids: list[UUID],
) -> list[UUID]:
    """Have the evidence coordinator (re)write each request's wording from its plan."""
    ids: list[UUID] = []
    for request_id in request_ids:
        row = cursor.execute(
            """
            INSERT INTO pbc_drafts (
                organization_id, project_id, pbc_request_id, engagement_control_id,
                requested_by_user_id
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (pbc_request_id) DO UPDATE
            SET status = 'PENDING', source = NULL, content = NULL, model_call_id = NULL,
                note = '', attempts = 0, lease_until = NULL,
                version = pbc_drafts.version + 1, updated_at = clock_timestamp()
            WHERE pbc_drafts.status <> 'DRAFTING'
            RETURNING id
            """,
            (organization_id, project_id, request_id, control_id, requester),
        ).fetchone()
        if row is not None:
            ids.append(UUID(str(row[0])))
    return ids


# In the kickoff and scope transactions


# The planning gate (decided by the product owner): no evidence is requested from a plan a
# person has not approved. Design evidence (policy, narrative, walkthrough) waits for the
# approved plan; operating evidence (population, samples, reports) also waits for the
# control's attributes to be settled, since they define what a population must hold.

# A D&I request in the list (B1f): planned, waiting for the item it depends on, or
# requested. An addition the planner proposed counts (it waits for a person, like any
# proposal); a waived or removed request does not.
LISTED_STATUSES: tuple[str, ...] = ("PLANNED", "AWAITING_DEPENDENCY", "REQUESTED")

GATE_PLAN = "approve the test plan first"
# A control change was recorded and the planner's answer for it could not be used, so the
# plan was kept as it was (generate, B1h): its phases and periods may not fit the change.
# Operating evidence is not requested, samples are not approved and testing is not concluded
# on it until the evidence is planned again.
GATE_CHANGE = "plan the evidence again first: the plan has not been updated for a recorded change"


def change_unplanned(connection: psycopg.Connection[Any], control_id: UUID) -> datetime | None:
    """When the latest control change was recorded that the control's plan has not been
    generated for since, or None. Durable and self-clearing: the plan's generated_at moves
    only when a plan is written, so a run that kept the plan leaves this standing, and
    planning the evidence again clears it."""
    row = connection.execute(
        f"SELECT {_CHANGE_UNPLANNED_SQL} FROM evidence_plans p WHERE p.engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    found: datetime | None = None if row is None else row[0]
    return found


def change_wait(unplanned: datetime | None) -> str:
    if unplanned is None:
        return ""
    return (
        f"The plan has not been updated for the change recorded on {_day(unplanned)}. "
        "Plan the evidence again."
    )


GATE_ATTRIBUTES = "settle the control's attributes first"
# D&I evidence has its own release (B1, migration 0145): the test plan's approval gates only
# the operating phases.
GATE_DESIGN_RELEASE = "release the D&I evidence first"
_APPROVED_PLAN = ("APPROVED", "CHANGES_PROPOSED")
_OPERATING = ("INTERIM", "ROLLFORWARD")
# SQL: the control (aliased c) has approved attributes, none proposed, and no open
# conflict about them. The control workspace shows the same as "Definition and
# attributes" done.
ATTRIBUTES_SETTLED_SQL = """
    EXISTS (SELECT 1 FROM control_attributes a
            WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED')
    AND NOT EXISTS (SELECT 1 FROM control_attributes a
                    WHERE a.engagement_control_id = c.id AND a.status = 'PROPOSED')
    AND NOT EXISTS (SELECT 1 FROM control_context_issues i
                    WHERE i.engagement_control_id = c.id AND i.status = 'OPEN'
                      AND i.origin IN ('ATTRIBUTES', 'SOURCES'))
"""


def attributes_settled(connection: psycopg.Connection[Any], control_id: UUID) -> bool:
    row = connection.execute(
        f"SELECT {ATTRIBUTES_SETTLED_SQL} FROM engagement_controls c WHERE c.id = %s",
        (control_id,),
    ).fetchone()
    return row is not None and bool(row[0])


def gate_reason(
    connection: psycopg.Connection[Any], control_id: UUID, phase: str | None
) -> str | None:
    """Why the control's evidence for a phase cannot be requested yet, or None."""
    plan = connection.execute(
        "SELECT status FROM evidence_plans WHERE engagement_control_id = %s", (control_id,)
    ).fetchone()
    plan_status = None if plan is None else str(plan[0])
    settled = (
        attributes_settled(connection, control_id)
        if plan_status in _APPROVED_PLAN and phase in _OPERATING
        else True
    )
    released = (
        phase == "DESIGN"
        and connection.execute(
            "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = 'DESIGN'",
            (control_id,),
        ).fetchone()
        is not None
    )
    if phase != "DESIGN" and change_unplanned(connection, control_id) is not None:
        return GATE_CHANGE
    return gate_reason_from(plan_status, settled, phase, released)


def gate_reason_from(
    plan_status: str | None, settled: bool, phase: str | None, design_released: bool
) -> str | None:
    """gate_reason from the plan's status, whether the attributes are settled, and whether
    the D&I evidence is released: the one rule, whether read for one control or for an
    engagement at once. The Design phase follows its own release, never the test plan's
    approval, so revising the plan does not hold D&I requests (B1)."""
    if plan_status is None:
        return "plan the evidence first"
    if phase == "DESIGN":
        return None if design_released else GATE_DESIGN_RELEASE
    if plan_status not in _APPROVED_PLAN:
        return GATE_PLAN
    if phase in _OPERATING and not settled:
        return GATE_ATTRIBUTES
    return None


def gate_facts(
    connection: psycopg.Connection[Any], project_id: UUID
) -> tuple[dict[UUID, str], set[UUID]]:
    """Every control's plan status and the controls whose attributes are settled, read
    once for the engagement (for gate_reason_from)."""
    statuses = {
        UUID(str(row[0])): str(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, status FROM evidence_plans WHERE project_id = %s",
            (project_id,),
        ).fetchall()
    }
    settled = {
        UUID(str(row[0]))
        for row in connection.execute(
            f"SELECT c.id, {ATTRIBUTES_SETTLED_SQL} FROM engagement_controls c "
            "WHERE c.project_id = %s",
            (project_id,),
        ).fetchall()
        if bool(row[1])
    }
    return statuses, settled


def release(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> list[UUID]:
    """Request what the gate now allows (after the plan is approved, or the attributes are
    settled), and queue the drafts. Idempotent: what is requested is not asked again."""
    project = connection.execute(
        "SELECT p.status, s.kicked_off_at IS NOT NULL FROM projects p "
        "JOIN engagement_settings s ON s.project_id = p.id WHERE p.id = %s",
        (project_id,),
    ).fetchone()
    if project is None or project[0] != "ACTIVE" or not project[1]:
        return []
    if (
        connection.execute(
            "SELECT 1 FROM evidence_plans WHERE engagement_control_id = %s", (control_id,)
        ).fetchone()
        is None
    ):
        return []
    with transaction(connection) as cursor:
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def plan_and_issue(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
    source: str,
    agent: bool = False,
) -> list[UUID]:
    """Plan a control with the rules (no model call inside a transaction), and, when the
    planner agent is available, leave it to refine the plan in the background. The plan
    waits for a person either way, so nothing is requested until they approve it.
    Returns the new requests, for the coordinator to draft."""
    facts = load_facts(cursor.connection, project_id, control_id)
    planned = Planned(check_plan(rules_plan(facts), facts), "RULES", "", None)
    # The rules' plan is stored now. Approving it, later, is what requests evidence.
    persist(
        cursor, organization_id, project_id, control_id, planned, facts, requester,
        settle=False,
    )  # fmt: skip
    if agent:
        # The planner agent refines the rules' plan after the launch commits.
        cursor.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0, "
            "run_lease_until = NULL, run_note = '', run_stage = '' "
            "WHERE engagement_control_id = %s AND status = 'PROPOSED'",
            (control_id,),
        )
    # Only what the planning gate allows is requested: nothing from a plan that waits.
    return issue(cursor, organization_id, project_id, control_id, requester, source).created


# The planner agent's run on a launched control (migration 0077)

PLAN_RUN_ATTEMPTS = 3
# How long a queued plan run may wait for a worker before it reads as stopped (the D&I
# requests list then says what a person does, instead of "working" for ever). Counted from
# evidence_plans.run_queued_at, which a trigger sets whenever a run is queued (0150).
PLAN_QUEUE_MINUTES = 15
# The same for a request's draft waiting for the evidence coordinator (pbc_drafts.updated_at).
DRAFT_QUEUE_MINUTES = 15
# A plan run somebody is really working on, or that a worker is about to (evidence_plans as
# `p`): working under a live lease, or queued within the bound. A WORKING run whose lease
# ran out, or has none, and a run queued longer than the bound, are open but not live.
PLAN_RUN_LIVE_SQL = f"""
    ((p.run_status = 'WORKING' AND p.run_lease_until >= clock_timestamp())
     OR (p.run_status = 'PENDING'
         AND p.run_queued_at >= clock_timestamp() - interval '{PLAN_QUEUE_MINUTES} minutes'))
"""
# Long enough for the planner and its corrections (three calls of up to 300 s each).
PLAN_LEASE_MINUTES = 20


def queue_unrefined_plans(connection: psycopg.Connection[Any], project_id: UUID) -> list[UUID]:
    """The engagement's plans the rules drew up that the planner agent has never refined,
    such as a control added after launch, queued for it (product owner, 28 October 2026:
    the agent should fix what planning leaves, for a person to review and approve). A plan
    the agent has run on, or one a person approved, is left as it is."""
    with transaction(connection) as cursor:
        rows = cursor.execute(
            """
            UPDATE evidence_plans
            SET run_status = 'PENDING', run_lease_until = NULL, run_note = '',
                run_stage = ''
            WHERE project_id = %s AND status = 'PROPOSED' AND source = 'RULES'
              AND run_status = 'IDLE' AND run_attempts = 0
            RETURNING id
            """,
            (project_id,),
        ).fetchall()
    return [UUID(str(row[0])) for row in rows]


def replan_for_new_attributes(connection: psycopg.Connection[Any], control_id: UUID) -> UUID | None:
    """An attribute approved after the plan was made has no evidence: approving it sent
    the plan back for approval (revise_evidence_plan), and the planner agent now plans it
    again in the background, so the attribute has its evidence and criteria before a person
    reviews the plan (product owner, 27 October 2026). Not asked twice while a run waits.
    Returns the plan to run.

    A plain run: it clears the run's stage, as every queueing that is not a run following
    the understanding does (the launch's, queue_unrefined_plans). A stage left by a failed
    run of that kind would otherwise turn this one into a full attribute run (run_plan
    reads the stage), and the attribute agent would replace proposals a person has pending.
    Only a retry or a reclaim of the same run keeps its stage."""
    if _tried_the_same(connection, control_id):
        # The planner's last run on exactly these inputs did not finish its work (its
        # answer could not be used and the plan was kept, or it failed). Asking again on
        # every save would call the planner up to three times a save (B1h, after the
        # review): only a person, or a change in what the agents read, starts it again.
        # The attribute's missing evidence stays visible meanwhile (attributes_run).
        return None
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE evidence_plans p
            SET run_status = 'PENDING', run_attempts = 0, run_lease_until = NULL,
                run_note = '', run_stage = ''
            WHERE p.engagement_control_id = %s
              AND p.run_status NOT IN ('PENDING', 'WORKING')
              AND {_ATTRIBUTE_UNPLANNED_SQL}
            RETURNING p.id
            """,
            (control_id,),
        ).fetchone()
    return None if row is None else UUID(str(row[0]))


# An approved attribute no live requirement of a plan still to approve is planned against:
# approving it sent the plan back (revise_evidence_plan), and it has no evidence until the
# planner plans it. SQL over evidence_plans `p`.
_ATTRIBUTE_UNPLANNED_SQL = """
    (p.status = 'PROPOSED'
     AND EXISTS (
         SELECT 1 FROM control_attributes a
         WHERE a.engagement_control_id = p.engagement_control_id
           AND a.status = 'APPROVED'
           AND NOT EXISTS (
               SELECT 1 FROM evidence_requirement_attributes ra
               JOIN evidence_requirements q ON q.id = ra.requirement_id
               WHERE ra.attribute_id = a.id AND q.plan_id = p.id
                 AND q.status <> 'REMOVED')))
"""
# When a control change was recorded that the plan has not been generated for since: the
# planner's answer for it could not be used and the plan was kept (generate). SQL over `p`.
_CHANGE_UNPLANNED_SQL = """
    (SELECT max(ch.created_at) FROM control_changes ch
     WHERE ch.engagement_control_id = p.engagement_control_id
       AND ch.created_at > p.generated_at)
"""

# What of the planner's facts is not an input a rerun would act on: which criteria the
# planner may write and which attributes a person excepted from D&I are decisions on the
# agents' own proposals, and the interim result and the roll-forward window are the progress
# of testing, followed by their own hooks (refresh_decisions, on_rollforward_started).
_NOT_READ_AS_INPUT = ("criteria_writable", "design_excepted", "interim", "rollforward_window")


def agents_read(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> str:
    """A hash of what the agents read about the control, as it stands now: one value to
    compare with the one kept when their last run finished (evidence_plans.run_read).

    Not a list of tables to watch: it is taken from the readers the agents' prompts are
    built from. (1) The planner's facts, whole (load_facts: the control's record from the
    RCM, its library definition and statement with the client's values, its approved
    attributes as worded, the approved narrative, the confirmed understanding with its
    dates, the recorded control changes, the kinds of its documents, the methodology), less
    _NOT_READ_AS_INPUT. (2) The criteria a person stated for an approved attribute, which
    the attribute agent and the reviewer read and the planner does not. (3) The documents
    that apply to the control (control_context.documents): which, their titles, their
    length and opening words, so one linked, unlinked or replaced changes it.

    What an agent wrote itself is not in it (its proposals, the criteria it tailored, its
    review), nor a person's acceptance of that: a run does not make itself stale, and
    accepting the agents' work is not a reason to run them again."""
    from ai_workforce_api.control_context import documents

    facts = asdict(load_facts(connection, project_id, control_id))
    for name in _NOT_READ_AS_INPUT:
        facts.pop(name, None)
    stated = connection.execute(
        "SELECT a.text, a.condition, a.pass_criteria, a.fail_criteria, a.judgment_required "
        "FROM control_attributes a WHERE a.engagement_control_id = %s "
        "AND a.status = 'APPROVED' AND a.criteria_origin = 'PERSON' ORDER BY a.text, a.id",
        (control_id,),
    ).fetchall()
    papers = sorted(
        (str(d.id), d.kind, d.title, d.file_name, d.characters, d.excerpt)
        for d in documents(connection, project_id, control_id)
    )
    data = json.dumps([facts, stated, papers], default=str, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _tried_the_same(connection: psycopg.Connection[Any], control_id: UUID) -> bool:
    """Whether the control's last plan run did not finish its work on exactly what the
    agents would read now (evidence_plans.run_tried)."""
    row = connection.execute(
        "SELECT project_id, run_tried FROM evidence_plans WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    if row is None or str(row[1]) == "":
        return False
    return str(row[1]) == agents_read(connection, UUID(str(row[0])), control_id)


# The planner follows the understanding (product owner, 12 November 2026: "Shouldn't it
# automatically update when the user has completed the control understanding?"). SQL over
# evidence_plans as `p`.

# When a person last changed what the control's understanding states: a client value of its
# statement, or a confirmed walkthrough answer. Both tables keep updated_at by trigger, and
# the same answer saved again writes nothing.
_UNDERSTANDING_CHANGED_SQL = """
    (SELECT max(changed.at) FROM (
         SELECT max(v.updated_at) AS at FROM control_parameters v
         WHERE v.engagement_control_id = p.engagement_control_id
         UNION ALL
         SELECT max(w.updated_at) FROM control_walkthrough_answers w
         WHERE w.engagement_control_id = p.engagement_control_id
           AND w.status = 'CONFIRMED'
     ) AS changed)
"""
# An approved attribute the planner may write criteria for that has none a tester could
# apply yet.
_CRITERIA_MISSING_SQL = f"""
    EXISTS (SELECT 1 FROM control_attributes a
            WHERE a.engagement_control_id = p.engagement_control_id
              AND {CRITERIA_WRITABLE_SQL}
              AND a.judgment_required IS NOT TRUE
              AND (a.condition = '' OR a.pass_criteria = '' OR a.fail_criteria = ''))
"""
# The agents that read the understanding are at work on the control, or about to be: its
# plan run, or the approved narrative's planning run (which runs the same two agents). A
# working run counts while its lease lives; one whose lease ran out was interrupted.
_AGENTS_AT_WORK_SQL = """
    (p.run_status = 'PENDING'
     OR (p.run_status = 'WORKING' AND p.run_lease_until >= clock_timestamp())
     OR EXISTS (SELECT 1 FROM process_narrative_runs r
                WHERE r.engagement_control_id = p.engagement_control_id
                  AND (r.run_status = 'PENDING'
                       OR (r.run_status = 'WORKING'
                           AND (r.run_lease_until IS NULL
                                OR r.run_lease_until >= clock_timestamp())))))
"""


def understanding_due(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    since: datetime | None = None,
) -> bool:
    """Whether the control's attributes and plan should follow its understanding now: Control
    Understanding is complete (phase_release.understanding_waits), and the planner has not
    read it as it stands. That is: a value or a confirmed walkthrough answer changed after
    the plan was last generated (or after `since`, for a run checking what changed while it
    worked), or the planner agent never ran on the plan and an approved attribute still has
    no criteria. One rule for what is queued (queue_for_understanding) and for what a run
    does (run_plan), so no flag is kept on the run. It stops by itself: a run generates the
    plan again, and a planner that has run is not asked again until the understanding
    changes."""
    row = connection.execute(
        f"""
        SELECT coalesce({_UNDERSTANDING_CHANGED_SQL}
                        > coalesce(%s::timestamptz, p.generated_at), false)
               OR (%s::timestamptz IS NULL AND p.source = 'RULES' AND {_CRITERIA_MISSING_SQL})
        FROM evidence_plans p
        WHERE p.project_id = %s AND p.engagement_control_id = %s
        """,
        (since, since, project_id, control_id),
    ).fetchone()
    if row is None or not row[0]:
        return False
    from ai_workforce_api.phase_release import understanding_waits

    return control_id not in understanding_waits(connection, project_id, control_id)


def queue_for_understanding(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> UUID | None:
    """Queue the control's plan run once its understanding is complete and the planner has
    not read it (understanding_due): the run proposes the attributes the understanding calls
    for, then plans again, so every attribute the planner may write gets criteria tailored to
    the control and the evidence follows the walkthrough. Nothing approved changes: proposals
    wait for a decision, criteria are the agent's to accept, and an approved plan gets its
    changes proposed. Never while a run for the control waits or works (the plan's, or the
    approved narrative's, which does the same), and not over a failed run, which a person
    starts again. Returns the plan to run."""
    if not understanding_due(connection, project_id, control_id):
        return None
    # A run that kept the plan because the planner's answer could not be used (generate)
    # leaves the plan as generated before, so the understanding still reads as due. It is
    # not asked again by itself on every save: only once what the agents read has changed
    # since that run (run_tried). A person's "Run again" is not held by this.
    if _tried_the_same(connection, control_id):
        return None
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE evidence_plans p
            SET run_status = 'PENDING', run_attempts = 0, run_lease_until = NULL,
                run_note = '', run_stage = 'ATTRIBUTES'
            WHERE p.project_id = %s AND p.engagement_control_id = %s
              AND p.run_status = 'IDLE' AND NOT {_AGENTS_AT_WORK_SQL}
            RETURNING p.id
            """,
            (project_id, control_id),
        ).fetchone()
    return None if row is None else UUID(str(row[0]))


def request_attributes_run(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, force: bool = False
) -> UUID | None:
    """A person asks for the attributes to be prepared again ("Run again"): the same run as
    queue_for_understanding, whether or not anything changed, and over a run that failed or
    stopped before it finished (its lease ran out). Not while a run waits or works. The run
    is marked as one that starts with the attributes (run_stage), which run_plan reads.
    Returns the plan to run, or None when there is no plan or a run is live.

    Nothing is queued, and nothing is written, when the run would have nothing to do
    (attributes_rerun_useful, B1h): the agents would read what they read at their last
    finished run. The caller says so (nothing_changed_note). With `force` a person runs
    them on purpose all the same: the run is queued whether or not anything changed."""
    if not force and not attributes_rerun_useful(connection, project_id, control_id):
        return None
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE evidence_plans p
            SET run_status = 'PENDING', run_attempts = 0, run_lease_until = NULL,
                run_note = '', run_stage = 'ATTRIBUTES'
            WHERE p.project_id = %s AND p.engagement_control_id = %s
              AND NOT {_AGENTS_AT_WORK_SQL}
            RETURNING p.id
            """,
            (project_id, control_id),
        ).fetchone()
    return None if row is None else UUID(str(row[0]))


def nothing_changed_note(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> str:
    """What "Run again" answers when it starts nothing (attributes_rerun_useful is false):
    the date is the agents' last finished run, or, for a plan with none on record, when the
    plan was generated."""
    row = connection.execute(
        "SELECT coalesce(run_read_at, generated_at) FROM evidence_plans "
        "WHERE project_id = %s AND engagement_control_id = %s",
        (project_id, control_id),
    ).fetchone()
    if row is None or row[0] is None:
        return "Nothing the agents read has changed since their last run."
    return f"Nothing the agents read has changed since their last run on {_day(row[0])}."


def _day(moment: datetime) -> str:
    return f"{moment.day} {moment:%B %Y}"


def attributes_rerun_useful(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> bool:
    """Whether running the agents again on the control's attributes would do anything, for
    "Run again" (request_attributes_run) and for the Attributes step, which shows a stopped
    run's note only then (the context's `attributes_rerun_useful`).

    One comparison: what the agents would read now (agents_read) against what they read at
    their last finished run (evidence_plans.run_read). Anything they read that changed
    makes it true: a person reworded an attribute or its criteria, added or retired one, a
    document was linked, unlinked or replaced, the approved narrative, the control's record
    or its library definition changed, the understanding changed, a control change was
    recorded. A run of which a stage did not finish (the planner's answer could not be used,
    or the attribute agent or the reviewer failed) is not a finished run, so it leaves this
    true whenever what they read differs from the last run that did finish.

    Also true, whatever was read: the control has no plan; the plan's last run failed or
    was interrupted; the planner agent has not planned the control (the plan is the rules',
    RULES or FALLBACK: a run that succeeds changes that); an approved attribute has no
    evidence planned against it; a recorded control change is not in the plan. For a plan
    with no finished run on record (from before migration 0154) the older rule stands in
    for the comparison: the understanding changed after the plan was generated, an
    approved attribute the planner may write has no criteria, or the only run since did not
    finish its work. False while a run waits or works: there is nothing to start."""
    row = connection.execute(
        f"""
        SELECT {_AGENTS_AT_WORK_SQL},
               p.source IN ('RULES', 'FALLBACK') OR p.run_status IN ('FAILED', 'WORKING')
               OR {_ATTRIBUTE_UNPLANNED_SQL} OR {_CHANGE_UNPLANNED_SQL} IS NOT NULL,
               p.run_read,
               coalesce({_UNDERSTANDING_CHANGED_SQL} > p.generated_at, false)
               OR {_CRITERIA_MISSING_SQL} OR p.run_tried <> ''
        FROM evidence_plans p
        WHERE p.project_id = %s AND p.engagement_control_id = %s
        """,
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return True
    if row[0]:
        return False
    if row[1]:
        return True
    if str(row[2]) == "":
        return bool(row[3])
    return agents_read(connection, project_id, control_id) != str(row[2])


STOPPED_NOTE = "The run stopped before it finished. Run again."
UNUSABLE_NOTE = "The planner's answer could not be used. Run again."
NOT_STARTED_NOTE = (
    "The planner's last run failed, so the attributes were not updated from the "
    "understanding. Run again."
)


def reclaim_interrupted_plan_runs(connection: psycopg.Connection[Any]) -> int:
    """Plan runs a previous process left working, for the local worker's start (it runs in
    the API process, one process, for local development: settings.local_worker_enabled). The
    process that was working on them is gone (a restart, or a reload on a saved file), so
    their leases protect nobody: they go back to waiting and resume at once, instead of
    reading as working until a lease of many minutes runs out (12 November 2026). A run out
    of attempts is marked failed with a note the page shows. Not for a worker that shares
    the database with other workers: there a live lease is somebody's."""
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_plans SET run_status = 'FAILED', run_lease_until = NULL, "
            "run_note = %s WHERE run_status = 'WORKING' AND run_attempts >= %s",
            (STOPPED_NOTE, PLAN_RUN_ATTEMPTS),
        )
        waiting = cursor.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_lease_until = NULL "
            "WHERE run_status = 'WORKING' RETURNING id"
        ).fetchall()
    return len(waiting)


AttributesRun = Literal["PENDING", "WORKING", "STOPPED", ""]
AttributesStage = Literal["ATTRIBUTES", "CRITERIA", "REVIEW", ""]


def attributes_run(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[AttributesRun, AttributesStage, str]:
    """Whether the agents are updating the control's attributes and criteria now, what they
    are doing, and a note when their last run did not finish, for the Attributes step: the
    plan's run that follows the understanding, with its stage (migration 0148), or the
    approved narrative's planning run with its own (ATTRIBUTES, then EVIDENCE, where the
    planner tailors the criteria).

    Only a run that has a stage is such a run. The planner's plain run (run_stage empty:
    the launch's refinement, or the evidence planned for an attribute a person just
    accepted, replan_for_new_attributes) changes no attribute and no accepted criteria, so
    the Attributes step shows nothing for it and blocks nothing (product owner, 12 November
    2026: "when I accepted all the attributes, it shows updating again? Why is that?").

    Working never outlives the lease: a run whose lease ran out (its process died), one that
    failed, and one whose planner answer could not be used (the rules planned instead) read
    as STOPPED with what a person does next, never as working."""
    row = connection.execute(
        """
        SELECT p.run_status, p.run_stage,
               p.run_lease_until IS NOT NULL AND p.run_lease_until >= clock_timestamp(),
               (SELECT r.stage FROM process_narrative_runs r
                WHERE r.engagement_control_id = p.engagement_control_id
                  AND r.stage IN ('ATTRIBUTES', 'EVIDENCE')
                  AND r.run_status = 'WORKING'
                  AND (r.run_lease_until IS NULL OR r.run_lease_until >= clock_timestamp())),
               p.source, p.run_note, p.project_id
        FROM evidence_plans p WHERE p.engagement_control_id = %s
        """,
        (control_id,),
    ).fetchone()
    if row is None:
        return "", "", ""
    status, stage, live, narrative = str(row[0]), str(row[1]), bool(row[2]), str(row[3] or "")
    if stage != "":
        if status == "PENDING":
            return "PENDING", "", ""
        if status == "WORKING" and live:
            return (
                "WORKING",
                "ATTRIBUTES" if stage == "ATTRIBUTES"
                else "CRITERIA" if stage == "CRITERIA"
                else "REVIEW",
                "",
            )  # fmt: skip
    if narrative != "":
        return "WORKING", "ATTRIBUTES" if narrative == "ATTRIBUTES" else "CRITERIA", ""
    if stage != "" and status in ("WORKING", "FAILED"):
        return "STOPPED", "", STOPPED_NOTE
    if status == "IDLE" and row[4] == "FALLBACK" and str(row[5]).startswith(UNUSABLE_NOTE):
        return "STOPPED", "", UNUSABLE_NOTE
    if (
        status == "IDLE"
        and str(row[5]).startswith(KEPT_NOTE)
        and attributes_rerun_useful(connection, UUID(str(row[6])), control_id)
    ):
        # The planner's answer could not be used and the plan was kept (generate): said
        # only while something still waits on the planner, never on a settled control.
        return "STOPPED", "", UNUSABLE_NOTE
    if status == "FAILED" and understanding_due(connection, UUID(str(row[6])), control_id):
        # The planner's own run failed earlier (the launch's refinement, say), and the
        # understanding has since been completed. Nothing is queued over a failed run, which
        # a person starts again (queue_for_understanding), so the step says so instead of
        # showing nothing: "Run again" starts the run that follows the understanding.
        return "STOPPED", "", NOT_STARTED_NOTE
    return "", "", ""


def open_plan_runs(
    connection: psycopg.Connection[Any], project_id: UUID | None = None
) -> list[UUID]:
    """Plans waiting for the planner agent, or whose run was interrupted."""
    return [
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT id FROM evidence_plans
            WHERE (run_status = 'PENDING'
                   OR (run_status = 'WORKING' AND run_lease_until < clock_timestamp()))
              AND (%s::uuid IS NULL OR project_id = %s)
            ORDER BY created_at
            LIMIT 500
            """,
            (project_id, project_id),
        ).fetchall()
    ]


def run_plan(
    connection: psycopg.Connection[Any], provider: ModelProvider | None, plan_id: UUID
) -> str:
    """The planner agent plans one control again, from its records, over the rules' plan.
    The plan stays proposed until a person approves it. A plan a person approved
    meanwhile is left as approved.

    Each step commits on its own (db.independent_steps), as every background job's does: the
    claim and the stage are visible while the agents work, and no row of the control stays
    locked during a model call, so a person can keep saving answers meanwhile."""
    independent_steps(connection)
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            UPDATE evidence_plans
            SET run_status = 'WORKING', run_attempts = run_attempts + 1,
                run_lease_until = clock_timestamp() + make_interval(mins => %s)
            WHERE id = %s AND run_attempts < %s
              AND (run_status = 'PENDING'
                   OR (run_status = 'WORKING' AND run_lease_until < clock_timestamp()))
            RETURNING organization_id, project_id, engagement_control_id, status,
                      coalesce(generated_by, (SELECT owner_user_id FROM projects
                                              WHERE id = evidence_plans.project_id)),
                      run_stage
            """,
            (PLAN_LEASE_MINUTES, plan_id, PLAN_RUN_ATTEMPTS),
        ).fetchone()
    if row is None:
        return "SKIPPED"
    organization_id, project_id, control_id = (
        UUID(str(row[0])),
        UUID(str(row[1])),
        UUID(str(row[2])),
    )
    note = ""
    # What the agents read at the start of the run's last pass, and whether that pass
    # finished its work: kept on the plan for attributes_rerun_useful and the queues (0154).
    read, finished = "", False
    if provider is None:
        if str(row[3]) == "PROPOSED":
            note = "The rules' plan stands and waits for a person to approve it."
    else:
        requester = UUID(str(row[4]))
        # A complete understanding the planner has not read: the attributes follow it
        # first, and the plan is generated again whatever its status (an approved plan's
        # changes are proposed, by persist). Otherwise only a proposed plan is refined.
        # A run queued to start with the attributes (queue_for_understanding, a person's
        # "Run again"), or interrupted in one of its stages, says so in run_stage.
        follows = str(row[5]) != "" or understanding_due(connection, project_id, control_id)
        if follows or str(row[3]) == "PROPOSED":
            began = _now(connection)
            read = agents_read(connection, project_id, control_id)
            note, finished = _plan_pass(
                connection, provider, organization_id, project_id, control_id, requester,
                follows,
            )  # fmt: skip
            # An answer saved while the agents worked was not read: once more, and only
            # once, so a run always ends.
            if follows and understanding_due(connection, project_id, control_id, began):
                read = agents_read(connection, project_id, control_id)
                note, finished = _plan_pass(
                    connection, provider, organization_id, project_id, control_id,
                    requester, True,
                )  # fmt: skip
    from ai_workforce_api.phase_release import settle_after_run

    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE evidence_plans
            SET run_status = 'IDLE', run_lease_until = NULL, run_stage = '', run_note = %s,
                run_read = CASE WHEN %s THEN %s ELSE run_read END,
                run_read_at = CASE WHEN %s THEN clock_timestamp() ELSE run_read_at END,
                run_tried = CASE WHEN %s THEN '' WHEN %s <> '' THEN %s ELSE run_tried END
            WHERE id = %s
            """,
            (note[:300], finished, read, finished, finished, read, read, plan_id),
        )
        # The run may have been the last thing a D&I requests list a person had completed
        # waited for: the release their decision stood for is recorded with the run's end,
        # in the same step, as theirs and marked deferred (phase_release.settle_design). A
        # run that changed or added anything left it to accept, so nothing is released.
        # Never fails the run, which is done.
        settle_after_run(cursor.connection, control_id, "PLAN_RUN")
    return "DONE"


def _now(connection: psycopg.Connection[Any]) -> datetime:
    row = connection.execute("SELECT clock_timestamp()").fetchone()
    assert row is not None
    found: datetime = row[0]
    return found


def _plan_pass(
    connection: psycopg.Connection[Any],
    provider: ModelProvider,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
    attributes_first: bool,
) -> tuple[str, bool]:
    """One pass of a plan run: the attribute agent's proposals from the understanding when
    the run follows it (as the approved narrative's run does, process_narrative), then the
    planner. The proposals stay proposed; the planner's criteria are the agent's.

    Returns the run's note and whether the pass finished its work: the planner's answer was
    used (the plan was neither kept nor planned by the rules in its place) and no other
    agent's last call in the pass failed."""
    began = _now(connection)
    if not attributes_first:
        _, _drafts, note = generate(
            connection, provider, organization_id, project_id, control_id, requester
        )
        return note, _pass_finished(connection, control_id, began, note)
    from ai_workforce_api.attribute_review import review_set
    from ai_workforce_api.context_routes import _generate

    _run_stage(connection, control_id, "ATTRIBUTES")
    attribute_note = _generate(
        connection, provider, organization_id, project_id, control_id, requester
    )
    _run_stage(connection, control_id, "CRITERIA")
    _, _drafts, note = generate(
        connection, provider, organization_id, project_id, control_id, requester
    )
    fell_back = connection.execute(
        "SELECT source = 'FALLBACK' FROM evidence_plans WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    if fell_back is not None and fell_back[0]:
        # The planner's answer broke a rule after its corrections and the rules planned
        # instead (plan_for): no criteria were tailored. Said first, in words the page
        # shows; the run still ends, and a person runs it again.
        attribute_note = f"{UNUSABLE_NOTE} {attribute_note}".strip()
    if note.startswith(KEPT_NOTE):
        # The answer could not be used and the plan was kept as it was (generate): said
        # first, so the run's note starts with it (attributes_run reads it).
        attribute_note, note = note, attribute_note
    # The independent reviewer reads the set as it now stands, before a person does.
    _run_stage(connection, control_id, "REVIEW")
    review_note = review_set(
        connection, provider, organization_id, project_id, control_id, requester
    )
    planner_note = attribute_note if attribute_note.startswith(KEPT_NOTE) else note
    return (
        " ".join(part for part in (attribute_note, note, review_note) if part),
        _pass_finished(connection, control_id, began, planner_note),
    )


def _pass_finished(
    connection: psycopg.Connection[Any], control_id: UUID, began: datetime, planner_note: str
) -> bool:
    """Whether a pass of a plan run finished its work (see _plan_pass). The planner's
    outcome is read from the plan; the attribute agent's, its drafts' reviewer's and the
    set reviewer's from their calls on the control since the pass began: the last call of
    each must have succeeded."""
    if planner_note.startswith(KEPT_NOTE):
        return False
    from ai_workforce_api import attribute_review, control_attributes

    agents = [
        version.split("/", 1)[0]
        for version in (
            control_attributes.PROMPT_VERSION,
            control_attributes.REVIEW_PROMPT_VERSION,
            attribute_review.PROMPT_VERSION,
        )
    ]
    row = connection.execute(
        """
        SELECT p.source = 'FALLBACK'
               OR EXISTS (
                   SELECT 1 FROM (
                       SELECT DISTINCT ON (m.agent_key, m.prompt_version) m.status
                       FROM model_calls m
                       WHERE m.target_type = 'engagement_control'
                         AND m.target_id = p.engagement_control_id
                         AND m.created_at >= %s
                         AND split_part(m.prompt_version, '/', 1) = ANY(%s)
                       ORDER BY m.agent_key, m.prompt_version, m.created_at DESC
                   ) AS last
                   WHERE last.status <> 'SUCCEEDED')
        FROM evidence_plans p WHERE p.engagement_control_id = %s
        """,
        (began, agents, control_id),
    ).fetchone()
    return row is not None and not row[0]


def _run_stage(connection: psycopg.Connection[Any], control_id: UUID, stage: str) -> None:
    """The stage a run that follows the understanding is in, for the Attributes step's
    working state (migration 0148); each stage renews the lease."""
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_plans SET run_stage = %s, run_lease_until = clock_timestamp() "
            "+ make_interval(mins => %s) WHERE engagement_control_id = %s "
            "AND run_status = 'WORKING'",
            (stage, PLAN_LEASE_MINUTES, control_id),
        )


def fail_plan_run(connection: psycopg.Connection[Any], plan_id: UUID) -> None:
    """The agent could not plan: the rules' plan stands, and still waits for a person. The
    run keeps its stage, which says it was one that follows the understanding
    (attributes_run reads it as stopped); the next run sets it again. What the agents
    would have read is kept (run_tried), so nothing queues the same run again by itself."""
    tried = ""
    try:
        found = connection.execute(
            "SELECT project_id, engagement_control_id FROM evidence_plans WHERE id = %s",
            (plan_id,),
        ).fetchone()
        if found is not None:
            tried = agents_read(connection, UUID(str(found[0])), UUID(str(found[1])))
    except Exception:
        # The failure is recorded whatever happens here; without the hash the run may be
        # queued again, as before.
        logger.warning("could not read what a failed plan run would have read")
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE evidence_plans SET run_status = 'FAILED', run_lease_until = NULL, "
            "run_tried = CASE WHEN %s <> '' THEN %s ELSE run_tried END, "
            "run_note = 'The planner agent could not refine this plan; the rules plan "
            "stands and waits for approval.' WHERE id = %s AND run_status IN "
            "('PENDING', 'WORKING') RETURNING engagement_control_id",
            (tried, tried, plan_id),
        )
        failed = cursor.fetchone()
        if failed is not None:
            # A failed run changed nothing on the list: like a finished one, its end may be
            # the last thing a list a person had completed waited for.
            from ai_workforce_api.phase_release import settle_after_run

            settle_after_run(cursor.connection, UUID(str(failed[0])), "PLAN_RUN")


def plan_runner(settings: Settings) -> Callable[[UUID], str]:
    """Runs one plan on its own connection, for the background worker."""
    from ai_workforce_api.db import connect

    def run(plan_id: UUID) -> str:
        provider = provider_for(settings) if live_model(settings) else None
        with connect(settings.database_url) as connection:
            return run_plan(connection, provider, plan_id)

    return run


# Hooks from testing


def population_gate(
    connection: psycopg.Connection[Any], control_id: UUID, round_kind: str | None
) -> str | None:
    """Why the samples cannot be approved yet, or None. Samples are drawn only from a
    population a person accepted as complete and accurate (or whose support they waived)."""
    phase = "INTERIM" if round_kind is None else round_kind
    if phase not in ("INTERIM", "ROLLFORWARD"):
        return None
    if change_unplanned(connection, control_id) is not None:
        return GATE_CHANGE
    rows = connection.execute(
        """
        SELECT q.title, q.categories, q.necessity, q.status, q.sufficiency
        FROM evidence_requirements q
        JOIN evidence_plan_phases ph
          ON ph.plan_id = q.plan_id AND ph.phase = q.phase AND ph.applicability = 'APPLICABLE'
        WHERE q.engagement_control_id = %s AND q.phase = %s AND q.depends_on IS NULL
          AND q.status NOT IN ('WAIVED', 'REMOVED')
          AND (q.categories && ARRAY['POPULATION']::text[]
               OR (q.categories && ARRAY['REPORT_RELIABILITY']::text[]
                   AND q.necessity = 'REQUIRED'))
        """,
        (control_id, phase),
    ).fetchall()
    waiting = [str(row[0]) for row in rows if row[4] != "ACCEPTED"]
    if not waiting:
        return None
    return (
        "the population is not validated yet: accept "
        + "; ".join(f'"{title}"' for title in waiting[:3])
        + " on the evidence plan, or waive it with a reason"
    )


def population_waiting_controls(connection: psycopg.Connection[Any], project_id: UUID) -> set[UUID]:
    """The controls whose interim population population_gate would still refuse."""
    rows = connection.execute(
        """
        SELECT DISTINCT q.engagement_control_id
        FROM evidence_requirements q
        JOIN evidence_plan_phases ph
          ON ph.plan_id = q.plan_id AND ph.phase = q.phase AND ph.applicability = 'APPLICABLE'
        WHERE q.project_id = %s AND q.phase = 'INTERIM' AND q.depends_on IS NULL
          AND q.status NOT IN ('WAIVED', 'REMOVED') AND q.sufficiency <> 'ACCEPTED'
          AND (q.categories && ARRAY['POPULATION']::text[]
               OR (q.categories && ARRAY['REPORT_RELIABILITY']::text[]
                   AND q.necessity = 'REQUIRED'))
        """,
        (project_id,),
    ).fetchall()
    return {UUID(str(row[0])) for row in rows}


def on_samples_approved(
    cursor: psycopg.Cursor[Any],
    control_id: UUID,
    project_id: UUID,
    round_kind: str | None,
    sample_request_id: UUID,
) -> None:
    """The sample request serves its phase, and carries the sample evidence it planned."""
    phase = "INTERIM" if round_kind is None else round_kind
    cursor.execute(
        "UPDATE pbc_requests SET testing_phase = %s WHERE id = %s AND project_id = %s",
        (phase, sample_request_id, project_id),
    )
    if phase in ("INTERIM", "ROLLFORWARD"):
        _link_dependents(cursor, project_id, control_id, phase)


def sample_asks(
    cursor: psycopg.Cursor[Any], control_id: UUID, round_kind: str | None
) -> str | None:
    """What the plan asks for each selected item, for the sample request's wording."""
    phase = "INTERIM" if round_kind is None else round_kind
    rows = cursor.execute(
        """
        SELECT description, title FROM evidence_requirements
        WHERE engagement_control_id = %s AND phase = %s AND depends_on IS NOT NULL
          AND status IN ('PLANNED', 'AWAITING_DEPENDENCY')
        ORDER BY created_at, requirement_key
        """,
        (control_id, phase),
    ).fetchall()
    if not rows:
        return None

    def ask_of(description: str, title: str) -> str:
        # A standard's evidence item names itself in its title and lists what it shows.
        wording = suite_wording(description)
        if wording is not None:
            return f"{title.rstrip('.')}, showing: " + "; ".join(wording.include)
        return re.sub(
            r"(?i)^for each (?:item|review|change|selected \w+)[^:]*:\s*", "", description
        )

    asks = [ask_of(str(r[0]), str(r[1])) for r in rows]
    return " Also: ".join(ask.rstrip(".") for ask in asks)[:1500]


def refresh_decisions(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID | None,
) -> Issued:
    """Testing moved on (interim signed off or reopened, a round started): decisions the
    records settle follow, unless a person decided the phase. Then request what is due."""
    plan = cursor.execute(
        "SELECT id FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s",
        (project_id, control_id),
    ).fetchone()
    if plan is None:
        return Issued([], [])
    facts = load_facts(cursor.connection, project_id, control_id)
    forced = forced_decisions(facts)
    periods = phase_periods(facts)
    for phase in PHASES:
        decision = forced.get(phase)
        period = periods[phase]
        if decision is not None:
            moved = cursor.execute(
                """
                UPDATE evidence_plan_phases
                SET applicability = %s, rationale = %s, condition = %s, open_question = %s,
                    origin = 'RULES', version = version + 1
                WHERE plan_id = %s AND phase = %s AND origin <> 'PERSON'
                  AND (applicability, rationale) IS DISTINCT FROM (%s, %s)
                RETURNING id
                """,
                (
                    decision.applicability, decision.rationale, decision.condition,
                    decision.open_question, plan[0], phase, decision.applicability,
                    decision.rationale,
                ),
            ).fetchone()  # fmt: skip
            if moved is not None:
                _audit(
                    cursor, organization_id, project_id, requester, "evidence_plan.phase_decided",
                    "evidence_plan", UUID(str(plan[0])),
                    {"phase": phase, "applicability": decision.applicability, "by": "RULES"},
                )  # fmt: skip
        cursor.execute(
            """
            UPDATE evidence_plan_phases SET period_start = %s, period_end = %s
            WHERE plan_id = %s AND phase = %s
              AND (period_start, period_end) IS DISTINCT FROM (%s, %s)
            """,
            (period.start, period.end, plan[0], phase, period.start, period.end),
        )
    if requester is None:
        return Issued([], [])
    return issue(cursor, organization_id, project_id, control_id, requester, "evidence_plan")


def on_rollforward_started(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    request_id: UUID | None,
    requester: UUID,
) -> None:
    """A roll-forward round started: its request serves the roll-forward phase and carries
    the phase's planned requirements, for the round's own window."""
    if request_id is not None:
        cursor.execute(
            "UPDATE pbc_requests SET testing_phase = 'ROLLFORWARD' WHERE id = %s", (request_id,)
        )
    _follow_window(cursor, project_id, control_id)
    # The request text is written from the requirements here, so no redraft is queued.
    refresh_decisions(cursor, organization_id, project_id, control_id, requester)
    if request_id is not None:
        render_into(cursor, project_id, control_id, request_id)


def _follow_window(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> None:
    """The roll-forward's not-yet-requested requirements cover the round's own window: the
    rules' wording is rewritten for it; any other wording keeps its words, with the dates."""
    facts = load_facts(cursor.connection, project_id, control_id)
    period = phase_periods(facts)["ROLLFORWARD"]
    for requirement in rules_plan(facts, every_phase=True).phase("ROLLFORWARD").requirements:
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET title = %s, description = %s, period_label = %s, sample_selection = %s,
                version = version + 1
            WHERE engagement_control_id = %s AND phase = 'ROLLFORWARD'
              AND requirement_key = %s AND origin = 'RULES' AND NOT person_edited
              AND status IN ('PLANNED', 'AWAITING_DEPENDENCY')
            """,
            (
                requirement.title, requirement.description,
                requirement.period_label or period.label, requirement.sample_selection,
                control_id, requirement.key,
            ),
        )  # fmt: skip
    cursor.execute(
        """
        UPDATE evidence_requirements SET period_start = %s, period_end = %s
        WHERE engagement_control_id = %s AND phase = 'ROLLFORWARD'
          AND status IN ('PLANNED', 'AWAITING_DEPENDENCY')
        """,
        (period.start, period.end, control_id),
    )


# Reading a plan


Coverage = Literal["COVERED", "PARTIAL", "NOT_COVERED"]
Proposal = Literal["SUFFICIENT", "FOLLOW_UP", "INSUFFICIENT", "NONE"]


class RequirementFile(BaseModel):
    """A file that serves a requirement: through the request that carries it, or linked
    to it by a person. What the evidence reader found applies only to the first: a linked
    file was read against its own request."""

    file_id: UUID
    name: str
    # REQUEST: on its request. LINK: linked by a person. SHARED: added on the same item of
    # another application's instance of the control, and applying to this one too.
    via: Literal["REQUEST", "LINK", "SHARED"]
    link_id: UUID | None = None
    linked_by: str | None = None
    reason: str = ""
    link_version: int | None = None
    read_status: str | None = None
    # Who read it: the model, or the reviewed keyword rules (no model, or a rejected answer).
    read_by: Literal["MODEL", "RULES", "SEEDED"] | None = None
    kind: str | None = None
    kind_confirmed: bool = False
    coverage: Coverage | None = None
    note: str = ""
    period: str = ""
    gaps: list[str] = Field(default_factory=list)
    # SHARED: the application whose instance it was added on.
    shared_from: str | None = None


class Assessment(BaseModel):
    """The evidence reader's proposal for a requirement, from what it found in each file.
    A proposal only: the requirement's sufficiency is a person's (set_sufficiency)."""

    proposal: Proposal
    reason: str
    follow_ups: list[str] = Field(default_factory=list)


NO_ASSESSMENT = Assessment(proposal="NONE", reason="Nothing has arrived for it yet.")

# A file on a requirement's request serves it as follows (22 Oct 2026, by the product
# owner's decision):
# - A file a person added for one item of the request serves that item only
#   (evidence_matches.requirement_id, migration 0101), whatever the reader found.
# - Any other file on the request (added on the request itself, or sent by the owner)
#   serves each of its items, unless the model read the file and found it does not cover
#   that item, and no person has judged the item yet (a person's judgment rests on the
#   files they saw). One request often asks for several items and a file answers some of
#   them: a policy is not the walkthrough. The keyword rules match a file's kind, not its
#   detail, so a reading by the rules never takes a file off.
# A person can still link a file to an item it does not serve (link_file). The SQL uses q
# (evidence_requirements), a (the file's evidence_analyses row, if any), and the file's id.


def shared_from_sibling(columns: str) -> str:
    """SQL: the files a sibling instance shares with q's instance for the same item (the
    same phase and requirement key): added by a person on that item of the sibling's
    request, and tagged by a person as applying to q's application too (all of them, or
    several including it; migrations 0101, 0102). A policy that governs several systems is
    added once. Selects the given columns over q2 (the sibling's item), sib (its control),
    f (the file), and a (its reading)."""
    return f"""
        SELECT {columns}
        FROM engagement_controls me
        JOIN evidence_requirements q2
          ON q2.project_id = q.project_id AND q2.phase = q.phase
         AND q2.requirement_key = q.requirement_key AND q2.id <> q.id
        JOIN engagement_controls sib
          ON sib.id = q2.engagement_control_id AND sib.project_id = me.project_id
         AND sib.control_ref = me.control_ref AND sib.id <> me.id
         -- Only a sibling in the same units: never another entity's evidence (Release 1).
         AND split_part(sib.implementation_key, ':', 2) = split_part(me.implementation_key, ':', 2)
        JOIN evidence_matches m ON m.requirement_id = q2.id AND m.status = 'FILED'
        JOIN evidence_file_links l ON l.evidence_file_id = m.evidence_file_id
        JOIN evidence_files f ON f.id = m.evidence_file_id
        JOIN evidence_file_applications t
          ON t.evidence_file_id = f.id AND t.tagged_by = 'PERSON'
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE me.id = q.engagement_control_id
          AND {tag_covers("me.engagement_application_id")}
    """


def request_file_serves(file_id_sql: str) -> str:
    """The SQL test of whether the file (by the SQL expression of its id) serves q."""
    return f"""
    coalesce(
        (SELECT m.requirement_id = q.id FROM evidence_matches m
         WHERE m.evidence_file_id = {file_id_sql} AND m.status = 'FILED'
           AND m.requirement_id IS NOT NULL),
        NOT (
            q.sufficiency = 'NOT_REVIEWED'
            AND coalesce(a.source, '') = 'MODEL'
            AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(a.classification -> 'items') = 'array'
                         THEN a.classification -> 'items' ELSE '[]'::jsonb END
                ) AS item
                WHERE item ->> 'requirement_id' = q.id::text
                  AND item ->> 'coverage' = 'NOT_COVERED'
            )
        )
    )
"""


class RequirementBody(BaseModel):
    id: UUID
    phase: Phase
    key: str
    title: str
    description: str
    categories: list[Category]
    category_labels: list[str]
    objective: str
    attributes: list[str]
    risk: str
    rationale: str
    necessity: Necessity
    period_label: str
    population_kind: str | None
    sample_selection: str
    depends_on: str | None
    depends_on_title: str | None
    status: str
    state: RequirementState
    state_label: str
    request_id: UUID | None
    request_status: str | None
    request_reference: str | None
    # Who the request carrying it went to: the control owner or the PBC coordinator.
    request_recipient: str | None
    sufficiency: Sufficiency
    sufficiency_note: str
    sufficiency_by: str | None
    waive_reason: str
    origin: str
    person_edited: bool
    pending_change: dict[str, Any] | None
    needs_review: bool
    coverage_note: str
    version: int
    # The approved attributes it addresses (its links, evidence_requirement_attributes), in
    # the control's order. For an addition the planner proposed and nobody has accepted
    # yet, the approved attributes it names: what it would address once accepted.
    attribute_ids: list[UUID] = Field(default_factory=list)
    # The plan's active procedures it serves (its links), in their order: what a person
    # changing its attributes sends back unchanged (the links route sets both).
    procedure_ids: list[UUID] = Field(default_factory=list)
    # A D&I request a person owns as it stands (B1f, 12 November 2026): who accepted it,
    # by name, and when. The agent's proposals, and the operating phases' items, are not.
    accepted: bool = False
    accepted_by: str | None = None
    accepted_at: datetime | None = None
    # In the D&I requests list and waiting for a person: not accepted yet, or carrying a
    # change the planner proposed (pending_change; `add` true for a proposed addition, which
    # a person accepts or rejects, and nothing else is done to before then).
    to_accept: bool = False
    # Evidence for it is already in hand (B1g, product owner, 12 November 2026): a file
    # serves this item itself (added on it, on its request and not read as missing it,
    # shared by a sibling, or linked by a person) and nothing asked the owner for it: it
    # is not requested, or the request carrying it was never emailed nor handed over.
    # Nothing needs sending for it. False for evidence the owner returned on a request
    # that was emailed or handed over, which is received.
    in_hand: bool = False
    files: list[RequirementFile] = Field(default_factory=list)
    # Files on its request the reader found do not cover it: not its evidence, and named
    # so a person can link one that does.
    passed_over: list[str] = Field(default_factory=list)
    assessment: Assessment = NO_ASSESSMENT


class PhaseRequest(BaseModel):
    id: UUID
    reference: str
    status: str
    requirements: int
    # What the D&I requests list shows of the request and acts on (B1g): who it goes to,
    # when it is due, its version (what an approval is made at), and how it reached its
    # owner: by email, or handed over while email was off; None when neither (pbc.Delivery).
    recipient: str = ""
    due_at: datetime | None = None
    version: int = 0
    delivery: Delivery | None = None


class PhaseBody(BaseModel):
    phase: Phase
    label: str
    applicability: Applicability | None
    rationale: str
    condition: str
    open_question: str
    objectives: list[str]
    procedures: list[str]
    period_start: date | None
    period_end: date | None
    origin: str | None
    decided_by: str | None
    state: PhaseState
    state_label: str
    testing_complete: bool
    requirements: list[RequirementBody]
    requests: list[PhaseRequest]
    version: int


class ChangeBody(BaseModel):
    id: UUID
    effective_on: date
    kind: str
    description: str
    created_at: datetime


class RunBody(BaseModel):
    created_at: datetime
    source: str
    note: str
    changes: dict[str, list[str]]


class ReconcileInfo(BaseModel):
    """A request drafted at kickoff, before the control's evidence was planned, and never
    sent. A person decides what happens to it; nothing replaces it on its own."""

    request_id: UUID
    request_version: int
    # The plan's design and interim items waiting on the decision (0 before planning).
    waiting_items: int


class CoverageException(BaseModel):
    """Why an approved attribute is not evidenced at D&I, as a person recorded it."""

    attribute_id: UUID
    reason: str
    recorded_by: str
    recorded_at: datetime


class DesignRequests(BaseModel):
    """The D&I requests list of a control (B1f, product owner, 12 November 2026): each live
    D&I request is accepted by a person, and every approved attribute is addressed by one
    or has a recorded exception. Once that holds, with the understanding complete, the
    attributes settled and the planner not at work, the list is settled and the D&I
    evidence is released in the request of the person who completed it."""

    settled: bool = False
    released: bool = False
    # How many requests in the list wait for a person.
    to_accept: int = 0
    # Approved attributes no live D&I request addresses and no exception explains.
    uncovered: list[UUID] = Field(default_factory=list)
    exceptions: list[CoverageException] = Field(default_factory=list)
    # What the list waits for, in a sentence; empty once settled.
    waiting_for: str = ""
    # The agents are really at work on what the list rests on, so it may still change: the
    # plan's run, or the approved narrative's, is working under a live lease or was queued
    # within the worker's bound (PLAN_QUEUE_MINUTES). A run that stopped is not working: the
    # list then says so in waiting_for, with what a person does.
    working: bool = False
    # Released, and the client request of a live D&I request is being written by the
    # evidence coordinator: its draft is in progress under a live lease, or was queued
    # within the bound (DRAFT_QUEUE_MINUTES). Not a draft nobody has picked up for longer.
    drafting: bool = False
    # Every decision on the list is made and a person's acceptance of it is what releases
    # it: nobody who may accept stands behind it (its last decider no longer may, or it was
    # accepted before decisions were kept). Accepting the list again releases it.
    to_confirm: bool = False


class EvidencePlanBody(BaseModel):
    control_id: UUID
    plan_id: UUID | None
    reconcile: ReconcileInfo | None = None
    status: Literal["NOT_PLANNED", "PROPOSED", "APPROVED", "CHANGES_PROPOSED", "CHANGES_REQUESTED"]
    source: str | None
    provisional: bool
    note: str
    understanding: dict[str, Any]
    generated_at: datetime | None
    approved_by: str | None
    approved_at: datetime | None
    # A plan approved with no approver, from before plans waited for a person.
    approved_automatically: bool = False
    # The master test plan's content revision, and the one a person last approved
    # (migration 0079). The planner's revised understanding and procedures for an approved
    # plan wait for the reviewer (`pending_revision`).
    revision: int = 0
    approved_revision: int | None = None
    pending_revision: bool = False
    # What in the plan needs a person's judgment. Empty when nothing does.
    attention: list[str] = []
    pending_changes: int
    needs_review: int
    phases: list[PhaseBody]
    changes: list[ChangeBody]
    runs: list[RunBody]
    categories: dict[str, str]
    version: int
    # The D&I requests list (B1f): what it waits for, and whether it is released.
    design_requests: DesignRequests = Field(default_factory=DesignRequests)
    # Whether a message can be sent now (outbound.email_on). False: approving a request
    # records a hand-over and sends nothing (B1g). Set by the routes that answer with the
    # plan; a body built elsewhere leaves it False.
    live_email: bool = False
    # The planner's last answer could not be used and the plan was kept as it was (B1h):
    # the sentence and why, while that run is the plan's latest. Empty otherwise.
    kept_note: str = ""
    # One plain sentence for the person when the planner's last answer could not be used
    # (B1i): what failed and what was kept (the latest run's note: the plan kept as it was,
    # or the rules' plan written in its place) and what to do next; "" when the plan's
    # latest run used the planner's answer, or no run happened.
    failure_note: str = ""
    # A control change was recorded that the plan has not been generated for since: when,
    # and the sentence the plan shows. Operating evidence, samples and testing wait for the
    # evidence to be planned again (GATE_CHANGE).
    change_unplanned_at: datetime | None = None
    change_wait: str = ""


def requirement_state(
    status: str,
    request_status: str | None,
    draft_status: str | None,
    sufficiency: str,
    has_evidence: bool = False,
    linked: bool = False,
) -> RequirementState:
    """Where one requirement stands. Receipt and sufficiency are separate: a file arriving
    makes it received, and only a person makes it accepted.

    A file filed to the request, or attached to a reply matched to it, counts as arrived
    even before a person marks the request received (6.5: a reply never moves a request)."""
    if status == "WAIVED":
        return "NOT_APPLICABLE"
    if status == "REMOVED":
        return "REMOVED"
    if status == "AWAITING_DEPENDENCY":
        return "AWAITING_DEPENDENCY"
    if status == "PLANNED" or request_status is None:
        # Not requested, but a file the control already holds was linked to it (a design
        # file for an interim item, say): it has arrived, and a person judges it.
        if linked:
            judged = ("ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED", "UNDER_REVIEW")
            return sufficiency if sufficiency in judged else "RECEIVED"  # type: ignore[return-value]
        return "NOT_GENERATED"
    if request_status == "CANCELLED":
        return "CANCELLED"
    if request_status == "DRAFT" and not has_evidence:
        return "DRAFT" if draft_status in ("PENDING", "DRAFTING") else "READY_FOR_REVIEW"
    if request_status == "APPROVAL_PENDING" and not has_evidence:
        return "APPROVAL_PENDING"
    arrived = request_status in _RECEIVED or has_evidence
    if arrived and sufficiency in (
        "ACCEPTED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED", "UNDER_REVIEW"
    ):  # fmt: skip
        return sufficiency  # type: ignore[return-value]
    if request_status in ("RECEIVED", "CLOSED"):
        return "RECEIVED"
    if has_evidence:
        return "PARTIALLY_RECEIVED"
    # Partly received means some of the request's items are in, not this one: a file that
    # serves it would have made it received above (22 Oct 2026; every item of a partly
    # received request read as partly received before).
    if request_status == "PARTIALLY_RECEIVED":
        return "SENT"
    if request_status in ("OVERDUE", "ESCALATED"):
        return "OVERDUE"
    return "SENT"


# Asked of the owner and not all in, or in and judged short.
_OUTSTANDING = {
    "SENT", "OVERDUE", "PARTIALLY_RECEIVED", "INSUFFICIENT", "FOLLOW_UP_REQUIRED", "CANCELLED",
}  # fmt: skip
# Drafted or awaiting approval: nothing has gone to the owner yet.
_NOT_SENT = {"DRAFT", "READY_FOR_REVIEW", "APPROVAL_PENDING"}


def phase_state(
    planned: bool,
    applicability: str | None,
    testing_complete: bool,
    requirements: list[tuple[str, str]],
) -> PhaseState:
    """Where a phase stands, from its applicability, its testing, and its required items.
    An empty list of requests never reads as done: a phase is complete only when its
    testing is."""
    if not planned or applicability is None:
        return "NOT_PLANNED"
    if applicability == "NOT_APPLICABLE":
        return "NOT_APPLICABLE"
    if applicability == "PENDING":
        return "AWAITING_CLARIFICATION"
    if testing_complete:
        return "COMPLETE"
    live = [(state, necessity) for state, necessity in requirements
            if state not in ("NOT_APPLICABLE", "REMOVED")]  # fmt: skip
    if applicability == "CONDITIONAL":
        return "CONDITIONAL"
    required = [state for state, necessity in live if necessity == "REQUIRED"]
    if not live or "NOT_GENERATED" in required:
        return "NOT_GENERATED"
    if _OUTSTANDING & set(required):
        return "OUTSTANDING"
    # A request that is only drafted, or waits for approval, has not asked the owner for
    # anything: the phase is not outstanding with them yet.
    if _NOT_SENT & set(required):
        return "NOT_SENT"
    if {"RECEIVED", "UNDER_REVIEW"} & set(required):
        return "RECEIVED_NOT_VALIDATED"
    if "AWAITING_DEPENDENCY" in required:
        return "AWAITING_DEPENDENCY"
    return "EVIDENCE_ACCEPTED"


def plan_body(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> EvidencePlanBody:
    plan = connection.execute(
        """
        SELECT p.id, p.status, p.source, p.provisional, p.note, p.understanding,
               p.generated_at, u.display_name, p.approved_at, p.version,
               p.approved_by IS NULL AND p.status IN ('APPROVED', 'CHANGES_PROPOSED'),
               p.revision, p.approved_revision, p.pending_revision IS NOT NULL
        FROM evidence_plans p LEFT JOIN users u ON u.id = p.approved_by
        WHERE p.project_id = %s AND p.engagement_control_id = %s
        """,
        (project_id, control_id),
    ).fetchone()
    complete_by_phase = _testing_complete(connection, project_id, control_id)
    changes = [
        ChangeBody(
            id=r[0], effective_on=r[1], kind=str(r[2]), description=str(r[3]), created_at=r[4]
        )
        for r in connection.execute(
            "SELECT id, effective_on, kind, description, created_at FROM control_changes "
            "WHERE engagement_control_id = %s ORDER BY effective_on, created_at",
            (control_id,),
        ).fetchall()
    ]
    reconcile = reconcile_info(connection, project_id, control_id)
    unplanned = change_unplanned(connection, control_id)
    if plan is None:
        return EvidencePlanBody(
            control_id=control_id, plan_id=None, reconcile=reconcile, status="NOT_PLANNED",
            source=None,
            provisional=False, note="", understanding={}, generated_at=None, approved_by=None,
            approved_at=None, pending_changes=0, needs_review=0,
            phases=[_empty_phase(phase, complete_by_phase[phase]) for phase in PHASES],
            changes=changes, runs=[], categories=dict(CATEGORY_LABELS), version=0,
        )  # fmt: skip
    plan_id = UUID(str(plan[0]))
    requirements = _requirements(connection, plan_id)
    requests = _phase_requests(connection, project_id, control_id)
    # The procedures are the master test plan's (migration 0079), in their order.
    procedures: dict[str, list[str]] = {}
    for phase_key, text in connection.execute(
        "SELECT phase, text FROM plan_procedures WHERE plan_id = %s AND status = 'ACTIVE' "
        "ORDER BY position, created_at",
        (plan_id,),
    ).fetchall():
        procedures.setdefault(str(phase_key), []).append(str(text))
    approved_now = str(plan[1]) in _APPROVED_PLAN
    phases: list[PhaseBody] = []
    for row in connection.execute(
        """
        SELECT ph.phase, ph.applicability, ph.rationale, ph.condition, ph.open_question,
               ph.objectives, ph.procedures, ph.period_start, ph.period_end, ph.origin,
               u.display_name, ph.version
        FROM evidence_plan_phases ph LEFT JOIN users u ON u.id = ph.decided_by
        WHERE ph.plan_id = %s
        """,
        (plan_id,),
    ).fetchall():
        phase = str(row[0])
        mine = [item for item in requirements if item.phase == phase]
        complete = complete_by_phase[phase]
        state = phase_state(True, str(row[1]), complete, [(i.state, i.necessity) for i in mine])
        phases.append(
            PhaseBody(
                phase=phase,  # type: ignore[arg-type]
                label=PHASE_LABELS[phase],
                applicability=row[1],
                rationale=str(row[2]),
                condition=str(row[3]),
                open_question=str(row[4]),
                objectives=[str(item) for item in row[5]],
                procedures=procedures.get(phase, []),
                period_start=row[7],
                period_end=row[8],
                origin=str(row[9]),
                decided_by=None if row[10] is None else str(row[10]),
                state=state,
                state_label=_PHASE_STATE_LABELS[state],
                testing_complete=complete,
                requirements=mine,
                requests=requests.get(phase, []),
                version=int(row[11]),
            )
        )
    phases.sort(key=lambda item: PHASES.index(item.phase))
    runs = [
        RunBody(created_at=r[0], source=str(r[1]), note=str(r[2]), changes=dict(r[3]))
        for r in connection.execute(
            "SELECT created_at, source, note, changes FROM evidence_plan_runs "
            "WHERE plan_id = %s ORDER BY created_at DESC LIMIT 10",
            (plan_id,),
        ).fetchall()
    ]
    return EvidencePlanBody(
        control_id=control_id,
        plan_id=plan_id,
        reconcile=reconcile,
        status=str(plan[1]),  # type: ignore[arg-type]
        source=str(plan[2]),
        provisional=bool(plan[3]),
        note=str(plan[4]),
        understanding=dict(plan[5]),
        generated_at=plan[6],
        approved_by=None if plan[7] is None or not approved_now else str(plan[7]),
        approved_at=plan[8] if approved_now else None,
        approved_automatically=bool(plan[10]),
        revision=int(plan[11]),
        approved_revision=plan[12],
        pending_revision=bool(plan[13]),
        attention=attention_of(connection, plan_id),
        pending_changes=sum(1 for item in requirements if item.pending_change is not None),
        needs_review=sum(1 for item in requirements if item.needs_review),
        phases=phases,
        changes=changes,
        runs=runs,
        categories=dict(CATEGORY_LABELS),
        version=int(plan[9]),
        design_requests=design_requests(connection, project_id, control_id, requirements),
        kept_note=runs[0].note if runs and runs[0].note.startswith(KEPT_NOTE) else "",
        failure_note=plan_run_failure_note(connection, control_id),
        change_unplanned_at=unplanned,
        change_wait=change_wait(unplanned),
    )


def design_requests(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirements: list[RequirementBody],
) -> DesignRequests:
    """The D&I requests list's summary for the plan's body: one rule with the phase status
    and the release (phase_release.design_wait), so the list never disagrees with them."""
    from ai_workforce_api.phase_release import design_state, uncovered_attributes

    released = connection.execute(
        "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s AND phase = 'DESIGN'",
        (control_id,),
    ).fetchone()
    exceptions = [
        CoverageException(
            attribute_id=row[0],
            reason=str(row[1]),
            recorded_by=str(row[2] or ""),
            recorded_at=row[3],
        )  # fmt: skip
        for row in connection.execute(
            """
            SELECT x.attribute_id, x.reason, u.display_name, x.recorded_at
            FROM design_coverage_exceptions x
            JOIN control_attributes a ON a.id = x.attribute_id
            LEFT JOIN users u ON u.id = x.recorded_by
            WHERE x.engagement_control_id = %s AND a.status = 'APPROVED'
            ORDER BY a.position, a.created_at
            """,
            (control_id,),
        ).fetchall()
    ]
    wait, confirmable = design_state(connection, project_id, control_id)
    state = connection.execute(
        f"""
        SELECT coalesce((SELECT {PLAN_RUN_LIVE_SQL} FROM evidence_plans p
                         WHERE p.engagement_control_id = c.id), false)
               OR EXISTS (SELECT 1 FROM process_narrative_runs r
                          WHERE r.engagement_control_id = c.id
                            AND ((r.run_status = 'WORKING'
                                  AND (r.run_lease_until IS NULL
                                       OR r.run_lease_until >= clock_timestamp()))
                                 OR (r.run_status = 'PENDING'
                                     AND r.updated_at >= clock_timestamp()
                                         - interval '{PLAN_QUEUE_MINUTES} minutes'))),
               EXISTS (SELECT 1 FROM evidence_requirements q
                       JOIN pbc_drafts d ON d.pbc_request_id = q.pbc_request_id
                       WHERE q.engagement_control_id = c.id AND q.phase = 'DESIGN'
                         AND q.status = 'REQUESTED'
                         AND ((d.status = 'DRAFTING' AND d.lease_until >= clock_timestamp())
                              OR (d.status IN ('PENDING', 'DRAFTING')
                                  AND d.updated_at >= clock_timestamp()
                                      - interval '{DRAFT_QUEUE_MINUTES} minutes')))
        FROM engagement_controls c WHERE c.id = %s
        """,
        (control_id,),
    ).fetchone()
    return DesignRequests(
        settled=wait is None,
        released=released is not None,
        to_accept=sum(1 for item in requirements if item.to_accept),
        uncovered=uncovered_attributes(connection, project_id, control_id).get(control_id, []),
        exceptions=exceptions,
        waiting_for="" if wait is None else wait[1],
        working=state is not None and bool(state[0]),
        drafting=released is not None and state is not None and bool(state[1]),
        to_confirm=released is None and confirmable,
    )


def _empty_phase(phase: Phase, complete: bool) -> PhaseBody:
    return PhaseBody(
        phase=phase, label=PHASE_LABELS[phase], applicability=None,
        rationale="The evidence for this phase has not been planned yet.", condition="",
        open_question="", objectives=[], procedures=[], period_start=None, period_end=None,
        origin=None, decided_by=None, state="NOT_PLANNED",
        state_label=_PHASE_STATE_LABELS["NOT_PLANNED"], testing_complete=complete,
        requirements=[], requests=[], version=0,
    )  # fmt: skip


def _testing_complete(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> dict[str, bool]:
    """A phase is complete when its testing is, never because of its requests."""
    row = connection.execute(
        """
        SELECT
            EXISTS (SELECT 1 FROM workpapers w WHERE w.project_id = %s
                    AND w.engagement_control_id = %s AND w.stage = 'DESIGN'
                    AND w.status = 'PREPARED'),
            EXISTS (SELECT 1 FROM test_sheets s WHERE s.project_id = %s
                    AND s.engagement_control_id = %s AND s.test_round_id IS NULL
                    AND s.status = 'SIGNED_OFF'),
            (SELECT r.status = 'SIGNED_OFF' FROM test_rounds r WHERE r.project_id = %s
             AND r.engagement_control_id = %s AND r.kind = 'ROLLFORWARD'
             AND r.status <> 'CANCELLED' ORDER BY r.number DESC LIMIT 1)
        """,
        (project_id, control_id) * 3,
    ).fetchone()
    assert row is not None
    return {"DESIGN": bool(row[0]), "INTERIM": bool(row[1]), "ROLLFORWARD": bool(row[2])}


def _requirements(connection: psycopg.Connection[Any], plan_id: UUID) -> list[RequirementBody]:
    rows = connection.execute(
        """
        SELECT q.id, q.phase, q.requirement_key, q.title, q.description, q.categories,
               q.objective, q.attributes, q.risk, q.rationale, q.necessity, q.period_label,
               q.population_kind, q.sample_selection, q.depends_on, q.status,
               q.pbc_request_id, r.status, r.operation_key, d.status, q.sufficiency,
               q.sufficiency_note, u.display_name, q.waive_reason, q.origin, q.person_edited,
               q.pending_change, q.needs_review, q.coverage_note, q.version, r.recipient,
               EXISTS (SELECT 1 FROM evidence_file_links l
                       LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
                       WHERE l.pbc_request_id = q.pbc_request_id
                         AND {SERVES})
               OR EXISTS ({SHARED}),
               EXISTS (SELECT 1 FROM evidence_requirement_files ef
                       JOIN evidence_file_links l
                         ON l.evidence_file_id = ef.evidence_file_id
                        AND l.engagement_control_id = ef.engagement_control_id
                       WHERE ef.requirement_id = q.id AND ef.status = 'LINKED'),
               (SELECT coalesce(array_agg(ra.attribute_id ORDER BY a.position, a.created_at),
                                '{}'::uuid[])
                FROM evidence_requirement_attributes ra
                JOIN control_attributes a ON a.id = ra.attribute_id
                WHERE ra.requirement_id = q.id AND a.status = 'APPROVED'),
               ua.display_name, q.accepted_at, q.engagement_control_id,
               (SELECT coalesce(array_agg(rp.procedure_id ORDER BY pp.position, pp.created_at),
                                '{}'::uuid[])
                FROM evidence_requirement_procedures rp
                JOIN plan_procedures pp ON pp.id = rp.procedure_id
                WHERE rp.requirement_id = q.id AND pp.status = 'ACTIVE'),
               r.outbound_message_id IS NOT NULL OR r.handed_over_at IS NOT NULL
        FROM evidence_requirements q
        LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id
        LEFT JOIN pbc_drafts d ON d.pbc_request_id = q.pbc_request_id
        LEFT JOIN users u ON u.id = q.sufficiency_by
        LEFT JOIN users ua ON ua.id = q.accepted_by
        WHERE q.plan_id = %s
        ORDER BY q.phase, CASE q.necessity WHEN 'REQUIRED' THEN 0 WHEN 'CONDITIONAL' THEN 1
                 ELSE 2 END, q.created_at, q.requirement_key
        """.replace("{SERVES}", request_file_serves("l.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        (plan_id,),
    ).fetchall()
    titles = {(str(r[1]), str(r[2])): str(r[3]) for r in rows}
    files, passed_over = requirement_files(connection, plan_id)
    # An addition only proposed has no links yet (they follow its acceptance): it shows the
    # approved attributes it names, matched by wording as _sync_named_links will.
    proposed = [r for r in rows if isinstance(r[26], dict) and r[26].get("add") is True]
    approved: list[tuple[UUID, str]] = []
    if proposed:
        approved = [
            (UUID(str(attribute_id)), " ".join(str(text).split()).lower())
            for attribute_id, text in connection.execute(
                "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' ORDER BY position, created_at",
                (proposed[0][36],),
            ).fetchall()
        ]
    found: list[RequirementBody] = []
    for r in rows:
        addition = isinstance(r[26], dict) and r[26].get("add") is True
        attribute_ids = [UUID(str(item)) for item in r[33]]
        if addition and not attribute_ids:
            named = {" ".join(str(a).split()).lower() for a in r[7]}
            attribute_ids = [found_id for found_id, wording in approved if wording in named]
        # In the D&I list: planned, waiting for its dependency, or requested (a proposed
        # addition included; a waived or removed one is not in the list).
        listed = str(r[1]) == "DESIGN" and str(r[15]) in LISTED_STATUSES
        accepted = listed and r[35] is not None and not addition
        # What the planner proposes for it, always saying whether it is a proposed
        # addition (`add`): the request is then not part of the plan until a person accepts.
        pending = {**r[26], "add": addition} if isinstance(r[26], dict) else None
        state = requirement_state(
            str(r[15]), r[17], r[19], str(r[20]), bool(r[31]) or bool(r[32]), bool(r[32])
        )
        mine = files.get(UUID(str(r[0])), [])
        # The planner's order: the first category is the primary one.
        categories = [c for c in r[5] if c in CATEGORIES]
        found.append(
            RequirementBody(
                id=r[0], phase=str(r[1]), key=str(r[2]), title=str(r[3]),  # type: ignore[arg-type]
                description=str(r[4]), categories=categories,
                category_labels=[CATEGORY_LABELS[c] for c in categories],
                objective=str(r[6]), attributes=[str(a) for a in r[7]], risk=str(r[8]),
                rationale=str(r[9]), necessity=str(r[10]),  # type: ignore[arg-type]
                period_label=str(r[11]), population_kind=r[12], sample_selection=str(r[13]),
                depends_on=r[14],
                depends_on_title=None if r[14] is None else titles.get((str(r[1]), str(r[14]))),
                status=str(r[15]), state=state,
                state_label=_REQUIREMENT_LABELS[state], request_id=r[16], request_status=r[17],
                request_reference=None if r[16] is None else reference(r[16]),
                sufficiency=str(r[20]),  # type: ignore[arg-type]
                sufficiency_note=str(r[21]), sufficiency_by=r[22], waive_reason=str(r[23]),
                origin=str(r[24]), person_edited=bool(r[25]), pending_change=pending,
                needs_review=bool(r[27]), coverage_note=str(r[28]), version=int(r[29]),
                request_recipient=r[30], files=mine, assessment=assess(mine),
                passed_over=passed_over.get(UUID(str(r[0])), []),
                attribute_ids=attribute_ids,
                procedure_ids=[UUID(str(item)) for item in r[37]], accepted=accepted,
                accepted_by=None if not accepted or r[34] is None else str(r[34]),
                accepted_at=r[35] if accepted else None,
                to_accept=listed and (not accepted or r[26] is not None),
                # Its own evidence is on file and the owner was not asked for it.
                in_hand=str(r[15]) in ("PLANNED", "REQUESTED")
                and (bool(r[31]) or bool(r[32]))
                and not bool(r[38]),
            )
        )  # fmt: skip
    return found


def requirement_files(
    connection: psycopg.Connection[Any], plan_id: UUID
) -> tuple[dict[UUID, list[RequirementFile]], dict[UUID, list[str]]]:
    """Each requirement's files: those on its request that serve it
    (request_file_serves), then those a person linked to it; and, apart, the names of
    the files on its request the reader found do not cover it. A withdrawn file serves
    none: both come through evidence_file_links."""
    rows = connection.execute(
        """
        SELECT q.id, f.id, f.file_name, 'REQUEST', NULL::uuid, NULL, '', NULL::int,
               a.status, coalesce(a.confirmed_kind, a.classification ->> 'kind'),
               a.confirmed_kind IS NOT NULL, a.classification, f.created_at, a.source,
               {SERVES},
               EXISTS (SELECT 1 FROM evidence_matches m
                       WHERE m.evidence_file_id = f.id AND m.status = 'FILED'
                         AND m.requirement_id IS NOT NULL),
               NULL::uuid
        FROM evidence_requirements q
        JOIN evidence_file_links l ON l.pbc_request_id = q.pbc_request_id
        JOIN evidence_files f ON f.id = l.evidence_file_id
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE q.plan_id = %s
        UNION ALL
        SELECT ef.requirement_id, f.id, f.file_name, 'LINK', ef.id, u.display_name, ef.reason,
               ef.version, a.status, coalesce(a.confirmed_kind, a.classification ->> 'kind'),
               a.confirmed_kind IS NOT NULL, a.classification, f.created_at, a.source, true,
               false, NULL::uuid
        FROM evidence_requirement_files ef
        JOIN evidence_requirements q ON q.id = ef.requirement_id
        JOIN evidence_file_links l
          ON l.evidence_file_id = ef.evidence_file_id
         AND l.engagement_control_id = ef.engagement_control_id
        JOIN evidence_files f ON f.id = ef.evidence_file_id
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        LEFT JOIN users u ON u.id = ef.linked_by
        WHERE q.plan_id = %s AND ef.status = 'LINKED'
        UNION ALL
        SELECT q.id, shared.* FROM evidence_requirements q
        CROSS JOIN LATERAL ({SHARED}) AS shared
        WHERE q.plan_id = %s
        ORDER BY 13, 3
        """.replace("{SERVES}", request_file_serves("f.id")).replace(
            "{SHARED}",
            shared_from_sibling(
                "f.id, f.file_name, 'SHARED', NULL::uuid, "
                "(SELECT x.name FROM engagement_applications x "
                " WHERE x.id = sib.engagement_application_id), '', NULL::int, "
                "a.status, coalesce(a.confirmed_kind, a.classification ->> 'kind'), "
                "a.confirmed_kind IS NOT NULL, a.classification, f.created_at, a.source, "
                "true, false, q2.id"
            ),
        ),
        (plan_id, plan_id, plan_id),
    ).fetchall()
    found: dict[UUID, list[RequirementFile]] = {}
    passed: dict[UUID, list[str]] = {}
    for row in rows:
        requirement_id = UUID(str(row[0]))
        if not row[14]:
            # Added for another item of the request: not this one's, and nothing to say.
            if not row[15]:
                passed.setdefault(requirement_id, []).append(str(row[2]))
            continue
        mine = found.setdefault(requirement_id, [])
        # A shared file was read against the sibling's item: the same item, so what the
        # reader found there stands here.
        shared = row[3] == "SHARED"
        coverage, note, period, gaps = _coverage(
            row[11], UUID(str(row[16])) if shared else requirement_id
        )
        read = row[3] in ("REQUEST", "SHARED")
        entry = RequirementFile(
            file_id=row[1], name=str(row[2]), via=row[3], link_id=row[4],
            linked_by=None if shared else row[5], reason=str(row[6] or ""),
            link_version=row[7], read_status=row[8], kind=row[9],
            kind_confirmed=bool(row[10]),
            read_by=row[13] if row[13] in ("MODEL", "RULES", "SEEDED") else None,
            coverage=coverage if read else None, note=note if read else "",
            period=period, gaps=gaps, shared_from=str(row[5]) if shared else None,
        )  # fmt: skip
        held = next((i for i, item in enumerate(mine) if item.file_id == row[1]), None)
        if held is None:
            mine.append(entry)
        elif entry.via == "LINK" and mine[held].via == "REQUEST":
            # Linked by a person and on its request: the link is kept, so it can be removed.
            mine[held] = entry
    for requirement_id, names in passed.items():
        served = {item.name for item in found.get(requirement_id, [])}
        passed[requirement_id] = [name for name in dict.fromkeys(names) if name not in served]
    return found, passed


def _coverage(
    classification: Any, requirement_id: UUID
) -> tuple[Coverage | None, str, str, list[str]]:
    """What the reader found for one requirement in one file: its coverage and note, the
    period the file shows, and what it says to follow up."""
    if not isinstance(classification, dict):
        return None, "", "", []
    period = str(classification.get("period") or "")
    gaps = [str(gap) for gap in classification.get("gaps") or [] if str(gap).strip()][:6]
    for item in classification.get("items") or []:
        if not isinstance(item, dict) or item.get("requirement_id") != str(requirement_id):
            continue
        coverage = item.get("coverage")
        if coverage in ("COVERED", "PARTIAL", "NOT_COVERED"):
            return coverage, str(item.get("note") or ""), period, gaps
    return None, "", period, gaps


def assess(files: list[RequirementFile]) -> Assessment:
    """The reader's proposal for a requirement, from the files that serve it. It never
    decides: a person accepts, or asks for more."""
    if not files:
        return NO_ASSESSMENT
    # The keyword rules only match a file's kind, and its columns to the fields asked for:
    # a full match proposes, but a kind that matches or not says nothing about the detail.
    files = [
        f.model_copy(update={"coverage": None})
        if f.read_by == "RULES" and f.coverage in ("PARTIAL", "NOT_COVERED")
        else f
        for f in files
    ]
    covered = [f for f in files if f.coverage == "COVERED"]
    if covered:
        first = covered[0]
        return Assessment(
            proposal="SUFFICIENT",
            reason=f"{first.name} covers it" + (f": {first.note}" if first.note else "."),
        )
    reading = [f for f in files if f.read_status in ("PENDING", "WORKING")]
    if reading:
        return Assessment(
            proposal="NONE",
            reason=f"The evidence reader is still reading {len(reading)} file"
            + ("" if len(reading) == 1 else "s")
            + ".",
        )
    partial = [f for f in files if f.coverage == "PARTIAL"]
    if partial:
        # What it found is the reason; the follow-ups are only what to ask (22 Oct 2026:
        # each file's note led the follow-ups before).
        first = partial[0]
        follow = [gap for f in partial for gap in f.gaps]
        return Assessment(
            proposal="FOLLOW_UP",
            reason=f"{first.name} covers it in part" + (f": {first.note}" if first.note else "."),
            follow_ups=list(dict.fromkeys(follow))[:6],
        )
    assessed = [f for f in files if f.coverage is not None]
    if assessed and len(assessed) == len([f for f in files if f.via == "REQUEST"]):
        return Assessment(
            proposal="INSUFFICIENT",
            reason=(
                "None of the files on its request covers it."
                if len(assessed) > 1
                else f"{assessed[0].name} does not cover it."
            ),
        )
    unread = [f for f in files if f.read_status == "FAILED"]
    if unread:
        return Assessment(
            proposal="NONE",
            reason=f"{unread[0].name} could not be read. A person reviews it.",
        )
    if any(f.read_by == "RULES" for f in files):
        return Assessment(
            proposal="NONE",
            reason="Read by the rules, without a model: they match a file's kind, not its "
            "detail. A person judges it.",
        )
    return Assessment(
        proposal="NONE",
        reason="The reader has not assessed these files against this requirement. A person "
        "judges it.",
    )


def _phase_requests(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> dict[str, list[PhaseRequest]]:
    rows = connection.execute(
        """
        SELECT r.id, r.status, r.testing_phase,
               (SELECT count(*) FROM evidence_requirements q WHERE q.pbc_request_id = r.id),
               r.recipient, r.due_at, r.version, r.outbound_message_id,
               (SELECT o.created_at FROM outbound_messages o
                WHERE o.project_id = r.project_id
                  AND o.provider_message_id = r.outbound_message_id
                ORDER BY o.created_at LIMIT 1),
               (SELECT u.display_name FROM outbound_messages o
                JOIN users u ON u.id = o.actor_user_id
                WHERE o.project_id = r.project_id
                  AND o.provider_message_id = r.outbound_message_id
                ORDER BY o.created_at LIMIT 1),
               r.handed_over_at,
               (SELECT u.display_name FROM users u WHERE u.id = r.handed_over_by)
        FROM pbc_requests r
        WHERE r.project_id = %s AND r.engagement_control_id = %s
          AND r.testing_phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD')
        ORDER BY r.created_at
        """,
        (project_id, control_id),
    ).fetchall()
    found: dict[str, list[PhaseRequest]] = {}
    for row in rows:
        found.setdefault(str(row[2]), []).append(
            PhaseRequest(
                id=row[0],
                reference=reference(row[0]),
                status=str(row[1]),
                requirements=int(row[3]),
                recipient=str(row[4] or ""),
                due_at=row[5],
                version=int(row[6]),
                # One rule with the request's own body (pbc.delivery_of).
                delivery=delivery_of(row[7], row[8], row[9], row[10], row[11]),
            )
        )
    return found


# People's decisions


class PhaseDecision(BaseModel):
    applicability: Applicability
    rationale: str = Field(min_length=10, max_length=1500)
    condition: str = Field(default="", max_length=500)
    open_question: str = Field(default="", max_length=500)
    version: int = Field(ge=1)


class SufficiencyBody(BaseModel):
    sufficiency: Sufficiency
    note: str = Field(default="", max_length=1000)
    version: int = Field(ge=1)


class WaiveBody(BaseModel):
    reason: str = Field(min_length=10, max_length=1000)
    version: int = Field(ge=1)


class VersionBody(BaseModel):
    version: int = Field(ge=1)


class EditBody(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=3000)
    version: int = Field(ge=1)


class ChangeDecision(BaseModel):
    decision: Literal["ACCEPT", "DISMISS"]
    version: int = Field(ge=1)


class RequirementAdd(BaseModel):
    phase: Phase
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=1500)
    categories: list[Category] = Field(min_length=1, max_length=3)
    objective: str = Field(min_length=3, max_length=500)
    rationale: str = Field(min_length=10, max_length=1000)
    necessity: Necessity = "REQUIRED"
    # The control's approved attributes it addresses, linked as the person's in the same
    # act (B1f): a request for an attribute nothing covers is added in one step.
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ControlChangeBody(BaseModel):
    effective_on: date
    kind: ChangeKind
    description: str = Field(min_length=3, max_length=1000)


def generate(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
) -> tuple[Changes, list[UUID], str]:
    """Plan (or plan again) one control. A proposed plan is not approved and nothing is
    requested from it; an approved plan still releases what the gate allows. Returns what
    changed, the drafts to schedule, and a note for the team."""
    facts = load_facts(connection, project_id, control_id)
    planned = plan_for(
        connection, provider, facts, requester, organization_id, project_id, control_id
    )
    kept = ""
    with transaction(connection) as cursor:
        if planned.source == "FALLBACK":
            kept = _keep_standing_plan(
                cursor, organization_id, project_id, control_id, planned, requester
            )
        if not kept:
            changes = persist(
                cursor, organization_id, project_id, control_id, planned, facts, requester,
                settle=False,
            )  # fmt: skip
            issued = issue(
                cursor, organization_id, project_id, control_id, requester, "evidence_plan"
            )
            drafts = queue_drafts(
                cursor, organization_id, project_id, requester, control_id, issued.drafts
            )
    _planner_outcome(connection, planned, bool(kept))
    if kept:
        return Changes([], [], [], [], []), [], kept
    return changes, drafts, planned.note


def _planner_outcome(connection: psycopg.Connection[Any], planned: Planned, kept: bool) -> None:
    """What the system made of the planner's last answer, on its call's record (agent_answers):
    used, with the facts left out for a quote the records do not hold; or not used, with the
    person's sentence of what failed, what was kept and what to do."""
    if planned.source == "MODEL":
        note_used(connection, planned.call, {"dropped": list(planned.dropped)})
        return
    if planned.source != "FALLBACK":
        return
    note_unusable(
        connection,
        planned.call,
        planned.problem,
        f"The planner could not finish: {plain_problem(planned.problem)}.",
        "The plan was kept as it was; no criteria were tailored and no evidence changed."
        if kept
        else "The reviewed rules planned the evidence instead; no criteria were tailored.",
        "Run again. Or write the attributes' criteria on the Attributes step yourself.",
    )


# A failed or rejected planner run never makes a control's plan worse (product owner, 12
# November 2026, B1h: on ITGC-AC-01 the rules' fallback was written over the planner agent's
# plan, removed its interim and roll-forward evidence and proposed removing two accepted,
# already requested D&I requests).
KEPT_NOTE = "The planner's answer could not be used, so the plan was kept as it was."

# The plan stands: the planner agent (or the demo's seed) made it, or a person stands behind
# something in it (the plan approved, a request accepted or waived, criteria accepted), or
# something of it is already out (a request requested, a phase released). SQL over
# evidence_plans `p`.
_PLAN_STANDS_SQL = """
    (p.source IN ('MODEL', 'SEEDED')
     OR p.approved_by IS NOT NULL
     OR EXISTS (SELECT 1 FROM evidence_requirements q
                WHERE q.plan_id = p.id
                  AND (q.accepted_by IS NOT NULL OR q.status IN ('REQUESTED', 'WAIVED')))
     OR EXISTS (SELECT 1 FROM phase_releases r
                WHERE r.engagement_control_id = p.engagement_control_id)
     OR EXISTS (SELECT 1 FROM control_attributes a
                WHERE a.engagement_control_id = p.engagement_control_id
                  AND a.status = 'APPROVED' AND a.criteria_accepted_at IS NOT NULL))
"""


PLAN_AGAIN = (
    "Plan the evidence again. Or write the attributes' criteria and edit the plan yourself."
)


def plan_failure_note(source: str, note: str) -> str:
    """The person's sentence for a plan run whose planner answer could not be used: a
    FALLBACK run's own note (kept, or the rules planned instead) and what to do next."""
    if source != "FALLBACK" or not note.strip():
        return ""
    kept = (
        "The plan was kept as it was."
        if note.startswith(KEPT_NOTE)
        else "The reviewed rules planned the evidence instead."
    )
    return f"The planner could not finish: {plain_problem(note)}. {kept} {PLAN_AGAIN}"


def latest_plan_failure_note(connection: psycopg.Connection[Any], control_id: UUID) -> str:
    """plan_failure_note for the control's latest plan run, read whether or not a rerun
    would do anything (the Attributes step said nothing when it would not, 13 November
    2026)."""
    row = connection.execute(
        "SELECT r.source, r.note FROM evidence_plan_runs r "
        "JOIN evidence_plans p ON p.id = r.plan_id WHERE p.engagement_control_id = %s "
        "ORDER BY r.created_at DESC, r.id DESC LIMIT 1",
        (control_id,),
    ).fetchone()
    return "" if row is None else plan_failure_note(str(row[0]), str(row[1] or ""))


class PendingCriteriaBody(BaseModel):
    """An approved attribute whose criteria the plan's pending revision proposes."""

    attribute_id: UUID
    code: str


def pending_criteria(
    connection: psycopg.Connection[Any], control_id: UUID
) -> tuple[bool, list[PendingCriteriaBody]]:
    """Whether the control's plan has a revision waiting for a person (a plan a person
    approved gets the planner's changes proposed, never applied: persist), and the approved
    attributes whose criteria that revision proposes: those the planner may write
    (CRITERIA_WRITABLE_SQL), matched by wording as _criteria_differ matches them, where the
    proposed criteria differ from the attribute's own. In the attributes' order. On
    ITGC-AC-01 (13 November 2026) the criteria for A1, A4 and A5 waited there and the
    Attributes step read "Needs criteria" with nothing said."""
    row = connection.execute(
        "SELECT pending_revision FROM evidence_plans WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    if row is None or row[0] is None:
        return False, []
    revision = row[0] if isinstance(row[0], dict) else {}
    proposed = {
        " ".join(str(item.get("attribute") or "").split()).lower(): item
        for item in revision.get("criteria") or []
        if isinstance(item, dict)
    }
    found: list[PendingCriteriaBody] = []
    for (
        attribute_id,
        code,
        text,
        condition,
        passes,
        fails,
        judgment,
        automatable,
    ) in connection.execute(
        f"""
            SELECT a.id, coalesce(a.code, ''), a.text, a.condition, a.pass_criteria,
                   a.fail_criteria, a.judgment_required, a.automatable
            FROM control_attributes a
            WHERE a.engagement_control_id = %s AND {CRITERIA_WRITABLE_SQL}
            ORDER BY a.position, a.created_at
            """,
        (control_id,),
    ).fetchall():
        item = proposed.get(" ".join(str(text).split()).lower())
        if item is not None and (condition, passes, fails, judgment, automatable) != (
            item.get("condition"), item.get("pass_criteria"), item.get("fail_criteria"),
            bool(item.get("judgment_required")), item.get("automatable"),
        ):  # fmt: skip
            found.append(PendingCriteriaBody(attribute_id=attribute_id, code=str(code)))
    return True, found


def plan_run_failure_note(connection: psycopg.Connection[Any], control_id: UUID) -> str:
    """The `failure_note` of the control's evidence plan and master plan: a plan run that
    failed (its run note), or the latest run whose planner answer could not be used."""
    row = connection.execute(
        f"SELECT p.run_status, p.run_note, {LATEST_RUN_SQL} FROM evidence_plans p "
        "WHERE p.engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    if row is None:
        return ""
    return plan_failure_of(str(row[0]), str(row[1] or ""), row[2], row[3])


# The plan's latest run's source and note, as two columns over evidence_plans `p`, for the
# failure note of many plans in one query (master_plans).
LATEST_RUN_SQL = """
    (SELECT r.source FROM evidence_plan_runs r WHERE r.plan_id = p.id
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1),
    (SELECT r.note FROM evidence_plan_runs r WHERE r.plan_id = p.id
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1)
"""


def plan_failure_of(run_status: str, run_note: str, source: Any, note: Any) -> str:
    """plan_run_failure_note from what was read: the plan's run state and its latest run."""
    if run_status in ("PENDING", "WORKING"):
        return ""
    if run_status == "FAILED" and run_note.strip():
        return f"{run_note.strip()} {PLAN_AGAIN}"
    return "" if source is None else plan_failure_note(str(source), str(note or ""))


def _keep_standing_plan(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    planned: Planned,
    requester: UUID | None,
) -> str:
    """Whether the rules' fallback is left unwritten, as the note the run ends with; empty
    when the fallback is to be written.

    The fallback plans a control that has no usable plan yet: no plan, or the rules' own
    plan (RULES, FALLBACK) that nobody accepted or approved anything in and nothing was
    requested or released from. Over a plan that stands (_PLAN_STANDS_SQL) it is not
    written at all: no requirement is added, removed, flagged or given a pending change, no
    criteria and no plan content change, nothing is requested. So a fallback never proposes
    removing or replacing a request a person accepted or one already requested, and never
    touches a released phase. The run is on record: its row in the plan's runs (the failed
    call linked, no output, no changes) and an audit event."""
    plan = cursor.execute(
        f"SELECT p.id, {_PLAN_STANDS_SQL} FROM evidence_plans p "
        "WHERE p.project_id = %s AND p.engagement_control_id = %s FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    if plan is None or not plan[1]:
        return ""
    plan_id = UUID(str(plan[0]))
    note = f"{KEPT_NOTE} {planned.problem}".strip()[:500]
    cursor.execute(
        """
        INSERT INTO evidence_plan_runs (
            organization_id, project_id, plan_id, source, model_call_id, output, changes, note,
            created_by
        )
        VALUES (%s, %s, %s, 'FALLBACK', %s, '{}'::jsonb, %s, %s, %s)
        """,
        (
            organization_id, project_id, plan_id, planned.call_id,
            Json(Changes([], [], [], [], []).as_json()), note, requester,
        ),
    )  # fmt: skip
    _audit(
        cursor, organization_id, project_id, requester, "evidence_plan.kept",
        "evidence_plan", plan_id,
        {"source": "FALLBACK", "model_call": str(planned.call_id) if planned.call_id else None},
    )  # fmt: skip
    return note


def reconcile_info(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ReconcileInfo | None:
    """The control's kickoff draft, if it was never sent, and the items it holds up."""
    row = connection.execute(
        """
        SELECT r.id, r.version,
               (SELECT count(*) FROM evidence_requirements q
                JOIN evidence_plan_phases ph
                  ON ph.plan_id = q.plan_id AND ph.phase = q.phase
                WHERE q.engagement_control_id = r.engagement_control_id
                  AND q.phase IN ('DESIGN', 'INTERIM') AND q.status = 'PLANNED'
                  AND q.depends_on IS NULL AND ph.applicability = 'APPLICABLE')
        FROM pbc_requests r
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.status = 'DRAFT'
          AND (r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
        ORDER BY r.created_at LIMIT 1
        """,
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return None
    planned = connection.execute(
        "SELECT 1 FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s",
        (project_id, control_id),
    ).fetchone()
    # Once planned, only while plan items wait on it: a draft kept for them is settled.
    if planned is not None and int(row[2]) == 0:
        return None
    return ReconcileInfo(
        request_id=UUID(str(row[0])), request_version=int(row[1]), waiting_items=int(row[2])
    )


def held_for_planning(connection: psycopg.Connection[Any], request_id: UUID) -> str | None:
    """Why a kickoff draft cannot go for approval yet, or None. Planning comes first: a
    request drafted before the control's evidence was planned waits for the plan, then
    for a person to settle it against the plan."""
    row = connection.execute(
        """
        SELECT r.project_id, r.engagement_control_id,
               EXISTS (SELECT 1 FROM evidence_plans p
                       WHERE p.engagement_control_id = r.engagement_control_id),
               s.kicked_off_at IS NOT NULL
        FROM pbc_requests r JOIN engagement_settings s ON s.project_id = r.project_id
        WHERE r.id = %s AND r.status = 'DRAFT' AND r.engagement_control_id IS NOT NULL
          AND (r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
        """,
        (request_id,),
    ).fetchone()
    operating = connection.execute(
        "SELECT engagement_control_id FROM pbc_requests WHERE id = %s "
        "AND engagement_control_id IS NOT NULL AND testing_phase IN ('INTERIM', 'ROLLFORWARD') "
        "AND status IN ('DRAFT', 'APPROVAL_PENDING')",
        (request_id,),
    ).fetchone()
    if operating is not None:
        from ai_workforce_api.design_conclusions import oe_gate_reason

        gated = oe_gate_reason(connection, UUID(str(operating[0])))
        if gated is not None:
            return gated
    if row is not None and row[3]:
        if not row[2]:
            return "plan the evidence first"
        info = reconcile_info(connection, UUID(str(row[0])), UUID(str(row[1])))
        if info is not None and info.request_id == request_id:
            return "settle the kickoff draft against the plan first"
    # The planning gate: a request the evidence coordinator drafted for a planned phase
    # (or at kickoff) waits, unsent, until the plan is approved, and for operating
    # evidence until the attributes are settled.
    held = connection.execute(
        """
        SELECT r.engagement_control_id, r.testing_phase,
               r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%'
        FROM pbc_requests r
        WHERE r.id = %s AND r.drafted_by = 'AGENT' AND r.engagement_control_id IS NOT NULL
          AND r.status IN ('DRAFT', 'APPROVAL_PENDING')
          AND (r.testing_phase IN ('DESIGN', 'INTERIM', 'ROLLFORWARD')
               OR r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
        """,
        (request_id,),
    ).fetchone()
    if held is None:
        return None
    control, phase = UUID(str(held[0])), None if held[1] is None else str(held[1])
    reason = gate_reason(connection, control, phase)
    if reason is not None:
        return reason
    # Phase-based release (milestone E): interim and roll-forward requests are prepared in
    # advance and go for approval once a person releases the phase for the control. A
    # kickoff request from before phases were planned asks for both at once and is settled
    # against the plan instead (reconcile).
    from ai_workforce_api.phase_release import release_reason

    if held[2]:
        # A kickoff draft kept against the plan asks for the phases of the plan items linked
        # to it, and each phase's gate holds it (bug hunt, 9 November 2026): D&I evidence
        # waits for its release, operating evidence for the settled attributes and an
        # effective D&I sign-off. Before, the plan's approval alone let it through.
        phases = {
            str(item[0])
            for item in connection.execute(
                "SELECT DISTINCT phase FROM evidence_requirements WHERE pbc_request_id = %s "
                "AND status NOT IN ('WAIVED', 'REMOVED')",
                (request_id,),
            ).fetchall()
        }
        for linked in ("DESIGN", "INTERIM", "ROLLFORWARD"):
            if linked not in phases:
                continue
            reason = gate_reason(connection, control, linked)
            if reason is None and linked in _OPERATING:
                from ai_workforce_api.design_conclusions import oe_gate_reason

                reason = oe_gate_reason(connection, control)
            if reason is not None:
                return reason
        return None
    return release_reason(connection, control, phase)


def reconcile_waiting(connection: psycopg.Connection[Any], project_id: UUID) -> set[UUID]:
    """The planned controls whose kickoff draft holds plan items until a person settles it."""
    return {
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT DISTINCT r.engagement_control_id
            FROM pbc_requests r
            JOIN evidence_requirements q ON q.engagement_control_id = r.engagement_control_id
            JOIN evidence_plan_phases ph ON ph.plan_id = q.plan_id AND ph.phase = q.phase
            WHERE r.project_id = %s AND r.status = 'DRAFT'
              AND (r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
              AND q.phase IN ('DESIGN', 'INTERIM') AND q.status = 'PLANNED'
              AND q.depends_on IS NULL AND ph.applicability = 'APPLICABLE'
            """,
            (project_id,),
        ).fetchall()
    }


class ReconcileBody(BaseModel):
    # REPLACE: the plan's requests take the draft's place; it is cancelled, with why, and
    # kept on record. KEEP: it stays the request for the plan's design and interim items.
    action: Literal["REPLACE", "KEEP"]
    request_version: int = Field(ge=1)
    reason: str = Field(default="", max_length=500)


def reconcile(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: ReconcileBody,
) -> list[UUID]:
    """A person settles a kickoff draft against the control's evidence plan. Returns the
    drafts to schedule."""
    reason = " ".join(body.reason.split())
    if contains_secret({"reason": reason}):
        raise ValueError("the reason holds a secret")
    if body.action == "REPLACE" and len(reason) < 3:
        raise ValueError("say why the draft is replaced")
    with transaction(connection) as cursor:
        _plan_row(cursor, project_id, control_id)
        legacy = cursor.execute(
            """
            SELECT id, version FROM pbc_requests
            WHERE project_id = %s AND engagement_control_id = %s AND status = 'DRAFT'
              AND (operation_key LIKE 'kickoff-%%' OR operation_key LIKE 'scope-%%')
            ORDER BY created_at LIMIT 1 FOR UPDATE
            """,
            (project_id, control_id),
        ).fetchone()
        if legacy is None:
            raise PlanState("there is no kickoff draft to reconcile")
        legacy_id = UUID(str(legacy[0]))
        if int(legacy[1]) != body.request_version:
            raise PlanState("the request changed")
        if reconcile_info(cursor.connection, project_id, control_id) is None:
            raise PlanState("nothing waits on the kickoff draft")
        if body.action == "REPLACE":
            # The plan's requests go to the owner, else the evidence coordinator: with
            # neither, replacing would cancel the draft and leave nothing in its place.
            to = cursor.execute(
                """
                SELECT c.owner_email, s.client_coordinator_email
                FROM engagement_controls c
                JOIN engagement_settings s ON s.project_id = c.project_id
                WHERE c.id = %s AND c.project_id = %s
                """,
                (control_id, project_id),
            ).fetchone()
            if to is None or not any(_EMAIL.fullmatch(str(value or "")) for value in to):
                raise PlanState("set the evidence coordinator or the owner's email first")
            cursor.execute(
                """
                UPDATE pbc_requests
                SET status = 'CANCELLED', cancellation_reason = %s,
                    version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s AND status = 'DRAFT'
                """,
                (f"Replaced by the evidence plan's requests: {reason}"[:500], legacy_id),
            )
            linked = 0
        else:
            waiting = [
                UUID(str(row[0]))
                for row in cursor.execute(
                    """
                    SELECT q.id FROM evidence_requirements q
                    JOIN evidence_plan_phases ph ON ph.plan_id = q.plan_id AND ph.phase = q.phase
                    WHERE q.engagement_control_id = %s AND q.phase IN ('DESIGN', 'INTERIM')
                      AND q.status = 'PLANNED' AND q.depends_on IS NULL
                      AND ph.applicability = 'APPLICABLE'
                    FOR UPDATE OF q
                    """,
                    (control_id,),
                ).fetchall()
            ]
            # Its wording stays as the person or the agent left it.
            _link(
                cursor, waiting, legacy_id,
                "Kept on the kickoff draft, written before planning: check it asks for this.",
            )  # fmt: skip
            linked = len(waiting)
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.reconciled",
            "pbc_request", legacy_id,
            {"action": body.action, "reason": reason, "linked_items": linked},
        )  # fmt: skip
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


class PlannedMissing(BaseModel):
    planned: int
    # Planned controls whose waiting evidence was requested now.
    requested: int = 0
    # Controls that could not be planned, with why; the rest are planned.
    failed: list[str]
    remaining: int


def unplanned_controls(connection: psycopg.Connection[Any], project_id: UUID) -> list[UUID]:
    """In-scope controls of a running engagement with no evidence plan: launched before
    evidence planning existed."""
    return [
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT c.id FROM engagement_controls c
            JOIN engagement_settings s ON s.project_id = c.project_id
            WHERE c.project_id = %s AND c.included AND s.kicked_off_at IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM evidence_plans p WHERE p.engagement_control_id = c.id
              )
            ORDER BY c.control_ref, c.id
            """,
            (project_id,),
        ).fetchall()
    ]


def unrequested_controls(connection: psycopg.Connection[Any], project_id: UUID) -> list[UUID]:
    """In-scope controls of a running engagement whose planned design or interim evidence
    was never requested: no request holds it, and no kickoff draft waits on a person for it.
    Engagements launched before requests were drafted with no recipient are left so."""
    return [
        UUID(str(row[0]))
        for row in connection.execute(
            """
            SELECT DISTINCT c.id, c.control_ref FROM engagement_controls c
            JOIN engagement_settings s ON s.project_id = c.project_id
            JOIN projects p ON p.id = c.project_id
            JOIN evidence_requirements q ON q.engagement_control_id = c.id
            JOIN evidence_plan_phases ph ON ph.plan_id = q.plan_id AND ph.phase = q.phase
            WHERE c.project_id = %s AND c.included AND s.kicked_off_at IS NOT NULL
              AND p.status = 'ACTIVE'
              AND q.phase IN ('DESIGN', 'INTERIM') AND q.status = 'PLANNED'
              AND q.depends_on IS NULL AND ph.applicability = 'APPLICABLE'
              -- As issue(): an addition proposed by the planner and not yet accepted is not
              -- part of the plan (bug hunt, 9 November 2026; before, it kept the control
              -- listed as unrequested for good).
              AND NOT coalesce((q.pending_change ->> 'add')::boolean, false)
              AND NOT EXISTS (
                  SELECT 1 FROM pbc_requests r
                  WHERE r.engagement_control_id = c.id AND r.status = 'DRAFT'
                    AND (r.operation_key LIKE 'kickoff-%%' OR r.operation_key LIKE 'scope-%%')
              )
              -- As issue(): only what the planning gate allows. D&I evidence follows its
              -- own release (B1); interim follows the approved plan and settled attributes.
              AND (
                  (q.phase = 'DESIGN'
                   AND EXISTS (SELECT 1 FROM phase_releases pr
                               WHERE pr.engagement_control_id = c.id AND pr.phase = 'DESIGN'))
                  OR (q.phase = 'INTERIM'
                      AND EXISTS (SELECT 1 FROM evidence_plans ep
                                  WHERE ep.engagement_control_id = c.id
                                    AND ep.status IN ('APPROVED', 'CHANGES_PROPOSED'))
                      AND ({ATTRIBUTES_SETTLED_SQL}))
              )
              -- As issue(): a file the control holds already serves it.
              AND NOT (
                  q.sufficiency IN ('NOT_REVIEWED', 'UNDER_REVIEW', 'ACCEPTED')
                  AND EXISTS (
                      SELECT 1 FROM evidence_requirement_files ef
                      JOIN evidence_file_links l
                        ON l.evidence_file_id = ef.evidence_file_id
                       AND l.engagement_control_id = ef.engagement_control_id
                      WHERE ef.requirement_id = q.id AND ef.status = 'LINKED'
                  )
              )
            ORDER BY c.control_ref, c.id
            """.replace("{ATTRIBUTES_SETTLED_SQL}", ATTRIBUTES_SETTLED_SQL),
            (project_id,),
        ).fetchall()
    ]


def plan_missing(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    limit: int = 200,
) -> tuple[PlannedMissing, list[UUID]]:
    """Plan, with the reviewed rules, each in-scope control that has no plan, and request
    the planned evidence of each that was never requested, one control per transaction.
    A kickoff draft is not touched: each waits for a person to reconcile it. Idempotent:
    a planned and requested control is skipped."""
    missing = unplanned_controls(connection, project_id)
    drafts: list[UUID] = []
    failed: list[str] = []
    planned = 0
    for control_id in missing[:limit]:
        try:
            _, queued, _ = generate(
                connection, None, organization_id, project_id, control_id, actor
            )
        except (PlanState, ValueError, psycopg.errors.UniqueViolation) as error:
            ref = connection.execute(
                "SELECT control_ref FROM engagement_controls WHERE id = %s", (control_id,)
            ).fetchone()
            failed.append(f"{ref[0] if ref else control_id}: {error}"[:200])
            continue
        planned += 1
        drafts += queued
    requested = 0
    for control_id in unrequested_controls(connection, project_id)[:limit]:
        with transaction(connection) as cursor:
            issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
            drafts += queue_drafts(
                cursor, organization_id, project_id, actor, control_id, issued.drafts
            )
        requested += 1
    remaining = len(unplanned_controls(connection, project_id)) + len(
        unrequested_controls(connection, project_id)
    )
    return (
        PlannedMissing(planned=planned, requested=requested, failed=failed, remaining=remaining),
        drafts,
    )


def _plan_row(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID
) -> tuple[UUID, str, int]:
    row = cursor.execute(
        "SELECT id, status, version FROM evidence_plans WHERE project_id = %s "
        "AND engagement_control_id = %s FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        raise PlanState("the control has no evidence plan yet")
    return UUID(str(row[0])), str(row[1]), int(row[2])


def approve(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: VersionBody,
) -> None:
    """A person approves the plan's current revision (master_plans.approve)."""
    from ai_workforce_api.master_plans import ApproveBody
    from ai_workforce_api.master_plans import approve as approve_plan

    approve_plan(
        connection, organization_id, project_id, control_id, actor,
        ApproveBody(version=body.version),
    )  # fmt: skip


def decide_phase(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    phase: Phase,
    actor: UUID,
    body: PhaseDecision,
) -> list[UUID]:
    """A person decides whether a phase applies. Kept over the planner's on later runs."""
    rationale = " ".join(body.rationale.split())
    if body.applicability == "NOT_APPLICABLE":
        if len(rationale) < 30:
            raise ValueError("a phase is not applicable only for a specific reason")
        if _MISSING_AS_REASON.search(rationale):
            raise PlanState("missing evidence is not a reason a phase does not apply")
    if body.applicability == "PENDING" and not body.open_question.strip():
        raise ValueError("say what has to be resolved")
    if body.applicability == "CONDITIONAL" and not body.condition.strip():
        raise ValueError("say the condition")
    with transaction(connection) as cursor:
        plan_id, _, _ = _plan_row(cursor, project_id, control_id)
        row = cursor.execute(
            """
            UPDATE evidence_plan_phases
            SET applicability = %s, rationale = %s, condition = %s, open_question = %s,
                origin = 'PERSON', decided_by = %s, decided_at = clock_timestamp(),
                version = version + 1
            WHERE plan_id = %s AND phase = %s AND version = %s
            RETURNING id
            """,
            (
                body.applicability, rationale,
                body.condition.strip() if body.applicability == "CONDITIONAL" else "",
                body.open_question.strip() if body.applicability == "PENDING" else "",
                actor, plan_id, phase, body.version,
            ),
        ).fetchone()  # fmt: skip
        if row is None:
            raise PlanState("the phase changed")
        _revise(cursor, plan_id)
        if body.applicability in ("APPLICABLE", "CONDITIONAL"):
            _ensure_requirements(cursor, organization_id, project_id, plan_id, control_id, phase)
        elif body.applicability == "NOT_APPLICABLE":
            # Nothing more is asked for a phase that does not apply. What was already
            # requested stays on record with its request.
            cursor.execute(
                "UPDATE evidence_requirements SET status = 'REMOVED', version = version + 1 "
                "WHERE plan_id = %s AND phase = %s AND origin <> 'PERSON' "
                "AND status IN ('PLANNED', 'AWAITING_DEPENDENCY')",
                (plan_id, phase),
            )
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.phase_decided",
            "evidence_plan", plan_id,
            {"phase": phase, "applicability": body.applicability, "by": "PERSON"},
        )  # fmt: skip
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def _ensure_requirements(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    plan_id: UUID,
    control_id: UUID,
    phase: Phase,
) -> None:
    """A phase a person made applicable gets the rules' requirements if it has none."""
    have = cursor.execute(
        "SELECT 1 FROM evidence_requirements WHERE plan_id = %s AND phase = %s "
        "AND status NOT IN ('REMOVED', 'WAIVED') LIMIT 1",
        (plan_id, phase),
    ).fetchone()
    if have is not None:
        return
    facts = load_facts(cursor.connection, project_id, control_id)
    plan = rules_plan(facts, every_phase=True)
    period = phase_periods(facts)[phase]
    for requirement in plan.phase(phase).requirements:
        cursor.execute(
            """
            INSERT INTO evidence_requirements (
                organization_id, project_id, plan_id, engagement_control_id, phase,
                requirement_key, title, description, categories, objective, attributes, risk,
                rationale, necessity, period_label, period_start, period_end,
                population_kind, sample_selection, depends_on, status, origin
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, 'RULES')
            ON CONFLICT (engagement_control_id, phase, requirement_key) DO UPDATE
            SET status = CASE WHEN evidence_requirements.status = 'REMOVED'
                                   AND evidence_requirements.removed_by IS NULL
                              THEN EXCLUDED.status ELSE evidence_requirements.status END,
                -- Revived by the rules, it is a proposal to accept, nobody's acceptance.
                accepted_by = CASE WHEN evidence_requirements.status = 'REMOVED'
                                   THEN NULL ELSE evidence_requirements.accepted_by END,
                accepted_at = CASE WHEN evidence_requirements.status = 'REMOVED'
                                   THEN NULL ELSE evidence_requirements.accepted_at END
            RETURNING id
            """,
            (
                organization_id, project_id, plan_id, control_id, phase, requirement.key,
                requirement.title, requirement.description, list(requirement.categories),
                requirement.objective, Json(list(requirement.attributes)), requirement.risk,
                requirement.rationale, requirement.necessity,
                requirement.period_label or period.label, period.start, period.end,
                requirement.population_kind, requirement.sample_selection,
                requirement.depends_on,
                "AWAITING_DEPENDENCY" if requirement.depends_on else "PLANNED",
            ),
        )  # fmt: skip
        made = cursor.fetchone()
        if made is not None:
            _sync_named_links(
                cursor, organization_id, project_id, control_id, UUID(str(made[0])),
                list(requirement.attributes), "RULES",
            )  # fmt: skip


def _requirement_row(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, requirement_id: UUID
) -> tuple[Any, ...]:
    # The plan's row first, then the requirement: the order the planner's merge, the
    # acceptance of the list and every other writer take them in, so an "accept all" and
    # an edit of the same request wait for each other instead of deadlocking.
    cursor.execute(
        "SELECT 1 FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s "
        "FOR UPDATE",
        (project_id, control_id),
    )
    row = cursor.execute(
        """
        SELECT q.id, q.status, q.version, q.pbc_request_id, r.status, q.pending_change,
               q.depends_on, q.plan_id, q.phase, q.accepted_at IS NOT NULL
        FROM evidence_requirements q
        LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE q.id = %s AND q.project_id = %s AND q.engagement_control_id = %s
        FOR UPDATE OF q
        """,
        (requirement_id, project_id, control_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return tuple(row)


def set_sufficiency(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: SufficiencyBody,
) -> list[UUID]:
    """A person judges whether what arrived is enough. Only after something arrived.
    Returns the workpaper drafts it asked the agent for (_design_redraft)."""
    note = " ".join(body.note.split())
    if body.sufficiency in ("INSUFFICIENT", "FOLLOW_UP_REQUIRED") and not note:
        raise ValueError("say what is missing")
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        linked = _linked(cursor, requirement_id)
        arrived = (
            row[4] in _RECEIVED
            or linked
            or (
                row[3] is not None
                and cursor.execute(
                    "SELECT 1 FROM evidence_file_links WHERE pbc_request_id = %s LIMIT 1",
                    (row[3],),
                ).fetchone()
                is not None
            )
            # A policy another system's instance shares with this one has arrived too.
            or cursor.execute(
                "SELECT 1 FROM evidence_requirements q WHERE q.id = %s AND EXISTS ("
                + shared_from_sibling("1")
                + ")",
                (requirement_id,),
            ).fetchone()
            is not None
        )
        judgeable = row[1] == "REQUESTED" or (row[1] == "PLANNED" and linked)
        if body.sufficiency != "NOT_REVIEWED" and (not judgeable or not arrived):
            raise PlanState("nothing has been received for this requirement yet")
        if body.sufficiency == "ACCEPTED" and not _has_own_evidence(cursor, requirement_id):
            # Accepting judges the item's own files: a request received as a whole, or a
            # file on it that serves another item, is nothing to accept.
            raise PlanState("no file serves this item yet; add or link its evidence first")
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET sufficiency = %s, sufficiency_note = %s,
                sufficiency_by = CASE WHEN %s = 'NOT_REVIEWED' THEN NULL ELSE %s::uuid END,
                sufficiency_at = CASE WHEN %s = 'NOT_REVIEWED' THEN NULL
                                      ELSE clock_timestamp() END,
                version = version + 1
            WHERE id = %s
            """,
            (body.sufficiency, note, body.sufficiency, actor, body.sufficiency, requirement_id),
        )
        # Each decision with its note: the requirement holds only the latest, so the trail
        # keeps every earlier one (an item sent back, then accepted, keeps why it was).
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.sufficiency",
            "evidence_requirement", requirement_id,
            {"sufficiency": body.sufficiency, "note": note},
        )  # fmt: skip
        if body.sufficiency == "ACCEPTED" and row[3] is not None:
            _received_when_accepted(cursor, organization_id, project_id, actor, row[3])
        if body.sufficiency == "ACCEPTED":
            return _design_redraft(cursor, organization_id, project_id, control_id, actor)
    return []


def _design_redraft(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> list[UUID]:
    """Every design item a person accepted: the agent drafts the design workpaper again
    from the accepted evidence (22 Oct 2026; it was drafted once, from the first file
    read, and only a person asked for it again). A person's sections stay, and a prepared
    workpaper is not touched (workpaper_service.ensure)."""
    from ai_workforce_api.workpaper_service import ensure

    counts = cursor.execute(
        "SELECT count(*), count(*) FILTER (WHERE sufficiency = 'ACCEPTED') "
        "FROM evidence_requirements "
        "WHERE engagement_control_id = %s AND phase = 'DESIGN' AND status = 'REQUESTED'",
        (control_id,),
    ).fetchone()
    if counts is None or counts[0] == 0 or counts[0] != counts[1]:
        return []
    return ensure(cursor, organization_id, project_id, control_id, actor, ("DESIGN",))


# A request still waiting on the owner; accepting its last item settles it.
_STILL_ASKED = ("SENT", "WAITING_FOR_RESPONSE", "OVERDUE", "ESCALATED", "PARTIALLY_RECEIVED")


def _received_when_accepted(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    request_id: UUID,
) -> None:
    """A request whose every requested item a person accepted is received: nothing more is
    asked of the owner, so its open reminders are cancelled (22 Oct 2026; a request stayed
    partly received when the reader had not found every item covered). Migration 0103
    applies this to requests settled before."""
    from ai_workforce_api.followups import cancel_open

    counts = cursor.execute(
        "SELECT count(*), count(*) FILTER (WHERE sufficiency = 'ACCEPTED') "
        "FROM evidence_requirements WHERE pbc_request_id = %s AND status = 'REQUESTED'",
        (request_id,),
    ).fetchone()
    if counts is None or counts[0] == 0 or counts[0] != counts[1]:
        return
    moved = cursor.execute(
        """
        UPDATE pbc_requests
        SET status = 'RECEIVED', escalation_state = 'NONE',
            first_response_at = coalesce(first_response_at, clock_timestamp()),
            received_at = clock_timestamp(), updated_at = clock_timestamp(),
            version = version + 1
        WHERE id = %s AND project_id = %s AND status = ANY(%s)
        RETURNING id
        """,
        (request_id, project_id, list(_STILL_ASKED)),
    ).fetchone()
    if moved is None:
        return
    cancel_open(cursor, organization_id, project_id, actor, request_id)
    _audit(
        cursor, organization_id, project_id, actor, "pbc_request.received",
        "pbc_request", request_id, {"by": "every item accepted"},
    )  # fmt: skip


def _has_own_evidence(cursor: psycopg.Cursor[Any], requirement_id: UUID) -> bool:
    """Whether a file serves the item itself: one on its request that serves it (filed for
    it, or for the request and not read as missing it), one a sibling control shares for
    it, or one a person linked to it. The test the plan uses for an item's files."""
    row = cursor.execute(
        """
        SELECT 1 FROM evidence_requirements q
        WHERE q.id = %s AND (
            EXISTS (
                SELECT 1 FROM evidence_file_links l
                LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
                WHERE l.pbc_request_id = q.pbc_request_id AND {SERVES})
            OR EXISTS ({SHARED})
            OR EXISTS (
                SELECT 1 FROM evidence_requirement_files ef
                JOIN evidence_file_links l
                  ON l.evidence_file_id = ef.evidence_file_id
                 AND l.engagement_control_id = ef.engagement_control_id
                WHERE ef.requirement_id = q.id AND ef.status = 'LINKED'))
        """.replace("{SERVES}", request_file_serves("l.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        (requirement_id,),
    ).fetchone()
    return row is not None


def _linked(cursor: psycopg.Cursor[Any], requirement_id: UUID) -> bool:
    return (
        cursor.execute(
            """
            SELECT 1 FROM evidence_requirement_files ef
            JOIN evidence_file_links l
              ON l.evidence_file_id = ef.evidence_file_id
             AND l.engagement_control_id = ef.engagement_control_id
            WHERE ef.requirement_id = %s AND ef.status = 'LINKED'
            LIMIT 1
            """,
            (requirement_id,),
        ).fetchone()
        is not None
    )


class LinkBody(BaseModel):
    file_id: UUID
    reason: str = Field(min_length=3, max_length=500)
    version: int = Field(ge=1)


class UnlinkBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    version: int = Field(ge=1)


def link_file(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: LinkBody,
    *,
    placement_reason: str | None = None,
) -> None:
    """A person says a file the control already holds serves a requirement, with why: the
    design walkthrough's file for an interim item, one file for two phases. For a file
    the D&I evidence wizard has, `placement_reason` is why its placement followed (by
    default, a link on the D&I list)."""
    from ai_workforce_api.evidence_wizard import LINKED_ON_LIST, follow_filing, lock_wizard

    reason = " ".join(body.reason.split())
    if len(reason) < 3:
        raise ValueError("say why the file serves it")
    with transaction(connection) as cursor:
        # A file the D&I evidence wizard has: its reading and its batch before the plan's
        # row, the order every wizard write takes them in.
        wizard = lock_wizard(cursor, project_id, body.file_id)
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        if row[1] in ("WAIVED", "REMOVED"):
            raise PlanState("the requirement is not open")
        held = cursor.execute(
            "SELECT pbc_request_id FROM evidence_file_links "
            "WHERE evidence_file_id = %s AND project_id = %s AND engagement_control_id = %s",
            (body.file_id, project_id, control_id),
        ).fetchone()
        if held is None:
            raise PlanState("the file is not one of this control's evidence files")
        if row[3] is not None and held[0] == row[3]:
            serves = cursor.execute(
                f"""
                SELECT {request_file_serves("%s")}
                FROM evidence_requirements q
                LEFT JOIN evidence_analyses a ON a.evidence_file_id = %s
                WHERE q.id = %s
                """,
                (body.file_id, body.file_id, requirement_id),
            ).fetchone()
            if serves is None or serves[0]:
                raise PlanState("the file already serves it through its request")
        saved = cursor.execute(
            """
            INSERT INTO evidence_requirement_files (
                organization_id, project_id, engagement_control_id, requirement_id,
                evidence_file_id, status, origin, reason, linked_by
            )
            VALUES (%s, %s, %s, %s, %s, 'LINKED', 'PERSON', %s, %s)
            ON CONFLICT (requirement_id, evidence_file_id) DO UPDATE
            SET status = 'LINKED', origin = 'PERSON', reason = EXCLUDED.reason,
                linked_by = EXCLUDED.linked_by, linked_at = clock_timestamp(),
                removed_by = NULL, removed_at = NULL, removed_reason = '',
                version = evidence_requirement_files.version + 1
            WHERE evidence_requirement_files.status <> 'LINKED'
            RETURNING id
            """,
            (organization_id, project_id, control_id, requirement_id, body.file_id, reason,
             actor),
        ).fetchone()  # fmt: skip
        if saved is None:
            raise PlanState("the file already serves it")
        cursor.execute(
            "UPDATE evidence_requirements SET version = version + 1 WHERE id = %s",
            (requirement_id,),
        )
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.file_linked",
            "evidence_requirement", requirement_id,
            {"evidence_file_id": str(body.file_id), "link_id": str(saved[0])},
        )  # fmt: skip
        if wizard is not None:
            # The wizard's placement follows the file (superseding, kept).
            follow_filing(
                cursor, project_id, body.file_id, actor, placement_reason or LINKED_ON_LIST
            )


def unlink_file(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    link_id: UUID,
    actor: UUID,
    body: UnlinkBody,
) -> None:
    """A person takes a linked file off a requirement, with why. The link is kept, marked
    removed. A judgment that rested on it alone goes back to not reviewed."""
    from ai_workforce_api.evidence_wizard import UNLINKED_ON_LIST, follow_filing, lock_wizard

    reason = " ".join(body.reason.split())
    if len(reason) < 3:
        raise ValueError("say why")
    with transaction(connection) as cursor:
        # A file the D&I evidence wizard has: its reading and its batch before the plan's
        # row, the order every wizard write takes them in.
        linked_file = cursor.execute(
            "SELECT evidence_file_id FROM evidence_requirement_files "
            "WHERE id = %s AND requirement_id = %s",
            (link_id, requirement_id),
        ).fetchone()
        wizard = (
            None
            if linked_file is None
            else lock_wizard(cursor, project_id, UUID(str(linked_file[0])))
        )
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        link = cursor.execute(
            "SELECT version FROM evidence_requirement_files WHERE id = %s "
            "AND requirement_id = %s AND status = 'LINKED' FOR UPDATE",
            (link_id, requirement_id),
        ).fetchone()
        if link is None:
            raise NotVisible()
        if int(link[0]) != body.version:
            raise PlanState("the link changed")
        cursor.execute(
            """
            UPDATE evidence_requirement_files
            SET status = 'REMOVED', removed_by = %s, removed_at = clock_timestamp(),
                removed_reason = %s, version = version + 1
            WHERE id = %s
            """,
            (actor, reason, link_id),
        )
        others = _linked(cursor, requirement_id) or (
            row[3] is not None
            and cursor.execute(
                "SELECT 1 FROM evidence_file_links WHERE pbc_request_id = %s LIMIT 1", (row[3],)
            ).fetchone()
            is not None
        )
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET sufficiency = CASE WHEN %s THEN sufficiency ELSE 'NOT_REVIEWED' END,
                sufficiency_note = CASE WHEN %s THEN sufficiency_note ELSE '' END,
                sufficiency_by = CASE WHEN %s THEN sufficiency_by END,
                sufficiency_at = CASE WHEN %s THEN sufficiency_at END,
                version = version + 1
            WHERE id = %s
            """,
            (others, others, others, others, requirement_id),
        )
        if row[3] is not None:
            # The item's request follows the evidence left on it (31 Oct 2026: an item read
            # "Provided" with nothing linked after its only file was unlinked).
            from ai_workforce_api.evidence_receipts import follow_evidence

            follow_evidence(cursor, organization_id, project_id, row[3], actor)
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.file_unlinked",
            "evidence_requirement", requirement_id,
            {"link_id": str(link_id), "judgment_reset": not others},
        )  # fmt: skip
        if wizard is not None and linked_file is not None:
            # The wizard's placement follows the file (superseding, kept).
            follow_filing(cursor, project_id, UUID(str(linked_file[0])), actor, UNLINKED_ON_LIST)


AcceptedBy = Literal["ACCEPT", "ADD", "EDIT", "LINKS", "RESTORE", "CHANGE"]


def accept_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    by: AcceptedBy,
    change: str | None = None,
) -> bool:
    """A person owns the D&I request as it now stands (B1f, product owner, 12 November
    2026: "Agent proposes, the human approves"): accepted by them, now. By accepting it as
    the agent proposed it (ACCEPT, with the pending change it applied, if any), or by their
    own act on it: adding it, rewording it, restoring it, setting the attributes it
    addresses, or accepting a change the planner proposed. Only a D&I request is accepted;
    the operating phases' items follow the test plan's approval. A removed or waived
    request is not: it is not in the list. Nor is an addition the planner proposed
    (pending_change.add): it is accepted only by a person accepting it, which clears the
    proposal first (apply_change), never by another act on it. Each acceptance is on the
    audit trail with the person as the actor. Returns whether it was recorded. The caller
    holds the row."""
    row = cursor.execute(
        """
        UPDATE evidence_requirements
        SET accepted_by = %s, accepted_at = clock_timestamp()
        WHERE id = %s AND phase = 'DESIGN'
          AND status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED')
          AND NOT coalesce((pending_change ->> 'add')::boolean, false)
        RETURNING engagement_control_id
        """,
        (actor, requirement_id),
    ).fetchone()
    if row is None:
        return False
    _audit(
        cursor, organization_id, project_id, actor, "evidence_requirement.accepted",
        "evidence_requirement", requirement_id,
        {"by": by, "change": change, "control_id": str(row[0])},
    )  # fmt: skip
    return True


ACCEPT_FIRST = "Accept the request first."


def clear_covered_exceptions(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID | None,
) -> int:
    """Withdraw each coverage exception whose attribute a live D&I request now addresses,
    with a record of it (design_coverage.exception_cleared, the reason kept, by the person
    whose act covered it, or nobody when the planner's links did). An exception says why
    an attribute is not evidenced at D&I; once a request addresses the attribute it says
    nothing true, and left in place it would apply again, silently, if that request were
    removed later. Returns how many were withdrawn."""
    cleared = cursor.execute(
        """
        DELETE FROM design_coverage_exceptions x
        WHERE x.engagement_control_id = %s
          AND EXISTS (
              SELECT 1 FROM evidence_requirement_attributes ra
              JOIN evidence_requirements q ON q.id = ra.requirement_id
              WHERE ra.attribute_id = x.attribute_id
                AND q.engagement_control_id = x.engagement_control_id
                AND q.phase = 'DESIGN'
                AND q.status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED')
                AND NOT coalesce((q.pending_change ->> 'add')::boolean, false))
        RETURNING x.attribute_id, x.reason
        """,
        (control_id,),
    ).fetchall()
    for attribute_id, reason in cleared:
        _audit(
            cursor, organization_id, project_id, actor, "design_coverage.exception_cleared",
            "control_attribute", UUID(str(attribute_id)),
            {
                "control_id": str(control_id),
                "reason": str(reason),
                "why": "now addressed by a request",
            },
        )  # fmt: skip
    return len(cleared)


def list_decided(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> None:
    """A person made a decision on the control's D&I requests list: accepting requests,
    adding, rewording, linking, removing, waiving or restoring one, deciding a change the
    planner proposed, recording or clearing a coverage exception. Kept on the plan as the
    list's last decision, who and when (migration 0150): the D&I release rests on it, and
    is attributed to that person whatever later event finds the list settled
    (phase_release.settle_design). An exception for an attribute their act made a request
    address is withdrawn with it. The caller holds the plan's row."""
    cursor.execute(
        "UPDATE evidence_plans SET design_decided_by = %s, design_decided_at = clock_timestamp() "
        "WHERE project_id = %s AND engagement_control_id = %s",
        (actor, project_id, control_id),
    )
    clear_covered_exceptions(cursor, organization_id, project_id, control_id, actor)


def _decided(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    row: tuple[Any, ...],
) -> None:
    """list_decided for a requirement of the D&I list (`row`, from _requirement_row)."""
    if str(row[8]) == "DESIGN":
        list_decided(cursor, organization_id, project_id, control_id, actor)


def waive(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: WaiveBody,
) -> None:
    """A person records that a requirement does not apply, and why."""
    reason = " ".join(body.reason.split())
    if _MISSING_AS_REASON.search(reason):
        raise PlanState("missing evidence is not a reason a requirement does not apply")
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        if row[1] in ("WAIVED", "REMOVED"):
            raise PlanState("the requirement is not open")
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET status = 'WAIVED', waive_reason = %s, waived_by = %s,
                waived_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            """,
            (reason, actor, requirement_id),
        )
        _revise(cursor, UUID(str(row[7])))
        if row[3] is not None:
            render_into(cursor, project_id, control_id, UUID(str(row[3])))
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.waived",
            "evidence_requirement", requirement_id, {},
        )  # fmt: skip
        _decided(cursor, organization_id, project_id, control_id, actor, row)


def restore(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: VersionBody,
) -> list[UUID]:
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        removed = row[1] == "REMOVED" and cursor.execute(
            "SELECT removed_by IS NOT NULL FROM evidence_requirements WHERE id = %s",
            (requirement_id,),
        ).fetchone() == (True,)
        if row[1] != "WAIVED" and not removed:
            raise PlanState("the requirement is not waived or removed")
        linked = row[3] is not None and row[4] != "CANCELLED"
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET status = %s, pbc_request_id = CASE WHEN %s THEN pbc_request_id END,
                waive_reason = '', waived_by = NULL, waived_at = NULL,
                removed_by = NULL, removed_at = NULL, version = version + 1
            WHERE id = %s
            """,
            (
                "REQUESTED" if linked else ("AWAITING_DEPENDENCY" if row[6] else "PLANNED"),
                linked, requirement_id,
            ),
        )  # fmt: skip
        _revise(cursor, UUID(str(row[7])))
        if linked:
            render_into(cursor, project_id, control_id, UUID(str(row[3])))
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.restored",
            "evidence_requirement", requirement_id, {},
        )  # fmt: skip
        # A person puts it back in the list: their decision that it is requested, so a
        # D&I request is accepted by it (a restore in a released phase requests it at once).
        accept_request(cursor, organization_id, project_id, requirement_id, actor, "RESTORE")
        _decided(cursor, organization_id, project_id, control_id, actor, row)
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def remove(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: VersionBody,
) -> None:
    """A person takes evidence off the plan (decided by the product owner on 26 October
    2026). Only evidence not yet requested: what the client was already asked for is waived
    instead, with why. The item is kept, marked removed by whom, so the trail stays and it
    can be restored; no later run brings it back. A plan already approved goes back for
    approval, as with any change to it."""
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        if row[1] not in ("PLANNED", "AWAITING_DEPENDENCY"):
            raise PlanState(
                "it has already been requested from the client; waive it instead"
                if row[1] == "REQUESTED"
                else "the requirement is not open"
            )
        key = cursor.execute(
            "SELECT requirement_key FROM evidence_requirements WHERE id = %s",
            (requirement_id,),
        ).fetchone()
        waiting = cursor.execute(
            "SELECT code FROM evidence_requirements WHERE plan_id = %s AND depends_on = %s "
            "AND status NOT IN ('REMOVED', 'WAIVED') LIMIT 1",
            (row[7], None if key is None else key[0]),
        ).fetchone()
        if waiting is not None:
            raise PlanState(f"{waiting[0]} depends on it; remove that first")
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET status = 'REMOVED', removed_by = %s, removed_at = clock_timestamp(),
                pending_change = NULL, version = version + 1
            WHERE id = %s
            """,
            (actor, requirement_id),
        )
        _revise(cursor, UUID(str(row[7])))
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.removed",
            "evidence_requirement", requirement_id, {},
        )  # fmt: skip
        _decided(cursor, organization_id, project_id, control_id, actor, row)


def edit(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: EditBody,
) -> None:
    """A person rewords a requirement before it is sent. Later runs keep the wording."""
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        if row[1] == "REQUESTED" and row[4] not in ("DRAFT", "CANCELLED"):
            raise PlanState("the request carrying it has gone for approval")
        if isinstance(row[5], dict) and row[5].get("add") is True:
            # An addition the planner proposed is not a person's by rewording it: they
            # accept it (or dismiss it) first.
            raise PlanState(ACCEPT_FIRST)
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET title = %s, description = %s, person_edited = true, version = version + 1
            WHERE id = %s
            """,
            (" ".join(body.title.split()), body.description.strip(), requirement_id),
        )
        _revise(cursor, UUID(str(row[7])))
        if row[3] is not None:
            render_into(cursor, project_id, control_id, UUID(str(row[3])))
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.edited",
            "evidence_requirement", requirement_id, {},
        )  # fmt: skip
        # Reworded by a person: a D&I request is theirs from now on.
        accept_request(cursor, organization_id, project_id, requirement_id, actor, "EDIT")
        _decided(cursor, organization_id, project_id, control_id, actor, row)


def decide_change(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: ChangeDecision,
) -> list[UUID]:
    """A person accepts or dismisses a change a later run proposed. An accepted change to
    something already sent is requested again, never rewritten in the sent request. A D&I
    request whose change (or proposed addition) a person accepts is accepted by them as it
    then stands; dismissing a change keeps the request as it was, and whoever accepted it."""
    with transaction(connection) as cursor:
        row = _requirement_row(cursor, project_id, control_id, requirement_id)
        if int(row[2]) != body.version:
            raise PlanState("the requirement changed")
        kind = apply_change(
            cursor, organization_id, project_id, control_id, requirement_id, actor, row,
            body.decision,
        )  # fmt: skip
        if body.decision == "ACCEPT" and kind != "REMOVE":
            accept_request(
                cursor, organization_id, project_id, requirement_id, actor, "CHANGE", kind
            )
        _decided(cursor, organization_id, project_id, control_id, actor, row)
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def apply_change(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    row: tuple[Any, ...],
    decision: Literal["ACCEPT", "DISMISS"],
) -> Literal["ADD", "REMOVE", "CHANGE"]:
    """Apply a person's decision on the change a run proposed for the requirement
    (`row`, from _requirement_row, which holds it), and record it. Returns what the change
    was: a proposed addition, a proposed removal, or a change to its content."""
    change = row[5]
    if not isinstance(change, dict):
        raise PlanState("no change is waiting")
    plan_id = UUID(str(row[7]))
    kind: Literal["ADD", "REMOVE", "CHANGE"] = (
        "ADD" if change.get("add") is True
        else "REMOVE" if change.get("remove") is True
        else "CHANGE"
    )  # fmt: skip
    if decision == "DISMISS":
        # A proposed addition that is dismissed was never part of the plan.
        cursor.execute(
            "UPDATE evidence_requirements SET pending_change = NULL, needs_review = false, "
            "status = CASE WHEN %s THEN 'REMOVED' ELSE status END, "
            "version = version + 1 WHERE id = %s",
            (change.get("add") is True, requirement_id),
        )
    elif change.get("add") is True:
        # Accepted: it joins the plan, which a person approves again.
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET pending_change = NULL, needs_review = false,
                status = CASE WHEN status = 'REMOVED'
                              THEN CASE WHEN depends_on IS NULL THEN 'PLANNED'
                                        ELSE 'AWAITING_DEPENDENCY' END
                              ELSE status END,
                removed_by = NULL, removed_at = NULL,
                version = version + 1
            WHERE id = %s
            RETURNING attributes, origin
            """,
            (requirement_id,),
        )
        added = cursor.fetchone()
        if added is not None:
            _sync_named_links(
                cursor, organization_id, project_id, control_id, requirement_id,
                [str(item) for item in added[0]] if isinstance(added[0], list) else [],
                "AGENT" if added[1] == "AGENT" else "RULES",
            )  # fmt: skip
        _revise(cursor, plan_id)
    elif change.get("remove") is True:
        cursor.execute(
            "UPDATE evidence_requirements SET pending_change = NULL, needs_review = false, "
            "status = CASE WHEN status = 'REQUESTED' THEN status ELSE 'REMOVED' END, "
            # Out of the plan, it is nobody's accepted request any more (the trigger of
            # migration 0150 clears it on every path; said here where a person decides).
            "accepted_by = CASE WHEN status = 'REQUESTED' THEN accepted_by END, "
            "accepted_at = CASE WHEN status = 'REQUESTED' THEN accepted_at END, "
            "coverage_note = CASE WHEN status = 'REQUESTED' "
            "THEN 'No longer planned; kept because it was already requested.' "
            "ELSE coverage_note END, version = version + 1 WHERE id = %s",
            (requirement_id,),
        )
        _revise(cursor, plan_id)
    else:
        sent = row[1] == "REQUESTED" and row[4] not in ("DRAFT", "CANCELLED")
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET title = %s, description = %s, categories = %s, objective = %s,
                attributes = %s, risk = %s, rationale = %s, necessity = %s,
                period_label = %s, population_kind = %s, sample_selection = %s,
                depends_on = %s, pending_change = NULL, needs_review = false,
                status = CASE WHEN %s THEN
                             CASE WHEN %s::text IS NULL THEN 'PLANNED'
                                  ELSE 'AWAITING_DEPENDENCY' END
                         ELSE status END,
                pbc_request_id = CASE WHEN %s THEN NULL ELSE pbc_request_id END,
                coverage_note = CASE WHEN %s
                    THEN 'Changed after it was requested; requested again.'
                    ELSE coverage_note END,
                version = version + 1
            WHERE id = %s
            """,
            (
                change["title"], change["description"], change["categories"],
                change["objective"], Json(change.get("attributes", [])),
                change.get("risk", ""), change["rationale"], change["necessity"],
                change.get("period_label", ""), change.get("population_kind"),
                change.get("sample_selection", ""), change.get("depends_on"), sent,
                change.get("depends_on"), sent, sent, requirement_id,
            ),
        )  # fmt: skip
        origin = cursor.execute(
            "SELECT origin FROM evidence_requirements WHERE id = %s", (requirement_id,)
        ).fetchone()
        _sync_named_links(
            cursor, organization_id, project_id, control_id, requirement_id,
            [str(item) for item in change.get("attributes", [])],
            "AGENT" if origin is not None and origin[0] == "AGENT" else "RULES",
        )  # fmt: skip
        _revise(cursor, plan_id)
        if not sent and row[3] is not None:
            render_into(cursor, project_id, control_id, UUID(str(row[3])))
    _audit(
        cursor, organization_id, project_id, actor, "evidence_requirement.change_decided",
        "evidence_requirement", requirement_id, {"decision": decision},
    )  # fmt: skip
    return kind


def add_requirement(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: RequirementAdd,
) -> list[UUID]:
    """A person adds evidence the plan did not have. Later runs keep it."""
    if "SAMPLE" in body.categories:
        raise PlanState("sample evidence is requested with the samples the team selects")
    slug = re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")[:40] or "item"
    with transaction(connection) as cursor:
        plan_id, _, _ = _plan_row(cursor, project_id, control_id)
        period = cursor.execute(
            "SELECT period_start, period_end FROM evidence_plan_phases WHERE plan_id = %s "
            "AND phase = %s",
            (plan_id, body.phase),
        ).fetchone()
        key = f"person-{slug}"
        number = 1
        while cursor.execute(
            "SELECT 1 FROM evidence_requirements WHERE engagement_control_id = %s AND phase = %s "
            "AND requirement_key = %s",
            (control_id, body.phase, key),
        ).fetchone():
            number += 1
            key = f"person-{slug[:36]}-{number}"
        row = cursor.execute(
            """
            INSERT INTO evidence_requirements (
                organization_id, project_id, plan_id, engagement_control_id, phase,
                requirement_key, title, description, categories, objective, rationale,
                necessity, period_start, period_end, status, origin
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PLANNED', 'PERSON')
            RETURNING id
            """,
            (
                organization_id, project_id, plan_id, control_id, body.phase, key,
                " ".join(body.title.split()), body.description.strip(), list(body.categories),
                body.objective.strip(), body.rationale.strip(), body.necessity,
                None if period is None else period[0], None if period is None else period[1],
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        attributes = list(dict.fromkeys(body.attribute_ids))
        if attributes:
            approved = cursor.execute(
                "SELECT count(*) FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' AND id = ANY(%s)",
                (control_id, attributes),
            ).fetchone()
            if approved is None or int(approved[0]) != len(attributes):
                # Answered 422 with this sentence; the request is not added.
                raise ValueError("Link only the control's approved attributes.")
            from ai_workforce_api.master_plans import set_requirement_links

            set_requirement_links(
                cursor, organization_id, project_id, control_id, UUID(str(row[0])),
                attributes, None, actor,
            )  # fmt: skip
        _revise(cursor, plan_id)
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.added",
            "evidence_requirement", UUID(str(row[0])),
            {"phase": body.phase, **({"attributes": len(attributes)} if attributes else {})},
        )  # fmt: skip
        # Added by a person: a D&I request is accepted by that act, by them.
        accept_request(cursor, organization_id, project_id, UUID(str(row[0])), actor, "ADD")
        if body.phase == "DESIGN":
            list_decided(cursor, organization_id, project_id, control_id, actor)
        issued = issue(cursor, organization_id, project_id, control_id, actor, "evidence_plan")
        return queue_drafts(cursor, organization_id, project_id, actor, control_id, issued.drafts)


def record_change(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: ControlChangeBody,
) -> None:
    period_end = connection.execute(
        "SELECT period_end FROM engagement_settings WHERE project_id = %s", (project_id,)
    ).fetchone()
    if period_end is not None and period_end[0] is not None and body.effective_on > period_end[0]:
        raise ValueError("the change is after period end")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            INSERT INTO control_changes (
                organization_id, project_id, engagement_control_id, effective_on, kind,
                description, recorded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id, project_id, control_id, body.effective_on, body.kind,
                " ".join(body.description.split()), actor,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        _audit(
            cursor, organization_id, project_id, actor, "control.change_recorded",
            "control_change", UUID(str(row[0])),
            {"kind": body.kind, "effective_on": body.effective_on.isoformat()},
        )  # fmt: skip


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor, action, target_type, target_id, Json(payload)),
    )


# Routes


def with_live_email[T](settings: Settings, result: T) -> T:
    """A route's answer that carries the evidence plan says whether email is on (B1g): one
    place for every route that answers with the plan (here and the D&I requests list's)."""
    from ai_workforce_api.outbound import email_on

    plan = result[0] if isinstance(result, tuple) and result else result
    if isinstance(plan, EvidencePlanBody):
        plan.live_email = email_on(settings)
    return result


def register_evidence_plans(
    app: FastAPI,
    settings: Settings,
    scheduler: Any = None,
    provider: ModelProvider | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"
    control = f"{base}/controls/{{control_id}}"

    def model() -> ModelProvider | None:
        if provider is not None:
            return provider
        return provider_for(settings) if live_model(settings) else None

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            # What the work hands over with after_commit (the drafts of a D&I release
            # that followed the person's change, settled below) goes to the worker once
            # the request has committed.
            return with_live_email(
                settings,
                committed(lambda: _call(settings, lambda connection: work(connection, principal))),
            )
        except PlanState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error) or "plan is invalid") from None

    def drafted(ids: list[UUID]) -> None:
        from ai_workforce_api.pbc_drafting import schedule

        schedule(scheduler, ids)

    def assured_plan(
        c: psycopg.Connection[Any], p: Principal, project_id: UUID, control_id: UUID
    ) -> None:
        """The plan was made again or approved, which may create, remove or reshape D&I
        requests: the assurance chain's checks follow, a request with files and no check
        gets one (docs/evidence-assurance.md)."""
        from ai_workforce_api.evidence_assurance import follow_control

        follow_control(c, project_id, control_id, p.id, scheduler, always=True)

    def assured(
        c: psycopg.Connection[Any], p: Principal, project_id: UUID, control_id: UUID,
        file_id: UUID | None,
    ) -> None:  # fmt: skip
        """A person linked a file to a requirement, or took one off: the assurance chain
        follows (docs/evidence-assurance.md). A file newly in force on a D&I requirement
        gets its run; a run whose file no longer serves its requirement goes out of
        date. Handed to the worker once the request has committed."""
        from ai_workforce_api.after_commit import after_commit
        from ai_workforce_api.evidence_assurance import (
            follow_control,
            queue_safely,
            schedule_assessments,
        )

        if file_id is None:
            follow_control(c, project_id, control_id, p.id, scheduler)
            return
        with transaction(c) as cursor:
            queued = queue_safely(cursor, project_id, file_id, p.id)
        after_commit(lambda: schedule_assessments(scheduler, queued))

    def settled(
        c: psycopg.Connection[Any], p: Principal, organization_id: UUID, project_id: UUID,
        control_id: UUID,
    ) -> None:  # fmt: skip
        """The person's change may have completed the D&I requests list: the D&I evidence
        is then released in this request, for the person of the list's last decision
        (phase_release.settle_design)."""
        from ai_workforce_api.phase_release import settle_design

        settle_design(c, organization_id, project_id, control_id, "REQUEST", p.id, scheduler)

    def planned_again(
        c: psycopg.Connection[Any], p: Principal, organization_id: UUID, project_id: UUID,
        control_id: UUID,
    ) -> None:  # fmt: skip
        """A person planned the evidence again, answered in their request. A run of the
        plan that had stopped (queued longer than the bound, or its lease run out) is
        closed: what it would have done is done, and it holds the D&I list no longer. The
        end of the planning may then be the last thing the list waited for, as the end of
        a run is: the release, if any, is for the person of the list's last decision."""
        from ai_workforce_api.phase_release import settle_design

        with transaction(c) as cursor:
            cursor.execute(
                f"""
                UPDATE evidence_plans p
                SET run_status = 'IDLE', run_lease_until = NULL, run_stage = '',
                    run_note = 'Planned again by a person; the run that had stopped was closed.'
                WHERE p.project_id = %s AND p.engagement_control_id = %s
                  AND p.run_status IN ('PENDING', 'WORKING')
                  AND NOT coalesce({PLAN_RUN_LIVE_SQL}, false)
                """,
                (project_id, control_id),
            )
        settle_design(c, organization_id, project_id, control_id, "PLAN_RUN", p.id, scheduler)

    def allowed(
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        action: Action = Action.TASK_UPDATE,
    ) -> None:
        authorize(
            connection,
            principal=principal,
            action=action,
            organization_id=organization_id,
            project_id=project_id,
        )
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            raise NotVisible()
        found = connection.execute(
            "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s "
            "AND organization_id = %s",
            (control_id, project_id, organization_id),
        ).fetchone()
        if found is None:
            raise NotVisible()
        if action is not Action.TASK_READ and not found[0]:
            raise PlanState("the control is out of scope")

    @app.get(f"{control}/evidence-plan")
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> EvidencePlanBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_READ)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/generate")
    def plan(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> EvidencePlanBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            _, drafts, note = generate(c, model(), organization_id, project_id, control_id, p.id)
            drafted(drafts)
            planned_again(c, p, organization_id, project_id, control_id)
            assured_plan(c, p, project_id, control_id)
            body = plan_body(c, project_id, control_id)
            return body.model_copy(update={"note": note or body.note})

        return run(request, work)

    @app.post(f"{control}/evidence-plan/reconcile")
    def reconcile_draft(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ReconcileBody,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(reconcile(c, organization_id, project_id, control_id, p.id, body))
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/request-planned")
    def request_planned(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> RequestedPlanned:
        """Request the control's planned evidence that was never requested (the New
        Request drawer's recommendation). The evidence coordinator drafts the wording; a
        person still reviews and approves each request."""

        def work(c: psycopg.Connection[Any], p: Principal) -> RequestedPlanned:
            allowed(c, p, organization_id, project_id, control_id)
            if (
                c.execute(
                    "SELECT 1 FROM evidence_plans WHERE project_id = %s "
                    "AND engagement_control_id = %s",
                    (project_id, control_id),
                ).fetchone()
                is None
            ):
                raise PlanState("plan the evidence first")
            with transaction(c) as cursor:
                issued = issue(cursor, organization_id, project_id, control_id, p.id,
                               "evidence_plan")  # fmt: skip
                drafts = queue_drafts(
                    cursor, organization_id, project_id, p.id, control_id, issued.drafts
                )
            drafted(drafts)
            return RequestedPlanned(requested=len(issued.created), request_ids=issued.created)

        return run(request, work)

    @app.post(f"{base}/evidence-plans/plan-missing")
    def plan_unplanned(organization_id: UUID, project_id: UUID, request: Request) -> PlannedMissing:
        def work(c: psycopg.Connection[Any], p: Principal) -> PlannedMissing:
            authorize(
                c, principal=p, action=Action.TASK_UPDATE,
                organization_id=organization_id, project_id=project_id,
            )  # fmt: skip
            if p.kind is not PrincipalKind.USER:
                raise NotVisible()
            status = c.execute(
                "SELECT status FROM projects WHERE id = %s AND organization_id = %s",
                (project_id, organization_id),
            ).fetchone()
            if status is None:
                raise NotVisible()
            if status[0] != "ACTIVE":
                raise PlanState("the engagement is not running")
            result, drafts = plan_missing(c, organization_id, project_id, p.id)
            drafted(drafts)
            return result

        return run(request, work)

    from ai_workforce_api.master_plans import ApproveBody
    from ai_workforce_api.master_plans import approve as approve_master_plan

    @app.post(f"{control}/evidence-plan/approve")
    def approve_plan(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ApproveBody,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        """A person who may approve (project.update) approves the master test plan's
        current revision, with its attributes. Then what the gate allows is requested, and
        testing that waited for the approval runs."""

        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            from ai_workforce_api.readiness import resume_testing
            from ai_workforce_api.testing_engine import TestScheduler, schedule_runs

            allowed(c, p, organization_id, project_id, control_id, Action.PROJECT_UPDATE)
            filled = approve_master_plan(c, organization_id, project_id, control_id, p.id, body)
            tests = scheduler if isinstance(scheduler, TestScheduler) else None
            drafted(release(c, organization_id, project_id, control_id, p.id))
            schedule_runs(tests, resume_testing(c, project_id, control_id))
            # Values answered with the approval may also fill other controls that asked
            # for them: their own requests and testing follow, as a values change does.
            for other in filled:
                drafted(release(c, organization_id, project_id, other, p.id))
                schedule_runs(tests, resume_testing(c, project_id, other))
            assured_plan(c, p, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/phases/{{phase}}")
    def phase_decision(
        organization_id: UUID, project_id: UUID, control_id: UUID, phase: Phase,
        body: PhaseDecision, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(decide_phase(c, organization_id, project_id, control_id, phase, p.id, body))
            # A phase a person decided may be the last thing the D&I list waited for.
            from ai_workforce_api.phase_release import settle_design

            settle_design(
                c, organization_id, project_id, control_id, "PHASE_DECISION", p.id, scheduler
            )
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-requirements")
    def add(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: RequirementAdd,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(add_requirement(c, organization_id, project_id, control_id, p.id, body))
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    requirement = f"{control}/evidence-requirements/{{requirement_id}}"

    @app.post(f"{requirement}/sufficiency")
    def sufficiency(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: SufficiencyBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> tuple[EvidencePlanBody, list[UUID]]:
            allowed(c, p, organization_id, project_id, control_id)
            queued = set_sufficiency(
                c, organization_id, project_id, control_id, requirement_id, p.id, body
            )
            return plan_body(c, project_id, control_id), queued

        from ai_workforce_api.workpaper_service import schedule_drafts

        result, queued = run(request, work)
        schedule_drafts(scheduler, queued)
        return result

    @app.post(f"{requirement}/files")
    def link_requirement_file(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: LinkBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            link_file(c, organization_id, project_id, control_id, requirement_id, p.id, body)
            assured(c, p, project_id, control_id, body.file_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/files/{{link_id}}/remove")
    def unlink_requirement_file(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        link_id: UUID, body: UnlinkBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            unlink_file(
                c, organization_id, project_id, control_id, requirement_id, link_id, p.id, body
            )
            assured(c, p, project_id, control_id, None)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/waive")
    def waive_requirement(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: WaiveBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            waive(c, organization_id, project_id, control_id, requirement_id, p.id, body)
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/restore")
    def restore_requirement(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: VersionBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(restore(c, organization_id, project_id, control_id, requirement_id, p.id, body))
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/remove")
    def remove_requirement(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: VersionBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            remove(c, organization_id, project_id, control_id, requirement_id, p.id, body)
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/edit")
    def edit_requirement(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: EditBody, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            edit(c, organization_id, project_id, control_id, requirement_id, p.id, body)
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{requirement}/change")
    def change_decision(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: ChangeDecision, request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            drafted(
                decide_change(
                    c, organization_id, project_id, control_id, requirement_id, p.id, body
                )
            )
            settled(c, p, organization_id, project_id, control_id)
            return plan_body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/control-changes")
    def change(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ControlChangeBody,
        request: Request,
    ) -> EvidencePlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> EvidencePlanBody:
            allowed(c, p, organization_id, project_id, control_id)
            record_change(c, organization_id, project_id, control_id, p.id, body)
            # The plan follows the change: affected phases, periods, and evidence.
            _, drafts, note = generate(c, model(), organization_id, project_id, control_id, p.id)
            drafted(drafts)
            planned_again(c, p, organization_id, project_id, control_id)
            assured_plan(c, p, project_id, control_id)
            body_out = plan_body(c, project_id, control_id)
            return body_out.model_copy(update={"note": note or body_out.note})

        return run(request, work)
