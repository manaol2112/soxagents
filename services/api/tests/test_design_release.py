"""D&I evidence with its own release (B1; decided by the product owner on 8 November 2026,
docs/control-workflow-plan.md). The Design phase's evidence is requested once a person
releases it for the control, after Control Understanding, and not with the test plan's
approval. The test plan's approval gates only the operating phases, so revising the plan does
not hold D&I requests. Each request still needs its own approval to be sent; a release sends
nothing, and the agents never release a phase."""

from typing import Any
from uuid import UUID

from support import Database, approve_evidence_plans, settle_attributes
from test_evidence_plans import _Planner
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _plan, _project, _rows

from ai_workforce_api.control_design import ValuesBody, design_for, set_values
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.evidence_plans import (
    GATE_DESIGN_RELEASE,
    GATE_PLAN,
    gate_reason,
    generate,
    held_for_planning,
    load_facts,
    unrequested_controls,
)

__all__ = ["migrated"]

REASON = "The walkthrough is booked for this week, before the open question is answered."


def _design(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/phase-progress")
    assert read.status_code == 200, read.text
    row = next(item for item in read.json()["controls"] if item["control_id"] == control)
    found: dict[str, Any] = next(item for item in row["phases"] if item["phase"] == "DESIGN")
    return found


def _requests(migrated: Database, control: str, phase: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, status FROM pbc_requests WHERE engagement_control_id = %s "
        "AND testing_phase = %s AND status <> 'CANCELLED'",
        UUID(control),
        phase,
    )


def test_d_and_i_evidence_is_released_on_its_own_once_the_control_is_understood(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-release")
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    path = f"{_project(team)}/controls/{control}/phases/DESIGN/release"
    # Planned, not released: nothing of D&I is requested, and the plan is not approved.
    assert _plan(team, control)["status"] == "PROPOSED"
    assert _requests(migrated, control, "DESIGN") == []
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") == GATE_DESIGN_RELEASE
        assert gate_reason(connection, UUID(control), "INTERIM") == GATE_PLAN
    # An open question on the control: Control Understanding is not complete, so the
    # release is not recommended, and releasing it now needs the reason.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, resolve, fingerprint, raised_by
            )
            SELECT organization_id, project_id, id, 'PROCESS', 'MISSING', 'Walkthrough',
                   'Who approves an emergency change out of hours?',
                   'The design is assessed against who approves.', 'Answer it.',
                   'di-release-question', 'RULES'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING" and waiting["step_label"] == "Waiting for understanding"
    assert waiting["waiting_for"].startswith("Control Understanding is not complete")
    bare = owner.post(path, json={})
    assert bare.status_code == 409
    assert "Say why the D&I phase is released now" in bare.json()["detail"]
    # Only an Owner, Admin or Project Manager releases it.
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "di-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    assert _session(migrated, member).post(path, json={"reason": REASON}).status_code == 403
    sent = _rows(
        migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
    )
    released = owner.post(path, json={"reason": REASON})
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert status["step"] == "RELEASED" and status["early"] is True
    assert status["reason"] == REASON and status["released_by"]
    # The D&I items are requested now, on a plan still not approved; nothing is sent, and the
    # operating evidence still waits for the plan.
    assert _plan(team, control)["status"] == "PROPOSED"
    design = _requests(migrated, control, "DESIGN")
    assert design and all(row[1] == "DRAFT" for row in design)
    assert _requests(migrated, control, "INTERIM") == []
    assert (
        _rows(
            migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
        )
        == sent
    )
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") is None
        assert held_for_planning(connection, UUID(str(design[0][0]))) is None
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'phase.released'",
        UUID(control),
    )
    assert [row[0]["phase"] for row in audit] == ["DESIGN"] and audit[0][0]["early"] is True
    # Releasing again changes nothing and asks for nothing twice.
    again = owner.post(path, json={"reason": REASON})
    assert again.status_code == 200
    assert len(_requests(migrated, control, "DESIGN")) == len(design)
    assert _rows(
        migrated,
        "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s AND phase = 'DESIGN'",
        UUID(control),
    ) == [(1,)]


