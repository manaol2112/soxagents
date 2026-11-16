"""The D&I conclusion, signed by a reviewer (product owner, 8 November 2026; migration 0143).

Operating effectiveness is tested only for a control designed and implemented effectively
(AS 2201; the owner: "OE can't start if design is failing"). The design and implementation
(D&I) result used to be only the design workpaper being prepared, with no reviewer before OE.
It is now a sign-off of its own.

- The records propose the verdict: once the design workpaper is prepared, the design is
  effective unless an unremediated design deficiency is logged against the control.
- A team member with the reviewer role, who did not prepare the design workpaper, confirms
  that verdict for the workpaper at its prepared version. They cannot sign a different
  verdict: a disagreement is a design deficiency to log, or the workpaper to reopen.
- The sign-off stands while the records it rests on stand. Reopening the design workpaper
  opens the conclusion again. A newly logged or remediated design deficiency makes it out of
  date, and the reviewer signs again. A reviewer can open it again with a reason.
- An exception a person recorded on an attribute (a tickmark of kind EXCEPTION;
  docs/evidence-assurance.md, sections 10.13 and 10.15) is never signed over as
  effective: while one stands and no design deficiency does, the conclusion says so
  (`blocking`, one sentence per attribute) and the sign-off is refused with it. Every
  exception standing on a D&I request of the control that is not removed, on an attribute
  that is approved, counts, whatever the state of the request's check (current, out of
  date, held, failed, queued, working, or the request set aside): a person's exception
  stands until a person reopens or replaces it, and a file added to the request does not
  take it out of the reviewer's way (independent review, 15 November 2026: one on a
  request waiting to be checked again was signed over as effective). `exceptions` says of
  each whether its request's check is current (`check_current`). With a design deficiency
  standing the rule above applies (not effective). A tickmark, or a decision on a file's
  reliability, recorded or ended after the sign-off puts it out of date, and the reason
  names the attributes and the files; so does an exception that stands unanswered under
  a sign-off as effective, however it came to (on a request restored after it was
  removed, on an attribute approved again).

The preparer concludes; the agent proposes (product owner, 15 November 2026;
docs/design-workpaper.md, section 3.6; migration 0165). This replaces "the records propose
the verdict and the reviewer signs exactly it":

- The records propose one of five conclusions (`proposed_conclusion`, with one sentence
  per reason), whenever the conclusion is read: not effective where a design deficiency
  stands; else exceptions noted where any attribute's state is an exception (the check's,
  or one a person recorded); else not concluded where the design or the implementation
  is still open (design alone, without the instance, is not effective); else effective.
  The design and implementation results are worked out once, from the attributes as the
  design workpaper assembles them (`results_of`).
- The preparer records the conclusion (`choose`) on the draft design workpaper: a person
  with TASK_UPDATE, never an agent, while the workpaper is a draft that is not being
  drafted. One choice stands per control; the next replaces it, and a stale `replaces`
  is refused. Effective is refused while a design deficiency or an exception stands or
  the design or the implementation is open; exceptions noted and no instance while a
  design deficiency stands; no instance also unless the design result is DESIGNED (its
  words say the design is effective).
- The reviewer signs the preparer's standing choice, recorded before the workpaper was
  prepared, while its rules still hold; not effective also needs a standing design
  deficiency. A person's standing exception blocks a sign-off of effective (and of no
  instance, which says the design is effective) as before, never one of exceptions noted
  or not effective, which conclude on it. `verdict` stays the two values every reader
  uses: not effective for not effective, effective for the other three that are signed.
  Not concluded is never signed. A sign-off no longer holds once the standing choice
  changed after it.

Tightened after the independent review (15 November 2026; docs/design-workpaper.md, section
3.6, last part). Each closes a way a conclusion could be signed, or keep clearing OE,
without resting on the records:

- Independence covers the conclusion itself: where independence is required, the person
  who recorded the standing choice cannot sign it, as the workpaper's preparer cannot.
- Exceptions noted needs an exception on record (the check's or a person's) and every
  other approved attribute shown in the records of an instance or settled by a closing
  tickmark, at the choice and again at the sign-off; at the sign-off also no exception
  noted after the choice was recorded. "Noted after" compares, with the choice's
  `recorded_at`: a person's exception's own `recorded_at`; for an exception a check shows,
  the `finished_at` of the latest current check run that shows it on the attribute (a run
  with no finish time counts as after). The proposal follows: with an exception and other
  attributes still open it is not concluded, and its reasons name both.
- A sign-off made from a preparer's choice stops holding when the rule that allowed its
  conclusion would refuse it on the records as they are now (`_Facts.rule_broken`): the
  reason is the rule's own sentence. `design_verdict`, `oe_gate_reason` and
  `effective_controls` all read it (`_held`). A sign-off made before choices were recorded
  (no `choice_id`) is held to the rules it was signed under only, as before; so is one the
  demo seeded (`_STANDING`: on a demo engagement and signed by a demo identity, two
  markers the database sets only in demo initialization and never changes).
- The sign-off names the choice it signs (`choice_id`); one that is not the standing
  choice is refused. The two-value `verdict` is no longer accepted in the body.
- Recording a choice bumps the design workpaper's `version`, so a Prepare sent from a page
  that has not seen the choice is refused as stale.

What the gate costs. The rule needs the attributes as the design workpaper assembles them:
the control's D&I requests, their checks, tickmarks and decisions. They are read once per
control per call, in one read with the person's exceptions
(`design_workpaper.conclusion_records`), and only where the answer depends on them: never
for a sign-off that something cheaper already puts out of date, one not held to the rule,
or one of not effective (which the rule never refuses). `effective_controls` leaves out,
in its one query, the sign-offs whose workpaper is not prepared at the signed version or
whose choice is no longer the standing one.

`design_verdict` is what the OE gate reads: the verdict signed off and still current, or None.
"""

from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from ai_workforce_api import (
    attribute_dispositions,
    file_reliability,
    independence,
    workpaper_review_notes,
)
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.control_reviews import _is_reviewer, reopen_review_for
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_assurance import attribute_letter
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.settings import Settings

Verdict = Literal["EFFECTIVE", "NOT_EFFECTIVE"]
Status = Literal["NOT_READY", "TO_SIGN", "SIGNED_OFF", "OUT_OF_DATE"]
# The preparer's conclusion (section 3.6). The first four can be signed.
DesignConclusionKind = Literal[
    "EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE", "NOT_CONCLUDED"
]
SignedKind = Literal["EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE"]
# What a not effective conclusion rests on.
Basis = Literal["DESIGN", "IMPLEMENTATION", "BOTH"]
# How a current check shows an attribute that reads "Shown": in the records of an instance,
# only as a document requires it, or only on files a person decided are not relied on
# (which shows nothing: neither the design nor the implementation counts it).
ShownBy = Literal["IMPLEMENTATION", "DESIGN", "NOT_RELIED"]
_SHOWING: frozenset[str] = frozenset({"IMPLEMENTATION", "DESIGN"})
ResultKind = Literal["IN_PLACE", "DESIGNED", "EXCEPTIONS", "OPEN"]

KINDS: tuple[DesignConclusionKind, ...] = (
    "EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE", "NOT_CONCLUDED",
)  # fmt: skip
KIND_WORDS: dict[str, str] = {
    "EFFECTIVE": "Effective",
    "EXCEPTIONS_NOTED": "Exceptions noted",
    "NOT_EFFECTIVE": "Not effective",
    "NO_INSTANCE": "Design effective, no instance to walk through",
    "NOT_CONCLUDED": "Not concluded",
}
# The conclusions that always need the preparer's reason, whatever the proposal.
REASON_ALWAYS: frozenset[str] = frozenset({"EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE"})
REASON_MIN = 10
REASON_MAX = 1000
# How much of the reason an audit event carries.
AUDIT_REASON = 200
CHOSEN = "design_conclusion.chosen"
# The attribute states (design_workpaper.AttributeState) a person's closing tickmark
# reads by, and those that are an exception: the check's, or one a person recorded.
_CLOSED_STATES: frozenset[str] = frozenset({"SHOWN_ON_REVIEW", "NOT_APPLICABLE", "NOT_AVAILABLE"})
_EXCEPTION_STATES: frozenset[str] = frozenset({"EXCEPTION", "EXCEPTION_RECORDED"})

