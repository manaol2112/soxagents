"""Every API path the web app spells out exists in the API. No database is used.

Governance assessment, finding A3 (18 November 2026): the web reads the API through
hand-written calls, and once already posted to routes the API did not have, with the tests
on both sides green (tests/control-understanding-contract.test.ts). This test reads every
literal API path in apps/web (after `apiBaseUrl()`, or given to `apiGet` and its kin, with a
file's `const base = ...` prefix expanded), turns each `${...}` into a wildcard, and
requires a route of the API with the same shape. A path built elsewhere (`${write.path}`)
is not followed: those are counted, so the share this test cannot see stays visible.
"""

import re
from pathlib import Path

from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web"
# Counted on 18 November 2026; a drop means the patterns stopped finding the web's calls.
CHECKED_AT_LEAST = 85

# A literal path after `${apiBaseUrl()}` in a template literal.
_AFTER_BASE = re.compile(r"\$\{apiBaseUrl\(\)\}(/[^`\"'\s]*)")
# The first argument of apiGet / apiPost / ... when it is a template literal.
_HELPER = re.compile(r"\bapi(?:Get|Post|Put|Patch|Delete|Fetch|Json)(?:<[^>]*>)?\(\s*`([^`]*)`")
# A file's path prefix: const base = `/organizations/${...}/projects/${...}`.
_BASE = re.compile(r"(?:const|let) base = `(/[^`]*)`")
_PLACEHOLDER = re.compile(r"\$\{[^}]*\}")
# A query glued to the end of the last segment: .../console${query}. Any other placeholder
# glued to a segment (/public/evidence-portal${path}) is a path built elsewhere.
_TRAILING = re.compile(r"(?<=[a-z0-9-])\$\{(?:query|search|qs|params)\}$")
_GLUED = re.compile(r"[a-z0-9-]\$\{[^}]*\}$")


def _routes() -> list[list[str]]:
    app = create_app(Settings(database_url="postgresql://unused@127.0.0.1:1/unused"))
    return [path.strip("/").split("/") for path in app.openapi()["paths"]]


def _shape(literal: str) -> list[str] | None:
    """The path's segments with each placeholder as "*"; None for no path."""
    path = _TRAILING.sub("", literal.split("?", 1)[0])
    if _GLUED.search(path):
        return None
    segments = [segment for segment in path.strip("/").split("/") if segment != ""]
    if not segments:
        return None
    return ["*" if _PLACEHOLDER.fullmatch(segment) else segment for segment in segments]


def _matches(shape: list[str], route: list[str]) -> bool:
    return len(shape) == len(route) and all(
        part == "*" or part == piece for part, piece in zip(shape, route, strict=True)
    )


def _calls() -> tuple[list[tuple[str, list[str]]], int]:
    """Each call's file and the paths it may be (one per `base` its file defines)."""
    found: list[tuple[str, list[str]]] = []
    computed = 0
    files = [*WEB.glob("app/**/*.ts"), *WEB.glob("src/**/*.ts"), *WEB.glob("src/**/*.tsx")]
    for file in sorted(files):
        if any(part == "node_modules" or part.startswith(".next") for part in file.parts):
            continue
        text = file.read_text(encoding="utf-8")
        name = file.relative_to(ROOT).as_posix()
        computed += len(re.findall(r"\$\{apiBaseUrl\(\)\}\$\{", text))
        bases = _BASE.findall(text)
        for pattern in (_AFTER_BASE, _HELPER):
            for literal in pattern.findall(text):
                if literal.startswith("${base}"):
                    found.append((name, [prefix + literal[len("${base}") :] for prefix in bases]))
                elif literal.startswith("/"):
                    found.append((name, [literal]))
    return found, computed


def test_every_api_path_the_web_spells_out_exists() -> None:
    routes = _routes()
    calls, computed = _calls()
    checked = 0
    missing: list[str] = []
    for name, candidates in calls:
        shapes = [shape for shape in map(_shape, candidates) if shape and shape[0] != "*"]
        if not shapes:
            continue
        checked += 1
        if not any(_matches(shape, route) for shape in shapes for route in routes):
            missing.append(f"{name}: {candidates[0]}")
    print(f"web calls checked: {checked}; built elsewhere, not followed: {computed}")
    assert missing == [], f"the web calls API paths that do not exist: {missing}"
    assert checked >= CHECKED_AT_LEAST, f"only {checked} calls found"


def test_the_shape_reader() -> None:
    assert _shape("/organizations/${org}/projects/${project}/console${query}") == [
        "organizations", "*", "projects", "*", "console",
    ]  # fmt: skip
    assert _shape("/auth/logout") == ["auth", "logout"]
    assert _shape("${write.path}") == ["*"]
    assert _shape("/public/evidence-portal${path}") is None
    assert _matches(["organizations", "*"], ["organizations", "{organization_id}"])
    assert not _matches(["organizations", "*", "nope"], ["organizations", "{organization_id}"])
