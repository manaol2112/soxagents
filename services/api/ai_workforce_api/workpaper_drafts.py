"""Working copies of a workpaper's sections (docs/design-workpaper.md, section 3.4).

What a person types into a section's editor is kept automatically as a working copy: one
per workpaper, section and person (migration 0164). A version is added to the workpaper's
history only when the person saves the section (workpaper_service._edit), which also
deletes their working copy of it; preparing the workpaper deletes every working copy of
it, so nothing unfinished is carried past preparation.

A working copy is a person's unfinished typing, not a record of the audit. It is replaced
as they type and deleted when saved or discarded. It is read only by the person it belongs
to: never by the views, the export, the agents or another person. Keeping one never
changes the workpaper, its version or its `version` counter, and writes no audit event
(the save that follows does, as before). Section text is never logged here.

Keeping one has the preconditions of an edit: a person who may update the engagement's
work, an open engagement (the closed-engagement middleware refuses every change under a
completed or archived one, and the table refuses a write to an archived one), a draft
workpaper the agent is not drafting, and a section of the kind the body is for. What is
stored is cleaned as an edit cleans what it stores.

A text taken from the agent's draft ("Use the draft", section 3.11) is the agent's until a
person saves it, and is never recorded as a person's: its working copy names the proposal
it came from (`proposal_id`), so that the save after leaving and returning still says
"From the agent's draft of <when>". The proposal named must be the person's own READY one
for the section, standing or superseded since (workpaper_redraft.text_from); one kept mine
over or already used is refused with "The agent's draft changed; read it again."
"""

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request, Response
from psycopg.types.json import Json
from pydantic import BaseModel, Field, ValidationError, model_validator

from ai_workforce_api.authorization import Action, NotVisible, Principal
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line, clean_text
from ai_workforce_api.workpaper_fill import Section
from ai_workforce_api.workpaper_service import WorkpaperState, _content, _locked, _person

logger = logging.getLogger(__name__)

NOT_MIGRATED = "working copies are not on record: migration 0164 is not applied"


class KeepBody(BaseModel):
    """The body a save of the section would send: the version it was started from, and
    the section's text or its rows (exactly one), and the agent's draft the text came from,
    where it did ("Use the draft"; a text section's only)."""

    based_on: int = Field(ge=1)
    text: str | None = Field(default=None, max_length=12_000)
    rows: list[list[str]] | None = Field(default=None, max_length=300)
    proposal_id: UUID | None = None

    @model_validator(mode="after")
    def _one_of(self) -> KeepBody:
        if (self.text is None) == (self.rows is None):
            raise ValueError("send the section's text or its rows, one of the two")
        if self.proposal_id is not None and self.text is None:
            raise ValueError("the agent drafts a section's text, never its rows")
        return self


class KeptBody(BaseModel):
    updated_at: datetime


class WorkingCopyBody(BaseModel):
    section: str
    based_on: int
    # Exactly one of the two is given, as it was kept.
    text: str | None
    rows: list[list[str]] | None
    # The agent's draft the text came from, or None (also for a copy kept before it was
    # recorded): a save of this text sends it as the save's `proposal_id`.
    proposal_id: UUID | None
    updated_at: datetime


class _Stored(BaseModel):
    """A working copy's content as the table holds it."""

    text: str | None = None
    rows: list[list[str]] | None = None
    proposal_id: UUID | None = None

    @model_validator(mode="after")
    def _one_of(self) -> _Stored:
        if (self.text is None) == (self.rows is None):
            raise ValueError("neither a text nor rows")
        if self.proposal_id is not None and self.text is None:
            raise ValueError("rows from the agent's draft")
        return self


def _visible(
    connection: psycopg.Connection[Any], organization_id: UUID, project_id: UUID, workpaper_id: UUID
) -> None:
    row = connection.execute(
        "SELECT 1 FROM workpapers WHERE id = %s AND project_id = %s AND organization_id = %s",
        (workpaper_id, project_id, organization_id),
    ).fetchone()
    if row is None:
        raise NotVisible()


def mine(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
) -> list[WorkingCopyBody]:
    """The caller's own working copies of the workpaper; never another person's."""
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    _visible(connection, organization_id, project_id, workpaper_id)
    try:
        with connection.transaction():
            rows = connection.execute(
                "SELECT section_key, based_on, content, updated_at "
                "FROM workpaper_section_drafts WHERE workpaper_id = %s AND user_id = %s "
                "ORDER BY section_key",
                (workpaper_id, principal.id),
            ).fetchall()
    except psycopg.errors.UndefinedTable:
        # The code released before the migration: there is no working copy to read.
        logger.warning(NOT_MIGRATED)
        return []
    found: list[WorkingCopyBody] = []
    for key, based_on, content, updated_at in rows:
        try:
            stored = _Stored.model_validate(content)
        except ValidationError:
            # Written by something other than `keep`: not shown, and the text not logged.
            logger.warning("a working copy of workpaper %s is not readable", workpaper_id)
            continue
        found.append(
            WorkingCopyBody(
                section=str(key),
                based_on=int(based_on),
                text=stored.text,
                rows=stored.rows,
                proposal_id=stored.proposal_id,
                updated_at=updated_at,
            )
        )
    return found


