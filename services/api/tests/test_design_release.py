"""D&I evidence with its own release (B1; decided by the product owner on 8 November 2026,
docs/control-workflow-plan.md). The Design phase's evidence is requested once a person
releases it for the control, after Control Understanding, and not with the test plan's
approval. The test plan's approval gates only the operating phases, so revising the plan does
not hold D&I requests. Each request still needs its own approval to be sent; a release sends
nothing, and the agents never release a phase."""

from typing import Any
from uuid import UUID

from support import (
    Database,
    answer_walkthrough,
    approve_evidence_plans,
    settle_attributes,
    tailor_criteria,
)
from test_evidence_plans import _Planner
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _plan, _project, _rows

from ai_workforce_api.control_design import ValuesBody, design_for, set_values
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.evidence_plans import (
    GATE_DESIGN_RELEASE,
    GATE_PLAN,
    _write_criteria,
    gate_reason,
    generate,
    held_for_planning,
    load_facts,
    unrequested_controls,
)
from ai_workforce_api.testing_engine import tailored_criteria

__all__ = ["migrated"]

REASON = "The walkthrough is booked for this week, before the open question is answered."


def _design(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/phase-progress")
    assert read.status_code == 200, read.text
    row = next(item for item in read.json()["controls"] if item["control_id"] == control)
    found: dict[str, Any] = next(item for item in row["phases"] if item["phase"] == "DESIGN")
    return found


def _requests(migrated: Database, control: str, phase: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, status FROM pbc_requests WHERE engagement_control_id = %s "
        "AND testing_phase = %s AND status <> 'CANCELLED'",
        UUID(control),
        phase,
    )


def test_d_and_i_evidence_is_released_on_its_own_once_the_control_is_understood(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-release")
    owner = team["owner"]
    control = _control(team, "ITGC-AC-01")["id"]
    path = f"{_project(team)}/controls/{control}/phases/DESIGN/release"
    # Planned, not released: nothing of D&I is requested, and the plan is not approved.
    assert _plan(team, control)["status"] == "PROPOSED"
    assert _requests(migrated, control, "DESIGN") == []
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") == GATE_DESIGN_RELEASE
        assert gate_reason(connection, UUID(control), "INTERIM") == GATE_PLAN
    # An open question on the control: Control Understanding is not complete, so the
    # release is not recommended, and releasing it now needs the reason.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, resolve, fingerprint, raised_by
            )
            SELECT organization_id, project_id, id, 'PROCESS', 'MISSING', 'Walkthrough',
                   'Who approves an emergency change out of hours?',
                   'The design is assessed against who approves.', 'Answer it.',
                   'di-release-question', 'RULES'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING" and waiting["step_label"] == "Waiting for understanding"
    assert waiting["waiting_for"].startswith("Control Understanding is not complete")
    bare = owner.post(path, json={})
    assert bare.status_code == 409
    assert "Say why the D&I phase is released now" in bare.json()["detail"]
    # Only an Owner, Admin or Project Manager releases it.
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], "di-member@example.com", "CONTRIBUTOR")
        _add_project_member(connection, team["org"], team["project"], member)
    assert _session(migrated, member).post(path, json={"reason": REASON}).status_code == 403
    sent = _rows(
        migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
    )
    released = owner.post(path, json={"reason": REASON})
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert status["step"] == "RELEASED" and status["early"] is True
    assert status["reason"] == REASON and status["released_by"]
    # The D&I items are requested now, on a plan still not approved; nothing is sent, and the
    # operating evidence still waits for the plan.
    assert _plan(team, control)["status"] == "PROPOSED"
    design = _requests(migrated, control, "DESIGN")
    assert design and all(row[1] == "DRAFT" for row in design)
    assert _requests(migrated, control, "INTERIM") == []
    assert (
        _rows(
            migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
        )
        == sent
    )
    with connect(migrated.url) as connection:
        assert gate_reason(connection, UUID(control), "DESIGN") is None
        assert held_for_planning(connection, UUID(str(design[0][0]))) is None
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'phase.released'",
        UUID(control),
    )
    assert [row[0]["phase"] for row in audit] == ["DESIGN"] and audit[0][0]["early"] is True
    # Releasing again changes nothing and asks for nothing twice.
    again = owner.post(path, json={"reason": REASON})
    assert again.status_code == 200
    assert len(_requests(migrated, control, "DESIGN")) == len(design)
    assert _rows(
        migrated,
        "SELECT count(*) FROM phase_releases WHERE engagement_control_id = %s AND phase = 'DESIGN'",
        UUID(control),
    ) == [(1,)]


