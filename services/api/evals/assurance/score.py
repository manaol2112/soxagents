"""Score the evidence assurance chain against the evaluation set, with the live model.

    uv run --env-file .env python -m evals.assurance.score --dry-run
    uv run --env-file .env python -m evals.assurance.score --max-cost-usd 5 [--case NAME ...]

(run from services/api). A live run spends money and needs the product owner's approval;
it is never part of a test tier. It refuses to start without --max-cost-usd and stops
before any call whose worst case would pass it.

For each case the chain's own input is built (case_set.chain_of), and the two readings
are asked exactly as the database run asks them (evidence_assurance.run_assessment): the
same prompts (prompt_for), the control's tester agent's tier and that tier's pinned,
priced model for both readings (never a weaker one for the reviewer), the same output
schema, timeout and output allowance, the same retry of a transient failure, and the
same per-call and per-job budget refusals. The readings then go through run_chain, so
check_opinion and compare decide what stands, as they do for a person. Nothing is
written to the database and no call is recorded there: the scorer writes its own result
file under results/.

Each attribute's verdict is scored against the case's expected verdict. Reported
separately: false SUPPORTED (the error that matters most), false ISSUE, missed ISSUE,
the UNSETTLED rate, how often the two readings agree, and tokens and cost per case and
per file.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TextIO

from ai_workforce_api.controls import BUSINESS_TESTER, DOMAIN_AGENTS
from ai_workforce_api.evidence_assurance import (
    OPINION_SCHEMA,
    PROMPT_VERSIONS,
    REVIEWER_AGENT,
    ROLES,
    ChainInput,
    ChainResult,
    Opinion,
    Role,
    prompt_for,
    run_chain,
)
from ai_workforce_api.model_providers import agent_tier, live_model, provider_for, tier_config
from ai_workforce_api.models import (
    ModelConfig,
    ModelProvider,
    ModelRequest,
    ModelTier,
    cost_micros,
    estimate_tokens,
)
from ai_workforce_api.models import outcome as model_outcome
from ai_workforce_api.provenance import RETRY_DELAYS, Limits, estimate_micros
from ai_workforce_api.settings import Settings
from evals.assurance.case_set import CASES_DIR, EvalCase, Expectation, chain_of, load_cases

RESULTS_DIR = Path(__file__).parent / "results"
# As the database run (evidence_assurance._assess, its request_of) builds each request.
TIMEOUT_SECONDS = 240
MAX_TOKENS = 8192


def request_for(system: str, prompt: str) -> ModelRequest:
    """One reading's request, exactly as the database run builds it."""
    return ModelRequest(
        operation="generate",
        prompt=prompt,
        output_schema=OPINION_SCHEMA,
        allowed_tool_ids=(),
        timeout_seconds=TIMEOUT_SECONDS,
        cancelled=False,
        system=system,
        max_tokens=MAX_TOKENS,
    )


@dataclass(frozen=True)
class ModelSetup:
    """Who reads a case and on what model: the control's tester and the independent
    reviewer, both on the tester's tier and that tier's configuration."""

    assessor_agent: str
    reviewer_agent: str
    tier: ModelTier
    config: ModelConfig


def setup_for(case: EvalCase, settings: Settings) -> ModelSetup:
    tester = DOMAIN_AGENTS.get(case.control.domain, BUSINESS_TESTER)
    tier = agent_tier(tester, settings)
    return ModelSetup(tester, REVIEWER_AGENT, tier, tier_config(settings, tier))


class BudgetStop(Exception):
    """The next call's worst case would pass --max-cost-usd: nothing more is called."""


@dataclass
class Budget:
    max_micros: int
    spent: int = 0

    def allows(self, estimate: int) -> bool:
        return self.spent + estimate <= self.max_micros


@dataclass
class CallRecord:
    role: Role
    status: str
    attempts: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_micros: int = 0
    estimate_micros: int = 0
    error: str = ""


