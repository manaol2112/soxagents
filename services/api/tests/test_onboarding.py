import re
from datetime import date
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from support import Database
from test_execution import _add_project_member, _add_user, _ready
from test_outbound import _session, migrated

from ai_workforce_api.controls import (
    DOMAIN_AGENTS,
    DOMAINS,
    LIBRARY,
    library_fingerprint,
    library_problems,
    sample_size,
)
from ai_workforce_api.db import connect
from ai_workforce_api.workforce import sync_standard_workforce
from ai_workforce_api.workpapers import (
    PreviewControl,
    preview,
    templates_fingerprint,
)

__all__ = ["migrated"]

_REVIEWED_LIBRARY = "36047a13357cf1f08f63f0e499f6b745b63d5eaaf671731c907337edb6c09e1a"
_REVIEWED_TEMPLATES = "fcd7bf02d50873690863fb64a0177a114ed3ad9534a73bf52682e2a3e580983a"


def test_the_control_library_and_templates_are_the_reviewed_versions() -> None:
    assert library_problems() == []
    assert len(LIBRARY) == 48
    assert library_fingerprint() == _REVIEWED_LIBRARY
    assert templates_fingerprint() == _REVIEWED_TEMPLATES


def test_sample_sizes_follow_frequency_and_automation() -> None:
    assert sample_size("ANNUAL", "MANUAL") == 1
    assert sample_size("QUARTERLY", "MANUAL") == 2
    assert sample_size("DAILY", "IT_DEPENDENT_MANUAL") == 20
    assert sample_size("EVENT_DRIVEN", "MANUAL") == 25
    assert sample_size("DAILY", "AUTOMATED") == 1


def test_a_preview_shows_the_real_control_and_no_results() -> None:
    control = PreviewControl(
        control_ref="ITGC-AC-03",
        title="User access is reviewed periodically",
        risk="Inappropriate access goes unnoticed.",
        activity="Owners review access quarterly.",
        frequency="QUARTERLY",
        nature="MANUAL",
        owner_name="Dana Owner",
        test_attributes=("Listing is complete", "Reviewer is independent"),
        applications=("SAP ERP",),
    )
    result = preview("oe-manual", control, "SOX 2027", date(2027, 12, 31))
    assert result.reference == "ITGC-AC-03-TOE"
    sections = {section.title: section for section in result.sections}
    header = {field.label: field.value for field in sections["Control"].fields}
    assert header["Control owner"] == "Dana Owner"
    assert header["Applications"] == "SAP ERP"
    assert header["Period end"] == "2027-12-31"
    sample = {field.label: field.value for field in sections["Sample selection"].fields}
    assert sample["Sample size"] == "2"
    matrix = sections["Testing matrix"]
    assert matrix.columns == ["Sample", "A. Listing is complete", "B. Reviewer is independent"]
    assert [row[0] for row in matrix.rows] == ["Sample 1", "Sample 2"]
    assert all(cell == "" for row in matrix.rows for cell in row[1:])
    design = preview("design-walkthrough", control, "SOX 2027", None)
    assert design.reference == "ITGC-AC-03-TOD"


def test_a_new_engagement_is_set_up_and_started_in_one_approved_step(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "journey")
    owner, org, project = team["owner"], team["org"], team["project"]
    first = owner.get(_base(org, project)).json()
    assert first["project_status"] == "DRAFT"
    assert first["ready"] is False
    assert {item["step"]: item["complete"] for item in first["readiness"]}["agents"] is True
    _complete_setup(owner, team)
    ready = owner.get(_base(org, project)).json()
    assert ready["ready"] is True, ready["readiness"]
    assert len(ready["pbc_preview"]) == 16
    proposed = owner.post(f"{_base(org, project)}/plan").json()
    plan = proposed["plan"]
    assert plan["status"] == "PROPOSED"
    assert len(plan["items"]) == 16 * 4 + 1
    assert proposed["project_status"] == "DRAFT"
    started = owner.post(
        f"{_base(org, project)}/plan/{plan['id']}/approve",
        json={"fingerprint": plan["fingerprint"]},
    )
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["started"] is True
    assert body["project_status"] == "ACTIVE"
    assert body["plan"]["status"] == "APPROVED"
    assert body["plan"]["created_tasks"] == 65
    assert body["plan"]["created_requests"] == 16
    with connect(migrated.url) as connection:
        unassigned = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s AND agent_instance_id IS NULL",
            (project,),
        ).fetchone()
        dependencies = connection.execute(
            "SELECT count(*) FROM task_dependencies WHERE project_id = %s", (project,)
        ).fetchone()
        requests = connection.execute(
            """
            SELECT count(*), bool_and(status = 'DRAFT'), bool_and(engagement_control_id IS NOT NULL)
            FROM pbc_requests WHERE project_id = %s
            """,
            (project,),
        ).fetchone()
        mail = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    assert unassigned == (0,)
    # Per control: test waits on walkthrough and evidence, review waits on test.
    assert dependencies == (16 * 3 + 16,)
    assert requests == (16, True, True)
    assert mail == (0,)
    again = owner.post(
        f"{_base(org, project)}/plan/{plan['id']}/approve",
        json={"fingerprint": plan["fingerprint"]},
    )
    assert again.status_code == 409
    locked = owner.patch(f"{_base(org, project)}/scope", json={"scope": "x", "period_end": None})
    assert locked.status_code == 409
    assert locked.json()["detail"] == "engagement has started"


