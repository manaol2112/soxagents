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
import re
from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_attributes_follow_understanding import (
    ADDED,
    _Agents,
    _answer_required,
    _plan_run,
    _proposals,
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
    _PLAN_STANDS_SQL,
    GATE_CHANGE,
    KEPT_NOTE,
    PLANNER_TOKENS,
    UNUSABLE_NOTE,
    ControlChangeBody,
    Planned,
    WaiveBody,
    _keep_standing_plan,
    attributes_rerun_useful,
    attributes_run,
    gate_reason,
    generate,
    load_facts,
    plan_body,
    population_gate,
    queue_for_understanding,
    record_change,
    replan_for_new_attributes,
    request_attributes_run,
    run_plan,
    waive,
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
from ai_workforce_api.provenance import sha256_text

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
        "provisional": {"type": "boolean"},
    },
    "required": ["understanding", "phases"],
    "additionalProperties": False,
}
ANSWER: dict[str, Any] = {
    "understanding": {"summary": 'The review, "as performed", each quarter.'},
    "phases": [{"phase": "DESIGN", "requirements": ["one"]}, {"phase": "INTERIM"}],
    "assumptions": ["None."],
}
SUMMARY = json.dumps(ANSWER["understanding"])


def _left(answer: dict[str, Any], schema: dict[str, Any] = SCHEMA) -> bool:
    """The answer is returned as it arrived: the same object, nothing read from text."""
    read, names = unnested(schema, answer)
    return read is answer and names == ()


def test_a_nested_property_written_as_text_is_read_as_the_answer_it_is() -> None:
    deep = _one_level_too_deep(ANSWER)
    assert _mismatch(SCHEMA, deep) == "answer.phases: required, missing"
    assert unnested(SCHEMA, deep) == (ANSWER, ("understanding", "phases"))
    # A property written as the text of its own JSON.
    own = ANSWER | {"phases": json.dumps(ANSWER["phases"])}
    assert unnested(SCHEMA, own) == (ANSWER, ("phases",))
    # An answer that needs no reading is the same object, untouched.
    assert _left(ANSWER)


def test_text_that_is_not_exactly_the_answer_is_left_as_it_arrived() -> None:
    for text in (
        "The control is reviewed each quarter.",  # prose
        '{"summary": "cut',  # cut off
        "[1, 2]",  # JSON of another kind than the schema declares
        SUMMARY + ',"phases":[],"assumptions":["Another."]',  # carries what the answer has
        SUMMARY + ',"commentary":"x"',  # carries what the schema does not have
        SUMMARY + "} and more",  # more than JSON
    ):
        assert _left({"understanding": text, "assumptions": ["None."]}), text
    # Text where the schema asks for text is never parsed.
    assert _left({"understanding": {"summary": '{"a": 1}'}, "phases": []})
    # Rewritten on 13 November 2026 (the reading became every agent's, at any depth, after
    # the reviewer of the drafts on ITGC-AC-01 sent a row's property in the wrong shape and
    # the screen said nothing; docs/control-workflow-plan.md, B1i). Old expectation: nothing
    # was read inside the rows of a list, so a row's list sent as its own JSON text was left
    # and the answer failed. New: a row's property sent as exactly the text of the JSON the
    # schema declares is read (the schema decides, one value, nothing lifted out of it);
    # nothing is ever lifted out of a text inside a row, and a row's text that is not
    # exactly one value of the declared kind is still left. Methodology: the representation
    # changes, never a word of the answer, and every check applies to what is read.
    in_row = ANSWER | {
        "phases": [{"phase": "DESIGN", "requirements": '["one"]'}, {"phase": "INTERIM"}]
    }
    assert unnested(SCHEMA, in_row) == (ANSWER, ("phases[0].requirements",))
    assert _left(ANSWER | {"phases": [{"phase": "DESIGN", "requirements": '["one"],"phase":"X"'}]})
    assert _left(ANSWER | {"phases": [{"phase": "DESIGN", "requirements": '{"one": 1}'}]})


def test_a_property_written_twice_is_never_read() -> None:
    """The reviewer's cases (12 November 2026): the later of two would silently win."""
    evil = '{"summary":"real"},"understanding":{"summary":"evil"}'
    assert _left({"understanding": evil, "phases": []})
    twice = SUMMARY + ',"phases":[{"phase":"DESIGN"}],"phases":[{"phase":"INTERIM"}]'
    assert _left({"understanding": twice})
    # At any depth: inside the property itself, and inside what it carries.
    assert _left({"understanding": '{"summary":"real","summary":"evil"}', "phases": []})
    inner = SUMMARY + ',"phases":[{"phase":"DESIGN","phase":"INTERIM"}]'
    assert _left({"understanding": inner})