def keep(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    key: str,
    body: KeepBody,
) -> KeptBody:
    """Keep (insert or replace) the caller's working copy of one section. Nothing of the
    workpaper changes, and no audit event is written. A copy that names the agent's draft
    its text came from keeps that name, once checked (workpaper_redraft.copy_from)."""
    from ai_workforce_api.workpaper_redraft import copy_from

    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    with transaction(connection) as cursor:
        # The workpaper's row is locked as an edit locks it, so a working copy is never
        # kept on a workpaper that is being prepared in the same moment.
        status, drafting, current, organization, *_rest = _locked(cursor, project_id, workpaper_id)
        if status != "DRAFT":
            raise WorkpaperState("the workpaper is prepared; reopen it to change it")
        if drafting == "WORKING":
            raise WorkpaperState("the agent is drafting it")
        content = _content(connection, workpaper_id, int(current))
        if content is None:
            raise WorkpaperState("the workpaper has no draft yet")
        if body.based_on > int(current):
            raise WorkpaperState(
                "the workpaper has no such version yet; refresh and edit the latest version"
            )
        section = next((s for s in content.sections if s.key == key), None)
        if section is None:
            raise NotVisible()
        kept: dict[str, Any]
        if section.kind == "text":
            if body.text is None:
                raise WorkpaperState("a text section takes text")
            # Cleaned as an edit cleans it. Citations are resolved by the save, not here.
            kept = {"text": clean_text(body.text, 12_000).text}
        elif section.kind == "table":
            if body.rows is None:
                raise WorkpaperState("a table section takes rows")
            width = len(section.columns)
            kept = {
                "rows": [
                    [clean_line(cell, 1000) for cell in (row + [""] * width)[:width]]
                    for row in body.rows
                ]
            }
        else:
            raise WorkpaperState("a fields section keeps no working copy")
        try:
            Section.model_validate({**section.model_dump(), **kept})
        except ValidationError as error:
            raise WorkpaperState("the section is too long") from error
        if body.proposal_id is not None:
            # The person's own READY proposal for this section, standing or superseded
            # since: the text still came from it. Read under the workpaper's lock, held
            # above, which a save and "Keep mine" also take.
            proposal = copy_from(cursor, workpaper_id, section.key, principal.id, body.proposal_id)
            kept["proposal_id"] = str(proposal)
        row = cursor.execute(
            """
            INSERT INTO workpaper_section_drafts (
                organization_id, project_id, workpaper_id, section_key, user_id, based_on,
                content
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (workpaper_id, section_key, user_id) DO UPDATE
            SET based_on = EXCLUDED.based_on, content = EXCLUDED.content,
                updated_at = clock_timestamp()
            RETURNING updated_at
            """,
            (organization, project_id, workpaper_id, section.key, principal.id, body.based_on,
             Json(kept)),
        ).fetchone()  # fmt: skip
    if row is None:
        raise NotVisible()
    return KeptBody(updated_at=row[0])


def discard_mine(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    workpaper_id: UUID,
    key: str,
) -> None:
    """Discard the caller's own working copy of one section, whether or not there is one.
    A person who may read the workpaper may discard what they typed."""
    _person(connection, principal, organization_id, project_id, Action.TASK_READ)
    _visible(connection, organization_id, project_id, workpaper_id)
    with transaction(connection) as cursor:
        discard(cursor, workpaper_id, key, principal.id)


def discard(cursor: psycopg.Cursor[Any], workpaper_id: UUID, key: str, user_id: UUID) -> None:
    """One person's working copy of one section, deleted in the caller's transaction (the
    section's save, or the person's own discard). Never another person's."""
    _delete(
        cursor,
        "DELETE FROM workpaper_section_drafts "
        "WHERE workpaper_id = %s AND section_key = %s AND user_id = %s",
        (workpaper_id, key, user_id),
    )


def discard_all(cursor: psycopg.Cursor[Any], workpaper_id: UUID) -> None:
    """Every working copy of the workpaper, deleted in the caller's transaction: nothing
    unfinished is carried past its preparation."""
    _delete(cursor, "DELETE FROM workpaper_section_drafts WHERE workpaper_id = %s", (workpaper_id,))


def _delete(cursor: psycopg.Cursor[Any], statement: str, values: tuple[Any, ...]) -> None:
    """Where migration 0164 is not applied yet there is no working copy to delete, and
    neither a section's save nor a preparation fails for it: the savepoint leaves the
    caller's transaction as it was. Any other error is the caller's, as raised."""
    try:
        with cursor.connection.transaction():
            cursor.execute(statement, values)
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)


class Run(Protocol):
    """The workpaper routes' own runner: the session's principal, the central layer's
    answers for not visible and not allowed, and a 409 for a workpaper's state."""

    def __call__[T](
        self, request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]
    ) -> T: ...


def register_workpaper_drafts(app: FastAPI, base: str, run: Run) -> None:
    """The three routes, registered with the workpaper routes (workpaper_service)."""

    @app.get(f"{base}/{{workpaper_id}}/drafts")
    def working_copies(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, request: Request
    ) -> list[WorkingCopyBody]:
        return run(request, lambda c, p: mine(c, p, organization_id, project_id, workpaper_id))

    @app.put(f"{base}/{{workpaper_id}}/sections/{{key}}/draft")
    def keep_working_copy(
        organization_id: UUID,
        project_id: UUID,
        workpaper_id: UUID,
        key: str,
        body: KeepBody,
        request: Request,
    ) -> KeptBody:
        return run(
            request,
            lambda c, p: keep(c, p, organization_id, project_id, workpaper_id, key, body),
        )

    @app.delete(f"{base}/{{workpaper_id}}/sections/{{key}}/draft", status_code=204)
    def discard_working_copy(
        organization_id: UUID, project_id: UUID, workpaper_id: UUID, key: str, request: Request
    ) -> Response:
        run(
            request,
            lambda c, p: discard_mine(c, p, organization_id, project_id, workpaper_id, key),
        )
        return Response(status_code=204)