def test_a_understood_control_is_recommended_for_release_without_a_reason(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-ready")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    # Since 11 November 2026 settled attributes also carry criteria a person owns, tailored
    # to the control (before: deciding the proposals was enough). Rewritten for that rule.
    tailor_criteria(migrated, team["project"])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', "
            "resolution_note = 'Answered in the walkthrough.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND status = 'OPEN'",
            (control,),
        )
        connection.commit()
    # Unanswered client values hold it: each question Control Understanding asks counts,
    # not only those testing waits for (as the workflow's step reads it).
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING"
    assert waiting["waiting_for"].endswith("not answered.")
    with connect(migrated.url) as connection:
        design_body = design_for(connection, UUID(control))
        assert design_body is not None
        values = {
            slot.key: slot.options[0] if slot.options else "The IT security manager"
            for slot in design_body.slots
            if not slot.automatic and not slot.document and not slot.value.strip()
        }
        set_values(
            connection, team["org"], team["project"], UUID(control), team["owner_id"],
            ValuesBody(values=values),
        )  # fmt: skip
    # Rewritten 11 November 2026 (B1c, product owner: only required walkthrough questions
    # hold "Control Understanding complete"). Old: with the statement's values answered the
    # release was READY. New: it still waits for the required walkthrough questions, named
    # as such, and is READY once they are answered. Why: the walkthrough bank is now part of
    # Control Understanding, which the D&I release recommendation reads.
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING" and waiting["waiting_on"] == "UNDERSTANDING"
    assert waiting["waiting_for"].endswith("walkthrough questions are not answered.")
    answer_walkthrough(migrated, team["project"], [UUID(control)])
    design = _design(team, control)
    assert design["step"] == "READY", design
    progress = team["owner"].get(f"{_project(team)}/phase-progress").json()
    assert progress["ready"]["DESIGN"] >= 1
    assert progress["recommendation"].endswith("The D&I evidence is ready to release.")
    row = _control(team, "ITGC-AC-01")
    assert row["next_step"] == "Release the D&I evidence"
    released = team["owner"].post(
        f"{_project(team)}/controls/{control}/phases/DESIGN/release", json={}
    )
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert status["step"] == "RELEASED" and status["early"] is False


def test_revising_the_test_plan_does_not_hold_d_and_i_requests(migrated: Database) -> None:
    team = _launched(migrated, "di-revise")
    approve_evidence_plans(migrated, team["project"], release=False)
    control = _control(team, "ITGC-AC-01")["id"]
    design = _requests(migrated, control, "DESIGN")
    assert design
    # A revision of the plan (an operating phase's change, say) puts it back to proposed.
    with connect(migrated.url) as connection:
        connection.execute(
            "SELECT revise_evidence_plan(id) FROM evidence_plans WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    assert _plan(team, control)["status"] == "PROPOSED"
    with connect(migrated.url) as connection:
        # Rewritten from the planning gate's first rule (milestone 8.x): a revision used to
        # hold every phase; it now holds only the operating phases.
        assert gate_reason(connection, UUID(control), "DESIGN") is None
        assert gate_reason(connection, UUID(control), "INTERIM") == GATE_PLAN
        for request_id, _status in design:
            assert held_for_planning(connection, UUID(str(request_id))) is None
    listed = team["owner"].get(f"{_project(team)}/evidence-requests", params={"size": 200}).json()
    for request_id, _status in design:
        row = next(item for item in listed["rows"] if item["id"] == str(request_id))
        assert row["held"] is False, row


def test_the_planner_proposes_what_it_adds_to_released_d_and_i_evidence(
    migrated: Database,
) -> None:
    team = _launched(migrated, "di-planner")
    control = _control(team, "ITGC-AC-01")["id"]
    released = team["owner"].post(
        f"{_project(team)}/controls/{control}/phases/DESIGN/release", json={"reason": REASON}
    )
    assert released.status_code == 200, released.text
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(control))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        phase = next(p for p in output["phases"] if p["phase"] == "DESIGN")
        extra = dict(phase["requirements"][0])
        extra.update(
            key="design-change-9",
            title="Access approval matrix",
            description="The current matrix of who may approve access to SAP ERP.",
        )
        phase["requirements"].append(extra)
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
    proposed = _rows(
        migrated,
        "SELECT id, version, status, pending_change, pbc_request_id FROM evidence_requirements "
        "WHERE engagement_control_id = %s AND requirement_key = 'design-change-9'",
        UUID(control),
    )
    assert len(proposed) == 1
    requirement_id, version, status, change, request = proposed[0]
    # The plan is not approved, but the D&I evidence a person released is not extended by
    # the agent: the addition is proposed to a person, and nothing is requested for it.
    assert change == {"add": True} and request is None and status == "PLANNED"
    # Not part of the plan until accepted, so the control is not listed as having evidence
    # never requested (bug hunt, 9 November 2026: before, it was, for good).
    with connect(migrated.url) as connection:
        assert UUID(control) not in unrequested_controls(connection, project)
    accepted = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-requirements/{requirement_id}/change",
        json={"decision": "ACCEPT", "version": version},
    )
    assert accepted.status_code == 200, accepted.text
    # Accepted by a person: requested under the D&I release, with no plan approval.
    assert _rows(
        migrated,
        "SELECT pbc_request_id IS NOT NULL FROM evidence_requirements WHERE id = %s",
        requirement_id,
    ) == [(True,)]


