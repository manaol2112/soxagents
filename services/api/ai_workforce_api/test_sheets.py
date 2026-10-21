"""Test sheets: what the tester found for each item, and a person's decisions on it.

A person with project update rights can link a file to an item or take it off, set a
file aside as not test evidence, override any result with a reason, test again, and
sign the sheet off. The conclusion is derived from the final results (testing_engine.py),
never typed in. Signing off with exceptions drafts a deficiency, which the person logs
(through the deficiency register's own checks) or dismisses with a reason.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.agent_runs import CancelState, RunState, cancel_state, run_state
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
from ai_workforce_api.evidence_plans import refresh_decisions
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.settings import Settings
from ai_workforce_api.test_rounds import round_signed_off, start_rollforward
from ai_workforce_api.testing_engine import (
    RESULTS,
    Conclusion,
    ItemView,
    Result,
    TestScheduler,
    conclusion,
    final_results,
    now_text,
    propose_deficiency,
    request_run,
    schedule_runs,
)
from ai_workforce_api.workpaper_service import ensure, schedule_drafts
from ai_workforce_api.workpaper_service import open_drafts as open_workpapers

Severity = Literal["CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"]


class SheetState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


class CellBody(BaseModel):
    index: int
    proposed: Result | None
    note: str
    final: Result | None
    override_reason: str
    overridden_by: str | None
    # The passages the tester relied on: file, words, place, and a box on a screenshot.
    citations: list[dict[str, Any]] = []


class ItemFileBody(BaseModel):
    id: UUID
    file_name: str


class ItemBody(BaseModel):
    id: UUID
    position: int
    label: str
    # The application this item stands for, when a control is tested once per application.
    application_id: UUID | None = None
    detail: list[dict[str, str]]
    files: list[ItemFileBody]
    state: Literal["NO_EVIDENCE", "WAITING", "TESTED"]
    source: str | None
    note: str
    cells: list[CellBody]
    version: int


class PlacementBody(BaseModel):
    file_id: UUID
    file_name: str
    placement: str
    placed_by: str
    reason: str


class SheetBody(BaseModel):
    id: UUID
    control_id: UUID
    control_ref: str
    method: Literal["SAMPLE", "TEST_OF_ONE"]
    attributes: list[str]
    status: Literal["OPEN", "SIGNED_OFF"]
    running: bool
    # Queued for the tester, the tester running it now, or neither (agent_runs.py).
    run_state: RunState = "IDLE"
    # Why the last run stopped before finishing (testing_engine.fail_run), or "": an agent
    # execution failure, distinct from exceptions in the results.
    run_note: str = ""
    proposed_conclusion: Conclusion
    conclusion: str | None
    signed_by: str | None
    signed_at: datetime | None
    signoff_note: str
    items: list[ItemBody]
    placements: list[PlacementBody]
    counts: dict[str, int]
    blocking: list[str]
    proposal: dict[str, Any] | None
    proposal_status: str
    proposal_reason: str
    deficiency_reference: str | None
    version: int
    # The roll-forward or retest round this sheet is for; None for interim testing.
    test_round_id: UUID | None = None
    round_kind: str | None = None
    application_name: str = ""
    # Why the tester is waiting for this control (readiness.py), or "".
    waiting_note: str = ""
    # A person's cancellation of the run: asked for and pending, carried out, or neither
    # (agent_runs.cancel_state, Milestone 3a).
    cancel_state: CancelState = "NONE"


class VersionBody(BaseModel):
    version: int = Field(ge=1)


class OverrideBody(BaseModel):
    version: int = Field(ge=1)
    index: int = Field(ge=0, lt=12)
    result: Result
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def plain(cls, value: str) -> str:
        cleaned = clean_line(value, 500)
        if len(cleaned) < 3:
            raise ValueError("a reason is required")
        return cleaned


class LinkBody(BaseModel):
    file_id: UUID
    item_id: UUID | None = None
    # LINK puts the file on the item; UNLINK takes it off; EXCLUDE sets the file aside
    # as not test evidence; INCLUDE brings it back for the tester to place.
    action: Literal["LINK", "UNLINK", "EXCLUDE", "INCLUDE"]
    reason: str = Field(default="", max_length=300)


class SignOffBody(BaseModel):
    version: int = Field(ge=1)
    note: str = Field(default="", max_length=1000)


class ReopenBody(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


# What reopened a signed-off sheet (migration 0089): a review note that must be fixed, a
# plan-revision impact assessment, or a person. Set by the caller, never from a request.
ReopenSource = Literal["REVIEW_NOTE", "IMPACT_ASSESSMENT", "PERSON"]


class SignoffBody(BaseModel):
    """One sign-off of a test sheet as it was made (test_sheet_signoffs, migration 0091),
    and, if the sheet was opened again afterwards, why. Never rewritten."""

    id: UUID
    test_sheet_id: UUID
    test_round_id: UUID | None
    round_kind: str | None
    sheet_version: int
    conclusion: str
    signed_by: str | None
    signed_at: datetime
    signoff_note: str
    plan_revision: int | None
    reopened_at: datetime | None
    reopened_by: str | None
    reopen_reason: str
    reopened_from: str | None


def sheet_signoffs(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    sheet_id: UUID,
) -> list[SignoffBody]:
    """The sheet's sign-off history, oldest first, for anyone who may read the project.
    A sheet outside the organization and project asked for is not visible."""
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    owned = connection.execute(
        "SELECT 1 FROM test_sheets WHERE id = %s AND project_id = %s AND organization_id = %s",
        (sheet_id, project_id, organization_id),
    ).fetchone()
    if owned is None:
        raise NotVisible()
    rows = connection.execute(
        """
        SELECT o.id, o.test_sheet_id, o.test_round_id, r.kind, o.sheet_version, o.conclusion,
               s.display_name, o.signed_at, o.signoff_note, o.plan_revision, o.reopened_at,
               b.display_name, o.reopen_reason, o.reopened_from
        FROM test_sheet_signoffs o
        LEFT JOIN test_rounds r ON r.id = o.test_round_id
        LEFT JOIN users s ON s.id = o.signed_by
        LEFT JOIN users b ON b.id = o.reopened_by
        WHERE o.test_sheet_id = %s AND o.project_id = %s
        ORDER BY o.signed_at
        """,
        (sheet_id, project_id),
    ).fetchall()
    return [
        SignoffBody(
            id=row[0],
            test_sheet_id=row[1],
            test_round_id=row[2],
            round_kind=None if row[3] is None else str(row[3]),
            sheet_version=int(row[4]),
            conclusion=str(row[5]),
            signed_by=None if row[6] is None else str(row[6]),
            signed_at=row[7],
            signoff_note=str(row[8]),
            plan_revision=None if row[9] is None else int(row[9]),
            reopened_at=row[10],
            reopened_by=None if row[11] is None else str(row[11]),
            reopen_reason=str(row[12]),
            reopened_from=None if row[13] is None else str(row[13]),
        )
        for row in rows
    ]


class DeficiencyDecision(BaseModel):
    version: int = Field(ge=1)
    action: Literal["LOG", "DISMISS"]
    reason: str = Field(default="", max_length=500)
    title: str | None = Field(default=None, max_length=200)
    condition: str | None = Field(default=None, max_length=4000)
    criteria: str | None = Field(default=None, max_length=4000)
    cause: str | None = Field(default=None, max_length=4000)
    effect: str | None = Field(default=None, max_length=4000)
    severity: Severity | None = None


def register_test_sheets(app: FastAPI, settings: Settings, scheduler: TestScheduler | None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/test-sheets"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except SheetState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def act(
        request: Request, organization_id: UUID, project_id: UUID, sheet_id: UUID, work: Work
    ) -> SheetBody:
        def change(connection: psycopg.Connection[Any], principal: Principal) -> SheetBody:
            sheet, queued = change_sheet(
                connection, principal, organization_id, project_id, sheet_id, work
            )
            schedule_runs(scheduler, [] if queued is None else [queued])
            schedule_drafts(scheduler, open_workpapers(connection))
            return sheet

        return run(request, change)

    @app.get(base)
    def list_sheets(organization_id: UUID, project_id: UUID, request: Request) -> list[SheetBody]:
        return run(request, lambda c, p: sheets(c, p, organization_id, project_id))

    @app.get(f"{base}/{{sheet_id}}/signoffs")
    def list_signoffs(
        organization_id: UUID, project_id: UUID, sheet_id: UUID, request: Request
    ) -> list[SignoffBody]:
        return run(
            request, lambda c, p: sheet_signoffs(c, p, organization_id, project_id, sheet_id)
        )

    @app.post(f"{base}/{{sheet_id}}/retest")
    def retest(
        organization_id: UUID, project_id: UUID, sheet_id: UUID, body: VersionBody, request: Request
    ) -> SheetBody:
        return act(request, organization_id, project_id, sheet_id, retest_work(body.version))

    @app.post(f"{base}/{{sheet_id}}/links")
    def link(
        organization_id: UUID, project_id: UUID, sheet_id: UUID, body: LinkBody, request: Request
    ) -> SheetBody:
        return act(request, organization_id, project_id, sheet_id, link_work(body))

    @app.post(f"{base}/{{sheet_id}}/items/{{item_id}}/override")
    def override(
        organization_id: UUID,
        project_id: UUID,
        sheet_id: UUID,
        item_id: UUID,
        body: OverrideBody,
        request: Request,
    ) -> SheetBody:
        return act(request, organization_id, project_id, sheet_id, override_work(item_id, body))

    @app.post(f"{base}/{{sheet_id}}/sign-off")
    def sign_off(
        organization_id: UUID, project_id: UUID, sheet_id: UUID, body: SignOffBody, request: Request
    ) -> SheetBody:
        return act(request, organization_id, project_id, sheet_id, sign_off_work(body))

    @app.post(f"{base}/{{sheet_id}}/reopen")
    def reopen(
        organization_id: UUID, project_id: UUID, sheet_id: UUID, body: ReopenBody, request: Request
    ) -> SheetBody:
        return act(request, organization_id, project_id, sheet_id, reopen_work(body))

    @app.post(f"{base}/{{sheet_id}}/deficiency")
    def deficiency(
        organization_id: UUID,
        project_id: UUID,
        sheet_id: UUID,
        body: DeficiencyDecision,
        request: Request,
    ) -> SheetBody:
        return run(
            request,
            lambda c, p: decide_deficiency(c, p, organization_id, project_id, sheet_id, body),
        )


# Decisions on a sheet. Each `work` runs with the sheet locked, and returns whether the
# tester should run again. The page and the console both go through change_sheet.

# (cursor, person, the locked sheet row, organization, project) -> run again?
Work = Callable[[psycopg.Cursor[Any], Principal, tuple[Any, ...], UUID, UUID], bool]


def sheets(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[SheetBody]:
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    rows = connection.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchall()
    return [_sheet(connection, project_id, UUID(str(row[0]))) for row in rows]


def change_sheet(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    sheet_id: UUID,
    work: Work,
) -> tuple[SheetBody, UUID | None]:
    """One decision on a sheet, as the person. Returns the sheet and a run to schedule."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    with transaction(connection) as cursor:
        sheet = cursor.execute(
            """
            SELECT id, status, version, engagement_control_id, method, attributes,
                   proposal_status, proposal
            FROM test_sheets WHERE id = %s AND project_id = %s AND organization_id = %s
            FOR UPDATE
            """,
            (sheet_id, project_id, organization_id),
        ).fetchone()
        if sheet is None:
            raise NotVisible()
        rerun = work(cursor, principal, sheet, organization_id, project_id)
        cursor.execute("UPDATE test_sheets SET version = version + 1 WHERE id = %s", (sheet_id,))
        queued = request_run(cursor, sheet_id) if rerun else None
    return _sheet(connection, project_id, sheet_id), queued


