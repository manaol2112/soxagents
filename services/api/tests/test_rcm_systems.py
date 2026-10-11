from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_onboarding import _base, _new_engagement
from test_outbound import migrated

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.main import create_app
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.rcm_systems import (
    ScanRow,
    SystemProposal,
    assigned_systems,
    check_scan,
    merge_beyond,
    rules_scan,
    run_scan,
    scan_prompt,
)
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

ROWS = [
    ScanRow("AC-01", "SAP ECC 6.0; Workday", "New access is requested in ServiceNow and approved."),
    ScanRow("AC-02", "SAP ECC", "Leavers are removed from Active Directory within 3 days."),
    ScanRow("CM-01", "N/A", "Changes to SAP are approved before transport to production."),
    ScanRow("OP-01", "", "Nightly backups of the SQL Server database are monitored."),
    ScanRow("OP-02", "Legacy Billing", "Billing jobs run on the AS/400."),
]


def test_the_rules_find_systems_in_the_column_and_the_control_text() -> None:
    found = {system.name: system for system in rules_scan(ROWS)}
    assert set(found) == {
        "SAP ECC",
        "Workday",
        "ServiceNow",
        "Active Directory",
        "SAP",
        "Microsoft SQL Server",
        "Legacy Billing",
        "IBM i",
    }
    sap = found["SAP ECC"]
    assert sap.control_refs == ["AC-01", "AC-02"]
    assert "SAP ECC 6.0" in sap.aliases
    assert sap.found_in == "column"
    assert found["ServiceNow"].found_in == "text"
    assert found["ServiceNow"].layer == "TOOL"
    assert "ServiceNow" in found["ServiceNow"].evidence
    assert found["Microsoft SQL Server"].layer == "DATABASE"
    assert found["IBM i"].layer == "OPERATING_SYSTEM"
    # "SAP" alone stays separate only where no specific SAP system was named.
    assert found["SAP"].control_refs == ["CM-01"]
    assert all(system.included for system in found.values())


def test_a_model_answer_keeps_only_systems_the_rcm_names() -> None:
    answer = {
        "systems": [
            {
                "name": "SAP ECC",
                "layer": "APPLICATION",
                "aliases": ["SAP ECC 6.0", "SAP", "ECC 7"],
                "control_ids": ["AC-01", "AC-02", "CM-01", "ZZ-99"],
                "evidence": "SAP ECC 6.0",
            },
            {
                "name": "Oracle EBS",
                "layer": "APPLICATION",
                "aliases": [],
                "control_ids": ["AC-01"],
            },
            {
                "name": "ServiceNow",
                "layer": "TOOL",
                "aliases": [],
                "control_ids": ["NOPE-1"],
            },
            {
                "name": "Workday",
                "layer": "APPLICATION",
                "aliases": [],
                "control_ids": ["ac-01"],
            },
        ]
    }
    kept = {system.name: system for system in check_scan(answer, ROWS)}
    assert set(kept) == {"SAP ECC", "Workday"}
    assert kept["SAP ECC"].control_refs == ["AC-01", "AC-02", "CM-01"]
    assert kept["SAP ECC"].aliases == ["SAP ECC 6.0", "SAP"]
    assert kept["SAP ECC"].found_in == "both"
    assert kept["Workday"].control_refs == ["AC-01"]
    with pytest.raises(ValueError):
        check_scan(
            {
                "systems": [
                    {"name": "Made Up", "layer": "TOOL", "aliases": [], "control_ids": ["AC-01"]}
                ]
            },
            ROWS,
        )
    with pytest.raises(ValueError):
        check_scan({"systems": "not a list"}, ROWS)


def test_rules_findings_join_the_model_answer_for_rows_it_did_not_read() -> None:
    model = [
        SystemProposal(
            key="sap-ecc",
            name="SAP ECC",
            layer="APPLICATION",
            aliases=["SAP ECC 6.0"],
            control_refs=["AC-01"],
            found_in="column",
        )
    ]
    extra = rules_scan([ScanRow("AC-09", "SAP ECC 6.0", ""), ScanRow("AC-10", "Coupa", "")])
    merged = {system.name: system for system in merge_beyond(model, extra)}
    assert merged["SAP ECC"].control_refs == ["AC-01", "AC-09"]
    assert "Coupa" in merged


