import json
import os
import re
import warnings
from collections.abc import Iterator
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from support import Database
from temporalio.testing import WorkflowEnvironment

from ai_workforce_api import independence

# Temporal's time-skipping test server (test_durable, test_failures, test_followups) is a
# child process that sdk-core gives a fixed 5 seconds to accept connections. On a loaded
# machine (parallel workers, PostgreSQL in Docker) its start can take longer, and the test
# then failed before running anything ("ephemeral server ... did not start within 5s").
# A start that times out is retried with a fresh server; nothing the tests assert changes,
# and any other failure is raised at once.
_TEST_SERVER_START_ATTEMPTS = 4
_start_time_skipping = WorkflowEnvironment.start_time_skipping


async def _start_time_skipping_with_retry(*args: Any, **kwargs: Any) -> WorkflowEnvironment:
    for attempt in range(1, _TEST_SERVER_START_ATTEMPTS + 1):
        try:
            return await _start_time_skipping(*args, **kwargs)
        except RuntimeError as error:
            if "did not start within" not in str(error) or attempt == _TEST_SERVER_START_ATTEMPTS:
                raise
            warnings.warn(
                f"Temporal test server start {attempt} timed out; retrying: {error}",
                stacklevel=1,
            )
    raise AssertionError("unreachable")


@pytest.fixture(autouse=True, scope="session")
def temporal_test_server_start_retried() -> Iterator[None]:
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(
            WorkflowEnvironment,
            "start_time_skipping",
            staticmethod(_start_time_skipping_with_retry),
        )
        yield


@pytest.fixture(autouse=True)
def workflow_address_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKFLOW_ADDRESS", "")
    monkeypatch.setenv("WORKFLOW_PROVIDER", "")
    monkeypatch.setenv("EMAIL_PROVIDER", "")
    monkeypatch.setenv("EMAIL_ALLOWED_RECIPIENT_DOMAINS", "")
    # A developer's live email settings never reach a test: nothing is sent from tests.
    monkeypatch.setenv("EMAIL_LIVE_SEND_ENABLED", "false")
    for name in (
        "SMTP_HOST",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "EMAIL_FROM",
        "PUBLIC_BASE_URL",
        "SUPPORT_NOTIFY_EMAIL",
    ):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("MODEL_PROVIDER", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    monkeypatch.setenv("MODEL_NAME", "")
    monkeypatch.setenv("LOCAL_WORKER_ENABLED", "false")
    # The developer's .env names the demo dataset for the local stack; a test that needs one
    # passes demo_dataset in Settings (test_demo.py). Start from none configured.
    monkeypatch.setenv("DEMO_DATASET", "")
    # A developer's .env may relax these for local use; tests start from the strict defaults.
    monkeypatch.setenv("REVIEW_INDEPENDENCE_REQUIRED", "true")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "")
    monkeypatch.setenv("GOOGLE_REDIRECT_URL", "")
    monkeypatch.setenv("DNS_NAMESERVERS", "")
    independence.configure(True)


def _fresh_database(
    admin_url: str, owner: str, template: str | None = None, test: str = ""
) -> Iterator[Database]:
    """A database of its own for one test, empty or cloned from a template, dropped
    afterwards. Every test keeps its own database either way."""
    name = _owned_name("test", owner)
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
            _audit_connections(connection, name, test)
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


# Leftover databases (M3d hygiene). Each pytest process (each xdist worker) owns the
# databases it creates: their names carry the process's owner token, and the process keeps
# one connection open for the whole session with that token as its application_name
# (visible in pg_stat_activity across the server, whichever database a run uses). A
# database whose owner has no such connection belongs to a run that was killed before its
# teardown, and the next session drops it. Databases named otherwise (by an older checkout
# running at the same time) are never touched.
_OWNER = uuid4().hex[:8]
_TEMPLATE_BUILD_LOCK = 0x4157_5450_0000_0001  # advisory lock serializing template builds
_OWNED = re.compile(r"^ai_workforce_(?:test|tpl)_([0-9a-f]{8})_[0-9a-f]{8}$")


def _owned_name(kind: str, owner: str) -> str:
    return f"ai_workforce_{kind}_{owner}_{uuid4().hex[:8]}"


