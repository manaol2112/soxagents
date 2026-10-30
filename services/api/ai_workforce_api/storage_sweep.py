"""Orphaned objects (pre-launch hardening, Step 7).

Every evidence path stores the bytes first and inserts the row after, because the row
carries the object's key and digest. When the row is refused (a trial allowance, a
constraint, a lost connection) the path deletes the object again; when the process dies
between the two, nothing can. This sweep is the second line: every object under the
application's prefixes that no record names, and that is old enough for any upload in
flight to have finished, is removed. A referenced object is never touched, whatever its
age: the records are the authority.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from ai_workforce_api.storage import DeletableStore, ListableStore, ObjectStore, StoreError

logger = logging.getLogger(__name__)

# The prefixes the application writes, and the tables whose rows name them.
PREFIXES: tuple[str, ...] = ("evidence/", "documents/", "exports/")
REFERENCES: tuple[tuple[str, str], ...] = (
    ("evidence_files", "object_key"),
    ("request_attachments", "object_key"),
    ("source_documents", "object_key"),
    ("engagement_exports", "object_key"),
)
# An upload in flight stores its object seconds before its row; an hour is generous.
GRACE_SECONDS = 3600


@dataclass(frozen=True)
class SweepResult:
    listed: int
    orphaned: int
    removed: int


def referenced_keys(connection: psycopg.Connection[Any], keys: list[str]) -> set[str]:
    """Which of these keys a record names, across every table that stores one."""
    if not keys:
        return set()
    found: set[str] = set()
    for table, column in REFERENCES:
        rows = connection.execute(
            f"SELECT {column} FROM {table} WHERE {column} = ANY(%s)",  # noqa: S608 - names are constants
            (keys,),
        ).fetchall()
        found.update(str(row[0]) for row in rows)
    return found


def sweep_orphans(
    connection: psycopg.Connection[Any],
    store: ObjectStore,
    *,
    grace_seconds: int = GRACE_SECONDS,
    now: datetime | None = None,
) -> SweepResult:
    """Remove every object under the application's prefixes that no record names and that
    is older than the grace period. Returns what was listed, what was orphaned, and what
    was removed (a store that cannot delete removes nothing)."""
    if not isinstance(store, ListableStore):
        return SweepResult(0, 0, 0)
    moment = now or datetime.now(UTC)
    cutoff = moment - timedelta(seconds=grace_seconds)
    listed = 0
    orphaned = 0
    removed = 0
    for prefix in PREFIXES:
        try:
            objects = store.list_keys(prefix)
        except StoreError:
            logger.warning("object storage could not be listed for %s", prefix)
            continue
        listed += len(objects)
        old = [key for key, modified in objects if modified <= cutoff]
        if not old:
            continue
        kept = referenced_keys(connection, old)
        for key in old:
            if key in kept:
                continue
            orphaned += 1
            if not isinstance(store, DeletableStore):
                continue
            try:
                store.delete(key)
                removed += 1
            except StoreError:
                logger.warning("orphaned object could not be removed")
    if orphaned:
        logger.warning("storage sweep: %d orphaned object(s), %d removed", orphaned, removed)
    return SweepResult(listed, orphaned, removed)


def discard(store: ObjectStore, key: str) -> None:
    """Compensate a refused row: remove the object just stored for it. Best effort; the
    sweep catches what this cannot."""
    if not isinstance(store, DeletableStore):
        return
    try:
        store.delete(key)
    except StoreError, psycopg.Error:
        logger.warning("stored object could not be removed after the row was refused")


@contextmanager
def discarding(store: ObjectStore, key: str) -> Iterator[None]:
    """Run the record's write; if anything refuses it, remove the object stored for it
    before the error goes on. The object stays only with its record."""
    try:
        yield
    except BaseException:
        discard(store, key)
        raise
