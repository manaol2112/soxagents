"""The IT audit specialist's review of the questions asked: what an ESTABLISHED verdict rests
on, and nothing it asks disappears (owner-approved fixes, 18 November 2026, after the
independent revalidation of the question flow: F1, F2 and F3). The pure rules, with no
database; the same rules on the database are in test_understanding_review_nothing_lost.py.

F1 (tightened by the owner, 18 November 2026): an ESTABLISHED verdict cites, for each fact
its attribute needs, what establishes it: a walkthrough answer of that kind of fact, a value
whose slot records it, an answered question that asked it, or a passage quoted from a
document or the confirmed narrative for that need, found there by the strict matcher; a bare
assertion, a ref the inputs do not give, one of another fact, or a passage made up, from
another text or negated there is refused once and then marked not reviewed.
F2: a second question on a key, a verdict given twice, a follow-up that cannot be asked and a
repeat of a key already assumed are kept as assumptions by their matter; what a walkthrough
answer holds is not asked again but never read as established.
F3: the specialist reads the engagement's own criteria over the library standard, and a
tailored attribute's needs come from its own wording.
"""

import re
from dataclasses import replace
from typing import Any
from uuid import UUID

import pytest

from ai_workforce_api import understanding_review as review
from ai_workforce_api.understanding_review import (
    Answer,
    Parent,
    Unit,
    check,
    key_of,
    plan,
)

# A walkthrough answer of who approves (APPROVER), one of the record kept (RECORD), and one
# of who performs (PERFORMER); a value whose slot records the system (SYSTEM); an answered
# question that asked the record (RECORD); one of the agents' questions asked of no kind.
W1 = Parent("W1", question_key="wt-change-approver", fact="APPROVER")
W2 = Parent("W2", question_key="wt-change-record", fact="RECORD")
W3 = Parent("W3", question_key="wt-change-performer", fact="PERFORMER")
V1 = Parent("V1", covers=("SYSTEM",))
Q1 = Parent("Q1", issue_id=UUID("018f0000-0000-7000-8000-0000000000b1"), covers=("RECORD",))
Q2 = Parent("Q2", issue_id=UUID("018f0000-0000-7000-8000-0000000000b2"))
PARENTS = {"W1": W1, "W2": W2, "W3": W3, "V1": V1, "Q1": Q1, "Q2": Q2}
# The documents and the confirmed narrative, by ref, as the inputs give them.
POLICY = (
    "Change Management Standard v3.\n"
    "Every change to production is approved by the Change Advisory Board before release.\n"
    "Each approval is recorded on the change ticket in ServiceNow.\n"
    "Emergency changes are not reviewed by the board before release."
)
NARRATIVE = (
    "The developer raises a ticket for each change.\n"
    "1. The CAB chair approves each change on its ticket before release (CAB chair, ServiceNow)"
)
TEXTS = {"D1": POLICY, review.NARRATIVE_REF: NARRATIVE}
REMOVAL = "Does the system record the date each account was disabled or removed, and who did it?"
NEEDS = Unit("A1", "A1", "The change is approved and recorded.", needs=("APPROVER", "RECORD"))
OPEN = Unit("A2", "A2", "A custom attribute the bank records no needs for.")


def _question(topic: str, fact: str, text: str = "Which record shows it?") -> dict[str, Any]:
    return {
        "topic": topic,
        "text": text,
        "fact": fact,
        "blocks": "Attribute A1 cannot be written without it.",
        "suggested": "The change ticket records it.",
        "options": ["The change ticket records it.", "A spreadsheet records it."],
    }


def _answer(
    verdicts: list[dict[str, Any]], follow_ups: list[dict[str, Any]] | None = None
) -> Answer:
    return Answer.model_validate(
        {
            "narrative": "The answers establish how a change is approved. They do not yet "
            "establish which record shows it, on which A1 depends. This is asked now.",
            "marked": ["which record shows it"],
            "verdicts": verdicts,
            "follow_ups": follow_ups or [],
        }
    )


