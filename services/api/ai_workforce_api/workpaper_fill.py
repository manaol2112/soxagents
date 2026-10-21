"""Filling a workpaper from the engagement's records (Milestone 8.3).

A workpaper is the control's template, filled: the control, its population and samples,
the testing matrix, and the exceptions come straight from the records. Narrative sections
(the population's source, the process, the conclusion) get a plain fallback here; the
agent drafts them in workpaper_service.py, and a person edits any section.

A template is a workbook with tabs. The design tab fills the control's design workpaper;
the interim and roll-forward tabs fill its effectiveness workpaper, the roll-forward tab
from the roll-forward round's own plan and sheet. Content is a JSON object: a reference,
a title, the tabs, and sections. A section names its tab and is fields (label and value
pairs), text (with checked citations), or a table (columns and rows).
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel, Field

from ai_workforce_api.control_instances import FAMILY_FILES, control_label
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.workpapers import (
    BY_KEY,
    PERIOD_CODES,
    TEMPLATES_VERSION,
    PreviewControl,
    TemplateSection,
    WorkpaperTemplate,
    is_sample_fields,
    preview,
    tabs_for,
    workpaper_reference,
)

Stage = Literal["DESIGN", "EFFECTIVENESS"]
SectionKind = Literal["fields", "text", "table"]
MAX_ROWS = 300
RESULT_WORDS = {
    "PASS": "Pass",
    "EXCEPTION": "Exception",
    "UNABLE": "Insufficient evidence",
    "REVIEW": "Human review required",
    "NOT_APPLICABLE": "Not applicable",
}
# Narrative roles filled from the control's description until the agent writes them.
_ACTIVITY_ROLES = frozenset(
    {
        "process-narrative",
        "understanding-of-the-control",
        "understanding-of-the-configuration",
        "report-description",
    }
)
_EVIDENCE_ROLES = {
    "configuration-inspected": ("configuration",),
    "report-instance-tested": ("report", "population"),
}


class Field_(BaseModel):
    label: str = Field(max_length=200)
    value: str = Field(max_length=4000)


class SectionReview(BaseModel):
    """A person's explicit review of an AI-proposed section (M3c closure): who, when, and
    which revision of the workpaper and of the results it rests on."""

    by: str = Field(max_length=60)
    by_name: str = Field(default="", max_length=200)
    at: str = Field(max_length=40)
    # The workpaper version the person reviewed, and the results basis it showed.
    content_version: int = Field(ge=1)
    basis: str = Field(default="", max_length=64)


class Section(BaseModel):
    key: str = Field(max_length=60)
    title: str = Field(max_length=200)
    kind: SectionKind
    guidance: str = Field(default="", max_length=1000)
    fields: list[Field_] = Field(default_factory=list, max_length=60)
    text: str = Field(default="", max_length=12_000)
    citations: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    columns: list[str] = Field(default_factory=list, max_length=20)
    rows: list[list[str]] = Field(default_factory=list, max_length=MAX_ROWS)
    # Who wrote the section last: the records, the agent, or a person.
    source: Literal["RECORDS", "AGENT", "PERSON"] = "RECORDS"
    # A narrative the agent drafts and a person completes, such as a conclusion.
    narrative: bool = False
    # The template tab the section is on, and the period that tab covers.
    tab: str = Field(default="", max_length=60)
    period: str = Field(default="", max_length=20)
    # Set only by a person's explicit review (testing_rationale.approve); cleared by any
    # change to the section or to the results it rests on.
    review: SectionReview | None = None


class Tab(BaseModel):
    key: str = Field(max_length=60)
    title: str = Field(max_length=200)
    period: str = Field(max_length=20)
    reference: str = Field(default="", max_length=120)


class Content(BaseModel):
    reference: str
    title: str
    template_key: str
    template_title: str
    template_version: int
    stage: Stage
    purpose: str
    sections: list[Section]
    kind: str = ""
    tabs: list[Tab] = Field(default_factory=list, max_length=12)


def slug(title: str) -> str:
    words = "".join(ch.lower() if ch.isalnum() else " " for ch in title).split()
    return "-".join(words)[:60] or "section"


@dataclass(frozen=True)
class Round:
    """A follow-up round's testing: the roll-forward's plan, sheet, and window."""

    kind: str
    status: str
    window_start: Any
    window_end: Any
    conclusion: str | None
    plan: dict[str, Any] | None
    sheet: Any


@dataclass(frozen=True)
class Records:
    engagement: str
    control: PreviewControl
    period_end: Any
    domain: str
    key_control: bool
    plan: dict[str, Any] | None
    sheet: Any
    files: list[dict[str, Any]]
    reliance: list[list[str]]
    rollforward: Round | None = None
    # The confirmed process understanding (process_understanding.py), as text.
    narrative: str = ""


def _plan(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, round_id: Any
) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT t.sample_size, t.population_rows, t.frame_rows, t.key_column, t.date_column,
               t.checks, t.seed, t.explanation, t.status, t.approved_at, u.display_name,
               f.file_name, t.population_sha256
        FROM control_tests t
        JOIN evidence_files f ON f.id = t.population_file_id
        LEFT JOIN users u ON u.id = t.approved_by
        WHERE t.project_id = %s AND t.engagement_control_id = %s
          AND t.test_round_id IS NOT DISTINCT FROM %s
        """,
        (project_id, control_id, round_id),
    ).fetchone()
    if row is None:
        return None
    return {
        "sample_size": int(row[0]),
        "population_rows": int(row[1]),
        "frame_rows": int(row[2]),
        "key_column": str(row[3]),
        "date_column": str(row[4]),
        "checks": row[5] if isinstance(row[5], list) else [],
        "seed": str(row[6]),
        "explanation": str(row[7]),
        "status": str(row[8]),
        "approved_at": row[9],
        "approved_by": None if row[10] is None else str(row[10]),
        "file_name": str(row[11]),
        "sha256": str(row[12]),
    }


