"""The registered tools the console's agent can call, and how each one runs.

Every tool has a schema and a risk class:

- READ tools answer from the engagement's records. They run at once.
- ROUTINE tools do reversible, internal work (redraft a request, read a file again,
  propose samples). They run at once and are listed on the agent's reply.
- CONFIRM tools touch a client, an approval, a sign-off, a finding, or the plan. The
  agent can only propose them. They run when the person confirms, as that person.

Each tool calls the same service functions as the pages, with the same authorization
checks. The agent cannot call anything that is not registered here, and its arguments
are validated before anything runs. Results returned to the model are bounded, and
client content in them is marked as data.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, cast
from uuid import UUID, uuid4

import psycopg
from pydantic import BaseModel, Field, ValidationError, model_validator

from ai_workforce_api.authorization import NotVisible, Principal
from ai_workforce_api.control_instances import FAMILY_FILES, control_label, parse_control_name
from ai_workforce_api.evidence_withdrawn import in_force
from ai_workforce_api.models import ChatTool
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

Risk = Literal["READ", "ROUTINE", "CONFIRM"]
RESULT_CHARS = 24_000
EVIDENCE_CHARS = 8_000


@dataclass
class ToolContext:
    connection: psycopg.Connection[Any]
    settings: Settings
    principal: Principal
    organization_id: UUID
    project_id: UUID
    # Hands background work (drafts, file reading) to the worker. Optional in tests.
    drafts: Any = None
    analyses: Any = None
    timer: Any = None
    # Changes this turn has already proposed to a request (its wording, its recipient), so
    # a later step in the same plan is checked against the request as it will be.
    planned: dict[UUID, dict[str, str]] = field(default_factory=dict)


# The longest message body an evidence request email may have (outbound._compose), with room
# kept for the upload link.
MESSAGE_CHARS = 4000 - 200


class ToolFailed(Exception):
    """A tool could not run. The message is safe to show the person and the model."""


@dataclass(frozen=True)
class Tool:
    name: str
    label: str
    description: str
    risk: Risk
    arguments: type[BaseModel]
    run: Callable[[ToolContext, Any], dict[str, Any]]
    summary: Callable[[Any], str]
    # Whether the step could run as things stand, asked before it is proposed, so the
    # person is never offered a step that would fail. Raises ToolFailed with the reason.
    check: Callable[[ToolContext, Any], None] | None = None
    # What a proposed step will change, kept for the checks of the steps after it.
    plans: Callable[[ToolContext, Any], None] | None = None

    def chat_tool(self) -> ChatTool:
        schema = self.arguments.model_json_schema()
        schema.pop("title", None)
        note = {
            "READ": "Reads engagement records.",
            "ROUTINE": "Runs at once; it is internal and reversible.",
            "CONFIRM": "Only proposes the step. It runs after the person confirms it.",
        }[self.risk]
        return ChatTool(self.name, f"{self.description} {note}", schema)


# Arguments


class NoArgs(BaseModel):
    pass


class ControlArgs(BaseModel):
    control_ref: str = Field(
        min_length=1,
        max_length=60,
        description="The control ID. A control tested per application is named with its "
        "application after ' · ', such as 'ITGC-AC-01 · Oracle'.",
    )


class EngagementArg(BaseModel):
    engagement: str | None = Field(
        default=None,
        max_length=200,
        description="Another engagement the person can open in this firm, by its name or its "
        "client. Leave it out for this engagement.",
    )


class ControlQuery(BaseModel):
    testing_status: (
        Literal["complete", "awaiting_review", "in_testing", "awaiting_evidence", "not_started"]
        | None
    ) = Field(default=None, description="Where testing stands, by the rulebook.")
    stage: str | None = Field(default=None, max_length=40)
    application: str | None = Field(default=None, max_length=100)
    owner: str | None = Field(default=None, max_length=100, description="Control owner.")
    process: str | None = Field(
        default=None, max_length=100, description="Business process or control area."
    )
    control_ref: str | None = Field(default=None, max_length=60)
    failed_only: bool = False
    key_only: bool = False
    search: str | None = Field(default=None, max_length=100)


class ListControlsArgs(ControlQuery, EngagementArg):
    offset: int = Field(default=0, ge=0, le=100_000)
    limit: int = Field(default=40, ge=1, le=100)


class RequestQuery(BaseModel):
    status: str | None = Field(
        default=None,
        max_length=40,
        description="One exact status: DRAFT, APPROVAL_PENDING, SENT, WAITING_FOR_RESPONSE, "
        "PARTIALLY_RECEIVED, RECEIVED, OVERDUE, ESCALATED, CANCELLED, CLOSED.",
    )
    status_group: list[
        Literal[
            "draft",
            "awaiting_approval",
            "with_client",
            "partly_received",
            "received",
            "closed",
            "cancelled",
        ]
    ] = Field(default_factory=list, max_length=7)
    phase: (
        Literal["DESIGN", "INTERIM", "ROLLFORWARD", "RETEST", "REMEDIATION", "NOT_RECORDED"] | None
    ) = None
    application: str | None = Field(default=None, max_length=100)
    owner: str | None = Field(
        default=None, max_length=100, description="Control owner or the request's recipient."
    )
    process: str | None = Field(
        default=None, max_length=100, description="Business process or control area."
    )
    control_ref: str | None = Field(default=None, max_length=60)
    overdue_only: bool = False
    evidence_review: Literal["not_reviewed", "insufficient", "accepted"] | None = Field(
        default=None,
        description="not_reviewed = files received but not yet judged sufficient.",
    )
    search: str | None = Field(default=None, max_length=100)


class ListRequestsArgs(RequestQuery, EngagementArg):
    sort: Literal["most_overdue", "due", "control", "status"] = "most_overdue"
    offset: int = Field(default=0, ge=0, le=100_000)
    limit: int = Field(default=40, ge=1, le=100)


class ListExceptionsArgs(EngagementArg):
    include_closed: bool = False
    application: str | None = Field(default=None, max_length=100)
    control_ref: str | None = Field(default=None, max_length=60)
    offset: int = Field(default=0, ge=0, le=100_000)
    limit: int = Field(default=40, ge=1, le=100)


class ListReviewArgs(EngagementArg):
    control_ref: str | None = Field(default=None, max_length=60)
    offset: int = Field(default=0, ge=0, le=100_000)
    limit: int = Field(default=40, ge=1, le=100)


class StatusArgs(EngagementArg):
    pass


class ReportArgs(EngagementArg):
    report: Literal[
        "status_report",
        "evidence_tracker",
        "control_summary",
        "exceptions_report",
        "executive_summary",
    ]
    file_format: Literal["pdf", "docx"] = Field(
        default="pdf", description="pdf (the default), or docx for an editable Word file."
    )
    filters: dict[str, Any] = Field(
        default_factory=dict,
        description="For evidence_tracker the list_requests filters (pending requests when "
        "left out), for control_summary the list_controls filters, for exceptions_report "
        "include_closed, application, or control_ref. The status report and the executive "
        "summary cover the whole engagement.",
    )
    narrative: str | None = Field(
        default=None,
        max_length=3000,
        description="Optional: your short reading of the figures, a few sentences. It is "
        "printed in its own section marked as AI-written and not verified. Only what the "
        "figures show; no audit opinion, severity, or effectiveness conclusion.",
    )


class ExportArgs(EngagementArg):
    dataset: Literal["evidence_requests", "controls", "exceptions", "review_items"]
    file_format: Literal["xlsx", "csv"] = Field(
        default="xlsx", description="xlsx for Excel (the default), csv for a plain data file."
    )
    filters: dict[str, Any] = Field(
        default_factory=dict,
        description="The same filters as the list tool for that dataset (for example "
        '{"phase": "INTERIM", "overdue_only": true}), so the file holds what was just shown.',
    )


class EvidenceArgs(BaseModel):
    evidence_file_id: UUID
    offset: int = Field(default=0, ge=0, le=200_000)


class RequestArgs(BaseModel):
    request_id: UUID


class FileArgs(BaseModel):
    evidence_file_id: UUID


class ProposeArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    evidence_file_id: UUID | None = Field(
        default=None, description="The population file. Defaults to the latest one."
    )


class ApprovalArgs(BaseModel):
    approval_id: UUID
    decision: Literal["APPROVED", "REJECTED"]
    reason: str = Field(min_length=1, max_length=500)


class ReplaceArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    position: int = Field(ge=1, le=200)
    row_number: int = Field(ge=1)
    selection: Literal["HAPHAZARD", "TARGETED"]
    reason: str = Field(min_length=3, max_length=500)


class KindArgs(BaseModel):
    evidence_file_id: UUID
    kind: Literal[
        "population",
        "walkthrough",
        "design",
        "configuration",
        "change_history",
        "report",
        "policy",
        "sample",
        "other",
    ]
    note: str = Field(default="", max_length=500)


class SignOffArgs(BaseModel):
    evidence_file_id: UUID
    decision: Literal["ACCEPTED", "OVERRIDDEN"]
    conclusion: Literal["NO_EXCEPTION", "EXCEPTION", "CANNOT_CONCLUDE"] | None = None
    note: str = Field(default="", max_length=1000)


class TestResultArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    item: str = Field(
        min_length=1, max_length=200, description="The sample's key as the test sheet shows it."
    )
    attribute_index: int = Field(ge=0, lt=12, description="The attribute's index, from 0.")
    result: Literal["PASS", "EXCEPTION", "UNABLE", "REVIEW", "NOT_APPLICABLE"] = Field(
        description="UNABLE is insufficient evidence; REVIEW is human review required. A "
        "person may record an item that cannot be tested after follow-up as an EXCEPTION."
    )
    reason: str = Field(min_length=3, max_length=500)


class TestLinkArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    evidence_file_id: UUID
    action: Literal["LINK", "UNLINK", "EXCLUDE"] = Field(
        description="LINK or UNLINK the file on one item; EXCLUDE sets it aside as not test "
        "evidence."
    )
    item: str | None = Field(default=None, max_length=200, description="For LINK and UNLINK.")
    reason: str = Field(default="", max_length=300)


class TestSignOffArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    note: str = Field(default="", max_length=1000)


class TestDeficiencyArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    action: Literal["LOG", "DISMISS"]
    reason: str = Field(default="", max_length=500, description="Required to dismiss.")
    severity: (
        Literal["CONTROL_DEFICIENCY", "SIGNIFICANT_DEFICIENCY", "MATERIAL_WEAKNESS"] | None
    ) = None
    cause: str | None = Field(default=None, max_length=4000)


class DeficiencyArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=200)
    condition: str = Field(default="", max_length=4000)
    criteria: str = Field(default="", max_length=4000)
    cause: str = Field(default="", max_length=4000)
    effect: str = Field(default="", max_length=4000)
    deficiency_type: Literal["DESIGN", "OPERATING"]
    likelihood: Literal["REMOTE", "REASONABLY_POSSIBLE", "PROBABLE"] = "REASONABLY_POSSIBLE"
    magnitude: Literal["INCONSEQUENTIAL", "MORE_THAN_INCONSEQUENTIAL", "MATERIAL"] = (
        "MORE_THAN_INCONSEQUENTIAL"
    )


class PhaseArgs(BaseModel):
    phase_key: str = Field(min_length=1, max_length=40)
    planned_start: date
    planned_end: date


class EditRequestArgs(BaseModel):
    request_id: UUID
    description: str | None = Field(
        default=None,
        min_length=10,
        max_length=4000,
        description="The full new wording of what the owner is asked for. Leave it out to "
        "keep the wording.",
    )
    recipient: str | None = Field(
        default=None,
        max_length=200,
        description="The email address the request goes to. Only an address the person "
        "gave or the engagement records show; never a guess.",
    )

    @model_validator(mode="after")
    def changes_something(self) -> EditRequestArgs:
        if self.description is None and self.recipient is None:
            raise ValueError("give new wording, a recipient, or both")
        return self


class DraftRequestArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    description: str = Field(
        min_length=10, max_length=4000, description="What the owner is asked for, in full."
    )
    recipient: str | None = Field(
        default=None,
        max_length=200,
        description="Defaults to whoever received the control's latest request.",
    )
    due_date: date | None = Field(default=None, description="Defaults to 7 days from today.")
    phase: Literal["DESIGN", "INTERIM", "ROLLFORWARD"] | None = Field(
        default=None,
        description="The testing phase this evidence serves: design, interim testing, or "
        "the roll-forward to period end.",
    )


class RequestStatusArgs(BaseModel):
    request_id: UUID
    status: Literal["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]
    reason: str = Field(default="", max_length=500, description="Needed to cancel.")


class ReviewNoteArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    note: int = Field(ge=1, le=10_000, description="The note's number on the review.")
    action: Literal["ACCEPT", "DISMISS"]
    reason: str = Field(default="", max_length=500)


class RaiseNoteArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    text: str = Field(min_length=3, max_length=2000)
    severity: Literal["MUST_FIX", "SHOULD_FIX", "OBSERVATION"] = "SHOULD_FIX"
    about: Literal["RESULT", "SAMPLE", "WORKPAPER", "DEFICIENCY", "GENERAL"] = "GENERAL"
    item: str | None = Field(default=None, max_length=200, description="The sample or application.")


class RespondNoteArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    note: int = Field(ge=1, le=10_000)
    response: str = Field(min_length=3, max_length=2000)


class ClearNoteArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    note: int = Field(ge=1, le=10_000)
    action: Literal["CLEAR", "RETURN"] = "CLEAR"
    reason: str = Field(default="", max_length=500)


class ReviewSignOffArgs(BaseModel):
    control_ref: str = Field(min_length=1, max_length=60)
    note: str = Field(default="", max_length=1000)


class MilestoneArgs(BaseModel):
    milestone_key: str = Field(min_length=1, max_length=40)
    due_date: date
    completed: bool


# Lookups


def _control(context: ToolContext, control_ref: str) -> tuple[UUID, str]:
    """A control by its ID, and its application when it has one instance per application."""
    ref, application = parse_control_name(control_ref)
    rows = context.connection.execute(
        """
        SELECT c.id, c.control_ref, a.name FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s AND lower(c.control_ref) = lower(%s)
        ORDER BY a.name NULLS FIRST
        """,
        (context.project_id, ref.strip()),
    ).fetchall()
    if not rows:
        raise ToolFailed(f"No control {control_ref} in this engagement.")
    if application is not None:
        wanted = application.strip().lower()
        rows = [row for row in rows if row[2] is not None and wanted in str(row[2]).lower()] or rows
    if len(rows) > 1:
        names = ", ".join(control_label(str(row[1]), row[2]) for row in rows)
        raise ToolFailed(f"{ref} is tested per application. Name one: {names}.")
    row = rows[0]
    return UUID(str(row[0])), control_label(str(row[1]), row[2])


def _analysis(context: ToolContext, file_id: UUID) -> tuple[UUID, int]:
    row = context.connection.execute(
        "SELECT id, version FROM evidence_analyses WHERE evidence_file_id = %s AND project_id = %s",
        (file_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That file has not been read yet.")
    return UUID(str(row[0])), int(row[1])


def _dump(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_dump(item) for item in value]
    return value


# Read tools


def _engagement(context: ToolContext, args: EngagementArg) -> UUID:
    """The engagement a read is about: this one, or another the person can open."""
    from ai_workforce_api.engagement_data import EngagementUnclear, resolve_engagement

    try:
        return resolve_engagement(
            context.connection,
            context.principal,
            context.organization_id,
            context.project_id,
            args.engagement,
        )
    except EngagementUnclear as error:
        raise ToolFailed(str(error)) from None


def _read(work: Callable[[], dict[str, Any]], rows: str | None = None) -> dict[str, Any]:
    """A read that says when it could not be done, and fits the answer it goes into: rows
    that do not fit are left for the next page, never cut part way."""
    from ai_workforce_api.engagement_data import DataUnavailable

    try:
        result = work()
    except DataUnavailable as error:
        raise ToolFailed(str(error)) from None
    if rows is None:
        return result
    # The answer needs the gist of each record; the full text is on its page and in a file.
    for row in result[rows]:
        for key in ("description", "detail"):
            if isinstance(row.get(key), str) and len(row[key]) > 160:
                row[key] = row[key][:159].rstrip() + "…"
    while len(json.dumps(result, default=str)) > RESULT_CHARS - 400 and len(result[rows]) > 1:
        result[rows] = result[rows][: max(len(result[rows]) * 3 // 4, 1)]
        result["returned"] = len(result[rows])
        result["more"] = True
    return result


def _status(context: ToolContext, args: StatusArgs) -> dict[str, Any]:
    from ai_workforce_api import engagement_data

    project = _engagement(context, args)
    return _read(
        lambda: engagement_data.status(
            context.connection, context.principal, context.organization_id, project
        )
    )


def _list_controls(context: ToolContext, args: ListControlsArgs) -> dict[str, Any]:
    from ai_workforce_api import engagement_data

    project = _engagement(context, args)
    filters = engagement_data.ControlFilters(
        **args.model_dump(include=set(ControlQuery.model_fields))
    )
    return _read(
        lambda: engagement_data.controls(
            context.connection,
            context.principal,
            context.organization_id,
            project,
            filters,
            offset=args.offset,
            limit=args.limit,
        ),
        "controls",
    )


def _get_control(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    from ai_workforce_api.control_tests import _list as list_tests
    from ai_workforce_api.workspace import _controls, _deficiencies

    control_id, _ref = _control(context, args.control_ref)
    rows = _controls(
        context.connection, context.principal, context.organization_id, context.project_id
    )
    row = next(item for item in rows if item.id == control_id)
    requests = context.connection.execute(
        """
        SELECT id, status, recipient, due_at, left(evidence_description, 700)
        FROM pbc_requests WHERE project_id = %s AND engagement_control_id = %s
        ORDER BY created_at
        """,
        (context.project_id, control_id),
    ).fetchall()
    files = context.connection.execute(
        """
        SELECT f.id, f.file_name, f.created_at, l.pbc_request_id,
               a.status, a.extraction, a.extraction_status, a.ocr_engine, a.classification,
               a.confirmed_kind, a.note, char_length(a.extracted_text),
               v.status, v.checks, v.attributes, v.proposed, v.feedback, v.decision,
               v.conclusion
        FROM evidence_files f
        JOIN evidence_file_links l ON l.evidence_file_id = f.id
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        LEFT JOIN evidence_reviews v ON v.evidence_file_id = f.id
        WHERE f.project_id = %s AND f.id IN ({family})
        ORDER BY f.created_at
        """.replace("{family}", FAMILY_FILES),
        (context.project_id, control_id),
    ).fetchall()
    applications = _file_applications(context, [UUID(str(item[0])) for item in files])
    tests = [
        _dump(test)
        for test in list_tests(
            context.connection, context.principal, context.organization_id, context.project_id
        )
        if test.engagement_control_id == control_id
    ]
    for test in tests:
        test["samples"] = test["samples"][:40]
    findings = [
        {
            "reference": item.reference,
            "title": item.title,
            "severity": item.severity,
            "status": item.status,
            "condition": item.condition[:500],
        }
        for item in _deficiencies(
            context.connection, context.principal, context.organization_id, context.project_id
        )
        if item.control_id == control_id
    ]
    return {
        "control": {
            "control_ref": row.control_ref,
            "application": row.application_name,
            "label": row.label or row.control_ref,
            "title": row.title,
            "activity": row.activity,
            "risk": row.risk,
            "area": row.area,
            "frequency": row.frequency,
            "nature": row.nature,
            "key_control": row.key_control,
            "sample_size": row.sample_size,
            "owner": row.owner_name or "PBC coordinator",
            "owner_email": row.owner_email,
            "applications": row.systems,
            "test_attributes": row.test_attributes,
            "evidence_needed": row.pbc_items,
            "stage": row.stage,
            "next_step": row.next_step,
            "waiting_on": row.waiting_on,
            "conclusion": row.conclusion,
        },
        "requests": [
            {
                "request_id": str(item[0]),
                "status": item[1],
                "recipient": item[2],
                "due": item[3].date().isoformat(),
                "description": item[4],
            }
            for item in requests
        ],
        # Every file in brief, so none is cut off; read_evidence gives one file in full.
        "evidence_files": [
            {
                "evidence_file_id": str(item[0]),
                "file_name": item[1],
                "received": item[2].date().isoformat(),
                "request_id": None if item[3] is None else str(item[3]),
                "application": applications.get(item[0], "not known"),
                "reading": None
                if item[4] is None
                else {
                    "status": item[4],
                    "kind": item[9] or (item[8] or {}).get("kind"),
                    "summary": _short(str((item[8] or {}).get("summary", "")), 240),
                    "follow_up_points": len((item[8] or {}).get("gaps", [])),
                    "text_characters": item[11],
                },
                "screenshot_review": None
                if item[12] is None
                else {
                    "proposed": item[15],
                    "signed_off_conclusion": item[18],
                    "feedback": _short(str(item[16] or ""), 400),
                },
            }
            for item in files
        ],
        "test_plan": tests[0] if tests else None,
        "test_sheet": _sheet_summary(context, control_id),
        "workpapers": [
            {"stage": row[0], "status": row[1], "version": row[2], "drafting": row[3]}
            for row in context.connection.execute(
                "SELECT stage, status, current_version, draft_status <> 'IDLE' FROM workpapers "
                "WHERE project_id = %s AND engagement_control_id = %s ORDER BY stage",
                (context.project_id, control_id),
            ).fetchall()
        ],
        "deficiencies": findings,
    }


def _file_applications(context: ToolContext, file_ids: list[UUID]) -> dict[UUID, str]:
    rows = context.connection.execute(
        """
        SELECT t.evidence_file_id, t.scope, a.name,
               (SELECT string_agg(x.name, ', ' ORDER BY x.name) FROM engagement_applications x
                WHERE x.id = ANY(t.engagement_application_ids))
        FROM evidence_file_applications t
        LEFT JOIN engagement_applications a ON a.id = t.engagement_application_id
        WHERE t.evidence_file_id = ANY(%s)
        """,
        (file_ids,),
    ).fetchall()
    return {
        row[0]: "all applications"
        if row[1] == "ALL"
        else str(row[3] or "not known")
        if row[1] == "SOME"
        else str(row[2] or "not known")
        for row in rows
    }


def _read_evidence(context: ToolContext, args: EvidenceArgs) -> dict[str, Any]:
    row = context.connection.execute(
        """
        SELECT f.file_name, a.extracted_text, a.text_truncated, a.content_redacted,
               a.classification, a.confirmed_kind, a.note,
               v.checks, v.attributes, v.proposed, v.feedback, v.conclusion
        FROM evidence_files f JOIN evidence_analyses a ON a.evidence_file_id = f.id
        LEFT JOIN evidence_reviews v ON v.evidence_analysis_id = a.id
        WHERE f.id = %s AND f.project_id = %s AND NOT """
        + in_force("f"),
        (args.evidence_file_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That file is not in this engagement or has not been read.")
    text = str(row[1])
    chunk = text[args.offset : args.offset + EVIDENCE_CHARS]
    first = args.offset == 0
    return {
        "file_name": row[0],
        "application": _file_applications(context, [args.evidence_file_id]).get(
            args.evidence_file_id, "not known"
        ),
        "offset": args.offset,
        "total_characters": len(text),
        "more": args.offset + EVIDENCE_CHARS < len(text),
        "redacted": bool(row[3]),
        "file_was_cut": bool(row[2]),
        # The full reading and review come with the first part of the text.
        "reading": {"classification": row[4], "confirmed_kind": row[5], "note": row[6]}
        if first
        else None,
        "screenshot_review": {
            "checks": row[7],
            "attributes": row[8],
            "proposed": row[9],
            "feedback": row[10],
            "signed_off_conclusion": row[11],
        }
        if first and row[9] is not None
        else None,
        "text": f"<client_evidence>\n{chunk}\n</client_evidence>",
    }


def _list_requests(context: ToolContext, args: ListRequestsArgs) -> dict[str, Any]:
    from ai_workforce_api import engagement_data

    project = _engagement(context, args)
    filters = engagement_data.RequestFilters(
        **args.model_dump(include=set(RequestQuery.model_fields))
    )
    return _read(
        lambda: engagement_data.evidence_requests(
            context.connection,
            context.principal,
            context.organization_id,
            project,
            filters,
            sort=args.sort,
            offset=args.offset,
            limit=args.limit,
        ),
        "requests",
    )


def _list_exceptions(context: ToolContext, args: ListExceptionsArgs) -> dict[str, Any]:
    from ai_workforce_api import engagement_data

    project = _engagement(context, args)
    return _read(
        lambda: engagement_data.exceptions(
            context.connection,
            context.principal,
            context.organization_id,
            project,
            include_closed=args.include_closed,
            application=args.application,
            control_ref=args.control_ref,
            offset=args.offset,
            limit=args.limit,
        ),
        "exceptions",
    )


def _list_review(context: ToolContext, args: ListReviewArgs) -> dict[str, Any]:
    from ai_workforce_api import engagement_data

    project = _engagement(context, args)
    return _read(
        lambda: engagement_data.review_items(
            context.connection,
            context.principal,
            context.organization_id,
            project,
            control_ref=args.control_ref,
            offset=args.offset,
            limit=args.limit,
        ),
        "items",
    )


EXPORT_FILTERS: dict[str, type[BaseModel]] = {
    "evidence_requests": RequestQuery,
    "controls": ControlQuery,
}


REPORT_FILTERS: dict[str, type[BaseModel] | None] = {
    "evidence_tracker": RequestQuery,
    "control_summary": ControlQuery,
    "exceptions_report": None,
    "status_report": None,
    "executive_summary": None,
}


def _report(context: ToolContext, args: ReportArgs) -> dict[str, Any]:
    from ai_workforce_api.exports import ExportFailed, create_export

    project = _engagement(context, args)
    model = REPORT_FILTERS[args.report]
    try:
        if model is not None:
            filters = model.model_validate(args.filters).model_dump(exclude_defaults=True)
        elif args.report == "exceptions_report":
            unknown = set(args.filters) - {"include_closed", "application", "control_ref"}
            if unknown:
                raise ToolFailed(
                    f"The exceptions report cannot be filtered by {', '.join(sorted(unknown))}."
                )
            filters = dict(args.filters)
        elif args.filters:
            raise ToolFailed("This report covers the whole engagement; it takes no filters.")
        else:
            filters = {}
    except ValidationError as error:
        first = error.errors()[0]
        field_name = ".".join(str(part) for part in first.get("loc", ()))
        raise ToolFailed(f"The filter {field_name} is not valid.") from None
    try:
        made = create_export(
            context.connection,
            context.settings,
            context.principal,
            context.organization_id,
            project,
            args.report,
            args.file_format,
            filters,
            narrative=args.narrative or "",
        )
    except ExportFailed as error:
        raise ToolFailed(str(error)) from None
    return {
        "export": {
            "id": str(made.id),
            "project_id": str(project),
            "file_name": made.file_name,
            "file_format": made.file_format,
            "dataset": made.dataset,
            "rows": made.rows,
            "filters": made.filters,
            "as_of": made.as_of.isoformat(timespec="seconds"),
            "expires": made.expires_at.date().isoformat(),
        },
        "note": "The report is ready; the person downloads it from the answer.",
    }


def _report_summary(args: ReportArgs) -> str:
    from ai_workforce_api.reports import REPORTS

    kind = "PDF" if args.file_format == "pdf" else "Word"
    return f"Made the {REPORTS[args.report].lower()} as {kind}"


def _export(context: ToolContext, args: ExportArgs) -> dict[str, Any]:
    from ai_workforce_api.engagement_data import DataUnavailable
    from ai_workforce_api.exports import ExportFailed, create_export

    project = _engagement(context, args)
    model = EXPORT_FILTERS.get(args.dataset)
    try:
        if model is not None:
            filters = model.model_validate(args.filters).model_dump(exclude_defaults=True)
        else:
            allowed = (
                {"include_closed", "application", "control_ref"}
                if args.dataset == "exceptions"
                else {"control_ref"}
            )
            unknown = set(args.filters) - allowed
            if unknown:
                raise ToolFailed(
                    f"{args.dataset} cannot be filtered by {', '.join(sorted(unknown))}."
                )
            filters = dict(args.filters)
    except ValidationError as error:
        first = error.errors()[0]
        field_name = ".".join(str(part) for part in first.get("loc", ()))
        raise ToolFailed(f"The filter {field_name} is not valid.") from None
    try:
        made = create_export(
            context.connection,
            context.settings,
            context.principal,
            context.organization_id,
            project,
            args.dataset,
            args.file_format,
            filters,
        )
    except (ExportFailed, DataUnavailable) as error:
        raise ToolFailed(str(error)) from None
    return {
        "export": {
            "id": str(made.id),
            "project_id": str(project),
            "file_name": made.file_name,
            "file_format": made.file_format,
            "dataset": made.dataset,
            "rows": made.rows,
            "filters": made.filters,
            "as_of": made.as_of.isoformat(timespec="seconds"),
            "expires": made.expires_at.date().isoformat(),
        },
        "note": "The file is ready; the person downloads it from the answer.",
    }


def _get_plan(context: ToolContext, _args: NoArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import _plan

    body = _dump(
        _plan(context.connection, context.principal, context.organization_id, context.project_id)
    )
    return {
        "phases": body.get("phases", []),
        "milestones": body.get("milestones", []),
        "kickoff": body.get("kickoff"),
        "period_end": body.get("period_end"),
    }


def _list_approvals(context: ToolContext, _args: NoArgs) -> dict[str, Any]:
    rows = context.connection.execute(
        """
        SELECT a.id, a.action_id, a.parameters, a.target_resource, u.display_name,
               a.requesting_user_id = %s, a.expires_at
        FROM approvals a LEFT JOIN users u ON u.id = a.requesting_user_id
        WHERE a.project_id = %s AND a.decision = 'PENDING' AND a.expires_at > clock_timestamp()
        ORDER BY a.created_at
        LIMIT 100
        """,
        (context.principal.id, context.project_id),
    ).fetchall()
    return {
        "count": len(rows),
        "approvals": [
            {
                "approval_id": str(row[0]),
                "action": row[1],
                "recipient": (row[2] or {}).get("recipient"),
                "subject": (row[2] or {}).get("subject"),
                "requested_by": row[4],
                "you_requested_it": bool(row[5]),
                "expires": row[6].isoformat(),
            }
            for row in rows
        ],
    }


# Routine tools


def _redraft(context: ToolContext, args: RequestArgs) -> dict[str, Any]:
    from ai_workforce_api.pbc_drafting import _redraft as redraft
    from ai_workforce_api.pbc_drafting import schedule

    body = redraft(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        args.request_id,
    )
    schedule(context.drafts, [body.id])
    return {"draft": "queued", "request_id": str(args.request_id)}


# Testing (8.2)


def _sheet_for(context: ToolContext, control_ref: str) -> tuple[UUID, Any]:
    from ai_workforce_api.test_sheets import _sheet

    control_id, ref = _control(context, control_ref)
    row = context.connection.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "ORDER BY (status = 'OPEN') DESC, (test_round_id IS NOT NULL) DESC, created_at DESC "
        "LIMIT 1",
        (context.project_id, control_id),
    ).fetchone()
    if row is None:
        raise ToolFailed(
            f"{ref} has no test sheet yet. It opens when samples are approved, or for an "
            "automated control when its evidence is read."
        )
    return UUID(str(row[0])), _sheet(context.connection, context.project_id, UUID(str(row[0])))


def _sheet_summary(context: ToolContext, control_id: UUID) -> dict[str, Any] | None:
    from ai_workforce_api.test_sheets import _sheet

    row = context.connection.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "ORDER BY (status = 'OPEN') DESC, (test_round_id IS NOT NULL) DESC, created_at DESC "
        "LIMIT 1",
        (context.project_id, control_id),
    ).fetchone()
    if row is None:
        return None
    sheet = _sheet(context.connection, context.project_id, UUID(str(row[0])))
    return {
        "method": sheet.method,
        "status": sheet.status,
        "testing_now": sheet.running,
        "proposed_conclusion": sheet.proposed_conclusion,
        "signed_off_conclusion": sheet.conclusion,
        "counts": sheet.counts,
        "blocking": sheet.blocking,
        "attributes": sheet.attributes,
        "items": [
            {
                "item": item.label,
                "state": item.state,
                "files": [{"id": str(f.id), "name": f.file_name} for f in item.files],
                "results": [
                    {
                        "index": cell.index,
                        "final": cell.final,
                        "note": cell.note,
                        "override_reason": cell.override_reason,
                    }
                    for cell in item.cells
                ],
            }
            for item in sheet.items
        ],
        "unplaced_files": [
            {"id": str(entry.file_id), "name": entry.file_name, "reason": entry.reason}
            for entry in sheet.placements
            if entry.placement == "UNPLACED"
        ],
        "proposed_deficiency": sheet.proposal if sheet.proposal_status == "PROPOSED" else None,
        "deficiency": sheet.deficiency_reference,
    }


def _item_id(sheet: Any, label: str) -> tuple[UUID, int]:
    for item in sheet.items:
        if item.label.lower() == label.strip().lower():
            return item.id, item.version
    raise ToolFailed(f"No item {label} on this test sheet.")


def _schedule_test(context: ToolContext, queued: UUID | None) -> None:
    from ai_workforce_api.testing_engine import TestScheduler, schedule_runs

    scheduler = context.drafts if isinstance(context.drafts, TestScheduler) else None
    schedule_runs(scheduler, [] if queued is None else [queued])


def _sheet_change(context: ToolContext, sheet_id: UUID, work: Any) -> tuple[Any, UUID | None]:
    from ai_workforce_api.test_sheets import SheetState, change_sheet

    try:
        return change_sheet(
            context.connection,
            context.principal,
            context.organization_id,
            context.project_id,
            sheet_id,
            work,
        )
    except SheetState as error:
        raise ToolFailed(f"The test sheet could not change: {error.detail}.") from None


# Independent review (9.2)


def _review_for(context: ToolContext, control_ref: str) -> Any:
    from ai_workforce_api.control_reviews import _is_reviewer, _review

    control_id, ref = _control(context, control_ref)
    row = context.connection.execute(
        "SELECT id FROM control_reviews WHERE project_id = %s AND engagement_control_id = %s",
        (context.project_id, control_id),
    ).fetchone()
    if row is None:
        raise ToolFailed(
            f"{ref} is not under review yet. The review opens when its effectiveness "
            "workpaper is prepared."
        )
    return _review(
        context.connection,
        context.project_id,
        UUID(str(row[0])),
        context.principal.id,
        _is_reviewer(context.connection, context.project_id, context.principal.id),
    )


def _review_summary(review: Any) -> dict[str, Any]:
    return {
        "control": review.label,
        "status": review.status,
        "reperforming": review.reperforming,
        "reperformed_at": review.reperformed_at,
        "reperform_source": review.reperform_source,
        "reperform_note": review.reperform_note,
        "testing": review.sheet_status,
        "workpapers": [
            {"stage": paper.stage, "status": paper.status} for paper in review.workpapers
        ],
        "counts": review.counts,
        "blocking": review.blocking,
        "you_are_the_reviewer": review.viewer_is_reviewer,
        "you_prepared_this_work": review.viewer_prepared,
        "signed_by": review.signed_by,
        "notes": [
            {
                "number": note.number,
                "severity": note.severity,
                "about": note.target_kind,
                "status": note.status,
                "raised_by": note.raised_by_name or note.raised_by,
                "text": note.text,
                "reviewer_result": note.target.get("reviewer_result"),
                "citations": [
                    {"file": c.get("file_name"), "quote": c.get("quote")}
                    for c in note.target.get("citations", [])
                    if isinstance(c, dict)
                ][:4],
                "response": note.response,
                "decision_reason": note.decision_reason,
                "clear_reason": note.clear_reason,
                "reopened": note.reopened,
            }
            for note in review.notes
        ],
    }


def _note_id(review: Any, number: int) -> UUID:
    for note in review.notes:
        if note.number == number:
            return UUID(str(note.id))
    raise ToolFailed(f"The review of {review.label} has no note #{number}.")


def _review_change(context: ToolContext, work: Any) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import ReviewState, schedule_reviews

    try:
        body, queued = work()
    except ReviewState as error:
        raise ToolFailed(f"The review could not change: {error.detail}.") from None
    schedule_reviews(context.drafts, queued)
    return _review_summary(body)


def _get_review(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    return _review_summary(_review_for(context, args.control_ref))


def _reperform_review(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import VersionBody, _reperform

    review = _review_for(context, args.control_ref)
    result = _review_change(
        context,
        lambda: _reperform(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id, VersionBody(version=review.version),
        ),
    )  # fmt: skip
    return {"control": review.label, "reperforming": result["reperforming"]}


def _decide_review_note(context: ToolContext, args: ReviewNoteArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import NoteDecision, _decide_note

    review = _review_for(context, args.control_ref)
    note_id = _note_id(review, args.note)
    return _review_change(
        context,
        lambda: _decide_note(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id, note_id,
            NoteDecision(version=review.version, action=args.action, reason=args.reason),
        ),
    )  # fmt: skip


def _raise_review_note(context: ToolContext, args: RaiseNoteArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import NoteCreate, _add_note

    review = _review_for(context, args.control_ref)
    item_id: UUID | None = None
    if args.item:
        _sheet_id, sheet = _sheet_for(context, args.control_ref)
        item_id, _version = _item_id(sheet, args.item)
    return _review_change(
        context,
        lambda: _add_note(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id,
            NoteCreate(
                version=review.version, target_kind=args.about, severity=args.severity,
                text=args.text, item_id=item_id,
            ),
        ),
    )  # fmt: skip


def _respond_review_note(context: ToolContext, args: RespondNoteArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import NoteResponse, _respond_note

    review = _review_for(context, args.control_ref)
    note_id = _note_id(review, args.note)
    return _review_change(
        context,
        lambda: _respond_note(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id, note_id, NoteResponse(version=review.version, response=args.response),
        ),
    )  # fmt: skip


def _clear_review_note(context: ToolContext, args: ClearNoteArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import NoteClear, _clear_note

    review = _review_for(context, args.control_ref)
    note_id = _note_id(review, args.note)
    return _review_change(
        context,
        lambda: _clear_note(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id, note_id,
            NoteClear(version=review.version, action=args.action, reason=args.reason),
        ),
    )  # fmt: skip


def _sign_off_review(context: ToolContext, args: ReviewSignOffArgs) -> dict[str, Any]:
    from ai_workforce_api.control_reviews import SignOffBody as ReviewSignOffBody
    from ai_workforce_api.control_reviews import _sign_off as sign_off_review

    review = _review_for(context, args.control_ref)
    result = _review_change(
        context,
        lambda: sign_off_review(
            context.connection, context.principal, context.organization_id, context.project_id,
            review.id, ReviewSignOffBody(version=review.version, note=args.note),
        ),
    )  # fmt: skip
    return {"control": review.label, "status": result["status"], "signed_by": result["signed_by"]}


def _draft_workpapers(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    from ai_workforce_api.db import transaction
    from ai_workforce_api.workpaper_service import ensure, schedule_drafts

    control_id, ref = _control(context, args.control_ref)
    with transaction(context.connection) as cursor:
        queued = ensure(
            cursor, context.organization_id, context.project_id, control_id, context.principal.id
        )
    schedule_drafts(context.drafts, queued)
    return {"control": ref, "drafting": len(queued)}


def _retest(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    from ai_workforce_api.test_sheets import retest_work

    sheet_id, sheet = _sheet_for(context, args.control_ref)
    body, queued = _sheet_change(context, sheet_id, retest_work(sheet.version))
    _schedule_test(context, queued)
    return {"testing": "queued", "items": len(body.items)}


def _override_result(context: ToolContext, args: TestResultArgs) -> dict[str, Any]:
    from ai_workforce_api.test_sheets import OverrideBody, override_work

    sheet_id, sheet = _sheet_for(context, args.control_ref)
    item_id, version = _item_id(sheet, args.item)
    body, _queued = _sheet_change(
        context,
        sheet_id,
        override_work(
            item_id,
            OverrideBody(
                version=version,
                index=args.attribute_index,
                result=args.result,
                reason=args.reason,
            ),
        ),
    )
    return {"proposed_conclusion": body.proposed_conclusion, "blocking": body.blocking}


def _link_evidence(context: ToolContext, args: TestLinkArgs) -> dict[str, Any]:
    from ai_workforce_api.test_sheets import LinkBody, link_work

    sheet_id, sheet = _sheet_for(context, args.control_ref)
    item_id = None if args.item is None else _item_id(sheet, args.item)[0]
    link = LinkBody(
        file_id=args.evidence_file_id, item_id=item_id, action=args.action, reason=args.reason
    )
    body, queued = _sheet_change(context, sheet_id, link_work(link))
    _schedule_test(context, queued)
    return {"counts": body.counts}


def _sign_off_testing(context: ToolContext, args: TestSignOffArgs) -> dict[str, Any]:
    from ai_workforce_api.test_sheets import SignOffBody, sign_off_work

    sheet_id, sheet = _sheet_for(context, args.control_ref)
    from ai_workforce_api.workpaper_service import open_drafts, schedule_drafts

    body, _queued = _sheet_change(
        context, sheet_id, sign_off_work(SignOffBody(version=sheet.version, note=args.note))
    )
    # Signing off opens the effectiveness workpaper; the agent drafts it.
    schedule_drafts(context.drafts, open_drafts(context.connection))
    return {
        "conclusion": body.conclusion,
        "proposed_deficiency": body.proposal_status == "PROPOSED",
    }


def _decide_test_deficiency(context: ToolContext, args: TestDeficiencyArgs) -> dict[str, Any]:
    from ai_workforce_api.test_sheets import DeficiencyDecision, SheetState, decide_deficiency

    sheet_id, sheet = _sheet_for(context, args.control_ref)
    try:
        body = decide_deficiency(
            context.connection,
            context.principal,
            context.organization_id,
            context.project_id,
            sheet_id,
            DeficiencyDecision(
                version=sheet.version,
                action=args.action,
                reason=args.reason,
                severity=args.severity,
                cause=args.cause,
            ),
        )
    except SheetState as error:
        raise ToolFailed(f"The proposed deficiency could not be decided: {error.detail}.") from None
    return {"status": body.proposal_status, "deficiency": body.deficiency_reference}


def _reread(context: ToolContext, args: FileArgs) -> dict[str, Any]:
    from ai_workforce_api.evidence_analysis import VersionBody, _reanalyze, schedule_analyses

    analysis_id, version = _analysis(context, args.evidence_file_id)
    body = _reanalyze(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        analysis_id,
        VersionBody(version=version),
    )
    schedule_analyses(context.analyses, [body.id])
    return {"reading": "queued", "evidence_file_id": str(args.evidence_file_id)}


def _propose_samples(context: ToolContext, args: ProposeArgs) -> dict[str, Any]:
    from ai_workforce_api.control_tests import _propose
    from ai_workforce_api.storage import open_store

    control_id, _ref = _control(context, args.control_ref)
    file_id = args.evidence_file_id
    if file_id is None:
        row = context.connection.execute(
            """
            SELECT a.evidence_file_id FROM evidence_analyses a
            JOIN evidence_files f ON f.id = a.evidence_file_id
            JOIN pbc_requests r ON r.id = a.pbc_request_id
            WHERE a.project_id = %s AND r.engagement_control_id = %s AND a.status = 'READY'
              AND coalesce(a.confirmed_kind, a.classification->>'kind') = 'population'
              AND NOT """
            + in_force("f")
            + """
            ORDER BY f.created_at DESC LIMIT 1
            """,
            (context.project_id, control_id),
        ).fetchone()
        if row is None:
            raise ToolFailed("No population file has been received for this control yet.")
        file_id = UUID(str(row[0]))
    body = _propose(
        context.connection,
        context.principal,
        open_store(context.settings, context.connection),
        context.organization_id,
        context.project_id,
        file_id,
    )
    return {
        "status": body.status,
        "samples": len(body.samples),
        "seed": body.seed,
        "explanation": body.explanation,
        "checks": [check.model_dump() for check in body.checks],
    }


# Confirm tools


def _submit(context: ToolContext, args: RequestArgs) -> dict[str, Any]:
    from ai_workforce_api.outbound import SubmitBody
    from ai_workforce_api.outbound import _submit as submit

    # The same check as when it was proposed: things may have changed since.
    _check_submit(context, args)
    row = context.connection.execute(
        "SELECT version FROM pbc_requests WHERE id = %s AND project_id = %s",
        (args.request_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That request is not in this engagement.")
    result = submit(
        context.connection,
        context.settings,
        context.principal,
        context.organization_id,
        context.project_id,
        args.request_id,
        SubmitBody(version=int(row[0])),
    )
    return {
        "status": result.request.status,
        "approval_id": str(result.approval.id),
        "note": "An approver must approve the exact message before it can be sent.",
    }


def _send(context: ToolContext, args: RequestArgs) -> dict[str, Any]:
    from ai_workforce_api.outbound import send_request

    row = context.connection.execute(
        """
        SELECT id FROM approvals
        WHERE project_id = %s AND action_id = 'mail.pbc' AND decision = 'APPROVED'
          AND execution_status = 'NOT_STARTED' AND parameters->>'request_ref' LIKE %s
        ORDER BY created_at DESC LIMIT 1
        """,
        (context.project_id, f"pbc/{args.request_id}/%"),
    ).fetchone()
    if row is None:
        raise ToolFailed("The request has no approved message to send yet.")
    if context.timer is None:
        sent = send_request(
            context.connection,
            context.settings,
            context.principal,
            context.organization_id,
            context.project_id,
            args.request_id,
            UUID(str(row[0])),
        )
    else:
        sent = send_request(
            context.connection,
            context.settings,
            context.principal,
            context.organization_id,
            context.project_id,
            args.request_id,
            UUID(str(row[0])),
            timer=context.timer,
        )
    return {"delivery": sent.status, "request_id": str(args.request_id)}


def _decide_approval(context: ToolContext, args: ApprovalArgs) -> dict[str, Any]:
    from ai_workforce_api.approvals import ApprovalDecision
    from ai_workforce_api.approvals import _decide as decide

    body = decide(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        args.approval_id,
        ApprovalDecision(decision=args.decision, reason=args.reason),
    )
    return {"decision": body.decision}


def _test_for(context: ToolContext, control_ref: str) -> tuple[UUID, int]:
    control_id, ref = _control(context, control_ref)
    row = context.connection.execute(
        "SELECT id, version FROM control_tests "
        "WHERE project_id = %s AND engagement_control_id = %s "
        "ORDER BY (status = 'PROPOSED') DESC, created_at DESC LIMIT 1",
        (context.project_id, control_id),
    ).fetchone()
    if row is None:
        raise ToolFailed(f"{ref} has no proposed samples.")
    return UUID(str(row[0])), int(row[1])


def _approve_samples(context: ToolContext, args: ControlArgs) -> dict[str, Any]:
    from ai_workforce_api.control_tests import VersionBody, _approve

    test_id, version = _test_for(context, args.control_ref)
    body = _approve(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        test_id,
        VersionBody(version=version),
    )
    return {
        "status": body.status,
        "sample_request": body.sample_request_status,
        "note": "The sample request is a draft. It goes out after the usual approval.",
    }


def _replace_sample(context: ToolContext, args: ReplaceArgs) -> dict[str, Any]:
    from ai_workforce_api.control_tests import ReplaceBody, _replace
    from ai_workforce_api.storage import open_store

    test_id, version = _test_for(context, args.control_ref)
    body = _replace(
        context.connection,
        context.principal,
        open_store(context.settings, context.connection),
        context.organization_id,
        context.project_id,
        test_id,
        args.position,
        ReplaceBody(
            version=version,
            row_number=args.row_number,
            selection=args.selection,
            reason=args.reason,
        ),
    )
    sample = next(item for item in body.samples if item.position == args.position)
    return {"position": sample.position, "row_number": sample.row_number, "key": sample.key_value}


def _confirm_kind(context: ToolContext, args: KindArgs) -> dict[str, Any]:
    from ai_workforce_api.evidence_analysis import ConfirmBody, _confirm

    analysis_id, version = _analysis(context, args.evidence_file_id)
    body = _confirm(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        analysis_id,
        ConfirmBody(version=version, kind=args.kind, note=args.note),
    )
    return {"confirmed_kind": body.confirmed_kind}


def _sign_off(context: ToolContext, args: SignOffArgs) -> dict[str, Any]:
    from ai_workforce_api.evidence_review import DecideBody, _decide

    row = context.connection.execute(
        "SELECT id, version FROM evidence_reviews WHERE evidence_file_id = %s AND project_id = %s",
        (args.evidence_file_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That file has no screenshot review to sign off.")
    body = _decide(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        UUID(str(row[0])),
        DecideBody(
            version=int(row[1]),
            decision=args.decision,
            conclusion=args.conclusion,
            note=args.note,
        ),
    )
    return {"decision": body.decision, "conclusion": body.conclusion}


def _log_deficiency(context: ToolContext, args: DeficiencyArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import DeficiencyCreate, Severity, _create, suggested_severity

    control_id, _ref = _control(context, args.control_ref)
    body = _create(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        DeficiencyCreate(
            control_id=control_id,
            title=args.title,
            condition=args.condition,
            criteria=args.criteria,
            cause=args.cause,
            effect=args.effect,
            deficiency_type=args.deficiency_type,
            likelihood=args.likelihood,
            magnitude=args.magnitude,
            severity=cast(Severity, suggested_severity(args.likelihood, args.magnitude)),
        ),
    )
    return {"reference": body.reference, "severity": body.severity, "status": body.status}


def _update_phase(context: ToolContext, args: PhaseArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import PhaseUpdate
    from ai_workforce_api.workspace import _update_phase as update

    row = context.connection.execute(
        "SELECT version FROM engagement_phases WHERE project_id = %s AND phase_key = %s",
        (context.project_id, args.phase_key.upper()),
    ).fetchone()
    if row is None:
        raise ToolFailed(f"No phase {args.phase_key}.")
    update(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        args.phase_key.upper(),
        PhaseUpdate(
            version=int(row[0]), planned_start=args.planned_start, planned_end=args.planned_end
        ),
    )
    return {
        "phase": args.phase_key.upper(),
        "start": str(args.planned_start),
        "end": str(args.planned_end),
    }


def _update_milestone(context: ToolContext, args: MilestoneArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import MilestoneUpdate, _update_milestone

    row = context.connection.execute(
        "SELECT version FROM engagement_milestones WHERE project_id = %s AND milestone_key = %s",
        (context.project_id, args.milestone_key.upper()),
    ).fetchone()
    if row is None:
        raise ToolFailed(f"No milestone {args.milestone_key}.")
    _update_milestone(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        args.milestone_key.upper(),
        MilestoneUpdate(version=int(row[0]), due_date=args.due_date, completed=args.completed),
    )
    return {"milestone": args.milestone_key.upper(), "due": str(args.due_date)}


def _current_request(context: ToolContext, request_id: UUID) -> tuple[Any, ...]:
    row = context.connection.execute(
        """
        SELECT version, status, recipient, due_at, evidence_description, control_ref,
               attachment_refs, outbound_message_id, thread_id, follow_up_after_days,
               max_follow_ups
        FROM pbc_requests WHERE id = %s AND project_id = %s
        """,
        (request_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That request is not in this engagement.")
    found: tuple[Any, ...] = row
    return found


def _update_request(
    context: ToolContext,
    request_id: UUID,
    *,
    status: str | None = None,
    description: str | None = None,
    recipient: str | None = None,
    reason: str = "",
) -> str:
    from ai_workforce_api.pbc import PbcUpdate
    from ai_workforce_api.pbc import _update as update

    row = _current_request(context, request_id)
    body = update(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        request_id,
        PbcUpdate(
            version=int(row[0]),
            status=status or str(row[1]),
            recipient=recipient if recipient is not None else str(row[2]),
            due_at=row[3],
            evidence_description=description or str(row[4]),
            control_ref=str(row[5]),
            attachment_refs=[str(item) for item in row[6]],
            outbound_message_id=row[7],
            thread_id=row[8],
            follow_up_after_days=int(row[9]),
            max_follow_ups=int(row[10]),
            cancellation_reason=reason if status == "CANCELLED" else "",
        ),
    )
    return body.status


def _sendable(
    context: ToolContext,
    request_id: UUID,
    *,
    description: str | None = None,
    recipient: str | None = None,
    need_recipient: bool = True,
) -> None:
    """Whether the request's message could be submitted: it fits in one email and, when
    asked, goes to an allowed address. The reasons are said plainly, with what to change."""
    from ai_workforce_api.outbound import _engagement, _read_pbc, recipients_allowed, render

    pbc = _read_pbc(context.connection, context.organization_id, context.project_id, request_id)
    changes = {"evidence_description": description, "recipient": recipient}
    pbc = pbc.model_copy(update={key: value for key, value in changes.items() if value is not None})
    engagement = _engagement(context.connection, context.organization_id, context.project_id)
    ref = pbc.control_ref
    try:
        message = render(pbc, engagement)
    except ValueError:
        # How much wording fits: the email allows the rest once the template is around it.
        around = len(render(pbc.model_copy(update={"evidence_description": "x"}), engagement).body)
        limit = max(MESSAGE_CHARS - around + 1, 0)
        raise ToolFailed(
            f"The request for {ref} is too long to send: its wording is "
            f"{len(pbc.evidence_description.strip()):,} characters and can be at most "
            f"{limit:,}. Shorten the wording first."
        ) from None
    if not need_recipient and recipient is None:
        return
    if not recipients_allowed(context.settings, message):
        if message.recipient.strip() == "":
            raise ToolFailed(
                f"The request for {ref} has no recipient. Set the owner's email address first."
            )
        raise ToolFailed(
            f"The request for {ref} cannot go to {message.recipient.strip()}: the address is "
            "not valid or its domain is not allowed in this workspace."
        )


def _check_submit(context: ToolContext, args: RequestArgs) -> None:
    row = _current_request(context, args.request_id)
    if row[1] not in ("DRAFT", "APPROVAL_PENDING"):
        raise ToolFailed("That request has already gone out, so it cannot be submitted again.")
    # Checked as the request will be once the plan's earlier edits to it have run.
    planned = context.planned.get(args.request_id, {})
    _sendable(
        context,
        args.request_id,
        description=planned.get("description"),
        recipient=planned.get("recipient"),
    )


def _plan_edit(context: ToolContext, args: EditRequestArgs) -> None:
    planned = context.planned.setdefault(args.request_id, {})
    if args.description is not None:
        planned["description"] = args.description.strip()
    if args.recipient is not None:
        planned["recipient"] = args.recipient.strip()


def _check_edit(context: ToolContext, args: EditRequestArgs) -> None:
    row = _current_request(context, args.request_id)
    if row[1] != "DRAFT":
        raise ToolFailed("Only a draft can be edited. This request has gone further.")
    _sendable(
        context,
        args.request_id,
        description=None if args.description is None else args.description.strip(),
        recipient=None if args.recipient is None else args.recipient.strip(),
        need_recipient=False,
    )


def _edit_request(context: ToolContext, args: EditRequestArgs) -> dict[str, Any]:
    _check_edit(context, args)
    _update_request(
        context,
        args.request_id,
        description=None if args.description is None else args.description.strip(),
        recipient=None if args.recipient is None else args.recipient.strip(),
    )
    return {
        "request_id": str(args.request_id),
        "status": "DRAFT",
        "reworded": args.description is not None,
        "recipient": args.recipient,
    }


def _export_summary(args: ExportArgs) -> str:
    names = {
        "evidence_requests": "evidence requests",
        "controls": "controls",
        "exceptions": "exceptions",
        "review_items": "open review items",
    }
    kind = "Excel" if args.file_format == "xlsx" else "CSV"
    return f"Exported {names[args.dataset]} to {kind}"


def _edit_summary(args: EditRequestArgs) -> str:
    if args.description is not None and args.recipient is not None:
        return f"Reword the drafted request and send it to {args.recipient.strip()}"
    if args.recipient is not None:
        return f"Send the drafted request to {args.recipient.strip()}"
    return "Reword the drafted request"


def _draft_request(context: ToolContext, args: DraftRequestArgs) -> dict[str, Any]:
    from datetime import UTC, datetime, time, timedelta

    from ai_workforce_api.pbc import PbcCreate
    from ai_workforce_api.pbc import _create as create

    control_id, ref = _control(context, args.control_ref)
    latest = context.connection.execute(
        """
        SELECT recipient, owner_user_id, control_ref FROM pbc_requests
        WHERE project_id = %s AND engagement_control_id = %s
        ORDER BY created_at DESC LIMIT 1
        """,
        (context.project_id, control_id),
    ).fetchone()
    recipient = args.recipient or (None if latest is None else str(latest[0]))
    if recipient is None:
        raise ToolFailed(f"Name a recipient: {ref} has no earlier request to take one from.")
    due = args.due_date or (datetime.now(UTC).date() + timedelta(days=7))
    body = create(
        context.connection,
        context.principal,
        context.organization_id,
        context.project_id,
        PbcCreate(
            operation_key=f"console-{uuid4().hex}",
            control_ref=str(latest[2]) if latest is not None else ref,
            recipient=recipient,
            due_at=datetime.combine(due, time(23, 59), tzinfo=UTC),
            evidence_description=args.description.strip(),
            owner_user_id=None if latest is None else latest[1],
        ),
    )
    context.connection.execute(
        "UPDATE pbc_requests SET engagement_control_id = %s, testing_phase = %s WHERE id = %s",
        (control_id, args.phase, body.id),
    )
    return {"request_id": str(body.id), "status": body.status, "recipient": recipient}


def _request_status(context: ToolContext, args: RequestStatusArgs) -> dict[str, Any]:
    if args.status == "CANCELLED" and len(args.reason.strip()) < 3:
        raise ToolFailed("A cancellation needs a reason.")
    row = _current_request(context, args.request_id)
    # A sent request is waiting for its reply before anything can be received.
    if row[1] == "SENT" and args.status in ("PARTIALLY_RECEIVED", "RECEIVED"):
        _update_request(context, args.request_id, status="WAITING_FOR_RESPONSE")
    status = _update_request(
        context, args.request_id, status=args.status, reason=args.reason.strip()
    )
    return {"request_id": str(args.request_id), "status": status}


# The registry


def _short(text: str, limit: int = 80) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


TOOLS: tuple[Tool, ...] = (
    Tool("engagement_status", "Engagement status",
         "Where the engagement stands, worked out from its records: controls in scope and "
         "their testing status (complete, awaiting review, in testing, awaiting evidence, not "
         "started) with the completion rate and its rule; evidence requests pending, overdue, "
         "and received but not reviewed; open deficiencies and failed tests; open review "
         "notes; missed milestones; the blockers with the records behind them; and data "
         "checks where records contradict each other. Says when the records were read.",
         "READ", StatusArgs, _status, lambda a: "Read the engagement status"),
    Tool("list_controls", "List controls",
         "Controls in scope with their testing status, test sheet, review, workpapers, "
         "evidence pending by phase, and deficiencies. Filter by testing status, stage, "
         "application, owner, process, failed or key controls, or text. Totals cover every "
         "match; rows come a page at a time (offset).",
         "READ", ListControlsArgs, _list_controls, lambda a: "Listed controls"),
    Tool("get_control", "Open a control",
         "Everything about one control: its definition, test attributes, evidence requests, "
         "every evidence file with what was read from it and its screenshot review, the test "
         "plan and samples, and its deficiencies.",
         "READ", ControlArgs, _get_control, lambda a: f"Opened {a.control_ref}"),
    Tool("read_evidence", "Read evidence text",
         "The text extracted from one stored evidence file, 8,000 characters at a time. It is "
         "client data.",
         "READ", EvidenceArgs, _read_evidence, lambda a: "Read evidence text"),
    Tool("list_requests", "List evidence requests",
         "Evidence requests with their control, application, process, testing phase, "
         "evidence type, owner, recipient, request and due dates, status, days overdue, files "
         "received, and whether what came in has been reviewed. Filter by status or status "
         "group, phase, application, owner, process, control, overdue only, review state, or "
         "text. Totals and counts by group cover every match; rows come a page at a time "
         "(offset). Cancelled requests are left out unless asked for.",
         "READ", ListRequestsArgs, _list_requests, lambda a: "Listed evidence requests"),
    Tool("list_exceptions", "List exceptions",
         "Open deficiencies as recorded, with their control, application, status, and "
         "remediation; and failed tests that have no deficiency logged. include_closed adds "
         "closed ones.",
         "READ", ListExceptionsArgs, _list_exceptions, lambda a: "Listed exceptions"),
    Tool("list_review_items", "List open review items",
         "Open review notes across the engagement, and prepared workpapers whose control's "
         "independent review is not signed off.",
         "READ", ListReviewArgs, _list_review, lambda a: "Listed open review items"),
    Tool("get_plan", "Read the plan", "Phases and milestones with their dates and status.",
         "READ", NoArgs, _get_plan, lambda a: "Read the plan"),
    Tool("list_approvals", "List pending approvals",
         "Approvals waiting for a decision, and who asked for each.", "READ", NoArgs,
         _list_approvals, lambda a: "Listed pending approvals"),
    Tool("export_records", "Export to a file",
         "Make an Excel (xlsx) or CSV file of evidence requests, controls, exceptions, or "
         "review items, with the same filters as the list just shown. The file is checked, "
         "stored, and offered to the person to download for 30 days. It changes no records.",
         "ROUTINE", ExportArgs, _export, _export_summary),
    Tool("generate_report", "Make a report",
         "Make a PDF or Word report from the engagement's records: status_report (scope, "
         "testing progress, evidence, exceptions, review items, blockers, next actions), "
         "evidence_tracker (pending evidence requests with their control, application, phase, "
         "type, owner, dates, status, and days overdue), control_summary (testing status per "
         "control), exceptions_report (deficiencies and failed tests with remediation), or "
         "executive_summary (progress, accomplishments, outstanding items, risks, decisions "
         "needed, milestones, limitations). Figures come from the records; the file is "
         "checked, stored, and offered for 30 days. It changes no records.",
         "ROUTINE", ReportArgs, _report, _report_summary),
    Tool("redraft_request", "Redraft a request",
         "Ask the evidence coordinator to draft a request again from its control. Only a "
         "draft can be redrafted.",
         "ROUTINE", RequestArgs, _redraft, lambda a: "Redraft the evidence request"),
    Tool("reread_evidence", "Read a file again",
         "Ask the evidence coordinator to read and classify a stored file again.",
         "ROUTINE", FileArgs, _reread, lambda a: "Read the file again"),
    Tool("propose_samples", "Propose samples",
         "Check a control's population and draw a seeded random sample (or draw again with a "
         "new seed), for a person to approve.",
         "ROUTINE", ProposeArgs, _propose_samples,
         lambda a: f"Propose samples for {a.control_ref}"),
    Tool("submit_request", "Submit for approval",
         "Submit a drafted evidence request for an approver to check the exact message.",
         "CONFIRM", RequestArgs, _submit, lambda a: "Submit the evidence request for approval",
         _check_submit),
    Tool("send_request", "Send a request",
         "Send an evidence request whose message an approver has approved.",
         "CONFIRM", RequestArgs, _send, lambda a: "Send the approved evidence request"),
    Tool("decide_approval", "Decide an approval",
         "Approve or reject a pending approval as the signed-in person. Nobody can approve "
         "their own request.",
         "CONFIRM", ApprovalArgs, _decide_approval,
         lambda a: f"{'Approve' if a.decision == 'APPROVED' else 'Reject'}: {_short(a.reason)}"),
    Tool("approve_samples", "Approve samples",
         "Approve a control's proposed samples. This drafts the sample evidence request.",
         "CONFIRM", ControlArgs, _approve_samples,
         lambda a: f"Approve the samples for {a.control_ref}"),
    Tool("replace_sample", "Replace a sample",
         "Replace one selected sample with another population row, with a reason.",
         "CONFIRM", ReplaceArgs, _replace_sample,
         lambda a: f"Replace sample {a.position} of {a.control_ref} with row {a.row_number}: "
         f"{_short(a.reason, 60)}"),
    Tool("confirm_evidence_kind", "Confirm evidence kind",
         "Confirm what kind of evidence a stored file is.", "CONFIRM", KindArgs, _confirm_kind,
         lambda a: f"Confirm the file as {a.kind.replace('_', ' ')}"),
    Tool("sign_off_review", "Sign off a screenshot review",
         "Accept the agent's proposed conclusion on a screenshot, or override it with a "
         "conclusion and a reason.",
         "CONFIRM", SignOffArgs, _sign_off,
         lambda a: "Accept the screenshot review"
         if a.decision == "ACCEPTED"
         else f"Override the screenshot review: {_short(a.note, 60)}"),
    Tool("draft_workpapers", "Draft workpapers",
         "Open a control's design and effectiveness workpapers, filled from the records, and "
         "have the agent draft their narratives with citations. Sections a person wrote stay.",
         "ROUTINE", ControlArgs, _draft_workpapers,
         lambda a: f"Draft workpapers for {a.control_ref}"),
    Tool("retest_control", "Test again",
         "Ask the control's tester to place its evidence and test every item again.",
         "ROUTINE", ControlArgs, _retest, lambda a: f"Test {a.control_ref} again"),
    Tool("override_test_result", "Set a test result",
         "Set one result on a control's test sheet (pass, exception, unable, not applicable) "
         "with the reason, for example after checking the evidence.",
         "CONFIRM", TestResultArgs, _override_result,
         lambda a: f"Set {a.control_ref} {a.item}, attribute {a.attribute_index + 1}, to "
         f"{a.result.replace('_', ' ').lower()}: {_short(a.reason, 50)}"),
    Tool("link_test_evidence", "Link test evidence",
         "Put an evidence file on a sample of a control's test sheet, take it off, or set it "
         "aside as not test evidence.",
         "CONFIRM", TestLinkArgs, _link_evidence,
         lambda a: f"{a.action.capitalize()} a file on {a.control_ref}"
         + (f" {a.item}" if a.item else "")),
    Tool("sign_off_testing", "Sign off testing",
         "Sign off a control's test sheet. The conclusion follows the results, with zero "
         "tolerance; exceptions draft a deficiency.",
         "CONFIRM", TestSignOffArgs, _sign_off_testing,
         lambda a: f"Sign off the testing of {a.control_ref}"),
    Tool("decide_test_deficiency", "Log or dismiss a proposed deficiency",
         "Log the deficiency the tester drafted from a control's exceptions, or dismiss it with "
         "a reason.",
         "CONFIRM", TestDeficiencyArgs, _decide_test_deficiency,
         lambda a: f"{'Log' if a.action == 'LOG' else 'Dismiss'} the proposed deficiency on "
         f"{a.control_ref}"),
    Tool("log_deficiency", "Log a deficiency",
         "Log a deficiency on a control. Severity follows likelihood and magnitude; a "
         "significant deficiency or material weakness still needs the reviewer.",
         "CONFIRM", DeficiencyArgs, _log_deficiency,
         lambda a: f"Log a deficiency on {a.control_ref}: {_short(a.title, 60)}"),
    Tool("edit_request", "Edit a draft request",
         "Change a drafted evidence request: replace its wording (for example to add "
         "questions for the owner, or to shorten it to fit one email), set the email address "
         "it goes to, or both. Only a draft can be edited.",
         "CONFIRM", EditRequestArgs, _edit_request, _edit_summary, _check_edit, _plan_edit),
    Tool("draft_request", "Draft a new request",
         "Draft a new evidence request or follow-up to a control's owner. It is saved as a "
         "draft and goes out only after the usual approval.",
         "CONFIRM", DraftRequestArgs, _draft_request,
         lambda a: f"Draft a new request for {a.control_ref}: {_short(a.description, 70)}"),
    Tool("update_request_status", "Update a request's status",
         "Mark a request partly received, received, or closed, or cancel it with a reason.",
         "CONFIRM", RequestStatusArgs, _request_status,
         lambda a: f"Mark the request {a.status.replace('_', ' ').lower()}"),
    Tool("get_review", "Open a control's independent review",
         "The control's independent review: the reviewer agent's re-performance, every review "
         "note with its status, what blocks sign-off, and whether you are its reviewer.",
         "READ", ControlArgs, _get_review, lambda a: f"Opened the review of {a.control_ref}"),
    Tool("reperform_review", "Re-perform the review",
         "Ask the independent reviewer agent to re-perform a control's testing again and "
         "propose notes.",
         "ROUTINE", ControlArgs, _reperform_review,
         lambda a: f"Re-perform the review of {a.control_ref}"),
    Tool("decide_review_note", "Accept or dismiss a proposed review note",
         "Accept a note the reviewer agent proposed (a must-fix note reopens the work it is "
         "about) or dismiss it with a reason. Only the engagement reviewer can.",
         "CONFIRM", ReviewNoteArgs, _decide_review_note,
         lambda a: f"{'Accept' if a.action == 'ACCEPT' else 'Dismiss'} review note #{a.note} on "
         f"{a.control_ref}"),
    Tool("raise_review_note", "Raise a review note",
         "Raise a review note on a control's testing, sample, workpaper, or deficiency. A "
         "must-fix note reopens the work it is about. Only the engagement reviewer can.",
         "CONFIRM", RaiseNoteArgs, _raise_review_note,
         lambda a: f"Raise a {a.severity.replace('_', ' ').lower()} note on {a.control_ref}: "
         f"{_short(a.text, 60)}"),
    Tool("respond_review_note", "Answer a review note",
         "Answer an open review note as the preparer, saying what was done about it.",
         "CONFIRM", RespondNoteArgs, _respond_review_note,
         lambda a: f"Answer review note #{a.note} on {a.control_ref}"),
    Tool("clear_review_note", "Clear or return a review note",
         "Clear an answered review note, or return it with what is still missing. Only the "
         "engagement reviewer can.",
         "CONFIRM", ClearNoteArgs, _clear_review_note,
         lambda a: f"{'Clear' if a.action == 'CLEAR' else 'Return'} review note #{a.note} on "
         f"{a.control_ref}"),
    Tool("sign_off_control_review", "Sign off a control review",
         "Sign off a control's independent review once every note is cleared. Only the "
         "engagement reviewer can, and never on work they prepared.",
         "CONFIRM", ReviewSignOffArgs, _sign_off_review,
         lambda a: f"Sign off the review of {a.control_ref}"),
    Tool("update_phase", "Change phase dates", "Change a phase's planned dates.",
         "CONFIRM", PhaseArgs, _update_phase,
         lambda a: f"Move {a.phase_key} to {a.planned_start} – {a.planned_end}"),
    Tool("update_milestone", "Change a milestone", "Re-date a milestone or mark it done.",
         "CONFIRM", MilestoneArgs, _update_milestone,
         lambda a: f"{'Complete' if a.completed else 'Re-date'} {a.milestone_key} ({a.due_date})"),
)  # fmt: skip
BY_NAME = {tool.name: tool for tool in TOOLS}


def describe(tool: Tool, arguments: BaseModel, context: ToolContext) -> str:
    """The step's summary, naming the control and file it touches."""
    summary = tool.summary(arguments)
    request_id = getattr(arguments, "request_id", None)
    file_id = getattr(arguments, "evidence_file_id", None)
    if request_id is not None:
        row = context.connection.execute(
            "SELECT control_ref, left(evidence_description, 80) FROM pbc_requests "
            "WHERE id = %s AND project_id = %s",
            (request_id, context.project_id),
        ).fetchone()
        if row is not None:
            first = str(row[1]).splitlines()[0].lstrip("- ").strip() if row[1] else ""
            summary = f"{summary}: {row[0]}" + (f" ({_short(first, 60)})" if first else "")
    elif file_id is not None:
        row = context.connection.execute(
            "SELECT file_name FROM evidence_files WHERE id = %s AND project_id = %s",
            (file_id, context.project_id),
        ).fetchone()
        if row is not None:
            summary = f"{summary}: {row[0]}"
    return summary[:500]


