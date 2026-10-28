"""Prior-year references (decided by the product owner on 25 October 2026, migration 0112).
The agent matches a prior-year document to this year's controls and proposes what to carry
forward; a person confirms each match and accepts or dismisses each proposal. Prior-year
work is a reference, never evidence that a control operated this year."""

from typing import Any
from uuid import UUID

from support import Database
from test_engagement_close import _launched
from test_execution import _ready
from test_outbound import migrated
from test_system_applicability import _Scripted
from test_testing_engine import _base as _project_base

from ai_workforce_api.control_context import context_package, linked_documents
from ai_workforce_api.db import connect
from ai_workforce_api.pbc_drafting import load_context
from ai_workforce_api.prior_year import (
    ANALYSIS_SYSTEM,
    _Control,
    open_runs,
    reference_matches,
    run_prior_year,
)

__all__ = ["migrated"]

WORKPAPER = (
    "FY2025 SOX IT General Controls testing - SAP ERP\n"
    "Control ITGC-AC-01: New user access is approved by the IT Security Manager before it "
    "is granted in SAP ERP.\n"
    "Population: 112 new users. Sample of 25 tested; no exceptions noted.\n"
    "Control ITGC-AC-02: Terminated users are removed within 2 business days.\n"
    "Exception: 2 of 25 leavers removed after 5 business days; management accepted the "
    "finding and automated the HR feed.\n"
    "Control PY-CM-9: Changes to the payroll interface are approved by the change board.\n"
)


def _controls(database: Database, project: UUID) -> dict[str, UUID]:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT control_ref, id FROM engagement_controls WHERE project_id = %s "
            "AND included ORDER BY control_ref, created_at",
            (project,),
        ).fetchall()
    found: dict[str, UUID] = {}
    for ref, control_id in rows:
        found.setdefault(str(ref), UUID(str(control_id)))
    return found


def _upload(team: dict[str, Any], text: str = WORKPAPER) -> dict[str, Any]:
    answer = team["owner"].post(
        f"{_project_base(team)}/prior-year/upload",
        params={"title": "FY2025 ITGC workpapers", "file_name": "fy25-itgc.txt"},
        content=text.encode(),
        headers={"content-type": "text/plain"},
    )
    assert answer.status_code == 200, answer.text
    body: dict[str, Any] = answer.json()["reference"]
    return body


def _run(database: Database, document_id: str, provider: Any = None) -> str:
    with connect(database.url) as connection:
        return run_prior_year(connection, provider, UUID(document_id))


def _reference(team: dict[str, Any], document_id: str) -> dict[str, Any]:
    listed = team["owner"].get(f"{_project_base(team)}/prior-year").json()
    found: dict[str, Any] = next(item for item in listed if item["id"] == document_id)
    return found


def _analysis(quote_answer: str = "IT Security Manager") -> dict[str, Any]:
    return {
        "answers": [
            {"slot": "admin-role", "value": "Prior year: IT Security Manager.",
             "quote": quote_answer},
            {"slot": "no-such-question", "value": "x", "quote": "IT Security Manager"},
        ],
        "exceptions": [],
        "approach": [
            {"title": "Sample of 25 new users", "detail": "Approval agreed to each request.",
             "quote": "Sample of 25 tested; no exceptions noted."},
            {"title": "Invented approach", "detail": "", "quote": "words not in the document"},
        ],
        "design_changes": [
            {"title": "Approver named differently",
             "detail": "The prior year names the IT Security Manager as approver.",
             "quote": "approved by the IT Security Manager"},
        ],
    }  # fmt: skip


def _leavers() -> dict[str, Any]:
    return {
        "answers": [],
        "exceptions": [
            {"title": "Late removal of leavers", "detail": "Two leavers removed late.",
             "quote": "2 of 25 leavers removed after 5 business days"},
        ],
        "approach": [],
        "design_changes": [],
    }  # fmt: skip


