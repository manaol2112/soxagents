"""The reliability audit's fixes (17 November 2026).

- Uploads read their body with a hard limit, refused on the declared length before a byte
  is read, and their work runs off the event loop; the public portal checks its session
  before it reads a file; the portal never gives the one-time code in production.
- Work a request queues is handed to the worker only once the request has committed.
- A background run that raises after its claim gives the claim back, so the retry runs it.
- A test run renews its lease for each item.
- A confirmed console step runs as one transaction: one that fails part way changes nothing.
- The audit events of one record are read through an index.
- Object storage that cannot be reached is "unavailable", never an unhandled error.
"""

import asyncio
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
from support import Database, approve_plans_over_api
from test_evidence_analysis import _no_ocr
from test_evidence_intake import _client, _engagement, _request
from test_onboarding import _base as _onboarding_setup
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated
from test_planning_gate import _launched
from test_testing_engine import _add, _answer, _base, _Citing, _confirm_design, _read_all, _sheet

from ai_workforce_api import durable, evidence_portal, outbound, phase_release, testing_engine
from ai_workforce_api.db import Claim, connect, release_claim
from ai_workforce_api.evidence_analysis import analysis_runner
from ai_workforce_api.evidence_plans import plan_runner
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import (
    S3_CONNECT_TIMEOUT_SECONDS,
    S3_READ_TIMEOUT_SECONDS,
    S3ObjectStore,
    StoreError,
)
from ai_workforce_api.testing_engine import run_sheet
from ai_workforce_api.upload_body import read_body

__all__ = ["migrated"]


# Uploads (F1 and the security review's upload finding)


def _request_with(chunks: list[bytes], headers: dict[str, str]) -> tuple[Request, list[int]]:
    """A request whose body arrives in the given pieces, and a list that counts the pieces
    the server asked for."""
    asked: list[int] = []
    pending = list(chunks)

    async def receive() -> dict[str, Any]:
        asked.append(1)
        body = pending.pop(0) if pending else b""
        return {"type": "http.request", "body": body, "more_body": bool(pending)}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/upload",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "query_string": b"",
    }
    return Request(scope, receive), asked


def test_a_declared_length_over_the_limit_is_refused_before_a_byte_is_read() -> None:
    request, asked = _request_with([b"x" * 10], {"content-length": "11"})
    with pytest.raises(HTTPException) as refused:
        asyncio.run(read_body(request, 10, "file is larger than 10 bytes"))
    assert refused.value.status_code == 413
    assert refused.value.detail == "file is larger than 10 bytes"
    assert asked == [], "nothing of the body was read"
    request, asked = _request_with([b"x"], {"content-length": "many"})
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(read_body(request, 10, "too large"))
    assert invalid.value.status_code == 400 and asked == []


def test_a_streamed_body_over_the_limit_is_refused_as_it_passes_it() -> None:
    # No declared length (a chunked upload), or a false one: the reading stops at the piece
    # that passes the limit, and the rest is never asked for.
    for headers in ({}, {"content-length": "4"}):
        request, asked = _request_with([b"abcd", b"efgh", b"ijkl", b"mnop"], headers)
        with pytest.raises(HTTPException) as refused:
            asyncio.run(read_body(request, 6, "too large"))
        assert refused.value.status_code == 413
        assert len(asked) == 2
    request, _asked = _request_with([b"abc", b"def"], {"content-length": "6"})
    assert asyncio.run(read_body(request, 6, "too large")) == b"abcdef"


def test_an_oversized_evidence_upload_is_refused_as_too_large(migrated: Database) -> None:
    team = _new_engagement(migrated, "upload-cap")
    owner: TestClient = team["owner"]
    base = f"/organizations/{team['org']}/projects/{team['project']}"

    def chunks() -> Iterator[bytes]:
        # A chunked body with no declared length, past the 25 MB limit.
        for _ in range(26):
            yield b"x" * 1_000_000

    response = owner.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "big.csv"},
        content=chunks(),
        headers={"content-type": "text/csv"},
    )
    assert response.status_code == 413, response.text
    assert response.json()["detail"] == "file is larger than 25 MB"
    empty = owner.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "empty.csv"},
        content=b"",
        headers={"content-type": "text/csv"},
    )
    assert empty.status_code == 422 and empty.json()["detail"] == "file is empty"


