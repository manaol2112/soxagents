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
held the attributes. Now the agents follow the understanding, the newer answer first, say
what they followed and set aside, and raise nothing for it."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

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
from ai_workforce_api.evidence_planning import SYSTEM_PROMPT as PLANNER_SYSTEM
from ai_workforce_api.evidence_planning import prompt_for
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
# Answered on 29 October: the older answer.
AD_ANSWER = (
    "The System administrator grants the role only after the ServiceNow approvals are "
    "complete, and the grant date and time is held in the Active Directory change log."
)
# Confirmed in the walkthrough on 11 and 12 November: the newer answers.
LOGGING, GAP = "wt-ac-change-logging", "wt-ac-change-logging-gap"
TICKETS = "The request tool's ticket history"
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
CONFLICT = {
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


def _context_of(prompt: str) -> dict[str, Any]:
    found: dict[str, Any] = json.loads(
        prompt.split("<control_context>\n", 1)[1].split("\n</control_context>", 1)[0]
    )
    return found


class _Understood(_Agents):
    """The run's agents, with an attribute agent that answers from the confirmed
    understanding it was given, and a reviewer of its drafts that may turn them back."""

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


def _change(a3_id: Any, facts: list[dict[str, Any]]) -> dict[str, Any]:
    """A3 tailored to the understanding: the sequence is tested against the ticket history,
    and the agent says what it followed and what it set aside."""
    return {
        "action": "CHANGE", "replaces": str(a3_id), "text": A3_FOLLOWS, "basis": "INFERRED",
        "source": "", "quote": "",
        "note": "The walkthrough names the ticket history as the record of the grant.",
        **TICKET_CRITERIA, "judgment_required": False,
        "follows": {
            "fact": _ref(facts, TICKETS),
            "statement": FOLLOWED,
            "sets_aside": [
                {"kind": "OLDER_ANSWER", "fact": _ref(facts, AD_ANSWER), "statement": SET_ASIDE},
                {"kind": "RCM_RECORD", "fact": "",
                 "statement": "the grant date and time of the access in Active Directory"},
            ],
            "why": WHY,
        },
    }  # fmt: skip


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
            connection, team["org"], team["project"], UUID(control), third[0],
            team["owner_id"], AttributeEdit(text=A3, version=int(third[1])),
        )  # fmt: skip
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
            (team["org"], team["project"], control, QUESTION, uuid4().hex, AD_ANSWER,
             team["owner_id"], QUESTION, AD_ANSWER),
        )  # fmt: skip
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


