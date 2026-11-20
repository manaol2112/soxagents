"""The audit invariants (docs/audit-invariants.md) are each held by a critical-tier test, and
what is not yet held names its defect and the increment that will hold it. Pure: no database.

The process change decided by the product owner on 19 November 2026 (audit rules,
fail-closed, a hostile test model): the sixteen invariants were in a private note only, and
nothing failed when a test guarding one left the critical tier. The document's tables are the
single registry; this file reads them and checks them against the Makefile's tiers and the
test files themselves.

Also here, three invariants checked directly: I9, the result and conclusion vocabularies are
one closed set wherever they are spelled; I14, an agent principal is denied every registered
action, and authorization refuses one before it reads anything.
"""

from __future__ import annotations

import ast
import re
from functools import cache
from typing import Any, get_args
from uuid import uuid4

import pytest
from test_test_tiers import ROOT, _files, make_words

from ai_workforce_api import console_tools, policy, test_sheets, testing_engine, workpaper_fill
from ai_workforce_api.actions import CATALOG, ActionField, parameters_ok
from ai_workforce_api.authorization import AccessDenied, Action, Principal, PrincipalKind, authorize

DOC = ROOT / "docs" / "audit-invariants.md"
CRITICAL = _files("CRITICAL_PY")
PICKED = frozenset(make_words("CRITICAL_PICKED"))
IDS = tuple(f"I{n}" for n in range(1, 17))
HELD = ("in full", "in part", "open")
_NODE = re.compile(r"`(services/api/tests/[a-z0-9_]+\.py::[a-z0-9_]+)`")
_DEFECT = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")
_UNASSIGNED = re.compile(r"unassigned: \S.{3,}")
_SKIPPING = frozenset({"skip", "skipif", "xfail"})
_STOPPING = frozenset({"skip", "xfail", "importorskip"})


# --- The document's tables ---------------------------------------------------------------


def _table(heading: str) -> list[list[str]]:
    """The rows of the first table under `## heading`, each cell stripped. A heading or
    table that is not there fails here, never reads as an empty registry."""
    text = DOC.read_text(encoding="utf-8")
    start = text.find(f"\n## {heading}\n")
    assert start >= 0, f"docs/audit-invariants.md has no section '{heading}'"
    section = text[start + 1 :]
    end = section.find("\n## ", 1)
    section = section if end < 0 else section[:end]
    lines = [line for line in section.splitlines() if line.startswith("|")]
    assert len(lines) > 2, f"the section '{heading}' has no table rows"
    rows = [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in lines[2:]]
    width = len(lines[0].strip().strip("|").split("|"))
    assert all(len(row) == width for row in rows), f"a row of '{heading}' has the wrong width"
    return rows


@cache
def invariants() -> dict[str, tuple[str, tuple[str, ...]]]:
    """Each invariant: how it is held, and the node ids holding it."""
    found: dict[str, tuple[str, tuple[str, ...]]] = {}
    for ident, _rule, held, by in _table("Invariants"):
        assert ident not in found, f"{ident} is listed twice"
        found[ident] = (held, tuple(_NODE.findall(by)))
        assert by.count("`") == 2 * len(found[ident][1]), (
            f"{ident}: a held-by entry is not a node id"
        )
    return found


@cache
def increments() -> frozenset[str]:
    return frozenset(row[0] for row in _table("Increments"))


def increment_known(name: str) -> bool:
    """An increment of the closed set, or `unassigned: <the decision it waits for>`."""
    return name in increments() or _UNASSIGNED.fullmatch(name) is not None


@cache
def open_parts() -> dict[str, tuple[str, str]]:
    """Each open defect: the invariant it leaves open and the increment that closes it."""
    found: dict[str, tuple[str, str]] = {}
    for invariant, defect, _what, increment in _table("Open parts"):
        assert defect not in found, f"the defect {defect} has two rows"
        found[defect] = (invariant, increment)
    return found


