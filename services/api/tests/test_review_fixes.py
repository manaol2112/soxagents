"""Regressions from the independent review of 11 November 2026 (B1b, criteria tailored to
the control):

- H2: the planner's tailored criteria for a library attribute reach an approved plan as a
  pending revision, and criteria nothing would write (the demo's, unaccepted) are not a
  difference. The planner, its comparison and its writer read one rule
  (evidence_plans.CRITERIA_WRITABLE_SQL).
- M4: an interrupted narrative run (WORKING, its lease run out) does not hold the D&I
  release; one at work under a live lease does.
- M5: the planner is asked only for the criteria it may write, and the D&I release's wait
  says whether the criteria wait for a person's acceptance or for tailoring."""

import json
from typing import Any
from uuid import UUID

from support import Database, approve_control_plan, settle_attributes, tailor_criteria
from test_evidence_plans import _Planner
from test_outbound import migrated
from test_planning_gate import _control, _launched

from ai_workforce_api.control_attributes import CRITERIA_OWNED_SQL
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import prompt_for, rules_plan
from ai_workforce_api.evidence_plans import generate, load_facts
from ai_workforce_api.master_plans import (
    AcceptCriteriaBody,
    AcceptedAttribute,
    PendingRevisionDecision,
    accept_criteria,
    decide_pending_revision,
)
from ai_workforce_api.phase_release import attribute_waits

__all__ = ["migrated"]

_CLEARED = (
    "UPDATE control_attributes SET condition = '', pass_criteria = '', fail_criteria = '', "
    "judgment_required = NULL, automatable = NULL, criteria_origin = NULL, "
    "criteria_accepted_by = NULL, criteria_accepted_at = NULL, version = version + 1 "
    "WHERE engagement_control_id = %s AND status = 'APPROVED'"
)


def _team(migrated: Database, slug: str) -> tuple[dict[str, Any], UUID, UUID, UUID, UUID]:
    team = _launched(migrated, slug)
    control = UUID(_control(team, "ITGC-AC-01")["id"])
    settle_attributes(migrated, team["project"])
    return (
        team,
        UUID(str(team["org"])),
        UUID(str(team["project"])),
        control,
        UUID(str(team["owner_id"])),
    )


def _approved(connection: Any, control: UUID) -> list[tuple[UUID, str, str | None]]:
    return [
        (UUID(str(row[0])), str(row[1]), None if row[2] is None else str(row[2]))
        for row in connection.execute(
            "SELECT id, text, definition_key FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' "
            "ORDER BY position, created_at",
            (control,),
        ).fetchall()
    ]


def _plan(connection: Any, control: UUID) -> tuple[str, int, dict[str, Any] | None]:
    row = connection.execute(
        "SELECT status, version, pending_revision FROM evidence_plans "
        "WHERE engagement_control_id = %s",
        (control,),
    ).fetchone()
    assert row is not None
    return str(row[0]), int(row[1]), row[2] if isinstance(row[2], dict) else None


def _criteria(attribute: str, system: str) -> dict[str, Any]:
    return {
        "attribute": attribute,
        "condition": f"The {system} access request names the user and the role requested.",
        "pass_criteria": f"The user's manager approved the request in {system} before the grant.",
        "fail_criteria": "No approval is recorded, or the approval is dated after the grant.",
        "judgment_required": False,
    }


def _owned(connection: Any, attribute: UUID) -> bool:
    row = connection.execute(
        f"SELECT coalesce({CRITERIA_OWNED_SQL}, false) FROM control_attributes a WHERE a.id = %s",
        (attribute,),
    ).fetchone()
    return bool(row is not None and row[0])


