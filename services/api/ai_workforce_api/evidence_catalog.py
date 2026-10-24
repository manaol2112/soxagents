"""The evidence catalog and evidence specifications (Release 2a; docs/release-2a.md).

The library's evidence items are each written for one control (`ac01-e1`, `cm01-e3`), so
nothing in a plan says that two controls want the same artifact. The catalog names the
kinds of artifact several requirements can genuinely share, and which library items are
which kind; everything else is specific to its control. A requirement's specification is
what artifact would satisfy it in those terms; two specifications are compared by the
rules in `compatibility`, which only classify: R2a shares nothing.

Release 1's entity isolation holds: requirements in different operating units are never
compatible. Samples are never shared across controls. A requirement outside the catalog
(written by a person or the agent, or of a custom control) is never shared.

Sensitivity is reviewed, not guessed (owner, 24 October 2026): a library item holds
personal data (HR or payroll records about people) only by the reviewed lists below, and
evidence whose sensitivity is not established (a custom control's, or one written by a
person or the agent) is UNKNOWN: never shared, never grouped with other evidence, and not
sendable until a person classifies it.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

# Revision 2: sensitivity reviewed item by item (revision 1 matched words). Policies
# shared across different controls are still not mapped (a later revision, by review).
CATALOG_VERSION = 2

Kind = Literal[
    "POLICY_DOCUMENT",
    "HR_LEAVERS",
    "HR_TRANSFERS",
    "DEPLOYMENT_LOG",
    "CHANGE_RIGHTS",
    "DAY_CALENDAR",
    "CONTROL_SPECIFIC",
]
Level = Literal["ORGANIZATION", "ENGAGEMENT", "SYSTEM", "CONTROL"]
PeriodType = Literal["IN_FORCE", "WINDOW", "AS_OF"]
Verdict = Literal["IDENTICAL", "DIFFERENCES", "INCOMPATIBLE"]
Sensitivity = Literal["STANDARD", "PERSONAL", "UNKNOWN"]


@dataclass(frozen=True)
class KindRule:
    label: str
    level: Level
    period: PeriodType
    personal_data: bool


KINDS: dict[Kind, KindRule] = {
    "POLICY_DOCUMENT": KindRule("Policy or procedure", "ORGANIZATION", "IN_FORCE", False),
    "HR_LEAVERS": KindRule("HR leavers listing", "ORGANIZATION", "WINDOW", True),
    "HR_TRANSFERS": KindRule("HR transfers listing", "ORGANIZATION", "WINDOW", True),
    "DEPLOYMENT_LOG": KindRule("Production deployment log", "SYSTEM", "WINDOW", False),
    "CHANGE_RIGHTS": KindRule("Users able to change a configuration", "SYSTEM", "AS_OF", False),
    "DAY_CALENDAR": KindRule("Calendar of days", "ENGAGEMENT", "WINDOW", False),
    "CONTROL_SPECIFIC": KindRule("Specific to one control", "CONTROL", "WINDOW", False),
}

# Library evidence items (version 4 suites) of a shareable kind other than a policy, item
# by item, with what distinguishes one instance from another. Reviewed with the library.
ITEM_KINDS: dict[str, tuple[Kind, dict[str, str]]] = {
    "ac02-e3": ("HR_LEAVERS", {}),
    "ac07-e3": ("HR_TRANSFERS", {}),
    "cm01-e3": ("DEPLOYMENT_LOG", {"selection": "all deployments"}),
    "cm02-e4": ("DEPLOYMENT_LOG", {"selection": "deployments outside the normal release path"}),
    "cm07-e4": ("DEPLOYMENT_LOG", {"selection": "deployments of releases"}),
    "ac05-e5": ("CHANGE_RIGHTS", {"configuration": "authentication settings"}),
    "op03-e5": ("CHANGE_RIGHTS", {"configuration": "backup configuration"}),
    **{
        f"itac{n:02d}-e5": ("CHANGE_RIGHTS", {"configuration": f"itac{n:02d}"})
        for n in range(3, 14)
    },
    "op01-e3": ("DAY_CALENDAR", {}),
    "ac12-e3": ("DAY_CALENDAR", {}),
    "op06-e3": ("DAY_CALENDAR", {}),
}
# Rules-generated items (controls without a suite): the control's own documentation, a
# policy kind shared by its implementations; every other one is specific to the control.
GENERIC_POLICY_KEYS = frozenset({"procedure", "process-narrative", "review-precision"})
GENERIC_CONTROL_KEYS = frozenset({
    "changes", "sample-evidence", "population-support", "population", "walkthrough",
})  # fmt: skip
# Library evidence items that hold HR or payroll records about people, reviewed item by
# item (24 October 2026). A test lists every item whose wording mentions HR, payroll,
# employees, leavers, or transfers and fails unless it is in one of these two lists.
SENSITIVE_ITEMS = frozenset({
    "ac01-e8", "ac06-e7", "ac02-e2", "ac02-e3", "ac02-e4", "ac07-e2", "ac07-e3", "ac07-e4",
    "ac07-e7", "ipe05-e2", "ipe05-e4", "ipe05-e5", "ipe05-e6", "itac11-e3",
})  # fmt: skip
REVIEWED_NOT_SENSITIVE = frozenset({
    "ac02-e1", "ac02-e5", "ac02-e7", "ac02-e8", "ac07-e1", "ac07-e5", "ac07-e6", "ac07-e8",
    "ipe05-e1", "ipe05-e3", "itac11-e1", "itac11-e2", "itac11-e4",
})  # fmt: skip
# Areas whose evidence, beyond the control's documented procedure, is about people's pay
# or employment: every such item is personal data.
SENSITIVE_AREAS = frozenset({"HIRE_TO_RETIRE"})


class Spec(BaseModel):
    """What artifact would satisfy a requirement, in the catalog's terms."""

    catalog_version: int = CATALOG_VERSION
    kind: Kind | None
    # Why it is outside the catalog, when it is (kind None).
    unmapped_reason: str = ""
    # What distinguishes one instance of the artifact from another (a document, a
    # selection, a configuration).
    identity: dict[str, str] = Field(default_factory=dict)
    level: Level | None = None
    # The system, when the kind is per system (or the control is specific to one).
    system: str | None = None
    # The control, when the evidence is specific to it.
    control: str | None = None
    # Release 1's operating units of the implementation: never crossed.
    units: list[str] = Field(default_factory=list)
    period_type: PeriodType = "WINDOW"
    period_start: date | None = None
    period_end: date | None = None
    as_of: date | None = None
    sensitivity: Sensitivity = "UNKNOWN"
    sample: bool = False
    # Who provides it (the library's provider role); delivery, not identity.
    provider: str = ""


