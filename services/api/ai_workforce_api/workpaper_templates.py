"""Workpaper templates a firm keeps for an engagement.

A firm keeps its own workpaper formats. It can upload a Word document or an Excel
workbook, which is read for its structure: its sheets or its tab-like headings become the
design, interim, and roll-forward tabs, and under each the headings, the text under them,
and the tables become sections. Or it can customise a standard template in the editor:
rename tabs and sections, change the guidance and the columns, add or remove sections,
and save the result as its own. Either way the template is offered next to the standard
ones for its kind of control: previews, the testers' workpapers, and the agent's drafting
then follow the firm's format. An uploaded file is kept as it was, for reference. Nothing
in a template is read as a result.

A file is client-side data: it is parsed for structure only, never run, and its text is
treated as instructions to the preparer, not to the agents.
"""

import hashlib
import io
import re
import secrets
import zipfile
from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import openpyxl
import psycopg
from defusedxml import ElementTree
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from ai_workforce_api.authorization import Principal, _call, _session_principal
from ai_workforce_api.controls import KINDS, Kind, kind_domains, kind_for_domain
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.onboarding import (
    OnboardingBody,
    OnboardingState,
    _audit,
    _authorize_setup,
    _reset_templates,
    _snapshot,
)
from ai_workforce_api.settings import Settings
from ai_workforce_api.workpapers import (
    BY_KEY,
    PERIOD_LABELS,
    PERIODS,
    SECTION_KINDS,
    STANDARD_BY_KIND,
    Period,
    SectionKind,
    TemplateSection,
    TemplateTab,
    WorkpaperTemplate,
    default_template,
)

MAX_BYTES = 5_000_000
MAX_UNZIPPED = 60_000_000
MAX_TABS = 6
MAX_SECTIONS = 24
MAX_COLUMNS = 20
MAX_STARTER_ROWS = 30
MAX_GUIDANCE = 1000
Part = Literal["whole", "design", "interim", "rollforward"]
PARTS: tuple[Part, ...] = ("whole", "design", "interim", "rollforward")

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
# Words that name a sheet or a short top heading as one of the workbook's tabs. A sheet
# is a tab by nature, so its name is read more loosely than a heading in a document.
_PERIOD_WORDS: dict[Period, tuple[str, ...]] = {
    "design": ("design", "walkthrough", "tod", "d&i", "d & i"),
    "interim": ("interim", "operating effectiveness", "toe", "test of one"),
    "rollforward": ("roll", "rfp", "update testing", "period end", "year end"),
}
_SHEET_WORDS: dict[Period, tuple[str, ...]] = {
    "design": ("understanding",),
    "interim": ("effectiveness", "testing", "test"),
    "rollforward": ("update", "remaining"),
}
# Words that mark a two-column table as the workpaper's header fields.
_FIELD_WORDS = (
    "control",
    "risk",
    "owner",
    "frequency",
    "nature",
    "period",
    "engagement",
    "application",
    "system",
    "reference",
    "objective",
)
# Words that mark a table as the testing matrix: one row per sample or attribute.
_MATRIX_WORDS = ("attribute", "sample", "test step", "testing matrix", "procedure")
# Words that mark the sign-off block.
_SIGN_WORDS = ("sign-off", "sign off", "signoff", "prepared by", "reviewed by", "approval")


