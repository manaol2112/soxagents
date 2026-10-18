"""The evidence analysis job and its API, against a real database."""

import hashlib
import io
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from evidence_store import store_attachment
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from support import Database
from test_execution import _add_project_member, _add_user, _ready, _seed_org, _seed_project
from test_inbound import _reply, _sent_request, _simulate

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import open_analyses, run_analysis
from ai_workforce_api.evidence_ocr import CallRecorder, Engine, OcrEngine, OcrResult
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.models import ModelConfig, ModelProvider, ModelRaw, ModelRequest
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore

_LISTING = (
    b"User ID,Role,Date granted,Approver\n"
    b"ann,admin,2027-01-04,bob\ncid,user,2027-02-11,bob\neve,user,2027-03-02,dana\n"
)


def test_a_stored_file_is_queued_read_by_the_rules_and_never_changes_the_request(
    migrated: Database,
) -> None:
    scheduler = _Scheduler()
    seeded, project_id, owner, sent = _sent_request(migrated, "read")
    client = _client(migrated, seeded["user_id"], scheduler)
    file_id = _store(
        client, owner, seeded, project_id, sent, _LISTING, "access_listing.csv", scheduler
    )
    analyses = _analyses(client, seeded, project_id)
    assert len(analyses) == 1
    analysis = analyses[0]
    assert analysis["evidence_file_id"] == file_id
    assert analysis["status"] == "PENDING"
    assert scheduler.analyses == [UUID(analysis["id"])]
    with connect(migrated.url) as connection:
        assert open_analyses(connection) == [UUID(analysis["id"])]
        status = _request_status(connection, sent["id"])
        result = run_analysis(connection, _settings(migrated), None, UUID(analysis["id"]), _no_ocr)
        again = run_analysis(connection, _settings(migrated), None, UUID(analysis["id"]), _no_ocr)
        assert _request_status(connection, sent["id"]) == status
    assert (result, again) == ("READY", "SKIPPED")
    read = _analyses(client, seeded, project_id)[0]
    assert read["status"] == "READY"
    assert read["pbc_request_id"] == sent["id"]
    assert read["extraction"] == "TABLE"
    assert read["row_count"] == 3
    assert read["columns"] == ["User ID", "Role", "Date granted", "Approver"]
    assert read["source"] == "RULES"
    assert read["note"] == "No model is configured."
    assert read["classification"]["kind"] == "population"
    assert "2027-01-04 to 2027-03-02" in read["classification"]["period"]
    assert "eve | user" in read["text_excerpt"]
    audit = _audit(migrated)
    assert "evidence.analyzed" in audit
    assert "access_listing.csv" not in audit
    assert "eve" not in audit


def test_a_screenshot_is_read_by_the_local_engine_and_never_sent_to_the_model(
    migrated: Database,
) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "local-ocr")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    _store(client, owner, seeded, project_id, sent, _png("Minimum length 12"), "settings.png")
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])
    provider = _Provider([_classification("configuration")])
    local = _Engine("LOCAL", ["Minimum password length: 12 characters"])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), provider, analysis_id, _engines(local))
    read = _analyses(client, seeded, project_id)[0]
    assert read["extraction"] == "OCR"
    assert read["ocr_engine"] == "LOCAL"
    assert read["extraction_status"] == "EXTRACTED"
    assert "Minimum password length" in read["text_excerpt"]
    assert read["source"] == "MODEL"
    assert read["classification"]["kind"] == "configuration"
    assert len(local.calls) == 1
    # The model classified the text. It never received an image.
    assert len(provider.requests) == 1
    assert provider.requests[0].images == ()
    assert "Minimum password length" in provider.requests[0].prompt


def test_without_an_ocr_engine_a_screenshot_waits_for_a_person(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "no-ocr")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    _store(client, owner, seeded, project_id, sent, _png("Settings"), "settings.png")
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])
    provider = _Provider([_classification("configuration")])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), provider, analysis_id, _no_ocr)
    read = _analyses(client, seeded, project_id)[0]
    assert read["status"] == "READY"
    assert read["extraction_status"] == "NEEDS_OCR"
    assert "No OCR engine is installed" in read["note"]
    assert read["source"] == "RULES"
    assert read["classification"]["kind"] == "other"
    assert provider.requests == []


