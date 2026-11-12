"""Every question an access or change control asks offers its usual answers (product owner,
11 November 2026: "an option is always provided so the user won't have to type as much as
possible"), each a value the control accepts when it is saved, and typing the client's own
answer stays open. Pure: no database."""

import re

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.control_design import AUTOMATIC, PROFILE_TARGET
from ai_workforce_api.control_statements import Slot, render
from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.sample_traces import limit_of
from ai_workforce_api.slot_options import MAX_OPTIONS, MULTIPLE_SLOTS, options_for
from ai_workforce_api.slot_questions import asks_for_document
from ai_workforce_api.statement_registry import STATEMENTS

# The values an access or change control asks for that offer fewer than two answers, and why.
EXCEPTIONS: dict[str, str] = {
    # Filled from the control's own system (control_design.AUTOMATIC), never asked: its only
    # answers are the engagement's own systems.
    "system": "the control's own system, filled automatically",
    # Composed setting by setting from how users sign in (authentication_profile): saving it
    # by hand is refused (control_design.set_values), so no answer could be chosen.
    "auth-settings": "composed from the sign-in settings, never typed or chosen",
    # A governing document, answered by linking the ruleset itself (asked as a DOCUMENT
    # need, which offers no quick answers): the name in the wording must be the file's, and
    # a ruleset has no usual name a guess could stand for.
    "sod-ruleset": "the client's ruleset document, answered by linking it",
}

# A limit in days, as the policies state it and the sample trace reads it.
_DAYS = re.compile(r"\d{1,3} (?:business |calendar )?days?")


def _access_and_change() -> dict[str, Slot]:
    found: dict[str, Slot] = {}
    for control in LIBRARY:
        if control.domain not in ("ACCESS", "CHANGE"):
            continue
        statement = STATEMENTS[control.key]
        for slot in statement.slots:
            found.setdefault(slot.key, slot)
    return found


def _every_slot() -> dict[str, Slot]:
    found: dict[str, Slot] = {}
    for statement in STATEMENTS.values():
        for slot in statement.slots:
            found.setdefault(slot.key, slot)
    return found


def _accepted(slot: Slot, option: str) -> bool:
    """Whether the option is saved as written: the checks control_design.set_values applies
    to a value (one clean line of at most 300 characters, never a credential), and a limit
    in days names its days."""
    if option == "" or clean_line(option, 300).strip() != option:
        return False
    if contains_secret({slot.key: option}):
        return False
    return slot.kind != "DAYS" or _DAYS.search(option) is not None


def _one_limit(option: str) -> bool:
    """A single limit in days, as an access or change control tests it: in business days,
    the same number the sample trace reads from the wording."""
    if _DAYS.fullmatch(option) is None:
        return False
    if "business" in option:
        days, _words = limit_of([option])
        return days == int(option.split()[0])
    return True


def test_every_access_and_change_value_offers_its_usual_answers() -> None:
    slots = _access_and_change()
    assert len(slots) > 30
    short = {key for key, slot in slots.items() if len(options_for(slot)) < 2}
    # Exactly the listed exceptions: a value that gains answers, or a new one without
    # them, is caught here.
    assert short == set(EXCEPTIONS), sorted(short ^ set(EXCEPTIONS))
    for key, slot in slots.items():
        options = options_for(slot)
        assert len(options) <= MAX_OPTIONS, key
        assert len({item.casefold() for item in options}) == len(options), (key, options)
        if key not in EXCEPTIONS and slot.example and slot.kind != "TEXT":
            # The library's own example leads: it is the most usual answer.
            assert options[0] == slot.example, (key, options)


def test_the_exceptions_hold_for_their_reasons() -> None:
    slots = _access_and_change()
    assert "system" in AUTOMATIC
    assert options_for(slots["system"], ("SAP S/4HANA",)) == ["SAP S/4HANA"]
    assert PROFILE_TARGET == "auth-settings" and options_for(slots["auth-settings"]) == []
    assert asks_for_document(slots["sod-ruleset"]) and options_for(slots["sod-ruleset"]) == []


def test_every_option_is_a_value_the_control_accepts() -> None:
    slots = _every_slot()
    statements = {
        slot.key: statement.text
        for statement in STATEMENTS.values()
        for slot in statement.slots
        if f"{{{slot.key}}}" in statement.text
    }
    for key, slot in slots.items():
        for option in options_for(slot):
            assert _accepted(slot, option), (key, option)
            assert len(option) <= 120, (key, option)
    # Free text in an access or change control is read mid-sentence: its answers read as
    # the sentence does, and fill the wording without a bracket left.
    for key, slot in _access_and_change().items():
        if slot.kind == "DAYS":
            assert all(_one_limit(option) for option in options_for(slot)), key
        if slot.kind != "TEXT" or asks_for_document(slot) or key in EXCEPTIONS:
            continue
        for option in options_for(slot):
            assert option[0].islower(), (key, option)
            if key in statements:
                filled = render(statements[key], {key: option}, {})
                assert option in filled and f"[{key}]" not in filled, key