def _sheet_of(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, round_id: Any
) -> Any:
    from ai_workforce_api.test_sheets import _sheet

    row = connection.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "AND test_round_id IS NOT DISTINCT FROM %s",
        (project_id, control_id, round_id),
    ).fetchone()
    return None if row is None else _sheet(connection, project_id, UUID(str(row[0])))


def gather(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> Records:
    from ai_workforce_api.pbc_drafting import load_context

    loaded = load_context(connection, project_id, control_id)
    control = PreviewControl(
        control_ref=loaded.control_ref,
        title=loaded.title,
        risk=loaded.risk,
        activity=loaded.activity,
        frequency=loaded.frequency,
        nature=loaded.nature,
        owner_name=loaded.owner_name,
        test_attributes=loaded.test_attributes,
        applications=loaded.applications,
        frequency_label=loaded.frequency_label,
        nature_label=loaded.nature_label,
        custom_fields=loaded.custom_fields,
    )
    plan = _plan(connection, project_id, control_id, None)
    sheet = _sheet_of(connection, project_id, control_id, None)
    # The latest roll-forward round that was not cancelled: its own plan and sheet.
    rollforward = None
    round_row = connection.execute(
        """
        SELECT id, kind, status, window_start, window_end, conclusion FROM test_rounds
        WHERE project_id = %s AND engagement_control_id = %s AND kind = 'ROLLFORWARD'
          AND status <> 'CANCELLED'
        ORDER BY created_at DESC LIMIT 1
        """,
        (project_id, control_id),
    ).fetchone()
    if round_row is not None:
        rollforward = Round(
            kind=str(round_row[1]),
            status=str(round_row[2]),
            window_start=round_row[3],
            window_end=round_row[4],
            conclusion=None if round_row[5] is None else str(round_row[5]),
            plan=_plan(connection, project_id, control_id, round_row[0]),
            sheet=_sheet_of(connection, project_id, control_id, round_row[0]),
        )
    files = [
        {
            "id": str(row[0]),
            "name": str(row[1]),
            "kind": str(row[2] or "other"),
            "summary": str(row[3] or ""),
            "text": str(row[4] or ""),
            "review": None if row[5] is None else str(row[5]),
            "feedback": str(row[6] or ""),
        }
        for row in connection.execute(
            """
            SELECT f.id, f.file_name,
                   coalesce(a.confirmed_kind, a.classification ->> 'kind'),
                   a.classification ->> 'summary', a.extracted_text,
                   coalesce(v.conclusion, v.proposed), v.feedback
            FROM evidence_file_links l
            JOIN evidence_files f ON f.id = l.evidence_file_id
            LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
            LEFT JOIN evidence_reviews v ON v.evidence_analysis_id = a.id
            WHERE l.project_id = %s AND l.evidence_file_id IN ({family})
            ORDER BY f.created_at
            """.replace("{family}", FAMILY_FILES),
            (project_id, control_id),
        ).fetchall()
    ]
    # An automated control or a report relies on change management: those controls and
    # their testing.
    reliance = [
        [
            f"{control_label(str(row[0]), None if row[3] is None else str(row[3]))} {row[1]}",
            {"EFFECTIVE": "Effective", "NOT_EFFECTIVE": "Not effective"}.get(
                str(row[2]), "Not concluded"
            ),
            workpaper_reference(str(row[0]), () if row[3] is None else (str(row[3]),), "TOE"),
        ]
        for row in connection.execute(
            """
            SELECT c.control_ref, c.title, s.conclusion,
                   (SELECT a.name FROM engagement_applications a
                    WHERE a.id = c.engagement_application_id)
            FROM engagement_controls c
            LEFT JOIN test_sheets s
              ON s.engagement_control_id = c.id AND s.project_id = c.project_id
             AND s.test_round_id IS NULL
            WHERE c.project_id = %s AND c.included AND c.domain = 'CHANGE'
              AND c.id <> %s
            ORDER BY c.control_ref
            """,
            (project_id, control_id),
        ).fetchall()
    ]
    from ai_workforce_api.process_understanding import confirmed_summary

    return Records(
        narrative=confirmed_summary(connection, control_id),
        engagement=loaded.engagement,
        control=control,
        period_end=loaded.period_end,
        domain=loaded.domain,
        key_control=loaded.key_control,
        plan=plan,
        sheet=sheet,
        files=files,
        reliance=reliance,
        rollforward=rollforward,
    )


def _testing(records: Records, period: str) -> tuple[dict[str, Any] | None, Any]:
    """The plan and sheet a tab reads: interim testing's, or the roll-forward round's."""
    if period == "rollforward":
        if records.rollforward is None:
            return None, None
        return records.rollforward.plan, records.rollforward.sheet
    if period == "interim":
        return records.plan, records.sheet
    return None, None


def section_keys(template: WorkpaperTemplate, stage: Stage) -> list[tuple[str, str, str]]:
    """(key, tab key, role) for each section of the stage's tabs. A role is the section's
    title as a slug; a key is unique within the workpaper, prefixed by its tab when the
    role repeats (the roll-forward's own exceptions after the interim's)."""
    keys: list[tuple[str, str, str]] = []
    used: set[str] = set()
    for tab in tabs_for(template, stage):
        for section in tab.sections:
            role = slug(section.title)
            key = role if role not in used else f"{tab.key}-{role}"[:60]
            number = 2
            while key in used:
                key = f"{tab.key}-{role}-{number}"[:60]
                number += 1
            used.add(key)
            keys.append((key, tab.key, role))
    return keys


def fill(template_key: str | WorkpaperTemplate, stage: Stage, records: Records) -> Content:
    """The workpaper from the records. Narratives get a plain fallback for the agent.

    The template is a standard one by key, or the firm's own (resolved by the caller)."""
    template = (
        template_key if isinstance(template_key, WorkpaperTemplate) else BY_KEY.get(template_key)
    )
    if template is None:
        raise ValueError("template is unknown")
    shown = preview(template, records.control, records.engagement, records.period_end)
    shown_tabs = {tab.key: tab for tab in shown.tabs}
    keys = iter(section_keys(template, stage))
    sections: list[Section] = []
    tabs: list[Tab] = []
    for tab in tabs_for(template, stage):
        base_tab = shown_tabs[tab.key]
        tabs.append(
            Tab(key=tab.key, title=tab.title, period=tab.period, reference=base_tab.reference)
        )
        for section, base in zip(tab.sections, base_tab.sections, strict=True):
            key, _tab_key, role = next(keys)
            sections.append(_filled(key, role, tab.key, tab.period, section, base, stage, records))
    return Content(
        reference=_reference(records.control, stage),
        title=shown.title,
        template_key=template.key,
        template_title=template.title,
        template_version=TEMPLATES_VERSION,
        stage=stage,
        purpose=template.purpose,
        sections=sections,
        kind=template.kind,
        tabs=tabs,
    )


def _reference(control: PreviewControl, stage: Stage) -> str:
    code = PERIOD_CODES["design"] if stage == "DESIGN" else PERIOD_CODES["interim"]
    return workpaper_reference(control.control_ref, control.applications, code)


def _filled(
    key: str,
    role: str,
    tab: str,
    period: str,
    section: TemplateSection,
    base: Any,
    stage: Stage,
    records: Records,
) -> Section:
    made = Section(key=key, title=section.title, kind="table", tab=tab, period=period)
    if section.kind == "fields":
        fields = [Field_(label=f.label, value=f.value) for f in base.fields]
        if is_sample_fields(section):
            fields = _sample_fields(records, period) or fields
        return made.model_copy(update={"kind": "fields", "fields": fields})
    if section.kind == "guidance":
        # A confirmed process understanding is the team's own account of the design:
        # it fills the narrative section as a person's words, which the agent keeps.
        if role in _ACTIVITY_ROLES and records.narrative:
            return made.model_copy(
                update={
                    "kind": "text",
                    "guidance": section.guidance,
                    "text": records.narrative[:12_000],
                    "narrative": True,
                    "source": "PERSON",
                }
            )
        return made.model_copy(
            update={
                "kind": "text",
                "guidance": section.guidance,
                "text": _fallback(role, period, stage, records),
                "narrative": True,
            }
        )
    if section.kind == "matrix":
        columns, rows = _matrix(period, records, base.columns, base.rows)
        return made.model_copy(update={"columns": columns, "rows": rows})
    if section.kind == "table":
        columns, rows = _table(role, period, records, list(base.columns), base.rows)
        return made.model_copy(
            update={
                "guidance": section.guidance,
                "columns": columns,
                "rows": rows,
                "narrative": role == "walkthrough-of-one-instance",
            }
        )
    return made.model_copy(
        update={"columns": ["Role", "Name", "Date"], "rows": _signoff(records, period)}
    )


def _sample_fields(records: Records, period: str) -> list[Field_]:
    plan, _sheet = _testing(records, period)
    if plan is None:
        return []
    fields = [
        Field_(label="Population", value=f"{plan['file_name']} ({plan['population_rows']} rows)"),
        Field_(label="Population SHA-256", value=plan["sha256"]),
        Field_(label="Sampling frame", value=f"{plan['frame_rows']} rows in the period"),
        Field_(label="Sample size", value=str(plan["sample_size"])),
        Field_(label="Selection method", value=f"Random, seed {plan['seed']}"),
        Field_(label="Key column", value=plan["key_column"] or "None found"),
        Field_(label="Date column", value=plan["date_column"] or "None found"),
        Field_(
            label="Approved",
            value=(
                f"{plan['approved_by']} on {plan['approved_at'].date().isoformat()}"
                if plan["approved_at"] is not None and plan["approved_by"]
                else "Not yet approved"
            ),
        ),
    ]
    if period == "rollforward" and records.rollforward is not None:
        fields.insert(
            0,
            Field_(
                label="Period covered",
                value=f"{records.rollforward.window_start} to {records.rollforward.window_end}",
            ),
        )
    return fields


def _conclusion(sheet: Any, what: str) -> str:
    """The derived conclusion from a signed-off sheet, or why there is none yet."""
    if sheet is None or sheet.status != "SIGNED_OFF":
        return f"{what} is not signed off yet."
    failed = [item.label for item in sheet.items if any(c.final == "EXCEPTION" for c in item.cells)]
    count = len(sheet.items)
    if sheet.conclusion == "EFFECTIVE":
        return (
            f"All {count} {'item' if count == 1 else 'items'} tested met every attribute. "
            "The control operated effectively."
        )
    return clean_line(
        f"Exceptions were found in {len(failed)} of {count} item(s) ({', '.join(failed[:10])}). "
        "The control did not operate effectively.",
        2000,
    )


def _fallback(role: str, period: str, stage: Stage, records: Records) -> str:
    """Plain words from the records, until the agent or a person writes the section."""
    plan, sheet = _testing(records, period)
    if role == "population":
        if plan is None:
            return "No population has been received yet."
        checks = "; ".join(
            f"{c.get('check', '')}: {c.get('result', '')}"
            for c in plan["checks"]
            if isinstance(c, dict)
        )
        return clean_line(
            f"The population is {plan['file_name']} ({plan['population_rows']} rows, SHA-256 "
            f"{plan['sha256'][:12]}…), of which {plan['frame_rows']} fall in the period. "
            f"Checks: {checks or 'none recorded'}.",
            2000,
        )
    if role == "design-conclusion":
        return "The preparer concludes on the design after the walkthrough."
    if "conclusion" in role and stage == "EFFECTIVENESS":
        if period == "rollforward":
            interim = _conclusion(records.sheet, "Interim testing")
            if records.rollforward is None:
                return f"{interim} No roll-forward round has started yet."
            return f"Interim: {interim} Roll-forward: {_conclusion(sheet, 'Roll-forward testing')}"
        return _conclusion(sheet, "Testing")
    if role in _ACTIVITY_ROLES:
        return records.control.activity
    if role in _EVIDENCE_ROLES:
        names = [f["name"] for f in records.files if f["kind"] in _EVIDENCE_ROLES[role]]
        what = "Configuration" if role == "configuration-inspected" else "Report"
        return (
            f"{what} inspected: " + ", ".join(names) + "."
            if names
            else f"No {what.lower()} evidence has been received yet."
        )
    if role == "segregation-of-duties":
        owner = records.control.owner_name or "the control owner"
        return (
            f"The control is performed by {owner}. The preparer records the reviewer and the "
            "approver from the walkthrough."
        )
    if "changes" in role and period == "rollforward":
        if records.rollforward is None:
            return "No roll-forward round has started yet."
        status = {
            "REQUESTED": "the owner's confirmation and population are requested",
            "TESTING": "the update sample is being tested",
            "SIGNED_OFF": "testing is signed off",
        }.get(records.rollforward.status, records.rollforward.status.lower())
        return (
            f"The roll-forward covers {records.rollforward.window_start} to "
            f"{records.rollforward.window_end}; {status}."
        )
    return ""


def _matrix(
    period: str, records: Records, columns: list[str], rows: list[list[str]]
) -> tuple[list[str], list[list[str]]]:
    _plan, sheet = _testing(records, period)
    if period == "design" or sheet is None:
        return columns, rows
    attributes = sheet.attributes
    head = ["Item", *[f"{chr(65 + i)}. {a}" for i, a in enumerate(attributes)], "Evidence"]
    body: list[list[str]] = []
    for item in sheet.items[:MAX_ROWS]:
        cells = [
            RESULT_WORDS.get(str(cell.final), "Not tested")
            + (
                f": {cell.override_reason or cell.note}"
                if (cell.override_reason or cell.note)
                else ""
            )
            for cell in item.cells
        ]
        body.append([item.label, *cells, ", ".join(f.file_name for f in item.files) or "None"])
    return head, body


def _table(
    role: str, period: str, records: Records, columns: list[str], starter: list[list[str]]
) -> tuple[list[str], list[list[str]]]:
    _plan, sheet = _testing(records, period)
    if role == "exceptions":
        rows = []
        if sheet is not None:
            for item in sheet.items:
                for cell in item.cells:
                    if cell.final == "EXCEPTION":
                        rows.append(
                            [
                                item.label,
                                f"{chr(65 + cell.index)}. {sheet.attributes[cell.index]}",
                                cell.override_reason or cell.note,
                                "To be confirmed with the control owner",
                                "",
                            ]
                        )
        return columns, rows[:MAX_ROWS] or [["None", "", "No exceptions were found.", "", ""]]
    if role == "information-produced-by-the-entity":
        reports = [f for f in records.files if f["kind"] in ("report", "population")]
        rows = [[f["name"], ", ".join(records.control.applications) or "", ""] for f in reports]
        return columns, rows or [["", "", ""]]
    if role == "reliance-on-it-general-controls":
        return columns, records.reliance or [["No change management controls in scope", "", ""]]
    width = len(columns)
    rows = [[*row, *[""] * width][:width] for row in starter] or [["" for _ in columns]]
    return columns, rows


def _signoff(records: Records, period: str) -> list[list[str]]:
    _plan, sheet = _testing(records, period)
    rows: list[list[str]] = []
    if sheet is not None and sheet.status == "SIGNED_OFF":
        rows.append(
            [
                "Testing signed off by",
                sheet.signed_by or "",
                "" if sheet.signed_at is None else sheet.signed_at.date().isoformat(),
            ]
        )
    rows.append(["Prepared by", "", ""])
    rows.append(["Reviewed by", "", ""])
    return rows


def merge(new: Content, old: Content | None) -> Content:
    """A new fill keeps every section a person wrote, and the agent's narratives."""
    if old is None:
        return new
    kept = {section.key: section for section in old.sections}
    sections = []
    for section in new.sections:
        previous = kept.get(section.key)
        place = {"tab": section.tab, "period": section.period}
        if previous is not None and previous.source == "PERSON":
            sections.append(previous.model_copy(update=place))
        elif previous is not None and previous.source == "AGENT" and section.narrative:
            sections.append(previous.model_copy(update=place))
        else:
            sections.append(section)
    return new.model_copy(update={"sections": sections})