# (a) and (b): the case end to end


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
    # The agent tailors A3 and still tries to raise the conflict, as it did.
    agents.answer = lambda facts: {
        "attributes": [_change(a3_id, facts)],
        "issues": [CONFLICT],
    }
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
        planner = agent_actor(connection, team["project"], "engagement-planner")
    assert [who for who in agents.calls if who != "other"] == [
        "attributes", "draft-review", "planner", "set-review",
    ]  # fmt: skip

    # (b) Each fact reaches the agents with when it was confirmed, newest first, and the
    # older answer is marked as the older one.
    facts = agents.contexts[0]["confirmed_understanding"]
    assert {fact["kind"] for fact in facts} == {
        "WALKTHROUGH_ANSWER", "CONTROL_VALUE", "ANSWERED_QUESTION",
    }  # fmt: skip
    assert all(fact["confirmed_at"] and fact["confirmed_by"] for fact in facts)
    times = [fact["confirmed_at"] for fact in facts]
    assert times == sorted(times, reverse=True)
    assert [fact["ref"] for fact in facts] == [f"U{n}" for n in range(1, len(facts) + 1)]
    assert facts[0]["older"] is False
    older = next(fact for fact in facts if fact["answer"] == AD_ANSWER)
    newer = next(fact for fact in facts if fact["answer"] == TICKETS)
    assert (older["kind"], older["confirmed_by"], older["older"]) == (
        "ANSWERED_QUESTION", "PERSON", True,
    )  # fmt: skip
    assert older["question"] == QUESTION
    assert newer["kind"] == "WALKTHROUGH_ANSWER" and newer["confirmed_at"] > older["confirmed_at"]
    assert facts.index(newer) < facts.index(older)
    walkthrough = [fact for fact in facts if fact["kind"] == "WALKTHROUGH_ANSWER"]
    assert all(facts.index(fact) < facts.index(older) for fact in walkthrough)
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

    # (a) No issue is raised or left open, and nothing on record was deleted or rewritten.
    assert _issues(migrated, control) == answered_before
    assert all(row[0] != TOPIC for row in _issues(migrated, control))
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
        "CHANGE", str(a3_id), A3_FOLLOWS,
    )  # fmt: skip
    assert proposed["pass_criteria"] == TICKET_CRITERIA["pass_criteria"]
    approved = next(item for item in body["approved"] if item["id"] == str(a3_id))
    assert approved["text"] == A3 and approved["pass_criteria"] == AD_CRITERIA["pass_criteria"]
    assert approved["understanding_basis"] is None
    # What it follows and what it sets aside, per attribute, from the API: the dates and
    # kinds are the records', not the agent's.
    basis = proposed["understanding_basis"]
    assert basis["follows"]["kind"] == "WALKTHROUGH_ANSWER"
    assert (basis["follows"]["statement"], basis["follows"]["answer"]) == (FOLLOWED, TICKETS)
    assert basis["follows"]["key"] == GAP and basis["follows"]["confirmed_by"] == "PERSON"
    assert basis["summary"] == WHY and basis["by"] == "engagement-planner"
    first, second = basis["sets_aside"]
    assert (first["kind"], first["fact_kind"], first["statement"]) == (
        "OLDER_ANSWER", "ANSWERED_QUESTION", SET_ASIDE,
    )  # fmt: skip
    followed_at = datetime.fromisoformat(basis["follows"]["confirmed_at"])
    set_aside_at = datetime.fromisoformat(first["confirmed_at"])
    assert followed_at - set_aside_at > timedelta(days=13)
    assert (second["kind"], second["fact_kind"], second["confirmed_at"]) == (
        "RCM_RECORD", None, None,
    )  # fmt: skip
    # Stored with the proposal it explains, with the agent's model call.
    stored = _rows(
        migrated,
        "SELECT understanding_basis, model_call_id FROM control_attributes WHERE id = %s",
        UUID(proposed["id"]),
    )[0]
    assert stored[0]["model_call"] == str(stored[1]) and stored[0]["prompt_version"] == (
        "attributes/5"
    )
    # Audited as the agent's action: the agent is the actor, never a person.
    [audit] = _followed_audit(migrated, control)
    assert planner is not None
    assert (audit[0], audit[1]) == (None, planner)
    payload = audit[2]
    assert payload["by"] == "engagement-planner" and payload["prompt_version"] == "attributes/5"
    [entry] = payload["followed"]
    assert (entry["attribute"], entry["change"]) == (proposed["id"], "CHANGE")
    assert entry["follows"]["statement"] == FOLLOWED
    assert [item["statement"] for item in entry["sets_aside"]][0] == SET_ASIDE
    [left] = payload["not_raised"]
    assert (left["kind"], left["topic"]) == ("CONFLICT", TOPIC)
    assert "confirmed answer" in left["reason"]
    assert payload["closed"] == [] and payload["older_answer_followed_left_out"] == 0

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
    assert now["understanding_basis"]["follows"]["statement"] == FOLLOWED
    retired = next(item for item in after["history"] if item["id"] == str(a3_id))
    assert (retired["status"], retired["text"]) == ("RETIRED", A3)
    # The acceptance is the person's; the record of what the agent followed is not theirs.
    assert len(_followed_audit(migrated, control)) == 1


