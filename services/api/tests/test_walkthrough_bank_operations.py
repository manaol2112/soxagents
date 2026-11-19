"""The walkthrough banks of the IT operations family (product owner, 18 November 2026: draft
the dedicated walkthrough question banks for the IT operations library controls, for the
owner's professional review).

- Every operations library control (ITGC-OP-01 to -08, with OP-02.1, OP-03.1 and OP-03.2) gets
  its own questions from questions_for, beside the universal ones.
- Each question names only real attribute codes of its control's testing definition, and
  each attribute's criteria needs are met by a question that informs it with that kind of
  fact, or by a recorded reason (a statement value, or what each item's evidence shows).
- A Yes/No answer settles its fact (product owner, 18 November 2026): no Yes/No question
  opens a follow-up; where the answer must branch, a CHOICE or MULTI does.
- The wording follows the bank's rules: neutral, professional, no first or second person, no
  real company names, usual answers first and room for Other.
- The banks are a draft for professional review and carry `since`, so a control whose
  understanding was already finished is not held by them.

Pure unit tests: no database. They check the banks' shape and pin their content, so a change
to a bank is deliberate; whether the content is the right walkthrough for a client's control
is a matter for professional review.
"""

import re
from datetime import date

from ai_workforce_api.controls import LIBRARY_KEYS
from ai_workforce_api.definition_registry import definition_for
from ai_workforce_api.statement_registry import STATEMENTS
from ai_workforce_api.walkthrough_answers import holds
from ai_workforce_api.walkthrough_questions import (
    CONTROL_QUESTIONS,
    CRITERIA_NEEDS,
    FACTS,
    INFORMS,
    KEY,
    MET_ELSEWHERE,
    OPERATIONS_ADDED,
    STATUS,
    TEXT_KEPT,
    UNIVERSAL,
    Question,
    applicable,
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

# The draft banks, question by question in the asking order, with each one's kind of fact.
BANKS: dict[str, tuple[tuple[str, str], ...]] = {
    "operations-jobs": (
        ("wt-op01-relevant-jobs", "POPULATION"),
        ("wt-op01-failure-record", "RECORD"),
        ("wt-op01-off-hours", "TIMING"),
        ("wt-op01-rerun-check", "RECORD"),
        ("wt-op01-resolution", "EXCEPTION"),
        ("wt-op01-run-history", "POPULATION"),
    ),
    "operations-scheduling": (
        ("wt-op02-other-actions", "POPULATION"),
        ("wt-op02-approval-enforced", "TIMING"),
        ("wt-op02-change-log", "RECORD"),
        ("wt-op02-request-link", "RECORD"),
        ("wt-op02-urgent", "EXCEPTION"),
    ),
    "operations-scheduler-access": (
        ("wt-op021-change-rights", "POPULATION"),
        ("wt-op021-generic-accounts", "POPULATION"),
        ("wt-op021-removal-check", "RECORD"),
        ("wt-op021-own-access", "APPROVER"),
        ("wt-op021-decision-record", "RECORD"),
        ("wt-op021-listing-source", "POPULATION"),
    ),
    "operations-backup": (
        ("wt-op03-data-covered", "SYSTEM"),
        ("wt-op03-new-hosts", "SYSTEM"),
        ("wt-op03-change-approval", "APPROVER"),
        ("wt-op03-history-kept", "RECORD"),
        ("wt-op03-config-history", "RECORD"),
    ),
    "operations-backup-failures": (
        ("wt-op031-what-counts", "POPULATION"),
        ("wt-op031-off-hours", "TIMING"),
        ("wt-op031-review-record", "RECORD"),
        ("wt-op031-resolution", "EXCEPTION"),
        ("wt-op031-job-history", "POPULATION"),
    ),
    "operations-restore-test": (
        ("wt-op032-what-restored", "SYSTEM"),
        ("wt-op032-backup-identified", "RECORD"),
        ("wt-op032-comparison", "RECORD"),
        ("wt-op032-source-figures", "TIMING"),
        ("wt-op032-failed-test", "EXCEPTION"),
    ),
    "operations-incidents": (
        ("wt-op04-system-link", "POPULATION"),
        ("wt-op04-priority-set", "SYSTEM"),
        ("wt-op04-targets", "TIMING"),
        ("wt-op04-closure", "RECORD"),
        ("wt-op04-root-cause-record", "RECORD"),
    ),
    "operations-physical": (
        ("wt-op05-hosting", "SYSTEM"),
        ("wt-op05-access-list", "POPULATION"),
        ("wt-op05-grant-approval", "APPROVER"),
        ("wt-op05-removal-record", "RECORD"),
        ("wt-op05-soc-coverage", "RECORD"),
        ("wt-op05-holders", "POPULATION"),
        ("wt-op05-decision-record", "RECORD"),
    ),
    "operations-interfaces": (
        ("wt-op06-mismatch-check", "SYSTEM"),
        ("wt-op06-off-hours", "TIMING"),
        ("wt-op06-recheck", "RECORD"),
        ("wt-op06-review-record", "RECORD"),
        ("wt-op06-recovery", "EXCEPTION"),
        ("wt-op06-run-log", "POPULATION"),
    ),
    "operations-soc-reports": (
        ("wt-op07-carve-out", "POPULATION"),
        ("wt-op07-cuec-mapping", "RECORD"),
        ("wt-op07-cuec-assurance", "OTHER"),
        ("wt-op07-exception-assessment", "EXCEPTION"),
    ),
    "operations-vulnerabilities": (
        ("wt-op08-inventory", "POPULATION"),
        ("wt-op08-severity", "POPULATION"),
        ("wt-op08-closure", "RECORD"),
        ("wt-op08-first-seen", "TIMING"),
        ("wt-op08-signoff-record", "RECORD"),
        ("wt-op08-acceptance-record", "RECORD"),
    ),
}

# Product copy is neutral and professional: never "the client", never "open" for a question
# asked (test_walkthrough_banks), no first or second person, no casual phrasing.
_BANNED = re.compile(
    r"\b(the client|open|we|our|us|you|your|i|let's|just|basically|stuff|ok|okay)\b", re.I
)
# Real vendors and products a library question must not name: generic system and role names
# only.
_VENDORS = re.compile(
    r"\b(servicenow|jira|remedy|control-m|autosys|tidal|veeam|commvault|rubrik|netbackup|"
    r"qualys|tenable|nessus|rapid7|splunk|mulesoft|boomi|informatica|aws|amazon|azure|"
    r"microsoft|google|oracle|sap|ibm|equinix|okta|sailpoint|cyberark)\b",
    re.I,
)
# The workaround options a single answer needed (test_walkthrough_questions).
_WORKAROUND = ("both", "a mix", "either way", "a combination")


def _family() -> list[str]:
    return [key for key in LIBRARY_KEYS if key.startswith("operations-")]


def _bank(library_key: str) -> tuple[Question, ...]:
    return CONTROL_QUESTIONS[library_key]


def _every() -> list[Question]:
    return [item for key in _family() for item in _bank(key)]


def _attributes(library_key: str) -> set[str]:
    definition = definition_for(library_key)
    assert definition is not None, library_key
    return {attribute.key for attribute in definition.attributes}


def _keys(items: tuple[Question, ...] | list[Question]) -> list[str]:
    return [item.key for item in items]


def _for(library_key: str) -> tuple[Question, ...]:
    statement = STATEMENTS[library_key]
    return questions_for(library_key, statement.nature, statement.frequency)


# Every operations control has its bank.


def test_the_bank_has_no_structural_problems() -> None:
    assert problems() == []


def test_every_operations_control_gets_its_own_bank_from_questions_for() -> None:
    assert sorted(_family()) == sorted(BANKS)
    assert len(BANKS) == 11
    universal = set(_keys(UNIVERSAL))
    for library_key, expected in BANKS.items():
        bank = _bank(library_key)
        assert [(item.key, fact_of(item)) for item in bank] == list(expected), library_key
        asked = _keys(questions_for(library_key))
        # The bank is asked, beside every universal question, in the control's asking order.
        assert set(_keys(bank)) <= set(asked) and universal <= set(asked), library_key
        assert [key for key in asked if key in _keys(bank)] == _keys(bank), library_key
        # And as the statement runs the control (its nature and frequency).
        assert set(_keys(bank)) <= set(_keys(_for(library_key))), library_key


def test_each_control_asks_a_reasonable_number_of_questions() -> None:
    # Product owner, 11 November 2026: "Only ask the questions that are detailed but also
    # reasonable." Four to eight of the control's own, and at most nine asked by default
    # (follow-ups excluded, universal questions included), as for the access and change
    # controls outside the core set.
    for library_key in _family():
        assert 4 <= len(_bank(library_key)) <= 8, library_key
        default = [item for item in _for(library_key) if item.when is None]
        assert 6 <= len(default) <= 9, (library_key, len(default))


# What each question informs, and what each attribute needs.


def test_every_question_informs_real_attributes_of_its_control() -> None:
    for library_key in _family():
        attributes = _attributes(library_key)
        for item in _bank(library_key):
            named = [need for need in item.informs if need not in INFORMS]
            # Only asked because an attribute needs it, and only that control's attributes.
            assert named, item.key
            assert set(named) <= attributes, (item.key, set(named) - attributes)
            assert len(set(item.informs)) == len(item.informs), item.key


def test_every_attribute_names_its_needs_and_each_is_met_once() -> None:
    seen: set[str] = set()
    unmet: list[str] = []
    for library_key in _family():
        slots = {slot.key for slot in STATEMENTS[library_key].slots}
        asked = set(_keys(questions_for(library_key)))
        for key in sorted(_attributes(library_key)):
            seen.add(key)
            needs = criteria_needs(key)
            assert needs and set(needs) <= set(FACTS) and len(set(needs)) == len(needs), key
            assert "OTHER" not in needs, key
            facts = {fact_of(item) for item in informing(library_key, key)}
            for need in needs:
                reason = met_elsewhere(key, need)
                if need in facts:
                    # Never both a question and a reason.
                    assert reason == "", (key, need)
                    continue
                if not reason:
                    unmet.append(f"{library_key} {key} {need}")
                    continue
                assert reason.endswith(".") and len(reason) <= 260, (key, need)
                for slot in re.findall(r"\{([a-z][a-z0-9-]+)\}", reason):
                    assert slot in slots, (key, need, slot)
                for name in re.findall(r"\bwt-[a-z0-9-]+[a-z0-9]", reason):
                    assert name in asked, (key, need, name)
    assert unmet == []
    assert len(seen) == 37
    assert {key for key in CRITERIA_NEEDS if key.startswith("op")} == seen
    assert all(need in criteria_needs(key) for key, need in MET_ELSEWHERE if key.startswith("op"))


def test_the_needs_recorded_for_the_operations_attributes() -> None:
    # Pinned, so a change to what an attribute's criteria need is deliberate.
    assert {key: CRITERIA_NEEDS[key] for key in CRITERIA_NEEDS if key.startswith("op")} == {
        "op01-identified": ("POPULATION", "RECORD"),
        "op01-logged": ("RECORD", "TIMING"),
        "op01-resolved": ("RECORD", "EXCEPTION"),
        "op01-complete": ("RECORD",),
        "op02-request": ("RECORD",),
        "op02-approved": ("APPROVER", "TIMING"),
        "op02-matches": ("RECORD",),
        "op021-complete": ("POPULATION",),
        "op021-signoff": ("APPROVER", "RECORD"),
        "op021-access": ("APPROVER", "RECORD"),
        "op03-config": ("SYSTEM", "TIMING"),
        "op03-ran": ("RECORD",),
        "op03-unchanged": ("RECORD", "APPROVER"),
        "op031-identified": ("POPULATION", "RECORD", "TIMING"),
        "op031-resolved": ("RECORD", "TIMING", "EXCEPTION"),
        "op032-restore": ("SYSTEM", "RECORD"),
        "op032-compared": ("RECORD", "TIMING", "EXCEPTION"),
        "op032-signoff": ("APPROVER", "PERFORMER"),
        "op04-logged": ("RECORD", "POPULATION"),
        "op04-priority": ("SYSTEM", "RECORD"),
        "op04-resolved": ("RECORD", "TIMING"),
        "op04-root-cause": ("RECORD", "POPULATION"),
        "op05-authorized": ("APPROVER", "POPULATION"),
        "op05-review": ("POPULATION", "RECORD", "APPROVER"),
        "op05-removed": ("RECORD",),
        "op05-soc": ("SYSTEM", "RECORD"),
        "op06-identified": ("POPULATION", "RECORD", "TIMING"),
        "op06-resolved": ("RECORD", "EXCEPTION"),
        "op06-complete": ("RECORD",),
        "op07-coverage": ("POPULATION", "RECORD", "TIMING"),
        "op07-exceptions": ("EXCEPTION",),
        "op07-cuecs": ("RECORD",),
        "op07-signoff": ("APPROVER", "TIMING"),
        "op08-scope": ("POPULATION", "SYSTEM"),
        "op08-remediated": ("POPULATION", "TIMING", "RECORD"),
        "op08-accepted": ("APPROVER", "RECORD", "TIMING"),
        "op08-signoff": ("APPROVER", "RECORD"),
    }
    # The needs a statement value or the evidence meets, each with its reason.
    assert sorted(key for key in MET_ELSEWHERE if key[0].startswith("op")) == [
        ("op02-approved", "APPROVER"),
        ("op021-signoff", "APPROVER"),
        ("op03-config", "TIMING"),
        ("op031-resolved", "TIMING"),
        ("op032-signoff", "APPROVER"),
        ("op032-signoff", "PERFORMER"),
        ("op04-logged", "RECORD"),
        ("op04-priority", "RECORD"),
        ("op04-root-cause", "POPULATION"),
        ("op05-review", "APPROVER"),
        ("op07-coverage", "RECORD"),
        ("op07-coverage", "TIMING"),
        ("op07-signoff", "APPROVER"),
        ("op07-signoff", "TIMING"),
        ("op08-accepted", "APPROVER"),
        ("op08-accepted", "TIMING"),
        ("op08-scope", "SYSTEM"),
        ("op08-signoff", "APPROVER"),
    ]


def test_informing_gives_an_operations_attribute_its_questions_in_asking_order() -> None:
    found = informing("operations-jobs", "op01-logged")
    assert _keys(found) == ["wt-op01-failure-record", "wt-op01-off-hours"]
    assert [fact_of(item) for item in found] == ["RECORD", "TIMING"]
    # Follow-ups included, whether or not their parent's answer opens them.
    assert _keys(informing("operations-physical", "op05-soc")) == [
        "wt-op05-hosting",
        "wt-op05-soc-coverage",
    ]
    # An attribute whose every need a statement value meets has no question.
    assert informing("operations-restore-test", "op032-signoff") == ()
    assert informing("operations-jobs", "op02-request") == ()


# Yes/No answers settle their fact.


def test_no_yes_no_question_opens_a_follow_up() -> None:
    every = _every()
    parents = {item.when[0] for item in every if item.when is not None}
    for item in every:
        if item.kind == "YES_NO":
            assert item.key not in parents, item.key
    for key in parents:
        parent = question(key)
        assert parent is not None and parent.kind in ("CHOICE", "MULTI"), key
    # A follow-up opens on one of its parent's own options, never on an Other answer.
    for item in every:
        if item.when is None:
            continue
        parent = question(item.when[0])
        assert parent is not None and item.when[1] in parent.options, item.key


def test_the_physical_access_follow_ups_open_on_who_controls_the_access() -> None:
    asked = questions_for("operations-physical", "MANUAL", "ANNUAL")
    hosting = question("wt-op05-hosting")
    assert hosting is not None and hosting.kind == "MULTI"
    own, provider = hosting.options
    company = {"wt-op05-access-list", "wt-op05-grant-approval", "wt-op05-removal-record"}
    keys = set(_keys(applicable(asked, {"wt-op05-hosting": own})))
    assert company <= keys and "wt-op05-soc-coverage" not in keys
    keys = set(_keys(applicable(asked, {"wt-op05-hosting": provider})))
    assert "wt-op05-soc-coverage" in keys and not company & keys
    # A system hosted both ways is asked both sets.
    keys = set(_keys(applicable(asked, {"wt-op05-hosting": f"{own}; {provider}"})))
    assert company | {"wt-op05-soc-coverage"} <= keys
    # Each follow-up comes directly after its parent.
    order = _keys(asked)
    start = order.index("wt-op05-hosting")
    assert order[start : start + 5] == [
        "wt-op05-hosting",
        "wt-op05-access-list",
        "wt-op05-grant-approval",
        "wt-op05-removal-record",
        "wt-op05-soc-coverage",
    ]


# Keys, kinds and options.


def test_keys_are_unique_and_follow_the_bank_pattern() -> None:
    keys = _keys(_every())
    assert len(keys) == len(set(keys)) == 60
    pattern = re.compile(r"^wt-op0[1-8]1?[12]?-[a-z0-9-]+$")
    for item in _every():
        assert KEY.match(item.key) and pattern.match(item.key), item.key
        assert question(item.key) is item, item.key
    # No free text: every answer can be picked from a list or is a Yes or No.
    assert not {item.key for item in _every()} & TEXT_KEPT
    assert {item.kind for item in _every()} <= {"CHOICE", "MULTI", "YES_NO"}


def test_every_list_offers_the_usual_answers_and_room_for_another() -> None:
    for item in _every():
        if item.kind == "YES_NO":
            assert item.options == () and not item.allows_other, item.key
            continue
        # Suggest, don't ask: the usual answers to pick, and Other for one they do not offer.
        assert 2 <= len(item.options) <= 8 and item.allows_other, item.key
        assert valid_answer(item, item.options[0]), item.key
        assert valid_answer(item, "Other: Reviewed by the shift supervisor"), item.key
        for option in item.options:
            words = option.casefold()
            assert not words.startswith(_WORKAROUND), (item.key, option)
            assert "depending on" not in words and "different ways" not in words, item.key
            assert not words.startswith("other"), (item.key, option)


def test_the_questions_speak_plainly_neutrally_and_name_no_vendor() -> None:
    for item in _every():
        words = " ".join(
            (item.text, item.why, item.narrative, item.narrative_yes, item.narrative_no,
             *item.options)
        )  # fmt: skip
        assert not _BANNED.search(words), (item.key, _BANNED.search(words))
        assert not _VENDORS.search(words), (item.key, _VENDORS.search(words))
        # One question: one question mark, and one sentence of why.
        assert item.text.count("?") == 1 and item.text.endswith("?"), item.key
        assert item.why.endswith(".") and ". " not in item.why, item.key


def test_every_answer_reads_in_the_understanding() -> None:
    for library_key in _family():
        asked = questions_for(library_key)
        for item in _bank(library_key):
            opened = {item.when[0]: item.when[1]} if item.when is not None else {}
            for value in item.options or ("Yes", "No"):
                told = narrate(asked, {**opened, item.key: value})
                parts = [part for _, topic in told for part in topic]
                mine = [text for text, key in parts if key == item.key]
                assert mine, (item.key, value)
                sentence = "".join(text for text, _ in parts)
                assert sentence.endswith("."), (item.key, value)


# A draft that does not disturb finished work.


def test_the_banks_are_a_draft_added_on_18_november_that_hold_only_work_in_progress() -> None:
    assert STATUS == "Draft for professional review"
    assert OPERATIONS_ADDED == date(2026, 11, 18)
    for item in _every():
        assert item.since == OPERATIONS_ADDED and item.required, item.key
        # In progress: required. Completed, or attributes accepted: never held.
        assert holds(item, None, False), item.key
        assert not holds(item, date(2026, 11, 1), False), item.key
        assert not holds(item, None, True), item.key
