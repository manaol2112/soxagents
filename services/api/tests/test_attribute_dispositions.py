"""Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, section
10.13; migration 0162), through its routes, with scripted readings and synthetic files
only: no model, no client evidence.

Audit integrity (critical tier):

- each kind is recorded on a finished, current check, read back on the request's entry
  with who, when and the reason, and is one audit event with the person as its actor;
- recording changes nothing of what the check found: the run, its findings and their
  history, the annotations, the request, its acceptance and its messages are row for row
  what they were;
- one disposition stands per request and attribute: recording another keeps the earlier
  one as REPLACED, a person reopens one with a reason, nothing is deleted or rewritten
  (the table refuses it), and the history is given newest first, at most ten;
- every refusal is 409 with one plain sentence and changes nothing: no finished, current
  check (never checked, queued, working, stopped, failed, held, out of date), an attribute
  that is not an approved attribute of the control, "Shown, on my review" without an
  annotation or with one that is another request's, removed, the agent's unreviewed
  proposal, not naming the attribute or on a file no longer in force, a contradiction on
  the current check for the three kinds that close an attribute (only EXCEPTION is taken),
  a reason too short or too long, a stale version;
- a later check of the request ends what closed an attribute where it finds the attribute
  supported (superseded) or contradicted (overtaken, with the check's own sentence), each
  with one audit event that names nobody, and leaves it standing otherwise; a person's
  EXCEPTION is never ended by a check;
- a "Shown, on my review" ends with its annotation: in the transaction that removes the
  annotation or takes the attribute off it, and, for a file no longer in force, when the
  next check of the request finishes (a copied run included);
- only a person who may decide evidence records or reopens: a Reviewer is refused, another
  firm finds nothing, an agent is refused, and an archived engagement is read-only.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_assurance_engine2 import _engine_2, _said
from test_evidence_assurance import (
    APPROVAL,
    LOG,
    TICKET,
    _Bench,
    _index,
    _reading,
    _Readings,
)
from test_evidence_plans import _control
from test_outbound import migrated

from ai_workforce_api import attribute_dispositions as dispositions
from ai_workforce_api import evidence_assurance as chain
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.engagement_close import closed_detail

__all__ = ["migrated"]

REQUESTED = "Requested by: Dana Lee on 2026-03-02"
REASON = "The ticket system was retired in 2026, so no ticket can be produced."
RELIED_ON = "The HR leaver report for March 2026."
EVENTS = "evidence.attribute_disposition%"
# What a disposition must leave row for row as it was: the checks, their findings and the
# findings' history, the annotations, the requests with their acceptance and messages,
# the files and their readings, the conclusions and the model calls.
UNTOUCHED = (
    "evidence_assessments", "evidence_findings", "evidence_finding_events",
    "evidence_annotations", "evidence_requirements", "evidence_requirement_attributes",
    "pbc_requests", "request_messages", "evidence_files", "evidence_analyses",
    "design_coverage_exceptions", "design_conclusions", "control_attributes", "model_calls",
)  # fmt: skip
DISPOSITION_KEYS = {
    "id", "kind", "reason", "relied_on", "annotation_id", "recorded_by_name", "recorded_at",
    "version",
}  # fmt: skip
ENDED_KEYS = DISPOSITION_KEYS | {"ended_at", "ended_by_name", "ended_as", "ended_reason"}

Plan = Callable[[str, dict[str, Any]], dict[str, Any]]


def _plan(**how: str) -> Plan:
    """A reading, attribute by attribute: MET (shown by the approval line, the default),
    ABSENT (not met: nothing shows it) or DEVIATION (a record of the ticket shows it is
    not met)."""

    def plan(code: str, facts: dict[str, Any]) -> dict[str, Any]:
        chosen = how.get(code, "MET")
        if chosen == "ABSENT":
            return {"result": "NOT_MET", "quotes": [], "absent": "No record that shows it.",
                    "reason": "not shown"}  # fmt: skip
        ticket = _index(facts, "ticket REQ-1041.txt")
        deviation = chosen == "DEVIATION"
        return {
            "result": "NOT_MET" if deviation else "MET",
            "quotes": [
                {"file": ticket, "quote": REQUESTED if deviation else APPROVAL, "basis": "RECORD"}
            ],
            "absent": "",
            "reason": "the record shows otherwise" if deviation else "shown",
        }

    return plan


def _files_said(facts: dict[str, Any]) -> dict[str, Any]:
    return {"files": _said(*range(len(facts["files"])))}


def _check(bench: _Bench, reviewer: dict[str, str] | None = None, **how: str) -> dict[str, Any]:
    """The worker finishes the queued check: both readings answer by `how`, or the second
    by `reviewer` where it reads differently. The request's entry."""
    first = _engine_2(_plan(**how), _files_said)
    second = first if reviewer is None else _engine_2(_plan(**reviewer), _files_said)
    assert bench.check(_Readings(first, second)) == ["READY"]
    entry = bench.entry()
    assert entry["status"] == "REVIEWED"
    return entry


def _first_check(bench: _Bench, **how: str) -> tuple[str, dict[str, Any]]:
    """The ticket on the request, read and checked: the file and the request's entry."""
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    return ticket, _check(bench, None, **how)


def _ids(entry: dict[str, Any]) -> dict[str, str]:
    return {str(a["code"]): str(a["attribute_id"]) for a in entry["attributes"]}


def _by_code(entry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(a["code"]): a for a in entry["attributes"]}


def _url(
    bench: _Bench,
    attribute_id: str,
    tail: str = "",
    requirement_id: str | None = None,
    control_id: str | None = None,
) -> str:
    return (
        f"{bench.base}/controls/{control_id or bench.control}/evidence-assurance/"
        f"{requirement_id or bench.item_id}/attributes/{attribute_id}/disposition{tail}"
    )


def _record(
    bench: _Bench,
    attribute_id: str,
    kind: str,
    client: TestClient | None = None,
    **body: Any,
) -> Any:
    where = {key: body.pop(key) for key in ("requirement_id", "control_id") if key in body}
    sent = {"kind": kind, "reason": REASON} | body
    return (client or bench.owner).post(_url(bench, attribute_id, **where), json=sent)


def _reopen(
    bench: _Bench,
    attribute_id: str,
    version: int,
    client: TestClient | None = None,
    reason: str = "Recorded on the wrong attribute.",
) -> Any:
    return (client or bench.owner).post(
        _url(bench, attribute_id, "/reopen"), json={"version": version, "reason": reason}
    )


