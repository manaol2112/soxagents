"""The synthetic demo's invitation and initialization (Trial Management and Synthetic Demo
Experience, Step 3; migration 0128, demo.py, demo_datasets.py): a firm on the trial is
invited once, each person's answer is kept, only an allowed member of a running trial can
start the demo, requests arriving together make one demo engagement, a failed build is
retried from the same record, the demo is marked by the server alone and outside the
trial's allowances, and another firm sees none of it."""

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _seed_org
from test_outbound import _session, migrated
from test_subscriptions import (
    _end_trial,
    _limit_error,
    _member,
    _project,
    _sign_in,
    _sign_up,
    _upload,
)

from ai_workforce_api import demo_datasets
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.demo_datasets import DemoContext, PlaceholderDataset

__all__ = ["migrated"]

PLACEHOLDER = {"demo_dataset": "placeholder/0"}


def _demo(client: TestClient, organization_id: UUID) -> dict[str, Any]:
    answer = client.get(f"/organizations/{organization_id}/demo")
    assert answer.status_code == 200, answer.text
    body: dict[str, Any] = answer.json()
    return body


def _initialize(client: TestClient, organization_id: UUID) -> Any:
    return client.post(f"/organizations/{organization_id}/demo/initialize")


def _dismiss(client: TestClient, organization_id: UUID) -> Any:
    return client.post(
        f"/organizations/{organization_id}/demo/invitation", json={"response": "DISMISSED"}
    )


def _record(url: str, organization_id: UUID) -> dict[str, Any] | None:
    with connect(url) as connection:
        row = connection.execute(
            """
            SELECT state::text, dataset_key, project_id, attempts, resets, failure
            FROM organization_demos WHERE organization_id = %s
            """,
            (organization_id,),
        ).fetchone()
    if row is None:
        return None
    keys = ("state", "dataset_key", "project_id", "attempts", "resets", "failure")
    return dict(zip(keys, row, strict=True))


def _demo_projects(url: str, organization_id: UUID) -> list[tuple[Any, ...]]:
    with connect(url) as connection:
        return connection.execute(
            "SELECT id, slug, status::text FROM projects "
            "WHERE organization_id = %s AND demo ORDER BY created_at",
            (organization_id,),
        ).fetchall()


def _audit_actions(url: str, organization_id: UUID) -> list[str]:
    with connect(url) as connection:
        rows = connection.execute(
            "SELECT action FROM audit_events WHERE organization_id = %s AND action LIKE 'demo.%%' "
            "ORDER BY occurred_at",
            (organization_id,),
        ).fetchall()
    return [str(row[0]) for row in rows]


# The invitation


def test_a_new_trial_firm_is_invited_at_first_login(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated)
    body = _demo(client, organization_id)
    assert (body["eligible"], body["reason"], body["can_initialize"]) == (True, "", True)
    assert (body["invitation"], body["invited"]) == ("PENDING", True)
    assert (body["state"], body["project_id"], body["attempts"]) == ("NOT_INITIALIZED", None, 0)
    # No dataset is configured by default: nothing is presented as a demo yet.
    assert (body["dataset_available"], body["dataset_complete"]) == (False, False)
    assert _record(migrated.url, organization_id) is None


def test_only_a_firm_on_the_trial_is_invited(migrated: Database) -> None:
    # An internal firm (every firm from before the trial, and the preview workspace).
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "internal")
    client = _session(migrated, seeded["user_id"])
    body = _demo(client, seeded["organization_id"])
    assert (body["eligible"], body["reason"], body["invited"]) == (False, "not-trial", False)
    assert body["can_initialize"] is False
    refused = _initialize(client, seeded["organization_id"])
    assert refused.status_code == 403, refused.text
    assert refused.json() == {
        "detail": "the demo is for firms on the free trial",
        "code": "DEMO_NOT_AVAILABLE",
        "reason": "not-trial",
    }
    # A paid firm, whatever it was before.
    client, organization_id, _ = _sign_up(migrated, "paid@firm.example")
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE organization_subscriptions SET status = 'ACTIVE', plan_type = 'PAID', "
            "status_reason = 'test: paid', version = version + 1 WHERE organization_id = %s",
            (organization_id,),
        )
    body = _demo(client, organization_id)
    assert (body["eligible"], body["reason"], body["invited"]) == (False, "not-trial", False)
    assert _initialize(client, organization_id).status_code == 403
    assert _demo_projects(migrated.url, organization_id) == []


