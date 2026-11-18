"""Redraft a section a person has edited (docs/design-workpaper.md, section 3.11).

"Draft again" never replaces a section a person saved (workpaper_service.drafted_by_agent).
From a text section's editor, the person may instead ask the agent to redraft that one
section: a registered agent run (the workpaper preparer, prompt workpaper-preparer/5),
through the durable workflow engine as a draft is, under the same safeguards: the same
standing instructions and facts, the auditor's record and the evidence as data, the model
budgets, the cancellation check and the run record. The section's current text is given
inside the facts as data (`preparer_current_text`), never as instructions.

The result is a proposal (migration 0170, workpaper_section_proposals), the agent's and
never a person's: its text is cleaned and its citations checked as a draft's are, with the
removed-quotation sentence of section 3.10. Nothing in the workpaper changes: not its
content, its versions or its counters. Only the person's own save of the section
(workpaper_service._edit, with `proposal_id`) makes a version, whose note says it began as
the agent's draft and whose audit event names the proposal; the proposal then ends USED.
Agent output is never recorded as a person's: the person's working copy of the section
(workpaper_drafts) names the proposal its text came from, so a save after leaving and
returning still says so, and a save from a proposal a newer request superseded is still
accepted and still says so (the proposal stays SUPERSEDED: it is never rewritten).

One proposal stands per workpaper, section and person who asked, and only that person reads
it. It ends once: USED, KEPT_MINE, or SUPERSEDED (a newer request, a version of the section
saved on another basis, or the workpaper prepared). A run whose proposal ended meanwhile
stops before its model call, or writes nothing after it. Section text is never logged here.
"""

import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, Protocol, runtime_checkable
from uuid import UUID, uuid4

import psycopg
from fastapi import FastAPI, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field, ValidationError

from ai_workforce_api.authorization import Action, NotVisible, Principal
from ai_workforce_api.db import connect, independent_steps, transaction
from ai_workforce_api.model_providers import live_model, provider_for
from ai_workforce_api.models import ModelProvider, ModelRequest
from ai_workforce_api.provenance import AgentCaller, Job, agent_actor
from ai_workforce_api.settings import Settings
from ai_workforce_api.workpaper_drafts import Run, _visible
from ai_workforce_api.workpaper_fill import Content, Section, gather
from ai_workforce_api.workpaper_marks import plain
from ai_workforce_api.workpaper_service import (
    DRAFT_SCHEMA,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    WorkpaperState,
    _Answer,
    _apply,
    _audit,
    _content,
    _locked,
    _person,
    agent_drafts,
    design_inputs,
    has_input,
    prompt_for,
    removed_note,
)

logger = logging.getLogger(__name__)

AGENT_KEY = "workpaper-preparer"
NOT_MIGRATED = "section proposals are not on record: migration 0170 is not applied"

# Refusals, one sentence each. The first four are the section edit's own
# (workpaper_service._edit), so the page reads them as it reads an edit's.
PREPARED = "the workpaper is prepared; reopen it to change it"
DRAFTING = "the agent is drafting it"
CHANGED = "the workpaper changed; refresh and edit the latest version"
NO_DRAFT = "the workpaper has no draft yet"
NOT_DRAFTED = "The agent does not draft this section."
PROPOSAL_CHANGED = "The agent's draft changed; read it again."

# Why a proposal FAILED, one plain sentence each.
NO_MODEL = "No model is configured, so the agent cannot redraft the section."
NO_ENGINE = "The agent's background work is not running, so the section cannot be redrafted now."
NOT_STARTED = "The agent could not be started; try again."
NO_INPUT = "The agent redrafts once evidence has been read or the testing is signed off."
NOT_A_SECTION = "The section is no longer one the agent drafts."
NOT_MATCHED = "The agent's draft did not match the section; try again."
RUN_FAILED = "The agent could not finish the draft; try again."
CALL_FAILED = {
    "TIMEOUT": "The model did not answer in time; try again.",
    "RATE_LIMITED": "The model was rate limited; try again shortly.",
    "MODEL_ERROR": "The model could not be used; check the model configuration and key.",
    "MALFORMED": "The model's answer was not in the required format; try again.",
    "BUDGET_EXCEEDED": "The model budget is exhausted, so the agent did not redraft the section.",
    "CANCELLED": "The model call was cancelled.",
}