def _annotate(bench: _Bench, file_id: str, *attribute_ids: str, item: str | None = None) -> str:
    """A person's own annotation on a file of the request, naming the attributes."""
    added = bench.owner.post(
        f"{bench.base}/controls/{bench.control}/evidence-annotations",
        json={
            "requirement_id": item or bench.item_id, "file_id": file_id, "page": 1,
            "rects": [[0.05, 0.6, 0.4, 0.05]],
            "statement": "The line shows it, on my reading of the record.",
            "attribute_ids": list(attribute_ids), "kind": "SHOWS",
        },
    )  # fmt: skip
    assert added.status_code == 200, added.text
    [(annotation_id,)] = bench.rows(
        "SELECT id FROM evidence_annotations WHERE origin = 'PERSON' AND evidence_file_id = %s "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        UUID(file_id),
    )
    return str(annotation_id)


def _rows(bench: _Bench) -> list[dict[str, Any]]:
    """Every disposition on record, oldest first."""
    return [
        row[0]
        for row in bench.rows(
            "SELECT to_jsonb(d) FROM attribute_dispositions d ORDER BY recorded_at, id"
        )
    ]


def _untouched(bench: _Bench) -> dict[str, list[str]]:
    return {
        table: [
            str(row[0])
            for row in bench.rows(f"SELECT to_jsonb(t)::text FROM {table} t ORDER BY 1")  # noqa: S608
        ]
        for table in UNTOUCHED
    }


def _state(bench: _Bench) -> tuple[Any, ...]:
    """Everything a refusal must leave as it was: the dispositions, their events, and
    what a disposition never touches."""
    events = bench.rows(
        "SELECT id::text, action FROM audit_events WHERE action LIKE %s ORDER BY 1", EVENTS
    )
    return ([str(row) for row in _rows(bench)], events, _untouched(bench))


def _refused(bench: _Bench, sentence: str, asked: Callable[[], Any]) -> None:
    """The ask is refused (409) with this one sentence, and nothing changed."""
    before = _state(bench)
    queued = list(bench.worker.assessments)
    answer = asked()
    assert answer.status_code == 409, answer.text
    assert answer.json()["detail"] == sentence
    assert _state(bench) == before
    assert bench.worker.assessments == queued


def _events(bench: _Bench, action: str) -> list[tuple[Any, ...]]:
    return bench.audit(action, bench.item_id)


