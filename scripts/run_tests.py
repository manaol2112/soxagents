"""Run tests for the gates in docs/test-strategy.md §1, so no agent has to supervise a run.

Subcommands (each prints a summary of at most 20 lines; the full output goes to a log):

  pytest [targets]   One pytest run: a machine-wide lock (one heavy run at a time; a second
                     invocation waits and says so), two workers by default, a wall-clock
                     limit, stack dumps for a test that hangs, JUnit XML and the log in
                     test-results/<label>/ (git-ignored). Environment errors (port
                     exhaustion 10048, a 503 from a lost connection, a failed PostgreSQL
                     connect) are rerun once alone and reported on their own line, never
                     hidden; outside CI only. --shard K/N runs one deterministic part,
                     balanced by CI's measured times (scripts/test_durations.json);
                     each run writes its own times to test-results/<label>/durations.json.
  changed            make check-changed (G0): ruff, mypy, tsc and biome on the changed
                     files, then the tests scripts/changed_tests.py selects, through the
                     same runner.
  prove              make prove (G1): shows that a new safeguard test fails without its fix.
                     A temporary git worktree reproduces the current tree (HEAD plus every
                     uncommitted and untracked change); the test must pass there, then the
                     fix (the named files restored to the base, or a patch reversed) is
                     taken out and the test must fail. Nothing in this worktree is touched
                     and nothing is stashed.
  durations LOG...   make test-durations: scripts/test_durations.json updated from the
                     durations lines of CI part logs (`gh run view <id> --log`).

Exit codes: 0 passed (or PROVED), 1 failed (or NOT PROVED), 2 inconclusive or a usage error,
124 timed out.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, TextIO

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "test-results"
# CI's measured seconds per test file (or picked test), which balance the CI parts (shard).
DURATIONS_FILE = "scripts/test_durations.json"
DURATIONS_KIND = "test-durations"
SUMMARY_LINES = 20
DEFAULT_WORKERS = 2
DEFAULT_TIMEOUT = 45 * 60
DEFAULT_TEST_TIMEOUT = 5 * 60
DEFAULT_LOCK_WAIT = 3 * 60 * 60
# More files than this are not listed on a command line (Windows allows 32,767 characters).
MAX_LISTED = 150
# Subprocess output is read as UTF-8 whatever the console's code page is.
TEXT: dict[str, Any] = {"text": True, "encoding": "utf-8", "errors": "replace"}
# Rerunning more than this many tests alone would take longer than the run; such a run is
# reported as environment failures and the exit is non-zero.
MAX_ENV_RERUN = 30

# One lock for every worktree of this machine's user: the runs share one PostgreSQL server.
LOCK_PATH = Path(
    os.environ.get("AI_WORKFORCE_TEST_LOCK", str(Path.home() / ".ai-workforce" / "tests.lock"))
)

# Errors of the machine, not the product (docs/test-baseline.md, B6). Checked in this order:
# a 10048 is also an OperationalError. The 503 pattern needs the status context (a
# response's reason phrase, or a status code named 503), so a line number 503 or a count
# that happens to be 503 is not one.
ENVIRONMENT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("10048", re.compile(r"Address already in use|/10048\)|WinError 10048|WSAEADDRINUSE")),
    (
        "503",
        re.compile(r"503 Service Unavailable|status(?:_code)?\W{1,4}503\b"),
    ),
    (
        "connect",
        re.compile(
            r"OperationalError\b[^\n]{0,300}?(?:connection failed|could not connect|"
            r"connection to server|too many clients|server closed the connection|"
            r"connection refused|timeout expired)",
            re.IGNORECASE,
        ),
    ),
)

# A test that fails without its fix for one of these reasons fails because the revert broke
# the code around it, not because the safeguard caught the missing fix.
NOT_A_PROOF = (
    "ImportError",
    "ModuleNotFoundError",
    "SyntaxError",
    "IndentationError",
    "NameError",
    "AttributeError",
    "TypeError",
)


# ---------------------------------------------------------------------------------------
# Results


@dataclass
class Case:
    nodeid: str
    outcome: str  # passed, failed, error, skipped
    message: str = ""
    seconds: float = 0.0
    environment: str = ""  # the ENVIRONMENT_PATTERNS label, for a failure or error


@dataclass
class Report:
    label: str
    cases: list[Case] = field(default_factory=list)
    seconds: float = 0.0
    exit_code: int = 0
    timed_out: bool = False
    junit: Path | None = None
    log: Path | None = None
    log_tail: list[str] = field(default_factory=list)
    rerun: dict[str, Case] = field(default_factory=dict)  # environment cases, rerun alone
    rerun_skipped: str = ""  # why environment cases were not rerun

    def count(self, outcome: str) -> int:
        return sum(1 for case in self.cases if case.outcome == outcome)

    @property
    def environment(self) -> list[Case]:
        return [case for case in self.cases if case.environment]

    @property
    def failures(self) -> list[Case]:
        """What the run holds against the code: every failure and error that is not an
        environment error cleared by its rerun."""
        found: list[Case] = []
        for case in self.cases:
            if case.outcome not in ("failed", "error"):
                continue
            again = self.rerun.get(case.nodeid)
            if case.environment and again is not None and again.outcome == "passed":
                continue
            found.append(again if again is not None and case.environment else case)
        return found

    @property
    def passed(self) -> bool:
        if self.timed_out or self.junit is None:
            return False
        if self.exit_code not in (0, 1):
            return False
        if self.exit_code == 1 and not any(
            case.outcome in ("failed", "error") for case in self.cases
        ):
            return False
        return not self.failures


def classify_environment(text: str) -> str:
    for label, pattern in ENVIRONMENT_PATTERNS:
        if pattern.search(text):
            return label
    return ""


def first_line(text: str, limit: int = 110) -> str:
    """The error's class and message on one line: the first `E   ` line of a pytest
    traceback when there is one, else the first non-empty line."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    marked = [line[1:].strip() for line in lines if line.startswith("E ")]
    chosen = marked[0] if marked else (lines[0] if lines else "")
    chosen = re.sub(r"\s+", " ", chosen)
    return chosen if len(chosen) <= limit else chosen[: limit - 1] + "..."


