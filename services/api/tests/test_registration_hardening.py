"""Pre-launch hardening (Step 7): request throttles and trial identities. A network
address starts only so many sign-ins and creates only so many firms; a mailbox gets one
trial, and an alias of it a firm on hold; requests arriving together are counted together;
the demo is started or reset only so often; and every registration attempt is audited."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from support import Database
from test_demo import PLACEHOLDER, _initialize
from test_google import FakeProvider
from test_outbound import migrated
from test_subscriptions import _settings, _sign_in, _sign_up

from ai_workforce_api import rate_limit
from ai_workforce_api.db import connect
from ai_workforce_api.identity import Identity
from ai_workforce_api.main import create_app

__all__ = ["migrated"]


def _client(
    database: Database, email: str, state: str = "google-state", **overrides: Any
) -> TestClient:
    identity = Identity(subject=f"sub-{email}", email=email, issuer="google", display_name="A")
    return TestClient(
        create_app(
            _settings(database.url, **overrides),
            None,
            google_identity_provider=FakeProvider(identity, state=state),
        )
    )


def _clear_attempts(url: str) -> None:
    with connect(url) as connection:
        connection.execute("DELETE FROM oidc_login_attempts")
        connection.commit()


def _events(url: str, action_prefix: str) -> list[tuple[Any, ...]]:
    with connect(url) as connection:
        return connection.execute(
            "SELECT action, organization_id, payload FROM audit_events WHERE action LIKE %s ORDER BY occurred_at",
            (action_prefix + "%",),
        ).fetchall()


def test_identities_are_normalised_the_way_the_mailbox_providers_read_them() -> None:
    normal = rate_limit.normalized_identity
    assert normal("Dana.Ruiz+trial@Gmail.com") == "danaruiz@gmail.com"
    assert normal("dana.ruiz@firm.example") == "dana.ruiz@firm.example"
    assert normal("dana.ruiz+two@firm.example") == "dana.ruiz@firm.example"
    assert normal("DANA@FIRM.EXAMPLE") == "dana@firm.example"
    assert rate_limit.identity_hash("a+1@gmail.com") == rate_limit.identity_hash("A@gmail.com")
    assert rate_limit.identity_hash("a@gmail.com") != rate_limit.identity_hash("b@gmail.com")


def test_a_network_address_starts_only_so_many_sign_ins(migrated: Database) -> None:
    client = _client(migrated, "throttle@firm.example", rate_limit_login_per_address=2)
    first = client.get("/auth/google/login", follow_redirects=False)
    _clear_attempts(migrated.url)
    second = client.get("/auth/google/login", follow_redirects=False)
    _clear_attempts(migrated.url)
    assert first.status_code == 302 and second.status_code == 302
    third = client.get("/auth/google/login", follow_redirects=False)
    assert third.status_code == 429, third.text
    assert third.json() == {"detail": "too many sign-in attempts; try again in a few minutes"}
    # The window is the address's, not the account's: nothing about an account is said.
    assert "firm.example" not in third.text
    # With the sign-in page configured, the person is sent back to it with the notice.
    paged = _client(
        migrated,
        "throttle@firm.example",
        rate_limit_login_per_address=0,
        app_base_url="http://localhost:3000",
    )
    paged_settings_client = _client(
        migrated,
        "throttle2@firm.example",
        rate_limit_login_per_address=1,
        app_base_url="http://localhost:3000",
    )
    assert paged.get("/auth/google/login", follow_redirects=False).status_code == 302
    _clear_attempts(migrated.url)
    paged_settings_client.get("/auth/google/login", follow_redirects=False)
    _clear_attempts(migrated.url)
    sent_back = paged_settings_client.get("/auth/google/login", follow_redirects=False)
    assert sent_back.status_code == 303
    assert sent_back.headers["location"].endswith("/sign-in?notice=throttled")


def test_a_network_address_creates_only_so_many_firms_and_the_attempt_is_audited(
    migrated: Database,
) -> None:
    first, _org, _user = _sign_up(migrated, "one@start.example", rate_limit_signup_per_address=1)
    assert first.get("/organizations").status_code == 200
    second = _client(migrated, "two@start.example", rate_limit_signup_per_address=1)
    second.get("/auth/google/login", follow_redirects=False)
    refused = second.get(
        "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert refused.status_code == 429, refused.text
    # No firm and no session for the refused attempt; the accepted one is on the audit
    # trail with the mailbox's domain and the address's hash, never the address itself.
    assert second.get("/auth/me").status_code == 401
    with connect(migrated.url) as connection:
        firms = connection.execute(
            "SELECT count(*) FROM users WHERE email = 'two@start.example'"
        ).fetchone()
    assert firms == (0,)  # nothing of the refused attempt stays: no user, no firm, no trial
    accepted = _events(migrated.url, "registration.accepted")
    assert accepted and accepted[-1][2]["issuer"] == "google"
    assert accepted[-1][2]["domain"] == "start.example"
    assert "testclient" not in str(accepted[-1][2]) and "address_hash" in accepted[-1][2]


def test_an_alias_of_a_mailbox_that_had_its_trial_is_held_for_review(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated, "lee@firm.example")
    assert client.get(f"/organizations/{organization_id}/subscription").json()["state"] == "TRIAL"
    alias, held_firm, held_user = _sign_up(migrated, "lee+second@firm.example")
    assert held_firm != organization_id
    body = alias.get(f"/organizations/{held_firm}/subscription").json()
    assert body["state"] == "SUSPENDED" and body["writable"] is False
    with connect(migrated.url) as connection:
        reason = connection.execute(
            "SELECT status_reason FROM organization_subscriptions WHERE organization_id = %s",
            (held_firm,),
        ).fetchone()
    assert reason == ("duplicate-identity",)
    # The person is signed in and can read, but the held firm creates nothing.
    assert alias.get("/auth/me").status_code == 200
    refused = alias.post(
        f"/organizations/{held_firm}/projects",
        json={
            "name": "Held",
            "slug": "held",
            "scope": "",
            "owner_user_id": str(held_user),
            "status": "DRAFT",
        },
    )
    assert refused.status_code == 402, refused.text
    assert refused.json()["code"] == "SUBSCRIPTION_INACTIVE"
    held = _events(migrated.url, "registration.held")
    assert held and held[-1][1] == held_firm
    # The first firm's trial is untouched, and signing in again makes no more firms.
    assert client.get(f"/organizations/{organization_id}/subscription").json()["state"] == "TRIAL"
    _sign_in(client)
    assert len(client.get("/organizations").json()) == 1
    # A different mailbox on the same domain is a different customer: its own trial.
    other, other_firm, _ = _sign_up(migrated, "sam@firm.example")
    assert other.get(f"/organizations/{other_firm}/subscription").json()["state"] == "TRIAL"


def test_registrations_arriving_together_are_counted_together(migrated: Database) -> None:
    emails = [f"burst{i}@burst.example" for i in range(5)]
    clients = [
        _client(migrated, email, state=f"state-{i}", rate_limit_signup_per_address=2)
        for i, email in enumerate(emails)
    ]
    for client in clients:
        assert client.get("/auth/google/login", follow_redirects=False).status_code == 302
    with ThreadPoolExecutor(max_workers=5) as pool:
        answers = list(
            pool.map(
                lambda pair: pair[1].get(
                    f"/auth/google/callback?code=good-code&state=state-{pair[0]}",
                    follow_redirects=False,
                ),
                list(enumerate(clients)),
            )
        )
    codes = sorted(answer.status_code for answer in answers)
    assert codes == [200, 200, 429, 429, 429], codes
    with connect(migrated.url) as connection:
        firms = connection.execute(
            "SELECT count(*) FROM organizations o JOIN memberships m ON m.organization_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email LIKE 'burst%%'"
        ).fetchone()
    assert firms == (2,)


def test_the_demo_is_started_or_reset_only_so_often(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(
        migrated, "demo-throttle@firm.example", rate_limit_demo_per_firm=2, **PLACEHOLDER
    )
    assert _initialize(client, organization_id).status_code == 200
    assert (
        client.post(
            f"/organizations/{organization_id}/demo/reset", json={"expected_resets": 0}
        ).status_code
        == 200
    )
    third = client.post(f"/organizations/{organization_id}/demo/reset", json={"expected_resets": 1})
    assert third.status_code == 429, third.text
    assert third.json()["code"] == "RATE_LIMITED" and third.headers["retry-after"]
    with connect(migrated.url) as connection:
        # Nothing was reset by the refused request.
        resets = connection.execute(
            "SELECT resets FROM organization_demos WHERE organization_id = %s", (organization_id,)
        ).fetchone()
    assert resets == (1,)


def test_old_windows_are_swept_and_a_threshold_of_zero_turns_a_throttle_off(
    migrated: Database,
) -> None:
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO rate_limit_hits (scope, key, window_start, hits) VALUES ('login', 'old', clock_timestamp() - interval '2 days', 9)"
        )
        connection.commit()
        assert rate_limit.sweep(connection) >= 1
        assert connection.execute(
            "SELECT count(*) FROM rate_limit_hits WHERE key = 'old'"
        ).fetchone() == (0,)
    client = _client(migrated, "unlimited@firm.example", rate_limit_login_per_address=0)
    for _ in range(5):
        assert client.get("/auth/google/login", follow_redirects=False).status_code == 302
        _clear_attempts(migrated.url)


def _unused(_: UUID) -> None:  # keeps the UUID import honest for type checkers
    return None
