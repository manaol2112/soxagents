"""The Systems & Processes workflow's processes (SP3), control selection (SP4), and Review and
finalize (SP6), decided by the product owner on 24 October 2026: a process is added on its
own with its systems and approved areas; controls are selected for a system or a process;
and the engagement's work starts only when a person finalizes the scope."""

from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_engagement_close import _launched
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _choose_methodology, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _launched_empty(migrated: Database, slug: str) -> tuple[TestClient, str, dict[str, Any]]:
    """An engagement launched after its team, before any system or control."""
    team = _new_engagement(migrated, slug)
    owner, base = team["owner"], _base(team["org"], team["project"])
    scoped = owner.patch(
        f"{base}/scope", json={"scope": "ITGCs for FY2027", "period_end": "2027-12-31"}
    )
    assert scoped.status_code == 200, scoped.text
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        added = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert added.status_code == 200, added.text
    _choose_methodology(owner, base)
    preview = owner.get(base).json()["plan_preview"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert launched.status_code == 200, launched.text
    assert launched.json()["settings"]["scope_finalized_at"] is None
    return owner, base, team


def _work(database: Database, project: UUID) -> tuple[int, int, int]:
    """Controls with work, report tasks, and evidence requests."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT (SELECT count(DISTINCT engagement_control_id) FROM tasks
                    WHERE project_id = %s AND engagement_control_id IS NOT NULL
                      AND status <> 'CANCELLED'),
                   (SELECT count(*) FROM tasks WHERE project_id = %s AND plan_kind = 'report'),
                   (SELECT count(*) FROM pbc_requests WHERE project_id = %s)
            """,
            (project, project, project),
        ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1]), int(row[2])


def _options(owner: TestClient, base: str, **target: str) -> dict[str, Any]:
    answer = owner.get(f"{base}/scope/options", params=target)
    assert answer.status_code == 200, answer.text
    body: dict[str, Any] = answer.json()
    return body


def _counts(owner: TestClient, base: str) -> dict[str, int]:
    snapshot = owner.get(base).json()
    return {
        "systems": len(snapshot["applications"]),
        "processes": len(snapshot["processes"]),
        "controls": sum(1 for c in snapshot["controls"] if c["included"]),
    }


# SP3


def test_a_process_is_added_with_its_systems_owner_and_areas(migrated: Database) -> None:
    team = _new_engagement(migrated, "process-setup")
    owner, base = team["owner"], _base(team["org"], team["project"])
    sap = owner.post(f"{base}/systems", json={"name": "SAP ERP", "layer": "APPLICATION"})
    sap_id = sap.json()["applications"][0]["id"]
    draft = {"name": "Procure to pay", "domain": "PROCURE_TO_PAY", "system_ids": [sap_id]}
    preview = owner.post(f"{base}/processes/areas", json=draft)
    assert preview.status_code == 200, preview.text
    areas = {item["area"]: item for item in preview.json()["areas"]}
    assert areas["BUSINESS"]["suggested"] and areas["ITAC"]["suggested"]
    assert not areas["ITGC"]["suggested"]
    assert owner.get(base).json()["processes"] == []
    added = owner.post(
        f"{base}/processes/setup",
        json={**draft, "description": "Buying and paying", "owner": "AP Lead",
              "primary_system_id": sap_id, "approved_areas": ["BUSINESS"]},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    process = added.json()["processes"][0]
    assert (process["owner"], process["description"]) == ("AP Lead", "Buying and paying")
    assert process["system_ids"] == [sap_id] and process["primary_system_id"] == sap_id
    assert process["control_areas"] == ["BUSINESS"]
    assert process["control_areas_suggested"]["source"] == "RULES"
    system = added.json()["applications"][0]
    assert system["process_ids"] == [process["id"]]
    # No control joined the scope.
    assert not any(c["included"] for c in added.json()["controls"])
    # A process needs no system; refusals.
    alone = owner.post(f"{base}/processes/setup", json={"name": "Treasury", "domain": "TREASURY"})
    assert alone.status_code == 200, alone.text
    assert (
        next(p for p in alone.json()["processes"] if p["name"] == "Treasury")["control_areas"]
        is None
    )
    assert owner.post(f"{base}/processes/setup", json=draft).status_code == 409
    for body in (
        {"name": "X", "domain": "ACCESS"},
        {"name": "X", "domain": "TAX", "system_ids": [str(uuid4())]},
        {"name": "X", "domain": "TAX", "primary_system_id": sap_id},
        {"name": "X", "domain": "TAX", "approved_areas": ["ALL"]},
    ):
        assert owner.post(f"{base}/processes/setup", json=body).status_code == 422, body


# SP4 and SP6


def test_selected_controls_wait_for_the_scope_to_be_finalized(migrated: Database) -> None:
    owner, base, team = _launched_empty(migrated, "finalize-scope")
    project = team["project"]
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    payroll = owner.post(
        f"{base}/processes/setup",
        json={"name": "Payroll", "domain": "HIRE_TO_RETIRE", "system_ids": [sap["id"]]},
    ).json()["processes"][0]
    options = _options(owner, base, system_id=sap["id"])
    assert options["target_kind"] == "SYSTEM" and options["approved_areas"] == ["ITGC"]
    keys = [c["library_key"] for c in options["controls"] if c["area"] == "ITGC"][:3]
    assert len(keys) == 3 and not any(c["in_scope"] for c in options["controls"])
    chosen = owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": keys})
    assert chosen.status_code == 200, chosen.text
    assert {
        c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
        if c["in_scope"]
    } == set(keys)  # fmt: skip
    hr = _options(owner, base, process_id=payroll["id"])
    assert {c["domain"] for c in hr["controls"]} == {"HIRE_TO_RETIRE"}
    hr_key = hr["controls"][0]["library_key"]
    picked = owner.post(
        f"{base}/scope/select", json={"process_id": payroll["id"], "library_keys": [hr_key]}
    )
    assert picked.status_code == 200, picked.text
    process_control = next(c for c in picked.json()["controls"] if c["included"]
                           and c["process_id"] == payroll["id"])  # fmt: skip
    assert process_control["application_id"] is None
    # Selected, but nothing starts before the scope is finalized.
    assert _work(migrated, project) == (0, 0, 0)
    counts = _counts(owner, base)
    assert counts == {"systems": 1, "processes": 1, "controls": 4}
    stale = owner.post(f"{base}/scope/finalize", json={**counts, "controls": 3})
    assert stale.status_code == 409
    assert stale.json()["detail"] == "the scope changed since it was reviewed"
    final = owner.post(f"{base}/scope/finalize", json=counts)
    assert final.status_code == 200, final.text
    assert final.json()["settings"]["scope_finalized_at"] is not None
    with_work, reports, _requests = _work(migrated, project)
    assert (with_work, reports) == (4, 1)
    assert owner.post(f"{base}/scope/finalize", json=counts).status_code == 409
    # Once final, a control selected gets its work at once, as before.
    more = [c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
            if not c["in_scope"]][:1]  # fmt: skip
    owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": more})
    assert _work(migrated, project)[0] == 5
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.scope_finalized'",
            (project,),
        ).fetchone()
    assert audit is not None and audit[0]["controls"] == 4