def nodeid_of(classname: str, name: str, file: str | None, root: Path = ROOT) -> str:
    """The pytest node id of a JUnit test case. xunit2 gives `a.b.test_x.TestC` and the
    name; the module is the longest prefix that is a file under the root."""
    parts = classname.split(".") if classname else []
    if file:
        module = Path(file).with_suffix("").as_posix().replace("/", ".")
        rest = classname[len(module) + 1 :] if classname.startswith(module + ".") else ""
        return "::".join([Path(file).as_posix(), *([p for p in rest.split(".") if p]), name])
    for cut in range(len(parts), 0, -1):
        candidate = Path(*parts[:cut]).with_suffix(".py")
        if (root / candidate).is_file():
            return "::".join([candidate.as_posix(), *parts[cut:], name])
    # A module that failed to collect: no class name, and the module's dotted path as name.
    if not classname and name and (root / Path(*name.split("."))).with_suffix(".py").is_file():
        return Path(*name.split(".")).with_suffix(".py").as_posix()
    return "::".join([*([classname] if classname else []), name])


def read_junit(path: Path, root: Path = ROOT) -> list[Case]:
    cases: list[Case] = []
    tree = ET.parse(path)
    for element in tree.iter("testcase"):
        nodeid = nodeid_of(
            element.get("classname", ""), element.get("name", ""), element.get("file"), root
        )
        seconds = float(element.get("time", "0") or 0)
        outcome, message = "passed", ""
        for child in element:
            if child.tag in ("failure", "error"):
                body = f"{child.get('message', '')}\n{child.text or ''}"
                # A failed teardown after a pass is still a failure of the run.
                outcome = "failed" if child.tag == "failure" else "error"
                message = body
                break
            if child.tag == "skipped":
                outcome, message = "skipped", child.get("message", "")
        environment = classify_environment(message) if outcome in ("failed", "error") else ""
        cases.append(Case(nodeid, outcome, message, seconds, environment))
    return cases


def duration(seconds: float) -> str:
    whole = int(round(seconds))
    if whole < 60:
        return f"{seconds:.1f}s"
    minutes, rest = divmod(whole, 60)
    return f"{minutes}m{rest:02d}s"


def summarize(report: Report, commit: str = "", limit: int = SUMMARY_LINES) -> list[str]:
    """At most `limit` lines: the verdict and counts, the environment line, the failing test
    ids with a one-line error, and where the JUnit XML and the log are."""
    if report.timed_out:
        verdict = "TIMED OUT"
    elif report.junit is None:
        verdict = "NO REPORT"
    elif not report.cases:
        verdict = "NO TESTS"
    else:
        verdict = "PASSED" if report.passed else "FAILED"
    counts = ", ".join(
        f"{report.count(outcome)} {outcome}"
        for outcome in ("passed", "failed", "error", "skipped")
        if report.count(outcome) or outcome == "passed"
    )
    head = f"{report.label}: {verdict} | {counts} | {duration(report.seconds)}"
    if commit:
        head += f" | {commit}"
    lines = [head]
    environment = report.environment
    if environment:
        kinds: dict[str, int] = {}
        for case in environment:
            kinds[case.environment] = kinds.get(case.environment, 0) + 1
        kinds_text = ", ".join(f"{label} x{n}" for label, n in sorted(kinds.items()))
        if report.rerun:
            cleared = sum(1 for c in report.rerun.values() if c.outcome == "passed")
            rerun = f"rerun alone: {cleared} passed, {len(report.rerun) - cleared} failed"
        else:
            rerun = f"not rerun ({report.rerun_skipped or 'rerun off'})"
        lines.append(f"Environment errors: {len(environment)} ({kinds_text}); {rerun}")
    else:
        lines.append("Environment errors: 0")
    if report.timed_out:
        lines.append("The wall-clock limit stopped the run; stacks of a hung test are in the log")
    if not os.environ.get("DATABASE_URL"):
        lines.append("DATABASE_URL is not set: the database tests were skipped")
    where = f"Log: {_shown(report.log)}"
    tail = [where + (f" | JUnit: {_shown(report.junit)}" if report.junit else "")]
    failures = report.failures
    room = limit - len(lines) - len(tail)
    if failures:
        room -= 1
        shown = failures if len(failures) <= room else failures[: max(room - 1, 0)]
        lines.append(f"Failing ({len(failures)}):")
        for case in shown:
            label = "ENV " if case.environment else ""
            lines.append(f"  {case.nodeid}  {label}{first_line(case.message)}")
        if len(shown) < len(failures):
            lines.append(f"  ... and {len(failures) - len(shown)} more in the JUnit XML")
    elif verdict != "PASSED" and report.log_tail:
        lines.extend(f"  {line[:120]}" for line in report.log_tail[: max(room, 0)])
    return (lines + tail)[:limit]


