"""A check whose queueing failed is recorded and tried again (migration 0177; the product
owner, 18 November 2026: "Keep the reading, record it").

When bringing a file's checks in step fails after its reading, the reading is kept, the
failure is recorded for each control (evidence_assessment_retries: the error's class and
how many tries failed) and audited, and the worker's next pass (after a reading or a check,
and at start-up) tries again; after RETRY_LIMIT failed tries it stops, and the control's
out-of-date requests say so.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_evidence_analysis import _settings
from test_lock_order import _Setup
from test_outbound import migrated

from ai_workforce_api import evidence_assurance
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_assurance import (
    RETRY_BACKOFF_SECONDS,
    RETRY_HELD,
    RETRY_LIMIT,
    open_assessments,
    retry_failed,
)
from ai_workforce_api.pbc_drafting import LocalDraftScheduler

_ = migrated


def _fail_once(monkeypatch: pytest.MonkeyPatch, error: Exception) -> list[int]:
    """The next queueing of a file's checks fails with `error`; later ones run."""
    real = evidence_assurance.queue_for_file
    calls: list[int] = []

    def queue(*args: Any, **kwargs: Any) -> Any:
        calls.append(1)
        if len(calls) == 1:
            raise error
        return real(*args, **kwargs)

    monkeypatch.setattr(evidence_assurance, "queue_for_file", queue)
    return calls


def _retries(case: _Setup) -> list[tuple[Any, ...]]:
    return case.bench.rows(
        "SELECT engagement_control_id, error, attempts FROM evidence_assessment_retries "
        "WHERE project_id = %s ORDER BY engagement_control_id",
        case.project,
    )


def _age(case: _Setup, seconds: int = 86400) -> None:
    """The recorded failures happened `seconds` ago (past the backoff, by default)."""
    with connect(case.url) as connection:
        connection.execute(
            "UPDATE evidence_assessment_retries "
            "SET failed_at = clock_timestamp() - make_interval(secs => %s) WHERE project_id = %s",
            (seconds, case.project),
        )


def _events(case: _Setup, action: str) -> list[dict[str, Any]]:
    return [
        row[0]
        for row in case.bench.rows(
            "SELECT payload FROM audit_events WHERE action = %s AND target_id = %s "
            "AND target_type = 'engagement_control' ORDER BY created_at",
            action,
            case.control,
        )
    ]


