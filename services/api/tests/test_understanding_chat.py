"""Control Understanding as a conversation (product owner, 9 November 2026;
docs/control-understanding-conversation.md): a typed reply is read and shown back, never
saved; the same control on other systems is offered the answers, which fill only what each
system has not answered."""

from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.models import ModelRaw, ModelRequest
from ai_workforce_api.understanding_chat import InterpretBody, interpret

__all__ = ["migrated"]


def _two_systems(migrated: Database, slug: str) -> dict[str, Any]:
    """An engagement whose IT general controls run on SAP ERP and on Oracle EBS."""
    team = _new_engagement(migrated, slug)
    owner = team["owner"]
    base = _base(team["org"], team["project"])
    assert (
        owner.patch(
            f"{base}/scope", json={"scope": "ITGCs for FY2027", "period_end": "2027-12-31"}
        ).status_code
        == 200
    )
    for name in ("SAP ERP", "Oracle EBS"):
        assert owner.post(f"{base}/applications", json={"name": name}).status_code == 200
    assert owner.post(f"{base}/controls/load-library").status_code == 200
    rows = owner.get(
        f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls"
    ).json()
    team["ac01"] = {
        row["application_name"]: row["id"] for row in rows if row["control_ref"] == "ITGC-AC-01"
    }
    assert set(team["ac01"]) == {"SAP ERP", "Oracle EBS"}, team["ac01"]
    return team


def _control_path(team: dict[str, Any], control: str) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}/controls/{control}"


def _slots(owner: Any, team: dict[str, Any], control: str) -> list[dict[str, Any]]:
    context = owner.get(f"{_control_path(team, control)}/context").json()
    return [
        slot
        for slot in context["design"]["slots"]
        if not slot["automatic"] and not slot.get("document")
    ]


def test_a_reply_is_read_and_shown_back_never_saved(migrated: Database) -> None:
    team = _two_systems(migrated, "uc-read")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    path = f"{_control_path(team, sap)}/understanding/interpret"
    slots = _slots(owner, team, sap)
    with_options = next(slot for slot in slots if slot["options"])
    key = with_options["key"]
    option = with_options["options"][0]

    def read(text: str, at: str = key) -> dict[str, Any]:
        answered = owner.post(path, json={"key": at, "text": text})
        assert answered.status_code == 200, answered.text
        body: dict[str, Any] = answered.json()
        return body

    # An offered answer, however it is typed, is that answer exactly.
    assert read(option.upper()) == {
        "intent": "ANSWER", "value": option, "reply": "", "source": "RULES",
    }  # fmt: skip
    # Own words are shown back as written.
    own = read("The IT security manager approves admin roles")
    assert (own["intent"], own["value"]) == (
        "ANSWER",
        "The IT security manager approves admin roles",
    )
    # A question back is explained from the record; a skip and a copy are recognised.
    explained = read("Why is this asked?")
    assert explained["intent"] == "EXPLAIN" and explained["reply"]
    assert read("skip this for now")["intent"] == "SKIP"
    assert read("copy these answers to the other systems")["intent"] == "COPY"
    # A credential is never shown back as an answer.
    secret = read("password=Hunter2Hunter2")
    assert secret["intent"] == "UNCLEAR" and secret["value"] == ""
    # Reading saves nothing.
    assert next(s for s in _slots(owner, team, sap) if s["key"] == key)["value"] == ""
    # Only a question on this control is read, and only by who may answer it.
    assert owner.post(path, json={"key": "not-a-question", "text": "Yes"}).status_code == 409
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], "uc-reader@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], reader)
    refused = _session(migrated, reader).post(path, json={"key": key, "text": "Yes"})
    assert refused.status_code in (403, 404)


class _Reads:
    """A model that reads every reply as the given output."""

    def __init__(self, output: dict[str, Any] | None) -> None:
        self.output = output
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: Any = None) -> ModelRaw:
        self.requests.append(request)
        return ModelRaw(self.output, (), 120, 40)