def test_each_kind_is_recorded_read_back_replaced_and_reopened_and_the_check_stays(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "ad-flow")
    ticket, first = _first_check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    ids, run_id = _ids(first), first["run_id"]
    owner, owner_name = bench.team["owner_id"], bench.name(bench.team["owner_id"])
    assert [a["verdict"] for a in first["attributes"]] == [
        "SUPPORTED", "ISSUE", "ISSUE", "ISSUE", "SUPPORTED",
    ]  # fmt: skip
    # Before any act: nothing stands and nothing ended, for every attribute.
    for attribute in first["attributes"]:
        assert attribute["disposition"] is None and attribute["disposition_history"] == []
    on_c = _annotate(bench, ticket, ids["C"])
    before = _untouched(bench)
    assert len(before["evidence_findings"]) == 3 and len(before["evidence_annotations"]) >= 2

    def stripped(entry: dict[str, Any]) -> dict[str, Any]:
        """The entry without the two fields a disposition adds."""
        return entry | {
            "attributes": [
                {k: v for k, v in a.items() if k not in ("disposition", "disposition_history")}
                for a in entry["attributes"]
            ]
        }

    as_checked = stripped(bench.entry())

    # Not applicable to this instance, on B.
    done = _record(bench, ids["B"], "NOT_APPLICABLE")
    assert done.status_code == 200, done.text
    # Answered with the request's entry, as the list gives it: what the check found is
    # there unchanged, and the disposition is beside it.
    entry = done.json()
    assert entry == bench.entry() and stripped(entry) == as_checked
    assert (entry["requirement_id"], entry["run_id"], entry["status"]) == (
        bench.item_id, run_id, "REVIEWED",
    )  # fmt: skip
    b = _by_code(entry)["B"]
    standing = b["disposition"]
    assert set(standing) == DISPOSITION_KEYS and b["disposition_history"] == []
    assert standing | {"id": "", "recorded_at": ""} == {
        "id": "", "kind": "NOT_APPLICABLE", "reason": REASON, "relied_on": "",
        "annotation_id": None, "recorded_by_name": owner_name, "recorded_at": "", "version": 1,
    }  # fmt: skip
    assert (b["verdict"], b["finding_status"]) == ("ISSUE", "PROPOSED")
    for code, attribute in _by_code(entry).items():
        if code != "B":
            assert attribute["disposition"] is None and attribute["disposition_history"] == []
    [row] = _rows(bench)
    assert (row["id"], row["assessment_id"], row["recorded_by"]) == (
        standing["id"], run_id, str(owner),
    )  # fmt: skip
    assert (row["requirement_id"], row["attribute_id"]) == (bench.item_id, ids["B"])
    assert (row["engagement_control_id"], row["ended_at"], row["ended_as"]) == (
        bench.control, None, None,
    )  # fmt: skip
    # One audit event, the person's.
    [(actor, agent, event)] = _events(bench, dispositions.RECORDED)
    assert (actor, agent) == (owner, None)
    assert event == {
        "control_id": bench.control, "attribute_id": ids["B"], "disposition_id": standing["id"],
        "kind": "NOT_APPLICABLE", "reason": REASON, "relied_on": "", "annotation_id": None,
        "assessment_id": run_id, "replaced": None, "replaced_kind": None,
    }  # fmt: skip

    # Evidence not available, accepted, with what was relied on instead: it replaces the
    # first, which is kept.
    replaced = _record(
        bench, ids["B"], "NOT_AVAILABLE", reason=f"  {REASON}\n ", relied_on=f" {RELIED_ON} "
    )
    assert replaced.status_code == 200, replaced.text
    b = _by_code(replaced.json())["B"]
    assert b["disposition"]["id"] != standing["id"]
    now = b["disposition"]
    assert (now["kind"], now["reason"], now["relied_on"]) == ("NOT_AVAILABLE", REASON, RELIED_ON)
    [earlier] = b["disposition_history"]
    assert set(earlier) == ENDED_KEYS
    assert (earlier["id"], earlier["kind"], earlier["ended_as"], earlier["version"]) == (
        standing["id"], "NOT_APPLICABLE", "REPLACED", 2,
    )  # fmt: skip
    assert (earlier["ended_by_name"], earlier["ended_reason"]) == (owner_name, "")
    assert earlier["reason"] == REASON and earlier["ended_at"] is not None
    assert [(r["kind"], r["ended_as"]) for r in _rows(bench)] == [
        ("NOT_APPLICABLE", "REPLACED"), ("NOT_AVAILABLE", None),
    ]  # fmt: skip
    second_event = _events(bench, dispositions.RECORDED)[1][2]
    assert (second_event["replaced"], second_event["replaced_kind"], second_event["relied_on"]) == (
        standing["id"], "NOT_APPLICABLE", RELIED_ON,
    )  # fmt: skip

    # Shown, on my review, on C, resting on the person's own annotation.
    shown = _record(bench, ids["C"], "SHOWN_ON_REVIEW", annotation_id=on_c)
    assert shown.status_code == 200, shown.text
    c = _by_code(shown.json())["C"]
    assert (c["disposition"]["kind"], c["disposition"]["annotation_id"]) == (
        "SHOWN_ON_REVIEW", on_c,
    )  # fmt: skip
    # The check's own result for C is as it was: an issue, with its finding to decide.
    assert (c["verdict"], c["assessment"], c["finding_status"]) == (
        "ISSUE", "NOT_DEMONSTRATED", "PROPOSED",
    )  # fmt: skip

    # Exception, on D: recorded, and it closes nothing of the check.
    excepted = _record(bench, ids["D"], "EXCEPTION", reason="The grant is not on any record.")
    assert excepted.status_code == 200, excepted.text
    d = _by_code(excepted.json())["D"]
    assert d["disposition"]["kind"] == "EXCEPTION" and d["finding_status"] == "PROPOSED"

    # Read back by anyone who reads the engagement, the same.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    read = next(
        r for r in bench.assurance(reviewer)["requests"] if r["requirement_id"] == bench.item_id
    )
    assert read == bench.entry()
    assert {code: (a["disposition"] or {}).get("kind") for code, a in _by_code(read).items()} == {
        "A": None, "B": "NOT_AVAILABLE", "C": "SHOWN_ON_REVIEW", "D": "EXCEPTION", "E": None,
    }  # fmt: skip

    # Nothing of the run, its findings and their history, the annotations, the request,
    # its acceptance or its messages changed, row for row; no check was queued.
    assert _untouched(bench) == before
    assert stripped(bench.entry()) == as_checked
    assert bench.item(bench.item_id)["sufficiency"] == "NOT_REVIEWED"
    assert bench.worker.assessments == [] and len(bench.runs()) == 1

    # Reopen, with a reason and the version the person saw.
    version = _by_code(bench.entry())["B"]["disposition"]["version"]
    current = _by_code(bench.entry())["B"]["disposition"]["id"]
    _refused(bench, dispositions.STALE, lambda: _reopen(bench, ids["B"], version + 1))
    assert dispositions.STALE == (
        "This tickmark changed since the page loaded, so refresh and try again."
    )
    _refused(
        bench, dispositions.REASON_TOO_SHORT,
        lambda: _reopen(bench, ids["B"], version, reason="No."),
    )  # fmt: skip
    opened = _reopen(bench, ids["B"], version)
    assert opened.status_code == 200, opened.text
    b = _by_code(opened.json())["B"]
    assert b["disposition"] is None
    assert [(h["id"], h["ended_as"]) for h in b["disposition_history"]] == [
        (current, "REOPENED"), (standing["id"], "REPLACED"),
    ]  # fmt: skip
    newest = b["disposition_history"][0]
    assert (newest["ended_reason"], newest["ended_by_name"], newest["version"]) == (
        "Recorded on the wrong attribute.", owner_name, version + 1,
    )  # fmt: skip
    [(actor, agent, event)] = _events(bench, dispositions.REOPENED)
    assert (actor, agent) == (owner, None)
    assert event == {
        "control_id": bench.control, "attribute_id": ids["B"], "disposition_id": current,
        "kind": "NOT_AVAILABLE", "reason": "Recorded on the wrong attribute.",
    }  # fmt: skip
    # Nothing stands there now: a second reopening is refused, and so is one where none
    # was ever recorded.
    _refused(bench, dispositions.NOTHING_STANDS, lambda: _reopen(bench, ids["B"], version + 1))
    _refused(bench, dispositions.NOTHING_STANDS, lambda: _reopen(bench, ids["A"], 1))
    assert dispositions.NOTHING_STANDS == "No tickmark stands on this attribute for this request."
    # The other attributes' dispositions are as they were.
    assert _by_code(bench.entry())["C"]["disposition"]["id"] == c["disposition"]["id"]

    # The history is the newest first, at most ten; every row is kept on record.
    for number in range(12):
        again = _record(bench, ids["E"], "NOT_APPLICABLE", reason=f"Reason number {number:02d}.")
        assert again.status_code == 200, again.text
    e = _by_code(bench.entry())["E"]
    assert e["disposition"]["reason"] == "Reason number 11."
    assert [h["reason"] for h in e["disposition_history"]] == [
        f"Reason number {number:02d}." for number in range(10, 0, -1)
    ]
    assert {h["ended_as"] for h in e["disposition_history"]} == {"REPLACED"}
    on_e = [r for r in _rows(bench) if r["attribute_id"] == ids["E"]]
    assert len(on_e) == 12 and [r["ended_at"] is None for r in on_e] == [False] * 11 + [True]
    assert _untouched(bench) == before

    # The records guard themselves: one stands per request and attribute, what a
    # disposition records never changes, it changes only by ending, once, and nothing is
    # deleted.
    open_e, ended_e = UUID(on_e[-1]["id"]), UUID(on_e[0]["id"])
    for statement, row_id in (
        ("UPDATE attribute_dispositions SET reason = 'Another reason entirely.' WHERE id = %s",
         open_e),
        ("UPDATE attribute_dispositions SET kind = 'SHOWN_ON_REVIEW' WHERE id = %s", open_e),
        ("UPDATE attribute_dispositions SET version = version + 1 WHERE id = %s", open_e),
        ("UPDATE attribute_dispositions SET ended_at = clock_timestamp(), ended_as = 'DONE', "
         "version = version + 1 WHERE id = %s", open_e),
        ("UPDATE attribute_dispositions SET ended_at = clock_timestamp(), "
         "ended_as = 'SUPERSEDED_BY_CHECK' WHERE id = %s", open_e),
        ("UPDATE attribute_dispositions SET ended_at = clock_timestamp(), ended_by = recorded_by, "
         "ended_as = 'SUPERSEDED_BY_CHECK', version = version + 1 WHERE id = %s", open_e),
        ("UPDATE attribute_dispositions SET ended_at = clock_timestamp(), ended_by = recorded_by, "
         "ended_as = 'REOPENED', ended_reason = 'No.', version = version + 1 WHERE id = %s",
         open_e),
        ("UPDATE attribute_dispositions SET ended_reason = 'Again.', version = version + 1 "
         "WHERE id = %s", ended_e),
        ("DELETE FROM attribute_dispositions WHERE id = %s", ended_e),
        ("DELETE FROM attribute_dispositions WHERE id = %s", open_e),
        ("INSERT INTO attribute_dispositions (organization_id, project_id, "
         "engagement_control_id, requirement_id, attribute_id, kind, reason, assessment_id, "
         "recorded_by) SELECT organization_id, project_id, engagement_control_id, "
         "requirement_id, attribute_id, 'EXCEPTION', 'A second one that stands.', "
         "assessment_id, recorded_by FROM attribute_dispositions WHERE id = %s", open_e),
    ):  # fmt: skip
        with connect(migrated.url) as connection, pytest.raises(psycopg.Error):
            connection.execute(statement, (row_id,))
    for values in (
        "'SHOWN_ON_REVIEW', 'No annotation is named.', '', NULL",
        "'NOT_APPLICABLE', 'Relied on with another kind.', 'A report', NULL",
        "'NOT_AVAILABLE', 'Too short', '', NULL",
        f"'NOT_APPLICABLE', 'An annotation with another kind.', '', '{on_c}'",
        "'ACCEPTED', 'A kind the contract does not have.', '', NULL",
    ):
        with connect(migrated.url) as connection, pytest.raises(psycopg.Error):
            connection.execute(
                "INSERT INTO attribute_dispositions (organization_id, project_id, "
                "engagement_control_id, requirement_id, attribute_id, kind, reason, "
                "relied_on, annotation_id, assessment_id, recorded_by) "
                "SELECT organization_id, project_id, engagement_control_id, requirement_id, "
                f"%s, {values}, assessment_id, recorded_by "  # noqa: S608
                "FROM attribute_dispositions WHERE id = %s",
                (UUID(ids["A"]), open_e),
            )
    assert len(_rows(bench)) == 16 and _untouched(bench) == before


