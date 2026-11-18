"""Queueing the scoping review of an in-scope system (system_scoping.py runs it).

Kept apart so the setup routes can ask for a review when a system is added, without
importing the agent. The job follows the other background jobs: a lease on the review
row, retries, and a resume on restart (pbc_drafting.py locally, durable.py on Temporal).
"""

import logging
from typing import Any, Protocol, runtime_checkable
from uuid import UUID

import psycopg

from ai_workforce_api.db import transaction

logger = logging.getLogger(__name__)

LEASE_MINUTES = 10
MAX_ATTEMPTS = 3


@runtime_checkable
class SystemReviewScheduler(Protocol):
    def schedule_system_reviews(self, application_ids: list[UUID]) -> None: ...


def request_review(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    requester: UUID,
) -> UUID:
    """Ask the scoping agent to review a system now. A run in progress finishes first."""
    cursor.execute(
        """
        INSERT INTO system_reviews (application_id, organization_id, project_id, requested_by)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (application_id) DO UPDATE
        SET review_status = CASE WHEN system_reviews.review_status = 'WORKING'
                                 THEN 'WORKING' ELSE 'PENDING' END,
            -- Mid-run, the run in progress goes again once it finishes.
            again = system_reviews.review_status = 'WORKING',
            attempts = 0, requested_by = EXCLUDED.requested_by,
            version = system_reviews.version + 1
        """,
        (application_id, organization_id, project_id, requester),
    )
    return application_id


def track_review(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    application_id: UUID,
    requester: UUID,
) -> None:
    """Give a new system its review record, idle. The agent reviews it only when a person
    asks (the wizard's magic wand) or a SOC 1 report is uploaded (milestone 8.10)."""
    cursor.execute(
        """
        INSERT INTO system_reviews (
            application_id, organization_id, project_id, requested_by, review_status
        )
        VALUES (%s, %s, %s, %s, 'IDLE')
        ON CONFLICT (application_id) DO NOTHING
        """,
        (application_id, organization_id, project_id, requester),
    )


def track_reviews_for_project(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, requester: UUID
) -> list[UUID]:
    """Every system of an engagement has its review record. Loading controls does not run
    the agent: its assessments stay until a person asks for a new one."""
    rows = cursor.execute(
        "SELECT id FROM engagement_applications WHERE project_id = %s",
        (project_id,),
    ).fetchall()
    ids = [UUID(str(row[0])) for row in rows]
    for application_id in ids:
        track_review(cursor, organization_id, project_id, application_id, requester)
    return ids


def open_reviews(connection: psycopg.Connection[Any]) -> list[UUID]:
    rows = connection.execute(
        """
        SELECT application_id FROM system_reviews
        WHERE review_status = 'PENDING'
           OR (review_status = 'WORKING' AND lease_until < clock_timestamp())
        ORDER BY updated_at LIMIT 200
        """
    ).fetchall()
    return [UUID(str(row[0])) for row in rows]


def fail_review(connection: psycopg.Connection[Any], application_id: UUID) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE system_reviews
            SET review_status = 'IDLE', lease_until = NULL, attempts = 0,
                note = 'The scoping review did not finish. Ask again.',
                version = version + 1
            WHERE application_id = %s AND review_status <> 'IDLE'
            """,
            (application_id,),
        )


def schedule_system_reviews(scheduler: object | None, application_ids: list[UUID]) -> None:
    if not isinstance(scheduler, SystemReviewScheduler) or not application_ids:
        return
    try:
        scheduler.schedule_system_reviews(application_ids)
    except Exception:
        logger.warning("system reviews could not be scheduled; they will resume on restart")
