"""The testing definitions of library version 3, checked and documented.

- definition_for: a library control's definition;
- problems: structural checks every definition must pass (a test runs them);
- uncertainties: the uncertainty register, from every LOW or NOT_ESTABLISHED attribute,
  every control whose design needs confirmation, and the framework-level questions;
- summary and markdown: the review report and docs/testing-definitions.md, generated so
  the document never drifts from the code (`python -m ai_workforce_api.definition_registry`).
"""

import re
import sys
from collections import Counter
from pathlib import Path

from ai_workforce_api import definitions_business, definitions_itgc
from ai_workforce_api.testing_definitions import (
    AGENT_RULES,
    CONFIDENCES,
    SOURCES,
    TESTED,
    AttributeDef,
    Definition,
    Uncertainty,
)

DEFINITIONS: tuple[Definition, ...] = (
    *definitions_itgc.DEFINITIONS,
    *definitions_business.DEFINITIONS,
)
BY_LIBRARY_KEY: dict[str, Definition] = {item.library_key: item for item in DEFINITIONS}

# Words that make an attribute vague: the tester cannot tell what to check (KPMG Q5.5.60).
VAGUE = re.compile(
    r"(?i)\b(?:appropriate person|appropriately|verify (?:that )?the control is effective|"
    r"check that (?:appropriate )?approval|confirm access is appropriate|"
    r"inspect supporting evidence|validate that the report is accurate|timely)\b"
)

FRAMEWORK_UNCERTAINTIES: tuple[Uncertainty, ...] = (
    Uncertainty(
        "All",
        "Sample sizes (controls.SAMPLE_SIZES and the roll-forward and retest tables)",
        "AS 2315.38 sizes samples from tolerable and expected deviation rates and risk; it "
        "gives no table. The table is firm methodology.",
        "The methodology owner's approval of the table, and whether risk changes the size.",
        "Confirm or replace the table; label it in workpapers as firm methodology.",
        False,
        "Does the firm approve this sample size table for management's testing, and should "
        "higher-risk controls use larger samples?",
    ),
    Uncertainty(
        "All",
        "Zero tolerance: any confirmed exception concludes not effective (decision 8.2)",
        "AS 2201.48 Note: a control need not operate without any deviation to be effective; "
        "AS 2315 evaluates against a tolerable rate.",
        "The methodology owner's tolerance rule for each sample size.",
        "Confirm zero tolerance for the table's small samples, or define tolerable rates.",
        False,
        "Is any deviation in these sample sizes a failure of the control, or does the "
        "methodology allow a tolerable rate for larger samples?",
    ),
    Uncertainty(
        "All",
        "An item that stays untestable after follow-up",
        "AS 2315.40: an item to which planned or alternative procedures cannot be applied is "
        "ordinarily treated as a deviation. The agent never concludes this; a person does.",
        "Who decides, and after how many follow-ups.",
        "A person records it as an exception with the reason, on the test sheet.",
        False,
        "After how many unanswered follow-ups is a sample item treated as a deviation, and "
        "who decides?",
    ),
    Uncertainty(
        "All",
        "Roll-forward by inquiry alone",
        "AS 2201.56 Note permits inquiry alone when risk is low; the platform always asks for "
        "evidence. Management's basis is SEC 33-8810, which also varies evidence with risk.",
        "A risk assessment per control.",
        "Keep evidence-based roll-forward; allow inquiry alone only with a reviewer's "
        "documented low-risk assessment.",
        False,
        "Should a reviewer be able to approve inquiry alone as the roll-forward for a control "
        "assessed as low risk?",
    ),
    Uncertainty(
        "All",
        "Test of one for automated controls, and benchmarking",
        "AS 2201.B28-.B33 supports benchmarking in later years when ITGCs are effective; "
        "test of one in the first year is common practice, not a standard.",
        "The methodology owner's approval, and the ITGC dependency mapping per application.",
        "Confirm test of one; map each automated control to the ITGCs it relies on.",
        False,
        "Does the methodology accept a test of one for automated controls, conditional on "
        "effective ITGCs for that application?",
    ),
    Uncertainty(
        "All",
        "Performer competence",
        "AS 2201.44 and SEC 33-8810 name competence; it is assessed in the design walkthrough "
        "(inquiry about what the performer checks), not per sample.",
        "Whether the methodology wants a documented competence assessment per control.",
        "Keep in design procedures; add an attribute only where the methodology requires it.",
        False,
        "Is a per-control competence assessment required, and in what form?",
    ),
    Uncertainty(
        "All",
        "Amendments after the verified PCAOB edition",
        "Paragraphs were verified against the edition for fiscal years beginning 16 June to "
        "14 December 2024. Later amendments (for example to AS 1105 and AS 2301 on "
        "technology-assisted analysis) were not read.",
        "A check of each cited paragraph against the current edition.",
        "A reviewer confirms the citations before release.",
        False,
        "Has any cited paragraph changed in the edition in force for the engagement period?",
    ),
    Uncertainty(
        "All",
        "Big Four publications",
        "Only KPMG's public ICFR Handbook (2025) was read. Deloitte, PwC, and EY publications "
        "were not reviewed, and no attribute relies on them.",
        "Review of the firm's own methodology, if any.",
        "Compare with the firm's methodology before release.",
        False,
        "Does the firm's own methodology differ from any attribute here?",
    ),
)


