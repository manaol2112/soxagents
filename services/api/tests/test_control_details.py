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


# The owner across one system (product owner, 11 November 2026: "All controls require me to
# input the process owner. Most of the time it's the same for one system unless the user
# wanted to change it.")


def _system_controls(database: Database, control: str) -> list[str]:
    """The engagement's other in-scope controls on this control's system, in order."""
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT c.id::text FROM engagement_controls c
            JOIN engagement_controls me ON me.id = %s
            WHERE c.project_id = me.project_id
              AND c.engagement_application_id = me.engagement_application_id
              AND c.id <> me.id AND c.included
            ORDER BY c.control_ref, c.id
            """,
            (control,),
        ).fetchall()
    return [str(row[0]) for row in rows]


def _no_owners(database: Database, project: str) -> None:
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET owner_name = '', owner_email = '' "
            "WHERE project_id = %s",
            (project,),
        )
        connection.commit()


def _owner(database: Database, control: str, name: str, email: str, minutes_ago: int = 0) -> None:
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET owner_name = %s, owner_email = %s, "
            "updated_at = clock_timestamp() - make_interval(mins => %s) WHERE id = %s",
            (name, email, minutes_ago, control),
        )
        connection.commit()


def _owners(database: Database, *controls: str) -> list[tuple[str, str]]:
    with connect(database.url) as connection:
        found = {
            str(row[0]): (str(row[1] or ""), str(row[2] or ""))
            for row in connection.execute(
                "SELECT id::text, owner_name, owner_email FROM engagement_controls "
                "WHERE id = ANY(%s::uuid[])",
                (list(controls),),
            ).fetchall()
        }
    return [found[control] for control in controls]


def test_the_owner_most_used_on_the_system_is_suggested(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-suggest")
    owner = team["owner"]
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    _no_owners(migrated, team["project"])
    others = _system_controls(migrated, sap)
    assert len(others) >= 6, others
    # No other control on SAP ERP records an owner: nothing to suggest.
    assert _details(owner, team, sap)["owner_suggestion"] is None

    # Owners on another system and on another engagement are not this system's.
    for control in _system_controls(migrated, oracle):
        _owner(migrated, control, "Oracle Owner", "oracle.owner@client.example")
    elsewhere = _two_systems(migrated, "cd-suggest-other")
    for control in _system_controls(migrated, elsewhere["ac01"]["SAP ERP"]):
        _owner(migrated, control, "Elsewhere Owner", "elsewhere@client.example")
    assert _details(owner, team, sap)["owner_suggestion"] is None

    # A tie goes to the owner recorded most recently.
    _owner(migrated, others[0], "Older Owner", "older@client.example", minutes_ago=30)
    _owner(migrated, others[1], "Newer Owner", "newer@client.example", minutes_ago=5)
    assert _details(owner, team, sap)["owner_suggestion"] == {
        "name": "Newer Owner", "email": "newer@client.example", "controls": 1,
    }  # fmt: skip

    # The most used wins; an out-of-scope control's owner is not counted.
    _owner(migrated, others[2], "Older Owner", "older@client.example", minutes_ago=40)
    assert _details(owner, team, sap)["owner_suggestion"] == {
        "name": "Older Owner", "email": "older@client.example", "controls": 2,
    }  # fmt: skip
    for control in others[3:6]:
        _owner(migrated, control, "Out Of Scope", "out@client.example")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = ANY(%s::uuid[])",
            (others[3:6],),
        )
        connection.commit()
    assert _details(owner, team, sap)["owner_suggestion"]["name"] == "Older Owner"

    # A control that records its own owner is suggested none.
    _owner(migrated, sap, "Own Owner", "own@client.example")
    assert _details(owner, team, sap)["owner_suggestion"] is None


def test_the_owner_applies_to_the_system_only_where_empty(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-apply")
    owner = team["owner"]
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    _no_owners(migrated, team["project"])
    others = _system_controls(migrated, sap)
    oracle_others = _system_controls(migrated, oracle)
    kept, email_only, out_of_scope = others[0], others[1], others[2]
    empty = others[3:]
    _owner(migrated, kept, "Kept Owner", "kept@client.example")
    _owner(migrated, email_only, "", "only.email@client.example")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = %s", (out_of_scope,)
        )
        connection.commit()
    path = f"{_control_path(team, sap)}/details"

    # Applying needs the owner in the save.
    version = _details(owner, team, sap)["version"]
    assert (
        owner.put(
            path, json={"version": version, "frequency": "MONTHLY", "apply_to_system": True}
        ).status_code
        == 422
    )

    saved = owner.put(
        path,
        json={
            "version": version,
            "owner_name": "System Owner",
            "owner_email": "System.Owner@Client.example",
            "apply_to_system": True,
            "copy_to": [oracle],
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["applied_to"], body["copied_to"]) == (len(empty), 1)
    assert body["owner_suggestion"] is None
    system_owner = ("System Owner", "system.owner@client.example")
    assert _owners(migrated, sap, *empty) == [system_owner] * (len(empty) + 1)
    # A recorded owner, even an email alone, is never overwritten; out of scope is skipped.
    assert _owners(migrated, kept, email_only, out_of_scope) == [
        ("Kept Owner", "kept@client.example"),
        ("", "only.email@client.example"),
        ("", ""),
    ]
    # The copy reached the same control on Oracle EBS, and nothing else there.
    assert _owners(migrated, oracle) == [system_owner]
    assert _owners(migrated, *oracle_others) == [("", "")] * len(oracle_others)
    with connect(migrated.url) as connection:
        audits = connection.execute(
            "SELECT target_id::text, payload FROM audit_events "
            "WHERE action = 'control.details_applied' AND project_id = %s",
            (team["project"],),
        ).fetchall()
        application = connection.execute(
            "SELECT engagement_application_id::text FROM engagement_controls WHERE id = %s",
            (sap,),
        ).fetchone()
    assert sorted(str(row[0]) for row in audits) == sorted(empty)
    assert application is not None
    assert all(
        row[1]
        == {
            "source_control_id": sap,
            "engagement_application_id": application[0],
            "fields": ["owner"],
        }
        for row in audits
    )


def test_a_save_without_apply_changes_only_this_control(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-noapply")
    owner = team["owner"]
    sap = team["ac01"]["SAP ERP"]
    _no_owners(migrated, team["project"])
    others = _system_controls(migrated, sap)
    saved = owner.put(
        f"{_control_path(team, sap)}/details",
        json={
            "version": _details(owner, team, sap)["version"],
            "owner_name": "Only Here",
            "owner_email": "only.here@client.example",
        },
    )
    assert saved.status_code == 200, saved.text
    assert (saved.json()["applied_to"], saved.json()["copied_to"]) == (0, 0)
    assert _owners(migrated, *others) == [("", "")] * len(others)
    # The other controls on the system are now suggested this owner.
    assert _details(owner, team, others[0])["owner_suggestion"] == {
        "name": "Only Here", "email": "only.here@client.example", "controls": 1,
    }  # fmt: skip


def test_only_who_may_change_the_setup_applies_an_owner(migrated: Database) -> None:
    team = _two_systems(migrated, "cd-apply-perm")
    sap = team["ac01"]["SAP ERP"]
    _no_owners(migrated, team["project"])
    others = _system_controls(migrated, sap)
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "cd-apply-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    contributor = _session(migrated, member)
    refused = contributor.put(
        f"{_control_path(team, sap)}/details",
        json={
            "version": _details(contributor, team, sap)["version"],
            "owner_name": "Anyone",
            "apply_to_system": True,
        },
    )
    assert refused.status_code in (403, 404)
    assert _owners(migrated, sap, *others) == [("", "")] * (len(others) + 1)
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'control.details_applied' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchone()
    assert audited is not None and audited[0] == 0
