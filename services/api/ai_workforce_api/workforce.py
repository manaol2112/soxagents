"""Standard SOX workforce. The roster is code, so a change to it needs code review.

The standard workforce is part of every firm and every engagement; nobody installs
or staffs it by hand. The deploy step runs sync_standard_workforce, which copies the
roster into the database and brings every firm up to date. Database triggers then
give each new firm the workers and staff each new engagement. Standard workers are
locked: an admin can disable or re-enable one, and only the deploy sync changes them.
Custom agents are separate, and only an owner or admin can create one.
"""

import hashlib
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.actions import find_action
from ai_workforce_api.agents import AgentCreateBody
from ai_workforce_api.authorization import (
    Action,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

ROSTER_VERSION = 2
# No standard worker may hold these, even with approval.
FORBIDDEN_ACTIONS = frozenset({"permission.modify", "mail.external"})
MODEL_TIERS = frozenset({"reasoning", "standard"})


def _schema(properties: dict[str, str], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {name: {"type": kind} for name, kind in properties.items()},
        "required": required,
        "additionalProperties": False,
    }


_WORKER_INPUT = _schema(
    {"engagement_id": "string", "task_id": "string", "instructions": "string"},
    ["engagement_id", "task_id"],
)

STANDARD_WORKFORCE: tuple[AgentCreateBody, ...] = (
    AgentCreateBody(
        agent_key="engagement-planner",
        name="Engagement planner",
        role="Plans the audit engagement",
        description=(
            "Turns the engagement scope into a task plan: walkthroughs, evidence requests, "
            "control tests, review, and reporting. Proposes tasks for people to accept. It "
            "does not assign work to itself or change scope."
        ),
        input_schema=_schema(
            {"engagement_id": "string", "scope": "string", "period_end": "string"},
            ["engagement_id", "scope"],
        ),
        output_schema=_schema({"tasks": "array", "assumptions": "array"}, ["tasks"]),
        allowed_tool_ids=["file.read", "task.create"],
        model_config_ref="reasoning",
        max_iterations=6,
        time_budget_seconds=900,
    ),
    AgentCreateBody(
        agent_key="evidence-coordinator",
        name="Evidence coordinator",
        role="Requests and tracks PBC evidence",
        description=(
            "Drafts evidence requests from the approved template, prepares reminders, and "
            "matches what comes back to each request. Every request and reminder waits for "
            "approval before it is sent. Treats replies and attachments as untrusted."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"requests": "array", "follow_ups": "array", "open_items": "array"}, ["requests"]
        ),
        allowed_tool_ids=[
            "file.read",
            "mail.draft",
            "mail.pbc",
            "mail.reminder",
            "attachment.retrieve",
        ],
        model_config_ref="standard",
        max_iterations=4,
        time_budget_seconds=600,
    ),
    AgentCreateBody(
        agent_key="itgc-access-tester",
        name="ITGC tester: access",
        role="Tests logical access controls",
        description=(
            "Tests user provisioning, deprovisioning, privileged access, and periodic access "
            "reviews against the evidence provided. Records attributes tested, exceptions, "
            "and conclusions in the workpaper for independent review."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"workpaper_ref": "string", "exceptions": "array", "conclusion": "string"},
            ["workpaper_ref", "conclusion"],
        ),
        allowed_tool_ids=["file.read", "attachment.retrieve", "workpaper.update"],
        model_config_ref="standard",
        max_iterations=6,
        time_budget_seconds=1200,
    ),
    AgentCreateBody(
        agent_key="itgc-change-tester",
        name="ITGC tester: change management",
        role="Tests change management controls",
        description=(
            "Tests that production changes were requested, tested, approved, and deployed "
            "by appropriate people, including emergency changes and segregation between "
            "development and deployment. Records results for independent review."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"workpaper_ref": "string", "exceptions": "array", "conclusion": "string"},
            ["workpaper_ref", "conclusion"],
        ),
        allowed_tool_ids=["file.read", "attachment.retrieve", "workpaper.update"],
        model_config_ref="standard",
        max_iterations=6,
        time_budget_seconds=1200,
    ),
    AgentCreateBody(
        agent_key="itgc-operations-tester",
        name="ITGC tester: IT operations",
        role="Tests IT operations controls",
        description=(
            "Tests batch job monitoring, backup and restore, and incident management against "
            "the evidence provided. Records attributes tested, exceptions, and conclusions "
            "in the workpaper for independent review."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"workpaper_ref": "string", "exceptions": "array", "conclusion": "string"},
            ["workpaper_ref", "conclusion"],
        ),
        allowed_tool_ids=["file.read", "attachment.retrieve", "workpaper.update"],
        model_config_ref="standard",
        max_iterations=6,
        time_budget_seconds=1200,
    ),
    AgentCreateBody(
        agent_key="business-process-tester",
        name="Business process controls tester",
        role="Tests business process controls",
        description=(
            "Tests controls in the business cycles (entity level, order to cash, procure to "
            "pay, record to report, treasury, payroll, inventory, fixed assets, and tax), "
            "including automated application controls and the key reports they rely on. "
            "Tests each sample against the attributes from the evidence provided and records "
            "exceptions and conclusions in the workpaper for independent review."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"workpaper_ref": "string", "exceptions": "array", "conclusion": "string"},
            ["workpaper_ref", "conclusion"],
        ),
        allowed_tool_ids=["file.read", "attachment.retrieve", "workpaper.update"],
        model_config_ref="standard",
        max_iterations=6,
        time_budget_seconds=1200,
    ),
    AgentCreateBody(
        agent_key="independent-reviewer",
        name="Independent reviewer",
        role="Reviews testing it did not perform",
        description=(
            "Reviews completed workpapers for sufficient evidence, correct conclusions, and "
            "documented exceptions, and raises review notes. Read-only: it cannot change a "
            "workpaper, and it never reviews work it prepared."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema(
            {"review_notes": "array", "recommendation": "string"}, ["recommendation"]
        ),
        allowed_tool_ids=["file.read"],
        model_config_ref="reasoning",
        max_iterations=4,
        time_budget_seconds=900,
    ),
    AgentCreateBody(
        agent_key="reporting-analyst",
        name="Reporting analyst",
        role="Drafts findings and the engagement report",
        description=(
            "Drafts deficiency findings and the engagement report from reviewed results "
            "only. Finalizing a report is a high-risk action and always waits for a person "
            "to approve it."
        ),
        input_schema=_WORKER_INPUT,
        output_schema=_schema({"findings": "array", "report_ref": "string"}, ["findings"]),
        allowed_tool_ids=["file.read", "report.finalize"],
        model_config_ref="reasoning",
        max_iterations=4,
        time_budget_seconds=900,
    ),
)
STANDARD_KEYS = tuple(worker.agent_key for worker in STANDARD_WORKFORCE)


