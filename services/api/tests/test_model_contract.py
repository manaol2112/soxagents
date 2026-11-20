"""Every model entry point fails closed against the hostile model (docs/audit-invariants.md,
I10; docs/engineering-standards.md section 11). Pure: no database.

The contract is one registry: every place the product asks a model (each `ModelRequest(`,
`generate_read(`, `.chat(`, `.converse(` and `.converse_streaming(` call, found by reading the
code, keyed by module and enclosing function) is an entry point, or exempt with its reason.
Each entry point classifies every hostile behaviour (hostile_model.Behaviour) as one of:

- CHECKED: a test shows it fails closed today, here (`test_an_entry_point_fails_closed`) or
  in a critical-tier test named as its holder;
- OPEN: it fails open today; the cell names its defect, whose row in
  docs/audit-invariants.md names the increment that fixes it (no xfail: owner, 19 November
  2026; the fixing increment moves the cell to CHECKED in the same commit);
- NOT_APPLICABLE, with the reason;
- UNMEASURED, with the increment that measures it (an entry point another increment is
  changing now carries no CHECKED cell, so this file never pins what it is fixing).

Each CHECKED cell here is shown not to pass vacuously: the hostile answer fits the entry's
schema (`test_the_hostile_answer_fits_each_schema`, through models.outcome as production
reads it), the model was asked exactly as often as expected with nothing unscripted
(conftest.nothing_unscripted_was_asked), and the paired control, the same adapter with the
one perturbation removed, gives the favourable state.
"""

from __future__ import annotations

import ast
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from hostile_model import CAREFUL, INVENTED, LISTING, TRANSIENT, Behaviour, HostileModel
from test_audit_invariants import increment_known, node_problem, open_parts
from test_evidence_analysis import _png
from test_evidence_assurance import F0, F1, _chain, _file
from test_evidence_reading import _classify_context
from test_understanding_review_rules import PARENTS, UNITS, _question

import ai_workforce_api
from ai_workforce_api import control_reviews, testing_engine, understanding_review
from ai_workforce_api.evidence_assurance import ChainResult, reading_request, run_chain
from ai_workforce_api.evidence_classify import (
    CLASSIFY_SCHEMA,
    ClassifyContext,
    RequestedItem,
    check_classification,
)
from ai_workforce_api.evidence_classify import SYSTEM_PROMPT as READER_SYSTEM
from ai_workforce_api.evidence_mapping import MAPPING_SCHEMA, Candidate, check_answer
from ai_workforce_api.evidence_mapping import SYSTEM_PROMPT as MAPPING_SYSTEM
from ai_workforce_api.evidence_ocr import ModelVisionOcr, OcrFailed
from ai_workforce_api.evidence_review import ReviewContext, proposed, run_review
from ai_workforce_api.model_providers import CLAUDE_CONFIG
from ai_workforce_api.models import ModelRaw, ModelRequest, Outcome, outcome
from ai_workforce_api.testing_checks import instruction_guard
from ai_workforce_api.testing_engine import (
    TEST_SCHEMA,
    ItemContext,
    ItemFile,
    check_results,
    prompt_for,
    supported,
)

B = Behaviour
API = Path(ai_workforce_api.__file__).parent
T = "services/api/tests/"
HERE = f"{T}test_model_contract.py::test_an_entry_point_fails_closed"


# --- The registry ------------------------------------------------------------------------


@dataclass(frozen=True)
class Checked:
    holder: str  # the critical-tier test (path::name) that shows it fails closed


@dataclass(frozen=True)
class Open:
    defect: str  # a row of docs/audit-invariants.md's open table, which names the increment


@dataclass(frozen=True)
class NotApplicable:
    reason: str


@dataclass(frozen=True)
class Unmeasured:
    increment: str


Cell = Checked | Open | NotApplicable | Unmeasured


@dataclass(frozen=True)
class Entry:
    row: int  # the design note's contract row
    name: str
    cells: Mapping[Behaviour, Cell]


def cells(*groups: tuple[Cell, Sequence[Behaviour]]) -> dict[Behaviour, Cell]:
    """Each behaviour's cell, every behaviour once: a behaviour given twice fails here, and
    one left out fails `test_every_model_entry_point_is_in_the_contract`."""
    found: dict[Behaviour, Cell] = {}
    for cell, behaviours in groups:
        for behaviour in behaviours:
            assert behaviour not in found, f"{behaviour} is classified twice"
            found[behaviour] = cell
    return found


def rest(cell: Cell, *given: tuple[Cell, Sequence[Behaviour]]) -> dict[Behaviour, Cell]:
    """The given cells, and `cell` for every behaviour they do not name."""
    named = {behaviour for _cell, behaviours in given for behaviour in behaviours}
    return cells(*given, (cell, tuple(b for b in Behaviour if b not in named)))


