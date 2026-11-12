import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.entra import (
    EntraIdentityProvider,
    authority_from_issuer,
    identity_from_claims,
    tenant_from_issuer,
)
from ai_workforce_api.identity import AuthStart, Identity, IdentityError
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings


class FakeProvider:
    def __init__(self, identity: Identity) -> None:
        self.identity = identity
        self.flow: dict[str, Any] = {"state": "state-1", "code_verifier": "verifier-secret"}

    def begin(self, *, redirect_uri: str) -> AuthStart:
        return AuthStart(
            authorization_url="https://login.example.test/authorize?state=state-1",
            state="state-1",
            flow=self.flow,
        )

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        if callback.get("code") != "good-code" or callback.get("state") != flow.get("state"):
            raise IdentityError()
        return self.identity


class FakeMsal:
    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None
    ) -> dict[str, Any]:
        assert scopes == ["email"]
        assert redirect_uri == "https://api.example.test/auth/callback"
        return {
            "auth_uri": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=abc",
            "state": "abc",
            "code_verifier": "verifier-secret",
        }

    def acquire_token_by_auth_code_flow(
        self,
        auth_code_flow: dict[str, Any],
        auth_response: dict[str, str],
        scopes: list[str] | None = None,
    ) -> dict[str, Any]:
        assert auth_code_flow["code_verifier"] == "verifier-secret"
        return {
            "id_token_claims": {"sub": "subject-1", "preferred_username": "owner@example.com"},
            "access_token": "access-token-secret",
        }


def test_health_stays_public_without_a_session() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/health")
    assert response.status_code == 200


def test_login_reports_when_entra_is_not_configured() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/auth/login")
    assert response.status_code == 503


def test_protected_route_rejects_a_missing_session(migrated: Database) -> None:
    client = TestClient(_app(migrated))
    response = client.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "authentication required"


def test_login_callback_opens_a_session_without_exposing_secrets(
    migrated: Database, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client = TestClient(_app(migrated))
    started = client.get("/auth/login", follow_redirects=False)
    assert started.status_code == 302
    location = started.headers["location"]
    assert "state=state-1" in location
    with connect(migrated.url) as connection:
        row = connection.execute("SELECT flow FROM oidc_login_attempts").fetchone()
    assert row is not None
    assert isinstance(row[0], dict)
    if row[0]["code_verifier"] in location:
        raise AssertionError("pkce verifier appeared in the redirect")
    callback = client.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert callback.status_code == 200
    assert callback.json() == {"status": "authenticated"}
    assert "verifier-secret" not in callback.text
    assert "verifier-secret" not in caplog.text
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "owner@example.com"
    assert "oidc_subject" not in me.json()
    logged_out = client.post("/auth/logout")
    assert logged_out.status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_expired_session_is_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name)
                VALUES ('owner@example.com', 'Owner')
                RETURNING id
                """
            )
            user = cursor.fetchone()
            assert user is not None
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at)
                VALUES (
                    %s,
                    %s,
                    clock_timestamp() - interval '2 minutes',
                    clock_timestamp() - interval '1 minute'
                )
                """,
                (user[0], token_hash("raw-token")),
            )
    client = TestClient(_app(migrated))
    client.cookies.set("aw_session", "raw-token")
    assert client.get("/auth/me").status_code == 401


def test_disabled_user_does_not_receive_a_session(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name, status)
                VALUES ('owner@example.com', 'Owner', 'DISABLED')
                """
            )
    client = TestClient(_app(migrated))
    client.get("/auth/login", follow_redirects=False)
    response = client.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert response.status_code == 403
    assert client.get("/auth/me").status_code == 401


def test_email_already_linked_to_another_subject_is_rejected(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name)
                VALUES ('owner@example.com', 'Owner')
                RETURNING id
                """
            )
            user = cursor.fetchone()
            assert user is not None
            cursor.execute(
                """
                INSERT INTO user_identities (user_id, issuer, subject)
                VALUES (%s, 'entra', 'other-subject')
                """,
                (user[0],),
            )
    client = TestClient(_app(migrated))
    client.get("/auth/login", follow_redirects=False)
    response = client.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert response.status_code == 409
    assert client.get("/auth/me").status_code == 401


def test_callback_state_must_match_the_login_attempt(migrated: Database) -> None:
    client = TestClient(_app(migrated))
    client.get("/auth/login", follow_redirects=False)
    response = client.get("/auth/callback?code=good-code&state=other", follow_redirects=False)
    assert response.status_code == 400


