"""Evidence request details (migration 0075): the request's type, its client-facing
checklist kept apart from the audit team's planning, recipients assigned inline within the
client's email domains, people copied on the email, reference material that stays
internal unless shared, and the checks run before approval and sending."""

import re
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from support import Database
from test_evidence_flow import _drafted, _launch, _project
from test_evidence_portal import _code, _public, _sent, _verify
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated
from test_testing_engine import _approved_samples
from test_testing_engine import _base as _api_base

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import (
    SuiteWording,
    suite_description,
    suite_wording,
)
from ai_workforce_api.evidence_plans import _Line, render
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.pbc import PbcBody
from ai_workforce_api.pbc_drafting import (
    MAX_ITEMS,
    PRIMARY_KIND,
    REPLANNED,
    SAMPLE_REDRAFT,
    TOO_MANY,
    TOO_MANY_REDRAFT,
    UNPHASED_REDRAFT,
    DraftContext,
    PlannedItem,
    _planned_title,
    check_draft,
    load_context,
    planned_draft,
    run_draft,
    with_plan,
)
from ai_workforce_api.pbc_drafting import render as render_draft
from ai_workforce_api.request_details import (
    _category_type,
    heading_of,
    item_types,
    parse_wording,
    plain_title,
    title_of,
)

__all__ = ["migrated"]


def _ready_engagement(migrated: Database, slug: str) -> dict[str, Any]:
    team = _new_engagement(migrated, slug)
    _complete_setup(team["owner"], team)
    _launch(team["owner"], team)
    _drafted(migrated, team)
    return team


def _access_draft(team: dict[str, Any]) -> dict[str, Any]:
    """The interim draft of an access control: drafted by the evidence coordinator."""
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    for row in rows:
        if row["included"] and row["control_ref"].startswith("ITGC-AC"):
            for request in row["requests"]:
                if request["status"] == "DRAFT" and request.get("phase") == "INTERIM":
                    return {**request, "control_id": row["id"]}
    raise AssertionError("no interim access draft")


def _details(team: dict[str, Any], request_id: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/pbc-requests/{request_id}/details")
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _assign(team: dict[str, Any], request_id: str, version: int, **fields: Any) -> Any:
    due = (datetime.now(UTC) + timedelta(days=12)).date().isoformat()
    body = {"version": version, "recipient": "iam@client.example", "cc": [], "due_on": due}
    body.update(fields)
    return team["owner"].post(f"{_project(team)}/pbc-requests/{request_id}/assignment", json=body)


def _audit(migrated: Database, project: UUID, action: str) -> list[dict[str, Any]]:
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s AND action = %s "
            "ORDER BY occurred_at",
            (project, action),
        ).fetchall()
    return [dict(row[0]) for row in rows]


def test_the_wording_reads_back_as_a_checklist() -> None:
    text = (
        "For our interim testing we need the items below.\n\n"
        "1. User access listing\n"
        "   A list of every active user.\n"
        "   Period: 1 January to 30 September 2028\n"
        "   Include: User ID; Role; Date granted\n"
        "   Format: Excel or CSV\n"
        "   Completeness: Every active user.\n\n"
        "2. How the listing was produced\n"
        "   The report or query used.\n\n"
        "Questions for you:\n"
        "- Who performs this control?"
    )
    content = parse_wording(text)
    assert content.structured
    assert content.summary == "For our interim testing we need the items below."
    assert [item.title for item in content.items] == [
        "User access listing",
        "How the listing was produced",
    ]
    first = content.items[0]
    assert first.detail == "A list of every active user."
    assert first.period == "1 January to 30 September 2028"
    assert first.include == ["User ID", "Role", "Date granted"]
    assert first.format == "Excel or CSV"
    assert first.completeness == "Every active user."
    assert content.questions == ["Who performs this control?"]
    # Wording a person rewrote freely is shown as written.
    free = parse_wording("Please send the signed Q1 access review.")
    assert not free.structured and free.summary == "Please send the signed Q1 access review."


def test_the_request_edited_item_by_item_reads_back_the_same() -> None:
    # The exact text the web editor writes (request-details-model composeWording, pinned
    # in tests/request-details.test.ts).
    text = "\n\n".join(
        [
            "Design evidence for ITGC-AC-05: Authentication",
            "To understand how this control is designed, please provide:",
            "1. Information security policy\n"
            "   Period: The version in force during the period\n"
            "   Include: Password length, complexity; Lockout threshold\n"
            "   If not available: The security standard",
            "2. Users who can change the settings (if available)\n"
            "   Export it from the system, not a spreadsheet.\n"
            "   Period: At the interim date\n"
            "   Include: User or role",
            "Please label each file with the number of the item it answers. Thank you.",
            "Questions for you:\n- Who hosts the walkthrough?",
        ]
    )
    content = parse_wording(text)
    assert heading_of(content) == "Design evidence for ITGC-AC-05: Authentication"
    first, second = content.items
    assert (first.title, first.detail, first.period) == (
        "Information security policy",
        "",
        "The version in force during the period",
    )
    assert first.include == ["Password length, complexity", "Lockout threshold"]
    assert first.alternatives == ["The security standard"]
    assert second.detail == "Export it from the system, not a spreadsheet."
    assert second.include == ["User or role"] and plain_title(second.title) == (
        "Users who can change the settings"
    )
    assert content.closing.endswith("Thank you.")
    assert content.questions == ["Who hosts the walkthrough?"]


def test_a_standard_evidence_item_reads_as_labelled_lines_under_the_requests_heading() -> None:
    wording = SuiteWording(
        period="The version in force during the period",
        include=("Required password length and complexity", "Lockout threshold"),
        completeness="Approved and dated.",
        not_sufficient="A policy that says settings must be 'strong' without values.",
        alternatives=("The security standard the policy refers to",),
    )
    description = suite_description(wording)
    assert suite_wording(description) == SuiteWording(
        period="The version in force during the period",
        include=("Required password length and complexity", "Lockout threshold"),
        completeness="Approved and dated.",
        not_sufficient="A policy that says settings must be 'strong' without values.",
        alternatives=("The security standard the policy refers to",),
    )
    # A description the team rewrote without the labels stays prose.
    assert suite_wording("A list of every active user with their role.") is None
    text = render(
        "ITGC-AC-05",
        "Authentication and Password Configuration",
        "DESIGN",
        [
            _Line("Information security policy", description, "", "REQUIRED"),
            _Line("Users and roles able to change the settings", description, "", "OPTIONAL"),
        ],
        (None, None),
    )
    content = parse_wording(text)
    first, second = content.items
    # The item's title is not repeated as its detail; each part is its own field.
    assert first.title == "Information security policy" and first.detail == ""
    assert first.period == "The version in force during the period"
    assert first.include == ["Required password length and complexity", "Lockout threshold"]
    assert first.completeness == "Approved and dated."
    # What the auditor would not accept stays in the plan, for the audit team only.
    assert "strong" in description and "strong" not in text
    assert "Not sufficient" not in text
    assert first.alternatives == ["The security standard the policy refers to"]
    assert plain_title(second.title) == "Users and roles able to change the settings"
    # The request is titled by its heading, not by its first item.
    heading = "Design evidence for ITGC-AC-05: Authentication and Password Configuration"
    assert heading_of(content) == heading
    pbc = PbcBody.model_construct(title="", evidence_description=text, control_ref="ITGC-AC-05")
    assert title_of(pbc, content) == heading
    # A wording that opens with a sentence keeps the first item as its title.
    sentence = parse_wording("Please provide the items below.\n\n1. User access listing\n   All.")
    assert heading_of(sentence) == ""
    # A drafted phase request of several items is titled by its phase and control.
    drafted = parse_wording(
        "We ask for two items.\n\n1. Information security policy\n   The policy.\n\n"
        "2. Authentication configuration\n   The settings."
    )
    phase_request = PbcBody.model_construct(
        title="", evidence_description="", control_ref="ITGC-AC-05", testing_phase="DESIGN"
    )
    assert title_of(phase_request, drafted) == "Design evidence for ITGC-AC-05"


def test_a_planned_items_type_follows_its_title_where_the_category_is_broad() -> None:
    policy = _category_type(["PROCESS_DOCUMENTATION"], "DESIGN", "Information security policy")
    assert policy == "POLICY_PROCEDURE"
    narrative = _category_type(["PROCESS_DOCUMENTATION"], "DESIGN", "Process narrative")
    assert narrative == "PROCESS_NARRATIVE"
    users = "Users and roles able to change the settings"
    assert _category_type(["OTHER"], "DESIGN", users, named=True) == "ACCESS_LISTING"
    # A label for the item only: the request's own type stays for the team to confirm.
    assert _category_type(["OTHER"], "DESIGN", users) == "OTHER"
    assert _category_type(["OTHER"], "DESIGN", "Board minutes", named=True) == "OTHER"
    assert _category_type(["CONTROL_EXECUTION"], "DESIGN", "Walkthrough") == "SAMPLE_OF_ONE"
    # The drafter's kind stands, unless it could not place the item and the plan can.
    found = item_types(
        [("Information security policy", "design"), (users, "other")],
        [("Information security policy", ["PROCESS_DOCUMENTATION"]), (users, ["OTHER"])],
        "DESIGN",
    )
    assert found["information security policy"] == "PROCESS_NARRATIVE"
    assert found[users.lower()] == "ACCESS_LISTING"


