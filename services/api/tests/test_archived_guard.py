"""Archived engagements are read-only in the database (pre-launch hardening, Step 7;
migration 0136): no insert, update or delete of an engagement's records once it is
ARCHIVED, whoever writes; an active or completed engagement keeps its lifecycle; the
records stay readable; the audit trail and the demo's tour keep moving; and a demo reset
still archives the old demo and builds the new one."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_demo import PLACEHOLDER, _initialize
from test_engagement_close import _launched
from test_outbound import migrated
from test_projects import _edit
from test_subscriptions import _sign_up

from ai_workforce_api.db import connect, transaction

__all__ = ["migrated"]

SHA = "b" * 64


def _base(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _archive(team: dict[str, Any]) -> None:
    owner = team["owner"]
    current = owner.get(_base(team)).json()
    done = owner.patch(
        _base(team), json={**_edit(current), "status": "ARCHIVED", "version": current["version"]}
    )
    assert done.status_code == 200, done.text


def _a_control(connection: Any, project_id: UUID) -> UUID:
    row = connection.execute(
        "SELECT id FROM engagement_controls WHERE project_id = %s AND included ORDER BY control_ref LIMIT 1",
        (project_id,),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def test_an_archived_engagement_refuses_every_record_write_and_stays_readable(
    migrated: Database,
) -> None:
    team = _launched(migrated, f"arch-{uuid4().hex[:6]}")
    owner, project_id, organization_id, user_id = (
        team["owner"],
        team["project"],
        team["org"],
        team["owner_id"],
    )
    with connect(migrated.url) as connection:
        control_id = _a_control(connection, project_id)
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO evidence_files (organization_id, project_id, object_key, content_sha256,
                    size_bytes, content_type, file_name, stored_by, source, upload_batch_id)
                VALUES (%s, %s, %s, %s, 10, 'application/pdf', 'before.pdf', %s, 'UPLOAD', %s)
                """,
                (organization_id, project_id, f"evidence/{uuid4()}", SHA, user_id, uuid4()),
            )
        connection.commit()
    _archive(team)
    # Reads still answer: the engagement and its records.
    assert owner.get(_base(team)).json()["status"] == "ARCHIVED"
    listed = owner.get(f"{_base(team)}/workspace/controls")
    assert listed.status_code == 200 and len(listed.json()) >= 1
    # A direct request is refused by the middleware (409), as before.
    assert (
        owner.post(
            f"{_base(team)}/deficiencies",
            json={"title": "Late", "condition": "x", "criteria": "y", "cause": "z", "effect": "w"},
        ).status_code
        == 409
    )
    with connect(migrated.url) as connection:
        # Any writer at all: inserts, updates and deletes of the engagement's records.
        for sql, params in (
            (
                "INSERT INTO evidence_files (organization_id, project_id, object_key, content_sha256, size_bytes, content_type, file_name, stored_by, source, upload_batch_id) VALUES (%s, %s, %s, %s, 10, 'application/pdf', 'after.pdf', %s, 'UPLOAD', %s)",
                (organization_id, project_id, f"evidence/{uuid4()}", SHA, user_id, uuid4()),
            ),
            ("UPDATE engagement_controls SET title = 'Renamed' WHERE id = %s", (control_id,)),
            ("DELETE FROM engagement_controls WHERE id = %s", (control_id,)),
            (
                "INSERT INTO deficiencies (organization_id, project_id, reference, title, condition, criteria, cause, effect, deficiency_type, likelihood, magnitude, severity, identified_by) VALUES (%s, %s, 'D-900', 'Late', 'c', 'c', 'c', 'e', 'OPERATING', 'REMOTE', 'INCONSEQUENTIAL', 'CONTROL_DEFICIENCY', %s)",
                (organization_id, project_id, user_id),
            ),
            (
                "INSERT INTO test_sheets (organization_id, project_id, engagement_control_id, method, attributes, requested_by) VALUES (%s, %s, %s, 'TEST_OF_ONE', '[\"a\"]'::jsonb, %s)",
                (organization_id, project_id, control_id, user_id),
            ),
            (
                "UPDATE engagement_settings SET updated_at = clock_timestamp() WHERE project_id = %s",
                (project_id,),
            ),
        ):
            with pytest.raises(psycopg.errors.CheckViolation, match="archived"):
                connection.execute(sql, params)
            connection.rollback()
        # What must keep moving still moves: the audit trail against the engagement.
        connection.execute(
            "INSERT INTO audit_events (organization_id, project_id, actor_user_id, action, target_type, target_id, payload) VALUES (%s, %s, %s, 'project.read', 'project', %s, '{}'::jsonb)",
            (organization_id, project_id, user_id, project_id),
        )
        connection.commit()
        assert connection.execute(
            "SELECT count(*) FROM evidence_files WHERE project_id = %s", (project_id,)
        ).fetchone() == (1,)


def test_active_and_completed_engagements_keep_their_lifecycle(migrated: Database) -> None:
    team = _launched(migrated, f"live-{uuid4().hex[:6]}")
    owner, project_id = team["owner"], team["project"]
    with connect(migrated.url) as connection:
        control_id = _a_control(connection, project_id)
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE engagement_controls SET title = 'Still editable' WHERE id = %s",
                (control_id,),
            )
        connection.commit()
    # A COMPLETED engagement (which may reopen) is not frozen in the database.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE projects SET status = 'COMPLETED', completed_at = clock_timestamp(), completed_by = %s WHERE id = %s AND status = 'ACTIVE'",
            (team["owner_id"], project_id),
        )
    assert owner.get(_base(team)).json()["status"] == "COMPLETED"
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE engagement_controls SET title = 'Completed, still writable' WHERE id = %s",
                (control_id,),
            )
        connection.commit()
        assert connection.execute(
            "SELECT title FROM engagement_controls WHERE id = %s", (control_id,)
        ).fetchone() == ("Completed, still writable",)


def test_a_demo_reset_still_archives_the_old_demo_and_builds_the_new_one(
    migrated: Database,
) -> None:
    client, organization_id, _ = _sign_up(
        migrated, f"reset-arch-{uuid4().hex[:6]}@firm.example", **PLACEHOLDER
    )
    first = UUID(_initialize(client, organization_id).json()["project_id"])
    reset = client.post(f"/organizations/{organization_id}/demo/reset", json={"expected_resets": 0})
    assert reset.status_code == 200, reset.text
    second = UUID(reset.json()["project_id"])
    with connect(migrated.url) as connection:
        assert connection.execute(
            "SELECT status FROM projects WHERE id = %s", (first,)
        ).fetchone() == ("ARCHIVED",)
        assert connection.execute(
            "SELECT status FROM projects WHERE id = %s", (second,)
        ).fetchone() != ("ARCHIVED",)
        # The archived demo's records are frozen; the tour's progress still moves.
        with pytest.raises(psycopg.errors.CheckViolation, match="archived"):
            connection.execute(
                "UPDATE engagement_settings SET updated_at = clock_timestamp() WHERE project_id = %s",
                (first,),
            )
        connection.rollback()
    tour = client.put(
        f"/organizations/{organization_id}/demo/tour",
        json={"stage": "overview", "status": "IN_PROGRESS"},
    )
    assert tour.status_code == 200, tour.text
