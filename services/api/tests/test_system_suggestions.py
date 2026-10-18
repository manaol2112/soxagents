"""Suggested details for the Add a system wizard: the agent suggests a system's kind,
description, purpose, processes, and owner from what is known of the product and the
engagement's own records. Nothing is saved, and nothing about the client is invented."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_execution import _add_project_member, _add_user, _ready
from test_outbound import _session, migrated
from test_system_applicability import _Scripted, _setup

from ai_workforce_api.db import connect
from ai_workforce_api.system_suggestions import (
    Facts,
    SuggestBody,
    _Control,
    check_answer,
    facts_of,
    suggest,
)

__all__ = ["migrated"]


def _answer(**overrides: Any) -> dict[str, Any]:
    answer: dict[str, Any] = {
        "recognized": True,
        "layer": "INFRASTRUCTURE",
        "description": "Directory service that authenticates users and holds their groups.",
        "purpose": "Controls access to the financially significant applications.",
        "processes": "Logical access, Hire to retire",
        "processes_basis": "PRODUCT",
        "owner": "IT Infrastructure Manager",
        "owner_basis": "ROLE",
    }
    answer.update(overrides)
    return answer


def _facts(layer: Any = None, owner: str = "") -> Facts:
    return Facts(
        name="Active Directory",
        layer=layer,
        catalogue="INFRASTRUCTURE",
        client="Raul Corp",
        controls=(_Control("ITGC-AC-01", "User access is approved", "ACCESS", "", owner),),
        other_systems=("Workday",),
    )


def test_without_a_model_only_the_catalogue_and_records_are_used(migrated: Database) -> None:
    owner, base, system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        process = connection.execute(
            "INSERT INTO engagement_processes (organization_id, project_id, name, domain) "
            "VALUES (%s, %s, 'Payroll', 'HIRE_TO_RETIRE') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        assert process is not None
        connection.execute(
            "UPDATE engagement_controls SET process_id = %s WHERE project_id = %s "
            "AND %s = ANY(application_ids)",
            (process[0], team["project"], UUID(system_id)),
        )
        connection.commit()
        before = connection.execute("SELECT count(*) FROM audit_events").fetchone()
    suggested = owner.post(f"{base}/systems/suggest", json={"name": "Workday"})
    assert suggested.status_code == 200, suggested.text
    body = suggested.json()
    assert body["source"] == "RULES" and "No model is configured" in body["note"]
    assert body["layer"] == "APPLICATION" and body["basis"]["layer"] == "CATALOGUE"
    assert body["processes"] == "Payroll" and body["basis"]["processes"] == "RECORDS"
    # Nothing is made up without a model.
    assert body["description"] == body["purpose"] == body["owner"] == ""
    # A catalogue system not yet in scope: its kind only.
    directory = owner.post(f"{base}/systems/suggest", json={"name": "active directory"}).json()
    assert directory["layer"] == "INFRASTRUCTURE" and directory["processes"] == ""
    # A suggestion is not saved.
    system = next(a for a in owner.get(base).json()["applications"] if a["id"] == system_id)
    assert system["description"] == "" and system["processes"] == ""
    with connect(migrated.url) as connection:
        assert connection.execute("SELECT count(*) FROM audit_events").fetchone() == before


def test_the_agent_suggests_from_the_product_and_the_records(migrated: Database) -> None:
    _owner, _base, system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET owner_name = 'Dana Reyes' WHERE project_id = %s "
            "AND %s = ANY(application_ids)",
            (team["project"], UUID(system_id)),
        )
        connection.commit()
        provider = _Scripted(
            [_answer(layer="APPLICATION", owner="Dana Reyes", owner_basis="RECORDS")]
        )
        result = suggest(
            connection, provider, team["org"], team["project"], team["owner_id"],
            SuggestBody(name="Workday"),
        )  # fmt: skip
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert result.source == "MODEL" and result.note == ""
    assert result.owner == "Dana Reyes" and result.basis["owner"] == "RECORDS"
    assert result.description and result.basis["description"] == "PRODUCT"
    prompt = provider.requests[0].prompt
    # The records go to the agent as data: the controls on the system and their owners.
    assert "Workday" in prompt and "Dana Reyes" in prompt and "ITGC-AC-01" in prompt
    assert provider.requests[0].web_search == 0
    assert calls == (1,)


def test_the_agent_cannot_invent_an_owner_or_a_kind() -> None:
    # A person the records do not name is dropped; so is an email address.
    invented = check_answer(_answer(owner="Jordan Smith", owner_basis="RECORDS"), _facts())
    assert invented.owner == "" and "owner" not in invented.basis
    email = check_answer(_answer(owner="it@client.example", owner_basis="ROLE"), _facts())
    assert email.owner == ""
    named = check_answer(
        _answer(owner="Dana Reyes", owner_basis="RECORDS"), _facts(owner="Dana Reyes")
    )
    assert named.owner == "Dana Reyes"
    role = check_answer(_answer(), _facts())
    assert role.owner == "IT Infrastructure Manager" and role.basis["owner"] == "PRODUCT"
    # The team's kind, then the reviewed catalogue, come before the agent's.
    assert check_answer(_answer(layer="TOOL"), _facts()).layer == "INFRASTRUCTURE"
    chosen = check_answer(_answer(layer="TOOL"), _facts(layer="DATABASE"))
    assert chosen.layer == "DATABASE" and "layer" not in chosen.basis
    # A credential never reaches the form.
    secret = check_answer(_answer(purpose="password=hunter22 for the service"), _facts())
    assert "hunter22" not in secret.purpose
    # A product the agent does not know: no description, purpose, or owner.
    unknown = check_answer(_answer(recognized=False), _facts())
    assert unknown.description == unknown.purpose == unknown.owner == ""
    assert "does not recognise" in unknown.note


def test_an_answer_that_does_not_fit_falls_back_to_the_rules(migrated: Database) -> None:
    _owner, _base, _system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        for output in (None, {"layer": "SPACESHIP"}):
            result = suggest(
                connection, _Scripted([output]), team["org"], team["project"],
                team["owner_id"], SuggestBody(name="Active Directory"),
            )  # fmt: skip
            assert result.source == "RULES" and result.layer == "INFRASTRUCTURE"
            assert result.description == "" and result.note


def test_only_the_setup_team_can_ask(migrated: Database) -> None:
    _owner, base, _system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        reader_id = _add_user(
            connection, team["org"], f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reader_id)
    reader = _session(migrated, reader_id)
    body = {"name": "Okta"}
    assert reader.post(f"{base}/systems/suggest", json=body).status_code == 403
    _other, _project, stranger = _ready(migrated, "stranger-suggest")
    assert stranger.post(f"{base}/systems/suggest", json=body).status_code == 404
    owner = team["owner"]
    assert owner.post(f"{base}/systems/suggest", json={"name": ""}).status_code == 422
    assert owner.post(f"{base}/systems/suggest", json={"name": "x" * 121}).status_code == 422


def test_a_control_naming_the_system_is_read_as_whole_words(migrated: Database) -> None:
    _owner, _base, _system_id, team = _setup(migrated)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET title = 'AD accounts are reviewed quarterly' "
            "WHERE project_id = %s AND control_ref = 'ITGC-AC-01'",
            (team["project"],),
        )
        connection.execute(
            "UPDATE engagement_controls SET title = 'ADD requests are approved', "
            "activity = 'ADDITIONS are approved' "
            "WHERE project_id = %s AND control_ref = 'ITGC-AC-02'",
            (team["project"],),
        )
        connection.commit()
        found = facts_of(connection, team["project"], SuggestBody(name="AD"))
        assert {item.ref for item in found.controls} == {"ITGC-AC-01"}
        # A name with pattern characters is matched literally, never as a pattern.
        for name in ("C++ (legacy)", "SAP S/4HANA", "a.*b", "[x]"):
            assert facts_of(connection, team["project"], SuggestBody(name=name)).controls == ()