class Compatibility(BaseModel):
    verdict: Verdict
    reasons: list[str] = Field(default_factory=list)
    differences: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class RequirementFacts:
    """What a specification is computed from: the requirement and its control."""

    requirement_key: str
    phase: str
    title: str
    categories: tuple[str, ...]
    origin: str
    period_start: date | None
    period_end: date | None
    as_of: date | None
    control_id: str
    library_key: str
    application_id: str | None
    implementation_key: str
    # The control's area (engagement_controls.domain).
    domain: str = ""


def _item_key(requirement_key: str, phase: str) -> str:
    prefix = f"{phase.lower()}-"
    return requirement_key[len(prefix) :] if requirement_key.startswith(prefix) else requirement_key


def units_of(implementation_key: str) -> list[str]:
    """The operating units in an implementation key (migration 0104): after the colon."""
    _system, _colon, units = implementation_key.partition(":")
    return sorted(unit for unit in units.split(",") if unit)


def specification(facts: RequirementFacts) -> Spec:
    """A requirement's specification: its library item's kind, else the rules-generated
    item's, else outside the catalog."""
    from ai_workforce_api.definition_registry import BY_LIBRARY_KEY

    item_key = _item_key(facts.requirement_key, facts.phase)
    sample = "SAMPLE" in facts.categories
    base: dict[str, Any] = {
        "units": units_of(facts.implementation_key),
        "period_start": facts.period_start,
        "period_end": facts.period_end,
        "as_of": facts.as_of,
        "sample": sample,
    }
    definition = BY_LIBRARY_KEY.get(facts.library_key) if facts.library_key else None
    item = next((e for e in (definition.evidence or []) if e.key == item_key), None) if (
        definition is not None
    ) else None  # fmt: skip
    kind: Kind | None
    identity: dict[str, str]
    if item is not None:
        if item.key in ITEM_KINDS:
            kind, identity = ITEM_KINDS[item.key]
        elif item.form == "POLICY":
            kind, identity = "POLICY_DOCUMENT", {"document": item.key}
        else:
            kind, identity = "CONTROL_SPECIFIC", {"item": item.key}
        base["provider"] = item.provider
        sensitivity: Sensitivity = (
            "PERSONAL"
            if item.key in SENSITIVE_ITEMS
            or (facts.domain in SENSITIVE_AREAS and kind != "POLICY_DOCUMENT")
            else "STANDARD"
        )
    elif facts.origin == "RULES" and item_key in GENERIC_POLICY_KEYS:
        kind = "POLICY_DOCUMENT"
        identity = {"document": f"{facts.library_key or facts.control_id}:{item_key}"}
        # A custom control's own documents: its sensitivity is not reviewed.
        sensitivity = "STANDARD" if facts.library_key else "UNKNOWN"
    elif facts.origin == "RULES" and item_key in GENERIC_CONTROL_KEYS:
        kind, identity = "CONTROL_SPECIFIC", {"item": item_key}
        sensitivity = (
            "UNKNOWN"
            if not facts.library_key
            else "PERSONAL"
            if facts.domain in SENSITIVE_AREAS
            else "STANDARD"
        )
    else:
        reason = (
            "written for this engagement, not from the library"
            if facts.origin != "RULES"
            else "a library item the catalog does not know"
        )
        return Spec(kind=None, unmapped_reason=reason, system=facts.application_id,
                    control=facts.control_id, sensitivity="UNKNOWN", **base)  # fmt: skip
    rule = KINDS[kind]
    return Spec(
        kind=kind,
        identity=identity,
        level=rule.level,
        system=facts.application_id if rule.level in ("SYSTEM", "CONTROL") else None,
        control=facts.control_id if rule.level == "CONTROL" else None,
        period_type=rule.period,
        sensitivity="PERSONAL" if rule.personal_data else sensitivity,
        **base,
    )


