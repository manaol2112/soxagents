"""The planner's answer is read as written, and a failed run never makes a plan worse (B1h).

Found on the development data on 12 November 2026: "Run again" on the Attributes step of
ITGC-AC-01, whose attributes were approved and whose D&I evidence was released. The planner
agent's answer was rejected three times, the rules' fallback was written over the agent's
plan, its interim and roll-forward evidence was removed, and the two accepted, already
requested D&I requests got pending changes to remove them.

Reproduced with the real model the same day (two shapes, both returned by the fakes here):

- The answer's `understanding` arrived as text, `{...},"phases":[...]`, with no `phases`:
  the whole plan, one level too deep (a tool input the provider does not constrain).
- A well-formed plan whose links named four procedures the phase did not list.

A model-execution safeguard: in `make test-critical`.
"""

import json
from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_attributes_follow_understanding import (
    _Agents,
    _answer_required,
    _plan_run,
    _ready,
    _volume,
)
from test_attributes_follow_understanding import _path as _context_path
from test_design_requests import _accept, _prepared, _releases, _requests
from test_evidence_plans import _Planner
from test_outbound import migrated
from test_planning_gate import _control, _launched, _rows

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_planning import PLAN_SCHEMA, PlanOutput, check_plan, rules_plan
from ai_workforce_api.evidence_plans import (
    KEPT_NOTE,
    NOTHING_CHANGED_NOTE,
    PLANNER_TOKENS,
    UNUSABLE_NOTE,
    Planned,
    _keep_standing_plan,
    attributes_rerun_useful,
    attributes_run,
    generate,
    load_facts,
    plan_body,
    queue_for_understanding,
    request_attributes_run,
    run_plan,
)
from ai_workforce_api.models import (
    ModelConfig,
    ModelProviderError,
    ModelRaw,
    ModelRequest,
    _mismatch,
    outcome,
    unnested,
)

__all__ = ["migrated"]

AC01, AC02 = "ITGC-AC-01", "ITGC-AC-02"
CONFIG = ModelConfig("balanced", "local", "local", 0, 0)


# The shapes the real model returned


def _one_level_too_deep(plan: dict[str, Any]) -> dict[str, Any]:
    """The answer of 12 November 2026: `understanding` as the text of its object followed,
    inside that text, by `phases`; the properties after them where they belong."""
    text = json.dumps(plan["understanding"]) + ',"phases":' + json.dumps(plan["phases"])
    rest = {key: value for key, value in plan.items() if key not in ("understanding", "phases")}
    return {"understanding": text, **rest}


def _unusable() -> dict[str, Any]:
    """An answer no reading recovers: text that is not the property's JSON."""
    return {"understanding": '{"summary": "cut', "criteria": [], "provisional": False}