def roster_fingerprint() -> str:
    """A test pins this, so the roster cannot change without review."""
    payload = [worker.model_dump(mode="json") for worker in STANDARD_WORKFORCE]
    text = json.dumps({"version": ROSTER_VERSION, "workers": payload}, sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()


def roster_problems() -> list[str]:
    """Return every rule the roster breaks. Empty means it is safe to install."""
    problems: list[str] = []
    if len(set(STANDARD_KEYS)) != len(STANDARD_KEYS):
        problems.append("agent keys repeat")
    for worker in STANDARD_WORKFORCE:
        for tool in worker.allowed_tool_ids:
            if find_action(tool) is None:
                problems.append(f"{worker.agent_key}: {tool} is not a registered action")
            if tool in FORBIDDEN_ACTIONS:
                problems.append(f"{worker.agent_key}: {tool} is forbidden")
        if worker.model_config_ref not in MODEL_TIERS:
            problems.append(f"{worker.agent_key}: model tier is unknown")
        if worker.status != "ACTIVE":
            problems.append(f"{worker.agent_key}: status is not active")
    return problems


class StandardWorker(BaseModel):
    agent_key: str
    name: str
    role: str
    description: str
    allowed_tool_ids: list[str]
    model_tier: str
    installed: bool
    definition_id: UUID | None
    definition_status: str | None
    staffed: bool | None


class WorkforceBody(BaseModel):
    roster_version: int
    workers: list[StandardWorker]


@dataclass(frozen=True)
class SyncResult:
    roster_workers: int
    retired: int
    installed: int
    updated: int
    staffed: int


def register_workforce(app: FastAPI, settings: Settings) -> None:
    @app.get("/organizations/{organization_id}/standard-workforce")
    def read_workforce(
        organization_id: UUID, request: Request, project_id: UUID | None = None
    ) -> WorkforceBody:
        principal = _session_principal(request)
        return _call(
            settings,
            lambda connection: _read(connection, principal, organization_id, project_id),
        )


def is_reserved_key(agent_key: str) -> bool:
    """Standard worker keys belong to the platform. A custom agent cannot take one."""
    return agent_key in STANDARD_KEYS


def sync_standard_workforce(connection: psycopg.Connection[Any]) -> SyncResult:
    """Make the database match the reviewed roster. Safe to run on every deploy."""
    problems = roster_problems()
    if problems:
        raise ValueError("standard workforce is invalid: " + "; ".join(problems))
    with transaction(connection) as cursor:
        cursor.execute("SELECT set_config('app.standard_sync', 'on', true)")
        for worker in STANDARD_WORKFORCE:
            cursor.execute(_UPSERT_ROSTER, _roster_values(worker))
        cursor.execute(
            "DELETE FROM standard_agents WHERE agent_key <> ALL(%s)", (list(STANDARD_KEYS),)
        )
        retired = cursor.execute(_RETIRE, (list(STANDARD_KEYS),)).fetchall()
        _audit_all(cursor, retired, "agent.disabled", {"source": "standard", "retired": True})
        updated = cursor.execute(_FOLLOW_ROSTER).fetchall()
        seats_before = _seats(cursor)
        _audit_all(
            cursor,
            updated,
            "agent.updated",
            {"source": "standard", "roster_version": ROSTER_VERSION},
        )
        installed = cursor.execute(_INSTALL_MISSING).fetchall()
        _audit_all(
            cursor,
            installed,
            "agent.created",
            {"status": "ACTIVE", "source": "standard", "roster_version": ROSTER_VERSION},
        )
        cursor.execute(_STAFF_OPEN_ENGAGEMENTS)
        staffed = _seats(cursor) - seats_before
    return SyncResult(
        roster_workers=len(STANDARD_WORKFORCE),
        retired=len(retired),
        installed=len(installed),
        updated=len(updated),
        staffed=staffed,
    )


_UPSERT_ROSTER = """
    INSERT INTO standard_agents (
        agent_key, roster_version, name, role, description, input_schema,
        output_schema, allowed_tool_ids, model_config_ref, max_iterations,
        time_budget_seconds
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (agent_key) DO UPDATE
    SET roster_version = EXCLUDED.roster_version,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        description = EXCLUDED.description,
        input_schema = EXCLUDED.input_schema,
        output_schema = EXCLUDED.output_schema,
        allowed_tool_ids = EXCLUDED.allowed_tool_ids,
        model_config_ref = EXCLUDED.model_config_ref,
        max_iterations = EXCLUDED.max_iterations,
        time_budget_seconds = EXCLUDED.time_budget_seconds,
        updated_at = clock_timestamp()
"""

# A worker removed from the roster stops taking new work in every firm.
_RETIRE = """
    UPDATE agent_definitions
    SET status = 'DISABLED', revision = revision + 1, version = version + 1,
        updated_at = clock_timestamp()
    WHERE source = 'standard' AND status = 'ACTIVE' AND agent_key <> ALL(%s)
    RETURNING id, organization_id
"""

# Existing workers follow the roster. A firm's choice to disable one is kept.
# A same-key agent created before keys were reserved is taken over by the roster.
_FOLLOW_ROSTER = """
    UPDATE agent_definitions AS d
    SET name = s.name, role = s.role, description = s.description,
        input_schema = s.input_schema, output_schema = s.output_schema,
        allowed_tool_ids = s.allowed_tool_ids, model_config_ref = s.model_config_ref,
        max_iterations = s.max_iterations, time_budget_seconds = s.time_budget_seconds,
        source = 'standard', roster_version = s.roster_version,
        revision = d.revision + 1, version = d.version + 1,
        updated_at = clock_timestamp()
    FROM standard_agents AS s
    WHERE d.agent_key = s.agent_key
      AND (
        d.source <> 'standard'
        OR (
            d.name, d.role, d.description, d.input_schema, d.output_schema,
            d.allowed_tool_ids, d.model_config_ref, d.max_iterations,
            d.time_budget_seconds, d.roster_version
        ) IS DISTINCT FROM (
            s.name, s.role, s.description, s.input_schema, s.output_schema,
            s.allowed_tool_ids, s.model_config_ref, s.max_iterations,
            s.time_budget_seconds, s.roster_version
        )
      )
    RETURNING d.id, d.organization_id
"""

# Firms that existed before this roster, or before a new worker, catch up.
_INSTALL_MISSING = """
    INSERT INTO agent_definitions (
        organization_id, agent_key, name, role, description, input_schema,
        output_schema, allowed_tool_ids, model_config_ref, max_iterations,
        time_budget_seconds, status, source, roster_version
    )
    SELECT o.id, s.agent_key, s.name, s.role, s.description, s.input_schema,
           s.output_schema, s.allowed_tool_ids, s.model_config_ref, s.max_iterations,
           s.time_budget_seconds, 'ACTIVE', 'standard', s.roster_version
    FROM organizations AS o CROSS JOIN standard_agents AS s
    ORDER BY o.id, s.agent_key
    ON CONFLICT (organization_id, agent_key) DO NOTHING
    RETURNING id, organization_id
"""

# Engagements that existed before staffing was automatic catch up too.
_STAFF_OPEN_ENGAGEMENTS = """
    WITH added AS (
        INSERT INTO agent_instances (
            organization_id, project_id, agent_definition_id, definition_revision
        )
        SELECT p.organization_id, p.id, d.id, d.revision
        FROM projects AS p
        JOIN agent_definitions AS d ON d.organization_id = p.organization_id
        WHERE p.status <> 'ARCHIVED' AND d.source = 'standard' AND d.status = 'ACTIVE'
        ORDER BY p.id, d.agent_key
        ON CONFLICT (project_id, agent_definition_id) DO NOTHING
        RETURNING id, organization_id, project_id, agent_definition_id
    )
    INSERT INTO audit_events (
        organization_id, project_id, action, target_type, target_id, payload
    )
    SELECT organization_id, project_id, 'agent_instance.staffed', 'agent_instance', id,
           jsonb_build_object('agent_definition_id', agent_definition_id, 'source', 'standard')
    FROM added
    RETURNING id
"""


def _roster_values(worker: AgentCreateBody) -> tuple[Any, ...]:
    return (
        worker.agent_key,
        ROSTER_VERSION,
        worker.name,
        worker.role,
        worker.description,
        Json(worker.input_schema),
        Json(worker.output_schema),
        worker.allowed_tool_ids,
        worker.model_config_ref,
        worker.max_iterations,
        worker.time_budget_seconds,
    )


def _audit_all(
    cursor: psycopg.Cursor[Any],
    rows: list[tuple[Any, ...]],
    action: str,
    payload: dict[str, Any],
) -> None:
    for definition_id, organization_id in rows:
        cursor.execute(
            """
            INSERT INTO audit_events (organization_id, action, target_type, target_id, payload)
            VALUES (%s, %s, 'agent_definition', %s, %s)
            """,
            (organization_id, action, definition_id, Json(payload)),
        )


def _read(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID | None,
) -> WorkforceBody:
    authorize(
        connection,
        principal=principal,
        action=Action.AGENT_READ,
        organization_id=organization_id,
    )
    if project_id is not None:
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_READ,
            organization_id=organization_id,
            project_id=project_id,
        )
    rows = connection.execute(
        """
        SELECT d.agent_key, d.id, d.status::text,
               EXISTS (
                   SELECT 1 FROM agent_instances i
                   WHERE i.agent_definition_id = d.id AND i.project_id = %s
               )
        FROM agent_definitions d
        WHERE d.organization_id = %s AND d.source = 'standard'
        """,
        (project_id, organization_id),
    ).fetchall()
    by_key = {str(row[0]): row for row in rows}
    workers: list[StandardWorker] = []
    for worker in STANDARD_WORKFORCE:
        row = by_key.get(worker.agent_key)
        workers.append(
            StandardWorker(
                agent_key=worker.agent_key,
                name=worker.name,
                role=worker.role,
                description=worker.description,
                allowed_tool_ids=worker.allowed_tool_ids,
                model_tier=worker.model_config_ref,
                installed=row is not None,
                definition_id=None if row is None else row[1],
                definition_status=None if row is None else str(row[2]),
                staffed=None if project_id is None else (row is not None and bool(row[3])),
            )
        )
    return WorkforceBody(roster_version=ROSTER_VERSION, workers=workers)


def _seats(cursor: psycopg.Cursor[Any]) -> int:
    """Standard workers on engagements, however they got there."""
    row = cursor.execute(
        """
        SELECT count(*) FROM agent_instances i
        JOIN agent_definitions d ON d.id = i.agent_definition_id
        WHERE d.source = 'standard'
        """
    ).fetchone()
    return 0 if row is None else int(row[0])
