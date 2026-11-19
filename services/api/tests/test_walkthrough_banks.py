"""The walkthrough banks after the review of the questions asked (B1k and B1l, agreed by the
product owner on 16 November 2026, docs/control-workflow-plan.md): "does the agent also
consider all the possible questions that are needed to be asked so no questions will be
missed?"

- ITGC-CM-06's bank asks the three facts its attributes needed after the walkthrough: who
  applies patches to production, how a patch in the patch history is linked to its change
  record, and how a patch applied without prior approval is approved afterwards.
- Every bank was checked the same way: each attribute of the access and change families
  names the kinds of fact its criteria need, and each need is met by a question that informs
  the attribute or by a recorded reason (a statement value, or what each item's evidence
  shows).
- Every question has a machine-readable kind of fact, and `informing` gives the review the
  questions that inform an attribute.
- A question added later does not disturb finished work (`since`; walkthrough_answers.holds).

Pure unit tests: no database (the since rule's database read is in
test_walkthrough_since.py).
"""

import re
from dataclasses import replace
from datetime import date

import pytest

from ai_workforce_api import walkthrough_questions
from ai_workforce_api.controls import LIBRARY_KEYS
from ai_workforce_api.definition_registry import definition_for
from ai_workforce_api.statement_registry import STATEMENTS
from ai_workforce_api.walkthrough_answers import holds
from ai_workforce_api.walkthrough_questions import (
    B1K_ADDED,
    CONTROL_QUESTIONS,
    CRITERIA_NEEDS,
    FACTS,
    INFORMS,
    KEY,
    MET_ELSEWHERE,
    Question,
    criteria_needs,
    fact_of,
    informing,
    met_elsewhere,
    narrate,
    problems,
    question,
    questions_for,
    valid_answer,
)

# The questions B1k added, with the bank each is in and its kind of fact.
ADDED: dict[str, tuple[str, str]] = {
    "wt-cm06-who-applies": ("change-patching", "PERFORMER"),
    "wt-cm06-change-link": ("change-patching", "RECORD"),
    "wt-cm06-unapproved": ("change-patching", "APPROVER"),
    "wt-ac02-account-mapping": ("access-termination", "POPULATION"),
    "wt-ac07-reapproval-record": ("access-transfer", "RECORD"),
    "wt-ac07-removal-record": ("access-transfer", "RECORD"),
    "wt-cm05-data-owner": ("change-data", "APPROVER"),
}
# The bank's size before B1k: no question was removed.
BEFORE_B1K = 138


def _keys(items: tuple[Question, ...] | list[Question]) -> list[str]:
    return [item.key for item in items]


def _asked(library_key: str) -> list[str]:
    statement = STATEMENTS[library_key]
    return _keys(questions_for(library_key, statement.nature, statement.frequency))


def _family_keys() -> list[str]:
    # Rewritten 18 November 2026 (the operations family's banks). Old: the access and change
    # families only. New: the operations family too. Justification: walkthrough_questions
    # now records needs for every operations attribute (FAMILIES names "operations-"), so the
    # checks that every family attribute's needs are met, that CRITERIA_NEEDS names exactly
    # the family attributes, and that each reason names only its control's values and
    # questions apply to it unchanged.
    return [key for key in LIBRARY_KEYS if key.startswith(("access-", "change-", "operations-"))]


# The bank's invariants.


def test_the_bank_has_no_structural_problems_with_its_facts_and_needs() -> None:
    assert problems() == []


