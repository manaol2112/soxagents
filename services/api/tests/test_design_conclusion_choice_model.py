"""The preparer concludes; the agent proposes (docs/design-workpaper.md, section 3.6; the
product owner, 15 November 2026): the pure part, with synthetic records only. No
database, no model, no file.

Audit integrity:

- the design and the implementation results are worked out once, from the attributes as
  the design workpaper assembles them: an attribute counts for the implementation only
  where a current check shows it in the records of an instance, or a person's closing
  tickmark is what it reads by; an exception (the check's, or one a person recorded) is
  never counted as shown; nothing approved, nothing concluded;
- the proposal follows the section's order exactly: not effective on a design deficiency,
  then exceptions noted, then not concluded while the design or the implementation is
  open (design alone, without the instance, is not effective), then effective;
- effective is refused while a deficiency or an exception stands or anything is open;
  exceptions noted and no instance while a deficiency stands; a reason is needed where
  the table says so, and is the person's own text, cleaned and bounded;
- the OE-facing verdict keeps its two values; not concluded has none.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import ValidationError
from test_design_workpaper_model import (
    ATTRIBUTES,
    F1,
    R1,
    R2,
    REQUESTS,
    _check,
    _disposed,
    _index,
    _item,
)

from ai_workforce_api.design_conclusions import (
    DESIGNED_SENTENCE,
    IN_PLACE_SENTENCE,
    NO_ATTRIBUTES,
    NO_DEFICIENCY_NOR_EXCEPTION,
    REASON_NEEDED,
    REASON_TOO_LONG,
    AttributeStanding,
    ChoiceBody,
    ChoiceInvalid,
    SignOffBody,
    choice_refusal,
    clean_reason,
    proposal_of,
    reason_needed,
    results_of,
    verdict_of,
)
from ai_workforce_api.design_workpaper import (
    AttributeState,
    Reading,
    attributes_of,
    shown_by,
    standing_of,
)

A, B, C, D = (UUID(int=number) for number in (1, 2, 3, 4))


def _stand(code: str, state: str = "SHOWN", by: str | None = "IMPLEMENTATION") -> AttributeStanding:
    return AttributeStanding(code=code, state=state, shown_by=by)  # type: ignore[arg-type]


def _all_in_instance(*codes: str) -> list[AttributeStanding]:
    return [_stand(code) for code in codes]


# --- Design and implementation, said apart ----------------------------------------------


def test_every_attribute_shown_in_the_instance_is_designed_and_in_place() -> None:
    found = results_of(_all_in_instance("A", "B", "C"))
    assert found.design.model_dump() == {
        "result": "DESIGNED", "sentence": DESIGNED_SENTENCE, "open": [],
    }  # fmt: skip
    assert found.implementation.model_dump() == {
        "result": "IN_PLACE", "sentence": IN_PLACE_SENTENCE, "open": [],
    }  # fmt: skip
    assert found.exceptions == ()


def test_shown_only_as_designed_leaves_the_implementation_open_with_its_letters() -> None:
    found = results_of([_stand("A"), _stand("B", by="DESIGN"), _stand("C", by="DESIGN")])
    assert found.design.result == "DESIGNED"
    assert found.implementation.model_dump() == {
        "result": "OPEN",
        "sentence": "Attributes B and C are not yet shown in the records of an instance.",
        "open": ["B", "C"],
    }
    one = results_of([_stand("A"), _stand("B", by="DESIGN")]).implementation
    assert one.sentence == "Attribute B is not yet shown in the records of an instance."


def test_an_exception_of_the_check_or_of_a_person_is_an_exception_for_both() -> None:
    # The check's.
    check = results_of([_stand("A"), _stand("B", "EXCEPTION", None)])
    assert (check.design.result, check.implementation.result) == ("EXCEPTIONS", "EXCEPTIONS")
    assert check.design.sentence == "An exception stands on attribute B."
    assert check.design.open == ["B"] and check.implementation.open == ["B"]
    assert check.exceptions == ("B",)
    # One a person recorded where the attribute would read as shown.
    person = results_of([_stand("A", "EXCEPTION_RECORDED", None), _stand("B")])
    assert person.implementation.result == "EXCEPTIONS" and person.exceptions == ("A",)
    # One a person recorded that stands on a request whose check is not current (it does
    # not read into the attribute's state): still an exception.
    waiting = results_of([_stand("A"), _stand("B", "NOT_TESTED", None)], excepted={"B"})
    assert waiting.design.result == "EXCEPTIONS" and waiting.exceptions == ("B",)
    both = results_of([_stand("A", "EXCEPTION", None), _stand("B", "EXCEPTION_RECORDED", None)])
    assert both.design.sentence == "Exceptions stand on attributes A and B."


def test_closing_tickmarks_count_as_settled_for_both() -> None:
    found = results_of(
        [
            _stand("A"),
            _stand("B", "SHOWN_ON_REVIEW", None),
            _stand("C", "NOT_APPLICABLE", None),
            _stand("D", "NOT_AVAILABLE", None),
        ]
    )
    assert (found.design.result, found.implementation.result) == ("DESIGNED", "IN_PLACE")


@pytest.mark.parametrize("state", ["NOT_TESTED", "NOT_SHOWN", "SHOWN_IN_PART", "NOT_CONCLUDED"])
def test_what_is_not_shown_leaves_both_open(state: str) -> None:
    found = results_of([_stand("A"), _stand("B", state, None)])
    assert found.design.model_dump() == {
        "result": "OPEN",
        "sentence": "Attribute B is not yet shown, as designed or in an instance.",
        "open": ["B"],
    }
    assert found.implementation.open == ["B"] and found.implementation.result == "OPEN"


def test_shown_with_nothing_to_show_it_by_is_open_and_nothing_approved_is_open() -> None:
    # A showing that rests only on files a person decided are not relied on shows nothing.
    found = results_of([_stand("A"), _stand("B", by=None)])
    assert (found.design.open, found.implementation.open) == (["B"], ["B"])
    # No approved attribute: nothing is concluded on.
    none = results_of([])
    assert none.design.model_dump() == {"result": "OPEN", "sentence": NO_ATTRIBUTES, "open": []}
    assert none.implementation.model_dump() == none.design.model_dump()


def test_many_letters_are_named_three_at_most() -> None:
    found = results_of([_stand(code, "NOT_TESTED", None) for code in "ABCDE"])
    assert found.implementation.sentence == (
        "Attributes A, B, C and 2 more are not yet shown in the records of an instance."
    )
    assert found.implementation.open == list("ABCDE")


# --- shown_by, from the checks' readings, and the assembled attributes -------------------


def _reading(implementation: bool = True, not_relied: bool = False) -> Reading:
    return Reading(
        requirement_id=R1,
        state="SHOWN",
        basis="",
        implementation=implementation,
        not_relied=not_relied,
    )


def test_shown_by_says_how_a_current_check_shows_an_attribute() -> None:
    assert shown_by("SHOWN", [_reading(implementation=False), _reading()]) == "IMPLEMENTATION"
    assert shown_by("SHOWN", [_reading(implementation=False)]) == "DESIGN"
    # Resting only on files not relied on: nothing.
    assert shown_by("SHOWN", [_reading(not_relied=True)]) is None
    assert shown_by("SHOWN", [_reading(not_relied=True), _reading(implementation=False)]) == (
        "DESIGN"
    )
    # Any other state: nothing, whatever a reading says.
    states: tuple[AttributeState, ...] = (
        "EXCEPTION", "SHOWN_IN_PART", "NOT_SHOWN", "NOT_TESTED", "EXCEPTION_RECORDED",
        "SHOWN_ON_REVIEW", "NOT_APPLICABLE",
    )  # fmt: skip
    for state in states:
        assert shown_by(state, [_reading()]) is None


def test_the_assembled_attributes_carry_shown_by_and_give_the_results() -> None:
    """From synthetic checks through attributes_of: A shown in the instance, B shown only
    as designed, C left open, D carries a person's closing tickmark."""
    checks = {
        R1: _check(
            _item(A),
            _item(B, shows="DESIGN"),
            _item(
                C, verdict="UNSETTLED", assessment="INDETERMINATE", result=None, element=None,
                files=(),
            ),
        ),
        R2: _check(
            _item(
                D, verdict="ISSUE", assessment="NOT_DEMONSTRATED", result="NOT_MET",
                element="NOT_MET", files=(),
            ),
            requirement=R2,
            files=(F1,),
        ),
    }  # fmt: skip
    shown, _left = attributes_of(
        ATTRIBUTES, REQUESTS, checks, [], _index(checks=checks), None,
        [_disposed("NOT_APPLICABLE", D, R2)],
    )  # fmt: skip
    assert [(a.code, a.state, a.shown_by) for a in shown] == [
        ("A", "SHOWN", "IMPLEMENTATION"),
        ("B", "SHOWN", "DESIGN"),
        ("C", "NOT_CONCLUDED", None),
        ("D", "NOT_APPLICABLE", None),
    ]
    found = results_of([standing_of(a) for a in shown])
    assert (found.design.result, found.design.open) == ("OPEN", ["C"])
    assert (found.implementation.result, found.implementation.open) == ("OPEN", ["B", "C"])
    # A person's exception on A, where it reads as shown: the exception recorded.
    excepted, _left = attributes_of(
        ATTRIBUTES, REQUESTS, checks, [], _index(checks=checks), None,
        [_disposed("NOT_APPLICABLE", D, R2), _disposed("EXCEPTION", A)],
    )  # fmt: skip
    first = excepted[0]
    assert (first.state, first.shown_by) == ("EXCEPTION_RECORDED", None)
    assert results_of([standing_of(a) for a in excepted]).exceptions == ("A",)


