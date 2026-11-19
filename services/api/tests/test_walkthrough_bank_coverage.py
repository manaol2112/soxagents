"""Which library controls have a dedicated walkthrough bank, and which attributes record what
their criteria need (walkthrough_questions.CONTROL_QUESTIONS and CRITERIA_NEEDS), family by
family of the library (LibraryControl.domain).

A coverage report, asserted as it stands on 18 November 2026: the access, change and
operations families have a bank for every control and needs for every attribute; every other
family is asked the universal questions only, and its attributes' needs are read from their
wording (understanding_review.needs_of). The counts are pinned so that adding or removing a
bank, or an attribute, is a deliberate change made here too. Run with -s to read the
uncovered controls.

Pure unit tests: no database.
"""

from dataclasses import dataclass

from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.definition_registry import definition_for
from ai_workforce_api.walkthrough_questions import CONTROL_QUESTIONS, CRITERIA_NEEDS, FAMILIES


@dataclass(frozen=True)
class Coverage:
    controls: int
    banked: int
    attributes: int
    with_needs: int


# By library family: controls, controls with a dedicated bank, attributes of their testing
# definitions, and attributes whose criteria needs the bank records.
EXPECTED: dict[str, Coverage] = {
    "ACCESS": Coverage(12, 12, 48, 48),
    "CHANGE": Coverage(8, 8, 34, 34),
    "OPERATIONS": Coverage(11, 11, 37, 37),
    "ENTITY": Coverage(2, 0, 5, 0),
    "ITAC": Coverage(13, 0, 40, 0),
    "IPE": Coverage(8, 0, 29, 0),
    "ORDER_TO_CASH": Coverage(4, 0, 14, 0),
    "PROCURE_TO_PAY": Coverage(4, 0, 11, 0),
    "RECORD_TO_REPORT": Coverage(4, 0, 13, 0),
    "TREASURY": Coverage(4, 0, 9, 0),
    "HIRE_TO_RETIRE": Coverage(3, 0, 10, 0),
    "INVENTORY": Coverage(3, 0, 10, 0),
    "FIXED_ASSETS": Coverage(4, 0, 10, 0),
    "TAX": Coverage(2, 0, 6, 0),
}


def _attribute_keys(library_key: str) -> list[str]:
    definition = definition_for(library_key)
    assert definition is not None, library_key
    return [attribute.key for attribute in definition.attributes]


def _report() -> tuple[dict[str, Coverage], dict[str, list[str]]]:
    """The coverage by family, and each family's controls without a bank."""
    counts: dict[str, list[int]] = {}
    uncovered: dict[str, list[str]] = {}
    for control in LIBRARY:
        keys = _attribute_keys(control.key)
        row = counts.setdefault(control.domain, [0, 0, 0, 0])
        banked = bool(CONTROL_QUESTIONS.get(control.key))
        row[0] += 1
        row[1] += banked
        row[2] += len(keys)
        row[3] += sum(1 for key in keys if key in CRITERIA_NEEDS)
        if not banked:
            uncovered.setdefault(control.domain, []).append(f"{control.control_ref} {control.key}")
    return {domain: Coverage(*row) for domain, row in counts.items()}, uncovered


def test_the_coverage_of_the_walkthrough_banks_by_library_family() -> None:
    coverage, uncovered = _report()
    print("\nWalkthrough bank coverage by library family (controls banked, attributes with needs):")
    for domain, row in coverage.items():
        print(
            f"  {domain:<17} {row.banked:>2}/{row.controls:<2} controls  "
            f"{row.with_needs:>2}/{row.attributes:<2} attributes"
        )
    print("Controls with the universal questions only:")
    for domain, controls in uncovered.items():
        print(f"  {domain}: {', '.join(controls)}")
    assert coverage == EXPECTED
    # Totals: 31 of the 82 library controls have a bank, 119 of their 276 attributes needs.
    assert sum(row.controls for row in coverage.values()) == 82
    assert sum(row.banked for row in coverage.values()) == 31
    assert sum(row.attributes for row in coverage.values()) == 276
    assert sum(row.with_needs for row in coverage.values()) == 119
    assert sum(len(controls) for controls in uncovered.values()) == 51


def test_a_family_with_banks_is_covered_whole_and_no_other_has_one() -> None:
    coverage, uncovered = _report()
    banked = {domain for domain, row in coverage.items() if row.banked}
    # The families the bank names are the ones covered, each in full.
    assert banked == set(FAMILIES.values()) == {"ACCESS", "CHANGE", "OPERATIONS"}
    for domain in banked:
        row = coverage[domain]
        assert row.banked == row.controls and row.with_needs == row.attributes, domain
        assert domain not in uncovered, domain
    # No needs are recorded for an attribute outside those families.
    covered_attributes = {
        key
        for control in LIBRARY
        if control.domain in banked
        for key in _attribute_keys(control.key)
    }
    assert set(CRITERIA_NEEDS) == covered_attributes
    # Every bank's library key belongs to its family's prefix.
    by_key = {control.key: control.domain for control in LIBRARY}
    for library_key in CONTROL_QUESTIONS:
        prefix = next(p for p in FAMILIES if library_key.startswith(p))
        assert by_key[library_key] == FAMILIES[prefix], library_key
