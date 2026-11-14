"""The product owner's thirty-four cases of 14 November 2026 for engine 2 of the evidence
assurance chain (docs/evidence-assurance.md, section 10.8).

Each case is one pure test, numbered in a comment: synthetic files, the control's context,
what the two blind readings answer (as a competent or a mistaken model would), and what the
ENGINE then decides. No database, no model, no network, no client evidence: every name,
ticket and system below is invented.

The control is user access provisioning on Workday, tested at D&I on one walkthrough
instance: access is requested in a ticket, approved by the user's manager before it is
granted, and the access granted is the access approved. Its attributes:

- A: a request exists that names the user and the access asked for;
- B: the request was approved by the user's manager (a person owns its criteria: the
  `condition` is that the request carries an approval, and it passes when the approver is
  the user's manager by the record's own designation);
- C: the approval is dated on or before the access was granted;
- D: the access granted is the access that was approved.

What the cases hold the engine to is audit judgment: no false pass (two readings that
agree are not enough against the records), no false exception (evidence that is missing
is not a failure), the precise gap asked for once, the outcome that fits, and nothing
concluded for the person who decides.

Each case asserts what a senior IT auditor would require, never what the engine happened
to do. Written first against the engine as integrated, seven of these failed and were
fixed in the engine the same day: a user id after a time read as a time zone (cases 1, 2,
14, 23 and 28: the grant's time was dropped, and a late approval both readings called met
read as sufficient), an element resting partly on another application's log (case 13,
"the gap"), and an element left standing on the real half of a fabricated citation (case
22, "the gap").
"""

from dataclasses import replace
from datetime import date
from typing import Any
from uuid import UUID

from test_assurance_engine2 import _both, _fact, _said, _two
from test_evidence_assurance import F0, F1, A, B, C, _element, _facts, _file, _says

from ai_workforce_api.assurance_context import ControlContext, UnderstandingFact
from ai_workforce_api.assurance_review import LeftOut
from ai_workforce_api.evidence_assurance import (
    HELD_REASONS,
    NEITHER_COULD_TELL,
    POPULATION_CATEGORY,
    POPULATION_PURPOSE,
    UNCHECKED_EXCEPTION,
    UNSETTLED_TEXT,
    AttributeSpec,
    ChainInput,
    ChainResult,
    FileSpec,
    Outcome,
    check_opinion,
    compare,
    elements_of,
    gate,
    kind_unsure,
    lens_for,
    run_chain,
    run_gate,
)

Answer = dict[str, Any]
# An attribute's verdict, result and assessment.
Stand = tuple[str, str | None, str | None]

D = UUID(int=4)
F2 = UUID(int=12)

# --- The synthetic records of one access request ---------------------------------------

HEAD = (
    "Access request REQ-1041\n"
    "System: Workday\n"
    "Requested for: Jordan Reyes (JREYES)\n"
    "Requested by: Jordan Reyes on 2027-03-01\n"
)
NAMED = "Requested for: Jordan Reyes (JREYES)"
ACCESS = "Access requested: role HR_PARTNER_VIEW"
APPROVED = "Approved by: Dana Lee, manager of Jordan Reyes, on 2027-03-02 10:05"
LATE_APPROVED = "Approved by: Dana Lee, manager of Jordan Reyes, on 2027-03-04 09:15"
ANALYST_APPROVED = "Approved by: Sam Ortiz, service desk analyst, on 2027-03-02 10:05"
BARE_APPROVED = "Approved by: Sam Ortiz on 2027-03-02 10:05"
SELF_APPROVED = "Approved by: Jordan Reyes, the requester, on 2027-03-02 10:05"
LOG_HEAD = "Workday security audit log\nExtracted on 2027-03-10 from Workday production\n"
GRANTED = "2027-03-03 14:30 WD_SECURITY assigned role HR_PARTNER_VIEW to JREYES"
EARLY_GRANTED = "2027-03-01 08:45 WD_SECURITY assigned role HR_PARTNER_VIEW to JREYES"
ADMIN_GRANTED = "2027-03-03 14:30 WD_SECURITY assigned role HR_ADMIN to JREYES"
OTHER_GRANTED = "2027-03-03 14:30 WD_SECURITY assigned role HR_PARTNER_VIEW to MPATEL"
IN_ORDER_TEXT = "Approved 2 March 2027 10:05, performed 3 March 2027 14:30: in order."
LATE_TEXT = "Approved 4 March 2027 09:15, performed 3 March 2027 14:30: the approval is after."
POTENTIAL = "This is a potential exception for the auditor to investigate, not a conclusion."
NOTHING_MORE = "No further evidence is needed for this request."

CONTEXT = ControlContext(
    statement=(
        "Access to Workday is requested in a ticket, approved by the user's manager before "
        "it is granted, and the access granted is the access approved."
    ),
    risk="A user receives access that nobody with authority approved, or more than was approved.",
    control_type="PREVENTIVE",
    nature="MANUAL",
    frequency="EVENT_DRIVEN",
    performer="Workday Security",
    reviewer="The user's manager",
    owner="The IT security manager",
    system="Workday",
    period_from=date(2027, 1, 1),
    period_to=date(2027, 12, 31),
    understanding=(
        UnderstandingFact(
            "U1", "Who approves new access?", "The user's manager, in the request ticket.",
            confirmed_at="2027-02-01T10:00:00Z",
        ),
        UnderstandingFact(
            "U2", "Where is the grant recorded?",
            "Workday Security assigns the role from the approved ticket; the Workday "
            "security audit log records it.",
            confirmed_at="2027-02-01T10:05:00Z",
        ),
    ),
    request_title="Walkthrough instance: one access request from request to grant",
    request_description="The ticket and the Workday security audit log for one new user.",
)  # fmt: skip
MANAGER = {
    "condition": "The request carries an approval.",
    "pass_when": "The approver is the user's manager, by the record's own designation.",
    "exception_when": "No approval, or an approver who is not the user's manager.",
}
WORDING = {
    "A": "A request exists that names the user and the access asked for.",
    "B": "The request was approved by the user's manager.",
    "C": "The approval is dated on or before the access was granted.",
    "D": "The access granted is the access that was approved.",
}
IDS = {"A": A, "B": B, "C": C, "D": D}


def _ticket(approval: str | None = APPROVED, access: str = ACCESS, more: str = "") -> str:
    """The text of the request ticket: who asked for what, and the approval (if any)."""
    lines = [access, *([] if approval is None else [approval]), *([more] if more else [])]
    return HEAD + "".join(f"{line}\n" for line in lines)


def _log(granted: str = GRANTED) -> str:
    return f"{LOG_HEAD}{granted} (ticket REQ-1041)\n"


def _ticket_file(text: str | None = None) -> FileSpec:
    return _file(_ticket() if text is None else text, F0, "ticket REQ-1041.txt")


def _log_file(text: str | None = None) -> FileSpec:
    return _file(
        _log() if text is None else text, F1, "workday security log.txt", kind="change_history"
    )


def _control(*files: FileSpec, asked: str = "ABCD", **over: Any) -> ChainInput:
    """The chain for one request of the provisioning control: its four attributes (those
    in `asked` are the ones the request asks for), the files, and the control's context."""
    texts = WORDING | over.pop("texts", {})
    return ChainInput(
        control_ref="ITGC-AC-02",
        title="User access provisioning",
        activity=(
            "Access is requested in a ticket, approved by the user's manager before it is "
            "granted, and granted as approved."
        ),
        lens=over.pop("lens", "INSTANCE_RECORD"),
        attributes=tuple(
            AttributeSpec(
                id=IDS[code],
                code=code,
                text=texts[code],
                criteria=MANAGER if code == "B" else None,
                expected=code in asked,
            )
            for code in "ABCD"
        ),
        files=files,
        context=over.pop("context", CONTEXT),
        **over,
    )


def _shown(*quotes: tuple[int, str], key: str = "wording", basis: str = "RECORD") -> Answer:
    """An element a reading finds met, with the passages it quotes: (file index, words)."""
    return _element("MET", [(index, quote, basis) for index, quote in quotes], key=key)


def _lacks(absent: str, *quotes: tuple[int, str], key: str = "wording", reason: str = "") -> Answer:
    """An element a reading finds not shown: it names what would have to be there."""
    return _element(
        "NOT_MET", [(index, quote, "RECORD") for index, quote in quotes],
        absent=absent, reason=reason, key=key,
    )  # fmt: skip


def _deviates(*quotes: tuple[int, str], key: str = "wording", reason: str = "") -> Answer:
    """An element a reading finds not met on the record itself: nothing is named absent."""
    return _element(
        "NOT_MET", [(index, quote, "RECORD") for index, quote in quotes], reason=reason, key=key
    )


def _cannot_tell(reason: str, key: str = "wording") -> Answer:
    return _element("CANNOT_TELL", reason=reason, key=key)


def _reading(approved: str = APPROVED, granted: str = GRANTED, **over: Any) -> Answer:
    """What a reading answers when it finds every attribute shown by the ticket (file 0)
    and the record of the grant (file 1). `over` replaces an attribute's elements."""
    found: dict[str, Any] = {
        "A": _shown((0, NAMED), (0, ACCESS)),
        "B": [_shown((0, approved), key="condition"), _shown((0, approved), key="pass")],
        "C": _shown((0, approved), (1, granted)),
        "D": _shown((0, ACCESS), (1, granted)),
    }
    return _says(**(found | over))


def _times(approved: str = APPROVED, granted: str = GRANTED) -> list[Answer]:
    """The two times a reading states: F1, the approval's; F2, the grant's."""
    return [
        _fact("F1", "APPROVED_AT", approved[-16:], 0, approved),
        _fact("F2", "PERFORMED_AT", granted[:16], 1, granted),
    ]


# The comparison attribute C calls for: the approval is at or before the grant.
APPROVED_FIRST = {"attribute": "C", "element": "wording", "test": "NOT_AFTER", "left": "F1",
                  "right": "F2"}  # fmt: skip


def _ask(code: str, element: str, request: str, **over: Any) -> Answer:
    """A follow-up a reading proposes for one element."""
    return {
        "attribute": code, "element": element, "missing": "", "why": "", "request": request,
        "alternatives": "", "kind": "EVIDENCE", "priority": "MEDIUM", "may_be_in_files": False,
    } | over  # fmt: skip


def _by_code(result: ChainResult) -> dict[str, Outcome]:
    return {outcome.code: outcome for outcome in result.outcomes}


