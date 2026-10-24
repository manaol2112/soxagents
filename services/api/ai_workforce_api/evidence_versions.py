"""Withdrawing, restoring, and replacing evidence files (Milestone 8.3b).

A file's custody record is never changed or deleted. A person who added the wrong file
withdraws it, with a reason if they give one (22 Oct 2026; who and when are always
recorded): it leaves the register, its request, its control's testing,
and the workpapers, and its record and bytes stay for the audit trail. A withdrawal can be
restored. Replacing stores the new file as a new custody record that takes the old one's
place (its control, request, application, and sample items), withdraws the old one, and
has the agent read the new one and test it again.

Nothing signed off moves: a file whose control's testing is signed off, whose workpaper is
prepared, whose screenshot review is decided, or from which an approved sample was drawn,
stays until a person reopens that work.
"""

import asyncio
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, ValidationError, field_validator

from ai_workforce_api.authorization import (
    Action,
    Principal,
    _call,
    _session_principal,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence import MAX_BYTES, StoreFactory
from ai_workforce_api.evidence_analysis import (
    EvidenceAnalysisScheduler,
    queue_analysis,
    schedule_analyses,
)
from ai_workforce_api.evidence_intake import (
    IntakeState,
    RegisterBody,
    _person,
    _register,
    _require_active,
    clean_name,
    clean_type,
)
from ai_workforce_api.evidence_receipts import apply_receipt, undo_receipt
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import StoreError, digest_of, open_store
from ai_workforce_api.testing_engine import TestScheduler, request_run, schedule_runs


class ReasonBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def plain(cls, value: str) -> str:
        cleaned = clean_line(value, 500)
        if len(cleaned) < 3:
            raise ValueError("give a reason")
        return cleaned


# Recorded when a person withdraws a file without saying why (the record needs a reason).
NO_REASON = "No reason given."


class WithdrawBody(BaseModel):
    """A withdrawal's reason is the person's to give or not."""

    reason: str = Field(default="", max_length=500, validate_default=True)

    @field_validator("reason")
    @classmethod
    def plain(cls, value: str) -> str:
        cleaned = clean_line(value, 500)
        return cleaned if len(cleaned) >= 3 else NO_REASON


class ReplacedBody(BaseModel):
    replaced: UUID
    file_id: UUID
    file_name: str
    evidence: RegisterBody


def register_evidence_versions(
    app: FastAPI,
    settings: Settings,
    store: StoreFactory = open_store,
    analyses: EvidenceAnalysisScheduler | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/evidence-files/{file_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except IntakeState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    def tests() -> TestScheduler | None:
        return analyses if isinstance(analyses, TestScheduler) else None

    @app.post(f"{base}/withdraw")
    def withdraw_file(
        organization_id: UUID,
        project_id: UUID,
        file_id: UUID,
        request: Request,
        body: WithdrawBody | None = None,
    ) -> RegisterBody:
        reason = NO_REASON if body is None else body.reason
        result, runs = run(
            request,
            lambda c, p: withdraw(c, p, organization_id, project_id, file_id, reason),
        )
        schedule_runs(tests(), runs)
        return result

    @app.post(f"{base}/restore")
    def restore_file(
        organization_id: UUID,
        project_id: UUID,
        file_id: UUID,
        body: ReasonBody,
        request: Request,
    ) -> RegisterBody:
        result, runs = run(
            request,
            lambda c, p: restore(c, p, organization_id, project_id, file_id, body.reason),
        )
        schedule_runs(tests(), runs)
        return result

    @app.post(f"{base}/replace")
    async def replace_file(
        organization_id: UUID,
        project_id: UUID,
        file_id: UUID,
        name: str,
        reason: str,
        request: Request,
    ) -> ReplacedBody:
        file_name = clean_name(name)
        try:
            why = ReasonBody(reason=reason).reason
        except ValidationError:
            raise HTTPException(status_code=422, detail="give a reason") from None
        content = await request.body()
        if not content or len(content) > MAX_BYTES:
            raise HTTPException(status_code=422, detail="file is empty or too large")
        content_type = clean_type(request.headers.get("content-type", ""))
        result, queued, runs = run(
            request,
            lambda c, p: replace(
                c,
                store(settings, c),
                p,
                organization_id,
                project_id,
                file_id,
                file_name,
                content_type,
                content,
                why,
            ),
        )
        await asyncio.to_thread(schedule_analyses, analyses, [] if queued is None else [queued])
        schedule_runs(tests(), runs)
        return result


# What blocks a change


def _file(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, file_id: UUID
) -> tuple[str, str, str, UUID | None]:
    """The file's source, name, and folder, and its analysis. Locks the custody row's file."""
    row = cursor.execute(
        """
        SELECT f.source, f.file_name, f.folder_path, a.id
        FROM evidence_files f
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE f.id = %s AND f.project_id = %s AND f.organization_id = %s
        """,
        (file_id, project_id, organization_id),
    ).fetchone()
    if row is None:
        raise IntakeState("that file is not in this engagement")
    return str(row[0]), str(row[1]), str(row[2]), row[3]


def _link(
    cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID
) -> tuple[UUID | None, UUID | None]:
    """The request and control the file is filed to, if any."""
    row = cursor.execute(
        "SELECT pbc_request_id, engagement_control_id FROM evidence_file_links "
        "WHERE evidence_file_id = %s AND project_id = %s",
        (file_id, project_id),
    ).fetchone()
    return (None, None) if row is None else (row[0], row[1])


def _blocked(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    control_id: UUID | None,
) -> str | None:
    """Why the file cannot move now, or None. Signed-off work is reopened first."""
    reading = cursor.execute(
        "SELECT 1 FROM evidence_analyses WHERE evidence_file_id = %s "
        "AND status IN ('PENDING', 'WORKING')",
        (file_id,),
    ).fetchone()
    if reading is not None:
        return "the agent is still reading this file; try again in a moment"
    decided = cursor.execute(
        "SELECT 1 FROM evidence_reviews WHERE evidence_file_id = %s AND decision IS NOT NULL",
        (file_id,),
    ).fetchone()
    if decided is not None:
        return "its screenshot review is signed off"
    drawn = cursor.execute(
        """
        SELECT c.control_ref FROM control_tests t
        JOIN engagement_controls c ON c.id = t.engagement_control_id
        WHERE t.population_file_id = %s AND t.status = 'APPROVED'
        """,
        (file_id,),
    ).fetchone()
    if drawn is not None:
        return f"the approved sample for {drawn[0]} was drawn from it"
    if control_id is None:
        return None
    signed = cursor.execute(
        """
        SELECT c.control_ref FROM test_sheets s
        JOIN engagement_controls c ON c.id = s.engagement_control_id
        WHERE s.project_id = %s AND s.engagement_control_id = %s AND s.status = 'SIGNED_OFF'
          AND (s.test_round_id IS NULL
               OR EXISTS (SELECT 1 FROM test_sheet_files f
                          WHERE f.test_sheet_id = s.id AND f.evidence_file_id = %s))
          AND NOT (s.test_round_id IS NULL AND %s)
        """,
        (project_id, control_id, file_id, _for_round(cursor, project_id, control_id, file_id)),
    ).fetchone()
    if signed is not None:
        return f"testing for {signed[0]} is signed off; reopen it first"
    prepared = cursor.execute(
        """
        SELECT c.control_ref FROM workpapers w
        JOIN engagement_controls c ON c.id = w.engagement_control_id
        WHERE w.project_id = %s AND w.engagement_control_id = %s AND w.status = 'PREPARED'
        ORDER BY w.stage LIMIT 1
        """,
        (project_id, control_id),
    ).fetchone()
    if prepared is not None:
        return f"a workpaper for {prepared[0]} is prepared; reopen it first"
    return None


def _in_force(cursor: psycopg.Cursor[Any], file_id: UUID) -> tuple[UUID, UUID | None] | None:
    row = cursor.execute(
        "SELECT id, replaced_by_file_id FROM evidence_withdrawals "
        "WHERE evidence_file_id = %s AND restored_at IS NULL FOR UPDATE",
        (file_id,),
    ).fetchone()
    return None if row is None else (row[0], row[1])


def _for_round(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, file_id: UUID
) -> bool:
    """Whether the file was sent for a roll-forward, a retest, or a remediation."""
    from ai_workforce_api.test_rounds import followup_requests

    request = cursor.execute(
        "SELECT pbc_request_id FROM evidence_file_links WHERE evidence_file_id = %s",
        (file_id,),
    ).fetchone()
    return (
        request is not None
        and request[0] is not None
        and request[0] in followup_requests(cursor, project_id, control_id)
    )


def _off_testing(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID | None, file_id: UUID
) -> list[UUID]:
    """Take the file off its control's open sheets, and have the tester look again."""
    if control_id is None:
        return []
    runs: list[UUID] = []
    for (sheet_id,) in cursor.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "AND status = 'OPEN' ORDER BY created_at FOR UPDATE",
        (project_id, control_id),
    ).fetchall():
        runs += _off_sheet(cursor, UUID(str(sheet_id)), file_id)
    return runs


def _off_sheet(cursor: psycopg.Cursor[Any], sheet_id: UUID, file_id: UUID) -> list[UUID]:
    sheet = (sheet_id,)
    for (item_id,) in cursor.execute(
        "DELETE FROM test_item_files t USING test_items i "
        "WHERE i.id = t.test_item_id AND i.test_sheet_id = %s "
        "AND t.evidence_file_id = %s RETURNING t.test_item_id",
        (sheet[0], file_id),
    ).fetchall():
        cursor.execute(
            "UPDATE test_items SET needs_test = true, version = version + 1 WHERE id = %s",
            (item_id,),
        )
    cursor.execute(
        "DELETE FROM test_sheet_files WHERE test_sheet_id = %s AND evidence_file_id = %s",
        (sheet[0], file_id),
    )
    queued = request_run(cursor, UUID(str(sheet[0])))
    return [] if queued is None else [queued]


def _test_again(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID | None
) -> list[UUID]:
    if control_id is None:
        return []
    runs: list[UUID] = []
    for (sheet_id,) in cursor.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "AND status = 'OPEN'",
        (project_id, control_id),
    ).fetchall():
        queued = request_run(cursor, UUID(str(sheet_id)))
        runs += [] if queued is None else [queued]
    return runs


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    action: str,
    file_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'evidence_file', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, file_id, Json(payload)),
    )


