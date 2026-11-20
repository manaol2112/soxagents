"""Model-contract cells whose fail-closed state is stored (docs/audit-invariants.md, I10;
services/api/tests/test_model_contract.py holds the registry). Each runs on its own database.

Most stored cells are already held by a critical-tier test, which the registry names instead
of a second copy here (test_evidence_corpus for the mapping's failed calls,
test_evidence_analysis for the reader's rejected answer, test_agent_execution for the
tester's provider error, test_evidence_plans and test_agent_answers for the planner,
test_console for the console's unregistered and CONFIRM tools). The cells of the attribute
agent, the drafts reviewer and the set reviewer are open (FO-4, FO-3, SOL-4) and land with
SOL attributes.
"""

from typing import Any
from uuid import UUID

from hostile_model import Repeat, Replay
from support import Database
from test_evidence_center import _ready
from test_outbound import migrated
from test_policy_evidence import ACCESS, _item, _read, _run, _upload, _verdicts

from ai_workforce_api.db import connect
from ai_workforce_api.policy_evidence import unread_pairs

__all__ = ["migrated"]


def _proposed(team: dict[str, Any], item: dict[str, Any]) -> list[str]:
    return [
        str(p["document_id"])
        for p in _read(team, item["control"])["proposals"]
        if p["requirement_id"] == str(item["id"])
    ]


def _statuses(database: Database, project: UUID) -> set[str]:
    with connect(database.url) as connection:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT status FROM model_calls WHERE project_id = %s", (project,)
            ).fetchall()
        }


def test_an_empty_policy_answer_proposes_nothing(migrated: Database) -> None:
    """Row 14, EMPTY: an answer that judges no document proposes nothing and leaves every
    pair unread, so the next run reads it again; it never reads as "nothing fits"."""
    team = _ready(migrated, "mc-pe-empty")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    empty = Replay([{"documents": []}], then=Repeat())
    assert _run(migrated, team["project"], empty) == "DONE"
    # The hostile answer reached the check: the calls succeeded, and fit the schema.
    assert empty.requests and _statuses(migrated, team["project"]) == {"SUCCEEDED"}
    assert _proposed(team, item) == []
    with connect(migrated.url) as connection:
        assert (item["id"], UUID(access)) in unread_pairs(connection, team["project"])
        connection.execute(
            "UPDATE policy_evidence_runs SET run_status = 'PENDING' WHERE project_id = %s",
            (team["project"],),
        )
        connection.commit()
    # The paired control: the same pair read again, judged and quoted, is proposed.
    careful = Replay(
        [_verdicts([("D1", True, "It sets that the Application Owner approves access before "
                     "it is granted.", "granted only after the Application Owner approves the "
                     "request")])],
        then=Repeat(),
    )  # fmt: skip
    assert _run(migrated, team["project"], careful) == "DONE"
    assert _proposed(team, item) == [access]