def _review(result: ChainResult) -> dict[str, Any]:
    assert result.failed is None and result.review is not None
    return result.review


def _stands(result: ChainResult) -> dict[str, Stand]:
    """Each attribute's verdict, result and assessment."""
    return {o.code: (o.verdict, o.result, o.assessment) for o in result.outcomes}


def _files_of(outcome: Outcome) -> set[UUID]:
    return {passage.file_id for passage in outcome.passages}


SUPPORTED: Stand = ("SUPPORTED", "MET", "SATISFIED")
OPEN: Stand = ("UNSETTLED", None, "INDETERMINATE")


# 1. Valid approval before provisioning.
def test_a_valid_approval_before_provisioning_is_supported_and_sufficient() -> None:
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1), "facts": _times(), "checks": [APPROVED_FIRST]}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    # This instance shows each attribute: implementation, not only design.
    assert {o.shows for o in result.outcomes} == {"IMPLEMENTATION"}
    timing = _by_code(result)["C"]
    assert timing.summary == "Both readings find this instance shows attribute C."
    # The order of the two dates is made in code and passes; the support is still the two
    # readings' own passages, from the ticket and from the log.
    assert [check.as_json() for check in timing.checks] == [
        {"element": "wording", "test": "NOT_AFTER", "status": "PASSED", "sentence": IN_ORDER_TEXT}
    ]
    assert {(p.file_id, p.quote) for p in timing.passages} == {(F0, APPROVED), (F1, GRANTED)}
    review = _review(result)
    assert review["overall"] == "SUFFICIENT"
    assert review["completeness"] == {"state": "COMPLETE", "reasons": []}
    assert review["follow_ups"] == [] and review["concerns"] == []
    # A comparison that passes supports nothing by itself: where the second reading does
    # not find C shown, the passing check does not make it supported.
    doubted = _reading(C=_cannot_tell("The log's entry could not be related to the ticket."))
    doubted |= {"files": _said(0, 1), "facts": _times(), "checks": [APPROVED_FIRST]}
    split = run_chain(_two(answer, doubted), chain)
    assert _stands(split)["C"] == OPEN and [c.status for c in _by_code(split)["C"].checks] == [
        "PASSED"
    ]
    assert _review(split)["overall"] != "SUFFICIENT"


# 2. Approval after provisioning.
def test_an_approval_after_provisioning_fails_the_check_in_code_and_is_a_potential_exception() -> (
    None
):
    chain = _control(_ticket_file(_ticket(LATE_APPROVED)), _log_file())
    # Both readings see it: C is not met, on the two records, and nothing is absent.
    answer = _reading(
        LATE_APPROVED, C=_deviates((0, LATE_APPROVED), (1, GRANTED), reason="Approved after.")
    ) | {"files": _said(0, 1), "facts": _times(LATE_APPROVED), "checks": [APPROVED_FIRST]}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABD", SUPPORTED) | {
        "C": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    late = _by_code(result)["C"]
    assert late.summary == f"A check of the records shows attribute C is not met: {LATE_TEXT}"
    assert [check.as_json() for check in late.checks] == [
        {"element": "wording", "test": "NOT_AFTER", "status": "FAILED", "sentence": LATE_TEXT}
    ]
    # The exception rests on the two records, and nothing is called missing.
    assert late.absent == () and late.shows is None
    assert {(p.file_id, p.quote) for p in late.passages} == {(F0, LATE_APPROVED), (F1, GRANTED)}
    [element] = late.elements
    assert (element.result, element.deviation) == ("NOT_MET", True)
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. C is contradicted by the records: "
        f"{LATE_TEXT} {POTENTIAL}"
    )
    # What is asked is an explanation of what the records show, never more evidence.
    [follow_up] = review["follow_ups"]
    assert (follow_up["codes"], follow_up["kind"], follow_up["priority"]) == (
        ["C"], "CLARIFICATION", "HIGH",
    )  # fmt: skip
    assert follow_up["request"] == (
        "The records show this is not met: The approval is dated on or before the access was "
        "granted. Explain it, or provide the record that corrects it."
    )
    assert review["completeness"]["state"] == "COMPLETE"


# 3. Approval by an unauthorized person.
def test_an_approval_by_someone_the_record_shows_is_not_the_manager_is_never_sufficient() -> None:
    chain = _control(_ticket_file(_ticket(ANALYST_APPROVED)), _log_file())
    assert [key for key, _text in elements_of(chain.attributes[1])] == ["condition", "pass"]
    # An approval is there (the condition), but the record's own designation of the
    # approver is "service desk analyst": the element that asks for the manager is not met
    # on that record, with nothing absent.
    answer = _reading(
        ANALYST_APPROVED,
        B=[
            _shown((0, ANALYST_APPROVED), key="condition"),
            _deviates((0, ANALYST_APPROVED), key="pass", reason="A service desk analyst."),
        ],
    ) | {"files": _said(0, 1)}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ACD", SUPPORTED) | {
        "B": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    approval = _by_code(result)["B"]
    assert approval.shows is None and approval.absent == ()
    assert [(p.file_id, p.quote) for p in approval.passages] == [(F0, ANALYST_APPROVED)]
    # Element by element: an approval exists; its approver is not the manager.
    assert [(e.key, e.result, e.deviation) for e in approval.elements] == [
        ("condition", "MET", False), ("pass", "NOT_MET", True),
    ]  # fmt: skip
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. B is contradicted by the records: the "
        f"records show “{ANALYST_APPROVED}”. {POTENTIAL}"
    )
    [follow_up] = review["follow_ups"]
    assert (follow_up["codes"], follow_up["elements"], follow_up["kind"]) == (
        ["B"], ["pass"], "CLARIFICATION",
    )  # fmt: skip
    assert follow_up["request"] == (
        "The records show this is not met: The approver is the user's manager, by the "
        "record's own designation. Explain it, or provide the record that corrects it."
    )


# 4. Approval missing.
def test_a_missing_approval_is_not_demonstrated_and_the_approval_record_is_asked_for() -> None:
    # This request asked for the ticket: attributes A and B. The grant is another request's.
    chain = _control(_ticket_file(_ticket(None, more="Status: closed")), asked="AB")
    request = (
        "Provide the approval of REQ-1041: the ticket's approval step or the manager's "
        "approval message, showing who approved and when."
    )
    absent = "No approval is recorded on the ticket."
    not_approved = _says(
        A=_shown((0, NAMED), (0, ACCESS)),
        B=[_lacks(absent, key="condition"), _lacks(absent, key="pass")],
        C=_element("NOT_ADDRESSED"),
        D=_element("NOT_ADDRESSED"),
    )
    first = not_approved | {
        "files": _said(0),
        "follow_ups": [
            _ask("B", "condition", request, missing="The approval of the request.",
                 why="Access must be approved by the user's manager before it is granted.",
                 alternatives="An export of the ticket's approval history.", priority="HIGH"),
            _ask("B", "pass", request, priority="HIGH"),
        ],
    }  # fmt: skip
    second = not_approved | {
        "files": _said(0),
        "follow_ups": [_ask("B", "condition", "Send the approval for REQ-1041.")],
    }
    result = run_chain(_two(first, second), chain)
    assert _stands(result) == {
        "A": SUPPORTED,
        # Nothing shows the approval, and nothing shows a failure: not demonstrated.
        "B": ("ISSUE", "NOT_MET", "NOT_DEMONSTRATED"),
        "C": ("NOT_ADDRESSED", "NOT_ADDRESSED", None),
        "D": ("NOT_ADDRESSED", "NOT_ADDRESSED", None),
    }
    approval = _by_code(result)["B"]
    assert approval.summary == "Both readings find the evidence does not show attribute B."
    assert approval.absent == (absent,) and approval.passages == ()
    assert not any(element.deviation for element in approval.elements)
    review = _review(result)
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert review["explanation"] == (
        f"1 of 2 requested attributes is supported. B is not demonstrated: not shown: {absent} "
        "1 follow-up would resolve what is open."
    )
    # One request, in the first reading's words, covering both elements of B.
    assert review["follow_ups"] == [
        {
            "key": f"{B}:condition", "attribute_ids": [str(B), str(B)], "codes": ["B", "B"],
            "elements": ["condition", "pass"], "missing": "The approval of the request.",
            "why": "Access must be approved by the user's manager before it is granted.",
            "request": request, "alternatives": "An export of the ticket's approval history.",
            "kind": "EVIDENCE", "priority": "HIGH", "raised_by": ["ASSESSOR", "REVIEWER"],
            "status": "OPEN", "keys": [f"{B}:condition", f"{B}:pass"],
        }
    ]  # fmt: skip
    assert (review["follow_ups_dropped"], review["follow_ups_more"]) == (0, 0)


# 5. Correct approval but incorrect access granted.
def test_a_grant_of_another_role_than_the_one_approved_is_contradicted_on_d() -> None:
    chain = _control(_ticket_file(), _log_file(_log(ADMIN_GRANTED)))
    roles = [
        _fact("F3", "REQUESTED", "HR_PARTNER_VIEW", 0, ACCESS),
        _fact("F4", "PERFORMED", "HR_ADMIN", 1, ADMIN_GRANTED),
    ]
    same = {"attribute": "D", "element": "wording", "test": "SAME", "left": "F3", "right": "F4"}
    answer = _reading(
        granted=ADMIN_GRANTED,
        D=_deviates((0, ACCESS), (1, ADMIN_GRANTED), reason="Another role was granted."),
    ) | {"files": _said(0, 1), "facts": roles, "checks": [same]}
    result = run_chain(_both(answer), chain)
    # The approval is right and in time: A, B and C stand. D does not.
    assert _stands(result) == dict.fromkeys("ABC", SUPPORTED) | {
        "D": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    granted = _by_code(result)["D"]
    sentence = "Asked for HR_PARTNER_VIEW, done HR_ADMIN: not the same."
    assert granted.summary == f"A check of the records shows attribute D is not met: {sentence}"
    assert [check.as_json() for check in granted.checks] == [
        {"element": "wording", "test": "SAME", "status": "FAILED", "sentence": sentence}
    ]
    assert {(p.file_id, p.quote) for p in granted.passages} == {(F0, ACCESS), (F1, ADMIN_GRANTED)}
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. D is contradicted by the records: "
        f"{sentence} {POTENTIAL}"
    )
    # Two readings that both call D met do not stand against the two roles the records
    # name either.
    agreed = _reading(granted=ADMIN_GRANTED) | {k: answer[k] for k in ("files", "facts", "checks")}
    assert _stands(run_chain(_both(agreed), chain))["D"] == ("ISSUE", "NOT_MET", "CONTRADICTED")


