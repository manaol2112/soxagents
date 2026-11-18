"""A formatted text section without its marks (docs/design-workpaper.md, section 3.3).

The grammar is pinned by the cases the web's reader and the server's share
(tests/fixtures/rich-text/cases.json). Pure: no database. Synthetic text only.
"""

import json
import time
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from openpyxl import load_workbook

from ai_workforce_api.workpaper_export import _safe, workpaper_xlsx
from ai_workforce_api.workpaper_fill import Content, Field_, Section
from ai_workforce_api.workpaper_marks import plain
from ai_workforce_api.workpaper_service import WorkpaperBody

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((ROOT / "tests/fixtures/rich-text/cases.json").read_text(encoding="utf-8"))
CASES: list[dict[str, Any]] = FIXTURE["cases"]
# Stored text is at most 12,000 characters (the section's limit, marks included).
LIMIT = 12_000


def test_the_fixture_holds_the_cases_both_readers_share() -> None:
    names = [case["name"] for case in CASES]
    assert len(names) >= 27 and len(set(names)) == len(names)
    assert all(isinstance(case["text"], str) and isinstance(case["plain"], str) for case in CASES)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_plain_reads_each_shared_case(case: dict[str, Any]) -> None:
    assert plain(case["text"]) == case["plain"]


@pytest.mark.parametrize(
    "case",
    [case for case in CASES if "\\" not in case["text"]],
    ids=[case["name"] for case in CASES if "\\" not in case["text"]],
)
def test_plain_text_read_again_is_itself(case: dict[str, Any]) -> None:
    """What `plain` writes holds no mark with a partner, so reading it again changes
    nothing. The cases with an escape are left out: the character an escape made plain is
    written as itself, and would read as a mark or an escape the second time."""
    once = plain(case["text"])
    assert plain(once) == once


def test_marks_beyond_the_shared_cases_read_one_way() -> None:
    """What the contract leaves to the reader, as this one reads it (reported to the
    owner so the web's reader agrees)."""
    # A mark is two characters of its own, read left to right: the third star is text.
    assert plain("***bold***") == "*bold*"
    # A run closes at the next mark that can close it, and what opens inside it closes
    # inside it: the italic mark here has no partner inside the bold run.
    assert plain("**a ''b** c''") == "a ''b c''"
    assert plain("**a **b** c**") == "a **b c**"
    # Each mark, opened and closed around the others, in any order.
    assert plain("++''**x**''++ and ''++y++''") == "x and y"
    # An escaped character is never part of a mark, and never a list starter.
    assert plain("\\**a**") == "**a**"
    assert plain("**a\\**") == "**a**"
    assert plain("a \\\\ b \\x \\") == "a \\ b \\x \\"
    # An item is read without the spaces around it; the number is counted, not kept.
    assert plain("-   one\n-  ''two''") == "- one\n- two"
    assert plain("10. ten\n10. ten again") == "1. ten\n2. ten again"
    # Not items: no space after the dash or the stop, other digits, both kinds together.
    assert plain("-one\n-two") == "-one\n-two"
    assert plain("1.one") == "1.one"
    assert plain("١. one") == "١. one"
    assert plain("- one\n1. two") == "- one\n1. two"
    # A tab or a no-break space is a space: around a line, and beside a mark.
    assert plain("\t**a** \n \n\tb") == "a\n\nb"
    assert plain("** a**") == "** a**"
    assert plain("**a **") == "**a **"
    assert plain(" \n\t\n") == ""