def test_the_line_is_not_shown_for_words_that_changed_after_it(migrated: Database) -> None:
    team, control, client, a3_id = _case(migrated, "uia-mark")
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    [proposed] = _attributes(team, control)["proposed"]
    assert proposed["understanding_basis"] is not None
    # A person rewords the proposal as they approve it: the agent's line explained other
    # words, so it is no longer shown. The record stays on the audit trail.
    decided = team["owner"].post(
        f"{_path(team, control)}/attributes/{proposed['id']}/decide",
        json={"decision": "APPROVE", "version": proposed["version"],
              "text": "Each approval is recorded before the grant shown in the ticket history"},
    )  # fmt: skip
    assert decided.status_code == 200, decided.text
    after = _attributes(team, control)
    now = next(item for item in after["approved"] if item["id"] == proposed["id"])
    assert now["understanding_basis"] is None
    assert len(_followed_audit(migrated, control)) == 1


def test_an_agent_that_follows_the_older_answer_over_the_newer_has_its_proposal_left_out(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-backwards")
    _walkthrough_confirmed(migrated, team, control, client)

    def backwards(facts: list[dict[str, Any]]) -> dict[str, Any]:
        change = _change(a3_id, facts)
        change["follows"] = {
            "fact": _ref(facts, AD_ANSWER),
            "statement": "The Active Directory change log holds the grant date.",
            "sets_aside": [
                {"kind": "OLDER_ANSWER", "fact": _ref(facts, TICKETS),
                 "statement": "the ticket history"},
            ],
            "why": "The earlier answer names Active Directory.",
        }  # fmt: skip
        return {"attributes": [{**change, **AD_CRITERIA, "text": A3 + " change log"}],
                "issues": []}  # fmt: skip

    agents = _Understood(migrated, team, control)
    agents.answer = backwards
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert _attributes(team, control)["proposed"] == []
    [audit] = _followed_audit(migrated, control)
    assert audit[2]["older_answer_followed_left_out"] == 1 and audit[2]["followed"] == []


# (c) The guard, with no model in it

_POLICY = Source(
    "doc-policy", "Access policy", "POLICY", "Approved requests are kept for seven years."
)
_PROCEDURE = Source(
    "doc-procedure", "Access procedure", "PROCEDURE", "Approved requests are kept for three years."
)
_RCM = Source("control", "ITGC-AC-01 (RCM record)", "RCM", f"Test attribute: {A3}")
_NARRATIVE = Source(
    "process-narrative", "Approved process narrative", "NARRATIVE",
    "Approved requests are kept for five years.",
)  # fmt: skip
_NOTES = Source(
    "doc-notes", "Walkthrough notes", "WALKTHROUGH", "Requests are kept for one year only."
)
_SOURCES = [_RCM, _POLICY, _PROCEDURE, _NARRATIVE, _NOTES]
_AT = datetime(2026, 11, 12, 16, 14, tzinfo=UTC)
_FACTS = (
    authority.Fact("U1", "WALKTHROUGH_ANSWER", GAP, "How is the grant shown?", TICKETS, _AT,
                   "PERSON", False),
    authority.Fact("U2", "ANSWERED_QUESTION", "issue", QUESTION, AD_ANSWER,
                   _AT - timedelta(days=14), "PERSON", True),
)  # fmt: skip


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


def test_a_conflict_is_raised_only_between_two_sources_the_understanding_is_silent_on() -> None:
    # Two documents disagree and no confirmed fact speaks to it: raised.
    assert authority.not_raised(_issue(), _SOURCES, _FACTS) == ""
    assert authority.not_raised(_issue(), _SOURCES, ()) == ""
    # The RCM record and a document disagree: two distinct sources, raised.
    both = _issue(quotes=[{"source": "control", "quote": A3},
                          {"source": "doc-policy", "quote": "kept for seven years"}])  # fmt: skip
    assert authority.not_raised(both, _SOURCES, _FACTS) == ""
    # The agent names a confirmed fact as covering it: settled by the understanding.
    assert "U1" in authority.not_raised(_issue(covered_by=["U1"]), _SOURCES, _FACTS)
    # A ref that is not on record covers nothing.
    assert authority.not_raised(_issue(covered_by=["U9"]), _SOURCES, _FACTS) == ""
    # Its own words name a confirmed answer as a side, however many sources it quotes.
    for said in (
        "The policy says seven years, but the walkthrough answer says three.",
        "The team's answer says three years; the policy says seven.",
        "The policy disagrees with the confirmed answer on retention.",
        "The procedure contradicts the Control Understanding.",
        f"The procedure says three years; elsewhere it is {TICKETS.lower()}.",
        "The walkthrough says requests are kept three years; the policy says seven.",
    ):
        assert authority.not_raised(_issue(detail=said), _SOURCES, _FACTS), said
    # Walkthrough notes are a document: quoted as a side, "the walkthrough says" is them.
    notes = _issue(
        detail="The walkthrough says requests are kept one year; the policy says seven.",
        quotes=[{"source": "doc-notes", "quote": "kept for one year only"},
                {"source": "doc-policy", "quote": "kept for seven years"}],
    )  # fmt: skip
    assert authority.not_raised(notes, _SOURCES, _FACTS) == ""
    # The approved narrative is the understanding: a conflict with it is not raised.
    narrative = _issue(
        quotes=[
            {"source": "process-narrative", "quote": "kept for five years"},
            {"source": "doc-policy", "quote": "kept for seven years"},
        ]
    )
    assert "narrative" in authority.not_raised(narrative, _SOURCES, _FACTS)
    # Only the RCM record is quoted, or a quote is not in its source: one source cannot
    # disagree with itself. With an understanding on record it is not raised.
    alone = _issue(quotes=[{"source": "control", "quote": A3}])
    assert "two distinct sources" in authority.not_raised(alone, _SOURCES, _FACTS)
    unfound = _issue(
        quotes=[
            {"source": "doc-policy", "quote": "kept for seven years"},
            {"source": "doc-procedure", "quote": "kept for nine years"},
        ]
    )
    assert "two distinct sources" in authority.not_raised(unfound, _SOURCES, _FACTS)
    assert "two distinct sources" in authority.not_raised(_issue(quotes=[]), _SOURCES, _FACTS)
    # Before any understanding exists it is ambiguity, as a conflict nobody could point to
    # already was (control_attributes._screened).
    kept, left = control_attributes._screened([alone], _SOURCES, ())
    assert left == [] and [item.kind for item in kept] == ["AMBIGUOUS"]
    kept, left = control_attributes._screened([alone, _issue()], _SOURCES, _FACTS)
    assert [item.kind for item in kept] == ["CONFLICT"]
    assert [(item["kind"], item["topic"]) for item in left] == [
        ("CONFLICT", "Retention of approved requests")
    ]
    # Values the records filled in are not a person's understanding yet, and a client value
    # is often a policy's or a tool's name: naming it does not make the understanding a side.
    value = authority.Fact(
        "U3", "CONTROL_VALUE", "access-policy", "Which policy governs access?",
        "The Information Security Policy for access", _AT, "RECORDS", False,
    )  # fmt: skip
    assert authority.not_raised(alone, _SOURCES, (value,)) == ""
    named = _issue(
        detail="The Information Security Policy for access says seven years, the procedure three."
    )
    assert authority.not_raised(named, _SOURCES, (*_FACTS, value)) == ""
    # The real one, word for word: not raised.
    real = AnswerIssue.model_validate(CONFLICT)
    assert authority.not_raised(real, _SOURCES, _FACTS)
    assert authority.not_raised(real, _SOURCES, ()), "its own words cite the understanding"


def test_a_missing_fact_is_raised_unless_a_confirmed_fact_covers_it() -> None:
    missing = _issue("MISSING", quotes=[], detail="No approval threshold is stated.")
    assert authority.not_raised(missing, _SOURCES, _FACTS) == ""
    assert authority.not_raised(_issue("AMBIGUOUS", quotes=[]), _SOURCES, _FACTS) == ""
    # What the walkthrough does not say is still a missing fact.
    unsaid = _issue("MISSING", quotes=[], detail="The walkthrough answers do not say who reviews.")
    assert authority.not_raised(unsaid, _SOURCES, _FACTS) == ""
    assert authority.not_raised(_issue("MISSING", covered_by=["U2"]), _SOURCES, _FACTS)
    # A conflict with the understanding raised under another name is not raised either.
    renamed = _issue(
        "AMBIGUOUS",
        detail="The RCM record names Active Directory, which conflicts with the walkthrough "
        "answer that the ticket history shows the grant.",
    )
    assert authority.not_raised(renamed, _SOURCES, _FACTS)


def test_what_an_agent_says_it_followed_is_checked_against_the_records() -> None:
    said = authority.Follows.model_validate(
        {"fact": "U1", "statement": FOLLOWED, "why": WHY,
         "sets_aside": [{"kind": "OLDER_ANSWER", "fact": "U2", "statement": SET_ASIDE}]}
    )  # fmt: skip
    record, backwards = authority.recorded(said, _FACTS)
    assert record is not None and not backwards
    assert (record.follows.kind, record.follows.confirmed_at) == ("WALKTHROUGH_ANSWER", _AT)
    assert record.sets_aside[0].confirmed_at == _AT - timedelta(days=14)
    # The older fact followed over the newer: refused.
    turned = said.model_copy(
        update={"fact": "U2",
                "sets_aside": [authority.SetAsideSaid(kind="OLDER_ANSWER", fact="U1")]}
    )  # fmt: skip
    assert authority.recorded(turned, _FACTS) == (None, True)
    # A fact that is not on record, nothing set aside, or a credential: no record.
    assert authority.recorded(said.model_copy(update={"fact": "U7"}), _FACTS) == (None, False)
    assert authority.recorded(said.model_copy(update={"sets_aside": []}), _FACTS) == (None, False)
    secret = said.model_copy(update={"why": "The password is password=hunter2secret"})
    assert authority.recorded(secret, _FACTS) == (None, False)
    assert authority.recorded(None, _FACTS) == (None, False)
    # The record is shown only while the attribute reads as it did.
    kept = authority.stored(record, "engagement-planner", None, "attributes/5",
                            authority.mark("A", "c", "p", "f", False))  # fmt: skip
    assert authority.current(kept, authority.mark("A", "c", "p", "f", False)) is not None
    assert authority.current(kept, authority.mark("A", "c", "p", "other", False)) is None
    assert authority.current({"follows": "not a record"}, "0" * 64) is None


def _documents(team: dict[str, Any], control: str) -> tuple[str, str]:
    ids = []
    for source in (_POLICY, _PROCEDURE):
        written = team["owner"].post(
            f"{_project(team)}/source-documents",
            json={"kind": source.kind, "title": source.title, "text": source.text,
                  "control_ids": [control]},
        )  # fmt: skip
        assert written.status_code == 200, written.text
        ids.append(str(written.json()["document"]["id"]))
    return ids[0], ids[1]


def _retention(policy: str, procedure: str, suggestions: list[str]) -> dict[str, Any]:
    return {
        "kind": "CONFLICT", "topic": "Retention of approved requests",
        "detail": "The policy keeps approved requests seven years, the procedure three.",
        "why": "The retention period decides whether older samples can be evidenced.",
        "resolve": "Confirm the retention period with the control owner.",
        "quotes": [{"source": policy, "quote": "kept for seven years"},
                   {"source": procedure, "quote": "kept for three years"}],
        "question": "Which retention period applies?", "proposal": "Seven years.",
        "proposal_basis": "SOURCES", "suggestions": suggestions, "covered_by": [],
    }  # fmt: skip


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
    agents.answer = lambda facts: {
        "attributes": [],
        "issues": [_retention(policy, procedure, statements), CONFLICT],
    }
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    body = team["owner"].get(f"{_path(team, control)}/context").json()
    [issue] = [item for item in body["issues"] if item["status"] == "OPEN"]
    assert (issue["kind"], issue["origin"], issue["topic"]) == (
        "CONFLICT", "ATTRIBUTES", "Retention of approved requests",
    )  # fmt: skip
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

    # Without statements from the agent, each side is offered in its source's own words.
    agents.answer = lambda facts: {
        "attributes": [],
        "issues": [_retention(policy, procedure, ["Seven years."])],
    }
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    body = team["owner"].get(f"{_path(team, control)}/context").json()
    # Raised again by the next run, it is the run's own question replaced, as always.
    [again] = [item for item in body["issues"] if item["status"] == "OPEN"]
    assert again["id"] != issue["id"] and again["kind"] == "CONFLICT"
    assert again["suggestions"] == [
        "Access policy says: kept for seven years.",
        "Access procedure says: kept for three years.",
    ]


# (d) What the rules settle is closed by the agent's next run


def _open_issue(
    connection: Any, team: dict[str, Any], control: str, origin: str, raised_by: str,
    kind: str, topic: str, detail: str, quotes: list[dict[str, str]], question: str = "",
) -> UUID:  # fmt: skip
    row = connection.execute(
        """
        INSERT INTO control_context_issues (
            organization_id, project_id, engagement_control_id, origin, kind, topic, detail,
            why, resolve, quotes, fingerprint, raised_by, question
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        RETURNING id
        """,
        (team["org"], team["project"], control, origin, kind, topic, detail,
         str(CONFLICT["why"]), str(CONFLICT["resolve"]), json.dumps(quotes), uuid4().hex,
         raised_by, question),
    ).fetchone()  # fmt: skip
    assert row is not None
    return UUID(str(row[0]))


def test_an_open_conflict_from_before_is_closed_by_the_agents_next_run_with_its_reason(
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
        # The conflict as the attribute agent raised it before the change.
        stale = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT", TOPIC,
            str(CONFLICT["detail"]), rcm_quote,
        )  # fmt: skip
        # Its own open conflict between two documents, which the rules do not settle.
        real = _open_issue(
            connection, team, control, "ATTRIBUTES", "AGENT", "CONFLICT",
            "Retention of approved requests", "The policy and the procedure differ.", two,
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
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
        planner = agent_actor(connection, team["project"], "engagement-planner")
    after = {row[8]: row for row in _issues(migrated, control)}
    # Closed by the agent, with the reason on the row: not resolved, and not by a person.
    assert after[stale][3:8] == ("SUPERSEDED", "AGENT", authority.SETTLED_NOTE, None, None)
    assert "newer answer holds" in authority.SETTLED_NOTE
    # Its other earlier question is replaced as every run replaces its own, with no claim
    # that the understanding settled it.
    assert after[real][3:8] == ("SUPERSEDED", "AGENT", "", None, None)
    # Another origin's, the rules', and a person's answers are untouched.
    assert after[rules] == before[rules] and after[point] == before[point]
    assert all(after[key] == row for key, row in before.items() if row[3] == "RESOLVED")
    [audit] = _followed_audit(migrated, control)
    assert (audit[0], audit[1]) == (None, planner) and planner is not None
    assert audit[2]["closed"] == [
        {"issue": str(stale), "kind": "CONFLICT", "topic": TOPIC,
         "note": authority.SETTLED_NOTE}
    ]  # fmt: skip
    # No person's resolution was recorded for it.
    assert _rows(
        migrated,
        "SELECT count(*) FROM audit_events WHERE target_id = %s "
        "AND action = 'context.issue_resolved'",
        stale,
    ) == [(0,)]
    needs = [need["key"] for need in _needs(team, control) if need["kind"] == "QUESTION"]
    assert str(stale) not in needs and str(point) in needs
    # The control's context no longer shows it; the understanding's answers are all there.
    open_now = [
        item["id"]
        for item in team["owner"].get(f"{_path(team, control)}/context").json()["issues"]
        if item["status"] == "OPEN"
    ]
    assert str(stale) not in open_now and str(real) not in open_now


# (e) A missing fact is still raised


def test_a_missing_fact_no_confirmed_answer_covers_is_still_asked(migrated: Database) -> None:
    team, control, client, _a3 = _case(migrated, "uia-missing")
    _walkthrough_confirmed(migrated, team, control, client)
    gap = {
        "kind": "MISSING", "topic": "Emergency access", "quotes": [],
        "detail": "How emergency access is approved after the event is not stated.",
        "why": "Emergency grants are tested against the approval that follows them.",
        "resolve": "Confirm how emergency access is approved.",
        "question": "How is emergency access approved after it is granted?",
        "proposal": "The application owner approves emergency access within one business day.",
        "proposal_basis": "TYPICAL",
        "suggestions": ["Emergency access is not used for this system."],
        "covered_by": [],
    }  # fmt: skip
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {
        "attributes": [],
        # The second names a confirmed fact as covering it, so it is not asked again.
        "issues": [gap, {**gap, "topic": "Grant record", "covered_by": [facts[0]["ref"]]}],
    }
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    opened = [row for row in _issues(migrated, control) if row[3] == "OPEN"]
    assert [(row[0], row[1], row[2]) for row in opened] == [
        ("Emergency access", "ATTRIBUTES", "MISSING")
    ]
    [question] = [need for need in _needs(team, control) if need["kind"] == "QUESTION"]
    assert question["question"] == gap["question"]
    issue = next(
        item
        for item in team["owner"].get(f"{_path(team, control)}/context").json()["issues"]
        if item["status"] == "OPEN"
    )
    # The usual practice to confirm, and another answer to pick.
    assert (issue["proposal"], issue["proposal_basis"], issue["suggestions"]) == (
        gap["proposal"], "TYPICAL", gap["suggestions"],
    )  # fmt: skip
    [audit] = _followed_audit(migrated, control)
    assert [item["topic"] for item in audit[2]["not_raised"]] == ["Grant record"]


# (f) The reviewers do not turn a followed answer back


def test_no_reviewer_turns_an_attribute_that_follows_the_newer_answer_back(
    migrated: Database,
) -> None:
    team, control, client, a3_id = _case(migrated, "uia-reviewers")
    plan_id = _walkthrough_confirmed(migrated, team, control, client)
    agents = _Understood(migrated, team, control)
    agents.answer = lambda facts: {"attributes": [_change(a3_id, facts)], "issues": []}
    # The reviewer of the drafts "corrects" it back to the RCM record and the older answer.
    agents.redraft = lambda drafts: [
        {**{key: value for key, value in drafts[0].items() if key != "follows"},
         "text": A3 + " change log", **AD_CRITERIA,
         "note": "The RCM record and the earlier answer name Active Directory."}
    ]  # fmt: skip

    def review(given: dict[str, Any]) -> dict[str, Any]:
        change = next(item for item in given["attributes"] if item["state"] == "AGENT_REWORDS")
        # It was told what the attribute follows, and may not revise it.
        assert change["follows_understanding"]["follows"] == FOLLOWED
        assert change["follows_understanding"]["sets_aside"][0] == {
            "kind": "OLDER_ANSWER", "what": SET_ASIDE,
        }  # fmt: skip
        assert change["may_revise"] == []
        # The reviewer of the set tries the same.
        return {
            "attributes": [
                {"id": change["id"], "verdict": "REVISED",
                 "note": "The RCM record names Active Directory.", **AD_CRITERIA}
            ],
            "findings": [],
        }  # fmt: skip

    agents.review = review
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    [proposed] = _attributes(team, control)["proposed"]
    # As the attribute agent wrote it: the ticket history, with its record.
    assert proposed["text"] == A3_FOLLOWS
    assert {key: proposed[key] for key in TICKET_CRITERIA} == TICKET_CRITERIA
    assert proposed["understanding_basis"]["follows"]["statement"] == FOLLOWED
    assert proposed["review"] == {"verdict": "OK", "note": attribute_review.FOLLOWS_NOTE}
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'attribute.proposed'",
        UUID(control),
    )
    assert any("kept as drafted" in fix for fix in audit[-1][0]["fixes"])
    # Nor is the precedence itself reported as a concern for the person.
    agents.review = lambda given: {
        "attributes": [
            {"id": proposed["id"], "verdict": "CONCERN",
             "note": "This contradicts the RCM record, which names Active Directory."}
        ],
        "findings": [],
    }  # fmt: skip
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
    assert body["proposed"][0]["review"] == {
        "verdict": "OK", "note": attribute_review.FOLLOWS_NOTE,
    }  # fmt: skip
    assert body["review_summary"]["concerns"] == 0
    # Another kind of concern about the same attribute is still the reviewer's to report.
    agents.review = lambda given: {
        "attributes": [
            {"id": proposed["id"], "verdict": "CONCERN",
             "note": "The ticket history may not show the time of day."}
        ],
        "findings": [],
    }  # fmt: skip
    with connect(migrated.url) as connection:
        attribute_review.review_set(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert _attributes(team, control)["proposed"][0]["review"]["verdict"] == "CONCERN"


def test_a_reviewer_may_correct_a_followed_draft_while_it_keeps_what_it_follows() -> None:
    said = {
        "fact": "U1",
        "statement": FOLLOWED,
        "why": WHY,
        "sets_aside": [{"kind": "OLDER_ANSWER", "fact": "U2", "statement": SET_ASIDE}],
    }
    draft = control_attributes._Proposal.model_validate(
        {"action": "CHANGE", "replaces": "a3", "text": A3_FOLLOWS, "basis": "INFERRED",
         **TICKET_CRITERIA, "follows": said}
    )  # fmt: skip
    other = control_attributes._Proposal.model_validate(
        {"action": "ADD", "text": "Another attribute", "basis": "INFERRED"}
    )
    # Corrected, still following the same fact: the reviewer's version stands.
    corrected = draft.model_copy(update={"pass_criteria": "A tighter pass criterion."})
    kept, fixes = control_attributes._keep_followed([draft, other], [corrected, other], _FACTS)
    assert kept == [corrected, other] and fixes == []
    # Left out, or returned without what it follows, or for another fact: as drafted.
    for returned in (
        [other],
        [draft.model_copy(update={"follows": None, "text": A3 + " change log"}), other],
        [draft.model_copy(update={"follows": authority.Follows.model_validate(
            {**said, "fact": "U2", "sets_aside": [{"kind": "RCM_RECORD", "statement": "x"}]}
        )}), other],
    ):  # fmt: skip
        kept, fixes = control_attributes._keep_followed([draft, other], returned, _FACTS)
        assert kept == [other, draft] and len(fixes) == 1
    # A draft that follows nothing is the reviewer's to correct or leave out, as before.
    plain = draft.model_copy(update={"follows": None})
    assert control_attributes._keep_followed([plain, other], [other], _FACTS) == ([other], [])


# (rule 8) Every agent that writes from the understanding is told the precedence


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
    assert "the one confirmed later holds" in authority.PRECEDENCE
    assert "one plain statement per side" in control_attributes.SYSTEM_PROMPT
    assert "Leave all four empty for a conflict" not in control_attributes.SYSTEM_PROMPT
    assert (
        control_attributes.PROMPT_VERSION,
        control_attributes.REVIEW_PROMPT_VERSION,
        attribute_review.PROMPT_VERSION,
        PLANNER_PROMPT_VERSION,
    ) == ("attributes/5", "attribute-review/3", "attribute-set-review/3", "engagement-planner/8")
    team, control, client, _a3 = _case(migrated, "uia-inputs")
    _walkthrough_confirmed(migrated, team, control, client)
    with connect(migrated.url) as connection:
        facts = authority.facts(connection, UUID(control))
        planned = load_facts(connection, team["project"], UUID(control))
        narrated = process_narrative._inputs(connection, team["project"], UUID(control))
    assert planned.confirmed == facts
    given = json.loads(prompt_for(planned).split("<control>\n", 1)[1].rsplit("\n</control>", 1)[0])
    # Last in the planner's data, so the length limit never costs it anything else.
    assert list(given)[-1] == "confirmed_understanding"
    assert [fact["ref"] for fact in given["confirmed_understanding"]] == [f.ref for f in facts]
    assert narrated["package"]["confirmed_understanding"] == authority.for_agents(facts)
    older = next(fact for fact in facts if fact.answer == AD_ANSWER)
    assert older.older and older.kind == "ANSWERED_QUESTION" and facts[0].older is False
    # A question marked not applicable, and a proposal, are not confirmed facts.
    assert all(fact.answer for fact in facts)
