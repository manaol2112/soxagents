"""The guided tour of the firm's demo engagement (Trial Management and Synthetic Demo
Experience, Step 5; migration 0132).

The tour walks a trial member through the Northstar engagement in eight stages, each on
a page the application already has. The server keeps where each member stands (one row
per member and firm) and resolves the records the stages point at (the primary control,
its interim request, sheet, workpaper and review, the two closed deficiencies, the
prepared reports) so the web deep-links by id and never by name. Progress belongs to the
demo engagement it was made on: when the firm's demo is rebuilt, the old progress reads
as stale and the member starts afresh. Reading or moving through the tour calls no model
and changes no engagement record.
"""

from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from pydantic import BaseModel

from ai_workforce_api import subscriptions
from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.demo import _audit, _live, eligibility, load
from ai_workforce_api.settings import Settings

# The stages, in the order the tour takes them (the web holds their words).
STAGES: tuple[str, ...] = (
    "overview",
    "planning",
    "understanding",
    "evidence",
    "testing",
    "review",
    "remediation",
    "reporting",
)
# The records the stages point at, by the dataset's own references.
PRIMARY_CONTROL = "NS-AC-02"
COMPARED_CONTROL = "NS-AC-01"
DEFICIENCIES = ("D-001", "D-003")

Status = Literal["NOT_STARTED", "IN_PROGRESS", "SKIPPED", "COMPLETED"]


class TourAnchors(BaseModel):
    control_ref: str
    control_id: UUID | None
    request_id: UUID | None
    sheet_id: UUID | None
    failed_sample: str
    workpaper_id: UUID | None
    review_id: UUID | None
    retest_round_id: UUID | None
    deficiency_ids: dict[str, UUID]
    export_ids: dict[str, UUID]


class TourBody(BaseModel):
    available: bool
    # Why not: not-trial, trial-ended, subscription-inactive, no-demo, not-a-member.
    reason: str
    project_id: UUID | None
    stage: str
    status: Status
    # The stored progress named an earlier demo engagement; it was set aside.
    stale: bool
    version: int
    stages: list[str]
    anchors: TourAnchors | None


Stage = Literal[
    "overview",
    "planning",
    "understanding",
    "evidence",
    "testing",
    "review",
    "remediation",
    "reporting",
]


class TourUpdate(BaseModel):
    stage: Stage
    status: Status


def _demo_project(connection: Any, organization_id: UUID) -> tuple[UUID | None, str]:
    """The firm's live demo engagement, or why there is none."""
    reason = eligibility(subscriptions.load(connection, organization_id))
    if reason != "":
        return None, reason
    demo = load(connection, organization_id)
    if demo is None or demo.state != "READY" or not _live(connection, demo.project_id):
        return None, "no-demo"
    return demo.project_id, ""


def _member(connection: Any, principal: Principal, organization_id: UUID, project_id: UUID) -> bool:
    try:
        authorize(
            connection,
            principal=principal,
            action=Action.TASK_READ,
            organization_id=organization_id,
            project_id=project_id,
        )
    except AccessDenied, NotVisible:
        # A firm member outside the demo engagement cannot see it (NotVisible) and is
        # not offered its tour; the answer says why rather than hiding the firm's demo.
        return False
    return True


def _one(connection: Any, sql: str, params: tuple[Any, ...]) -> UUID | None:
    row = connection.execute(sql, params).fetchone()
    return None if row is None or row[0] is None else UUID(str(row[0]))