def test_the_portal_checks_its_session_before_it_reads_a_file(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    read: list[int] = []

    async def reading(request: Request, limit: int, too_large: str) -> bytes:
        read.append(limit)
        return b"never"

    monkeypatch.setattr(evidence_portal, "read_body", reading)
    client = TestClient(create_app(Settings(database_url=migrated.url)))
    url = f"/public/evidence-portal/session/requests/{uuid4()}/files"
    for token in ("not a token", "a" * 40):
        refused = client.post(
            url,
            params={"name": "evidence.pdf"},
            content=b"%PDF-1.4 the file",
            headers={evidence_portal.SESSION_HEADER: token},
        )
        assert refused.status_code == 404, refused.text
    assert read == [], "no file is read without a valid session"


def test_the_portal_never_gives_the_code_in_production() -> None:
    def shown(app_env: str, inbox: bool = True) -> bool:
        settings = Settings(
            email_provider="mock", email_mock_inbound_enabled=inbox, app_env=app_env
        )
        return evidence_portal.code_preview(settings)

    assert shown("development") is True and shown("") is True
    assert shown("production") is False and shown(" Production ") is False
    assert shown("development", inbox=False) is False


def test_a_follow_up_step_runs_off_the_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    threads: list[str] = []

    @contextmanager
    def no_database(_url: str) -> Iterator[None]:
        yield None

    def advanced(*_args: Any) -> int:
        threads.append(threading.current_thread().name)
        return -1

    monkeypatch.setattr(durable, "connect", no_database)
    monkeypatch.setattr(durable, "advance", advanced)
    activities = {item.__name__: item for item in durable.activities_for("postgresql://unused")}
    step = activities["advance_follow_up"]
    loop_thread = threading.current_thread().name
    moment = "2027-01-01T00:00:00+00:00"
    assert asyncio.run(step(str(uuid4()), str(uuid4()), str(uuid4()), moment)) == -1
    assert threads and threads[0] != loop_thread


# Object storage (F7)


def test_storage_that_cannot_be_reached_is_unavailable() -> None:
    store = S3ObjectStore(
        Settings(
            s3_endpoint_url="http://127.0.0.1:9",
            s3_bucket="evidence",
            s3_access_key_id="test-key",
            s3_secret_access_key="test-secret",  # noqa: S106 - a stand-in, not a credential
        )
    )
    config = store._client.meta.config
    assert (config.connect_timeout, config.read_timeout) == (
        S3_CONNECT_TIMEOUT_SECONDS,
        S3_READ_TIMEOUT_SECONDS,
    )
    for call in (
        lambda: store.get("evidence/x"),
        lambda: store.put("evidence/x", b"content"),
        lambda: store.delete("evidence/x"),
        lambda: store.list_keys("evidence/"),
    ):
        with pytest.raises(StoreError) as unavailable:
            call()
        assert unavailable.value.detail == "object storage is unavailable"


# The audit events of one record (F6)


def test_the_audit_events_of_a_record_are_indexed(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'audit_events' "
            "AND indexname = 'audit_events_target_idx'"
        ).fetchone()
    assert found is not None
    assert "(target_type, target_id, occurred_at DESC)" in str(found[0])


# Claims given back (F3) and the test run's lease (F4)


def _sheet_ready(migrated: Database, slug: str) -> tuple[dict[str, Any], TestClient, UUID]:
    """An automated control's sheet, its one item with evidence, waiting for its run."""
    team, client, scheduler = _engagement(migrated, slug)
    _confirm_design(client, team, "ITGC-AC-05")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "password settings.csv", "Setting,Value\nMinimum length,12\n", request["id"])
    _read_all(migrated, scheduler)
    sheet = UUID(_sheet(client, team)["id"])
    _set(migrated, "UPDATE test_sheets SET run_status = 'PENDING', attempts = 0, "
         "lease_until = NULL WHERE id = %s", sheet)  # fmt: skip
    return team, client, sheet


def _set(migrated: Database, query: str, *params: Any) -> None:
    with connect(migrated.url) as connection:
        connection.execute(query, params)


def _row(migrated: Database, query: str, *params: Any) -> tuple[Any, ...]:
    with connect(migrated.url) as connection:
        row = connection.execute(query, params).fetchone()
    assert row is not None
    return tuple(row)


