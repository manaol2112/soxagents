"""The lock order of evidence_plans, evidence_requirements, evidence_assessments and
test_sheets (evidence_reliance's module docstring; 18 November 2026: a reading and a
wizard batch's landing of the same control deadlocked, and the reading's check of its file
was lost, the request left out of date with nothing queued).

Each test is deterministic: a step waits until the other connection is seen waiting on a
lock (pg_stat_activity), never on a fixed sleep. One connection holds a control's current
runs, as a check being queued does; the real function, on its own connection in a thread,
must then wait for them while it holds no test sheet, which a third connection proves by
locking the sheet without waiting.
"""

import threading
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
from support import Database
from test_evidence_analysis import _no_ocr, _settings
from test_evidence_assurance import LOG, TICKET, _Bench, _first_met_rest, _reading, _Readings
from test_outbound import migrated

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_assurance import reconcile
from ai_workforce_api.testing_engine import request_run

_ = migrated


class _Setup:
    """ITGC-AC-01 with a current run on each of two D&I items, an open test sheet, and a
    third file on the first item, not read yet."""

    def __init__(self, database: Database, slug: str) -> None:
        bench = _Bench(database, slug)
        bench.add("ticket REQ-1041.txt", TICKET)
        bench.add("sap change log.txt", LOG)
        bench.read_next(_reading("walkthrough"), _reading("change_history"))
        assert bench.check(_Readings(_first_met_rest("MET"), _first_met_rest("MET"))) == ["READY"]
        other = str(bench.items[1]["id"])
        bench.add("policy.txt", "Access policy text.\n", item=bench.item(other))
        bench.read_next(_reading("policy"))
        self.bench = bench
        self.url = database.url
        self.project = UUID(str(bench.team["project"]))
        self.control = UUID(bench.control)
        self.actor = UUID(str(bench.team["owner_id"]))
        with connect(database.url) as connection, transaction(connection) as cursor:
            row = cursor.execute(
                "INSERT INTO test_sheets (organization_id, project_id, engagement_control_id, "
                "method, attributes, requested_by) VALUES (%s, %s, %s, 'TEST_OF_ONE', "
                "'[\"The control operated as described\"]'::jsonb, %s) RETURNING id",
                (UUID(str(bench.team["org"])), self.project, self.control, self.actor),
            ).fetchone()
        assert row is not None
        self.sheet = UUID(str(row[0]))
        self.third = UUID(bench.add("ticket REQ-1042.txt", TICKET.replace("1041", "1042")))

    def analysis(self, file_id: UUID) -> UUID:
        rows = self.bench.rows(
            "SELECT id FROM evidence_analyses WHERE evidence_file_id = %s", file_id
        )
        return UUID(str(rows[0][0]))

    def holding_runs(self) -> psycopg.Connection[Any]:
        """A connection holding the control's current runs, as a check being queued does
        (evidence_assurance.reconcile), its transaction left open."""
        holder = psycopg.connect(self.url)
        with holder.cursor() as cursor:
            reconcile(cursor, self.project, self.control, self.actor)
        assert holder.execute(
            "SELECT count(*) FROM evidence_assessments WHERE engagement_control_id = %s "
            "AND stale_at IS NULL",
            (self.control,),
        ).fetchone() != (0,)
        return holder

    def sheet_free(self) -> bool:
        """Whether a third connection can lock the open sheet without waiting."""
        with psycopg.connect(self.url) as third:
            try:
                third.execute(
                    "SELECT 1 FROM test_sheets WHERE id = %s FOR UPDATE NOWAIT", (self.sheet,)
                )
            except psycopg.errors.LockNotAvailable:
                return False
            third.rollback()
            return True

    def current_or_queued(self, requirement: UUID) -> list[str]:
        return [
            str(row[0])
            for row in self.bench.rows(
                "SELECT status FROM evidence_assessments WHERE requirement_id = %s "
                "AND stale_at IS NULL",
                requirement,
            )
        ]


def _blocked_by(url: str, holder_pid: int, seconds: float = 30.0) -> None:
    """Until a backend is waiting on a lock the holder has."""
    with psycopg.connect(url, autocommit=True) as watcher:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            row = watcher.execute(
                "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' "
                "AND %s = ANY(pg_blocking_pids(pid))",
                (holder_pid,),
            ).fetchone()
            if row is not None:
                return
            time.sleep(0.02)
    raise AssertionError("nothing waited on the holder's locks")


def _in_thread(work: Callable[[], Any]) -> tuple[threading.Thread, dict[str, Any]]:
    outcome: dict[str, Any] = {}

    def run() -> None:
        try:
            outcome["result"] = work()
        except Exception as error:  # noqa: BLE001 - recorded for the assertion
            outcome["error"] = error

    thread = threading.Thread(target=run)
    thread.start()
    return thread, outcome


