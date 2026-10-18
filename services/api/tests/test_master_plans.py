"""Master test plans (migration 0079, master_plans.py): every in-scope control's plan in
four sections, approved by a person as one stored version, with attributes approved with
it. Nothing downstream runs on a plan no person approved, or on one changed since. The
planner never approves its own plan and never changes an approved one."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_evidence_plans import _Planner
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _plan, _project, _rows

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.evidence_plans import GATE_PLAN, gate_reason, generate, load_facts
from ai_workforce_api.readiness import NotReady, assess, require_testable

__all__ = ["migrated"]


def _master(team: dict[str, Any], control: str, client: Any = None) -> dict[str, Any]:
    read = (client or team["owner"]).get(f"{_project(team)}/controls/{control}/master-plan")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _approve(team: dict[str, Any], control: str, comment: str = "") -> dict[str, Any]:
    plan = _plan(team, control)
    approved = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"], "comment": comment},
    )
    assert approved.status_code == 200, approved.text
    body: dict[str, Any] = approved.json()
    assert body["status"] == "APPROVED"
    return body


def test_every_control_is_planned_in_four_sections_and_in_the_queue(migrated: Database) -> None:
    team = _launched(migrated, "master-queue")
    controls = _rows(
        migrated,
        "SELECT count(*) FROM engagement_controls WHERE project_id = %s AND included",
        team["project"],
    )[0][0]
    queue = team["owner"].get(f"{_project(team)}/planning-review")
    assert queue.status_code == 200, queue.text
    body = queue.json()
    # No control is left out: the states add up to the controls in scope.
    assert body["total"] == controls == len(body["controls"])
    assert sum(body["counts"].values()) == controls
    assert body["counts"]["NOT_STARTED"] == 0 and body["counts"]["APPROVED"] == 0
    assert body["next_control_id"] is not None
    control = _control(team, "ITGC-AC-01")["id"]
    plan = _master(team, control)
    # The four sections, each item with its code.
    assert plan["control"]["description"] and plan["control"]["frequency"]
    assert plan["understanding"]["summary"]
    assert plan["procedures"] and all(p["code"][0] in "DIR" for p in plan["procedures"])
    assert plan["attributes"] and all(a["code"].startswith("A") for a in plan["attributes"])
    assert plan["evidence"] and all(e["code"].startswith("E") for e in plan["evidence"])
    # Requirements are linked to the attributes they name, by identity.
    assert any(e["attribute_codes"] for e in plan["evidence"])
    # Each operating phase has a procedure that tests the attributes (milestone B), so no
    # phase is reported as testing none.
    assert any(p["attribute_codes"] for p in plan["procedures"] if p["phase"] == "INTERIM")
    assert "PROCEDURE_WITHOUT_ATTRIBUTE" not in {f["kind"] for f in plan["findings"]}
    assert plan["state"] in ("DRAFT_READY", "NEEDS_CLARIFICATION")
    assert plan["viewer_can_decide"] is True and plan["content_hash"]


def test_approval_is_bound_to_a_stored_version_and_kept(migrated: Database) -> None:
    team = _launched(migrated, "master-approve")
    control = _control(team, "ITGC-AC-01")["id"]
    before = _master(team, control)
    stale = before["version"]
    approved = _approve(team, control, "Procedures and evidence agree with the RCM.")
    assert approved["approved_revision"] == approved["revision"] == before["revision"]
    rows = _rows(
        migrated,
        """
        SELECT d.decision, d.decided_by, d.revision, d.comment, d.content_hash,
               v.content_hash, v.content, d.decided_at IS NOT NULL
        FROM plan_decisions d JOIN plan_versions v ON v.id = d.plan_version_id
        JOIN evidence_plans p ON p.id = d.plan_id
        WHERE p.engagement_control_id = %s
        """,
        UUID(control),
    )
    assert len(rows) == 1
    decision, by, revision, comment, digest, stored, content, timed = rows[0]
    assert (decision, str(by), revision, timed) == ("APPROVED", str(team["owner_id"]),
                                                    before["revision"], True)  # fmt: skip
    assert comment == "Procedures and evidence agree with the RCM."
    # The decision binds the hash of the plan as the reviewer saw it.
    assert digest == stored == before["content_hash"]
    assert set(content) >= {"understanding", "procedures", "attributes", "evidence", "control"}
    history = _master(team, control)["decisions"]
    assert [(d["decision"], d["revision"]) for d in history] == [("APPROVED", before["revision"])]
    # Approving again records nothing new; nothing in the record can be changed.
    _approve(team, control)
    assert len(_master(team, control)["decisions"]) == 1
    with connect(migrated.url) as connection:
        for statement in (
            "UPDATE plan_decisions SET comment = 'changed'",
            "DELETE FROM plan_versions",
        ):
            with pytest.raises(psycopg.errors.RaiseException):
                connection.execute(statement)
            connection.rollback()
        # The database refuses an approved plan whose content moved on without review.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE evidence_plans SET revision = revision + 1 "
                "WHERE engagement_control_id = %s",
                (control,),
            )
        connection.rollback()
    # A stale tab cannot approve a later revision.
    other = _control(team, "ITGC-AC-02")["id"]
    team["owner"].post(
        f"{_project(team)}/controls/{other}/master-plan/procedures",
        json={"phase": "DESIGN", "text": "Inspect the approved access request workflow."},
    )
    late = team["owner"].post(
        f"{_project(team)}/controls/{other}/evidence-plan/approve", json={"version": stale}
    )
    assert late.status_code == 409 and late.json()["detail"] == "the plan changed"


def test_a_contributor_prepares_and_a_reviewer_decides(migrated: Database) -> None:
    team = _launched(migrated, "master-roles")
    control = _control(team, "ITGC-AC-01")["id"]
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "plan-preparer@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    preparer = _session(migrated, member)
    plan = _master(team, control, preparer)
    assert plan["viewer_can_decide"] is False
    path = f"{_project(team)}/controls/{control}/evidence-plan"
    refused = preparer.post(f"{path}/approve", json={"version": plan["version"]})
    assert refused.status_code == 403
    returned = preparer.post(
        f"{path}/request-changes",
        json={"version": plan["version"], "comment": "Add the termination procedure."},
    )
    assert returned.status_code == 403
    submitted = preparer.post(f"{path}/submit", json={"version": plan["version"], "note": ""})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["submitted"]["by"]
    if not submitted.json()["blockers"]:
        assert submitted.json()["state"] == "PENDING_REVIEW"
    assert _plan(team, control)["status"] == "PROPOSED"
    _approve(team, control)


def test_requesting_changes_withdraws_approval_until_a_revision_is_approved(
    migrated: Database,
) -> None:
    team = _launched(migrated, "master-changes")
    control = _control(team, "ITGC-AC-01")["id"]
    _approve(team, control)
    path = f"{_project(team)}/controls/{control}/evidence-plan"
    plan = _master(team, control)
    short = team["owner"].post(
        f"{path}/request-changes", json={"version": plan["version"], "comment": "No."}
    )
    assert short.status_code == 422
    returned = team["owner"].post(
        f"{path}/request-changes",
        json={"version": plan["version"], "comment": "Test the timeliness of provisioning."},
    )
    assert returned.status_code == 200, returned.text
    body = returned.json()
    assert body["state"] == "CHANGES_REQUESTED"
    assert body["decisions"][0]["decision"] == "CHANGES_REQUESTED"
    assert body["decisions"][0]["comment"] == "Test the timeliness of provisioning."
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") == GATE_PLAN
    assert _control(team, "ITGC-AC-01")["next_step"] == "Revise the test plan as the reviewer asked"
    # The preparer says what was done before it goes back for review.
    bare = team["owner"].post(f"{path}/submit", json={"version": body["version"], "note": ""})
    assert bare.status_code == 422
    revised = team["owner"].post(
        f"{path}/submit",
        json={"version": body["version"], "note": "Timeliness is covered by the I2 procedure."},
    )
    assert revised.status_code == 200, revised.text
    _approve(team, control)
    assert [d["decision"] for d in _master(team, control)["decisions"]] == [
        "APPROVED",
        "CHANGES_REQUESTED",
        "APPROVED",
    ]


def test_a_material_change_sends_an_approved_plan_back_for_review(migrated: Database) -> None:
    team = _launched(migrated, "master-revise")
    control = _control(team, "ITGC-AC-01")["id"]
    owner = team["owner"]
    base = f"{_project(team)}/controls/{control}"
    approved = _approve(team, control)
    requests = _rows(
        migrated,
        "SELECT id, version, plan_revision FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    )
    assert requests and {row[2] for row in requests} == {approved["revision"]}
    plan = _master(team, control)
    attribute = plan["attributes"][0]
    # A procedure linked to two attributes is one change: one revision.
    added = owner.post(
        f"{base}/master-plan/procedures",
        json={
            "phase": "INTERIM",
            "text": "Compare each sampled user's provisioned roles with the approved request.",
            "method": "COMPARISON",
            "attribute_ids": [a["id"] for a in plan["attributes"][:2]],
        },
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert body["state"] != "APPROVED" and body["revision"] == plan["revision"] + 1
    assert body["revised_since_approval"] is True
    new = next(p for p in body["procedures"] if p["method"] == "COMPARISON")
    assert new["code"].startswith("I") and len(new["attribute_codes"]) == min(
        2, len(plan["attributes"])
    )
    # Nothing downstream runs on it: requests are held, testing waits.
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") == GATE_PLAN
        readiness = assess(connection, team["project"], UUID(control))
        assert readiness is not None and readiness.state == "PLAN_NOT_APPROVED"
        with pytest.raises(NotReady):
            require_testable(connection, team["project"], UUID(control))
    held = owner.post(
        f"{_project(team)}/pbc-requests/{requests[0][0]}/approve",
        json={"version": requests[0][1]},
    )
    assert held.status_code == 409 and held.json()["detail"] == GATE_PLAN
    # The criteria of an attribute are part of the plan.
    _approve(team, control)
    criteria = owner.post(
        f"{base}/master-plan/attributes/{attribute['id']}/criteria",
        json={
            "version": attribute["version"],
            "condition": "The request was approved before access was granted.",
            "pass_criteria": "Approval date on or before the provisioning date.",
            "fail_criteria": "No approval, or approval after provisioning.",
            "judgment_required": False,
            "automatable": True,
        },
    )
    assert criteria.status_code == 200, criteria.text
    judged = next(a for a in criteria.json()["attributes"] if a["id"] == attribute["id"])
    assert judged["criteria_source"] == "PLAN" and judged["automatable"] is True
    assert criteria.json()["state"] != "APPROVED"
    # So is what the control is; who owns it is not.
    _approve(team, control)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET owner_email = 'new-owner@client.example' WHERE id = %s",
            (control,),
        )
        connection.commit()
    assert _plan(team, control)["status"] == "APPROVED"
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET activity = activity || ' Reviewed weekly.' "
            "WHERE id = %s",
            (control,),
        )
        connection.commit()
    assert _plan(team, control)["status"] == "PROPOSED"
    # Rewording an attribute keeps its code and its links.
    _approve(team, control)
    current = _master(team, control)
    linked = next(a for a in current["attributes"] if a["evidence_codes"])
    reworded = owner.patch(
        f"{base}/attributes/{linked['id']}",
        json={"text": linked["text"] + " (as documented)", "version": linked["version"]},
    )
    assert reworded.status_code == 200, reworded.text
    after = _master(team, control)
    kept = next(a for a in after["attributes"] if a["code"] == linked["code"])
    assert kept["id"] != linked["id"] and kept["evidence_codes"] == linked["evidence_codes"]
    assert after["state"] != "APPROVED"


def test_testing_waits_for_an_approved_plan(migrated: Database) -> None:
    team = _launched(migrated, "master-testing")
    control = _control(team, "ITGC-AC-01")["id"]
    with connect(migrated.url) as connection:
        readiness = assess(connection, team["project"], UUID(control))
        assert readiness is not None
        check = next(c for c in readiness.checks if c.key == "plan")
        assert check.status == "BLOCKED"
        row = connection.execute(
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by
            )
            SELECT organization_id, project_id, id, 'TEST_OF_ONE', test_attributes, %s
            FROM engagement_controls WHERE id = %s
            RETURNING id, version, plan_revision
            """,
            (team["owner_id"], control),
        ).fetchone()
        connection.commit()
    assert row is not None and row[2] is None
    signed = team["owner"].post(
        f"{_project(team)}/test-sheets/{row[0]}/sign-off", json={"version": row[1]}
    )
    assert signed.status_code == 409 and signed.json()["detail"] == GATE_PLAN
    approved = _approve(team, control)
    with connect(migrated.url) as connection:
        readiness = assess(connection, team["project"], UUID(control))
        assert readiness is not None
        assert next(c for c in readiness.checks if c.key == "plan").status == "OK"
        # A sheet opened now records the approved revision it was opened under (tried in
        # place of the first one, and rolled back).
        connection.execute("DELETE FROM test_sheets WHERE id = %s", (row[0],))
        later = connection.execute(
            """
            INSERT INTO test_sheets (
                organization_id, project_id, engagement_control_id, method, attributes,
                requested_by
            )
            SELECT organization_id, project_id, id, 'TEST_OF_ONE', test_attributes, %s
            FROM engagement_controls WHERE id = %s
            RETURNING plan_revision
            """,
            (team["owner_id"], control),
        ).fetchone()
        connection.rollback()
    assert later is not None and later[0] == approved["approved_revision"]