_COLUMNS = (
    "id, section_key, based_on, status, text, citations, words, requested_at, ready_at, "
    "failure, removed_note"
)
_MARK = re.compile(r"\[\^(\d+)\]")
# A list item's "- " or "1. " at the start of a line of plain text (workpaper_marks.plain).
_ITEM = re.compile(r"^(?:-|\d+\.)\s+")


class RedraftBody(BaseModel):
    # The workpaper version (current_version) the editor shows, so a redraft is never of
    # an older text.
    workpaper_version: int = Field(ge=1)


class ProposalBody(BaseModel):
    id: UUID
    section_key: str
    based_on: int
    status: Literal["PENDING", "READY", "FAILED"]
    # "" unless READY.
    text: str
    # As a text section's citations in the workpaper's content.
    citations: list[dict[str, Any]]
    words: int
    requested_at: datetime
    ready_at: datetime | None
    # "" unless FAILED: one plain sentence.
    failure: str
    # The sentence of section 3.10 for the quotations removed from this section, or "".
    removed_note: str


class ProposalEnvelope(BaseModel):
    proposal: ProposalBody | None


@dataclass(frozen=True)
class UsedProposal:
    """The proposal a section's save began from: its id, its citations (the marks of its
    text), the sentence the version's note adds, and whether it still stands (it then ends
    USED) or a newer request or version superseded it (it then stays SUPERSEDED)."""

    id: UUID
    citations: list[dict[str, Any]]
    note: str
    standing: bool = True


@runtime_checkable
class RedraftScheduler(Protocol):
    def schedule_workpaper_redrafts(self, proposal_ids: list[UUID]) -> None: ...


def _body(row: Sequence[Any]) -> ProposalBody:
    citations = row[5] if isinstance(row[5], list) else []
    return ProposalBody(
        id=row[0],
        section_key=str(row[1]),
        based_on=int(row[2]),
        status=row[3],
        text=str(row[4]),
        citations=[c for c in citations if isinstance(c, dict)],
        words=int(row[6]),
        requested_at=row[7],
        ready_at=row[8],
        failure=str(row[9]),
        removed_note=str(row[10]),
    )


def when(at: datetime) -> str:
    """When a draft was made, as a version's note says it: "16 Nov 10:42" (UTC)."""
    moment = at.astimezone(UTC)
    return f"{moment.day} {moment:%b %H:%M}"


def words_of(text: str) -> int:
    """How many words a section's text has, without its marks, its citation marks and a
    list item's "- " or number."""
    lines = plain(_MARK.sub("", text)).split("\n")
    return sum(len(_ITEM.sub("", line).split()) for line in lines)


def current_text(section: Section) -> str:
    """The section's current text as a redraft is given it: as stored, with each of its
    citation marks written out as the citation it stands for ([cite:<file_id> "words"]),
    so that a reference the preparer kept is kept, and checked again, by the redraft. A
    mark with no citation on record is left out."""
    cited: dict[int, tuple[str, str]] = {}
    for citation in section.citations:
        number, file_id = citation.get("number"), citation.get("evidence_file_id")
        quote = str(citation.get("quote") or "")[:200]
        if isinstance(number, int) and isinstance(file_id, str) and len(quote.strip()) >= 3:
            if '"' not in quote and "”" not in quote:
                cited[number] = (file_id, quote)

    def written(found: re.Match[str]) -> str:
        source = cited.get(int(found.group(1)))
        return "" if source is None else f'[cite:{source[0]} "{source[1]}"]'

    return _MARK.sub(written, section.text)