def test_every_state_without_a_finished_current_check_is_refused_and_changes_nothing(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "ad-states")
    [(attribute,)] = bench.rows(
        "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'APPROVED' ORDER BY position, created_at LIMIT 1",
        UUID(bench.control),
    )
    a = str(attribute)

    def ask() -> Any:
        return _record(bench, a, "NOT_APPLICABLE")

    def reads(status: str) -> None:
        assert bench.entry()["status"] == status

    # Never checked: no file is on the request.
    _refused(bench, dispositions.NOT_CHECKED, ask)
    assert dispositions.NOT_CHECKED == (
        "This request has not been checked yet, so there is no result to put a tickmark on."
    )
    bench.add("ticket REQ-1041.txt", TICKET)
    # A file still being read: its check has not started.
    _refused(bench, dispositions.NOT_CHECKED, ask)
    bench.read_next(_reading("walkthrough"))
    # Queued.
    reads("QUEUED")
    [(run_id,)] = bench.rows(
        "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL",
        UUID(bench.item_id),
    )
    _refused(bench, dispositions.STILL_CHECKING, ask)
    assert dispositions.STILL_CHECKING == (
        "The check of this request has not finished, so a tickmark waits until its result is in."
    )
    # Working, with a live lease.
    bench.rows(
        "UPDATE evidence_assessments SET status = 'WORKING', claim_token = %s, "
        "lease_until = clock_timestamp() + interval '10 minutes' WHERE id = %s RETURNING id",
        uuid4(), run_id,
    )  # fmt: skip
    reads("CHECKING")
    _refused(bench, dispositions.STILL_CHECKING, ask)
    # Its worker lost the lease: it reads as failed.
    bench.rows(
        "UPDATE evidence_assessments SET lease_until = clock_timestamp() - interval '1 minute' "
        "WHERE id = %s RETURNING id", run_id,
    )  # fmt: skip
    reads("FAILED")
    _refused(bench, dispositions.CHECK_FAILED, ask)
    # Failed.
    bench.rows(
        "UPDATE evidence_assessments SET status = 'FAILED', lease_until = NULL, "
        "note = 'The check did not finish.', finished_at = clock_timestamp() "
        "WHERE id = %s RETURNING id", run_id,
    )  # fmt: skip
    reads("FAILED")
    _refused(bench, dispositions.CHECK_FAILED, ask)
    assert dispositions.CHECK_FAILED == (
        "The check of this request did not finish, so there is no result to put a tickmark on."
    )
    # Held whole by its gate.
    assert bench.rerun().status_code == 202
    bench.worker.assessments.clear()
    [(held_id,)] = bench.rows(
        "SELECT id FROM evidence_assessments WHERE requirement_id = %s AND stale_at IS NULL",
        UUID(bench.item_id),
    )
    assert held_id != run_id
    bench.rows(
        "UPDATE evidence_assessments SET status = 'HELD', held_code = 'TOO_LARGE', "
        "held_reason = 'The files are together too long.', file_ids = '{}', "
        "finished_at = clock_timestamp() WHERE id = %s RETURNING id", held_id,
    )  # fmt: skip
    reads("HELD")
    _refused(bench, dispositions.CHECK_HELD, ask)
    assert dispositions.CHECK_HELD == (
        "The check of this request was held before anything was read, so there is no result "
        "to put a tickmark on."
    )
    # Marked out of date, with no run after it.
    with connect(migrated.url) as connection:
        chain._mark_stale(connection.cursor(), held_id, ["A file was added to this request."])
    reads("OUT_OF_DATE")
    _refused(bench, dispositions.CHECK_OUT_OF_DATE, ask)
    assert dispositions.CHECK_OUT_OF_DATE == (
        "The check of this request is out of date, so a tickmark waits until it is checked again."
    )
    # Checked and finished: recorded.
    assert bench.rerun().status_code == 202
    bench.worker.assessments.clear()
    entry = _check(bench)
    ids = _ids(entry)
    assert ids["A"] == a
    assert ask().status_code == 200
    # What it read has changed since, and nothing marked it yet: out of date all the same,
    # for a new disposition and for another kind on the one that stands.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes "
            "WHERE requirement_id = %s AND attribute_id = %s",
            (UUID(bench.item_id), UUID(ids["E"])),
        )
    reads("OUT_OF_DATE")
    _refused(bench, dispositions.CHECK_OUT_OF_DATE, lambda: _record(bench, ids["B"], "EXCEPTION"))
    _refused(bench, dispositions.CHECK_OUT_OF_DATE, lambda: _record(bench, a, "EXCEPTION"))
    # A request with no finished, current check shows nothing as standing; the record is
    # kept, and stands again once a check of the request finishes that leaves it standing.
    assert bench.entry()["attributes"] == []
    assert [(r["kind"], r["ended_at"]) for r in _rows(bench)] == [("NOT_APPLICABLE", None)]
    assert bench.rerun().status_code == 202
    again = _by_code(_check(bench, A="ABSENT"))
    assert again["A"]["disposition"]["kind"] == "NOT_APPLICABLE"
    assert again["A"]["disposition"]["id"] == _rows(bench)[0]["id"]
    assert _rows(bench)[0]["assessment_id"] == entry["run_id"] != bench.entry()["run_id"]


