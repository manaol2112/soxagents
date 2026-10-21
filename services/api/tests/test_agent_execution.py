"""Milestone 3a: real agent execution on the existing jobs. The tester runs through the
caller and records its provenance and its agent; a provider failure leaves FAILED items,
never rules dressed as the model's work; without a model the rules say so; the evidence
reader's fallback names the failure; a person cancels a queued or running job and runs
it again; a crashed run resumes without a duplicate result; no page or queue read calls
the model; the automation status says what model is behind the agents without calling it.
"""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_analysis import _no_ocr
from test_evidence_intake import _accept_population, _engagement, _request
from test_execution import _add_user
from test_outbound import migrated
from test_testing_engine import _add, _answer, _base, _Citing, _read_all, _sheet, _year

from ai_workforce_api import testing_engine
from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.main import create_app
from ai_workforce_api.models import ModelConfig, ModelProviderError, ModelRaw, ModelRequest
from ai_workforce_api.provenance import agent_actor
from ai_workforce_api.settings import Settings
from ai_workforce_api.testing_engine import open_runs, request_run, run_sheet
from ai_workforce_api.workspace import automation_of

__all__ = ["migrated"]


class _Rejecting:
    """A provider whose every call the vendor rejects (a bad key, a bad model name)."""

    def __init__(self) -> None:
        self.calls = 0

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        self.calls += 1
        raise ModelProviderError(transient=False, status=400)


class _Exploding:
    """A provider no page read may reach."""

    def __init__(self) -> None:
        self.calls = 0

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        self.calls += 1
        raise AssertionError("the model was called during a page or queue read")


def _settings(database: Database) -> Settings:
    return Settings(database_url=database.url, model_provider="")


def test_the_tester_records_its_calls_with_provenance_and_acts_as_the_agent(
    migrated: Database,
) -> None:
    team, client, sheet = _ready_sheet(migrated, "exec-model")
    attributes = len(sheet["attributes"])
    provider = _Citing([_answer(["PASS"] * attributes)] * 3)
    with connect(migrated.url) as connection:
        assert (
            run_sheet(connection, provider, UUID(sheet["id"]), None, _settings(migrated)) == "DONE"
        )
        instance = agent_actor(connection, UUID(str(team["project"])), "itgc-access-tester")
        calls = connection.execute(
            """
            SELECT id, agent_key, tier, prompt_version, target_type, target_id, job_id, attempt,
                   status, actor_agent_instance_id, model_name, duration_ms, prompt_sha256
            FROM model_calls WHERE project_id = %s ORDER BY created_at
            """,
            (team["project"],),
        ).fetchall()
        items = connection.execute(
            "SELECT source, model_call_id, note FROM test_items WHERE test_sheet_id = %s "
            "ORDER BY position",
            (sheet["id"],),
        ).fetchall()
        audit = connection.execute(
            "SELECT actor_user_id, actor_agent_instance_id, payload FROM audit_events "
            "WHERE action = 'testing.items_tested' AND target_id = %s",
            (sheet["id"],),
        ).fetchone()
    assert instance is not None
    assert len(calls) == 3
    assert {(c[1], c[2], c[3], c[4]) for c in calls} == {
        ("itgc-access-tester", "BALANCED", "control-tester/1", "test_sheet")
    }
    assert {str(c[5]) for c in calls} == {sheet["id"]}
    assert len({c[6] for c in calls}) == 1, "one job for the run"
    assert [c[7] for c in calls] == [1, 1, 1]
    assert {c[8] for c in calls} == {"SUCCEEDED"}
    assert {c[9] for c in calls} == {instance}, "the call names the engagement's tester"
    assert {c[10] for c in calls} == {"local"}
    assert all(isinstance(c[11], int) and len(str(c[12])) == 64 for c in calls)
    # Every item's result links its call, and every result is the model's.
    assert [i[0] for i in items] == ["MODEL", "MODEL", "MODEL"]
    assert {i[1] for i in items} == {c[0] for c in calls}
    # The audit event names the agent that worked and the person it worked for.
    assert audit is not None
    assert (str(audit[0]), audit[1]) == (str(team["owner_id"]), instance)
    assert audit[2] == {"agent": "itgc-access-tester", "items": 3, "model": True}
    current = _sheet(client, team)
    assert all(item["state"] == "TESTED" for item in current["items"])
    assert current["run_state"] == "IDLE"
    status = client.get(f"{_base(team)}/workspace/automation")
    assert status.status_code == 200, status.text
    assert status.json()["last_call_status"] == "SUCCEEDED"
    assert status.json()["model"] == "local"
    assert status.json()["budget"]["month_limit_micros"] == 50_000_000
    assert status.json()["budget"]["month_spent_micros"] == 0, "the stub is unpriced"
    # The call's record, read back: who asked, which agent worked, the model and prompt
    # version, what it was made from, how it ended.
    read = client.get(f"{_base(team)}/model-calls/{calls[0][0]}")
    assert read.status_code == 200, read.text
    record = read.json()
    assert record["requested_by"] == str(team["owner_id"])
    assert record["agent_instance_id"] == str(instance)
    assert (record["agent_key"], record["tier"], record["model_name"]) == (
        "itgc-access-tester",
        "BALANCED",
        "local",
    )
    assert record["prompt_version"] == "control-tester/1"
    assert len(record["prompt_sha256"]) == 64 and len(record["output_sha256"]) == 64
    assert (record["target_type"], record["target_id"]) == ("test_sheet", sheet["id"])
    assert record["attempt"] == 1 and record["status"] == "SUCCEEDED" and record["error"] == ""
    assert record["inputs"]["sheet"]["id"] == sheet["id"]
    assert record["inputs"]["attributes"] == attributes
    assert len(record["inputs"]["files"]) == 1
    assert len(record["inputs"]["files"][0]["sha256"]) == 64
    assert record["has_content"] is False, "no provenance key in this test"