def test_a_plan_from_stale_setup_cannot_start_the_engagement(migrated: Database) -> None:
    team = _new_engagement(migrated, "stale")
    owner, org, project = team["owner"], team["org"], team["project"]
    _complete_setup(owner, team)
    plan = owner.post(f"{_base(org, project)}/plan").json()["plan"]
    control = owner.get(_base(org, project)).json()["controls"][0]
    changed = owner.patch(
        f"{_base(org, project)}/controls/{control['id']}",
        json={**_control_fields(control), "included": False},
    )
    assert changed.status_code == 200
    refused = owner.post(
        f"{_base(org, project)}/plan/{plan['id']}/approve",
        json={"fingerprint": plan["fingerprint"]},
    )
    assert refused.status_code == 409
    fresh = owner.post(f"{_base(org, project)}/plan").json()["plan"]
    assert len(fresh["items"]) == 15 * 4 + 1
    assert owner.get(_base(org, project)).json()["project_status"] == "DRAFT"


def test_setup_gaps_are_named_and_block_the_plan(migrated: Database) -> None:
    team = _new_engagement(migrated, "gaps")
    owner, org, project = team["owner"], team["org"], team["project"]
    assert owner.post(f"{_base(org, project)}/plan").status_code == 409
    owner.post(f"{_base(org, project)}/applications", json={"name": "SAP ERP"})
    owner.post(f"{_base(org, project)}/controls/load-library")
    owner.patch(
        f"{_base(org, project)}/pbc",
        json={**_pbc(), "client_domains": ["client.example"]},
    )
    owner.post(
        f"{_base(org, project)}/controls/owner",
        json={"domain": "ACCESS", "owner_name": "Vendor", "owner_email": "it@vendor.example"},
    )
    readiness = owner.get(_base(org, project)).json()["readiness"]
    issues = {item["step"]: item["issues"] for item in readiness}
    advisories = {item["step"]: item["advisories"] for item in readiness}
    assert "Name an independent reviewer." in issues["team"]
    assert any("outside the client's domains" in issue for issue in issues["pbc"])
    # A missing control owner is a note, not a blocker.
    assert issues["rcm"] == []
    assert any("PBC coordinator" in note for note in advisories["rcm"])
    assert issues["workpapers"] == ["Review the workpaper previews and confirm the templates."]


