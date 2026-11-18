"""Shared control plans (Unified planning, Release 1; docs/unified-planning-r1.md).

A control in the engagement is planned once for all of its implementations (its family:
the rows with one control ID, per system or per unit it operates in). Each plan is
compared, as a reviewer approves it (master_plans.content), with a reference plan, with
only the parameters in NONMATERIAL set aside. The reference (reference_of; decided by the
product owner, 23 October 2026) is the approved plan where one is approved; otherwise the
plan the largest group of implementations share, proposed for a reviewer's decision and
never approved by rule; and none on a tie, where each plan is reviewed on its own:

- SAME_PLAN: the plans are the same. The reviewer decides them together.
- DIFFERENT_PLAN: anything else differs. It is shown, and the plan is reviewed on its own.
  No difference is treated as immaterial by rule (decided by the product owner): a report
  name, a population source, an account range, a threshold are all differences.
- NEEDS_INFORMATION: no plan yet, still planning, or something holds its approval.

One group decision approves every implementation ready together, all or none. Each still
gets its own plan version and decision, through the same approval a single plan takes,
which names the group decision, the shared plan's fingerprint, and its scope. The group
decision keeps exactly what the reviewer was shown and its fingerprint: a plan changed
since the page was read refuses the whole decision.
"""

import json
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel, Field

from ai_workforce_api.db import transaction
from ai_workforce_api.implementations import Scope, scopes

Applicability = Literal["SAME_PLAN", "DIFFERENT_PLAN", "NEEDS_INFORMATION"]
Group = Literal["TOGETHER", "SEPARATE", "WAITING", "DONE"]
ReferenceBasis = Literal["APPROVED", "LARGEST_GROUP", "ONLY_PLAN", "NONE"]
# What a comparison sets aside, and nothing else (masked). Everything else in a plan is
# compared as it stands: a report name, a population source, an account range, an
# administrator group, a threshold.
NONMATERIAL = (
    "the plan's revision and schema numbers",
    "the system the control row names",
    "the implementation's own system and unit names, where the plan uses them exactly as recorded",
)
PLACEHOLDER = "{implementation}"
APPLICABILITY_LABELS: dict[str, str] = {
    "SAME_PLAN": "Same plan",
    "DIFFERENT_PLAN": "Different plan",
    "NEEDS_INFORMATION": "Needs information",
}
_SECTIONS = ("control", "understanding", "facts", "phases", "procedures", "attributes",
             "evidence", "provisional")  # fmt: skip
_SECTION_LABELS = {
    "control": "Control",
    "understanding": "Understanding",
    "facts": "Facts",
    "phases": "Phases",
    "procedures": "Procedures",
    "attributes": "Attributes",
    "evidence": "Evidence",
    "provisional": "Plan status",
}


class Difference(BaseModel):
    """One thing that differs from the shared plan."""

    section: str
    section_label: str
    item: str
    change: Literal["ADDED", "REMOVED", "CHANGED"]
    # The fields that differ, by name, for a changed item.
    fields: list[str] = Field(default_factory=list)
    shared: str = ""
    this: str = ""


class SharedItem(BaseModel):
    code: str
    text: str


class SharedPlan(BaseModel):
    """The shared plan, shown once: its procedures, attributes, and evidence."""

    procedures: list[SharedItem]
    attributes: list[SharedItem]
    evidence: list[SharedItem]


class Implementation(BaseModel):
    control_id: UUID
    label: str
    scope: Scope
    lead: bool
    applicability: Applicability
    applicability_label: str
    # Why, in a line: what holds it, or how many things differ.
    reason: str
    state: str
    state_label: str
    approved: bool
    version: int
    revision: int
    differences: list[Difference] = Field(default_factory=list)


class Family(BaseModel):
    control_ref: str
    title: str
    area: str
    classifications: list[str]
    group: Group
    implementations: list[Implementation]
    # Where the shared plan comes from (reference_of), in a line for the reviewer.
    reference_basis: ReferenceBasis = "NONE"
    reference_note: str = ""
    # The implementations a group decision approves now, in order, and the fingerprint of
    # what is presented for it; empty when none is ready.
    ready: list[UUID] = Field(default_factory=list)
    presented_hash: str = ""
    shared_hash: str = ""
    shared: SharedPlan | None = None
    last_group_decision_by: str | None = None
    last_group_decision_at: datetime | None = None


