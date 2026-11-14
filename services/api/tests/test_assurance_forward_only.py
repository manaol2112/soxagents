"""Engine 2 of the evidence assurance chain is forward only (docs/evidence-assurance.md,
section 10.1; the product owner, 14 November 2026: "Do not review previously uploaded
client evidence ... Do not reopen historical findings ... Historical records must remain
accessible and unchanged").

A run recorded under engine 1 is compared with what is in force as engine 1 reads it (its
gate, its hash inputs, its /5 prompt versions): the new engine alone marks nothing out of
date and queues nothing. Only an event that already records a run (a file added, a kind
confirmed) replaces it, and the new run is an engine 2 run. Synthetic evidence only.
"""

from typing import Any
from uuid import UUID

from support import Database
from test_evidence_assurance import LOG, TICKET, _Bench, _reading
from test_outbound import migrated

from ai_workforce_api import evidence_assurance as chain
from ai_workforce_api.db import connect, transaction

__all__ = ["migrated"]


def _as_engine_1(bench: _Bench, status: str) -> UUID:
    """Put the requirement's record as engine 1 left it: its current run recorded under
    engine 1 (that engine's gate, hash and prompt versions), HELD where its gate held the
    files, else with the given status. Returns the run."""
    project, control_id = UUID(str(bench.team["project"])), UUID(bench.control)
    with connect(bench.database.url) as connection:
        control = chain._control(connection, project, control_id)
        assert control is not None
        request = next(
            item
            for item in chain._requests(connection, project, control_id)
            if item.requirement_id == UUID(bench.item_id)
        )
        attributes = chain._approved(connection, control_id)
        basis = chain._basis(
            request, control, attributes, chain._linked(connection, control_id), engine=1
        )
        held = chain._gate_of(request, len(attributes), 1)
        with transaction(connection) as cursor:
            for (run_id,) in cursor.execute(
                "SELECT id FROM evidence_assessments WHERE requirement_id = %s "
                "AND stale_at IS NULL",
                (UUID(bench.item_id),),
            ).fetchall():
                chain._mark_stale(cursor, run_id, ["Replaced by the test's engine 1 run."])
            made = chain._insert(
                cursor, control, project, control_id, request, basis, held,
                bench.team["owner_id"],
            )  # fmt: skip
            assert made is not None
            if held is None and status == "READY":
                # As a finished engine 1 run stands: reviewed, with its outcome on record.
                cursor.execute(
                    "UPDATE evidence_assessments SET status = 'READY', stage = 'DONE', "
                    "finished_at = clock_timestamp(), ran_with = %s::jsonb, "
                    "assessor_opinion = '{}'::jsonb, reviewer_opinion = '{}'::jsonb "
                    "WHERE id = %s",
                    (chain.Json(basis.models), made[0]),
                )
        bench.worker.assessments.clear()
        return made[0]


def _record(bench: _Bench, run_id: UUID) -> tuple[Any, ...]:
    [row] = bench.rows(
        "SELECT status, stale_at IS NOT NULL, engine_version, assessor_prompt_version, "
        "held_code, stale_reason FROM evidence_assessments WHERE id = %s",
        run_id,
    )
    return tuple(row)


def test_an_engine_1_hash_is_what_it_always_was() -> None:
    # The very formula engine 1 runs were recorded with: their stored hashes still match.
    basis = chain._Basis(
        files=(
            {"sha256": "a", "file_id": "f", "text_sha256": "t", "kind": "walkthrough",
             "truncated": False, "held": None},
        ),
        file_ids=(), control_sha256="c", attributes_sha256="s", attribute_ids=(),
        linked_attribute_ids=(), elsewhere_attribute_ids=(), lens="INSTANCE_RECORD",
        read_in_part=False, models={"tier": "BALANCED"}, engine=1,
    )  # fmt: skip
    assert basis.sha256 == chain._sha(
        [
            [["a", "f", "t", "walkthrough", False, ""]],
            "c", "s", [], [], "INSTANCE_RECORD",
            "evidence-assurance-assessor/5", "evidence-assurance-reviewer/5",
            {"tier": "BALANCED"},
        ]
    )  # fmt: skip
    newer = chain._Basis(**{**basis.__dict__, "engine": 2, "context_sha256": "x"})
    assert newer.sha256 != basis.sha256
    assert chain.ENGINE_PROMPTS[1] == (
        "evidence-assurance-assessor/5", "evidence-assurance-reviewer/5",
    )  # fmt: skip


def test_a_reviewed_engine_1_run_stays_current_until_new_evidence_arrives(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "fwd-ready")
    bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    legacy = _as_engine_1(bench, "READY")
    assert _record(bench, legacy)[:4] == (
        "READY", False, 1, "evidence-assurance-assessor/5",
    )  # fmt: skip
    # The release alone: what a route does after any change to the control, the start-up
    # backfill, and reading the list. Nothing is out of date and nothing is queued.
    assert bench.follow() == []
    with connect(migrated.url) as connection:
        assert chain.backfill(connection) == []
    assert _record(bench, legacy)[:3] == ("READY", False, 1)
    entry = bench.entry()
    assert entry["status"] == "REVIEWED" and entry["out_of_date"] == []
    assert [r[0] for r in bench.runs() if not r[2]] == [legacy]

    # New evidence is an event that records a run: the engine 1 run goes out of date for
    # that reason (never "the instructions were updated"), and the new run is engine 2.
    bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    status, stale, engine, _prompt, _held, why = _record(bench, legacy)
    assert (status, stale, engine) == ("READY", True, 1)
    assert why == "A file was added to this request."
    [current] = [r for r in bench.runs() if not r[2]]
    assert _record(bench, current[0])[:4] == (
        "PENDING", False, 2, chain.ASSESSOR_PROMPT_VERSION,
    )  # fmt: skip


def test_an_engine_1_run_held_for_an_unsure_kind_stays_held_until_a_person_acts(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "fwd-held")
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    # Read by the rules: engine 1 held the file (its kind is not sure); engine 2 reads it.
    bench.read_next(None)
    legacy = _as_engine_1(bench, "HELD")
    assert _record(bench, legacy)[:5] == (
        "HELD", False, 1, "evidence-assurance-assessor/5", "KIND_UNSURE",
    )  # fmt: skip
    # Engine 2's gate would read the file. That alone never replaces the engine 1 run.
    assert bench.follow() == []
    with connect(migrated.url) as connection:
        assert chain.backfill(connection) == []
    assert _record(bench, legacy)[:3] == ("HELD", False, 1)
    assert bench.entry()["status"] == "HELD"

    # The person confirms the kind: the event records the new run, under engine 2.
    assert bench.confirm(ticket, "walkthrough").status_code == 200
    assert _record(bench, legacy)[1] is True
    [current] = [r for r in bench.runs() if not r[2]]
    assert _record(bench, current[0])[:3] == ("PENDING", False, 2)
