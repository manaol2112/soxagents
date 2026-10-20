"""Routes for a control's context: classification, attributes, process understanding,
supporting documents, issues, and readiness.

Reads need project read access; every change needs a person with project update access,
inside the engagement the control belongs to. A change that clears a control's blockers
asks its waiting test sheets to run again.
"""

from collections.abc import Callable
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api import (
    control_attributes,
    control_design,
    library_definitions,
    process_understanding,
)
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.control_context import (
    CLASSIFICATIONS,
    MAX_UPLOAD,
    Classification,
    ContextState,
    DocumentBody,
    DocumentKind,
    IssueBody,
    classifications_of,
    context_package,
    derived_classifications,
    documents,
    frequency_conflicts,
    issues_for,
    line,
    link_document,
    linked_documents,
    raise_issues,
    read_document,
    sources_for,
    store_document,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.model_providers import live_model, provider_for
from ai_workforce_api.models import ModelProvider
from ai_workforce_api.pbc_drafting import load_context
from ai_workforce_api.readiness import ReadinessBody, assess, resume_testing
from ai_workforce_api.settings import Settings
from ai_workforce_api.testing_engine import TestScheduler, schedule_runs


class ContextBody(BaseModel):
    control_id: UUID
    classifications: list[Classification]
    derived_classifications: list[Classification]
    classifications_overridden: bool
    process_required: bool
    readiness: ReadinessBody | None
    attributes: control_attributes.AttributesBody
    issues: list[IssueBody]
    documents: list[DocumentBody]
    understanding: process_understanding.UnderstandingBody
    # Library version 3: how the control is tested, and an update for an older copy.
    testing: library_definitions.TestingBody | None = None
    # Milestone 8.9: the control's statement with the client's values.
    design: control_design.DesignBody | None = None
    library_update: library_definitions.UpdateBody | None = None
    note: str = ""


class ClassificationsBody(BaseModel):
    # None goes back to what the control's area and nature imply.
    classifications: list[Classification] | None = Field(default=None, max_length=6)


class IssueDecision(BaseModel):
    status: Literal["RESOLVED", "DISMISSED"]
    note: str = Field(min_length=1, max_length=1000)
    version: int = Field(ge=1)


class AdoptBody(BaseModel):
    version: int = Field(ge=1)


class DocumentWrite(BaseModel):
    kind: DocumentKind
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100_000)
    control_ids: list[UUID] = Field(default_factory=list, max_length=200)


class LinksBody(BaseModel):
    control_ids: list[UUID] = Field(min_length=1, max_length=200)


class UnlinkBody(BaseModel):
    control_id: UUID


class ManyValuesResult(BaseModel):
    # How many controls the answers filled.
    controls: int


class UploadResult(BaseModel):
    document: DocumentBody | None
    readable: bool
    note: str
    linked: list[UUID] = []