def test_a_drafted_request_shows_its_type_checklist_and_internal_planning_apart(
    migrated: Database,
) -> None:
    team = _ready_engagement(migrated, "rd-read")
    draft = _access_draft(team)
    body = _details(team, draft["id"])
    assert body["reference"] == f"PBC-{UUID(draft['id']).hex[-8:].upper()}"
    assert body["request"]["testing_phase"] == "INTERIM"
    assert body["control"]["id"] == draft["control_id"]
    # Classified from the plan; a population of user access is an access listing.
    kind = body["type"]
    assert kind["basis"] == "RULES" and not kind["confirmed"] and not kind["uncertain"]
    first = body["planning"]["requirements"][0]["categories"][0]
    if first == "POPULATION":
        assert kind["request_type"] == "ACCESS_LISTING"
    assert len(body["types"]) == 12
    # The client-facing checklist, and a title for the request as a whole: its phase and
    # control when it asks for several items, else its one deliverable.
    content = body["content"]
    assert content["structured"] and content["items"]
    expected = (
        f"Interim testing evidence for {body['request']['control_ref']}"
        if len(content["items"]) > 1
        else content["items"][0]["title"]
    )
    assert body["title"] == expected and not body["title_set"]
    assert all(item["request_type"] for item in content["items"])
    # Why each item is asked for stays with the audit team, never in the wording.
    planning = body["planning"]
    assert planning["requirements"] and planning["drafted_by"] == "RULES"
    for requirement in planning["requirements"]:
        assert requirement["rationale"] not in body["request"]["evidence_description"]
    # Who it goes to: the control's owner, suggested, within the client's domains.
    assert body["domains"] == ["client.example"]
    assert body["suggested"]["email"] == "iam@client.example"
    assert body["suggested"]["role"] == "Control owner"
    emails = {item["email"]: item["source"] for item in body["contacts"]}
    assert emails["pbc@client.example"] == "COORDINATOR"
    assert emails["iam@client.example"] == "OWNER"
    checks = {item["key"]: item["ok"] for item in body["checks"]}
    assert checks == {
        "title": True,
        "type": True,
        "phase": True,
        "instructions": True,
        "recipient": True,
        "cc": True,
        "due": True,
        "control": True,
        "attachments": True,
        # Checked against the test plan (milestone D).
        "wording": True,
        "mapping": True,
        "phase_applies": True,
        "period": True,
        "decisions": True,
        "duplicate": True,
    }
    assert body["ready"] and body["assignable"] and body["can_edit"] and body["can_share"]
    assert body["clarification"] is False
    # Read-only inside its engagement: another engagement's people cannot read it.
    stranger = _new_engagement(migrated, "rd-read-other")
    hidden = stranger["owner"].get(f"{_project(team)}/pbc-requests/{draft['id']}/details")
    assert hidden.status_code in (403, 404)


