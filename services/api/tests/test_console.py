"""The agent console: questions, routine tools, proposed steps, and confirmation."""

from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_evidence_review import _base, _client, _sent_engagement_request
from test_execution import _add_project_member, _add_user
from test_outbound import migrated

from ai_workforce_api.console import run_turn
from ai_workforce_api.console_tools import BY_NAME, TOOLS, parse
from ai_workforce_api.db import connect
from ai_workforce_api.models import ChatReply, ChatTool, ToolCall
from ai_workforce_api.settings import Settings

_ = migrated


class _Script:
    """A stand-in for the model: it plays scripted replies and records what it saw."""

    def __init__(self, replies: list[ChatReply]) -> None:
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
        return self.replies.pop(0)


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
        "log_deficiency",
        "update_phase",
        "update_milestone",
        "edit_request",
        "draft_request",
        "update_request_status",
    }
    assert {tool.name for tool in TOOLS if tool.risk == "CONFIRM"} == sensitive
    assert {tool.name for tool in TOOLS if tool.risk == "ROUTINE"} == {
        "redraft_request",
        "reread_evidence",
        "propose_samples",
    }


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
    assert "A request exists for the access granted" in result["content"]
    assert "SOX 2027" in script.systems[0]


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
    assert "need a model" in agent["content"]
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
    with connect(database.url) as connection:
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