# 6. Approval for a different user.
def test_a_ticket_for_one_user_and_a_grant_for_another_support_nothing() -> None:
    chain = _control(_ticket_file(), _log_file(_log(OTHER_GRANTED)))
    # Both readings miss it and call everything met; each states whom each file is about.
    subjects = [
        _fact("F3", "SUBJECT", "Jordan Reyes", 0, NAMED),
        _fact("F4", "SUBJECT", "MPATEL", 1, OTHER_GRANTED),
    ]
    answer = _reading(granted=OTHER_GRANTED) | {"files": _said(0, 1), "facts": subjects}
    result = run_chain(_both(answer), chain)
    sentence = (
        "ticket REQ-1041.txt is about Jordan Reyes and workday security log.txt about MPATEL."
    )
    review = _review(result)
    assert review["concerns"] == [
        {"code": "DIFFERENT_SUBJECT", "sentence": sentence, "file_ids": [str(F0), str(F1)]}
    ]
    # Code cannot tell which of the two users the instance is, so neither file supports
    # anything: nothing is supported, and nothing is called an exception either.
    assert _stands(result) == dict.fromkeys("ABCD", OPEN)
    for outcome in result.outcomes:
        assert outcome.summary == (
            f"Attribute {outcome.code} is not supported by these files: {sentence} Your "
            "judgment is needed."
        )
        assert outcome.passages == () and outcome.shows is None
        assert [view.result for view in outcome.views] == ["MET", "MET"]
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert review["explanation"].startswith(
        f"None of the 4 requested attributes is supported yet. A could not be concluded: {sentence}"
    )
    assert {f["kind"] for f in review["follow_ups"]} == {"EVIDENCE"}
    assert [f["request"] for f in review["follow_ups"] if f["codes"] == ["D"]] == [
        "Provide the record that shows: The access granted is the access that was approved."
    ]
    # No false exception: the same user written as a name in the ticket and as a user id
    # in the log is not two subjects.
    same_user = [subjects[0], _fact("F4", "SUBJECT", "JREYES", 1, GRANTED)]
    matched = run_chain(
        _both(_reading() | {"files": _said(0, 1), "facts": same_user}),
        _control(_ticket_file(), _log_file()),
    )
    assert _review(matched)["concerns"] == [] and _review(matched)["overall"] == "SUFFICIENT"
    assert _stands(matched) == dict.fromkeys("ABCD", SUPPORTED)


# 7. Multiple documents collectively satisfying a requirement.
def test_a_ticket_and_a_log_together_show_what_neither_shows_alone() -> None:
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1)}
    result = run_chain(_both(answer), chain)
    outcomes = _by_code(result)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    # The request and its approval are the ticket's; "approved before granted" and
    # "granted as approved" rest on the ticket and the log together.
    assert _files_of(outcomes["A"]) == _files_of(outcomes["B"]) == {F0}
    assert _files_of(outcomes["C"]) == _files_of(outcomes["D"]) == {F0, F1}
    assert {o.shows for o in result.outcomes} == {"IMPLEMENTATION"}
    review = _review(result)
    assert review["overall"] == "SUFFICIENT" and review["follow_ups"] == []
    assert [file["file_id"] for file in review["files"]] == [str(F0), str(F1)]
    # The ticket alone leaves the grant open, as something to ask for: it is never an
    # exception, because nothing in the ticket shows a failure.
    alone = _control(_ticket_file())
    no_grant = "No record of when, or with what role, the access was granted."
    partial = _reading(C=_lacks(no_grant), D=_lacks(no_grant)) | {"files": _said(0)}
    lone = run_chain(_both(partial), alone)
    assert _stands(lone) == dict.fromkeys("AB", SUPPORTED) | dict.fromkeys(
        "CD", ("ISSUE", "NOT_MET", "NOT_DEMONSTRATED")
    )
    assert _review(lone)["overall"] == "ADDITIONAL_EVIDENCE"


# 8. One document satisfying multiple attributes.
def test_one_document_is_judged_attribute_by_attribute() -> None:
    # The ticket carries its own fulfilment record: one file for the whole instance.
    whole = _ticket(more=f"Fulfilled: {GRANTED}")
    chain = _control(_ticket_file(whole))
    answer = _says(
        A=_shown((0, NAMED), (0, ACCESS)),
        B=[_shown((0, APPROVED), key="condition"), _shown((0, APPROVED), key="pass")],
        C=_shown((0, APPROVED), (0, GRANTED)),
        D=_shown((0, ACCESS), (0, GRANTED)),
    ) | {"files": _said(0)}
    result = run_chain(_both(answer), chain)
    outcomes = _by_code(result)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    # Each attribute rests on its own passages of the one file.
    assert {code: {p.quote for p in outcomes[code].passages} for code in "ABCD"} == {
        "A": {NAMED, ACCESS}, "B": {APPROVED}, "C": {APPROVED, GRANTED}, "D": {ACCESS, GRANTED},
    }  # fmt: skip
    assert all(_files_of(outcome) == {F0} for outcome in result.outcomes)
    assert _review(result)["overall"] == "SUFFICIENT"
    # One attribute the second reading cannot rest on the file's own words is open by
    # itself: the others, shown by the same file, stand.
    invented = "WD_SECURITY assigned exactly the approved role to Jordan Reyes"
    doubting = answer | _says(
        A=_shown((0, NAMED), (0, ACCESS)),
        B=[_shown((0, APPROVED), key="condition"), _shown((0, APPROVED), key="pass")],
        C=_shown((0, APPROVED), (0, GRANTED)),
        D=_shown((0, invented)),
    )
    split = run_chain(_two(answer, doubting), chain)
    assert _stands(split) == dict.fromkeys("ABC", SUPPORTED) | {"D": OPEN}
    assert _by_code(split)["D"].summary == UNSETTLED_TEXT
    assert _review(split)["overall"] != "SUFFICIENT"


SCREEN_ROW = "JREYES - HR_PARTNER_VIEW - assigned 2027-03-03 14:30 by WD_SECURITY"
SCREEN = f"Workday security group assignments\n{SCREEN_ROW}\n"


def _screenshot(text: str = SCREEN) -> FileSpec:
    """A screenshot of the role assignment, as read: its kind is the reader's unsure guess."""
    return replace(_file(text, F1, "workday screenshot.png"), kind_unsure=True)


# 9. Relevant screenshot classified with low confidence.
def test_a_screenshot_of_unsure_kind_is_read_supports_what_it_shows_and_is_listed() -> None:
    # The gate: the first engine held such a file; engine 2 reads it.
    low = _facts(confidence="low")
    assert kind_unsure(low)
    held = gate(low, 1)
    assert held is not None and held.code == "KIND_UNSURE"
    assert gate(low, 2) is None
    chain = _control(_ticket_file(), _screenshot())
    answer = _reading(granted=SCREEN_ROW) | {"files": _said(0, 1)}
    result = run_chain(_both(answer), chain)
    # How sure the reader is of the file's kind says nothing about what the file shows.
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    assert _files_of(_by_code(result)["D"]) == {F0, F1}
    review = _review(result)
    assert review["confirmations"] == [
        {
            "file_id": str(F1),
            "code": "KIND_UNSURE",
            "reason": (
                "The reader is not sure what kind of evidence workday screenshot.png is; it "
                "was read as a walkthrough record. Confirm its kind."
            ),
        }
    ]
    assert review["overall"] == "SUFFICIENT" and review["follow_ups"] == []
    # It supports only what it shows: a role the reading says it shows, in words the
    # screenshot does not hold, is not supported.
    unseen = _reading(granted=SCREEN_ROW, D=_shown((1, "JREYES - HR_PARTNER_ADMIN - assigned")))
    blind = run_chain(_both(unseen | {"files": _said(0, 1)}), chain)
    assert _stands(blind) == dict.fromkeys("ABC", SUPPORTED) | {"D": OPEN}
    assert _review(blind)["overall"] != "SUFFICIENT"


# 10. Failed OCR extraction.
def test_a_file_whose_ocr_failed_is_held_and_nothing_is_concluded_as_missing() -> None:
    # The gate: nothing readable was extracted, so the file is held, for either engine.
    unreadable = _facts(readable=False)
    held = gate(unreadable, 2)
    assert held is not None and (held.code, held.reason) == (
        "UNREADABLE", "Nothing readable was extracted from the file, so a person reads it.",
    )  # fmt: skip
    # Alone on its request, the whole check is held with that code: no reading is asked.
    assert run_gate([(held, 0)], 4) == held
    # Beside the ticket, the check goes ahead on the ticket and names the scan left out.
    assert run_gate([(None, len(_ticket())), (held, 0)], 4) is None
    chain = _control(
        _ticket_file(),
        files_left_out=True,
        left_out_names=("grant scan.pdf",),
        left_out=(LeftOut("grant scan.pdf", "UNREADABLE", held.reason),),
    )
    no_grant = "No record of the grant."
    request = "Provide the Workday security audit log entry for REQ-1041."
    answer = _reading(C=_lacks(no_grant), D=_lacks(no_grant)) | {
        "files": _said(0),
        "follow_ups": [_ask("C", "wording", request), _ask("D", "wording", request)],
    }
    result = run_chain(_both(answer), chain)
    # What the ticket shows stands. What it does not show may be in the scan: it is not
    # concluded as missing, not an issue, and not "not demonstrated".
    assert _stands(result) == dict.fromkeys("AB", SUPPORTED) | dict.fromkeys("CD", OPEN)
    for code in "CD":
        waiting = _by_code(result)[code]
        assert waiting.pending == "FILE_NOT_READ" and waiting.absent == ()
        assert waiting.summary == (
            "Not concluded yet. grant scan.pdf has not been read, and what the other files do "
            "not show may be in it. The check runs again once it is read."
        )
    review = _review(result)
    assert review["completeness"] == {
        "state": "PARTLY_UNREADABLE",
        "reasons": [
            "grant scan.pdf could not be read: Nothing readable was extracted from the file, "
            "so a person reads it."
        ],
    }
    # Nothing is asked of the organization while the file is the next step, and the
    # readings' asks are early, not unneeded.
    assert review["follow_ups"] == [] and review["follow_ups_dropped"] == 0
    assert review["overall"] == "UNABLE_TO_CONCLUDE"
    assert review["explanation"] == (
        "2 of 4 requested attributes are supported. C could not be concluded: grant scan.pdf "
        "has not been read yet. A file is still to be read before this can be concluded."
    )


