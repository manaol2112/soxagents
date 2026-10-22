"""The M3c scenario set judged by its approved evidence plan: evaluation m3c-plan/1
(Milestone 3d closure).

The owner's decision on the M3d review: the approved test plan takes precedence over the
synthetic expected outcomes. Where an approved attribute requires evidence that is not
provided, the agent must not issue PASS unless the attribute permits other evidence that
demonstrably satisfies the same requirement. The plan is not changed to fit the corpus;
the M3c scenario set, its expected outcomes and its historical results are kept as they
are (corpus_m3c.py is not modified), and this separately versioned evaluation names the
cells whose historical expectation contradicts the plan, with the plan-consistent one.

How the conflicts were found: the engagement the M3c set runs in approves the library
plan for ITGC-AC-01 and ITGC-CM-01. For each attribute, every REQUIRED evidence item was
compared with the documents the samples hold (test_plan_evaluation.py derives the plan
from that engagement and checks this list against it):

- ITGC-AC-01 B ("approved by the user's manager and, where the policy requires it, by the
  application owner") requires the application owner list in force for the window, and
  the manager relationship from HR (or an organization chart dated in the window). No
  sample holds either: the ticket names its approvers and restates a line manager, which
  is the request tool's statement, not the owner designation or the HR record.
- ITGC-CM-01 D ("the business owner and the IT owner approved before deployment") requires
  the business owners and IT approvers by system. No sample holds them: the change record
  names each approval in its role.

Reviewed and unchanged:

- ITGC-AC-01 C, D and E require the system record of the grant. The approved population
  requirement defines the population as the system's own user or audit records, and each
  sample's population row holds the user, the role granted, the date and who granted it:
  the plan's own system record, given to the tester with the item. A PASS there is
  plan-consistent, and the historical PASS stands.
- Every other REQUIRED item (the request, the approval record, the change ticket, the
  deployment record, the test evidence) is in each sample.
- The M3c closure supplement (corpus_m3c_supplement.py) is not re-judged: its scenarios were
  built for the document they hold, and the attribute itself makes the policy decide when
  the owner's approval is needed (u0101).

What changes: a cell of a conflicting attribute whose historical expectation is PASS (a
clean cell) becomes a cell where PASS is wrong under the plan: expected UNABLE (the
REQUIRED evidence is not in the files), REVIEW also acceptable. A dependent cell of those
attributes loses PASS from its acceptable results. Negative cells are unchanged: the
exception they plant is shown by the evidence that is there.
"""

import copy
from dataclasses import dataclass
from typing import Any

from corpus_m3c import AC, CM, Cell, Manifest

EVALUATION = "m3c-plan/1"


@dataclass(frozen=True)
class Conflict:
    control_ref: str
    attribute: int
    # The plan's REQUIRED evidence for the attribute that no sample holds.
    required: tuple[str, ...]
    why: str


CONFLICTS: tuple[Conflict, ...] = (
    Conflict(
        AC,
        1,
        ("Application owner list", "Manager relationship for each selected user"),
        "The approved plan requires the application owner list in force for the window and "
        "the manager relationship from HR for this attribute; neither is in the evidence.",
    ),
    Conflict(
        CM,
        3,
        ("Business owners and IT approvers by system",),
        "The approved plan requires the business owners and IT approvers by system for this "
        "attribute; they are not in the evidence.",
    ),
)


def _conflict(control_ref: str, attribute: int) -> Conflict | None:
    return next(
        (c for c in CONFLICTS if (c.control_ref, c.attribute) == (control_ref, attribute)), None
    )


def plan_consistent(manifest: Manifest) -> Manifest:
    """A copy of the M3c manifest with the plan-consistent expectations; the original is
    not changed."""
    judged = copy.deepcopy(manifest)
    for control in judged.controls:
        for sample in control.samples:
            sample.cells = [_judged(control.control_ref, cell) for cell in sample.cells]
    return judged


def _judged(control_ref: str, cell: Cell) -> Cell:
    conflict = _conflict(control_ref, cell.attribute)
    if conflict is None or cell.category == "negative":
        return cell
    if cell.category == "clean":
        return Cell(cell.attribute, "negative", "UNABLE", ["REVIEW", "UNABLE"], conflict.why)
    remaining = [result for result in cell.acceptable if result != "PASS"] or ["UNABLE"]
    return Cell(cell.attribute, "dependent", remaining[0], remaining, f"{cell.why} {conflict.why}")


def changed(manifest: Manifest) -> list[dict[str, Any]]:
    """Each cell whose plan-consistent expectation differs from the historical one."""
    judged = plan_consistent(manifest)
    found: list[dict[str, Any]] = []
    for (ref, sample, before), (_r, _s, after) in zip(
        manifest.cells(), judged.cells(), strict=True
    ):
        if (before.expected, before.acceptable) != (after.expected, after.acceptable):
            found.append({
                "control": ref, "sample": sample.key, "attribute": before.attribute,
                "historical": {"category": before.category, "expected": before.expected,
                               "acceptable": before.acceptable},
                "plan_consistent": {"category": after.category, "expected": after.expected,
                                    "acceptable": after.acceptable},
                "why": after.why,
            })  # fmt: skip
    return found


def rescore(cells: list[dict[str, Any]], manifest: Manifest) -> dict[str, Any]:
    """A recorded run's proposed results (a scorecard's `cells`) scored against the
    historical and the plan-consistent expectations, side by side."""
    judged = {
        (ref, sample.key, cell.attribute): cell
        for ref, sample, cell in plan_consistent(manifest).cells()
    }
    historical = {(ref, sample.key, cell.attribute): cell for ref, sample, cell in manifest.cells()}

    def tally(expected: dict[tuple[str, str, int], Cell]) -> dict[str, Any]:
        false_pass = false_exception = inconclusive_clean = clean = negative = 0
        for entry in cells:
            key = (str(entry["control"]), str(entry["sample"]), int(str(entry["attribute"])))
            cell = expected[key]
            proposed = str(entry.get("proposed"))
            if cell.category == "negative":
                negative += 1
                false_pass += proposed == "PASS"
            elif cell.category == "clean":
                clean += 1
                false_exception += proposed == "EXCEPTION"
                inconclusive_clean += proposed in ("UNABLE", "REVIEW")
        return {
            "false_pass": {"count": false_pass, "of": negative},
            "false_exception": {"count": false_exception, "of": clean},
            "clean_inconclusive": {"count": inconclusive_clean, "of": clean},
        }

    return {"historical": tally(historical), EVALUATION: tally(judged)}
