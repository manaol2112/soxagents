"""Engagement integrity (Milestone 8.13): one system or control ID however it is cased, a
launch that happens once, and a tested control that does not change silently.

Scope integrity part A (owner decisions, 19 November 2026): every route that takes a
control out of scope asks the same reason, leaving a control out where a SOC report may be
relied on needs a person's reason, and an RCM's repeated control IDs and left-out systems
are imported as the file says, or held until the file is reconciled."""

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from support import Database
from test_manual_controls import _body
from test_onboarding import (
    _base,
    _choose_methodology,
    _complete_setup,
    _control_fields,
    _new_engagement,
    _pbc,
)
from test_outbound import migrated
from test_projects import _edit
from test_rcm_systems import FakeProvider, RecordingScheduler, _client
from test_rcm_uploads import _upload
from test_system_applicability import REPORT, _wand
from test_system_applicability import _setup as _wizard_setup

from ai_workforce_api.db import connect
from ai_workforce_api.rcm_import import (
    build,
    headers,
    parse_file,
    suggest_fields,
    value_choices,
    value_key,
)
from ai_workforce_api.rcm_systems import rules_scan, run_scan, scan_rows

__all__ = ["migrated"]


def test_a_system_is_in_scope_once_however_it_is_written(migrated: Database) -> None:
    team = _new_engagement(migrated, "dup-system")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert owner.post(f"{base}/applications", json={"name": "SAP ERP"}).status_code == 200
    for name in ("SAP ERP", "sap erp", "  Sap   Erp "):
        again = owner.post(f"{base}/applications", json={"name": name})
        assert again.status_code == 409, name
        assert again.json()["detail"] == "system is already in scope"
    # A known system already in scope is refused; one picked beside it is still added.
    assert owner.post(f"{base}/applications/known", json={"names": ["Okta"]}).status_code == 200
    only_taken = owner.post(f"{base}/applications/known", json={"names": ["Okta"]})
    assert only_taken.status_code == 409
    custom_taken = owner.post(
        f"{base}/applications/known",
        json={"custom": [{"name": "OKTA", "layer": "INFRASTRUCTURE"}]},
    )
    assert custom_taken.status_code == 409
    mixed = owner.post(f"{base}/applications/known", json={"names": ["Okta", "Workday"]})
    assert mixed.status_code == 200, mixed.text
    names = sorted(a["name"] for a in mixed.json()["applications"])
    assert names == ["Okta", "SAP ERP", "Workday"]
    # The database refuses a second one written any other way.
    with connect(migrated.url) as connection, pytest.raises(UniqueViolation):
        connection.execute(
            "INSERT INTO engagement_applications (organization_id, project_id, name) "
            "VALUES (%s, %s, %s)",
            (team["org"], team["project"], " workday"),
        )


def test_a_control_id_is_taken_however_it_is_cased(migrated: Database) -> None:
    team = _new_engagement(migrated, "dup-control")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert owner.post(f"{base}/controls/new", json=_body()).status_code == 200
    again = owner.post(f"{base}/controls/new", json=_body(control_ref="rev-09"))
    assert again.status_code == 409
    assert again.json()["detail"] == "control ID exists"
    refs = [c["control_ref"] for c in owner.get(base).json()["controls"]]
    assert refs.count("REV-09") == 1 and "rev-09" not in refs
    # The database refuses the same ID cased another way on the same system.
    with connect(migrated.url) as connection:
        columns = [
            row[0]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'engagement_controls' "
                "AND column_name NOT IN ('id', 'control_ref', 'created_at', 'updated_at')"
            ).fetchall()
        ]
        listed = ", ".join(columns)
        with pytest.raises(UniqueViolation):
            connection.execute(
                f"INSERT INTO engagement_controls (control_ref, {listed}) "  # noqa: S608
                f"SELECT 'Rev-09', {listed} FROM engagement_controls "
                "WHERE project_id = %s AND control_ref = 'REV-09'",
                (team["project"],),
            )


def test_an_engagement_launches_once(migrated: Database) -> None:
    team = _new_engagement(migrated, "launch-once")
    owner, base = team["owner"], _base(team["org"], team["project"])
    # Not before setup is complete.
    early = owner.post(f"{base}/plan/launch", json={"fingerprint": "0" * 64})
    assert early.status_code == 409
    _complete_setup(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    first = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert first.status_code == 200, first.text
    second = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert second.status_code == 409
    assert second.json()["detail"] == "engagement has started"
    with connect(migrated.url) as connection:
        tasks = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s", (team["project"],)
        ).fetchone()
        plans = connection.execute(
            "SELECT count(*) FROM engagement_plans WHERE project_id = %s AND status = 'APPROVED'",
            (team["project"],),
        ).fetchone()
    assert tasks is not None and tasks[0] == 125
    assert plans is not None and plans[0] == 1
    # The engagement is active and its setup locked; it cannot be made a draft again.
    state = owner.get(base).json()
    assert state["started"] is True and state["project_status"] == "ACTIVE"
    project = f"/organizations/{team['org']}/projects/{team['project']}"
    detail = owner.get(project).json()
    back = owner.patch(
        project, json={**_edit(detail), "status": "DRAFT", "version": detail["version"]}
    )
    assert back.status_code == 409
    assert owner.get(project).json()["status"] == "ACTIVE"


