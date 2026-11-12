"""The attributes follow the understanding (B1d; decided by the product owner on 12 November
2026, docs/control-workflow-plan.md). Once Control Understanding is complete, one background
run for the control proposes the attributes the understanding calls for, tailors every
attribute's criteria, and has the independent reviewer agent review the set, before a person
opens the Attributes step. The person then makes one decision per attribute, which approves
the agent's change and accepts its criteria together. Nothing an agent wrote is approved,
accepted or settled before that decision."""

import json
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import (
    Database,
    approve_control_plan,
    settle_attributes,
    walkthrough_value,
)
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _project, _rows
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api import attribute_review, control_attributes, process_narrative
from ai_workforce_api.auth import token_hash
from ai_workforce_api.context_routes import generate_reviewed, review_control
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import SYSTEM_PROMPT as PLANNER_SYSTEM
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.evidence_plans import (
    NOT_STARTED_NOTE,
    STOPPED_NOTE,
    UNUSABLE_NOTE,
    attributes_run,
    load_facts,
    open_plan_runs,
    queue_for_understanding,
    queue_unrefined_plans,
    reclaim_interrupted_plan_runs,
    replan_for_new_attributes,
    run_plan,
    understanding_due,
)
from ai_workforce_api.main import create_app
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest, _mismatch
from ai_workforce_api.pbc_drafting import LocalDraftScheduler
from ai_workforce_api.phase_release import attribute_waits, understanding_waits
from ai_workforce_api.settings import Settings
from ai_workforce_api.walkthrough_answers import answers_of, questions_asked, stands

__all__ = ["migrated"]

AC01 = "ITGC-AC-01"
AC02 = "ITGC-AC-02"
# Seen on ITGC-AC-02 on 12 November 2026: the agent added an attribute that was an approved
# one plus a detail (who performed the removal), and the reviewer passed it.
DUPLICATE = (
    "The leaver's SAP S/4HANA account was disabled or removed by a system administrator, as "
    "shown by the user recorded on the system's change record"
)
# The approved attribute's criteria made specific: who performed the removal, as shown by
# the user recorded on SAP S/4HANA's change record. Its wording is not touched.
MERGED = {
    "condition": "The SAP S/4HANA change record shows the leaver's account disabled or removed.",
    "pass_criteria": (
        "The change record shows the account disabled or removed, and the user recorded on "
        "it is a system administrator."
    ),
    "fail_criteria": (
        "No change record shows the account disabled or removed, or the user recorded on it "
        "is not a system administrator."
    ),
}
OPTIONAL = "wt-volume"
UPDATING = "The attributes are not settled: the agent is still updating them."
ADDED = "The access request ticket records the business justification for the role"


class _Scheduler:
    """A background worker that only notes what it was handed."""

    def __init__(self) -> None:
        self.plans: list[UUID] = []

    def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
        del sheet_ids

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        del draft_ids

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        self.plans.extend(plan_ids)


def _client(database: Database, user_id: UUID, scheduler: _Scheduler, model: bool) -> TestClient:
    """The owner's session on an app with a background worker, and a model configured or
    not. The key is not one: nothing in these requests calls the model."""
    configured: dict[str, Any] = (
        {"model_provider": "anthropic", "model_api_key": "not-a-key"} if model else {}
    )
    settings = Settings(database_url=database.url, session_cookie_secure=False, **configured)
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (user_id, token_hash(token)),
        )
    return TestClient(
        create_app(settings, draft_scheduler=scheduler), cookies={"aw_session": token}
    )


def _path(team: dict[str, Any], control: str) -> str:
    return f"{_project(team)}/controls/{control}"


def _answer_required(
    migrated: Database, team: dict[str, Any], control: str, client: TestClient
) -> None:
    """Answer every required walkthrough question through the route, as a person does: the
    save that answers the last one completes Control Understanding."""
    for _round in range(5):
        with connect(migrated.url) as connection:
            rows = answers_of(connection, UUID(control))
            waiting = [
                item
                for item in questions_asked(connection, UUID(control), rows)
                if item.required and not stands(rows.get(item.key), item)
            ]
        if not waiting:
            return
        saved = client.put(
            f"{_path(team, control)}/walkthrough-answers",
            json={
                "answers": {
                    item.key: {"value": walkthrough_value(item), "not_applicable": False}
                    for item in waiting
                }
            },
        )
        assert saved.status_code == 200, saved.text
    raise AssertionError("the walkthrough did not settle")


def _volume(team: dict[str, Any], control: str, client: TestClient, value: str) -> None:
    saved = client.put(
        f"{_path(team, control)}/walkthrough-answers",
        json={"answers": {OPTIONAL: {"value": value, "not_applicable": False}}},
    )
    assert saved.status_code == 200, saved.text


def _plan_run(migrated: Database, control: str) -> tuple[UUID, str, str]:
    row = _rows(
        migrated,
        "SELECT id, run_status, run_stage FROM evidence_plans WHERE engagement_control_id = %s",
        UUID(control),
    )[0]
    return UUID(str(row[0])), str(row[1]), str(row[2])


def _approved(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, text, criteria_origin, condition, pass_criteria, fail_criteria, version, "
        "criteria_accepted_at IS NOT NULL FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position, created_at",
        UUID(control),
    )


def _criteria(attribute: str, system: str = "ServiceNow") -> dict[str, Any]:
    return {
        "attribute": attribute,
        "condition": f"The {system} access request names the user and the role requested.",
        "pass_criteria": f"The user's manager approved the request in {system} before the grant.",
        "fail_criteria": "No approval is recorded, or the approval is dated after the grant.",
        "judgment_required": False,
    }


class _Agents:
    """A scripted model for the run's agents, told apart by their system prompt: the
    attribute agent, the reviewer of its drafts, the planner, and the reviewer of the set."""

    def __init__(self, database: Database, team: dict[str, Any], control: str) -> None:
        self.database, self.team, self.control = database, team, control
        self.calls: list[str] = []
        self.prompts: list[str] = []
        self.stages: list[tuple[str, tuple[str, str, str]]] = []
        self.proposals: list[dict[str, Any]] = []
        # The set reviewer's answer, from what it was given; None for a malformed answer.
        self.review: Any = lambda given: {"attributes": [], "findings": []}
        self.reviewed: list[dict[str, Any]] = []
        self.on_plan: Any = None
        # The planner's answer, when it is not the rules' plan with tailored criteria.
        self.plan: Any = None
        # The drafts as their reviewer returns them, when it corrects them.
        self.drafts: Any = None

    def _note(self, who: str) -> None:
        self.calls.append(who)
        with connect(self.database.url) as connection:
            self.stages.append((who, attributes_run(connection, UUID(self.control))))

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.prompts.append(request.prompt)
        if request.system == control_attributes.SYSTEM_PROMPT:
            self._note("attributes")
            return ModelRaw({"attributes": self.proposals, "issues": []}, (), 100, 100)
        if request.system == control_attributes.REVIEW_PROMPT:
            self._note("draft-review")
            drafts = self.proposals if self.drafts is None else self.drafts
            return ModelRaw({"attributes": drafts, "fixes": []}, (), 100, 100)
        if request.system == PLANNER_SYSTEM:
            self._note("planner")
            if self.plan is not None:
                return ModelRaw(self.plan(), (), 100, 100)
            with connect(self.database.url) as connection:
                facts = load_facts(connection, self.team["project"], UUID(self.control))
            output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
            output["criteria"] = [_criteria(text) for text in facts.criteria_writable]
            if self.on_plan is not None:
                hook, self.on_plan = self.on_plan, None
                hook()
            return ModelRaw(output, (), 100, 100)
        if request.system == attribute_review.SYSTEM_PROMPT:
            self._note("set-review")
            given = json.loads(
                request.prompt.split("<review_inputs>\n", 1)[1].rsplit("\n</review_inputs>", 1)[0]
            )
            self.reviewed.append(given)
            return ModelRaw(self.review(given), (), 100, 100)
        self.calls.append("other")
        return ModelRaw({}, (), 10, 10)


