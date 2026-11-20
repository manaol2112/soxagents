"""The understanding is asked once; after it, the agents never send the person back
(docs/control-workflow-plan.md, B1j; agreed by the product owner on 16 November 2026 after a
prototype, on ITGC-CM-06: "This is so annoying. Keeps going back and forth to the control
understanding and attributes ... This could be a never ending loop", and "On the attribute"
for a gap an agent finds once the understanding is finished).

One pass: the attribute agent's first run checks what else it needs and stops before the
criteria while its questions are open. Complete once: answered, the understanding is
completed, recorded once and never reopened by an agent. A later gap is an assumption on the
attribute: That's right, or Change... with one update limited to the attributes it names,
and accepted with the attribute when a person accepts it. Asked once, in code. No narrative
for an ITGC. Every change to the criteria keeps the earlier version; rewording carries the
criteria. The pure rules are in test_understanding_once_rules.py."""

import json
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from hostile_model import no_answer
from support import Database, run_plan_through
from test_attributes_follow_understanding import (
    _GRANT_RECORD,
    ADDED,
    _Agents,
    _answer_required,
    _approved,
    _criteria,
    _path,
    _plan_run,
    _proposals,
    _ready,
    _volume,
)
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _rows
from test_projects import _edit

from ai_workforce_api import (
    attribute_assumptions,
    control_attributes,
    process_narrative,
    understanding_review,
)
from ai_workforce_api.attribute_assumptions import DECIDED, STALE, drafted
from ai_workforce_api.context_routes import NO_NARRATIVE, _classes, generate_reviewed
from ai_workforce_api.control_context import (
    QUESTIONS_CLOSED_NOTE,
    Issue,
    context_package,
    raise_issues,
)
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_plans import ATTRIBUTES_UPDATING, _write_criteria
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.pbc_drafting import load_context
from ai_workforce_api.phase_release import attribute_waits, understanding_waits
from ai_workforce_api.understanding_authority import facts
from ai_workforce_api.understanding_review import opens_follow_up

__all__ = ["migrated"]

GRANT_ANSWER = "The ServiceNow ticket records the role granted and who granted it."
LINKAGE = "Patch linkage"
LINKED_BY_DATE = "A patch is linked to its change record by date."
LINKED_BY_HOST = "A patch is linked to its change record by its patch identifier and host."


class _Assuming(_Agents):
    """The run's agents, the attribute agent also stating what it assumed (B1j)."""

    def __init__(self, database: Database, team: dict[str, Any], control: str) -> None:
        super().__init__(database, team, control)
        self.assumed: list[dict[str, Any]] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        if request.system == control_attributes.SYSTEM_PROMPT:
            self.prompts.append(request.prompt)
            self._note("attributes")
            return ModelRaw(
                {"attributes": self.proposals, "issues": self.issues, "assumptions": self.assumed},
                (), 100, 100,
            )  # fmt: skip
        return super().complete(request, config)


