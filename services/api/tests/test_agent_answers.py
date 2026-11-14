"""Every agent's answer is read as its schema declares it, and none fails silently (13
November 2026; docs/control-workflow-plan.md, B1i).

After "Run again" on the Attributes step of ITGC-AC-01, the reviewer of the drafts sent a
row's optional object as null, the planner's first answer had its `phases` inside the text
of `understanding`, its second quoted words the control's records do not hold, and the
screen said nothing. This file holds the class shut:

- every agent that calls a model is enumerated from the code (each `ModelRequest(`), so a
  new agent is in these tests the day it is written: none turns the shared reading off, each
  reaches the model only through the reading (models.outcome), and each one's own schema is
  fed the shapes seen in the wild (JSON text at the top level and deep, the rows of a list
  included; a wrapper around the whole answer; a missing required part; prose where an
  object belongs): the answer is read exactly, or the call fails with the place recorded,
  never with a value guessed;
- the Attributes step's agents run end to end: what can be read is used, a quote the
  records do not hold is never kept, a part that fails is corrected once, and an agent whose
  answer still cannot be used says so in plain words on the record the step reads
  (`attributes_agent_notes`), until a later answer is used.
"""

import ast
import importlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_attributes_follow_understanding import (
    ADDED,
    _answer_required,
    _criteria,
    _path,
    _plan_run,
    _ready,
)
from test_outbound import migrated
from test_planning_gate import _rows

from ai_workforce_api import attribute_review, control_attributes, models
from ai_workforce_api import process_narrative as narrative_module
from ai_workforce_api.agent_answers import notes_for
from ai_workforce_api.context_routes import attributes_failure_note
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import SYSTEM_PROMPT as PLANNER_SYSTEM
from ai_workforce_api.evidence_planning import quote_held, quote_text, rules_plan
from ai_workforce_api.evidence_plans import (
    KEPT_NOTE,
    generate,
    latest_plan_failure_note,
    load_facts,
    request_attributes_run,
    run_plan,
)
from ai_workforce_api.models import (
    OUTPUT_TOOL,
    ModelConfig,
    ModelRaw,
    ModelRequest,
    _mismatch,
    outcome,
    unnested,
)

__all__ = ["migrated"]

PACKAGE = Path(models.__file__).parent
CONFIG = ModelConfig("local", "local", "local", 0, 0)
# A call that needs the provider's raw text may turn the reading off only with its reason
# here (none does: no agent reads JSON text itself, and the reading changes nothing a
# schema-valid answer has).
RAW_TEXT: dict[str, str] = {}
# The schemas a call site builds rather than names: where each comes from, so each is fed
# the shapes too. A new site of this kind fails test_every_agent_is_found_with_its_schema
# until it is listed.
BUILT: dict[tuple[str, str], Callable[[], list[dict[str, Any]]]] = {
    ("policy_evidence", "_schema()"): lambda: [importlib.import_module(
        "ai_workforce_api.policy_evidence")._schema()],
    ("prior_year", "_analysis_schema()"): lambda: [importlib.import_module(
        "ai_workforce_api.prior_year")._analysis_schema()],
    # process_narrative._call: the narrative's drafter and its reviewer.
    ("process_narrative", "schema"): lambda: [
        narrative_module.DRAFT_SCHEMA, narrative_module.REVIEW_SCHEMA,
    ],
    # The generic model-calls route (models._create): the schema is the caller's.
    ("models", "body.output_schema"): lambda: [],
}  # fmt: skip


# The agents, from the code


