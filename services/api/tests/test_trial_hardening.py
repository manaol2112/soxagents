"""Trial hardening (Step 6): a reservation a dead worker never settled stops counting as a
run in progress once its run could no longer be running, charged at its estimate; every
stored document counts against the trial's storage allowance (migration 0133); and the
usage the subscription route reports follows the same rules."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_outbound import migrated
from test_subscriptions import (
    _caller,
    _limit_error,
    _project,
    _refusal,
    _request,
    _Scripted,
    _sign_up,
    _upload,
)

from ai_workforce_api import subscriptions
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

SHA = "a" * 64


def _usage(connection: Any, organization_id: UUID) -> dict[str, Any]:
    """The usage the subscription route reports, read on the test's own connection so what
    the test inserted is seen without a commit."""
    return dict(subscriptions.usage(connection, organization_id).__dict__)


def test_an_abandoned_run_is_released_at_its_estimate_and_stops_blocking(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    project_id = UUID(_project(client, organization_id, user_id, "sox-fy27").json()["id"])
    settings = Settings(database_url=migrated.url)
    provider = _Scripted([{"answer": "ok"}])
    with connect(migrated.url) as connection:
        # A reservation left open longer than a run may last (the trial allows 600 s).
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO model_call_reservations (
                    organization_id, project_id, job_id, agent_key, estimate_micros, created_at
                ) VALUES (%s, %s, %s, 'itgc-access-tester', 25000,
                          clock_timestamp() - interval '40 minutes')
                RETURNING id
                """,
                (organization_id, project_id, uuid4()),
            )
            abandoned = cursor.fetchone()
        assert abandoned is not None
        # The usage page already reads it as not running (it could not be).
        before = _usage(connection, organization_id)
        assert before["ai_active_runs"] == 0 and before["ai_reserved_micros"] == 25000
        # The next call releases it at its estimate and goes ahead.
        caller = _caller(connection, provider, organization_id, project_id, user_id, settings)
        call = caller.generate(_request(), "control-tester/1")
        assert call.status == "SUCCEEDED", _refusal(connection, call.call_id)
        settled = connection.execute(
            "SELECT settled_micros, released_at IS NOT NULL FROM model_call_reservations WHERE id = %s",
            (abandoned[0],),
        ).fetchone()
        assert settled == (25000, True)
        after = _usage(connection, organization_id)
        # Charged, never given back: the estimate moved from reserved to spent.
        assert after["ai_spent_micros"] >= 25000 and after["ai_reserved_micros"] == 0
        assert after["ai_runs"] == 2
        # A young open reservation still counts as running and still blocks a second run.
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO model_call_reservations (
                    organization_id, project_id, job_id, agent_key, estimate_micros
                ) VALUES (%s, %s, %s, 'itgc-access-tester', 1000)
                """,
                (organization_id, project_id, uuid4()),
            )
        assert _usage(connection, organization_id)["ai_active_runs"] >= 1
        blocked = _caller(connection, provider, organization_id, project_id, user_id, settings)
        waiting = blocked.generate(_request(), "control-tester/1")
        assert waiting.status == "BUDGET_EXCEEDED"
        assert "one at a time" in _refusal(connection, waiting.call_id)
        # Housekeeping releases nothing young.
        assert subscriptions.release_abandoned_everywhere(connection) == 0


def test_every_stored_document_counts_against_the_storage_allowance(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    project_id = UUID(_project(client, organization_id, user_id, "sox-fy27").json()["id"])
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET limit_upload_bytes = 3000 WHERE organization_id = %s",
                (organization_id,),
            )
            cursor.execute(
                """
                INSERT INTO pbc_requests (organization_id, project_id, operation_key, control_ref,
                                          owner_user_id, recipient, due_at, evidence_description)
                VALUES (%s, %s, 'op-storage', 'ITGC-AC-01', %s, 'owner@client.example',
                        clock_timestamp() + interval '7 days', 'Evidence for the storage test')
                RETURNING id
                """,
                (organization_id, project_id, user_id),
            )
            request_id = cursor.fetchone()
        assert request_id is not None

        def attachment(size: int) -> None:
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO request_attachments (organization_id, project_id, pbc_request_id,
                        source, file_name, content_type, size_bytes, object_key, content_sha256, added_by)
                    VALUES (%s, %s, %s, 'UPLOAD', 'memo.pdf', 'application/pdf', %s, %s, %s, %s)
                    """,
                    (
                        organization_id,
                        project_id,
                        request_id[0],
                        size,
                        f"evidence/{uuid4()}",
                        SHA,
                        user_id,
                    ),
                )

        def document(size: int) -> None:
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO source_documents (organization_id, project_id, kind, title, text, origin,
                                                  object_key, content_type, size_bytes, file_name)
                    VALUES (%s, %s, 'POLICY', 'Access policy', 'Access is granted on approval.', 'UPLOAD',
                            %s, 'application/pdf', %s, 'policy.pdf')
                    """,
                    (organization_id, project_id, f"documents/{uuid4()}", size),
                )

        def template(size: int) -> None:
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO workpaper_templates (organization_id, project_id, key, kind, title,
                                                     uploaded_by, file_kind, file_name, content)
                    VALUES (%s, %s, %s, 'ITGC', 'Firm template', %s, 'DOCX', 'template.docx', %s)
                    """,
                    (
                        organization_id,
                        project_id,
                        f"firm-a{uuid4().hex[:11]}",
                        user_id,
                        b"x" * size,
                    ),
                )

        attachment(1000)
        document(1000)
        template(500)
        connection.commit()
        usage = _usage(connection, organization_id)
        # Storage counts all three; the upload count stays evidence files.
        assert usage["upload_bytes"] == 2500 and usage["uploads"] == 0
        for over in (attachment, document, template):
            # Each refusal rolls back its own savepoint; what was stored stays.
            with pytest.raises(psycopg.Error) as refused:
                over(600)
            assert _limit_error(refused.value) == "storage"
        # Under the allowance, each still goes in.
        template(400)
        assert _usage(connection, organization_id)["upload_bytes"] == 2900
        # A link to an evidence file already counted stores nothing new.
        _upload(connection, organization_id, project_id, user_id, 50)
        evidence = connection.execute(
            "SELECT id FROM evidence_files WHERE project_id = %s ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        assert evidence is not None
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO request_attachments (organization_id, project_id, pbc_request_id,
                    source, file_name, content_type, size_bytes, object_key, content_sha256, added_by,
                    evidence_file_id)
                VALUES (%s, %s, %s, 'ENGAGEMENT_FILE', 'ev.pdf', 'application/pdf', 5000, %s, %s, %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    request_id[0],
                    f"evidence/{uuid4()}",
                    SHA,
                    user_id,
                    evidence[0],
                ),
            )
        assert _usage(connection, organization_id)["upload_bytes"] == 2950


