"""The landing page's demo request: public, stored, throttled, and never a secret."""

from fastapi.testclient import TestClient
from support import Database
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings

_ = migrated


def test_a_visitor_can_leave_a_demo_request_without_signing_in(migrated: Database) -> None:
    client = TestClient(create_app(Settings(database_url=migrated.url)))
    left = client.post(
        "/public/demo-requests",
        json={
            "name": "Dana Ruiz",
            "email": "Dana@Firm.Example",
            "firm": "Firm LLP",
            "message": "We run forty SOX engagements a year.",
        },
    )
    assert left.status_code == 201, left.text
    assert left.json()["received"] is True
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT name, email, firm, message FROM demo_requests WHERE id = %s",
            (left.json()["id"],),
        ).fetchone()
    assert row == (
        "Dana Ruiz",
        "dana@firm.example",
        "Firm LLP",
        "We run forty SOX engagements a year.",
    )
    # The usual protection still holds for everything else.
    assert client.get("/organizations").status_code == 401


def test_bad_requests_are_refused_and_a_flood_is_throttled(migrated: Database) -> None:
    client = TestClient(create_app(Settings(database_url=migrated.url)))
    no_email = client.post("/public/demo-requests", json={"name": "Pat", "email": "not-an-email"})
    assert no_email.status_code == 422
    secret = client.post(
        "/public/demo-requests",
        json={"name": "Pat", "email": "pat@firm.example", "message": "password: hunter2"},
    )
    assert secret.status_code == 422 and "credential" in secret.json()["detail"]
    # A bot that fills the hidden field is told yes and stored nowhere.
    bot = client.post(
        "/public/demo-requests",
        json={"name": "Bot", "email": "bot@spam.example", "website": "http://spam"},
    )
    assert bot.status_code == 201
    with connect(migrated.url) as connection:
        stored = connection.execute(
            "SELECT count(*) FROM demo_requests WHERE email = 'bot@spam.example'"
        ).fetchone()
    assert stored == (0,)
    for _n in range(5):
        assert (
            client.post(
                "/public/demo-requests", json={"name": "Pat", "email": "flood@firm.example"}
            ).status_code
            == 201
        )
    sixth = client.post(
        "/public/demo-requests", json={"name": "Pat", "email": "flood@firm.example"}
    )
    assert sixth.status_code == 429


def test_the_landing_page_library_figures_come_from_the_library() -> None:
    from ai_workforce_api.controls import LIBRARY, LIBRARY_VERSION
    from ai_workforce_api.workforce import STANDARD_KEYS

    client = TestClient(create_app(Settings()))
    # Public: no session needed, and nothing about any client in it.
    found = client.get("/public/library-summary")
    assert found.status_code == 200
    assert found.json() == {
        "version": LIBRARY_VERSION,
        "controls": len(LIBRARY),
        "areas": len({control.domain for control in LIBRARY}),
        "agents": len(STANDARD_KEYS),
    }
