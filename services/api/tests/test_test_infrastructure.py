"""The test harness itself (conftest.py): leftover databases and the Temporal test server."""

import asyncio
import os
from typing import Any
from uuid import uuid4

import conftest
import psycopg
import pytest
from psycopg import sql


def _exists(connection: psycopg.Connection, name: str) -> bool:
    row = connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
    return row is not None


def test_only_a_killed_runs_databases_are_dropped(database_owner: str) -> None:
    admin_url = os.environ["DATABASE_URL"]
    dead_owner = uuid4().hex[:8]
    live_owner = uuid4().hex[:8]
    dead = f"ai_workforce_test_{dead_owner}_{uuid4().hex[:8]}"
    live = f"ai_workforce_tpl_{live_owner}_{uuid4().hex[:8]}"
    # A name in the older format (another checkout's run) is never touched.
    foreign = f"ai_workforce_test_{uuid4().hex[:12]}"
    own = f"ai_workforce_test_{database_owner}_{uuid4().hex[:8]}"
    names = (dead, live, foreign, own)
    with (
        psycopg.connect(admin_url, autocommit=True) as connection,
        psycopg.connect(
            admin_url, autocommit=True, application_name=conftest._owner_application(live_owner)
        ),
    ):
        try:
            for name in names:
                connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            conftest._drop_abandoned(connection, database_owner)
            assert not _exists(connection, dead)
            assert _exists(connection, live)
            assert _exists(connection, foreign)
            assert _exists(connection, own)
        finally:
            for name in names:
                connection.execute(
                    sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
                )


def test_a_test_server_start_that_times_out_is_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []
    started = object()

    async def flaky(*_args: Any, **_kwargs: Any) -> object:
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError(
                "Failed starting test server: ephemeral server at 127.0.0.1:1 did not start "
                "within 5s"
            )
        return started

    monkeypatch.setattr(conftest, "_start_time_skipping", flaky)
    with pytest.warns(UserWarning, match="timed out; retrying"):
        result = asyncio.run(conftest._start_time_skipping_with_retry())
    assert result is started
    assert len(calls) == 3


def test_any_other_start_failure_is_raised_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    async def broken(*_args: Any, **_kwargs: Any) -> object:
        calls.append(1)
        raise RuntimeError("Failed starting test server: executable does not exist")

    monkeypatch.setattr(conftest, "_start_time_skipping", broken)
    with pytest.raises(RuntimeError, match="executable does not exist"):
        asyncio.run(conftest._start_time_skipping_with_retry())
    assert len(calls) == 1


def test_a_start_that_keeps_timing_out_fails_after_the_last_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[int] = []

    async def stuck(*_args: Any, **_kwargs: Any) -> object:
        calls.append(1)
        raise RuntimeError("ephemeral server at 127.0.0.1:1 did not start within 5s")

    monkeypatch.setattr(conftest, "_start_time_skipping", stuck)
    with pytest.warns(UserWarning), pytest.raises(RuntimeError, match="did not start within"):
        asyncio.run(conftest._start_time_skipping_with_retry())
    assert len(calls) == conftest._TEST_SERVER_START_ATTEMPTS