def _hostile() -> dict[str, str]:
    return {
        "6,000 stars": "*" * 6_000,
        "12,000 apostrophes": "'" * LIMIT,
        "12,000 backslashes": "\\" * LIMIT,
        "openers with no partner": "**a " * (LIMIT // 4),
        "closers with no opener": "a** " * (LIMIT // 4),
        "three marks with no partner": "**a ''b ++c " * (LIMIT // 12),
        "marks that cross": "**a''b++c" * (LIMIT // 9),
        "a mark on every line": "**a\n" * (LIMIT // 4),
        "a line of digits": "1" * LIMIT,
        "escapes": "\\*\\+\\'" * (LIMIT // 6),
        "list items of marks": "- **\n" * (LIMIT // 5),
        "blank lines": "\n \r\n" * (LIMIT // 4),
    }


@pytest.mark.parametrize("name", list(_hostile()))
def test_text_made_to_be_slow_is_read_quickly(name: str) -> None:
    """One pass per line: the longest stored text made of marks with no partner, or of
    marks that cross, is read in a fraction of a second, and stays as long or shorter."""
    text = _hostile()[name]
    assert len(text) <= LIMIT
    started = time.perf_counter()
    read = plain(text)
    elapsed = time.perf_counter() - started
    assert elapsed < 0.5, f"{name}: {elapsed:.3f}s"
    assert len(read) <= len(text)


def test_the_reading_time_grows_with_the_text_not_with_its_square() -> None:
    def seconds(text: str) -> float:
        best = 10.0
        for _ in range(3):
            started = time.perf_counter()
            plain(text)
            best = min(best, time.perf_counter() - started)
        return best

    for unit in ("**a ", "*", "**a''b++c"):
        small = seconds(unit * (20_000 // len(unit)))
        large = seconds(unit * (320_000 // len(unit)))
        # Sixteen times the text: a reader that scans again for every mark would take 256
        # times as long. The bound leaves room for a loaded machine.
        assert large < max(small, 0.001) * 80, (unit, small, large)


def _paper(*sections: Section) -> WorkpaperBody:
    return WorkpaperBody(
        id=UUID(int=1),
        control_id=UUID(int=2),
        control_ref="ITGC-AC-01",
        stage="DESIGN",
        template_key="itgc",
        status="DRAFT",
        drafting=False,
        draft_note="",
        current_version=1,
        shown_version=1,
        content=Content(
            reference="ITGC-AC-01-TOD",
            title="User access is approved",
            template_key="itgc",
            template_title="IT general control",
            template_version=1,
            stage="DESIGN",
            purpose="Design and implementation",
            sections=list(sections),
        ),
        versions=[],
        prepared_by=None,
        prepared_at=None,
        prepared_version=None,
        version=1,
    )


def _cells(*sections: Section) -> list[Any]:
    book = load_workbook(BytesIO(workpaper_xlsx("Synthetic engagement", [_paper(*sections)])))
    return [cell for row in book.active.iter_rows() for cell in row if cell.value is not None]


def test_the_export_writes_a_text_section_without_its_marks() -> None:
    understanding = (
        "HR records each **termination** in the ''HR system'' [^1].\n\n"
        "Steps:\n\n3. IT removes access within ++1 business day++\n7. The manager confirms\n\n"
        "- C\\+\\+ build server\n- \\*\\*kept as typed\\*\\*"
    )
    cells = _cells(
        Section(
            key="understanding-of-the-control",
            title="Understanding of the control",
            kind="text",
            text=understanding,
            citations=[
                {"number": 1, "file_name": "policy.txt", "location": "", "quote": "**as is**"}
            ],
        ),
        Section(
            key="walkthrough",
            title="Walkthrough",
            kind="table",
            columns=["Step", "Result"],
            rows=[["**a cell is one plain line**", "''kept''"]],
        ),
        Section(
            key="header",
            title="Header",
            kind="fields",
            fields=[Field_(label="Owner", value="Demo ++Manager++")],
        ),
    )
    values = [str(cell.value) for cell in cells]
    written = (
        "HR records each termination in the HR system [^1].\n\n"
        "Steps:\n\n1. IT removes access within 1 business day\n2. The manager confirms\n\n"
        "- C++ build server\n- **kept as typed**"
    )
    assert written == plain(understanding)
    assert written in values
    assert not any("**termination**" in value or "''HR system''" in value for value in values)
    # A table cell, a field and a citation are not formatted text: written as they are.
    assert "**a cell is one plain line**" in values and "''kept''" in values
    assert "Demo ++Manager++" in values
    assert "[1] policy.txt: “**as is**”" in values


def test_the_export_guards_a_formula_after_the_marks_are_gone() -> None:
    """The text is made safe for a cell as it will be written: a formula inside a mark, or
    behind an escape, starts the cell only once the marks are gone."""
    for stored, shown in (
        ('**=HYPERLINK("http://example.invalid")**', '=HYPERLINK("http://example.invalid")'),
        ("''+1+1''", "+1+1"),
        ("++@SUM(A1)++", "@SUM(A1)"),
        ("\\-2+3", "-2+3"),
        ("   =1+1", "=1+1"),
        ("- first\n- second", "- first\n- second"),
    ):
        assert plain(stored) == shown
        assert _safe(shown) == f"'{shown}"
        (cell,) = [
            c
            for c in _cells(Section(key="conclusion", title="Conclusion", kind="text", text=stored))
            if shown in str(c.value)
        ]
        assert cell.value == f"'{shown}"
        assert cell.data_type == "s"


def test_the_export_sizes_the_row_by_the_text_it_writes() -> None:
    marked = "**a** " * 300  # 1,800 characters stored, 599 written
    (cell,) = [
        c
        for c in _cells(Section(key="conclusion", title="Conclusion", kind="text", text=marked))
        if str(c.value).startswith("a a a")
    ]
    assert len(str(cell.value)) == 599
    book = load_workbook(
        BytesIO(
            workpaper_xlsx(
                "Synthetic engagement",
                [_paper(Section(key="conclusion", title="Conclusion", kind="text", text=marked))],
            )
        )
    )
    height = book.active.row_dimensions[cell.row].height
    # By the stored text it was 15 * (1,799 // 110 + 1) = 255.
    assert height == 15 * (599 // 110 + 1) == 90
    # An empty section keeps the least height, as before.
    empty = _cells(Section(key="conclusion", title="Conclusion", kind="text", text=""))
    assert "Conclusion" in [str(c.value) for c in empty]