def test_an_uncertain_type_is_confirmed_before_the_agent_draft_is_approved(
    migrated: Database,
) -> None:
    team = _ready_engagement(migrated, "rd-type")
    draft = _access_draft(team)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET categories = '{OTHER}' WHERE pbc_request_id = %s",
            (draft["id"],),
        )
        connection.commit()
    body = _details(team, draft["id"])
    assert body["type"]["uncertain"] and body["type"]["request_type"] == "OTHER"
    assert not body["ready"]
    assert next(c for c in body["checks"] if c["key"] == "type")["detail"] == (
        "Confirm the type (Other)."
    )
    path = f"{_project(team)}/pbc-requests/{draft['id']}"
    refused = team["owner"].post(f"{path}/approve", json={"version": draft["version"]})
    assert refused.status_code == 409
    assert refused.json()["detail"] == "Confirm the type (Other)."
    # A type that is not registered is refused.
    wrong = team["owner"].post(
        f"{path}/classification",
        json={"version": draft["version"], "request_type": "SOMETHING"},
    )
    assert wrong.status_code == 422
    confirmed = team["owner"].post(
        f"{path}/classification",
        json={
            "version": draft["version"],
            "request_type": "RECONCILIATION",
            "title": "  Q3 user access   reconciliation ",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    after = confirmed.json()
    assert after["type"] == {
        "request_type": "RECONCILIATION",
        "label": "Reconciliation",
        "basis": "PERSON",
        "confirmed": True,
        "uncertain": False,
        "reason": "Confirmed by the audit team.",
    }
    assert after["title"] == "Q3 user access reconciliation" and after["title_set"]
    assert after["ready"]
    assert _audit(migrated, team["project"], "pbc.classified")[-1]["request_type"] == {
        "from": None,
        "to": "RECONCILIATION",
    }
    approved = team["owner"].post(f"{path}/approve", json={"version": after["request"]["version"]})
    assert approved.status_code == 200, approved.text


def test_recipients_are_assigned_inline_within_the_clients_domains(migrated: Database) -> None:
    team = _ready_engagement(migrated, "rd-assign")
    draft = _access_draft(team)
    version = draft["version"]
    cases: list[tuple[dict[str, Any], str]] = [
        ({"recipient": "not-an-email"}, "not-an-email is not a valid email address."),
        (
            {"recipient": "someone@elsewhere.example"},
            "someone@elsewhere.example is outside the organization's email domains "
            "(client.example).",
        ),
        (
            {"cc": ["iam@client.example"]},
            "The recipient is already on the request; remove them from Cc.",
        ),
        (
            {"cc": ["a@client.example", "A@client.example"]},
            "Each copied address can appear once.",
        ),
        (
            {"cc": ["auditor@elsewhere.example"]},
            "auditor@elsewhere.example is outside the organization's email domains "
            "(client.example).",
        ),
        (
            {"due_on": (datetime.now(UTC) - timedelta(days=1)).date().isoformat()},
            "The due date cannot be in the past.",
        ),
    ]
    for fields, detail in cases:
        refused = _assign(team, draft["id"], version, **fields)
        assert refused.status_code == 409, (fields, refused.text)
        assert refused.json()["detail"] == detail
    bad_priority = _assign(team, draft["id"], version, priority="CRITICAL")
    assert bad_priority.status_code == 422
    due = (datetime.now(UTC) + timedelta(days=20)).date()
    saved = _assign(
        team,
        draft["id"],
        version,
        recipient="Ops@Client.example",
        cc=["iam@client.example", "pbc@client.example"],
        due_on=due.isoformat(),
        priority="HIGH",
    )
    assert saved.status_code == 200, saved.text
    request = saved.json()["request"]
    assert request["recipient"] == "ops@client.example"
    assert request["cc_recipients"] == ["iam@client.example", "pbc@client.example"]
    assert request["priority"] == "HIGH"
    assert request["due_at"].startswith(due.isoformat())
    assert request["version"] == version + 1
    assert request["status"] == "DRAFT"
    changes = _audit(migrated, team["project"], "pbc.assignment_changed")[-1]
    assert changes["recipient"] == {"from": "iam@client.example", "to": "ops@client.example"}
    assert changes["priority"] == {"from": "NORMAL", "to": "HIGH"}
    # Saving the same values again changes nothing.
    again = _assign(
        team,
        draft["id"],
        request["version"],
        recipient="ops@client.example",
        cc=["iam@client.example", "pbc@client.example"],
        due_on=due.isoformat(),
        priority="HIGH",
    )
    assert again.status_code == 200 and again.json()["request"]["version"] == request["version"]
    # A stale version is refused rather than overwriting someone else's change.
    stale = _assign(team, draft["id"], version, recipient="ops@client.example")
    assert stale.status_code == 409
    # Someone who may only read the engagement cannot assign.
    with connect(migrated.url) as connection:
        viewer = _add_user(connection, team["org"], f"v-{uuid4().hex[:6]}@example.com", "REVIEWER")
        _add_project_member(connection, team["org"], team["project"], viewer)
    blocked = _session(migrated, viewer).post(
        f"{_project(team)}/pbc-requests/{draft['id']}/assignment",
        json={
            "version": request["version"],
            "recipient": "iam@client.example",
            "cc": [],
            "due_on": due.isoformat(),
        },
    )
    assert blocked.status_code == 403


def test_a_changed_approval_goes_back_for_approval_and_copies_reach_the_email(
    migrated: Database,
) -> None:
    team = _ready_engagement(migrated, "rd-reapprove")
    owner = team["owner"]
    draft = _access_draft(team)
    path = f"{_project(team)}/pbc-requests/{draft['id']}"
    first = owner.post(f"{path}/approve", json={"version": draft["version"]})
    assert first.status_code == 200, first.text
    old_approval = first.json()["approval"]["id"]
    approved = first.json()["request"]
    # Copying someone after approval: the approval did not cover them, so it goes back.
    changed = _assign(
        team,
        draft["id"],
        approved["version"],
        recipient="iam@client.example",
        cc=["pbc@client.example"],
        due_on=approved["due_at"][:10],
    )
    assert changed.status_code == 200, changed.text
    back = changed.json()
    assert back["request"]["status"] == "DRAFT" and back["assignable"]
    assert _audit(migrated, team["project"], "pbc.assignment_changed")[-1]["status"] == {
        "from": "APPROVAL_PENDING",
        "to": "DRAFT",
    }
    stale = owner.post(f"{path}/send", json={"approval_id": old_approval})
    assert stale.status_code == 409
    second = owner.post(f"{path}/approve", json={"version": back["request"]["version"]})
    assert second.status_code == 200, second.text
    sent = owner.post(f"{path}/send", json={"approval_id": second.json()["approval"]["id"]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["cc"] == ["pbc@client.example"]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT recipient, metadata FROM mailbox_messages WHERE project_id = %s "
            "AND metadata ->> 'request_id' = %s",
            (team["project"], draft["id"]),
        ).fetchone()
    assert row is not None
    assert row[0] == "iam@client.example" and row[1]["cc"] == ["pbc@client.example"]
    # Sent: recipients are fixed now.
    after = _details(team, draft["id"])
    assert after["assignable"] is False
    fixed = _assign(team, draft["id"], after["request"]["version"], cc=[])
    assert fixed.status_code == 409
    assert fixed.json()["detail"] == (
        "The request has been sent; its recipients can no longer change."
    )


def test_contacts_are_added_inline_and_saved_to_the_engagement(migrated: Database) -> None:
    team = _ready_engagement(migrated, "rd-contacts")
    owner = team["owner"]
    base = f"{_project(team)}/engagement-contacts"
    added = owner.post(
        base, json={"name": " Alex  Rivera ", "email": "Alex.Rivera@client.example", "role": "IT"}
    )
    assert added.status_code == 200, added.text
    assert added.json() == {
        "name": "Alex Rivera",
        "email": "alex.rivera@client.example",
        "role": "IT",
        "source": "CONTACT",
    }
    # Adding the same person again is not a second contact.
    twice = owner.post(base, json={"name": "Alex", "email": "alex.rivera@client.example"})
    assert twice.status_code == 200
    listed = owner.get(base).json()
    assert [item["email"] for item in listed].count("alex.rivera@client.example") == 1
    outside = owner.post(base, json={"name": "Sam", "email": "sam@elsewhere.example"})
    assert outside.status_code == 409
    assert "outside the organization's email domains" in outside.json()["detail"]
    assert len(_audit(migrated, team["project"], "engagement_contact.added")) == 1


def test_reference_material_stays_internal_until_someone_who_approves_shares_it(
    migrated: Database,
) -> None:
    sent = _sent(migrated, "rd-share")
    team, client = sent["team"], sent["client"]
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    path = f"{base}/pbc-requests/{sent['request_id']}"
    uploaded = client.post(
        f"{path}/attachments",
        params={"name": "prior year walkthrough.pdf"},
        content=b"%PDF-1.4 example walkthrough",
        headers={"content-type": "application/pdf"},
    )
    assert uploaded.status_code == 200, uploaded.text
    attachment = uploaded.json()
    assert attachment["visibility"] == "INTERNAL" and attachment["source"] == "UPLOAD"
    assert attachment["previewable"]
    download = client.get(f"{path}/attachments/{attachment['id']}/content")
    assert download.status_code == 200 and download.content == b"%PDF-1.4 example walkthrough"
    # The owner sees nothing internal.
    public = _public(migrated)
    headers = _verify(public, sent["token"], _code(public, sent["token"]))
    portal = public.get("/public/evidence-portal/session", headers=headers).json()
    mine = next(r for r in portal["requests"] if r["id"] == sent["request_id"])
    assert mine["references"] == []
    reference = f"/public/evidence-portal/session/requests/{sent['request_id']}/references"
    assert public.get(f"{reference}/{attachment['id']}", headers=headers).status_code == 404
    # Someone who prepares requests but may not approve them cannot share.
    with connect(migrated.url) as connection:
        member = _add_user(
            connection, team["org"], f"m-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, team["org"], team["project"], member)
    refused = _session(migrated, member).post(
        f"{path}/attachments/{attachment['id']}/visibility",
        json={"version": attachment["version"], "visibility": "SHARED"},
    )
    assert refused.status_code == 403
    shared = client.post(
        f"{path}/attachments/{attachment['id']}/visibility",
        json={"version": attachment["version"], "visibility": "SHARED"},
    )
    assert shared.status_code == 200, shared.text
    assert shared.json()["visibility"] == "SHARED" and shared.json()["shared_by"]
    portal = public.get("/public/evidence-portal/session", headers=headers).json()
    mine = next(r for r in portal["requests"] if r["id"] == sent["request_id"])
    assert [item["file_name"] for item in mine["references"]] == ["prior year walkthrough.pdf"]
    got = public.get(f"{reference}/{attachment['id']}", headers=headers)
    assert got.status_code == 200 and got.content == b"%PDF-1.4 example walkthrough"
    # Without the session, or on another request, it is not found.
    assert public.get(f"{reference}/{attachment['id']}").status_code == 401
    other = f"/public/evidence-portal/session/requests/{uuid4()}/references/{attachment['id']}"
    assert public.get(other, headers=headers).status_code == 404
    # Internal again, then removed: hidden from the owner, kept on the trail.
    hidden = client.post(
        f"{path}/attachments/{attachment['id']}/visibility",
        json={"version": shared.json()["version"], "visibility": "INTERNAL"},
    )
    assert hidden.status_code == 200, hidden.text
    assert public.get(f"{reference}/{attachment['id']}", headers=headers).status_code == 404
    removed = client.post(
        f"{path}/attachments/{attachment['id']}/remove",
        json={"version": hidden.json()["version"]},
    )
    assert removed.status_code == 200 and removed.json() == []
    assert client.get(f"{path}/attachments/{attachment['id']}/content").status_code == 404
    actions = [
        a
        for (a,) in _rows(
            migrated, "SELECT action FROM audit_events WHERE target_id = %s", sent["request_id"]
        )  # fmt: skip
    ]
    for action in (
        "pbc.attachment_added",
        "pbc.attachment_shared",
        "pbc.attachment_unshared",
        "pbc.attachment_removed",
    ):
        assert action in actions
    # An engagement file can be attached too, once: here, the evidence the owner uploads.
    given = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "access listing.csv"},
        content=b"user,role\nu1,admin\n",
        headers={**headers, "content-type": "text/csv"},
    )
    assert given.status_code == 200, given.text
    files = client.get(f"{path}/attachment-sources").json()["files"]
    assert [item["file_name"] for item in files] == ["access listing.csv"]
    linked = client.post(
        f"{path}/attachments/link", json={"source": "ENGAGEMENT_FILE", "id": files[0]["id"]}
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["source"] == "ENGAGEMENT_FILE"
    twice = client.post(
        f"{path}/attachments/link", json={"source": "ENGAGEMENT_FILE", "id": files[0]["id"]}
    )
    assert twice.status_code == 409


def _rows(migrated: Database, query: str, *params: Any) -> list[tuple[Any, ...]]:
    with connect(migrated.url) as connection:
        return list(connection.execute(query, params).fetchall())


def test_a_prior_year_workpaper_comes_only_from_the_same_clients_earlier_engagement(
    migrated: Database,
) -> None:
    prior = _new_engagement(migrated, "rd-prior")
    owner = prior["owner"]
    _complete_setup(owner, prior)
    created = owner.post(
        f"/organizations/{prior['org']}/projects",
        json={
            "name": "SOX 2027 follow-up",
            "slug": f"sox-2027-b-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(prior["owner_id"]),
            "status": "DRAFT",
        },
    )
    assert created.status_code in (200, 201), created.text
    team = {**prior, "project": UUID(created.json()["id"])}
    _complete_setup(owner, team)
    setup = owner.get(_base(team["org"], team["project"])).json()
    assert [r for r in setup["readiness"] if not r["complete"]] == []
    _launch(owner, team)
    _drafted(migrated, team)
    draft = _access_draft(team)
    control_ref = _rows(
        migrated, "SELECT control_ref FROM engagement_controls WHERE id = %s", draft["control_id"]
    )[0][0]
    with connect(migrated.url) as connection:
        acme = connection.execute(
            "INSERT INTO clients (organization_id, name) VALUES (%s, 'Acme Holdings') RETURNING id",
            (prior["org"],),
        ).fetchone()
        globex = connection.execute(
            "INSERT INTO clients (organization_id, name) VALUES (%s, 'Globex') RETURNING id",
            (prior["org"],),
        ).fetchone()
        assert acme is not None and globex is not None
        for project in (prior["project"], team["project"]):
            connection.execute(
                "UPDATE engagement_settings SET client_id = %s WHERE project_id = %s",
                (acme[0], project),
            )
        connection.execute(
            "UPDATE engagement_settings SET fiscal_year = 'FY2027' WHERE project_id = %s",
            (prior["project"],),
        )
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s",
            (prior["project"], control_ref),
        ).fetchone()
        assert control is not None
        paper = connection.execute(
            """
            INSERT INTO workpapers (
                organization_id, project_id, engagement_control_id, stage, template_key,
                current_version, draft_status, requested_by
            )
            VALUES (%s, %s, %s, 'EFFECTIVENESS', 'standard', 1, 'IDLE', %s)
            RETURNING id
            """,
            (prior["org"], prior["project"], control[0], prior["owner_id"]),
        ).fetchone()
        assert paper is not None
        from psycopg.types.json import Json

        connection.execute(
            "INSERT INTO workpaper_versions (workpaper_id, number, content, source) "
            "VALUES (%s, 1, %s, 'RECORDS')",
            (
                paper[0],
                Json(
                    {
                        "reference": f"{control_ref}-TOE",
                        "title": "Test of operating effectiveness",
                        "template_key": "standard",
                        "template_title": "Standard",
                        "template_version": 1,
                        "stage": "EFFECTIVENESS",
                        "purpose": "Prior-year testing.",
                        "sections": [
                            {
                                "key": "conclusion",
                                "title": "Conclusion",
                                "kind": "text",
                                "text": "Operating effectively.",
                            }
                        ],
                    }
                ),
            ),
        )
        connection.commit()
    path = f"{_project(team)}/pbc-requests/{draft['id']}"
    papers = owner.get(f"{path}/attachment-sources").json()["workpapers"]
    assert [(p["id"], p["year"], p["engagement"]) for p in papers] == [
        (str(paper[0]), "FY2027", "SOX 2027")
    ]
    linked = owner.post(
        f"{path}/attachments/link", json={"source": "PRIOR_YEAR_WORKPAPER", "id": str(paper[0])}
    )
    assert linked.status_code == 200, linked.text
    attached = linked.json()
    assert attached["source"] == "PRIOR_YEAR_WORKPAPER"
    assert attached["source_year"] == "FY2027" and attached["visibility"] == "INTERNAL"
    assert attached["file_name"].startswith(f"FY2027 {control_ref}-TOE")
    content = owner.get(f"{path}/attachments/{attached['id']}/content")
    assert content.status_code == 200 and content.content[:2] == b"PK"
    # Another client's engagement never offers its workpapers.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET client_id = %s WHERE project_id = %s",
            (globex[0], prior["project"]),
        )
        connection.commit()
    assert owner.get(f"{path}/attachment-sources").json()["workpapers"] == []
    refused = owner.post(
        f"{path}/attachments/link", json={"source": "PRIOR_YEAR_WORKPAPER", "id": str(paper[0])}
    )
    assert refused.status_code == 404


def test_a_draft_is_reworded_before_anyone_is_assigned(migrated: Database) -> None:
    team = _ready_engagement(migrated, "rd-reword")
    draft = _access_draft(team)
    with connect(migrated.url) as connection:
        connection.execute("UPDATE pbc_requests SET recipient = '' WHERE id = %s", (draft["id"],))
        connection.commit()
    current = _details(team, draft["id"])["request"]
    body = {
        "version": current["version"],
        "status": "DRAFT",
        "recipient": "",
        "due_at": current["due_at"],
        "evidence_description": "Please provide the signed quarterly access review.",
        "control_ref": current["control_ref"],
        "attachment_refs": [],
        "follow_up_after_days": current["follow_up_after_days"],
        "max_follow_ups": current["max_follow_ups"],
    }
    path = f"{_project(team)}/pbc-requests/{draft['id']}"
    saved = team["owner"].post(path, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["recipient"] == ""
    # Leaving draft still needs someone to send it to.
    submitted = team["owner"].post(f"{path}/submit", json={"version": saved.json()["version"]})
    assert submitted.status_code == 409


# The request names every planned requirement (FO-28, owner decision 19 November 2026)
#
# A phase request's model draft carries one item per REQUESTED requirement, in the plan's
# order, under the requirement's own title (the portal files an upload by that title,
# evidence_portal._item_requirement), of a kind the requirement allows, with its period and
# its system. A draft that drops, merges, adds, reorders or substitutes an item is rejected
# and the plan's own wording is used (pbc_drafting.check_draft). Before, coverage was
# checked by kind only: a second ticket could stand in for the access removal record, and
# one item for two.

_WINDOW = "From 1 January 2027 to 30 September 2027"
_TICKETS = PlannedItem(
    "Termination ticket for each selected leaver",
    "The HR termination ticket for each selected leaver, with the termination date.",
    ("CONTROL_EXECUTION",),
    "REQUIRED",
    _WINDOW,
)
_REMOVALS = PlannedItem(
    "Access removal record for each selected leaver",
    "The Active Directory change log entry that removed each selected leaver's access.",
    ("CONTROL_EXECUTION",),
    "REQUIRED",
    _WINDOW,
)


def _coverage_context(*planned: PlannedItem, phase: str = "INTERIM") -> DraftContext:
    return DraftContext(
        engagement="SOX 2027",
        period_end=date(2027, 12, 31),
        control_ref="ITGC-AC-02",
        title="Leaver access is removed",
        activity="IT removes a leaver's access when HR records the termination.",
        risk="A leaver keeps access.",
        domain="ACCESS",
        domain_label="",
        frequency="EVENT_DRIVEN",
        frequency_label="",
        nature="MANUAL",
        nature_label="",
        key_control=True,
        owner_name="Dana Ruiz",
        applications=("Active Directory", "SAP ERP"),
        test_attributes=(),
        pbc_items=(),
        custom_fields=(),
        phase=phase,
        planned=planned,
    )


def _asked(planned: PlannedItem, **changes: Any) -> dict[str, Any]:
    """One draft item that asks for the planned item as planned, with any changes."""
    item: dict[str, Any] = {
        "kind": PRIMARY_KIND[planned.categories[0]],
        # The title as the plan's own wording names it ("(if available)" on an optional
        # item), which a draft must keep (FO-28 review, 19 November 2026).
        "title": _planned_title(planned),
        "detail": f"Please provide this as it was recorded. {planned.description}"[:1500],
        "period": planned.period_label[:200],
    }
    return item | changes


def _coverage_draft(*items: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": "For our interim testing of ITGC-AC-02, please provide the items below.",
        "items": list(items),
    }


def test_a_phase_draft_that_leaves_out_a_planned_item_is_rejected() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    with pytest.raises(ValueError, match="^draft has 1 item for 2 planned items$"):
        check_draft(_coverage_draft(_asked(_TICKETS)), context)


def test_a_phase_draft_that_merges_two_planned_items_is_rejected() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    merged = _asked(
        _TICKETS,
        title="Termination ticket and access removal record for each selected leaver",
        detail="The HR ticket and the Active Directory change log entry for each leaver.",
    )
    with pytest.raises(ValueError, match="^draft has 1 item for 2 planned items$"):
        check_draft(_coverage_draft(merged), context)


def test_a_phase_draft_that_adds_an_item_is_rejected() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    added = {
        "kind": "other",
        "title": "Screenshots of the HR system's termination screen",
        "detail": "One screenshot of the termination screen for each selected leaver.",
    }
    with pytest.raises(ValueError, match="^draft has 3 items for 2 planned items$"):
        check_draft(_coverage_draft(_asked(_TICKETS), _asked(_REMOVALS), added), context)


def test_a_planned_item_is_not_answered_by_another_artifact() -> None:
    """The C8 case: both items are control execution evidence, so a second ticket had the
    kind the access removal record needed and was accepted in its place."""
    context = _coverage_context(_TICKETS, _REMOVALS)
    second_ticket = _asked(
        _TICKETS, detail="A second copy of the HR termination ticket for each selected leaver."
    )
    with pytest.raises(ValueError, match="^draft item 2 is not planned item 2$"):
        check_draft(_coverage_draft(_asked(_TICKETS), second_ticket), context)


def test_a_phase_draft_keeps_the_planned_order() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    with pytest.raises(ValueError, match="^draft item 1 is not planned item 1$"):
        check_draft(_coverage_draft(_asked(_REMOVALS), _asked(_TICKETS)), context)


def test_a_phase_draft_keeps_the_planned_period() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    widened = _asked(_TICKETS, period="From 1 January 2027 to 31 December 2027")
    with pytest.raises(ValueError, match="^draft item 1 changes the planned period$"):
        check_draft(_coverage_draft(widened, _asked(_REMOVALS)), context)
    unstated = _asked(_TICKETS, period="")
    with pytest.raises(ValueError, match="^draft item 1 changes the planned period$"):
        check_draft(_coverage_draft(unstated, _asked(_REMOVALS)), context)


def test_a_phase_draft_keeps_the_planned_system() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    vague = _asked(
        _REMOVALS, detail="The directory's change log entry that removed each leaver's access."
    )
    with pytest.raises(ValueError, match="^draft item 2 leaves out its planned system$"):
        check_draft(_coverage_draft(_asked(_TICKETS), vague), context)


def test_a_phase_draft_keeps_each_planned_items_kind() -> None:
    context = _coverage_context(_TICKETS, _REMOVALS)
    configured = _asked(_TICKETS, kind="configuration")
    with pytest.raises(ValueError, match="^draft item 1 is the wrong kind for planned item 1$"):
        check_draft(_coverage_draft(configured, _asked(_REMOVALS)), context)


def test_items_the_plan_cannot_tell_apart_are_worded_by_the_plan() -> None:
    """Fail closed: two planned items under one title cannot be paired with a draft's
    items, so even a draft that repeats them both is rejected."""
    twin = replace(_REMOVALS, title=_TICKETS.title)
    context = _coverage_context(_TICKETS, twin)
    with pytest.raises(ValueError, match="^the plan has two items with the same title$"):
        check_draft(_coverage_draft(_asked(_TICKETS), _asked(twin)), context)


def test_a_plan_larger_than_one_draft_is_refused_by_name() -> None:
    many = tuple(replace(_TICKETS, title=f"Termination ticket {n}") for n in range(15))
    with pytest.raises(ValueError, match="^the plan has more items than one draft can hold$"):
        check_draft(_coverage_draft(_asked(_TICKETS)), _coverage_context(*many))


def test_a_paired_phase_draft_is_used_whole() -> None:
    """Guards against a check stricter than the plan: a model may reword everything but
    each item's title, keep the title's case and the spacing between its words its own
    (the portal reads a title with both aside), mark an optional item, and say the planned
    period inside its own sentence.

    Rewritten after review (19 November 2026). Old: a title with leading spaces and a
    closing full stop ("  ACCESS management   policy.") was accepted. New: it is another
    title (test_a_draft_item_keeps_the_title_the_portal_files_by). Why: the portal files an
    upload by the title on the item's line as written (evidence_portal._item_requirement),
    so that title linked the upload to no requirement (FO-28 review, B1)."""
    policy_wording = SuiteWording(
        period="The version in force during the period, with its effective date",
        include=("Who may approve which access", "What a request must name"),
        completeness="",
        not_sufficient="",
        alternatives=(),
        note="",
    )
    policy = PlannedItem(
        "Access management policy",
        suite_description(policy_wording),
        ("PROCESS_DOCUMENTATION",),
        "REQUIRED",
        policy_wording.period,
    )
    walkthrough = PlannedItem(
        "Walkthrough instance: one access request from request to grant",
        "One recent grant in the period, with the request, the manager's approval and the "
        "grant in Active Directory.",
        ("CONTROL_EXECUTION",),
        "REQUIRED",
        "One recent grant in the period",
    )
    design = _coverage_context(policy, walkthrough, phase="DESIGN")
    accepted = check_draft(
        _coverage_draft(
            _asked(
                policy,
                title="ACCESS management   policy",
                detail="The access policy that says who approves each kind of access.",
                period="The version in force during the period, with its effective date.",
            ),
            _asked(
                walkthrough,
                detail="Walk us through one recent grant in Active Directory: the request, "
                "the manager’s approval, and the grant.",
                period="Please choose one recent grant in the period.",
            ),
        ),
        design,
    )
    assert [item.title for item in accepted.items] == [
        "ACCESS management   policy",
        walkthrough.title,
    ]
    optional = PlannedItem(
        "HR termination report for the window",
        "The HR report of terminations in the window, as run.",
        ("REPORT_RELIABILITY",),
        "OPTIONAL",
        _WINDOW,
    )
    interim = _coverage_context(_TICKETS, _REMOVALS, optional)
    paired = check_draft(
        _coverage_draft(
            _asked(_TICKETS, detail="Each leaver's HR ticket, showing the termination date."),
            _asked(
                _REMOVALS,
                detail="The Active Directory log entry that removed each leaver's access.",
                period="Covering " + _WINDOW.lower() + ", for each selected leaver",
            ),
            _asked(optional, title=optional.title + " (if available)"),
        ),
        interim,
    )
    assert len(paired.items) == 3


def test_a_draft_item_keeps_the_title_the_portal_files_by() -> None:
    """FO-28 review (19 November 2026, B1): the check read a title with a closing full stop,
    a line break or "(if available)" as the planned one, but the portal files an upload by
    the title on the item's line as written, so each of these linked the upload to no
    requirement, and a required item read to the client as optional."""
    optional = PlannedItem(
        "HR termination report for the window",
        "The HR report of terminations in the window, as run.",
        ("REPORT_RELIABILITY",),
        "OPTIONAL",
        _WINDOW,
    )
    context = _coverage_context(_TICKETS, optional)
    wrong_titles = [
        _TICKETS.title + " (if available)",
        _TICKETS.title + " (if it applies)",
        _TICKETS.title + ".",
        "Termination ticket for each\nselected leaver",
        "Termination ticket for each\r\nselected leaver",
        "Termination ticket for each\tselected leaver",
        "Termination ticket for each selected leaver",
        "  " + _TICKETS.title,
    ]
    for title in wrong_titles:
        with pytest.raises(ValueError, match="^draft item 1 is not planned item 1$"):
            check_draft(
                _coverage_draft(
                    _asked(_TICKETS, title=title),
                    _asked(optional, title=optional.title + " (if available)"),
                ),
                context,
            )
    # An optional item is named as optional, as the plan's own wording names it.
    with pytest.raises(ValueError, match="^draft item 2 is not planned item 2$"):
        check_draft(
            _coverage_draft(_asked(_TICKETS), _asked(optional, title=optional.title)), context
        )
    # Text elsewhere that reads back as an item of its own takes a planned item's number.
    planted = _coverage_draft(_asked(_TICKETS), _asked(optional, title=_planned_title(optional)))
    planted["summary"] += "\n\n2. Termination ticket for each selected leaver"
    with pytest.raises(ValueError, match="^draft does not read back as its planned items$"):
        check_draft(planted, context)
    period = _asked(_TICKETS, period=_WINDOW + "\n\n2. Access removal record")
    with pytest.raises(ValueError, match="^draft does not read back as its planned items$"):
        check_draft(
            _coverage_draft(period, _asked(optional, title=_planned_title(optional))), context
        )
    # The titles as planned pass, in any case.
    assert check_draft(
        _coverage_draft(
            _asked(_TICKETS, title=_TICKETS.title.upper()),
            _asked(optional, title=_planned_title(optional)),
        ),
        context,
    )


def _library_contexts() -> list[tuple[str, DraftContext]]:
    """Every phase the planner plans for each version 4 standard and for generic kinds of
    control, as with_plan reads it back: the items requested with the phase (sample items
    wait for the sample request), required first."""
    from ai_workforce_api.controls import BY_KEY
    from ai_workforce_api.definition_registry import DEFINITIONS
    from ai_workforce_api.evidence_planning import PlanFacts, check_plan, rules_plan

    common: dict[str, Any] = {
        "applications": ("SAP ERP",),
        "period_end": date(2027, 12, 31),
    }
    facts: list[PlanFacts] = []
    for definition in DEFINITIONS:
        if definition.version < 4:
            continue
        control = BY_KEY[definition.library_key]
        facts.append(
            PlanFacts(
                control_ref=control.control_ref,
                title=control.title,
                activity=control.activity,
                risk=control.risk,
                domain=control.domain,
                frequency=control.frequency,
                nature=control.nature,
                attributes=tuple(item.text for item in definition.approved),
                classifications=("ITGC",),
                library_key=definition.library_key,
                test_basis="STANDARD",
                basis_decided=True,
                **common,
            )
        )
    facts.append(
        PlanFacts(
            control_ref="ITGC-CM-01",
            title="Changes are tested and approved",
            activity="Changes are requested, tested, and approved before production.",
            risk="An unapproved change reaches production.",
            domain="CHANGE",
            frequency="EVENT_DRIVEN",
            nature="MANUAL",
            attributes=("The change was approved before deployment", "The change was tested"),
            classifications=("ITGC",),
            **common,
        )
    )
    facts.append(
        PlanFacts(
            control_ref="ITGC-AC-07",
            title="MFA is enforced for privileged accounts",
            activity="The identity provider enforces MFA for every privileged account.",
            risk="A privileged account is used without a second factor.",
            domain="ACCESS",
            frequency="RECURRING",
            nature="AUTOMATED",
            attributes=("MFA is required for every privileged account",),
            classifications=("ITGC",),
            **common,
        )
    )
    facts.append(
        PlanFacts(
            control_ref="RTR-05",
            title="Unusual journal entries are reviewed",
            activity="Management reviews a system-generated report of unusual journal "
            "entries each month and investigates each flagged entry.",
            risk="An unusual entry goes unreviewed.",
            domain="RECORD_TO_REPORT",
            frequency="MONTHLY",
            nature="IT_DEPENDENT_MANUAL",
            attributes=("Each flagged entry was investigated",),
            classifications=("IT_DEPENDENT_MANUAL", "BUSINESS_PROCESS"),
            process_required=True,
            process_confirmed=True,
            **common,
        )
    )
    order = {"REQUIRED": 0, "CONDITIONAL": 1, "OPTIONAL": 2}
    contexts: list[tuple[str, DraftContext]] = []
    for item in facts:
        for phase in check_plan(rules_plan(item), item).phases:
            planned = tuple(
                PlannedItem(
                    r.title,
                    r.description,
                    tuple(r.categories),
                    r.necessity,
                    wording.period
                    if (wording := suite_wording(r.description)) is not None
                    else r.period_label,
                )
                for r in sorted(phase.requirements, key=lambda r: order[r.necessity])
                if r.depends_on is None
            )
            if planned:
                contexts.append(
                    (
                        f"{item.control_ref} {phase.phase}",
                        replace(
                            _coverage_context(*planned, phase=phase.phase),
                            control_ref=item.control_ref,
                            applications=item.applications,
                        ),
                    )
                )
    return contexts


def _as_model_wrote_it(context: DraftContext) -> dict[str, Any]:
    """The plan's own wording (planned_draft) as a model's answer: each item explains
    itself, as check_draft asks of a model."""
    output = planned_draft(context).model_dump()
    for item in output["items"]:
        if len(item["detail"].strip()) < 10:
            item["detail"] = "Please provide this item as described below."
    return output


def test_the_plans_own_wording_passes_and_each_change_to_it_is_rejected() -> None:
    """The plan's own wording never fails the check (so a model that keeps it is used), and
    each single change to it is rejected: an item dropped, two neighbours swapped, a
    sibling's title in an item's place, an item's period changed. Across every version 4
    standard and generic access, change, automated and report controls."""
    contexts = _library_contexts()
    assert len(contexts) > 20
    for name, context in contexts:
        whole = _as_model_wrote_it(context)
        assert len(check_draft(whole, context).items) == len(context.planned), name
        items = whole["items"]
        # Each change with the rule that must refuse it, so none passes on another rule.
        # Review note (19 November 2026): the changes were refused by any rule, and a one-
        # item phase was changed only in its period; now every phase also gets a title.
        changed: list[tuple[str, list[dict[str, Any]], str]] = [
            (
                "title",
                [items[0] | {"title": "Screenshots of the settings"}, *items[1:]],
                "^draft item 1 is not planned item 1$",
            )
        ]
        if len(items) > 1:
            changed.append(("dropped", items[:-1], "^draft has "))
            changed.append(
                (
                    "swapped",
                    [items[1], items[0], *items[2:]],
                    "^draft item 1 is not planned item 1$",
                )
            )
            changed.append(
                (
                    "sibling",
                    [items[0] | {"title": items[1]["title"]}, *items[1:]],
                    "^draft item 1 is not planned item 1$",
                )
            )
        for index, item in enumerate(items):
            if context.planned[index].period_label.strip():
                periods = [*items]
                periods[index] = item | {"period": "As at 1 March 2031"}
                changed.append(
                    ("period", periods, f"^draft item {index + 1} changes the planned period$")
                )
                break
        for change, wrong, rule in changed:
            try:
                check_draft(whole | {"items": wrong}, context)
            except ValueError as error:
                assert re.match(rule, str(error)), (name, change, str(error))
            else:
                pytest.fail(f"{name}: the {change} change was accepted")


def test_the_plans_own_wording_reads_back_under_the_planned_titles() -> None:
    """What the portal reads from the plan's own wording (request_details.parse_wording, by
    number and title) is each planned item under the title the check holds a model's draft
    to (_planned_title): the two agree for every library phase."""
    for name, context in _library_contexts():
        read = parse_wording(render_draft(planned_draft(context))).items
        assert [(entry.number, entry.title) for entry in read] == [
            (number, _planned_title(plan)) for number, plan in enumerate(context.planned, 1)
        ], name


# The same rule through the drafting job, the redraft, and the requests it must not touch.


class _ScriptedModel:
    """A scripted model: the same answer to every call, and anything it should do while it
    'thinks' (a person or another job changing the request meanwhile)."""

    def __init__(self, output: dict[str, Any], during: Any = None) -> None:
        self.output = output
        self.during = during
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        if self.during is not None:
            self.during()
        return ModelRaw(self.output, (), 1200, 400)


def _phase_draft(migrated: Database, team: dict[str, Any], phase: str) -> tuple[UUID, UUID, UUID]:
    """ITGC-AC-01's draft for one phase, back to pending so the agent drafts it again:
    (draft, request, control)."""
    with connect(migrated.url) as connection:
        row = connection.execute(
            """
            SELECT d.id, d.pbc_request_id, d.engagement_control_id FROM pbc_drafts d
            JOIN engagement_controls c ON c.id = d.engagement_control_id
            JOIN pbc_requests r ON r.id = d.pbc_request_id
            WHERE d.project_id = %s AND c.control_ref = 'ITGC-AC-01' AND r.testing_phase = %s
            """,
            (team["project"], phase),
        ).fetchone()
        assert row is not None
        connection.execute(
            "UPDATE pbc_drafts SET status = 'PENDING', source = NULL, content = NULL, "
            "attempts = 0 WHERE id = %s",
            (row[0],),
        )
        connection.commit()
    return UUID(str(row[0])), UUID(str(row[1])), UUID(str(row[2]))


def _planned_of(
    migrated: Database, project: UUID, control: UUID, request: UUID
) -> tuple[PlannedItem, ...]:
    with connect(migrated.url) as connection:
        return with_plan(connection, load_context(connection, project, control), request).planned


def _wording(migrated: Database, request: UUID) -> str:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT evidence_description FROM pbc_requests WHERE id = %s", (request,)
        ).fetchone()
    assert row is not None
    return str(row[0])


def _draft_record(migrated: Database, draft: UUID) -> tuple[Any, ...]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, source, note FROM pbc_drafts WHERE id = %s", (draft,)
        ).fetchone()
    assert row is not None
    return tuple(row)


