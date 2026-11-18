"""D&I evidence is traceable to the attributes (evidence traceability; the product owner's
methodology: design and implementation is a test of one against the attributes). The design
evidence item that shows the control performed once, the walkthrough instance, is linked to
every approved attribute, whoever planned it; and a plan whose D&I items evidence none of
the approved attributes is not released as ready.

Found on real data on 12 November 2026: the planner agent's design example listed no
attribute (its prompt asked for the attributes only in the operating phases, and nothing
checked the design phase), the rules' walkthrough it replaced had been linked to them, and
the release still read as ready, "tested against 4 attributes".

Since the D&I requests list (B1f, the same day) the hold is per attribute: every approved
attribute is addressed by a live D&I request, or a person records why not
(test_design_requests.py has the list, its acceptance and the exceptions)."""

from dataclasses import replace
from datetime import date
from typing import Any
from uuid import UUID

import pytest
from support import (
    Database,
    accept_design_requests,
    answer_walkthrough,
    settle_attributes,
    tailor_criteria,
)
from test_design_release import REASON, _design
from test_evidence_plans import _Planner
from test_outbound import migrated
from test_planning_gate import _control, _launched, _project, _rows
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api.control_attributes import AttributeAdd, add_attribute
from ai_workforce_api.db import connect
from ai_workforce_api.design_requests import RequestAccepted, RequestsAccepted, accept
from ai_workforce_api.evidence_planning import (
    DESIGN_CARRIER,
    PlanFacts,
    PlanOutput,
    RequirementPlan,
    check_plan,
    rules_plan,
    traits_of,
)
from ai_workforce_api.evidence_plans import generate, load_facts
from ai_workforce_api.phase_release import design_untraced, uncovered_attributes

__all__ = ["migrated"]

