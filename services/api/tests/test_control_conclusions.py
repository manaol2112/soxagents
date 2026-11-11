"""The Control Conclusion step and the OE gate (B3 and B0, migration 0144; the product owner,
8 November 2026: "the agent proposes, a person rates"; "OE can't start if design is
failing")."""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database, sign_off_design
from test_design_conclusions import _control, _design_deficiency, _reviewer_role
from test_evidence_flow import _project
from test_outbound import _session, migrated
from test_phase_release import _launched, _prepare_design

from ai_workforce_api.control_conclusions import Facts, propose, suggestion
from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import (
    GATE_DESIGN,
    GATE_NOT_EFFECTIVE,
    oe_gate_reason,
)

__all__ = ["migrated"]

APPLIES = (True, None, None, False)
NOT_APPLIES = (False, None, None, False)


def _facts(**overrides: Any) -> Facts:
    values: dict[str, Any] = {
        "design": "EFFECTIVE",
        "phases": {
            "INTERIM": (True, "SIGNED_OFF", "EFFECTIVE", False),
            "ROLLFORWARD": NOT_APPLIES,
        },
        "retest": None,
        "deficiencies": [],
    }
    values.update(overrides)
    return Facts(**values)


def test_the_conclusion_is_proposed_from_the_d_and_i_verdict_the_oe_results_and_deficiencies() -> (
    None
):
    # Nothing is proposed before the D&I conclusion is signed off.
    proposed, reasons, waiting, phases = propose(_facts(design=None))
    assert (proposed, reasons, waiting) == (None, [], ["the D&I conclusion is signed off"])
    # Testing recorded before the sign-off shows as it stands; nothing is concluded from it.
    assert [p.state for p in phases] == ["SIGNED_OFF", "NOT_APPLICABLE"]

    # A design signed off as not effective concludes the control without OE.
    proposed, reasons, waiting, phases = propose(
        _facts(design="NOT_EFFECTIVE", deficiencies=[("D-901", "DESIGN", "OPEN")])
    )
    assert proposed == "NOT_EFFECTIVE" and waiting == []
    assert reasons[0] == "The D&I conclusion is signed off as not effective on D-901."
    assert [p.state for p in phases] == ["NOT_PERFORMED", "NOT_APPLICABLE"]

    # Effective design and clean interim testing: effective.
    proposed, reasons, waiting, _ = propose(_facts())
    assert proposed == "EFFECTIVE" and waiting == []
    assert "Interim testing is signed off with no exceptions." in reasons

    # Exceptions, or a deficiency not closed, make it not effective.
    proposed, reasons, _, _ = propose(
        _facts(phases={"INTERIM": (True, "SIGNED_OFF", "NOT_EFFECTIVE", False)})
    )
    assert proposed == "NOT_EFFECTIVE" and "Interim testing found exceptions." in reasons
    proposed, reasons, _, _ = propose(_facts(deficiencies=[("D-002", "OPERATING", "REMEDIATED")]))
    assert proposed == "NOT_EFFECTIVE"
    assert reasons[-1] == "1 deficiency is not closed: D-002."

    # Exceptions dismissed with a reason, or retested effective after remediation, do not.
    proposed, _, _, _ = propose(
        _facts(phases={"INTERIM": (True, "SIGNED_OFF", "NOT_EFFECTIVE", True)})
    )
    assert proposed == "EFFECTIVE"
    proposed, _, _, phases = propose(
        _facts(phases={"INTERIM": (True, "SIGNED_OFF", "NOT_EFFECTIVE", False)}, retest="EFFECTIVE")
    )
    assert proposed == "EFFECTIVE" and phases[0].retested is True

    # A phase that applies and is not signed off holds the proposal.
    proposed, _, waiting, phases = propose(
        _facts(
            phases={
                "INTERIM": (True, "SIGNED_OFF", "EFFECTIVE", False),
                "ROLLFORWARD": (True, "TESTING", None, False),
            }
        )
    )
    assert proposed is None and waiting == ["roll-forward testing is signed off"]
    assert phases[1].state == "IN_PROGRESS"