def test_a_failed_queueing_is_recorded_and_the_next_pass_queues_it(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Setup(migrated, "retry-pass")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    case.bench.read_next(None)
    # The reading is kept.
    assert case.bench.rows(
        "SELECT status FROM evidence_analyses WHERE evidence_file_id = %s", case.third
    ) == [("READY",)]
    # The control's try is recorded, with the error's class only, and audited.
    assert (case.control, "DeadlockDetected", 1) in _retries(case)
    [failed] = _events(case, "evidence_assessment.queue_failed")
    assert failed == {
        "error": "DeadlockDetected", "attempts": 1, "held": False, "file_id": str(case.third),
    }  # fmt: skip
    item = UUID(case.bench.item_id)
    assert case.bench.entry()["status"] == "OUT_OF_DATE"
    # The worker's next pass, after a reading (LocalDraftScheduler), queues it.
    _age(case)
    scheduler = LocalDraftScheduler(_settings(migrated))
    handed: list[UUID] = []
    monkeypatch.setattr(scheduler, "schedule_evidence_assessments", handed.extend)
    try:
        scheduler._schedule_open_assessments(analysis_id=case.analysis(case.third))
    finally:
        scheduler._pool.shutdown(wait=True)
    assert _retries(case) == []
    [pending] = case.bench.rows(
        "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL "
        "AND status = 'PENDING'",
        item,
    )
    assert UUID(str(pending[0])) in handed
    [requeued] = _events(case, "evidence_assessment.requeued")
    assert (requeued["attempts"], requeued["error"]) == (1, "DeadlockDetected")
    assert str(pending[0]) in requeued["runs"]


def test_a_failure_that_is_not_the_database_keeps_the_reading_too(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Setup(migrated, "retry-other")
    _fail_once(monkeypatch, RuntimeError("the reader's own words, which are never stored"))
    case.bench.read_next(None)
    assert case.bench.rows(
        "SELECT status FROM evidence_analyses WHERE evidence_file_id = %s", case.third
    ) == [("READY",)]
    assert (case.control, "RuntimeError", 1) in _retries(case)
    stored = case.bench.rows(
        "SELECT count(*) FROM audit_events WHERE payload::text LIKE '%%never stored%%'"
    )
    assert stored == [(0,)]


def test_repeated_failure_stops_at_the_limit_and_says_so(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Setup(migrated, "retry-limit")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    case.bench.read_next(None)
    real = evidence_assurance.reconcile
    tried: list[UUID] = []

    def failing(cursor: Any, project_id: UUID, control_id: UUID, *args: Any, **kw: Any) -> Any:
        tried.append(control_id)
        raise psycopg.errors.LockNotAvailable("could not obtain lock")

    monkeypatch.setattr(evidence_assurance, "reconcile", failing)
    for _ in range(RETRY_LIMIT + 2):
        _age(case)
        with connect(migrated.url) as connection:
            assert retry_failed(connection, case.project) == []
    # Four more tries, then no more: the control is held.
    assert tried.count(case.control) == RETRY_LIMIT - 1
    assert (case.control, "LockNotAvailable", RETRY_LIMIT) in _retries(case)
    events = _events(case, "evidence_assessment.queue_failed")
    assert [e["attempts"] for e in events] == list(range(1, RETRY_LIMIT + 1))
    assert [e["held"] for e in events] == [False] * (RETRY_LIMIT - 1) + [True]
    monkeypatch.setattr(evidence_assurance, "reconcile", real)
    # Visible where the request reads as out of date.
    entry = case.bench.entry()
    assert entry["status"] == "OUT_OF_DATE"
    assert entry["out_of_date"][-1] == RETRY_HELD
    # A person starts the check of one request again (independent review of E1, NB2):
    # the whole control is brought in step with it, which ends the hold.
    rerun = case.bench.rerun()
    assert rerun.status_code == 202, rerun.text
    assert case.control not in [row[0] for row in _retries(case)]
    assert all(RETRY_HELD not in e["out_of_date"] for e in case.bench.assurance()["requests"])
    assert len(_events(case, "evidence_assessment.requeued")) == 1


def test_an_archived_engagements_record_is_left_as_it_is(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Setup(migrated, "retry-archived")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    case.bench.read_next(None)
    _age(case)
    before = _retries(case)
    assert before
    with connect(migrated.url) as connection:
        connection.execute("UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (case.project,))
    with connect(migrated.url) as connection:
        assert retry_failed(connection) == []
    assert _retries(case) == before
    assert _events(case, "evidence_assessment.requeued") == []


def _reconcile_fails_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """The next bringing in step of a control fails; later ones run."""
    real = evidence_assurance.reconcile
    calls: list[int] = []

    def once(*args: Any, **kwargs: Any) -> Any:
        calls.append(1)
        if len(calls) == 1:
            raise psycopg.errors.SerializationFailure("could not serialize access")
        return real(*args, **kwargs)

    monkeypatch.setattr(evidence_assurance, "reconcile", once)


def _then_retried(case: _Setup, migrated: Database) -> None:
    """Recorded and audited, and the next pass brings the control in step."""
    assert (case.control, "SerializationFailure", 1) in _retries(case)
    [failed] = _events(case, "evidence_assessment.queue_failed")
    assert (failed["error"], failed["attempts"], failed["held"]) == (
        "SerializationFailure", 1, False,
    )  # fmt: skip
    _age(case)
    with connect(migrated.url) as connection:
        retry_failed(connection, case.project)
    assert case.control not in [row[0] for row in _retries(case)]
    assert len(_events(case, "evidence_assessment.requeued")) == 1


def test_a_change_the_checks_could_not_follow_is_recorded_and_retried(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """evidence_assurance.follow_control (a person's change to what the runs rest on)."""
    case = _Setup(migrated, "retry-follow")
    case.bench.read_next(None)
    _reconcile_fails_once(monkeypatch)
    with connect(migrated.url) as connection:
        evidence_assurance.follow_control(
            connection, case.project, case.control, case.actor, None, always=True
        )
    _then_retried(case, migrated)


def test_a_plan_the_checks_could_not_follow_is_recorded_and_retried(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """evidence_assurance.follow_plan (a plan run ended)."""
    case = _Setup(migrated, "retry-plan")
    case.bench.read_next(None)
    [(plan_id,)] = case.bench.rows(
        "SELECT id FROM evidence_plans WHERE engagement_control_id = %s", case.control
    )
    _reconcile_fails_once(monkeypatch)
    with connect(migrated.url) as connection:
        assert evidence_assurance.follow_plan(connection, UUID(str(plan_id))) == []
    _then_retried(case, migrated)


def test_a_backfill_that_could_not_queue_is_recorded_and_retried(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """evidence_assurance.backfill (start-up): a request with files and no current check."""
    case = _Setup(migrated, "retry-backfill")
    case.bench.read_next(None)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_assessments SET stale_at = clock_timestamp(), "
            "stale_reason = 'Set aside for the test.' WHERE engagement_control_id = %s "
            "AND stale_at IS NULL",
            (case.control,),
        )
    _reconcile_fails_once(monkeypatch)
    with connect(migrated.url) as connection:
        evidence_assurance.backfill(connection)
    _then_retried(case, migrated)


def test_a_control_is_not_tried_again_before_its_backoff(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Independent review of E1, NB3: RETRY_BACKOFF_SECONDS per failed try since the last,
    so a burst of passes cannot spend the tries in seconds."""
    case = _Setup(migrated, "retry-backoff")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    case.bench.read_next(None)
    tried: list[UUID] = []
    real = evidence_assurance.reconcile

    def counted(cursor: Any, project_id: UUID, control_id: UUID, *args: Any, **kw: Any) -> Any:
        tried.append(control_id)
        return real(cursor, project_id, control_id, *args, **kw)

    monkeypatch.setattr(evidence_assurance, "reconcile", counted)
    for _ in range(3):
        with connect(migrated.url) as connection:
            retry_failed(connection, case.project)
    _age(case, RETRY_BACKOFF_SECONDS - 5)
    with connect(migrated.url) as connection:
        retry_failed(connection, case.project)
    assert tried == [] and (case.control, "DeadlockDetected", 1) in _retries(case)
    _age(case, RETRY_BACKOFF_SECONDS + 5)
    with connect(migrated.url) as connection:
        retry_failed(connection, case.project)
    assert case.control in tried
    assert case.control not in [row[0] for row in _retries(case)]


def test_a_request_never_checked_says_its_check_could_not_be_queued(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Independent review of E1, NB1: the first queueing of a request's check failed and the
    tries ran out: the request, never checked, says so."""
    from test_evidence_assurance import TICKET, _Bench, _reading

    bench = _Bench(migrated, "retry-unchecked")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    entry = bench.entry()
    assert (entry["status"], entry["out_of_date"]) == ("NOT_CHECKED", [])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_assessment_retries SET attempts = %s WHERE engagement_control_id = %s",
            (RETRY_LIMIT, UUID(bench.control)),
        )
    entry = bench.entry()
    assert (entry["status"], entry["out_of_date"]) == ("NOT_CHECKED", [RETRY_HELD])


def test_a_backfill_read_that_fails_is_recorded_and_leaves_the_connection_usable(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Independent review of E1, NB5: a read outside the backfill's inner transaction fails
    in the database; that control's work is rolled back first, so the failure is recorded,
    and the worker's next calls on the same connection work."""
    case = _Setup(migrated, "retry-backfill-read")
    case.bench.read_next(None)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_assessments SET stale_at = clock_timestamp(), "
            "stale_reason = 'Set aside for the test.' WHERE engagement_control_id = %s "
            "AND stale_at IS NULL",
            (case.control,),
        )

    def broken(connection: Any, control_id: UUID) -> Any:
        connection.execute("SELECT 1 / 0")

    monkeypatch.setattr(evidence_assurance, "_linked", broken)
    with connect(migrated.url) as connection:
        assert evidence_assurance.backfill(connection) == []
        # The same connection, as the worker's start-up uses it next.
        assert isinstance(open_assessments(connection, case.project), list)
    assert (case.control, "DivisionByZero", 1) in _retries(case)


def test_a_retry_record_goes_with_an_instance_nothing_else_depends_on(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Independent review of E1, NB9: a failed queueing recorded for an instance (a
    sibling's file records one for every instance) no longer makes its removal refused as
    though it had requests or testing; it goes with it, on the audit trail. An instance
    that has a check or requests is still refused, and its record kept."""
    from ai_workforce_api.control_instances import InstanceState, _delete_instance, clone_instance
    from ai_workforce_api.db import transaction

    case = _Setup(migrated, "retry-instance")
    _fail_once(monkeypatch, psycopg.errors.DeadlockDetected("deadlock detected"))
    case.bench.read_next(None)
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        copy = clone_instance(cursor, case.control, None, "retry:Second unit")
        evidence_assurance.record_queue_failure(
            cursor, case.project, [copy], None, psycopg.errors.DeadlockDetected("x")
        )
    assert (copy, "DeadlockDetected", 1) in _retries(case)
    # Still refused where the instance has its own records; the record stays.
    with (
        connect(migrated.url) as connection,
        pytest.raises(InstanceState, match="cannot be removed"),
        transaction(connection) as cursor,
    ):
        _delete_instance(cursor, case.control, "ITGC-AC-01")
    assert (case.control, "DeadlockDetected", 1) in _retries(case)
    # Removed with the instance that has nothing else.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        _delete_instance(cursor, copy, "ITGC-AC-01 · Second unit")
    assert copy not in [row[0] for row in _retries(case)]
    assert case.bench.rows("SELECT 1 FROM engagement_controls WHERE id = %s", copy) == []
    [dropped] = case.bench.rows(
        "SELECT payload FROM audit_events WHERE action = 'evidence_assessment.retry_dropped' "
        "AND target_id = %s",
        copy,
    )
    assert (dropped[0]["attempts"], dropped[0]["error"]) == (1, "DeadlockDetected")