def test_a_provider_failure_leaves_failed_items_for_a_person_never_a_rules_result(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ai_workforce_api import provenance

    monkeypatch.setattr(provenance, "pause", lambda _seconds: None)
    team, client, sheet = _ready_sheet(migrated, "exec-fail")
    provider = _Rejecting()
    with connect(migrated.url) as connection:
        assert (
            run_sheet(connection, provider, UUID(sheet["id"]), None, _settings(migrated)) == "DONE"
        )
        items = connection.execute(
            "SELECT source, note, results, model_call_id FROM test_items "
            "WHERE test_sheet_id = %s ORDER BY position",
            (sheet["id"],),
        ).fetchall()
        calls = connection.execute(
            "SELECT status, error, attempt FROM model_calls WHERE project_id = %s "
            "ORDER BY created_at",
            (team["project"],),
        ).fetchall()
    # A rejected request is not retried: one call per item, each recorded with its error.
    assert provider.calls == 3
    assert [tuple(c) for c in calls] == [("MODEL_ERROR", "provider error (status 400)", 1)] * 3
    assert [i[0] for i in items] == ["FAILED", "FAILED", "FAILED"]
    assert {i[1] for i in items} == {
        "The model could not be used. Check the model configuration and key."
    }
    assert all(r["result"] == "UNABLE" for i in items for r in i[2])
    assert all(i[3] is not None for i in items), "the failed call is linked from the item"
    current = _sheet(client, team)
    assert current["proposed_conclusion"] == "INCOMPLETE"
    assert current["run_state"] == "IDLE"
    assert any("a person" in line for line in current["blocking"])
    blocked = client.post(
        f"{_base(team)}/test-sheets/{current['id']}/sign-off", json={"version": current["version"]}
    )
    assert blocked.status_code == 409, "nothing is concluded from a failed model call"


def test_without_a_model_the_rules_run_and_say_so(migrated: Database) -> None:
    team, client, sheet = _ready_sheet(migrated, "exec-rules")
    with connect(migrated.url) as connection:
        assert run_sheet(connection, None, UUID(sheet["id"]), None, _settings(migrated)) == "DONE"
        items = connection.execute(
            "SELECT source, results, model_call_id FROM test_items WHERE test_sheet_id = %s",
            (sheet["id"],),
        ).fetchall()
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert {(i[0], i[2]) for i in items} == {("RULES", None)}
    assert {r["note"] for i in items for r in i[1]} == {
        "No model is configured, so a person tests this item."
    }
    assert all(r["result"] == "UNABLE" for i in items for r in i[1])
    assert calls == (0,)
    assert _sheet(client, team)["proposed_conclusion"] == "INCOMPLETE"


def test_the_evidence_reader_names_a_model_failure_behind_its_rules_result(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ai_workforce_api import provenance

    monkeypatch.setattr(provenance, "pause", lambda _seconds: None)
    team, client, scheduler = _engagement(migrated, "exec-fallback")
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    _add(
        client, team, "access population.csv",
        "User ID,Name,Date granted,Ticket\n" + f"u0001,Demo User,{year}-01-10,REQ-1\n",
        kickoff["id"],
    )  # fmt: skip
    provider = _Rejecting()
    with connect(migrated.url) as connection:
        for analysis_id in scheduler.analyses:
            run_analysis(connection, _settings(migrated), provider, analysis_id, _no_ocr)
        row = connection.execute(
            "SELECT source, note, status, model_call_id, classification ->> 'kind' "
            "FROM evidence_analyses WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
        call = connection.execute(
            "SELECT status, agent_key, tier, target_type, error FROM model_calls WHERE id = %s",
            (row[3] if row else None,),
        ).fetchone()
    assert row is not None
    assert row[0] == "FALLBACK", "the rules classified it, and the record says the model failed"
    assert row[1].startswith("The model could not be used.")
    assert "the reviewed rules classified the file instead" in row[1]
    assert (row[2], row[4]) == ("READY", "population")
    assert call is not None
    assert tuple(call) == (
        "MODEL_ERROR", "evidence-reader", "FAST", "evidence_file", "provider error (status 400)",
    )  # fmt: skip


def test_a_person_cancels_a_queued_or_running_run_and_runs_it_again(
    migrated: Database,
) -> None:
    team, client, sheet = _ready_sheet(migrated, "exec-cancel")
    base = _base(team)
    cancel_url = f"{base}/agent-runs/test-sheet/{sheet['id']}/cancel"
    attributes = len(sheet["attributes"])
    # Queued, not yet claimed: cancelled at once.
    assert sheet["run_state"] == "QUEUED"
    queued = client.post(cancel_url)
    assert queued.status_code == 200, queued.text
    assert queued.json()["state"] == "CANCELLED"
    current = _sheet(client, team)
    assert current["run_state"] == "IDLE"
    assert current["run_note"].startswith("Cancelled by ")
    assert current["run_note"].endswith("Run it again when ready.")
    assert current["cancel_state"] == "CANCELLED"
    assert client.post(cancel_url).status_code == 409, "nothing is running now"
    # Running: a person cancels while the tester works; it stops between items.
    with connect(migrated.url) as connection:
        with connection.transaction():
            cursor = connection.cursor()
            assert request_run(cursor, UUID(sheet["id"])) is not None
    assert _sheet(client, team)["run_state"] == "QUEUED"

    class _CancelledMidRun(_Citing):
        seen_state = ""

        def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
            if not self.requests:
                asked = client.post(cancel_url)
                assert asked.status_code == 200, asked.text
                assert asked.json()["state"] == "REQUESTED"
                self.seen_state = _sheet(client, team)["cancel_state"]
            return super().complete(request, config)

    provider = _CancelledMidRun([_answer(["PASS"] * attributes)] * 3)
    with connect(migrated.url) as connection:
        outcome = run_sheet(connection, provider, UUID(sheet["id"]), None, _settings(migrated))
        assert outcome == "CANCELLED"
        # The model answered the first item after the cancellation was asked for: the
        # call is recorded as made, the late answer is not committed.
        assert len(provider.requests) == 1
        assert provider.seen_state == "REQUESTED"
        states = connection.execute(
            "SELECT source, needs_test, tested_at IS NOT NULL FROM test_items "
            "WHERE test_sheet_id = %s ORDER BY position",
            (sheet["id"],),
        ).fetchall()
        record = connection.execute(
            "SELECT run_status, run_note, cancelled_at IS NOT NULL, cancel_requested_by "
            "FROM test_sheets WHERE id = %s",
            (sheet["id"],),
        ).fetchone()
        audit = connection.execute(
            "SELECT actor_user_id, actor_agent_instance_id, payload FROM audit_events "
            "WHERE action = 'testing.run_cancelled' AND target_id = %s ORDER BY occurred_at",
            (sheet["id"],),
        ).fetchall()
    assert [tuple(s) for s in states] == [(None, True, False)] * 3
    assert record is not None
    assert (record[0], record[2], str(record[3])) == ("IDLE", True, str(team["owner_id"]))
    assert record[1].startswith("Cancelled by ")
    assert len(audit) == 2, "the queued cancellation and the running one"
    assert str(audit[1][0]) == str(team["owner_id"])
    assert audit[1][1] is not None, "the agent that stopped is named"
    assert audit[1][2]["items_tested"] == 0
    assert _sheet(client, team)["cancel_state"] == "CANCELLED"
    # The queue shows the stopped run as the person's to start again.
    listed = client.get(f"{base}/queue").json()
    stopped = [item for item in listed["items"] if item["obligation"] == "TESTING_RUN_STOPPED"]
    assert len(stopped) == 1 and stopped[0]["control_ref"] == "ITGC-AC-01"
    # Recovery: the next run tests what was left, without redoing the item that stands.
    with connect(migrated.url) as connection:
        with connection.transaction():
            assert request_run(connection.cursor(), UUID(sheet["id"])) is not None
        again = run_sheet(
            connection, _Citing([_answer(["PASS"] * attributes)] * 3), UUID(sheet["id"]), None,
            _settings(migrated),
        )  # fmt: skip
        assert again == "DONE"
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
    current = _sheet(client, team)
    assert all(item["state"] == "TESTED" for item in current["items"])
    assert current["run_note"] == ""
    assert current["cancel_state"] == "NONE"
    assert calls == (4,), "the discarded call stays on the record, plus one per item"
    # Only a member who may update the engagement cancels; another tenant sees nothing.
    with connect(migrated.url) as connection:
        with connection.transaction():
            assert request_run(connection.cursor(), UUID(sheet["id"])) is not None
        reviewer = _add_user(
            connection, UUID(str(team["org"])), "reviewer-x@example.com", "REVIEWER"
        )
        connection.execute(
            "INSERT INTO project_memberships (organization_id, project_id, user_id) "
            "VALUES (%s, %s, %s)",
            (team["org"], team["project"], reviewer),
        )
        connection.commit()
    assert _session(migrated, reviewer).post(cancel_url).status_code == 403
    stranger_team, _client2, _scheduler = _engagement(migrated, "exec-cancel-other")
    foreign = (
        f"/organizations/{stranger_team['org']}/projects/{stranger_team['project']}"
        f"/agent-runs/test-sheet/{sheet['id']}/cancel"
    )
    assert _session(migrated, UUID(str(stranger_team["owner_id"]))).post(foreign).status_code == 404


def test_a_queued_evidence_read_can_be_cancelled(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "exec-cancel-read")
    kickoff = _request(migrated, team, "ITGC-AC-01")
    _add(client, team, "listing.csv", "User ID,Name\nu0001,Demo\n", kickoff["id"])
    analysis_id = scheduler.analyses[-1]
    cancelled = client.post(f"{_base(team)}/agent-runs/analysis/{analysis_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["state"] == "CANCELLED"
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, note, cancelled_at IS NOT NULL FROM evidence_analyses WHERE id = %s",
            (analysis_id,),
        ).fetchone()
        # The worker picking the job up later finds nothing to claim.
        assert (
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr) == "SKIPPED"
        )
    assert row is not None
    assert (row[0], row[2]) == ("FAILED", True)
    assert row[1].startswith("Cancelled by ")
    unknown = client.post(f"{_base(team)}/agent-runs/not-a-kind/{analysis_id}/cancel")
    assert unknown.status_code == 404


def test_a_crashed_run_resumes_without_a_duplicate_or_partial_result(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, client, sheet = _ready_sheet(migrated, "exec-crash")
    attributes = len(sheet["attributes"])
    real_check = testing_engine.check_results
    seen = {"n": 0}

    def crashing(output: Any, count: int, files: Any = ()) -> Any:
        seen["n"] += 1
        if seen["n"] == 2:
            raise RuntimeError("the worker died after the model answered")
        return real_check(output, count, files)

    monkeypatch.setattr(testing_engine, "check_results", crashing)
    with connect(migrated.url) as connection:
        with pytest.raises(RuntimeError):
            run_sheet(
                connection, _Citing([_answer(["PASS"] * attributes)] * 3), UUID(sheet["id"]),
                None, _settings(migrated),
            )  # fmt: skip
        first = connection.execute(
            "SELECT run_status, attempts FROM test_sheets WHERE id = %s", (sheet["id"],)
        ).fetchone()
        before = connection.execute(
            "SELECT id, tested_at, model_call_id FROM test_items WHERE test_sheet_id = %s "
            "AND tested_at IS NOT NULL",
            (sheet["id"],),
        ).fetchall()
    assert first == ("WORKING", 1), "the lease is held by a worker that is gone"
    assert len(before) == 1, "the item written before the crash stands; the other wrote nothing"
    monkeypatch.setattr(testing_engine, "check_results", real_check)
    with connect(migrated.url) as connection:
        # The lease runs out and the next worker resumes the run.
        connection.execute(
            "UPDATE test_sheets SET lease_until = clock_timestamp() - interval '1 minute' "
            "WHERE id = %s",
            (sheet["id"],),
        )
        connection.commit()
        assert UUID(sheet["id"]) in open_runs(connection)
        resumed = run_sheet(
            connection, _Citing([_answer(["PASS"] * attributes)] * 3), UUID(sheet["id"]), None,
            _settings(migrated),
        )  # fmt: skip
        assert resumed == "DONE"
        after = connection.execute(
            "SELECT id, tested_at, model_call_id FROM test_items WHERE test_sheet_id = %s "
            "ORDER BY position",
            (sheet["id"],),
        ).fetchall()
        calls = connection.execute(
            "SELECT count(*), count(DISTINCT job_id) FROM model_calls WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
        final = connection.execute(
            "SELECT run_status, attempts FROM test_sheets WHERE id = %s", (sheet["id"],)
        ).fetchone()
    assert len(after) == 3 and all(a[1] is not None for a in after)
    kept = next(a for a in after if a[0] == before[0][0])
    assert (kept[1], kept[2]) == (before[0][1], before[0][2]), "the standing item was not redone"
    # The crashed attempt's call was recorded before the crash; the resumed run made two.
    assert calls == (4, 2)
    assert final == ("IDLE", 0)
    assert all(item["state"] == "TESTED" for item in _sheet(client, team)["items"])


def test_no_page_or_queue_read_calls_the_model(migrated: Database) -> None:
    team, _client, sheet = _ready_sheet(migrated, "exec-reads")
    exploding = _Exploding()
    reader = TestClient(
        create_app(
            Settings(database_url=migrated.url, session_cookie_secure=False, model_provider=""),
            model_provider=exploding,
        ),
        cookies={"aw_session": _token(migrated, UUID(str(team["owner_id"])))},
    )
    base = _base(team)
    for path in (
        "/queue",
        "/queue?bucket=MINE",
        "/workspace/controls",
        "/workspace/dashboard",
        f"/controls/{sheet['control_id']}/activity",
        "/next-steps",
        "/test-sheets",
        "/control-tests",
        "/reviews",
        "/workspace/automation",
        f"/controls/{sheet['control_id']}/evidence-mapping",
    ):
        read = reader.get(f"{base}{path}")
        assert read.status_code == 200, (path, read.text)
    assert exploding.calls == 0


def test_the_automation_status_names_the_model_without_calling_it() -> None:
    local = automation_of(Settings(model_provider="", local_worker_enabled=True))
    assert (local.model, local.models) == ("local", {})
    live = automation_of(
        Settings(model_provider="anthropic", model_api_key="not-real", local_worker_enabled=True)
    )
    assert live.model == "live"
    assert live.models == {
        "FAST": "claude-haiku-5-5", "BALANCED": "claude-sonnet-5-5", "DEEP": "claude-opus-5-5",
    }  # fmt: skip
    keyless = automation_of(Settings(model_provider="anthropic", local_worker_enabled=True))
    assert keyless.model == "none" and "without a key" in keyless.model_detail
    unpriced = automation_of(
        Settings(model_provider="anthropic", model_api_key="k", model_fast="claude-y-1")
    )
    assert unpriced.model == "none" and "no price" in unpriced.model_detail


def _ready_sheet(
    database: Database, slug: str
) -> tuple[dict[str, Any], TestClient, dict[str, Any]]:
    """A sampled control whose three samples each have evidence placed, so the tester has
    three items to test (as in test_testing_engine's end-to-end test)."""
    team, client, scheduler = _engagement(database, slug)
    base = _base(team)
    kickoff = _request(database, team, "ITGC-AC-01")
    year = _year(database, team)
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(database, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sheet = _sheet(client, team)
    labels = [item["label"] for item in sheet["items"]]
    samples = approved.json()["sample_request_id"]
    _add(client, team, "approvals.csv", f"ticket,user\nA-1,{labels[0]}\nA-2,{labels[1]}\n", samples)
    _add(client, team, f"{labels[2]} ticket.txt", "Approved by Demo Manager.", samples)
    _read_all(database, scheduler)
    return team, client, _sheet(client, team)


def _token(database: Database, user_id: UUID) -> str:
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (user_id, token_hash(token)),
        )
        connection.commit()
    return token


def _session(database: Database, user_id: UUID) -> TestClient:
    return TestClient(
        create_app(
            Settings(database_url=database.url, session_cookie_secure=False, model_provider="")
        ),
        cookies={"aw_session": _token(database, user_id)},
    )
