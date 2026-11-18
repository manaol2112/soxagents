"""Every API route refuses a person from another firm. Governance guard, 18 November 2026.

The assessment of 17 November enumerated the routes statically and found each non-public
one reaching `authorize`, but nothing kept it so: a new route without the check would pass
every test. This test asks every route of the application, as the owner of one firm, for
another firm's organization and project, with a body built from the route's own schema so
the request reaches the handler rather than stopping at validation. No route may answer
with success or a server error. Routes outside an organization are listed by name with the
reason they are open to any signed-in person; a new one fails here until it is listed.
"""

import re
from typing import Any
from uuid import uuid4

from fastapi.routing import APIRoute
from support import Database
from test_outbound import _team, migrated

from ai_workforce_api.auth import PUBLIC_PATHS, PUBLIC_PREFIXES

__all__ = ["migrated"]

# Routes not under an organization, each with why a signed-in person may call it. They act
# on the caller's own account or on nothing tenant-owned; their own tests cover them.
OWN_ACCOUNT: dict[tuple[str, str], str] = {
    ("GET", "/auth/me"): "the caller's own identity",
    ("GET", "/organizations"): "only the firms the caller is a member of (list_organizations)",
    ("GET", "/mailbox/configuration"): "four on/off flags of the deployment; no tenant data",
    ("GET", "/me/last-page"): "the caller's own last page, while they may still open it",
    ("PUT", "/me/last-page"): "the caller's own last page; refused for a page they may not open",
}

# Routes whose outsider call stops at body validation (422), so authorization is not reached
# with a well-formed request: counted on 18 November 2026. It may fall; it may not rise
# without a look at the new route (give it a body the schema builder can make, or lower it).
STOPPED_AT_VALIDATION = 30

# What a refusal may look like: not signed in, not allowed, not visible, not this method,
# a state or a rate refusal, or a request the route does not accept.
REFUSED = frozenset({400, 401, 403, 404, 405, 409, 413, 415, 422, 423, 429})


def _resolve(schema: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        name = schema["$ref"].rsplit("/", 1)[-1]
        schema = spec["components"]["schemas"][name]
    return schema


def _value(schema: dict[str, Any], spec: dict[str, Any], depth: int = 0) -> Any:
    """A value the schema accepts, as plainly as it allows: what a well-formed request from
    an outsider would send, so that only authorization can refuse it."""
    schema = _resolve(schema, spec)
    for key in ("anyOf", "oneOf", "allOf"):
        if key in schema:
            options = [_resolve(item, spec) for item in schema[key]]
            chosen = next((o for o in options if o.get("type") != "null"), options[0])
            return _value(chosen, spec, depth)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    if "default" in schema and schema["default"] is not None:
        return schema["default"]
    kind = schema.get("type")
    if kind == "object" or "properties" in schema:
        if depth > 6:
            return {}
        required = set(schema.get("required", []))
        return {
            name: _value(item, spec, depth + 1)
            for name, item in schema.get("properties", {}).items()
            if name in required
        }
    if kind == "array":
        least = schema.get("minItems", 0)
        return [_value(schema.get("items", {}), spec, depth + 1) for _ in range(least)]
    if kind == "integer":
        return max(1, schema.get("minimum", 1))
    if kind == "number":
        return max(1.0, schema.get("minimum", 1.0))
    if kind == "boolean":
        return False
    if kind == "string":
        form = schema.get("format", "")
        if form == "uuid":
            return str(uuid4())
        if form == "date-time":
            return "2027-01-04T10:00:00Z"
        if form == "date":
            return "2027-01-04"
        if form == "email":
            return "outsider@example.com"
        least = max(1, schema.get("minLength", 1))
        return "x" * least
    return "x"


def _calls(app: Any, organization: str, project: str) -> list[tuple[str, str, str, Any]]:
    spec = app.openapi()
    found: list[tuple[str, str, str, Any]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted((route.methods or set()) - {"HEAD", "OPTIONS"}):
            operation = spec["paths"].get(route.path_format, {}).get(method.lower(), {})
            path = route.path_format.replace("{organization_id}", organization)
            path = path.replace("{project_id}", project)
            path = re.sub(r"\{[a-z_]*id\}", lambda _m: str(uuid4()), path)
            path = re.sub(r"\{[^}]+\}", "x", path)
            query = {
                item["name"]: _value(item.get("schema", {}), spec)
                for item in operation.get("parameters", [])
                if item.get("in") == "query" and item.get("required")
            }
            if query:
                path += "?" + "&".join(f"{name}={value}" for name, value in query.items())
            body: Any = None
            content = operation.get("requestBody", {}).get("content", {})
            if "application/json" in content:
                body = _value(content["application/json"].get("schema", {}), spec)
            found.append((method, route.path_format, path, body))
    return found


def _public(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES)


def test_no_route_serves_another_firm(migrated: Database) -> None:
    _seeded, _project, outsider, _admin = _team(migrated, "rt-outsider")
    target, target_project, _owner, _target_admin = _team(migrated, "rt-target")
    organization, project = str(target["organization_id"]), str(target_project)
    app = outsider.app
    served: list[str] = []
    broken: list[str] = []
    unlisted: list[str] = []
    reached = validated = 0
    calls = _calls(app, organization, project)
    for method, template, path, body in calls:
        if _public(template):
            continue
        if "{organization_id}" not in template:
            if (method, template) not in OWN_ACCOUNT:
                unlisted.append(f"{method} {template}")
            continue
        response = outsider.request(method, path, json=body)
        status = response.status_code
        validated += status == 422
        reached += status != 422
        if 200 <= status < 300:
            served.append(f"{method} {template} -> {status}")
        elif status >= 500:
            broken.append(f"{method} {template} -> {status}")
        else:
            assert status in REFUSED, f"{method} {template} -> {status}"
    print(
        f"routes called: {reached + validated}; refused past validation: {reached}; "
        f"stopped at validation: {validated}; outside an organization: {len(unlisted)}"
    )
    assert served == [], f"answered another firm's request with success: {served}"
    assert broken == [], f"failed with a server error for an outsider: {broken}"
    assert validated <= STOPPED_AT_VALIDATION, (
        f"{validated} routes stop at validation for an outsider (at most {STOPPED_AT_VALIDATION})"
    )
    assert unlisted == [], (
        f"routes outside an organization must be listed in OWN_ACCOUNT with a reason: {unlisted}"
    )


def test_the_last_page_cannot_point_at_another_firm(migrated: Database) -> None:
    _seeded, _project, outsider, _admin = _team(migrated, "rt-last-outsider")
    target, target_project, _owner, _target_admin = _team(migrated, "rt-last-target")
    path = f"/?organization={target['organization_id']}&project={target_project}"
    stored = outsider.put("/me/last-page", json={"path": path})
    assert stored.status_code in REFUSED, stored.text
    assert outsider.get("/me/last-page").json() in (None, {}) or (
        outsider.get("/me/last-page").json().get("organization_id")
        != str(target["organization_id"])
    )


def test_every_organization_free_route_listed_still_exists(migrated: Database) -> None:
    _seeded, _project, outsider, _admin = _team(migrated, "rt-listed")
    app: Any = outsider.app
    routes = {
        (method, route.path_format)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }
    assert sorted(set(OWN_ACCOUNT) - routes) == []
