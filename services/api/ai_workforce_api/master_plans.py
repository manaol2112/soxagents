"""Master test plans: a control's plan, reviewed and approved by a person as one version.

A control's evidence plan is its master test plan, in four sections:

1. **Understanding of the control**: the control's own facts (its description, risk,
   frequency, nature, application) and the planner's understanding (summary, type, risks,
   dependencies, missing information, assumptions).
2. **Test procedures**, per phase, each with a code (D1 for design, I1 for interim, R1
   for the roll-forward).
3. **Test attributes**: the control's approved attributes, each with a code (A1), the
   condition tested, and how it passes or fails.
4. **Required evidence**: the plan's requirements, each with a code (E1).

The sections are linked by identity, many to many (migration 0079): a procedure to the
attributes it tests, a requirement to the attributes it supports and the procedures it
serves. What does not link up is a finding the reviewer sees and the decision records.

A person decides each version: approve it, or request changes with a comment. The
decision is kept, unchangeable, with a hashed copy of the plan as the reviewer saw it
(`plan_versions`, `plan_decisions`). Approving the plan approves the control's
attributes with it (decided by the product owner). Nothing downstream runs on a plan no
person approved: requests are drafted, approved, and sent, samples approved, and testing
run and signed off only while the current revision is approved (`evidence_plans.gate_reason`,
`readiness`). A material change to an approved plan sends it back for review; the
database refuses an approved plan whose approved revision is not its current one.

The planner never approves its own plan, and a later run never changes an approved plan:
its changes wait for the reviewer (`evidence_plans.persist`).
"""

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

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
from ai_workforce_api.control_design import (
    OpenValueBody,
    open_values,
    open_values_by_control,
)
from ai_workforce_api.controls import BY_KEY, DOMAIN_LABELS, FREQUENCIES, basis_of
from ai_workforce_api.db import transaction
from ai_workforce_api.definition_registry import BY_LIBRARY_KEY, attribute_for
from ai_workforce_api.evidence_planning import PHASE_LABELS, PHASES, Phase
from ai_workforce_api.evidence_plans import (
    ATTRIBUTES_SETTLED_SQL,
    PlanState,
    _audit,
    release,
)
from ai_workforce_api.implementations import CoverageBody, Scope, ScopeUnit, SplitBody, UnitCreate
from ai_workforce_api.library_governance import Category, category_for, effective_status
from ai_workforce_api.settings import Settings
from ai_workforce_api.shared_plans import FamiliesBody, GroupApproveBody, GroupResult

# Planning states, derived from the records (never stored).
PlanningState = Literal[
    "NOT_STARTED",
    "ANALYZING",
    "NEEDS_CLARIFICATION",
    "DRAFT_READY",
    "PENDING_REVIEW",
    "APPROVED",
    "CHANGES_REQUESTED",
]
PLANNING_STATES: tuple[PlanningState, ...] = (
    "NOT_STARTED",
    "ANALYZING",
    "NEEDS_CLARIFICATION",
    "DRAFT_READY",
    "PENDING_REVIEW",
    "APPROVED",
    "CHANGES_REQUESTED",
)
STATE_LABELS: dict[str, str] = {
    "NOT_STARTED": "Not started",
    "ANALYZING": "Analyzing",
    "NEEDS_CLARIFICATION": "Needs clarification",
    "DRAFT_READY": "Draft ready",
    "PENDING_REVIEW": "Pending review",
    "APPROVED": "Approved",
    "CHANGES_REQUESTED": "Changes requested",
}
APPROVED_STATUSES = ("APPROVED", "CHANGES_PROPOSED")
METHODS = (
    "INQUIRY",
    "OBSERVATION",
    "INSPECTION",
    "REPERFORMANCE",
    "RECALCULATION",
    "COMPARISON",
    "WALKTHROUGH",
)
Method = Literal[
    "INQUIRY",
    "OBSERVATION",
    "INSPECTION",
    "REPERFORMANCE",
    "RECALCULATION",
    "COMPARISON",
    "WALKTHROUGH",
]
FindingKind = Literal[
    "PROCEDURE_WITHOUT_ATTRIBUTE",
    "ATTRIBUTE_WITHOUT_PROCEDURE",
    "ATTRIBUTE_WITHOUT_EVIDENCE",
    "EVIDENCE_WITHOUT_ATTRIBUTE",
    "UNMATCHED_ATTRIBUTE",
    "ATTRIBUTE_WITHOUT_CRITERIA",
    "ATTRIBUTE_NOT_DOCUMENTED",
    "DEVIATES_FROM_STANDARD",
]
BlockerKind = Literal["CLARIFICATION", "DECISION"]
# Where a blocker is resolved, so the review can open that place: the control's own record
# (its description and frequency), its attributes, its process, the client's values its
# statement needs, the plan's understanding, whether its phases apply, the proposed changes
# to its evidence, the planner's proposed revision, or nowhere while the planner drafts.
BlockerResolve = Literal[
    "FACTS",
    "CONTROL",
    "ATTRIBUTES",
    "PROCESS",
    "VALUES",
    "UNDERSTANDING",
    "PHASES",
    "EVIDENCE_CHANGES",
    "REVISION",
    "LIBRARY",
    "WAIT",
]
SNAPSHOT_SCHEMA = 1


def _normal(text: str) -> str:
    return " ".join(text.split()).lower()


def standard_procedure_key(library_key: str, text: str) -> str:
    """The key of the standard's procedure a plan procedure is, when the standard is
    written as steps (library version 4) and the plan's text is that procedure's action;
    the plan review links the row to the steps on the Library. Empty otherwise."""
    definition = BY_LIBRARY_KEY.get(library_key)
    found = None if definition is None else definition.procedure_for(text)
    return "" if found is None or not found.steps else found.key


def procedure_key(phase: str, text: str) -> str:
    """Stable across runs: the phase and a hash of the wording (as migration 0079)."""
    return f"{phase.lower()}-{hashlib.md5(_normal(text).encode()).hexdigest()[:12]}"


# Loading: every control of a project (or one) in a fixed number of queries.


@dataclass
class _Plan:
    control_id: UUID
    control_ref: str
    title: str
    risk: str
    activity: str
    frequency: str
    nature: str
    domain: str
    key_control: bool
    library_key: str
    application: str
    classifications: list[str]
    included: bool
    # Where the control's own facts come from: RCM (the client's RCM) or the library.
    source: str = ""
    # The library statement with the client's values, by field (evidence_plans.statement_fields).
    statement: dict[str, str] = field(default_factory=dict)
    # Facts the team stated for a client's own control (migration 0088), by fact.
    stated: dict[str, dict[str, Any]] = field(default_factory=dict)
    plan_id: UUID | None = None
    status: str = ""
    run_status: str = "IDLE"
    revision: int = 0
    approved_revision: int | None = None
    version: int = 0
    understanding: dict[str, Any] = field(default_factory=dict)
    provisional: bool = False
    pending_revision: dict[str, Any] | None = None
    # The words each current attribute had before it was reworded (its replaces chain), so
    # evidence planned with the earlier words still names it (28 October 2026).
    former_wordings: list[str] = field(default_factory=list)
    submitted_by: str | None = None
    submitted_at: datetime | None = None
    submitted_note: str = ""
    phases: list[dict[str, Any]] = field(default_factory=list)
    procedures: list[dict[str, Any]] = field(default_factory=list)
    procedure_attributes: dict[UUID, set[UUID]] = field(default_factory=dict)
    attributes: list[dict[str, Any]] = field(default_factory=list)
    proposed_attributes: int = 0
    requirements: list[dict[str, Any]] = field(default_factory=list)
    requirement_attributes: dict[UUID, set[UUID]] = field(default_factory=dict)
    requirement_procedures: dict[UUID, set[UUID]] = field(default_factory=dict)
    pending_changes: int = 0
    open_issues: list[tuple[str, str, str, str]] = field(default_factory=list)
    values_missing: list[tuple[str, str]] = field(default_factory=list)
    last_decision: dict[str, Any] | None = None
    # What the plan is built from (controls.basis_of), and the firm's methodology review of
    # the standard it follows (library_governance.effective_status).
    test_basis: str = "STANDARD"
    library_status: str = ""
    # The business process the team named for the control, if any (migration 0059).
    process: str = ""
    # The units the control operates in, when split by them (Release 1): shown with the
    # system; never part of the plan's content or fingerprint.
    units: str = ""


