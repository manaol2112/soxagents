"""Plan-revision impact assessments and sign-off history (workflow integrity W3,
migration 0091): results signed off under an earlier or unrecorded plan revision are not
relied on until an independent reviewer decides; the agent recommends; re-performance
reopens the testing and its review; every sign-off stays on record."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_control_progress import _controls
from test_control_reviews import _prepared_control
from test_master_plans import _approve
from test_outbound import _session, migrated
from test_phase_release import _prepare_design
from test_round_reviews import _sign_review
from test_testing_engine import _base
from test_workpapers import _tested_control

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _signoffs(migrated: Database, sheet_id: str) -> list[tuple[Any, ...]]:
    with connect(migrated.url) as connection:
        return connection.execute(
            "SELECT signed_by, signed_at, conclusion, sheet_version, plan_revision, reopened_at, "
            "reopened_from FROM test_sheet_signoffs WHERE test_sheet_id = %s ORDER BY signed_at",
            (sheet_id,),
        ).fetchall()


def _revise(migrated: Database, control_id: str) -> None:
    """A material change to the approved plan, as the revision triggers make it."""
    with connect(migrated.url) as connection:
        connection.execute(
            "SELECT revise_evidence_plan(id) FROM evidence_plans WHERE engagement_control_id = %s",
            (control_id,),
        )
        connection.commit()


def _revised_and_approved(
    migrated: Database, slug: str
) -> tuple[dict[str, Any], Any, dict[str, Any], str]:
    """Signed-off testing, then the plan revised and the revision approved: the results
    predate the approved revision."""
    team, client, sheet, _file = _tested_control(migrated, slug)
    control = sheet["control_id"]
    [before] = _signoffs(migrated, sheet["id"])
    assert before[4] is not None and before[5] is None
    _revise(migrated, control)
    row = _controls(client, team)[control]
    assert row["evidence_plan"] == "PROPOSED" and row["journey"]["stale_results"] is True
    _approve(team, control)
    return team, client, sheet, control


def test_a_revised_plan_raises_an_assessment_only_a_reviewer_decides(migrated: Database) -> None:
    team, client, sheet, control = _revised_and_approved(migrated, "impact-valid")
    base = _base(team)
    # Approval raised one assessment for the signed-off results, with the agent's advice.
    [assessment] = client.get(f"{base}/impact").json()
    assert assessment["status"] == "PENDING" and assessment["test_sheet_id"] == sheet["id"]
    assert assessment["to_revision"] == assessment["from_revision"] + 1
    advice = assessment["recommendation"]
    assert advice["by"] == "RULES" and advice["rationale"]
    # A revision that changed nothing a reviewer approves is recommended VALID, and is
    # still PENDING: nothing is valid until a person decides.
    assert advice["decision"] == "VALID"
    row = _controls(client, team)[control]
    assert row["readiness_state"] == "IMPACT_PENDING" and row["final"] is False
    assert any("impact assessment pending" in item["text"] for item in row["not_final"])
    assert row["journey"]["stale_results"] is True
    steps = client.get(f"{base}/next-steps").json()["steps"]
    assert any(step["kind"] == "plans_impact" and step["blocks"] for step in steps)
    # The owner signed the testing off: they never decide its assessment; the reviewer does.
    path = f"{base}/impact/{assessment['id']}/decide"
    body = {"version": assessment["version"], "decision": "VALID", "rationale": "Wording only."}
    refused = client.post(path, json=body)
    assert refused.status_code == 409, refused.text
    assert "another reviewer" in refused.json()["detail"] or "reviewer" in refused.json()["detail"]
    reviewer = _session(migrated, team["reviewer_id"])
    short = reviewer.post(path, json={**body, "rationale": "ok"})
    assert short.status_code == 422
    decided = reviewer.post(path, json=body)
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "VALID" and decided.json()["decided_by"]
    again = reviewer.post(path, json={**body, "version": decided.json()["version"]})
    assert again.status_code == 409
    # Decided VALID: the results stand under the approved revision; the sign-off on
    # record is exactly as it was.
    row = _controls(client, team)[control]
    assert row["readiness_state"] != "IMPACT_PENDING"
    assert not any(item["kind"] == "IMPACT" for item in row["not_final"])
    [after] = _signoffs(migrated, sheet["id"])
    assert after[:5] == _signoffs(migrated, sheet["id"])[0][:5] and after[5] is None


def test_reperformance_reopens_the_testing_and_keeps_every_sign_off(migrated: Database) -> None:
    team, client, sheet, control = _revised_and_approved(migrated, "impact-reperform")
    base = _base(team)
    [assessment] = client.get(f"{base}/impact").json()
    [before] = _signoffs(migrated, sheet["id"])
    reviewer = _session(migrated, team["reviewer_id"])
    decided = reviewer.post(
        f"{base}/impact/{assessment['id']}/decide",
        json={
            "version": assessment["version"],
            "decision": "REPERFORM",
            "rationale": "The approval attribute changed; the sample must be retested.",
        },
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "REPERFORM"
    row = _controls(client, team)[control]
    assert (row["sheet_status"], row["progress"], row["reopened_from"]) == (
        "OPEN",
        "TESTING_REOPENED",
        "IMPACT_ASSESSMENT",
    )
    assert row["reopen_reason"].startswith(f"Plan revision {assessment['to_revision']}:")
    # The earlier sign-off is still there, marked as reopened and otherwise untouched.
    [kept] = _signoffs(migrated, sheet["id"])
    assert kept[:5] == before[:5]
    assert kept[5] is not None and kept[6] == "IMPACT_ASSESSMENT"
    with connect(migrated.url) as connection:
        events = connection.execute(
            "SELECT action FROM audit_events WHERE target_id = %s ORDER BY occurred_at",
            (assessment["id"],),
        ).fetchall()
    assert [e[0] for e in events] == ["plan_impact.raised", "plan_impact.decided"]


def test_sign_off_history_is_never_rewritten_or_deleted(migrated: Database) -> None:
    team, client, sheet, _file = _tested_control(migrated, "impact-history")
    with connect(migrated.url) as connection:
        for statement in (
            "UPDATE test_sheet_signoffs SET signed_by = gen_random_uuid() WHERE test_sheet_id = %s",
            "UPDATE test_sheet_signoffs SET plan_revision = 99 WHERE test_sheet_id = %s",
            "DELETE FROM test_sheet_signoffs WHERE test_sheet_id = %s",
        ):
            with pytest.raises(psycopg.errors.RaiseException):
                connection.execute(statement, (sheet["id"],))
            connection.rollback()
    assert len(_signoffs(migrated, sheet["id"])) == 1
    _ = (team, client)


def test_a_sheet_signed_before_revisions_were_stamped_needs_an_assessment(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _tested_control(migrated, "impact-unknown")
    base = _base(team)
    control = sheet["control_id"]
    # As a sheet signed before W1 stamped revisions: its history row knows no revision.
    with connect(migrated.url) as connection:
        connection.execute("ALTER TABLE test_sheet_signoffs DISABLE TRIGGER USER")
        connection.execute(
            "UPDATE test_sheet_signoffs SET plan_revision = NULL WHERE test_sheet_id = %s",
            (sheet["id"],),
        )
        connection.execute("ALTER TABLE test_sheet_signoffs ENABLE TRIGGER USER")
        connection.execute(
            "UPDATE test_sheets SET plan_revision = NULL WHERE id = %s", (sheet["id"],)
        )
        connection.commit()
    row = _controls(client, team)[control]
    assert row["readiness_state"] == "IMPACT_PENDING"
    assert any("not recorded" in item["text"] for item in row["not_final"])
    raised = client.post(f"{base}/impact/detect")
    assert raised.status_code == 200, raised.text
    [assessment] = raised.json()
    assert assessment["from_revision"] is None and assessment["status"] == "PENDING"
    # Unknown is never assumed valid: the agent has no recommendation, only the reason.
    assert assessment["recommendation"]["decision"] is None
    assert "cannot be compared" in assessment["recommendation"]["rationale"]
    assert client.post(f"{base}/impact/detect").json() == raised.json()
    [kept] = _signoffs(migrated, sheet["id"])
    assert kept[0] is not None and kept[2] and kept[5] is None
    _ = UUID(assessment["id"])


def test_reperformance_after_a_signed_review_reopens_the_review_and_keeps_its_record(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _prepared_control(migrated, "impact-after-review", "DISMISS")
    base = _base(team)
    control = sheet["control_id"]
    _prepare_design(migrated, team, control)
    review = client.get(f"{base}/reviews").json()[0]
    signed = _sign_review(migrated, client, team, review["id"])
    assert signed["status"] == "SIGNED_OFF"
    row = _controls(client, team)[control]
    assert row["readiness_state"] == "CONCLUDED" and row["final"] is True
    with connect(migrated.url) as connection:
        [(signed_by, signed_at, coverage)] = connection.execute(
            "SELECT signed_by, signed_at, coverage FROM control_review_signoffs "
            "WHERE control_review_id = %s",
            (review["id"],),
        ).fetchall()
    assert signed_by is not None and coverage["sheet_version"] is not None
    # The plan is revised and the revision approved: the signed review no longer settles
    # anything; the results await the impact decision.
    _revise(migrated, control)
    _approve(team, control)
    row = _controls(client, team)[control]
    assert row["readiness_state"] == "IMPACT_PENDING" and row["final"] is False
    [assessment] = [a for a in client.get(f"{base}/impact").json() if a["status"] == "PENDING"]
    reviewer = _session(migrated, team["reviewer_id"])
    decided = reviewer.post(
        f"{base}/impact/{assessment['id']}/decide",
        json={
            "version": assessment["version"],
            "decision": "REPERFORM",
            "rationale": "The attributes changed; the sample is retested against them.",
        },
    )
    assert decided.status_code == 200, decided.text
    row = _controls(client, team)[control]
    # The testing reopened, and so did the review that covered it; neither sign-off is
    # lost: both records stay, marked reopened, with signer and time as they were.
    assert (row["sheet_status"], row["progress"], row["review_status"]) == (
        "OPEN",
        "TESTING_REOPENED",
        "OPEN",
    )
    assert row["readiness_state"] not in ("CONCLUDED", "READY_FOR_REVIEW")
    assert row["final"] is False
    with connect(migrated.url) as connection:
        kept = connection.execute(
            "SELECT signed_by, signed_at, reopened_at, reopened_from, coverage "
            "FROM control_review_signoffs WHERE control_review_id = %s",
            (review["id"],),
        ).fetchall()
        sheet_kept = _signoffs(migrated, sheet["id"])
    assert len(kept) == 1 and kept[0][0] == signed_by and kept[0][1] == signed_at
    assert kept[0][2] is not None and kept[0][3] == "IMPACT_ASSESSMENT" and kept[0][4] == coverage
    assert len(sheet_kept) == 1 and sheet_kept[0][6] == "IMPACT_ASSESSMENT"


def test_a_reviewer_documents_that_a_signed_review_covers_later_work(migrated: Database) -> None:
    team, client, sheet, _file = _prepared_control(migrated, "impact-coverage", "DISMISS")
    base = _base(team)
    control = sheet["control_id"]
    review = client.get(f"{base}/reviews").json()[0]
    signed = _sign_review(migrated, client, team, review["id"])
    # The design workpaper is prepared after the review signed: the review does not cover
    # it, and the conclusion waits.
    _prepare_design(migrated, team, control)
    row = _controls(client, team)[control]
    assert row["final"] is False
    assert any(
        "after the review" in item["text"] or "since the review" in item["text"]
        for item in row["not_final"]
    )
    # The preparer cannot assess coverage; the reviewer documents that the review covers
    # the current versions, without re-performing; the original review is unchanged.
    path = f"{base}/reviews/{review['id']}/coverage"
    body = {
        "version": signed["version"],
        "decision": "COVERS",
        "rationale": "The design workpaper restates the walkthrough the review read.",
    }
    assert client.post(path, json=body).status_code == 409
    reviewer = _session(migrated, team["reviewer_id"])
    assessed = reviewer.post(path, json=body)
    assert assessed.status_code == 200, assessed.text
    assert (
        assessed.json()["status"] == "SIGNED_OFF"
        and assessed.json()["signed_at"] == signed["signed_at"]
    )
    row = _controls(client, team)[control]
    assert row["final"] is True, [item["text"] for item in row["not_final"]]
    with connect(migrated.url) as connection:
        [(decision, versions)] = connection.execute(
            "SELECT decision, workpaper_versions FROM review_coverage_assessments "
            "WHERE control_review_id = %s",
            (review["id"],),
        ).fetchall()
        with pytest.raises(psycopg.errors.RaiseException):
            connection.execute(
                "DELETE FROM review_coverage_assessments WHERE control_review_id = %s",
                (review["id"],),
            )
        connection.rollback()
    assert decision == "COVERS" and "DESIGN" in versions
