"""The agent console: questions, routine tools, proposed steps, and confirmation."""

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_review import _base, _client, _sent_engagement_request
from test_execution import _add_project_member, _add_user
from test_outbound import migrated

from ai_workforce_api import console
from ai_workforce_api.console import run_turn
from ai_workforce_api.console_tools import BY_NAME, TOOLS, parse
from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.db import connect
from ai_workforce_api.models import ChatReply, ChatTool, ModelProviderError, ToolCall
from ai_workforce_api.settings import Settings

_ = migrated


class _Script:
    """A stand-in for the model: it plays scripted replies and records what it saw."""

    def __init__(self, replies: list[ChatReply | Exception]) -> None:
        self.replies = replies
        self.seen: list[list[dict[str, Any]]] = []
        self.systems: list[str] = []

    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
    ) -> ChatReply:
        del timeout_seconds
        assert {tool.name for tool in tools} == set(BY_NAME)
        self.systems.append(system)
        self.seen.append([dict(message) for message in messages])
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def _call(name: str, **arguments: Any) -> ToolCall:
    return ToolCall(id=f"call-{uuid4().hex[:8]}", name=name, arguments=arguments)


def _reply(text: str = "", *calls: ToolCall) -> ChatReply:
    return ChatReply(text=text, tool_calls=tuple(calls), input_tokens=500, output_tokens=80)


def test_every_tool_is_registered_with_a_schema_and_a_risk() -> None:
    assert len(TOOLS) == len(BY_NAME)
    for tool in TOOLS:
        chat = tool.chat_tool()
        assert chat.input_schema["type"] == "object"
        assert tool.risk in {"READ", "ROUTINE", "CONFIRM"}
    sensitive = {
        "submit_request",
        "send_request",
        "decide_approval",
        "approve_samples",
        "replace_sample",
        "confirm_evidence_kind",
        "sign_off_review",
        "decide_review_note",
        "raise_review_note",
        "respond_review_note",
        "clear_review_note",
        "sign_off_control_review",
        "log_deficiency",
        "update_phase",
        "update_milestone",
        "edit_request",
        "draft_request",
        "update_request_status",
        # Testing (8.2): results, links, sign-off, and deficiencies are a person's call.
        "override_test_result",
        "link_test_evidence",
        "sign_off_testing",
        "decide_test_deficiency",
    }
    assert {tool.name for tool in TOOLS if tool.risk == "CONFIRM"} == sensitive
    assert {tool.name for tool in TOOLS if tool.risk == "ROUTINE"} == {
        "redraft_request",
        "reread_evidence",
        "reperform_review",
        "propose_samples",
        "retest_control",
        "draft_workpapers",
        # A file of what was shown (8.20), or a report (8.21): neither changes any records.
        "export_records",
        "generate_report",
    }
    # Questions about the engagement are answered by reads (8.20).
    assert {
        "engagement_status",
        "list_requests",
        "list_controls",
        "list_exceptions",
        "list_review_items",
    } <= {tool.name for tool in TOOLS if tool.risk == "READ"}


def test_the_agent_answers_a_question_from_the_records(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "ask", "ITGC-AC-01")
    message_id = _ask(client, team, "What does ITGC-AC-01 need, and what evidence do we have?")
    script = _Script(
        [
            _reply("", _call("get_control", control_ref="itgc-ac-01")),
            _reply("ITGC-AC-01 needs the new-user population. No files have arrived yet."),
        ]
    )
    with connect(migrated.url) as connection:
        assert _turn(connection, migrated, script, message_id) == "DONE"
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
    thread = _thread(client, team)
    agent = thread["messages"][-1]
    assert agent["role"] == "AGENT"
    assert agent["status"] == "DONE"
    assert agent["content"].startswith("ITGC-AC-01 needs")
    assert agent["actions"] == []
    assert calls == (2,)
    # The agent saw the control's real record in the tool result.
    second = script.seen[1]
    result = second[-1]["content"][0]
    assert result["type"] == "tool_result"
    # The control's first library attribute, in the words the answer quotes.
    first = next(c for c in LIBRARY if c.key == "access-provisioning").test_attributes[0]
    assert json.dumps(first)[1:40] in result["content"]
    assert "SOX 2027" in script.systems[0]
    # A question gets an answer, not unasked-for steps (evidence requests and the like).
    assert "A question (what, which, how, why, show me, is it) gets an answer" in script.systems[0]
    assert "propose no steps for it" in script.systems[0]
    assert "Be proactive" not in script.systems[0]