def test_a_short_phase_draft_falls_back_to_the_plans_wording_of_every_requirement(
    migrated: Database,
) -> None:
    team = _ready_engagement(migrated, "rd-cover")
    draft, request, control = _phase_draft(migrated, team, "DESIGN")
    with connect(migrated.url) as connection:
        titles = [
            str(row[0])
            for row in connection.execute(
                "SELECT title FROM evidence_requirements "
                "WHERE pbc_request_id = %s AND status = 'REQUESTED'",
                (request,),
            ).fetchall()
        ]
    assert len(titles) >= 2
    planned = _planned_of(migrated, team["project"], control, request)
    # Item 2 has a kind the second requirement allows, but asks for another artifact.
    substitute = _asked(
        planned[1],
        title="A second copy of the access policy",
        detail="Another copy of the access policy, as approved.",
    )
    output = _coverage_draft(_asked(planned[0]), substitute, *map(_asked, planned[2:]))
    with connect(migrated.url) as connection:
        assert run_draft(connection, _ScriptedModel(output), draft) == "DRAFTED"
    status, source, note = _draft_record(migrated, draft)
    assert (status, source) == ("DRAFTED", "FALLBACK")
    assert str(note).startswith("Model draft rejected: draft item 2 is not planned item 2.")
    wording = " ".join(_wording(migrated, request).split()).lower()
    for title in titles:
        assert " ".join(title.split()).rstrip(".").lower() in wording, title
    assert "a second copy of the access policy" not in wording
    assert _audit(migrated, team["project"], "pbc.drafted")[-1]["source"] == "FALLBACK"


