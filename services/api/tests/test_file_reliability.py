"""A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14,
part B; migration 0163), through its routes, with scripted readings and synthetic files
only: no model, no client evidence.

Audit integrity (critical tier):

- each kind is recorded on a finished, current check for a file whose reliability the
  check leaves not established, read back on the request's entry with who, when, the
  reason and what was relied on, and is one audit event with the person as its actor;
- recording and reopening change nothing of what the check found: the run and its review,
  its findings, the annotations, the request, its acceptance and its messages are row for
  row what they were;
- one decision stands per request and file: recording another keeps the earlier one as
  REPLACED, a person reopens one with a reason, nothing is deleted or rewritten (the table
  refuses it), and the history is given newest first;
- every refusal is 409 with one plain sentence and changes nothing: no finished, current
  check (never checked, queued, working, stopped, failed, held, out of date), a file not in
  force on the request, a file the check raises no reliability question on, a reason or
  what was relied on out of bounds, a stale page (what stands is not the decision the
  person saw, named by its id);
- a later check never ends a decision; withdrawing or replacing the file is refused while
  a decision stands on it (E1, 18 November 2026: before, that act ended it as FILE_GONE);
  reopened first, the file can leave, and restoring it does not bring the decision back;
  a file out of force by a record from before E1 still ends its decision as FILE_GONE,
  naming nobody, when the chain next follows the control (test_evidence_reliance);
- the workpaper: a file established on review counts as reliable for the tickmark, a
  procedure says so, and the check's own sentence about it no longer waits; a file not
  relied on is said so in the evidence index, what rests only on it carries no mark and is
  a point (section 3.9; it was an open matter); each decision is said on the file's line
  (it was a noted matter);
- only a person who may decide evidence records or reopens: a Reviewer is refused, another
  firm finds nothing, an agent is refused, and an archived engagement is read-only.
"""

from collections.abc import Callable
from functools import partial
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_assurance_engine2 import _engine_2
from test_attribute_dispositions import UNTOUCHED, _plan
from test_evidence_assurance import LOG, TICKET, _Bench, _reading, _Readings
from test_outbound import migrated

from ai_workforce_api import evidence_assurance as chain
from ai_workforce_api import file_reliability as reliability
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.engagement_close import closed_detail

__all__ = ["migrated"]

REASON = "The owner ran the report with me and I inspected its parameters."
RELIED = "Watched the export run in the system on 3 March 2026 with all users selected."
EVENTS = "evidence.file_reliability%"
NOT_SHOWN = (
    "{name} is a report or listing that does not show its source, run date or parameters, "
    "so its completeness and accuracy are not established."
)
DECISION_KEYS = {"id", "kind", "reason", "relied_on", "recorded_by_name", "recorded_at"}
ENDED_KEYS = DECISION_KEYS | {"ended_at", "ended_by_name", "ended_as", "ended_reason"}
# What a decision leaves row for row as it was (attribute_dispositions' list, and the
# dispositions themselves).
KEPT = (*UNTOUCHED, "attribute_dispositions")