# --- Whether a node id is a test that runs in the critical tier --------------------------


def _marks(node: ast.AST) -> set[str]:
    """The names of every attribute or name used in a decorator or `pytestmark`."""
    return {
        part.attr if isinstance(part, ast.Attribute) else part.id
        for part in ast.walk(node)
        if isinstance(part, (ast.Attribute, ast.Name))
    }


def node_problem(node: str) -> str | None:
    """Why `path::name` is not a critical-tier test that runs, or None. By reading the file,
    never by importing it: a test is found as a module-level function or a method of a
    module-level class."""
    path, name = node.split("::", 1)
    file = ROOT / path
    if not file.is_file():
        return f"{node}: no such file"
    if path not in CRITICAL and node not in PICKED:
        return f"{node}: neither its file is in CRITICAL_PY nor the test in CRITICAL_PICKED"
    problem = source_problem(file.read_text(encoding="utf-8"), name)
    return None if problem is None else f"{node}: {problem}"


def _skipping_mark(body: list[ast.stmt]) -> bool:
    """A `pytestmark = ...` among these statements that skips or xfails."""
    return any(
        isinstance(statement, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "pytestmark"
            for target in statement.targets
        )
        and bool(_marks(statement.value) & _SKIPPING)
        for statement in body
    )


def _pytest_calls(node: ast.AST, skip_bodies: bool = False) -> set[str]:
    """The `pytest.<name>(...)` calls under `node`; with skip_bodies, those of the module's
    own statements only, not inside a function or class body (which run only when called)."""
    found: set[str] = set()
    pending: list[ast.AST] = [node]
    while pending:
        current = pending.pop()
        if (
            isinstance(current, ast.Call)
            and isinstance(current.func, ast.Attribute)
            and isinstance(current.func.value, ast.Name)
            and current.func.value.id == "pytest"
        ):
            found.add(current.func.attr)
        for child in ast.iter_child_nodes(current):
            if skip_bodies and isinstance(
                child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
            ):
                pending += [*child.decorator_list]
                continue
            pending.append(child)
    return found


def source_problem(source: str, name: str) -> str | None:
    """Why the test `name` of this module's source would not run, or None: missing, or
    skipped or xfailed by the module (its pytestmark, a module-level pytest.skip or
    importorskip), by its class (a decorator or the class body's pytestmark) or by itself
    (a decorator, or a pytest.skip, xfail or importorskip call)."""
    tree = ast.parse(source)
    if _skipping_mark(tree.body):
        return "its module's pytestmark skips or xfails it"
    if _pytest_calls(tree, skip_bodies=True) & _STOPPING:
        return "its module calls pytest.skip, xfail or importorskip"
    functions: list[tuple[ast.FunctionDef, ast.ClassDef | None]] = [
        (s, None) for s in tree.body if isinstance(s, ast.FunctionDef)
    ]
    for statement in tree.body:
        if isinstance(statement, ast.ClassDef):
            functions += [(s, statement) for s in statement.body if isinstance(s, ast.FunctionDef)]
    found = [(function, owner) for function, owner in functions if function.name == name]
    if not found:
        return "no such test"
    function, owner = found[0]
    if owner is not None and (
        any(_marks(decorator) & _SKIPPING for decorator in owner.decorator_list)
        or _skipping_mark(owner.body)
    ):
        return "its class is marked skip, skipif or xfail"
    if any(_marks(decorator) & _SKIPPING for decorator in function.decorator_list):
        return "marked skip, skipif or xfail"
    if _pytest_calls(function) & _STOPPING:
        return "calls pytest.skip, xfail or importorskip"
    return None


def test_every_invariant_is_held_in_the_critical_tier() -> None:
    found = invariants()
    assert tuple(found) == IDS, "the invariants are I1 to I16, in order, each once"
    problems: list[str] = []
    for ident, (held, nodes) in found.items():
        if held not in HELD:
            problems.append(f"{ident}: held '{held}', not one of {HELD}")
        elif (held == "open") != (not nodes):
            problems.append(f"{ident}: held '{held}' with {len(nodes)} held-by tests")
        problems += [problem for node in nodes if (problem := node_problem(node)) is not None]
    assert problems == []