def _resolved(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    if "$ref" in node:
        return _resolved(defs[str(node["$ref"]).rsplit("/", 1)[-1]], defs)
    if "anyOf" in node:
        options = [_resolved(o, defs) for o in node["anyOf"] if o.get("type") != "null"]
        if len(options) == 1:
            return options[0]
    return node


def _disagreements(
    sent: dict[str, Any], model: dict[str, Any], defs: dict[str, Any], path: str = "answer"
) -> list[str]:
    """Where the schema sent to the planner and the model that validates its answer differ:
    the same properties, types and choices; everything the model requires is required; no
    unknown property; and every limit the model enforces is stated, at least as strictly."""
    model = _resolved(model, defs)
    if sent.get("type") != model.get("type"):
        return [f"{path}: type {sent.get('type')} sent, {model.get('type')} validated"]
    found: list[str] = []
    if sent["type"] == "object":
        ours, theirs = sent.get("properties", {}), model.get("properties", {})
        if set(ours) != set(theirs):
            found.append(f"{path}: properties differ: {sorted(set(ours) ^ set(theirs))}")
        missing = set(model.get("required", [])) - set(sent.get("required", []))
        if missing:
            found.append(f"{path}: required by the model only: {sorted(missing)}")
        if sent.get("additionalProperties") is not False:
            found.append(f"{path}: unknown properties allowed")
        for name in sorted(set(ours) & set(theirs)):
            found += _disagreements(ours[name], theirs[name], defs, f"{path}.{name}")
        return found
    least, most = (
        ("minItems", "maxItems") if sent["type"] == "array" else ("minLength", "maxLength")
    )
    if model.get(most) is not None and not (sent.get(most) or 10**9) <= model[most]:
        found.append(f"{path}: {most} {sent.get(most)} sent, {model[most]} validated")
    if model.get(least) and not sent.get(least, 0) >= model[least]:
        found.append(f"{path}: {least} {sent.get(least)} sent, {model[least]} validated")
    if sent["type"] == "array":
        found += _disagreements(sent.get("items", {}), model.get("items", {}), defs, f"{path}[]")
    elif sent["type"] == "string":
        # The model reads an empty choice as "none" (RequirementPlan.empty_is_none).
        ours_e, theirs_e = sent.get("enum"), model.get("enum")
        if (ours_e is None) != (theirs_e is None) or (
            ours_e is not None and set(ours_e) - {""} != set(theirs_e or [])
        ):
            found.append(f"{path}: choices differ")
        if sent.get("pattern") != model.get("pattern"):
            found.append(f"{path}: pattern differs")
    return found


def test_the_schema_sent_to_the_planner_and_the_model_that_validates_it_agree() -> None:
    validated = PlanOutput.model_json_schema()
    assert _disagreements(PLAN_SCHEMA, validated, validated.get("$defs", {})) == []
    # The check sees a difference when there is one.
    looser = json.loads(json.dumps(PLAN_SCHEMA))
    del looser["properties"]["understanding"]["properties"]["summary"]["minLength"]
    looser["properties"]["phases"]["items"]["properties"]["requirements"]["maxItems"] = 15
    looser["properties"]["phases"]["items"]["properties"]["notes"] = {"type": "string"}
    found = " ".join(_disagreements(looser, validated, validated.get("$defs", {})))
    assert "understanding.summary: minLength" in found
    assert "phases[].requirements: maxItems 15 sent, 14 validated" in found
    assert "phases[]: properties differ: ['notes']" in found


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "understanding": {
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
            "additionalProperties": False,
        },
        "phases": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "phase": {"type": "string"},
                    "requirements": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["phase"],
                "additionalProperties": False,
            },
        },
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["understanding", "phases"],
    "additionalProperties": False,
}
ANSWER: dict[str, Any] = {
    "understanding": {"summary": 'The review, "as performed", each quarter.'},
    "phases": [{"phase": "DESIGN", "requirements": ["one"]}, {"phase": "INTERIM"}],
    "assumptions": ["None."],
}


def test_a_nested_property_written_as_text_is_read_as_the_answer_it_is() -> None:
    deep = _one_level_too_deep(ANSWER)
    assert _mismatch(SCHEMA, deep) == "answer.phases: required, missing"
    assert unnested(SCHEMA, deep) == ANSWER
    # A property written as the text of its own JSON, and one nested in a list.
    assert unnested(SCHEMA, ANSWER | {"phases": json.dumps(ANSWER["phases"])}) == ANSWER
    inner = [{"phase": "DESIGN", "requirements": '["one"]'}, {"phase": "INTERIM"}]
    assert unnested(SCHEMA, ANSWER | {"phases": inner}) == ANSWER
    # An answer that needs no reading is the same object, untouched.
    assert unnested(SCHEMA, ANSWER) is ANSWER


def test_text_that_is_not_exactly_the_answer_is_left_as_it_arrived() -> None:
    summary = json.dumps(ANSWER["understanding"])
    for text in (
        "The control is reviewed each quarter.",  # prose
        '{"summary": "cut',  # cut off
        "[1, 2]",  # JSON of another kind than the schema declares
        summary + ',"phases":[],"assumptions":["Another."]',  # carries what the answer has
        summary + ',"commentary":"x"',  # carries what the schema does not have
        summary + "} and more",  # more than JSON
    ):
        answer = {"understanding": text, "assumptions": ["None."]}
        assert unnested(SCHEMA, answer) is answer, text
    # Text where the schema asks for text is never parsed.
    quoted = {"understanding": {"summary": '{"a": 1}'}, "phases": []}
    assert unnested(SCHEMA, quoted) is quoted


class _Fixed:
    def __init__(self, raw: ModelRaw) -> None:
        self.raw = raw

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        return self.raw


def _asked(schema: dict[str, Any]) -> ModelRequest:
    return ModelRequest(
        operation="generate", prompt="Plan.", output_schema=schema, allowed_tool_ids=(),
        timeout_seconds=5, cancelled=False,
    )  # fmt: skip


