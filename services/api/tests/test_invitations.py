"""Inviting people by email from the team step, and the checks that keep it from spam."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database

import ai_workforce_api.invitations as invitations
from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.invitations import InviteRefused, MailCheck, normalize_email
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings
from ai_workforce_api.workforce import sync_standard_workforce

FIRM = "firm.example"


class FakeChecker:
    """Answers the mail-domain lookup without the network, and records what was asked."""

    def __init__(self, answers: dict[str, MailCheck] | None = None) -> None:
        self.answers = answers or {}
        self.asked: list[str] = []

    def accepts_mail(self, domain: str) -> MailCheck:
        self.asked.append(domain)
        return self.answers.get(domain, "YES")


def test_addresses_are_normalized_or_refused() -> None:
    assert normalize_email("  Dana.Ruiz@Firm.Example ") == ("Dana.Ruiz@firm.example", FIRM)
    for bad in (
        "dana",
        "dana@",
        "@firm.example",
        "dana@@firm.example",
        "dana..ruiz@firm.example",
        ".dana@firm.example",
        "dana@firm",
        "dana@-firm.example",
        "dana ruiz@firm.example",
        "dana@firm.example<script>",
        f"{'a' * 65}@firm.example",
    ):
        with pytest.raises(InviteRefused) as refused:
            normalize_email(bad)
        assert refused.value.detail == "email is not valid"


def test_an_invite_adds_the_person_with_their_role_and_holds_the_welcome(
    migrated: Database,
) -> None:
    team = _engagement(migrated)
    response = team["owner"].post(
        f"{team['base']}/team/invite",
        json={
            "email": "Dana.Ruiz@firm.example",
            "display_name": "Dana Ruiz",
            "engagement_role": "PREPARER",
        },
    )
    assert response.status_code == 200, response.text
    member = _member(response.json(), "Dana.Ruiz@firm.example")
    assert member["engagement_role"] == "PREPARER"
    assert member["organization_role"] == "CONTRIBUTOR"
    assert (member["validated"], member["welcome_held"]) == (False, True)
    assert member["display_name"] == "Dana Ruiz"
    with connect(migrated.url) as connection:
        invitation = connection.execute(
            """
            SELECT welcome_status, welcome_subject, welcome_body, organization_role::text
            FROM invitations
            """
        ).fetchone()
        audit = connection.execute(
            """
            SELECT action FROM audit_events
            WHERE action IN ('membership.grant', 'invitation.create') ORDER BY action
            """
        ).fetchall()
        mail = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    assert invitation is not None
    assert invitation[0] == "HELD"
    assert team["firm_name"] in invitation[1]
    assert "Dana Ruiz" in invitation[2] and "sign in" in invitation[2]
    assert "preparer" in invitation[2]
    assert invitation[3] == "CONTRIBUTOR"
    assert [row[0] for row in audit] == ["invitation.create", "membership.grant"]
    # Live email is off: nothing reaches the mailbox.
    assert mail == (0,)


def test_the_lead_joins_as_a_project_manager_and_validates_on_sign_in(
    migrated: Database,
) -> None:
    team = _engagement(migrated)
    invited = team["owner"].post(
        f"{team['base']}/team/invite",
        json={"email": "lee@firm.example", "engagement_role": "LEAD"},
    )
    assert invited.status_code == 200, invited.text
    member = _member(invited.json(), "lee@firm.example")
    assert (member["engagement_role"], member["organization_role"]) == ("LEAD", "PROJECT_MANAGER")
    assert member["validated"] is False
    # Signing in with the address is what validates it.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO user_identities (user_id, issuer, subject)
            VALUES (%s, 'google', 'lee-subject')
            """,
            (UUID(member["user_id"]),),
        )
        connection.commit()
    again = team["owner"].get(team["base"]).json()
    assert _member(again, "lee@firm.example")["validated"] is True


@pytest.mark.parametrize(
    ("email", "status", "detail"),
    [
        ("not-an-address", 422, "email is not valid"),
        ("dana@other.example", 422, "email domain is not the firm's"),
        ("dana@mailinator.com", 422, "email domain is disposable"),
        ("dana@nomail.example", 422, "email domain does not accept mail"),
        ("dana@slow.example", 503, "email domain could not be checked"),
    ],
)
def test_spam_filters_refuse_the_invite_and_create_nobody(
    migrated: Database, email: str, status: int, detail: str
) -> None:
    checker = FakeChecker({"nomail.example": "NO", "slow.example": "UNKNOWN"})
    team = _engagement(
        migrated,
        checker=checker,
        extra_domains=["mailinator.com", "nomail.example", "slow.example"],
    )
    before = _users(migrated)
    response = team["owner"].post(
        f"{team['base']}/team/invite", json={"email": email, "engagement_role": "PREPARER"}
    )
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert _users(migrated) == before


def test_a_firm_without_email_domains_cannot_invite(migrated: Database) -> None:
    team = _engagement(migrated, domains=False)
    response = team["owner"].post(
        f"{team['base']}/team/invite",
        json={"email": "dana@firm.example", "engagement_role": "PREPARER"},
    )
    assert (response.status_code, response.json()["detail"]) == (409, "firm has no email domains")


