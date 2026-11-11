"""A control's RCM details, completed on its own system from step 01 of its workflow (product
owner, 10 November 2026: "says start here but there are no actual section where I can put my
answers"; decided: the detail applies to this system's control, and the same control on other
systems is offered it where empty, never overwritten)."""

from typing import Any

from support import Database
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_understanding_chat import _control_path, _two_systems

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _details(client: Any, team: dict[str, Any], control: str) -> dict[str, Any]:
    read = client.get(f"{_control_path(team, control)}/details")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _clear_owner(database: Database, *controls: str) -> None:
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET owner_name = '', owner_email = '' WHERE id = ANY(%s)",
            (list(controls),),
        )
        connection.commit()


def test_a_missing_owner_is_recorded_on_this_system_only(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-own")
    owner = team["owner"]
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    _clear_owner(migrated, sap, oracle)
    before = _details(owner, team, sap)
    assert before["owner_name"] == "" and before["can_edit"] is True
    # Nothing to copy yet: this system holds no owner either.
    assert [t["fills"] for t in before["targets"]] == [[]]
    # It is offered where the other system lacks the detail too.
    assert [t["lacks"] for t in before["targets"]] == [["owner"]]

    saved = owner.put(
        f"{_control_path(team, sap)}/details",
        json={
            "version": before["version"],
            "owner_name": "Access Owner",
            "owner_email": "Access.Owner@Client.example",
        },
    )
    assert saved.status_code == 200, saved.text
    after = saved.json()
    assert after["owner_name"] == "Access Owner"
    assert after["owner_email"] == "access.owner@client.example"
    assert after["version"] == before["version"] + 1
    # Oracle EBS's control is untouched, and is now offered the owner.
    assert _details(owner, team, oracle)["owner_name"] == ""
    assert after["targets"] == [
        {"control_id": oracle, "system": "Oracle EBS", "fills": ["owner"], "lacks": ["owner"]}
    ]
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'control.details_set' "
            "AND target_id = %s",
            (sap,),
        ).fetchone()
    assert audit is not None and audit[0] == {"fields": ["owner"]}


def test_a_copy_fills_only_an_empty_detail_and_never_overwrites(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-copy")
    owner = team["owner"]
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    _clear_owner(migrated, sap, oracle)
    version = _details(owner, team, sap)["version"]
    copied = owner.put(
        f"{_control_path(team, sap)}/details",
        json={
            "version": version,
            "owner_name": "Access Owner",
            "owner_email": "access.owner@client.example",
            "copy_to": [oracle],
        },
    )
    assert copied.status_code == 200, copied.text
    assert _details(owner, team, oracle)["owner_name"] == "Access Owner"
    assert copied.json()["targets"][0]["fills"] == []

    # Oracle's own owner is changed on Oracle; a later copy from SAP keeps it.
    oracle_version = _details(owner, team, oracle)["version"]
    assert (
        owner.put(
            f"{_control_path(team, oracle)}/details",
            json={"version": oracle_version, "owner_name": "Oracle Owner"},
        ).status_code
        == 200
    )
    sap_version = _details(owner, team, sap)["version"]
    again = owner.put(
        f"{_control_path(team, sap)}/details",
        json={"version": sap_version, "owner_name": "Someone Else", "copy_to": [oracle]},
    )
    assert again.status_code == 200, again.text
    assert _details(owner, team, oracle)["owner_name"] == "Oracle Owner"
    assert _details(owner, team, sap)["owner_name"] == "Someone Else"


def test_details_are_checked_and_a_stale_version_is_refused(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-check")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    path = f"{_control_path(team, sap)}/details"
    version = _details(owner, team, sap)["version"]

    def put(body: dict[str, Any]) -> int:
        status: int = owner.put(path, json={"version": version, **body}).status_code
        return status

    assert put({"frequency": "SOMETIMES"}) == 422
    assert put({"nature": "MAGIC"}) == 422
    assert put({"owner_email": "not-an-email"}) == 422
    assert put({"owner_name": "password=Hunter2Hunter2"}) == 422
    assert put({}) == 422
    # Only the same control on another system of this engagement takes a copy.
    assert put({"owner_name": "A", "copy_to": [sap]}) == 409
    assert put({"frequency": "MONTHLY"}) == 200
    assert _details(owner, team, sap)["frequency"] == "MONTHLY"
    # The version read before that save is stale now.
    assert put({"nature": "AUTOMATED"}) == 409


def test_only_who_may_change_the_setup_records_details(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-perm")
    sap = team["ac01"]["SAP ERP"]
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "cd-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    contributor = _session(migrated, member)
    seen = _details(contributor, team, sap)
    assert seen["can_edit"] is False
    refused = contributor.put(
        f"{_control_path(team, sap)}/details",
        json={"version": seen["version"], "owner_name": "Anyone"},
    )
    assert refused.status_code in (403, 404)
    assert _details(team["owner"], team, sap)["owner_name"] != "Anyone"
