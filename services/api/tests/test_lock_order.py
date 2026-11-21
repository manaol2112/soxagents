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
        def __init__(self, answers: list[dict[str, Any] | None]) -> None:
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


def _bracketed_tested(
    database: Database, slug: str, marker: str
) -> tuple[dict[str, Any], Any, dict[str, Any], UUID]:
    """ITGC-AC-01 (library v3) tested on an approved plan whose first attribute carries a
    client value's bracketed wording (marker), with finished D&I checks on its
    description: the state a client value's fill (control_design.set_values) then fills."""
    from test_master_plans import _approve
    from test_testing_engine import _open_tested

    from ai_workforce_api.control_attributes import _write_list

    team, client, sheet = _open_tested(database, slug)
    control = UUID(sheet["control_id"])
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert row is not None
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE control_attributes SET text = %s WHERE id = %s",
                (f"{row[1]} by {marker}", row[0]),
            )
            _write_list(cursor, control)
    _approve(team, str(control))
    with connect(database.url) as connection:
        # Tested on the bracketed wording (as the ST-1 fill test sets it).
        connection.execute(
            "UPDATE test_items SET needs_test = false WHERE test_sheet_id = %s", (sheet["id"],)
        )
        # A finished D&I check that read the current description (a held run: it needs no
        # model answers), which the fill's new description puts out of date.
        connection.execute(
            """
            INSERT INTO evidence_assessments (
                organization_id, project_id, engagement_control_id, requirement_id,
                requested_by, files, control_sha256, attributes_sha256, lens,
                assessor_prompt_version, reviewer_prompt_version, basis_sha256, status,
                held_code, held_reason, finished_at
            )
            SELECT r.organization_id, r.project_id, r.engagement_control_id, r.id, %s,
                   '[{"file_id": null}]'::jsonb, repeat('a', 64), repeat('b', 64),
                   'DESIGN_DOCUMENT', 'v1', 'v1', repeat('c', 64), 'HELD', 'UNREADABLE',
                   'The file could not be read.', clock_timestamp()
            FROM evidence_requirements r WHERE r.engagement_control_id = %s
            ORDER BY r.id LIMIT 1
            """,
            (team["owner_id"], control),
        )
        connection.commit()
        runs = connection.execute(
            "SELECT count(*) FROM evidence_assessments WHERE engagement_control_id = %s "
            "AND stale_at IS NULL AND control_sha256 IS NOT NULL",
            (control,),
        ).fetchone()
    assert runs is not None and int(runs[0]) > 0, "the control has finished D&I checks"
    return team, client, sheet, control


def _free(url: str, sql: str, *params: Any) -> bool:
    """Whether a third connection can lock the rows without waiting. The callers assert on
    the answer alone, so a failure never prints the database URL."""
    with psycopg.connect(url) as third:
        try:
            third.execute(f"{sql} FOR UPDATE NOWAIT", params)
        except psycopg.errors.LockNotAvailable:
            return False
        third.rollback()
        return True


def _holding_plan(url: str, control: UUID) -> psycopg.Connection[Any]:
    holder = psycopg.connect(url)
    assert holder.execute(
        "SELECT id FROM evidence_plans WHERE engagement_control_id = %s FOR UPDATE", (control,)
    ).fetchall(), "the control has a plan"
    return holder


def _filling(
    url: str, team: dict[str, Any], control: UUID, slot: str, value: str, everywhere: bool
) -> Callable[[], list[UUID]]:
    from ai_workforce_api.control_design import ValuesBody, set_values

    def fill() -> list[UUID]:
        with psycopg.connect(url, connect_timeout=3) as connection:
            return set_values(
                connection, UUID(str(team["org"])), UUID(str(team["project"])), control,
                UUID(str(team["owner_id"])),
                ValuesBody(values={slot: value}, everywhere=everywhere),
            )  # fmt: skip

    return fill