ALL: tuple[Behaviour, ...] = tuple(Behaviour)
LAYER_CUT = NotApplicable(
    "the model layer reads a cut-off answer as MALFORMED with no output (row 15) before this "
    "entry reads anything; its MALFORMED cell holds what follows"
)
TRANSIENT_CELLS = Unmeasured("unassigned: owner decision on transient-failure cells")
NOBODY = Unmeasured("unassigned: owner decision on entry points no increment measures")
NO_BOX = NotApplicable("its schema carries no box; a quote the text lacks is INVENT_FIGURE")
NO_KEYS = NotApplicable("it reads images whole: no keys, quotes, rows or comparisons")
SOL = Unmeasured("SOL attributes")
SCOPE = Unmeasured("scope integrity")
E3 = Unmeasured("E3 readings")
QUESTIONS = Unmeasured("question fixes A")
SIGN_OFF = Unmeasured("D&I sign-off")

ENTRY_POINTS: dict[str, Entry] = {
    "testing_engine:_test_item": Entry(1, "OE tester", cells(
        (Checked(HERE), (B.EMPTY, B.PARTIAL, B.UNKNOWN_IDS, B.MALFORMED)),
        (Checked(f"{T}test_agent_execution.py::test_a_provider_failure_leaves_failed_items_"
                 "for_a_person_never_a_rules_result"), (B.PROVIDER_ERROR,)),
        (Open("FP-1"), (B.OMIT_COMPARISONS,)), (Open("MC-1"), (B.WRONG_ROW,)),
        (Open("FP-2"), (B.NEGATED,)), (Open("UC-1"), (B.BOX_ONLY,)),
        (Open("UC-2"), (B.INVENT_FIGURE,)), (Open("INJ-1"), (B.OBEDIENT_OTHER_LINE,)),
        (LAYER_CUT, (B.CUT_OFF,)), (Unmeasured("OE pass rules"), (B.MALFORMED_TWICE,)),
        (TRANSIENT_CELLS, (B.TIMEOUT, B.RATE_LIMITED, B.CANCELLED)),
    )),
    "control_reviews:run_reperformance": Entry(2, "OE re-performer", rest(
        Open("FO-1"),
        (Checked(HERE), (B.INVENT_FIGURE,)),
        (Open("UH-4"), (B.PARTIAL,)), (Open("FP-2"), (B.NEGATED,)), (Open("UC-1"), (B.BOX_ONLY,)),
        (Open("MC-1"), (B.WRONG_ROW,)), (Open("FP-1"), (B.OMIT_COMPARISONS,)),
        (Open("INJ-1"), (B.OBEDIENT_OTHER_LINE,)),
    )),
    "evidence_assurance:reading_request": Entry(3, "D&I readings", cells(
        (Checked(HERE), (B.EMPTY, B.PARTIAL, B.UNKNOWN_IDS, B.NEGATED, B.WRONG_ROW,
                         B.INVENT_FIGURE, B.MALFORMED)),
        (Checked(f"{T}test_evidence_assurance.py::test_a_reading_cut_off_at_its_allowance_is_"
                 "asked_once_more_with_more_room"), (B.CUT_OFF,)),
        (Open("FP-1"), (B.OMIT_COMPARISONS,)), (Open("INJ-1-DI"), (B.OBEDIENT_OTHER_LINE,)),
        (NO_BOX, (B.BOX_ONLY,)), (E3, (B.MALFORMED_TWICE,)),
        (TRANSIENT_CELLS, TRANSIENT),
    )),
    "evidence_mapping:run_mapping": Entry(4, "Evidence mapping", cells(
        (Checked(HERE), (B.EMPTY,)),
        (Checked(f"{T}test_evidence_corpus.py::test_an_unsuccessful_call_is_an_execution_"
                 "failure_never_an_evidence_status"),
         (B.MALFORMED, B.CUT_OFF, B.TIMEOUT, B.PROVIDER_ERROR)),
        (Open("FP-2"), (B.NEGATED,)), (Open("MC-1"), (B.WRONG_ROW,)),
        (NO_BOX, (B.BOX_ONLY,)),
        (NotApplicable("one attribute per call, so there is no half to leave out"), (B.PARTIAL,)),
        (NotApplicable("the mapping makes no comparison"), (B.OMIT_COMPARISONS,)),
        (E3, (B.UNKNOWN_IDS, B.INVENT_FIGURE, B.MALFORMED_TWICE,
                                     B.OBEDIENT_OTHER_LINE)),
        (TRANSIENT_CELLS, (B.RATE_LIMITED, B.CANCELLED)),
    )),
    "evidence_analysis:run_analysis": Entry(5, "Evidence reader", cells(
        (Checked(HERE), (B.EMPTY, B.UNKNOWN_IDS)),
        # A rejected answer falls back to the rules, which read headers alone as COVERED
        # (evidence_classify._rules_items), so the cell is open until E3 readings fixes FO-23.
        (Open("FO-23"), (B.MALFORMED,)),
        (Open("UC-3"), (B.INVENT_FIGURE,)), (Open("ST-6"), (B.PARTIAL,)),
        (NO_BOX, (B.BOX_ONLY,)), (LAYER_CUT, (B.CUT_OFF,)),
        (NotApplicable("the reader makes no comparison"), (B.OMIT_COMPARISONS,)),
        (E3, (B.WRONG_ROW, B.NEGATED, B.MALFORMED_TWICE,
                                     B.OBEDIENT_OTHER_LINE)),
        (TRANSIENT_CELLS, TRANSIENT),
    )),
    "evidence_review:run_review": Entry(6, "Screenshot first-pass review", rest(
        Unmeasured("OE pass rules"),
        (Checked(HERE), (B.EMPTY, B.MALFORMED)),
        (Open("FO-22"), (B.OMIT_COMPARISONS,)), (LAYER_CUT, (B.CUT_OFF,)),
        (TRANSIENT_CELLS, TRANSIENT),
    )),
    "evidence_ocr:ModelVisionOcr.read": Entry(7, "Model OCR", cells(
        (Checked(HERE), (B.MALFORMED, *TRANSIENT)),
        (Open("FF-1"), (B.EMPTY, B.PARTIAL)),
        (NO_KEYS, (B.UNKNOWN_IDS, B.OMIT_COMPARISONS, B.WRONG_ROW, B.NEGATED, B.BOX_ONLY,
                   B.OBEDIENT_OTHER_LINE)),
        (NotApplicable("asked once through models.complete, never corrected: one malformed "
                       "answer is the MALFORMED cell"), (B.MALFORMED_TWICE,)),
        (LAYER_CUT, (B.CUT_OFF,)), (E3, (B.INVENT_FIGURE,)),
    )),
    "workpaper_service:_draft_once": Entry(8, "Workpaper draft", rest(
        Unmeasured("D&I sign-off"),
        (Open("HX-1"), (B.EMPTY,)), (Open("UC-4"), (B.INVENT_FIGURE,)),
    )),
    "control_attributes:generate": Entry(9, "Attribute agent", rest(
        SOL,
        (Open("SOL-2"), (B.INVENT_FIGURE,)), (Open("FO-5"), (B.EMPTY,)),
        (Open("FO-4"), (B.MALFORMED, B.MALFORMED_TWICE)),
    )),
    "control_attributes:_review": Entry(10, "Drafts reviewer", rest(
        SOL,
        (Open("FO-3"), (B.EMPTY, B.PARTIAL, B.UNKNOWN_IDS)),
        (Open("FO-4"), (B.MALFORMED, B.MALFORMED_TWICE)),
    )),
    "attribute_review:review_set": Entry(11, "Set reviewer", rest(
        SOL,
        (Open("SOL-4"), (B.EMPTY, B.PARTIAL, B.UNKNOWN_IDS)),
        (Open("FO-4"), (B.MALFORMED, B.MALFORMED_TWICE)),
    )),
    "understanding_review:perform": Entry(12, "Understanding specialist", rest(
        SOL,
        (Checked(HERE), (B.EMPTY, B.UNKNOWN_IDS, B.INVENT_FIGURE, B.MALFORMED)),
        (Checked(f"{T}test_understanding_review_rules.py::test_a_skipped_attribute_is_corrected_"
                 "once_then_marked_not_reviewed_never_invented"), (B.PARTIAL,)),
    )),
    "evidence_plans:plan_for": Entry(13, "Planner", rest(
        SOL,
        (Checked(f"{T}test_evidence_plans.py::test_a_rejected_plan_is_corrected_by_the_planner"),
         (B.MALFORMED,)),
        (Checked(f"{T}test_agent_answers.py::test_a_part_that_fails_is_corrected_once_then_"
                 "said_in_plain_words_until_an_answer_is_used"), (B.MALFORMED_TWICE,)),
    )),
    "policy_evidence:judge": Entry(14, "Policy evidence", rest(
        NOBODY,
        (Checked(f"{T}test_model_contract_db.py::test_an_empty_policy_answer_proposes_nothing"),
         (B.EMPTY,)),
        (Open("FP-2"), (B.NEGATED,)),
    )),
    "models:outcome": Entry(15, "Model layer", cells(
        (Checked(HERE), (B.MALFORMED, B.CUT_OFF, *TRANSIENT)),
        (NotApplicable("the layer reads no answer's content: each entry's row holds it"),
         tuple(b for b in Behaviour if b not in (B.MALFORMED, B.CUT_OFF, *TRANSIENT))),
    )),
    "model_providers:AnthropicModelProvider.complete": Entry(15, "Provider adapter", rest(
        NotApplicable("the adapter hands over what the provider sent; row 15 classifies it"),
        (Checked(f"{T}test_evidence_corpus.py::test_a_cut_off_answer_from_the_provider_is_no_"
                 "answer"), (B.CUT_OFF,)),
    )),
    "process_narrative:_call": Entry(16, "Narrative review", rest(
        SOL, (Open("FO-25"), (B.EMPTY, B.PARTIAL)),
    )),
    "prior_year:analyse": Entry(17, "Prior-year analysis", rest(
        E3, (Open("FO-27"), (B.MALFORMED, B.PROVIDER_ERROR)),
    )),
    "prior_year:described_matches": Entry(17, "Prior-year matches", rest(E3)),
    "system_applicability:review": Entry(18, "SOC reading", rest(SCOPE)),
    "system_applicability:_read_reports": Entry(
        18, "SOC report reading", rest(SCOPE)
    ),
    "question_review:_ask_agent": Entry(19, "Question review", rest(QUESTIONS)),
    "rcm_systems:run_scan": Entry(19, "RCM systems scan", rest(SCOPE)),
    "rcm_terms:run_terms": Entry(19, "RCM terms", rest(SCOPE)),
    "pbc_drafting:run_draft": Entry(19, "Request drafting", rest(Unmeasured("request-draft fix"))),
    "control_challenges:challenges": Entry(19, "Control challenges", rest(NOBODY)),
    "process_understanding:build": Entry(19, "Process understanding", rest(NOBODY)),
    "understanding_chat:interpret": Entry(19, "Understanding chat", rest(NOBODY)),
    "understanding_chat:answers_from_text": Entry(19, "Answers from text", rest(NOBODY)),
    "system_suggestions:suggest": Entry(19, "System suggestions", rest(SCOPE)),
    "library_matching:run_match": Entry(19, "Library matching", rest(NOBODY)),
    "setup_drafting:run_draft": Entry(19, "Setup drafting", rest(NOBODY)),
    "workpaper_redraft:run_redraft": Entry(19, "Workpaper redraft", rest(SIGN_OFF)),
    "evidence_analysis:_match": Entry(19, "Evidence matching", rest(NOBODY)),
    "console:run_turn": Entry(19, "Console", rest(
        NOBODY,
        # A chat model's call of a tool that is not registered is refused, and a CONFIRM
        # tool it calls is only proposed, never run (console.py, _handle).
        (Checked(f"{T}test_console.py::test_routine_tools_run_and_sensitive_ones_wait_for_the_"
                 "person"), (B.UNKNOWN_IDS,)),
    )),
}  # fmt: skip
# Not an entry point, each with the reason.
EXEMPT: dict[str, str] = {
    "models:_create": "the /model-calls route returns a person's own call to that person; "
    "nothing it answers becomes a result, a status or a decision",
    "provenance:AgentCaller.chat": "the chat layer under console:run_turn, its only caller, "
    "whose row holds its cells",
}
# Rows that are layers every entry point goes through, not call sites.
LAYERS = frozenset({"models:outcome", "model_providers:AnthropicModelProvider.complete"})
_NAMES = frozenset({"ModelRequest", "generate_read"})
_ATTRIBUTES = frozenset({"ModelRequest", "generate_read", "chat", "converse", "converse_streaming"})


