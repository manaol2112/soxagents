"""The D&I conclusion, signed by an independent reviewer (migration 0143; the product owner,
8 November 2026: "OE can't start if design is failing")."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_evidence_flow import _project
from test_outbound import _session, migrated
from test_phase_release import _launched, _prepare_design

from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import design_verdict

__all__ = ["migrated"]


def _control(team: dict[str, Any]) -> str:
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    return str(next(row["id"] for row in rows if row["included"]))


def _reviewer_role(migrated: Database, team: dict[str, Any], user_id: UUID) -> None:
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
            VALUES (%s, %s, %s, 'REVIEWER')
            ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'
            """,
            (team["org"], team["project"], user_id),
        )


def _design_deficiency(migrated: Database, team: dict[str, Any], control: str) -> None:
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (organization_id, project_id, reference,
                                      engagement_control_id, title, deficiency_type, identified_by)
            VALUES (%s, %s, 'D-901', %s, 'No approval step in the design', 'DESIGN', %s)
            """,
            (team["org"], team["project"], control, team["owner_id"]),
        )


def _verdict(migrated: Database, team: dict[str, Any], control: str) -> str | None:
    with connect(migrated.url) as connection:
        return design_verdict(connection, team["project"], UUID(control))


def test_the_d_and_i_conclusion_is_signed_by_an_independent_reviewer(migrated: Database) -> None:
    team = _launched(migrated, "dc-sign")
    owner = team["owner"]
    control = _control(team)
    path = f"{_project(team)}/design-conclusions/{control}"

    # Nothing to conclude before the design workpaper is prepared.
    body = owner.get(path).json()
    assert (body["status"], body["proposed"], body["can_sign"]) == ("NOT_READY", None, False)
    assert body["blocking"] == ["the design workpaper is not prepared"]
    assert _verdict(migrated, team, control) is None

    # Prepared by the owner: the records propose an effective design.
    _prepare_design(migrated, team, control)
    body = owner.get(path).json()
    assert (body["status"], body["proposed"]) == ("TO_SIGN", "EFFECTIVE")
    assert body["viewer_prepared"] is True and body["can_sign"] is False
    sign = {"verdict": "EFFECTIVE", "workpaper_version": 1, "note": "Design walked through."}

    # Only the reviewer role signs, and never the preparer.
    refused = owner.post(f"{path}/sign-off", json=sign)
    assert refused.status_code == 409 and "reviewer role" in refused.json()["detail"]
    _reviewer_role(migrated, team, team["owner_id"])
    own = owner.post(f"{path}/sign-off", json=sign)
    assert own.status_code == 409 and "another reviewer" in own.json()["detail"]

    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    assert reviewer.get(path).json()["can_sign"] is True
    # The reviewer confirms the records' verdict, on the version they reviewed.
    other = reviewer.post(f"{path}/sign-off", json={**sign, "verdict": "NOT_EFFECTIVE"})
    assert other.status_code == 409 and "different verdict" in other.json()["detail"]
    stale = reviewer.post(f"{path}/sign-off", json={**sign, "workpaper_version": 2})
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]

    signed = reviewer.post(f"{path}/sign-off", json=sign)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["status"] == "SIGNED_OFF" and body["can_sign"] is False
    assert body["signed"]["verdict"] == "EFFECTIVE"
    assert body["signed"]["signoff_note"] == "Design walked through."
    assert _verdict(migrated, team, control) == "EFFECTIVE"
    again = reviewer.post(f"{path}/sign-off", json=sign)
    assert again.status_code == 409 and "signed off" in again.json()["detail"]

    # A design deficiency logged afterwards puts the sign-off out of date: OE is not cleared.
    _design_deficiency(migrated, team, control)
    body = reviewer.get(path).json()
    assert (body["status"], body["proposed"]) == ("OUT_OF_DATE", "NOT_EFFECTIVE")
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    assert [item["reference"] for item in body["deficiencies"]] == ["D-901"]
    assert _verdict(migrated, team, control) is None
    resigned = reviewer.post(f"{path}/sign-off", json={**sign, "verdict": "NOT_EFFECTIVE"})
    assert resigned.status_code == 200, resigned.text
    body = resigned.json()
    assert body["status"] == "SIGNED_OFF" and body["signed"]["deficiencies"] == ["D-901"]
    assert _verdict(migrated, team, control) == "NOT_EFFECTIVE"
    # The first sign-off is kept, marked superseded.
    assert [(item["verdict"], item["reopened_from"]) for item in body["history"]] == [
        ("NOT_EFFECTIVE", None),
        ("EFFECTIVE", "SUPERSEDED"),
    ]

    # A reviewer may open it again, with a reason.
    short = reviewer.post(f"{path}/reopen", json={"reason": "No."})
    assert short.status_code == 422
    reopened = reviewer.post(
        f"{path}/reopen", json={"reason": "The walkthrough must be performed again."}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "TO_SIGN"
    assert _verdict(migrated, team, control) is None

    with connect(migrated.url) as connection:
        actions = [
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s "
                "AND target_type = 'design_conclusion' ORDER BY created_at",
                (team["project"],),
            ).fetchall()
        ]
    assert actions == [
        "design_conclusion.signed_off",
        "design_conclusion.signed_off",
        "design_conclusion.reopened",
    ]


def test_a_recorded_d_and_i_conclusion_is_never_changed_or_deleted(migrated: Database) -> None:
    team = _launched(migrated, "dc-keep")
    control = _control(team)
    _prepare_design(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    signed = reviewer.post(
        f"{path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": 1}
    )
    assert signed.status_code == 200, signed.text
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.RaiseException, match="never changed"):
            connection.execute("UPDATE design_conclusions SET verdict = 'NOT_EFFECTIVE'")
        connection.rollback()
        with pytest.raises(psycopg.errors.RaiseException, match="never deleted"):
            connection.execute("DELETE FROM design_conclusions")
        connection.rollback()
        # Only one sign-off stands per control.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                """
                INSERT INTO design_conclusions (organization_id, project_id,
                    engagement_control_id, workpaper_id, workpaper_version, verdict, signed_by)
                SELECT organization_id, project_id, engagement_control_id, workpaper_id,
                       workpaper_version, verdict, signed_by
                FROM design_conclusions
                """
            )


def test_reopening_the_design_workpaper_opens_the_d_and_i_conclusion(migrated: Database) -> None:
    team = _launched(migrated, "dc-reopen")
    owner = team["owner"]
    control = _control(team)
    _prepare_design(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    assert (
        reviewer.post(
            f"{path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": 1}
        ).status_code
        == 200
    )
    paper = owner.get(f"{path}").json()["workpaper"]
    with connect(migrated.url) as connection:
        version = connection.execute(
            "SELECT version FROM workpapers WHERE id = %s", (paper["id"],)
        ).fetchone()
    assert version is not None
    opened = owner.post(
        f"{_project(team)}/workpapers/{paper['id']}/reopen",
        json={"version": version[0], "reason": "Walkthrough notes to correct."},
    )
    assert opened.status_code == 200, opened.text
    body = owner.get(path).json()
    assert (body["status"], body["signed"]) == ("NOT_READY", None)
    assert body["history"][0]["reopened_from"] == "WORKPAPER"
    assert body["history"][0]["reopen_reason"] == "Walkthrough notes to correct."
    assert _verdict(migrated, team, control) is None


def test_a_control_of_another_engagement_is_not_found(migrated: Database) -> None:
    team = _launched(migrated, "dc-tenant")
    missing = team["owner"].get(f"{_project(team)}/design-conclusions/{uuid4()}")
    assert missing.status_code == 404
