"""The sign-off history read routes (Milestone 1a): a sheet's and a review's sign-offs
as made, for members of the project only, never for another tenant; a reopening marks
the record and the next sign-off adds another."""

from typing import Any

from support import Database
from test_control_reviews import _prepared_control
from test_onboarding import _new_engagement
from test_outbound import migrated
from test_round_reviews import _sign_review
from test_testing_engine import _base, _sheet
from test_workpapers import _tested_control

__all__ = ["migrated"]


def _history(client: Any, team: dict[str, Any], sheet_id: str) -> list[dict[str, Any]]:
    read = client.get(f"{_base(team)}/test-sheets/{sheet_id}/signoffs")
    assert read.status_code == 200, read.text
    body: list[dict[str, Any]] = read.json()
    return body


def test_a_sheets_sign_offs_are_read_as_made_and_only_inside_the_project(
    migrated: Database,
) -> None:
    team, client, sheet, _file = _tested_control(migrated, "signoffs-sheet")
    [first] = _history(client, team, sheet["id"])
    assert first["signed_by"] and first["conclusion"] == "NOT_EFFECTIVE"
    assert first["plan_revision"] is not None and first["reopened_at"] is None
    assert first["test_round_id"] is None and first["round_kind"] is None
    # Reopened by a person: the record stays, marked once; signed again: a second record.
    current = _sheet(client, team)
    reopened = client.post(
        f"{_base(team)}/test-sheets/{current['id']}/reopen",
        json={"version": current["version"], "reason": "Second look at item 1"},
    )
    assert reopened.status_code == 200, reopened.text
    [marked] = _history(client, team, sheet["id"])
    assert marked["id"] == first["id"] and marked["signed_at"] == first["signed_at"]
    assert (
        marked["reopened_from"] == "PERSON" and marked["reopen_reason"] == "Second look at item 1"
    )
    assert marked["reopened_by"]
    # Another tenant's member sees nothing, even with the right ids.
    outsider = _new_engagement(migrated, "signoffs-outsider")["owner"]
    refused = outsider.get(f"{_base(team)}/test-sheets/{sheet['id']}/signoffs")
    assert refused.status_code in (403, 404)
    # The sheet is read only under its own organization and project.
    other = _new_engagement(migrated, "signoffs-other")
    crossed = client.get(
        f"/organizations/{team['org']}/projects/{other['project']}/test-sheets/{sheet['id']}/signoffs"
    )
    assert crossed.status_code in (403, 404)


def test_a_reviews_sign_offs_are_read_with_what_they_covered(migrated: Database) -> None:
    team, client, _sheet_, _file = _prepared_control(migrated, "signoffs-review", "DISMISS")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    assert client.get(f"{base}/reviews/{review['id']}/signoffs").json() == []
    signed = _sign_review(migrated, client, team, review["id"])
    [record] = client.get(f"{base}/reviews/{review['id']}/signoffs").json()
    assert record["signed_by"] and record["signed_at"] == signed["signed_at"]
    assert record["coverage"]["sheet_version"] == signed["coverage"]["sheet_version"]
    assert record["reopened_at"] is None and record["round_kind"] is None
    outsider = _new_engagement(migrated, "signoffs-review-outsider")["owner"]
    assert outsider.get(f"{base}/reviews/{review['id']}/signoffs").status_code in (403, 404)