def model_sites(root: Path = API) -> dict[str, list[str]]:
    """Every call that asks a model, in every module of the package (subpackages too), by
    `module:enclosing qualname`, with where each is."""
    found: dict[str, list[str]] = {}
    for path in sorted(root.rglob("*.py")):
        module = path.relative_to(root).with_suffix("").as_posix().replace("/", ".")
        for scope, line in _calls(ast.parse(path.read_text(encoding="utf-8")), ()):
            found.setdefault(f"{module}:{'.'.join(scope)}", []).append(f"{path.name}:{line}")
    return found


def _calls(node: ast.AST, scope: tuple[str, ...]) -> list[tuple[tuple[str, ...], int]]:
    """Each model-asking call under `node`, with the qualname of the function it is in."""
    found: list[tuple[tuple[str, ...], int]] = []
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            found += _calls(child, (*scope, child.name))
            continue
        if isinstance(child, ast.Call) and (
            (isinstance(child.func, ast.Name) and child.func.id in _NAMES)
            or (isinstance(child.func, ast.Attribute) and child.func.attr in _ATTRIBUTES)
        ):
            found.append((scope, child.lineno))
        found += _calls(child, scope)
    return found


def _defined(key: str) -> bool:
    module, qualname = key.split(":", 1)
    tree = ast.parse((API / f"{module.replace('.', '/')}.py").read_text(encoding="utf-8"))
    nodes: Sequence[ast.stmt] = tree.body
    for part in qualname.split("."):
        found = next((n for n in nodes if isinstance(n, (ast.FunctionDef, ast.ClassDef))
                      and n.name == part), None)  # fmt: skip
        if found is None:
            return False
        nodes = found.body
    return True


