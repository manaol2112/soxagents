"""The confirmed Control Understanding is the authority (B1e; decided by the product owner
on 12 November 2026, docs/control-workflow-plan.md): "since I've finalized the control
understanding, shouldn't the attribute just follow what control understanding says so I
won't get any conflict like this?"; and, where two answers inside it disagree, "Yes. Newer
answer wins."

The case is ITGC-AC-01 on SAP S/4HANA, as it happened: an earlier question was answered
"...the grant date and time is held in the Active Directory change log", the RCM record and
the approved attribute A3 say the same, and the walkthrough confirmed later that the system
does not log every change and the request tool's ticket history shows when access was
granted. The attribute agent raised a CONFLICT, which reopened Control Understanding and
held the attributes. Now the agents follow the understanding, the newer answer first, and
say what they followed and set aside.

After an independent review of the first version (the same day), what an agent says it
follows buys nothing: both reviewers keep every power, a conflict that quotes two sources is
always raised, a missing or ambiguous fact always is, whatever is not raised is kept whole on
the audit trail, and the line shown per attribute is given only while it is still true."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from support import Database
from test_attributes_follow_understanding import (
    _Agents,
    _answer_required,
    _path,
    _plan_run,
    _ready,
)
from test_outbound import migrated
from test_planning_gate import _project, _rows

from ai_workforce_api import attribute_review, control_attributes, process_narrative
from ai_workforce_api import understanding_authority as authority
from ai_workforce_api.context_routes import generate_reviewed
from ai_workforce_api.control_attributes import AttributeEdit, edit_attribute
from ai_workforce_api.control_context import AnswerIssue, Source
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import (
    PROMPT_LIMIT,
    _check_fabrication,
    check_sources,
    prompt_for,
)
from ai_workforce_api.evidence_planning import SYSTEM_PROMPT as PLANNER_SYSTEM
from ai_workforce_api.evidence_plans import PLANNER_PROMPT_VERSION, load_facts, run_plan
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.phase_release import attribute_waits
from ai_workforce_api.provenance import agent_actor

__all__ = ["migrated"]

TOPIC = "Source of grant date and completeness of population"
QUESTION = (
    "In which system is the grant date and time recorded, and how does the System "
    "administrator check that the access granted agrees to the approved request?"
)
# Answered a fortnight before the walkthrough: the older answer.
AD_ANSWER = (
    "The System administrator grants the role only after the ServiceNow approvals are "
    "complete, and the grant date and time is held in the Active Directory change log."
)
# What the system wrote when it settled a question by itself: no person confirmed it.
AUTO_SETTLED = "The control's design is the one stated on the control."
# Confirmed in the walkthrough: the newer answers.
LOGGING, GAP = "wt-ac-change-logging", "wt-ac-change-logging-gap"
TICKETS = "The request tool's ticket history"
SNAPSHOTS = "Snapshots of the user listing compared over the period"
A3 = (
    "Each ServiceNow approval time-stamp is earlier than the grant date and time of the "
    "access in Active Directory"
)
A3_FOLLOWS = (
    "Each ServiceNow approval time-stamp is earlier than the date and time the ServiceNow "
    "ticket history shows the access was granted"
)
TICKET_CRITERIA = {
    "condition": (
        "Every approval date and time on the ServiceNow request is earlier than the grant "
        "entry in the ticket history of the same request."
    ),
    "pass_criteria": (
        "Each approval time-stamp on the ServiceNow request is earlier than the grant entry "
        "in its ticket history."
    ),
    "fail_criteria": (
        "An approval time-stamp is later than the grant entry in the ticket history, or the "
        "ticket history shows no grant entry."
    ),
}
AD_CRITERIA = {
    "condition": (
        "Every ServiceNow approval date and time on the request is earlier than the grant "
        "date and time recorded for that grant in the Active Directory change log."
    ),
    "pass_criteria": (
        "Each approval time-stamp is earlier than the grant recorded in the Active Directory "
        "change log."
    ),
    "fail_criteria": (
        "An approval time-stamp is later than the grant recorded in the Active Directory "
        "change log."
    ),
}
FOLLOWED = "The request tool's ticket history shows when access was granted."
SET_ASIDE = "the grant date in the Active Directory change log"
WHY = (
    "The walkthrough confirmed later that SAP S/4HANA does not log every change, so the "
    "sequence is tested against the ticket history."
)
# The issue the attribute agent raised on 12 November, word for word.
CONFLICT: dict[str, Any] = {
    "kind": "CONFLICT",
    "topic": TOPIC,
    "detail": (
        "The approved attribute A3 compares approval time-stamps with the grant date in "
        "Active Directory, and the team's answer says the Active Directory change log holds "
        "the grant date. The walkthrough says SAP S/4HANA does not log every account and "
        "role change, and that ticket history will be used to show when changes were made."
    ),
    "why": (
        "Different records for the grant date and the list of grants leave unclear which "
        "one supports the sequence test and whether the population is complete."
    ),
    "resolve": (
        "Confirm which record gives the grant date and time for SAP S/4HANA role grants, "
        "and which record shows the population of grants is complete."
    ),
    "quotes": [{"source": "control", "quote": A3}],
    "question": "",
    "proposal": "",
    "proposal_basis": "",
    "suggestions": [],
}
# The same one source quoted, in words that name no confirmed fact.
NEUTRAL = {
    **CONFLICT,
    "topic": "Record of the grant date",
    "detail": "The record that gives the grant date for SAP S/4HANA role grants is unclear.",
}


def _context_of(prompt: str) -> dict[str, Any]:
    found: dict[str, Any] = json.loads(
        prompt.split("<control_context>\n", 1)[1].split("\n</control_context>", 1)[0]
    )
    return found


class _Understood(_Agents):
    """The run's agents, with an attribute agent that answers from the confirmed
    understanding it was given, and a reviewer of its drafts that may change them."""

    def __init__(self, database: Database, team: dict[str, Any], control: str) -> None:
        super().__init__(database, team, control)
        # The attribute agent's answer, from the facts it was given.
        self.answer: Any = lambda facts: {"attributes": [], "issues": []}
        # The drafts as their reviewer returns them, from the drafts; None: as drafted.
        self.redraft: Any = None
        self.contexts: list[dict[str, Any]] = []
        self.planner_prompts: list[str] = []
        self._drafted: list[dict[str, Any]] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        if request.system == control_attributes.SYSTEM_PROMPT:
            self.prompts.append(request.prompt)
            self._note("attributes")
            context = _context_of(request.prompt)
            self.contexts.append(context)
            answer = self.answer(context["confirmed_understanding"])
            self._drafted = answer["attributes"]
            return ModelRaw(answer, (), 100, 100)
        if request.system == control_attributes.REVIEW_PROMPT:
            self.prompts.append(request.prompt)
            self._note("draft-review")
            drafts = self._drafted if self.redraft is None else self.redraft(self._drafted)
            return ModelRaw({"attributes": drafts, "fixes": []}, (), 100, 100)
        if request.system == PLANNER_SYSTEM:
            self.planner_prompts.append(request.prompt)
        return super().complete(request, config)


def _ref(facts: list[dict[str, Any]], answer: str) -> str:
    return str(next(fact["ref"] for fact in facts if fact["answer"] == answer))


def _follows(facts: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "fact": _ref(facts, TICKETS),
        "statement": FOLLOWED,
        "sets_aside": [
            {"kind": "OLDER_ANSWER", "fact": _ref(facts, AD_ANSWER), "statement": SET_ASIDE},
            {
                "kind": "RCM_RECORD",
                "fact": "",
                "statement": "the grant date and time of the access in Active Directory",
            },
        ],
        "why": WHY,
    }


def _change(a3_id: Any, facts: list[dict[str, Any]]) -> dict[str, Any]:
    """A3 tailored to the understanding: the sequence is tested against the ticket history,
    and the agent says what it followed and what it set aside."""
    return {
        "action": "CHANGE",
        "replaces": str(a3_id),
        "text": A3_FOLLOWS,
        "basis": "INFERRED",
        "source": "",
        "quote": "",
        "note": "The walkthrough names the ticket history as the record of the grant.",
        **TICKET_CRITERIA,
        "judgment_required": False,
        "follows": _follows(facts),
    }


def _case(migrated: Database, slug: str) -> tuple[dict[str, Any], str, Any, Any]:
    """ITGC-AC-01 as it stood before the walkthrough: the earlier question answered a
    fortnight ago with the Active Directory change log, and an approved A3, with criteria a
    person owns, that says the same. Returns the team, the control, the owner's client on an
    app with a worker and a model, and A3's id."""
    team, control, _scheduler, client = _ready(migrated, slug)
    with connect(migrated.url) as connection:
        third = connection.execute(
            "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at OFFSET 2 LIMIT 1",
            (control,),
        ).fetchone()
        assert third is not None
        edit_attribute(
            connection,
            team["org"],
            team["project"],
            UUID(control),
            third[0],
            team["owner_id"],
            AttributeEdit(text=A3, version=int(third[1])),
        )
        a3 = connection.execute(
            "UPDATE control_attributes SET condition = %s, pass_criteria = %s, "
            "fail_criteria = %s, criteria_origin = 'PERSON', version = version + 1 "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' AND text = %s "
            "RETURNING id",
            (*AD_CRITERIA.values(), control, A3),
        ).fetchone()
        assert a3 is not None
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, fingerprint, raised_by, status, resolution_note, resolved_by,
                resolved_at, question, proposal
            )
            VALUES (%s, %s, %s, 'PROCESS', 'MISSING', 'How the grant is made and recorded',
                    %s, 'The narrative needs the record that holds the grant date.', %s,
                    'AGENT', 'RESOLVED', %s, %s, clock_timestamp() - interval '14 days', %s,
                    %s)
            """,
            (
                team["org"],
                team["project"],
                control,
                QUESTION,
                uuid4().hex,
                AD_ANSWER,
                team["owner_id"],
                QUESTION,
                AD_ANSWER,
            ),
        )
        # A question the system settled by itself, as library_definitions does for a design
        # confirmation that no longer applies: resolved, with no person on record.
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, fingerprint, raised_by, status, resolution_note, resolved_at
            )
            VALUES (%s, %s, %s, 'SOURCES', 'AMBIGUOUS', 'Control design to confirm',
                    'Confirm the design stated on the control.', %s, 'RULES', 'RESOLVED', %s,
                    clock_timestamp() - interval '1 day')
            """,
            (team["org"], team["project"], control, uuid4().hex, AUTO_SETTLED),
        )
        connection.commit()
    return team, control, client, a3[0]


