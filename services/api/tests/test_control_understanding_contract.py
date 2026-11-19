"""The Control Understanding contract, the API's half (B1j, B1k, B1l; the second fix round of
B1k, 16 November 2026, after the re-check found the web posting to routes the API does not
have and reading fields the API does not send). The one list is tests/contracts/
control-understanding.json; tests/control-understanding-contract.test.ts proves the web's half
against the same list. No database: the routes are read from the app as registered, the
fields from the bodies' own models, and every route the web's contextWrite builds is checked
to exist here."""

import json
import re
import typing
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

import ai_workforce_api
from ai_workforce_api import (
    attribute_assumptions,
    control_attributes,
    control_context,
    understanding_chat,
    understanding_once,
    understanding_review,
)
from ai_workforce_api.context_routes import ContextBody, register_control_context
from ai_workforce_api.settings import Settings

REPO = Path(ai_workforce_api.__file__).resolve().parents[3]
CONTRACT: dict[str, Any] = json.loads(
    (REPO / "tests" / "contracts" / "control-understanding.json").read_text(encoding="utf-8")
)
WEB_MODEL = REPO / "apps" / "web" / "src" / "control-context-model.ts"
MODELS: dict[str, Any] = {
    "ContextBody": ContextBody,
    "AttributesBody": control_attributes.AttributesBody,
    "AttributeBody": control_attributes.AttributeBody,
    "ReviewBody": understanding_review.ReviewBody,
    "NotReviewedBody": understanding_review.NotReviewedBody,
    "ReviewRequestBody": understanding_review.ReviewRequestBody,
    "AssumptionBody": attribute_assumptions.AssumptionBody,
    "NeedBody": understanding_chat.NeedBody,
    # 18 November 2026: a QUESTION need carries its issue, read by the same parse as the
    # context's issues (control-context-model.parseIssue).
    "IssueBody": control_context.IssueBody,
}


def _routes() -> dict[tuple[str, str], APIRoute]:
    app = FastAPI()
    register_control_context(app, Settings(database_url="postgresql://unused/none"))
    found: dict[tuple[str, str], APIRoute] = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods or set():
                found[(method, route.path)] = route
    return found


ROUTES = _routes()


def _body_fields(route: APIRoute) -> list[str]:
    params = route.dependant.body_params
    if not params:
        return []
    assert len(params) == 1, route.path
    model = params[0].field_info.annotation
    args = [arg for arg in typing.get_args(model) if arg is not type(None)] or [model]
    return sorted(args[0].model_fields)


@pytest.mark.parametrize("item", CONTRACT["routes"], ids=lambda item: item["intent"])
def test_every_route_the_contract_names_exists_with_its_body(item: dict[str, Any]) -> None:
    path = CONTRACT["control"] + item["path"]
    route = ROUTES.get((item["method"], path))
    assert route is not None, f"{item['method']} {path} is not a route of the API"
    assert _body_fields(route) == sorted(item["body"])


def test_the_not_known_body_takes_what_the_web_sends() -> None:
    for item in CONTRACT["routes"]:
        if "sent" in item:
            body = understanding_review.AnswerNotKnownBody.model_validate(item["sent"])
            assert body.model_dump() == item["sent"]


def test_every_route_the_web_builds_exists_on_the_api() -> None:
    # Read from the web's own source (contextWrite), so a path the web posts to that the API
    # does not have fails here, whatever the web's own tests pin.
    source = WEB_MODEL.read_text(encoding="utf-8")
    body = source[source.index("export function contextWrite") : source.index("MAX_UPLOAD")]
    base = "/organizations/{organization_id}/projects/{project_id}"
    names = {
        "control": CONTRACT["control"], "project": base, "attributeId": "{attribute_id}",
        "issueId": "{issue_id}", "assumptionId": "{assumption_id}",
        "documentId": "{document_id}",
    }  # fmt: skip
    paths = set()
    for template in re.findall(r"`(\$\{(?:control|project)\}[^`]*)`", body):
        if template == "${project}/controls/${controlId}":
            continue
        path = re.sub(r"\$\{(\w+)\}", lambda match: names[match.group(1)], template)
        paths.add(path)
    assert CONTRACT["control"] + "/understanding/review/follow" in paths
    known = {path for (_method, path) in ROUTES}
    missing = sorted(paths - known)
    assert missing == [], f"the web builds routes the API does not have: {missing}"


@pytest.mark.parametrize("name", sorted(CONTRACT["fields"]))
def test_every_field_the_web_reads_is_one_the_api_sends(name: str) -> None:
    fields = set(MODELS[name].model_fields)
    missing = sorted(set(CONTRACT["fields"][name]) - fields)
    assert missing == [], f"{name} lacks {missing}"
    for absent in CONTRACT["absent"].get(name, []):
        assert absent not in fields, f"{name}.{absent} is not part of the contract"


def test_the_values_both_sides_read_are_the_same() -> None:
    values = CONTRACT["values"]
    assert list(typing.get_args(understanding_review.NotRun)) == values["review_not_run"]
    assert list(typing.get_args(understanding_chat.NeedStatus)) == values["need_status"]
    # Added after the end-to-end check of the second fix round of B1k (16 November 2026): the
    # need kinds a not-known is read for are the ones the web keeps apart (DOCUMENT is not).
    assert understanding_chat.not_known_kinds() == values["not_known_kinds"]
    assert "DOCUMENT" not in values["not_known_kinds"]
    assert list(typing.get_args(understanding_once.QuestionPass)) == values["question_pass"]
    status = understanding_review.ReviewRequestBody.model_fields["status"].annotation
    assert list(typing.get_args(status)) == values["review_request_status"]
    assert understanding_review.SET_HELD_BY_CONFLICT == values["set_held_sentence"]
    assert understanding_review.HELD_BY_CONFLICT == values["held_sentence"]
    assert attribute_assumptions.reopened_cause("x").startswith(values["reopened_cause_prefix"])


def test_no_route_function_shadows_a_module_its_routes_use() -> None:
    # Found in the second fix round of B1k: the GET route function was named
    # understanding_review, so inside register_control_context that name was the route, not
    # the module. The not-known routes then read their body as a query parameter and the
    # review routes would have failed at run time.
    import ast

    from ai_workforce_api import context_routes

    tree = ast.parse(Path(context_routes.__file__).read_text(encoding="utf-8"))
    module_names: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.Import | ast.ImportFrom):
            module_names.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.FunctionDef | ast.ClassDef):
            module_names.add(node.name)
    register = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "register_control_context"
    )
    local = {node.name for node in register.body if isinstance(node, ast.FunctionDef)}
    assert local & module_names == set()
    # And every body is read as a body, never as a query parameter.
    for (_method, path), route in ROUTES.items():
        for param in route.dependant.query_params:
            assert param.name != "body", path
