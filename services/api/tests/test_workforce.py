from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _ready, _seed_project
from test_outbound import _session, migrated

from ai_workforce_api.actions import find_action
from ai_workforce_api.db import connect
from ai_workforce_api.workforce import (
    FORBIDDEN_ACTIONS,
    STANDARD_KEYS,
    STANDARD_WORKFORCE,
    roster_fingerprint,
    roster_problems,
    sync_standard_workforce,
)

__all__ = ["migrated"]

_REVIEWED_ROSTER = "ff559e0e558520b4ab27b579b9a03d389190449a4ad48b93c7397a4042153a57"


def test_the_roster_is_the_reviewed_version() -> None:
    assert roster_fingerprint() == _REVIEWED_ROSTER


def test_the_roster_follows_the_safety_rules() -> None:
    assert roster_problems() == []
    assert len(STANDARD_WORKFORCE) == 8
    for worker in STANDARD_WORKFORCE:
        assert not set(worker.allowed_tool_ids) & FORBIDDEN_ACTIONS
    assert _worker("independent-reviewer").allowed_tool_ids == ["file.read"]
    finalize = find_action("report.finalize")
    assert finalize is not None and finalize.approval != "NONE"
    for tool in ("mail.pbc", "mail.reminder"):
        action = find_action(tool)
        assert action is not None and action.approval != "NONE"


def test_a_deploy_gives_existing_firms_and_engagements_the_workforce(
    migrated: Database,
) -> None:
    seeded, project_id, owner = _ready(migrated, "existing")
    assert _count(migrated, "SELECT count(*) FROM agent_definitions") == 0
    first = _sync(migrated)
    assert (first.installed, first.staffed, first.updated) == (8, 8, 0)
    second = _sync(migrated)
    assert (second.installed, second.staffed, second.updated, second.retired) == (0, 0, 0, 0)
    listed = owner.get(f"/organizations/{seeded['organization_id']}/agents").json()
    assert sorted(item["agent_key"] for item in listed) == sorted(STANDARD_KEYS)
    assert {item["source"] for item in listed} == {"standard"}
    instances = owner.get(f"{_project(seeded, project_id)}/agent-instances").json()
    assert len(instances) == 8
    roster = owner.get(f"{_roster(seeded)}?project_id={project_id}").json()
    assert all(w["installed"] and w["staffed"] for w in roster["workers"])


def test_new_firms_and_engagements_are_staffed_without_anyone_acting(
    migrated: Database,
) -> None:
    _sync(migrated)
    seeded, project_id, owner = _ready(migrated, "fresh")
    listed = owner.get(f"/organizations/{seeded['organization_id']}/agents").json()
    assert len(listed) == 8
    instances = owner.get(f"{_project(seeded, project_id)}/agent-instances").json()
    tester = next(i for i in instances if i["name"] == "ITGC tester: access")
    task = owner.post(
        f"{_project(seeded, project_id)}/tasks",
        json={"title": "Test user provisioning", "agent_instance_id": tester["id"]},
    )
    assert task.status_code == 201
    with connect(migrated.url) as connection:
        actors = connection.execute(
            """
            SELECT DISTINCT action, actor_user_id IS NULL FROM audit_events
            WHERE organization_id = %s AND action IN ('agent.created', 'agent_instance.staffed')
            """,
            (seeded["organization_id"],),
        ).fetchall()
    assert sorted(actors) == [("agent.created", True), ("agent_instance.staffed", True)]


def test_a_disabled_worker_skips_new_engagements_and_rejoins_when_enabled(
    migrated: Database,
) -> None:
    _sync(migrated)
    seeded, _project_id, owner = _ready(migrated, "toggle")
    reviewer = _definition(owner, seeded, "independent-reviewer")
    disabled = owner.patch(_agent(seeded, reviewer["id"]), json=_editable(reviewer, "DISABLED"))
    assert disabled.status_code == 200
    with connect(migrated.url) as connection:
        later = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
    names = {i["name"] for i in owner.get(f"{_project(seeded, later)}/agent-instances").json()}
    assert "Independent reviewer" not in names and len(names) == len(STANDARD_WORKFORCE) - 1
    current = _definition(owner, seeded, "independent-reviewer")
    enabled = owner.patch(_agent(seeded, current["id"]), json=_editable(current, "ACTIVE"))
    assert enabled.status_code == 200
    names = {i["name"] for i in owner.get(f"{_project(seeded, later)}/agent-instances").json()}
    assert "Independent reviewer" in names
    assert _sync(migrated).updated == 0


