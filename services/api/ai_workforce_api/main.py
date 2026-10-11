"""API entrypoint.

Workflow execution is Temporal behind the interface in ADR 0002.
Agent coordination stays in-repository per ADR 0003.
Authentication is Entra ID per ADR 0004.
Authorization is the deny-by-default policy in authorization.py.
Object storage is the S3 API per ADR 0005 and is not called from this module.
"""

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
from ai_workforce_api.db import connect
from ai_workforce_api.entra import build_entra_provider
from ai_workforce_api.execution import register_execution
from ai_workforce_api.handoffs import register_handoffs
from ai_workforce_api.identity import IdentityProvider
from ai_workforce_api.mailbox import live_send_enabled, register_mailbox
from ai_workforce_api.manager import register_manager
from ai_workforce_api.models import ModelProvider, register_models
from ai_workforce_api.outbound import register_outbound
from ai_workforce_api.pbc import register_pbc
from ai_workforce_api.policy import register_policy
from ai_workforce_api.projects import register_projects
from ai_workforce_api.settings import Settings
from ai_workforce_api.tasks import register_tasks
from ai_workforce_api.workflow import DurableRun, register_workflows


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
    if attached is None and resolved.workflow_address != "":
        from ai_workforce_api.durable import TemporalAdapter

        attached = TemporalAdapter(resolved.workflow_address)
    app = FastAPI(title="AI Employee Workforce API", lifespan=_lifespan(resolved))
    register_auth(app, resolved, provider)
    register_authorization(app, resolved)
    register_projects(app, resolved)
    register_agents(app, resolved)
    register_tasks(app, resolved)
    register_workflows(app, resolved, durable=attached)
    register_models(app, resolved, model_provider)
    register_manager(app, resolved, model_provider, attached)
    register_handoffs(app, resolved)
    register_actions(app, resolved)
    register_policy(app, resolved)
    register_approvals(app, resolved)
    register_execution(app, resolved)
    register_mailbox(app, resolved)
    register_pbc(app, resolved)
    register_outbound(app, resolved)

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
    settings: Settings,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if settings.workflow_address == "" or settings.database_url == "":
            yield
            return
        from ai_workforce_api.durable import serve

        async with serve(settings.workflow_address, settings.database_url):
            yield

    return lifespan


app = create_app()
