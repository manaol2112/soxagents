"""Google sign-up: the provider, the routes, and the workspace a new person receives."""

import logging
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.auth import workspace_name, workspace_slug
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.google import (
    GoogleIdentityProvider,
    identity_from_google_claims,
)
from ai_workforce_api.identity import AuthStart, Identity, IdentityError
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings


class FakeExchange:
    """Stands in for Google's token endpoint and key set. Records what it was sent."""

    def __init__(self, claims: dict[str, Any]) -> None:
        self.claims_to_return = claims
        self.form: dict[str, str] = {}

    def exchange(self, form: dict[str, str]) -> dict[str, Any]:
        self.form = form
        return {
            "id_token": "id-token-value",
            "access_token": "access-token-secret",
            "refresh_token": "refresh-token-secret",
        }

    def claims(self, id_token: str, *, audience: str) -> dict[str, Any]:
        assert id_token == "id-token-value"
        assert audience == "client-id"
        return {**self.claims_to_return, "aud": audience}


class FakeProvider:
    """A scripted provider for route tests, keyed by its own state."""

    def __init__(self, identity: Identity, state: str = "google-state") -> None:
        self.identity = identity
        self.state = state

    def begin(self, *, redirect_uri: str) -> AuthStart:
        assert redirect_uri == "http://localhost:8000/auth/google/callback"
        return AuthStart(
            authorization_url=f"https://accounts.google.com/o/oauth2/v2/auth?state={self.state}",
            state=self.state,
            flow={"state": self.state, "code_verifier": "verifier-secret"},
        )

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        if callback.get("code") != "good-code" or callback.get("state") != flow.get("state"):
            raise IdentityError()
        return self.identity


class EntraFake:
    def __init__(self, identity: Identity) -> None:
        self.identity = identity

    def begin(self, *, redirect_uri: str) -> AuthStart:
        return AuthStart(
            authorization_url="https://login.example.test/authorize?state=entra-state",
            state="entra-state",
            flow={"state": "entra-state", "code_verifier": "verifier-secret"},
        )

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        if callback.get("code") != "good-code" or callback.get("state") != flow.get("state"):
            raise IdentityError()
        return self.identity


GOOGLE_CLAIMS = {
    "iss": "https://accounts.google.com",
    "sub": "109876543210",
    "email": "dana@firm.example",
    "email_verified": True,
    "name": "Dana Ruiz",
}


def test_provider_starts_with_pkce_and_keeps_the_verifier_out_of_the_url() -> None:
    provider = GoogleIdentityProvider(
        client_id="client-id", client_secret="client-secret", exchange=FakeExchange({})
    )
    started = provider.begin(redirect_uri="https://api.example.test/auth/google/callback")
    url = urlsplit(started.authorization_url)
    query = parse_qs(url.query)
    assert url.netloc == "accounts.google.com"
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"] == [started.state]
    assert query["scope"] == ["openid email profile"]
    assert "client-secret" not in started.authorization_url
    assert started.flow["code_verifier"] not in started.authorization_url
    assert query["nonce"] == [started.flow["nonce"]]


def test_provider_exchanges_the_code_and_returns_only_the_identity() -> None:
    exchange = FakeExchange(GOOGLE_CLAIMS)
    provider = GoogleIdentityProvider(
        client_id="client-id", client_secret="client-secret", exchange=exchange
    )
    started = provider.begin(redirect_uri="https://api.example.test/auth/google/callback")
    exchange.claims_to_return = {**GOOGLE_CLAIMS, "nonce": started.flow["nonce"]}
    identity = provider.complete(
        flow=started.flow, callback={"code": "the-code", "state": started.state}
    )
    assert identity == Identity(
        subject="109876543210",
        email="dana@firm.example",
        issuer="google",
        display_name="Dana Ruiz",
    )
    assert exchange.form["code"] == "the-code"
    assert exchange.form["code_verifier"] == started.flow["code_verifier"]
    assert exchange.form["redirect_uri"] == "https://api.example.test/auth/google/callback"
    assert not hasattr(identity, "access_token")