def _files_said(*reports: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """What both readings say of each file: a system's own record, and for the files named
    a report that does not show its source, run date or parameters."""

    def said(facts: dict[str, Any]) -> dict[str, Any]:
        return {
            "files": [
                {"file": index, "relevance": "RELEVANT", "source": "SYSTEM_RECORD",
                 "legibility": "CLEAR",
                 "report_basis": "NOT_SHOWN" if file["name"] in reports else "NOT_A_REPORT"}
                for index, file in enumerate(facts["files"])
            ]
        }  # fmt: skip

    return said


def _check(bench: _Bench, *reports: str, **how: str) -> dict[str, Any]:
    """The worker finishes the queued check: every attribute shown by the ticket's approval
    line unless `how` says otherwise; the files named in `reports` read as reports that do
    not show their basis. The request's entry."""
    reading = _engine_2(_plan(**how), _files_said(*reports))
    assert bench.check(_Readings(reading, reading)) == ["READY"]
    entry = bench.entry()
    assert entry["status"] == "REVIEWED"
    return entry


def _first_check(bench: _Bench, **how: str) -> tuple[str, dict[str, Any]]:
    """The ticket on the request, read and checked as a report that does not show its
    basis: the file and the request's entry."""
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    return ticket, _check(bench, "ticket REQ-1041.txt", **how)


def _url(bench: _Bench, file_id: str, tail: str = "", requirement_id: str | None = None) -> str:
    return (
        f"{bench.base}/controls/{bench.control}/evidence-assurance/"
        f"{requirement_id or bench.item_id}/files/{file_id}/reliability{tail}"
    )


def _record(
    bench: _Bench,
    file_id: str,
    kind: str,
    client: TestClient | None = None,
    **body: Any,
) -> Any:
    where = {key: body.pop(key) for key in ("requirement_id",) if key in body}
    sent: dict[str, Any] = {"kind": kind, "reason": REASON, "replaces": None}
    if kind == "ESTABLISHED_ON_REVIEW":
        sent["relied_on"] = RELIED
    return (client or bench.owner).post(_url(bench, file_id, **where), json=sent | body)


def _reopen(
    bench: _Bench,
    file_id: str,
    decision_id: str,
    client: TestClient | None = None,
    reason: str = "Recorded on the wrong file.",
) -> Any:
    return (client or bench.owner).post(
        _url(bench, file_id, "/reopen"), json={"id": decision_id, "reason": reason}
    )


def _rows(bench: _Bench) -> list[dict[str, Any]]:
    """Every decision on record, oldest first."""
    return [
        row[0]
        for row in bench.rows(
            "SELECT to_jsonb(d) FROM file_reliability_decisions d ORDER BY recorded_at, id"
        )
    ]


def _kept(bench: _Bench) -> dict[str, list[str]]:
    return {
        table: [
            str(row[0])
            for row in bench.rows(f"SELECT to_jsonb(t)::text FROM {table} t ORDER BY 1")  # noqa: S608
        ]
        for table in KEPT
    }


def _state(bench: _Bench) -> tuple[Any, ...]:
    """Everything a refusal must leave as it was."""
    events = bench.rows(
        "SELECT id::text, action FROM audit_events WHERE action LIKE %s ORDER BY 1", EVENTS
    )
    return ([str(row) for row in _rows(bench)], events, _kept(bench))


def _refused(bench: _Bench, sentence: str, asked: Callable[[], Any]) -> None:
    """The ask is refused (409) with this one sentence, and nothing changed."""
    before = _state(bench)
    queued = list(bench.worker.assessments)
    answer = asked()
    assert answer.status_code == 409, answer.text
    assert answer.json()["detail"] == sentence
    assert _state(bench) == before
    assert bench.worker.assessments == queued


def _on(entry: dict[str, Any], file_id: str) -> dict[str, Any]:
    return next(item for item in entry["file_reliability"] if item["file_id"] == file_id)


def _paper(bench: _Bench) -> dict[str, Any]:
    found = bench.owner.get(f"{bench.base}/controls/{bench.control}/design-workpaper")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def test_each_kind_is_recorded_read_back_replaced_and_reopened_and_the_check_stays(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "fr-flow")
    ticket, first = _first_check(bench)
    owner, owner_name = bench.team["owner_id"], bench.name(bench.team["owner_id"])
    question = NOT_SHOWN.format(name="ticket REQ-1041.txt")
    # The check's own sentence, beside its unchanged review.
    assert first["review"]["completeness"]["state"] == "RELIABILITY_UNRESOLVED"
    assert question in first["review"]["completeness"]["reasons"]
    assert first["file_reliability"] == [
        {"file_id": ticket, "question": question, "decision": None, "history": []}
    ]
    before = _kept(bench)

    # Established on the person's review, with what they relied on.
    done = _record(bench, ticket, "ESTABLISHED_ON_REVIEW")
    assert done.status_code == 200, done.text
    entry = done.json()
    [item] = entry["file_reliability"]
    assert (item["file_id"], item["question"], item["history"]) == (ticket, question, [])
    decision = item["decision"]
    assert set(decision) == DECISION_KEYS
    assert (decision["kind"], decision["reason"], decision["relied_on"]) == (
        "ESTABLISHED_ON_REVIEW", REASON, RELIED,
    )  # fmt: skip
    assert decision["recorded_by_name"] == owner_name
    # Nothing of what the check found changed: the run, its review and the rest.
    assert _kept(bench) == before
    assert {k: v for k, v in entry.items() if k != "file_reliability"} == {
        k: v for k, v in first.items() if k != "file_reliability"
    }
    assert bench.entry() == entry
    [(actor, agent, event)] = bench.audit(reliability.RECORDED, bench.item_id)
    assert (actor, agent) == (owner, None)
    assert event == {
        "control_id": bench.control, "file_id": ticket, "decision_id": decision["id"],
        "kind": "ESTABLISHED_ON_REVIEW", "reason": REASON, "relied_on": RELIED,
        "assessment_id": first["run_id"], "replaced": None, "replaced_kind": None,
    }  # fmt: skip
    [row] = _rows(bench)
    assert (row["assessment_id"], row["version"], row["ended_at"]) == (first["run_id"], 1, None)

    # The workpaper: the report counts as reliable, a procedure says so, and the check's
    # sentence no longer waits. Rewritten for section 3.9 (16 November 2026). Old: the
    # decision was a NOTED DISPOSITION matter ("ticket REQ-1041.txt: “Reliability
    # established on the auditor's review”, recorded by ..."). New: it is no point; the
    # file's line in the evidence index says it (as section 5's row naming the file does),
    # and the check's question is no longer a point. Why: each item at its place.
    paper = _paper(bench)
    assert {a["code"]: a["tickmark"] for a in paper["attributes"]}["A"] in ("AGREED", "COMPARED")
    assert "Established the reliability of 1 report on review, as recorded." in paper["procedures"]
    assert question not in [p["text"] for p in paper["points"]]
    [on_index] = [e for e in paper["evidence"] if e["file_id"] == ticket]
    assert on_index["established"].startswith(
        f"Reliability established on review by {owner_name} on "
    )
    assert f"Relied on: {RELIED}" in on_index["established"]
    assert "INSPECTED" in [t["mark"] for t in paper["tickmarks"]]

    # Replaced by "Not relied on", naming the one the person saw.
    changed = _record(bench, ticket, "NOT_RELIED_ON", replaces=decision["id"])
    assert changed.status_code == 200, changed.text
    item = _on(changed.json(), ticket)
    assert item["decision"]["kind"] == "NOT_RELIED_ON" and item["decision"]["relied_on"] == ""
    [ended] = item["history"]
    assert set(ended) == ENDED_KEYS
    assert (ended["id"], ended["ended_as"], ended["ended_by_name"]) == (
        decision["id"], "REPLACED", owner_name,
    )  # fmt: skip
    assert bench.audit(reliability.RECORDED, bench.item_id)[-1][2]["replaced"] == decision["id"]
    # The workpaper: what rests only on the ticket carries no mark and waits on a person;
    # the evidence index says the file is not relied on.
    paper = _paper(bench)
    assert {a["tickmark"] for a in paper["attributes"]} == {"NONE"}
    assert {a["code"]: a["state"] for a in paper["attributes"]}["A"] == "SHOWN"
    [entry_e1] = [e for e in paper["evidence"] if e["file_id"] == ticket]
    assert entry_e1["not_relied_on"].startswith("Not relied on, recorded by ")
    assert entry_e1["established"] == ""
    # Section 3.9: old, an OPEN matter; new, a NOT_RELIED point at attribute A's row,
    # settled by a decision on the file (or a consideration).
    [resting] = [
        p for p in paper["points"]
        # Reworded 19 November 2026 (D3): old "is shown only on a file not relied on",
        # new "rests on a file not relied on" (a showing that rests on it in any part).
        if p["text"].startswith("Attribute A rests on a file not")
    ]  # fmt: skip
    assert (resting["kind"], resting["settle"]) == ("NOT_RELIED", ["RELIABILITY", "CONSIDER"])
    assert resting["place"]["at"] == "ATTRIBUTE"

    # Reopened, naming the one the person saw: nothing stands, both are kept.
    reopened = _reopen(bench, ticket, item["decision"]["id"])
    assert reopened.status_code == 200, reopened.text
    item = _on(reopened.json(), ticket)
    assert item["decision"] is None and item["question"] == question
    assert [(h["ended_as"], h["ended_reason"]) for h in item["history"]] == [
        ("REOPENED", "Recorded on the wrong file."), ("REPLACED", ""),
    ]  # fmt: skip
    [(actor, _agent, event)] = bench.audit(reliability.REOPENED, bench.item_id)
    assert actor == owner and event["kind"] == "NOT_RELIED_ON"
    assert _kept(bench) == before
    assert [(r["kind"], r["ended_as"], r["version"]) for r in _rows(bench)] == [
        ("ESTABLISHED_ON_REVIEW", "REPLACED", 2), ("NOT_RELIED_ON", "REOPENED", 2),
    ]  # fmt: skip
    # Section 3.9: old, no DISPOSITION matter; new, the file's line says no decision, and
    # the check's question waits again as a point at the file.
    reread = _paper(bench)
    [line] = [e for e in reread["evidence"] if e["file_id"] == ticket]
    assert (line["established"], line["not_relied_on"]) == ("", None)
    assert question in [p["text"] for p in reread["points"] if p["kind"] == "COMPLETENESS"]

    # The table keeps every decision as written: never rewritten, never deleted, ended once.
    with connect(migrated.url) as connection:
        for statement, match in (
            ("UPDATE file_reliability_decisions SET reason = 'Another reason entirely.'",
             "never changed"),
            ("DELETE FROM file_reliability_decisions", "never deleted"),
        ):  # fmt: skip
            with pytest.raises(psycopg.errors.RaiseException, match=match):
                connection.execute(statement)
            connection.rollback()
    standing = _record(bench, ticket, "NOT_RELIED_ON")
    assert standing.status_code == 200, standing.text
    with connect(migrated.url) as connection:
        for statement, match in (
            ("UPDATE file_reliability_decisions SET kind = 'ESTABLISHED_ON_REVIEW', "
             "relied_on = 'The owner confirmed it.' WHERE ended_at IS NULL", "never changes"),
            ("UPDATE file_reliability_decisions SET ended_reason = 'x' WHERE ended_at IS NULL",
             "only by ending"),
        ):  # fmt: skip
            with pytest.raises(psycopg.errors.RaiseException, match=match):
                connection.execute(statement)
            connection.rollback()
        # One stands per request and file.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                "INSERT INTO file_reliability_decisions (organization_id, project_id, "
                "engagement_control_id, requirement_id, evidence_file_id, kind, reason, "
                "assessment_id, recorded_by) SELECT organization_id, project_id, "
                "engagement_control_id, requirement_id, evidence_file_id, kind, reason, "
                "assessment_id, recorded_by FROM file_reliability_decisions "
                "WHERE ended_at IS NULL"
            )
        connection.rollback()
        # Established on review always says what was relied on.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO file_reliability_decisions (organization_id, project_id, "
                "engagement_control_id, requirement_id, evidence_file_id, kind, reason, "
                "assessment_id, recorded_by) SELECT organization_id, project_id, "
                "engagement_control_id, requirement_id, evidence_file_id, "
                "'ESTABLISHED_ON_REVIEW', reason, assessment_id, recorded_by "
                "FROM file_reliability_decisions LIMIT 1"
            )


