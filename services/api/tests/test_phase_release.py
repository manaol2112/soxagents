"""Phase-based release (master test plans, milestone E): every phase's requests are
prepared in advance and released progressively. Interim is released once design and
implementation testing is complete, the roll-forward once interim testing is (or, where
interim does not apply, once design is). A reviewer may release a phase earlier for one
control, with the reason recorded. A release never sends anything, and the agents never
release a phase."""

from typing import Any
from uuid import UUID

from support import Database, approve_evidence_plans
from test_evidence_flow import _drafted, _project
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated
from test_planning_gate import _rows

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _launched(migrated: Database, slug: str) -> dict[str, Any]:
    team = _new_engagement(migrated, slug)
    owner = team["owner"]
    _complete_setup(owner, team)
    base = _base(team["org"], team["project"])
    preview = owner.get(base).json()["plan_preview"]
    started = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert started.status_code == 200, started.text
    # Plans approved; no phase released.
    approve_evidence_plans(migrated, team["project"], release=False)
    _drafted(migrated, team)
    return team


def _progress(team: dict[str, Any]) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/phase-progress")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _phase(body: dict[str, Any], control: str, phase: str) -> dict[str, Any]:
    row = next(item for item in body["controls"] if item["control_id"] == control)
    found: dict[str, Any] = next(item for item in row["phases"] if item["phase"] == phase)
    return found


def _control_with(team: dict[str, Any], phase: str) -> tuple[str, dict[str, Any]]:
    """An access control with a draft request for the phase."""
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    for row in rows:
        if row["included"] and row["control_ref"].startswith("ITGC-AC"):
            for request in row["requests"]:
                if request["status"] == "DRAFT" and request.get("phase") == phase:
                    return row["id"], request
    raise AssertionError(f"no {phase} draft")