def _understood(migrated: Database, team: dict[str, Any], control: str) -> None:
    """Complete the control's understanding: its open questions answered, the client values
    its statement asks recorded, and (since 11 November 2026, B1c) its required walkthrough
    questions answered, as test_a_understood_control_... does step by step."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', "
            "resolution_note = 'Answered in the walkthrough.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND status = 'OPEN'",
            (control,),
        )
        connection.commit()
        design_body = design_for(connection, UUID(control))
        assert design_body is not None
        values = {
            slot.key: slot.options[0] if slot.options else "The IT security manager"
            for slot in design_body.slots
            if not slot.automatic and not slot.document and not slot.value.strip()
        }
        if values:
            set_values(
                connection, team["org"], team["project"], UUID(control), team["owner_id"],
                ValuesBody(values=values),
            )  # fmt: skip
    # Added 11 November 2026: before, the statement's values and the open questions were all
    # Control Understanding needed; now the required walkthrough questions are too.
    answer_walkthrough(migrated, team["project"], [UUID(control)])


def test_d_and_i_evidence_waits_for_the_attributes_it_is_tested_against(
    migrated: Database,
) -> None:
    """D&I is a test of one against the control's attributes, and they decide the evidence
    asked for (product owner, 11 November 2026): the release is recommended only once the
    attributes are settled, as the operating evidence's gate reads them. Before then a person
    may still release it, with the reason recorded, as before understanding."""
    team = _launched(migrated, "di-attributes")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    tailor_criteria(migrated, team["project"])
    _understood(migrated, team, control)
    assert _design(team, control)["step"] == "READY"
    # The attribute agent proposes a wording the narrative showed: not settled again.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                basis, source_kind, proposal
            )
            SELECT organization_id, project_id, id, 99,
                   'Access is removed within one business day of the approval being withdrawn.',
                   'PROPOSED', 'INFERRED', 'AGENT', 'ADD'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()
    waiting = _design(team, control)
    assert waiting["step"] == "WAITING" and waiting["waiting_on"] == "ATTRIBUTES"
    assert waiting["step_label"] == "Waiting for the attributes"
    assert waiting["waiting_for"] == (
        "The attributes are not settled: 1 proposed attribute waits for a decision."
    )
    # Not recommended: the control's next step is not the release, and a release without a
    # reason is refused with what it waits for.
    assert _control(team, "ITGC-AC-01")["next_step"] != "Release the D&I evidence"
    path = f"{_project(team)}/controls/{control}/phases/DESIGN/release"
    bare = team["owner"].post(path, json={})
    assert bare.status_code == 409
    assert bare.json()["detail"].startswith("The attributes are not settled")
    # While the attribute agent is still at work its proposals would follow: not settled.
    settle_attributes(migrated, team["project"])
    tailor_criteria(migrated, team["project"])
    assert _design(team, control)["step"] == "READY"
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO process_narrative_runs (
                engagement_control_id, organization_id, project_id, run_status, stage
            )
            SELECT id, organization_id, project_id, 'WORKING', 'ATTRIBUTES'
            FROM engagement_controls WHERE id = %s
            ON CONFLICT (engagement_control_id)
            DO UPDATE SET run_status = 'WORKING', stage = 'ATTRIBUTES'
            """,
            (control,),
        )
        connection.commit()
    busy = _design(team, control)
    assert busy["waiting_on"] == "ATTRIBUTES"
    assert busy["waiting_for"].endswith("the agent is still updating them.")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE process_narrative_runs SET run_status = 'IDLE', stage = '' "
            "WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    # Settled: recommended, released without a reason, and the release records the
    # attributes the evidence is requested against, as worded then.
    ready = _design(team, control)
    assert ready["step"] == "READY" and ready["waiting_on"] == "" and ready["waiting_for"] == ""
    released = team["owner"].post(path, json={})
    assert released.status_code == 200, released.text
    approved = [
        row[0]
        for row in _rows(
            migrated,
            "SELECT text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            UUID(control),
        )
    ]
    assert approved
    audit = _rows(
        migrated,
        "SELECT payload FROM audit_events WHERE target_id = %s AND action = 'phase.released'",
        UUID(control),
    )
    assert audit[0][0]["early"] is False and audit[0][0]["attributes"] == approved


