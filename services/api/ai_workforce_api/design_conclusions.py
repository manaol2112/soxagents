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

`design_verdict` is what the OE gate reads: the verdict signed off and still current, or None.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api import attribute_dispositions, file_reliability, independence
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_reviews import _is_reviewer, reopen_review_for
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_assurance import attribute_letter
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.settings import Settings

Verdict = Literal["EFFECTIVE", "NOT_EFFECTIVE"]
Status = Literal["NOT_READY", "TO_SIGN", "SIGNED_OFF", "OUT_OF_DATE"]

# A design deficiency counts against the design until it is remediated or closed.
_STANDING_DEFICIENCY = ("OPEN", "REMEDIATION_IN_PROGRESS", "READY_FOR_RETEST")

# Why a standing sign-off no longer holds, of a person's tickmarks (section 10.15, item 5).
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
    workpaper_version: int
    deficiencies: list[str]
    signed_by: str | None
    signed_at: datetime
    signoff_note: str
    reopened_at: datetime | None
    reopened_by: str | None
    reopen_reason: str
    reopened_from: str | None


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


class SignOffBody(BaseModel):
    verdict: Verdict
    workpaper_version: int = Field(ge=1)
    note: str = Field(default="", max_length=1000)


class ReopenBody(BaseModel):
    reason: str = Field(min_length=10, max_length=500)


@dataclass(frozen=True)
class _Facts:
    organization_id: UUID
    workpaper: tuple[Any, ...] | None
    deficiencies: list[DeficiencyRef]
    standing: tuple[Any, ...] | None
    # What a person recorded or ended after the standing sign-off, each as the reason it
    # gives: the tickmarks (by attribute), the decisions on files' reliability (by file).
    changed: tuple[str, ...] = ()
    # The exceptions a person recorded that stand, whatever their request's check.
    exceptions: tuple[ExceptionRef, ...] = ()

    @property
    def proposed(self) -> Verdict | None:
        if self.workpaper is None or self.workpaper[1] != "PREPARED":
            return None
        return "NOT_EFFECTIVE" if self.deficiencies else "EFFECTIVE"

    def unanswered(self) -> list[str]:
        """One sentence per attribute with an exception a person recorded, while no design
        deficiency stands: what keeps the conclusion from being signed. With a design
        deficiency standing the records propose not effective, and nothing is said here.
        An attribute's sentence says the request waits to be checked again only where none
        of its exceptions is on a current check."""
        if self.deficiencies:
            return []
        current: dict[str, bool] = {}
        for exception in self.exceptions:
            current[exception.code] = current.get(exception.code, False) or exception.check_current
        return [exception_sentence(code, on_check) for code, on_check in current.items()]

    def out_of_date(self) -> list[str]:
        """Why the standing sign-off no longer holds (empty when it holds or none stands)."""
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
            reasons.append("a design deficiency was logged after the sign-off")
        if signed - now:
            reasons.append("a design deficiency was remediated or closed after the sign-off")
        if self.changed:
            reasons.extend(self.changed)
        elif self.standing[2] == "EFFECTIVE" and self.unanswered():
            # Nothing changed since, and still an exception stands unanswered under a
            # sign-off as effective (its request was restored, its attribute approved
            # again, or it was signed before every standing exception counted): the OE
            # gate never reads a verdict signed over a standing exception.
            reasons.append(EXCEPTION_UNANSWERED)
        return reasons