def test_routine_tools_run_and_sensitive_ones_wait_for_the_person(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "steps", "ITGC-AC-01")
    drafts = _draft_requests(migrated, team["project"])
    message_id = _ask(client, team, "Submit the first two drafted requests and redraft the third.")
    script = _Script(
        [
            _reply("", _call("list_requests", status="DRAFT")),
            _reply(
                "",
                _call("submit_request", request_id=drafts[0]),
                _call("submit_request", request_id=drafts[1]),
                _call("redraft_request", request_id=drafts[2]),
                _call("delete_everything"),
                _call("submit_request", request_id="not-a-uuid"),
            ),
            _reply("I proposed two submissions for you to confirm and redrafted the third."),
        ]
    )
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, message_id)
        statuses = _statuses(connection, drafts[:2])
    assert statuses == ["DRAFT", "DRAFT"]
    results = script.seen[2][-1]["content"]
    assert [item["is_error"] for item in results] == [False, False, False, True, True]
    assert "no tool called delete_everything" in results[3]["content"]
    agent = _thread(client, team)["messages"][-1]
    actions = agent["actions"]
    assert [(a["tool"], a["risk"], a["status"]) for a in actions] == [
        ("submit_request", "CONFIRM", "PROPOSED"),
        ("submit_request", "CONFIRM", "PROPOSED"),
        ("redraft_request", "ROUTINE", "DONE"),
    ]
    base = f"{_base(team['org'], team['project'])}/console"
    # Someone else on the engagement cannot run my steps.
    with connect(migrated.url) as connection:
        other_id = _add_user(connection, team["org"], f"o-{uuid4().hex[:6]}@example.com", "ADMIN")
    other = _client(migrated, other_id)
    assert other.post(f"{base}/actions/{actions[0]['id']}/confirm").status_code == 404
    confirmed = client.post(f"{base}/messages/{agent['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    done = confirmed.json()["messages"][-1]["actions"]
    assert [a["status"] for a in done] == ["DONE", "DONE", "DONE"]
    assert all(a["decided_by_name"] for a in done[:2])
    assert done[0]["result"]["status"] == "APPROVAL_PENDING"
    with connect(migrated.url) as connection:
        assert _statuses(connection, drafts[:2]) == ["APPROVAL_PENDING", "APPROVAL_PENDING"]
    again = client.post(f"{base}/actions/{actions[0]['id']}/confirm")
    assert again.status_code == 409
    audit = _audit(migrated)
    assert "console.step_confirmed" in audit
    assert "console.tool_ran" in audit


def test_a_step_can_be_cancelled_and_a_role_without_rights_fails_safely(
    migrated: Database,
) -> None:
    team, owner, _request = _sent_engagement_request(migrated, "cancel", "ITGC-AC-01")
    drafts = _draft_requests(migrated, team["project"])
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection, team["org"], f"r-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reviewer_id)
    reviewer = _client(migrated, reviewer_id)
    message_id = _ask(reviewer, team, "Submit two drafts.")
    script = _Script(
        [
            _reply(
                "",
                _call("submit_request", request_id=drafts[0]),
                _call("submit_request", request_id=drafts[1]),
            ),
            _reply("Proposed two submissions."),
        ]
    )
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, message_id)
    actions = _thread(reviewer, team)["messages"][-1]["actions"]
    base = f"{_base(team['org'], team['project'])}/console"
    cancelled = reviewer.post(f"{base}/actions/{actions[1]['id']}/cancel")
    assert cancelled.json()["messages"][-1]["actions"][1]["status"] == "CANCELLED"
    ran = reviewer.post(f"{base}/actions/{actions[0]['id']}/confirm").json()
    step = ran["messages"][-1]["actions"][0]
    assert step["status"] == "FAILED"
    assert step["error"] == "Your role does not allow this."
    with connect(migrated.url) as connection:
        assert _statuses(connection, drafts[:2]) == ["DRAFT", "DRAFT"]
    # The owner's console is separate from the reviewer's.
    assert _thread(owner, team)["messages"] == []