def test_a_redraft_is_held_to_every_planned_item(migrated: Database) -> None:
    """The Redraft (and the console's redraft_request) reaches the same check: one item of
    a kind both planned items allow is not both of them."""
    team = _ready_engagement(migrated, "rd-recover")
    draft, request, control = _phase_draft(migrated, team, "DESIGN")
    # Offered, so the panel shows the Redraft (design review, 19 November 2026).
    assert _details(team, str(request))["redraft_refusal"] is None
    redraft = team["owner"].post(f"{_project(team)}/pbc-requests/{request}/redraft")
    assert redraft.status_code == 200, redraft.text
    planned = _planned_of(migrated, team["project"], control, request)
    assert len(planned) >= 2
    merged = _asked(
        planned[0],
        kind="design",
        title="How access is approved, with one example",
        detail="The access policy and one recent access request from request to grant.",
    )
    with connect(migrated.url) as connection:
        assert run_draft(connection, _ScriptedModel(_coverage_draft(merged)), draft) == "DRAFTED"
    status, source, note = _draft_record(migrated, draft)
    assert (status, source) == ("DRAFTED", "FALLBACK")
    assert str(note).startswith(f"Model draft rejected: draft has 1 item for {len(planned)}")
    assert "how access is approved, with one example" not in _wording(migrated, request).lower()