def _walkthrough_confirmed(
    migrated: Database, team: dict[str, Any], control: str, client: Any
) -> UUID:
    """The person finishes the walkthrough: the system does not log every change, and the
    request tool's ticket history shows when access was granted. Returns the queued run."""
    _answer_required(migrated, team, control, client)
    answers = dict(
        _rows(
            migrated,
            "SELECT question_key, value FROM control_walkthrough_answers "
            "WHERE engagement_control_id = %s AND status = 'CONFIRMED'",
            UUID(control),
        )
    )
    assert (answers[LOGGING], answers[GAP]) == ("No", TICKETS)
    plan_id, status, _stage = _plan_run(migrated, control)
    assert status == "PENDING"
    return plan_id


def _issues(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT topic, origin, kind, status, raised_by, resolution_note, resolved_by, "
        "resolved_at, id, version FROM control_context_issues "
        "WHERE engagement_control_id = %s ORDER BY created_at",
        UUID(control),
    )


def _followed_audit(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT actor_user_id, actor_agent_instance_id, payload FROM audit_events "
        "WHERE target_id = %s AND action = 'attributes.understanding_followed' "
        "ORDER BY occurred_at",
        UUID(control),
    )


def _needs(team: dict[str, Any], control: str) -> list[dict[str, Any]]:
    read = team["owner"].get(f"{_path(team, control)}/understanding/review")
    assert read.status_code == 200, read.text
    found: list[dict[str, Any]] = read.json()["needs"]
    return found


def _attributes(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_path(team, control)}/context")
    assert read.status_code == 200, read.text
    found: dict[str, Any] = read.json()["attributes"]
    return found


def _open(team: dict[str, Any], control: str) -> list[dict[str, Any]]:
    read = team["owner"].get(f"{_path(team, control)}/context")
    assert read.status_code == 200, read.text
    return [item for item in read.json()["issues"] if item["status"] == "OPEN"]


def _inline(migrated: Database, team: dict[str, Any], control: str, agents: Any) -> None:
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()


# The case end to end, and what the agents are given


