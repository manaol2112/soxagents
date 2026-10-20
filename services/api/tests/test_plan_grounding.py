"""Master test plans, milestone B: the planner's understanding, procedures, attributes, and
evidence are grounded in the records. What a record states is quoted with its source;
what none states is missing, with a question, never filled in. Procedures link to the
attributes they test, requirements to the procedures they serve. A planner that cites a
standard, offers a prior year's work as proof, states a threshold no record gives, or
quotes a source that does not say it is rejected; criteria a tester could not apply are
left for a person."""

from dataclasses import replace
from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_evidence_planning import (
    _access_review,
    _change_approval,
    _facts,
    _management_review,
    _mfa,
    _report_review,
)
from test_evidence_plans import _Planner
from test_outbound import migrated
from test_planning_gate import _control, _launched, _project, _rows

from ai_workforce_api.control_statements import SLOT
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import PlanFacts, check_plan, rules_plan
from ai_workforce_api.evidence_plans import generate, load_facts
from ai_workforce_api.statement_registry import statement_for

__all__ = ["migrated"]


def _provisioning() -> PlanFacts:
    return _facts(
        control_ref="ITGC-AC-01",
        title="New access is approved before it is granted",
        activity="Access requests are approved by the system owner before access is granted.",
        attributes=(
            "The request was approved before access was granted",
            "The approver was authorised to approve",
        ),
    )


REPRESENTATIVE = {
    "user access provisioning": _provisioning,
    "user access review": _access_review,
    "change management": _change_approval,
    "automated configuration control": _mfa,
    "IT-dependent manual control": _report_review,
    "management review": _management_review,
}


@pytest.mark.parametrize("name", sorted(REPRESENTATIVE))
def test_each_kind_of_control_is_planned_with_linked_operating_procedures(name: str) -> None:
    facts = REPRESENTATIVE[name]()
    plan = check_plan(rules_plan(facts), facts)
    assert plan.understanding.summary and plan.phases and plan.criteria == []
    for phase in plan.phases:
        if phase.phase == "DESIGN":
            # Design procedures assess the design against the risk: no attribute link.
            assert phase.procedures and phase.links == []
            continue
        # Each operating phase has a procedure that tests the control's own attributes.
        tested = {text for link in phase.links for text in link.attributes}
        assert tested and tested <= set(facts.attributes), name
        assert {link.procedure for link in phase.links} <= set(phase.procedures)
    # The rules' plan, given as the model's, passes the same checks: nothing in it is
    # invented.
    check_plan(plan.model_dump(mode="json", exclude_none=True), facts)


def _as_model(facts: PlanFacts) -> dict[str, Any]:
    return rules_plan(facts).model_dump(mode="json", exclude_none=True)