def test_a_client_value_fill_takes_the_plan_before_the_runs_and_sheets(
    migrated: Database,
) -> None:
    """N1 and the lock order (19 November 2026, review round 4 B1): a fill of a client value
    on a library control rewrites its description, which marks its D&I checks out of date
    (step 3), and fills an approved attribute's brackets, which brings its open sheets in
    step (step 4). Before, refresh_statement locked the runs and only then the plan (step
    1), so a withdrawal or a reading of the control (the plan, then the runs) could
    deadlock with it. Now, waiting for the plan, it holds no run and no sheet; and once it
    runs, the items tested on the bracket are tested again (N1), through the real fill."""
    from test_testing_engine import _sheet_of

    team, client, sheet, control = _bracketed_tested(
        migrated, "lock-fill", "[the access request tool]"
    )
    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(
        _filling(migrated.url, team, control, "access-tool", "ServiceNow", False)
    )
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        runs_free = _free(
            migrated.url,
            "SELECT 1 FROM evidence_assessments WHERE engagement_control_id = %s",
            control,
        )
        assert runs_free, "waiting for the plan, the fill holds the control's runs"
        sheets_free = _free(
            migrated.url, "SELECT 1 FROM test_sheets WHERE engagement_control_id = %s", control
        )
        assert sheets_free, "waiting for the plan, the fill holds the control's sheets"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert outcome == {"result": [control]}
    filled = _sheet_of(client, team, sheet["id"])
    assert filled["attributes"][0].endswith("by ServiceNow")
    assert [i["state"] for i in filled["items"]] == ["WAITING"] * len(filled["items"])
    assert filled["running"] is True


def test_a_value_filled_everywhere_takes_every_plan_in_id_order_first(
    migrated: Database,
) -> None:
    """The lock order (review round 4 B1): a value filled everywhere refreshes each control
    that takes it. Before, it went control by control, the one named first and then in the
    order it found them: it held the named control's plan, runs and sheets and then asked
    for another control's plan, and not in control-id order (lock_served's). Now it takes
    every plan, in id order, before any run or sheet. The holder takes the tested
    control's plan and the fill is named on a control that sorts after it: waiting, the
    fill holds no run or sheet of the tested control and no plan that sorts after its
    (the named control's included, which the order it found them in takes first)."""
    from ai_workforce_api.statement_registry import statement_for
    from ai_workforce_api.testing_definitions import DEFINED_SINCE

    team, _client, _sheet_body, control = _bracketed_tested(
        migrated, "lock-fill-all", "[the role that administers user access]"
    )
    with connect(migrated.url) as connection:
        # The controls set_values fills too: the same units, a statement with the value,
        # and no value recorded yet.
        rows = connection.execute(
            """
            SELECT c.id, c.library_key,
                   EXISTS (SELECT 1 FROM evidence_plans p WHERE p.engagement_control_id = c.id)
            FROM engagement_controls c
            WHERE c.project_id = %s AND c.id <> %s AND c.library_key IS NOT NULL
              AND c.library_version >= %s
              AND split_part(c.implementation_key, ':', 2) = (
                  SELECT split_part(implementation_key, ':', 2)
                  FROM engagement_controls WHERE id = %s)
              AND NOT EXISTS (
                  SELECT 1 FROM control_parameters v
                  WHERE v.engagement_control_id = c.id AND v.slot_key = 'admin-role'
                    AND v.value <> '')
            """,
            (team["project"], control, DEFINED_SINCE, control),
        ).fetchall()
    takers = [
        (UUID(str(row[0])), bool(row[2]))
        for row in rows
        if (found := statement_for(str(row[1]))) is not None
        and found.slot("admin-role") is not None
    ]
    planned = sorted((taker for taker, has_plan in takers if has_plan), key=str)
    assert planned, "another control takes the role and has a plan"
    named = planned[-1]
    assert str(named) > str(control), "a control with a plan sorts after the tested one"
    targets = sorted([control, *(taker for taker, _plan in takers)], key=str)
    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(
        _filling(migrated.url, team, named, "admin-role", "IT service desk", True)
    )
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        for target in targets:
            if str(target) > str(control):
                plan_free = _free(
                    migrated.url,
                    "SELECT 1 FROM evidence_plans WHERE engagement_control_id = %s",
                    target,
                )
                assert plan_free, f"a plan after the one waited for is held: {target}"
        runs_free = _free(
            migrated.url,
            "SELECT 1 FROM evidence_assessments WHERE engagement_control_id = %s",
            control,
        )
        assert runs_free, "waiting for a plan, the fill holds the control's runs"
        sheets_free = _free(
            migrated.url, "SELECT 1 FROM test_sheets WHERE engagement_control_id = %s", control
        )
        assert sheets_free, "waiting for a plan, the fill holds the control's sheets"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome
    assert sorted(outcome["result"], key=str) == targets