def test_a_tested_control_changes_only_when_the_team_says_so(migrated: Database) -> None:
    team = _new_engagement(migrated, "tested-edit")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    control = next(c for c in owner.get(base).json()["controls"] if c["frequency"] != "DAILY")
    assert control["tested"] is False
    _test_sheet(migrated, team, UUID(control["id"]))
    assert _find(owner.get(base).json(), control["id"])["tested"] is True
    # A change that testing does not rest on goes through.
    owner_only = {**_control_fields(control), "owner_name": "New owner"}
    plain = owner.patch(f"{base}/controls/{control['id']}", json=owner_only)
    assert plain.status_code == 200, plain.text
    control = _find(plain.json(), control["id"])
    # A change to its frequency needs the team to say it knows the testing is affected.
    changed = {**_control_fields(control), "frequency": "DAILY"}
    refused = owner.patch(f"{base}/controls/{control['id']}", json=changed)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "control has testing on record"
    assert _find(owner.get(base).json(), control["id"])["frequency"] == control["frequency"]
    accepted = owner.patch(
        f"{base}/controls/{control['id']}", json={**changed, "acknowledge_testing": True}
    )
    assert accepted.status_code == 200, accepted.text
    assert _find(accepted.json(), control["id"])["frequency"] == "DAILY"
    with connect(migrated.url) as connection:
        issues = connection.execute(
            "SELECT topic, kind, status FROM control_context_issues "
            "WHERE engagement_control_id = %s",
            (control["id"],),
        ).fetchall()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.control' AND payload ? 'after_testing'",
            (team["project"],),
        ).fetchall()
    assert len(issues) == 1
    topic, kind, status = issues[0]
    assert topic.startswith("Changed after testing: Frequency from ") and topic.endswith("daily")
    assert (kind, status) == ("CONFLICT", "OPEN")
    assert [row[0]["after_testing"] for row in audit] == [["frequency"]]


def _find(body: dict[str, Any], control_id: str) -> dict[str, Any]:
    return next(c for c in body["controls"] if c["id"] == control_id)