class FamiliesBody(BaseModel):
    families: list[Family]
    counts: dict[str, int]
    # Decisions a person makes now, and the plans they cover (fewer decisions than plans
    # is the point).
    decisions: int
    plans: int
    viewer_can_decide: bool = False


class GroupItem(BaseModel):
    control_id: UUID
    version: int = Field(ge=1)


class GroupApproveBody(BaseModel):
    control_ref: str = Field(min_length=1, max_length=100)
    items: list[GroupItem] = Field(min_length=1, max_length=100)
    presented_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    comment: str = Field(default="", max_length=4000)


class GroupResult(BaseModel):
    group_decision_id: UUID
    approved: list[UUID]


# Comparing plans


def masked(snapshot: dict[str, Any], names: Iterable[str]) -> dict[str, Any]:
    """The plan as its implementations share it (NONMATERIAL): its revision and system
    left out, and the implementation's own names replaced by one placeholder, whole words
    only and exactly as recorded (a unit named "US" leaves the word "us" alone)."""
    body = {key: value for key, value in snapshot.items() if key not in ("revision", "schema")}
    control = dict(body.get("control") or {})
    control.pop("application", None)
    body["control"] = control
    patterns = [
        re.compile(rf"(?<![\w]){re.escape(name)}(?![\w])")
        for name in sorted({n for n in names if len(n.strip()) >= 2}, key=len, reverse=True)
    ]

    def walk(value: Any) -> Any:
        if isinstance(value, str):
            for pattern in patterns:
                value = pattern.sub(PLACEHOLDER, value)
            return value
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        return value

    walked: dict[str, Any] = walk(body)
    return walked


def differences(shared: dict[str, Any], this: dict[str, Any], limit: int = 40) -> list[Difference]:
    """What differs between two masked plans, by section and item."""
    found: list[Difference] = []
    for section in _SECTIONS:
        left, right = shared.get(section), this.get(section)
        if left == right:
            continue
        label = _SECTION_LABELS[section]
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                if left.get(key) != right.get(key):
                    found.append(Difference(
                        section=section, section_label=label, item=key.replace("_", " "),
                        change="CHANGED", fields=[key], shared=_short(left.get(key)),
                        this=_short(right.get(key)),
                    ))  # fmt: skip
        elif isinstance(left, list) and isinstance(right, list):
            key = {"facts": "field", "phases": "phase"}.get(section, "code")
            by_left = {_item_key(item, key): item for item in left}
            by_right = {_item_key(item, key): item for item in right}
            for name in sorted(set(by_left) | set(by_right)):
                a, b = by_left.get(name), by_right.get(name)
                if a == b:
                    continue
                if a is None:
                    found.append(Difference(section=section, section_label=label, item=name,
                                            change="ADDED", this=_short(b)))  # fmt: skip
                elif b is None:
                    found.append(Difference(section=section, section_label=label, item=name,
                                            change="REMOVED", shared=_short(a)))  # fmt: skip
                else:
                    fields = (
                        sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
                        if isinstance(a, dict) and isinstance(b, dict)
                        else []
                    )
                    found.append(Difference(
                        section=section, section_label=label, item=name, change="CHANGED",
                        fields=fields,
                        shared=_short(_fields(a, fields)),
                        this=_short(_fields(b, fields)),
                    ))  # fmt: skip
        else:
            found.append(Difference(
                section=section, section_label=label, item=label, change="CHANGED",
                shared=_short(left), this=_short(right),
            ))  # fmt: skip
        if len(found) >= limit:
            break
    return found[:limit]


def _fields(item: Any, fields: list[str]) -> Any:
    """What a changed item holds in the fields that differ: the one value itself when one
    field differs (read as text, not as a record), else those fields."""
    if not fields:
        return item
    if len(fields) == 1:
        return item.get(fields[0])
    return {key: item.get(key) for key in fields}


def _item_key(item: Any, key: str) -> str:
    if isinstance(item, dict):
        return str(item.get(key) or json.dumps(item, sort_keys=True, default=str))
    return json.dumps(item, sort_keys=True, default=str)


def _short(value: Any, limit: int = 240) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


# The reference plan


@dataclass(frozen=True)
class Reference:
    control_id: UUID | None
    basis: ReferenceBasis
    # How many comparable plans are the reference's, and of how many.
    agree: int = 0
    of: int = 0
    conflicting: bool = False