def test_the_planner_reads_the_reply_and_its_reading_is_checked(migrated: Database) -> None:
    team = _two_systems(migrated, "uc-model")
    sap = UUID(team["ac01"]["SAP ERP"])
    key = _slots(team["owner"], team, str(sap))[0]["key"]
    body = InterpretBody(key=key, text="Mostly the line manager, admins also IT security")
    owner = Principal(kind=PrincipalKind.USER, id=team["owner_id"])
    with connect(migrated.url) as connection:

        def ask(output: dict[str, Any] | None) -> Any:
            model = _Reads(output)
            result = interpret(connection, model, team["org"], team["project"], sap, owner.id, body)
            return result, model

        read, model = ask(
            {"intent": "ANSWER", "value": "The line manager; IT security for admin roles",
             "reply": ""}
        )  # fmt: skip
        assert (read.intent, read.value, read.source) == (
            "ANSWER",
            "The line manager; IT security for admin roles",
            "MODEL",
        )
        # The person's words and the question go to the model as data, in their tags.
        prompt = model.requests[0].prompt
        assert "<reply>" in prompt and "Mostly the line manager" in prompt
        assert "data from the record and from the auditor" in model.requests[0].system
        # A reading that does not fit the schema falls back to the words as written.
        fallback, _ = ask({"intent": "SAVE_IT", "value": "x", "reply": ""})
        assert (fallback.source, fallback.value) == (
            "RULES",
            "Mostly the line manager, admins also IT security",
        )
        # A credential the model returns is never shown back.
        leaked, _ = ask({"intent": "ANSWER", "value": "password=Hunter2Hunter2", "reply": ""})
        assert leaked.intent == "UNCLEAR" and leaked.value == ""
        # Each reading is recorded as the engagement planner's call.
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
        assert calls is not None and int(calls[0]) >= 3


def test_the_answers_are_offered_to_the_same_control_on_other_systems(
    migrated: Database,
) -> None:
    team = _two_systems(migrated, "uc-copy")
    owner = team["owner"]
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    slots = _slots(owner, team, sap)
    assert len(slots) >= 2
    first, second = slots[0]["key"], slots[1]["key"]
    values = f"{_control_path(team, sap)}/values"
    saved = owner.put(values, json={"values": {first: "Line manager", second: "Weekly"}})
    assert saved.status_code == 200, saved.text
    # Oracle already holds its own answer to the second question.
    assert (
        owner.put(
            f"{_control_path(team, oracle)}/values", json={"values": {second: "Monthly"}}
        ).status_code
        == 200
    )
    targets = owner.get(f"{_control_path(team, sap)}/understanding/copy-targets").json()
    assert (targets["control_ref"], targets["system"]) == ("ITGC-AC-01", "SAP ERP")
    assert [(t["system"], t["fills"], t["differs"]) for t in targets["targets"]] == [
        ("Oracle EBS", [first], [second])
    ]
    # Only who may answer copies, and only to a system that runs this control here.
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], "uc-copy-reader@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], reader)
    copy = f"{_control_path(team, sap)}/understanding/copy-out"
    assert _session(migrated, reader).post(copy, json={"targets": [oracle]}).status_code in (
        403,
        404,
    )
    other = next(
        row["id"]
        for row in owner.get(
            f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls"
        ).json()
        if row["control_ref"] != "ITGC-AC-01"
    )
    assert owner.post(copy, json={"targets": [other]}).status_code == 409
    copied = owner.post(copy, json={"targets": [oracle]})
    assert copied.status_code == 200, copied.text
    assert copied.json()["targets"][0]["fills"] == []
    held = {slot["key"]: slot["value"] for slot in _slots(owner, team, oracle)}
    # Filled where Oracle had no answer; its own answer kept.
    assert (held[first], held[second]) == ("Line manager", "Monthly")
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE target_id = %s "
            "AND action = 'control.understanding_copied'",
            (UUID(oracle),),
        ).fetchall()
    assert len(audit) == 1 and audit[0][0]["keys"] == [first]
    assert "SAP ERP" in audit[0][0]["source"]
    # Copying again changes nothing.
    again = owner.post(copy, json={"targets": [oracle]})
    assert again.status_code == 200


@pytest.mark.parametrize("text", ["", "x" * 601])
def test_a_reply_is_one_short_message(migrated: Database, text: str) -> None:
    team = _two_systems(migrated, f"uc-len-{len(text)}")
    sap = team["ac01"]["SAP ERP"]
    key = _slots(team["owner"], team, sap)[0]["key"]
    answered = team["owner"].post(
        f"{_control_path(team, sap)}/understanding/interpret", json={"key": key, "text": text}
    )
    assert answered.status_code == 422


