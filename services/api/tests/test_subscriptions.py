"""The free trial and its allowances (Trial Management and Synthetic Demo Experience, Step
2; migration 0127, subscriptions.py): a firm that signs itself up starts one trial, judged
on the server's clock; the firms from before are internal and unlimited; a trial cannot
pass its limits through the API, through the database, or through requests arriving
together; its AI allowance is reserved before every call; an ended trial is read-only."""

import shutil
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_execution import _seed_org, _seed_project
from test_google import FakeProvider
from test_outbound import _session, migrated
from test_provenance import SONNET, _request, _Scripted

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, independent_steps, transaction
from ai_workforce_api.entitlement_errors import TRIAL_LIMIT_SQLSTATE
from ai_workforce_api.identity import Identity
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.provenance import AgentCaller, Job
from ai_workforce_api.settings import Settings
from ai_workforce_api.subscriptions import load, usage

__all__ = ["_Scripted", "_request", "migrated"]

SHA = "0" * 64


def _settings(url: str, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": url,
        "session_cookie_secure": False,
        "google_redirect_url": "http://localhost:8000/auth/google/callback",
        "app_base_url": "",
    }
    values.update(overrides)
    return Settings(**values)


def _sign_up(
    database: Database, email: str = "dana@firm.example", **overrides: Any
) -> tuple[TestClient, UUID, UUID]:
    """A person signs up with Google and gets their own firm, on the trial."""
    identity = Identity(
        subject=f"sub-{email}", email=email, issuer="google", display_name="Dana Ruiz"
    )
    client = TestClient(
        create_app(
            _settings(database.url, **overrides),
            None,
            google_identity_provider=FakeProvider(identity),
        )
    )
    _sign_in(client)
    organization = client.get("/organizations").json()[0]
    user = client.get("/auth/me").json()
    return client, UUID(organization["id"]), UUID(user["id"])


