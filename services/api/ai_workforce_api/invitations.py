"""Inviting people to the firm by email, with the checks that keep invites from spam.

An invitation adds the person to the firm and to one engagement team, with a role, in
one step. The address must be well formed, on one of the firm's own email domains, not a
throwaway domain, and on a domain that accepts mail; and one person can send only so
many invitations an hour. The welcome email is written and stored with the invitation.
Live email is off, so it is held: nothing in this module sends mail.

Someone invited is "pending validation" until they sign in with that address through
Google or Microsoft, which proves the mailbox is theirs. Their role applies at once.
"""

import logging
import re
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.auth import PUBLIC_MAIL_DOMAINS
from ai_workforce_api.authorization import (
    Action,
    Principal,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

EngagementRole = Literal["LEAD", "PREPARER", "REVIEWER"]
MailCheck = Literal["YES", "NO", "UNKNOWN"]

HOURLY_LIMIT = 20
# The firm role an invitee starts with follows the engagement role. Owners and admins
# are never granted by an invitation.
FIRM_ROLE: dict[str, str] = {
    "LEAD": "PROJECT_MANAGER",
    "PREPARER": "CONTRIBUTOR",
    "REVIEWER": "REVIEWER",
}
ROLE_WORDS: dict[str, str] = {
    "LEAD": "engagement lead",
    "PREPARER": "preparer",
    "REVIEWER": "independent reviewer",
}
# Well-known temporary-mail services. Not exhaustive; the firm-domain rule is the
# stronger guard, and this catches a firm that lists such a domain by mistake.
DISPOSABLE_DOMAINS = frozenset(
    {
        "mailinator.com",
        "guerrillamail.com",
        "guerrillamail.net",
        "guerrillamail.org",
        "sharklasers.com",
        "grr.la",
        "10minutemail.com",
        "10minutemail.net",
        "tempmail.com",
        "temp-mail.org",
        "temp-mail.io",
        "tempmail.net",
        "tempmailo.com",
        "throwawaymail.com",
        "yopmail.com",
        "yopmail.net",
        "trashmail.com",
        "trashmail.de",
        "getnada.com",
        "nada.email",
        "dispostable.com",
        "maildrop.cc",
        "mailnesia.com",
        "mintemail.com",
        "mohmal.com",
        "fakeinbox.com",
        "emailondeck.com",
        "spamgourmet.com",
        "mytemp.email",
        "tempinbox.com",
        "burnermail.io",
        "inboxkitten.com",
        "moakt.com",
        "mailcatch.com",
        "33mail.com",
        "spam4.me",
        "discard.email",
        "tmail.ws",
        "tmpmail.org",
        "emailfake.com",
    }
)
_LOCAL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?$")
_DOMAIN = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
_NAME = re.compile(r"^[^<>@\r\n\t]{1,120}$")


class InviteRefused(Exception):
    """The invitation was not made. `detail` is a stable code the web app maps to text."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class DomainChecker(Protocol):
    def accepts_mail(self, domain: str) -> MailCheck:
        """Whether the domain publishes somewhere to deliver mail. Never sends anything."""


class DnsDomainChecker:
    """Looks up the domain's MX records, falling back to an address record (RFC 5321)."""

    def __init__(
        self,
        nameservers: list[str] | None = None,
        *,
        per_server_seconds: float = 0.8,
        total_seconds: float = 6.0,
    ) -> None:
        # A machine can list dead resolvers first (an old VPN adapter, say). A short wait
        # per server lets the lookup move on to one that answers.
        self._nameservers = nameservers or []
        self._per_server = per_server_seconds
        self._total = total_seconds

    def accepts_mail(self, domain: str) -> MailCheck:
        import dns.exception
        import dns.resolver

        if self._nameservers:
            resolver = dns.resolver.Resolver(configure=False)
            resolver.nameservers = self._nameservers
        else:
            resolver = dns.resolver.Resolver()
        resolver.timeout = self._per_server
        resolver.lifetime = self._total
        try:
            answer = resolver.resolve(domain, "MX")
            hosts = [str(getattr(record, "exchange", "")).rstrip(".") for record in answer]
            # A "null MX" (RFC 7505) says the domain accepts no mail.
            return "NO" if all(host == "" for host in hosts) else "YES"
        except dns.resolver.NXDOMAIN:
            return "NO"
        except dns.resolver.NoAnswer:
            for kind in ("A", "AAAA"):
                try:
                    resolver.resolve(domain, kind)
                    return "YES"
                except dns.resolver.NoAnswer, dns.resolver.NXDOMAIN:
                    continue
                except dns.exception.DNSException:
                    return "UNKNOWN"
            return "NO"
        except dns.exception.DNSException:
            return "UNKNOWN"


def dns_checker(settings: Settings) -> DnsDomainChecker:
    servers = [s.strip() for s in settings.dns_nameservers.split(",") if s.strip() != ""]
    return DnsDomainChecker(servers)


class InviteBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(default="", max_length=120)
    engagement_role: EngagementRole
    # Further roles, only while reviewer independence is off (onboarding.TeamAdd).
    additional_roles: list[EngagementRole] = Field(default_factory=list, max_length=2)


class DomainBody(BaseModel):
    domain: str = Field(min_length=3, max_length=253)


class DomainsBody(BaseModel):
    domains: list[str]


def normalize_email(value: str) -> tuple[str, str]:
    """The address as stored, and its domain. Refuses anything not plainly an address."""
    email = value.strip()
    if email.count("@") != 1 or len(email) > 254:
        raise InviteRefused(422, "email is not valid")
    local, domain = email.split("@")
    domain = domain.lower().rstrip(".")
    if not _LOCAL.match(local) or ".." in local or not _DOMAIN.match(domain):
        raise InviteRefused(422, "email is not valid")
    return f"{local}@{domain}", domain


def normalize_domain(value: str) -> str:
    domain = value.strip().lower().lstrip("@").rstrip(".")
    if not _DOMAIN.match(domain) or len(domain) > 253:
        raise InviteRefused(422, "domain is not valid")
    return domain


def check_domain(domain: str, checker: DomainChecker) -> None:
    """The spam checks every new address goes through, apart from the firm-domain rule."""
    if domain in DISPOSABLE_DOMAINS:
        raise InviteRefused(422, "email domain is disposable")
    verdict = checker.accepts_mail(domain)
    if verdict == "NO":
        raise InviteRefused(422, "email domain does not accept mail")
    if verdict == "UNKNOWN":
        raise InviteRefused(503, "email domain could not be checked")


def firm_domains(connection: psycopg.Connection[Any], organization_id: UUID) -> list[str]:
    rows = connection.execute(
        """
        SELECT domain::text FROM organization_email_domains
        WHERE organization_id = %s ORDER BY domain
        """,
        (organization_id,),
    ).fetchall()
    return [str(row[0]) for row in rows]


def invite(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    body: InviteBody,
    checker: DomainChecker,
    app_base_url: str,
) -> UUID:
    """Make sure the person is in the firm, then return their user id for the team step.

    The caller has already been allowed to change this engagement's team. A person
    already in the firm is returned as they are; anyone else goes through every check.
    """
    email, domain = normalize_email(body.email)
    name = body.display_name.strip()
    if name != "" and not _NAME.match(name):
        raise InviteRefused(422, "name is not valid")
    existing = connection.execute(
        """
        SELECT u.id, u.status::text, m.status::text
        FROM users AS u
        LEFT JOIN memberships AS m ON m.user_id = u.id AND m.organization_id = %s
        WHERE u.email = %s
        """,
        (organization_id, email),
    ).fetchone()
    if existing is not None and existing[2] == "ACTIVE":
        if not isinstance(existing[0], UUID):
            raise InviteRefused(409, "invitation could not be made")
        return existing[0]
    if existing is not None and (existing[1] != "ACTIVE" or existing[2] == "DISABLED"):
        raise InviteRefused(409, "person is disabled")
    allowed = firm_domains(connection, organization_id)
    if not allowed:
        raise InviteRefused(409, "firm has no email domains")
    if domain not in allowed:
        raise InviteRefused(422, "email domain is not the firm's")
    check_domain(domain, checker)
    sent = connection.execute(
        """
        SELECT count(*) FROM invitations
        WHERE invited_by = %s AND created_at > clock_timestamp() - interval '1 hour'
        """,
        (principal.id,),
    ).fetchone()
    if sent is not None and int(sent[0]) >= HOURLY_LIMIT:
        raise InviteRefused(429, "invitation limit reached")
    context = connection.execute(
        """
        SELECT o.name, p.name, coalesce(u.display_name, '')
        FROM organizations AS o
        JOIN projects AS p ON p.organization_id = o.id
        LEFT JOIN users AS u ON u.id = %s
        WHERE o.id = %s AND p.id = %s
        """,
        (principal.id, organization_id, project_id),
    ).fetchone()
    if context is None:
        raise InviteRefused(404, "not found")
    firm_role = FIRM_ROLE[body.engagement_role]
    shown_name = name or email.split("@")[0]
    subject, text = welcome_email(
        name=shown_name,
        email=email,
        firm=str(context[0]),
        engagement=str(context[1]),
        inviter=str(context[2]) or "A colleague",
        role=body.engagement_role,
        app_base_url=app_base_url,
    )
    with transaction(connection) as cursor:
        if existing is None:
            cursor.execute(
                "INSERT INTO users (email, display_name) VALUES (%s, %s) RETURNING id",
                (email, shown_name),
            )
            created = cursor.fetchone()
            if created is None or not isinstance(created[0], UUID):
                raise InviteRefused(409, "invitation could not be made")
            user_id = created[0]
        else:
            if not isinstance(existing[0], UUID):
                raise InviteRefused(409, "invitation could not be made")
            user_id = existing[0]
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (organization_id, user_id, firm_role),
        )
        membership = cursor.fetchone()
        if membership is None:
            raise InviteRefused(409, "invitation could not be made")
        cursor.execute(
            """
            INSERT INTO invitations (
                organization_id, project_id, user_id, email, invited_by,
                organization_role, engagement_role, welcome_subject, welcome_body
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                user_id,
                email,
                principal.id,
                firm_role,
                body.engagement_role,
                subject,
                text,
            ),
        )
        invitation = cursor.fetchone()
        if invitation is None:
            raise InviteRefused(409, "invitation could not be made")
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type,
                target_id, payload
            )
            VALUES
                (%s, NULL, %s, 'membership.grant', 'membership', %s, %s),
                (%s, %s, %s, 'invitation.create', 'invitation', %s, %s)
            """,
            (
                organization_id,
                principal.id,
                membership[0],
                Json({"role": firm_role, "status": "ACTIVE", "source": "invitation"}),
                organization_id,
                project_id,
                principal.id,
                invitation[0],
                Json({"engagement_role": body.engagement_role, "welcome": "HELD"}),
            ),
        )
    return user_id