def test_the_questions_added_by_b1k_are_these_and_nothing_was_removed() -> None:
    every = walkthrough_questions._all()
    # Rewritten 18 November 2026 (the operations family's banks). Old: every question with
    # a `since` was one of B1k's (all dated 16 November). New: the questions dated
    # 16 November are exactly B1k's, and the only other dated questions are the operations
    # banks', all dated 18 November (OPERATIONS_ADDED); the 138 undated questions are
    # unchanged. Justification: a bank added later carries its own date so that finished
    # controls are not held by it (walkthrough_answers.holds); the B1k set and the count of
    # the original bank are asserted as exactly as before.
    later = {item.key: item for item in every if item.since == B1K_ADDED}
    assert set(later) == set(ADDED)
    assert {item.since for item in later.values()} == {B1K_ADDED} == {date(2026, 11, 16)}
    operations = {key for key, items in CONTROL_QUESTIONS.items() if key.startswith("operations-")}
    added_later = {item.key for item in every if item.since is not None and item.since != B1K_ADDED}
    assert added_later == {item.key for key in operations for item in CONTROL_QUESTIONS[key]}
    assert {item.since for item in every if item.key in added_later} == {
        walkthrough_questions.OPERATIONS_ADDED
    }
    assert len([item for item in every if item.since is None]) == BEFORE_B1K
    keys = _keys(list(every))
    assert len(keys) == len(set(keys))
    for key, (bank, fact) in ADDED.items():
        item = later[key]
        assert item in CONTROL_QUESTIONS[bank], key
        assert KEY.match(key) and item.text.endswith("?"), key
        assert item.required and fact_of(item) == fact, key
        definition = definition_for(bank)
        assert definition is not None
        attributes = {attribute.key for attribute in definition.attributes}
        named = [need for need in item.informs if need not in INFORMS]
        # Each names the attribute its answer serves, and only real attributes of its control.
        assert item.informs and named and set(named) <= attributes, key
        if item.kind in ("CHOICE", "MULTI"):
            # Options with the usual answers first, and room for one they do not offer.
            assert 3 <= len(item.options) <= 8 and item.allows_other, key
            assert valid_answer(item, item.options[0]), key
        else:
            assert item.kind == "YES_NO", key


def test_the_new_questions_speak_plainly_and_neutrally() -> None:
    # Product copy never says "the client", and never "open" for a question asked.
    for key in ADDED:
        item = question(key)
        assert item is not None
        words = " ".join(
            (item.text, item.why, item.narrative, item.narrative_yes, item.narrative_no,
             *item.options)
        ).casefold()  # fmt: skip
        assert "the client" not in words and not re.search(r"\bopen\b", words), key


def test_every_question_has_a_kind_of_fact() -> None:
    every = walkthrough_questions._all()
    assert FACTS == (
        "PERFORMER", "APPROVER", "SYSTEM", "RECORD", "TIMING", "POPULATION", "EXCEPTION", "OTHER"
    )  # fmt: skip
    assert all(fact_of(item) in FACTS for item in every)
    assert set(walkthrough_questions._FACTS) == {item.key for item in every}
    # Each kind is the fact of at least one question.
    assert {fact_of(item) for item in every} == set(FACTS)
    # A few by name.
    facts = {key: fact_of(item) for key in ("wt-ac01-authority", "wt-cm-who-deploys",
             "wt-ac-change-logging", "wt-ac01-enforced-approval", "wt-known-deviations",
             "wt-cm-population-source") if (item := question(key)) is not None}  # fmt: skip
    assert facts == {
        "wt-ac01-authority": "APPROVER",
        "wt-cm-who-deploys": "PERFORMER",
        "wt-ac-change-logging": "RECORD",
        "wt-ac01-enforced-approval": "TIMING",
        "wt-known-deviations": "EXCEPTION",
        "wt-cm-population-source": "POPULATION",
    }


def test_problems_reports_a_question_with_no_kind_of_fact(monkeypatch: pytest.MonkeyPatch) -> None:
    bank = CONTROL_QUESTIONS["change-patching"]
    testing = question("wt-cm06-testing")
    assert testing is not None
    unnamed = replace(testing, key="wt-cm06-unnamed", text="Who else tests patches?", order=90)
    monkeypatch.setitem(CONTROL_QUESTIONS, "change-patching", (*bank, unnamed))
    assert "wt-cm06-unnamed: no kind of fact chosen (_FACTS)" in problems()


# ITGC-CM-06: the three facts its attributes needed later, placed where the patch reaches them.