def _planned_after(database: Database, team: dict[str, Any], control: UUID, slot: str) -> UUID:
    """The first control, by id, after the tested one that has a plan and a statement with
    the value (slot): a fill of both takes its plan after the tested control's."""
    from ai_workforce_api.statement_registry import statement_for

    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT c.id, c.library_key FROM engagement_controls c
            WHERE c.project_id = %s AND c.id::text > %s::text AND c.library_key IS NOT NULL
              AND EXISTS (SELECT 1 FROM evidence_plans p WHERE p.engagement_control_id = c.id)
            ORDER BY c.id
            """,
            (team["project"], control),
        ).fetchall()
    later = next(
        (
            UUID(str(row[0]))
            for row in rows
            if (found := statement_for(str(row[1]))) is not None and found.slot(slot) is not None
        ),
        None,
    )
    assert later is not None, "a control with a plan and the role sorts after the tested one"
    return later


def test_values_for_many_controls_take_every_plan_in_id_order_first(
    migrated: Database,
) -> None:
    """The lock order (review round 4 B1): the plan queue's answers for several controls
    (set_values_many) fill them one by one in one transaction. Before, each control took
    its own plan when its turn came, in the order the answers were given: it held the
    first control's plan and sheets and then asked for the next one's plan. Now every
    answered control's plan is taken, in id order, first. The answers are given for a
    control that sorts after the tested one, then for the tested one, whose plan the
    holder takes: waiting, the fill holds no other plan and none of the tested control's
    runs or sheets."""
    from ai_workforce_api.control_design import ManyValuesBody, ManyValuesItem, set_values_many

    team, _client, _sheet_body, control = _bracketed_tested(
        migrated, "lock-fill-many", "[the role that administers user access]"
    )
    later = _planned_after(migrated, team, control, "admin-role")
    body = ManyValuesBody(
        items=[
            ManyValuesItem(control_id=later, values={"admin-role": "IT service desk"}),
            ManyValuesItem(control_id=control, values={"admin-role": "IT service desk"}),
        ]
    )

    def fill() -> list[UUID]:
        with psycopg.connect(migrated.url, connect_timeout=3) as connection:
            return set_values_many(
                connection, UUID(str(team["org"])), UUID(str(team["project"])),
                UUID(str(team["owner_id"])), body,
            )  # fmt: skip

    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(fill)
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        plan_free = _free(
            migrated.url, "SELECT 1 FROM evidence_plans WHERE engagement_control_id = %s", later
        )
        assert plan_free, "waiting for the tested control's plan, the fill holds a later one"
        runs_free = _free(
            migrated.url,
            "SELECT 1 FROM evidence_assessments WHERE engagement_control_id = %s",
            control,
        )
        assert runs_free, "waiting for the plan, the fill holds the control's runs"
        sheets_free = _free(
            migrated.url, "SELECT 1 FROM test_sheets WHERE engagement_control_id = %s", control
        )
        assert sheets_free, "waiting for the plan, the fill holds the control's sheets"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome
    assert sorted(outcome["result"], key=str) == sorted([later, control], key=str)


def _row_free(url: str, control: UUID) -> bool:
    return _free(url, "SELECT 1 FROM engagement_controls WHERE id = %s", control)


def test_a_library_link_takes_the_plan_before_the_control_row(migrated: Database) -> None:
    """The lock order (19 November 2026, review round 5 B2): a fill takes the plan and then
    rewrites the control's description (control_design.refresh_statement). Before, a
    library link or adoption (library_definitions._control: link_definitions, adopt) locked
    the control's row and then asked for the plan in the statement's refresh, so it could
    wait on a fill waiting on it (a deploy's link pass, a person's adoption, a scope
    change). Now it takes the plan first: waiting for it, the link holds no control row."""
    from test_testing_engine import _open_tested

    from ai_workforce_api.library_definitions import link_definitions

    _team, _client, sheet = _open_tested(migrated, "lock-link")
    control = UUID(sheet["control_id"])

    def link() -> int:
        with (
            psycopg.connect(migrated.url, connect_timeout=3) as connection,
            transaction(connection) as cursor,
        ):
            return link_definitions(cursor, control, None)

    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(link)
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        assert _row_free(migrated.url, control), "waiting for the plan, the link holds the row"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome


def test_adopting_a_standard_takes_the_plan_before_the_control_row(migrated: Database) -> None:
    """The lock order (review round 5 B2): following a standard the control does not have
    yet (library_matching.decide_basis) rewrites the control's row with the standard's key
    and then links its definitions, whose refresh takes the plan. Before, it held the row
    while it asked for the plan, as a link did. Now the plan is taken before the row:
    waiting for it, the adoption holds no control row."""
    from test_testing_engine import _open_tested

    from ai_workforce_api.controls import BY_KEY
    from ai_workforce_api.library_matching import BasisWrite, decide_basis, load_control

    team, _client, sheet = _open_tested(migrated, "lock-adopt")
    control = UUID(sheet["control_id"])
    with connect(migrated.url) as connection:
        facts = load_control(connection, control)
        used = {
            str(row[0])
            for row in connection.execute(
                "SELECT library_key FROM engagement_controls WHERE project_id = %s "
                "AND library_key IS NOT NULL",
                (team["project"],),
            ).fetchall()
        }
    assert facts is not None
    # A standard no control of the engagement follows yet (one key per system).
    key = next(k for k in sorted(BY_KEY) if k not in used)
    write = BasisWrite(basis="STANDARD", library_key=key, note="Fits")

    def adopt() -> str:
        with psycopg.connect(migrated.url, connect_timeout=3) as connection:
            return decide_basis(connection, facts, UUID(str(team["owner_id"])), write, False)

    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(adopt)
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        row_free = _row_free(migrated.url, control)
        assert row_free, "waiting for the plan, the adoption holds the row"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT library_key, test_basis FROM engagement_controls WHERE id = %s", (control,)
        ).fetchone()
    assert row is not None and tuple(row) == (key, "STANDARD")


def test_prior_year_answers_for_many_controls_take_every_plan_in_id_order_first(
    migrated: Database,
) -> None:
    """The lock order (review round 5 B3): a prior-year reference's accepted answers
    (prior_year.decide_proposals) fill each answered control in one transaction. Before,
    each fill took its control's plan when its proposal's turn came: it held one control's
    plan, runs and sheets and then asked for the next control's plan, as set_values_many
    did before round 4. Now every answered control's plan is taken, in id order, first.
    The answer for a control that sorts after the tested one is proposed first, then the
    tested one's, whose plan the holder takes: waiting, the decision holds no other plan
    and none of the tested control's runs or sheets."""
    from test_prior_year import _upload

    from ai_workforce_api.prior_year import ProposalDecision, decide_proposals

    team, _client, _sheet_body, control = _bracketed_tested(
        migrated, "lock-fill-py", "[the role that administers user access]"
    )
    later = _planned_after(migrated, team, control, "admin-role")
    document = UUID(str(_upload(team)["id"]))
    proposals: list[UUID] = []
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        # Confirmed matches for both controls, the later control's answer proposed first.
        for target in (later, control):
            match = cursor.execute(
                """
                INSERT INTO prior_year_matches (
                    organization_id, project_id, document_id, prior_ref, engagement_control_id,
                    basis, status, analysis_status
                )
                VALUES (%s, %s, %s, 'PY-1', %s, 'PERSON', 'CONFIRMED', 'DONE')
                ON CONFLICT (document_id, engagement_control_id)
                    WHERE engagement_control_id IS NOT NULL
                DO UPDATE SET status = 'CONFIRMED'
                RETURNING id
                """,
                (team["org"], team["project"], document, target),
            ).fetchone()
            assert match is not None
            proposal = cursor.execute(
                """
                INSERT INTO prior_year_proposals (
                    organization_id, project_id, match_id, engagement_control_id, kind,
                    slot_key, value, title, quote
                )
                VALUES (%s, %s, %s, %s, 'ANSWER', 'admin-role', 'IT service desk',
                        'Who administers user access', 'IT Security Manager')
                RETURNING id
                """,
                (team["org"], team["project"], match[0], target),
            ).fetchone()
            assert proposal is not None
            proposals.append(UUID(str(proposal[0])))

    def decide() -> list[UUID]:
        with psycopg.connect(migrated.url, connect_timeout=3) as connection:
            return decide_proposals(
                connection, UUID(str(team["org"])), UUID(str(team["project"])),
                UUID(str(team["owner_id"])), ProposalDecision(accept=proposals),
            )  # fmt: skip

    holder = _holding_plan(migrated.url, control)
    thread, outcome = _in_thread(decide)
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        plan_free = _free(
            migrated.url, "SELECT 1 FROM evidence_plans WHERE engagement_control_id = %s", later
        )
        assert plan_free, "waiting for the tested control's plan, the decision holds a later one"
        runs_free = _free(
            migrated.url,
            "SELECT 1 FROM evidence_assessments WHERE engagement_control_id = %s",
            control,
        )
        assert runs_free, "waiting for the plan, the decision holds the control's runs"
        sheets_free = _free(
            migrated.url, "SELECT 1 FROM test_sheets WHERE engagement_control_id = %s", control
        )
        assert sheets_free, "waiting for the plan, the decision holds the control's sheets"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert "error" not in outcome, outcome
    assert sorted(outcome["result"], key=str) == sorted([later, control], key=str)


