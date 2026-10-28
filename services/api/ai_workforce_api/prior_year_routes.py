"""Routes for prior-year references (prior_year.py). Reads need project read access; every
change needs a person with project update access. Accepting or dismissing proposals is in
context_routes, beside the client's values it fills."""

from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ai_workforce_api import prior_year
from ai_workforce_api.authorization import Action, Principal, _call, _session_principal
from ai_workforce_api.context_routes import _allowed, _project
from ai_workforce_api.control_context import (
    MAX_UPLOAD,
    ContextState,
    line,
    read_document,
    store_document,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings


class PriorYearUpload(BaseModel):
    reference: prior_year.ReferenceBody | None
    readable: bool
    note: str


def register_prior_year(app: FastAPI, settings: Settings, scheduler: object | None) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"
    reference = f"{base}/prior-year/{{document_id}}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ContextState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError:
            raise HTTPException(status_code=422, detail="prior-year reference is invalid") from None

    def one(
        connection: psycopg.Connection[Any], project_id: UUID, document_id: UUID
    ) -> prior_year.ReferenceBody:
        return next(
            item for item in prior_year.references(connection, project_id)
            if item.id == document_id
        )  # fmt: skip

    def queue(document_id: UUID) -> None:
        prior_year.schedule(scheduler, [document_id])

    @app.get(f"{base}/prior-year")
    def list_references(
        organization_id: UUID, project_id: UUID, request: Request
    ) -> list[prior_year.ReferenceBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[prior_year.ReferenceBody]:
            _project(c, p, organization_id, project_id, Action.TASK_READ)
            return prior_year.references(c, project_id)

        return run(request, work)

    @app.get(f"{base}/controls/{{control_id}}/prior-year")
    def control_proposals(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> list[prior_year.ProposalBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[prior_year.ProposalBody]:
            _allowed(c, p, organization_id, project_id, control_id, Action.TASK_READ)
            return prior_year.proposals_for(c, control_id)

        return run(request, work)

    @app.post(f"{base}/prior-year/upload")
    async def upload_reference(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        title: str = "",
        file_name: str = "",
    ) -> PriorYearUpload:
        content = await request.body()
        if len(content) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="file is larger than 5 MB")
        if not content:
            raise HTTPException(status_code=422, detail="file is empty")
        content_type = request.headers.get("content-type", "")

        def work(c: psycopg.Connection[Any], p: Principal) -> PriorYearUpload:
            _project(c, p, organization_id, project_id)
            read = read_document(content, file_name, content_type)
            if not read.readable:
                return PriorYearUpload(reference=None, readable=False, note=read.note)
            with transaction(c) as cursor:
                document_id = store_document(
                    cursor, organization_id, project_id, p.id, kind="PRIOR_YEAR",
                    title=line(title, 200) or read.file_name, text=read.text, origin="UPLOAD",
                    file_name=read.file_name, sha256=read.sha256,
                )  # fmt: skip
                prior_year.start(cursor, organization_id, project_id, document_id, p.id)
                prior_year._audit(cursor, organization_id, project_id, p.id,
                                  "document.uploaded", document_id,
                                  {"kind": "PRIOR_YEAR"})  # fmt: skip
            queue(document_id)
            return PriorYearUpload(
                reference=one(c, project_id, document_id), readable=True, note=read.note
            )

        return run(request, work)

    @app.post(f"{reference}/matches")
    def decide_matches(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        body: prior_year.MatchDecision,
        request: Request,
    ) -> prior_year.ReferenceBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> prior_year.ReferenceBody:
            _project(c, p, organization_id, project_id)
            prior_year.reference(c, project_id, document_id)
            prior_year.decide_matches(c, organization_id, project_id, document_id, p.id, body)
            return one(c, project_id, document_id)

        return run(request, work)

    @app.post(f"{reference}/items/{{match_id}}/assign")
    def assign(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        match_id: UUID,
        body: prior_year.AssignBody,
        request: Request,
    ) -> prior_year.ReferenceBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> prior_year.ReferenceBody:
            _project(c, p, organization_id, project_id)
            prior_year.reference(c, project_id, document_id)
            prior_year.assign(c, organization_id, project_id, document_id, match_id, p.id, body)
            queue(document_id)
            return one(c, project_id, document_id)

        return run(request, work)

    @app.post(f"{reference}/items/{{match_id}}/set-aside")
    def set_aside(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        match_id: UUID,
        body: prior_year.ItemBody,
        request: Request,
    ) -> prior_year.ReferenceBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> prior_year.ReferenceBody:
            _project(c, p, organization_id, project_id)
            prior_year.reference(c, project_id, document_id)
            prior_year.set_aside(c, organization_id, project_id, document_id, match_id, p.id,
                                 body)  # fmt: skip
            return one(c, project_id, document_id)

        return run(request, work)

    @app.post(f"{reference}/remove")
    def remove(
        organization_id: UUID, project_id: UUID, document_id: UUID, request: Request
    ) -> list[prior_year.ReferenceBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[prior_year.ReferenceBody]:
            _project(c, p, organization_id, project_id)
            prior_year.reference(c, project_id, document_id)
            prior_year.remove_reference(c, organization_id, project_id, document_id, p.id)
            return prior_year.references(c, project_id)

        return run(request, work)

    @app.post(f"{reference}/run")
    def rerun(
        organization_id: UUID, project_id: UUID, document_id: UUID, request: Request
    ) -> prior_year.ReferenceBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> prior_year.ReferenceBody:
            _project(c, p, organization_id, project_id)
            prior_year.reference(c, project_id, document_id)
            prior_year.rerun(c, organization_id, project_id, document_id, p.id)
            queue(document_id)
            return one(c, project_id, document_id)

        return run(request, work)