def test_every_model_entry_point_is_in_the_contract() -> None:
    sites = model_sites()
    assert len(sites) >= 30, "the scan reads the package"
    unlisted = sorted(set(sites) - set(ENTRY_POINTS) - set(EXEMPT))
    assert unlisted == [], (
        "a new model call joins ENTRY_POINTS with a cell for every behaviour, or EXEMPT with "
        "its reason (docs/engineering-standards.md section 11): "
        f"{[(key, sites[key]) for key in unlisted]}"
    )
    stale = sorted((set(ENTRY_POINTS) - LAYERS - set(sites)) | (set(EXEMPT) - set(sites)))
    assert stale == [], f"listed, but no model call is there now: {stale}"
    assert all(_defined(layer) for layer in LAYERS)
    assert not set(EXEMPT) & set(ENTRY_POINTS)
    problems: list[str] = []
    parts = open_parts()
    for key, entry in ENTRY_POINTS.items():
        if set(entry.cells) != set(Behaviour):
            problems.append(f"{key}: no cell for {sorted(set(Behaviour) - set(entry.cells))}")
        for behaviour, cell in entry.cells.items():
            where = f"{key} {behaviour}"
            if isinstance(cell, Checked):
                if cell.holder == HERE:
                    if (key, behaviour) not in CASES:
                        problems.append(f"{where}: CHECKED here with no case")
                elif (problem := node_problem(cell.holder)) is not None:
                    problems.append(f"{where}: {problem}")
            elif isinstance(cell, Open) and cell.defect not in parts:
                problems.append(f"{where}: the defect {cell.defect} has no open row in the doc")
            elif isinstance(cell, Unmeasured) and not increment_known(cell.increment):
                problems.append(f"{where}: '{cell.increment}' is not a known increment")
            elif isinstance(cell, NotApplicable) and len(cell.reason) < 20:
                problems.append(f"{where}: not applicable needs its reason")
    here = {
        (k, b) for k, e in ENTRY_POINTS.items() for b, c in e.cells.items() if c == Checked(HERE)
    }
    problems += [
        f"{k} {b}: a case for a cell that is not CHECKED here" for k, b in set(CASES) - here
    ]
    assert problems == []