def _ready(
    migrated: Database, slug: str, ref: str = AC01
) -> tuple[dict[str, Any], str, _Scheduler, TestClient]:
    """A launched control whose attributes are approved and whose understanding lacks only
    its walkthrough, with the owner on an app that has a worker and a model."""
    team = _launched(migrated, slug)
    control = str(_control(team, ref)["id"])
    settle_attributes(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    scheduler = _Scheduler()
    return team, control, scheduler, _client(migrated, team["owner_id"], scheduler, True)


def test_completing_the_understanding_queues_one_run_and_the_attributes_wait_for_it(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "afu-queue")
    plan_id, status, _stage = _plan_run(migrated, control)
    assert status == "IDLE" and scheduler.plans == []
    with connect(migrated.url) as connection:
        assert UUID(control) in understanding_waits(connection, team["project"], UUID(control))
        assert not understanding_due(connection, team["project"], UUID(control))
        before = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
    assert "criteria tailored to this control" in before
    _answer_required(migrated, team, control, client)
    # Exactly one run, for this control's plan, however many saves it took.
    assert scheduler.plans == [plan_id]
    assert _plan_run(migrated, control)[1] == "PENDING"
    with connect(migrated.url) as connection:
        assert understanding_waits(connection, team["project"], UUID(control)) == {}
        assert attribute_waits(connection, team["project"], UUID(control)) == {
            UUID(control): UPDATING
        }
        assert attributes_run(connection, UUID(control)) == ("PENDING", "", "")
        # Not asked twice while it waits.
        assert queue_for_understanding(connection, team["project"], UUID(control)) is None
    read = client.get(f"{_path(team, control)}/context")
    assert read.status_code == 200, read.text
    assert (read.json()["attributes_run"], read.json()["attributes_stage"]) == ("PENDING", "")
    # Another save while the run waits queues nothing more.
    _volume(team, control, client, "25 to 100")
    assert scheduler.plans == [plan_id]
    # Nothing an agent does was done by queueing: no proposal, no criteria.
    assert all(row[2] is None for row in _approved(migrated, control))


def test_nothing_is_queued_without_a_model(migrated: Database) -> None:
    team = _launched(migrated, "afu-no-model")
    control = str(_control(team, AC01)["id"])
    settle_attributes(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    scheduler = _Scheduler()
    client = _client(migrated, team["owner_id"], scheduler, False)
    _answer_required(migrated, team, control, client)
    assert scheduler.plans == []
    assert _plan_run(migrated, control)[1] == "IDLE"
    with connect(migrated.url) as connection:
        assert understanding_waits(connection, team["project"], UUID(control)) == {}
        # The manual path stands: the wait says what a person does next.
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
        assert "criteria tailored to this control" in wait
    assert client.get(f"{_path(team, control)}/context").json()["attributes_run"] == ""


def test_the_run_proposes_tailors_and_reviews_and_one_decision_accepts_each_attribute(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "afu-run")
    owner = team["owner"]
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    assert scheduler.plans == [plan_id]
    approved = _approved(migrated, control)
    assert len(approved) >= 4, approved
    kept_id, vague_id, secret_id, weak_id = (row[0] for row in approved[:4])
    revised_id = approved[4][0] if len(approved) > 4 else None
    # A person's own criteria on one attribute: no agent writes over them.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = 'Kept by a person.', "
            "pass_criteria = 'Kept pass, by a person.', "
            "fail_criteria = 'Kept fail, by a person.', criteria_origin = 'PERSON' WHERE id = %s",
            (kept_id,),
        )
        connection.commit()
    agents = _Agents(migrated, team, control)
    agents.proposals = [
        {
            "action": "ADD", "replaces": "", "text": ADDED, "basis": "INFERRED", "source": "",
            "quote": "", "note": "The walkthrough says each request states its justification.",
            "condition": "The ServiceNow request has a business justification entered.",
            "pass_criteria": "The justification field of the ServiceNow request is filled in.",
            "fail_criteria": "The justification field of the ServiceNow request is empty.",
            "judgment_required": False,
        }
    ]  # fmt: skip

    def review(given: dict[str, Any]) -> dict[str, Any]:
        by_state = {item["state"]: item for item in given["attributes"]}
        added = by_state["AGENT_ADDS"]
        answers = [
            # A person's criteria: the reviewer may not revise them, so its revision is a
            # concern for the person.
            {"id": str(kept_id), "verdict": "REVISED", "note": "Name the approver's role.",
             "condition": "The ServiceNow request names the approving manager by role.",
             "pass_criteria": "The approving manager is the requester's line manager.",
             "fail_criteria": "The approver is not the requester's line manager."},
            # Not objectively testable: left out.
            {"id": str(vague_id), "verdict": "REVISED", "note": "Tighten the approval.",
             "condition": "The ServiceNow request is approved appropriately.",
             "pass_criteria": "The approval in ServiceNow is adequate and timely.",
             "fail_criteria": "The approval in ServiceNow is not appropriate."},
            # Holds a credential: left out.
            {"id": str(secret_id), "verdict": "REVISED", "note": "Name the account.",
             "condition": "The ServiceNow request is opened with password: Winter2026!x",
             "pass_criteria": "The request is opened by the service account in ServiceNow.",
             "fail_criteria": "The request is opened by another account in ServiceNow."},
            # Weaker: the fail criteria are gone.
            {"id": str(weak_id), "verdict": "REVISED", "note": "Simplify.",
             "condition": "The ServiceNow request exists for the access granted.",
             "pass_criteria": "A ServiceNow request exists for the access granted.",
             "fail_criteria": ""},
            # The agent's addition, reworded and its criteria corrected: kept.
            {"id": added["id"], "verdict": "REVISED", "note": "Names the ticket field.",
             "text": ADDED + " in ServiceNow",
             "condition": "The ServiceNow request has its business justification field filled.",
             "pass_criteria": "The business justification field names the reason for the role.",
             "fail_criteria": "The business justification field is empty or names no reason."},
            {"id": str(uuid4()), "verdict": "OK", "note": "Not an attribute of this control."},
        ]  # fmt: skip
        if revised_id is not None:
            answers.append(
                {"id": str(revised_id), "verdict": "CONCERN",
                 "note": "The walkthrough says contractors are approved by the sponsor."}
            )  # fmt: skip
        return {
            "attributes": answers,
            "findings": ["No attribute covers the periodic sponsor confirmation."],
        }

    agents.review = review
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The attribute agent, the reviewer of its drafts, the planner, then the reviewer of the
    # set, each under the stage the page shows.
    assert [who for who in agents.calls if who != "other"] == [
        "attributes", "draft-review", "planner", "set-review",
    ]  # fmt: skip
    stages = dict(agents.stages)
    assert stages["attributes"] == ("WORKING", "ATTRIBUTES", "")
    assert stages["planner"] == ("WORKING", "CRITERIA", "")
    assert stages["set-review"] == ("WORKING", "REVIEW", "")
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    # The reviewer read the control, its understanding, and the whole set with its criteria.
    given = agents.reviewed[0]
    # Rewritten for B1e (the product owner, 12 November 2026: "Newer answer wins", so the
    # agents get each fact with when it was confirmed). Old expectation: the reviewer was
    # given the confirmed answers undated, as "walkthrough_answers". New: they are in
    # "confirmed_understanding", each a WALKTHROUGH_ANSWER with its confirmed_at.
    answers = [
        fact for fact in given["confirmed_understanding"] if fact["kind"] == "WALKTHROUGH_ANSWER"
    ]
    assert answers and all(fact["confirmed_at"] for fact in answers)
    assert "walkthrough_answers" not in given and given["control"]["control_ref"] == AC01
    assert {item["state"] for item in given["attributes"]} == {"APPROVED", "AGENT_ADDS"}
    person = next(item for item in given["attributes"] if item["id"] == str(kept_id))
    assert person["may_revise"] == [] and person["criteria_stated_by"] == "PERSON"
    tailored = next(item for item in given["attributes"] if item["id"] == str(vague_id))
    assert tailored["may_revise"] == ["criteria"] and "ServiceNow" in str(tailored["criteria"])
    assert "standard" in tailored
    # The planner's criteria are the agent's, to accept; the person's are as they were.
    after = {row[0]: row for row in _approved(migrated, control)}
    assert after[kept_id][2:6] == (
        "PERSON", "Kept by a person.", "Kept pass, by a person.", "Kept fail, by a person.",
    )  # fmt: skip
    for attribute in (vague_id, secret_id, weak_id):
        assert after[attribute][2] == "AGENT" and after[attribute][7] is False
        # The reviewer's refused revisions changed nothing.
        assert after[attribute][4] == _criteria("x")["pass_criteria"]
    # The proposal stays a proposal, with the reviewer's wording and criteria.
    proposed = _rows(
        migrated,
        "SELECT id, text, status, criteria_origin, pass_criteria, version FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'PROPOSED'",
        UUID(control),
    )
    assert [(row[1], row[2], row[3]) for row in proposed] == [
        (ADDED + " in ServiceNow", "PROPOSED", "AGENT")
    ]
    assert proposed[0][4] == "The business justification field names the reason for the role."
    with connect(migrated.url) as connection:
        assert attribute_waits(connection, team["project"], UUID(control)) == {
            UUID(control): "The attributes are not settled: 1 proposed attribute waits for a "
            "decision."
        }
    # The attribute API: each row's review, and the set's.
    body = owner.get(f"{_path(team, control)}/context").json()["attributes"]
    rows = {item["id"]: item for item in [*body["approved"], *body["proposed"]]}
    assert rows[str(kept_id)]["review"]["verdict"] == "CONCERN"
    assert "a person must make" in rows[str(kept_id)]["review"]["note"]
    assert rows[str(vague_id)]["review"]["verdict"] == "CONCERN"
    assert "not objectively testable" in rows[str(vague_id)]["review"]["note"]
    assert "credential" in rows[str(secret_id)]["review"]["note"]
    assert "in full" in rows[str(weak_id)]["review"]["note"]
    assert rows[str(proposed[0][0])]["review"] == {
        "verdict": "REVISED", "note": "Names the ticket field.",
    }  # fmt: skip
    summary = body["review_summary"]
    assert summary["status"] == "REVIEWED" and summary["reviewer"] == "Reviewer agent"
    assert summary["findings"] == ["No attribute covers the periodic sponsor confirmation."]
    assert summary["concerns"] == (5 if revised_id is not None else 4)
    assert "Winter2026" not in json.dumps(body)
    # A reader cannot accept.
    with connect(migrated.url) as connection:
        reader = _add_user(connection, team["org"], "afu-reader@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], reader)
    items = [
        {"attribute_id": str(proposed[0][0]), "version": proposed[0][5]},
        *[
            {"attribute_id": str(row[0]), "version": row[6]}
            for row in after.values()
            if row[2] == "AGENT"
        ],
    ]
    refused = _session(migrated, reader).post(
        f"{_path(team, control)}/attributes/accept", json={"items": items}
    )
    assert refused.status_code in (403, 404)
    assert len(_approved(migrated, control)) == len(approved)
    # A stale version accepts nothing at all.
    stale = [{**items[0], "version": items[0]["version"] + 1}, *items[1:]]
    assert (
        owner.post(f"{_path(team, control)}/attributes/accept", json={"items": stale}).status_code
        == 409
    )
    assert all(row[7] is False for row in _approved(migrated, control))
    # One call: the addition is approved and every tailored set accepted, each on its own
    # record, by the person.
    accepted = owner.post(f"{_path(team, control)}/attributes/accept", json={"items": items})
    assert accepted.status_code == 200, accepted.text
    final = {row[0]: row for row in _approved(migrated, control)}
    assert len(final) == len(approved) + 1
    assert final[proposed[0][0]][1] == ADDED + " in ServiceNow"
    assert all(row[7] is True for key, row in final.items() if key != kept_id)
    audits = _rows(
        migrated,
        "SELECT action, target_id, actor_user_id, payload FROM audit_events "
        "WHERE project_id = %s AND action IN ('attribute.approved', "
        "'control_attribute.criteria_accepted', 'attributes.accepted') ORDER BY created_at, id",
        team["project"],
    )
    assert {row[2] for row in audits} == {team["owner_id"]}
    assert [row[1] for row in audits if row[0] == "attribute.approved"] == [proposed[0][0]]
    assert sorted(
        str(row[1]) for row in audits if row[0] == "control_attribute.criteria_accepted"
    ) == sorted(item["attribute_id"] for item in items)
    grouped = [row for row in audits if row[0] == "attributes.accepted"]
    assert len(grouped) == 1 and grouped[0][1] == UUID(control)
    assert grouped[0][3]["items"][0] == {
        "attribute": str(proposed[0][0]), "change": "ADD", "criteria_accepted": True,
    }  # fmt: skip
    with connect(migrated.url) as connection:
        # Settled only now, by the person's decisions.
        assert attribute_waits(connection, team["project"], UUID(control)) == {}
        # Every attribute's criteria are owned and nothing changed: nothing more is queued.
        assert not understanding_due(connection, team["project"], UUID(control))
        assert queue_for_understanding(connection, team["project"], UUID(control)) is None
    # Nothing left to accept on an attribute already accepted.
    again = owner.get(f"{_path(team, control)}/context").json()["attributes"]["approved"]
    one = next(item for item in again if item["id"] == str(vague_id))
    assert one["criteria_owned"] is True
    assert (
        owner.post(
            f"{_path(team, control)}/attributes/accept",
            json={"items": [{"attribute_id": one["id"], "version": one["version"]}]},
        ).status_code
        == 409
    )
    # The understanding changes: the agents follow it again, once.
    _volume(team, control, client, "101 to 250")
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control))[0] == "PENDING"
    assert scheduler.plans.count(plan_id) == 2