def _sign_in(client: TestClient) -> None:
    client.get("/auth/google/login", follow_redirects=False)
    done = client.get(
        "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert done.status_code == 200, done.text


def _project(client: TestClient, organization_id: UUID, user_id: UUID, slug: str) -> Any:
    return client.post(
        f"/organizations/{organization_id}/projects",
        json={
            "name": slug.upper(),
            "slug": slug,
            "scope": "",
            "owner_user_id": str(user_id),
            "status": "DRAFT",
        },
    )


def _row(url: str, organization_id: UUID) -> dict[str, Any]:
    with connect(url) as connection:
        row = connection.execute(
            """
            SELECT status::text, plan_type, trial_started_at, trial_expires_at,
                   trial_consumed_at, limit_engagements, limit_systems, limit_controls,
                   limit_members, limit_uploads, limit_upload_bytes, ai_budget_micros,
                   ai_run_limit, ai_concurrent_runs, ai_run_seconds, status_reason
            FROM organization_subscriptions WHERE organization_id = %s
            """,
            (organization_id,),
        ).fetchone()
    assert row is not None
    keys = (
        "status", "plan_type", "trial_started_at", "trial_expires_at", "trial_consumed_at",
        "engagements", "systems", "controls", "members", "uploads", "upload_bytes",
        "ai_budget_micros", "ai_run_limit", "ai_concurrent_runs", "ai_run_seconds", "reason",
    )  # fmt: skip
    return dict(zip(keys, row, strict=True))


def _end_trial(url: str, organization_id: UUID, user_id: UUID) -> None:
    """The trial ended yesterday (a recorded change, as the guard requires)."""
    with connect(url) as connection, transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE organization_subscriptions
            SET trial_expires_at = trial_started_at + interval '1 millisecond',
                status_reason = 'test: ended', updated_by = %s
            WHERE organization_id = %s
            """,
            (user_id, organization_id),
        )


def _limit_error(error: psycopg.Error) -> str:
    assert error.sqlstate == TRIAL_LIMIT_SQLSTATE, (error.sqlstate, str(error))
    return (error.diag.message_primary or "").removeprefix("trial limit reached: ")


# The trial starts once


def test_a_firm_that_signs_up_starts_the_trial_once_with_the_deployments_terms(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    listed = client.get("/organizations").json()[0]
    assert (listed["subscription_state"], listed["plan_type"]) == ("TRIAL", "TRIAL")
    assert listed["trial_expires_at"] is not None
    row = _row(migrated.url, organization_id)
    assert (row["status"], row["plan_type"], row["reason"]) == ("TRIAL", "TRIAL", "sign-up")
    assert row["trial_expires_at"] - row["trial_started_at"] == timedelta(days=7)
    assert row["trial_consumed_at"] == row["trial_started_at"]
    # The owner's approved allowances, from the settings' defaults.
    assert (row["engagements"], row["systems"], row["controls"], row["members"]) == (1, 1, 5, 1)
    assert (row["uploads"], row["upload_bytes"]) == (10, 250_000_000)
    assert (row["ai_budget_micros"], row["ai_run_limit"]) == (5_000_000, 20)
    assert (row["ai_concurrent_runs"], row["ai_run_seconds"]) == (1, 600)

    # Signing in again, today or any day, keeps the same trial.
    _sign_in(client)
    again = _row(migrated.url, organization_id)
    assert again["trial_started_at"] == row["trial_started_at"]
    assert again["trial_expires_at"] == row["trial_expires_at"]
    assert len(client.get("/organizations").json()) == 1

    detail = client.get(f"/organizations/{organization_id}/subscription")
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert (body["state"], body["days_left"], body["writable"]) == ("TRIAL", 7, True)
    assert body["limits"]["controls"] == 5
    assert (body["usage"]["engagements"], body["usage"]["members"]) == (0, 1)
    assert body["usage"]["ai_spent_micros"] == 0

    # The trial's start never moves, whoever asks.
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE organization_subscriptions SET trial_started_at = clock_timestamp() "
                "WHERE organization_id = %s",
                (organization_id,),
            )


def test_the_trials_terms_come_from_the_settings(migrated: Database) -> None:
    _, organization_id, _ = _sign_up(
        migrated, "lee@other.example", trial_days=14, trial_limit_controls=3
    )
    row = _row(migrated.url, organization_id)
    assert row["trial_expires_at"] - row["trial_started_at"] == timedelta(days=14)
    assert row["controls"] == 3


def test_firms_from_before_the_migration_are_internal_and_unlimited(
    empty_database: Database, tmp_path: Path
) -> None:
    """The backfill policy: an existing firm is never a new trial. Its row says so, an
    audit event records it, and a firm made afterwards starts the trial."""
    earlier = tmp_path / "migrations"
    earlier.mkdir()
    for path in sorted(migrations_dir().glob("*.sql")):
        if path.name < "0127":
            shutil.copy(path, earlier / path.name)
    apply_migrations(empty_database.url, earlier)
    with connect(empty_database.url) as connection:
        row = connection.execute(
            "INSERT INTO organizations (name, slug) VALUES ('Old firm', 'old-firm') RETURNING id"
        ).fetchone()
        connection.commit()
    assert row is not None
    old_firm = row[0]
    apply_migrations(empty_database.url, migrations_dir())
    with connect(empty_database.url) as connection:
        sub = load(connection, old_firm)
        assert sub is not None
        assert (sub.state, sub.plan_type, sub.trial) == ("ACTIVE", "INTERNAL", False)
        assert all(value is None for value in sub.limits.__dict__.values())
        audit = connection.execute(
            "SELECT action, payload->>'migration' FROM audit_events WHERE target_id = %s",
            (old_firm,),
        ).fetchall()
        assert audit == [("subscription.backfill", "0127")]
        new_row = connection.execute(
            "INSERT INTO organizations (name, slug) VALUES ('New firm', 'new-firm') RETURNING id"
        ).fetchone()
        connection.commit()
        assert new_row is not None
        fresh = load(connection, new_row[0])
        assert fresh is not None
        assert (fresh.state, fresh.plan_type, fresh.limits.controls) == ("TRIAL", "TRIAL", 5)


# The trial ends on the server's clock


def test_an_ended_trial_keeps_its_records_read_only(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    created = _project(client, organization_id, user_id, "sox-fy27")
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]
    _end_trial(migrated.url, organization_id, user_id)

    assert client.get("/organizations").json()[0]["subscription_state"] == "TRIAL_EXPIRED"
    detail = client.get(f"/organizations/{organization_id}/subscription").json()
    assert (detail["state"], detail["days_left"], detail["writable"]) == ("TRIAL_EXPIRED", 0, False)
    # Reads go on; every change under the firm answers 402.
    assert client.get(f"/organizations/{organization_id}/projects").status_code == 200
    assert client.get(f"/organizations/{organization_id}/projects/{project_id}").status_code == 200
    refused = _project(client, organization_id, user_id, "another")
    assert refused.status_code == 402, refused.text
    assert refused.json() == {
        "detail": "subscription inactive: the free trial has ended",
        "code": "SUBSCRIPTION_INACTIVE",
        "state": "TRIAL_EXPIRED",
    }
    edited = client.patch(
        f"/organizations/{organization_id}/projects/{project_id}",
        json={"name": "Renamed", "version": 1},
    )
    assert edited.status_code == 402
    # Evidence arriving without a session (the portal) is refused by the database itself.
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.Error) as error:
            _upload(connection, organization_id, project_id, user_id, 10)
        assert _limit_error(error.value) == "subscription"
    # Signing in again changes nothing.
    _sign_in(client)
    assert client.get("/organizations").json()[0]["subscription_state"] == "TRIAL_EXPIRED"


# The trial's allowances


def _upload(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: Any,
    user_id: UUID,
    size: int,
) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO evidence_files (
                organization_id, project_id, object_key, content_sha256, size_bytes,
                content_type, file_name, stored_by, source, upload_batch_id
            )
            VALUES (%s, %s, %s, %s, %s, 'text/csv', %s, %s, 'UPLOAD', %s)
            """,
            (
                organization_id,
                project_id,
                f"evidence/{uuid4()}",
                SHA,
                size,
                f"{uuid4().hex}.csv",
                user_id,
                uuid4(),
            ),
        )


