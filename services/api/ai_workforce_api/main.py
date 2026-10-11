"""API entrypoint.

Workflow execution is Temporal behind the interface in ADR 0002.
Agent coordination stays in-repository per ADR 0003.
Authentication is Entra ID per ADR 0004.
Authorization is the deny-by-default policy in authorization.py.
Object storage is the S3 API per ADR 0005 and is not called from this module.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Literal

import psycopg
from fastapi import FastAPI, Response
from pydantic import BaseModel

from ai_workforce_api.actions import register_actions
from ai_workforce_api.agents import register_agents
from ai_workforce_api.approvals import register_approvals
from ai_workforce_api.auth import register_auth
from ai_workforce_api.authorization import register_authorization
from ai_workforce_api.console import ConsoleScheduler, console_runner, register_console
from ai_workforce_api.control_tests import register_control_tests
from ai_workforce_api.db import connect
from ai_workforce_api.entra import build_entra_provider
from ai_workforce_api.evidence import register_evidence
from ai_workforce_api.evidence_analysis import (
    EvidenceAnalysisScheduler,
    analysis_runner,
    register_evidence_analysis,
)
from ai_workforce_api.evidence_review import register_evidence_reviews
from ai_workforce_api.execution import register_execution
from ai_workforce_api.followups import FollowUpTimer, register_followups
from ai_workforce_api.handoffs import register_handoffs
from ai_workforce_api.identity import IdentityProvider
from ai_workforce_api.inbound import register_inbound
from ai_workforce_api.mailbox import live_send_enabled, register_mailbox
from ai_workforce_api.manager import register_manager
from ai_workforce_api.model_providers import provider_for
from ai_workforce_api.models import ModelProvider, register_models
from ai_workforce_api.onboarding import register_onboarding
from ai_workforce_api.outbound import register_outbound
from ai_workforce_api.pbc import register_pbc
from ai_workforce_api.pbc_drafting import (
    DraftScheduler,
    LocalDraftScheduler,
    draft_runner,
    register_drafting,
)
from ai_workforce_api.policy import register_policy
from ai_workforce_api.projects import register_projects
from ai_workforce_api.rcm_systems import SystemScanScheduler, scan_runner
from ai_workforce_api.rcm_uploads import register_rcm_uploads
from ai_workforce_api.settings import Settings
from ai_workforce_api.tasks import register_tasks
from ai_workforce_api.workflow import DurableRun, register_workflows
from ai_workforce_api.workforce import register_workforce
from ai_workforce_api.workspace import register_workspace

logger = logging.getLogger(__name__)


class HealthBody(BaseModel):
    status: Literal["ok"]
    live_email_enabled: bool


class ReadyBody(BaseModel):
    status: Literal["ok", "unavailable"]


def create_app(
    settings: Settings | None = None,
    identity_provider: IdentityProvider | None = None,
    durable: DurableRun | None = None,
    model_provider: ModelProvider | None = None,
    follow_up_timer: FollowUpTimer | None = None,
    draft_scheduler: DraftScheduler | None = None,
) -> FastAPI:
    resolved = settings if settings is not None else Settings()
    provider = identity_provider
    if provider is None and resolved.oidc_configured():
        provider = build_entra_provider(
            issuer=resolved.oidc_issuer_url,
            client_id=resolved.oidc_client_id,
            client_secret=resolved.oidc_client_secret,
        )
    attached = durable
    timer = follow_up_timer
    if resolved.workflow_address != "" and (attached is None or timer is None):
        from ai_workforce_api.durable import TemporalAdapter

        adapter = TemporalAdapter(resolved.workflow_address)
        attached = adapter if attached is None else attached
        timer = adapter if timer is None else timer
    drafts = draft_scheduler
    local: LocalDraftScheduler | None = None
    if drafts is None and resolved.workflow_address != "":
        from ai_workforce_api.durable import TemporalAdapter

        drafts = TemporalAdapter(resolved.workflow_address)
    elif drafts is None and resolved.local_worker_enabled and resolved.database_url != "":
        local = LocalDraftScheduler(resolved, timer=timer)
        drafts = local
    app = FastAPI(title="AI Employee Workforce API", lifespan=_lifespan(resolved, local))
    register_auth(app, resolved, provider)
    register_authorization(app, resolved)
    register_projects(app, resolved)
    register_agents(app, resolved)
    register_tasks(app, resolved)
    register_workflows(app, resolved, durable=attached)
    models = model_provider if model_provider is not None else provider_for(resolved)
    register_models(app, resolved, models)
    register_manager(app, resolved, models, attached)
    register_handoffs(app, resolved)
    register_actions(app, resolved)
    register_policy(app, resolved)
    register_approvals(app, resolved)
    register_execution(app, resolved)
    register_mailbox(app, resolved)
    register_pbc(app, resolved)
    register_outbound(app, resolved, timer=timer)
    register_followups(app, resolved, timer)
    register_inbound(app, resolved)
    analyses = drafts if isinstance(drafts, EvidenceAnalysisScheduler) else None
    register_evidence(app, resolved, analyses=analyses)
    register_evidence_analysis(app, resolved, analyses)
    register_evidence_reviews(app, resolved)
    register_control_tests(app, resolved)
    register_console(
        app,
        resolved,
        drafts if isinstance(drafts, ConsoleScheduler) else None,
        helpers={"drafts": drafts, "analyses": analyses, "timer": timer},
    )
    register_workforce(app, resolved)
    register_onboarding(app, resolved, drafts)
    register_drafting(app, resolved, drafts)
    scans = drafts if isinstance(drafts, SystemScanScheduler) else None
    register_rcm_uploads(app, resolved, scans)
    register_workspace(app, resolved)

    @app.get("/health", response_model=HealthBody)
    def health() -> HealthBody:
        return HealthBody(status="ok", live_email_enabled=live_send_enabled(resolved))

    @app.get("/ready", response_model=ReadyBody)
    def ready(response: Response) -> ReadyBody:
        if resolved.database_url == "":
            response.status_code = 503
            return ReadyBody(status="unavailable")
        try:
            with connect(resolved.database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    row = cursor.fetchone()
        except psycopg.Error:
            response.status_code = 503
            return ReadyBody(status="unavailable")
        if row != (1,):
            response.status_code = 503
            return ReadyBody(status="unavailable")
        return ReadyBody(status="ok")

    return app


def _lifespan(
    settings: Settings, local: LocalDraftScheduler | None
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if local is not None:
            # Drafts left open by a restart continue on the local worker.
            try:
                await asyncio.to_thread(local.resume)
            except psycopg.Error:
                logger.warning("open drafts could not be resumed")
            try:
                yield
            finally:
                local.shutdown()
            return
        if settings.workflow_address == "" or settings.database_url == "":
            yield
            return
        from ai_workforce_api.durable import serve

        async with serve(
            settings.workflow_address,
            settings.database_url,
            draft_runner(settings),
            scan_runner(settings),
            analysis_runner(settings),
            console_runner(settings, helpers=_temporal_helpers(settings.workflow_address)),
        ):
            yield

    return lifespan


def _temporal_helpers(address: str) -> dict[str, object]:
    """The console's routine work goes back through the workflow engine."""
    from ai_workforce_api.durable import TemporalAdapter

    adapter = TemporalAdapter(address)
    return {"drafts": adapter, "analyses": adapter, "timer": adapter}


app = create_app()