def test_a_review_that_does_not_finish_blocks_nothing_and_a_save_mid_run_is_read_once_more(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "afu-unreviewed")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    # Malformed: a verdict the schema does not have.
    agents.review = lambda given: {"attributes": [{"id": "x", "verdict": "FINE"}], "findings": []}
    # A person answers another question while the planner works.
    agents.on_plan = lambda: _volume(team, control, client, "25 to 100")
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The save was not queued (a run was working), so the run read it in a second pass, and
    # only one more.
    assert scheduler.plans == [plan_id]
    assert [who for who in agents.calls if who != "other"] == [
        "attributes", "planner", "set-review", "attributes", "planner", "set-review",
    ]  # fmt: skip
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    with connect(migrated.url) as connection:
        assert not understanding_due(connection, team["project"], UUID(control))
    # The drafts stand as drafted, to accept, and say they were not reviewed.
    rows = _approved(migrated, control)
    assert rows and all(row[2] == "AGENT" for row in rows)
    body = team["owner"].get(f"{_path(team, control)}/context").json()["attributes"]
    assert body["review_summary"]["status"] == "NOT_REVIEWED"
    assert "not reviewed" in body["review_summary"]["note"]
    assert all(item["review"] is None for item in body["approved"])
    note = _rows(migrated, "SELECT run_note FROM evidence_plans WHERE id = %s", plan_id)[0][0]
    assert "not reviewed" in note
    with connect(migrated.url) as connection:
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
    assert "criteria to accept" in wait


