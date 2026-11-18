"""Both background workers offer the same jobs. No database is used.

Governance assessment, finding A2 (18 November 2026): work is queued on whichever worker is
configured (TemporalAdapter in durable.py, or LocalDraftScheduler in pbc_drafting.py), and
code finds a job's method by name (`getattr(scheduler, "schedule_plan_runs", None)`). A
method one worker lacks, or a probe that misspells it, silently disables that work in one
mode: no error, no type failure. This test holds the two in step.
"""

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1] / "ai_workforce_api"

# Methods only one worker has, each with why.
TEMPORAL_ONLY = {
    "schedule": "the follow-up reminder timer; without Temporal there is none "
    "(docs/background-work.md, Timers)",
    "attach": "a durable workflow run's own timer (workflow.py, manager.py)",
}
LOCAL_ONLY = {
    "resume": "the in-process worker picks up open records at start; Temporal resumes "
    "through its own worker start (durable.serve)",
    "shutdown": "stops the in-process thread pool with the API",
    "workers": "the in-process pool's size",
}


def _methods(module: str, cls: str) -> set[str]:
    tree = ast.parse((PACKAGE / module).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == cls:
            return {
                item.name
                for item in node.body
                if isinstance(item, ast.FunctionDef | ast.AsyncFunctionDef)
                and not item.name.startswith("_")
            }
    raise AssertionError(f"{cls} is not in {module}")


TEMPORAL = _methods("durable.py", "TemporalAdapter")
LOCAL = _methods("pbc_drafting.py", "LocalDraftScheduler")


def _probed() -> dict[str, list[str]]:
    """Each method name code looks a scheduler up by (getattr/hasattr with a literal name
    that queues work), with the modules that do."""
    found: dict[str, list[str]] = {}
    for path in sorted(PACKAGE.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in ("getattr", "hasattr")
                and len(node.args) >= 2
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)
                and node.args[1].value.startswith("schedule_")
            ):
                found.setdefault(node.args[1].value, []).append(path.name)
    return found


def test_both_workers_offer_the_same_jobs() -> None:
    assert sorted(TEMPORAL - LOCAL - set(TEMPORAL_ONLY)) == [], "Temporal only, not listed"
    assert sorted(LOCAL - TEMPORAL - set(LOCAL_ONLY)) == [], "local only, not listed"
    jobs = {name for name in TEMPORAL & LOCAL if name.startswith("schedule_")}
    assert len(jobs) >= 15, sorted(jobs)


def test_every_job_code_looks_up_by_name_exists_on_both() -> None:
    probed = _probed()
    assert probed, "the probes are no longer found"
    missing = {
        name: modules
        for name, modules in probed.items()
        if name not in TEMPORAL or name not in LOCAL
    }
    assert missing == {}, f"looked up by name but missing on a worker: {missing}"


def test_the_listed_exceptions_still_exist() -> None:
    assert sorted(set(TEMPORAL_ONLY) - TEMPORAL) == []
    assert sorted(set(LOCAL_ONLY) - LOCAL) == []