def test_the_agent_suggests_a_severity_from_likelihood_and_magnitude() -> None:
    assert suggestion("REMOTE", "MATERIAL")[0] == "CONTROL_DEFICIENCY"
    assert suggestion("PROBABLE", "INCONSEQUENTIAL")[0] == "CONTROL_DEFICIENCY"
    assert suggestion("REASONABLY_POSSIBLE", "MORE_THAN_INCONSEQUENTIAL")[0] == (
        "SIGNIFICANT_DEFICIENCY"
    )
    severity, why = suggestion("PROBABLE", "MATERIAL")
    assert severity == "MATERIAL_WEAKNESS"
    assert why.startswith("A probable likelihood of a material misstatement")


def _operating_deficiency(migrated: Database, team: dict[str, Any], control: str) -> str:
    with connect(migrated.url) as connection:
        row = connection.execute(
            """
            INSERT INTO deficiencies (organization_id, project_id, reference,
                                      engagement_control_id, title, deficiency_type,
                                      identified_by, likelihood, magnitude)
            VALUES (%s, %s, 'D-902', %s, 'Access granted without approval', 'OPERATING', %s,
                    'REASONABLY_POSSIBLE', 'MORE_THAN_INCONSEQUENTIAL')
            RETURNING id
            """,
            (team["org"], team["project"], control, team["owner_id"]),
        ).fetchone()
    assert row is not None
    return str(row[0])


def test_a_person_rates_each_deficiency_and_a_severe_rating_waits_for_the_reviewer(
    migrated: Database,
) -> None:
    team = _launched(migrated, "cc-rate")
    owner = team["owner"]
    control = _control(team)
    deficiency = _operating_deficiency(migrated, team, control)
    path = f"{_project(team)}/control-conclusions/{control}"

    body = owner.get(path).json()
    # No D&I sign-off: nothing is proposed yet.
    assert (body["status"], body["proposed"], body["waiting"]) == (
        "NOT_READY",
        None,
        ["the D&I conclusion is signed off"],
    )
    item = body["deficiencies"][0]
    assert (item["reference"], item["rated"], item["suggested_severity"]) == (
        "D-902",
        False,
        "SIGNIFICANT_DEFICIENCY",
    )
    assert body["to_rate"] == 1 and body["viewer_can_rate"] is True
    rate = f"{path}/deficiencies/{deficiency}/rate"

    # A rationale is needed, and a stale version is refused.
    assert owner.post(rate, json={"severity": "CONTROL_DEFICIENCY", "version": 1,
                                  "rationale": "No."}).status_code == 422  # fmt: skip
    stale = owner.post(
        rate,
        json={"severity": "CONTROL_DEFICIENCY", "version": 9, "rationale": "Minor, as found."},
    )
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]

    # A significant deficiency waits for the reviewer: requested, rated, not yet in effect.
    rated = owner.post(
        rate,
        json={
            "severity": "SIGNIFICANT_DEFICIENCY",
            "version": item["version"],
            "rationale": "The access reaches financial reporting systems.",
        },
    )
    assert rated.status_code == 200, rated.text
    item = rated.json()["deficiencies"][0]
    assert (item["severity"], item["pending_severity"], item["rated"]) == (
        "CONTROL_DEFICIENCY",
        "SIGNIFICANT_DEFICIENCY",
        True,
    )
    assert item["rating"]["suggested_severity"] == "SIGNIFICANT_DEFICIENCY"
    assert rated.json()["to_rate"] == 0

    # Rated again at a level that needs no approval. Rewritten 9 November 2026 (security
    # sweep): before, the rating applied and withdrew the significant-deficiency request
    # waiting for the reviewer, so anyone who could rate could drop a severe finding with no
    # reviewer. Now a rating that departs from a severe request goes to the reviewer too.
    again = owner.post(
        rate,
        json={
            "severity": "CONTROL_DEFICIENCY",
            "version": item["version"],
            "rationale": "Compensating review limits the effect to a control deficiency.",
        },
    )
    assert again.status_code == 200, again.text
    item = again.json()["deficiencies"][0]
    assert (item["severity"], item["pending_severity"], item["rated"]) == (
        "CONTROL_DEFICIENCY",
        "CONTROL_DEFICIENCY",
        True,
    )

    with connect(migrated.url) as connection:
        ratings = connection.execute(
            "SELECT severity FROM deficiency_ratings WHERE deficiency_id = %s ORDER BY rated_at",
            (deficiency,),
        ).fetchall()
        assert [str(r[0]) for r in ratings] == ["SIGNIFICANT_DEFICIENCY", "CONTROL_DEFICIENCY"]
        actions = [
            str(r[0])
            for r in connection.execute(
                "SELECT action FROM audit_events WHERE target_id = %s ORDER BY created_at",
                (deficiency,),
            ).fetchall()
        ]
        assert actions == [
            "deficiency.change_requested",
            "deficiency.rated",
            "deficiency.change_requested",
            "deficiency.rated",
        ]
        # A rating, once recorded, is never changed or deleted.
        with pytest.raises(psycopg.errors.RaiseException, match="never changed"):
            connection.execute("UPDATE deficiency_ratings SET rationale = 'Edited afterwards.'")
        connection.rollback()
        with pytest.raises(psycopg.errors.RaiseException, match="never deleted"):
            connection.execute("DELETE FROM deficiency_ratings")
        connection.rollback()