def test_an_approved_plan_keeps_its_attributes_and_gets_the_tailoring_as_a_proposed_change(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "afu-approved-plan")
    approve_control_plan(migrated, control)
    assert _rows(
        migrated,
        "SELECT status FROM evidence_plans WHERE engagement_control_id = %s",
        UUID(control),
    ) == [("APPROVED",)]
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    assert scheduler.plans == [plan_id]
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.review = lambda given: {
        "attributes": [
            {"id": str(first[0]), "verdict": "REVISED", "note": "Name the system.",
             "condition": "The ServiceNow request names the user and the SAP role requested.",
             "pass_criteria": "The request in ServiceNow names the user and the SAP role.",
             "fail_criteria": "The request in ServiceNow names no user or no SAP role."}
        ],
        "findings": [],
    }  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    assert "planner" in agents.calls and "set-review" in agents.calls
    # Nothing approved changed: the attributes have no agent criteria, and the planner's
    # tailoring waits on the plan as a change a person accepts.
    assert all(row[2] is None for row in _approved(migrated, control))
    plan = _rows(
        migrated,
        "SELECT status, pending_revision FROM evidence_plans WHERE id = %s",
        plan_id,
    )[0]
    assert plan[0] == "CHANGES_PROPOSED" and plan[1]["criteria"]
    # The reviewer was told it may not revise them, and its revision reads as a concern.
    given = agents.reviewed[0]
    assert all(item["may_revise"] == [] for item in given["attributes"])
    body = team["owner"].get(f"{_path(team, control)}/context").json()["attributes"]
    mark = next(item for item in body["approved"] if item["id"] == str(first[0]))["review"]
    assert mark["verdict"] == "CONCERN" and "Name the system." in mark["note"]


def test_a_planner_answer_that_cannot_be_used_ends_the_run_and_a_person_runs_it_again(
    migrated: Database,
) -> None:
    """Found with the real model on 12 November 2026: the planner's first answer missed the
    schema. The planner's own checks read such an answer and ask for a correction, twice;
    if it still breaks a rule the rules plan instead. The run must then end, say so, and
    leave nothing working."""
    team, control, scheduler, client = _ready(migrated, "afu-unusable")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    agents = _Agents(migrated, team, control)
    # An object where the schema asks for an array, and required parts missing.
    agents.plan = lambda: {"understanding": {}, "phases": {"DESIGN": []}}
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The first answer and both corrections, then the rules; the reviewer still reviews.
    assert agents.calls.count("planner") == 3 and agents.calls[-1] == "set-review"
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    row = _rows(migrated, "SELECT source, run_note FROM evidence_plans WHERE id = %s", plan_id)[0]
    assert row[0] == "FALLBACK" and str(row[1]).startswith(UNUSABLE_NOTE)
    # Why the answer was malformed is on the call's record, by the schema's names only.
    errors = [
        str(found[0])
        for found in _rows(
            migrated,
            "SELECT error FROM model_calls WHERE target_id = %s AND status = 'MALFORMED' "
            "AND prompt_version LIKE 'engagement-planner/%%'",
            UUID(control),
        )
    ]
    assert len(errors) == 3 and all(
        "(answer.understanding.summary: required, missing)" in e for e in errors
    )
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("STOPPED", "", UNUSABLE_NOTE)
        # Nothing was tailored, and it is not asked again by itself on every save.
        assert not understanding_due(connection, team["project"], UUID(control))
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
    assert "criteria tailored to this control" in wait
    assert all(row[2] is None for row in _approved(migrated, control))
    body = client.get(f"{_path(team, control)}/context").json()
    assert (body["attributes_run"], body["attributes_run_note"]) == ("STOPPED", UNUSABLE_NOTE)
    # "Run again" asks for the whole run, in the background, and says nothing is working
    # twice.
    again = client.post(f"{_path(team, control)}/attributes/generate")
    assert again.status_code == 200, again.text
    assert again.json()["attributes_run"] == "PENDING"
    assert scheduler.plans == [plan_id, plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    twice = client.post(f"{_path(team, control)}/attributes/generate")
    assert twice.status_code == 200 and "already updating" in twice.json()["note"]
    # Nothing new is queued; the run already queued is handed to the worker again, in case
    # the first handoff did not reach it (the claim is atomic, so it runs once).
    assert scheduler.plans == [plan_id, plan_id, plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    # This time the planner answers: the criteria are tailored and nothing reads stopped.
    good = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        assert run_plan(connection, good, plan_id) == "DONE"
        assert attributes_run(connection, UUID(control)) == ("", "", "")
    assert [who for who in good.calls if who != "other"] == ["attributes", "planner", "set-review"]
    assert all(row[2] == "AGENT" for row in _approved(migrated, control))


def test_a_run_whose_process_died_reads_as_stopped_and_resumes_when_the_worker_starts(
    migrated: Database,
) -> None:
    """Found on 12 November 2026: the API reloaded while a run worked, and the run stayed
    marked working, under a twenty-minute lease, with nobody working on it."""
    team, control, _scheduler, client = _ready(migrated, "afu-interrupted")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]

    def working(lease: str, attempts: int = 1) -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE evidence_plans SET run_status = 'WORKING', run_stage = 'CRITERIA', "
                f"run_attempts = %s, run_lease_until = clock_timestamp() + interval '{lease}' "
                "WHERE id = %s",
                (attempts, plan_id),
            )
            connection.commit()

    # The process dies in the planner's stage. While the lease lives the page shows the
    # stage; it cannot know yet.
    working("10 minutes")
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("WORKING", "CRITERIA", "")
        assert attribute_waits(connection, team["project"], UUID(control)) == {
            UUID(control): UPDATING
        }
    # Once the lease has run out nothing reads as working: the page says the run stopped.
    working("-1 minute")
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("STOPPED", "", STOPPED_NOTE)
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
        assert "still updating" not in wait
    body = team["owner"].get(f"{_path(team, control)}/context").json()
    assert (body["attributes_run"], body["attributes_run_note"]) == ("STOPPED", STOPPED_NOTE)
    # The local worker's start does not wait for the lease: the run left working by the
    # process that ended goes back to waiting, keeps its stage, and is handed to the worker.
    working("10 minutes")
    handed: list[UUID] = []

    def done(_id: UUID) -> str:
        return "DONE"

    def plan(found: UUID) -> str:
        handed.append(found)
        return "DONE"

    worker = LocalDraftScheduler(
        Settings(database_url=migrated.url),
        runner=done, scan=done, analyze=done, converse=done, test=done, workpaper=done,
        setup=done, review=done, scoping=done, plan=plan, prior=done, narrative=done,
        policy=done,
    )  # fmt: skip
    try:
        worker.resume()
    finally:
        worker._pool.shutdown(wait=True)
    assert handed == [plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "CRITERIA")
    with connect(migrated.url) as connection:
        assert plan_id in open_plan_runs(connection, team["project"])
    # Run for real, it starts again with the attributes, as the run it resumes did.
    agents = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    assert [who for who in agents.calls if who != "other"] == [
        "attributes",
        "planner",
        "set-review",
    ]
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    # A run out of attempts is not started a fourth time: it failed, and the page says so.
    working("10 minutes", attempts=3)
    with connect(migrated.url) as connection:
        assert reclaim_interrupted_plan_runs(connection) == 0
        assert attributes_run(connection, UUID(control)) == ("STOPPED", "", STOPPED_NOTE)
    assert _plan_run(migrated, control)[1:] == ("FAILED", "CRITERIA")
    # A person's "Run again" starts it over.
    again = client.post(f"{_path(team, control)}/attributes/generate")
    assert again.status_code == 200 and again.json()["attributes_run"] == "PENDING"
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")