def test_each_control_gets_its_own_confirmed_systems() -> None:
    systems = rules_scan(ROWS)
    workday = next(system for system in systems if system.name == "Workday")
    workday.included = False
    names = {system.name for system in assigned_systems(systems, "AC-01", ["SAP ECC 6.0"])}
    assert names == {"SAP ECC", "ServiceNow"}


def test_the_prompt_carries_the_rcm_as_data() -> None:
    prompt = scan_prompt(ROWS)
    assert "<rcm>" in prompt and "</rcm>" in prompt
    assert '"control_id": "AC-01"' in prompt
    assert "Legacy Billing" in prompt


# End to end

CLIENT_RCM = (
    "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner,Systems\n"
    "AC 1.01,New access is requested in ServiceNow and approved.,As needed,Manual,"
    "User Access,Dana,SAP ECC 6.0\n"
    "AC 1.02,Leavers are removed from Active Directory.,As needed,Manual,User Access,Dana,"
    "SAP ECC; Workday\n"
    "OP 3.01,Backups of the SQL Server database are monitored.,Daily,Automated,"
    "Computer Ops,Sam,\n"
)


class FakeProvider:
    def __init__(self, output: dict[str, Any]) -> None:
        self.output = output
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        return ModelRaw(self.output, (), 2000, 300)


class RecordingScheduler:
    def __init__(self) -> None:
        self.drafts: list[UUID] = []
        self.scans: list[UUID] = []

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        self.drafts.extend(draft_ids)

    def schedule_system_scans(self, import_ids: list[UUID]) -> None:
        self.scans.extend(import_ids)


