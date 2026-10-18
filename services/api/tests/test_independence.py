"""The development switch that relaxes the independent-review rules."""

from collections.abc import Iterator
from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_control_reviews import _prepared_control
from test_onboarding import _new_engagement
from test_outbound import _session, migrated
from test_testing_engine import _base

from ai_workforce_api import independence
from ai_workforce_api.control_reviews import run_reperformance
from ai_workforce_api.db import connect

__all__ = ["migrated"]


@pytest.fixture(autouse=True)
def _restore() -> Iterator[None]:
    yield
    independence.configure(True)


def test_with_independence_off_the_preparer_can_review_and_sign_off_their_own_work(
    migrated: Database,
) -> None:
    team, _client, _sheet, _ticket = _prepared_control(migrated, "dev-self-review", "DISMISS")
    # The same person who tested and prepared the work, with the rules switched off.
    client = _session(migrated, team["owner_id"], review_independence_required=False)
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    assert review["independence_required"] is False
    assert review["viewer_prepared"] is True and review["viewer_is_reviewer"] is True
    path = f"{base}/reviews/{review['id']}"
    for note in [n for n in review["notes"] if n["status"] == "PROPOSED"]:
        decided = client.post(
            f"{path}/notes/{note['id']}/decide",
            json={"version": review["version"], "action": "DISMISS", "reason": "Dev check."},
        )
        assert decided.status_code == 200, decided.text
        review = decided.json()
    signed = client.post(f"{path}/sign-off", json={"version": review["version"]})
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "SIGNED_OFF"


def test_with_independence_on_the_same_person_is_refused(migrated: Database) -> None:
    team, client, _sheet, _ticket = _prepared_control(migrated, "dev-self-refused", "DISMISS")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    assert review["independence_required"] is True
    note_path = f"{base}/reviews/{review['id']}"
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    note = next(n for n in review["notes"] if n["status"] == "PROPOSED")
    refused = client.post(
        f"{note_path}/notes/{note['id']}/decide",
        json={"version": review["version"], "action": "DISMISS", "reason": "Mine."},
    )
    assert refused.status_code == 409 and "reviewer role" in refused.json()["detail"]


def test_with_independence_off_setup_does_not_need_a_separate_reviewer(
    migrated: Database,
) -> None:
    team, _client, _sheet, _ticket = _prepared_control(migrated, "dev-setup", "DISMISS")
    onboarding = f"/organizations/{team['org']}/projects/{team['project']}/onboarding"
    strict = _session(migrated, team["owner_id"])
    issues = [i for r in strict.get(onboarding).json()["readiness"] for i in r["issues"]]
    with connect(migrated.url) as connection:
        reviewer_named = connection.execute(
            "SELECT 1 FROM project_memberships "
            "WHERE project_id = %s AND engagement_role = 'REVIEWER'",
            (team["project"],),
        ).fetchone()
    if reviewer_named is None:
        assert "Name an independent reviewer." in issues
    relaxed = _session(migrated, team["owner_id"], review_independence_required=False)
    body = relaxed.get(onboarding).json()
    assert body["independence_required"] is False
    assert "Name an independent reviewer." not in [
        i for r in body["readiness"] for i in r["issues"]
    ]


def test_with_independence_off_one_person_can_hold_several_roles(migrated: Database) -> None:
    team = _new_engagement(migrated, "dev-roles")
    owner = _session(migrated, team["owner_id"], review_independence_required=False)
    base = _onboarding(team)
    person = str(team["owner_id"])
    for role in ("LEAD", "REVIEWER", "PREPARER"):
        added = owner.post(f"{base}/team", json={"user_id": person, "engagement_role": role})
        assert added.status_code == 200, added.text
    roles = _roles(added.json(), person)
    assert roles == ["LEAD", "PREPARER", "REVIEWER"]
    # One person on the team, however many roles.
    assert len({m["user_id"] for m in added.json()["team"]}) == 1
    issues = [i for r in added.json()["readiness"] for i in r["issues"]]
    assert "Name an engagement lead." not in issues
    # Taking away one role leaves the others.
    dropped = owner.post(f"{base}/team/{person}/remove", json={"engagement_role": "LEAD"})
    assert dropped.status_code == 200, dropped.text
    assert _roles(dropped.json(), person) == ["PREPARER", "REVIEWER"]
    dropped = owner.post(f"{base}/team/{person}/remove", json={"engagement_role": "REVIEWER"})
    assert _roles(dropped.json(), person) == ["PREPARER"]


def test_with_independence_on_a_new_role_replaces_the_old_one(migrated: Database) -> None:
    team = _new_engagement(migrated, "strict-roles")
    owner = _session(migrated, team["owner_id"])
    base = _onboarding(team)
    person = str(team["owner_id"])
    owner.post(f"{base}/team", json={"user_id": person, "engagement_role": "LEAD"})
    changed = owner.post(f"{base}/team", json={"user_id": person, "engagement_role": "REVIEWER"})
    assert _roles(changed.json(), person) == ["REVIEWER"]


def test_turning_independence_back_on_hides_the_extra_roles(migrated: Database) -> None:
    team = _new_engagement(migrated, "roles-back-on")
    base = _onboarding(team)
    person = str(team["owner_id"])
    relaxed = _session(migrated, team["owner_id"], review_independence_required=False)
    relaxed.post(f"{base}/team", json={"user_id": person, "engagement_role": "LEAD"})
    relaxed.post(f"{base}/team", json={"user_id": person, "engagement_role": "REVIEWER"})
    strict = _session(migrated, team["owner_id"])
    body = strict.get(base).json()
    # The creator joined as a preparer; lead and reviewer were extra roles, now hidden.
    assert _roles(body, person) == ["PREPARER"]
    assert "Name an independent reviewer." in [i for r in body["readiness"] for i in r["issues"]]


def _onboarding(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}/onboarding"


def _roles(snapshot: dict[str, Any], user_id: str) -> list[str]:
    return sorted(m["engagement_role"] for m in snapshot["team"] if m["user_id"] == user_id)
