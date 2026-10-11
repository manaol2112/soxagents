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
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal, cast
from uuid import UUID, uuid4

import psycopg
from pydantic import BaseModel, Field, ValidationError

from ai_workforce_api.authorization import NotVisible, Principal
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
    control_ref: str = Field(min_length=1, max_length=60, description="The control ID.")


class ListControlsArgs(BaseModel):
    queue: Literal["team", "owner", "overdue", "findings", "concluded"] | None = Field(
        default=None, description="team = waiting on the audit team."
    )
    area: str | None = Field(default=None, max_length=100)
    application: str | None = Field(default=None, max_length=100)
    search: str | None = Field(default=None, max_length=100)


class EvidenceArgs(BaseModel):
    evidence_file_id: UUID
    offset: int = Field(default=0, ge=0, le=200_000)


class RequestArgs(BaseModel):
    request_id: UUID


class ListRequestsArgs(BaseModel):
    status: str | None = Field(default=None, max_length=40)
    control_ref: str | None = Field(default=None, max_length=60)


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
    description: str = Field(
        min_length=10,
        max_length=4000,
        description="The full new wording of what the owner is asked for.",
    )


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


class RequestStatusArgs(BaseModel):
    request_id: UUID
    status: Literal["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]
    reason: str = Field(default="", max_length=500, description="Needed to cancel.")


class MilestoneArgs(BaseModel):
    milestone_key: str = Field(min_length=1, max_length=40)
    due_date: date
    completed: bool


# Lookups


def _control(context: ToolContext, control_ref: str) -> tuple[UUID, str]:
    row = context.connection.execute(
        """
        SELECT id, control_ref FROM engagement_controls
        WHERE project_id = %s AND lower(control_ref) = lower(%s)
        """,
        (context.project_id, control_ref.strip()),
    ).fetchone()
    if row is None:
        raise ToolFailed(f"No control {control_ref} in this engagement.")
    return UUID(str(row[0])), str(row[1])


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


def _summary(context: ToolContext, _args: NoArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import _dashboard

    body = _dashboard(
        context.connection, context.principal, context.organization_id, context.project_id
    )
    data = _dump(body)
    return {key: data[key] for key in data if key not in {"work"}}


def _list_controls(context: ToolContext, args: ListControlsArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import _controls

    rows = _controls(
        context.connection, context.principal, context.organization_id, context.project_id
    )
    found = []
    for row in rows:
        if not row.included:
            continue
        if args.queue == "team" and row.waiting_on != "TEAM":
            continue
        if args.queue == "owner" and row.waiting_on != "OWNER":
            continue
        if args.queue == "overdue" and not row.overdue:
            continue
        if args.queue == "findings" and row.deficiencies == 0:
            continue
        if args.queue == "concluded" and row.conclusion == "NOT_CONCLUDED":
            continue
        if args.area and args.area.lower() not in row.area.lower():
            continue
        if args.application and not any(
            args.application.lower() in system.lower() for system in row.systems
        ):
            continue
        text = " ".join([row.control_ref, row.title, row.owner_name, *row.systems]).lower()
        if args.search and args.search.lower() not in text:
            continue
        found.append(
            {
                "control_ref": row.control_ref,
                "title": row.title,
                "area": row.area,
                "applications": row.systems,
                "owner": row.owner_name or row.owner_email or "PBC coordinator",
                "stage": row.stage,
                "next_step": row.next_step,
                "waiting_on": row.waiting_on,
                "overdue": row.overdue,
                "evidence": f"{row.evidence_received}/{row.evidence_requests} received",
                "open_deficiencies": row.deficiencies,
                "conclusion": row.conclusion,
            }
        )
    return {"count": len(found), "controls": found[:100]}


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
        SELECT f.id, f.file_name, f.created_at, i.pbc_request_id,
               a.status, a.extraction, a.extraction_status, a.ocr_engine, a.classification,
               a.confirmed_kind, a.note, char_length(a.extracted_text),
               v.status, v.checks, v.attributes, v.proposed, v.feedback, v.decision,
               v.conclusion
        FROM evidence_files f
        JOIN mailbox_attachments m ON m.id = f.mailbox_attachment_id
        JOIN inbound_messages i
          ON i.mailbox_message_id = m.message_id AND i.project_id = m.project_id
        JOIN pbc_requests r ON r.id = i.pbc_request_id
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        LEFT JOIN evidence_reviews v ON v.evidence_file_id = f.id
        WHERE f.project_id = %s AND r.engagement_control_id = %s
        ORDER BY f.created_at
        """,
        (context.project_id, control_id),
    ).fetchall()
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
        "evidence_files": [
            {
                "evidence_file_id": str(item[0]),
                "file_name": item[1],
                "received": item[2].date().isoformat(),
                "request_id": None if item[3] is None else str(item[3]),
                "reading": None
                if item[4] is None
                else {
                    "status": item[4],
                    "read_as": item[5],
                    "read_status": item[6],
                    "ocr_engine": item[7],
                    "classification": item[8],
                    "confirmed_kind": item[9],
                    "note": item[10],
                    "text_characters": item[11],
                },
                "screenshot_review": None
                if item[12] is None
                else {
                    "status": item[12],
                    "checks": item[13],
                    "attributes": item[14],
                    "proposed": item[15],
                    "feedback": item[16],
                    "signed_off": item[17],
                    "conclusion": item[18],
                },
            }
            for item in files
        ],
        "test_plan": tests[0] if tests else None,
        "deficiencies": findings,
    }


def _read_evidence(context: ToolContext, args: EvidenceArgs) -> dict[str, Any]:
    row = context.connection.execute(
        """
        SELECT f.file_name, a.extracted_text, a.text_truncated, a.content_redacted
        FROM evidence_files f JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE f.id = %s AND f.project_id = %s
        """,
        (args.evidence_file_id, context.project_id),
    ).fetchone()
    if row is None:
        raise ToolFailed("That file is not in this engagement or has not been read.")
    text = str(row[1])
    chunk = text[args.offset : args.offset + EVIDENCE_CHARS]
    return {
        "file_name": row[0],
        "offset": args.offset,
        "total_characters": len(text),
        "more": args.offset + EVIDENCE_CHARS < len(text),
        "redacted": bool(row[3]),
        "file_was_cut": bool(row[2]),
        "text": f"<client_evidence>\n{chunk}\n</client_evidence>",
    }


def _list_requests(context: ToolContext, args: ListRequestsArgs) -> dict[str, Any]:
    rows = context.connection.execute(
        """
        SELECT r.id, r.control_ref, r.status, r.recipient, r.due_at,
               left(r.evidence_description, 160), r.operation_key
        FROM pbc_requests r
        WHERE r.project_id = %s
          AND (%s::text IS NULL OR r.status = %s::text)
          AND (%s::text IS NULL OR lower(r.control_ref) = lower(%s::text))
        ORDER BY r.control_ref, r.created_at
        LIMIT 200
        """,
        (
            context.project_id,
            args.status,
            args.status,
            args.control_ref,
            args.control_ref,
        ),
    ).fetchall()
    return {
        "count": len(rows),
        "requests": [
            {
                "request_id": str(row[0]),
                "control_ref": row[1],
                "status": row[2],
                "recipient": row[3],
                "due": row[4].date().isoformat(),
                "first_line": str(row[5]).split("\n")[0].lstrip("- "),
                "kind": "samples"
                if str(row[6]).startswith("samples-")
                else "follow_up"
                if str(row[6]).startswith("recapture-")
                else "evidence",
            }
            for row in rows
        ],
    }


def _list_deficiencies(context: ToolContext, _args: NoArgs) -> dict[str, Any]:
    from ai_workforce_api.workspace import _deficiencies

    items = _deficiencies(
        context.connection, context.principal, context.organization_id, context.project_id
    )
    return {
        "count": len(items),
        "deficiencies": [
            {
                "reference": item.reference,
                "control_ref": item.control_ref,
                "title": item.title,
                "severity": item.severity,
                "status": item.status,
                "pending_change": item.pending_change,
            }
            for item in items
        ],
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
        "WHERE project_id = %s AND engagement_control_id = %s",
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
            recipient=str(row[2]),
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


def _edit_request(context: ToolContext, args: EditRequestArgs) -> dict[str, Any]:
    row = _current_request(context, args.request_id)
    if row[1] != "DRAFT":
        raise ToolFailed("Only a draft can be reworded. This request has gone further.")
    _update_request(context, args.request_id, description=args.description.strip())
    return {"request_id": str(args.request_id), "status": "DRAFT", "reworded": True}


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
        "UPDATE pbc_requests SET engagement_control_id = %s WHERE id = %s",
        (control_id, body.id),
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
    Tool("engagement_summary", "Engagement summary",
         "Headline status: controls in scope and concluded, evidence, deficiencies, schedule.",
         "READ", NoArgs, _summary, lambda a: "Read the engagement summary"),
    Tool("list_controls", "List controls",
         "Controls with their stage, next step, who they wait on, evidence, and findings. "
         "Filter by queue, area, application, or text.",
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
         "Evidence requests with their status, recipient, and due date. Filter by status "
         "(DRAFT, APPROVAL_PENDING, SENT, WAITING_FOR_RESPONSE, PARTIALLY_RECEIVED, RECEIVED, "
         "OVERDUE) or control.",
         "READ", ListRequestsArgs, _list_requests, lambda a: "Listed evidence requests"),
    Tool("list_deficiencies", "List deficiencies",
         "The deficiency register.", "READ", NoArgs, _list_deficiencies,
         lambda a: "Listed deficiencies"),
    Tool("get_plan", "Read the plan", "Phases and milestones with their dates and status.",
         "READ", NoArgs, _get_plan, lambda a: "Read the plan"),
    Tool("list_approvals", "List pending approvals",
         "Approvals waiting for a decision, and who asked for each.", "READ", NoArgs,
         _list_approvals, lambda a: "Listed pending approvals"),
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
         "CONFIRM", RequestArgs, _submit, lambda a: "Submit the evidence request for approval"),
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
    Tool("log_deficiency", "Log a deficiency",
         "Log a deficiency on a control. Severity follows likelihood and magnitude; a "
         "significant deficiency or material weakness still needs the reviewer.",
         "CONFIRM", DeficiencyArgs, _log_deficiency,
         lambda a: f"Log a deficiency on {a.control_ref}: {_short(a.title, 60)}"),
    Tool("edit_request", "Reword a draft request",
         "Replace the wording of a drafted evidence request, for example to add questions "
         "for the owner. Only a draft can be reworded.",
         "CONFIRM", EditRequestArgs, _edit_request, lambda a: "Reword the drafted request"),
    Tool("draft_request", "Draft a new request",
         "Draft a new evidence request or follow-up to a control's owner. It is saved as a "
         "draft and goes out only after the usual approval.",
         "CONFIRM", DraftRequestArgs, _draft_request,
         lambda a: f"Draft a new request for {a.control_ref}: {_short(a.description, 70)}"),
    Tool("update_request_status", "Update a request's status",
         "Mark a request partly received, received, or closed, or cancel it with a reason.",
         "CONFIRM", RequestStatusArgs, _request_status,
         lambda a: f"Mark the request {a.status.replace('_', ' ').lower()}"),
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
    except NotVisible:
        raise ToolFailed("That is not in this engagement, or you cannot see it.") from None
    except Exception as error:
        detail = getattr(error, "detail", None)
        if isinstance(detail, str) and len(detail) < 200:
            raise ToolFailed(detail[0].upper() + detail[1:] + ".") from None
        name = type(error).__name__
        if name == "AccessDenied":
            raise ToolFailed("Your role does not allow this.") from None
        logger.warning("console tool %s failed with %s", tool.name, name)
        raise ToolFailed("That could not be done. Check its current state and try again.") from None


def result_text(result: dict[str, Any]) -> str:
    text = json.dumps(result, default=str, ensure_ascii=False)
    return text if len(text) <= RESULT_CHARS else text[:RESULT_CHARS] + "…(cut)"
