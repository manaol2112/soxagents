"""What reads as a secret in text an agent or a person wrote (actions.contains_secret)."""

import pytest

from ai_workforce_api.actions import contains_secret


@pytest.mark.parametrize(
    "text",
    [
        "api_key=sk-live-example",
        "use sk-abc123 to sign in",
        '"sk-proj-9f2c"',
        "token:sk-live-1",
        "password: Winter2026!x",
        "client_secret = abc",
        "-----BEGIN RSA PRIVATE KEY-----",
    ],
)
def test_a_secret_is_recognised(text: str) -> None:
    assert contains_secret({"text": text})


@pytest.mark.parametrize(
    "text",
    [
        # Seen 14 November 2026: the key pattern matched inside ordinary audit wording, so
        # a follow-up asking for "the risk-based sampling memo" was dropped as a secret.
        "Provide the risk-based sampling memo.",
        "A task-level review of the desk-check and the disk-usage report.",
        "The password policy requires twelve characters.",
    ],
)
def test_ordinary_audit_wording_is_not_a_secret(text: str) -> None:
    assert not contains_secret({"text": text})