def test_oe_waits_for_an_effective_d_and_i_sign_off_and_not_effective_goes_to_review(
    migrated: Database,
) -> None:
    team = _launched(migrated, "cc-gate")
    owner = team["owner"]
    control = _control(team)
    with connect(migrated.url) as connection:
        assert oe_gate_reason(connection, UUID(control)) == GATE_DESIGN
    # An effective sign-off clears OE.
    sign_off_design(migrated, team["project"], [control])
    with connect(migrated.url) as connection:
        assert oe_gate_reason(connection, UUID(control)) is None

    # Not effective: OE is not performed, and the control's review opens on the design alone,
    # with nothing for the reviewer agent to re-perform.
    other = next(
        row["id"]
        for row in owner.get(f"{_project(team)}/workspace/controls").json()
        if row["included"] and row["id"] != control
    )
    _prepare_design(migrated, team, other)
    _design_deficiency(migrated, team, other)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    signed = reviewer.post(
        f"{_project(team)}/design-conclusions/{other}/sign-off",
        json={"verdict": "NOT_EFFECTIVE", "workpaper_version": 1},
    )
    assert signed.status_code == 200, signed.text
    with connect(migrated.url) as connection:
        assert oe_gate_reason(connection, UUID(other)) == GATE_NOT_EFFECTIVE
        review = connection.execute(
            "SELECT status, reperform_status FROM control_reviews "
            "WHERE engagement_control_id = %s AND test_round_id IS NULL",
            (other,),
        ).fetchone()
    assert review == ("OPEN", "IDLE")
    released = owner.post(
        f"{_project(team)}/controls/{other}/phases/INTERIM/release",
        json={"reason": "Released anyway, to see the gate hold for a failed design."},
    )
    assert released.status_code == 409
    assert released.json()["detail"] == GATE_NOT_EFFECTIVE

    body = owner.get(f"{_project(team)}/control-conclusions/{other}").json()
    assert (body["status"], body["proposed"], body["design"]) == (
        "PROPOSED",
        "NOT_EFFECTIVE",
        "NOT_EFFECTIVE",
    )
    assert [p["state"] for p in body["phases"]][0] == "NOT_PERFORMED"
    # The review waits for the design deficiency's rating, not for testing.
    reviews = reviewer.get(f"{_project(team)}/reviews").json()
    blocking = next(r for r in reviews if r["control_id"] == other)["blocking"]
    assert blocking == ["1 deficiency not rated yet"]

    # Rated, the review signs off on the design alone, and the conclusion is final.
    from test_control_reviews import _rate_all

    with connect(migrated.url) as connection:
        _rate_all(connection, team)
        connection.commit()
    review = next(r for r in reviewer.get(f"{_project(team)}/reviews").json()
                  if r["control_id"] == other)  # fmt: skip
    assert review["blocking"] == []
    signed_review = reviewer.post(
        f"{_project(team)}/reviews/{review['id']}/sign-off", json={"version": review["version"]}
    )
    assert signed_review.status_code == 200, signed_review.text
    assert owner.get(f"{_project(team)}/control-conclusions/{other}").json()["status"] == "FINAL"
    # No OE is owed on a design that is not effective (bug hunt, 9 November 2026): before,
    # the register kept listing interim and roll-forward testing the gate forbids, so the
    # control could never be final.
    row = next(r for r in owner.get(f"{_project(team)}/workspace/controls").json()
               if r["id"] == other)  # fmt: skip
    assert row["not_final"] == [] and row["final"] is True, row["not_final"]
    # The D&I conclusion reopened: the review that rests on it opens again, its sign-off kept
    # and marked (bug hunt, 9 November 2026). Before, the review and the final conclusion
    # stood on a D&I verdict that no longer did.
    reopened = reviewer.post(
        f"{_project(team)}/design-conclusions/{other}/reopen",
        json={"reason": "The walkthrough evidence was for the wrong application."},
    )
    assert reopened.status_code == 200, reopened.text
    with connect(migrated.url) as connection:
        assert connection.execute(
            "SELECT r.status, s.reopened_from FROM control_reviews r "
            "JOIN control_review_signoffs s ON s.control_review_id = r.id "
            "WHERE r.engagement_control_id = %s AND r.test_round_id IS NULL",
            (other,),
        ).fetchall() == [("OPEN", "LATER_WORK")]
    assert owner.get(f"{_project(team)}/control-conclusions/{other}").json()["status"] != "FINAL"