def anchors(connection: Any, project_id: UUID) -> TourAnchors:
    """The records the stages open, looked up by the dataset's references."""
    control_id = _one(
        connection,
        "SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s",
        (project_id, PRIMARY_CONTROL),
    )
    request_id = sheet_id = workpaper_id = review_id = retest_round_id = None
    failed_sample = ""
    if control_id is not None:
        request_id = _one(
            connection,
            """
            SELECT id FROM pbc_requests
            WHERE project_id = %s AND engagement_control_id = %s AND testing_phase = 'INTERIM'
              AND status <> 'CANCELLED'
            ORDER BY created_at LIMIT 1
            """,
            (project_id, control_id),
        )
        sheet_id = _one(
            connection,
            """
            SELECT id FROM test_sheets
            WHERE project_id = %s AND engagement_control_id = %s AND test_round_id IS NULL
            ORDER BY created_at LIMIT 1
            """,
            (project_id, control_id),
        )
        if sheet_id is not None:
            row = connection.execute(
                """
                SELECT i.label FROM test_items i, jsonb_array_elements(i.results) r
                WHERE i.test_sheet_id = %s AND r->>'result' = 'EXCEPTION'
                ORDER BY i.position LIMIT 1
                """,
                (sheet_id,),
            ).fetchone()
            failed_sample = "" if row is None else str(row[0])
        workpaper_id = _one(
            connection,
            """
            SELECT id FROM workpapers
            WHERE project_id = %s AND engagement_control_id = %s AND stage = 'EFFECTIVENESS'
            """,
            (project_id, control_id),
        )
        review_id = _one(
            connection,
            """
            SELECT id FROM control_reviews
            WHERE project_id = %s AND engagement_control_id = %s
            ORDER BY (status = 'SIGNED_OFF') DESC, created_at LIMIT 1
            """,
            (project_id, control_id),
        )
        retest_round_id = _one(
            connection,
            """
            SELECT id FROM test_rounds
            WHERE project_id = %s AND engagement_control_id = %s AND kind = 'RETEST'
              AND status <> 'CANCELLED'
            ORDER BY number DESC LIMIT 1
            """,
            (project_id, control_id),
        )
    deficiency_ids = {
        str(reference): UUID(str(found))
        for reference, found in connection.execute(
            "SELECT reference, id FROM deficiencies WHERE project_id = %s AND reference = ANY(%s)",
            (project_id, list(DEFICIENCIES)),
        ).fetchall()
    }
    export_ids: dict[str, UUID] = {}
    for dataset, found in connection.execute(
        """
        SELECT dataset, id FROM engagement_exports
        WHERE project_id = %s AND purged_at IS NULL AND expires_at >= clock_timestamp()
        ORDER BY created_at
        """,
        (project_id,),
    ).fetchall():
        export_ids[str(dataset)] = UUID(str(found))
    return TourAnchors(
        control_ref=PRIMARY_CONTROL,
        control_id=control_id,
        request_id=request_id,
        sheet_id=sheet_id,
        failed_sample=failed_sample,
        workpaper_id=workpaper_id,
        review_id=review_id,
        retest_round_id=retest_round_id,
        deficiency_ids=deficiency_ids,
        export_ids=export_ids,
    )


def _progress(
    connection: Any, organization_id: UUID, user_id: UUID
) -> tuple[UUID, str, str, int] | None:
    row = connection.execute(
        """
        SELECT project_id, stage, status, version FROM demo_tour_progress
        WHERE organization_id = %s AND user_id = %s
        """,
        (organization_id, user_id),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), str(row[2]), int(row[3])


def _unavailable(reason: str) -> TourBody:
    return TourBody(
        available=False,
        reason=reason,
        project_id=None,
        stage=STAGES[0],
        status="NOT_STARTED",
        stale=False,
        version=0,
        stages=list(STAGES),
        anchors=None,
    )


def _body(connection: Any, principal: Principal, organization_id: UUID) -> TourBody:
    project_id, reason = _demo_project(connection, organization_id)
    if project_id is None:
        return _unavailable(reason)
    if not _member(connection, principal, organization_id, project_id):
        return _unavailable("not-a-member")
    stored = _progress(connection, organization_id, principal.id)
    stale = stored is not None and stored[0] != project_id
    if stored is None or stale:
        stage, status, version = STAGES[0], "NOT_STARTED", 0
    else:
        _, stage, status, version = stored
        if stage not in STAGES:
            stage = STAGES[0]
    return TourBody(
        available=True,
        reason="",
        project_id=project_id,
        stage=stage,
        status=status,  # type: ignore[arg-type]
        stale=stale,
        version=version,
        stages=list(STAGES),
        anchors=anchors(connection, project_id),
    )