def _test_sheet(database: Database, team: dict[str, Any], control_id: UUID) -> None:
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by
            )
            VALUES (%s, %s, %s, 'TEST_OF_ONE', %s, %s)
            """,
            (team["org"], team["project"], control_id, Json(["Approved"]), team["owner_id"]),
        )
        connection.commit()


# Scope integrity part A: one reason rule on every route that takes a control out of scope


ROOT = Path(__file__).resolve().parents[3]
REASON_CASES = ROOT / "tests/fixtures/scope-reasons/cases.json"


def test_the_wizard_and_the_server_ask_a_reason_for_the_same_exclusions() -> None:
    """One table of cases, read by this test and the web's (system-scoping-model), so the
    wizard asks exactly where the API refuses (invariant I16)."""
    from ai_workforce_api.system_applicability import reason_needed, soc_waived

    cases = json.loads(REASON_CASES.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 10
    for case in cases:
        waived = soc_waived(
            case["hosting"], case["socExpected"], case["confirmed"], case["reports"]
        )
        assert reason_needed(case["status"], case["reviewed"], waived) is case["needs"], case[
            "name"
        ]


def test_the_system_wizard_asks_the_same_reason_for_work_on_record(migrated: Database) -> None:
    team, owner, base = _launched(migrated, "wizard-reason")
    state = owner.get(base).json()
    sap = next(a["id"] for a in state["applications"] if a["name"] == "SAP ERP")
    mine = {c["control_ref"]: c for c in state["controls"] if c["application_id"] == sap}
    tested, other = mine["ITGC-AC-02"], mine["ITGC-AC-03"]
    url = f"{base}/systems/{sap}/applicability"
    # Nothing on record: it leaves with no reason, after launch too.
    out = owner.put(url, json={"selections": [{"control_ref": "ITGC-AC-03", "selected": False}]})
    assert out.status_code == 200, out.text
    _test_sheet(migrated, team, UUID(tested["id"]))
    # Work on record: the reason the other routes ask (R1-R4), and the whole selection is
    # refused, including the control it would bring back.
    refused = owner.put(
        url,
        json={
            "selections": [
                {"control_ref": "ITGC-AC-02", "selected": False},
                {"control_ref": "ITGC-AC-03", "selected": True},
            ]
        },
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "say why: this has work on record"
    after = owner.get(base).json()
    assert _find(after, tested["id"])["included"] is True
    assert _find(after, other["id"])["included"] is False
    why = "Relied on the SOC 1 report instead."
    saved = owner.put(
        url, json={"selections": [{"control_ref": "ITGC-AC-02", "selected": False, "note": why}]}
    )
    assert saved.status_code == 200, saved.text
    assert _find(saved.json(), tested["id"])["included"] is False
    audit = _audits(migrated, team["project"], "onboarding.system_applicability")[-1]
    removed = audit["removed"]["ITGC-AC-02"]
    assert removed["reason"] == why
    assert removed["impact"]["tested"] == 1 and removed["impact"]["material"] is True
    assert audit["reasons"] == {"ITGC-AC-02": why}


def test_the_system_wizard_needs_no_reason_before_launch_or_a_review(migrated: Database) -> None:
    """Guard against asking too much: no review, no launch, nothing on record."""
    owner, base, system_id, _team = _wizard_setup(migrated)
    candidates = _system_of(owner, base, system_id)["candidates"]
    ref = next(c["control_ref"] for c in candidates if c["in_scope"])
    saved = owner.put(
        f"{base}/systems/{system_id}/applicability",
        json={"selections": [{"control_ref": ref, "selected": False}]},
    )
    assert saved.status_code == 200, saved.text


def test_leaving_out_a_control_the_agent_did_not_recommend_needs_a_reason(
    migrated: Database,
) -> None:
    owner, base, system_id, team = _wizard_setup(migrated)
    # The reviewed rules (no model) mark each candidate Recommended, Potentially applicable
    # or Needs your judgment; one is set Not recommended, as a model could.
    system = _wand(migrated, owner, base, system_id)
    calls = {c["control_ref"]: c for c in system["assessment"]["candidates"]}
    recommended = next(r for r, c in calls.items() if c["status"] == "RECOMMENDED")
    potential = next(r for r, c in calls.items() if c["status"] == "POTENTIAL")
    judgment, not_recommended = [r for r, c in calls.items() if c["status"] == "JUDGMENT"][:2]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE system_control_assessments SET status = 'NOT_RECOMMENDED' "
            "WHERE application_id = %s AND control_ref = %s",
            (system_id, not_recommended),
        )
    url = f"{base}/systems/{system_id}/applicability"

    def leave_out(ref: str, note: str = "") -> Any:
        return owner.put(
            url, json={"selections": [{"control_ref": ref, "selected": False, "note": note}]}
        )

    for ref in (not_recommended, potential, judgment):
        refused = leave_out(ref)
        assert refused.status_code == 409, ref
        assert refused.json()["detail"] == "say why a control left out is not selected"
    # Two characters are not a reason, on either rule (the threshold _reason_for uses).
    assert leave_out(not_recommended, "ok").status_code == 409
    short = leave_out(recommended, "no")
    assert short.status_code == 409
    assert short.json()["detail"] == "say why a recommended control is not selected"
    calls = {c["control_ref"]: c for c in _system_of(owner, base, system_id)["candidates"]}
    asked = (recommended, potential, judgment, not_recommended)
    assert all(calls[r]["decision"] is None and calls[r]["in_scope"] for r in asked)
    why = "Relied on the vendor's SOC 1 report."
    saved = leave_out(not_recommended, why)
    assert saved.status_code == 200, saved.text
    calls = {c["control_ref"]: c for c in _system_of(owner, base, system_id)["candidates"]}
    assert calls[not_recommended]["decision"] == "NOT_SELECTED"
    assert calls[not_recommended]["decision_note"] == why
    audit = _audits(migrated, team["project"], "onboarding.system_applicability")[-1]
    assert audit["reasons"] == {not_recommended: why}
    # A later save that sends no note keeps the reason on record, and asks nothing again.
    again = leave_out(not_recommended)
    assert again.status_code == 200, again.text
    calls = {c["control_ref"]: c for c in _system_of(owner, base, system_id)["candidates"]}
    assert calls[not_recommended]["decision_note"] == why
    latest = _audits(migrated, team["project"], "onboarding.system_applicability")[-1]
    assert latest["reasons"] == {not_recommended: why}
    # The team confirms the system runs on premises with no SOC report: no SOC reliance is
    # possible, so no reason is asked, except for a Recommended control.
    version = _system_row(owner, base, system_id)["version"]
    confirmed = owner.patch(
        f"{base}/systems/{system_id}/facts",
        json={"version": version, "hosting": "ON_PREMISES", "soc_expected": False},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert leave_out(potential).status_code == 200
    assert leave_out(recommended).status_code == 409
    # The agent's assumption is not the team's confirmation.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_applications SET facts_confirmed = false WHERE id = %s",
            (system_id,),
        )
    assert leave_out(judgment).status_code == 409
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_applications SET facts_confirmed = true WHERE id = %s",
            (system_id,),
        )
    # A SOC report on file, whatever its status, asks again.
    uploaded = owner.post(
        f"{base}/systems/{system_id}/soc-reports/upload",
        params={"file_name": "Vendor SOC 1.txt"},
        content=REPORT.encode(),
        headers={"content-type": "text/plain"},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert leave_out(judgment).status_code == 409


def test_relying_on_a_soc_report_instead_of_testing_needs_a_reason(migrated: Database) -> None:
    team = _new_engagement(migrated, "soc-reliance")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    state = owner.get(base).json()
    sap = next(a for a in state["applications"] if a["name"] == "SAP ERP")
    mine = {c["control_ref"]: c for c in state["controls"] if c["application_id"] == sap["id"]}
    relied, dismissed, offered = mine["ITGC-AC-02"], mine["ITGC-AC-04"], mine["ITGC-AC-05"]
    confirmed = owner.patch(
        f"{base}/systems/{sap['id']}/facts",
        json={"version": sap["version"], "hosting": "SAAS", "soc_expected": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    rationale = "The SOC 1 report tests this control."
    ids: dict[str, Any] = {}
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = %s", (offered["id"],)
        )
        for control, kind in ((relied, "EXCLUDE"), (dismissed, "EXCLUDE"), (offered, "INCLUDE")):
            row = connection.execute(
                """
                INSERT INTO system_recommendations (
                    organization_id, project_id, application_id, kind, control_id, reason
                )
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (team["org"], team["project"], sap["id"], kind, control["id"], rationale),
            ).fetchone()
            assert row is not None
            ids[control["id"]] = row[0]
    url = f"{base}/systems/{sap['id']}/recommendations/decide"

    def decide(control: dict[str, Any], action: str, reason: str | None = None) -> Any:
        body: dict[str, Any] = {"ids": [str(ids[control["id"]])], "action": action}
        if reason is not None:
            body["reason"] = reason
        return owner.post(url, json=body)

    # Before launch too: a person's reason, never the agent's rationale.
    for reason in (None, "", "ok"):
        refused = decide(relied, "ACCEPT", reason)
        assert refused.status_code == 409, reason
        assert refused.json()["detail"] == "say why the SOC report is relied on instead of testing"
    # Leaving out a recommended control needs a reason here as in the wizard.
    declined = decide(offered, "DISMISS")
    assert declined.status_code == 409
    assert declined.json()["detail"] == "say why a recommended control is not selected"
    # Dismissing reliance keeps the control tested: nothing to explain.
    assert decide(dismissed, "DISMISS").status_code == 200
    assert _recommendation(migrated, ids[relied["id"]]) == "PROPOSED"
    assert _find(owner.get(base).json(), relied["id"])["included"] is True
    # After launch, with testing on record.
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    _test_sheet(migrated, team, UUID(relied["id"]))
    assert decide(relied, "ACCEPT").status_code == 409
    assert _recommendation(migrated, ids[relied["id"]]) == "PROPOSED"
    assert _find(owner.get(base).json(), relied["id"])["included"] is True
    why = "Relied on the vendor's SOC 1 Type 2 report."
    accepted = decide(relied, "ACCEPT", why)
    assert accepted.status_code == 200, accepted.text
    assert _find(accepted.json(), relied["id"])["included"] is False
    assert _recommendation(migrated, ids[relied["id"]]) == "ACCEPTED"
    audit = _audits(migrated, team["project"], "onboarding.system_scoping")[-1]
    assert audit["reason"] == why and audit["reason"] != rationale
    assert audit["impact"]["tested"] == 1 and audit["impact"]["material"] is True
    # Tested after all: back in scope with no reason needed to include it.
    kept = decide(relied, "KEEP")
    assert kept.status_code == 200, kept.text
    assert _find(kept.json(), relied["id"])["included"] is True