def retest_work(version: int) -> Work:
    def work(
        cursor: psycopg.Cursor[Any],
        principal: Principal,
        sheet: tuple[Any, ...],
        organization_id: UUID,
        project_id: UUID,
    ) -> bool:
        _open(sheet, version)
        cursor.execute(
            "UPDATE test_items SET needs_test = true, version = version + 1 "
            "WHERE test_sheet_id = %s",
            (sheet[0],),
        )
        # Files the tester could not place are placed again with the new evidence.
        cursor.execute(
            "DELETE FROM test_sheet_files WHERE test_sheet_id = %s AND placed_by = 'AGENT' "
            "AND placement = 'UNPLACED'",
            (sheet[0],),
        )
        _audit(cursor, organization_id, project_id, principal.id, sheet[0], "testing.retest", {})
        return True

    return work


def link_work(body: LinkBody) -> Work:
    def work(
        cursor: psycopg.Cursor[Any],
        principal: Principal,
        sheet: tuple[Any, ...],
        organization_id: UUID,
        project_id: UUID,
    ) -> bool:
        if sheet[1] != "OPEN":
            raise SheetState("the sheet is signed off")
        _link(cursor, principal, project_id, sheet[0], sheet[3], body)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            sheet[0],
            "testing.evidence_linked",
            {"action": body.action, "file_id": str(body.file_id)},
        )
        return body.action != "EXCLUDE"

    return work


