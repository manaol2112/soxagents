"""The walkthrough question bank (product owner, 11 November 2026): its structure, which
questions a control gets, the order they are asked in, follow-ups, what each answer informs,
answer validation, and the understanding narrated from the answers.

Revised the same day after the product owner's review: only the questions testing the
attributes needs (per-control bounds), the topics in the order the control operates, and the
narrative.

Pure unit tests: no database. They check the bank's shape, not whether its content is the
right walkthrough for a client's control, which is a matter for professional review.
"""

from dataclasses import replace

import pytest

from ai_workforce_api import walkthrough_questions
from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.definition_registry import definition_for
from ai_workforce_api.statement_registry import STATEMENTS
from ai_workforce_api.walkthrough_questions import (
    CONTROL_QUESTIONS,
    FAMILY_QUESTIONS,
    INFORMS,
    JOIN,
    OTHER,
    STATUS,
    TEXT_KEPT,
    TOPIC_LABELS,
    TOPICS,
    UNIVERSAL,
    YES_NO,
    Question,
    applicable,
    narrate,
    problems,
    question,
    questions_for,
    valid_answer,
)

CORE = (
    "access-provisioning",
    "access-termination",
    "access-review",
    "access-privileged",
    "access-shared-accounts",
    "change-approval",
    "change-emergency",
    "change-segregation",
)
OTHERS = (
    "access-authentication",
    "access-transfer",
    "access-firefighter",
    "access-third-party",
    "access-sod-rules",
    "access-direct-db-os",
    "access-security-monitoring",
    "change-configuration",
    "change-data",
    "change-patching",
    "change-sdlc",
    "change-data-migration",
)
IN_SCOPE = CORE + OTHERS


def _keys(items: tuple[Question, ...] | list[Question]) -> list[str]:
    return [item.key for item in items]


def _for(library_key: str) -> tuple[Question, ...]:
    """The questions for a control as its statement runs it (nature and frequency)."""
    statement = STATEMENTS[library_key]
    return questions_for(library_key, statement.nature, statement.frequency)


def _default(library_key: str) -> list[Question]:
    """Asked by default: follow-ups excluded."""
    return [item for item in _for(library_key) if item.when is None]


def _text(parts: list[tuple[str, str | None]]) -> str:
    return "".join(text for text, _ in parts)


def _sample(item: Question) -> str:
    """A valid answer for any question."""
    if item.kind == "YES_NO":
        return "Yes"
    if item.kind == "TEXT":
        return "The control owner, as described in the procedure."
    if item.kind == "MULTI":
        return JOIN.join(item.options)
    return item.options[-1]


# The bank's structure.


def test_the_bank_has_no_structural_problems() -> None:
    assert problems() == []


def test_the_bank_is_labelled_a_draft_and_the_topics_follow_the_control() -> None:
    assert STATUS == "Draft for professional review"
    assert TOPICS == (
        "SCOPE",
        "INITIATION",
        "APPROVAL",
        "EXECUTION",
        "SEGREGATION",
        "RECORDS",
        "EXCEPTIONS",
        "POPULATION",
        "CHANGES",
        "SERVICE_ORG",
        "VOLUME",
    )
    assert TOPIC_LABELS == {
        "SCOPE": "What the control covers",
        "INITIATION": "How it starts",
        "APPROVAL": "Approval",
        "EXECUTION": "Performing the control",
        "SEGREGATION": "Segregation of duties",
        "RECORDS": "Records and system data",
        "EXCEPTIONS": "Exceptions",
        "POPULATION": "Population for testing",
        "CHANGES": "Changes in the period",
        "SERVICE_ORG": "Service organizations",
        "VOLUME": "Volume",
    }


def test_every_access_and_change_library_control_has_a_bank() -> None:
    family = [c.key for c in LIBRARY if c.key.startswith(("access-", "change-"))]
    assert sorted(family) == sorted(IN_SCOPE)
    universal = set(_keys(UNIVERSAL))
    for key in family:
        assert set(_keys(_for(key))) - universal, f"{key} has only the universal questions"


def test_each_control_asks_only_a_reasonable_number_of_questions() -> None:
    # Product owner, 11 November 2026: "Only ask the questions that are detailed but also
    # reasonable." Asked by default (follow-ups excluded), universal questions included.
    for key in CORE:
        assert 8 <= len(_default(key)) <= 12, (key, len(_default(key)))
    for key in OTHERS:
        assert 6 <= len(_default(key)) <= 9, (key, len(_default(key)))


def test_an_unknown_or_empty_key_gets_the_universal_questions_only() -> None:
    for key in ("", "not-a-control", "itac-three-way-match"):
        assert set(_keys(questions_for(key))) == set(_keys(UNIVERSAL))
    assert "wt-changes-in-period" in _keys(questions_for("not-a-control"))


def test_universal_questions_are_asked_for_every_control() -> None:
    for key in IN_SCOPE:
        asked = set(_keys(questions_for(key)))
        assert set(_keys(UNIVERSAL)) <= asked, key


def test_the_volume_question_follows_the_nature() -> None:
    assert STATEMENTS["access-authentication"].nature == "AUTOMATED"
    assert "wt-volume" not in _keys(questions_for("access-authentication", "AUTOMATED"))
    assert "wt-volume" not in _keys(questions_for("access-provisioning", "AUTOMATED"))
    assert "wt-volume" in _keys(questions_for("access-provisioning", "MANUAL"))
    assert "wt-volume" in _keys(questions_for("change-segregation", "IT_DEPENDENT_MANUAL"))
    # Written as the library writes it, the nature still matches.
    assert "wt-volume" in _keys(questions_for("access-provisioning", "IT-dependent manual"))
    # No nature given: nothing is filtered.
    assert "wt-volume" in _keys(questions_for("access-provisioning"))