# Scope integrity part A: repeated control IDs and the systems a control is imported for

RCM_HEAD = (
    "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner,Systems,Region\n"
)
# One row per system for AC 1.01, with the same content (spacing and case aside).
REPEATED_RCM = RCM_HEAD + (
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Ledger One,"
    "EMEA\n"
    "CM 2.01,Changes are tested before release.,Quarterly,Manual,Program Change,Lee Park,"
    "Ledger One,Global\n"
    "AC 1.01,Managers  approve new access.,As needed,Manual,User Access,Dana Ruiz,Workday,"
    "EMEA\n"
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,ledger one,"
    "EMEA\n"
)
CONFLICTING_RCM = RCM_HEAD + (
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Ledger One,"
    "EMEA\n"
    "AC 1.01,HR approves new access.,As needed,Manual,User Access,Lee Park,Workday,EMEA\n"
    "AC 1.02,Access is reviewed.,Quarterly,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
    "AC 1.02,Access is reviewed.,Quarterly,Manual,User Access,Dana Ruiz,,EMEA\n"
    "AC 1.03,Leavers are removed.,As needed,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
    "AC 1.03,Leavers are removed.,As needed,Manual,User Access,Dana Ruiz,All systems,EMEA\n"
    "AC 1.04,Admins are restricted.,Quarterly,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
    "AC 1.04,Admins are restricted.,Quarterly,Manual,User Access,Dana Ruiz,Workday,"
    "password = Winter2027x\n"
)
LEFT_OUT_RCM = RCM_HEAD + (
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Ledger One,"
    "EMEA\n"
    "OR 1.01,Treasury users are reviewed.,Quarterly,Manual,User Access,Dana Ruiz,"
    "Treasury Box,EMEA\n"
    "OP 3.01,Job failures are resolved.,Daily,Manual,Computer Ops,Sam Ops,,Global\n"
)


