"""Plan-revision impact assessments (workflow integrity W3, decided by the product owner).

Results are signed off under a test plan revision (test_sheets.plan_revision, stamped at
sign-off and kept on the sign-off's history row). When the approved plan is revised
afterwards, or the revision the results were tested under was never recorded, those
results are not relied on until an independent reviewer decides whether they stand
(VALID) or must be re-performed (REPERFORM). The agent compares the plan versions and
recommends, with its rationale; it never decides, and nothing is valid by default.

Detection runs when a revised plan is approved, at deploy, and on request. REPERFORM
reopens the sheet (Testing reopened, with the assessment as the reason) and the review
that covered it; every earlier sign-off stays on record (test_sheet_signoffs,
control_review_signoffs).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api import independence
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

Decision = Literal["VALID", "REPERFORM"]
# The control fields that describe how it operates; a change to them bears on results.
_OPERATION_FIELDS = frozenset({"description", "frequency", "nature", "application"})


class ImpactState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class ImpactBody(BaseModel):
    id: UUID
    control_id: UUID
    control_ref: str
    test_sheet_id: UUID
    test_round_id: UUID | None
    round_kind: str | None
    signoff_id: UUID
    signed_by: str | None
    signed_at: datetime
    conclusion: str
    from_revision: int | None
    to_revision: int
    status: Literal["PENDING", "VALID", "REPERFORM", "SUPERSEDED"]
    recommendation: dict[str, Any]
    decided_by: str | None
    decided_at: datetime | None
    rationale: str
    # Whether the person reading may decide it: the reviewer role, and not the person who
    # signed the testing off.
    viewer_can_decide: bool
    version: int


class DecisionBody(BaseModel):
    version: int = Field(ge=1)
    decision: Decision
    rationale: str = Field(min_length=3, max_length=2000)


def _plan_content(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    plan_id: UUID,
    revision: int | None,
) -> dict[str, Any] | None:
    """The plan as it was at a revision (its stored version), or as it is now."""
    from ai_workforce_api.master_plans import _load, content

    if revision is None:
        return None
    row = connection.execute(
        "SELECT content FROM plan_versions WHERE plan_id = %s AND revision = %s "
        "ORDER BY created_at DESC LIMIT 1",
        (plan_id, revision),
    ).fetchone()
    if row is not None and isinstance(row[0], dict):
        return dict(row[0])
    plans = _load(connection, project_id, control_id)
    plan = plans.get(control_id)
    if plan is None or plan.revision != revision:
        return None
    return content(plan)


def recommend(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    plan_id: UUID,
    from_revision: int | None,
    to_revision: int,
    tested_phase: str = "INTERIM",
) -> dict[str, Any]:
    """The agent's recommendation (the rules, no model): what changed between the two
    revisions, and whether any of it bears on the results: the control itself, the
    attributes, the evidence, or the procedures and phase decision of the phase that was
    tested (a later phase's own decision does not). A person decides; this is advice
    with its reasons."""
    from ai_workforce_api.master_plans import ChangeItem, changes_since

    at = datetime.now(UTC).isoformat()
    if from_revision is None:
        return {
            "decision": None,
            "rationale": "The revision these results were tested under was not recorded, "
            "so the plans cannot be compared. Compare the signed-off testing with the "
            "approved plan before deciding.",
            "changes": [],
            "by": "RULES",
            "at": at,
        }
    before = _plan_content(connection, project_id, control_id, plan_id, from_revision)
    after = _plan_content(connection, project_id, control_id, plan_id, to_revision)
    if before is None or after is None:
        return {
            "decision": None,
            "rationale": f"The plan at revision {from_revision} or {to_revision} is not "
            "stored, so the plans cannot be compared.",
            "changes": [],
            "by": "RULES",
            "at": at,
        }
    changes = changes_since(before, after)
    letter = {"DESIGN": "D", "INTERIM": "I", "ROLLFORWARD": "R", "RETEST": "I"}.get(
        tested_phase, "I"
    )
    phase_code = "INTERIM" if tested_phase == "RETEST" else tested_phase

    def bears(item: ChangeItem) -> bool:
        # What the results rest on: how the control operates, its attributes, its evidence,
        # and the procedures and phase decision of the phase that was tested.
        if item.section == "CONTROL":
            return item.code.lower() in _OPERATION_FIELDS
        if item.section in ("ATTRIBUTE", "EVIDENCE"):
            return True
        if item.section == "PHASE":
            return item.code == phase_code
        if item.section == "PROCEDURE":
            return item.code[:1].upper() == letter
        return False

    def needs_judgement(item: ChangeItem) -> bool:
        # The understanding, the scope or the risk changed: its substance is a person's
        # call, never assumed harmless (owner's decision 1).
        return item.section == "UNDERSTANDING" or (
            item.section == "CONTROL" and item.code.lower() not in _OPERATION_FIELDS
        )

    bearing = [item for item in changes if bears(item)]
    judged = [item for item in changes if needs_judgement(item)]
    listed = [
        {"section": item.section, "code": item.code, "change": item.change, "detail": item.detail}
        for item in changes
    ]
    if bearing:
        words = "; ".join(f"{c.section.lower()} {c.code} {c.change.lower()}" for c in bearing[:6])
        return {
            "decision": "REPERFORM",
            "rationale": f"Revision {to_revision} changes what the results rest on: {words}. "
            "Results signed off under revision "
            f"{from_revision} do not show the changed procedures or attributes were tested.",
            "changes": listed,
            "by": "RULES",
            "at": at,
        }
    if judged:
        words = "; ".join(
            f"{c.section.lower()} {c.code or 'summary'} {c.change.lower()}" for c in judged[:6]
        )
        return {
            "decision": None,
            "rationale": f"Revision {to_revision} changes the control's understanding, scope "
            f"or risk ({words}). Whether that bears on the signed-off results is a judgement: "
            "assess its substance before deciding.",
            "changes": listed,
            "by": "RULES",
            "at": at,
        }
    if not changes:
        rationale = (
            f"Revisions {from_revision} and {to_revision} are the same in every section a "
            "reviewer approves; the revision recorded a change elsewhere on the control."
        )
    else:
        rationale = (
            f"Revision {to_revision} changes only another testing phase's procedures or "
            f"decision ({len(changes)} item{'' if len(changes) == 1 else 's'}); nothing the "
            f"{tested_phase.lower()} results rest on changed."
        )
    return {"decision": "VALID", "rationale": rationale, "changes": listed, "by": "RULES", "at": at}


def detect(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID | None = None,
) -> list[UUID]:
    """Every current sign-off whose plan revision is unknown or differs from the plan's
    approved revision gets a PENDING assessment for that revision (once), with the agent's
    recommendation; a PENDING assessment for an earlier revision is superseded. Returns
    the assessments created."""
    rows = cursor.execute(
        """
        SELECT o.id, o.test_sheet_id, o.engagement_control_id, o.test_round_id,
               o.plan_revision, p.id, p.approved_revision, t.kind
        FROM test_sheet_signoffs o
        JOIN test_sheets s ON s.id = o.test_sheet_id AND s.status = 'SIGNED_OFF'
        JOIN evidence_plans p ON p.engagement_control_id = o.engagement_control_id
        LEFT JOIN test_rounds t ON t.id = o.test_round_id
        WHERE o.project_id = %s AND o.reopened_at IS NULL
          AND (%s::uuid IS NULL OR o.engagement_control_id = %s)
          AND p.approved_revision IS NOT NULL
          AND (o.plan_revision IS NULL OR o.plan_revision <> p.approved_revision)
        """,
        (project_id, control_id, control_id),
    ).fetchall()
    created: list[UUID] = []
    for signoff_id, sheet_id, cid, round_id, from_revision, plan_id, to_revision, kind in rows:
        cursor.execute(
            """
            UPDATE plan_impact_assessments
            SET status = 'SUPERSEDED', version = version + 1, updated_at = clock_timestamp()
            WHERE signoff_id = %s AND status = 'PENDING' AND to_revision < %s
            """,
            (signoff_id, to_revision),
        )
        exists = cursor.execute(
            "SELECT 1 FROM plan_impact_assessments WHERE signoff_id = %s AND to_revision = %s",
            (signoff_id, to_revision),
        ).fetchone()
        if exists is not None:
            continue
        advice = recommend(
            cursor.connection, project_id, UUID(str(cid)), UUID(str(plan_id)),
            None if from_revision is None else int(from_revision), int(to_revision),
            "INTERIM" if kind is None else str(kind),
        )  # fmt: skip
        inserted = cursor.execute(
            """
            INSERT INTO plan_impact_assessments (
                organization_id, project_id, engagement_control_id, test_sheet_id,
                test_round_id, signoff_id, from_revision, to_revision, recommendation
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                cid,
                sheet_id,
                round_id,
                signoff_id,
                from_revision,
                to_revision,
                Json(advice),
            ),  # fmt: skip
        ).fetchone()
        if inserted is not None:
            created.append(UUID(str(inserted[0])))
            _audit(
                cursor, organization_id, project_id, None, UUID(str(inserted[0])),
                "plan_impact.raised",
                {"from_revision": from_revision, "to_revision": to_revision,
                 "recommendation": advice.get("decision"), "sheet": str(sheet_id)},
            )  # fmt: skip
    return created