def _load(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> dict[UUID, _Plan]:
    """Every in-scope control of the project with its plan, or one control (in scope or
    not) when `control_id` is given."""
    one = control_id is not None
    where = "c.project_id = %(p)s AND " + ("c.id = %(c)s" if one else "c.included")
    params = {"p": project_id, "c": control_id}
    plans: dict[UUID, _Plan] = {}
    for row in connection.execute(
        f"""
        SELECT c.id, c.control_ref, c.title, coalesce(c.risk, ''), coalesce(c.activity, ''),
               coalesce(c.frequency, ''), coalesce(c.nature, ''), c.domain,
               coalesce(c.key_control, false), coalesce(c.library_key, ''),
               coalesce(a.name, ''), coalesce(c.classifications, '{{}}'), c.included,
               coalesce(c.source, ''), c.test_basis, e.status, e.approved_version,
               coalesce(pr.name, ''), c.stated_facts
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN engagement_processes pr ON pr.id = c.process_id
        LEFT JOIN library_entries e
          ON e.organization_id = c.organization_id AND e.library_key = c.library_key
        WHERE {where}
        ORDER BY c.control_ref, a.name
        """,
        params,
    ).fetchall():
        plans[UUID(str(row[0]))] = _Plan(
            control_id=UUID(str(row[0])), control_ref=str(row[1]), title=str(row[2]),
            risk=str(row[3]), activity=str(row[4]), frequency=str(row[5]),
            nature=str(row[6]), domain=str(row[7]), key_control=bool(row[8]),
            library_key=str(row[9]), application=str(row[10]),
            classifications=[str(item) for item in row[11]], included=bool(row[12]),
            source=str(row[13]), test_basis=basis_of(str(row[13]), row[14]),
            library_status=effective_status(
                None if row[15] is None else str(row[15]), row[16], str(row[9])
            ),
            process=str(row[17]),
            stated={
                str(name): fact for name, fact in (row[18] or {}).items()
                if isinstance(fact, dict) and str(fact.get("value", "")).strip()
            },
        )  # fmt: skip
    if not plans:
        return plans
    from ai_workforce_api.implementations import operating_names

    for found_id, names in operating_names(connection, project_id).items():
        if found_id in plans:
            plans[found_id].units = names
    scope = "project_id = %(p)s" + (" AND engagement_control_id = %(c)s" if one else "")
    by_plan: dict[UUID, _Plan] = {}
    for row in connection.execute(
        f"""
        SELECT p.engagement_control_id, p.id, p.status, p.run_status, p.revision,
               p.approved_revision, p.version, p.understanding, p.provisional,
               p.pending_revision, u.display_name, p.submitted_at, p.submitted_note
        FROM evidence_plans p LEFT JOIN users u ON u.id = p.submitted_by
        WHERE p.{scope}
        """,
        params,
    ).fetchall():
        found = plans.get(UUID(str(row[0])))
        if found is None:
            continue
        found.plan_id = UUID(str(row[1]))
        found.status, found.run_status = str(row[2]), str(row[3])
        found.revision, found.approved_revision = int(row[4]), row[5]
        found.version = int(row[6])
        found.understanding = dict(row[7]) if isinstance(row[7], dict) else {}
        found.provisional = bool(row[8])
        found.pending_revision = row[9] if isinstance(row[9], dict) else None
        found.submitted_by = None if row[10] is None else str(row[10])
        found.submitted_at, found.submitted_note = row[11], str(row[12])
        by_plan[found.plan_id] = found
    for row in connection.execute(
        f"""
        SELECT plan_id, phase, applicability, rationale, condition, open_question,
               objectives, period_start, period_end, origin, version
        FROM evidence_plan_phases WHERE {scope}
        """,
        params,
    ).fetchall():
        if (found := by_plan.get(UUID(str(row[0])))) is not None:
            found.phases.append(
                {
                    "phase": str(row[1]), "applicability": str(row[2]),
                    "rationale": str(row[3]), "condition": str(row[4]),
                    "open_question": str(row[5]), "objectives": [str(i) for i in row[6]],
                    "period_start": row[7], "period_end": row[8], "origin": str(row[9]),
                    "version": int(row[10]),
                }
            )  # fmt: skip
    for found in by_plan.values():
        found.phases.sort(key=lambda item: PHASES.index(item["phase"]))
    for row in connection.execute(
        f"""
        SELECT plan_id, id, code, phase, text, method, origin, person_edited, version
        FROM plan_procedures WHERE {scope} AND status = 'ACTIVE'
        ORDER BY array_position(ARRAY['DESIGN', 'INTERIM', 'ROLLFORWARD'], phase), position,
                 created_at
        """,
        params,
    ).fetchall():
        if (found := by_plan.get(UUID(str(row[0])))) is not None:
            found.procedures.append(
                {
                    "id": UUID(str(row[1])), "code": str(row[2]), "phase": str(row[3]),
                    "text": str(row[4]), "method": row[5], "origin": str(row[6]),
                    "person_edited": bool(row[7]), "version": int(row[8]),
                }
            )  # fmt: skip
    for row in connection.execute(
        f"SELECT engagement_control_id, procedure_id, attribute_id "
        f"FROM plan_procedure_attributes WHERE {scope}",
        params,
    ).fetchall():
        if (found := plans.get(UUID(str(row[0])))) is not None:
            found.procedure_attributes.setdefault(UUID(str(row[1])), set()).add(UUID(str(row[2])))
    for row in connection.execute(
        f"""
        SELECT engagement_control_id, id, code, text, status, basis, source_kind,
               source_quote, definition_key, objective, condition, pass_criteria,
               fail_criteria, judgment_required, automatable, phases, version, criteria_origin,
               criteria_accepted_at,
               (SELECT display_name FROM users WHERE users.id = criteria_accepted_by)
        FROM control_attributes WHERE {scope} AND status IN ('APPROVED', 'PROPOSED')
        ORDER BY position, created_at
        """,
        params,
    ).fetchall():
        found = plans.get(UUID(str(row[0])))
        if found is None:
            continue
        if row[4] == "PROPOSED":
            found.proposed_attributes += 1
            continue
        found.attributes.append(
            {
                "id": UUID(str(row[1])), "code": str(row[2] or ""), "text": str(row[3]),
                "basis": str(row[5]), "source": str(row[6]), "quote": str(row[7]),
                "definition_key": None if row[8] is None else str(row[8]),
                "objective": str(row[9]), "condition": str(row[10]),
                "pass_criteria": str(row[11]), "fail_criteria": str(row[12]),
                "judgment_required": row[13], "automatable": row[14],
                "phases": [str(item) for item in row[15]], "version": int(row[16]),
                "criteria_origin": None if row[17] is None else str(row[17]),
                "criteria_accepted_at": row[18],
                "criteria_accepted_by": str(row[19] or ""),
            }
        )  # fmt: skip
    # Each current attribute's earlier wordings: the attributes it replaced, and theirs.
    chains: dict[UUID, dict[UUID, tuple[UUID | None, str]]] = {}
    for row in connection.execute(
        f"SELECT engagement_control_id, id, replaces_id, text FROM control_attributes "
        f"WHERE {scope}",
        params,
    ).fetchall():
        chains.setdefault(UUID(str(row[0])), {})[UUID(str(row[1]))] = (
            None if row[2] is None else UUID(str(row[2])),
            str(row[3]),
        )
    for control_id, found in plans.items():
        rows = chains.get(control_id, {})
        for item in found.attributes:
            seen: set[UUID] = {item["id"]}
            earlier = rows.get(item["id"], (None, ""))[0]
            while earlier is not None and earlier not in seen and earlier in rows:
                seen.add(earlier)
                earlier, text = rows[earlier]
                found.former_wordings.append(text)
    for row in connection.execute(
        f"""
        SELECT q.engagement_control_id, q.id, q.code, q.phase, q.requirement_key, q.title,
               q.description, q.categories, q.objective, q.necessity, q.population_kind,
               q.sample_selection, q.depends_on, q.status, q.attributes, q.origin,
               q.person_edited, q.pending_change IS NOT NULL, q.version, q.period_label,
               coalesce((q.pending_change ->> 'add')::boolean, false)
        FROM evidence_requirements q WHERE q.{scope} AND q.status <> 'REMOVED'
        ORDER BY array_position(ARRAY['DESIGN', 'INTERIM', 'ROLLFORWARD'], q.phase), q.code
        """,
        params,
    ).fetchall():
        found = plans.get(UUID(str(row[0])))
        if found is None:
            continue
        if row[17]:
            found.pending_changes += 1
        if row[20]:
            # Proposed for an approved plan and not accepted yet: not part of the plan.
            continue
        found.requirements.append(
            {
                "id": UUID(str(row[1])), "code": str(row[2]), "phase": str(row[3]),
                "key": str(row[4]), "title": str(row[5]), "description": str(row[6]),
                "categories": [str(i) for i in row[7]], "objective": str(row[8]),
                "necessity": str(row[9]), "population_kind": row[10],
                "sample_selection": str(row[11]), "depends_on": row[12],
                "status": str(row[13]),
                "named": [str(i) for i in row[14]] if isinstance(row[14], list) else [],
                "origin": str(row[15]), "person_edited": bool(row[16]),
                "version": int(row[18]), "period_label": str(row[19]),
            }
        )  # fmt: skip
    for row in connection.execute(
        f"SELECT engagement_control_id, requirement_id, attribute_id "
        f"FROM evidence_requirement_attributes WHERE {scope}",
        params,
    ).fetchall():
        if (found := plans.get(UUID(str(row[0])))) is not None:
            found.requirement_attributes.setdefault(UUID(str(row[1])), set()).add(UUID(str(row[2])))
    for row in connection.execute(
        f"SELECT engagement_control_id, requirement_id, procedure_id "
        f"FROM evidence_requirement_procedures WHERE {scope}",
        params,
    ).fetchall():
        if (found := plans.get(UUID(str(row[0])))) is not None:
            found.requirement_procedures.setdefault(UUID(str(row[1])), set()).add(UUID(str(row[2])))
    if plans:
        from ai_workforce_api.library_definitions import retire_dropped_design_questions

        retire_dropped_design_questions(connection, list(plans))
    for row in connection.execute(
        f"""
        SELECT engagement_control_id, origin, kind, topic || ': ' || detail
        FROM control_context_issues WHERE {scope} AND status = 'OPEN' ORDER BY created_at
        """,
        params,
    ).fetchall():
        if (found := plans.get(UUID(str(row[0])))) is not None:
            found.open_issues.append((str(row[1]), str(row[2]), str(row[3]), ""))
    for row in connection.execute(
        f"""
        SELECT DISTINCT ON (d.plan_id) d.plan_id, d.decision, d.comment, u.display_name,
               d.decided_at, d.revision
        FROM plan_decisions d JOIN users u ON u.id = d.decided_by
        WHERE d.{scope}
        ORDER BY d.plan_id, d.decided_at DESC
        """,
        params,
    ).fetchall():
        if (found := by_plan.get(UUID(str(row[0])))) is not None:
            found.last_decision = {
                "decision": str(row[1]), "comment": str(row[2]), "by": str(row[3]),
                "at": row[4], "revision": int(row[5]),
            }  # fmt: skip
    from ai_workforce_api.control_design import missing_values
    from ai_workforce_api.evidence_plans import statement_fields

    for found in plans.values():
        if found.library_key:
            found.statement = dict(statement_fields(connection, found.control_id))
    for cid, missing in missing_values(connection, project_id).items():
        if (found := plans.get(cid)) is not None:
            found.values_missing = missing
    return plans


# The plan's sections, its findings, what holds its approval, and its state.


def _criteria(plan: _Plan, attribute: dict[str, Any]) -> dict[str, Any]:
    """An attribute's criteria: the plan's own, or else the library definition's."""
    definition = attribute_for(plan.library_key, attribute["definition_key"] or "",
                               attribute["text"])  # fmt: skip
    own = any(attribute[k] for k in ("condition", "pass_criteria", "fail_criteria"))
    stated = "AGENT" if attribute.get("criteria_origin") == "AGENT" else "PLAN"
    return {
        "objective": attribute["objective"] or ("" if definition is None else definition.why),
        "condition": attribute["condition"]
        or ("" if definition is None or own else definition.condition),
        "pass_criteria": attribute["pass_criteria"]
        or ("" if definition is None or own else definition.passes),
        "fail_criteria": attribute["fail_criteria"]
        or ("" if definition is None or own else definition.fails),
        "criteria_source": stated if own else "LIBRARY" if definition is not None else "NONE",
    }


# The understanding of the control, fact by fact (milestone B). Built from the records
# every time it is read, so it never drifts from them: each fact says where it comes from
# and quotes it; what no record states is missing, with the question that settles it. The
# planner agent may propose a value for a missing fact; it stays a proposal, and the
# question stays open for the reviewer.

FactKind = Literal["SOURCE", "PROPOSED", "JUDGMENT", "ASSUMPTION", "MISSING"]
FACT_LABELS: dict[str, str] = {
    "OBJECTIVE": "Control objective",
    "RISK": "Risk addressed",
    "DESCRIPTION": "Description and operation",
    "NATURE": "Manual or automated",
    "TYPE": "Preventive or detective",
    "FREQUENCY": "Frequency",
    "PERFORMER": "Performed by",
    "REVIEWER": "Reviewed or approved by",
    "SYSTEM": "System or application",
    "POPULATION": "Population covered",
    "ASSERTIONS": "Assertions or IT risks",
    "DEPENDENCIES": "Dependencies (reports, interfaces, configurations, ITGCs)",
}
# The facts the team states for a client's own control (migration 0088): a library
# control takes them from its statement and definition.
STATEABLE_FACTS: tuple[str, ...] = (
    "OBJECTIVE", "TYPE", "PERFORMER", "REVIEWER", "POPULATION", "ASSERTIONS", "DEPENDENCIES",
)  # fmt: skip
_NATURE_WORDS = {
    "MANUAL": "Manual",
    "AUTOMATED": "Automated",
    "IT_DEPENDENT_MANUAL": "IT-dependent manual",
}
_SYSTEM_AREAS = ("ACCESS", "CHANGE", "OPERATIONS", "ITAC", "IPE")


class FactItem(BaseModel):
    field: str
    label: str
    value: str
    basis: FactKind
    # Where it comes from: the client's RCM, the control record, the library's statement or
    # definition, the planner agent, or nothing.
    source: str
    quote: str
    # For a missing fact, or a proposal for one: what a person answers.
    question: str


def facts_of(plan: _Plan) -> list[FactItem]:
    from ai_workforce_api.controls import NATURES
    from ai_workforce_api.definition_registry import BY_LIBRARY_KEY

    record = "Client RCM" if plan.source == "RCM" else "Control record"
    statement = plan.statement
    definition = BY_LIBRARY_KEY.get(plan.library_key) if statement else None
    found: dict[str, FactItem] = {}

    def put(
        name: str, value: str, basis: FactKind, source: str, quote: str = "", question: str = ""
    ) -> None:
        found[name] = FactItem(
            field=name, label=FACT_LABELS[name], value=" ".join(value.split())[:600],
            basis=basis, source=source, quote=" ".join(quote.split())[:500], question=question,
        )  # fmt: skip

    def missing(name: str, question: str, value: str = "") -> None:
        put(name, value, "MISSING", "None", question=question)

    if plan.activity.strip():
        put("DESCRIPTION", plan.activity, "SOURCE", record, plan.activity)
    else:
        missing("DESCRIPTION", "What does the control do: who performs it, on what, and how?")
    if plan.risk.strip():
        put("RISK", plan.risk, "SOURCE", record, plan.risk)
    elif statement.get("risk"):
        put("RISK", statement["risk"], "SOURCE", "Library statement", statement["risk"])
    else:
        missing("RISK", "What could go wrong that the control addresses?")
    if definition is not None and definition.objective:
        put("OBJECTIVE", definition.objective, "SOURCE", "Library definition",
            definition.objective)  # fmt: skip
    elif found["RISK"].basis == "SOURCE":
        put("OBJECTIVE", f"Address the risk: {found['RISK'].value}", "PROPOSED", "Planner",
            question="Confirm the control objective.")  # fmt: skip
    else:
        missing("OBJECTIVE", "What is the control meant to achieve?")
    if plan.nature in NATURES:
        put("NATURE", _NATURE_WORDS.get(plan.nature, plan.nature), "SOURCE", record, plan.nature)
    else:
        missing("NATURE", "Is the control manual, automated, or IT-dependent manual?")
    if statement.get("type"):
        put("TYPE", statement["type"].capitalize(), "SOURCE", "Library statement",
            statement["type"])  # fmt: skip
    else:
        missing("TYPE", "Does the control prevent the error, or detect it after the fact?")
    if plan.frequency in FREQUENCIES:
        put("FREQUENCY", plan.frequency.replace("_", " ").capitalize(), "SOURCE", record,
            plan.frequency)  # fmt: skip
    else:
        missing("FREQUENCY", "How often does the control operate?")
    for name, key, question in (
        ("PERFORMER", "performer", "Who performs the control at the client?"),
        ("REVIEWER", "reviewer", "Who reviews or approves the control's operation, if anyone?"),
    ):
        text = statement.get(key, "")
        if text and "[" in text:
            # The library's design, with a client value not recorded yet.
            missing(name, f"{question} ({text})", text)
        elif text:
            put(name, text, "SOURCE", "Library statement", text)
        elif statement and name == "REVIEWER":
            put(name, "No separate reviewer in the documented design.", "SOURCE",
                "Library statement")  # fmt: skip
        elif name == "REVIEWER" and plan.nature == "AUTOMATED":
            put(name, "Not applicable: the system performs the control.", "JUDGMENT", "Planner")
        else:
            missing(name, question)
    if plan.application:
        put("SYSTEM", plan.application, "SOURCE", "Control record", plan.application)
    elif plan.domain in _SYSTEM_AREAS:
        missing("SYSTEM", "Which system does the control operate in?")
    else:
        put("SYSTEM", "Not tied to one system.", "JUDGMENT", "Planner")
    profile = str(plan.understanding.get("control_type") or "")
    if definition is not None and definition.population:
        put("POPULATION", definition.population, "SOURCE", "Library definition",
            definition.population)  # fmt: skip
    elif profile == "CONFIGURATION":
        put("POPULATION", "No transaction population: tested from the configuration.",
            "JUDGMENT", "Planner")  # fmt: skip
    else:
        kinds = sorted(
            {str(item["population_kind"]) for item in plan.requirements if item["population_kind"]}
        )
        if kinds:
            put("POPULATION", ", ".join(k.replace("_", " ").lower() for k in kinds).capitalize(),
                "PROPOSED", "Planner", question="Confirm what the population lists.")  # fmt: skip
        else:
            missing("POPULATION", "What population of instances or transactions does the "
                    "control cover?")  # fmt: skip
    assertions = statement.get("assertions") or statement.get("it_risk", "")
    if assertions:
        put("ASSERTIONS", assertions, "SOURCE", "Library statement", assertions)
    else:
        missing("ASSERTIONS", "Which financial statement assertions or IT risks does the "
                "control address?")  # fmt: skip
    documented = "; ".join(t for t in (statement.get("information"), statement.get("itgcs")) if t)
    planned = [str(item) for item in plan.understanding.get("dependencies") or []]
    if documented:
        put("DEPENDENCIES", documented, "SOURCE", "Library statement", documented)
    elif planned:
        put("DEPENDENCIES", "; ".join(planned), "PROPOSED", "Planner",
            question="Confirm the reports, interfaces, and configurations used.")  # fmt: skip
    else:
        put("DEPENDENCIES", "None identified.", "JUDGMENT", "Planner")
    # What the team stated for a client's own control (migration 0088) is the fact.
    for name, told in plan.stated.items():
        if name in STATEABLE_FACTS:
            by = str(told.get("by_name") or "the team")
            put(name, str(told["value"]), "SOURCE", f"Stated by {by}", str(told["value"]))
    # The planner agent's proposal for what the records leave missing.
    for raw in plan.understanding.get("facts") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("field", ""))
        current = found.get(name)
        if current is None or current.basis != "MISSING":
            continue
        stated = str(raw.get("basis", "PROPOSED"))
        basis: FactKind = (
            "JUDGMENT" if stated == "JUDGMENT" else "ASSUMPTION" if stated == "ASSUMPTION"
            else "PROPOSED"
        )  # fmt: skip
        put(
            name, str(raw.get("value", "")), basis,
            "Planner agent", str(raw.get("quote", "")),
            question=current.question or "Confirm the planner's proposal.",
        )  # fmt: skip
    return [found[name] for name in FACT_LABELS if name in found]