def test_the_rules_match_by_reference_without_a_model(migrated: Database) -> None:
    team = _launched(migrated, "py-rules")
    controls = _controls(migrated, team["project"])
    reference = _upload(team)
    assert reference["run_status"] == "PENDING"
    with connect(migrated.url) as connection:
        assert UUID(reference["id"]) in open_runs(connection, team["project"])
    assert _run(migrated, reference["id"]) == "DONE"
    reference = _reference(team, reference["id"])
    assert reference["run_status"] == "IDLE"
    assert "No model is configured" in reference["run_note"]
    matched = {item["control_ref"]: item for item in reference["matches"]}
    assert set(matched) == {"ITGC-AC-01", "ITGC-AC-02"}
    first = matched["ITGC-AC-01"]
    assert first["basis"] == "REFERENCE" and first["status"] == "PROPOSED"
    assert first["control_id"] == str(controls["ITGC-AC-01"])
    # The part about the control, up to the next control the document names.
    assert "IT Security Manager" in first["excerpt"] and "Terminated" not in first["excerpt"]
    assert "2 of 25 leavers" in matched["ITGC-AC-02"]["excerpt"]
    # Without a model nothing is analysed, and nothing is proposed.
    assert all(item["analysis_status"] == "SKIPPED" for item in reference["matches"])
    assert all(item["proposals"] == [] for item in reference["matches"])
    # A run that finished is not run again.
    assert _run(migrated, reference["id"]) == "SKIPPED"


def test_a_reference_is_found_only_on_its_own() -> None:
    controls = [
        _Control(UUID(int=1), "AC-01", "Access", "", ""),
        _Control(UUID(int=2), "AC-011", "Other", "", ""),
    ]
    assert reference_matches("Tested ITGC-AC-01 and AC-0111 only.", controls) == []
    found = reference_matches("Row: AC-01, approved.\nRow: AC-011.", controls)
    assert [item.prior_ref for item in found] == ["AC-01", "AC-011"]
    assert found[0].excerpt == "Row: AC-01, approved."


def test_a_document_naming_no_control_waits_for_a_person(migrated: Database) -> None:
    team = _launched(migrated, "py-none")
    controls = _controls(migrated, team["project"])
    base = _project_base(team)
    reference = _upload(team, "Prior-year walkthrough of the access process.\nNo refs.\n")
    _run(migrated, reference["id"])
    item = _reference(team, reference["id"])["matches"]
    assert len(item) == 1 and item[0]["status"] == "UNMATCHED" and item[0]["basis"] == "NONE"
    path = f"{base}/prior-year/{reference['id']}/items/{item[0]['id']}"
    assigned = team["owner"].post(
        f"{path}/assign",
        json={"control_id": str(controls["ITGC-AC-01"]), "version": item[0]["version"]},
    )
    assert assigned.status_code == 200, assigned.text
    match = assigned.json()["matches"][0]
    # A person's match is confirmed, and the document becomes a source of the control.
    assert (match["status"], match["basis"], match["analysis_status"]) == (
        "CONFIRMED", "PERSON", "PENDING",
    )  # fmt: skip
    assert assigned.json()["run_status"] == "PENDING"
    with connect(migrated.url) as connection:
        assert UUID(reference["id"]) in {
            UUID(source.key)
            for source in linked_documents(connection, team["project"], controls["ITGC-AC-01"])
        }
    # Stale or repeated decisions are refused.
    again = team["owner"].post(
        f"{path}/assign",
        json={"control_id": str(controls["ITGC-AC-02"]), "version": item[0]["version"]},
    )
    assert again.status_code == 409


def test_the_agent_matches_by_description_and_quotes_the_document(migrated: Database) -> None:
    team = _launched(migrated, "py-describe")
    reference = _upload(team)
    matching = {
        "controls": [
            {"prior_ref": "PY-CM-9", "prior_title": "Payroll interface changes",
             "quote": "Changes to the payroll interface are approved", "control": None},
            {"prior_ref": "X", "prior_title": "Invented", "quote": "not in the document",
             "control": 1},
        ]
    }  # fmt: skip
    provider = _Scripted([matching, _analysis(), _analysis()])
    assert _run(migrated, reference["id"], provider) == "DONE"
    found = _reference(team, reference["id"])
    unmatched = [item for item in found["matches"] if item["status"] == "UNMATCHED"]
    # The agent's item is kept with its quote; one whose quote is not there is dropped.
    assert [item["prior_ref"] for item in unmatched] == ["PY-CM-9"]
    assert "payroll interface" in unmatched[0]["excerpt"]
    first = next(item for item in found["matches"] if item["control_ref"] == "ITGC-AC-01")
    kinds = sorted(item["kind"] for item in first["proposals"])
    # Each proposal quotes the document; an unknown question or a missing quote is dropped.
    assert kinds == ["ANSWER", "APPROACH", "DESIGN_CHANGE"]
    answer = next(item for item in first["proposals"] if item["kind"] == "ANSWER")
    # The answer is the value alone, without a label or a full stop.
    assert answer["slot_key"] == "admin-role" and answer["value"] == "IT Security Manager"
    assert "1 item not matched" in found["run_note"]
    # The agent is told prior-year work is never evidence of operation this year.
    assert "never evidence that the control operated this year" in ANALYSIS_SYSTEM
    assert provider.requests[1].system == ANALYSIS_SYSTEM
    assert "<prior_year>" in provider.requests[1].prompt