def _queued(migrated: Database, team: dict[str, Any], control: UUID, request: UUID) -> UUID:
    """A draft queued for the request as reconcile queues one (evidence_plans.queue_drafts):
    the worker's path, apart from the Redraft."""
    from ai_workforce_api.evidence_plans import queue_drafts

    with connect(migrated.url) as connection:
        with connection.cursor() as cursor:
            [queued] = queue_drafts(
                cursor, team["org"], team["project"], team["owner_id"], control, [request]
            )
        connection.commit()
    return queued


def test_a_sample_request_keeps_its_list_of_selected_samples(migrated: Database) -> None:
    """FO-28 review (19 November 2026, B2), through the real route: approving the samples
    drafts the sample request, gives it its phase and links the sample evidence to it as
    requested, in one transaction (evidence_plans.on_samples_approved). The guard read a
    sample request by a missing phase, which a real one never has, so a Redraft was
    accepted and the plan's items replaced the list of selected samples the client is asked
    for. A sample request is now known by its own link, and its wording stays."""
    team, client, _scheduler, plan = _approved_samples(migrated, "rd-samples")
    approved = client.post(
        f"{_api_base(team)}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sample = UUID(approved.json()["sample_request_id"])
    control = UUID(plan["engagement_control_id"])
    with connect(migrated.url) as connection:
        state = connection.execute(
            """
            SELECT r.status, r.testing_phase, (
                SELECT count(*) FROM evidence_requirements e
                WHERE e.pbc_request_id = r.id AND e.status = 'REQUESTED'
            )
            FROM pbc_requests r WHERE r.id = %s
            """,
            (sample,),
        ).fetchone()
    assert state is not None
    assert (state[0], state[1]) == ("DRAFT", "INTERIM") and state[2] > 0
    asked = _wording(migrated, sample)
    assert "We selected " in asked
    # The panel shows why in place of a Redraft that cannot succeed (design review, 19
    # November 2026: it was offered, and answered with an error).
    read = client.get(f"{_api_base(team)}/pbc-requests/{sample}/details")
    assert read.status_code == 200, read.text
    assert read.json()["redraft_refusal"] == SAMPLE_REDRAFT
    refused = client.post(f"{_api_base(team)}/pbc-requests/{sample}/redraft")
    assert refused.status_code == 409, refused.text
    assert (
        refused.json()["detail"]
        == SAMPLE_REDRAFT
        == (
            "A sample request lists the selected samples, so it is not redrafted. Edit its "
            "wording instead."
        )
    )
    # The console's redraft_request relays the same sentence, as the person reads it.
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console_tools import ToolContext, ToolFailed, execute, parse
    from ai_workforce_api.settings import Settings

    with connect(migrated.url) as connection:
        tool, parsed = parse("redraft_request", {"request_id": str(sample)})
        context = ToolContext(
            connection=connection,
            settings=Settings(database_url=migrated.url),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )
        with pytest.raises(ToolFailed) as relayed:
            execute(tool, parsed, context)
    assert str(relayed.value) == SAMPLE_REDRAFT
    # A draft queued for it (reconcile, the worker, a restart) leaves it as it is, even one
    # a model wrote that names every planned item and passes the check.
    planned = _planned_of(migrated, team["project"], control, sample)
    assert planned
    paired = _coverage_draft(*(_asked(item, title=_planned_title(item)) for item in planned))
    queued = _queued(migrated, team, control, sample)
    model = _ScriptedModel(paired)
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, queued) == "SKIPPED"
    assert model.requests == []
    assert _wording(migrated, sample) == asked
    assert _draft_record(migrated, queued) == (
        "SKIPPED",
        None,
        "A sample request lists the selected samples; its wording stays.",
    )


