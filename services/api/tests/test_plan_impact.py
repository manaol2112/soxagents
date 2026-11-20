"""Plan-revision impact assessments and sign-off history (workflow integrity W3,
migration 0091): results signed off under an earlier or unrecorded plan revision are not
relied on until an independent reviewer decides; the agent recommends; re-performance
reopens the testing and its review; every sign-off stays on record."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database, record_design_choice, sign_off_design
from test_control_progress import _controls
from test_control_reviews import _prepared_control, _rollforward_decided
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
    # Rewritten 19 November 2026 (FP-7, decision D5, product owner). Old: with the interim
    # exceptions dismissed, the conclusion was final with the roll-forward left PENDING by
    # the rules. New: an undecided phase holds the conclusion, so a person decides the
    # roll-forward first (the plan approved again, the impact decided VALID). Reason: the
    # rest of the period is either tested or scoped out by a person, never assumed.
    _rollforward_decided(migrated, team, client, control)
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
    # Rewritten 19 November 2026 (FP-7, decision D5, product owner). Old: with the interim
    # exceptions dismissed, the conclusion was final with the roll-forward left PENDING by
    # the rules. New: an undecided phase holds the conclusion, so a person decides the
    # roll-forward first (the plan approved again, the impact decided VALID). Reason: the
    # rest of the period is either tested or scoped out by a person, never assumed.
    _rollforward_decided(migrated, team, client, control)
    review = client.get(f"{base}/reviews").json()[0]
    signed = _sign_review(migrated, client, team, review["id"])
    # The design workpaper is prepared again after the review signed: the review does not
    # cover it, and the conclusion waits.
    _reprepare_design(client, team, control)
    # Rewritten 19 November 2026 (ST-2, product owner). Old: the reviewer's coverage
    # assessment alone made the conclusion final again. New: re-preparing the design
    # workpaper reopened the D&I conclusion, which is signed off again first, and finality
    # says so until it is. Reason: the conclusion rests on a D&I verdict that holds.
    row = _controls(client, team)[control]
    assert "D&I conclusion not signed off" in [item["text"] for item in row["not_final"]]
    sign_off_design(migrated, team["project"], [control])
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


def _reprepare_design(client: Any, team: dict[str, Any], control: str) -> None:
    """The design workpaper reopened after the review, changed and prepared again: work the
    signed review does not cover. Since B0 the design workpaper is prepared before OE, so the
    later design work is a re-preparation (before, it was prepared for the first time)."""
    base = f"{_base(team)}/workpapers"
    design = next(
        w for w in client.get(base, params={"control_id": control}).json() if w["stage"] == "DESIGN"
    )
    reopened = client.post(
        f"{base}/{design['id']}/reopen",
        json={"version": design["version"], "reason": "Updated after the review."},
    )
    assert reopened.status_code == 200, reopened.text
    design = reopened.json()
    key = "understanding-of-the-control"
    saved = client.post(
        f"{base}/{design['id']}/sections/{key}",
        json={"based_on": design["current_version"], "text": "Updated after the review."},
    )
    assert saved.status_code == 200, saved.text
    # Preparing a design workpaper needs a conclusion recorded on it (docs/design-
    # workpaper.md, section 3.7; 16 November 2026). Old: prepared again with none standing
    # (the setup's sign-off names none). New: the preparer records one on the reopened
    # workpaper first; the review's coverage is what this test is about.
    record_design_choice(client, _base(team), control)
    current = next(
        w for w in client.get(base, params={"control_id": control}).json() if w["stage"] == "DESIGN"
    )
    prepared = client.post(f"{base}/{current['id']}/prepare", json={"version": current["version"]})
    assert prepared.status_code == 200, prepared.text


def _basis_control(migrated: Database, slug: str) -> tuple[dict[str, Any], Any, dict[str, Any]]:
    """A sampled control tested (one exception) and not signed off."""
    team, client, sheet, _file = _tested_control(migrated, slug, sign=False)
    return team, client, sheet


def _sign(client: Any, team: dict[str, Any], sheet_id: str) -> Any:
    current = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == sheet_id
    )
    return client.post(
        f"{_base(team)}/test-sheets/{sheet_id}/sign-off", json={"version": current["version"]}
    )


def _stamp(migrated: Database, sheet_id: str) -> tuple[Any, Any]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT s.plan_revision, p.approved_revision FROM test_sheets s "
            "JOIN evidence_plans p ON p.engagement_control_id = s.engagement_control_id "
            "WHERE s.id = %s",
            (sheet_id,),
        ).fetchone()
    assert row is not None
    return row[0], row[1]


def test_an_open_sheet_follows_reapproved_attributes_and_signs_off_only_after_retest(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026; assessment scenario 14). Before, an open sheet
    kept the attributes it opened with: one added after the samples were tested ("the
    approver is not the requester") was never tested, and the sheet signed off under the
    new revision. Now approval brings the sheet in step, each result follows its attribute,
    the items are tested again, and sign-off waits for that."""
    from test_testing_engine import _answer, _Citing

    from ai_workforce_api.control_attributes import (
        AttributeAdd,
        AttributeEdit,
        add_attribute,
        edit_attribute,
    )
    from ai_workforce_api.testing_engine import run_sheet

    team, client, sheet = _basis_control(migrated, "basis-follow")
    control = sheet["control_id"]
    tested = {item["id"]: item for item in sheet["items"]}
    with connect(migrated.url) as connection:
        first = connection.execute(
            "SELECT id, version, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert first is not None
        edit_attribute(
            connection, team["org"], team["project"], UUID(control), first[0], team["owner_id"],
            AttributeEdit(text=f"{first[2]} by a named approver", version=int(first[1])),
        )  # fmt: skip
        add_attribute(
            connection, team["org"], team["project"], UUID(control), team["owner_id"],
            AttributeAdd(text="The approver is not the person who requested the access"),
        )  # fmt: skip
        connection.commit()
        approved = connection.execute(
            "SELECT test_attributes FROM engagement_controls WHERE id = %s", (control,)
        ).fetchone()
    assert approved is not None
    _approve(team, control)
    current = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == sheet["id"]
    )
    # The sheet holds the approved attributes, in their order.
    assert current["attributes"] == list(approved[0])
    assert len(current["attributes"]) == len(sheet["attributes"]) + 1
    # Each result follows its attribute: the reworded one's is dropped, the others keep
    # theirs at their position; every tested item is tested again.
    for item in current["items"]:
        before = tested[item["id"]]["cells"]
        assert item["state"] == "WAITING"
        assert item["cells"][0]["proposed"] is None
        assert [c["proposed"] for c in item["cells"][1 : len(before)]] == [
            c["proposed"] for c in before[1:]
        ]
        assert item["cells"][-1]["proposed"] is None
    # The tester is asked to test them again, and the sign-off waits for it.
    assert current["running"] is True
    refused = _sign(client, team, sheet["id"])
    assert refused.status_code == 409 and refused.json()["detail"] == "the tester is still testing"
    # Had a run cleared the items while testing on the old attributes, the sheet would say
    # so, and its sign-off waits for the test again.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_items SET needs_test = false WHERE test_sheet_id = %s", (sheet["id"],)
        )
        connection.execute(
            "UPDATE test_sheets SET run_status = 'IDLE' WHERE id = %s", (sheet["id"],)
        )
        connection.commit()
    current = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == sheet["id"]
    )
    line = (
        f"{len(current['items'])} items were tested against attributes or criteria that "
        "changed since: test them again"
    )
    assert line in current["blocking"] and current["counts"]["out_of_date"] == len(current["items"])
    assert current["proposed_conclusion"] == "INCOMPLETE"
    refused = _sign(client, team, sheet["id"])
    assert refused.status_code == 409 and line in refused.json()["detail"]
    # Test again: the items are tested on the approved attributes, then the sheet signs off
    # under the revision they were tested under, the approved one.
    retest = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/retest", json={"version": current["version"]}
    )
    assert retest.status_code == 200, retest.text
    count = len(current["attributes"])
    provider = _Citing([_answer(["PASS"] * count) for _ in current["items"]])
    with connect(migrated.url) as connection:
        run_sheet(connection, provider, UUID(sheet["id"]))
    current = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == sheet["id"]
    )
    assert current["counts"]["out_of_date"] == 0, current["blocking"]
    signed = _sign(client, team, sheet["id"])
    assert signed.status_code == 200, signed.text
    stamp, revision = _stamp(migrated, sheet["id"])
    assert stamp == revision


