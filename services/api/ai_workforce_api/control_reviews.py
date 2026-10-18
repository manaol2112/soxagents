"""Independent review of a control instance (Milestone 9.1).

One review per control instance (`control_reviews`, migration 0042). It opens when the
control's effectiveness workpaper is prepared. The independent reviewer agent then
re-performs the testing in the background: reviewed rules in code check the sample, the
results, the workpapers, and the deficiency decision, and Claude re-performs each tested
item from the evidence without seeing the tester's results. A disagreement becomes a
proposed review note with the reviewer's own checked citations.

A team member with the reviewer role decides each proposed note, raises notes of their
own, clears answered notes, and signs the review off once nothing is open. A note that
must be fixed reopens the test sheet or the workpaper with the note as the reason; the
preparer responds and signs off or prepares again, which re-performs the review. Nobody
reviews work they signed off or prepared.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api import independence
from ai_workforce_api.agent_runs import RunState, run_state
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_instances import control_label
from ai_workforce_api.controls import sample_size
from ai_workforce_api.db import connect, independent_steps, transaction
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.model_providers import CLAUDE_CONFIG, call_note, live_model, provider_for
from ai_workforce_api.models import ModelImage, ModelProvider, ModelRequest, complete, record_call
from ai_workforce_api.settings import Settings
from ai_workforce_api.test_sheets import ReopenBody as SheetReopenBody
from ai_workforce_api.test_sheets import SheetBody, SheetState, _sheet, reopen_work
from ai_workforce_api.testing_engine import (
    MAX_IMAGES,
    TEST_SCHEMA,
    ImageLoader,
    ItemContext,
    ItemFile,
    check_results,
    prompt_for,
    stored_image,
)

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
LEASE_MINUTES = 15
MAX_REVIEWED_ITEMS = 30
MAX_NOTES = 200

Severity = Literal["MUST_FIX", "SHOULD_FIX", "OBSERVATION"]
TargetKind = Literal["RESULT", "SAMPLE", "WORKPAPER", "DEFICIENCY", "GENERAL"]
NoteStatus = Literal["PROPOSED", "OPEN", "RESPONDED", "CLEARED", "DISMISSED", "WITHDRAWN"]
ReviewStatus = Literal["OPEN", "SIGNED_OFF"]
ReviewLeft = Literal["REPERFORMING", "REPERFORM", "DECIDE", "ADDRESS", "CLEAR", "SIGN", "SIGNED"]

SYSTEM_PROMPT = """You are the independent reviewer on a SOX IT audit, re-performing a \
control test that another tester performed. You have not seen the tester's results, and \
you must not guess them: test the item yourself, from the evidence given, against each \
attribute.

For each attribute, by its index:
- PASS only when the evidence clearly shows the attribute is met for this item.
- EXCEPTION when the evidence shows it is not met.
- UNABLE (insufficient evidence) when the evidence is missing, cut off, unreadable, or does \
not cover this item. Missing evidence is never an EXCEPTION.
- REVIEW (human review required) when the result turns on judgment the attribute reserves \
for a person, on a threshold the control does not define, or on evidence that contradicts \
itself.
- NOT_APPLICABLE only when the attribute cannot apply to this item, and say why.

