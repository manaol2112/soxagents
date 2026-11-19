"""The CI gate runs every critical test, in parts, and its required check fails when any part
does. No database is used.

Testing assessment, 19 November 2026 (step 3): the critical tier runs on CI in parallel parts
instead of one 26 to 42 minute job. A split that dropped a file, or a matrix that lost a part,
would leave critical tests unrun while CI stayed green; so would a required check that a
failed part skips (GitHub counts a skipped required check as passed).

Independent review of the same day: 26 fast-tier files were in no CI part (CI ran the
critical tier and the Node tests only), so with the local tiers stopped they ran in no
routine gate. The fast-only part runs FAST_PY minus CRITICAL_PY, and every file of either
list runs in exactly one CI part.
"""

import importlib.util
import random
import re
import sys
from pathlib import Path
from types import ModuleType

from test_test_tiers import make_words

ROOT = Path(__file__).resolve().parents[3]
MAKEFILE = (ROOT / "Makefile").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")


def _runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("run_tests", ROOT / "scripts" / "run_tests.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["run_tests"] = module
    spec.loader.exec_module(module)
    return module


RUNNER = _runner()


CRITICAL = make_words("CRITICAL_PY")
FAST = make_words("FAST_PY")


def _shards() -> tuple[int, list[int]]:
    parts = re.findall(r"make: test-critical-shard SHARD=(\d+) SHARDS=(\d+)", WORKFLOW)
    counts = {int(count) for _, count in parts}
    assert len(counts) == 1, f"every part names the same number of parts: {sorted(counts)}"
    return counts.pop(), sorted(int(index) for index, _ in parts)


def test_the_critical_list_is_read_whole() -> None:
    assert len(CRITICAL) == len(set(CRITICAL))
    assert len(CRITICAL) > 100
    assert any("::" in entry for entry in CRITICAL), "CRITICAL_PICKED is part of the tier"
    assert all((ROOT / entry.split("::", 1)[0]).is_file() for entry in CRITICAL)


def test_the_matrix_runs_every_part_once() -> None:
    count, indexes = _shards()
    assert count >= 2
    assert indexes == list(range(1, count + 1))


def test_the_parts_together_are_the_critical_tier_exactly() -> None:
    count, _ = _shards()
    parts = [RUNNER.shard(CRITICAL, index, count) for index in range(1, count + 1)]
    joined = [entry for part in parts for entry in part]
    assert sorted(joined) == sorted(CRITICAL), "no critical test is dropped or run twice"
    assert all(part for part in parts), "no part is empty"


def test_the_split_is_deterministic_whatever_the_order() -> None:
    count, _ = _shards()
    shuffled = list(CRITICAL)
    random.Random(19).shuffle(shuffled)
    for index in range(1, count + 1):
        assert set(RUNNER.shard(shuffled, index, count)) == set(
            RUNNER.shard(CRITICAL, index, count)
        )


def test_a_file_missing_from_the_durations_file_is_still_assigned() -> None:
    # The parts are balanced by scripts/test_durations.json (CI's measured times); a
    # critical file added after the times were taken has none and must still run once.
    count, _ = _shards()
    measured = RUNNER.load_durations(ROOT) or {entry: 10.0 for entry in CRITICAL}
    untimed = set(sorted(CRITICAL)[::7])
    times = {entry: seconds for entry, seconds in measured.items() if entry not in untimed}
    parts = [RUNNER.shard(CRITICAL, index, count, ROOT, times) for index in range(1, count + 1)]
    joined = [entry for part in parts for entry in part]
    assert sorted(joined) == sorted(CRITICAL), "an untimed file runs in exactly one part"
    assert all(part for part in parts)


def test_the_shard_target_takes_the_whole_critical_list() -> None:
    recipe = re.search(r"^test-critical-shard: .*\n\t(.*)$", MAKEFILE, re.MULTILINE)
    assert recipe is not None
    assert "--shard $(SHARD)/$(SHARDS) $(CRITICAL_PY)" in recipe.group(1)
    assert "scripts/run_tests.py" in " ".join(make_words("RUN_TESTS"))


def test_ci_runs_lint_types_every_node_test_and_the_web_build() -> None:
    for make in ("lint typecheck", "test-node", "web-build"):
        assert re.search(rf"^\s+make: {make}$", WORKFLOW, re.MULTILINE), make
    assert re.search(r"^web-build:\n\tpnpm --filter web build$", MAKEFILE, re.MULTILINE)
    # The critical tier's Node files are run by test-node, which takes tests/*.test.ts.
    for entry in make_words("CRITICAL_NODE"):
        assert re.fullmatch(r"tests/[\w.-]+\.test\.ts", entry), entry


def test_the_required_check_fails_unless_every_part_succeeded() -> None:
    job = WORKFLOW.split("\n  baseline:\n", 1)
    assert len(job) == 2, "the required check is still the job named baseline"
    baseline = job[1]
    assert re.search(r"^    needs: \[gate\]$", baseline, re.MULTILINE)
    assert re.search(r"^    if: always\(\)$", baseline, re.MULTILINE)
    assert "RESULT: ${{ needs.gate.result }}" in baseline
    assert '[ "$RESULT" != "success" ]' in baseline and "exit 1" in baseline
    assert re.search(r"^      fail-fast: false$", WORKFLOW, re.MULTILINE)


def test_every_job_and_part_has_a_time_limit() -> None:
    jobs = re.findall(r"^  ([\w-]+):\n", WORKFLOW.split("\njobs:\n", 1)[1], re.MULTILINE)
    assert jobs == ["gate", "baseline"]
    assert len(re.findall(r"^    timeout-minutes: ", WORKFLOW, re.MULTILINE)) == len(jobs)
    entries = len(re.findall(r"^          - name: ", WORKFLOW, re.MULTILINE))
    minutes = re.findall(r"^            minutes: (\d+)$", WORKFLOW, re.MULTILINE)
    assert len(minutes) == entries and all(0 < int(m) <= 60 for m in minutes)


def _recipe(target: str) -> str:
    found = re.search(rf"^{target}: .*\n\t(.*)$", MAKEFILE, re.MULTILINE)
    assert found is not None, target
    return found.group(1)


def test_every_fast_or_critical_file_runs_in_exactly_one_ci_part() -> None:
    count, _ = _shards()
    assert re.search(r"^\s+make: test-fast-only$", WORKFLOW, re.MULTILINE)
    assert _recipe("test-fast-only").endswith(" $(filter-out $(CRITICAL_PY),$(FAST_PY))")
    fast_only = [entry for entry in FAST if entry not in CRITICAL]
    parts = [RUNNER.shard(CRITICAL, index, count) for index in range(1, count + 1)]
    parts.append(fast_only)
    runs = [entry for part in parts for entry in part]
    assert len(runs) == len(set(runs)), "no file runs in two parts"
    assert set(runs) == set(FAST) | set(CRITICAL)
    assert fast_only, "the fast tier has files the critical tier does not hold"


def test_a_picked_test_is_not_also_run_with_its_whole_file() -> None:
    # A picked test (CRITICAL_PICKED) is the one safeguard of a file the critical tier does
    # not hold whole; listing the file whole too would hide that the pick is redundant.
    whole = {entry for entry in CRITICAL if "::" not in entry}
    picked = {entry.split("::", 1)[0] for entry in CRITICAL if "::" in entry}
    assert sorted(picked & whole) == []
    # The one known overlap with the fast tier: test_evidence_reading.py runs whole in the
    # fast-only part and its picked test again in a critical part (one test, seconds).
    fast_whole = {entry for entry in FAST if "::" not in entry}
    assert sorted(picked & fast_whole) == ["services/api/tests/test_evidence_reading.py"]


def test_no_part_can_fail_quietly_or_be_skipped_by_a_filter() -> None:
    assert "continue-on-error" not in WORKFLOW
    run_step = WORKFLOW.split("      - name: Run\n", 1)[1].split("\n      - name: ", 1)[0]
    assert "if:" not in run_step, "the Run step runs in every part"
    assert run_step.strip().endswith("run: make $MAKE_ARGS")
    triggers = WORKFLOW.split("\nconcurrency:", 1)[0]
    assert "paths" not in triggers, "every push and pull request runs the gate"
    assert re.search(r"^  pull_request:$", triggers, re.MULTILINE)


def test_a_part_stops_itself_before_the_job_limit_so_its_summary_is_written() -> None:
    limit = re.search(r"^CI_PART_TIMEOUT \?= (\d+)$", MAKEFILE, re.MULTILINE)
    assert limit is not None
    database_minutes = re.findall(
        r"database: true\n            minutes: (\d+)$", WORKFLOW, re.MULTILINE
    )
    assert database_minutes
    for target in ("test-critical-shard", "test-fast-only"):
        assert "--timeout $(CI_PART_TIMEOUT)" in _recipe(target), target
    assert all(int(limit.group(1)) < int(m) * 60 for m in database_minutes)
