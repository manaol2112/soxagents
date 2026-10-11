import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import (
    _add_project_member,
    _add_user,
    _approved,
    _client,
    _count,
    _execute,
    _external,
    _insert_expired,
    _ready,
)

from ai_workforce_api.actions import CATALOG
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.policy import evaluate

_SAMPLES = {
    "reference": "evidence/population",
    "email": "audit@example.com",
    "text": "Population request",
    "role": "REVIEWER",
}


def test_agents_cannot_bypass_policy(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "agent")
    before = (_count(migrated, "tasks"), _count(migrated, "action_executions"))
    with connect(migrated.url) as connection:
        agent = Principal(kind=PrincipalKind.AGENT, id=uuid4())
        for action in CATALOG:
            decision = evaluate(
                connection,
                agent,
                seeded["organization_id"],
                project_id,
                action.action_id,
                _parameters(action.action_id),
            )
            assert decision.decision == "DENY"
            expected = "agent" if action.action_id == "permission.modify" else "permission"
            assert decision.reason == expected
        certified = evaluate(
            connection,
            agent,
            seeded["organization_id"],
            project_id,
            "file.read",
            {"resource_ref": "evidence/population", "safe": "true"},
        )
    assert certified.decision == "DENY"
    assert certified.reason == "invalid"
    forged = client.post(
        _execute(seeded, project_id),
        json={
            "action_id": "mail.external",
            "parameters": {
                "recipient": "audit@example.com",
                "subject": "Population request",
                "approved": "true",
            },
        },
    )
    assert forged.status_code == 422
    assert (_count(migrated, "tasks"), _count(migrated, "action_executions")) == before


