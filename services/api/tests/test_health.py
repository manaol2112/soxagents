import os
import re
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import PUBLIC_PATHS
from ai_workforce_api.main import create_app, loaded_code
from ai_workforce_api.migrate import list_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def test_settings_default_disables_live_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EMAIL_LIVE_SEND_ENABLED", raising=False)
    assert Settings().email_live_send_enabled is False


def test_health_reports_live_email_disabled() -> None:
    client = TestClient(create_app(Settings(email_live_send_enabled=False)))
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "live_email_enabled": False}
    forced = TestClient(
        create_app(
            Settings(
                email_live_send_enabled=True,
                email_provider="graph",
                graph_tenant_id="tenant",
                graph_client_id="client",
                graph_client_secret="client-secret-value",
                shared_mailbox_address="mailbox@example.com",
            )
        )
    )
    assert forced.get("/health").json()["live_email_enabled"] is False
    assert "client-secret-value" not in forced.get("/health").text


def test_ready_without_database_is_unavailable() -> None:
    client = TestClient(create_app(Settings(database_url="")))
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


def test_ready_rejects_an_unreachable_database() -> None:
    client = TestClient(
        create_app(Settings(database_url="postgresql://postgres:invalid@127.0.0.1:1/none"))
    )
    response = client.get("/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"


def test_ready_uses_configured_database() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    if database_url == "":
        pytest.skip("DATABASE_URL is not set")
    client = TestClient(
        create_app(Settings(database_url=database_url, email_live_send_enabled=False))
    )
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_version_says_which_code_and_schema_and_nothing_else(
    migrated_database: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    # scripts/env_status.py, 19 November 2026: which commit a server loaded (a reload that
    # did not happen leaves older code running) and the latest migration its database has.
    # Public like /health: no sign-in, no URL, no secret.
    monkeypatch.setenv("APP_COMMIT", "4431a3f0c1d2")
    loaded_code.cache_clear()
    try:
        client = TestClient(create_app(Settings(database_url=migrated_database.url)))
        response = client.get("/health/version")
    finally:
        loaded_code.cache_clear()
    assert response.status_code == 200
    latest = list_migrations(migrations_dir())[-1][0]
    assert response.json() == {"commit": "4431a3f0c1d2", "branch": None, "migrations_head": latest}
    assert "/health/version" in PUBLIC_PATHS
    password = urlsplit(migrated_database.url).password or "no password"
    assert password not in response.text and "postgres" not in response.text


def test_version_reads_git_once_and_shows_no_unchecked_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_COMMIT", "")
    loaded_code.cache_clear()
    try:
        body = TestClient(create_app(Settings(database_url=""))).get("/health/version").json()
        commit, branch = loaded_code()
        # A second app in the process reuses what the first read.
        monkeypatch.setenv("APP_COMMIT", "0123456789ab")
        again = TestClient(create_app(Settings(database_url=""))).get("/health/version").json()
        loaded_code.cache_clear()
        monkeypatch.setenv("APP_COMMIT", "not a commit; DROP TABLE")
        odd = TestClient(create_app(Settings(database_url=""))).get("/health/version").json()
    finally:
        loaded_code.cache_clear()
    assert body == {"commit": commit, "branch": branch, "migrations_head": None}
    assert commit is None or re.fullmatch(r"[0-9a-f]{12}", commit)
    assert again == body
    assert odd == {"commit": None, "branch": None, "migrations_head": None}