def reference_of(candidates: list[tuple[UUID, str, bool]]) -> Reference:
    """The plan a control's other plans are compared with, from each comparable plan's
    (implementation, fingerprint once masked, approved), in display order.

    - An approved plan is the reference; where approved plans differ, there is none.
    - Otherwise the plan the largest group shares, proposed for a reviewer's decision.
    - A tie, or nothing to compare, is no reference: each plan is reviewed on its own."""
    approved = [item for item in candidates if item[2]]
    if approved:
        if len({item[1] for item in approved}) > 1:
            return Reference(None, "NONE", of=len(candidates), conflicting=True)
        agree = sum(1 for item in candidates if item[1] == approved[0][1])
        return Reference(approved[0][0], "APPROVED", agree, len(candidates))
    if not candidates:
        return Reference(None, "NONE")
    if len(candidates) == 1:
        return Reference(candidates[0][0], "ONLY_PLAN", 1, 1)
    ranked = Counter(item[1] for item in candidates).most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return Reference(None, "NONE", of=len(candidates))
    shared = ranked[0][0]
    first = next(item for item in candidates if item[1] == shared)
    return Reference(first[0], "LARGEST_GROUP", ranked[0][1], len(candidates))


def reference_note(reference: Reference, label: str) -> str:
    """Where the shared plan comes from, for the reviewer."""
    if reference.basis == "APPROVED":
        return f"The approved plan for {label or 'the whole engagement'} is the reference."
    if reference.basis == "LARGEST_GROUP":
        if reference.agree == reference.of:
            every = "both" if reference.of == 2 else f"all {reference.of}"
            return f"Proposed: {every} plans are the same. A reviewer approves it."
        return (
            f"Proposed: the plan {reference.agree} of {reference.of} implementations share. "
            "A reviewer approves it."
        )
    if reference.basis == "ONLY_PLAN":
        return "The only plan ready to compare."
    if reference.conflicting:
        return (
            "The approved plans for this control differ, so each other plan is reviewed on its own."
        )
    if reference.of > 1:
        return (
            "No plan is shared by more implementations than another, so each is reviewed "
            "on its own."
        )
    return "No plan can be compared yet."


# Families


