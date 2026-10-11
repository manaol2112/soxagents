"""Database sessions. Multi-row changes share one transaction."""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg


class ConcurrentUpdateError(Exception):
    """A versioned update did not change exactly one row."""


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection[Any]]:
    with psycopg.connect(database_url, connect_timeout=3) as connection:
        connection.execute("SET TIME ZONE 'UTC'")
        yield connection


@contextmanager
def transaction(connection: psycopg.Connection[Any]) -> Iterator[psycopg.Cursor[Any]]:
    with connection.transaction():
        with connection.cursor() as cursor:
            yield cursor


def independent_steps(connection: psycopg.Connection[Any]) -> None:
    """Commit each transaction block on its own, for background jobs.

    A connection opens a transaction as soon as it is used, so a later transaction
    block would only be a savepoint and hold its locks until the connection closes.
    A background job claims work, calls a model for up to a minute or two, then writes:
    each step must commit by itself, so the claim is visible and no row stays locked
    while the model works.
    """
    if not connection.autocommit:
        connection.commit()
        connection.autocommit = True


def require_one_row(cursor: psycopg.Cursor[Any]) -> None:
    if cursor.rowcount != 1:
        raise ConcurrentUpdateError("expected exactly one row to change")