AC02 = "ITGC-AC-02"
NEW = "The removal is recorded on the leaver's ticket with the date it was done"
LATER = "The removal is confirmed to the leaver's manager within one business day"


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
    """Rewritten 12 November 2026 (B1f, the D&I requests list; product owner: "For each
    request, I want to show which specific attributes it is addressing to make sure I get
    coverage", and "Why do I need to have the release button? Simplify the workflow.").

    Old: an understood control with settled attributes read READY; a plan none of whose D&I
    items evidenced any approved attribute read WAITING on EVIDENCE ("no D&I item evidences
    any of the N approved attributes ... Plan the evidence again."), a release without a
    reason was refused, planning again made it READY, and with a reason an early release
    from an untraced plan was still a person's call.

    New: the hold is per attribute (the none-at-all case is every attribute uncovered),
    worded for what a person does about it; the understood control waits for its requests
    to be accepted, not for a release; there is no early release, so the untraced plan is
    refused whatever the reason, and accepting every request does not release it either.
    The safeguard is the same and stricter: evidence nobody could judge against the
    attributes is never requested."""
    team = _launched(migrated, "dt-gate")
    control = str(_control(team, AC02)["id"])
    org, project, owner = UUID(str(team["org"])), UUID(str(team["project"])), team["owner_id"]
    settle_attributes(migrated, team["project"])
    tailor_criteria(migrated, team["project"])
    _values_and_questions_answered(migrated, team, control)
    answer_walkthrough(migrated, team["project"], [UUID(control)])
    # Understood, attributes settled, D&I items linked: only the requests wait.
    assert _design(team, control)["waiting_on"] == "REQUESTS"
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
        assert waits[UUID(control)] == (
            f"The D&I requests do not cover the attributes: {count} approved attributes are "
            "not addressed by any D&I request. Add each to a request, or record why it is "
            "not evidenced at D&I."
        )
        assert len(uncovered_attributes(connection, project, UUID(control))[UUID(control)]) == count
        # The engagement's read agrees with the control's.
        assert design_untraced(connection, project)[UUID(control)] == waits[UUID(control)]
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "EVIDENCE")
    assert design["waiting_for"] == waits[UUID(control)]
    assert design["step_label"] == "Evidence not planned against the attributes"
    # It is an exception a person decides: no release, with or without a reason.
    path = f"{_project(team)}/controls/{control}/phases/DESIGN/release"
    for body in ({"reason": ""}, {"reason": REASON}):
        refused = team["owner"].post(path, json=body)
        assert refused.status_code == 409
        assert refused.json()["detail"] == waits[UUID(control)]
    # Nor does accepting every request release evidence no attribute is judged against.
    accepted = accept_design_requests(team["owner"], team["org"], team["project"], control)
    summary: Any = accepted["design_requests"]
    assert (summary["settled"], summary["released"], summary["to_accept"]) == (False, False, 0)
    assert len(summary["uncovered"]) == count
    assert _rows(
        migrated,
        "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]
    # Planning the evidence again repairs the plan. The instance is a person's by now, so
    # the repair is proposed on it (its pending change), and their acceptance links it.
    with connect(migrated.url) as connection:
        generate(connection, None, org, project, UUID(control), owner)
        connection.commit()
        assert list(design_untraced(connection, project, UUID(control))) == [UUID(control)]
    repaired = accept_design_requests(team["owner"], team["org"], team["project"], control)
    assert repaired["design_requests"]["uncovered"] == []  # type: ignore[index]
    with connect(migrated.url) as connection:
        assert design_untraced(connection, project, UUID(control)) == {}
    assert all(row[1:] == (count, count) for row in _instances(migrated, control))
    # Every attribute addressed and every request accepted: that acceptance released it.
    status = _design(team, control)
    assert (status["step"], status["early"], status["automatic"]) == ("RELEASED", False, True)


def test_only_a_live_design_item_counts_as_evidencing_an_attribute(migrated: Database) -> None:
    """A waived item will not be obtained, and an addition proposed on an approved plan has
    not been accepted: neither evidences an attribute, so neither clears the hold.
    (12 November 2026, B1f: the hold's sentence is the per-attribute one; the rule for what
    counts as live is unchanged.)"""
    team = _launched(migrated, "dt-live")
    control = str(_control(team, AC02)["id"])
    project = UUID(str(team["project"]))
    settle_attributes(migrated, team["project"])
    count = _approved_count(migrated, control)
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
        assert list(waits) == [UUID(control)]
        assert (
            f"{count} approved attributes are not addressed by any D&I request"
            in (waits[UUID(control)])
        )


# The planner proposes which attributes every D&I request addresses (product owner, 12
# November 2026: "Planner proposes links"), for every kind of control.

_A = "The record shows who performed the control and when"
_B = "The record was approved by an authorized person before the change took effect"
_RIGHTS = "Access to change the setting is restricted to named administrators"

# One control per kind the planner tells apart (evidence_planning.traits_of): the four
# profiles, through the control families a SOX engagement holds.
PROFILES: dict[str, tuple[PlanFacts, str]] = {
    "ITGC access, run over a population": (
        PlanFacts(
            control_ref="ITGC-AC-02",
            title="Leaver access is removed",
            domain="ACCESS",
            activity="IT removes a leaver's access when HR records the termination.",
            risk="A leaver keeps access.",
            frequency="EVENT_DRIVEN",
            nature="MANUAL",
            attributes=(_A, _B),
            applications=("SAP ERP",),
            classifications=("ITGC",),
            period_end=date(2026, 12, 31),
        ),
        "POPULATION",
    ),  # fmt: skip
    "ITGC change management": (
        PlanFacts(
            control_ref="ITGC-CM-01",
            title="Changes are tested and approved",
            domain="CHANGE",
            activity="Changes are requested, tested, and approved before they reach production.",
            risk="An unapproved change reaches production.",
            frequency="EVENT_DRIVEN",
            nature="MANUAL",
            attributes=(_A, _B),
            applications=("SAP ERP",),
            classifications=("ITGC",),
            period_end=date(2026, 12, 31),
        ),
        "POPULATION",
    ),  # fmt: skip
    "ITGC operations": (
        PlanFacts(
            control_ref="ITGC-OP-01",
            title="Failed jobs are resolved",
            domain="OPERATIONS",
            activity="Failed batch jobs are logged as incidents and resolved by IT operations.",
            risk="A failed job leaves data incomplete.",
            frequency="EVENT_DRIVEN",
            nature="MANUAL",
            attributes=(_A, _B),
            applications=("SAP ERP",),
            classifications=("ITGC",),
            period_end=date(2026, 12, 31),
        ),
        "POPULATION",
    ),  # fmt: skip
    "configured ITGC": (
        PlanFacts(
            control_ref="ITGC-AC-07",
            title="MFA is enforced",
            domain="ACCESS",
            activity="Multi-factor authentication is enforced by the identity provider for "
            "every privileged account.",
            risk="A stolen password gives privileged access.",
            frequency="RECURRING",
            nature="AUTOMATED",
            attributes=(_A, _RIGHTS),
            applications=("SAP ERP",),
            classifications=("ITGC",),
            period_end=date(2026, 12, 31),
        ),
        "CONFIGURATION",
    ),  # fmt: skip
    "ITAC": (
        PlanFacts(
            control_ref="ITAC-01",
            title="Three-way match",
            domain="ITAC",
            activity="The system blocks payment of an invoice that fails the three-way match.",
            risk="An invoice is paid for goods not received.",
            frequency="RECURRING",
            nature="AUTOMATED",
            attributes=(_A, _RIGHTS),
            applications=("SAP ERP",),
            classifications=("AUTOMATED_APPLICATION",),
            period_end=date(2026, 12, 31),
        ),
        "CONFIGURATION",
    ),  # fmt: skip
    "key report (IPE)": (
        PlanFacts(
            control_ref="IPE-01",
            title="Revenue by customer report",
            domain="IPE",
            activity="The revenue by customer report is produced from the ledger each month.",
            risk="The report is incomplete or inaccurate.",
            frequency="MONTHLY",
            nature="IT_DEPENDENT_MANUAL",
            attributes=(_A, _B, _RIGHTS),
            applications=("Snowflake",),
            classifications=("KEY_REPORT",),
            period_end=date(2026, 12, 31),
        ),
        "REPORT",
    ),  # fmt: skip
    "business process control": (
        PlanFacts(
            control_ref="PTP-03",
            title="Vendor changes are approved",
            domain="PROCURE_TO_PAY",
            activity="A change to a vendor's bank details is approved by the AP supervisor.",
            risk="A payment is diverted.",
            frequency="EVENT_DRIVEN",
            nature="MANUAL",
            attributes=(_A, _B),
            applications=("SAP ERP",),
            classifications=("BUSINESS_PROCESS",),
            process_required=True,
            process_confirmed=True,
            period_end=date(2026, 12, 31),
        ),
        "POPULATION",
    ),  # fmt: skip
    "management review control": (
        PlanFacts(
            control_ref="RTR-02",
            title="Monthly flux review",
            domain="RECORD_TO_REPORT",
            activity="The controller reviews the monthly balance sheet flux analysis and "
            "investigates variances over 50,000.",
            risk="A misstatement goes unnoticed.",
            frequency="MONTHLY",
            nature="MANUAL",
            attributes=(_A, _B),
            applications=("SAP ERP",),
            classifications=("BUSINESS_PROCESS",),
            process_required=True,
            process_confirmed=True,
            period_end=date(2026, 12, 31),
        ),
        "MANAGEMENT_REVIEW",
    ),  # fmt: skip
}


def _design_of(plan: PlanOutput) -> list[RequirementPlan]:
    return list(next(phase for phase in plan.phases if phase.phase == "DESIGN").requirements)


def _named(requirements: list[RequirementPlan]) -> set[str]:
    return {text for requirement in requirements for text in requirement.attributes}


def _as_a_model_that_names_none(facts: PlanFacts, instance: bool) -> dict[str, Any]:
    """The plan as a planner agent could return it: sound in every phase, its D&I items
    naming no attribute; with or without an item that shows the control performed once."""
    output: dict[str, Any] = rules_plan(facts).model_dump(mode="json", exclude_none=True)
    design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
    kept = []
    for requirement in design["requirements"]:
        categories = [c for c in requirement["categories"] if instance or c != "CONTROL_EXECUTION"]
        if not categories:
            continue
        kept.append({**requirement, "categories": categories, "attributes": []})
    assert kept, "the design phase keeps an item"
    design["requirements"] = kept
    return output


@pytest.mark.parametrize("name", sorted(PROFILES))
def test_no_approved_attribute_is_left_unaddressed_at_d_and_i_for_any_kind_of_control(
    name: str,
) -> None:
    facts, profile = PROFILES[name]
    assert traits_of(facts).profile == profile
    wanted = set(facts.attributes)
    # The rules' plan, as it comes and after the check: every attribute is named by a D&I
    # item, and nothing but the control's approved attributes is.
    for plan in (rules_plan(facts), check_plan(rules_plan(facts), facts)):
        assert _named(_design_of(plan)) == wanted, name
    # A planner agent that names none: the check proposes them, on the item that shows the
    # control performed once when there is one (it is read against every attribute)...
    with_instance = _design_of(check_plan(_as_a_model_that_names_none(facts, True), facts))
    assert _named(with_instance) == wanted
    for requirement in with_instance:
        if "CONTROL_EXECUTION" in requirement.categories:
            assert set(requirement.attributes) == wanted
    # ...and otherwise on the item that evidences this kind of control: the report's
    # definition, the setting, the policy or procedure. No item is invented.
    model = _as_a_model_that_names_none(facts, False)
    before = [
        r["key"] for r in next(p for p in model["phases"] if p["phase"] == "DESIGN")["requirements"]
    ]
    without = _design_of(check_plan(model, facts))
    assert _named(without) == wanted
    assert {r.key for r in without} <= set(before)
    carriers = [r for r in without if r.attributes]
    assert carriers and any(DESIGN_CARRIER[profile] in r.categories for r in carriers)
    # In the control's order, each attribute once.
    for requirement in carriers:
        order = [facts.attributes.index(text) for text in requirement.attributes]
        assert order == sorted(set(order))


def test_an_attribute_about_who_can_change_it_goes_to_that_item_and_the_rest_to_the_setting() -> (
    None
):
    """The mapping, where the plan has the item of its own: an attribute about who can
    change the setting joins "who can change the setting"; every other one, the setting."""
    facts, _profile = PROFILES["configured ITGC"]
    model = _as_a_model_that_names_none(facts, False)
    design = _design_of(check_plan(model, facts))
    rights = next(r for r in design if "change" in r.key)
    setting = next(r for r in design if r is not rights)
    assert rights.attributes == [_RIGHTS]
    assert setting.attributes == [_A] and "CONFIGURATION" in setting.categories
    # A key report's items travel as one request: the report's definition carries them all.
    report, _ = PROFILES["key report (IPE)"]
    carried = _design_of(check_plan(rules_plan(report), report))
    assert [r.key for r in carried] == ["design-report-logic"]
    assert carried[0].attributes == [_A, _B, _RIGHTS]
    assert "REPORT_RELIABILITY" in carried[0].categories


def test_an_excepted_attribute_is_left_alone_and_an_unapproved_one_is_ignored() -> None:
    report, _ = PROFILES["key report (IPE)"]
    # A person recorded why _B is not evidenced at D&I: the planner proposes no item for it.
    excepted = replace(report, design_excepted=(_B,))
    for plan in (rules_plan(excepted), check_plan(rules_plan(excepted), excepted)):
        assert _named(_design_of(plan)) == {_A, _RIGHTS}
    assert _named(
        _design_of(check_plan(_as_a_model_that_names_none(excepted, False), excepted))
    ) == {
        _A,
        _RIGHTS,
    }
    # The planner agent names an attribute the control does not have approved on a D&I
    # item: the name is ignored, the plan is kept, and the approved ones are still proposed.
    model = _as_a_model_that_names_none(report, False)
    design = next(phase for phase in model["phases"] if phase["phase"] == "DESIGN")
    design["requirements"][0]["attributes"] = [_A, "An attribute nobody approved"]
    checked = _design_of(check_plan(model, report))
    assert _named(checked) == {_A, _B, _RIGHTS}
    # An operating item naming one is still refused: only the D&I proposal is lenient.
    model = _as_a_model_that_names_none(report, False)
    interim = next(phase for phase in model["phases"] if phase["phase"] == "INTERIM")
    interim["requirements"][0]["attributes"] = ["An attribute nobody approved"]
    with pytest.raises(ValueError, match="names an attribute the control does not have"):
        check_plan(model, report)


def _as_a_key_report(migrated: Database, control: str) -> None:
    """The launched control as a key report of the client's own: no library suite, the
    KEY_REPORT classification, so the planner plans it as one (the REPORT profile)."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls c SET classifications = ARRAY['KEY_REPORT'], "
            "test_basis = 'CLIENT', test_basis_at = clock_timestamp(), "
            "test_basis_by = (SELECT owner_user_id FROM projects WHERE id = c.project_id) "
            "WHERE c.id = %s",
            (control,),
        )
        connection.commit()


def _links(migrated: Database, requirement_id: Any) -> set[str]:
    return {
        str(row[0])
        for row in _rows(
            migrated,
            "SELECT attribute_id FROM evidence_requirement_attributes WHERE requirement_id = %s",
            UUID(str(requirement_id)),
        )
    }


def _design_rows(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, requirement_key, status, pending_change, accepted_at, attributes "
        "FROM evidence_requirements WHERE engagement_control_id = %s AND phase = 'DESIGN' "
        "AND status <> 'REMOVED' ORDER BY created_at, requirement_key",
        UUID(control),
    )


def test_every_launched_control_is_planned_with_its_attributes_addressed_at_d_and_i(
    migrated: Database,
) -> None:
    """The stored plans, for every control of a launched engagement and for one planned as
    a key report: after the rules plan the evidence, and after a planner agent that names no
    attribute on any D&I item does, no approved attribute is left unaddressed."""
    team = _launched(migrated, "dt-every-control")
    org, project, owner = UUID(str(team["org"])), UUID(str(team["project"])), team["owner_id"]
    settle_attributes(migrated, team["project"])
    report = str(_control(team, AC02)["id"])
    _as_a_key_report(migrated, report)
    with connect(migrated.url) as connection:
        controls = [
            UUID(str(row[0]))
            for row in connection.execute(
                "SELECT p.engagement_control_id FROM evidence_plans p "
                "JOIN engagement_controls c ON c.id = p.engagement_control_id "
                "WHERE p.project_id = %s AND c.included ORDER BY c.control_ref",
                (project,),
            ).fetchall()
        ]
        assert len(controls) >= 3
        assert traits_of(load_facts(connection, project, UUID(report))).profile == "REPORT"
        for control in controls:
            generate(connection, None, org, project, control, owner)
            connection.commit()
        assert uncovered_attributes(connection, project) == {}
        # A planner agent that names none: the check proposes them all the same.
        profiles = set()
        for control in controls:
            facts = load_facts(connection, project, control)
            profiles.add(traits_of(facts).profile)
            output = _as_a_model_that_names_none(facts, True)
            generate(connection, _Planner(output), org, project, control, owner)
            connection.commit()
        assert uncovered_attributes(connection, project) == {}
        assert "REPORT" in profiles and len(profiles) >= 2
        # The agent's plans were kept as the agent's (not replaced by the rules').
        assert connection.execute(
            "SELECT source FROM evidence_plans WHERE engagement_control_id = %s", (report,)
        ).fetchone() == ("MODEL",)
    # Proposed, not decided: no request is accepted by it, and nothing is released.
    assert _rows(
        migrated,
        "SELECT count(*) FROM evidence_requirements WHERE project_id = %s "
        "AND accepted_at IS NOT NULL",
        team["project"],
    ) == [(0,)]
    assert _rows(
        migrated, "SELECT count(*) FROM phase_releases WHERE project_id = %s", team["project"]
    ) == [(0,)]


def test_the_links_the_planner_proposes_for_a_key_report_are_a_proposal_until_accepted(
    migrated: Database,
) -> None:
    """The key report's D&I request names no attribute as the plan first stood (the case the
    product owner decided: "Planner proposes links"). Planned again, the planner proposes
    them: written on a request nobody accepted, which stays "to accept"; on an accepted one
    only through its pending change; never for an attribute a person excepted; and an
    attribute that is not approved is ignored."""
    team = _launched(migrated, "dt-report-links")
    owner_client = team["owner"]
    control = str(_control(team, AC02)["id"])
    org, project, owner = UUID(str(team["org"])), UUID(str(team["project"])), team["owner_id"]
    settle_attributes(migrated, team["project"])
    tailor_criteria(migrated, team["project"])
    _as_a_key_report(migrated, control)
    approved = _rows(
        migrated,
        "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'APPROVED' ORDER BY position, created_at",
        UUID(control),
    )
    ids = {str(row[0]) for row in approved}
    assert len(ids) >= 2
    # A plan made before this: the report's request, naming and linked to no attribute.
    with connect(migrated.url) as connection:
        generate(connection, None, org, project, UUID(control), owner)
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
        # Nothing is rewritten by itself: the wait stands until the evidence is planned again.
        assert len(uncovered_attributes(connection, project, UUID(control))[UUID(control)]) == len(
            ids
        )
        generate(connection, None, org, project, UUID(control), owner)
        connection.commit()
        assert uncovered_attributes(connection, project, UUID(control)) == {}
    rows = _design_rows(migrated, control)
    assert [row[1] for row in rows] == ["design-report-logic"]
    request, _key, _status, pending, accepted_at, named = rows[0]
    # Proposed: linked to every approved attribute, and still the agent's, to accept.
    assert _links(migrated, request) == ids and named == [row[1] for row in approved]
    assert pending is None and accepted_at is None
    assert _rows(
        migrated,
        "SELECT DISTINCT origin FROM evidence_requirement_attributes WHERE requirement_id = %s",
        request,
    ) == [("RULES",)]
    body = next(
        item
        for phase in owner_client.get(f"{_project(team)}/controls/{control}/evidence-plan").json()[
            "phases"
        ]
        if phase["phase"] == "DESIGN"
        for item in phase["requirements"]
        if item["id"] == str(request)
    )
    assert (body["to_accept"], body["accepted"], set(body["attribute_ids"])) == (True, False, ids)
    # A person accepts the request, with the attributes it shows.
    with connect(migrated.url) as connection:
        accept(
            connection, org, project, UUID(control), owner,
            RequestsAccepted(
                items=[RequestAccepted(requirement_id=request, version=body["version"])]
            ),
        )  # fmt: skip
        # Two attributes are approved afterwards; a person excepts the second from D&I.
        for text in (NEW, LATER):
            add_attribute(connection, org, project, UUID(control), owner, AttributeAdd(text=text))
        connection.commit()
    new_id, later_id = (
        str(
            _rows(
                migrated,
                "SELECT id FROM control_attributes WHERE engagement_control_id = %s AND text = %s",
                UUID(control),
                text,
            )[0][0]
        )
        for text in (NEW, LATER)
    )
    excepted = owner_client.put(
        f"{_project(team)}/controls/{control}/design-coverage/{later_id}/exception",
        json={"reason": "Evidenced at interim only: tested on each month's report run."},
    )
    assert excepted.status_code == 200, excepted.text
    # Planned again: the accepted request is not relinked. The new attribute is proposed in
    # its pending change; the excepted one is not proposed at all.
    with connect(migrated.url) as connection:
        generate(connection, None, org, project, UUID(control), owner)
        connection.commit()
    held = _design_rows(migrated, control)[0]
    assert _links(migrated, request) == ids
    assert held[4] is not None and isinstance(held[3], dict)
    assert held[3]["attributes"] == [*[row[1] for row in approved], NEW]
    with connect(migrated.url) as connection:
        assert uncovered_attributes(connection, project, UUID(control)) == {
            UUID(control): [UUID(new_id)]
        }
        # The planner agent names the excepted attribute, and one nobody approved: the
        # first is left alone, the second ignored; the plan is the agent's, not the rules'.
        output = _as_a_model_that_names_none(load_facts(connection, project, UUID(control)), False)
        design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        design["requirements"][0]["attributes"] = [LATER, "An attribute nobody approved"]
        generate(connection, _Planner(output), org, project, UUID(control), owner)
        connection.commit()
        assert connection.execute(
            "SELECT source FROM evidence_plans WHERE engagement_control_id = %s", (control,)
        ).fetchone() == ("MODEL",)
    assert _links(migrated, request) == ids
    proposed = _design_rows(migrated, control)[0][3]
    assert "An attribute nobody approved" not in proposed["attributes"]
    assert NEW in proposed["attributes"]
    assert _rows(
        migrated,
        "SELECT count(*) FROM design_coverage_exceptions WHERE attribute_id = %s",
        UUID(later_id),
    ) == [(1,)]
    # The person accepts the change: the new attribute is linked; the excepted one is not,
    # whatever the planner named, and its exception stands.
    version = _rows(migrated, "SELECT version FROM evidence_requirements WHERE id = %s", request)[
        0
    ][0]
    with connect(migrated.url) as connection:
        accept(
            connection, org, project, UUID(control), owner,
            RequestsAccepted(items=[RequestAccepted(requirement_id=request, version=version)]),
        )  # fmt: skip
        connection.commit()
        assert uncovered_attributes(connection, project, UUID(control)) == {}
    assert _links(migrated, request) == ids | {new_id}
    assert _rows(
        migrated,
        "SELECT count(*) FROM design_coverage_exceptions WHERE attribute_id = %s",
        UUID(later_id),
    ) == [(1,)]
    # On a request nobody accepted the same holds: the planner's naming of an excepted
    # attribute never links it, and never withdraws what the person recorded.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET accepted_by = NULL, accepted_at = NULL WHERE id = %s",
            (request,),
        )
        connection.commit()
        output = _as_a_model_that_names_none(load_facts(connection, project, UUID(control)), False)
        design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        design["requirements"][0]["attributes"] = [LATER]
        generate(connection, _Planner(output), org, project, UUID(control), owner)
        connection.commit()
    assert later_id not in _links(migrated, request)
    assert _links(migrated, request) == ids | {new_id}
    assert _rows(
        migrated,
        "SELECT count(*) FROM design_coverage_exceptions WHERE attribute_id = %s",
        UUID(later_id),
    ) == [(1,)]
    assert _rows(
        migrated,
        "SELECT count(*) FROM audit_events WHERE action = 'design_coverage.exception_cleared' "
        "AND target_id = %s",
        UUID(later_id),
    ) == [(0,)]