def _shown(path: Path | None) -> str:
    if path is None:
        return "-"
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


# ---------------------------------------------------------------------------------------
# The machine-wide lock


class LockTimeout(RuntimeError):
    pass


def _try_lock(handle: TextIO) -> bool:
    handle.seek(0)
    try:
        if sys.platform == "win32":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _unlock(handle: TextIO) -> None:
    handle.seek(0)
    if sys.platform == "win32":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextlib.contextmanager
def machine_lock(
    label: str,
    path: Path = LOCK_PATH,
    wait_seconds: float = DEFAULT_LOCK_WAIT,
    poll_seconds: float = 2.0,
    say: Callable[[str], None] = print,
) -> Iterator[None]:
    """One heavy test run at a time on this machine. The operating system releases the lock
    when its holder exits, however it exits, so a killed run never leaves it held."""
    path.parent.mkdir(parents=True, exist_ok=True)
    info = path.with_suffix(".holder.json")
    with open(path, "a+", encoding="utf-8") as handle:
        started = time.monotonic()
        told = False
        while not _try_lock(handle):
            if not told:
                holder = "another run"
                with contextlib.suppress(OSError, ValueError):
                    data = json.loads(info.read_text(encoding="utf-8"))
                    holder = f"{data['label']} (pid {data['pid']}, since {data['started']})"
                say(f"Waiting for {holder} to finish: one test run at a time on this machine")
                told = True
            if time.monotonic() - started > wait_seconds:
                raise LockTimeout(f"the test lock {path} was held for over {wait_seconds:.0f}s")
            time.sleep(poll_seconds)
        try:
            info.write_text(
                json.dumps(
                    {
                        "label": label,
                        "pid": os.getpid(),
                        "cwd": str(Path.cwd()),
                        "started": time.strftime("%H:%M:%S"),
                    }
                ),
                encoding="utf-8",
            )
            yield
        finally:
            with contextlib.suppress(OSError):
                info.unlink()
            _unlock(handle)


# ---------------------------------------------------------------------------------------
# Running pytest


def load_durations(root: Path = ROOT) -> dict[str, float]:
    """The measured seconds of each test entry (DURATIONS_FILE under the root), or none when
    the file is absent. A file that cannot be read as {"seconds": {entry: seconds}} stops the
    run: a split silently back on file sizes would undo the balance unnoticed."""
    path = root / DURATIONS_FILE
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    seconds = data.get("seconds") if isinstance(data, dict) else None
    if not isinstance(seconds, dict) or not all(
        isinstance(key, str) and isinstance(value, int | float) and value >= 0
        for key, value in seconds.items()
    ):
        raise ValueError(f"{DURATIONS_FILE} is not {{'seconds': {{entry: seconds}}}}")
    return {key: float(value) for key, value in seconds.items()}