# --- The proposal -----------------------------------------------------------------------


def test_the_proposal_follows_the_sections_order_with_its_reasons() -> None:
    settled = results_of(_all_in_instance("A", "B"))
    excepted = results_of([_stand("A", "EXCEPTION", None), _stand("B", "NOT_TESTED", None)])
    opened = results_of([_stand("A"), _stand("B", "NOT_TESTED", None)])
    designed_only = results_of([_stand("A"), _stand("B", by="DESIGN")])

    # 1. A design deficiency stands: not effective, whatever else (no basis proposed).
    assert proposal_of(1, excepted) == (
        "NOT_EFFECTIVE", ["A design deficiency is logged against the control."],
    )  # fmt: skip
    assert proposal_of(2, settled) == (
        "NOT_EFFECTIVE", ["2 design deficiencies are logged against the control."],
    )  # fmt: skip
    # 2. An exception, even with something open: exceptions noted.
    assert proposal_of(0, excepted) == (
        "EXCEPTIONS_NOTED", ["An exception stands on attribute A."],
    )  # fmt: skip
    # 3. Something open: not concluded, each open result's sentence.
    assert proposal_of(0, opened) == (
        "NOT_CONCLUDED",
        [
            "Attribute B is not yet shown, as designed or in an instance.",
            "Attribute B is not yet shown in the records of an instance.",
        ],
    )
    # Design alone, without the instance, is not effective.
    assert proposal_of(0, designed_only) == (
        "NOT_CONCLUDED", ["Attribute B is not yet shown in the records of an instance."],
    )  # fmt: skip
    assert proposal_of(0, results_of([])) == ("NOT_CONCLUDED", [NO_ATTRIBUTES])
    # 4. Otherwise effective.
    assert proposal_of(0, settled) == (
        "EFFECTIVE", [NO_DEFICIENCY_NOR_EXCEPTION, IN_PLACE_SENTENCE],
    )  # fmt: skip


