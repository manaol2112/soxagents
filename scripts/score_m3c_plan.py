"""Write the M3c scenario set's plan-consistent evaluation (m3c-plan/1) and rescore the
recorded live tester runs against it, beside the historical expectations (Milestone 3d
closure). Reads only the committed scorecards; calls no model.

    uv run --package ai-workforce-api python scripts/score_m3c_plan.py docs/review/m3d
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api" / "tests"))

from corpus_m3c import build  # noqa: E402
from corpus_m3c_plan import CONFLICTS, EVALUATION, changed, rescore  # noqa: E402

RUNS = (
    ("M3c run 1 (control-tester/2)", "docs/review/m3c/live-tester-run1.json"),
    ("M3c run 2 (control-tester/2)", "docs/review/m3c/live-tester-run2.json"),
    ("M3c closure (control-tester/3)", "docs/review/m3c/live-tester-closure.json"),
    ("M3d first round (control-tester/4)", "docs/review/m3d/live-tester-m3d.json"),
    ("M3d final round (control-tester/5)", "docs/review/m3d/live-tester-m3d-final.json"),
)


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/review/m3d")
    manifest = build(Path(tempfile.mkdtemp()))
    body = {
        "evaluation": EVALUATION,
        "conflicts": [
            {"control": c.control_ref, "attribute": c.attribute, "required": list(c.required),
             "why": c.why}
            for c in CONFLICTS
        ],
        "changed_cells": changed(manifest),
        "runs": [
            {"run": label, "scorecard": path,
             **rescore(json.loads((ROOT / path).read_text(encoding="utf-8"))["cells"], manifest)}
            for label, path in RUNS
        ],
    }  # fmt: skip
    out = target / "m3c-plan-evaluation.json"
    out.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(body['changed_cells'])} changed cells, {len(RUNS)} runs")


if __name__ == "__main__":
    main()