def test_a_malformed_answer_says_where_it_broke_the_schema_and_nothing_of_the_answer() -> None:
    schema = {
        "type": "object",
        "properties": {
            "phases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"phase": {"type": "string"}, "size": {"type": "integer"}},
                    "required": ["phase"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["phases"],
        "additionalProperties": False,
    }
    assert _mismatch(schema, {"phases": [{"phase": "DESIGN", "size": 3}]}) is None
    assert _mismatch(schema, {}) == "answer.phases: required, missing"
    assert _mismatch(schema, {"phases": "[]"}) == "answer.phases: expected array, got string"
    assert (
        _mismatch(schema, {"phases": [{"phase": "DESIGN"}, {"phase": "X", "size": None}]})
        == "answer.phases[1].size: expected integer, got null"
    )
    # A property the schema does not have is not named: its name is the model's words.
    secret = _mismatch(schema, {"phases": [{"phase": "X", "password=hunter2": 1}]})
    assert secret == "answer.phases[0]: a property the schema does not have"
    assert _mismatch(schema, {"phases": [{"phase": True}]}) == (
        "answer.phases[0].phase: expected string, got boolean"
    )


def _duplicate_addition() -> dict[str, Any]:
    return {
        "action": "ADD", "replaces": "", "text": DUPLICATE, "basis": "INFERRED", "source": "",
        "quote": "", "note": "The walkthrough names who removes the access.",
        "condition": "The SAP S/4HANA change record names the user who made the change.",
        "pass_criteria": "The user recorded on the change record is a system administrator.",
        "fail_criteria": "The user recorded on the change record is not a system administrator.",
        "judgment_required": False,
    }  # fmt: skip


def _proposals(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, proposal, replaces_id, text, pass_criteria, criteria_origin, definition_key, "
        "version FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'PROPOSED' ORDER BY created_at",
        UUID(control),
    )


def _stored_review(migrated: Database, control: str) -> dict[str, Any]:
    found: dict[str, Any] = _rows(
        migrated,
        "SELECT attribute_review FROM evidence_plans WHERE engagement_control_id = %s",
        UUID(control),
    )[0][0]
    return found


def _as_duplicate_of(target: Any) -> Any:
    """The set reviewer's answer: the agent's addition repeats `target`, merged as MERGED."""

    def review(given: dict[str, Any]) -> dict[str, Any]:
        added = next(item for item in given["attributes"] if item["state"] == "AGENT_ADDS")
        return {
            "attributes": [
                {"id": added["id"], "verdict": "DUPLICATE", "duplicate_of": str(target),
                 "note": "It is the approved attribute plus who performed the removal.",
                 **MERGED}
            ],
            "findings": [],
        }  # fmt: skip

    return review


def test_a_duplicate_addition_only_makes_the_criteria_of_the_attribute_it_repeats_specific(
    migrated: Database,
) -> None:
    """ITGC-AC-02, 12 November 2026. The product owner: "I don't want to see duplicate
    attribute"; "If it already copies one, that means I only need to be specific on the
    criteria"."""
    team, control, _scheduler, client = _ready(migrated, "afu-duplicate", AC02)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]
    agents.review = _as_duplicate_of(first[0])
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The reviewer was shown the addition beside the attribute it repeats.
    given = agents.reviewed[0]
    assert [item["text"] for item in given["attributes"] if item["state"] == "AGENT_ADDS"] == [
        DUPLICATE
    ]
    # What the person sees: no addition and no rewording. The approved attribute keeps its
    # wording, and its criteria name the administrator recorded on the change record.
    assert _proposals(migrated, control) == []
    after = _approved(migrated, control)[0]
    assert (after[0], after[1]) == (first[0], first[1])
    assert after[2:6] == (
        "AGENT", MERGED["condition"], MERGED["pass_criteria"], MERGED["fail_criteria"],
    )  # fmt: skip
    assert "system administrator" in after[4] and "change record" in after[4]
    # The agent's criteria, to accept: nothing is settled by the run.
    assert after[7] is False
    dropped = _rows(
        migrated,
        "SELECT id, status FROM control_attributes WHERE engagement_control_id = %s AND text = %s",
        UUID(control),
        DUPLICATE,
    )
    assert [row[1] for row in dropped] == ["SUPERSEDED"]
    body = team["owner"].get(f"{_path(team, control)}/context").json()["attributes"]
    assert body["proposed"] == []
    assert body["approved"][0]["review"]["verdict"] == "REVISED"
    # The merge is in the stored review and on the audit trail.
    stored = _stored_review(migrated, control)
    assert stored["merges"] == [
        {
            "dropped": str(dropped[0][0]), "into": str(first[0]), "outcome": "CRITERIA",
            "wording": DUPLICATE,
            "note": "It is the approved attribute plus who performed the removal.",
        }
    ]  # fmt: skip
    audit = _rows(
        migrated,
        "SELECT actor_user_id, payload FROM audit_events WHERE target_id = %s "
        "AND action = 'attributes.reviewed'",
        UUID(control),
    )
    assert len(audit) == 1 and audit[0][1]["by"] == "independent-reviewer"
    assert audit[0][1]["merges"] == [
        {"dropped": str(dropped[0][0]), "into": str(first[0]), "outcome": "CRITERIA"}
    ]
    # One acceptance of the attribute's criteria, and no second attribute for the same thing.
    count = len(_approved(migrated, control))
    accepted = team["owner"].post(
        f"{_path(team, control)}/attributes/accept",
        json={"items": [{"attribute_id": str(first[0]), "version": after[6]}]},
    )
    assert accepted.status_code == 200, accepted.text
    final = _approved(migrated, control)
    assert len(final) == count
    assert (final[0][0], final[0][1], final[0][7]) == (first[0], first[1], True)


def test_a_duplicate_of_an_attribute_a_person_owns_is_dropped_and_kept_as_a_concern(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "afu-duplicate-owned", AC02)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    first = _approved(migrated, control)[0]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = 'Kept by a person.', "
            "pass_criteria = 'Kept pass, by a person.', "
            "fail_criteria = 'Kept fail, by a person.', criteria_origin = 'PERSON' WHERE id = %s",
            (first[0],),
        )
        connection.commit()
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]
    agents.review = _as_duplicate_of(first[0])
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The addition does not reach the person, and no change of their attribute is proposed.
    assert _proposals(migrated, control) == []
    kept = _approved(migrated, control)[0]
    assert kept[:6] == (
        first[0], first[1], "PERSON", "Kept by a person.", "Kept pass, by a person.",
        "Kept fail, by a person.",
    )  # fmt: skip
    dropped = _rows(
        migrated,
        "SELECT id, status, note, decided_by FROM control_attributes "
        "WHERE engagement_control_id = %s AND text = %s",
        UUID(control),
        DUPLICATE,
    )
    assert [(row[1], row[3]) for row in dropped] == [("SUPERSEDED", None)]
    assert "repeats another attribute" in dropped[0][2]
    # Kept on the record as a concern on the person's attribute (stored, not displayed).
    stored = _stored_review(migrated, control)
    assert [(m["dropped"], m["into"], m["outcome"]) for m in stored["merges"]] == [
        (str(dropped[0][0]), str(first[0]), "DROPPED")
    ]
    assert stored["items"][str(first[0])]["verdict"] == "CONCERN"
    assert "duplicate addition was left out" in stored["items"][str(first[0])]["note"]
    assert str(dropped[0][0]) not in stored["items"]
    with connect(migrated.url) as connection:
        wait = attribute_waits(connection, team["project"], UUID(control))[UUID(control)]
    assert "proposed attribute" not in wait


def test_a_duplicate_never_overwrites_the_criteria_of_a_change_proposed_for_the_attribute(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "afu-duplicate-fold", AC02)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    # A real difference in what is tested (another system), which stays a proposed change.
    reworded = (
        "The leaver's access to SAP S/4HANA and to its Fiori launchpad was disabled or removed"
    )
    change = {
        **_duplicate_addition(), "action": "CHANGE", "replaces": str(first[0]), "text": reworded,
    }  # fmt: skip
    agents.proposals = [change, _duplicate_addition()]
    agents.review = _as_duplicate_of(first[0])
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # One change of the attribute, in its own wording and with its own criteria: the
    # reviewer's criteria are the approved attribute's, and written over the change they
    # could contradict its wording. The duplicate goes; a person decides where the detail
    # belongs. Never a second proposal.
    proposals = _proposals(migrated, control)
    assert [(row[1], row[2], row[3], row[4]) for row in proposals] == [
        ("CHANGE", first[0], reworded, _duplicate_addition()["pass_criteria"])
    ]
    stored = _stored_review(migrated, control)
    assert [(m["into"], m["outcome"]) for m in stored["merges"]] == [
        (str(proposals[0][0]), "DROPPED")
    ]
    assert "a proposed change with criteria of its own" in stored["merges"][0]["note"]
    assert stored["items"][str(proposals[0][0])]["verdict"] == "CONCERN"
    # The approved attribute's own criteria are the planner's, untouched by the merge.
    assert _approved(migrated, control)[0][4] == _criteria("x")["pass_criteria"]
    # Criteria that fail the checks are not kept, and the addition still goes.
    again = _Agents(migrated, team, control)
    again.proposals = [_duplicate_addition()]

    def vague(given: dict[str, Any]) -> dict[str, Any]:
        answer: dict[str, Any] = _as_duplicate_of(first[0])(given)
        answer["attributes"][0]["pass_criteria"] = "The removal was timely and appropriate."
        return answer

    again.review = vague
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_stage = 'ATTRIBUTES', "
            "run_attempts = 0 WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
        assert run_plan(connection, again, plan_id) == "DONE"
    assert _proposals(migrated, control) == []
    assert _approved(migrated, control)[0][1] == first[1]
    assert "timely" not in str(_approved(migrated, control)[0][4])
    stored = _stored_review(migrated, control)
    assert [m["outcome"] for m in stored["merges"]] == ["DROPPED"]
    assert "not objectively testable" in stored["merges"][0]["note"]