def definition_for(library_key: str) -> Definition | None:
    return BY_LIBRARY_KEY.get(library_key)


def attribute_for(library_key: str, key: str = "", text: str = "") -> AttributeDef | None:
    """An attribute's definition, by its key, or by its wording when it has no key."""
    definition = BY_LIBRARY_KEY.get(library_key)
    if definition is None:
        return None
    if key:
        found = definition.attribute(key)
        if found is not None:
            return found
    return definition.matching(text) if text else None


def problems(v2: dict[str, tuple[str, ...]] | None = None) -> list[str]:
    """Structural checks. They show the definitions are complete and consistent; they say
    nothing about whether the methodology is right, which a reviewer decides."""
    found: list[str] = []
    refs = [item.control_ref for item in DEFINITIONS]
    if len(set(refs)) != len(refs):
        found.append("control references repeat")
    for definition in DEFINITIONS:
        name = definition.control_ref
        keys = [item.key for item in definition.attributes]
        if len(set(keys)) != len(keys):
            found.append(f"{name}: attribute keys repeat")
        if not definition.approved:
            found.append(f"{name}: no attribute is tested")
        covered = {key for proc in definition.procedures for key in proc.attributes}
        for proc in definition.procedures:
            for key in proc.attributes:
                if key not in keys:
                    found.append(f"{name}: procedure {proc.key} names unknown {key}")
            if not proc.objective or not proc.action:
                found.append(f"{name}: procedure {proc.key} lacks an objective or action")
        phases = {proc.phase for proc in definition.procedures}
        for phase in ("DESIGN", "OPERATING"):
            if phase not in phases:
                found.append(f"{name}: no {phase.lower()} procedure")
        for item in definition.attributes:
            where = f"{name}.{item.key}"
            if item.key not in covered:
                found.append(f"{where}: no procedure tests it")
            if len(item.text) > 300:
                found.append(f"{where}: wording over 300 characters")
            if item.confidence not in CONFIDENCES:
                found.append(f"{where}: unknown confidence")
            if item.confidence not in TESTED and not item.question:
                found.append(f"{where}: {item.confidence} without a question")
            for ref in item.basis:
                if ref not in SOURCES:
                    found.append(f"{where}: unknown source {ref}")
            for label, value in (
                ("condition", item.condition),
                ("passes", item.passes),
                ("fails", item.fails),
                ("insufficient", item.insufficient),
                ("review", item.review),
                ("why", item.why),
                ("compare", item.compare),
                ("not_infer", item.not_infer),
            ):
                if not value.strip():
                    found.append(f"{where}: {label} is empty")
            for label, value in (("text", item.text), ("condition", item.condition),
                                 ("passes", item.passes)):  # fmt: skip
                if VAGUE.search(value):
                    found.append(f"{where}: vague wording in {label}")
            if not item.evidence:
                found.append(f"{where}: no evidence named")
        if v2 is not None:
            mapped = {item.was for item in definition.attributes if item.was}
            mapped |= {item.text for item in definition.retired}
            for text in v2.get(definition.library_key, ()):
                if text not in mapped:
                    found.append(f"{name}: version 2 attribute not carried or retired: {text}")
    return found