# 11. Incomplete screenshot.
def test_a_cut_off_screenshot_leaves_its_elements_open_and_a_full_copy_is_asked_for() -> None:
    cropped = "Workday security group assignments\nJREYES - HR_PART\n"
    chain = _control(_ticket_file(), _screenshot(cropped))
    cut = "The row is cut off after the first letters of the group; no date is visible."
    said = [
        *_said(0),
        {"file": 1, "relevance": "RELEVANT", "source": "SYSTEM_RECORD",
         "legibility": "PARTLY_UNREADABLE", "legibility_note": cut,
         "report_basis": "NOT_A_REPORT"},
    ]  # fmt: skip
    request = (
        "Provide the full screenshot of JREYES's security group assignments in Workday, "
        "showing the group's name and the date it was assigned."
    )
    answer = _reading(C=_cannot_tell(cut), D=_cannot_tell(cut)) | {"files": said}
    first = answer | {
        "follow_ups": [
            _ask("C", "wording", request, missing="The date the group was assigned."),
            _ask("D", "wording", request),
        ]
    }
    second = answer | {"follow_ups": [_ask("D", "wording", "Send a clearer screenshot.")]}
    result = run_chain(_two(first, second), chain)
    assert _stands(result) == dict.fromkeys("AB", SUPPORTED) | dict.fromkeys("CD", OPEN)
    for code in "CD":
        assert _by_code(result)[code].summary == NEITHER_COULD_TELL
        assert _by_code(result)[code].pending == ""
    review = _review(result)
    assert review["completeness"] == {
        "state": "PARTLY_UNREADABLE",
        "reasons": [f"workday screenshot.png is partly unreadable: {cut}"],
    }
    assert [(f["file_id"], f["legibility"], f["notes"]) for f in review["files"]] == [
        (str(F0), "CLEAR", []), (str(F1), "PARTLY_UNREADABLE", [cut]),
    ]  # fmt: skip
    # One request for the full copy, covering both elements it would answer.
    [follow_up] = review["follow_ups"]
    assert (follow_up["request"], follow_up["codes"], follow_up["kind"]) == (
        request, ["C", "D"], "EVIDENCE",
    )  # fmt: skip
    assert follow_up["raised_by"] == ["ASSESSOR", "REVIEWER"]
    assert follow_up["missing"] == "The date the group was assigned."
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert review["explanation"] == (
        "2 of 4 requested attributes are supported. C could not be concluded: neither reading "
        "could tell from these files. 1 follow-up would resolve what is open."
    )


FULFILLED = "Fulfilled on 2027-03-03 14:30 by WD_SECURITY"
RUN_LINE = "Report run: 2027-03-01 08:00 by WD_REPORTS"
LISTED = "JREYES | HR_PARTNER_VIEW | Active"
LISTING = f"Workday user access listing\n{RUN_LINE}\nUser | Security group | Status\n{LISTED}\n"


# 12. Incorrect report date.
def test_a_listing_run_before_the_grant_does_not_show_the_access_granted() -> None:
    chain = _control(
        _ticket_file(_ticket(more=FULFILLED)),
        _file(LISTING, F1, "workday access listing.csv", kind="report"),
    )
    # Both readings take the listing's row for the access granted, state the time of the
    # grant and the time the listing was run, and name the comparison: the listing has to
    # be run at or after the grant to show it.
    facts = [
        _fact("F1", "APPROVED_AT", "2027-03-02 10:05", 0, APPROVED),
        _fact("F2", "PERFORMED_AT", "2027-03-03 14:30", 0, FULFILLED),
        _fact("F3", "EXTRACTED_AT", "2027-03-01 08:00", 1, RUN_LINE),
    ]
    run_after = {"attribute": "D", "element": "wording", "test": "NOT_AFTER", "left": "F2",
                 "right": "F3"}  # fmt: skip
    answer = _says(
        A=_shown((0, NAMED), (0, ACCESS)),
        B=[_shown((0, APPROVED), key="condition"), _shown((0, APPROVED), key="pass")],
        C=_shown((0, APPROVED), (0, FULFILLED)),
        D=_shown((0, ACCESS), (1, LISTED)),
    ) | {
        "files": [*_said(0), _said(1)[0] | {"report_basis": "SHOWN"}],
        "facts": facts,
        "checks": [APPROVED_FIRST, run_after],
    }
    # Agreement alone would have passed it.
    opinion = check_opinion(answer, chain)
    assert [o.verdict for o in compare(opinion, opinion, chain)] == ["SUPPORTED"] * 4
    result = run_chain(_both(answer), chain)
    sentence = (
        "Performed 3 March 2027 14:30, extracted 1 March 2027 08:00: the performance is after."
    )
    assert _stands(result) == dict.fromkeys("ABC", SUPPORTED) | {
        "D": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    listed = _by_code(result)["D"]
    assert listed.summary == f"A check of the records shows attribute D is not met: {sentence}"
    assert [(c.test, c.status, c.sentence) for c in listed.checks] == [
        ("NOT_AFTER", "FAILED", sentence)
    ]
    assert listed.shows is None and listed.views == ()
    # The passages are the two dates the comparison is made on.
    assert {(p.file_id, p.quote) for p in listed.passages} == {(F0, FULFILLED), (F1, RUN_LINE)}
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. D is contradicted by the records: "
        f"{sentence} {POTENTIAL}"
    )
    [follow_up] = review["follow_ups"]
    assert (follow_up["codes"], follow_up["kind"]) == (["D"], "CLARIFICATION")


ORACLE_HEAD = "Oracle EBS security audit log\nExtracted on 2027-03-10 from Oracle EBS production\n"
ORACLE_SYSTEM = "Extracted on 2027-03-10 from Oracle EBS production"
ORACLE_LOG = f"{ORACLE_HEAD}{GRANTED} (ticket REQ-1041)\n"
WRONG_SYSTEM = (
    "oracle security log.txt names the system Oracle EBS; this control is tested on Workday."
)


def _oracle_file() -> FileSpec:
    return _file(ORACLE_LOG, F1, "oracle security log.txt", kind="change_history")


# 13. Evidence from the wrong application.
def test_a_log_of_another_application_is_a_concern_and_supports_nothing_alone() -> None:
    chain = _control(_ticket_file(), _oracle_file())
    system = _fact("F3", "SYSTEM", "Oracle EBS", 1, ORACLE_SYSTEM)
    # Both readings miss it. D is rested on the log's line alone (it names the ticket's
    # user and role). C, rested on the ticket's approval and the log's grant, is the next
    # test's.
    answer = _reading(D=_shown((1, GRANTED))) | {"files": _said(0, 1), "facts": [system]}
    # Without the fact the readings state, agreement would have passed all four.
    bare = run_chain(_both(answer | {"facts": []}), chain)
    assert _stands(bare) == dict.fromkeys("ABCD", SUPPORTED)
    result = run_chain(_both(answer), chain)
    review = _review(result)
    assert review["concerns"] == [
        {"code": "WRONG_SYSTEM", "sentence": WRONG_SYSTEM, "file_ids": [str(F1)]}
    ]
    # What rests on the ticket stands; what rests on the other application's log does not.
    assert _stands(result)["A"] == _stands(result)["B"] == SUPPORTED
    granted = _by_code(result)["D"]
    assert (granted.verdict, granted.result, granted.assessment) == OPEN
    assert granted.summary == (
        f"Attribute D is not supported by these files: {WRONG_SYSTEM} Your judgment is needed."
    )
    assert granted.passages == () and granted.elements[0].result is None
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert [f["request"] for f in review["follow_ups"] if "D" in f["codes"]] == [
        "Provide the record that shows: The access granted is the access that was approved."
    ]
    # One reading alone stating the system is no concern: code's own checks need both.
    one_sided = run_chain(_two(answer, answer | {"facts": []}), chain)
    assert _review(one_sided)["concerns"] == []


# 13, the gap: an element that rests on the ticket AND on the other application's log.
def test_nothing_that_rests_on_a_log_of_another_application_is_supported() -> None:
    chain = _control(_ticket_file(), _oracle_file())
    system = _fact("F3", "SYSTEM", "Oracle EBS", 1, ORACLE_SYSTEM)
    # The natural mistaken reading: C and D each quote the ticket and the log.
    answer = _reading() | {"files": _said(0, 1), "facts": [system]}
    result = run_chain(_both(answer), chain)
    review = _review(result)
    assert [concern["code"] for concern in review["concerns"]] == ["WRONG_SYSTEM"]
    assert _stands(result)["A"] == _stands(result)["B"] == SUPPORTED
    # The grant's date and role are read from Oracle EBS: neither C nor D is shown for a
    # control tested on Workday, and the request is not sufficient.
    assert _stands(result)["C"] == OPEN and _stands(result)["D"] == OPEN
    assert review["overall"] != "SUFFICIENT"


OLD_APPROVED = "Approved by: Dana Lee, manager of Jordan Reyes, on 2026-12-18 09:15"
OLD_GRANTED = "2026-12-19 11:00 WD_SECURITY assigned role HR_PARTNER_VIEW to JREYES"
PERIOD = "the audit period (1 January 2027 to 31 December 2027)"