def test_an_approved_plan_receives_the_planners_criteria_for_a_library_attribute(
    migrated: Database,
) -> None:
    _, org, project, control, owner = _team(migrated, "rf-approved-criteria")
    with connect(migrated.url) as connection:
        approved = _approved(connection, control)
        library = [item for item in approved if item[2] is not None]
        assert len(library) >= 2, approved
        (tailored_id, tailored_text, _), (seeded_id, seeded_text, _) = library[0], library[1]
        # No criteria on any attribute yet; the second has the demo's prepared criteria, not
        # accepted, and (as a client's own attribute) no library definition: the old
        # comparison counted it, though nothing writes over the demo's criteria.
        connection.execute(_CLEARED, (control,))
        connection.execute(
            "UPDATE control_attributes SET definition_key = NULL, criteria_origin = 'SEEDED', "
            "condition = 'Prepared: the request names the user.', "
            "pass_criteria = 'Prepared: approved before the grant.', "
            "fail_criteria = 'Prepared: no approval before the grant.', version = version + 1 "
            "WHERE id = %s",
            (seeded_id,),
        )
        connection.commit()
        # The planner's plan, before a person approves it, takes effect as it is.
        facts = load_facts(connection, project, control)
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        generate(connection, _Planner(output), org, project, control, owner)
    approve_control_plan(migrated, control)
    with connect(migrated.url) as connection:
        assert _plan(connection, control)[0] == "APPROVED"
        # Baseline: the same plan again changes nothing.
        generate(connection, _Planner(output), org, project, control, owner)
        assert _plan(connection, control)[2] is None
        # Criteria only for the demo's attribute: nothing would write them, so no revision.
        seeded_only = output | {"criteria": [_criteria(seeded_text, "ServiceNow")]}
        generate(connection, _Planner(seeded_only), org, project, control, owner)
        assert _plan(connection, control)[2] is None
        # The only change is the planner's tailored criteria for a library attribute: it is
        # proposed to the reviewer, never written over the approved plan.
        tailored = output | {"criteria": [_criteria(tailored_text, "ServiceNow")]}
        generate(connection, _Planner(tailored), org, project, control, owner)
        status, version, pending = _plan(connection, control)
        assert pending is not None and status == "CHANGES_PROPOSED"
        assert [item["attribute"] for item in pending["criteria"]] == [tailored_text]
        row = connection.execute(
            "SELECT criteria_origin, condition FROM control_attributes WHERE id = %s",
            (tailored_id,),
        ).fetchone()
        assert row is not None and row[0] is None and row[1] == ""
        # A person accepts the plan change: the criteria are written as the agent's.
        decide_pending_revision(
            connection, org, project, control, owner,
            PendingRevisionDecision(version=version, decision="ACCEPT"),
        )  # fmt: skip
        rows = {
            UUID(str(r[0])): (r[1], str(r[2]), int(r[3]))
            for r in connection.execute(
                "SELECT id, criteria_origin, pass_criteria, version FROM control_attributes "
                "WHERE id = ANY(%s)",
                ([tailored_id, seeded_id],),
            ).fetchall()
        }
        assert rows[tailored_id][0] == "AGENT"
        assert rows[tailored_id][1].startswith("The user's manager approved")
        # The demo's prepared criteria stay as they were.
        assert rows[seeded_id][:2] == ("SEEDED", "Prepared: approved before the grant.")
        assert not _owned(connection, tailored_id)
        wait = attribute_waits(connection, project, control)[control]
        assert "2 attributes have criteria to accept" in wait, wait
        # A person accepts the criteria: owned, and what the testers judge against.
        accept_criteria(
            connection, org, project, control, owner,
            AcceptCriteriaBody(
                attributes=[AcceptedAttribute(id=tailored_id, version=rows[tailored_id][2])]
            ),
        )  # fmt: skip
        assert _owned(connection, tailored_id)
        # Owned now: the planner is no longer asked for it, and a later run's different
        # criteria for it change nothing, proposed or written.
        again = load_facts(connection, project, control)
        assert tailored_text not in again.criteria_writable
        assert _plan(connection, control)[2] is None
        changed = output | {"criteria": [_criteria(tailored_text, "Jira")]}
        generate(connection, _Planner(changed), org, project, control, owner)
        assert _plan(connection, control)[2] is None
        kept = connection.execute(
            "SELECT pass_criteria FROM control_attributes WHERE id = %s", (tailored_id,)
        ).fetchone()
        assert kept is not None and "ServiceNow" in str(kept[0])
        assert _owned(connection, tailored_id)