def _refusal(estimates: Sequence[int], limits: Limits, spent: int = 0) -> str:
    """Why the database run would refuse to start (AgentCaller.refusal_for, without the
    engagement's month and a trial firm's allowance, which live in the database)."""
    for estimate in estimates:
        if limits.call and estimate > limits.call:
            return f"a call would cost about ${estimate / 1e6:.2f}, over the ${limits.call / 1e6:.2f} limit a call"  # noqa: E501
    total = sum(estimates)
    if limits.job and spent + total > limits.job:
        return f"the calls would cost about ${total / 1e6:.2f} together, over the ${limits.job / 1e6:.2f} limit a job"  # noqa: E501
    return ""


def call_model(
    provider: ModelProvider,
    request: ModelRequest,
    setup: ModelSetup,
    record: CallRecord,
    budget: Budget,
    limits: Limits,
    job_spent: Callable[[], int],
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any] | None:
    """One reading, as AgentCaller.generate makes it: a budget check before each attempt,
    a transient failure tried again, and only a complete answer that matched the schema
    read. Raises BudgetStop before an attempt whose worst case would pass the cap."""
    while True:
        estimate = estimate_micros(setup.config, request)
        record.estimate_micros = max(record.estimate_micros, estimate)
        if not budget.allows(estimate):
            raise BudgetStop(
                f"the {record.role.lower()} reading would cost up to ${estimate / 1e6:.4f}; "
                f"${budget.spent / 1e6:.4f} of the ${budget.max_micros / 1e6:.2f} cap is spent"
            )
        if (limits.call and estimate > limits.call) or (
            limits.job and job_spent() + estimate > limits.job
        ):
            record.status = "BUDGET_EXCEEDED"
            record.error = "the configured per-call or per-job budget refused the call"
            return None
        record.attempts += 1
        found = model_outcome(provider, request, setup.config)
        cost = cost_micros(setup.config, found.raw.input_tokens, found.raw.output_tokens)
        budget.spent += cost
        record.cost_micros += cost
        record.input_tokens += found.raw.input_tokens
        record.output_tokens += found.raw.output_tokens
        record.status = found.status
        record.error = found.error
        if found.status == "SUCCEEDED" or not (
            found.transient and record.attempts <= len(RETRY_DELAYS)
        ):
            break
        sleep(RETRY_DELAYS[record.attempts - 1])
    if found.status == "SUCCEEDED" and found.raw.output is not None:
        return found.raw.output
    return None


# --- Scoring -------------------------------------------------------------------------


def _result_of(opinion: Opinion | None, chain: ChainInput, code: str) -> str | None:
    if opinion is None:
        return None
    attribute = next(a for a in chain.attributes if a.code == code)
    view = opinion.view(attribute.id)
    return None if view is None else view.result


SUPPORT_VERDICTS = frozenset({"SUPPORTED", "PARTLY_SUPPORTED"})


def classify(
    expectation: Expectation, verdict: str, result: str | None, shows: str | None = None
) -> str:
    """One attribute's outcome against what an auditor expects, by the errors' order. A
    support with the right verdict but credited as IMPLEMENTATION where the evidence shows
    only the design is a false IMPLEMENTATION (the D&I equivalent of a false SUPPORTED)."""
    if verdict == expectation.verdict and (verdict != "ISSUE" or result in expectation.results):
        if verdict in SUPPORT_VERDICTS and shows != expectation.shows:
            return "false_implementation" if shows == "IMPLEMENTATION" else "shows_mismatch"
        return "correct"
    if verdict == "SUPPORTED":
        return "false_supported"
    if verdict == "PARTLY_SUPPORTED":
        return "false_partly_supported"
    if verdict == "ISSUE":
        return "issue_wrong_result" if expectation.verdict == "ISSUE" else "false_issue"
    if expectation.verdict == "ISSUE":
        return "missed_issue"
    if verdict == "UNSETTLED":
        return (
            "unsettled_acceptable"
            if expectation.unsettled_acceptable
            else "unsettled_not_acceptable"
        )  # noqa: E501
    return "other_mismatch"