def _member(connection: psycopg.Connection[Any], organization_id: UUID, email: str) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, 'Riley') RETURNING id", (email,)
        )
        user = cursor.fetchone()
        assert user is not None
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, 'REVIEWER')",
            (organization_id, user[0]),
        )


def test_a_trial_firm_cannot_pass_its_allowances(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    base = f"/organizations/{organization_id}/projects"
    first = _project(client, organization_id, user_id, "sox-fy27")
    assert first.status_code == 201, first.text
    project_id = first.json()["id"]
    second = _project(client, organization_id, user_id, "sox-fy28")
    assert second.status_code == 402, second.text
    assert second.json() == {
        "detail": "trial limit reached: engagements",
        "code": "TRIAL_LIMIT",
        "resource": "engagements",
        "used": 1,
        "allowed": 1,
    }

    systems = f"{base}/{project_id}/onboarding/applications"
    assert client.post(systems, json={"name": "SAP S/4HANA"}).status_code == 200
    refused = client.post(systems, json={"name": "Snowflake"})
    assert refused.status_code == 402, refused.text
    assert (refused.json()["resource"], refused.json()["allowed"]) == ("systems", 1)

    # A whole library area at once is more than five controls: nothing of it is kept.
    loaded = client.post(f"{base}/{project_id}/onboarding/controls/load-library", json={})
    assert loaded.status_code == 402, loaded.text
    assert loaded.json()["resource"] == "controls"
    with connect(migrated.url) as connection:
        count = connection.execute(
            "SELECT count(*) FROM engagement_controls WHERE project_id = %s", (project_id,)
        ).fetchone()
        assert count == (0,)

        # One more member, ten files and then one more, and more bytes than allowed.
        with pytest.raises(psycopg.Error) as member:
            _member(connection, organization_id, "riley@firm.example")
        assert _limit_error(member.value) == "members"
        for _ in range(10):
            _upload(connection, organization_id, project_id, user_id, 1)
        with pytest.raises(psycopg.Error) as eleventh:
            _upload(connection, organization_id, project_id, user_id, 1)
        assert _limit_error(eleventh.value) == "uploads"
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET limit_uploads = NULL, "
                "limit_upload_bytes = 100 WHERE organization_id = %s",
                (organization_id,),
            )
        with pytest.raises(psycopg.Error) as heavy:
            _upload(connection, organization_id, project_id, user_id, 91)
        assert _limit_error(heavy.value) == "storage"

    used = client.get(f"/organizations/{organization_id}/subscription").json()["usage"]
    assert (used["engagements"], used["systems"], used["uploads"]) == (1, 1, 10)


