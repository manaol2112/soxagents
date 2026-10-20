"""Testing definitions (library version 3): how each standard control is tested, and why.

A definition says, for one library control, what it is meant to achieve, what kind of
control it is, the procedures for design, operation, and the roll-forward, and its
attributes. Each attribute carries the exact condition tested, why it is needed, the
evidence and data the tester needs, the comparison to make, what passes, what is an
exception, what is insufficient evidence, what needs a person's judgment, what must not be
inferred, the source it rests on, and a confidence classification:

- HIGH: follows directly from the control as described or a clearly applicable source;
- MODERATE: a control-specific inference no source prescribes, with its rationale;
- LOW: depends on missing information or an unconfirmed design; it needs confirmation;
- NOT_ESTABLISHED: not supported enough to test; the question must be answered first.

HIGH and MODERATE attributes are the control's approved attributes in library version 3.
LOW and NOT_ESTABLISHED attributes are decided with the standard in the firm's library
review (milestone L3e): they enter an engagement approved, each with its question, and
testing waits for any client value they show in brackets.

Definitions are code, reviewed like the library. They are written for management's SOX
testing (SEC Release 33-8810), citing PCAOB standards as the standard the external auditor
will apply. Sources are listed only where their text was read; see SOURCES and
docs/testing-framework-review.md for what was and was not verified. Nothing here is a
Big Four firm's internal methodology.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

Confidence = Literal["HIGH", "MODERATE", "LOW", "NOT_ESTABLISHED"]
CONFIDENCES: tuple[Confidence, ...] = ("HIGH", "MODERATE", "LOW", "NOT_ESTABLISHED")
TESTED: tuple[Confidence, ...] = ("HIGH", "MODERATE")
ProcedurePhase = Literal["DESIGN", "OPERATING", "ROLLFORWARD"]
ControlType = Literal["PREVENTIVE", "DETECTIVE", "UNCONFIRMED"]
# The highest definition version in the library. Each definition carries its own version
# (Definition.version): a definition rewritten with numbered steps and an evidence suite
# (milestone L3a) is version 4; the others stay at 3 until their wave. An engagement
# control follows the version it was imported or adopted at.
DEFINITIONS_VERSION = 4
# The version from which every library control has a definition and a statement. A control
# at this version or later is linked to its definition; a later definition version is
# offered to it as an update a person adopts.
DEFINED_SINCE = 3

# The form evidence takes, which decides what it can show: a system report or log shows
# what the system holds; a screenshot shows a value on its date; a document shows intent.
EvidenceForm = Literal[
    "SYSTEM_REPORT",
    "SYSTEM_LOG",
    "SYSTEM_SCREEN",
    "CONFIGURATION",
    "TICKET",
    "DOCUMENT",
    "POLICY",
    "CORRESPONDENCE",
    "OBSERVATION",
    "THIRD_PARTY_REPORT",
]
EVIDENCE_FORMS: tuple[EvidenceForm, ...] = (
    "SYSTEM_REPORT",
    "SYSTEM_LOG",
    "SYSTEM_SCREEN",
    "CONFIGURATION",
    "TICKET",
    "DOCUMENT",
    "POLICY",
    "CORRESPONDENCE",
    "OBSERVATION",
    "THIRD_PARTY_REPORT",
)
# What a piece of evidence is for: understanding the design, the population a sample is
# drawn from, the support for that population's completeness, the attributes of each
# sampled item, or context the tester reads but tests nothing against.
EvidencePurpose = Literal["DESIGN", "POPULATION", "COMPLETENESS", "ATTRIBUTE", "CONTEXT"]
EVIDENCE_PURPOSES: tuple[EvidencePurpose, ...] = (
    "DESIGN",
    "POPULATION",
    "COMPLETENESS",
    "ATTRIBUTE",
    "CONTEXT",
)


@dataclass(frozen=True)
class Source:
    ref: str
    title: str
    kind: Literal["STANDARD", "REGULATORY", "PUBLICATION", "DESIGN", "INFERENCE", "METHODOLOGY"]
    # What the text says, as read; never more than it says.
    says: str


PCAOB_EDITION = (
    "PCAOB Auditing Standards, compiled edition for audits of fiscal years beginning on or "
    "after 16 June 2024 and before 14 December 2024"
)

SOURCES: dict[str, Source] = {
    "AS2201.37": Source(
        "AS 2201.37-.38",
        PCAOB_EDITION,
        "STANDARD",
        "A walkthrough follows a transaction from origination to the financial records using "
        "the same documents and IT, with probing questions where important processing occurs.",
    ),
    "AS2201.42": Source(
        "AS 2201.42-.43",
        PCAOB_EDITION,
        "STANDARD",
        "Design effectiveness: whether controls operated as prescribed by persons with the "
        "necessary authority and competence satisfy the control objectives; tested by inquiry, "
        "observation, and inspection; walkthroughs ordinarily suffice.",
    ),
    "AS2201.44": Source(
        "AS 2201.44-.45",
        PCAOB_EDITION,
        "STANDARD",
        "Operating effectiveness: whether the control operates as designed and the performer "
        "has the necessary authority and competence; tested by a mix of inquiry, observation, "
        "inspection, and re-performance.",
    ),
    "AS2201.46": Source(
        "AS 2201.46-.47",
        PCAOB_EDITION,
        "STANDARD",
        "Evidence needed rises with the risk associated with the control; factors include "
        "its nature and frequency, reliance on other controls, automation, and judgment.",
    ),
    "AS2201.48": Source(
        "AS 2201.48",
        PCAOB_EDITION,
        "STANDARD",
        "The effect of deviations is evaluated; a control need not operate without any "
        "deviation to be considered effective.",
    ),
    "AS2201.50": Source(
        "AS 2201.50",
        PCAOB_EDITION,
        "STANDARD",
        "Tests ordered from least to most evidence: inquiry, observation, inspection, "
        "re-performance. Inquiry alone does not support a conclusion on a control.",
    ),
    "AS2201.55": Source(
        "AS 2201.55-.56",
        PCAOB_EDITION,
        "STANDARD",
        "Roll-forward: the additional evidence for the remaining period depends on the "
        "control and its risk, interim results and evidence, the remaining period's length, "
        "and significant changes; inquiry alone might suffice when risk is low.",
    ),
    "AS2201.B28": Source(
        "AS 2201.B28-.B33",
        PCAOB_EDITION,
        "STANDARD",
        "Benchmarking entirely automated application controls when ITGCs are effective and "
        "the control has not changed since the baseline; dependence on files, tables, data, "
        "and parameters; the baseline is re-established after a period.",
    ),
    "AS1105.10": Source(
        "AS 1105.10",
        PCAOB_EDITION,
        "STANDARD",
        "Information produced by the company used as evidence: test its accuracy and "
        "completeness, or the controls over them, and evaluate whether it is sufficiently "
        "precise and detailed.",
    ),
    "AS1105.15": Source(
        "AS 1105.15-.20",
        PCAOB_EDITION,
        "STANDARD",
        "Definitions of inspection, observation (limited to the point in time observed), "
        "inquiry (by itself insufficient for a conclusion on a control), recalculation, and "
        "re-performance.",
    ),
    "AS2315.32": Source(
        "AS 2315.32",
        PCAOB_EDITION,
        "STANDARD",
        "Sampling does not apply to many tests of controls, including those depending on "
        "segregation of duties or leaving no documentary evidence.",
    ),
    "AS2315.38": Source(
        "AS 2315.34-.39",
        PCAOB_EDITION,
        "STANDARD",
        "Sample size follows the tolerable and expected deviation rates and the allowable "
        "risk; selection should be representative, ideally from the entire period. No sample "
        "size table is given.",
    ),
    "AS2315.40": Source(
        "AS 2315.40",
        PCAOB_EDITION,
        "STANDARD",
        "A selected item to which the planned or alternative procedures cannot be applied is "
        "ordinarily considered a deviation.",
    ),
    "SEC33-8810": Source(
        "SEC Release 33-8810, section II.A.2.b-c",
        "Management's Report on Internal Control Over Financial Reporting (2007)",
        "REGULATORY",
        "Management's evidence comes from direct testing, ongoing monitoring, or both, varying "
        "with ICFR risk; management considers how the control was applied, consistency, and "
        "the performer's authority and competence; its assessment needs reasonable support.",
    ),
    "KPMG-5.5": Source(
        "KPMG ICFR Handbook (2025) Q5.5.20-5.5.60",
        "KPMG, Handbook: Internal control over financial reporting (public, 2025)",
        "PUBLICATION",
        "A control attribute is a procedure the control operator performs that addresses the "
        "control objective; attributes must be specific enough for a third party to reperform.",
    ),
    "KPMG-5.10": Source(
        "KPMG ICFR Handbook (2025) Q5.10-5.11",
        "KPMG, Handbook: Internal control over financial reporting (public, 2025)",
        "PUBLICATION",
        "Precision, criteria for investigation, and thresholds; management review controls "
        "need their precision understood; outliers are identified, investigated, and resolved.",
    ),
    "KPMG-6": Source(
        "KPMG ICFR Handbook (2025) ch. 6, Q6.4.70",
        "KPMG, Handbook: Internal control over financial reporting (public, 2025)",
        "PUBLICATION",
        "The completeness and accuracy of information used in a control is addressed by an "
        "attribute of that control or by separate control activities.",
    ),
    "KPMG-7.3.10": Source(
        "KPMG ICFR Handbook (2025) Example 7.3.10",
        "KPMG, Handbook: Internal control over financial reporting (public, 2025)",
        "PUBLICATION",
        "Example manual GITC attributes: access approved per the IT delegation of authority, "
        "requested permissions compared with approved roles, provisioned access consistent "
        "with the approval; leavers removed within the policy's days; periodic access reviews "
        "by managers per the delegation of authority, inappropriate access investigated, and "
        "access modified as instructed.",
    ),
    "DESIGN": Source(
        "Control description",
        "The control's own description in the library or RCM",
        "DESIGN",
        "The attribute restates what the control description says the performer does.",
    ),
    "INFERENCE": Source(
        "Professional inference",
        "This framework's reasoning, open to review",
        "INFERENCE",
        "A control-specific inference that no source prescribes; its rationale is stated.",
    ),
    "FIRM": Source(
        "Firm methodology",
        "This platform's methodology choices, pending confirmation",
        "METHODOLOGY",
        "A methodology choice (sample sizes, tolerance, test of one) that no standard "
        "prescribes; it needs a methodology owner's confirmation.",
    ),
}


@dataclass(frozen=True)
class AttributeDef:
    """One characteristic the tester verifies, with everything needed to judge it."""

    key: str
    # The attribute as the control's list holds it; what a person reads and approves.
    text: str
    condition: str
    why: str
    evidence: tuple[str, ...]
    extract: tuple[str, ...]
    compare: str
    passes: str
    fails: str
    insufficient: str
    review: str
    not_infer: str
    basis: tuple[str, ...]
    confidence: Confidence
    assumptions: tuple[str, ...] = ()
    # For LOW and NOT_ESTABLISHED: the question a SOX manager answers before it is tested.
    question: str = ""
    # Whether the question blocks automated testing of this attribute.
    blocks: bool = False
    # The version 2 wording this attribute replaces, if any (for the adoption comparison).
    was: str = ""
    # Version 4: the keys of the evidence suite items this attribute is judged from.
    evidence_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvidenceDef:
    """One item of a control's standard evidence suite (version 4): what an engagement
    asks the client for, in the form that can show what the test needs, and what does
    not serve in its place. Procedures and attributes refer to it by key."""

    key: str
    name: str
    form: EvidenceForm
    # The role that provides it, in the client's terms.
    provider: str
    phases: tuple[ProcedurePhase, ...]
    purpose: EvidencePurpose
    # What it must cover: the period, the date, or the item.
    period: str
    # What it must show, field by field.
    contents: tuple[str, ...]
    # For a population or its support: how it is shown to be complete and accurate.
    completeness: str = ""
    # What is sometimes offered instead and does not serve, and why.
    not_acceptable: str = ""
    # What may serve instead when the named form does not exist.
    alternatives: tuple[str, ...] = ()
    # The attributes it supports.
    attributes: tuple[str, ...] = ()


@dataclass(frozen=True)
class Step:
    """One numbered step of a procedure (version 4): what the tester does, with which
    evidence, what the workpaper records, and what to do when it does not hold."""

    action: str
    evidence: tuple[str, ...] = ()
    record: str = ""
    exception: str = ""


@dataclass(frozen=True)
class ProcedureDef:
    key: str
    phase: ProcedurePhase
    objective: str
    action: str
    evidence: tuple[str, ...]
    attributes: tuple[str, ...]
    limitation: str = ""
    # Version 4: the numbered steps; the action summarises them.
    steps: tuple[Step, ...] = ()


@dataclass(frozen=True)
class Retired:
    """A version 2 attribute that version 3 does not carry, and why."""

    text: str
    reason: str
    replaced_by: str = ""


@dataclass(frozen=True)
class Definition:
    library_key: str
    control_ref: str
    objective: str
    control_type: ControlType
    performer: str
    reviewer: str
    trigger: str
    population: str
    sampling: str
    procedures: tuple[ProcedureDef, ...]
    attributes: tuple[AttributeDef, ...]
    retired: tuple[Retired, ...] = ()
    assumptions: tuple[str, ...] = ()
    questions: tuple[str, ...] = ()
    # Set when the control's design must be confirmed before its definition is relied on.
    design_confirmation: str = ""
    not_applicable: tuple[str, ...] = field(default=())
    # Version 4: the standard evidence suite, and the version this definition is at.
    evidence: tuple[EvidenceDef, ...] = ()
    version: int = 3

    @property
    def approved(self) -> tuple[AttributeDef, ...]:
        return tuple(item for item in self.attributes if item.confidence in TESTED)

    @property
    def proposed(self) -> tuple[AttributeDef, ...]:
        return tuple(item for item in self.attributes if item.confidence not in TESTED)

    def attribute(self, key: str) -> AttributeDef | None:
        return next((item for item in self.attributes if item.key == key), None)

    def matching(self, text: str) -> AttributeDef | None:
        """The attribute whose wording this is, ignoring case and spacing."""
        wanted = _normal(text)
        return next((item for item in self.attributes if _normal(item.text) == wanted), None)

    def filled_from(self, text: str) -> AttributeDef | None:
        """The attribute this wording was written from: its bracketed values filled in,
        however they were spaced (a person who typed "within5 days" in place of the
        bracket still wrote this attribute)."""
        wanted = _normal(text)
        return next(
            (
                item
                for item in self.attributes
                if "[" in item.text and _template(item.text).fullmatch(wanted) is not None
            ),
            None,
        )

    def evidence_item(self, key: str) -> EvidenceDef | None:
        return next((item for item in self.evidence if item.key == key), None)

    def procedure_for(self, action: str) -> ProcedureDef | None:
        """The procedure whose action a plan's procedure text is, ignoring case and spacing."""
        wanted = _normal(action)
        return next((p for p in self.procedures if _normal(p.action) == wanted), None)