def register_control_context(
    app: FastAPI,
    settings: Settings,
    scheduler: TestScheduler | None = None,
    provider: ModelProvider | None = None,
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}"
    control = f"{base}/controls/{{control_id}}"

    def model() -> ModelProvider | None:
        if provider is not None:
            return provider
        return provider_for(settings) if live_model(settings) else None

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except ContextState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None
        except ValueError:
            raise HTTPException(status_code=422, detail="control context is invalid") from None

    def changed(
        connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, actor: UUID
    ) -> None:
        schedule_runs(scheduler, resume_testing(connection, project_id, control_id))
        # Settled attributes open the planning gate for operating evidence: it is
        # requested now (evidence_plans.release), if the plan is approved.
        from ai_workforce_api.evidence_plans import release
        from ai_workforce_api.pbc_drafting import DraftScheduler, schedule

        owner = connection.execute(
            "SELECT organization_id FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        released = (
            [] if owner is None else release(connection, owner[0], project_id, control_id, actor)
        )
        # The background worker drafts them; with no worker they resume at the next start.
        drafts = scheduler if isinstance(scheduler, DraftScheduler) else None
        schedule(drafts, released)

    @app.get(f"{control}/context")
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id, Action.TASK_READ)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.put(f"{control}/classifications")
    def classify(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: ClassificationsBody,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            chosen = (
                None
                if not body.classifications
                else [item for item in CLASSIFICATIONS if item in body.classifications]
            )
            with transaction(c) as cursor:
                cursor.execute(
                    "UPDATE engagement_controls SET classifications = %s, version = version + 1, "
                    "updated_at = clock_timestamp() WHERE id = %s",
                    (chosen, control_id),
                )
                _audit(cursor, organization_id, project_id, p.id, "control.classified",
                       control_id, {"classifications": chosen})  # fmt: skip
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    # Attributes

    @app.post(f"{control}/attributes")
    def add(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: control_attributes.AttributeAdd,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            control_attributes.add_attribute(c, organization_id, project_id, control_id, p.id, body)
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.patch(f"{control}/attributes/{{attribute_id}}")
    def edit(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        attribute_id: UUID,
        body: control_attributes.AttributeEdit,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            control_attributes.edit_attribute(
                c, organization_id, project_id, control_id, attribute_id, p.id, body
            )
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/attributes/{{attribute_id}}/retire")
    def retire(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        attribute_id: UUID,
        body: control_attributes.VersionOnly,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            control_attributes.retire_attribute(
                c, organization_id, project_id, control_id, attribute_id, p.id, body
            )
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/attributes/{{attribute_id}}/decide")
    def decide(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        attribute_id: UUID,
        body: control_attributes.AttributeDecision,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            control_attributes.decide(
                c, organization_id, project_id, control_id, attribute_id, p.id, body
            )
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/attributes/generate")
    def generate(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            note = _generate(c, model(), organization_id, project_id, control_id, p.id)
            return _body(c, project_id, control_id, note)

        return run(request, work)

    # The client's values in the control's statement (8.9)

    @app.put(f"{control}/values")
    def set_values(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: control_design.ValuesBody,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            changed_ids = control_design.set_values(
                c, organization_id, project_id, control_id, p.id, body
            )
            for changed_id in changed_ids:
                changed(c, project_id, changed_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    # Client values for several controls at once, answered from the plan queue

    @app.put(f"{base}/control-values")
    def set_many_values(
        organization_id: UUID,
        project_id: UUID,
        body: control_design.ManyValuesBody,
        request: Request,
    ) -> ManyValuesResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> ManyValuesResult:
            for item in body.items:
                _allowed(c, p, organization_id, project_id, item.control_id)
            changed_ids = control_design.set_values_many(c, organization_id, project_id, p.id, body)
            for changed_id in changed_ids:
                changed(c, project_id, changed_id, p.id)
            return ManyValuesResult(controls=len(changed_ids))

        return run(request, work)

    # Library version 3 for a control copied from an earlier version

    @app.get(f"{control}/library-update")
    def library_update(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> library_definitions.UpdateBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> library_definitions.UpdateBody:
            _allowed(c, p, organization_id, project_id, control_id, Action.TASK_READ)
            return library_definitions.library_update(c, control_id)

        return run(request, work)

    @app.post(f"{control}/library-update/adopt")
    def adopt_library(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            library_definitions.adopt(c, organization_id, project_id, control_id, p.id)
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    # Process understanding

    @app.put(f"{control}/process")
    def save_process(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: process_understanding.UnderstandingSave,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            context = load_context(c, project_id, control_id)
            process_understanding.save(
                c, organization_id, project_id, control_id, p.id, body,
                sources_for(c, project_id, control_id, context),
            )  # fmt: skip
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{control}/process/build")
    def build_process(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            note = _build(c, model(), organization_id, project_id, control_id, p.id)
            return _body(c, project_id, control_id, note)

        return run(request, work)

    @app.post(f"{control}/process/adopt")
    def adopt_process(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: AdoptBody,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            process_understanding.adopt(
                c, organization_id, project_id, control_id, p.id, body.version
            )
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    # A full review against the sources: after a document is added, or on request.

    @app.post(f"{control}/review")
    def review(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            note = review_control(c, model(), organization_id, project_id, control_id, p.id)
            return _body(c, project_id, control_id, note)

        return run(request, work)

    @app.post(f"{control}/issues/{{issue_id}}/resolve")
    def resolve(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        issue_id: UUID,
        body: IssueDecision,
        request: Request,
    ) -> ContextBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> ContextBody:
            _allowed(c, p, organization_id, project_id, control_id)
            if not line(body.note, 1000):
                raise ValueError("a resolution needs a note")
            with transaction(c) as cursor:
                row = cursor.execute(
                    """
                    UPDATE control_context_issues
                    SET status = %s, resolution_note = %s, resolved_by = %s,
                        resolved_at = clock_timestamp(), version = version + 1,
                        updated_at = clock_timestamp()
                    WHERE id = %s AND engagement_control_id = %s AND status = 'OPEN'
                      AND version = %s
                    RETURNING id
                    """,
                    (body.status, line(body.note, 1000), p.id, issue_id, control_id,
                     body.version),
                ).fetchone()  # fmt: skip
                if row is None:
                    raise ContextState("issue changed")
                _audit(cursor, organization_id, project_id, p.id, "context.issue_resolved",
                       issue_id, {"status": body.status})  # fmt: skip
            changed(c, project_id, control_id, p.id)
            return _body(c, project_id, control_id)

        return run(request, work)

    # Supporting documents

    @app.get(f"{base}/source-documents")
    def list_documents(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        control_id: UUID | None = None,
    ) -> list[DocumentBody]:
        def work(c: psycopg.Connection[Any], p: Principal) -> list[DocumentBody]:
            _project(c, p, organization_id, project_id, Action.TASK_READ)
            return documents(c, project_id, control_id)

        return run(request, work)

    @app.post(f"{base}/source-documents")
    def write_document(
        organization_id: UUID, project_id: UUID, body: DocumentWrite, request: Request
    ) -> UploadResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> UploadResult:
            _project(c, p, organization_id, project_id)
            with transaction(c) as cursor:
                document_id = store_document(
                    cursor, organization_id, project_id, p.id, kind=body.kind,
                    title=body.title, text=body.text, origin="WRITTEN",
                )  # fmt: skip
                linked = link_document(cursor, project_id, document_id, body.control_ids, p.id)
                _audit(cursor, organization_id, project_id, p.id, "document.added",
                       document_id, {"kind": body.kind, "controls": len(linked)})  # fmt: skip
            _after_link(c, organization_id, project_id, linked)
            found = next(d for d in documents(c, project_id) if d.id == document_id)
            return UploadResult(document=found, readable=True, note="", linked=linked)

        return run(request, work)

    @app.post(f"{base}/source-documents/upload")
    async def upload_document(
        organization_id: UUID,
        project_id: UUID,
        request: Request,
        kind: DocumentKind = "NARRATIVE",
        title: str = "",
        file_name: str = "",
        control_id: list[UUID] = Query(default=[]),  # noqa: B008
    ) -> UploadResult:
        content = await request.body()
        if len(content) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="file is larger than 5 MB")
        if not content:
            raise HTTPException(status_code=422, detail="file is empty")
        content_type = request.headers.get("content-type", "")

        def work(c: psycopg.Connection[Any], p: Principal) -> UploadResult:
            _project(c, p, organization_id, project_id)
            read = read_document(content, file_name, content_type)
            if not read.readable:
                return UploadResult(document=None, readable=False, note=read.note)
            with transaction(c) as cursor:
                document_id = store_document(
                    cursor, organization_id, project_id, p.id, kind=kind,
                    title=title or read.file_name, text=read.text, origin="UPLOAD",
                    file_name=read.file_name, sha256=read.sha256,
                )  # fmt: skip
                linked = link_document(cursor, project_id, document_id, control_id, p.id)
                _audit(cursor, organization_id, project_id, p.id, "document.uploaded",
                       document_id, {"kind": kind, "controls": len(linked)})  # fmt: skip
            _after_link(c, organization_id, project_id, linked)
            found = next(d for d in documents(c, project_id) if d.id == document_id)
            return UploadResult(document=found, readable=True, note=read.note, linked=linked)

        return run(request, work)

    @app.post(f"{base}/source-documents/{{document_id}}/links")
    def link(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        body: LinksBody,
        request: Request,
    ) -> UploadResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> UploadResult:
            _project(c, p, organization_id, project_id)
            _document(c, project_id, document_id)
            with transaction(c) as cursor:
                linked = link_document(cursor, project_id, document_id, body.control_ids, p.id)
                _audit(cursor, organization_id, project_id, p.id, "document.linked",
                       document_id, {"controls": [str(i) for i in linked]})  # fmt: skip
            _after_link(c, organization_id, project_id, linked)
            found = next(d for d in documents(c, project_id) if d.id == document_id)
            return UploadResult(document=found, readable=True, note="", linked=linked)

        return run(request, work)

    @app.post(f"{base}/source-documents/{{document_id}}/unlink")
    def unlink(
        organization_id: UUID,
        project_id: UUID,
        document_id: UUID,
        body: UnlinkBody,
        request: Request,
    ) -> UploadResult:
        def work(c: psycopg.Connection[Any], p: Principal) -> UploadResult:
            _project(c, p, organization_id, project_id)
            _document(c, project_id, document_id)
            with transaction(c) as cursor:
                cursor.execute(
                    "DELETE FROM source_document_controls WHERE document_id = %s "
                    "AND engagement_control_id = %s AND project_id = %s",
                    (document_id, body.control_id, project_id),
                )
                _audit(cursor, organization_id, project_id, p.id, "document.unlinked",
                       document_id, {"control": str(body.control_id)})  # fmt: skip
            found = next(d for d in documents(c, project_id) if d.id == document_id)
            return UploadResult(document=found, readable=True, note="")

        return run(request, work)


# The work


def _generate(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> str:
    context = load_context(connection, project_id, control_id)
    found = _classes(connection, control_id, context)
    sources = sources_for(connection, project_id, control_id, context)
    package = context_package(connection, project_id, control_id, context, found)
    kept, note = control_attributes.generate(
        connection, provider, organization_id, project_id, control_id, actor, package, sources
    )
    if not note and kept == 0:
        note = "The agent found nothing to add: the approved attributes cover the sources."
    return note


def _build(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> str:
    context = load_context(connection, project_id, control_id)
    found = _classes(connection, control_id, context)
    sources = sources_for(connection, project_id, control_id, context)
    package = context_package(connection, project_id, control_id, context, found)
    return process_understanding.build(
        connection, provider, organization_id, project_id, control_id, actor, package,
        sources, context,
    )  # fmt: skip


def review_control(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> str:
    """Review the control against all its sources: the rules first, then the agent's
    attribute proposals, then the process map where the control depends on one. Nothing
    approved changes: what the review finds is proposed, or raised as an issue."""
    context = load_context(connection, project_id, control_id)
    found = _classes(connection, control_id, context)
    with transaction(connection) as cursor:
        raise_issues(
            cursor, organization_id, project_id, control_id,
            frequency_conflicts(context.frequency, linked_documents(connection, project_id,
                                                                     control_id)),
            "RULES",
        )  # fmt: skip
    notes = [_generate(connection, provider, organization_id, project_id, control_id, actor)]
    from ai_workforce_api.control_context import needs_process_understanding

    if needs_process_understanding(found):
        notes.append(_build(connection, provider, organization_id, project_id, control_id, actor))
    with transaction(connection) as cursor:
        cursor.execute(
            "UPDATE source_document_controls SET reviewed_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND project_id = %s",
            (control_id, project_id),
        )
    return " ".join(note for note in notes if note)


def _after_link(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    linked: list[UUID],
) -> None:
    """A newly linked document is checked by the rules at once (they are cheap and need no
    model); the agent reviews it when asked."""
    for control_id in linked:
        context = load_context(connection, project_id, control_id)
        with transaction(connection) as cursor:
            raise_issues(
                cursor, organization_id, project_id, control_id,
                frequency_conflicts(
                    context.frequency, linked_documents(connection, project_id, control_id)
                ),
                "RULES",
            )  # fmt: skip


def _classes(
    connection: psycopg.Connection[Any], control_id: UUID, context: Any
) -> list[Classification]:
    row = connection.execute(
        "SELECT classifications FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    return classifications_of(None if row is None else row[0], context.domain, context.nature)


def _body(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, note: str = ""
) -> ContextBody:
    row = connection.execute(
        "SELECT classifications, domain, nature FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    if row is None:
        raise NotVisible()
    derived = derived_classifications(str(row[1]), str(row[2]))
    current = classifications_of(row[0], str(row[1]), str(row[2]))
    readiness = assess(connection, project_id, control_id)
    update = library_definitions.library_update(connection, control_id)
    return ContextBody(
        control_id=control_id,
        classifications=current,
        derived_classifications=derived,
        classifications_overridden=bool(row[0]),
        process_required=readiness.process_required if readiness is not None else False,
        readiness=readiness,
        attributes=control_attributes.attributes(connection, control_id),
        issues=issues_for(connection, control_id),
        documents=documents(connection, project_id, control_id),
        understanding=process_understanding.understanding(connection, control_id),
        testing=library_definitions.testing_body(connection, control_id),
        design=control_design.design_for(connection, control_id),
        library_update=update if update.available else None,
        note=note,
    )


# Access


def _project(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action = Action.TASK_UPDATE,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )
    if action is Action.TASK_UPDATE and principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def _allowed(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    action: Action = Action.TASK_UPDATE,
) -> None:
    _project(connection, principal, organization_id, project_id, action)
    found = connection.execute(
        "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s "
        "AND organization_id = %s",
        (control_id, project_id, organization_id),
    ).fetchone()
    if found is None:
        raise NotVisible()


def _document(connection: psycopg.Connection[Any], project_id: UUID, document_id: UUID) -> None:
    found = connection.execute(
        "SELECT 1 FROM source_documents WHERE id = %s AND project_id = %s",
        (document_id, project_id),
    ).fetchone()
    if found is None:
        raise NotVisible()


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'control_context', %s, %s)
        """,
        (organization_id, project_id, actor, action, target, Json(payload)),
    )