def test_every_open_part_names_its_defect_and_increment() -> None:
    parts = open_parts()
    problems = [
        f"{defect}: {why}"
        for defect, (invariant, increment) in parts.items()
        for why in (
            *(["names no known invariant"] if invariant not in IDS else []),
            *(["is not a defect id"] if _DEFECT.fullmatch(defect) is None else []),
            *([f"names '{increment}', not a known increment"]
              if not increment_known(increment) else []),
        )
    ]  # fmt: skip
    held = invariants()
    with_rows = {invariant for invariant, _increment in parts.values()}
    for ident, (how, _nodes) in held.items():
        if how == "in full" and ident in with_rows:
            problems.append(f"{ident} is held in full but has open parts")
        if how != "in full" and ident not in with_rows:
            problems.append(f"{ident} is held {how} but names no open part")
    assert problems == []


def test_the_registry_reads_its_tables_and_rejects_a_test_that_does_not_run() -> None:
    """The checks above are not vacuous: the tables are read whole, an unknown increment is
    refused, and a missing test, a test outside the critical tier and a skipped test are
    each a problem."""
    assert len(open_parts()) > 20 and "OE pass rules" in increments()
    assert not increment_known("later") and increment_known("unassigned: owner decision D3")
    assert "no such test" in str(node_problem("services/api/tests/test_policy.py::test_none"))
    # test_models.py runs in the full suite only (FULL_ONLY_PY).
    assert "CRITICAL" in str(node_problem("services/api/tests/test_models.py::test_anything"))
    skipped = ast.parse("import pytest\n@pytest.mark.skipif(True, reason='x')\ndef test_a(): ...\n")
    function = skipped.body[1]
    assert isinstance(function, ast.FunctionDef)
    assert _marks(function.decorator_list[0]) & _SKIPPING
    # Each way pytest skips a test is a problem, and the same test unskipped is not (review
    # of the audit-invariants increment, 19 November 2026: a class-level mark, a class
    # body's pytestmark and importorskip were missed).
    plain = "import pytest\nclass TestA:\n    def test_a(self): ...\ndef test_b(): ...\n"
    assert source_problem(plain, "test_a") is None and source_problem(plain, "test_b") is None
    test_a = "def test_a(): ...\n"
    skipping = {
        "class": "import pytest\n@pytest.mark.skip\nclass TestA:\n    def test_a(self): ...\n",
        "class pytestmark": (
            "import pytest\nclass TestA:\n    pytestmark = pytest.mark.xfail\n"
            "    def test_a(self): ...\n"
        ),
        "module importorskip": "import pytest\npytest.importorskip('nothing')\n" + test_a,
        "test importorskip": "import pytest\ndef test_a():\n    pytest.importorskip('x')\n",
        "module pytestmark": "import pytest\npytestmark = [pytest.mark.skip]\n" + test_a,
        "test skip": "import pytest\ndef test_a():\n    pytest.skip('x')\n",
    }
    for way, source in skipping.items():
        assert source_problem(source, "test_a") is not None, way


# --- I9: one closed vocabulary -----------------------------------------------------------


def _web(source: str, pattern: str) -> str:
    found = re.search(pattern, source, re.S)
    assert found is not None, pattern
    return found.group(1)


def _latest_conclusion_check() -> set[str]:
    """The values the newest migration that names `test_sheets_conclusion` allows."""
    named = [
        path for path in sorted((ROOT / "migrations").glob("*.sql"))
        if "test_sheets_conclusion" in path.read_text(encoding="utf-8")
    ]  # fmt: skip
    assert named, "no migration defines test_sheets_conclusion"
    text = named[-1].read_text(encoding="utf-8")
    check = re.search(r"CONSTRAINT test_sheets_conclusion CHECK \((.*?)\)\s*[,)]", text, re.S)
    assert check is not None, f"{named[-1].name} names the constraint without a CHECK"
    return set(re.findall(r"'([A-Z_]+)'", check.group(1)))