# 14. Evidence outside the required testing period.
def test_dates_outside_the_period_are_a_consideration_unless_an_element_asks_for_the_period() -> (
    None
):
    files = (_ticket_file(_ticket(OLD_APPROVED)), _log_file(_log(OLD_GRANTED)))
    chain = _control(*files)
    answer = _reading(OLD_APPROVED, OLD_GRANTED) | {
        "files": _said(0, 1),
        "facts": _times(OLD_APPROVED, OLD_GRANTED),
        "checks": [APPROVED_FIRST],
    }
    result = run_chain(_both(answer), chain)
    review = _review(result)
    approved_outside = (
        f"The approval in ticket REQ-1041.txt is dated 18 December 2026, outside {PERIOD}."
    )
    granted_outside = (
        f"The action in workday security log.txt is dated 19 December 2026, outside {PERIOD}."
    )
    assert review["concerns"] == [
        {"code": "OUTSIDE_PERIOD", "sentence": approved_outside, "file_ids": [str(F0)]},
        {"code": "OUTSIDE_PERIOD", "sentence": granted_outside, "file_ids": [str(F1)]},
    ]
    # No attribute asks for the period: an observation raised by code, with the passage
    # each date is read from. Never a finding, and no verdict rests on it.
    assert [
        (c["text"], c["raised_by"], c["passages"][0]["quote"]) for c in review["considerations"]
    ] == [
        (approved_outside, ["CODE"], OLD_APPROVED),
        (granted_outside, ["CODE"], OLD_GRANTED),
    ]
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    assert review["follow_ups"] == []

    # Where an attribute's element asks for the period, the readings name the comparison
    # and code makes it: the date is then no consideration, it decides the element.
    in_period = _control(
        *files, texts={"C": "The approval is dated within the audit period and before the grant."}
    )
    within = {"attribute": "C", "element": "wording", "test": "IN_PERIOD", "left": "F1"}
    asked = run_chain(_both(answer | {"checks": [APPROVED_FIRST, within]}), in_period)
    sentence = f"Approved 18 December 2026 09:15: outside {PERIOD}."
    timing = _by_code(asked)["C"]
    assert (timing.verdict, timing.result, timing.assessment) == (
        "ISSUE", "NOT_MET", "CONTRADICTED",
    )  # fmt: skip
    assert [(c.test, c.status) for c in timing.checks] == [
        ("NOT_AFTER", "PASSED"), ("IN_PERIOD", "FAILED"),
    ]  # fmt: skip
    assert timing.summary == f"A check of the records shows attribute C is not met: {sentence}"
    decided = _review(asked)
    assert decided["overall"] == "POTENTIAL_EXCEPTION"
    assert [concern["code"] for concern in decided["concerns"]] == ["OUTSIDE_PERIOD"] * 2
    # The approval's date decided an element, so it is no consideration. The grant's date,
    # which no comparison was made on, still is one.
    assert [c["text"] for c in decided["considerations"]] == [granted_outside]


# 15. Contradictory documents.
def test_two_records_that_disagree_are_contradicted() -> None:
    # The ticket's fulfilment note and the system's log name different roles for one grant.
    chain = _control(
        _ticket_file(_ticket(more=f"Fulfilled: {GRANTED}")), _log_file(_log(ADMIN_GRANTED))
    )
    disagree = _element(
        "CONTRADICTED", [(0, GRANTED, "RECORD"), (1, ADMIN_GRANTED, "RECORD")],
        reason="The ticket says HR_PARTNER_VIEW was assigned; the log says HR_ADMIN.",
    )  # fmt: skip
    answer = _reading(granted=ADMIN_GRANTED, D=disagree) | {"files": _said(0, 1)}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABC", SUPPORTED) | {
        "D": ("ISSUE", "CONTRADICTED", "CONTRADICTED")
    }
    granted = _by_code(result)["D"]
    assert granted.summary == (
        "Both readings find passages of the evidence that contradict each other on attribute D."
    )
    assert {(p.file_id, p.quote) for p in granted.passages} == {(F0, GRANTED), (F1, ADMIN_GRANTED)}
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. D is contradicted by the records: two "
        f"records disagree with each other. {POTENTIAL}"
    )
    [follow_up] = review["follow_ups"]
    assert (follow_up["codes"], follow_up["kind"]) == (["D"], "CLARIFICATION")
    # A contradiction needs the two records: one reading that claims it on a single
    # passage has shown none, and nothing is called contradicted.
    one_passage = _reading(
        granted=ADMIN_GRANTED, D=_element("CONTRADICTED", [(1, ADMIN_GRANTED, "RECORD")])
    ) | {"files": _said(0, 1)}
    lone = run_chain(_both(one_passage), chain)
    assert _stands(lone)["D"] == OPEN and _review(lone)["overall"] != "POTENTIAL_EXCEPTION"


POPULATION = (
    "Workday new access granted, March 2027\n"
    "Source: Workday security audit report, run 2027-04-01 09:00 by WD_REPORTS\n"
    "Parameters: effective date 2027-03-01 to 2027-03-31, all security groups\n"
    "User | Security group | Assigned\n"
    "JREYES | HR_PARTNER_VIEW | 2027-03-03\n"
    "MPATEL | HR_PARTNER_VIEW | 2027-03-09\n"
)


