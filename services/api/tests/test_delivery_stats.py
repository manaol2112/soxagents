"""The delivery metrics' computations (scripts/delivery_stats.py) on fixture data shaped
like the `gh` CLI's JSON. No network, no database.

Owner decision, 19 November 2026: lightweight delivery metrics, no tracking
infrastructure. The post-merge comparison is the evidence for keeping the `main`
validation, so a head that passed and a main that failed must be counted exactly.
"""

import importlib.util
import sys
from datetime import date
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "delivery_stats", ROOT / "scripts" / "delivery_stats.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # its dataclasses look their module up by name
    spec.loader.exec_module(module)
    return module


stats: Any = _module()


def _pr(**overrides: Any) -> dict[str, Any]:
    pr: dict[str, Any] = {
        "number": 7,
        "title": "A change",
        "createdAt": "2026-11-18T10:00:00Z",
        "mergedAt": "2026-11-18T12:30:00Z",
        "headRefName": "feature",
        "headRefOid": "head2",
        "mergeCommit": {"oid": "merge1"},
        "body": "## What\n\nConflicts: 2 (Makefile, docs/a.md)\n",
    }
    pr.update(overrides)
    return pr


def _run(run_id: int, **overrides: Any) -> dict[str, Any]:
    run: dict[str, Any] = {
        "databaseId": run_id,
        "event": "pull_request",
        "headBranch": "feature",
        "headSha": "head1",
        "status": "completed",
        "conclusion": "success",
        "createdAt": "2026-11-18T10:05:00Z",
        "updatedAt": "2026-11-18T10:30:00Z",
    }
    run.update(overrides)
    return run


RUNS = [
    _run(1, conclusion="cancelled"),
    _run(2, headSha="head2", createdAt="2026-11-18T11:00:00Z"),
    _run(3, event="push", headSha="head2", createdAt="2026-11-18T11:00:01Z"),
    # Outside the pull request: before it opened, another branch, and main's runs.
    _run(4, createdAt="2026-11-17T09:00:00Z"),
    _run(5, headBranch="other", createdAt="2026-11-18T11:00:00Z"),
    _run(
        6,
        event="push",
        headBranch="main",
        headSha="merge1",
        createdAt="2026-11-18T12:31:00Z",
        conclusion="failure",
    ),
    _run(7, event="push", headBranch="main", headSha="merge0", createdAt="2026-11-18T09:00:00Z"),
]


def test_ready_is_the_last_ready_event_else_the_creation() -> None:
    assert stats.ready_at("2026-11-18T10:00:00Z", []) == stats.parse_time("2026-11-18T10:00:00Z")
    events = ["2026-11-18T10:30:00Z", "2026-11-18T11:15:00Z"]
    assert stats.ready_at("2026-11-18T10:00:00Z", events) == stats.parse_time(events[1])


def test_median_and_nearest_rank_p90() -> None:
    values = [float(v) for v in range(1, 11)]
    assert stats.median(values) == 5.5
    assert stats.percentile(values, 0.9) == 9.0
    assert stats.percentile([4.0], 0.9) == 4.0
    assert stats.percentile([], 0.9) is None
    assert stats.median([]) is None


def test_a_pull_requests_runs_are_its_branch_between_open_and_merge() -> None:
    own = stats.pr_runs(_pr(), RUNS)
    assert [run["databaseId"] for run in own] == [1, 2, 3]
    assert stats.duplicate_runs(own) == 1  # head2 ran as a pull_request and as a push


def test_the_head_and_main_results_are_compared() -> None:
    own = stats.pr_runs(_pr(), RUNS)
    head = stats.head_run(_pr(), own)
    assert head is not None and head["databaseId"] == 3
    main = stats.main_run(_pr(), RUNS)
    assert main is not None and main["databaseId"] == 6
    assert stats.compare(stats.outcome(head), stats.outcome(main)) == "mismatch"
    assert stats.compare("success", "success") == "match"
    assert stats.compare("success", "pending") == "pending"
    assert stats.compare("success", "missing") == "missing"
    assert stats.outcome(None) == "missing"
    assert stats.outcome(_run(9, status="in_progress", conclusion="")) == "pending"


def test_the_critical_path_is_the_longest_gate_part_without_the_aggregate() -> None:
    jobs = [
        {
            "name": "lint and types",
            "started_at": "2026-11-18T10:00:00Z",
            "completed_at": "2026-11-18T10:04:00Z",
        },
        {
            "name": "critical 2 of 4",
            "started_at": "2026-11-18T10:00:10Z",
            "completed_at": "2026-11-18T10:12:10Z",
        },
        {
            "name": "baseline",
            "started_at": "2026-11-18T09:00:00Z",
            "completed_at": "2026-11-18T10:13:00Z",
        },
        {"name": "web build", "started_at": None, "completed_at": None},
    ]
    assert stats.critical_path(jobs) == 720.0
    assert stats.critical_path([]) is None