VERDICT: dict[str, Any] = {
    "type": "object",
    "properties": {
        "evidence": {"type": "array", "items": {"type": "string"}},
        "verdict": {"type": "string"},
        "approved": {"type": "boolean"},
    },
    "required": ["evidence"],
    "additionalProperties": False,
}


def test_an_optional_property_is_never_lifted_out_of_text() -> None:
    """The reviewer's case: a verdict and an approval that the answer did not state at its
    top level must not appear there because some text carried them."""
    carried = {"evidence": '["doc"],"verdict":"PASS","approved":true'}
    assert _left(carried, VERDICT)
    # The same in the plan's shape: an optional list, and an optional safeguard-like flag.
    assert _left({"understanding": SUMMARY + ',"phases":[],"assumptions":["Lifted."]'})
    assert _left({"understanding": SUMMARY + ',"phases":[],"provisional":false'})


def test_text_too_deep_too_long_or_not_json_numbers_is_left_and_nothing_raises() -> None:
    assert _left({"understanding": "[" * 100_000, "phases": []})
    assert _left({"understanding": "{" * 100_000})
    read, names = unnested(
        SCHEMA, {"understanding": ANSWER["understanding"], "phases": "[" * 100_000}
    )
    assert names == () and isinstance(read["phases"], str)
    assert _left({"understanding": SUMMARY + ',"phases":[{"phase":NaN}]'})
    assert _left({"understanding": '{"summary":Infinity}', "phases": []})
    assert _left({"understanding": '{"summary":-Infinity}', "phases": []})
    long = json.dumps({"summary": "x" * 200_001})
    assert _left({"understanding": long, "phases": []})


class _Fixed:
    def __init__(self, raw: ModelRaw) -> None:
        self.raw = raw

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        return self.raw


def _asked(schema: dict[str, Any], unnest: bool = True) -> ModelRequest:
    return ModelRequest(
        operation="generate", prompt="Plan.", output_schema=schema, allowed_tool_ids=(),
        timeout_seconds=5, cancelled=False, unnest=unnest,
    )  # fmt: skip


def test_the_adapter_reads_the_observed_shape_only_when_asked_and_keeps_what_was_returned() -> None:
    deep = _one_level_too_deep(ANSWER)
    read = outcome(_Fixed(ModelRaw(deep, (), 10, 10)), _asked(SCHEMA), CONFIG)
    assert (read.status, read.error, read.raw.output) == ("SUCCEEDED", "", ANSWER)
    # What the provider returned is kept beside what was read, with what was read from text.
    assert read.raw.returned == deep and read.raw.unnested == ("understanding", "phases")
    # A call that turns the reading off is read exactly as the provider returned it (since
    # 13 November 2026 the reading is on for every agent's call; none turns it off).
    plain = outcome(_Fixed(ModelRaw(deep, (), 10, 10)), _asked(SCHEMA, unnest=False), CONFIG)
    assert (plain.status, plain.raw.output) == ("MALFORMED", deep)
    assert plain.raw.returned is None and plain.raw.unnested == ()
    hoisted = {"evidence": '["doc"],"verdict":"PASS","approved":true'}
    for asked in (_asked(VERDICT), _asked(VERDICT, unnest=False)):
        kept = outcome(_Fixed(ModelRaw(hoisted, (), 10, 10)), asked, CONFIG)
        assert (kept.status, kept.raw.output) == ("MALFORMED", hoisted)
    left = outcome(_Fixed(ModelRaw(_unusable(), (), 10, 10)), _asked(SCHEMA), CONFIG)
    assert (left.status, left.raw.output) == ("MALFORMED", _unusable())
    assert left.error == "answer did not match the schema (answer.phases: required, missing)"
    # An answer nothing can read is a recorded MALFORMED, never an exception.
    deepest = {"understanding": "[" * 100_000, "phases": []}
    refused = outcome(_Fixed(ModelRaw(deepest, (), 10, 10)), _asked(SCHEMA), CONFIG)
    assert refused.status == "MALFORMED"
    assert "answer.understanding: expected object, got string" in refused.error
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
    assert planner.requests[0].max_tokens == PLANNER_TOKENS == 16000
    assert planner.requests[0].unnest is True
    # Provenance stays truthful: the call's hash is of what the provider returned, and the
    # call says the answer was re-read and which properties were read from text.
    returned = _one_level_too_deep(good)
    recorded = _rows(
        migrated,
        "SELECT output_sha256, inputs FROM model_calls WHERE target_id = %s "
        "AND prompt_version LIKE 'engagement-planner/%%'",
        control,
    )[0]
    assert recorded[0] == sha256_text(json.dumps(returned, sort_keys=True))
    assert recorded[0] != sha256_text(json.dumps(good, sort_keys=True))
    assert recorded[1]["unnested"] == ["understanding", "phases"]


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
    assert re.fullmatch(
        r"Nothing the agents read has changed since their last run on \d{1,2} [A-Z][a-z]+ "
        r"\d{4}\.",
        again.json()["note"],
    )
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