def test_a_frequency_that_fixes_the_population_drops_the_volume_question() -> None:
    assert "wt-volume" in _keys(questions_for("access-provisioning", "MANUAL", "EVENT_DRIVEN"))
    assert "wt-volume" not in _keys(questions_for("access-review", "MANUAL", "QUARTERLY"))
    assert "wt-volume" not in _keys(questions_for("access-security-monitoring", "", "DAILY"))
    # The volume is an estimate for planning: the population obtained settles the sample.
    volume = question("wt-volume")
    assert volume is not None and not volume.required and volume.informs == ("SAMPLE",)


def test_family_questions_reach_their_family_only() -> None:
    assert "wt-ac-layers" in _keys(questions_for("access-provisioning"))
    assert "wt-ac-layers" not in _keys(questions_for("change-approval"))
    assert "wt-cm-population-source" in _keys(questions_for("change-approval"))
    assert "wt-cm-population-source" not in _keys(questions_for("access-review"))
    # A family question limited to some members: the authentication settings have no user
    # listing to produce.
    assert "wt-ac-population-source" not in _keys(questions_for("access-authentication"))
    assert "wt-ac-population-source" in _keys(questions_for("access-review"))


# Order: the control as it operates, then the testing context.


def test_questions_are_in_topic_order_and_in_each_topics_explicit_order() -> None:
    for key in ("", *IN_SCOPE):
        asked = questions_for(key)
        positions = [TOPICS.index(item.topic) for item in asked]
        assert positions == sorted(positions), key
        for topic in TOPICS:
            places = [item.order for item in asked if item.topic == topic and item.when is None]
            assert places == sorted(places) and len(set(places)) == len(places), (key, topic)
        # Deterministic.
        assert questions_for(key) == asked


def test_each_follow_up_comes_directly_after_its_parent() -> None:
    for key in IN_SCOPE:
        asked = questions_for(key)
        for index, item in enumerate(asked):
            if item.when is None:
                continue
            assert item.order == 0 and index > 0, item.key
            before = asked[index - 1]
            assert before.key == item.when[0] or (
                before.when is not None and before.when[0] == item.when[0]
            ), (key, item.key)
            parent = question(item.when[0])
            assert parent is not None and parent.topic == item.topic, item.key


def test_universal_family_and_specific_questions_interleave_in_walkthrough_order() -> None:
    ac01 = _keys(questions_for("access-provisioning"))
    assert ac01.index("wt-ac-layers") < ac01.index("wt-ac01-account-types")
    assert ac01.index("wt-ac01-authority") < ac01.index("wt-ac01-provisioning")
    assert ac01.index("wt-ac01-provisioning") < ac01.index("wt-ac01-self-approval")
    # The system log as the population source sits with the population, after exceptions.
    assert ac01.index("wt-known-deviations") < ac01.index("wt-ac-change-logging")
    # A control's own exception handling comes before the universal known deviations.
    ac03 = _keys(questions_for("access-review"))
    assert ac03.index("wt-ac03-investigation") < ac03.index("wt-known-deviations")
    # The family population source before the control's own listing check.
    assert ac03.index("wt-ac-population-source") < ac03.index("wt-ac03-listing-check")
    # A family follow-up of a universal question: vendor changes after the service
    # organization's details.
    cm01 = _keys(questions_for("change-approval"))
    service = cm01.index("wt-service-org")
    assert cm01[service : service + 4] == [
        "wt-service-org",
        "wt-service-org-report",
        "wt-service-org-detail",
        "wt-cm-vendor-changes",
    ]


def test_problems_reports_a_shared_place_and_a_follow_up_in_another_topic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bank = CONTROL_QUESTIONS["access-provisioning"]
    authority = question("wt-ac01-authority")
    assert authority is not None
    clash = replace(authority, key="wt-ac01-clash", text="Who else approves access?")
    moved = replace(
        authority, key="wt-ac01-moved", text="Who approves it then?", order=0,
        when=("wt-ac01-sod-check", "Yes"),
    )  # fmt: skip
    monkeypatch.setitem(CONTROL_QUESTIONS, "access-provisioning", (*bank, clash, moved))
    found = problems()
    assert any(p.startswith("wt-ac01-clash: shares its place in APPROVAL") for p in found)
    assert any(
        p.startswith("wt-ac01-moved: a follow-up is asked in its parent's topic") for p in found
    )


# What each answer informs.


def test_every_question_informs_what_testing_needs() -> None:
    for item in walkthrough_questions._all():
        assert item.informs, item.key
        for need in item.informs:
            assert need in INFORMS or need.islower(), (item.key, need)


def test_control_specific_informs_name_attributes_of_the_control() -> None:
    for library_key, items in CONTROL_QUESTIONS.items():
        definition = definition_for(library_key)
        assert definition is not None, library_key
        attributes = {attribute.key for attribute in definition.attributes}
        for item in items:
            for need in item.informs:
                assert need in INFORMS or need in attributes, (library_key, item.key, need)
    # Most control-specific questions name the attribute their answer changes.
    named = [
        item
        for items in CONTROL_QUESTIONS.values()
        for item in items
        if any(need not in INFORMS for need in item.informs)
    ]
    assert len(named) * 4 >= 3 * sum(len(items) for items in CONTROL_QUESTIONS.values())


def test_universal_and_family_questions_inform_only_what_every_control_they_reach_has() -> None:
    for item in UNIVERSAL:
        assert set(item.informs) <= set(INFORMS), item.key
    for items in FAMILY_QUESTIONS.values():
        for item in items:
            for need in item.informs:
                if need in INFORMS:
                    continue
                for key in IN_SCOPE:
                    if item.key in _keys(questions_for(key)):
                        definition = definition_for(key)
                        assert definition is not None
                        assert need in {a.key for a in definition.attributes}, (item.key, key)


