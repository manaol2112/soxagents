"""scripts/run_tests.py, the runner behind make check-changed, make prove and the CI parts.
No database is used.

Testing assessment, 19 November 2026 (step 2): agents read the runner's summary instead of
supervising pytest. So the summary must never call a failing run green, never hide an
environment error, stay within 20 lines, and a proof must not pass when the test fails only
because the revert broke an import.
"""

import importlib.util
import subprocess
import sys
import textwrap
import threading
from html import escape
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("run_tests", ROOT / "scripts" / "run_tests.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_tests"] = module
    spec.loader.exec_module(module)
    return module


rt = _runner()

PORT = (
    'psycopg.OperationalError: connection failed: connection to server at "127.0.0.1", '
    "port 5432 failed: Address already in use (0x00002740/10048)"
)


def _case(nodeid: str, outcome: str, message: str = "") -> Any:
    return rt.Case(nodeid, outcome, message, 0.1, rt.classify_environment(message))


def _report(*cases: Any, exit_code: int = 1) -> Any:
    return rt.Report(
        label="t", cases=list(cases), exit_code=exit_code, junit=Path("j.xml"), log=Path("l")
    )


def test_environment_errors_are_told_from_product_failures() -> None:
    assert rt.classify_environment(PORT) == "10048"
    status = (
        "E   assert 503 == 200\n"
        "E    +  where 503 = <Response [503 Service Unavailable]>.status_code"
    )
    assert rt.classify_environment(status) == "503"
    assert rt.classify_environment("<Response [503 Service Unavailable]>") == "503"
    assert rt.classify_environment("E   AssertionError: status_code == 503") == "503"
    assert (
        rt.classify_environment(
            "psycopg.OperationalError: connection failed: FATAL: sorry, too many clients already"
        )
        == "connect"
    )
    # A product failure, a traceback line number 503 and a count of 503 are not the
    # environment: the 503 rule needs the status context (review, 19 November 2026).
    assert rt.classify_environment("E   assert 503 == 200\nE    +  where 503 = len(rows)") == ""
    assert rt.classify_environment("E   assert len(rows) == 503") == ""
    assert rt.classify_environment("E   AssertionError: assert 'PASS' == 'FAIL'") == ""
    assert rt.classify_environment("services/api/x.py:503: in approve\n    raise") == ""
    assert rt.classify_environment("psycopg.errors.UniqueViolation: duplicate key") == ""


def test_a_junit_report_reads_as_node_ids_and_outcomes(tmp_path: Path) -> None:
    (tmp_path / "pkg" / "tests").mkdir(parents=True)
    (tmp_path / "pkg" / "tests" / "test_x.py").write_text("", encoding="utf-8")
    junit = tmp_path / "junit.xml"
    junit.write_text(
        textwrap.dedent(f"""\
        <?xml version="1.0" encoding="utf-8"?>
        <testsuites><testsuite name="pytest">
          <testcase classname="pkg.tests.test_x" name="test_ok" time="0.5" />
          <testcase classname="pkg.tests.test_x.TestGroup" name="test_case[a-1]" time="1">
            <failure message="AssertionError: assert 1 == 2"
              >E   AssertionError: assert 1 == 2</failure>
          </testcase>
          <testcase classname="pkg.tests.test_x" name="test_db" time="2">
            <error message="failed on setup with {escape(PORT)}">trace</error>
          </testcase>
          <testcase classname="pkg.tests.test_x" name="test_skip" time="0">
            <skipped message="DATABASE_URL is not set" />
          </testcase>
          <testcase classname="" name="pkg.tests.test_x">
            <error message="collection failure">E   AssertionError: no list</error>
          </testcase>
        </testsuite></testsuites>
        """),
        encoding="utf-8",
    )
    cases = rt.read_junit(junit, tmp_path)
    assert [(c.nodeid, c.outcome, c.environment) for c in cases] == [
        ("pkg/tests/test_x.py::test_ok", "passed", ""),
        ("pkg/tests/test_x.py::TestGroup::test_case[a-1]", "failed", ""),
        ("pkg/tests/test_x.py::test_db", "error", "10048"),
        ("pkg/tests/test_x.py::test_skip", "skipped", ""),
        ("pkg/tests/test_x.py", "error", ""),  # a module that did not collect
    ]
    assert rt.first_line(cases[1].message) == "AssertionError: assert 1 == 2"


