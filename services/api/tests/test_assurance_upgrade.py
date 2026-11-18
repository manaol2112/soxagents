"""Checking again with the current engine (docs/evidence-assurance.md, section 10.10).

A person who may decide evidence asks, for one request, that its finished check by an
earlier engine be replaced by a check of the current engine. Forward only (10.1) still
holds: nothing is re-checked unless a person asks, the earlier run is kept and marked out
of date with its reason, its open findings go out of date with it, a finding a person has
decided keeps its status, and one new run is queued. Every refusal leaves the run on
record exactly as it was and writes no audit event. Synthetic evidence only.
"""

import threading
import time
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_assurance_engine2 import _all_met, _engine_2, _said
from test_assurance_forward_only import _as_engine_1
from test_evidence_assurance import LOG, TICKET, _Bench, _reading, _Readings
from test_evidence_plans import _control
from test_outbound import migrated

from ai_workforce_api import evidence_assurance as chain
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.engagement_close import closed_detail

__all__ = ["migrated"]

ACTION = "evidence.assessment_engine_upgrade_requested"


def _upgrade(
    bench: _Bench,
    client: TestClient | None = None,
    requirement_id: str | None = None,
    control_id: str | None = None,
) -> Any:
    return (client or bench.owner).post(
        f"{bench.base}/controls/{control_id or bench.control}/evidence-assurance/"
        f"{requirement_id or bench.item_id}/upgrade"
    )


def _records(bench: _Bench) -> list[tuple[Any, ...]]:
    """Every run of the control, whole, and every finding's status: what a refusal must
    leave exactly as it was."""
    return bench.rows(
        "SELECT 'run', id::text, to_jsonb(a)::text FROM evidence_assessments a "
        "WHERE engagement_control_id = %s "
        "UNION ALL SELECT 'finding', id::text, status || stale::text || stale_reason "
        "FROM evidence_findings WHERE engagement_control_id = %s "
        "UNION ALL SELECT 'audit', id::text, action FROM audit_events WHERE action = %s "
        "ORDER BY 1, 2",
        UUID(bench.control), UUID(bench.control), ACTION,
    )  # fmt: skip


def _refused(bench: _Bench, sentence: str, hand_over: list[UUID] | None = None, **who: Any) -> None:
    """Asking is refused (409) with this sentence; nothing changed, nothing queued. A run
    already queued is handed to the worker again (`hand_over`), as `rerun` does."""
    before = _records(bench)
    bench.worker.assessments.clear()
    asked = _upgrade(bench, **who)
    assert asked.status_code == 409, asked.text
    assert asked.json()["detail"] == sentence
    assert _records(bench) == before
    assert bench.worker.assessments == (hand_over or [])


def _current(bench: _Bench, item_id: str | None = None) -> list[UUID]:
    return [
        row[0]
        for row in bench.rows(
            "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL",
            UUID(item_id or bench.item_id),
        )
    ]


def _engine_1_of(bench: _Bench, item_id: str, status: str) -> UUID:
    """The engine 1 record of another request of the control."""
    own = bench.item_id
    bench.item_id = item_id
    try:
        return _as_engine_1(bench, status)
    finally:
        bench.item_id = own


def _finding(bench: _Bench, run_id: UUID, attribute_id: UUID, code: str, status: str) -> UUID:
    """A finding of the assurance run, as the chain records one (synthetic)."""
    decided = status != "PROPOSED"
    return UUID(
        str(
            bench.rows(
                """
                INSERT INTO evidence_findings (
                    organization_id, project_id, engagement_control_id, requirement_id,
                    attribute_id, attribute_code, source, kind, fingerprint, title,
                    observation, status, decided_by, decided_at, assessment_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'ASSURANCE', 'NOT_MET', %s,
                        'Attribute not met', 'Synthetic.', %s, %s,
                        CASE WHEN %s THEN clock_timestamp() END, %s)
                RETURNING id
                """,
                bench.team["org"],
                bench.team["project"],
                UUID(bench.control),
                UUID(bench.item_id),
                attribute_id,
                code,
                uuid4().hex + uuid4().hex,
                status,
                bench.team["owner_id"] if decided else None,
                decided,
                run_id,
            )[0][0]  # fmt: skip
        )
    )


