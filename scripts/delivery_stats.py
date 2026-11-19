"""Delivery metrics for the pull requests merged in a window (owner decision, 19 November
2026: lightweight measures, no tracking infrastructure).

    python scripts/delivery_stats.py [--since 2026-11-18] [--json]

For each pull request merged on or after --since (default: seven days ago), it reports:

(a) ready to merged: from the last `ready_for_review` timeline event, or from `createdAt`
    when the pull request was never a draft, to `mergedAt`; median and p90.
(b) CI runs per pull request (the CI workflow's runs on the head branch between the pull
    request's creation and its merge), the redundant ones (cancelled, and the same commit
    run more than once, as a push and as a pull request), and the post-merge `main` push
    run compared with the pull request head's result: match, mismatch, pending or missing.
    A mismatch where the head passed and `main` failed is the evidence for keeping the
    post-merge validation.
(c) CI critical path per run: the longest gate part (job) from the jobs API, the
    aggregate `baseline` job excluded; and its median.
(d) Rebase conflicts, from a `Conflicts: N (files)` line in the pull request body.
(e) Defects by class, from the git-ignored private/defect-log.md of the main checkout
    (shared by every worktree), dated in the window.

Data comes from the `gh` CLI as JSON; only the standard library is used. The computations
are pure functions tested in services/api/tests/test_delivery_stats.py with fixture data.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import subprocess
import sys
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

CI_WORKFLOW = "CI"
MAIN_BRANCH = "main"
# Jobs that only aggregate the gate parts' results (.github/workflows/ci.yml).
AGGREGATE_JOBS = frozenset({"baseline"})
DEFECT_CLASSES = ("PRE_MERGE", "ESCAPED_MAIN", "ESCAPED_DEPLOYED")
DEFECT_LOG = Path("private") / "defect-log.md"
DEFECT_LOG_HEADER = """# Defect log (private, git-ignored)

Read by scripts/delivery_stats.py. One row per defect. Classes:

- PRE_MERGE: found in unmerged development code (by tests, reviews, or the owner on a
  preview or a dev stack serving a branch).
- ESCAPED_MAIN: found in code already merged to main (for example in the owner's dev
  environment running main).
- ESCAPED_DEPLOYED: found in a deployed environment.

| Date | Class | Where found | Description | PR/branch |
| --- | --- | --- | --- | --- |
"""

_CONFLICTS = re.compile(r"^\s*Conflicts:\s*(\d+)\s*(?:\((.*)\))?\s*$", re.IGNORECASE | re.MULTILINE)


# --- Pure computations -------------------------------------------------------------------


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def percentile(values: Sequence[float], fraction: float) -> float | None:
    """Nearest-rank percentile: the smallest value with at least `fraction` of the values
    at or below it. None for no values."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[rank - 1]


def median(values: Sequence[float]) -> float | None:
    return statistics.median(values) if values else None


def ready_at(created_at: str, ready_events: Sequence[str]) -> datetime:
    """When the pull request was ready: its last ready-for-review event, else its creation."""
    if ready_events:
        return max(parse_time(moment) for moment in ready_events)
    return parse_time(created_at)