def test_demo_documents_stay_outside_the_storage_allowance(migrated: Database) -> None:
    from test_demo import PLACEHOLDER, _initialize

    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    demo_project = UUID(_initialize(client, organization_id).json()["project_id"])
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET limit_upload_bytes = 100 WHERE organization_id = %s",
                (organization_id,),
            )
            cursor.execute(
                """
                INSERT INTO workpaper_templates (organization_id, project_id, key, kind, title,
                                                 uploaded_by, file_kind, file_name, content)
                VALUES (%s, %s, %s, 'ITGC', 'Demo template', %s, 'DOCX', 'template.docx', %s)
                """,
                (organization_id, demo_project, f"firm-b{uuid4().hex[:11]}", user_id, b"y" * 5000),
            )
    with connect(migrated.url) as connection:
        assert _usage(connection, organization_id)["upload_bytes"] == 0


def test_the_quiet_window_is_the_deployments_and_a_quiet_run_keeps_its_slot_within_it(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated)
    project_id = UUID(_project(client, organization_id, user_id, "sox-fy27").json()["id"])
    with connect(migrated.url) as connection:
        # A run whose last call settled 40 seconds ago: still in progress within a
        # 90-second window, finished within a 10-second one.
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO model_call_reservations (
                    organization_id, project_id, job_id, agent_key, estimate_micros,
                    settled_micros, released_at, created_at
                ) VALUES (%s, %s, %s, 'itgc-access-tester', 1000, 800,
                          clock_timestamp() - interval '40 seconds',
                          clock_timestamp() - interval '50 seconds')
                """,
                (organization_id, project_id, uuid4()),
            )
        assert subscriptions.usage(connection, organization_id, 90).ai_active_runs == 1
        assert subscriptions.usage(connection, organization_id, 10).ai_active_runs == 0
        # The reservation decides the same way: a second run waits inside the window.
        provider = _Scripted([{"answer": "ok"}])
        settings = Settings(database_url=migrated.url, trial_ai_quiet_seconds=90)
        waiting = _caller(connection, provider, organization_id, project_id, user_id, settings)
        held = waiting.generate(_request(), "control-tester/1")
        assert held.status == "BUDGET_EXCEEDED"
        assert "one at a time" in _refusal(connection, held.call_id)
        quick = Settings(database_url=migrated.url, trial_ai_quiet_seconds=10)
        free = _caller(connection, provider, organization_id, project_id, user_id, quick)
        call = free.generate(_request(), "control-tester/1")
        assert call.status == "SUCCEEDED", _refusal(connection, call.call_id)