def test_an_owner_opts_into_model_ocr_and_only_then_images_go_to_the_model(
    migrated: Database,
) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "model-ocr")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    settings_path = f"/organizations/{seeded['organization_id']}/evidence-settings"
    current = client.get(settings_path).json()
    assert current["ocr_engine"] == "LOCAL"
    assert current["version"] == 0
    with connect(migrated.url) as connection:
        manager_id = _add_user(
            connection,
            seeded["organization_id"],
            f"pm-{uuid4().hex[:6]}@example.com",
            "PROJECT_MANAGER",
        )
    manager = _client(migrated, manager_id, _Scheduler())
    denied = manager.put(settings_path, json={"ocr_engine": "MODEL", "version": 0})
    assert denied.status_code == 403
    changed = client.put(settings_path, json={"ocr_engine": "MODEL", "version": 0})
    assert changed.status_code == 200
    assert changed.json()["ocr_engine"] == "MODEL"
    assert changed.json()["version"] == 1
    stale = client.put(settings_path, json={"ocr_engine": "LOCAL", "version": 0})
    assert stale.status_code == 409
    _store(client, owner, seeded, project_id, sent, _png("Lockout"), "lockout.png")
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])
    provider = _Provider(
        [
            {"pages": [{"text": "Account lockout after 5 attempts"}]},
            _classification("configuration"),
        ]
    )
    local = _Engine("LOCAL", ["should not be used"])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), provider, analysis_id, _engines(local))
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (project_id,)
        ).fetchone()
    read = _analyses(client, seeded, project_id)[0]
    assert read["ocr_engine"] == "MODEL"
    assert "Account lockout" in read["text_excerpt"]
    assert len(provider.requests[0].images) == 1
    assert provider.requests[1].images == ()
    assert local.calls == []
    # Read, classify, then the visual first-pass review, which sees the image again.
    assert calls is not None and calls[0] == 3
    assert len(provider.requests[2].images) == 1
    assert "evidence.ocr_engine_changed" in _audit(migrated)


def test_a_rejected_model_answer_falls_back_to_the_rules(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "rejected")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    _store(client, owner, seeded, project_id, sent, _LISTING, "listing.csv")
    analysis = _analyses(client, seeded, project_id)[0]
    base = f"/organizations/{seeded['organization_id']}/projects/{project_id}/evidence-analyses"
    # Not an answer at all: nothing to check, so the rules are used.
    empty = _Provider([None])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), empty, UUID(analysis["id"]), _no_ocr)
    read = _analyses(client, seeded, project_id)[0]
    assert read["source"] == "RULES"
    assert "not in the required format" in read["note"]
    assert read["classification"]["kind"] == "population"
    # An unknown kind: the evidence check refuses it.
    client.post(f"{base}/{read['id']}/reanalyze", json={"version": read["version"]})
    unknown = _Provider([_classification("invoice")])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), unknown, UUID(analysis["id"]), _no_ocr)
    read = _analyses(client, seeded, project_id)[0]
    assert read["source"] == "RULES"
    assert read["note"].startswith("Model answer rejected")
    assert read["classification"]["kind"] == "population"


def test_a_long_answer_outside_the_schema_is_cut_and_kept(migrated: Database) -> None:
    # Seen live: no itemised request, so the model sent items as "" and seven gaps.
    seeded, project_id, owner, sent = _sent_request(migrated, "clipped")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    _store(client, owner, seeded, project_id, sent, _LISTING, "listing.csv")
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])
    answer = {
        **_classification("population"),
        "summary": "A listing of access grants. " * 30,
        "items": "",
        "gaps": [f"Follow up {number}." for number in range(7)],
    }
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), _Provider([answer]), analysis_id, _no_ocr)
        recorded = connection.execute(
            "SELECT status FROM model_calls WHERE project_id = %s", (project_id,)
        ).fetchall()
    read = _analyses(client, seeded, project_id)[0]
    assert read["source"] == "MODEL"
    assert read["note"] == ""
    assert len(read["classification"]["summary"]) <= 300
    assert read["classification"]["items"] == []
    assert len(read["classification"]["gaps"]) == 6
    # The call is still recorded as it came back.
    assert recorded == [("MALFORMED",)]


