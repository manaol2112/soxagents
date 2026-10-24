import re
from datetime import date
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database, approve_evidence_plans
from test_execution import _add_project_member, _add_user, _ready
from test_outbound import _session, migrated

from ai_workforce_api import onboarding as onboarding_module
from ai_workforce_api.controls import (
    DOMAIN_AGENTS,
    DOMAINS,
    LIBRARY,
    SYSTEM_DOMAINS,
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

# Library version 3 (Milestones 8.8 and 8.9): statements and attributes, see
# docs/testing-definitions.md.
_REVIEWED_LIBRARY = "877a2d07fc2c62cf59edad4ac065d329ff7196c5054a2f55918836f82a8034f1"
_REVIEWED_TEMPLATES = "77f32bb2e93e3c088cd67bbb54d35a6fd15a4cd4f43d0ff63764543fe5dc744c"


def test_the_control_library_and_templates_are_the_reviewed_versions() -> None:
    assert library_problems() == []
    # 48 version 2 controls; version 3 splits four of them into nine (milestone 8.9).
    # 53 controls through version 3, and 29 added in version 4, wave 1 (milestone L3c).
    assert len(LIBRARY) == 82
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
    result = preview("itgc", control, "SOX 2027", date(2027, 12, 31))
    # The instance for one application carries the application in its reference; each
    # tab has its own.
    assert result.reference == "ITGC-AC-03-SE"
    tabs = {tab.key: tab for tab in result.tabs}
    assert [tab.key for tab in result.tabs] == ["design", "interim", "rollforward"]
    assert tabs["design"].reference == "ITGC-AC-03-SE-TOD"
    assert tabs["interim"].reference == "ITGC-AC-03-SE-TOE"
    sections = {section.title: section for section in tabs["interim"].sections}
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
    # The design tab tests each attribute's design; the roll-forward sizes an update sample.
    design = {section.title: section for section in tabs["design"].sections}
    assert [row[0] for row in design["Design attributes"].rows] == [
        "A. Listing is complete",
        "B. Reviewer is independent",
    ]
    update = {section.title: section for section in tabs["rollforward"].sections}
    assert {f.label: f.value for f in update["Update sample"].fields}["Sample size"] == "1"


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
    assert len(ready["pbc_preview"]) == 31
    proposed = owner.post(f"{_base(org, project)}/plan").json()
    plan = proposed["plan"]
    assert plan["status"] == "PROPOSED"
    assert len(plan["items"]) == 31 * 4 + 1
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
    assert body["plan"]["created_tasks"] == 125
    # Each control's evidence plan waits for a person. Nothing is requested at launch.
    # Approving the plans, and settling the attributes, requests design and operating
    # evidence.
    with connect(migrated.url) as connection:
        launched = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s",
            (project,),
        ).fetchone()
    assert launched == (0,)
    assert body["plan"]["created_requests"] == 0
    approve_evidence_plans(migrated, project)
    with connect(migrated.url) as connection:
        made = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s", (project,)
        ).fetchone()
    assert made == (62,)
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
            SELECT count(*), bool_and(status = 'DRAFT'),
                   bool_and(engagement_control_id IS NOT NULL),
                   count(*) FILTER (WHERE testing_phase = 'DESIGN'),
                   count(*) FILTER (WHERE testing_phase = 'INTERIM')
            FROM pbc_requests WHERE project_id = %s
            """,
            (project,),
        ).fetchone()
        mail = connection.execute("SELECT count(*) FROM mailbox_messages").fetchone()
    assert unassigned == (0,)
    # Per control: test waits on walkthrough and evidence, review waits on test.
    assert dependencies == (31 * 3 + 31,)
    assert requests == (62, True, True, 31, 31)
    assert mail == (0,)
    again = owner.post(
        f"{_base(org, project)}/plan/{plan['id']}/approve",
        json={"fingerprint": plan["fingerprint"]},
    )
    assert again.status_code == 409
    locked = owner.patch(f"{_base(org, project)}/scope", json={"scope": "x", "period_end": None})
    assert locked.status_code == 409
    assert locked.json()["detail"] == "engagement has started"


def test_the_launch_page_shows_the_plan_and_launches_in_one_step(migrated: Database) -> None:
    team = _new_engagement(migrated, "launch")
    owner, org, project = team["owner"], team["org"], team["project"]
    # The page counts the work as it stands even before setup is ready: nothing yet.
    early = owner.get(_base(org, project)).json()
    assert early["ready"] is False
    assert early["plan_preview"]["items"] == []
    _complete_setup(owner, team)
    ready = owner.get(_base(org, project)).json()
    preview = ready["plan_preview"]
    assert ready["plan"] is None and preview is not None
    assert len(preview["items"]) == 31 * 4 + 1
    # The plan the page showed must still match the setup.
    stale = owner.post(f"{_base(org, project)}/plan/launch", json={"fingerprint": "0" * 64})
    assert stale.status_code == 409
    started = owner.post(
        f"{_base(org, project)}/plan/launch", json={"fingerprint": preview["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["started"] is True and body["project_status"] == "ACTIVE"
    assert body["plan"]["status"] == "APPROVED"
    assert body["plan"]["fingerprint"] == preview["fingerprint"]
    assert body["plan"]["created_tasks"] == 125
    assert body["plan_preview"] is None
    again = owner.post(
        f"{_base(org, project)}/plan/launch", json={"fingerprint": preview["fingerprint"]}
    )
    assert again.status_code == 409


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
    assert len(fresh["items"]) == 30 * 4 + 1
    assert owner.get(_base(org, project)).json()["project_status"] == "DRAFT"


def test_a_launch_approval_is_stale_after_the_profile_changes(migrated: Database) -> None:
    team = _new_engagement(migrated, "stale-profile")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    _complete_setup(owner, team)
    preview = owner.get(base).json()["plan_preview"]
    current = owner.get(base).json()["settings"]
    changed = owner.patch(
        f"{base}/profile",
        json={
            "client_name": current["client_name"],
            "engagement_type": current["engagement_type"],
            "period_end": "2027-11-30",
        },
    )
    assert changed.status_code == 200, changed.text
    refused = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "setup changed since the plan was shown"
    assert owner.get(base).json()["started"] is False


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
    # Evidence requests are not part of setup: nothing about them is checked here.
    assert "pbc" not in issues
    # Owners are not assigned on setup: a missing one is neither a blocker nor a note.
    assert issues["rcm"] == []
    assert advisories["rcm"] == []
    # The templates need no confirmation (product owner, 22 October 2026): the standard
    # ones apply by default, so the step names nothing to do.
    assert issues["workpapers"] == []


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
    _choose_methodology(owner, base)
    ready = owner.get(base).json()
    assert ready["ready"] is True, ready["readiness"]
    assert {item["recipient"] for item in ready["pbc_preview"]} == {"pbc@client.example"}
    assert all(item["to_coordinator"] for item in ready["pbc_preview"])
    plan = owner.post(f"{base}/plan").json()["plan"]
    started = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    approve_evidence_plans(migrated, project)
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
    _choose_methodology(owner, base)
    first = {item["step"]: item for item in owner.get(base).json()["readiness"]}
    assert first["scope"]["complete"] is True
    # The library waits for a system: each control is one instance per system.
    refused = owner.post(f"{base}/controls/load-library")
    assert refused.status_code == 409
    assert owner.get(base).json()["controls"] == []
    owner.post(f"{base}/applications", json={"name": "SAP S/4HANA"})
    added = owner.post(f"{base}/controls/load-library").json()
    issues = {item["step"]: item["issues"] for item in added["readiness"]}["rcm"]
    assert not any("system" in issue for issue in issues)
    assert all(control["application_ids"] for control in added["controls"])


def test_changing_a_template_leaves_the_engagement_ready(migrated: Database) -> None:
    """Rewritten 22 October 2026. It asserted that changing a control's template made the
    engagement unready until the templates were confirmed again; the product owner removed
    that confirmation, since the standard or firm templates apply by default and a change
    applies only to workpapers not yet started. The previews and the change itself are
    still checked."""
    team = _new_engagement(migrated, "templates")
    owner, org, project = team["owner"], team["org"], team["project"]
    _complete_setup(owner, team)
    control = next(
        c for c in owner.get(_base(org, project)).json()["controls"] if c["nature"] == "MANUAL"
    )
    viewed = owner.get(
        f"{_base(org, project)}/workpaper-preview",
        params={"template": control["template_key"], "control_id": control["id"]},
    )
    assert viewed.status_code == 200
    assert viewed.json()["tabs"][1]["reference"] == f"{control['control_ref']}-SE-TOE"
    customised = owner.post(
        f"{_base(org, project)}/workpaper-templates/customize", json={"base_key": "itgc"}
    )
    assert customised.status_code == 200
    assert owner.post(f"{_base(org, project)}/templates/confirm").status_code == 200
    firm = next(t for t in customised.json()["templates"] if t["source"] == "FIRM")
    owner.patch(
        f"{_base(org, project)}/controls/{control['id']}",
        json={**_control_fields(control), "template_key": firm["key"]},
    )
    after = owner.get(_base(org, project)).json()
    assert (
        next(c for c in after["controls"] if c["id"] == control["id"])["template_key"]
        == (firm["key"])
    )
    assert after["ready"] is True, after["readiness"]


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
    # Order to cash 4; application controls 2 (version 3) + 11 (version 4); access 6 + 6.
    assert len(loaded["controls"]) == 4 + 13 + 12
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
    _choose_methodology(owner, base)
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
    # The IT general controls: 16 in version 2, 19 once OP-02 and OP-03 are split (8.9),
    # 31 with the twelve added in library version 4 (L3c).
    assert len(loaded["controls"]) == 31
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
    _choose_methodology(owner, base)


def _choose_methodology(owner: TestClient, base: str) -> None:
    """The methodology is chosen before launch (migration 0074)."""
    current = owner.get(base).json()["settings"]
    chosen = owner.patch(
        f"{base}/profile",
        json={
            "client_name": current["client_name"],
            "engagement_type": current["engagement_type"],
            "methodology": "EXTERNAL_ICFR",
        },
    )
    assert chosen.status_code == 200, chosen.text


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
        "template_key",
    )
    return {key: control[key] for key in keys}


def _base(org: UUID, project: UUID) -> str:
    return f"/organizations/{org}/projects/{project}/onboarding"


def test_a_control_is_one_instance_per_application(migrated: Database) -> None:
    """Milestone 8.5: a control over several systems is tested once per system."""
    team = _new_engagement(migrated, "instances")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    owner.patch(f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"})
    apps = {
        name: owner.post(f"{base}/applications", json={"name": name}).json()
        for name in ("SAP ERP", "Oracle EBS")
    }
    app_ids = {a["name"]: a["id"] for a in apps["Oracle EBS"]["applications"]}
    loaded = owner.post(f"{base}/controls/load-library").json()["controls"]
    # Every control in the library is two rows: the same ID, one application each.
    by_ref: dict[str, list[dict[str, Any]]] = {}
    for control in loaded:
        by_ref.setdefault(control["control_ref"], []).append(control)
    assert all(len(rows) == 2 for rows in by_ref.values())
    first = sorted(by_ref["ITGC-AC-01"], key=lambda c: c["application_name"])
    assert [c["label"] for c in first] == ["ITGC-AC-01 · Oracle EBS", "ITGC-AC-01 · SAP ERP"]
    assert [c["application_ids"] for c in first] == [[app_ids["Oracle EBS"]], [app_ids["SAP ERP"]]]

    # Unticking a system on the control removes that instance; ticking adds one back.
    sap = next(c for c in first if c["application_name"] == "SAP ERP")
    fewer = owner.patch(
        f"{base}/controls/{sap['id']}",
        json={**_control_fields(sap), "application_ids": [app_ids["SAP ERP"]]},
    )
    assert fewer.status_code == 200, fewer.text
    left = [c for c in fewer.json()["controls"] if c["control_ref"] == "ITGC-AC-01"]
    assert [c["label"] for c in left] == ["ITGC-AC-01 · SAP ERP"]
    sap = left[0]
    more = owner.patch(
        f"{base}/controls/{sap['id']}",
        json={
            **_control_fields(sap),
            "owner_name": "Pat Lee",
            "application_ids": [app_ids["SAP ERP"], app_ids["Oracle EBS"]],
        },
    )
    assert more.status_code == 200, more.text
    again = [c for c in more.json()["controls"] if c["control_ref"] == "ITGC-AC-01"]
    assert sorted(c["application_name"] for c in again) == ["Oracle EBS", "SAP ERP"]
    # A change to the control reaches every instance.
    assert {c["owner_name"] for c in again} == {"Pat Lee"}
    # With no system chosen, one row remains, for no application.
    sap = next(c for c in again if c["id"] == sap["id"])
    cleared = owner.patch(
        f"{base}/controls/{sap['id']}", json={**_control_fields(sap), "application_ids": []}
    )
    assert cleared.status_code == 200, cleared.text
    none = cleared.json()["controls"]
    bare = [c for c in none if c["control_ref"] == "ITGC-AC-01"]
    assert [(c["application_id"], c["label"]) for c in bare] == [(None, "ITGC-AC-01")]
    # A system that leaves scope takes its instances with it.
    removed = owner.post(f"{base}/applications/{app_ids['Oracle EBS']}/remove").json()
    assert all(c["application_name"] != "Oracle EBS" for c in removed["controls"])
    assert all(len(rows) == 1 for rows in _by_ref(removed["controls"]).values())


def _by_ref(controls: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for control in controls:
        grouped.setdefault(control["control_ref"], []).append(control)
    return grouped


def test_the_standard_library_waits_for_an_in_scope_system(migrated: Database) -> None:
    """Every control is one instance per system, so the library needs a system first."""
    team = _new_engagement(migrated, "systems-first")
    owner, base = team["owner"], _base(team["org"], team["project"])
    refused = owner.post(f"{base}/controls/load-library")
    assert (refused.status_code, refused.json()["detail"]) == (
        409,
        "add an in-scope system first",
    )
    assert owner.get(base).json()["controls"] == []
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    loaded = owner.post(f"{base}/controls/load-library").json()
    assert loaded["controls"]
    on_systems = [c for c in loaded["controls"] if c["domain"] in SYSTEM_DOMAINS]
    assert on_systems and all(c["application_id"] is not None for c in on_systems)


def test_business_process_controls_belong_to_a_process_not_a_system(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "process-controls")
    owner, base = team["owner"], _base(team["org"], team["project"])
    # They load without a system, one row each.
    loaded = owner.post(
        f"{base}/controls/load-library", json={"domains": ["ENTITY", "ORDER_TO_CASH"]}
    )
    assert loaded.status_code == 200, loaded.text
    controls = loaded.json()["controls"]
    assert controls and all(c["application_id"] is None for c in controls)
    assert len({c["control_ref"] for c in controls}) == len(controls)
    # A system gets the IT controls, not the business process ones, now and when added later.
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    body = owner.post(f"{base}/controls/load-library").json()
    entity = [c for c in body["controls"] if c["domain"] == "ENTITY"]
    assert entity and all(c["application_id"] is None for c in entity)
    assert all(c["application_id"] is not None for c in body["controls"] if c["domain"] == "ACCESS")
    owner.post(f"{base}/applications", json={"name": "Oracle"})
    body = owner.get(base).json()
    assert len([c for c in body["controls"] if c["domain"] == "ENTITY"]) == len(entity)
    assert len([c for c in body["controls"] if c["control_ref"] == "ITGC-AC-01"]) == 2
    # Nothing asks for their systems.
    issues = {item["step"]: item["issues"] for item in body["readiness"]}
    assert not any("Choose the systems" in issue for issue in issues["rcm"])
    # The library offers the business process controls not loaded yet, and no other.
    offered = {o["domain"] for o in body["process_offers"]}
    assert "PROCURE_TO_PAY" in offered
    assert not offered & {"ENTITY", "ORDER_TO_CASH", "ACCESS", "IPE"}
    # Taking one out keeps it, out of scope, and it can come back.
    first = entity[0]
    out = owner.post(f"{base}/controls/{first['id']}/scope", json={"included": False})
    assert out.status_code == 200, out.text
    assert next(c for c in out.json()["controls"] if c["id"] == first["id"])["included"] is False
    back = owner.post(f"{base}/controls/{first['id']}/scope", json={"included": True})
    assert next(c for c in back.json()["controls"] if c["id"] == first["id"])["included"] is True


def test_one_business_process_control_is_added_from_the_library(migrated: Database) -> None:
    team = _new_engagement(migrated, "process-offers")
    owner, base = team["owner"], _base(team["org"], team["project"])
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    body = owner.post(f"{base}/controls/load-library", json={"domains": ["ACCESS"]}).json()
    offers = body["process_offers"]
    assert offers and all(o["domain"] not in SYSTEM_DOMAINS for o in offers)
    pick = next(o for o in offers if o["domain"] == "PROCURE_TO_PAY")
    added = owner.post(f"{base}/controls/add", json={"library_key": pick["library_key"]})
    assert added.status_code == 200, added.text
    rows = [c for c in added.json()["controls"] if c["control_ref"] == pick["control_ref"]]
    assert [(c["application_id"], c["included"]) for c in rows] == [(None, True)]
    assert pick["library_key"] not in {o["library_key"] for o in added.json()["process_offers"]}
    # An IT control is not added this way: it needs a system.
    refused = owner.post(f"{base}/controls/add", json={"library_key": "access-review"})
    assert refused.status_code == 422


def test_known_systems_are_offered_and_added_with_their_layer(migrated: Database) -> None:
    team = _new_engagement(migrated, "known-systems")
    owner, base = team["owner"], _base(team["org"], team["project"])
    offered = {s["name"]: s["layer"] for s in owner.get(base).json()["known_systems"]}
    assert offered["Workday"] == "APPLICATION"
    assert offered["Active Directory"] == "INFRASTRUCTURE"
    assert offered["Oracle Database"] == "DATABASE"
    # Plain "SAP" is too vague to test; the products are offered instead.
    assert "SAP" not in offered and "SAP S/4HANA" in offered
    added = owner.post(
        f"{base}/applications/known",
        json={"names": ["Workday", "Active Directory", "Workday"]},
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert sorted((a["name"], a["layer"]) for a in body["applications"]) == [
        ("Active Directory", "INFRASTRUCTURE"),
        ("Workday", "APPLICATION"),
    ]
    # What is in scope is no longer offered.
    left = {s["name"] for s in body["known_systems"]}
    assert "Workday" not in left and "Okta" in left
    # The library then loads once per system.
    loaded = owner.post(f"{base}/controls/load-library").json()
    assert len(loaded["controls"]) == 62
    refused = owner.post(f"{base}/applications/known", json={"names": ["My Homegrown ERP"]})
    assert refused.status_code == 422


def test_custom_systems_are_added_with_their_kind_beside_known_ones(migrated: Database) -> None:
    team = _new_engagement(migrated, "custom-systems")
    owner, base = team["owner"], _base(team["org"], team["project"])
    added = owner.post(
        f"{base}/applications/known",
        json={
            "names": ["Okta"],
            "custom": [
                {"name": "  Halvorsen   Billing ", "layer": "APPLICATION"},
                {"name": "Legacy SQL", "layer": "DATABASE"},
            ],
        },
    )
    assert added.status_code == 200, added.text
    assert sorted((a["name"], a["layer"]) for a in added.json()["applications"]) == [
        ("Halvorsen Billing", "APPLICATION"),
        ("Legacy SQL", "DATABASE"),
        ("Okta", "INFRASTRUCTURE"),
    ]
    empty = owner.post(f"{base}/applications/known", json={"names": [], "custom": []})
    assert empty.status_code == 422
    secret = owner.post(
        f"{base}/applications/known",
        json={"custom": [{"name": "password=hunter2", "layer": "TOOL"}]},
    )
    assert secret.status_code == 422


def test_an_engagement_launches_without_a_pbc_coordinator(migrated: Database) -> None:
    """A request drafted with no recipient waits for the coordinator."""
    team = _new_engagement(migrated, "no-coordinator")
    owner, base = team["owner"], _base(team["org"], team["project"])
    owner.post(f"{base}/applications", json={"name": "SAP ERP"})
    owner.post(f"{base}/controls/load-library", json={"domains": ["ACCESS"]})
    readiness = {item["step"]: item for item in owner.get(base).json()["readiness"]}
    # Evidence requests are not part of setup.
    assert "pbc" not in readiness
    # Setup saves the cadence alone and keeps what the Evidence section set.
    cadence = {"pbc_due_days": 12, "pbc_follow_up_days": 4, "pbc_max_follow_ups": 1}
    assert owner.patch(f"{base}/pbc", json=cadence).status_code == 200
    # Drafted without a recipient, as at a launch with no coordinator.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO pbc_requests (
                organization_id, project_id, operation_key, control_ref, owner_user_id,
                recipient, due_at, evidence_description
            )
            VALUES (%s, %s, 'kickoff-test', 'ITGC-AC-01', %s, '', now(), '- Evidence')
            """,
            (team["org"], team["project"], team["owner_id"]),
        )
        connection.commit()
    waiting = owner.get(f"{base}/evidence-contacts")
    assert waiting.status_code == 200, waiting.text
    assert waiting.json()["waiting"] == 1
    # The Evidence section sets the coordinator; the waiting request goes to them.
    contacts = {
        "client_coordinator_name": "Pat Lee",
        "client_coordinator_email": "PBC@client.example",
        "client_domains": ["client.example"],
    }
    saved = owner.patch(f"{base}/evidence-contacts", json=contacts)
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "client_coordinator_name": "Pat Lee",
        "client_coordinator_email": "pbc@client.example",
        "client_domains": ["client.example"],
        "waiting": 0,
    }
    with connect(migrated.url) as connection:
        recipient = connection.execute(
            "SELECT recipient FROM pbc_requests WHERE project_id = %s AND operation_key = %s",
            (team["project"], "kickoff-test"),
        ).fetchone()
    assert recipient == ("pbc@client.example",)
    # The cadence saved later in setup keeps the coordinator.
    assert owner.patch(f"{base}/pbc", json=cadence).status_code == 200
    settings = owner.get(base).json()["settings"]
    assert settings["client_coordinator_email"] == "pbc@client.example"
    assert settings["pbc_due_days"] == 12
    bad = owner.patch(
        f"{base}/evidence-contacts", json={**contacts, "client_coordinator_email": "nope"}
    )
    assert bad.status_code == 422