Cite what you saw: dates, names, IDs, values. Keep each note to one or two sentences. For \
each result, list the passages it rests on in citations: the file's index and the exact \
words copied from that file's text, at most 200 characters. For a file shown as an image, \
give a box {x, y, w, h} in fractions of the image around the words. Never invent a \
passage: a citation that is not in the file is dropped.
"""


class ReviewScheduler(Protocol):
    def schedule_reviews(self, review_ids: list[UUID]) -> None: ...


def schedule_reviews(scheduler: Any, review_ids: list[UUID]) -> None:
    """Hand re-performances to the background. If that fails, they resume later."""
    if scheduler is None or not review_ids or not hasattr(scheduler, "schedule_reviews"):
        return
    try:
        scheduler.schedule_reviews(review_ids)
    except Exception:
        logger.warning("reviews could not be scheduled; they will resume on restart")


class ReviewState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


# Opening


def open_review(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requester: UUID,
) -> UUID | None:
    """The control's review opens, or is re-performed, when its effectiveness workpaper
    is prepared. Returns the review to schedule when a re-performance is pending."""
    row = cursor.execute(
        """
        INSERT INTO control_reviews (organization_id, project_id, engagement_control_id,
                                     opened_by)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (project_id, engagement_control_id) DO UPDATE
        SET reperform_status = CASE WHEN control_reviews.reperform_status = 'WORKING'
                                    THEN 'WORKING' ELSE 'PENDING' END,
            reperform_requested_at = clock_timestamp(),
            attempts = CASE WHEN control_reviews.reperform_status = 'WORKING'
                            THEN control_reviews.attempts ELSE 0 END,
            version = control_reviews.version + 1
        RETURNING id, reperform_status
        """,
        (organization_id, project_id, control_id, requester),
    ).fetchone()
    if row is None:
        return None
    review_id = UUID(str(row[0]))
    # The plan's review task is under way until the review is signed off.
    cursor.execute(
        """
        UPDATE tasks SET status = 'REVIEW', version = version + 1
        WHERE project_id = %s AND engagement_control_id = %s AND plan_kind = 'review'
          AND status NOT IN ('REVIEW', 'SUCCEEDED', 'CANCELLED')
        """,
        (project_id, control_id),
    )
    # A review that opens (again) means the engagement's review is not complete.
    _update_completion(cursor, project_id, requester)
    return review_id if row[1] == "PENDING" else None


def request_reperformance(cursor: psycopg.Cursor[Any], review_id: UUID) -> UUID | None:
    row = cursor.execute(
        """
        UPDATE control_reviews
        SET reperform_requested_at = clock_timestamp(),
            reperform_status = CASE WHEN reperform_status = 'WORKING' THEN 'WORKING'
                                    ELSE 'PENDING' END,
            attempts = CASE WHEN reperform_status = 'WORKING' THEN attempts ELSE 0 END
        WHERE id = %s AND status = 'OPEN'
        RETURNING id
        """,
        (review_id,),
    ).fetchone()
    return None if row is None else UUID(str(row[0]))


def open_reperformances(connection: psycopg.Connection[Any]) -> list[UUID]:
    rows = connection.execute(
        """
        SELECT id FROM control_reviews
        WHERE status = 'OPEN' AND attempts < %s
          AND (reperform_status = 'PENDING'
               OR (reperform_status = 'WORKING' AND lease_until < clock_timestamp()))
        ORDER BY reperform_requested_at LIMIT 100
        """,
        (MAX_ATTEMPTS,),
    ).fetchall()
    return [UUID(str(row[0])) for row in rows]


# What a re-performance that gave up says; the register reads it as a stopped agent.
REPERFORM_FAILED = "The re-performance did not finish. Re-perform to try again."


def fail_reperformance(connection: psycopg.Connection[Any], review_id: UUID) -> None:
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE control_reviews SET reperform_status = 'IDLE', lease_until = NULL, "
            "reperform_note = %s WHERE id = %s AND reperform_status IN ('PENDING', 'WORKING')",
            (REPERFORM_FAILED, review_id),
        )


ReviewRunner = Callable[[UUID], str]


def review_runner(settings: Settings, provider: ModelProvider | None = None) -> ReviewRunner:
    model = provider if provider is not None else provider_for(settings)
    use_model = provider is not None or live_model(settings)

    def load(connection: psycopg.Connection[Any], file_id: UUID) -> bytes | None:
        return stored_image(settings, connection, file_id)

    def run(review_id: UUID) -> str:
        with connect(settings.database_url) as connection:
            return run_reperformance(connection, model if use_model else None, review_id, load)

    return run


# The re-performance


@dataclass(frozen=True)
class Finding:
    target_kind: TargetKind
    target: dict[str, Any]
    severity: Severity
    text: str


@dataclass(frozen=True)
class WorkpaperFacts:
    id: UUID
    stage: str
    status: str
    # Narrative sections (not filled from the records) that are empty.
    empty_sections: tuple[str, ...]


@dataclass(frozen=True)
class ControlFacts:
    control_ref: str
    frequency: str
    frequency_label: str
    nature: str
    key_control: bool


def rules_findings(
    sheet: SheetBody,
    control: ControlFacts,
    workpapers: tuple[WorkpaperFacts, ...],
    deficiency_status: str | None,
) -> list[Finding]:
    """What a reviewer checks before re-performing anything: reviewed rules in code."""
    findings: list[Finding] = []
    expected = sample_size(control.frequency, control.nature)
    if sheet.method == "SAMPLE" and len(sheet.items) < expected:
        findings.append(
            Finding(
                "SAMPLE",
                {"items": len(sheet.items), "expected": expected},
                "MUST_FIX",
                f"The sheet tests {_count(len(sheet.items), 'item')}; the standard sample for a "
                f"{control.frequency_label or control.frequency.lower()} control is "
                f"{expected}. Explain the smaller sample or extend it.",
            )
        )
    for item in sheet.items:
        uncited = [
            cell.index
            for cell in item.cells
            if cell.final == "PASS" and not cell.citations and cell.overridden_by is None
        ]
        if uncited and item.files:
            letters = ", ".join(_letter(index) for index in uncited)
            findings.append(
                Finding(
                    "RESULT",
                    {"item_id": str(item.id), "indexes": uncited},
                    "SHOULD_FIX",
                    f"{item.label}: attribute(s) {letters} passed without a cited passage. "
                    "Test again so the result cites the evidence, or cite it by hand.",
                )
            )
        for cell in item.cells:
            if (
                cell.overridden_by is not None
                and cell.final == "PASS"
                and cell.proposed in ("EXCEPTION", "UNABLE", "REVIEW")
            ):
                findings.append(
                    Finding(
                        "RESULT",
                        {"item_id": str(item.id), "indexes": [cell.index]},
                        "OBSERVATION",
                        f"{item.label}: attribute {_letter(cell.index)} was marked as passed by "
                        f"{cell.overridden_by}, where the tester found "
                        f"{_result_phrase(cell.proposed)}: "
                        f"“{cell.override_reason}”. Confirm the evidence supports it.",
                    )
                )
    for paper in workpapers:
        if paper.stage == "EFFECTIVENESS":
            for key in paper.empty_sections:
                findings.append(
                    Finding(
                        "WORKPAPER",
                        {"workpaper_id": str(paper.id), "section": key},
                        "MUST_FIX",
                        f"The effectiveness workpaper's “{key.replace('-', ' ')}” "
                        "section is empty.",
                    )
                )
        elif paper.status != "PREPARED":
            findings.append(
                Finding(
                    "WORKPAPER",
                    {"workpaper_id": str(paper.id)},
                    "SHOULD_FIX",
                    "The design and walkthrough workpaper is not prepared.",
                )
            )
    if not any(paper.stage == "DESIGN" for paper in workpapers):
        findings.append(
            Finding(
                "WORKPAPER",
                {},
                "SHOULD_FIX",
                "There is no design and walkthrough workpaper for this control.",
            )
        )
    if sheet.conclusion == "NOT_EFFECTIVE":
        if sheet.proposal_status == "DISMISSED":
            findings.append(
                Finding(
                    "DEFICIENCY",
                    {},
                    "MUST_FIX",
                    "Testing found exceptions, but the proposed deficiency was dismissed"
                    + (f": “{sheet.proposal_reason}”" if sheet.proposal_reason else "")
                    + ". Confirm why no deficiency is logged, or log one.",
                )
            )
        elif sheet.proposal_status == "PROPOSED":
            findings.append(
                Finding(
                    "DEFICIENCY",
                    {},
                    "SHOULD_FIX",
                    "The deficiency the tester proposed from the exceptions is not decided.",
                )
            )
        elif deficiency_status is not None and deficiency_status == "CLOSED":
            findings.append(
                Finding(
                    "DEFICIENCY",
                    {},
                    "OBSERVATION",
                    "The deficiency from this testing is closed. Confirm the retest supports it.",
                )
            )
    return findings


def _letter(index: int) -> str:
    return chr(ord("A") + index) if 0 <= index < 26 else str(index + 1)


RESULT_PHRASES = {
    "PASS": "passed",
    "EXCEPTION": "an exception",
    "UNABLE": "insufficient evidence",
    "REVIEW": "human review required",
    "NA": "not applicable",
    "NOT_APPLICABLE": "not applicable",
}


def _result_phrase(result: str) -> str:
    """A test result as a reviewer would say it, never the stored code."""
    return RESULT_PHRASES.get(result.upper(), result.lower().replace("_", " "))


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}{'' if n == 1 else 's'}"


# What the reviewer's own result means against the tester's final one.
_DISAGREEMENTS: dict[tuple[str, str], tuple[Severity, str]] = {
    ("PASS", "EXCEPTION"): ("MUST_FIX", "the reviewer found an exception where the test passed"),
    ("PASS", "UNABLE"): ("SHOULD_FIX", "the reviewer found the evidence insufficient"),
    ("PASS", "REVIEW"): ("SHOULD_FIX", "the reviewer found it needs a person's judgment"),
    ("EXCEPTION", "PASS"): ("SHOULD_FIX", "the reviewer found the attribute met"),
    ("NOT_APPLICABLE", "PASS"): ("OBSERVATION", "the reviewer found the attribute applies"),
    ("NOT_APPLICABLE", "EXCEPTION"): ("MUST_FIX", "the reviewer found an exception"),
    ("UNABLE", "EXCEPTION"): ("MUST_FIX", "the reviewer found an exception"),
    ("REVIEW", "EXCEPTION"): ("MUST_FIX", "the reviewer found an exception"),
}


def disagreements(
    item_id: UUID,
    label: str,
    finals: list[str | None],
    reviewed: list[dict[str, Any]],
) -> list[Finding]:
    """A note for each attribute where the reviewer's re-performance differs."""
    findings: list[Finding] = []
    for entry in reviewed:
        index = int(entry.get("index", -1))
        if not 0 <= index < len(finals) or finals[index] is None:
            continue
        found = _DISAGREEMENTS.get((str(finals[index]), str(entry.get("result"))))
        if found is None:
            continue
        severity, why = found
        findings.append(
            Finding(
                "RESULT",
                {
                    "item_id": str(item_id),
                    "indexes": [index],
                    "reviewer_result": str(entry.get("result")),
                    "citations": [c for c in entry.get("citations", []) if isinstance(c, dict)],
                },
                severity,
                clean_line(
                    f"{label}: attribute {_letter(index)} is marked "
                    f"{_result_phrase(str(finals[index]))}, but "
                    f"{why}: {entry.get('note', '')}",
                    1900,
                ),
            )
        )
    return findings