# Withdraw and restore


def withdraw(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    reason: str,
) -> tuple[RegisterBody, list[UUID]]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    with transaction(connection) as cursor:
        _file(cursor, organization_id, project_id, file_id)
        if _in_force(cursor, file_id) is not None:
            raise IntakeState("this file is already withdrawn")
        _request_id, control_id = _link(cursor, project_id, file_id)
        blocked = _blocked(cursor, project_id, file_id, control_id)
        if blocked is not None:
            raise IntakeState(f"the file cannot be withdrawn: {blocked}")
        cursor.execute(
            """
            INSERT INTO evidence_withdrawals (
                organization_id, project_id, evidence_file_id, reason, withdrawn_by
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, file_id, reason, principal.id),
        )
        match = cursor.execute(
            "SELECT id FROM evidence_matches WHERE evidence_file_id = %s", (file_id,)
        ).fetchone()
        if match is not None:
            undo_receipt(cursor, organization_id, project_id, match[0], principal.id)
        runs = _off_testing(cursor, project_id, control_id, file_id)
        _audit(
            cursor, organization_id, project_id, principal.id, "evidence.withdrawn", file_id,
            {"reason": reason},
        )  # fmt: skip
    return _register(connection, principal, organization_id, project_id, file_id), runs


def restore(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    reason: str,
) -> tuple[RegisterBody, list[UUID]]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    with transaction(connection) as cursor:
        _file(cursor, organization_id, project_id, file_id)
        found = _in_force(cursor, file_id)
        if found is None:
            raise IntakeState("this file is not withdrawn")
        withdrawal_id, replaced_by = found
        if replaced_by is not None:
            raise IntakeState(
                "this file was replaced; withdraw the newer version to use this one again"
            )
        cursor.execute(
            "UPDATE evidence_withdrawals SET restored_by = %s, restored_at = clock_timestamp(), "
            "restore_reason = %s WHERE id = %s",
            (principal.id, reason, withdrawal_id),
        )
        request_id, control_id = _link(cursor, project_id, file_id)
        match = cursor.execute(
            "SELECT id, filed_by FROM evidence_matches WHERE evidence_file_id = %s", (file_id,)
        ).fetchone()
        if match is not None and request_id is not None:
            apply_receipt(
                cursor, organization_id, project_id, match[0], request_id, principal.id,
                "PERSON" if match[1] == "PERSON" else "OWNER" if match[1] == "OWNER" else "AGENT",
            )  # fmt: skip
        runs = _test_again(cursor, project_id, control_id)
        _audit(
            cursor, organization_id, project_id, principal.id, "evidence.restored", file_id,
            {"reason": reason},
        )  # fmt: skip
    return _register(connection, principal, organization_id, project_id, file_id), runs


# Replace


def replace(
    connection: psycopg.Connection[Any],
    store: Any,
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    file_name: str,
    content_type: str,
    content: bytes,
    reason: str,
) -> tuple[ReplacedBody, UUID | None, list[UUID]]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    _require_active(connection, organization_id, project_id)
    digest = digest_of(content)
    with transaction(connection) as cursor:
        _source, _old_name, folder, _analysis = _file(cursor, organization_id, project_id, file_id)
        if _in_force(cursor, file_id) is not None:
            raise IntakeState("this file is withdrawn; restore it or replace its newer version")
        old_digest = cursor.execute(
            "SELECT content_sha256 FROM evidence_files WHERE id = %s", (file_id,)
        ).fetchone()
        if old_digest is not None and old_digest[0] == digest:
            raise IntakeState("this is the same file; nothing to replace")
        request_id, control_id = _link(cursor, project_id, file_id)
        blocked = _blocked(cursor, project_id, file_id, control_id)
        if blocked is not None:
            raise IntakeState(f"the file cannot be replaced: {blocked}")
    new_id = uuid4()
    key = f"evidence/{new_id}"
    # Stored before the record, as an upload is: an orphaned object is harmless.
    store.put(key, content)
    with transaction(connection) as cursor:
        if _in_force(cursor, file_id) is not None:
            raise IntakeState("this file changed; refresh and try again")
        request_id, control_id = _link(cursor, project_id, file_id)
        cursor.execute(
            """
            INSERT INTO evidence_files (
                id, organization_id, project_id, source, upload_batch_id, folder_path,
                object_key, content_sha256, size_bytes, content_type, file_name, stored_by
            )
            VALUES (%s, %s, %s, 'UPLOAD', %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (new_id, organization_id, project_id, uuid4(), folder, key, digest, len(content),
             content_type, file_name, principal.id),
        )  # fmt: skip
        old_match = cursor.execute(
            "SELECT id, receipt_request_id, receipt_status_before, receipt_status_set, "
            "requirement_id FROM evidence_matches WHERE evidence_file_id = %s FOR UPDATE",
            (file_id,),
        ).fetchone()
        if control_id is None:
            # The old file was not filed: the agent matches the new one as any upload.
            cursor.execute(
                "INSERT INTO evidence_matches (organization_id, project_id, evidence_file_id) "
                "VALUES (%s, %s, %s)",
                (organization_id, project_id, new_id),
            )
        else:
            cursor.execute(
                """
                INSERT INTO evidence_matches (
                    organization_id, project_id, evidence_file_id, status,
                    engagement_control_id, pbc_request_id, filed_by, decided_by, reason,
                    receipt_request_id, receipt_status_before, receipt_status_set,
                    requirement_id
                )
                VALUES (%s, %s, %s, 'FILED', %s, %s, 'PERSON', %s, %s, %s, %s, %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    new_id,
                    control_id,
                    request_id,
                    principal.id,
                    clean_line(f"Replaces {_old_name}.", 300),
                    None if old_match is None else old_match[1],
                    None if old_match is None else old_match[2],
                    None if old_match is None else old_match[3],
                    # The item it was added for, while it is on the same request.
                    None if old_match is None or request_id is None else old_match[4],
                ),
            )
            if old_match is not None:
                # The request's receipt moves to the new version, so the request stays put.
                cursor.execute(
                    "UPDATE evidence_matches SET receipt_request_id = NULL, "
                    "receipt_status_before = NULL, receipt_status_set = NULL, "
                    "version = version + 1 WHERE id = %s",
                    (old_match[0],),
                )
        # The application it shows, and the sample items it was on, carry over.
        cursor.execute(
            """
            INSERT INTO evidence_file_applications (
                evidence_file_id, organization_id, project_id, scope,
                engagement_application_id, engagement_application_ids, tagged_by,
                decided_by, reason
            )
            SELECT %s, organization_id, project_id, scope, engagement_application_id,
                   engagement_application_ids, tagged_by, decided_by, reason
            FROM evidence_file_applications WHERE evidence_file_id = %s
            """,
            (new_id, file_id),
        )
        cursor.execute(
            """
            INSERT INTO test_sheet_files (
                test_sheet_id, evidence_file_id, placement, placed_by, decided_by, reason
            )
            SELECT s.test_sheet_id, %s, s.placement, s.placed_by, s.decided_by, s.reason
            FROM test_sheet_files s JOIN test_sheets t ON t.id = s.test_sheet_id
            WHERE s.evidence_file_id = %s AND t.status = 'OPEN'
            """,
            (new_id, file_id),
        )
        cursor.execute(
            """
            INSERT INTO test_item_files (test_item_id, evidence_file_id)
            SELECT f.test_item_id, %s FROM test_item_files f
            JOIN test_items i ON i.id = f.test_item_id
            JOIN test_sheets t ON t.id = i.test_sheet_id
            WHERE f.evidence_file_id = %s AND t.status = 'OPEN'
            """,
            (new_id, file_id),
        )
        cursor.execute(
            """
            INSERT INTO evidence_withdrawals (
                organization_id, project_id, evidence_file_id, reason, withdrawn_by,
                replaced_by_file_id
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, file_id, reason, principal.id, new_id),
        )
        runs = _off_testing(cursor, project_id, control_id, file_id)
        _audit(
            cursor, organization_id, project_id, principal.id, "evidence.uploaded", new_id,
            {"content_sha256": digest, "size_bytes": len(content), "replaces": str(file_id)},
        )  # fmt: skip
        _audit(
            cursor, organization_id, project_id, principal.id, "evidence.replaced", file_id,
            {"reason": reason, "replaced_by": str(new_id)},
        )  # fmt: skip
        queued = queue_analysis(cursor, organization_id, project_id, new_id, principal.id)
    evidence = _register(connection, principal, organization_id, project_id, new_id)
    return (
        ReplacedBody(replaced=file_id, file_id=new_id, file_name=file_name, evidence=evidence),
        queued,
        runs,
    )
