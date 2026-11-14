"""The D&I workpaper's assembled view through its route (docs/design-workpaper.md, section
2), with scripted readings, a scripted draft and synthetic files only: no model, no client
evidence.

- A control with no workpaper reads, and says so; who may read is who may read the
  engagement, and a control of another engagement or organization is not found.
- A drafted workpaper with a finished engine 2 check: the evidence index, each attribute's
  state with the check's own sentence, the references with the numbers the annotation
  viewer shows, the walkthrough row by row, procedures only for what was done, the matters.
  Nothing a reading wrote freely is in it, and reading it writes nothing.
- A file serving two requests is listed once, under its first.
- A check that is out of date, or queued, contributes nothing, and the view says so.
- An engine 1 check gives states and SHOWS marks: no comparison, no follow-up.
- A conclusion is signed only from the D&I conclusion's sign-off record, while it holds.
- A second completed run keeps the first run's annotations it still cites: they stand by
  their request's check, never by the run that first proposed them. What the run's review
  says is not yet reliable is a matter and takes the tickmarks away; a report whose
  parameters are shown is a procedure, and only then is its mark in the legend.
"""

import json
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_assurance_engine2 import _all_met, _engine_2, _fact, _late, _said
from test_assurance_forward_only import _as_engine_1
from test_evidence_analysis import _Provider
from test_evidence_annotations import TICKET_REFERENCE, _first_run, _second_plan
from test_evidence_assurance import (
    APPROVAL,
    GRANT,
    LOG,
    TICKET,
    _Bench,
    _index,
    _reading,
    _Readings,
)
from test_execution import _add_user
from test_outbound import _session, migrated

from ai_workforce_api import design_workpaper as view
from ai_workforce_api import evidence_assurance as engine
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.design_workpaper import ONLY_OUT_OF_DATE, SEPARATE_NOTE, STATE_BASIS
from ai_workforce_api.evidence_findings import OPEN
from ai_workforce_api.workpaper_service import run_draft

__all__ = ["migrated"]

KEYS = {
    "control", "workpaper", "review", "risk", "activity", "facts", "understanding",
    "procedures", "evidence", "walkthrough", "attributes", "reports", "matters", "conclusion",
    "tickmarks", "can_edit",
}  # fmt: skip
STATE_OF = {
    "CONTRADICTED": "EXCEPTION",
    "SATISFIED": "SHOWN",
    "PARTIALLY_SUPPORTED": "SHOWN_IN_PART",
    "NOT_DEMONSTRATED": "NOT_SHOWN",
    "INDETERMINATE": "NOT_CONCLUDED",
}
UNDERSTANDING = "Managers approve new access in the request tool before SAP Security grants it."
CONCLUSION = "The walkthrough supports the design; the timing of the grant needs a second look."
# Tables a read of the view must leave exactly as they were.
WATCHED = (
    "audit_events", "evidence_annotations", "evidence_word_boxes", "evidence_assessments",
    "evidence_findings", "evidence_finding_events", "workpapers", "workpaper_versions",
    "model_calls", "design_conclusions", "evidence_analyses",
)  # fmt: skip


def _url(bench: _Bench, control: str | None = None) -> str:
    return f"{bench.base}/controls/{control or bench.control}/design-workpaper"


def _view(bench: _Bench, client: TestClient | None = None) -> dict[str, Any]:
    found = (client or bench.owner).get(_url(bench))
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    assert set(body) == KEYS
    return body


