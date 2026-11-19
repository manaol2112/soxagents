"""scripts/changed_tests.py selects the tests of what changed (make check-changed, make
test-changed). No database is used.

Testing assessment, 19 November 2026: the selection saw only services/api/tests, so a change
to tests/test_smoke.py selected nothing; a change to the Makefile, a script or a workflow
selected none of the tests that guard it; and make test-changed ran pytest from services/api,
where a repository-root path does not resolve.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[3]


def _selector() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "changed_tests", ROOT / "scripts" / "changed_tests.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["changed_tests"] = module
    spec.loader.exec_module(module)
    return module


ct = _selector()


def _python(*files: str) -> set[str]:
    chosen, _ = ct.select(list(files))
    return {path.relative_to(ROOT).as_posix() for path in chosen}


def _node(*files: str) -> set[str]:
    _, chosen = ct.select(list(files))
    return {path.relative_to(ROOT).as_posix() for path in chosen}


def test_every_file_pytest_collects_is_a_candidate() -> None:
    collected = {path.relative_to(ROOT).as_posix() for path in ct.python_tests()}
    assert "tests/test_smoke.py" in collected
    assert "services/api/tests/test_changed_tests.py" in collected
    # A module of the application whose name starts with test_ is not a test file.
    assert "services/api/ai_workforce_api/test_rounds.py" not in collected


def test_a_changed_test_file_selects_itself_wherever_it_is() -> None:
    assert _python("tests/test_smoke.py") == {"tests/test_smoke.py"}
    assert _python("services/api/tests/test_test_tiers.py") == {
        "services/api/tests/test_test_tiers.py"
    }
    assert _node("tests/theme.test.ts") == {"tests/theme.test.ts"}


def test_the_files_tests_read_select_the_tests_that_guard_them() -> None:
    assert _python("Makefile") >= {
        "services/api/tests/test_test_tiers.py",
        "services/api/tests/test_ci_gate.py",
        "tests/test_smoke.py",
    }
    assert "tests/autosave-view.test.ts" in _node("Makefile"), "a Node test reads it too"
    assert _python("scripts/run_tests.py") >= {
        "services/api/tests/test_run_tests_script.py",
        "services/api/tests/test_ci_gate.py",
    }
    assert "services/api/tests/test_changed_tests.py" in _python("scripts/changed_tests.py")
    assert "tests/test_smoke.py" in _python("scripts/reset.sh")
    assert _python(".github/workflows/ci.yml") >= {
        "services/api/tests/test_ci_gate.py",
        "tests/test_smoke.py",
    }
    assert "services/api/tests/test_test_tiers.py" in _python("pyproject.toml")
    assert "tests/test_smoke.py" in _python("docker-compose.yml", ".env.example")


def test_every_guard_named_exists() -> None:
    for guard, tests in ct.GUARDS.items():
        assert (ROOT / guard).is_file(), guard
        for test in tests:
            assert (ROOT / test).is_file(), (guard, test)


def test_a_document_selects_no_test() -> None:
    # Tests cite docs in comments; a doc change is not a reason to run them.
    assert _python("docs/test-baseline.md") == set()
    assert _node("docs/test-baseline.md") == set()


def test_the_run_is_from_the_root_so_both_kinds_of_path_resolve() -> None:
    tests = [ROOT / "tests" / "test_smoke.py", ROOT / "services/api/tests/test_test_tiers.py"]
    command, cwd = ct.pytest_command(tests, "2")
    assert cwd == ROOT
    assert command[:3] == [sys.executable, "-m", "pytest"]
    paths = [word for word in command if word.endswith(".py")]
    assert paths == ["services/api/tests/test_test_tiers.py", "tests/test_smoke.py"]
    assert all((cwd / path).is_file() for path in paths)
