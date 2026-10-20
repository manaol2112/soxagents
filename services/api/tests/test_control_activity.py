"""A control's activity (the control record's Activity view), and its conclusion coming
only from a signed-off review."""

from typing import Any

from support import Database
from test_control_progress import _controls
from test_engagement_data import _engagement, _requests
from test_evidence_review import _base
from test_outbound import migrated

from ai_workforce_api.db import connect

_ = migrated


def _activity(client: Any, team: dict[str, Any], control_id: str) -> Any:
    return client.get(f"{_base(team['org'], team['project'])}/controls/{control_id}/activity")


def test_a_control_shows_its_own_audit_trail_with_who_did_it(migrated: Database) -> None:
    team, client = _engagement(migrated, "activity")
    with connect(migrated.url) as connection:
        ids = _requests(connection, team["project"])
        control = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (ids[0],)
        ).fetchone()
        other = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (ids[-1],)
        ).fetchone()
        assert control is not None and other is not None
        # An agent's work, as the console records it: the payload names the agent.
        connection.execute(
            """
            INSERT INTO audit_events (organization_id, project_id, action, target_type,
                                      target_id, payload)
            VALUES (%s, %s, 'evidence.analyzed', 'pbc_request', %s,
                    '{"agent": "evidence-coordinator", "kind": "POPULATION"}')
            """,
            (team["org"], team["project"], ids[0]),
        )
        connection.commit()
    response = _activity(client, team, str(control[0]))
    assert response.status_code == 200, response.text
    items = response.json()
    assert items, "the fixture's requests and plan leave a trail"
    # Newest first.
    assert [item["at"] for item in items] == sorted((item["at"] for item in items), reverse=True)
    read = next(item for item in items if item["action"] == "evidence.analyzed")
    assert (read["by"], read["actor"], read["category"], read["title"]) == (
        "agent", "Evidence coordinator", "evidence", "Evidence read"
    )  # fmt: skip
    # A person's own action is theirs.
    assert any(item["by"] == "person" for item in items)
    # Bookkeeping is left out, and so is another control's trail.
    assert not any(item["action"] in ("task.read", "model.called") for item in items)
    theirs = _activity(client, team, str(other[0])).json()
    assert read["id"] not in {item["id"] for item in theirs}
    # Statuses read as words.
    assert not any(item["detail"].isupper() for item in items if item["detail"])


def test_another_engagements_control_is_not_found(migrated: Database) -> None:
    team, _client = _engagement(migrated, "act-a")
    _other, other_client = _engagement(migrated, "act-b")
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s LIMIT 1",
            (team["project"],),
        ).fetchone()
    assert control is not None
    path = f"{_base(_other['org'], _other['project'])}/controls/{control[0]}/activity"
    assert other_client.get(path).status_code == 404


def test_only_a_signed_off_review_concludes_a_control(migrated: Database) -> None:
    team, client = _engagement(migrated, "concludes")
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
            "ORDER BY control_ref LIMIT 1",
            (team["project"],),
        ).fetchone()
        assert control is not None
        # The review's task marked done by hand, with no review signed off.
        connection.execute(
            "UPDATE tasks SET status = 'SUCCEEDED' "
            "WHERE engagement_control_id = %s AND plan_kind = 'review'",
            (control[0],),
        )
        connection.commit()
    row = _controls(client, team)[str(control[0])]
    assert row["conclusion"] == "NOT_CONCLUDED"
    assert row["progress"] != "CONCLUDED"
    # Signed off by the independent reviewer: now it is concluded.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_reviews (
                organization_id, project_id, engagement_control_id, opened_by, status,
                reperform_status, signed_by, signed_at
            )
            VALUES (%s, %s, %s, %s, 'SIGNED_OFF', 'IDLE', %s, clock_timestamp())
            """,
            (team["org"], team["project"], control[0], team["owner_id"], team["reviewer_id"]),
        )
        connection.commit()
    row = _controls(client, team)[str(control[0])]
    assert row["conclusion"] == "EFFECTIVE"
    # The opinion follows the review; the conclusion is final only once the testing
    # behind it is complete (workflow integrity W1). Here nothing was tested: the
    # register says what is outstanding instead of reading the control as concluded.
    assert row["final"] is False and row["progress"] != "CONCLUDED"
    assert [item["text"] for item in row["not_final"]] == [
        "Interim testing outstanding",
        "Design and implementation testing outstanding",
        "Roll-forward testing outstanding",
    ]
    assert row["next_step"] == "Interim testing outstanding"