def families(connection: psycopg.Connection[Any], project_id: UUID) -> FamiliesBody:
    """Every in-scope control as one family of implementations, and its review group."""
    from ai_workforce_api.control_context import classifications_of
    from ai_workforce_api.controls import DOMAIN_LABELS
    from ai_workforce_api.master_plans import (
        STATE_LABELS,
        _load,
        blockers_of,
        content,
        content_hash,
        state_of,
    )

    plans = _load(connection, project_id)
    where = scopes(connection, project_id)
    grouped: dict[str, list[Any]] = {}
    for plan in plans.values():
        grouped.setdefault(plan.control_ref, []).append(plan)
    decided = {
        str(row[0]): (str(row[1]), row[2])
        for row in connection.execute(
            """
            SELECT DISTINCT ON (g.control_ref) g.control_ref, u.display_name, g.decided_at
            FROM plan_group_decisions g JOIN users u ON u.id = g.decided_by
            WHERE g.project_id = %s ORDER BY g.control_ref, g.decided_at DESC
            """,
            (project_id,),
        ).fetchall()
    }
    found: list[Family] = []
    for ref, members in grouped.items():
        members.sort(key=lambda plan: where.get(plan.control_id, Scope()).label().lower())
        states = {plan.control_id: state_of(plan, blockers_of(plan)) for plan in members}
        snapshots: dict[UUID, dict[str, Any]] = {}
        for plan in members:
            if plan.plan_id is not None and states[plan.control_id] != "ANALYZING":
                own = where.get(plan.control_id, Scope())
                snapshots[plan.control_id] = masked(content(plan), own.names())
        blocked = {
            plan.control_id
            for plan in members
            if states[plan.control_id] != "APPROVED"
            and any(item.blocks for item in blockers_of(plan))
        }
        reference = reference_of([
            (plan.control_id, content_hash(snapshots[plan.control_id]),
             states[plan.control_id] == "APPROVED")
            for plan in members
            if plan.control_id in snapshots and plan.control_id not in blocked
        ])  # fmt: skip
        lead = next((plan for plan in members if plan.control_id == reference.control_id), None)
        lead_snapshot = None if lead is None else snapshots[lead.control_id]
        rows: list[Implementation] = []
        for plan in members:
            own = where.get(plan.control_id, Scope())
            state = states[plan.control_id]
            blocks = [item for item in blockers_of(plan) if item.blocks]
            mine = snapshots.get(plan.control_id)
            approved = state == "APPROVED"
            diffs: list[Difference] = []
            if mine is None:
                applicability: Applicability = "NEEDS_INFORMATION"
                reason = "Still planning" if state == "ANALYZING" else "Not planned yet"
            elif blocks and not approved:
                applicability, reason = "NEEDS_INFORMATION", blocks[0].detail
            elif lead_snapshot is None:
                applicability = "DIFFERENT_PLAN"
                reason = (
                    "Approved on its own" if approved else "No shared plan; reviewed on its own"
                )
            elif mine == lead_snapshot:
                applicability, reason = "SAME_PLAN", "The shared plan"
            else:
                applicability = "DIFFERENT_PLAN"
                diffs = differences(lead_snapshot, mine)
                reason = (
                    f"{len(diffs)} difference{'' if len(diffs) == 1 else 's'} from the shared plan"
                )
            label = own.label()
            rows.append(Implementation(
                control_id=plan.control_id,
                label=label or "Whole engagement",
                scope=own,
                lead=lead is not None and plan.control_id == lead.control_id,
                applicability=applicability,
                applicability_label=APPLICABILITY_LABELS[applicability],
                reason=reason,
                state=state,
                state_label=STATE_LABELS[state],
                approved=approved,
                version=plan.version,
                revision=plan.revision,
                differences=diffs,
            ))  # fmt: skip
        ready = [
            row.control_id for row in rows
            if not row.approved and row.applicability == "SAME_PLAN"
        ]  # fmt: skip
        separate = [
            row for row in rows
            if not row.approved and row.applicability == "DIFFERENT_PLAN"
        ]  # fmt: skip
        waiting = [
            row for row in rows
            if not row.approved and row.applicability == "NEEDS_INFORMATION"
        ]  # fmt: skip
        group: Group = (
            "TOGETHER" if ready else "SEPARATE" if separate else "WAITING" if waiting else "DONE"
        )
        first = members[0]
        family = Family(
            control_ref=ref,
            title=first.title,
            area=DOMAIN_LABELS.get(first.domain, first.domain),
            # What the control is, overlapping (control_context): the team's choice, else
            # what its area and nature say.
            classifications=list(
                classifications_of(first.classifications or None, first.domain, first.nature)
            ),
            group=group,
            implementations=rows,
            reference_basis=reference.basis,
            reference_note=reference_note(
                reference, where.get(lead.control_id, Scope()).label() if lead else ""
            ),
            ready=ready,
            shared_hash="" if lead_snapshot is None else content_hash(lead_snapshot),
            shared=None if lead is None else _shared(lead),
            last_group_decision_by=decided.get(ref, (None, None))[0],
            last_group_decision_at=decided.get(ref, (None, None))[1],
        )
        if ready:
            family.presented_hash = content_hash(presented(family, plans))
        found.append(family)
    order = {"TOGETHER": 0, "SEPARATE": 1, "WAITING": 2, "DONE": 3}
    found.sort(key=lambda family: (order[family.group], family.control_ref))
    counts = {key: sum(1 for family in found if family.group == key) for key in order}
    open_plans = sum(1 for f in found for row in f.implementations if not row.approved)
    # One decision for the plans ready together, and one per plan reviewed on its own.
    decisions = sum(
        (1 if f.ready else 0)
        + sum(
            1 for row in f.implementations
            if not row.approved and row.applicability != "SAME_PLAN"
        )
        for f in found
    )  # fmt: skip
    return FamiliesBody(families=found, counts=counts, decisions=decisions, plans=open_plans)


def _shared(plan: Any) -> SharedPlan:
    def first_line(text: Any) -> str:
        return str(text or "").strip().split("\n", 1)[0][:300]

    return SharedPlan(
        procedures=[SharedItem(code=str(p["code"]), text=first_line(p["text"]))
                    for p in plan.procedures],
        attributes=[SharedItem(code=str(a["code"]), text=first_line(a["text"]))
                    for a in plan.attributes],
        evidence=[SharedItem(code=str(e["code"]), text=first_line(e["title"]))
                  for e in plan.requirements if e["status"] != "WAIVED"],
    )  # fmt: skip