def test_problems_reports_an_unknown_need_or_attribute(monkeypatch: pytest.MonkeyPatch) -> None:
    bank = CONTROL_QUESTIONS["access-provisioning"]
    authority = question("wt-ac01-authority")
    assert authority is not None
    wrong = replace(
        authority, key="wt-ac01-wrong", text="Who signs?", order=99,
        informs=("ac02-timely", "BACKGROUND"),
    )  # fmt: skip
    empty = replace(authority, key="wt-ac01-empty", text="Who else signs?", order=98, informs=())
    monkeypatch.setitem(CONTROL_QUESTIONS, "access-provisioning", (*bank, wrong, empty))
    found = problems()
    assert "wt-ac01-wrong: informs ac02-timely, not an attribute of access-provisioning" in found
    assert "wt-ac01-wrong: unknown informs token BACKGROUND" in found
    assert "wt-ac01-empty: informs must name at least one need, without repeats" in found


def test_drives_follow_from_what_the_answer_informs() -> None:
    authority = question("wt-ac01-authority")
    assert authority is not None and authority.drives == ("EVIDENCE", "ATTRIBUTES")
    population = question("wt-cm-population-source")
    assert population is not None and population.drives == ("EVIDENCE", "SAMPLING")
    service = question("wt-service-org")
    assert service is not None and service.drives == ("EVIDENCE", "SCOPE")


def test_ac01_keeps_the_depth_testing_needs_and_drops_the_rest() -> None:
    asked = set(_keys(questions_for("access-provisioning")))
    for key in (
        "wt-ac01-authority",  # approver authority
        "wt-ac01-enforced-approval",  # approval recorded before the grant
        "wt-ac01-provisioning",  # how granted, so granted = approved is tested
        "wt-ac01-self-approval",  # neither the user nor the granting administrator approves
        "wt-ac01-sod-check",
        "wt-ac-change-logging",  # the system log as the population source
        "wt-ac01-account-types",
        "wt-ac-layers",
    ):
        assert key in asked, key
    for key in (
        "wt-ac01-delegation",
        "wt-ac01-ticket-edit",
        "wt-ac01-ticket-history",
        "wt-ac01-unapproved",
        "wt-records-retention",
        "wt-ac01-admin-requests",
    ):
        assert key not in asked and question(key) is None, key
    self_approval = question("wt-ac01-self-approval")
    assert self_approval is not None and "ac01-not-self" in self_approval.informs
    logging = question("wt-ac-change-logging")
    assert logging is not None and logging.topic == "POPULATION"
    provisioning = question("wt-ac01-provisioning")
    assert provisioning is not None and provisioning.topic == "EXECUTION"


def test_statement_slots_are_not_asked_again() -> None:
    # AC-01's statement already asks for the system, tool, policy, admin role and owner.
    texts = " ".join(item.text.lower() for item in questions_for("access-provisioning"))
    assert "which access request tool" not in texts
    assert "control owner" not in texts


# Follow-ups and answers.


def test_follow_ups_appear_only_when_the_parent_answer_matches() -> None:
    asked = questions_for("access-provisioning", "MANUAL")
    assert "wt-ac01-sod-method" not in _keys(applicable(asked, {}))
    assert "wt-ac01-sod-method" not in _keys(applicable(asked, {"wt-ac01-sod-check": "No"}))
    assert "wt-ac01-sod-method" in _keys(applicable(asked, {"wt-ac01-sod-check": "Yes"}))
    # Base questions are always asked.
    assert "wt-ac01-sod-check" in _keys(applicable(asked, {}))
    # Universal follow-ups behave the same way.
    assert "wt-changes-in-period-detail" not in _keys(applicable(asked, {}))
    changed = applicable(asked, {"wt-changes-in-period": "Yes"})
    assert "wt-changes-in-period-detail" in _keys(changed)


def test_a_multi_answer_triggers_the_follow_up_for_one_of_its_options() -> None:
    asked = questions_for("change-approval", "MANUAL")
    assert "wt-cm01-standard-changes" not in _keys(
        applicable(asked, {"wt-cm-change-types": "Normal; Emergency"})
    )
    assert "wt-cm01-standard-changes" in _keys(
        applicable(asked, {"wt-cm-change-types": "Standard (pre-approved); Normal"})
    )


def test_a_follow_up_is_not_asked_when_its_parent_is_not_asked() -> None:
    child = question("wt-ac01-sod-method")
    assert child is not None
    assert applicable([child], {"wt-ac01-sod-check": "Yes"}) == []


def test_valid_answer_for_each_kind() -> None:
    choice = question("wt-ac01-self-approval")
    multi = question("wt-ac01-account-types")
    yes_no = question("wt-ac01-sod-check")
    text = question("wt-known-deviations-detail")
    assert choice is not None and choice.kind == "CHOICE"
    assert multi is not None and multi.kind == "MULTI"
    assert yes_no is not None and yes_no.kind == "YES_NO"
    assert text is not None and text.kind == "TEXT"

    assert valid_answer(choice, "Prevented by the system")
    assert not valid_answer(choice, "Sometimes")
    assert not valid_answer(choice, "Prevented by the system; Not prevented")
    assert not valid_answer(choice, "")

    assert valid_answer(multi, "Employees")
    assert valid_answer(multi, "Employees; Contractors")
    assert not valid_answer(multi, "Employees; Employees")
    assert not valid_answer(multi, "Employees; Something else")
    assert not valid_answer(multi, "")

    assert all(valid_answer(yes_no, value) for value in YES_NO)
    assert not valid_answer(yes_no, "Maybe")
    assert not valid_answer(yes_no, "")

    assert valid_answer(text, "A monthly comparison of the user list with the tickets")
    assert not valid_answer(text, "   ")
    assert not valid_answer(text, "x" * 1001)
    assert valid_answer(text, "x" * 1000)