def test_closed_approvals_cannot_execute(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "closed")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
        contributor = _add_user(
            connection, seeded["organization_id"], "contributor@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, seeded["organization_id"], project_id, contributor)
    admin_client = _client(migrated, admin)
    requested = client.post(_approvals(seeded, project_id), json=_external("first@example.com"))
    assert requested.status_code == 200
    own = client.post(_decision(seeded, project_id, requested.json()["id"]), json=_reason())
    assert own.status_code == 409
    assert own.json()["detail"] == "requester cannot approve"
    member = _client(migrated, contributor)
    denied = member.post(_decision(seeded, project_id, requested.json()["id"]), json=_reason())
    assert denied.status_code == 403
    approved = admin_client.post(
        _decision(seeded, project_id, requested.json()["id"]), json=_reason()
    )
    assert approved.status_code == 200
    first = client.post(
        _execute(seeded, project_id),
        json={**_external("first@example.com"), "approval_id": requested.json()["id"]},
    )
    assert first.status_code == 200
    assert first.json()["status"] == "SUCCEEDED"
    repeat = client.post(
        _execute(seeded, project_id),
        json={**_external("first@example.com"), "approval_id": requested.json()["id"]},
    )
    assert repeat.json()["id"] == first.json()["id"]
    changed = client.post(
        _execute(seeded, project_id),
        json={**_external("second@example.com"), "approval_id": requested.json()["id"]},
    )
    assert changed.status_code == 409
    assert changed.json()["detail"] == "approval does not match"
    rejected = _approved(
        client, admin_client, seeded, project_id, _external("rejected@example.com"), "REJECTED"
    )
    blocked = client.post(_execute(seeded, project_id), json=rejected)
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "approval is not approved"
    expired = client.post(
        _execute(seeded, project_id),
        json={
            **_external("late@example.com"),
            "approval_id": str(_insert_expired(migrated, seeded, project_id)),
        },
    )
    assert expired.status_code == 409
    assert expired.json()["detail"] == "approval has expired"
    assert _count(migrated, "action_executions") == 1
    assert "second@example.com" not in _audit_text(migrated)


def test_missing_policy_data_fails_closed(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "missing")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
    admin_client = _client(migrated, admin)
    unknown = client.post(
        f"/organizations/{seeded['organization_id']}/projects/{uuid4()}/actions/decide",
        json={"action_id": "file.read", "parameters": {"resource_ref": "evidence/population"}},
    )
    assert unknown.status_code == 404
    unregistered = client.post(
        _decide(seeded, project_id),
        json={"action_id": "mail.send", "parameters": {}},
    )
    assert unregistered.json() == {
        "action_id": "mail.send",
        "decision": "DENY",
        "reason": "unregistered",
    }
    incomplete = client.post(
        _execute(seeded, project_id),
        json={"action_id": "task.create", "parameters": {}},
    )
    assert incomplete.status_code == 422
    missing_approval = client.post(
        _execute(seeded, project_id),
        json={**_external("audit@example.com"), "approval_id": str(uuid4())},
    )
    assert missing_approval.status_code == 404
    held = _approved(client, admin_client, seeded, project_id, _external("held@example.com"))
    with connect(migrated.url) as connection:
        connection.execute("UPDATE projects SET status = 'PAUSED' WHERE id = %s", (project_id,))
        connection.commit()
    paused = client.post(_execute(seeded, project_id), json=held)
    assert paused.status_code == 409
    assert paused.json()["detail"] == "action is not allowed"
    stored = client.get(f"{_approvals(seeded, project_id)}/{held['approval_id']}")
    assert stored.json()["execution_status"] == "NOT_STARTED"
    creating = client.post(
        _execute(seeded, project_id),
        json={"action_id": "task.create", "parameters": {"title": "Prepare the population"}},
    )
    assert creating.status_code == 409
    assert _count(migrated, "tasks") == 0
    assert _count(migrated, "action_executions") == 0


def test_races_do_not_duplicate_side_effects(migrated: Database) -> None:
    seeded, project_id, client = _ready(migrated, "race")
    with connect(migrated.url) as connection:
        admin = _add_user(connection, seeded["organization_id"], "admin@example.com", "ADMIN")
    callers = [_client(migrated, seeded["user_id"]) for _index in range(2)]
    requested = _together(
        lambda caller: caller.post(
            _approvals(seeded, project_id), json=_external("race@example.com")
        ),
        callers,
    )
    assert [item.status_code for item in requested] == [200, 200]
    assert requested[0].json()["id"] == requested[1].json()["id"]
    assert _approval_count(migrated, project_id) == 1
    admins = [_client(migrated, admin) for _index in range(2)]
    decided = _together(
        lambda caller: caller.post(
            _decision(seeded, project_id, requested[0].json()["id"]), json=_reason()
        ),
        admins,
    )
    assert sorted(item.status_code for item in decided) == [200, 409]
    assert _approval_count(migrated, project_id) == 1
    body = {**_external("race@example.com"), "approval_id": requested[0].json()["id"]}
    executed = _together(
        lambda caller: caller.post(_execute(seeded, project_id), json=body), callers
    )
    assert [item.status_code for item in executed] == [200, 200]
    assert executed[0].json()["id"] == executed[1].json()["id"]
    assert executed[0].json()["status"] == "SUCCEEDED"
    assert _count(migrated, "mailbox_messages") == 1
    task = {"action_id": "task.create", "parameters": {"title": "Prepare the population"}}
    with connect(migrated.url) as connection:
        connection.execute("UPDATE projects SET status = 'ACTIVE' WHERE id = %s", (project_id,))
        connection.commit()
    created = _together(
        lambda caller: caller.post(_execute(seeded, project_id), json=task), callers
    )
    assert [item.status_code for item in created] == [200, 200]
    assert created[0].json()["id"] == created[1].json()["id"]
    assert _count(migrated, "tasks") == 1
    assert _count(migrated, "action_executions") == 2
    assert client.get("/health").json()["live_email_enabled"] is False


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _together(work: Any, clients: list[TestClient]) -> list[Any]:
    barrier = threading.Barrier(len(clients))

    def run(caller: TestClient) -> Any:
        barrier.wait()
        return work(caller)

    with ThreadPoolExecutor(max_workers=len(clients)) as pool:
        return list(pool.map(run, clients))


def _parameters(action_id: str) -> dict[str, str]:
    action = next(item for item in CATALOG if item.action_id == action_id)
    return {field.name: _SAMPLES[field.kind] for field in action.fields}


def _approvals(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/approvals"


def _decision(seeded: dict[str, Any], project_id: UUID, approval_id: str) -> str:
    return f"{_approvals(seeded, project_id)}/{approval_id}/decision"


def _decide(seeded: dict[str, Any], project_id: UUID) -> str:
    return f"/organizations/{seeded['organization_id']}/projects/{project_id}/actions/decide"


def _reason() -> dict[str, str]:
    return {"decision": "APPROVED", "reason": "Checked"}


def _approval_count(database: Database, project_id: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM approvals WHERE project_id = %s", (project_id,)
        ).fetchone()
    if row is None or not isinstance(row[0], int):
        return 0
    return row[0]


def _audit_text(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT payload::text FROM audit_events").fetchall()
    return str(rows)