def test_without_a_model_the_agent_says_so(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "nomodel", "ITGC-AC-01")
    message_id = _ask(client, team, "What's overdue?")
    busy = client.post(
        f"{_base(team['org'], team['project'])}/console/messages", json={"text": "And now?"}
    )
    assert busy.status_code == 409
    with connect(migrated.url) as connection:
        assert run_turn(connection, Settings(database_url=migrated.url), None, message_id) == "DONE"
        assert run_turn(connection, Settings(database_url=migrated.url), None, message_id) == (
            "SKIPPED"
        )
    agent = _thread(client, team)["messages"][-1]
    assert "assistant is not available" in agent["content"]
    assert _thread(client, team)["model_configured"] is False


def test_the_inbox_lists_what_waits_on_the_person(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "inbox", "ITGC-AC-01")
    inbox = client.get(f"{_base(team['org'], team['project'])}/console/inbox")
    assert inbox.status_code == 200
    kinds = [item["kind"] for item in inbox.json()["waiting"]]
    assert "drafts" in kinds
    assert isinstance(inbox.json()["activity"], list)


def test_arguments_are_checked_before_anything_runs() -> None:
    tool, parsed = parse("replace_sample", {
        "control_ref": "AC-01", "position": 2, "row_number": 9,
        "selection": "TARGETED", "reason": "Admin role",
    })  # fmt: skip
    assert tool.risk == "CONFIRM"
    assert "row 9" in tool.summary(parsed)
    for bad in (
        {"control_ref": "AC-01", "position": 0, "row_number": 9, "selection": "TARGETED",
         "reason": "x" * 5},
        {"control_ref": "AC-01", "position": 1, "row_number": 9, "selection": "RANDOM",
         "reason": "Because"},
    ):  # fmt: skip
        try:
            parse("replace_sample", bad)
        except Exception as error:
            assert "not valid" in str(error)
        else:
            raise AssertionError("bad arguments were accepted")


def test_earlier_conversations_stay_available(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "history", "ITGC-AC-01")
    base = f"{_base(team['org'], team['project'])}/console"
    first = _ask(client, team, "First question about AC-01")
    with connect(migrated.url) as connection:
        _turn(connection, migrated, _Script([_reply("First answer.")]), first)
    first_thread = _thread(client, team)["id"]
    fresh = client.post(f"{base}/threads").json()
    assert fresh["id"] != first_thread
    assert fresh["messages"] == []
    # Clicking again reuses the empty conversation instead of adding another.
    assert client.post(f"{base}/threads").json()["id"] == fresh["id"]
    second = client.post(
        f"{base}/messages", json={"text": "Second topic", "thread_id": fresh["id"]}
    )
    assert second.status_code == 200
    listed = client.get(f"{base}/threads").json()
    assert [item["title"] for item in listed] == ["Second topic", "First question about AC-01"]
    opened = client.get(base, params={"thread_id": first_thread}).json()
    assert opened["title"] == "First question about AC-01"
    assert [m["content"] for m in opened["messages"]] == [
        "First question about AC-01",
        "First answer.",
    ]
    with connect(migrated.url) as connection:
        other_id = _add_user(connection, team["org"], f"h-{uuid4().hex[:6]}@example.com", "ADMIN")
    other = _client(migrated, other_id)
    assert other.get(base, params={"thread_id": first_thread}).status_code == 404
    assert other.get(f"{base}/threads").json() == []


