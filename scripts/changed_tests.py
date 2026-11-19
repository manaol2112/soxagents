"""Select the tests that cover what changed (make test-changed, make check-changed).

Reads the files changed since a git ref (default: the merge base with main) plus any
untracked files, and maps each to the tests that exercise it:

- services/api/ai_workforce_api/<module>.py  -> every Python test that imports or names
  ai_workforce_api.<module>, plus services/api/tests/test_<module>.py when it exists
- migrations/*.sql                           -> test_migrations.py and test_schema.py
- apps/web/src/<name>.ts|tsx                 -> every Node test that imports that file
- the Makefile, pyproject.toml, docker-compose.yml, .env.example, scripts/*, .github/*
                                             -> every test that names the file, and the
  tests that guard it (GUARDS): the tier guard, the CI gate, the runner's tests, the
  repository smoke checks
- a test file                                -> itself: any file pytest collects (its
  python_files patterns in each of pyproject's testpaths, at any depth), or a Node test

Selection is by direct reference, one level deep, so a change that reaches a test only
through another module can be missed: CI runs the critical tier on every push as well.
Prints the selection, then runs it unless --list is given. Paths are relative to the
repository root, where pytest runs, so a test in tests/ and one in services/api/tests/
both work.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_SRC = ROOT / "services" / "api" / "ai_workforce_api"
API_TESTS = ROOT / "services" / "api" / "tests"
WEB_SRC = ROOT / "apps" / "web" / "src"
NODE_TESTS = ROOT / "tests"

# Files that are not code a test imports, but that tests read: a change to one selects
# every test that names it (by its file name) and, whatever the tests say, its guards.
GUARDED = ("Makefile", "pyproject.toml", "docker-compose.yml", ".env.example")
GUARDED_DIRS = ("scripts/", ".github/")
GUARDS: dict[str, tuple[str, ...]] = {
    "Makefile": (
        "services/api/tests/test_test_tiers.py",
        "services/api/tests/test_ci_gate.py",
        "tests/test_smoke.py",
    ),
    "pyproject.toml": ("services/api/tests/test_test_tiers.py",),
    "docker-compose.yml": ("tests/test_smoke.py",),
    ".env.example": ("tests/test_smoke.py",),
    "scripts/run_tests.py": (
        "services/api/tests/test_run_tests_script.py",
        "services/api/tests/test_ci_gate.py",
    ),
    "scripts/changed_tests.py": ("services/api/tests/test_changed_tests.py",),
    "scripts/env_status.py": ("services/api/tests/test_env_status.py",),
    "scripts/reset.sh": ("tests/test_smoke.py",),
    ".github/workflows/ci.yml": ("services/api/tests/test_ci_gate.py", "tests/test_smoke.py"),
}


def _git(*args: str) -> list[str]:
    out = subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True, text=True
    ).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def changed_files(base: str | None) -> list[str]:
    if base is None:
        found = _git("merge-base", "HEAD", "main")
        base = found[0] if found else "HEAD"
    files = set(_git("diff", "--name-only", base)) | set(_git("diff", "--name-only"))
    files |= set(_git("ls-files", "--others", "--exclude-standard"))
    return sorted(files)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def python_tests(root: Path = ROOT) -> list[Path]:
    """Every file pytest collects: pyproject's python_files patterns in each testpath."""
    options = tomllib.loads(_read(root / "pyproject.toml"))["tool"]["pytest"]["ini_options"]
    patterns = options.get("python_files", ["test_*.py", "*_test.py"])
    found: set[Path] = set()
    for folder in options["testpaths"]:
        for pattern in patterns:
            for path in (root / folder).rglob(pattern):
                if "__pycache__" not in path.parts and "node_modules" not in path.parts:
                    found.add(path)
    return sorted(found)


def _is_guarded(name: str) -> bool:
    return name in GUARDED or name.startswith(GUARDED_DIRS)


