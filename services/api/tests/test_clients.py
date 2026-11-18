"""Clients (Milestone 8.18): a firm's clients, an engagement for an existing client in a few
steps, and a roll-forward of an earlier engagement's setup."""

from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from support import Database
from test_access import _seed_org
from test_engagement_close import _launched
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _pbc
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.migrate import apply_migrations, migrations_dir

__all__ = ["migrated"]


def _create(owner: TestClient, team: dict[str, Any], **fields: Any) -> Any:
    return owner.post(
        f"/organizations/{team['org']}/projects",
        json={
            "name": fields.pop("name", "SOX FY28"),
            "slug": f"fy28-{uuid4().hex[:8]}",
            "scope": "",
            "owner_user_id": str(team["owner_id"]),
            "status": "DRAFT",
            **fields,
        },
    )


def _clients(owner: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    listed = owner.get(f"/organizations/{team['org']}/clients")
    assert listed.status_code == 200, listed.text
    return list(listed.json())


def test_existing_client_names_become_clients(empty_database: Database, tmp_path: Path) -> None:
    for path in sorted(migrations_dir().glob("*.sql")):
        if path.name < "0070":
            (tmp_path / path.name).write_bytes(path.read_bytes())
    apply_migrations(empty_database.url, tmp_path)
    with connect(empty_database.url) as connection:
        seeded = _seed_org(connection, "firm", "owner@firm.example")
        names = ["Eladriel Corp", "  eladriel   corp ", "Rosa Corp", ""]
        projects = []
        for index, name in enumerate(names):
            row = connection.execute(
                "INSERT INTO projects (organization_id, name, slug, owner_user_id) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (seeded["organization_id"], f"E{index}", f"e{index}", seeded["user_id"]),
            ).fetchone()
            assert row is not None
            projects.append(row[0])
            connection.execute(
                "UPDATE engagement_settings SET client_name = %s WHERE project_id = %s",
                (name, row[0]),
            )
        connection.commit()
    (tmp_path / "0070_clients.sql").write_bytes(
        (migrations_dir() / "0070_clients.sql").read_bytes()
    )
    assert apply_migrations(empty_database.url, tmp_path) == ["0070_clients"]
    with connect(empty_database.url) as connection:
        clients = connection.execute("SELECT name FROM clients ORDER BY name").fetchall()
        linked = connection.execute(
            "SELECT s.client_name, c.name FROM engagement_settings s "
            "LEFT JOIN clients c ON c.id = s.client_id ORDER BY s.project_id"
        ).fetchall()
    # One client per name, case and spacing aside, in the first engagement's spelling.
    assert [row[0] for row in clients] == ["Eladriel Corp", "Rosa Corp"]
    assert linked == [
        ("Eladriel Corp", "Eladriel Corp"),
        ("Eladriel Corp", "Eladriel Corp"),
        ("Rosa Corp", "Rosa Corp"),
        ("", None),
    ]


def test_an_engagement_is_added_for_an_existing_client(migrated: Database) -> None:
    team = _launched(migrated, "client-repeat")
    owner, org = team["owner"], team["org"]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_id = NULL WHERE project_id = %s",
            (team["project"],),
        )
        connection.commit()
    made = _create(owner, team, name="SOX FY27", client_name="Acme Corp")
    assert made.status_code == 201, made.text
    clients = _clients(owner, team)
    acme = next(c for c in clients if c["name"] == "Acme Corp")
    # The same name in another case is the same client, not a second one.
    again = _create(owner, team, client_name="ACME corp")
    assert again.status_code == 201, again.text
    acme = next(c for c in _clients(owner, team) if c["id"] == acme["id"])
    assert len(acme["engagements"]) == 2
    assert sum(1 for c in _clients(owner, team) if c["name"].lower() == "acme corp") == 1
    # Picked by id, a new engagement takes the client's details from its latest one.
    latest = acme["engagements"][0]["id"]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_domains = %s, client_coordinator_name = %s, "
            "client_coordinator_email = %s, pbc_due_days = 14 WHERE project_id = %s",
            (["acme.example"], "Pat Coordinator", "pbc@acme.example", latest),
        )
        connection.commit()
    picked = _create(owner, team, client_id=acme["id"])
    assert picked.status_code == 201, picked.text
    body = owner.get(_base(org, picked.json()["id"])).json()
    settings = body["settings"]
    assert settings["client_name"] == "Acme Corp"
    assert settings["client_domains"] == ["acme.example"]
    assert settings["client_coordinator_email"] == "pbc@acme.example"
    assert settings["pbc_due_days"] == 14
    # A client of another firm, or none at all, is not offered.
    stranger = _launched(migrated, "client-stranger")
    assert _create(stranger["owner"], stranger, client_id=acme["id"]).status_code == 404