def override_work(item_id: UUID, body: OverrideBody) -> Work:
    def work(
        cursor: psycopg.Cursor[Any],
        principal: Principal,
        sheet: tuple[Any, ...],
        organization_id: UUID,
        project_id: UUID,
    ) -> bool:
        if sheet[1] != "OPEN":
            raise SheetState("the sheet is signed off")
        if body.index >= len(sheet[5]):
            raise SheetState("the control has no such attribute")
        item = cursor.execute(
            "SELECT overrides, version FROM test_items "
            "WHERE id = %s AND test_sheet_id = %s FOR UPDATE",
            (item_id, sheet[0]),
        ).fetchone()
        if item is None:
            raise NotVisible()
        if int(item[1]) != body.version:
            raise SheetState("the item changed")
        kept = [entry for entry in item[0] if entry.get("index") != body.index]
        kept.append(
            {
                "index": body.index,
                "result": body.result,
                "reason": body.reason,
                "by": str(principal.id),
                "at": now_text(),
            }
        )
        cursor.execute(
            "UPDATE test_items SET overrides = %s, version = version + 1 WHERE id = %s",
            (Json(kept), item_id),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            sheet[0],
            "testing.result_overridden",
            {"item_id": str(item_id), "index": body.index, "result": body.result},
        )
        return False

    return work