def test_a_finished_re_performance_takes_the_review_before_its_notes(
    migrated: Database,
) -> None:
    """FO-2 (19 November 2026). Before, control_reviews._finish withdrew the review's notes
    before it took the review row, the reverse of every person's path (_locked, then
    _locked_note), so a run finishing while a reviewer cleared a note could deadlock. Now it
    takes the review first: while a person holds the review, the finishing run waits holding
    none of the review's notes."""
    from test_control_reviews import _claimed, _prepared_control
    from test_testing_engine import _base

    from ai_workforce_api.control_reviews import RunRecord, _finish, run_reperformance

    team, client, _sheet, _file = _prepared_control(migrated, "lock-review-notes", "LOG")
    base = _base(team)
    review_id = UUID(client.get(f"{base}/reviews").json()[0]["id"])
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, review_id) == "DONE"
        started = _claimed(connection, review_id)
    holder = psycopg.connect(migrated.url)
    holder.execute("SELECT id FROM control_reviews WHERE id = %s FOR UPDATE", (review_id,))

    def finish() -> bool:
        with connect(migrated.url) as connection:
            return _finish(
                connection, review_id, 1, "RULES", "", None, [],
                started_at=started, run=RunRecord(rules_ran=True, due=()),
            )  # fmt: skip

    thread, outcome = _in_thread(finish)
    try:
        _blocked_by(migrated.url, holder.info.backend_pid)
        assert _free(
            migrated.url, "SELECT id FROM review_notes WHERE control_review_id = %s", review_id
        ), "the finishing run holds none of the review's notes while it waits"
    finally:
        holder.rollback()
        thread.join(60)
        holder.close()
    assert outcome == {"result": True}