def _all_engine_2_readings() -> _Readings:
    said = lambda facts: {"files": _said(*range(len(facts["files"])))}  # noqa: E731
    return _Readings(_engine_2(_all_met, said), _engine_2(_all_met, said))


def test_a_reviewed_engine_1_check_is_replaced_by_one_engine_2_run_and_nothing_else_moves(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-ok")
    bench.add("ticket REQ-1041.txt", TICKET)
    other = str(bench.items[1]["id"])
    bench.link_all(other)
    bench.add("sap change log.txt", LOG, bench.item(other))
    bench.read_next(_reading("walkthrough"), _reading("change_history"))
    legacy = _as_engine_1(bench, "READY")
    elsewhere = _engine_1_of(bench, other, "READY")
    [(first, second)] = [
        tuple(
            row[0]
            for row in bench.rows(
                "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' ORDER BY position, created_at LIMIT 2",
                UUID(bench.control),
            )
        )
    ]
    open_one = _finding(bench, legacy, first, "A", "PROPOSED")
    decided = _finding(bench, legacy, second, "B", "ACCEPTED")
    other_open = _finding(bench, elsewhere, first, "A", "PROPOSED")
    assert bench.entry()["status"] == "REVIEWED" and bench.entry()["engine_version"] == 1
    [(whole,)] = bench.rows(
        "SELECT to_jsonb(a) - 'stale_at' - 'stale_reason' - 'updated_at' "
        "FROM evidence_assessments a WHERE id = %s", legacy,
    )  # fmt: skip
    elsewhere_before = bench.rows(
        "SELECT to_jsonb(a)::text FROM evidence_assessments a WHERE id = %s", elsewhere
    )
    bench.worker.assessments.clear()

    asked = _upgrade(bench)
    assert asked.status_code == 202, asked.text
    entry = asked.json()
    [new] = _current(bench)
    assert new != legacy
    assert (entry["run_id"], entry["status"], entry["engine_version"]) == (
        str(new), "QUEUED", 2,
    )  # fmt: skip
    assert entry["attributes"] == [] and entry["review"] is None
    # The run goes to the worker once, after the commit.
    assert bench.worker.assessments == [new]

    # The earlier run is kept, out of date with the reason, and otherwise as it was.
    [(stale, reason, status, engine)] = bench.rows(
        "SELECT stale_at IS NOT NULL, stale_reason, status, engine_version "
        "FROM evidence_assessments WHERE id = %s", legacy,
    )  # fmt: skip
    assert (stale, reason, status, engine) == (True, chain.UPGRADE_REASON, "READY", 1)
    assert reason == "A person asked for the check again with the current engine."
    assert bench.rows(
        "SELECT to_jsonb(a) - 'stale_at' - 'stale_reason' - 'updated_at' "
        "FROM evidence_assessments a WHERE id = %s", legacy,
    ) == [(whole,)]  # fmt: skip
    # One new run on the current engine, queued; one current run for the request.
    assert bench.rows(
        "SELECT status, engine_version, assessor_prompt_version, requested_by "
        "FROM evidence_assessments WHERE id = %s", new,
    ) == [("PENDING", 2, chain.ASSESSOR_PROMPT_VERSION, bench.team["owner_id"])]  # fmt: skip
    assert [r[0] for r in bench.runs() if not r[2]] == [new]

    # One audit event, the person's, with the run it replaced and the run it queued.
    [(actor, agent, details)] = bench.audit(ACTION, bench.item_id)
    assert (actor, agent) == (bench.team["owner_id"], None)
    assert details == {
        "control_id": bench.control, "from_run": str(legacy), "from_engine": 1,
        "to_runs": [str(new)],
    }  # fmt: skip

    # Findings: the open one is out of date with the run; the person's decision stands.
    states = {
        row[0]: row[1:]
        for row in bench.rows(
            "SELECT id, status, stale, stale_reason FROM evidence_findings "
            "WHERE engagement_control_id = %s",
            UUID(bench.control),
        )  # fmt: skip
    }
    assert states[open_one] == ("PROPOSED", True, chain.UPGRADE_REASON)
    assert states[decided] == ("ACCEPTED", False, "")
    # Another request of the control, with its own engine 1 run, is untouched.
    assert states[other_open] == ("PROPOSED", False, "")
    assert _current(bench, other) == [elsewhere]
    assert (
        bench.rows("SELECT to_jsonb(a)::text FROM evidence_assessments a WHERE id = %s", elsewhere)
        == elsewhere_before
    )
    assert bench.entry(other)["engine_version"] == 1

    # A second ask while it is queued finds a run on the way: one run only (the queued
    # run is handed to the worker again).
    _refused(bench, chain.ALREADY_RUNNING, [new])
    assert _current(bench) == [new]
    # The worker finishes it: the request reads as an engine 2 check, and asking again is
    # refused for that reason, still with one current run.
    assert bench.check(_all_engine_2_readings()) == ["READY"]
    done = bench.entry()
    assert (done["status"], done["engine_version"], done["run_id"]) == ("REVIEWED", 2, str(new))
    assert done["review"] is not None
    _refused(bench, "This request was already checked by the current engine.")
    assert _current(bench) == [new]
    assert len(bench.audit(ACTION, bench.item_id)) == 1
    # After the new check: the finding a person has in hand is never marked stale, closed
    # or dismissed; the new result is attached to its history (attach_assurance_result:
    # a result that supports the attribute proposes ANSWERED, and a person decides). The
    # finding nobody had decided stays out of date.
    [(status, stale)] = bench.rows(
        "SELECT status, stale FROM evidence_findings WHERE id = %s", decided
    )
    assert stale is False and status == "ANSWERED"
    events = bench.rows(
        "SELECT event, status_before, status_after, points_at FROM evidence_finding_events "
        "WHERE finding_id = %s ORDER BY created_at, id",
        decided,
    )
    assert all(e[0] not in ("STALE", "DISMISSED", "RESOLVED") for e in events)
    assert [e[1:3] for e in events if e[0] == "REASSESSED"] == [("ACCEPTED", "ANSWERED")]
    assert [e[3].get("assessment_id") for e in events if e[0] == "REASSESSED"] == [str(new)]
    assert bench.rows(
        "SELECT status, stale, stale_reason FROM evidence_findings WHERE id = %s", open_one
    ) == [("PROPOSED", True, chain.UPGRADE_REASON)]


def test_each_state_that_is_not_a_finished_earlier_check_is_refused_and_changes_nothing(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-guards")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    finished = "Only a finished check can be run again with the current engine."
    assert chain.ONLY_FINISHED_CHECK == finished
    assert chain.ALREADY_RUNNING == "The check is already running."

    # Queued on the current engine (the run the file's reading recorded): handed to the
    # worker again, as `rerun` does.
    assert bench.entry()["status"] == "QUEUED"
    [run_id] = _current(bench)
    _refused(bench, chain.ALREADY_RUNNING, [run_id])
    # Working, on the current engine: a live lease.
    bench.rows(
        "UPDATE evidence_assessments SET status = 'WORKING', claim_token = %s, "
        "lease_until = clock_timestamp() + interval '10 minutes' WHERE id = %s "
        "RETURNING id", uuid4(), run_id,
    )  # fmt: skip
    assert bench.entry()["status"] == "CHECKING"
    _refused(bench, chain.ALREADY_RUNNING)

    # An earlier engine's run that is queued, or working, is not a finished check either.
    legacy = _as_engine_1(bench, "PENDING")
    assert bench.entry()["status"] == "QUEUED"
    _refused(bench, chain.ALREADY_RUNNING, [legacy])
    bench.rows(
        "UPDATE evidence_assessments SET status = 'WORKING', claim_token = %s, "
        "lease_until = clock_timestamp() + interval '10 minutes' WHERE id = %s "
        "RETURNING id", uuid4(), legacy,
    )  # fmt: skip
    _refused(bench, chain.ALREADY_RUNNING)
    # A worker that lost its lease: the run reads as failed, a person checks it again.
    bench.rows(
        "UPDATE evidence_assessments SET lease_until = clock_timestamp() - interval '1 minute' "
        "WHERE id = %s RETURNING id", legacy,
    )  # fmt: skip
    assert bench.entry()["status"] == "FAILED"
    _refused(bench, finished)

    # Failed.
    failed = _as_engine_1(bench, "PENDING")
    bench.rows(
        "UPDATE evidence_assessments SET status = 'FAILED', note = 'The check did not finish.', "
        "finished_at = clock_timestamp() WHERE id = %s RETURNING id", failed,
    )  # fmt: skip
    assert bench.entry()["status"] == "FAILED"
    _refused(bench, finished)

    # Reviewed, but what it read has changed since: the list shows it out of date.
    reviewed = _as_engine_1(bench, "READY")
    attribute = bench.rows(
        "SELECT attribute_id FROM evidence_requirement_attributes WHERE requirement_id = %s "
        "ORDER BY created_at LIMIT 1", UUID(bench.item_id),
    )[0][0]  # fmt: skip
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes "
            "WHERE requirement_id = %s AND attribute_id = %s",
            (UUID(bench.item_id), attribute),
        )
    assert bench.entry()["status"] == "OUT_OF_DATE"
    _refused(bench, finished)
    # Marked out of date, with no run after it: the same.
    with connect(migrated.url) as connection:
        chain._mark_stale(connection.cursor(), reviewed, ["A file was added to this request."])
    assert _current(bench) == [] and bench.entry()["status"] == "OUT_OF_DATE"
    _refused(bench, finished)

    # A request nothing is on, an unknown requirement, one of another control.
    nothing = str(bench.items[1]["id"])
    _refused(bench, chain.NOTHING_TO_CHECK, requirement_id=nothing)
    assert _upgrade(bench, requirement_id=str(uuid4())).status_code == 404
    elsewhere = _control(migrated, bench.team, "ITGC-AC-02")
    assert _upgrade(bench, control_id=elsewhere).status_code == 404
    assert _upgrade(bench, control_id=str(uuid4())).status_code == 404

    # Checked by the current engine, and finished: refused for that.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO evidence_requirement_attributes (requirement_id, attribute_id, "
            "organization_id, project_id, engagement_control_id, origin, created_by) "
            "VALUES (%s, %s, %s, %s, %s, 'PERSON', %s)",
            (UUID(bench.item_id), attribute, bench.team["org"], bench.team["project"],
             UUID(bench.control), bench.team["owner_id"]),
        )  # fmt: skip
    assert bench.rerun().status_code == 202
    assert bench.check(_all_engine_2_readings()) == ["READY"]
    assert bench.entry()["engine_version"] == 2 and bench.entry()["status"] == "REVIEWED"
    _refused(bench, chain.ALREADY_CURRENT_ENGINE)
    assert chain.ALREADY_CURRENT_ENGINE == "This request was already checked by the current engine."