def test_an_inviter_is_limited_per_hour(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(invitations, "HOURLY_LIMIT", 2)
    team = _engagement(migrated)
    for n in range(2):
        ok = team["owner"].post(
            f"{team['base']}/team/invite",
            json={"email": f"p{n}@firm.example", "engagement_role": "PREPARER"},
        )
        assert ok.status_code == 200, ok.text
    third = team["owner"].post(
        f"{team['base']}/team/invite",
        json={"email": "p3@firm.example", "engagement_role": "PREPARER"},
    )
    assert (third.status_code, third.json()["detail"]) == (429, "invitation limit reached")


def test_someone_already_in_the_firm_is_added_without_an_invitation(migrated: Database) -> None:
    team = _engagement(migrated)
    response = team["owner"].post(
        f"{team['base']}/team/invite",
        json={"email": team["reviewer_email"], "engagement_role": "REVIEWER"},
    )
    assert response.status_code == 200, response.text
    member = _member(response.json(), team["reviewer_email"])
    assert (member["engagement_role"], member["welcome_held"]) == ("REVIEWER", False)
    with connect(migrated.url) as connection:
        assert connection.execute("SELECT count(*) FROM invitations").fetchone() == (0,)


def test_a_reviewer_cannot_invite(migrated: Database) -> None:
    team = _engagement(migrated)
    with connect(migrated.url) as connection:
        reviewer = _user(connection, team["org"], f"rev-{uuid4().hex[:6]}@{FIRM}", "REVIEWER")
    client = _client(migrated, reviewer, FakeChecker())
    response = client.post(
        f"{team['base']}/team/invite",
        json={"email": "dana@firm.example", "engagement_role": "PREPARER"},
    )
    assert response.status_code in (403, 404)


def test_owners_manage_the_firm_domains_and_public_mail_is_refused(migrated: Database) -> None:
    team = _engagement(migrated)
    path = f"/organizations/{team['org']}/email-domains"
    assert team["owner"].get(path).json() == {"domains": [FIRM]}
    added = team["owner"].post(path, json={"domain": "@Partner-Firm.Example"})
    assert added.json() == {"domains": [FIRM, "partner-firm.example"]}
    public = team["owner"].post(path, json={"domain": "gmail.com"})
    assert (public.status_code, public.json()["detail"]) == (422, "domain is a public mail service")
    removed = team["owner"].post(f"{path}/remove", json={"domain": "partner-firm.example"})
    assert removed.json() == {"domains": [FIRM]}
    with connect(migrated.url) as connection:
        contributor = _user(connection, team["org"], f"c-{uuid4().hex[:6]}@{FIRM}", "CONTRIBUTOR")
    other = _client(migrated, contributor, FakeChecker())
    assert other.get(path).status_code == 200
    assert other.post(path, json={"domain": "x.example"}).status_code == 403


# Helpers


def _engagement(
    database: Database,
    *,
    checker: FakeChecker | None = None,
    domains: bool = True,
    extra_domains: list[str] | None = None,
) -> dict[str, Any]:
    with connect(database.url) as connection:
        sync_standard_workforce(connection)
        connection.commit()
        name = f"firm-{uuid4().hex[:8]}"
        with transaction(connection) as cursor:
            cursor.execute(
                "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
                (name, name),
            )
            org_row = cursor.fetchone()
            assert org_row is not None
            org = org_row[0]
            if domains:
                for domain in [FIRM, *(extra_domains or [])]:
                    cursor.execute(
                        """
                        INSERT INTO organization_email_domains (organization_id, domain)
                        VALUES (%s, %s)
                        """,
                        (org, domain),
                    )
        owner_id = _user(connection, org, f"owner-{uuid4().hex[:6]}@{FIRM}", "OWNER")
        reviewer_email = f"reviewer-{uuid4().hex[:6]}@{FIRM}"
        _user(connection, org, reviewer_email, "ADMIN")
    owner = _client(database, owner_id, checker or FakeChecker())
    created = owner.post(
        f"/organizations/{org}/projects",
        json={
            "name": "SOX FY27",
            "slug": f"sox-fy27-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(owner_id),
            "status": "DRAFT",
        },
    )
    assert created.status_code in (200, 201), created.text
    project = created.json()["id"]
    return {
        "owner": owner,
        "org": org,
        "firm_name": name,
        "reviewer_email": reviewer_email,
        "base": f"/organizations/{org}/projects/{project}/onboarding",
    }


def _user(connection: Any, org: UUID, email: str, role: str) -> UUID:
    with transaction(connection) as cursor:
        cursor.execute(
            "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
            (email, email.split("@")[0]),
        )
        row = cursor.fetchone()
        assert row is not None
        cursor.execute(
            "INSERT INTO memberships (organization_id, user_id, role) VALUES (%s, %s, %s)",
            (org, row[0], role),
        )
    user_id: UUID = row[0]
    return user_id


def _client(database: Database, user_id: UUID, checker: FakeChecker) -> TestClient:
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
    settings = Settings(
        database_url=database.url,
        session_cookie_secure=False,
        app_base_url="https://app.example.test",
    )
    return TestClient(create_app(settings, domain_checker=checker), cookies={"aw_session": token})


def _member(snapshot: dict[str, Any], email: str) -> dict[str, Any]:
    found: dict[str, Any] = next(m for m in snapshot["team"] if m["email"] == email)
    return found


def _users(database: Database) -> int:
    with connect(database.url) as connection:
        row = connection.execute("SELECT count(*) FROM users").fetchone()
    return int(row[0]) if row is not None else 0


@pytest.fixture
def migrated(empty_database: Database) -> Database:
    from ai_workforce_api.migrate import apply_migrations, migrations_dir

    apply_migrations(empty_database.url, migrations_dir())
    return empty_database