def shard(
    entries: Sequence[str],
    index: int,
    count: int,
    root: Path = ROOT,
    durations: Mapping[str, float] | None = None,
) -> list[str]:
    """Part `index` (1-based) of `count`: every entry in exactly one part, the same parts for
    the same files, balanced by measured run time (longest first into the lightest part).
    The times are CI's (DURATIONS_FILE; `durations` replaces it). An entry with no time yet
    (a new file) weighs its size, at the seconds per byte of the entries that have one; a
    picked test (`file::test`) weighs its file's size over the file's number of tests. With
    no times at all, the split is by size."""
    if not 1 <= index <= count:
        raise ValueError(f"shard {index} of {count} does not exist")
    if len(set(entries)) != len(entries):
        raise ValueError("an entry is listed twice")
    measured = load_durations(root) if durations is None else durations

    def size(entry: str) -> int:
        path = root / entry.split("::", 1)[0]
        size = path.stat().st_size
        if "::" not in entry:
            return size
        tests = len(re.findall(r"^\s*(?:async\s+)?def test_", path.read_text("utf-8"), re.M))
        return max(1, size // max(tests, 1))

    timed = [entry for entry in sorted(entries) if entry in measured]
    timed_size = sum(size(entry) for entry in timed)
    per_byte = sum(measured[entry] for entry in timed) / timed_size if timed_size else 1.0
    weight = {
        entry: measured[entry] if entry in measured else size(entry) * per_byte for entry in entries
    }
    loads = [0.0] * count
    owner: dict[str, int] = {}
    for entry in sorted(entries, key=lambda e: (-weight[e], e)):
        lightest = min(range(count), key=lambda part: (loads[part], part))
        loads[lightest] += weight[entry]
        owner[entry] = lightest
    return [entry for entry in entries if owner[entry] == index - 1]


def entry_seconds(cases: Sequence[Case], entries: Sequence[str]) -> dict[str, float]:
    """Each run entry's measured seconds: the sum of its test cases' JUnit times (setup and
    teardown included), a whole file's every test, a picked test's own."""
    wanted = set(entries)
    totals: dict[str, float] = {}
    for case in cases:
        test = re.sub(r"\[.*\]$", "", case.nodeid)
        key = test if test in wanted else case.nodeid.split("::", 1)[0]
        if key in wanted:
            totals[key] = totals.get(key, 0.0) + case.seconds
    return {key: round(totals[key], 1) for key in sorted(totals)}


def durations_line(report: Report, entries: Sequence[str], commit: str = "") -> str:
    """One JSON line of the run's measured seconds per entry, for DURATIONS_FILE: CI prints
    it in each part's log, and `durations` reads it back from `gh run view --log`."""
    return json.dumps(
        {
            "kind": DURATIONS_KIND,
            "label": report.label,
            "commit": commit,
            "seconds": entry_seconds(report.cases, entries),
        }
    )


def read_durations_lines(text: str) -> list[dict[str, Any]]:
    """Every durations line in a log (a `gh run view --log` prefixes each line with the job,
    the step and a time stamp)."""
    found = []
    for line in text.splitlines():
        start = line.find('{"kind": "' + DURATIONS_KIND + '"')
        if start >= 0:
            found.append(json.loads(line[start:].strip()))
    return found


def merged_durations(
    known: Mapping[str, float], lines: Sequence[Mapping[str, Any]], root: Path = ROOT
) -> dict[str, float]:
    """The known times with each newly measured one in its place; an entry whose file is
    gone is dropped."""
    merged = dict(known)
    for line in lines:
        for entry, seconds in line["seconds"].items():
            merged[entry] = round(float(seconds), 1)
    return {
        entry: merged[entry]
        for entry in sorted(merged)
        if (root / entry.split("::", 1)[0]).is_file()
    }


def _kill_tree(process: subprocess.Popen[bytes]) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True, check=False
        )
    else:
        import signal

        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def missing_targets(targets: Sequence[str], cwd: Path) -> list[str]:
    return [t for t in targets if not (cwd / t.split("::", 1)[0]).exists()]


@dataclass(frozen=True)
class RunOptions:
    workers: int = DEFAULT_WORKERS
    timeout: float = DEFAULT_TIMEOUT  # seconds for the whole run, then it is stopped
    test_timeout: int = DEFAULT_TEST_TIMEOUT  # seconds before a test's stacks are dumped
    cwd: Path = ROOT
    env: dict[str, str] | None = None


DEFAULTS = RunOptions()


def run_pytest(targets: Sequence[str], label: str, options: RunOptions = DEFAULTS) -> Report:
    """One pytest invocation, its output in a log and its results in JUnit XML, in
    test-results/<label>/."""
    workers, test_timeout, cwd = options.workers, options.test_timeout, options.cwd
    folder = RESULTS / label
    folder.mkdir(parents=True, exist_ok=True)
    junit, log = folder / "junit.xml", folder / "pytest.log"
    junit.unlink(missing_ok=True)
    command = [
        sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
        "-n", str(workers), "--dist", "loadfile", "--durations=15", "--tb=short", "-rfE",
        f"--junitxml={junit}", "-o", f"faulthandler_timeout={test_timeout}",
        *targets,
    ]  # fmt: skip
    report = Report(label=label, log=log)
    started = time.monotonic()
    with open(log, "wb") as output:
        output.write(("$ " + " ".join(command[1:]) + "\n").encode())
        output.flush()
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=options.env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=sys.platform != "win32",
        )
        try:
            report.exit_code = process.wait(timeout=options.timeout)
        except subprocess.TimeoutExpired:
            _kill_tree(process)
            report.timed_out = True
            report.exit_code = 124
    report.seconds = time.monotonic() - started
    if junit.exists() and not report.timed_out:
        report.junit = junit
        report.cases = read_junit(junit, cwd)
    with contextlib.suppress(OSError):
        text = log.read_text(encoding="utf-8", errors="replace")
        report.log_tail = [line for line in text.splitlines() if line.strip()][-8:]
    return report