# Standing methodology (the product owner, 12 November 2026): an agent never proposes an
# attribute that duplicates one already approved or proposed; it revises the existing
# attribute instead, on every path an agent proposes attributes on.


def _auto_run(migrated: Database, team: dict[str, Any], control: str, client: TestClient,
              agents: _Agents) -> None:  # fmt: skip
    """The run queued when Control Understanding becomes complete."""
    _answer_required(migrated, team, control, client)
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, _plan_run(migrated, control)[0]) == "DONE"


def _run_again(migrated: Database, team: dict[str, Any], control: str, client: TestClient,
               agents: _Agents) -> None:  # fmt: skip
    """A person's "Run again" (or "Propose with the agent") with a worker and a model."""
    asked = client.post(f"{_path(team, control)}/attributes/generate")
    assert asked.status_code == 200 and asked.json()["attributes_run"] == "PENDING"
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, _plan_run(migrated, control)[0]) == "DONE"


def _inline(migrated: Database, team: dict[str, Any], control: str, client: TestClient,
            agents: _Agents) -> None:  # fmt: skip
    """The same request answered in the request, when no background run can take it."""
    del client
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()


def _control_review(migrated: Database, team: dict[str, Any], control: str,
                    client: TestClient, agents: _Agents) -> None:  # fmt: skip
    """The review of a control against all its sources."""
    del client
    with connect(migrated.url) as connection:
        review_control(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()


def _narrative_approved(migrated: Database, team: dict[str, Any], control: str,
                        client: TestClient, agents: _Agents) -> None:  # fmt: skip
    """The background run an approved process narrative starts."""
    del client
    with connect(migrated.url) as connection:
        assert process_narrative.request(
            connection, team["org"], team["project"], UUID(control), team["owner_id"], "PLAN"
        )
        connection.commit()
        assert process_narrative.run_narrative(connection, agents, UUID(control)) == "PLANNED"


ENTRY_POINTS: dict[str, Callable[..., None]] = {
    "the run after Control Understanding": _auto_run,
    "Run again, in the background": _run_again,
    "Propose with the agent, in the request": _inline,
    "the review of a control": _control_review,
    "the approved narrative's run": _narrative_approved,
}


@pytest.mark.parametrize("entry", list(ENTRY_POINTS))
def test_no_path_lets_a_duplicate_addition_reach_the_person(migrated: Database, entry: str) -> None:
    team, control, _scheduler, client = _ready(
        migrated, f"afu-path-{list(ENTRY_POINTS).index(entry)}", AC02
    )
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]
    agents.review = _as_duplicate_of(first[0])
    ENTRY_POINTS[entry](migrated, team, control, client, agents)
    # Every path ends with the reviewer's review of the set, after the attribute agent.
    calls = [who for who in agents.calls if who != "other"]
    assert calls[0] == "attributes" and calls[-1] == "set-review", (entry, calls)
    # No addition lands and nothing is reworded: the approved attribute keeps its wording
    # and its criteria carry the detail.
    assert _proposals(migrated, control) == [], entry
    after = _approved(migrated, control)[0]
    assert after[:2] == first[:2], entry
    assert after[2:6] == (
        "AGENT", MERGED["condition"], MERGED["pass_criteria"], MERGED["fail_criteria"],
    ), entry  # fmt: skip


def test_the_server_alone_keeps_a_repeated_attribute_out_when_both_reviewers_pass_it(
    migrated: Database,
) -> None:
    """The deterministic guard in control_attributes.generate, with the drafts' reviewer
    returning them as drafted and the set's reviewer finding nothing."""
    team, control, _scheduler, _client_ = _ready(migrated, "afu-guard", AC02)
    approved = _rows(
        migrated,
        "SELECT id, text, definition_key FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position",
        UUID(control),
    )
    keyed = [row for row in approved if row[2] is not None]
    assert len(keyed) >= 2, approved
    (_, same_text, _), (reworded_id, library_text, _) = keyed[0], keyed[1]
    # The second attribute was reworded by the team; it still stands for its library
    # attribute, so the library's own wording is that attribute again.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET text = 'The team worded this attribute its own way' "
            "WHERE id = %s",
            (reworded_id,),
        )
        connection.commit()

    def addition(text: str) -> dict[str, Any]:
        return {**_duplicate_addition(), "text": text}

    agents = _Agents(migrated, team, control)
    agents.proposals = [
        # The approved wording again, in other case and punctuation.
        addition(same_text.upper().replace(",", " ;")),
        # The library attribute a reworded approved attribute already stands for.
        addition(library_text),
        # Two changes of one attribute: only the first stands.
        {**_duplicate_addition(), "action": "CHANGE", "replaces": str(keyed[0][0]),
         "text": "The first change of the attribute"},
        {**_duplicate_addition(), "action": "CHANGE", "replaces": str(keyed[0][0]),
         "text": "A second change of the same attribute"},
        # Nor a retirement of an attribute that already has a change: one proposal each.
        {**_duplicate_addition(), "action": "RETIRE", "replaces": str(keyed[0][0]),
         "text": ""},
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        note = generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert [who for who in agents.calls if who != "other"] == [
        "attributes", "draft-review", "set-review",
    ]  # fmt: skip
    assert [(row[1], row[3]) for row in _proposals(migrated, control)] == [
        ("CHANGE", "The first change of the attribute")
    ]
    assert "4 proposed attributes repeated one the control already has" in note
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'attribute.proposed'",
        UUID(control),
    )
    assert audit[-1][0]["duplicates_left_out"] == 4 and audit[-1][0]["proposals"] == 1