def test_required_follow_ups_only_follow_required_questions() -> None:
    for key in IN_SCOPE:
        for item in questions_for(key):
            if item.when is not None and item.required:
                parent = question(item.when[0])
                assert parent is not None and parent.required, item.key


def test_only_choice_and_multi_questions_have_options() -> None:
    for key in IN_SCOPE:
        for item in questions_for(key):
            if item.kind in ("CHOICE", "MULTI"):
                assert 2 <= len(item.options) <= 8, item.key
            else:
                assert item.options == (), item.key


def test_question_looks_up_by_key() -> None:
    found = question("wt-changes-in-period")
    assert found is not None and found.topic == "CHANGES"
    assert question("wt-no-such-question") is None


# The narrated understanding.


def test_every_question_is_narrated() -> None:
    for item in walkthrough_questions._all():
        if item.kind == "YES_NO":
            assert item.narrative == "" and item.narrative_yes and item.narrative_no, item.key
        else:
            assert item.narrative.count("{answer}") == 1, item.key
            assert not (item.narrative_yes or item.narrative_no), item.key


def test_narrate_groups_sentences_by_topic_in_order_with_each_answer_keyed() -> None:
    asked = questions_for("access-provisioning", "MANUAL", "EVENT_DRIVEN")
    # Given out of order: the narrative follows the topics, not the answers.
    answers = {
        "wt-volume": "101 to 250",
        "wt-ac01-self-approval": "Prohibited by policy only",
        "wt-ac-layers": "Application",
        "wt-ac01-authority": "The manager of record in the HR system",
        "wt-ac01-account-types": "Employees",
    }
    told = narrate(asked, answers)
    assert [topic for topic, _ in told] == ["SCOPE", "APPROVAL", "SEGREGATION", "VOLUME"]
    scope = told[0][1]
    assert scope == [
        ("The control covers access to the ", None),
        ("application", "wt-ac-layers"),
        (".", None),
        (" ", None),
        ("The request process covers ", None),
        ("employees", "wt-ac01-account-types"),
        (".", None),
    ]
    assert _text(told[1][1]) == (
        "The approver's authority comes from the manager of record in the HR system."
    )
    assert _text(told[2][1]) == (
        "Approval of a request by its user or by the administrator who grants it is "
        "prohibited by policy only."
    )
    assert told[3][1][1] == ("101 to 250", "wt-volume")


def test_a_yes_no_answer_reads_as_its_own_sentence() -> None:
    asked = questions_for("access-provisioning")
    item = question("wt-ac01-enforced-approval")
    assert item is not None
    [(topic, yes)] = narrate(asked, {"wt-ac01-enforced-approval": "Yes"})
    assert topic == "APPROVAL" and yes == [(item.narrative_yes, item.key)]
    assert yes[0][0] == (
        "The request tool does not let a request move to provisioning until the approval is "
        "recorded."
    )
    [(_, no)] = narrate(asked, {"wt-ac01-enforced-approval": "No"})
    assert no == [(item.narrative_no, item.key)]


def test_a_multi_answer_reads_as_a_list() -> None:
    asked = questions_for("access-privileged")
    three = "IT administrators; Database administrators; Service accounts"
    [(_, parts)] = narrate(asked, {"wt-ac04-who-holds": three})
    # Abbreviations keep their capitals; other options read in lower case inside a sentence.
    assert parts[1] == (
        "IT administrators, database administrators and service accounts",
        "wt-ac04-who-holds",
    )
    [(_, two)] = narrate(asked, {"wt-ac04-who-holds": "Service accounts; IT administrators"})
    assert two[1][0] == "service accounts and IT administrators"
    [(_, one)] = narrate(asked, {"wt-ac04-who-holds": "Vendor or outsourced staff"})
    assert _text(one) == "Privileged access is held by vendor or outsourced staff."


def test_a_text_answer_is_inserted_as_given_with_its_ending_normalised() -> None:
    asked = questions_for("access-provisioning")
    answers = {
        "wt-known-deviations": "Yes",
        "wt-known-deviations-detail": (
            "  A monthly comparison of the user list\n with the tickets. "
        ),
    }
    [(topic, parts)] = narrate(asked, answers)
    assert topic == "EXCEPTIONS"
    assert parts[-2] == (
        "A monthly comparison of the user list with the tickets",
        "wt-known-deviations-detail",
    )
    assert _text(parts).endswith(
        "as follows: A monthly comparison of the user list with the tickets."
    )
    assert ("", None) not in parts and parts[1] == (" ", None)


def test_an_answer_that_opens_its_sentence_is_capitalised() -> None:
    base = question("wt-ac02-leaver-list")
    assert base is not None
    opening = replace(base, narrative="{answer} is the source of the leaver list.")
    [(_, parts)] = narrate([opening], {opening.key: "A custom query or report"})
    assert parts == [
        ("A custom query or report", opening.key),
        (" is the source of the leaver list.", None),
    ]


def test_unanswered_not_applicable_and_unnarrated_questions_are_left_out() -> None:
    asked = questions_for("access-provisioning")
    assert narrate(asked, {}) == []
    # Empty is not applicable; a topic with no sentence does not appear.
    told = narrate(asked, {"wt-volume": "", "wt-ac01-authority": "A role-owner matrix"})
    assert [topic for topic, _ in told] == ["APPROVAL"]
    # A question without a narrative is not told.
    silent = replace(asked[0], narrative="")
    assert narrate([silent], {silent.key: "Application"}) == []
    # An invalid answer, or a key the questions do not hold, is not told.
    assert narrate(asked, {"wt-ac01-authority": "Maybe", "wt-unknown": "Yes"}) == []