def test_repeated_rows_with_the_same_content_are_one_control_on_each_system() -> None:
    result = _built(REPEATED_RCM)
    assert result.problems == [] and result.skipped == []
    assert [c.control_ref for c in result.controls] == ["AC 1.01", "CM 2.01"]
    access = result.controls[0]
    # Merged ignoring case: Ledger One is named twice and imported once.
    assert access.applications == ["Ledger One", "Workday"]
    assert access.rows == [2, 4, 5]
    assert result.controls[1].rows == [3]
    (merged,) = [w for w in result.warnings if w.startswith("AC 1.01 is on rows")]
    assert merged.startswith("AC 1.01 is on rows 2, 4 and 5 with the same content")
    assert "Ledger One and Workday" in merged and "more than once" in merged


def test_repeated_rows_that_differ_block_the_import_until_reconciled(migrated: Database) -> None:
    result = _built(CONFLICTING_RCM)
    assert result.problems == [
        "Rows 2 and 3 share control ID AC 1.01 but differ in control description and control "
        "owner: make the rows the same or give each its own ID.",
        "Rows 4 and 5 share control ID AC 1.02 but row 5 names no system: name the system on "
        "each row or give each its own ID.",
        "Rows 6 and 7 share control ID AC 1.03 but row 7 names no system: name the system on "
        "each row or give each its own ID.",
        "Row 9 repeats control ID AC 1.04 but cannot be read (it looks like it holds a "
        "secret): fix the row in the file or give it its own ID.",
    ]
    # A repeated row that looks like it holds a secret is skipped, never merged, and holds
    # the import: Workday's instance of AC 1.04 would otherwise never be created.
    assert [(s.row, s.reason) for s in result.skipped] == [
        (9, "The row looks like it holds a secret.")
    ]
    admins = next(c for c in result.controls if c.control_ref == "AC 1.04")
    assert admins.applications == ["Ledger One"] and admins.rows == [8]
    # Many conflicts are listed in part, with a count of the rest.
    many = RCM_HEAD + "".join(
        f"AC 2.0{n},Control {n}.,Daily,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
        f"AC 2.0{n},Other control {n}.,Daily,Manual,User Access,Dana Ruiz,Workday,EMEA\n"
        for n in range(1, 8)
    )
    listed = _built(many).problems
    assert len(listed) == 6 and listed[-1].startswith("And 2 more control IDs")
    # Through the API: the preview says so, Import is not offered, and nothing is written.
    team = _new_engagement(migrated, "conflicting-ids")
    owner, base = team["owner"], _base(team["org"], team["project"])
    uploaded = _upload(owner, base, CONFLICTING_RCM)
    assert uploaded["ready"] is False
    assert uploaded["preview"]["problems"][: len(result.problems)] == result.problems
    # The rows are fixed in the file, not by the mapping (the page's next step), and the
    # setup agent says the upload is held rather than only that the step is ready.
    assert result.fix_in_file is True and uploaded["preview"]["fix_in_file"] is True
    assert ROWS_TO_FIX in _rcm_readiness(owner, base)["advisories"]
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 409
    assert imported.json()["detail"] == "mapping is incomplete"
    assert owner.get(base).json()["controls"] == []
    # A mapping gap is settled by the mapping: not a row to fix in the file.
    _kind, sheets = parse_file("rcm.csv", CONFLICTING_RCM.encode())
    unmapped = build(sheets[0].rows, 1, suggest_fields(headers(sheets[0].rows, 1)), {})
    assert unmapped.problems and unmapped.fix_in_file is False
    ignored = owner.patch(
        f"{base}/rcm/uploads/{uploaded['id']}/mapping",
        json={
            "version": uploaded["version"],
            "column_fields": ["ignore"] * len(uploaded["columns"]),
            "values": [],
        },
    )
    assert ignored.status_code == 200, ignored.text
    assert ignored.json()["preview"]["fix_in_file"] is False
    advisories = _rcm_readiness(owner, base)["advisories"]
    assert ROWS_TO_FIX not in advisories
    assert "The uploaded RCM has items to resolve before it can be imported." in advisories
    # Discarded, nothing holds an import and the agent says nothing of it.
    discarded = owner.post(f"{base}/rcm/uploads/{uploaded['id']}/discard")
    assert discarded.status_code == 200, discarded.text
    assert not any("uploaded RCM" in line for line in _rcm_readiness(owner, base)["advisories"])