def test_standard_workers_are_locked_and_keys_reserved(migrated: Database) -> None:
    _sync(migrated)
    seeded, _project_id, owner = _ready(migrated, "locked")
    planner = _definition(owner, seeded, "engagement-planner")
    renamed = owner.patch(
        _agent(seeded, planner["id"]), json={**_editable(planner, "ACTIVE"), "name": "Ours"}
    )
    assert renamed.status_code == 409
    assert renamed.json()["detail"] == "standard agents are managed by the platform"
    widened = owner.patch(
        _agent(seeded, planner["id"]),
        json={**_editable(planner, "ACTIVE"), "allowed_tool_ids": ["permission.modify"]},
    )
    assert widened.status_code == 409
    taken = owner.post(
        f"/organizations/{seeded['organization_id']}/agents",
        json={**_custom("custom-one"), "agent_key": "engagement-planner"},
    )
    assert taken.status_code == 409
    custom = owner.post(f"/organizations/{seeded['organization_id']}/agents", json=_custom("ours"))
    assert custom.status_code == 201
    assert custom.json()["source"] == "custom"
    for statement in (
        "UPDATE agent_definitions SET name = 'x', version = version + 1"
        " WHERE agent_key = 'engagement-planner'",
        "UPDATE agent_definitions SET allowed_tool_ids = ARRAY['permission.modify']"
        " WHERE agent_key = 'independent-reviewer'",
        "UPDATE agent_definitions SET source = 'custom', roster_version = NULL"
        " WHERE agent_key = 'engagement-planner'",
        "UPDATE agent_definitions SET source = 'standard', roster_version = 1"
        " WHERE agent_key = 'ours'",
        "DELETE FROM agent_definitions WHERE agent_key = 'engagement-planner'",
    ):
        with pytest.raises(psycopg.errors.RaiseException):
            with connect(migrated.url) as connection:
                connection.execute(statement)


def test_a_deploy_restores_drift_and_keeps_a_firm_disable(migrated: Database) -> None:
    _sync(migrated)
    seeded, _project_id, owner = _ready(migrated, "drift")
    reviewer = _definition(owner, seeded, "independent-reviewer")
    owner.patch(_agent(seeded, reviewer["id"]), json=_editable(reviewer, "DISABLED"))
    with connect(migrated.url) as connection:
        with connection.transaction():
            connection.execute("SELECT set_config('app.standard_sync', 'on', true)")
            connection.execute(
                "UPDATE agent_definitions SET name = 'Drifted', version = version + 1"
                " WHERE agent_key = 'engagement-planner'"
            )
    result = _sync(migrated)
    assert result.updated == 1
    assert _definition(owner, seeded, "engagement-planner")["name"] == "Engagement planner"
    assert _definition(owner, seeded, "independent-reviewer")["status"] == "DISABLED"


def test_only_owners_and_admins_manage_agents(migrated: Database) -> None:
    _sync(migrated)
    seeded, project_id, owner = _ready(migrated, "roles")
    org = seeded["organization_id"]
    with connect(migrated.url) as connection:
        admin_id = _add_user(connection, org, f"admin-{uuid4().hex[:6]}@example.com", "ADMIN")
        manager_id = _add_user(
            connection, org, f"pm-{uuid4().hex[:6]}@example.com", "PROJECT_MANAGER"
        )
        _add_project_member(connection, org, project_id, manager_id)
    admin = _session(migrated, admin_id)
    manager = _session(migrated, manager_id)
    assert admin.post(f"/organizations/{org}/agents", json=_custom("by-admin")).status_code == 201
    assert manager.post(f"/organizations/{org}/agents", json=_custom("by-pm")).status_code == 403
    planner = _definition(owner, seeded, "engagement-planner")
    pm_disable = manager.patch(_agent(seeded, planner["id"]), json=_editable(planner, "DISABLED"))
    assert pm_disable.status_code == 403
    instances = manager.get(f"{_project(seeded, project_id)}/agent-instances").json()
    assignable = manager.post(
        f"{_project(seeded, project_id)}/tasks",
        json={"title": "Plan the walkthroughs", "agent_instance_id": instances[0]["id"]},
    )
    assert assignable.status_code == 201
    _other, _project_id, stranger = _ready(migrated, "stranger")
    assert stranger.get(_roster(seeded)).status_code == 404


# Helpers


def _sync(database: Database) -> Any:
    with connect(database.url) as connection:
        return sync_standard_workforce(connection)


def _worker(key: str) -> Any:
    return next(worker for worker in STANDARD_WORKFORCE if worker.agent_key == key)


def _definition(client: TestClient, seeded: dict[str, Any], key: str) -> dict[str, Any]:
    listed = client.get(f"/organizations/{seeded['organization_id']}/agents").json()
    summary = next(item for item in listed if item["agent_key"] == key)
    detail: dict[str, Any] = client.get(_agent(seeded, summary["id"])).json()
    return detail


def _editable(detail: dict[str, Any], status: str) -> dict[str, Any]:
    fields = (
        "agent_key",
        "name",
        "role",
        "description",
        "input_schema",
        "output_schema",
        "allowed_tool_ids",
        "model_config_ref",
        "max_iterations",
        "time_budget_seconds",
        "version",
    )
    return {**{field: detail[field] for field in fields}, "status": status}


def _custom(key: str) -> dict[str, Any]:
    return {
        "agent_key": key,
        "name": "Firm SOD analyst",
        "role": "Reviews segregation of duties",
        "description": "",
        "input_schema": {"type": "object", "properties": {}},
        "output_schema": {"type": "object", "properties": {}},
        "allowed_tool_ids": ["file.read"],
        "model_config_ref": "standard",
        "max_iterations": 4,
        "time_budget_seconds": 600,
    }


def _agent(seeded: dict[str, Any], agent_id: str) -> str:
    return f"/organizations/{seeded['organization_id']}/agents/{agent_id}"


def _project(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}"


def _roster(seeded: dict[str, Any]) -> str:
    return f"/organizations/{seeded['organization_id']}/standard-workforce"


def _count(database: Database, query: str) -> int:
    with connect(database.url) as connection:
        row = connection.execute(query).fetchone()
    return 0 if row is None or not isinstance(row[0], int) else row[0]
