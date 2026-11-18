"""Every pytest file belongs to a tier. No database is used.

Governance assessment, 17 November 2026: the Makefile's tier lists are kept by hand, and 75
of 211 test files (929 tests) had drifted out of all of them, security tests among them, so
no routine command and no CI run executed them. A test file is now in the fast, critical or
demo tier, or it is named in FULL_ONLY_PY as a decision; a new file in none fails here.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TESTS = ROOT / "services" / "api" / "tests"
MAKEFILE = (ROOT / "Makefile").read_text(encoding="utf-8")


def _variable(name: str) -> str:
    found = re.search(rf"^{name} (?:\?=|:=) (.*)$", MAKEFILE, re.MULTILINE)
    assert found is not None, f"the Makefile has no {name}"
    return found.group(1)


def _files(text: str) -> set[str]:
    """Whole files a list names: `test_x.py`, not the file of a picked `test_x.py::test`."""
    return set(re.findall(r"\b(test_\w+\.py)(?!::)", text))


EVERY = {path.name for path in TESTS.glob("test_*.py")}
FAST = _files(_variable("FAST_PY"))
CRITICAL = _files(_variable("CRITICAL_PY"))
DEMO = _files(_variable("DEMO_PY"))
FULL_ONLY = _files(_variable("FULL_ONLY_PY"))


def test_every_test_file_is_in_a_tier_or_named_as_full_only() -> None:
    nowhere = sorted(EVERY - FAST - CRITICAL - DEMO - FULL_ONLY)
    assert nowhere == [], (
        "add each to FAST_PY or CRITICAL_PY in the Makefile, or to FULL_ONLY_PY when it "
        f"is to run in the full suite only: {nowhere}"
    )


def test_no_list_names_a_file_that_is_gone() -> None:
    assert sorted((FAST | CRITICAL | DEMO | FULL_ONLY) - EVERY) == []


def test_full_only_is_a_decision_not_a_second_listing() -> None:
    assert sorted(FULL_ONLY & (FAST | CRITICAL | DEMO)) == []


def test_the_safeguard_tests_run_in_the_critical_tier() -> None:
    # What a routine run must never skip: the prompt-data neutraliser, the reliability
    # audit, secrets kept out of text, and this guard itself.
    for name in (
        "test_prompt_data.py",
        "test_reliability_audit.py",
        "test_secret_text.py",
        "test_authorization.py",
        "test_approvals.py",
        "test_independence.py",
        "test_test_tiers.py",
    ):
        assert name in CRITICAL, name


def test_the_gate_runs_every_node_test() -> None:
    # `make test` (what CI runs) takes the whole node suite, not a hand-kept list.
    assert re.search(r"^test: test-critical test-node$", MAKEFILE, re.MULTILINE)
    assert re.search(
        r"^test-node:\n\tpnpm exec node --test tests/\*\.test\.ts$", MAKEFILE, re.MULTILINE
    )