def _prepare_design(migrated: Database, team: dict[str, Any], control: str) -> None:
    """The design and implementation workpaper is prepared by a person."""
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO workpapers (
                organization_id, project_id, engagement_control_id, stage, template_key,
                status, current_version, requested_by, prepared_by, prepared_at,
                prepared_version
            )
            VALUES (%s, %s, %s, 'DESIGN', 'itgc', 'PREPARED', 1, %s, %s, clock_timestamp(), 1)
            """,
            (team["org"], team["project"], control, team["owner_id"], team["owner_id"]),
        )
        connection.commit()


def test_interim_requests_wait_for_the_phase_to_be_released(migrated: Database) -> None:
    team = _launched(migrated, "release-hold")
    owner = team["owner"]
    control, interim = _control_with(team, "INTERIM")
    _, design = _control_with(team, "DESIGN")
    # Prepared in advance, held until the interim phase is released.
    details = owner.get(f"{_project(team)}/pbc-requests/{interim['id']}/details").json()
    planning = next(item for item in details["checks"] if item["key"] == "planning")
    assert "Release the interim phase" in planning["detail"]
    refused = owner.post(
        f"{_project(team)}/pbc-requests/{interim['id']}/approve",
        json={"version": interim["version"]},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "release the interim phase first"
    listed = owner.get(f"{_project(team)}/evidence-requests", params={"size": 200}).json()
    row = next(item for item in listed["rows"] if item["id"] == interim["id"])
    assert row["held"] is True and row["held_reason"] == "Awaiting phase release"
    # Design follows the plan's approval: it is not held.
    design_row = next(item for item in listed["rows"] if item["id"] == design["id"])
    assert design_row["held_reason"] != "Awaiting phase release"
    # Design testing is not complete: interim waits, and nothing is recommended yet.
    body = _progress(team)
    status = _phase(body, control, "INTERIM")
    assert status["step"] == "WAITING"
    assert status["waiting_for"] == "Design and implementation testing is not complete."
    assert _phase(body, control, "DESIGN")["step"] == "RELEASED"
    assert body["ready"]["INTERIM"] == 0 and body["recommendation"] == ""
    assert body["viewer_can_release"] is True


def test_design_completion_recommends_interim_and_a_person_releases_it(
    migrated: Database,
) -> None:
    team = _launched(migrated, "release-ready")
    owner = team["owner"]
    control, interim = _control_with(team, "INTERIM")
    _prepare_design(migrated, team, control)
    # Its design request is settled (the evidence came in another way).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', cancellation_reason = %s "
            "WHERE engagement_control_id = %s AND testing_phase = 'DESIGN'",
            ("Design evidence was walked through with the owner.", control),
        )
        connection.commit()
    body = _progress(team)
    assert _phase(body, control, "INTERIM")["step"] == "READY"
    assert body["ready"]["INTERIM"] >= 1
    assert body["recommendation"].startswith(
        "Design and implementation testing has been completed for 1 control."
    )
    assert body["recommendation"].endswith("The interim evidence requests are ready for review.")
    row = next(r for r in owner.get(f"{_project(team)}/workspace/controls").json()
               if r["id"] == control)  # fmt: skip
    assert row["next_step"] == "Release the interim phase"
    # Nothing is released or sent on its own.
    assert _rows(
        migrated, "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]  # fmt: skip
    sent = _rows(
        migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
    )
    released = owner.post(f"{_project(team)}/controls/{control}/phases/INTERIM/release", json={})
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "INTERIM")
    assert status["step"] == "RELEASED" and status["early"] is False and status["released_by"]
    assert (
        _rows(
            migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
        )
        == sent
    )
    # The request now goes for approval like any other: a person still approves and sends.
    details = owner.get(f"{_project(team)}/pbc-requests/{interim['id']}/details").json()
    assert not any(item["key"] == "planning" for item in details["checks"])
    # Releasing again changes nothing.
    again = owner.post(f"{_project(team)}/controls/{control}/phases/INTERIM/release", json={})
    assert again.status_code == 200
    assert _rows(
        migrated, "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(1,)]  # fmt: skip
    audit = _rows(
        migrated, "SELECT payload FROM audit_events WHERE target_id = %s "
        "AND action = 'phase.released'", UUID(control),
    )  # fmt: skip
    assert len(audit) == 1 and audit[0][0]["early"] is False


def test_an_early_release_needs_a_reason_and_only_a_reviewer_releases(
    migrated: Database,
) -> None:
    team = _launched(migrated, "release-early")
    owner = team["owner"]
    control, _ = _control_with(team, "INTERIM")
    path = f"{_project(team)}/controls/{control}/phases/INTERIM/release"
    bare = owner.post(path, json={})
    assert bare.status_code == 409
    assert "Say why the interim phase is released now" in bare.json()["detail"]
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "release-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    reason = "Design and interim testing run together this year, as agreed with the client."
    assert _session(migrated, member).post(path, json={"reason": reason}).status_code == 403
    early = owner.post(path, json={"reason": reason})
    assert early.status_code == 200, early.text
    status = next(item for item in early.json()["phases"] if item["phase"] == "INTERIM")
    assert status["early"] is True and status["step_label"] == "Released early"
    assert status["reason"] == reason
    # The roll-forward waits for interim testing even once interim is released.
    roll = next(item for item in early.json()["phases"] if item["phase"] == "ROLLFORWARD")
    assert roll["step"] in ("WAITING", "NOT_APPLICABLE")


def test_where_interim_does_not_apply_the_roll_forward_follows_design(
    migrated: Database,
) -> None:
    team = _launched(migrated, "release-direct")
    control, _ = _control_with(team, "INTERIM")
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE evidence_plan_phases SET applicability = 'NOT_APPLICABLE',
                   rationale = 'The control was introduced after the interim date this year.'
            WHERE engagement_control_id = %s AND phase = 'INTERIM'
            """,
            (control,),
        )
        connection.execute(
            "UPDATE evidence_plan_phases SET applicability = 'APPLICABLE' "
            "WHERE engagement_control_id = %s AND phase = 'ROLLFORWARD'",
            (control,),
        )
        connection.commit()
    _prepare_design(migrated, team, control)
    body = _progress(team)
    assert _phase(body, control, "INTERIM")["step"] == "NOT_APPLICABLE"
    assert _phase(body, control, "ROLLFORWARD")["step"] == "READY"
    refused = team["owner"].post(
        f"{_project(team)}/controls/{control}/phases/INTERIM/release",
        json={"reason": "Released anyway, to see what happens to it."},
    )
    assert refused.status_code == 409
    assert "does not apply" in refused.json()["detail"]


def test_a_reviewer_releases_the_controls_they_select_one_by_one(migrated: Database) -> None:
    team = _launched(migrated, "release-batch")
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    controls = [row["id"] for row in rows if row["included"]][:3]
    _prepare_design(migrated, team, controls[0])
    result = team["owner"].post(
        f"{_project(team)}/phases/release",
        json={"phase": "INTERIM", "control_ids": controls},
    )
    assert result.status_code == 200, result.text
    outcome = {item["control_id"]: item for item in result.json()["outcomes"]}
    # The one whose design is complete is released; the others need a reason first.
    assert outcome[controls[0]]["released"] is True
    for other in controls[1:]:
        assert outcome[other]["released"] is False
        assert "Say why" in outcome[other]["detail"]
    assert result.json()["released"] == 1