def _owner_application(owner: str) -> str:
    return f"ai_workforce_tests_{owner}"


def _drop_abandoned(connection: psycopg.Connection, owner: str) -> None:
    names = connection.execute(
        "SELECT datname FROM pg_database WHERE datname LIKE 'ai_workforce_%'"
    ).fetchall()
    live = {
        str(row[0])
        for row in connection.execute(
            "SELECT application_name FROM pg_stat_activity "
            "WHERE application_name LIKE 'ai_workforce_tests_%'"
        ).fetchall()
    }
    for (name,) in names:
        found = _OWNED.match(str(name))
        if found is None or found.group(1) == owner:
            continue
        if _owner_application(found.group(1)) in live:
            continue  # its owner is still running
        try:
            connection.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )
        except psycopg.Error:
            continue  # another session dropped it first; cleanup is best effort


@pytest.fixture(scope="session")
def database_owner() -> Iterator[str]:
    """This process's owner token, announced by a connection held for the whole session,
    after dropping the databases a killed run left behind."""
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    with psycopg.connect(
        admin_url, autocommit=True, application_name=_owner_application(_OWNER)
    ) as connection:
        _drop_abandoned(connection, _OWNER)
        yield _OWNER


def _audit_connections(connection: psycopg.Connection, name: str, test: str) -> None:
    """With TEST_CONNECTION_AUDIT naming a file (M3d closure): the connections to the test's
    database still open when the test ends, before the forced drop closes them. Each one is
    a connection the test or the code it ran never closed. Off by default."""
    target = os.environ.get("TEST_CONNECTION_AUDIT", "")
    if target == "":
        return
    rows = connection.execute(
        "SELECT coalesce(state, ''), count(*) FROM pg_stat_activity WHERE datname = %s GROUP BY 1",
        (name,),
    ).fetchall()
    entry = {"test": test, "database": name, "open": {str(state): int(n) for state, n in rows}}
    with open(f"{target}.{os.getpid()}", "a", encoding="utf-8") as log:
        log.write(json.dumps(entry) + "\n")


@pytest.fixture
def empty_database(database_owner: str, request: pytest.FixtureRequest) -> Iterator[Database]:
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    yield from _fresh_database(admin_url, database_owner, test=request.node.nodeid)


@pytest.fixture(scope="session")
def template_database(database_owner: str) -> Iterator[str]:
    """The migrations applied once per session (per worker), into a template every
    migrated test database is cloned from: the same schema and seed rows the migration
    runner produces, in a fraction of the time."""
    admin_url = os.environ.get("DATABASE_URL", "")
    if admin_url == "":
        pytest.skip("DATABASE_URL is not set")
    from ai_workforce_api.migrate import apply_migrations, migrations_dir

    name = _owned_name("tpl", database_owner)
    with psycopg.connect(admin_url, autocommit=True) as connection:
        # One template is built at a time across every run on this server. Applied at once
        # by eight or more processes (one run's workers, or two runs together), the
        # migrations exhaust PostgreSQL's shared lock table ("out of shared memory ...
        # max_locks_per_transaction") and every test of those workers errors; one after
        # another, each build takes a second or two instead of half a minute under load.
        connection.execute("SELECT pg_advisory_lock(%s)", (_TEMPLATE_BUILD_LOCK,))
        try:
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            apply_migrations(_database_url(admin_url, name), migrations_dir())
        finally:
            connection.execute("SELECT pg_advisory_unlock(%s)", (_TEMPLATE_BUILD_LOCK,))
    try:
        yield name
    finally:
        with psycopg.connect(admin_url, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )


@pytest.fixture
def migrated_database(
    database_owner: str, template_database: str, request: pytest.FixtureRequest
) -> Iterator[Database]:
    """A test's own database with every migration applied, cloned from the template."""
    yield from _fresh_database(
        os.environ["DATABASE_URL"], database_owner, template_database, test=request.node.nodeid
    )


def _database_url(admin_url: str, name: str) -> str:
    if "@" not in admin_url or "/" not in admin_url.rsplit("@", 1)[1]:
        raise AssertionError("DATABASE_URL is missing a database name")
    prefix, _database = admin_url.rsplit("/", 1)
    return f"{prefix}/{name}"
