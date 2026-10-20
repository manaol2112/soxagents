"""Readiness of a testing round (workflow integrity W4, decided by the product owner):
whether a roll-forward or retest round may be sampled and tested now, and if not, exactly
why. Remediation precedes retesting: a retest is not ready without the remediation
evidence, the fixed control having operated long enough, and the approved testing
prerequisites. Nothing here imposes an order the methodology does not: a roll-forward
needs interim testing signed off effective, not its review.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

# READY: the round may be sampled and tested now. NOT_READY: the blockers say why. DONE:
# the round's own testing activity is signed off (or the round cancelled); it says nothing
# about the round's independent review or the control's final completion, which
# control_journey.finality decides.
RoundState = Literal["READY", "NOT_READY", "DONE"]
_APPROVED = ("APPROVED", "CHANGES_PROPOSED")
_RECEIVED = ("RECEIVED", "CLOSED")
# Remediation evidence counts once it is on record as evidence: filed against the
# deficiency's remediation request (versioned, in custody, traceable to the deficiency),
# in part or in full. A note on the deficiency alone is not evidence (owner's decision).
_EVIDENCED = ("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED")


class RoundReadiness(BaseModel):
    round_id: UUID
    state: RoundState
    blockers: list[str]


@dataclass(frozen=True)
class RoundFacts:
    round_id: UUID
    kind: str
    status: str
    test_from: date
    today: date
    plan_status: str | None
    # The round's own evidence request: its standing, or None when none was made.
    request_status: str | None
    # Roll-forward: interim testing's conclusion. Retest: the deficiency and the standing
    # of its remediation request (the fix and its support).
    interim_conclusion: str | None = None
    deficiency_status: str | None = None
    remediation_request_status: str | None = None
    # Why the samples cannot be drawn (evidence_plans.population_gate), or None.
    population_blocker: str | None = None
    # Signed-off results of this control await a plan-revision impact decision (W3).
    impact_pending: int = 0
    # The round's explicit testing basis: absent, or set under a plan revision the
    # approved plan has since moved past (acceptance follow-up).
    basis_missing: bool = False
    basis_stale: bool = False
    # Reconstructed by migration 0093 for a round opened before basis records existed,
    # and not yet confirmed by a person.
    basis_reconstructed: bool = False
    extra: list[str] = field(default_factory=list)


def evaluate_round(facts: RoundFacts) -> RoundReadiness:
    """The round's readiness from its facts, with every blocker in the order to resolve."""
    if facts.status in ("SIGNED_OFF", "CANCELLED"):
        return RoundReadiness(round_id=facts.round_id, state="DONE", blockers=[])
    blockers: list[str] = []
    if facts.plan_status not in _APPROVED:
        blockers.append("Approve the test plan at its current revision")
    if facts.impact_pending:
        blockers.append("Decide the impact of the plan revision on the signed-off results first")
    if facts.basis_missing:
        blockers.append("Record the round's testing basis before its samples are approved")
    elif facts.basis_stale:
        blockers.append(
            "Confirm the round's testing basis: the test plan changed after the basis was set"
        )
    elif facts.basis_reconstructed:
        blockers.append(
            "Confirm the round's testing basis: it was reconstructed when basis records were "
            "introduced, not approved at the time"
        )
    if facts.kind == "ROLLFORWARD":
        if facts.interim_conclusion != "EFFECTIVE":
            blockers.append("Interim testing must be signed off effective before a roll-forward")
        if facts.request_status not in _RECEIVED:
            blockers.append(
                "The roll-forward evidence (changes since interim and the remaining "
                "population) is not received"
            )
    elif facts.kind == "RETEST":
        if facts.deficiency_status != "READY_FOR_RETEST":
            blockers.append("The deficiency is not ready for retest")
        if facts.remediation_request_status not in _EVIDENCED:
            blockers.append("Remediation evidence (the fix and its support) is not received")
        if facts.today < facts.test_from:
            blockers.append(
                f"The fixed control must operate until {facts.test_from.isoformat()} before "
                "it is retested"
            )
        if facts.request_status not in _RECEIVED:
            blockers.append("The retest population is not received")
    if facts.population_blocker:
        blockers.append(facts.population_blocker)
    blockers.extend(facts.extra)
    return RoundReadiness(
        round_id=facts.round_id, state="READY" if not blockers else "NOT_READY", blockers=blockers
    )


