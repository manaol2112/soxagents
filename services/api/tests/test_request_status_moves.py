"""Every change of a request's status follows a known rule. No database is used.

Governance assessment, finding A4 (18 November 2026): pbc.py's _TRANSITIONS is enforced on
the request's own update route, while about ten other modules set pbc_requests.status in
their own SQL. A rule changed in one place and not the other would let a request's status
contradict its approval history. This test reads every `UPDATE pbc_requests SET status =`
in the package and requires each (from, to) it can make to be either in _TRANSITIONS or a
named service transition below, with its reason. A write that names no from-state fails,
unless it is listed with the guard that stands in for one.
"""

import ast
import re
from pathlib import Path

from ai_workforce_api import evidence_plans, evidence_receipts, scope_changes
from ai_workforce_api.pbc import _TRANSITIONS

PACKAGE = Path(__file__).resolve().parents[1] / "ai_workforce_api"

# Moves no person makes on the update route, made by a service with its own checks.
SERVICE_TRANSITIONS: dict[tuple[str, str], str] = {
    ("APPROVAL_PENDING", "SENT"): "sent only once its approval is decided (outbound.py, "
    "evidence_groups.py grouped send)",
    ("SENT", "RECEIVED"): "every item the request carries is accepted before a reply "
    "(evidence_plans: received when nothing is left to ask)",
    ("RECEIVED", "DRAFT"): "a receipt undone when evidence is moved off an item, audited "
    "as pbc.receipt_undone (evidence_receipts.py)",
    ("PARTIALLY_RECEIVED", "DRAFT"): "the same receipt undone (evidence_receipts.py)",
}

# Writes whose from-states are a constant passed as `status = ANY(%s)`, or checked in
# Python just before the write: (module, to-status) -> the from-states.
GUARDED_ELSEWHERE: dict[tuple[str, str], frozenset[str]] = {
    ("evidence_plans.py", "RECEIVED"): frozenset(evidence_plans._STILL_ASKED),
    ("scope_changes.py", "CANCELLED"): frozenset(scope_changes.UNSENT_REQUESTS),
    ("evidence_receipts.py", "DRAFT"): frozenset(evidence_receipts._EVIDENCE),
}

_TO = re.compile(r"\bSET\b.*?\bstatus\s*=\s*'([A-Z_]+)'", re.IGNORECASE)
_FROM = re.compile(r"\bstatus\s*=\s*'([A-Z_]+)'")
_FROM_IN = re.compile(r"\bstatus\s+IN\s*\(([^)]*)\)", re.IGNORECASE)


def _text(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(str(v.value) if isinstance(v, ast.Constant) else "{}" for v in node.values)
    return None


def _writes() -> list[tuple[str, int, str, list[str]]]:
    """Each status write: module, line, to-status, the from-states its WHERE names."""
    found: list[tuple[str, int, str, list[str]]] = []
    for path in sorted(PACKAGE.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            text = _text(node)
            if text is None:
                continue
            flat = " ".join(text.split())
            match = re.search(r"UPDATE pbc_requests\b(.*)", flat, re.IGNORECASE)
            if match is None:
                continue
            to = _TO.search(match.group(1))
            if to is None:
                continue
            parts = re.split(r"\bWHERE\b", match.group(1), maxsplit=1, flags=re.IGNORECASE)
            where = parts[1] if len(parts) == 2 else ""
            froms = _FROM.findall(where)
            for group in _FROM_IN.findall(where):
                froms += re.findall(r"'([A-Z_]+)'", group)
            found.append((path.name, getattr(node, "lineno", 0), to.group(1), froms))
    return found


def test_every_status_write_follows_the_table_or_a_named_service_move() -> None:
    writes = _writes()
    assert len(writes) >= 15, "the status writes are no longer found"
    unexplained: list[str] = []
    for module, line, to, froms in writes:
        if not froms:
            listed = GUARDED_ELSEWHERE.get((module, to))
            if listed is None:
                unexplained.append(f"{module}:{line} -> {to} names no from-state")
                continue
            froms = sorted(listed)
        for state in froms:
            if state == to or to in _TRANSITIONS.get(state, set()):
                continue
            if (state, to) not in SERVICE_TRANSITIONS:
                unexplained.append(f"{module}:{line} {state} -> {to}")
    assert unexplained == [], unexplained


def test_the_named_moves_are_still_made_and_not_already_in_the_table() -> None:
    made: set[tuple[str, str]] = set()
    for module, _line, to, froms in _writes():
        states = froms or sorted(GUARDED_ELSEWHERE.get((module, to), frozenset()))
        made.update((state, to) for state in states)
    for state, to in SERVICE_TRANSITIONS:
        assert (state, to) in made, f"{state} -> {to} is no longer made: remove it"
        assert to not in _TRANSITIONS.get(state, set()), f"{state} -> {to} is in the table"