def welcome_email(
    *,
    name: str,
    email: str,
    firm: str,
    engagement: str,
    inviter: str,
    role: str,
    app_base_url: str,
) -> tuple[str, str]:
    base = app_base_url.rstrip("/") or "the AI Workforce sign-in page"
    link = f"{base}/sign-in" if app_base_url.strip() != "" else base
    subject = f"You've been added to {firm} on AI Workforce"[:200]
    body = (
        f"Hi {name},\n\n"
        f"{inviter} added you to {firm} on AI Workforce as {ROLE_WORDS[role]} "
        f"on the engagement {engagement}.\n\n"
        f"To get started, sign in at {link} with your work account ({email}) through "
        "Google or Microsoft. There is no password to set.\n\n"
        "If you weren't expecting this, you can ignore this email."
    )
    return subject, body[:4000]


def signed_in(connection: psycopg.Connection[Any], user_ids: list[UUID]) -> set[UUID]:
    """The people who have signed in at least once, which validates their address."""
    if not user_ids:
        return set()
    rows = connection.execute(
        """
        SELECT u.id FROM users AS u
        WHERE u.id = ANY(%s)
          AND (
              EXISTS (SELECT 1 FROM user_identities AS i WHERE i.user_id = u.id)
              OR EXISTS (SELECT 1 FROM auth_sessions AS s WHERE s.user_id = u.id)
          )
        """,
        (user_ids,),
    ).fetchall()
    return {row[0] for row in rows if isinstance(row[0], UUID)}


