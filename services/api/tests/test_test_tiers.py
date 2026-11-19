"""Every pytest file belongs to a tier. No database is used.

Governance assessment, 17 November 2026: the Makefile's tier lists are kept by hand, and 75
of 211 test files (929 tests) had drifted out of all of them, security tests among them, so
no routine command and no CI run executed them. A test file is now in the fast, critical or
demo tier, or it is named in FULL_ONLY_PY as a decision; a new file in none fails here.

Testing assessment, 19 November 2026: the guard looked only in services/api/tests, so
tests/test_smoke.py (the .env template's blank secrets, live email off, the compose pins,
the only volume delete) sat in no tier and only `make test-full` ran it. The guard now reads
every test file pytest collects, in every directory of its testpaths, by its path.
"""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MAKEFILE = (ROOT / "Makefile").read_text(encoding="utf-8")
PYTEST_OPTIONS = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["tool"][
    "pytest"
]["ini_options"]


def _variable(name: str) -> str:
    found = re.search(rf"^{name} (?:\?=|:=) (.*)$", MAKEFILE, re.MULTILINE)
    assert found is not None, f"the Makefile has no {name}"
    return found.group(1)


def make_words(name: str) -> list[str]:
    """The words of a Makefile list as make expands them: variable references first, then
    `$(addprefix <prefix>,<words>)`. Any other function fails here, so a new form is never
    silently read as nothing. Also used by test_ci_gate.py."""
    text = _variable(name)
    reference = re.compile(r"\$\(([A-Z_]+)\)")
    addprefix = re.compile(r"\$\(addprefix ([^,()$]*),([^()$]*)\)")
    for _ in range(10_000):  # each pass expands one form; the lists hold a few hundred
        found = reference.search(text)
        if found is not None:
            text = text[: found.start()] + _variable(found.group(1)) + text[found.end() :]
            continue
        found = addprefix.search(text)
        if found is not None:
            words = " ".join(found.group(1) + word for word in found.group(2).split())
            text = text[: found.start()] + words + text[found.end() :]
            continue
        break
    assert "$" not in text, f"a Makefile form this test does not read: {text}"
    return text.split()


def _files(name: str) -> set[str]:
    """Whole files a list names, by path: not the file of a picked `file.py::test`."""
    return {word for word in make_words(name) if "::" not in word}


def _collected() -> set[str]:
    """Every file pytest collects: its python_files patterns in each of its testpaths, at
    any depth."""
    patterns = PYTEST_OPTIONS.get("python_files", ["test_*.py", "*_test.py"])
    found: set[str] = set()
    for folder in PYTEST_OPTIONS["testpaths"]:
        for pattern in patterns:
            for path in (ROOT / folder).rglob(pattern):
                if "__pycache__" not in path.parts and "node_modules" not in path.parts:
                    found.add(path.relative_to(ROOT).as_posix())
    return found


EVERY = _collected()
FAST = _files("FAST_PY")
CRITICAL = _files("CRITICAL_PY")
DEMO = _files("DEMO_PY")
FULL_ONLY = _files("FULL_ONLY_PY")


def test_every_test_file_is_in_a_tier_or_named_as_full_only() -> None:
    nowhere = sorted(EVERY - FAST - CRITICAL - DEMO - FULL_ONLY)
    assert nowhere == [], (
        "add each to FAST_PY or CRITICAL_PY in the Makefile, or to FULL_ONLY_PY when it "
        f"is to run in the full suite only: {nowhere}"
    )


def test_the_guard_reads_every_test_directory() -> None:
    # Both testpaths hold test files, so a guard that reads only one would show here.
    assert {path.split("/", 1)[0] for path in EVERY} >= {"tests", "services"}
    assert "tests/test_smoke.py" in EVERY
    assert "services/api/tests/test_test_tiers.py" in EVERY


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
        # The CI gate's parts, the runner that reports them and the selection it runs
        # (19 November 2026).
        "test_ci_gate.py",
        "test_run_tests_script.py",
        "test_changed_tests.py",
    ):
        assert f"services/api/tests/{name}" in CRITICAL, name
    # Blank secrets in the .env template, live email off, the only volume delete.
    assert "tests/test_smoke.py" in CRITICAL


def test_the_gate_runs_every_node_test() -> None:
    # `make test` takes the whole node suite, not a hand-kept list; so does CI, which runs
    # test-node as one of its parts (test_ci_gate.py).
    assert re.search(r"^test: test-critical test-node$", MAKEFILE, re.MULTILINE)
    assert re.search(
        r"^test-node:\n\tpnpm exec node --test tests/\*\.test\.ts$", MAKEFILE, re.MULTILINE
    )