# The refusals of the preparer's choice and of the sign-off, each one sentence.
DRAFT_FIRST = "draft the design workpaper first"
PREPARED_ALREADY = "the design workpaper is prepared; reopen it to change the conclusion"
BEING_DRAFTED = "the design workpaper is being drafted; wait for the draft to finish"
CHOICE_STALE = "the conclusion changed since the page loaded; refresh and try again"
CHOICE_RECORDED_SINCE = (
    "another conclusion was recorded since the page loaded; refresh and try again"
)
NO_CHOICE = "the preparer has not recorded a conclusion"
NEVER_SIGNED = "the preparer's conclusion is “Not concluded”, which is never signed"
RECORDED_AFTER = (
    "the preparer's conclusion was recorded after the design workpaper was prepared; "
    "reopen the workpaper and prepare it again"
)
DEFICIENCY_FIRST = "log the design deficiency first"
# No instance says the design is effective: refused unless the design result is DESIGNED.
DESIGN_NOT_SHOWN = (
    "the design is not shown yet: Design effective needs every attribute shown as designed "
    "or settled by a tickmark"
)
CHOICE_CHANGED = "the preparer's conclusion changed"
# Tightened after the independent review (15 November 2026; section 3.6, last part).
RECORDER_CANNOT_SIGN = "you recorded this conclusion; another reviewer must sign it off"
EXCEPTIONS_NEEDED = (
    "Exceptions noted needs an exception on record and every other attribute shown or settled"
)
EXCEPTION_SINCE = (
    "an exception was noted after this conclusion was recorded; the preparer records it again"
)
CHOICE_NOT_STANDING = "the preparer's conclusion changed; read it again"
REASON_NEEDED = f"give the reason in a sentence of at least {REASON_MIN} characters"
REASON_TOO_LONG = f"the reason can be at most {REASON_MAX} characters"
BASIS_NEEDED = "say whether the design, the implementation or both are not effective"
BASIS_NOT_TAKEN = "a basis is given only for a conclusion of “Not effective”"

# A design deficiency counts against the design until it is remediated or closed.
_STANDING_DEFICIENCY = ("OPEN", "REMEDIATION_IN_PROGRESS", "READY_FOR_RETEST")

# Why a standing sign-off no longer holds: a design deficiency logged since; and, of a
# person's tickmarks (section 10.15, item 5), an exception that stands unanswered.
DEFICIENCY_LOGGED_SINCE = "a design deficiency was logged after the sign-off"
EXCEPTION_UNANSWERED = (
    "an exception is recorded on an attribute and no design deficiency is logged for it"
)
# How many attributes or files a reason names before it says "and N more".
NAMED_MOST = 3
# A file's name in a reason: one cleaned line, bounded.
FILE_NAME_LIMIT = 120


def _listed(names: Sequence[str], total: int) -> str:
    """The first names (at most NAMED_MOST) of `total` things: "B", "A and B",
    "A, B and C", "A, B, C and 2 more"."""
    shown = list(names[:NAMED_MOST])
    more = total - len(shown)
    if more > 0:
        return f"{', '.join(shown)} and {more} more"
    return shown[0] if len(shown) == 1 else f"{', '.join(shown[:-1])} and {shown[-1]}"


def tickmarks_changed(codes: Sequence[str], unlisted: int = 0) -> str:
    """Why a sign-off no longer holds, where a tickmark was recorded, changed, reopened or
    ended after it: the reason names the attributes, in their order, at most NAMED_MOST
    and then how many more. `unlisted` counts those on an attribute that is no longer
    approved (it has no letter)."""
    total = len(codes) + unlisted
    if not codes:
        return (
            "a tickmark on an attribute no longer approved changed after the sign-off"
            if total == 1
            else f"tickmarks on {total} attributes no longer approved changed after the sign-off"
        )
    shown = min(len(codes), NAMED_MOST)
    return (
        f"{'a tickmark' if total == 1 else 'tickmarks'} on "
        f"{'attribute' if shown == 1 else 'attributes'} {_listed(codes, total)} "
        "changed after the sign-off"
    )


def decisions_changed(file_names: Sequence[str]) -> str:
    """Why a sign-off no longer holds, where a decision on a file's reliability was
    recorded, changed, reopened or ended after it: the reason names the files, at most
    NAMED_MOST and then how many more."""
    names = [clean_line(name, FILE_NAME_LIMIT).strip() or "a file" for name in file_names]
    return (
        f"the reliability {'decision' if len(names) == 1 else 'decisions'} on "
        f"{_listed(names, len(names))} changed after the sign-off"
    )


def exception_sentence(code: str, check_current: bool = True) -> str:
    """What keeps a reviewer from signing while an exception a person recorded on the
    attribute stands and no design deficiency does. Where the request it is recorded on
    has no current check (out of date, held, failed, queued, working, never checked), the
    sentence says so: the tickmark is then not shown on the request until it is checked
    again, and it is reopened, with a reason, rather than changed."""
    if check_current:
        return (
            f"An exception is recorded on attribute {code}. Log a design deficiency for it, "
            "or change the tickmark with your reason."
        )
    return (
        f"An exception is recorded on attribute {code}, on a request waiting to be checked "
        "again. Log a design deficiency for it, or reopen the tickmark with your reason."
    )