def run_reperformance(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    review_id: UUID,
    images: ImageLoader | None = None,
) -> str:
    """Re-perform the control's testing: rules checks, then Claude on each tested item."""
    from ai_workforce_api.evidence_analysis import ocr_choice
    from ai_workforce_api.pbc_drafting import load_context

    independent_steps(connection)
    with transaction(connection) as cursor:
        claimed = cursor.execute(
            """
            UPDATE control_reviews
            SET reperform_status = 'WORKING', attempts = attempts + 1,
                reperform_started_at = clock_timestamp(),
                lease_until = clock_timestamp() + make_interval(mins => %s)
            WHERE id = %s AND status = 'OPEN' AND attempts < %s
              AND (reperform_status = 'PENDING'
                   OR (reperform_status = 'WORKING' AND lease_until < clock_timestamp()))
            RETURNING organization_id, project_id, engagement_control_id, opened_by
            """,
            (LEASE_MINUTES, review_id, MAX_ATTEMPTS),
        ).fetchone()
    if claimed is None:
        return "SKIPPED"
    organization_id, project_id, control_id, requester = (
        UUID(str(claimed[0])),
        UUID(str(claimed[1])),
        UUID(str(claimed[2])),
        UUID(str(claimed[3])),
    )
    sheet_row = connection.execute(
        "SELECT id FROM test_sheets WHERE project_id = %s AND engagement_control_id = %s "
        "AND test_round_id IS NULL AND status = 'SIGNED_OFF'",
        (project_id, control_id),
    ).fetchone()
    if sheet_row is None:
        _finish(connection, review_id, None, "RULES", "The testing is not signed off.", None, [])
        return "DONE"
    sheet = _sheet(connection, project_id, UUID(str(sheet_row[0])))
    loaded = load_context(connection, project_id, control_id)
    control = ControlFacts(
        control_ref=loaded.control_ref,
        frequency=loaded.frequency,
        frequency_label=loaded.frequency_label,
        nature=loaded.nature,
        key_control=loaded.key_control,
    )
    deficiency_status = connection.execute(
        "SELECT d.status FROM test_sheets s JOIN deficiencies d ON d.id = s.deficiency_id "
        "WHERE s.id = %s",
        (sheet.id,),
    ).fetchone()
    findings = rules_findings(
        sheet,
        control,
        _workpaper_facts(connection, project_id, control_id),
        None if deficiency_status is None else str(deficiency_status[0]),
    )
    source = "RULES"
    note = ""
    call_id: UUID | None = None
    if provider is None:
        note = "No model is configured, so the reviewer re-performs the testing by hand."
    else:
        shown_images = ocr_choice(connection, organization_id) == "MODEL"
        reviewed_items = 0
        for item in sheet.items:
            if item.state != "TESTED" or not item.files:
                continue
            if reviewed_items >= MAX_REVIEWED_ITEMS:
                note = f"The first {MAX_REVIEWED_ITEMS} items were re-performed."
                break
            reviewed_items += 1
            files = _item_files(
                connection, item.id, images if shown_images and images is not None else None
            )
            context = ItemContext(
                control_ref=loaded.control_ref,
                title=loaded.title,
                activity=loaded.activity,
                frequency=loaded.frequency_label or loaded.frequency,
                nature=loaded.nature_label or loaded.nature,
                period=f"ending {loaded.period_end.isoformat()}"
                if loaded.period_end is not None
                else "",
                attributes=tuple(sheet.attributes),
                item_label=item.label,
                item_detail=tuple((entry["column"], entry["value"]) for entry in item.detail),
                test_of_one=sheet.method == "TEST_OF_ONE",
                files=tuple(file for file, _data in files),
            )
            status, raw = complete(
                provider,
                ModelRequest(
                    operation="generate",
                    prompt=prompt_for(context).replace(
                        "Test this item against each attribute.",
                        "Re-perform the test of this item against each attribute.",
                        1,
                    ),
                    output_schema=TEST_SCHEMA,
                    allowed_tool_ids=(),
                    timeout_seconds=120,
                    cancelled=False,
                    system=SYSTEM_PROMPT,
                    images=tuple(
                        ModelImage("image/jpeg", data) for _file, data in files if data is not None
                    ),
                ),
                CLAUDE_CONFIG,
            )
            call_id = record_call(
                connection, requester, organization_id, project_id, "claude", status, raw,
                CLAUDE_CONFIG,
            )  # fmt: skip
            if status in ("SUCCEEDED", "MALFORMED") and raw.output is not None:
                try:
                    reviewed = check_results(
                        raw.output, len(sheet.attributes), tuple(f for f, _d in files)
                    )
                except ValueError as error:
                    note = f"The reviewer's answer for {item.label} was rejected: {error}."
                    continue
                source = "MODEL"
                findings.extend(
                    disagreements(
                        item.id, item.label, [cell.final for cell in item.cells], reviewed
                    )
                )
            else:
                note = call_note(status).replace(", so the rules were used", "")
    _finish(connection, review_id, sheet.version, source, note, call_id, findings)
    return "DONE"


def _item_files(
    connection: psycopg.Connection[Any], item_id: UUID, images: ImageLoader | None
) -> list[tuple[ItemFile, bytes | None]]:
    rows = connection.execute(
        """
        SELECT f.file_name, coalesce(a.confirmed_kind, a.classification ->> 'kind', 'other'),
               a.extracted_text, f.id
        FROM test_item_files t
        JOIN evidence_files f ON f.id = t.evidence_file_id
        JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE t.test_item_id = %s
        ORDER BY f.created_at
        """,
        (item_id,),
    ).fetchall()
    files: list[tuple[ItemFile, bytes | None]] = []
    shown = 0
    for name, kind, text, file_id in rows:
        data: bytes | None = None
        if images is not None and shown < MAX_IMAGES and _is_image(str(name)):
            data = images(connection, UUID(str(file_id)))
            shown += 1 if data is not None else 0
        files.append(
            (
                ItemFile(
                    file_name=str(name),
                    kind=str(kind),
                    text=str(text or ""),
                    review=None,
                    file_id=UUID(str(file_id)),
                    seen_as_image=data is not None,
                ),
                data,
            )
        )
    return files