def parse(name: str, arguments: dict[str, Any]) -> tuple[Tool, BaseModel]:
    """The registered tool and its checked arguments. Anything else is refused."""
    tool = BY_NAME.get(name)
    if tool is None:
        raise ToolFailed(f"There is no tool called {name}.")
    try:
        return tool, tool.arguments.model_validate(arguments)
    except ValidationError as error:
        first = error.errors()[0]
        field = ".".join(str(part) for part in first.get("loc", ()))
        raise ToolFailed(f"The arguments for {name} are not valid ({field}).") from None


def execute(tool: Tool, arguments: BaseModel, context: ToolContext) -> dict[str, Any]:
    """Run one tool. Failures become a message, never a crash or a leaked detail."""
    try:
        return tool.run(context, arguments)
    except ToolFailed:
        raise
    except Exception as error:
        raise _failed(tool, error) from None


def check(tool: Tool, arguments: BaseModel, context: ToolContext) -> None:
    """Whether a step could run as things stand, before it is proposed. A step that would
    fail is refused with its reason, so the agent explains instead of offering it."""
    if tool.check is None:
        return
    try:
        tool.check(context, arguments)
    except ToolFailed:
        raise
    except Exception as error:
        raise _failed(tool, error) from None


def planned(tool: Tool, arguments: BaseModel, context: ToolContext) -> None:
    """Remember what a proposed step will change, for the checks of the steps after it."""
    if tool.plans is not None:
        tool.plans(context, arguments)


def _failed(tool: Tool, error: Exception) -> ToolFailed:
    """A failure as words the person and the model can act on, never a leaked detail."""
    if isinstance(error, NotVisible):
        return ToolFailed("That is not in this engagement, or you cannot see it.")
    detail = getattr(error, "detail", None)
    if not isinstance(detail, str) and isinstance(error, ValueError):
        # A service's own short reason, never a validation dump with the values in it.
        if not isinstance(error, ValidationError) and "\n" not in str(error):
            detail = str(error)
    if isinstance(detail, str) and 0 < len(detail) < 200:
        return ToolFailed(detail[0].upper() + detail[1:].rstrip(".") + ".")
    name = type(error).__name__
    if name == "AccessDenied":
        return ToolFailed("Your role does not allow this.")
    logger.warning("console tool %s failed with %s", tool.name, name)
    return ToolFailed("That could not be done. Check its current state and try again.")


def result_text(result: dict[str, Any]) -> str:
    text = json.dumps(result, default=str, ensure_ascii=False)
    return text if len(text) <= RESULT_CHARS else text[:RESULT_CHARS] + "…(cut)"