def changed_keys(old: Content | None, new: Content) -> list[str]:
    """The sections whose content a new version changed (all of them when there was none
    before)."""
    before = {} if old is None else {s.key: s for s in old.sections}
    changed = []
    for section in new.sections:
        was = before.get(section.key)
        if was is None or (was.text, was.rows, was.fields) != (
            section.text,
            section.rows,
            section.fields,
        ):
            changed.append(section.key)
    return changed


def supersede(
    cursor: psycopg.Cursor[Any],
    workpaper_id: UUID,
    keys: Sequence[str] | None,
    actor: UUID,
    *,
    used: UUID | None = None,
    requested_by: UUID | None = None,
) -> None:
    """In the caller's transaction: end `used` USED, and every other proposal standing on
    the workpaper (for `keys`, or every section when None; of `requested_by` only, when
    given) SUPERSEDED, by `actor`. Where migration 0170 is not applied there is none to
    end, and the caller's save or preparation goes on: the savepoint leaves its
    transaction as it was."""
    if keys is not None and not keys and used is None:
        return
    try:
        with cursor.connection.transaction():
            if used is not None:
                cursor.execute(
                    "UPDATE workpaper_section_proposals SET ended_at = clock_timestamp(), "
                    "ended_by = %s, ended_as = 'USED' WHERE id = %s AND ended_at IS NULL",
                    (actor, used),
                )
            cursor.execute(
                """
                UPDATE workpaper_section_proposals
                SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'SUPERSEDED'
                WHERE workpaper_id = %s AND ended_at IS NULL
                  AND (%s::text[] IS NULL OR section_key = ANY(%s::text[]))
                  AND (%s::uuid IS NULL OR requested_by = %s::uuid)
                  AND id IS DISTINCT FROM %s::uuid
                """,
                (actor, workpaper_id, None if keys is None else list(keys),
                 None if keys is None else list(keys), requested_by, requested_by, used),
            )  # fmt: skip
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)


def text_from(
    status: str, ready_at: datetime | None, ended_at: datetime | None, ended_as: str | None
) -> bool:
    """Whether a text taken from the proposal ("Use the draft") may still be kept in a
    working copy or saved as from it: the agent finished it (READY), and it stands or a
    newer request or a version saved on another basis superseded it (the text still came
    from it). Not one the person kept their own text over (KEPT_MINE), and not one a save
    already used (USED)."""
    if status != "READY" or ready_at is None:
        return False
    if ended_as is None:
        return ended_at is None
    return ended_at is not None and ended_as == "SUPERSEDED"


def _proposal_row(
    cursor: psycopg.Cursor[Any],
    workpaper_id: UUID,
    key: str,
    person: UUID,
    proposal_id: UUID,
    *,
    lock: bool,
) -> tuple[Any, ...] | None:
    """The person's own proposal for this section of this workpaper (locked until the
    caller's transaction ends, where asked), or None. Where migration 0170 is not applied
    there is none: the savepoint leaves the caller's transaction as it was."""
    statement = (
        "SELECT id, citations, status, ready_at, ended_at, ended_as "
        "FROM workpaper_section_proposals "
        "WHERE id = %s AND workpaper_id = %s AND section_key = %s AND requested_by = %s"
    )
    try:
        with cursor.connection.transaction():
            row = cursor.execute(
                statement + (" FOR UPDATE" if lock else ""),
                (proposal_id, workpaper_id, key, person),
            ).fetchone()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return None
    return None if row is None else tuple(row)


def use_proposal(
    cursor: psycopg.Cursor[Any], workpaper_id: UUID, key: str, person: UUID, proposal_id: UUID
) -> UsedProposal:
    """The proposal a save of the section begins from: the person's own READY one for this
    section of this workpaper, standing or superseded (text_from), locked until the save
    commits; refused otherwise with one sentence."""
    row = _proposal_row(cursor, workpaper_id, key, person, proposal_id, lock=True)
    if row is None or not text_from(row[2], row[3], row[4], row[5]):
        raise WorkpaperState(PROPOSAL_CHANGED)
    citations = row[1] if isinstance(row[1], list) else []
    return UsedProposal(
        id=UUID(str(row[0])),
        citations=[c for c in citations if isinstance(c, dict)],
        note=f"From the agent's draft of {when(row[3])}.",
        standing=row[4] is None,
    )


