"""Control Understanding as a conversation (product owner, 9 November 2026;
docs/control-understanding-conversation.md): a typed reply is read and shown back, never
saved; the same control on other systems is offered the answers, which fill only what each
system has not answered."""

from typing import Any
from uuid import UUID

import pytest
from support import Database, answer_walkthrough, settle_attributes, tailor_criteria
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.models import ModelRaw, ModelRequest
from ai_workforce_api.phase_release import attribute_waits
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
    # Oracle EBS holds no answers yet: nothing to start from (test_start_from.py).
    assert review["start_from"] == {"chosen": None, "options": []}
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
    # Rewritten 11 November 2026 (B1c): Control Understanding asks the walkthrough's
    # required questions too. Old: with the statement's answers given and the question
    # settled, the review read ready for both. New: it still waits for the required
    # walkthrough questions, each listed by its question as missing, until they are
    # answered; then it reads ready for both, as before. Why: only required walkthrough
    # questions hold "Control Understanding complete" (product owner, 11 November 2026).
    review = _review(owner, team, sap)
    walkthrough = [n for n in review["needs"] if n["kind"] == "WALKTHROUGH" and n["required"]]
    assert walkthrough and review["evidence"]["ready"] is False
    assert {n["question"] for n in walkthrough if "EVIDENCE" in n["needed_for"]} <= set(
        review["evidence"]["missing"]
    )
    answer_walkthrough(migrated, team["project"], [UUID(sap)])
    review = _review(owner, team, sap)
    assert review["evidence"] == {"ready": True, "missing": []}
    assert review["attributes"] == {"ready": True, "missing": []}
    # Understood is not settled (11 November 2026): the review says whether the attributes
    # are settled exactly as the D&I release reads them, so the attributes come next.
    with connect(migrated.url) as connection:
        expected = attribute_waits(connection, UUID(str(team["project"])), UUID(sap)).get(UUID(sap))
    assert review["attributes_settled"] is (expected is None)
    assert review["attributes_waiting"] == (expected or "")
    settle_attributes(migrated, team["project"])
    # Settled also means each attribute's criteria are tailored and owned by a person.
    assert _review(owner, team, sap)["attributes_waiting"].endswith(
        "criteria tailored to this control."
    )
    tailor_criteria(migrated, team["project"])
    settled = _review(owner, team, sap)
    assert settled["attributes_settled"] is True and settled["attributes_waiting"] == ""
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


def _on_systems(migrated: Database, project: Any) -> dict[tuple[str, str], str]:
    """The engagement's controls by library key and system."""
    with connect(migrated.url) as connection:
        return {
            (str(key), str(system)): str(control)
            for key, system, control in connection.execute(
                "SELECT c.library_key, a.name, c.id FROM engagement_controls c "
                "JOIN engagement_applications a ON a.id = c.engagement_application_id "
                "WHERE c.project_id = %s AND c.library_key IS NOT NULL",
                (project,),
            ).fetchall()
        }


