"""The evidence portal as the control owner's working space (migration 0078).

What the owner sees for each request: its title and type, the short explanation, each
deliverable (a numbered item of the request's wording, linked to its planned requirement
where one matches) with the files they uploaded for it, the audit team's questions with
their answers, the messages on the request, and a status written for them. The owner
answers questions, writes to the audit team, and says when they have submitted what they
have; uploads reach the audit team the moment they arrive (decided by the product owner).

Statuses are derived from the records, never stored: a file arriving never makes a
deliverable accepted; only the audit team's judgment does. The owner never sees the team's
internal notes, the testing, or anything uploaded by someone else.
"""

import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel, Field

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.inbound import clean_line

OwnerStatus = Literal[
    "AWAITING", "IN_PROGRESS", "SUBMITTED", "UNDER_REVIEW", "MORE_NEEDED", "COMPLETED"
]
OWNER_STATUS_LABELS: dict[str, str] = {
    "AWAITING": "Awaiting your response",
    "IN_PROGRESS": "In progress",
    "SUBMITTED": "Submitted",
    "UNDER_REVIEW": "Under review",
    "MORE_NEEDED": "More information requested",
    "COMPLETED": "Completed",
}
ItemState = Literal["NOT_STARTED", "UPLOADED", "UNDER_REVIEW", "MORE_NEEDED", "ACCEPTED"]
ITEM_STATE_LABELS: dict[str, str] = {
    "NOT_STARTED": "Not started",
    "UPLOADED": "Uploaded",
    "UNDER_REVIEW": "Under review",
    "MORE_NEEDED": "More information requested",
    "ACCEPTED": "Accepted",
}
MAX_TEXT = 4000


class PortalItemFile(BaseModel):
    file_name: str
    size_bytes: int
    added_at: datetime


class PortalDeliverable(BaseModel):
    number: int
    title: str
    detail: str
    period: str
    include: list[str]
    format: str
    show: str
    completeness: str
    state: ItemState
    state_label: str
    files: list[PortalItemFile]


class PortalQuestion(BaseModel):
    key: str
    text: str
    answer: str
    answered_at: datetime | None


class PortalMessage(BaseModel):
    id: UUID
    # YOU: the owner wrote it. AUDIT_TEAM: a member of the audit team did.
    author: Literal["YOU", "AUDIT_TEAM"]
    author_name: str
    body: str
    created_at: datetime


class AnswerItem(BaseModel):
    key: str = Field(pattern=r"^[0-9a-f]{16}$")
    answer: str = Field(max_length=MAX_TEXT)


class AnswersBody(BaseModel):
    answers: list[AnswerItem] = Field(max_length=30)


class MessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_TEXT)


class SubmitBody(BaseModel):
    note: str = Field(default="", max_length=2000)
    # The owner confirmed submitting with some items still empty.
    confirm_incomplete: bool = False


