"""Evidence requests ready to approve (master test plans, milestone D): the wording asks for
something specific in the client's terms; every item that evidences an attribute maps to
the approved test plan; periods lie in the phase's window; the phase applies; nothing on it
waits for a decision; and it duplicates no other open request. The reviewer sees which
attributes it supports; the client never does."""

from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_evidence_planning import _facts
from test_outbound import migrated
from test_request_details import _details, _ready_engagement

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.pbc_drafting import DraftContext, check_draft
from ai_workforce_api.request_details import client_content
from ai_workforce_api.request_quality import wording_problems

__all__ = ["migrated"]


@pytest.mark.parametrize(
    "text",
    [
        "Provide all relevant supporting documentation.",
        "Send any necessary evidence for the control.",
        "Supporting documentation as needed.",
        "Population for attributes A1, A2, A3.",
        "Evidence for each test attribute of the sample.",
        "Testing per PCAOB AS 2201.",
    ],
)
def test_vague_or_internal_wording_is_refused(text: str) -> None:
    assert wording_problems(text)


@pytest.mark.parametrize(
    "text",
    [
        "Complete population of new users provisioned in SAP S/4HANA from 1 January to 30 June "
        "2026, including user ID, request date, approval date, approver, and provisioning date.",
        "Current password policy configuration for production Azure AD, showing minimum "
        "password length, lockout threshold, and applicable scope.",
        "Q2 2026 privileged access review, including reviewed user listing, reviewer sign-off, "
        "review date, and resolution of identified exceptions.",
        "The report's parameters, the date range, and any other filters applied.",
        "Change type (standard, emergency, etc.).",
    ],
)
def test_specific_requests_pass(text: str) -> None:
    assert wording_problems(text) == []


def test_the_drafter_never_offers_what_approval_would_refuse() -> None:
    context = DraftContext(
        engagement="SOX 2027",
        control_ref="ITGC-AC-01", title="Access is approved", activity="Access is approved.",
        risk="", domain="ACCESS", frequency="EVENT_DRIVEN", nature="MANUAL", period_end=None,
        domain_label="Logical access", frequency_label="Event driven", nature_label="Manual",
        key_control=True, owner_name="", applications=("SAP ERP",), test_attributes=(),
        pbc_items=(), custom_fields=(),
    )  # fmt: skip
    output = {
        "summary": "For our interim testing, please provide the items below.",
        "items": [
            {
                "kind": "population",
                "title": "New user population",
                "detail": "The list of new users, and all relevant supporting documentation.",
            }
        ],
        "questions": [],
        "assumptions": [],
    }
    with pytest.raises(ValueError, match="not specific"):
        check_draft(output, context)


def test_a_population_names_the_fields_it_is_tested_by() -> None:
    plan = rules_plan(_facts(control_ref="ITGC-AC-01", domain="ACCESS"))
    population = next(
        item for item in plan.phase("INTERIM").requirements if item.key == "interim-population"
    )
    assert "approval date" in population.description and "date granted" in population.description
    assert wording_problems(population.description) == []
    change = rules_plan(_facts(control_ref="ITGC-CM-01", domain="CHANGE"))
    text = next(
        item.description for item in change.phase("INTERIM").requirements
        if item.key == "interim-population"
    )  # fmt: skip
    assert "deployment date" in text and "approval date" in text