# 16. Population submitted for an inappropriate single-instance test.
def test_a_population_on_a_single_instance_item_is_left_out_with_its_purpose_said() -> None:
    population = _facts(kind="population")
    held = gate(population, 2)
    assert held is not None and (held.code, held.reason) == ("POPULATION", POPULATION_PURPOSE)
    assert held.reason == (
        "This file is a population: it shows who or what is in scope, not that one instance "
        "was performed, so it is not checked against this item's attributes. Pick the "
        "walkthrough instance from it; that instance's own records are what is checked."
    )
    # Alone on the item, the check is held with that sentence and no reading is asked.
    assert run_gate([(held, len(POPULATION))], 4) == held
    # Beside the instance's own records it is left out, and named. What those records
    # show stands, and nothing is asked for because a population was offered.
    chain = _control(
        _ticket_file(),
        _log_file(),
        files_left_out=True,
        left_out_names=("new access March 2027.csv",),
        left_out=(LeftOut("new access March 2027.csv", "POPULATION", held.reason),),
    )
    result = run_chain(_both(_reading() | {"files": _said(0, 1)}), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    review = _review(result)
    assert review["completeness"] == {
        "state": "INCOMPLETE",
        "reasons": [f"new access March 2027.csv was not part of the check: {POPULATION_PURPOSE}"],
    }
    assert review["overall"] == "SUFFICIENT" and review["follow_ups"] == []
    assert review["explanation"] == (
        f"All 4 requested attributes are supported. {NOTHING_MORE} A file was not read; what "
        "the read files show still stands."
    )


# 17. Population correctly supporting a population-level procedure.
def test_a_population_is_read_where_the_item_asks_for_one() -> None:
    complete = AttributeSpec(
        id=A,
        code="A",
        text="The listing of access granted in the period shows its source, run date and scope.",
        criteria=None,
        expected=True,
    )
    chain = ChainInput(
        control_ref="ITGC-AC-02",
        title="User access provisioning",
        activity="The population of access granted in the period, from which instances are picked.",
        lens=lens_for((POPULATION_CATEGORY,), ["population"]),
        attributes=(complete,),
        files=(_file(POPULATION, F0, "new access March 2027.csv", kind="population"),),
        categories=(POPULATION_CATEGORY,),
        context=replace(
            CONTEXT,
            request_title="Population: access granted in Workday in March 2027",
            request_description="The system report of every role assigned in the month.",
        ),
    )
    # The gate reads it, because the item itself asks for a population.
    population = _facts(kind="population")
    asked = POPULATION_CATEGORY in chain.categories
    assert asked and gate(population, 2, population_asked=asked) is None
    held = gate(population, 2, population_asked=False)
    assert held is not None and held.code == "POPULATION"
    source = "Source: Workday security audit report, run 2027-04-01 09:00 by WD_REPORTS"
    parameters = "Parameters: effective date 2027-03-01 to 2027-03-31, all security groups"
    answer = _says(A=_shown((0, source), (0, parameters))) | {
        "files": [_said(0)[0] | {"report_basis": "SHOWN"}]
    }
    result = run_chain(_both(answer), chain)
    [outcome] = result.outcomes
    assert (outcome.verdict, outcome.result, outcome.assessment) == SUPPORTED
    assert {p.quote for p in outcome.passages} == {source, parameters}
    review = _review(result)
    assert review["overall"] == "SUFFICIENT"
    assert review["completeness"] == {"state": "COMPLETE", "reasons": []}
    assert review["files"][0]["report_basis"] == "SHOWN"


RULE_REQUEST = "must be requested in a ticket that names the user and the role"
RULE_APPROVAL = "must be approved by the user's manager before access is granted"
RULE_GRANT = "grants only the role named in the approved request"
CLAIM = "All access requests raised in 2027 were approved by the user's manager"
POLICY = (
    "Access Management Procedure v4, approved by the CISO on 2027-01-10\n"
    f"4.1 Access to Workday {RULE_REQUEST}.\n"
    f"4.2 Each request {RULE_APPROVAL}.\n"
    f"4.3 Workday Security {RULE_GRANT}.\n"
    f"4.4 {CLAIM} before access was granted.\n"
)


def _required(*quotes: str, key: str = "wording") -> Answer:
    return _shown(*((0, quote) for quote in quotes), key=key, basis="REQUIREMENT")


# 18. Evidence that demonstrates design but not operating effectiveness.
def test_a_policy_shows_the_design_never_that_the_control_was_performed() -> None:
    policy = _file(POLICY, F0, "access management procedure.pdf", kind="policy")
    assert lens_for((), ["policy"]) == "DESIGN_DOCUMENT"
    chain = _control(
        policy,
        lens="DESIGN_DOCUMENT",
        context=replace(
            CONTEXT,
            request_title="The access management procedure",
            request_description="The approved procedure for granting access to Workday.",
        ),
    )
    answer = _says(
        A=_required(RULE_REQUEST),
        B=[_required(RULE_APPROVAL, key="condition"), _required(RULE_APPROVAL, key="pass")],
        C=_required(RULE_APPROVAL),
        D=_required(RULE_GRANT),
    ) | {"files": _said(0, source="DOCUMENT")}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    # Supported as design: the document requires it. Never implementation.
    assert {o.shows for o in result.outcomes} == {"DESIGN"}
    assert _by_code(result)["B"].summary == (
        "Both readings find the documents require what attribute B tests."
    )
    # The policy's own statement that it was done is someone's account, whatever the
    # readings call it: it shows nothing, not even the design.
    claimed = answer | _says(
        A=_required(RULE_REQUEST),
        B=[_shown((0, CLAIM), key="condition"), _shown((0, CLAIM), key="pass")],
        C=_shown((0, CLAIM)),
        D=_required(RULE_GRANT),
    )
    told = run_chain(_both(claimed), chain)
    assert _stands(told) == dict.fromkeys("AD", SUPPORTED) | dict.fromkeys("BC", OPEN)
    assert _by_code(told)["B"].shows is None and _by_code(told)["B"].passages == ()
    assert _review(told)["overall"] != "SUFFICIENT"
    # Beside the records of an instance, the lens is the instance's: the policy's rule is
    # what must happen, not the record that it happened, and supports nothing.
    assert lens_for((), ["policy", "walkthrough"]) == "INSTANCE_RECORD"
    mixed = _control(policy, _file(_ticket(None), F1, "ticket REQ-1041.txt"))
    ruled = _says(
        A=_shown((1, NAMED), (1, ACCESS)),
        B=[_required(RULE_APPROVAL, key="condition"), _required(RULE_APPROVAL, key="pass")],
        C=_required(RULE_APPROVAL),
        D=_required(RULE_GRANT),
    ) | {"files": [*_said(0, source="DOCUMENT"), *_said(1)]}
    instance = run_chain(_both(ruled), mixed)
    assert _stands(instance) == {"A": SUPPORTED} | dict.fromkeys("BCD", OPEN)
    assert _by_code(instance)["A"].shows == "IMPLEMENTATION"


GRANT_REQUEST = (
    "Provide the Workday security audit log entry showing when role HR_PARTNER_VIEW was "
    "assigned to JREYES under REQ-1041, and by whom."
)
NO_GRANT = "No record of the grant: when the role was assigned, and which role."


def _without_the_grant() -> tuple[Answer, Answer]:
    """The two readings of the ticket alone: the request and its approval are shown, the
    grant is not, and each asks for the provisioning record in its own words."""
    shortfall = _reading(C=_lacks(NO_GRANT), D=_lacks(NO_GRANT)) | {"files": _said(0)}
    first = shortfall | {
        "follow_ups": [
            _ask("C", "wording", GRANT_REQUEST, missing="When the role was assigned in Workday.",
                 why="The grant has to follow the approval, and match what was approved.",
                 alternatives="A dated screenshot of the user's role assignment history.",
                 priority="HIGH"),
            _ask("D", "wording", GRANT_REQUEST, priority="HIGH"),
        ]
    }  # fmt: skip
    second = shortfall | {"follow_ups": [_ask("C", "wording", "Send the provisioning log.")]}
    return first, second


# 19. Missing provisioning record.
def test_a_missing_provisioning_record_is_asked_for_in_the_readings_own_words() -> None:
    chain = _control(_ticket_file())
    result = run_chain(_two(*_without_the_grant()), chain)
    assert _stands(result) == dict.fromkeys("AB", SUPPORTED) | dict.fromkeys(
        "CD", ("ISSUE", "NOT_MET", "NOT_DEMONSTRATED")
    )
    review = _review(result)
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    # One follow-up, the first reading's request kept verbatim: it names the record.
    assert review["follow_ups"] == [
        {
            "key": f"{C}:wording", "attribute_ids": [str(C), str(D)], "codes": ["C", "D"],
            "elements": ["wording", "wording"],
            "missing": "When the role was assigned in Workday.",
            "why": "The grant has to follow the approval, and match what was approved.",
            "request": GRANT_REQUEST,
            "alternatives": "A dated screenshot of the user's role assignment history.",
            "kind": "EVIDENCE", "priority": "HIGH", "raised_by": ["ASSESSOR", "REVIEWER"],
            "status": "OPEN", "keys": [f"{C}:wording", f"{D}:wording"],
        }
    ]  # fmt: skip
    assert (review["follow_ups_dropped"], review["follow_ups_more"]) == (0, 0)
    assert review["explanation"] == (
        f"2 of 4 requested attributes are supported. C is not demonstrated: not shown: {NO_GRANT} "
        "1 follow-up would resolve what is open."
    )
    assert review["completeness"] == {"state": "COMPLETE", "reasons": []}


ROLE_REQUEST = (
    "Provide what shows Sam Ortiz's role on 2 March 2027 and that Jordan Reyes reported to "
    "Sam Ortiz: the reporting line in Workday, or the approval step naming the approver's role."
)
NO_ROLE = "Nothing in the ticket designates Sam Ortiz as Jordan Reyes's manager."


# 20. Unverified approver authorization.
def test_an_approver_whose_role_nothing_shows_leaves_b_unsupported_and_the_role_is_asked() -> None:
    chain = _control(_ticket_file(_ticket(BARE_APPROVED)), _log_file())
    answer = _reading(
        BARE_APPROVED,
        B=[_shown((0, BARE_APPROVED), key="condition"), _lacks(NO_ROLE, key="pass")],
    ) | {
        "files": _said(0, 1),
        "follow_ups": [
            _ask("B", "pass", ROLE_REQUEST, missing="The approver's role.",
                 why="The approval counts only if the approver is the user's manager.",
                 priority="HIGH"),
        ],
    }  # fmt: skip
    result = run_chain(_both(answer), chain)
    # An approval is there; that its approver is the manager is not shown, and nothing
    # shows he is not: shown only in part, never contradicted.
    assert _stands(result) == dict.fromkeys("ACD", SUPPORTED) | {
        "B": ("ISSUE", "PARTLY_MET", "PARTIALLY_SUPPORTED")
    }
    approval = _by_code(result)["B"]
    assert approval.summary == "Both readings find the evidence shows attribute B only in part."
    assert approval.absent == (NO_ROLE,)
    assert [(e.key, e.result, e.deviation) for e in approval.elements] == [
        ("condition", "MET", False), ("pass", "NOT_MET", False),
    ]  # fmt: skip
    review = _review(result)
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    [follow_up] = review["follow_ups"]
    assert (follow_up["key"], follow_up["elements"], follow_up["request"]) == (
        f"{B}:pass", ["pass"], ROLE_REQUEST,
    )  # fmt: skip
    assert (follow_up["kind"], follow_up["priority"]) == ("EVIDENCE", "HIGH")
    assert review["explanation"] == (
        f"3 of 4 requested attributes are supported. B is shown only in part: not shown: {NO_ROLE} "
        "1 follow-up would resolve what is open."
    )


TRACKED = "REQ-1041 | JREYES | HR_PARTNER_VIEW | granted 2027-03-03 14:30"
TRACKER = f"Access granted tracker, kept by IT operations\n{TRACKED}\n"
BARE_LISTED = "JREYES | HR_PARTNER_VIEW | assigned 2027-03-03 14:30"
BARE_LISTING = f"User | Security group | Assigned\n{BARE_LISTED}\n"
CORROBORATE = "What it rests on needs corroboration before it is relied on."


# 21. Incomplete or unreliable IPE.
def test_support_resting_on_unreliable_ipe_is_never_called_sufficient() -> None:
    def said(source: str, basis: str) -> list[Answer]:
        return [*_said(0), _said(1, source=source)[0] | {"report_basis": basis}]

    # A spreadsheet a person keeps: every attribute is supported, and it is not sufficient.
    tracker = _control(_ticket_file(), _file(TRACKER, F1, "access tracker.xlsx", kind="report"))
    answer = _reading(granted=TRACKED)
    kept = run_chain(
        _both(answer | {"files": said("MANAGEMENT_PREPARED", "NOT_A_REPORT")}), tracker
    )
    assert _stands(kept) == dict.fromkeys("ABCD", SUPPORTED)
    review = _review(kept)
    assert review["completeness"] == {
        "state": "RELIABILITY_UNRESOLVED",
        "reasons": [
            "access tracker.xlsx was prepared by a person, not produced by a system: what it "
            "shows needs corroboration."
        ],
    }
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert review["explanation"] == f"All 4 requested attributes are supported. {CORROBORATE}"
    # One reading alone calling it a system's record does not establish its source.
    unsure = run_chain(
        _two(
            answer | {"files": said("MANAGEMENT_PREPARED", "NOT_A_REPORT")},
            answer | {"files": said("SYSTEM_RECORD", "NOT_A_REPORT")},
        ),
        tracker,
    )
    assert _review(unsure)["completeness"] == {
        "state": "RELIABILITY_UNRESOLVED",
        "reasons": [
            "The source of access tracker.xlsx is not shown, so what it shows needs corroboration."
        ],
    }
    assert _review(unsure)["overall"] == "ADDITIONAL_EVIDENCE"

    # A system listing with no source, run date or parameters: its completeness and
    # accuracy are not established, whatever it shows.
    listing = _control(
        _ticket_file(), _file(BARE_LISTING, F1, "workday access listing.csv", kind="report")
    )
    bare = run_chain(
        _both(_reading(granted=BARE_LISTED) | {"files": said("SYSTEM_RECORD", "NOT_SHOWN")}),
        listing,
    )
    assert _stands(bare) == dict.fromkeys("ABCD", SUPPORTED)
    assert _review(bare)["completeness"] == {
        "state": "RELIABILITY_UNRESOLVED",
        "reasons": [
            "workday access listing.csv is a report or listing that does not show its source, "
            "run date or parameters, so its completeness and accuracy are not established."
        ],
    }
    assert _review(bare)["overall"] == "ADDITIONAL_EVIDENCE"
    assert _review(bare)["explanation"].endswith(CORROBORATE)
    # A file nobody rests on raises nothing: with the system's own log relied on instead,
    # the tracker beside it changes no outcome.
    beside = _control(
        _ticket_file(), _log_file(), _file(TRACKER, F2, "access tracker.xlsx", kind="report")
    )
    files = [*_said(0, 1), _said(2, source="MANAGEMENT_PREPARED")[0]]
    relied = run_chain(_both(_reading() | {"files": files}), beside)
    assert _review(relied)["overall"] == "SUFFICIENT"
    assert _review(relied)["completeness"] == {"state": "COMPLETE", "reasons": []}


NO_SUPPORT = (
    "The reading claimed support without a passage of the files that checks out as support "
    "under this lens."
)


# 22. Fabricated or unsupported citation.
def test_a_fabricated_citation_is_dropped_and_nothing_rests_on_it() -> None:
    # The ticket holds no approval. Both readings quote one all the same.
    chain = _control(_ticket_file(_ticket(None)), _log_file())
    facts = [
        # Its quote is in no file.
        _fact("F1", "APPROVED_AT", "2027-03-02 10:05", 0, APPROVED),
        # Its quote is the log's, but the value is not in it.
        _fact("F2", "PERFORMED_AT", "2027-03-04 09:00", 1, GRANTED),
    ]
    answer = _reading(C=_shown((0, APPROVED))) | {
        "files": _said(0, 1), "facts": facts, "checks": [APPROVED_FIRST],
    }  # fmt: skip
    opinion = check_opinion(answer, chain)
    # The three quotes of the approval are dropped, and both facts with them.
    assert opinion.dropped == 3
    assert opinion.facts == () and opinion.facts_dropped == 2
    assert [(c.status, c.sentence) for c in opinion.checks] == [
        (
            "NOT_RUN",
            "The comparison names a fact the reading did not state (F1), so it is not made.",
        )
    ]
    result = run_chain(_both(answer), chain)
    # Two readings that agree on a passage no file holds have shown nothing.
    assert _stands(result) == dict.fromkeys("AD", SUPPORTED) | dict.fromkeys("BC", OPEN)
    for code in "BC":
        outcome = _by_code(result)[code]
        assert outcome.summary == NEITHER_COULD_TELL and outcome.passages == ()
        assert [(view.result, view.reason.startswith(NO_SUPPORT)) for view in outcome.views] == [
            ("CANNOT_TELL", True), ("CANNOT_TELL", True),
        ]  # fmt: skip
    assert [c.status for c in _by_code(result)["C"].checks] == ["NOT_RUN"]
    review = _review(result)
    assert review["overall"] not in ("SUFFICIENT", "POTENTIAL_EXCEPTION")
    assert review["explanation"].startswith(
        "2 of 4 requested attributes are supported. B could not be concluded: neither reading "
        "could tell from these files."
    )
    assert sorted(code for f in review["follow_ups"] for code in f["codes"]) == ["B", "B", "C"]


# 22, the gap: the fabricated quote beside a real one.
def test_an_element_is_not_supported_on_what_is_left_of_a_fabricated_citation() -> None:
    chain = _control(_ticket_file(_ticket(None)), _log_file())
    # C, "approved on or before the grant", quoted as the fabricated approval and the
    # log's real grant; the approval's date is stated as a fact, and the order named.
    answer = _reading() | {
        "files": _said(0, 1), "facts": _times(), "checks": [APPROVED_FIRST],
    }  # fmt: skip
    opinion = check_opinion(answer, chain)
    assert opinion.dropped == 3 and "F1" not in {fact.id for fact in opinion.facts}
    result = run_chain(_both(answer), chain)
    assert _stands(result)["B"] == OPEN
    # No file holds the approval, so nothing shows it came before the grant.
    assert _stands(result)["C"] != SUPPORTED


# 23. Both agents agreeing on an objectively incorrect conclusion.
def test_two_readings_that_agree_do_not_stand_against_the_dates_they_state() -> None:
    chain = _control(_ticket_file(_ticket(LATE_APPROVED)), _log_file())
    # Both readings call every attribute met, C included, on verified passages; both state
    # the two times and name the comparison C calls for.
    answer = _reading(LATE_APPROVED) | {
        "files": _said(0, 1), "facts": _times(LATE_APPROVED), "checks": [APPROVED_FIRST],
    }  # fmt: skip
    opinion = check_opinion(answer, chain)
    assert [view.result for view in opinion.views] == ["MET"] * 4
    # By agreement alone all four would be supported.
    assert [o.verdict for o in compare(opinion, opinion, chain)] == ["SUPPORTED"] * 4
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABD", SUPPORTED) | {
        "C": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    late = _by_code(result)["C"]
    assert late.summary == f"A check of the records shows attribute C is not met: {LATE_TEXT}"
    assert late.shows is None and late.views == () and late.absent == ()
    assert [c.status for c in late.checks] == ["FAILED"]
    assert late.elements[0].deviation
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. C is contradicted by the records: "
        f"{LATE_TEXT} {POTENTIAL}"
    )
    [follow_up] = review["follow_ups"]
    assert (follow_up["kind"], follow_up["raised_by"]) == ("CLARIFICATION", ["CODE"])


