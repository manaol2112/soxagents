"""criteria-history (20 November 2026): a change of an attribute's criteria in the History.

ITGC-AC-04's understanding is completed as attributes_review builds it, so its Attributes step
lists the attributes. Its first attribute's criteria then change four times, as
tests/test_criteria_history_activity.py builds each change: the planner writes them (no audit
event), writes them again from an answer (a recorded reason), and a person saves them twice
over the API (each event naming its kept version), the last with long criteria. The second
attribute carries an old event: a person's change written before 20 November 2026, whose
event names no version, so its History row shows without a comparison. Synthetic data only.
"""

from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb
from test_attributes_follow_understanding import _answer_required
from test_criteria_history_activity import AGENT_CRITERIA, _agent_writes
from test_evidence_plans import _control
from test_understanding_once import _completed_now
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api.criteria_history import writing
from ai_workforce_api.db import connect

CONTROL = "ITGC-AC-04"

FROM_ANSWER = (
    AGENT_CRITERIA[0],
    "The user's manager approved the request, and the approval names the role granted.",
    AGENT_CRITERIA[2],
)
PERSON_FIRST = "The manager approved the request in the ticket before the access was granted."
LONG = (
    "For each sampled grant in the system log, the access request in the ticketing tool names "
    "the same user, the same role, the same company codes and the same organisational units "
    "as the grant, including any emergency elevation granted at quarter end",
    "The user's line manager approved the request in the ticket, the approval is dated on or "
    "before the grant, and where the policy requires it the application owner approved it "
    "as well, in the same ticket, before the administrator made the change in the system",
    "No approval is recorded; the approval is dated after the grant; the approver is the user "
    "or the administrator who made the grant; or the access granted is wider than the access "
    "the request approved",
)


def _version(url: str, attribute: str) -> int:
    with connect(url) as connection:
        row = connection.execute(
            "SELECT version FROM control_attributes WHERE id = %s", (UUID(attribute),)
        ).fetchone()
    assert row is not None
    return int(row[0])


def _save(seed: Any, control: str, attribute: str, criteria: tuple[str, str, str]) -> None:
    saved = seed.client.post(
        f"{seed.base()}/controls/{control}/master-plan/attributes/{attribute}/criteria",
        json={
            "version": _version(seed.database.url, attribute),
            "condition": criteria[0],
            "pass_criteria": criteria[1],
            "fail_criteria": criteria[2],
            "judgment_required": False,
        },
    )
    assert saved.status_code == 200, saved.text


def _old_event(seed: Any, attribute: str) -> None:
    """A person's change from before 20 November 2026: its audit event names no version."""
    team = seed.team
    with connect(seed.database.url) as connection:
        with connection.cursor() as cursor, writing(cursor, by=team["owner_id"], cause=""):
            cursor.execute(
                "UPDATE control_attributes SET pass_criteria = %s, criteria_origin = 'PERSON', "
                "version = version + 1 WHERE id = %s",
                ("The request is approved by the user's manager.", UUID(attribute)),
            )
        connection.execute(
            "INSERT INTO audit_events (organization_id, project_id, actor_user_id, action, "
            "target_type, target_id, payload) VALUES (%s, %s, %s, "
            "'control_attribute.criteria_set', 'control_attribute', %s, %s)",
            (team["org"], team["project"], team["owner_id"], UUID(attribute), Jsonb({})),
        )
        connection.commit()


def build(seed: Any) -> None:
    control = _control(seed.database, seed.team, CONTROL)
    _values_and_questions_answered(seed.database, seed.team, control)
    _answer_required(seed.database, seed.team, control, seed.client)
    _completed_now(seed.database, control)
    read = seed.client.get(f"{seed.base()}/controls/{control}/master-plan")
    assert read.status_code == 200, read.text
    attributes = read.json()["attributes"]
    assert len(attributes) >= 2, f"{CONTROL} has {len(attributes)} attributes"
    first, second = attributes[0]["id"], attributes[1]["id"]

    _old_event(seed, second)
    _agent_writes(seed.database, first, AGENT_CRITERIA)
    _agent_writes(seed.database, first, FROM_ANSWER, cause="emergency changes")
    _save(seed, control, first, (FROM_ANSWER[0], PERSON_FIRST, FROM_ANSWER[2]))
    _save(seed, control, first, LONG)

    history = seed.client.get(f"{seed.base()}/controls/{control}/activity")
    assert history.status_code == 200, history.text
    rows = [item for item in history.json() if item["title"] == "Test criteria updated"]
    opened = [row for row in rows if row["criteria"] is not None]
    plain = [row for row in rows if row["criteria"] is None and row["by"] == "person"]
    assert len(opened) >= 3 and plain, rows
    assert opened[0]["criteria"]["new"]["pass_criteria"] == LONG[1], opened[0]
    seed.add(
        "criteria-history-attributes",
        seed.href(section="controls", control=control, step="attributes"),
        control=CONTROL,
        attribute=first,
    )
    seed.add(
        "criteria-history",
        seed.href(section="controls", control=control, step="activity"),
        control=CONTROL,
        attribute=first,
        changes=len(rows),
        with_comparison=len(opened),
        without_comparison=len(plain),
        reason="Updated from the answer on emergency changes",
    )
