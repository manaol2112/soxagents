"""The last workspace page each person opened (migration 0124; decided by the product owner
on 28 October 2026): kept on the account, offered back only while it can still be opened."""

from uuid import UUID

from support import Database
from test_onboarding import _new_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def test_a_person_returns_to_the_last_page_they_opened(migrated: Database) -> None:
    team = _new_engagement(migrated, "last-page")
    owner, org, project = team["owner"], team["org"], team["project"]
    assert owner.get("/me/last-page").status_code == 404
    first = f"/?organization={org}&section=controls"
    assert owner.put("/me/last-page", json={"path": first}).status_code == 204
    later = f"/?organization={org}&project={project}&section=register&for=system:abc"
    assert owner.put("/me/last-page", json={"path": later}).status_code == 204
    found = owner.get("/me/last-page")
    assert found.status_code == 200, found.text
    body = found.json()
    # One page each: the latest.
    assert body["path"] == later
    assert (body["organization_id"], body["project_id"]) == (str(org), str(project))


def test_only_a_workspace_page_the_person_may_open_is_kept(migrated: Database) -> None:
    team = _new_engagement(migrated, "last-page-own")
    other = _new_engagement(migrated, "last-page-other")
    owner, org = team["owner"], team["org"]
    # Another firm's page is not theirs to keep.
    foreign = f"/?organization={other['org']}&section=overview"
    assert owner.put("/me/last-page", json={"path": foreign}).status_code == 404
    # Nor another engagement's, inside a firm they are not in.
    mixed = f"/?organization={org}&project={other['project']}"
    assert owner.put("/me/last-page", json={"path": mixed}).status_code == 404
    for path in (
        "https://example.com/?organization=" + str(org),
        "//evil.example/?organization=" + str(org),
        "/welcome?organization=" + str(org),
        "/?section=overview",
        "/?organization=not-a-uuid",
        f"/?organization={org}&organization={other['org']}",
    ):
        refused = owner.put("/me/last-page", json={"path": path})
        assert refused.status_code == 422, (path, refused.status_code)
    assert owner.get("/me/last-page").status_code == 404


def test_a_page_in_a_firm_left_since_is_not_offered(migrated: Database) -> None:
    team = _new_engagement(migrated, "last-page-left")
    owner, org = team["owner"], team["org"]
    path = f"/?organization={org}&section=overview"
    assert owner.put("/me/last-page", json={"path": path}).status_code == 204
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE memberships SET status = 'DISABLED' "
            "WHERE organization_id = %s AND user_id = %s",
            (UUID(str(org)), team["owner_id"]),
        )
        connection.commit()
    assert owner.get("/me/last-page").status_code == 404


def test_a_visitor_without_a_session_has_no_last_page(migrated: Database) -> None:
    from fastapi.testclient import TestClient

    from ai_workforce_api.main import create_app
    from ai_workforce_api.settings import Settings

    anonymous = TestClient(create_app(Settings(database_url=migrated.url)))
    assert anonymous.get("/me/last-page").status_code == 401
    assert anonymous.put("/me/last-page", json={"path": "/?organization=x"}).status_code == 401