def test_the_rules_of_each_conclusion() -> None:
    settled = results_of(_all_in_instance("A", "B"))
    excepted = results_of([_stand("A"), _stand("B", "EXCEPTION_RECORDED", None)])
    designed_only = results_of([_stand("A"), _stand("B", by="DESIGN"), _stand("C", by="DESIGN")])
    cannot = "so the conclusion cannot be"

    assert choice_refusal("EFFECTIVE", 0, settled) is None
    assert choice_refusal("EFFECTIVE", 1, settled) == (
        f"a design deficiency is logged, {cannot} “Effective”"
    )
    assert choice_refusal("EFFECTIVE", 0, excepted) == (
        f"an exception stands on attribute B, {cannot} “Effective”"
    )
    assert choice_refusal("EFFECTIVE", 0, designed_only) == (
        f"attributes B and C are not yet shown in the records of an instance, {cannot} “Effective”"
    )
    assert choice_refusal("EFFECTIVE", 0, results_of([])) == (
        f"no attribute of the control is approved yet, {cannot} “Effective”"
    )
    for kind, words in (
        ("EXCEPTIONS_NOTED", "Exceptions noted"),
        ("NO_INSTANCE", "Design effective, no instance to walk through"),
    ):
        # Refused only while a design deficiency stands: an exception, or what is open,
        # is what they conclude on.
        assert choice_refusal(kind, 0, excepted) is None
        assert choice_refusal(kind, 0, designed_only) is None
        assert choice_refusal(kind, 1, settled) == (
            f"a design deficiency is logged, {cannot} “{words}”"
        )
    # Not effective and not concluded are never refused by the records here.
    for kind in ("NOT_EFFECTIVE", "NOT_CONCLUDED"):
        for deficiencies, results in ((0, settled), (1, excepted), (0, designed_only)):
            assert choice_refusal(kind, deficiencies, results) is None