def test_a_request_with_planned_evidence_but_no_phase_keeps_its_wording(
    migrated: Database,
) -> None:
    """Fail closed: a request carrying requested requirements without a testing phase (a
    kickoff draft kept from before planning) is read by a draft as unplanned, which would
    ask for a population in place of its planned items, so it is not drafted."""
    team = _ready_engagement(migrated, "rd-unphased")
    _draft_id, request, control = _phase_draft(migrated, team, "INTERIM")
    with connect(migrated.url) as connection:
        connection.execute("UPDATE pbc_requests SET testing_phase = NULL WHERE id = %s", (request,))
        held = connection.execute(
            "SELECT count(*) FROM evidence_requirements "
            "WHERE pbc_request_id = %s AND status = 'REQUESTED'",
            (request,),
        ).fetchone()
        connection.commit()
    assert held is not None and held[0] > 0
    before = _wording(migrated, request)
    # Old (to 19 November 2026): "request carries planned evidence without a testing phase
    # and cannot be redrafted", which is not a sentence, so the panel showed a generic
    # line (design review). New: why, and what to do; shown in place of the Redraft.
    assert _details(team, str(request))["redraft_refusal"] == UNPHASED_REDRAFT
    refused = team["owner"].post(f"{_project(team)}/pbc-requests/{request}/redraft")
    assert refused.status_code == 409, refused.text
    assert (
        refused.json()["detail"]
        == UNPHASED_REDRAFT
        == (
            "This request has planned evidence but no testing phase, so it is not redrafted. "
            "Edit its wording instead."
        )
    )
    queued = _queued(migrated, team, control, request)
    population = _coverage_draft(
        {
            "kind": "population",
            "title": "Population of new users",
            "detail": "Every account created in the period, from the system.",
        }
    )
    model = _ScriptedModel(population)
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, queued) == "SKIPPED"
    assert model.requests == []
    assert _wording(migrated, request) == before
    assert _draft_record(migrated, queued) == (
        "SKIPPED",
        None,
        "The request carries planned evidence without a testing phase; its wording stays.",
    )


def test_a_plan_change_while_the_request_is_drafted_keeps_the_draft_out(
    migrated: Database,
) -> None:
    """The draft was checked against the requirements as they were when it started. One
    taken off the request meanwhile, without the request being reworded, made a checked
    draft name a set the plan no longer holds."""
    team = _ready_engagement(migrated, "rd-replanned")
    draft, request, control = _phase_draft(migrated, team, "DESIGN")
    planned = _planned_of(migrated, team["project"], control, request)
    assert len(planned) >= 2
    before = _wording(migrated, request)

    def replanned() -> None:
        with connect(migrated.url) as other:
            other.execute(
                "UPDATE evidence_requirements SET status = 'REMOVED', version = version + 1 "
                "WHERE pbc_request_id = %s AND status = 'REQUESTED' AND title = %s",
                (request, planned[-1].title),
            )

    model = _ScriptedModel(_coverage_draft(*map(_asked, planned)), during=replanned)
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, draft) == "SKIPPED"
    assert len(model.requests) == 1
    assert _wording(migrated, request) == before
    # Old (to 19 November 2026): "...changed while the request was drafted; redraft it.",
    # stored and shown nowhere (design review). New: what to do, on the panel and the row.
    assert _draft_record(migrated, draft) == (
        "SKIPPED",
        None,
        "The planned evidence changed during drafting. Redraft the request to match the plan.",
    )
    shown = _details(team, str(request))
    assert shown["planning"]["not_drafted"] == REPLANNED
    # A Redraft drafts it to the plan as it now is, so it is offered.
    assert shown["redraft_refusal"] is None
    # Rewritten 20 November 2026 (design review: "Not drafted" sat beside "Ready for review"
    # on a written request). Old: "Not drafted". New: "Needs redraft", the state it is in.
    assert _row_agent(team, request) == ("NOT_DRAFTED", "Needs redraft")


