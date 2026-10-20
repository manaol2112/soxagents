"""The planning gate (decided by the product owner): no evidence is requested until a
person approves the control's evidence plan. The plan waits either way, with a model or
without. Design evidence follows that approval; operating evidence also waits for the
control's attributes to be settled. The planner agent refines each launched control's
plan in the background and still leaves it proposed. Requests drafted before the gate
are held, not deleted."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_plans import (
    GATE_PLAN,
    attention_of,
    fail_plan_run,
    gate_reason,
    open_plan_runs,
    run_plan,
    settle_automatically,
    unrequested_controls,
)
from ai_workforce_api.onboarding import PlanApproval, launch_engagement

__all__ = ["migrated"]


def _project(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _launched(migrated: Database, slug: str, agent: bool = False) -> dict[str, Any]:
    team = _new_engagement(migrated, slug)
    owner = team["owner"]
    _complete_setup(owner, team)
    preview = owner.get(_base(team["org"], team["project"])).json()["plan_preview"]
    with connect(migrated.url) as connection:
        launch_engagement(
            connection,
            Principal(PrincipalKind.USER, team["owner_id"]),
            team["org"],
            team["project"],
            PlanApproval(fingerprint=preview["fingerprint"]),
            agent,
        )
    return team


def _finish_runs(migrated: Database, team: dict[str, Any]) -> None:
    """The planner agent's background runs finish with no model: the rules' plans stand."""
    with connect(migrated.url) as connection:
        for plan_id in open_plan_runs(connection, team["project"]):
            assert run_plan(connection, None, plan_id) == "DONE"


def _rows(migrated: Database, query: str, *params: Any) -> list[tuple[Any, ...]]:
    with connect(migrated.url) as connection:
        return list(connection.execute(query, params).fetchall())


def _control(team: dict[str, Any], ref: str) -> dict[str, Any]:
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    found: dict[str, Any] = next(row for row in rows if row["control_ref"] == ref)
    return found


def _plan(team: dict[str, Any], control_id: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/controls/{control_id}/evidence-plan")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def test_a_plan_waits_for_a_person_at_launch(migrated: Database) -> None:
    team = _launched(migrated, "gate-launch")
    owner = team["owner"]
    plans = _rows(
        migrated,
        "SELECT status, source, run_status, approved_by, approved_at IS NOT NULL "
        "FROM evidence_plans WHERE project_id = %s",
        team["project"],
    )
    # No model is set: the rules' plan stands, and still waits for a person.
    assert plans and {row[0] for row in plans} == {"PROPOSED"}
    assert {row[1] for row in plans} == {"RULES"} and {row[2] for row in plans} == {"IDLE"}
    assert {row[3] for row in plans} == {None} and {row[4] for row in plans} == {False}
    assert _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE project_id = %s", team["project"]
    ) == [(0,)]
    assert _rows(
        migrated,
        "SELECT count(*) FROM audit_events WHERE project_id = %s "
        "AND action = 'evidence_plan.approved_automatically'",
        team["project"],
    ) == [(0,)]
    row = _control(team, "ITGC-AC-01")
    assert row["evidence_plan"] == "PROPOSED"
    assert row["next_step"] == "Approve the test plan"
    body = _plan(team, row["id"])
    assert body["approved_automatically"] is False and body["attention"] == []
    # Approving it releases the design evidence. Every request still waits for an
    # approver before it is sent.
    approved = owner.post(
        f"{_project(team)}/controls/{row['id']}/evidence-plan/approve",
        json={"version": body["version"]},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approved_by"]
    design = _rows(
        migrated,
        "SELECT count(*), count(*) FILTER (WHERE status NOT IN ('DRAFT', 'APPROVAL_PENDING')) "
        "FROM pbc_requests WHERE engagement_control_id = %s AND testing_phase = 'DESIGN'",
        UUID(row["id"]),
    )[0]
    assert design == (1, 0)
    # The other controls still wait, so nothing of theirs is requested.
    with connect(migrated.url) as connection:
        assert unrequested_controls(connection, team["project"]) == []


def test_a_plan_that_needs_judgment_waits_for_a_person(migrated: Database) -> None:
    team = _launched(migrated, "gate-judgment")
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    plan_id = _rows(
        migrated, "SELECT id FROM evidence_plans WHERE engagement_control_id = %s",
        UUID(control),
    )[0][0]  # fmt: skip
    # A plan cannot take effect with no approver: the database refuses it (migration 0079;
    # plans approved that way before were sent back for review).
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE evidence_plans SET status = 'APPROVED', approved_by = NULL, "
                "approved_at = clock_timestamp() WHERE id = %s",
                (plan_id,),
            )
        connection.rollback()
    # The planner leaves a question open. The plan was already waiting; the question
    # does not approve it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plan_phases SET open_question = 'Is the control run "
            "monthly or quarterly?' WHERE plan_id = %s AND phase = 'INTERIM'",
            (plan_id,),
        )
        connection.commit()
        with transaction(connection) as cursor:
            assert settle_automatically(cursor, team["org"], team["project"], plan_id) is False
        assert gate_reason(connection, UUID(control), "DESIGN") == GATE_PLAN
        assert attention_of(connection, plan_id) == [
            "Interim operating effectiveness: Is the control run monthly or quarterly?"
        ]
    body = _plan(team, control)
    assert body["status"] == "PROPOSED" and body["approved_automatically"] is False
    assert body["attention"] == [
        "Interim operating effectiveness: Is the control run monthly or quarterly?"
    ]
    assert _control(team, "ITGC-AC-01")["next_step"] == "Approve the test plan"
    # A person approves it; the question no longer moves it.
    approved = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": body["version"]},
    )
    assert approved.status_code == 200, approved.text
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            assert settle_automatically(cursor, team["org"], team["project"], plan_id) is True
    after = _rows(
        migrated, "SELECT status, approved_by FROM evidence_plans WHERE id = %s", plan_id
    )[0]
    assert after == ("APPROVED", team["owner_id"])
    # Answering the question does not approve the plan. The person's approval stands.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plan_phases SET open_question = '' WHERE plan_id = %s", (plan_id,)
        )
        connection.commit()
        assert attention_of(connection, plan_id) == []


def test_approving_the_plan_releases_design_then_operating_evidence(
    migrated: Database,
) -> None:
    # With the planner agent coming, the plans wait for its run: nothing is requested.
    team = _launched(migrated, "gate-approve", agent=True)
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    # One attribute waits for a decision: the attributes are not settled.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                source_kind, proposal
            )
            SELECT organization_id, project_id, id, 99, 'Approval is evidenced before access',
                   'PROPOSED', 'AGENT', 'ADD'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()
    # The planner agent's run finishes (no model here: the rules' plan stands). While it
    # runs, the plan cannot be approved.
    plan = _plan(team, control)
    early = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert early.status_code == 409
    assert early.json()["detail"] == "The planner is still drafting the plan."
    _finish_runs(migrated, team)
    # Approving the plan approves its attributes with it (decided by the product owner):
    # it is refused while one waits for a decision, and nothing is requested.
    plan = _plan(team, control)
    refused = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "1 proposed attribute waits for a decision."
    assert _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]  # fmt: skip
    row = _control(team, "ITGC-AC-01")
    assert row["attributes_settled"] is False
    # Deciding the attribute revises the plan; approving it then requests the design and
    # the operating evidence together.
    attribute = _rows(
        migrated,
        "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'PROPOSED'",
        UUID(control),
    )[0]
    decided = owner.post(
        f"{_project(team)}/controls/{control}/attributes/{attribute[0]}/decide",
        json={"decision": "APPROVE", "version": attribute[1]},
    )
    assert decided.status_code == 200, decided.text
    assert _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]  # fmt: skip
    plan = _plan(team, control)
    assert plan["revision"] > 1
    approved = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert approved.status_code == 200, approved.text
    phases = _rows(
        migrated,
        "SELECT DISTINCT testing_phase FROM pbc_requests WHERE engagement_control_id = %s "
        "ORDER BY 1",
        UUID(control),
    )
    assert phases == [("DESIGN",), ("INTERIM",)], phases
    # Approving again changes nothing: what was requested is not asked twice.
    count = _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    )  # fmt: skip
    with connect(migrated.url) as connection:
        from ai_workforce_api.evidence_plans import release

        assert release(connection, team["org"], team["project"], UUID(control),
                       team["owner_id"]) == []  # fmt: skip
    assert _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == count  # fmt: skip


def test_a_draft_made_before_the_plan_was_approved_is_held(migrated: Database) -> None:
    team = _launched(migrated, "gate-held", agent=True)
    _finish_runs(migrated, team)
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    plan = _plan(team, control)
    approved = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert approved.status_code == 200, approved.text
    # The plan goes back to proposed (as for drafts made before this rule existed).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET status = 'PROPOSED', approved_by = NULL, "
            "approved_at = NULL WHERE engagement_control_id = %s",
            (control,),
        )
        connection.execute(
            "UPDATE pbc_requests SET recipient = 'iam@client.example' "
            "WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    request = _rows(
        migrated,
        "SELECT id, version FROM pbc_requests WHERE engagement_control_id = %s LIMIT 1",
        UUID(control),
    )[0]
    path = f"{_project(team)}/pbc-requests/{request[0]}"
    refused = owner.post(f"{path}/approve", json={"version": request[1]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "approve the test plan first"
    details = owner.get(f"{path}/details").json()
    planning = next(item for item in details["checks"] if item["key"] == "planning")
    assert planning["detail"] == "Approve the control's test plan first."
    listed = owner.get(f"{_project(team)}/evidence-requests", params={"size": 200}).json()
    row = next(item for item in listed["rows"] if item["id"] == str(request[0]))
    assert row["held"] is True and row["held_reason"] == "Awaiting plan approval"
    assert row["stage"] == "DRAFT"
    bulk = owner.post(
        f"{_project(team)}/evidence-requests/bulk",
        json={"action": "APPROVE", "items": [{"id": str(request[0]), "version": request[1]}]},
    ).json()
    assert bulk["outcomes"][0]["detail"] == "Approve the control's test plan first."
    # Nothing was deleted: approving the plan releases it.
    plan = _plan(team, control)
    owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    released = owner.post(f"{path}/approve", json={"version": request[1]})
    assert released.status_code == 200, released.text


def test_the_planner_agent_refines_the_plan_in_the_background(migrated: Database) -> None:
    team = _launched(migrated, "gate-agent", agent=True)
    runs = _rows(
        migrated,
        "SELECT id, run_status FROM evidence_plans WHERE project_id = %s",
        team["project"],
    )
    assert runs and {row[1] for row in runs} == {"PENDING"}
    # While the agent works, the plans wait and nothing is requested.
    assert _rows(
        migrated, "SELECT DISTINCT status FROM evidence_plans WHERE project_id = %s",
        team["project"],
    ) == [("PROPOSED",)]  # fmt: skip
    assert _rows(
        migrated, "SELECT count(*) FROM pbc_requests WHERE project_id = %s", team["project"]
    ) == [(0,)]
    with connect(migrated.url) as connection:
        waiting = open_plan_runs(connection, team["project"])
        assert {str(item) for item in waiting} == {str(row[0]) for row in runs}
        # With no model the run keeps the rules' plan, still waiting for a person.
        assert run_plan(connection, None, UUID(str(runs[0][0]))) == "DONE"
        assert run_plan(connection, None, UUID(str(runs[0][0]))) == "SKIPPED"
        # A failed run leaves the rules' plan the same way.
        fail_plan_run(connection, UUID(str(runs[1][0])))
    after = dict(
        _rows(
            migrated,
            "SELECT id, run_status FROM evidence_plans WHERE id IN (%s, %s)",
            runs[0][0],
            runs[1][0],
        )
    )
    assert after[runs[0][0]] == "IDLE" and after[runs[1][0]] == "FAILED"
    settled = _rows(
        migrated,
        "SELECT status FROM evidence_plans WHERE id IN (%s, %s)",
        runs[0][0],
        runs[1][0],
    )
    assert {row[0] for row in settled} == {"PROPOSED"}
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests r JOIN evidence_plans p "
        "ON p.engagement_control_id = r.engagement_control_id WHERE p.id IN (%s, %s)",
        runs[0][0],
        runs[1][0],
    ) == [(0,)]
    # Every plan still waits for a person. The ones the agent has not run stay queued.
    assert _rows(
        migrated,
        "SELECT count(*) FROM evidence_plans WHERE project_id = %s AND status = 'PROPOSED'",
        team["project"],
    ) == [(len(runs),)]


def test_the_launch_summary_counts_where_the_work_stands(migrated: Database) -> None:
    team = _launched(migrated, "gate-summary", agent=True)
    owner = team["owner"]
    base = _base(team["org"], team["project"])
    before = owner.get(base).json()["launch"]
    assert before["launched_by"] and before["launched_at"]
    controls = before["controls"]
    assert controls > 0
    # Every control is planned and waits for the planner agent; nothing is requested yet.
    assert before["plans_proposed"] == controls and before["plans_approved"] == 0
    assert before["plans_missing"] == 0 and before["plans_working"] == controls
    assert before["requests_draft"] == before["requests_awaiting_approval"] == 0
    assert before["tasks_total"] > 0 and before["tasks_done"] == 0
    # A plan is approved once the planner agent has drafted it.
    _finish_runs(migrated, team)
    control = _control(team, "ITGC-AC-01")["id"]
    plan = _plan(team, control)
    approved = owner.post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert approved.status_code == 200, approved.text
    after = owner.get(base).json()["launch"]
    assert after["plans_approved"] == 1 and after["plans_proposed"] == controls - 1
    released = after["requests_draft"] + after["requests_awaiting_approval"]
    assert released > 0 and after["requests_held"] == 0
    # A request whose plan goes back to proposed is held, not waiting for review.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET status = 'PROPOSED', approved_by = NULL, "
            "approved_at = NULL WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    held = owner.get(base).json()["launch"]
    assert held["requests_held"] == released
    assert held["requests_draft"] == held["requests_awaiting_approval"] == 0


def test_an_engagement_not_launched_has_no_launch_summary(migrated: Database) -> None:
    team = _new_engagement(migrated, "gate-unlaunched")
    assert team["owner"].get(_base(team["org"], team["project"])).json()["launch"] is None