def test_the_patching_bank_asks_the_three_facts_its_attributes_needed_later() -> None:
    asked = _asked("change-patching")
    for key in ("wt-cm06-who-applies", "wt-cm06-change-link", "wt-cm06-unapproved"):
        assert key in asked, key
    # Chronological: tested, then applied; approved independently; linked to its record; the
    # exception of a patch applied first, before the known deviations; then the population.
    order = [
        "wt-cm06-testing",
        "wt-cm06-who-applies",
        "wt-cm06-approver-independent",
        "wt-cm06-change-link",
        "wt-cm06-unapproved",
        "wt-known-deviations",
        "wt-cm06-history",
    ]
    assert [key for key in asked if key in order] == order
    who = question("wt-cm06-who-applies")
    link = question("wt-cm06-change-link")
    late = question("wt-cm06-unapproved")
    assert who is not None and link is not None and late is not None
    assert (who.topic, who.kind) == ("EXECUTION", "MULTI")
    assert (link.topic, link.kind) == ("RECORDS", "MULTI")
    assert (late.topic, late.kind) == ("EXCEPTIONS", "CHOICE")
    assert "cm06-independent" in who.informs
    assert "cm06-record" in link.informs
    assert "cm06-approved" in late.informs
    # A link by date alone is offered as what it is: the attribute does not infer from it.
    assert link.options[-1] == "The patch name and date only"
    # Each reads in the understanding.
    told = dict(
        narrate(
            questions_for("change-patching"),
            {
                "wt-cm06-who-applies": "Server or infrastructure administrators; "
                "Database administrators",
                "wt-cm06-change-link": "The patch and hosts listed on the change record",
                "wt-cm06-unapproved": "Approved afterwards under the emergency change procedure",
            },
        )
    )
    text = {topic: "".join(part for part, _ in parts) for topic, parts in told.items()}
    assert text["EXECUTION"] == (
        "Patches are applied to production by server or infrastructure administrators and "
        "database administrators."
    )
    assert text["RECORDS"] == (
        "A patch in the patch history is linked to its change record by the patch and hosts "
        "listed on the change record."
    )
    assert text["EXCEPTIONS"] == (
        "A patch applied without prior approval is approved afterwards under the emergency "
        "change procedure."
    )


def test_the_other_banks_ask_what_their_attributes_could_not_be_written_without() -> None:
    # Leavers: local accounts to remove are asked how they are found, once the directory
    # alone does not stop sign-in.
    mapping = question("wt-ac02-account-mapping")
    assert mapping is not None and mapping.when == ("wt-ac02-directory-only", "No")
    assert "ac02-accounts" in mapping.informs
    # Transfers: where each re-approval is recorded, once the new manager re-approves, and
    # whether the system records each removal, which the deadline is tested against.
    record = question("wt-ac07-reapproval-record")
    assert record is not None
    assert record.when == ("wt-ac07-old-access", "The new manager re-approves what the user keeps")
    removal = question("wt-ac07-removal-record")
    assert removal is not None and removal.when is None and removal.topic == "RECORDS"
    assert {"ac07-removed", "ac07-timely"} <= set(removal.informs)
    # Direct data changes: how the data owner the statement names is identified.
    owner = question("wt-cm05-data-owner")
    assert owner is not None and owner.topic == "APPROVAL" and "cm05-approved" in owner.informs
    assert "wt-cm05-data-owner" in _asked("change-data")
    assert "wt-ac07-removal-record" in _asked("access-transfer")


# Every attribute's needs are met.


def test_every_family_attribute_has_a_question_for_each_need_or_a_recorded_reason() -> None:
    unmet: list[str] = []
    seen: set[str] = set()
    for library_key in _family_keys():
        definition = definition_for(library_key)
        assert definition is not None, library_key
        for attribute in definition.attributes:
            seen.add(attribute.key)
            needs = criteria_needs(attribute.key)
            assert needs, attribute.key
            facts = {fact_of(item) for item in informing(library_key, attribute.key)}
            for need in needs:
                reason = met_elsewhere(attribute.key, need)
                if need in facts:
                    assert reason == "", (attribute.key, need)
                elif not reason:
                    unmet.append(f"{library_key} {attribute.key} {need}")
                else:
                    assert reason.endswith(".") and len(reason) <= 260, (attribute.key, need)
    assert unmet == []
    assert set(CRITERIA_NEEDS) == seen
    assert all(need in criteria_needs(key) for key, need in MET_ELSEWHERE)


def test_a_reason_names_only_the_controls_statement_values_and_questions() -> None:
    owner = {
        attribute.key: library_key
        for library_key in _family_keys()
        if (definition := definition_for(library_key)) is not None
        for attribute in definition.attributes
    }
    for (key, need), reason in MET_ELSEWHERE.items():
        library_key = owner[key]
        slots = {slot.key for slot in STATEMENTS[library_key].slots}
        for slot in re.findall(r"\{([a-z][a-z0-9-]+)\}", reason):
            assert slot in slots, (key, need, slot)
        for name in re.findall(r"\bwt-[a-z0-9-]+[a-z0-9]", reason):
            assert name in _keys(questions_for(library_key)), (key, need, name)


