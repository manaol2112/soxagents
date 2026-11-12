"""D&I evidence is traceable to the attributes (evidence traceability; the product owner's
methodology: design and implementation is a test of one against the attributes). The design
evidence item that shows the control performed once, the walkthrough instance, is linked to
every approved attribute, whoever planned it; and a plan whose D&I items evidence none of
the approved attributes is not released as ready.

Found on real data on 12 November 2026: the planner agent's design example listed no
attribute (its prompt asked for the attributes only in the operating phases, and nothing
checked the design phase), the rules' walkthrough it replaced had been linked to them, and
the release still read as ready, "tested against 4 attributes"."""

from typing import Any
from uuid import UUID

from support import Database, answer_walkthrough, settle_attributes, tailor_criteria
from test_design_release import REASON, _design
from test_evidence_plans import _Planner
from test_outbound import migrated
from test_planning_gate import _control, _launched, _project, _rows
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api.control_attributes import AttributeAdd, add_attribute
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import check_plan, rules_plan
from ai_workforce_api.evidence_plans import generate, load_facts
from ai_workforce_api.phase_release import design_untraced

__all__ = ["migrated"]

AC02 = "ITGC-AC-02"
NEW = "The removal is recorded on the leaver's ticket with the date it was done"


def _instances(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    """The live D&I items that show the control performed once, with the attributes each
    lists and how many approved attributes it is linked to."""
    return _rows(
        migrated,
        """
        SELECT q.requirement_key, jsonb_array_length(q.attributes),
               (SELECT count(*) FROM evidence_requirement_attributes ra
                JOIN control_attributes a ON a.id = ra.attribute_id
                WHERE ra.requirement_id = q.id AND a.status = 'APPROVED')
        FROM evidence_requirements q
        WHERE q.engagement_control_id = %s AND q.phase = 'DESIGN' AND q.status <> 'REMOVED'
          AND 'CONTROL_EXECUTION' = ANY(q.categories)
        ORDER BY q.requirement_key
        """,
        UUID(control),
    )


def _approved_count(migrated: Database, control: str) -> int:
    return int(
        _rows(
            migrated,
            "SELECT count(*) FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED'",
            UUID(control),
        )[0][0]
    )


def _as_the_model_planned_it(connection: Any, project: UUID, control: UUID) -> dict[str, Any]:
    """The plan as the planner agent returned it on the real data: every phase sound, and
    the design item that shows the control performed once listing no attribute."""
    facts = load_facts(connection, project, control)
    output: dict[str, Any] = rules_plan(facts).model_dump(mode="json", exclude_none=True)
    design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
    stripped = 0
    for requirement in design["requirements"]:
        if "CONTROL_EXECUTION" in requirement["categories"]:
            requirement["attributes"] = []
            stripped += 1
    assert stripped >= 1, "the control's design evidence has a walkthrough instance"
    return output


def test_a_replan_keeps_the_design_instance_linked_to_every_attribute_and_to_a_new_one(
    migrated: Database,
) -> None:
    team = _launched(migrated, "dt-replan")
    control = str(_control(team, AC02)["id"])
    org, project, owner = UUID(str(team["org"])), UUID(str(team["project"])), team["owner_id"]
    settle_attributes(migrated, team["project"])
    count = _approved_count(migrated, control)
    assert count >= 2
    # As launched, by the rules: the instance is linked to every approved attribute.
    assert all(row[1:] == (count, count) for row in _instances(migrated, control))
    with connect(migrated.url) as connection:
        output = _as_the_model_planned_it(connection, project, UUID(control))
        # The check itself repairs it: the instance lists the control's attributes, in the
        # control's order; a policy or procedure document keeps what the planner listed.
        facts = load_facts(connection, project, UUID(control))
        checked = check_plan(output, facts)
        design = next(phase for phase in checked.phases if phase.phase == "DESIGN")
        for requirement in design.requirements:
            if "CONTROL_EXECUTION" in requirement.categories:
                assert requirement.attributes == list(facts.attributes)
        # The planner agent plans again with that answer: the links stay.
        generate(connection, _Planner(output), org, project, UUID(control), owner)
        connection.commit()
    instances = _instances(migrated, control)
    assert instances and all(row[1:] == (count, count) for row in instances)
    with connect(migrated.url) as connection:
        assert design_untraced(connection, project, UUID(control)) == {}
        # A person accepts an addition, and the evidence is planned again for it, the
        # planner again listing nothing on the instance.
        add_attribute(connection, org, project, UUID(control), owner, AttributeAdd(text=NEW))
        connection.commit()
        again = _as_the_model_planned_it(connection, project, UUID(control))
        generate(connection, _Planner(again), org, project, UUID(control), owner)
        connection.commit()
    assert _approved_count(migrated, control) == count + 1
    # The instance is linked to the new attribute as well as to every one before it.
    extended = _instances(migrated, control)
    assert extended and all(row[1:] == (count + 1, count + 1) for row in extended)
    linked = _rows(
        migrated,
        """
        SELECT count(*) FROM evidence_requirement_attributes ra
        JOIN evidence_requirements q ON q.id = ra.requirement_id
        JOIN control_attributes a ON a.id = ra.attribute_id
        WHERE q.engagement_control_id = %s AND q.phase = 'DESIGN' AND q.status <> 'REMOVED'
          AND a.text = %s
        """,
        UUID(control),
        NEW,
    )
    assert int(linked[0][0]) >= 1


def test_a_plan_whose_design_items_evidence_no_attribute_is_not_released_as_ready(
    migrated: Database,
) -> None:
    team = _launched(migrated, "dt-gate")
    control = str(_control(team, AC02)["id"])
    org, project, owner = UUID(str(team["org"])), UUID(str(team["project"])), team["owner_id"]
    settle_attributes(migrated, team["project"])
    tailor_criteria(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    answer_walkthrough(migrated, team["project"], [UUID(control)])
    # Understood, attributes settled, D&I items linked: ready.
    assert _design(team, control)["step"] == "READY"
    # A plan as the defect left it: the D&I items list and are linked to no attribute.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes ra USING evidence_requirements q "
            "WHERE q.id = ra.requirement_id AND q.engagement_control_id = %s "
            "AND q.phase = 'DESIGN'",
            (control,),
        )
        connection.execute(
            "UPDATE evidence_requirements SET attributes = '[]'::jsonb "
            "WHERE engagement_control_id = %s AND phase = 'DESIGN'",
            (control,),
        )
        connection.commit()
        count = _approved_count(migrated, control)
        waits = design_untraced(connection, project, UUID(control))
        assert list(waits) == [UUID(control)]
        assert (
            f"no D&I item evidences any of the {count} approved attributes" in waits[UUID(control)]
        )
        # The engagement's read agrees with the control's.
        assert design_untraced(connection, project)[UUID(control)] == waits[UUID(control)]
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "EVIDENCE")
    assert design["waiting_for"] == waits[UUID(control)]
    assert design["step_label"] == "Evidence not planned against the attributes"
    # It is an exception a person decides: no release without the reason.
    path = f"{_project(team)}/controls/{control}/phases/DESIGN/release"
    refused = team["owner"].post(path, json={"reason": ""})
    assert refused.status_code == 409
    assert "no D&I item evidences" in refused.json()["detail"]
    assert _rows(
        migrated,
        "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]
    # Planning the evidence again repairs the plan, and the release is recommended again.
    with connect(migrated.url) as connection:
        generate(connection, None, org, project, UUID(control), owner)
        connection.commit()
        assert design_untraced(connection, project, UUID(control)) == {}
    assert _design(team, control)["step"] == "READY"
    assert all(row[1:] == (count, count) for row in _instances(migrated, control))
    # With the reason, an early release from an untraced plan is still a person's call.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM evidence_requirement_attributes ra USING evidence_requirements q "
            "WHERE q.id = ra.requirement_id AND q.engagement_control_id = %s "
            "AND q.phase = 'DESIGN'",
            (control,),
        )
        connection.commit()
    released = team["owner"].post(path, json={"reason": REASON})
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert (status["step"], status["early"], status["reason"]) == ("RELEASED", True, REASON)


