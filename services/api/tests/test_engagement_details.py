"""Editing an engagement's details with the form it was created with (Milestone 8.15)."""

from typing import Any

from support import Database
from test_engagement_close import _finish_the_work, _launched
from test_execution import _add_user
from test_onboarding import _new_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _project(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _form(detail: dict[str, Any], **changes: Any) -> dict[str, Any]:
    body = {
        "version": detail["version"],
        "name": detail["name"],
        "owner_user_id": detail["owner_user_id"],
        "client_name": detail["client_name"],
        "period_end": detail["period_end"],
        "starts_on": detail["starts_on"],
        "ends_on": detail["ends_on"],
    }
    body.update(changes)
    return body


def test_a_draft_is_edited_in_one_step(migrated: Database) -> None:
    team = _new_engagement(migrated, "edit-draft")
    owner, project = team["owner"], _project(team)
    detail = owner.get(project).json()
    assert detail["launched"] is False and detail["client_name"] == ""
    with connect(migrated.url) as connection:
        lead = _add_user(connection, team["org"], "lead@example.com", "PROJECT_MANAGER")
    edited = owner.patch(
        f"{project}/details",
        json=_form(
            detail,
            name="  SOX   FY28 ",
            owner_user_id=str(lead),
            client_name=" Acme  Corp ",
            period_end="2028-12-31",
            starts_on="2028-01-15",
            ends_on="2028-03-31",
        ),
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["name"], body["client_name"], body["period_end"]) == (
        "SOX FY28",
        "Acme Corp",
        "2028-12-31",
    )
    assert body["owner_user_id"] == str(lead)
    assert (body["starts_on"], body["ends_on"]) == ("2028-01-15", "2028-03-31")
    # The slug and status stay; the setup reads the same client and period.
    assert body["slug"] == detail["slug"] and body["status"] == "DRAFT"
    setup = owner.get(f"{project}/onboarding").json()
    assert setup["settings"]["client_name"] == "Acme Corp"
    assert setup["settings"]["period_end"] == "2028-12-31"
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'project.updated' ORDER BY occurred_at DESC LIMIT 1",
            (team["project"],),
        ).fetchone()
    assert audit is not None
    assert audit[0]["fields"] == [
        "client",
        "ends_on",
        "name",
        "owner",
        "period_end",
        "starts_on",
    ]
    # A stale form, a blank name, and dates out of order are refused.
    assert owner.patch(f"{project}/details", json=_form(detail)).status_code == 409
    fresh = owner.get(project).json()
    assert owner.patch(f"{project}/details", json=_form(fresh, name="   ")).status_code == 422
    backwards = _form(fresh, starts_on="2028-04-01", ends_on="2028-03-01")
    assert owner.patch(f"{project}/details", json=backwards).status_code == 422
    stranger = _form(fresh, owner_user_id="00000000-0000-7000-8000-000000000000")
    assert owner.patch(f"{project}/details", json=stranger).status_code == 404


def test_after_launch_the_client_and_period_stay(migrated: Database) -> None:
    team = _launched(migrated, "edit-launched")
    owner, project = team["owner"], _project(team)
    detail = owner.get(project).json()
    assert detail["launched"] is True
    locked = owner.patch(f"{project}/details", json=_form(detail, client_name="Other Co"))
    assert locked.status_code == 409
    assert locked.json()["detail"] == "client and period end are locked after launch"
    moved = owner.patch(f"{project}/details", json=_form(detail, period_end="2030-12-31"))
    assert moved.status_code == 409
    renamed = owner.patch(f"{project}/details", json=_form(detail, name="SOX FY27 Interim"))
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "SOX FY27 Interim"


def test_a_completed_engagement_is_not_edited(migrated: Database) -> None:
    team = _launched(migrated, "edit-completed")
    owner, project = team["owner"], _project(team)
    _finish_the_work(migrated, team)
    version = owner.get(f"{project}/completion").json()["version"]
    assert owner.post(f"{project}/complete", json={"version": version}).status_code == 200
    detail = owner.get(project).json()
    refused = owner.patch(f"{project}/details", json=_form(detail, name="Renamed"))
    assert refused.status_code == 409
    assert refused.json()["detail"] == "engagement is not active: it is completed and read-only"
