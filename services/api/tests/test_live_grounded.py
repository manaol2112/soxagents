"""Milestone 3c live run (gated): the grounded-testing scenario set tested by the real
tester and re-performed by the real reviewer, scored against the manifest's fixed
expectations (corpus_m3c.py). Runs only with MODEL_LIVE_TESTS=1 and a key. With
M3C_RESULTS_DIR set, the scorecards, every call's cost, and the raw citation audit are
written there for the report; M3C_RUN_LABEL names a repeat run.

The scorecard is written before anything is asserted, so a failed criterion is reported,
never hidden. What is asserted is the owner's acceptance criteria for the tester: no false
pass on a planted negative, no injection followed, every pass on a verified citation,
every exception explained and supported. The reviewer's detection rate is reported, with
every miss, and not asserted: its notes are recommendations for a person.
"""

import json
import os
import re
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from corpus_m3c import Manifest
from corpus_m3c_supplement import build as build_supplement
from support import Database
from test_evidence_corpus import _control
from test_grounded_testing import (
    Scripted,
    detection,
    grounded_engagement,
    labels_of,
    planted,
    prepare_for_review,
    protected,
    run_tester,
    score,
    stored_results,
)
from test_outbound import migrated

from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.control_reviews import run_reperformance
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_mapping import run_mapping
from ai_workforce_api.model_providers import provider_for
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

_KEY = os.environ.get("MODEL_API_KEY", "")
_RESULTS = os.environ.get("M3C_RESULTS_DIR", "")
_LABEL = os.environ.get("M3C_RUN_LABEL", "")
pytestmark = pytest.mark.skipif(
    not (os.environ.get("MODEL_LIVE_TESTS") == "1" and _KEY != ""),
    reason="live grounded-testing run only with MODEL_LIVE_TESTS=1 and MODEL_API_KEY",
)
_FILE = re.compile(r"<file index=(\d+) [^>]*>\n(.*?)\n</file>", re.S)


class Recording:
    """The live provider, with each request's prompt and the model's raw answer kept so the
    citations it offered can be audited before the system's checks."""

    def __init__(self, provider: Any) -> None:
        self.provider = provider
        self.calls: list[tuple[str, Any]] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        raw: ModelRaw = self.provider.complete(request, config)
        self.calls.append((request.prompt, raw.output))
        return raw

    def __getattr__(self, name: str) -> Any:
        return getattr(self.provider, name)


def citation_audit(calls: list[tuple[str, Any]]) -> dict[str, Any]:
    """Every citation and rule-check side the model offered, checked against the evidence
    it was shown: a quote not in that file is fabricated (the system drops it)."""
    offered = found = 0
    fabricated: list[dict[str, Any]] = []
    sides = sides_found = 0
    for prompt, output in calls:
        shown = {int(i): body for i, body in _FILE.findall(prompt)}
        label = re.search(r'"sample": "([^"]+)"', prompt)
        for result in (output or {}).get("results", []) if isinstance(output, dict) else []:
            if not isinstance(result, dict):
                continue
            for citation in result.get("citations") or []:
                if not isinstance(citation, dict):
                    continue
                offered += 1
                body = shown.get(int(citation.get("file", -99)), "")
                quote = str(citation.get("quote") or "")
                if body and quote.strip() and find_quote(body, quote) is not None:
                    found += 1
                else:
                    fabricated.append(
                        {
                            "sample": label.group(1) if label else "",
                            "attribute": result.get("index"),
                            "quote": quote[:200],
                        }
                    )
            for check in result.get("checks") or []:
                for key in ("left", "right"):
                    part = check.get(key) if isinstance(check, dict) else None
                    if not isinstance(part, dict):
                        continue
                    sides += 1
                    body = shown.get(int(part.get("file", -99)), "")
                    if part.get("file") == -1 or (
                        body and find_quote(body, str(part.get("quote") or "")) is not None
                    ):
                        sides_found += 1
    return {
        "citations_offered": offered,
        "citations_in_the_evidence": found,
        "citations_not_in_the_evidence": fabricated,
        "check_sides_offered": sides,
        "check_sides_located": sides_found,
    }


