"""The database URL's localhost host, pointed at 127.0.0.1 (16 November 2026).

Compose publishes PostgreSQL on 127.0.0.1 only. On Windows a `localhost` URL tried ::1
first and waited seconds on every connection, longer than the web app's three seconds a
request, so signed-in pages showed "Workspace unavailable"."""

import pytest

from ai_workforce_api.settings import Settings, loopback_database_url


@pytest.mark.parametrize(
    ("given", "used"),
    [
        (
            "postgresql://user:p%40ss:word@localhost:5432/ai_workforce",
            "postgresql://user:p%40ss:word@127.0.0.1:5432/ai_workforce",
        ),
        (
            "postgres://user@LocalHost/db?sslmode=disable",
            "postgres://user@127.0.0.1/db?sslmode=disable",
        ),
        ("postgresql://localhost:5433/db", "postgresql://127.0.0.1:5433/db"),
    ],
)
def test_a_localhost_url_is_pointed_at_the_ipv4_loopback(given: str, used: str) -> None:
    assert loopback_database_url(given) == used
    assert Settings(database_url=given).database_url == used


@pytest.mark.parametrize(
    "given",
    [
        "",
        "postgresql://user:secret@127.0.0.1:5432/db",
        "postgresql://user:secret@db.internal:5432/db",
        "postgresql://user:localhost@db.internal/db",
        "postgresql://user:secret@localhost.example.com/db",
        "host=localhost dbname=db",
        "https://localhost/db",
        "postgresql://user:secret@localhost:notaport/db",
    ],
)
def test_any_other_url_is_left_as_given(given: str) -> None:
    assert loopback_database_url(given) == given
