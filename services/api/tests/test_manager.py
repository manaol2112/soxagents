from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.models import ModelConfig, ModelProvider, ModelRaw, ModelRequest
from ai_workforce_api.settings import Settings

OBJECTIVE = "Request the population file. Review the sample selection."


def test_a_grounded_plan_creates_draft_tasks_in_order(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "plan", active=True)
    created = client.post(
        _plans(seeded, project_id),
        json={"objective": OBJECTIVE},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["status"] == "CREATED"
    assert body["assumptions"] == []
    assert len(body["task_ids"]) == 2
    first = client.get(f"{_tasks(seeded, project_id)}/{body['task_ids'][0]}")
    second = client.get(f"{_tasks(seeded, project_id)}/{body['task_ids'][1]}")
    assert first.json()["title"] == "Request the population file"
    assert first.json()["status"] == "DRAFT"
    assert first.json()["deadline"] is None
    assert second.json()["depends_on"][0]["title"] == "Request the population file"
    with connect(migrated.url) as connection:
        run = connection.execute(
            "SELECT status::text FROM workflow_runs WHERE project_id = %s",
            (project_id,),
        ).fetchone()
    assert run == ("RUNNING",)


def test_a_created_plan_is_submitted_once_for_durable_execution(migrated: Database) -> None:
    class Submitted:
        def __init__(self) -> None:
            self.count = 0

        def attach(
            self,
            run: object,
            organization_id: UUID,
            project_id: UUID,
            timer_seconds: int,
        ) -> None:
            del run, organization_id, project_id, timer_seconds
            self.count += 1

    submitted = Submitted()
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "durable-plan", "durable-plan@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"], True)
    settings = Settings(database_url=migrated.url, session_cookie_secure=False, model_provider="")
    token = uuid4().hex
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (seeded["user_id"], token_hash(token)),
        )
        connection.commit()
    client = TestClient(
        create_app(
            settings,
            durable=submitted,
            model_provider=_Plan(
                [
                    ("Request the population file", []),
                    ("Review the sample selection", ["Request the population file"]),
                ]
            ),
        ),
        cookies={"aw_session": token},
    )
    created = client.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert created.status_code == 200
    assert submitted.count == 1
    invented = client.post(_plans(seeded, project_id), json={"objective": "file"})
    assert invented.json()["status"] == "CLARIFICATION"
    assert submitted.count == 1


def test_invented_cycle_and_policy_plans_do_not_create_tasks(migrated: Database) -> None:
    seeded, project_id, _ = _ready(migrated, "reject", active=True)
    invented = _client(migrated, seeded["user_id"], _Plan([("file", [])]))
    response = invented.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert response.status_code == 200
    assert response.json()["status"] == "CLARIFICATION"
    assert "invented_title" in response.json()["assumptions"]
    assert response.json()["task_ids"] == []
    cycle = _client(
        migrated,
        seeded["user_id"],
        _Plan(
            [
                ("Request the population file", ["Review the sample selection"]),
                ("Review the sample selection", ["Request the population file"]),
            ]
        ),
    )
    cycled = cycle.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert cycled.json()["status"] == "CLARIFICATION"
    assert "dependency" in cycled.json()["assumptions"]
    policy = _client(migrated, seeded["user_id"], _Plan([("Request the population file", [])]))
    refused = policy.post(
        _plans(seeded, project_id),
        json={"objective": "Please send email to the client about the population."},
    )
    assert refused.json()["status"] == "ESCALATED"
    assert refused.json()["assumptions"] == ["policy"]
    assert _task_count(migrated, project_id) == 0


def test_replanning_uses_the_blocker_and_leaves_the_blocked_task(migrated: Database) -> None:
    seeded, project_id, _ = _ready(migrated, "replan", active=True)
    with connect(migrated.url) as connection:
        _block(connection, seeded["organization_id"], project_id, "Collect the missing file")
    client = _client(
        migrated,
        seeded["user_id"],
        _Plan([("Collect the missing file", ["Wait for the file"])]),
    )
    created = client.post(
        _plans(seeded, project_id),
        json={"objective": "Replan the blocked work.", "operation": "replan"},
    )
    assert created.status_code == 200
    assert created.json()["status"] == "CREATED"
    assert created.json()["blocked"][0]["blocker"] == "Collect the missing file"
    tasks = client.get(_tasks(seeded, project_id)).json()
    blocked = next(item for item in tasks if item["title"] == "Wait for the file")
    assert blocked["status"] == "BLOCKED"
    follow = next(item for item in tasks if item["title"] == "Collect the missing file")
    detail = client.get(f"{_tasks(seeded, project_id)}/{follow['id']}").json()
    assert [item["title"] for item in detail["depends_on"]] == ["Wait for the file"]