def test_each_refusal_on_a_finished_check_is_one_sentence_and_changes_nothing(
    migrated: Database,
) -> None:
    # Another firm's engagement, with a person's annotation of its own (made first: a
    # worker's pass runs every queued check there is).
    outside = _Bench(migrated, "ad-refusals-b")
    outside_file, outside_entry = _first_check(outside, B="ABSENT")
    foreign_annotation = _annotate(outside, outside_file, _ids(outside_entry)["B"])
    bench = _Bench(migrated, "ad-refusals")
    # A is shown, B and D are not shown, the records show C is not met, and on E the two
    # readings differ.
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    how = {"B": "ABSENT", "C": "DEVIATION", "D": "ABSENT"}
    entry = _check(bench, reviewer=how | {"E": "ABSENT"}, **how)
    ids, found = _ids(entry), _by_code(entry)
    assert {code: (a["verdict"], a["assessment"]) for code, a in found.items()} == {
        "A": ("SUPPORTED", "SATISFIED"), "B": ("ISSUE", "NOT_DEMONSTRATED"),
        "C": ("ISSUE", "CONTRADICTED"), "D": ("ISSUE", "NOT_DEMONSTRATED"),
        "E": ("UNSETTLED", "INDETERMINATE"),
    }  # fmt: skip
    mine = _annotate(bench, ticket, ids["B"], ids["D"])

    def asking(attribute_id: str, kind: str, **body: Any) -> Callable[[], Any]:
        return lambda: _record(bench, attribute_id, kind, None, **body)

    # An attribute that is not an approved attribute of this control: unknown, or another
    # control's.
    elsewhere = _control(migrated, bench.team, "ITGC-AC-02")
    [(foreign,)] = bench.rows(
        "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
        "ORDER BY position, created_at LIMIT 1",
        UUID(elsewhere),
    )
    for attribute in (str(uuid4()), str(foreign)):
        _refused(
            bench, dispositions.NOT_AN_ATTRIBUTE,
            asking(attribute, "NOT_APPLICABLE"),
        )  # fmt: skip
    assert dispositions.NOT_AN_ATTRIBUTE == (
        "This attribute is not an approved attribute of this control."
    )

    # The reason: always given, in a sentence, and bounded.
    for reason in ("", "   ", "Too short", "x" * 9):
        _refused(
            bench, dispositions.REASON_TOO_SHORT,
            asking(ids["B"], "NOT_APPLICABLE", reason=reason),
        )  # fmt: skip
    _refused(
        bench, dispositions.REASON_TOO_LONG,
        lambda: _record(bench, ids["B"], "NOT_APPLICABLE", reason="x" * 1001),
    )  # fmt: skip
    # What was relied on instead: only with "Evidence not available, accepted", bounded.
    for kind in ("NOT_APPLICABLE", "EXCEPTION"):
        _refused(
            bench, dispositions.RELIED_ON_NOT_TAKEN,
            asking(ids["B"], kind, relied_on=RELIED_ON),
        )  # fmt: skip
    _refused(
        bench, dispositions.RELIED_ON_TOO_LONG,
        lambda: _record(bench, ids["B"], "NOT_AVAILABLE", relied_on="x" * 601),
    )  # fmt: skip

    # "Shown, on my review" needs an annotation; no other kind takes one.
    _refused(
        bench, dispositions.ANNOTATION_NEEDED, lambda: _record(bench, ids["B"], "SHOWN_ON_REVIEW")
    )
    assert dispositions.ANNOTATION_NEEDED == (
        "“Shown, on my review” needs an annotation on the evidence that names this attribute."
    )
    _refused(
        bench, dispositions.ANNOTATION_NOT_TAKEN,
        lambda: _record(bench, ids["B"], "NOT_AVAILABLE", annotation_id=mine),
    )  # fmt: skip

    def on_review(attribute: str, annotation: str) -> Callable[[], Any]:
        return lambda: _record(bench, attribute, "SHOWN_ON_REVIEW", annotation_id=annotation)

    # An annotation that is not this request's: unknown, another request's of the control,
    # another engagement's.
    other_item = next(str(item["id"]) for item in bench.items if str(item["id"]) != bench.item_id)
    other_file = bench.add("access policy.txt", "Access policy v3.\n", bench.item(other_item))
    bench.read_next(_reading("policy"))
    assert bench.entry()["status"] == "REVIEWED"
    theirs = _annotate(bench, other_file, ids["B"], item=other_item)
    for annotation in (str(uuid4()), theirs, foreign_annotation):
        _refused(bench, dispositions.ANNOTATION_ELSEWHERE, on_review(ids["B"], annotation))
    assert dispositions.ANNOTATION_ELSEWHERE == (
        "The annotation chosen is not an annotation of this request."
    )
    # The agent's proposal nobody reviewed (it names A).
    [(proposal,)] = bench.rows(
        "SELECT id FROM evidence_annotations WHERE requirement_id = %s AND origin = 'AGENT' "
        "AND status = 'PROPOSED' AND kind = 'SHOWS' AND %s = ANY(attribute_ids) LIMIT 1",
        UUID(bench.item_id), UUID(ids["A"]),
    )  # fmt: skip
    _refused(bench, dispositions.ANNOTATION_UNREVIEWED, on_review(ids["A"], str(proposal)))
    assert dispositions.ANNOTATION_UNREVIEWED == (
        "The annotation chosen is the agent's proposal and no person has reviewed it yet."
    )
    # One that does not name the attribute (the person's own names B and D).
    _refused(bench, dispositions.ANNOTATION_OTHER_ATTRIBUTE, on_review(ids["E"], mine))
    assert dispositions.ANNOTATION_OTHER_ATTRIBUTE == (
        "The annotation chosen does not name this attribute."
    )
    # One a person removed.
    removed = _annotate(bench, ticket, ids["B"])
    gone = bench.owner.post(
        f"{bench.base}/controls/{bench.control}/evidence-annotations/{removed}/remove",
        json={"version": 1},
    )
    assert gone.status_code == 200, gone.text
    _refused(bench, dispositions.ANNOTATION_REMOVED, on_review(ids["B"], removed))
    assert dispositions.ANNOTATION_REMOVED == (
        "The annotation chosen is no longer in the list of its file."
    )

    # The records contradict C on the current check: nothing that would close it is
    # taken, whatever the reason or the annotation; only an exception.
    on_c = _annotate(bench, ticket, ids["C"])
    for kind in ("NOT_APPLICABLE", "NOT_AVAILABLE"):
        _refused(bench, dispositions.ONLY_EXCEPTION, asking(ids["C"], kind))
    _refused(bench, dispositions.ONLY_EXCEPTION, on_review(ids["C"], on_c))
    excepted = _record(bench, ids["C"], "EXCEPTION", reason="The requester approved it herself.")
    assert excepted.status_code == 200, excepted.text
    assert _by_code(excepted.json())["C"]["disposition"]["kind"] == "EXCEPTION"
    # Still none of the three, in place of the exception.
    _refused(bench, dispositions.ONLY_EXCEPTION, lambda: _record(bench, ids["C"], "NOT_AVAILABLE"))
    assert _by_code(bench.entry())["C"]["disposition"]["kind"] == "EXCEPTION"
    # Where the two readings differ, the person's judgment is exactly what is asked for.
    assert _record(bench, ids["E"], "NOT_APPLICABLE").status_code == 200

    # A body that is not of the contract's shape is not read at all.
    unreadable: list[dict[str, Any]] = [
        {"kind": "ACCEPTED", "reason": REASON},
        {"kind": "NOT_APPLICABLE"},
        {"kind": "NOT_APPLICABLE", "reason": REASON, "status": "CLOSED"},
        {"kind": "NOT_APPLICABLE", "reason": "x" * 4001},
        {"kind": "SHOWN_ON_REVIEW", "reason": REASON, "annotation_id": "not-an-id"},
    ]
    for body in unreadable:
        state = _state(bench)
        assert bench.owner.post(_url(bench, ids["B"]), json=body).status_code == 422, body
        assert _state(bench) == state
    for body in ({"reason": REASON}, {"version": 0, "reason": REASON}, {"version": 1}):
        assert bench.owner.post(_url(bench, ids["C"], "/reopen"), json=body).status_code == 422

    # A request, a control or an attribute path that is not this engagement's is not found.
    state = _state(bench)
    paths: list[dict[str, Any]] = [
        {"requirement_id": str(uuid4())},
        {"control_id": str(uuid4())},
        {"control_id": elsewhere},
        {"requirement_id": str(outside.item_id)},
    ]
    for where in paths:
        assert _record(bench, ids["B"], "NOT_APPLICABLE", None, **where).status_code == 404, where
    assert bench.owner.post(
        _url(bench, ids["C"], "/reopen", requirement_id=str(uuid4())),
        json={"version": 1, "reason": "Recorded in error."},
    ).status_code == 404  # fmt: skip
    assert _state(bench) == state