def test_only_an_environment_error_cleared_alone_leaves_the_run_green() -> None:
    cleared = _report(_case("a::t1", "passed"), _case("a::t2", "error", PORT))
    cleared.rerun = {"a::t2": _case("a::t2", "passed")}
    assert cleared.passed and cleared.failures == []

    again = _report(_case("a::t2", "error", PORT))
    again.rerun = {"a::t2": _case("a::t2", "failed", "E   AssertionError: still")}
    assert not again.passed
    assert [c.message for c in again.failures] == ["E   AssertionError: still"]

    not_rerun = _report(_case("a::t2", "error", PORT))
    assert not not_rerun.passed, "an environment error not rerun is still a failure"

    skipped = _report(_case("a::t2", "error", PORT))
    skipped.rerun = {"a::t2": _case("a::t2", "skipped", "DATABASE_URL is not set")}
    assert not skipped.passed, "only a pass on the rerun clears an environment error"

    product = _report(_case("a::t3", "failed", "E   AssertionError: x"))
    product.rerun = {"a::t3": _case("a::t3", "passed")}
    assert not product.passed, "a product failure is never cleared by a rerun"


def test_a_run_without_a_report_or_with_a_usage_error_is_never_green() -> None:
    assert not _report(_case("a::t", "passed"), exit_code=2).passed
    timed_out = _report(_case("a::t", "passed"), exit_code=124)
    timed_out.timed_out = True
    assert not timed_out.passed
    assert not rt.Report(label="t", exit_code=0).passed
    # pytest said it failed, but the JUnit XML holds no failure: never read as a pass.
    assert not _report(_case("a::t", "passed"), exit_code=1).passed


def test_ci_never_reruns_an_environment_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CI", "true")
    assert rt.environment_rerun_allowed(True) is False
    monkeypatch.delenv("CI")
    assert rt.environment_rerun_allowed(True) is True
    assert rt.environment_rerun_allowed(False) is False


def test_a_base_that_does_not_resolve_stops_check_changed() -> None:
    # No silent narrowing: an unknown BASE used to select from nothing and pass.
    assert rt.main(["changed", "--base", "no-such-ref-19-nov", "--list"]) == 2


def test_the_summary_stays_within_twenty_lines_and_names_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    failures = [_case(f"f.py::test_{n}", "failed", "E   AssertionError: no") for n in range(60)]
    report = _report(*failures, _case("f.py::env", "error", PORT), _case("f.py::ok", "passed"))
    report.rerun_skipped = "off"
    lines = rt.summarize(report, "commit abc")
    assert len(lines) <= rt.SUMMARY_LINES
    assert lines[0].startswith("t: FAILED | 1 passed, 60 failed, 1 error")
    assert lines[1] == "Environment errors: 1 (10048 x1); not rerun (off)"
    assert "DATABASE_URL is not set: the database tests were skipped" in lines
    assert any(line.startswith("Failing (61):") for line in lines)
    assert any("more in the JUnit XML" in line for line in lines)
    assert lines[-1].startswith("Log: ")
    assert all(line.isascii() for line in lines[:2])


def test_a_cleared_environment_error_is_reported_not_hidden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://example/x")
    report = _report(_case("f.py::ok", "passed"), _case("f.py::env", "error", PORT))
    report.rerun = {"f.py::env": _case("f.py::env", "passed")}
    lines = rt.summarize(report)
    assert lines[0].startswith("t: PASSED | 1 passed, 1 error | ")
    assert lines[1] == "Environment errors: 1 (10048 x1); rerun alone: 1 passed, 0 failed"