def spec_hash(spec: Spec) -> str:
    """The fingerprint of everything that decides whether two requirements could share one
    artifact; who provides it is delivery, not identity."""
    body = spec.model_dump(mode="json", exclude={"provider", "unmapped_reason"})
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()


def _overlap(a: Spec, b: Spec) -> bool | None:
    """Whether two periods overlap; None when either is open."""
    if None in (a.period_start, a.period_end, b.period_start, b.period_end):
        return None
    assert a.period_start and a.period_end and b.period_start and b.period_end
    return a.period_start <= b.period_end and b.period_start <= a.period_end


def compatibility(a: Spec, b: Spec) -> Compatibility:
    """Whether two requirements could share one artifact (docs/release-2a.md, in order).
    It never says an artifact is sufficient: sharing needs the artifact verified, or a
    person's confirmation of the differences (R2c)."""

    def incompatible(reason: str) -> Compatibility:
        return Compatibility(verdict="INCOMPATIBLE", reasons=[reason])

    if a.units != b.units:
        return incompatible("different entities or operating units")
    if "UNKNOWN" in (a.sensitivity, b.sensitivity):
        return incompatible("sensitivity not established")
    if a.sample or b.sample:
        return incompatible("sample items are never shared")
    if a.kind is None or b.kind is None:
        return incompatible("outside the evidence catalog")
    if a.kind == "CONTROL_SPECIFIC" or b.kind == "CONTROL_SPECIFIC":
        return incompatible("evidence specific to one control")
    if a.kind != b.kind:
        return incompatible("different kinds of evidence")
    if a.sensitivity != b.sensitivity:
        return incompatible("different sensitivity")
    if a.level == "SYSTEM" and a.system != b.system:
        return incompatible("different systems")
    if a.kind == "POLICY_DOCUMENT" and a.identity != b.identity:
        return incompatible("a different policy or procedure")
    differences: list[str] = []
    if a.period_type == "AS_OF":
        if (a.as_of or a.period_end) != (b.as_of or b.period_end):
            return incompatible("different dates")
    elif (a.period_start, a.period_end) != (b.period_start, b.period_end):
        if a.period_type == "WINDOW" and _overlap(a, b) is False:
            return incompatible("periods that do not overlap")
        differences.append("the periods differ")
    for key in sorted(set(a.identity) | set(b.identity)):
        if a.identity.get(key) != b.identity.get(key):
            differences.append(f"a different {key}")
    if differences:
        return Compatibility(verdict="DIFFERENCES", differences=differences)
    return Compatibility(verdict="IDENTICAL")


def catalog_review() -> list[dict[str, str]]:
    """Every library evidence item and its kind, for methodology review and for the test
    that fails when the library adds an item the catalog does not know."""
    from ai_workforce_api.definition_registry import BY_LIBRARY_KEY

    rows: list[dict[str, str]] = []
    for library_key, definition in sorted(BY_LIBRARY_KEY.items()):
        for item in definition.evidence or []:
            if item.key in ITEM_KINDS:
                kind: str = ITEM_KINDS[item.key][0]
            elif item.form == "POLICY":
                kind = "POLICY_DOCUMENT"
            else:
                kind = "CONTROL_SPECIFIC"
            sensitive = item.key in SENSITIVE_ITEMS or KINDS[kind].personal_data  # type: ignore[index]
            rows.append({"library_key": library_key, "item": item.key, "name": item.name,
                         "kind": kind, "sensitivity": "PERSONAL" if sensitive else "STANDARD",
                         "text": " ".join([item.name, *item.contents])})  # fmt: skip
    return rows