# After the independent review of B1h (12 November 2026)


def _finished_run(migrated: Database, slug: str) -> tuple[dict[str, Any], str, Any, Any, UUID]:
    """A control whose agents have run once and finished: the planner agent's plan, the
    criteria tailored, the set reviewed."""
    team, control, scheduler, client = _ready(migrated, slug)
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    with connect(migrated.url) as connection:
        assert run_plan(connection, _Agents(migrated, team, control), plan_id) == "DONE"
    return team, control, scheduler, client, plan_id


def _useful(migrated: Database, team: dict[str, Any], control: str) -> bool:
    with connect(migrated.url) as connection:
        return attributes_rerun_useful(connection, team["project"], UUID(control))


def _run_marks(migrated: Database, control: str) -> tuple[Any, ...]:
    return _rows(
        migrated,
        "SELECT run_read, run_read_at IS NOT NULL, run_tried, run_attempts FROM evidence_plans "
        "WHERE engagement_control_id = %s",
        UUID(control),
    )[0]


def _forced_run(migrated: Database, team: dict[str, Any], control: str, agents: Any) -> None:
    with connect(migrated.url) as connection:
        plan_id = request_attributes_run(connection, team["project"], UUID(control), force=True)
        assert plan_id is not None
        connection.commit()
        assert run_plan(connection, agents, plan_id) == "DONE"


def test_a_person_can_always_run_the_agents_on_purpose(migrated: Database) -> None:
    team, control, scheduler, client, plan_id = _finished_run(migrated, "pr-force")
    handed = list(scheduler.plans)
    path = f"{_context_path(team, control)}/attributes/generate"
    assert _context(team, control, client)["attributes_rerun_useful"] is False
    # Without force, with nothing changed: answered with a sentence that is true.
    for body in (None, {}, {"force": False}):
        refused = client.post(path) if body is None else client.post(path, json=body)
        assert refused.status_code == 200, refused.text
        assert refused.json()["attributes_run"] == ""
        assert refused.json()["note"].startswith(
            "Nothing the agents read has changed since their last run on "
        )
    assert scheduler.plans == handed
    # With force the run is queued all the same, and it is the whole run.
    forced = client.post(path, json={"force": True})
    assert forced.status_code == 200, forced.text
    assert forced.json()["attributes_run"] == "PENDING" and forced.json()["note"] == ""
    assert scheduler.plans == [*handed, plan_id]
    assert _plan_run(migrated, control)[1:] == ("PENDING", "ATTRIBUTES")
    agents = _Agents(migrated, team, control)
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    assert [who for who in agents.calls if who != "other"] == [
        "attributes",
        "planner",
        "set-review",
    ]
    assert _context(team, control, client)["attributes_rerun_useful"] is False


def test_anything_the_agents_read_makes_a_rerun_useful_and_accepting_their_work_does_not(
    migrated: Database,
) -> None:
    team, control, _scheduler, client, _plan_id = _finished_run(migrated, "pr-read")
    read, stamped, tried, _attempts = _run_marks(migrated, control)
    assert len(read) == 64 and stamped is True and tried == ""
    assert _useful(migrated, team, control) is False
    # A person accepts the criteria the agents tailored: their work, accepted, is not a
    # reason to run them again.
    rows = _rows(
        migrated,
        "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'APPROVED' ORDER BY position",
        UUID(control),
    )
    accepted = client.post(
        f"{_context_path(team, control)}/attributes/accept",
        json={"items": [{"attribute_id": str(row[0]), "version": row[1]} for row in rows]},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["attributes_rerun_useful"] is False
    # A person states an attribute's criteria in their own words: the agents read them.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'PERSON', pass_criteria = "
            "'The request was approved by the user''s manager before access was granted.' "
            "WHERE id = %s",
            (rows[0][0],),
        )
        connection.commit()
    assert _useful(migrated, team, control) is True
    _forced_run(migrated, team, control, _Agents(migrated, team, control))
    assert _useful(migrated, team, control) is False
    # The control's record from the RCM changes.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET activity = activity || ' Reviewed each month.' "
            "WHERE id = %s",
            (UUID(control),),
        )
        connection.commit()
    assert _useful(migrated, team, control) is True
    # A run of which a stage did not finish is not a finished run: the reviewer's answer
    # cannot be read while the planner succeeds, and the rerun stays useful.
    failing = _Agents(migrated, team, control)
    failing.review = lambda given: None
    before = _run_marks(migrated, control)
    _forced_run(migrated, team, control, failing)
    after = _run_marks(migrated, control)
    assert after[0] == before[0] and len(after[2]) == 64 and after[2] != after[0]
    assert _useful(migrated, team, control) is True
    _forced_run(migrated, team, control, _Agents(migrated, team, control))
    assert _run_marks(migrated, control)[2] == ""
    assert _useful(migrated, team, control) is False