def test_the_adapter_reads_the_observed_shape_and_says_when_an_answer_was_cut_off() -> None:
    read = outcome(
        _Fixed(ModelRaw(_one_level_too_deep(ANSWER), (), 10, 10)), _asked(SCHEMA), CONFIG
    )
    assert (read.status, read.error, read.raw.output) == ("SUCCEEDED", "", ANSWER)
    left = outcome(_Fixed(ModelRaw(_unusable(), (), 10, 10)), _asked(SCHEMA), CONFIG)
    assert (left.status, left.raw.output) == ("MALFORMED", _unusable())
    assert left.error == "answer did not match the schema (answer.phases: required, missing)"
    cut = outcome(_Fixed(ModelRaw(None, (), 10, 10, stopped="max_tokens")), _asked(SCHEMA), CONFIG)
    assert (cut.status, cut.error) == ("MALFORMED", "answer was cut off at the output limit")
    none = outcome(_Fixed(ModelRaw(None, (), 10, 10)), _asked(SCHEMA), CONFIG)
    assert (none.status, none.error) == ("MALFORMED", "answer did not match the schema")


# The planner


def _ids(team: dict[str, Any]) -> tuple[UUID, UUID]:
    return UUID(str(team["org"])), UUID(str(team["project"]))


def _agent_plan(connection: Any, project: UUID, control: UUID, summary: str) -> dict[str, Any]:
    """A plan the planner agent could return: the rules', in the agent's own words."""
    output: dict[str, Any] = rules_plan(load_facts(connection, project, control)).model_dump(
        mode="json", exclude_none=True
    )
    output["understanding"]["summary"] = summary
    return output


def _planner_calls(migrated: Database, control: UUID) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT status, error, inputs FROM model_calls WHERE target_id = %s "
        "AND prompt_version LIKE 'engagement-planner/%%' ORDER BY created_at",
        control,
    )


class _Answers:
    """A model that gives its answers in turn, the last one again after that."""

    def __init__(self, *answers: dict[str, Any] | None) -> None:
        self.answers = list(answers)
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        answer = self.answers[min(len(self.requests), len(self.answers)) - 1]
        return ModelRaw(answer, (), 100, 100)


def test_the_planner_plans_from_an_answer_written_one_level_too_deep(migrated: Database) -> None:
    team = _launched(migrated, "pr-deep")
    control = UUID(str(_control(team, AC01)["id"]))
    org, project = _ids(team)
    with connect(migrated.url) as connection:
        good = _agent_plan(connection, project, control, "The agent's reading of the control.")
        planner = _Answers(_one_level_too_deep(good))
        _changes, _drafts, note = generate(
            connection, planner, org, project, control, team["owner_id"]
        )
        connection.commit()
        body = plan_body(connection, project, control)
    # One call, no correction: the plan is the agent's, as it wrote it.
    assert len(planner.requests) == 1 and note == ""
    assert body.source == "MODEL"
    assert body.understanding["summary"] == "The agent's reading of the control."
    assert [(row[0], row[1]) for row in _planner_calls(migrated, control)] == [("SUCCEEDED", "")]
    assert planner.requests[0].max_tokens == PLANNER_TOKENS == 32000


def test_a_correction_names_the_exact_place_that_failed_and_the_reason_is_kept_with_the_call(
    migrated: Database,
) -> None:
    team = _launched(migrated, "pr-paths")
    control = UUID(str(_control(team, AC01)["id"]))
    org, project = _ids(team)
    with connect(migrated.url) as connection:
        good = _agent_plan(connection, project, control, "The agent's reading of the control.")
        # The second shape the real model returned: links that name a procedure the phase
        # does not list.
        loose = json.loads(json.dumps(good))
        phase = next(item for item in loose["phases"] if item.get("links"))
        phase["links"][0]["procedure"] = "Compare each grant date with its approval date."
        # And one that breaks the schema's limits in two places.
        long = json.loads(json.dumps(good))
        long["understanding"]["summary"] = "x" * 1600
        long["phases"][1]["requirements"][0]["title"] = "ab"
        planner = _Answers(loose, long, good)
        generate(connection, planner, org, project, control, team["owner_id"])
        connection.commit()
        assert plan_body(connection, project, control).source == "MODEL"
    assert len(planner.requests) == 3
    first, second = planner.requests[1].prompt, planner.requests[2].prompt
    where = f"in the {phase['phase']} phase, links[0].procedure is not one of that phase's"
    assert where in first and "<your_previous_plan>" in first
    assert "understanding.summary: " in second
    assert "phases[1].requirements[0].title: " in second
    # The limits are the schema's (it said 14 evidence items where the schema allows 4).
    assert "at most 4 evidence items" in first and "14 evidence items" not in first
    calls = _planner_calls(migrated, control)
    assert [row[0] for row in calls] == ["SUCCEEDED", "SUCCEEDED", "SUCCEEDED"]
    assert "rejected" not in calls[0][2]
    assert where in calls[1][2]["rejected"]
    assert "phases[1].requirements[0].title" in calls[2][2]["rejected"]
    # Nothing of the answer is in the record: the long summary is named, never repeated.
    assert "xxxx" not in json.dumps([row[2] for row in calls])


