"""How each library control is designed and documented (Milestone 8.9).

A control statement records what a methodology reviewer expects in a control's design
documentation (KPMG ICFR Handbook (2025) Q5.4.30 for process controls, Q7.3.30 for IT
general controls, Q2.3.60 for entity-level controls): the objective and the risk it
addresses, its nature and type, frequency, operator and reviewer with the authority they
need, the judgment involved, its precision and criteria for investigation, how outliers
are investigated and resolved, the information it uses with its data elements, the IT
general controls it relies on, and the evidence it leaves.

What only the client knows (a threshold, a role, a deadline, a report's name) is a named
slot in the statement, written {slot-key}. The team fills each slot at setup; until then
the statement shows the slot's label in brackets, and a slot marked as blocking holds the
control's testing.
"""

import re
from dataclasses import dataclass
from typing import Literal

# AS 1105.11: the categories of financial statement assertions.
Assertion = Literal[
    "EXISTENCE_OCCURRENCE",
    "COMPLETENESS",
    "VALUATION_ALLOCATION",
    "RIGHTS_OBLIGATIONS",
    "PRESENTATION_DISCLOSURE",
]
ASSERTIONS: tuple[Assertion, ...] = (
    "EXISTENCE_OCCURRENCE",
    "COMPLETENESS",
    "VALUATION_ALLOCATION",
    "RIGHTS_OBLIGATIONS",
    "PRESENTATION_DISCLOSURE",
)
ASSERTION_LABELS: dict[Assertion, str] = {
    "EXISTENCE_OCCURRENCE": "Existence or occurrence",
    "COMPLETENESS": "Completeness",
    "VALUATION_ALLOCATION": "Valuation or allocation",
    "RIGHTS_OBLIGATIONS": "Rights and obligations",
    "PRESENTATION_DISCLOSURE": "Presentation and disclosure",
}

ControlType = Literal["PREVENTIVE", "DETECTIVE"]
Nature = Literal["MANUAL", "AUTOMATED", "IT_DEPENDENT_MANUAL"]
Frequency = Literal[
    "ANNUAL", "QUARTERLY", "MONTHLY", "WEEKLY", "DAILY", "RECURRING", "EVENT_DRIVEN"
]
Judgment = Literal["LOW", "MODERATE", "HIGH"]
SlotKind = Literal["ROLE", "AMOUNT", "DAYS", "PERCENT", "PERIOD", "REPORT", "SYSTEM", "TEXT"]
InfoKind = Literal["SYSTEM_REPORT", "QUERY", "SPREADSHEET", "DOCUMENT", "SYSTEM_SCREEN"]

SLOT = re.compile(r"\{([a-z][a-z0-9-]{1,40})\}")


@dataclass(frozen=True)
class Slot:
    """A value only the client knows, filled at setup."""

    key: str
    label: str
    kind: SlotKind
    # Why the control depends on it; shown next to the input.
    why: str
    example: str = ""
    # True when the control cannot be tested without it: it defines the population or the
    # precision, or a deadline or matrix an attribute is tested against.
    blocks: bool = True
    # The bracketed wording an attribute uses for this value, when it differs from label;
    # filling the slot fills it in the control's attributes too.
    placeholder: str = ""

    @property
    def fills(self) -> str:
        return self.placeholder or self.label


@dataclass(frozen=True)
class Information:
    """Information the control uses (KPMG Q5.12, Q6.2.40): what it is and the data
    elements the operator relies on. ipe names the library control over its completeness
    and accuracy, where the library has one."""

    name: str
    kind: InfoKind
    elements: tuple[str, ...]
    ipe: str = ""


@dataclass(frozen=True)
class Statement:
    """One control's design, as its documentation should state it."""

    # The control as performed, with {slot} markers: who does what, when, against what.
    text: str
    # What could go wrong that the control addresses.
    risk: str
    # AS 1105.11 categories for a process control; empty for IT general and entity-level.
    assertions: tuple[Assertion, ...]
    control_type: ControlType
    nature: Nature
    frequency: Frequency
    # Who or what performs it (KPMG Q5.4.40), and who reviews or approves, if anyone.
    operator: str
    reviewer: str
    # Who is accountable for the control's design and operation.
    owner: str
    # The authority and competence the operator needs (KPMG Q5.8).
    authority: str
    judgment: Judgment
    judgment_note: str
    # The criteria or thresholds for investigation, for a control that looks for outliers
    # (KPMG Q5.10); for a preventive control, what it lets through and what it stops.
    precision: str
    # The documented steps for an outlier or a failure (KPMG Q5.11).
    investigation: str
    information: tuple[Information, ...]
    # The IT general controls an automated or IT-dependent control relies on.
    itgcs: tuple[str, ...]
    # What the operation leaves behind that a tester can inspect.
    evidence: str
    slots: tuple[Slot, ...] = ()
    # For an IT general control, the risk arising from the use of IT; for an entity-level
    # control, the COSO 2013 principle (as listed in KPMG ICFR Handbook ch. 2).
    it_risk: str = ""
    principle: str = ""
    # Set when one form of the control applies only in some circumstances.
    applies_when: str = ""
    # A new title, where the statement narrows what the control is (a split control).
    title: str = ""

    def slot(self, key: str) -> Slot | None:
        return next((item for item in self.slots if item.key == key), None)

    def keys_used(self) -> set[str]:
        fields = (
            self.text, self.operator, self.reviewer, self.owner, self.authority,
            self.precision, self.investigation, self.evidence, self.applies_when,
        )  # fmt: skip
        return {match for value in fields for match in SLOT.findall(value)}


def render(text: str, values: dict[str, str], labels: dict[str, str]) -> str:
    """A statement with each slot's value, or its label in brackets until it is filled."""

    def fill(match: re.Match[str]) -> str:
        key = match.group(1)
        value = values.get(key, "").strip()
        if value:
            return value
        # The system is the one the control instance is for; it reads as such until named.
        return "the system" if key == "system" else f"[{labels.get(key, key)}]"

    return SLOT.sub(fill, text)
