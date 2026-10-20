"""Evidence request details (migration 0075): the request's type, its client-facing
checklist kept apart from the audit team's planning, recipients assigned inline within the
client's email domains, people copied on the email, reference material that stays
internal unless shared, and the checks run before approval and sending."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_evidence_flow import _drafted, _launch, _project
from test_evidence_portal import _code, _public, _sent, _verify
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import (
    SuiteWording,
    suite_description,
    suite_wording,
)
from ai_workforce_api.evidence_plans import _Line, render
from ai_workforce_api.pbc import PbcBody
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
            "someone@elsewhere.example is outside the client's email domains (client.example).",
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
            "auditor@elsewhere.example is outside the client's email domains (client.example).",
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
    assert "outside the client's email domains" in outside.json()["detail"]
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
