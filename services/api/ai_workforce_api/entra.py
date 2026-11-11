"""Microsoft Entra ID authorization-code login via the MSAL library.

Whose email a token carries (security sweep, 9 November 2026). A sign-in links to the account
already on file for its email, so the email must be one Microsoft vouches for. With a
tenant-specific authority the firm's own directory issues the address: the token must come
from that tenant. With a multi-tenant authority (common, organizations, consumers) any
directory's administrator can put any address on a user, so the token must carry the `email`
claim with the optional `xms_edov` claim true (the email's domain is verified by its owner);
the user name (`preferred_username`) is never taken as the email there.
"""

import re
from typing import Any, Protocol
from urllib.parse import urlsplit

from ai_workforce_api.identity import AuthStart, Identity, IdentityError


class MsalClient(Protocol):
    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None
    ) -> dict[str, Any]:
        """Return the MSAL auth-code flow, including its authorization URL."""

    def acquire_token_by_auth_code_flow(
        self,
        auth_code_flow: dict[str, Any],
        auth_response: dict[str, str],
        scopes: list[str] | None = None,
    ) -> dict[str, Any]:
        """Exchange the callback for claims. Callers must not log the result."""


MULTI_TENANT = frozenset({"common", "organizations", "consumers"})
TENANT_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class EntraIdentityProvider:
    def __init__(self, client: MsalClient, tenant: str | None = None) -> None:
        self._client = client
        self._tenant = tenant

    def begin(self, *, redirect_uri: str) -> AuthStart:
        flow = self._client.initiate_auth_code_flow(["email"], redirect_uri=redirect_uri)
        authorization_url = flow.get("auth_uri")
        state = flow.get("state")
        if not isinstance(authorization_url, str) or not isinstance(state, str) or state == "":
            raise IdentityError()
        return AuthStart(authorization_url=authorization_url, state=state, flow=flow)

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        result = self._client.acquire_token_by_auth_code_flow(flow, callback, scopes=["email"])
        if "error" in result:
            raise IdentityError()
        claims = result.get("id_token_claims")
        return identity_from_claims(claims, tenant=self._tenant)


def identity_from_claims(claims: object, *, tenant: str | None = None) -> Identity:
    """The identity a token names. `tenant` is the authority's tenant; None or a
    multi-tenant name needs the verified-domain email (see the module note)."""
    if not isinstance(claims, dict):
        raise IdentityError()
    subject = claims.get("sub")
    named = (tenant or "").strip().lower()
    if named == "" or named in MULTI_TENANT:
        email = claims.get("email")
        if not _true(claims.get("xms_edov")):
            raise IdentityError()
    else:
        token_tenant = claims.get("tid")
        if TENANT_ID.match(named) and (
            not isinstance(token_tenant, str) or token_tenant.strip().lower() != named
        ):
            raise IdentityError()
        email = claims.get("email") or claims.get("preferred_username")
    if not isinstance(subject, str) or subject.strip() == "":
        raise IdentityError()
    if not isinstance(email, str) or "@" not in email:
        raise IdentityError()
    if claims.get("email_verified") is False:
        raise IdentityError()
    name = claims.get("name")
    display_name = name.strip() if isinstance(name, str) and name.strip() != "" else None
    return Identity(subject=subject, email=email, issuer="entra", display_name=display_name)


def _true(value: object) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in ("true", "1"))


def tenant_from_issuer(issuer: str) -> str | None:
    """The tenant segment of an authority, such as a directory id or `organizations`."""
    path = urlsplit(authority_from_issuer(issuer)).path.strip("/")
    first = path.split("/", 1)[0] if path != "" else ""
    return first or None


def authority_from_issuer(issuer: str) -> str:
    value = issuer.strip().rstrip("/")
    suffix = "/v2.0"
    if value.endswith(suffix):
        return value[: -len(suffix)]
    return value


def build_entra_provider(
    *, issuer: str, client_id: str, client_secret: str
) -> EntraIdentityProvider:
    import msal

    parsed = urlsplit(authority_from_issuer(issuer))
    if parsed.scheme != "https" or parsed.netloc == "":
        raise IdentityError()
    client = msal.ConfidentialClientApplication(
        client_id,
        authority=authority_from_issuer(issuer),
        client_credential=client_secret,
    )
    return EntraIdentityProvider(client, tenant=tenant_from_issuer(issuer))