# --- The contract pack: each entry point's request, flow and fail-closed state -----------

FILE_ID = UUID(int=41)
ATTRIBUTES = ("The access request was approved before access was granted.",
              "The approver is the user's line manager.")  # fmt: skip
LISTED = (ItemFile("users.csv", "population", LISTING, None, FILE_ID),)


def _context() -> ItemContext:
    return ItemContext(
        control_ref="ITGC-AC-01", title="New user access is approved",
        activity="Managers approve access requests before access is granted.",
        frequency="Ad hoc", nature="Manual", period="ending 2026-12-31",
        attributes=ATTRIBUTES, item_label="u0001", item_detail=(("User ID", "u0001"),),
        test_of_one=False, files=LISTED,
    )  # fmt: skip


def _request(prompt: str, schema: dict[str, Any], system: str) -> ModelRequest:
    return ModelRequest(
        operation="generate", prompt=prompt, output_schema=schema, allowed_tool_ids=(),
        timeout_seconds=120, cancelled=False, system=system,
    )  # fmt: skip


def _asked(model: HostileModel, request: ModelRequest) -> Outcome:
    return outcome(model, request, CLAUDE_CONFIG)


@dataclass(frozen=True)
class Run:
    """What one entry point recorded, and the outcome of each model call it made."""

    state: Any
    statuses: tuple[str, ...]


def _tester(behaviour: Behaviour | None) -> Run:
    """testing_engine._test_item's reading: a result only from a SUCCEEDED call whose answer
    the checks keep; otherwise the item failed to test (execution failed, tested again)."""
    model = HostileModel(behaviour)
    request = _request(prompt_for(_context()), TEST_SCHEMA, testing_engine.SYSTEM_PROMPT)
    found = _asked(model, request)
    assert len(model.requests) == 1
    if found.status != "SUCCEEDED" or found.raw.output is None:
        return Run("FAILED", (found.status,))
    try:
        checked = check_results(found.raw.output, len(ATTRIBUTES), LISTED, (("User ID", "u0001"),))
    except ValueError:
        return Run("FAILED", (found.status,))
    return Run(tuple(r["result"] for r in supported(checked, LISTED)), (found.status,))


def _reperformer(behaviour: Behaviour | None) -> Run:
    """control_reviews.run_reperformance's reading of one item (endorsed over the checks)."""
    model = HostileModel(behaviour)
    prompt = prompt_for(_context()).replace(
        "Test this item against each attribute.",
        "Re-perform the test of this item against each attribute.", 1,
    )  # fmt: skip
    found = _asked(model, _request(prompt, control_reviews.REVIEW_SCHEMA,
                                   control_reviews.SYSTEM_PROMPT))  # fmt: skip
    assert len(model.requests) == 1 and found.status == "SUCCEEDED"
    assert found.raw.output is not None
    reviewed = control_reviews.endorsed(
        instruction_guard(
            check_results(found.raw.output, len(ATTRIBUTES), LISTED, (("User ID", "u0001"),)),
            {str(FILE_ID): LISTING},
        ),
        found.raw.output, LISTED,
    )  # fmt: skip
    return Run(tuple(r["result"] for r in reviewed), (found.status,))