def test_a_duplicate_the_drafts_reviewer_returns_as_criteria_never_becomes_a_proposal(
    migrated: Database,
) -> None:
    """The drafter and the reviewer of the drafts say a detail as a CHANGE in the approved
    wording with more specific criteria. The server writes the criteria where an agent may,
    and stores no proposal: there is no rewording for a person to decide."""
    team, control, _scheduler, _client_ = _ready(migrated, "afu-draft-review", AC02)
    approved = _approved(migrated, control)
    first, owned = approved[0], approved[1]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = 'Kept by a person.', "
            "pass_criteria = 'Kept pass, by a person.', "
            "fail_criteria = 'Kept fail, by a person.', criteria_origin = 'PERSON' WHERE id = %s",
            (owned[0],),
        )
        connection.commit()
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]
    agents.drafts = [
        {**_duplicate_addition(), "action": "CHANGE", "replaces": str(first[0]),
         "text": first[1], **MERGED},
        # The same for an attribute whose criteria a person owns: left out.
        {**_duplicate_addition(), "action": "CHANGE", "replaces": str(owned[0]),
         "text": owned[1], **MERGED},
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        note = generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert _proposals(migrated, control) == []
    after = _approved(migrated, control)
    assert after[0][:6] == (
        first[0], first[1], "AGENT", MERGED["condition"], MERGED["pass_criteria"],
        MERGED["fail_criteria"],
    )  # fmt: skip
    assert after[1][:6] == (
        owned[0], owned[1], "PERSON", "Kept by a person.", "Kept pass, by a person.",
        "Kept fail, by a person.",
    )  # fmt: skip
    assert "1 proposed attribute repeated one the control already has and was left out" in note
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'attribute.proposed'",
        UUID(control),
    )
    assert (audit[-1][0]["criteria_detailed"], audit[-1][0]["duplicates_left_out"]) == (1, 1)
    # The reviewer of the drafts was told to check for duplicates, and which approved
    # attributes a person owns the criteria of.
    assert agents.prompts[1].count('"criteria_owned_by_a_person": true') == 1
    assert "it is a duplicate" in control_attributes.REVIEW_PROMPT
    assert "Never propose a duplicate" in control_attributes.SYSTEM_PROMPT
    assert "its approved wording copied exactly" in control_attributes.SYSTEM_PROMPT
    # The versions moved with B1e (12 November 2026: the confirmed understanding is the
    # authority): old "attributes/4" and "attribute-review/2". The duplicate rules above,
    # which this test is about, are unchanged in both prompts.
    assert (control_attributes.PROMPT_VERSION, control_attributes.REVIEW_PROMPT_VERSION) == (
        "attributes/5", "attribute-review/3",
    )  # fmt: skip