def test_a_held_check_and_a_file_still_being_read_are_refused_and_change_nothing(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-held")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(None)
    assert _as_engine_1(bench, "HELD") is not None
    assert bench.entry()["status"] == "HELD"
    _refused(bench, chain.ONLY_FINISHED_CHECK)
    # A file of the request is still being read: the check starts once it has been read.
    bench.add("sap change log.txt", LOG)
    _refused(bench, chain.STILL_READING)
    assert chain.STILL_READING == (
        "A file on this request is still being read. The check starts once it has been read."
    )


def _padded(title: str, lines: int) -> str:
    """A long synthetic text file (each line distinct), under one file's own bound."""
    return (
        title
        + "\n"
        + "".join(
            f"{title} line {index:05d}: user U{index:05d} access reviewed, no change.\n"
            for index in range(lines)
        )
    )


def test_a_hold_by_the_current_engines_gate_is_refused_with_its_sentence(
    migrated: Database,
) -> None:
    # Engine 1 left out two files whose kind the reader was not sure of, and checked the
    # one it was sure of. Engine 2 reads files of an unsure kind, and the three together
    # are longer than one reading takes: its gate holds the request (TOO_LARGE).
    bench = _Bench(migrated, "up-large")
    bench.add("ticket REQ-1041.txt", TICKET + _padded("Ticket appendix", 2000))
    bench.add("access listing one.txt", _padded("Listing one", 2400))
    bench.add("access listing two.txt", _padded("Listing two", 2400))
    bench.read_next(
        _reading("walkthrough"),
        _reading("walkthrough", confidence="low"),
        _reading("walkthrough", confidence="low"),
    )
    legacy = _as_engine_1(bench, "READY")
    assert bench.entry()["status"] == "REVIEWED" and bench.entry()["engine_version"] == 1
    with connect(migrated.url) as connection:
        request = next(
            item
            for item in chain._requests(
                connection, UUID(str(bench.team["project"])), UUID(bench.control)
            )
            if item.requirement_id == UUID(bench.item_id)
        )
        attributes = len(chain._approved(connection, UUID(bench.control)))
    assert chain._gate_of(request, attributes, 1) is None
    held = chain._gate_of(request, attributes)
    assert held is not None and held.code == "TOO_LARGE"
    _refused(bench, chain.HELD_REASONS["TOO_LARGE"])
    assert chain.HELD_REASONS["TOO_LARGE"] == (
        "The files on this request are together too long to be read in one check, so a "
        "person reads them. Nothing was cut to make them fit."
    )
    assert _current(bench) == [legacy] and bench.entry()["status"] == "REVIEWED"
    assert bench.audit(ACTION, bench.item_id) == []


def test_a_set_aside_request_is_refused_and_changes_nothing(migrated: Database) -> None:
    bench = _Bench(migrated, "up-aside")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    sentence = "This request is set aside, so it is not checked."
    assert chain.SET_ASIDE == sentence
    requirement = UUID(bench.item_id)

    def change(query: str, *params: Any) -> None:
        with connect(migrated.url) as connection:
            connection.execute(query, params)

    # The D&I phase marked not applicable.
    change(
        "UPDATE evidence_plan_phases SET applicability = 'NOT_APPLICABLE', "
        "rationale = 'Not applicable in the test.' "
        "WHERE (plan_id, phase) = (SELECT plan_id, phase FROM evidence_requirements "
        "WHERE id = %s)",
        requirement,
    )
    _refused(bench, sentence)
    change(
        "UPDATE evidence_plan_phases SET applicability = 'APPLICABLE' "
        "WHERE (plan_id, phase) = (SELECT plan_id, phase FROM evidence_requirements "
        "WHERE id = %s)",
        requirement,
    )
    # The item marked not applicable.
    change(
        "UPDATE evidence_requirements SET status = 'WAIVED', waive_reason = %s, "
        "waived_by = %s, waived_at = clock_timestamp() WHERE id = %s",
        "Not needed for this control in the test.", bench.team["owner_id"], requirement,
    )  # fmt: skip
    _refused(bench, sentence)
    change(
        "UPDATE evidence_requirements SET status = 'REQUESTED', waive_reason = '', "
        "waived_by = NULL, waived_at = NULL WHERE id = %s",
        requirement,
    )
    # Its request cancelled.
    change(
        "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = 'Test', "
        "received_at = NULL "
        "WHERE id = (SELECT pbc_request_id FROM evidence_requirements WHERE id = %s)",
        requirement,
    )
    _refused(bench, sentence)
    assert _current(bench) == [legacy] and bench.audit(ACTION, bench.item_id) == []


def test_an_ask_that_waited_on_another_finds_its_run_and_queues_nothing(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-race")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    project, control = UUID(str(bench.team["project"])), UUID(bench.control)
    requirement, owner = UUID(bench.item_id), bench.team["owner_id"]
    outcome: dict[str, Any] = {}

    def second() -> None:
        with connect(migrated.url) as connection:
            try:
                outcome["queued"] = chain.upgrade_engine(
                    connection, project, control, requirement, owner
                )
            except chain.AssuranceState as error:
                outcome["refused"] = error

    with connect(migrated.url) as first:
        with first.transaction():
            [queued] = chain.upgrade_engine(first, project, control, requirement, owner)
            waiting = threading.Thread(target=second)
            waiting.start()
            # The second ask waits on the run's lock until the first commits.
            for _ in range(200):
                if bench.rows(
                    "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' "
                    "AND datname = current_database() AND query LIKE %s",
                    "%FROM evidence_assessments%FOR UPDATE%",
                ):
                    break
                time.sleep(0.05)
            else:
                raise AssertionError("the second ask never waited on the lock")
        first.commit()
    waiting.join(timeout=30)
    refused = outcome.get("refused")
    assert isinstance(refused, chain.AssuranceState), outcome
    assert refused.detail == chain.ALREADY_RUNNING and refused.hand_over == [queued]
    assert _current(bench) == [queued] and queued != legacy
    assert len(bench.audit(ACTION, bench.item_id)) == 1


def test_an_agent_is_refused(migrated: Database, monkeypatch: pytest.MonkeyPatch) -> None:
    bench = _Bench(migrated, "up-agent")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    before = _records(bench)
    # The route takes its principal from the session, which is always a person's; an
    # agent principal reaching it is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    monkeypatch.setattr(chain, "_session_principal", lambda _request: agent)
    asked = _upgrade(bench)
    assert asked.status_code in (403, 404), asked.text
    assert _records(bench) == before and _current(bench) == [legacy]
    assert bench.worker.assessments == []


def test_an_archived_engagement_refuses_the_ask_as_it_refuses_a_rerun(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-closed")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    before = _records(bench)
    # Completing an engagement is its own recorded action (engagement_close); the
    # middleware refuses a completed one by the same rule (CLOSED) as an archived one.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    # The closed-engagement middleware refuses every change, this ask as a rerun.
    for asked in (_upgrade(bench), bench.rerun()):
        assert asked.status_code == 409, asked.text
        assert asked.json()["detail"] == closed_detail("ARCHIVED")
    assert _records(bench) == before and _current(bench) == [legacy]
    assert bench.worker.assessments == []


def test_a_run_that_could_not_be_queued_rolls_back_and_the_earlier_check_stays(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    bench = _Bench(migrated, "up-gate")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    # Where nothing is queued (the current engine's gate held the request, or another
    # request recorded the run first), the earlier run must not be left marked out of date
    # with no run after it: the whole transaction is undone.
    monkeypatch.setattr(chain, "reconcile", lambda *args, **kwargs: chain.Reconciled([], set()))
    _refused(bench, chain.UPGRADE_NOT_QUEUED)
    assert _current(bench) == [legacy]
    assert bench.entry()["status"] == "REVIEWED"


def test_only_a_person_who_may_decide_evidence_can_ask(migrated: Database) -> None:
    bench = _Bench(migrated, "up-roles")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    before = _records(bench)
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert _upgrade(bench, reviewer).status_code == 403
    # Another firm's person: not found. No session: not signed in.
    outsider = _Bench(migrated, "up-roles-b").client
    assert _upgrade(bench, outsider).status_code == 404
    anonymous = TestClient(bench.owner.app)
    assert _upgrade(bench, anonymous).status_code == 401
    # Nothing any of them asked changed the run on record.
    assert _records(bench) == before and _current(bench) == [legacy]
    assert bench.worker.assessments == [] and bench.audit(ACTION, bench.item_id) == []
    # The person with the right asks and it is done.
    assert _upgrade(bench).status_code == 202


def test_asking_to_run_again_is_unchanged_for_a_reviewed_engine_1_check(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "up-rerun")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    before = _records(bench)
    asked = bench.rerun()
    # The same basis is never run twice: the run on record is returned, nothing is queued
    # and nothing is marked out of date.
    assert asked.status_code == 202, asked.text
    assert (asked.json()["run_id"], asked.json()["status"]) == (str(legacy), "REVIEWED")
    assert asked.json()["engine_version"] == 1
    assert _records(bench) == before
    assert _current(bench) == [legacy] and len(bench.runs()) == 2
    assert bench.worker.assessments == []
    assert bench.audit(ACTION, bench.item_id) == []