def run_with_environment_rerun(
    targets: Sequence[str], label: str, rerun: bool, options: RunOptions = DEFAULTS
) -> Report:
    """A run whose environment errors are run once more, alone and serially. They stay on
    the record: a cleared one is counted on its own line, a failed one is a failure."""
    report = run_pytest(targets, label, options)
    environment = [case.nodeid for case in report.environment]
    if not environment:
        return report
    if not rerun:
        report.rerun_skipped = "on CI every failure counts" if os.environ.get("CI") else "off"
        return report
    if len(environment) > MAX_ENV_RERUN:
        report.rerun_skipped = f"over {MAX_ENV_RERUN}; the run is not valid, run it again"
        return report
    again = run_pytest(environment, f"{label}-rerun", replace(options, workers=0))
    found = {case.nodeid: case for case in again.cases}
    for nodeid in environment:
        report.rerun[nodeid] = found.get(nodeid, Case(nodeid, "error", "not run on the rerun"))
    report.seconds += again.seconds
    return report


def environment_rerun_allowed(requested: bool) -> bool:
    """On CI every failure counts: an environment error there is never rerun."""
    return requested and not os.environ.get("CI")


def commit_label(cwd: Path = ROOT) -> str:
    head = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=cwd, capture_output=True, text=True
    ).stdout.strip()
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=cwd, capture_output=True, text=True
    ).stdout.strip()
    return f"commit {head}" + (" + uncommitted changes" if dirty else "") if head else ""


