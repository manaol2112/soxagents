from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_owner_can_create_edit_pause_and_archive(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    base = f"/organizations/{seeded['organization_id']}/projects"
    fields = {
        "name": "SOX 2026",
        "slug": "sox-2026",
        "scope": "Access reviews",
        "owner_user_id": str(seeded["user_id"]),
        "starts_on": "2026-01-01",
        "ends_on": "2026-12-31",
    }
    # Every engagement starts as a draft: launching it from setup makes it active (8.13).
    refused = client.post(base, json={**fields, "status": "ACTIVE"})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "launch the engagement from setup to make it active"
    created = client.post(base, json={**fields, "status": "DRAFT"})
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "DRAFT"
    assert body["scope"] == "Access reviews"
    assert body["progress"] == []
    assert body["activity"][0]["action"] == "project.created"
    project_id = body["id"]
    # The engagements page reads the list with what each card shows.
    listed = client.get(base).json()
    card = next(item for item in listed if item["id"] == project_id)
    assert card["owner_name"] and card["client_name"] == ""
    assert (card["controls"], card["open_deficiencies"], card["period_end"]) == (0, 0, None)
    # A draft cannot be made active, or paused, by editing it.
    for status in ("ACTIVE", "PAUSED"):
        skipped = client.patch(
            f"{base}/{project_id}",
            json={**_edit(body), "status": status, "version": body["version"]},
        )
        assert skipped.status_code == 409
        assert skipped.json()["detail"] == "launch the engagement from setup to make it active"
    # Nor can the database be told to skip the launch.
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute("UPDATE projects SET status = 'ACTIVE' WHERE id = %s", (project_id,))
    body = _launched(migrated, client, base, project_id)
    assert body["status"] == "ACTIVE"
    paused = client.patch(
        f"{base}/{project_id}",
        json={**_edit(body), "status": "PAUSED", "version": body["version"]},
    )
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    assert paused.json()["activity"][0]["action"] == "project.paused"
    resumed = client.patch(
        f"{base}/{project_id}",
        json={**_edit(paused.json()), "status": "ACTIVE", "version": paused.json()["version"]},
    )
    assert resumed.status_code == 200
    assert resumed.json()["activity"][0]["action"] == "project.resumed"
    archived = client.patch(
        f"{base}/{project_id}",
        json={**_edit(resumed.json()), "status": "ARCHIVED", "version": resumed.json()["version"]},
    )
    assert archived.status_code == 200
    # Archived is closed: it does not reopen, and nothing about it changes.
    for status, name in (("ACTIVE", "SOX 2026"), ("ARCHIVED", "Renamed")):
        refused = client.patch(
            f"{base}/{project_id}",
            json={
                **_edit(archived.json()),
                "name": name,
                "status": status,
                "version": archived.json()["version"],
            },
        )
        assert refused.status_code == 409
        assert refused.json()["detail"] == "the engagement is archived and cannot change"
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute("UPDATE projects SET status = 'ACTIVE' WHERE id = %s", (project_id,))
    kept = client.get(f"{base}/{project_id}")
    assert kept.status_code == 200
    assert kept.json()["status"] == "ARCHIVED"
    assert kept.json()["name"] == "SOX 2026"


def test_a_draft_can_be_archived_without_launching(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "drop", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    base = f"/organizations/{seeded['organization_id']}/projects"
    created = client.post(
        base,
        json={"name": "Dropped", "slug": "dropped", "scope": "",
              "owner_user_id": str(seeded["user_id"]), "status": "DRAFT"},
    ).json()  # fmt: skip
    archived = client.patch(
        f"{base}/{created['id']}",
        json={**_edit(created), "status": "ARCHIVED", "version": created["version"]},
    )
    assert archived.status_code == 200
    assert archived.json()["activity"][0]["action"] == "project.archived"


def _launched(migrated: Database, client: Any, base: str, project_id: str) -> dict[str, Any]:
    """Launch as setup does: the kickoff is recorded and the draft becomes active in one
    transaction. The full launch from setup is tested in test_onboarding."""
    with connect(migrated.url) as connection, connection.transaction():
        connection.execute(
            "UPDATE engagement_settings SET kicked_off_at = clock_timestamp(), "
            "kicked_off_by = (SELECT owner_user_id FROM projects WHERE id = %s) "
            "WHERE project_id = %s",
            (project_id, project_id),
        )
        connection.execute(
            "UPDATE projects SET status = 'ACTIVE', version = version + 1 WHERE id = %s",
            (project_id,),
        )
    found: dict[str, Any] = client.get(f"{base}/{project_id}").json()
    return found


def test_reviewer_cannot_create_and_contributor_cannot_update(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        contributor = _add_user(
            connection, seeded["organization_id"], "contributor@example.com", "CONTRIBUTOR"
        )
    owner = _client(migrated, seeded["user_id"])
    created = owner.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(seeded["user_id"]),
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    with connect(migrated.url) as connection:
        _add_project_member(connection, seeded["organization_id"], UUID(project_id), contributor)
    reviewer_client = _client(migrated, reviewer)
    assert (
        reviewer_client.get(
            f"/organizations/{seeded['organization_id']}/assignable-members"
        ).status_code
        == 403
    )
    refused = reviewer_client.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(reviewer),
    )
    assert refused.status_code == 403
    contributor_client = _client(migrated, contributor)
    updated = contributor_client.patch(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}",
        json={**_edit(created.json()), "name": "Changed", "version": 1},
    )
    assert updated.status_code == 403


def test_duplicate_slug_stale_version_and_foreign_owner_are_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        home = _seed_org(connection, "acme", "owner-a@example.com")
        other = _seed_org(connection, "beta", "owner-b@example.com")
    client = _client(migrated, home["user_id"])
    first = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json=_create(home["user_id"]),
    )
    assert first.status_code == 201
    duplicate = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json=_create(home["user_id"]),
    )
    assert duplicate.status_code == 409
    stale = client.patch(
        f"/organizations/{home['organization_id']}/projects/{first.json()['id']}",
        json={**_edit(first.json()), "name": "Newer", "version": 9},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == "project changed"
    foreign = client.post(
        f"/organizations/{home['organization_id']}/projects",
        json={**_create(other["user_id"]), "slug": "other-owner"},
    )
    assert foreign.status_code == 404


def test_task_counts_are_visible_on_the_project(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "acme", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    created = client.post(
        f"/organizations/{seeded['organization_id']}/projects",
        json=_create(seeded["user_id"]),
    )
    assert created.status_code == 201
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO tasks (organization_id, project_id, title)
                VALUES (%s, %s, 'Walkthrough')
                """,
                (seeded["organization_id"], created.json()["id"]),
            )
    detail = client.get(
        f"/organizations/{seeded['organization_id']}/projects/{created.json()['id']}"
    )
    assert detail.status_code == 200
    assert detail.json()["progress"] == [{"status": "DRAFT", "count": 1}]


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _create(owner_id: UUID) -> dict[str, str]:
    return {
        "name": "SOX 2026",
        "slug": "sox-2026",
        "scope": "Access reviews",
        "owner_user_id": str(owner_id),
        "status": "DRAFT",
    }


def _edit(body: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": body["name"],
        "slug": body["slug"],
        "scope": body["scope"],
        "owner_user_id": body["owner_user_id"],
        "status": body["status"],
        "starts_on": body["starts_on"],
        "ends_on": body["ends_on"],
    }


def _app(database: Database) -> Any:
    return create_app(Settings(database_url=database.url, session_cookie_secure=False))


def test_a_new_engagement_keeps_the_frameworks_it_covers(migrated: Database) -> None:
    # Chosen on the New engagement page (migration 0108); setup reads them to open its
    # Controls step with their areas selected.
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "frameworks", "owner@example.com")
    client = _client(migrated, seeded["user_id"])
    base = f"/organizations/{seeded['organization_id']}/projects"
    fields = {"owner_user_id": str(seeded["user_id"]), "status": "DRAFT"}

    def settings(project_id: str) -> dict[str, Any]:
        body: dict[str, Any] = client.get(f"{base}/{project_id}/onboarding").json()
        return body["settings"]

    chosen = client.post(
        base,
        json={
            **fields,
            "name": "ITGC and reports",
            "slug": "itgc-and-reports",
            "frameworks": ["ITGC", "KEY_REPORT", "ITGC"],
        },
    )
    assert chosen.status_code == 201
    # Each once, in the order chosen.
    assert settings(chosen.json()["id"])["frameworks"] == ["ITGC", "KEY_REPORT"]
    # None chosen: setup keeps its usual selection.
    plain = client.post(base, json={**fields, "name": "Plain", "slug": "plain"})
    assert plain.status_code == 201
    assert settings(plain.json()["id"])["frameworks"] is None
    # Only the library's categories, and at least one when the list is sent.
    for wrong in (["SOC2"], []):
        refused = client.post(
            base, json={**fields, "name": "Wrong", "slug": "wrong", "frameworks": wrong}
        )
        assert refused.status_code == 422
    # The database holds the same line.
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(
            "UPDATE engagement_settings SET frameworks = ARRAY['SOC2'] WHERE project_id = %s",
            (plain.json()["id"],),
        )


def _client(database: Database, user_id: UUID) -> TestClient:
    raw = f"session-{user_id}"
    with connect(database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + interval '1 hour')
                """,
                (user_id, token_hash(raw)),
            )
    client = TestClient(_app(database))
    client.cookies.set("aw_session", raw)
    return client


def _seed_org(connection: psycopg.Connection[Any], slug: str, email: str) -> dict[str, Any]:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (slug, slug),
        )
        organization = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, slug),
        )
        user = cursor.fetchone()
        assert organization is not None
        assert user is not None
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, 'OWNER')
            """,
            (organization[0], user[0]),
        )
    return {"organization_id": organization[0], "user_id": user[0]}


def _add_user(
    connection: psycopg.Connection[Any], organization_id: UUID, email: str, role: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        user = cursor.fetchone()
        assert user is not None
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            """,
            (organization_id, user[0], role),
        )
    assert isinstance(user[0], UUID)
    return user[0]