def _reading_of(case: _Setup, database: Database) -> Callable[[], str]:
    def read() -> str:
        with psycopg.connect(case.url, connect_timeout=3) as connection:
            connection.execute("SET TIME ZONE 'UTC'")
            connection.commit()
            return run_analysis(
                connection, _settings(database), None, case.analysis(case.third), _no_ocr
            )

    return read


def test_a_reading_and_a_landing_of_the_same_control_do_not_deadlock(
    migrated: Database,
) -> None:
    """The incident's two transactions: a wizard landing holds the control's runs and then
    asks for the sheet's run; a reading of another file of the control ends meanwhile. The
    reading waits for the runs before it touches the sheet, so the landing asks for the
    run at once, and the reading's check of its file is queued when the landing commits."""
    case = _Setup(migrated, "lock-cycle")
    holder = case.holding_runs()
    # The landing waits up to ten seconds before it looks for a cycle, so a reading that
    # does wait on it in a cycle is the one that finds it (as in the incident).
    holder.execute("SET deadlock_timeout = '10s'")
    thread, outcome = _in_thread(_reading_of(case, migrated))
    _blocked_by(case.url, holder.info.backend_pid)
    landing_error: Exception | None = None
    try:
        with holder.cursor() as cursor:
            assert request_run(cursor, case.sheet) == case.sheet
        holder.commit()
    except psycopg.errors.DeadlockDetected as error:
        landing_error = error
        holder.rollback()
    finally:
        thread.join(60)
        holder.close()
    assert landing_error is None
    assert outcome == {"result": "READY"}
    # The reading's check of its file is current or queued: nothing is left to a restart.
    assert case.current_or_queued(UUID(case.bench.item_id)) != []
    assert case.bench.rows(
        "SELECT count(*) FROM audit_events WHERE action = 'evidence.analyzed' AND target_id = %s",
        case.third,
    ) == [(1,)]


def test_a_reading_queues_its_checks_before_it_tests(migrated: Database) -> None:
    """evidence_analysis.run_analysis: waiting for the control's runs, it holds no sheet."""
    case = _Setup(migrated, "lock-read")
    holder = case.holding_runs()
    thread, outcome = _in_thread(_reading_of(case, migrated))
    try:
        _blocked_by(case.url, holder.info.backend_pid)
        assert case.sheet_free()
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert outcome == {"result": "READY"}