def emit(lines: Sequence[str], folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "summary.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


def report_exit(report: Report) -> int:
    if report.timed_out:
        return 124
    if report.junit is None or not report.cases:
        return 2
    return 0 if report.passed else 1


def command_pytest(args: argparse.Namespace) -> int:
    targets = list(args.targets)
    if args.shard:
        index, _, count = args.shard.partition("/")
        targets = shard(targets, int(index), int(count))
    if not targets:
        print("No test targets given.")
        return 2
    missing = missing_targets(targets, ROOT)
    if missing:
        print(f"These targets do not exist (pytest would collect nothing): {missing[:5]}")
        return 2
    if args.list:
        print("\n".join(targets))
        return 0
    options = RunOptions(args.workers, args.timeout, args.test_timeout)
    rerun = environment_rerun_allowed(args.env_rerun)
    with lock_unless(args.no_lock, args.label):
        report = run_with_environment_rerun(targets, args.label, rerun, options)
    commit = commit_label()
    emit(summarize(report, commit), RESULTS / args.label)
    (RESULTS / args.label / "durations.json").write_text(
        durations_line(report, targets, commit) + "\n", encoding="utf-8"
    )
    return report_exit(report)


def command_durations(args: argparse.Namespace) -> int:
    """make test-durations: DURATIONS_FILE updated from the durations lines of CI logs."""
    lines = [line for log in args.logs for line in read_durations_lines(log.read_text("utf-8"))]
    if not lines:
        print(f"No durations line in {', '.join(str(log) for log in args.logs)}.")
        return 2
    merged = merged_durations(load_durations(ROOT), lines, ROOT)
    commits = sorted({str(line.get("commit", "")) for line in lines} - {""})
    body = {"source": f"CI parts {', '.join(commits) or 'of an unknown commit'}", "seconds": merged}
    (ROOT / DURATIONS_FILE).write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    measured = sum(len(line["seconds"]) for line in lines)
    print(
        f"{DURATIONS_FILE}: {measured} measured entries from {len(lines)} parts; "
        f"{len(merged)} kept."
    )
    return 0


def lock_unless(skip: bool, label: str) -> contextlib.AbstractContextManager[None]:
    return contextlib.nullcontext() if skip else machine_lock(label)


# ---------------------------------------------------------------------------------------
# make check-changed


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def _tool(name: str) -> str:
    found = shutil.which(name)
    if found is None:
        raise FileNotFoundError(f"{name} is not on PATH")
    return found


def run_check(name: str, command: Sequence[str], log: TextIO) -> Check:
    log.write(f"\n$ {' '.join(command)}\n")
    done = subprocess.run(command, cwd=ROOT, capture_output=True, check=False, **TEXT)
    output = (done.stdout or "") + (done.stderr or "")
    log.write(output)
    if done.returncode == 0:
        return Check(name, True)
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    marked = re.compile(r"error|\berr\b|would reformat|\u00d7|\u2716", re.IGNORECASE)
    errors = [line for line in lines if marked.search(line)]
    return Check(name, False, first_line((errors or lines or ["failed"])[0], 100))


def lint_commands(files: Sequence[str]) -> list[tuple[str, list[str]]]:
    """The commands make lint and make typecheck run, for the changed files only (for their
    whole scope, as make lint does, when the list would be too long for a command line)."""
    present = [f for f in files if (ROOT / f).is_file()]
    python = [f for f in present if f.endswith(".py") and f.startswith(("tests/", "services/api/"))]
    biome = [
        f for f in present if f.endswith((".ts", ".tsx")) and f.startswith(("tests/", "apps/web/"))
    ]
    if len(python) > MAX_LISTED:
        python = ["tests", "services/api"]
    if len(biome) > MAX_LISTED:
        biome = ["."]
    web_ts = any(f.startswith("apps/web/") and f.endswith((".ts", ".tsx")) for f in present)
    root_ts = any(f.startswith("tests/") and f.endswith(".ts") for f in present)
    commands: list[tuple[str, list[str]]] = []
    if python:
        commands.append(
            ("ruff format", [sys.executable, "-m", "ruff", "format", "--check", *python])
        )
        commands.append(("ruff check", [sys.executable, "-m", "ruff", "check", *python]))
        whole = python == ["tests", "services/api"]
        commands.append(("mypy", [sys.executable, "-m", "mypy", *([] if whole else python)]))
    if biome:
        commands.append(("biome", [_tool("pnpm"), "exec", "biome", "check", *biome]))
    if root_ts:
        commands.append(
            ("tsc", [_tool("pnpm"), "exec", "tsc", "--noEmit", "--incremental", "false"])
        )
    if web_ts:
        commands.append(
            (
                "tsc web",
                [_tool("pnpm"), "exec", "tsc", "-p", "apps/web/tsconfig.json", "--noEmit",
                 "--incremental", "false"],
            )
        )  # fmt: skip
    return commands


def run_node(tests: Sequence[str], log: Path) -> Check:
    if not tests:
        return Check("node", True, "no tests selected")
    # Node expands the pattern itself when the list would be too long for a command line.
    listed = list(tests) if len(tests) <= MAX_LISTED else ["tests/*.test.ts"]
    command = [_tool("node"), "--test", "--test-reporter=tap", *listed]
    done = subprocess.run(command, cwd=ROOT, capture_output=True, check=False, **TEXT)
    output = (done.stdout or "") + (done.stderr or "")
    log.write_text(output, encoding="utf-8")
    passed = re.search(r"^# pass (\d+)", output, re.M)
    failed = re.search(r"^# fail (\d+)", output, re.M)
    counts = (
        f"{passed.group(1) if passed else '?'} passed, {failed.group(1) if failed else '?'} failed"
    )
    if done.returncode == 0:
        return Check("node", True, counts)
    names = re.findall(r"^\s*not ok \d+ - (.+)$", output, re.M)
    return Check("node", False, counts + (f"; first: {first_line(names[0], 70)}" if names else ""))


def command_changed(args: argparse.Namespace) -> int:
    sys.path.insert(0, str(ROOT / "scripts"))
    import changed_tests

    base = args.base or default_base()
    git("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}")  # raises if it does not resolve
    files = changed_tests.changed_files(base)
    py_tests, node_tests = changed_tests.select(files)
    python = sorted(test.relative_to(ROOT).as_posix() for test in py_tests)
    node = sorted(test.relative_to(ROOT).as_posix() for test in node_tests)
    folder = RESULTS / "changed"
    folder.mkdir(parents=True, exist_ok=True)
    if args.list:
        print(f"{len(files)} changed files -> {len(python)} Python, {len(node)} Node test files")
        print("\n".join(python + node))
        return 0
    checks: list[Check] = []
    with open(folder / "lint.log", "w", encoding="utf-8") as log:
        for name, command in lint_commands(files):
            checks.append(run_check(name, command, log))
    checks.append(run_node(node, folder / "node.log"))
    lines = [f"check-changed: {len(files)} changed files | {commit_label()}"]
    ran = [c for c in checks if c.name != "node"]
    lint_line = " | ".join(f"{c.name} {'ok' if c.ok else 'FAILED'}" for c in ran) or "none"
    lines.append(f"Lint and types: {lint_line}")
    lines.extend(f"  {c.name}: {c.detail}" for c in ran if not c.ok)
    node_check = checks[-1]
    lines.append(
        f"Node ({len(node)} files): {'ok' if node_check.ok else 'FAILED'} | {node_check.detail}"
    )
    status = 0 if all(c.ok for c in checks) else 1
    if python:
        with lock_unless(args.no_lock, "changed"):
            rerun = environment_rerun_allowed(args.env_rerun)
            report = run_with_environment_rerun(
                python, "changed", rerun, RunOptions(workers=args.workers)
            )
        lines.extend(summarize(report, limit=SUMMARY_LINES - len(lines) - 1))
        status = status or report_exit(report)
    else:
        lines.append("Python: no test files selected")
    lines.append(
        "Selection is one level deep (scripts/changed_tests.py); CI runs the critical tier"
    )
    emit(lines[:SUMMARY_LINES], folder)
    return status


# ---------------------------------------------------------------------------------------
# make prove


def git(*args: str, cwd: Path = ROOT, stdin: bytes | None = None) -> bytes:
    done = subprocess.run(["git", *args], cwd=cwd, input=stdin, capture_output=True, check=False)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {done.stderr.decode(errors='replace').strip()}")
    return done.stdout


def default_base(cwd: Path = ROOT) -> str:
    # origin/main first: a local main that lags behind it would widen what is taken out.
    for ref in ("origin/main", "main"):
        with contextlib.suppress(RuntimeError):
            return git("merge-base", "HEAD", ref, cwd=cwd).decode().strip()
    raise RuntimeError("no merge base with main; pass BASE=<ref>")


def copy_current_tree(tree: Path, cwd: Path = ROOT) -> None:
    """Make `tree` (a fresh worktree at HEAD) equal to the current working tree: every
    uncommitted change to a tracked file, and every untracked file that is not ignored."""
    diff = git("diff", "--binary", "HEAD", cwd=cwd)
    if diff.strip():
        git("apply", "--binary", "--whitespace=nowarn", "-", cwd=tree, stdin=diff)
    untracked = git("ls-files", "--others", "--exclude-standard", "-z", cwd=cwd).decode()
    for name in filter(None, untracked.split("\0")):
        target = tree / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cwd / name, target)