def test_d_and_i_evidence_waits_while_no_attribute_is_approved(migrated: Database) -> None:
    team = _launched(migrated, "di-no-attributes")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    _understood(migrated, team, control)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'RETIRED' "
            "WHERE engagement_control_id = %s AND status = 'APPROVED'",
            (control,),
        )
        connection.commit()
    waiting = _design(team, control)
    assert waiting["waiting_on"] == "ATTRIBUTES"
    assert waiting["waiting_for"] == "The attributes are not settled: no attribute is approved."
    # Understanding comes first: an open question names the understanding, not the attributes.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, resolve, fingerprint, raised_by
            )
            SELECT organization_id, project_id, id, 'PROCESS', 'MISSING', 'Walkthrough',
                   'Who approves an emergency change out of hours?',
                   'The design is assessed against who approves.', 'Answer it.',
                   'di-no-attributes-question', 'RULES'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()
    first = _design(team, control)
    assert first["waiting_on"] == "UNDERSTANDING"
    assert first["step_label"] == "Waiting for understanding"


def test_d_and_i_evidence_waits_for_criteria_tailored_to_the_control(migrated: Database) -> None:
    """The testers judge evidence against each attribute's criteria, tailored to the control
    and owned by a person (product owner, 11 November 2026): the library's standard wording
    is the requirement, not the criteria. The planner agent's tailored criteria count once a
    person accepts them; a person's own count as they are."""
    team = _launched(migrated, "di-criteria")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    _understood(migrated, team, control)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = '', pass_criteria = '', "
            "fail_criteria = '', criteria_origin = NULL, criteria_accepted_by = NULL, "
            "criteria_accepted_at = NULL, judgment_required = NULL "
            "WHERE engagement_control_id = %s AND status = 'APPROVED'",
            (control,),
        )
        connection.commit()
        approved = [
            (UUID(str(row[0])), int(row[1]))
            for row in connection.execute(
                "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' ORDER BY position, created_at",
                (control,),
            ).fetchall()
        ]
    assert approved
    waiting = _design(team, control)
    assert waiting["waiting_on"] == "ATTRIBUTES"
    count = len(approved)
    assert waiting["waiting_for"] == (
        f"The attributes are not settled: {count} attribute{'' if count == 1 else 's'} "
        f"need{'s' if count == 1 else ''} criteria tailored to this control."
    )
    # The planner agent tailors them: not yet owned, so still waiting.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = 'The ServiceNow request names the user "
            "and the SAP S/4HANA role.', pass_criteria = 'The manager approved in ServiceNow "
            "before the grant.', fail_criteria = 'No approval, or one after the grant.', "
            "criteria_origin = 'AGENT', version = version + 1 "
            "WHERE engagement_control_id = %s AND status = 'APPROVED'",
            (control,),
        )
        connection.commit()
        versions = [
            (str(row[0]), int(row[1]))
            for row in connection.execute(
                "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' ORDER BY position, created_at",
                (control,),
            ).fetchall()
        ]
    tailored = _design(team, control)
    assert tailored["waiting_on"] == "ATTRIBUTES"
    # Worded by what it waits for (review M5, 11 November 2026): tailored, so a person's
    # acceptance, not more tailoring.
    assert tailored["waiting_for"] == (
        f"The attributes are not settled: {count} attribute{'' if count == 1 else 's'} "
        f"{'has' if count == 1 else 'have'} criteria to accept."
    )
    texts = [
        str(row[0])
        for row in _rows(
            migrated,
            "SELECT text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            UUID(control),
        )
    ]
    # Agent criteria no person accepted never reach the tester.
    with connect(migrated.url) as connection:
        assert tailored_criteria(connection, UUID(control), texts) == [None] * len(texts)
    # The attribute review shows the tailored criteria, not owned yet.
    context = team["owner"].get(f"{_project(team)}/controls/{control}/context")
    assert context.status_code == 200, context.text
    shown = context.json()["attributes"]["approved"]
    assert shown and all(item["criteria_origin"] == "AGENT" for item in shown)
    assert all(item["pass_criteria"].startswith("The manager approved") for item in shown)
    assert not any(item["criteria_owned"] for item in shown)
    # A person accepts them: owned, so the attributes are settled and the release is ready.
    accepted = team["owner"].post(
        f"{_project(team)}/controls/{control}/master-plan/criteria/accept",
        json={"attributes": [{"id": key, "version": version} for key, version in versions]},
    )
    assert accepted.status_code == 200, accepted.text
    ready = _design(team, control)
    assert ready["step"] == "READY", ready
    after = team["owner"].get(f"{_project(team)}/controls/{control}/context").json()
    assert all(item["criteria_owned"] for item in after["attributes"]["approved"])
    assert all(item["criteria_accepted_by"] for item in after["attributes"]["approved"])
    # Accepted, they are what the tester judges against, beside the standard's requirement.
    with connect(migrated.url) as connection:
        given = tailored_criteria(connection, UUID(control), texts)
    assert all(item is not None for item in given)
    assert {item["stated_by"] for item in given if item is not None} == {"AGENT_ACCEPTED_BY_PERSON"}
    assert all(
        item is not None and item["pass_when"].startswith("The manager approved") for item in given
    )


