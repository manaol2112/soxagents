from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _new_engagement, _pbc
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.onboarding import pbc_reference

__all__ = ["migrated"]

# A synthetic client RCM in the client's own words. No real client data.
CLIENT_RCM = (
    "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner,"
    "Owner E-mail,Systems,Region,Assertion\n"
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,,"
    "SAP ERP,EMEA,Existence\n"
    "AC 1.02,Access is reviewed each quarter.,Quarterly,Manual,User Access,Dana Ruiz,,"
    "SAP ERP; Workday,EMEA,Existence\n"
    "CM 2.01,Changes are tested before release.,Ad hoc,ITDM,Program Change,Lee Park,"
    "lee.park@client.example,Workday,Global,Accuracy\n"
    "OP/3.01,Job failures are resolved.,Daily,System,Computer Ops,Sam Ops,"
    "sam@client.example,SAP ERP,Global,Completeness\n"
    ",No control ID here.,Daily,Manual,User Access,Dana Ruiz,,SAP ERP,EMEA,\n"
)


def test_a_client_rcm_is_uploaded_mapped_and_imported_as_the_engagement_rcm(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "upload")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    uploaded = _upload(owner, base, CLIENT_RCM)
    assert uploaded["status"] == "MAPPING"
    assert uploaded["file_kind"] == "CSV"
    assert uploaded["data_rows"] == 5
    fields = {column["header"]: column["field"] for column in uploaded["columns"]}
    assert fields["Ctrl #"] == "control_ref"
    assert fields["Owner E-mail"] == "owner_email"
    assert fields["Region"] == "custom"
    assert fields["Assertion"] == "custom"
    computer_ops = next(v for v in uploaded["values"]["domain"] if v["value"] == "Computer Ops")
    assert computer_ops["mapped"] == "OPERATIONS"
    assert uploaded["ready"] is True, uploaded["preview"]["problems"]
    assert uploaded["preview"]["importable"] == 4
    assert uploaded["preview"]["skipped"] == [{"row": 6, "reason": "No control ID."}]
    assert sorted(uploaded["preview"]["new_applications"]) == ["SAP ERP", "Workday"]
    assert owner.get(base).json()["open_import_id"] == uploaded["id"]

    # The person maps "Ad hoc" differently and drops the Assertion column.
    columns = [
        "ignore" if column["header"] == "Assertion" else column["field"]
        for column in uploaded["columns"]
    ]
    values = [
        {"field": key, "value": item["value"], "mapped": item["mapped"] or ""}
        for key, items in uploaded["values"].items()
        for item in items
    ]
    values = [
        {**item, "mapped": "QUARTERLY"} if item["value"] == "Ad hoc" else item for item in values
    ]
    mapped = owner.patch(
        f"{base}/rcm/uploads/{uploaded['id']}/mapping",
        json={"version": uploaded["version"], "column_fields": columns, "values": values},
    )
    assert mapped.status_code == 200, mapped.text
    stale = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert stale.status_code == 409
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": mapped.json()["version"]}
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    assert body["rcm_source"] == "UPLOAD"
    assert body["rcm_file_name"] == "Acme RCM.csv"
    assert body["open_import_id"] is None
    controls = {control["control_ref"]: control for control in body["controls"]}
    assert set(controls) == {"AC 1.01", "AC 1.02", "CM 2.01", "OP/3.01"}
    change = controls["CM 2.01"]
    assert (change["frequency"], change["frequency_label"]) == ("QUARTERLY", "Ad hoc")
    assert (change["nature"], change["nature_label"]) == ("IT_DEPENDENT_MANUAL", "ITDM")
    assert (change["domain"], change["domain_label"]) == ("CHANGE", "Program Change")
    assert change["agent_key"] == "itgc-change-tester"
    assert change["custom_fields"] == [{"label": "Region", "value": "Global"}]
    assert change["source"] == "UPLOAD"
    assert controls["OP/3.01"]["effectiveness_template_key"] == "oe-automated"
    apps = {app["name"]: app["id"] for app in body["applications"]}
    assert set(apps) == {"SAP ERP", "Workday"}
    assert set(controls["AC 1.02"]["application_ids"]) == set(apps.values())

    # The client's terms and extra columns reach the workpaper.
    preview = owner.get(
        f"{base}/workpaper-preview",
        params={"template": "oe-manual", "control_id": change["id"]},
    ).json()
    header = {field["label"]: field["value"] for field in preview["sections"][0]["fields"]}
    assert header["Frequency"] == "Ad hoc (Quarterly)"
    assert header["Region"] == "Global"

    # Owners named without an email get one per name.
    filled = owner.post(
        f"{base}/controls/owner-emails",
        json={"entries": [{"owner_name": "dana ruiz", "owner_email": "Dana@Client.Example"}]},
    )
    assert filled.status_code == 200, filled.text
    emails = {c["control_ref"]: c["owner_email"] for c in filled.json()["controls"]}
    assert emails["AC 1.01"] == emails["AC 1.02"] == "dana@client.example"

    # The uploaded RCM starts an engagement like the library does.
    _finish_setup(owner, team)
    plan = owner.post(f"{base}/plan").json()["plan"]
    assert len(plan["items"]) == 4 * 4 + 1
    started = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    with connect(migrated.url) as connection:
        refs = connection.execute(
            "SELECT control_ref FROM pbc_requests WHERE project_id = %s ORDER BY control_ref",
            (project,),
        ).fetchall()
        audit = connection.execute(
            """
            SELECT payload FROM audit_events
            WHERE project_id = %s AND action = 'onboarding.rcm_imported'
            """,
            (project,),
        ).fetchone()
    assert [row[0] for row in refs] == ["AC-1.01", "AC-1.02", "CM-2.01", "OP/3.01"]
    assert audit is not None
    # No scan ran, so the systems came from the systems column.
    assert audit[0] == {
        "controls": 4,
        "skipped_rows": 1,
        "new_applications": 2,
        "systems_source": None,
    }