def test_a_new_engagement_rolls_forward_an_earlier_one(migrated: Database) -> None:
    team = _launched(migrated, "rollforward")
    owner, org, source = team["owner"], team["org"], team["project"]
    setup = _base(org, source)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_id = NULL WHERE project_id = %s", (source,)
        )
        connection.commit()
    created = owner.post(f"/organizations/{org}/clients", json={"name": "Globex"})
    assert created.status_code == 201, created.text
    globex = created.json()
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_id = %s WHERE project_id = %s",
            (globex["id"], source),
        )
        connection.execute(
            "UPDATE projects SET scope = 'ITGCs over SAP ERP for FY2027.' WHERE id = %s",
            (source,),
        )
        connection.commit()
    before = owner.get(setup).json()
    assert before["settings"]["templates_confirmed_at"] is not None
    made = _create(owner, team, name="SOX FY28", client_id=globex["id"],
                   rollforward_from=str(source))  # fmt: skip
    assert made.status_code == 201, made.text
    target = made.json()["id"]
    after = owner.get(_base(org, target)).json()
    # Its setup comes along: systems, controls with their owners and attributes, the team.
    assert [a["name"] for a in after["applications"]] == [a["name"] for a in before["applications"]]
    assert len(after["controls"]) == len(before["controls"]) > 0
    old = {c["control_ref"]: c for c in before["controls"]}
    for control in after["controls"]:
        was = old[control["control_ref"]]
        assert (control["owner_email"], control["frequency"], control["included"]) == (
            was["owner_email"], was["frequency"], was["included"],
        )  # fmt: skip
        assert control["test_attributes"] == was["test_attributes"]
        assert control["id"] != was["id"]
    assert {m["user_id"] for m in after["team"]} >= {m["user_id"] for m in before["team"]}
    assert after["settings"]["client_coordinator_email"] == _pbc()["client_coordinator_email"]
    # The scope to start from, and the templates confirmed as they were, by whoever rolled
    # it forward.
    assert owner.get(f"/organizations/{org}/projects/{target}").json()["scope"] == (
        "ITGCs over SAP ERP for FY2027."
    )
    assert after["settings"]["templates_confirmed_at"] is not None
    with connect(migrated.url) as connection:
        by = connection.execute(
            "SELECT templates_confirmed_by FROM engagement_settings WHERE project_id = %s",
            (target,),
        ).fetchone()
    assert by is not None and by[0] == team["owner_id"]
    # Nothing done for the earlier period comes along: it is an unlaunched draft.
    assert after["started"] is False and after["plan"] is None
    with connect(migrated.url) as connection:
        counts = connection.execute(
            """
            SELECT (SELECT count(*) FROM tasks WHERE project_id = %s),
                   (SELECT count(*) FROM pbc_requests WHERE project_id = %s),
                   (SELECT count(*) FROM control_attributes WHERE project_id = %s
                    AND status = 'APPROVED')
            """,
            (target, target, target),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'project.rolled_forward'",
            (target,),
        ).fetchone()
    assert counts is not None and counts[0] == 0 and counts[1] == 0 and counts[2] > 0
    assert audit is not None and audit[0]["controls"] == len(after["controls"])
    assert audit[0]["scope"] == 1 and audit[0]["templates_confirmed"] == 1
    # Only the same client's engagement rolls forward.
    other = owner.post(f"/organizations/{org}/clients", json={"name": "Initech"}).json()
    wrong = _create(owner, team, client_id=other["id"], rollforward_from=str(source))
    assert wrong.status_code == 422


def test_a_client_is_renamed_on_every_engagement_by_an_owner(migrated: Database) -> None:
    team = _launched(migrated, "client-rename")
    owner, org = team["owner"], team["org"]
    first = _create(owner, team, client_name="Umbrella")
    second = _create(owner, team, client_name="umbrella")
    assert first.status_code == 201 and second.status_code == 201
    umbrella = next(c for c in _clients(owner, team) if c["name"] == "Umbrella")
    with connect(migrated.url) as connection:
        manager_id = _add_user(connection, org, f"pm-{uuid4().hex[:6]}@x.test", "PROJECT_MANAGER")
        _add_project_member(connection, org, team["project"], manager_id)
    manager = _session(migrated, manager_id)
    path = f"/organizations/{org}/clients/{umbrella['id']}"
    body = {"name": "Umbrella Corp", "version": umbrella["version"]}
    assert manager.patch(path, json=body).status_code == 403
    renamed = owner.patch(path, json=body)
    assert renamed.status_code == 200, renamed.text
    for made in (first, second):
        assert owner.get(_base(org, made.json()["id"])).json()["settings"]["client_name"] == (
            "Umbrella Corp"
        )
    owner.post(f"/organizations/{org}/clients", json={"name": "Hooli"})
    clash = owner.patch(path, json={"name": "HOOLI", "version": renamed.json()["version"]})
    assert clash.status_code == 409
    assert (
        owner.post(f"/organizations/{org}/clients", json={"name": "umbrella corp"}).status_code
        == 409
    )
    # The database keeps an engagement's copy of the name equal to its client's.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_name = 'Something else' WHERE project_id = %s",
            (first.json()["id"],),
        )
        kept = connection.execute(
            "SELECT client_name FROM engagement_settings WHERE project_id = %s",
            (first.json()["id"],),
        ).fetchone()
    assert kept == ("Umbrella Corp",)


def test_after_launch_the_client_is_the_same_however_it_is_written(migrated: Database) -> None:
    team = _launched(migrated, "client-locked")
    owner, project = team["owner"], f"/organizations/{team['org']}/projects/{team['project']}"
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO clients (organization_id, name) VALUES (%s, 'Wayne') "
            "ON CONFLICT DO NOTHING",
            (team["org"],),
        )
        connection.execute(
            "UPDATE engagement_settings SET client_id = (SELECT id FROM clients "
            "WHERE organization_id = %s AND name = 'Wayne') WHERE project_id = %s",
            (team["org"], team["project"]),
        )
        connection.commit()
    detail = owner.get(project).json()
    form = {
        "version": detail["version"], "name": detail["name"],
        "owner_user_id": detail["owner_user_id"], "period_end": detail["period_end"],
        "starts_on": None, "ends_on": None,
    }  # fmt: skip
    same = owner.patch(f"{project}/details", json={**form, "client_name": "WAYNE"})
    assert same.status_code == 200, same.text
    detail = owner.get(project).json()
    other = owner.patch(
        f"{project}/details",
        json={**form, "version": detail["version"], "client_name": "Someone Else"},
    )
    assert other.status_code == 409
