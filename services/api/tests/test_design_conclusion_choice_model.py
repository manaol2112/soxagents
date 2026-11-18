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
  then exceptions noted (only where its rule accepts it: with another attribute open it is
  not concluded, naming both), then not concluded while the design or the implementation
  is open (design alone, without the instance, is not effective), then effective;
- effective is refused while a deficiency or an exception stands or anything is open;
  exceptions noted and no instance while a deficiency stands; exceptions noted also unless
  an exception stands and every other attribute is shown in an instance or settled; no
  instance unless the design result is DESIGNED (its words say the design is effective); a
  reason is needed where the table says so, and is the person's own text, cleaned and
  bounded;
- a sign-off made from a preparer's choice stops holding when its conclusion's rule would
  refuse it now, in the rule's own sentence; one made before choices, or seeded by the
  demo, is held to the rules it was signed under only (independent review, 15 November
  2026, docs/design-workpaper.md section 3.6);
- the sign-off names the choice it signs; the two-value verdict is no longer taken;
- the OE-facing verdict keeps its two values; not concluded has none.
"""

from dataclasses import replace
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
    CHOICE_CHANGED,
    DEFICIENCY_LOGGED_SINCE,
    DESIGN_NOT_SHOWN,
    DESIGNED_SENTENCE,
    EXCEPTION_SINCE,
    EXCEPTION_UNANSWERED,
    EXCEPTIONS_NEEDED,
    IN_PLACE_SENTENCE,
    NO_ATTRIBUTES,
    NO_DEFICIENCY_NOR_EXCEPTION,
    REASON_NEEDED,
    REASON_TOO_LONG,
    AttributeStanding,
    ChoiceBody,
    ChoiceInvalid,
    ChoiceRecord,
    DeficiencyRef,
    ExceptionRef,
    SignOffBody,
    _Facts,
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
    # Resting only on files not relied on: NOT_RELIED, which shows nothing for the design
    # nor the implementation. Old: None; new: "NOT_RELIED", so the page can say why the
    # attribute reads "Shown" and still counts as open (independent review, 15 November
    # 2026, docs/design-workpaper.md section 3.6).
    assert shown_by("SHOWN", [_reading(not_relied=True)]) == "NOT_RELIED"
    assert shown_by("SHOWN", [_reading(not_relied=True), _reading(not_relied=True)]) == (
        "NOT_RELIED"
    )
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
    # 2. An exception with every other attribute shown in an instance or settled:
    # exceptions noted.
    settled_but_one = results_of([_stand("A", "EXCEPTION", None), _stand("B")])
    assert proposal_of(0, settled_but_one) == (
        "EXCEPTIONS_NOTED", ["An exception stands on attribute A."],
    )  # fmt: skip
    # An exception with another attribute still open: not concluded, and the reasons name
    # both. Old: "EXCEPTIONS_NOTED" with the exception's sentence alone ("an exception,
    # even with something open"); new: the proposal is only what the rule would accept
    # (independent review, 15 November 2026, docs/design-workpaper.md section 3.6).
    assert proposal_of(0, excepted) == (
        "NOT_CONCLUDED",
        [
            "An exception stands on attribute A.",
            "Attribute B is not yet shown in the records of an instance.",
        ],
    )
    # Shown only as designed is open for the implementation, so it is open here too.
    by_design = results_of([_stand("A", "EXCEPTION", None), _stand("B", by="DESIGN")])
    assert proposal_of(0, by_design)[0] == "NOT_CONCLUDED"
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
    # Exceptions noted: refused while a design deficiency stands, and unless an exception
    # stands and every other attribute is shown in an instance or settled by a tickmark.
    # Old: refused only while a design deficiency stands (no exception, or something open,
    # was accepted: `designed_only` and no attribute at all returned None); new:
    # EXCEPTIONS_NEEDED (independent review, 15 November 2026, docs/design-workpaper.md
    # section 3.6).
    assert choice_refusal("EXCEPTIONS_NOTED", 0, excepted) is None
    assert choice_refusal("EXCEPTIONS_NOTED", 0, designed_only) == EXCEPTIONS_NEEDED
    assert choice_refusal("EXCEPTIONS_NOTED", 0, results_of([])) == EXCEPTIONS_NEEDED
    assert choice_refusal("EXCEPTIONS_NOTED", 0, settled) == EXCEPTIONS_NEEDED
    with_open = results_of([_stand("A", "EXCEPTION", None), _stand("B", "NOT_TESTED", None)])
    assert choice_refusal("EXCEPTIONS_NOTED", 0, with_open) == EXCEPTIONS_NEEDED
    by_design = results_of([_stand("A", "EXCEPTION", None), _stand("B", by="DESIGN")])
    assert choice_refusal("EXCEPTIONS_NOTED", 0, by_design) == EXCEPTIONS_NEEDED
    # A person's exception where the attribute's state does not read as one counts.
    waiting = results_of([_stand("A"), _stand("B", "NOT_TESTED", None)], excepted={"B"})
    assert choice_refusal("EXCEPTIONS_NOTED", 0, waiting) is None
    closed = results_of([_stand("A", "EXCEPTION", None), _stand("B", "NOT_APPLICABLE", None)])
    assert choice_refusal("EXCEPTIONS_NOTED", 0, closed) is None
    assert choice_refusal("EXCEPTIONS_NOTED", 1, settled) == (
        f"a design deficiency is logged, {cannot} “Exceptions noted”"
    )
    assert choice_refusal("EXCEPTIONS_NOTED", 1, excepted) == (
        f"a design deficiency is logged, {cannot} “Exceptions noted”"
    )
    assert EXCEPTIONS_NEEDED == (
        "Exceptions noted needs an exception on record and every other attribute shown or settled"
    )
    # No instance says the design is effective: refused while a design deficiency stands,
    # and unless every attribute is shown as designed (or in the instance) or settled by a
    # tickmark. Shown only as designed is enough: no instance is walked through.
    assert choice_refusal("NO_INSTANCE", 0, settled) is None
    assert choice_refusal("NO_INSTANCE", 0, designed_only) is None
    closed = results_of([_stand("A", by="DESIGN"), _stand("B", "NOT_APPLICABLE", None)])
    assert choice_refusal("NO_INSTANCE", 0, closed) is None
    assert choice_refusal("NO_INSTANCE", 1, settled) == (
        f"a design deficiency is logged, {cannot} “Design effective, no instance to walk through”"
    )
    for not_designed in (
        excepted,
        results_of([_stand("A", by="DESIGN"), _stand("B", "NOT_TESTED", None)]),
        results_of([_stand("A"), _stand("B", "SHOWN_IN_PART", None)]),
        results_of([]),
    ):
        assert not_designed.design.result != "DESIGNED"
        assert choice_refusal("NO_INSTANCE", 0, not_designed) == DESIGN_NOT_SHOWN
    assert DESIGN_NOT_SHOWN == (
        "the design is not shown yet: Design effective needs every attribute shown as "
        "designed or settled by a tickmark"
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
    # A sign-off names the conclusion and the choice it signs. Old: the conclusion, or (for
    # one release) the two-value `verdict`, and no choice; new: `conclusion` and `choice_id`
    # both required, `verdict` refused (independent review, 15 November 2026,
    # docs/design-workpaper.md section 3.6).
    choice = str(UUID(int=7))
    with pytest.raises(ValidationError):
        SignOffBody.model_validate({"workpaper_version": 1})
    with pytest.raises(ValidationError):
        SignOffBody.model_validate({"conclusion": "NO_INSTANCE", "workpaper_version": 1})
    with pytest.raises(ValidationError):
        SignOffBody.model_validate(
            {"verdict": "EFFECTIVE", "choice_id": choice, "workpaper_version": 1}
        )
    with pytest.raises(ValidationError):
        SignOffBody.model_validate(
            {"conclusion": "EFFECTIVE", "verdict": "EFFECTIVE", "choice_id": choice,
             "workpaper_version": 1}
        )  # fmt: skip
    with pytest.raises(ValidationError):
        SignOffBody.model_validate(
            {"conclusion": "EFFECTIVE", "choice_id": "not-a-choice", "workpaper_version": 1}
        )
    signed = SignOffBody.model_validate(
        {"conclusion": "NO_INSTANCE", "choice_id": choice, "workpaper_version": 1}
    )
    assert (signed.conclusion, signed.choice_id) == ("NO_INSTANCE", UUID(int=7))


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


# --- A sign-off held to its conclusion's rules (independent review, 15 November 2026) ---

T_CHOICE = datetime(2027, 1, 1, 9, tzinfo=UTC)
T_PREPARED = datetime(2027, 1, 1, 10, tzinfo=UTC)
T_SIGNED = datetime(2027, 1, 1, 11, tzinfo=UTC)
CHOICE = UUID(int=40)


def _signed(
    kind: str,
    choice_id: UUID | None = CHOICE,
    seeded: bool = False,
    deficiencies: tuple[str, ...] = (),
    signed_deficiencies: tuple[str, ...] = (),
    exceptions: tuple[ExceptionRef, ...] = (),
) -> _Facts:
    """The facts of a sign-off of `kind` that stands on a prepared design workpaper, as
    `_facts` reads them: signed from the preparer's choice `choice_id` (None: made before
    choices were recorded, and no choice stands), or seeded with the demo."""
    choice = (
        None
        if choice_id is None
        else ChoiceRecord(
            id=choice_id, kind=kind, basis="DESIGN" if kind == "NOT_EFFECTIVE" else None,  # type: ignore[arg-type]
            reason="The preparer's reason for the conclusion.", proposed_kind=kind,  # type: ignore[arg-type]
            recorded_by="Pat Preparer", recorded_at=T_CHOICE, workpaper_version=1,
        )
    )  # fmt: skip
    verdict = "NOT_EFFECTIVE" if kind == "NOT_EFFECTIVE" else "EFFECTIVE"
    return _Facts(
        UUID(int=50),
        (UUID(int=51), "PREPARED", "IDLE", "Pat Preparer", 1, UUID(int=52), T_PREPARED, 1),
        [
            DeficiencyRef(id=UUID(int=60 + i), reference=ref, title=ref, status="OPEN")
            for i, ref in enumerate(deficiencies)
        ],
        (
            UUID(int=53), 1, verdict,
            [{"id": str(UUID(int=60 + i)), "reference": ref}
             for i, ref in enumerate(signed_deficiencies)],
            T_SIGNED, choice_id, kind, seeded,
        ),
        exceptions=exceptions,
        choice=choice,
        choice_by=None if choice_id is None else UUID(int=52),
    )  # fmt: skip


def _person_exception(code: str, at: datetime, current: bool = True) -> ExceptionRef:
    return ExceptionRef(
        disposition_id=UUID(int=70), attribute_id=UUID(int=71), code=code,
        requirement_id=R1, recorded_by_name="Pat Preparer", recorded_at=at,
        reason="The ticket was approved after the change.", check_current=current,
    )  # fmt: skip


def _found(code: str, at: datetime | None) -> AttributeStanding:
    return AttributeStanding(code=code, state="EXCEPTION", shown_by=None, found_at=at)


def test_a_signed_effective_conclusion_stops_holding_when_its_rule_would_refuse_it() -> None:
    facts = _signed("EFFECTIVE")
    assert facts.held_to_rules()
    settled = results_of(_all_in_instance("A", "B"))
    assert facts.out_of_date(settled) == []
    # A later check's exception: the rule's own sentence.
    later = results_of([_stand("A"), _found("B", T_SIGNED)])
    assert facts.out_of_date(later) == [
        "an exception stands on attribute B, so the conclusion cannot be “Effective”"
    ]
    # The implementation gone open (B shown only as designed now).
    designed = results_of([_stand("A"), _stand("B", by="DESIGN")])
    assert facts.out_of_date(designed) == [
        "attribute B is not yet shown in the records of an instance, so the conclusion "
        "cannot be “Effective”"
    ]
    # Shown only on files a person decided are not relied on: open as well.
    not_relied = results_of([_stand("A"), _stand("B", by="NOT_RELIED")])
    assert (not_relied.design.open, not_relied.implementation.open) == (["B"], ["B"])
    assert facts.out_of_date(not_relied) != []
    # A person's exception on an attribute whose state is not "Shown" still breaks it.
    person = results_of([_stand("A"), _stand("B", "NOT_TESTED", None)], excepted={"B"})
    assert facts.out_of_date(person)[-1] == (
        "an exception stands on attribute B, so the conclusion cannot be “Effective”"
    )


def test_a_design_deficiency_logged_since_is_said_once() -> None:
    facts = _signed("EFFECTIVE", deficiencies=("DEF-1",))
    settled = results_of(_all_in_instance("A", "B"))
    assert facts.out_of_date(settled) == [DEFICIENCY_LOGGED_SINCE]


def test_no_instance_stops_holding_once_the_design_is_open_or_an_exception_is_found() -> None:
    facts = _signed("NO_INSTANCE")
    assert facts.out_of_date(results_of([_stand("A", by="DESIGN")])) == []
    opened = results_of([_stand("A", by="DESIGN"), _stand("B", "NOT_TESTED", None)])
    assert facts.out_of_date(opened) == [DESIGN_NOT_SHOWN]
    found = results_of([_stand("A", by="DESIGN"), _found("B", T_SIGNED)])
    assert facts.out_of_date(found) == [DESIGN_NOT_SHOWN]


def test_exceptions_noted_stops_holding_without_an_exception_or_with_one_noted_since() -> None:
    facts = _signed("EXCEPTIONS_NOTED")
    seen = results_of([_stand("A"), _found("B", T_CHOICE)])
    assert facts.out_of_date(seen) == []
    # No exception left.
    gone = results_of(_all_in_instance("A", "B"))
    assert facts.out_of_date(gone) == [EXCEPTIONS_NEEDED]
    # Another attribute gone open.
    opened = results_of([_stand("A", "NOT_TESTED", None), _found("B", T_CHOICE)])
    assert facts.out_of_date(opened) == [EXCEPTIONS_NEEDED]
    # An exception a check found after the choice was recorded, or one whose run has no
    # finish time (never assumed seen).
    later = results_of([_stand("A"), _found("B", T_SIGNED)])
    assert later.found_since(T_CHOICE) and not seen.found_since(T_CHOICE)
    assert facts.out_of_date(later) == [EXCEPTION_SINCE]
    unknown = results_of([_stand("A"), _found("B", None)])
    assert facts.out_of_date(unknown) == [EXCEPTION_SINCE]
    # A person's exception recorded after the choice was recorded.
    person = _signed("EXCEPTIONS_NOTED", exceptions=(_person_exception("B", T_SIGNED),))
    recorded = results_of([_stand("A"), _stand("B", "EXCEPTION_RECORDED", None)], {"B"})
    assert person.out_of_date(recorded) == [EXCEPTION_SINCE]
    before = _signed("EXCEPTIONS_NOTED", exceptions=(_person_exception("B", T_CHOICE),))
    assert before.out_of_date(recorded) == []
    assert EXCEPTION_SINCE == (
        "an exception was noted after this conclusion was recorded; the preparer records it again"
    )


def test_not_effective_is_never_put_out_of_date_by_the_rule() -> None:
    facts = _signed("NOT_EFFECTIVE", deficiencies=("DEF-1",), signed_deficiencies=("DEF-1",))
    for results in (results_of([]), results_of(_all_in_instance("A"))):
        assert facts.out_of_date(results) == []


def test_a_sign_off_before_choices_or_seeded_by_the_demo_keeps_its_old_rules_only() -> None:
    opened = results_of([_stand("A", "NOT_TESTED", None)])
    # Made before choices were recorded (no choice_id, and none stands): not held to the
    # rule, and open attributes never put it out of date, as before section 3.6.
    before = _signed("EFFECTIVE", choice_id=None)
    assert not before.held_to_rules()
    assert before.out_of_date(opened) == []
    # Its old rule stays: a person's exception standing unanswered puts it out of date.
    unanswered = _signed(
        "EFFECTIVE", choice_id=None, exceptions=(_person_exception("A", T_SIGNED),)
    )
    assert unanswered.out_of_date(opened) == [EXCEPTION_UNANSWERED]
    # Seeded with the demo (a demo engagement, a demo identity): the same.
    seeded = _signed("EFFECTIVE", seeded=True)
    assert not seeded.held_to_rules()
    assert seeded.out_of_date(opened) == []
    # The choice still counts: another recorded since puts a held sign-off out of date.
    held = _signed("EFFECTIVE")
    settled = results_of(_all_in_instance("A"))
    assert held.out_of_date(settled) == []
    assert held.choice is not None
    replaced = replace(held, choice=held.choice.model_copy(update={"id": UUID(int=41)}))
    assert replaced.out_of_date(settled) == [CHOICE_CHANGED]


def test_standing_of_carries_when_a_check_found_the_exception() -> None:
    from ai_workforce_api.design_workpaper import AttributeBody

    excepted = AttributeBody.model_construct(code="B", state="EXCEPTION", shown_by=None)
    first, second = (
        Reading(requirement_id=R1, state="EXCEPTION", basis="", found_at=T_CHOICE),
        Reading(requirement_id=R2, state="EXCEPTION", basis="", found_at=T_SIGNED),
    )
    assert standing_of(excepted, [first, second]).found_at == T_SIGNED
    # One without a finish time: unknown, which the conclusion reads as not yet seen.
    third = Reading(requirement_id=R2, state="EXCEPTION", basis="", found_at=None)
    assert standing_of(excepted, [first, third]).found_at is None
    # Only an exception of the check carries a time.
    shown = AttributeBody.model_construct(code="A", state="SHOWN", shown_by="IMPLEMENTATION")
    assert standing_of(shown, [first]).found_at is None