def test_the_days_and_tools_people_asked_for_are_offered() -> None:
    slots = _access_and_change()
    tool = options_for(slots["access-tool"])
    for name in ("ServiceNow", "Jira Service Management", "SailPoint", "BMC Remedy / Helix"):
        assert name in tool, name
    assert "the application's own workflow" in tool
    hr = options_for(slots["hr-system"])
    assert hr[:4] == ["Workday", "SAP SuccessFactors", "Oracle HCM Cloud", "ADP"]
    assert {"1 business day", "3 business days", "5 business days"} <= set(
        options_for(slots["removal-days"])
    )
    admin = options_for(slots["admin-role"])
    assert {"IT Security Administrator", "System administrator"} <= set(admin)
    assert "Application owner" in options_for(slots["review-owner"])
    # An owner is accountable for the control: never the team or developer it covers.
    assert "Application developer" not in options_for(slots["change-owner"])
    assert "IT service desk" not in options_for(slots["access-owner"])
    # One Change Advisory Board, not two ways of writing it.
    approver = options_for(slots["it-approver"])
    assert sum("advisory board" in item.casefold() for item in approver) == 1


def test_a_tool_the_client_runs_is_found_by_any_of_its_names() -> None:
    slots = _every_slot()
    # "BMC Remedy / Helix" is either product; a bracketed qualifier is not part of a name.
    assert options_for(slots["change-tool"], ("BMC Helix ITSM",))[0] == "BMC Helix ITSM"
    assert options_for(slots["change-tool"], ("SAP Solution Manager 7.2",))[0] == (
        "SAP Solution Manager 7.2"
    )
    # An unspaced slash is part of the name: "SAP PI/PO" does not match any system with "po".
    assert "Epic PowerPlant" not in options_for(slots["interface-tool"], ("Epic PowerPlant",))
    # An answer that is not a product names no system.
    assert "Oracle E-Business Suite" not in options_for(
        slots["access-tool"], ("Oracle E-Business Suite",)
    )


def test_typing_the_clients_own_answer_stays_open() -> None:
    from ai_workforce_api.understanding_chat import _Asked, _by_rules, _checked

    slot = _access_and_change()["access-tool"]
    asked = _Asked(
        question="Where are access requests raised and approved?",
        options=options_for(slot), why="", hint="", required=True,
    )  # fmt: skip
    # An offered answer, however it is typed, is that answer exactly.
    chosen = _checked(_by_rules(asked, "servicenow"), asked)
    assert (chosen.intent, chosen.value) == ("ANSWER", "ServiceNow")
    # The client's own answer, not among them, is taken as written.
    own = _checked(_by_rules(asked, "Ivanti Neurons for ITSM"), asked)
    assert (own.intent, own.value) == ("ANSWER", "Ivanti Neurons for ITSM")


# Every field of a statement that reads a value into the control's wording.
_READ_FIELDS = (
    "text", "operator", "reviewer", "owner", "authority", "precision", "investigation",
    "evidence", "applies_when",
)  # fmt: skip


def test_the_values_that_take_several_answers_are_roles_and_tools_of_access_and_change() -> None:
    """Product owner, 12 November 2026: a statement question "could also have multiple
    answers, like business and IT". Only an approver, a reviewer, an administering role or a
    tool takes several; an owner (one accountable role), a limit, a period, a document, the
    control's own system and the sign-in settings take one."""
    slots = _access_and_change()
    assert {"it-approver", "access-tool", "change-tool"} <= MULTIPLE_SLOTS
    for key in MULTIPLE_SLOTS:
        assert key in slots, key
        slot = slots[key]
        assert slot.kind in ("ROLE", "SYSTEM"), (key, slot.kind)
        assert not key.endswith("-owner") and not asks_for_document(slot), key
        assert key not in EXCEPTIONS and key not in AUTOMATIC and key != PROFILE_TARGET, key
    for key in ("access-owner", "change-owner", "ops-owner", "system", "removal-days"):
        assert key not in MULTIPLE_SLOTS, key


def test_a_value_with_several_answers_reads_in_every_sentence_it_fills() -> None:
    """A list fills the wording as written ("approved by the business owner and Change
    Manager and Application owner"), with no blank left, and is never the subject of a verb
    in the singular, which would read "A and B approves"."""
    joined: dict[str, str] = {}
    for key in MULTIPLE_SLOTS:
        first, second = options_for(_access_and_change()[key])[:2]
        joined[key] = f"{first} and {second}"
    read = 0
    for control_key, statement in STATEMENTS.items():
        labels = {slot.key: slot.label for slot in statement.slots}
        values = {slot.key: joined.get(slot.key, slot.example or "x") for slot in statement.slots}
        for name in _READ_FIELDS:
            text: str = getattr(statement, name)
            for key in MULTIPLE_SLOTS:
                if f"{{{key}}}" not in text:
                    continue
                filled = render(text, values, labels)
                assert joined[key] in filled, (control_key, name, key)
                # No blank left: every value is filled, none in brackets.
                assert not any(f"[{label}]" in filled for label in labels.values()), filled
                assert "{" not in filled, (control_key, name, filled)
                # The word after the value is not a verb in the singular ("reviews", "is").
                after = re.search(rf"\{{{key}\}}(?: for \{{[a-z-]+\}})? ([a-z]+)", text)
                verb = "" if after is None else after.group(1)
                assert not verb.endswith("s"), (control_key, name, key, verb)
                read += 1
    assert read >= len(MULTIPLE_SLOTS)