def test_an_internal_or_paid_firm_is_not_limited(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "paid")
        organization_id, user_id = seeded["organization_id"], seeded["user_id"]
        for n in range(3):
            _seed_project(connection, organization_id, user_id)
            _member(connection, organization_id, f"person-{n}@paid.example")
        for _ in range(12):
            _upload(
                connection,
                organization_id,
                _seed_project(connection, organization_id, user_id),
                user_id,
                1,
            )
    client = _session(migrated, user_id)
    listed = client.get("/organizations").json()[0]
    assert (listed["subscription_state"], listed["plan_type"]) == ("ACTIVE", "INTERNAL")
    body = client.get(f"/organizations/{organization_id}/subscription").json()
    assert body["limits"]["engagements"] is None and body["usage"]["members"] == 4


def test_requests_arriving_together_cannot_both_pass_a_limit(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    created = _project(client, organization_id, user_id, "sox-fy27")
    project_id = created.json()["id"]
    systems = f"/organizations/{organization_id}/projects/{project_id}/onboarding/applications"
    clients = [_session(migrated, user_id) for _ in range(6)]
    gate = threading.Barrier(6)

    def add(index: int) -> int:
        gate.wait()
        return int(clients[index].post(systems, json={"name": f"System {index}"}).status_code)

    with ThreadPoolExecutor(max_workers=6) as pool:
        answers = sorted(pool.map(add, range(6)))
    assert answers == [200, 402, 402, 402, 402, 402]
    with connect(migrated.url) as connection:
        count = connection.execute(
            "SELECT count(*) FROM engagement_applications WHERE project_id = %s", (project_id,)
        ).fetchone()
    assert count == (1,)


# The AI allowance


def _caller(
    connection: psycopg.Connection[Any],
    provider: _Scripted,
    organization_id: UUID,
    project_id: Any,
    user_id: UUID,
    settings: Settings,
    job_id: UUID | None = None,
) -> AgentCaller:
    job = Job(
        "itgc-access-tester", "test_sheet", uuid4(), organization_id, UUID(str(project_id)),
        user_id, job_id=job_id or uuid4(),
    )  # fmt: skip
    independent_steps(connection)
    return AgentCaller(connection, provider, job, settings=settings, config=SONNET)


def _refusal(connection: psycopg.Connection[Any], call_id: UUID | None) -> str:
    row = connection.execute("SELECT error FROM model_calls WHERE id = %s", (call_id,)).fetchone()
    return "" if row is None else str(row[0])


def test_the_ai_allowance_is_reserved_settled_and_capped_per_firm(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    project_id = _project(client, organization_id, user_id, "sox-fy27").json()["id"]
    settings = Settings(database_url=migrated.url)
    provider = _Scripted([{"answer": "ok"}])
    with connect(migrated.url) as connection:
        # One run at a time: while another job has a call in flight, a new job waits.
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO model_call_reservations (
                    organization_id, project_id, job_id, agent_key, estimate_micros, created_at
                ) VALUES (%s, %s, %s, 'itgc-access-tester', 1000,
                          clock_timestamp() - interval '6 minutes')
                RETURNING id
                """,
                (organization_id, project_id, uuid4()),
            )
            in_flight = cursor.fetchone()
        assert in_flight is not None
        caller = _caller(connection, provider, organization_id, project_id, user_id, settings)
        waiting = caller.generate(_request(), "control-tester/1")
        assert waiting.status == "BUDGET_EXCEEDED"
        assert "one at a time" in _refusal(connection, waiting.call_id)
        assert provider.requests == []
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE model_call_reservations SET released_at = clock_timestamp() - "
                "interval '5 minutes', settled_micros = 1000 WHERE id = %s",
                (in_flight[0],),
            )
        # The earlier job is quiet now: the call goes, reserved first and settled after.
        call = caller.generate(_request(), "control-tester/1")
        assert call.status == "SUCCEEDED"
        ledger = connection.execute(
            """
            SELECT estimate_micros, settled_micros, model_call_id, released_at IS NOT NULL
            FROM model_call_reservations WHERE organization_id = %s AND job_id = %s
            """,
            (organization_id, caller.job.job_id),
        ).fetchall()
        assert len(ledger) == 1
        estimate, settled, call_id, released = ledger[0]
        # 800 in at $2/M and 200 out at $10/M: $0.0036, far under the worst case reserved.
        assert (settled, call_id, released) == (3_600, call.call_id, True)
        assert estimate > settled

        # The allowance is the whole trial's: once used, nothing more is sent.
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET ai_budget_micros = 40000 "
                "WHERE organization_id = %s",
                (organization_id,),
            )
        capped = caller.generate(_request(), "control-tester/1")
        assert capped.status == "BUDGET_EXCEEDED"
        assert "AI allowance" in _refusal(connection, capped.call_id)
        assert len(provider.requests) == 1

        # Two runs are on record; the trial's allowance of runs refuses a third.
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET ai_budget_micros = 5000000, "
                "ai_run_limit = 2 WHERE organization_id = %s",
                (organization_id,),
            )
        third = _caller(connection, provider, organization_id, project_id, user_id, settings)
        counted = third.generate(_request(), "control-tester/1")
        assert counted.status == "BUDGET_EXCEEDED"
        assert "agent runs are used" in _refusal(connection, counted.call_id)

        # A job that started too long ago makes no further call.
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET ai_run_limit = 20 "
                "WHERE organization_id = %s",
                (organization_id,),
            )
            cursor.execute(
                """
                INSERT INTO model_call_reservations (
                    organization_id, project_id, job_id, agent_key, estimate_micros,
                    settled_micros, created_at, released_at
                ) VALUES (%s, %s, %s, 'itgc-access-tester', 1000, 1000,
                          clock_timestamp() - interval '11 minutes',
                          clock_timestamp() - interval '10 minutes')
                """,
                (organization_id, project_id, third.job.job_id),
            )
        late = third.generate(_request(), "control-tester/1")
        assert late.status == "BUDGET_EXCEEDED"
        assert "10 minutes" in _refusal(connection, late.call_id)

        # A settled reservation never changes and is never removed.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE model_call_reservations SET settled_micros = 0 WHERE id = %s",
                (in_flight[0],),
            )
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("DELETE FROM model_call_reservations WHERE id = %s", (in_flight[0],))
        used = usage(connection, organization_id)
        assert (used.ai_runs, used.ai_spent_micros) == (3, 1000 + 3_600 + 1000)
    body = client.get(f"/organizations/{organization_id}/subscription").json()
    assert body["usage"]["ai_runs"] == 3


def test_an_ended_trial_and_an_internal_firm_at_the_agent_caller(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    project_id = _project(client, organization_id, user_id, "sox-fy27").json()["id"]
    _end_trial(migrated.url, organization_id, user_id)
    settings = Settings(database_url=migrated.url)
    provider = _Scripted([{"answer": "ok"}])
    with connect(migrated.url) as connection:
        ended = _caller(connection, provider, organization_id, project_id, user_id, settings)
        call = ended.generate(_request(), "control-tester/1")
        assert call.status == "BUDGET_EXCEEDED"
        assert "free trial has ended" in _refusal(connection, call.call_id)
        assert provider.requests == []
        # An internal firm keeps no ledger; its project budgets still apply.
        seeded = _seed_org(connection, "internal")
        internal_project = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        free = _caller(
            connection, provider, seeded["organization_id"], internal_project, seeded["user_id"],
            settings,
        )  # fmt: skip
        assert free.generate(_request(), "control-tester/1").status == "SUCCEEDED"
        ledger = connection.execute(
            "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
            (seeded["organization_id"],),
        ).fetchone()
        assert ledger == (0,)


def test_the_direct_model_routes_never_reach_a_live_provider(migrated: Database) -> None:
    """The model-call route is for a person's own structured generation; it has no tier,
    budget or provenance, so a live provider is never handed to it (operations.md)."""
    with connect(migrated.url) as connection:
        seeded = _seed_org(connection, "direct")
        project_id = _seed_project(connection, seeded["organization_id"], seeded["user_id"])
        raw = uuid4().hex
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (seeded["user_id"], token_hash(raw)),
        )
        connection.commit()
    app = create_app(
        _settings(migrated.url, model_provider="anthropic", model_api_key="sk-not-a-real-key")
    )
    client = TestClient(app)
    client.cookies.set("aw_session", raw)
    answer = client.post(
        f"/organizations/{seeded['organization_id']}/projects/{project_id}/model-calls",
        json={
            "model_config_ref": "audit-model",
            "operation": "generate",
            "prompt": "Say ok.",
            "output_schema": {"type": "object"},
        },
    )
    assert answer.status_code == 503, answer.text
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT model_name FROM model_calls WHERE project_id = %s", (project_id,)
        ).fetchall()
    assert all("claude" not in str(row[0]) for row in rows)
