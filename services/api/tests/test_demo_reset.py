"""Resetting the demo (Step 6; demo.py reset_demo): a fresh demo engagement replaces the
firm's, at most three times during the trial, by a member who may create engagements;
the archived demo keeps every record; a failed build leaves the firm with the demo it had
and costs no reset; requests arriving together make one reset; and the trial's dates,
allowances and real engagements are untouched."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_demo import PLACEHOLDER, _audit_actions, _demo, _demo_projects, _initialize, _record
from test_northstar import _rows, _start
from test_outbound import _session, migrated
from test_subscriptions import _end_trial, _member, _project, _sign_up

from ai_workforce_api import demo_datasets
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.demo_datasets import DemoContext, PlaceholderDataset

__all__ = ["migrated"]


def _reset(client: TestClient, organization_id: UUID, expected: int = 0) -> Any:
    return client.post(
        f"/organizations/{organization_id}/demo/reset", json={"expected_resets": expected}
    )


def _live_demo(url: str, organization_id: UUID) -> list[UUID]:
    return [
        UUID(str(row[0]))
        for row in _rows(
            url,
            "SELECT id FROM projects WHERE organization_id = %s AND demo AND deleted_at IS NULL AND status <> 'ARCHIVED'",
            organization_id,
        )
    ]


def _trial(url: str, organization_id: UUID) -> tuple[Any, ...]:
    return _rows(
        url,
        "SELECT trial_started_at, trial_expires_at, ai_budget_micros, ai_run_limit, limit_uploads, limit_engagements FROM organization_subscriptions WHERE organization_id = %s",
        organization_id,
    )[0]


def _usage(client: TestClient, organization_id: UUID) -> dict[str, Any]:
    body = client.get(f"/organizations/{organization_id}/subscription")
    assert body.status_code == 200, body.text
    usage: dict[str, Any] = body.json()["usage"]
    return usage


class _FailsAlways:
    """A dataset whose build always fails after writing, so nothing of it may stay."""

    key = "failing-reset/0"
    title = "Failing dataset"
    complete = False

    def build(self, cursor: psycopg.Cursor[Any], context: DemoContext) -> UUID:
        PlaceholderDataset().build(cursor, context)
        cursor.execute("SELECT 1 / 0")
        raise AssertionError("unreachable")


# 1. A reset replaces the demo and keeps the old one


def test_a_reset_replaces_the_demo_and_archives_the_old_one_with_its_records(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    first = UUID(_initialize(client, organization_id).json()["project_id"])
    before = _demo(client, organization_id)
    assert (before["resets"], before["resets_left"], before["can_reset"]) == (0, 3, True)
    # A real engagement beside the demo, and tour progress on the demo.
    own = _project(client, organization_id, user_id, "fy27-own").json()["id"]
    started = client.put(
        f"/organizations/{organization_id}/demo/tour",
        json={"stage": "testing", "status": "IN_PROGRESS"},
    )
    assert started.status_code == 200, started.text
    trial_before = _trial(migrated.url, organization_id)
    usage_before = _usage(client, organization_id)
    controls_before = _rows(
        migrated.url, "SELECT count(*) FROM engagement_controls WHERE project_id = %s", first
    )
    reset = _reset(client, organization_id, 0)
    assert reset.status_code == 200, reset.text
    body = reset.json()
    second = UUID(body["project_id"])
    assert second != first
    assert (body["state"], body["resets"], body["resets_left"], body["can_reset"]) == (
        "READY",
        1,
        2,
        True,
    )
    # One active demo; the old one archived with every record it had.
    assert _live_demo(migrated.url, organization_id) == [second]
    assert _rows(migrated.url, "SELECT status, demo FROM projects WHERE id = %s", first) == [
        ("ARCHIVED", True)
    ]
    assert (
        _rows(migrated.url, "SELECT count(*) FROM engagement_controls WHERE project_id = %s", first)
        == controls_before
    )
    record = _record(migrated.url, organization_id)
    assert record is not None and record["resets"] == 1 and record["project_id"] == second
    assert _audit_actions(migrated.url, organization_id)[-1] == "demo.reset"
    # The tour starts afresh on the new demo; the old progress reads as stale.
    tour = client.get(f"/organizations/{organization_id}/demo/tour").json()
    assert (tour["project_id"], tour["stage"], tour["status"], tour["stale"]) == (
        str(second),
        "overview",
        "NOT_STARTED",
        True,
    )
    # The trial, its allowances, its usage and the firm's own engagement are untouched.
    assert _trial(migrated.url, organization_id) == trial_before
    assert _usage(client, organization_id) == usage_before
    assert _rows(migrated.url, "SELECT status FROM projects WHERE id = %s", UUID(own)) == [
        ("DRAFT",)
    ] or _rows(migrated.url, "SELECT deleted_at FROM projects WHERE id = %s", UUID(own)) == [
        (None,)
    ]
    assert len(_demo_projects(migrated.url, organization_id)) == 2


# 2. The allowance, and a retry after a reset went through


def test_three_resets_at_most_and_a_stale_retry_resets_nothing(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    _initialize(client, organization_id)
    for expected in (0, 1, 2):
        done = _reset(client, organization_id, expected)
        assert done.status_code == 200, done.text
        assert done.json()["resets"] == expected + 1
    exhausted = _reset(client, organization_id, 3)
    assert exhausted.status_code == 409, exhausted.text
    assert exhausted.json()["code"] == "DEMO_RESET_REFUSED"
    assert exhausted.json()["reason"] == "resets-exhausted"
    assert exhausted.json()["resets_left"] == 0
    body = _demo(client, organization_id)
    assert (body["resets"], body["resets_left"], body["can_reset"]) == (3, 0, False)
    # A retry carrying an earlier count resets nothing more.
    stale = _reset(client, organization_id, 1)
    assert stale.status_code == 409 and stale.json()["reason"] in (
        "already-reset",
        "resets-exhausted",
    )
    assert len(_live_demo(migrated.url, organization_id)) == 1
    assert _record(migrated.url, organization_id)["resets"] == 3  # type: ignore[index]
    assert _audit_actions(migrated.url, organization_id).count("demo.reset") == 3


def test_a_retry_after_a_reset_went_through_is_refused_not_repeated(migrated: Database) -> None:
    client, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    _initialize(client, organization_id)
    assert _reset(client, organization_id, 0).status_code == 200
    again = _reset(client, organization_id, 0)
    assert again.status_code == 409 and again.json()["reason"] == "already-reset"
    assert again.json()["resets"] == 1
    assert _record(migrated.url, organization_id)["resets"] == 1  # type: ignore[index]


# 3-6. Who may reset, and from where


def test_only_a_member_who_creates_engagements_resets_and_only_on_a_running_trial(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    _initialize(client, organization_id)
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE organization_subscriptions SET limit_members = 2 WHERE organization_id = %s",
                (organization_id,),
            )
        _member(connection, organization_id, "riley-reset@firm.example")
        reviewer = connection.execute(
            "SELECT id FROM users WHERE email = 'riley-reset@firm.example'"
        ).fetchone()
    assert reviewer is not None
    theirs = _session(migrated, reviewer[0], **PLACEHOLDER)
    assert _demo(theirs, organization_id)["can_reset"] is False
    assert _reset(theirs, organization_id, 0).status_code == 403
    # Another firm sees nothing of it.
    other, _other_firm, _ = _sign_up(migrated, "lee-reset@other.example", **PLACEHOLDER)
    assert _reset(other, organization_id, 0).status_code == 404
    # A paid firm is not offered the trial's reset.
    paid, paid_firm, _ = _sign_up(migrated, "paid-reset@firm.example", **PLACEHOLDER)
    _initialize(paid, paid_firm)
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE organization_subscriptions SET status = 'ACTIVE', plan_type = 'PAID', "
            "status_reason = 'test: paid', version = version + 1 WHERE organization_id = %s",
            (paid_firm,),
        )
    refused = _reset(paid, paid_firm, 0)
    assert refused.status_code == 403 and refused.json()["reason"] == "not-trial"
    # An ended trial cannot reset; its demo stays readable.
    _end_trial(migrated.url, organization_id, user_id)
    ended = _reset(client, organization_id, 0)
    assert ended.status_code == 402, ended.text
    assert len(_live_demo(migrated.url, organization_id)) == 1
    assert _audit_actions(migrated.url, organization_id).count("demo.reset") == 0


# 7. Requests arriving together


def test_requests_arriving_together_make_one_reset(migrated: Database) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    _initialize(client, organization_id)
    clients = [_session(migrated, user_id, **PLACEHOLDER) for _ in range(3)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        answers = list(pool.map(lambda c: _reset(c, organization_id, 0), clients))
    codes = sorted(answer.status_code for answer in answers)
    assert codes == [200, 409, 409], [answer.text for answer in answers]
    assert len(_live_demo(migrated.url, organization_id)) == 1
    assert _record(migrated.url, organization_id)["resets"] == 1  # type: ignore[index]
    assert _audit_actions(migrated.url, organization_id).count("demo.reset") == 1


# 8. A failed replacement leaves the firm with the demo it had


def test_a_failed_replacement_keeps_the_current_demo_and_costs_no_reset(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, organization_id, _ = _sign_up(migrated, **PLACEHOLDER)
    first = UUID(_initialize(client, organization_id).json()["project_id"])
    monkeypatch.setitem(demo_datasets.DATASETS, _FailsAlways.key, _FailsAlways())
    failing = _session(
        migrated, _owner(migrated.url, organization_id), demo_dataset=_FailsAlways.key
    )
    failed = _reset(failing, organization_id, 0)
    assert failed.status_code == 503, failed.text
    assert failed.json()["code"] == "DEMO_RESET_FAILED"
    # The archive rolled back with the build: the demo is live, the record unchanged.
    assert _live_demo(migrated.url, organization_id) == [first]
    record = _record(migrated.url, organization_id)
    assert record is not None and record["resets"] == 0 and record["project_id"] == first
    assert record["state"] == "READY"
    assert _audit_actions(migrated.url, organization_id)[-1] == "demo.reset_failed"
    assert _demo(client, organization_id)["can_reset"] is True
    # The next attempt, with a dataset that builds, goes through.
    assert _reset(client, organization_id, 0).status_code == 200
    assert _record(migrated.url, organization_id)["resets"] == 1  # type: ignore[index]


def _owner(url: str, organization_id: UUID) -> UUID:
    return UUID(
        str(
            _rows(
                url,
                "SELECT user_id FROM memberships WHERE organization_id = %s AND role = 'OWNER' LIMIT 1",
                organization_id,
            )[0][0]
        )
    )


# 9. The trial's AI ledger, in flight or settled, is untouched


def test_a_reset_leaves_the_ai_ledger_and_in_flight_reservations_alone(
    migrated: Database,
) -> None:
    client, organization_id, user_id = _sign_up(migrated, **PLACEHOLDER)
    demo_project = UUID(_initialize(client, organization_id).json()["project_id"])
    own = UUID(_project(client, organization_id, user_id, "fy27-ledger").json()["id"])
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO model_call_reservations (
                organization_id, project_id, job_id, agent_key, estimate_micros, settled_micros,
                released_at
            ) VALUES (%s, %s, %s, 'itgc-access-tester', 20000, 12000, clock_timestamp())
            """,
            (organization_id, own, uuid4()),
        )
        cursor.execute(
            """
            INSERT INTO model_call_reservations (
                organization_id, project_id, job_id, agent_key, estimate_micros
            ) VALUES (%s, %s, %s, 'itgc-access-tester', 30000)
            """,
            (organization_id, demo_project, uuid4()),
        )
    before = _usage(client, organization_id)
    assert before["ai_spent_micros"] == 12000 and before["ai_reserved_micros"] == 30000
    assert _reset(client, organization_id, 0).status_code == 200
    after = _usage(client, organization_id)
    assert after == before
    assert _rows(
        migrated.url,
        "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
        organization_id,
    ) == [(2,)]