def content(plan: _Plan) -> dict[str, Any]:
    """The plan as a reviewer approves it: its four sections and the links between them,
    by code. Hashed and stored with every decision."""
    attribute_code = {item["id"]: item["code"] for item in plan.attributes}
    procedure_code = {item["id"]: item["code"] for item in plan.procedures}

    def codes(ids: set[UUID], names: dict[UUID, str]) -> list[str]:
        return sorted(names[i] for i in ids if i in names)

    understanding = {
        key: plan.understanding.get(key)
        for key in (
            "summary", "control_type", "classification", "risks", "attributes",
            "dependencies", "missing_information", "assumptions", "exceptions",
            "approvals_required", "process_understanding_needed",
            "process_understanding_reason",
        )
        if key in plan.understanding
    }  # fmt: skip
    return {
        "schema": SNAPSHOT_SCHEMA,
        "revision": plan.revision,
        "control": {
            "control_ref": plan.control_ref,
            "title": plan.title,
            "description": plan.activity,
            "risk": plan.risk,
            "frequency": plan.frequency,
            "nature": plan.nature,
            "area": plan.domain,
            "key_control": plan.key_control,
            "application": plan.application,
            "classifications": sorted(plan.classifications),
        },  # fmt: skip
        "understanding": understanding,
        "facts": [item.model_dump() for item in facts_of(plan)],
        "provisional": plan.provisional,
        "phases": [
            {
                "phase": item["phase"],
                "applicability": item["applicability"],
                "rationale": item["rationale"],
                "condition": item["condition"],
                "open_question": item["open_question"],
                "objectives": item["objectives"],
                "period_start": _day(item["period_start"]),
                "period_end": _day(item["period_end"]),
            }  # fmt: skip
            for item in plan.phases
        ],
        "procedures": [
            {
                "code": item["code"],
                "phase": item["phase"],
                "text": item["text"],
                "method": item["method"],
                "origin": item["origin"],
                "attributes": codes(
                    plan.procedure_attributes.get(item["id"], set()), attribute_code
                ),
            }  # fmt: skip
            for item in plan.procedures
        ],
        "attributes": [
            {
                "code": item["code"],
                "text": item["text"],
                "basis": item["basis"],
                "source": item["source"],
                "quote": item["quote"],
                **_criteria(plan, item),
                "judgment_required": item["judgment_required"],
                "automatable": item["automatable"],
                "phases": sorted(item["phases"]),
            }  # fmt: skip
            for item in plan.attributes
        ],
        "evidence": [
            {
                "code": item["code"],
                "phase": item["phase"],
                "key": item["key"],
                "title": item["title"],
                "description": item["description"],
                "categories": sorted(item["categories"]),
                "objective": item["objective"],
                "necessity": item["necessity"],
                "population_kind": item["population_kind"],
                "sample_selection": item["sample_selection"],
                "depends_on": item["depends_on"],
                "waived": item["status"] == "WAIVED",
                "attributes": codes(
                    plan.requirement_attributes.get(item["id"], set()), attribute_code
                ),
                "procedures": codes(
                    plan.requirement_procedures.get(item["id"], set()), procedure_code
                ),
            }  # fmt: skip
            for item in plan.requirements
        ],
    }


def _day(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, date) else None


def content_hash(snapshot: dict[str, Any]) -> str:
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


_EVIDENCES_ATTRIBUTES = frozenset({"SAMPLE", "CONTROL_EXECUTION", "CONFIGURATION"})


class Finding(BaseModel):
    """Something in the plan that does not link up or cannot be judged as written. Shown to
    the reviewer and kept with the decision; the reviewer resolves it."""

    kind: FindingKind
    code: str
    detail: str


def _names_attribute(
    name: str, attributes: list[dict[str, Any]], former: list[str] | None = None
) -> bool:
    """Whether evidence that names this wording names one of the control's attributes: the
    same words, the words it was planned with before a client value was filled into the
    attribute (\"by [the deadline]\" naming \"by 30 days after quarter end\"), or the words
    an attribute had before a person reworded it (its replaces chain, 28 October 2026)."""
    wanted = _normal(name)
    texts = [str(item["text"]) for item in attributes] + list(former or [])
    return any(_normal(text) == wanted or _filled_only(name, text) for text in texts)


def findings_of(plan: _Plan) -> list[Finding]:
    found: list[Finding] = []
    approved = {item["id"] for item in plan.attributes}
    active_requirements = [item for item in plan.requirements if item["status"] != "WAIVED"]
    # Design procedures assess the design against the risk; an operating phase must have at
    # least one procedure that tests the attributes (the others obtain, select, or support).
    applies = {
        item["phase"] for item in plan.phases
        if item["applicability"] in ("APPLICABLE", "CONDITIONAL")
    }  # fmt: skip
    for phase in ("INTERIM", "ROLLFORWARD"):
        mine = [item for item in plan.procedures if item["phase"] == phase]
        if (
            phase in applies
            and mine
            and not any(
                plan.procedure_attributes.get(item["id"], set()) & approved for item in mine
            )
        ):
            found.append(Finding(
                kind="PROCEDURE_WITHOUT_ATTRIBUTE", code=mine[0]["code"],
                detail=f"No {PHASE_LABELS.get(phase, phase).lower()} procedure tests an "
                "attribute of the control.",
            ))  # fmt: skip
    tested = {a for links in plan.procedure_attributes.values() for a in links}
    supported = {
        a for item in active_requirements
        for a in plan.requirement_attributes.get(item["id"], set())
    }  # fmt: skip
    for item in plan.attributes:
        code = item["code"]
        if item["id"] not in tested:
            found.append(Finding(
                kind="ATTRIBUTE_WITHOUT_PROCEDURE", code=code,
                detail=f"{code} is not tested by any procedure.",
            ))  # fmt: skip
        if item["id"] not in supported:
            found.append(Finding(
                kind="ATTRIBUTE_WITHOUT_EVIDENCE", code=code,
                detail=f"{code} has no evidence requirement that supports it.",
            ))  # fmt: skip
        criteria = _criteria(plan, item)
        if item["judgment_required"] is not True and not (
            criteria["condition"] and criteria["pass_criteria"] and criteria["fail_criteria"]
        ):
            found.append(Finding(
                kind="ATTRIBUTE_WITHOUT_CRITERIA", code=code,
                detail=f"{code} has no stated condition with pass and fail criteria, and is "
                "not marked as requiring professional judgment.",
            ))  # fmt: skip
        # A library attribute's basis is the standard's, decided in the firm's library
        # review (milestone L3e); the plan does not ask for it again.
        if item["basis"] == "INFERRED" and not item["quote"] and item["definition_key"] is None:
            found.append(Finding(
                kind="ATTRIBUTE_NOT_DOCUMENTED", code=code,
                detail=f"{code} is inferred: no source states it.",
            ))  # fmt: skip
    for item in active_requirements:
        # Evidence of an attribute (a sample's, an execution's, the configuration) must say
        # which; a population, documentation, report support, or change history supports
        # the testing rather than an attribute, and is not flagged. Nor is design evidence:
        # the design is assessed from it, not the attributes.
        evidences = set(item["categories"]) & _EVIDENCES_ATTRIBUTES
        if (
            evidences
            and item["phase"] != "DESIGN"
            and not plan.requirement_attributes.get(item["id"], set()) & approved
        ):
            found.append(Finding(
                kind="EVIDENCE_WITHOUT_ATTRIBUTE", code=item["code"],
                detail=f"{item['code']} ({item['title']}) supports no attribute of the control.",
            ))  # fmt: skip
        for name in item["named"]:
            if not _names_attribute(name, plan.attributes, plan.former_wordings):
                found.append(Finding(
                    kind="UNMATCHED_ATTRIBUTE", code=item["code"],
                    detail=f"{item['code']} names an attribute the control does not have: "
                    f"{name[:200]}",
                ))  # fmt: skip
    # A plan that follows the standard as such is checked against it: a procedure a person
    # wrote or reworded is a deviation the reviewer sees. A customized standard expects
    # tailoring, so nothing is flagged.
    if plan.test_basis == "STANDARD" and plan.library_key:
        standard = BY_KEY.get(plan.library_key)
        ref = standard.control_ref if standard is not None else plan.library_key
        for item in plan.procedures:
            if item.get("origin") == "PERSON" or item.get("person_edited"):
                found.append(Finding(
                    kind="DEVIATES_FROM_STANDARD", code=item["code"],
                    # What resolves it (keep the standard's wording, or a customized
                    # standard as the basis) is said with it on the plan (findingFix).
                    detail=f"{item['code']} deviates from the standard {ref}: a person "
                    f"{'added' if item.get('origin') == 'PERSON' else 'reworded'} it.",
                ))  # fmt: skip
    return found


class Blocker(BaseModel):
    """What stands in the way of approving the plan. A clarification needs information or
    an answer; a decision needs the reviewer's choice on something proposed."""

    kind: BlockerKind
    detail: str
    # Whether approval is refused until it is resolved.
    blocks: bool
    resolve: BlockerResolve
    # The standard a LIBRARY clarification is about, for the link to it.
    target: str = ""


def blockers_of(plan: _Plan) -> list[Blocker]:
    found: list[Blocker] = []

    def add(
        kind: BlockerKind, detail: str, blocks: bool, resolve: BlockerResolve, target: str = ""
    ) -> None:
        found.append(
            Blocker(kind=kind, detail=detail, blocks=blocks, resolve=resolve, target=target)
        )

    if plan.run_status in ("PENDING", "WORKING"):
        add("DECISION", "The planner is still drafting the plan.", True, "WAIT")
    # A standard may be followed before the firm's methodology review approves it (decided
    # by the product owner): the reviewer sees it; it does not hold the plan.
    if (
        plan.test_basis in ("STANDARD", "CUSTOM")
        and plan.library_key
        and plan.library_status not in ("APPROVED", "")
    ):
        standard = BY_KEY.get(plan.library_key)
        ref = standard.control_ref if standard is not None else plan.library_key
        words = plan.library_status.replace("_", " ").lower()
        add(
            "CLARIFICATION",
            f"The standard {ref} this plan follows is {words} on the Library; approving the "
            "plan does not approve the standard.",
            False,
            "LIBRARY",
            plan.library_key,
        )
    if not plan.activity.strip():
        add("CLARIFICATION", "The control has no description of what is done.", True, "CONTROL")
    if plan.frequency not in FREQUENCIES:
        add("CLARIFICATION", "The control's frequency is not set.", True, "CONTROL")
    if not plan.attributes:
        add("CLARIFICATION", "The control has no test attributes.", True, "ATTRIBUTES")
    if plan.proposed_attributes:
        add(
            "CLARIFICATION",
            f"{plan.proposed_attributes} proposed attribute"
            f"{' waits' if plan.proposed_attributes == 1 else 's wait'} for a decision.",
            True,
            "ATTRIBUTES",
        )
    for origin, _kind, detail, _ in plan.open_issues:
        add(
            "CLARIFICATION",
            detail,
            # Attribute and source questions are part of the plan's attributes (decided:
            # approving the plan approves them), so they are settled first.
            origin in ("ATTRIBUTES", "SOURCES"),
            "PROCESS" if origin == "PROCESS" else "ATTRIBUTES",
        )
    for fact in facts_of(plan):
        # The description and frequency are held above; the rest is asked, not invented.
        if fact.basis == "MISSING" and fact.field not in ("DESCRIPTION", "FREQUENCY"):
            # A library control's missing fact is a client value in its statement; a client's
            # own control's is a fact the team states about it (migration 0088).
            stated = not plan.statement and fact.field in STATEABLE_FACTS
            add("CLARIFICATION", f"{fact.label}: {fact.question}", False,
                "FACTS" if stated else "VALUES")  # fmt: skip
    for label, _why in plan.values_missing:
        add("CLARIFICATION", f"The client's value for {label} is not recorded.", False,
            "VALUES")  # fmt: skip
    if plan.provisional:
        add("CLARIFICATION", "Critical information is missing; the plan rests on assumptions.",
            False, "UNDERSTANDING")  # fmt: skip
    for item in plan.understanding.get("missing_information") or []:
        if isinstance(item, str) and item:
            add("CLARIFICATION", f"Missing: {item}", False, "UNDERSTANDING")
    for phase in plan.phases:
        label = PHASE_LABELS.get(phase["phase"], phase["phase"])
        if phase["open_question"]:
            add("CLARIFICATION", f"{label}: {phase['open_question']}", False, "PHASES")
        elif phase["applicability"] == "PENDING":
            add("CLARIFICATION", f"{label}: whether it applies is undecided.", False, "PHASES")
    if plan.pending_changes:
        add(
            "DECISION",
            f"{plan.pending_changes} proposed change"
            f"{'' if plan.pending_changes == 1 else 's'} to the evidence to decide.",
            True,
            "EVIDENCE_CHANGES",
        )
    if plan.pending_revision is not None:
        add("DECISION", "The planner proposed a revised understanding and procedures.", True,
            "REVISION")  # fmt: skip
    return found