def _interim(data: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = next(p for p in data["phases"] if p["phase"] == "INTERIM")
    return found


def test_the_planner_cannot_invent_what_the_records_do_not_say() -> None:
    facts = _provisioning()
    # A threshold no record gives.
    data = _as_model(facts)
    _interim(data)["requirements"][0]["description"] += " Access is granted within 5 days."
    with pytest.raises(ValueError, match="threshold or deadline"):
        check_plan(data, facts)
    # The same deadline is fine where the control states it.
    stated = replace(facts, activity=facts.activity + " Within 5 days.")
    data = _as_model(stated)
    _interim(data)["requirements"][0]["description"] += " Access is granted within 5 days."
    check_plan(data, stated)
    # A citation of a standard.
    data = _as_model(facts)
    _interim(data)["procedures"].append("Test the control as PCAOB AS 2201 requires.")
    with pytest.raises(ValueError, match="cites a standard"):
        check_plan(data, facts)
    # A prior year's work as proof of operation now.
    data = _as_model(facts)
    _interim(data)["rationale"] = (
        "The prior-year workpapers show the control operated effectively, so a smaller "
        "sample is enough."
    )
    with pytest.raises(ValueError, match="prior-year"):
        check_plan(data, facts)
    # A fact said to come from the records must quote them.
    data = _as_model(facts)
    data["understanding"]["facts"] = [
        {
            "field": "PERFORMER",
            "value": "The IT service desk",
            "basis": "SOURCE",
            "quote": "The IT service desk grants access.",
        },  # fmt: skip
    ]
    with pytest.raises(ValueError, match="quotes a source"):
        check_plan(data, facts)
    data["understanding"]["facts"][0]["quote"] = "approved by the system owner"
    assert check_plan(data, facts).understanding.facts[0].basis == "SOURCE"
    # A proposal is allowed, as a proposal.
    data["understanding"]["facts"] = [
        {"field": "PERFORMER", "value": "The IT service desk", "basis": "PROPOSED"},
    ]
    check_plan(data, facts)


def test_links_and_criteria_name_only_the_controls_own_procedures_and_attributes() -> None:
    facts = _provisioning()
    data = _as_model(facts)
    _interim(data)["links"].append(
        {"procedure": "A procedure the phase does not have.", "attributes": []}
    )
    with pytest.raises(ValueError, match="procedure the phase does not have"):
        check_plan(data, facts)
    data = _as_model(facts)
    _interim(data)["links"][0]["attributes"] = ["An attribute of another control"]
    with pytest.raises(ValueError, match="attribute the control does not have"):
        check_plan(data, facts)
    # Criteria a tester can apply are kept; vague ones are left for a person.
    data = _as_model(facts)
    data["criteria"] = [
        {
            "attribute": facts.attributes[0],
            "condition": "The request's approval date is on or before the grant date.",
            "pass_criteria": "An approval dated on or before the grant date is on the request.",
            "fail_criteria": "No approval, or an approval dated after the grant date.",
            "automatable": True,
        },
        {
            "attribute": facts.attributes[1],
            "condition": "The approver was appropriate for the access requested.",
            "pass_criteria": "The approval was adequate and timely.",
            "fail_criteria": "The approval was not appropriate.",
        },
    ]
    checked = check_plan(data, facts)
    assert [item.attribute for item in checked.criteria] == [facts.attributes[0]]
    assert any(facts.attributes[1][:40] in text for text in checked.missing_information)
    data["criteria"][0]["attribute"] = "Not an attribute of this control"
    with pytest.raises(ValueError, match="attribute the control does not have"):
        check_plan(data, facts)


def _master(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/controls/{control}/master-plan")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def test_the_understanding_says_where_each_fact_comes_from(migrated: Database) -> None:
    team = _launched(migrated, "grounding-facts")
    control = _control(team, "ITGC-AC-01")["id"]
    plan = _master(team, control)
    facts = {item["field"]: item for item in plan["facts"]}
    assert set(facts) >= {
        "OBJECTIVE", "RISK", "DESCRIPTION", "NATURE", "TYPE", "FREQUENCY", "PERFORMER",
        "REVIEWER", "SYSTEM", "POPULATION", "ASSERTIONS", "DEPENDENCIES",
    }  # fmt: skip
    for item in plan["facts"]:
        assert item["basis"] in ("SOURCE", "PROPOSED", "JUDGMENT", "ASSUMPTION", "MISSING")
        if item["basis"] == "MISSING":
            assert item["question"], item
    assert facts["FREQUENCY"]["basis"] == "SOURCE" and facts["FREQUENCY"]["quote"]
    assert facts["SYSTEM"]["value"] == "SAP ERP" and facts["SYSTEM"]["basis"] == "SOURCE"
    # The library's design names the performer by a client value not yet recorded: it is
    # missing, with the question, not filled in.
    performer = facts["PERFORMER"]
    assert performer["basis"] == "MISSING" and "[" in performer["value"]
    assert any(b["detail"].startswith("Performed by:") for b in plan["blockers"])
    assert plan["state"] == "NEEDS_CLARIFICATION"
    # The snapshot a reviewer approves holds the facts as they were.
    assert plan["content_hash"]
    # Recording the client's value answers it. Filling a value the plan left in brackets is
    # not a revision (migration 0086, decided by the product owner); the snapshot a
    # reviewer approves holds it.
    statement = statement_for("access-provisioning")
    assert statement is not None
    keys = set(SLOT.findall(statement.operator))
    assert keys
    filled = team["owner"].put(
        f"{_project(team)}/controls/{control}/values",
        json={"values": {key: "IT access administrator" for key in keys}},
    )
    assert filled.status_code == 200, filled.text
    after = _master(team, control)
    performer = next(item for item in after["facts"] if item["field"] == "PERFORMER")
    assert performer["basis"] == "SOURCE" and "IT access administrator" in performer["value"]
    assert after["revision"] == plan["revision"]
    assert after["content_hash"] != plan["content_hash"]


def test_planning_again_links_procedures_and_evidence(migrated: Database) -> None:
    team = _launched(migrated, "grounding-replan")
    owner = team["owner"]
    # A control whose attributes are settled can be approved; ITGC-AC-01 is checked below.
    approved_control = next(
        row["id"]
        for row in owner.get(f"{_project(team)}/workspace/controls").json()
        if row["included"] and row["control_ref"] != "ITGC-AC-01" and row["attributes_settled"]
    )
    # The plans carried over by migration 0079 had no links; one plan is approved first.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM plan_procedure_attributes WHERE engagement_control_id IN "
            "(SELECT id FROM engagement_controls WHERE project_id = %s)",
            (team["project"],),
        )
        connection.commit()
    plan = owner.get(f"{_project(team)}/controls/{approved_control}/evidence-plan").json()
    approved = owner.post(
        f"{_project(team)}/controls/{approved_control}/evidence-plan/approve",
        json={"version": plan["version"]},
    )
    assert approved.status_code == 200, approved.text
    replanned = owner.post(f"{_project(team)}/evidence-plans/replan")
    assert replanned.status_code == 200, replanned.text
    assert replanned.json()["skipped"] == 1 and replanned.json()["planned"] > 0
    # An approved plan is left as approved.
    assert _master(team, approved_control)["state"] == "APPROVED"
    control = _control(team, "ITGC-AC-01")["id"]
    body = _master(team, control)
    kinds = {item["kind"] for item in body["findings"]}
    assert "PROCEDURE_WITHOUT_ATTRIBUTE" not in kinds
    operating = [p for p in body["procedures"] if p["phase"] != "DESIGN" and p["attribute_codes"]]
    assert operating
    # Evidence serves the procedures that test the attributes it supports.
    linked = [e for e in body["evidence"] if e["attribute_codes"]]
    assert linked and any(e["procedure_codes"] for e in linked)
    for item in linked:
        for code in item["procedure_codes"]:
            procedure = next(p for p in body["procedures"] if p["code"] == code)
            assert procedure["phase"] == item["phase"]
            assert set(procedure["attribute_codes"]) & set(item["attribute_codes"])
    assert _rows(
        migrated,
        "SELECT count(*) FROM audit_events WHERE project_id = %s "
        "AND action = 'evidence_plans.replanned'",
        team["project"],
    ) == [(1,)]


def test_the_agents_criteria_never_replace_a_persons(migrated: Database) -> None:
    team = _launched(migrated, "grounding-criteria")
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    base = f"{_project(team)}/controls/{control}"
    # An attribute of the client's own, which no library definition covers.
    added = owner.post(
        f"{base}/attributes", json={"text": "The access granted matches the request"}
    )
    assert added.status_code == 200, added.text
    own = "The access granted matches the request"
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(control))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        output["criteria"] = [
            {
                "attribute": own,
                "condition": "The roles granted are the roles named on the approved request.",
                "pass_criteria": "Every role granted is named on the approved request.",
                "fail_criteria": "A role was granted that the approved request does not name.",
                "automatable": True,
            }
        ]
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
    plan = _master(team, control)
    mine = next(a for a in plan["attributes"] if a["text"] == own)
    assert mine["criteria_source"] == "AGENT" and mine["automatable"] is True
    # A person states the criteria; the agent's next run does not replace them.
    stated = owner.post(
        f"{base}/master-plan/attributes/{mine['id']}/criteria",
        json={
            "version": mine["version"],
            "condition": "Each role granted appears on the approved request.",
            "pass_criteria": "All roles granted are on the approved request.",
            "fail_criteria": "Any role granted is not on the approved request.",
            "judgment_required": False,
        },
    )
    assert stated.status_code == 200, stated.text
    with connect(migrated.url) as connection:
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
    after = next(a for a in _master(team, control)["attributes"] if a["text"] == own)
    assert after["criteria_source"] == "PLAN"
    assert after["condition"] == "Each role granted appears on the approved request."
    # A library-defined attribute keeps the library's criteria.
    library = next(
        a for a in _master(team, control)["attributes"] if a["criteria_source"] == "LIBRARY"
    )
    assert library["condition"]


