"""Client RCM uploads: upload, map, preview, and import as the engagement's RCM.

An upload is parsed once to cell text and kept as an import record while a person
maps it. Nothing becomes a control until that person imports it, and importing
replaces the engagement's controls in one transaction, before kickoff only.
The file itself is not stored: only its hash, size, and parsed cells are kept.
"""

import hashlib
import logging
import re
from collections.abc import Callable
from datetime import datetime
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
    _session_principal,
    authorize,
)
from ai_workforce_api.controls import DOMAIN_AGENTS, runs_on_a_system
from ai_workforce_api.db import transaction
from ai_workforce_api.model_providers import live_model
from ai_workforce_api.onboarding import (
    OnboardingBody,
    OnboardingState,
    _applications,
    _audit,
    _authorize_setup,
    _reset_templates,
    _run,
    _snapshot,
    authorize_controls_setup,
    pending_reviews,
)
from ai_workforce_api.rcm_import import (
    FIELDS,
    MAX_BYTES,
    REQUIRED,
    VALUE_FIELDS,
    BuildResult,
    RcmFileError,
    Sheet,
    best_sheet,
    build,
    check_fields,
    check_values,
    column_values,
    data_rows,
    detect_header,
    headers,
    normalize,
    parse_file,
    suggest_fields,
    value_choices,
    value_key,
)
from ai_workforce_api.rcm_systems import (
    SystemProposal,
    SystemScanScheduler,
    assigned_systems,
    basis,
)
from ai_workforce_api.rcm_terms import reset_terms
from ai_workforce_api.scope_changes import reconcile_scope
from ai_workforce_api.settings import Settings
from ai_workforce_api.system_review_queue import (
    schedule_system_reviews,
    track_reviews_for_project,
)
from ai_workforce_api.workpapers import default_template

logger = logging.getLogger(__name__)
_UNSAFE = re.compile(r"(?i)\b(?:https?://|www\.)|[<>]")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
MAX_NEW_APPLICATIONS = 60


# Bodies


class SheetSummary(BaseModel):
    index: int
    name: str
    rows: int


class ImportColumn(BaseModel):
    index: int
    header: str
    samples: list[str]
    field: str
    suggested: str


class FieldOption(BaseModel):
    key: str
    label: str
    required: bool


class ValueOption(BaseModel):
    value: str
    count: int
    mapped: str | None
    suggested: str | None
    reason: str = ""
    mapped_by: str | None = None
    # The agent's different answer for a term it was not allowed to change.
    alternative: str | None = None
    alternative_reason: str = ""


class TermsBody(BaseModel):
    """Where the term mapping stands: the agent's last run and whether a model is on."""

    status: str
    mode: str
    source: str | None
    note: str
    model_available: bool


class ControlPreview(BaseModel):
    row: int
    control_ref: str
    title: str
    domain: str
    domain_label: str
    frequency: str
    frequency_label: str
    nature: str
    nature_label: str
    key_control: bool
    owner_name: str
    owner_email: str
    applications: list[str]
    attributes: int
    custom_fields: int


class SkippedRow(BaseModel):
    row: int
    reason: str


class ImportPreview(BaseModel):
    importable: int
    skipped: list[SkippedRow]
    skipped_count: int
    warnings: list[str]
    problems: list[str]
    controls: list[ControlPreview]
    new_applications: list[str]


class SystemView(SystemProposal):
    controls: int


class SystemsBody(BaseModel):
    """The in-scope systems the agent found, for a person to confirm before import."""

    status: str
    source: str | None
    note: str
    version: int
    proposals: list[SystemView]


class SystemChoice(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,80}$")
    name: str = Field(min_length=1, max_length=120)
    layer: Literal["APPLICATION", "DATABASE", "OPERATING_SYSTEM", "INFRASTRUCTURE", "TOOL"]
    included: bool


class SystemsUpdate(BaseModel):
    systems_version: int = Field(ge=1)
    choices: list[SystemChoice] = Field(max_length=100)


