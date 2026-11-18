"""Which request and control a stored file belongs to, however it arrived.

A mailbox attachment belongs to the request its reply was matched or assigned to. An
uploaded file belongs to the control it was filed to, and that control's request. The
`evidence_file_links` view (migration 0033) holds both, so every reader agrees.
"""

import re
from typing import Any
from uuid import UUID

import psycopg

# (request id, control ref, what the request asks for, control id)
RequestRef = tuple[UUID, str, str, UUID | None]


def file_request(
    connection: psycopg.Connection[Any], project_id: UUID, file_id: UUID
) -> RequestRef | None:
    row = connection.execute(
        """
        SELECT r.id, r.control_ref, r.evidence_description, r.engagement_control_id
        FROM evidence_file_links l
        JOIN pbc_requests r ON r.id = l.pbc_request_id AND r.project_id = l.project_id
        WHERE l.evidence_file_id = %s AND l.project_id = %s
        """,
        (file_id, project_id),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), str(row[2]), row[3]


_PROCESS_WORDS = re.compile(
    r"(?i)\b(?:polic(?:y|ies)|procedures?|narratives?|flow ?charts?|standard operating|sop)\b"
)


def evidence_hint(file_name: str, file_kind: str, text: str) -> str | None:
    """The evidence category a file most likely answers, to choose among a control's
    phase requests: a spreadsheet is a population, a policy or procedure is process
    documentation. None when the file does not say."""
    if file_kind in ("workbook", "csv"):
        return "POPULATION"
    if _PROCESS_WORDS.search(file_name) or _PROCESS_WORDS.search(text[:2000]):
        return "PROCESS_DOCUMENTATION"
    return None


def control_request(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    prefer: str | None = None,
) -> RequestRef | None:
    """The request a file for this control answers: the earliest one still open.

    A request whose planned evidence includes the category the file most likely answers
    comes first. Then operating evidence before design evidence, so a population reaches
    the interim request. A sample request (drafted when samples are approved) is chosen
    only after the control's other requests, and a received request only when none is
    still waiting.
    """
    row = connection.execute(
        """
        SELECT r.id, r.control_ref, r.evidence_description, r.engagement_control_id
        FROM pbc_requests r
        WHERE r.project_id = %s AND r.engagement_control_id = %s
          AND r.status NOT IN ('CANCELLED', 'CLOSED')
        ORDER BY r.status = 'RECEIVED',
                 NOT EXISTS (
                     SELECT 1 FROM evidence_requirements q
                     WHERE q.pbc_request_id = r.id AND q.status = 'REQUESTED'
                       AND q.categories && ARRAY[%s]::text[]
                 ),
                 r.operation_key LIKE 'samples-%%',
                 r.testing_phase IS NOT DISTINCT FROM 'DESIGN',
                 r.created_at
        LIMIT 1
        """,
        (project_id, control_id, prefer or ""),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), str(row[2]), row[3]