def _by_code(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {attribute["code"]: attribute for attribute in body["attributes"]}


def _approved(bench: _Bench) -> list[str]:
    return [
        str(row[0])
        for row in bench.rows(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            UUID(bench.control),
        )
    ]


def _snapshot(bench: _Bench) -> dict[str, Any]:
    """How many rows each watched table holds, and when a row of it last changed."""
    found: dict[str, Any] = {}
    for table in WATCHED:
        found[table] = bench.rows(f"SELECT count(*) FROM {table}")[0][0]  # noqa: S608
    for table in ("evidence_assessments", "evidence_annotations", "workpapers"):
        found[f"{table} changed"] = bench.rows(
            f"SELECT max(updated_at) FROM {table}"  # noqa: S608
        )[0][0]
    return found


def _statuses(bench: _Bench) -> dict[str, str]:
    """Each request's check status as the view's own loader reads it."""
    project, control_id = UUID(str(bench.team["project"])), UUID(bench.control)
    with connect(bench.database.url) as connection:
        control = engine._control(connection, project, control_id)
        assert control is not None
        found = view.load_checks(
            connection, project, control_id, control,
            engine._requests(connection, project, control_id),
            engine._approved(connection, control_id), engine._linked(connection, control_id),
        )  # fmt: skip
    return {str(requirement): check.status for requirement, check in found.items()}


def _same_as_the_evidence_list(bench: _Bench) -> None:
    """The view reads each check with the status the D&I evidence list gives it."""
    listed = {r["requirement_id"]: r["status"] for r in bench.assurance()["requests"]}
    assert _statuses(bench) == listed and listed


def _draft_design(bench: _Bench, draft: dict[str, Any] | None) -> dict[str, Any]:
    """The control's design workpaper, opened by a person and drafted by the scripted
    answer (or from the records alone, with None)."""
    base = f"{bench.base}/workpapers"
    opened = bench.owner.post(f"{base}/draft", json={"control_id": bench.control})
    assert opened.status_code == 200, opened.text
    design = next(paper for paper in opened.json() if paper["stage"] == "DESIGN")
    with connect(bench.database.url) as connection:
        provider = None if draft is None else _Provider([draft])
        assert run_draft(connection, provider, UUID(design["id"])) == "DONE"
    listed = bench.owner.get(base, params={"control_id": bench.control}).json()
    paper: dict[str, Any] = next(item for item in listed if item["stage"] == "DESIGN")
    return paper


def _checked(bench: _Bench) -> tuple[str, str]:
    """The ticket and the change log on the request, read, and checked by engine 2: A is
    shown and its comparison passes, B is contradicted by a comparison of the records'
    own times, every other attribute is shown."""
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("walkthrough"), _reading("change_history"))
    readings = _Readings(_engine_2(_all_met, _late), _engine_2(_all_met, _late))
    assert bench.check(readings) == ["READY"]
    return ticket, log