def test_a_follow_up_its_parent_no_longer_opens_is_left_out() -> None:
    asked = questions_for("access-provisioning")
    stale = {"wt-ac01-sod-check": "No", "wt-ac01-sod-method": "Manually by a reviewer"}
    [(_, parts)] = narrate(asked, stale)
    assert {key for _, key in parts if key} == {"wt-ac01-sod-check"}
    opened = {"wt-ac01-sod-check": "Yes", "wt-ac01-sod-method": "Manually by a reviewer"}
    [(_, parts)] = narrate(asked, opened)
    assert _text(parts) == (
        "Each request is checked for segregation-of-duties conflicts before the access is "
        "granted. The conflict check is performed manually by a reviewer."
    )


def test_every_rendered_sentence_reads_as_a_sentence_without_placeholders() -> None:
    for key in ("", *IN_SCOPE):
        asked = questions_for(key)
        for item in asked:
            values = ["Yes", "No"] if item.kind == "YES_NO" else [_sample(item)]
            # And with an answer the options do not offer, where the question takes one.
            if item.allows_other:
                other = f"{OTHER}A process agreed with the client"
                values.append(other if item.kind == "CHOICE" else _sample(item) + JOIN + other)
            for value in values:
                answers = {item.key: value}
                if item.when is not None:
                    answers[item.when[0]] = item.when[1]
                told = dict(narrate(asked, answers))
                assert item.topic in told, (key, item.key)
                own = [text for text, owner in told[item.topic] if owner == item.key]
                assert own, (key, item.key)
                for parts in told.values():
                    for text, _ in parts:
                        assert "{" not in text and "}" not in text, (item.key, text)
                # The question's own sentence is the topic's last (its parent's comes first).
                parts = told[item.topic]
                gaps = [index for index, part in enumerate(parts) if part == (" ", None)]
                sentence = _text(parts[gaps[-1] + 1 if gaps else 0 :])
                assert sentence.endswith(".") and sentence[:1].isupper(), (item.key, sentence)
                assert ".." not in sentence and "  " not in sentence, (item.key, sentence)


# Several answers and "Other" (product owner, 11 November 2026: "The questions in control
# understanding do not take multiple answers", and no answer could be given that is not among
# the options).

# Each question converted from CHOICE: more than one option can be true at the same client for
# the same control (e.g. an HR feed and a manager's ticket).
CONVERTED = (
    "wt-ac-population-source",
    "wt-cm-who-deploys",
    "wt-cm-population-source",
    "wt-cm-vendor-changes",
    "wt-ac01-authority",
    "wt-ac01-provisioning",
    "wt-ac01-sod-method",
    "wt-ac02-contractors",
    "wt-ac02-trigger",
    "wt-ac02-leaver-list",
    "wt-ac03-performed-in",
    "wt-ac03-own-access",
    "wt-ac06-inventory-source",
    "wt-ac07-trigger",
    "wt-ac07-old-access",
    "wt-ac09-identification",
    "wt-ac11-default-accounts",
    "wt-ac11-log-destination",
    "wt-cm01-testing-who",
    "wt-cm02-access-used",
    "wt-cm03-developer-list",
    "wt-cm04-route",
    "wt-cm06-testing",
    "wt-cm07-methodology",
    "wt-cm08-method",
)
# What stays a single answer: options that exclude each other.
SINGLE = (
    "wt-volume",
    "wt-ac01-self-approval",
    "wt-ac02-disable-delete",
    "wt-ac09-expiry",
    "wt-cm01-approver-independent",
    "wt-cm02-approver-independent",
    "wt-cm04-approver-independent",
    "wt-cm06-approver-independent",
    # Converted from free text (11 November 2026): one deadline, one length, one range, one
    # term.
    "wt-ac02-involuntary-deadline",
    "wt-ac07-transition-length",
    "wt-ac11-instances",
    "wt-cm03-exception-term",
)


def _every_choice() -> list[Question]:
    return [item for item in walkthrough_questions._all() if item.kind in ("CHOICE", "MULTI")]


def test_questions_where_several_answers_can_be_true_take_several() -> None:
    for key in CONVERTED:
        item = question(key)
        assert item is not None and item.kind == "MULTI", key
    choices = sorted(item.key for item in walkthrough_questions._all() if item.kind == "CHOICE")
    assert choices == sorted(SINGLE)
    # The workaround options a single answer needed are gone.
    for item in _every_choice():
        for option in item.options:
            words = option.casefold()
            assert not words.startswith(("both", "a mix", "either way", "a combination")), (
                item.key,
                option,
            )
            assert "depending on" not in words and "different ways" not in words, (
                item.key,
                option,
            )
    authority = question("wt-ac01-authority")
    assert authority is not None and len(authority.options) == 2


def test_a_converted_question_s_follow_up_still_opens_on_one_of_its_answers() -> None:
    asked = questions_for("access-transfer", "MANUAL")
    transition = question("wt-ac07-transition-length")
    assert transition is not None and transition.when is not None
    parent, value = transition.when
    old = question(parent)
    assert old is not None and old.kind == "MULTI" and value in old.options
    other = next(option for option in old.options if option != value)
    assert transition.key not in _keys(applicable(asked, {parent: other}))
    assert transition.key in _keys(applicable(asked, {parent: JOIN.join((other, value))}))
    # An Other answer never opens a follow-up.
    assert transition.key not in _keys(applicable(asked, {parent: f"{OTHER}{value}"}))


def test_every_choice_takes_other_unless_a_fixed_answer_set_is_essential() -> None:
    closed = [item.key for item in _every_choice() if not item.allows_other]
    # The volume is a range the planned sample size is read from.
    assert closed == ["wt-volume"]
    for item in walkthrough_questions._all():
        if item.kind in ("YES_NO", "TEXT"):
            assert not item.allows_other, item.key
        for option in item.options:
            assert not option.casefold().startswith("other"), (item.key, option)