class ImportBody(BaseModel):
    id: UUID
    status: str
    file_name: str
    file_kind: str
    size_bytes: int
    created_at: datetime
    uploaded_by: str
    version: int
    sheets: list[SheetSummary]
    sheet_index: int
    header_row: int
    data_rows: int
    columns: list[ImportColumn]
    fields: list[FieldOption]
    values: dict[str, list[ValueOption]]
    preview: ImportPreview
    systems: SystemsBody
    terms: TermsBody
    ready: bool
    replaces: int


class LayoutUpdate(BaseModel):
    version: int = Field(ge=1)
    sheet_index: int = Field(ge=0, le=50)
    header_row: int = Field(ge=1, le=100)


class ValueMapping(BaseModel):
    field: Literal["domain", "frequency", "nature"]
    value: str = Field(max_length=120)
    mapped: str = Field(max_length=40)


class MappingUpdate(BaseModel):
    version: int = Field(ge=1)
    column_fields: list[str] = Field(max_length=80)
    values: list[ValueMapping] = Field(max_length=600)


class ImportConfirm(BaseModel):
    version: int = Field(ge=1)
    # REPLACE: the engagement's controls become this sheet's. ADD: this sheet joins the
    # controls already imported (a control with the same ID is replaced by its new row).
    mode: Literal["REPLACE", "ADD"] = "REPLACE"


class OwnerEmail(BaseModel):
    owner_name: str = Field(min_length=1, max_length=200)
    owner_email: str = Field(max_length=200)


class OwnerEmails(BaseModel):
    entries: list[OwnerEmail] = Field(min_length=1, max_length=200)


