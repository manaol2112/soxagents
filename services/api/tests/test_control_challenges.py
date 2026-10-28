"""Common challenges in testing a control: the control workspace's AI assistant (decided by
the product owner on 25 October 2026). The planning agent drafts them on request from the
control's definition; they are labelled as the agent's, never saved, and nothing is drafted
without a model. The control's system environment is read beside it, for its context."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_engagement_close import _launched
from test_execution import _ready
from test_onboarding import _base
from test_outbound import migrated
from test_system_applicability import _Scripted

from ai_workforce_api.control_challenges import challenges, prompt_for
from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _control(database: Database, project: UUID) -> UUID:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
            "ORDER BY control_ref LIMIT 1",
            (project,),
        ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _answer() -> dict[str, Any]:
    return {
        "challenges": [
            {
                "title": "Incomplete access listings",
                "detail": "System listings can omit service accounts; auditors reconcile "
                "them to the identity source.",
            },
            {
                "title": "Approvals outside the tool",
                "detail": "Approvals given by email are hard to evidence; auditors agree "
                "the approver's authority to the policy.",
            },
        ]
    }


def test_the_agent_drafts_challenges_from_the_definition_only(migrated: Database) -> None:
    team = _launched(migrated, "challenges")
    control_id = _control(migrated, team["project"])
    with connect(migrated.url) as connection:
        provider = _Scripted([_answer()])
        result = challenges(
            connection, provider, team["org"], team["project"], control_id, team["owner_id"]
        )
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
        stored = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action LIKE '%%challenge%%'",
            (team["project"],),
        ).fetchone()
    assert result.source == "MODEL"
    assert [item.title for item in result.challenges] == [
        "Incomplete access listings",
        "Approvals outside the tool",
    ]
    assert "nothing here is known about the client" in result.note
    # One model call, recorded as every call is; the challenges themselves are not saved.
    assert calls == (1,) and stored == (0,)
    prompt = provider.requests[0].prompt
    assert prompt.startswith("The control:") and "SAP ERP" in prompt
    assert provider.requests[0].web_search == 0


def test_without_a_model_or_a_usable_answer_nothing_is_drafted(migrated: Database) -> None:
    team = _launched(migrated, "challenges-none")
    control_id = _control(migrated, team["project"])
    with connect(migrated.url) as connection:
        none = challenges(
            connection, None, team["org"], team["project"], control_id, team["owner_id"]
        )
        bad = challenges(
            connection, _Scripted([{"challenges": "not a list"}]), team["org"],
            team["project"], control_id, team["owner_id"],
        )  # fmt: skip
    assert (none.source, none.challenges) == ("NONE", [])
    assert none.note.startswith("No model is configured")
    assert (bad.source, bad.challenges) == ("NONE", [])


def test_only_the_engagement_reads_its_challenges(migrated: Database) -> None:
    team = _launched(migrated, "challenges-access")
    control_id = _control(migrated, team["project"])
    path = (
        f"/organizations/{team['org']}/projects/{team['project']}/controls/{control_id}/challenges"
    )
    answer = team["owner"].post(path)
    # The test settings have no model: an answer, with nothing drafted.
    assert answer.status_code == 200, answer.text
    assert answer.json()["source"] == "NONE"
    _other, _project, stranger = _ready(migrated, "challenges-stranger")
    assert stranger.post(path).status_code == 404
    missing = (
        f"/organizations/{team['org']}/projects/{team['project']}/controls/{uuid4()}/challenges"
    )
    assert team["owner"].post(missing).status_code == 404


def test_the_prompt_holds_the_definition_and_skips_what_is_empty() -> None:
    prompt = prompt_for({"reference": "ITGC-AC-01", "title": "Access", "system": ""})
    assert prompt == "The control:\nreference: ITGC-AC-01\ntitle: Access"


def test_a_control_row_carries_its_system_environment(migrated: Database) -> None:
    team = _launched(migrated, "environment")
    owner, base = team["owner"], _base(team["org"], team["project"])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_applications SET environment = 'PRODUCTION' WHERE project_id = %s",
            (team["project"],),
        )
        connection.commit()
    del base
    rows = owner.get(f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls")
    assert rows.status_code == 200, rows.text
    body = rows.json()
    controls = body["controls"] if isinstance(body, dict) else body
    with_system = [row for row in controls if row["application_name"] == "SAP ERP"]
    assert with_system and all(
        row["application_environment"] == "PRODUCTION" for row in with_system
    )