def sign_off_work(body: SignOffBody) -> Work:
    def work(
        cursor: psycopg.Cursor[Any],
        principal: Principal,
        sheet: tuple[Any, ...],
        organization_id: UUID,
        project_id: UUID,
    ) -> bool:
        _open(sheet, body.version)
        # Testing is concluded only on a master test plan a person approved, at its
        # current revision (master_plans.py).
        from ai_workforce_api.evidence_plans import gate_reason

        blocked = gate_reason(cursor.connection, sheet[3], None)
        if blocked is not None:
            raise SheetState(blocked)
        current = _sheet(cursor.connection, project_id, sheet[0])
        if current.running:
            raise SheetState("the tester is still testing")
        if current.proposed_conclusion == "INCOMPLETE":
            raise SheetState("; ".join(current.blocking) or "the testing is not complete")
        proposal = None
        # A failed retest goes back to the deficiency it retests, not to a new one.
        if current.proposed_conclusion == "NOT_EFFECTIVE" and current.round_kind != "RETEST":
            proposal = _draft(cursor, project_id, current)
        cursor.execute(
            """
            UPDATE test_sheets
            SET status = 'SIGNED_OFF', conclusion = %s, signed_by = %s,
                signed_at = clock_timestamp(), signoff_note = %s,
                proposal = %s, proposal_status = %s,
                -- The plan revision the results were tested under (finality, W3), and the
                -- end of any reopening (the audit log keeps its reason).
                plan_revision = (SELECT p.approved_revision FROM evidence_plans p
                                 WHERE p.engagement_control_id = test_sheets.engagement_control_id),
                reopened_at = NULL, reopened_by = NULL, reopen_reason = '',
                reopened_from = NULL, reopened_from_id = NULL
            WHERE id = %s
            """,
            (
                current.proposed_conclusion,
                principal.id,
                clean_text(body.note, 1000).text,
                None if proposal is None else Json(proposal),
                "NONE" if proposal is None else "PROPOSED",
                sheet[0],
            ),
        )
        # The sign-off as made, kept for good (test_sheet_signoffs, migration 0091):
        # reopening the sheet later marks this row, it never rewrites it.
        cursor.execute(
            """
            INSERT INTO test_sheet_signoffs (
                organization_id, project_id, test_sheet_id, engagement_control_id,
                test_round_id, sheet_version, conclusion, signed_by, signed_at, signoff_note,
                plan_revision
            )
            SELECT organization_id, project_id, id, engagement_control_id, test_round_id,
                   version, conclusion, signed_by, signed_at, signoff_note, plan_revision
            FROM test_sheets WHERE id = %s
            """,
            (sheet[0],),
        )
        # The effectiveness workpaper opens, filled from the signed-off testing.
        ensure(cursor, organization_id, project_id, sheet[3], principal.id, ("EFFECTIVENESS",))
        if current.test_round_id is not None:
            round_signed_off(
                cursor, organization_id, project_id, current.test_round_id,
                current.proposed_conclusion, principal.id,
            )  # fmt: skip
        else:
            if current.proposed_conclusion == "EFFECTIVE":
                # Effective at interim: the rest of the period is rolled forward.
                start_rollforward(
                    cursor, organization_id, project_id, sheet[0], sheet[3], principal.id
                )
            # The evidence plan's roll-forward follows the interim result: applicable for
            # the remaining period, or pending a decision after exceptions.
            refresh_decisions(cursor, organization_id, project_id, sheet[3], principal.id)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            sheet[0],
            "testing.signed_off",
            {"conclusion": current.proposed_conclusion, "items": len(current.items)},
        )
        return False

    return work