def presented(family: Family, plans: dict[UUID, Any]) -> dict[str, Any]:
    """What a reviewer is shown for a group decision, and what its fingerprint covers: the
    shared plan, and each implementation it approves with its plan's own fingerprint."""
    from ai_workforce_api.master_plans import content, content_hash

    return {
        "control_ref": family.control_ref,
        "shared_hash": family.shared_hash,
        "reference": {
            "basis": family.reference_basis,
            "control_id": next(
                (str(row.control_id) for row in family.implementations if row.lead), None
            ),
            "note": family.reference_note,
        },
        "shared": None if family.shared is None else family.shared.model_dump(),
        "implementations": [
            {
                "control_id": str(row.control_id),
                "label": row.label,
                "scope": row.scope.model_dump(),
                "applicability": row.applicability,
                "revision": row.revision,
                "version": row.version,
                "plan_hash": content_hash(content(plans[row.control_id])),
            }
            for row in family.implementations
            if row.control_id in family.ready
        ],
    }


def family_of(connection: psycopg.Connection[Any], project_id: UUID, control_ref: str) -> Family:
    from ai_workforce_api.evidence_plans import PlanState

    found = next(
        (f for f in families(connection, project_id).families if f.control_ref == control_ref),
        None,
    )
    if found is None:
        raise PlanState("the control is not in scope")
    return found


def approve_group(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    body: GroupApproveBody,
) -> GroupResult:
    """Approve, in one decision, every implementation whose plan is the shared plan.
    Exactly the implementations presented, each at the version shown; a different plan, a
    plan that needs information, or anything changed since the page was read refuses the
    whole decision. Each implementation is approved through the same approval a single
    plan takes, all in one transaction."""
    from ai_workforce_api.evidence_plans import PlanState
    from ai_workforce_api.master_plans import (
        ApproveBody,
        GroupLink,
        _load,
        approve,
        content_hash,
    )

    with transaction(connection) as cursor:
        family = family_of(connection, project_id, body.control_ref)
        wanted = [item.control_id for item in body.items]
        if len(set(wanted)) != len(wanted):
            raise PlanState("an implementation is listed twice")
        rows = {row.control_id: row for row in family.implementations}
        for item in body.items:
            row = rows.get(item.control_id)
            if row is None:
                raise PlanState("an implementation is not part of this control")
            if row.approved:
                raise PlanState(f"{row.label} is approved already")
            if row.applicability != "SAME_PLAN":
                raise PlanState(f"{row.label}: {row.reason.lower()}; review it on its own")
            if row.version != item.version:
                raise PlanState("a plan changed; review the control again")
        if set(wanted) != set(family.ready):
            raise PlanState("the plans ready to approve together changed; review them again")
        shown = presented(family, _load(connection, project_id))
        if content_hash(shown) != body.presented_hash:
            raise PlanState("what was shown has changed; review the control again")
        decided = cursor.execute(
            """
            INSERT INTO plan_group_decisions (organization_id, project_id, control_ref,
                                              shared_hash, presented, presented_hash, comment,
                                              decided_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (organization_id, project_id, body.control_ref, family.shared_hash,
             json.dumps(shown), body.presented_hash, body.comment.strip(), actor),
        ).fetchone()  # fmt: skip
        assert decided is not None
        group_id = UUID(str(decided[0]))
        link = GroupLink(group_decision_id=group_id, shared_hash=family.shared_hash)
        for item in body.items:
            approve(
                connection, organization_id, project_id, item.control_id, actor,
                ApproveBody(version=item.version, comment=body.comment), group=link,
            )  # fmt: skip
        # Every implementation shown has its own record of this decision, or none stands.
        made = cursor.execute(
            "SELECT count(*) FROM plan_decisions WHERE group_decision_id = %s", (group_id,)
        ).fetchone()
        if made is None or int(made[0]) != len(wanted):
            raise PlanState("the plans changed while they were approved; review the control again")
        cursor.execute(
            """
            INSERT INTO audit_events (organization_id, project_id, actor_user_id, action,
                                      target_type, target_id, payload)
            VALUES (%s, %s, %s, 'plan_group.approved', 'plan_group_decision', %s, %s)
            """,
            (organization_id, project_id, actor, group_id,
             json.dumps({"control_ref": body.control_ref, "approved": [str(i) for i in wanted],
                         "shared_hash": family.shared_hash})),
        )  # fmt: skip
    return GroupResult(group_decision_id=group_id, approved=wanted)