def test_the_set_review_takes_the_plan_before_any_attribute(migrated: Database) -> None:
    """R10 of the SOL attribute fixes (19 November 2026): a person's save of criteria takes
    the plan and then the attribute (master_plans.set_criteria); the set reviewer's
    corrections took the attribute and then the plan (attribute_review._kept, then _store),
    so the two could deadlock. The reviewer now takes the plan first: while a connection
    holds the plan, the reviewer waits holding no attribute."""
    from set_review_answers import given_of, with_every_verdict
    from support import run_plan_through
    from test_agent_answers import _Script
    from test_attributes_follow_understanding import _answer_required, _plan_run, _ready

    from ai_workforce_api import attribute_review

    team, control, _scheduler, client = _ready(migrated, "lock-set-review")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    with connect(migrated.url) as connection:
        assert run_plan_through(connection, _Script(migrated, team, control), plan_id) == "DONE"
    revised: list[str] = []

    def review(prompt: str) -> dict[str, Any]:
        given = given_of(prompt)
        target = next(item for item in given["attributes"] if "criteria" in item["may_revise"])
        revised.append(target["id"])
        return with_every_verdict(
            {"attributes": [{
                "id": target["id"], "verdict": "REVISED", "note": "Names the record.",
                "condition": "The ServiceNow access request names the user and the role.",
                "pass_criteria": "The manager's approval is recorded on the ServiceNow request.",
                "fail_criteria": "No approval is recorded on the ServiceNow request.",
            }], "findings": []},
            given,
        )  # fmt: skip

    script = _Script(migrated, team, control)
    script.answers["set-review"] = [review]
    holder = psycopg.connect(migrated.url)
    try:
        holder.execute(
            "SELECT id FROM evidence_plans WHERE engagement_control_id = %s FOR UPDATE",
            (UUID(control),),
        )
        holder_pid = holder.info.backend_pid

        def run() -> str:
            with psycopg.connect(migrated.url, connect_timeout=3) as connection:
                return attribute_review.review_set(
                    connection, script, UUID(str(team["org"])), UUID(str(team["project"])),
                    UUID(control), team["owner_id"],
                )  # fmt: skip

        thread, outcome = _in_thread(run)
        _blocked_by(migrated.url, holder_pid)
        assert revised
        with psycopg.connect(migrated.url) as third:
            third.execute(
                "SELECT 1 FROM control_attributes WHERE id = %s FOR UPDATE NOWAIT",
                (UUID(revised[0]),),
            )
            third.rollback()
    finally:
        holder.rollback()
        holder.close()
    thread.join(60)
    assert outcome.get("error") is None and outcome.get("result") == ""