# 10. The Northstar demo: the replacement is ready, reviewed and tourable


def test_the_northstar_demo_resets_to_a_ready_engagement_with_its_people_in_role(
    migrated: Database,
) -> None:
    client, organization_id, user_id, first = _start(migrated, email="reset-ns@firm.example")
    signed_before = _rows(
        migrated.url,
        "SELECT count(*) FROM test_sheets WHERE project_id = %s AND status = 'SIGNED_OFF'",
        first,
    )
    tour_before = client.get(f"/organizations/{organization_id}/demo/tour").json()
    assert tour_before["anchors"]["control_id"] is not None
    reset = _reset(client, organization_id, 0)
    assert reset.status_code == 200, reset.text
    second = UUID(reset.json()["project_id"])
    assert second != first and reset.json()["dataset_complete"] is True
    # The replacement passed its readiness checks: the same lifecycle, reviewed.
    assert _rows(
        migrated.url,
        "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
        second,
    ) == _rows(
        migrated.url,
        "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
        first,
    )
    assert (
        _rows(
            migrated.url,
            "SELECT count(*) FROM test_sheets WHERE project_id = %s AND status = 'SIGNED_OFF'",
            first,
        )
        == signed_before
    )
    # The tour's records now point at the new engagement.
    tour = client.get(f"/organizations/{organization_id}/demo/tour").json()
    assert tour["project_id"] == str(second)
    assert tour["anchors"]["control_id"] != tour_before["anchors"]["control_id"]
    assert set(tour["anchors"]["deficiency_ids"]) == {"D-001", "D-003"}
    # The demo's people hold their roles on the new engagement: Riley reviews, Morgan tests.
    roles = dict(
        _rows(
            migrated.url,
            "SELECT u.display_name, m.engagement_role FROM project_memberships m JOIN users u ON u.id = m.user_id WHERE m.project_id = %s AND u.demo_organization_id = %s",
            second,
            organization_id,
        )
    )
    assert roles["Riley Okafor"] == "REVIEWER" and roles["Morgan Lee"] == "PREPARER"
    assert _rows(
        migrated.url,
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'demo.reset'",
        second,
    ) == [(1,)]
    _ = user_id