def uncertainties() -> list[Uncertainty]:
    found = list(FRAMEWORK_UNCERTAINTIES)
    for definition in DEFINITIONS:
        if definition.design_confirmation:
            found.append(
                Uncertainty(
                    definition.control_ref,
                    "Control design",
                    "The description, frequency, or nature do not fit together.",
                    "The client's actual control design.",
                    "Confirm the design before relying on the definition.",
                    True,
                    definition.design_confirmation,
                )
            )
        for question in definition.questions:
            found.append(
                Uncertainty(definition.control_ref, "Control", "Not stated in the description.",
                            "The client's answer.", "Ask the control owner.", False, question)
            )  # fmt: skip
        for item in definition.proposed:
            found.append(
                Uncertainty(
                    definition.control_ref,
                    f"{item.key}: {item.text}",
                    "LOW: depends on a value or design the description does not hold."
                    if item.confidence == "LOW"
                    else "NOT ESTABLISHED: not supported by the control description.",
                    "; ".join(item.assumptions) or "The answer to the question.",
                    "Proposed, not tested, until a person approves it with the answer.",
                    item.blocks,
                    item.question,
                )
            )
    return found


def summary(v2: dict[str, tuple[str, ...]]) -> dict[str, object]:
    confidence = Counter(item.confidence for d in DEFINITIONS for item in d.attributes)
    revised = 0
    unchanged = 0
    for definition in DEFINITIONS:
        before = set(v2.get(definition.library_key, ()))
        after = {item.text for item in definition.approved}
        if before == after:
            unchanged += 1
        else:
            revised += 1
    return {
        "controls": len(DEFINITIONS),
        "unchanged": unchanged,
        "revised": revised,
        "design_confirmation": sum(1 for d in DEFINITIONS if d.design_confirmation),
        "with_questions": sum(1 for d in DEFINITIONS if d.proposed or d.questions),
        "confidence": {level: confidence.get(level, 0) for level in CONFIDENCES},
        "retired": sum(len(d.retired) for d in DEFINITIONS),
        "blocking": sum(1 for u in uncertainties() if u.blocks),
    }


def _cell(text: str) -> str:
    return " ".join(text.replace("|", "/").split())


def _statement_summary() -> list[str]:
    from ai_workforce_api.controls import SPLITS
    from ai_workforce_api.statement_registry import STATEMENTS

    slots = [slot for item in STATEMENTS.values() for slot in item.slots if slot.key != "system"]
    parts = sum(len(items) for items in SPLITS.values())
    return [
        f"- Control statements: {len(STATEMENTS)}",
        f"- Client values to fill at setup: {len(slots)}, of which "
        f"{sum(1 for slot in slots if slot.blocks)} hold testing until filled",
        f"- Combined version 2 controls split: {len(SPLITS)}, into {len(SPLITS) + parts} "
        "controls (each original keeps its ID)",
    ]