def read_tour(
    connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID
) -> TourBody:
    """Where this member stands in the firm's demo tour, and the records its stages open."""
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    return _body(connection, principal, organization_id)


def update_tour(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    body: TourUpdate,
) -> TourBody:
    """Move this member's tour: start it, reach a stage, skip it, or finish it. Only a
    member who can open the firm's live demo engagement; the row names that engagement."""
    authorize(
        connection,
        principal=principal,
        action=Action.ORGANIZATION_READ,
        organization_id=organization_id,
    )
    project_id, reason = _demo_project(connection, organization_id)
    if project_id is None:
        raise AccessDenied(f"the demo is not available: {reason}")
    if not _member(connection, principal, organization_id, project_id):
        raise AccessDenied("only a member of the demo engagement can take its tour")
    with transaction(connection) as cursor:
        before = _progress(cursor, organization_id, principal.id)
        cursor.execute(
            """
            INSERT INTO demo_tour_progress (organization_id, user_id, project_id, stage, status,
                                            started_at, completed_at)
            VALUES (%s, %s, %s, %s, %s,
                    CASE WHEN %s <> 'NOT_STARTED' THEN clock_timestamp() END,
                    CASE WHEN %s = 'COMPLETED' THEN clock_timestamp() END)
            ON CONFLICT (organization_id, user_id) DO UPDATE
            SET project_id = EXCLUDED.project_id,
                stage = EXCLUDED.stage,
                status = EXCLUDED.status,
                started_at = CASE
                    WHEN demo_tour_progress.project_id <> EXCLUDED.project_id
                      THEN EXCLUDED.started_at
                    ELSE coalesce(demo_tour_progress.started_at, EXCLUDED.started_at) END,
                completed_at = EXCLUDED.completed_at,
                version = demo_tour_progress.version + 1
            """,
            (
                organization_id, principal.id, project_id, body.stage, body.status,
                body.status, body.status,
            ),
        )  # fmt: skip
        event = _event(before, project_id, body)
        if event is not None:
            _audit(
                cursor, organization_id, project_id, principal.id, event,
                {"stage": body.stage, "status": body.status},
            )  # fmt: skip
    return _body(connection, principal, organization_id)


def _event(
    before: tuple[UUID, str, str, int] | None, project_id: UUID, body: TourUpdate
) -> str | None:
    """The audit event a move deserves: starting, skipping, finishing, or starting again
    on a rebuilt demo. Moving between stages is not an event."""
    fresh = before is None or before[0] != project_id or before[2] == "NOT_STARTED"
    if body.status == "COMPLETED":
        return "demo.tour_completed"
    if body.status == "SKIPPED":
        return "demo.tour_skipped"
    if body.status == "IN_PROGRESS" and fresh:
        return "demo.tour_started"
    if (
        body.status == "IN_PROGRESS"
        and before is not None
        and before[2] in ("SKIPPED", "COMPLETED")
    ):
        return "demo.tour_resumed"
    return None


def register_demo_tour(app: FastAPI, settings: Settings) -> None:
    @app.get("/organizations/{organization_id}/demo/tour", response_model=TourBody)
    def read(organization_id: UUID, request: Request) -> TourBody:
        principal = _session_principal(request)
        return _call(settings, lambda c: read_tour(c, principal, organization_id))

    @app.put("/organizations/{organization_id}/demo/tour", response_model=TourBody)
    def update(organization_id: UUID, body: TourUpdate, request: Request) -> TourBody:
        principal = _session_principal(request)
        return _call(settings, lambda c: update_tour(c, principal, organization_id, body))