def select(files: list[str]) -> tuple[set[Path], set[Path]]:
    py_tests = python_tests()
    node_tests = sorted(NODE_TESTS.glob("*.test.ts"))
    collected = {path.relative_to(ROOT).as_posix() for path in py_tests}
    py_sources = {path: _read(path) for path in py_tests}
    node_sources = {path: _read(path) for path in node_tests}
    chosen_py: set[Path] = set()
    chosen_node: set[Path] = set()
    for name in files:
        path = ROOT / name
        parts = Path(name).parts
        if name in collected:
            chosen_py.add(path)
        elif name.startswith("services/api/ai_workforce_api/") and name.endswith(".py"):
            module = Path(name).stem
            pattern = re.compile(rf"ai_workforce_api\.{re.escape(module)}\b")
            for test, source in py_sources.items():
                if pattern.search(source):
                    chosen_py.add(test)
            own = API_TESTS / f"test_{module}.py"
            if own.exists():
                chosen_py.add(own)
        elif parts and parts[0] == "migrations":
            for test_name in ("test_migrations.py", "test_schema.py"):
                if (API_TESTS / test_name).exists():
                    chosen_py.add(API_TESTS / test_name)
        elif name.startswith("apps/web/src/") and name.endswith((".ts", ".tsx")):
            stem = Path(name).stem
            pattern = re.compile(rf"/src/{re.escape(stem)}(\.ts|\.tsx)?[\"']")
            for test, source in node_sources.items():
                if pattern.search(source):
                    chosen_node.add(test)
        elif name.startswith("tests/") and name.endswith(".test.ts"):
            if path.exists():
                chosen_node.add(path)
        elif _is_guarded(name):
            named = re.compile(rf"(?<![\w.-]){re.escape(Path(name).name)}(?![\w.-])")
            for test, source in py_sources.items():
                if named.search(source):
                    chosen_py.add(test)
            for test, source in node_sources.items():
                if named.search(source):
                    chosen_node.add(test)
            chosen_py |= {ROOT / test for test in GUARDS.get(name, ()) if (ROOT / test).exists()}
    return chosen_py, chosen_node


def pytest_command(tests: list[Path], workers: str) -> tuple[list[str], Path]:
    """The pytest run for a selection: from the repository root, as the Makefile's tiers
    run, with paths relative to it, through `python -m pytest` (application control can
    block the pytest launcher on Windows)."""
    command = [
        sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
        "-n", workers, "--dist", "loadfile",
        *[test.relative_to(ROOT).as_posix() for test in sorted(tests)],
    ]  # fmt: skip
    return command, ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--base", help="git ref to diff against (default: merge base with main)")
    parser.add_argument("--list", action="store_true", help="print the selection, do not run")
    parser.add_argument("--workers", default="auto", help="pytest-xdist workers (default auto)")
    args = parser.parse_args()
    files = changed_files(args.base)
    py_tests, node_tests = select(files)
    print(f"{len(files)} changed files -> {len(py_tests)} Python test files, "
          f"{len(node_tests)} Node test files")  # fmt: skip
    for test in sorted(py_tests):
        print("  ", test.relative_to(ROOT).as_posix())
    for test in sorted(node_tests):
        print("  ", test.relative_to(ROOT).as_posix())
    if args.list:
        return 0
    status = 0
    if py_tests:
        command, cwd = pytest_command(sorted(py_tests), args.workers)
        print("$", " ".join(command))
        status = subprocess.run(command, cwd=cwd, check=False).returncode
    if node_tests:
        command = [
            "node",
            "--test",
            *[test.relative_to(ROOT).as_posix() for test in sorted(node_tests)],
        ]
        print("$", " ".join(command))
        node_status = subprocess.run(
            command, cwd=ROOT, check=False, shell=os.name == "nt"
        ).returncode
        status = status or node_status
    return status


if __name__ == "__main__":
    sys.exit(main())