def test_an_engagement_starts_without_control_owners(migrated: Database) -> None:
    team = _new_engagement(migrated, "no-owners")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    owner.patch(f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"})
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
    owner.post(f"{base}/controls/load-library")
    owner.patch(f"{base}/pbc", json=_pbc())
    owner.post(f"{base}/templates/confirm")
    ready = owner.get(base).json()
    assert ready["ready"] is True, ready["readiness"]
    assert {item["recipient"] for item in ready["pbc_preview"]} == {"pbc@client.example"}
    assert all(item["to_coordinator"] for item in ready["pbc_preview"])
    plan = owner.post(f"{base}/plan").json()["plan"]
    started = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    with connect(migrated.url) as connection:
        recipients = connection.execute(
            "SELECT DISTINCT recipient FROM pbc_requests WHERE project_id = %s", (project,)
        ).fetchall()
        draft = connection.execute(
            "SELECT id FROM pbc_drafts WHERE project_id = %s LIMIT 1", (project,)
        ).fetchone()
        assert draft is not None
        from ai_workforce_api.pbc_drafting import run_draft

        assert run_draft(connection, None, draft[0]) == "DRAFTED"
        text = connection.execute(
            "SELECT r.evidence_description FROM pbc_requests r "
            "JOIN pbc_drafts d ON d.pbc_request_id = r.id WHERE d.id = %s",
            (draft[0],),
        ).fetchone()
    assert recipients == [("pbc@client.example",)]
    assert text is not None and "Please forward this request" in str(text[0])


def test_systems_belong_to_the_rcm_step_not_to_scope(migrated: Database) -> None:
    team = _new_engagement(migrated, "systems-step")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    owner.patch(f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"})
    first = {item["step"]: item for item in owner.get(base).json()["readiness"]}
    assert first["scope"]["complete"] is True
    owner.post(f"{base}/controls/load-library")
    loaded = {item["step"]: item["issues"] for item in owner.get(base).json()["readiness"]}
    assert "Add the in-scope systems the controls run on." in loaded["rcm"]
    assert not any("Choose the systems" in issue for issue in loaded["rcm"])
    added = owner.post(f"{base}/applications", json={"name": "SAP S/4HANA"}).json()
    issues = {item["step"]: item["issues"] for item in added["readiness"]}["rcm"]
    assert not any("system" in issue for issue in issues)
    assert all(control["application_ids"] for control in added["controls"])


def test_changing_a_template_needs_the_previews_confirmed_again(migrated: Database) -> None:
    team = _new_engagement(migrated, "templates")
    owner, org, project = team["owner"], team["org"], team["project"]
    _complete_setup(owner, team)
    control = next(
        c for c in owner.get(_base(org, project)).json()["controls"] if c["nature"] == "MANUAL"
    )
    viewed = owner.get(
        f"{_base(org, project)}/workpaper-preview",
        params={"template": control["effectiveness_template_key"], "control_id": control["id"]},
    )
    assert viewed.status_code == 200
    assert viewed.json()["reference"] == f"{control['control_ref']}-TOE"
    owner.patch(
        f"{_base(org, project)}/controls/{control['id']}",
        json={**_control_fields(control), "effectiveness_template_key": "oe-automated"},
    )
    after = owner.get(_base(org, project)).json()
    assert after["settings"]["templates_confirmed_at"] is None
    assert after["ready"] is False


def test_only_people_who_run_the_engagement_change_its_setup(migrated: Database) -> None:
    team = _new_engagement(migrated, "roles")
    org, project = team["org"], team["project"]
    with connect(migrated.url) as connection:
        reviewer_id = _add_user(
            connection, org, f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, org, project, reviewer_id)
    reader = _session(migrated, reviewer_id)
    assert reader.get(_base(org, project)).status_code == 200
    assert reader.post(f"{_base(org, project)}/controls/load-library").status_code == 403
    assert reader.post(f"{_base(org, project)}/plan").status_code == 403
    _other, _project, stranger = _ready(migrated, "stranger")
    assert stranger.get(_base(org, project)).status_code == 404


def test_business_cycles_come_from_the_library_and_go_to_the_business_tester(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "cycles")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    first = owner.get(base).json()
    areas = {area["domain"]: area for area in first["library"]}
    assert set(areas) == set(DOMAINS) - {"OTHER_BUSINESS"}
    assert areas["ORDER_TO_CASH"]["controls"] == 4
    assert all(area["loaded"] == 0 for area in areas.values())
    unknown = owner.post(f"{base}/controls/load-library", json={"domains": ["PAYROLL"]})
    assert unknown.status_code == 422
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    loaded = owner.post(
        f"{base}/controls/load-library", json={"domains": ["ORDER_TO_CASH", "ITAC", "ACCESS"]}
    ).json()
    assert len(loaded["controls"]) == 4 + 2 + 6
    testers = {c["control_ref"]: c["agent_key"] for c in loaded["controls"]}
    assert testers["OTC-01"] == testers["ITAC-01"] == "business-process-tester"
    assert testers["ITGC-AC-01"] == "itgc-access-tester"
    assert {a["domain"]: a["loaded"] for a in loaded["library"]}["ORDER_TO_CASH"] == 4
    # Moving a control to another area brings that area's tester, unless one is chosen.
    itac = next(c for c in loaded["controls"] if c["control_ref"] == "ITAC-01")
    moved = owner.patch(
        f"{base}/controls/{itac['id']}", json={**_control_fields(itac), "domain": "CHANGE"}
    ).json()
    moved_itac = next(c for c in moved["controls"] if c["id"] == itac["id"])
    assert (moved_itac["domain"], moved_itac["agent_key"]) == ("CHANGE", "itgc-change-tester")
    chosen = owner.patch(
        f"{base}/controls/{itac['id']}",
        json={
            **_control_fields(moved_itac),
            "domain": "ITAC",
            "agent_key": "itgc-access-tester",
        },
    ).json()
    picked = next(c for c in chosen["controls"] if c["id"] == itac["id"])
    assert (picked["domain"], picked["agent_key"]) == ("ITAC", "itgc-access-tester")
    refused = owner.patch(
        f"{base}/controls/{itac['id']}",
        json={**_control_fields(picked), "agent_key": "reporting-analyst"},
    )
    assert refused.status_code == 422
    # The engagement starts with business controls, each task with a staffed agent.
    owner.patch(f"{base}/scope", json={"scope": "SOX FY2027", "period_end": "2027-12-31"})
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
    for domain in ("ORDER_TO_CASH", "ITAC", "ACCESS"):
        owner.post(
            f"{base}/controls/owner",
            json={"domain": domain, "owner_name": "Owner", "owner_email": "owner@client.example"},
        )
    owner.patch(f"{base}/pbc", json=_pbc())
    owner.post(f"{base}/templates/confirm")
    ready = owner.get(base).json()
    assert ready["ready"] is True, ready["readiness"]
    assert "business-process-tester" in {agent["agent_key"] for agent in ready["agents"]}
    plan = owner.post(f"{base}/plan").json()["plan"]
    started = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    with connect(migrated.url) as connection:
        unassigned = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s AND agent_instance_id IS NULL",
            (project,),
        ).fetchone()
    assert unassigned == (0,)


def test_the_database_allows_exactly_the_standard_areas(migrated: Database) -> None:
    with connect(migrated.url) as connection:
        row = connection.execute(
            """
            SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname = 'engagement_controls_domain'
            """
        ).fetchone()
    assert row is not None
    allowed = set(re.findall(r"'([A-Z_]+)'", str(row[0])))
    assert allowed == set(DOMAINS)
    assert set(DOMAIN_AGENTS) == set(DOMAINS)


# Helpers


def _new_engagement(database: Database, slug: str) -> dict[str, Any]:
    with connect(database.url) as connection:
        sync_standard_workforce(connection)
    seeded, _existing, owner = _ready(database, slug)
    org = seeded["organization_id"]
    with connect(database.url) as connection:
        reviewer_id = _add_user(connection, org, f"rev-{uuid4().hex[:6]}@example.com", "ADMIN")
    created = owner.post(
        f"/organizations/{org}/projects",
        json={
            "name": "SOX 2027",
            "slug": f"sox-2027-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(seeded["user_id"]),
            "status": "DRAFT",
        },
    )
    assert created.status_code in (200, 201), created.text
    return {
        "owner": owner,
        "org": org,
        "project": UUID(created.json()["id"]),
        "owner_id": seeded["user_id"],
        "reviewer_id": reviewer_id,
    }


def _complete_setup(owner: TestClient, team: dict[str, Any]) -> None:
    org, project = team["org"], team["project"]
    base = _base(org, project)
    assert (
        owner.patch(
            f"{base}/scope",
            json={"scope": "ITGCs over SAP ERP for FY2027", "period_end": "2027-12-31"},
        ).status_code
        == 200
    )
    assert owner.post(f"{base}/applications", json={"name": "SAP ERP"}).status_code == 200
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        added = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert added.status_code == 200, added.text
    loaded = owner.post(f"{base}/controls/load-library").json()
    assert len(loaded["controls"]) == 16
    for domain, email in (
        ("ACCESS", "iam@client.example"),
        ("CHANGE", "release@client.example"),
        ("OPERATIONS", "ops@client.example"),
    ):
        owner.post(
            f"{base}/controls/owner",
            json={"domain": domain, "owner_name": f"{domain.title()} owner", "owner_email": email},
        )
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    assert owner.post(f"{base}/templates/confirm").status_code == 200


def _pbc() -> dict[str, Any]:
    return {
        "client_coordinator_name": "Pat Coordinator",
        "client_coordinator_email": "pbc@client.example",
        "client_domains": ["client.example"],
        "pbc_due_days": 10,
        "pbc_follow_up_days": 3,
        "pbc_max_follow_ups": 2,
    }


def _control_fields(control: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "version",
        "included",
        "key_control",
        "owner_name",
        "owner_email",
        "frequency",
        "nature",
        "application_ids",
        "design_template_key",
        "effectiveness_template_key",
    )
    return {key: control[key] for key in keys}


def _base(org: UUID, project: UUID) -> str:
    return f"/organizations/{org}/projects/{project}/onboarding"
