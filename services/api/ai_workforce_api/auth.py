"""Server-side sessions. Access tokens and refresh tokens are not stored or logged."""

import hashlib
import logging
import re
import secrets
from typing import Any, Literal
from urllib.parse import urlencode
from uuid import UUID

import psycopg
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from psycopg.types.json import Json
from pydantic import BaseModel
from starlette.middleware.base import RequestResponseEndpoint

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.identity import Identity, IdentityError, IdentityProvider, Issuer
from ai_workforce_api.settings import Settings
from ai_workforce_api.support_notifications import deliver_held, record, sign_up_text

SESSION_COOKIE = "aw_session"
PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/ready",
        "/auth/login",
        "/auth/callback",
        "/auth/google/login",
        "/auth/google/callback",
        "/auth/providers",
        "/auth/logout",
        "/auth/preview",
        # The landing page's demo request (demo_requests.py).
        "/public/demo-requests",
        # The library figures on the landing page (demo_requests.py).
        "/public/library-summary",
    }
)
# The evidence owner's secure upload link (evidence_portal.py): no account, its own
# link, code, and session tokens.
PUBLIC_PREFIXES = ("/public/evidence-portal/",)
PREVIEW_EMAIL = "preview.owner@example.com"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
# The attempt row keeps which provider started it, so a Google state cannot finish
# an Entra login or the other way round.
FLOW_PROVIDER_KEY = "aw_provider"
# Mailbox domains that say nothing about the firm. A workspace made for such an
# address is named after the person instead.
PUBLIC_MAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "yahoo.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "pm.me",
        "gmx.com",
        "mail.com",
        "example.com",
    }
)
SLUG_CHARS = re.compile(r"[^a-z0-9]+")
LoginFailure = Literal["failed", "unlinked", "disabled"]
FAILURE_STATUS: dict[LoginFailure, int] = {"failed": 400, "unlinked": 409, "disabled": 403}
FAILURE_DETAIL: dict[LoginFailure, str] = {
    "failed": "authentication failed",
    "unlinked": "account could not be linked",
    "disabled": "account is disabled",
}
logger = logging.getLogger(__name__)


class AccountLinkError(Exception):
    """The provider subject does not match the user already stored for this email."""


class ProviderBody(BaseModel):
    id: Issuer
    label: str
    login_path: str