@dataclass(frozen=True)
class Uncertainty:
    control_ref: str
    item: str
    why: str
    missing: str
    action: str
    blocks: bool
    question: str


def _normal(text: str) -> str:
    return " ".join(text.lower().split())


_BRACKET = re.compile(r"\s*\[[^\]]+\]\s*")


def _template(text: str) -> re.Pattern[str]:
    """A pattern for an attribute's wording with each bracketed value filled by anything."""
    parts = _BRACKET.split(_normal(text))
    literal = [re.escape(part).replace(r"\ ", r"\s+") for part in parts]
    return re.compile(r"\s*(.+?)\s*".join(literal))


# Sampling, stated as methodology with its source, never as a standard's requirement.

FREQUENCY_SAMPLES = {
    "ANNUAL": "1",
    "QUARTERLY": "2",
    "MONTHLY": "2",
    "WEEKLY": "5",
    "DAILY": "20",
    "RECURRING": "25",
    "EVENT_DRIVEN": "25",
}


def sampling(frequency: str, automated: bool = False, note: str = "") -> str:
    if automated:
        text = (
            "Not sampled: one instance (test of one) with evidence the configuration was in "
            "place for the period, relying on effective ITGCs (AS 2201.B28-.B29 for "
            "benchmarking in later years). Test of one is firm methodology, pending "
            "confirmation."
        )
    else:
        size = FREQUENCY_SAMPLES.get(frequency, "25")
        named = frequency.lower().replace("_", "-")
        article = "an" if named[:1] in "aeiou" else "a"
        text = (
            f"Firm methodology table: {size} for {article} {named} "
            "control, selected at random from the validated population across the period "
            "(AS 2315.39). The table is not a PCAOB requirement; AS 2315.38 sizes a sample "
            "from tolerable and expected deviation rates and risk. Pending methodology "
            "confirmation."
        )
    return f"{text} {note}".strip()


# Generic decision rules every attribute follows, on top of its own.

AGENT_RULES = (
    "PASS only when the cited evidence shows the condition for this item, with the values "
    "compared. EXCEPTION only when the evidence shows the condition was not met. INSUFFICIENT "
    "(recorded as UNABLE) when the evidence needed is missing, unreadable, cut off, or does "
    "not cover this item: say what is needed. REVIEW when the result depends on judgment "
    "the definition reserves for a person, on a value the control does not define, or on "
    "evidence that contradicts itself. NOT_APPLICABLE only with the reason the attribute "
    "cannot apply to this item. A document's presence is never a pass by itself; missing "
    "evidence is never an exception by itself."
)
