"""Apply versioned SQL migrations."""

import hashlib
import re
from pathlib import Path
from typing import Any

import psycopg
from psycopg import ClientCursor

from ai_workforce_api.settings import Settings

MIGRATION_LOCK = 742001
MIGRATION_NAME = re.compile(r"^(\d{4}_[a-z0-9_]+)\.sql$")


class MigrationError(Exception):
    """A migration file or the schema history is not usable."""


class ChecksumMismatch(MigrationError):
    """An applied migration file no longer matches the stored checksum."""


def list_migrations(directory: Path) -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for path in sorted(directory.glob("*.sql")):
        match = MIGRATION_NAME.match(path.name)
        if match is None:
            raise MigrationError(f"unexpected migration filename: {path.name}")
        found.append((match.group(1), path))
    if not found:
        raise MigrationError(f"no migrations in {directory}")
    numbers = [int(version.split("_", 1)[0]) for version, _path in found]
    if numbers != list(range(1, len(numbers) + 1)):
        raise MigrationError("migration numbers must be contiguous from 0001")
    return found


def file_checksum(path: Path) -> str:
    payload = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(payload).hexdigest()


def apply_migrations(database_url: str, directory: Path) -> list[str]:
    applied: list[str] = []
    with psycopg.connect(database_url, connect_timeout=3) as connection:
        connection.execute("SET TIME ZONE 'UTC'")
        connection.commit()
        connection.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK,))
        connection.commit()
        try:
            _ensure_history(connection)
            for version, path in list_migrations(directory):
                digest = file_checksum(path)
                existing = _stored_checksum(connection, version)
                if existing is None:
                    _apply_one(connection, version, path.read_text(encoding="utf-8"), digest)
                    applied.append(version)
                elif existing != digest:
                    raise ChecksumMismatch(version)
        finally:
            if connection.info.transaction_status == psycopg.pq.TransactionStatus.INERROR:
                connection.rollback()
            connection.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK,))
            connection.commit()
    return applied


def _ensure_history(connection: psycopg.Connection[Any]) -> None:
    with connection.transaction():
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
            )
            """
        )


def _stored_checksum(connection: psycopg.Connection[Any], version: str) -> str | None:
    row = connection.execute(
        "SELECT checksum FROM schema_migrations WHERE version = %s",
        (version,),
    ).fetchone()
    if row is None:
        return None
    checksum = row[0]
    if not isinstance(checksum, str):
        raise MigrationError("schema_migrations.checksum is not text")
    return checksum


def _apply_one(connection: psycopg.Connection[Any], version: str, script: str, digest: str) -> None:
    with connection.transaction():
        with ClientCursor(connection) as cursor:
            cursor.execute(script)
        connection.execute(
            "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
            (version, digest),
        )


def migrations_dir() -> Path:
    start = Path(__file__).resolve()
    for parent in start.parents:
        candidate = parent / "migrations" / "0001_conventions.sql"
        if candidate.is_file():
            return candidate.parent
    raise MigrationError("migrations directory not found")


def main() -> None:
    settings = Settings()
    if settings.database_url == "":
        raise SystemExit("DATABASE_URL is not set")
    applied = apply_migrations(settings.database_url, migrations_dir())
    if applied:
        print("applied " + ", ".join(applied))
    else:
        print("migrations are current")
    # The standard workforce is part of every deploy, so no firm sets it up by hand.
    from ai_workforce_api.workforce import sync_standard_workforce

    with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
        result = sync_standard_workforce(connection)
    print(
        f"standard workforce: {result.roster_workers} workers, {result.installed} installed, "
        f"{result.updated} updated, {result.retired} retired, {result.staffed} staffed"
    )
    # Library attributes are settled by the rules, never left for a person to tidy
    # (milestone L3e): plans that do not yet follow their standard's attributes catch up.
    from ai_workforce_api.master_plans import settle_library_attributes

    with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
        settled = settle_library_attributes(connection)
    print(f"library attributes: {settled.linked} settled, {settled.redrawn} plans redrawn")
    # Results signed off under an earlier or unrecorded plan revision get their impact
    # assessment raised for a reviewer (plan_impact.py, W3); none is assumed valid.
    from ai_workforce_api.plan_impact import detect_everywhere

    with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
        raised = detect_everywhere(connection)
    print(f"plan impact: {raised} assessments raised")
    # Stored prompts and answers past their retention are removed; the call records and
    # their hashes stay (Milestone 3a, provenance.py).
    from ai_workforce_api.provenance import purge_expired_contents

    with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
        purged = purge_expired_contents(connection)
    print(f"model call contents: {purged} expired records removed")


if __name__ == "__main__":
    main()