def state_of(plan: _Plan, blockers: list[Blocker]) -> PlanningState:
    if plan.plan_id is None:
        return "NOT_STARTED"
    if plan.run_status in ("PENDING", "WORKING"):
        return "ANALYZING"
    if plan.status in APPROVED_STATUSES:
        return "APPROVED"
    if plan.status == "CHANGES_REQUESTED":
        return "CHANGES_REQUESTED"
    if any(item.kind == "CLARIFICATION" for item in blockers):
        return "NEEDS_CLARIFICATION"
    if plan.submitted_at is not None or any(item.kind == "DECISION" for item in blockers):
        return "PENDING_REVIEW"
    return "DRAFT_READY"


# What the API returns


class ControlSection(BaseModel):
    control_ref: str
    title: str
    description: str
    risk: str
    frequency: str
    nature: str
    area: str
    key_control: bool
    application: str
    # The units it operates in, when split by them (Release 1).
    units: str = ""
    classifications: list[str]
    # Where the control came from, what its plan is built from, and the standard it
    # follows, with the firm's methodology review of it (milestone L2).
    source: str
    test_basis: str
    library_key: str
    library_ref: str
    library_status: str


class PhaseSection(BaseModel):
    phase: Phase
    label: str
    applicability: str
    rationale: str
    condition: str
    open_question: str
    objectives: list[str]
    period_start: date | None
    period_end: date | None
    origin: str
    version: int


class ProcedureItem(BaseModel):
    id: UUID
    code: str
    phase: Phase
    text: str
    method: Method | None
    origin: str
    person_edited: bool
    attribute_ids: list[UUID]
    attribute_codes: list[str]
    evidence_codes: list[str]
    version: int
    # The standard's procedure this row follows, when the standard has steps (version 4).
    standard_key: str = ""


class AttributeItem(BaseModel):
    id: UUID
    code: str
    text: str
    basis: str
    source: str
    quote: str
    objective: str
    condition: str
    pass_criteria: str
    fail_criteria: str
    criteria_source: Literal["PLAN", "AGENT", "LIBRARY", "NONE"]
    # A person who accepted the agent's criteria as they read (migration 0122); not part
    # of the plan's content, so accepting never revises a plan.
    criteria_accepted_by: str = ""
    criteria_accepted_at: datetime | None = None
    judgment_required: bool | None
    automatable: bool | None
    phases: list[Phase]
    procedure_codes: list[str]
    evidence_codes: list[str]
    version: int


class EvidenceItem(BaseModel):
    id: UUID
    code: str
    phase: Phase
    title: str
    description: str
    categories: list[str]
    objective: str
    necessity: str
    period_label: str
    status: str
    origin: str
    person_edited: bool
    attribute_ids: list[UUID]
    attribute_codes: list[str]
    procedure_ids: list[UUID]
    procedure_codes: list[str]
    # Attribute wording the requirement names that matches no attribute of the control.
    unmatched: list[str]
    version: int


class DecisionItem(BaseModel):
    decision: Literal["APPROVED", "CHANGES_REQUESTED"]
    revision: int
    comment: str
    decided_by: str
    decided_at: datetime
    content_hash: str
    findings: int


class SubmittedInfo(BaseModel):
    by: str
    at: datetime
    note: str


class ChangeItem(BaseModel):
    """One thing that differs from the version a reviewer last approved."""

    section: Literal["CONTROL", "UNDERSTANDING", "PHASE", "PROCEDURE", "ATTRIBUTE", "EVIDENCE"]
    code: str
    change: Literal["ADDED", "REMOVED", "CHANGED"]
    detail: str


class SuggestedStandard(BaseModel):
    """The library standard a client's control matches, when its RCM gives no test
    attributes: following it as a customized standard brings the standard's attributes."""

    library_key: str
    control_ref: str
    title: str
    status: Literal["STRONG", "PARTIAL"]
    rationale: str


class FilledValue(BaseModel):
    key: str
    label: str
    value: str
    filled_by: str
    filled_at: str


class MasterPlanBody(BaseModel):
    control_id: UUID
    plan_id: UUID | None
    control: ControlSection
    state: PlanningState
    state_label: str
    status: str | None
    run_status: str
    revision: int
    approved_revision: int | None
    # Approved before, and changed since: shows what the reviewer last approved.
    revised_since_approval: bool
    version: int
    understanding: dict[str, Any]
    # The understanding fact by fact, each with its basis and source (facts_of).
    facts: list[FactItem]
    provisional: bool
    phases: list[PhaseSection]
    procedures: list[ProcedureItem]
    attributes: list[AttributeItem]
    evidence: list[EvidenceItem]
    findings: list[Finding]
    blockers: list[Blocker]
    decisions: list[DecisionItem]
    submitted: SubmittedInfo | None
    pending_revision: dict[str, Any] | None
    content_hash: str | None
    # Whether the viewer may approve or request changes (project.update).
    viewer_can_decide: bool
    # The client values the review asks for, answerable before approving.
    open_values: list[OpenValueBody] = Field(default_factory=list)
    # Whether the viewer may enter those values from the plan (task.update), as on the queue.
    viewer_can_answer: bool = False
    # Client values filled since the plan was last approved: they keep its approval
    # (migration 0086), so the plan says what was filled, by whom, and when.
    filled_since_approval: list[FilledValue] = Field(default_factory=list)
    # A plan approved before and changed since: what changed from the version approved.
    changes_since_approval: list[ChangeItem] = Field(default_factory=list)
    # For a client's control whose RCM gives no test attributes: the standard it matches.
    suggested_standard: SuggestedStandard | None = None


def body_of(
    connection: psycopg.Connection[Any], plan: _Plan, viewer_can_decide: bool
) -> MasterPlanBody:
    attribute_code = {item["id"]: item["code"] for item in plan.attributes}
    procedure_code = {item["id"]: item["code"] for item in plan.procedures}
    blockers = blockers_of(plan)
    state = state_of(plan, blockers)
    evidence_of_attribute: dict[UUID, list[str]] = {}
    evidence_of_procedure: dict[UUID, list[str]] = {}
    for item in plan.requirements:
        for attribute in plan.requirement_attributes.get(item["id"], set()):
            evidence_of_attribute.setdefault(attribute, []).append(item["code"])
        for procedure in plan.requirement_procedures.get(item["id"], set()):
            evidence_of_procedure.setdefault(procedure, []).append(item["code"])
    procedures_of_attribute: dict[UUID, list[str]] = {}
    for procedure, attributes in plan.procedure_attributes.items():
        for attribute in attributes:
            if procedure in procedure_code:
                procedures_of_attribute.setdefault(attribute, []).append(procedure_code[procedure])
    decisions = (
        []
        if plan.plan_id is None
        else [
            DecisionItem(
                decision=row[0],
                revision=int(row[1]),
                comment=str(row[2]),
                decided_by=str(row[3]),
                decided_at=row[4],
                content_hash=str(row[5]),
                findings=int(row[6]),
            )  # fmt: skip
            for row in connection.execute(
                """
                SELECT d.decision, d.revision, d.comment, u.display_name, d.decided_at,
                       d.content_hash, jsonb_array_length(d.findings)
                FROM plan_decisions d JOIN users u ON u.id = d.decided_by
                WHERE d.plan_id = %s ORDER BY d.decided_at DESC
                """,
                (plan.plan_id,),
            ).fetchall()
        ]
    )

    def ordered(codes: list[str]) -> list[str]:
        return sorted(set(codes), key=lambda code: (code[0], int(code[1:] or 0)))

    return MasterPlanBody(
        control_id=plan.control_id,
        plan_id=plan.plan_id,
        control=ControlSection(
            control_ref=plan.control_ref,
            title=plan.title,
            description=plan.activity,
            risk=plan.risk,
            frequency=plan.frequency,
            nature=plan.nature,
            area=plan.domain,
            key_control=plan.key_control,
            application=plan.application,
            units=plan.units,
            classifications=plan.classifications,
            source=plan.source,
            test_basis=plan.test_basis,
            library_key=plan.library_key,
            library_ref=(
                BY_KEY[plan.library_key].control_ref if plan.library_key in BY_KEY else ""
            ),
            library_status=plan.library_status,
        ),  # fmt: skip
        state=state,
        state_label=STATE_LABELS[state],
        status=plan.status or None,
        run_status=plan.run_status,
        revision=plan.revision,
        approved_revision=plan.approved_revision,
        revised_since_approval=plan.approved_revision is not None
        and plan.status not in APPROVED_STATUSES,
        version=plan.version,
        understanding=plan.understanding,
        facts=facts_of(plan),
        provisional=plan.provisional,
        phases=[
            PhaseSection(
                phase=item["phase"],
                label=PHASE_LABELS.get(item["phase"], item["phase"]),
                applicability=item["applicability"],
                rationale=item["rationale"],
                condition=item["condition"],
                open_question=item["open_question"],
                objectives=item["objectives"],
                period_start=item["period_start"],
                period_end=item["period_end"],
                origin=item["origin"],
                version=item["version"],
            )  # fmt: skip
            for item in plan.phases
        ],
        procedures=[
            ProcedureItem(
                id=item["id"],
                code=item["code"],
                phase=item["phase"],
                text=item["text"],
                method=item["method"],
                origin=item["origin"],
                person_edited=item["person_edited"],
                standard_key=(
                    ""
                    if item["person_edited"] or plan.test_basis == "CLIENT"
                    else standard_procedure_key(plan.library_key, item["text"])
                ),
                attribute_ids=sorted(
                    a
                    for a in plan.procedure_attributes.get(item["id"], set())
                    if a in attribute_code
                ),
                attribute_codes=ordered(
                    [
                        attribute_code[a]
                        for a in plan.procedure_attributes.get(item["id"], set())
                        if a in attribute_code
                    ]
                ),
                evidence_codes=ordered(evidence_of_procedure.get(item["id"], [])),
                version=item["version"],
            )  # fmt: skip
            for item in plan.procedures
        ],
        attributes=[
            AttributeItem(
                id=item["id"],
                code=item["code"],
                text=item["text"],
                basis=item["basis"],
                source=item["source"],
                quote=item["quote"],
                **_criteria(plan, item),
                criteria_accepted_by=item["criteria_accepted_by"]
                if item["criteria_accepted_at"] is not None
                else "",
                criteria_accepted_at=item["criteria_accepted_at"],
                judgment_required=item["judgment_required"],
                automatable=item["automatable"],
                phases=item["phases"],
                procedure_codes=ordered(procedures_of_attribute.get(item["id"], [])),
                evidence_codes=ordered(evidence_of_attribute.get(item["id"], [])),
                version=item["version"],
            )  # fmt: skip
            for item in plan.attributes
        ],
        evidence=[
            EvidenceItem(
                id=item["id"],
                code=item["code"],
                phase=item["phase"],
                title=item["title"],
                description=item["description"],
                categories=item["categories"],
                objective=item["objective"],
                necessity=item["necessity"],
                period_label=item["period_label"],
                status=item["status"],
                origin=item["origin"],
                person_edited=item["person_edited"],
                attribute_ids=sorted(
                    a
                    for a in plan.requirement_attributes.get(item["id"], set())
                    if a in attribute_code
                ),
                attribute_codes=ordered(
                    [
                        attribute_code[a]
                        for a in plan.requirement_attributes.get(item["id"], set())
                        if a in attribute_code
                    ]
                ),
                procedure_ids=sorted(
                    p
                    for p in plan.requirement_procedures.get(item["id"], set())
                    if p in procedure_code
                ),
                procedure_codes=ordered(
                    [
                        procedure_code[p]
                        for p in plan.requirement_procedures.get(item["id"], set())
                        if p in procedure_code
                    ]
                ),
                unmatched=[
                    name
                    for name in item["named"]
                    if not _names_attribute(name, plan.attributes, plan.former_wordings)
                ],
                version=item["version"],
            )  # fmt: skip
            for item in plan.requirements
        ],
        findings=findings_of(plan) if plan.plan_id is not None else [],
        blockers=blockers,
        decisions=decisions,
        submitted=None
        if plan.submitted_at is None
        else SubmittedInfo(
            by=plan.submitted_by or "", at=plan.submitted_at, note=plan.submitted_note
        ),  # fmt: skip
        pending_revision=plan.pending_revision,
        content_hash=None if plan.plan_id is None else content_hash(content(plan)),
        viewer_can_decide=viewer_can_decide,
        open_values=open_values(connection, plan.control_id),
    )


def master_plan(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    viewer_can_decide: bool = False,
) -> MasterPlanBody:
    plan = _load(connection, project_id, control_id).get(control_id)
    if plan is None:
        raise NotVisible()
    body = body_of(connection, plan, viewer_can_decide)
    body.filled_since_approval = filled_since_approval(connection, control_id)
    body.changes_since_approval = changes_since_approval(connection, plan)
    body.suggested_standard = suggested_standard(connection, plan)
    return body