class DesignConclusionState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ChoiceInvalid(Exception):
    """A choice missing what its conclusion needs (a basis or a reason), or with what it
    does not take: answered as 422 with its one sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- Design and implementation, and the proposal (pure) ---------------------------------

NO_ATTRIBUTES = "No attribute of the control is approved yet."
DESIGNED_SENTENCE = (
    "Every attribute is shown, as designed or in the instance, or closed by a tickmark."
)
IN_PLACE_SENTENCE = (
    "Every attribute is shown in the records of the instance, or closed by a tickmark."
)
NO_DEFICIENCY_NOR_EXCEPTION = "No design deficiency is logged and no exception stands."


@dataclass(frozen=True)
class AttributeStanding:
    """One approved attribute as the design workpaper assembles it: its letter, its state
    (design_workpaper.AttributeState) and how a current check shows it (`shown_by`). For
    an attribute whose state is the check's exception, `found_at` is when the latest
    current check that shows the exception finished (None where the run has no finish
    time)."""

    code: str
    state: str
    shown_by: ShownBy | None = None
    found_at: datetime | None = None


class ResultBody(BaseModel):
    """The design or the implementation result, with one sentence and the letters of the
    attributes not yet settled for it."""

    result: ResultKind
    sentence: str
    open: list[str] = Field(default_factory=list)


def _open_result() -> ResultBody:
    return ResultBody(result="OPEN", sentence=NO_ATTRIBUTES, open=[])


@dataclass(frozen=True)
class Results:
    design: ResultBody
    implementation: ResultBody
    # The attributes on which an exception stands, in the attributes' order.
    exceptions: tuple[str, ...] = ()
    # The other attributes not yet shown in the records of an instance nor settled by a
    # closing tickmark, in the attributes' order: what "Exceptions noted" cannot leave open.
    others_open: tuple[str, ...] = ()
    # For each attribute whose state is the check's exception, when the latest current
    # check that shows it finished (None where unknown).
    found: tuple[datetime | None, ...] = ()

    def found_since(self, when: datetime) -> bool:
        """Whether a current check that shows an exception finished after `when`. A run
        with no finish time counts as after: it is never assumed to have been seen."""
        return any(at is None or at > when for at in self.found)


def _attributes(codes: Sequence[str], capital: bool = False) -> str:
    """ "attribute B", "attributes A and C", "attributes A, B, C and 2 more"."""
    word = "attribute" if len(codes) == 1 else "attributes"
    if capital:
        word = word.capitalize()
    return f"{word} {_listed(codes, len(codes))}"


def _not_yet(codes: Sequence[str], where: str) -> str:
    verb = "is" if len(codes) == 1 else "are"
    return f"{_attributes(codes, capital=True)} {verb} not yet shown{where}."


def _exceptions_sentence(codes: Sequence[str]) -> str:
    if len(codes) == 1:
        return f"An exception stands on {_attributes(codes)}."
    return f"Exceptions stand on {_attributes(codes)}."


def results_of(attributes: Sequence[AttributeStanding], excepted: Collection[str] = ()) -> Results:
    """The design and the implementation result of the control, from its approved
    attributes as assembled (section 3.6), in the attributes' order. `excepted` are the
    letters of attributes on which a person's exception stands, whatever its request's
    check (`ExceptionRef.code`): such an attribute is an exception even where its state
    does not read as one.

    - Implementation: IN_PLACE where every attribute is shown by the records of the
      instance or reads by a person's closing tickmark; EXCEPTIONS where any attribute is
      an exception; otherwise OPEN, with the letters not yet shown in the instance.
    - Design: DESIGNED where every attribute is shown (as designed or in the instance) or
      reads by a closing tickmark; EXCEPTIONS as above; otherwise OPEN, with the letters.

    With no approved attribute both are OPEN: nothing has been concluded on."""
    if not attributes:
        return Results(_open_result(), _open_result())
    excepted_codes = set(excepted)
    exceptions = tuple(
        a.code for a in attributes if a.state in _EXCEPTION_STATES or a.code in excepted_codes
    )
    designed_open = [
        a.code
        for a in attributes
        if not (a.state in _CLOSED_STATES or (a.state == "SHOWN" and a.shown_by in _SHOWING))
    ]
    implemented_open = [
        a.code
        for a in attributes
        if not (
            a.state in _CLOSED_STATES or (a.state == "SHOWN" and a.shown_by == "IMPLEMENTATION")
        )
    ]
    if exceptions:
        sentence = _exceptions_sentence(exceptions)
        return Results(
            ResultBody(result="EXCEPTIONS", sentence=sentence, open=designed_open),
            ResultBody(result="EXCEPTIONS", sentence=sentence, open=implemented_open),
            exceptions,
            tuple(code for code in implemented_open if code not in exceptions),
            tuple(a.found_at for a in attributes if a.state == "EXCEPTION"),
        )
    design = (
        ResultBody(result="DESIGNED", sentence=DESIGNED_SENTENCE)
        if not designed_open
        else ResultBody(
            result="OPEN",
            sentence=_not_yet(designed_open, ", as designed or in an instance"),
            open=designed_open,
        )
    )
    implementation = (
        ResultBody(result="IN_PLACE", sentence=IN_PLACE_SENTENCE)
        if not implemented_open
        else ResultBody(
            result="OPEN",
            sentence=_not_yet(implemented_open, " in the records of an instance"),
            open=implemented_open,
        )
    )
    return Results(design, implementation)


def _deficiencies_sentence(count: int) -> str:
    if count == 1:
        return "A design deficiency is logged against the control."
    return f"{count} design deficiencies are logged against the control."


def proposal_of(deficiencies: int, results: Results) -> tuple[DesignConclusionKind, list[str]]:
    """The conclusion the records propose, and why, one sentence each (section 3.6), in
    this order: not effective where a design deficiency stands; else, where any attribute
    is an exception, exceptions noted, but only where the rule would accept it
    (`choice_refusal`): with another attribute still open it is not concluded, and the
    reasons name both the exception and what is open; else not concluded where the design
    or the implementation is open (design alone, without the instance, is not effective);
    else effective."""
    if deficiencies:
        return "NOT_EFFECTIVE", [_deficiencies_sentence(deficiencies)]
    if results.exceptions:
        if results.others_open:
            return "NOT_CONCLUDED", [
                results.design.sentence,
                _not_yet(results.others_open, " in the records of an instance"),
            ]
        return "EXCEPTIONS_NOTED", [results.design.sentence]
    opened = [r.sentence for r in (results.design, results.implementation) if r.result == "OPEN"]
    if opened:
        return "NOT_CONCLUDED", list(dict.fromkeys(opened))
    return "EFFECTIVE", [NO_DEFICIENCY_NOR_EXCEPTION, results.implementation.sentence]


def choice_refusal(kind: str, deficiencies: int, results: Results) -> str | None:
    """Why the conclusion cannot be recorded, or signed, on the records as they are; None
    where it can. It is also what a sign-off of the conclusion is held to afterwards
    (`_Facts.rule_broken`). Effective: while a design deficiency or an exception stands,
    or the design or the implementation is open. Exceptions noted and no instance: while a
    design deficiency stands. Exceptions noted also unless an exception stands (the
    check's or a person's) and every other attribute is shown in the records of an
    instance or settled by a closing tickmark (EXCEPTIONS_NEEDED): effective needs the
    instance, and an exception never makes OE easier to clear than no exception would. No
    instance also unless the design result is DESIGNED: its words say the design is
    effective (DESIGN_NOT_SHOWN). Not effective and not concluded: never refused here (a
    sign-off of not effective also needs a standing design deficiency: DEFICIENCY_FIRST)."""
    words = KIND_WORDS.get(kind, kind)
    if kind in ("EFFECTIVE", "EXCEPTIONS_NOTED", "NO_INSTANCE") and deficiencies:
        return _deficiency_refusal(kind)
    if kind == "EFFECTIVE":
        if results.exceptions:
            where = _attributes(results.exceptions)
            return f"an exception stands on {where}, so the conclusion cannot be “{words}”"
        implementation = results.implementation
        if results.design.result == "OPEN" or implementation.result == "OPEN":
            if not implementation.open:
                return (
                    "no attribute of the control is approved yet, so the conclusion cannot "
                    f"be “{words}”"
                )
            verb = "is" if len(implementation.open) == 1 else "are"
            return (
                f"{_attributes(implementation.open)} {verb} not yet shown in the records of "
                f"an instance, so the conclusion cannot be “{words}”"
            )
        return None
    if kind == "EXCEPTIONS_NOTED" and (not results.exceptions or results.others_open):
        return EXCEPTIONS_NEEDED
    if kind == "NO_INSTANCE" and results.design.result != "DESIGNED":
        return DESIGN_NOT_SHOWN
    return None


def _deficiency_refusal(kind: str) -> str:
    """The refusal of a conclusion that a standing design deficiency rules out."""
    words = KIND_WORDS.get(kind, kind)
    return f"a design deficiency is logged, so the conclusion cannot be “{words}”"


def reason_needed(kind: str, proposed: str) -> bool:
    """Whether the preparer's reason is needed: always for exceptions noted, not effective
    and no instance; for effective and not concluded where the choice differs from the
    proposal."""
    return kind in REASON_ALWAYS or kind != proposed


def verdict_of(kind: str) -> Verdict:
    """The two-value verdict the OE gate and every other reader use: not effective for not
    effective; effective for effective, exceptions noted and no instance. Not concluded
    is never signed and has none."""
    if kind == "NOT_EFFECTIVE":
        return "NOT_EFFECTIVE"
    if kind in ("EFFECTIVE", "EXCEPTIONS_NOTED", "NO_INSTANCE"):
        return "EFFECTIVE"
    raise ValueError(f"{kind} is never signed")


def clean_reason(raw: str | None) -> str:
    """The preparer's reason as it is kept: the person's own text, cleaned as text is
    (untrusted), at most REASON_MAX characters; "" where none is given. Refused (422)
    where it is too long, or given but shorter than REASON_MIN."""
    cleaned = clean_text(raw or "", REASON_MAX)
    if cleaned.truncated:
        raise ChoiceInvalid(REASON_TOO_LONG)
    reason = cleaned.text.strip()
    if reason and len(reason) < REASON_MIN:
        raise ChoiceInvalid(REASON_NEEDED)
    return reason


class DeficiencyRef(BaseModel):
    id: UUID
    reference: str
    title: str
    status: str


class ExceptionRef(BaseModel):
    """An exception a person recorded on an attribute (a tickmark of kind EXCEPTION) that
    stands on a D&I request of the control that is not removed. `reason` is the person's
    own text. `disposition_id` is the tickmark's id, which reopening it names.
    `check_current` is whether the request has a finished, current check: where it has
    not, the tickmark is kept and not shown on the request until it is checked again, and
    it still keeps the conclusion from being signed."""

    disposition_id: UUID
    attribute_id: UUID
    code: str
    requirement_id: UUID
    recorded_by_name: str
    recorded_at: datetime
    reason: str
    check_current: bool


class DesignWorkpaperRef(BaseModel):
    id: UUID
    status: str
    drafting: bool
    prepared_by: str | None
    prepared_version: int | None


class SignoffRecord(BaseModel):
    id: UUID
    verdict: Verdict
    # The preparer's conclusion the reviewer signed; for a sign-off made before the
    # preparer chose (migration 0165), the records' verdict, and no basis or reason.
    conclusion: SignedKind
    basis: Basis | None = None
    reason: str | None = None
    workpaper_version: int
    deficiencies: list[str]
    signed_by: str | None
    signed_at: datetime
    signoff_note: str
    reopened_at: datetime | None
    reopened_by: str | None
    reopen_reason: str
    reopened_from: str | None


class ChoiceRecord(BaseModel):
    """The preparer's conclusion that stands. `reason` is the person's own text;
    `proposed_kind` the records' proposal when it was recorded; `workpaper_version` the
    design workpaper's current version then."""

    id: UUID
    kind: DesignConclusionKind
    basis: Basis | None
    reason: str
    proposed_kind: DesignConclusionKind
    recorded_by: str | None
    recorded_at: datetime
    workpaper_version: int