def test_the_agent_can_reword_draft_and_close_requests_once_confirmed(
    migrated: Database,
) -> None:
    team, client, request = _sent_engagement_request(migrated, "requests", "ITGC-AC-01")
    drafts = _draft_requests(migrated, team["project"])
    message_id = _ask(client, team, "Add my questions to a draft, ask Dana a follow-up, close one.")
    wording = "Please send the user listing with the source report name and run date."
    script = _Script(
        [
            _reply(
                "",
                _call("edit_request", request_id=drafts[0], description=wording),
                _call(
                    "draft_request",
                    control_ref="ITGC-AC-01",
                    description="Please explain the two rows dated outside the audit period.",
                ),
                _call("update_request_status", request_id=drafts[1], status="CANCELLED"),
            ),
            _reply("I proposed three steps."),
        ]
    )
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, message_id)
    agent = _thread(client, team)["messages"][-1]
    assert [a["status"] for a in agent["actions"]] == ["PROPOSED"] * 3
    assert "ITGC-AC-01" in agent["actions"][1]["summary"]
    ran = client.post(
        f"{_base(team['org'], team['project'])}/console/messages/{agent['id']}/confirm"
    ).json()["messages"][-1]["actions"]
    assert [a["status"] for a in ran[:2]] == ["DONE", "DONE"], ran
    # A cancellation without a reason is refused, so the last step fails safely.
    assert ran[2]["status"] == "FAILED"
    assert "reason" in ran[2]["error"]
    with connect(migrated.url) as connection:
        edited = connection.execute(
            "SELECT evidence_description, status FROM pbc_requests WHERE id = %s", (drafts[0],)
        ).fetchone()
        new = connection.execute(
            "SELECT status, recipient, engagement_control_id IS NOT NULL FROM pbc_requests "
            "WHERE project_id = %s AND operation_key LIKE 'console-%%'",
            (team["project"],),
        ).fetchone()
    assert edited == (wording, "DRAFT")
    assert new == ("DRAFT", request["recipient"], True)


def test_a_sent_request_is_marked_received_once_confirmed(migrated: Database) -> None:
    from test_inbound import _sent_request

    seeded, project_id, owner, sent = _sent_request(migrated, "received")
    team = {"org": seeded["organization_id"], "project": project_id}
    message_id = _ask(owner, team, "Dana sent everything for that request. Mark it received.")
    script = _Script(
        [
            _reply("", _call("update_request_status", request_id=sent["id"], status="RECEIVED")),
            _reply("I proposed marking it received."),
        ]
    )
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, message_id)
        assert _statuses(connection, [sent["id"]]) == ["SENT"]
    agent = _thread(owner, team)["messages"][-1]
    done = owner.post(
        f"{_base(team['org'], team['project'])}/console/messages/{agent['id']}/confirm"
    ).json()["messages"][-1]["actions"][0]
    assert done["status"] == "DONE", done["error"]
    with connect(migrated.url) as connection:
        assert _statuses(connection, [sent["id"]]) == ["RECEIVED"]


# Helpers


def _busy() -> ModelProviderError:
    return ModelProviderError(transient=True, status=529)