def test_a_test_run_that_raises_gives_its_claim_back(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Before, the sheet stayed WORKING under its lease: the engine's retry found it
    claimed, returned SKIPPED, and the run waited for a restart."""
    _team, _client_, sheet = _sheet_ready(migrated, "claim-test")
    runner = testing_engine.test_runner(Settings(database_url=migrated.url))

    def broken(*_args: Any) -> None:
        raise RuntimeError("object storage dropped the connection")

    monkeypatch.setattr(testing_engine, "_place_new_files", broken)
    with pytest.raises(RuntimeError):
        runner(sheet)
    status = "SELECT run_status, lease_until IS NULL, attempts FROM test_sheets WHERE id = %s"
    assert _row(migrated, status, sheet) == ("PENDING", True, 1)
    monkeypatch.undo()
    # The retry claims it again and tests it.
    assert runner(sheet) == "DONE"
    assert _row(migrated, status, sheet)[0] == "IDLE"


def test_a_test_run_renews_its_lease_for_each_item(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Before, a sheet of many items outlasted its one lease, and a second run took it over
    while the first still worked."""
    _team, _client_, sheet = _sheet_ready(migrated, "lease-test")
    item = _row(migrated, "SELECT id FROM test_items WHERE test_sheet_id = %s", sheet)[0]
    alive: list[bool] = []

    def tested(*_args: Any) -> bool:
        # The lease is current when each item is tested, then runs out (time passes).
        alive.append(
            _row(
                migrated,
                "SELECT lease_until > clock_timestamp() FROM test_sheets WHERE id = %s",
                sheet,
            )[0]
        )
        _set(migrated, "UPDATE test_sheets SET lease_until = clock_timestamp() "
             "- interval '1 minute' WHERE id = %s", sheet)  # fmt: skip
        return True

    monkeypatch.setattr(testing_engine, "_items_to_test", lambda _c, _s: [item, item, item])
    monkeypatch.setattr(testing_engine, "_test_item", tested)
    with connect(migrated.url) as connection:
        assert run_sheet(connection, None, sheet) == "DONE"
    assert alive == [True, True, True]


def test_a_reading_that_meets_a_storage_outage_gives_its_claim_back(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "claim-read")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "settings.csv", "Setting,Value\nMinimum length,12\n", request["id"])
    analysis = scheduler.analyses[-1]

    class Outage:
        def get(self, key: str) -> bytes:
            raise StoreError("object storage is unavailable")

        def put(self, key: str, content: bytes) -> str:
            raise StoreError("object storage is unavailable")

    settings = Settings(database_url=migrated.url)
    runner = analysis_runner(settings, ocr=_no_ocr, store=lambda _s, _c: Outage())
    with pytest.raises(StoreError):
        runner(analysis)
    status = "SELECT status, lease_until IS NULL, attempts FROM evidence_analyses WHERE id = %s"
    assert _row(migrated, status, analysis) == ("PENDING", True, 1)
    # Storage is back: the retry reads it.
    assert analysis_runner(settings, ocr=_no_ocr)(analysis) != "SKIPPED"
    assert _row(migrated, status, analysis)[0] != "PENDING"


def test_a_plan_run_that_raises_gives_its_claim_back_and_never_a_claim_taken_over(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team = _launched(migrated, "claim-plan")
    plan = _row(
        migrated, "SELECT id FROM evidence_plans WHERE project_id = %s LIMIT 1", team["project"]
    )[0]
    _set(migrated, "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0 "
         "WHERE id = %s", plan)  # fmt: skip

    def broken(*_args: Any) -> None:
        raise RuntimeError("the database connection was lost")

    monkeypatch.setattr(phase_release, "settle_after_run", broken)
    runner = plan_runner(Settings(database_url=migrated.url))
    with pytest.raises(RuntimeError):
        runner(plan)
    status = (
        "SELECT run_status, run_lease_until IS NULL, run_attempts FROM evidence_plans WHERE id = %s"
    )
    assert _row(migrated, status, plan) == ("PENDING", True, 1)
    # A run whose lease ran out and was taken over (another attempt counted) keeps its
    # claim: the run that lost it never gives it back.
    _set(migrated, "UPDATE evidence_plans SET run_status = 'WORKING', run_attempts = 2, "
         "run_lease_until = clock_timestamp() + interval '5 minutes' "
         "WHERE id = %s", plan)  # fmt: skip
    lost = Claim(
        table="evidence_plans", key_column="id", key=plan, status_column="run_status",
        attempts_column="run_attempts", attempts=1, lease_column="run_lease_until",
        working="WORKING", pending="PENDING",
    )  # fmt: skip
    with connect(migrated.url) as connection:
        assert release_claim(connection, lost) is False
    assert _row(migrated, status, plan) == ("WORKING", False, 2)


# Handed to the worker only once committed (F2)


class _Witness:
    """A background worker that notes each id it is handed and whether the row was already
    committed as queued: read on a connection of its own, as the worker's claim reads it."""

    _QUEUED = {
        "drafts": "SELECT status = 'PENDING' FROM pbc_drafts WHERE id = %s",
        "tests": "SELECT run_status = 'PENDING' FROM test_sheets WHERE id = %s",
        "workpapers": "SELECT draft_status = 'PENDING' FROM workpapers WHERE id = %s",
        "analyses": "SELECT status = 'PENDING' FROM evidence_analyses WHERE id = %s",
    }

    def __init__(self, database: Database) -> None:
        self.database = database
        self.handed: list[tuple[str, UUID, bool]] = []
        self.analyses: list[UUID] = []

    def _note(self, kind: str, ids: list[UUID]) -> None:
        with connect(self.database.url) as connection:
            for item in ids:
                row = connection.execute(self._QUEUED[kind], (item,)).fetchone()
                self.handed.append((kind, item, row is not None and row[0] is True))

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        self._note("drafts", draft_ids)

    def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
        self._note("tests", sheet_ids)

    def schedule_workpaper_drafts(self, workpaper_ids: list[UUID]) -> None:
        self._note("workpapers", workpaper_ids)

    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None:
        self.analyses.extend(analysis_ids)
        self._note("analyses", analysis_ids)

    def schedule_reviews(self, review_ids: list[UUID]) -> None:
        del review_ids

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        del plan_ids


def test_a_retest_and_a_sign_off_hand_their_work_over_only_once_committed(
    migrated: Database,
) -> None:
    team, _owner, _scheduler = _engagement(migrated, "commit-sheet")
    witness = _Witness(migrated)
    client = _client(migrated, team["owner_id"], witness)  # type: ignore[arg-type]
    _confirm_design(client, team, "ITGC-AC-05")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "password settings.csv", "Setting,Value\nMinimum length,12\n", request["id"])
    _read_all(migrated, witness)
    sheet = _sheet(client, team)
    with connect(migrated.url) as connection:
        run_sheet(connection, None, UUID(sheet["id"]))
    witness.handed.clear()
    path = f"{_base(team)}/test-sheets/{sheet['id']}"
    again = client.post(f"{path}/retest", json={"version": _sheet(client, team)["version"]})
    assert again.status_code == 200, again.text
    tests = [entry for entry in witness.handed if entry[0] == "tests"]
    assert tests == [("tests", UUID(sheet["id"]), True)]
    provider = _Citing([_answer(["PASS"] * len(sheet["attributes"]))])
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    witness.handed.clear()
    signed = client.post(f"{path}/sign-off", json={"version": _sheet(client, team)["version"]})
    assert signed.status_code == 200, signed.text
    # The effectiveness workpaper the sign-off opened is handed over committed.
    workpapers = [entry for entry in witness.handed if entry[0] == "workpapers"]
    assert workpapers and all(entry[2] for entry in workpapers), witness.handed