def test_a_understood_control_is_recommended_for_release_without_a_reason(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-ready")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', "
            "resolution_note = 'Answered in the walkthrough.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND status = 'OPEN'",
            (control,),
        )
        connection.commit()
    # Unanswered client values hold it: each question Control Understanding asks counts,
    # not only those testing waits for (as the workflow's step reads it).
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING"
    assert waiting["waiting_for"].endswith("not answered.")
    with connect(migrated.url) as connection:
        design_body = design_for(connection, UUID(control))
        assert design_body is not None
        values = {
            slot.key: slot.options[0] if slot.options else "The IT security manager"
            for slot in design_body.slots
            if not slot.automatic and not slot.document and not slot.value.strip()
        }
        set_values(
            connection, team["org"], team["project"], UUID(control), team["owner_id"],
            ValuesBody(values=values),
        )  # fmt: skip
    design = _design(team, control)
    assert design["step"] == "READY", design
    progress = team["owner"].get(f"{_project(team)}/phase-progress").json()
    assert progress["ready"]["DESIGN"] >= 1
    assert progress["recommendation"].endswith("The D&I evidence is ready to release.")
    row = _control(team, "ITGC-AC-01")
    assert row["next_step"] == "Release the D&I evidence"
    released = team["owner"].post(
        f"{_project(team)}/controls/{control}/phases/DESIGN/release", json={}
    )
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert status["step"] == "RELEASED" and status["early"] is False


def test_revising_the_test_plan_does_not_hold_d_and_i_requests(migrated: Database) -> None:
    team = _launched(migrated, "di-revise")
    approve_evidence_plans(migrated, team["project"], release=False)
    control = _control(team, "ITGC-AC-01")["id"]
    design = _requests(migrated, control, "DESIGN")
    assert design
    # A revision of the plan (an operating phase's change, say) puts it back to proposed.
    with connect(migrated.url) as connection:
        connection.execute(
            "SELECT revise_evidence_plan(id) FROM evidence_plans WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    assert _plan(team, control)["status"] == "PROPOSED"
    with connect(migrated.url) as connection:
        # Rewritten from the planning gate's first rule (milestone 8.x): a revision used to
        # hold every phase; it now holds only the operating phases.
        assert gate_reason(connection, UUID(control), "DESIGN") is None
        assert gate_reason(connection, UUID(control), "INTERIM") == GATE_PLAN
        for request_id, _status in design:
            assert held_for_planning(connection, UUID(str(request_id))) is None
    listed = team["owner"].get(f"{_project(team)}/evidence-requests", params={"size": 200}).json()
    for request_id, _status in design:
        row = next(item for item in listed["rows"] if item["id"] == str(request_id))
        assert row["held"] is False, row


def test_the_planner_proposes_what_it_adds_to_released_d_and_i_evidence(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-planner")
    control = _control(team, "ITGC-AC-01")["id"]
    released = team["owner"].post(
        f"{_project(team)}/controls/{control}/phases/DESIGN/release", json={"reason": REASON}
    )
    assert released.status_code == 200, released.text
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(control))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        phase = next(p for p in output["phases"] if p["phase"] == "DESIGN")
        extra = dict(phase["requirements"][0])
        extra.update(
            key="design-change-9",
            title="Access approval matrix",
            description="The current matrix of who may approve access to SAP ERP.",
        )
        phase["requirements"].append(extra)
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
    proposed = _rows(
        migrated,
        "SELECT id, version, status, pending_change, pbc_request_id FROM evidence_requirements "
        "WHERE engagement_control_id = %s AND requirement_key = 'design-change-9'",
        UUID(control),
    )
    assert len(proposed) == 1
    requirement_id, version, status, change, request = proposed[0]
    # The plan is not approved, but the D&I evidence a person released is not extended by
    # the agent: the addition is proposed to a person, and nothing is requested for it.
    assert change == {"add": True} and request is None and status == "PLANNED"
    # Not part of the plan until accepted, so the control is not listed as having evidence
    # never requested (bug hunt, 9 November 2026: before, it was, for good).
    with connect(migrated.url) as connection:
        assert UUID(control) not in unrequested_controls(connection, project)
    accepted = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-requirements/{requirement_id}/change",
        json={"decision": "ACCEPT", "version": version},
    )
    assert accepted.status_code == 200, accepted.text
    # Accepted by a person: requested under the D&I release, with no plan approval.
    assert _rows(
        migrated,
        "SELECT pbc_request_id IS NOT NULL FROM evidence_requirements WHERE id = %s",
        requirement_id,
    ) == [(True,)]