def test_a_person_confirms_the_kind_and_reruns_only_unconfirmed_reads(
    migrated: Database,
) -> None:
    scheduler = _Scheduler()
    seeded, project_id, owner, sent = _sent_request(migrated, "confirm")
    client = _client(migrated, seeded["user_id"], scheduler)
    _store(client, owner, seeded, project_id, sent, _LISTING, "listing.csv")
    analysis = _analyses(client, seeded, project_id)[0]
    base = f"/organizations/{seeded['organization_id']}/projects/{project_id}/evidence-analyses"
    early = client.post(
        f"{base}/{analysis['id']}/confirm",
        json={"version": analysis["version"], "kind": "population"},
    )
    assert early.status_code == 409
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), None, UUID(analysis["id"]), _no_ocr)
    ready = _analyses(client, seeded, project_id)[0]
    rerun = client.post(f"{base}/{ready['id']}/reanalyze", json={"version": ready["version"]})
    assert rerun.status_code == 200
    assert rerun.json()["status"] == "PENDING"
    assert rerun.json()["classification"] is None
    assert scheduler.analyses[-1] == UUID(ready["id"])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), None, UUID(analysis["id"]), _no_ocr)
    ready = _analyses(client, seeded, project_id)[0]
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection, seeded["organization_id"], f"rev-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer_id)
    reviewer = _client(migrated, reviewer_id, _Scheduler())
    assert len(_analyses(reviewer, seeded, project_id)) == 1
    body = {"version": ready["version"], "kind": "report", "note": "It is the key report."}
    assert reviewer.post(f"{base}/{ready['id']}/confirm", json=body).status_code == 403
    confirmed = client.post(f"{base}/{ready['id']}/confirm", json=body)
    assert confirmed.status_code == 200
    assert confirmed.json()["confirmed_kind"] == "report"
    assert confirmed.json()["confirmed_note"] == "It is the key report."
    assert confirmed.json()["confirmed_by_name"]
    assert client.post(f"{base}/{ready['id']}/confirm", json=body).status_code == 409
    locked = client.post(
        f"{base}/{ready['id']}/reanalyze", json={"version": confirmed.json()["version"]}
    )
    assert locked.status_code == 409
    assert locked.json()["detail"] == "analysis is confirmed"
    bad = client.post(
        f"{base}/{ready['id']}/confirm",
        json={"version": confirmed.json()["version"], "kind": "invoice"},
    )
    assert bad.status_code == 422
    audit = _audit(migrated)
    assert '"agreed": false' in audit
    assert '"suggested": "population"' in audit
    _stranger, _project, stranger = _ready(migrated, "stranger")
    assert stranger.get(base).status_code == 404
    assert stranger.post(f"{base}/{ready['id']}/confirm", json=body).status_code == 404


def test_a_stored_object_that_no_longer_matches_its_hash_is_not_read(
    migrated: Database,
) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "custody")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    _store(client, owner, seeded, project_id, sent, _LISTING, "listing.csv")
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])

    class Tampered:
        def put(self, key: str, content: bytes) -> str:
            raise AssertionError("never written")

        def get(self, key: str) -> bytes:
            return b"User ID\nmallory\n"

    def store(settings: Settings, connection: psycopg.Connection[Any]) -> ObjectStore:
        del settings, connection
        return Tampered()

    with connect(migrated.url) as connection:
        result = run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr, store)
    assert result == "FAILED"
    read = _analyses(client, seeded, project_id)[0]
    assert read["status"] == "FAILED"
    assert "custody record" in read["note"]
    assert "evidence.custody_check_failed" in _audit(migrated)