# 24. Independent reviewer detecting an overlooked material gap.
def test_a_gap_only_the_reviewer_sees_is_unsettled_and_the_reviewers_follow_up_is_kept() -> None:
    chain = _control(_ticket_file(_ticket(BARE_APPROVED)), _log_file())
    # The first reading takes the approval for the manager's. The second does not: the
    # ticket names the approver and nothing designates him.
    first = _reading(BARE_APPROVED) | {"files": _said(0, 1)}
    second = _reading(
        BARE_APPROVED,
        B=[
            _shown((0, BARE_APPROVED), key="condition"),
            _lacks(NO_ROLE, key="pass", reason="The approver's role is not shown."),
        ],
    ) | {
        "files": _said(0, 1),
        "follow_ups": [
            _ask("B", "pass", ROLE_REQUEST, missing="The approver's role.",
                 why="The approval counts only if the approver is the user's manager.",
                 priority="HIGH"),
        ],
    }  # fmt: skip
    result = run_chain(_two(first, second), chain)
    assert _stands(result) == dict.fromkeys("ACD", SUPPORTED) | {"B": OPEN}
    approval = _by_code(result)["B"]
    assert approval.summary == UNSETTLED_TEXT and approval.passages == ()
    assert [(view.role, view.result) for view in approval.views] == [
        ("ASSESSOR", "MET"), ("REVIEWER", "PARTLY_MET"),
    ]  # fmt: skip
    # The element both find shown is shown; the one they differ on is open.
    assert [(e.key, e.result) for e in approval.elements] == [("condition", "MET"), ("pass", None)]
    review = _review(result)
    assert review["follow_ups"] == [
        {
            "key": f"{B}:pass", "attribute_ids": [str(B)], "codes": ["B"], "elements": ["pass"],
            "missing": "The approver's role.",
            "why": "The approval counts only if the approver is the user's manager.",
            "request": ROLE_REQUEST, "alternatives": "", "kind": "EVIDENCE", "priority": "HIGH",
            "raised_by": ["REVIEWER"], "status": "OPEN", "keys": [f"{B}:pass"],
        }
    ]  # fmt: skip
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. B could not be concluded: the two readings "
        "do not agree. 1 follow-up would resolve what is open."
    )


# 25. Agent proposing unnecessary follow-ups.
def test_follow_ups_for_elements_that_are_shown_are_dropped_and_counted() -> None:
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1)}
    first = answer | {
        "follow_ups": [
            _ask("B", "pass", "Provide a second approval by the role owner.", priority="HIGH"),
            _ask("D", "wording", "Provide a screenshot of the user's roles as they stand today."),
        ]
    }
    second = answer | {
        "follow_ups": [_ask("C", "wording", "Provide the approver's confirmation by email.")]
    }
    result = run_chain(_two(first, second), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    review = _review(result)
    assert review["follow_ups"] == [] and review["follow_ups_more"] == 0
    assert review["follow_ups_dropped"] == 3
    assert review["overall"] == "SUFFICIENT"
    assert review["explanation"] == f"All 4 requested attributes are supported. {NOTHING_MORE}"


# 26. Agent requesting evidence already provided.
def test_a_request_for_evidence_already_among_the_files_is_dropped() -> None:
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1)}
    # The second reading rests C and D on the log and still asks for it, and for the
    # ticket's approval it has just quoted.
    second = answer | {
        "follow_ups": [
            _ask("C", "wording", GRANT_REQUEST, may_be_in_files=True),
            _ask("D", "wording", GRANT_REQUEST, may_be_in_files=True),
            _ask("B", "condition", "Provide the approval of REQ-1041.", may_be_in_files=True),
        ]
    }
    result = run_chain(_two(answer, second), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    review = _review(result)
    assert review["follow_ups"] == [] and review["follow_ups_dropped"] == 3
    assert review["overall"] == "SUFFICIENT"
    assert review["explanation"] == f"All 4 requested attributes are supported. {NOTHING_MORE}"


# 27. New evidence resolving an outstanding gap.
def test_new_evidence_that_shows_the_open_elements_resolves_the_follow_up() -> None:
    before = run_chain(_two(*_without_the_grant()), _control(_ticket_file()))
    earlier = _review(before)
    [open_follow_up] = earlier["follow_ups"]
    assert earlier["overall"] == "ADDITIONAL_EVIDENCE" and earlier["resolved"] == []
    assert open_follow_up["keys"] == [f"{C}:wording", f"{D}:wording"]
    # The log arrives, and both readings now find C and D shown by it.
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1), "facts": _times(), "checks": [APPROVED_FIRST]}
    after = run_chain(_both(answer), chain, earlier["follow_ups"])
    assert _stands(after) == dict.fromkeys("ABCD", SUPPORTED)
    review = _review(after)
    assert review["resolved"] == [
        {"key": f"{C}:wording", "request": GRANT_REQUEST, "codes": ["C", "D"]}
    ]
    assert review["follow_ups"] == [] and review["overall"] == "SUFFICIENT"
    # A file arriving resolves nothing by itself: while the readings still do not find the
    # elements shown, the follow-up stays open and is not listed as resolved.
    first, second = _without_the_grant()
    said = {"files": _said(0, 1)}
    still = run_chain(_two(first | said, second | said), chain, earlier["follow_ups"])
    assert _review(still)["resolved"] == []
    assert [f["request"] for f in _review(still)["follow_ups"]] == [GRANT_REQUEST]


# 28. New evidence revealing a contradiction.
def test_new_evidence_that_shows_the_grant_came_first_is_a_potential_exception() -> None:
    before = run_chain(_two(*_without_the_grant()), _control(_ticket_file()))
    earlier = _review(before)
    assert _stands(before)["C"] == ("ISSUE", "NOT_MET", "NOT_DEMONSTRATED")
    # The log arrives: the role was assigned the day before the approval.
    chain = _control(_ticket_file(), _log_file(_log(EARLY_GRANTED)))
    answer = _reading(
        granted=EARLY_GRANTED,
        C=_deviates((0, APPROVED), (1, EARLY_GRANTED), reason="Granted before it was approved."),
    ) | {
        "files": _said(0, 1),
        "facts": _times(granted=EARLY_GRANTED),
        "checks": [APPROVED_FIRST],
    }
    after = run_chain(_both(answer), chain, earlier["follow_ups"])
    sentence = "Approved 2 March 2027 10:05, performed 1 March 2027 08:45: the approval is after."
    # What was not demonstrated is now contradicted by the records. D is shown.
    assert _stands(after) == dict.fromkeys("ABD", SUPPORTED) | {
        "C": ("ISSUE", "NOT_MET", "CONTRADICTED")
    }
    assert _by_code(after)["C"].summary == (
        f"A check of the records shows attribute C is not met: {sentence}"
    )
    review = _review(after)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. C is contradicted by the records: "
        f"{sentence} {POTENTIAL}"
    )
    # The earlier follow-up asked for the record that would show C and D. C is not shown
    # (the record shows it is not met), so it is not called resolved.
    assert review["resolved"] == []
    [follow_up] = review["follow_ups"]
    assert (follow_up["codes"], follow_up["kind"], follow_up["raised_by"]) == (
        ["C"], "CLARIFICATION", ["CODE"],
    )  # fmt: skip


