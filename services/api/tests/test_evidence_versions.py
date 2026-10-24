"""Withdrawing, restoring, and replacing evidence files, with custody kept."""

from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_analysis import _classification, _no_ocr, _Provider
from test_evidence_intake import (
    POPULATION,
    _base,
    _engagement,
    _request,
    _settings,
    _status,
)
from test_outbound import migrated
from test_workpapers import _tested_control

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis

_ = migrated


def _on_request(client: TestClient, team: dict[str, Any], request_id: str) -> str:
    added = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "users.csv", "request_id": request_id},
        content=POPULATION,
        headers={"content-type": "text/csv"},
    )
    assert added.status_code == 200, added.text
    file_id: str = added.json()["file_id"]
    return file_id


def _register(client: TestClient, team: dict[str, Any]) -> dict[str, Any]:
    found = client.get(f"{_base(team)}/evidence-register")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _read(database: Database, analysis_id: Any) -> None:
    provider = _Provider([_classification("population")])
    with connect(database.url) as connection:
        run_analysis(connection, _settings(database), provider, analysis_id, _no_ocr)


def test_a_wrong_file_is_withdrawn_kept_and_restored(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "withdraw")
    files = f"{_base(team)}/evidence-files"
    request = _request(migrated, team, "ITGC-OP-01")
    file_id = _on_request(client, team, request["id"])
    _read(migrated, scheduler.analyses[0])
    assert _status(migrated, request["id"]) == "RECEIVED"

    # A reason is the person's to give (22 Oct 2026; an empty one was refused before).
    assert client.post(f"{files}/{file_id}/withdraw", json={"reason": "x" * 501}).status_code == (
        422
    )
    withdrawn = client.post(
        f"{files}/{file_id}/withdraw", json={"reason": "Uploaded the wrong period"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    register = _register(client, team)
    assert all(item["id"] != file_id for item in register["files"])
    [kept] = register["withdrawn"]
    assert (kept["id"], kept["reason"], kept["replaced_by"]) == (
        file_id,
        "Uploaded the wrong period",
        None,
    )
    assert kept["control"]["control_ref"] == "ITGC-OP-01"
    # The request it marked received goes back; it was never sent, so to a draft.
    assert _status(migrated, request["id"]) == "DRAFT"
    # It is off its control, and nothing files, rereads, or re-adds it until restored.
    with connect(migrated.url) as connection:
        link = connection.execute(
            "SELECT 1 FROM evidence_file_links WHERE evidence_file_id = %s", (file_id,)
        ).fetchone()
        assert link is None
        # The custody record and the withdrawal are never changed or deleted.
        for statement in (
            "DELETE FROM evidence_withdrawals WHERE evidence_file_id = %s",
            "UPDATE evidence_withdrawals SET reason = 'other' WHERE evidence_file_id = %s",
            "DELETE FROM evidence_files WHERE id = %s",
        ):
            with pytest.raises(psycopg.errors.RaiseException):
                with connection.transaction():
                    connection.execute(statement, (file_id,))
    again = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "users.csv", "request_id": request["id"]},
        content=POPULATION,
        headers={"content-type": "text/csv"},
    )
    assert again.status_code == 409
    assert "restore" in again.json()["detail"]
    twice = client.post(f"{files}/{file_id}/withdraw", json={"reason": "Again please"})
    assert twice.status_code == 409
    download = client.get(f"{files}/{file_id}/content")
    assert download.status_code == 200

    restored = client.post(f"{files}/{file_id}/restore", json={"reason": "It was right"})
    assert restored.status_code == 200, restored.text
    register = _register(client, team)
    assert register["withdrawn"] == []
    assert any(item["id"] == file_id for item in register["files"])
    assert _status(migrated, request["id"]) == "RECEIVED"
    not_withdrawn = client.post(f"{files}/{file_id}/restore", json={"reason": "Once more"})
    assert not_withdrawn.status_code == 409
    with connect(migrated.url) as connection:
        actions = {
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE target_id = %s", (file_id,)
            ).fetchall()
        }
    assert {"evidence.withdrawn", "evidence.restored"} <= actions