def test_results_and_conclusions_are_one_closed_vocabulary() -> None:
    """I9: the five OE results, and the signed conclusion, are spelled the same wherever they
    are spelled: the engine, the web's sheet model, the workpaper, the console's override
    tool, how a stored result is read, and the database's check on a signed sheet."""
    results = testing_engine.RESULTS
    assert get_args(testing_engine.Result) == results and len(set(results)) == 5
    assert set(testing_engine.OPEN_RESULTS) == {None, "UNABLE", "REVIEW"}
    source = (ROOT / "apps/web/src/sheet-model.ts").read_text(encoding="utf-8")
    typed = re.findall(r'"([A-Z_]+)"', _web(source, r"export type Result =(.*?);"))
    listed = re.findall(r'"([A-Z_]+)"', _web(source, r"export const RESULTS[^=]*= \[(.*?)\];"))
    labels = dict(
        re.findall(
            r'([A-Z_]+): "([^"]+)"', _web(source, r"export const RESULT_LABELS[^{]*\{(.*?)\}")
        )
    )
    assert tuple(typed) == tuple(listed) == results
    assert labels == workpaper_fill.RESULT_WORDS and tuple(labels) == results
    field: Any = console_tools.TestResultArgs.model_fields["result"].annotation
    assert get_args(field) == results
    assert [test_sheets._result(value) for value in (*results, "SKIPPED", "pass", None)] == [
        *results, None, None, None,
    ]  # fmt: skip
    signed = set(get_args(testing_engine.Conclusion)) - {"INCOMPLETE"}
    assert _latest_conclusion_check() == signed == {"EFFECTIVE", "NOT_EFFECTIVE"}


# --- I14: an agent principal decides nothing ---------------------------------------------


class _NoDatabase:
    """A connection the checks must never use: any attribute read is recorded and fails."""

    def __init__(self) -> None:
        self.used: list[str] = []

    def __getattr__(self, name: str) -> Any:
        self.used.append(name)
        raise AssertionError(f"the database was used ({name}) before the agent was refused")


_VALID = {"reference": "ref-1041", "email": "owner@example.com", "text": "A routine change",
          "role": "REVIEWER"}  # fmt: skip


def _valid(field: ActionField) -> str:
    return _VALID[field.kind]


def test_an_agent_principal_is_denied_every_registered_action() -> None:
    """I14: for every action in the catalogue, with parameters that are valid (so a denial is
    never only 'invalid'), an agent principal is denied before any database read."""
    agent = Principal(PrincipalKind.AGENT, uuid4())
    assert len(CATALOG) >= 9
    for action in CATALOG:
        parameters = {field.name: _valid(field) for field in action.fields}
        assert parameters_ok(action, parameters), action.action_id
        connection = _NoDatabase()
        reads: Any = connection
        decision = policy.evaluate(reads, agent, uuid4(), uuid4(), action.action_id, parameters)
        assert (decision.decision, decision.reason in ("permission", "agent")) == ("DENY", True), (
            action.action_id, decision,
        )  # fmt: skip
        assert connection.used == [], action.action_id


@pytest.mark.parametrize("action", list(Action))
def test_authorization_refuses_an_agent_principal_before_any_read(action: Action) -> None:
    """I14: `authorize` refuses an agent principal for every action before it runs any SQL."""
    connection = _NoDatabase()
    reads: Any = connection
    with pytest.raises(AccessDenied):
        authorize(
            reads,
            principal=Principal(PrincipalKind.AGENT, uuid4()),
            action=action,
            organization_id=uuid4(),
            project_id=uuid4(),
        )
    assert connection.used == []
