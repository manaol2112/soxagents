"""Test plans and sample selection, and the API a person approves them with.

When a stored file is read as a population for a control's request, the control's
tester proposes a test plan: the population checks and a seeded random selection (see
sampling.py). A person can draw again with a new seed, replace an item with a reason,
and approve. Approval drafts the sample evidence request to the control owner, which
goes out only after the usual approval. Nothing here tests a sample: that is 8.2.
"""

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

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
from ai_workforce_api.evidence_extraction import Table, read_table
from ai_workforce_api.evidence_links import file_request
from ai_workforce_api.evidence_withdrawn import is_withdrawn
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.sampling import build_frame, explanation, new_seed, select
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store
from ai_workforce_api.testing_engine import create_sample_sheet

logger = logging.getLogger(__name__)

SAMPLE_REQUEST_DAYS = 10
SHOWN_COLUMNS = 4
StoreFactory = Callable[[Settings, psycopg.Connection[Any]], ObjectStore]


class TestState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def propose(
    cursor: psycopg.Cursor[Any],
    *,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    file_id: UUID,
    file_name: str,
    sha256: str,
    table: Table,
    period_end: date | None,
    frequency: str,
    nature: str,
    size: int,
    proposer: UUID,
    tester: str,
    seed: int | None = None,
    test_round_id: UUID | None = None,
    window: tuple[date, date] | None = None,
) -> UUID | None:
    """Propose or redraw a test plan. An approved plan is never replaced."""
    frame = build_frame(table, period_end, frequency, window=window)
    chosen_seed = new_seed() if seed is None else seed
    picked = select(frame.rows, size, chosen_seed)
    text = explanation(
        file_name=file_name,
        sha256=sha256,
        table=table,
        frame=frame,
        size=size,
        selected=len(picked),
        seed=chosen_seed,
        frequency=frequency,
        nature=nature,
    )
    if window is not None:
        text = (f"Sampled only from {window[0].isoformat()} to {window[1].isoformat()}. " + text)[
            :2000
        ]
    conflict = (
        "(test_round_id) WHERE test_round_id IS NOT NULL"
        if test_round_id is not None
        else "(project_id, engagement_control_id) WHERE test_round_id IS NULL"
    )
    row = cursor.execute(
        f"""
        INSERT INTO control_tests (
            organization_id, project_id, engagement_control_id, sample_size,
            population_file_id, population_sha256, population_rows, frame_rows, key_column,
            date_column, columns, checks, seed, explanation, proposed_by, test_round_id,
            covered_to
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT {conflict} DO UPDATE
        SET sample_size = EXCLUDED.sample_size,
            population_file_id = EXCLUDED.population_file_id,
            population_sha256 = EXCLUDED.population_sha256,
            population_rows = EXCLUDED.population_rows, frame_rows = EXCLUDED.frame_rows,
            key_column = EXCLUDED.key_column, date_column = EXCLUDED.date_column,
            columns = EXCLUDED.columns, checks = EXCLUDED.checks, seed = EXCLUDED.seed,
            explanation = EXCLUDED.explanation, proposed_by = EXCLUDED.proposed_by,
            covered_to = EXCLUDED.covered_to,
            version = control_tests.version + 1, updated_at = clock_timestamp()
        WHERE control_tests.status = 'PROPOSED'
        RETURNING id
        """,
        (
            organization_id,
            project_id,
            control_id,
            max(1, min(size, 200)),
            file_id,
            sha256,
            len(table.rows),
            len(frame.rows),
            "" if frame.key_column is None else table.columns[frame.key_column],
            "" if frame.date_column is None else table.columns[frame.date_column],
            Json(list(table.columns)),
            Json([check.__dict__ for check in frame.checks]),
            str(chosen_seed),
            text,
            proposer,
            test_round_id,
            frame.covered_to,
        ),
    ).fetchone()
    if row is None:
        return None
    test_id = UUID(str(row[0]))
    cursor.execute("DELETE FROM control_test_samples WHERE control_test_id = %s", (test_id,))
    for position, index in enumerate(picked, start=1):
        values = table.rows[index]
        cursor.execute(
            """
            INSERT INTO control_test_samples (
                control_test_id, position, row_number, key_value, row_values
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                test_id,
                position,
                index + 1,
                "" if frame.key_column is None else values[frame.key_column][:500],
                Json([value[:500] for value in values]),
            ),
        )
    _audit(
        cursor,
        organization_id,
        project_id,
        proposer,
        "control_test.samples_proposed",
        test_id,
        {
            "agent": tester,
            "sample_size": size,
            "selected": len(picked),
            "frame_rows": len(frame.rows),
            "seed": str(chosen_seed),
            "population_sha256": sha256,
        },
    )
    return test_id


def control_for_population(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> tuple[date | None, str, str, int, str] | None:
    """Period end, frequency, nature, sample size, and tester for a control to sample.

    An automated control is tested once from its configuration, so it is not sampled.
    """
    from ai_workforce_api.controls import BUSINESS_TESTER, DOMAIN_AGENTS, sample_size

    row = connection.execute(
        """
        SELECT s.period_end, c.frequency, c.nature, c.domain, c.included
        FROM engagement_controls c JOIN engagement_settings s ON s.project_id = c.project_id
        WHERE c.id = %s AND c.project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None or not row[4] or row[2] == "AUTOMATED":
        return None
    return (
        row[0],
        str(row[1]),
        str(row[2]),
        sample_size(str(row[1]), str(row[2])),
        DOMAIN_AGENTS.get(str(row[3]), BUSINESS_TESTER),
    )


def approved(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> bool:
    row = connection.execute(
        "SELECT status FROM control_tests WHERE project_id = %s AND engagement_control_id = %s "
        "AND test_round_id IS NULL",
        (project_id, control_id),
    ).fetchone()
    return row is not None and row[0] == "APPROVED"


# API


class SampleBody(BaseModel):
    position: int
    row_number: int
    key_value: str
    row_values: list[str]
    selection: str
    reason: str
    replaced_by_name: str | None


class CheckBody(BaseModel):
    check: str
    result: str
    detail: str


class TestBody(BaseModel):
    id: UUID
    engagement_control_id: UUID
    control_ref: str
    control_title: str
    status: str
    sample_size: int
    population_file_id: UUID
    population_file_name: str
    population_sha256: str
    population_rows: int
    frame_rows: int
    key_column: str
    date_column: str
    columns: list[str]
    checks: list[CheckBody]
    seed: str
    explanation: str
    approved_by_name: str | None
    approved_at: datetime | None
    sample_request_id: UUID | None
    sample_request_status: str | None
    samples: list[SampleBody]
    version: int
    # The roll-forward or retest round this plan is for; None for interim testing.
    test_round_id: UUID | None = None
    application_name: str = ""


class ProposeBody(BaseModel):
    evidence_file_id: UUID


class VersionBody(BaseModel):
    version: int = Field(ge=1)


class ReplaceBody(BaseModel):
    version: int = Field(ge=1)
    row_number: int = Field(ge=1)
    selection: Literal["HAPHAZARD", "TARGETED"]
    reason: str = Field(min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def plain(cls, value: str) -> str:
        cleaned = clean_line(value, 500)
        if len(cleaned.strip()) < 3:
            raise ValueError("a reason is required")
        return cleaned


def register_control_tests(
    app: FastAPI, settings: Settings, store: StoreFactory = open_store
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except TestState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except StoreError as error:
            raise HTTPException(status_code=503, detail=error.detail) from None

    @app.get(f"{base}/control-tests")
    def list_tests(organization_id: UUID, project_id: UUID, request: Request) -> list[TestBody]:
        return run(request, lambda c, p: _list(c, p, organization_id, project_id))

    @app.post(f"{base}/control-tests/propose")
    def propose_from_file(
        organization_id: UUID, project_id: UUID, body: ProposeBody, request: Request
    ) -> TestBody:
        return run(
            request,
            lambda c, p: _propose(
                c, p, store(settings, c), organization_id, project_id, body.evidence_file_id
            ),
        )

    @app.post(f"{base}/control-tests/{{test_id}}/samples/{{position}}/replace")
    def replace(
        organization_id: UUID,
        project_id: UUID,
        test_id: UUID,
        position: int,
        body: ReplaceBody,
        request: Request,
    ) -> TestBody:
        return run(
            request,
            lambda c, p: _replace(
                c, p, store(settings, c), organization_id, project_id, test_id, position, body
            ),
        )

    @app.post(f"{base}/control-tests/{{test_id}}/approve")
    def approve(
        organization_id: UUID,
        project_id: UUID,
        test_id: UUID,
        body: VersionBody,
        request: Request,
    ) -> TestBody:
        return run(request, lambda c, p: _approve(c, p, organization_id, project_id, test_id, body))


def _person(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_UPDATE,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _round_kind(connection: psycopg.Connection[Any], round_id: UUID | None) -> str | None:
    """ROLLFORWARD or RETEST for a round's plan; None for interim testing."""
    if round_id is None:
        return None
    row = connection.execute("SELECT kind FROM test_rounds WHERE id = %s", (round_id,)).fetchone()
    return None if row is None else str(row[0])


def _population(
    connection: psycopg.Connection[Any], store: ObjectStore, project_id: UUID, file_id: UUID
) -> tuple[Table, str, str]:
    """The stored population, read through the custody check."""
    row = connection.execute(
        """
        SELECT object_key, content_sha256, size_bytes, content_type, file_name
        FROM evidence_files WHERE id = %s AND project_id = %s
        """,
        (file_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if is_withdrawn(connection, file_id):
        raise TestState("the population file is withdrawn")
    content = store.get(str(row[0]))
    if digest_of(content) != row[1] or len(content) != int(row[2]):
        raise TestState("the stored population no longer matches its custody record")
    table = read_table(content, str(row[4]), str(row[3]))
    if table is None or not table.rows:
        raise TestState("the file is not a population table")
    return table, str(row[4]), str(row[1])


def _propose(
    connection: psycopg.Connection[Any],
    principal: Principal,
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
) -> TestBody:
    _person(connection, principal, organization_id, project_id)
    table, name, sha256 = _population(connection, store, project_id, file_id)
    request = file_request(connection, project_id, file_id)
    if request is None or request[3] is None:
        raise TestState("the file is not linked to a control's request")
    control = control_for_population(connection, project_id, request[3])
    if control is None:
        raise TestState("this control is not sampled")
    period_end, frequency, nature, size, tester = control
    from ai_workforce_api.test_rounds import round_for_request

    found = round_for_request(connection, request[0])
    window = None if found is None else (found.window_start, found.window_end)
    if found is not None:
        size = found.sample_size
    with transaction(connection) as cursor:
        test_id = propose(
            cursor,
            organization_id=organization_id,
            project_id=project_id,
            control_id=request[3],
            file_id=file_id,
            file_name=name,
            sha256=sha256,
            table=table,
            period_end=period_end,
            frequency=frequency,
            nature=nature,
            size=size,
            proposer=principal.id,
            tester=tester,
            test_round_id=None if found is None else found.id,
            window=window,
        )
    if test_id is None:
        raise TestState("the samples are already approved")
    return _one(connection, organization_id, project_id, test_id)


def _replace(
    connection: psycopg.Connection[Any],
    principal: Principal,
    store: ObjectStore,
    organization_id: UUID,
    project_id: UUID,
    test_id: UUID,
    position: int,
    body: ReplaceBody,
) -> TestBody:
    _person(connection, principal, organization_id, project_id)
    current = _one(connection, organization_id, project_id, test_id)
    if current.version != body.version:
        raise TestState("test plan changed")
    if current.status != "PROPOSED":
        raise TestState("the samples are already approved")
    if not any(sample.position == position for sample in current.samples):
        raise NotVisible()
    table, _name, sha256 = _population(connection, store, project_id, current.population_file_id)
    if sha256 != current.population_sha256:
        raise TestState("the population changed")
    if body.row_number > len(table.rows):
        raise TestState("that row is not in the population")
    if any(sample.row_number == body.row_number for sample in current.samples):
        raise TestState("that row is already selected")
    values = table.rows[body.row_number - 1]
    key_index = (
        table.columns.index(current.key_column) if current.key_column in table.columns else None
    )
    with transaction(connection) as cursor:
        locked = cursor.execute(
            "SELECT version FROM control_tests WHERE id = %s AND status = 'PROPOSED' FOR UPDATE",
            (test_id,),
        ).fetchone()
        if locked is None or int(locked[0]) != body.version:
            raise TestState("test plan changed")
        cursor.execute(
            """
            UPDATE control_test_samples
            SET row_number = %s, key_value = %s, row_values = %s, selection = %s,
                reason = %s, replaced_by = %s
            WHERE control_test_id = %s AND position = %s
            """,
            (
                body.row_number,
                "" if key_index is None else values[key_index][:500],
                Json([value[:500] for value in values]),
                body.selection,
                body.reason,
                principal.id,
                test_id,
                position,
            ),
        )
        cursor.execute(
            "UPDATE control_tests SET version = version + 1, updated_at = clock_timestamp() "
            "WHERE id = %s",
            (test_id,),
        )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "control_test.sample_replaced",
            test_id,
            {"position": position, "row_number": body.row_number, "selection": body.selection},
        )
    return _one(connection, organization_id, project_id, test_id)


def _approve(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    test_id: UUID,
    body: VersionBody,
) -> TestBody:
    _person(connection, principal, organization_id, project_id)
    current = _one(connection, organization_id, project_id, test_id)
    if current.version != body.version:
        raise TestState("test plan changed")
    if current.status != "PROPOSED":
        raise TestState("the samples are already approved")
    if not current.samples:
        raise TestState("there are no samples to approve")
    # Testing starts only when the control is ready (readiness.py): its criteria defined,
    # its process understood where it depends on one, and no conflict between sources
    # left open. A narrative is one source of understanding, never a requirement.
    from ai_workforce_api.readiness import NotReady, require_testable

    try:
        require_testable(connection, project_id, current.engagement_control_id)
    except NotReady as error:
        raise TestState(error.detail) from None
    if current.test_round_id is not None:
        # A round has prerequisites of its own: remediation before retesting, the
        # round's evidence received, the fixed control operated long enough (W4).
        from ai_workforce_api.round_readiness import RoundNotReady, require_round_testable

        try:
            require_round_testable(connection, project_id, current.test_round_id)
        except RoundNotReady as error:
            raise TestState(error.detail) from None
    if is_withdrawn(connection, current.population_file_id):
        raise TestState("the population file is withdrawn; propose samples from its replacement")
    # Samples come only from a population a person accepted as complete and accurate on
    # the control's evidence plan: a file arriving does not validate it.
    from ai_workforce_api.evidence_plans import on_samples_approved, population_gate

    round_kind = _round_kind(connection, current.test_round_id)
    blocked = population_gate(connection, current.engagement_control_id, round_kind)
    if blocked is not None:
        raise TestState(blocked)
    population_request = file_request(connection, project_id, current.population_file_id)
    with transaction(connection) as cursor:
        locked = cursor.execute(
            "SELECT version FROM control_tests WHERE id = %s AND status = 'PROPOSED' FOR UPDATE",
            (test_id,),
        ).fetchone()
        if locked is None or int(locked[0]) != body.version:
            raise TestState("test plan changed")
        request_id = _draft_sample_request(
            cursor, organization_id, project_id, current, population_request, principal.id,
            round_kind,
        )  # fmt: skip
        cursor.execute(
            """
            UPDATE control_tests
            SET status = 'APPROVED', approved_by = %s, approved_at = clock_timestamp(),
                sample_request_id = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (principal.id, request_id, test_id),
        )
        if request_id is not None:
            # The sample request serves its phase and carries the plan's sample evidence.
            on_samples_approved(
                cursor, current.engagement_control_id, project_id, round_kind, request_id
            )
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "control_test.samples_approved",
            test_id,
            {"samples": len(current.samples), "sample_request_drafted": request_id is not None},
        )
        # The tester opens the test sheet: one item per approved sample.
        create_sample_sheet(cursor, organization_id, project_id, test_id, principal.id)
        if current.test_round_id is not None:
            from ai_workforce_api.test_rounds import mark_testing

            mark_testing(cursor, current.test_round_id)
    return _one(connection, organization_id, project_id, test_id)


def _draft_sample_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    test: TestBody,
    population_request: tuple[UUID, str, str, UUID | None] | None,
    approver: UUID,
    round_kind: str | None = None,
) -> UUID | None:
    """The sample evidence request, as a draft that needs the usual approval to send."""
    if population_request is None:
        return None
    from ai_workforce_api.evidence_plans import sample_asks

    original = cursor.execute(
        "SELECT owner_user_id, recipient, follow_up_after_days, max_follow_ups "
        "FROM pbc_requests WHERE id = %s",
        (population_request[0],),
    ).fetchone()
    control = cursor.execute(
        "SELECT pbc_items FROM engagement_controls WHERE id = %s", (test.engagement_control_id,)
    ).fetchone()
    if original is None or control is None:
        return None
    items = [str(item) for item in control[0]]
    # What the evidence plan asks for each selected item, or the RCM's own words.
    ask = sample_asks(cursor, test.engagement_control_id, round_kind) or (
        items[1]
        if len(items) > 1
        else "the evidence that the control operated for each item, such as the approval "
        "and its date"
    )
    description = sample_request_text(test, ask)
    row = cursor.execute(
        """
        INSERT INTO pbc_requests (
            organization_id, project_id, operation_key, control_ref, owner_user_id,
            recipient, due_at, evidence_description, follow_up_after_days, max_follow_ups,
            engagement_control_id, drafted_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'AGENT')
        ON CONFLICT (project_id, operation_key) DO NOTHING
        RETURNING id
        """,
        (
            organization_id,
            project_id,
            f"samples-{test.id.hex}",
            population_request[1],
            original[0],
            original[1],
            datetime.now(UTC) + timedelta(days=SAMPLE_REQUEST_DAYS),
            description,
            original[2],
            original[3],
            test.engagement_control_id,
        ),
    ).fetchone()
    if row is None:
        return None
    _audit(
        cursor,
        organization_id,
        project_id,
        approver,
        "pbc.sample_request_drafted",
        UUID(str(row[0])),
        {"samples": len(test.samples), "status": "DRAFT"},
        target_type="pbc_request",
    )
    return UUID(str(row[0]))


def sample_request_text(test: TestBody, ask: str) -> str:
    """One line per selected item, with its key and the first few columns."""
    shown = [
        index for index, column in enumerate(test.columns) if column and column != test.key_column
    ][:SHOWN_COLUMNS]
    lines = [
        f"Sample evidence for {test.control_ref}: {test.control_title}",
        "",
        f"We selected {len(test.samples)} item{'s' if len(test.samples) != 1 else ''} from "
        f"the population you provided ({test.population_file_name}). For each item below, "
        f"please provide: {ask.rstrip('.')}.",
        "",
    ]
    for sample in test.samples:
        details = ", ".join(
            f"{test.columns[index]}: {sample.row_values[index]}"
            for index in shown
            if index < len(sample.row_values) and sample.row_values[index]
        )
        label = sample.key_value or f"Row {sample.row_number}"
        lines.append(f"{sample.position}. {label}" + (f" ({details})" if details else ""))
    lines += ["", "Please label each file with the item it supports. Thank you."]
    text = "\n".join(lines)
    return text if len(text) <= 4000 else text[:3950].rsplit("\n", 1)[0] + "\n(list continues)"


_COLUMNS = """
    t.id, t.engagement_control_id, c.control_ref, c.title, t.status, t.sample_size,
    t.population_file_id, f.file_name, t.population_sha256, t.population_rows, t.frame_rows,
    t.key_column, t.date_column, t.columns, t.checks, t.seed, t.explanation, a.display_name,
    t.approved_at, t.sample_request_id, r.status, t.version, t.test_round_id,
    (SELECT a.name FROM engagement_applications a WHERE a.id = c.engagement_application_id)
"""
_FROM = """
    FROM control_tests t
    JOIN engagement_controls c ON c.id = t.engagement_control_id
    JOIN evidence_files f ON f.id = t.population_file_id
    LEFT JOIN users a ON a.id = t.approved_by
    LEFT JOIN pbc_requests r ON r.id = t.sample_request_id
"""


def _samples(
    connection: psycopg.Connection[Any], test_ids: list[UUID]
) -> dict[UUID, list[SampleBody]]:
    found: dict[UUID, list[SampleBody]] = {test_id: [] for test_id in test_ids}
    if not test_ids:
        return found
    rows = connection.execute(
        """
        SELECT s.control_test_id, s.position, s.row_number, s.key_value, s.row_values,
               s.selection, s.reason, u.display_name
        FROM control_test_samples s LEFT JOIN users u ON u.id = s.replaced_by
        WHERE s.control_test_id = ANY(%s)
        ORDER BY s.control_test_id, s.position
        """,
        (test_ids,),
    ).fetchall()
    for row in rows:
        found[row[0]].append(
            SampleBody(
                position=int(row[1]),
                row_number=int(row[2]),
                key_value=str(row[3]),
                row_values=[str(value) for value in row[4]],
                selection=str(row[5]),
                reason=str(row[6]),
                replaced_by_name=None if row[7] is None else str(row[7]),
            )
        )
    return found


def _bodies(connection: psycopg.Connection[Any], rows: list[tuple[Any, ...]]) -> list[TestBody]:
    samples = _samples(connection, [row[0] for row in rows])
    return [
        TestBody(
            id=row[0],
            engagement_control_id=row[1],
            control_ref=str(row[2]),
            control_title=str(row[3]),
            status=str(row[4]),
            sample_size=int(row[5]),
            population_file_id=row[6],
            population_file_name=str(row[7]),
            population_sha256=str(row[8]),
            population_rows=int(row[9]),
            frame_rows=int(row[10]),
            key_column=str(row[11]),
            date_column=str(row[12]),
            columns=[str(item) for item in row[13]],
            checks=[CheckBody.model_validate(item) for item in row[14]],
            seed=str(row[15]),
            explanation=str(row[16]),
            approved_by_name=None if row[17] is None else str(row[17]),
            approved_at=row[18],
            sample_request_id=row[19],
            sample_request_status=None if row[20] is None else str(row[20]),
            samples=samples[row[0]],
            version=int(row[21]),
            test_round_id=row[22],
            application_name="" if row[23] is None else str(row[23]),
        )
        for row in rows
    ]


def _list(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[TestBody]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    rows = connection.execute(
        f"SELECT {_COLUMNS} {_FROM} WHERE t.organization_id = %s AND t.project_id = %s "
        "ORDER BY c.control_ref",
        (organization_id, project_id),
    ).fetchall()
    return _bodies(connection, rows)


def _one(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, test_id: UUID
) -> TestBody:
    rows = connection.execute(
        f"SELECT {_COLUMNS} {_FROM} "
        "WHERE t.id = %s AND t.organization_id = %s AND t.project_id = %s",
        (test_id, organization_id, project_id),
    ).fetchall()
    if not rows:
        raise NotVisible()
    return _bodies(connection, rows)[0]


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target: UUID,
    payload: dict[str, Any],
    target_type: str = "control_test",
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor, action, target_type, target, Json(payload)),
    )