def round_facts(
    connection: psycopg.Connection[Any], project_id: UUID, round_id: UUID | None = None
) -> list[RoundFacts]:
    """The facts for every round of the engagement (or one round), read once."""
    from ai_workforce_api.evidence_plans import population_gate

    rows = connection.execute(
        """
        SELECT r.id, r.kind, r.status, r.test_from, r.engagement_control_id, p.status,
               q.status, d.status, m.status,
               (SELECT s.conclusion FROM test_sheets s
                WHERE s.engagement_control_id = r.engagement_control_id
                  AND s.test_round_id IS NULL),
               r.basis, p.approved_revision, r.basis_confirmed_at
        FROM test_rounds r
        LEFT JOIN evidence_plans p ON p.engagement_control_id = r.engagement_control_id
        LEFT JOIN pbc_requests q ON q.id = r.request_id
        LEFT JOIN deficiencies d ON d.id = r.deficiency_id
        LEFT JOIN pbc_requests m ON m.id = d.remediation_request_id
        WHERE r.project_id = %s AND (%s::uuid IS NULL OR r.id = %s)
        ORDER BY r.created_at
        """,
        (project_id, round_id, round_id),
    ).fetchall()
    pending: dict[UUID, int] = {}
    for control_id, count in connection.execute(
        """
        SELECT o.engagement_control_id, count(*)
        FROM test_sheet_signoffs o
        JOIN test_sheets s ON s.id = o.test_sheet_id AND s.status = 'SIGNED_OFF'
        JOIN evidence_plans p ON p.engagement_control_id = o.engagement_control_id
        WHERE o.project_id = %s AND o.reopened_at IS NULL AND p.approved_revision IS NOT NULL
          AND (o.plan_revision IS NULL OR o.plan_revision <> p.approved_revision)
          AND NOT EXISTS (
              SELECT 1 FROM plan_impact_assessments a
              WHERE a.signoff_id = o.id AND a.to_revision = p.approved_revision
                AND a.status = 'VALID'
          )
        GROUP BY 1
        """,
        (project_id,),
    ).fetchall():
        pending[UUID(str(control_id))] = int(count)
    today = date.today()
    found: list[RoundFacts] = []
    for row in rows:
        control_id = UUID(str(row[4]))
        kind = str(row[1])
        blocker = (
            population_gate(connection, control_id, kind)
            if str(row[2]) in ("REQUESTED", "TESTING")
            else None
        )
        found.append(
            RoundFacts(
                round_id=UUID(str(row[0])),
                kind=kind,
                status=str(row[2]),
                test_from=row[3],
                today=today,
                plan_status=None if row[5] is None else str(row[5]),
                request_status=None if row[6] is None else str(row[6]),
                interim_conclusion=None if row[9] is None else str(row[9]),
                deficiency_status=None if row[7] is None else str(row[7]),
                remediation_request_status=None if row[8] is None else str(row[8]),
                population_blocker=blocker,
                basis_missing=not isinstance(row[10], dict),
                basis_stale=isinstance(row[10], dict)
                and row[11] is not None
                and row[10].get("plan_revision") != int(row[11]),
                basis_reconstructed=isinstance(row[10], dict)
                and row[10].get("backfilled") is True
                and row[12] is None,
                impact_pending=pending.get(control_id, 0),
            )
        )
    return found


def round_readiness_states(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, RoundReadiness]:
    return {facts.round_id: evaluate_round(facts) for facts in round_facts(connection, project_id)}


class RoundNotReady(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def require_round_testable(
    connection: psycopg.Connection[Any], project_id: UUID, round_id: UUID
) -> None:
    """Sampling and testing a round wait until it is ready; the first blocker says why."""
    for facts in round_facts(connection, project_id, round_id):
        found = evaluate_round(facts)
        if found.state == "NOT_READY":
            raise RoundNotReady(found.blockers[0])


def round_waiting_reason(
    connection: psycopg.Connection[Any], project_id: UUID, round_id: UUID
) -> str:
    """Why the tester waits for this round, or "" when it may test."""
    try:
        require_round_testable(connection, project_id, round_id)
    except RoundNotReady as error:
        return f"Testing waits: {error.detail[0].lower()}{error.detail[1:]}."
    return ""