def test_valid_answer_takes_one_other_part_where_the_question_allows_it() -> None:
    choice = question("wt-ac01-self-approval")
    multi = question("wt-ac02-trigger")
    closed = question("wt-volume")
    yes_no = question("wt-ac01-sod-check")
    text = question("wt-known-deviations-detail")
    assert choice is not None and choice.kind == "CHOICE" and choice.allows_other
    assert multi is not None and multi.kind == "MULTI" and multi.allows_other
    assert closed is not None and closed.kind == "CHOICE" and not closed.allows_other
    assert yes_no is not None and text is not None
    first, second = multi.options[:2]

    # CHOICE: one option, or one Other part.
    assert valid_answer(choice, "Other: Detected by the monthly review")
    assert valid_answer(choice, f"{OTHER}abc") and valid_answer(choice, OTHER + "x" * 200)
    assert not valid_answer(choice, f"{OTHER}ab")  # too short
    assert not valid_answer(choice, f"{OTHER}  ab  ")  # too short after strip
    assert not valid_answer(choice, OTHER + "x" * 201)  # too long
    assert not valid_answer(choice, "other: Detected by the monthly review")  # prefix case
    assert not valid_answer(choice, "OTHER: Detected by the monthly review")
    assert not valid_answer(choice, "Other:Detected by the monthly review")  # prefix spacing
    assert not valid_answer(choice, "Other: Detected; by the monthly review")  # ";" inside
    assert not valid_answer(choice, f"{choice.options[0]}; Other: A monthly review")
    assert not valid_answer(choice, "Other: A monthly review; Other: A weekly review")

    # MULTI: distinct options, then at most one Other part, last.
    assert valid_answer(multi, f"{first}; {second}; Other: A call from HR on the day")
    assert valid_answer(multi, f"{first}; Other: A call from HR on the day")
    assert valid_answer(multi, "Other: A call from HR on the day")
    assert not valid_answer(multi, f"Other: A call from HR on the day; {first}")  # not last
    assert not valid_answer(multi, f"{first}; Other: A call; Other: An email")  # two Others
    assert not valid_answer(multi, f"{first}; Other: no")  # too short
    assert not valid_answer(multi, f"{first}; other: A call from HR")  # prefix case
    assert not valid_answer(multi, f"{first}; {first}; Other: A call from HR")  # repeated
    assert not valid_answer(multi, f"{first}; Other: " + "x" * 201)

    # Never on a question that does not allow it, a yes-or-no or a plain-text question.
    assert not valid_answer(closed, "Other: About 300 a year")
    assert not valid_answer(yes_no, "Other: Sometimes")
    # A plain-text answer is free text already: "Other:" is just its words, never an Other.
    assert valid_answer(text, "Other: a monthly comparison")
    assert not text.allows_other and not yes_no.allows_other


def test_an_other_answer_reads_as_its_text_in_the_understanding() -> None:
    asked = questions_for("access-termination")
    multi = question("wt-ac02-trigger")
    assert multi is not None
    value = f"{multi.options[0]}; Other: A call from HR on the day."
    [(_, parts)] = narrate(asked, {multi.key: value})
    assert _text(parts) == (
        "IT learns of a termination through an automated feed from the HR system and a call "
        "from HR on the day."
    )
    assert parts[1] == (
        "an automated feed from the HR system and a call from HR on the day",
        multi.key,
    )
    # A name keeps its capital; an Other alone reads as the whole answer.
    [(_, alone)] = narrate(asked, {multi.key: "Other: Okta lifecycle   workflows"})
    assert _text(alone) == "IT learns of a termination through Okta lifecycle workflows."
    choice = question("wt-ac01-self-approval")
    assert choice is not None
    [(_, single)] = narrate(
        questions_for("access-provisioning"), {choice.key: "Other: Detected by the monthly review"}
    )
    # A first word that is plainly not a name reads in lower case inside the sentence.
    assert _text(single) == (
        "Approval of a request by its user or by the administrator who grants it is detected "
        "by the monthly review."
    )
    # An Other part the question does not take is not told.
    volume = question("wt-volume")
    assert volume is not None
    assert narrate([volume], {volume.key: "Other: About 300"}) == []


def test_problems_reports_the_other_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    bank = CONTROL_QUESTIONS["access-provisioning"]
    authority = question("wt-ac01-authority")
    sod = question("wt-ac01-sod-check")
    method = question("wt-ac01-sod-method")
    assert authority is not None and sod is not None and method is not None
    named = replace(
        authority, key="wt-ac01-named", text="Who else approves?", order=97,
        options=("Other approvers", "The owner"),
    )  # fmt: skip
    open_yes_no = replace(sod, key="wt-ac01-open", text="Is it open?", order=96, allows_other=True)
    on_other = replace(
        method, key="wt-ac01-on-other", text="And then?", when=("wt-ac01-self-approval",
        "Other: A monthly review"),
    )  # fmt: skip
    monkeypatch.setitem(
        CONTROL_QUESTIONS, "access-provisioning", (*bank, named, open_yes_no, on_other)
    )
    found = problems()
    assert "wt-ac01-named: option 'Other approvers' must not start with 'Other'" in found
    assert "wt-ac01-open: a YES_NO question never takes an Other answer" in found
    assert (
        "wt-ac01-on-other: 'Other: A monthly review' is not an answer of wt-ac01-self-approval"
        in found
    )


# Options wherever an answer can be listed (product owner, 11 November 2026: "Make sure that
# whenever questions like this show up, an option is always provided so that the user won't
# have to type as much as possible").