def test_planning_the_evidence_of_an_accepted_attribute_is_not_shown_as_updating_the_attributes(
    migrated: Database,
) -> None:
    """Found on 12 November 2026: after "Accept all", the evidence planned for the accepted
    addition (replan_for_new_attributes) read as the agents updating the attributes again.
    That run changes no attribute and no accepted criteria."""
    team, control, scheduler, client = _ready(migrated, "afu-evidence-only")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.proposals = [
        {
            "action": "ADD", "replaces": "", "text": ADDED, "basis": "INFERRED", "source": "",
            "quote": "", "note": "The walkthrough says each request states its justification.",
            "condition": "The ServiceNow request has a business justification entered.",
            "pass_criteria": "The justification field of the ServiceNow request is filled in.",
            "fail_criteria": "The justification field of the ServiceNow request is empty.",
            "judgment_required": False,
        }
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    rows = [*_approved(migrated, control)]
    added = _proposals(migrated, control)[0]
    accepted = client.post(
        f"{_path(team, control)}/attributes/accept",
        json={
            "items": [
                {"attribute_id": str(added[0]), "version": added[7]},
                *[{"attribute_id": str(row[0]), "version": row[6]} for row in rows],
            ]
        },
    )
    assert accepted.status_code == 200, accepted.text
    # The accepted addition has no evidence yet: the planner is asked to plan it, as a
    # plain run, not one that follows the understanding.
    assert scheduler.plans == [plan_id, plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "")
    # The Attributes step shows nothing for it and holds nothing.
    assert (accepted.json()["attributes_run"], accepted.json()["attributes_stage"]) == ("", "")
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("", "", "")
        assert attribute_waits(connection, team["project"], UUID(control)) == {}
    before = _approved(migrated, control)
    assert all(row[7] is True for row in before)
    # The run itself: the planner only, and the accepted criteria are as accepted.
    planner = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        assert run_plan(connection, planner, plan_id) == "DONE"
        assert attributes_run(connection, UUID(control)) == ("", "", "")
    assert [who for who in planner.calls if who != "other"] == ["planner"]
    assert _approved(migrated, control) == before


class _Eager(_Scheduler):
    """A worker that starts a run the moment it is handed, as a free thread does."""

    def __init__(self, database: Database) -> None:
        super().__init__()
        self.database = database
        self.results: list[str] = []

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        super().schedule_plan_runs(plan_ids)
        for plan_id in plan_ids:
            with connect(self.database.url) as connection:
                self.results.append(run_plan(connection, None, plan_id))


def test_a_queued_run_is_handed_to_the_worker_only_once_the_request_has_committed(
    migrated: Database,
) -> None:
    """Found on 12 November 2026: a run queued by a save sat queued for two minutes. The
    worker was handed it inside the request, before the request committed: its claim saw
    the plan as it was before (not queued), skipped it, and nobody started it afterwards."""
    team = _launched(migrated, "afu-after-commit")
    control = str(_control(team, AC01)["id"])
    settle_attributes(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    worker = _Eager(migrated)
    client = _client(migrated, team["owner_id"], worker, True)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    # Handed once, claimed at once, and finished: never left queued for nobody.
    assert worker.plans == [plan_id]
    assert worker.results == ["DONE"]
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")


# Found by the independent review of this change (12 November 2026).


class _Unreachable(_Scheduler):
    """A worker that cannot be reached the first time it is handed a plan run, as the
    workflow engine's adapter is when the engine is down."""

    def __init__(self) -> None:
        super().__init__()
        self.refused = 0

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        if self.refused == 0:
            self.refused += 1
            raise RuntimeError("the workflow engine is unavailable")
        super().schedule_plan_runs(plan_ids)


def test_a_worker_that_cannot_be_reached_never_fails_the_request_that_committed(
    migrated: Database,
) -> None:
    team = _launched(migrated, "afu-unreachable")
    control = str(_control(team, AC01)["id"])
    settle_attributes(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    worker = _Unreachable()
    client = _client(migrated, team["owner_id"], worker, True)
    # The save that completes the understanding is recorded and answers 200 (the helper
    # asserts it), though the run it queued could not be handed over.
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    assert worker.refused == 1 and worker.plans == []
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    with connect(migrated.url) as connection:
        assert understanding_waits(connection, team["project"], UUID(control)) == {}
        # It stays queued in the database, where a starting worker finds it.
        assert plan_id in open_plan_runs(connection, team["project"])
    # And the person's "Run again" hands the queued run over again.
    again = client.post(f"{_path(team, control)}/attributes/generate")
    assert again.status_code == 200 and "already updating" in again.json()["note"]
    assert worker.plans == [plan_id]


def _two_additions() -> list[dict[str, Any]]:
    other = (
        "The leaver's remote access token was revoked, as shown by the token "
        "system's record of the change"
    )
    return [_duplicate_addition(), {**_duplicate_addition(), "text": other}]


def test_two_additions_named_as_each_others_duplicate_never_both_vanish(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "afu-mutual", AC02)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.proposals = _two_additions()

    def review(given: dict[str, Any]) -> dict[str, Any]:
        one, two = (item for item in given["attributes"] if item["state"] == "AGENT_ADDS")
        return {
            "attributes": [
                {"id": one["id"], "verdict": "DUPLICATE", "duplicate_of": two["id"],
                 "note": "The same removal.", **MERGED},
                {"id": two["id"], "verdict": "DUPLICATE", "duplicate_of": one["id"],
                 "note": "The same removal.", **MERGED},
            ],
            "findings": [],
        }  # fmt: skip

    agents.review = review
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # One of the two is still proposed, carrying the criteria, so the condition is tested.
    proposals = _proposals(migrated, control)
    assert [(row[1], row[4]) for row in proposals] == [("ADD", MERGED["pass_criteria"])]
    stored = _stored_review(migrated, control)
    assert [(m["into"], m["outcome"]) for m in stored["merges"]] == [
        (str(proposals[0][0]), "FOLDED")
    ]
    kept = stored["items"][str(proposals[0][0])]
    assert (
        kept["verdict"] == "CONCERN" and "is kept so the condition is still tested" in kept["note"]
    )
    assert "a person decided it meanwhile" not in json.dumps(stored)


def test_an_addition_a_person_approved_during_the_review_is_not_merged_away(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "afu-approved-meanwhile", AC02)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]

    def review(given: dict[str, Any]) -> dict[str, Any]:
        # While the reviewer's model call is out, a person approves the addition.
        added = _proposals(migrated, control)[0]
        with connect(migrated.url) as connection:
            control_attributes.decide(
                connection, team["org"], team["project"], UUID(control), added[0],
                team["owner_id"],
                control_attributes.AttributeDecision(decision="APPROVE", version=added[7]),
            )  # fmt: skip
            connection.commit()
        answer: dict[str, Any] = _as_duplicate_of(first[0])(given)
        return answer

    agents.review = review
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The person's decision stands: the attribute is approved, nothing was superseded, the
    # approved attribute's criteria did not take its detail, and no merge is recorded.
    status = _rows(
        migrated,
        "SELECT status FROM control_attributes WHERE engagement_control_id = %s AND text = %s",
        UUID(control),
        DUPLICATE,
    )
    assert status == [("APPROVED",)]
    assert _approved(migrated, control)[0][4] == _criteria("x")["pass_criteria"]
    assert _stored_review(migrated, control)["merges"] == []


def test_the_reviewers_revision_is_not_written_over_a_plan_approved_during_the_review(
    migrated: Database,
) -> None:
    """On a path with no plan run at work (the request's own, the review of a control, the
    narrative's run), a person can approve the plan while the reviewer's call is out."""
    team, control, _scheduler, _client_ = _ready(migrated, "afu-plan-approved-meanwhile", AC02)
    first = _approved(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    told: list[list[str]] = []

    def review(given: dict[str, Any]) -> dict[str, Any]:
        # It was told it may revise these criteria (the plan was proposed) ...
        mine = next(item for item in given["attributes"] if item["id"] == str(first[0]))
        told.append(mine["may_revise"])
        # ... and a person approves the plan while its call is out.
        approve_control_plan(migrated, control)
        return {
            "attributes": [
                {"id": str(first[0]), "verdict": "REVISED", "note": "Name the record.",
                 **MERGED}
            ],
            "findings": [],
        }  # fmt: skip

    agents.review = review
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert told == [["criteria"]]
    assert _rows(
        migrated,
        "SELECT status, approved_by IS NOT NULL FROM evidence_plans "
        "WHERE engagement_control_id = %s",
        UUID(control),
    ) == [("APPROVED", True)]
    # The approved plan's attribute is as it was: no agent criteria written over it.
    assert _approved(migrated, control)[0][2:6] == first[2:6]
    mark = _stored_review(migrated, control)["items"][str(first[0])]
    assert mark["verdict"] == "CONCERN" and "a person decided it meanwhile" in mark["note"]


def test_planning_evidence_for_an_accepted_attribute_never_inherits_a_failed_runs_stage(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "afu-stale-stage")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    with connect(migrated.url) as connection:
        # The run after the understanding has finished: nothing is due any more.
        assert run_plan(connection, _Agents(migrated, team, control), plan_id) == "DONE"
        assert not understanding_due(connection, team["project"], UUID(control))
    with connect(migrated.url) as connection:
        # A later run that followed the understanding ("Run again") failed in its planner
        # stage, and keeps that stage.
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'FAILED', run_stage = 'CRITERIA', "
            "run_lease_until = NULL WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
        # A person adds an attribute: its evidence is planned, as a plain run.
        control_attributes.add_attribute(
            connection, team["org"], team["project"], UUID(control), team["owner_id"],
            control_attributes.AttributeAdd(text=ADDED),
        )  # fmt: skip
        connection.commit()
        assert replan_for_new_attributes(connection, UUID(control)) == plan_id
        connection.commit()
    assert _plan_run(migrated, control)[1:] == ("PENDING", "")
    planner = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("", "", "")
        assert run_plan(connection, planner, plan_id) == "DONE"
    # The planner only: no attribute agent, so nothing a person has pending is replaced.
    assert [who for who in planner.calls if who != "other"] == ["planner"]
    # The launch's refinement clears a stage the same way.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'IDLE', run_stage = 'REVIEW', "
            "run_attempts = 0, source = 'RULES' WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
        assert plan_id in queue_unrefined_plans(connection, team["project"])
    assert _plan_run(migrated, control)[1:] == ("PENDING", "")


def test_a_detail_for_an_attribute_left_as_worded_passes_the_reviewers_checks_or_is_left_out(
    migrated: Database,
) -> None:
    team, control, _scheduler, _client_ = _ready(migrated, "afu-detail-checks", AC02)
    approved = _approved(migrated, control)
    assert len(approved) >= 3
    link, figure, good = approved[0], approved[1], approved[2]
    agents = _Agents(migrated, team, control)
    agents.proposals = [_duplicate_addition()]

    def same_wording(row: tuple[Any, ...], **criteria: str) -> dict[str, Any]:
        return {**_duplicate_addition(), "action": "CHANGE", "replaces": str(row[0]),
                "text": row[1], **MERGED, **criteria}  # fmt: skip

    agents.drafts = [
        # A link in the criteria.
        same_wording(link, condition="The record at https://sap.example.test shows the removal."),
        # A deadline no record of the control gives.
        same_wording(figure, pass_criteria="The account was removed within 45 business days."),
        same_wording(good),
    ]
    with connect(migrated.url) as connection:
        generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    after = {row[0]: row for row in _approved(migrated, control)}
    assert after[link[0]][2:6] == link[2:6] and after[figure[0]][2:6] == figure[2:6]
    assert after[good[0]][2:6] == (
        "AGENT", MERGED["condition"], MERGED["pass_criteria"], MERGED["fail_criteria"],
    )  # fmt: skip
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'attribute.proposed'",
        UUID(control),
    )
    assert (audit[-1][0]["criteria_detailed"], audit[-1][0]["duplicates_left_out"]) == (1, 2)


def test_two_additions_written_from_one_library_attribute_do_not_both_land(
    migrated: Database,
) -> None:
    team, control, _scheduler, _client_ = _ready(migrated, "afu-same-definition", AC02)
    # The control no longer has the library's timeliness attribute (retired here without a
    # person's record, so its wording may be proposed again).
    with connect(migrated.url) as connection:
        retired = connection.execute(
            "UPDATE control_attributes SET status = 'RETIRED' WHERE engagement_control_id = %s "
            "AND definition_key = 'ac02-timely' AND status = 'APPROVED' RETURNING id",
            (control,),
        ).fetchall()
        connection.commit()
    assert len(retired) == 1, "the launched control follows the library"
    agents = _Agents(migrated, team, control)
    agents.proposals = [
        {**_duplicate_addition(),
         "text": "Access was removed within 5 days of the HR termination date"},
        # The same library attribute, its bracket filled another way.
        {**_duplicate_addition(),
         "text": "Access was removed within the policy's period of the HR termination date"},
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        note = generate_reviewed(
            connection, agents, team["org"], team["project"], UUID(control), team["owner_id"]
        )
        connection.commit()
    assert [(row[1], row[3]) for row in _proposals(migrated, control)] == [
        ("ADD", "Access was removed within 5 days of the HR termination date")
    ]
    assert "1 proposed attribute repeated one the control already has" in note


def test_a_failed_planner_run_reads_as_stopped_once_the_understanding_is_complete(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "afu-failed-plain")
    plan_id = _plan_run(migrated, control)[0]
    with connect(migrated.url) as connection:
        # The launch's refinement failed: a plain run, with no stage.
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'FAILED', run_stage = '' WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
        # Before the understanding is complete the Attributes step has nothing to say.
        assert attributes_run(connection, UUID(control)) == ("", "", "")
    _answer_required(migrated, team, control, client)
    # Nothing is queued over a failed run: a person starts it again, and the step says so.
    assert scheduler.plans == [] and _plan_run(migrated, control)[1:] == ("FAILED", "")
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("STOPPED", "", NOT_STARTED_NOTE)
    body = client.get(f"{_path(team, control)}/context").json()
    assert (body["attributes_run"], body["attributes_run_note"]) == ("STOPPED", NOT_STARTED_NOTE)
    again = client.post(f"{_path(team, control)}/attributes/generate")
    assert again.status_code == 200 and again.json()["attributes_run"] == "PENDING"
    assert scheduler.plans == [plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