class ProvidersBody(BaseModel):
    providers: list[ProviderBody]
    preview: bool


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def register_auth(
    app: FastAPI,
    settings: Settings,
    provider: IdentityProvider | None,
    google_provider: IdentityProvider | None = None,
) -> None:
    logging.getLogger("msal").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    @app.middleware("http")
    async def require_session(request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        if path in PUBLIC_PATHS or (
            path.startswith(PUBLIC_PREFIXES) and ".." not in path and "//" not in path
        ):
            return await call_next(request)
        user_id = _session_user_id(settings, request.cookies.get(SESSION_COOKIE))
        if isinstance(user_id, JSONResponse):
            return user_id
        request.state.user_id = user_id
        return await call_next(request)

    @app.get("/auth/providers", response_model=ProvidersBody)
    def providers(request: Request) -> ProvidersBody:
        listed: list[ProviderBody] = []
        if google_provider is not None:
            listed.append(
                ProviderBody(id="google", label="Google", login_path="/auth/google/login")
            )
        if provider is not None:
            listed.append(ProviderBody(id="entra", label="Microsoft", login_path="/auth/login"))
        preview = settings.preview_login_enabled and request.url.hostname in LOOPBACK_HOSTS
        return ProvidersBody(providers=listed, preview=preview)

    @app.get("/auth/login")
    def login() -> RedirectResponse:
        return _begin_login(settings, provider, "entra", settings.oidc_redirect_url)

    @app.get("/auth/callback")
    def callback(request: Request, tasks: BackgroundTasks) -> Response:
        return _finish_login(settings, provider, "entra", request, tasks)

    @app.get("/auth/google/login")
    def google_login() -> RedirectResponse:
        return _begin_login(settings, google_provider, "google", settings.google_redirect_url)

    @app.get("/auth/google/callback")
    def google_callback(request: Request, tasks: BackgroundTasks) -> Response:
        return _finish_login(settings, google_provider, "google", request, tasks)

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


def _begin_login(
    settings: Settings, provider: IdentityProvider | None, issuer: Issuer, redirect_uri: str
) -> RedirectResponse:
    if provider is None:
        raise HTTPException(status_code=503, detail="authentication is not configured")
    try:
        started = provider.begin(redirect_uri=redirect_uri)
        _save_attempt(settings, started.state, {**started.flow, FLOW_PROVIDER_KEY: issuer})
    except IdentityError:
        logger.warning("oidc login could not start: %s", issuer)
        raise HTTPException(status_code=503, detail="authentication is not configured") from None
    except psycopg.Error:
        logger.warning("login persistence failed")
        raise HTTPException(status_code=503, detail="authentication unavailable") from None
    return RedirectResponse(started.authorization_url, status_code=302)


def _finish_login(
    settings: Settings,
    provider: IdentityProvider | None,
    issuer: Issuer,
    request: Request,
    tasks: BackgroundTasks | None = None,
) -> Response:
    if provider is None:
        raise HTTPException(status_code=503, detail="authentication is not configured")
    state = request.query_params.get("state", "")
    if state == "":
        return _login_failed(settings, "failed")
    try:
        flow = _take_attempt(settings, state)
    except psycopg.Error:
        logger.warning("login attempt lookup failed")
        raise HTTPException(status_code=503, detail="authentication unavailable") from None
    if flow is None or flow.pop(FLOW_PROVIDER_KEY, None) != issuer:
        return _login_failed(settings, "failed")
    callback_values = {key: request.query_params[key] for key in request.query_params}
    try:
        identity = provider.complete(flow=flow, callback=callback_values)
    except IdentityError:
        logger.warning("oidc callback failed: %s", issuer)
        return _login_failed(settings, "failed")
    try:
        raw_token = _open_session(settings, identity)
    except AccountLinkError:
        return _login_failed(settings, "unlinked")
    except psycopg.Error:
        logger.warning("session creation failed")
        raise HTTPException(status_code=503, detail="authentication unavailable") from None
    if raw_token is None:
        return _login_failed(settings, "disabled")
    if tasks is not None:
        # A new sign-up is announced to support once the person is on their way in.
        tasks.add_task(deliver_held, settings)
    if settings.app_base_url != "":
        response: Response = RedirectResponse(settings.app_base_url, status_code=303)
    else:
        response = JSONResponse({"status": "authenticated"})
    _set_session_cookie(response, settings, raw_token)
    return response


def _login_failed(settings: Settings, failure: LoginFailure) -> Response:
    """Send the person back to the sign-in page when there is one; otherwise answer."""
    if settings.app_base_url != "":
        base = settings.app_base_url.rstrip("/")
        query = urlencode({"notice": failure})
        return RedirectResponse(f"{base}/sign-in?{query}", status_code=303)
    raise HTTPException(status_code=FAILURE_STATUS[failure], detail=FAILURE_DETAIL[failure])


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
            workspace = _ensure_workspace(cursor, user_id, identity)
            if workspace is not None:
                subject, text = sign_up_text(
                    name=identity.display_name or "",
                    email=identity.email,
                    workspace=workspace,
                    provider=PROVIDER_WORDS.get(identity.issuer, identity.issuer),
                )
                record(
                    cursor,
                    settings,
                    kind="SIGN_UP",
                    subject_id=user_id,
                    subject=subject,
                    body=text,
                    reply_to=identity.email,
                )
            cursor.execute(
                """
                INSERT INTO auth_sessions (user_id, token_hash, expires_at)
                VALUES (%s, %s, clock_timestamp() + make_interval(secs => %s))
                """,
                (user_id, token_hash(raw_token), settings.session_ttl_seconds),
            )
    return raw_token


def _link_user(cursor: psycopg.Cursor[Any], identity: Identity) -> UUID | None:
    """Find the user for this provider subject, or link it by verified email.

    A new email creates the user. An email already on file gains this provider's
    identity, unless the user already signed in through this provider as a different
    subject, which is refused. The result is None for a user who is not active.
    """
    cursor.execute(
        """
        SELECT u.id, u.status
        FROM user_identities AS i
        JOIN users AS u ON u.id = i.user_id
        WHERE i.issuer = %s AND i.subject = %s
        """,
        (identity.issuer, identity.subject),
    )
    matched = cursor.fetchone()
    if matched is None:
        cursor.execute("SELECT id, status FROM users WHERE email = %s", (identity.email,))
        matched = cursor.fetchone()
        if matched is None:
            cursor.execute(
                """
                INSERT INTO users (email, display_name)
                VALUES (%s, %s)
                RETURNING id, status
                """,
                (identity.email, identity.display_name or identity.email),
            )
            matched = cursor.fetchone()
            if matched is None or not isinstance(matched[0], UUID):
                raise AccountLinkError()
        user_id = matched[0]
        if not isinstance(user_id, UUID):
            raise AccountLinkError()
        cursor.execute(
            "SELECT subject FROM user_identities WHERE user_id = %s AND issuer = %s",
            (user_id, identity.issuer),
        )
        existing = cursor.fetchone()
        if existing is not None:
            raise AccountLinkError()
        cursor.execute(
            "INSERT INTO user_identities (user_id, issuer, subject) VALUES (%s, %s, %s)",
            (user_id, identity.issuer, identity.subject),
        )
    user_id, status = matched
    if not isinstance(user_id, UUID) or str(status) != "ACTIVE":
        return None
    return user_id


PROVIDER_WORDS = {"google": "Google", "entra": "Microsoft"}


def _ensure_workspace(cursor: psycopg.Cursor[Any], user_id: UUID, identity: Identity) -> str | None:
    """Give a person who belongs to no organization one of their own, as its owner.
    Returns the new workspace's name, or None when they already belonged to one."""
    cursor.execute("SELECT 1 FROM memberships WHERE user_id = %s LIMIT 1", (user_id,))
    if cursor.fetchone() is not None:
        return None
    name = workspace_name(identity.email, identity.display_name)
    organization_id: UUID | None = None
    base = workspace_slug(name)
    for attempt in range(6):
        slug = base if attempt == 0 else f"{base}-{secrets.token_hex(2)}"
        cursor.execute("SELECT 1 FROM organizations WHERE slug = %s", (slug,))
        if cursor.fetchone() is not None:
            continue
        cursor.execute(
            "INSERT INTO organizations (name, slug) VALUES (%s, %s) RETURNING id",
            (name, slug),
        )
        created = cursor.fetchone()
        if created is None or not isinstance(created[0], UUID):
            raise AccountLinkError()
        organization_id = created[0]
        break
    if organization_id is None:
        raise AccountLinkError()
    cursor.execute(
        """
        INSERT INTO memberships (organization_id, user_id, role)
        VALUES (%s, %s, 'OWNER')
        RETURNING id
        """,
        (organization_id, user_id),
    )
    membership = cursor.fetchone()
    # A firm's own domain is where its invitations may go. A personal mailbox is not.
    domain = identity.email.rsplit("@", 1)[-1].strip().lower()
    if domain not in PUBLIC_MAIL_DOMAINS and "." in domain:
        cursor.execute(
            """
            INSERT INTO organization_email_domains (organization_id, domain, added_by)
            VALUES (%s, %s, %s)
            ON CONFLICT (organization_id, domain) DO NOTHING
            """,
            (organization_id, domain, user_id),
        )
    if membership is None or not isinstance(membership[0], UUID):
        raise AccountLinkError()
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES
            (%s, %s, 'organization.create', 'organization', %s, %s),
            (%s, %s, 'membership.grant', 'membership', %s, %s)
        """,
        (
            organization_id,
            user_id,
            organization_id,
            Json({"source": "sign-up", "issuer": identity.issuer}),
            organization_id,
            user_id,
            membership[0],
            Json({"role": "OWNER", "status": "ACTIVE"}),
        ),
    )
    return name


def workspace_name(email: str, display_name: str | None) -> str:
    """A firm's domain names the workspace; a personal mailbox names it after the person."""
    domain = email.rsplit("@", 1)[-1].strip().lower()
    label = domain.split(".")[0] if domain != "" else ""
    if domain not in PUBLIC_MAIL_DOMAINS and len(label) >= 2:
        return f"{label[:1].upper()}{label[1:]}"
    person = (display_name or email.split("@", 1)[0]).strip()
    return f"{person}'s workspace"


def workspace_slug(name: str) -> str:
    slug = SLUG_CHARS.sub("-", name.lower()).strip("-")[:40].strip("-")
    return slug if slug != "" else "workspace"


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