def reopen_work(
    body: ReopenBody, source: ReopenSource = "PERSON", source_id: UUID | None = None
) -> Work:
    def work(
        cursor: psycopg.Cursor[Any],
        principal: Principal,
        sheet: tuple[Any, ...],
        organization_id: UUID,
        project_id: UUID,
    ) -> bool:
        if sheet[1] != "SIGNED_OFF" or int(sheet[2]) != body.version:
            raise SheetState("the sheet changed")
        if sheet[6] == "LOGGED":
            raise SheetState("its deficiency is logged; change it in the deficiency register")
        round_row = cursor.execute(
            "SELECT r.id, r.kind FROM test_sheets s JOIN test_rounds r ON r.id = s.test_round_id "
            "WHERE s.id = %s",
            (sheet[0],),
        ).fetchone()
        if round_row is not None and round_row[1] == "RETEST":
            raise SheetState(
                "the retest decided its deficiency; change it in the deficiency register"
            )
        if round_row is not None:
            cursor.execute(
                "UPDATE test_rounds SET status = 'TESTING', conclusion = NULL, "
                "version = version + 1 WHERE id = %s",
                (round_row[0],),
            )
        else:
            # A roll-forward nobody has started yet is withdrawn with the interim result.
            from ai_workforce_api.test_rounds import cancel_unstarted_rollforward

            cancel_unstarted_rollforward(
                cursor, organization_id, project_id, sheet[3], principal.id
            )
        cursor.execute(
            """
            UPDATE test_sheets
            SET status = 'OPEN', conclusion = NULL, signed_by = NULL, signed_at = NULL,
                proposal = NULL, proposal_status = 'NONE', proposal_reason = '',
                proposal_decided_by = NULL, run_status = 'IDLE',
                reopened_at = clock_timestamp(), reopened_by = %s, reopen_reason = %s,
                reopened_from = %s, reopened_from_id = %s
            WHERE id = %s
            """,
            (principal.id, clean_line(body.reason, 500), source, source_id, sheet[0]),
        )
        # The sign-off being reopened stays on record, marked once as reopened.
        cursor.execute(
            """
            UPDATE test_sheet_signoffs
            SET reopened_at = clock_timestamp(), reopened_by = %s, reopen_reason = %s,
                reopened_from = %s
            WHERE test_sheet_id = %s AND reopened_at IS NULL
            """,
            (principal.id, clean_line(body.reason, 500), source, sheet[0]),
        )
        if round_row is None:
            # Interim testing is open again: the roll-forward waits for it once more.
            refresh_decisions(cursor, organization_id, project_id, sheet[3], principal.id)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            sheet[0],
            "testing.reopened",
            {"reason": clean_line(body.reason, 500)},
        )
        return False

    return work


# Reading a sheet