def test_the_planner_never_extends_an_approved_plan(migrated: Database) -> None:
    team = _launched(migrated, "master-agent")
    control = _control(team, "ITGC-AC-01")["id"]
    _approve(team, control)
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(control))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        design = next(p for p in output["phases"] if p["phase"] == "DESIGN")
        extra = dict(design["requirements"][0])
        extra.update(
            key="design-access-matrix",
            title="Access approval matrix",
            description="The current matrix of who may approve access to SAP ERP.",
        )
        design["requirements"].append(extra)
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
    proposed = _rows(
        migrated,
        "SELECT id, version, status, pending_change, pbc_request_id FROM evidence_requirements "
        "WHERE engagement_control_id = %s AND requirement_key = 'design-access-matrix'",
        UUID(control),
    )
    assert len(proposed) == 1
    requirement_id, version, status, change, request = proposed[0]
    # Proposed to the reviewer, not requested, not part of the approved plan.
    assert change == {"add": True} and request is None and status == "PLANNED"
    plan = _master(team, control)
    assert plan["state"] == "APPROVED" and plan["status"] == "CHANGES_PROPOSED"
    assert all(e["id"] != str(requirement_id) for e in plan["evidence"])
    assert any(b["kind"] == "DECISION" and b["blocks"] for b in plan["blockers"])
    accepted = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-requirements/{requirement_id}/change",
        json={"decision": "ACCEPT", "version": version},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "PROPOSED"
    plan = _master(team, control)
    assert any(e["id"] == str(requirement_id) for e in plan["evidence"])
    if plan["pending_revision"] is not None:
        team["owner"].post(
            f"{_project(team)}/controls/{control}/evidence-plan/pending-revision",
            json={"decision": "DISMISS", "version": plan["version"]},
        )
    _approve(team, control)
    assert _rows(
        migrated,
        "SELECT pbc_request_id IS NOT NULL FROM evidence_requirements WHERE id = %s",
        requirement_id,
    ) == [(True,)]


