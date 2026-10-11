import os
from collections.abc import Iterator
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from support import Database


@pytest.fixture(autouse=True)
def workflow_address_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKFLOW_ADDRESS", "")
    monkeypatch.setenv("WORKFLOW_PROVIDER", "")
    monkeypatch.setenv("EMAIL_PROVIDER", "")
    monkeypatch.setenv("EMAIL_ALLOWED_RECIPIENT_DOMAINS", "")
    monkeypatch.setenv("MODEL_PROVIDER", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("MODEL_NAME", "")


@pytest.fixture
def empty_database() -> Iterator[Database]:
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    name = f"ai_workforce_test_{uuid4().hex[:12]}"
    with psycopg.connect(admin_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    url = _database_url(admin_url, name)
    try:
        yield Database(url)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


def _database_url(admin_url: str, name: str) -> str:
    if "@" not in admin_url or "/" not in admin_url.rsplit("@", 1)[1]:
        raise AssertionError("DATABASE_URL is missing a database name")
    prefix, _database = admin_url.rsplit("/", 1)
    return f"{prefix}/{name}"
