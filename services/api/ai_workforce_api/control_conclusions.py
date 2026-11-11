"""The Control Conclusion step (B3; product owner, 8 November 2026: "the agent proposes, a
person rates").

The control's conclusion is proposed from the records: the D&I verdict a reviewer signed off,
the OE results of each phase that applies, and the deficiencies still standing. A design signed
off as not effective concludes the control not effective without OE. Each deficiency's
severity is rated by a person, with the agent's suggestion beside it (migration 0144); a rating
of significant deficiency or material weakness waits for the reviewer through the deficiency's
change request. The conclusion is final when the independent review is signed off, and the
review is not signed off while a deficiency is unrated (control_reviews.py).

Nothing here concludes on its own: the proposal is read, never stored, so it always follows the
records.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_text
from ai_workforce_api.settings import Settings

Verdict = Literal["EFFECTIVE", "NOT_EFFECTIVE"]
Severity = Literal["CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"]
Status = Literal["NOT_READY", "PROPOSED", "FINAL"]
PhaseState = Literal["NOT_APPLICABLE", "NOT_PERFORMED", "NOT_STARTED", "IN_PROGRESS", "SIGNED_OFF"]

SEVERE = ("SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS")
SEVERITY_WORDS = {
    "CONTROL_DEFICIENCY": "control deficiency",
    "SIGNIFICANT_DEFICIENCY": "significant deficiency",
    "MATERIAL_WEAKNESS": "material weakness",
}
_APPLIES = ("APPLICABLE", "CONDITIONAL")
_PHASE_WORDS = {"INTERIM": "Interim testing", "ROLLFORWARD": "Roll-forward testing"}


class ConclusionState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class RatingRecord(BaseModel):
    severity: Severity
    suggested_severity: Severity | None
    rationale: str
    rated_by: str
    rated_at: datetime


class ConclusionDeficiency(BaseModel):
    id: UUID
    reference: str
    title: str
    type: Literal["DESIGN", "OPERATING"]
    status: str
    severity: Severity
    likelihood: str
    magnitude: str
    # The agent's suggestion from the likelihood and magnitude recorded, and why.
    suggested_severity: Severity
    suggestion_reason: str
    # A severity change waiting for the reviewer, if one is.
    pending_severity: Severity | None
    rated: bool
    rating: RatingRecord | None
    version: int


class PhaseResult(BaseModel):
    phase: Literal["INTERIM", "ROLLFORWARD"]
    label: str
    state: PhaseState
    conclusion: Verdict | None
    # The latest retest round signed off effective, after the phase's exceptions.
    retested: bool = False


class ReviewRef(BaseModel):
    id: UUID
    status: str
    signed_by: str | None
    signed_at: datetime | None


class ControlConclusionBody(BaseModel):
    control_id: UUID
    status: Status
    proposed: Verdict | None
    # Why the records support the proposal, one line each.
    reasons: list[str]
    # What the conclusion waits for before it can be proposed.
    waiting: list[str]
    design: Verdict | None
    phases: list[PhaseResult]
    deficiencies: list[ConclusionDeficiency]
    to_rate: int
    review: ReviewRef | None
    final: Verdict | None
    viewer_can_rate: bool


class RateBody(BaseModel):
    severity: Severity
    version: int = Field(ge=1)
    rationale: str = Field(min_length=10, max_length=1000)


# The rule


@dataclass(frozen=True)
class Facts:
    """What the conclusion is proposed from (read by facts_of; built by hand in tests)."""

    design: Verdict | None
    # phase -> (applies, sheet or round status or None, conclusion or None, dismissed)
    phases: dict[str, tuple[bool, str | None, str | None, bool]]
    retest: str | None
    deficiencies: list[tuple[str, str, str]] = field(default_factory=list)
    """(reference, type, status) of each deficiency not closed."""


def propose(facts: Facts) -> tuple[Verdict | None, list[str], list[str], list[PhaseResult]]:
    """The proposed conclusion, its reasons, what it waits for, and each OE phase's result."""
    phases: list[PhaseResult] = []
    if facts.design is None:
        # Each phase as the records stand, even work recorded before the D&I sign-off;
        # nothing is concluded from it until D&I is signed off.
        for phase in ("INTERIM", "ROLLFORWARD"):
            applies, status, conclusion, _ = facts.phases.get(phase, (False, None, None, False))
            state: PhaseState = (
                "NOT_APPLICABLE"
                if not applies
                else "SIGNED_OFF"
                if status == "SIGNED_OFF"
                else "IN_PROGRESS"
                if status is not None
                else "NOT_STARTED"
            )
            phases.append(
                PhaseResult(
                    phase=phase,
                    label=_PHASE_WORDS[phase],
                    state=state,
                    conclusion=(
                        ("NOT_EFFECTIVE" if conclusion == "NOT_EFFECTIVE" else "EFFECTIVE")
                        if state == "SIGNED_OFF"
                        else None
                    ),
                )
            )
        return None, [], ["the D&I conclusion is signed off"], phases
    standing = [item for item in facts.deficiencies]
    design_refs = [ref for ref, kind, _ in standing if kind == "DESIGN"]
    if facts.design == "NOT_EFFECTIVE":
        for phase in ("INTERIM", "ROLLFORWARD"):
            applies = facts.phases.get(phase, (False, None, None, False))[0]
            phases.append(
                PhaseResult(
                    phase=phase,  # type: ignore[arg-type]
                    label=_PHASE_WORDS[phase],
                    state="NOT_PERFORMED" if applies else "NOT_APPLICABLE",
                    conclusion=None,
                )
            )
        on = f" on {', '.join(design_refs)}" if design_refs else ""
        return (
            "NOT_EFFECTIVE",
            [
                f"The D&I conclusion is signed off as not effective{on}.",
                "Operating effectiveness is not tested when the design is not effective.",
            ],
            [],
            phases,
        )
    reasons = ["The D&I conclusion is signed off as effective."]
    waiting: list[str] = []
    failed = False
    for phase in ("INTERIM", "ROLLFORWARD"):
        applies, status, conclusion, dismissed = facts.phases.get(phase, (False, None, None, False))
        result = PhaseResult(
            phase=phase,  # type: ignore[arg-type]
            label=_PHASE_WORDS[phase],
            state="NOT_APPLICABLE",
            conclusion=None,
        )
        if applies:
            if status == "SIGNED_OFF":
                result.state = "SIGNED_OFF"
                result.conclusion = (
                    "NOT_EFFECTIVE" if conclusion == "NOT_EFFECTIVE" else "EFFECTIVE"
                )
            else:
                result.state = "IN_PROGRESS" if status is not None else "NOT_STARTED"
                waiting.append(f"{_PHASE_WORDS[phase].lower()} is signed off")
        phases.append(result)
        if result.state != "SIGNED_OFF":
            continue
        if result.conclusion == "EFFECTIVE":
            reasons.append(f"{_PHASE_WORDS[phase]} is signed off with no exceptions.")
        elif dismissed:
            reasons.append(
                f"{_PHASE_WORDS[phase]} found exceptions, dismissed with a recorded reason."
            )
        elif phase == "INTERIM" and facts.retest == "EFFECTIVE":
            result.retested = True
            reasons.append(
                "Interim testing found exceptions; the retest after remediation is signed off "
                "with no exceptions."
            )
        else:
            failed = True
            reasons.append(f"{_PHASE_WORDS[phase]} found exceptions.")
    if standing:
        failed = True
        refs = ", ".join(ref for ref, _, _ in standing)
        reasons.append(
            f"{len(standing)} deficienc{'y is' if len(standing) == 1 else 'ies are'} "
            f"not closed: {refs}."
        )
    if waiting:
        return None, reasons, waiting, phases
    return ("NOT_EFFECTIVE" if failed else "EFFECTIVE"), reasons, [], phases