def pr_runs(pr: Mapping[str, Any], runs: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    """The CI runs of a pull request's head branch from its creation to its merge."""
    opened = parse_time(pr["createdAt"])
    merged = parse_time(pr["mergedAt"])
    return sorted(
        (
            run
            for run in runs
            if run["headBranch"] == pr["headRefName"]
            and run["event"] in ("pull_request", "push")
            and opened <= parse_time(run["createdAt"]) <= merged
        ),
        key=lambda run: run["createdAt"],
    )


def duplicate_runs(runs: Sequence[Mapping[str, Any]]) -> int:
    """Runs beyond the first on the same commit (a push and a pull_request run of one SHA)."""
    return len(runs) - len({run["headSha"] for run in runs})


def outcome(run: Mapping[str, Any] | None) -> str:
    """A run's result: its conclusion when completed, `pending` while it runs, `missing`."""
    if run is None:
        return "missing"
    if run["status"] != "completed":
        return "pending"
    return str(run["conclusion"])


def head_run(pr: Mapping[str, Any], runs: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    """The latest run on the pull request's head commit."""
    on_head = [run for run in runs if run["headSha"] == pr["headRefOid"]]
    return max(on_head, key=lambda run: run["createdAt"]) if on_head else None


def main_run(pr: Mapping[str, Any], runs: Iterable[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    """The latest push run on main for the pull request's merge commit."""
    merge = (pr.get("mergeCommit") or {}).get("oid")
    found = [
        run
        for run in runs
        if run["event"] == "push" and run["headBranch"] == MAIN_BRANCH and run["headSha"] == merge
    ]
    return max(found, key=lambda run: run["createdAt"]) if found else None


def compare(head: str, main: str) -> str:
    """`match` or `mismatch` once both results are known, else `pending` or `missing`."""
    for unknown in ("missing", "pending"):
        if unknown in (head, main):
            return unknown
    return "match" if head == main else "mismatch"


def critical_path(jobs: Iterable[Mapping[str, Any]]) -> float | None:
    """Seconds of the longest gate part: the longest job that started and completed, the
    aggregate jobs excluded. Before 19 Nov 2026 CI was one job, itself named `baseline`
    and running every check; a run whose only jobs are aggregate-named is that one-job
    gate, and its job is the critical path."""
    jobs = list(jobs)
    parts = [job for job in jobs if job["name"] not in AGGREGATE_JOBS] or jobs
    lengths = [
        (parse_time(job["completed_at"]) - parse_time(job["started_at"])).total_seconds()
        for job in parts
        if job.get("started_at") and job.get("completed_at")
    ]
    return max(lengths) if lengths else None


def parse_conflicts(body: str | None) -> tuple[int | None, str | None]:
    """The `Conflicts: N (files)` line of a pull request body: (N, files), or (None, None)
    when the body has none."""
    found = _CONFLICTS.search(body or "")
    if found is None:
        return None, None
    files = found.group(2).strip() if found.group(2) else None
    return int(found.group(1)), files or None


@dataclass(frozen=True)
class Defect:
    day: date
    kind: str
    where: str
    description: str
    reference: str


def parse_defect_log(text: str) -> list[Defect]:
    """The rows of the log's table. A row with the wrong number of cells, a bad date or an
    unknown class is an error, never skipped."""
    defects: list[Defect] = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if cells[0].lower() == "date" or set("".join(cells)) <= set("-: "):
            continue  # the header row and its separator
        if len(cells) != 5:
            raise ValueError(f"defect log line {number}: expected 5 cells, found {len(cells)}")
        try:
            day = date.fromisoformat(cells[0])
        except ValueError as error:
            raise ValueError(f"defect log line {number}: bad date {cells[0]!r}") from error
        if cells[1] not in DEFECT_CLASSES:
            raise ValueError(f"defect log line {number}: unknown class {cells[1]!r}")
        defects.append(Defect(day, cells[1], cells[2], cells[3], cells[4]))
    return defects


@dataclass
class PullRequestStats:
    number: int
    branch: str
    ready_to_merged_seconds: float
    ci_runs: int
    cancelled: int
    duplicates: int
    head_result: str
    main_result: str
    main_comparison: str
    head_critical_path_seconds: float | None
    conflicts: int | None
    conflict_files: str | None
    run_ids: list[int] = field(default_factory=list)


def pull_request_stats(
    pr: Mapping[str, Any],
    ready_events: Sequence[str],
    runs: Sequence[Mapping[str, Any]],
    critical_paths: Mapping[int, float | None],
) -> PullRequestStats:
    own = pr_runs(pr, runs)
    head = head_run(pr, own)
    head_result = outcome(head)
    main_result = outcome(main_run(pr, runs))
    conflicts, files = parse_conflicts(pr.get("body"))
    return PullRequestStats(
        number=int(pr["number"]),
        branch=str(pr["headRefName"]),
        ready_to_merged_seconds=(
            parse_time(pr["mergedAt"]) - ready_at(pr["createdAt"], ready_events)
        ).total_seconds(),
        ci_runs=len(own),
        cancelled=sum(1 for run in own if run.get("conclusion") == "cancelled"),
        duplicates=duplicate_runs(own),
        head_result=head_result,
        main_result=main_result,
        main_comparison=compare(head_result, main_result),
        head_critical_path_seconds=critical_paths.get(int(head["databaseId"])) if head else None,
        conflicts=conflicts,
        conflict_files=files,
        run_ids=[int(run["databaseId"]) for run in own],
    )


def summarize(
    since: date,
    prs: Sequence[PullRequestStats],
    critical_paths: Mapping[int, float | None],
    defects: Sequence[Defect],
) -> dict[str, Any]:
    """The window's figures, as plain data (the --json output)."""
    lead = [pr.ready_to_merged_seconds for pr in prs]
    paths = [seconds for seconds in critical_paths.values() if seconds is not None]
    recorded = [pr.conflicts for pr in prs if pr.conflicts is not None]
    in_window = [defect for defect in defects if defect.day >= since]
    return {
        "since": since.isoformat(),
        "pull_requests": [asdict(pr) for pr in prs],
        "ready_to_merged": {"median_seconds": median(lead), "p90_seconds": percentile(lead, 0.9)},
        "ci": {
            "runs": sum(pr.ci_runs for pr in prs),
            "runs_per_pr_median": median([pr.ci_runs for pr in prs]),
            "cancelled": sum(pr.cancelled for pr in prs),
            "duplicates": sum(pr.duplicates for pr in prs),
            "main_match": sum(pr.main_comparison == "match" for pr in prs),
            "main_mismatch": sum(pr.main_comparison == "mismatch" for pr in prs),
            "pr_passed_main_failed": sum(
                pr.head_result == "success" and pr.main_result == "failure" for pr in prs
            ),
            "main_pending": sum(pr.main_comparison == "pending" for pr in prs),
            "main_missing": sum(pr.main_comparison == "missing" for pr in prs),
            "critical_path_runs": len(paths),
            "critical_path_median_seconds": median(paths),
        },
        "conflicts": {
            "recorded_prs": len(recorded),
            "unrecorded_prs": len(prs) - len(recorded),
            "total": sum(recorded),
        },
        "defects": {
            "by_class": {kind: sum(d.kind == kind for d in in_window) for kind in DEFECT_CLASSES},
            "rows": [{**asdict(defect), "day": defect.day.isoformat()} for defect in in_window],
        },
    }


def duration(seconds: float | None) -> str:
    if seconds is None:
        return "-"
    minutes = round(seconds / 60)
    if minutes >= 60:
        return f"{minutes // 60}h {minutes % 60:02d}m"
    if seconds >= 60:
        return f"{minutes}m"
    return f"{round(seconds)}s"


def render(report: Mapping[str, Any]) -> str:
    """The compact table and the summary lines."""
    rows = [
        (
            "PR",
            "Branch",
            "Ready>merged",
            "Runs",
            "Cancel",
            "Dup",
            "Head",
            "Main",
            "Main vs head",
            "Crit path",
            "Conflicts",
        )
    ]
    for pr in report["pull_requests"]:
        conflicts = "-" if pr["conflicts"] is None else str(pr["conflicts"])
        if pr["conflict_files"]:
            conflicts += f" ({pr['conflict_files']})"
        rows.append(
            (
                f"#{pr['number']}",
                pr["branch"][:28],
                duration(pr["ready_to_merged_seconds"]),
                str(pr["ci_runs"]),
                str(pr["cancelled"]),
                str(pr["duplicates"]),
                pr["head_result"],
                pr["main_result"],
                pr["main_comparison"],
                duration(pr["head_critical_path_seconds"]),
                conflicts,
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(len(rows[0]))]
    lines = [f"Merged pull requests since {report['since']}: {len(report['pull_requests'])}", ""]
    for index, row in enumerate(rows):
        lines.append(
            "  ".join(cell.ljust(width) for cell, width in zip(row, widths, strict=True)).rstrip()
        )
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))
    lead, ci, conflicts, defects = (
        report["ready_to_merged"],
        report["ci"],
        report["conflicts"],
        report["defects"],
    )
    per_pr = "-" if ci["runs_per_pr_median"] is None else f"{ci['runs_per_pr_median']:g}"
    lines += [
        "",
        f"Ready to merged     median {duration(lead['median_seconds'])}, "
        f"p90 {duration(lead['p90_seconds'])}",
        f"CI runs             {ci['runs']} (median {per_pr} per PR); "
        f"redundant: {ci['cancelled']} cancelled, {ci['duplicates']} same commit run twice",
        f"Post-merge main     {ci['main_match']} match, {ci['main_mismatch']} mismatch "
        f"({ci['pr_passed_main_failed']} PR passed but main failed), "
        f"{ci['main_pending']} pending, {ci['main_missing']} missing",
        f"Critical path       median {duration(ci['critical_path_median_seconds'])} "
        f"over {ci['critical_path_runs']} completed runs (longest gate part)",
        f"Rebase conflicts    {conflicts['total']} in {conflicts['recorded_prs']} PRs "
        f"recording them; {conflicts['unrecorded_prs']} PRs without a Conflicts: line",
        "Defects             "
        + ", ".join(f"{kind} {count}" for kind, count in defects["by_class"].items()),
    ]
    if defects.get("log_missing"):
        lines.append(f"  no defect log at {defects['log_missing']}")
    for row in defects["rows"]:
        lines.append(f"  {row['day']}  {row['kind']:<16} {row['description']} [{row['reference']}]")
    return "\n".join(lines)


# --- Reading GitHub through gh -----------------------------------------------------------


def _gh(*args: str) -> str:
    result = subprocess.run(
        ["gh", *args], capture_output=True, text=True, encoding="utf-8", check=False
    )
    if result.returncode != 0:
        raise SystemExit(f"gh {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def _lines(output: str) -> list[str]:
    return [line for line in output.splitlines() if line.strip()]


def fetch_merged(since: date) -> list[dict[str, Any]]:
    fields = "number,title,createdAt,mergedAt,headRefName,headRefOid,mergeCommit,body"
    prs: list[dict[str, Any]] = json.loads(
        _gh(
            "pr",
            "list",
            "--state",
            "merged",
            "--search",
            f"merged:>={since.isoformat()}",
            "--limit",
            "1000",
            "--json",
            fields,
        )
    )
    start = datetime(since.year, since.month, since.day, tzinfo=UTC)
    return sorted(
        (pr for pr in prs if parse_time(pr["mergedAt"]) >= start), key=lambda pr: pr["mergedAt"]
    )


def fetch_ready_events(number: int) -> list[str]:
    return _lines(
        _gh(
            "api",
            f"repos/{{owner}}/{{repo}}/issues/{number}/timeline",
            "--paginate",
            "-q",
            '.[] | select(.event == "ready_for_review") | .created_at',
        )
    )


def fetch_runs(since: date) -> list[dict[str, Any]]:
    fields = "databaseId,event,headBranch,headSha,status,conclusion,createdAt,updatedAt"
    runs: list[dict[str, Any]] = json.loads(
        _gh(
            "run",
            "list",
            "--workflow",
            CI_WORKFLOW,
            "--created",
            f">={since.isoformat()}",
            "--limit",
            "1000",
            "--json",
            fields,
        )
    )
    return runs


def fetch_jobs(run_id: int) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in _lines(
            _gh(
                "api",
                f"repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs",
                "--paginate",
                "-q",
                ".jobs[] | {name, started_at, completed_at} | @json",
            )
        )
    ]


def defect_log_path() -> Path:
    """private/defect-log.md in the main checkout, which every worktree shares."""
    common = _git("rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common).parent / DEFECT_LOG


def _git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--since",
        type=date.fromisoformat,
        default=datetime.now(UTC).date() - timedelta(days=7),
        help="first merge date, YYYY-MM-DD (default: seven days ago)",
    )
    parser.add_argument("--json", action="store_true", help="print the figures as JSON")
    parser.add_argument(
        "--defect-log",
        type=Path,
        default=None,
        help="the defect log (default: private/defect-log.md of the main checkout)",
    )
    options = parser.parse_args(argv)

    merged = fetch_merged(options.since)
    earliest = min((parse_time(pr["createdAt"]).date() for pr in merged), default=options.since)
    runs = fetch_runs(earliest)
    measured: dict[int, float | None] = {}
    wanted = {run["databaseId"] for pr in merged for run in pr_runs(pr, runs)}
    wanted |= {run["databaseId"] for pr in merged if (run := main_run(pr, runs)) is not None}
    for run in runs:
        if (
            run["databaseId"] in wanted
            and run["status"] == "completed"
            and run["conclusion"] != "cancelled"
        ):
            measured[int(run["databaseId"])] = critical_path(fetch_jobs(int(run["databaseId"])))
    stats = [
        pull_request_stats(pr, fetch_ready_events(int(pr["number"])), runs, measured)
        for pr in merged
    ]
    log = options.defect_log or defect_log_path()
    defects = parse_defect_log(log.read_text(encoding="utf-8")) if log.exists() else []
    report = summarize(options.since, stats, measured, defects)
    if not log.exists():
        report["defects"]["log_missing"] = str(log)
    print(json.dumps(report, indent=2) if options.json else render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