def _is_image(name: str) -> bool:
    from ai_workforce_api.test_citations import is_image_name

    return is_image_name(name)


def _workpaper_facts(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> tuple[WorkpaperFacts, ...]:
    rows = connection.execute(
        """
        SELECT w.id, w.stage, w.status,
               (SELECT v.content FROM workpaper_versions v
                WHERE v.workpaper_id = w.id ORDER BY v.number DESC LIMIT 1)
        FROM workpapers w
        WHERE w.project_id = %s AND w.engagement_control_id = %s
        ORDER BY w.stage
        """,
        (project_id, control_id),
    ).fetchall()
    facts: list[WorkpaperFacts] = []
    for workpaper_id, stage, status, content in rows:
        sections = content.get("sections", []) if isinstance(content, dict) else []
        empty = tuple(
            str(section.get("key"))
            for section in sections
            if isinstance(section, dict)
            and section.get("narrative") is True
            and not str(section.get("text") or "").strip()
        )
        facts.append(WorkpaperFacts(UUID(str(workpaper_id)), str(stage), str(status), empty))
    return tuple(facts)


def _finish(
    connection: psycopg.Connection[Any],
    review_id: UUID,
    sheet_version: int | None,
    source: str,
    note: str,
    call_id: UUID | None,
    findings: list[Finding],
) -> None:
    with transaction(connection) as cursor:
        # The agent's earlier proposals are superseded by this re-performance.
        cursor.execute(
            "UPDATE review_notes SET status = 'WITHDRAWN', version = version + 1 "
            "WHERE control_review_id = %s AND raised_by = 'AGENT' AND status = 'PROPOSED'",
            (review_id,),
        )
        scope = cursor.execute(
            "SELECT organization_id, project_id FROM control_reviews WHERE id = %s",
            (review_id,),
        ).fetchone()
        if scope is None:
            return
        for finding in findings[:MAX_NOTES]:
            _insert_note(
                cursor,
                UUID(str(scope[0])),
                UUID(str(scope[1])),
                review_id,
                finding,
                "AGENT",
                None,
                "PROPOSED",
            )
        cursor.execute(
            """
            UPDATE control_reviews
            SET reperform_status = CASE WHEN reperform_requested_at > reperform_started_at
                                        THEN 'PENDING' ELSE 'IDLE' END,
                attempts = 0, lease_until = NULL, reperformed_at = clock_timestamp(),
                reperform_source = %s, reperform_note = %s, reperform_call_id = %s,
                sheet_version_reviewed = %s, version = version + 1
            WHERE id = %s AND reperform_status = 'WORKING'
            """,
            (source, note[:500], call_id, sheet_version, review_id),
        )
        _audit(
            cursor,
            UUID(str(scope[0])),
            UUID(str(scope[1])),
            None,
            review_id,
            "review.reperformed",
            {"source": source, "notes": min(len(findings), MAX_NOTES)},
        )


def _insert_note(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    finding: Finding,
    raised_by: str,
    user_id: UUID | None,
    status: str,
) -> UUID:
    row = cursor.execute(
        """
        INSERT INTO review_notes (organization_id, project_id, control_review_id, number,
                                  target_kind, target, text, severity, status, raised_by,
                                  raised_by_user)
        VALUES (%s, %s, %s,
                (SELECT coalesce(max(number), 0) + 1 FROM review_notes
                 WHERE control_review_id = %s),
                %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            organization_id,
            project_id,
            review_id,
            review_id,
            finding.target_kind,
            Json(finding.target),
            finding.text[:2000],
            finding.severity,
            status,
            raised_by,
            user_id,
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


# Reading a review


class NoteBody(BaseModel):
    id: UUID
    number: int
    target_kind: TargetKind
    target: dict[str, Any]
    text: str
    severity: Severity
    status: NoteStatus
    raised_by: Literal["AGENT", "PERSON"]
    raised_by_name: str | None
    raised_at: datetime
    decided_by_name: str | None
    decision_reason: str
    response: str
    responded_by_name: str | None
    responded_at: datetime | None
    cleared_by_name: str | None
    cleared_at: datetime | None
    clear_reason: str
    reopened: list[str]
    version: int


class ReviewWorkpaper(BaseModel):
    id: UUID
    stage: str
    status: str
    prepared_by: str | None


class ReviewBody(BaseModel):
    id: UUID
    control_id: UUID
    control_ref: str
    label: str
    application_name: str
    status: Literal["OPEN", "SIGNED_OFF"]
    reperforming: bool
    reperform_state: RunState = "IDLE"
    reperformed_at: datetime | None
    reperform_source: str | None
    reperform_note: str
    sheet_status: str | None
    sheet_signed_by: str | None
    sheet_version: int | None
    sheet_version_reviewed: int | None
    workpapers: list[ReviewWorkpaper]
    notes: list[NoteBody]
    counts: dict[str, int]
    # What keeps the reviewer from signing off, in their words.
    blocking: list[str]
    # Whether the viewer may decide notes and sign off: a reviewer who did not prepare.
    viewer_is_reviewer: bool
    viewer_prepared: bool
    # False only in development: a preparer may then sign off their own work.
    independence_required: bool = True
    signed_by: str | None
    signed_at: datetime | None
    signoff_note: str
    version: int


def reviews(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> list[ReviewBody]:
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    rows = connection.execute(
        "SELECT id FROM control_reviews WHERE project_id = %s AND organization_id = %s "
        "ORDER BY created_at",
        (project_id, organization_id),
    ).fetchall()
    reviewer = _is_reviewer(connection, project_id, principal.id)
    return [
        _review(connection, project_id, UUID(str(row[0])), principal.id, reviewer) for row in rows
    ]


def _review(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    review_id: UUID,
    viewer: UUID,
    reviewer: bool,
) -> ReviewBody:
    row = connection.execute(
        """
        SELECT r.id, r.engagement_control_id, c.control_ref, a.name, r.status,
               r.reperform_status, r.reperformed_at, r.reperform_source, r.reperform_note,
               r.sheet_version_reviewed, u.display_name, r.signed_at, r.signoff_note,
               r.version, r.signed_by
        FROM control_reviews r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN users u ON u.id = r.signed_by
        WHERE r.id = %s AND r.project_id = %s
        """,
        (review_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    control_id = UUID(str(row[1]))
    sheet = connection.execute(
        """
        SELECT s.status, u.display_name, s.version, s.signed_by
        FROM test_sheets s LEFT JOIN users u ON u.id = s.signed_by
        WHERE s.project_id = %s AND s.engagement_control_id = %s AND s.test_round_id IS NULL
        """,
        (project_id, control_id),
    ).fetchone()
    papers = connection.execute(
        """
        SELECT w.id, w.stage, w.status, u.display_name, w.prepared_by
        FROM workpapers w LEFT JOIN users u ON u.id = w.prepared_by
        WHERE w.project_id = %s AND w.engagement_control_id = %s
        ORDER BY w.stage
        """,
        (project_id, control_id),
    ).fetchall()
    notes = _notes(connection, review_id)
    counts = {
        status: sum(1 for note in notes if note.status == status)
        for status in ("PROPOSED", "OPEN", "RESPONDED", "CLEARED", "DISMISSED")
    }
    prepared = (sheet is not None and sheet[3] == viewer) or any(p[4] == viewer for p in papers)
    blocking: list[str] = []
    if sheet is None or sheet[0] != "SIGNED_OFF":
        blocking.append("the testing is not signed off")
    effectiveness = next((p for p in papers if p[1] == "EFFECTIVENESS"), None)
    if effectiveness is None or effectiveness[2] != "PREPARED":
        blocking.append("the effectiveness workpaper is not prepared")
    if row[5] != "IDLE":
        blocking.append("the reviewer agent is still re-performing the testing")
    elif row[6] is None:
        blocking.append("the testing has not been re-performed")
    elif sheet is not None and row[9] is not None and int(sheet[2]) != int(row[9]):
        blocking.append("the testing changed since it was re-performed")
    waiting = counts["PROPOSED"] + counts["OPEN"] + counts["RESPONDED"]
    if waiting:
        blocking.append(f"{_count(waiting, 'note')} not cleared yet")
    return ReviewBody(
        id=review_id,
        control_id=control_id,
        control_ref=str(row[2]),
        label=control_label(str(row[2]), None if row[3] is None else str(row[3])),
        application_name="" if row[3] is None else str(row[3]),
        status="SIGNED_OFF" if row[4] == "SIGNED_OFF" else "OPEN",
        reperforming=row[5] in ("PENDING", "WORKING"),
        reperform_state=run_state(row[5]),
        reperformed_at=row[6],
        reperform_source=None if row[7] is None else str(row[7]),
        reperform_note=str(row[8]),
        sheet_status=None if sheet is None else str(sheet[0]),
        sheet_signed_by=None if sheet is None or sheet[1] is None else str(sheet[1]),
        sheet_version=None if sheet is None else int(sheet[2]),
        sheet_version_reviewed=None if row[9] is None else int(row[9]),
        workpapers=[
            ReviewWorkpaper(
                id=UUID(str(p[0])),
                stage=str(p[1]),
                status=str(p[2]),
                prepared_by=None if p[3] is None else str(p[3]),
            )
            for p in papers
        ],
        notes=notes,
        counts=counts,
        blocking=blocking,
        viewer_is_reviewer=reviewer,
        viewer_prepared=prepared,
        independence_required=independence.required(),
        signed_by=None if row[10] is None else str(row[10]),
        signed_at=row[11],
        signoff_note=str(row[12]),
        version=int(row[13]),
    )


def _notes(connection: psycopg.Connection[Any], review_id: UUID) -> list[NoteBody]:
    rows = connection.execute(
        """
        SELECT n.id, n.number, n.target_kind, n.target, n.text, n.severity, n.status,
               n.raised_by, ru.display_name, n.raised_at, du.display_name, n.decision_reason,
               n.response, pu.display_name, n.responded_at, cu.display_name, n.cleared_at,
               n.clear_reason, n.reopened, n.version
        FROM review_notes n
        LEFT JOIN users ru ON ru.id = n.raised_by_user
        LEFT JOIN users du ON du.id = n.decided_by
        LEFT JOIN users pu ON pu.id = n.responded_by
        LEFT JOIN users cu ON cu.id = n.cleared_by
        WHERE n.control_review_id = %s
        ORDER BY n.number
        """,
        (review_id,),
    ).fetchall()
    return [
        NoteBody(
            id=UUID(str(r[0])),
            number=int(r[1]),
            target_kind=r[2],
            target=r[3] if isinstance(r[3], dict) else {},
            text=str(r[4]),
            severity=r[5],
            status=r[6],
            raised_by=r[7],
            raised_by_name=None if r[8] is None else str(r[8]),
            raised_at=r[9],
            decided_by_name=None if r[10] is None else str(r[10]),
            decision_reason=str(r[11]),
            response=str(r[12]),
            responded_by_name=None if r[13] is None else str(r[13]),
            responded_at=r[14],
            cleared_by_name=None if r[15] is None else str(r[15]),
            cleared_at=r[16],
            clear_reason=str(r[17]),
            reopened=[str(item) for item in r[18]] if isinstance(r[18], list) else [],
            version=int(r[19]),
        )
        for r in rows
    ]


def review_states(
    connection: psycopg.Connection[Any], project_id: UUID
) -> dict[UUID, tuple[ReviewStatus, ReviewLeft]]:
    """Per control: the review's status and what it waits for (for the register)."""
    states: dict[UUID, tuple[ReviewStatus, ReviewLeft]] = {}
    for (
        control_id,
        status,
        reperform,
        reperformed_at,
        proposed,
        open_,
        responded,
    ) in connection.execute(
        """
            SELECT r.engagement_control_id, r.status, r.reperform_status, r.reperformed_at,
                   count(*) FILTER (WHERE n.status = 'PROPOSED'),
                   count(*) FILTER (WHERE n.status = 'OPEN'),
                   count(*) FILTER (WHERE n.status = 'RESPONDED')
            FROM control_reviews r
            LEFT JOIN review_notes n ON n.control_review_id = r.id
            WHERE r.project_id = %s
            GROUP BY r.id
            """,
        (project_id,),
    ).fetchall():
        left: ReviewLeft = (
            "SIGNED"
            if status == "SIGNED_OFF"
            else "REPERFORMING"
            if reperform != "IDLE"
            else "DECIDE"
            if proposed
            else "ADDRESS"
            if open_
            else "CLEAR"
            if responded
            else "SIGN"
            if reperformed_at is not None
            else "REPERFORM"
        )
        states[UUID(str(control_id))] = (
            "SIGNED_OFF" if status == "SIGNED_OFF" else "OPEN",
            left,
        )
    return states


class ReviewOverview(BaseModel):
    """Where the engagement's independent review stands (Milestone 9.2)."""

    in_scope: int
    not_started: int
    reperforming: int
    to_decide: int
    to_address: int
    to_clear: int
    to_sign: int
    signed_off: int
    open_notes: int
    # Every in-scope control instance's review is signed off.
    complete: bool


REVIEW_MILESTONE = "REVIEW_COMPLETE"


def review_overview(connection: psycopg.Connection[Any], project_id: UUID) -> ReviewOverview:
    states = review_states(connection, project_id)
    included = [
        UUID(str(row[0]))
        for row in connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included",
            (project_id,),
        ).fetchall()
    ]
    left = [states[control_id][1] for control_id in included if control_id in states]
    open_notes = connection.execute(
        """
        SELECT count(*) FROM review_notes n
        JOIN control_reviews r ON r.id = n.control_review_id
        WHERE r.project_id = %s AND n.status IN ('PROPOSED', 'OPEN', 'RESPONDED')
        """,
        (project_id,),
    ).fetchone()
    signed = sum(1 for item in left if item == "SIGNED")
    return ReviewOverview(
        in_scope=len(included),
        not_started=sum(1 for control_id in included if control_id not in states),
        reperforming=sum(1 for item in left if item == "REPERFORMING"),
        to_decide=sum(1 for item in left if item == "DECIDE"),
        to_address=sum(1 for item in left if item == "ADDRESS"),
        to_clear=sum(1 for item in left if item == "CLEAR"),
        to_sign=sum(1 for item in left if item in ("SIGN", "REPERFORM")),
        signed_off=signed,
        open_notes=0 if open_notes is None else int(open_notes[0]),
        complete=len(included) > 0 and signed == len(included),
    )


def _update_completion(cursor: psycopg.Cursor[Any], project_id: UUID, actor: UUID) -> None:
    """The review milestone is done when every in-scope instance is signed off, and
    undone when one is opened again."""
    overview = review_overview(cursor.connection, project_id)
    if overview.complete:
        cursor.execute(
            """
            UPDATE engagement_milestones
            SET completed_at = clock_timestamp(), completed_by = %s, version = version + 1
            WHERE project_id = %s AND milestone_key = %s AND completed_at IS NULL
            """,
            (actor, project_id, REVIEW_MILESTONE),
        )
    else:
        cursor.execute(
            """
            UPDATE engagement_milestones
            SET completed_at = NULL, completed_by = NULL, version = version + 1
            WHERE project_id = %s AND milestone_key = %s AND completed_at IS NOT NULL
            """,
            (project_id, REVIEW_MILESTONE),
        )


REVIEW_STEPS: dict[str, tuple[str, Literal["TEAM", "OWNER", "AGENT", "NONE"]]] = {
    "REPERFORMING": ("The reviewer is re-performing the testing", "AGENT"),
    "REPERFORM": ("Re-perform the testing for review", "TEAM"),
    "DECIDE": ("Decide the reviewer's notes", "TEAM"),
    "ADDRESS": ("Address the review notes", "TEAM"),
    "CLEAR": ("Clear the answered review notes", "TEAM"),
    "SIGN": ("Sign off the review", "TEAM"),
}


# Changes by people


class VersionBody(BaseModel):
    version: int = Field(ge=1)


class NoteCreate(BaseModel):
    version: int = Field(ge=1)
    target_kind: TargetKind = "GENERAL"
    severity: Severity = "SHOULD_FIX"
    text: str = Field(min_length=3, max_length=2000)
    item_id: UUID | None = None
    workpaper_id: UUID | None = None


class NoteDecision(BaseModel):
    version: int = Field(ge=1)
    action: Literal["ACCEPT", "DISMISS"]
    reason: str = Field(default="", max_length=500)


class NoteResponse(BaseModel):
    version: int = Field(ge=1)
    response: str = Field(min_length=3, max_length=2000)


class NoteClear(BaseModel):
    version: int = Field(ge=1)
    action: Literal["CLEAR", "RETURN"] = "CLEAR"
    reason: str = Field(default="", max_length=500)


class SignOffBody(BaseModel):
    version: int = Field(ge=1)
    note: str = Field(default="", max_length=1000)


class ReopenBody(BaseModel):
    version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


def register_control_reviews(app: FastAPI, settings: Settings, scheduler: Any) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/reviews"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda c: work(c, principal))
        except ReviewState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except SheetState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None

    def changed(
        request: Request,
        work: Callable[[psycopg.Connection[Any], Principal], tuple[ReviewBody, list[UUID]]],
    ) -> ReviewBody:
        body, queued = run(request, work)
        schedule_reviews(scheduler, queued)
        return body

    @app.get(base)
    def list_reviews(organization_id: UUID, project_id: UUID, request: Request) -> list[ReviewBody]:
        return run(request, lambda c, p: reviews(c, p, organization_id, project_id))

    @app.post(f"{base}/{{review_id}}/reperform")
    def reperform(
        organization_id: UUID, project_id: UUID, review_id: UUID, body: VersionBody,
        request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request,
            lambda c, p: _reperform(c, p, organization_id, project_id, review_id, body),
        )

    @app.post(f"{base}/{{review_id}}/notes")
    def add_note(
        organization_id: UUID, project_id: UUID, review_id: UUID, body: NoteCreate,
        request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request, lambda c, p: _add_note(c, p, organization_id, project_id, review_id, body)
        )

    @app.post(f"{base}/{{review_id}}/notes/{{note_id}}/decide")
    def decide_note(
        organization_id: UUID, project_id: UUID, review_id: UUID, note_id: UUID,
        body: NoteDecision, request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request,
            lambda c, p: _decide_note(c, p, organization_id, project_id, review_id, note_id, body),
        )

    @app.post(f"{base}/{{review_id}}/notes/{{note_id}}/respond")
    def respond_note(
        organization_id: UUID, project_id: UUID, review_id: UUID, note_id: UUID,
        body: NoteResponse, request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request,
            lambda c, p: _respond_note(c, p, organization_id, project_id, review_id, note_id, body),
        )

    @app.post(f"{base}/{{review_id}}/notes/{{note_id}}/clear")
    def clear_note(
        organization_id: UUID, project_id: UUID, review_id: UUID, note_id: UUID,
        body: NoteClear, request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request,
            lambda c, p: _clear_note(c, p, organization_id, project_id, review_id, note_id, body),
        )

    @app.post(f"{base}/{{review_id}}/sign-off")
    def sign_off(
        organization_id: UUID, project_id: UUID, review_id: UUID, body: SignOffBody,
        request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request, lambda c, p: _sign_off(c, p, organization_id, project_id, review_id, body)
        )

    @app.post(f"{base}/{{review_id}}/reopen")
    def reopen(
        organization_id: UUID, project_id: UUID, review_id: UUID, body: ReopenBody,
        request: Request,
    ) -> ReviewBody:  # fmt: skip
        return changed(
            request, lambda c, p: _reopen(c, p, organization_id, project_id, review_id, body)
        )


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


def _is_reviewer(connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID) -> bool:
    if not independence.required():
        # Development only: anyone on the team can act as the reviewer.
        row = connection.execute(
            "SELECT 1 FROM project_memberships WHERE project_id = %s AND user_id = %s",
            (project_id, user_id),
        ).fetchone()
        return row is not None
    row = connection.execute(
        "SELECT 1 FROM project_memberships WHERE project_id = %s AND user_id = %s "
        "AND engagement_role = 'REVIEWER'",
        (project_id, user_id),
    ).fetchone()
    return row is not None


def _reviewer(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> None:
    """Deciding, clearing, and signing off are the engagement reviewer's."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    if not _is_reviewer(connection, project_id, principal.id):
        raise ReviewState("only a team member with the reviewer role can do this")


def _locked(
    cursor: psycopg.Cursor[Any], project_id: UUID, review_id: UUID, version: int
) -> tuple[UUID, UUID, str]:
    """The review, locked: (organization_id, control_id, status)."""
    row = cursor.execute(
        "SELECT organization_id, engagement_control_id, status, version FROM control_reviews "
        "WHERE id = %s AND project_id = %s FOR UPDATE",
        (review_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    if int(row[3]) != version:
        raise ReviewState("the review changed")
    return UUID(str(row[0])), UUID(str(row[1])), str(row[2])


def _locked_note(
    cursor: psycopg.Cursor[Any], review_id: UUID, note_id: UUID
) -> tuple[str, str, str, dict[str, Any]]:
    """A note, locked: (status, severity, target_kind, target)."""
    row = cursor.execute(
        "SELECT status, severity, target_kind, target FROM review_notes "
        "WHERE id = %s AND control_review_id = %s FOR UPDATE",
        (note_id, review_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return str(row[0]), str(row[1]), str(row[2]), row[3] if isinstance(row[3], dict) else {}


def _bump(cursor: psycopg.Cursor[Any], review_id: UUID) -> None:
    cursor.execute("UPDATE control_reviews SET version = version + 1 WHERE id = %s", (review_id,))


def _result(
    connection: psycopg.Connection[Any], project_id: UUID, review_id: UUID, viewer: UUID
) -> ReviewBody:
    return _review(
        connection, project_id, review_id, viewer, _is_reviewer(connection, project_id, viewer)
    )


def _reperform(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    body: VersionBody,
) -> tuple[ReviewBody, list[UUID]]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    with transaction(connection) as cursor:
        _org, _control, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        queued = request_reperformance(cursor, review_id)
        _bump(cursor, review_id)
        _audit(cursor, organization_id, project_id, principal.id, review_id,
               "review.reperform_requested", {})  # fmt: skip
    return _result(connection, project_id, review_id, principal.id), (
        [] if queued is None else [queued]
    )


def _add_note(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    body: NoteCreate,
) -> tuple[ReviewBody, list[UUID]]:
    _reviewer(connection, principal, organization_id, project_id)
    text = clean_text(body.text, 2000).text
    if len(text) < 3:
        raise ValueError("a note needs text")
    with transaction(connection) as cursor:
        _org, control_id, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        target: dict[str, Any] = {}
        if body.item_id is not None:
            target["item_id"] = str(body.item_id)
        if body.workpaper_id is not None:
            target["workpaper_id"] = str(body.workpaper_id)
        finding = Finding(body.target_kind, target, body.severity, text)
        note_id = _insert_note(
            cursor, organization_id, project_id, review_id, finding, "PERSON", principal.id, "OPEN"
        )
        reopened = (
            _reopen_for(cursor, principal, organization_id, project_id, control_id, finding)
            if body.severity == "MUST_FIX"
            else []
        )
        cursor.execute(
            "UPDATE review_notes SET reopened = %s WHERE id = %s", (Json(reopened), note_id)
        )
        _bump(cursor, review_id)
        _audit(
            cursor,
            organization_id,
            project_id,
            principal.id,
            review_id,
            "review.note_raised",
            {"note_id": str(note_id), "severity": body.severity, "reopened": reopened},
        )
    return _result(connection, project_id, review_id, principal.id), []


def _decide_note(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    note_id: UUID,
    body: NoteDecision,
) -> tuple[ReviewBody, list[UUID]]:
    _reviewer(connection, principal, organization_id, project_id)
    reason = clean_line(body.reason, 500)
    if body.action == "DISMISS" and len(reason) < 3:
        raise ValueError("a reason is required to dismiss a note")
    with transaction(connection) as cursor:
        _org, control_id, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        note_status, severity, kind, target = _locked_note(cursor, review_id, note_id)
        if note_status != "PROPOSED":
            raise ReviewState("the note is already decided")
        reopened: list[str] = []
        if body.action == "ACCEPT" and severity == "MUST_FIX":
            text_row = cursor.execute(
                "SELECT text FROM review_notes WHERE id = %s", (note_id,)
            ).fetchone()
            finding = Finding(
                kind,  # type: ignore[arg-type]
                target,
                "MUST_FIX",
                "" if text_row is None else str(text_row[0]),
            )
            reopened = _reopen_for(
                cursor, principal, organization_id, project_id, control_id, finding
            )
        cursor.execute(
            """
            UPDATE review_notes
            SET status = %s, decided_by = %s, decided_at = clock_timestamp(),
                decision_reason = %s, reopened = %s, version = version + 1
            WHERE id = %s
            """,
            (
                "OPEN" if body.action == "ACCEPT" else "DISMISSED",
                principal.id,
                reason,
                Json(reopened),
                note_id,
            ),
        )
        _bump(cursor, review_id)
        _audit(cursor, organization_id, project_id, principal.id, review_id, "review.note_decided",
               {"note_id": str(note_id), "action": body.action, "reason": reason,
                "reopened": reopened})  # fmt: skip
    return _result(connection, project_id, review_id, principal.id), []


def _respond_note(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    note_id: UUID,
    body: NoteResponse,
) -> tuple[ReviewBody, list[UUID]]:
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    response = clean_text(body.response, 2000).text
    if len(response) < 3:
        raise ValueError("a response needs text")
    with transaction(connection) as cursor:
        _org, _control, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        note_status, _severity, _kind, _target = _locked_note(cursor, review_id, note_id)
        if note_status != "OPEN":
            raise ReviewState("the note is not open")
        cursor.execute(
            """
            UPDATE review_notes
            SET status = 'RESPONDED', response = %s, responded_by = %s,
                responded_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            """,
            (response, principal.id, note_id),
        )
        _bump(cursor, review_id)
        _audit(cursor, organization_id, project_id, principal.id, review_id,
               "review.note_responded", {"note_id": str(note_id)})  # fmt: skip
    return _result(connection, project_id, review_id, principal.id), []


def _clear_note(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    note_id: UUID,
    body: NoteClear,
) -> tuple[ReviewBody, list[UUID]]:
    _reviewer(connection, principal, organization_id, project_id)
    reason = clean_line(body.reason, 500)
    if body.action == "RETURN" and len(reason) < 3:
        raise ValueError("say what is still missing to return a note")
    with transaction(connection) as cursor:
        _org, _control, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        note_status, _severity, _kind, _target = _locked_note(cursor, review_id, note_id)
        if note_status not in ("OPEN", "RESPONDED"):
            raise ReviewState("the note is not open")
        if body.action == "RETURN":
            if note_status != "RESPONDED":
                raise ReviewState("only an answered note can be returned")
            cursor.execute(
                "UPDATE review_notes SET status = 'OPEN', clear_reason = %s, "
                "version = version + 1 WHERE id = %s",
                (reason, note_id),
            )
        else:
            cursor.execute(
                """
                UPDATE review_notes
                SET status = 'CLEARED', cleared_by = %s, cleared_at = clock_timestamp(),
                    clear_reason = %s, version = version + 1
                WHERE id = %s
                """,
                (principal.id, reason, note_id),
            )
        _bump(cursor, review_id)
        _audit(cursor, organization_id, project_id, principal.id, review_id, "review.note_cleared",
               {"note_id": str(note_id), "action": body.action, "reason": reason})  # fmt: skip
    return _result(connection, project_id, review_id, principal.id), []


def _sign_off(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    body: SignOffBody,
) -> tuple[ReviewBody, list[UUID]]:
    _reviewer(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        _org, control_id, status = _locked(cursor, project_id, review_id, body.version)
        if status != "OPEN":
            raise ReviewState("the review is signed off")
        current = _review(cursor.connection, project_id, review_id, principal.id, True)
        if current.blocking:
            raise ReviewState("; ".join(current.blocking))
        if current.viewer_prepared and independence.required():
            raise ReviewState(
                "you signed off the testing or prepared a workpaper; "
                "another reviewer must sign off the review"
            )
        cursor.execute(
            """
            UPDATE control_reviews
            SET status = 'SIGNED_OFF', signed_by = %s, signed_at = clock_timestamp(),
                signoff_note = %s, version = version + 1
            WHERE id = %s
            """,
            (principal.id, clean_text(body.note, 1000).text, review_id),
        )
        cursor.execute(
            """
            UPDATE tasks SET status = 'SUCCEEDED', version = version + 1
            WHERE project_id = %s AND engagement_control_id = %s AND plan_kind = 'review'
              AND status NOT IN ('SUCCEEDED', 'CANCELLED')
            """,
            (project_id, control_id),
        )
        _audit(cursor, organization_id, project_id, principal.id, review_id, "review.signed_off",
               {"notes": current.counts})  # fmt: skip
        _update_completion(cursor, project_id, principal.id)
    return _result(connection, project_id, review_id, principal.id), []


def _reopen(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    review_id: UUID,
    body: ReopenBody,
) -> tuple[ReviewBody, list[UUID]]:
    _reviewer(connection, principal, organization_id, project_id)
    with transaction(connection) as cursor:
        _org, control_id, status = _locked(cursor, project_id, review_id, body.version)
        if status != "SIGNED_OFF":
            raise ReviewState("the review is open")
        cursor.execute(
            """
            UPDATE control_reviews
            SET status = 'OPEN', signed_by = NULL, signed_at = NULL, signoff_note = '',
                version = version + 1
            WHERE id = %s
            """,
            (review_id,),
        )
        cursor.execute(
            """
            UPDATE tasks SET status = 'REVIEW', version = version + 1
            WHERE project_id = %s AND engagement_control_id = %s AND plan_kind = 'review'
              AND status = 'SUCCEEDED'
            """,
            (project_id, control_id),
        )
        _audit(cursor, organization_id, project_id, principal.id, review_id, "review.reopened",
               {"reason": clean_line(body.reason, 500)})  # fmt: skip
        _update_completion(cursor, project_id, principal.id)
    return _result(connection, project_id, review_id, principal.id), []


def _reopen_for(
    cursor: psycopg.Cursor[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    finding: Finding,
) -> list[str]:
    """A note that must be fixed reopens what it is about, with the note as the reason.

    A result or sample note reopens the test sheet, and with it the effectiveness
    workpaper that was prepared from it; a workpaper note reopens that workpaper. What
    could not be reopened (a sheet whose deficiency is logged) is said in the note.
    """
    reason = clean_line(f"Review note: {finding.text}", 500)
    reopened: list[str] = []
    if finding.target_kind in ("RESULT", "SAMPLE"):
        sheet = cursor.execute(
            """
            SELECT id, status, version, engagement_control_id, method, attributes,
                   proposal_status, proposal
            FROM test_sheets
            WHERE project_id = %s AND engagement_control_id = %s AND test_round_id IS NULL
            FOR UPDATE
            """,
            (project_id, control_id),
        ).fetchone()
        if sheet is not None and sheet[1] == "SIGNED_OFF":
            try:
                reopen_work(SheetReopenBody(version=int(sheet[2]), reason=reason))(
                    cursor, principal, sheet, organization_id, project_id
                )
                cursor.execute(
                    "UPDATE test_sheets SET version = version + 1 WHERE id = %s", (sheet[0],)
                )
                reopened.append("SHEET")
            except SheetState as error:
                reopened.append(f"SHEET not reopened: {error.detail}")
        if "SHEET" in reopened:
            reopened.extend(
                _reopen_workpaper(cursor, principal, organization_id, project_id, control_id,
                                  "EFFECTIVENESS", None, reason)
            )  # fmt: skip
    elif finding.target_kind == "WORKPAPER":
        wanted = finding.target.get("workpaper_id")
        reopened.extend(
            _reopen_workpaper(
                cursor, principal, organization_id, project_id, control_id, None,
                None if not isinstance(wanted, str) else UUID(wanted), reason,
            )
        )  # fmt: skip
    return reopened


def _reopen_workpaper(
    cursor: psycopg.Cursor[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    stage: str | None,
    workpaper_id: UUID | None,
    reason: str,
) -> list[str]:
    from ai_workforce_api.workpaper_service import _audit as audit_workpaper

    rows = cursor.execute(
        """
        SELECT id, status FROM workpapers
        WHERE project_id = %s AND engagement_control_id = %s
          AND (%s::text IS NULL OR stage = %s) AND (%s::uuid IS NULL OR id = %s)
        FOR UPDATE
        """,
        (project_id, control_id, stage, stage, workpaper_id, workpaper_id),
    ).fetchall()
    reopened: list[str] = []
    for paper_id, status in rows:
        if status != "PREPARED":
            continue
        cursor.execute(
            """
            UPDATE workpapers
            SET status = 'DRAFT', prepared_by = NULL, prepared_at = NULL,
                prepared_version = NULL, version = version + 1
            WHERE id = %s
            """,
            (paper_id,),
        )
        audit_workpaper(
            cursor, organization_id, project_id, principal.id, UUID(str(paper_id)),
            "workpaper.reopened", {"reason": reason},
        )  # fmt: skip
        reopened.append(f"WORKPAPER:{paper_id}")
    return reopened


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor_id: UUID | None,
    review_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'control_review', %s, %s)
        """,
        (organization_id, project_id, actor_id, action, review_id, Json(payload)),
    )


def summary_json(body: ReviewBody) -> str:
    """The review as the console and tests read it."""
    return json.dumps(body.model_dump(mode="json"), ensure_ascii=False)