def suggestion(likelihood: str, magnitude: str) -> tuple[Severity, str]:
    """The agent's suggested severity from the likelihood and magnitude recorded, and why.
    A person rates the severity."""
    words = {
        "REMOTE": "remote",
        "REASONABLY_POSSIBLE": "reasonably possible",
        "PROBABLE": "probable",
        "INCONSEQUENTIAL": "inconsequential",
        "MORE_THAN_INCONSEQUENTIAL": "more than inconsequential",
        "MATERIAL": "material",
    }
    said = (
        f"A {words.get(likelihood, likelihood.lower())} likelihood of a "
        f"{words.get(magnitude, magnitude.lower())} misstatement"
    )
    if likelihood == "REMOTE" or magnitude == "INCONSEQUENTIAL":
        return "CONTROL_DEFICIENCY", f"{said} reads as a control deficiency."
    if magnitude == "MATERIAL":
        return "MATERIAL_WEAKNESS", f"{said} reads as a material weakness."
    return (
        "SIGNIFICANT_DEFICIENCY",
        f"{said} reads as a significant deficiency, important enough for those charged "
        "with governance.",
    )


# Reading


def facts_of(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> Facts:
    from ai_workforce_api.design_conclusions import design_verdict

    applies = {
        str(row[0]): str(row[1]) in _APPLIES
        for row in connection.execute(
            "SELECT phase, applicability FROM evidence_plan_phases "
            "WHERE project_id = %s AND engagement_control_id = %s",
            (project_id, control_id),
        ).fetchall()
    }
    sheet = connection.execute(
        "SELECT status, conclusion, proposal_status FROM test_sheets "
        "WHERE project_id = %s AND engagement_control_id = %s AND test_round_id IS NULL",
        (project_id, control_id),
    ).fetchone()

    def latest(kind: str) -> tuple[Any, ...] | None:
        return connection.execute(
            "SELECT status, conclusion FROM test_rounds WHERE project_id = %s "
            "AND engagement_control_id = %s AND kind = %s AND status <> 'CANCELLED' "
            "ORDER BY number DESC LIMIT 1",
            (project_id, control_id, kind),
        ).fetchone()

    rolled = latest("ROLLFORWARD")
    retest = latest("RETEST")
    phases: dict[str, tuple[bool, str | None, str | None, bool]] = {
        "INTERIM": (
            applies.get("INTERIM", False),
            None if sheet is None else str(sheet[0]),
            None if sheet is None or sheet[1] is None else str(sheet[1]),
            sheet is not None and str(sheet[2]) == "DISMISSED",
        ),
        "ROLLFORWARD": (
            applies.get("ROLLFORWARD", False),
            None if rolled is None else str(rolled[0]),
            None if rolled is None or rolled[1] is None else str(rolled[1]),
            False,
        ),
    }
    deficiencies = [
        (str(row[0]), str(row[1]), str(row[2]))
        for row in connection.execute(
            "SELECT reference, deficiency_type, status FROM deficiencies "
            "WHERE project_id = %s AND engagement_control_id = %s AND status <> 'CLOSED' "
            "ORDER BY reference",
            (project_id, control_id),
        ).fetchall()
    ]
    return Facts(
        design=design_verdict(connection, project_id, control_id),
        phases=phases,
        retest=(
            None
            if retest is None or str(retest[0]) != "SIGNED_OFF" or retest[1] is None
            else str(retest[1])
        ),
        deficiencies=deficiencies,
    )


def _deficiencies(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[ConclusionDeficiency]:
    rows = connection.execute(
        """
        SELECT d.id, d.reference, d.title, d.deficiency_type, d.status, d.severity,
               d.likelihood, d.magnitude, d.pending_change, d.version,
               r.severity, r.suggested_severity, r.rationale, u.display_name, r.rated_at
        FROM deficiencies d
        LEFT JOIN LATERAL (
            SELECT * FROM deficiency_ratings x WHERE x.deficiency_id = d.id
            ORDER BY x.rated_at DESC, x.id DESC LIMIT 1
        ) r ON true
        LEFT JOIN users u ON u.id = r.rated_by
        WHERE d.project_id = %s AND d.engagement_control_id = %s AND d.status <> 'CLOSED'
        ORDER BY d.reference
        """,
        (project_id, control_id),
    ).fetchall()
    found: list[ConclusionDeficiency] = []
    for row in rows:
        pending = row[8] if isinstance(row[8], dict) else None
        pending_severity = (
            str(pending["severity"])
            if pending is not None and pending.get("kind") == "SEVERITY" and pending.get("severity")
            else None
        )
        suggested, why = suggestion(str(row[6]), str(row[7]))
        rating = (
            None
            if row[10] is None
            else RatingRecord(
                severity=row[10],
                suggested_severity=row[11],
                rationale=str(row[12]),
                rated_by=str(row[13] or "A team member"),
                rated_at=row[14],
            )
        )
        found.append(
            ConclusionDeficiency(
                id=UUID(str(row[0])),
                reference=str(row[1]),
                title=str(row[2]),
                type=row[3],
                status=str(row[4]),
                severity=row[5],
                likelihood=str(row[6]),
                magnitude=str(row[7]),
                suggested_severity=suggested,
                suggestion_reason=why,
                pending_severity=pending_severity,  # type: ignore[arg-type]
                # Rated when the latest rating names the severity that stands, or the one
                # waiting for the reviewer.
                rated=rating is not None
                and (pending is None or pending_severity is not None)
                and rating.severity == (pending_severity or row[5]),
                rating=rating,
                version=int(row[9]),
            )
        )
    return found


def unrated(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> int:
    """How many of the control's deficiencies still need a person's rating (the review
    waits for them)."""
    return sum(1 for item in _deficiencies(connection, project_id, control_id) if not item.rated)


def body_of(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, viewer: Principal
) -> ControlConclusionBody:
    if (
        connection.execute(
            "SELECT 1 FROM engagement_controls WHERE project_id = %s AND id = %s",
            (project_id, control_id),
        ).fetchone()
        is None
    ):
        raise NotVisible()
    facts = facts_of(connection, project_id, control_id)
    proposed, reasons, waiting, phases = propose(facts)
    deficiencies = _deficiencies(connection, project_id, control_id)
    review = connection.execute(
        """
        SELECT r.id, r.status, u.display_name, r.signed_at
        FROM control_reviews r LEFT JOIN users u ON u.id = r.signed_by
        WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.test_round_id IS NULL
        """,
        (project_id, control_id),
    ).fetchone()
    signed = review is not None and str(review[1]) == "SIGNED_OFF"
    # Final as the review signed it: not effective while a deficiency is not closed (the
    # controls register's rule, workspace.py).
    final: Verdict | None = (
        ("NOT_EFFECTIVE" if facts.deficiencies else "EFFECTIVE") if signed else None
    )
    return ControlConclusionBody(
        control_id=control_id,
        status="FINAL" if signed else ("PROPOSED" if proposed is not None else "NOT_READY"),
        proposed=proposed,
        reasons=reasons,
        waiting=waiting,
        design=facts.design,
        phases=phases,
        deficiencies=deficiencies,
        to_rate=sum(1 for item in deficiencies if not item.rated),
        review=(
            None
            if review is None
            else ReviewRef(
                id=UUID(str(review[0])),
                status=str(review[1]),
                signed_by=None if review[2] is None else str(review[2]),
                signed_at=review[3],
            )
        ),
        final=final,
        viewer_can_rate=viewer.kind is PrincipalKind.USER and not signed,
    )


# Rating


def rate(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    deficiency_id: UUID,
    body: RateBody,
) -> ControlConclusionBody:
    """A person rates a deficiency's severity. Between levels that need no approval it applies
    now; a significant deficiency or material weakness waits for the reviewer, as any severity
    change does (workspace.py)."""
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        # Agents propose; only a person rates.
        raise NotVisible()
    rationale = clean_text(body.rationale, 1000).text.strip()
    if len(rationale) < 10:
        raise ValueError("say why the severity is rated as it is")
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT organization_id, status, severity, pending_change, version, likelihood,
                   magnitude
            FROM deficiencies
            WHERE id = %s AND project_id = %s AND engagement_control_id = %s
            FOR UPDATE
            """,
            (deficiency_id, project_id, control_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if int(row[4]) != body.version:
            raise ConclusionState("the deficiency changed; review it again")
        if str(row[1]) == "CLOSED":
            raise ConclusionState("the deficiency is closed")
        waiting = row[3] if isinstance(row[3], dict) else None
        # A severity request waiting for the reviewer (as testing logs a significant
        # deficiency) is answered by the rating; any other change waits for the reviewer.
        if row[3] is not None and (waiting is None or waiting.get("kind") != "SEVERITY"):
            raise ConclusionState("a change to this deficiency is waiting for the reviewer")
        review = cursor.execute(
            "SELECT status FROM control_reviews WHERE project_id = %s "
            "AND engagement_control_id = %s AND test_round_id IS NULL",
            (project_id, control_id),
        ).fetchone()
        if review is not None and str(review[0]) == "SIGNED_OFF":
            raise ConclusionState("the review is signed off; reopen it to rate again")
        org = UUID(str(row[0]))
        current = str(row[2])
        # A rating that departs from a significant deficiency or material weakness waiting
        # for the reviewer is the reviewer's to decide too: a rating never withdraws it
        # (security sweep, 9 November 2026).
        departs = (
            waiting is not None
            and waiting.get("severity") in SEVERE
            and body.severity != waiting.get("severity")
        )
        if departs or (body.severity != current and (body.severity in SEVERE or current in SEVERE)):
            # A significant deficiency or material weakness, or a move from one, takes effect
            # once the reviewer approves it (workspace.py, the change request).
            pending = {
                "kind": "SEVERITY",
                "severity": body.severity,
                "reason": rationale,
                "requested_by": str(principal.id),
                "requested_at": datetime.now(UTC).isoformat(),
            }
            cursor.execute(
                "UPDATE deficiencies SET pending_change = %s, version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (Json(pending), deficiency_id),
            )
            _audit(cursor, org, project_id, principal.id, deficiency_id,
                   "deficiency.change_requested",
                   {"kind": "SEVERITY", "severity": body.severity})  # fmt: skip
        else:
            if body.severity != current:
                cursor.execute(
                    "UPDATE deficiencies SET severity = %s, version = version + 1, "
                    "updated_at = clock_timestamp() WHERE id = %s",
                    (body.severity, deficiency_id),
                )
                _audit(cursor, org, project_id, principal.id, deficiency_id,
                       "deficiency.severity", {"severity": body.severity})  # fmt: skip
            if waiting is not None:
                # Rated at a level that needs no approval, answering a request for one that
                # needs none either: the request it answers is withdrawn.
                cursor.execute(
                    "UPDATE deficiencies SET pending_change = NULL, version = version + 1, "
                    "updated_at = clock_timestamp() WHERE id = %s",
                    (deficiency_id,),
                )
                _audit(cursor, org, project_id, principal.id, deficiency_id,
                       "deficiency.change_withdrawn",
                       {"kind": "SEVERITY", "severity": waiting.get("severity"),
                        "rated": body.severity})  # fmt: skip
        suggested, _ = suggestion(str(row[5]), str(row[6]))
        cursor.execute(
            """
            INSERT INTO deficiency_ratings (
                organization_id, project_id, deficiency_id, severity, suggested_severity,
                rationale, rated_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (org, project_id, deficiency_id, body.severity, suggested, rationale, principal.id),
        )
        _audit(cursor, org, project_id, principal.id, deficiency_id, "deficiency.rated",
               {"severity": body.severity, "suggested_severity": suggested,
                "control_id": str(control_id)})  # fmt: skip
    return body_of(connection, project_id, control_id, principal)


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
        VALUES (%s, %s, %s, %s, 'deficiency', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, target_id, Json(payload)),
    )


def register_control_conclusions(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/control-conclusions"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ConclusionState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.get(f"{base}/{{control_id}}", response_model=ControlConclusionBody)
    def conclusion(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ControlConclusionBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ControlConclusionBody:
            authorize(
                c,
                principal=p,
                action=Action.TASK_READ,
                organization_id=organization_id,
                project_id=project_id,
            )
            return body_of(c, project_id, control_id, p)

        return run(request, work)

    @app.post(
        f"{base}/{{control_id}}/deficiencies/{{deficiency_id}}/rate",
        response_model=ControlConclusionBody,
    )
    def rated(
        organization_id: UUID, project_id: UUID, control_id: UUID, deficiency_id: UUID,
        body: RateBody, request: Request,
    ) -> ControlConclusionBody:  # fmt: skip
        return run(
            request,
            lambda c, p: rate(c, p, organization_id, project_id, control_id, deficiency_id, body),
        )