def test_every_state_without_a_finished_current_check_is_refused_and_changes_nothing(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "fr-states")

    def ask(file_id: str) -> Callable[[], Any]:
        return lambda: _record(bench, file_id, "NOT_RELIED_ON")

    def reads(status: str) -> None:
        assert bench.entry()["status"] == status

    # Never checked: no file is on the request.
    _refused(bench, reliability.NOT_CHECKED, ask(str(uuid4())))
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    # A file still being read: its check has not started.
    _refused(bench, reliability.NOT_CHECKED, ask(ticket))
    bench.read_next(_reading("walkthrough"))
    reads("QUEUED")
    assert bench.entry()["file_reliability"] == []
    [(run_id,)] = bench.rows(
        "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL",
        UUID(bench.item_id),
    )
    _refused(bench, reliability.STILL_CHECKING, ask(ticket))
    bench.rows(
        "UPDATE evidence_assessments SET status = 'WORKING', claim_token = %s, "
        "lease_until = clock_timestamp() + interval '10 minutes' WHERE id = %s RETURNING id",
        uuid4(), run_id,
    )  # fmt: skip
    reads("CHECKING")
    _refused(bench, reliability.STILL_CHECKING, ask(ticket))
    # Its worker lost the lease: it reads as failed.
    bench.rows(
        "UPDATE evidence_assessments SET lease_until = clock_timestamp() - interval '1 minute' "
        "WHERE id = %s RETURNING id", run_id,
    )  # fmt: skip
    reads("FAILED")
    _refused(bench, reliability.CHECK_FAILED, ask(ticket))
    bench.rows(
        "UPDATE evidence_assessments SET status = 'FAILED', lease_until = NULL, "
        "note = 'The check did not finish.', finished_at = clock_timestamp() "
        "WHERE id = %s RETURNING id", run_id,
    )  # fmt: skip
    reads("FAILED")
    _refused(bench, reliability.CHECK_FAILED, ask(ticket))
    # Held whole by its gate.
    assert bench.rerun().status_code == 202
    bench.worker.assessments.clear()
    [(held_id,)] = bench.rows(
        "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL",
        UUID(bench.item_id),
    )
    bench.rows(
        "UPDATE evidence_assessments SET status = 'HELD', held_code = 'TOO_LARGE', "
        "held_reason = 'The files are together too long.', file_ids = '{}', "
        "finished_at = clock_timestamp() WHERE id = %s RETURNING id", held_id,
    )  # fmt: skip
    reads("HELD")
    _refused(bench, reliability.CHECK_HELD, ask(ticket))
    # Marked out of date, with no run after it.
    with connect(migrated.url) as connection:
        chain._mark_stale(connection.cursor(), held_id, ["A file was added to this request."])
    reads("OUT_OF_DATE")
    _refused(bench, reliability.CHECK_OUT_OF_DATE, ask(ticket))
    # Checked and finished: recorded.
    assert bench.rerun().status_code == 202
    bench.worker.assessments.clear()
    entry = _check(bench, "ticket REQ-1041.txt")
    assert ask(ticket)().status_code == 200
    # What it read has changed since, and nothing marked it yet: out of date all the same,
    # and nothing of the request is given, the decision included.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
            "AND attribute_id = %s",
            (UUID(bench.item_id), UUID(entry["attributes"][-1]["attribute_id"])),
        )
    reads("OUT_OF_DATE")
    assert bench.entry()["file_reliability"] == []
    [decided] = _rows(bench)
    _refused(
        bench, reliability.CHECK_OUT_OF_DATE,
        lambda: _record(bench, ticket, "NOT_RELIED_ON", replaces=decided["id"]),
    )  # fmt: skip
    # The record is kept, and stands again once a check of the request finishes: a later
    # check never ends a decision.
    assert bench.rerun().status_code == 202
    again = _check(bench, "ticket REQ-1041.txt")
    assert _on(again, ticket)["decision"]["id"] == decided["id"]
    assert [r["ended_at"] for r in _rows(bench)] == [None]