def test_the_attribute_follows_the_understanding_and_the_conflict_is_never_raised(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-case")
    answered_before = _issues(migrated, control)
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    walkthrough_rows = _rows(
        migrated,
        "SELECT question_key, value, version FROM control_walkthrough_answers "
        "WHERE engagement_control_id = %s ORDER BY question_key",
        UUID(control),
    )
    agents = _Understood(migrated, team, control)
    # The agent tailors A3 and still returns the conflict, in the words it used.
    agents.answer = lambda facts: {
        "attributes": [_change(a3_id, facts)],
        "issues": [CONFLICT],
    }
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
        planner = agent_actor(connection, team["project"], "engagement-planner")
    assert [who for who in agents.calls if who != "other"] == [
        "attributes",
        "draft-review",
        "planner",
        "set-review",
    ]

    # Each fact reaches the agents with when it was confirmed and by what, newest first. No
    # fact is marked as replaced by the server: the dates say which holds.
    facts = agents.contexts[0]["confirmed_understanding"]
    assert {fact["kind"] for fact in facts} == {
        "WALKTHROUGH_ANSWER",
        "CONTROL_VALUE",
        "ANSWERED_QUESTION",
    }
    assert all(
        set(fact) == {"ref", "kind", "question", "answer", "confirmed_at", "confirmed_by"}
        for fact in facts
    )
    assert all(fact["confirmed_at"] for fact in facts)
    times = [fact["confirmed_at"] for fact in facts]
    assert times == sorted(times, reverse=True)
    assert [fact["ref"] for fact in facts] == [f"U{n}" for n in range(1, len(facts) + 1)]
    older = next(fact for fact in facts if fact["answer"] == AD_ANSWER)
    newer = next(fact for fact in facts if fact["answer"] == TICKETS)
    assert (older["kind"], older["confirmed_by"]) == ("ANSWERED_QUESTION", "PERSON")
    assert older["question"] == QUESTION
    assert (newer["kind"], newer["confirmed_by"]) == ("WALKTHROUGH_ANSWER", "PERSON")
    assert newer["confirmed_at"] > older["confirmed_at"]
    assert facts.index(newer) < facts.index(older)
    # A question the system closed by itself, with no person on record, is never presented
    # as a person's confirmation; a value a person filled in is.
    settled = [fact for fact in facts if fact["answer"] == AUTO_SETTLED]
    assert settled and all(fact["confirmed_by"] == "RECORDS" for fact in settled)
    values = [fact for fact in facts if fact["kind"] == "CONTROL_VALUE"]
    assert values and all(fact["confirmed_by"] == "PERSON" for fact in values)
    # Once, not twice: the undated copy is gone from the attribute agent's package.
    assert "walkthrough_answers" not in agents.contexts[0]
    # The agent sees A3's criteria beside its wording, and that a person owns them.
    given_a3 = next(
        item for item in agents.contexts[0]["approved_attributes"] if item["id"] == str(a3_id)
    )
    assert given_a3["criteria"] == AD_CRITERIA and given_a3["criteria_owned_by_a_person"] is True
    # The same facts reach the reviewer of the drafts, the planner and the set's reviewer.
    assert _context_of(agents.prompts[1])["confirmed_understanding"] == facts
    planned = json.loads(
        agents.planner_prompts[0].split("<control>\n", 1)[1].rsplit("\n</control>", 1)[0]
    )
    assert [fact["ref"] for fact in planned["confirmed_understanding"]] == [
        fact["ref"] for fact in facts
    ]
    assert "walkthrough_answers" not in planned
    reviewed = agents.reviewed[0]["confirmed_understanding"]
    assert [(fact["ref"], fact["answer"]) for fact in reviewed] == [
        (fact["ref"], fact["answer"]) for fact in facts
    ]
    # The set's reviewer is given the fact as recorded beside the agent's words for it, and
    # may revise the attribute as any other the agent proposed.
    change = next(
        item for item in agents.reviewed[0]["attributes"] if item["state"] == "AGENT_REWORDS"
    )
    assert change["may_revise"] == ["criteria", "text"]
    told = change["follows_understanding"]
    assert (told["fact"]["answer"], told["agent_summary_of_fact"]) == (TICKETS, FOLLOWED)
    assert told["fact"]["confirmed_by"] == "PERSON" and told["stated_by"] == "independent-reviewer"
    assert (told["sets_aside"][0]["answer"], told["sets_aside"][0]["agent_words"]) == (
        AD_ANSWER,
        SET_ASIDE,
    )

    # The conflict has one source and names a confirmed answer as its other side: it is not
    # raised, and nothing on record was deleted or rewritten.
    assert _issues(migrated, control) == answered_before
    assert [row for row in _issues(migrated, control) if row[3] == "OPEN"] == []
    assert (
        _rows(
            migrated,
            "SELECT question_key, value, version FROM control_walkthrough_answers "
            "WHERE engagement_control_id = %s ORDER BY question_key",
            UUID(control),
        )
        == walkthrough_rows
    )
    # Control Understanding is not reopened: it asks nothing for it.
    assert [need for need in _needs(team, control) if need["kind"] == "QUESTION"] == []
    # The attributes wait for the person's acceptance only, not for a question.
    with connect(migrated.url) as connection:
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
    assert "question" not in wait and "proposed attribute" in wait
    # A3's proposed version tests the sequence against the ticket history. The approved A3
    # stands as it was until the person accepts.
    body = _attributes(team, control)
    [proposed] = body["proposed"]
    assert (proposed["proposal"], proposed["replaces_id"], proposed["text"]) == (
        "CHANGE",
        str(a3_id),
        A3_FOLLOWS,
    )
    assert proposed["pass_criteria"] == TICKET_CRITERIA["pass_criteria"]
    approved = next(item for item in body["approved"] if item["id"] == str(a3_id))
    assert approved["text"] == A3 and approved["pass_criteria"] == AD_CRITERIA["pass_criteria"]
    assert approved["understanding_basis"] is None
    # What it follows and what it sets aside, per attribute, from the API. What is shown as
    # confirmed is the answer as recorded, with its question, date and who; the agent's own
    # words come beside it, as the agent's.
    basis = proposed["understanding_basis"]
    assert set(basis) == {"follows", "sets_aside", "summary", "by", "recorded_at"}
    assert set(basis["follows"]) == {
        "kind",
        "key",
        "question",
        "answer",
        "confirmed_at",
        "confirmed_by",
        "statement",
    }
    assert (basis["follows"]["kind"], basis["follows"]["key"]) == ("WALKTHROUGH_ANSWER", GAP)
    assert (basis["follows"]["answer"], basis["follows"]["statement"]) == (TICKETS, FOLLOWED)
    assert basis["follows"]["question"] == newer["question"]
    assert basis["follows"]["confirmed_by"] == "PERSON"
    assert basis["summary"] == WHY
    first, second = basis["sets_aside"]
    assert set(first) == {
        "kind",
        "statement",
        "fact_kind",
        "key",
        "question",
        "answer",
        "confirmed_at",
        "confirmed_by",
    }
    assert (first["kind"], first["fact_kind"], first["answer"], first["statement"]) == (
        "OLDER_ANSWER",
        "ANSWERED_QUESTION",
        AD_ANSWER,
        SET_ASIDE,
    )
    assert (first["question"], first["confirmed_by"]) == (QUESTION, "PERSON")
    followed_at = datetime.fromisoformat(basis["follows"]["confirmed_at"])
    set_aside_at = datetime.fromisoformat(first["confirmed_at"])
    assert followed_at - set_aside_at > timedelta(days=13)
    assert (second["kind"], second["fact_kind"], second["answer"], second["confirmed_at"]) == (
        "RCM_RECORD",
        None,
        "",
        None,
    )
    # Its provenance is the agent and the model call that wrote the statement stored: the
    # reviewer of the drafts returned the list, so it is the reviewer's, not the drafter's.
    assert basis["by"] == "independent-reviewer"
    stored = _rows(
        migrated,
        "SELECT understanding_basis, model_call_id FROM control_attributes WHERE id = %s",
        UUID(proposed["id"]),
    )[0]
    assert stored[0]["prompt_version"] == "attribute-review/3"
    assert stored[0]["model_call"] != str(stored[1])
    assert _rows(
        migrated,
        "SELECT agent_key, prompt_version FROM model_calls WHERE id = %s",
        UUID(stored[0]["model_call"]),
    ) == [("independent-reviewer", "attribute-review/3")]
    assert _rows(migrated, "SELECT agent_key FROM model_calls WHERE id = %s", stored[1]) == [
        ("engagement-planner",)
    ]
    # Audited as the agent's action: the agent is the actor, never a person.
    [audit] = _followed_audit(migrated, control)
    assert planner is not None
    assert (audit[0], audit[1]) == (None, planner)
    payload = audit[2]
    assert payload["by"] == "engagement-planner" and payload["prompt_version"] == "attributes/5"
    assert payload["written_by"] == "independent-reviewer"
    [entry] = payload["followed"]
    assert (entry["attribute"], entry["change"]) == (proposed["id"], "CHANGE")
    assert (entry["follows"]["key"], entry["follows"]["statement"]) == (GAP, FOLLOWED)
    assert entry["follows"]["fact_mark"] and "answer" not in entry["follows"]
    assert entry["sets_aside"][0]["statement"] == SET_ASIDE
    # What was not raised is kept whole: its words, its quotes and the reason.
    [left] = payload["not_raised"]
    assert (left["kind"], left["topic"]) == ("CONFLICT", TOPIC)
    assert (left["detail"], left["why"], left["resolve"]) == (
        CONFLICT["detail"],
        CONFLICT["why"],
        CONFLICT["resolve"],
    )
    assert left["quotes"] == [{"source": "control", "quote": A3}]
    assert "fewer than two sources" in left["reason"] and "confirmed answer" in left["reason"]
    assert payload["closed"] == [] and payload["older_answer_followed_left_out"] == []
    assert payload["left_out_by_reviewer"] == []

    # The person accepts: the change is theirs now, A3's earlier wording is kept in the
    # history, and the line still explains the attribute they accepted.
    accepted = team["owner"].post(
        f"{_path(team, control)}/attributes/accept",
        json={"items": [{"attribute_id": proposed["id"], "version": proposed["version"]}]},
    )
    assert accepted.status_code == 200, accepted.text
    after = _attributes(team, control)
    now = next(item for item in after["approved"] if item["id"] == proposed["id"])
    assert now["text"] == A3_FOLLOWS and now["criteria_owned"] is True
    assert now["understanding_basis"]["follows"]["answer"] == TICKETS
    retired = next(item for item in after["history"] if item["id"] == str(a3_id))
    assert (retired["status"], retired["text"]) == ("RETIRED", A3)
    # The acceptance is the person's; the record of what the agent followed is not theirs.
    assert len(_followed_audit(migrated, control)) == 1


def test_a_one_source_conflict_is_dropped_only_when_a_confirmed_fact_is_shown_to_be_a_side(
    migrated: Database,
) -> None:
    team, control, client, _a3 = _case(migrated, "uia-one-source")
    _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    # One source quoted, in words that name no confirmed fact, and no fact named as settling
    # it: it is not dropped. It cannot stand as a conflict, so a person sees it as unclear.
    agents.answer = lambda facts: {"attributes": [], "issues": [NEUTRAL]}
    _inline(migrated, team, control, agents)
    [issue] = _open(team, control)
    assert (issue["kind"], issue["origin"], issue["topic"]) == (
        "AMBIGUOUS",
        "ATTRIBUTES",
        "Record of the grant date",
    )
    assert [quote["source"] for quote in issue["quotes"]] == ["control"]
    assert [need["key"] for need in _needs(team, control) if need["kind"] == "QUESTION"] == [
        issue["id"]
    ]
    assert _followed_audit(migrated, control) == []
    # The same conflict with the confirmed fact that settles it named: not raised, kept on
    # the audit trail with the ref the agent gave.
    agents.answer = lambda facts: {
        "attributes": [],
        "issues": [{**NEUTRAL, "covered_by": [_ref(facts, TICKETS), "U999"]}],
    }
    _inline(migrated, team, control, agents)
    assert _open(team, control) == []
    [audit] = _followed_audit(migrated, control)
    [left] = audit[2]["not_raised"]
    assert left["covered_by"] == [_ref(agents.contexts[-1]["confirmed_understanding"], TICKETS)]
    assert left["detail"] == NEUTRAL["detail"] and "named a confirmed fact" in left["reason"]


# The line shown per attribute is always true


def test_the_line_is_not_shown_for_words_or_facts_that_changed_after_it(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-mark")
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["understanding_basis"]["follows"]["answer"] == TICKETS
    # The person answers the walkthrough question again, with another answer: the attribute
    # no longer follows what is confirmed, so the line is not shown for the old answer.
    saved = client.put(
        f"{_path(team, control)}/walkthrough-answers",
        json={"answers": {GAP: {"value": SNAPSHOTS, "not_applicable": False}}},
    )
    assert saved.status_code == 200, saved.text
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["text"] == A3_FOLLOWS and proposed["understanding_basis"] is None
    # Answered back as it was, it is a new confirmation at another time: still not shown.
    saved = client.put(
        f"{_path(team, control)}/walkthrough-answers",
        json={"answers": {GAP: {"value": TICKETS, "not_applicable": False}}},
    )
    assert saved.status_code == 200, saved.text
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["understanding_basis"] is None
    # The record itself is kept, on the attribute and on the audit trail.
    assert _rows(
        migrated,
        "SELECT understanding_basis IS NOT NULL FROM control_attributes WHERE id = %s",
        UUID(proposed["id"]),
    ) == [(True,)]
    assert len(_followed_audit(migrated, control)) == 1


def test_the_line_is_not_shown_once_a_person_rewords_the_attribute(migrated: Database) -> None:
    team, control, client, a3_id = _case(migrated, "uia-reworded")
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["understanding_basis"] is not None
    decided = team["owner"].post(
        f"{_path(team, control)}/attributes/{proposed['id']}/decide",
        json={
            "decision": "APPROVE",
            "version": proposed["version"],
            "text": "Each approval is recorded before the grant shown in the ticket history",
        },
    )
    assert decided.status_code == 200, decided.text
    after = _attributes(team, control)
    now = next(item for item in after["approved"] if item["id"] == proposed["id"])
    assert now["understanding_basis"] is None


def test_an_agent_that_follows_the_older_answer_over_the_newer_has_its_proposal_left_out(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-backwards")
    _walkthrough_confirmed(migrated, team, control, client)
    reworded = A3 + " change log"

    def backwards(facts: list[dict[str, Any]]) -> dict[str, Any]:
        change = _change(a3_id, facts)
        change["follows"] = {
            "fact": _ref(facts, AD_ANSWER),
            "statement": "The Active Directory change log holds the grant date.",
            "sets_aside": [
                {
                    "kind": "OLDER_ANSWER",
                    "fact": _ref(facts, TICKETS),
                    "statement": "the ticket history",
                },
            ],
            "why": "The earlier answer names Active Directory.",
        }
        return {"attributes": [{**change, **AD_CRITERIA, "text": reworded}], "issues": []}

    agents = _Understood(migrated, team, control)
    agents.answer = backwards
    _inline(migrated, team, control, agents)
    assert _attributes(team, control)["proposed"] == []
    # What was left out is on the audit trail, not only that something was.
    [audit] = _followed_audit(migrated, control)
    assert audit[2]["followed"] == []
    [left] = audit[2]["older_answer_followed_left_out"]
    assert (left["action"], left["replaces"], left["text"]) == ("CHANGE", str(a3_id), reworded)
    assert (left["followed"]["kind"], left["followed"]["confirmed_by"]) == (
        "ANSWERED_QUESTION",
        "PERSON",
    )
    assert [(item["kind"], item["key"]) for item in left["over"]] == [("WALKTHROUGH_ANSWER", GAP)]
    assert left["over"][0]["confirmed_at"] > left["followed"]["confirmed_at"]


def test_an_invalid_follows_discards_only_itself(migrated: Database) -> None:
    proposal = {
        "action": "ADD",
        "text": "The access request ticket records the business justification for the role",
        "basis": "INFERRED",
        **TICKET_CRITERIA,
    }
    missing = {"kind": "MISSING", "topic": "Emergency access", "detail": "Not stated."}
    for invalid in (
        {"fact": "U1234567890", "statement": "x", "sets_aside": [], "why": ""},
        {
            "fact": "U1",
            "statement": "x",
            "why": "",
            "sets_aside": [{"kind": "RCM_RECORD", "fact": "", "statement": "x"}] * 4,
        },
        {"fact": "U1", "sets_aside": [{"kind": "SOMETHING_ELSE", "statement": "x"}]},
        "U1",
        ["U1"],
    ):
        answer = control_attributes._Answer.model_validate(
            {
                "attributes": [{**proposal, "follows": invalid}],
                "issues": [{**missing, "covered_by": "U1"}, {**missing, "covered_by": [1, "U2"]}],
            }
        )
        [kept] = answer.attributes
        assert kept.follows is None and kept.text == proposal["text"]
        assert kept.pass_criteria == TICKET_CRITERIA["pass_criteria"]
        assert [issue.covered_by for issue in answer.issues] == [[], ["U2"]]
    # A ref that is not a fact on record: the proposal is kept and stored, without a line.
    team, control, client, _a3 = _case(migrated, "uia-invalid")
    _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {
        "attributes": [
            {
                **proposal,
                "replaces": "",
                "source": "",
                "quote": "",
                "note": "",
                "judgment_required": False,
                "follows": {**_follows(facts), "fact": "U999"},
            }
        ],
        "issues": [
            {
                **missing,
                "why": "",
                "resolve": "",
                "quotes": [],
                "question": "How is emergency access approved?",
                "proposal": "",
                "proposal_basis": "",
                "suggestions": [],
            }
        ],
    }
    _inline(migrated, team, control, agents)
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["text"] == proposal["text"] and proposed["understanding_basis"] is None
    assert [issue["topic"] for issue in _open(team, control)] == ["Emergency access"]


# The guard, with no model in it

_POLICY = Source(
    "doc-policy", "Access policy", "POLICY", "Approved requests are kept for seven years."
)
_PROCEDURE = Source(
    "doc-procedure", "Access procedure", "PROCEDURE", "Approved requests are kept for three years."
)
_RCM = Source("control", "ITGC-AC-01 (RCM record)", "RCM", f"Test attribute: {A3}")
_NARRATIVE = Source(
    "process-narrative",
    "Approved process narrative",
    "NARRATIVE",
    "Approved requests are kept for five years.",
)
_NOTES = Source(
    "doc-notes", "Walkthrough notes", "WALKTHROUGH", "Requests are kept for one year only."
)
_SOURCES = [_RCM, _POLICY, _PROCEDURE, _NARRATIVE, _NOTES]
_AT = datetime(2026, 11, 12, 16, 14, tzinfo=UTC)
_NEWER = authority.Fact(
    "U1", "WALKTHROUGH_ANSWER", GAP, "How is the grant shown?", TICKETS, _AT, "PERSON"
)
_OLDER = authority.Fact(
    "U2", "ANSWERED_QUESTION", "issue", QUESTION, AD_ANSWER, _AT - timedelta(days=14), "PERSON"
)
_FACTS = (_NEWER, _OLDER)
# What the records filled in by themselves: confirmed by no person.
_BY_RECORDS = authority.Fact(
    "U3",
    "CONTROL_VALUE",
    "access-policy",
    "Which policy governs access?",
    "The Information Security Policy for access",
    _AT + timedelta(days=1),
    "RECORDS",
)
_SAID = {
    "fact": "U1",
    "statement": FOLLOWED,
    "why": WHY,
    "sets_aside": [{"kind": "OLDER_ANSWER", "fact": "U2", "statement": SET_ASIDE}],
}
# Every wording the first version of the guard dropped a conflict for.
_WORDINGS = (
    "The policy says seven years, but the walkthrough answer says three.",
    "The team's answer says three years; the policy says seven.",
    "The policy disagrees with the confirmed answer on retention.",
    "The procedure contradicts the Control Understanding.",
    f"The procedure says three years; elsewhere it is {TICKETS.lower()}.",
    "The walkthrough says requests are kept three years; the policy says seven.",
)


def _issue(kind: str = "CONFLICT", **changes: Any) -> AnswerIssue:
    return AnswerIssue.model_validate(
        {
            "kind": kind,
            "topic": "Retention of approved requests",
            "detail": "The policy keeps approved requests seven years, the procedure three.",
            "why": "The retention period decides whether older samples can be evidenced.",
            "resolve": "Confirm the retention period with the control owner.",
            "quotes": [
                {"source": "doc-policy", "quote": "kept for seven years"},
                {"source": "doc-procedure", "quote": "kept for three years"},
            ],
            **changes,
        }
    )


def test_a_conflict_that_quotes_two_sources_is_always_raised_whatever_its_wording() -> None:
    assert authority.not_raised(_issue(), _SOURCES, _FACTS) == ""
    # The RCM record and a document: two distinct sources.
    both = _issue(
        quotes=[
            {"source": "control", "quote": A3},
            {"source": "doc-policy", "quote": "kept for seven years"},
        ]
    )
    assert authority.not_raised(both, _SOURCES, _FACTS) == ""
    # Naming the understanding, or repeating a confirmed answer, drops nothing here: two
    # documents that disagree are an exception a person must see.
    for said in _WORDINGS:
        assert authority.not_raised(_issue(detail=said), _SOURCES, _FACTS) == "", said
        kept, left, _named = control_attributes._screened(
            [_issue(detail=said)], _SOURCES, _FACTS, None, {}
        )
        assert [item.kind for item in kept] == ["CONFLICT"] and left == []
    # Only the agent naming the confirmed fact that settles it leaves it unraised, and the
    # fact must be one a person confirmed, on record.
    reason = authority.not_raised(_issue(covered_by=["U1"]), _SOURCES, _FACTS)
    assert "U1" in reason and "named a confirmed fact" in reason
    assert authority.not_raised(_issue(covered_by=["U9"]), _SOURCES, _FACTS) == ""
    records = (*_FACTS, _BY_RECORDS)
    assert authority.not_raised(_issue(covered_by=["U3"]), _SOURCES, records) == ""
    # A third quote from the approved narrative changes nothing: two sources still disagree.
    three = _issue(
        quotes=[
            {"source": "doc-policy", "quote": "kept for seven years"},
            {"source": "doc-procedure", "quote": "kept for three years"},
            {"source": "process-narrative", "quote": "kept for five years"},
        ]
    )
    assert authority.not_raised(three, _SOURCES, _FACTS, _AT, {}) == ""


def test_a_conflict_with_fewer_than_two_sources_is_dropped_only_for_a_confirmed_side() -> None:
    alone = _issue(quotes=[{"source": "control", "quote": A3}])
    unfound = _issue(
        quotes=[
            {"source": "doc-policy", "quote": "kept for seven years"},
            {"source": "doc-procedure", "quote": "kept for nine years"},
        ]
    )
    # In words that name no confirmed fact it is not dropped, however much is confirmed:
    # it is raised, as ambiguity, since it cannot point to two sources.
    for item in (alone, unfound, _issue(quotes=[])):
        assert authority.not_raised(item, _SOURCES, _FACTS) == ""
        kept, left, _named = control_attributes._screened([item], _SOURCES, _FACTS, None, {})
        assert [found.kind for found in kept] == ["AMBIGUOUS"] and left == []
    # Its own words name a confirmed answer as the other side: a difference with the
    # understanding, which holds.
    for said in _WORDINGS:
        cited = alone.model_copy(update={"detail": said})
        assert "fewer than two sources" in authority.not_raised(cited, _SOURCES, _FACTS), said
    # Walkthrough notes are a document: quoted, "the walkthrough says" is them.
    notes = _issue(
        detail="The walkthrough says requests are kept one year.",
        quotes=[{"source": "doc-notes", "quote": "kept for one year only"}],
    )
    assert authority.not_raised(notes, _SOURCES, _FACTS) == ""
    # A client value is often a policy's or a tool's name: naming it shows nothing. Nor does
    # a fact no person confirmed make the understanding a side.
    named = alone.model_copy(
        update={"detail": "The Information Security Policy for access says otherwise."}
    )
    assert authority.not_raised(named, _SOURCES, (*_FACTS, _BY_RECORDS)) == ""
    cited = alone.model_copy(update={"detail": _WORDINGS[0]})
    assert authority.not_raised(cited, _SOURCES, (_BY_RECORDS,)) == ""
    # With nothing confirmed the guard drops nothing, whatever the words or the refs.
    for item in (cited, _issue(covered_by=["U1"]), AnswerIssue.model_validate(CONFLICT)):
        assert authority.not_raised(item, _SOURCES, ()) == ""
    # The real one, word for word: one source, and it names the team's answer.
    real = AnswerIssue.model_validate(CONFLICT)
    assert "confirmed answer" in authority.not_raised(real, _SOURCES, _FACTS)
    kept, left, named_marks = control_attributes._screened([real], _SOURCES, _FACTS, None, {})
    assert kept == [] and named_marks == set()
    assert left[0]["detail"] == CONFLICT["detail"] and left[0]["quotes"] == CONFLICT["quotes"]
    # A credential in what is not raised never reaches the audit trail.
    secret = cited.model_copy(update={"why": "The password is password=hunter2secret"})
    _kept, left, _named = control_attributes._screened([secret], _SOURCES, _FACTS, None, {})
    assert left[0]["withheld"] is True and left[0]["why"] == "" and left[0]["topic"]


def test_the_approved_narrative_holds_only_over_a_source_that_has_not_changed_since() -> None:
    conflict = _issue(
        quotes=[
            {"source": "process-narrative", "quote": "kept for five years"},
            {"source": "doc-policy", "quote": "kept for seven years"},
        ]
    )
    approved = _AT
    before = {"doc-policy": approved - timedelta(days=3)}
    after = {"doc-policy": approved + timedelta(hours=1)}
    # The policy was there when a person approved the narrative: the narrative holds.
    assert "narrative holds" in authority.not_raised(conflict, _SOURCES, _FACTS, approved, before)
    # The policy was added or changed after the approval: a later fact, and it is raised,
    # as a conflict between the two.
    assert authority.not_raised(conflict, _SOURCES, _FACTS, approved, after) == ""
    kept, left, _named = control_attributes._screened([conflict], _SOURCES, _FACTS, approved, after)
    assert [item.kind for item in kept] == ["CONFLICT"] and left == []
    # When either time is not on record nothing is taken to be older: raised.
    assert authority.not_raised(conflict, _SOURCES, _FACTS, approved, {}) == ""
    assert authority.not_raised(conflict, _SOURCES, _FACTS, None, before) == ""
    # And never with nothing confirmed.
    assert authority.not_raised(conflict, _SOURCES, (), approved, before) == ""
    # An open conflict from before is read by the same rule, from its stored row.
    stored = [
        {"source": "process-narrative", "title": "Approved process narrative", "quote": "x"},
        {"source": "doc-policy", "title": "Access policy", "quote": "y"},
    ]
    text = "Retention The narrative and the policy differ."
    assert authority.settled_before("CONFLICT", text, stored, _SOURCES, _FACTS, approved, before)
    assert not authority.settled_before("CONFLICT", text, stored, _SOURCES, _FACTS, approved, after)
    assert not authority.settled_before(
        "AMBIGUOUS", text, stored, _SOURCES, _FACTS, approved, before
    )


def test_a_missing_or_ambiguous_fact_is_always_raised() -> None:
    missing = _issue("MISSING", quotes=[], detail="No approval threshold is stated.")
    assert authority.not_raised(missing, _SOURCES, _FACTS) == ""
    assert authority.not_raised(_issue("AMBIGUOUS", quotes=[]), _SOURCES, _FACTS) == ""
    # covered_by keeps nothing from a person here: an agent that believes a confirmed fact
    # settles the matter does not raise the issue; one it raised is seen.
    for kind in ("MISSING", "AMBIGUOUS"):
        assert authority.not_raised(_issue(kind, covered_by=["U1", "U2"]), _SOURCES, _FACTS) == ""
    # Nor do its words: a disagreement with the understanding described as unclear is seen.
    renamed = _issue(
        "AMBIGUOUS",
        quotes=[],
        detail="The RCM record names Active Directory, which conflicts with the walkthrough "
        "answer that the ticket history shows the grant.",
    )
    assert authority.not_raised(renamed, _SOURCES, _FACTS) == ""
    kept, left, _named = control_attributes._screened(
        [missing, renamed, _issue("MISSING", covered_by=["U1"])], _SOURCES, _FACTS, None, {}
    )
    assert [item.kind for item in kept] == ["MISSING", "AMBIGUOUS", "MISSING"] and left == []


def test_what_an_agent_says_it_followed_is_checked_against_the_records() -> None:
    said = authority.Follows.model_validate(_SAID)
    record, backwards = authority.recorded(said, _FACTS)
    assert record is not None and not backwards
    # The fact, its date, who confirmed it and its answer are the records'; the agent's
    # words are kept beside them, as the agent's.
    assert (record.follows.kind, record.follows.confirmed_at) == ("WALKTHROUGH_ANSWER", _AT)
    assert (record.follows.answer, record.follows.statement) == (TICKETS, FOLLOWED)
    assert record.follows.fact_mark == authority.fact_mark(_NEWER)
    [aside] = record.sets_aside
    assert (aside.answer, aside.statement, aside.confirmed_by) == (AD_ANSWER, SET_ASIDE, "PERSON")
    assert aside.confirmed_at == _AT - timedelta(days=14)
    # The older fact followed over the newer: refused.
    turned = said.model_copy(
        update={
            "fact": "U2",
            "sets_aside": [authority.SetAsideSaid(kind="OLDER_ANSWER", fact="U1")],
        }
    )
    assert authority.recorded(turned, _FACTS) == (None, True)
    # A fact the records filled in never overrides a person's answer, whatever its date;
    # a person's answer holds over it.
    facts = (*_FACTS, _BY_RECORDS)
    over_person = said.model_copy(update={"fact": "U3"})
    assert authority.recorded(over_person, facts) == (None, True)
    over_records = said.model_copy(
        update={"sets_aside": [authority.SetAsideSaid(kind="OLDER_ANSWER", fact="U3")]}
    )
    kept, backwards = authority.recorded(over_records, facts)
    assert kept is not None and not backwards
    assert kept.sets_aside[0].confirmed_by == "RECORDS"
    # A fact that is not on record, nothing set aside, or a credential: no record.
    assert authority.recorded(said.model_copy(update={"fact": "U7"}), _FACTS) == (None, False)
    assert authority.recorded(said.model_copy(update={"sets_aside": []}), _FACTS) == (None, False)
    secret = said.model_copy(update={"why": "The password is password=hunter2secret"})
    assert authority.recorded(secret, _FACTS) == (None, False)
    assert authority.recorded(None, _FACTS) == (None, False)


def test_the_record_is_given_back_only_while_it_is_true() -> None:
    record, _backwards = authority.recorded(authority.Follows.model_validate(_SAID), _FACTS)
    assert record is not None
    words = authority.mark("A", "c", "p", "f", False)
    kept = authority.stored(record, "independent-reviewer", None, "attribute-review/3", words)
    shown = authority.current(kept, words, _FACTS)
    assert shown is not None and shown.follows.answer == TICKETS
    assert shown.by == "independent-reviewer"
    assert "fact_mark" not in shown.model_dump()["follows"]
    # The attribute's words changed.
    assert authority.current(kept, authority.mark("A", "c", "p", "other", False), _FACTS) is None
    # The fact it follows was withdrawn, answered again with another answer, or confirmed
    # again at another time.
    assert authority.current(kept, words, (_OLDER,)) is None
    assert authority.current(kept, words, (replace(_NEWER, answer=SNAPSHOTS), _OLDER)) is None
    again = replace(_NEWER, confirmed_at=_AT + timedelta(minutes=5))
    assert authority.current(kept, words, (again, _OLDER)) is None
    # The answer it set aside changed, or is now the one that holds.
    assert authority.current(kept, words, (_NEWER, replace(_OLDER, answer="Another"))) is None
    later = replace(_OLDER, confirmed_at=_AT + timedelta(days=1))
    assert authority.current(kept, words, (_NEWER, later)) is None
    assert authority.current(kept, words, (_NEWER,)) is None
    assert authority.current({"follows": "not a record"}, "0" * 64, _FACTS) is None


def _documents(team: dict[str, Any], control: str) -> tuple[str, str]:
    ids = []
    for source in (_POLICY, _PROCEDURE):
        written = team["owner"].post(
            f"{_project(team)}/source-documents",
            json={
                "kind": source.kind,
                "title": source.title,
                "text": source.text,
                "control_ids": [control],
            },
        )
        assert written.status_code == 200, written.text
        ids.append(str(written.json()["document"]["id"]))
    return ids[0], ids[1]


def _retention(policy: str, procedure: str, suggestions: list[str], **more: Any) -> dict[str, Any]:
    return {
        "kind": "CONFLICT",
        "topic": "Retention of approved requests",
        "detail": "The policy keeps approved requests seven years, the procedure three.",
        "why": "The retention period decides whether older samples can be evidenced.",
        "resolve": "Confirm the retention period with the control owner.",
        "quotes": [
            {"source": policy, "quote": "kept for seven years"},
            {"source": procedure, "quote": "kept for three years"},
        ],
        "question": "Which retention period applies?",
        "proposal": "Seven years.",
        "proposal_basis": "SOURCES",
        "suggestions": suggestions,
        "covered_by": [],
        **more,
    }


def test_a_conflict_between_two_documents_is_raised_with_one_statement_per_side(
    migrated: Database,
) -> None:
    team, control, client, _a3 = _case(migrated, "uia-conflict")
    _walkthrough_confirmed(migrated, team, control, client)
    policy, procedure = _documents(team, control)
    statements = [
        "Approved requests are kept for seven years.",
        "Approved requests are kept for three years.",
    ]
    agents = _Understood(migrated, team, control)
    # In words that name a confirmed answer, too: two documents that disagree are raised.
    agents.answer = lambda facts: {
        "attributes": [],
        "issues": [
            _retention(
                policy,
                procedure,
                statements,
                detail="The policy says seven years and the procedure three; the walkthrough "
                "answer does not say which.",
            ),
            CONFLICT,
        ],
    }
    _inline(migrated, team, control, agents)
    [issue] = _open(team, control)
    assert (issue["kind"], issue["origin"], issue["topic"]) == (
        "CONFLICT",
        "ATTRIBUTES",
        "Retention of approved requests",
    )
    # Every side is a ready choice, beside the quotes; a conflict asks no open question.
    assert issue["suggestions"] == statements
    assert [quote["source"] for quote in issue["quotes"]] == [policy, procedure]
    assert (issue["question"], issue["proposal"], issue["proposal_basis"]) == ("", "", "")
    # A real conflict is a question for the person, and it does hold the attributes.
    assert [need["key"] for need in _needs(team, control) if need["kind"] == "QUESTION"] == [
        issue["id"]
    ]
    [audit] = _followed_audit(migrated, control)
    assert [item["topic"] for item in audit[2]["not_raised"]] == [TOPIC]

    # The agent's statements are used only when there is exactly one per source quoted:
    # with one, or with three for two sides, each side is offered in its source's own words.
    by_quote = [
        "Access policy says: kept for seven years.",
        "Access procedure says: kept for three years.",
    ]
    for given in (["Seven years."], [*statements, "Approved requests are kept for five years."]):
        agents.answer = lambda facts, given=given: {
            "attributes": [],
            "issues": [_retention(policy, procedure, given)],
        }
        _inline(migrated, team, control, agents)
        # Raised again by the next run, it is the run's own question replaced, as always.
        [again] = _open(team, control)
        assert again["id"] != issue["id"] and again["kind"] == "CONFLICT"
        assert again["suggestions"] == by_quote


# What the rules settle is closed by the agent's next run


def _open_issue(
    connection: Any,
    team: dict[str, Any],
    control: str,
    origin: Any,
    raised_by: str,
    kind: Any,
    topic: str,
    detail: str,
    quotes: list[dict[str, str]],
    question: str = "",
) -> UUID:
    from ai_workforce_api.control_context import Citation, Issue, fingerprint

    # The fingerprint the run itself would have stored for it.
    mark = fingerprint(
        Issue(
            origin,
            kind,
            topic,
            detail,
            "",
            "",
            tuple(Citation(q["source"], q["title"], q["quote"]) for q in quotes),
        )
    )
    row = connection.execute(
        """
        INSERT INTO control_context_issues (
            organization_id, project_id, engagement_control_id, origin, kind, topic, detail,
            why, resolve, quotes, fingerprint, raised_by, question
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        RETURNING id
        """,
        (
            team["org"],
            team["project"],
            control,
            origin,
            kind,
            topic,
            detail,
            str(CONFLICT["why"]),
            str(CONFLICT["resolve"]),
            json.dumps(quotes),
            mark,
            raised_by,
            question,
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def test_an_open_conflict_from_before_is_closed_only_for_a_reason_that_is_true_of_it(
    migrated: Database,
) -> None:
    team, control, client, _a3 = _case(migrated, "uia-stale")
    _walkthrough_confirmed(migrated, team, control, client)
    policy, procedure = _documents(team, control)
    rcm_quote = [{"source": "control", "title": "ITGC-AC-01 (RCM record)", "quote": A3}]
    two = [
        {"source": policy, "title": "Access policy", "quote": "kept for seven years"},
        {"source": procedure, "title": "Access procedure", "quote": "kept for three years"},
    ]
    with connect(migrated.url) as connection:
        # The conflict as the attribute agent raised it before the change: one source, and
        # its own words name the team's answer and the walkthrough as the other side.
        stale = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT", TOPIC,
            str(CONFLICT["detail"]), rcm_quote,
        )  # fmt: skip
        # One source too, but nothing in it shows a confirmed fact is its other side.
        neutral = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT",
            "Record of the grant date", str(NEUTRAL["detail"]), rcm_quote,
        )  # fmt: skip
        # Two documents that disagree, which the agent returns again naming the confirmed
        # fact that settles it; and two that it does not return at all.
        named = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT",
            "Retention of approved requests", "The policy and the procedure differ.", two,
        )  # fmt: skip
        real = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT",
            "Retention of rejected requests", "The policy and the procedure differ.", two,
        )  # fmt: skip
        # Not the attribute run's: the rules' conflict, and the narrative agents' point.
        rules = _open_issue(
            connection, team, control, "SOURCES", "RULES", "CONFLICT", "Frequency",
            "The RCM says monthly; the policy says quarterly.", rcm_quote,
        )  # fmt: skip
        point = _open_issue(
            connection, team, control, "PROCESS", "AGENT", "CONFLICT", "Grant record",
            "The team's answer and the walkthrough answer name different records.", [],
            "Which record holds the grant date?",
        )  # fmt: skip
        connection.commit()
    before = {row[8]: row for row in _issues(migrated, control)}
    # Until the next run, the conflict is still a question in Control Understanding.
    assert str(stale) in [need["key"] for need in _needs(team, control)]
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {
        "attributes": [],
        "issues": [
            _retention(policy, procedure, [], covered_by=[_ref(facts, TICKETS)]),
        ],
    }
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
        planner = agent_actor(connection, team["project"], "engagement-planner")
    after = {row[8]: row for row in _issues(migrated, control)}
    # Closed by the agent, with the reason on the row: not resolved, and not by a person.
    # The row's version moves with the write.
    for settled in (stale, named):
        assert after[settled][3:8] == ("SUPERSEDED", "AGENT", authority.SETTLED_NOTE, None, None)
        assert after[settled][9] == before[settled][9] + 2
    assert "newer answer holds" in authority.SETTLED_NOTE
    # The others are replaced as every run replaces its own questions, with no claim that
    # the understanding settled them: the claim would not be true of them.
    for replaced in (neutral, real):
        assert after[replaced][3:8] == ("SUPERSEDED", "AGENT", "", None, None)
        assert after[replaced][9] == before[replaced][9] + 1
    # Another origin's, the rules', and a person's answers are untouched.
    assert after[rules] == before[rules] and after[point] == before[point]
    assert all(after[key] == row for key, row in before.items() if row[3] == "RESOLVED")
    [audit] = _followed_audit(migrated, control)
    assert (audit[0], audit[1]) == (None, planner) and planner is not None
    closed = {item["issue"]: item for item in audit[2]["closed"]}
    assert set(closed) == {str(stale), str(named)}
    assert "fewer than two sources" in closed[str(stale)]["reason"]
    assert closed[str(named)]["reason"] == "The agent named the confirmed fact that settles it."
    assert all(item["note"] == authority.SETTLED_NOTE for item in closed.values())
    # No person's resolution was recorded for it.
    assert _rows(
        migrated,
        "SELECT count(*) FROM audit_events WHERE target_id = %s "
        "AND action = 'context.issue_resolved'",
        stale,
    ) == [(0,)]
    needs = [need["key"] for need in _needs(team, control) if need["kind"] == "QUESTION"]
    assert str(stale) not in needs and str(point) in needs
    assert [item["id"] for item in _open(team, control) if item["origin"] == "ATTRIBUTES"] == []


# A missing fact is always asked


def test_a_missing_fact_is_asked_even_when_the_agent_names_a_fact_for_it(
    migrated: Database,
) -> None:
    team, control, client, _a3 = _case(migrated, "uia-missing")
    _walkthrough_confirmed(migrated, team, control, client)
    gap = {
        "kind": "MISSING",
        "topic": "Emergency access",
        "quotes": [],
        "detail": "How emergency access is approved after the event is not stated.",
        "why": "Emergency grants are tested against the approval that follows them.",
        "resolve": "Confirm how emergency access is approved.",
        "question": "How is emergency access approved after it is granted?",
        "proposal": "The application owner approves emergency access within one business day.",
        "proposal_basis": "TYPICAL",
        "suggestions": ["Emergency access is not used for this system."],
        "covered_by": [],
    }
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {
        "attributes": [],
        # The second names a confirmed fact: for a missing fact that suppresses nothing.
        "issues": [gap, {**gap, "topic": "Grant record", "covered_by": [facts[0]["ref"]]}],
    }
    _inline(migrated, team, control, agents)
    opened = [row for row in _issues(migrated, control) if row[3] == "OPEN"]
    assert [(row[0], row[1], row[2]) for row in opened] == [
        ("Emergency access", "ATTRIBUTES", "MISSING"),
        ("Grant record", "ATTRIBUTES", "MISSING"),
    ]
    questions = [need for need in _needs(team, control) if need["kind"] == "QUESTION"]
    assert [need["question"] for need in questions] == [gap["question"], gap["question"]]
    issue = _open(team, control)[0]
    # The usual practice to confirm, and another answer to pick.
    assert (issue["proposal"], issue["proposal_basis"], issue["suggestions"]) == (
        gap["proposal"],
        "TYPICAL",
        gap["suggestions"],
    )
    # Nothing was left unraised, so the run has nothing to record about the understanding.
    assert _followed_audit(migrated, control) == []


# The reviewers keep every power


def test_the_reviewer_of_the_drafts_corrects_or_leaves_out_a_followed_draft_like_any_other(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-draft-reviewer")
    _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    added = "The ticket history names who granted the access"

    def drafted(facts: list[dict[str, Any]]) -> dict[str, Any]:
        change = _change(a3_id, facts)
        return {
            "attributes": [
                # An invented figure in its criteria.
                {**change, "pass_criteria": TICKET_CRITERIA["pass_criteria"] + " Within 3 days."},
                # A duplicate of the change, as an addition that also says it follows.
                {**change, "action": "ADD", "replaces": "", "text": added},
            ],
            "issues": [],
        }

    agents.answer = drafted
    # The reviewer takes the invented figure out and leaves the duplicate out.
    agents.redraft = lambda drafts: [
        {**drafts[0], "pass_criteria": TICKET_CRITERIA["pass_criteria"]}
    ]
    _inline(migrated, team, control, agents)
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["proposal"] == "CHANGE" and "3 days" not in proposed["pass_criteria"]
    assert proposed["understanding_basis"]["by"] == "independent-reviewer"
    [audit] = _followed_audit(migrated, control)
    # The draft left out is on the audit trail, with what it said it followed.
    [left] = audit[2]["left_out_by_reviewer"]
    assert (left["action"], left["text"]) == ("ADD", added)
    assert left["follows"]["key"] == GAP

    # The reviewer leaves the followed change out altogether: it is left out. Nothing puts
    # it back, and the audit trail says what happened.
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    agents.redraft = lambda drafts: []
    _inline(migrated, team, control, agents)
    assert _attributes(team, control)["proposed"] == []
    last = _followed_audit(migrated, control)[-1][2]
    assert last["followed"] == []
    assert [(item["action"], item["replaces"]) for item in last["left_out_by_reviewer"]] == [
        ("CHANGE", str(a3_id))
    ]

    # The reviewer keeps the draft but not what it says it follows: stored without a line.
    agents.redraft = lambda drafts: [
        {key: value for key, value in drafts[0].items() if key != "follows"}
    ]
    _inline(migrated, team, control, agents)
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["text"] == A3_FOLLOWS and proposed["understanding_basis"] is None

    # Criteria a tester could not apply are not kept because the draft says it follows the
    # understanding: the server's own check stands, as for any draft.
    agents.answer = lambda facts: {
        "attributes": [
            {**_change(a3_id, facts), "pass_criteria": "The approval is appropriate and timely."}
        ],
        "issues": [],
    }
    agents.redraft = None
    _inline(migrated, team, control, agents)
    [proposed] = _attributes(team, control)["proposed"]
    assert (proposed["condition"], proposed["pass_criteria"]) == ("", "")
    assert "The criteria need a person" in proposed["note"]


def test_the_reviewer_of_the_set_revises_merges_and_questions_a_followed_attribute(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-set-reviewer")
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    added = "The ticket history names who granted the access"

    def drafted(facts: list[dict[str, Any]]) -> dict[str, Any]:
        change = _change(a3_id, facts)
        return {
            "attributes": [change, {**change, "action": "ADD", "replaces": "", "text": added}],
            "issues": [],
        }

    agents.answer = drafted
    tighter = {
        "condition": TICKET_CRITERIA["condition"],
        "pass_criteria": (
            "Each approval time-stamp on the ServiceNow request is earlier than the first "
            "grant entry in its ticket history."
        ),
        "fail_criteria": TICKET_CRITERIA["fail_criteria"],
    }

    def review(given: dict[str, Any]) -> dict[str, Any]:
        change = next(item for item in given["attributes"] if item["state"] == "AGENT_REWORDS")
        addition = next(item for item in given["attributes"] if item["state"] == "AGENT_ADDS")
        # Both say they follow the understanding, and both are the reviewer's to revise.
        assert change["follows_understanding"] and addition["follows_understanding"]
        assert change["may_revise"] == addition["may_revise"] == ["criteria", "text"]
        return {
            "attributes": [
                # A revision of the followed change: applied.
                {"id": change["id"], "verdict": "REVISED", "note": "Names the first entry.",
                 **tighter},
                # The followed addition repeats it: merged away, as any duplicate.
                {"id": addition["id"], "verdict": "DUPLICATE", "duplicate_of": change["id"],
                 "note": "It is the change again.", **tighter},
            ],
            "findings": [],
        }  # fmt: skip

    agents.review = review
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    [proposed] = _attributes(team, control)["proposed"]
    assert (
        proposed["proposal"] == "CHANGE" and proposed["pass_criteria"] == tighter["pass_criteria"]
    )
    assert proposed["review"]["verdict"] == "REVISED"
    # The agent's line explained other criteria: it is not shown for the reviewer's.
    assert proposed["understanding_basis"] is None
    assert _rows(
        migrated,
        "SELECT status FROM control_attributes WHERE engagement_control_id = %s AND text = %s",
        UUID(control),
        added,
    ) == [("SUPERSEDED",)]

    def reviewed_with(answer: dict[str, Any]) -> dict[str, Any]:
        agents.review = lambda given: {"attributes": [answer], "findings": []}
        with connect(migrated.url) as connection:
            assert (
                attribute_review.review_set(
                    connection, agents, team["org"], team["project"], UUID(control),
                    team["owner_id"],
                )
                == ""
            )  # fmt: skip
            connection.commit()
        body = _attributes(team, control)
        return {**body["proposed"][0], "concerns": body["review_summary"]["concerns"]}

    # A fresh followed change, with its line shown.
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    agents.review = lambda given: {"attributes": [], "findings": []}
    _inline(migrated, team, control, agents)
    [fresh] = _attributes(team, control)["proposed"]
    assert fresh["understanding_basis"] is not None
    # A revision with a figure the records do not give is refused, as for any attribute.
    invented = reviewed_with(
        {"id": fresh["id"], "verdict": "REVISED", "note": "Adds the deadline.",
         **{**tighter, "pass_criteria": tighter["pass_criteria"] + " Within 3 business days."}}
    )  # fmt: skip
    assert invented["review"]["verdict"] == "CONCERN"
    assert "figure or a citation" in invented["review"]["note"]
    assert invented["pass_criteria"] == TICKET_CRITERIA["pass_criteria"]
    # A concern is stored as a concern, whatever it questions: the standard, the RCM
    # record, or the answer the attribute follows.
    for note in (
        "The criteria are inconsistent with the standard.",
        "This contradicts the RCM record, which names Active Directory.",
        "The ticket history may not show the time of day.",
    ):
        concerned = reviewed_with({"id": fresh["id"], "verdict": "CONCERN", "note": note})
        assert concerned["review"] == {"verdict": "CONCERN", "note": note}
        assert concerned["concerns"] == 1
        # The line is still the agent's statement, shown beside the concern.
        assert concerned["understanding_basis"] is not None


# Nothing dropped is lost, also where the engagement has no instance of the agent


def test_without_an_agent_instance_the_record_is_written_as_the_other_agent_events_are(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-unstaffed")
    _walkthrough_confirmed(migrated, team, control, client)
    monkeypatch.setattr(control_attributes, "agent_actor", lambda *_args: None)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": [CONFLICT]}
    _inline(migrated, team, control, agents)
    # As attribute.proposed in the same run: under the person whose request started the
    # run, with the agent named in the payload. Still not a decision of theirs.
    [audit] = _followed_audit(migrated, control)
    assert (audit[0], audit[1]) == (team["owner_id"], None)
    assert audit[2]["by"] == "engagement-planner" and len(audit[2]["followed"]) == 1
    proposed_event = _rows(
        migrated,
        "SELECT actor_user_id, actor_agent_instance_id FROM audit_events "
        "WHERE target_id = %s AND action = 'attribute.proposed'",
        UUID(control),
    )
    assert proposed_event[-1] == (team["owner_id"], None)


# The planner


def test_a_figure_from_a_confirmed_answer_is_not_a_fabrication_and_the_prompt_stays_whole(
    migrated: Database,
) -> None:
    team, control, client, _a3 = _case(migrated, "uia-planner")
    _walkthrough_confirmed(migrated, team, control, client)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET resolution_note = %s "
            "WHERE engagement_control_id = %s AND resolution_note = %s",
            (AD_ANSWER + " Access is removed within 45 days.", control, AD_ANSWER),
        )
        connection.commit()
        planned = load_facts(connection, team["project"], UUID(control))
        facts = authority.facts(connection, UUID(control))
    assert planned.confirmed == facts
    # The planner is given the answered question, so a deadline it states from it comes
    # from the records: its plan is not rejected for it.
    stated = ["The request is closed within 45 days of the grant."]
    assert any("45 days" in fact.answer for fact in planned.confirmed)
    _check_fabrication(stated, check_sources(planned))
    with pytest.raises(ValueError, match="threshold or deadline no record gives"):
        _check_fabrication(stated, check_sources(replace(planned, confirmed=())))

    def data_of(given: Any) -> dict[str, Any]:
        prompt = prompt_for(given)
        text = prompt.split("<control>\n", 1)[1].rsplit("\n</control>", 1)[0]
        assert len(text) <= PROMPT_LIMIT
        found: dict[str, Any] = json.loads(text)
        return found

    whole = data_of(planned)
    assert [fact["ref"] for fact in whole["confirmed_understanding"]] == [f.ref for f in facts]
    # Where the walkthrough answers were, before the planner's other data.
    keys = list(whole)
    assert keys.index("confirmed_understanding") < keys.index("suggested_control_type")
    assert "decided_by_records" in whole and "sample_sizes" in whole
    # With more confirmed facts than fit, the newest are given whole and the oldest left
    # out: the limit never cuts through the facts or through what follows them.
    many = tuple(
        authority.Fact(
            f"U{n}",
            "ANSWERED_QUESTION",
            f"issue-{n}",
            f"Question number {n} about how the control runs at this client? " * 2,
            f"Answer number {n}, as the control owner confirmed it in the walkthrough. " * 3,
            datetime(2026, 11, 12, tzinfo=UTC) - timedelta(hours=n),
            "PERSON",
        )
        for n in range(1, 81)
    )
    fitted = data_of(replace(planned, confirmed=many))
    given = fitted["confirmed_understanding"]
    assert 12 <= len(given) < len(many)
    assert [fact["ref"] for fact in given] == [f"U{n}" for n in range(1, len(given) + 1)]
    assert fitted["decided_by_records"] == whole["decided_by_records"]
    assert fitted["sample_sizes"] == whole["sample_sizes"]


# Every agent that writes from the understanding is told the precedence


def test_every_agent_that_reads_the_understanding_is_given_the_precedence(
    migrated: Database,
) -> None:
    for prompt in (
        control_attributes.SYSTEM_PROMPT,
        control_attributes.REVIEW_PROMPT,
        attribute_review.SYSTEM_PROMPT,
        PLANNER_SYSTEM,
        process_narrative.DRAFTER_PROMPT,
        process_narrative.REVIEWER_PROMPT,
    ):
        assert authority.PRECEDENCE in prompt
    assert "the one with the later confirmed_at holds" in authority.PRECEDENCE
    assert "never overrides a PERSON fact" in authority.PRECEDENCE
    # The reviewers are told the precedence and given the facts; no instruction takes a
    # check away from them.
    for prompt in (control_attributes.REVIEW_PROMPT, attribute_review.SYSTEM_PROMPT):
        assert "never as CONCERN" not in prompt and "Never correct such a draft" not in prompt
    assert "exempts the draft from none of the checks" in control_attributes.REVIEW_PROMPT
    assert "exempts the attribute from no verdict" in attribute_review.SYSTEM_PROMPT
    assert "one plain statement per side" in control_attributes.SYSTEM_PROMPT
    assert "the confirmed facts that settle the matter" in control_attributes.SYSTEM_PROMPT
    assert "Leave all four empty for a conflict" not in control_attributes.SYSTEM_PROMPT
    assert (
        control_attributes.PROMPT_VERSION,
        control_attributes.REVIEW_PROMPT_VERSION,
        attribute_review.PROMPT_VERSION,
        PLANNER_PROMPT_VERSION,
        # "engagement-planner/9" since 12 November 2026 (the planner proposes which attributes
        # every D&I request addresses); "/8" was this increment's own bump, and still stands
        # for what this test is about: the planner reads confirmed_understanding. "/10"
        # since B1h the same day (the schema states its limits, a correction names the
        # failing places): nothing this test reads changed.
    ) == ("attributes/5", "attribute-review/3", "attribute-set-review/3", "engagement-planner/10")
    team, control, client, _a3 = _case(migrated, "uia-inputs")
    _walkthrough_confirmed(migrated, team, control, client)
    with connect(migrated.url) as connection:
        facts = authority.facts(connection, UUID(control))
        narrated = process_narrative._inputs(connection, team["project"], UUID(control))
    assert narrated["package"]["confirmed_understanding"] == authority.for_agents(facts)
    older = next(fact for fact in facts if fact.answer == AD_ANSWER)
    newer = next(fact for fact in facts if fact.answer == TICKETS)
    assert authority.holds_over(newer, older) and not authority.holds_over(older, newer)
    # A question marked not applicable, and a proposal, are not confirmed facts.
    assert all(fact.answer for fact in facts)