def test_the_one_job_gate_before_19_november_is_its_own_critical_path() -> None:
    one_job = [
        {
            "name": "baseline",
            "started_at": "2026-11-18T15:47:22Z",
            "completed_at": "2026-11-18T16:30:08Z",
        },
    ]
    assert stats.critical_path(one_job) == 2566.0


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ("Conflicts: 2 (Makefile, docs/a.md)", (2, "Makefile, docs/a.md")),
        ("text\r\nconflicts: 0\r\nmore", (0, None)),
        ("Conflicts: 1 ()", (1, None)),
        ("No conflict line here", (None, None)),
        (None, (None, None)),
        ("We had Conflicts: 3 in prose", (None, None)),
    ],
)
def test_the_conflicts_line_is_read_from_the_body(
    body: str | None, expected: tuple[Any, Any]
) -> None:
    assert stats.parse_conflicts(body) == expected


LOG = stats.DEFECT_LOG_HEADER + (
    "| 2026-11-17 | PRE_MERGE | Review | Old one | a-branch |\n"
    "| 2026-11-19 | PRE_MERGE | Review | Loop | e1 |\n"
    "| 2026-11-19 | ESCAPED_MAIN | Owner on main | Header | #12 |\n"
)


def test_the_defect_log_is_read_row_by_row() -> None:
    defects = stats.parse_defect_log(LOG)
    assert [(d.day, d.kind, d.reference) for d in defects] == [
        (date(2026, 11, 17), "PRE_MERGE", "a-branch"),
        (date(2026, 11, 19), "PRE_MERGE", "e1"),
        (date(2026, 11, 19), "ESCAPED_MAIN", "#12"),
    ]


@pytest.mark.parametrize(
    "row",
    [
        "| 2026-11-19 | ESCAPED | Owner | Bad class | x |",
        "| 19 Nov | PRE_MERGE | Owner | Bad date | x |",
        "| 2026-11-19 | PRE_MERGE | Too few cells |",
    ],
)
def test_a_bad_defect_row_is_an_error_not_skipped(row: str) -> None:
    with pytest.raises(ValueError, match="defect log line"):
        stats.parse_defect_log(stats.DEFECT_LOG_HEADER + row + "\n")


def test_the_summary_counts_the_window() -> None:
    first = stats.pull_request_stats(_pr(), [], RUNS, {2: 600.0, 3: 900.0, 6: 1200.0})
    assert first.ready_to_merged_seconds == 9000.0
    assert (first.ci_runs, first.cancelled, first.duplicates) == (3, 1, 1)
    assert (first.head_result, first.main_result, first.main_comparison) == (
        "success",
        "failure",
        "mismatch",
    )
    assert first.head_critical_path_seconds == 900.0
    assert (first.conflicts, first.conflict_files) == (2, "Makefile, docs/a.md")

    second = stats.pull_request_stats(
        _pr(
            number=8,
            headRefName="other",
            headRefOid="head1",
            mergeCommit={"oid": "none"},
            createdAt="2026-11-18T10:30:00Z",
            body="",
        ),
        ["2026-11-18T11:30:00Z"],
        RUNS,
        {},
    )
    assert second.ready_to_merged_seconds == 3600.0
    assert second.main_comparison == "missing"

    report = stats.summarize(
        date(2026, 11, 18),
        [first, second],
        {2: 600.0, 3: 900.0, 6: 1200.0, 8: None},
        stats.parse_defect_log(LOG),
    )
    assert report["ready_to_merged"] == {"median_seconds": 6300.0, "p90_seconds": 9000.0}
    ci = report["ci"]
    assert (ci["runs"], ci["cancelled"], ci["duplicates"]) == (4, 1, 1)
    assert (ci["main_match"], ci["main_mismatch"], ci["pr_passed_main_failed"]) == (0, 1, 1)
    assert ci["main_missing"] == 1
    assert (ci["critical_path_runs"], ci["critical_path_median_seconds"]) == (3, 900.0)
    assert report["conflicts"] == {"recorded_prs": 1, "unrecorded_prs": 1, "total": 2}
    assert report["defects"]["by_class"] == {
        "PRE_MERGE": 1,
        "ESCAPED_MAIN": 1,
        "ESCAPED_DEPLOYED": 0,
    }

    table = stats.render(report)
    assert "#7" in table and "mismatch" in table
    assert "1 PR passed but main failed" in table
    assert "PRE_MERGE 1, ESCAPED_MAIN 1, ESCAPED_DEPLOYED 0" in table


def test_durations_read_at_a_glance() -> None:
    assert stats.duration(None) == "-"
    assert stats.duration(42) == "42s"
    assert stats.duration(13 * 60 + 20) == "13m"
    assert stats.duration(2 * 3600 + 5 * 60) == "2h 05m"