def test_a_person_confirms_matches_then_decides_the_proposals(migrated: Database) -> None:
    team = _launched(migrated, "py-decide")
    controls = _controls(migrated, team["project"])
    base = _project_base(team)
    reference = _upload(team)
    _run(migrated, reference["id"], _Scripted([{"controls": []}, _analysis(), _leavers()]))
    found = _reference(team, reference["id"])
    first = next(item for item in found["matches"] if item["control_ref"] == "ITGC-AC-01")
    second = next(item for item in found["matches"] if item["control_ref"] == "ITGC-AC-02")
    proposals = {item["kind"]: item for item in first["proposals"]}
    with connect(migrated.url) as connection:
        requests_before = connection.execute(
            "SELECT (SELECT count(*) FROM pbc_requests WHERE project_id = %s), "
            "(SELECT count(*) FROM pbc_drafts WHERE project_id = %s)",
            (team["project"], team["project"]),
        ).fetchone()
    # Nothing of an unconfirmed match can be accepted.
    early = team["owner"].post(
        f"{base}/prior-year/proposals", json={"accept": [proposals["ANSWER"]["id"]]}
    )
    assert early.status_code == 409
    decided = team["owner"].post(
        f"{base}/prior-year/{reference['id']}/matches",
        json={"confirm": [first["id"]], "reject": [second["id"]]},
    )
    assert decided.status_code == 200, decided.text
    statuses = {item["control_ref"]: item for item in decided.json()["matches"]}
    assert statuses["ITGC-AC-01"]["status"] == "CONFIRMED"
    assert statuses["ITGC-AC-02"]["status"] == "REJECTED"
    # A rejected match's proposals are taken off.
    assert {item["status"] for item in statuses["ITGC-AC-02"]["proposals"]} == {"DISMISSED"}
    accepted = team["owner"].post(
        f"{base}/prior-year/proposals",
        json={"accept": [proposals["ANSWER"]["id"], proposals["APPROACH"]["id"],
                         proposals["DESIGN_CHANGE"]["id"]]},
    )  # fmt: skip
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["controls"] >= 1
    control = controls["ITGC-AC-01"]
    on_control = team["owner"].get(f"{base}/controls/{control}/prior-year").json()
    assert {item["status"] for item in on_control} == {"ACCEPTED"}
    with connect(migrated.url) as connection:
        value = connection.execute(
            "SELECT value, filled_by FROM control_parameters WHERE engagement_control_id = %s "
            "AND slot_key = 'admin-role'",
            (control,),
        ).fetchone()
        issue = connection.execute(
            "SELECT kind, origin, status FROM control_context_issues "
            "WHERE engagement_control_id = %s AND topic = 'Approver named differently'",
            (control,),
        ).fetchone()
        linked = {
            UUID(source.key) for source in linked_documents(connection, team["project"], control)
        }
        package = context_package(
            connection, team["project"], control, load_context(connection, team["project"],
                                                               control), [],
        )  # fmt: skip
        requests_after = connection.execute(
            "SELECT (SELECT count(*) FROM pbc_requests WHERE project_id = %s), "
            "(SELECT count(*) FROM pbc_drafts WHERE project_id = %s)",
            (team["project"], team["project"]),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'prior_year.proposals_decided' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchone()
    # The answer is the person's, as if typed; the change is an issue to resolve.
    assert value == ("IT Security Manager", team["owner_id"])
    assert issue == ("CONFLICT", "SOURCES", "OPEN")
    assert UUID(reference["id"]) in linked
    assert [item["title"] for item in package["prior_year"]] == ["Sample of 25 new users"]
    # No evidence is requested by it.
    assert requests_after == requests_before
    assert audit is not None and audit[0]["accepted"] == 3
    # A decided proposal is not decided again.
    twice = team["owner"].post(
        f"{base}/prior-year/proposals", json={"dismiss": [proposals["ANSWER"]["id"]]}
    )
    assert twice.status_code == 409


def test_without_a_model_a_person_runs_the_analysis_again(migrated: Database) -> None:
    team = _launched(migrated, "py-rerun")
    base = _project_base(team)
    reference = _upload(team)
    _run(migrated, reference["id"])
    again = team["owner"].post(f"{base}/prior-year/{reference['id']}/run")
    assert again.status_code == 200, again.text
    assert again.json()["run_status"] == "PENDING"
    assert {item["analysis_status"] for item in again.json()["matches"]} == {"PENDING"}
    _run(migrated, reference["id"], _Scripted([_analysis(), _analysis()]))
    found = _reference(team, reference["id"])
    assert all(item["analysis_status"] == "DONE" for item in found["matches"])


def test_only_the_engagement_reads_and_decides_its_references(migrated: Database) -> None:
    team = _launched(migrated, "py-access")
    controls = _controls(migrated, team["project"])
    base = _project_base(team)
    reference = _upload(team)
    _other, _project, stranger = _ready(migrated, "py-stranger")
    assert stranger.get(f"{base}/prior-year").status_code == 404
    assert stranger.post(f"{base}/prior-year/{reference['id']}/run").status_code == 404
    assert (
        stranger.post(
            f"{base}/prior-year/{reference['id']}/matches", json={"confirm": []}
        ).status_code
        == 404
    )
    assert stranger.get(f"{base}/controls/{controls['ITGC-AC-01']}/prior-year").status_code == 404
    refused = stranger.post(f"{base}/prior-year/upload", content=WORKPAPER.encode())
    assert refused.status_code == 404


def test_a_removed_reference_takes_off_what_is_undecided(migrated: Database) -> None:
    team = _launched(migrated, "py-remove")
    base = _project_base(team)
    reference = _upload(team)
    _run(migrated, reference["id"], _Scripted([{"controls": []}, _analysis(), _leavers()]))
    found = _reference(team, reference["id"])
    first = next(item for item in found["matches"] if item["control_ref"] == "ITGC-AC-01")
    second = next(item for item in found["matches"] if item["control_ref"] == "ITGC-AC-02")
    team["owner"].post(
        f"{base}/prior-year/{reference['id']}/matches", json={"confirm": [first["id"]]}
    )
    answer = next(item for item in first["proposals"] if item["kind"] == "ANSWER")
    approach = next(item for item in first["proposals"] if item["kind"] == "APPROACH")
    team["owner"].post(f"{base}/prior-year/proposals", json={"accept": [answer["id"]]})
    removed = team["owner"].post(f"{base}/prior-year/{reference['id']}/remove")
    assert removed.status_code == 200, removed.text
    assert removed.json() == []
    with connect(migrated.url) as connection:
        statuses = dict(
            connection.execute(
                "SELECT id::text, status FROM prior_year_proposals WHERE id = ANY(%s::uuid[])",
                ([answer["id"], approach["id"]],),
            ).fetchall()
        )
        matches = dict(
            connection.execute(
                "SELECT id::text, status FROM prior_year_matches WHERE id = ANY(%s::uuid[])",
                ([first["id"], second["id"]],),
            ).fetchall()
        )
        value = connection.execute(
            "SELECT value FROM control_parameters WHERE engagement_control_id = %s "
            "AND slot_key = 'admin-role'",
            (UUID(first["control_id"]),),
        ).fetchone()
        sources = {
            UUID(source.key)
            for source in linked_documents(connection, team["project"], UUID(first["control_id"]))
        }
        assert open_runs(connection, team["project"]) == []
    # What a person accepted stays; what waited is taken off; the document is no source.
    assert statuses == {answer["id"]: "ACCEPTED", approach["id"]: "DISMISSED"}
    assert matches == {first["id"]: "CONFIRMED", second["id"]: "REJECTED"}
    assert value == ("IT Security Manager",)
    assert UUID(reference["id"]) not in sources
    # A removed reference is neither run nor decided again.
    assert _run(migrated, reference["id"]) == "SKIPPED"
    assert team["owner"].post(f"{base}/prior-year/{reference['id']}/run").status_code == 404