def test_a_dismissed_invitation_is_not_asked_again(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated)
    answered = _dismiss(client, organization_id)
    assert answered.status_code == 200, answered.text
    assert (answered.json()["invitation"], answered.json()["invited"]) == ("DISMISSED", False)
    # Signing in again, the answer stands; the firm stays eligible, so the account menu
    # still offers the demo.
    _sign_in(client)
    body = _demo(client, organization_id)
    assert (body["invitation"], body["invited"], body["eligible"]) == ("DISMISSED", False, True)
    assert _audit_actions(migrated.url, organization_id) == ["demo.invitation_dismissed"]
    # Nothing was made for a person who declined.
    assert _record(migrated.url, organization_id) is None
    assert _demo_projects(migrated.url, organization_id) == []


def test_the_invitation_can_be_taken_up_later_and_waits_for_the_dataset(
    migrated: Database,
) -> None:
    """A person who declined changes their mind. No dataset is configured: the answer is
    kept, nothing is built, and the web says the demo is being prepared."""
    client, organization_id, _ = _sign_up(migrated)
    assert _dismiss(client, organization_id).status_code == 200
    started = _initialize(client, organization_id)
    assert started.status_code == 200, started.text
    body = started.json()
    assert (body["invitation"], body["invited"]) == ("ACCEPTED", False)
    assert (body["state"], body["dataset_available"], body["project_id"]) == (
        "NOT_INITIALIZED",
        False,
        None,
    )
    record = _record(migrated.url, organization_id)
    assert record is not None and (record["state"], record["attempts"]) == ("NOT_INITIALIZED", 0)
    assert _demo_projects(migrated.url, organization_id) == []
    assert _audit_actions(migrated.url, organization_id) == [
        "demo.invitation_dismissed",
        "demo.requested",
    ]


# Initialization


def test_an_allowed_member_starts_the_demo_outside_the_trials_allowances(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    assert _demo(client, organization_id)["dataset_available"] is True
    started = _initialize(client, organization_id)
    assert started.status_code == 200, started.text
    body = started.json()
    assert (body["state"], body["invitation"], body["invited"]) == ("READY", "ACCEPTED", False)
    assert (body["dataset_key"], body["dataset_complete"]) == ("placeholder/0", False)
    demo_id = UUID(body["project_id"])
    assert _demo_projects(migrated.url, organization_id) == [(demo_id, "northstar-demo", "DRAFT")]
    assert _audit_actions(migrated.url, organization_id) == ["demo.initialized"]

    # Told apart in the engagements list and the record, never by its name alone.
    base = f"/organizations/{organization_id}/projects"
    listed = {item["id"]: item for item in client.get(base).json()}
    assert listed[str(demo_id)]["demo"] is True
    assert listed[str(demo_id)]["client_name"] == "Northstar Technologies"
    detail = client.get(f"{base}/{demo_id}").json()
    assert (detail["demo"], detail["status"], detail["launched"]) == (True, "DRAFT", False)

    # The demo counts for nothing: the firm's own engagement, system and files are still
    # allowed, and the demo's own take nothing from them.
    usage = client.get(f"/organizations/{organization_id}/subscription").json()["usage"]
    assert (usage["engagements"], usage["systems"], usage["uploads"]) == (0, 0, 0)
    own = _project(client, organization_id, user_id, "sox-fy27")
    assert own.status_code == 201, own.text
    own_id = own.json()["id"]
    assert listed.get(own_id) is None
    assert {item["id"]: item["demo"] for item in client.get(base).json()} == {
        str(demo_id): True,
        own_id: False,
    }
    demo_systems = f"{base}/{demo_id}/onboarding/applications"
    for name in ("SAP S/4HANA", "Microsoft Entra ID", "Snowflake"):
        assert client.post(demo_systems, json={"name": name}).status_code == 200
    own_systems = f"{base}/{own_id}/onboarding/applications"
    assert client.post(own_systems, json={"name": "Workday"}).status_code == 200
    refused = client.post(own_systems, json={"name": "Oracle"})
    assert refused.status_code == 402 and refused.json()["resource"] == "systems"
    with connect(migrated.url) as connection:
        for _ in range(12):
            _upload(connection, organization_id, demo_id, user_id, 1)
        for _ in range(10):
            _upload(connection, organization_id, own_id, user_id, 1)
        with pytest.raises(psycopg.Error) as eleventh:
            _upload(connection, organization_id, own_id, user_id, 1)
        assert _limit_error(eleventh.value) == "uploads"
    usage = client.get(f"/organizations/{organization_id}/subscription").json()["usage"]
    assert (usage["engagements"], usage["systems"], usage["uploads"]) == (1, 1, 10)
    assert _project(client, organization_id, user_id, "sox-fy28").status_code == 402


def test_a_member_who_cannot_create_engagements_cannot_start_the_demo(
    migrated: Database,
) -> None:
    _, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET limit_members = 2 "
                "WHERE organization_id = %s",
                (organization_id,),
            )
        _member(connection, organization_id, "riley@firm.example")
        reviewer = connection.execute(
            "SELECT id FROM users WHERE email = 'riley@firm.example'"
        ).fetchone()
    assert reviewer is not None
    client = _session(migrated, reviewer[0], **PLACEHOLDER)
    body = _demo(client, organization_id)
    assert (body["eligible"], body["can_initialize"], body["invited"]) == (True, False, False)
    refused = _initialize(client, organization_id)
    assert refused.status_code == 403, refused.text
    assert refused.json() == {"detail": "not allowed"}
    assert _demo_projects(migrated.url, organization_id) == []
    # Their own answer to the invitation is theirs to give.
    assert _dismiss(client, organization_id).status_code == 200