def _access_draft(team: dict[str, Any]) -> dict[str, Any]:
    """The design draft of an access control: its walkthrough item evidences the attributes
    (the interim request carries the population, which supports the testing)."""
    rows = (
        team["owner"]
        .get(f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls")
        .json()
    )
    for row in rows:
        if row["included"] and row["control_ref"].startswith("ITGC-AC"):
            for request in row["requests"]:
                if request["status"] == "DRAFT" and request.get("phase") == "DESIGN":
                    return {**request, "control_id": row["id"]}
    raise AssertionError("no design access draft")


def _check(details: dict[str, Any], key: str) -> dict[str, Any]:
    found: dict[str, Any] = next(item for item in details["checks"] if item["key"] == key)
    return found


def test_a_request_is_checked_against_the_test_plan_before_approval(migrated: Database) -> None:
    team = _ready_engagement(migrated, "quality-checks")
    draft = _access_draft(team)
    details = _details(team, draft["id"])
    for key in ("wording", "mapping", "period", "phase_applies", "decisions", "duplicate"):
        assert _check(details, key)["ok"], (key, _check(details, key))
    # The reviewer sees the attributes it supports; the client's view never names them.
    assert details["supports"] and all(item["code"].startswith("A") for item in details["supports"])
    with connect(migrated.url) as connection:
        title, label, content = client_content(connection, team["project"], UUID(draft["id"]))
    client = f"{title} {label} {content.model_dump_json()}"
    assert all(f'"{item["code"]}"' not in client for item in details["supports"])
    listed = (
        team["owner"]
        .get(
            f"/organizations/{team['org']}/projects/{team['project']}/evidence-requests",
            params={"size": 200},
        )
        .json()
    )
    row = next(item for item in listed["rows"] if item["id"] == draft["id"])
    assert row["supports"] == sorted(
        (item["code"] for item in details["supports"]), key=lambda code: (len(code), code)
    )

    request_id = UUID(draft["id"])
    with connect(migrated.url) as connection:
        # An item that evidences an attribute but maps to none.
        sample = connection.execute(
            """
            SELECT q.id FROM evidence_requirements q
            WHERE q.pbc_request_id = %s AND q.status = 'REQUESTED'
              AND q.categories && ARRAY['SAMPLE', 'CONTROL_EXECUTION', 'CONFIGURATION']
            LIMIT 1
            """,
            (request_id,),
        ).fetchone()
        if sample is not None:
            connection.execute(
                "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s",
                (sample[0],),
            )
        # The interim request of the same control asks for a period outside its window.
        interim = connection.execute(
            "SELECT id FROM pbc_requests WHERE engagement_control_id = %s "
            "AND testing_phase = 'INTERIM' AND status = 'DRAFT' LIMIT 1",
            (draft["control_id"],),
        ).fetchone()
        assert interim is not None
        connection.execute(
            "UPDATE evidence_requirements SET period_end = period_end + 400 "
            "WHERE pbc_request_id = %s AND period_end IS NOT NULL",
            (interim[0],),
        )
        # A second open request of the same control and phase, asking for the same items.
        connection.execute(
            """
            INSERT INTO pbc_requests (
                organization_id, project_id, operation_key, control_ref, owner_user_id,
                recipient, due_at, evidence_description, follow_up_after_days,
                max_follow_ups, engagement_control_id, testing_phase, drafted_by
            )
            SELECT organization_id, project_id, operation_key || '-copy', control_ref,
                   owner_user_id, recipient, due_at, evidence_description,
                   follow_up_after_days, max_follow_ups, engagement_control_id,
                   testing_phase, 'PERSON'
            FROM pbc_requests WHERE id = %s
            """,
            (request_id,),
        )
        connection.commit()
    details = _details(team, draft["id"])
    if sample is not None:
        assert not _check(details, "mapping")["ok"]
        assert "evidences no approved attribute" in _check(details, "mapping")["detail"]
    period = _check(_details(team, str(interim[0])), "period")
    assert not period["ok"] and "outside the phase's window" in period["detail"]
    assert not _check(details, "duplicate")["ok"]
    assert details["ready"] is False
    # The phase stops applying: the request cannot be approved for it.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE evidence_plan_phases SET applicability = 'NOT_APPLICABLE',
                   rationale = 'Out of scope for this period by the engagement letter.'
            WHERE engagement_control_id = %s AND phase = 'DESIGN'
            """,
            (draft["control_id"],),
        )
        connection.commit()
    details = _details(team, draft["id"])
    assert not _check(details, "phase_applies")["ok"]
    approved = team["owner"].post(
        f"/organizations/{team['org']}/projects/{team['project']}/pbc-requests/"
        f"{draft['id']}/approve",
        json={"version": details["request"]["version"]},
    )
    assert approved.status_code == 409


def test_a_request_a_person_wrote_is_checked_for_its_wording(migrated: Database) -> None:
    team = _ready_engagement(migrated, "quality-wording")
    draft = _access_draft(team)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET evidence_description = %s WHERE id = %s",
            (
                "Please provide all relevant supporting documentation for this control, "
                "covering the whole period.",
                draft["id"],
            ),
        )
        connection.commit()
    wording = _check(_details(team, draft["id"]), "wording")
    assert wording["ok"] is False
    assert "all relevant supporting documentation" in wording["detail"]