@pytest.mark.parametrize("kind", dispositions.KINDS)
def test_a_later_check_ends_each_kind_as_the_rule_says(migrated: Database, kind: str) -> None:
    bench = _Bench(migrated, f"ad-later-{dispositions.KINDS.index(kind)}")
    ticket, first = _first_check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    ids = _ids(first)
    more: dict[str, Any] = {}
    if kind == "SHOWN_ON_REVIEW":
        more["annotation_id"] = _annotate(bench, ticket, ids["B"], ids["C"], ids["D"])
    recorded: dict[str, str] = {}
    for code in ("B", "C", "D"):
        done = _record(bench, ids[code], kind, **more)
        assert done.status_code == 200, done.text
        recorded[code] = _by_code(done.json())[code]["disposition"]["id"]

    # New evidence arrives: nothing of a check is shown before it finishes, and the
    # dispositions are neither shown nor ended meanwhile.
    bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    waiting = bench.entry()
    assert (waiting["status"], waiting["attributes"]) == ("QUEUED", [])
    assert [r["ended_at"] for r in _rows(bench)] == [None, None, None]
    _refused(bench, dispositions.STILL_CHECKING, lambda: _record(bench, ids["B"], kind, **more))

    # The later check: B is now supported, the records show C is not met, D is as before.
    second = _check(bench, C="DEVIATION", D="ABSENT")
    assert second["run_id"] != first["run_id"]
    after = _by_code(second)
    assert {code: (after[code]["verdict"], after[code]["assessment"]) for code in "BCD"} == {
        "B": ("SUPPORTED", "SATISFIED"), "C": ("ISSUE", "CONTRADICTED"),
        "D": ("ISSUE", "NOT_DEMONSTRATED"),
    }  # fmt: skip
    rows = {r["attribute_id"]: r for r in _rows(bench)}
    events = _events(bench, dispositions.ENDED_BY_CHECK)
    # Whatever it ended, each row still names the run it was recorded on.
    assert {r["assessment_id"] for r in rows.values()} == {first["run_id"]}

    if kind == "EXCEPTION":
        # A person's exception is never ended by a check: only a person reopens it.
        for code in ("B", "C", "D"):
            standing = after[code]["disposition"]
            assert (standing["id"], standing["kind"], standing["version"]) == (
                recorded[code], "EXCEPTION", 1,
            )  # fmt: skip
            assert after[code]["disposition_history"] == []
        assert events == [] and all(r["ended_at"] is None for r in rows.values())
        return

    # Supported: no longer needed, superseded by the check, kept in the history.
    assert after["B"]["disposition"] is None
    [superseded] = after["B"]["disposition_history"]
    assert (superseded["id"], superseded["ended_as"], superseded["version"]) == (
        recorded["B"], "SUPERSEDED_BY_CHECK", 2,
    )  # fmt: skip
    assert (superseded["ended_by_name"], superseded["ended_reason"]) == (
        None, "A later check of the request found this attribute supported.",
    )  # fmt: skip
    # A contradiction: it no longer stands, with the reason, and the attribute waits on
    # the person again.
    assert after["C"]["disposition"] is None
    [overtaken] = after["C"]["disposition_history"]
    assert (overtaken["id"], overtaken["ended_as"], overtaken["ended_by_name"]) == (
        recorded["C"], "OVERTAKEN_BY_CHECK", None,
    )  # fmt: skip
    assert overtaken["ended_reason"] == (
        "A later check of the request found the records contradict this attribute. "
        + after["C"]["summary"]
    )
    assert after["C"]["finding_status"] == "PROPOSED"
    # Neither: it stands, as it was recorded.
    standing = after["D"]["disposition"]
    assert (standing["id"], standing["kind"], standing["version"]) == (recorded["D"], kind, 1)
    assert after["D"]["disposition_history"] == []
    assert rows[ids["D"]]["ended_at"] is None
    assert (rows[ids["B"]]["ended_by"], rows[ids["C"]]["ended_by"]) == (None, None)

    # One audit event for each one the check ended, with nobody as its actor.
    assert [(actor, agent) for actor, agent, _payload in events] == [(None, None), (None, None)]
    assert sorted((event[2] for event in events), key=lambda e: str(e["ended_as"])) == [
        {"control_id": bench.control, "attribute_id": ids["C"], "disposition_id": recorded["C"],
         "kind": kind, "ended_as": "OVERTAKEN_BY_CHECK", "run_id": second["run_id"],
         "finds": "CONTRADICTED"},
        {"control_id": bench.control, "attribute_id": ids["B"], "disposition_id": recorded["B"],
         "kind": kind, "ended_as": "SUPERSEDED_BY_CHECK", "run_id": second["run_id"],
         "finds": "SUPPORTED"},
    ]  # fmt: skip
    # The check itself is saved as it found it, whatever it ended.
    [(status, findings)] = bench.rows(
        "SELECT status, (SELECT count(*) FROM evidence_findings f WHERE f.assessment_id = a.id) "
        "FROM evidence_assessments a WHERE id = %s",
        UUID(second["run_id"]),
    )
    assert status == "READY" and findings >= 1
    # On the contradiction only an exception is taken now.
    _refused(bench, dispositions.ONLY_EXCEPTION, lambda: _record(bench, ids["C"], kind, **more))
    # The same result recorded again ends nothing more.
    with connect(migrated.url) as connection:
        [(outcome,)] = connection.execute(
            "SELECT outcome FROM evidence_assessments WHERE id = %s", (UUID(second["run_id"]),)
        ).fetchall()
        assert dispositions.end_by_check(
            connection.cursor(), organization_id=UUID(str(bench.team["org"])),
            project_id=UUID(str(bench.team["project"])), control_id=UUID(bench.control),
            requirement_id=UUID(bench.item_id), run_id=UUID(second["run_id"]),
            outcome=outcome, in_force=[UUID(ticket)],
        ) == 0  # fmt: skip
    assert len(_events(bench, dispositions.ENDED_BY_CHECK)) == 2