def test_limits_inactive_projects_and_secrets_stop_the_manager(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "limit", active=True)
    for _ in range(3):
        made = client.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
        assert made.json()["status"] == "CREATED"
    stopped = client.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert stopped.json()["status"] == "ESCALATED"
    assert stopped.json()["assumptions"] == ["limit"]
    assert _task_count(migrated, project_id) == 6
    draft, draft_project, draft_client = _ready(migrated, "draft", active=False)
    refused = draft_client.post(_plans(draft, draft_project), json={"objective": OBJECTIVE})
    assert refused.json()["status"] == "REFUSED"
    assert refused.json()["assumptions"] == ["inactive_project"]
    leaked = client.post(_plans(seeded, project_id), json={"objective": "api_key=sk-live-example"})
    assert leaked.status_code == 422
    assert "sk-live-example" not in _stored_plans(migrated)


def test_reviewer_can_read_a_plan_and_cannot_create_one(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "review", "owner@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"], True)
        reviewer = _add_user(
            connection, seeded["organization_id"], "reviewer@example.com", "REVIEWER"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, reviewer)
    owner = _client(migrated, seeded["user_id"], _Plan([("Request the population file", [])]))
    created = owner.post(
        _plans(seeded, project_id), json={"objective": "Request the population file."}
    )
    assert created.status_code == 200
    reader = _client(migrated, reviewer)
    assert reader.get(f"{_plans(seeded, project_id)}/{created.json()['id']}").status_code == 200
    denied = reader.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert denied.status_code == 403


def test_the_local_model_does_not_invent_tasks(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "local", active=True, provider=None)
    created = client.post(_plans(seeded, project_id), json={"objective": OBJECTIVE})
    assert created.status_code == 200
    assert created.json()["status"] == "CLARIFICATION"
    assert created.json()["assumptions"] == ["ambiguous"]
    assert created.json()["task_ids"] == []


def test_manager_module_does_not_import_langgraph() -> None:
    source = (Path(__file__).parents[1] / "ai_workforce_api" / "manager.py").read_text(
        encoding="utf-8"
    )
    assert "langgraph" not in source.lower()


class _Plan:
    def __init__(self, tasks: list[tuple[str, list[str]]]) -> None:
        self.tasks = tasks

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        output = {
            "tasks": [{"title": title, "depends_on": depends} for title, depends in self.tasks]
        }
        return ModelRaw(output, (), 4, 4)


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _ready(
    database: Database, slug: str, *, active: bool, provider: ModelProvider | None = None
) -> tuple[dict[str, Any], UUID, TestClient]:
    with connect(database.url) as connection:
        seeded = _seed_org(connection, slug, f"{slug}@example.com")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"], active)
    chosen = provider
    if chosen is None and slug != "local":
        chosen = _Plan(
            [
                ("Request the population file", []),
                ("Review the sample selection", ["Request the population file"]),
            ]
        )
    return seeded, project_id, _client(database, seeded["user_id"], chosen)


def _plans(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/manager-plans"


def _tasks(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/tasks"


def _client(database: Database, user_id: UUID, provider: ModelProvider | None = None) -> TestClient:
    settings = Settings(database_url=database.url, session_cookie_secure=False, model_provider="")
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (user_id, token_hash(token)),
        )
        connection.commit()
    return TestClient(create_app(settings, model_provider=provider), cookies={"aw_session": token})


def _task_count(database: Database, project_id: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s", (project_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _stored_plans(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT objective, status, assumptions::text FROM manager_plans"
        ).fetchall()
    return str(rows)


def _block(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, blocker: str
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO tasks (organization_id, project_id, title, status, blocker)
            VALUES (%s, %s, 'Wait for the file', 'BLOCKED', %s)
            """,
            (organization_id, project_id, blocker),
        )
    connection.commit()


def _seed_org(connection: psycopg.Connection[Any], slug: str, email: str) -> dict[str, Any]:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (slug, slug),
        )
        organization_id = cursor.fetchone()
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        user_id = cursor.fetchone()
        if organization_id is None or user_id is None:
            raise RuntimeError("seed failed")
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, 'OWNER')",
            (organization_id[0], user_id[0]),
        )
    connection.commit()
    return {"organization_id": organization_id[0], "user_id": user_id[0]}


def _seed_project(
    connection: psycopg.Connection[Any], organization_id: UUID, user_id: UUID, active: bool
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO projects (organization_id, name, slug, owner_user_id, status)
            VALUES (%s, 'SOX', %s, %s, %s)
            RETURNING id
            """,
            (organization_id, f"sox-{uuid4().hex[:8]}", user_id, "ACTIVE" if active else "DRAFT"),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise RuntimeError("seed failed")
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            """,
            (organization_id, row[0], user_id),
        )
    connection.commit()
    return row[0]


def _add_user(
    connection: psycopg.Connection[Any], organization_id: UUID, email: str, role: str
) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email),
        )
        row = cursor.fetchone()
        if row is None or not isinstance(row[0], UUID):
            raise RuntimeError("seed failed")
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, %s)",
            (organization_id, row[0], role),
        )
    connection.commit()
    return row[0]


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
    connection.commit()
