"""Common answers for the client values (slot_options.py): offered for every role, tool,
period, and deadline the library asks for, never for an amount or tolerance only the
client's materiality sets, and led by the engagement's own systems where one fits."""

from ai_workforce_api.control_statements import Slot
from ai_workforce_api.slot_options import (
    _EXPLICIT,
    MAX_OPTIONS,
    area_of,
    options_for,
)
from ai_workforce_api.statement_registry import STATEMENTS


def _slots() -> dict[str, Slot]:
    found: dict[str, Slot] = {}
    for statement in STATEMENTS.values():
        for slot in statement.slots:
            found.setdefault(slot.key, slot)
    return found


def test_every_role_tool_and_deadline_offers_common_answers() -> None:
    slots = _slots()
    own_systems = {"system", "erp", "source-system"}
    for key, slot in slots.items():
        options = options_for(slot)
        assert len(options) <= MAX_OPTIONS, key
        assert len({item.lower() for item in options}) == len(options), key
        if slot.kind in ("ROLE", "DAYS", "PERIOD") or (
            slot.kind == "SYSTEM" and key not in own_systems
        ):
            assert len(options) >= 2, (key, options)
        if slot.kind in ("AMOUNT", "PERCENT"):
            # A threshold depends on the client's materiality: nothing stands in for it.
            assert options == [], key
        if slot.kind == "TEXT" and slot.example:
            # Free text's example describes one client: a hint, never a choice, unless it
            # is one of the answers curated for the value.
            assert slot.example not in options or slot.example in _EXPLICIT.get(key, ()), key
        if key in own_systems:
            # The system a control runs in is only ever one of the engagement's own.
            assert options_for(slot, ("Workday HCM",)) == ["Workday HCM"], key
        if slot.kind == "ROLE":
            assert options[0] == slot.example or slot.example == "", key
    # Every role belongs to an area, so none falls back to nothing.
    assert all(
        area_of(key) is not None or options_for(slot)
        for key, slot in slots.items()
        if slot.kind == "ROLE"
    )


def test_the_answers_fit_the_value_and_the_engagements_systems() -> None:
    slots = _slots()
    # Who administers access: the usual teams, not finance roles.
    admin = options_for(slots["admin-role"])
    assert "IT service desk" in admin and "Controller" not in admin
    # A reviewer is offered reviewers, a preparer staff.
    assert "Controller" in options_for(slots["recon-reviewer"])
    assert "General ledger accountant" in options_for(slots["recon-preparer"])
    # The in-scope system is offered for the system a control runs in.
    systems = ("Oracle E-Business Suite", "ServiceNow ITSM", "Workday HCM")
    assert options_for(slots["erp"], systems)[:3] == list(systems)
    # A tool the client runs comes first; a system that is not one is not offered.
    assert options_for(slots["change-tool"], systems)[0] == "ServiceNow ITSM"
    hr = options_for(slots["hr-system"], systems)
    assert hr[0] == "Workday HCM" and "Oracle E-Business Suite" not in hr


def test_every_value_is_asked_as_a_question() -> None:
    from ai_workforce_api.slot_questions import question_for

    slots = _slots()
    asked = {key: question_for(slot) for key, slot in slots.items()}
    for key, question in asked.items():
        assert question.endswith("?") and question[0].isupper(), (key, question)
        # Written for the value: not its label turned into a question.
        label = slots[key].label
        assert question not in (f"Who is {label}?", f"What is {label.removeprefix('the ')}?")
    assert asked["access-policy"] == "Which policy sets who may approve access, and to what?"
    assert asked["bank-preparer"] == "Who prepares the bank reconciliations?"
    assert len(set(asked.values())) == len(asked), "two values ask the same question"


def test_every_value_says_how_to_answer_it() -> None:
    from ai_workforce_api.slot_questions import hint_for

    slots = _slots()
    for key, slot in slots.items():
        assert hint_for(slot).endswith("."), key
    # A role is answered with a role, not a person; a policy with the document's name.
    assert "not a person's name" in hint_for(slots["review-owner"])
    assert "document's title" in hint_for(slots["access-policy"])