def register_rcm_uploads(
    app: FastAPI, settings: Settings, scans: SystemScanScheduler | None = None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding"

    live = live_model(settings)

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            result = _run(settings, lambda connection: work(connection, principal))
        except RcmFileError as error:
            raise HTTPException(status_code=422, detail=error.detail) from None
        if isinstance(result, ImportBody):
            result.terms.model_available = live
        return result

    @app.post(f"{base}/rcm/uploads")
    async def upload(
        organization_id: UUID, project_id: UUID, file_name: str, request: Request
    ) -> ImportBody:
        content = await request.body()
        if len(content) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="file is too large")
        body = run(
            request,
            lambda c, p: _upload(c, p, organization_id, project_id, file_name, content),
        )
        _scan(scans, body)
        return body

    @app.get(f"{base}/rcm/uploads/{{import_id}}")
    def read(
        organization_id: UUID, project_id: UUID, import_id: UUID, request: Request
    ) -> ImportBody:
        return run(request, lambda c, p: _read(c, p, organization_id, project_id, import_id))

    @app.patch(f"{base}/rcm/uploads/{{import_id}}/layout")
    def layout(
        organization_id: UUID,
        project_id: UUID,
        import_id: UUID,
        body: LayoutUpdate,
        request: Request,
    ) -> ImportBody:
        updated = run(
            request,
            lambda c, p: _layout(c, p, organization_id, project_id, import_id, body),
        )
        _scan(scans, updated)
        return updated

    @app.patch(f"{base}/rcm/uploads/{{import_id}}/mapping")
    def mapping(
        organization_id: UUID,
        project_id: UUID,
        import_id: UUID,
        body: MappingUpdate,
        request: Request,
    ) -> ImportBody:
        updated = run(
            request,
            lambda c, p: _mapping(c, p, organization_id, project_id, import_id, body),
        )
        _scan(scans, updated)
        return updated

    @app.patch(f"{base}/rcm/uploads/{{import_id}}/systems")
    def systems(
        organization_id: UUID,
        project_id: UUID,
        import_id: UUID,
        body: SystemsUpdate,
        request: Request,
    ) -> ImportBody:
        return run(
            request,
            lambda c, p: _systems(c, p, organization_id, project_id, import_id, body),
        )

    @app.post(f"{base}/rcm/uploads/{{import_id}}/terms/remap")
    def remap(
        organization_id: UUID, project_id: UUID, import_id: UUID, request: Request
    ) -> ImportBody:
        updated = run(request, lambda c, p: _remap(c, p, organization_id, project_id, import_id))
        _scan(scans, updated)
        return updated

    @app.post(f"{base}/rcm/uploads/{{import_id}}/systems/rescan")
    def rescan(
        organization_id: UUID, project_id: UUID, import_id: UUID, request: Request
    ) -> ImportBody:
        updated = run(request, lambda c, p: _rescan(c, p, organization_id, project_id, import_id))
        _scan(scans, updated)
        return updated

    @app.post(f"{base}/rcm/uploads/{{import_id}}/import")
    def import_controls(
        organization_id: UUID,
        project_id: UUID,
        import_id: UUID,
        body: ImportConfirm,
        request: Request,
    ) -> OnboardingBody:
        result = run(
            request,
            lambda c, p: _import(c, p, organization_id, project_id, import_id, body),
        )
        schedule_system_reviews(scans, pending_reviews(result))
        return result

    @app.post(f"{base}/rcm/uploads/{{import_id}}/discard")
    def discard(
        organization_id: UUID, project_id: UUID, import_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(request, lambda c, p: _discard(c, p, organization_id, project_id, import_id))

    @app.post(f"{base}/controls/owner-emails")
    def owner_emails(
        organization_id: UUID, project_id: UUID, body: OwnerEmails, request: Request
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: _owner_emails(c, p, organization_id, project_id, body),
        )


# Stored import


class _Stored:
    def __init__(self, row: tuple[Any, ...]) -> None:
        self.id: UUID = row[0]
        self.status = str(row[1])
        self.file_name = str(row[2])
        self.file_kind = str(row[3])
        self.size_bytes = int(row[4])
        self.sheets = [Sheet(name=str(item["name"]), rows=item["rows"]) for item in row[5]]
        self.sheet_index = int(row[6])
        self.header_row = int(row[7])
        self.column_fields = [str(item) for item in row[8]]
        self.value_maps: dict[str, dict[str, str]] = {
            str(key): {str(k): str(v) for k, v in value.items()} for key, value in row[9].items()
        }
        self.created_at: datetime = row[10]
        self.version = int(row[11])
        self.systems = [SystemProposal.model_validate(item) for item in row[12]]
        self.systems_status = str(row[13])
        self.systems_source = None if row[14] is None else str(row[14])
        self.systems_note = str(row[15])
        self.systems_basis = str(row[16])
        self.systems_version = int(row[17])
        self.uploaded_by = "" if row[18] is None else str(row[18])
        self.terms_status = str(row[19])
        self.terms_mode = str(row[20])
        self.terms_source = None if row[21] is None else str(row[21])
        self.terms_note = str(row[22])
        self.term_reasons: dict[str, Any] = row[23] if isinstance(row[23], dict) else {}

    @property
    def rows(self) -> list[list[str]]:
        return self.sheets[self.sheet_index].rows if self.sheets else []


def _load(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any],
    project_id: UUID,
    import_id: UUID,
    *,
    lock: bool = False,
) -> _Stored:
    row = connection.execute(
        """
        SELECT id, status, file_name, file_kind, size_bytes, sheets, sheet_index, header_row,
               column_fields, value_maps, created_at, version, systems, systems_status,
               systems_source, systems_note, systems_basis, systems_version,
               (SELECT display_name FROM users WHERE id = created_by_user_id),
               terms_status, terms_mode, terms_source, terms_note, term_reasons
        FROM rcm_imports WHERE id = %s AND project_id = %s
        """
        + (" FOR UPDATE" if lock else ""),
        (import_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return _Stored(row)


def _remembered(
    connection: psycopg.Connection[Any], project_id: UUID
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """Mappings people confirmed on this engagement's earlier imports, newest first.

    Only this engagement's own uploads count. Headings and client terms are client
    data, so one engagement's RCM never shapes another engagement's suggestions.
    """
    rows = connection.execute(
        """
        SELECT header_names, column_fields, value_maps FROM rcm_imports
        WHERE project_id = %s AND status = 'IMPORTED'
        ORDER BY imported_at DESC LIMIT 5
        """,
        (project_id,),
    ).fetchall()
    columns: dict[str, str] = {}
    values: dict[str, dict[str, str]] = {key: {} for key in VALUE_FIELDS}
    for names, fields, maps in rows:
        for name, choice in zip(names, fields, strict=False):
            columns.setdefault(normalize(str(name)), str(choice))
        for key, mapping in maps.items():
            if key in values:
                for raw, chosen in mapping.items():
                    values[key].setdefault(str(raw), str(chosen))
    return columns, values


def _suggested_values(
    rows: list[list[str]],
    header_row: int,
    column_fields: list[str],
    remembered: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    maps: dict[str, dict[str, str]] = {}
    for key, items in value_choices(rows, header_row, column_fields).items():
        maps[key] = {}
        for item in items:
            chosen = remembered.get(key, {}).get(value_key(item.value)) or item.suggested
            if chosen is not None:
                maps[key][value_key(item.value)] = chosen
    return maps


# Actions


def _upload(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_name: str,
    content: bytes,
) -> ImportBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    # The name is a label only: no path, nothing that could be read as one.
    label = re.split(r"[\\/]", file_name)[-1].strip()[:200]
    label = re.sub(r"[\x00-\x1f\x7f]", "", label)
    if label == "":
        raise ValueError("file name is required")
    kind, sheets = parse_file(label, content)
    index = best_sheet(sheets)
    header_row = detect_header(sheets[index].rows)
    names = headers(sheets[index].rows, header_row)
    remembered_columns, remembered_values = _remembered(connection, project_id)
    fields = suggest_fields(
        names, remembered_columns, column_values(sheets[index].rows, header_row)
    )
    values = _suggested_values(sheets[index].rows, header_row, fields, remembered_values)
    with transaction(connection) as cursor:
        cursor.execute(
            """
            UPDATE rcm_imports SET status = 'DISCARDED', version = version + 1
            WHERE project_id = %s AND status = 'MAPPING'
            """,
            (project_id,),
        )
        row = cursor.execute(
            """
            INSERT INTO rcm_imports (
                organization_id, project_id, file_name, file_kind, file_sha256, size_bytes,
                sheets, sheet_index, header_row, header_names, column_fields, value_maps,
                created_by_user_id, systems_basis
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                label,
                kind,
                hashlib.sha256(content).hexdigest(),
                len(content),
                Json([{"name": sheet.name, "rows": sheet.rows} for sheet in sheets]),
                index,
                header_row,
                Json(names),
                Json(fields),
                Json(values),
                principal.id,
                basis(index, header_row, fields),
            ),
        ).fetchone()
        if row is None:
            raise NotVisible()
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.rcm_uploaded",
            {"kind": kind, "sheets": len(sheets), "size_bytes": len(content)},
        )
    return _body(connection, project_id, _load(connection, project_id, row[0]))


def _read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
) -> ImportBody:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _layout(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
    body: LayoutUpdate,
) -> ImportBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    remembered_columns, remembered_values = _remembered(connection, project_id)
    with transaction(connection) as cursor:
        stored = _open(cursor, project_id, import_id, body.version)
        if body.sheet_index >= len(stored.sheets):
            raise ValueError("sheet is unknown")
        rows = stored.sheets[body.sheet_index].rows
        if body.header_row > max(len(rows), 1):
            raise ValueError("header row is outside the sheet")
        names = headers(rows, body.header_row)
        fields = suggest_fields(names, remembered_columns, column_values(rows, body.header_row))
        values = _suggested_values(rows, body.header_row, fields, remembered_values)
        cursor.execute(
            """
            UPDATE rcm_imports
            SET sheet_index = %s, header_row = %s, header_names = %s, column_fields = %s,
                value_maps = %s, version = version + 1
            WHERE id = %s
            """,
            (body.sheet_index, body.header_row, Json(names), Json(fields), Json(values), import_id),
        )
        _reset_systems(cursor, import_id, basis(body.sheet_index, body.header_row, fields))
        reset_terms(cursor, import_id, "FILL")
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _mapping(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
    body: MappingUpdate,
) -> ImportBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        stored = _open(cursor, project_id, import_id, body.version)
        names = headers(stored.rows, stored.header_row)
        check_fields(body.column_fields, len(names))
        maps: dict[str, dict[str, str]] = {key: {} for key in VALUE_FIELDS}
        for item in body.values:
            if item.mapped != "":
                maps[item.field][value_key(item.value)] = item.mapped
        check_values(maps)
        cursor.execute(
            """
            UPDATE rcm_imports
            SET header_names = %s, column_fields = %s, value_maps = %s, version = version + 1
            WHERE id = %s
            """,
            (Json(names), Json(body.column_fields), Json(maps), import_id),
        )
        mapped = basis(stored.sheet_index, stored.header_row, body.column_fields)
        if mapped != stored.systems_basis:
            _reset_systems(cursor, import_id, mapped)
            reset_terms(cursor, import_id, "FILL")
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _import(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
    body: ImportConfirm,
) -> OnboardingBody:
    """Import the mapped rows, all at once or not at all: replacing the engagement's
    controls, or adding to the ones an earlier sheet imported."""
    authorize_controls_setup(connection, principal, organization_id, project_id)
    existing = {app.name.lower(): app.id for app in _applications(connection, project_id)}
    with transaction(connection) as cursor:
        stored = _open(cursor, project_id, import_id, body.version)
        result = build(stored.rows, stored.header_row, stored.column_fields, stored.value_maps)
        if result.problems or not result.controls:
            raise OnboardingState("mapping is incomplete")
        confirmed = _confirmed(stored)
        new_names = _new_names(result, existing, confirmed)
        if len(new_names) > MAX_NEW_APPLICATIONS:
            raise OnboardingState("too many applications")
        layers = {system.name.lower(): system.layer for system in confirmed or []}
        for name in new_names:
            created = cursor.execute(
                """
                INSERT INTO engagement_applications (
                    organization_id, project_id, name, description, layer
                )
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """,
                (
                    organization_id,
                    project_id,
                    name,
                    "Identified from the client RCM." if confirmed is not None else "",
                    layers.get(name.lower(), "APPLICATION"),
                ),
            ).fetchone()
            if created is not None:
                existing[name.lower()] = created[0]
        every_app = list(dict.fromkeys(existing.values()))
        if body.mode == "ADD":
            # Library controls still give way to the upload; same control IDs are replaced.
            cursor.execute(
                """
                DELETE FROM engagement_controls
                WHERE project_id = %s AND (source <> 'UPLOAD' OR upper(control_ref) = ANY(%s))
                """,
                (project_id, [control.control_ref.upper() for control in result.controls]),
            )
        else:
            cursor.execute("DELETE FROM engagement_controls WHERE project_id = %s", (project_id,))
        for control in result.controls:
            apps = [
                existing[name.lower()]
                for name in _control_systems(control.control_ref, control.applications, confirmed)
                if name.lower() in existing
            ]
            # One instance per system the control relies on (Milestone 8.5); a control
            # that names none covers every in-scope system. A business process control
            # belongs to its process: one row, no system.
            targets: list[UUID | None] = (
                list(dict.fromkeys(apps)) or list(every_app) or [None]
                if runs_on_a_system(control.domain)
                else [None]
            )
            for app in targets:
                cursor.execute(
                    """
                    INSERT INTO engagement_controls (
                        organization_id, project_id, library_key, library_version,
                        control_ref, domain, title, risk, activity, frequency, nature,
                        key_control, owner_name, owner_email, application_ids,
                        test_attributes, pbc_items, template_key, agent_key, source,
                        rcm_import_id, source_row, domain_label, frequency_label,
                        nature_label, custom_fields, engagement_application_id
                    )
                    VALUES (
                        %s, %s, %s, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, 'UPLOAD', %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        organization_id,
                        project_id,
                        f"upload:{import_id.hex[:12]}:{control.row}",
                        control.control_ref,
                        control.domain,
                        control.title,
                        control.risk,
                        control.activity,
                        control.frequency,
                        control.nature,
                        control.key_control,
                        control.owner_name,
                        control.owner_email,
                        [] if app is None else [app],
                        Json(control.test_attributes),
                        Json(control.pbc_items),
                        default_template(control.domain),
                        DOMAIN_AGENTS[control.domain],
                        import_id,
                        control.row,
                        control.domain_label,
                        control.frequency_label,
                        control.nature_label,
                        Json(
                            [
                                {"label": label, "value": value}
                                for label, value in control.custom_fields
                            ]
                        ),
                        app,
                    ),
                )
        cursor.execute(
            """
            UPDATE rcm_imports
            SET status = 'IMPORTED', imported_by_user_id = %s, imported_at = clock_timestamp(),
                imported_controls = %s, version = version + 1
            WHERE id = %s
            """,
            (principal.id, len(result.controls), import_id),
        )
        _reset_templates(cursor, project_id)
        # Every system, new or not, is scoped again against the imported controls.
        track_reviews_for_project(cursor, organization_id, project_id, principal.id)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.rcm_imported",
            {
                "controls": len(result.controls),
                "mode": body.mode,
                "skipped_rows": len(result.skipped),
                "new_applications": len(new_names),
                "systems_source": stored.systems_source if confirmed is not None else None,
            },
        )
    # After launch, each control imported gets its work, as any control added then does.
    reconcile_scope(connection, organization_id, project_id, principal.id)
    return _snapshot(connection, organization_id, project_id)


def _discard(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
) -> OnboardingBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        done = cursor.execute(
            """
            UPDATE rcm_imports SET status = 'DISCARDED', version = version + 1
            WHERE id = %s AND project_id = %s AND status = 'MAPPING'
            RETURNING id
            """,
            (import_id, project_id),
        ).fetchone()
        if done is None:
            raise NotVisible()
    return _snapshot(connection, organization_id, project_id)


def _owner_emails(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: OwnerEmails,
) -> OnboardingBody:
    """Client RCMs name owners without emails. Fill the email once per owner name."""
    # Owners are filled on the controls themselves, which stay editable after launch.
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    entries = [
        (" ".join(item.owner_name.split()), item.owner_email.strip().lower())
        for item in body.entries
        if item.owner_email.strip() != ""
    ]
    if any(_EMAIL.fullmatch(email) is None for _name, email in entries):
        raise ValueError("owner email is invalid")
    updated = 0
    with transaction(connection) as cursor:
        for name, email in entries:
            cursor.execute(
                """
                UPDATE engagement_controls
                SET owner_email = %s, version = version + 1, updated_at = clock_timestamp()
                WHERE project_id = %s AND lower(owner_name) = lower(%s) AND owner_email = ''
                """,
                (email, project_id, name),
            )
            updated += cursor.rowcount
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.control",
            {"owner_emails": len(entries), "controls": updated},
        )
    return _snapshot(connection, organization_id, project_id)


def _systems(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
    body: SystemsUpdate,
) -> ImportBody:
    """A person confirms the systems: renames, sets the layer, or leaves one out."""
    authorize_controls_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        stored = _load(cursor, project_id, import_id, lock=True)
        if stored.status != "MAPPING":
            raise OnboardingState("upload is closed")
        if stored.systems_status != "READY" or stored.systems_version != body.systems_version:
            raise OnboardingState("systems changed")
        choices = {choice.key: choice for choice in body.choices}
        updated: list[SystemProposal] = []
        for system in stored.systems:
            choice = choices.get(system.key)
            if choice is None:
                updated.append(system)
                continue
            name = " ".join(choice.name.split())
            if name == "" or _UNSAFE.search(name):
                raise ValueError("system name is invalid")
            aliases = list(system.aliases)
            if name.lower() != system.name.lower() and system.name.lower() not in {
                alias.lower() for alias in aliases
            }:
                aliases = [system.name, *aliases][:20]
            updated.append(
                system.model_copy(
                    update={
                        "name": name,
                        "layer": choice.layer,
                        "included": choice.included,
                        "aliases": aliases,
                    }
                )
            )
        names = [system.name.lower() for system in updated if system.included]
        if len(names) != len(set(names)):
            raise ValueError("two systems have the same name")
        cursor.execute(
            """
            UPDATE rcm_imports SET systems = %s, systems_version = systems_version + 1
            WHERE id = %s
            """,
            (Json([system.model_dump() for system in updated]), import_id),
        )
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _rescan(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
) -> ImportBody:
    authorize_controls_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        stored = _load(cursor, project_id, import_id, lock=True)
        if stored.status != "MAPPING":
            raise OnboardingState("upload is closed")
        _reset_systems(cursor, import_id, stored.systems_basis)
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _remap(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    import_id: UUID,
) -> ImportBody:
    """A person asks the agent to map every term again, replacing the current choices."""
    authorize_controls_setup(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        stored = _load(cursor, project_id, import_id, lock=True)
        if stored.status != "MAPPING":
            raise OnboardingState("upload is closed")
        if stored.terms_status == "WORKING":
            raise OnboardingState("terms are being mapped")
        reset_terms(cursor, import_id, "REMAP")
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            "onboarding.rcm_terms_remap",
            {},
        )
    return _body(connection, project_id, _load(connection, project_id, import_id))


def _reason(stored: _Stored, field: str, value: str) -> dict[str, Any]:
    """The agent's reason for a term, while its value is still the agent's choice."""
    entry = stored.term_reasons.get(field, {}).get(value_key(value))
    mapped = stored.value_maps.get(field, {}).get(value_key(value))
    if not isinstance(entry, dict):
        return {}
    reason = str(entry.get("reason", ""))[:200]
    if entry.get("value") == mapped:
        return {"reason": reason, "mapped_by": entry.get("source")}
    if entry.get("source") == "MODEL" and isinstance(entry.get("value"), str):
        return {"alternative": entry["value"], "alternative_reason": reason}
    return {}


def _scan(scans: SystemScanScheduler | None, body: ImportBody) -> None:
    """Hand a pending scan to the background. If that fails, it resumes on restart."""
    if scans is None or (body.systems.status != "PENDING" and body.terms.status != "PENDING"):
        return
    try:
        scans.schedule_system_scans([body.id])
    except Exception:
        logger.warning("a system scan could not be scheduled; it will resume on restart")


def _reset_systems(cursor: psycopg.Cursor[Any], import_id: UUID, scan_basis: str) -> None:
    cursor.execute(
        """
        UPDATE rcm_imports
        SET systems = '[]'::jsonb, systems_status = 'PENDING', systems_source = NULL,
            systems_note = '', systems_attempts = 0, systems_lease_until = NULL,
            systems_model_call_id = NULL, systems_basis = %s,
            systems_version = systems_version + 1
        WHERE id = %s
        """,
        (scan_basis, import_id),
    )


def _confirmed(stored: _Stored) -> list[SystemProposal] | None:
    """The confirmed systems, or None while the scan is not ready."""
    if stored.systems_status != "READY":
        return None
    return [system for system in stored.systems if system.included]


def _control_systems(
    control_ref: str, column_names: list[str], confirmed: list[SystemProposal] | None
) -> list[str]:
    if confirmed is None:
        return column_names
    return [system.name for system in assigned_systems(confirmed, control_ref, column_names)]


def _new_names(
    result: BuildResult, existing: dict[str, UUID], confirmed: list[SystemProposal] | None
) -> list[str]:
    if confirmed is None:
        return _new_applications(result, existing)
    used = {
        name.lower(): name
        for control in result.controls
        for name in _control_systems(control.control_ref, control.applications, confirmed)
    }
    return [name for key, name in used.items() if key not in existing]


# Helpers


def _open(cursor: psycopg.Cursor[Any], project_id: UUID, import_id: UUID, version: int) -> _Stored:
    stored = _load(cursor, project_id, import_id, lock=True)
    if stored.status != "MAPPING":
        raise OnboardingState("upload is closed")
    if stored.version != version:
        raise OnboardingState("upload changed")
    return stored


def _new_applications(result: BuildResult, existing: dict[str, UUID]) -> list[str]:
    names: dict[str, str] = {}
    for control in result.controls:
        for name in control.applications:
            if name.lower() not in existing:
                names.setdefault(name.lower(), name)
    return list(names.values())


def _body(connection: psycopg.Connection[Any], project_id: UUID, stored: _Stored) -> ImportBody:
    rows = stored.rows
    names = headers(rows, stored.header_row)
    body_rows = data_rows(rows, stored.header_row)
    fields = stored.column_fields
    samples = column_values(rows, stored.header_row)
    if len(fields) != len(names):
        fields = suggest_fields(names, samples=samples)
    suggested = suggest_fields(names, samples=samples)
    columns = [
        ImportColumn(
            index=index,
            header=name,
            samples=_samples(body_rows, index),
            field=fields[index],
            suggested=suggested[index],
        )
        for index, name in enumerate(names)
    ]
    try:
        choices = value_choices(rows, stored.header_row, fields)
        result = build(rows, stored.header_row, fields, stored.value_maps)
    except ValueError as error:
        choices = {key: [] for key in VALUE_FIELDS}
        result = BuildResult(problems=[str(error).capitalize() + "."])
    values = {
        key: [
            ValueOption(
                value=item.value,
                count=item.count,
                mapped=stored.value_maps.get(key, {}).get(value_key(item.value)),
                suggested=item.suggested,
                **_reason(stored, key, item.value),
            )
            for item in items
        ]
        for key, items in choices.items()
    }
    existing = {app.name.lower(): app.id for app in _applications(connection, project_id)}
    count = connection.execute(
        "SELECT count(*) FROM engagement_controls WHERE project_id = %s", (project_id,)
    ).fetchone()
    return ImportBody(
        id=stored.id,
        status=stored.status,
        file_name=stored.file_name,
        file_kind=stored.file_kind,
        size_bytes=stored.size_bytes,
        created_at=stored.created_at,
        uploaded_by=stored.uploaded_by,
        version=stored.version,
        sheets=[
            SheetSummary(index=index, name=sheet.name, rows=len(sheet.rows))
            for index, sheet in enumerate(stored.sheets)
        ],
        sheet_index=stored.sheet_index,
        header_row=stored.header_row,
        data_rows=len(body_rows),
        columns=columns,
        fields=[
            FieldOption(key=key, label=label, required=key in REQUIRED) for key, label in FIELDS
        ],
        values=values,
        preview=ImportPreview(
            importable=len(result.controls),
            skipped=[SkippedRow(row=item.row, reason=item.reason) for item in result.skipped[:100]],
            skipped_count=len(result.skipped),
            warnings=result.warnings,
            problems=result.problems,
            controls=[
                ControlPreview(
                    row=control.row,
                    control_ref=control.control_ref,
                    title=control.title,
                    domain=control.domain,
                    domain_label=control.domain_label,
                    frequency=control.frequency,
                    frequency_label=control.frequency_label,
                    nature=control.nature,
                    nature_label=control.nature_label,
                    key_control=control.key_control,
                    owner_name=control.owner_name,
                    owner_email=control.owner_email,
                    applications=control.applications,
                    attributes=len(control.test_attributes),
                    custom_fields=len(control.custom_fields),
                )
                for control in result.controls[:12]
            ],
            new_applications=_new_names(result, existing, _confirmed(stored))[:60],
        ),
        terms=TermsBody(
            status=stored.terms_status,
            mode=stored.terms_mode,
            source=stored.terms_source,
            note=stored.terms_note,
            model_available=False,
        ),
        systems=SystemsBody(
            status=stored.systems_status,
            source=stored.systems_source,
            note=stored.systems_note,
            version=stored.systems_version,
            proposals=[
                SystemView(**system.model_dump(), controls=len(system.control_refs))
                for system in stored.systems
            ],
        ),
        ready=not result.problems and bool(result.controls),
        replaces=int(count[0]) if count is not None else 0,
    )


def _samples(rows: list[tuple[int, list[str]]], index: int) -> list[str]:
    samples: list[str] = []
    for _number, row in rows:
        value = row[index] if index < len(row) else ""
        shown = value if len(value) <= 120 else value[:117] + "..."
        if shown and shown not in samples:
            samples.append(shown)
        if len(samples) == 3:
            break
    return samples
