import os

import pytest
from fastapi.testclient import TestClient

from ai_workforce_api.main import create_app
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