def test_the_runner_runs_reruns_an_environment_error_alone_and_times_out(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rt, "RESULTS", tmp_path / "results")
    flag = tmp_path / "second-attempt"
    (tmp_path / "test_sample.py").write_text(
        textwrap.dedent(f"""\
        from pathlib import Path
        import time

        def test_passes():
            assert True

        def test_fails():
            assert "PASS" == "FAIL"

        def test_port_once():
            flag = Path({str(flag)!r})
            if not flag.exists():
                flag.write_text("x")
                raise OSError({PORT!r})

        def test_hangs():
            time.sleep(60)
        """),
        encoding="utf-8",
    )
    options = rt.RunOptions(workers=0, timeout=60, cwd=tmp_path)
    targets = ["test_sample.py::test_passes", "test_sample.py::test_fails"]
    report = rt.run_with_environment_rerun(
        [*targets, "test_sample.py::test_port_once"], "sample", True, options
    )
    assert [(c.nodeid, c.outcome) for c in report.cases] == [
        ("test_sample.py::test_passes", "passed"),
        ("test_sample.py::test_fails", "failed"),
        ("test_sample.py::test_port_once", "failed"),
    ]
    assert report.cases[2].environment == "10048"
    assert report.rerun["test_sample.py::test_port_once"].outcome == "passed"
    assert [c.nodeid for c in report.failures] == ["test_sample.py::test_fails"]
    assert rt.report_exit(report) == 1
    assert (tmp_path / "results" / "sample" / "junit.xml").is_file()

    hung = rt.run_pytest(
        ["test_sample.py::test_hangs"],
        "hung",
        rt.RunOptions(workers=0, timeout=8, test_timeout=4, cwd=tmp_path),
    )
    assert hung.timed_out and rt.report_exit(hung) == 124
    assert rt.summarize(hung)[0].startswith("hung: TIMED OUT")


def test_a_second_run_waits_for_the_lock_and_says_whose_it_is(tmp_path: Path) -> None:
    path = tmp_path / "tests.lock"
    said: list[str] = []
    with rt.machine_lock("first run", path=path):
        outcome: list[str] = []

        def second() -> None:
            try:
                with rt.machine_lock("second", path=path, wait_seconds=0.5, poll_seconds=0.1,
                                     say=said.append):  # fmt: skip
                    outcome.append("got it")
            except rt.LockTimeout:
                outcome.append("timed out")

        thread = threading.Thread(target=second)
        thread.start()
        thread.join()
        assert outcome == ["timed out"]
    assert len(said) == 1 and said[0].startswith("Waiting for first run (pid ")
    with rt.machine_lock("after", path=path, wait_seconds=0.5):
        pass


def test_the_parts_cover_every_entry_once_and_balance_by_size(tmp_path: Path) -> None:
    for n, size in enumerate([900, 500, 400, 300, 100, 100]):
        (tmp_path / f"test_{n}.py").write_text("def test_a(): pass\n" + "#" * size, "utf-8")
    entries = [f"test_{n}.py" for n in range(6)] + ["test_0.py::test_a"]
    parts = [rt.shard(entries, k, 3, tmp_path) for k in (1, 2, 3)]
    assert sorted(e for part in parts for e in part) == sorted(entries)
    # Each file here holds one test, so a picked test weighs as much as its file.
    sizes = {e: (tmp_path / e.split("::", 1)[0]).stat().st_size for e in entries}
    loads = [sum(sizes[e] for e in part) for part in parts]
    assert max(loads) - min(loads) <= max(sizes.values())
    with pytest.raises(ValueError):
        rt.shard(entries, 4, 3, tmp_path)
    with pytest.raises(ValueError):
        rt.shard(["test_0.py", "test_0.py"], 1, 2, tmp_path)