class WorkspaceState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def question_key(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()[:16]


def owner_status(
    request_status: str,
    files: int,
    submitted: bool,
    sufficiency: list[str],
) -> OwnerStatus:
    """The request's status as the owner should read it, from its records."""
    if request_status == "CLOSED":
        return "COMPLETED"
    if sufficiency and all(item == "ACCEPTED" for item in sufficiency):
        return "COMPLETED"
    if any(item in ("INSUFFICIENT", "FOLLOW_UP_REQUIRED") for item in sufficiency):
        return "MORE_NEEDED"
    if submitted:
        reviewing = request_status in ("RECEIVED", "PARTIALLY_RECEIVED") or any(
            item in ("UNDER_REVIEW", "ACCEPTED") for item in sufficiency
        )
        return "UNDER_REVIEW" if reviewing else "SUBMITTED"
    if files > 0:
        return "IN_PROGRESS"
    return "AWAITING"


def item_state(files: int, sufficiency: str | None) -> ItemState:
    if sufficiency == "ACCEPTED":
        return "ACCEPTED"
    if sufficiency in ("INSUFFICIENT", "FOLLOW_UP_REQUIRED"):
        return "MORE_NEEDED"
    if sufficiency == "UNDER_REVIEW":
        return "UNDER_REVIEW"
    return "UPLOADED" if files > 0 else "NOT_STARTED"


@dataclass(frozen=True)
class RequestFacts:
    """What the portal shows for one request, read for the owner."""

    title: str
    type_label: str
    summary: str
    closing: str
    structured: bool
    deliverables: list[PortalDeliverable]
    unfiled: list[PortalItemFile]
    questions: list[PortalQuestion]
    messages: list[PortalMessage]
    submitted_at: datetime | None
    status: OwnerStatus
    period: str


def request_facts(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    request_id: UUID,
    recipient: str,
    request_status: str,
) -> RequestFacts:
    from ai_workforce_api.request_details import client_content

    title, type_label, content = client_content(connection, project_id, request_id)
    requirements = _requirements(connection, request_id)
    files = _owner_files(connection, project_id, request_id, recipient)
    by_item: dict[int, list[PortalItemFile]] = {}
    unfiled: list[PortalItemFile] = []
    for item_number, upload in files:
        if item_number is None:
            unfiled.append(upload)
        else:
            by_item.setdefault(item_number, []).append(upload)
    deliverables: list[PortalDeliverable] = []
    if content.structured:
        for item in content.items:
            sufficiency = requirements.get(" ".join(item.title.lower().split()))
            item_files = by_item.get(item.number, [])
            state = item_state(len(item_files), sufficiency)
            deliverables.append(
                PortalDeliverable(
                    number=item.number,
                    title=item.title,
                    detail=item.detail,
                    period=item.period,
                    include=item.include,
                    format=item.format,
                    show=item.show,
                    completeness=item.completeness,
                    state=state,
                    state_label=ITEM_STATE_LABELS[state],
                    files=item_files,
                )
            )
    else:
        # Wording a person wrote freely: one deliverable, the request as written.
        state = item_state(len(files), None)
        deliverables.append(
            PortalDeliverable(
                number=1,
                title=title,
                detail="",
                period="",
                include=[],
                format="",
                show="",
                completeness="",
                state=state,
                state_label=ITEM_STATE_LABELS[state],
                files=[upload for _, upload in files],
            )
        )
        unfiled = []
    answers = _answers(connection, request_id)
    questions = [
        PortalQuestion(
            key=question_key(text),
            text=text,
            answer=answers.get(question_key(text), ("", None))[0],
            answered_at=answers.get(question_key(text), ("", None))[1],
        )
        for text in content.questions
    ]
    submitted = connection.execute(
        "SELECT owner_submitted_at FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    submitted_at = None if submitted is None else submitted[0]
    status = owner_status(
        request_status, len(files), submitted_at is not None, list(requirements.values())
    )
    periods = [item.period for item in content.items if item.period]
    return RequestFacts(
        title=title,
        type_label=type_label,
        summary=content.summary,
        closing=content.closing,
        structured=content.structured,
        deliverables=deliverables,
        unfiled=unfiled,
        questions=questions,
        messages=messages_of(connection, request_id, owner_view=True),
        submitted_at=submitted_at,
        status=status,
        period=periods[0] if len(set(periods)) == 1 else "",
    )


def _requirements(connection: psycopg.Connection[Any], request_id: UUID) -> dict[str, str]:
    """Each requested requirement's sufficiency, by its title."""
    return {
        " ".join(str(row[0]).lower().split()): str(row[1])
        for row in connection.execute(
            "SELECT title, sufficiency FROM evidence_requirements WHERE pbc_request_id = %s "
            "AND status = 'REQUESTED'",
            (request_id,),
        ).fetchall()
    }


def _owner_files(
    connection: psycopg.Connection[Any], project_id: UUID, request_id: UUID, recipient: str
) -> list[tuple[int | None, PortalItemFile]]:
    """The files this address uploaded for the request, with the item each was for."""
    return [
        (
            None if row[0] is None else int(row[0]),
            PortalItemFile(file_name=str(row[1]), size_bytes=int(row[2]), added_at=row[3]),
        )
        for row in connection.execute(
            """
            SELECT m.owner_item, f.file_name, f.size_bytes, f.created_at
            FROM evidence_files f
            JOIN evidence_matches m ON m.evidence_file_id = f.id
            WHERE f.project_id = %s AND m.pbc_request_id = %s
              AND lower(f.uploaded_by_email::text) = %s
            ORDER BY f.created_at
            """,
            (project_id, request_id, recipient.lower()),
        ).fetchall()
    ]


def _answers(
    connection: psycopg.Connection[Any], request_id: UUID
) -> dict[str, tuple[str, datetime | None]]:
    return {
        str(row[0]): (str(row[1]), row[2])
        for row in connection.execute(
            "SELECT question_key, answer, updated_at FROM request_answers "
            "WHERE pbc_request_id = %s",
            (request_id,),
        ).fetchall()
    }


def messages_of(
    connection: psycopg.Connection[Any], request_id: UUID, owner_view: bool
) -> list[PortalMessage]:
    """The request's messages, oldest first. The owner sees the team as the audit team,
    with the member's name; the team sees the owner's address."""
    rows = connection.execute(
        """
        SELECT m.id, m.author_kind, m.author_email, coalesce(u.display_name, ''), m.body,
               m.created_at
        FROM request_messages m LEFT JOIN users u ON u.id = m.author_user_id
        WHERE m.pbc_request_id = %s
        ORDER BY m.created_at, m.id
        """,
        (request_id,),
    ).fetchall()
    found: list[PortalMessage] = []
    for row in rows:
        mine = row[1] == "OWNER"
        if owner_view:
            name = "You" if mine else (f"{row[3]}, audit team" if row[3] else "Audit team")
        else:
            name = str(row[2]) if mine else (str(row[3]) or "Audit team")
        found.append(
            PortalMessage(
                id=UUID(str(row[0])),
                author="YOU" if mine else "AUDIT_TEAM",
                author_name=name,
                body=str(row[4]),
                created_at=row[5],
            )
        )
    return found


def _clean_text(text: str) -> str:
    """Plain text, kept as written, without control characters."""
    kept = "".join(ch for ch in text if ch in "\n\t" or ch.isprintable())
    return kept.strip()[:MAX_TEXT]


def save_answers(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    recipient: str,
    questions: list[str],
    body: AnswersBody,
) -> int:
    """Save the owner's answers to the request's current questions. An empty answer is
    left out. Returns how many were saved."""
    by_key = {question_key(text): text for text in questions}
    saved = 0
    for item in body.answers:
        if item.key not in by_key:
            raise WorkspaceState("that question is no longer on the request")
        answer = _clean_text(item.answer)
        if answer == "":
            continue
        if contains_secret({"answer": answer}):
            raise WorkspaceState("an answer cannot hold a password or key")
        cursor.execute(
            """
            INSERT INTO request_answers (
                organization_id, project_id, pbc_request_id, question_key, question, answer,
                answered_by_email
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (pbc_request_id, question_key) DO UPDATE
            SET answer = EXCLUDED.answer, answered_by_email = EXCLUDED.answered_by_email,
                updated_at = clock_timestamp(), version = request_answers.version + 1
            WHERE request_answers.answer IS DISTINCT FROM EXCLUDED.answer
            """,
            (
                organization_id, project_id, request_id, item.key,
                clean_line(by_key[item.key], 1000), answer, recipient,
            ),
        )  # fmt: skip
        saved += 1
    return saved


def post_owner_message(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    recipient: str,
    body: MessageBody,
) -> UUID:
    text = _clean_text(body.body)
    if text == "":
        raise WorkspaceState("write a message first")
    if contains_secret({"message": text}):
        raise WorkspaceState("a message cannot hold a password or key")
    row = cursor.execute(
        """
        INSERT INTO request_messages (
            organization_id, project_id, pbc_request_id, author_kind, author_email, body
        )
        VALUES (%s, %s, %s, 'OWNER', %s, %s)
        RETURNING id
        """,
        (organization_id, project_id, request_id, recipient, text),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def submit(
    cursor: psycopg.Cursor[Any],
    request_id: UUID,
    deliverables: list[PortalDeliverable],
    body: SubmitBody,
) -> list[str]:
    """Record that the owner submitted what they have. Items still without a file need the
    owner's confirmation. Returns the titles of the items still empty."""
    missing = [item.title for item in deliverables if not item.files]
    if missing and len(missing) == len(deliverables):
        raise WorkspaceState("upload at least one file before submitting")
    if missing and not body.confirm_incomplete:
        raise WorkspaceState("some items have no files yet")
    note = _clean_text(body.note)[:2000]
    if note and contains_secret({"note": note}):
        raise WorkspaceState("a note cannot hold a password or key")
    cursor.execute(
        "UPDATE pbc_requests SET owner_submitted_at = clock_timestamp(), "
        "owner_submission_note = %s, updated_at = clock_timestamp(), version = version + 1 "
        "WHERE id = %s",
        (note, request_id),
    )
    return missing


# The audit team's side


class ClientAnswer(BaseModel):
    question: str
    answer: str
    answered_at: datetime


class ClientBody(BaseModel):
    """What the control owner gave on the request through the portal: their answers to
    the questions, the messages, and when they submitted."""

    answers: list[ClientAnswer]
    messages: list[PortalMessage]
    submitted_at: datetime | None
    submission_note: str
    # The owner's messages no one on the team has seen yet.
    unseen: int


def client_record(connection: psycopg.Connection[Any], request_id: UUID) -> ClientBody:
    answers = [
        ClientAnswer(question=str(row[0]), answer=str(row[1]), answered_at=row[2])
        for row in connection.execute(
            "SELECT question, answer, updated_at FROM request_answers "
            "WHERE pbc_request_id = %s ORDER BY created_at",
            (request_id,),
        ).fetchall()
    ]
    submitted = connection.execute(
        "SELECT owner_submitted_at, owner_submission_note FROM pbc_requests WHERE id = %s",
        (request_id,),
    ).fetchone()
    unseen = connection.execute(
        "SELECT count(*) FROM request_messages WHERE pbc_request_id = %s "
        "AND author_kind = 'OWNER' AND seen_by_team_at IS NULL",
        (request_id,),
    ).fetchone()
    return ClientBody(
        answers=answers,
        messages=messages_of(connection, request_id, owner_view=False),
        submitted_at=None if submitted is None else submitted[0],
        submission_note="" if submitted is None else str(submitted[1]),
        unseen=0 if unseen is None else int(unseen[0]),
    )


def post_team_message(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    user_id: UUID,
    body: MessageBody,
) -> UUID:
    text = _clean_text(body.body)
    if text == "":
        raise WorkspaceState("write a message first")
    if contains_secret({"message": text}):
        raise WorkspaceState("a message cannot hold a password or key")
    row = cursor.execute(
        """
        INSERT INTO request_messages (
            organization_id, project_id, pbc_request_id, author_kind, author_user_id, body
        )
        VALUES (%s, %s, %s, 'TEAM', %s, %s)
        RETURNING id
        """,
        (organization_id, project_id, request_id, user_id, text),
    ).fetchone()
    assert row is not None
    # Replying is reading: the owner's messages before it are seen.
    mark_seen(cursor, request_id)
    return UUID(str(row[0]))


def mark_seen(cursor: psycopg.Cursor[Any], request_id: UUID) -> int:
    marked = cursor.execute(
        "UPDATE request_messages SET seen_by_team_at = clock_timestamp() "
        "WHERE pbc_request_id = %s AND author_kind = 'OWNER' AND seen_by_team_at IS NULL",
        (request_id,),
    )
    return marked.rowcount
