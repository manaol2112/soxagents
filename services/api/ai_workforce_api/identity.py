"""OIDC identity. Tokens never appear on this type."""

from dataclasses import dataclass
from typing import Any, Literal, Protocol

Issuer = Literal["entra", "google"]


class IdentityError(Exception):
    """The identity provider rejected the login. The message is static."""

    def __init__(self) -> None:
        super().__init__("authentication failed")


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str
    issuer: Issuer = "entra"
    display_name: str | None = None


@dataclass(frozen=True)
class AuthStart:
    authorization_url: str
    state: str
    flow: dict[str, Any]


class IdentityProvider(Protocol):
    def begin(self, *, redirect_uri: str) -> AuthStart:
        """Start an authorization-code login."""

    def complete(self, *, flow: dict[str, Any], callback: dict[str, str]) -> Identity:
        """Finish login. Implementations must not log the callback or the flow."""