def _established(
    unit: str, *refs: str, cites: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    return {"attribute": unit, "verdict": "ESTABLISHED", "rests_on": list(refs),
            "cites": cites or []}  # fmt: skip


def _cite(ref: str, need: str, quote: str) -> dict[str, str]:
    return {"ref": ref, "need": need, "quote": quote}


# F1: what an ESTABLISHED verdict rests on


def test_an_established_verdict_citing_an_answer_not_given_is_refused_then_not_reviewed() -> None:
    # Revalidation F1: the specialist cited W999; the code kept the verdict ESTABLISHED on
    # nothing, and the understanding completed on the model's word alone.
    answer = _answer([_established("A1", "W999"), _established("A2", "W999")])
    with pytest.raises(ValueError, match="A1 is ESTABLISHED but cites nothing that establishes"):
        check(answer, [NEEDS, OPEN], PARENTS, 1, strict=True, texts=TEXTS)
    kept = check(answer, [NEEDS, OPEN], PARENTS, 1, strict=False, texts=TEXTS)
    assert kept.not_reviewed == ("A1", "A2") and kept.verdicts == () and kept.asked == ()
    assert any("cites W999, which the inputs do not give" in note for note in kept.dropped)


def test_an_established_verdict_resting_on_nothing_is_refused_whatever_the_needs() -> None:
    for unit in (NEEDS, OPEN, Unit("PERFORMER", None, "PERFORMER")):
        answer = _answer([_established(unit.key)])
        with pytest.raises(ValueError, match="is ESTABLISHED but cites nothing"):
            check(answer, [unit], PARENTS, 1, strict=True, texts=TEXTS)
        assert check(answer, [unit], PARENTS, 1, strict=False).not_reviewed == (unit.key,)


def test_a_citation_of_an_answer_of_another_fact_establishes_nothing_it_needs() -> None:
    # Adversarial: W3 answers who performs it, not who approves it or what records it.
    wrong = _answer([_established("A1", "W3")])
    with pytest.raises(ValueError, match="establishes APPROVER, RECORD:"):
        check(wrong, [NEEDS], PARENTS, 1, strict=True)
    half = _answer([_established("A1", "W1", "W3")])
    with pytest.raises(ValueError, match="establishes RECORD:"):
        check(half, [NEEDS], PARENTS, 1, strict=True)
    # Each need covered by an answer of its own kind of fact: established, as cited.
    whole = check(_answer([_established("A1", "W1", "W2")]), [NEEDS], PARENTS, 1, strict=True)
    assert whole.verdicts == ({"attribute": "A1", "verdict": "ESTABLISHED",
                               "rests_on": ["W1", "W2"]},)  # fmt: skip
    assert whole.not_reviewed == ()


def test_one_value_cited_for_every_need_establishes_only_what_its_slot_records() -> None:
    # Owner decision, 18 November 2026 ("Tighten citations"), adversarial: V1 (the change
    # tool, a SYSTEM slot) cited for an attribute that needs who approves and the record.
    with pytest.raises(ValueError, match="establishes APPROVER, RECORD:"):
        check(_answer([_established("A1", "V1")]), [NEEDS], PARENTS, 1, True, TEXTS)
    system = Unit("A4", "A4", "Changes are made in the change tool.", needs=("SYSTEM",))
    assert check(_answer([_established("A4", "V1")]), [system], PARENTS, 1, True).verdicts
    # An answered question establishes only the kind of fact it asked; one of no kind, none.
    with pytest.raises(ValueError, match="establishes APPROVER:"):
        check(_answer([_established("A1", "Q1")]), [NEEDS], PARENTS, 1, True)
    with pytest.raises(ValueError, match="establishes APPROVER, RECORD:"):
        check(_answer([_established("A1", "Q2")]), [NEEDS], PARENTS, 1, True)
    assert check(_answer([_established("A1", "W1", "Q1")]), [NEEDS], PARENTS, 1, True).verdicts
    # Which facts a slot records: by the bank's own record of it, then by its kind.
    assert review.slot_facts("change-tool", "SYSTEM") == ("SYSTEM", "RECORD")
    assert review.slot_facts("x-tool", "SYSTEM") == ("SYSTEM",)
    assert review.slot_facts("x-days", "DAYS") == ("TIMING",)
    assert review.slot_facts("x-text", "TEXT") == ()
    # A role slot: the bank's explicit record, never the slot's words (independent review,
    # 18 November 2026: every control owner read as who performs it). An unlisted role slot
    # records nothing.
    assert review.slot_facts("access-owner", "ROLE", "the control owner for user access") == ()
    assert review.slot_facts("signatory-owner", "ROLE", "the control owner for bank access") == ()
    assert review.slot_facts("conduct-oversight", "ROLE", "the body") == ("APPROVER",)
    assert review.slot_facts("admin-role", "ROLE") == ("PERFORMER",)
    assert review.slot_facts("account-reviewer", "ROLE") == ("PERFORMER", "APPROVER")
    assert review.slot_facts("x-reviewer", "ROLE", "the reviewer who signs") == ()


def test_a_document_or_the_narrative_establishes_a_need_only_with_its_own_passage() -> None:
    # Owner decision ("Tighten citations"): a document (D) or the narrative (P1) counts only
    # with a passage quoted from that text, found by the strict matcher, for the need named.
    approves = "approved by the Change Advisory Board before release"
    recorded = "Each approval is recorded on the change ticket"
    both = [_cite("D1", "APPROVER", approves), _cite("D1", "RECORD", recorded)]
    checked = check(_answer([_established("A1", cites=both)]), [NEEDS], PARENTS, 1, True, TEXTS)
    assert checked.verdicts[0]["cites"] == both
    narrated = _cite(review.NARRATIVE_REF, "APPROVER", "The CAB chair approves each change")
    on_narrative = check(_answer([_established("A1", "W2", cites=[narrated])]), [NEEDS],
                         PARENTS, 1, True, TEXTS)  # fmt: skip
    assert on_narrative.verdicts[0]["cites"] == [narrated]
    # A passage of the document cited for another need establishes only the need it names.
    with pytest.raises(ValueError, match="establishes RECORD:"):
        check(_answer([_established("A1", cites=[both[0]])]), [NEEDS], PARENTS, 1, True, TEXTS)
    # The ref alone, without a passage, is no citation.
    with pytest.raises(ValueError, match="cites nothing that establishes"):
        check(_answer([_established("A1", "D1")]), [NEEDS], PARENTS, 1, True, TEXTS)


def test_a_passage_the_document_does_not_hold_establishes_nothing() -> None:
    # Adversarial: a passage made up, one quoted from a document the inputs do not give (D9),
    # and one from a different control's narrative.
    for cite in (
        _cite("D1", "APPROVER", "approved by the Chief Information Officer before release"),
        _cite("D9", "APPROVER", "approved by the Change Advisory Board before release"),
        _cite(review.NARRATIVE_REF, "APPROVER", "The HR manager approves each leaver request"),
    ):
        answer = _answer([_established("A1", "W2", cites=[cite])])
        with pytest.raises(ValueError, match="establishes APPROVER:"):
            check(answer, [NEEDS], PARENTS, 1, True, TEXTS)
        kept = check(answer, [NEEDS], PARENTS, 1, False, TEXTS)
        assert kept.not_reviewed == ("A1",)
        assert any("quotes a passage that is not in" in note for note in kept.dropped)


def test_a_passage_the_document_negates_establishes_nothing() -> None:
    # Adversarial: "Emergency changes are not reviewed by the board before release" quoted as
    # "reviewed by the board before release" (the strict matcher refuses a negated passage;
    # console_citations.find_passage, the one matcher).
    negated = _cite("D1", "APPROVER", "reviewed by the board before release")
    with pytest.raises(ValueError, match="establishes APPROVER:"):
        check(_answer([_established("A1", "W2", cites=[negated])]), [NEEDS], PARENTS, 1, True,
              TEXTS)  # fmt: skip


def test_a_document_ref_never_names_the_answer_a_follow_up_follows() -> None:
    follow = {**_question("Policy owner", "APPROVER"), "parent": "D1", "attribute": "A1"}
    checked = check(_answer([_established("A1", "W1", "W2")], [follow]), [NEEDS], PARENTS, 1,
                    True, TEXTS)  # fmt: skip
    assert [item.follow_up for item in checked.asked] == [False]
    assert checked.asked[0].by_matter


def test_needs_met_elsewhere_ask_no_citation_and_an_unrecorded_unit_cites_one() -> None:
    met = Unit("A3", "A3", "Everything is met by a value.", needs=())
    assert check(_answer([_established("A3")]), [met], PARENTS, 1, True).not_reviewed == ()
    # A unit whose needs the bank does not record is held to what its own words name
    # (18 November 2026; old: any one valid citation): OPEN's wording needs the record.
    assert review.needs_of(OPEN.text) == ("RECORD",)
    assert check(_answer([_established("A2", "W2")]), [OPEN], PARENTS, 1, True).verdicts
    with pytest.raises(ValueError, match="establishes RECORD:"):
        check(_answer([_established("A2", "W3")]), [OPEN], PARENTS, 1, True)
    assert review.unsupported(OPEN, [], PARENTS) == ("RECORD",)
    assert review.unsupported(NEEDS, ["W1"], PARENTS) == ("RECORD",)
    assert review.support_of("W9", PARENTS) is None
    assert review.support_of("D1", PARENTS) is None


def test_the_scripted_specialist_cites_what_the_inputs_give() -> None:
    # review.established, the suite's default specialist, rests every verdict on what passes
    # the check (old: "rests_on": [] for every unit; then any value for any need).
    given = {
        "units": [{"key": "A1"}, {"key": "A2"}, {"key": "A3"}, {"key": "A4"}],
        "attributes": [
            {"unit": "A1", "needs": ["APPROVER", "RECORD"], "questions": [
                {"ref": "W1", "fact": "APPROVER", "answer": "The CAB approves."},
                {"ref": "W2", "fact": "RECORD", "answer": ""},
            ]},
            {"unit": "A2", "needs": ["SYSTEM"], "questions": []},
            {"unit": "A3", "needs": [], "questions": []},
            {"unit": "A4", "needs": ["TIMING"], "questions": []},
        ],
        "control_questions": [],
        "statement_values": [{"ref": "V1", "question": "Tool?", "answer": "ServiceNow",
                              "establishes": ["SYSTEM"]}],
        "answered_questions": [],
        "documents": [{"ref": "D1", "title": "Policy", "summary": POLICY}],
    }  # fmt: skip
    answer = review.established(given)
    support = [(v["rests_on"], [c["need"] for c in v["cites"]]) for v in answer["verdicts"]]
    assert support == [(["W1"], ["RECORD"]), (["V1"], []), (["W1"], []), ([], ["TIMING"])]
    units = [NEEDS, Unit("A2", "A2", "x", needs=("SYSTEM",)), Unit("A3", "A3", "y", support=()),
             Unit("A4", "A4", "z", needs=("TIMING",))]  # fmt: skip
    checked = check(Answer.model_validate(answer), units, {"W1": W1, "V1": V1}, 1, True, TEXTS)
    assert checked.not_reviewed == ()


# F2: nothing the answer asks disappears


def test_two_record_questions_on_one_attribute_are_both_kept() -> None:
    # Revalidation F2: a verdict given twice for one attribute; the second's question was
    # dropped with an audit note only.
    answer = _answer([
        {"attribute": "A1", "verdict": "NOT_ESTABLISHED", "rests_on": [],
         "question": _question("Change population report", "RECORD",
                               "Which report lists all production changes?")},
        {"attribute": "A1", "verdict": "NOT_ESTABLISHED", "rests_on": [],
         "question": _question("Approval record", "RECORD")},
    ])  # fmt: skip
    checked = check(answer, [NEEDS], PARENTS, 1, strict=True)
    by_topic = {item.topic: item for item in checked.asked}
    first, second = by_topic["Change population report"], by_topic["Approval record"]
    assert len(checked.asked) == 2
    assert (first.topic, first.assume_only) == ("Change population report", False)
    assert (second.topic, second.code, second.assume_only, second.by_matter) == (
        "Approval record", "A1", True, True,
    )  # fmt: skip
    assert "verdicts: A1 given twice, so its question is assumed" in checked.dropped
    planned = plan(checked.asked, set(), 1)
    assert planned.ask == (first,) and planned.assume == (second,)
    # Recorded by its matter, so the key-once index cannot swallow it.
    draft = review._assumption_of(second)
    assert draft is not None and draft.asks_fact is None and draft.codes == ("A1",)


def test_two_follow_ups_of_one_answer_are_both_kept() -> None:
    # Revalidation F2: both keyed ("ANSWER", wt-x, ""); plan() asked the first and dropped the
    # second without a trace.
    follow_ups = [
        {**_question("Change population report", "POPULATION",
                     "Which report lists all production changes?"), "parent": "W1",
         "attribute": "A1"},
        {**_question("Approval record", "RECORD"), "parent": "W1", "attribute": "A1"},
    ]  # fmt: skip
    units = [replace(NEEDS, needs=None)]
    checked = check(_answer([_established("A1", "W1", "W2")], follow_ups), units, PARENTS, 1, True)
    assert [item.key for item in checked.asked] == [("ANSWER", "wt-change-approver", "")] * 2
    planned = plan(checked.asked, set(), 1)
    [asked] = planned.ask
    [kept] = planned.assume
    assert {asked.topic, kept.topic} == {"Change population report", "Approval record"}
    assert kept.by_matter and planned.repeated == 0


def test_a_repeat_of_a_key_already_assumed_is_kept_by_its_matter() -> None:
    held = {key_of("A1", "RECORD", None, ""): review.Holder("ASSUMED")}
    item = check(
        _answer([{"attribute": "A1", "verdict": "NOT_ESTABLISHED", "rests_on": [],
                  "question": _question("Approval record", "RECORD")}]),
        [NEEDS], PARENTS, 2, True,
    ).asked[0]  # fmt: skip
    planned = plan([item], held, 2)
    assert planned.ask == () and [i.by_matter for i in planned.assume] == [True]


def test_a_follow_up_that_cannot_be_asked_as_written_is_kept_unless_it_leaks() -> None:
    no_blocks = {**_question("Approval record", "RECORD"), "blocks": " ", "parent": "W1",
                 "attribute": "A1"}  # fmt: skip
    leaking = {**_question("Secret", "RECORD", "Is the password=hunter2secret kept?"),
               "parent": "W1", "attribute": "A1"}  # fmt: skip
    checked = check(_answer([_established("A1", "W1", "W2")], [no_blocks, leaking]), [NEEDS],
                    PARENTS, 1, True)  # fmt: skip
    assert [(item.topic, item.by_matter) for item in checked.asked] == [("Approval record", True)]
    assert checked.dropped == (
        "follow_ups[0]: not a question to ask, so it is assumed",
        "follow_ups[1]: not a question to ask",
    )


def test_a_no_to_the_removal_record_is_never_read_as_establishing_a_record() -> None:
    # Revalidation F2(b): "No" to wt-ac02-removal-record (the system keeps no removal record)
    # held (A1, RECORD) and opened no follow-up, so plan() marked a removal-record question
    # established and told() rewrote the verdict ESTABLISHED and deleted its gap sentence.
    holder = review.Holder("BANK", "wt-ac02-removal-record", opens=review.opens_follow_up(
        "YES_NO", "No"), ref="W4", said=((REMOVAL, "No"),))  # fmt: skip
    assert holder.opens is False
    checked = check(
        _answer([{"attribute": "A1", "verdict": "NOT_ESTABLISHED", "rests_on": ["W2"],
                  "question": _question("Removal record", "RECORD",
                                        "Which record shows who removed each account?")}]),
        [NEEDS], PARENTS, 1, True,
    )  # fmt: skip
    planned = plan(checked.asked, {key_of("A1", "RECORD", None, ""): holder}, 1)
    # Not asked again, as the owner decided ("Yes/No always settles")...
    assert planned.ask == () and [item.topic for item, _h in planned.answered] == ["Removal record"]
    # ...but never established: the verdict and the gap sentence stay; the process sentence
    # ("This is asked now.") does not (19 November 2026).
    assert checked.verdicts[0]["verdict"] == "NOT_ESTABLISHED"
    assert checked.narrative.endswith("which record shows it, on which A1 depends.")
    # It is an assumption a person sees, with the answer and what it does not establish.
    [(item, held)] = planned.answered
    gap = review.walkthrough_gap(item, held, keyed=True)
    assert gap is not None and gap.codes == ("A1",)
    assert (gap.asks_code, gap.asks_fact, gap.matter) == ("A1", "RECORD", "Removal record")
    # Worded as what is assumed, with the answer as its basis (q_ui4, 19 November 2026;
    # before: "the specialist reads it as not establishing ...", a finding, not an assumption).
    # A plain statement of what is assumed, with the answer as its basis (r5, 19 November
    # 2026: "not yet established" dropped; "The agent assumed:" says it is unconfirmed).
    assert gap.assumed == (
        f'The change ticket records it, as the walkthrough answer "No" ({REMOVAL}) indicates.'
    )
    assert review.walkthrough_gap(item, held, keyed=False).asks_fact is None
    # Two bank questions hold the attribute's RECORD: both answers are shown.
    both = replace(held, said=(("Is each account disabled or deleted?", "Disabled"), *held.said))
    shown = review.walkthrough_gap(item, both, keyed=True)
    assert shown is not None and shown.assumed == (
        'The change ticket records it, as the walkthrough answers "Disabled" (Is each account '
        f'disabled or deleted?) and "No" ({REMOVAL}) indicate.'
    )


# F3: the engagement's own criteria


def test_tailored_criteria_are_decided_by_the_criteria_not_by_a_missing_key() -> None:
    standard = ("Each change is approved.", "Approved before release.", "Not approved.")
    assert not review.tailored_criteria(("", "", ""), standard)
    assert not review.tailored_criteria(standard, standard)
    assert not review.tailored_criteria(
        (" each  change is APPROVED. ", "Approved before release.", "Not approved."), standard
    )
    assert review.tailored_criteria(("Within 5 days.", *standard[1:]), standard)
    assert review.tailored_criteria(standard, None)


def test_a_tailored_attribute_needs_what_its_own_criteria_name() -> None:
    from ai_workforce_api.walkthrough_questions import criteria_needs, met_elsewhere

    key = next(
        k for k in ("ac03-reviewer", "ac04-approved", "cm06-independent")
        if criteria_needs(k) and "TIMING" not in criteria_needs(k)
    )  # fmt: skip
    wording = "The reviewer approves each listing within 5 days of quarter end."
    bank = review.needs_for(key, wording)
    own = review.needs_for(key, wording, tailored=True)
    assert "TIMING" not in bank and "TIMING" in own
    assert own == tuple(f for f in review.needs_of(wording) if not met_elsewhere(key, f))


# The broad except that hid every failure as "waiting"


def test_waiting_fails_closed_only_on_a_control_not_in_the_project(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from ai_workforce_api import pbc_drafting, phase_release
    from ai_workforce_api.authorization import NotVisible

    monkeypatch.setattr(phase_release, "answers_waiting", lambda *_a: False)

    def not_visible(*_a: Any) -> Any:
        raise NotVisible()

    def broken(*_a: Any) -> Any:
        raise RuntimeError("the database is gone")

    project, control = UUID(int=1), UUID(int=2)
    monkeypatch.setattr(pbc_drafting, "load_context", not_visible)
    with caplog.at_level("WARNING", logger=review.logger.name):
        assert review.understanding_waiting(None, project, control) is True  # type: ignore[arg-type]
    assert "is not in project" in caplog.text
    monkeypatch.setattr(pbc_drafting, "load_context", broken)
    with pytest.raises(RuntimeError, match="the database is gone"):
        review.understanding_waiting(None, project, control)  # type: ignore[arg-type]


# Owner decision, 18 November 2026: completion waits for a person while the read left
# attributes not reviewed


def test_a_read_that_left_attributes_not_reviewed_holds_completion_for_a_person() -> None:
    from ai_workforce_api.understanding_review import Standing, held, may_complete, pass_state

    first = Standing(latest="READY", latest_round=1, reads=1, not_reviewed=2)
    assert held(first) and pass_state(first) == "HELD"
    assert not may_complete(first, reviewing=True)
    # Old: a read that asked nothing completed whatever it had left not reviewed.
    assert may_complete(replace(first, not_reviewed=0), reviewing=True)
    # The second read leaves one not reviewed: held still, and no read is left to run.
    second = Standing(latest="READY", latest_round=2, reads=2, latest_asked=1, not_reviewed=1)
    assert held(second) and not may_complete(second, reviewing=True)
    # Its questions waiting, or the follow-up read due: not held yet, as before.
    assert not held(replace(first, latest_asked=1, latest_open=1))
    assert not held(replace(first, latest_asked=1))
    assert pass_state(replace(first, latest_asked=1)) == "CHECKING"
    # Accepted or completed: never held.
    assert not held(replace(first, accepted=True)) and not held(replace(first, completed=True))
    # Without a model the rules complete it, as before.
    assert may_complete(first, reviewing=False)


def test_a_follow_up_of_any_answer_holding_the_fact_is_not_asked_again() -> None:
    # Open item 3 of the earlier report: two bank questions hold A1's RECORD; the holder was
    # chosen by the first (wt-ac02-disable-delete), so a follow-up the specialist wrote of
    # the other's answer (wt-ac02-removal-record, "No") was asked as if nothing held it.
    holder = review.Holder(
        "BANK", "wt-ac02-disable-delete", ref="W2", keys=(
            "wt-ac02-disable-delete", "wt-ac02-removal-record"),
    )  # fmt: skip
    written = review.Asked(
        code="A1", fact="RECORD", topic="Removal log", text="Which log shows each removal?",
        blocks="b", suggested="", options=(), parent_key="wt-ac02-removal-record",
        follow_up=True,
    )  # fmt: skip
    planned = plan([written], {key_of("A1", "RECORD", None, ""): holder}, 1)
    assert planned.ask == () and planned.answered == ((written, holder),)
    # Old (the chosen answer only): asked.
    only = replace(holder, keys=("wt-ac02-disable-delete",))
    assert plan([written], {key_of("A1", "RECORD", None, ""): only}, 1).ask == (written,)


# Round 3 (18 November 2026, after the independent review: FIX FIRST)


def test_a_narrative_quote_matches_only_the_narratives_own_words() -> None:
    # B1: the steps given to the specialist carry the code's own annotations (the number,
    # who and where, "[the control operates here]"); a quote of those established APPROVER
    # on a narrative that names no approver.
    found = {
        "sections": [{"heading": "Overview", "text": "Invoices are received by the AP clerk."}],
        "steps": [{"description": "The clerk enters the invoice", "actor": "AP clerk",
                   "system": "SAP", "control_point": True}],
    }  # fmt: skip
    text = review.narrative_text(found)
    assert text == "Invoices are received by the AP clerk.\nThe clerk enters the invoice"
    approver = Unit("A1", "A1", "The approver approves each invoice", needs=("APPROVER",))
    for quote in ("the control operates here", "1. The clerk enters the invoice (AP clerk"):
        answer = _answer([_established("A1", cites=[_cite("P1", "APPROVER", quote)])])
        kept = check(answer, [approver], {}, 1, False, {"P1": text})
        assert kept.not_reviewed == ("A1",), quote
    # The narrative's own words are found.
    own = _answer(
        [_established("A1", cites=[_cite("P1", "APPROVER", "Invoices are received by the AP")])]
    )
    assert check(own, [approver], {}, 1, True, {"P1": text}).verdicts


def test_every_role_slot_of_the_library_is_recorded_deliberately() -> None:
    # B2: a role slot's facts come from the bank's explicit record, one entry per role slot of
    # the library; a slot not listed (a new one) fails here until it is decided.
    from ai_workforce_api.statement_registry import STATEMENTS
    from ai_workforce_api.walkthrough_questions import ROLE_SLOT_FACTS

    roles: dict[str, set[str]] = {}
    for statement in STATEMENTS.values():
        for slot in statement.slots:
            if slot.kind == "ROLE":
                roles.setdefault(slot.key, set()).add(slot.why)
    assert sorted(roles) == sorted(ROLE_SLOT_FACTS), "a role slot is not recorded, or one gone"
    for key, whys in roles.items():
        facts = ROLE_SLOT_FACTS[key]
        assert set(facts) <= {"PERFORMER", "APPROVER", "EXCEPTION"}, key
        if any(why.startswith("Accountable for the control") for why in whys):
            assert facts == (), f"{key}: a control owner records nothing"
        assert review.slot_facts(key, "ROLE") == facts


def test_only_a_question_a_person_answered_establishes_its_fact() -> None:
    # N2: a dismissal, the closing at acceptance or the system's own settling is no answer.
    from ai_workforce_api.control_context import QUESTIONS_CLOSED_NOTE

    assert review.answered_covers("RESOLVED", "RECORD", True, "The ticket.") == ("RECORD",)
    assert review.answered_covers("DISMISSED", "RECORD", True, "n/a") == ()
    assert review.answered_covers("RESOLVED", "RECORD", False, "The ticket.") == ()
    assert review.answered_covers("RESOLVED", "RECORD", True, QUESTIONS_CLOSED_NOTE) == ()
    assert review.answered_covers("RESOLVED", None, True, "The ticket.") == ()


def test_a_not_applicable_walkthrough_answer_establishes_no_need() -> None:
    # N1 (part): a walkthrough answer given as not applicable is no support.
    na = Parent("W9", question_key="wt-change-record", fact="RECORD", not_applicable=True)
    assert review.support_of("W9", {"W9": na}) is None
    with pytest.raises(ValueError, match="establishes RECORD:"):
        check(_answer([_established("A1", "W1", "W9")]), [NEEDS], {**PARENTS, "W9": na}, 1, True)


def test_a_follow_up_of_a_yes_or_no_answer_is_never_asked() -> None:
    # N5 (owner: a Yes/No answer opens no follow-up): kept visible by its matter, or, where
    # the specialist itself rests the attribute on that answer, nothing to keep.
    yes_no = Parent("W4", question_key="wt-change-tested", fact="OTHER", yes_no=True)
    parents = {**PARENTS, "W4": yes_no}
    follow = [{**_question("Test evidence", "RECORD"), "parent": "W4", "attribute": "A1"}]
    checked = check(_answer([_established("A1", "W1", "W2")], follow), [NEEDS], parents, 1, True)
    [kept] = checked.asked
    assert (kept.follow_up, kept.assume_only, kept.by_matter) == (False, True, True)
    assert plan(checked.asked, set(), 1).ask == ()
    cited = check(_answer([_established("A1", "W1", "W2", "W4")], follow), [NEEDS], parents, 1,
                  True)  # fmt: skip
    assert cited.asked == ()
    assert any("follows a Yes/No answer" in note for note in cited.dropped)


def test_a_kind_of_fact_over_the_statement_needs_that_fact_cited() -> None:
    # N7: every unit is held to a need set; a kind of fact needs that very fact.
    [performer, *_rest] = review.units_of([])
    assert performer.support == ("PERFORMER",)
    with pytest.raises(ValueError, match="establishes PERFORMER:"):
        check(_answer([_established("PERFORMER", "W1")]), [performer], PARENTS, 1, True)
    assert check(_answer([_established("PERFORMER", "W3")]), [performer], PARENTS, 1, True).verdicts


def test_held_never_offers_a_proceed_while_something_is_still_to_answer() -> None:
    # N4: offer only what can succeed; the page shows the open questions instead.
    from ai_workforce_api.understanding_review import Standing, held, pass_state, reason_needed

    open_too = Standing(latest="READY", latest_round=1, reads=1, not_reviewed=1, still_asked=True)
    assert not held(open_too) and pass_state(open_too) != "HELD"
    # N3: once any read left units not reviewed, a proceed takes a reason, held or failed.
    assert reason_needed(Standing(latest="FAILED", reads=1, left_not_reviewed=True))
    assert not reason_needed(Standing(latest="FAILED", reads=0))


def test_an_assumption_that_cannot_be_recorded_says_why_never_its_words() -> None:
    # N6: no silent None draft.
    from ai_workforce_api.attribute_assumptions import Refused, drafted_or_refused

    assert drafted_or_refused("MISSING", "Who approves", "") == Refused("EMPTY", "Who approves")
    secret = drafted_or_refused("MISSING", "Who approves", "The password=hunter2secret is used")
    assert secret == Refused("CREDENTIAL", "")


def test_the_support_kept_shows_only_what_backs_a_need_the_unit_has() -> None:
    # q_ui4 (19 November 2026, state E1y): an attribute whose needs were all met elsewhere was
    # listed under "What the review rests on" whenever the specialist cited anything for it,
    # and a ref cited beside its needs was shown as support.
    met = Unit("A3", "A3", "Everything is met by a value.", needs=())
    answer = _answer([
        _established("A1", "W1", "W2", "W3"),
        _established("A3", "W1"),
    ])  # fmt: skip
    checked = check(answer, [NEEDS, met], PARENTS, 1, True, TEXTS)
    shown = {
        "W1": ("WALKTHROUGH", "Who approves?", "The CAB chair", None),
        "W2": ("WALKTHROUGH", "Which record?", "The ticket", None),
        "W3": ("WALKTHROUGH", "Who performs?", "The administrator", None),
    }
    kept = review.with_support(checked, PARENTS, shown, [NEEDS, met])
    by_unit = {v["attribute"]: v["support"] for v in kept.verdicts}
    # A1 needs who approves and the record: W3 (who performs) backs neither, so it is not shown.
    assert [(item["ref"], item["needs"]) for item in by_unit["A1"]] == [
        ("W1", ["APPROVER"]), ("W2", ["RECORD"]),
    ]  # fmt: skip
    # A3's needs are all met elsewhere: nothing is shown as what it rests on.
    assert by_unit["A3"] == []
    assert review.required_needs(met) == ()


def test_the_reviews_own_terms_in_a_narrative_are_left_out_and_counted() -> None:
    # q_ui4 (19 November 2026, H1P/H2): a narrative that told the review's own state ("the read
    # cited an answer reference ...", "the understanding waits for a person to run the review
    # again ...") stood beside the page's own line saying it. Ordinary words stay.
    narrative = (
        "The answers establish how the review is prepared. The reviewer records a reference to "
        "the ticket. They do not establish, on any answer the inputs give, who reviews the "
        "owner's own access: the read cited an answer reference that is not among the "
        "walkthrough answers, the statement values or the questions already answered, so the "
        "attribute is not reviewed and the understanding waits for a person to run the review "
        "again or to proceed with a recorded reason."
    )
    kept, dropped = review.narrative_kept(narrative)
    assert kept == (
        "The answers establish how the review is prepared. The reviewer records a reference to "
        "the ticket."
    )
    assert dropped == ("TERMS",)


def test_an_assumed_answer_to_who_names_someone() -> None:
    # q_ui4 (S4): "Investigation owner" was assumed as "A ticket records it.", which names no
    # one. An answer to a question of a person must name a role, else the assumption says the
    # matter is not established.
    who = review.Asked(
        code="A1", fact="OTHER", topic="Investigation owner",
        text="Who leads each investigation of inappropriate access?", blocks="b",
        suggested="A ticket records it.", options=(),
    )  # fmt: skip
    assert review.assumed_answer(who) == ""
    # Nothing to assume: a statement that the answer is not yet known, never the question.
    draft = review._assumption_of(who)
    assert draft.assumed == "Who leads each investigation of inappropriate access is not yet known."
    named = replace(who, suggested="The security analyst leads each investigation.")
    assert review._assumption_of(named).assumed == "The security analyst leads each investigation."
    # A record question keeps its answer.
    record = replace(who, fact="RECORD", text="Which record shows it?")
    assert review.assumed_answer(record) == "A ticket records it."


def test_no_assumption_is_a_question_or_says_it_is_not_yet_established() -> None:
    # Guard (r5, 19 November 2026): what the page shows after "The agent assumed:" is a
    # statement ending in a full stop, never a question and never "not yet established".
    from ai_workforce_api.attribute_assumptions import drafted, sentence_of

    who = review.Asked(
        code="A1", fact="APPROVER", topic="Owner's own access",
        text="Who reviews the owner's own access?", blocks="b",
        suggested="A ticket records it.", options=(),
    )  # fmt: skip
    holder = review.Holder("BANK", "wt-x", ref="W1", said=(("How is it reviewed?", "Other"),))
    made = [
        review._assumption_of(who),
        review._assumption_of(replace(who, suggested="")),
        review._assumption_of(replace(who, suggested="The CFO reviews it.")),
        review.walkthrough_gap(who, holder, True),
        review.walkthrough_gap(who, holder, True, "The reviewer is independent of the access."),
        review.walkthrough_gap(replace(who, suggested="The IT manager reviews it."), holder, True),
        drafted("MISSING", "Approver", "Who approves each change?"),
    ]
    for draft in made:
        assert draft is not None
        text = draft.assumed
        assert text.endswith("."), text
        assert not text.rstrip().endswith("?"), text
        assert "not yet established" not in text, text
        assert not text.startswith("Not established by the questions asked"), text
    assert sentence_of("Who approves each change?") == "Who approves each change is not yet known."


def test_a_fact_not_yet_known_is_its_own_kind_never_an_assumption() -> None:
    # Design review, 19 November 2026: "The agent assumed: Who leads ... is not yet known."
    # with "That's right". What records a fact as not yet known reads UNKNOWN, which the page
    # leads "Not yet known:" and answers, never confirms.
    from ai_workforce_api.attribute_assumptions import sentence_of, shown_kind

    said = sentence_of("Who leads each investigation?")
    assert shown_kind("MISSING", said) == "UNKNOWN"
    assert shown_kind("AMBIGUOUS", said) == "UNKNOWN"
    assert shown_kind("MISSING", "The IT manager leads each investigation.") == "ASSUMPTION"
    assert shown_kind("CONFLICT", said) == "CONFLICT"
    assert shown_kind("NOT_KNOWN", said) == "NOT_KNOWN"


def test_a_shown_narrative_names_attributes_by_the_pages_letters() -> None:
    # Design review, 19 November 2026: the paragraph said "attribute A2 / A6 / A1" while the
    # page letters the attributes A, B, C. The shown narrative carries no code.
    letters = {"A1": "A", "A2": "B", "A6": "C"}
    said = review.with_letters(
        "The approver of attribute A2 is known; attributes A6 and A1 rest on the log, and A9 "
        "on the ticket.",
        letters,
    )
    assert said == (
        "The approver of attribute B is known; attributes C and A rest on the log, and an "
        "attribute on the ticket."
    )
    assert re.search(r"\bA[0-9]{1,3}\b", said) is None
    assert [review.letter_of(i) for i in (0, 25, 26, 27)] == ["A", "Z", "AA", "AB"]


def test_a_failed_read_shows_its_kinds_sentence_never_stale_stored_words() -> None:
    # Final design review, 19 November 2026 (N3): F1's read, ended before the wording
    # changed, still said "the specialist's answer could not be used after one correction".
    old = (
        "The review could not run: the specialist's answer could not be used after one correction."
    )
    assert review.shown_failure(old) == review.FAILED_SENTENCE
    assert review.FAILED_SENTENCE.endswith(
        "the IT audit specialist's review could not be completed."
    )
    for sentence in (
        review.STOPPED_SENTENCE,
        review.NO_MODEL_SENTENCE,
        review.NOT_STARTED_SENTENCE,
        review.FAILED_SENTENCE,
    ):
        assert review.shown_failure(sentence) == sentence
    assert review.shown_failure("") == review.FAILED_SENTENCE
