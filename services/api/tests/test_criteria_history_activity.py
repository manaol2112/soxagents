"""A change of an attribute's criteria in the control's History (product owner, 20 November
2026: "Can you please remove the previous criteria link here and probably add that as part of
the history that it was updated?"). Each change is a "Test criteria updated" row naming the
attribute, who changed it and when, that opens to the earlier and the new criteria read from
the kept versions (attribute_criteria_versions). A person's change is its audit event; an
agent's, which no event records, is shown from its kept version. An event from before this
change names no version: its row shows without the comparison, never a guessed one. Synthetic
data only."""

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from support import Database
from test_outbound import migrated
from test_planning_gate import _control, _launched, _project, _rows

from ai_workforce_api.criteria_history import PLANNER, writing
from ai_workforce_api.db import connect

_ = migrated

AGENT_CRITERIA = (
    "The access request names the user and the role requested.",
    "The user's manager approved the request before the grant.",
    "No approval is recorded, or it is dated after the grant.",
)


def _master(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/controls/{control}/master-plan")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _history(team: dict[str, Any], control: str, client: Any = None) -> list[dict[str, Any]]:
    read = (client or team["owner"]).get(f"{_project(team)}/controls/{control}/activity")
    assert read.status_code == 200, read.text
    body: list[dict[str, Any]] = read.json()
    return body


def _criteria_rows(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in items if item["title"] == "Test criteria updated"]


def _agent_writes(
    migrated: Database, attribute: str, criteria: tuple[str, str, str], cause: str = ""
) -> None:
    """The planner's criteria on the attribute, as its run writes them: no audit event."""
    with connect(migrated.url) as connection:
        with connection.cursor() as cursor, writing(cursor, writer=PLANNER, cause=cause):
            cursor.execute(
                "UPDATE control_attributes SET condition = %s, pass_criteria = %s, "
                "fail_criteria = %s, judgment_required = false, criteria_origin = 'AGENT', "
                "criteria_accepted_at = NULL, criteria_accepted_by = NULL, "
                "version = version + 1 WHERE id = %s",
                (*criteria, UUID(attribute)),
            )
        connection.commit()


def _save(
    migrated: Database, team: dict[str, Any], control: str, attribute: str, passes: str
) -> None:
    [version] = _rows(
        migrated,
        "SELECT version FROM control_attributes WHERE id = %s",
        UUID(attribute),
    )
    saved = team["owner"].post(
        f"{_project(team)}/controls/{control}/master-plan/attributes/{attribute}/criteria",
        json={
            "version": version[0],
            "condition": AGENT_CRITERIA[0],
            "pass_criteria": passes,
            "fail_criteria": AGENT_CRITERIA[2],
            "judgment_required": False,
        },
    )
    assert saved.status_code == 200, saved.text


def _set_up(migrated: Database, slug: str) -> tuple[dict[str, Any], str, dict[str, Any]]:
    team = _launched(migrated, slug)
    control = _control(team, "ITGC-AC-01")["id"]
    attribute = _master(team, control)["attributes"][0]
    _agent_writes(migrated, attribute["id"], AGENT_CRITERIA)
    return team, control, attribute


def test_a_persons_change_opens_to_the_earlier_and_the_new_criteria(
    migrated: Database,
) -> None:
    team, control, attribute = _set_up(migrated, "hist-person")
    _save(migrated, team, control, attribute["id"], "The manager approved it in the ticket first.")
    _save(migrated, team, control, attribute["id"], "The manager approved it in the ticket, dated.")
    rows = [item for item in _criteria_rows(_history(team, control)) if item["by"] == "person"]
    assert len(rows) == 2
    newest, first = rows
    # Newest first, each the person's, naming the attribute.
    assert newest["at"] >= first["at"]
    assert newest["action"] == first["action"] == "control_attribute.criteria_set"
    assert newest["category"] == "design"
    assert attribute["text"].split()[0] in newest["detail"]
    assert newest["actor"] and newest["actor"] == first["actor"]
    # The first change: from the agent's criteria to the person's first wording.
    assert first["criteria"]["earlier"]["pass_criteria"] == AGENT_CRITERIA[1]
    assert first["criteria"]["new"]["pass_criteria"] == (
        "The manager approved it in the ticket first."
    )
    # The second: from the first wording to the second, read from the kept versions.
    assert newest["criteria"]["earlier"]["pass_criteria"] == (
        "The manager approved it in the ticket first."
    )
    assert newest["criteria"]["new"]["pass_criteria"] == (
        "The manager approved it in the ticket, dated."
    )
    assert newest["criteria"]["new"]["condition"] == AGENT_CRITERIA[0]
    assert newest["criteria"]["new"]["judgment_required"] is False
    # A person's own change records no reason: none is shown.
    assert newest["criteria"]["reason"] == ""
    # Each event names the version it kept.
    payloads = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s "
        "AND action = 'control_attribute.criteria_set' ORDER BY occurred_at",
        UUID(attribute["id"]),
    )
    assert [isinstance(row[0]["criteria_version"], int) for row in payloads] == [True, True]


