"""Control statements (Milestone 8.9): each library control's design, as its documentation
states it, with the client's values filled in at setup.

These tests check the statements' structure and how values flow through an engagement; they
say nothing about whether a statement describes the client's control.
"""

import json
from typing import Any

from fastapi.testclient import TestClient
from support import Database
from test_evidence_intake import _engagement
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated
from test_testing_engine import _base

from ai_workforce_api.control_statements import ASSERTIONS, render
from ai_workforce_api.controls import LIBRARY, SPLITS, V2_LIBRARY, V4_LIBRARY
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.definition_registry import v2_attributes
from ai_workforce_api.statement_registry import STATEMENTS, problems, statement_for
from ai_workforce_api.testing_engine import ItemContext, ItemFile, design_prompt, prompt_for

__all__ = ["migrated"]


# The statements


def test_every_library_control_has_a_complete_statement() -> None:
    assert problems() == []
    assert set(STATEMENTS) == {control.key for control in LIBRARY}
    for control in LIBRARY:
        statement = statement_for(control.key)
        assert statement is not None
        assert all(item in ASSERTIONS for item in statement.assertions)
        # The library's description is the statement, frequency and nature included.
        assert (control.frequency, control.nature) == (statement.frequency, statement.nature)


def test_combined_controls_are_split_and_keep_their_ids() -> None:
    refs = [control.control_ref for control in LIBRARY]
    for parent, parts in SPLITS.items():
        before = next(c for c in V2_LIBRARY if c.key == parent)
        assert before.control_ref in refs
        for part in parts:
            assert part.control_ref.startswith(before.control_ref + ".")
            # Each part follows its parent in the library.
            assert refs.index(part.control_ref) > refs.index(before.control_ref)
    assert sum(len(parts) for parts in SPLITS.values()) == 5
    assert len(LIBRARY) == len(V2_LIBRARY) + 5 + len(V4_LIBRARY)
    # A moved attribute is retired on the parent with a reason that names where it went.
    v2 = v2_attributes()
    assert "Only authorized people can change the job schedule" in v2["operations-scheduling"]


def test_values_testing_needs_block_and_names_never_do() -> None:
    for statement in STATEMENTS.values():
        for slot in statement.slots:
            if slot.kind in ("ROLE", "SYSTEM"):
                assert not slot.blocks, slot.key
            if slot.kind == "AMOUNT":
                assert slot.blocks, slot.key
    journal = statement_for("rtr-journal-review")
    assert journal is not None
    threshold = journal.slot("je-threshold")
    assert threshold is not None and threshold.blocks


def test_a_statement_shows_each_missing_value_by_its_label() -> None:
    labels = {"je-threshold": "the journal entry review threshold"}
    text = "Entries above {je-threshold} on {system} are approved."
    assert render(text, {}, labels) == (
        "Entries above [the journal entry review threshold] on the system are approved."
    )
    assert render(text, {"je-threshold": "25,000", "system": "SAP"}, labels) == (
        "Entries above 25,000 on SAP are approved."
    )


def test_the_tester_reads_the_controls_design() -> None:
    design = design_prompt(None)
    assert design is None
    context = ItemContext(
        control_ref="RTR-01",
        title="Manual journal entries are reviewed",
        activity="Entries above 25,000 are approved.",
        frequency="event-driven",
        nature="manual",
        period="the audit period ending 31 December 2027",
        attributes=("The approver is a different user from the preparer",),
        item_label="JE-100",
        item_detail=(("Entry", "JE-100"),),
        test_of_one=False,
        files=(ItemFile("je.txt", "sample", "JE-100 approved", None),),
        design={"precision": "Every manual journal entry above 25,000 in the period."},
    )
    prompt = prompt_for(context)
    facts = json.loads(prompt.split("<control_and_item>\n", 1)[1].split("\n</control", 1)[0])
    assert facts["control"]["design"]["precision"].startswith("Every manual journal entry")


# In an engagement


def _control_id(database: Database, team: dict[str, Any], ref: str) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s "
            "ORDER BY created_at LIMIT 1",
            (team["project"], ref),
        ).fetchone()
    assert row is not None
    return str(row[0])