def test_an_interrupted_narrative_run_does_not_hold_the_attributes(migrated: Database) -> None:
    team, _org, project, control, _owner = _team(migrated, "rf-narrative-lease")
    tailor_criteria(migrated, team["project"])

    def run(status: str, lease: str) -> str | None:
        with connect(migrated.url) as connection:
            connection.execute(
                f"""
                INSERT INTO process_narrative_runs (
                    engagement_control_id, organization_id, project_id, run_status, stage,
                    run_lease_until
                )
                SELECT id, organization_id, project_id, %s, 'ATTRIBUTES', {lease}
                FROM engagement_controls WHERE id = %s
                ON CONFLICT (engagement_control_id)
                DO UPDATE SET run_status = EXCLUDED.run_status, stage = 'ATTRIBUTES',
                              run_lease_until = EXCLUDED.run_lease_until
                """,
                (status, control),
            )
            connection.commit()
            return attribute_waits(connection, project, control).get(control)

    with connect(migrated.url) as connection:
        assert attribute_waits(connection, project, control).get(control) is None
    busy = "The attributes are not settled: the agent is still updating them."
    # At work under a live lease, or waiting to start: its proposals would follow.
    assert run("WORKING", "clock_timestamp() + interval '10 minutes'") == busy
    assert run("PENDING", "NULL") == busy
    # WORKING with no lease is never reclaimed (process_narrative), so it still holds.
    assert run("WORKING", "NULL") == busy
    # Its lease ran out: the run was interrupted and is reclaimed; it holds nothing.
    assert run("WORKING", "clock_timestamp() - interval '1 minute'") is None
    assert run("IDLE", "NULL") is None


def test_the_planner_is_asked_only_for_the_criteria_it_may_write_and_the_wait_says_why(
    migrated: Database,
) -> None:
    _, _org, project, control, _owner = _team(migrated, "rf-writable-criteria")
    with connect(migrated.url) as connection:
        approved = _approved(connection, control)
        assert len(approved) >= 3, approved
        connection.execute(_CLEARED, (control,))
        connection.commit()
        count = len(approved)
        waits = attribute_waits(connection, project, control)
        assert waits[control] == (
            f"The attributes are not settled: {count} attributes need criteria tailored to "
            "this control."
        )
        (agent_id, agent_text, _), (seeded_id, seeded_text, _), (person_id, person_text, _) = (
            approved[:3]
        )
        # The agent's tailored criteria and the demo's prepared ones wait for acceptance; a
        # person's own, left incomplete, still need tailoring and are not the planner's.
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', "
            "condition = 'The request names the user.', pass_criteria = 'Approved first.', "
            "fail_criteria = 'Not approved first.', version = version + 1 WHERE id = %s",
            (agent_id,),
        )
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'SEEDED', "
            "condition = 'The request names the user.', pass_criteria = 'Approved first.', "
            "fail_criteria = 'Not approved first.', version = version + 1 WHERE id = %s",
            (seeded_id,),
        )
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'PERSON', "
            "condition = 'The request names the user.', version = version + 1 WHERE id = %s",
            (person_id,),
        )
        connection.commit()
        rest = count - 2
        assert attribute_waits(connection, project, control)[control] == (
            "The attributes are not settled: 2 attributes have criteria to accept and "
            f"{rest} attribute{'' if rest == 1 else 's'} need{'s' if rest == 1 else ''} "
            "criteria tailored to this control."
        )
        # The planner is asked for exactly what it may write: the agent's unaccepted
        # criteria (it may improve them) and those with none, never the demo's or a
        # person's, complete or not.
        facts = load_facts(connection, project, control)
        assert agent_text in facts.criteria_writable
        assert seeded_text not in facts.criteria_writable
        assert person_text not in facts.criteria_writable
        prompt = prompt_for(facts)
        data = json.loads(prompt.split("<control>\n", 1)[1].rsplit("\n</control>", 1)[0])
        expected = [text for text in facts.attributes if text not in (seeded_text, person_text)]
        assert agent_text in expected
        assert data["attributes_needing_criteria"] == expected
        # Only acceptance left: said alone.
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', "
            "condition = 'The request names the user.', pass_criteria = 'Approved first.', "
            "fail_criteria = 'Not approved first.', version = version + 1 "
            "WHERE engagement_control_id = %s AND status = 'APPROVED' AND id <> %s",
            (control, seeded_id),
        )
        connection.commit()
        assert attribute_waits(connection, project, control)[control] == (
            f"The attributes are not settled: {count} attributes have criteria to accept."
        )