def copy_from(
    cursor: psycopg.Cursor[Any], workpaper_id: UUID, key: str, person: UUID, proposal_id: UUID
) -> UUID:
    """The proposal a working copy of the section says its text came from: as for a save
    (text_from), the person's own READY one for this section, standing or superseded;
    refused otherwise with one sentence. Read under the workpaper's lock the caller holds,
    as a save and "Keep mine" take it, so none of them passes the others."""
    row = _proposal_row(cursor, workpaper_id, key, person, proposal_id, lock=False)
    if row is None or not text_from(row[2], row[3], row[4], row[5]):
        raise WorkpaperState(PROPOSAL_CHANGED)
    return UUID(str(row[0]))


# The routes' work


def request_redraft(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    key: str,
    body: RedraftBody,
) -> ProposalBody:
    """Ask the agent to redraft one section: a new PENDING proposal, which ends the
    caller's standing one for the section SUPERSEDED. The permission and the workpaper's
    state are a section edit's: a person who may update the engagement's work, an open
    engagement (the closed-engagement middleware and the table's guard), a draft that is
    not being drafted, at the version the editor shows, and a section the agent drafts."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    with transaction(connection) as cursor:
        status, drafting, current, organization, _control, stage, _version = _locked(
            cursor, project_id, workpaper_id
        )
        if UUID(str(organization)) != organization_id:
            raise NotVisible()
        if status != "DRAFT":
            raise WorkpaperState(PREPARED)
        if drafting in ("PENDING", "WORKING"):
            raise WorkpaperState(DRAFTING)
        content = _content(connection, workpaper_id, int(current))
        if content is None:
            raise WorkpaperState(NO_DRAFT)
        if int(current) != body.workpaper_version:
            raise WorkpaperState(CHANGED)
        section = next((s for s in content.sections if s.key == key), None)
        if section is None:
            raise NotVisible()
        if not agent_drafts(section, str(stage)):
            raise WorkpaperState(NOT_DRAFTED)
        supersede(cursor, workpaper_id, [key], principal.id, requested_by=principal.id)
        row = cursor.execute(
            f"""
            INSERT INTO workpaper_section_proposals (
                organization_id, project_id, workpaper_id, section_key, based_on, requested_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING {_COLUMNS}
            """,  # noqa: S608
            (organization_id, project_id, workpaper_id, key, int(current), principal.id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        proposal = _body(row)
        requested = {"section": key, "proposal_id": str(proposal.id), "based_on": int(current)}
        _audit(
            cursor, organization_id, project_id, principal.id, workpaper_id,
            "workpaper.redraft_requested", requested,
        )  # fmt: skip
    return proposal


def read_mine(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    key: str,
) -> ProposalBody | None:
    """The caller's own standing proposal for the section, or None; never another's."""
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    _visible(connection, organization_id, project_id, workpaper_id)
    try:
        with connection.transaction():
            row = connection.execute(
                f"SELECT {_COLUMNS} FROM workpaper_section_proposals "  # noqa: S608
                "WHERE workpaper_id = %s AND section_key = %s AND requested_by = %s "
                "AND ended_at IS NULL",
                (workpaper_id, key, principal.id),
            ).fetchone()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return None
    return None if row is None else _body(row)


def keep_mine(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    key: str,
    proposal_id: UUID,
) -> None:
    """End the caller's own standing proposal KEPT_MINE. Nothing of the workpaper changes.
    A person who may read the workpaper may dismiss what they asked for."""
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    _visible(connection, organization_id, project_id, workpaper_id)
    with transaction(connection) as cursor:
        # Under the workpaper's lock, as a save takes it, so the two never pass each other.
        _locked(cursor, project_id, workpaper_id)
        row = cursor.execute(
            "SELECT ended_at IS NULL FROM workpaper_section_proposals "
            "WHERE id = %s AND workpaper_id = %s AND section_key = %s AND requested_by = %s "
            "FOR UPDATE",
            (proposal_id, workpaper_id, key, principal.id),
        ).fetchone()
        if row is None:
            raise NotVisible()
        if row[0] is not True:
            raise WorkpaperState(PROPOSAL_CHANGED)
        cursor.execute(
            "UPDATE workpaper_section_proposals SET ended_at = clock_timestamp(), "
            "ended_by = %s, ended_as = 'KEPT_MINE' WHERE id = %s",
            (principal.id, proposal_id),
        )
        kept = {"section": key, "proposal_id": str(proposal_id)}
        _audit(
            cursor, organization_id, project_id, principal.id, workpaper_id,
            "workpaper.redraft_kept_mine", kept,
        )  # fmt: skip


def fail(
    connection: psycopg.Connection[Any],
    proposal_id: UUID,
    failure: str,
    run_id: UUID | None = None,
) -> ProposalBody | None:
    """A PENDING proposal that still stands ends its run FAILED, with one sentence. None
    where it had already left PENDING or ended."""
    with transaction(connection) as cursor:
        row = cursor.execute(
            f"""
            UPDATE workpaper_section_proposals
            SET status = 'FAILED', failure = %s, failed_at = clock_timestamp(),
                run_id = coalesce(%s, run_id)
            WHERE id = %s AND status = 'PENDING' AND ended_at IS NULL
            RETURNING {_COLUMNS}
            """,  # noqa: S608
            (failure[:500], run_id, proposal_id),
        ).fetchone()
    return None if row is None else _body(row)


def _read(connection: psycopg.Connection[Any], proposal_id: UUID) -> ProposalBody | None:
    row = connection.execute(
        f"SELECT {_COLUMNS} FROM workpaper_section_proposals WHERE id = %s",  # noqa: S608
        (proposal_id,),
    ).fetchone()
    return None if row is None else _body(row)


# The agent's run


def open_redrafts(connection: psycopg.Connection[Any]) -> list[UUID]:
    """The proposals still to draft (resumed after a restart), oldest first."""
    try:
        with connection.transaction():
            rows = connection.execute(
                "SELECT id FROM workpaper_section_proposals "
                "WHERE status = 'PENDING' AND ended_at IS NULL ORDER BY requested_at LIMIT 100"
            ).fetchall()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return []
    return [UUID(str(row[0])) for row in rows]


def fail_redraft(connection: psycopg.Connection[Any], proposal_id: UUID) -> None:
    """A run that gave up after its retries (the workflow's failure step)."""
    fail(connection, proposal_id, RUN_FAILED)


def _ended(connection: psycopg.Connection[Any], proposal_id: UUID) -> bool:
    row = connection.execute(
        "SELECT ended_at IS NOT NULL FROM workpaper_section_proposals WHERE id = %s",
        (proposal_id,),
    ).fetchone()
    return row is None or row[0] is True


def run_redraft(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    proposal_id: UUID,
    settings: Settings | None = None,
) -> str:
    """Draft one proposal's section: READY with the agent's checked text, or FAILED with
    one sentence. It never writes the workpaper, its versions or its content. "SKIPPED"
    where the proposal is no longer PENDING or has ended; "CANCELLED" where it ended while
    the model answered (nothing is written)."""
    independent_steps(connection)
    row = connection.execute(
        """
        SELECT p.organization_id, p.project_id, p.workpaper_id, p.section_key, p.based_on,
               p.requested_by, w.engagement_control_id, w.stage
        FROM workpaper_section_proposals p
        JOIN workpapers w ON w.id = p.workpaper_id
        WHERE p.id = %s AND p.status = 'PENDING' AND p.ended_at IS NULL
        """,
        (proposal_id,),
    ).fetchone()
    if row is None:
        return "SKIPPED"
    organization_id, project_id, workpaper_id, key, based_on, requester, control_id, stage = row
    organization_id, project_id, workpaper_id = (
        UUID(str(organization_id)), UUID(str(project_id)), UUID(str(workpaper_id)),
    )  # fmt: skip
    requester, control_id, stage, key = (
        UUID(str(requester)),
        UUID(str(control_id)),
        str(stage),
        str(key),
    )
    content = _content(connection, workpaper_id, int(based_on))
    section = None if content is None else next((s for s in content.sections if s.key == key), None)
    if content is None or section is None or not agent_drafts(section, stage):
        return _finished(connection, fail(connection, proposal_id, NOT_A_SECTION))
    if provider is None:
        return _finished(connection, fail(connection, proposal_id, NO_MODEL))
    records = gather(connection, project_id, control_id)
    # The agent writes only from something it can read, as a draft does.
    if not has_input(records):
        return _finished(connection, fail(connection, proposal_id, NO_INPUT))
    agent_instance = agent_actor(connection, project_id, AGENT_KEY)
    run_id = uuid4()
    caller = AgentCaller(
        connection,
        provider,
        Job(
            AGENT_KEY,
            "workpaper",
            workpaper_id,
            organization_id,
            project_id,
            requester,
            job_id=run_id,
            agent_instance_id=agent_instance,
        ),  # fmt: skip
        settings=settings,
        # A proposal ended meanwhile (kept mine, superseded) is not drafted on.
        cancelled=lambda: _ended(connection, proposal_id),
    )
    auditor_record, confirmed, narrative = design_inputs(connection, project_id, control_id, stage)
    call = caller.generate(
        ModelRequest(
            operation="generate",
            prompt=prompt_for(
                content,
                records,
                [section],
                auditor_record,
                confirmed_understanding=confirmed,
                approved_process_narrative=narrative,
                preparer_current_text=current_text(section),
            ),
            output_schema=DRAFT_SCHEMA,
            allowed_tool_ids=(),
            timeout_seconds=120,
            cancelled=False,
            system=SYSTEM_PROMPT,
        ),
        PROMPT_VERSION,
        {"workpaper": str(workpaper_id), "stage": stage, "version": int(based_on),
         "proposal": str(proposal_id), "section": key},
    )  # fmt: skip
    if call.status == "CANCELLED" or caller.cancelled():
        return "CANCELLED"
    if not call.readable or call.raw.output is None:
        failure = CALL_FAILED.get(call.status, f"The model call ended {call.status.lower()}.")
        return _finished(
            connection,
            fail(connection, proposal_id, failure, run_id),
            (organization_id, project_id, requester, workpaper_id, key, agent_instance),
        )
    try:
        answer = _Answer.model_validate(call.raw.output)
    except ValidationError:
        answer = None
    drafted: Section | None = None
    removed: list[tuple[str, str, int]] = []
    if answer is not None:
        # The one section, cleaned and its citations checked as a draft's are.
        one = content.model_copy(update={"sections": [section]})
        applied, removed = _apply(connection, project_id, one, answer, [section])
        drafted = applied.sections[0]
    if drafted is None or drafted.source != "AGENT" or not drafted.text.strip():
        return _finished(
            connection,
            fail(connection, proposal_id, NOT_MATCHED, run_id),
            (organization_id, project_id, requester, workpaper_id, key, agent_instance),
        )
    with transaction(connection) as cursor:
        ready = cursor.execute(
            f"""
            UPDATE workpaper_section_proposals
            SET status = 'READY', text = %s, citations = %s, words = %s, removed_note = %s,
                ready_at = clock_timestamp(), run_id = %s
            WHERE id = %s AND status = 'PENDING' AND ended_at IS NULL
            RETURNING {_COLUMNS}
            """,  # noqa: S608
            (drafted.text, Json(drafted.citations), words_of(drafted.text),
             removed_note("", removed), run_id, proposal_id),
        ).fetchone()  # fmt: skip
        if ready is None:
            return "SKIPPED"
        _audit(cursor, organization_id, project_id, requester, workpaper_id,
               "workpaper.redrafted",
               {"section": key, "proposal_id": str(proposal_id), "status": "READY",
                "quotations_removed": sum(count for _k, _t, count in removed)},
               agent_instance)  # fmt: skip
    return "READY"


def _finished(
    connection: psycopg.Connection[Any],
    failed: ProposalBody | None,
    audited: tuple[UUID, UUID, UUID, UUID, str, UUID | None] | None = None,
) -> str:
    """A run that ended FAILED (its audit event, where the agent ran), or "SKIPPED" where
    the proposal had already left PENDING."""
    if failed is None:
        return "SKIPPED"
    if audited is not None:
        organization_id, project_id, requester, workpaper_id, key, agent_instance = audited
        with transaction(connection) as cursor:
            _audit(cursor, organization_id, project_id, requester, workpaper_id,
                   "workpaper.redrafted",
                   {"section": key, "proposal_id": str(failed.id), "status": "FAILED"},
                   agent_instance)  # fmt: skip
    return "FAILED"


def redraft_runner(
    settings: Settings, provider: ModelProvider | None = None
) -> Callable[[UUID], str]:
    """The run the workflow engine (or the local worker) calls for one proposal."""
    model = provider if provider is not None else provider_for(settings)
    use_model = provider is not None or live_model(settings)

    def run(proposal_id: UUID) -> str:
        with connect(settings.database_url) as connection:
            return run_redraft(connection, model if use_model else None, proposal_id, settings)

    return run


# The routes


def register_workpaper_redraft(app: FastAPI, base: str, run: Run, scheduler: Any) -> None:
    """The three routes, registered with the workpaper routes (workpaper_service)."""

    def start(request: Request, proposal: ProposalBody) -> ProposalBody:
        """Hand the run to the workflow engine once the proposal is committed. Where there
        is no engine, or it cannot be reached, the proposal ends FAILED at once."""
        failure = NO_ENGINE
        if isinstance(scheduler, RedraftScheduler):
            try:
                scheduler.schedule_workpaper_redrafts([proposal.id])
                return proposal
            except Exception:
                logger.warning("a section redraft could not be scheduled")
                failure = NOT_STARTED

        def ended(c: psycopg.Connection[Any], _p: Principal) -> ProposalBody:
            return fail(c, proposal.id, failure) or _read(c, proposal.id) or proposal

        return run(request, ended)

    @app.post(f"{base}/{{workpaper_id}}/sections/{{key}}/redraft", status_code=202)
    def redraft(
        organization_id: UUID,
        project_id: UUID,
        workpaper_id: UUID,
        key: str,
        body: RedraftBody,
        request: Request,
    ) -> ProposalEnvelope:
        proposal = run(
            request,
            lambda c, p: request_redraft(
                c, p, organization_id, project_id, workpaper_id, key, body
            ),
        )
        return ProposalEnvelope(proposal=start(request, proposal))

    @app.get(f"{base}/{{workpaper_id}}/sections/{{key}}/proposal")
    def proposal(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, key: str, request: Request
    ) -> ProposalEnvelope:
        found = run(
            request, lambda c, p: read_mine(c, p, organization_id, project_id, workpaper_id, key)
        )
        return ProposalEnvelope(proposal=found)

    @app.post(f"{base}/{{workpaper_id}}/sections/{{key}}/proposal/{{proposal_id}}/keep-mine")
    def keep(
        organization_id: UUID,
        project_id: UUID,
        workpaper_id: UUID,
        key: str,
        proposal_id: UUID,
        request: Request,
    ) -> ProposalEnvelope:
        run(
            request,
            lambda c, p: keep_mine(
                c, p, organization_id, project_id, workpaper_id, key, proposal_id
            ),
        )
        return ProposalEnvelope(proposal=None)