def test_a_file_with_no_matched_request_is_still_classified(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "unmatched")
    client = _client(migrated, seeded["user_id"], _Scheduler())
    reply = owner.post(
        _simulate(seeded, project_id),
        json=_reply(
            sent,
            key=f"stray-{uuid4().hex[:6]}",
            sender="Someone Else <other@example.com>",
            thread_id=None,
            subject="Policy",
            attachments=[
                _record(b"Information security policy\nAll access is approved.\n", "policy.txt")
            ],
        ),
    )
    attachment_id = reply.json()["attachments"][0]["id"]
    store_attachment(
        client,
        seeded["organization_id"],
        project_id,
        attachment_id,
        b"Information security policy\nAll access is approved.\n",
    )
    analysis_id = UUID(_analyses(client, seeded, project_id)[0]["id"])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
    read = _analyses(client, seeded, project_id)[0]
    assert read["pbc_request_id"] is None
    assert read["classification"]["kind"] == "policy"
    assert read["classification"]["items"] == []


def test_files_stored_before_this_milestone_are_queued_once(
    empty_database: Database, tmp_path: Path
) -> None:
    for path in sorted(migrations_dir().glob("*.sql")):
        if path.name < "0029":
            (tmp_path / path.name).write_bytes(path.read_bytes())
    apply_migrations(empty_database.url, tmp_path)
    with connect(empty_database.url) as connection:
        seeded = _seed_org(connection, "backfill")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        message = connection.execute(
            """
            INSERT INTO mailbox_messages (
                organization_id, project_id, idempotency_key, provider_message_id, thread_id,
                status, sender, recipient, subject
            )
            VALUES (%s, %s, 'k', 'p', 't', 'RECEIVED', 'a@example.com', 'b@example.com', 's')
            RETURNING id
            """,
            (seeded["organization_id"], project_id),
        ).fetchone()
        assert message is not None
        attachment = connection.execute(
            """
            INSERT INTO mailbox_attachments (
                organization_id, project_id, message_id, attachment_ref, file_name,
                content_type, size_bytes
            )
            VALUES (%s, %s, %s, 'ref-1', 'a.csv', 'text/csv', 3)
            RETURNING id
            """,
            (seeded["organization_id"], project_id, message[0]),
        ).fetchone()
        assert attachment is not None
        connection.execute(
            """
            INSERT INTO evidence_files (
                organization_id, project_id, mailbox_attachment_id, object_key,
                content_sha256, size_bytes, content_type, file_name, stored_by
            )
            VALUES (%s, %s, %s, %s, %s, 3, 'text/csv', 'a.csv', %s)
            """,
            (
                seeded["organization_id"],
                project_id,
                attachment[0],
                f"evidence/{uuid4()}",
                hashlib.sha256(b"a,b").hexdigest(),
                seeded["user_id"],
            ),
        )
    (tmp_path / "0029_evidence_analysis.sql").write_bytes(
        (migrations_dir() / "0029_evidence_analysis.sql").read_bytes()
    )
    assert apply_migrations(empty_database.url, tmp_path) == ["0029_evidence_analysis"]
    with connect(empty_database.url) as connection:
        rows = connection.execute(
            "SELECT status, requested_by_user_id FROM evidence_analyses"
        ).fetchall()
    assert rows == [("PENDING", seeded["user_id"])]


def test_the_local_worker_reads_files_off_the_request_thread() -> None:
    import threading

    from ai_workforce_api.pbc_drafting import LocalDraftScheduler

    done = threading.Event()
    seen: list[tuple[UUID, str]] = []

    def analyze(analysis_id: UUID) -> str:
        seen.append((analysis_id, threading.current_thread().name))
        done.set()
        return "READY"

    scheduler = LocalDraftScheduler(Settings(database_url=""), analyze=analyze)
    analysis_id = uuid4()
    scheduler.schedule_evidence_analyses([analysis_id])
    assert done.wait(5)
    scheduler.shutdown()
    assert seen[0][0] == analysis_id
    assert seen[0][1].startswith("pbc-draft")


