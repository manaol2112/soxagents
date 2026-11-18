"""The guided tour of the demo engagement (Step 5; migration 0132, demo_tour.py): who
may take it, where it starts, how it moves, how it resumes, what it points at, that it
belongs to the demo alone, and that walking it calls no model and changes no record. The
prepared reports are listed for download, and a prepared evidence reading is kept."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_northstar import _rows
from test_northstar_lifecycle import demo
from test_outbound import _session, migrated
from test_subscriptions import _member, _sign_up

from ai_workforce_api.db import connect
from ai_workforce_api.demo_tour import STAGES

__all__ = ["demo", "migrated"]


def _tour(demo: dict[str, Any]) -> dict[str, Any]:
    answer = demo["client"].get(f"/organizations/{demo['organization_id']}/demo/tour")
    assert answer.status_code == 200, answer.text
    tour: dict[str, Any] = answer.json()
    return tour


def _move(demo: dict[str, Any], stage: str, status: str) -> Any:
    return demo["client"].put(
        f"/organizations/{demo['organization_id']}/demo/tour",
        json={"stage": stage, "status": status},
    )


def _events(url: str, organization_id: UUID) -> list[str]:
    return [
        str(row[0])
        for row in _rows(
            url,
            "SELECT action FROM audit_events WHERE organization_id = %s AND action LIKE 'demo.tour%%' ORDER BY occurred_at, id",
            organization_id,
        )
    ]


def _counts(url: str, project_id: UUID) -> tuple[Any, ...]:
    """The records a tour must never touch: model calls, signed sheets and reviews,
    prepared workpapers, deficiencies by status."""
    return tuple(
        _rows(url, sql, project_id)[0][0]
        for sql in (
            "SELECT count(*) FROM model_calls WHERE project_id = %s",
            "SELECT count(*) FROM test_sheets WHERE project_id = %s AND status = 'SIGNED_OFF'",
            "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
            "SELECT count(*) FROM workpapers WHERE project_id = %s AND status = 'PREPARED'",
            "SELECT string_agg(reference || ':' || status, ',' ORDER BY reference) FROM deficiencies WHERE project_id = %s",
        )
    )


# 1-2. Eligibility and the first visit


def test_a_trial_member_of_the_demo_is_offered_the_tour_with_its_anchors(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    tour = _tour(demo)
    assert tour["available"] is True and tour["reason"] == ""
    assert tour["project_id"] == str(project_id)
    assert tour["stages"] == list(STAGES) and len(STAGES) == 8
    anchors = tour["anchors"]
    assert anchors["control_ref"] == "NS-AC-02"
    assert anchors["control_id"] == str(demo["controls"]["NS-AC-02"])
    # Every stage's record is resolved by id, from the engagement's own records.
    for key in ("request_id", "sheet_id", "workpaper_id", "review_id", "retest_round_id"):
        assert anchors[key] is not None, key
    assert anchors["failed_sample"] != ""
    assert set(anchors["deficiency_ids"]) == {"D-001", "D-003"}
    assert set(anchors["export_ids"]) == {
        "status_report",
        "executive_summary",
        "exceptions_report",
        "control_summary",
    }
    reference = _rows(
        url,
        "SELECT reference FROM deficiencies WHERE id = %s",
        UUID(anchors["deficiency_ids"]["D-001"]),
    )
    assert reference == [("D-001",)]
    assert _rows(
        url, "SELECT kind FROM test_rounds WHERE id = %s", UUID(anchors["retest_round_id"])
    ) == [("RETEST",)]


def test_the_tour_starts_unstarted_and_does_not_restart_once_answered(
    demo: dict[str, Any],
) -> None:
    url, organization_id, user_id = demo["url"], demo["organization_id"], demo["user_id"]
    with connect(url) as connection:
        connection.execute(
            "DELETE FROM demo_tour_progress WHERE organization_id = %s AND user_id = %s",
            (organization_id, user_id),
        )
        connection.commit()
    first = _tour(demo)
    assert (first["stage"], first["status"], first["stale"], first["version"]) == (
        "overview",
        "NOT_STARTED",
        False,
        0,
    )
    # Reading leaves nothing behind: an unanswered welcome is asked again, nothing else.
    assert _rows(url, "SELECT count(*) FROM demo_tour_progress WHERE user_id = %s", user_id) == [
        (0,)
    ]
    # 3. Starting it is recorded once; the next visit resumes where it stood.
    started = _move(demo, "overview", "IN_PROGRESS")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "IN_PROGRESS" and started.json()["version"] == 1
    again = _tour(demo)
    assert (again["stage"], again["status"]) == ("overview", "IN_PROGRESS")
    assert _events(url, organization_id)[-1] == "demo.tour_started"


# 4-6. Moving, skipping and resuming


def test_stage_navigation_skipping_and_resuming(demo: dict[str, Any]) -> None:
    url, organization_id = demo["url"], demo["organization_id"]
    _move(demo, "overview", "IN_PROGRESS")
    for stage in ("planning", "understanding", "evidence", "testing"):
        moved = _move(demo, stage, "IN_PROGRESS")
        assert moved.status_code == 200 and moved.json()["stage"] == stage
    # Moving between stages is progress, not an event.
    events_before = _events(url, organization_id)
    assert events_before.count("demo.tour_started") >= 1
    skipped = _move(demo, "testing", "SKIPPED")
    assert skipped.status_code == 200 and skipped.json()["status"] == "SKIPPED"
    assert _events(url, organization_id)[-1] == "demo.tour_skipped"
    # 5. A skipped tour keeps its stage, so "Resume" picks up there.
    assert _tour(demo)["stage"] == "testing"
    resumed = _move(demo, "testing", "IN_PROGRESS")
    assert resumed.status_code == 200 and resumed.json()["status"] == "IN_PROGRESS"
    assert _events(url, organization_id)[-1] == "demo.tour_resumed"
    finished = _move(demo, "reporting", "COMPLETED")
    assert finished.status_code == 200 and finished.json()["status"] == "COMPLETED"
    assert _events(url, organization_id)[-1] == "demo.tour_completed"
    assert _rows(
        url,
        "SELECT completed_at IS NOT NULL, started_at IS NOT NULL FROM demo_tour_progress WHERE organization_id = %s AND user_id = %s",
        organization_id,
        demo["user_id"],
    ) == [(True, True)]


# 7. A stage that does not exist, and progress from an earlier demo


def test_an_unknown_stage_or_status_is_refused_and_stale_progress_is_set_aside(
    demo: dict[str, Any], migrated: Database
) -> None:
    url, organization_id, user_id = demo["url"], demo["organization_id"], demo["user_id"]
    assert _move(demo, "finale", "IN_PROGRESS").status_code == 422
    assert _move(demo, "overview", "PAUSED").status_code == 422
    assert _move(demo, "overview", "IN_PROGRESS").status_code == 200
    with connect(url) as connection:
        # Tour progress belongs to a demo engagement only.
        real = connection.execute(
            "SELECT id FROM projects WHERE organization_id = %s AND NOT demo LIMIT 1",
            (organization_id,),
        ).fetchone()
        if real is not None:
            with pytest.raises(psycopg.errors.CheckViolation):
                connection.execute(
                    "UPDATE demo_tour_progress SET project_id = %s WHERE organization_id = %s AND user_id = %s",
                    (real[0], organization_id, user_id),
                )
            connection.rollback()
        connection.commit()
    # Progress from an earlier demo: the way it arises in life, a demo reset. The replaced
    # demo is archived (its records read-only from that moment, migration 0136) and the
    # progress made on it is stale against the new one. On a firm of its own, so this
    # module's demo stays as the other tests expect it.
    from test_demo import PLACEHOLDER, _initialize

    client, firm_id, member_id = _sign_up(migrated, "tour-stale@firm.example", **PLACEHOLDER)
    first = UUID(_initialize(client, firm_id).json()["project_id"])
    begun = client.put(
        f"/organizations/{firm_id}/demo/tour", json={"stage": "review", "status": "IN_PROGRESS"}
    )
    assert begun.status_code == 200, begun.text
    reset = client.post(f"/organizations/{firm_id}/demo/reset", json={"expected_resets": 0})
    assert reset.status_code == 200, reset.text
    replacement = UUID(reset.json()["project_id"])
    assert replacement != first
    assert _rows(url, "SELECT status FROM projects WHERE id = %s", first) == [("ARCHIVED",)]
    stale = client.get(f"/organizations/{firm_id}/demo/tour").json()
    assert stale["stale"] is True
    assert (stale["stage"], stale["status"], stale["project_id"]) == (
        "overview",
        "NOT_STARTED",
        str(replacement),
    )
    # Starting again binds the progress to the live demo engagement.
    fresh = client.put(
        f"/organizations/{firm_id}/demo/tour", json={"stage": "overview", "status": "IN_PROGRESS"}
    )
    assert fresh.status_code == 200 and fresh.json()["stale"] is False
    assert _rows(
        url,
        "SELECT project_id FROM demo_tour_progress WHERE organization_id = %s AND user_id = %s",
        firm_id,
        member_id,
    ) == [(replacement,)]
    assert _events(url, firm_id)[-1] == "demo.tour_started"


# 8. Isolation: the demo's members only, and never another firm


def test_only_a_member_of_the_demo_engagement_takes_its_tour(
    demo: dict[str, Any], migrated: Database
) -> None:
    url, organization_id = demo["url"], demo["organization_id"]
    with connect(url) as connection:
        # The trial allows one member; the test needs a second who is not in the demo.
        connection.execute(
            "UPDATE organization_subscriptions SET limit_members = 5 WHERE organization_id = %s",
            (organization_id,),
        )
        connection.commit()
        email = f"outsider-{organization_id.hex[:6]}@firm.example"
        _member(connection, organization_id, email)
        found = connection.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        connection.commit()
    assert found is not None
    outsider = UUID(str(found[0]))
    theirs = _session(migrated, outsider)
    read = theirs.get(f"/organizations/{organization_id}/demo/tour")
    assert read.status_code == 200, read.text
    assert read.json()["available"] is False and read.json()["reason"] == "not-a-member"
    assert read.json()["anchors"] is None and read.json()["project_id"] is None
    refused = theirs.put(
        f"/organizations/{organization_id}/demo/tour",
        json={"stage": "overview", "status": "IN_PROGRESS"},
    )
    assert refused.status_code == 403
    # Another firm sees nothing of this firm's demo, tour or reports.
    other, _other_firm, _ = _sign_up(migrated, f"lee-{organization_id.hex[:6]}@other.example")
    assert other.get(f"/organizations/{organization_id}/demo/tour").status_code == 404
    assert (
        other.put(
            f"/organizations/{organization_id}/demo/tour",
            json={"stage": "overview", "status": "IN_PROGRESS"},
        ).status_code
        == 404
    )
    assert (
        other.get(
            f"/organizations/{organization_id}/projects/{demo['project_id']}/exports"
        ).status_code
        == 404
    )
    assert _rows(url, "SELECT count(*) FROM demo_tour_progress WHERE user_id = %s", outsider) == [
        (0,)
    ]


# 13. The prepared reports are listed for download


def test_the_prepared_reports_are_listed_and_downloadable(demo: dict[str, Any]) -> None:
    organization_id, project_id = demo["organization_id"], demo["project_id"]
    listed = demo["client"].get(f"/organizations/{organization_id}/projects/{project_id}/exports")
    assert listed.status_code == 200, listed.text
    reports = listed.json()
    assert {r["dataset"] for r in reports} == {
        "status_report",
        "executive_summary",
        "exceptions_report",
        "control_summary",
    }
    for report in reports:
        assert report["available"] is True and report["narrative"] is True
        assert report["title"] and report["file_name"] and report["created_by"]
        assert report["file_format"] in ("pdf", "docx")
        assert "object_key" not in report and "content_sha256" not in report
        fetched = demo["client"].get(
            f"/organizations/{organization_id}/projects/{project_id}/exports/{report['id']}"
        )
        assert fetched.status_code == 200 and len(fetched.content) > 1000


# 15-16. Walking the tour calls no model and changes no record; a prepared reading stays


def test_the_tour_calls_no_model_and_changes_no_record(demo: dict[str, Any]) -> None:
    url, project_id = demo["url"], demo["project_id"]
    before = _counts(url, project_id)
    _tour(demo)
    for stage in STAGES:
        assert _move(demo, stage, "IN_PROGRESS").status_code == 200
    _move(demo, "reporting", "COMPLETED")
    _tour(demo)
    assert _counts(url, project_id) == before


def test_a_reading_prepared_with_the_demo_is_kept_not_reanalysed(demo: dict[str, Any]) -> None:
    url, organization_id, project_id = demo["url"], demo["organization_id"], demo["project_id"]
    base = f"/organizations/{organization_id}/projects/{project_id}"
    # The demo's readings come from the rules, with no model call; none is marked SEEDED,
    # so one is marked here to prove the guard, and restored after.
    assert _rows(
        url,
        "SELECT array_agg(DISTINCT source) FROM evidence_analyses WHERE project_id = %s",
        project_id,
    ) == [(["RULES"],)]
    chosen = _rows(
        url,
        "SELECT id, version, status FROM evidence_analyses WHERE project_id = %s ORDER BY created_at LIMIT 1",
        project_id,
    )[0]
    with connect(url) as connection:
        connection.execute(
            "UPDATE evidence_analyses SET source = 'SEEDED' WHERE id = %s", (chosen[0],)
        )
        connection.commit()
    try:
        refused = demo["client"].post(
            f"{base}/evidence-analyses/{chosen[0]}/reanalyze", json={"version": chosen[1]}
        )
        assert refused.status_code == 409, refused.text
        assert "prepared with the demo" in refused.json()["detail"]
        assert _rows(
            url,
            "SELECT source, version, status FROM evidence_analyses WHERE id = %s",
            chosen[0],
        ) == [("SEEDED", chosen[1], chosen[2])]
    finally:
        with connect(url) as connection:
            connection.execute(
                "UPDATE evidence_analyses SET source = 'RULES' WHERE id = %s", (chosen[0],)
            )
            connection.commit()