DI_RECORD = "Access request REQ-1041 for DLEE: approved by the line manager on 2026-03-03\n"
DI_REFUSED = "Access request REQ-1042 for SRUIZ: not approved by the line manager\n"


def _readings(behaviour: Behaviour | None) -> tuple[ChainResult, tuple[str, ...]]:
    """Both D&I readings through run_chain, each asked as run_assessment asks it."""
    model = HostileModel(behaviour)
    chain = _chain(
        files=(_file(DI_RECORD, F0, "REQ-1041.txt"), _file(DI_REFUSED, F1, "REQ-1042.txt")),
        expected=(True, True),
    )
    statuses: list[str] = []

    def ask(role: str, system: str, prompt: str) -> dict[str, Any] | None:
        del role
        found = _asked(model, reading_request(system, prompt))
        statuses.append(found.status)
        return found.raw.output if found.status == "SUCCEEDED" else None

    return run_chain(ask, chain), tuple(statuses)


def _verdicts(behaviour: Behaviour | None) -> Run:
    result, statuses = _readings(behaviour)
    return Run(tuple(o.verdict for o in result.outcomes), statuses)


def _facts(behaviour: Behaviour | None) -> Run:
    result, statuses = _readings(behaviour)
    assert result.first is not None
    return Run(tuple(fact.value for fact in result.first.facts), statuses)


def _mapping(behaviour: Behaviour | None) -> Run:
    model = HostileModel(behaviour)
    found = _asked(model, _request("Map the evidence.", MAPPING_SCHEMA, MAPPING_SYSTEM))
    assert len(model.requests) == 1 and found.raw.output is not None
    candidate = Candidate(FILE_ID, "users.csv", "0" * 64, "population", "EXTRACTED", LISTING,
                          None, frozenset())  # fmt: skip
    return Run(check_answer(found.raw.output, [candidate]).status, (found.status,))


def _reader_context() -> ClassifyContext:
    return _classify_context(
        file_name="users.csv", file_kind="csv", text=LISTING,
        columns=("User ID", "Name", "Role", "Granted", "Approval"), rows=2,
        items=(RequestedItem("population", "Population of access granted", (), ""),),
    )  # fmt: skip


def _reader(behaviour: Behaviour | None) -> Run:
    model = HostileModel(behaviour)
    found = _asked(model, _request("Classify.", CLASSIFY_SCHEMA, READER_SYSTEM))
    assert len(model.requests) == 1 and found.raw.output is not None
    read = check_classification(found.raw.output, _reader_context())
    return Run(tuple(item.coverage for item in read.items), (found.status,))


def _screenshot(behaviour: Behaviour | None) -> Run:
    """evidence_review.run_review itself: its call, its checks and its fallback."""
    model = HostileModel(behaviour)
    context = ReviewContext("settings.png", "ITGC-AC-03", "Password settings",
                            "Passwords are at least 8 characters.", ("SAP ERP",),
                            "ending 2026-12-31", ("Minimum length is at least 8",),
                            ("Password settings",), "MinPasswordLength 8")  # fmt: skip
    statuses: list[str] = []

    def record(status: str, raw: ModelRaw) -> UUID:
        del raw
        statuses.append(status)
        return UUID(int=len(statuses))

    review, _call, _note = run_review(model, (_png("MinPasswordLength 8"),), context, record,
                                      lambda image: image)  # fmt: skip
    assert len(model.requests) == 1
    return Run("NO_REVIEW" if review is None else proposed(review), tuple(statuses))


def _ocr(behaviour: Behaviour | None) -> Run:
    """evidence_ocr.ModelVisionOcr.read itself."""
    model = HostileModel(behaviour)
    statuses: list[str] = []

    def record(status: str, raw: ModelRaw) -> UUID:
        del raw
        statuses.append(status)
        return UUID(int=1)

    try:
        read = ModelVisionOcr(model, record).read([_png("MinPasswordLength 8")])
    except OcrFailed:
        return Run("FAILED", tuple(statuses))
    assert len(model.requests) == 1
    return Run(read.texts, tuple(statuses))