def test_reading_evidence_contacts_never_schedules_agent_work(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team = _new_engagement(migrated, "contacts-read")
    scheduled: list[list[UUID]] = []
    monkeypatch.setattr(
        onboarding_module,
        "schedule",
        lambda _scheduler, draft_ids: scheduled.append(draft_ids),
    )
    response = team["owner"].get(f"{_base(team['org'], team['project'])}/evidence-contacts")
    assert response.status_code == 200, response.text
    assert scheduled == []


def test_removing_the_only_system_takes_its_controls_out_of_scope(migrated: Database) -> None:
    team = _new_engagement(migrated, "remove-only-system")
    owner, base = team["owner"], _base(team["org"], team["project"])
    sap = owner.post(f"{base}/applications", json={"name": "SAP ERP"}).json()
    sap_id = next(a["id"] for a in sap["applications"] if a["name"] == "SAP ERP")
    loaded = owner.post(f"{base}/controls/load-library").json()["controls"]
    on_systems = [c for c in loaded if c["domain"] in SYSTEM_DOMAINS]
    assert on_systems and all(c["included"] for c in on_systems)
    # The system goes: its controls stay on record, without a system, and out of scope.
    removed = owner.post(f"{base}/applications/{sap_id}/remove").json()
    left = [c for c in removed["controls"] if c["domain"] in SYSTEM_DOMAINS]
    assert len(left) == len(on_systems)
    assert all(c["application_id"] is None and not c["included"] for c in left)
    # A system added later takes them back, in scope.
    workday = owner.post(f"{base}/applications", json={"name": "Workday"}).json()
    back = [c for c in workday["controls"] if c["domain"] in SYSTEM_DOMAINS]
    assert back and all(c["application_name"] == "Workday" and c["included"] for c in back)