def test_a_plan_larger_than_one_draft_keeps_the_requests_wording(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fifteen REQUESTED requirements (a person may add more than a phase plans). Before,
    every model draft was rejected and the plan's own draft could not be built either
    (a draft holds 14 items): the job raised, retried and ended failed."""
    from ai_workforce_api import pbc_drafting

    team = _ready_engagement(migrated, "rd-fifteen")
    draft, request, _control = _phase_draft(migrated, team, "DESIGN")
    before = _wording(migrated, request)
    real = pbc_drafting.with_plan

    def fifteen(connection: Any, context: DraftContext, request_id: UUID) -> DraftContext:
        found = real(connection, context, request_id)
        extra = tuple(
            replace(found.planned[0], title=f"Signed access approval {n}") for n in range(15)
        )
        return replace(found, planned=extra)

    monkeypatch.setattr(pbc_drafting, "with_plan", fifteen)
    model = _ScriptedModel(_coverage_draft(_asked(_TICKETS)))
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, draft) == "SKIPPED"
    assert model.requests == []
    assert _wording(migrated, request) == before
    # Old (to 19 November 2026): "The plan has more items than one drafted request can
    # hold; the request keeps its current wording."; new: which wording it keeps (the test
    # plan's, of every item: evidence_plans.render_into), so nothing is asked of the person.
    # Rewritten 20 November 2026 (design review: "more items than one drafted request can
    # hold" sat beside a 15-item request holding all 15). Old: "The test plan has more items
    # than one drafted request can hold; the request keeps the test plan's wording of every
    # item."; new: which wording the request uses, and why it is not redrafted.
    assert _draft_record(migrated, draft) == (
        "SKIPPED",
        None,
        "The request uses the test plan's wording for each of its planned items, as there are "
        "too many for a redraft.",
    )


def _row_agent(team: dict[str, Any], request: UUID) -> tuple[str, str]:
    """The request's agent column in the Evidence list."""
    read = team["owner"].get(f"{_project(team)}/evidence-requests", params={"size": 100})
    assert read.status_code == 200, read.text
    [row] = [row for row in read.json()["rows"] if row["id"] == str(request)]
    return str(row["agent"]), str(row["agent_label"])


def test_more_planned_items_than_a_draft_holds_are_not_offered_a_redraft(
    migrated: Database,
) -> None:
    """Design review, 19 November 2026: a request whose plan carries more planned items
    than one draft holds was offered a Redraft that is always skipped. The panel shows why
    in its place, and a Redraft is refused with that sentence. A queued draft keeps the
    wording, which asks nothing of the person (the test plan words every item), so neither
    the panel nor the Evidence list says it was not drafted. Once the request is no longer
    a draft, no refusal is shown either."""
    team = _ready_engagement(migrated, "rd-overfull")
    _draft_id, request, control = _phase_draft(migrated, team, "DESIGN")
    with connect(migrated.url) as connection:
        carried = connection.execute(
            "SELECT count(*) FROM evidence_requirements "
            "WHERE pbc_request_id = %s AND status = 'REQUESTED'",
            (request,),
        ).fetchone()
        assert carried is not None
        # Copies of a planned requirement, as more than a phase plans (a person may add
        # them), carried by the request until it holds one more than a draft can.
        for n in range(MAX_ITEMS + 1 - int(carried[0])):
            connection.execute(
                """
                INSERT INTO evidence_requirements (
                    organization_id, project_id, plan_id, engagement_control_id, phase,
                    requirement_key, title, description, categories, objective, rationale,
                    necessity, period_start, period_end, status, origin, pbc_request_id
                )
                SELECT organization_id, project_id, plan_id, engagement_control_id, phase,
                       %s, %s, description, categories, objective, rationale, necessity,
                       period_start, period_end, status, 'PERSON', pbc_request_id
                FROM evidence_requirements
                WHERE pbc_request_id = %s AND status = 'REQUESTED'
                ORDER BY created_at, id LIMIT 1
                """,
                (f"person-extra-{n}", f"Signed access approval {n}", request),
            )
        connection.commit()
    before = _wording(migrated, request)
    assert _details(team, str(request))["redraft_refusal"] == TOO_MANY_REDRAFT
    refused = team["owner"].post(f"{_project(team)}/pbc-requests/{request}/redraft")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == TOO_MANY_REDRAFT
    queued = _queued(migrated, team, control, request)
    model = _ScriptedModel(_coverage_draft(_asked(_TICKETS)))
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, queued) == "SKIPPED"
    assert model.requests == []
    assert _wording(migrated, request) == before
    assert _draft_record(migrated, queued) == ("SKIPPED", None, TOO_MANY)
    assert _details(team, str(request))["planning"]["not_drafted"] == ""
    assert _row_agent(team, request)[0] != "NOT_DRAFTED"
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'CANCELLED', "
            "cancellation_reason = 'Replaced by another request.' WHERE id = %s",
            (request,),
        )
        connection.commit()
    gone = _details(team, str(request))
    assert gone["planning"]["not_drafted"] == "" and gone["redraft_refusal"] is None
    assert _row_agent(team, request)[0] != "NOT_DRAFTED"


def test_a_skipped_draft_that_needs_nothing_done_says_nothing() -> None:
    """Only a draft whose wording was written for other planned items asks the person to
    act: a sample, no-phase or over-full request, or one sent or reworded meanwhile, needs
    nothing done. Every
    sentence the panel or the console shows is one written for people (reviewProblem shows
    a 409 as it is only when it reads as one)."""
    from ai_workforce_api.pbc_drafting import (
        SAMPLE_REQUEST,
        UNPHASED,
        not_drafted_note,
    )

    assert not_drafted_note("SKIPPED", REPLANNED) == REPLANNED
    for note in (
        TOO_MANY,
        SAMPLE_REQUEST,
        UNPHASED,
        "The request is no longer a draft.",
        "The request was reworded while it was drafted; that wording stays.",
    ):
        assert not_drafted_note("SKIPPED", note) == ""
    assert not_drafted_note("DRAFTED", REPLANNED) == ""
    for sentence in (SAMPLE_REDRAFT, UNPHASED_REDRAFT, TOO_MANY_REDRAFT, TOO_MANY, REPLANNED):
        assert re.fullmatch(r"[A-Z][^\n]{2,300}\.", sentence), sentence


def test_a_plan_too_long_for_the_prompt_is_worded_by_the_plan_without_a_model_call(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The prompt's facts are cut at 12,000 characters, so the last planned items of a long
    phase never reached the model, and its draft could not name them. Before, the model
    was called anyway and its draft rejected, the note blaming the model."""
    from ai_workforce_api import pbc_drafting

    team = _ready_engagement(migrated, "rd-longplan")
    draft, request, _control = _phase_draft(migrated, team, "DESIGN")
    real = pbc_drafting.with_plan

    def long(connection: Any, context: DraftContext, request_id: UUID) -> DraftContext:
        found = real(connection, context, request_id)
        wordy = tuple(
            replace(
                found.planned[0],
                title=f"Signed access approval for site {n}",
                description="The signed approval of the access granted at the site. " * 26,
            )
            for n in range(9)
        )
        return replace(found, planned=wordy)

    monkeypatch.setattr(pbc_drafting, "with_plan", long)
    model = _ScriptedModel(_coverage_draft(_asked(_TICKETS)))
    with connect(migrated.url) as connection:
        assert run_draft(connection, model, draft) == "DRAFTED"
    assert model.requests == []
    assert _draft_record(migrated, draft) == (
        "DRAFTED",
        "RULES",
        "The planned items are too long for one model call; the reviewed rules drafted the "
        "request.",
    )
    wording = _wording(migrated, request)
    assert all(f"Signed access approval for site {n}" in wording for n in range(9))


def test_the_mapping_check_says_only_what_it_checks() -> None:
    """The approval panel's "Mapped to the test plan" check reads the request's
    requirements, not its wording, so it never says the wording is traced (one screen, one
    story). Old (to 19 November 2026): "2 planned items, each traced to the test plan.";
    new: what is checked, by phase; why: owner decision 19 November 2026 (FO-28), a model
    draft or a person's edit could leave a planned item out of the wording."""
    from ai_workforce_api.request_quality import quality_from

    rows = [
        (uuid4(), "E1", "Signed approval", ["CONTROL_EXECUTION"], None, None, False, True),
        (uuid4(), "E2", "Access policy", ["PROCESS_DOCUMENTATION"], None, None, False, False),
    ]

    def mapping(phase: str) -> str:
        checks = quality_from(
            uuid4(), uuid4(), phase, "Please send the approval.", "DRAFT", rows, None, False
        )
        return next(check.detail for check in checks if check.key == "mapping")

    # Design review, 19 November 2026: the label names the test plan, so the detail says
    # it once. Old: "2 planned items from the test plan. Each item that evidences an
    # attribute is linked to an approved attribute."; new below.
    assert mapping("INTERIM") == (
        "2 planned items. Attribute evidence is linked to approved attributes."
    )
    assert mapping("DESIGN") == "2 planned items."
    assert "traced" not in mapping("INTERIM") + mapping("DESIGN")