def send_welcomes(
    connection: psycopg.Connection[Any],
    settings: Settings,
    organization_id: UUID,
    project_id: UUID,
    user_ids: list[UUID] | None = None,
    sender: Any = None,
) -> tuple[int, int]:
    """Send the engagement's held welcome emails (all, or these people's) when live email
    is on. Each goes once: it is marked sent only after the server accepts it. Returns
    (sent, not sent); one outside the allowed domains, or that fails, stays held."""
    from ai_workforce_api.mailbox import MailboxState
    from ai_workforce_api.smtp_mailbox import send_direct, smtp_live

    if not smtp_live(settings):
        return 0, 0
    rows = connection.execute(
        """
        SELECT id, email, welcome_subject, welcome_body FROM invitations
        WHERE organization_id = %s AND project_id = %s AND welcome_status = 'HELD'
          AND (%s::uuid[] IS NULL OR user_id = ANY(%s::uuid[]))
        ORDER BY created_at
        LIMIT 100
        """,
        (organization_id, project_id, user_ids, user_ids),
    ).fetchall()
    sent = failed = 0
    for invitation_id, email, subject, text in rows:
        try:
            send_direct(
                settings,
                idempotency_key=f"welcome:{invitation_id}",
                recipient=str(email),
                subject=str(subject),
                body=str(text),
                sender=sender,
            )
        except MailboxState:
            failed += 1
            continue
        except Exception:
            logger.warning("a welcome email could not be sent")
            failed += 1
            continue
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE invitations SET welcome_status = 'SENT' WHERE id = %s "
                "AND welcome_status = 'HELD'",
                (invitation_id,),
            )
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type,
                    target_id, payload
                )
                VALUES (%s, %s, NULL, 'invitation.welcome_sent', 'invitation', %s, '{}')
                """,
                (organization_id, project_id, invitation_id),
            )
        sent += 1
    return sent, failed


def held_welcomes(
    connection: psycopg.Connection[Any], organization_id: UUID, user_ids: list[UUID]
) -> set[UUID]:
    """The people whose welcome email is written and waiting for live email."""
    if not user_ids:
        return set()
    rows = connection.execute(
        """
        SELECT DISTINCT user_id FROM invitations
        WHERE organization_id = %s AND user_id = ANY(%s) AND welcome_status = 'HELD'
        """,
        (organization_id, user_ids),
    ).fetchall()
    return {row[0] for row in rows if isinstance(row[0], UUID)}


def register_invitations(
    app: FastAPI, settings: Settings, checker: DomainChecker | None = None
) -> None:
    """The firm's email domains. Every member can read them; owners and admins change them."""
    resolved: DomainChecker = checker if checker is not None else dns_checker(settings)
    base = "/organizations/{organization_id}/email-domains"

    def run(request: Request, work: Any) -> DomainsBody:
        principal = _session_principal(request)
        try:
            result: DomainsBody = _call(settings, lambda connection: work(connection, principal))
            return result
        except InviteRefused as refused:
            raise HTTPException(status_code=refused.status, detail=refused.detail) from None

    @app.get(base, response_model=DomainsBody)
    def read(organization_id: UUID, request: Request) -> DomainsBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> DomainsBody:
            authorize(
                connection,
                principal=principal,
                action=Action.ORGANIZATION_READ,
                organization_id=organization_id,
            )
            return DomainsBody(domains=firm_domains(connection, organization_id))

        return run(request, work)

    @app.post(base, response_model=DomainsBody)
    def add(organization_id: UUID, body: DomainBody, request: Request) -> DomainsBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> DomainsBody:
            authorize(
                connection,
                principal=principal,
                action=Action.ORGANIZATION_UPDATE,
                organization_id=organization_id,
            )
            domain = normalize_domain(body.domain)
            if domain in PUBLIC_MAIL_DOMAINS:
                raise InviteRefused(422, "domain is a public mail service")
            check_domain(domain, resolved)
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    INSERT INTO organization_email_domains (organization_id, domain, added_by)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (organization_id, domain) DO NOTHING
                    RETURNING id
                    """,
                    (organization_id, domain, principal.id),
                )
                added = cursor.fetchone()
                if added is not None:
                    cursor.execute(
                        """
                        INSERT INTO audit_events (
                            organization_id, actor_user_id, action, target_type,
                            target_id, payload
                        )
                        VALUES (%s, %s, 'organization.email_domain', 'organization', %s, %s)
                        """,
                        (organization_id, principal.id, organization_id, Json({"added": domain})),
                    )
            return DomainsBody(domains=firm_domains(connection, organization_id))

        return run(request, work)

    @app.post(f"{base}/remove", response_model=DomainsBody)
    def remove(organization_id: UUID, body: DomainBody, request: Request) -> DomainsBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> DomainsBody:
            authorize(
                connection,
                principal=principal,
                action=Action.ORGANIZATION_UPDATE,
                organization_id=organization_id,
            )
            domain = normalize_domain(body.domain)
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    DELETE FROM organization_email_domains
                    WHERE organization_id = %s AND domain = %s
                    RETURNING id
                    """,
                    (organization_id, domain),
                )
                if cursor.fetchone() is not None:
                    cursor.execute(
                        """
                        INSERT INTO audit_events (
                            organization_id, actor_user_id, action, target_type,
                            target_id, payload
                        )
                        VALUES (%s, %s, 'organization.email_domain', 'organization', %s, %s)
                        """,
                        (
                            organization_id,
                            principal.id,
                            organization_id,
                            Json({"removed": domain}),
                        ),
                    )
            return DomainsBody(domains=firm_domains(connection, organization_id))

        return run(request, work)