def _exceptions(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[ExceptionRef]:
    """The exceptions a person recorded that stand on the control's D&I requests, each
    with whether its request's check is current, as the design workpaper's view gives them
    (design_workpaper imports this module, so it is imported here)."""
    from ai_workforce_api.design_workpaper import load_exceptions

    return load_exceptions(connection, project_id, control_id)


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


def _facts(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    lock: bool = False,
    exceptions: Sequence[ExceptionRef] | None = None,
) -> _Facts:
    """What the conclusion rests on. `exceptions` are the exceptions that stand where the
    caller has read them already (the design workpaper's view); otherwise they are read
    here, and only for a control on which a person's exception stands at all."""
    control = connection.execute(
        "SELECT organization_id FROM engagement_controls WHERE project_id = %s AND id = %s",
        (project_id, control_id),
    ).fetchone()
    if control is None:
        raise NotVisible()
    workpaper = connection.execute(
        """
        SELECT w.id, w.status, w.draft_status, u.display_name, w.prepared_version, w.prepared_by
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
        """
        SELECT id, workpaper_version, verdict, deficiencies, signed_at
        FROM design_conclusions
        WHERE project_id = %s AND engagement_control_id = %s AND reopened_at IS NULL
        """
        + (" FOR UPDATE" if lock else ""),
        (project_id, control_id),
    ).fetchone()
    signed_at: datetime | None = None if standing is None else standing[4]
    marked, excepted = attribute_dispositions.signoff_facts(connection, control_id, signed_at)
    changed = _changed(connection, control_id, marked, signed_at)
    if exceptions is None:
        exceptions = _exceptions(connection, project_id, control_id) if excepted else ()
    return _Facts(
        UUID(str(control[0])), workpaper, deficiencies, standing, changed, tuple(exceptions)
    )


def design_verdict(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> Verdict | None:
    """The D&I verdict a reviewer signed off that still holds, or None: what the OE gate
    reads."""
    facts = _facts(connection, project_id, control_id)
    if facts.standing is None or facts.out_of_date():
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
    and still holds, read for the phase progress."""
    rows = connection.execute(
        "SELECT engagement_control_id FROM design_conclusions "
        "WHERE project_id = %s AND reopened_at IS NULL AND verdict = 'EFFECTIVE'"
        + (" AND engagement_control_id = %s" if control_id is not None else ""),
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
               d.reopened_from
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
) -> DesignConclusionBody:
    facts = _facts(connection, project_id, control_id, exceptions=exceptions)
    history = _history(connection, project_id, control_id)
    paper = facts.workpaper
    reasons = facts.out_of_date()
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
    blocking.extend(facts.unanswered())
    if status == "SIGNED_OFF":
        blocking.append("the D&I conclusion is signed off")
    reviewer = _is_reviewer(connection, project_id, viewer)
    prepared = paper is not None and paper[5] is not None and UUID(str(paper[5])) == viewer
    required = independence.required()
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
        can_sign=not blocking and reviewer and not (prepared and required),
        history=history,
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
    return _body(connection, project_id, control_id, principal.id)


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
    _reviewer(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        facts = _facts(cursor.connection, project_id, control_id, lock=True)
        paper = facts.workpaper
        if paper is None or paper[1] != "PREPARED":
            raise DesignConclusionState("prepare the design workpaper first")
        if int(paper[4]) != body.workpaper_version:
            raise DesignConclusionState("the design workpaper changed; review it again")
        unanswered = facts.unanswered()
        if unanswered:
            # An exception a person recorded is never signed over: whatever verdict is
            # asked for, it is a design deficiency to log or a tickmark to change first.
            raise DesignConclusionState(" ".join(unanswered))
        if facts.proposed != body.verdict:
            raise DesignConclusionState(
                "the records support a different verdict; log a design deficiency or "
                "reopen the design workpaper instead"
            )
        if facts.standing is not None and not facts.out_of_date():
            raise DesignConclusionState("the D&I conclusion is signed off")
        if independence.required() and paper[5] is not None and UUID(str(paper[5])) == principal.id:
            raise DesignConclusionState(
                "you prepared the design workpaper; another reviewer must sign off the "
                "D&I conclusion"
            )
        if facts.standing is not None:
            _reopen_standing(
                cursor,
                UUID(str(facts.standing[0])),
                principal.id,
                "; ".join(facts.out_of_date()),
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
                workpaper_version, verdict, deficiencies, signed_by, signoff_note
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                facts.organization_id,
                project_id,
                control_id,
                UUID(str(paper[0])),
                int(paper[4]),
                body.verdict,
                Json(basis),
                principal.id,
                clean_text(body.note, 1000).text,
            ),
        ).fetchone()
        assert row is not None
        if body.verdict == "NOT_EFFECTIVE":
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
               {"control_id": str(control_id), "verdict": body.verdict,
                "workpaper_version": int(paper[4]), "deficiencies": basis})  # fmt: skip
    return _body(connection, project_id, control_id, principal.id)


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
    return _body(connection, project_id, control_id, principal.id)


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
            if body.verdict == "EFFECTIVE":
                tests = scheduler if isinstance(scheduler, TestScheduler) else None
                schedule_runs(tests, resume_testing(c, project_id, control_id))
            return signed_off

        return run(request, work)

    @app.post(f"{base}/{{control_id}}/reopen", response_model=DesignConclusionBody)
    def reopened(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ReopenBody,
        request: Request,
    ) -> DesignConclusionBody:  # fmt: skip
        return run(
            request, lambda c, p: reopen(c, p, organization_id, project_id, control_id, body)
        )
