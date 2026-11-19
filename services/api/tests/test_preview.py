from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings

# Security review, 17 November 2026: whether the caller is on this machine is its network
# address (the connection's peer), never the Host header. Old expectation: a request to
# http://localhost opened the preview from wherever it came. New: only a caller whose
# address is a loopback address does; the tests name the peer (TestClient's `client`).
LOCAL = ("127.0.0.1", 50000)
REMOTE = ("203.0.113.7", 50000)


def _client(
    database: Database, *, preview: bool, base_url: str, peer: tuple[str, int] = LOCAL
) -> TestClient:
    app = create_app(
        Settings(
            database_url=database.url,
            preview_login_enabled=preview,
            app_base_url="http://localhost:3000",
            session_cookie_secure=False,
        )
    )
    return TestClient(app, base_url=base_url, client=peer)


def test_preview_is_hidden_unless_enabled_on_localhost(empty_database: Database) -> None:
    apply_migrations(empty_database.url, migrations_dir())
    hidden = _client(empty_database, preview=False, base_url="http://localhost")
    assert hidden.get("/auth/preview").status_code == 404
    remote = _client(empty_database, preview=True, base_url="http://testserver", peer=REMOTE)
    assert remote.get("/auth/preview").status_code == 404


def test_a_remote_caller_naming_localhost_is_not_offered_the_preview(
    empty_database: Database,
) -> None:
    apply_migrations(empty_database.url, migrations_dir())
    spoofed = _client(empty_database, preview=True, base_url="http://localhost", peer=REMOTE)
    assert spoofed.get("/auth/preview", follow_redirects=False).status_code == 404
    assert spoofed.get("/auth/providers").json()["preview"] is False
    # Nor through a header of its own naming a loopback address.
    forged = spoofed.get(
        "/auth/preview", headers={"x-forwarded-for": "127.0.0.1"}, follow_redirects=False
    )
    assert forged.status_code == 404
    assert "aw_session" not in spoofed.cookies
    local = _client(empty_database, preview=True, base_url="http://localhost")
    assert local.get("/auth/providers").json()["preview"] is True


def test_preview_opens_a_local_workspace(empty_database: Database) -> None:
    apply_migrations(empty_database.url, migrations_dir())
    client = _client(empty_database, preview=True, base_url="http://localhost")
    response = client.get("/auth/preview", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "http://localhost:3000"
    organizations = client.get("/organizations")
    assert organizations.status_code == 200
    body = organizations.json()
    assert body[0]["name"] == "Preview workspace"
    assert body[0]["role"] == "OWNER"
    projects = client.get(f"/organizations/{body[0]['id']}/projects")
    assert projects.status_code == 200
    assert projects.json()[0]["slug"] == "sox-2026"


def test_preview_returns_to_the_page_asked_for_and_never_off_the_app(
    empty_database: Database,
) -> None:
    """Signing in from a deep link (19 November 2026): the preview lands on that workspace
    address; an address that could leave the app lands on the workspace home instead."""
    apply_migrations(empty_database.url, migrations_dir())
    client = _client(empty_database, preview=True, base_url="http://localhost")
    deep = "/?organization=0b7f&section=controls"
    response = client.get("/auth/preview", params={"next": deep}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == f"http://localhost:3000{deep}"
    for unsafe in ("//evil.example/", "https://evil.example/", "/\\evil.example", "/welcome"):
        refused = client.get("/auth/preview", params={"next": unsafe}, follow_redirects=False)
        assert refused.headers["location"] == "http://localhost:3000"