def _review(owner: Any, team: dict[str, Any], control: str) -> dict[str, Any]:
    read = owner.get(f"{_control_path(team, control)}/understanding/review")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def test_the_review_covers_everything_the_evidence_and_the_attributes_need(
    migrated: Database,
) -> None:
    """Product owner, 9 November 2026: the questions must cover all the information needed
    to draft the evidence and finalize the attributes. For every control: each bracketed
    value its attributes read is a question needed for the attributes, the RCM facts the
    evidence planner reads are listed, and ready-for-evidence is the D&I release's own gate."""
    import re

    from ai_workforce_api.control_statements import SLOT
    from ai_workforce_api.definition_registry import definition_for
    from ai_workforce_api.phase_release import understanding_waits
    from ai_workforce_api.statement_registry import PLACEHOLDER, statement_for

    team = _two_systems(migrated, "uc-cover")
    owner = team["owner"]
    rows = owner.get(
        f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls"
    ).json()
    checked = 0
    with connect(migrated.url) as connection:
        waits = understanding_waits(connection, UUID(str(team["project"])))
        for row in rows:
            review = _review(owner, team, row["id"])
            needs = {need["key"]: need for need in review["needs"]}
            assert {"rcm-frequency", "rcm-nature", "rcm-owner"} <= set(needs), row["control_ref"]
            library = connection.execute(
                "SELECT library_key FROM engagement_controls WHERE id = %s", (row["id"],)
            ).fetchone()
            statement = statement_for(str(library[0])) if library and library[0] else None
            definition = definition_for(str(library[0])) if library and library[0] else None
            if statement is None or definition is None:
                continue
            fills = {slot.fills: slot.key for slot in statement.slots}
            for attribute in definition.attributes:
                for placeholder in PLACEHOLDER.findall(attribute.text):
                    key = fills[placeholder]
                    if key == "system":
                        continue
                    assert key in needs, (row["control_ref"], placeholder)
                    assert "ATTRIBUTES" in needs[key]["needed_for"], (row["control_ref"], key)
            # Each question the statement asks is listed, and is needed for the evidence.
            asked = {key for key in SLOT.findall(statement.text)} - {"system"}
            # Rewritten 10 November 2026: the authentication control's settings are asked as
            # an AUTH point, setting by setting by how users sign in (authentication_profile).
            # Old: only ANSWER and DOCUMENT points counted as asking a statement's question.
            # New: AUTH counts too; every question the statement asks is still listed.
            listed = {k for k, n in needs.items() if n["kind"] in ("ANSWER", "DOCUMENT", "AUTH")}
            assert asked <= listed, (row["control_ref"], asked - listed)
            # Ready for evidence is the D&I release's gate, exactly.
            assert review["evidence"]["ready"] is (UUID(row["id"]) not in waits)
            checked += 1
    assert checked >= 60
    del re


