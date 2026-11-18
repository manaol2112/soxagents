"""Object storage integrity (pre-launch hardening, Step 7): a row the database refuses
leaves no object behind; a store that fails stores and records nothing; an object no
record names is swept once it is old enough; an object a record names is never touched;
and the development store lets go only of what nothing names."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_engagement_close import _launched
from test_outbound import migrated

from ai_workforce_api import evidence_intake
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.storage import MockObjectStore, StoreError
from ai_workforce_api.storage_sweep import SweepResult, discard, discarding, sweep_orphans

__all__ = ["migrated"]


class MemoryStore:
    """A store with a life of its own, as S3 has: nothing the database does undoes a put."""

    def __init__(self, now: datetime | None = None) -> None:
        self.objects: dict[str, tuple[bytes, datetime]] = {}
        self.now = now or datetime.now(UTC)
        self.failing = False

    def put(self, key: str, content: bytes) -> str:
        if self.failing:
            raise StoreError("object storage is unavailable")
        self.objects.setdefault(key, (content, self.now))
        return hashlib.sha256(content).hexdigest()

    def get(self, key: str) -> bytes:
        return self.objects[key][0]

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def list_keys(self, prefix: str) -> list[tuple[str, datetime]]:
        return [
            (key, moment)
            for key, (_content, moment) in self.objects.items()
            if key.startswith(prefix)
        ]


@contextmanager
def _refusing(connection: psycopg.Connection[Any], file_name: str) -> Iterator[None]:
    """The database refusing one file's row after its bytes are stored: what a constraint,
    an allowance or a lost connection does, without depending on which."""
    connection.execute(
        f"""
        CREATE OR REPLACE FUNCTION pg_temp.refuse_named_file() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.file_name = '{file_name}' THEN
                RAISE EXCEPTION 'refused for the test' USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )
    connection.execute(
        "CREATE TRIGGER evidence_files_refuse_named BEFORE INSERT ON evidence_files FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_named_file()"
    )
    connection.commit()
    try:
        yield
    finally:
        connection.execute("DROP TRIGGER IF EXISTS evidence_files_refuse_named ON evidence_files")
        connection.commit()


def _upload(connection: Any, store: Any, team: dict[str, Any], name: str, content: bytes) -> UUID:
    body, _ = evidence_intake._store_upload(
        connection, store, Principal(PrincipalKind.USER, team["owner_id"]), team["org"],
        team["project"], uuid4(), name, "Evidence", "application/pdf", content,
    )  # fmt: skip
    return UUID(str(body.file_id))


def test_a_refused_upload_leaves_no_object_behind(migrated: Database) -> None:
    team = _launched(migrated, f"store-{uuid4().hex[:6]}")
    store = MemoryStore()
    with connect(migrated.url) as connection:
        # 1. The database refuses the row: the object stored for it goes.
        with _refusing(connection, "refused.pdf"):
            with pytest.raises(psycopg.Error):
                _upload(connection, store, team, "refused.pdf", b"x" * 500)
            connection.rollback()
        assert store.objects == {}
        # 2. An accepted upload keeps its object, with its record naming it.
        file_id = _upload(connection, store, team, "kept.pdf", b"ok")
        connection.commit()
        key = connection.execute(
            "SELECT object_key FROM evidence_files WHERE id = %s", (file_id,)
        ).fetchone()
        assert key is not None and key[0] in store.objects
        # 3. The store itself failing stores nothing and records nothing.
        store.failing = True
        with pytest.raises(StoreError):
            _upload(connection, store, team, "later.pdf", b"later")
        store.failing = False
        assert connection.execute(
            "SELECT count(*) FROM evidence_files WHERE project_id = %s", (team["project"],)
        ).fetchone() == (1,)
        assert len(store.objects) == 1
        # 4. The same file arriving twice at once keeps the first and discards the second's bytes.
        again = _upload(connection, store, team, "kept.pdf", b"ok")
        assert again == file_id and len(store.objects) == 1


def test_discarding_removes_the_object_only_when_the_write_fails() -> None:
    store = MemoryStore()
    store.put("evidence/one", b"1")
    with discarding(store, "evidence/one"):
        pass
    assert "evidence/one" in store.objects
    with pytest.raises(ValueError):
        with discarding(store, "evidence/one"):
            raise ValueError("refused")
    assert "evidence/one" not in store.objects
    # A store that cannot delete never masks the error.
    discard(object(), "evidence/none")  # type: ignore[arg-type]


def test_the_sweep_removes_old_orphans_and_keeps_what_records_name(migrated: Database) -> None:
    team = _launched(migrated, f"sweep-{uuid4().hex[:6]}")
    long_ago = datetime.now(UTC) - timedelta(hours=3)
    store = MemoryStore(now=long_ago)
    with connect(migrated.url) as connection:
        file_id = _upload(connection, store, team, "kept.pdf", b"kept")
        connection.commit()
        kept = connection.execute(
            "SELECT object_key FROM evidence_files WHERE id = %s", (file_id,)
        ).fetchone()
        assert kept is not None
        # Orphans a dead process left: an old one goes, a young one waits, a referenced
        # one is never touched, and a key outside the application's prefixes is ignored.
        store.objects["evidence/" + str(uuid4())] = (b"old orphan", long_ago)
        store.objects["documents/" + str(uuid4())] = (b"old orphan", long_ago)
        store.objects["evidence/" + str(uuid4())] = (b"young", datetime.now(UTC))
        store.objects["other/thing"] = (b"not ours", long_ago)
        result = sweep_orphans(connection, store)
        assert result == SweepResult(listed=4, orphaned=2, removed=2)
        assert str(kept[0]) in store.objects
        assert "other/thing" in store.objects
        assert sum(1 for key in store.objects if key.startswith("evidence/")) == 2
        # Running again finds nothing more to do; a store that cannot list is left alone.
        assert sweep_orphans(connection, store).orphaned == 0
        assert sweep_orphans(connection, object()) == SweepResult(0, 0, 0)  # type: ignore[arg-type]


def test_the_development_store_lets_go_only_of_what_nothing_names(migrated: Database) -> None:
    team = _launched(migrated, f"mock-{uuid4().hex[:6]}")
    with connect(migrated.url) as connection:
        store = MockObjectStore(connection)
        orphan = f"evidence/{uuid4()}"
        store.put(orphan, b"orphan")
        file_id = _upload(connection, store, team, "named.pdf", b"named")
        connection.commit()
        named = connection.execute(
            "SELECT object_key FROM evidence_files WHERE id = %s", (file_id,)
        ).fetchone()
        assert named is not None
        store.delete(orphan)
        connection.commit()
        with pytest.raises(psycopg.errors.CheckViolation):
            store.delete(str(named[0]))
        connection.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE mock_objects SET content = %s WHERE object_key = %s", (b"changed", named[0])
            )
        connection.rollback()
        assert str(named[0]) in [key for key, _ in store.list_keys("evidence/")]
        assert orphan not in [key for key, _ in store.list_keys("evidence/")]
        # The sweep over the development store removes an old orphan and keeps the named.
        old = f"evidence/{uuid4()}"
        connection.execute(
            "INSERT INTO mock_objects (object_key, content, content_sha256, created_at) VALUES (%s, %s, %s, clock_timestamp() - interval '2 hours')",
            (old, b"old", hashlib.sha256(b"old").hexdigest()),
        )
        connection.commit()
        swept = sweep_orphans(connection, store)
        connection.commit()
        assert swept.removed >= 1
        keys = [key for key, _ in store.list_keys("evidence/")]
        assert old not in keys and str(named[0]) in keys