def score_attributes(
    case: EvalCase, chain: ChainInput, result: ChainResult
) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    outcomes = {outcome.code: outcome for outcome in result.outcomes}
    for attribute in case.attributes:
        expectation = case.expected[attribute.code]
        found = outcomes.get(attribute.code)
        verdict = "MISSING" if found is None else found.verdict
        actual = None if found is None else found.result
        assessor = _result_of(result.first, chain, attribute.code)
        reviewer = _result_of(result.second, chain, attribute.code)
        scored.append({
            "code": attribute.code,
            "expected_link": attribute.expected,
            "expected_verdict": expectation.verdict,
            "acceptable_results": list(expectation.results),
            "unsettled_acceptable": expectation.unsettled_acceptable,
            "expected_shows": expectation.shows,
            "auditor_reason": expectation.reason,
            "code_gap": None if expectation.code_gap is None else expectation.code_gap.model_dump(),
            "verdict": verdict,
            "result": actual,
            "shows": None if found is None else found.shows,
            "assessor_result": assessor,
            "reviewer_result": reviewer,
            "readings_agree": assessor is not None and assessor == reviewer,
            "outcome": "skipped"
            if found is None
            else classify(expectation, verdict, actual, found.shows),
            "summary": "" if found is None else found.summary,
        })  # fmt: skip
    return scored


def totals_of(cases: Sequence[dict[str, Any]]) -> dict[str, Any]:
    scored = [a for case in cases if case.get("scored") for a in case["attributes"]]
    gap = [a for a in scored if a["code_gap"] is not None]

    def count(items: Sequence[dict[str, Any]], test: Callable[[dict[str, Any]], bool]) -> int:
        return sum(1 for item in items if test(item))

    def false_supported(a: dict[str, Any]) -> bool:
        return bool(a["expected_verdict"] != "SUPPORTED" and a["verdict"] == "SUPPORTED")

    def false_issue(a: dict[str, Any]) -> bool:
        return bool(a["expected_verdict"] != "ISSUE" and a["verdict"] == "ISSUE")

    def missed_issue(a: dict[str, Any]) -> bool:
        return bool(a["expected_verdict"] == "ISSUE" and a["verdict"] != "ISSUE")

    unsettled = count(scored, lambda a: a["verdict"] == "UNSETTLED")
    read_both = [a for a in scored if a["assessor_result"] is not None]
    files = sum(len(case["files"]) for case in cases if case.get("calls"))
    cost = sum(case["cost_micros"] for case in cases)
    return {
        "cases": len(cases),
        "cases_scored": sum(1 for case in cases if case.get("scored")),
        "cases_failed": sum(1 for case in cases if case.get("failed")),
        "cases_refused": sum(1 for case in cases if case.get("refused")),
        "cases_not_run": sum(1 for case in cases if case.get("not_run")),
        "attributes_scored": len(scored),
        "correct": count(scored, lambda a: a["outcome"] == "correct"),
        "acceptable": count(
            scored,
            lambda a: (
                a["outcome"] in ("correct", "unsettled_acceptable")
                or (a["verdict"] == "UNSETTLED" and a["unsettled_acceptable"])
            ),
        ),
        "false_supported": count(scored, false_supported),
        "false_issue": count(scored, false_issue),
        "false_issue_from_code_gaps": count(gap, false_issue),
        "missed_issue": count(scored, missed_issue),
        "missed_issue_from_code_gaps": count(gap, missed_issue),
        "issue_wrong_result": count(scored, lambda a: a["outcome"] == "issue_wrong_result"),
        "false_partly_supported": count(
            scored,
            lambda a: (
                a["expected_verdict"] not in SUPPORT_VERDICTS and a["verdict"] == "PARTLY_SUPPORTED"
            ),
        ),
        "false_implementation": count(
            scored,
            lambda a: (
                a["verdict"] in SUPPORT_VERDICTS
                and a["shows"] == "IMPLEMENTATION"
                and a["expected_shows"] == "DESIGN"
            ),
        ),
        "shows_mismatch": count(scored, lambda a: a["outcome"] == "shows_mismatch"),
        "missed_supported": count(
            scored, lambda a: a["expected_verdict"] == "SUPPORTED" and a["verdict"] != "SUPPORTED"
        ),
        "unsettled": unsettled,
        "unsettled_rate": round(unsettled / len(scored), 4) if scored else 0.0,
        "unsettled_not_acceptable": count(
            scored,
            lambda a: (
                a["verdict"] == "UNSETTLED"
                and a["expected_verdict"] != "UNSETTLED"
                and not a["unsettled_acceptable"]
            ),
        ),
        "silently_skipped": count(scored, lambda a: a["outcome"] == "skipped"),
        "code_gap_attributes": len(gap),
        "code_gap_as_documented": count(gap, lambda a: a["verdict"] == a["code_gap"]["gives"]),
        "readings_agree": count(read_both, lambda a: bool(a["readings_agree"])),
        "agreement_rate": round(
            count(read_both, lambda a: bool(a["readings_agree"])) / len(read_both), 4
        )
        if read_both
        else 0.0,
        "input_tokens": sum(case["input_tokens"] for case in cases),
        "output_tokens": sum(case["output_tokens"] for case in cases),
        "cost_usd": round(cost / 1e6, 6),
        "cost_per_file_usd": round(cost / 1e6 / files, 6) if files else 0.0,
    }