def _statement_lines(library_key: str) -> list[str]:
    """A control's statement (8.9), with each client value shown as its label."""
    from ai_workforce_api.control_statements import ASSERTION_LABELS, render
    from ai_workforce_api.statement_registry import statement_for

    statement = statement_for(library_key)
    if statement is None:
        return []
    labels = {slot.key: slot.label for slot in statement.slots}

    def show(text: str) -> str:
        return render(text, {}, labels)

    lines = [
        f"- **Statement:** {show(statement.text)}",
        f"- Risk: {statement.risk}",
    ]
    if statement.it_risk:
        lines.append(f"- IT risk: {statement.it_risk}")
    if statement.principle:
        lines.append(f"- COSO principle: {statement.principle}")
    if statement.assertions:
        lines.append(
            "- Assertions (AS 1105.11): "
            + ", ".join(ASSERTION_LABELS[item] for item in statement.assertions)
        )
    nature = statement.nature.lower().replace("_", " ")
    frequency = statement.frequency.lower().replace("_", " ")
    lines += [
        f"- Design: {statement.control_type.lower()}, {nature}, {frequency}; "
        f"operator: {show(statement.operator)}; "
        f"reviewer: {show(statement.reviewer)}; owner: {show(statement.owner)}",
        f"- Authority: {show(statement.authority)}",
        f"- Judgment: {statement.judgment.lower()} ({statement.judgment_note})",
        f"- Precision: {show(statement.precision)}",
        f"- Outliers: {show(statement.investigation)}",
    ]
    for item in statement.information:
        ipe = f" (report control {item.ipe})" if item.ipe else ""
        lines.append(f"- Information used: {item.name}{ipe}: {', '.join(item.elements)}")
    if statement.itgcs:
        lines.append(f"- Relies on: {', '.join(statement.itgcs)}")
    lines.append(f"- Evidence: {show(statement.evidence)}")
    if statement.applies_when:
        lines.append(f"- Applies when: {show(statement.applies_when)}")
    for slot in statement.slots:
        if slot.key == "system":
            continue
        waits = "testing waits for it" if slot.blocks else "does not hold testing"
        lines.append(f"- Client value: {slot.label} ({slot.kind.lower()}; {waits}). {slot.why}")
    return lines


