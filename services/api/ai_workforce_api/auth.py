"""Server-side sessions. Access tokens and refresh tokens are not stored or logged."""

import hashlib
import logging
import secrets
from typing import Any
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from psycopg.types.json import Json
from starlette.middleware.base import RequestResponseEndpoint

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.identity import Identity, IdentityError, IdentityProvider
from ai_workforce_api.settings import Settings

SESSION_COOKIE = "aw_session"
PUBLIC_PATHS = frozenset(
    {"/health", "/ready", "/auth/login", "/auth/callback", "/auth/logout", "/auth/preview"}
)
PREVIEW_EMAIL = "preview.owner@example.com"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
logger = logging.getLogger(__name__)


class AccountLinkError(Exception):
    """The Entra subject does not match the user already stored for this email."""


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def register_auth(
    app: FastAPI,
    settings: Settings,
    provider: IdentityProvider | None,
) -> None:
    logging.getLogger("msal").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    @app.middleware("http")
    async def require_session(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)
        user_id = _session_user_id(settings, request.cookies.get(SESSION_COOKIE))
        if isinstance(user_id, JSONResponse):
            return user_id
        request.state.user_id = user_id
        return await call_next(request)

    @app.get("/auth/login")
    def login() -> RedirectResponse:
        if provider is None:
            raise HTTPException(status_code=503, detail="authentication is not configured")
        try:
            started = provider.begin(redirect_uri=settings.oidc_redirect_url)
            _save_attempt(settings, started.state, started.flow)
        except IdentityError:
            logger.warning("oidc login could not start")
            raise HTTPException(
                status_code=503, detail="authentication is not configured"
            ) from None
        except psycopg.Error:
            logger.warning("login persistence failed")
            raise HTTPException(status_code=503, detail="authentication unavailable") from None
        return RedirectResponse(started.authorization_url, status_code=302)

    @app.get("/auth/callback")
    def callback(request: Request) -> Response:
        if provider is None:
            raise HTTPException(status_code=503, detail="authentication is not configured")
        state = request.query_params.get("state", "")
        if state == "":
            raise HTTPException(status_code=400, detail="authentication failed")
        try:
            flow = _take_attempt(settings, state)
        except psycopg.Error:
            logger.warning("login attempt lookup failed")
            raise HTTPException(status_code=503, detail="authentication unavailable") from None
        if flow is None:
            raise HTTPException(status_code=400, detail="authentication failed")
        callback_values = {key: request.query_params[key] for key in request.query_params}
        try:
            identity = provider.complete(flow=flow, callback=callback_values)
        except IdentityError:
            logger.warning("oidc callback failed")
            raise HTTPException(status_code=400, detail="authentication failed") from None
        try:
            raw_token = _open_session(settings, identity)
        except AccountLinkError:
            raise HTTPException(status_code=409, detail="account could not be linked") from None
        except psycopg.Error:
            logger.warning("session creation failed")
            raise HTTPException(status_code=503, detail="authentication unavailable") from None
        if raw_token is None:
            raise HTTPException(status_code=403, detail="account is disabled")
        if settings.app_base_url != "":
            response: Response = RedirectResponse(settings.app_base_url, status_code=303)
        else:
            response = JSONResponse({"status": "authenticated"})
        _set_session_cookie(response, settings, raw_token)
        return response

    @app.get("/auth/preview")
    def preview(request: Request) -> Response:
        if not settings.preview_login_enabled or request.url.hostname not in LOOPBACK_HOSTS:
            raise HTTPException(status_code=404, detail="not found")
        if settings.database_url == "":
            raise HTTPException(status_code=503, detail="authentication unavailable")
        try:
            raw_token = _open_preview_session(settings)
        except psycopg.Error:
            logger.warning("preview session failed")
            raise HTTPException(status_code=503, detail="authentication unavailable") from None
        destination = settings.app_base_url or "http://localhost:3000"
        response: Response = RedirectResponse(destination, status_code=303)
        response.set_cookie(
            SESSION_COOKIE,
            raw_token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=settings.session_ttl_seconds,
            path="/",
        )
        return response

    @app.post("/auth/logout")
    def logout(request: Request) -> Response:
        raw_token = request.cookies.get(SESSION_COOKIE)
        if raw_token:
            _revoke_session(settings, raw_token)
        response = Response(status_code=204)
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=settings.session_cookie_secure,
            httponly=True,
            samesite="lax",
        )
        return response

    @app.get("/auth/me")
    def me(request: Request) -> dict[str, str]:
        user_id = request.state.user_id
        if not isinstance(user_id, UUID):
            raise HTTPException(status_code=401, detail="authentication required")
        with connect(settings.database_url) as connection:
            row = connection.execute(
                "SELECT id, email::text FROM users WHERE id = %s",
                (user_id,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="authentication required")
        return {"id": str(row[0]), "email": str(row[1])}


def _session_user_id(settings: Settings, raw_token: str | None) -> UUID | JSONResponse:
    if raw_token is None or raw_token == "":
        return JSONResponse({"detail": "authentication required"}, status_code=401)
    if settings.database_url == "":
        return JSONResponse({"detail": "authentication unavailable"}, status_code=503)
    try:
        with connect(settings.database_url) as connection:
            row = connection.execute(
                """
                SELECT user_id
                FROM auth_sessions
                WHERE token_hash = %s
                  AND revoked_at IS NULL
                  AND expires_at > clock_timestamp()
                """,
                (token_hash(raw_token),),
            ).fetchone()
    except psycopg.Error:
        logger.warning("session lookup failed")
        return JSONResponse({"detail": "authentication unavailable"}, status_code=503)
    if row is None or not isinstance(row[0], UUID):
        return JSONResponse({"detail": "authentication required"}, status_code=401)
    return row[0]


def _save_attempt(settings: Settings, state: str, flow: dict[str, Any]) -> None:
    with connect(settings.database_url) as connection:
        with transaction(connection) as cursor:
            cursor.execute("DELETE FROM oidc_login_attempts WHERE expires_at <= clock_timestamp()")
            cursor.execute(
                """
                INSERT INTO oidc_login_attempts (state_hash, flow, expires_at)
                VALUES (%s, %s, clock_timestamp() + make_interval(secs => %s))
                """,
                (token_hash(state), Json(flow), settings.login_attempt_ttl_seconds),
            )


def _take_attempt(settings: Settings, state: str) -> dict[str, Any] | None:
    with connect(settings.database_url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                DELETE FROM oidc_login_attempts
                WHERE state_hash = %s AND expires_at > clock_timestamp()
                RETURNING flow
                """,
                (token_hash(state),),
            )
            row = cursor.fetchone()
    if row is None or not isinstance(row[0], dict):
        return None
    flow: dict[str, Any] = row[0]
    return flow


def _open_session(settings: Settings, identity: Identity) -> str | None:
    raw_token = secrets.token_urlsafe(32)
    with connect(settings.database_url) as connection:
        with transaction(connection) as cursor:
            user_id = _link_user(cursor, identity)
            if user_id is None:
                return None
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + make_interval(secs => %s))
                """,
                (user_id, token_hash(raw_token), settings.session_ttl_seconds),
            )
    return raw_token


def _link_user(cursor: psycopg.Cursor[Any], identity: Identity) -> UUID | None:
    cursor.execute(
        "SELECT id, status, oidc_subject FROM users WHERE oidc_subject = %s",
        (identity.subject,),
    )
    matched = cursor.fetchone()
    if matched is None:
        cursor.execute(
            "SELECT id, status, oidc_subject FROM users WHERE email = %s",
            (identity.email,),
        )
        matched = cursor.fetchone()
        if matched is None:
            cursor.execute(
                """
                INSERT INTO users (email, display_name, oidc_subject)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (identity.email, identity.email, identity.subject),
            )
            created = cursor.fetchone()
            if created is None or not isinstance(created[0], UUID):
                raise AccountLinkError()
            return created[0]
        user_id, status, existing_subject = matched
        if not isinstance(user_id, UUID):
            raise AccountLinkError()
        if existing_subject not in (None, identity.subject):
            raise AccountLinkError()
        if existing_subject is None:
            cursor.execute(
                """
                UPDATE users
                SET oidc_subject = %s, version = version + 1
                WHERE id = %s AND version >= 1
                """,
                (identity.subject, user_id),
            )
        if str(status) != "ACTIVE":
            return None
        return user_id
    user_id, status, _existing = matched
    if not isinstance(user_id, UUID) or str(status) != "ACTIVE":
        return None
    return user_id


def _open_preview_session(settings: Settings) -> str:
    raw_token = secrets.token_urlsafe(32)
    with connect(settings.database_url) as connection:
        with transaction(connection) as cursor:
            user_id = _ensure_preview_owner(cursor)
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + make_interval(secs => %s))
                """,
                (user_id, token_hash(raw_token), settings.session_ttl_seconds),
            )
    return raw_token


def _ensure_preview_owner(cursor: psycopg.Cursor[Any]) -> UUID:
    cursor.execute("SELECT id FROM users WHERE email = %s", (PREVIEW_EMAIL,))
    user = cursor.fetchone()
    if user is None:
        cursor.execute(
            """
            INSERT INTO users (email, display_name)
            VALUES (%s, 'Preview owner')
            RETURNING id
            """,
            (PREVIEW_EMAIL,),
        )
        user = cursor.fetchone()
    if user is None or not isinstance(user[0], UUID):
        raise AccountLinkError()
    user_id = user[0]
    cursor.execute(
        """
        UPDATE users
        SET status = 'ACTIVE', version = version + 1
        WHERE id = %s AND status <> 'ACTIVE'
        """,
        (user_id,),
    )
    cursor.execute("SELECT id FROM organizations WHERE slug = 'preview'")
    organization = cursor.fetchone()
    if organization is None:
        cursor.execute(
            """
            INSERT INTO organizations (name, slug)
            VALUES ('Preview workspace', 'preview')
            RETURNING id
            """
        )
        organization = cursor.fetchone()
    if organization is None or not isinstance(organization[0], UUID):
        raise AccountLinkError()
    organization_id = organization[0]
    cursor.execute(
        """
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES (%s, %s, 'OWNER')
        ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role = 'OWNER', status = 'ACTIVE', version = memberships.version + 1
        """,
        (organization_id, user_id),
    )
    cursor.execute(
        """
        SELECT id FROM projects
        WHERE organization_id = %s AND slug = 'sox-2026'
        """,
        (organization_id,),
    )
    project = cursor.fetchone()
    if project is None:
        cursor.execute(
            """
            INSERT INTO projects (
                organization_id, name, slug, scope, owner_user_id, status
            )
            VALUES (%s, 'SOX 2026', 'sox-2026', 'Local preview engagement', %s, 'ACTIVE')
            RETURNING id
            """,
            (organization_id, user_id),
        )
        project = cursor.fetchone()
        if project is None or not isinstance(project[0], UUID):
            raise AccountLinkError()
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (project_id, user_id) DO NOTHING
            """,
            (organization_id, project[0], user_id),
        )
    return user_id


def _revoke_session(settings: Settings, raw_token: str) -> None:
    if settings.database_url == "":
        return
    with connect(settings.database_url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                UPDATE auth_sessions
                SET revoked_at = clock_timestamp(), version = version + 1
                WHERE token_hash = %s AND revoked_at IS NULL
                """,
                (token_hash(raw_token),),
            )


def _set_session_cookie(response: Response, settings: Settings, raw_token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_seconds,
        path="/",
    )