def take_out_fix(
    tree: Path, base: str, files: Sequence[str], patch: Path | None, cwd: Path = ROOT
) -> None:
    """Reverse the fix in `tree`: each named file back to its content at `base` (the same as
    applying `git diff <base> -- <file>` in reverse; a file new since the base is removed),
    or the given patch applied in reverse."""
    if patch is not None:
        git("apply", "-R", "--whitespace=nowarn", str(patch.resolve()), cwd=tree)
    for name in files:
        target = tree / name
        try:
            content = git("show", f"{base}:{name}", cwd=cwd)
        except RuntimeError:
            target.unlink(missing_ok=True)
            continue
        target.write_bytes(content)


def changed_since(base: str, cwd: Path = ROOT) -> set[str]:
    names = git("diff", "--name-only", base, cwd=cwd).decode().split()
    names += git("ls-files", "--others", "--exclude-standard", cwd=cwd).decode().split()
    return set(names)


@dataclass
class Proof:
    verdict: str  # PROVED, NOT PROVED, INCONCLUSIVE
    reason: str
    with_fix: Report | None = None
    without_fix: Report | None = None

    @property
    def exit_code(self) -> int:
        return {"PROVED": 0, "NOT PROVED": 1}.get(self.verdict, 2)


NOT_RUN_WITHOUT = "the test passes with the fix and was not run without it"


def judge(test: str, with_fix: Report, without_fix: Report | None) -> Proof:
    """PROVED only when the test passes with the fix and fails without it on an assertion,
    not on the revert breaking an import or a name."""

    def outcome(report: Report) -> Case | None:
        cases = [c for c in report.cases if c.nodeid == test or c.nodeid.startswith(test + "[")]
        if not cases:
            return None
        bad = [c for c in cases if c.outcome in ("failed", "error")]
        return bad[0] if bad else cases[0]

    first = outcome(with_fix)
    if first is not None and first.environment:
        return Proof(
            "INCONCLUSIVE",
            f"an environment error with the fix in place ({first.environment}); run it again",
            with_fix,
            without_fix,
        )
    if first is None:
        return Proof(
            "INCONCLUSIVE", "the test did not run with the fix in place", with_fix, without_fix
        )
    if first.outcome == "skipped":
        return Proof(
            "INCONCLUSIVE",
            f"the test was skipped: {first_line(first.message)}",
            with_fix,
            without_fix,
        )
    if first.outcome != "passed":
        return Proof(
            "NOT PROVED",
            f"the test fails with the fix: {first_line(first.message)}",
            with_fix,
            without_fix,
        )
    if without_fix is None:
        return Proof("INCONCLUSIVE", NOT_RUN_WITHOUT, with_fix, without_fix)
    second = outcome(without_fix)
    if second is not None and second.environment:
        return Proof(
            "INCONCLUSIVE",
            f"without the fix the test hit an environment error ({second.environment}), "
            "not the rule; run it again",
            with_fix,
            without_fix,
        )
    if second is None:
        return Proof(
            "INCONCLUSIVE",
            "without the fix the test was not collected (see the log); "
            "take out only the fix's lines with PATCH=<file>",
            with_fix,
            without_fix,
        )
    if second.outcome in ("passed", "skipped"):
        return Proof(
            "NOT PROVED", f"the test {second.outcome} without the fix", with_fix, without_fix
        )
    error = first_line(second.message)
    if second.outcome == "error" or any(name in error for name in NOT_A_PROOF):
        return Proof(
            "INCONCLUSIVE",
            f"without the fix it fails for another reason ({error}); "
            "revert only the fix's lines with PATCH=<file>",
            with_fix,
            without_fix,
        )
    return Proof("PROVED", f"fails without the fix: {error}", with_fix, without_fix)