def test_check_plan_names_every_failing_place_by_its_path() -> None:
    try:
        check_plan({"understanding": "text", "criteria": [{"attribute": "a"}]}, None)  # type: ignore[arg-type]
    except ValueError as error:
        said = str(error)
    assert said.startswith("plan does not match the schema: ")
    assert "understanding: Input should be a valid dictionary" in said
    assert "phases: Field required" in said and "criteria[0].condition: Field required" in said


# A failed or rejected run never makes the plan worse


def _snapshot(migrated: Database, control: str) -> dict[str, list[Any]]:
    """Every row of the control's plan, attributes and releases, whole."""
    queries = {
        "plan": "SELECT to_jsonb(p) FROM evidence_plans p WHERE p.engagement_control_id = %s",
        "phases": "SELECT to_jsonb(f) FROM evidence_plan_phases f "
        "WHERE f.engagement_control_id = %s ORDER BY f.phase",
        "requirements": "SELECT to_jsonb(q) FROM evidence_requirements q JOIN evidence_plans p "
        "ON p.id = q.plan_id WHERE p.engagement_control_id = %s ORDER BY q.id",
        "links": "SELECT to_jsonb(l) FROM evidence_requirement_attributes l "
        "JOIN evidence_requirements q ON q.id = l.requirement_id JOIN evidence_plans p "
        "ON p.id = q.plan_id WHERE p.engagement_control_id = %s ORDER BY to_jsonb(l)::text",
        "attributes": "SELECT to_jsonb(a) FROM control_attributes a "
        "WHERE a.engagement_control_id = %s ORDER BY a.id",
        "releases": "SELECT to_jsonb(r) FROM phase_releases r "
        "WHERE r.engagement_control_id = %s ORDER BY r.id",
    }
    return {
        name: [row[0] for row in _rows(migrated, query, UUID(control))]
        for name, query in queries.items()
    }


def _kept_records(migrated: Database, control: str) -> tuple[list[Any], list[Any]]:
    runs = _rows(
        migrated,
        "SELECT r.source, r.note, r.changes, r.output, r.model_call_id IS NOT NULL "
        "FROM evidence_plan_runs r JOIN evidence_plans p ON p.id = r.plan_id "
        "WHERE p.engagement_control_id = %s AND r.note LIKE %s ORDER BY r.created_at",
        UUID(control), f"{KEPT_NOTE}%",
    )  # fmt: skip
    audit = _rows(
        migrated,
        "SELECT e.payload FROM audit_events e JOIN evidence_plans p ON p.id = e.target_id "
        "WHERE p.engagement_control_id = %s AND e.action = 'evidence_plan.kept'",
        UUID(control),
    )
    return runs, audit


NO_CHANGES: dict[str, list[str]] = {
    "added": [],
    "updated": [],
    "flagged": [],
    "removed": [],
    "kept": [],
}