def test_the_next_upload_in_an_engagement_remembers_its_mapping(migrated: Database) -> None:
    team = _new_engagement(migrated, "memory")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    text = "Ref,Narrative,Cadence,Area\nX-1,First control.,Every so often,IT\n"
    first = _upload(owner, base, text)
    by_header = {column["header"]: column["field"] for column in first["columns"]}
    assert by_header["Narrative"] == "custom"
    assert first["ready"] is False
    columns = ["control_ref", "activity", "frequency", "domain"]
    values = [
        {"field": "frequency", "value": "Every so often", "mapped": "ANNUAL"},
        {"field": "domain", "value": "IT", "mapped": "OPERATIONS"},
        {"field": "nature", "value": "", "mapped": "MANUAL"},
    ]
    mapped = owner.patch(
        f"{base}/rcm/uploads/{first['id']}/mapping",
        json={"version": first["version"], "column_fields": columns, "values": values},
    ).json()
    assert mapped["ready"] is True, mapped["preview"]["problems"]
    owner.post(f"{base}/rcm/uploads/{first['id']}/import", json={"version": mapped["version"]})
    again = _upload(owner, base, text.replace("X-1", "X-2"))
    assert [column["field"] for column in again["columns"]] == columns
    assert again["ready"] is True


def test_one_engagement_never_learns_from_another_engagements_rcm(migrated: Database) -> None:
    team = _new_engagement(migrated, "isolation")
    owner, org, first = team["owner"], team["org"], team["project"]
    created = owner.post(
        f"/organizations/{org}/projects",
        json={
            "name": "Another client",
            "slug": f"another-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(team["owner_id"]),
            "status": "DRAFT",
        },
    )
    assert created.status_code in (200, 201), created.text
    second = UUID(created.json()["id"])
    text = "Ref,Narrative,Cadence,Area\nX-1,First control.,Every so often,IT\n"
    columns = ["control_ref", "activity", "frequency", "domain"]
    values = [
        {"field": "frequency", "value": "Every so often", "mapped": "ANNUAL"},
        {"field": "domain", "value": "IT", "mapped": "OPERATIONS"},
        {"field": "nature", "value": "", "mapped": "MANUAL"},
    ]
    upload = _upload(owner, _base(org, first), text)
    mapped = owner.patch(
        f"{_base(org, first)}/rcm/uploads/{upload['id']}/mapping",
        json={"version": upload["version"], "column_fields": columns, "values": values},
    ).json()
    imported = owner.post(
        f"{_base(org, first)}/rcm/uploads/{upload['id']}/import",
        json={"version": mapped["version"]},
    )
    assert imported.status_code == 200, imported.text
    elsewhere = _upload(owner, _base(org, second), text)
    by_header = {column["header"]: column["field"] for column in elsewhere["columns"]}
    assert by_header["Narrative"] == "custom"
    assert by_header["Cadence"] == "custom"
    frequency = elsewhere["values"]["frequency"]
    assert all(item["mapped"] is None for item in frequency)
    assert owner.get(_base(org, second)).json()["controls"] == []
    assert owner.get(_base(org, second)).json()["open_import_id"] == elsewhere["id"]
    assert elsewhere["uploaded_by"] != ""