def test_a_replacement_takes_the_old_files_place(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "replace")
    files = f"{_base(team)}/evidence-files"
    request = _request(migrated, team, "ITGC-OP-01")
    file_id = _on_request(client, team, request["id"])
    _read(migrated, scheduler.analyses[0])
    assert _status(migrated, request["id"]) == "RECEIVED"

    def replace(content: bytes, reason: str = "Corrected export") -> Any:
        return client.post(
            f"{files}/{file_id}/replace",
            params={"name": "users v2.csv", "reason": reason},
            content=content,
            headers={"content-type": "text/csv"},
        )

    assert replace(POPULATION).status_code == 409
    assert replace(b"a,b\n1,2\n", reason="x").status_code == 422
    newer = POPULATION + b"u9999,Demo User 9,2026-03-01\n"
    replaced = replace(newer)
    assert replaced.status_code == 200, replaced.text
    body = replaced.json()
    new_id = body["file_id"]
    assert body["replaced"] == file_id
    register = _register(client, team)
    row = next(item for item in register["files"] if item["id"] == new_id)
    # Filed where the old file was, by the person, without matching.
    assert (row["state"], row["filed_by"]) == ("FILED", "PERSON")
    assert row["control"]["control_ref"] == "ITGC-OP-01"
    assert row["match_reason"] == "Replaces users.csv."
    [old] = register["withdrawn"]
    assert (old["id"], old["replaced_by"], old["replaced_by_name"]) == (
        file_id,
        new_id,
        "users v2.csv",
    )
    # The request stays received, and the new version is read like any upload.
    assert _status(migrated, request["id"]) == "RECEIVED"
    assert len(scheduler.analyses) == 2
    _read(migrated, scheduler.analyses[1])
    assert _status(migrated, request["id"]) == "RECEIVED"
    # A replaced file is not restored; its newer version is withdrawn instead.
    blocked = client.post(f"{files}/{file_id}/restore", json={"reason": "Use the old one"})
    assert blocked.status_code == 409
    assert replace(newer + b"x\n").status_code == 409
    with connect(migrated.url) as connection:
        custody = connection.execute(
            "SELECT count(*) FROM evidence_files WHERE id IN (%s, %s)", (file_id, new_id)
        ).fetchone()
    assert custody == (2,)


def test_signed_off_work_keeps_its_evidence_until_reopened(migrated: Database) -> None:
    team, client, sheet, ticket_file = _tested_control(migrated, "keepsigned")
    files = f"{_base(team)}/evidence-files"
    population = next(
        item["id"]
        for item in _register(client, team)["files"]
        if item["file_name"] == "access population.csv"
    )
    signed = client.post(f"{files}/{ticket_file}/withdraw", json={"reason": "Wrong tickets"})
    assert signed.status_code == 409
    assert "signed off" in signed.json()["detail"]
    swapped = client.post(
        f"{files}/{ticket_file}/replace",
        params={"name": "tickets v2.csv", "reason": "Wrong tickets"},
        content=b"ticket,user\nT-9,someone\n",
        headers={"content-type": "text/csv"},
    )
    assert swapped.status_code == 409
    drawn = client.post(f"{files}/{population}/withdraw", json={"reason": "Wrong population"})
    assert drawn.status_code == 409
    assert "approved sample" in drawn.json()["detail"]

    # Reopened, the file can be withdrawn, and it comes off the sheet's items.
    current = next(s for s in client.get(f"{_base(team)}/test-sheets").json())
    reopened = client.post(
        f"{_base(team)}/test-sheets/{current['id']}/reopen",
        json={"version": current["version"], "reason": "Tickets to be replaced"},
    )
    assert reopened.status_code == 200, reopened.text
    withdrawn = client.post(f"{files}/{ticket_file}/withdraw", json={"reason": "Wrong tickets"})
    assert withdrawn.status_code == 200, withdrawn.text
    with connect(migrated.url) as connection:
        placed = connection.execute(
            "SELECT count(*) FROM test_item_files WHERE evidence_file_id = %s", (ticket_file,)
        ).fetchone()
        rerun = connection.execute(
            "SELECT run_status FROM test_sheets WHERE id = %s", (sheet["id"],)
        ).fetchone()
    assert placed == (0,)
    assert rerun == ("PENDING",)