def _specialist_answer(behaviour: Behaviour | None) -> dict[str, Any]:
    """The specialist's answer over the rules test's units: careful, A1 not established with
    the question it needs and A2 established on the walkthrough answer that establishes it
    (test_understanding_review_rules' own careful answer)."""
    careful: list[dict[str, Any]] = [
        {"attribute": "A1", "verdict": "NOT_ESTABLISHED", "rests_on": ["W1"],
         "question": _question()},
        {"attribute": "A2", "verdict": "ESTABLISHED", "rests_on": ["W1"]},
    ]  # fmt: skip
    verdicts = {
        CAREFUL: careful,
        B.EMPTY: [],
        B.UNKNOWN_IDS: [{**given, "attribute": f"Z{at}"} for at, given in enumerate(careful)],
        # A2 established on an answer the inputs do not give.
        B.INVENT_FIGURE: [careful[0], {**careful[1], "rests_on": ["W9"]}],
    }[behaviour]
    narrative = ("The questions answered establish how a patch is approved. They do not yet "
                 "establish who applies patches to production, on which A1 depends.")  # fmt: skip
    return {"narrative": narrative, "marked": [], "verdicts": verdicts, "follow_ups": []}


def _specialist(behaviour: Behaviour | None) -> Run:
    """understanding_review.check on the specialist's answer, first strict (a refused answer
    is corrected once), then as kept: the units it does not establish are not reviewed."""
    model = HostileModel(behaviour, adapters={
        understanding_review.SYSTEM_PROMPT: lambda b, _r: _specialist_answer(b),
    })  # fmt: skip
    found = _asked(model, _request("Review the questions asked.", understanding_review.SCHEMA,
                                   understanding_review.SYSTEM_PROMPT))  # fmt: skip
    assert len(model.requests) == 1
    if found.status != "SUCCEEDED" or found.raw.output is None:
        return Run("NOT_REVIEWED", (found.status,))
    answer = understanding_review.Answer.model_validate(found.raw.output)
    try:
        understanding_review.check(answer, UNITS, PARENTS, 1, strict=True)
        refused = False
    except ValueError:
        refused = True
    kept = understanding_review.check(answer, UNITS, PARENTS, 1, strict=False)
    return Run((refused, kept.not_reviewed), (found.status,))


_LAYER_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["answer"],
                 "properties": {"answer": {"type": "string"}}}  # fmt: skip


def _layer(behaviour: Behaviour | None) -> Run:
    model = HostileModel(behaviour, adapters={"layer": lambda _b, _r: {"answer": "ok"}})
    found = _asked(model, _request("Say ok.", _LAYER_SCHEMA, "layer"))
    assert len(model.requests) == 1
    return Run((found.status, found.transient, found.raw.output is None), (found.status,))


@dataclass(frozen=True)
class Case:
    """One CHECKED cell: the flow, the state it must record, and the paired control's."""

    flow: Callable[[Behaviour | None], Run]
    closed: Any
    favourable: Any
    asked: str = "SUCCEEDED"  # the outcome the hostile answer's call must have