def test_an_ended_trial_cannot_start_a_demo(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    _end_trial(migrated.url, organization_id, user_id)
    body = _demo(client, organization_id)
    assert (body["eligible"], body["reason"], body["invited"]) == (False, "trial-ended", False)
    for refused in (_initialize(client, organization_id), _dismiss(client, organization_id)):
        assert refused.status_code == 402, refused.text
        assert refused.json()["code"] == "SUBSCRIPTION_INACTIVE"
    assert _demo_projects(migrated.url, organization_id) == []


def test_requests_arriving_together_make_one_demo(migrated: Database) -> None:
    _, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    clients = [_session(migrated, user_id, **PLACEHOLDER) for _ in range(6)]
    gate = threading.Barrier(6)

    def start(index: int) -> tuple[int, Any]:
        gate.wait()
        answer = _initialize(clients[index], organization_id)
        return answer.status_code, answer.json().get("project_id")

    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = list(pool.map(start, range(6)))
    assert [status for status, _ in answers] == [200] * 6
    assert len({project for _, project in answers}) == 1
    assert len(_demo_projects(migrated.url, organization_id)) == 1
    record = _record(migrated.url, organization_id)
    assert record is not None and (record["state"], record["attempts"]) == ("READY", 1)


def test_asking_again_answers_with_the_same_demo(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    first = _initialize(client, organization_id).json()
    second = _initialize(client, organization_id).json()
    assert first["project_id"] == second["project_id"]
    assert (second["state"], second["attempts"]) == ("READY", 1)
    assert len(_demo_projects(migrated.url, organization_id)) == 1
    assert _audit_actions(migrated.url, organization_id) == ["demo.initialized"]


class _FailsFirst:
    """A dataset whose first build fails after writing: nothing of it may stay."""

    key = "failing/0"
    title = "Failing dataset"
    complete = False

    def __init__(self) -> None:
        self.builds = 0

    def build(self, cursor: psycopg.Cursor[Any], context: DemoContext) -> UUID:
        self.builds += 1
        project_id = PlaceholderDataset().build(cursor, context)
        if self.builds == 1:
            cursor.execute("SELECT 1 / 0")
        return project_id


def test_a_failed_initialization_is_retried_from_the_record(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset = _FailsFirst()
    monkeypatch.setitem(demo_datasets.DATASETS, dataset.key, dataset)
    client, organization_id, _ = _sign_up(migrated, demo_dataset="failing/0")
    failed = _initialize(client, organization_id)
    assert failed.status_code == 503, failed.text
    assert failed.json() == {
        "detail": "the demo could not be prepared; try again in a moment",
        "code": "DEMO_FAILED",
        "attempts": 1,
    }
    record = _record(migrated.url, organization_id)
    assert record is not None
    # The failure is recorded as a class and a code, never a message with row values.
    assert (record["state"], record["attempts"], record["failure"]) == (
        "FAILED",
        1,
        "DivisionByZero 22012",
    )
    assert record["project_id"] is None
    assert _demo_projects(migrated.url, organization_id) == []
    body = _demo(client, organization_id)
    assert (body["state"], body["invitation"], body["failure"]) == (
        "FAILED",
        "ACCEPTED",
        "DivisionByZero 22012",
    )
    # The next request tries again from the same record.
    retried = _initialize(client, organization_id)
    assert retried.status_code == 200, retried.text
    assert (retried.json()["state"], retried.json()["attempts"]) == ("READY", 2)
    assert len(_demo_projects(migrated.url, organization_id)) == 1
    assert _audit_actions(migrated.url, organization_id) == ["demo.failed", "demo.initialized"]


# The marker and the tenant


def test_the_demo_marker_is_set_only_by_initialization(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    # A forged flag on the engagement form makes an ordinary engagement, or nothing.
    forged = client.post(
        f"/organizations/{organization_id}/projects",
        json={
            "name": "Looks like a demo",
            "slug": "northstar-demo",
            "scope": "",
            "owner_user_id": str(user_id),
            "status": "DRAFT",
            "demo": True,
        },
    )
    assert forged.status_code in (201, 422), forged.text
    if forged.status_code == 201:
        assert forged.json()["demo"] is False
    assert _demo_projects(migrated.url, organization_id) == []
    with connect(migrated.url) as connection:
        # The database refuses the marker outside initialization, and never changes it.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO projects (organization_id, name, slug, owner_user_id, demo) "
                "VALUES (%s, 'Forged', 'forged-demo', %s, true)",
                (organization_id, user_id),
            )
        connection.rollback()
    demo_id = UUID(_initialize(client, organization_id).json()["project_id"])
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("UPDATE projects SET demo = false WHERE id = %s", (demo_id,))
        connection.rollback()
        # Inside initialization, a second active demo is still one too many.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                "SELECT set_config('aw.demo_initialization', %s, true)", (str(organization_id),)
            )
            connection.execute(
                "INSERT INTO projects (organization_id, name, slug, owner_user_id, demo) "
                "VALUES (%s, 'Second', 'northstar-demo-2', %s, true)",
                (organization_id, user_id),
            )
        connection.rollback()
    assert len(_demo_projects(migrated.url, organization_id)) == 1


def test_another_firm_sees_none_of_it(migrated: Database) -> None:
    first, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    demo_id = UUID(_initialize(first, organization_id).json()["project_id"])
    other, other_firm, _ = _sign_up(migrated, "lee@other.example", **PLACEHOLDER)
    assert other.get(f"/organizations/{organization_id}/demo").status_code == 404
    assert _initialize(other, organization_id).status_code == 404
    assert _dismiss(other, organization_id).status_code == 404
    assert other.get(f"/organizations/{organization_id}/projects/{demo_id}").status_code == 404
    # The other firm's own demo is its own engagement; its record cannot name the first's.
    theirs = UUID(_initialize(other, other_firm).json()["project_id"])
    assert theirs != demo_id
    with connect(migrated.url) as connection:
        owners = connection.execute(
            "SELECT organization_id FROM projects WHERE id = ANY(%s) ORDER BY organization_id",
            ([demo_id, theirs],),
        ).fetchall()
        assert sorted(row[0] for row in owners) == sorted([organization_id, other_firm])
        with pytest.raises(psycopg.Error):
            connection.execute(
                "UPDATE organization_demos SET project_id = %s WHERE organization_id = %s",
                (demo_id, other_firm),
            )
        connection.rollback()
