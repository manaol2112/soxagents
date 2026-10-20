"""Select the tests that cover what changed (make test-changed).

Reads the files changed since a git ref (default: the merge base with main) plus any
untracked files, and maps each to the tests that exercise it:

- services/api/ai_workforce_api/<module>.py  -> every Python test that imports or names
  ai_workforce_api.<module>, plus services/api/tests/test_<module>.py when it exists
- migrations/*.sql                           -> test_migrations.py and test_schema.py
- apps/web/src/<name>.ts|tsx                 -> every Node test that imports that file
- a test file                                -> itself

Selection is by direct reference, one level deep, so a change that reaches a test only
through another module can be missed: milestone closeouts run make test-critical as
well. Prints the selection, then runs it unless --list is given.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_SRC = ROOT / "services" / "api" / "ai_workforce_api"
API_TESTS = ROOT / "services" / "api" / "tests"
WEB_SRC = ROOT / "apps" / "web" / "src"
NODE_TESTS = ROOT / "tests"


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


def select(files: list[str]) -> tuple[set[Path], set[Path]]:
    py_tests = sorted(API_TESTS.glob("test_*.py"))
    node_tests = sorted(NODE_TESTS.glob("*.test.ts"))
    py_sources = {path: _read(path) for path in py_tests}
    node_sources = {path: _read(path) for path in node_tests}
    chosen_py: set[Path] = set()
    chosen_node: set[Path] = set()
    for name in files:
        path = ROOT / name
        parts = Path(name).parts
        if name.startswith("services/api/ai_workforce_api/") and name.endswith(".py"):
            module = Path(name).stem
            pattern = re.compile(rf"ai_workforce_api\.{re.escape(module)}\b")
            for test, source in py_sources.items():
                if pattern.search(source):
                    chosen_py.add(test)
            own = API_TESTS / f"test_{module}.py"
            if own.exists():
                chosen_py.add(own)
        elif parts[0] == "migrations":
            for test_name in ("test_migrations.py", "test_schema.py"):
                if (API_TESTS / test_name).exists():
                    chosen_py.add(API_TESTS / test_name)
        elif name.startswith("services/api/tests/test_") and name.endswith(".py"):
            if path.exists():
                chosen_py.add(path)
        elif name.startswith("apps/web/src/") and name.endswith((".ts", ".tsx")):
            stem = Path(name).stem
            pattern = re.compile(rf"/src/{re.escape(stem)}(\.ts|\.tsx)?[\"']")
            for test, source in node_sources.items():
                if pattern.search(source):
                    chosen_node.add(test)
        elif name.startswith("tests/") and name.endswith(".test.ts"):
            if path.exists():
                chosen_node.add(path)
    return chosen_py, chosen_node


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
        command = [
            "uv", "run", "pytest", "-q", "-p", "no:cacheprovider",
            "-n", args.workers, "--dist", "loadfile",
            *[str(test.relative_to(ROOT / "services" / "api")) for test in sorted(py_tests)],
        ]  # fmt: skip
        print("$", " ".join(command))
        status = subprocess.run(command, cwd=ROOT / "services" / "api", check=False).returncode
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