ROWS_TO_FIX = "The uploaded RCM has rows to fix before it can be imported."


def _rcm_readiness(owner: Any, base: str) -> dict[str, Any]:
    state = owner.get(base).json()
    item: dict[str, Any] = next(i for i in state["readiness"] if i["step"] == "rcm")
    return item


# The undescribed row comes first, so it is skipped before the described row is kept.
UNREAD_FIRST_RCM = RCM_HEAD + (
    "AC 1.01,,As needed,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Workday,"
    "EMEA\n"
    "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Ledger One,"
    "password = Spring2028y\n"
)


def test_a_repeated_row_that_cannot_be_read_blocks_the_import(migrated: Database) -> None:
    """Fail closed whatever the row order: a skipped row of a kept control ID may name a
    system whose instance would never be created, so the import waits for the file."""
    result = _built(UNREAD_FIRST_RCM)
    assert result.problems == [
        "Row 2 repeats control ID AC 1.01 but cannot be read (no control description): fix "
        "the row in the file or give it its own ID.",
        "Row 4 repeats control ID AC 1.01 but cannot be read (it looks like it holds a "
        "secret): fix the row in the file or give it its own ID.",
    ]
    # The skipped rows stay skipped, and neither is merged into the kept control.
    assert [(s.row, s.reason) for s in result.skipped] == [
        (2, "No control description."),
        (4, "The row looks like it holds a secret."),
    ]
    (access,) = result.controls
    assert access.applications == ["Workday"] and access.rows == [3]
    # A secret's text never reaches the preview.
    assert not any("Spring2028y" in line for line in result.problems + result.warnings)
    # An unreadable row with an ID of its own is skipped as before and holds nothing.
    alone = _built(
        RCM_HEAD + "AC 9.01,,Daily,Manual,User Access,Dana Ruiz,Ledger One,EMEA\n"
        "AC 1.01,Managers approve new access.,As needed,Manual,User Access,Dana Ruiz,Workday,"
        "EMEA\n"
    )
    assert alone.problems == [] and [s.row for s in alone.skipped] == [2]
    assert [c.control_ref for c in alone.controls] == ["AC 1.01"]
    assert result.fix_in_file is True and alone.fix_in_file is False
    # Through the API: not ready, and Import writes nothing.
    team = _new_engagement(migrated, "unread-repeat")
    owner, base = team["owner"], _base(team["org"], team["project"])
    uploaded = _upload(owner, base, UNREAD_FIRST_RCM)
    assert uploaded["ready"] is False
    assert uploaded["preview"]["problems"][: len(result.problems)] == result.problems
    assert uploaded["preview"]["fix_in_file"] is True
    assert ROWS_TO_FIX in _rcm_readiness(owner, base)["advisories"]
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 409
    assert imported.json()["detail"] == "mapping is incomplete"
    assert owner.get(base).json()["controls"] == []


def test_the_system_scan_reads_every_row_of_a_repeated_control() -> None:
    _kind, sheets = parse_file("rcm.csv", REPEATED_RCM.encode())
    rows = sheets[0].rows
    scanned = scan_rows(rows, 1, suggest_fields(headers(rows, 1)))
    assert [(row.control_ref, row.systems_cell) for row in scanned] == [
        ("AC 1.01", "Ledger One"),
        ("CM 2.01", "Ledger One"),
        ("AC 1.01", "Workday"),
        ("AC 1.01", "ledger one"),
    ]
    workday = next(p for p in rules_scan(scanned) if p.name == "Workday")
    assert workday.control_refs == ["AC 1.01"]