def markdown(v2: dict[str, tuple[str, ...]]) -> str:
    """docs/testing-definitions.md: every definition, the summary, and the register."""
    counts = summary(v2)
    confidence = counts["confidence"]
    assert isinstance(confidence, dict)
    lines = [
        "# Testing definitions (library version 3)",
        "",
        "Generated from `services/api/ai_workforce_api/definitions_*.py` (how each control is "
        "tested) and `statements_*.py` (how each control is designed) by "
        "`python -m ai_workforce_api.definition_registry`. Do not edit by hand.",
        "",
        "Each control's statement records what its design documentation should contain: its "
        "objective and risk, nature and type, frequency, operator and reviewer with the "
        "authority they need, the judgment involved, its precision, how outliers are "
        "investigated, the information it uses, and the evidence it leaves (KPMG ICFR Handbook "
        "(2025) Q5.4.30, Q7.3.30, Q2.3.60). What only the client knows is a client value in "
        "brackets, filled at setup.",
        "",
        "**Status: draft for professional review.** These definitions have passed structural "
        "checks only. They have not been validated by a SOX methodology reviewer and must not "
        "be represented as PCAOB-compliant. See "
        "[testing-framework-review.md](testing-framework-review.md) for the source basis and "
        "its limits.",
        "",
        "## Summary",
        "",
        f"- Controls reviewed: {counts['controls']}",
        f"- Controls whose tested attributes are unchanged from version 2: {counts['unchanged']}",
        f"- Controls with revised, added, or removed attributes: {counts['revised']}",
        f"- Version 2 attributes retired, each with its reason: {counts['retired']}",
        f"- Controls whose design must be confirmed: {counts['design_confirmation']}",
        f"- Controls with open questions: {counts['with_questions']}",
        f"- Attributes by confidence: high {confidence['HIGH']}, moderate "
        f"{confidence['MODERATE']}, low {confidence['LOW']}, not established "
        f"{confidence['NOT_ESTABLISHED']}",
        f"- Register entries that block automated testing: {counts['blocking']}",
        *_statement_summary(),
        "",
        "High and moderate attributes are tested. Low and not-established attributes are "
        "proposed in each engagement with their question and are not tested until a person "
        "approves them. Those marked as blocking hold the control's testing until a person "
        "answers them, because without the answer testing would leave out a condition the "
        "control description requires (a review's precision, an approval matrix, a policy's "
        "deadline); the others can be taken up later without holding testing.",
        "",
        "## Agent decision rules for every attribute",
        "",
        AGENT_RULES,
        "",
        "## Sources",
        "",
        "| ID | Reference | Kind | What it says |",
        "| --- | --- | --- | --- |",
    ]
    for key, source in SOURCES.items():
        lines.append(f"| {key} | {_cell(source.ref)} | {source.kind.lower()} | "
                     f"{_cell(source.says)} |")  # fmt: skip
    lines += ["", "## Uncertainty register", "",
              "| Control | Item | Why uncertain | Missing | Action | Blocks testing | "
              "Question |", "| --- | --- | --- | --- | --- | --- | --- |"]  # fmt: skip
    for entry in uncertainties():
        lines.append(
            f"| {entry.control_ref} | {_cell(entry.item)} | {_cell(entry.why)} | "
            f"{_cell(entry.missing)} | {_cell(entry.action)} | "
            f"{'Yes' if entry.blocks else 'No'} | {_cell(entry.question)} |"
        )
    lines += ["", "## Definitions", ""]
    for definition in DEFINITIONS:
        lines += [
            f"### {definition.control_ref}",
            "",
            f"- Objective: {definition.objective}",
            f"- Type: {definition.control_type.lower()}; performer: {definition.performer}; "
            f"reviewer: {definition.reviewer}; trigger: {definition.trigger}",
            f"- Population: {definition.population}",
            f"- Sampling: {definition.sampling}",
        ]
        lines += _statement_lines(definition.library_key)
        if definition.design_confirmation:
            lines.append(f"- **Design to confirm:** {definition.design_confirmation}")
        for question in definition.questions:
            lines.append(f"- Question: {question}")
        for assumption in definition.assumptions:
            lines.append(f"- Assumption: {assumption}")
        lines += ["", "Procedures:", ""]
        for proc in definition.procedures:
            tested = f" Tests: {', '.join(proc.attributes)}." if proc.attributes else ""
            limit = f" Limitation: {proc.limitation}" if proc.limitation else ""
            lines.append(f"- **{proc.key}** ({proc.phase.lower()}) {proc.objective} "
                         f"{proc.action}{tested}{limit}")  # fmt: skip
        lines += ["", "| Attribute | Confidence | Condition | Why | Evidence | Passes | "
                  "Exception | Insufficient | Human review | Do not infer | Basis |",
                  "|" + " --- |" * 11]  # fmt: skip
        for item in definition.attributes:
            basis = ", ".join(SOURCES[ref].ref for ref in item.basis)
            lines.append(
                f"| **{item.key}** {_cell(item.text)} | {item.confidence.lower()} | "
                f"{_cell(item.condition)} | {_cell(item.why)} | "
                f"{_cell('; '.join(item.evidence))} | {_cell(item.passes)} | "
                f"{_cell(item.fails)} | {_cell(item.insufficient)} | {_cell(item.review)} | "
                f"{_cell(item.not_infer)} | {_cell(basis)} |"
            )
        if definition.retired:
            lines += ["", "Retired from version 2:", ""]
            for retired in definition.retired:
                lines.append(f'- "{retired.text}": {retired.reason}')
        lines.append("")
    return "\n".join(lines) + "\n"


def v2_attributes() -> dict[str, tuple[str, ...]]:
    from ai_workforce_api.controls import V2_LIBRARY

    return {control.key: control.test_attributes for control in V2_LIBRARY}


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs/testing-definitions.md")
    target.write_text(markdown(v2_attributes()), encoding="utf-8")
    print(f"wrote {target}")