def _files_of(chain: ChainInput, input_tokens: int, cost: int) -> list[dict[str, Any]]:
    """Each file with its share of the case's tokens and cost, apportioned by its share
    of the files' text (the provider reports usage per call, not per file)."""
    total = sum(len(file.text) for file in chain.files) or 1
    return [
        {
            "name": file.name,
            "kind": file.kind,
            "characters": len(file.text),
            "read_in_part": file.truncated,
            "input_tokens_share": round(input_tokens * len(file.text) / total),
            "cost_usd_share": round(cost * len(file.text) / total / 1e6, 6),
        }
        for file in chain.files
    ]


def _blank(case: EvalCase, chain: ChainInput, setup: ModelSetup) -> dict[str, Any]:
    return {
        "name": case.name,
        "title": case.title,
        "lens": chain.lens,
        "model": setup.config.model_name,
        "tier": setup.tier,
        "agents": {"ASSESSOR": setup.assessor_agent, "REVIEWER": setup.reviewer_agent},
        "calls": [],
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_micros": 0,
        "files": _files_of(chain, 0, 0),
        "attributes": [],
    }


def run_case(
    case: EvalCase,
    provider: ModelProvider,
    settings: Settings,
    budget: Budget,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Any], str]:
    """One case through the chain; its record, and why the whole run must stop (empty
    when it need not)."""
    chain = chain_of(case)
    setup = setup_for(case, settings)
    limits = Limits.of(settings)
    record = _blank(case, chain, setup)
    estimates = [estimate_micros(setup.config, request_for(*prompt_for(chain, r))) for r in ROLES]
    refusal = _refusal(estimates, limits)
    if refusal:
        # The database run fails such a run before either reading, and makes no call.
        record["refused"] = f"Not checked: {refusal}. Neither reading was started."
        return record, ""
    calls: list[CallRecord] = []

    def ask(role: Role, system: str, prompt: str) -> dict[str, Any] | None:
        made = CallRecord(role, "NOT_MADE")
        calls.append(made)
        return call_model(
            provider, request_for(system, prompt), setup, made, budget, limits,
            lambda: sum(c.cost_micros for c in calls), sleep,
        )  # fmt: skip

    stopped = ""
    result: ChainResult | None = None
    try:
        result = run_chain(ask, chain)
    except BudgetStop as stop:
        stopped = f"Stopped before a call in case {case.name}: {stop}"
        record["not_run"] = True
    record["calls"] = [asdict(call) for call in calls]
    record["input_tokens"] = sum(call.input_tokens for call in calls)
    record["output_tokens"] = sum(call.output_tokens for call in calls)
    record["cost_micros"] = sum(call.cost_micros for call in calls)
    record["cost_usd"] = round(record["cost_micros"] / 1e6, 6)
    record["files"] = _files_of(chain, record["input_tokens"], record["cost_micros"])
    if result is None:
        return record, stopped
    record["dropped_quotes"] = {
        "ASSESSOR": None if result.first is None else result.first.dropped,
        "REVIEWER": None if result.second is None else result.second.dropped,
    }
    record["set_aside"] = {
        "ASSESSOR": None if result.first is None else result.first.set_aside,
        "REVIEWER": None if result.second is None else result.second.set_aside,
    }
    if result.failed is not None:
        # As the database run: a reading that gave nothing settles nothing, and the run
        # is FAILED with nothing shown. Its attributes are not scored.
        record["failed"] = f"{result.failed}: {result.reason}"
        return record, ""
    record["scored"] = True
    record["attributes"] = score_attributes(case, chain, result)
    return record, ""


