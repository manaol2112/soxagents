import hashlib
from typing import Any
from uuid import UUID

import psycopg
import pytest
from evidence_store import store_attachment
from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _ready
from test_inbound import _reply, _sent_request, _simulate
from test_outbound import _session

from ai_workforce_api.authorization import AccessDenied
from ai_workforce_api.db import connect
from ai_workforce_api.evidence import EMAIL_EVIDENCE_REFUSED, EvidenceState
from ai_workforce_api.migrate import apply_migrations, migrations_dir

_CONTENT = b"account,status\n1,active\n"


def test_an_attachment_on_a_reply_is_never_taken_as_evidence(migrated: Database) -> None:
    # Milestone 8.12: evidence comes in through the owner's secure upload link only.
    seeded, project_id, owner, sent = _sent_request(migrated, "no-email")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=True)
    refused = owner.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == EMAIL_EVIDENCE_REFUSED
    assert owner.get(_files(seeded, project_id)).json() == []


def test_a_stored_attachment_is_kept_once_and_reads_back_the_same_bytes(
    migrated: Database,
) -> None:
    # Attachments stored before 8.12 keep their custody; the service still guarantees it.
    seeded, project_id, owner, sent = _sent_request(migrated, "custody")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=True)
    body = store_attachment(owner, seeded["organization_id"], project_id, attachment_id, _CONTENT)
    assert body["mailbox_attachment_id"] == attachment_id
    assert body["content_sha256"] == hashlib.sha256(_CONTENT).hexdigest()
    assert body["file_name"] == "listing.csv"
    again = store_attachment(owner, seeded["organization_id"], project_id, attachment_id, _CONTENT)
    assert again["id"] == body["id"]
    downloaded = owner.get(_download(seeded, project_id, body["id"]))
    assert downloaded.status_code == 200
    assert downloaded.content == _CONTENT
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert "attachment;" in downloaded.headers["content-disposition"]
    listed = owner.get(_files(seeded, project_id))
    assert [item["id"] for item in listed.json()] == [body["id"]]
    with pytest.raises(EvidenceState) as changed:
        store_attachment(
            owner,
            seeded["organization_id"],
            project_id,
            attachment_id,
            b"account,status\n2,active\n",
        )
    assert changed.value.detail == "file does not match"
    audit = _audit_text(migrated)
    assert body["content_sha256"] in audit
    assert "listing.csv" not in audit
    assert "account,status" not in audit


def test_bytes_must_match_the_attachment_record(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "mismatch")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=True)
    with pytest.raises(EvidenceState) as short:
        store_attachment(owner, seeded["organization_id"], project_id, attachment_id, b"short")
    assert short.value.detail == "file does not match"
    with pytest.raises(EvidenceState):
        store_attachment(
            owner, seeded["organization_id"], project_id, attachment_id, b"x" * len(_CONTENT)
        )
    assert owner.get(_files(seeded, project_id)).json() == []


def test_readers_can_download_but_cannot_store_and_other_tenants_see_nothing(
    migrated: Database,
) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "roles")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=False)
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection,
            seeded["organization_id"],
            "reviewer-custody@example.com",
            "REVIEWER",
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer_id)
    reviewer = _session(migrated, reviewer_id)
    with pytest.raises(AccessDenied):
        store_attachment(reviewer, seeded["organization_id"], project_id, attachment_id, _CONTENT)
    stored = store_attachment(owner, seeded["organization_id"], project_id, attachment_id, _CONTENT)
    file_id = stored["id"]
    with pytest.raises(EvidenceState) as changed:
        store_attachment(
            owner,
            seeded["organization_id"],
            project_id,
            attachment_id,
            b"account,status\n2,active\n",
        )
    assert changed.value.detail == "file changed"
    assert reviewer.get(_download(seeded, project_id, file_id)).content == _CONTENT
    stranger, _project, stranger_client = _ready(migrated, "stranger")
    hidden = stranger_client.get(_download(seeded, project_id, file_id))
    assert hidden.status_code == 404
    assert stranger_client.get(_files(seeded, project_id)).status_code == 404
    missing = owner.get(_download(seeded, project_id, str(UUID(int=1))))
    assert missing.status_code == 404
    _ = stranger


def test_custody_records_cannot_be_changed(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "immutable")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=False)
    store_attachment(owner, seeded["organization_id"], project_id, attachment_id, _CONTENT)
    with connect(migrated.url) as connection:
        for statement in (
            "UPDATE evidence_files SET file_name = 'renamed.csv'",
            "DELETE FROM evidence_files",
            "UPDATE mock_objects SET content = '\\x00'",
            "DELETE FROM mock_objects",
        ):
            with pytest.raises(psycopg.Error):
                with connection.transaction():
                    connection.execute(statement)


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _attach(
    owner: TestClient,
    seeded: dict[str, Any],
    project_id: UUID,
    sent: dict[str, Any],
    content: bytes,
    *,
    declared: bool,
) -> str:
    record: dict[str, Any] = {
        "file_name": "listing.csv",
        "content_type": "text/csv",
        "size_bytes": len(content),
    }
    if declared:
        record["content_sha256"] = hashlib.sha256(content).hexdigest()
    reply = owner.post(
        _simulate(seeded, project_id),
        json=_reply(sent, key=f"file-{seeded['organization_id']}", attachments=[record]),
    )
    assert reply.status_code == 200
    attachment_id = reply.json()["attachments"][0]["id"]
    assert isinstance(attachment_id, str)
    return attachment_id


def _content(seeded: dict[str, Any], project_id: UUID, attachment_id: str) -> str:
    return (
        f"/organizations/{seeded['organization_id']}/projects/{project_id}"
        f"/mailbox-attachments/{attachment_id}/content"
    )


def _files(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/evidence-files"


def _download(seeded: dict[str, Any], project_id: UUID, file_id: str) -> str:
    return f"{_files(seeded, project_id)}/{file_id}/content"


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