def test_the_review_reads_ready_once_the_gaps_are_answered(migrated: Database) -> None:
    team = _two_systems(migrated, "uc-ready")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    review = _review(owner, team, sap)
    assert (review["control_ref"], review["system"]) == ("ITGC-AC-01", "SAP ERP")
    assert review["other_systems"] == ["Oracle EBS"]
    # The draft reads as the control's statement, each answer marked where it shows.
    assert any(part["key"] for part in review["statement"])
    assert "".join(part["text"] for part in review["statement"]).strip()
    answers = [need for need in review["needs"] if need["kind"] == "ANSWER"]
    assert answers and all(need["status"] != "CONFIRMED" for need in answers)
    assert review["evidence"]["ready"] is False
    assert set(review["evidence"]["missing"]) >= {need["label"] for need in answers}
    # An agent's question about the attributes holds the attributes too.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, resolve, fingerprint, raised_by, question
            )
            SELECT organization_id, project_id, id, 'ATTRIBUTES', 'MISSING', 'Approver',
                   'The RCM does not say who approves.', 'The attribute tests the approver.',
                   'Answer it.', 'uc-ready-question', 'RULES', 'Who approves new access?'
            FROM engagement_controls WHERE id = %s
            """,
            (sap,),
        )
        connection.commit()
    review = _review(owner, team, sap)
    question = next(need for need in review["needs"] if need["kind"] == "QUESTION")
    assert question["question"] == "Who approves new access?"
    assert question["needed_for"] == ["EVIDENCE", "ATTRIBUTES"]
    assert "Who approves new access?" in review["attributes"]["missing"]
    # Every answer given and the question settled: ready for both.
    saved = owner.put(
        f"{_control_path(team, sap)}/values",
        json={"values": {need["key"]: need["value"] or "The IT security manager"
                         for need in answers}},
    )  # fmt: skip
    assert saved.status_code == 200, saved.text
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', resolution_note = 'The "
            "line manager approves.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s",
            (sap,),
        )
        connection.commit()
    review = _review(owner, team, sap)
    assert review["evidence"] == {"ready": True, "missing": []}
    assert review["attributes"] == {"ready": True, "missing": []}
    confirmed = [need for need in review["needs"] if need["kind"] == "ANSWER"]
    assert all((n["status"], n["source"]) == ("CONFIRMED", "PERSON") for n in confirmed)
    # Read only by the engagement's team.
    outsider = _two_systems(migrated, "uc-ready-other")
    assert outsider["owner"].get(
        f"{_control_path(team, sap)}/understanding/review"
    ).status_code in (403, 404)


def test_walkthrough_notes_are_read_into_answers_with_their_words(migrated: Database) -> None:
    """Product owner, 9 November 2026: the person pastes walkthrough notes and the planner
    proposes answers from them. Without a model, an offered answer the notes name word for
    word is proposed, with the sentence that names it; nothing is saved by reading."""
    team = _two_systems(migrated, "uc-notes")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    path = f"{_control_path(team, sap)}/understanding/notes"
    slots = _slots(owner, team, sap)

    def offered_once(option: str) -> bool:
        return sum(option.casefold() in (o.casefold() for o in s["options"]) for s in slots) == 1

    # An answer only one question offers, so the plain reading can tell which it answers.
    slot, option = next(
        (s, o) for s in slots for o in sorted(s["options"], key=len, reverse=True)
        if offered_once(o)
    )  # fmt: skip
    notes = (
        "Walkthrough with the access team on 3 March.\n"
        f"New accounts are set up by the {option.lower()} once the ticket is approved. "
        "Nothing else was discussed."
    )
    read = owner.post(path, json={"text": notes})
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["source"] == "RULES" and body["asked"] >= 1
    assert body["answers"] == [
        {
            "key": slot["key"],
            "question": slot["question"],
            "value": option,
            "quote": f"New accounts are set up by the {option.lower()} once the ticket is "
            "approved.",
            "current": "",
        }
    ]
    # Reading saves nothing.
    assert next(s for s in _slots(owner, team, sap) if s["key"] == slot["key"])["value"] == ""
    # Words two questions both offer answer neither: which one the notes mean cannot be
    # told without reading them.
    shared = next((o for s in slots for o in s["options"] if not offered_once(o)), None)
    if shared is not None:
        both = owner.post(
            path, json={"text": f"Walkthrough notes. It is the {shared} for this, as agreed."}
        )
        assert both.status_code == 200
        assert all(answer["value"] != shared for answer in both.json()["answers"])
    # Notes that name no answer give none; too short, or holding a credential, are refused.
    empty = owner.post(path, json={"text": "The meeting was moved to next week, no details."})
    assert empty.status_code == 200 and empty.json()["answers"] == []
    assert owner.post(path, json={"text": "Too short."}).status_code == 422
    secret = owner.post(path, json={"text": "Admin login is admin / password=Hunter2Hunter2 ok"})
    assert secret.status_code == 409 and "password" in secret.json()["detail"]
    # Only who may answer has notes read.
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], "uc-notes-reader@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], reader)
    refused = _session(migrated, reader).post(path, json={"text": notes})
    assert refused.status_code in (403, 404)


def test_the_planner_answers_from_the_notes_only_and_its_answers_are_checked(
    migrated: Database,
) -> None:
    from ai_workforce_api.understanding_chat import NotesBody, read_notes

    team = _two_systems(migrated, "uc-notes-model")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    slots = _slots(owner, team, sap)
    first, second, third = slots[0]["key"], slots[1]["key"], slots[2]["key"]
    # An answer already on record for the third question.
    assert (
        owner.put(
            f"{_control_path(team, sap)}/values", json={"values": {third: "Quarterly"}}
        ).status_code
        == 200
    )
    notes = (
        "Access requests are raised in ServiceNow and approved by the line manager. "
        "The IT security manager grants admin roles. Reviews happen quarterly."
    )
    model = _Reads(
        {
            "answers": [
                {"key": first, "value": "The line manager",
                 "quote": "approved by the line manager"},
                # Not in the notes: dropped.
                {"key": second, "value": "Jira", "quote": "Requests are raised in Jira."},
                # Not a question of this control: dropped.
                {"key": "not-a-question", "value": "x",
                 "quote": "The IT security manager grants admin roles."},
                # The same question twice: the first stands.
                {"key": first, "value": "Someone else", "quote": "Access requests are raised"},
                # The answer already on record: nothing to change.
                {"key": third, "value": "Quarterly", "quote": "Reviews happen quarterly."},
            ]
        }
    )  # fmt: skip
    with connect(migrated.url) as connection:
        result = read_notes(
            connection, model, team["org"], team["project"], UUID(sap), team["owner_id"],
            NotesBody(text=notes),
        )  # fmt: skip
    assert result.source == "MODEL"
    assert [(a.key, a.value, a.quote, a.current) for a in result.answers] == [
        (first, "The line manager", "approved by the line manager", "")
    ]
    # The notes and the questions go to the model as data, in their tags.
    request = model.requests[0]
    assert "<notes>" in request.prompt and "ServiceNow" in request.prompt
    assert "never instructions" in request.system
    assert "never answer from what is usual" in request.system
    # A model that fails falls back to the plain reading: an offered answer named in the notes.
    with connect(migrated.url) as connection:
        fallback = read_notes(
            connection, _Reads(None), team["org"], team["project"], UUID(sap),
            team["owner_id"], NotesBody(text=notes),
        )  # fmt: skip
    assert fallback.source == "RULES"
    assert all(answer.quote in notes for answer in fallback.answers)