def suggested_standard(
    connection: psycopg.Connection[Any], plan: _Plan
) -> SuggestedStandard | None:
    """The standard a client's own control matches by the fixed rules, offered when its
    RCM states no test attribute (only "The control operated as described"): following it
    as a customized standard brings its attributes. None for a library control, one that
    follows a standard already, or one whose attributes are its own."""
    from ai_workforce_api.library_matching import PLACEHOLDER, load_control, rules_candidates

    if plan.source == "LIBRARY" or plan.library_key in BY_KEY:
        return None
    if any(PLACEHOLDER.match(str(item["text"])) is None for item in plan.attributes):
        return None
    facts = load_control(connection, plan.control_id)
    if facts is None:
        return None
    ranked = rules_candidates(facts, {}, limit=3)
    best = ranked[0] if ranked else None
    if best is None or best.status not in ("STRONG", "PARTIAL") or best.library_key not in BY_KEY:
        return None
    standard = BY_KEY[best.library_key]
    return SuggestedStandard(
        library_key=standard.key, control_ref=standard.control_ref, title=standard.title,
        status="STRONG" if best.status == "STRONG" else "PARTIAL", rationale=best.rationale,
    )  # fmt: skip


class FactsBody(BaseModel):
    """Facts the team states for a client's own control; an empty one clears it."""

    facts: dict[str, str] = Field(min_length=1, max_length=len(STATEABLE_FACTS))