# Every question that was free text before the change, by what it became: a key kept where
# the question asks the same thing (an earlier free-text answer is not valid for it, so it
# reads as missing), new keys where a question that asked several things was split.
FROM_TEXT: dict[str, tuple[str, ...]] = {
    "wt-known-deviations-detail": ("wt-known-deviations-kind", "wt-known-deviations-detail"),
    "wt-changes-in-period-detail": ("wt-changes-in-period-what", "wt-changes-in-period-detail"),
    "wt-service-org-detail": ("wt-service-org-report", "wt-service-org-detail"),
    "wt-cm-environments-gap": ("wt-cm-environments-shared", "wt-cm-environments-tested"),
    "wt-ac-change-logging-gap": ("wt-ac-change-logging-gap",),
    "wt-ac02-involuntary-detail": ("wt-ac02-involuntary-deadline",),
    "wt-ac04-reviewer-own": ("wt-ac04-reviewer-own",),
    "wt-ac05-exemptions-detail": ("wt-ac05-exempt-accounts", "wt-ac05-exempt-approval"),
    "wt-ac06-ownership": ("wt-ac06-owner-record", "wt-ac06-owner-current"),
    "wt-ac06-interactive-detail": ("wt-ac06-interactive-detail",),
    "wt-ac07-what-counts": ("wt-ac07-what-counts",),
    "wt-ac07-transition": ("wt-ac07-transition-length", "wt-ac07-transition-approver"),
    "wt-ac08-ids": ("wt-ac08-id-rights",),
    "wt-ac09-sponsor-approval": ("wt-ac09-sponsor-approval",),
    "wt-ac10-mitigation": ("wt-ac10-mitigation-approver", "wt-ac10-mitigation-evidence"),
    "wt-ac11-platforms": ("wt-ac11-platforms", "wt-ac11-instances"),
    "wt-ac12-triage": ("wt-ac12-triage",),
    "wt-ac12-escalation": ("wt-ac12-escalation",),
    "wt-cm01-standard-changes": ("wt-cm01-standard-changes", "wt-cm01-standard-approver"),
    "wt-cm02-who-declares": ("wt-cm02-who-declares", "wt-cm02-decision-record"),
    "wt-cm03-compensating": (
        "wt-cm03-compensating",
        "wt-cm03-exception-approver",
        "wt-cm03-exception-term",
    ),
    "wt-cm03-deploy-rights": ("wt-cm03-deploy-rights",),
    "wt-cm04-log-gap": ("wt-cm04-log-gap", "wt-cm04-unlogged-detection"),
    "wt-cm05-logging-gap": ("wt-cm05-logging-gap",),
    "wt-cm06-automated-detail": ("wt-cm06-automated-which", "wt-cm06-schedule-approver"),
    "wt-cm07-what-qualifies": ("wt-cm07-what-qualifies",),
    "wt-cm07-open-defects-detail": ("wt-cm07-defects-accepted-by", "wt-cm07-defects-record"),
    "wt-cm08-objects": ("wt-cm08-objects",),
}
# The kind of every question the free-text ones became, other than those kept as text.
BECAME: dict[str, str] = {
    "wt-known-deviations-kind": "MULTI",
    "wt-changes-in-period-what": "MULTI",
    # Several service organizations, each with its own report, can serve one control.
    "wt-service-org-report": "MULTI",
    "wt-cm-environments-shared": "MULTI",
    "wt-cm-environments-tested": "MULTI",
    "wt-ac-change-logging-gap": "MULTI",
    "wt-ac02-involuntary-deadline": "CHOICE",
    "wt-ac04-reviewer-own": "MULTI",
    "wt-ac05-exempt-accounts": "MULTI",
    "wt-ac05-exempt-approval": "MULTI",
    "wt-ac06-owner-record": "MULTI",
    "wt-ac06-owner-current": "MULTI",
    "wt-ac06-interactive-detail": "MULTI",
    "wt-ac07-what-counts": "MULTI",
    "wt-ac07-transition-length": "CHOICE",
    "wt-ac07-transition-approver": "MULTI",
    "wt-ac08-id-rights": "MULTI",
    "wt-ac09-sponsor-approval": "MULTI",
    "wt-ac10-mitigation-approver": "MULTI",
    "wt-ac10-mitigation-evidence": "MULTI",
    "wt-ac11-platforms": "MULTI",
    "wt-ac11-instances": "CHOICE",
    "wt-ac12-triage": "MULTI",
    "wt-ac12-escalation": "MULTI",
    "wt-cm01-standard-changes": "MULTI",
    "wt-cm01-standard-approver": "MULTI",
    "wt-cm02-who-declares": "MULTI",
    "wt-cm02-decision-record": "MULTI",
    "wt-cm03-compensating": "MULTI",
    "wt-cm03-exception-approver": "MULTI",
    "wt-cm03-exception-term": "CHOICE",
    "wt-cm03-deploy-rights": "MULTI",
    "wt-cm04-log-gap": "MULTI",
    "wt-cm04-unlogged-detection": "MULTI",
    "wt-cm05-logging-gap": "MULTI",
    "wt-cm06-automated-which": "MULTI",
    "wt-cm06-schedule-approver": "MULTI",
    "wt-cm07-what-qualifies": "MULTI",
    "wt-cm07-defects-accepted-by": "MULTI",
    "wt-cm07-defects-record": "MULTI",
    "wt-cm08-objects": "MULTI",
}
# The only free-text questions left: narratives no list can hold.
TEXT_ALLOWED = frozenset(
    {"wt-known-deviations-detail", "wt-changes-in-period-detail", "wt-service-org-detail"}
)
TEXT_AT_MOST = 6