def test_the_planner_tailors_library_attributes_but_never_a_persons_criteria(
    migrated: Database,
) -> None:
    """Since 11 November 2026 the planner's tailored criteria are written for library
    attributes too (before: only for attributes the library does not define). A person's
    criteria, criteria a person accepted, and the demo's are never replaced."""
    team = _launched(migrated, "di-planner-criteria")
    control = _control(team, "ITGC-AC-01")["id"]
    settle_attributes(migrated, team["project"])
    rows = _rows(
        migrated,
        "SELECT id, text, definition_key FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position",
        UUID(control),
    )
    library = [row for row in rows if row[2] is not None]
    assert len(library) >= 2, "the launched control follows the library"
    (tailored_id, tailored_text, _key), (kept_id, kept_text, _other) = library[0], library[1]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET condition = 'Kept.', pass_criteria = 'Kept pass.', "
            "fail_criteria = 'Kept fail.', criteria_origin = 'PERSON' WHERE id = %s",
            (kept_id,),
        )
        connection.commit()
        with transaction(connection) as cursor:
            _write_criteria(
                cursor,
                UUID(control),
                [
                    {
                        "attribute": text,
                        "condition": "The ServiceNow request names the SAP S/4HANA role.",
                        "pass_criteria": "The request names the user and the role granted.",
                        "fail_criteria": "No request, or one naming another role.",
                    }
                    for text in (tailored_text, kept_text)
                ],
            )
    after = {
        row[0]: row[1:]
        for row in _rows(
            migrated,
            "SELECT id, criteria_origin, pass_criteria FROM control_attributes WHERE id = ANY(%s)",
            [tailored_id, kept_id],
        )
    }
    assert after[tailored_id] == ("AGENT", "The request names the user and the role granted.")
    assert after[kept_id] == ("PERSON", "Kept pass.")