def _context(client: TestClient, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    found = client.get(f"{_base(team)}/controls/{control_id}/context")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def test_the_team_fills_a_value_once_for_every_control_that_uses_it(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "stmt-values")
    provisioning = _control_id(migrated, team, "ITGC-AC-01")
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    design = _context(client, team, provisioning)["design"]
    assert design["it_risk"] and design["assertions"] == []
    assert design["control_type"] == "PREVENTIVE" and design["frequency"] == "EVENT_DRIVEN"
    # The control's own system is filled in, never asked for.
    system = next(s for s in design["slots"] if s["key"] == "system")
    assert system["automatic"] and system["value"] == "SAP ERP"
    assert "SAP ERP" in design["text"]
    assert "[the role that administers user access]" in design["text"]
    # A value already set on another control is kept; the rest take this one.
    first = client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"admin-role": "Identity team"}},
    )
    assert first.status_code == 200, first.text
    everywhere = client.put(
        f"{_base(team)}/controls/{provisioning}/values",
        json={"values": {"admin-role": "IT service desk"}, "everywhere": True},
    )
    assert everywhere.status_code == 200, everywhere.text
    assert "IT service desk grants only the approved access" in everywhere.json()["design"]["text"]
    assert "Identity team" in _context(client, team, leavers)["design"]["text"]
    review = _control_id(migrated, team, "ITGC-AC-03")
    assert "IT service desk makes every change" in _context(client, team, review)["design"]["text"]
    with connect(migrated.url) as connection:
        activity = connection.execute(
            "SELECT activity FROM engagement_controls WHERE id = %s", (provisioning,)
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'control.values_set' "
            "ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    assert activity is not None and "IT service desk" in str(activity[0])
    assert audit is not None and audit[0]["everywhere"] is True and audit[0]["controls"] > 1
    # Values are checked: no unknown slot, no credential, never the system.
    for values in (
        {"no-such-slot": "x"},
        {"system": "Other ERP"},
        {"admin-role": "password=hunter22"},
    ):
        refused = client.put(f"{_base(team)}/controls/{provisioning}/values",
                             json={"values": values})  # fmt: skip
        assert refused.status_code == 409, values


def test_a_split_control_brings_its_parts_when_version_3_is_adopted(migrated: Database) -> None:
    # Before launch, as an engagement set up from version 2: no split parts, v2 wording.
    team = _new_engagement(migrated, "stmt-split")
    _complete_setup(team["owner"], team)
    client: TestClient = team["owner"]
    backup = _control_id(migrated, team, "ITGC-OP-03")
    before = next(c for c in V2_LIBRARY if c.key == "operations-backup")
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "DELETE FROM engagement_controls WHERE project_id = %s AND library_key IN "
            "('operations-backup-failures', 'operations-restore-test')",
            (team["project"],),
        )
        cursor.execute(
            "UPDATE engagement_controls SET library_version = 2, test_attributes = %s, "
            "title = %s, activity = %s, frequency = %s, nature = %s WHERE id = %s",
            (json.dumps(list(before.test_attributes)), before.title, before.activity,
             before.frequency, before.nature, backup),
        )  # fmt: skip
    update = _context(client, team, backup)["library_update"]
    assert {s["control_ref"] for s in update["splits"]} == {"ITGC-OP-03.1", "ITGC-OP-03.2"}
    restore = next(s for s in update["splits"] if s["control_ref"] == "ITGC-OP-03.2")
    assert "Moved to ITGC-OP-03.2" in restore["reason"]
    fields = {f["field"]: f for f in update["fields"]}
    # The formal title (library version 4).
    assert fields["title"]["now"] == "Backup Configuration and Scheduling"
    # Only what changes is listed: backups stay daily and automated.
    assert "nature" not in fields and "frequency" not in fields
    assert "activity" in fields
    adopted = client.post(f"{_base(team)}/controls/{backup}/library-update/adopt")
    assert adopted.status_code == 200, adopted.text
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT control_ref, library_version, engagement_application_id, included FROM "
            "engagement_controls WHERE project_id = %s AND control_ref LIKE 'ITGC-OP-03%%' "
            "ORDER BY control_ref",
            (team["project"],),
        ).fetchall()
        title = connection.execute(
            "SELECT title FROM engagement_controls WHERE id = %s", (backup,)
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'control.library_adopted' "
            "AND target_id = %s",
            (backup,),
        ).fetchone()
    # The parts are added for the same system, in scope as the parent is.
    assert [row[0] for row in rows] == ["ITGC-OP-03", "ITGC-OP-03.1", "ITGC-OP-03.2"]
    # A split part is stamped with its own definition version: 4 since the IT general
    # controls were rewritten (L3a).
    assert {row[1] for row in rows} == {4}
    assert len({row[2] for row in rows}) == 1 and all(row[3] for row in rows)
    assert title == ("Backup Configuration and Scheduling",)
    assert audit is not None and len(audit[0]["added"]) == 2
    history = {a["text"]: a["note"] for a in adopted.json()["attributes"]["history"]}
    assert history["A restore test succeeded during the period"].startswith(
        "Retired by library v4: Moved to ITGC-OP-03.2"
    )
    assert client.post(f"{_base(team)}/controls/{backup}/library-update/adopt").status_code == 409