def test_shown_on_my_review_ends_with_its_annotation(migrated: Database) -> None:
    bench = _Bench(migrated, "ad-annotation")
    ticket, first = _first_check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    ids = _ids(first)
    owner, owner_name = bench.team["owner_id"], bench.name(bench.team["owner_id"])
    annotations = f"{bench.base}/controls/{bench.control}/evidence-annotations"
    mine = _annotate(bench, ticket, ids["B"], ids["C"])
    recorded = {}
    for code in ("B", "C"):
        done = _record(bench, ids[code], "SHOWN_ON_REVIEW", annotation_id=mine)
        assert done.status_code == 200, done.text
        recorded[code] = _by_code(done.json())[code]["disposition"]["id"]
    # Another kind on D rests on no annotation, and is never ended by one.
    assert _record(bench, ids["D"], "NOT_AVAILABLE").status_code == 200

    # The person takes B off the annotation: what rested on it for B no longer stands,
    # in the same act; for C it still does.
    edited = bench.owner.post(
        f"{annotations}/{mine}/edit", json={"version": 1, "attribute_ids": [ids["C"]]}
    )
    assert edited.status_code == 200, edited.text
    entry = _by_code(bench.entry())
    assert entry["B"]["disposition"] is None
    [ended] = entry["B"]["disposition_history"]
    assert (ended["id"], ended["ended_as"], ended["ended_by_name"], ended["version"]) == (
        recorded["B"], "ANNOTATION_GONE", owner_name, 2,
    )  # fmt: skip
    assert ended["ended_reason"] == "The annotation it rests on no longer names this attribute."
    assert entry["C"]["disposition"]["id"] == recorded["C"]
    [(actor, agent, event)] = _events(bench, dispositions.ANNOTATION_GONE_EVENT)
    assert (actor, agent) == (owner, None)
    assert event == {
        "control_id": bench.control, "attribute_id": ids["B"], "disposition_id": recorded["B"],
        "kind": "SHOWN_ON_REVIEW", "ended_as": "ANNOTATION_GONE", "annotation_id": mine,
        "reason": "The annotation it rests on no longer names this attribute.",
    }  # fmt: skip
    # An edit that leaves the attribute named ends nothing.
    worded = bench.owner.post(
        f"{annotations}/{mine}/edit", json={"version": 2, "statement": "The approval line."}
    )
    assert worded.status_code == 200, worded.text
    assert _by_code(bench.entry())["C"]["disposition"]["id"] == recorded["C"]

    # The person removes the annotation: what rested on it no longer stands.
    removed = bench.owner.post(f"{annotations}/{mine}/remove", json={"version": 3})
    assert removed.status_code == 200, removed.text
    entry = _by_code(bench.entry())
    assert entry["C"]["disposition"] is None
    [ended] = entry["C"]["disposition_history"]
    assert (ended["id"], ended["ended_as"], ended["ended_by_name"]) == (
        recorded["C"], "ANNOTATION_GONE", owner_name,
    )  # fmt: skip
    assert ended["ended_reason"] == "The annotation it rests on was removed."
    assert len(_events(bench, dispositions.ANNOTATION_GONE_EVENT)) == 2
    assert entry["D"]["disposition"]["kind"] == "NOT_AVAILABLE"
    # The annotation's own events are as they always were.
    assert len(bench.audit("evidence_annotation.removed", mine)) == 1
    assert len(bench.audit("evidence_annotation.edited", mine)) == 2

    # A file no longer in force. The change log arrives and is checked; the person rests
    # "Shown, on my review" for B on an annotation of theirs on it.
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    second = _check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    assert _by_code(second)["D"]["disposition"]["kind"] == "NOT_AVAILABLE"
    on_log = _annotate(bench, log, ids["B"])
    done = _record(bench, ids["B"], "SHOWN_ON_REVIEW", annotation_id=on_log)
    assert done.status_code == 200, done.text
    on_b = _by_code(done.json())["B"]["disposition"]["id"]
    # The change log is withdrawn: the request is back on the ticket alone, and the first
    # check of that very basis is copied with no model call. The copy finishes as it is
    # recorded, so it ends what rested on the file, as any finished check would.
    withdrawn = bench.owner.post(
        f"{bench.base}/evidence-files/{log}/withdraw", json={"reason": "Sent in error"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    copied = bench.entry()
    assert copied["status"] == "REVIEWED" and copied["run_id"] not in (
        first["run_id"], second["run_id"],
    )  # fmt: skip
    assert str(bench.runs()[-1][4]) == first["run_id"]
    b = _by_code(copied)["B"]
    assert b["disposition"] is None
    assert (b["disposition_history"][0]["id"], b["disposition_history"][0]["ended_as"]) == (
        on_b, "ANNOTATION_GONE",
    )  # fmt: skip
    assert b["disposition_history"][0]["ended_by_name"] is None
    assert b["disposition_history"][0]["ended_reason"] == (
        "The file its annotation is on is no longer in force on this request."
    )
    by_check = _events(bench, dispositions.ENDED_BY_CHECK)
    assert [(actor, agent) for actor, agent, _payload in by_check] == [(None, None)]
    assert (by_check[0][2]["ended_as"], by_check[0][2]["run_id"], by_check[0][2]["finds"]) == (
        "ANNOTATION_GONE", copied["run_id"], "OTHER",
    )  # fmt: skip
    # What rests on no annotation stands through it all.
    assert _by_code(copied)["D"]["disposition"]["kind"] == "NOT_AVAILABLE"
    # The annotation is still a person's, on record; its file is not in force, so it
    # carries nothing now.
    _refused(
        bench, dispositions.ANNOTATION_FILE_GONE,
        lambda: _record(bench, ids["B"], "SHOWN_ON_REVIEW", annotation_id=on_log),
    )  # fmt: skip
    assert dispositions.ANNOTATION_FILE_GONE == (
        "The annotation chosen is on a file that is no longer in force on this request."
    )


def test_only_a_person_who_may_decide_evidence_records_or_reopens(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    outsider = _Bench(migrated, "ad-roles-b").client
    bench = _Bench(migrated, "ad-roles")
    _ticket, first = _first_check(bench, B="ABSENT")
    ids = _ids(first)
    assert _record(bench, ids["B"], "NOT_APPLICABLE").status_code == 200
    before = _state(bench)

    def asks(client: TestClient | None) -> list[Any]:
        return [_record(bench, ids["B"], "EXCEPTION", client), _reopen(bench, ids["B"], 1, client)]

    # A Reviewer reads the dispositions and records nothing.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert [answer.status_code for answer in asks(reviewer)] == [403, 403]
    seen = next(
        r for r in bench.assurance(reviewer)["requests"] if r["requirement_id"] == bench.item_id
    )
    assert _by_code(seen)["B"]["disposition"]["kind"] == "NOT_APPLICABLE"
    # Another firm's person: not found. No session: not signed in.
    assert [answer.status_code for answer in asks(outsider)] == [404, 404]
    anonymous = TestClient(bench.owner.app)
    assert [answer.status_code for answer in asks(anonymous)] == [401, 401]
    # The routes take their principal from the session, which is always a person's; an
    # agent principal reaching them is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(dispositions, "_session_principal", lambda _request: agent)
        assert all(answer.status_code in (403, 404) for answer in asks(None))
    assert _state(bench) == before

    # An archived engagement is read-only, as for a rerun: the middleware refuses every
    # change, and the table refuses a write that reaches it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    for answer in (*asks(None), bench.rerun()):
        assert answer.status_code == 409, answer.text
        assert answer.json()["detail"] == closed_detail("ARCHIVED")
    assert _state(bench) == before
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        connection.execute(
            "UPDATE attribute_dispositions SET ended_at = clock_timestamp(), "
            "ended_by = recorded_by, ended_as = 'REPLACED', version = version + 1"
        )
    # It is still read.
    assert _by_code(bench.entry())["B"]["disposition"]["kind"] == "NOT_APPLICABLE"


def test_where_the_migration_is_not_applied_nothing_is_read_or_ended_and_nothing_else_fails(
    migrated: Database,
) -> None:
    """The code released before migration 0162: there is no record of a disposition, so
    none is read and none is ended, and the D&I list, a check that finishes, an annotation
    a person removes and the workpaper all work as before. Only recording is refused."""
    bench = _Bench(migrated, "ad-unmigrated")
    with connect(migrated.url) as connection:
        connection.execute("DROP TABLE attribute_dispositions")
    # A check finishes and is read, with nothing standing and nothing ended.
    ticket, first = _first_check(bench, B="ABSENT")
    assert [a["verdict"] for a in first["attributes"]].count("ISSUE") == 1
    for attribute in first["attributes"]:
        assert attribute["disposition"] is None and attribute["disposition_history"] == []
    assert len(bench.audit("evidence.assessed", bench.item_id)) == 1
    # A person's annotation is added, edited and removed.
    ids = _ids(first)
    annotations = f"{bench.base}/controls/{bench.control}/evidence-annotations"
    mine = _annotate(bench, ticket, ids["A"], ids["B"])
    edited = bench.owner.post(
        f"{annotations}/{mine}/edit", json={"version": 1, "attribute_ids": [ids["B"]]}
    )
    assert edited.status_code == 200, edited.text
    removed = bench.owner.post(f"{annotations}/{mine}/remove", json={"version": 2})
    assert removed.status_code == 200, removed.text
    # The workpaper reads.
    paper = bench.owner.get(f"{bench.base}/controls/{bench.control}/design-workpaper")
    assert paper.status_code == 200, paper.text
    assert not [m for m in paper.json()["matters"] if m["kind"] == "DISPOSITION"]
    # Recording has nowhere to be kept: it fails as a whole, and says nothing was done.
    assert _record(bench, ids["B"], "NOT_APPLICABLE").status_code == 503
    assert bench.entry() == first