def test_a_control_with_no_workpaper_reads_and_only_the_engagements_readers_see_it(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "dw-none")
    body = _view(bench)
    [(engagement,)] = bench.rows("SELECT name FROM projects WHERE id = %s", bench.team["project"])
    assert body["control"] == {
        "id": bench.control, "ref": "ITGC-AC-01", "title": body["control"]["title"],
        "system": "SAP ERP", "engagement": engagement, "area": "IT general controls",
    }  # fmt: skip
    assert body["control"]["title"] and body["risk"] and body["activity"]
    # No D&I workpaper yet: the views say so and offer the existing "Draft" action.
    assert body["workpaper"] is None and body["can_edit"] is False
    assert (body["facts"], body["understanding"], body["reports"]) == ([], "", [])
    assert body["walkthrough"] == {"columns": [], "steps": [], "source": "RECORDS"}
    assert (body["evidence"], body["procedures"]) == ([], [])
    assert body["review"] == {
        "status": "NOT_READY", "proposed": None, "signed_verdict": None, "signed_by": None,
        "signed_at": None, "out_of_date": [],
    }  # fmt: skip
    assert body["conclusion"] == {
        "text": "", "source": "RECORDS", "proposed": None, "words": "Not concluded yet",
        "signed": False,
    }  # fmt: skip
    # Every approved attribute, in the list's order, and none tested yet.
    approved = _approved(bench)
    assert [a["id"] for a in body["attributes"]] == approved and len(approved) >= 3
    assert [a["code"] for a in body["attributes"]][:3] == ["A", "B", "C"]
    for attribute in body["attributes"]:
        assert set(attribute) == {
            "id", "code", "text", "state", "state_words", "basis", "tickmark", "refs", "marks",
            "checks", "notes",
        }  # fmt: skip
        assert (attribute["state"], attribute["state_words"]) == ("NOT_TESTED", "Not tested yet")
        assert attribute["basis"] == "No current check covers this attribute."
        assert (attribute["tickmark"], attribute["refs"], attribute["marks"]) == ("NONE", [], {})
        assert attribute["text"]
    assert body["matters"] == [
        {"state": "NOTED", "kind": "NOTE", "text": SEPARATE_NOTE, "refs": []}
    ]
    # The legend: no report's parameters were inspected, so their mark is not in it.
    assert [(t["mark"], t["symbol"]) for t in body["tickmarks"]] == [
        ("AGREED", "\u2713"), ("COMPARED", "\u2261"), ("EXCEPTION", "\u2717"),
    ]  # fmt: skip
    assert "the client" not in json.dumps([body["matters"], body["tickmarks"]]).lower()

    # A Reviewer of the engagement reads it, and may not edit.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert _view(bench, reviewer)["can_edit"] is False
    # A member of the firm who is not on the engagement does not see it.
    with connect(migrated.url) as connection:
        stranger = _add_user(
            connection, bench.team["org"], f"off-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
    assert _session(migrated, stranger).get(_url(bench)).status_code == 404
    # Another organization's person: not found, by this path or through their own
    # engagement's path with this control's id.
    other = _Bench(migrated, "dw-other")
    assert other.owner.get(_url(bench)).status_code == 404
    assert other.owner.get(_url(other, bench.control)).status_code == 404
    assert bench.owner.get(_url(bench, other.control)).status_code == 404
    assert bench.owner.get(_url(bench, str(uuid4()))).status_code == 404
    # Nobody signed in: refused.
    anonymous = TestClient(bench.owner.app)
    assert anonymous.get(_url(bench)).status_code == 401


def test_a_drafted_workpaper_and_an_engine_2_check_are_assembled_and_nothing_is_written(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "dw-full")
    ticket, log = _checked(bench)
    draft = {
        "sections": [
            {"key": "understanding-of-the-control", "text": UNDERSTANDING},
            {"key": "design-conclusion", "text": CONCLUSION},
        ],
        "walkthrough": [
            {"step": "Access requested and approved", "who": "Priya Shah",
             "evidence": f'[cite:{ticket} "{APPROVAL}"]', "result": "Approved"},
            {"step": "Access granted", "who": "SAP Security",
             "evidence": f'[cite:{log} "{GRANT}"]', "result": "Granted on 2026-03-04 09:12"},
        ],
    }  # fmt: skip
    paper = _draft_design(bench, draft)
    entry = bench.entry()
    assert (entry["status"], entry["engine_version"]) == ("REVIEWED", 2)
    title = bench.item(bench.item_id)["title"]

    before = _snapshot(bench)
    found = bench.owner.get(_url(bench))
    assert found.status_code == 200, found.text
    body = _view(bench)
    # Reading it wrote nothing, queued nothing and called no model.
    assert _snapshot(bench) == before
    assert bench.worker.assessments == []
    _same_as_the_evidence_list(bench)
    # What a reading wrote freely (its reasons) is nowhere in it.
    assert "read for" not in found.text and "the client" not in found.text.lower()

    # The workpaper, as the existing actions take it.
    assert body["workpaper"] == {
        "id": paper["id"], "reference": paper["content"]["reference"], "status": "DRAFT",
        "drafting": False, "version": paper["version"], "shown_version": paper["shown_version"],
        "current_version": paper["current_version"], "prepared_by": None, "prepared_at": None,
    }  # fmt: skip
    assert body["workpaper"]["reference"].endswith("-TOD") and body["can_edit"] is True
    sections = {section["key"]: section for section in paper["content"]["sections"]}
    header = {f["label"]: f["value"] for f in sections["control"]["fields"]}
    assert (body["risk"], body["activity"]) == (header["Risk"], header["Control activity"])
    labels = [fact["label"] for fact in body["facts"]]
    assert "Frequency" in labels and not {"Risk", "Control", "Engagement"} & set(labels)
    assert all(header[fact["label"]] == fact["value"] for fact in body["facts"])
    # The sections' own words, as stored.
    assert body["understanding"] == sections["understanding-of-the-control"]["text"]
    assert body["understanding"] == UNDERSTANDING
    assert body["conclusion"] == {
        "text": CONCLUSION, "source": "AGENT", "proposed": None, "words": "Not concluded yet",
        "signed": False,
    }  # fmt: skip
    assert body["review"]["status"] == "NOT_READY"

    # The evidence index: each file in force once, in the list's order.
    evidence = body["evidence"]
    assert [(e["ref"], e["file_id"], e["file_name"], e["kind"]) for e in evidence] == [
        ("E1", ticket, "ticket REQ-1041.txt", "walkthrough"),
        ("E2", log, "sap change log.txt", "change_history"),
    ]
    assert [e["kind_words"] for e in evidence] == [
        "Walkthrough evidence", "Change history or audit log",
    ]  # fmt: skip
    annotated: dict[str, dict[str, Any]] = {}
    for item in evidence:
        assert (item["requirement_id"], item["requirement_title"]) == (bench.item_id, title)
        assert (item["left_out"], item["image"]) == (None, False)
        listed = bench.owner.get(
            f"{bench.base}/controls/{bench.control}/evidence-annotations",
            params={"requirement_id": bench.item_id, "file_id": item["file_id"]},
        ).json()
        assert (item["annotations"], item["reviewed"]) == (listed["total"], listed["reviewed"])
        annotated[item["ref"]] = listed
    assert sum(item["annotations"] for item in evidence) > 0

    # Each attribute's state is the current check's, with the check's own sentence.
    checked = {a["code"]: a for a in entry["attributes"]}
    attributes = _by_code(body)
    assert set(attributes) == set(checked)
    for code, attribute in attributes.items():
        assert attribute["state"] == STATE_OF[checked[code]["assessment"]]
        assert attribute["basis"] == checked[code]["summary"]
        files = {p["file_id"] for e in checked[code]["elements"] for p in e["passages"]}
        refs = attribute["refs"]
        assert [r["ref"] for r in refs] == [e["ref"] for e in evidence if e["file_id"] in files]
        # The numbers are the ones the annotation viewer shows for the attribute.
        for ref in refs:
            row = next(r for r in annotated[ref["ref"]]["attributes"] if r["id"] == attribute["id"])
            assert ref["annotation_ids"] == row["annotation_ids"]
            numbers = {a["id"]: a["number"] for a in annotated[ref["ref"]]["annotations"]}
            assert ref["numbers"] == [numbers[item] for item in row["annotation_ids"]]
    assert any(ref["numbers"] for a in attributes.values() for ref in a["refs"])
    a, b = attributes["A"], attributes["B"]
    # A: shown, and the comparison code made for it passed.
    assert (a["state"], a["state_words"], a["tickmark"]) == ("SHOWN", "Shown", "COMPARED")
    assert a["checks"] == [checked["A"]["checks"][0]["sentence"]] and a["marks"] == {"E1": "SHOWS"}
    assert b["checks"] == [checked["B"]["checks"][0]["sentence"]]
    # No report's parameters were inspected: no such procedure, no such mark in the legend.
    assert [t["mark"] for t in body["tickmarks"]] == ["AGREED", "COMPARED", "EXCEPTION"]
    # B: both readings said met; the records' own times say otherwise. Never "shown".
    assert (b["state"], b["state_words"], b["tickmark"]) == (
        "EXCEPTION", "Exception shown", "EXCEPTION",
    )  # fmt: skip
    assert b["basis"].startswith("A check of the records shows attribute B is not met: ")
    assert b["marks"] == {"E1": "EXCEPTION", "E2": "EXCEPTION"}
    assert [r["ref"] for r in b["refs"]] == ["E1", "E2"]
    for code, attribute in attributes.items():
        if code not in ("A", "B"):
            assert (attribute["state"], attribute["tickmark"]) == ("SHOWN", "AGREED")
            assert attribute["marks"] == {"E1": "SHOWS"} and attribute["checks"] == []

    # The walkthrough: the section's own rows and columns, with what each row names.
    walkthrough = body["walkthrough"]
    stored = sections["walkthrough-of-one-instance"]
    assert (walkthrough["columns"], walkthrough["source"]) == (stored["columns"], "AGENT")
    assert walkthrough["columns"] == ["Step", "Who", "Evidence inspected", "Result"]
    first, second = walkthrough["steps"]
    assert [first[key] for key in ("step", "who", "evidence", "result")] == stored["rows"][0]
    assert (first["number"], first["refs"], first["when"]) == (1, ["E1"], "2026-03-03")
    assert first["evidence"].startswith("ticket REQ-1041.txt")
    assert (second["number"], second["refs"]) == (2, ["E2"])
    assert second["when"] == "2026-03-04 09:12"

    # Procedures: only what the records show was done.
    assert len(body["procedures"]) == 3
    inspected, walked, compared = body["procedures"]
    assert inspected.startswith("Inspected 2 files received for 1 request: “")
    assert walked == (
        "Walked one instance of the control through 2 steps, recorded in the walkthrough."
    )
    assert compared == (
        "Compared dates and values in code for attributes A and B: 2 comparisons made."
    )

    # Matters: the open finding, the check's follow-up, and the one note.
    matters = body["matters"]
    titles = sorted(
        f["title"] for f in bench.findings(None) if f["status"] in OPEN and not f["stale"]
    )
    assert sorted(m["text"] for m in matters if m["kind"] == "FINDING") == titles and titles
    [follow_up] = entry["review"]["follow_ups"]
    assert [m for m in matters if m["kind"] == "FOLLOW_UP"] == [
        {"state": "OPEN", "kind": "FOLLOW_UP", "text": follow_up["request"], "refs": ["E1", "E2"]}
    ]
    assert matters[-1] == {"state": "NOTED", "kind": "NOTE", "text": SEPARATE_NOTE, "refs": []}
    assert all(m["state"] == "OPEN" for m in matters if m["kind"] == "FINDING")
    assert len(matters) <= view.MAX_MATTERS

    # The assembly needs no write at all: it runs whole in a read-only transaction.
    project, control_id = UUID(str(bench.team["project"])), UUID(bench.control)
    with connect(migrated.url) as connection:
        connection.execute("SET TRANSACTION READ ONLY")
        again = view.read_design_workpaper(
            connection, Principal(PrincipalKind.USER, bench.team["owner_id"]),
            UUID(str(bench.team["org"])), project, control_id,
        )  # fmt: skip
    assert json.loads(again.model_dump_json()) == body

    # A person reviews an annotation: the index counts it, and the numbers stay the viewer's.
    target = annotated["E1"]["annotations"][0]
    confirmed = bench.owner.post(
        f"{bench.base}/controls/{bench.control}/evidence-annotations/{target['id']}/confirm",
        json={"version": target["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    after = _view(bench)
    assert [e["reviewed"] for e in after["evidence"]] == [1, 0]
    assert [a["refs"] for a in after["attributes"]] == [a["refs"] for a in body["attributes"]]

    # A Reviewer reads the same view and may not edit its sections.
    _reviewer_id, reviewer = bench.member("REVIEWER")
    seen = _view(bench, reviewer)
    assert seen["can_edit"] is False and seen["attributes"] == after["attributes"]


def test_a_file_serving_two_requests_is_listed_once_under_its_first(migrated: Database) -> None:
    bench = _Bench(migrated, "dw-two")
    first, second = bench.items[0], bench.items[1]
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    item = bench.item(str(second["id"]))
    linked = bench.owner.post(
        f"{bench.base}/controls/{bench.control}/evidence-requirements/{item['id']}/files",
        json={"file_id": ticket, "reason": "It also shows this item.", "version": item["version"]},
    )
    assert linked.status_code == 200, linked.text
    other = bench.add("role listing.txt", LOG, bench.item(str(second["id"])))
    bench.read_next(_reading("change_history"))
    # The ticket serves both requests; the listing serves the second alone.
    serving = {
        str(row[0])
        for row in bench.rows(
            "SELECT requirement_id FROM evidence_requirement_files WHERE evidence_file_id = %s "
            "AND status = 'LINKED'",
            UUID(ticket),
        )
    }
    assert serving == {str(second["id"])}
    body = _view(bench)
    assert [(e["ref"], e["file_id"], e["requirement_id"]) for e in body["evidence"]] == [
        ("E1", ticket, str(first["id"])),
        ("E2", other, str(second["id"])),
    ]
    assert [e["requirement_title"] for e in body["evidence"]] == [first["title"], second["title"]]
    _same_as_the_evidence_list(bench)


def test_a_check_that_is_out_of_date_or_queued_contributes_nothing(migrated: Database) -> None:
    bench = _Bench(migrated, "dw-stale")
    _checked(bench)
    current = _view(bench)
    assert {a["state"] for a in current["attributes"]} == {"SHOWN", "EXCEPTION"}
    approved = _approved(bench)
    # The request no longer asks for its first attribute: the run rests on what was.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
            "AND attribute_id = %s",
            (UUID(bench.item_id), UUID(approved[0])),
        )
    entry = bench.entry()
    assert entry["status"] == "OUT_OF_DATE" and entry["out_of_date"]
    _same_as_the_evidence_list(bench)
    body = _view(bench)
    for attribute in body["attributes"]:
        assert (attribute["state"], attribute["tickmark"]) == ("NOT_TESTED", "NONE")
        assert (attribute["refs"], attribute["marks"], attribute["checks"]) == ([], {}, [])
        asked = attribute["id"] != approved[0]
        assert attribute["basis"] == (ONLY_OUT_OF_DATE if asked else STATE_BASIS["NOT_TESTED"])
    # No procedure rests on it, and none of its follow-ups is listed.
    assert body["procedures"] == []
    assert not [m for m in body["matters"] if m["kind"] in ("FOLLOW_UP", "CONSIDERATION")]
    # The view says so, as something that waits on a person.
    [told] = [m for m in body["matters"] if m["kind"] == "UNSETTLED"]
    assert body["matters"][0] == told
    assert told["state"] == "OPEN" and told["refs"] == ["E1", "E2"]
    assert "is out of date, so nothing of it is used here." in told["text"]
    assert entry["out_of_date"][0] in told["text"]
    # The files stay on the index, with their annotations still listed for review.
    assert [e["ref"] for e in body["evidence"]] == ["E1", "E2"]
    assert [e["annotations"] for e in body["evidence"]] == [
        e["annotations"] for e in current["evidence"]
    ]

    # A person starts the check again: while it is queued it gives nothing either.
    assert bench.rerun().status_code == 202
    assert bench.entry()["status"] == "QUEUED"
    _same_as_the_evidence_list(bench)
    queued = _view(bench)
    assert {a["state"] for a in queued["attributes"]} == {"NOT_TESTED"}
    assert {a["basis"] for a in queued["attributes"]} == {STATE_BASIS["NOT_TESTED"]}
    assert all(a["marks"] == {} and a["refs"] == [] for a in queued["attributes"])
    assert queued["procedures"] == []
    assert not [
        m for m in queued["matters"] if m["kind"] in ("FOLLOW_UP", "CONSIDERATION", "UNSETTLED")
    ]


def test_an_engine_1_check_gives_states_and_shows_marks_only(migrated: Database) -> None:
    bench = _Bench(migrated, "dw-e1")
    ticket = bench.add("ticket REQ-1041.txt", TICKET)
    bench.read_next(_reading("walkthrough"))
    approved = _approved(bench)
    run_id = _as_engine_1(bench, "QUEUED")
    passage = [{"quote": APPROVAL, "file_id": ticket, "location": {}}]

    def element(result: str | None, deviation: bool = False, cited: bool = True) -> dict[str, Any]:
        return {
            "key": "wording",
            "text": "the attribute",
            "result": result,
            "passages": passage if cited else [],
            "absent": [],
            "deviation": deviation,
        }

    def outcome(index: int, verdict: str, result: str | None, **over: Any) -> dict[str, Any]:
        return {
            "attribute_id": approved[index], "code": "ABC"[index], "expected": True,
            "verdict": verdict, "result": result, "summary": f"Engine 1 on {'ABC'[index]}.",
            "pending": "", "shows": None, "passages": [], "absent": [], "views": [],
            "elements": [], **over,
        }  # fmt: skip

    recorded = [
        # A comparison is nothing an engine 1 check ever made: one found here is not read.
        outcome(0, "SUPPORTED", "MET", passages=passage, elements=[element("MET")],
                shows="IMPLEMENTATION",
                checks=[{"element": "wording", "test": "NOT_AFTER", "status": "PASSED",
                         "sentence": "A comparison engine 1 never made."}]),
        outcome(1, "ISSUE", "NOT_MET", passages=passage, elements=[element("NOT_MET", True)]),
        outcome(2, "UNSETTLED", None, elements=[element(None, cited=False)],
                views=[{"role": "ASSESSOR", "result": "MET", "reason": "one reading's words"}]),
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        # As a finished engine 1 run stands: reviewed, with its outcome on record.
        connection.execute(
            "UPDATE evidence_assessments SET status = 'READY', stage = 'DONE', "
            "finished_at = clock_timestamp(), ran_with = models, outcome = %s::jsonb, "
            "assessor_opinion = '{}'::jsonb, reviewer_opinion = '{}'::jsonb WHERE id = %s",
            (json.dumps(recorded), run_id),
        )
    entry = bench.entry()
    assert (entry["status"], entry["engine_version"], entry["review"]) == ("REVIEWED", 1, None)
    _same_as_the_evidence_list(bench)

    found = bench.owner.get(_url(bench))
    body = _view(bench)
    attributes = _by_code(body)
    a, b, c = attributes["A"], attributes["B"], attributes["C"]
    # Its state from the check's own element results; its SHOWS mark from their passages.
    assert (a["state"], a["basis"], a["tickmark"]) == ("SHOWN", "Engine 1 on A.", "NONE")
    assert (a["marks"], a["checks"]) == ({"E1": "SHOWS"}, [])
    assert a["refs"] == [{"ref": "E1", "annotation_ids": [], "numbers": []}]
    # An issue that rests on a record of the deviation is an exception shown.
    assert (b["state"], b["tickmark"], b["marks"]) == (
        "EXCEPTION",
        "EXCEPTION",
        {"E1": "EXCEPTION"},
    )
    assert (c["state"], c["tickmark"], c["marks"]) == ("NOT_CONCLUDED", "NONE", {})
    for code, attribute in attributes.items():
        if code not in "ABC":
            assert attribute["state"] == "NOT_TESTED"
    # No comparison, fact or follow-up comes from it.
    marks = {mark for attribute in body["attributes"] for mark in attribute["marks"].values()}
    assert marks == {"SHOWS", "EXCEPTION"}
    assert all(attribute["tickmark"] != "COMPARED" for attribute in body["attributes"])
    assert body["procedures"] == [body["procedures"][0]]
    assert body["procedures"][0].startswith("Inspected 1 file received for 1 request: “")
    kinds = [m["kind"] for m in body["matters"]]
    assert "FOLLOW_UP" not in kinds and "CONSIDERATION" not in kinds
    [left] = [m for m in body["matters"] if m["kind"] == "UNSETTLED"]
    assert left == {
        "state": "OPEN", "kind": "UNSETTLED", "refs": [],
        "text": "Attribute C is not concluded. Engine 1 on C.",
    }  # fmt: skip
    assert "one reading's words" not in found.text and "never made" not in found.text
    assert body["evidence"][0]["annotations"] == 0


def test_a_conclusion_is_signed_only_from_its_sign_off_record(migrated: Database) -> None:
    bench = _Bench(migrated, "dw-sign")
    paper = _draft_design(bench, None)
    drafted = _view(bench)
    assert (drafted["workpaper"]["status"], drafted["can_edit"]) == ("DRAFT", True)
    assert drafted["review"]["status"] == "NOT_READY" and drafted["conclusion"]["signed"] is False
    assert drafted["conclusion"]["words"] == "Not concluded yet"

    prepared = bench.owner.post(
        f"{bench.base}/workpapers/{paper['id']}/prepare", json={"version": paper["version"]}
    )
    assert prepared.status_code == 200, prepared.text
    version = prepared.json()["prepared_version"]
    body = _view(bench)
    # Prepared: the records propose a verdict. Proposed is never presented as signed.
    assert body["workpaper"]["status"] == "PREPARED" and body["can_edit"] is False
    assert body["workpaper"]["prepared_by"] == bench.name(bench.team["owner_id"])
    assert body["workpaper"]["prepared_at"] is not None
    assert body["review"] == {
        "status": "TO_SIGN", "proposed": "EFFECTIVE", "signed_verdict": None, "signed_by": None,
        "signed_at": None, "out_of_date": [],
    }  # fmt: skip
    conclusion = body["conclusion"]
    assert (conclusion["proposed"], conclusion["words"], conclusion["signed"]) == (
        "EFFECTIVE", "Effective", False,
    )  # fmt: skip
    # Reading the view signs nothing.
    assert bench.rows("SELECT count(*) FROM design_conclusions") == [(0,)]

    # A reviewer who did not prepare it signs the conclusion, through its own route.
    reviewer_id, reviewer = bench.member("ADMIN")
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO project_memberships (organization_id, project_id, user_id, "
            "engagement_role) VALUES (%s, %s, %s, 'REVIEWER') "
            "ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'",
            (bench.team["org"], bench.team["project"], reviewer_id),
        )
    signed = reviewer.post(
        f"{bench.base}/design-conclusions/{bench.control}/sign-off",
        json={"verdict": "EFFECTIVE", "workpaper_version": version, "note": "Walked through."},
    )
    assert signed.status_code == 200, signed.text
    body = _view(bench)
    review = body["review"]
    assert (review["status"], review["signed_verdict"], review["out_of_date"]) == (
        "SIGNED_OFF", "EFFECTIVE", [],
    )  # fmt: skip
    assert review["signed_by"] == bench.name(reviewer_id) and review["signed_at"] is not None
    assert body["conclusion"]["signed"] is True and body["conclusion"]["words"] == "Effective"

    # A design deficiency logged afterwards: the sign-off no longer holds, and the view
    # no longer presents the conclusion as signed.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO deficiencies (organization_id, project_id, reference, "
            "engagement_control_id, title, deficiency_type, identified_by) "
            "VALUES (%s, %s, 'D-901', %s, 'No approval step in the design', 'DESIGN', %s)",
            (bench.team["org"], bench.team["project"], bench.control, bench.team["owner_id"]),
        )
    body = _view(bench)
    review = body["review"]
    assert (review["status"], review["proposed"], review["signed_verdict"]) == (
        "OUT_OF_DATE", "NOT_EFFECTIVE", "EFFECTIVE",
    )  # fmt: skip
    assert review["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    conclusion = body["conclusion"]
    assert (conclusion["signed"], conclusion["proposed"], conclusion["words"]) == (
        False, "NOT_EFFECTIVE", "Not effective",
    )  # fmt: skip
    assert bench.rows("SELECT count(*) FROM design_conclusions") == [(1,)]


def _second_extra(facts: dict[str, Any]) -> dict[str, Any]:
    """The second run's readings on the files: the ticket was prepared by a person and its
    reference and source are cited again, in the same words; the change log is a report
    that shows its source, run date and parameters."""
    ticket, log = _index(facts, "ticket REQ-1041.txt"), _index(facts, "sap change log.txt")
    return {
        "files": [
            _said(ticket, source="MANAGEMENT_PREPARED")[0] | {"quote": TICKET_REFERENCE},
            _said(log)[0] | {"report_basis": "SHOWN"},
        ],
        "facts": [_fact("F1", "REFERENCE", "REQ-1041", ticket, TICKET_REFERENCE)],
    }


def test_a_second_run_keeps_what_it_still_cites_and_its_review_is_said(
    migrated: Database,
) -> None:
    bench = _Bench(migrated, "dw-runs")
    ticket, first_run = _first_run(bench)
    annotations = f"{bench.base}/controls/{bench.control}/evidence-annotations"

    def listed(file_id: str) -> list[dict[str, Any]]:
        found = bench.owner.get(
            annotations, params={"requirement_id": bench.item_id, "file_id": file_id}
        )
        assert found.status_code == 200, found.text
        items: list[dict[str, Any]] = found.json()["annotations"]
        return items

    reference, source, _requested, approved = listed(ticket)
    assert (reference["kind"], source["kind"], approved["kind"]) == (
        "IDENTIFIES", "SOURCE", "SHOWS",
    )  # fmt: skip
    first = _view(bench)
    # One file, and every attribute shown in it: the passage outranks what identifies.
    assert {tuple(a["marks"].items()) for a in first["attributes"]} == {(("E1", "SHOWS"),)}
    assert {a["tickmark"] for a in first["attributes"]} == {"AGREED"}
    assert [m["kind"] for m in first["matters"]] == ["NOTE"]

    # The change log arrives. The second run cites the approval, the reference and the
    # source again (kept, as the first run wrote them), and shows B by the grant instead.
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    script = _engine_2(_second_plan, _second_extra)
    assert bench.check(_Readings(script, script)) == ["READY"]
    entry = bench.entry()
    second_run = str(entry["run_id"])
    assert entry["status"] == "REVIEWED" and second_run != first_run
    _same_as_the_evidence_list(bench)
    # What the second run still cites keeps the first run's id; nothing says the second's.
    kept = {
        str(row[0]): (str(row[1]), str(row[2]))
        for row in bench.rows(
            "SELECT id, assessment_id, status FROM evidence_annotations "
            "WHERE evidence_file_id = %s AND requirement_id = %s",
            UUID(ticket), UUID(bench.item_id),
        )
    }  # fmt: skip
    for item in (reference, source, approved):
        assert kept[item["id"]] == (first_run, "PROPOSED")
    after = listed(ticket)
    assert [a["id"] for a in after] == [reference["id"], source["id"], approved["id"]]

    body = _view(bench)
    attributes = _by_code(body)
    assert {a["state"] for a in body["attributes"]} == {"SHOWN"}
    # They stand by their request's check, whichever run first proposed them: the
    # approval is cited as the basis, with the number the viewer shows for it.
    number = next(a["number"] for a in after if a["id"] == approved["id"])
    for code, attribute in attributes.items():
        if code != "B":
            assert attribute["refs"] == [
                {"ref": "E1", "annotation_ids": [approved["id"]], "numbers": [number]}
            ]
            assert attribute["marks"] == {"E1": "SHOWS"}
    # B is shown by the grant now. The ticket still identifies the right record for it:
    # a mark only an annotation gives, kept from the first run.
    [granted] = listed(log)
    assert attributes["B"]["refs"] == [
        {"ref": "E2", "annotation_ids": [granted["id"]], "numbers": [granted["number"]]}
    ]
    assert attributes["B"]["marks"] == {"E1": "IDENTIFIES", "E2": "SHOWS"}

    # The run's review says the ticket was prepared by a person: a matter, in the review's
    # own sentence, and nothing is marked as agreed while reliability is unresolved.
    completeness = entry["review"]["completeness"]
    assert completeness["state"] == "RELIABILITY_UNRESOLVED" and completeness["reasons"]
    said = [m for m in body["matters"] if m["kind"] == "COMPLETENESS"]
    assert [m["text"] for m in said] == completeness["reasons"]
    assert all(m["state"] == "OPEN" and m["refs"] == ["E1"] for m in said)
    assert "ticket REQ-1041.txt was prepared by a person" in said[0]["text"]
    assert {a["tickmark"] for a in body["attributes"]} == {"NONE"}
    # The change log shows its source, run date and parameters: a procedure, and only
    # with it the legend's mark for inspected parameters.
    assert body["procedures"][-1] == (
        "Inspected the source, run date and parameters shown on 1 report: "
        "\u201csap change log.txt\u201d."
    )
    assert body["procedures"][0].startswith("Inspected 2 files received for 1 request: ")
    assert [t["mark"] for t in body["tickmarks"]] == [
        "AGREED", "COMPARED", "INSPECTED", "EXCEPTION",
    ]  # fmt: skip

    # A person confirms the source. The request then stops asking for its first
    # attribute: the check is out of date and the agent's unreviewed proposals stand for
    # nothing, while the one a person confirmed still marks its file.
    confirmed = bench.owner.post(
        f"{annotations}/{source['id']}/confirm", json={"version": source["version"]}
    )
    assert confirmed.status_code == 200, confirmed.text
    approved_ids = _approved(bench)
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
            "AND attribute_id = %s",
            (UUID(bench.item_id), UUID(approved_ids[0])),
        )
    assert bench.entry()["status"] == "OUT_OF_DATE"
    stale = _view(bench)
    for attribute in stale["attributes"]:
        assert (attribute["state"], attribute["refs"]) == ("NOT_TESTED", [])
        asked = attribute["id"] != approved_ids[0]
        assert attribute["marks"] == ({"E1": "SOURCE"} if asked else {})
    assert not [m for m in stale["matters"] if m["kind"] == "COMPLETENESS"]
    assert [t["mark"] for t in stale["tickmarks"]] == ["AGREED", "COMPARED", "EXCEPTION"]
    assert stale["matters"][0]["kind"] == "UNSETTLED"