def detect_everywhere(connection: psycopg.Connection[Any]) -> int:
    """At deploy: every engagement's current sign-offs checked (the sign-offs made before
    revisions were stamped read as unknown and get their assessment)."""
    count = 0
    with transaction(connection) as cursor:
        projects = cursor.execute(
            "SELECT DISTINCT organization_id, project_id FROM test_sheet_signoffs"
        ).fetchall()
        for organization_id, project_id in projects:
            count += len(detect(cursor, UUID(str(organization_id)), UUID(str(project_id))))
    return count


def pending_counts(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, int]:
    """Per control: the assessments waiting for a reviewer."""
    return {
        UUID(str(row[0])): int(row[1])
        for row in connection.execute(
            "SELECT engagement_control_id, count(*) FROM plan_impact_assessments "
            "WHERE project_id = %s AND status = 'PENDING' GROUP BY 1",
            (project_id,),
        ).fetchall()
    }


def _body(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    assessment_id: UUID,
    viewer: UUID,
    reviewer: bool,
) -> ImpactBody:
    row = connection.execute(
        """
        SELECT a.id, a.engagement_control_id, c.control_ref, a.test_sheet_id, a.test_round_id,
               t.kind, a.signoff_id, u.display_name, o.signed_at, o.conclusion, a.from_revision,
               a.to_revision, a.status, a.recommendation, d.display_name, a.decided_at,
               a.rationale, a.version, o.signed_by
        FROM plan_impact_assessments a
        JOIN engagement_controls c ON c.id = a.engagement_control_id
        JOIN test_sheet_signoffs o ON o.id = a.signoff_id
        LEFT JOIN test_rounds t ON t.id = a.test_round_id
        LEFT JOIN users u ON u.id = o.signed_by
        LEFT JOIN users d ON d.id = a.decided_by
        WHERE a.id = %s AND a.project_id = %s
        """,
        (assessment_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    signer = None if row[18] is None else UUID(str(row[18]))
    return ImpactBody(
        id=UUID(str(row[0])),
        control_id=UUID(str(row[1])),
        control_ref=str(row[2]),
        test_sheet_id=UUID(str(row[3])),
        test_round_id=None if row[4] is None else UUID(str(row[4])),
        round_kind=None if row[5] is None else str(row[5]),
        signoff_id=UUID(str(row[6])),
        signed_by=None if row[7] is None else str(row[7]),
        signed_at=row[8],
        conclusion=str(row[9]),
        from_revision=None if row[10] is None else int(row[10]),
        to_revision=int(row[11]),
        status=str(row[12]),  # type: ignore[arg-type]
        recommendation=dict(row[13]) if isinstance(row[13], dict) else {},
        decided_by=None if row[14] is None else str(row[14]),
        decided_at=row[15],
        rationale=str(row[16]),
        viewer_can_decide=reviewer
        and str(row[12]) == "PENDING"
        and (not independence.required() or signer != viewer),
        version=int(row[17]),
    )


def assessments(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ImpactBody]:
    from ai_workforce_api.control_reviews import _is_reviewer

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    reviewer = _is_reviewer(connection, project_id, principal.id)
    rows = connection.execute(
        """
        SELECT id FROM plan_impact_assessments WHERE project_id = %s AND organization_id = %s
        ORDER BY (status = 'PENDING') DESC, created_at
        """,
        (project_id, organization_id),
    ).fetchall()
    return [
        _body(connection, project_id, UUID(str(row[0])), principal.id, reviewer) for row in rows
    ]


def detect_now(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ImpactBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    with transaction(connection) as cursor:
        detect(cursor, organization_id, project_id)
    return assessments(connection, principal, organization_id, project_id)


def decide(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    assessment_id: UUID,
    body: DecisionBody,
) -> ImpactBody:
    """An independent reviewer decides. VALID records it; REPERFORM also reopens the
    sheet (Testing reopened, this assessment as the reason) and the review that covered
    it. The person who signed the testing off never decides its assessment."""
    from ai_workforce_api.control_reviews import _is_reviewer, reopen_review_for
    from ai_workforce_api.inbound import clean_text
    from ai_workforce_api.test_sheets import ReopenBody, SheetState, reopen_work

    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if not _is_reviewer(connection, project_id, principal.id):
        raise ImpactState("only the engagement's reviewer decides an impact assessment")
    rationale = clean_text(body.rationale, 2000).text
    with transaction(connection) as cursor:
        row = cursor.execute(
            """
            SELECT a.status, a.version, a.test_sheet_id, a.engagement_control_id,
                   a.test_round_id, a.to_revision, o.signed_by
            FROM plan_impact_assessments a JOIN test_sheet_signoffs o ON o.id = a.signoff_id
            WHERE a.id = %s AND a.project_id = %s FOR UPDATE OF a
            """,
            (assessment_id, project_id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        status, version, sheet_id, control_id, round_id, to_revision, signed_by = row
        if int(version) != body.version:
            raise ImpactState("the assessment changed")
        if status != "PENDING":
            raise ImpactState("the assessment is decided")
        if independence.required() and signed_by == principal.id:
            raise ImpactState(
                "you signed off this testing; another reviewer decides its impact assessment"
            )
        cursor.execute(
            """
            UPDATE plan_impact_assessments
            SET status = %s, decided_by = %s, decided_at = clock_timestamp(), rationale = %s,
                version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (body.decision, principal.id, rationale, assessment_id),
        )
        _audit(
            cursor, organization_id, project_id, principal.id, assessment_id,
            "plan_impact.decided",
            {"decision": body.decision, "to_revision": to_revision, "sheet": str(sheet_id)},
        )  # fmt: skip
        if body.decision == "REPERFORM":
            sheet = cursor.execute(
                """
                SELECT id, status, version, engagement_control_id, method, attributes,
                       proposal_status, proposal
                FROM test_sheets WHERE id = %s FOR UPDATE
                """,
                (sheet_id,),
            ).fetchone()
            if sheet is None:
                raise NotVisible()
            reason = f"Plan revision {to_revision}: {rationale}"
            if sheet[1] == "SIGNED_OFF":
                try:
                    reopen_work(
                        ReopenBody(version=int(sheet[2]), reason=reason[:500]),
                        source="IMPACT_ASSESSMENT",
                        source_id=assessment_id,
                    )(cursor, principal, sheet, organization_id, project_id)
                except SheetState as error:
                    raise ImpactState(
                        f"the testing could not be reopened: {error.detail}"
                    ) from None
                cursor.execute(
                    "UPDATE test_sheets SET version = version + 1 WHERE id = %s", (sheet_id,)
                )
            reopen_review_for(
                cursor, principal, organization_id, project_id, UUID(str(control_id)),
                None if round_id is None else UUID(str(round_id)), reason[:500],
                "IMPACT_ASSESSMENT",
            )  # fmt: skip
    from ai_workforce_api.control_reviews import _is_reviewer as reviewer_check

    return _body(
        connection, project_id, assessment_id, principal.id,
        reviewer_check(connection, project_id, principal.id),
    )  # fmt: skip


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    assessment_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (organization_id, project_id, actor_user_id, action,
                                  target_type, target_id, payload)
        VALUES (%s, %s, %s, %s, 'plan_impact_assessment', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, assessment_id, Json(payload)),
    )


def register_plan_impact(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/impact"

    @app.get(base)
    def list_assessments(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[ImpactBody]:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda c: assessments(c, principal, organization_id, project_id),
        )

    @app.post(f"{base}/detect")
    def detect_assessments(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[ImpactBody]:
        principal = _session_principal(request)
        return _call(settings, lambda c: detect_now(c, principal, organization_id, project_id))

    @app.post(f"{base}/{{assessment_id}}/decide")
    def decide_assessment(
        organization_id: UUID,
        project_id: UUID,
        assessment_id: UUID,
        body: DecisionBody,
        request: Request,
    ) -> ImpactBody:
        principal = _session_principal(request)
        try:
            return _call(
                settings,
                lambda c: decide(c, principal, organization_id, project_id, assessment_id, body),
            )
        except ImpactState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