def test_a_repeated_control_is_imported_on_each_of_its_systems(migrated: Database) -> None:
    team = _new_engagement(migrated, "repeated-ids")
    owner = _client(migrated, team["owner_id"], RecordingScheduler())
    base = _base(team["org"], team["project"])
    uploaded = _upload(owner, base, REPEATED_RCM)
    upload = f"{base}/rcm/uploads/{uploaded['id']}"
    # A model answer that leaves Workday out: the preview says what would be lost.
    partial = FakeProvider(
        {"systems": [{"name": "Ledger One", "layer": "APPLICATION", "aliases": [],
                      "control_ids": ["AC 1.01", "CM 2.01"]}]}
    )  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_scan(connection, partial, UUID(uploaded["id"])) == "READY"
    read = owner.get(upload).json()
    (uncovered,) = [w for w in read["preview"]["warnings"] if "no identified system" in w]
    assert "AC 1.01 (Workday)" in uncovered
    assert owner.post(f"{upload}/systems/rescan").status_code == 200
    with connect(migrated.url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
        # A scan made before every row was read is identified again before import.
        stored = connection.execute(
            "SELECT sheet_index, header_row, column_fields, systems_basis FROM rcm_imports "
            "WHERE id = %s",
            (uploaded["id"],),
        ).fetchone()
        assert stored is not None
        earlier = hashlib.sha256(json.dumps(list(stored[:3])).encode()).hexdigest()
        assert earlier != stored[3]
        connection.execute(
            "UPDATE rcm_imports SET systems_basis = %s WHERE id = %s", (earlier, uploaded["id"])
        )
    stale = owner.get(upload).json()
    assert stale["ready"] is False
    assert any("Rescan" in problem for problem in stale["preview"]["problems"])
    refused = owner.post(f"{upload}/import", json={"version": stale["version"]})
    assert refused.status_code == 409
    assert owner.post(f"{upload}/systems/rescan").status_code == 200
    with connect(migrated.url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
    read = owner.get(upload).json()
    proposals = {p["name"]: p for p in read["systems"]["proposals"]}
    assert "AC 1.01" in proposals["Workday"]["control_refs"]
    assert read["ready"] is True, read["preview"]["problems"]
    assert read["preview"]["skipped"] == []
    imported = owner.post(f"{upload}/import", json={"version": read["version"]})
    assert imported.status_code == 200, imported.text
    access = [c for c in imported.json()["controls"] if c["control_ref"] == "AC 1.01"]
    assert sorted(c["application_name"] for c in access) == ["Ledger One", "Workday"]
    with connect(migrated.url) as connection:
        rows = dict(
            connection.execute(
                "SELECT a.name, c.source_row FROM engagement_controls c "
                "JOIN engagement_applications a ON a.id = c.engagement_application_id "
                "WHERE c.project_id = %s AND c.control_ref = 'AC 1.01'",
                (team["project"],),
            ).fetchall()
        )
    # Each instance points at the row that named its system.
    assert rows == {"Ledger One": 2, "Workday": 4}
    audit = _audits(migrated, team["project"], "onboarding.rcm_imported")[-1]
    assert audit["merged_rows"] == {"AC 1.01": [2, 4, 5]}
    # A second sheet added to these replaces a control of the same ID on every system:
    # the preview names what it replaces.
    second = _upload(owner, base, RCM_HEAD + REPEATED_RCM.splitlines(keepends=True)[3])
    (replacing,) = [w for w in second["preview"]["warnings"] if w.startswith("If added")]
    assert "AC 1.01 (Ledger One and Workday)" in replacing
    added = owner.post(
        f"{base}/rcm/uploads/{second['id']}/import",
        json={"version": second["version"], "mode": "ADD"},
    )
    assert added.status_code == 200, added.text
    replaced = _audits(migrated, team["project"], "onboarding.rcm_imported")[-1]["replaced"]
    assert replaced == ["AC 1.01"]


def test_a_control_whose_systems_were_all_left_out_does_not_spread(migrated: Database) -> None:
    team = _new_engagement(migrated, "left-out")
    owner = _client(migrated, team["owner_id"], RecordingScheduler())
    base = _base(team["org"], team["project"])
    uploaded = _left_out_scan(migrated, owner, base)
    warnings = uploaded["preview"]["warnings"]
    (spread,) = [w for w in warnings if "for every in-scope system" in w]
    (no_system,) = [w for w in warnings if "left out or not identified" in w]
    assert "OP 3.01" in spread and "Ledger One" in spread and "OR 1.01" not in spread
    assert "OR 1.01" in no_system and "Treasury Box" in no_system and "OP 3.01" not in no_system
    assert "launch waits" in no_system
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    systems: dict[str, list[str]] = {}
    for control in body["controls"]:
        systems.setdefault(control["control_ref"], []).append(control["application_name"])
    assert systems["OP 3.01"] == ["Ledger One"]
    (treasury,) = [c for c in body["controls"] if c["control_ref"] == "OR 1.01"]
    assert treasury["application_id"] is None and treasury["included"] is True
    issues = [issue for item in body["readiness"] for issue in item["issues"]]
    assert "Choose the systems OR 1.01 covers." in issues
    # The preview and the import tell one story (invariant I16).
    audit = _audits(migrated, team["project"], "onboarding.rcm_imported")[-1]
    assert (audit["spread"], audit["no_system"]) == (["OP 3.01"], ["OR 1.01"])


def test_after_launch_a_control_with_no_system_gets_no_work(migrated: Database) -> None:
    team = _new_engagement(migrated, "left-out-launched")
    owner = _client(migrated, team["owner_id"], RecordingScheduler())
    base = _base(team["org"], team["project"])
    for name in ("Ledger One", "Old Ledger"):
        assert owner.post(f"{base}/applications", json={"name": name}).status_code == 200
    _ready_without_controls(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    assert owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint}).status_code == 200
    old = next(a for a in owner.get(base).json()["applications"] if a["name"] == "Old Ledger")
    removed = owner.post(f"{base}/applications/{old['id']}/remove", json={"reason": "Retired."})
    assert removed.status_code == 200, removed.text
    uploaded = _left_out_scan(migrated, owner, base)
    (no_system,) = [w for w in uploaded["preview"]["warnings"] if "left out or not identified" in w]
    assert "out of scope" in no_system
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    body = imported.json()
    (treasury,) = [c for c in body["controls"] if c["control_ref"] == "OR 1.01"]
    assert treasury["application_id"] is None and treasury["included"] is False
    # A blank cell covers the systems in scope, not one taken out of it.
    spread = [c["application_name"] for c in body["controls"] if c["control_ref"] == "OP 3.01"]
    assert spread == ["Ledger One"]
    access = next(c for c in body["controls"] if c["control_ref"] == "AC 1.01")
    with connect(migrated.url) as connection:
        work = {
            control_id: connection.execute(
                "SELECT (SELECT count(*) FROM tasks WHERE engagement_control_id = %s), "
                "(SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s)",
                (control_id, control_id),
            ).fetchone()
            for control_id in (treasury["id"], access["id"])
        }
    assert work[treasury["id"]] == (0, 0)
    given = work[access["id"]]
    assert given is not None and given[0] > 0


def test_a_control_naming_no_system_still_covers_every_in_scope_system(
    migrated: Database,
) -> None:
    """Milestone 8.5 kept: a blank systems cell is every in-scope system, and the preview
    now says so."""
    team = _new_engagement(migrated, "blank-cell")
    owner, base = team["owner"], _base(team["org"], team["project"])
    for name in ("Ledger One", "Workday"):
        assert owner.post(f"{base}/applications", json={"name": name}).status_code == 200
    uploaded = _upload(owner, base, LEFT_OUT_RCM)
    (spread,) = [w for w in uploaded["preview"]["warnings"] if "for every in-scope system" in w]
    # With no scan, the systems column names the systems: Treasury Box, which this import
    # adds, is in scope too, and the preview counts it before it exists.
    assert "OP 3.01" in spread and "(Ledger One, Workday and Treasury Box)" in spread
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    covered = sorted(
        c["application_name"] for c in imported.json()["controls"] if c["control_ref"] == "OP 3.01"
    )
    assert covered == ["Ledger One", "Treasury Box", "Workday"]


# Helpers


def _launched(database: Database, slug: str) -> tuple[dict[str, Any], Any, str]:
    team = _new_engagement(database, slug)
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    return team, owner, base


def _ready_without_controls(owner: Any, team: dict[str, Any]) -> None:
    """Setup complete with no controls: an engagement launches without them (25 October
    2026) and its controls are set up in Controls afterwards."""
    base = _base(team["org"], team["project"])
    owner.patch(f"{base}/scope", json={"scope": "ITGCs FY2027", "period_end": "2027-12-31"})
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    _choose_methodology(owner, base)
    state = owner.get(base).json()
    assert state["ready"] is True, state["readiness"]


def _audits(database: Database, project_id: UUID, action: str) -> list[dict[str, Any]]:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s AND action = %s "
            "ORDER BY created_at",
            (project_id, action),
        ).fetchall()
    return [row[0] for row in rows]


