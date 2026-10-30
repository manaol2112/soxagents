"""Request throttles (pre-launch hardening, Step 7; migration 0134).

A fixed window per scope and key: one atomic upsert counts the request and answers how
many the window holds, so requests arriving together are counted together and the limit
holds under concurrency. The counters live in the database the request already uses, so
nothing new is deployed, and every API instance shares them. Thresholds come from the
settings, in one place; a threshold of 0 turns a scope off. A failure to count fails
closed for the scopes that create something (sign-up, the demo) and open for the ones
that only read a session, so a database hiccup never locks everyone out of signing in.

The scopes:

- ``login``        a network address starting a sign-in
- ``callback``     a network address finishing one
- ``signup``       a network address creating a firm (a new trial)
- ``signup_identity`` a normalised email identity creating a firm
- ``demo``         a firm starting or resetting its demo
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any, Literal

import psycopg
from fastapi import Request

from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

Scope = Literal["login", "callback", "signup", "signup_identity", "demo"]

# Mail providers whose addresses ignore dots before the @ (and all treat +tags as the
# same mailbox): the identity behind a trial is the mailbox, not the spelling.
DOTLESS_DOMAINS = frozenset({"gmail.com", "googlemail.com"})


class RateLimited(Exception):
    """Too many requests in the window; the answer says when to try again."""

    def __init__(self, scope: str, retry_after: int) -> None:
        super().__init__(f"rate limited: {scope}")
        self.scope = scope
        self.retry_after = retry_after


def client_address(request: Request) -> str:
    """The caller's network address: the first hop of X-Forwarded-For when the request
    came through the web proxy, else the socket's peer. Never empty."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:120]
    host = request.client.host if request.client is not None else ""
    return (host or "unknown")[:120]


def normalized_identity(email: str) -> str:
    """The mailbox behind an address: lower case, no +tag, and for the dotless providers
    no dots in the local part. Not a validation; a spelling the provider verified."""
    address = email.strip().lower()
    if "@" not in address:
        return address
    local, domain = address.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if domain in DOTLESS_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}"


def identity_hash(email: str) -> str:
    return hashlib.sha256(normalized_identity(email).encode("utf-8")).hexdigest()


def threshold(settings: Settings, scope: Scope) -> tuple[int, int]:
    """The limit and the window in seconds for a scope, from the settings."""
    return {
        "login": (settings.rate_limit_login_per_address, settings.rate_limit_login_window_seconds),
        "callback": (
            settings.rate_limit_login_per_address,
            settings.rate_limit_login_window_seconds,
        ),
        "signup": (
            settings.rate_limit_signup_per_address,
            settings.rate_limit_signup_window_seconds,
        ),
        "signup_identity": (
            settings.rate_limit_signup_per_identity,
            settings.rate_limit_signup_window_seconds,
        ),
        "demo": (settings.rate_limit_demo_per_firm, settings.rate_limit_demo_window_seconds),
    }[scope]


def count(cursor: Any, scope: Scope, key: str, window_seconds: int) -> int:
    """Count one request in the current window and return the window's total."""
    row = cursor.execute(
        """
        INSERT INTO rate_limit_hits (scope, key, window_start, hits)
        VALUES (%s, %s, to_timestamp(floor(extract(epoch from clock_timestamp()) / %s) * %s), 1)
        ON CONFLICT (scope, key, window_start) DO UPDATE SET hits = rate_limit_hits.hits + 1
        RETURNING hits
        """,
        (scope, key[:200], window_seconds, window_seconds),
    ).fetchone()
    return int(row[0]) if row is not None else 1


def enforce(cursor: Any, settings: Settings, scope: Scope, key: str, *, fail_closed: bool) -> None:
    """Count the request and refuse it once the window is full. On a counting failure,
    refuse (fail closed) or let it through (fail open), as the scope's risk warrants."""
    limit, window = threshold(settings, scope)
    if limit <= 0:
        return
    try:
        hits = count(cursor, scope, key, window)
    except psycopg.Error:
        logger.warning("rate limit could not be counted: %s", scope)
        if fail_closed:
            raise RateLimited(scope, window) from None
        return
    if hits > limit:
        raise RateLimited(scope, window)


def enforce_on(
    connection: psycopg.Connection[Any],
    settings: Settings,
    scope: Scope,
    key: str,
    *,
    fail_closed: bool = True,
) -> None:
    """The same, on a connection of its own transaction, committed at once so the count
    is seen by every other request whatever this one does afterwards."""
    limit, window = threshold(settings, scope)
    if limit <= 0:
        return
    try:
        with transaction(connection) as cursor:
            hits = count(cursor, scope, key, window)
        connection.commit()
    except psycopg.Error:
        logger.warning("rate limit could not be counted: %s", scope)
        if fail_closed:
            raise RateLimited(scope, window) from None
        return
    if hits > limit:
        raise RateLimited(scope, window)


def sweep(connection: psycopg.Connection[Any]) -> int:
    """Housekeeping: windows older than a day are gone."""
    with transaction(connection) as cursor:
        cursor.execute(
            "DELETE FROM rate_limit_hits WHERE window_start < clock_timestamp() - interval '1 day'"
        )
        return int(cursor.rowcount or 0)


def retry_detail(error: RateLimited) -> dict[str, Any]:
    minutes = max(1, round(error.retry_after / 60))
    return {
        "detail": f"too many requests; try again in about {minutes} minute"
        f"{'s' if minutes != 1 else ''}",
        "code": "RATE_LIMITED",
        "retry_after": error.retry_after,
    }