def state_facts(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: FactsBody,
) -> None:
    """Record what the team states about a client's own control (migration 0088): whether
    it prevents or detects, who performs and reviews it, its assertions, and the planner's
    proposals it confirms. Who stated each, and when, is kept with it."""
    from ai_workforce_api.actions import contains_secret

    cleaned: dict[str, str] = {}
    for name, raw in body.facts.items():
        if name not in STATEABLE_FACTS:
            raise ValueError("that is not a fact the team states")
        value = " ".join(raw.split())[:600]
        if name == "TYPE" and value:
            if value.lower() not in ("preventive", "detective"):
                raise ValueError("a control is preventive or detective")
            value = value.capitalize()
        cleaned[name] = value
    if contains_secret(cleaned):
        raise ValueError("a fact cannot hold a credential")
    with transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT stated_facts FROM engagement_controls WHERE id = %s AND project_id = %s "
            "FOR UPDATE",
            (control_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        name_row = cursor.execute(
            "SELECT display_name FROM users WHERE id = %s", (actor,)
        ).fetchone()
        by_name = str(name_row[0]) if name_row is not None and name_row[0] else ""
        stated: dict[str, Any] = dict(row[0] or {})
        at = cursor.execute("SELECT clock_timestamp()").fetchone()
        for name, value in cleaned.items():
            if value:
                stated[name] = {
                    "value": value, "by": str(actor), "by_name": by_name,
                    "at": at[0].isoformat() if at is not None else "",
                }  # fmt: skip
            else:
                stated.pop(name, None)
        cursor.execute(
            "UPDATE engagement_controls SET stated_facts = %s, version = version + 1, "
            "updated_at = clock_timestamp() WHERE id = %s",
            (Json(stated), control_id),
        )
        _audit(
            cursor, organization_id, project_id, actor, "control.facts_stated",
            "engagement_control", control_id,
            {"stated": sorted(k for k, v in cleaned.items() if v),
             "cleared": sorted(k for k, v in cleaned.items() if not v)},
        )  # fmt: skip


def _filled_only(old: Any, new: Any) -> bool:
    """Whether new is old with its bracketed client values filled in (migration 0086's
    fills_placeholders): reported as values filled, not as a change."""
    if not isinstance(old, str) or not isinstance(new, str) or "[" not in old or old == new:
        return False
    parts = re.split(r"\s*\[[^\]]+\]\s*", " ".join(old.split()))
    pattern = r"\s*(.+?)\s*".join(re.escape(part) for part in parts)
    return re.fullmatch(pattern, " ".join(new.split())) is not None


_CONTROL_FIELDS = {
    "title": "Title", "description": "Description", "risk": "Risk", "frequency": "Frequency",
    "nature": "Nature", "area": "Area", "key_control": "Key control",
    "application": "System", "classifications": "Classifications",
}  # fmt: skip


def changes_since(approved: dict[str, Any], current: dict[str, Any]) -> list[ChangeItem]:
    """What differs between the plan a reviewer approved and the plan now, item by item.
    Wording that only fills a client value the approved plan left in brackets is not a
    change (migration 0086)."""
    found: list[ChangeItem] = []

    def differs(old: Any, new: Any) -> bool:
        return old != new and not _filled_only(old, new)

    before, after = approved.get("control", {}), current.get("control", {})
    for key, label in _CONTROL_FIELDS.items():
        if differs(before.get(key), after.get(key)):
            found.append(ChangeItem(
                section="CONTROL", code="", change="CHANGED", detail=f"{label} changed",
            ))  # fmt: skip
    if approved.get("understanding") != current.get("understanding"):
        found.append(ChangeItem(
            section="UNDERSTANDING", code="", change="CHANGED",
            detail="Understanding of the control revised",
        ))  # fmt: skip
    phases_before = {item["phase"]: item for item in approved.get("phases", [])}
    for item in current.get("phases", []):
        was = phases_before.get(item["phase"])
        if was is not None and was.get("applicability") != item.get("applicability"):
            found.append(ChangeItem(
                section="PHASE", code=item["phase"], change="CHANGED",
                detail=f"{PHASE_LABELS.get(item['phase'], item['phase'])} applicability changed",
            ))  # fmt: skip

    def by_code(
        section: Literal["PROCEDURE", "ATTRIBUTE", "EVIDENCE"],
        name: str,
        key: str,
        wording: tuple[str, ...],
    ) -> None:
        old = {item["code"]: item for item in approved.get(key, [])}
        new = {item["code"]: item for item in current.get(key, [])}
        for code, item in new.items():
            was = old.get(code)
            if was is None:
                found.append(ChangeItem(
                    section=section, code=code, change="ADDED", detail=f"{name} {code} added",
                ))  # fmt: skip
                continue
            what: list[str] = []
            if any(differs(was.get(f), item.get(f)) for f in wording):
                what.append("reworded")
            links = ("attributes", "procedures")
            if any(was.get(f) != item.get(f) for f in links):
                what.append("links changed")
            rest = set(item) - set(wording) - set(links)
            if any(differs(was.get(f), item.get(f)) for f in rest):
                what.append("changed" if not what else "details changed")
            if what:
                found.append(ChangeItem(
                    section=section, code=code, change="CHANGED",
                    detail=f"{name} {code} {', '.join(what)}",
                ))  # fmt: skip
        for code in old.keys() - new.keys():
            found.append(ChangeItem(
                section=section, code=code, change="REMOVED", detail=f"{name} {code} removed",
            ))  # fmt: skip

    by_code("PROCEDURE", "Procedure", "procedures", ("text",))
    by_code("ATTRIBUTE", "Attribute", "attributes", ("text",))
    by_code("EVIDENCE", "Evidence", "evidence", ("title", "description"))
    return found


def changes_since_approval(connection: psycopg.Connection[Any], plan: _Plan) -> list[ChangeItem]:
    """For a plan approved before and changed since, what changed from the version
    approved (its stored snapshot). Empty otherwise."""
    if plan.plan_id is None or plan.approved_revision is None or plan.status in APPROVED_STATUSES:
        return []
    row = connection.execute(
        "SELECT content FROM plan_versions WHERE plan_id = %s AND revision = %s "
        "ORDER BY created_at DESC LIMIT 1",
        (plan.plan_id, plan.approved_revision),
    ).fetchone()
    if row is None or not isinstance(row[0], dict):
        return []
    return changes_since(row[0], content(plan))


def filled_since_approval(
    connection: psycopg.Connection[Any], control_id: UUID
) -> list[FilledValue]:
    """The client values recorded after the control's plan was last approved."""
    from ai_workforce_api.statement_registry import statement_for

    rows = connection.execute(
        """
        SELECT c.library_key, v.slot_key, v.value, coalesce(u.display_name, ''), v.filled_at
        FROM evidence_plans p
        JOIN engagement_controls c ON c.id = p.engagement_control_id
        JOIN control_parameters v ON v.engagement_control_id = c.id
        LEFT JOIN users u ON u.id = v.filled_by
        WHERE p.engagement_control_id = %s AND p.approved_at IS NOT NULL
          AND v.value <> '' AND v.filled_at > p.approved_at
        ORDER BY v.filled_at, v.slot_key
        """,
        (control_id,),
    ).fetchall()
    found: list[FilledValue] = []
    for library_key, key, value, by, at in rows:
        statement = statement_for(str(library_key or ""))
        label = next(
            (slot.label for slot in (statement.slots if statement else ()) if slot.key == key),
            str(key),
        )
        found.append(
            FilledValue(
                key=str(key), label=label, value=str(value), filled_by=str(by),
                filled_at=at.isoformat(),
            )
        )  # fmt: skip
    return found


# The engagement's planning review queue


class QueueRow(BaseModel):
    control_id: UUID
    control_ref: str
    title: str
    application: str
    # The units it operates in, when split by them (Release 1).
    units: str = ""
    state: PlanningState
    state_label: str
    revision: int
    approved_revision: int | None
    revised_since_approval: bool
    clarifications: int
    decisions: int
    findings: int
    submitted_by: str | None
    last_decision: Literal["APPROVED", "CHANGES_REQUESTED"] | None
    last_decision_by: str | None
    last_decision_at: datetime | None
    last_comment: str
    # For approving from the queue: the plan's version, whether nothing holds its approval
    # now, and what holds it when something does.
    version: int = 0
    approvable: bool = False
    held_by: str = ""
    # What the queue filters by: the process (the team's own name for it, or the
    # standard area), the kind of control, and how the control is designed and tested.
    process: str = ""
    category: Category = "BUSINESS"
    key_control: bool = False
    nature: str = ""
    frequency: str = ""
    test_basis: str = ""
    # The client values the plan asks for, answerable from the queue.
    open_values: list[OpenValueBody] = Field(default_factory=list)
    # The questions that are not client values: reviewed on the plan itself.
    other_questions: int = 0
    # Approved before and changed since: what changed, in short (changes_since_approval).
    changes_since_approval: list[str] = Field(default_factory=list)


class QueueBody(BaseModel):
    total: int
    # Every state, with how many controls are in it; they add up to the total.
    counts: dict[str, int]
    controls: list[QueueRow]
    # The next control that waits for the reviewer, in the queue's order.
    next_control_id: UUID | None
    # Whether the viewer may approve or request changes (project.update).
    viewer_can_decide: bool = False
    # Whether the viewer may record the client values the plans ask for (task.update).
    viewer_can_answer: bool = False


_REVIEW_ORDER: dict[str, int] = {
    "PENDING_REVIEW": 0, "DRAFT_READY": 1, "NEEDS_CLARIFICATION": 2, "CHANGES_REQUESTED": 3,
    "ANALYZING": 4, "NOT_STARTED": 5, "APPROVED": 6,
}  # fmt: skip


def planning_queue(connection: psycopg.Connection[Any], project_id: UUID) -> QueueBody:
    """Every in-scope control and where its plan stands: no control is left out."""
    rows: list[QueueRow] = []
    asked = open_values_by_control(connection, project_id)
    for plan in _load(connection, project_id).values():
        blockers = blockers_of(plan)
        state = state_of(plan, blockers)
        decision = plan.last_decision or {}
        rows.append(
            QueueRow(
                control_id=plan.control_id,
                control_ref=plan.control_ref,
                title=plan.title,
                application=plan.application,
                units=plan.units,
                state=state,
                state_label=STATE_LABELS[state],
                revision=plan.revision,
                approved_revision=plan.approved_revision,
                revised_since_approval=plan.approved_revision is not None
                and plan.status not in APPROVED_STATUSES,
                clarifications=sum(1 for b in blockers if b.kind == "CLARIFICATION"),
                decisions=sum(1 for b in blockers if b.kind == "DECISION"),
                findings=len(findings_of(plan)) if plan.plan_id is not None else 0,
                submitted_by=plan.submitted_by,
                last_decision=decision.get("decision"),
                last_decision_by=decision.get("by"),
                last_decision_at=decision.get("at"),
                last_comment=str(decision.get("comment") or ""),
                version=plan.version,
                approvable=plan.plan_id is not None
                and plan.status != "APPROVED"
                and not any(b.blocks for b in blockers),
                held_by=next((b.detail for b in blockers if b.blocks), ""),
                process=plan.process or DOMAIN_LABELS.get(plan.domain, plan.domain),
                category=category_for(plan.domain),
                key_control=plan.key_control,
                nature=plan.nature,
                frequency=plan.frequency,
                test_basis=plan.test_basis,
                open_values=asked.get(plan.control_id, []),
                other_questions=sum(
                    1 for b in blockers if b.kind == "CLARIFICATION" and b.resolve != "VALUES"
                ),
                changes_since_approval=[
                    item.detail for item in changes_since_approval(connection, plan)
                ],
            )  # fmt: skip
        )
    counts: dict[str, int] = {state: 0 for state in PLANNING_STATES}
    for row in rows:
        counts[row.state] += 1
    waiting = sorted(
        # A plan that needs clarification can still be reviewed: what it asks does not hold
        # approval. It comes after those ready for review.
        (
            row
            for row in rows
            if row.state in ("PENDING_REVIEW", "DRAFT_READY", "NEEDS_CLARIFICATION")
        ),
        key=lambda row: (_REVIEW_ORDER[row.state], row.control_ref, row.application),
    )
    return QueueBody(
        total=len(rows),
        counts=counts,
        controls=sorted(
            rows, key=lambda row: (_REVIEW_ORDER[row.state], row.control_ref, row.application)
        ),
        next_control_id=waiting[0].control_id if waiting else None,
    )


# Decisions


class BatchItem(BaseModel):
    control_id: UUID
    version: int = Field(ge=1)


class BatchApproveBody(BaseModel):
    """The plans a reviewer selected, each by its version: a plan changed since the queue
    was read is refused, not approved."""

    items: list[BatchItem] = Field(min_length=1, max_length=100)
    comment: str = Field(default="", max_length=4000)


class BatchOutcome(BaseModel):
    control_id: UUID
    control_ref: str
    approved: bool
    detail: str


class BatchResult(BaseModel):
    outcomes: list[BatchOutcome]
    approved: int


class ApproveBody(BaseModel):
    version: int = Field(ge=1)
    comment: str = Field(default="", max_length=4000)
    # The client values the reviewer answered while approving (control_design.set_values),
    # recorded with the approval in one transaction; and whether each also fills other
    # controls that ask for it and have none yet.
    values: dict[str, str] = Field(default_factory=dict, max_length=40)
    everywhere: bool = False


class RequestChangesBody(BaseModel):
    version: int = Field(ge=1)
    comment: str = Field(min_length=10, max_length=4000)


class SubmitBody(BaseModel):
    version: int = Field(ge=1)
    note: str = Field(default="", max_length=2000)


@dataclass(frozen=True)
class GroupLink:
    """The group decision an approval is part of (shared_plans.approve_group), and the
    shared plan's fingerprint it approved."""

    group_decision_id: UUID
    shared_hash: str


class PendingRevisionDecision(BaseModel):
    version: int = Field(ge=1)
    decision: Literal["ACCEPT", "DISMISS"]


def _locked(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> tuple[Any, ...]:
    row = cursor.execute(
        """
        SELECT id, status, version, revision, run_status, pending_revision IS NOT NULL
        FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s FOR UPDATE
        """,
        (project_id, control_id),
    ).fetchone()
    if row is None:
        raise PlanState("the control has no test plan yet")
    return tuple(row)


def _record(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    decision: Literal["APPROVED", "CHANGES_REQUESTED"],
    comment: str,
    group: GroupLink | None = None,
) -> tuple[int, str]:
    """Store the plan as the reviewer saw it, once per revision, and the decision on it,
    with the implementation's scope and, for a group decision, the group and the shared
    plan's fingerprint (migration 0104)."""
    from ai_workforce_api.implementations import scope_of

    plan = _load(cursor.connection, project_id, control_id)[control_id]
    assert plan.plan_id is not None
    snapshot = content(plan)
    digest = content_hash(snapshot)
    version = cursor.execute(
        "SELECT id, content_hash FROM plan_versions WHERE plan_id = %s AND revision = %s",
        (plan.plan_id, plan.revision),
    ).fetchone()
    if version is None or str(version[1]) != digest:
        # A revision's content is fixed; one that reads differently now (the library's
        # definitions changed in code) is stored under the next revision.
        if version is not None:
            cursor.execute("SELECT revise_evidence_plan(%s)", (plan.plan_id,))
            plan = _load(cursor.connection, project_id, control_id)[control_id]
            snapshot = content(plan)
            digest = content_hash(snapshot)
        version = cursor.execute(
            """
            INSERT INTO plan_versions (
                organization_id, project_id, plan_id, engagement_control_id, revision,
                content, content_hash, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, content_hash
            """,
            (
                organization_id, project_id, plan.plan_id, control_id, plan.revision,
                json.dumps(snapshot, default=str), digest, actor,
            ),
        ).fetchone()  # fmt: skip
        assert version is not None
    findings = [item.model_dump() for item in findings_of(plan)]
    scope = scope_of(cursor.connection, project_id, control_id)
    cursor.execute(
        """
        INSERT INTO plan_decisions (
            organization_id, project_id, plan_id, plan_version_id, engagement_control_id,
            revision, decision, comment, findings, content_hash, decided_by,
            group_decision_id, shared_hash, scope
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            organization_id, project_id, plan.plan_id, version[0], control_id, plan.revision,
            decision, comment, json.dumps(findings), digest, actor,
            None if group is None else group.group_decision_id,
            None if group is None else group.shared_hash,
            json.dumps(scope.model_dump()),
        ),
    )  # fmt: skip
    return plan.revision, digest


def approve(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: ApproveBody,
    group: GroupLink | None = None,
) -> list[UUID]:
    """A person approves the plan's current revision, with its attributes. Refused while
    anything that would change it is undecided. The client values answered with it are
    recorded first, in the same transaction. Returns the other controls those values
    also filled, for their own follow-up. Part of a group decision, it says so."""
    from ai_workforce_api.control_context import ContextState
    from ai_workforce_api.control_design import ValuesBody, set_values

    with transaction(connection) as cursor:
        plan_id, status, version, _revision, run_status, _pending = _locked(
            cursor, project_id, control_id
        )
        if status == "APPROVED":
            if group is not None:
                # Approved since the group decision was shown (another reviewer, or the
                # same request sent twice): the group decision must not stand without it.
                raise PlanState("a plan was approved meanwhile; review the control again")
            # Its current revision is approved (the database holds it so): approving it
            # again records nothing new.
            return []
        if int(version) != body.version:
            raise PlanState("the plan changed")
        answered = {key: value for key, value in body.values.items() if value.strip()}
        filled: list[UUID] = []
        if answered:
            try:
                filled = set_values(
                    connection, organization_id, project_id, control_id, actor,
                    ValuesBody(values=answered, everywhere=body.everywhere),
                )  # fmt: skip
            except ContextState as error:
                # An unknown value or a credential: refused, and nothing is approved.
                raise PlanState(error.detail) from None
        plan = _load(connection, project_id, control_id)[control_id]
        refused = [item.detail for item in blockers_of(plan) if item.blocks]
        if refused:
            raise PlanState(refused[0])
        # The attributes are approved with the plan: none proposed, none in question.
        settled = cursor.execute(
            f"SELECT {ATTRIBUTES_SETTLED_SQL} FROM engagement_controls c WHERE c.id = %s",
            (control_id,),
        ).fetchone()
        if settled is None or not settled[0]:
            raise PlanState("settle the control's attributes first")
        revision, digest = _record(
            cursor, organization_id, project_id, control_id, actor, "APPROVED",
            body.comment.strip(), group,
        )  # fmt: skip
        cursor.execute(
            """
            UPDATE evidence_plans
            SET status = 'APPROVED', approved_by = %s, approved_at = clock_timestamp(),
                approved_revision = revision, version = version + 1
            WHERE id = %s
            """,
            (actor, plan_id),
        )
        cursor.execute(
            "UPDATE evidence_requirements SET needs_review = false WHERE plan_id = %s "
            "AND needs_review",
            (plan_id,),
        )
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.approved",
            "evidence_plan", plan_id,
            {"revision": revision, "content_hash": digest, "previous_status": status,
             "values_answered": sorted(answered)},
        )  # fmt: skip
        # Results signed off under an earlier revision now await a reviewer's impact
        # assessment (plan_impact.py, W3); the agent recommends, a person decides.
        from ai_workforce_api.plan_impact import detect as detect_impacts

        detect_impacts(cursor, organization_id, project_id, control_id)
    return [item for item in filled if item != control_id]


def request_changes(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: RequestChangesBody,
) -> None:
    """A person returns the plan with what to change. An approved plan loses its approval:
    nothing downstream runs on it until a revision is approved."""
    comment = body.comment.strip()
    if len(comment) < 10:
        raise ValueError("say what should change")
    with transaction(connection) as cursor:
        plan_id, status, version, revision, _run, _pending = _locked(cursor, project_id, control_id)
        if int(version) != body.version:
            raise PlanState("the plan changed")
        if status == "CHANGES_REQUESTED":
            raise PlanState("changes are already requested")
        revision, digest = _record(
            cursor, organization_id, project_id, control_id, actor, "CHANGES_REQUESTED", comment
        )
        cursor.execute(
            """
            UPDATE evidence_plans
            SET status = 'CHANGES_REQUESTED', submitted_by = NULL, submitted_at = NULL,
                submitted_note = '', version = version + 1
            WHERE id = %s
            """,
            (plan_id,),
        )
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.changes_requested",
            "evidence_plan", plan_id,
            {"revision": int(revision), "content_hash": digest, "previous_status": status},
        )  # fmt: skip


def submit(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: SubmitBody,
) -> None:
    """A preparer submits the plan's current revision for review. After changes were
    requested, the preparer says what was done about them."""
    note = body.note.strip()
    with transaction(connection) as cursor:
        plan_id, status, version, revision, run_status, _pending = _locked(
            cursor, project_id, control_id
        )
        if int(version) != body.version:
            raise PlanState("the plan changed")
        if status in APPROVED_STATUSES:
            raise PlanState("the plan is already approved")
        if run_status in ("PENDING", "WORKING"):
            raise PlanState("The planner is still drafting the plan.")
        if status == "CHANGES_REQUESTED" and len(note) < 10:
            raise ValueError("say how the requested changes were addressed")
        cursor.execute(
            """
            UPDATE evidence_plans
            SET status = 'PROPOSED', submitted_by = %s, submitted_at = clock_timestamp(),
                submitted_note = %s, version = version + 1
            WHERE id = %s
            """,
            (actor, note, plan_id),
        )
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.submitted",
            "evidence_plan", plan_id, {"revision": int(revision)},
        )  # fmt: skip


def decide_pending_revision(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: PendingRevisionDecision,
) -> None:
    """The planner's revised understanding and procedures for an approved plan: accepted
    (the plan is revised, and goes back for review) or dismissed."""
    from ai_workforce_api.evidence_plans import apply_plan_content, derive_requirement_procedures

    with transaction(connection) as cursor:
        plan_id, _status, version, _revision, _run, pending = _locked(
            cursor, project_id, control_id
        )
        if int(version) != body.version:
            raise PlanState("the plan changed")
        if not pending:
            raise PlanState("no revision is waiting")
        row = cursor.execute(
            "SELECT pending_revision FROM evidence_plans WHERE id = %s", (plan_id,)
        ).fetchone()
        proposed = row[0] if row is not None and isinstance(row[0], dict) else {}
        cursor.execute(
            "UPDATE evidence_plans SET pending_revision = NULL, version = version + 1 "
            "WHERE id = %s",
            (plan_id,),
        )
        if body.decision == "ACCEPT":
            apply_plan_content(cursor, organization_id, project_id, plan_id, control_id,
                               proposed)  # fmt: skip
            derive_requirement_procedures(cursor, organization_id, project_id, plan_id, control_id)
            cursor.execute("SELECT revise_evidence_plan(%s)", (plan_id,))
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plan.revision_decided",
            "evidence_plan", plan_id, {"decision": body.decision},
        )  # fmt: skip


class Replanned(BaseModel):
    planned: int
    skipped: int


def replan_unapproved(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    control_id: UUID | None = None,
) -> Replanned:
    """Plan every in-scope control again with the reviewed rules (or the one named, as a
    finding on its plan offers), where no person has approved the plan: its procedures,
    links, and understanding follow the records. An approved plan, or one the planner agent
    is drafting, is left as it is. One control per transaction; a person's decisions are
    kept, as on any run."""
    from ai_workforce_api.evidence_plans import generate

    rows = connection.execute(
        """
        SELECT c.id, p.status IN ('APPROVED', 'CHANGES_PROPOSED')
                     OR p.run_status IN ('PENDING', 'WORKING')
        FROM engagement_controls c JOIN evidence_plans p ON p.engagement_control_id = c.id
        WHERE c.project_id = %s AND c.included AND (%s::uuid IS NULL OR c.id = %s)
        ORDER BY c.control_ref
        """,
        (project_id, control_id, control_id),
    ).fetchall()
    planned = skipped = 0
    for found, leave in rows:
        if leave:
            skipped += 1
            continue
        generate(connection, None, organization_id, project_id, UUID(str(found)), actor)
        planned += 1
    with transaction(connection) as cursor:
        _audit(
            cursor, organization_id, project_id, actor, "evidence_plans.replanned",
            "project", project_id,
            {"planned": planned, "skipped": skipped}
            | ({} if control_id is None else {"control_id": str(control_id)}),
        )  # fmt: skip
    return Replanned(planned=planned, skipped=skipped)


@dataclass(frozen=True)
class Settled:
    linked: int
    redrawn: int


def settle_library_attributes(
    connection: psycopg.Connection[Any], project_id: UUID | None = None
) -> Settled:
    """Bring every unapproved plan in line with its standard's attributes (milestone L3e),
    so no person tidies what the rules can: a copy of a library attribute is linked to it,
    or retired when the library's own is on the control (library_definitions.
    link_definitions), and a plan that leaves a library attribute untested or unsupported is
    planned again with the rules, as "Plan again with the rules" does; so is one holding
    evidence the rules planned for an attribute the control does not test. An approved plan, or
    one the planner agent is drafting, is left as it is. Idempotent; run with every deploy,
    as the standard workforce is. One control per transaction."""
    from ai_workforce_api.evidence_plans import generate
    from ai_workforce_api.library_definitions import link_definitions
    from ai_workforce_api.testing_definitions import DEFINED_SINCE

    rows = connection.execute(
        """
        SELECT c.id, c.organization_id, c.project_id,
               coalesce(p.generated_by, j.owner_user_id)
        FROM engagement_controls c
        JOIN evidence_plans p ON p.engagement_control_id = c.id
        JOIN projects j ON j.id = c.project_id
        WHERE c.included AND c.library_key IS NOT NULL AND c.library_version >= %s
          AND (%s::uuid IS NULL OR c.project_id = %s)
          AND p.status NOT IN ('APPROVED', 'CHANGES_PROPOSED')
          AND p.run_status NOT IN ('PENDING', 'WORKING')
        ORDER BY c.project_id, c.control_ref
        """,
        (DEFINED_SINCE, project_id, project_id),
    ).fetchall()
    gaps = ("ATTRIBUTE_WITHOUT_PROCEDURE", "ATTRIBUTE_WITHOUT_EVIDENCE")
    # Evidence the rules planned for an attribute the control does not test.
    stray = "EVIDENCE_WITHOUT_ATTRIBUTE"
    linked = redrawn = 0
    for control_id, organization_id, project, requester in rows:
        control = UUID(str(control_id))
        with transaction(connection) as cursor:
            changed = link_definitions(cursor, control, None)
        linked += changed
        plan = _load(connection, UUID(str(project)), control).get(control)
        if plan is None or requester is None:
            continue
        library = {
            str(code)
            for (code,) in connection.execute(
                "SELECT code FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' AND definition_key IS NOT NULL",
                (control,),
            ).fetchall()
        }
        rules = {item["code"] for item in plan.requirements if item["origin"] == "RULES"}
        untidy = any(
            (f.kind in gaps and f.code in library) or (f.kind == stray and f.code in rules)
            for f in findings_of(plan)
        )
        if changed or untidy:
            generate(
                connection, None, UUID(str(organization_id)), UUID(str(project)), control,
                UUID(str(requester)),
            )  # fmt: skip
            redrawn += 1
    return Settled(linked=linked, redrawn=redrawn)


# A person edits the plan. Every change revises it (database triggers), and an approved
# plan goes back for review.


class ProcedureAdd(BaseModel):
    phase: Phase
    text: str = Field(min_length=10, max_length=1000)
    method: Method | None = None
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=30)


class ProcedureEdit(BaseModel):
    version: int = Field(ge=1)
    text: str = Field(min_length=10, max_length=1000)
    method: Method | None = None


class ProcedureRemove(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=10, max_length=500)


class LinksBody(BaseModel):
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=30)
    procedure_ids: list[UUID] = Field(default_factory=list, max_length=30)


class CriteriaBody(BaseModel):
    version: int = Field(ge=1)
    objective: str = Field(default="", max_length=500)
    condition: str = Field(default="", max_length=1000)
    pass_criteria: str = Field(default="", max_length=1000)
    fail_criteria: str = Field(default="", max_length=1000)
    judgment_required: bool | None = None
    automatable: bool | None = None
    phases: list[Phase] = Field(default_factory=list, max_length=3)


class AcceptedAttribute(BaseModel):
    id: UUID
    version: int = Field(ge=1)


class AcceptCriteriaBody(BaseModel):
    attributes: list[AcceptedAttribute] = Field(min_length=1, max_length=50)


_SECRETISH = re.compile(r"(?i)\b(password|passwd|secret|api[_ -]?key|token)\s*[:=]")


def _clean(text: str) -> str:
    cleaned = " ".join(text.split())
    if _SECRETISH.search(cleaned):
        raise ValueError("the text must not contain credentials")
    return cleaned


def _plan_id(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> UUID:
    row = cursor.execute(
        "SELECT id FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s "
        "FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        raise PlanState("the control has no test plan yet")
    return UUID(str(row[0]))


def _approved_attributes(
    cursor: psycopg.Cursor[Any], control_id: UUID, wanted: list[UUID]
) -> list[UUID]:
    if not wanted:
        return []
    found = {
        UUID(str(row[0]))
        for row in cursor.execute(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND id = ANY(%s)",
            (control_id, list(set(wanted))),
        ).fetchall()
    }
    if len(found) != len(set(wanted)):
        raise PlanState("link only the control's approved attributes")
    return sorted(found)


def add_procedure(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: ProcedureAdd,
) -> UUID:
    text = _clean(body.text)
    with transaction(connection) as cursor:
        plan_id = _plan_id(cursor, project_id, control_id)
        attributes = _approved_attributes(cursor, control_id, body.attribute_ids)
        key = procedure_key(body.phase, text)
        taken = cursor.execute(
            "SELECT status FROM plan_procedures WHERE plan_id = %s AND phase = %s "
            "AND procedure_key = %s",
            (plan_id, body.phase, key),
        ).fetchone()
        if taken is not None and taken[0] == "ACTIVE":
            raise PlanState("the plan already has this procedure")
        if taken is not None:
            row = cursor.execute(
                """
                UPDATE plan_procedures
                SET status = 'ACTIVE', removed_reason = '', method = %s, origin = 'PERSON',
                    person_edited = true, version = version + 1
                WHERE plan_id = %s AND phase = %s AND procedure_key = %s RETURNING id
                """,
                (body.method, plan_id, body.phase, key),
            ).fetchone()
        else:
            position = cursor.execute(
                "SELECT coalesce(max(position) + 1, 0) FROM plan_procedures WHERE plan_id = %s "
                "AND phase = %s",
                (plan_id, body.phase),
            ).fetchone()
            row = cursor.execute(
                """
                INSERT INTO plan_procedures (
                    organization_id, project_id, plan_id, engagement_control_id, phase,
                    procedure_key, code, position, text, method, origin, person_edited,
                    created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, '', %s, %s, %s, 'PERSON', true, %s)
                RETURNING id
                """,
                (
                    organization_id, project_id, plan_id, control_id, body.phase, key,
                    0 if position is None else int(position[0]), text, body.method, actor,
                ),
            ).fetchone()  # fmt: skip
        assert row is not None
        procedure_id = UUID(str(row[0]))
        _set_procedure_attributes(cursor, organization_id, project_id, control_id,
                                  procedure_id, attributes, actor)  # fmt: skip
        _audit(
            cursor, organization_id, project_id, actor, "plan_procedure.added",
            "plan_procedure", procedure_id, {"phase": body.phase},
        )  # fmt: skip
        return procedure_id


def _procedure_row(
    cursor: psycopg.Cursor[Any], control_id: UUID, procedure_id: UUID
) -> tuple[Any, ...]:
    row = cursor.execute(
        "SELECT id, status, version, phase FROM plan_procedures WHERE id = %s "
        "AND engagement_control_id = %s FOR UPDATE",
        (procedure_id, control_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return tuple(row)


def edit_procedure(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    procedure_id: UUID,
    actor: UUID,
    body: ProcedureEdit,
) -> None:
    text = _clean(body.text)
    with transaction(connection) as cursor:
        _plan_id(cursor, project_id, control_id)
        row = _procedure_row(cursor, control_id, procedure_id)
        if int(row[2]) != body.version:
            raise PlanState("the procedure changed")
        if row[1] != "ACTIVE":
            raise PlanState("the procedure was removed")
        cursor.execute(
            """
            UPDATE plan_procedures
            SET text = %s, method = %s, person_edited = true, version = version + 1
            WHERE id = %s
            """,
            (text, body.method, procedure_id),
        )
        _audit(
            cursor, organization_id, project_id, actor, "plan_procedure.edited",
            "plan_procedure", procedure_id, {},
        )  # fmt: skip


def remove_procedure(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    procedure_id: UUID,
    actor: UUID,
    body: ProcedureRemove,
) -> None:
    reason = _clean(body.reason)
    with transaction(connection) as cursor:
        _plan_id(cursor, project_id, control_id)
        row = _procedure_row(cursor, control_id, procedure_id)
        if int(row[2]) != body.version:
            raise PlanState("the procedure changed")
        if row[1] != "ACTIVE":
            raise PlanState("the procedure was removed")
        cursor.execute(
            """
            UPDATE plan_procedures
            SET status = 'REMOVED', removed_reason = %s, person_edited = true,
                version = version + 1
            WHERE id = %s
            """,
            (reason, procedure_id),
        )
        _audit(
            cursor, organization_id, project_id, actor, "plan_procedure.removed",
            "plan_procedure", procedure_id, {"reason": reason},
        )  # fmt: skip


def _set_procedure_attributes(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    procedure_id: UUID,
    attributes: list[UUID],
    actor: UUID | None,
    origin: str = "PERSON",
) -> None:
    cursor.execute(
        "DELETE FROM plan_procedure_attributes WHERE procedure_id = %s "
        "AND NOT (attribute_id = ANY(%s))",
        (procedure_id, attributes),
    )
    for attribute in attributes:
        cursor.execute(
            """
            INSERT INTO plan_procedure_attributes (
                procedure_id, attribute_id, organization_id, project_id,
                engagement_control_id, origin, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            (procedure_id, attribute, organization_id, project_id, control_id, origin, actor),
        )


def link_procedure(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    procedure_id: UUID,
    actor: UUID,
    body: LinksBody,
) -> None:
    """The attributes a procedure tests, as a person sets them."""
    with transaction(connection) as cursor:
        _plan_id(cursor, project_id, control_id)
        row = _procedure_row(cursor, control_id, procedure_id)
        if row[1] != "ACTIVE":
            raise PlanState("the procedure was removed")
        attributes = _approved_attributes(cursor, control_id, body.attribute_ids)
        _set_procedure_attributes(cursor, organization_id, project_id, control_id,
                                  procedure_id, attributes, actor)  # fmt: skip
        _audit(
            cursor, organization_id, project_id, actor, "plan_procedure.linked",
            "plan_procedure", procedure_id, {"attributes": len(attributes)},
        )  # fmt: skip


def link_requirement(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    actor: UUID,
    body: LinksBody,
) -> None:
    """The attributes an evidence requirement supports and the procedures it serves, as a
    person sets them."""
    with transaction(connection) as cursor:
        plan_id = _plan_id(cursor, project_id, control_id)
        row = cursor.execute(
            "SELECT status FROM evidence_requirements WHERE id = %s AND plan_id = %s FOR UPDATE",
            (requirement_id, plan_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if row[0] == "REMOVED":
            raise PlanState("the requirement is no longer planned")
        attributes = _approved_attributes(cursor, control_id, body.attribute_ids)
        procedures = sorted(set(body.procedure_ids))
        if procedures:
            active = cursor.execute(
                "SELECT count(*) FROM plan_procedures WHERE plan_id = %s AND status = 'ACTIVE' "
                "AND id = ANY(%s)",
                (plan_id, procedures),
            ).fetchone()
            if active is None or int(active[0]) != len(procedures):
                raise PlanState("link only the plan's own procedures")
        set_requirement_links(cursor, organization_id, project_id, control_id, requirement_id,
                              attributes, procedures, actor)  # fmt: skip
        _audit(
            cursor, organization_id, project_id, actor, "evidence_requirement.linked",
            "evidence_requirement", requirement_id,
            {"attributes": len(attributes), "procedures": len(procedures)},
        )  # fmt: skip


def set_requirement_links(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    attributes: list[UUID],
    procedures: list[UUID] | None,
    actor: UUID | None,
    origin: str = "PERSON",
) -> None:
    """Replace a requirement's links. `procedures` None leaves its procedure links."""
    cursor.execute(
        "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
        "AND NOT (attribute_id = ANY(%s))",
        (requirement_id, attributes),
    )
    for attribute in attributes:
        cursor.execute(
            """
            INSERT INTO evidence_requirement_attributes (
                requirement_id, attribute_id, organization_id, project_id,
                engagement_control_id, origin, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            (requirement_id, attribute, organization_id, project_id, control_id, origin, actor),
        )
    if procedures is None:
        return
    cursor.execute(
        "DELETE FROM evidence_requirement_procedures WHERE requirement_id = %s "
        "AND NOT (procedure_id = ANY(%s))",
        (requirement_id, procedures),
    )
    for procedure in procedures:
        cursor.execute(
            """
            INSERT INTO evidence_requirement_procedures (
                requirement_id, procedure_id, organization_id, project_id,
                engagement_control_id, origin, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
            """,
            (requirement_id, procedure, organization_id, project_id, control_id, origin, actor),
        )


def set_criteria(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    attribute_id: UUID,
    actor: UUID,
    body: CriteriaBody,
) -> None:
    """How an attribute is judged, as a person states it. Empty fields fall back to the
    library's definition, where there is one."""
    with transaction(connection) as cursor:
        _plan_id(cursor, project_id, control_id)
        row = cursor.execute(
            "SELECT version, status FROM control_attributes WHERE id = %s "
            "AND engagement_control_id = %s FOR UPDATE",
            (attribute_id, control_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if int(row[0]) != body.version:
            raise PlanState("the attribute changed")
        if row[1] != "APPROVED":
            raise PlanState("decide the attribute first")
        cursor.execute(
            """
            UPDATE control_attributes
            SET objective = %s, condition = %s, pass_criteria = %s, fail_criteria = %s,
                judgment_required = %s, automatable = %s, phases = %s,
                criteria_origin = 'PERSON', version = version + 1
            WHERE id = %s
            """,
            (
                _clean(body.objective), _clean(body.condition), _clean(body.pass_criteria),
                _clean(body.fail_criteria), body.judgment_required, body.automatable,
                sorted(set(body.phases), key=PHASES.index), attribute_id,
            ),
        )  # fmt: skip
        _audit(
            cursor, organization_id, project_id, actor, "control_attribute.criteria_set",
            "control_attribute", attribute_id, {},
        )  # fmt: skip


def accept_criteria(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: AcceptCriteriaBody,
) -> None:
    """A person accepts the planner agent's criteria as they read, for one attribute or
    several at once (migration 0122). All or none: each must be an approved attribute of
    this control whose criteria are still the agent's, at the version the person saw. The
    words do not change, so the plan is not revised."""
    if len({item.id for item in body.attributes}) != len(body.attributes):
        raise PlanState("an attribute is named twice")
    with transaction(connection) as cursor:
        _plan_id(cursor, project_id, control_id)
        for item in body.attributes:
            row = cursor.execute(
                "SELECT version, status, criteria_origin, code FROM control_attributes "
                "WHERE id = %s AND engagement_control_id = %s FOR UPDATE",
                (item.id, control_id),
            ).fetchone()
            if row is None:
                raise NotVisible()
            if int(row[0]) != item.version:
                raise PlanState("the attribute changed")
            if row[1] != "APPROVED":
                raise PlanState("decide the attribute first")
            if row[2] != "AGENT":
                raise PlanState("the criteria are not the agent's")
            cursor.execute(
                """
                UPDATE control_attributes
                SET criteria_accepted_by = %s, criteria_accepted_at = now(),
                    version = version + 1
                WHERE id = %s
                """,
                (actor, item.id),
            )
            _audit(
                cursor, organization_id, project_id, actor, "control_attribute.criteria_accepted",
                "control_attribute", item.id, {"code": str(row[3] or "")},
            )  # fmt: skip


# Routes


def register_master_plans(app: FastAPI, settings: Settings, scheduler: Any = None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"
    control = f"{base}/controls/{{control_id}}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except PlanState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error) or "plan is invalid") from None

    def allowed(
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID | None,
        action: Action,
    ) -> None:
        authorize(
            connection, principal=principal, action=action,
            organization_id=organization_id, project_id=project_id,
        )  # fmt: skip
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            # An agent never edits, submits, or decides a plan.
            raise NotVisible()
        if control_id is None:
            return
        found = connection.execute(
            "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s "
            "AND organization_id = %s",
            (control_id, project_id, organization_id),
        ).fetchone()
        if found is None:
            raise NotVisible()
        if action is not Action.TASK_READ and not found[0]:
            raise PlanState("the control is out of scope")

    def implementation_call[T](work: Callable[[], T]) -> T:
        from ai_workforce_api.implementations import ImplementationState

        try:
            return work()
        except ImplementationState as error:
            raise PlanState(error.detail) from None

    def may_decide(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID, action: Action = Action.PROJECT_UPDATE,
    ) -> bool:  # fmt: skip
        if principal.kind is not PrincipalKind.USER:
            return False
        try:
            authorize(
                connection, principal=principal, action=action,
                organization_id=organization_id, project_id=project_id,
            )  # fmt: skip
        except AccessDenied, NotVisible:
            return False
        return True

    def read(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID, control_id: UUID,
    ) -> MasterPlanBody:  # fmt: skip
        body = master_plan(
            connection, project_id, control_id,
            may_decide(connection, principal, organization_id, project_id),
        )  # fmt: skip
        body.viewer_can_answer = may_decide(
            connection, principal, organization_id, project_id, Action.TASK_UPDATE
        )
        return body

    @app.get(f"{control}/master-plan")
    def get_plan(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> MasterPlanBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_READ)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.get(f"{base}/planning-review")
    def queue(organization_id: UUID, project_id: UUID, request: Request) -> QueueBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> QueueBody:
            allowed(c, p, organization_id, project_id, None, Action.TASK_READ)
            body = planning_queue(c, project_id)
            body.viewer_can_decide = may_decide(c, p, organization_id, project_id)
            body.viewer_can_answer = may_decide(
                c, p, organization_id, project_id, Action.TASK_UPDATE
            )
            return body

        return run(request, work)

    @app.post(f"{base}/planning-review/approve")
    def approve_many(
        organization_id: UUID, project_id: UUID, body: BatchApproveBody, request: Request
    ) -> BatchResult:
        """Approve the plans a reviewer selected, one by one: each plan is checked, approved,
        and recorded on its own, as if approved on its own page. Nothing else is approved."""

        def work(c: psycopg.Connection[Any], p: Principal) -> BatchResult:
            from ai_workforce_api.pbc_drafting import schedule
            from ai_workforce_api.readiness import resume_testing
            from ai_workforce_api.testing_engine import TestScheduler, schedule_runs

            allowed(c, p, organization_id, project_id, None, Action.PROJECT_UPDATE)
            outcomes: list[BatchOutcome] = []
            for item in body.items:
                found = c.execute(
                    "SELECT control_ref, included FROM engagement_controls WHERE id = %s "
                    "AND project_id = %s",
                    (item.control_id, project_id),
                ).fetchone()
                if found is None or not found[1]:
                    outcomes.append(BatchOutcome(
                        control_id=item.control_id, control_ref="", approved=False,
                        detail="The control is not in scope.",
                    ))  # fmt: skip
                    continue
                try:
                    approve(c, organization_id, project_id, item.control_id, p.id,
                            ApproveBody(version=item.version, comment=body.comment))  # fmt: skip
                except PlanState as error:
                    outcomes.append(BatchOutcome(
                        control_id=item.control_id, control_ref=str(found[0]), approved=False,
                        detail=error.detail,
                    ))  # fmt: skip
                    continue
                schedule(scheduler, release(c, organization_id, project_id, item.control_id, p.id))
                schedule_runs(
                    scheduler if isinstance(scheduler, TestScheduler) else None,
                    resume_testing(c, project_id, item.control_id),
                )
                outcomes.append(BatchOutcome(
                    control_id=item.control_id, control_ref=str(found[0]), approved=True,
                    detail="",
                ))  # fmt: skip
            return BatchResult(
                outcomes=outcomes, approved=sum(1 for item in outcomes if item.approved)
            )

        return run(request, work)

    @app.get(f"{base}/planning-review/families")
    def plan_families(organization_id: UUID, project_id: UUID, request: Request) -> FamiliesBody:
        from ai_workforce_api.shared_plans import families

        def work(c: psycopg.Connection[Any], p: Principal) -> FamiliesBody:
            allowed(c, p, organization_id, project_id, None, Action.TASK_READ)
            body = families(c, project_id)
            body.viewer_can_decide = may_decide(c, p, organization_id, project_id)
            return body

        return run(request, work)

    @app.post(f"{base}/planning-review/families/approve")
    def approve_family(organization_id: UUID, project_id: UUID, request: Request,
                       body: GroupApproveBody) -> GroupResult:  # fmt: skip
        """One decision for every implementation whose plan is the shared plan; each gets
        its own recorded approval (shared_plans.approve_group)."""
        from ai_workforce_api.pbc_drafting import schedule
        from ai_workforce_api.readiness import resume_testing
        from ai_workforce_api.shared_plans import approve_group
        from ai_workforce_api.testing_engine import TestScheduler, schedule_runs

        def work(c: psycopg.Connection[Any], p: Principal) -> GroupResult:
            allowed(c, p, organization_id, project_id, None, Action.PROJECT_UPDATE)
            result = approve_group(c, organization_id, project_id, p.id, body)
            for control_id in result.approved:
                schedule(scheduler, release(c, organization_id, project_id, control_id, p.id))
                schedule_runs(
                    scheduler if isinstance(scheduler, TestScheduler) else None,
                    resume_testing(c, project_id, control_id),
                )
            return result

        return run(request, work)

    @app.get(f"{base}/scope-units")
    def scope_units(organization_id: UUID, project_id: UUID, request: Request) -> list[ScopeUnit]:
        from ai_workforce_api.implementations import units

        def work(c: psycopg.Connection[Any], p: Principal) -> list[ScopeUnit]:
            allowed(c, p, organization_id, project_id, None, Action.TASK_READ)
            return units(c, project_id)

        return run(request, work)

    @app.post(f"{base}/scope-units")
    def add_scope_unit(organization_id: UUID, project_id: UUID, request: Request,
                       body: UnitCreate) -> list[ScopeUnit]:  # fmt: skip
        from ai_workforce_api.implementations import add_unit

        def work(c: psycopg.Connection[Any], p: Principal) -> list[ScopeUnit]:
            allowed(c, p, organization_id, project_id, None, Action.TASK_UPDATE)
            return implementation_call(lambda: add_unit(c, organization_id, project_id, p.id,
                                                        body))  # fmt: skip

        return run(request, work)

    @app.post(f"{control}/coverage")
    def set_control_coverage(organization_id: UUID, project_id: UUID, control_id: UUID,
                             request: Request, body: CoverageBody) -> Scope:  # fmt: skip
        from ai_workforce_api.implementations import set_coverage

        def work(c: psycopg.Connection[Any], p: Principal) -> Scope:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            return implementation_call(lambda: set_coverage(
                c, organization_id, project_id, control_id, p.id, body
            ))  # fmt: skip

        return run(request, work)

    @app.post(f"{control}/split")
    def split_control(organization_id: UUID, project_id: UUID, control_id: UUID,
                      request: Request, body: SplitBody) -> list[UUID]:  # fmt: skip
        """Operate the control separately per unit: an engagement lead's or authorized
        reviewer's decision (project.update), with its reason. The new implementations are
        planned with the reviewed rules."""
        from ai_workforce_api.evidence_plans import generate
        from ai_workforce_api.implementations import split
        from ai_workforce_api.pbc_drafting import schedule

        def work(c: psycopg.Connection[Any], p: Principal) -> list[UUID]:
            allowed(c, p, organization_id, project_id, control_id, Action.PROJECT_UPDATE)
            created = implementation_call(lambda: split(
                c, organization_id, project_id, control_id, p.id, body
            ))  # fmt: skip
            # The implementations are planned together, with the reviewed rules, so they share
            # one plan: the original again too, unless a person approved its plan (which
            # stays; any difference is then shown and reviewed on its own).
            source = c.execute(
                "SELECT status FROM evidence_plans WHERE engagement_control_id = %s",
                (control_id,),
            ).fetchone()
            again = [] if source is not None and source[0] in APPROVED_STATUSES else [control_id]
            drafts: list[UUID] = []
            for planned in [*again, *created]:
                _changes, queued, _note = generate(c, None, organization_id, project_id,
                                                   planned, p.id)  # fmt: skip
                drafts += queued
            schedule(scheduler, drafts)
            return created

        return run(request, work)

    @app.post(f"{base}/evidence-plans/replan")
    def replan(organization_id: UUID, project_id: UUID, request: Request) -> Replanned:
        def work(c: psycopg.Connection[Any], p: Principal) -> Replanned:
            allowed(c, p, organization_id, project_id, None, Action.TASK_UPDATE)
            status = c.execute(
                "SELECT status FROM projects WHERE id = %s AND organization_id = %s",
                (project_id, organization_id),
            ).fetchone()
            if status is None:
                raise NotVisible()
            if status[0] != "ACTIVE":
                raise PlanState("the engagement is not running")
            return replan_unapproved(c, organization_id, project_id, p.id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/request-changes")
    def changes(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: RequestChangesBody,
        request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.PROJECT_UPDATE)
            request_changes(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/submit")
    def submit_plan(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: SubmitBody,
        request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            submit(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/evidence-plan/pending-revision")
    def pending_revision(
        organization_id: UUID, project_id: UUID, control_id: UUID,
        body: PendingRevisionDecision, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            decide_pending_revision(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.put(f"{control}/master-plan/facts")
    def put_facts(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: FactsBody,
        request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        """Facts the team states for a client's own control (the plan's Describe dialog)."""

        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            state_facts(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/master-plan/replan")
    def replan_control(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> Replanned:
        """Plan this control again with the reviewed rules (a finding's fix on its plan)."""

        def work(c: psycopg.Connection[Any], p: Principal) -> Replanned:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            done = replan_unapproved(c, organization_id, project_id, p.id, control_id)
            if done.planned == 0:
                raise PlanState("an approved plan, or one being drafted, is not planned again")
            return done

        return run(request, work)

    @app.post(f"{control}/master-plan/procedures")
    def add(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ProcedureAdd,
        request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            add_procedure(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    procedure = f"{control}/master-plan/procedures/{{procedure_id}}"

    @app.post(procedure)
    def edit(
        organization_id: UUID, project_id: UUID, control_id: UUID, procedure_id: UUID,
        body: ProcedureEdit, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            edit_procedure(c, organization_id, project_id, control_id, procedure_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{procedure}/remove")
    def remove(
        organization_id: UUID, project_id: UUID, control_id: UUID, procedure_id: UUID,
        body: ProcedureRemove, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            remove_procedure(c, organization_id, project_id, control_id, procedure_id, p.id,
                             body)  # fmt: skip
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.put(f"{procedure}/attributes")
    def procedure_links(
        organization_id: UUID, project_id: UUID, control_id: UUID, procedure_id: UUID,
        body: LinksBody, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            link_procedure(c, organization_id, project_id, control_id, procedure_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.put(f"{control}/master-plan/evidence/{{requirement_id}}/links")
    def requirement_links(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        body: LinksBody, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            link_requirement(c, organization_id, project_id, control_id, requirement_id, p.id,
                             body)  # fmt: skip
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/master-plan/attributes/{{attribute_id}}/criteria")
    def criteria(
        organization_id: UUID, project_id: UUID, control_id: UUID, attribute_id: UUID,
        body: CriteriaBody, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            set_criteria(c, organization_id, project_id, control_id, attribute_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/master-plan/criteria/accept")
    def criteria_accept(
        organization_id: UUID, project_id: UUID, control_id: UUID,
        body: AcceptCriteriaBody, request: Request,
    ) -> MasterPlanBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> MasterPlanBody:
            allowed(c, p, organization_id, project_id, control_id, Action.TASK_UPDATE)
            accept_criteria(c, organization_id, project_id, control_id, p.id, body)
            return read(c, p, organization_id, project_id, control_id)

        return run(request, work)

    # Approving is the evidence plan's route (evidence_plans.register_evidence_plans),
    # which calls `approve` here with project.update, then requests what the gate allows
    # and resumes testing that waited.