def test_each_refusal_on_a_finished_check_is_one_sentence_and_changes_nothing(
    migrated: Database,
) -> None:
    outside = _Bench(migrated, "fr-refusals-b")
    outside_file, _outside_entry = _first_check(outside)
    bench = _Bench(migrated, "fr-refusals")
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("walkthrough"), _reading("change_history"))
    # The ticket is a report that does not show its basis; the log a system's own record.
    entry = _check(bench, "ticket REQ-1041.txt")
    assert [item["file_id"] for item in entry["file_reliability"]] == [ticket]

    def asking(file_id: str, kind: str = "NOT_RELIED_ON", **body: Any) -> Callable[[], Any]:
        return lambda: _record(bench, file_id, kind, **body)

    # A file not in force on the request: unknown, another firm's, or of the request's own
    # engagement but not on this request.
    other = bench.add("sap change log 2.txt", LOG, bench.item(str(bench.items[1]["id"])))
    for file_id in (str(uuid4()), outside_file, other):
        _refused(bench, reliability.FILE_NOT_IN_FORCE, asking(file_id))
    # The check raises no question about the log's reliability.
    _refused(bench, reliability.NO_QUESTION, asking(log))
    _refused(bench, reliability.NO_QUESTION, asking(log, "ESTABLISHED_ON_REVIEW"))
    # The reason: always given, in a sentence, and bounded.
    for reason in ("", "   ", "Too short", "x" * 9):
        _refused(bench, reliability.REASON_TOO_SHORT, asking(ticket, reason=reason))
    _refused(bench, reliability.REASON_TOO_LONG, asking(ticket, reason="x" * 1001))
    # What was relied on: required to establish, bounded, and never kept otherwise.
    for relied in (None, "", "   ", "x" * 9):
        _refused(
            bench, reliability.RELIED_ON_NEEDED,
            asking(ticket, "ESTABLISHED_ON_REVIEW", relied_on=relied),
        )  # fmt: skip
    _refused(
        bench, reliability.RELIED_ON_TOO_LONG,
        asking(ticket, "ESTABLISHED_ON_REVIEW", relied_on="x" * 601),
    )  # fmt: skip
    _refused(bench, reliability.RELIED_ON_NOT_TAKEN, asking(ticket, relied_on=RELIED))
    # A body that is not the contract's is not read at all.
    for body in (
        {"kind": "NOT_RELIED_ON", "reason": REASON},
        {"kind": "NOT_RELIED_ON", "reason": REASON, "replaces": None, "status": "CLOSED"},
        {"kind": "TRUSTED", "reason": REASON, "replaces": None},
    ):
        before = _state(bench)
        assert bench.owner.post(_url(bench, ticket), json=body).status_code == 422
        assert _state(bench) == before
    # Nothing stands: reopening refused; a page that saw one that is no longer there too.
    _refused(bench, reliability.NOTHING_STANDS, lambda: _reopen(bench, ticket, str(uuid4())))
    _refused(bench, reliability.STALE, asking(ticket, replaces=str(uuid4())))
    # One stands: a page that saw none, or another, is stale.
    done = _record(bench, ticket, "NOT_RELIED_ON")
    assert done.status_code == 200, done.text
    standing = _on(done.json(), ticket)["decision"]["id"]
    _refused(bench, reliability.RECORDED_SINCE, asking(ticket))
    _refused(bench, reliability.RECORDED_SINCE, asking(ticket, replaces=str(uuid4())))
    _refused(bench, reliability.STALE, lambda: _reopen(bench, ticket, str(uuid4())))
    for reason in ("", "Too short"):
        _refused(
            bench, reliability.REASON_TOO_SHORT,
            partial(_reopen, bench, ticket, standing, reason=reason),
        )  # fmt: skip
    # Another firm's request, through this firm's control: not found.
    assert _record(bench, outside_file, "NOT_RELIED_ON",
                   requirement_id=outside.item_id).status_code == 404  # fmt: skip
    assert [r["ended_at"] for r in _rows(bench)] == [None]