def test_systems_are_found_confirmed_and_imported_as_in_scope_applications(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "systems")
    scheduler = RecordingScheduler()
    owner = _client(migrated, team["owner_id"], scheduler)
    base = _base(team["org"], team["project"])
    uploaded = _upload(owner, base)
    assert uploaded["systems"]["status"] == "PENDING"
    assert scheduler.scans == [UUID(uploaded["id"])]
    with connect(migrated.url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
        assert run_scan(connection, None, UUID(uploaded["id"])) == "SKIPPED"
    read = owner.get(f"{base}/rcm/uploads/{uploaded['id']}").json()
    systems = read["systems"]
    assert systems["status"] == "READY"
    assert systems["source"] == "RULES"
    by_name = {item["name"]: item for item in systems["proposals"]}
    assert set(by_name) == {
        "SAP ECC",
        "Workday",
        "ServiceNow",
        "Active Directory",
        "Microsoft SQL Server",
    }
    assert by_name["SAP ECC"]["controls"] == 2
    assert sorted(read["preview"]["new_applications"]) == sorted(by_name)
    # The person renames one system and leaves Workday out.
    choices = [
        {
            "key": item["key"],
            "name": "SAP ECC 6.0 (production)" if item["name"] == "SAP ECC" else item["name"],
            "layer": item["layer"],
            "included": item["name"] != "Workday",
        }
        for item in systems["proposals"]
    ]
    stale = owner.patch(
        f"{base}/rcm/uploads/{uploaded['id']}/systems",
        json={"systems_version": systems["version"] - 1, "choices": choices},
    )
    assert stale.status_code == 409
    clash = owner.patch(
        f"{base}/rcm/uploads/{uploaded['id']}/systems",
        json={
            "systems_version": systems["version"],
            "choices": [{**choice, "name": "Same"} for choice in choices[:2]],
        },
    )
    assert clash.status_code == 422
    saved = owner.patch(
        f"{base}/rcm/uploads/{uploaded['id']}/systems",
        json={"systems_version": systems["version"], "choices": choices},
    )
    assert saved.status_code == 200, saved.text
    assert "Workday" not in saved.json()["preview"]["new_applications"]
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import",
        json={"version": saved.json()["version"]},
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    apps = {app["name"]: app["id"] for app in body["applications"]}
    assert set(apps) == {
        "SAP ECC 6.0 (production)",
        "ServiceNow",
        "Active Directory",
        "Microsoft SQL Server",
    }
    controls = {
        control["control_ref"]: set(control["application_ids"]) for control in body["controls"]
    }
    assert controls["AC 1.01"] == {apps["SAP ECC 6.0 (production)"], apps["ServiceNow"]}
    assert controls["AC 1.02"] == {apps["SAP ECC 6.0 (production)"], apps["Active Directory"]}
    assert controls["OP 3.01"] == {apps["Microsoft SQL Server"]}
    with connect(migrated.url) as connection:
        layer = connection.execute(
            "SELECT layer FROM engagement_applications WHERE project_id = %s AND name = %s",
            (team["project"], "Microsoft SQL Server"),
        ).fetchone()
    assert layer == ("DATABASE",)


def test_a_mapping_change_rescans_and_a_model_answer_is_checked(migrated: Database) -> None:
    team = _new_engagement(migrated, "rescan")
    scheduler = RecordingScheduler()
    owner = _client(migrated, team["owner_id"], scheduler)
    base = _base(team["org"], team["project"])
    uploaded = _upload(owner, base)
    import_id = UUID(uploaded["id"])
    provider = FakeProvider(
        {
            "systems": [
                {
                    "name": "SAP ECC",
                    "layer": "APPLICATION",
                    "aliases": ["SAP ECC 6.0"],
                    "control_ids": ["AC 1.01", "AC 1.02"],
                    "evidence": "SAP ECC 6.0",
                },
                {
                    "name": "Oracle Fusion",
                    "layer": "APPLICATION",
                    "aliases": [],
                    "control_ids": ["AC 1.01"],
                },
            ]
        }
    )
    with connect(migrated.url) as connection:
        assert run_scan(connection, provider, import_id) == "READY"
        call = connection.execute(
            "SELECT m.status FROM rcm_imports r JOIN model_calls m "
            "ON m.id = r.systems_model_call_id WHERE r.id = %s",
            (import_id,),
        ).fetchone()
    assert call == ("SUCCEEDED",)
    assert provider.requests[0].system.startswith("You are an IT audit senior")
    read = owner.get(f"{base}/rcm/uploads/{import_id}").json()
    assert read["systems"]["source"] == "MODEL"
    assert [item["name"] for item in read["systems"]["proposals"]] == ["SAP ECC"]
    # Changing which column holds the systems needs a new scan.
    columns = ["ignore" if c["field"] == "applications" else c["field"] for c in read["columns"]]
    values = [
        {"field": key, "value": item["value"], "mapped": item["mapped"] or ""}
        for key, items in read["values"].items()
        for item in items
    ]
    scheduler.scans.clear()
    remapped = owner.patch(
        f"{base}/rcm/uploads/{import_id}/mapping",
        json={"version": read["version"], "column_fields": columns, "values": values},
    ).json()
    assert remapped["systems"]["status"] == "PENDING"
    assert remapped["systems"]["proposals"] == []
    assert scheduler.scans == [import_id]
    rescanned = owner.post(f"{base}/rcm/uploads/{import_id}/systems/rescan")
    assert rescanned.status_code == 200
    assert rescanned.json()["systems"]["status"] == "PENDING"


# Helpers


def _client(database: Database, user_id: UUID, scheduler: RecordingScheduler) -> TestClient:
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO auth_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, clock_timestamp() + interval '1 hour')
            """,
            (user_id, token_hash(token)),
        )
    settings = Settings(database_url=database.url, session_cookie_secure=False)
    return TestClient(
        create_app(settings, draft_scheduler=scheduler), cookies={"aw_session": token}
    )


def _upload(client: TestClient, base: str) -> dict[str, Any]:
    response = client.post(
        f"{base}/rcm/uploads", params={"file_name": "Acme RCM.csv"}, content=CLIENT_RCM.encode()
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body