def test_entra_provider_drops_tokens_and_uses_the_tenant_host() -> None:
    # Rewritten 9 November 2026 (security sweep): the provider is built with its authority's
    # tenant, as build_entra_provider does. Before, it took no tenant and trusted the user
    # name as the email whatever the authority; a tenant-specific authority still does.
    provider = EntraIdentityProvider(FakeMsal(), tenant="tenant")
    started = provider.begin(redirect_uri="https://api.example.test/auth/callback")
    if "verifier-secret" in started.authorization_url:
        raise AssertionError("pkce verifier appeared in the authorization url")
    assert "login.microsoftonline.com" in started.authorization_url
    identity = provider.complete(flow=started.flow, callback={"code": "good", "state": "abc"})
    assert identity == Identity(subject="subject-1", email="owner@example.com", issuer="entra")
    assert not hasattr(identity, "access_token")


def test_unverified_email_claim_is_rejected() -> None:
    with pytest.raises(IdentityError):
        identity_from_claims(
            {"sub": "subject-1", "email": "owner@example.com", "email_verified": False}
        )


def test_a_callback_finishes_only_in_the_browser_that_started_the_sign_in(
    migrated: Database,
) -> None:
    """Login CSRF (security sweep, 9 November 2026): a callback link started in one browser
    and opened in another signs no one in, and the attempt cannot be used again."""
    app = _app(migrated)
    starter = TestClient(app)
    started = starter.get("/auth/login", follow_redirects=False)
    assert started.status_code == 302
    cookie = next(
        value for value in started.headers.get_list("set-cookie") if value.startswith("aw_login=")
    )
    assert "HttpOnly" in cookie and "Path=/auth" in cookie and "samesite=lax" in cookie.lower()
    with connect(migrated.url) as connection:
        row = connection.execute("SELECT flow FROM oidc_login_attempts").fetchone()
    binding = starter.cookies.get("aw_login")
    assert row is not None and binding is not None and binding not in str(row[0])
    victim = TestClient(app)
    planted = victim.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert planted.status_code == 400
    assert "aw_session" not in victim.cookies
    assert victim.get("/auth/me").status_code == 401
    # The attempt was spent on the refused callback: its own browser cannot finish it now.
    late = starter.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert late.status_code == 400
    # A fresh attempt in the browser that starts it signs in, and clears the binding cookie.
    starter.get("/auth/login", follow_redirects=False)
    finished = starter.get("/auth/callback?code=good-code&state=state-1", follow_redirects=False)
    assert finished.status_code == 200, finished.text
    assert any(
        value.startswith('aw_login=""') or value.startswith("aw_login=;")
        for value in finished.headers.get_list("set-cookie")
    )
    assert starter.get("/auth/me").status_code == 200


def test_a_multi_tenant_entra_email_links_only_when_its_domain_is_verified() -> None:
    """Account linking by email (security sweep, 9 November 2026): with a multi-tenant
    authority any directory can claim any address, so the email must be the `email` claim
    with `xms_edov` true; a tenant-specific authority needs the token from that tenant."""
    claims = {"sub": "subject-1", "email": "owner@example.com", "tid": "x"}
    for tenant in (None, "common", "organizations", "consumers"):
        with pytest.raises(IdentityError):
            identity_from_claims(claims, tenant=tenant)
        with pytest.raises(IdentityError):
            identity_from_claims(
                {"sub": "subject-1", "preferred_username": "owner@example.com", "xms_edov": True},
                tenant=tenant,
            )
        verified = identity_from_claims({**claims, "xms_edov": True}, tenant=tenant)
        assert verified.email == "owner@example.com"
        assert identity_from_claims({**claims, "xms_edov": "1"}, tenant=tenant).subject == (
            "subject-1"
        )
    firm = "0f8fad5b-d9cb-469f-a165-70867728950e"
    with pytest.raises(IdentityError):
        identity_from_claims(claims, tenant=firm)
    with pytest.raises(IdentityError):
        identity_from_claims({"sub": "subject-1", "email": "owner@example.com"}, tenant=firm)
    own = identity_from_claims(
        {"sub": "subject-1", "preferred_username": "owner@example.com", "tid": firm.upper()},
        tenant=firm,
    )
    assert own.email == "owner@example.com"
    assert tenant_from_issuer(f"https://login.microsoftonline.com/{firm}/v2.0") == firm
    assert tenant_from_issuer("https://login.microsoftonline.com/organizations/v2.0") == (
        "organizations"
    )
    assert tenant_from_issuer("https://login.microsoftonline.com") is None


def test_issuer_authority_strips_the_v2_suffix() -> None:
    assert (
        authority_from_issuer("https://login.microsoftonline.com/tenant-id/v2.0")
        == "https://login.microsoftonline.com/tenant-id"
    )


@pytest.fixture
def migrated(migrated_database: Database) -> Database:
    # Cloned from the session's migrated template (conftest): the state apply_migrations
    # produces, without running the migrations again for every test.
    return migrated_database


def _app(database: Database) -> Any:
    settings = Settings(
        database_url=database.url,
        session_cookie_secure=False,
        oidc_redirect_url="http://localhost:8000/auth/callback",
        app_base_url="",
    )
    return create_app(
        settings, FakeProvider(Identity(subject="subject-1", email="owner@example.com"))
    )