def test_problems_reports_a_need_left_without_a_question(monkeypatch: pytest.MonkeyPatch) -> None:
    # Without the question of who applies patches, the independence attribute's performer
    # would be met by nothing: the gap ITGC-CM-06 showed on 16 November 2026.
    bank = tuple(
        item for item in CONTROL_QUESTIONS["change-patching"] if item.key != "wt-cm06-who-applies"
    )
    monkeypatch.setitem(CONTROL_QUESTIONS, "change-patching", bank)
    found = problems()
    assert "cm06-independent: no question informs its PERFORMER and no reason is given" in found
    # And a reason left beside a question that informs the need is reported too.
    monkeypatch.setitem(CONTROL_QUESTIONS, "change-patching", (*bank,))
    monkeypatch.setitem(MET_ELSEWHERE, ("cm06-record", "RECORD"), "Read from the evidence.")
    assert "cm06-record: RECORD is informed by a question and has a reason" in problems()


# informing and fact_of: what the review reads.


def test_informing_gives_the_questions_of_one_attribute_in_asking_order() -> None:
    found = informing("change-patching", "cm06-independent")
    assert _keys(found) == ["wt-cm06-who-applies", "wt-cm06-approver-independent"]
    assert [fact_of(item) for item in found] == ["PERFORMER", "APPROVER"]
    # Follow-ups are included, whether or not their parent's answer opens them.
    assert _keys(informing("access-transfer", "ac07-reapproved")) == [
        "wt-ac07-old-access",
        "wt-ac07-transition-approver",
        "wt-ac07-reapproval-record",
    ]
    # A family question informs the attribute of the controls it is asked for only.
    assert "wt-cm-who-deploys" in _keys(informing("change-segregation", "cm03-separate"))
    assert informing("change-patching", "cm03-separate") == ()
    # Unknown control or attribute: nothing.
    assert informing("not-a-control", "cm06-record") == ()
    assert informing("change-patching", "not-an-attribute") == ()
    # Pure and deterministic.
    assert informing("change-patching", "cm06-record") == informing(
        "change-patching", "cm06-record"
    )


def test_criteria_needs_and_reasons_read_by_key() -> None:
    assert criteria_needs("cm06-independent") == ("APPROVER", "PERFORMER")
    assert criteria_needs("cm06-record") == ("RECORD",)
    assert criteria_needs("not-an-attribute") == ()
    assert met_elsewhere("cm06-independent", "PERFORMER") == ""
    assert met_elsewhere("cm06-approved", "TIMING").startswith("The statement fixes the order")
    assert met_elsewhere("ac03-deadline", "TIMING").startswith("{review-deadline}")
    assert met_elsewhere("not-an-attribute", "RECORD") == ""


# The since rule: a question added later does not disturb finished work.


def test_a_question_in_the_bank_from_the_start_holds_every_control() -> None:
    old = question("wt-cm06-testing")
    assert old is not None and old.since is None
    assert holds(old, None, False)
    assert holds(old, date(2026, 11, 1), False)
    assert holds(old, date(2026, 11, 1), True)


def test_a_question_added_later_holds_only_a_control_still_in_progress() -> None:
    new = question("wt-cm06-who-applies")
    assert new is not None and new.since == B1K_ADDED
    # In progress: asked and required.
    assert holds(new, None, False)
    # Completed before the question was added: not held.
    assert not holds(new, date(2026, 11, 15), False)
    # Rewritten after the review of B1k (16 November 2026; B1l point 2, B1j point 2: a
    # completion is never reopened). Old: a control completed the day the question was added
    # or later was held by it ("it was asked before completion"), so a control completed by
    # acceptance was held as soon as its acceptance lapsed. New: a completed control is never
    # held by a question added later, whatever the day.
    assert not holds(new, date(2026, 11, 16), False)
    assert not holds(new, date(2026, 11, 20), False)
    # Attributes accepted: completed (B1l point 2), never held, whatever the date.
    assert not holds(new, None, True)
    assert not holds(new, date(2026, 11, 20), True)