PASSED = ("PASS", "PASS")
CASES: dict[tuple[str, Behaviour], Case] = {
    ("testing_engine:_test_item", B.EMPTY): Case(_tester, "FAILED", PASSED),
    ("testing_engine:_test_item", B.UNKNOWN_IDS): Case(_tester, "FAILED", PASSED),
    ("testing_engine:_test_item", B.PARTIAL): Case(_tester, ("PASS", "UNABLE"), PASSED),
    ("testing_engine:_test_item", B.MALFORMED): Case(_tester, "FAILED", PASSED, "MALFORMED"),
    ("control_reviews:run_reperformance", B.INVENT_FIGURE): Case(
        _reperformer, ("UNABLE", "UNABLE"), PASSED
    ),
    ("evidence_assurance:reading_request", B.EMPTY): Case(
        _verdicts, ("UNSETTLED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED")
    ),
    ("evidence_assurance:reading_request", B.PARTIAL): Case(
        _verdicts, ("SUPPORTED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED")
    ),
    ("evidence_assurance:reading_request", B.UNKNOWN_IDS): Case(
        _verdicts, ("UNSETTLED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED")
    ),
    ("evidence_assurance:reading_request", B.NEGATED): Case(
        _verdicts, ("UNSETTLED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED")
    ),
    ("evidence_assurance:reading_request", B.WRONG_ROW): Case(
        _verdicts, ("UNSETTLED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED")
    ),
    ("evidence_assurance:reading_request", B.INVENT_FIGURE): Case(_facts, (), ("2026-03-03",)),
    ("evidence_assurance:reading_request", B.MALFORMED): Case(
        _verdicts, ("UNSETTLED", "UNSETTLED"), ("SUPPORTED", "SUPPORTED"), "MALFORMED"
    ),
    ("evidence_mapping:run_mapping", B.EMPTY): Case(_mapping, "UNKNOWN", "POTENTIALLY_SUFFICIENT"),
    ("evidence_analysis:run_analysis", B.EMPTY): Case(_reader, ("NOT_COVERED",), ("COVERED",)),
    ("evidence_analysis:run_analysis", B.UNKNOWN_IDS): Case(
        _reader, ("NOT_COVERED",), ("COVERED",)
    ),
    ("evidence_review:run_review", B.EMPTY): Case(_screenshot, "CANNOT_CONCLUDE", "NO_EXCEPTION"),
    ("evidence_review:run_review", B.MALFORMED): Case(
        _screenshot, "NO_REVIEW", "NO_EXCEPTION", "MALFORMED"
    ),
    ("evidence_ocr:ModelVisionOcr.read", B.MALFORMED): Case(
        _ocr, "FAILED", ("MinPasswordLength 8",), "MALFORMED"
    ),
    **{
        ("evidence_ocr:ModelVisionOcr.read", failure): Case(
            _ocr, "FAILED", ("MinPasswordLength 8",), status
        )
        for failure, status in (
            (B.TIMEOUT, "TIMEOUT"),
            (B.RATE_LIMITED, "RATE_LIMITED"),
            (B.PROVIDER_ERROR, "MODEL_ERROR"),
            (B.CANCELLED, "CANCELLED"),
        )
    },  # fmt: skip
    ("understanding_review:perform", B.EMPTY): Case(_specialist, (True, ("A1", "A2")), (False, ())),
    ("understanding_review:perform", B.UNKNOWN_IDS): Case(
        _specialist, (True, ("A1", "A2")), (False, ())
    ),
    ("understanding_review:perform", B.INVENT_FIGURE): Case(
        _specialist, (True, ("A2",)), (False, ())
    ),
    ("understanding_review:perform", B.MALFORMED): Case(
        _specialist, "NOT_REVIEWED", (False, ()), "MALFORMED"
    ),
    ("models:outcome", B.MALFORMED): Case(
        _layer, ("MALFORMED", False, False), ("SUCCEEDED", False, False), "MALFORMED"
    ),
    ("models:outcome", B.CUT_OFF): Case(
        _layer, ("MALFORMED", False, True), ("SUCCEEDED", False, False), "MALFORMED"
    ),
    ("models:outcome", B.TIMEOUT): Case(
        _layer, ("TIMEOUT", True, True), ("SUCCEEDED", False, False), "TIMEOUT"
    ),
    ("models:outcome", B.RATE_LIMITED): Case(
        _layer, ("RATE_LIMITED", True, True), ("SUCCEEDED", False, False), "RATE_LIMITED"
    ),
    ("models:outcome", B.PROVIDER_ERROR): Case(
        _layer, ("MODEL_ERROR", False, True), ("SUCCEEDED", False, False), "MODEL_ERROR"
    ),
    ("models:outcome", B.CANCELLED): Case(
        _layer, ("CANCELLED", False, True), ("SUCCEEDED", False, False), "CANCELLED"
    ),
}


@pytest.mark.parametrize("key", sorted(CASES), ids=[f"{k}-{b}" for k, b in sorted(CASES)])
def test_an_entry_point_fails_closed(key: tuple[str, Behaviour]) -> None:
    case = CASES[key]
    hostile = case.flow(key[1])
    assert hostile.state == case.closed
    # The call itself was what the behaviour makes it: a hostile answer that fits its
    # schema, or the malformed or failed call it is.
    assert hostile.statuses and set(hostile.statuses) == {case.asked}
    # The paired control: the same adapter with the perturbation removed is favourable, so
    # the fail-closed state above comes from the perturbation, not a rejected answer.
    control = case.flow(CAREFUL)
    assert control.state == case.favourable
    assert set(control.statuses) == {"SUCCEEDED"}


def test_the_hostile_answer_fits_each_schema() -> None:
    """No CHECKED cell passes because its answer was rejected for its shape: every hostile
    answer of an answer behaviour is SUCCEEDED through models.outcome, as production reads
    it (unnest and lift included), and every MALFORMED one is MALFORMED."""
    shaped = {key: case for key, case in CASES.items() if key[1] not in (B.MALFORMED, *TRANSIENT)
              and key[0] != "models:outcome"}  # fmt: skip
    assert len(shaped) >= 15
    for key, case in shaped.items():
        if key[1] is B.CUT_OFF:
            continue
        assert set(case.flow(key[1]).statuses) == {"SUCCEEDED"}, key
    assert {case.asked for key, case in CASES.items() if key[1] is B.MALFORMED} == {"MALFORMED"}
    # The model layer refuses the generic malformed answer for every entry's schema.
    for schema in (TEST_SCHEMA, control_reviews.REVIEW_SCHEMA, MAPPING_SCHEMA, CLASSIFY_SCHEMA,
                   understanding_review.SCHEMA, _LAYER_SCHEMA):  # fmt: skip
        found = _asked(HostileModel(B.MALFORMED), _request("x", schema, "any"))
        assert found.status == "MALFORMED", schema.get("required")


def test_invented_values_are_in_no_file_of_the_pack() -> None:
    assert INVENTED not in LISTING + DI_RECORD + DI_REFUSED
    assert "2026-03-03" in DI_RECORD