def test_links_name_only_the_controls_own_records(migrated: Database) -> None:
    team = _launched(migrated, "master-links")
    control = _control(team, "ITGC-AC-01")["id"]
    other = _control(team, "ITGC-AC-02")["id"]
    plan = _master(team, control)
    foreign = _master(team, other)["attributes"][0]["id"]
    procedure = plan["procedures"][0]
    base = f"{_project(team)}/controls/{control}/master-plan"
    refused = team["owner"].put(
        f"{base}/procedures/{procedure['id']}/attributes", json={"attribute_ids": [foreign]}
    )
    assert refused.status_code == 409
    linked = team["owner"].put(
        f"{base}/procedures/{procedure['id']}/attributes",
        json={"attribute_ids": [plan["attributes"][0]["id"]]},
    )
    assert linked.status_code == 200, linked.text
    after = linked.json()
    assert not any(
        f["kind"] == "PROCEDURE_WITHOUT_ATTRIBUTE" and f["code"] == procedure["code"]
        for f in after["findings"]
    )
    evidence = after["evidence"][0]
    relinked = team["owner"].put(
        f"{base}/evidence/{evidence['id']}/links",
        json={"attribute_ids": [plan["attributes"][0]["id"]], "procedure_ids": [procedure["id"]]},
    )
    assert relinked.status_code == 200, relinked.text
    item = next(e for e in relinked.json()["evidence"] if e["id"] == evidence["id"])
    assert item["procedure_codes"] == [procedure["code"]]
    assert item["attribute_codes"] == [plan["attributes"][0]["code"]]
    credential = team["owner"].post(
        f"{base}/procedures",
        json={"phase": "DESIGN", "text": "Log in with password: hunter2 and inspect the screen."},
    )
    assert credential.status_code == 422


