"""E3 part 1 (e3a-basis-integrity, 19 November 2026): the states its design re-check needs.

Each on an engagement of its own, built with the test suite's helpers through the API as
the team would (a person's decisions over the API; the reviewer agent's re-performance by
the rules, no model). Two records are written directly, as the suite's own tests write
them: a deficiency logged after the review signed (the records then propose another
verdict than the review signed), and a phase set PENDING, as the planner's rules leave
one. Each state carries the session tokens of the people who view it (8 hours; synthetic
users of this database only).

- e3a-conclusion-changed  the control's Review step: a signed review whose conclusion moved
                          since it signed (the Review coverage form offers no COVERS)
- e3a-review-footer       the control's Review step with an open review held by both new
                          sign-off reasons (an undecided proposed deficiency; a signed-off
                          result awaiting a reviewer's impact decision)
- e3a-phases-undecided    Planning, Phases view: a roll-forward phase pending determination
- e3a-history-resynced    the control's History with a test sheet updated to the approved
                          attributes and criteria
"""

from typing import Any
from uuid import UUID

from seed_review_states import _token
from test_control_reviews import _prepared_control, _rollforward_decided
from test_evidence_analysis import _Provider
from test_master_plans import _approve
from test_round_reviews import _sign_review
from test_testing_engine import _open_tested
from test_workpapers import _tested_control

from ai_workforce_api.db import connect
from ai_workforce_api.workpaper_service import run_draft

TITLE = "Access approvals are not retained for terminated contractors"


def _people(seed: Any, team: dict[str, Any]) -> dict[str, str]:
    return {
        "owner": _token(seed.url, team["owner_id"]),
        "reviewer": _token(seed.url, team["reviewer_id"]),
    }


def _href(seed: Any, team: dict[str, Any], **params: str) -> str:
    return seed.href(team, **params)


def _conclusion_changed(seed: Any) -> None:
    team, client, sheet, _file = _prepared_control(seed.database, "e3a-changed", "DISMISS")
    control = sheet["control_id"]
    _rollforward_decided(seed.database, team, client, control)
    review = client.get(f"{seed.base(team)}/reviews").json()[0]
    _sign_review(seed.database, client, team, review["id"])
    final = client.get(f"{seed.base(team)}/control-conclusions/{control}").json()
    assert final["status"] == "FINAL", final
    with connect(seed.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (organization_id, project_id, reference,
                                      engagement_control_id, title, deficiency_type,
                                      identified_by, likelihood, magnitude)
            VALUES (%s, %s, 'D-951', %s, %s, 'OPERATING', %s, 'REASONABLY_POSSIBLE',
                    'MORE_THAN_INCONSEQUENTIAL')
            """,
            (team["org"], team["project"], control, TITLE, team["owner_id"]),
        )
        # Another control's roll-forward is left pending, as the planner's rules leave one
        # (the Phases view state).
        other = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND id <> %s "
            "AND included ORDER BY control_ref LIMIT 1",
            (team["project"], control),
        ).fetchone()
        assert other is not None
        connection.execute(
            "UPDATE evidence_plan_phases SET applicability = 'PENDING', "
            "open_question = 'Does the control still run after the interim date?' "
            "WHERE engagement_control_id = %s AND phase = 'ROLLFORWARD'",
            (other[0],),
        )
        connection.commit()
    rows = {row["id"]: row for row in client.get(f"{seed.base(team)}/workspace/controls").json()}
    reasons = rows[control]["not_final"]
    assert [(r["kind"], r["coverage"]) for r in reasons] == [("REVIEW", False)], reasons
    people = _people(seed, team)
    seed.add(
        "e3a-conclusion-changed",
        _href(seed, team, section="controls", control=control, step="review"),
        tokens=people,
        viewer="reviewer",
        reason=reasons[0]["text"],
    )
    seed.add(
        "e3a-phases-undecided",
        _href(seed, team, section="planning", view="phases"),
        tokens=people,
        viewer="owner",
        control=str(other[0]),
    )


def _review_footer(seed: Any) -> None:
    team, client, sheet, _file = _tested_control(seed.database, "e3a-footer")
    base = seed.base(team)
    control = sheet["control_id"]
    paper = next(
        w
        for w in client.get(f"{base}/workpapers", params={"control_id": control}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    with connect(seed.url) as connection:
        assert run_draft(connection, _Provider([{"sections": []}]), UUID(paper["id"])) == "DONE"
    paper = next(
        w
        for w in client.get(f"{base}/workpapers", params={"control_id": control}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    prepared = client.post(
        f"{base}/workpapers/{paper['id']}/prepare",
        json={"version": paper["version"], "rationale_reviewed": True},
    )
    assert prepared.status_code == 200, prepared.text
    with connect(seed.url) as connection:
        # A material change to the approved plan, as the revision triggers make it; the
        # owner approves it again, so the signed-off results predate its revision.
        connection.execute(
            "SELECT revise_evidence_plan(id) FROM evidence_plans WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    _approve(team, control)
    review = client.get(f"{base}/reviews").json()[0]
    held = [
        "1 signed-off result awaits a reviewer's impact decision",
        "the proposed deficiency is not yet logged or dismissed on the test sheet",
    ]
    assert all(line in review["blocking"] for line in held), review["blocking"]
    seed.add(
        "e3a-review-footer",
        _href(seed, team, section="controls", control=control, step="review"),
        tokens=_people(seed, team),
        viewer="reviewer",
        blocking=review["blocking"],
    )


def _history_resynced(seed: Any) -> None:
    team, client, sheet = _open_tested(seed.database, "e3a-resync")
    control = sheet["control_id"]
    with connect(seed.url) as connection:
        row = connection.execute(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert row is not None
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', criteria_accepted_at = NULL, "
            "condition = 'An access request is approved', "
            "pass_criteria = 'A named approver approved it before access was granted', "
            "fail_criteria = 'No approval, or one after access was granted' WHERE id = %s",
            (row[0],),
        )
        connection.commit()
    _approve(team, control)
    with connect(seed.url) as connection:
        version = connection.execute(
            "SELECT version FROM control_attributes WHERE id = %s", (row[0],)
        ).fetchone()
    assert version is not None
    accepted = team["owner"].post(
        f"{seed.base(team)}/controls/{control}/master-plan/criteria/accept",
        json={"attributes": [{"id": str(row[0]), "version": int(version[0])}]},
    )
    assert accepted.status_code == 200, accepted.text
    activity = client.get(f"{seed.base(team)}/controls/{control}/activity").json()
    titles = [item["title"] for item in activity]
    assert "Test sheet updated to the approved attributes and criteria" in titles, titles
    seed.add(
        "e3a-history-resynced",
        _href(seed, team, section="controls", control=control, step="activity"),
        tokens=_people(seed, team),
        viewer="owner",
    )


def build(seed: Any) -> None:
    _conclusion_changed(seed)
    _review_footer(seed)
    _history_resynced(seed)