def test_split_parts_already_in_the_engagement_are_not_offered_again(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "stmt-split-present")
    backup = _control_id(migrated, team, "ITGC-OP-03")
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE engagement_controls SET library_version = 2 WHERE id = %s", (backup,)
        )
    update = _context(client, team, backup)["library_update"]
    assert update is not None and update["splits"] == []


def test_a_library_copy_follows_the_library_title_and_a_clients_control_keeps_its_own(
    migrated: Database,
) -> None:
    """A library copy made before the library was retitled (or cloned from one for a new
    system) takes the library's current title when its statement is refreshed; a control
    from the client's RCM keeps the title the client gave it."""
    from uuid import UUID

    from ai_workforce_api.control_design import refresh_statement
    from ai_workforce_api.control_instances import clone_instance
    from ai_workforce_api.controls import BY_KEY

    team, _client, _scheduler = _engagement(migrated, "stmt-titles")
    control = UUID(_control_id(migrated, team, "ITGC-AC-01"))
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE engagement_controls SET title = 'New user access is approved' WHERE id = %s",
            (control,),
        )
        copied = clone_instance(cursor, control, None)
        refresh_statement(cursor, control)
        titles = dict(
            cursor.execute(
                "SELECT id, title FROM engagement_controls WHERE id = ANY(%s)",
                ([control, copied],),
            ).fetchall()
        )
        assert titles[control] == titles[copied] == BY_KEY["access-provisioning"].title
        # The client's own control keeps its title.
        cursor.execute(
            "UPDATE engagement_controls SET source = 'MANUAL', title = 'Our own wording' "
            "WHERE id = %s",
            (copied,),
        )
        refresh_statement(cursor, copied)
        kept = cursor.execute(
            "SELECT title FROM engagement_controls WHERE id = %s", (copied,)
        ).fetchone()
        assert kept == ("Our own wording",)


def test_a_new_systems_instance_starts_at_the_librarys_current_version(
    migrated: Database,
) -> None:
    """A new system's instance of a library control is a clone of its sibling. When the
    sibling is on an earlier definition version, the new instance starts at the current
    one: the library's attributes (keyed to the definition) and evidence items, not the
    sibling's. The sibling keeps its version until a person adopts the update."""
    from uuid import UUID

    from ai_workforce_api.control_instances import clone_instance
    from ai_workforce_api.definition_registry import definition_for

    team, _client, _scheduler = _engagement(migrated, "stmt-clone")
    sibling = UUID(_control_id(migrated, team, "ITGC-AC-05"))
    definition = definition_for("access-authentication")
    assert definition is not None and definition.version == 4
    current = [item.text for item in definition.approved]
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        # As an engagement set up before the definition was rewritten.
        cursor.execute(
            "UPDATE engagement_controls SET library_version = 3, test_attributes = %s, "
            "pbc_items = '[\"An older evidence item\"]' WHERE id = %s",
            (json.dumps(current[:2]), sibling),
        )
        copied = clone_instance(cursor, sibling, None)
        found = cursor.execute(
            "SELECT library_version, pbc_items FROM engagement_controls WHERE id = %s",
            (copied,),
        ).fetchone()
        assert found is not None
        version, pbc = found
        approved = cursor.execute(
            "SELECT text, definition_key FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position",
            (copied,),
        ).fetchall()
        sibling_version = cursor.execute(
            "SELECT library_version FROM engagement_controls WHERE id = %s", (sibling,)
        ).fetchone()
    assert version == 4 and pbc != ["An older evidence item"]
    assert [row[0] for row in approved] == current
    assert all(row[1] is not None for row in approved)
    assert sibling_version == (3,)