def test_a_first_run_whose_reviewer_fails_leaves_the_rerun_useful(migrated: Database) -> None:
    team, control, _scheduler, client = _ready(migrated, "pr-review-fails")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    agents = _Agents(migrated, team, control)
    agents.review = lambda given: None
    with connect(migrated.url) as connection:
        assert run_plan(connection, agents, plan_id) == "DONE"
    # The planner succeeded, the reviewer did not: no finished run is on record.
    assert _generated(migrated, control)[0] == "MODEL"
    read, stamped, tried, _attempts = _run_marks(migrated, control)
    assert (read, stamped) == ("", False) and len(tried) == 64
    assert _context(team, control, client)["attributes_rerun_useful"] is True


def test_a_kept_replan_is_not_queued_again_on_every_save_and_the_missing_evidence_shows(
    migrated: Database,
) -> None:
    """The reviewer's finding: an approved attribute with no evidence queued the planner
    again on every save after a run that kept the plan, three calls a save."""
    team, control, scheduler, client = _ready(migrated, "pr-replan")
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
    added = _proposals(migrated, control)[0]
    rows = _rows(
        migrated,
        "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'APPROVED' ORDER BY position",
        UUID(control),
    )
    accepted = client.post(
        f"{_context_path(team, control)}/attributes/accept",
        json={
            "items": [
                {"attribute_id": str(added[0]), "version": added[7]},
                *[{"attribute_id": str(row[0]), "version": row[1]} for row in rows],
            ]
        },
    )
    assert accepted.status_code == 200, accepted.text
    # The accepted addition has no evidence: the planner is asked to plan it.
    assert _plan_run(migrated, control)[1:] == ("PENDING", "")
    failing = _Agents(migrated, team, control)
    failing.plan = _unusable
    with connect(migrated.url) as connection:
        assert run_plan(connection, failing, plan_id) == "DONE"
    assert failing.calls.count("planner") == 3
    source, _generated_at, _version, status, run_note = _generated(migrated, control)
    assert (source, status) == ("MODEL", "IDLE") and str(run_note).startswith(KEPT_NOTE)
    marks = _run_marks(migrated, control)
    assert len(marks[2]) == 64 and marks[3] == 1
    # Saves that change nothing the agents read queue nothing: not the replan, not the run
    # that follows the understanding, and the run's attempts are not reset.
    handed = list(scheduler.plans)
    with connect(migrated.url) as connection:
        assert replan_for_new_attributes(connection, UUID(control)) is None
        assert queue_for_understanding(connection, team["project"], UUID(control)) is None
        connection.commit()
    again = client.post(f"{_context_path(team, control)}/attributes/accept", json={"items": []})
    assert again.status_code in (200, 422), again.text
    assert _plan_run(migrated, control)[1:] == ("IDLE", "")
    assert scheduler.plans == handed and _run_marks(migrated, control) == marks
    # The person sees it: the step says the planner's answer could not be used, offers
    # "Run again", and the plan says it was kept and why.
    body = _context(team, control, client)
    assert (body["attributes_run"], body["attributes_run_note"]) == ("STOPPED", UNUSABLE_NOTE)
    assert body["attributes_rerun_useful"] is True
    with connect(migrated.url) as connection:
        plan = plan_body(connection, team["project"], UUID(control))
    assert plan.kept_note.startswith(KEPT_NOTE) and "rejected" in plan.kept_note
    # Something the planner reads changes: the run is queued again by that save.
    _volume(team, control, client, "25 to 100")
    assert _plan_run(migrated, control)[1] == "PENDING"
    with connect(migrated.url) as connection:
        assert run_plan(connection, _Agents(migrated, team, control), plan_id) == "DONE"
        assert attributes_run(connection, UUID(control)) == ("", "", "")
        assert plan_body(connection, team["project"], UUID(control)).kept_note == ""
    assert _run_marks(migrated, control)[2] == ""
    assert _context(team, control, client)["attributes_rerun_useful"] is False