def _client_control(migrated: Database, team: dict[str, Any], ref: str) -> str:
    """One of the engagement's controls as a client's own (as one the team adds), with no test
    attribute stated: the placeholder an import writes, and no standard followed."""
    control = _control(team, ref)["id"]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET source = 'MANUAL', library_key = %s, "
            "test_basis = NULL, test_attributes = %s::jsonb WHERE id = %s",
            (
                f"upload:test:{ref}",
                '["The control operated as described in the control activity."]',
                control,
            ),
        )
        generate(
            connection, None, UUID(str(team["org"])), UUID(str(team["project"])),
            UUID(control), UUID(str(team["owner_id"])),
        )  # fmt: skip
    return str(control)


def test_the_team_describes_a_client_control_the_rcm_leaves_undescribed(
    migrated: Database,
) -> None:
    """Decided by the product owner: a client's own control's missing facts are stated by
    the team in one place (migration 0088), the planner's proposals confirmed there, and a
    control with no test attributes is offered the standard it matches."""
    team = _launched(migrated, "grounding-describe")
    control = _client_control(migrated, team, "ITGC-AC-01")
    path = f"{_project(team)}/controls/{control}/master-plan"
    plan = team["owner"].get(path).json()
    asked = {b["detail"].split(":")[0] for b in plan["blockers"] if b["resolve"] == "FACTS"}
    assert {"Preventive or detective", "Performed by", "Reviewed or approved by"} <= asked
    assert not [b for b in plan["blockers"] if b["resolve"] == "VALUES"]
    objective = next(f for f in plan["facts"] if f["field"] == "OBJECTIVE")
    assert objective["basis"] == "PROPOSED"
    # The RCM states no test attribute: the standard the control matches is offered.
    assert plan["suggested_standard"]["library_key"] == "access-provisioning"
    assert plan["suggested_standard"]["status"] == "STRONG"
    stated = team["owner"].put(
        f"{path}/facts",
        json={
            "facts": {
                "TYPE": "preventive",
                "PERFORMER": "IT Security Administrator",
                "ASSERTIONS": "Existence or occurrence; Accuracy",
                "OBJECTIVE": objective["value"],
            }
        },  # fmt: skip
    )
    assert stated.status_code == 200, stated.text
    facts = {f["field"]: f for f in stated.json()["facts"]}
    assert facts["TYPE"]["value"] == "Preventive" and facts["TYPE"]["basis"] == "SOURCE"
    assert facts["PERFORMER"]["source"].startswith("Stated by")
    assert facts["OBJECTIVE"]["basis"] == "SOURCE"
    left = {b["detail"].split(":")[0] for b in stated.json()["blockers"]
            if b["resolve"] == "FACTS"}  # fmt: skip
    assert left == {"Reviewed or approved by"}
    for wrong in ({"TYPE": "sometimes"}, {"RISK": "Anything"}):
        assert team["owner"].put(f"{path}/facts", json={"facts": wrong}).status_code == 422
    # Approved, then a missing fact stated: the approval stands (as a filled client value);
    # a stated fact changed: the plan goes back for review.
    approved = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": stated.json()["version"]},
    )
    assert approved.status_code == 200, approved.text
    filled = team["owner"].put(f"{path}/facts", json={"facts": {"REVIEWER": "IT Manager"}})
    assert filled.json()["status"] == "APPROVED"
    changed = team["owner"].put(f"{path}/facts", json={"facts": {"PERFORMER": "Help desk"}})
    assert changed.json()["status"] != "APPROVED"
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'control.facts_stated' "
            "AND target_id = %s",
            (control,),
        ).fetchone()
    assert row == (3,)