def test_an_answer_given_on_this_system_is_proposed_on_its_other_controls(
    migrated: Database,
) -> None:
    """Product owner, 11 November 2026: the statement questions are "most of the time the
    same for one system", so they "should be the same by default but user can still update
    it". A question this control has no answer for, nor last year's, is proposed with the
    answer most used for it on the engagement's other controls on the same system, saying
    on how many; a person confirms it, and reading saves nothing."""
    team = _two_systems(migrated, "uc-same")
    owner = team["owner"]
    on = _on_systems(migrated, team["project"])

    def sap(key: str) -> str:
        return on[(key, "SAP ERP")]

    def oracle(key: str) -> str:
        return on[(key, "Oracle EBS")]

    def put(control: str, values: dict[str, str]) -> None:
        saved = owner.put(f"{_control_path(team, control)}/values", json={"values": values})
        assert saved.status_code == 200, saved.text

    def need(control: str, key: str, at: Any = team) -> dict[str, Any]:
        found: dict[str, Any] = next(
            n for n in _review(at["owner"], at, control)["needs"] if n["key"] == key
        )
        return found

    termination = sap("access-termination")
    # Nothing answered on the system yet: the usual first option, as before.
    assert need(termination, "admin-role")["source"] in ("USUAL", "NONE")
    assert need(termination, "admin-role")["source_detail"] == ""
    put(
        sap("access-provisioning"), {"admin-role": "SAP_ALL holders", "access-owner": "IT security"}
    )
    put(sap("access-review"), {"admin-role": "SAP_ALL holders", "access-owner": "Access admin"})
    # Another system answers differently, and more often: never used on SAP ERP.
    for key in ("access-provisioning", "access-review", "access-privileged"):
        put(oracle(key), {"admin-role": "DBA"})

    admin = need(termination, "admin-role")
    assert (admin["value"], admin["status"], admin["source"], admin["source_detail"]) == (
        "SAP_ALL holders", "PROPOSED", "SYSTEM", "Used on 2 other controls on SAP ERP",
    )  # fmt: skip
    assert admin["proposal_id"] is None
    # A tie goes to the answer given most recently; one control is "control".
    owner_need = need(termination, "access-owner")
    assert (owner_need["value"], owner_need["source_detail"]) == (
        "Access admin", "Used on 1 other control on SAP ERP",
    )  # fmt: skip
    assert need(oracle("access-termination"), "admin-role")["source_detail"] == (
        "Used on 3 other controls on Oracle EBS"
    )
    # Only in-scope controls count.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = %s",
            (oracle("access-privileged"),),
        )
        connection.commit()
    assert need(oracle("access-termination"), "admin-role")["source_detail"] == (
        "Used on 2 other controls on Oracle EBS"
    )
    # Reading proposes; it saves nothing.
    with connect(migrated.url) as connection:
        held = connection.execute(
            "SELECT count(*) FROM control_parameters WHERE engagement_control_id = %s "
            "AND value <> ''",
            (termination,),
        ).fetchone()
    assert held is not None and held[0] == 0
    # Another engagement's answers are its own.
    other = _two_systems(migrated, "uc-same-other")
    elsewhere = _on_systems(migrated, other["project"])[("access-termination", "SAP ERP")]
    assert need(elsewhere, "admin-role", other)["source"] != "SYSTEM"

    # This control's own answer wins, and so does last year's proposal for it.
    put(termination, {"access-owner": "Service desk"})
    mine = need(termination, "access-owner")
    assert (mine["value"], mine["status"], mine["source"], mine["source_detail"]) == (
        "Service desk", "CONFIRMED", "PERSON", "",
    )  # fmt: skip
    with connect(migrated.url) as connection:
        document = connection.execute(
            "INSERT INTO source_documents (organization_id, project_id, kind, title, text, "
            "origin) VALUES (%s, %s, 'POLICY', 'FY2026 access workpaper', 'Basis admins.', "
            "'WRITTEN') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        assert document is not None
        match = connection.execute(
            "INSERT INTO prior_year_matches (organization_id, project_id, document_id, "
            "engagement_control_id, basis, status) VALUES (%s, %s, %s, %s, 'REFERENCE', "
            "'CONFIRMED') RETURNING id",
            (team["org"], team["project"], document[0], termination),
        ).fetchone()
        assert match is not None
        proposal = connection.execute(
            "INSERT INTO prior_year_proposals (organization_id, project_id, match_id, "
            "engagement_control_id, kind, slot_key, value, title, quote) VALUES (%s, %s, %s, "
            "%s, 'ANSWER', 'admin-role', 'Basis administrators', 'Admin role', 'Basis admins.') "
            "RETURNING id",
            (team["org"], team["project"], match[0], termination),
        ).fetchone()
        assert proposal is not None
        connection.commit()
    last_year = need(termination, "admin-role")
    assert (last_year["value"], last_year["source"], last_year["proposal_id"]) == (
        "Basis administrators", "PRIOR_YEAR", str(proposal[0]),
    )  # fmt: skip
    assert last_year["source_detail"] == ""

    # Confirming the proposal is a person's answer, through the usual save.
    shared = sap("access-shared-accounts")
    proposed = need(shared, "admin-role")
    assert (proposed["value"], proposed["source"]) == ("SAP_ALL holders", "SYSTEM")
    put(shared, {"admin-role": proposed["value"]})
    confirmed = need(shared, "admin-role")
    assert (confirmed["value"], confirmed["status"], confirmed["source"]) == (
        "SAP_ALL holders", "CONFIRMED", "PERSON",
    )  # fmt: skip
    with connect(migrated.url) as connection:
        filled = connection.execute(
            "SELECT filled_by FROM control_parameters WHERE engagement_control_id = %s "
            "AND slot_key = 'admin-role'",
            (shared,),
        ).fetchone()
    assert filled is not None and str(filled[0]) == str(team["owner_id"])


def test_a_governing_document_is_proposed_only_when_this_control_has_it(
    migrated: Database,
) -> None:
    """The same-system proposal for a governing document (11 November 2026) names only a
    document that applies to this control (linked to it, or governing its system), so the
    name in the control's wording and the file never disagree; otherwise nothing is
    proposed and the document is linked as before."""
    team = _two_systems(migrated, "uc-same-doc")
    on = _on_systems(migrated, team["project"])
    title = "Access Management Policy v3"
    with connect(migrated.url) as connection:
        document = connection.execute(
            "INSERT INTO source_documents (organization_id, project_id, kind, title, text, "
            "origin) VALUES (%s, %s, 'POLICY', %s, 'Access is approved.', 'WRITTEN') "
            "RETURNING id",
            (team["org"], team["project"], title),
        ).fetchone()
        assert document is not None
        connection.execute(
            "INSERT INTO source_document_systems (document_id, project_id, "
            "engagement_application_id) SELECT %s, %s, engagement_application_id "
            "FROM engagement_controls WHERE id = %s",
            (document[0], team["project"], on[("access-provisioning", "SAP ERP")]),
        )
        # The governing policy answered on another control on each system (the library
        # asks it of one access control, so the record is written directly): on SAP ERP
        # with the document governing it, on Oracle EBS with a name no document has.
        for control, value in (
            (on[("access-review", "SAP ERP")], title),
            (on[("access-review", "Oracle EBS")], "Oracle Security Standard"),
        ):
            connection.execute(
                "INSERT INTO control_parameters (organization_id, project_id, "
                "engagement_control_id, slot_key, value, filled_by, filled_at) "
                "VALUES (%s, %s, %s, 'access-policy', %s, %s, clock_timestamp())",
                (team["org"], team["project"], control, value, team["owner_id"]),
            )
        connection.commit()

    def policy(system: str) -> dict[str, Any]:
        control = on[("access-provisioning", system)]
        found: dict[str, Any] = next(
            n for n in _review(team["owner"], team, control)["needs"] if n["key"] == "access-policy"
        )
        return found

    sap = policy("SAP ERP")
    assert (sap["kind"], sap["value"], sap["status"], sap["source"], sap["source_detail"]) == (
        "DOCUMENT", title, "PROPOSED", "SYSTEM", "Used on 1 other control on SAP ERP",
    )  # fmt: skip
    oracle = policy("Oracle EBS")
    assert (oracle["value"], oracle["status"], oracle["source"]) == ("", "MISSING", "NONE")