def test_only_a_live_design_item_counts_as_evidencing_an_attribute(migrated: Database) -> None:
    """A waived item will not be obtained, and an addition proposed on an approved plan has
    not been accepted: neither evidences an attribute, so neither clears the hold."""
    team = _launched(migrated, "dt-live")
    control = str(_control(team, AC02)["id"])
    project = UUID(str(team["project"]))
    settle_attributes(migrated, team["project"])
    with connect(migrated.url) as connection:
        assert design_untraced(connection, project, UUID(control)) == {}
        # Every D&I item only a proposed addition.
        connection.execute(
            "UPDATE evidence_requirements SET pending_change = '{\"add\": true}'::jsonb "
            "WHERE engagement_control_id = %s AND phase = 'DESIGN'",
            (control,),
        )
        connection.commit()
        assert list(design_untraced(connection, project, UUID(control))) == [UUID(control)]
        connection.execute(
            "UPDATE evidence_requirements SET pending_change = NULL "
            "WHERE engagement_control_id = %s AND phase = 'DESIGN'",
            (control,),
        )
        connection.commit()
        assert design_untraced(connection, project, UUID(control)) == {}
        # The linked D&I items waived: their links are still there, and evidence nothing.
        connection.execute(
            """
            UPDATE evidence_requirements q
            SET status = 'WAIVED', waive_reason = 'Not obtainable this year.',
                waived_by = %s, waived_at = clock_timestamp()
            WHERE q.engagement_control_id = %s AND q.phase = 'DESIGN'
              AND EXISTS (SELECT 1 FROM evidence_requirement_attributes ra
                          WHERE ra.requirement_id = q.id)
            """,
            (team["owner_id"], control),
        )
        connection.commit()
        waits = design_untraced(connection, project, UUID(control))
        assert (
            list(waits) == [UUID(control)] and "no D&I item evidences any" in waits[UUID(control)]
        )