def test_a_rejected_answer_over_the_agents_plan_leaves_every_row_as_it_was(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "pr-kept")
    org, project = _ids(team)
    with connect(migrated.url) as connection:
        good = _agent_plan(connection, project, UUID(control), "The agent's reading.")
        generate(connection, _Planner(good), org, project, UUID(control), team["owner_id"])
        connection.commit()
        assert plan_body(connection, project, UUID(control)).source == "MODEL"
    before = _snapshot(migrated, control)
    assert before["requirements"] and before["attributes"] and before["links"]
    # The planner's answer cannot be used, three times over.
    planner = _Answers(_unusable())
    with connect(migrated.url) as connection:
        changes, drafts, note = generate(
            connection, planner, org, project, UUID(control), team["owner_id"]
        )
        connection.commit()
    assert len(planner.requests) == 3
    # Byte for byte: no requirement added, removed, flagged or given a pending change, no
    # criteria changed, and the plan itself (its source, content, version, generated_at).
    assert _snapshot(migrated, control) == before
    assert changes.as_json() == NO_CHANGES and drafts == []
    assert note.startswith(KEPT_NOTE) and "The agent's plan was rejected" in note
    assert "rules planned" not in note
    runs, audit = _kept_records(migrated, control)
    assert [(row[0], row[2], row[3], row[4]) for row in runs] == [
        ("FALLBACK", NO_CHANGES, {}, True)
    ]
    assert [row[0]["source"] for row in audit] == ["FALLBACK"]


class _Down:
    """A model that cannot be reached."""

    def __init__(self) -> None:
        self.asked = 0

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        self.asked += 1
        raise ModelProviderError(transient=False, status=401)


def test_nothing_accepted_requested_or_released_gets_a_pending_change_from_a_fallback(
    migrated: Database,
) -> None:
    """The plan here is the rules' own (RULES), so only what a person accepted and what was
    requested and released from it keeps the fallback out."""
    team, control = _prepared(migrated, "pr-released")
    org, project = _ids(team)
    done = _accept(team["owner"], team, control, _requests(team, control))
    assert done.status_code == 200, done.text
    assert len(_releases(migrated, control)) == 1
    requests = _requests(team, control)
    assert requests and all(item["accepted"] for item in requests)
    assert {item["status"] for item in requests} <= {"REQUESTED", "AWAITING_DEPENDENCY"}
    assert "REQUESTED" in {item["status"] for item in requests}
    before = _snapshot(migrated, control)
    assert before["plan"][0]["source"] == "RULES"
    for model in (_Answers(_unusable()), _Down(), _Answers(None)):
        with connect(migrated.url) as connection:
            _changes, drafts, note = generate(
                connection, model, org, project, UUID(control), team["owner_id"]
            )
            connection.commit()
        assert note.startswith(KEPT_NOTE) and drafts == []
        assert _snapshot(migrated, control) == before
    assert all(item["pending_change"] is None for item in _requests(team, control))
    assert [item["id"] for item in _requests(team, control)] == [item["id"] for item in requests]
    assert len(_kept_records(migrated, control)[0]) == 3


def test_the_fallback_still_plans_a_control_that_has_no_usable_plan(migrated: Database) -> None:
    team = _launched(migrated, "pr-fallback")
    control = UUID(str(_control(team, AC02)["id"]))
    org, project = _ids(team)
    # The launch's plan is the rules', and nobody accepted, approved, requested or released
    # anything in it: the fallback is written, as the rules' work with the failed call.
    with connect(migrated.url) as connection:
        _changes, _drafts, note = generate(
            connection, _Answers(_unusable()), org, project, control, team["owner_id"]
        )
        connection.commit()
        body = plan_body(connection, project, control)
    assert body.source == "FALLBACK" and "the reviewed rules planned the evidence" in note
    assert not note.startswith(KEPT_NOTE)
    assert _kept_records(migrated, str(control)) == ([], [])
    # And a control with no plan at all is never "kept": there is nothing to keep.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        rules = rules_plan(load_facts(connection, project, control))
        planned = Planned(rules, "FALLBACK", "", None, "The model did not answer in time.")
        assert _keep_standing_plan(cursor, org, project, uuid4(), planned, None) == ""


# A run with nothing to do, and what the Attributes step is told


def _context(team: dict[str, Any], control: str, client: Any) -> dict[str, Any]:
    body: dict[str, Any] = client.get(f"{_context_path(team, control)}/context").json()
    return body


def _generated(migrated: Database, control: str) -> Any:
    return _rows(
        migrated,
        "SELECT source, generated_at, version, run_status, run_note FROM evidence_plans "
        "WHERE engagement_control_id = %s",
        UUID(control),
    )[0]


