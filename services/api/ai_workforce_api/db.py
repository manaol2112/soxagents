"""Database sessions. Multi-row changes share one transaction."""

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg import sql

logger = logging.getLogger(__name__)


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


# A background run's claim (reliability audit, 17 November 2026). A run claims its row
# (status WORKING, attempts + 1, a lease) and commits the claim before it works. A run that
# raised after its claim left the row WORKING under a live lease: the engine's retry, a
# second later, found it claimed and returned SKIPPED, the workflow ended as if it had
# finished, its failure step never ran, and the work waited, WORKING, until the lease ran
# out and a restart picked it up. A runner now holds what it claimed (hold_claim) and, when
# it raises, gives it back (releasing_claims): back to PENDING, the lease cleared, so the
# retry claims it again and the last failure is recorded by the failure step.


@dataclass(frozen=True)
class Claim:
    """One claimed row: the table, the row's key, its status, attempts and lease columns,
    and the attempts count the claim set, which says the claim is still this run's."""

    table: str
    key_column: str
    key: Any
    status_column: str
    attempts_column: str
    attempts: int
    lease_column: str
    working: str
    pending: str


_HELD: ContextVar[list[Claim] | None] = ContextVar("held_claims", default=None)


def hold_claim(
    cursor: psycopg.Cursor[Any],
    table: str,
    key_column: str,
    key: Any,
    status_column: str,
    *,
    attempts_column: str = "attempts",
    lease_column: str = "lease_until",
    working: str = "WORKING",
    pending: str = "PENDING",
) -> None:
    """Remember the row a run just claimed, in the claim's own transaction, for
    releasing_claims. Outside releasing_claims (a test or a script calling the run
    directly) nothing is remembered, as before."""
    held = _HELD.get()
    if held is None:
        return
    row = cursor.execute(
        sql.SQL("SELECT {} FROM {} WHERE {} = %s").format(
            sql.Identifier(attempts_column), sql.Identifier(table), sql.Identifier(key_column)
        ),
        (key,),
    ).fetchone()
    if row is None:
        return
    held.append(
        Claim(
            table=table,
            key_column=key_column,
            key=key,
            status_column=status_column,
            attempts_column=attempts_column,
            attempts=int(row[0]),
            lease_column=lease_column,
            working=working,
            pending=pending,
        )
    )


def release_claim(connection: psycopg.Connection[Any], claim: Claim) -> bool:
    """Give a claim back: PENDING with no lease, only while the row is still WORKING on this
    claim's attempt. A run that took the row over after this lease ran out has counted
    another attempt, so its claim is never given back by this one. Returns whether it was."""
    with transaction(connection) as cursor:
        cursor.execute(
            sql.SQL(
                "UPDATE {table} SET {status} = %s, {lease} = NULL "
                "WHERE {key} = %s AND {status} = %s AND {attempts} = %s"
            ).format(
                table=sql.Identifier(claim.table),
                status=sql.Identifier(claim.status_column),
                lease=sql.Identifier(claim.lease_column),
                key=sql.Identifier(claim.key_column),
                attempts=sql.Identifier(claim.attempts_column),
            ),
            (claim.pending, claim.key, claim.working, claim.attempts),
        )
        return cursor.rowcount == 1


@contextmanager
def releasing_claims(database_url: str) -> Iterator[None]:
    """Run a background job; if it raises, give back every claim it holds (hold_claim) on
    a connection of its own (the job's may be the one that failed), then raise again, so
    the workflow engine retries and, after the last attempt, records the failure."""
    held: list[Claim] = []
    token = _HELD.set(held)
    try:
        yield
    except Exception:
        if held:
            try:
                with connect(database_url) as connection:
                    for claim in held:
                        release_claim(connection, claim)
            except psycopg.Error:
                logger.warning("a failed run's claim could not be given back; its lease ends it")
        raise
    finally:
        _HELD.reset(token)