def test_a_restoration_queues_its_checks_before_it_tests_again(migrated: Database) -> None:
    """evidence_versions.restore_file: waiting for the control's runs, it holds no sheet."""
    case = _Setup(migrated, "lock-restore")
    bench = case.bench
    bench.read_next(None)
    policy = str(
        bench.rows(
            "SELECT id FROM evidence_files WHERE project_id = %s AND file_name = 'policy.txt'",
            case.project,
        )[0][0]
    )
    withdrawn = bench.client.post(
        f"{bench.base}/evidence-files/{policy}/withdraw", json={"reason": "Sent in error."}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    holder = case.holding_runs()

    def restore() -> int:
        restored = bench.client.post(
            f"{bench.base}/evidence-files/{policy}/restore", json={"reason": "Sent after all."}
        )
        return restored.status_code

    thread, outcome = _in_thread(restore)
    try:
        _blocked_by(case.url, holder.info.backend_pid)
        assert case.sheet_free()
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert outcome == {"result": 200}


def test_a_move_lands_the_wizard_batch_before_it_leaves_the_sheets(migrated: Database) -> None:
    """evidence_intake's filing: a wizard file moved to another control lands its batch
    (the batch's checks lock the control's runs) before it takes the file off the control's
    open sheets."""
    case = _Setup(migrated, "lock-move")
    bench = case.bench
    bench.read_next(None)
    added = bench.client.post(
        f"{bench.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "access procedure.txt",
                "design_control_id": str(case.control)},
        content=b"Access procedure: managers approve each access request.",
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    wizard_file = str(added.json()["file_id"])
    bench.read_next(_reading("policy"))
    [(elsewhere,)] = bench.rows(
        "SELECT id FROM engagement_controls WHERE project_id = %s AND id <> %s AND included "
        "ORDER BY control_ref LIMIT 1",
        case.project,
        case.control,
    )
    [(version,)] = bench.rows(
        "SELECT version FROM evidence_matches WHERE evidence_file_id = %s", UUID(wizard_file)
    )
    holder = case.holding_runs()

    def move() -> int:
        moved = bench.client.post(
            f"{bench.base}/evidence-files/{wizard_file}/filing",
            json={"version": version, "control_id": str(elsewhere)},
        )
        return moved.status_code

    thread, outcome = _in_thread(move)
    try:
        _blocked_by(case.url, holder.info.backend_pid)
        assert case.sheet_free()
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert outcome == {"result": 200}
    assert bench.rows(
        "SELECT engagement_control_id FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(wizard_file),
    ) == [(elsewhere,)]


def test_a_sheet_change_takes_the_plan_before_the_sheet(migrated: Database) -> None:
    """ST-1 (19 November 2026): plan approval holds the control's plan and then brings its
    open sheets in step, while a sheet's reopening (and its sign-off) takes the plan after
    the sheet (refresh_decisions). change_sheet now takes the plan first: waiting for an
    approval that holds the plan, it holds no sheet, so the two cannot wait on each other."""
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.test_sheets import ReopenBody, change_sheet, reopen_work

    case = _Setup(migrated, "lock-plan-sheet")
    with connect(case.url) as connection:
        connection.execute(
            "UPDATE test_sheets SET status = 'SIGNED_OFF', conclusion = 'EFFECTIVE', "
            "signed_by = %s, signed_at = clock_timestamp() WHERE id = %s",
            (case.actor, case.sheet),
        )
        version = connection.execute(
            "SELECT version FROM test_sheets WHERE id = %s", (case.sheet,)
        ).fetchone()
        organization = connection.execute(
            "SELECT organization_id FROM test_sheets WHERE id = %s", (case.sheet,)
        ).fetchone()
        connection.commit()
    assert version is not None and organization is not None
    holder = psycopg.connect(case.url)
    holder.execute(
        "SELECT id FROM evidence_plans WHERE engagement_control_id = %s FOR UPDATE",
        (case.control,),
    )

    def reopen() -> Any:
        with psycopg.connect(case.url, connect_timeout=3) as connection:
            return change_sheet(
                connection,
                Principal(kind=PrincipalKind.USER, id=case.actor),
                UUID(str(organization[0])),
                case.project,
                case.sheet,
                reopen_work(ReopenBody(version=int(version[0]), reason="The plan changed.")),
            )

    thread, outcome = _in_thread(reopen)
    try:
        _blocked_by(case.url, holder.info.backend_pid)
        assert case.sheet_free()
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome


def test_a_run_tests_each_item_on_the_attributes_it_reads_with_the_item(
    migrated: Database,
) -> None:
    """ST-1 (19 November 2026): the attributes change while the tester runs (approval
    brings the open sheet in step and bumps its items). Before, the run tested every item
    on the attributes it read when it claimed the sheet, so an item it reached after the
    change was written as tested on the old list. Now each item is tested on the
    attributes read with its version: no item stands tested on a list the sheet no longer
    holds."""
    import hashlib
    import json

    from test_testing_engine import _answer, _base, _Citing, _sheet
    from test_workpapers import _tested_control

    from ai_workforce_api.testing_engine import run_sheet

    team, client, sheet, _file = _tested_control(migrated, "lock-run-basis", sign=False)
    retest = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/retest", json={"version": sheet["version"]}
    )
    assert retest.status_code == 200, retest.text
    longer = [*sheet["attributes"], "The approver is independent of the requester"]

    def change_attributes() -> None:
        # What bringing the sheet in step does to it, from another connection, while the
        # first item is with the tester: the attributes rewritten, every item bumped.
        with connect(migrated.url) as other:
            other.execute(
                "UPDATE test_sheets SET attributes = %s::jsonb, version = version + 1 "
                "WHERE id = %s",
                (json.dumps(longer), sheet["id"]),
            )
            other.execute(
                "UPDATE test_items SET version = version + 1 WHERE test_sheet_id = %s",
                (sheet["id"],),
            )
            other.commit()

    class _Changing(_Citing):
        def __init__(self, answers: list[dict[str, Any]]) -> None:
            super().__init__(answers)
            self.changed = False

        def complete(self, request: Any, config: Any) -> Any:
            if not self.changed:
                self.changed = True
                change_attributes()
            return super().complete(request, config)

    count = len(sheet["attributes"])
    provider = _Changing([_answer(["PASS"] * count) for _ in sheet["items"]])
    with connect(migrated.url) as connection:
        run_sheet(connection, provider, UUID(sheet["id"]))
        rows = connection.execute(
            """
            SELECT m.inputs ->> 'attributes_sha256' FROM test_items i
            JOIN model_calls m ON m.id = i.model_call_id
            WHERE i.test_sheet_id = %s AND NOT i.needs_test
            """,
            (sheet["id"],),
        ).fetchall()
    held = hashlib.sha256(json.dumps(longer, ensure_ascii=False).encode()).hexdigest()
    assert rows, "the items reached after the change are tested"
    assert {row[0] for row in rows} == {held}
    assert _sheet(client, team)["attributes"] == longer