def test_the_parts_balance_by_measured_time_and_an_untimed_file_still_runs(
    tmp_path: Path,
) -> None:
    # 19 November 2026: split by size, the four CI parts took 357 to 716 seconds. The largest
    # file need not be the slowest; the measured times decide, and a file with no time yet
    # (new since the times were taken) weighs its size at the timed files' seconds per byte.
    for n, size in enumerate([900, 100, 100, 100]):
        (tmp_path / f"test_{n}.py").write_text("def test_a(): pass\n" + "#" * size, "utf-8")
    entries = [f"test_{n}.py" for n in range(4)]
    by_time = {"test_0.py": 1.0, "test_1.py": 3.0, "test_2.py": 2.9}
    parts = [rt.shard(entries, k, 2, tmp_path, by_time) for k in (1, 2)]
    assert sorted(e for part in parts for e in part) == sorted(entries)
    # test_3.py, untimed, weighs about 0.7 s here; at its raw 119 bytes it would fill a part
    # on its own.
    assert sorted(parts[0]) == ["test_1.py", "test_3.py"]
    assert sorted(parts[1]) == ["test_0.py", "test_2.py"]
    # With no times at all, the split is the size split it always was.
    assert rt.shard(entries, 1, 2, tmp_path, {}) == rt.shard(entries, 1, 2, tmp_path)
    assert rt.shard(entries, 1, 2, tmp_path) == ["test_0.py"]


def test_the_durations_file_is_read_and_a_malformed_one_stops_the_split(tmp_path: Path) -> None:
    assert rt.load_durations(tmp_path) == {}
    (tmp_path / "test_0.py").write_text("def test_a(): pass\n", "utf-8")
    path = tmp_path / rt.DURATIONS_FILE
    path.parent.mkdir(parents=True)
    path.write_text('{"source": "CI", "seconds": {"test_0.py": 12.5}}', "utf-8")
    assert rt.load_durations(tmp_path) == {"test_0.py": 12.5}
    assert rt.shard(["test_0.py"], 1, 1, tmp_path) == ["test_0.py"]
    for bad in ('{"test_0.py": 12.5}', '{"seconds": {"test_0.py": "slow"}}', "[]"):
        path.write_text(bad, "utf-8")
        with pytest.raises(ValueError):
            rt.load_durations(tmp_path)


def test_a_run_s_times_go_to_the_log_and_back_into_the_durations_file(tmp_path: Path) -> None:
    (tmp_path / "test_a.py").write_text("def test_x(): pass\n", "utf-8")
    (tmp_path / "test_b.py").write_text("def test_y(): pass\n", "utf-8")
    entries = ["test_a.py", "test_b.py::test_y"]
    cases = [
        rt.Case("test_a.py::test_x[1]", "passed", seconds=2.2),
        rt.Case("test_a.py::TestK::test_z", "failed", seconds=1.0),
        rt.Case("test_b.py::test_y[big]", "passed", seconds=4.0),
        rt.Case("test_c.py::test_q", "passed", seconds=9.0),  # not an entry of this run
    ]
    assert rt.entry_seconds(cases, entries) == {"test_a.py": 3.2, "test_b.py::test_y": 4.0}
    line = rt.durations_line(_report(*cases), entries, "commit abc1234")
    log = f"critical 1 of 4\tDurations of the part\t2026-11-19T18:52:01.5Z {line}\nother\n"
    read = rt.read_durations_lines(log)
    assert read == [
        {
            "kind": "test-durations",
            "label": "t",
            "commit": "commit abc1234",
            "seconds": {"test_a.py": 3.2, "test_b.py::test_y": 4.0},
        }
    ]
    known = {"test_a.py": 1.0, "test_gone.py": 5.0, "test_b.py": 7.0}
    # A measured time replaces the known one; one not measured stays; a gone file is dropped.
    assert rt.merged_durations(known, read, tmp_path) == {
        "test_a.py": 3.2,
        "test_b.py": 7.0,
        "test_b.py::test_y": 4.0,
    }