def _sites() -> list[tuple[str, int, ast.Call]]:
    found = []
    for path in sorted(PACKAGE.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "ModelRequest":
                found.append((path.stem, node.lineno, node))
    return found


def _keyword(node: ast.Call, name: str) -> ast.expr | None:
    return next((item.value for item in node.keywords if item.arg == name), None)


def _generating() -> list[tuple[str, int, ast.Call]]:
    return [
        site for site in _sites()
        if not (isinstance(op := _keyword(site[2], "operation"), ast.Constant)
                and op.value == "propose_tools")
    ]  # fmt: skip


def _schemas() -> list[tuple[str, dict[str, Any]]]:
    """Every generating agent's output schema, by where it is asked for."""
    found: list[tuple[str, dict[str, Any]]] = []
    for module, line, node in _generating():
        expression = _keyword(node, "output_schema")
        assert expression is not None, f"{module}:{line} asks for no output schema"
        built = BUILT.get((module, ast.unparse(expression)))
        if built is not None:
            found += [(f"{module}:{line}#{i}", s) for i, s in enumerate(built())]
            continue
        assert isinstance(expression, ast.Name), f"{module}:{line}: list its schema in BUILT"
        schema = getattr(importlib.import_module(f"ai_workforce_api.{module}"), expression.id)
        assert isinstance(schema, dict), f"{module}:{line}"
        found.append((f"{module}:{line}", schema))
    return found


def test_every_agent_reads_its_answer_through_the_shared_layer() -> None:
    sites = _generating()
    # Every agent of the platform at the time of writing: a site removed is a test to
    # revisit, a site added is covered below by itself.
    modules = {module for module, _line, _node in sites}
    assert len(sites) >= 30 and {
        "attribute_review", "control_attributes", "evidence_plans", "evidence_assurance",
        "control_reviews", "testing_engine", "process_narrative", "pbc_drafting",
    } <= modules  # fmt: skip
    # The reading is on unless a call turns it off, and none does without its reason.
    assert ModelRequest.__dataclass_fields__["unnest"].default is True
    for module, line, node in sites:
        flag = _keyword(node, "unnest")
        if flag is not None and not (isinstance(flag, ast.Constant) and flag.value is True):
            assert f"{module}:{line}" in RAW_TEXT, f"{module}:{line} turns the reading off"
    # Each module reaches the model only through the reading: AgentCaller.generate or
    # models.complete/outcome, never a provider's own complete().
    for module in modules - {"models", "provenance"}:
        tree = ast.parse((PACKAGE / f"{module}.py").read_text(encoding="utf-8"))
        direct = [
            node.lineno for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and node.func.attr == "complete"
        ]  # fmt: skip
        assert direct == [], f"{module} calls a provider directly at {direct}"


def test_every_agent_is_found_with_its_schema() -> None:
    schemas = _schemas()
    assert len(schemas) >= 31
    for where, schema in schemas:
        assert schema.get("type") == "object", where


# The shapes, against every agent's own schema


def _example(schema: dict[str, Any], depth: int = 0) -> Any:
    """A complete answer of the schema's shape: every property, one row in every list."""
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next(one for one in kind if one != "null")
        schema = {**schema, "type": kind}
    if kind == "object":
        properties = schema.get("properties") or {}
        return {key: _example(item, depth + 1) for key, item in properties.items()}
    if kind == "array":
        items = schema.get("items")
        return [_example(items, depth + 1)] if isinstance(items, dict) and depth < 12 else []
    if "enum" in schema:
        return schema["enum"][0]
    return {"string": "x", "integer": 1, "number": 1, "boolean": False}.get(str(kind), "x")


def _places(
    schema: dict[str, Any], value: Any, path: tuple[Any, ...] = ()
) -> list[tuple[Any, ...]]:
    """Where the answer holds an object or a list, below the top level."""
    found: list[tuple[Any, ...]] = []
    if schema.get("type") == "object" and isinstance(value, dict):
        for key, item in value.items():
            declared = (schema.get("properties") or {}).get(key, {})
            if declared.get("type") in ("object", "array"):
                found.append((*path, key))
            found += _places(declared, item, (*path, key))
    elif schema.get("type") == "array" and isinstance(value, list):
        for index, item in enumerate(value):
            items = schema.get("items") or {}
            if items.get("type") in ("object", "array"):
                found.append((*path, index))
            found += _places(items, item, (*path, index))
    return found


def _as_text(value: Any, place: tuple[Any, ...]) -> Any:
    copy = json.loads(json.dumps(value))
    holder = copy
    for part in place[:-1]:
        holder = holder[part]
    holder[place[-1]] = json.dumps(holder[place[-1]])
    return copy


def _named(place: tuple[Any, ...]) -> str:
    return "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in place).lstrip(".")


class _Fixed:
    def __init__(self, output: Any) -> None:
        self.output = output

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del request, config
        return ModelRaw(self.output, (), 10, 10)


def _read(schema: dict[str, Any], answer: Any) -> models.Outcome:
    request = ModelRequest(
        operation="generate", prompt="Answer.", output_schema=schema, allowed_tool_ids=(),
        timeout_seconds=5, cancelled=False,
    )  # fmt: skip
    return outcome(_Fixed(answer), request, CONFIG)


@pytest.mark.parametrize(("where", "schema"), _schemas(), ids=lambda item: str(item)[:40])
def test_every_agent_reads_the_shapes_seen_in_the_wild(where: str, schema: dict[str, Any]) -> None:
    answer = _example(schema)
    assert _mismatch(schema, answer) is None, where
    plain = _read(schema, answer)
    assert (plain.status, plain.raw.output, plain.raw.unnested) == ("SUCCEEDED", answer, ())
    places = _places(schema, answer)
    top = [place for place in places if len(place) == 1]
    deep = [place for place in places if len(place) > 1]
    # An object or a list sent as the text of its JSON, at the top level and as deep as the
    # schema goes (inside the rows of a list too): read as what it is, and said where.
    for place in [*top[:1], *(deep[-1:] if deep else [])]:
        found = _read(schema, _as_text(answer, place))
        assert (found.status, found.raw.output) == ("SUCCEEDED", answer), (where, place)
        assert _named(place) in found.raw.unnested, (where, place)
        assert found.raw.returned == _as_text(answer, place)
    # A wrapper around the whole answer, as an object or as its text (a name the schema
    # does not declare: one it declares is a property, never a wrapper).
    other = next(n for n in ("output", "result", "response") if n not in schema["properties"])
    for wrapped in ({OUTPUT_TOOL: answer}, {other: json.dumps(answer)}):
        found = _read(schema, wrapped)
        assert (found.status, found.raw.output) == ("SUCCEEDED", answer), where
        assert found.raw.unnested[0].startswith("wrapper:")
    # A missing required part: never filled in, the call fails, and its record names the
    # place (the schema's own name, nothing of the answer).
    for key in schema.get("required", [])[:2]:
        missing = {k: v for k, v in answer.items() if k != key}
        found = _read(schema, missing)
        assert found.status == "MALFORMED", (where, key)
        assert found.error == f"answer did not match the schema (answer.{key}: required, missing)"
        assert found.raw.output == missing and found.raw.returned is None
    # Prose where an object or a list belongs is not JSON: left as it came, and named.
    if top:
        key = top[0][0]
        kind = schema["properties"][key]["type"]
        prose = {**answer, key: "The control is reviewed each quarter."}
        found = _read(schema, prose)
        assert found.status == "MALFORMED" and found.raw.output == prose, where
        assert f"answer.{key}: expected {kind}, got string" in found.error


def test_the_reading_never_guesses_a_value() -> None:
    schema = attribute_review.SCHEMA
    answer = _example(schema)
    # A wrapper whose content does not fit is not unwrapped, and a property of the schema is
    # never taken for a wrapper.
    wrappers: list[dict[str, Any]] = [
        {OUTPUT_TOOL: {"attributes": []}},
        {"note": answer},
        {"attributes": answer},
    ]
    for wrapped in wrappers:
        assert unnested(schema, wrapped) == (wrapped, ())
    # Null is left out only for an optional object; a required part, a list or a value stays
    # null and fails.
    row = _example(control_attributes.REVIEW_SCHEMA["properties"]["attributes"]["items"])
    nulled = {"attributes": [{**row, "follows": None}], "fixes": []}
    read, names = unnested(control_attributes.REVIEW_SCHEMA, nulled)
    assert (
        names == ("attributes[0].follows: null left out",)
        and "follows" not in read["attributes"][0]
    )
    assert nulled["attributes"][0]["follows"] is None  # what arrived is untouched
    nulls: list[dict[str, Any]] = [
        {"attributes": None, "fixes": []},
        {"attributes": [row], "fixes": None},
        {"attributes": [{**row, "judgment_required": None}], "fixes": []},
    ]
    for value in nulls:
        assert _read(control_attributes.REVIEW_SCHEMA, value).status == "MALFORMED"
    # Text inside a row is read as one value of the declared kind, never with what follows.
    carried = {"attributes": [{**row, "follows": json.dumps(row["follows"]) + ',"text":"lifted"'}],
               "fixes": []}  # fmt: skip
    assert unnested(control_attributes.REVIEW_SCHEMA, carried) == (carried, ())
    # The model-calls route reads as every agent's call does.
    deep = {"attributes": json.dumps([row]), "fixes": []}
    request = ModelRequest(
        operation="generate", prompt="Answer.", output_schema=control_attributes.REVIEW_SCHEMA,
        allowed_tool_ids=(), timeout_seconds=5, cancelled=False,
    )  # fmt: skip
    status, raw = models._complete(_Fixed(deep), request, CONFIG)
    assert status == "SUCCEEDED" and raw.output is not None
    assert raw.output["attributes"] == [row]


def test_a_quote_is_held_only_when_the_records_say_it_word_for_word() -> None:
    held_in = quote_text(
        'The user\'s manager approves the request in "ServiceNow" - before the grant.'
    )
    # Typographic quotes and dashes, case, spacing, a closing full stop and the JSON escapes
    # of the records as the planner saw them: the same words.
    for quote in (
        "“The user’s Manager approves the request.”",
        "– before the grant.",
        'the request in \\"ServiceNow\\"',
        "approves the\\nrequest",
    ):
        assert quote_held(quote, held_in), quote
    # Other words, words out of order, a word missing, too short: not held.
    for quote in (
        "The manager approves the request",
        "before the grant in ServiceNow",
        "The user's approves",
        "th",
        "",
    ):
        assert not quote_held(quote, held_in), quote


# The Attributes step's agents, end to end

DOCUMENTED = "The access request ticket records the requester's cost centre for the role"


def _proposal(text: str = ADDED, basis: str = "INFERRED", quote: str = "") -> dict[str, Any]:
    return {
        "action": "ADD", "replaces": "", "text": text, "basis": basis,
        "source": "control" if quote else "", "quote": quote,
        "note": "The walkthrough says each request states its justification.",
        "condition": "The ServiceNow request has a business justification entered.",
        "pass_criteria": "The justification field of the ServiceNow request is filled in.",
        "fail_criteria": "The justification field of the ServiceNow request is empty.",
        "judgment_required": False,
    }  # fmt: skip


class _Script:
    """A scripted model for the run's agents, told apart by their system prompt. Each agent
    answers from its own list in turn, the last answer again after that; an answer may be a
    function of the prompt. Without a list: the drafter proposes nothing, the reviewer of
    the drafts returns them, the planner returns the rules' plan with tailored criteria, and
    the reviewer of the set finds nothing."""

    WHO = {
        control_attributes.SYSTEM_PROMPT: "attributes",
        control_attributes.REVIEW_PROMPT: "draft-review",
        PLANNER_SYSTEM: "planner",
        attribute_review.SYSTEM_PROMPT: "set-review",
    }

    def __init__(self, database: Database, team: dict[str, Any], control: str) -> None:
        self.database, self.team, self.control = database, team, control
        self.answers: dict[str, list[Any]] = {}
        self.calls: list[str] = []
        self.prompts: dict[str, list[str]] = {}

    def plan(self) -> dict[str, Any]:
        with connect(self.database.url) as connection:
            facts = load_facts(connection, self.team["project"], UUID(self.control))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        output["criteria"] = [_criteria(text) for text in facts.criteria_writable]
        return output

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        who = self.WHO.get(request.system, "other")
        self.calls.append(who)
        self.prompts.setdefault(who, []).append(request.prompt)
        if who == "other":
            return ModelRaw({}, (), 10, 10)
        queue = self.answers.get(who)
        if queue:
            answer = queue[min(len(self.prompts[who]), len(queue)) - 1]
            answer = answer(request.prompt) if callable(answer) else answer
        elif who == "attributes":
            answer = {"attributes": [], "issues": []}
        elif who == "draft-review":
            answer = {"attributes": _drafted(request.prompt), "fixes": []}
        elif who == "planner":
            answer = self.plan()
        else:
            answer = {"attributes": [], "findings": []}
        return ModelRaw(answer, (), 100, 100)


def _drafted(prompt: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = json.loads(
        prompt.split("<drafted_attributes>\n", 1)[1].split("\n</drafted_attributes>", 1)[0]
    )
    return found


def _calls(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT split_part(m.prompt_version, '/', 1), m.status, m.error, m.inputs, o.outcome "
        "FROM model_calls m LEFT JOIN model_call_outcomes o ON o.model_call_id = m.id "
        "WHERE m.target_id = %s AND split_part(m.prompt_version, '/', 1) = ANY(%s) "
        "ORDER BY m.created_at, m.id",
        UUID(control), ["attributes", "attribute-review", "engagement-planner",
                        "attribute-set-review"],
    )  # fmt: skip


def _context(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_path(team, control)}/context")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _notes(team: dict[str, Any], control: str) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = _context(team, control)["attributes_agent_notes"]
    return notes


def test_the_shapes_of_itgc_ac_01_are_read_and_a_quote_the_records_lack_is_never_kept(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "aa-shapes")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    script = _Script(migrated, team, control)
    misquoted = _proposal(DOCUMENTED, "DOCUMENTED", "words nobody at the client wrote")
    # The drafter: its list and its issues as the text of their JSON.
    script.answers["attributes"] = [
        {"attributes": json.dumps([_proposal(), misquoted]), "issues": "[]"}
    ]
    # The reviewer of the drafts, as on 13 November 2026: each row's optional `follows` as
    # null.
    script.answers["draft-review"] = [
        lambda prompt: {"attributes": [{**row, "follows": None} for row in _drafted(prompt)],
                        "fixes": []}
    ]  # fmt: skip
    with connect(migrated.url) as connection:
        title = load_facts(connection, team["project"], UUID(control)).title

    def planned(_prompt: str) -> dict[str, Any]:
        # The planner, as on 12 and 13 November 2026: `phases` inside the text of
        # `understanding`, a fact whose quote the records do not hold, and one they hold
        # in other typography.
        output = script.plan()
        output["understanding"]["facts"] = [
            {"field": "PERFORMER", "value": "The IT service desk", "basis": "SOURCE",
             "quote": "The IT service desk grants all access."},
            {"field": "DESCRIPTION", "value": "The control as named.", "basis": "SOURCE",
             "quote": f"“{title.upper()}.”"},
        ]  # fmt: skip
        text = json.dumps(output["understanding"]) + ',"phases":' + json.dumps(output["phases"])
        rest = {k: v for k, v in output.items() if k not in ("understanding", "phases")}
        return {"understanding": text, **rest}

    script.answers["planner"] = [planned]
    # The reviewer of the set, its answer inside a wrapper.
    script.answers["set-review"] = [{OUTPUT_TOOL: {"attributes": [], "findings": []}}]
    with connect(migrated.url) as connection:
        assert run_plan(connection, script, plan_id) == "DONE"
    # Each agent answered once: every shape was read, nothing needed a correction.
    assert [who for who in script.calls if who != "other"] == [
        "attributes", "draft-review", "planner", "set-review",
    ]  # fmt: skip
    calls = _calls(migrated, control)
    assert [(row[0], row[1], row[2]) for row in calls] == [
        ("attributes", "SUCCEEDED", ""), ("attribute-review", "SUCCEEDED", ""),
        ("engagement-planner", "SUCCEEDED", ""), ("attribute-set-review", "SUCCEEDED", ""),
    ]  # fmt: skip
    read = {row[0]: row[3].get("unnested") for row in calls}
    assert read["attributes"] == ["attributes", "issues"]
    assert read["attribute-review"] == [
        "attributes[0].follows: null left out", "attributes[1].follows: null left out",
    ]  # fmt: skip
    assert read["engagement-planner"] == ["understanding", "phases"]
    assert read["attribute-set-review"] == ["wrapper:record_output"]
    assert all(row[4]["validation"] == "ACCEPTED" for row in calls)
    # The drafter's misquote: its quote is not kept, and the proposal says so.
    proposed = {
        str(row[0]): row[1:]
        for row in _rows(
            migrated,
            "SELECT text, basis, source_quote, note FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'PROPOSED'",
            UUID(control),
        )
    }
    assert set(proposed) == {ADDED, DOCUMENTED}
    assert proposed[DOCUMENTED][:2] == ("INFERRED", "")
    assert proposed[DOCUMENTED][2].startswith("The quoted words were not found in the source.")
    # The planner's plan is used; the fact its quote does not hold up is left out, never
    # replaced, and said: on the plan's note and on the call's outcome.
    plan = _rows(
        migrated,
        "SELECT source, understanding, note FROM evidence_plans WHERE id = %s",
        plan_id,
    )[0]
    assert plan[0] == "MODEL"
    facts = plan[1].get("facts", [])
    assert [fact["field"] for fact in facts] == ["DESCRIPTION"]
    assert "left out" in plan[2] and "do not hold" in plan[2]
    planner = next(row for row in calls if row[0] == "engagement-planner")
    assert planner[4]["dropped"] == ["understanding.facts[0]"]
    # Nothing failed, so the step has nothing to say.
    context = _context(team, control)
    assert context["attributes_agent_notes"] == [] and context["attributes_failure_note"] == ""
    # The planner is asked again and none of its answers can be used: the agent's plan
    # stands, and the step says so. The note is read from the records alone, never from
    # whether a rerun would do anything (the step said nothing when it would not, 13
    # November 2026).
    unusable = _Script(migrated, team, control)
    unusable.answers["planner"] = [{"understanding": "Prose.", "phases": []}]
    with connect(migrated.url) as connection:
        generate(
            connection,
            unusable,
            UUID(str(team["org"])),
            UUID(str(team["project"])),
            UUID(control),
            team["owner_id"],
        )
        connection.commit()
        assert latest_plan_failure_note(connection, UUID(control)).startswith(KEPT_NOTE)
        said = attributes_failure_note(
            connection, UUID(control), notes_for(connection, UUID(control)), "", ""
        )
    context = _context(team, control)
    assert [note["step"] for note in context["attributes_agent_notes"]] == ["engagement-planner"]
    assert context["attributes_failure_note"] == said
    assert "kept as it was" in said and "Run again" in said
    plan_body = team["owner"].get(f"{_path(team, control)}/evidence-plan").json()
    assert plan_body["failure_note"].startswith(KEPT_NOTE)
    assert "Plan the evidence again" in plan_body["failure_note"]


def test_a_part_that_fails_is_corrected_once_then_said_in_plain_words_until_an_answer_is_used(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "aa-notes")
    _answer_required(migrated, team, control, client)
    plan_id = _plan_run(migrated, control)[0]
    script = _Script(migrated, team, control)
    # Each answer misses a required part or has prose where the plan's object belongs,
    # twice over.
    script.answers["attributes"] = [{"attributes": [{"text": ADDED}], "issues": []}]
    script.answers["planner"] = [{"understanding": "The control is reviewed.", "phases": []}]
    script.answers["set-review"] = [{"attributes": [{"id": "x", "verdict": "FINE"}],
                                     "findings": []}]  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_plan(connection, script, plan_id) == "DONE"
    # One correction each (the planner keeps its own two), and no drafts to review.
    assert [who for who in script.calls if who != "other"] == [
        "attributes", "attributes", "planner", "planner", "planner", "set-review", "set-review",
    ]  # fmt: skip
    # The correction names the place and the reason, and carries the previous answer.
    again = script.prompts["attributes"][1]
    assert "could not be used" in again and "attributes[0].action: Field required" in again
    assert "<your_previous_answer>" in again
    assert "attributes[0].verdict" in script.prompts["set-review"][1]
    # Nothing of either answer was used: no proposal was written.
    assert _rows(
        migrated,
        "SELECT count(*) FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'PROPOSED'",
        UUID(control),
    ) == [(0,)]
    calls = _calls(migrated, control)
    drafter = [row for row in calls if row[0] == "attributes"]
    assert drafter[0][4]["validation"] == "REJECTED" and drafter[0][4]["corrected"] is True
    assert drafter[1][3]["correction"] == 1 and "attributes[0].action" in drafter[1][3]["rejected"]
    assert "note" in drafter[1][4] and drafter[1][4]["validation"] == "REJECTED"
    # Where the planner's text broke the schema is recorded with its call.
    planner = [row for row in calls if row[0] == "engagement-planner"]
    assert planner[0][1:3] == (
        "MALFORMED", "answer did not match the schema (answer.understanding: expected object, "
        "got string)",
    )  # fmt: skip
    # The step reads what failed, what was kept and what to do, from the records.
    notes = _notes(team, control)
    assert [note["step"] for note in notes] == [
        "attributes", "engagement-planner", "attribute-set-review",
    ]  # fmt: skip
    for note in notes:
        assert note["failed"] and note["kept"] and "Run again" in note["next_step"]
        assert note["sentence"] == f"{note['failed']} {note['kept']} {note['next_step']}"
        assert note["agent"].startswith("The ") and UUID(note["model_call_id"])
    assert "attributes[0].action" in notes[0]["failed"]
    assert "write their criteria" in notes[0]["next_step"]
    assert "no criteria were tailored" in notes[1]["kept"]
    assert "not reviewed" in notes[2]["kept"]
    assert _context(team, control)["attributes_failure_note"] == " ".join(
        note["sentence"] for note in notes
    )
    # A person runs the agents again; their answers are used, and the notes are gone.
    with connect(migrated.url) as connection:
        again_id = request_attributes_run(connection, team["project"], UUID(control), True)
        connection.commit()
        assert again_id == plan_id
        assert run_plan(connection, _Script(migrated, team, control), plan_id) == "DONE"
    context = _context(team, control)
    assert context["attributes_agent_notes"] == [] and context["attributes_failure_note"] == ""


# The person's sentence on every run record the screens read (`failure_note`)

# Every run record an agent's work is read through, by its body: each carries
# `failure_note` (one plain sentence, "" when none), which the screens show.
RUN_RECORDS = (
    ("process_understanding", "RunBody"),  # the context's narrative run
    ("evidence_plans", "EvidencePlanBody"),
    ("master_plans", "MasterPlanBody"),
    ("evidence_assurance", "RequestBody"),  # a D&I check request entry
    ("evidence_wizard", "ReadBody"),  # a wizard file's `read`
    ("pbc_drafting", "DraftBody"),
    ("test_sheets", "SheetBody"),
    ("workpaper_service", "WorkpaperBody"),
    ("control_reviews", "ReviewBody"),
    ("console", "MessageBody"),
    ("evidence_analysis", "AnalysisBody"),
    ("rcm_uploads", "SystemsBody"),
    ("rcm_uploads", "TermsBody"),
    ("system_applicability", "SocReportBody"),
    ("prior_year", "ReferenceBody"),
    ("understanding_chat", "NotesResult"),  # the walkthrough notes
    ("policy_evidence", "PolicyEvidenceBody"),  # the policy reading
    ("context_routes", "ContextBody"),  # attributes_failure_note, below
)


def test_every_run_record_carries_a_failure_note() -> None:
    for module, name in RUN_RECORDS:
        body = getattr(importlib.import_module(f"ai_workforce_api.{module}"), name)
        field = "attributes_failure_note" if name == "ContextBody" else "failure_note"
        assert field in body.model_fields, (module, name)
        assert body.model_fields[field].annotation is str and body.model_fields[field].default == ""


def _plain(sentence: str) -> None:
    """One plain note: what failed, then what was kept and what to do, in full sentences."""
    assert sentence and sentence[0].isupper() and sentence.endswith("."), sentence
    assert "None" not in sentence and "{" not in sentence, sentence


def test_each_record_says_what_failed_what_was_kept_and_what_to_do() -> None:
    from ai_workforce_api import (
        console,
        control_reviews,
        evidence_analysis,
        evidence_assurance,
        evidence_plans,
        evidence_wizard,
        pbc_drafting,
        rcm_uploads,
        system_applicability,
        workpaper_service,
    )

    # A run that gave no usable answer is said; one that did, or still runs, is not.
    said = [
        evidence_plans.plan_failure_note("FALLBACK", evidence_plans.KEPT_NOTE),
        evidence_analysis.analysis_failure_note("FAILED", None, "The file could not be read."),
        evidence_analysis.analysis_failure_note(
            "READY", "FALLBACK", "The model was rate limited. The rules classified it."
        ),
        rcm_uploads.run_failure_note("FAILED", None, "Mapping the terms did not finish.", "terms"),
        rcm_uploads.run_failure_note("READY", "FALLBACK", "Model answer rejected.", "systems"),
        system_applicability.report_failure_note("FAILED", "The agent could not read it."),
        evidence_assurance.check_failure_note("The check stopped before it finished."),
        evidence_wizard.read_failure_note("FAILED", "The file could not be read."),
        pbc_drafting.draft_failure_note("FAILED", None, ""),
        workpaper_service.draft_failure_note("IDLE", workpaper_service.DRAFT_FAILED, None),
        control_reviews.reperform_failure_note("IDLE", None, control_reviews.REPERFORM_FAILED),
        console.failure_note("AGENT", "FAILED", "The model did not answer in time.", False, True),
    ]
    for sentence in said:
        _plain(sentence)
    assert "Plan the evidence again" in said[0] and "Read the file again" in said[1]
    quiet = [
        evidence_plans.plan_failure_note("MODEL", ""),
        evidence_analysis.analysis_failure_note("READY", "MODEL", ""),
        rcm_uploads.run_failure_note("READY", "MODEL", "", "terms"),
        system_applicability.report_failure_note("READ", ""),
        evidence_wizard.read_failure_note("READY", "Read."),
        pbc_drafting.draft_failure_note("DRAFTED", "MODEL", ""),
        console.failure_note("AGENT", "DONE", "", False, True),
        console.failure_note("AGENT", "WORKING", "x", False, False),
        console.failure_note("USER", "DONE", "x", False, False),
    ]
    assert quiet == [""] * len(quiet)
