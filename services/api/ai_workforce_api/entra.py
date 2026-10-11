"""Microsoft Entra ID authorization-code login via the MSAL library."""

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


class EntraIdentityProvider:
    def __init__(self, client: MsalClient) -> None:
        self._client = client

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
        return identity_from_claims(claims)


def identity_from_claims(claims: object) -> Identity:
    if not isinstance(claims, dict):
        raise IdentityError()
    subject = claims.get("sub")
    email = claims.get("email") or claims.get("preferred_username")
    if not isinstance(subject, str) or subject.strip() == "":
        raise IdentityError()
    if not isinstance(email, str) or "@" not in email:
        raise IdentityError()
    if claims.get("email_verified") is False:
        raise IdentityError()
    return Identity(subject=subject, email=email)


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
    return EntraIdentityProvider(client)