def test_run_again_does_nothing_when_nothing_the_agents_read_has_changed(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "pr-noop")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        # Queued and waiting: there is nothing to start.
        assert not attributes_rerun_useful(connection, team["project"], UUID(control))
        assert run_plan(connection, agents, plan_id) == "DONE"
    handed, calls = list(scheduler.plans), list(agents.calls)
    before = _snapshot(migrated, control)
    assert before["plan"][0]["source"] == "MODEL"
    # The run finished and the understanding is as the planner read it.
    body = _context(team, control, client)
    assert (body["attributes_run"], body["attributes_rerun_useful"]) == ("", False)
    again = client.post(f"{_context_path(team, control)}/attributes/generate")
    assert again.status_code == 200, again.text
    assert again.json()["note"] == NOTHING_CHANGED_NOTE
    assert again.json()["attributes_run"] == ""
    # No run was queued, no agent was called, and nothing was written.
    assert scheduler.plans == handed and agents.calls == calls
    assert _snapshot(migrated, control) == before
    with connect(migrated.url) as connection:
        assert request_attributes_run(connection, team["project"], UUID(control)) is None
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    # A run that stopped before it finished has work left: "Run again" starts it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'FAILED', run_stage = 'REVIEW' WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
    body = _context(team, control, client)
    assert (body["attributes_run"], body["attributes_rerun_useful"]) == ("STOPPED", True)
    started = client.post(f"{_context_path(team, control)}/attributes/generate")
    assert started.status_code == 200 and started.json()["attributes_run"] == "PENDING"
    assert started.json()["attributes_rerun_useful"] is False
    assert scheduler.plans == [*handed, plan_id]


def test_a_kept_plan_says_the_answer_could_not_be_used_only_while_something_waits_on_it(
    migrated: Database,
) -> None:
    team, control, scheduler, client = _ready(migrated, "pr-waits")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    with connect(migrated.url) as connection:
        assert run_plan(connection, _Agents(migrated, team, control), plan_id) == "DONE"
    assert _context(team, control, client)["attributes_rerun_useful"] is False
    # The understanding changes: the run is queued by the save, and this time the planner's
    # answer cannot be used.
    _volume(team, control, client, "25 to 100")
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    before = _snapshot(migrated, control)
    failing = _Agents(migrated, team, control)
    failing.plan = _unusable
    with connect(migrated.url) as connection:
        assert run_plan(connection, failing, plan_id) == "DONE"
    assert failing.calls.count("planner") == 3 and failing.calls[-1] == "set-review"
    # The agent's plan stands exactly as it was; the run ended and says the plan was kept.
    after = _snapshot(migrated, control)
    for part in ("phases", "requirements", "links", "releases"):
        assert after[part] == before[part], part
    source, generated_at, _version, status, run_note = _generated(migrated, control)
    assert (source, status) == ("MODEL", "IDLE") and str(run_note).startswith(KEPT_NOTE)
    assert generated_at.isoformat()[:19] == before["plan"][0]["generated_at"][:19]
    # The change to the understanding still waits on the planner: said, with "Run again".
    with connect(migrated.url) as connection:
        assert attributes_run(connection, UUID(control)) == ("STOPPED", "", UNUSABLE_NOTE)
        # It is not asked again by itself on every save, only by a person or a new answer.
        assert queue_for_understanding(connection, team["project"], UUID(control)) is None
    body = _context(team, control, client)
    assert (body["attributes_run"], body["attributes_run_note"]) == ("STOPPED", UNUSABLE_NOTE)
    assert body["attributes_rerun_useful"] is True
    handed = len(scheduler.plans)
    again = client.post(f"{_context_path(team, control)}/attributes/generate")
    assert again.status_code == 200 and again.json()["attributes_run"] == "PENDING"
    assert len(scheduler.plans) == handed + 1
    # This time the planner answers: nothing reads stopped, and nothing waits.
    with connect(migrated.url) as connection:
        assert run_plan(connection, _Agents(migrated, team, control), plan_id) == "DONE"
        assert attributes_run(connection, UUID(control)) == ("", "", "")
    body = _context(team, control, client)
    assert (body["attributes_run"], body["attributes_rerun_useful"]) == ("", False)
    # A kept run on a control where nothing waits shows no stopped note at all.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_note = %s WHERE id = %s", (KEPT_NOTE, plan_id)
        )
        connection.commit()
        assert attributes_run(connection, UUID(control)) == ("", "", "")