def test_a_sheet_signed_after_an_unrelated_revision_keeps_its_tested_revision_and_is_assessed(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026). Before, sign-off stamped the plan's current
    approved revision, so results tested before a later revision were never assessed. Now
    the stamp is the revision the results were tested under, and a reviewer's impact
    assessment is raised at once for the difference (the agent recommends VALID)."""
    team, client, sheet = _basis_control(migrated, "basis-unrelated")
    control = sheet["control_id"]
    tested_under, _ = _stamp(migrated, sheet["id"])
    _revise(migrated, control)
    _approve(team, control)
    signed = _sign(client, team, sheet["id"])
    assert signed.status_code == 200, signed.text
    stamp, revision = _stamp(migrated, sheet["id"])
    assert stamp == tested_under and revision == tested_under + 1
    [assessment] = [
        a for a in client.get(f"{_base(team)}/impact").json() if a["status"] == "PENDING"
    ]
    assert (assessment["from_revision"], assessment["to_revision"]) == (stamp, revision)
    assert assessment["recommendation"]["decision"] == "VALID"


def test_a_sheet_whose_tested_revision_is_not_recorded_signs_off_unknown(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026): an item tested without a call, on a sheet
    whose own revision is not recorded, makes the tested revision unknown; the stamp is
    empty and the "not recorded" impact assessment is raised, never the current one."""
    team, client, sheet = _basis_control(migrated, "basis-unknown")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_items SET model_call_id = NULL WHERE id = %s", (sheet["items"][0]["id"],)
        )
        connection.execute(
            "UPDATE test_sheets SET plan_revision = NULL WHERE id = %s", (sheet["id"],)
        )
        connection.commit()
    signed = _sign(client, team, sheet["id"])
    assert signed.status_code == 200, signed.text
    stamp, _revision = _stamp(migrated, sheet["id"])
    assert stamp is None
    [assessment] = [
        a for a in client.get(f"{_base(team)}/impact").json() if a["status"] == "PENDING"
    ]
    assert assessment["from_revision"] is None