def test_a_review_note_reopening_the_design_workpaper_reopens_the_d_and_i_conclusion(
    migrated: Database,
) -> None:
    """Bug hunt, 9 November 2026: a review note that reopens the design workpaper opens the
    D&I conclusion with it, as reopening the workpaper by hand does. Before, the conclusion
    stayed signed off and came back unchanged once the workpaper was prepared again."""
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.control_reviews import _reopen_workpaper
    from ai_workforce_api.db import transaction
    from ai_workforce_api.design_conclusions import design_verdict

    team = _launched(migrated, "cc-note-design")
    control = _control(team)
    sign_off_design(migrated, team["project"], [control])
    with connect(migrated.url) as connection:
        assert design_verdict(connection, team["project"], UUID(control)) == "EFFECTIVE"
        with transaction(connection) as cursor:
            reopened = _reopen_workpaper(
                cursor, Principal(kind=PrincipalKind.USER, id=team["reviewer_id"]),
                team["org"], team["project"], UUID(control), None, None,
                "The walkthrough does not show who approves.",
            )  # fmt: skip
        assert reopened
        assert design_verdict(connection, team["project"], UUID(control)) is None
        assert connection.execute(
            "SELECT reopened_from FROM design_conclusions WHERE engagement_control_id = %s",
            (control,),
        ).fetchall() == [("WORKPAPER",)]
        assert oe_gate_reason(connection, UUID(control)) == GATE_DESIGN


def test_a_rating_belongs_to_its_deficiencys_engagement(migrated: Database) -> None:
    """Migration 0146 (bug hunt, 9 November 2026): a rating names its deficiency's project,
    and the project its organization; another engagement's is refused by the database."""
    team = _launched(migrated, "cc-scope-a")
    other = _launched(migrated, "cc-scope-b")
    deficiency = _operating_deficiency(migrated, team, _control(team))
    insert = (
        "INSERT INTO deficiency_ratings (organization_id, project_id, deficiency_id, severity, "
        "rationale, rated_by) VALUES (%s, %s, %s, 'CONTROL_DEFICIENCY', "
        "'Rated for the scope test.', %s)"
    )
    with connect(migrated.url) as connection:
        for org, project in ((other["org"], other["project"]), (team["org"], other["project"])):
            with pytest.raises(psycopg.errors.ForeignKeyViolation):
                connection.execute(insert, (org, project, deficiency, team["owner_id"]))
            connection.rollback()
        connection.execute(insert, (team["org"], team["project"], deficiency, team["owner_id"]))
        connection.commit()