def test_provider_refuses_a_wrong_state_or_a_provider_error() -> None:
    exchange = FakeExchange(GOOGLE_CLAIMS)
    provider = GoogleIdentityProvider(
        client_id="client-id", client_secret="client-secret", exchange=exchange
    )
    started = provider.begin(redirect_uri="https://api.example.test/auth/google/callback")
    with pytest.raises(IdentityError):
        provider.complete(flow=started.flow, callback={"code": "the-code", "state": "other"})
    with pytest.raises(IdentityError):
        provider.complete(
            flow=started.flow, callback={"error": "access_denied", "state": started.state}
        )
    assert exchange.form == {}


def test_claims_need_a_verified_email_the_right_issuer_and_the_nonce() -> None:
    good = {**GOOGLE_CLAIMS, "nonce": "nonce-1"}
    assert identity_from_google_claims(good, nonce="nonce-1").email == "dana@firm.example"
    with pytest.raises(IdentityError):
        identity_from_google_claims({**good, "email_verified": False}, nonce="nonce-1")
    with pytest.raises(IdentityError):
        identity_from_google_claims(
            {k: v for k, v in good.items() if k != "email_verified"}, nonce="nonce-1"
        )
    with pytest.raises(IdentityError):
        identity_from_google_claims({**good, "iss": "https://evil.example"}, nonce="nonce-1")
    with pytest.raises(IdentityError):
        identity_from_google_claims(good, nonce="nonce-2")
    with pytest.raises(IdentityError):
        identity_from_google_claims({**good, "sub": " "}, nonce="nonce-1")


def test_workspace_names_follow_the_firm_domain_or_the_person() -> None:
    assert workspace_name("dana@firm.example", "Dana Ruiz") == "Firm"
    assert workspace_name("dana@acme-audit.co.uk", None) == "Acme-audit"
    assert workspace_name("dana@gmail.com", "Dana Ruiz") == "Dana Ruiz's workspace"
    assert workspace_name("dana@gmail.com", None) == "dana's workspace"
    assert workspace_slug("Dana Ruiz's workspace") == "dana-ruiz-s-workspace"
    assert workspace_slug("!!!") == "workspace"


def test_providers_route_lists_what_is_configured(migrated: Database) -> None:
    # Explicit values, so a developer's own .env cannot turn a provider on here.
    unconfigured = Settings(
        oidc_issuer_url="",
        oidc_client_id="",
        oidc_client_secret="",
        oidc_redirect_url="",
        google_client_id="",
        google_client_secret="",
        google_redirect_url="",
        preview_login_enabled=False,
    )
    neither = TestClient(create_app(unconfigured))
    assert neither.get("/auth/providers").json() == {"providers": [], "preview": False}
    both = TestClient(_app(migrated, entra=EntraFake(Identity("s", "e@example.com"))))
    assert both.get("/auth/providers").json() == {
        "providers": [
            {"id": "google", "label": "Google", "login_path": "/auth/google/login"},
            {"id": "entra", "label": "Microsoft", "login_path": "/auth/login"},
        ],
        "preview": False,
    }
    assert both.get("/auth/google/login", follow_redirects=False).status_code == 302
    assert neither.get("/auth/google/login").status_code == 503