def test_the_library_and_an_upload_replace_each_other_until_kickoff(migrated: Database) -> None:
    team = _new_engagement(migrated, "switch")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    assert len(owner.post(f"{base}/controls/load-library").json()["controls"]) == 16
    uploaded = _upload(owner, base, CLIENT_RCM)
    assert uploaded["replaces"] == 16
    body = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    ).json()
    assert len(body["controls"]) == 4
    assert body["settings"]["templates_confirmed_at"] is None
    back = owner.post(f"{base}/controls/load-library").json()
    assert back["rcm_source"] == "LIBRARY"
    assert len(back["controls"]) == 16
    second = _upload(owner, base, CLIENT_RCM)
    discarded = owner.post(f"{base}/rcm/uploads/{second['id']}/discard")
    assert discarded.status_code == 200
    assert discarded.json()["open_import_id"] is None
    assert len(discarded.json()["controls"]) == 16
    closed = owner.post(
        f"{base}/rcm/uploads/{second['id']}/import", json={"version": second["version"] + 1}
    )
    assert closed.status_code == 409


def test_uploads_are_checked_and_limited_to_people_who_run_setup(migrated: Database) -> None:
    team = _new_engagement(migrated, "upload-roles")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    with connect(migrated.url) as connection:
        reader_id = _add_user(connection, org, f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER")
        _add_project_member(connection, org, project, reader_id)
    reader = _session(migrated, reader_id)
    denied = reader.post(
        f"{base}/rcm/uploads", params={"file_name": "rcm.csv"}, content=CLIENT_RCM.encode()
    )
    assert denied.status_code == 403
    garbage = owner.post(
        f"{base}/rcm/uploads", params={"file_name": "rcm.xlsx"}, content=b"PK\x03\x04broken"
    )
    assert garbage.status_code == 422
    assert garbage.json()["detail"] == "file is not a readable workbook"
    pathy = _upload(owner, base, CLIENT_RCM, file_name="..\\..\\secret\\Acme RCM.csv")
    assert pathy["file_name"] == "Acme RCM.csv"
    readable = reader.get(f"{base}/rcm/uploads/{pathy['id']}")
    assert readable.status_code == 200
    bad_mapping = owner.patch(
        f"{base}/rcm/uploads/{pathy['id']}/mapping",
        json={
            "version": pathy["version"],
            "column_fields": ["control_ref"] * len(pathy["columns"]),
            "values": [],
        },
    )
    assert bad_mapping.status_code == 422
    bad_value = owner.patch(
        f"{base}/rcm/uploads/{pathy['id']}/mapping",
        json={
            "version": pathy["version"],
            "column_fields": [column["field"] for column in pathy["columns"]],
            "values": [{"field": "frequency", "value": "Daily", "mapped": "HOURLY"}],
        },
    )
    assert bad_value.status_code == 422


def test_long_cells_that_look_alike_give_distinct_samples(migrated: Database) -> None:
    team = _new_engagement(migrated, "long-cells")
    base = _base(team["org"], team["project"])
    related = "; ".join(f"ITGC-AC-{n:02d}" for n in range(1, 30))
    text = (
        "ID,Description,Related controls\n"
        f'C1,First control,"{related}; ITGC-CM-01"\n'
        f'C2,Second control,"{related}; ITGC-CM-02"\n'
        f'C3,Third control,"{related}; ITGC-CM-02"\n'
    )
    uploaded = _upload(team["owner"], base, text)
    samples = next(c["samples"] for c in uploaded["columns"] if c["header"] == "Related controls")
    assert len(samples) == len(set(samples)) == 1
    assert samples[0].endswith("...")


def test_a_client_control_id_becomes_a_valid_pbc_reference() -> None:
    assert pbc_reference("ITGC-AC-01") == "ITGC-AC-01"
    assert pbc_reference("AC 1.01") == "AC-1.01"
    assert pbc_reference("#7 (key)") == "7-key"
    assert pbc_reference("***") == "CONTROL"


# Helpers


def _upload(
    client: TestClient, base: str, text: str, *, file_name: str = "Acme RCM.csv"
) -> dict[str, Any]:
    response = client.post(
        f"{base}/rcm/uploads", params={"file_name": file_name}, content=text.encode()
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _finish_setup(owner: TestClient, team: dict[str, Any]) -> None:
    base = _base(team["org"], team["project"])
    owner.patch(f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"})
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    assert owner.post(f"{base}/templates/confirm").status_code == 200
    state = owner.get(base).json()
    assert state["ready"] is True, state["readiness"]