def test_an_agents_change_is_shown_from_its_kept_version_with_its_reason(
    migrated: Database,
) -> None:
    team, control, attribute = _set_up(migrated, "hist-agent")
    _agent_writes(
        migrated,
        attribute["id"],
        (AGENT_CRITERIA[0], "The approval names the role granted.", AGENT_CRITERIA[2]),
        cause="emergency changes",
    )
    rows = [item for item in _criteria_rows(_history(team, control)) if item["by"] == "agent"]
    agent = next(
        row
        for row in rows
        if row["criteria"]["new"]["pass_criteria"] == "The approval names the role granted."
    )
    assert agent["actor"] == PLANNER
    assert agent["criteria"]["earlier"]["pass_criteria"] == AGENT_CRITERIA[1]
    assert agent["criteria"]["reason"] == "Updated from the answer on emergency changes"
    assert agent["detail"].endswith("· Updated from the answer on emergency changes")
    # Newest first across the audit events and the kept versions.
    items = _history(team, control)
    assert [item["at"] for item in items] == sorted((item["at"] for item in items), reverse=True)


def test_an_ended_acceptance_alone_is_not_a_change_of_the_criteria(migrated: Database) -> None:
    team, control, attribute = _set_up(migrated, "hist-reopen")
    before = _criteria_rows(_history(team, control))
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET criteria_accepted_by = %s, "
            "criteria_accepted_at = clock_timestamp() WHERE id = %s",
            (team["owner_id"], UUID(attribute["id"])),
        )
        with connection.cursor() as cursor, writing(cursor, cause="Reopened: emergency changes"):
            cursor.execute(
                "UPDATE control_attributes SET criteria_accepted_by = NULL, "
                "criteria_accepted_at = NULL, version = version + 1 WHERE id = %s",
                (UUID(attribute["id"]),),
            )
        connection.commit()
    kept = _rows(
        migrated,
        "SELECT count(*) FROM attribute_criteria_versions WHERE attribute_id = %s "
        "AND pass_criteria = %s",
        UUID(attribute["id"]),
        AGENT_CRITERIA[1],
    )
    assert kept == [(1,)], "the fixture keeps the accepted criteria as a version"
    assert _criteria_rows(_history(team, control)) == before


