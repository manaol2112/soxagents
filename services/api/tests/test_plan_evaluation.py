"""Milestone 3d closure: the M3c scenario set judged by its approved evidence plan
(evaluation m3c-plan/1, corpus_m3c_plan.py), beside the unchanged historical one.

The conflicts are not asserted from memory: the plan is read from the engagement the M3c
set runs in, and every conflicting attribute must have each named REQUIRED item with no
sample holding a document of that kind; every other attribute's REQUIRED evidence must be
in the samples (for the system record of the grant, the population row)."""

from pathlib import Path
from uuid import UUID

from corpus_m3c import AC, CM
from corpus_m3c_plan import CONFLICTS, EVALUATION, changed, plan_consistent, rescore
from support import Database
from test_grounded_testing import grounded_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.testing_engine import plan_evidence

__all__ = ["migrated"]

# The kinds of document each conflicting requirement is, as a file of the set would be named.
_NAMED = {
    "Application owner list": ("owner list", "owner register", "asset register"),
    "Manager relationship for each selected user": ("hr ", "manager of record", "org chart"),
    "Business owners and IT approvers by system": ("owners by system", "owner register"),
}
# The detail each conflicting requirement asks of every selected sample (the library's
# wording), as the one lean sample item carries it.
_DETAIL = {
    "Application owner list": "Designated owner",
    "Manager relationship for each selected user": "Manager of record",
    "Business owners and IT approvers by system": "IT approver or board",
}


def test_the_plan_evaluation_changes_only_the_conflicting_cells(tmp_path: Path) -> None:
    from corpus_m3c import build

    manifest = build(tmp_path)
    before = [
        (r, s.key, c.attribute, c.expected, list(c.acceptable)) for r, s, c in manifest.cells()
    ]
    judged = plan_consistent(manifest)
    after = [
        (r, s.key, c.attribute, c.expected, list(c.acceptable)) for r, s, c in manifest.cells()
    ]
    assert before == after, "the historical expectations are never changed"
    found = changed(manifest)
    assert len(found) == 11
    assert {(c["control"], c["attribute"]) for c in found} == {(AC, 1), (CM, 3)}
    assert all(c["historical"]["expected"] == "PASS" for c in found)
    assert all(c["plan_consistent"]["expected"] == "UNABLE" for c in found)
    assert all("PASS" not in c["plan_consistent"]["acceptable"] for c in found)
    negatives = [c for _r, _s, c in judged.cells() if c.category == "negative"]
    assert len(negatives) == 31 and all("PASS" not in c.acceptable for c in negatives)
    # A recorded answer scores on both, side by side.
    cells = [{"control": r, "sample": s.key, "attribute": c.attribute, "proposed": "PASS"}
             for r, s, c in manifest.cells()]  # fmt: skip
    scored = rescore(cells, manifest)
    assert scored["historical"]["false_pass"] == {"count": 20, "of": 20}
    assert scored[EVALUATION]["false_pass"] == {"count": 31, "of": 31}


def test_the_conflicts_are_the_approved_plans_required_evidence_not_in_the_samples(
    migrated: Database, tmp_path: Path
) -> None:
    _team, _client, _scheduler, manifest, sheets = grounded_engagement(
        migrated, "plan-evaluation", tmp_path
    )
    with connect(migrated.url) as connection:
        plans = {}
        for ref, sheet in sheets.items():
            control = connection.execute(
                "SELECT engagement_control_id FROM test_sheets WHERE id = %s", (sheet["id"],)
            ).fetchone()
            assert control is not None
            attributes = tuple(sheet["attributes"])
            plans[ref] = plan_evidence(
                connection, UUID(sheet["id"]), UUID(str(control[0])), attributes
            )
    controls = {c.control_ref: c for c in manifest.controls}
    # Lean (27 October 2026): a selected sample's evidence is one REQUIRED item listing every
    # detail it must show; each conflicting requirement is a detail of it, still required
    # for the attribute, and still in none of the samples' files.
    for conflict in CONFLICTS:
        required = " ".join(
            item["what_counts"]
            for item in plans[conflict.control_ref][conflict.attribute]
            if item["necessity"] == "REQUIRED"
        )
        names = [Path(f.path).name.lower() for s in controls[conflict.control_ref].samples
                 for f in s.files]  # fmt: skip
        for title in conflict.required:
            assert _DETAIL[title] in required, (conflict, required)
            assert not any(kind in name for kind in _NAMED[title] for name in names), title
    # The system record of the grant is REQUIRED for AC-01 C, D and E: the population the
    # plan defines as the system's own records is what each sample's row comes from.
    for attribute in (2, 3, 4):
        counts = " ".join(
            item["what_counts"] for item in plans[AC][attribute] if item["necessity"] == "REQUIRED"
        )
        assert "Grant date and time" in counts
    assert controls[AC].population.path.endswith("population listing.csv")