def test_finalizing_needs_a_launch_and_a_control(migrated: Database) -> None:
    team = _new_engagement(migrated, "finalize-early")
    owner, base = team["owner"], _base(team["org"], team["project"])
    body = {"systems": 0, "processes": 0, "controls": 1}
    early = owner.post(f"{base}/scope/finalize", json=body)
    assert early.status_code == 409 and early.json()["detail"] == "launch the engagement first"
    owner, base, _team = _launched_empty(migrated, "finalize-empty")
    empty = owner.post(f"{base}/scope/finalize", json=body)
    assert empty.status_code == 409 and empty.json()["detail"] == "select at least one control"
    assert owner.post(f"{base}/scope/finalize", json={**body, "controls": 0}).status_code == 422


def test_an_engagement_launched_with_controls_is_final_from_launch(migrated: Database) -> None:
    team = _launched(migrated, "final-at-launch")
    owner, base = team["owner"], _base(team["org"], team["project"])
    snapshot = owner.get(base).json()
    assert snapshot["settings"]["scope_finalized_at"] is not None
    sap = next(a for a in snapshot["applications"] if a["name"] == "SAP ERP")
    before = _work(migrated, team["project"])[0]
    free = [c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
            if not c["in_scope"]][:1]  # fmt: skip
    assert free
    owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": free})
    assert _work(migrated, team["project"])[0] == before + 1


def test_selection_refuses_what_does_not_apply(migrated: Database) -> None:
    owner, base, team = _launched_empty(migrated, "select-refusals")
    sap = owner.post(f"{base}/systems", json={"name": "SAP", "layer": "APPLICATION"}).json()[
        "applications"
    ][0]
    snapshot = owner.post(
        f"{base}/processes/setup", json={"name": "Payroll", "domain": "HIRE_TO_RETIRE"}
    ).json()
    payroll = snapshot["processes"][0]
    other = owner.post(
        f"{base}/processes/setup", json={"name": "Contractors", "domain": "HIRE_TO_RETIRE"}
    ).json()
    contractors = next(p for p in other["processes"] if p["name"] == "Contractors")
    itgc = _options(owner, base, system_id=sap["id"])["controls"][0]["library_key"]
    hr = _options(owner, base, process_id=payroll["id"])["controls"][0]["library_key"]
    for body in (
        {"system_id": sap["id"], "library_keys": [hr]},
        {"process_id": payroll["id"], "library_keys": [itgc]},
        {"system_id": sap["id"], "process_id": payroll["id"], "library_keys": [itgc]},
        {"system_id": sap["id"], "library_keys": ["not-a-control"]},
    ):
        assert owner.post(f"{base}/scope/select", json=body).status_code == 422, body
    assert (
        owner.post(
            f"{base}/scope/select", json={"system_id": str(uuid4()), "library_keys": [itgc]}
        ).status_code
        == 404
    )
    # One library row per process control: given to one process, it stays with it.
    assert (
        owner.post(
            f"{base}/scope/select", json={"process_id": payroll["id"], "library_keys": [hr]}
        ).status_code
        == 200
    )
    taken = owner.post(
        f"{base}/scope/select", json={"process_id": contractors["id"], "library_keys": [hr]}
    )
    assert taken.status_code == 409
    with connect(migrated.url) as connection:
        reader_id = _add_user(
            connection, team["org"], f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reader_id)
    reader = _session(migrated, reader_id)
    assert reader.get(f"{base}/scope/options", params={"system_id": sap["id"]}).status_code == 403
    assert (
        reader.post(
            f"{base}/scope/finalize", json={"systems": 1, "processes": 2, "controls": 1}
        ).status_code
        == 403
    )