def _sheet(connection: psycopg.Connection[Any], project_id: UUID, sheet_id: UUID) -> SheetBody:
    row = connection.execute(
        """
        SELECT s.id, s.engagement_control_id, c.control_ref, s.method, s.attributes, s.status,
               s.run_status, s.conclusion, u.display_name, s.signed_at, s.signoff_note,
               s.proposal, s.proposal_status, s.proposal_reason, d.reference, s.version,
               s.test_round_id, r.kind,
               (SELECT a.name FROM engagement_applications a
                WHERE a.id = c.engagement_application_id),
               s.waiting_note, s.run_note, s.cancel_requested_at, s.cancelled_at
        FROM test_sheets s
        JOIN engagement_controls c ON c.id = s.engagement_control_id
        LEFT JOIN users u ON u.id = s.signed_by
        LEFT JOIN deficiencies d ON d.id = s.deficiency_id
        LEFT JOIN test_rounds r ON r.id = s.test_round_id
        WHERE s.id = %s AND s.project_id = %s
        """,
        (sheet_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    attributes = [str(item) for item in row[4]]
    names = {
        str(user_id): str(name)
        for user_id, name in connection.execute(
            "SELECT DISTINCT u.id, u.display_name FROM test_items i "
            "CROSS JOIN LATERAL jsonb_array_elements(i.overrides) o "
            "JOIN users u ON u.id = (o ->> 'by')::uuid WHERE i.test_sheet_id = %s",
            (sheet_id,),
        ).fetchall()
    }
    links: dict[UUID, list[ItemFileBody]] = {}
    for item_id, file_id, name in connection.execute(
        """
        SELECT t.test_item_id, f.id, f.file_name FROM test_item_files t
        JOIN test_items i ON i.id = t.test_item_id
        JOIN evidence_files f ON f.id = t.evidence_file_id
        WHERE i.test_sheet_id = %s ORDER BY f.file_name
        """,
        (sheet_id,),
    ).fetchall():
        links.setdefault(item_id, []).append(ItemFileBody(id=file_id, file_name=str(name)))
    items: list[ItemBody] = []
    views: list[ItemView] = []
    for item in connection.execute(
        """
        SELECT id, position, label, detail, needs_test, results, overrides, source, note,
               tested_at, version, engagement_application_id
        FROM test_items WHERE test_sheet_id = %s ORDER BY position
        """,
        (sheet_id,),
    ).fetchall():
        files = links.get(item[0], [])
        results = list(item[5]) if isinstance(item[5], list) else []
        overrides = list(item[6]) if isinstance(item[6], list) else []
        tested = item[9] is not None and not bool(item[4])
        finals = final_results(len(attributes), results, overrides)
        views.append(ItemView(has_evidence=bool(files), tested=tested, final=finals))
        by_result = {entry.get("index"): entry for entry in results if isinstance(entry, dict)}
        by_override = {entry.get("index"): entry for entry in overrides if isinstance(entry, dict)}
        items.append(
            ItemBody(
                id=item[0],
                position=int(item[1]),
                label=str(item[2]),
                application_id=item[11],
                detail=[
                    {"column": str(entry.get("column", "")), "value": str(entry.get("value", ""))}
                    for entry in (item[3] if isinstance(item[3], list) else [])
                    if isinstance(entry, dict)
                ],
                files=files,
                state="NO_EVIDENCE" if not files else "TESTED" if tested else "WAITING",
                source=None if item[7] is None else str(item[7]),
                note=str(item[8]),
                cells=[
                    CellBody(
                        index=index,
                        proposed=_result(by_result.get(index, {}).get("result")),
                        note=str(by_result.get(index, {}).get("note", "")),
                        citations=[
                            item
                            for item in by_result.get(index, {}).get("citations", [])
                            if isinstance(item, dict)
                        ][:4],
                        final=finals[index],
                        override_reason=str(by_override.get(index, {}).get("reason", "")),
                        overridden_by=names.get(str(by_override.get(index, {}).get("by")))
                        if index in by_override
                        else None,
                    )
                    for index in range(len(attributes))
                ],
                version=int(item[10]),
            )
        )
    placements = [
        PlacementBody(
            file_id=entry[0],
            file_name=str(entry[1]),
            placement=str(entry[2]),
            placed_by=str(entry[3]),
            reason=str(entry[4]),
        )
        for entry in connection.execute(
            """
            SELECT f.id, f.file_name, p.placement, p.placed_by, p.reason
            FROM test_sheet_files p JOIN evidence_files f ON f.id = p.evidence_file_id
            WHERE p.test_sheet_id = %s ORDER BY p.placement, f.file_name
            """,
            (sheet_id,),
        ).fetchall()
    ]
    proposed = conclusion(views)
    finals_all = [result for view in views for result in view.final]
    counts = {
        "items": len(items),
        "tested": sum(1 for item in items if item.state == "TESTED"),
        "no_evidence": sum(1 for item in items if item.state == "NO_EVIDENCE"),
        "exceptions": sum(1 for view in views if "EXCEPTION" in view.final),
        "unable": sum(1 for result in finals_all if result == "UNABLE"),
        "review": sum(1 for result in finals_all if result == "REVIEW"),
        "unplaced": sum(1 for entry in placements if entry.placement == "UNPLACED"),
    }
    blocking: list[str] = []
    if counts["no_evidence"]:
        blocking.append(_items(counts["no_evidence"], "has no evidence", "have no evidence"))
    waiting = counts["items"] - counts["tested"] - counts["no_evidence"]
    if waiting:
        blocking.append(_items(waiting, "is not tested yet", "are not tested yet"))
    if counts["unable"]:
        blocking.append(
            _results(
                counts["unable"],
                "has insufficient evidence and needs a person to decide",
                "have insufficient evidence and need a person to decide",
            )
        )
    if counts["review"]:
        blocking.append(
            _results(
                counts["review"],
                "needs human review: a person decides",
                "need human review: a person decides",
            )
        )
    return SheetBody(
        id=row[0],
        control_id=row[1],
        control_ref=str(row[2]),
        method="TEST_OF_ONE" if row[3] == "TEST_OF_ONE" else "SAMPLE",
        attributes=attributes,
        status="SIGNED_OFF" if row[5] == "SIGNED_OFF" else "OPEN",
        running=row[6] in ("PENDING", "WORKING"),
        run_state=run_state(row[6]),
        proposed_conclusion=proposed,
        conclusion=None if row[7] is None else str(row[7]),
        signed_by=None if row[8] is None else str(row[8]),
        signed_at=row[9],
        signoff_note=str(row[10]),
        items=items,
        placements=placements,
        counts=counts,
        blocking=blocking,
        proposal=row[11] if isinstance(row[11], dict) else None,
        proposal_status=str(row[12]),
        proposal_reason=str(row[13]),
        deficiency_reference=None if row[14] is None else str(row[14]),
        version=int(row[15]),
        test_round_id=row[16],
        round_kind=None if row[17] is None else str(row[17]),
        application_name="" if row[18] is None else str(row[18]),
        waiting_note=str(row[19] or ""),
        run_note=str(row[20] or ""),
        cancel_state=cancel_state(row[6], row[21], row[22], row[20]),
    )


def _result(value: Any) -> Result | None:
    return value if value in RESULTS else None


# Changes


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


def _open(sheet: tuple[Any, ...], version: int) -> None:
    if sheet[1] != "OPEN":
        raise SheetState("the sheet is signed off")
    if int(sheet[2]) != version:
        raise SheetState("the sheet changed")


def _link(
    cursor: psycopg.Cursor[Any],
    principal: Principal,
    project_id: UUID,
    sheet_id: UUID,
    control_id: UUID,
    body: LinkBody,
) -> None:
    known = cursor.execute(
        "SELECT 1 FROM evidence_file_links WHERE evidence_file_id = %s AND project_id = %s "
        "AND engagement_control_id = %s",
        (body.file_id, project_id, control_id),
    ).fetchone()
    if known is None:
        raise SheetState("the file is not evidence for this control")
    reason = clean_line(body.reason, 300) or "Placed by a person."
    if body.action in ("LINK", "UNLINK"):
        if body.item_id is None:
            raise SheetState("choose an item")
        item = cursor.execute(
            "SELECT 1 FROM test_items WHERE id = %s AND test_sheet_id = %s",
            (body.item_id, sheet_id),
        ).fetchone()
        if item is None:
            raise NotVisible()
        if body.action == "LINK":
            cursor.execute(
                "INSERT INTO test_item_files (test_item_id, evidence_file_id) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (body.item_id, body.file_id),
            )
        else:
            cursor.execute(
                "DELETE FROM test_item_files WHERE test_item_id = %s AND evidence_file_id = %s",
                (body.item_id, body.file_id),
            )
        cursor.execute(
            "UPDATE test_items SET needs_test = true, version = version + 1 WHERE id = %s",
            (body.item_id,),
        )
    else:
        # Set aside or brought back: off every item, and its items are tested again.
        for (item_id,) in cursor.execute(
            "DELETE FROM test_item_files t USING test_items i "
            "WHERE i.id = t.test_item_id AND i.test_sheet_id = %s AND t.evidence_file_id = %s "
            "RETURNING t.test_item_id",
            (sheet_id, body.file_id),
        ).fetchall():
            cursor.execute(
                "UPDATE test_items SET needs_test = true, version = version + 1 WHERE id = %s",
                (item_id,),
            )
    placed = cursor.execute(
        "SELECT count(*) FROM test_item_files t JOIN test_items i ON i.id = t.test_item_id "
        "WHERE i.test_sheet_id = %s AND t.evidence_file_id = %s",
        (sheet_id, body.file_id),
    ).fetchone()
    on_items = int(placed[0]) if placed is not None else 0
    if body.action == "INCLUDE":
        # The tester places it again on its next run.
        cursor.execute(
            "DELETE FROM test_sheet_files WHERE test_sheet_id = %s AND evidence_file_id = %s",
            (sheet_id, body.file_id),
        )
        return
    placement = "EXCLUDED" if body.action == "EXCLUDE" else "PLACED" if on_items else "UNPLACED"
    cursor.execute(
        """
        INSERT INTO test_sheet_files (test_sheet_id, evidence_file_id, placement, placed_by,
                                      decided_by, reason)
        VALUES (%s, %s, %s, 'PERSON', %s, %s)
        ON CONFLICT (test_sheet_id, evidence_file_id) DO UPDATE
        SET placement = EXCLUDED.placement, placed_by = 'PERSON',
            decided_by = EXCLUDED.decided_by, reason = EXCLUDED.reason
        """,
        (sheet_id, body.file_id, placement, principal.id, reason),
    )


def _draft(cursor: psycopg.Cursor[Any], project_id: UUID, sheet: SheetBody) -> dict[str, Any]:
    control = cursor.execute(
        "SELECT control_ref, title, activity, risk, key_control FROM engagement_controls "
        "WHERE id = %s AND project_id = %s",
        (sheet.control_id, project_id),
    ).fetchone()
    if control is None:
        raise NotVisible()
    exceptions = [
        (item.label, cell.index, cell.override_reason or cell.note or "Exception.")
        for item in sheet.items
        for cell in item.cells
        if cell.final == "EXCEPTION"
    ]
    return propose_deficiency(
        str(control[0]),
        str(control[1]),
        str(control[2]),
        str(control[3] or ""),
        bool(control[4]),
        tuple(sheet.attributes),
        exceptions,
        len(sheet.items),
    )


def decide_deficiency(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    sheet_id: UUID,
    body: DeficiencyDecision,
) -> SheetBody:
    from ai_workforce_api.workspace import DeficiencyCreate
    from ai_workforce_api.workspace import _create as create_deficiency

    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    sheet = connection.execute(
        "SELECT proposal, proposal_status, version, engagement_control_id FROM test_sheets "
        "WHERE id = %s AND project_id = %s AND organization_id = %s",
        (sheet_id, project_id, organization_id),
    ).fetchone()
    if sheet is None:
        raise NotVisible()
    if sheet[1] != "PROPOSED" or int(sheet[2]) != body.version:
        raise SheetState("the proposed deficiency was already decided")
    if body.action == "DISMISS":
        reason = clean_line(body.reason, 500)
        if len(reason) < 3:
            raise SheetState("a reason is required to dismiss the deficiency")
        with transaction(connection) as cursor:
            moved = cursor.execute(
                """
                UPDATE test_sheets
                SET proposal_status = 'DISMISSED', proposal_reason = %s,
                    proposal_decided_by = %s, version = version + 1
                WHERE id = %s AND proposal_status = 'PROPOSED' AND version = %s
                RETURNING id
                """,
                (reason, principal.id, sheet_id, body.version),
            ).fetchone()
            if moved is None:
                raise SheetState("the proposed deficiency was already decided")
            _audit(
                cursor,
                organization_id,
                project_id,
                principal.id,
                sheet_id,
                "testing.deficiency_dismissed",
                {"reason": reason},
            )
        return _sheet(connection, project_id, sheet_id)
    proposal: dict[str, Any] = dict(sheet[0])
    # One transaction: the sheet is locked, the deficiency logged, and the sheet marked.
    with transaction(connection) as cursor:
        locked = cursor.execute(
            "SELECT 1 FROM test_sheets WHERE id = %s AND proposal_status = 'PROPOSED' "
            "AND version = %s FOR UPDATE",
            (sheet_id, body.version),
        ).fetchone()
        if locked is None:
            raise SheetState("the proposed deficiency was already decided")
        # The person's edits win; the deficiency register checks every field as usual.
        created = create_deficiency(
            connection,
            principal,
            organization_id,
            project_id,
            DeficiencyCreate(
                control_id=sheet[3],
                title=body.title or str(proposal["title"]),
                condition=body.condition
                if body.condition is not None
                else str(proposal["condition"]),
                criteria=body.criteria if body.criteria is not None else str(proposal["criteria"]),
                cause=body.cause if body.cause is not None else str(proposal["cause"]),
                effect=body.effect if body.effect is not None else str(proposal["effect"]),
                deficiency_type="OPERATING",
                severity=body.severity or proposal["severity"],
            ),
            source="TESTING",
        )
        moved = cursor.execute(
            """
            UPDATE test_sheets
            SET proposal_status = 'LOGGED', deficiency_id = %s, proposal_decided_by = %s,
                version = version + 1
            WHERE id = %s AND proposal_status = 'PROPOSED'
            RETURNING id
            """,
            (created.id, principal.id, sheet_id),
        ).fetchone()
        if moved is None:
            raise SheetState("the proposed deficiency was already decided")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            sheet_id,
            "testing.deficiency_logged",
            {"reference": created.reference},
        )
    return _sheet(connection, project_id, sheet_id)


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID,
    sheet_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'test_sheet', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, sheet_id, Json(payload)),
    )


def _results(count: int, one: str, many: str) -> str:
    return f"1 result {one}" if count == 1 else f"{count} results {many}"


def _items(n: int, one: str, many: str) -> str:
    return f"{n} item {one}" if n == 1 else f"{n} items {many}"