# 29. Custody hash mismatch.
def test_a_file_that_fails_its_custody_check_is_held_whatever_else_is_true_of_it() -> None:
    reason = "The stored file no longer matches its custody record, so it is not checked."
    assert HELD_REASONS["CUSTODY"] == reason
    for other in (
        {},
        {"kind_confirmed": True, "confidence": "high", "source": "MODEL"},
        {"readable": False},
        {"read_failed": True},
        {"confidence": "low", "source": "RULES"},
        {"kind": "population"},
    ):
        facts = _facts(custody_failed=True, **other)
        for engine_version in (1, 2):
            for population_asked in (False, True):
                held = gate(facts, engine_version, population_asked=population_asked)
                assert held is not None and (held.code, held.reason) == ("CUSTODY", reason), other
    held = gate(_facts(custody_failed=True), 2)
    assert held is not None
    # Alone on the request, the whole check is held for custody and no reading is asked.
    assert run_gate([(held, 900)], 4) == held
    # The same file with its custody intact is read.
    assert gate(_facts(), 2) is None


# 30. Model unavailable, requiring classification fallback.
def test_a_file_classified_by_the_rules_is_read_and_listed_for_confirmation() -> None:
    for source in ("RULES", "FALLBACK"):
        by_rules = _facts(source=source, confidence="high")
        assert kind_unsure(by_rules)
        # The first engine held it until a person confirmed its kind; engine 2 reads it.
        held = gate(by_rules, 1)
        assert held is not None and held.code == "KIND_UNSURE"
        assert gate(by_rules, 2) is None
        # A kind a person confirmed is no longer unsure.
        assert not kind_unsure(_facts(source=source, kind_confirmed=True))
    chain = _control(
        replace(_ticket_file(), kind_unsure=True),
        replace(_log_file(), kind_unsure=True),
    )
    result = run_chain(_both(_reading() | {"files": _said(0, 1)}), chain)
    review = _review(result)
    assert review["confirmations"] == [
        {
            "file_id": str(F0),
            "code": "KIND_UNSURE",
            "reason": (
                "The reader is not sure what kind of evidence ticket REQ-1041.txt is; it was "
                "read as a walkthrough record. Confirm its kind."
            ),
        },
        {
            "file_id": str(F1),
            "code": "KIND_UNSURE",
            "reason": (
                "The reader is not sure what kind of evidence workday security log.txt is; it "
                "was read as a change history or audit log. Confirm its kind."
            ),
        },
    ]
    # What the files show is judged all the same.
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    assert review["overall"] == "SUFFICIENT"


UNDATED = "WD_SECURITY assigned role HR_PARTNER_VIEW to JREYES"
NO_DATE = "The date the role was assigned: the log's entry carries none."


# 31. An attribute not demonstrated without evidence of actual failure.
def test_an_attribute_nothing_shows_and_nothing_contradicts_is_not_demonstrated() -> None:
    # The log's entry has no date: nothing shows the approval came first, and nothing
    # shows it did not.
    chain = _control(_ticket_file(), _log_file(f"{LOG_HEAD}{UNDATED} (ticket REQ-1041)\n"))
    request = "Provide the Workday security audit log entry for REQ-1041 with its timestamp."
    answer = _reading(
        granted=UNDATED, C=_lacks(NO_DATE, (0, APPROVED), (1, UNDATED))
    ) | {
        "files": _said(0, 1),
        "facts": [_fact("F1", "APPROVED_AT", "2027-03-02 10:05", 0, APPROVED)],
        "checks": [APPROVED_FIRST],
        "follow_ups": [_ask("C", "wording", request, priority="HIGH")],
    }  # fmt: skip
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABD", SUPPORTED) | {
        "C": ("ISSUE", "NOT_MET", "NOT_DEMONSTRATED")
    }
    timing = _by_code(result)["C"]
    assert timing.summary == "Both readings find the evidence does not show attribute C."
    assert timing.absent == (NO_DATE,)
    # The passages are what the readings looked at, not a record of a deviation.
    assert not any(element.deviation for element in timing.elements)
    # The comparison could not be made, and that is not a failure.
    assert [c.status for c in timing.checks] == ["NOT_RUN"]
    review = _review(result)
    assert review["overall"] == "ADDITIONAL_EVIDENCE"
    assert all(o.assessment != "CONTRADICTED" for o in result.outcomes)
    assert review["explanation"] == (
        f"3 of 4 requested attributes are supported. C is not demonstrated: not shown: {NO_DATE} "
        "1 follow-up would resolve what is open."
    )
    assert "exception" not in review["explanation"]
    [follow_up] = review["follow_ups"]
    assert (follow_up["request"], follow_up["kind"]) == (request, "EVIDENCE")


# 32. A demonstrated contradiction despite another unreadable file.
def test_an_exception_the_records_show_is_not_hidden_by_an_unreadable_file() -> None:
    chain = _control(
        _ticket_file(_ticket(SELF_APPROVED)),
        _log_file(),
        files_left_out=True,
        left_out_names=("approval email scan.pdf",),
        left_out=(LeftOut("approval email scan.pdf", "UNREADABLE", HELD_REASONS["UNREADABLE"]),),
    )
    # Both readings show it on the ticket's own record: the requester approved it.
    answer = _reading(
        SELF_APPROVED,
        B=[
            _shown((0, SELF_APPROVED), key="condition"),
            _deviates((0, SELF_APPROVED), key="pass", reason="Approved by the requester."),
        ],
    ) | {"files": _said(0, 1)}
    result = run_chain(_both(answer), chain)
    # What was not read may answer it (the manager's approval may be in the scan), so the
    # verdict stays a person's and no issue is recorded. It is still said for what it is.
    assert _stands(result) == dict.fromkeys("ACD", SUPPORTED) | {
        "B": ("UNSETTLED", None, "CONTRADICTED")
    }
    approval = _by_code(result)["B"]
    assert approval.summary == UNCHECKED_EXCEPTION
    assert approval.summary == (
        "The evidence shows an exception, but a file on this request has not been read yet "
        "and may answer it. Your judgment is needed."
    )
    assert approval.passages == () and approval.absent == ()
    assert [(view.role, [p.quote for p in view.passages]) for view in approval.views] == [
        ("ASSESSOR", [SELF_APPROVED]), ("REVIEWER", [SELF_APPROVED]),
    ]  # fmt: skip
    assert [(e.key, e.deviation) for e in approval.elements] == [
        ("condition", False), ("pass", True),
    ]  # fmt: skip
    review = _review(result)
    assert review["overall"] == "POTENTIAL_EXCEPTION"
    assert review["completeness"] == {
        "state": "PARTLY_UNREADABLE",
        "reasons": [
            "approval email scan.pdf could not be read: Nothing readable was extracted from "
            "the file, so a person reads it."
        ],
    }
    assert review["explanation"] == (
        "3 of 4 requested attributes are supported. B is contradicted by the records: the "
        f"records show “{SELF_APPROVED}”. {POTENTIAL}"
    )
    # Nothing is asked of the organization while the unread file is the next step.
    assert review["follow_ups"] == []


# 33. Agent inventing requirements not supported by the approved control understanding.
def test_a_requirement_a_reading_invents_changes_no_verdict_and_no_outcome() -> None:
    chain = _control(_ticket_file(), _log_file())
    answer = _reading() | {"files": _said(0, 1)}
    demand = (
        "Access to HR_PARTNER_VIEW should also be recertified every quarter; the control "
        "should require it and the recertification should be obtained."
    )
    inventing = _reading(E=_lacks("No quarterly recertification of the role.")) | {
        "files": _said(0, 1),
        "follow_ups": [
            # An attribute that does not exist, and an element B does not have.
            _ask("E", "wording", "Provide the quarterly recertification of HR_PARTNER_VIEW.",
                 priority="HIGH"),
            _ask("B", "second_approver", "Provide the role owner's approval of REQ-1041.",
                 priority="HIGH"),
        ],
        "checks": [{"attribute": "E", "element": "wording", "test": "IN_PERIOD", "left": "F1"}],
        "considerations": [{"text": demand, "file": 0, "quote": ACCESS}],
    }  # fmt: skip
    plain = run_chain(_both(answer), chain)
    result = run_chain(_two(inventing, answer), chain)
    # The attributes are the approved four, judged exactly as without the inventions.
    assert [o.code for o in result.outcomes] == ["A", "B", "C", "D"]
    assert _stands(result) == _stands(plain) == dict.fromkeys("ABCD", SUPPORTED)
    assert all(outcome.checks == () for outcome in result.outcomes)
    review = _review(result)
    assert review["follow_ups"] == [] and review["follow_ups_dropped"] == 2
    # The demand stays what it is, an observation by one reading with its passage: no
    # attribute, no follow-up, no change to the outcome.
    [consideration] = review["considerations"]
    assert (consideration["text"], consideration["raised_by"]) == (demand, ["ASSESSOR"])
    assert consideration["passages"][0]["quote"] == ACCESS
    assert review["overall"] == _review(plain)["overall"] == "SUFFICIENT"
    assert review["explanation"] == _review(plain)["explanation"]
    assert review["concerns"] == []


# 34. Sufficient evidence with no additional follow-up necessary.
def test_sufficient_evidence_needs_nothing_more_and_says_so() -> None:
    chain = _control(_ticket_file(), _log_file())
    # Neither reading asks for anything: nothing more is needed.
    answer = _reading() | {"files": _said(0, 1), "facts": _times(), "checks": [APPROVED_FIRST]}
    result = run_chain(_both(answer), chain)
    assert _stands(result) == dict.fromkeys("ABCD", SUPPORTED)
    assert _review(result) == {
        "overall": "SUFFICIENT",
        "explanation": f"All 4 requested attributes are supported. {NOTHING_MORE}",
        "completeness": {"state": "COMPLETE", "reasons": []},
        "context_thin": False,
        "files": [
            {"file_id": str(file_id), "relevance": "RELEVANT", "source": "SYSTEM_RECORD",
             "legibility": "CLEAR", "report_basis": "NOT_A_REPORT", "notes": []}
            for file_id in (F0, F1)
        ],
        "confirmations": [],
        "concerns": [],
        "follow_ups": [],
        "follow_ups_more": 0,
        "follow_ups_dropped": 0,
        "resolved": [],
        "considerations": [],
    }  # fmt: skip
    # Sufficient is a proposal for the request: no attribute is an issue, and each rests
    # on passages both readings quote.
    assert all(outcome.passages and not outcome.views for outcome in result.outcomes)