def test_a_busy_model_is_tried_again_before_the_turn_gives_up(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    waits: list[float] = []
    monkeypatch.setattr(console, "pause", waits.append)
    team, client, _request = _sent_engagement_request(migrated, "busy", "ITGC-AC-01")
    recovered = _ask(client, team, "Where is ITGC-AC-01?")
    with connect(migrated.url) as connection:
        script = _Script([_busy(), _reply("It is waiting on the owner.")])
        assert _turn(connection, migrated, script, recovered) == "DONE"
    assert waits == [2.0]
    assert _thread(client, team)["messages"][-1]["content"] == "It is waiting on the owner."
    # A request the provider rejects is not sent again.
    waits.clear()
    rejected = _ask(client, team, "And ITGC-AC-02?")
    with connect(migrated.url) as connection:
        script = _Script([ModelProviderError(transient=False, status=400)])
        assert _turn(connection, migrated, script, rejected) == "FAILED"
    assert waits == []
    rejected_note = _thread(client, team)["messages"][-1]["note"]
    assert rejected_note == "The model could not take the request."


def test_a_failed_answer_can_be_retried_in_place(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    waits: list[float] = []
    monkeypatch.setattr(console, "pause", waits.append)
    team, client, _request = _sent_engagement_request(migrated, "retry", "ITGC-AC-01")
    base = f"{_base(team['org'], team['project'])}/console"
    message_id = _ask(client, team, "What is missing for ITGC-AC-01?")
    with connect(migrated.url) as connection:
        script = _Script([_busy(), _busy(), _busy()])
        assert _turn(connection, migrated, script, message_id) == "FAILED"
        failures = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s AND status = 'MODEL_ERROR'",
            (team["project"],),
        ).fetchone()
    assert waits == [2.0, 6.0]
    assert failures == (3,)
    failed = _thread(client, team)["messages"]
    assert failed[-1]["status"] == "FAILED"
    assert failed[-1]["can_retry"] is True
    assert failed[0]["can_retry"] is False
    assert "nothing was done" in failed[-1]["content"]
    assert failed[-1]["note"] == "The model was busy and did not answer after 3 tries."
    # Only the person who asked can retry it.
    with connect(migrated.url) as connection:
        other_id = _add_user(connection, team["org"], f"r-{uuid4().hex[:6]}@example.com", "ADMIN")
    other = _client(migrated, other_id)
    assert other.post(f"{base}/messages/{message_id}/retry").status_code == 404
    retried = client.post(f"{base}/messages/{message_id}/retry")
    assert retried.status_code == 200, retried.text
    messages = retried.json()["messages"]
    assert len(messages) == 2
    assert messages[-1]["id"] == str(message_id)
    assert messages[-1]["status"] == "PENDING"
    assert messages[-1]["content"] == ""
    # A turn that is already running cannot be retried again.
    assert client.post(f"{base}/messages/{message_id}/retry").status_code == 409
    with connect(migrated.url) as connection:
        script = _Script([_reply("The population is still missing.")])
        assert _turn(connection, migrated, script, message_id) == "DONE"
    # The failed attempt is not part of what the agent sees.
    assert [m["role"] for m in script.seen[0]] == ["user"]
    assert _thread(client, team)["messages"][-1]["content"] == "The population is still missing."


def test_retrying_an_answer_with_steps_keeps_the_record(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "again", "ITGC-AC-01")
    base = f"{_base(team['org'], team['project'])}/console"
    drafts = _draft_requests(migrated, team["project"])
    message_id = _ask(client, team, "Submit the first drafted request.")
    with connect(migrated.url) as connection:
        script = _Script(
            [
                _reply("", _call("submit_request", request_id=drafts[0])),
                _reply("I proposed the submission."),
            ]
        )
        _turn(connection, migrated, script, message_id)
    first = _thread(client, team)["messages"][-1]
    assert first["actions"][0]["status"] == "PROPOSED"
    retried = client.post(f"{base}/messages/{message_id}/retry")
    assert retried.status_code == 200, retried.text
    messages = retried.json()["messages"]
    assert len(messages) == 3
    assert messages[1]["id"] == str(message_id)
    assert messages[1]["actions"][0]["status"] == "CANCELLED"
    assert messages[1]["can_retry"] is False
    assert messages[2]["status"] == "PENDING"
    # The cancelled step cannot be confirmed afterwards.
    stale = client.post(f"{base}/actions/{first['actions'][0]['id']}/confirm")
    assert stale.status_code == 409
    # An earlier answer cannot be retried once a newer one exists.
    assert client.post(f"{base}/messages/{message_id}/retry").status_code == 409
    with connect(migrated.url) as connection:
        script = _Script([_reply("Done thinking again.")])
        _turn(connection, migrated, script, UUID(messages[2]["id"]))
        assert _statuses(connection, drafts[:1]) == ["DRAFT"]
    # The replaced answer is left out of what the agent sees.
    assert [m["role"] for m in script.seen[0]] == ["user"]


class _Streamer(_Script):
    """A model that writes its replies a piece at a time, and looks at the conversation
    through the API after each piece, as the chat would while it waits."""

    def __init__(
        self,
        replies: list[ChatReply | Exception],
        pieces: list[list[str]],
        look: Any,
    ) -> None:
        super().__init__(replies)
        self.pieces = pieces
        self.look = look
        self.views: list[tuple[str, str]] = []

    def converse_streaming(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
        on_text: Any,
    ) -> ChatReply:
        for piece in self.pieces.pop(0):
            on_text(piece)
            latest = self.look()["messages"][-1]
            self.views.append((latest["status"], latest["content"]))
        return self.converse(system, messages, tools, timeout_seconds)


def test_the_answer_shows_as_the_agent_writes_it(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(console, "LIVE_SECONDS", 0.0)
    team, client, _request = _sent_engagement_request(migrated, "stream", "ITGC-AC-01")
    message_id = _ask(client, team, "What does ITGC-AC-01 need?")
    unchecked = '[cite:00000000-0000-7000-8000-000000000000 "the new-user population"]'
    script = _Streamer(
        [
            _reply("Let me open it.", _call("get_control", control_ref="itgc-ac-01")),
            _reply(f"It needs the population {unchecked}. Nothing has arrived."),
        ],
        [
            ["Let me ", "open it."],
            [
                "It needs ",
                "the population ",
                unchecked[:20],
                unchecked[20:],
                ". Nothing has arrived.",
            ],
        ],
        lambda: _thread(client, team),
    )
    with connect(migrated.url) as connection:
        assert _turn(connection, migrated, script, message_id) == "DONE"
    statuses = {status for status, _content in script.views}
    shown = [content for _status, content in script.views]
    # The person sees the answer grow while the agent is still working on it.
    assert statuses == {"WORKING"}
    assert shown[:2] == ["Let me", "Let me open it."]
    # The second reply carries on from the first, as a new paragraph.
    assert shown[2] == "Let me open it.\n\nIt needs"
    assert shown[3] == "Let me open it.\n\nIt needs the population"
    # A citation is never shown before it is checked, whole or half written.
    assert all("cite" not in content and "0000" not in content for content in shown)
    assert shown[-1] == "Let me open it.\n\nIt needs the population. Nothing has arrived."
    # The finished answer replaces the draft; the unsupported citation is gone.
    final = _thread(client, team)["messages"][-1]
    assert final["status"] == "DONE"
    assert final["content"].startswith("Let me open it.\n\nIt needs the population")
    assert "cite" not in final["content"]


def test_words_from_an_attempt_that_broke_off_are_taken_back(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(console, "LIVE_SECONDS", 0.0)
    team, client, _request = _sent_engagement_request(migrated, "broke", "ITGC-AC-01")
    message_id = _ask(client, team, "Where is ITGC-AC-01?")
    during_wait: list[str] = []
    monkeypatch.setattr(
        console,
        "pause",
        lambda _s: during_wait.append(_thread(client, team)["messages"][-1]["content"]),
    )
    script = _Streamer(
        [_busy(), _reply("It is waiting on the owner.")],
        [["It is waiting on"], ["It is waiting ", "on the owner."]],
        lambda: _thread(client, team),
    )
    with connect(migrated.url) as connection:
        assert _turn(connection, migrated, script, message_id) == "DONE"
    assert script.views[0] == ("WORKING", "It is waiting on")
    # While the turn waits to try again, the broken-off words are no longer shown.
    assert during_wait == [""]
    assert _thread(client, team)["messages"][-1]["content"] == "It is waiting on the owner."


def test_a_turn_picked_up_again_starts_from_a_clean_page(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "again2", "ITGC-AC-01")
    message_id = _ask(client, team, "Where is ITGC-AC-01?")
    with connect(migrated.url) as connection:
        # A worker that stopped part way left half an answer and an expired claim.
        connection.execute(
            "UPDATE console_messages SET status = 'WORKING', content = 'Half an ans', "
            "lease_until = clock_timestamp() - interval '1 minute' WHERE id = %s",
            (message_id,),
        )
        connection.commit()
        seen: list[str] = []

        class _Look(_Script):
            def converse(self, *args: Any, **kwargs: Any) -> ChatReply:
                seen.append(_thread(client, team)["messages"][-1]["content"])
                return super().converse(*args, **kwargs)

        assert (
            _turn(connection, migrated, _Look([_reply("It is with the owner.")]), message_id)
            == "DONE"
        )
    assert seen == [""]
    assert _thread(client, team)["messages"][-1]["content"] == "It is with the owner."


def test_a_step_that_would_fail_is_not_proposed_and_the_agent_hears_why(
    migrated: Database,
) -> None:
    team, client, _request = _sent_engagement_request(migrated, "wouldfail", "ITGC-AC-01")
    blank, long = _draft_requests(migrated, team["project"])[:2]
    with connect(migrated.url) as connection:
        connection.execute("UPDATE pbc_requests SET recipient = '' WHERE id = %s", (blank,))
        connection.execute(
            "UPDATE pbc_requests SET evidence_description = %s WHERE id = %s", ("x" * 3500, long)
        )
        connection.commit()
    message_id = _ask(client, team, "Submit those two drafts.")
    script = _Script(
        [
            _reply(
                "",
                _call("submit_request", request_id=blank),
                _call("submit_request", request_id=long),
            ),
            _reply("Neither can be submitted yet."),
        ]
    )
    with connect(migrated.url) as connection:
        assert _turn(connection, migrated, script, message_id) == "DONE"
    results = script.seen[1][-1]["content"]
    assert [item["is_error"] for item in results] == [True, True]
    assert "has no recipient. Set the owner's email address first." in results[0]["content"]
    assert (
        "too long to send: its wording is 3,500 characters and can be at most"
        in (results[1]["content"])
    )
    assert results[0]["content"].startswith("Not proposed, because it would fail:")
    # Nothing is offered that could not run.
    assert _thread(client, team)["messages"][-1]["actions"] == []


def test_a_plan_can_fix_a_request_and_then_submit_it(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "fixplan", "ITGC-AC-01")
    base = f"{_base(team['org'], team['project'])}/console"
    draft = _draft_requests(migrated, team["project"])[0]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET recipient = '', evidence_description = %s WHERE id = %s",
            ("x" * 3500, draft),
        )
        connection.commit()
    message_id = _ask(client, team, "Shorten that draft, send it to Dana, and submit it.")
    wording = "Please send the signed Q1 user access review for SAP ERP."
    script = _Script(
        [
            _reply(
                "",
                _call(
                    "edit_request",
                    request_id=draft,
                    description=wording,
                    recipient="dana@client.example",
                ),
                # Checked as the request will be after the edit before it.
                _call("submit_request", request_id=draft),
            ),
            _reply("I proposed the edit and the submission."),
        ]
    )
    with connect(migrated.url) as connection:
        assert _turn(connection, migrated, script, message_id) == "DONE"
    steps = _thread(client, team)["messages"][-1]["actions"]
    assert [(step["tool"], step["status"]) for step in steps] == [
        ("edit_request", "PROPOSED"),
        ("submit_request", "PROPOSED"),
    ]
    assert steps[0]["summary"].startswith(
        "Reword the drafted request and send it to dana@client.example"
    )
    confirmed = client.post(f"{base}/messages/{message_id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    done = confirmed.json()["messages"][-1]["actions"]
    assert [step["status"] for step in done] == ["DONE", "DONE"]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, recipient, evidence_description FROM pbc_requests WHERE id = %s",
            (draft,),
        ).fetchone()
    assert row == ("APPROVAL_PENDING", "dana@client.example", wording)


def test_a_step_that_fails_when_confirmed_says_why(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "failwhy", "ITGC-AC-01")
    base = f"{_base(team['org'], team['project'])}/console"
    draft = _draft_requests(migrated, team["project"])[0]
    message_id = _ask(client, team, "Submit the first draft.")
    script = _Script([_reply("", _call("submit_request", request_id=draft)), _reply("Done.")])
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, message_id)
        # The request changes after the step was proposed: its wording grows too long.
        connection.execute(
            "UPDATE pbc_requests SET evidence_description = %s WHERE id = %s",
            ("y" * 3600, draft),
        )
        connection.commit()
    step = _thread(client, team)["messages"][-1]["actions"][0]
    ran = client.post(f"{base}/actions/{step['id']}/confirm")
    assert ran.status_code == 200, ran.text
    failed = ran.json()["messages"][-1]["actions"][0]
    assert failed["status"] == "FAILED"
    assert "too long to send" in failed["error"]
    assert "That could not be done" not in failed["error"]


def test_a_long_conversation_starts_its_history_at_a_question(migrated: Database) -> None:
    team, client, _request = _sent_engagement_request(migrated, "window", "ITGC-AC-01")
    with connect(migrated.url) as connection:
        # The first answer used a tool; later the history window starts inside it.
        first = _ask(client, team, "What does ITGC-AC-01 need?")
        _turn(
            connection,
            migrated,
            _Script(
                [
                    _reply("", _call("get_control", control_ref="itgc-ac-01")),
                    _reply("It needs the population."),
                ]
            ),
            first,
        )
        for index in range(5):
            asked = _ask(client, team, f"Question {index}?")
            _turn(connection, migrated, _Script([_reply(f"Answer {index}.")]), asked)
        last = _ask(client, team, "And now?")
        script = _Script([_reply("Still fine.")])
        assert _turn(connection, migrated, script, last) == "DONE"
    seen = script.seen[0]
    # It opens on a question, never on tool results without the calls they answer.
    assert seen[0]["role"] == "user"
    assert all(block["type"] == "text" for block in seen[0]["content"])
    calls = {
        block["id"]
        for message in seen
        for block in message["content"]
        if block["type"] == "tool_call"
    }
    results = {
        block["id"]
        for message in seen
        for block in message["content"]
        if block["type"] == "tool_result"
    }
    assert results <= calls


def _ask(client: TestClient, team: dict[str, Any], text: str) -> UUID:
    asked = client.post(
        f"{_base(team['org'], team['project'])}/console/messages", json={"text": text}
    )
    assert asked.status_code == 200, asked.text
    messages = asked.json()["messages"]
    assert messages[-2]["role"] == "USER" and messages[-2]["content"] == text
    assert messages[-1]["status"] == "PENDING"
    return UUID(messages[-1]["id"])


def _turn(connection: Any, database: Database, script: _Script, message_id: UUID) -> str:
    return run_turn(connection, Settings(database_url=database.url), script, message_id)


def _thread(client: TestClient, team: dict[str, Any]) -> dict[str, Any]:
    found = client.get(f"{_base(team['org'], team['project'])}/console")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _draft_requests(database: Database, project: UUID) -> list[str]:
    """The drafted requests, with their wording drafted (by the rules, as no model is set):
    a request still showing its placeholder wording cannot be submitted."""
    from ai_workforce_api.pbc_drafting import run_draft

    with connect(database.url) as connection:
        for row in connection.execute(
            "SELECT id FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING'", (project,)
        ).fetchall():
            run_draft(connection, None, row[0])
        rows = connection.execute(
            "SELECT id FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT' "
            "ORDER BY control_ref LIMIT 3",
            (project,),
        ).fetchall()
    return [str(row[0]) for row in rows]


def _statuses(connection: Any, ids: list[str]) -> list[str]:
    return [
        str(
            connection.execute("SELECT status FROM pbc_requests WHERE id = %s", (item,)).fetchone()[
                0
            ]
        )
        for item in ids
    ]


def _audit(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