class TemplateFileError(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Reading a file for its structure

Block = tuple[str, Any]  # ("heading", text) | ("text", text) | ("table", rows)
Part_ = tuple[str, list[Block]]  # a sheet or a tab-like heading, and what is under it


def period_of(name: str, sheet: bool = False) -> Period | None:
    """The tab a heading or a sheet name stands for, if it names one."""
    lowered = " ".join(name.lower().split())
    if not sheet and len(lowered.split()) > 4:
        return None
    for period in PERIODS:
        words = _PERIOD_WORDS[period] + (_SHEET_WORDS[period] if sheet else ())
        if any(word in lowered for word in words):
            return period
    return None


def _ptext(paragraph: Any) -> str:
    return " ".join("".join(t.text or "" for t in paragraph.iter(f"{_W}t")).split())


def parse_docx(content: bytes) -> list[Part_]:
    """A Word document's parts: split at headings that name a tab (Design, Interim
    testing, Roll-forward), or one unnamed part when it has none. Each part holds its
    headings, the text under them, and its tables."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_UNZIPPED:
                raise TemplateFileError("file is too large")
            xml = archive.read("word/document.xml")
    except zipfile.BadZipFile, KeyError:
        raise TemplateFileError("file is not a Word document") from None
    try:
        root = ElementTree.fromstring(xml)
    except Exception:
        raise TemplateFileError("file is not a Word document") from None
    body = root.find(f"{_W}body")
    if body is None:
        raise TemplateFileError("file is not a Word document")
    parts: list[Part_] = [("", [])]
    current: Period | None = None
    for child in body:
        if child.tag == f"{_W}p":
            text = _ptext(child)
            if not text:
                continue
            style = child.find(f"{_W}pPr/{_W}pStyle")
            name = (style.get(f"{_W}val") if style is not None else "") or ""
            runs = child.findall(f".//{_W}r")
            bold = bool(runs) and all(run.find(f"{_W}rPr/{_W}b") is not None for run in runs)
            heading = name.lower().startswith(("heading", "title")) or (
                bold and len(text) <= 80 and not text.endswith(".")
            )
            # A top heading that names a tab starts a new part of the workbook.
            # A short heading that names another tab starts a new part; one that names
            # the tab already open ("Walkthrough" under "Design") is a section of it.
            period = period_of(text) if heading else None
            if period is not None and period != current:
                parts.append((text, []))
                current = period
                continue
            parts[-1][1].append(("heading" if heading else "text", text))
        elif child.tag == f"{_W}tbl":
            rows = [
                [
                    " ".join(_ptext(p) for p in cell.findall(f".//{_W}p")).strip()
                    for cell in row.findall(f"{_W}tc")
                ]
                for row in child.findall(f"{_W}tr")
            ]
            parts[-1][1].append(("table", rows))
    return [part for part in parts if part[1]] or [("", [])]


def parse_xlsx(content: bytes) -> list[Part_]:
    """A workbook's sheets, each a part named "sheet:<title>": one-cell rows are
    headings or text, rows with several cells are a table."""
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise TemplateFileError("file is not an Excel workbook") from None
    parts: list[Part_] = []
    try:
        for sheet in workbook.worksheets:
            blocks: list[Block] = []
            table: list[list[str]] = []
            for values in sheet.iter_rows(values_only=True):
                cells = ["" if value is None else " ".join(str(value).split()) for value in values]
                while cells and cells[-1] == "":
                    cells.pop()
                filled = [cell for cell in cells if cell]
                if not filled:
                    if table:
                        blocks.append(("table", table))
                        table = []
                    continue
                if len(filled) == 1 and not (table and cells and cells[0]):
                    # One cell on its own is a heading or text. Inside a table, a row with
                    # only its first cell filled is still a row of that table.
                    if table:
                        blocks.append(("table", table))
                        table = []
                    text = filled[0]
                    heading = len(text) <= 80 and not text.endswith(".")
                    blocks.append(("heading" if heading else "text", text))
                else:
                    table.append(cells)
            if table:
                blocks.append(("table", table))
            if blocks:
                parts.append((f"sheet:{sheet.title}", blocks))
    finally:
        workbook.close()
    return parts or [("", [])]


def sections_from(blocks: list[Block]) -> list[TemplateSection]:
    """Group blocks under their headings and name each section's kind."""
    groups: list[tuple[str, list[str], list[list[list[str]]]]] = []
    for kind, value in blocks:
        if kind == "heading" or not groups:
            title = value if kind == "heading" else "Instructions"
            groups.append((str(title)[:200], [], []))
            if kind == "heading":
                continue
        if kind == "text":
            groups[-1][1].append(str(value))
        elif kind == "table":
            groups[-1][2].append(value)
    sections: list[TemplateSection] = []
    seen: dict[str, int] = {}

    def add(section: TemplateSection) -> None:
        count = seen.get(section.title.lower(), 0) + 1
        seen[section.title.lower()] = count
        title = section.title if count == 1 else f"{section.title} ({count})"
        sections.append(
            TemplateSection(title, section.kind, section.guidance, section.columns, section.rows)
        )

    for title, texts, tables in groups:
        guidance = " ".join(" ".join(texts).split())[:MAX_GUIDANCE]
        lowered = title.lower()
        if not tables:
            if any(word in lowered for word in _SIGN_WORDS):
                add(TemplateSection(title, "signoff", guidance))
            elif guidance or title != "Instructions":
                add(TemplateSection(title, "guidance", guidance))
            continue
        for table in tables:
            header = [cell for cell in (table[0] if table else []) if cell][:MAX_COLUMNS]
            width = max((len(row) for row in table), default=0)
            first_column = [row[0].lower() for row in table if row and row[0]]
            labels = " ".join(first_column + [lowered])
            if (
                width == 2
                and len(table) >= 3
                and all(len(cell) <= 40 for cell in first_column)
                and any(word in labels for word in _FIELD_WORDS)
            ):
                add(TemplateSection(title, "fields", guidance))
            elif any(word in lowered for word in _SIGN_WORDS) or any(
                word in " ".join(first_column) for word in ("prepared by", "reviewed by")
            ):
                add(TemplateSection(title, "signoff", guidance))
            elif any(word in lowered for word in _MATRIX_WORDS) or any(
                word in " ".join(header).lower() for word in _MATRIX_WORDS
            ):
                add(TemplateSection(title, "matrix", guidance, tuple(header)))
            else:
                # Rows under the header with only their first cell filled are the firm's
                # starter rows, such as a list of procedures to perform.
                starter = tuple(
                    (row[0][:300],)
                    for row in table[1:]
                    if row and row[0] and not any(cell for cell in row[1:])
                )[:MAX_STARTER_ROWS]
                add(TemplateSection(title, "table", guidance, tuple(header or ("Item",)), starter))
    if not sections:
        raise TemplateFileError("no headings or tables were found in the file")
    return sections[:MAX_SECTIONS]


def tabs_from(parts: list[Part_], part: Part, kind: Kind) -> list[TemplateTab]:
    """The workbook's tabs from a file's parts. A file that covers one tab (`part`) is that
    tab. A whole workpaper is split by its sheets or tab headings. The standard tab of the
    kind fills in any period the file does not cover, so the workbook is complete."""
    found: list[tuple[Period, str, list[TemplateSection]]] = []
    if part != "whole":
        blocks = [block for _name, part_blocks in parts for block in part_blocks]
        found.append((part, PERIOD_LABELS[part], sections_from(blocks)))
    else:
        for name, blocks in parts:
            is_sheet = name.startswith("sheet:")
            title = name.removeprefix("sheet:")
            period = period_of(title, sheet=is_sheet)
            if period is None:
                continue
            try:
                found.append((period, title[:200] or PERIOD_LABELS[period], sections_from(blocks)))
            except TemplateFileError:
                continue
        if not found:
            raise TemplateFileError(
                "no Design, Interim, or Roll-forward sheets or headings were found; name the "
                "tabs, or say which part of the workpaper the file is"
            )
    tabs: list[TemplateTab] = []
    for period in PERIODS:
        own = [item for item in found if item[0] == period]
        if not own:
            tabs.append(STANDARD_BY_KIND[kind].tabs[PERIODS.index(period)])
            continue
        for index, (_period, title, sections) in enumerate(own[: MAX_TABS - 2]):
            key = period if index == 0 else f"{period}-{index + 1}"
            tabs.append(TemplateTab(key, title, period, tuple(sections)))
    return tabs[:MAX_TABS]


# Stored templates


def tabs_json(tabs: tuple[TemplateTab, ...] | list[TemplateTab]) -> list[dict[str, Any]]:
    return [
        {
            "key": tab.key,
            "title": tab.title,
            "period": tab.period,
            "sections": [
                {
                    "title": s.title,
                    "kind": s.kind,
                    "guidance": s.guidance,
                    "columns": list(s.columns),
                    "rows": [list(row) for row in s.rows],
                }
                for s in tab.sections
            ],
        }
        for tab in tabs
    ]


def _kind(value: Any) -> SectionKind:
    for kind in SECTION_KINDS:
        if value == kind:
            return kind
    return "guidance"


def _tabs(value: Any) -> tuple[TemplateTab, ...]:
    tabs: list[TemplateTab] = []
    for item in value or []:
        if not isinstance(item, dict) or item.get("period") not in PERIODS:
            continue
        sections = tuple(
            TemplateSection(
                str(s.get("title", "")),
                _kind(s.get("kind")),
                str(s.get("guidance", "")),
                tuple(str(column) for column in s.get("columns", [])),
                tuple(tuple(str(cell) for cell in row) for row in s.get("rows", [])),
            )
            for s in item.get("sections", [])
            if isinstance(s, dict)
        )
        tabs.append(
            TemplateTab(
                str(item.get("key", "")), str(item.get("title", "")), item["period"], sections
            )
        )
    return tuple(tabs)


_COLUMNS = "id, key, kind, title, tabs, file_name, base_key, version"


def _template(row: Any) -> WorkpaperTemplate:
    file_name = str(row[5])
    base_key = str(row[6])
    if file_name:
        purpose = f"Your firm's template, from {file_name}."
    else:
        base = BY_KEY.get(base_key)
        purpose = (
            "Your firm's template."
            if base is None
            else f"Your firm's template, customised from {base.title}."
        )
    return WorkpaperTemplate(
        key=str(row[1]),
        title=str(row[3]),
        kind=row[2],
        purpose=purpose,
        tabs=_tabs(row[4]),
        source="FIRM",
        file_name=file_name,
        template_id=str(row[0]),
        base_key=base_key,
        version=int(row[7]),
    )


def template_snapshot(template: WorkpaperTemplate) -> dict[str, Any]:
    """The template as a started workpaper keeps it (Milestone 8.16)."""
    return {
        "key": template.key,
        "title": template.title,
        "kind": template.kind,
        "purpose": template.purpose,
        "source": template.source,
        "file_name": template.file_name,
        "base_key": template.base_key,
        "version": template.version,
        "tabs": tabs_json(template.tabs),
    }


def template_from_snapshot(value: dict[str, Any]) -> WorkpaperTemplate:
    kind = str(value.get("kind", ""))
    if kind not in KINDS:
        raise ValueError("snapshot kind is unknown")
    return WorkpaperTemplate(
        key=str(value.get("key", "")),
        title=str(value.get("title", "")),
        kind=kind,
        purpose=str(value.get("purpose", "")),
        tabs=_tabs(value.get("tabs", [])),
        source=str(value.get("source", "STANDARD")),
        file_name=str(value.get("file_name", "")),
        base_key=str(value.get("base_key", "")),
        version=int(value.get("version", 1)),
    )


def follow_template(cursor: psycopg.Cursor[Any], project_id: UUID, keys: list[str]) -> int:
    """Workpapers that have not started follow their control's template: the ones whose
    control uses one of these templates, or that were opened with one, take the control's
    template and are drafted again in its shape. A started workpaper keeps its own."""
    return cursor.execute(
        """
        UPDATE workpapers w
        SET template_key = c.template_key,
            draft_status = CASE WHEN w.draft_status = 'WORKING' THEN w.draft_status
                                ELSE 'PENDING' END,
            attempts = CASE WHEN w.draft_status = 'WORKING' THEN w.attempts ELSE 0 END,
            updated_at = clock_timestamp()
        FROM engagement_controls c
        WHERE c.id = w.engagement_control_id AND w.project_id = %s
          AND w.started_at IS NULL AND w.status = 'DRAFT'
          AND (c.template_key = ANY(%s) OR w.template_key = ANY(%s))
        """,
        (project_id, keys, keys),
    ).rowcount


def firm_templates(
    connection: psycopg.Connection[Any], project_id: UUID
) -> list[WorkpaperTemplate]:
    rows = connection.execute(
        f"SELECT {_COLUMNS} FROM workpaper_templates WHERE project_id = %s "
        "ORDER BY kind, created_at",
        (project_id,),
    ).fetchall()
    return [_template(row) for row in rows]


def resolve_template(
    connection: psycopg.Connection[Any], project_id: UUID, key: str
) -> WorkpaperTemplate:
    """A standard template by key, or one the firm keeps for this engagement."""
    standard = BY_KEY.get(key)
    if standard is not None:
        return standard
    row = connection.execute(
        f"SELECT {_COLUMNS} FROM workpaper_templates WHERE project_id = %s AND key = %s",
        (project_id, key),
    ).fetchone()
    if row is None:
        raise ValueError("template is unknown")
    return _template(row)


def template_keys(connection: psycopg.Connection[Any], project_id: UUID) -> dict[str, set[str]]:
    """The keys a control of each kind may use: the standard one and the firm's."""
    keys: dict[str, set[str]] = {kind: {STANDARD_BY_KIND[kind].key} for kind in KINDS}
    for template in firm_templates(connection, project_id):
        keys[template.kind].add(template.key)
    return keys


def template_for_control(
    connection: psycopg.Connection[Any], project_id: UUID, domain: str, chosen: str
) -> str:
    """The template a control keeps: the one chosen if it fits the control's kind, else
    the standard one for its area (a control that moves area takes that area's template)."""
    kind = kind_for_domain(domain)
    if chosen in template_keys(connection, project_id)[kind]:
        return chosen
    return default_template(domain)


def _clean_name(file_name: str) -> str:
    name = re.sub(r"[\x00-\x1f\x7f]", "", file_name.split("/")[-1].split("\\")[-1]).strip()[:200]
    if name == "":
        raise ValueError("file name is required")
    return name


def upload_template(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    file_name: str,
    kind: str,
    part: str,
    content: bytes,
) -> OnboardingBody:
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    chosen_kind = next((k for k in KINDS if k == kind), None)
    chosen_part = next((p for p in PARTS if p == part), None)
    if chosen_kind is None or chosen_part is None:
        raise ValueError("kind or part is unknown")
    name = _clean_name(file_name)
    if not content or len(content) > MAX_BYTES:
        raise ValueError("file is empty or too large")
    lowered = name.lower()
    if lowered.endswith(".docx"):
        file_kind, parts = "DOCX", parse_docx(content)
    elif lowered.endswith((".xlsx", ".xlsm")):
        file_kind, parts = "XLSX", parse_xlsx(content)
    else:
        raise ValueError("upload a .docx or .xlsx template")
    tabs = tabs_from(parts, chosen_part, chosen_kind)
    digest = hashlib.sha256(content).hexdigest()
    key = f"firm-u{digest[:11]}"
    title = re.sub(r"\.(docx|xlsx|xlsm)$", "", name, flags=re.IGNORECASE)[:200] or name
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO workpaper_templates (
                organization_id, project_id, key, kind, title, tabs, file_name, file_kind,
                file_sha256, content, uploaded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (project_id, key) DO UPDATE
            SET kind = EXCLUDED.kind, title = EXCLUDED.title, tabs = EXCLUDED.tabs,
                file_name = EXCLUDED.file_name, uploaded_by = EXCLUDED.uploaded_by,
                updated_at = clock_timestamp(), version = workpaper_templates.version + 1
            """,
            (
                organization_id,
                project_id,
                key,
                kind,
                title,
                Json(tabs_json(tabs)),
                name,
                file_kind,
                digest,
                content,
                principal.id,
            ),
        )
        _reset_templates(cursor, project_id)
        follow_template(cursor, project_id, [key])
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.workpaper_template",
            {"kind": kind, "part": part, "file_name": name, "tabs": len(tabs)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def customize_template(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    base_key: str,
) -> OnboardingBody:
    """A copy of a template the firm can edit and save as its own."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    try:
        base = resolve_template(connection, project_id, base_key)
    except ValueError:
        raise ValueError("template is unknown") from None
    key = f"firm-c{secrets.token_hex(6)[:11]}"
    title = (f"{base.title} (your firm)" if base.source == "STANDARD" else f"{base.title} (copy)")[
        :200
    ]
    with transaction(connection) as cursor:
        cursor.execute(
            """
            INSERT INTO workpaper_templates (
                organization_id, project_id, key, kind, title, tabs, base_key, uploaded_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                organization_id,
                project_id,
                key,
                base.kind,
                title,
                Json(tabs_json(base.tabs)),
                base.base_key or base.key,
                principal.id,
            ),
        )
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.template_customized",
            {"key": key, "base_key": base.key},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


class SectionBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: SectionKind
    guidance: str = Field(default="", max_length=MAX_GUIDANCE)
    columns: list[str] = Field(default_factory=list, max_length=MAX_COLUMNS)
    rows: list[list[str]] = Field(default_factory=list, max_length=MAX_STARTER_ROWS)

    @field_validator("columns")
    @classmethod
    def _columns(cls, value: list[str]) -> list[str]:
        cleaned = [clean_line(column, 120) for column in value]
        if any(column == "" for column in cleaned):
            raise ValueError("a column needs a name")
        return cleaned

    @field_validator("rows")
    @classmethod
    def _rows(cls, value: list[list[str]]) -> list[list[str]]:
        return [[clean_line(cell, 300) for cell in row[:MAX_COLUMNS]] for row in value]


class TabBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    period: Period
    sections: list[SectionBody] = Field(min_length=1, max_length=MAX_SECTIONS)


class TemplateBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    tabs: list[TabBody] = Field(min_length=1, max_length=MAX_TABS)
    version: int = Field(ge=1)


def tabs_of(body: TemplateBody) -> list[TemplateTab]:
    """The tabs a saved template holds, keyed by period, in the firm's order."""
    tabs: list[TemplateTab] = []
    used: set[str] = set()
    for tab in body.tabs:
        key: str = tab.period
        number = 2
        while key in used:
            key = f"{tab.period}-{number}"
            number += 1
        used.add(key)
        tabs.append(
            TemplateTab(
                key,
                clean_line(tab.title, 200),
                tab.period,
                tuple(
                    TemplateSection(
                        clean_line(s.title, 200),
                        s.kind,
                        clean_line(s.guidance, MAX_GUIDANCE),
                        tuple(s.columns) if s.kind in ("table", "matrix") else (),
                        tuple(tuple(row) for row in s.rows) if s.kind == "table" else (),
                    )
                    for s in tab.sections
                ),
            )
        )
    return tabs


def update_template(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    template_id: UUID,
    body: TemplateBody,
) -> OnboardingBody:
    """Save the firm's edits to its template. Controls using it follow the new shape."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    tabs = tabs_of(body)
    with transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT key, version FROM workpaper_templates WHERE id = %s AND project_id = %s "
            "FOR UPDATE",
            (template_id, project_id),
        ).fetchone()
        if row is None:
            raise OnboardingState("template changed")
        if int(row[1]) != body.version:
            raise OnboardingState("template changed; reload it and edit again")
        cursor.execute(
            """
            UPDATE workpaper_templates
            SET title = %s, tabs = %s, updated_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            """,
            (clean_line(body.title, 200), Json(tabs_json(tabs)), template_id),
        )
        _reset_templates(cursor, project_id)
        follow_template(cursor, project_id, [str(row[0])])
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.template_edited",
            {"key": str(row[0]), "tabs": len(tabs)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def _stored(cursor: psycopg.Cursor[Any], project_id: UUID, template_id: UUID) -> tuple[str, str]:
    row = cursor.execute(
        "SELECT key, kind FROM workpaper_templates WHERE id = %s AND project_id = %s FOR UPDATE",
        (template_id, project_id),
    ).fetchone()
    if row is None:
        raise OnboardingState("template changed")
    return str(row[0]), str(row[1])


def apply_template(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    template_id: UUID,
) -> OnboardingBody:
    """Every control of the template's kind documents with it."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        key, kind = _stored(cursor, project_id, template_id)
        changed = cursor.execute(
            """
            UPDATE engagement_controls
            SET template_key = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE project_id = %s AND template_key <> %s AND domain = ANY(%s)
            """,
            (key, project_id, key, list(kind_domains(kind))),
        ).rowcount
        _reset_templates(cursor, project_id)
        follow_template(cursor, project_id, [key])
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.template_applied",
            {"key": key, "kind": kind, "controls": changed},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


def remove_template(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    template_id: UUID,
) -> OnboardingBody:
    """Remove the firm's template. Controls using it go back to the standard one."""
    _authorize_setup(connection, principal, organization_id, project_id, after_start=True)
    with transaction(connection) as cursor:
        key, kind = _stored(cursor, project_id, template_id)
        using = cursor.execute(
            "SELECT id, domain FROM engagement_controls WHERE project_id = %s "
            "AND template_key = %s",
            (project_id, key),
        ).fetchall()
        for control_id, domain in using:
            cursor.execute(
                """
                UPDATE engagement_controls
                SET template_key = %s, version = version + 1, updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (default_template(str(domain)), control_id),
            )
        cursor.execute("DELETE FROM workpaper_templates WHERE id = %s", (template_id,))
        _reset_templates(cursor, project_id)
        follow_template(cursor, project_id, [key])
        _audit(
            cursor, organization_id, project_id, principal.id, "onboarding.template_removed",
            {"key": key, "kind": kind, "controls": len(using)},
        )  # fmt: skip
    return _snapshot(connection, organization_id, project_id)


class CustomizeBody(BaseModel):
    base_key: str = Field(min_length=1, max_length=60)


def register_workpaper_templates(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/onboarding/workpaper-templates"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except OnboardingState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except TemplateFileError as error:
            raise HTTPException(status_code=422, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    @app.post(base)
    async def upload(
        organization_id: UUID,
        project_id: UUID,
        file_name: str,
        kind: str,
        request: Request,
        part: str = "whole",
    ) -> OnboardingBody:
        content = await request.body()
        if len(content) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="file is too large")
        return run(
            request,
            lambda c, p: upload_template(
                c, p, organization_id, project_id, file_name, kind, part, content
            ),
        )

    @app.post(f"{base}/customize")
    def customize(
        organization_id: UUID, project_id: UUID, body: CustomizeBody, request: Request
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: customize_template(c, p, organization_id, project_id, body.base_key),
        )

    @app.put(f"{base}/{{template_id}}")
    def update(
        organization_id: UUID,
        project_id: UUID,
        template_id: UUID,
        body: TemplateBody,
        request: Request,
    ) -> OnboardingBody:
        return run(
            request,
            lambda c, p: update_template(c, p, organization_id, project_id, template_id, body),
        )

    @app.post(f"{base}/{{template_id}}/apply")
    def apply(
        organization_id: UUID, project_id: UUID, template_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(
            request, lambda c, p: apply_template(c, p, organization_id, project_id, template_id)
        )

    @app.post(f"{base}/{{template_id}}/remove")
    def remove(
        organization_id: UUID, project_id: UUID, template_id: UUID, request: Request
    ) -> OnboardingBody:
        return run(
            request, lambda c, p: remove_template(c, p, organization_id, project_id, template_id)
        )
