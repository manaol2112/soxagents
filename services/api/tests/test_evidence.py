import hashlib
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _ready
from test_inbound import _reply, _sent_request, _simulate
from test_outbound import _session

from ai_workforce_api.db import connect
from ai_workforce_api.migrate import apply_migrations, migrations_dir

_CONTENT = b"account,status\n1,active\n"


def test_a_person_stores_an_attachment_once_and_reads_the_same_bytes(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "custody")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=True)
    stored = owner.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
    assert stored.status_code == 200
    body = stored.json()
    assert body["mailbox_attachment_id"] == attachment_id
    assert body["content_sha256"] == hashlib.sha256(_CONTENT).hexdigest()
    assert body["file_name"] == "listing.csv"
    again = owner.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
    assert again.json()["id"] == body["id"]
    downloaded = owner.get(_download(seeded, project_id, body["id"]))
    assert downloaded.status_code == 200
    assert downloaded.content == _CONTENT
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert "attachment;" in downloaded.headers["content-disposition"]
    listed = owner.get(_files(seeded, project_id))
    assert [item["id"] for item in listed.json()] == [body["id"]]
    changed = owner.post(
        _content(seeded, project_id, attachment_id),
        content=b"account,status\n2,active\n",
        headers={"content-type": "application/octet-stream"},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"] == "file does not match"
    audit = _audit_text(migrated)
    assert body["content_sha256"] in audit
    assert "listing.csv" not in audit
    assert "account,status" not in audit


def test_bytes_must_match_the_attachment_record(migrated: Database) -> None:
    seeded, project_id, owner, sent = _sent_request(migrated, "mismatch")
    attachment_id = _attach(owner, seeded, project_id, sent, _CONTENT, declared=True)
    short = owner.post(
        _content(seeded, project_id, attachment_id),
        content=b"short",
        headers={"content-type": "application/octet-stream"},
    )
    assert short.status_code == 409
    assert short.json()["detail"] == "file does not match"
    other = b"x" * len(_CONTENT)
    mismatched = owner.post(
        _content(seeded, project_id, attachment_id),
        content=other,
        headers={"content-type": "application/octet-stream"},
    )
    assert mismatched.status_code == 409
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
    denied = reviewer.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
    assert denied.status_code == 403
    stored = owner.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
    assert stored.status_code == 200
    file_id = stored.json()["id"]
    changed = owner.post(
        _content(seeded, project_id, attachment_id),
        content=b"account,status\n2,active\n",
        headers={"content-type": "application/octet-stream"},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"] == "file changed"
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
    owner.post(
        _content(seeded, project_id, attachment_id),
        content=_CONTENT,
        headers={"content-type": "application/octet-stream"},
    )
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
