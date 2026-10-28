"""The process narrative drafted from the client-specific walkthrough (decided by the product
owner on 26 October 2026): the process agent writes the narrative and its steps from the
client's answers, each step names the control's attributes evaluated at it (only codes the
control has), and every version is kept: each build, proposal, save, adoption and approval.
"""

from typing import Any
from uuid import UUID

from support import Database
from test_control_context import _context, _control, _new_control
from test_evidence_analysis import _Provider
from test_evidence_intake import _engagement
from test_outbound import migrated
from test_testing_engine import _base

from ai_workforce_api.context_routes import _build
from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _codes(migrated: Database, control_id: str) -> list[str]:
    with connect(migrated.url) as connection:
        return [
            str(row[0])
            for row in connection.execute(
                "SELECT code FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' AND code IS NOT NULL ORDER BY position, created_at",
                (control_id,),
            ).fetchall()
        ]


def _versions(client: Any, team: dict[str, Any], control_id: str) -> list[dict[str, Any]]:
    found = client.get(f"{_base(team)}/controls/{control_id}/process/versions")
    assert found.status_code == 200, found.text
    body: list[dict[str, Any]] = found.json()
    return body


def test_the_rules_link_the_attributes_and_every_version_is_kept(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-rules")
    control = _new_control(client, team, control_ref="REV-31", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    assert codes, "the control has approved attributes with codes"
    built = client.post(f"{_base(team)}/controls/{cid}/process/build")
    assert built.status_code == 200, built.text
    understanding = built.json()["understanding"]
    assert understanding["built_by"] == "RULES"
    # The reviewed rules evaluate every approved attribute where the control operates.
    point = next(s for s in understanding["steps"] if s["control_point"])
    assert point["attributes"] == codes
    assert all(s["attributes"] == [] for s in understanding["steps"] if not s["control_point"])
    [first] = _versions(client, team, cid)
    assert (first["kind"], first["built_by"], first["version"]) == (
        "BUILT",
        "RULES",
        understanding["version"],
    )
    # A person's save keeps only the codes the control has, once each.
    steps = [
        {**point, "attributes": [codes[0], "Z9", codes[0]]},
        {"description": "Approved credit notes are posted.", "basis": "TEAM"},
    ]
    saved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={
            "summary": "The billing team raises credit notes.\n\nThe finance manager approves.",
            "steps": steps,
            "version": understanding["version"],
            "confirm": False,
        },
    )
    assert saved.status_code == 200, saved.text
    draft = saved.json()["understanding"]
    assert draft["steps"][0]["attributes"] == [codes[0]]
    confirmed = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={
            "summary": draft["summary"],
            "steps": draft["steps"],
            "version": draft["version"],
            "confirm": True,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    # Building again proposes beside the team's map; adopting it takes it as the draft.
    again = client.post(f"{_base(team)}/controls/{cid}/process/build")
    assert again.status_code == 200, again.text
    adopted = client.post(
        f"{_base(team)}/controls/{cid}/process/adopt",
        json={"version": again.json()["understanding"]["version"]},
    )
    assert adopted.status_code == 200, adopted.text
    history = _versions(client, team, cid)
    assert [v["kind"] for v in history] == ["ADOPTED", "PROPOSED", "CONFIRMED", "SAVED", "BUILT"]
    # Each version keeps its own words, who made it, and is numbered as the map was.
    assert history[3]["summary"].startswith("The billing team raises credit notes.")
    assert history[2]["actor"] and history[4]["actor"]
    assert history[1]["built_by"] == "RULES"
    assert [v["version"] for v in history] == sorted((v["version"] for v in history), reverse=True)


def test_the_agent_writes_the_narrative_from_the_clients_answers(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-agent")
    control = _control(client, team, "ITGC-AC-02")
    cid = control["id"]
    codes = _codes(migrated, cid)
    assert codes
    slots = [s for s in _context(client, team, cid)["design"]["slots"] if not s["automatic"]]
    assert slots, "the library control asks client-specific questions"
    answered = client.put(
        f"{_base(team)}/controls/{cid}/values",
        json={"values": {slots[0]["key"]: "Identity Governance Team"}, "everywhere": False},
    )
    assert answered.status_code == 200, answered.text
    narrative = (
        "Leavers are reported by HR on their last day.\n\n"
        "The Identity Governance Team removes their access the same day."
    )
    answer = {
        "summary": narrative,
        "steps": [
            {"description": "HR reports the leaver.", "actor": "HR", "system": "",
             "control_point": False, "basis": "INFERRED", "source": "", "quote": "",
             "attributes": []},
            {"description": "Access is removed.", "actor": "Identity Governance Team",
             "system": "", "control_point": True, "basis": "INFERRED", "source": "",
             "quote": "", "attributes": [codes[0], "Q7", codes[0]]},
        ],
        "issues": [],
    }  # fmt: skip
    provider = _Provider([answer])
    with connect(migrated.url) as connection:
        _build(connection, provider, team["org"], team["project"], UUID(cid), team["owner_id"])
    # The agent is given the client's answers, the statement and the attributes' codes.
    [request] = provider.requests
    assert "Identity Governance Team" in request.prompt
    assert '"client_answers"' in request.prompt and '"statement"' in request.prompt
    assert f'"code": "{codes[0]}"' in request.prompt
    assert request.output_schema is not None
    step_schema = request.output_schema["properties"]["steps"]["items"]
    assert "attributes" in step_schema["required"]
    understanding = _context(client, team, cid)["understanding"]
    assert understanding["built_by"] == "AGENT"
    assert understanding["summary"] == narrative
    # A code the control does not have is dropped, never kept.
    assert understanding["steps"][1]["attributes"] == [codes[0]]
    [version] = _versions(client, team, cid)
    assert (version["kind"], version["built_by"], version["summary"]) == (
        "BUILT",
        "AGENT",
        narrative,
    )


def test_the_versions_stay_inside_their_engagement(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-own")
    other, other_client, _other_scheduler = _engagement(migrated, "narrative-other")
    control = _new_control(client, team, control_ref="REV-32", domain="ORDER_TO_CASH")
    assert client.post(f"{_base(team)}/controls/{control['id']}/process/build").status_code == 200
    # Another firm's member cannot read them, under either engagement's address.
    theirs = other_client.get(f"{_base(team)}/controls/{control['id']}/process/versions")
    assert theirs.status_code in (403, 404)
    crossed = other_client.get(f"{_base(other)}/controls/{control['id']}/process/versions")
    assert crossed.status_code in (403, 404)
