"""Engagement integrity (Milestone 8.13): one system or control ID however it is cased, a
launch that happens once, and a tested control that does not change silently.

Scope integrity part A (owner decisions, 19 November 2026): every route that takes a
control out of scope asks the same reason, leaving a control out where a SOC report may be
relied on needs a person's reason, and an RCM's repeated control IDs and left-out systems
are imported as the file says, or held until the file is reconciled."""

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
    _complete_setup,
    _control_fields,
    _new_engagement,
)
from test_outbound import migrated
from test_projects import _edit
from test_system_applicability import REPORT, _wand
from test_system_applicability import _setup as _wizard_setup

from ai_workforce_api.db import connect

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


# Helpers


def _launched(database: Database, slug: str) -> tuple[dict[str, Any], Any, str]:
    team = _new_engagement(database, slug)
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    return team, owner, base


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