def _asking(
    given: dict[str, Any], topic: str, fact: str = "RECORD", text: str = "",
    follow_ups: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:  # fmt: skip
    """The IT audit specialist's answer (B1k): one unit not established, with one question on
    `topic`; every other unit established.

    The unit is the first whose criteria need `fact` and that the walkthrough leaves open on
    it: no answer of that kind of fact stands there, or one that opens a follow-up does
    (else the first unit). Changed 18 November 2026: a question on a fact its attribute's
    criteria do not need is assumed, and one a standing walkthrough answer settles is not
    asked (product owner, ITGC-AC-03). Old: always the first unit, which on ITGC-AC-01
    (ac01-request, everything met elsewhere) is now assumed, not asked."""
    units = [str(unit["key"]) for unit in given["units"]]

    def open_on(item: dict[str, Any]) -> bool:
        answers = [q["answer"] for q in item["questions"] if q["fact"] == fact and q["answer"]]
        return not answers or any(opens_follow_up("CHOICE", answer) for answer in answers)

    at = next(
        (
            index
            for index, unit in enumerate(units)
            for item in given.get("attributes", [])
            if item["unit"] == unit and fact in item["needs"] and open_on(item)
        ),
        0,
    )
    answer = understanding_review.established(
        given,
        f"The questions answered establish how the control runs. They do not yet establish "
        f"{topic.lower()}, on which {units[at]} depends. This is asked now.",
    )
    answer["marked"] = [topic.lower()]
    answer["verdicts"][at] = {
        "attribute": units[at],
        "verdict": "NOT_ESTABLISHED",
        "rests_on": [],
        "question": {
            "topic": topic,
            "text": text or f"{topic}?",
            "fact": fact,
            "blocks": f"The criteria of {units[at]} cannot name the record without it.",
            "suggested": "The ServiceNow ticket records it.",
            "options": ["The ServiceNow ticket records it.", "A spreadsheet records it."],
        },
    }
    answer["follow_ups"] = follow_ups or []
    return answer


def _left_open(team: dict[str, Any], control: str, client: TestClient, key: str, text: str) -> None:
    """A walkthrough answer in the person's own words ("Other: ..."), which leaves its fact
    open for the specialist's follow-up (18 November 2026: an answer from the options settles
    it, and the review never asks it again)."""
    saved = client.put(
        f"{_path(team, control)}/walkthrough-answers",
        json={"answers": {key: {"value": f"Other: {text}", "not_applicable": False}}},
    )
    assert saved.status_code == 200, saved.text


def _context(team: dict[str, Any], control: str, client: TestClient | None = None) -> Any:
    read = (client or team["owner"]).get(f"{_path(team, control)}/context")
    assert read.status_code == 200, read.text
    return read.json()


def _package_of(prompt: str) -> Any:
    """The control context the attribute agent was given."""
    return json.loads(prompt.split("<control_context>\n", 1)[1].split("\n</control_context>")[0])


def _attribute_prompts(agents: _Agents) -> list[str]:
    return [prompt for prompt in agents.prompts if "Propose test attributes" in prompt]


def _codes(migrated: Database, control: str) -> list[tuple[UUID, str, str]]:
    return [
        (UUID(str(row[0])), str(row[1]), str(row[2]))
        for row in _rows(
            migrated,
            "SELECT id, code, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            UUID(control),
        )
    ]


def _completed_now(migrated: Database, control: str) -> None:
    """The control's understanding completed, once (as complete() records it once its
    question pass ran and nothing is open), with no run at work."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'IDLE', run_stage = '', "
            "run_lease_until = NULL WHERE engagement_control_id = %s",
            (UUID(control),),
        )
        connection.execute(
            "UPDATE engagement_controls SET understanding_completed_at = clock_timestamp() "
            "WHERE id = %s AND understanding_completed_at IS NULL",
            (UUID(control),),
        )
        connection.commit()


def _assume(
    migrated: Database, team: dict[str, Any], control: str, matter: str, assumed: str,
    codes: list[str],
) -> UUID:  # fmt: skip
    with connect(migrated.url) as connection:
        with connection.transaction():
            recorded = attribute_assumptions.record(
                connection.cursor(), team["org"], team["project"], UUID(control),
                [drafted("AMBIGUOUS", matter, assumed, codes)], "engagement-planner", None,
            )  # fmt: skip
        assert recorded == 1
        row = connection.execute(
            "SELECT id FROM attribute_assumptions WHERE engagement_control_id = %s AND matter = %s",
            (UUID(control), matter),
        ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _assumptions(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT matter, assumed, attribute_codes, status, answer, decided_by, model_call_id, "
        "raised_by_agent FROM attribute_assumptions WHERE engagement_control_id = %s "
        "ORDER BY created_at",
        UUID(control),
    )


def _open_issues(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, topic, origin, raised_by, version FROM control_context_issues "
        "WHERE engagement_control_id = %s AND status = 'OPEN' ORDER BY created_at",
        UUID(control),
    )


def _completed_at(migrated: Database, control: str) -> Any:
    return _rows(
        migrated,
        "SELECT understanding_completed_at FROM engagement_controls WHERE id = %s",
        UUID(control),
    )[0][0]


# One pass, complete once


def test_the_question_pass_asks_in_one_go_and_the_understanding_then_stays_completed(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "uo-pass")
    body = _context(team, control, client)
    assert (body["question_pass"], body["understanding_completed_at"]) == ("WAITING", None)
    _answer_required(migrated, team, control, client)
    # Re-based 18 November 2026 (product owner, "Yes/No always settles"). Old: the
    # walkthrough's "No" to wt-ac-change-logging (RECORD on ac01-before) left the grant
    # record open, so the specialist's RECORD question was asked as its follow-up. New: a
    # "No" settles it (about 10 of the bank's 47 Yes/No questions have No as the good
    # answer, and "No opens" asked again what the answer had settled); the record is left
    # open by the source of dates answered in the person's own words, which still opens
    # one. What this test is about is unchanged.
    _left_open(team, control, client, "wt-ac-change-logging-gap", "the HR system's audit trail")
    plan_id, status, stage = _plan_run(migrated, control)
    assert (status, stage) == ("PENDING", "ATTRIBUTES") and scheduler.plans == [plan_id]
    assert _context(team, control, client)["question_pass"] == "CHECKING"
    # Rewritten for B1k (16 November 2026: the question pass is the IT audit specialist's
    # review of the questions asked, and the attribute agent never asks before completion).
    # Old expectation: the attribute agent's ATTRIBUTES stage asked one question and the run
    # stopped there (questions_checked_at recorded). New: the specialist asks it, before any
    # attribute is drafted: no attribute agent, planner or set reviewer runs, and the
    # attribute agent's own question is never raised.
    agents = _Agents(migrated, team, control)
    agents.issues = [_GRANT_RECORD]
    agents.specialist = lambda given: _asking(given, _GRANT_RECORD["topic"])
    agents.other = no_answer  # the interview writer's failure path: questions kept
    with connect(migrated.url) as connection:
        assert run_plan_through(connection, agents, plan_id) == "DONE"
    assert [who for who in agents.calls if who != "other"] == []
    assert len(agents.specialist_given) == 1
    assert all(row[2] is None for row in _approved(migrated, control)), "no criteria tailored"
    [question] = _open_issues(migrated, control)
    assert (question[1], question[2], question[3]) == (
        _GRANT_RECORD["topic"],
        "ATTRIBUTES",
        "AGENT",
    )
    assert _rows(migrated, "SELECT run_status, run_stage FROM evidence_plans WHERE id = %s",
                 plan_id) == [("IDLE", "")]  # fmt: skip
    body = _context(team, control, client)
    assert (body["question_pass"], body["understanding_completed_at"]) == ("DONE", None)
    assert body["review"]["status"] == "READY" and body["review"]["open_questions"] == 1
    [asked] = [item for item in body["issues"] if item["status"] == "OPEN"]
    assert (asked["from_review"], asked["review_round"], asked["asks"]["fact"]) == (
        True, 1, "RECORD",
    )  # fmt: skip
    # The answer starts the one follow-up read (old: it completed the understanding at once).
    answered = client.post(
        f"{_path(team, control)}/issues/{question[0]}/resolve",
        json={"status": "RESOLVED", "note": GRANT_ANSWER, "version": question[4]},
    )
    assert answered.status_code == 200, answered.text
    assert answered.json()["understanding_completed_at"] is None
    assert answered.json()["question_pass"] == "CHECKING"
    assert scheduler.plans == [plan_id, plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    with connect(migrated.url) as connection:
        assert understanding_waits(connection, team["project"], UUID(control)) == {}
    # The run that follows: the agent finds another gap and states what it assumed. Nothing
    # is asked; the criteria are tailored and the set is reviewed.
    a1 = _codes(migrated, control)[0]
    followed = _Assuming(migrated, team, control)
    followed.issues = [
        {"kind": "AMBIGUOUS", "topic": "Approver of an emergency grant",
         "detail": "Who approves an emergency grant is not stated.",
         "why": "The approver is tested."},
    ]  # fmt: skip
    followed.assumed = [
        {"kind": "MISSING", "matter": "Grant date record",
         "assumed": "The ServiceNow ticket history shows when access was granted.",
         "attribute_codes": [a1[1]]},
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan_through(connection, followed, plan_id) == "DONE"
    # The follow-up read (round 2) finds everything established: the understanding is
    # completed, once, in the run, and the attributes follow it in the same run.
    [second] = followed.specialist_given
    assert second["round"] == 2 and [item["answer"] for item in second["round_one_questions"]] == [
        GRANT_ANSWER
    ]
    completed = _context(team, control, client)["understanding_completed_at"]
    assert completed is not None
    assert [who for who in followed.calls if who != "other"] == [
        "attributes", "planner", "set-review",
    ]  # fmt: skip
    told = _package_of(_attribute_prompts(followed)[0])
    assert told["understanding_completed"] is True and "only_attributes" not in told
    assert _open_issues(migrated, control) == []
    call = _rows(
        migrated,
        "SELECT id FROM model_calls WHERE target_id = %s AND prompt_version = %s "
        "ORDER BY created_at DESC LIMIT 1",
        UUID(control),
        control_attributes.PROMPT_VERSION,
    )[0][0]
    assert _assumptions(migrated, control) == [
        ("Grant date record", "The ServiceNow ticket history shows when access was granted.",
         [a1[1]], "OPEN", "", None, call, "engagement-planner"),
        ("Approver of an emergency grant", "Who approves an emergency grant is not stated.",
         [], "OPEN", "", None, call, "engagement-planner"),
    ]  # fmt: skip
    body = _context(team, control, client)
    assert body["understanding_completed_at"] == completed
    assert [item["matter"] for item in body["set_assumptions"]] == [
        "Approver of an emergency grant"
    ]
    on_a1 = next(item for item in body["attributes"]["approved"] if item["id"] == str(a1[0]))
    [assumption] = on_a1["assumptions"]
    assert (assumption["status"], assumption["decided_by"], assumption["version"]) == (
        "OPEN", None, 1,
    )  # fmt: skip
    # The criteria the run wrote say what they follow: the answer given since the plan was
    # last generated.
    assert all(row[2] == "AGENT" for row in _approved(migrated, control))
    assert on_a1["criteria_updated_from"] == _GRANT_RECORD["topic"]
    # The Attributes step never waits on the understanding again.
    with connect(migrated.url) as connection:
        wait = attribute_waits(connection, team["project"], UUID(control)).get(UUID(control), "")
    assert "question" not in wait
    # A person may still change an answer: the completion stays as it was recorded.
    _volume(team, control, client, "25 to 100")
    assert _context(team, control, client)["understanding_completed_at"] == completed
    # Never cleared, never moved.
    with connect(migrated.url) as connection:
        for value in ("NULL", "clock_timestamp()"):
            with pytest.raises(psycopg.errors.RaiseException, match="never reopened"):
                connection.execute(
                    f"UPDATE engagement_controls SET understanding_completed_at = {value} "
                    "WHERE id = %s",
                    (UUID(control),),
                )
            connection.rollback()


def test_after_completion_an_agents_finding_is_an_assumption_never_an_open_question(
    migrated: Database,
) -> None:
    team, control, _scheduler, _client = _ready(migrated, "uo-later")
    _completed_now(migrated, control)
    a1 = _codes(migrated, control)[0][1]
    org, project = team["org"], team["project"]
    point = process_narrative._Question(
        topic="Patch history review", question="Who reviews the patch history?",
        proposal="The change manager reviews the patch history.", attributes=[a1, "A99"],
    )  # fmt: skip
    with connect(migrated.url) as connection:
        with connection.transaction():
            cursor = connection.cursor()
            # Any agent's question (the process map's, the prior year's): the agent's
            # assumption on the set, nothing raised.
            assert raise_issues(
                cursor, org, project, UUID(control),
                [Issue("ATTRIBUTES", "MISSING", "Who applies patches", "Not named.", "", "",
                       proposal="Server administrators apply patches to production.")],
                "AGENT",
            ) == 0  # fmt: skip
            # The narrative's points: on the attributes they serve.
            process_narrative._ask(cursor, org, project, UUID(control), [point], 1, [a1])
            # The attribute agent's late points: nothing goes to the narrative.
            assert process_narrative.raise_late_points(
                cursor, org, project, UUID(control),
                [("Emergency patches", "How is an emergency patch approved?",
                  "An emergency patch is approved after it is applied.", "TYPICAL", "")],
            ) == 0  # fmt: skip
            # The rules still raise theirs.
            assert raise_issues(
                cursor, org, project, UUID(control),
                [Issue("SOURCES", "CONFLICT", "Frequency",
                       "The RCM says monthly; the policy says weekly.", "", "")],
                "RULES",
            ) == 1  # fmt: skip
    assert [(row[1], row[3]) for row in _open_issues(migrated, control)] == [("Frequency", "RULES")]
    assert [row[:4] + row[7:] for row in _assumptions(migrated, control)] == [
        ("Who applies patches", "Server administrators apply patches to production.", [],
         "OPEN", "agent"),
        ("Patch history review", "The change manager reviews the patch history.", [a1],
         "OPEN", "process-narrative"),
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        # The rules' question shows in Control Understanding and holds the D&I release as
        # before; it does not put the Attributes step back to waiting.
        assert "1 question is open" in understanding_waits(connection, project, UUID(control)).get(
            UUID(control), ""
        )
        wait = attribute_waits(connection, project, UUID(control)).get(UUID(control), "")
        assert "question" not in wait


# That's right, Change..., and accepted with the attribute


def test_thats_right_and_change_and_the_one_update_limited_to_the_named_attributes(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "uo-change")
    _completed_now(migrated, control)
    (a1_id, a1, a1_text), (a2_id, a2, a2_text) = _codes(migrated, control)[:2]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', condition = 'Before c.', "
            "pass_criteria = 'Before p.', fail_criteria = 'Before f.' WHERE id = ANY(%s)",
            ([a1_id, a2_id],),
        )
        connection.commit()
    confirmed_id = _assume(migrated, team, control, "Grant record", "The ticket shows it.", [a2])
    changed_id = _assume(migrated, team, control, LINKAGE, LINKED_BY_DATE, [a1])
    base = f"{_path(team, control)}/assumptions"
    # That's right: at the version seen, once.
    stale = client.post(f"{base}/{confirmed_id}/confirm", json={"version": 2})
    assert (stale.status_code, stale.json()["detail"]) == (409, STALE)
    right = client.post(f"{base}/{confirmed_id}/confirm", json={"version": 1})
    assert right.status_code == 200, right.text
    on_a2 = next(i for i in right.json()["attributes"]["approved"] if i["id"] == str(a2_id))
    [mark] = on_a2["assumptions"]
    assert (mark["status"], mark["decided_by"]["id"], mark["version"]) == (
        "CONFIRMED", str(team["owner_id"]), 2,
    )  # fmt: skip
    again = client.post(f"{base}/{confirmed_id}/confirm", json={"version": 2})
    assert (again.status_code, again.json()["detail"]) == (409, DECIDED)
    # A confirmation changes nothing the attributes rest on: no attribute update is queued.
    assert _plan_run(migrated, control)[2] == ""
    # Change...: the person's own words, 10 to 1,000 characters, never while the agents
    # update the attributes.
    short = client.post(f"{base}/{changed_id}/change", json={"text": "By host.", "version": 1})
    assert short.status_code == 422
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_stage = 'ATTRIBUTES' "
            "WHERE engagement_control_id = %s",
            (UUID(control),),
        )
        connection.commit()
    busy = client.post(f"{base}/{changed_id}/change", json={"text": LINKED_BY_HOST, "version": 1})
    assert (busy.status_code, busy.json()["detail"]) == (409, ATTRIBUTES_UPDATING)
    _completed_now(migrated, control)
    handed = len(scheduler.plans)
    changed = client.post(
        f"{base}/{changed_id}/change", json={"text": LINKED_BY_HOST, "version": 1}
    )
    assert changed.status_code == 200, changed.text
    on_a1 = next(i for i in changed.json()["attributes"]["approved"] if i["id"] == str(a1_id))
    assert [(m["status"], m["answer"]) for m in on_a1["assumptions"]] == [
        ("CHANGED", LINKED_BY_HOST)
    ]
    # Both are the person's facts of the understanding now, newest first.
    with connect(migrated.url) as connection:
        understood = facts(connection, UUID(control))
    mine = [(f.question, f.answer, f.confirmed_by) for f in understood if f.key in (
        str(confirmed_id), str(changed_id))]  # fmt: skip
    assert mine == [
        (LINKAGE, LINKED_BY_HOST, "PERSON"),
        ("Grant record", "The ticket shows it.", "PERSON"),
    ]
    # One update, limited to the attribute the assumption names, following it.
    plan_id = _plan_run(migrated, control)[0]
    assert scheduler.plans[handed:] == [plan_id]
    assert _rows(
        migrated,
        "SELECT run_status, run_stage, run_codes, run_cause FROM evidence_plans WHERE id = %s",
        plan_id,
    ) == [("PENDING", "ATTRIBUTES", [a1], LINKAGE)]
    agents = _Agents(migrated, team, control)
    agents.proposals = [
        {"action": "CHANGE", "replaces": str(a2_id), "text": a2_text + " in ServiceNow",
         "basis": "INFERRED", "source": "", "quote": "", "note": "", "condition": "c",
         "pass_criteria": "p", "fail_criteria": "f", "judgment_required": False},
        {"action": "ADD", "replaces": "", "text": ADDED, "basis": "INFERRED", "source": "",
         "quote": "", "note": "", "condition": "", "pass_criteria": "", "fail_criteria": "",
         "judgment_required": False},
    ]  # fmt: skip
    agents.review = lambda given: {
        "attributes": [
            {"id": str(a2_id), "verdict": "REVISED", "note": "Name the system.",
             "condition": "The ServiceNow request names the role.",
             "pass_criteria": "The ServiceNow request names the role granted.",
             "fail_criteria": "The ServiceNow request names no role."},
        ],
        "findings": [],
    }  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan_through(connection, agents, plan_id) == "DONE"
    told = _package_of(_attribute_prompts(agents)[0])
    assert told["only_attributes"] == [a1] and told["understanding_completed"] is True
    # Nothing for another attribute: no proposal, and its criteria as they were.
    assert _proposals(migrated, control) == []
    after = {row[0]: row for row in _approved(migrated, control)}
    assert after[a2_id][2:6] == ("AGENT", "Before c.", "Before p.", "Before f.")
    planned = _criteria(a1_text)
    assert after[a1_id][3:6] == (
        planned["condition"], planned["pass_criteria"], planned["fail_criteria"],
    )  # fmt: skip
    assert _rows(
        migrated,
        "SELECT criteria_cause, criteria_writer FROM control_attributes WHERE id = %s",
        a1_id,
    ) == [(LINKAGE, "Planner agent")]
    assert _rows(
        migrated, "SELECT run_codes, run_cause FROM evidence_plans WHERE id = %s", plan_id
    ) == [([], "")]
    proposed = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'attribute.proposed' "
        "ORDER BY created_at DESC LIMIT 1",
        UUID(control),
    )[0][0]
    assert (proposed["only_attributes"], proposed["other_attributes_left_out"]) == ([a1], 2)
    # The earlier criteria are kept, and the attribute says what changed them.
    body = _context(team, control, client)
    on_a1 = next(i for i in body["attributes"]["approved"] if i["id"] == str(a1_id))
    assert (on_a1["criteria_updated_from"], on_a1["criteria_versions"]) == (LINKAGE, 1)
    history = client.get(f"{_path(team, control)}/attributes/{a1_id}/criteria-history")
    assert history.status_code == 200, history.text
    [earlier] = history.json()["versions"]
    assert (earlier["version"], earlier["condition"], earlier["origin"], earlier["cause"]) == (
        1, "Before c.", "AGENT", "",
    )  # fmt: skip
    assert earlier["written_by"] == {"kind": "AGENT", "name": ""}
    # And the database refuses a write to another attribute's criteria while a run may
    # change only the named ones.
    with connect(migrated.url) as connection:
        connection.execute("SELECT set_config('app.criteria_only', %s, false)", (a1,))
        with pytest.raises(psycopg.errors.RaiseException, match="attributes it names"):
            connection.execute(
                "UPDATE control_attributes SET condition = 'Other.' WHERE id = %s", (a2_id,)
            )
        connection.rollback()


def test_accepting_an_attribute_accepts_its_open_assumptions_never_as_an_answer(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uo-accept")
    _completed_now(migrated, control)
    codes = _codes(migrated, control)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', condition = 'c.', "
            "pass_criteria = 'p.', fail_criteria = 'f.' WHERE engagement_control_id = %s "
            "AND status = 'APPROVED'",
            (UUID(control),),
        )
        connection.commit()
    on_a1 = _assume(migrated, team, control, LINKAGE, LINKED_BY_DATE, [codes[0][1]])
    on_set = _assume(migrated, team, control, "Emergency patches", "Approved after.", [])
    body = _context(team, control, client)["attributes"]
    versions = {item["id"]: item["version"] for item in body["approved"]}
    first = client.post(
        f"{_path(team, control)}/attributes/accept",
        json={"items": [{"attribute_id": str(codes[0][0]), "version": versions[str(codes[0][0])]}]},
    )
    assert first.status_code == 200, first.text
    status = dict(
        (row[0], row[1:])
        for row in _rows(
            migrated,
            "SELECT id, status, decided_by, answer FROM attribute_assumptions "
            "WHERE engagement_control_id = %s",
            UUID(control),
        )
    )
    assert status[on_a1] == ("ACCEPTED_WITH_ATTRIBUTE", team["owner_id"], "")
    # The set's assumption waits until the set is accepted.
    assert status[on_set] == ("OPEN", None, "")
    rest = [
        {"attribute_id": item["id"], "version": item["version"]}
        for item in _context(team, control, client)["attributes"]["approved"]
        if not item["criteria_owned"]
    ]
    assert (
        client.post(f"{_path(team, control)}/attributes/accept", json={"items": rest}).status_code
        == 200
    )
    assert _rows(migrated, "SELECT status FROM attribute_assumptions WHERE id = %s", on_set) == [
        ("ACCEPTED_WITH_ATTRIBUTE",)
    ]
    # Accepted with the attribute is never a person's answer: not a fact of the
    # understanding.
    with connect(migrated.url) as connection:
        assert not [
            f for f in facts(connection, UUID(control)) if f.key in (str(on_a1), str(on_set))
        ]
    # Rewritten for B1l point 6 (16 November 2026: an assumption accepted with its
    # attribute, not confirmed, is a point of the D&I workpaper, "confirmed there, changed
    # there, or considered with a reason"). Old expectation: once accepted it could no longer
    # be confirmed (409, DECIDED). New: it is confirmed once more, at its version, keeping
    # who had accepted it; after that it is decided.
    stale = client.post(f"{_path(team, control)}/assumptions/{on_a1}/confirm", json={"version": 1})
    assert (stale.status_code, stale.json()["detail"]) == (409, STALE)
    settled = client.post(
        f"{_path(team, control)}/assumptions/{on_a1}/confirm", json={"version": 2}
    )
    assert settled.status_code == 200, settled.text
    assert _rows(
        migrated,
        "SELECT status, decided_by, accepted_by, accepted_at IS NOT NULL, version "
        "FROM attribute_assumptions WHERE id = %s",
        on_a1,
    ) == [("CONFIRMED", team["owner_id"], team["owner_id"], True, 3)]
    refused = client.post(
        f"{_path(team, control)}/assumptions/{on_a1}/confirm", json={"version": 3}
    )
    assert (refused.status_code, refused.json()["detail"]) == (409, DECIDED)


# Asked once


def test_a_matter_is_asked_once_superseded_closed_by_acceptance_or_reworded(
    migrated: Database,
) -> None:
    team, control, _scheduler, _client = _ready(migrated, "uo-once")
    org, project = team["org"], team["project"]
    record = Issue("ATTRIBUTES", "MISSING", "Record of the grant date", "Not named.", "", "")
    with connect(migrated.url) as connection:
        with connection.transaction():
            cursor = connection.cursor()
            assert raise_issues(cursor, org, project, UUID(control), [record], "AGENT") == 1
            # Superseded (by a run before B1j, or a redraft): never raised again, nor in
            # other words that read the same.
            cursor.execute(
                "UPDATE control_context_issues SET status = 'SUPERSEDED' "
                "WHERE engagement_control_id = %s AND topic = %s",
                (UUID(control), record.topic),
            )
            assert raise_issues(cursor, org, project, UUID(control), [record], "AGENT") == 0
            reworded = Issue("ATTRIBUTES", "AMBIGUOUS", "record of the grant-date.", "Unclear.",
                             "", "")  # fmt: skip
            assert raise_issues(cursor, org, project, UUID(control), [reworded], "AGENT") == 0
            # The narrative's point, closed when the attributes were accepted.
            point = Issue("PROCESS", "MISSING", "Who raises the request", "Not named.", "", "")
            assert raise_issues(cursor, org, project, UUID(control), [point], "AGENT") == 1
            cursor.execute(
                "UPDATE control_context_issues SET question = 'Who raises the request?', "
                "status = 'SUPERSEDED', resolution_note = %s "
                "WHERE engagement_control_id = %s AND topic = %s",
                (QUESTIONS_CLOSED_NOTE, UUID(control), point.topic),
            )
            assert raise_issues(cursor, org, project, UUID(control), [point], "AGENT") == 0
        # Read as settled: given to the agents with the note, never as anyone's answer, and
        # counted as asked by the narrative's round rule.
        context = load_context(connection, project, UUID(control))
        package = context_package(
            connection,
            project,
            UUID(control),
            context,
            _classes(connection, UUID(control), context),
        )
        assert {"question": "Who raises the request?", "answer": QUESTIONS_CLOSED_NOTE} in package[
            "answered_questions"
        ]
        point_round, asked = process_narrative._rounds(connection, UUID(control), False)
        assert point_round == 2 and "who raises the request" in asked
    # A run no longer closes the earlier round's unanswered question: it stays until a
    # person answers it or the attributes are accepted. Old (before B1j): every run
    # superseded its own open ATTRIBUTES questions first. New: the question stays OPEN.
    # Rewritten again after the review of B1k (16 November 2026: the attribute agent never
    # asks before completion on any path, generate_reviewed included). Old: the agent's own
    # run raised the question it then kept. New: the question is one raised before (an
    # agent's, before B1k), and the agent's runs keep it open; the same matter returned by
    # the agent is not assumed either, since it was asked.
    with connect(migrated.url) as connection:
        with connection.transaction():
            assert raise_issues(
                connection.cursor(), org, project, UUID(control),
                [Issue("ATTRIBUTES", "MISSING", _GRANT_RECORD["topic"], _GRANT_RECORD["detail"],
                       _GRANT_RECORD["why"], "")],
                "AGENT",
            ) == 1  # fmt: skip
    asking = _Agents(migrated, team, control)
    asking.other = no_answer  # the interview writer's failure path: questions kept
    asking.issues = [{**_GRANT_RECORD}]
    with connect(migrated.url) as connection:
        generate_reviewed(connection, asking, org, project, UUID(control), team["owner_id"])
        connection.commit()
    [kept] = [row for row in _open_issues(migrated, control) if row[1] == _GRANT_RECORD["topic"]]
    assert _GRANT_RECORD["topic"] not in {row[0] for row in _assumptions(migrated, control)}
    silent = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        generate_reviewed(connection, silent, org, project, UUID(control), team["owner_id"])
        connection.commit()
    assert kept[:2] in [row[:2] for row in _open_issues(migrated, control)]


# No narrative for an ITGC


def test_no_process_narrative_is_drafted_for_a_control_that_needs_none(migrated: Database) -> None:
    team, control, _scheduler, client = _ready(migrated, "uo-itgc")
    for path in ("narrate", "review-narrative", "update-plan"):
        refused = client.post(f"{_path(team, control)}/process/{path}")
        assert (refused.status_code, refused.json()["detail"]) == (409, NO_NARRATIVE), path
    assert _rows(
        migrated,
        "SELECT count(*) FROM process_narrative_runs WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]
    # A point answered on such a control (one raised before B1j) asks for no redraft.
    with connect(migrated.url) as connection:
        with connection.transaction():
            raise_issues(
                connection.cursor(), team["org"], team["project"], UUID(control),
                [Issue("PROCESS", "MISSING", "Patch history review", "Not named.", "", "")],
                "AGENT",
            )  # fmt: skip
            connection.execute(
                "UPDATE control_context_issues SET question = 'Who reviews the patch history?' "
                "WHERE engagement_control_id = %s AND origin = 'PROCESS'",
                (UUID(control),),
            )
    [point] = [row for row in _open_issues(migrated, control) if row[2] == "PROCESS"]
    answered = client.post(
        f"{_path(team, control)}/process/points",
        json={"items": [{"issue_id": str(point[0]), "version": point[4],
                         "answer": "The change manager reviews the patch history."}]},
    )  # fmt: skip
    assert answered.status_code == 200, answered.text
    assert _rows(
        migrated,
        "SELECT count(*) FROM process_narrative_runs WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]


# The criteria history, and rewording


def test_every_change_to_the_criteria_keeps_the_earlier_version_with_who_and_why(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uo-history")
    a1_id, _a1, a1_text = _codes(migrated, control)[0]

    def planner_writes(condition: str, cause: str) -> None:
        with connect(migrated.url) as connection:
            with connection.transaction():
                cursor = connection.cursor()
                cursor.execute("SELECT set_config('app.criteria_cause', %s, true)", (cause,))
                _write_criteria(cursor, UUID(control), [
                    {"attribute": a1_text, "condition": condition, "pass_criteria": "Agent p.",
                     "fail_criteria": "Agent f.", "judgment_required": False},
                ])  # fmt: skip

    def kept() -> int:
        return int(
            _rows(
                migrated,
                "SELECT count(*) FROM attribute_criteria_versions WHERE attribute_id = %s",
                a1_id,
            )[0][0]
        )

    # No criteria yet (whatever the launch wrote is kept as an earlier version of its own).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = '', pass_criteria = '', "
            "fail_criteria = '', judgment_required = NULL, criteria_origin = NULL WHERE id = %s",
            (a1_id,),
        )
        connection.commit()
    before = kept()
    # The first criteria replace none: nothing earlier to keep.
    planner_writes("Agent c1.", "")
    assert kept() == before
    # An agent rewrites them, following an answer.
    planner_writes("Agent c2.", "Emergency changes")
    # A person writes their own.
    version = _rows(migrated, "SELECT version FROM control_attributes WHERE id = %s", a1_id)[0][0]
    written = client.post(
        f"{_path(team, control)}/master-plan/attributes/{a1_id}/criteria",
        json={"version": version, "condition": "Person c.", "pass_criteria": "Person p.",
              "fail_criteria": "Person f."},
    )  # fmt: skip
    assert written.status_code == 200, written.text
    history = client.get(f"{_path(team, control)}/attributes/{a1_id}/criteria-history")
    assert history.status_code == 200, history.text
    versions = history.json()["versions"][:2]
    assert [(v["version"], v["condition"], v["origin"], v["cause"]) for v in versions] == [
        (before + 2, "Agent c2.", "AGENT", "Emergency changes"),
        (before + 1, "Agent c1.", "AGENT", ""),
    ]
    assert all(v["written_by"] == {"kind": "AGENT", "name": "Planner agent"} for v in versions)
    assert _rows(
        migrated,
        "SELECT criteria_origin, criteria_written_by, criteria_writer, criteria_cause "
        "FROM control_attributes WHERE id = %s",
        a1_id,
    ) == [("PERSON", team["owner_id"], "", "")]
    on_a1 = next(
        i
        for i in _context(team, control, client)["attributes"]["approved"]
        if i["id"] == str(a1_id)
    )
    assert (on_a1["criteria_versions"], on_a1["criteria_updated_from"]) == (before + 2, "")
    # Written by the trigger only, never changed, never deleted on its own.
    with connect(migrated.url) as connection:
        for sql in (
            "INSERT INTO attribute_criteria_versions (organization_id, project_id, "
            "engagement_control_id, attribute_id, version, condition, pass_criteria, "
            "fail_criteria, written_at) SELECT organization_id, project_id, "
            "engagement_control_id, id, 9, 'x', 'x', 'x', clock_timestamp() "
            "FROM control_attributes WHERE id = %s",
            "UPDATE attribute_criteria_versions SET condition = 'x' WHERE attribute_id = %s",
            "DELETE FROM attribute_criteria_versions WHERE attribute_id = %s",
        ):
            with pytest.raises(psycopg.errors.RaiseException):
                connection.execute(sql, (a1_id,))
            connection.rollback()
    # An attribute that is not this control's is not found.
    missing = client.get(f"{_path(team, control)}/attributes/{UUID(int=1)}/criteria-history")
    assert missing.status_code == 404


def test_rewording_an_attribute_carries_its_criteria_a_persons_and_an_accepted(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uo-reword")
    (a1_id, a1, _t1), (a2_id, a2, _t2) = _codes(migrated, control)[:2]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'PERSON', condition = 'Mine c.', "
            "pass_criteria = 'Mine p.', fail_criteria = 'Mine f.' WHERE id = %s",
            (a1_id,),
        )
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', condition = 'Agent c.', "
            "pass_criteria = 'Agent p.', fail_criteria = 'Agent f.' WHERE id = %s",
            (a2_id,),
        )
        connection.execute(
            "UPDATE control_attributes SET criteria_accepted_by = %s, "
            "criteria_accepted_at = clock_timestamp() WHERE id = %s",
            (team["owner_id"], a2_id),
        )
        connection.commit()
    rewordings = (
        (a1_id, "The request is approved by the role owner first."),
        (a2_id, "The grant matches the approved request exactly."),
    )
    for attribute_id, text in rewordings:
        version = _rows(
            migrated, "SELECT version FROM control_attributes WHERE id = %s", attribute_id
        )[0][0]
        edited = client.patch(
            f"{_path(team, control)}/attributes/{attribute_id}",
            json={"text": text, "version": version},
        )
        assert edited.status_code == 200, edited.text
    rows = {
        row[0]: row[1:]
        for row in _rows(
            migrated,
            "SELECT code, text, condition, pass_criteria, fail_criteria, criteria_origin, "
            "criteria_accepted_by, replaces_id FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'APPROVED'",
            UUID(control),
        )
    }
    assert rows[a1] == (
        "The request is approved by the role owner first.", "Mine c.", "Mine p.", "Mine f.",
        "PERSON", None, a1_id,
    )  # fmt: skip
    assert rows[a2] == (
        "The grant matches the approved request exactly.", "Agent c.", "Agent p.", "Agent f.",
        "AGENT", team["owner_id"], a2_id,
    )  # fmt: skip
    approved = _context(team, control, client)["attributes"]["approved"]
    owned = {item["text"]: item["criteria_owned"] for item in approved}
    assert owned["The request is approved by the role owner first."] is True
    assert owned["The grant matches the approved request exactly."] is True


# Who may decide, an archived engagement, and a rerun that drafts the same words


def test_who_may_decide_an_assumption_and_an_archived_engagements_are_read_only(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uo-access")
    _completed_now(migrated, control)
    a1_id, a1, _text = _codes(migrated, control)[0]
    assumption = _assume(migrated, team, control, LINKAGE, LINKED_BY_DATE, [a1])
    base = f"{_path(team, control)}/assumptions/{assumption}"
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], "uo-reader@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], reader)
    reading = _session(migrated, reader)
    assert reading.post(f"{base}/confirm", json={"version": 1}).status_code == 403
    assert (
        reading.post(f"{base}/change", json={"text": LINKED_BY_HOST, "version": 1}).status_code
        == 403
    )
    # A reader may read the history.
    assert (
        reading.get(f"{_path(team, control)}/attributes/{a1_id}/criteria-history").status_code
        == 200
    )
    # Not this control's, or none at all.
    other = str(_codes(migrated, control)[1][0])
    assert (
        client.post(
            f"{_path(team, control)}/assumptions/{UUID(int=7)}/confirm", json={"version": 1}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/organizations/{team['org']}/projects/{team['project']}/controls/{other}/assumptions/"
            f"{assumption}/confirm",
            json={"version": 1},
        ).status_code
        == 404
    )
    assert _rows(
        migrated, "SELECT status FROM attribute_assumptions WHERE id = %s", assumption
    ) == [("OPEN",)]
    # Written once, decided once, never deleted.
    with connect(migrated.url) as connection:
        for sql in (
            "UPDATE attribute_assumptions SET assumed = 'Other.' WHERE id = %s",
            "UPDATE attribute_assumptions SET status = 'OPEN', version = version + 1 WHERE id = %s",
            "DELETE FROM attribute_assumptions WHERE id = %s",
        ):
            with pytest.raises(psycopg.errors.RaiseException):
                connection.execute(sql, (assumption,))
            connection.rollback()
    # Archived: the request is refused and the database writes nothing.
    current = client.get(f"/organizations/{team['org']}/projects/{team['project']}").json()
    done = client.patch(
        f"/organizations/{team['org']}/projects/{team['project']}",
        json={**_edit(current), "status": "ARCHIVED", "version": current["version"]},
    )
    assert done.status_code == 200, done.text
    assert client.post(f"{base}/confirm", json={"version": 1}).status_code == 409
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation, match="archived"):
            connection.execute(
                "UPDATE attribute_assumptions SET status = 'CONFIRMED', decided_by = %s, "
                "decided_at = clock_timestamp(), version = 2 WHERE id = %s",
                (team["owner_id"], assumption),
            )


def test_a_rerun_keeps_a_proposal_it_drafts_again_in_the_same_words(migrated: Database) -> None:
    team, control, _scheduler, _client = _ready(migrated, "uo-keep")
    org, project = team["org"], team["project"]
    proposal = {
        "action": "ADD", "replaces": "", "text": ADDED, "basis": "INFERRED", "source": "",
        "quote": "", "note": "The walkthrough says each request states its justification.",
        "condition": "The ServiceNow request has a business justification entered.",
        "pass_criteria": "The justification field of the ServiceNow request is filled in.",
        "fail_criteria": "The justification field of the ServiceNow request is empty.",
        "judgment_required": False,
    }  # fmt: skip

    def run(proposals: list[dict[str, Any]]) -> None:
        agents = _Agents(migrated, team, control)
        agents.proposals = proposals
        with connect(migrated.url) as connection:
            generate_reviewed(connection, agents, org, project, UUID(control), team["owner_id"])
            connection.commit()

    run([proposal])
    [first] = _proposals(migrated, control)
    # Drafted again in the same words: the same row, at the same version.
    run([proposal])
    assert _proposals(migrated, control) == [first]
    # Drafted again with other criteria: the same row, its criteria up to date, the earlier
    # ones kept.
    run([{**proposal, "pass_criteria": "The justification field names the reason."}])
    [kept] = _proposals(migrated, control)
    assert (kept[0], kept[4], kept[7]) == (
        first[0], "The justification field names the reason.", first[7] + 1,
    )  # fmt: skip
    assert _rows(
        migrated,
        "SELECT pass_criteria FROM attribute_criteria_versions WHERE attribute_id = %s",
        first[0],
    ) == [(proposal["pass_criteria"],)]
    # Not drafted again: replaced, as before.
    run([])
    assert _proposals(migrated, control) == []
    assert _rows(
        migrated, "SELECT status, note FROM control_attributes WHERE id = %s", first[0]
    ) == [("SUPERSEDED", "Replaced by a later review.")]