def test_google_sign_up_creates_the_user_and_their_own_workspace(
    migrated: Database, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    client = TestClient(_app(migrated))
    started = client.get("/auth/google/login", follow_redirects=False)
    assert started.status_code == 302
    assert "state=google-state" in started.headers["location"]
    callback = client.get(
        "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert callback.status_code == 200
    assert "verifier-secret" not in caplog.text
    me = client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "dana@firm.example"
    organizations = client.get("/organizations")
    assert organizations.status_code == 200
    assert [(o["name"], o["slug"], o["role"]) for o in organizations.json()] == [
        ("Firm", "firm", "OWNER")
    ]
    with connect(migrated.url) as connection:
        identities = connection.execute(
            "SELECT issuer, subject FROM user_identities ORDER BY issuer"
        ).fetchall()
        name = connection.execute("SELECT display_name FROM users").fetchone()
        audit = connection.execute("SELECT action FROM audit_events ORDER BY action").fetchall()
    assert identities == [("google", "109876543210")]
    assert name == ("Dana Ruiz",)
    assert [row[0] for row in audit] == ["membership.grant", "organization.create"]
    # The firm's own domain is where its invitations may go.
    with connect(migrated.url) as connection:
        domains = connection.execute(
            "SELECT domain::text FROM organization_email_domains"
        ).fetchall()
    assert domains == [("firm.example",)]
    # Signing in again does not make a second workspace.
    client.get("/auth/google/login", follow_redirects=False)
    client.get("/auth/google/callback?code=good-code&state=google-state", follow_redirects=False)
    assert len(client.get("/organizations").json()) == 1


def test_same_verified_email_links_google_to_the_existing_microsoft_user(
    migrated: Database,
) -> None:
    entra = EntraFake(Identity("entra-subject", "dana@firm.example", issuer="entra"))
    client = TestClient(_app(migrated, entra=entra))
    client.get("/auth/login", follow_redirects=False)
    client.get("/auth/callback?code=good-code&state=entra-state", follow_redirects=False)
    first = client.get("/auth/me").json()["id"]
    client.post("/auth/logout")
    client.get("/auth/google/login", follow_redirects=False)
    client.get("/auth/google/callback?code=good-code&state=google-state", follow_redirects=False)
    assert client.get("/auth/me").json()["id"] == first
    with connect(migrated.url) as connection:
        identities = connection.execute(
            "SELECT issuer, subject FROM user_identities ORDER BY issuer"
        ).fetchall()
        organizations = connection.execute("SELECT count(*) FROM organizations").fetchone()
    assert identities == [("entra", "entra-subject"), ("google", "109876543210")]
    assert organizations == (1,)


def test_a_second_google_account_for_the_same_email_is_refused(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name) VALUES ('dana@firm.example', 'Dana')
                RETURNING id
                """
            )
            user = cursor.fetchone()
            assert user is not None
            cursor.execute(
                """
                INSERT INTO user_identities (user_id, issuer, subject)
                VALUES (%s, 'google', 'other')
                """,
                (user[0],),
            )
    client = TestClient(_app(migrated))
    client.get("/auth/google/login", follow_redirects=False)
    response = client.get(
        "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert response.status_code == 409
    assert client.get("/auth/me").status_code == 401


def test_a_google_state_cannot_finish_the_microsoft_callback(migrated: Database) -> None:
    entra = EntraFake(Identity("entra-subject", "dana@firm.example", issuer="entra"))
    client = TestClient(_app(migrated, entra=entra))
    client.get("/auth/google/login", follow_redirects=False)
    response = client.get(
        "/auth/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert response.status_code == 400
    assert client.get("/auth/me").status_code == 401


def test_a_failed_login_returns_to_the_sign_in_page_when_the_app_has_one(
    migrated: Database,
) -> None:
    client = TestClient(_app(migrated, app_base_url="http://localhost:3000/"))
    client.get("/auth/google/login", follow_redirects=False)
    response = client.get(
        "/auth/google/callback?code=bad-code&state=google-state", follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000/sign-in?notice=failed"
    assert "aw_session" not in response.headers.get("set-cookie", "")


def test_an_existing_member_does_not_get_a_second_workspace(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, display_name) VALUES ('dana@firm.example', 'Dana')
                RETURNING id
                """
            )
            user = cursor.fetchone()
            assert user is not None
            cursor.execute(
                """
                INSERT INTO organizations (name, slug)
                VALUES ('Firm LLP', 'firm-llp')
                RETURNING id
                """
            )
            organization = cursor.fetchone()
            assert organization is not None
            cursor.execute(
                """
                INSERT INTO memberships (organization_id, user_id, role, status)
                VALUES (%s, %s, 'REVIEWER', 'DISABLED')
                """,
                (organization[0], user[0]),
            )
    client = TestClient(_app(migrated))
    client.get("/auth/google/login", follow_redirects=False)
    client.get("/auth/google/callback?code=good-code&state=google-state", follow_redirects=False)
    assert client.get("/auth/me").status_code == 200
    assert client.get("/organizations").json() == []


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    from ai_workforce_api.migrate import apply_migrations, migrations_dir

    apply_migrations(empty_database.url, migrations_dir())
    return empty_database


def _app(database: Database, *, entra: Any = None, app_base_url: str = "") -> Any:
    settings = Settings(
        database_url=database.url,
        session_cookie_secure=False,
        oidc_redirect_url="http://localhost:8000/auth/callback",
        google_redirect_url="http://localhost:8000/auth/google/callback",
        app_base_url=app_base_url,
    )
    identity = Identity(
        subject="109876543210",
        email="dana@firm.example",
        issuer="google",
        display_name="Dana Ruiz",
    )
    return create_app(settings, entra, google_identity_provider=FakeProvider(identity))
