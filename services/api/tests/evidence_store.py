"""Store a reply's attachment as evidence for tests that need evidence from a mailbox file.

Since Milestone 8.12 the API no longer takes evidence from email: the route refuses, and
owners upload through their secure link. Files stored that way before the change keep
working, so the service that stored them stays, and these tests reach it directly, as
the person whose session the test client holds.
"""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient

from ai_workforce_api.auth import SESSION_COOKIE, token_hash
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.evidence import _store
from ai_workforce_api.evidence_analysis import schedule_analyses
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import open_store


def client_user(client: TestClient, database_url: str) -> UUID:
    token = client.cookies.get(SESSION_COOKIE)
    assert token is not None
    with connect(database_url) as connection:
        row = connection.execute(
            "SELECT user_id FROM auth_sessions WHERE token_hash = %s", (token_hash(token),)
        ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def store_attachment(
    client: TestClient,
    organization_id: Any,
    project_id: Any,
    attachment_id: Any,
    content: bytes,
    analyses: Any = None,
) -> dict[str, Any]:
    """Store the attachment as the client's user; raises what the service raises."""
    settings: Settings = client.app.state.settings  # type: ignore[attr-defined]
    database_url = settings.database_url
    user = client_user(client, database_url)
    with connect(database_url) as connection:
        stored, queued = _store(
            connection,
            open_store(settings, connection),
            Principal(PrincipalKind.USER, user),
            UUID(str(organization_id)),
            UUID(str(project_id)),
            UUID(str(attachment_id)),
            content,
        )
    # As the route did: the new file's reading goes to the background scheduler.
    schedule_analyses(analyses, [] if queued is None else [queued])
    return stored.model_dump(mode="json")