def _passing(test: str) -> Any:
    return _report(_case(test, "passed"), exit_code=0)


def test_a_proof_needs_a_pass_with_the_fix_and_an_assertion_failure_without() -> None:
    test = "t.py::test_rule"
    failing = _report(_case(test, "failed", "E   AssertionError: assert 'PASS' == 'FAIL'"))
    assert rt.judge(test, _passing(test), failing).verdict == "PROVED"
    assert rt.judge(test, _passing(test), _passing(test)).verdict == "NOT PROVED"
    assert rt.judge(test, failing, None).verdict == "NOT PROVED"
    assert rt.judge(test, _passing(test), None).reason == rt.NOT_RUN_WITHOUT
    broken = _report(_case(test, "failed", "E   ImportError: cannot import name 'rule'"))
    assert rt.judge(test, _passing(test), broken).verdict == "INCONCLUSIVE"
    setup = _report(_case(test, "error", "E   fixture 'x' not found"))
    assert rt.judge(test, _passing(test), setup).verdict == "INCONCLUSIVE"
    skipped = _report(_case(test, "skipped", "DATABASE_URL is not set"), exit_code=0)
    assert rt.judge(test, skipped, None).verdict == "INCONCLUSIVE"
    assert rt.judge(test, _report(), None).verdict == "INCONCLUSIVE"
    # A reverted signature breaks the call, not the rule (review, 19 November 2026).
    signature = _report(_case(test, "failed", "E   TypeError: rule() takes 1 argument"))
    assert rt.judge(test, _passing(test), signature).verdict == "INCONCLUSIVE"
    # An environment error in either run is never a proof, whatever it raised.
    port = _report(_case(test, "failed", f"E   AssertionError: setup\n{PORT}"))
    assert port.cases[0].environment == "10048"
    assert rt.judge(test, _passing(test), port).verdict == "INCONCLUSIVE"
    assert rt.judge(test, port, None).verdict == "INCONCLUSIVE"


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=repo,
        check=True,
        capture_output=True,
    )


def test_the_copy_is_the_current_tree_and_only_the_fix_is_taken_out(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    (repo / "rule.py").write_text("LIMIT = 1\n", encoding="utf-8")
    (repo / "other.py").write_text("A = 1\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "base")
    base = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout.strip()
    (repo / "rule.py").write_text("LIMIT = 2\n", encoding="utf-8")
    _git(repo, "commit", "-q", "-am", "the fix, committed")
    (repo / "rule.py").write_text("LIMIT = 3\n", encoding="utf-8")  # and changed again
    (repo / "other.py").write_text("A = 2\n", encoding="utf-8")  # an unrelated change
    (repo / "helper.py").write_text("NEW = True\n", encoding="utf-8")  # untracked

    tree = tmp_path / "tree"
    rt.git("worktree", "add", "--detach", "--quiet", str(tree), "HEAD", cwd=repo)
    try:
        rt.copy_current_tree(tree, cwd=repo)
        for name in ("rule.py", "other.py", "helper.py"):
            assert (tree / name).read_text() == (repo / name).read_text(), name
        assert rt.changed_since(base, cwd=repo) == {"rule.py", "other.py", "helper.py"}
        rt.take_out_fix(tree, base, ["rule.py", "helper.py"], None, cwd=repo)
        assert (tree / "rule.py").read_text() == "LIMIT = 1\n"
        assert not (tree / "helper.py").exists(), "a file new since the base is removed"
        assert (tree / "other.py").read_text() == "A = 2\n", "nothing else is reverted"
        assert (repo / "rule.py").read_text() == "LIMIT = 3\n", "the worktree is untouched"
    finally:
        rt.git("worktree", "remove", "--force", str(tree), cwd=repo)