def test_a_later_check_never_ends_a_decision_and_the_files_going_does(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "fr-gone")
    ticket, _first = _first_check(bench)
    on_ticket = _record(bench, ticket, "ESTABLISHED_ON_REVIEW")
    assert on_ticket.status_code == 200, on_ticket.text
    ticket_decision = _on(on_ticket.json(), ticket)["decision"]["id"]
    # The change log arrives: a new check of the request, which ends nothing.
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    second = _check(bench, "ticket REQ-1041.txt", "sap change log.txt")
    assert _on(second, ticket)["decision"]["id"] == ticket_decision
    assert _on(second, log)["decision"] is None
    assert [r["ended_at"] for r in _rows(bench)] == [None]
    on_log = _record(bench, log, "NOT_RELIED_ON")
    assert on_log.status_code == 200, on_log.text
    log_decision = _on(on_log.json(), log)["decision"]["id"]
    assert bench.audit(reliability.ENDED_WITH_FILE, bench.item_id) == []

    # 18 November 2026 (E1, evidence reliance; product owner): a file a person's
    # reliability decision stands on stays until that decision is changed. Old: the log was
    # withdrawn (and later the ticket replaced) and its decision ended as FILE_GONE in that
    # same act, naming nobody; new: the withdrawal and the replacement are refused, naming
    # the decision, and nothing ends. The person reopens the decision first; only then does
    # the file leave. (A withdrawal or replacement can no longer end a standing decision,
    # so the FILE_GONE-by-withdrawal assertions are retired with that path.)
    kept = bench.owner.post(
        f"{bench.base}/evidence-files/{log}/withdraw", json={"reason": "Sent in error"}
    )
    assert kept.status_code == 409
    assert kept.json()["detail"].startswith(
        "the file cannot be withdrawn: a person's decision on whether it is reliable stands"
    )
    assert [r["ended_at"] for r in _rows(bench)] == [None, None]
    assert _reopen(bench, log, log_decision).status_code == 200
    withdrawn = bench.owner.post(
        f"{bench.base}/evidence-files/{log}/withdraw", json={"reason": "Sent in error"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    rows = {r["id"]: r for r in _rows(bench)}
    assert rows[log_decision]["ended_as"] == "REOPENED"
    assert rows[ticket_decision]["ended_at"] is None
    assert bench.audit(reliability.ENDED_WITH_FILE, bench.item_id) == []
    # Back on the ticket alone: the first check of that basis is copied, and the log has
    # no entry there.
    alone = bench.entry()
    assert alone["status"] == "REVIEWED"
    assert [item["file_id"] for item in alone["file_reliability"]] == [ticket]
    # Restoring the file does not bring the decision back: the log's decision is in its
    # history only.
    restored = bench.owner.post(
        f"{bench.base}/evidence-files/{log}/restore", json={"reason": "It was the right file."}
    )
    assert restored.status_code == 200, restored.text
    shown = bench.entry()
    assert shown["status"] == "REVIEWED"
    item = _on(shown, log)
    assert item["decision"] is None
    assert [h["ended_as"] for h in item["history"]] == ["REOPENED"]
    assert _on(shown, ticket)["decision"]["id"] == ticket_decision

    # The ticket's replacement is refused while its decision stands, and goes through once
    # the decision is reopened.
    def replace() -> Any:
        return bench.owner.post(
            f"{bench.base}/evidence-files/{ticket}/replace",
            params={"name": "ticket REQ-1041 v2.txt", "reason": "Corrected export"},
            content=(TICKET + "Closed on 2026-03-05\n").encode(),
            headers={"content-type": "text/plain"},
        )

    assert replace().status_code == 409
    assert _reopen(bench, ticket, ticket_decision).status_code == 200
    replaced = replace()
    assert replaced.status_code == 200, replaced.text
    assert {r["id"]: r for r in _rows(bench)}[ticket_decision]["ended_as"] == "REOPENED"
    assert bench.audit(reliability.ENDED_WITH_FILE, bench.item_id) == []
    assert all(r["ended_at"] is not None for r in _rows(bench))


def test_only_a_person_who_may_decide_evidence_records_or_reopens(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    outsider = _Bench(migrated, "fr-roles-b").client
    bench = _Bench(migrated, "fr-roles")
    ticket, _first = _first_check(bench)
    done = _record(bench, ticket, "NOT_RELIED_ON")
    assert done.status_code == 200, done.text
    shown = str(_on(done.json(), ticket)["decision"]["id"])
    before = _state(bench)

    def asks(client: TestClient | None) -> list[Any]:
        # Each as the page that shows the standing decision sends it.
        return [
            _record(bench, ticket, "ESTABLISHED_ON_REVIEW", client, replaces=shown),
            _reopen(bench, ticket, shown, client),
        ]

    # A Reviewer reads the decisions and records nothing.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert [answer.status_code for answer in asks(reviewer)] == [403, 403]
    seen = next(
        r for r in bench.assurance(reviewer)["requests"] if r["requirement_id"] == bench.item_id
    )
    assert _on(seen, ticket)["decision"]["kind"] == "NOT_RELIED_ON"
    # Another firm's person: not found. No session: not signed in.
    assert [answer.status_code for answer in asks(outsider)] == [404, 404]
    anonymous = TestClient(bench.owner.app)
    assert [answer.status_code for answer in asks(anonymous)] == [401, 401]
    # The routes take their principal from the session, always a person's; an agent
    # principal reaching them is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(reliability, "_session_principal", lambda _request: agent)
        assert all(answer.status_code in (403, 404) for answer in asks(None))
    assert _state(bench) == before

    # An archived engagement is read-only: the middleware refuses every change, and the
    # table refuses a write that reaches it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    for answer in asks(None):
        assert answer.status_code == 409, answer.text
        assert answer.json()["detail"] == closed_detail("ARCHIVED")
    assert _state(bench) == before
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        connection.execute(
            "UPDATE file_reliability_decisions SET ended_at = clock_timestamp(), "
            "ended_by = recorded_by, ended_as = 'REPLACED', version = version + 1"
        )
    # It is still read.
    assert _on(bench.entry(), ticket)["decision"]["kind"] == "NOT_RELIED_ON"


def test_where_the_migration_is_not_applied_nothing_is_read_or_ended_and_nothing_else_fails(
    migrated: Database,
) -> None:
    """The code released before migration 0163: there is no record of a decision, so none
    is read and none is ended, and the D&I list, a check that finishes and the workpaper
    all work as before. Recording is refused, and since E1 so is a withdrawal (what relies
    on the file is read, and the missing table fails loudly)."""
    bench = _Bench(migrated, "fr-unmigrated")
    with connect(migrated.url) as connection:
        connection.execute("DROP TABLE file_reliability_decisions")
    ticket, first = _first_check(bench)
    assert _on(first, ticket)["decision"] is None and _on(first, ticket)["history"] == []
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    _check(bench, "ticket REQ-1041.txt")
    # 18 November 2026 (E1 review, N9): what relies on a file is read on every change to
    # it, and with migration 0163 applied a missing decisions table fails loudly. Old: the
    # withdrawal went through as before; new: it is refused (503), and the file stays.
    withdrawn = bench.owner.post(
        f"{bench.base}/evidence-files/{log}/withdraw", json={"reason": "Sent in error"}
    )
    assert withdrawn.status_code == 503, withdrawn.text
    assert (
        bench.rows("SELECT 1 FROM evidence_withdrawals WHERE evidence_file_id = %s", UUID(log))
        == []
    )
    # Section 3.9: old, no DISPOSITION matter; new, no file's line says a decision.
    assert {(e["established"], e["not_relied_on"]) for e in _paper(bench)["evidence"]} == {
        ("", None)
    }
    assert _record(bench, ticket, "NOT_RELIED_ON").status_code == 503


def test_a_showing_that_rests_in_part_on_a_file_not_relied_on_is_not_counted() -> None:
    """D3 (D&I sign-off integrity, product owner, 19 November 2026; audit invariant I3),
    pure. The approval's condition is shown on F1 and its pass on F2, and F1 is decided not
    relied on. Before, the showing was discounted only where every file it rests on was
    excluded, so the attribute read Shown in the instance, with a mark, and no point. Now
    the showing does not count: no mark, shown_by NOT_RELIED, open for the design and the
    implementation, and a point naming only F1. A decision on another request, or of the
    other kind, changes nothing."""
    from test_design_workpaper_model import (
        ATTRIBUTES,
        F1,
        F2,
        R1,
        R2,
        REQUESTS,
        A,
        _check,
        _index,
        _item,
        _review,
    )
    from test_file_reliability_model import _decided

    from ai_workforce_api import design_conclusions
    from ai_workforce_api.design_points import points_of
    from ai_workforce_api.design_workpaper import StoredOutcome, attributes_of, readings_of

    split = _item(A, files=(F1, F2)).model_dump(mode="json")
    condition, passed = (dict(split["elements"][0]) for _ in range(2))
    condition |= {"key": "condition", "passages": [{"quote": "approved", "file_id": str(F1)}]}
    passed |= {"key": "pass", "passages": [{"quote": "granted", "file_id": str(F2)}]}
    split["elements"] = [condition, passed]
    checks = {R1: _check(StoredOutcome.model_validate(split), review=_review())}
    excluded = [_decided("NOT_RELIED_ON", F1)]
    assert readings_of(checks[R1], excluded)[A].not_relied is True
    # Not counted on another request's decision, nor on one establishing the file.
    assert readings_of(checks[R1], [_decided("NOT_RELIED_ON", F1, R2)])[A].not_relied is False
    assert readings_of(checks[R1], [_decided("ESTABLISHED_ON_REVIEW", F1)])[A].not_relied is False
    evidence = _index(checks=checks)
    shown, left = attributes_of(ATTRIBUTES, REQUESTS, checks, [], evidence, None, (), excluded)
    a = next(item for item in shown if item.id == A)
    assert (a.state, a.tickmark, a.shown_by) == ("SHOWN", "NONE", "NOT_RELIED")
    results = design_conclusions.results_of([view_standing(a)])
    assert (results.design.result, results.implementation.result) == ("OPEN", "OPEN")
    points = [
        p for p in points_of(REQUESTS, checks, ATTRIBUTES, left, [], evidence, excluded)
        if p.kind == "NOT_RELIED"
    ]  # fmt: skip
    assert [(p.place.attribute_id, p.refs) for p in points] == [(A, ["E1"])]
    assert points[0].text.startswith("Attribute A rests on a file not relied on: ")


def view_standing(attribute: Any) -> Any:
    """The attribute as the D&I conclusion's results read it (design_workpaper.standing_of)."""
    from ai_workforce_api.design_workpaper import standing_of

    return standing_of(attribute)
