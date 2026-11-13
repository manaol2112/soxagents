"""The cases of the evidence assurance evaluation set: their typed schema, how a case
becomes the chain's own input, and the scripted answer a careful reader would give.

Every case is synthetic (the invented company Northwind Fabrics, invented people, SAP
S/4HANA, the audit period 1 January to 31 December 2026). A case states, per attribute,
the verdict a competent IT auditor would reach and why, and the answer, element by
element with quotes copied from the case's own files, that leads to it. The scorer
compares the live chain's verdicts with the first; the fast test feeds the second to the
code's rules to prove that the cases and the rules agree.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.evidence_assurance import (
    ISSUE_RESULTS,
    QUOTE_LIMIT,
    AttributeSpec,
    ChainInput,
    FileSpec,
    Lens,
    PassageBasis,
    Result,
    Verdict,
    elements_of,
    lens_for,
)
from ai_workforce_api.evidence_classify import EvidenceKind
from ai_workforce_api.evidence_extraction import MAX_TEXT
from ai_workforce_api.evidence_planning import Category
from ai_workforce_api.inbound import CleanText, clean_text

CASES_DIR = Path(__file__).parent / "cases"
COMPANY = "Northwind Fabrics"
SYSTEM = "SAP S/4HANA"
PERIOD = "2026-01-01/2026-12-31"
# The line of a file's text that its generated rows replace.
ROWS_MARKER = "{{ROWS}}"
# What an ISSUE may carry as its agreed result (evidence_assurance.compare).
ISSUE_CARRIES: frozenset[str] = frozenset({*ISSUE_RESULTS, "NOT_ADDRESSED"})
_NAMESPACE = uuid5(NAMESPACE_URL, "https://example.invalid/evals/assurance")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ControlCase(_Strict):
    ref: str = Field(min_length=3, max_length=40)
    title: str = Field(min_length=3, max_length=200)
    activity: str = Field(min_length=10, max_length=1500)
    # Picks the control's tester agent, as controls.DOMAIN_AGENTS does in the database run.
    domain: str = Field(min_length=3, max_length=40)


class CriteriaCase(_Strict):
    condition: str = Field(min_length=5, max_length=1000)
    pass_when: str = Field(min_length=5, max_length=1000)
    exception_when: str = Field(min_length=5, max_length=1000)
    judgment_required: bool = False


class AttributeCase(_Strict):
    code: str = Field(pattern=r"^[A-Z]{1,2}$")
    text: str = Field(min_length=5, max_length=400)
    criteria: CriteriaCase | None = None
    # The request links this attribute (evidence_requirement_attributes).
    expected: bool


class RowsCase(_Strict):
    """Generated table rows, for a file too long to write out (the file read in part).
    The template may use {n}, {date}, {time}, {user}, {changer}, {changer_name}, {role}."""

    template: str = Field(min_length=10, max_length=400)
    count: int = Field(ge=1, le=5000)


class FileCase(_Strict):
    name: str = Field(min_length=3, max_length=200)
    kind: EvidenceKind
    # The file's text, one entry a line (readable in JSON).
    lines: list[str] = Field(min_length=1)
    rows: RowsCase | None = None
    # A passage of the file that lies beyond what the reader stores (MAX_TEXT).
    beyond_cut: str | None = None

    @model_validator(mode="after")
    def _marker(self) -> FileCase:
        markers = sum(1 for line in self.lines if line == ROWS_MARKER)
        if (self.rows is None) != (markers == 0) or markers > 1:
            raise ValueError("rows need exactly one marker line, and a marker needs rows")
        return self


class QuoteCase(_Strict):
    file: int = Field(ge=0)
    quote: str = Field(min_length=3, max_length=QUOTE_LIMIT)
    basis: PassageBasis


class ElementAnswer(_Strict):
    result: Result
    quotes: list[QuoteCase] = Field(default_factory=list, max_length=4)
    absent: str = Field(default="", max_length=300)
    reason: str = Field(min_length=5, max_length=400)


class AttributeAnswer(_Strict):
    reason: str = Field(min_length=5, max_length=400)
    # By element key, as evidence_assurance.elements_of sets them.
    elements: dict[str, ElementAnswer]


class CodeGap(_Strict):
    """Where the code's rules keep the chain from the auditor's verdict even when both
    readings give the careful reader's answer: what the code gives instead, and why. A
    finding about the code, kept in the set so that every live run measures it."""

    gives: Verdict
    why: str = Field(min_length=20, max_length=600)


class Expectation(_Strict):
    verdict: Verdict
    # For an ISSUE, every agreed result an auditor would accept; empty otherwise.
    results: list[Result] = Field(default_factory=list)
    # Whether UNSETTLED (a person decides) is an acceptable outcome for this attribute.
    unsettled_acceptable: bool = False
    # The one line a human auditor would give.
    reason: str = Field(min_length=10, max_length=400)
    # The answer, element by element, a careful reader gives (the scripted perfect answer).
    answer: AttributeAnswer
    code_gap: CodeGap | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Expectation:
        if self.verdict == "ISSUE":
            if not self.results or not set(self.results) <= ISSUE_CARRIES:
                raise ValueError("an ISSUE names the results it may carry")
        elif self.results:
            raise ValueError("only an ISSUE names results")
        if self.verdict == "UNSETTLED" and not self.unsettled_acceptable:
            raise ValueError("an expected UNSETTLED is acceptable by definition")
        if self.code_gap is not None and self.code_gap.gives == self.verdict:
            raise ValueError("a code gap gives another verdict than the auditor's")
        return self


class EvalCase(_Strict):
    name: str = Field(pattern=r"^[a-z0-9_]{3,60}$")
    title: str = Field(min_length=5, max_length=200)
    synthetic: Literal[True]
    company: Literal["Northwind Fabrics"]
    system: Literal["SAP S/4HANA"]
    period: Literal["2026-01-01/2026-12-31"]
    control: ControlCase
    # The requirement's categories, which with the files' kinds set the lens in code.
    categories: list[Category] = Field(min_length=1)
    lens: Lens
    read_in_part: bool = False
    attributes: list[AttributeCase] = Field(min_length=1, max_length=8)
    files: list[FileCase] = Field(min_length=1, max_length=6)
    expected: dict[str, Expectation]

    @model_validator(mode="after")
    def _consistent(self) -> EvalCase:
        codes = [attribute.code for attribute in self.attributes]
        if len(set(codes)) != len(codes):
            raise ValueError("attribute codes repeat")
        if set(self.expected) != set(codes):
            raise ValueError("every attribute, and only those, has an expectation")
        lens = lens_for(tuple(self.categories), [file.kind for file in self.files])
        if lens != self.lens:
            raise ValueError(f"the code sets the lens {lens} for these files, not {self.lens}")
        stored = [stored_text(file) for file in self.files]
        if any(text.truncated for text in stored) != self.read_in_part:
            raise ValueError("read_in_part does not match the files' stored text")
        for file, text in zip(self.files, stored, strict=True):
            if file.beyond_cut is not None and (
                find_quote(full_text(file), file.beyond_cut) is None
                or find_quote(text.text, file.beyond_cut) is not None
            ):
                raise ValueError(f"{file.name}: beyond_cut is not past the stored text")
        for attribute in self.attributes:
            expectation = self.expected[attribute.code]
            if expectation.verdict == "NOT_ADDRESSED" and attribute.expected:
                raise ValueError(f"{attribute.code}: a linked attribute is never NOT_ADDRESSED")
            if (
                expectation.verdict == "ISSUE"
                and "NOT_ADDRESSED" in expectation.results
                and not attribute.expected
            ):
                raise ValueError(
                    f"{attribute.code}: only a linked attribute is an ISSUE unaddressed"
                )
            keys = {key for key, _text in elements_of(attribute_spec(self, attribute))}
            if set(expectation.answer.elements) != keys:
                raise ValueError(f"{attribute.code}: the answer covers elements {sorted(keys)}")
            for element in expectation.answer.elements.values():
                if expectation.verdict == "SUPPORTED" and element.result != "MET":
                    raise ValueError(f"{attribute.code}: SUPPORTED rests on every element MET")
                if any(quote.file >= len(self.files) for quote in element.quotes):
                    raise ValueError(f"{attribute.code}: a quote names a file not in the case")
        return self


def _row(template: str, n: int, count: int) -> str:
    """One generated row: plausible, deterministic, and never about a case's own people."""
    changers = (("SMORALES", "Sofia Morales"), ("KBERG", "Karl Berg"))
    roles = (
        "Z_MM_BUYER", "Z_SD_ORDER_ENTRY", "Z_PP_PLANNER", "Z_FI_GL_DISPLAY", "Z_CO_ANALYST",
        "Z_MM_WAREHOUSE", "Z_SD_BILLING", "Z_QM_INSPECTOR",
    )  # fmt: skip
    day = date(2026, 1, 2) + timedelta(days=(n * 7) % 179)
    changer, changer_name = changers[n % len(changers)]
    letter = chr(65 + (n * 24) // max(count, 1))
    return template.format(
        n=n,
        date=day.strftime("%d.%m.%Y"),
        time=f"{8 + n % 9:02d}:{(n * 13) % 60:02d}:{(n * 29) % 60:02d}",
        user=f"{letter}USR{n:04d}",
        changer=changer,
        changer_name=changer_name,
        role=roles[n % len(roles)],
    )


def full_text(file: FileCase) -> str:
    """The file's whole text as the client sent it."""
    lines: list[str] = []
    for line in file.lines:
        if line == ROWS_MARKER and file.rows is not None:
            lines.extend(
                _row(file.rows.template, n, file.rows.count) for n in range(file.rows.count)
            )
        else:
            lines.append(line)
    return "\n".join(lines) + "\n"


def stored_text(file: FileCase) -> CleanText:
    """The text the reader stores for a plain-text file (evidence_extraction: clean_text
    bounded by MAX_TEXT), with whether it was cut."""
    return clean_text(full_text(file), MAX_TEXT)


def attribute_id(case: EvalCase, code: str) -> UUID:
    return uuid5(_NAMESPACE, f"{case.name}/attribute/{code}")


def file_id(case: EvalCase, index: int) -> UUID:
    return uuid5(_NAMESPACE, f"{case.name}/file/{index}")


def attribute_spec(case: EvalCase, attribute: AttributeCase) -> AttributeSpec:
    criteria = None if attribute.criteria is None else attribute.criteria.model_dump()
    return AttributeSpec(
        id=attribute_id(case, attribute.code),
        code=attribute.code,
        text=attribute.text,
        criteria=criteria,
        expected=attribute.expected,
    )


def chain_of(case: EvalCase) -> ChainInput:
    """The chain's input for a case, built as evidence_assurance.run_assessment builds it:
    the control's facts, the lens set in code, every attribute with its criteria and its
    link, and every file with its stored text and whether it was cut."""
    files: list[FileSpec] = []
    for index, file in enumerate(case.files):
        stored = stored_text(file)
        files.append(
            FileSpec(
                id=file_id(case, index),
                name=file.name,
                kind=file.kind,
                text=stored.text,
                truncated=stored.truncated,
                sha256=hashlib.sha256(full_text(file).encode("utf-8")).hexdigest(),
            )
        )
    return ChainInput(
        control_ref=case.control.ref,
        title=case.control.title,
        activity=case.control.activity,
        lens=lens_for(tuple(case.categories), [file.kind for file in case.files]),
        attributes=tuple(attribute_spec(case, attribute) for attribute in case.attributes),
        files=tuple(files),
        files_left_out=False,
    )


def scripted_answer(case: EvalCase) -> dict[str, Any]:
    """The careful reader's answer, in the shape the model is asked for (OPINION_SCHEMA)."""
    return {
        "attributes": [
            {
                "code": attribute.code,
                "reason": case.expected[attribute.code].answer.reason,
                "elements": [
                    {
                        "element": key,
                        "result": element.result,
                        "quotes": [quote.model_dump() for quote in element.quotes],
                        "absent": element.absent,
                        "reason": element.reason,
                    }
                    for key, element in case.expected[attribute.code].answer.elements.items()
                ],
            }
            for attribute in case.attributes
        ]
    }


def load_case(path: Path) -> EvalCase:
    case = EvalCase.model_validate(json.loads(path.read_text(encoding="utf-8")))
    if case.name != path.stem:
        raise ValueError(f"{path.name}: the case's name must be its file name")
    return case


def case_paths(directory: Path = CASES_DIR) -> list[Path]:
    return sorted(directory.glob("*.json"))


def load_cases(directory: Path = CASES_DIR, names: Sequence[str] = ()) -> list[EvalCase]:
    """Every case, in name order; only the named ones when names are given."""
    cases = [load_case(path) for path in case_paths(directory)]
    if names:
        known = {case.name for case in cases}
        unknown = sorted(set(names) - known)
        if unknown:
            raise ValueError(f"no case named {', '.join(unknown)}")
        cases = [case for case in cases if case.name in set(names)]
    return cases