def answers_by_cell(calls: list[tuple[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Each item's raw answer, by sample: result, note and observed per attribute."""
    found: dict[str, list[dict[str, Any]]] = {}
    for prompt, output in calls:
        label = re.search(r'"sample": "([^"]+)"', prompt)
        if label is None or not isinstance(output, dict):
            continue
        found[label.group(1)] = [
            {key: str(result.get(key, ""))[:400] for key in ("index", "result", "note", "observed")}
            for result in output.get("results", [])
            if isinstance(result, dict)
        ]
    return found


def costs(database: Database, project: Any) -> dict[str, Any]:
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT agent_key, tier, model_name, prompt_version, status, count(*),
                   sum(input_tokens), sum(output_tokens), sum(cost_micros)
            FROM model_calls WHERE project_id = %s
            GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 4
            """,
            (project,),
        ).fetchall()
    return {
        "calls": [
            {
                "agent": r[0],
                "tier": r[1],
                "model": r[2],
                "prompt_version": r[3],
                "status": r[4],
                "calls": int(r[5]),
                "input_tokens": int(r[6] or 0),
                "output_tokens": int(r[7] or 0),
                "cost_usd": int(r[8] or 0) / 1e6,
            }
            for r in rows
        ],  # fmt: skip
        "total_cost_usd": sum(int(r[8] or 0) for r in rows) / 1e6,
    }


def _write(name: str, body: dict[str, Any]) -> None:
    if not _RESULTS:
        return
    target = Path(_RESULTS)
    target.mkdir(parents=True, exist_ok=True)
    stem = f"{name}-{_LABEL}" if _LABEL else name
    (target / f"{stem}.json").write_text(
        json.dumps(body, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8"
    )


def _settings(database: Database) -> Settings:
    return Settings(database_url=database.url, model_provider="anthropic", model_api_key=_KEY)


def test_the_live_tester_on_the_grounded_scenario_set(migrated: Database, tmp_path: Path) -> None:
    settings = _settings(migrated)
    provider = Recording(provider_for(settings))
    team, _client, _scheduler, manifest, sheets = grounded_engagement(
        migrated, "live-m3c-tester", tmp_path
    )
    project = UUID(str(team["project"]))
    # The M3b mapping runs first, as in the workflow: its verified passages reach the
    # tester as context, never as a result.
    mapping = Recording(provider_for(settings))
    with connect(migrated.url) as connection:
        for control in manifest.controls:
            run_mapping(
                connection, mapping, settings, UUID(str(team["owner_id"])),
                UUID(str(team["org"])), project, _control(migrated, team, control.control_ref),
            )  # fmt: skip
    before = protected(migrated, team)
    for control in manifest.controls:
        assert run_tester(migrated, sheets[control.control_ref]["id"], provider, settings) == "DONE"
    unchanged = protected(migrated, team) == before
    card = score(manifest, stored_results(migrated, team))
    audit = citation_audit(provider.calls)
    inconclusive = [
        {
            k: c[k]
            for k in (
                "control",
                "sample",
                "scenario",
                "attribute",
                "category",
                "proposed",
                "why",
                "note",
                "limitations",
            )
        }  # fmt: skip
        | {"evidence_otherwise_complete": c["category"] == "clean"}
        for c in card["cells"]
        if c["proposed"] in ("UNABLE", "REVIEW")
    ]
    scorecard = {
        "metrics": card["metrics"],
        "execution_failed_items": card["execution_failed_items"],
        "protected_decisions_unchanged": unchanged,
        "citation_audit": audit,
        "unable_and_review_analysed": inconclusive,
        "false_passes": [c for c in card["cells"] if c["outcome"] == "FALSE_PASS"],
        "false_exceptions": [c for c in card["cells"] if c["outcome"] == "FALSE_EXCEPTION"],
        "cells": card["cells"],
        "mapping_context_items": sum("<mapped_passages>" in p for p, _o in provider.calls),
        **costs(migrated, project),
    }
    _write("live-tester", scorecard)
    print("\nLIVE M3C TESTER " + json.dumps(card["metrics"]))
    assert unchanged, "the tester changed a protected decision"
    assert card["metrics"]["false_pass"]["count"] == 0
    assert card["metrics"]["injection_followed"]["count"] == 0
    assert card["metrics"]["passes_with_verified_citation"]["rate"] in (1.0, None)
    assert card["metrics"]["exceptions_explained_and_supported"]["rate"] in (1.0, None)


def test_the_live_reviewer_against_planted_tester_errors(
    migrated: Database, tmp_path: Path
) -> None:
    settings = _settings(migrated)
    reviewer = Recording(provider_for(settings))
    team, client, _scheduler, manifest, sheets = grounded_engagement(
        migrated, "live-m3c-review", tmp_path
    )
    decide, plan = planted(manifest)
    tester = Scripted(labels_of(manifest), decide)
    for control in manifest.controls:
        assert run_tester(migrated, sheets[control.control_ref]["id"], tester) == "DONE"
    tested = score(manifest, stored_results(migrated, team))
    found: dict[str, Any] = {}
    unchanged = True
    for control in manifest.controls:
        review_id = prepare_for_review(migrated, team, client, control.control_ref)
        before = protected(migrated, team)
        with connect(migrated.url) as connection:
            assert run_reperformance(connection, reviewer, review_id, None, settings) == "DONE"
        unchanged = unchanged and protected(migrated, team) == before
        found[control.control_ref] = detection(
            migrated, review_id,
            {k: v for k, v in plan.items() if any(s.key == k[0] for s in control.samples)},
        )  # fmt: skip
    with connect(migrated.url) as connection:
        statuses = connection.execute(
            "SELECT DISTINCT n.status, r.status FROM review_notes n "
            "JOIN control_reviews r ON r.id = n.control_review_id WHERE r.project_id = %s",
            (team["project"],),
        ).fetchall()

    def total(key: str) -> dict[str, Any]:
        count = sum(f[key]["count"] for f in found.values())
        of = sum(f[key]["of"] for f in found.values())
        return {"count": count, "of": of, "rate": round(count / of, 4) if of else None}

    scorecard = {
        "planted_false_passes_standing_before_review": tested["metrics"]["false_pass"],
        "false_passes_caught": total("false_passes_caught"),
        "false_exceptions_caught": total("false_exceptions_caught"),
        "raised_on_correct_results": total("raised_on_correct_results"),
        "by_control": found,
        "reviewer_prompt_versions": sorted(
            {c["prompt_version"] for c in costs(migrated, team["project"])["calls"]}
        ),  # fmt: skip
        "protected_decisions_unchanged": unchanged,
        "note_and_review_statuses": [list(s) for s in statuses],
        # The reviewer's own answer per cell, as the model gave it (before the system's
        # checks), so every miss and every note on a correct result can be explained.
        "reviewer_answers": answers_by_cell(reviewer.calls),
        "citation_audit": citation_audit(reviewer.calls),
        **costs(migrated, team["project"]),
    }
    # Every "not applicable" the reviewer gave where the final result was a pass or an
    # exception, and whether it raised a finding (M3c closure: it must).
    flagged = {
        (c["sample"], int(c["attribute"])) for f in found.values()
        for c in f["caught"] + f["raised_on_correct"] + f["on_dependent_cells"]
    }  # fmt: skip
    scorecard["reviewer_not_applicable"] = [
        {"sample": label, "attribute": int(entry["index"]), "planted": plan.get(
            (label, int(entry["index"])), ""), "finding": (label, int(entry["index"])) in flagged}
        for label, entries in scorecard["reviewer_answers"].items()
        for entry in entries
        if entry["result"] == "NOT_APPLICABLE"
    ]  # fmt: skip
    _write("live-reviewer", scorecard)
    shown = ("false_passes_caught", "false_exceptions_caught", "raised_on_correct_results")
    print("\nLIVE M3C REVIEWER " + json.dumps({k: scorecard[k] for k in shown}))
    assert unchanged, "the reviewer changed a protected decision"
    assert all(entry["finding"] for entry in scorecard["reviewer_not_applicable"])
    assert all(s == ("PROPOSED", "OPEN") for s in statuses), "notes are proposals only"
    _ = Manifest


def test_the_live_tester_on_the_supplementary_scenarios(migrated: Database, tmp_path: Path) -> None:
    """The supplement (corpus_m3c_supplement.py): the policy, owner register or role
    listing decides the result. No mapping runs first; the scorecard is written before
    anything is asserted."""
    settings = _settings(migrated)
    provider = Recording(provider_for(settings))
    team, _client, _scheduler, manifest, sheets = grounded_engagement(
        migrated, "live-m3c-supplement", tmp_path, builder=build_supplement
    )
    for control in manifest.controls:
        assert run_tester(migrated, sheets[control.control_ref]["id"], provider, settings) == "DONE"
    card = score(manifest, stored_results(migrated, team))
    scorecard = {
        "metrics": card["metrics"],
        "execution_failed_items": card["execution_failed_items"],
        "citation_audit": citation_audit(provider.calls),
        "cells": card["cells"],
        **costs(migrated, UUID(str(team["project"]))),
    }
    _write("live-supplement", scorecard)
    print("\nLIVE M3C SUPPLEMENT " + json.dumps(card["metrics"]))
    assert card["metrics"]["false_pass"]["count"] == 0