# Helpers


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


class _Scheduler:
    def __init__(self) -> None:
        self.drafts: list[UUID] = []
        self.analyses: list[UUID] = []

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        self.drafts.extend(draft_ids)

    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None:
        self.analyses.extend(analysis_ids)


class _Provider:
    def __init__(self, outputs: list[dict[str, Any] | None]) -> None:
        self.outputs = outputs
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        output = self.outputs[min(len(self.requests), len(self.outputs)) - 1]
        return ModelRaw(output, (), 800, 200)


class _Engine:
    def __init__(self, engine: Engine, texts: list[str]) -> None:
        self._engine: Engine = engine
        self._texts = texts
        self.calls: list[int] = []

    @property
    def engine(self) -> Engine:
        return self._engine

    def read(self, images: Sequence[bytes]) -> OcrResult:
        self.calls.append(len(images))
        return OcrResult(self._engine, tuple(self._texts[: len(images)]), None, "")


def _engines(local: _Engine) -> Any:
    """Model OCR when the firm chose it and a provider exists, then the local engine."""
    from ai_workforce_api.evidence_ocr import ModelVisionOcr

    def build(
        choice: Engine, provider: ModelProvider | None, record: CallRecorder
    ) -> list[OcrEngine]:
        engines: list[OcrEngine] = []
        if choice == "MODEL" and provider is not None:
            engines.append(ModelVisionOcr(provider, record))
        engines.append(local)
        return engines

    return build


def _no_ocr(
    choice: Engine, provider: ModelProvider | None, record: CallRecorder
) -> list[OcrEngine]:
    del choice, provider, record
    return []


def _classification(kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "confidence": "high",
        "summary": "A screenshot of the password settings.",
        "reason": "It shows the configured values.",
        "items": [],
        "gaps": [],
        "period": "",
    }


def _settings(database: Database) -> Settings:
    return Settings(database_url=database.url)


def _client(database: Database, user_id: UUID, scheduler: _Scheduler) -> TestClient:
    settings = Settings(database_url=database.url, session_cookie_secure=False)
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (user_id, token_hash(token)),
        )
    return TestClient(
        create_app(settings, draft_scheduler=scheduler), cookies={"aw_session": token}
    )


def _record(content: bytes, name: str) -> dict[str, Any]:
    return {
        "file_name": name,
        "content_type": "application/octet-stream",
        "size_bytes": len(content),
        "content_sha256": hashlib.sha256(content).hexdigest(),
    }


def _store(
    client: TestClient,
    owner: TestClient,
    seeded: dict[str, Any],
    project_id: UUID,
    sent: dict[str, Any],
    content: bytes,
    name: str,
    scheduler: Any = None,
) -> str:
    reply = owner.post(
        _simulate(seeded, project_id),
        json=_reply(sent, key=f"file-{uuid4().hex[:8]}", attachments=[_record(content, name)]),
    )
    assert reply.status_code == 200
    attachment_id = reply.json()["attachments"][0]["id"]
    stored = store_attachment(
        client, seeded["organization_id"], project_id, attachment_id, content, scheduler
    )
    file_id = stored["id"]
    assert isinstance(file_id, str)
    return file_id


def _analyses(client: TestClient, seeded: dict[str, Any], project_id: UUID) -> list[dict[str, Any]]:
    listed = client.get(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}/evidence-analyses"
    )
    assert listed.status_code == 200, listed.text
    body: list[dict[str, Any]] = listed.json()
    return body


def _request_status(connection: psycopg.Connection[Any], request_id: str) -> str:
    row = connection.execute(
        "SELECT status, version FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    assert row is not None
    return f"{row[0]}:{row[1]}"


def _png(text: str) -> bytes:
    picture = Image.new("RGB", (600, 200), "white")
    ImageDraw.Draw(picture).text((10, 90), text, fill="black")
    output = io.BytesIO()
    picture.save(output, format="PNG")
    return output.getvalue()


def _audit(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