def test_free_text_is_kept_only_where_no_list_can_hold_the_answer() -> None:
    texts = {item.key for item in walkthrough_questions._all() if item.kind == "TEXT"}
    assert texts == TEXT_ALLOWED == TEXT_KEPT
    assert len(texts) <= TEXT_AT_MOST
    # Asked for every control, the same few: none is specific to a control.
    for key in IN_SCOPE:
        asked = {item.key for item in questions_for(key) if item.kind == "TEXT"}
        assert asked == TEXT_ALLOWED, key


def test_every_free_text_question_became_options_or_a_structured_question_first() -> None:
    every = {item.key for item in walkthrough_questions._all()}
    became = {key for parts in FROM_TEXT.values() for key in parts}
    assert became <= every
    assert set(BECAME) == became - TEXT_ALLOWED
    for key, kind in BECAME.items():
        item = question(key)
        assert item is not None and item.kind == kind, key
        # Options, most common first, and room for an answer they do not offer.
        assert 2 <= len(item.options) <= 8 and item.allows_other, key
        assert valid_answer(item, item.options[0]), key
        # An earlier free-text answer is not a valid answer to the question it became.
        assert not valid_answer(item, "As the control owner described it in the walkthrough.")
    # A question split into parts is gone, its parts in its place.
    for old, parts in FROM_TEXT.items():
        if old not in parts:
            assert question(old) is None, old
            assert old not in {k for key in IN_SCOPE for k in _keys(questions_for(key))}, old
    # Each split's parts are asked together, as the old question was.
    for old, parts in FROM_TEXT.items():
        items = [question(key) for key in parts]
        assert all(item is not None for item in items), old
        assert len({(item.when, item.topic) for item in items if item is not None}) == 1, old


def test_the_product_owners_example_and_the_universal_follow_ups_offer_their_options() -> None:
    counts = question("wt-ac07-what-counts")
    assert counts is not None and counts.kind == "MULTI" and counts.allows_other
    assert counts.options == (
        "A new department",
        "A new position or job code",
        "A new manager",
        "A new location",
        "A new company code or legal entity",
    )
    assert "for example" not in counts.text
    what = question("wt-changes-in-period-what")
    assert what is not None and what.options == (
        "The system or its version",
        "The tool",
        "The people who perform it",
        "The process",
        "The control's design",
    )
    report = question("wt-service-org-report")
    assert report is not None and report.options == (
        "A SOC 1 Type 2 report covering the period",
        "A SOC 1 Type 2 report covering part of the period (bridge letter needed)",
        "A SOC 1 Type 1 report only",
        "No SOC 1 report",
    )
    kind = question("wt-known-deviations-kind")
    assert kind is not None and kind.when == ("wt-known-deviations", "Yes")


def test_each_free_text_question_comes_after_a_structured_one_on_the_same_follow_up() -> None:
    for key in ("", *IN_SCOPE):
        asked = questions_for(key)
        for index, item in enumerate(asked):
            if item.kind != "TEXT":
                continue
            before = asked[index - 1]
            assert before.when == item.when and before.kind in ("CHOICE", "MULTI"), (key, item.key)
            assert item.required == before.required, item.key


def test_the_structured_follow_ups_and_their_text_read_as_the_understanding() -> None:
    asked = questions_for("change-approval", "MANUAL", "EVENT_DRIVEN")
    answers = {
        "wt-changes-in-period": "Yes",
        "wt-changes-in-period-what": "The tool; The people who perform it",
        "wt-changes-in-period-detail": "On 1 June 2027 ServiceNow replaced Jira.",
        "wt-service-org": "Yes",
        "wt-service-org-report": (
            "A SOC 1 Type 2 report covering part of the period (bridge letter needed)"
        ),
        "wt-service-org-detail": "SAP SE, relying on user access and change management.",
        "wt-cm-change-types": "Standard (pre-approved); Normal",
        "wt-cm01-standard-changes": "Job schedule changes; Other: The printer settings",
        "wt-cm01-standard-approver": "The change advisory board",
        "wt-cm-environments": "No",
        "wt-cm-environments-shared": "Development is shared with test",
        "wt-cm-environments-tested": "A shared development and test environment",
    }
    told = {topic: _text(parts) for topic, parts in narrate(asked, answers)}
    assert told["CHANGES"] == (
        "The control, its system, its tool, the people who perform it or its process changed "
        "during the period. What changed in the period was the tool and the people who perform "
        "it. The dates of the change, and how the control operated before and after it, are as "
        "follows: On 1 June 2027 ServiceNow replaced Jira."
    )
    assert told["SERVICE_ORG"].startswith(
        "A service organization performs part of the control or hosts the system or tool it "
        "relies on. The service organization provides a SOC 1 Type 2 report covering part of "
        "the period (bridge letter needed). The service organization and the complementary "
        "user entity controls relied on are as follows: SAP SE, relying on user access and "
        "change management."
    )
    assert told["SCOPE"].endswith(
        "The changes pre-approved as standard are job schedule changes and the printer settings. "
        "The list of standard changes was approved by the change advisory board."
    )
    assert (
        "Of the environments, development is shared with test. Before they reach users, "
        "changes are tested in a shared development and test environment."
    ) in told["EXECUTION"]
    transfer = questions_for("access-transfer")
    [(_, parts)] = narrate(transfer, {"wt-ac07-what-counts": "A new department; A new manager"})
    assert _text(parts) == "A transfer for this control is a new department and a new manager."


def test_problems_reports_free_text_that_is_not_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    bank = CONTROL_QUESTIONS["access-provisioning"]
    detail = question("wt-known-deviations-detail")
    assert detail is not None
    typed = replace(detail, key="wt-ac01-typed", text="Who else signs?", when=None, order=95)
    monkeypatch.setitem(CONTROL_QUESTIONS, "access-provisioning", (*bank, typed))
    assert "wt-ac01-typed: free text where options can be given (TEXT_KEPT)" in problems()
