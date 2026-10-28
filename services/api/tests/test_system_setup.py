"""Adding a system in one step: the Systems & Processes workflow's Add system wizard (SP2,
decided by the product owner on 24 October 2026). The agent suggests control areas from
the documented facts and the library; a person approves them; nothing joins the scope."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_engagement_close import _launched
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.system_setup import suggest_areas

__all__ = ["migrated"]


def _areas(answer: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["area"]: item for item in answer["areas"]}


def _work(database: Database, project: UUID) -> tuple[int, int, int, int]:
    """What scope creates: controls in scope, tasks, evidence requests, approvals."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT (SELECT count(*) FROM engagement_controls WHERE project_id = %s AND included),
                   (SELECT count(*) FROM tasks WHERE project_id = %s),
                   (SELECT count(*) FROM pbc_requests WHERE project_id = %s),
                   (SELECT count(*) FROM approvals WHERE project_id = %s)
            """,
            (project, project, project, project),
        ).fetchone()
    assert row is not None
    return (int(row[0]), int(row[1]), int(row[2]), int(row[3]))


def test_the_agent_suggests_areas_from_the_documented_facts() -> None:
    application = _areas(suggest_areas("APPLICATION", None, [], "").model_dump())
    assert [a for a, item in application.items() if item["suggested"]] == ["ITGC", "ITAC", "IPE"]
    assert all(item["controls"] > 0 for item in application.values())
    assert application["BUSINESS"]["reason"].startswith("No business process is linked")
    database = _areas(suggest_areas("DATABASE", None, [], "").model_dump())
    assert [a for a, item in database.items() if item["suggested"]] == ["ITGC"]
    assert "not in a database" in database["ITAC"]["reason"]
    hosted = _areas(suggest_areas("APPLICATION", "SAAS", [], "").model_dump())
    assert "SOC 1 report" in hosted["ITGC"]["reason"]
    # Linked to a process: its business controls, counted for that cycle only.
    payroll = _areas(suggest_areas("APPLICATION", None, ["HIRE_TO_RETIRE"], "").model_dump())
    assert payroll["BUSINESS"]["suggested"] is True
    assert 0 < payroll["BUSINESS"]["controls"] < application["BUSINESS"]["controls"]
    typed = _areas(suggest_areas("APPLICATION", None, [], "Payroll").model_dump())
    assert typed["BUSINESS"]["suggested"] is True
    assert suggest_areas("TOOL", None, [], "").source == "RULES"


def test_previewing_the_areas_writes_nothing(migrated: Database) -> None:
    team = _new_engagement(migrated, "areas-preview")
    owner, base = team["owner"], _base(team["org"], team["project"])
    answer = owner.post(f"{base}/systems/areas", json={"name": "Workday", "layer": "APPLICATION"})
    assert answer.status_code == 200, answer.text
    assert _areas(answer.json())["ITGC"]["suggested"] is True
    assert owner.get(base).json()["applications"] == []


def test_adding_a_system_records_it_and_puts_nothing_in_scope(migrated: Database) -> None:
    team = _launched(migrated, "add-system")
    owner, base = team["owner"], _base(team["org"], team["project"])
    snapshot = owner.get(base).json()
    sap = next(a for a in snapshot["applications"] if a["name"] == "SAP ERP")
    process = owner.post(f"{base}/processes", json={"name": "Payroll", "domain": "HIRE_TO_RETIRE"})
    assert process.status_code == 200, process.text
    payroll = next(p for p in process.json()["processes"] if p["name"] == "Payroll")
    before = _work(migrated, team["project"])
    added = owner.post(
        f"{base}/systems",
        json={
            "name": "Workday",
            "layer": "APPLICATION",
            "description": "HR and payroll system.",
            "owner": "HR Director",
            "environment": "PRODUCTION",
            "purpose": "Pays employees and feeds the ledger.",
            "hosting": "SAAS",
            "integration_ids": [sap["id"]],
            "process_ids": [payroll["id"]],
            "approved_areas": ["IPE", "ITGC"],
        },
    )
    assert added.status_code == 200, added.text
    body = added.json()
    workday = next(a for a in body["applications"] if a["name"] == "Workday")
    assert (workday["environment"], workday["owner"], workday["hosting"]) == (
        "PRODUCTION", "HR Director", "SAAS",
    )  # fmt: skip
    assert workday["purpose"] == "Pays employees and feeds the ledger."
    # The person's approval, in the library's order, apart from the agent's suggestion.
    assert workday["control_areas"] == ["ITGC", "IPE"]
    assert workday["control_areas_decided_at"] is not None
    suggested = _areas(workday["control_areas_suggested"])
    assert suggested["ITAC"]["suggested"] is True and suggested["BUSINESS"]["suggested"] is True
    assert workday["control_areas_suggested"]["source"] == "RULES"
    # Links read from both sides.
    assert workday["integration_ids"] == [sap["id"]]
    assert next(a for a in body["applications"] if a["name"] == "SAP ERP")["integration_ids"] == [
        workday["id"]
    ]
    assert workday["process_ids"] == [payroll["id"]]
    assert next(p for p in body["processes"] if p["id"] == payroll["id"])["system_ids"] == [
        workday["id"]
    ]
    # No control joined the scope, so no task, request, or approval was created.
    assert workday["controls_in_scope"] == 0
    assert _work(migrated, team["project"]) == before
    with connect(migrated.url) as connection:
        instances = connection.execute(
            "SELECT count(*), count(*) FILTER (WHERE included) FROM engagement_controls "
            "WHERE project_id = %s AND engagement_application_id = %s",
            (team["project"], workday["id"]),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.system_added'",
            (team["project"],),
        ).fetchone()
    assert instances is not None and instances[0] > 0 and instances[1] == 0
    assert audit is not None and audit[0]["approved_areas"] == ["ITGC", "IPE"]


def test_a_system_needs_no_process_and_a_process_needs_no_system(migrated: Database) -> None:
    team = _new_engagement(migrated, "independent")
    owner, base = team["owner"], _base(team["org"], team["project"])
    process = owner.post(f"{base}/processes", json={"name": "Treasury", "domain": "TREASURY"})
    assert process.status_code == 200, process.text
    assert process.json()["applications"] == []
    added = owner.post(f"{base}/systems", json={"name": "Kyriba", "layer": "APPLICATION"})
    assert added.status_code == 200, added.text
    kyriba = next(a for a in added.json()["applications"] if a["name"] == "Kyriba")
    # Nobody approved any area: the suggestion is kept, the decision is still open.
    assert kyriba["control_areas"] is None and kyriba["control_areas_decided_at"] is None
    assert kyriba["control_areas_suggested"] is None
    assert kyriba["process_ids"] == [] and kyriba["integration_ids"] == []


def test_adding_a_system_refuses_what_it_cannot_trust(migrated: Database) -> None:
    team = _new_engagement(migrated, "add-refusals")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert (
        owner.post(f"{base}/systems", json={"name": "Oracle", "layer": "DATABASE"}).status_code
        == 200
    )
    duplicate = owner.post(f"{base}/systems", json={"name": " oracle ", "layer": "DATABASE"})
    assert duplicate.status_code == 409
    other = _new_engagement(migrated, "add-other")
    other_base = _base(other["org"], other["project"])
    foreign = other["owner"].post(f"{other_base}/processes", json={"name": "Tax", "domain": "TAX"})
    foreign_process = foreign.json()["processes"][0]["id"]
    for body in (
        {"name": "Linked", "layer": "APPLICATION", "process_ids": [foreign_process]},
        {"name": "Linked", "layer": "APPLICATION", "integration_ids": [str(uuid4())]},
        {"name": "Secret", "layer": "APPLICATION", "description": "password=hunter2hunter2"},
        {"name": "Bad", "layer": "MAINFRAME"},
        {"name": "Bad", "layer": "APPLICATION", "approved_areas": ["EVERYTHING"]},
    ):
        assert owner.post(f"{base}/systems", json=body).status_code == 422, body
    with connect(migrated.url) as connection:
        reader_id = _add_user(
            connection, team["org"], f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reader_id)
    reader = _session(migrated, reader_id)
    assert reader.post(f"{base}/systems", json={"name": "X", "layer": "TOOL"}).status_code == 403
    assert (
        reader.post(f"{base}/systems/areas", json={"name": "X", "layer": "TOOL"}).status_code == 403
    )
    names = [a["name"] for a in owner.get(base).json()["applications"]]
    assert names == ["Oracle"]


def test_every_catalog_system_says_what_it_is() -> None:
    # The Add system picker shows each common system with what it is (ERP, HR, ...).
    from ai_workforce_api.rcm_systems import KNOWN_CATEGORIES, KNOWN_SYSTEMS

    names = {name for name, _layer, _patterns in KNOWN_SYSTEMS if name != "SAP"}
    assert names == set(KNOWN_CATEGORIES)
    assert all(category.strip() for category in KNOWN_CATEGORIES.values())
    assert KNOWN_CATEGORIES["Workday"] == "HR"
