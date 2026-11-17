"""The caller's network address, the trusted proxies, and the preview sign-in's guards
(security review, 17 November 2026).

Before, the first X-Forwarded-For hop was believed from anyone, so a caller could name any
address and pass every per-address limit; and the preview sign-in was offered to any
request that said "Host: localhost".
"""

import pytest
from fastapi import Request
from pydantic import ValidationError

from ai_workforce_api.rate_limit import client_address
from ai_workforce_api.settings import Settings


def _request(peer: str, forwarded: str | None = None) -> Request:
    headers = [] if forwarded is None else [(b"x-forwarded-for", forwarded.encode())]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "query_string": b"",
            "headers": headers,
            "client": (peer, 50000),
        }
    )


def test_a_forwarded_address_from_an_untrusted_peer_is_ignored() -> None:
    nobody = Settings()
    assert client_address(_request("203.0.113.7", "198.51.100.1"), nobody) == "203.0.113.7"
    # Not even from the machine itself unless it is named as a proxy.
    assert client_address(_request("127.0.0.1", "198.51.100.1"), nobody) == "127.0.0.1"
    some = Settings(trusted_proxies="10.0.0.0/8")
    assert client_address(_request("203.0.113.7", "198.51.100.1"), some) == "203.0.113.7"


def test_a_trusted_proxys_forwarded_address_is_believed() -> None:
    settings = Settings(trusted_proxies="127.0.0.1")
    assert client_address(_request("127.0.0.1", "198.51.100.1"), settings) == "198.51.100.1"
    # A trusted proxy that forwards nothing is the caller itself.
    assert client_address(_request("127.0.0.1"), settings) == "127.0.0.1"
    assert client_address(_request("127.0.0.1", "not-an-address"), settings) == "127.0.0.1"


def test_the_right_most_hop_that_is_not_a_trusted_proxy_is_chosen() -> None:
    settings = Settings(trusted_proxies="127.0.0.1, 10.0.0.0/8")
    # The visitor wrote 6.6.6.6 itself; the load balancer (10.0.0.5) saw 203.0.113.9 and
    # the web tier (127.0.0.1) saw the load balancer.
    request = _request("127.0.0.1", "6.6.6.6, 203.0.113.9, 10.0.0.5")
    assert client_address(request, settings) == "203.0.113.9"
    v6 = Settings(trusted_proxies="::1")
    assert client_address(_request("::1", "2001:db8::1, ::1"), v6) == "2001:db8::1"


def test_trusted_proxies_load_from_the_environment_and_are_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRUSTED_PROXIES", "127.0.0.1, 10.0.0.0/8")
    networks = [str(network) for network in Settings().trusted_proxy_networks()]
    assert networks == ["127.0.0.1/32", "10.0.0.0/8"]
    assert Settings(trusted_proxies="").trusted_proxy_networks() == ()
    with pytest.raises(ValidationError, match="TRUSTED_PROXIES"):
        Settings(trusted_proxies="127.0.0.1, proxy.example")


def test_the_preview_sign_in_is_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="PREVIEW_LOGIN_ENABLED"):
        Settings(app_env="production", preview_login_enabled=True)
    with pytest.raises(ValidationError, match="PREVIEW_LOGIN_ENABLED"):
        Settings(app_env=" Production ", preview_login_enabled=True)
    assert Settings(app_env="production", preview_login_enabled=False).app_env == "production"
    assert Settings(app_env="development", preview_login_enabled=True).preview_login_enabled