def test_an_approved_plan_hands_its_drafts_over_only_once_committed(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "commit-plan")
    witness = _Witness(migrated)
    client = _client(migrated, team["owner_id"], witness)  # type: ignore[arg-type]
    _complete_setup(client, team)
    setup = _onboarding_setup(team["org"], team["project"])
    plan = client.post(f"{setup}/plan").json()["plan"]
    started = client.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    witness.handed.clear()
    assert approve_plans_over_api(client, team["org"], team["project"]) > 0
    drafts = [entry for entry in witness.handed if entry[0] == "drafts"]
    assert drafts, "the approvals released requests to draft"
    assert all(entry[2] for entry in drafts), [entry for entry in drafts if not entry[2]]


# A confirmed console step is one transaction (F5)


def test_a_confirmed_step_that_fails_part_way_changes_nothing(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Before, submitting a request through the console committed its approval, then failed
    on the next write: the step said FAILED and an approval of a request that was never
    submitted waited for an approver."""
    from test_console import _ask, _call, _draft_requests, _reply, _Script, _thread, _turn
    from test_evidence_review import _base as _review_base
    from test_evidence_review import _sent_engagement_request

    team, client, _sent = _sent_engagement_request(migrated, "step-tx", "ITGC-AC-01")
    draft = _draft_requests(migrated, team["project"])[0]
    asked = _ask(client, team, "Submit the first draft.")
    script = _Script([_reply("", _call("submit_request", request_id=draft)), _reply("Done.")])
    with connect(migrated.url) as connection:
        _turn(connection, migrated, script, asked)
    count = (
        "SELECT count(*) FROM approvals WHERE project_id = %s AND action_id = 'mail.pbc' "
        "AND parameters ->> 'request_ref' LIKE %s"
    )
    before = _row(migrated, count, team["project"], f"pbc/{draft}/%")[0]

    def broken(*_args: Any) -> None:
        raise RuntimeError("the connection was lost")

    monkeypatch.setattr(outbound, "keep_facts", broken)
    step = _thread(client, team)["messages"][-1]["actions"][0]
    base = f"{_review_base(team['org'], team['project'])}/console"
    ran = client.post(f"{base}/actions/{step['id']}/confirm")
    assert ran.status_code == 200, ran.text
    assert ran.json()["messages"][-1]["actions"][0]["status"] == "FAILED"
    assert _row(migrated, count, team["project"], f"pbc/{draft}/%")[0] == before
    assert _row(migrated, "SELECT status FROM pbc_requests WHERE id = %s", draft) == ("DRAFT",)