def test_a_reason_is_needed_where_the_table_says() -> None:
    for proposed in ("EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NOT_CONCLUDED"):
        for kind in ("EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE"):
            assert reason_needed(kind, proposed) is True
    assert reason_needed("EFFECTIVE", "EFFECTIVE") is False
    assert reason_needed("NOT_CONCLUDED", "NOT_CONCLUDED") is False
    assert reason_needed("NOT_CONCLUDED", "EFFECTIVE") is True
    assert reason_needed("NOT_CONCLUDED", "EXCEPTIONS_NOTED") is True
    assert reason_needed("EFFECTIVE", "NOT_CONCLUDED") is True


def test_the_verdict_keeps_two_values_and_not_concluded_has_none() -> None:
    assert verdict_of("NOT_EFFECTIVE") == "NOT_EFFECTIVE"
    for kind in ("EFFECTIVE", "EXCEPTIONS_NOTED", "NO_INSTANCE"):
        assert verdict_of(kind) == "EFFECTIVE"
    with pytest.raises(ValueError, match="never signed"):
        verdict_of("NOT_CONCLUDED")


def test_the_reason_is_the_persons_own_text_cleaned_and_bounded() -> None:
    assert clean_reason(None) == "" and clean_reason("   ") == ""
    assert clean_reason("  The walkthrough was not possible this year.  ") == (
        "The walkthrough was not possible this year."
    )
    # Untrusted: markup and hidden characters go, the words stay.
    assert clean_reason("<b>No instance</b> occurred​ in the period.") == (
        "No instance occurred in the period."
    )
    with pytest.raises(ChoiceInvalid) as short:
        clean_reason("Too short")
    assert short.value.detail == REASON_NEEDED
    with pytest.raises(ChoiceInvalid) as long:
        clean_reason("x" * 1001)
    assert long.value.detail == REASON_TOO_LONG
    assert len(clean_reason("x" * 1000)) == 1000