def _recommendation(database: Database, recommendation_id: Any) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT status FROM system_recommendations WHERE id = %s", (recommendation_id,)
        ).fetchone()
    assert row is not None
    return str(row[0])


def _system_row(owner: Any, base: str, system_id: str) -> dict[str, Any]:
    found: dict[str, Any] = next(
        a for a in owner.get(base).json()["applications"] if a["id"] == system_id
    )
    return found


def _system_of(owner: Any, base: str, system_id: str) -> dict[str, Any]:
    assessment: dict[str, Any] = _system_row(owner, base, system_id)["assessment"]
    return assessment


def _built(text: str) -> Any:
    _kind, sheets = parse_file("rcm.csv", text.encode())
    rows = sheets[0].rows
    fields = suggest_fields(headers(rows, 1))
    maps = {
        key: {value_key(item.value): item.suggested or "MANUAL" for item in items}
        for key, items in value_choices(rows, 1, fields).items()
    }
    return build(rows, 1, fields, maps)


def _left_out_scan(database: Database, owner: Any, base: str) -> dict[str, Any]:
    """LEFT_OUT_RCM uploaded and scanned, with Treasury Box left out."""
    uploaded = _upload(owner, base, LEFT_OUT_RCM)
    with connect(database.url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
    upload = f"{base}/rcm/uploads/{uploaded['id']}"
    systems = owner.get(upload).json()["systems"]
    assert {p["name"] for p in systems["proposals"]} == {"Ledger One", "Treasury Box"}
    choices = [
        {"key": p["key"], "name": p["name"], "layer": p["layer"],
         "included": p["name"] != "Treasury Box"}
        for p in systems["proposals"]
    ]  # fmt: skip
    saved = owner.patch(
        f"{upload}/systems", json={"systems_version": systems["version"], "choices": choices}
    )
    assert saved.status_code == 200, saved.text
    body: dict[str, Any] = saved.json()
    return body