class DesignConclusionBody(BaseModel):
    control_id: UUID
    status: Status
    # The verdict the records support now, once the design workpaper is prepared.
    proposed: Verdict | None
    workpaper: DesignWorkpaperRef | None
    deficiencies: list[DeficiencyRef]
    # The sign-off that stands, current or out of date.
    signed: SignoffRecord | None
    # Why a standing sign-off no longer holds.
    out_of_date: list[str]
    # What keeps a reviewer from signing now.
    blocking: list[str]
    # The exceptions a person recorded that stand on the control's D&I requests (those not
    # removed, on an approved attribute), in the attributes' order, whatever the state of
    # each request's check (`check_current`). While any stands and no design deficiency
    # does, `blocking` carries one sentence per attribute and the sign-off is refused.
    exceptions: list[ExceptionRef] = Field(default_factory=list)
    viewer_is_reviewer: bool
    viewer_prepared: bool
    independence_required: bool
    can_sign: bool
    history: list[SignoffRecord]
    # Whether the viewer recorded the preparer's conclusion that stands. Where independence
    # is required they cannot sign it: `can_sign` is false, and for a reviewer `blocking`
    # says so (RECORDER_CANNOT_SIGN).
    viewer_recorded: bool = False
    # The conclusion the records propose now, whatever the workpaper's state, and why
    # (section 3.6). `proposed` above is the two-value verdict, kept for its readers.
    proposed_conclusion: DesignConclusionKind = "NOT_CONCLUDED"
    proposed_reasons: list[str] = Field(default_factory=list)
    # The preparer's conclusion that stands, or null.
    choice: ChoiceRecord | None = None
    # Whether the viewer may record the conclusion now.
    can_choose: bool = False
    design: ResultBody = Field(default_factory=_open_result)
    implementation: ResultBody = Field(default_factory=_open_result)
    # The review notes of the design workpaper that are urgent and open or responded to
    # (docs/workpaper-review.md, section 4). While there is one, `blocking` says so and
    # the sign-off is refused.
    urgent_review_notes: int = 0


class SignOffBody(BaseModel):
    """The reviewer signs the preparer's standing conclusion: `conclusion` is its kind and
    `choice_id` the choice the reviewer read, so that one recorded since is never signed
    unread (CHOICE_NOT_STANDING). Nothing else is taken: the two-value `verdict` the
    screen sent before section 3.6 is no longer accepted."""

    model_config = ConfigDict(extra="forbid")

    conclusion: DesignConclusionKind
    choice_id: UUID
    workpaper_version: int = Field(ge=1)
    note: str = Field(default="", max_length=1000)


class ChoiceBody(BaseModel):
    """The preparer's conclusion. `replaces` is the id of the choice the person saw
    standing, or null where they saw none: where what stands now is not that, the page
    is stale and nothing is recorded. The reason is read and bounded in code
    (`clean_reason`), so that each refusal is one plain sentence."""

    model_config = ConfigDict(extra="forbid")

    kind: DesignConclusionKind
    basis: Basis | None = None
    reason: str | None = Field(default=None, max_length=4 * REASON_MAX)
    replaces: UUID | None