def test_an_event_from_before_names_no_version_and_shows_no_comparison(
    migrated: Database,
) -> None:
    """An event written before 20 November 2026 carries an empty payload: the row shows who
    and when without the comparison, and the person's kept version is not shown twice."""
    team, control, attribute = _set_up(migrated, "hist-legacy")
    before = len(_criteria_rows(_history(team, control)))
    with connect(migrated.url) as connection:
        with connection.cursor() as cursor, writing(cursor, by=team["owner_id"], cause=""):
            cursor.execute(
                "UPDATE control_attributes SET pass_criteria = 'An earlier person wording.', "
                "criteria_origin = 'PERSON', version = version + 1 WHERE id = %s",
                (UUID(attribute["id"]),),
            )
        connection.execute(
            "INSERT INTO audit_events (organization_id, project_id, actor_user_id, action, "
            "target_type, target_id, payload) VALUES (%s, %s, %s, "
            "'control_attribute.criteria_set', 'control_attribute', %s, %s)",
            (team["org"], team["project"], team["owner_id"], UUID(attribute["id"]), Jsonb({})),
        )
        connection.commit()
    rows = _criteria_rows(_history(team, control))
    assert len(rows) == before + 1
    legacy = next(row for row in rows if row["by"] == "person")
    assert legacy["criteria"] is None
    assert legacy["actor"] and attribute["text"].split()[0] in legacy["detail"]


def test_another_controls_and_another_engagements_changes_are_never_shown(
    migrated: Database,
) -> None:
    team, control, attribute = _set_up(migrated, "hist-scope")
    other = _control(team, "ITGC-AC-02")["id"]
    other_attribute = _master(team, other)["attributes"][0]
    _agent_writes(migrated, other_attribute["id"], AGENT_CRITERIA)
    _agent_writes(
        migrated,
        other_attribute["id"],
        (AGENT_CRITERIA[0], "Only the other control's wording.", AGENT_CRITERIA[2]),
    )
    mine = _history(team, control)
    assert not any(
        row["criteria"] is not None
        and row["criteria"]["new"]["pass_criteria"] == "Only the other control's wording."
        for row in mine
    )
    assert any(
        row["criteria"] is not None
        and row["criteria"]["new"]["pass_criteria"] == "Only the other control's wording."
        for row in _history(team, other)
    )
    # Another engagement's member cannot read this control's History at all.
    stranger = _launched(migrated, "hist-stranger")
    read = stranger["owner"].get(f"{_project(stranger)}/controls/{control}/activity")
    assert read.status_code == 404
    path = f"/organizations/{team['org']}/projects/{team['project']}/controls/{control}/activity"
    assert stranger["owner"].get(path).status_code in (403, 404)


def test_a_save_of_the_objective_alone_opens_to_no_comparison(migrated: Database) -> None:
    """A person's save that changes only the objective of an agent's criteria still keeps a
    version (the origin becomes the person's), with the same criteria text before and after.
    Its event names that version: the row opens to no comparison, rather than to two
    identical sets of criteria, and the version is not shown again as a row of its own
    (review finding of 20 November 2026)."""
    team, control, attribute = _set_up(migrated, "hist-objective")
    before = len(_criteria_rows(_history(team, control)))
    [version] = _rows(
        migrated, "SELECT version FROM control_attributes WHERE id = %s", UUID(attribute["id"])
    )
    saved = team["owner"].post(
        f"{_project(team)}/controls/{control}/master-plan/attributes/{attribute['id']}/criteria",
        json={
            "version": version[0],
            "objective": "Access is granted only once the user's manager approves it.",
            "condition": AGENT_CRITERIA[0],
            "pass_criteria": AGENT_CRITERIA[1],
            "fail_criteria": AGENT_CRITERIA[2],
            "judgment_required": False,
        },
    )
    assert saved.status_code == 200, saved.text
    [payload] = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s "
        "AND action = 'control_attribute.criteria_set'",
        UUID(attribute["id"]),
    )
    assert isinstance(payload[0]["criteria_version"], int), "the fixture keeps a version"
    rows = _criteria_rows(_history(team, control))
    assert len(rows) == before + 1
    [person] = [row for row in rows if row["by"] == "person"]
    assert person["criteria"] is None
    assert not any(
        row["criteria"] is not None and row["criteria"]["earlier"] == row["criteria"]["new"]
        for row in rows
    )
