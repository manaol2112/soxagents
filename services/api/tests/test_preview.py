from fastapi.testclient import TestClient
from support import Database

from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.settings import Settings


def _client(database: Database, *, preview: bool, base_url: str) -> TestClient:
    app = create_app(
        Settings(
            database_url=database.url,
            preview_login_enabled=preview,
            app_base_url="http://localhost:3000",
            session_cookie_secure=False,
        )
    )
    return TestClient(app, base_url=base_url)


def test_preview_is_hidden_unless_enabled_on_localhost(empty_database: Database) -> None:
    apply_migrations(empty_database.url, migrations_dir())
    hidden = _client(empty_database, preview=False, base_url="http://localhost")
    assert hidden.get("/auth/preview").status_code == 404
    remote = _client(empty_database, preview=True, base_url="http://testserver")
    assert remote.get("/auth/preview").status_code == 404


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