class ReopenBody(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


@dataclass(frozen=True)
class _Facts:
    organization_id: UUID
    # (id, status, draft_status, preparer's name, prepared_version, prepared_by,
    # prepared_at, current_version) of the design workpaper.
    workpaper: tuple[Any, ...] | None
    deficiencies: list[DeficiencyRef]
    # (id, workpaper_version, verdict, deficiencies, signed_at, choice_id, conclusion,
    # seeded with the demo) of the sign-off that stands (`_STANDING`).
    standing: tuple[Any, ...] | None
    # What a person recorded or ended after the standing sign-off, each as the reason it
    # gives: the tickmarks (by attribute), the decisions on files' reliability (by file).
    changed: tuple[str, ...] = ()
    # The exceptions a person recorded that stand, whatever their request's check.
    exceptions: tuple[ExceptionRef, ...] = ()
    # The preparer's conclusion that stands, and who recorded it.
    choice: ChoiceRecord | None = None
    choice_by: UUID | None = None
    # The approved attributes as the design workpaper assembles them; None until they are
    # read (`_facts` with `assemble`, or `_assembled`).
    attributes: tuple[AttributeStanding, ...] | None = None
    # Whether a person's exception stands on the control at all, and whether `exceptions`
    # holds them: a gate's read of a sign-off held to its rules leaves them, with the
    # attributes, until the rule is read (`_held`).
    excepted: bool = False
    exceptions_read: bool = True

    @property
    def proposed(self) -> Verdict | None:
        if self.workpaper is None or self.workpaper[1] != "PREPARED":
            return None
        return "NOT_EFFECTIVE" if self.deficiencies else "EFFECTIVE"

    def held_to_rules(self) -> bool:
        """Whether the standing sign-off is held to the rules of its own conclusion on the
        records as they are now (`rule_broken`): one a reviewer signed from a preparer's
        choice. Not one made before choices were recorded (no `choice_id`), which is held
        to the rules it was signed under only; nor one the demo seeded, on records with no
        check of the evidence."""
        standing = self.standing
        return standing is not None and standing[5] is not None and not standing[7]

    def results(self) -> Results:
        """The design and implementation results, from the attributes as the design
        workpaper assembles them and the person's exceptions that stand."""
        assert self.attributes is not None and self.exceptions_read
        return results_of(self.attributes, {exception.code for exception in self.exceptions})

    def unanswered(self) -> list[str]:
        """One sentence per attribute with an exception a person recorded, while no design
        deficiency stands: what keeps the conclusion from being signed. With a design
        deficiency standing the records propose not effective, and nothing is said here.
        An attribute's sentence says the request waits to be checked again only where none
        of its exceptions is on a current check."""
        assert self.exceptions_read
        if self.deficiencies:
            return []
        current: dict[str, bool] = {}
        for exception in self.exceptions:
            current[exception.code] = current.get(exception.code, False) or exception.check_current
        return [exception_sentence(code, on_check) for code, on_check in current.items()]

    def noted_since(self, results: Results, when: datetime) -> bool:
        """Whether an exception was recorded or found after `when` (the time a choice was
        recorded): a person's exception that stands and was recorded after it, or an
        exception a current check shows whose run finished after it."""
        assert self.exceptions_read
        return any(e.recorded_at > when for e in self.exceptions) or results.found_since(when)

    def stale(self) -> list[str]:
        """Why the standing sign-off no longer holds, as far as the records say without
        the attributes being read (empty where they say nothing, or none stands): the
        workpaper, the design deficiencies, what a person recorded since, the preparer's
        choice. A sign-off held to its conclusion's rules is then read by `rule_broken`."""
        if self.standing is None:
            return []
        reasons: list[str] = []
        if self.workpaper is None or self.workpaper[1] != "PREPARED":
            reasons.append("the design workpaper is not prepared")
        elif int(self.workpaper[4]) != int(self.standing[1]):
            reasons.append("the design workpaper was prepared again")
        signed = {str(item["id"]) for item in self.standing[3]}
        now = {str(item.id) for item in self.deficiencies}
        if now - signed:
            reasons.append(DEFICIENCY_LOGGED_SINCE)
        if signed - now:
            reasons.append("a design deficiency was remediated or closed after the sign-off")
        if self.changed:
            reasons.extend(self.changed)
        elif (
            not self.held_to_rules()
            and self.standing[6] in _BLOCKED_BY_EXCEPTIONS
            and self.unanswered()
        ):
            # Nothing changed since, and still an exception stands unanswered under a
            # sign-off as effective that is not held to its conclusion's rules (one made
            # before choices were recorded: its request was restored, its attribute
            # approved again, or it was signed before every standing exception counted):
            # the OE gate never reads a verdict signed over a standing exception. One held
            # to its rules says so by the rule's own sentence (`rule_broken`).
            reasons.append(EXCEPTION_UNANSWERED)
        # The preparer's conclusion the reviewer signed no longer stands: another was
        # recorded since (on the reopened workpaper). A sign-off made before preparers
        # chose names none, and holds while none stands.
        signed_choice = None if self.standing[5] is None else UUID(str(self.standing[5]))
        if signed_choice != (None if self.choice is None else self.choice.id):
            reasons.append(CHOICE_CHANGED)
        return reasons

    def rule_broken(self, results: Results) -> str | None:
        """Why the rule that allowed the standing sign-off's conclusion would refuse it on
        the records as they are now, in the rule's own sentence; None where it holds, and
        for a sign-off not held to it (`held_to_rules`). The rule is the choice's
        (`choice_refusal`, for the conclusion that was signed); for exceptions noted also
        that no exception was noted after the signed choice was recorded (EXCEPTION_SINCE),
        as its sign-off was held to. Not effective is never refused by it."""
        if not self.held_to_rules():
            return None
        assert self.standing is not None
        kind = str(self.standing[6])
        refusal = choice_refusal(kind, len(self.deficiencies), results)
        choice = self.choice
        if (
            refusal is None
            and kind == "EXCEPTIONS_NOTED"
            and choice is not None
            and choice.id == UUID(str(self.standing[5]))
            and self.noted_since(results, choice.recorded_at)
        ):
            return EXCEPTION_SINCE
        return refusal

    def out_of_date(self, results: Results) -> list[str]:
        """Why the standing sign-off no longer holds (empty when it holds or none stands):
        what `stale` says, then the sentence of the rule it no longer meets
        (`rule_broken`). A design deficiency logged since is said once, by its own reason."""
        reasons = self.stale()
        broken = self.rule_broken(results)
        if broken is None:
            return reasons
        assert self.standing is not None
        said = DEFICIENCY_LOGGED_SINCE in reasons
        if not (said and broken == _deficiency_refusal(str(self.standing[6]))):
            reasons.append(broken)
        return reasons

    def signing_refusals(self, results: Results) -> list[str]:
        """What keeps the preparer's standing conclusion from being signed on the records
        as they are (section 3.6), each one sentence; empty where it can be. A person's
        standing exceptions keep only effective (and no instance, which says the design is
        effective) from being signed, one sentence per attribute as before. Exceptions
        noted is also refused where an exception was noted after it was recorded."""
        choice = self.choice
        if choice is None:
            return [NO_CHOICE]
        if choice.kind == "NOT_CONCLUDED":
            return [NEVER_SIGNED]
        paper = self.workpaper
        if (
            paper is not None
            and paper[1] == "PREPARED"
            and paper[6] is not None
            and choice.recorded_at > paper[6]
        ):
            return [RECORDED_AFTER]
        if choice.kind in _BLOCKED_BY_EXCEPTIONS:
            unanswered = self.unanswered()
            if unanswered:
                return unanswered
        refusal = choice_refusal(choice.kind, len(self.deficiencies), results)
        if refusal is not None:
            return [refusal]
        if choice.kind == "EXCEPTIONS_NOTED" and self.noted_since(results, choice.recorded_at):
            return [EXCEPTION_SINCE]
        if choice.kind == "NOT_EFFECTIVE" and not self.deficiencies:
            return [DEFICIENCY_FIRST]
        return []


# The signed conclusions a person's standing exception keeps from being signed, and puts
# out of date where it stands unanswered under them: those that say the design is
# effective without concluding on the exceptions.
_BLOCKED_BY_EXCEPTIONS: frozenset[str] = frozenset({"EFFECTIVE", "NO_INSTANCE"})


def _exceptions(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[ExceptionRef]:
    """The exceptions a person recorded that stand on the control's D&I requests, each
    with whether its request's check is current, as the design workpaper's view gives them
    (design_workpaper imports this module, so it is imported here)."""
    from ai_workforce_api.design_workpaper import load_exceptions

    return load_exceptions(connection, project_id, control_id)


def _assembled(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, facts: _Facts
) -> _Facts:
    """The facts with the approved attributes as the design workpaper assembles them, and
    the person's exceptions that stand where they were not read yet: one read of the
    control's requests and checks for both (`design_workpaper.conclusion_records`, by the
    view's own rules; that module imports this one, so it is imported here)."""
    from ai_workforce_api.design_workpaper import conclusion_records

    wanted = facts.excepted and not facts.exceptions_read
    attributes, exceptions = conclusion_records(connection, project_id, control_id, wanted)
    return replace(
        facts,
        attributes=tuple(attributes),
        exceptions=tuple(exceptions) if wanted else facts.exceptions,
        exceptions_read=True,
    )


def _changed(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    attribute_ids: Sequence[UUID],
    signed_at: datetime | None,
) -> tuple[str, ...]:
    """What a person recorded or ended after the sign-off, as the reasons the conclusion
    gives: the tickmarks, naming the attributes by their letters in the attributes' order
    (the letters of the D&I list: evidence_assurance._approved), and the decisions on
    files' reliability, naming the files."""
    reasons: list[str] = []
    if attribute_ids:
        approved = [
            UUID(str(row[0]))
            for row in connection.execute(
                "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' ORDER BY position, created_at",
                (control_id,),
            ).fetchall()
        ]
        changed = set(attribute_ids)
        codes = [attribute_letter(at) for at, item in enumerate(approved) if item in changed]
        reasons.append(tickmarks_changed(codes, len(changed) - len(codes)))
    if signed_at is not None:
        names = file_reliability.changed_since(connection, control_id, signed_at)
        if names:
            reasons.append(decisions_changed(names))
    return tuple(reasons)


# The sign-off that stands on a control. Its last column: whether the demo seeded it,
# which is a sign-off on a demo engagement signed by a demo identity. The database sets
# both markers only inside demo initialization and never changes them (migrations 0128 and
# 0130), and a demo identity can never sign in, so no sign-off a person makes, on a demo
# engagement or any other, reads as seeded.
_STANDING = """
    SELECT d.id, d.workpaper_version, d.verdict, d.deficiencies, d.signed_at, d.choice_id,
           d.conclusion, coalesce(p.demo AND s.demo_organization_id IS NOT NULL, false)
    FROM design_conclusions d
    JOIN projects p ON p.id = d.project_id
    LEFT JOIN users s ON s.id = d.signed_by
    WHERE d.project_id = %s AND d.engagement_control_id = %s AND d.reopened_at IS NULL
"""


def _facts(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    lock: bool = False,
    exceptions: Sequence[ExceptionRef] | None = None,
    attributes: Sequence[AttributeStanding] | None = None,
    assemble: bool = False,
) -> _Facts:
    """What the conclusion rests on. `exceptions` and `attributes` are the person's
    exceptions that stand and the attributes as assembled, where the caller has read them
    already (the design workpaper's view). Otherwise, with `assemble` (the conclusion as a
    person reads it, the choice, the sign-off), both are read here, in one read of the
    control's requests and checks. Without it (the gate's readers) the attributes are not
    read, and the exceptions only for a control on which one stands at all, under a
    sign-off that is not held to its conclusion's rules: one that is leaves both until
    the rule is read (`_held`)."""
    control = connection.execute(
        "SELECT organization_id FROM engagement_controls WHERE project_id = %s AND id = %s",
        (project_id, control_id),
    ).fetchone()
    if control is None:
        raise NotVisible()
    workpaper = connection.execute(
        """
        SELECT w.id, w.status, w.draft_status, u.display_name, w.prepared_version, w.prepared_by,
               w.prepared_at, w.current_version
        FROM workpapers w LEFT JOIN users u ON u.id = w.prepared_by
        WHERE w.project_id = %s AND w.engagement_control_id = %s AND w.stage = 'DESIGN'
        """
        + (" FOR UPDATE OF w" if lock else ""),
        (project_id, control_id),
    ).fetchone()
    deficiencies = [
        DeficiencyRef(id=UUID(str(r[0])), reference=str(r[1]), title=str(r[2]), status=str(r[3]))
        for r in connection.execute(
            """
            SELECT id, reference, title, status FROM deficiencies
            WHERE project_id = %s AND engagement_control_id = %s
              AND deficiency_type = 'DESIGN' AND status = ANY(%s)
            ORDER BY reference
            """,
            (project_id, control_id, list(_STANDING_DEFICIENCY)),
        ).fetchall()
    ]
    standing = connection.execute(
        _STANDING + (" FOR UPDATE OF d" if lock else ""), (project_id, control_id)
    ).fetchone()
    signed_at: datetime | None = None if standing is None else standing[4]
    marked, excepted = attribute_dispositions.signoff_facts(connection, control_id, signed_at)
    changed = _changed(connection, control_id, marked, signed_at)
    choice, choice_by = _standing_choice(connection, project_id, control_id, lock)
    facts = _Facts(
        UUID(str(control[0])),
        workpaper,
        deficiencies,
        standing,
        changed,
        () if exceptions is None else tuple(exceptions),
        choice,
        choice_by,
        None if attributes is None else tuple(attributes),
        excepted,
        exceptions is not None or not excepted,
    )
    if facts.attributes is None and assemble:
        return _assembled(connection, project_id, control_id, facts)
    if not facts.exceptions_read and not (facts.attributes is None and facts.held_to_rules()):
        return replace(
            facts,
            exceptions=tuple(_exceptions(connection, project_id, control_id)),
            exceptions_read=True,
        )
    return facts


def _standing_choice(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, lock: bool = False
) -> tuple[ChoiceRecord | None, UUID | None]:
    """The preparer's conclusion that stands on the control and who recorded it, or
    neither."""
    row = connection.execute(
        """
        SELECT c.id, c.kind, c.basis, c.reason, c.proposed_kind, u.display_name,
               c.recorded_at, c.workpaper_version, c.recorded_by
        FROM design_conclusion_choices c LEFT JOIN users u ON u.id = c.recorded_by
        WHERE c.project_id = %s AND c.engagement_control_id = %s AND c.ended_at IS NULL
        """
        + (" FOR UPDATE OF c" if lock else ""),
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return None, None
    record = ChoiceRecord(
        id=UUID(str(row[0])),
        kind=row[1],
        basis=row[2],
        reason=str(row[3]),
        proposed_kind=row[4],
        recorded_by=None if row[5] is None else str(row[5]),
        recorded_at=row[6],
        workpaper_version=int(row[7]),
    )
    return record, UUID(str(row[8]))


def _held(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, facts: _Facts
) -> bool:
    """Whether the standing sign-off holds, as the OE gate reads it: nothing in `stale`,
    and its conclusion's rule not broken. The attributes are read (once, with the person's
    exceptions) only where the answer depends on them: not for a sign-off already out of
    date, one not held to the rule, or one of not effective, which the rule never
    refuses."""
    if facts.standing is None or facts.stale():
        return False
    if not facts.held_to_rules() or facts.standing[6] == "NOT_EFFECTIVE":
        return True
    if facts.attributes is None:
        facts = _assembled(connection, project_id, control_id, facts)
    return facts.rule_broken(facts.results()) is None


def design_verdict(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> Verdict | None:
    """The D&I verdict a reviewer signed off that still holds, or None: what the OE gate
    reads."""
    facts = _facts(connection, project_id, control_id)
    if facts.standing is None or not _held(connection, project_id, control_id, facts):
        return None
    verdict: Verdict = "EFFECTIVE" if facts.standing[2] == "EFFECTIVE" else "NOT_EFFECTIVE"
    return verdict


# The OE gate (product owner, 8 November 2026; AS 2201): OE evidence requests and OE
# testing start only once a reviewer has signed off the D&I conclusion as effective, with no
# early start. Not effective ends OE: the control concludes on the design deficiency.
GATE_DESIGN = "sign off the D&I conclusion as effective first"
GATE_NOT_EFFECTIVE = (
    "the design is signed off as not effective, so operating effectiveness is not tested"
)


def oe_gate_reason(connection: psycopg.Connection[Any], control_id: UUID) -> str | None:
    """Why OE work on the control cannot start or advance, or None once its D&I conclusion
    is signed off effective and still holds."""
    row = connection.execute(
        "SELECT project_id FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    if row is None:
        return GATE_DESIGN
    verdict = design_verdict(connection, UUID(str(row[0])), control_id)
    if verdict == "EFFECTIVE":
        return None
    return GATE_NOT_EFFECTIVE if verdict == "NOT_EFFECTIVE" else GATE_DESIGN


def effective_controls(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> set[UUID]:
    """The controls (one, or the engagement's) whose D&I conclusion is signed off effective
    and still holds, read for the phase progress and the release of OE requests. Each is
    read as the gate reads it (`design_verdict`). The one query first leaves out the
    sign-offs that two of `_Facts.stale`'s rules already put out of date, so that nothing
    more is read for them: the design workpaper not prepared at the signed version, and a
    signed choice that is no longer the one standing (or one standing where none was
    signed)."""
    rows = connection.execute(
        """
        SELECT d.engagement_control_id
        FROM design_conclusions d
        JOIN workpapers w ON w.project_id = d.project_id
             AND w.engagement_control_id = d.engagement_control_id AND w.stage = 'DESIGN'
        LEFT JOIN design_conclusion_choices c ON c.project_id = d.project_id
             AND c.engagement_control_id = d.engagement_control_id AND c.ended_at IS NULL
        WHERE d.project_id = %s AND d.reopened_at IS NULL AND d.verdict = 'EFFECTIVE'
          AND w.status = 'PREPARED' AND w.prepared_version = d.workpaper_version
          AND c.id IS NOT DISTINCT FROM d.choice_id
        """
        + (" AND d.engagement_control_id = %s" if control_id is not None else ""),
        (project_id, control_id) if control_id is not None else (project_id,),
    ).fetchall()
    return {
        UUID(str(r[0]))
        for r in rows
        if design_verdict(connection, project_id, UUID(str(r[0]))) == "EFFECTIVE"
    }


def _history(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[SignoffRecord]:
    rows = connection.execute(
        """
        SELECT d.id, d.verdict, d.workpaper_version, d.deficiencies, s.display_name,
               d.signed_at, d.signoff_note, d.reopened_at, r.display_name, d.reopen_reason,
               d.reopened_from, d.conclusion, d.conclusion_basis, d.conclusion_reason
        FROM design_conclusions d
        LEFT JOIN users s ON s.id = d.signed_by
        LEFT JOIN users r ON r.id = d.reopened_by
        WHERE d.project_id = %s AND d.engagement_control_id = %s
        ORDER BY d.signed_at DESC
        """,
        (project_id, control_id),
    ).fetchall()
    return [
        SignoffRecord(
            id=UUID(str(r[0])),
            verdict="EFFECTIVE" if r[1] == "EFFECTIVE" else "NOT_EFFECTIVE",
            conclusion=r[11],
            basis=r[12],
            reason=None if r[13] is None else str(r[13]),
            workpaper_version=int(r[2]),
            deficiencies=[str(item.get("reference", "")) for item in r[3]],
            signed_by=None if r[4] is None else str(r[4]),
            signed_at=r[5],
            signoff_note=str(r[6]),
            reopened_at=r[7],
            reopened_by=None if r[8] is None else str(r[8]),
            reopen_reason=str(r[9]),
            reopened_from=None if r[10] is None else str(r[10]),
        )
        for r in rows
    ]


def _body(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    viewer: UUID,
    exceptions: Sequence[ExceptionRef] | None = None,
    attributes: Sequence[AttributeStanding] | None = None,
    may_update: bool = False,
) -> DesignConclusionBody:
    """The D&I conclusion as the viewer reads it. `exceptions` and `attributes` are what
    the design workpaper's view has read already; `may_update` is whether the viewer is a
    person who may update the engagement's work (the choice's rule)."""
    facts = _facts(
        connection, project_id, control_id, exceptions=exceptions, attributes=attributes,
        assemble=True,
    )  # fmt: skip
    results = facts.results()
    proposal, proposal_reasons = proposal_of(len(facts.deficiencies), results)
    history = _history(connection, project_id, control_id)
    paper = facts.workpaper
    reasons = facts.out_of_date(results)
    signed = (
        None
        if facts.standing is None
        else next((item for item in history if item.id == UUID(str(facts.standing[0]))), None)
    )
    status: Status = (
        ("OUT_OF_DATE" if reasons else "SIGNED_OFF")
        if facts.standing is not None
        else "TO_SIGN"
        if facts.proposed is not None
        else "NOT_READY"
    )
    blocking: list[str] = []
    if paper is None or paper[1] != "PREPARED":
        blocking.append("the design workpaper is not prepared")
    refusals = facts.signing_refusals(results)
    if refusals == [NO_CHOICE]:
        # Nothing chosen yet: the exceptions that would keep effective from being signed
        # are said as well, as before.
        refusals = [NO_CHOICE, *facts.unanswered()]
    blocking.extend(refusals)
    # The workpaper's urgent review notes hold the sign-off until each is cleared or
    # dismissed (docs/workpaper-review.md, section 4).
    urgent = (
        0 if paper is None else workpaper_review_notes.urgent_open(connection, UUID(str(paper[0])))
    )
    held = workpaper_review_notes.signoff_refusal(urgent)
    if held is not None:
        blocking.append(held)
    if status == "SIGNED_OFF":
        blocking.append("the D&I conclusion is signed off")
    reviewer = _is_reviewer(connection, project_id, viewer)
    prepared = paper is not None and paper[5] is not None and UUID(str(paper[5])) == viewer
    recorded = facts.choice_by is not None and facts.choice_by == viewer
    required = independence.required()
    if recorded and required and reviewer and status != "SIGNED_OFF":
        # Independence covers the conclusion itself: said to the reviewer it keeps from
        # signing, and to nobody else (the preparer who recorded it is not held by it).
        blocking.append(RECORDER_CANNOT_SIGN)
    can_choose = (
        may_update
        and paper is not None
        and paper[1] == "DRAFT"
        and paper[2] == "IDLE"
        and int(paper[7]) >= 1
        and _engagement_open(connection, project_id)
    )
    return DesignConclusionBody(
        control_id=control_id,
        status=status,
        proposed=facts.proposed,
        workpaper=None
        if paper is None
        else DesignWorkpaperRef(
            id=UUID(str(paper[0])),
            status=str(paper[1]),
            drafting=paper[2] != "IDLE",
            prepared_by=None if paper[3] is None else str(paper[3]),
            prepared_version=None if paper[4] is None else int(paper[4]),
        ),
        deficiencies=facts.deficiencies,
        signed=signed,
        out_of_date=reasons,
        blocking=blocking,
        exceptions=list(facts.exceptions),
        viewer_is_reviewer=reviewer,
        viewer_prepared=prepared,
        independence_required=required,
        can_sign=not blocking and reviewer and not ((prepared or recorded) and required),
        history=history,
        viewer_recorded=recorded,
        proposed_conclusion=proposal,
        proposed_reasons=proposal_reasons,
        choice=facts.choice,
        can_choose=can_choose,
        design=results.design,
        implementation=results.implementation,
        urgent_review_notes=urgent,
    )


def _engagement_open(connection: psycopg.Connection[Any], project_id: UUID) -> bool:
    """Whether the engagement takes changes: not completed or archived (engagement_close)."""
    from ai_workforce_api.engagement_close import CLOSED

    row = connection.execute("SELECT status FROM projects WHERE id = %s", (project_id,)).fetchone()
    return row is not None and str(row[0]) not in CLOSED


def _may_update(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> bool:
    return principal.kind is PrincipalKind.USER and permits(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )


def _person(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _reviewer(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    if not _is_reviewer(connection, project_id, principal.id):
        raise DesignConclusionState("only a team member with the reviewer role can do this")


def read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
) -> DesignConclusionBody:
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    return _viewed(connection, principal, organization_id, project_id, control_id)


def _viewed(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
) -> DesignConclusionBody:
    may_update = _may_update(connection, principal, organization_id, project_id)
    return _body(connection, project_id, control_id, principal.id, may_update=may_update)


def choose(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ChoiceBody,
) -> DesignConclusionBody:
    """The preparer records the conclusion (section 3.6): a person with TASK_UPDATE, never
    an agent, on the control's design workpaper while it is a draft that is not being
    drafted. The choice that stood, if any, is kept and ended as REPLACED, but only where
    it is the one the person saw (`body.replaces`). Refused, with nothing changed, by each
    rule of the section: 409 for the records' rules and a stale page, 422 for a missing
    basis or reason."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    reason = clean_reason(body.reason)
    if body.kind == "NOT_EFFECTIVE" and body.basis is None:
        raise ChoiceInvalid(BASIS_NEEDED)
    if body.kind != "NOT_EFFECTIVE" and body.basis is not None:
        raise ChoiceInvalid(BASIS_NOT_TAKEN)
    if body.kind in REASON_ALWAYS and not reason:
        raise ChoiceInvalid(REASON_NEEDED)
    with transaction(connection) as cursor:
        # The workpaper row is locked first, as preparing it locks it: a choice and a
        # preparation of the same workpaper never pass each other.
        facts = _facts(cursor.connection, project_id, control_id, lock=True, assemble=True)
        paper = facts.workpaper
        if paper is None or int(paper[7]) < 1:
            raise DesignConclusionState(DRAFT_FIRST)
        if paper[1] != "DRAFT":
            raise DesignConclusionState(PREPARED_ALREADY)
        if paper[2] != "IDLE":
            raise DesignConclusionState(BEING_DRAFTED)
        standing = facts.choice
        seen = body.replaces
        if (None if standing is None else standing.id) != seen:
            raise DesignConclusionState(CHOICE_STALE if standing is None else CHOICE_RECORDED_SINCE)
        results = facts.results()
        proposal, _reasons = proposal_of(len(facts.deficiencies), results)
        refusal = choice_refusal(body.kind, len(facts.deficiencies), results)
        if refusal is not None:
            raise DesignConclusionState(refusal)
        if reason_needed(body.kind, proposal) and not reason:
            raise ChoiceInvalid(REASON_NEEDED)
        if standing is not None:
            cursor.execute(
                """
                UPDATE design_conclusion_choices
                SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'REPLACED'
                WHERE id = %s AND ended_at IS NULL
                """,
                (principal.id, standing.id),
            )
        row = cursor.execute(
            """
            INSERT INTO design_conclusion_choices (
                organization_id, project_id, engagement_control_id, workpaper_id,
                workpaper_version, kind, basis, reason, proposed_kind, recorded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                facts.organization_id, project_id, control_id, UUID(str(paper[0])),
                int(paper[7]), body.kind, body.basis, reason, proposal, principal.id,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        chosen = UUID(str(row[0]))
        # Recording a choice changes the workpaper's record: its row, locked above, takes
        # the next `version`, so a Prepare (or an edit) sent from a page that has not seen
        # the choice is refused as stale.
        cursor.execute(
            "UPDATE workpapers SET version = version + 1 WHERE id = %s", (UUID(str(paper[0])),)
        )
        _audit(cursor, facts.organization_id, project_id, principal.id, chosen, CHOSEN,
               {"control_id": str(control_id), "choice_id": str(chosen), "kind": body.kind,
                "basis": body.basis, "proposed_kind": proposal,
                "workpaper_version": int(paper[7]), "reason": reason[:AUDIT_REASON],
                "replaced": None if standing is None else str(standing.id),
                "replaced_kind": None if standing is None else standing.kind})  # fmt: skip
    return _viewed(connection, principal, organization_id, project_id, control_id)


def _reopen_standing(
    cursor: psycopg.Cursor[Any], standing_id: UUID, actor: UUID, reason: str, source: str
) -> None:
    cursor.execute(
        """
        UPDATE design_conclusions
        SET reopened_at = clock_timestamp(), reopened_by = %s, reopen_reason = %s,
            reopened_from = %s
        WHERE id = %s AND reopened_at IS NULL
        RETURNING organization_id, project_id, engagement_control_id
        """,
        (actor, clean_line(reason, 500), source, standing_id),
    )
    reopened = cursor.fetchone()
    if reopened is None or source == "WORKPAPER":
        # The design workpaper reopened: the review's coverage of the workpaper decides, as
        # for any later work (W3): finality waits until the reviewer re-signs, or documents
        # that the signed review covers the new version.
        return
    # The control's own review rests on its D&I conclusion (B0/B3): its verdict reopened by
    # a person or superseded by a new sign-off, a review signed off on it opens again, its
    # sign-off kept on record (bug hunt, 9 November 2026). Before, the review and the final
    # conclusion stood on a D&I verdict that no longer did, and nothing in finality said so.
    reopen_review_for(
        cursor,
        Principal(kind=PrincipalKind.USER, id=actor),
        UUID(str(reopened[0])),
        UUID(str(reopened[1])),
        UUID(str(reopened[2])),
        None,
        f"The D&I conclusion it rests on was reopened: {clean_line(reason, 400)}",
        "LATER_WORK",
    )


def sign_off(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: SignOffBody,
) -> DesignConclusionBody:
    """The reviewer signs the preparer's standing conclusion (section 3.6), for the design
    workpaper at its prepared version. Refused where no conclusion stands, where the one
    standing is not the one the reviewer read (`choice_id`), where it is not concluded,
    where it was recorded after the workpaper was prepared, where its rules no longer hold
    on the records as they are now (read again here, in the transaction), where a not
    effective conclusion has no standing design deficiency, and where the reviewer names
    another conclusion; and, as before, for the preparer (independence, which also covers
    the person who recorded the conclusion), another prepared version, and a sign-off that
    still holds. Refused too while a review note of the workpaper is urgent and open or
    responded to (workpaper_review_notes)."""
    _reviewer(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        facts = _facts(cursor.connection, project_id, control_id, lock=True, assemble=True)
        paper = facts.workpaper
        if paper is None or paper[1] != "PREPARED":
            raise DesignConclusionState("prepare the design workpaper first")
        if int(paper[4]) != body.workpaper_version:
            raise DesignConclusionState("the design workpaper changed; review it again")
        if facts.choice is not None and facts.choice.id != body.choice_id:
            raise DesignConclusionState(CHOICE_NOT_STANDING)
        # An urgent review note of the workpaper that is open or responded to holds the
        # sign-off (docs/workpaper-review.md, section 4). The workpaper's row is locked
        # (above), as it is while a note is raised, so none is raised in between.
        held = workpaper_review_notes.signoff_refusal(
            workpaper_review_notes.urgent_open(cursor.connection, UUID(str(paper[0])))
        )
        if held is not None:
            raise DesignConclusionState(held)
        results = facts.results()
        refusals = facts.signing_refusals(results)
        if refusals:
            # An exception a person recorded is never signed over as effective: whatever
            # is asked for, it is a design deficiency to log, a tickmark to change, or a
            # conclusion that concludes on it.
            raise DesignConclusionState(" ".join(refusals))
        choice = facts.choice
        assert choice is not None and choice.kind != "NOT_CONCLUDED"
        kind = choice.kind
        verdict = verdict_of(kind)
        if body.conclusion != kind:
            raise DesignConclusionState(
                f"the preparer's conclusion is “{KIND_WORDS[kind]}”; sign off that conclusion, "
                "or reopen the design workpaper for the preparer to change it"
            )
        if facts.standing is not None and not facts.out_of_date(results):
            raise DesignConclusionState("the D&I conclusion is signed off")
        if independence.required() and paper[5] is not None and UUID(str(paper[5])) == principal.id:
            raise DesignConclusionState(
                "you prepared the design workpaper; another reviewer must sign off the "
                "D&I conclusion"
            )
        if independence.required() and facts.choice_by == principal.id:
            raise DesignConclusionState(RECORDER_CANNOT_SIGN)
        if facts.standing is not None:
            _reopen_standing(
                cursor,
                UUID(str(facts.standing[0])),
                principal.id,
                "; ".join(facts.out_of_date(results)),
                "SUPERSEDED",
            )
        basis = [
            {"id": str(item.id), "reference": item.reference, "status": item.status}
            for item in facts.deficiencies
        ]
        row = cursor.execute(
            """
            INSERT INTO design_conclusions (
                organization_id, project_id, engagement_control_id, workpaper_id,
                workpaper_version, verdict, deficiencies, signed_by, signoff_note,
                conclusion, conclusion_basis, conclusion_reason, choice_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                facts.organization_id,
                project_id,
                control_id,
                UUID(str(paper[0])),
                int(paper[4]),
                verdict,
                Json(basis),
                principal.id,
                clean_text(body.note, 1000).text,
                kind,
                choice.basis,
                choice.reason,
                choice.id,
            ),
        ).fetchone()
        assert row is not None
        if kind == "NOT_EFFECTIVE":
            # OE is not performed: the control's review opens on the design alone, with no
            # testing for the reviewer agent to re-perform.
            from ai_workforce_api.control_reviews import open_review

            review = open_review(cursor, facts.organization_id, project_id, control_id,
                                 principal.id)  # fmt: skip
            cursor.execute(
                "UPDATE control_reviews SET reperform_status = 'IDLE' "
                "WHERE project_id = %s AND engagement_control_id = %s "
                "AND test_round_id IS NULL AND status = 'OPEN' AND reperform_status = 'PENDING'",
                (project_id, control_id),
            )
            del review
        _audit(cursor, facts.organization_id, project_id, principal.id, UUID(str(row[0])),
               "design_conclusion.signed_off",
               {"control_id": str(control_id), "verdict": verdict, "conclusion": kind,
                "basis": choice.basis, "choice_id": str(choice.id),
                "workpaper_version": int(paper[4]), "deficiencies": basis})  # fmt: skip
    return _viewed(connection, principal, organization_id, project_id, control_id)


def reopen(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ReopenBody,
) -> DesignConclusionBody:
    _reviewer(connection, principal, organization_id, project_id)
    reason = clean_line(body.reason, 500)
    if len(reason.strip()) < 10:
        raise DesignConclusionState("give the reason in a sentence")
    with transaction(connection) as cursor:
        facts = _facts(cursor.connection, project_id, control_id, lock=True)
        if facts.standing is None:
            raise DesignConclusionState("the D&I conclusion is not signed off")
        standing = UUID(str(facts.standing[0]))
        _reopen_standing(cursor, standing, principal.id, reason, "PERSON")
        _audit(cursor, facts.organization_id, project_id, principal.id, standing,
               "design_conclusion.reopened",
               {"control_id": str(control_id), "reason": reason})  # fmt: skip
    return _viewed(connection, principal, organization_id, project_id, control_id)


def reopen_for_workpaper(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    reason: str,
) -> None:
    """The design workpaper was reopened: the D&I conclusion that rests on it opens again,
    in the same transaction."""
    row = cursor.execute(
        "SELECT id FROM design_conclusions WHERE project_id = %s AND engagement_control_id = %s "
        "AND reopened_at IS NULL FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return
    standing = UUID(str(row[0]))
    text = clean_line(reason, 500) or "The design workpaper was reopened."
    _reopen_standing(cursor, standing, actor, text, "WORKPAPER")
    _audit(cursor, organization_id, project_id, actor, standing, "design_conclusion.reopened",
           {"control_id": str(control_id), "reason": text, "from": "WORKPAPER"})  # fmt: skip


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    target_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'design_conclusion', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, target_id, Json(payload)),
    )


def register_design_conclusions(app: FastAPI, settings: Settings, scheduler: Any = None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/design-conclusions"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except DesignConclusionState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ChoiceInvalid as error:
            raise HTTPException(status_code=422, detail=error.detail) from None

    @app.get(f"{base}/{{control_id}}", response_model=DesignConclusionBody)
    def conclusion(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> DesignConclusionBody:
        return run(request, lambda c, p: read(c, p, organization_id, project_id, control_id))

    @app.post(f"{base}/{{control_id}}/sign-off", response_model=DesignConclusionBody)
    def signed(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: SignOffBody,
        request: Request,
    ) -> DesignConclusionBody:  # fmt: skip
        def work(c: psycopg.Connection[Any], p: Principal) -> DesignConclusionBody:
            from ai_workforce_api.readiness import resume_testing
            from ai_workforce_api.testing_engine import TestScheduler, schedule_runs

            signed_off = sign_off(c, p, organization_id, project_id, control_id, body)
            # Testing waiting on the D&I conclusion resumes once it is signed with the
            # verdict effective (effective, exceptions noted, no instance).
            if signed_off.signed is not None and signed_off.signed.verdict == "EFFECTIVE":
                tests = scheduler if isinstance(scheduler, TestScheduler) else None
                schedule_runs(tests, resume_testing(c, project_id, control_id))
            return signed_off

        return run(request, work)

    @app.post(f"{base}/{{control_id}}/choice", response_model=DesignConclusionBody)
    def chosen(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ChoiceBody,
        request: Request,
    ) -> DesignConclusionBody:  # fmt: skip
        return run(
            request, lambda c, p: choose(c, p, organization_id, project_id, control_id, body)
        )

    @app.post(f"{base}/{{control_id}}/reopen", response_model=DesignConclusionBody)
    def reopened(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ReopenBody,
        request: Request,
    ) -> DesignConclusionBody:  # fmt: skip
        return run(
            request, lambda c, p: reopen(c, p, organization_id, project_id, control_id, body)
        )