def test_a_recorded_change_the_planner_could_not_plan_for_holds_the_plan_until_planned_again(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "pr-change")
    org, project = _ids(team)
    with connect(migrated.url) as connection:
        good = _agent_plan(connection, project, UUID(control), "The agent's reading.")
        generate(connection, _Planner(good), org, project, UUID(control), team["owner_id"])
        connection.commit()
        assert gate_reason(connection, UUID(control), "INTERIM") != GATE_CHANGE
        waiting = plan_body(connection, project, UUID(control))
    assert (waiting.change_unplanned_at, waiting.change_wait, waiting.kept_note) == (None, "", "")
    before = _snapshot(migrated, control)
    period_end = _rows(
        migrated, "SELECT period_end FROM engagement_settings WHERE project_id = %s", project
    )[0][0]
    # The change is recorded and the planner's answer for it cannot be used: the route's
    # two steps (POST .../control-changes).
    with connect(migrated.url) as connection:
        record_change(
            connection, org, project, UUID(control), team["owner_id"],
            ControlChangeBody(
                effective_on=period_end, kind="SYSTEM",
                description="Access requests moved to a new ticketing tool.",
            ),
        )  # fmt: skip
        _changes, _drafts, note = generate(
            connection, _Answers(_unusable()), org, project, UUID(control), team["owner_id"]
        )
        connection.commit()
    assert note.startswith(KEPT_NOTE)
    # The rules' plan is not written over the agent's: every row is as it was.
    assert _snapshot(migrated, control) == before
    with connect(migrated.url) as connection:
        body = plan_body(connection, project, UUID(control))
        # A durable wait the plan shows, with the date, and what it holds: operating
        # evidence is not requested, samples are not approved, testing is not concluded.
        assert body.change_unplanned_at is not None
        assert re.fullmatch(
            r"The plan has not been updated for the change recorded on \d{1,2} [A-Z][a-z]+ "
            r"\d{4}\. Plan the evidence again\.",
            body.change_wait,
        )
        assert body.kept_note.startswith(KEPT_NOTE)
        for phase in ("INTERIM", "ROLLFORWARD", None):
            assert gate_reason(connection, UUID(control), phase) == GATE_CHANGE
        assert gate_reason(connection, UUID(control), "DESIGN") != GATE_CHANGE
        assert population_gate(connection, UUID(control), None) == GATE_CHANGE
        assert population_gate(connection, UUID(control), "ROLLFORWARD") == GATE_CHANGE
        assert attributes_rerun_useful(connection, project, UUID(control)) is True
        # Planning the evidence again, with an answer that can be used, clears it.
        planned = _agent_plan(connection, project, UUID(control), "The agent's reading.")
        generate(connection, _Planner(planned), org, project, UUID(control), team["owner_id"])
        connection.commit()
        body = plan_body(connection, project, UUID(control))
        assert (body.change_unplanned_at, body.change_wait, body.kept_note) == (None, "", "")
        assert body.source == "MODEL"
        assert gate_reason(connection, UUID(control), "INTERIM") != GATE_CHANGE
        assert population_gate(connection, UUID(control), None) != GATE_CHANGE


def test_a_waived_request_is_a_persons_decision_that_keeps_the_fallback_out(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "pr-waived")
    org, project = _ids(team)
    stands = f"SELECT {_PLAN_STANDS_SQL} FROM evidence_plans p WHERE p.engagement_control_id = %s"
    assert _rows(migrated, stands, UUID(control)) == [(False,)]
    request = _requests(team, control)[0]
    with connect(migrated.url) as connection:
        waive(
            connection, org, project, UUID(control), UUID(request["id"]), team["owner_id"],
            WaiveBody(reason="Covered by the entity-level review.", version=request["version"]),
        )  # fmt: skip
        connection.commit()
    assert _rows(migrated, stands, UUID(control)) == [(True,)]
    before = _snapshot(migrated, control)
    with connect(migrated.url) as connection:
        _changes, _drafts, note = generate(
            connection, _Answers(_unusable()), org, project, UUID(control), team["owner_id"]
        )
        connection.commit()
    assert note.startswith(KEPT_NOTE) and _snapshot(migrated, control) == before
