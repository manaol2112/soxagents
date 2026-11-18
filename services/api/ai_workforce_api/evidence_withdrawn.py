"""Whether an evidence file is withdrawn (Milestone 8.3b).

A withdrawn file keeps its custody record, but nothing reads it as evidence any more: it is
off the register, matching, testing, workpapers, and the console. The links view
(`evidence_file_links`) leaves withdrawn files out; readers that go to `evidence_files`
directly use this check.
"""

from typing import Any
from uuid import UUID

import psycopg


def in_force(alias: str) -> str:
    """SQL that is true when the file under `alias` has a withdrawal in force."""
    return (
        "EXISTS (SELECT 1 FROM evidence_withdrawals w "
        f"WHERE w.evidence_file_id = {alias}.id AND w.restored_at IS NULL)"
    )


def is_withdrawn(connection: psycopg.Connection[Any] | psycopg.Cursor[Any], file_id: UUID) -> bool:
    row = connection.execute(
        "SELECT 1 FROM evidence_withdrawals WHERE evidence_file_id = %s AND restored_at IS NULL",
        (file_id,),
    ).fetchone()
    return row is not None