def command_prove(args: argparse.Namespace) -> int:
    test: str = args.test
    if "::" not in test or not (ROOT / test.split("::", 1)[0]).is_file():
        print(f"TEST must be a pytest node id of an existing file (file.py::test_name): {test}")
        return 2
    if not args.files and args.patch is None:
        print("Name the fix: FILES='<source files>' or PATCH=<patch of the fix>")
        return 2
    base = args.base or default_base()
    files = [Path(f).as_posix() for f in args.files]
    test_file = test.split("::", 1)[0]
    if test_file in files:
        print(f"{test_file} holds the test; name the source files of the fix only")
        return 2
    unchanged = sorted(set(files) - changed_since(base))
    if unchanged:
        print(f"No change since {base[:10]} in {unchanged}: nothing to take out")
        return 2
    label = "prove"
    holder = Path(tempfile.mkdtemp(prefix="ai-workforce-prove-"))
    tree = holder / "tree"
    try:
        with lock_unless(args.no_lock, label):
            git("worktree", "add", "--detach", "--quiet", str(tree), "HEAD")
            copy_current_tree(tree)
            env = {**os.environ, "PYTHONPATH": os.pathsep.join(
                [str(tree / "services" / "api"), os.environ.get("PYTHONPATH", "")]
            ).rstrip(os.pathsep)}  # fmt: skip
            where = subprocess.run(
                [sys.executable, "-c", "import ai_workforce_api; print(ai_workforce_api.__file__)"],
                cwd=tree, env=env, capture_output=True, text=True, check=False,
            ).stdout.strip()  # fmt: skip
            if not Path(where).resolve().is_relative_to(tree.resolve()):
                print(f"The copy would import the application from {where}, not the copy; stopped")
                return 2
            options = RunOptions(workers=0, timeout=args.timeout, cwd=tree, env=env)
            with_fix = run_pytest([test], "prove-with-fix", options)
            without_fix: Report | None = None
            if judge(test, with_fix, None).reason == NOT_RUN_WITHOUT:
                take_out_fix(tree, base, files, args.patch)
                without_fix = run_pytest([test], "prove-without-fix", options)
            proof = judge(test, with_fix, without_fix)
    finally:
        with contextlib.suppress(RuntimeError):
            git("worktree", "remove", "--force", str(tree))
        shutil.rmtree(holder, ignore_errors=True)
        with contextlib.suppress(RuntimeError):
            git("worktree", "prune")
    reverted = ", ".join([*files, *([f"{args.patch} reversed"] if args.patch else [])])
    lines = [
        f"{proof.verdict}: {test}",
        f"  {proof.reason}",
        f"  fix taken out: {reverted or '-'} (base {base[:10]}) | {commit_label()}",
        f"  with the fix: {_shown(with_fix.log)}"
        + (f" | without: {_shown(without_fix.log)}" if without_fix else ""),
    ]
    emit(lines, RESULTS / label)
    return proof.exit_code


# ---------------------------------------------------------------------------------------


def parser() -> argparse.ArgumentParser:
    main = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = main.add_subparsers(dest="command", required=True)

    def shared(command: argparse.ArgumentParser) -> None:
        command.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
        command.add_argument("--no-lock", action="store_true", help="skip the machine lock")
        command.add_argument(
            "--no-env-rerun",
            dest="env_rerun",
            action="store_false",
            help="count environment errors as failures without rerunning them",
        )

    run = sub.add_parser("pytest", help="run pytest targets")
    shared(run)
    run.add_argument("--label", default="run", help="folder name under test-results/")
    run.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help="seconds, whole run")
    run.add_argument(
        "--test-timeout", type=int, default=DEFAULT_TEST_TIMEOUT, help="seconds before a stack dump"
    )
    run.add_argument("--shard", help="K/N: run part K of N of the targets")
    run.add_argument("--list", action="store_true", help="print the targets, do not run")
    run.add_argument("targets", nargs="*")

    changed = sub.add_parser("changed", help="make check-changed")
    shared(changed)
    changed.add_argument("--base", help="git ref to diff against (default: merge base with main)")
    changed.add_argument("--list", action="store_true", help="print the selection, do not run")

    prove = sub.add_parser("prove", help="make prove")
    prove.add_argument("--test", required=True, help="pytest node id of the new safeguard test")
    prove.add_argument("--base", help="git ref the fix is measured from (default: merge base)")
    prove.add_argument("--patch", type=Path, help="a patch of the fix, reversed instead of files")
    prove.add_argument("--timeout", type=float, default=15 * 60)
    prove.add_argument("--no-lock", action="store_true")
    prove.add_argument("files", nargs="*", help="source files of the fix, restored to the base")

    durations = sub.add_parser("durations", help=f"update {DURATIONS_FILE} from CI logs")
    durations.add_argument("logs", nargs="+", type=Path, help="`gh run view <id> --log` output")
    return main


def main(argv: Sequence[str] | None = None) -> int:
    # A Windows console's code page cannot print every character a test name or an error
    # can hold; the summary is never lost to that.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(errors="replace")
    args = parser().parse_args(argv)
    try:
        if args.command == "pytest":
            return command_pytest(args)
        if args.command == "changed":
            return command_changed(args)
        if args.command == "durations":
            return command_durations(args)
        return command_prove(args)
    except (LockTimeout, RuntimeError) as error:
        # A lock held too long, or a git ref that does not resolve: said, never a pass.
        print(f"Stopped: {error}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
