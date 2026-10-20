import os
from collections.abc import Iterator
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from support import Database

from ai_workforce_api import independence


@pytest.fixture(autouse=True)
def workflow_address_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKFLOW_ADDRESS", "")
    monkeypatch.setenv("WORKFLOW_PROVIDER", "")
    monkeypatch.setenv("EMAIL_PROVIDER", "")
    monkeypatch.setenv("EMAIL_ALLOWED_RECIPIENT_DOMAINS", "")
    # A developer's live email settings never reach a test: nothing is sent from tests.
    monkeypatch.setenv("EMAIL_LIVE_SEND_ENABLED", "false")
    for name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "PUBLIC_BASE_URL"):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("MODEL_PROVIDER", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("MODEL_NAME", "")
    monkeypatch.setenv("LOCAL_WORKER_ENABLED", "false")
    # A developer's .env may relax these for local use; tests start from the strict defaults.
    monkeypatch.setenv("REVIEW_INDEPENDENCE_REQUIRED", "true")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setenv("GOOGLE_REDIRECT_URL", "")
    monkeypatch.setenv("DNS_NAMESERVERS", "")
    independence.configure(True)


def _fresh_database(admin_url: str, template: str | None = None) -> Iterator[Database]:
    """A database of its own for one test, empty or cloned from a template, dropped
    afterwards. Every test keeps its own database either way."""
    name = f"ai_workforce_test_{uuid4().hex[:12]}"
    with psycopg.connect(admin_url, autocommit=True) as connection:
        if template is None:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        else:
            connection.execute(
                sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(
                    sql.Identifier(name), sql.Identifier(template)
                )
            )
    url = _database_url(admin_url, name)
    try:
        yield Database(url)
    finally:
        with psycopg.connect(admin_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


@pytest.fixture
def empty_database() -> Iterator[Database]:
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    yield from _fresh_database(admin_url)


@pytest.fixture(scope="session")
def template_database() -> Iterator[str]:
    """The migrations applied once per session (per worker), into a template every
    migrated test database is cloned from: the same schema and seed rows the migration
    runner produces, in a fraction of the time."""
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    from ai_workforce_api.migrate import apply_migrations, migrations_dir

    name = f"ai_workforce_tpl_{uuid4().hex[:12]}"
    with psycopg.connect(admin_url, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    apply_migrations(_database_url(admin_url, name), migrations_dir())
    try:
        yield name
    finally:
        with psycopg.connect(admin_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


@pytest.fixture
def migrated_database(template_database: str) -> Iterator[Database]:
    """A test's own database with every migration applied, cloned from the template."""
    yield from _fresh_database(os.environ["DATABASE_URL"], template_database)


def _database_url(admin_url: str, name: str) -> str:
    if "@" not in admin_url or "/" not in admin_url.rsplit("@", 1)[1]:
        raise AssertionError("DATABASE_URL is missing a database name")
    prefix, _database = admin_url.rsplit("/", 1)
    return f"{prefix}/{name}"