def _add_project_member(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, user_id: UUID
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (organization_id, project_id, user_id),
        )


def test_each_card_says_where_the_work_stands(migrated: Database) -> None:
    # The engagements page shows this on each card, with no side panel (engagements page).
    from datetime import UTC, datetime, timedelta

    from test_engagement_data import _engagement, _requests, _set

    team, client = _engagement(migrated, "cards")
    now = datetime.now(UTC)
    with connect(migrated.url) as connection:
        ids = _requests(connection, team["project"])
        _set(connection, ids[0], status="SENT", due_at=now - timedelta(days=2))
        _set(connection, ids[1], status="DRAFT", due_at=now - timedelta(days=2))
        late = connection.execute(
            "SELECT milestone_key, name FROM engagement_milestones WHERE project_id = %s "
            "AND completed_at IS NULL ORDER BY due_date, position LIMIT 1",
            (team["project"],),
        ).fetchone()
        assert late is not None
        connection.execute(
            "UPDATE engagement_milestones SET due_date = %s "
            "WHERE project_id = %s AND milestone_key = %s",
            (now.date() - timedelta(days=1), team["project"], late[0]),
        )
        tasks = connection.execute(
            "SELECT status::text, count(*) FROM tasks WHERE project_id = %s GROUP BY status",
            (team["project"],),
        ).fetchall()
        newest_row = connection.execute(
            "SELECT max(occurred_at) FROM audit_events WHERE project_id = %s", (team["project"],)
        ).fetchone()
        assert newest_row is not None and newest_row[0] is not None
        newest = newest_row[0]
        connection.commit()
    card = next(
        item
        for item in client.get(f"/organizations/{team['org']}/projects").json()
        if item["id"] == str(team["project"])
    )
    # Agent tasks by status, as the engagement's own page counts them.
    assert {(item["status"], item["count"]) for item in card["progress"]} == {
        (str(status), int(count)) for status, count in tasks
    }
    # Only a request that went out can be late: the late draft is not counted.
    assert card["overdue_requests"] == 1
    # The next milestone not done, and the one now missed.
    assert card["next_milestone"] == {
        "name": late[1],
        "due": (now.date() - timedelta(days=1)).isoformat(),
    }
    assert card["missed_milestones"] == 1
    # When anything last happened on it: its newest audit event.
    assert datetime.fromisoformat(card["last_activity_at"]) == newest
    # Who is on it, by name, the lead first.
    with connect(migrated.url) as connection:
        lead = connection.execute(
            "SELECT coalesce(nullif(u.display_name, ''), u.email::text) FROM projects p "
            "JOIN users u ON u.id = p.owner_user_id WHERE p.id = %s",
            (team["project"],),
        ).fetchone()
        members = connection.execute(
            "SELECT count(DISTINCT pm.user_id) FROM project_memberships pm "
            "JOIN memberships m ON m.user_id = pm.user_id "
            "AND m.organization_id = pm.organization_id "
            "WHERE pm.project_id = %s AND m.status = 'ACTIVE'",
            (team["project"],),
        ).fetchone()
    assert lead is not None and members is not None
    assert card["team"][0] == lead[0]
    assert len(card["team"]) == members[0]
