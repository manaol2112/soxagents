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
from ai_workforce_api.slot_options import MAX_OPTIONS, options_for
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
