"""A control's activity (the control record's Activity view): every audit event about the
control or its records, newest first, said in words, and whether an agent, a person, or
the workspace itself did it. Read from audit_events only, so it is the audit trail."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api import attribute_dispositions, file_reliability
from ai_workforce_api.authorization import Action, NotVisible, Principal, authorize

Category = Literal[
    "design", "planning", "evidence", "testing", "review", "findings", "approval",
    "workflow", "error",
]  # fmt: skip
By = Literal["agent", "person", "workspace"]


class ActivityItem(BaseModel):
    id: UUID
    at: datetime
    by: By
    actor: str
    category: Category
    action: str
    title: str
    detail: str = ""


# Output that only an agent produces, even when a person asked for it: the tester's
# results, the reviewer agent's re-performance, and what the agents propose or draft
# from the sources. The value is the kind of plan task whose agent does it. Any other
# event is an agent's only when it says so (its payload names the agent, as the console
# reads it) or an agent instance is recorded as its actor.
AGENT_OUTPUT: dict[str, str] = {
    "testing.items_tested": "test",
    "review.reperformed": "review",
    "attribute.proposed": "walkthrough",
    "process.built": "walkthrough",
    "workpaper.drafted": "walkthrough",
}

# Bookkeeping that says nothing about the control's audit.
_SKIP = ("task.read", "task.create", "task.created", "model.called", "task.update")

_TITLES: dict[str, tuple[Category, str]] = {
    "evidence_plan.generated": ("planning", "Evidence plan drafted"),
    "evidence_plan.approved": ("planning", "Evidence plan approved"),
    "evidence_plan.phase_decided": ("planning", "Evidence plan phase decided"),
    "evidence_requirement.added": ("planning", "Evidence requirement added"),
    "evidence_requirement.edited": ("planning", "Evidence requirement changed"),
    "evidence_requirement.waived": ("planning", "Evidence requirement waived"),
    "evidence_requirement.restored": ("planning", "Evidence requirement restored"),
    "evidence_requirement.change_decided": ("planning", "Evidence plan change decided"),
    "evidence_requirement.accepted": ("planning", "D&I request accepted"),
    "design_requests.accepted": ("planning", "D&I requests accepted"),
    "design_coverage.exception_recorded": ("planning", "D&I coverage exception recorded"),
    "design_coverage.exception_cleared": ("planning", "D&I coverage exception cleared"),
    "evidence_requirement.sufficiency": ("evidence", "Evidence sufficiency judged"),
    "pbc.drafted": ("evidence", "Evidence request drafted"),
    "pbc.sample_request_drafted": ("evidence", "Sample request drafted"),
    "pbc.follow_up_drafted": ("evidence", "Follow-up drafted"),
    "pbc.redraft_requested": ("evidence", "Redraft asked for"),
    "pbc.updated": ("evidence", "Evidence request updated"),
    "pbc.received_from_evidence": ("evidence", "Evidence request received"),
    "pbc.receipt_undone": ("evidence", "Receipt undone"),
    "evidence.uploaded": ("evidence", "Evidence uploaded"),
    "evidence.portal_uploaded": ("evidence", "Evidence uploaded by the owner"),
    "evidence.analyzed": ("evidence", "Evidence read"),
    "evidence.reviewed": ("evidence", "Evidence reviewed"),
    "evidence.review_signed_off": ("evidence", "Evidence review signed off"),
    "evidence.classification_confirmed": ("evidence", "Evidence classification confirmed"),
    "evidence.replaced": ("evidence", "Evidence replaced"),
    "evidence.withdrawn": ("evidence", "Evidence withdrawn"),
    "evidence.restored": ("evidence", "Evidence restored"),
    "evidence.custody_check_failed": ("error", "Evidence custody check failed"),
    # A person's tickmarks on the attributes of a D&I request, and their decisions on a
    # file's reliability (docs/evidence-assurance.md, sections 10.13 to 10.15): the detail
    # says the kind in words and the attribute's letter or the file's name (_recorded).
    attribute_dispositions.RECORDED: ("evidence", "Tickmark recorded"),
    attribute_dispositions.REOPENED: ("evidence", "Tickmark reopened"),
    attribute_dispositions.ENDED_BY_CHECK: ("evidence", "Tickmark ended by a later check"),
    attribute_dispositions.ANNOTATION_GONE_EVENT: (
        "evidence",
        "Tickmark ended with its annotation",
    ),
    file_reliability.RECORDED: ("evidence", "File reliability decided"),
    file_reliability.REOPENED: ("evidence", "File reliability decision reopened"),
    file_reliability.ENDED_WITH_FILE: ("evidence", "File reliability decision ended"),
    "attribute.proposed": ("design", "Test attribute proposed"),
    # The attribute agent's own record (B1e): its actor is the agent instance.
    "attributes.understanding_followed": (
        "design",
        "Attributes follow the confirmed understanding",
    ),
    "attribute.approved": ("design", "Test attribute approved"),
    # Accepting the attributes closes the agents' open questions about them (14 November 2026).
    "attributes.questions_closed": (
        "design",
        "Open questions closed: the attributes were accepted",
    ),
    "context.questions_not_asked": (
        "design",
        "No follow-up question asked: the attributes are accepted",
    ),
    "attribute.rejected": ("design", "Test attribute rejected"),
    "attribute.added": ("design", "Test attribute added"),
    "attribute.edited": ("design", "Test attribute changed"),
    "attribute.retired": ("design", "Test attribute retired"),
    "process.built": ("design", "Process understanding drafted"),
    "process.saved": ("design", "Process understanding saved"),
    "process.confirmed": ("design", "Process understanding confirmed"),
    "process.adopted": ("design", "Process understanding adopted"),
    "context.issue_resolved": ("design", "Open question resolved"),
    "control.change_recorded": ("design", "Change to the control recorded"),
    "control.values_set": ("design", "Control values set"),
    "control.classified": ("design", "Control classified"),
    "control_test.samples_proposed": ("testing", "Samples proposed"),
    "control_test.samples_approved": ("testing", "Samples approved"),
    "control_test.sample_replaced": ("testing", "Sample replaced"),
    "testing.sheet_opened": ("testing", "Testing started"),
    "testing.items_tested": ("testing", "Items tested"),
    "testing.evidence_linked": ("testing", "Evidence linked to a sample"),
    "testing.result_overridden": ("testing", "Test result decided"),
    "testing.signed_off": ("testing", "Testing signed off"),
    "testing.reopened": ("testing", "Testing reopened"),
    "testing.retest": ("testing", "Testing run again"),
    "testing.run_failed": ("error", "Testing run stopped"),
    "testing.sheet_replaced": ("testing", "Test sheet replaced"),
    "testing.round_started": ("testing", "Roll-forward or retest round started"),
    "testing.round_signed_off": ("testing", "Round signed off"),
    "testing.round_cancelled": ("testing", "Round cancelled"),
    "testing.deficiency_logged": ("findings", "Proposed deficiency logged"),
    "testing.deficiency_dismissed": ("findings", "Proposed deficiency dismissed"),
    "workpaper.drafted": ("review", "Workpaper drafted"),
    "workpaper.edited": ("review", "Workpaper edited"),
    "workpaper.prepared": ("review", "Workpaper prepared"),
    "workpaper.rationale_reviewed": ("review", "AI-proposed testing rationale reviewed"),
    "workpaper.reopened": ("review", "Workpaper reopened"),
    "review.reperform_requested": ("review", "Re-performance asked for"),
    "review.reperformed": ("review", "Testing re-performed by the reviewer agent"),
    "review.note_raised": ("review", "Review note raised"),
    "review.note_decided": ("review", "Review note decided"),
    "review.note_responded": ("review", "Review note answered"),
    "review.note_cleared": ("review", "Review note cleared"),
    "review.signed_off": ("review", "Review signed off"),
    "review.reopened": ("review", "Review reopened"),
    "deficiency.created": ("findings", "Deficiency logged"),
    "deficiency.updated": ("findings", "Deficiency updated"),
    "deficiency.progress": ("findings", "Remediation progress recorded"),
    "deficiency.severity": ("findings", "Severity set"),
    "deficiency.change_requested": ("findings", "Deficiency change asked for"),
    "deficiency.change_decided": ("findings", "Deficiency change decided"),
    "approval.requested": ("approval", "Approval asked for"),
    "approval.decided": ("approval", "Approval decided"),
    "approval.expired": ("approval", "Approval expired"),
    "approval.withdrawn": ("approval", "Approval withdrawn"),
    "task.assigned": ("workflow", "Work assigned"),
    "task.unassigned": ("workflow", "Work unassigned"),
    "task.updated": ("workflow", "Work updated"),
    "task.cancelled": ("workflow", "Work cancelled"),
    "task.retried": ("workflow", "Work retried"),
    "task.reactivated": ("workflow", "Work reactivated"),
}

# Payload fields worth a line under the title, in order of preference.
_DETAIL_KEYS = ("title", "reference", "name", "file_name", "reason", "note", "decision",
                "status", "severity")  # fmt: skip


# The events of a person's tickmarks and of their decisions on a file's reliability.
_TICKMARK_EVENTS = frozenset({
    attribute_dispositions.RECORDED, attribute_dispositions.REOPENED,
    attribute_dispositions.ENDED_BY_CHECK, attribute_dispositions.ANNOTATION_GONE_EVENT,
})  # fmt: skip
_RELIABILITY_EVENTS = frozenset(
    {file_reliability.RECORDED, file_reliability.REOPENED, file_reliability.ENDED_WITH_FILE}
)
# How a check ended a tickmark, in words.
_ENDED_BY_CHECK = {
    "SUPERSEDED_BY_CHECK": "The later check found the attribute supported.",
    "OVERTAKEN_BY_CHECK": "The later check found the records contradict the attribute.",
    "ANNOTATION_GONE": "The file its annotation is on is no longer in force on the request.",
}


def _words(kinds: dict[Any, str], kind: Any) -> str:
    """A recorded kind in the product's own words; a kind not known reads as words too,
    never as its code."""
    known = kinds.get(kind)
    if known is not None:
        return known
    return str(kind or "").replace("_", " ").capitalize()


def _recorded(
    action: str,
    payload: dict[str, Any],
    letters: dict[str, str],
    files: dict[str, str],
    people: dict[str, str],
) -> str:
    """One line for a tickmark's or a reliability decision's event: the kind in words and
    the attribute's letter (`letters`, by attribute id) or the file's name (`files`, by
    file id), and for what ended without the person asking, why. Who did it is the item's
    actor; where a decision ended with its file, the person whose change it followed
    (`people`, by user id)."""
    if action in _TICKMARK_EVENTS:
        letter = letters.get(str(payload.get("attribute_id") or ""))
        about = f"Attribute {letter}" if letter else "An attribute no longer approved"
        said = f"{about}: “{_words(attribute_dispositions.KIND_WORDS, payload.get('kind'))}”"
        if action == attribute_dispositions.RECORDED and payload.get("replaced_kind"):
            before = _words(attribute_dispositions.KIND_WORDS, payload.get("replaced_kind"))
            return f"{said}, in place of “{before}”"
        if action == attribute_dispositions.ENDED_BY_CHECK:
            how = _ENDED_BY_CHECK.get(str(payload.get("ended_as") or ""), "")
            return f"{said}. {how}".rstrip(". ") + "."
        if action == attribute_dispositions.ANNOTATION_GONE_EVENT:
            why = " ".join(str(payload.get("reason") or "").split())[:160]
            return f"{said}. {why}".rstrip(". ") + "."
        return said
    name = " ".join(files.get(str(payload.get("file_id") or ""), "").split())[:120]
    said = f"{name or 'A file'}: “{_words(file_reliability.KIND_WORDS, payload.get('kind'))}”"
    if action == file_reliability.RECORDED and payload.get("replaced_kind"):
        before = _words(file_reliability.KIND_WORDS, payload.get("replaced_kind"))
        return f"{said}, in place of “{before}”"
    if action == file_reliability.ENDED_WITH_FILE:
        who = people.get(str(payload.get("changed_by") or ""))
        followed = f" After a change by {who}." if who else ""
        return f"{said}. The file is no longer in force on the request.{followed}"
    return said


def _title(action: str) -> tuple[Category, str]:
    known = _TITLES.get(action)
    if known is not None:
        return known
    words = action.replace("_", " ").replace(".", ": ")
    category: Category = "error" if "fail" in action else "workflow"
    return category, words[:1].upper() + words[1:]


def _detail(action: str, payload: dict[str, Any]) -> str:
    if action == "testing.items_tested":
        tested = payload.get("tested") or payload.get("items")
        if isinstance(tested, int):
            return f"{tested} item{'s' if tested != 1 else ''}"
    if action == "evidence_plan.generated":
        source = payload.get("source")
        added = payload.get("added")
        parts = []
        if isinstance(added, int):
            parts.append(f"{added} requirement{'s' if added != 1 else ''}")
        if source == "RULES":
            parts.append("from the methodology's rules")
        elif isinstance(source, str) and source != "":
            parts.append(f"by {source.lower()}")
        return ", ".join(parts)
    for key in _DETAIL_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip() != "":
            text = " ".join(value.split())[:200]
            # A recorded status or code reads as words: RECEIVED as "Received".
            if text.isupper() and " " not in text:
                text = text.replace("_", " ").capitalize()
            return text
    return ""


def control_activity(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    limit: int = 300,
) -> list[ActivityItem]:
    authorize(
        connection,
        principal=principal,
        action=Action.TASK_READ,
        organization_id=organization_id,
        project_id=project_id,
    )
    found = connection.execute(
        "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if found is None:
        raise NotVisible()
    # The records that belong to the control: their events are the control's.
    owned = [
        row[0]
        for row in connection.execute(
            """
            SELECT id FROM pbc_requests WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM evidence_requirements WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM evidence_plans WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM control_tests WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM test_sheets WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM test_rounds WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM workpapers WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM control_reviews WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM deficiencies WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM tasks WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM control_attributes WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM process_understandings WHERE engagement_control_id = %(c)s
            UNION ALL SELECT id FROM control_context_issues WHERE engagement_control_id = %(c)s
            UNION ALL SELECT l.evidence_file_id FROM evidence_file_links l
                      WHERE l.engagement_control_id = %(c)s
            """,
            {"c": control_id},
        ).fetchall()
    ]
    agents = {
        str(kind): str(name)
        for kind, name in connection.execute(
            """
            SELECT t.plan_kind, d.name FROM tasks t
            JOIN agent_instances i ON i.id = t.agent_instance_id
            JOIN agent_definitions d ON d.id = i.agent_definition_id
            WHERE t.engagement_control_id = %s AND t.plan_kind IS NOT NULL
            """,
            (control_id,),
        ).fetchall()
    }
    rows = connection.execute(
        """
        SELECT e.id, e.occurred_at, e.action, e.payload, u.display_name, d.name
        FROM audit_events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        LEFT JOIN agent_instances i ON i.id = e.actor_agent_instance_id
        LEFT JOIN agent_definitions d ON d.id = i.agent_definition_id
        WHERE e.organization_id = %s AND e.project_id = %s
          AND NOT (e.action = ANY(%s))
          AND (e.target_id = %s OR e.target_id = ANY(%s)
               OR e.payload ->> 'control_id' = %s
               OR e.payload ->> 'engagement_control_id' = %s)
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT %s
        """,
        (
            organization_id, project_id, list(_SKIP), control_id, owned,
            str(control_id), str(control_id), limit,
        ),
    ).fetchall()  # fmt: skip
    items: list[ActivityItem] = []
    from ai_workforce_api.console import _AGENT_NAMES

    # What the tickmarks' and the reliability decisions' events name by id, read only
    # where the trail holds such an event: the attributes' letters, the files' names and
    # the people whose change ended a decision.
    recorded = [
        row[3]
        for row in rows
        if str(row[2]) in _TICKMARK_EVENTS | _RELIABILITY_EVENTS and isinstance(row[3], dict)
    ]
    letters: dict[str, str] = {}
    files: dict[str, str] = {}
    people: dict[str, str] = {}
    if recorded:
        from ai_workforce_api.evidence_assurance import attribute_letter

        letters = {
            str(row[0]): attribute_letter(index)
            for index, row in enumerate(
                connection.execute(
                    "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
                    "AND status = 'APPROVED' ORDER BY position, created_at",
                    (control_id,),
                ).fetchall()
            )
        }
        wanted = {str(p["file_id"]) for p in recorded if p.get("file_id")}
        if wanted:
            files = {
                str(row[0]): str(row[1])
                for row in connection.execute(
                    "SELECT id, file_name FROM evidence_files WHERE project_id = %s "
                    "AND id::text = ANY(%s)",
                    (project_id, sorted(wanted)),
                ).fetchall()
            }
        changers = {str(p["changed_by"]) for p in recorded if p.get("changed_by")}
        if changers:
            people = {
                str(row[0]): str(row[1])
                for row in connection.execute(
                    "SELECT id, display_name FROM users WHERE id::text = ANY(%s)",
                    (sorted(changers),),
                ).fetchall()
            }

    for event_id, at, action, payload, person, agent_name in rows:
        category, title = _title(str(action))
        body = payload if isinstance(payload, dict) else {}
        named = body.get("agent")
        by: By
        if str(action) in _TICKMARK_EVENTS | _RELIABILITY_EVENTS:
            detail = _recorded(str(action), body, letters, files, people)
        else:
            detail = _detail(str(action), body)
        if agent_name is not None or isinstance(named, str) or str(action) in AGENT_OUTPUT:
            by = "agent"
            actor = str(
                agent_name
                or (_AGENT_NAMES.get(named, "") if isinstance(named, str) else "")
                or agents.get(AGENT_OUTPUT.get(str(action), ""), "")
                or "Agent"
            )
            if person is not None and str(action) in AGENT_OUTPUT:
                asked = f"asked by {person}"
                detail = f"{detail} · {asked}" if detail else asked[:1].upper() + asked[1:]
        elif person is not None:
            by, actor = "person", str(person)
        else:
            by, actor = "workspace", "Workspace"
        items.append(
            ActivityItem(
                id=event_id,
                at=at,
                by=by,
                actor=actor,
                category=category,
                action=str(action),
                title=title,
                detail=detail,
            )
        )
    return items
