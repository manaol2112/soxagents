"""Owner assignment (Release 2b-2): drafts addressed to no one get a suggested owner from
the engagement's own records, with its source; a person confirms many at once or picks
someone else; nothing is invented, and a request with no owner stays unsendable."""

from typing import Any
from uuid import uuid4

from support import Database
from test_evidence_center import _all, _ready
from test_evidence_flow import _project
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _drafts(client: Any, team: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {(row["control_ref"], row["phase"]): row for row in _all(client, team)}


def _assign(client: Any, team: dict[str, Any], row: dict[str, Any], recipient: str) -> None:
    body = {
        "version": row["version"], "recipient": recipient, "cc": [],
        "due_on": row["due_at"][:10], "priority": row["priority"],
    }  # fmt: skip
    changed = client.post(f"{_project(team)}/pbc-requests/{row['id']}/assignment", json=body)
    assert changed.status_code == 200, changed.text


def _unaddress(migrated: Database, team: dict[str, Any], rows: list[dict[str, Any]],
               owners: list[str]) -> None:  # fmt: skip
    """As drafted for a control with no owner on record and no evidence coordinator."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET recipient = '', version = version + 1 "
            "WHERE id = ANY(%s::uuid[])",
            ([row["id"] for row in rows],),
        )
        connection.execute(
            "UPDATE engagement_controls SET owner_email = '', owner_name = '' "
            "WHERE project_id = %s AND control_ref = ANY(%s)",
            (team["project"], owners),
        )


def test_owners_are_suggested_from_records_confirmed_in_bulk_and_never_invented(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eo-suggest")
    owner = team["owner"]
    base = _project(team)
    drafts = _drafts(owner, team)
    # A person confirms who the change requests for CM-02 go to; and names the owner of
    # AC-05 in the engagement contacts.
    _assign(owner, team, drafts[("ITGC-CM-02", "INTERIM")], "maria.chen@client.example")
    added = owner.post(
        f"{base}/engagement-contacts",
        json={"name": "Dana Reyes", "email": "dana.reyes@client.example",
              "role": "Owner of ITGC-AC-05"},
    )  # fmt: skip
    assert added.status_code in (200, 201), added.text
    drafts = _drafts(owner, team)
    blank = {
        "owner": drafts[("ITGC-AC-03", "DESIGN")],  # its control's owner is on record
        "control": drafts[("ITGC-CM-02", "DESIGN")],  # its interim request is confirmed
        "contact": drafts[("ITGC-AC-05", "DESIGN")],  # named in the contacts
        "system": drafts[("ITGC-CM-04", "DESIGN")],  # one person has the change requests
        "none": drafts[("ITGC-AC-06", "DESIGN")],  # nothing reliable
        # Personal data (HR leaver and transfer listings), owner on record.
        "leavers": drafts[("ITGC-AC-02", "DESIGN")],
        "transfers": drafts[("ITGC-AC-07", "DESIGN")],
    }
    _unaddress(migrated, team, list(blank.values()),
               ["ITGC-CM-02", "ITGC-AC-05", "ITGC-CM-04", "ITGC-AC-06"])  # fmt: skip

    read = owner.get(f"{base}/evidence-owners")
    assert read.status_code == 200, read.text
    body = read.json()
    found = {item["id"]: item for item in body["items"]}
    assert set(found) == {row["id"] for row in blank.values()}
    said = {key: found[row["id"]]["suggestion"] for key, row in blank.items()}
    assert (said["owner"]["source"], said["owner"]["email"]) == (
        "CONTROL_OWNER", "iam@client.example",
    )  # fmt: skip
    assert said["owner"]["label"] == "Control owner in the RCM"
    assert (said["control"]["source"], said["control"]["email"]) == (
        "SAME_CONTROL", "maria.chen@client.example",
    )  # fmt: skip
    assert (said["contact"]["source"], said["contact"]["email"], said["contact"]["name"]) == (
        "CONTACT", "dana.reyes@client.example", "Dana Reyes",
    )  # fmt: skip
    assert (said["system"]["source"], said["system"]["email"]) == (
        "SAME_SYSTEM", "maria.chen@client.example",
    )  # fmt: skip
    assert said["system"]["label"] == "Receives the change management requests for SAP ERP"
    # No name is made up from an address: only a name a record holds.
    assert said["control"]["name"] == ""
    # Nothing reliable, nothing suggested; every suggestion is someone on record.
    assert said["none"] is None
    known = {person["email"] for person in body["contacts"]}
    assert {s["email"] for s in said.values() if s} <= known
    assert body["domains"]

    # Unresolved stays unsendable: it travels in no request and cannot be approved.
    grouped = [g for g in _all(owner, team, grouped=1) if g["group"]]
    assert all(blank["none"]["id"] not in g["member_ids"] for g in grouped)
    version = next(i["version"] for i in body["items"] if i["id"] == blank["none"]["id"])
    approve = owner.post(
        f"{base}/evidence-requests/bulk",
        json={"action": "APPROVE_SEND", "preview": True,
              "items": [{"id": blank["none"]["id"], "version": version}]},
    )  # fmt: skip
    assert approve.json()["outcomes"][0] == {
        **approve.json()["outcomes"][0], "ok": False, "detail": "Assign a recipient.",
    }  # fmt: skip

    # Bulk confirmation with an individual override; an address outside the client's
    # domains and a stale version are refused on their own; the rest go through.
    current = {item["id"]: item["version"] for item in body["items"]}
    items = [
        {"id": blank["owner"]["id"], "version": current[blank["owner"]["id"]],
         "recipient": "dana.reyes@client.example"},  # overridden
        {"id": blank["control"]["id"], "version": current[blank["control"]["id"]],
         "recipient": said["control"]["email"]},
        {"id": blank["contact"]["id"], "version": current[blank["contact"]["id"]],
         "recipient": said["contact"]["email"]},
        {"id": blank["system"]["id"], "version": current[blank["system"]["id"]] - 1,
         "recipient": said["system"]["email"]},  # stale
        {"id": blank["none"]["id"], "version": current[blank["none"]["id"]],
         "recipient": "someone@elsewhere.example"},  # outside the client's domains
        {"id": blank["leavers"]["id"], "version": current[blank["leavers"]["id"]],
         "recipient": "dana.reyes@client.example"},  # overridden
        {"id": blank["transfers"]["id"], "version": current[blank["transfers"]["id"]],
         "recipient": "dana.reyes@client.example"},  # overridden
    ]  # fmt: skip
    done = owner.post(f"{base}/evidence-owners/assign", json={"items": items})
    assert done.status_code == 200, done.text
    result = done.json()
    outcome = {item["id"]: item for item in result["outcomes"]}
    assert (result["done"], result["refused"]) == (5, 2)
    assert "changed" in outcome[blank["system"]["id"]]["detail"]
    assert "outside the client's email domains" in outcome[blank["none"]["id"]]["detail"]
    after = {row["id"]: row for row in _all(owner, team)}
    assert after[blank["owner"]["id"]]["recipient"] == "dana.reyes@client.example"
    assert after[blank["control"]["id"]]["recipient"] == "maria.chen@client.example"
    assert after[blank["none"]["id"]]["recipient"] == ""
    # Copies, due date, and priority stay; each change is the person's, in the audit trail.
    for key in ("owner", "control", "contact"):
        assert after[blank[key]["id"]]["due_at"] == blank[key]["due_at"]
        assert after[blank[key]["id"]]["priority"] == blank[key]["priority"]
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'pbc.assignment_changed' "
            "AND actor_user_id = %s AND target_id = ANY(%s::uuid[])",
            (team["owner_id"], [blank[k]["id"] for k in
                                ("owner", "control", "contact", "leavers", "transfers")]),
        ).fetchone()  # fmt: skip
    assert audited is not None and audited[0] == 5
    # Assigned, they travel with that person's other requests for the phase; personal data
    # still travels on its own, even to the same person.
    together = [
        g for g in _all(owner, team, grouped=1)
        if g["group"] and g["recipient"] == "dana.reyes@client.example"
    ]  # fmt: skip
    assert sorted(sorted(g["member_ids"]) for g in together) == sorted([
        sorted([blank["owner"]["id"], blank["contact"]["id"]]),
        sorted([blank["leavers"]["id"], blank["transfers"]["id"]]),
    ])  # fmt: skip
    flags = {
        frozenset(g["member_ids"]): owner.get(f"{base}/evidence-groups/{g['id']}").json()[
            "personal_data"
        ]
        for g in together
    }
    assert flags == {
        frozenset([blank["owner"]["id"], blank["contact"]["id"]]): False,
        frozenset([blank["leavers"]["id"], blank["transfers"]["id"]]): True,
    }
    assert len(owner.get(f"{base}/evidence-owners").json()["items"]) == 2
    # Assigning again is refused: it already has an owner.
    again = owner.post(f"{base}/evidence-owners/assign", json={"items": items[1:2]})
    assert again.json()["outcomes"][0]["detail"] == "This request already has an owner."


def test_only_the_engagement_team_reads_or_assigns_owners(migrated: Database) -> None:
    team = _ready(migrated, "eo-access")
    outsider = _ready(migrated, "eo-outsider")["owner"]
    base = _project(team)
    assert outsider.get(f"{base}/evidence-owners").status_code in (403, 404)
    refused = outsider.post(
        f"{base}/evidence-owners/assign",
        json={"items": [{"id": str(uuid4()), "version": 1, "recipient": "a@client.example"}]},
    )
    assert refused.status_code in (403, 404)
    assert team["owner"].get(f"{base}/evidence-owners").json()["items"] == []