def test_the_bodies_name_what_they_must() -> None:
    # `replaces` is always given (null where none was seen); nothing else is taken.
    with pytest.raises(ValidationError):
        ChoiceBody.model_validate({"kind": "EFFECTIVE"})
    with pytest.raises(ValidationError):
        ChoiceBody.model_validate({"kind": "EFFECTIVE", "replaces": None, "verdict": "x"})
    with pytest.raises(ValidationError):
        ChoiceBody.model_validate({"kind": "MAYBE", "replaces": None})
    with pytest.raises(ValidationError):
        ChoiceBody.model_validate({"kind": "NOT_EFFECTIVE", "basis": "PEOPLE", "replaces": None})
    assert ChoiceBody.model_validate({"kind": "EFFECTIVE", "replaces": None}).basis is None
    # A sign-off names the conclusion, or (for one release) the two-value verdict.
    with pytest.raises(ValidationError):
        SignOffBody.model_validate({"workpaper_version": 1})
    assert SignOffBody.model_validate({"conclusion": "NO_INSTANCE", "workpaper_version": 1})
    assert SignOffBody.model_validate({"verdict": "EFFECTIVE", "workpaper_version": 1})


def test_a_sign_off_record_carries_the_conclusion() -> None:
    from ai_workforce_api.design_conclusions import SignoffRecord

    record = SignoffRecord(
        id=UUID(int=9), verdict="EFFECTIVE", conclusion="EXCEPTIONS_NOTED",
        reason="The exceptions are evaluated and are not a deficiency.", workpaper_version=1,
        deficiencies=[], signed_by="Rhea Reviewer", signed_at=datetime(2027, 1, 1, tzinfo=UTC),
        signoff_note="", reopened_at=None, reopened_by=None, reopen_reason="",
        reopened_from=None,
    )  # fmt: skip
    assert (record.conclusion, record.basis, record.verdict) == (
        "EXCEPTIONS_NOTED", None, "EFFECTIVE",
    )  # fmt: skip
    with pytest.raises(ValidationError):
        SignoffRecord.model_validate(record.model_dump() | {"conclusion": "NOT_CONCLUDED"})


def test_the_workpapers_conclusion_part_carries_the_proposal_and_the_choice() -> None:
    """The assembled view's section 7 draws from the one read: the records' proposed
    conclusion, its reasons and the preparer's conclusion, as the D&I conclusion gives
    them; the existing fields keep their meaning (the two-value verdict's words)."""
    from ai_workforce_api.design_conclusions import ChoiceRecord, DesignConclusionBody
    from ai_workforce_api.design_workpaper import conclusion_of

    choice = ChoiceRecord(
        id=UUID(int=7), kind="EXCEPTIONS_NOTED", basis=None,
        reason=REASON_EXCEPTIONS, proposed_kind="EXCEPTIONS_NOTED", recorded_by="Dana Lee",
        recorded_at=datetime(2027, 1, 1, tzinfo=UTC), workpaper_version=2,
    )  # fmt: skip
    body = DesignConclusionBody(
        control_id=UUID(int=8), status="TO_SIGN", proposed="EFFECTIVE", workpaper=None,
        deficiencies=[], signed=None, out_of_date=[], blocking=[], viewer_is_reviewer=False,
        viewer_prepared=False, independence_required=True, can_sign=False, history=[],
        proposed_conclusion="EXCEPTIONS_NOTED",
        proposed_reasons=["An exception stands on attribute B."], choice=choice,
    )  # fmt: skip
    part = conclusion_of(None, body)
    assert (part.proposed, part.words, part.signed) == ("EFFECTIVE", "Effective", False)
    assert (part.proposed_conclusion, part.proposed_reasons, part.choice) == (
        "EXCEPTIONS_NOTED", ["An exception stands on attribute B."], choice,
    )  # fmt: skip


REASON_EXCEPTIONS = "The exception on B is a timing slip, not a design deficiency."
