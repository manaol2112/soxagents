"""Google sign-in: the OpenID Connect authorization-code flow with PKCE.

The ID token is verified against Google's published keys. Access and refresh tokens are
discarded as soon as the token endpoint answers, and nothing here logs the callback.
"""

import base64
import hashlib
import secrets
from typing import Any, Protocol
from urllib.parse import urlencode

from ai_workforce_api.identity import AuthStart, Identity, IdentityError

AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"


class TokenExchange(Protocol):
    def exchange(self, form: dict[str, str]) -> dict[str, Any]:
        """Post the code to the token endpoint. Callers must not log the result."""

    def claims(self, id_token: str, *, audience: str) -> dict[str, Any]:
        """Verify the ID token's signature, issuer, audience, and expiry; return claims."""


class GoogleIdentityProvider:
    def __init__(self, *, client_id: str, client_secret: str, exchange: TokenExchange) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._exchange = exchange

    def begin(self, *, redirect_uri: str) -> AuthStart:
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = _s256(verifier)
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": SCOPES,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "access_type": "online",
                "prompt": "select_account",
            }
        )
        return AuthStart(
            authorization_url=f"{AUTHORIZATION_ENDPOINT}?{query}",
            state=state,
            flow={
                "state": state,
                "nonce": nonce,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
            },
        )

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        if "error" in callback:
            raise IdentityError()
        code = callback.get("code", "")
        state = flow.get("state")
        verifier = flow.get("code_verifier")
        redirect_uri = flow.get("redirect_uri")
        nonce = flow.get("nonce")
        if (
            code == ""
            or not isinstance(state, str)
            or not isinstance(verifier, str)
            or not isinstance(redirect_uri, str)
            or not isinstance(nonce, str)
            or not secrets.compare_digest(callback.get("state", ""), state)
        ):
            raise IdentityError()
        result = self._exchange.exchange(
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uri": redirect_uri,
                "code_verifier": verifier,
            }
        )
        id_token = result.get("id_token")
        if not isinstance(id_token, str) or id_token == "":
            raise IdentityError()
        claims = self._exchange.claims(id_token, audience=self._client_id)
        return identity_from_google_claims(claims, nonce=nonce)


def identity_from_google_claims(claims: object, *, nonce: str) -> Identity:
    if not isinstance(claims, dict):
        raise IdentityError()
    if claims.get("iss") not in ISSUERS:
        raise IdentityError()
    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not secrets.compare_digest(token_nonce, nonce):
        raise IdentityError()
    subject = claims.get("sub")
    email = claims.get("email")
    if not isinstance(subject, str) or subject.strip() == "":
        raise IdentityError()
    if not isinstance(email, str) or "@" not in email:
        raise IdentityError()
    # Google accounts can carry an unverified address; only a verified one may link.
    if claims.get("email_verified") is not True:
        raise IdentityError()
    name = claims.get("name")
    display_name = name.strip() if isinstance(name, str) and name.strip() != "" else None
    return Identity(subject=subject, email=email, issuer="google", display_name=display_name)


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class HttpTokenExchange:
    """Talks to Google. Created only when Google sign-in is configured."""

    def __init__(self) -> None:
        import jwt

        self._jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True)

    def exchange(self, form: dict[str, str]) -> dict[str, Any]:
        import requests

        try:
            response = requests.post(TOKEN_ENDPOINT, data=form, timeout=10)
        except requests.RequestException:
            raise IdentityError() from None
        if response.status_code != 200:
            raise IdentityError()
        body = response.json()
        if not isinstance(body, dict):
            raise IdentityError()
        return body

    def claims(self, id_token: str, *, audience: str) -> dict[str, Any]:
        import jwt

        try:
            key = self._jwks.get_signing_key_from_jwt(id_token)
            decoded = jwt.decode(
                id_token,
                key.key,
                algorithms=["RS256"],
                audience=audience,
                issuer=list(ISSUERS),
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise IdentityError() from None
        if not isinstance(decoded, dict):
            raise IdentityError()
        return decoded


def build_google_provider(*, client_id: str, client_secret: str) -> GoogleIdentityProvider:
    if client_id.strip() == "" or client_secret == "":
        raise IdentityError()
    return GoogleIdentityProvider(
        client_id=client_id, client_secret=client_secret, exchange=HttpTokenExchange()
    )