def test_a_reviewer_approves_the_plans_they_select_one_by_one(migrated: Database) -> None:
    team = _launched(migrated, "master-batch")
    queue = team["owner"].get(f"{_project(team)}/planning-review").json()
    assert queue["viewer_can_decide"] is True
    ready = [row for row in queue["controls"] if row["approvable"]]
    assert len(ready) >= 3
    held = [row for row in queue["controls"] if not row["approvable"]]
    assert all(row["held_by"] for row in held if row["state"] != "APPROVED")
    first, second, stale = ready[0], ready[1], ready[2]
    path = f"{_project(team)}/planning-review/approve"
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "plan-batch@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    refused = _session(migrated, member).post(
        path, json={"items": [{"control_id": first["control_id"], "version": first["version"]}]}
    )
    assert refused.status_code == 403
    # The third changed after the queue was read: it is refused, the others approved.
    team["owner"].post(
        f"{_project(team)}/controls/{stale['control_id']}/master-plan/procedures",
        json={"phase": "DESIGN", "text": "Inspect the approval workflow configuration."},
    )
    result = team["owner"].post(
        path,
        json={
            "comment": "Reviewed each plan.",
            "items": [
                {"control_id": row["control_id"], "version": row["version"]}
                for row in (first, second, stale)
            ],
        },
    )
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["approved"] == 2
    outcome = {item["control_id"]: item for item in body["outcomes"]}
    assert outcome[stale["control_id"]]["approved"] is False
    assert outcome[stale["control_id"]]["detail"] == "the plan changed"
    # Each approval is its own decision, on its own stored version, with the comment.
    decisions = _rows(
        migrated,
        "SELECT p.engagement_control_id, d.comment FROM plan_decisions d "
        "JOIN evidence_plans p ON p.id = d.plan_id WHERE d.project_id = %s",
        team["project"],
    )
    assert sorted(str(row[0]) for row in decisions) == sorted(
        [first["control_id"], second["control_id"]]
    )
    assert {row[1] for row in decisions} == {"Reviewed each plan."}
    after = team["owner"].get(f"{_project(team)}/planning-review").json()
    assert after["counts"]["APPROVED"] == 2