def run_cases(
    cases: Sequence[EvalCase],
    provider: ModelProvider,
    settings: Settings,
    budget: Budget,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[list[dict[str, Any]], str]:
    """Every case through the chain with the given provider; the case records and why the
    run stopped early (empty when it did not). After a stop no case is run."""
    records: list[dict[str, Any]] = []
    stopped = ""
    for case in cases:
        if stopped:
            record = _blank(case, chain_of(case), setup_for(case, settings))
            record["not_run"] = True
        else:
            record, stopped = run_case(case, provider, settings, budget, sleep)
        records.append(record)
    return records, stopped


def report_of(
    records: list[dict[str, Any]], stopped: str, mode: str, budget: Budget
) -> dict[str, Any]:
    models = sorted({str(record["model"]) for record in records})
    return {
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "mode": mode,
        "models": models,
        "prompt_versions": dict(PROMPT_VERSIONS),
        "max_cost_usd": budget.max_micros / 1e6,
        "stopped": stopped or None,
        "totals": totals_of(records),
        "cases": records,
    }


def write_report(report: dict[str, Any], directory: Path = RESULTS_DIR) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = directory / f"{stamp}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def print_report(report: dict[str, Any], out: TextIO) -> None:
    for case in report["cases"]:
        state = (
            "not run" if case.get("not_run") else case.get("refused") or case.get("failed") or ""
        )
        print(
            f"{case['name']}: {case['lens']}, {case['input_tokens']} in / "
            f"{case['output_tokens']} out tokens, ${case['cost_micros'] / 1e6:.4f}"
            + (f" ({state})" if state else ""),
            file=out,
        )
        for a in case["attributes"]:
            mark = "" if a["outcome"] == "correct" else f"  <- {a['outcome']}"
            gap = "  [known code gap]" if a["code_gap"] else ""
            print(
                f"  {a['code']}: expected {a['expected_verdict']}, got {a['verdict']}"
                f" ({a['result']}; readings {a['assessor_result']} / {a['reviewer_result']})"
                f"{mark}{gap}",
                file=out,
            )
    totals = report["totals"]
    print("", file=out)
    print(f"Models: {', '.join(report['models'])}; prompts: {report['prompt_versions']}", file=out)
    for key in (
        "false_supported", "false_implementation", "false_partly_supported", "shows_mismatch",
        "false_issue", "missed_issue", "issue_wrong_result", "unsettled", "unsettled_rate",
        "unsettled_not_acceptable", "agreement_rate", "silently_skipped", "correct",
        "attributes_scored", "input_tokens", "output_tokens", "cost_usd", "cost_per_file_usd",
    ):  # fmt: skip
        print(f"{key}: {totals[key]}", file=out)
    if report["stopped"]:
        print(report["stopped"], file=out)


# --- Dry run -------------------------------------------------------------------------


def dry_run(cases: Sequence[EvalCase], settings: Settings, out: TextIO) -> dict[str, Any]:
    """Each case's prompt sizes and the estimated cost from the configured prices. No
    model is called and nothing is written."""
    limits = Limits.of(settings)
    rows: list[dict[str, Any]] = []
    for case in cases:
        chain = chain_of(case)
        setup = setup_for(case, settings)
        roles: dict[str, dict[str, Any]] = {}
        for role in ROLES:
            system, prompt = prompt_for(chain, role)
            request = request_for(system, prompt)
            tokens = estimate_tokens(system) + estimate_tokens(prompt)
            roles[role] = {
                "characters": len(system) + len(prompt),
                "input_tokens_estimate": tokens,
                "input_cost_micros": cost_micros(setup.config, tokens, 0),
                "worst_case_micros": estimate_micros(setup.config, request),
            }
        refusal = _refusal([r["worst_case_micros"] for r in roles.values()], limits)
        rows.append({
            "name": case.name,
            "model": setup.config.model_name,
            "tier": setup.tier,
            "files": len(chain.files),
            "read_in_part": chain.read_in_part,
            "roles": roles,
            "refused": refusal,
        })  # fmt: skip
        total_chars = sum(r["characters"] for r in roles.values())
        print(
            f"{case.name}: {len(chain.files)} file(s), {total_chars:,} characters for both "
            f"readings, about {sum(r['input_tokens_estimate'] for r in roles.values()):,} "
            f"input tokens, input ${sum(r['input_cost_micros'] for r in roles.values()) / 1e6:.4f}, "  # noqa: E501
            f"worst case ${sum(r['worst_case_micros'] for r in roles.values()) / 1e6:.4f}"
            + (f" [the database run would refuse: {refusal}]" if refusal else ""),
            file=out,
        )
    tokens = sum(r["input_tokens_estimate"] for row in rows for r in row["roles"].values())
    inputs = sum(r["input_cost_micros"] for row in rows for r in row["roles"].values())
    worst = sum(r["worst_case_micros"] for row in rows for r in row["roles"].values())
    calls = 2 * len(rows)
    models = sorted({row["model"] for row in rows})
    summary = {
        "cases": len(rows),
        "calls": calls,
        "input_tokens_estimate": tokens,
        "max_output_tokens": calls * MAX_TOKENS,
        "input_cost_usd": round(inputs / 1e6, 4),
        "worst_case_cost_usd": round(worst / 1e6, 4),
        "models": models,
        "live_model_configured": live_model(settings),
        "rows": rows,
    }
    print("", file=out)
    print(
        f"Estimated for one full live run: {len(rows)} cases, {calls} calls on "
        f"{', '.join(models)}; about {tokens:,} input tokens (${inputs / 1e6:.2f}) and at most "
        f"{calls * MAX_TOKENS:,} output tokens; worst case ${worst / 1e6:.2f}. "
        f"Prompts: {PROMPT_VERSIONS['ASSESSOR']}, {PROMPT_VERSIONS['REVIEWER']}.",
        file=out,
    )
    if not live_model(settings):
        print("No live model is configured: a live run would be refused.", file=out)
    return summary


# --- Command -------------------------------------------------------------------------


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m evals.assurance.score",
        description=(
            "Score the evidence assurance chain against the evaluation set. A live run "
            "costs money and needs the product owner's approval."
        ),
    )
    parser.add_argument("--case", action="append", default=[], help="a case to run (repeatable)")
    parser.add_argument(
        "--max-cost-usd", type=float, default=None, help="the most a live run may spend"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="print prompt sizes and the estimate; call nothing"
    )
    parser.add_argument("--cases-dir", type=Path, default=CASES_DIR, help=argparse.SUPPRESS)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    settings: Settings | None = None,
    provider: ModelProvider | None = None,
    out: TextIO | None = None,
    results_dir: Path = RESULTS_DIR,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """The command. `provider` and `settings` are for the fast test's scripted runs; the
    command itself builds the configured live provider."""
    stream = out if out is not None else sys.stdout
    args = _parser().parse_args(argv)
    chosen = settings if settings is not None else Settings()
    try:
        cases = load_cases(args.cases_dir, args.case)
    except ValueError as error:
        print(f"Cannot load the cases: {error}", file=stream)
        return 2
    if args.dry_run:
        dry_run(cases, chosen, stream)
        return 0
    if args.max_cost_usd is None or args.max_cost_usd <= 0:
        print(
            "Refusing to call the model: give --max-cost-usd (a live run costs money and "
            "needs the product owner's approval). Use --dry-run for the estimate.",
            file=stream,
        )
        return 2
    mode = "scripted"
    if provider is None:
        if not live_model(chosen):
            print(
                "Refusing to call the model: no live model is configured "
                "(MODEL_PROVIDER=anthropic and MODEL_API_KEY).",
                file=stream,
            )
            return 2
        provider = provider_for(chosen)
        mode = "live"
    budget = Budget(round(args.max_cost_usd * 1e6))
    records, stopped = run_cases(cases, provider, chosen, budget, sleep)
    report = report_of(records, stopped, mode, budget)
    path = write_report(report, results_dir)
    print_report(report, stream)
    print(f"Results: {path}", file=stream)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
