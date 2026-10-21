"""Control context: attributes owned by controls, supporting documents, process
understanding for the controls that depend on it, readiness, and the tester's rigour.

None of it needs a process narrative: a narrative is one supporting document among others.
"""

from pathlib import Path
from typing import Any
from uuid import UUID

from support import Database, approve_control_plan
from test_evidence_analysis import _Provider
from test_evidence_intake import _accept_population, _engagement, _request
from test_manual_controls import _body
from test_onboarding import _base as _setup_base
from test_outbound import migrated
from test_testing_engine import _add, _base, _Citing, _read_all, _year

from ai_workforce_api.context_routes import review_control
from ai_workforce_api.control_context import context_package
from ai_workforce_api.db import connect
from ai_workforce_api.pbc_drafting import load_context
from ai_workforce_api.readiness import resume_testing
from ai_workforce_api.testing_engine import (
    UNSUPPORTED_EXCEPTION,
    UNSUPPORTED_PASS,
    ItemFile,
    run_sheet,
    supported,
)

__all__ = ["migrated"]


# Helpers


def _control(client: Any, team: dict[str, Any], ref: str) -> dict[str, Any]:
    controls = client.get(f"{_base(team)}/workspace/controls").json()
    return next(c for c in controls if c["control_ref"] == ref)


def _context(client: Any, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    found = client.get(f"{_base(team)}/controls/{control_id}/context")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _check(context: dict[str, Any], key: str) -> dict[str, Any]:
    return next(c for c in context["readiness"]["checks"] if c["key"] == key)


def _new_control(client: Any, team: dict[str, Any], **overrides: object) -> dict[str, Any]:
    added = client.post(
        f"{_setup_base(team['org'], team['project'])}/controls/new", json=_body(**overrides)
    )
    assert added.status_code == 200, added.text
    ref = overrides.get("control_ref", "REV-09")
    found = _control(client, team, str(ref))
    # Nothing is requested before a person approves the control's evidence plan.
    approve_control_plan(Database(client.app.state.settings.database_url), found["id"])
    return found


def _population(client: Any, team: dict[str, Any], migrated: Database, ref: str, name: str) -> None:
    year = _year(migrated, team)
    rows = "Credit note,Customer,Date,Approver\n" + "".join(
        f"CN-{n},Customer {n},{year}-{(n % 12) + 1:02d}-15,Finance Manager\n" for n in range(1, 41)
    )
    _add(client, team, name, rows, _request(migrated, team, ref)["id"])


def _plan(client: Any, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    plans = client.get(f"{_base(team)}/control-tests").json()
    return next(p for p in plans if p["engagement_control_id"] == control_id)


def _approve(client: Any, team: dict[str, Any], plan: dict[str, Any]) -> Any:
    _accept_population(client, team, plan["engagement_control_id"])
    return client.post(
        f"{_base(team)}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )


# 1, 2, 3: controls, attributes, and evidence without a narrative; an ITGC is tested


def test_an_itgc_is_defined_evidenced_and_tested_without_a_narrative(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ctx-itgc")
    control = _control(client, team, "ITGC-AC-01")
    context = _context(client, team, control["id"])
    assert context["classifications"] == ["ITGC"]
    assert context["process_required"] is False
    assert _check(context, "process")["status"] == "NOT_APPLICABLE"
    assert context["documents"] == [] and context["understanding"]["status"] == "NONE"
    # The library's attributes are the control's own, approved, with their source.
    approved = context["attributes"]["approved"]
    assert approved and all(a["source_kind"] == "LIBRARY" for a in approved)
    assert [a["text"] for a in approved] == control["test_attributes"]
    # Waiting for evidence, not for a narrative.
    assert context["readiness"]["state"] == "EVIDENCE_PENDING"
    assert _check(context, "evidence")["status"] == "PENDING"
    # Evidence goes straight to the control.
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    context = _context(client, team, control["id"])
    assert context["readiness"]["state"] == "READY", context["readiness"]
    assert _check(context, "scope")["status"] in ("OK", "WARN")
    approved_plan = _approve(client, team, _plan(client, team, control["id"]))
    assert approved_plan.status_code == 200, approved_plan.text
    assert _control(client, team, "ITGC-AC-01")["readiness_state"] == "READY"


def test_the_team_maintains_attributes_with_history(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-attrs", settle=False)
    control = _new_control(client, team, control_ref="REV-20", domain="ORDER_TO_CASH")
    base = f"{_base(team)}/controls/{control['id']}"
    context = _context(client, team, control["id"])
    first, second = context["attributes"]["approved"]
    assert (first["source_kind"], first["basis"]) == ("MANUAL", "DOCUMENTED")
    added = client.post(f"{base}/attributes", json={"text": "The approval is dated."})
    assert added.status_code == 200, added.text
    assert (
        client.post(f"{base}/attributes", json={"text": "the approval is DATED"}).status_code == 409
    )
    edited = client.patch(
        f"{base}/attributes/{first['id']}",
        json={
            "text": "Approval is by the finance manager or delegate",
            "version": first["version"],
        },
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()["attributes"]
    assert [a["text"] for a in body["approved"]] == [
        "Approval is by the finance manager or delegate",
        "Approval precedes posting",
        "The approval is dated.",
    ]
    replaced = next(a for a in body["approved"] if a["position"] == 0)
    assert replaced["replaces_id"] == first["id"]
    assert [(a["id"], a["status"]) for a in body["history"]] == [(first["id"], "RETIRED")]
    # The control's own list follows, for every module that reads it.
    assert _control(client, team, "REV-20")["test_attributes"][0].startswith("Approval is by")
    stale = client.patch(
        f"{base}/attributes/{first['id']}", json={"text": "x", "version": first["version"]}
    )
    assert stale.status_code == 409
    for item in body["approved"][1:]:
        retired = client.post(
            f"{base}/attributes/{item['id']}/retire", json={"version": item["version"]}
        )
        assert retired.status_code == 200, retired.text
    last = _context(client, team, control["id"])["attributes"]["approved"][0]
    kept = client.post(f"{base}/attributes/{last['id']}/retire", json={"version": last["version"]})
    assert kept.status_code == 409
    with connect(migrated.url) as connection:
        actions = [
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s "
                "AND target_type = 'control_attribute' ORDER BY created_at",
                (team["project"],),
            ).fetchall()
        ]
    assert actions == [
        "attribute.added",
        "attribute.edited",
        "attribute.retired",
        "attribute.retired",
    ]


# 4, 5, 7: business process controls


def test_a_business_control_is_tested_on_alternative_documentation(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ctx-bp")
    control = _new_control(client, team, control_ref="REV-21", domain="ORDER_TO_CASH")
    cid = control["id"]
    context = _context(client, team, cid)
    assert context["classifications"] == ["BUSINESS_PROCESS"] and context["process_required"]
    assert context["readiness"]["state"] == "PROCESS_UNDERSTANDING_INCOMPLETE"
    process = _check(context, "process")
    assert process["status"] == "BLOCKED"
    assert (
        "business process control is tested against how its process runs"
        in (process["blockers"][0]["why"])
    )
    # Missing evidence is its own check, separate from the missing process context.
    assert _check(context, "evidence")["status"] == "PENDING"
    _population(client, team, migrated, "REV-21", "credit notes population.csv")
    _read_all(migrated, scheduler)
    plan = _plan(client, team, cid)
    blocked = _approve(client, team, plan)
    assert (blocked.status_code, blocked.json()["detail"]) == (409, "control not ready")
    # A policy, not a narrative, documents the process.
    policy = client.post(
        f"{_base(team)}/source-documents",
        json={
            "kind": "POLICY",
            "title": "Credit note policy",
            "text": (
                "The billing team raises each credit note in SAP.\n"
                "Credit notes over 5,000 are approved by the finance manager before posting."
            ),
            "control_ids": [cid],
        },
    )
    assert policy.status_code == 200, policy.text
    document = policy.json()["document"]["id"]
    built = client.post(f"{_base(team)}/controls/{cid}/process/build")
    assert built.status_code == 200, built.text
    understanding = built.json()["understanding"]
    assert understanding["status"] == "DRAFT" and understanding["built_by"] == "RULES"
    bases = {step["basis"] for step in understanding["steps"]}
    assert bases == {"DOCUMENTED", "INFERRED"}
    control_step = next(s for s in understanding["steps"] if s["control_point"])
    assert (control_step["basis"], control_step["source"]) == ("DOCUMENTED", "control")
    # The team keeps the documented steps, cites the policy, and confirms.
    steps = [
        {
            "description": "Billing raises the credit note in SAP.",
            "actor": "Billing team",
            "system": "SAP",
            "basis": "DOCUMENTED",
            "source": document,
            "quote": "The billing team raises each credit note in SAP",
        },
        {**control_step, "quote": control_step["quote"]},
        {
            "description": "Approved credit notes are posted.",
            "basis": "DOCUMENTED",
            "source": document,
            "quote": "words the policy never says",
        },
    ]
    no_point = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"steps": [steps[0]], "version": understanding["version"], "confirm": True},
    )
    assert (no_point.status_code, no_point.json()["detail"]) == (
        409,
        "mark the step where the control operates",
    )
    confirmed = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"summary": "", "steps": steps, "version": understanding["version"], "confirm": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    saved = confirmed.json()["understanding"]
    assert saved["status"] == "CONFIRMED" and saved["confirmed_by"]
    assert [s["basis"] for s in saved["steps"]] == ["DOCUMENTED", "DOCUMENTED", "INFERRED"]
    assert saved["steps"][0]["source_title"] == "Credit note policy"
    assert confirmed.json()["readiness"]["state"] == "READY"
    # A short population is shown for a person to look at, without stopping the test.
    scope = _check(confirmed.json(), "scope")
    assert scope["status"] == "WARN"
    assert "weekly control should show about" in scope["blockers"][0]["detail"]
    approved = _approve(client, team, _plan(client, team, cid))
    assert approved.status_code == 200, approved.text
    assert {d["kind"] for d in confirmed.json()["documents"]} == {"POLICY"}


def test_missing_evidence_is_told_apart_from_missing_process(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-states")
    control = _new_control(client, team, control_ref="REV-22", domain="PROCURE_TO_PAY")
    cid = control["id"]
    assert _context(client, team, cid)["readiness"]["state"] == "PROCESS_UNDERSTANDING_INCOMPLETE"
    assert _control(client, team, "REV-22")["readiness_state"] == "PROCESS_UNDERSTANDING_INCOMPLETE"
    # A walkthrough written by the team establishes the understanding: no document at all.
    confirmed = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={
            "summary": "From the walkthrough with the AP manager.",
            "steps": [
                {"description": "AP enters the invoice.", "actor": "AP clerk"},
                {"description": "The AP manager approves the payment run.", "control_point": True},
            ],
            "version": 0,
            "confirm": True,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert {s["basis"] for s in confirmed.json()["understanding"]["steps"]} == {"TEAM"}
    state = confirmed.json()["readiness"]
    assert state["state"] == "EVIDENCE_PENDING"
    assert _check(confirmed.json(), "process")["status"] == "OK"
    # Editing without confirming makes it a draft again, and blocks again.
    draft = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"steps": confirmed.json()["understanding"]["steps"],
              "version": confirmed.json()["understanding"]["version"]},
    )  # fmt: skip
    assert draft.json()["readiness"]["state"] == "PROCESS_UNDERSTANDING_INCOMPLETE"
    # An ITGC marked as a business process control too needs the understanding.
    itgc = _control(client, team, "ITGC-AC-02")
    marked = client.put(
        f"{_base(team)}/controls/{itgc['id']}/classifications",
        json={"classifications": ["ITGC", "BUSINESS_PROCESS"]},
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["process_required"] and marked.json()["classifications_overridden"]
    reset = client.put(f"{_base(team)}/controls/{itgc['id']}/classifications", json={})
    assert reset.json()["classifications"] == ["ITGC"]


# 6: criteria


def test_missing_criteria_block_testing(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ctx-criteria")
    control = _control(client, team, "ITGC-AC-01")
    # An RCM row without test procedures: the control has no attributes.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET test_attributes = '[]'::jsonb WHERE id = %s",
            (control["id"],),
        )
        connection.commit()
    context = _context(client, team, control["id"])
    assert context["attributes"]["approved"] == []
    assert {a["status"] for a in context["attributes"]["history"]} == {"RETIRED"}
    criteria = _check(context, "criteria")
    assert criteria["status"] == "BLOCKED"
    assert criteria["blockers"][0]["detail"] == "The control has no approved test attributes."
    assert criteria["blockers"][0]["resolve"]
    assert context["readiness"]["state"] == "NEEDS_INFORMATION"
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    rows = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", rows, kickoff["id"])
    _read_all(migrated, scheduler)
    assert _approve(client, team, _plan(client, team, control["id"])).status_code == 409
    added = client.post(
        f"{_base(team)}/controls/{control['id']}/attributes",
        json={"text": "Access is approved before it is granted."},
    )
    # The attribute revised the test plan: testing waits for a reviewer to approve it.
    assert added.json()["readiness"]["state"] == "PLAN_NOT_APPROVED"
    # Samples wait for the plan too; once a reviewer approves it, the control is ready.
    assert _approve(client, team, _plan(client, team, control["id"])).status_code == 409
    path = f"{_base(team)}/controls/{control['id']}/evidence-plan"
    plan = client.get(path).json()
    assert client.post(f"{path}/approve", json={"version": plan["version"]}).status_code == 200
    assert _context(client, team, control["id"])["readiness"]["state"] == "READY"


# 8: conflicts


def test_conflicting_sources_wait_for_a_person(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-conflict")
    control = _new_control(client, team, control_ref="REV-23", domain="ORDER_TO_CASH")
    cid = control["id"]
    written = client.post(
        f"{_base(team)}/source-documents",
        json={
            "kind": "PROCEDURE",
            "title": "Credit note procedure",
            "text": "Credit notes are reviewed quarterly by the controller.",
            "control_ids": [cid],
        },
    )
    assert written.status_code == 200, written.text
    context = _context(client, team, cid)
    [issue] = [i for i in context["issues"] if i["status"] == "OPEN"]
    assert (issue["origin"], issue["kind"], issue["topic"], issue["raised_by"]) == (
        "SOURCES", "CONFLICT", "Frequency", "RULES",
    )  # fmt: skip
    assert "weekly" in issue["detail"] and "quarterly" in issue["detail"]
    assert issue["quotes"][0]["quote"] == "Credit notes are reviewed quarterly by the controller"
    assert context["readiness"]["state"] == "CONFLICT_REQUIRES_REVIEW"
    assert _check(context, "conflicts")["status"] == "BLOCKED"
    # The agents are told what is already open, so they do not raise it again.
    with connect(migrated.url) as connection:
        loaded = load_context(connection, team["project"], UUID(cid))
        package = context_package(
            connection, team["project"], UUID(cid), loaded, ["BUSINESS_PROCESS"]
        )
    assert [(i["kind"], i["topic"]) for i in package["open_issues"]] == [("CONFLICT", "Frequency")]
    path = f"{_base(team)}/controls/{cid}/issues/{issue['id']}/resolve"
    assert (
        client.post(path, json={"status": "RESOLVED", "note": " ", "version": 1}).status_code == 422
    )
    resolved = client.post(
        path,
        json={"status": "RESOLVED", "note": "Owner confirms weekly; procedure is out of date.",
              "version": issue["version"]},
    )  # fmt: skip
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["readiness"]["state"] == "PROCESS_UNDERSTANDING_INCOMPLETE"
    # Linking the same document again raises nothing new.
    again = client.post(
        f"{_base(team)}/source-documents/{written.json()['document']['id']}/links",
        json={"control_ids": [cid]},
    )
    assert again.status_code == 200
    assert [i["status"] for i in _context(client, team, cid)["issues"]] == ["RESOLVED"]


# 9, 10, 11, 12: a narrative added later


def test_a_narrative_added_later_proposes_and_never_overwrites(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-later")
    first = _control(client, team, "ITGC-AC-01")
    second = _control(client, team, "ITGC-AC-02")
    before = _context(client, team, first["id"])["attributes"]["approved"]
    uploaded = client.post(
        f"{_base(team)}/source-documents/upload",
        params={
            "kind": "NARRATIVE",
            "title": "Access management narrative",
            "file_name": "access narrative.txt",
            "control_id": [first["id"], second["id"]],
        },
        content=b"Access is removed within 3 business days of termination.\r\nManagers approve.",
        headers={"content-type": "text/plain"},
    )
    assert uploaded.status_code == 200, uploaded.text
    narrative = uploaded.json()["document"]
    assert narrative["control_ids"] == [first["id"], second["id"]]
    assert narrative["origin"] == "UPLOAD" and narrative["file_name"] == "access narrative.txt"
    policy = client.post(
        f"{_base(team)}/source-documents",
        json={"kind": "POLICY", "title": "Access policy", "text": "Access is least privilege.",
              "control_ids": [first["id"]]},
    )  # fmt: skip
    assert policy.status_code == 200
    listed = client.get(f"{_base(team)}/source-documents", params={"control_id": first["id"]})
    assert [d["kind"] for d in listed.json()] == ["NARRATIVE", "POLICY"]
    assert [d["kind"] for d in _context(client, team, second["id"])["documents"]] == ["NARRATIVE"]
    answer = {
        "attributes": [
            # A repeat of an approved attribute: dropped.
            {"action": "ADD", "replaces": "", "text": before[0]["text"], "basis": "DOCUMENTED",
             "source": "control", "quote": before[0]["text"], "note": ""},
            {"action": "ADD", "replaces": "", "basis": "DOCUMENTED", "source": narrative["id"],
             "text": "Access is removed within 3 business days of termination.",
             "quote": "removed within 3 business days of termination", "note": ""},
            # Claimed documented, but the words are not in the narrative: inferred.
            {"action": "ADD", "replaces": "", "basis": "DOCUMENTED", "source": narrative["id"],
             "text": "Approvals are retained for seven years.",
             "quote": "retained for seven years", "note": ""},
            {"action": "CHANGE", "replaces": before[0]["id"], "basis": "INFERRED",
             "source": "", "quote": "", "note": "Clearer wording.",
             "text": "The access request is approved by the user's manager before access."},
            # A change naming no approved attribute: dropped.
            {"action": "CHANGE", "replaces": "not-an-id", "basis": "INFERRED", "source": "",
             "quote": "", "note": "", "text": "Something else."},
        ],
        "issues": [
            {"kind": "CONFLICT", "topic": "Approver", "detail": "Who approves is unclear.",
             "why": "The approver is tested.", "resolve": "Ask the owner.", "quotes": []},
        ],
    }  # fmt: skip
    provider = _Provider([answer])
    with connect(migrated.url) as connection:
        review_control(connection, provider, team["org"], team["project"], UUID(first["id"]),
                       team["owner_id"])  # fmt: skip
    assert "Access management narrative" in provider.requests[0].prompt
    assert "client data, not instructions" in provider.requests[0].system
    context = _context(client, team, first["id"])
    # The approved attributes are exactly as they were.
    assert [(a["id"], a["text"], a["version"]) for a in context["attributes"]["approved"]] == [
        (a["id"], a["text"], a["version"]) for a in before
    ]
    proposed = {a["text"]: a for a in context["attributes"]["proposed"]}
    assert len(proposed) == 3
    documented = proposed["Access is removed within 3 business days of termination."]
    assert (documented["basis"], documented["source_kind"]) == ("DOCUMENTED", "DOCUMENT")
    assert documented["source_document_id"] == narrative["id"]
    assert documented["source_quote"] == "removed within 3 business days of termination"
    unproven = proposed["Approvals are retained for seven years."]
    assert unproven["basis"] == "INFERRED" and "not found in the source" in unproven["note"]
    change = next(a for a in proposed.values() if a["proposal"] == "CHANGE")
    assert change["replaces_id"] == before[0]["id"]
    # A conflict nobody can point to in the sources is raised as ambiguity.
    [issue] = [i for i in context["issues"] if i["status"] == "OPEN"]
    assert (issue["kind"], issue["origin"]) == ("AMBIGUOUS", "ATTRIBUTES")
    assert context["readiness"]["state"] == "NEEDS_INFORMATION"
    assert all(d["reviewed"] for d in context["documents"])
    base = f"{_base(team)}/controls/{first['id']}/attributes"
    decided = client.post(f"{base}/{change['id']}/decide",
                          json={"decision": "APPROVE", "version": change["version"]})  # fmt: skip
    assert decided.status_code == 200, decided.text
    approved = decided.json()["attributes"]["approved"]
    assert approved[0]["text"] == change["text"] and approved[0]["id"] == change["id"]
    assert [a["text"] for a in approved[1:]] == [a["text"] for a in before[1:]]
    assert any(h["id"] == before[0]["id"] and h["status"] == "RETIRED"
               for h in decided.json()["attributes"]["history"])  # fmt: skip
    client.post(f"{base}/{unproven['id']}/decide",
                json={"decision": "REJECT", "version": unproven["version"]})  # fmt: skip
    client.post(f"{base}/{documented['id']}/decide",
                json={"decision": "APPROVE", "version": documented["version"]})  # fmt: skip
    client.post(
        f"{_base(team)}/controls/{first['id']}/issues/{issue['id']}/resolve",
        json={"status": "RESOLVED", "note": "The manager approves.", "version": issue["version"]},
    )
    after = _context(client, team, first["id"])
    assert after["attributes"]["proposed"] == []
    assert _check(after, "criteria")["status"] == "OK"
    assert _control(client, team, "ITGC-AC-01")["test_attributes"][-1] == documented["text"]
    # The same review again proposes nothing it already has, and raises nothing settled.
    with connect(migrated.url) as connection:
        review_control(connection, _Provider([answer]), team["org"], team["project"],
                       UUID(first["id"]), team["owner_id"])  # fmt: skip
    again = _context(client, team, first["id"])
    assert again["attributes"]["proposed"] == []
    assert [i["status"] for i in again["issues"]] == ["RESOLVED"]


# 13: records from before


def test_existing_narratives_carry_over_and_the_backfill_repeats(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-legacy")
    control = _new_control(client, team, control_ref="REV-24", domain="ORDER_TO_CASH")
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_narratives (
                organization_id, project_id, engagement_control_id, text, source, status,
                confirmed_by, confirmed_at
            )
            VALUES (%s, %s, %s, 'Credit notes are raised by billing and approved weekly.',
                    'PERSON', 'CONFIRMED', %s, clock_timestamp())
            """,
            (team["org"], team["project"], control["id"], team["owner_id"]),
        )
        connection.commit()
        sql = Path(__file__).resolve().parents[3] / "migrations" / "0061_control_context.sql"
        carry = sql.read_text(encoding="utf-8").split("-- 7. The 0060 narratives, carried over")[1]
        for _ in range(2):
            connection.execute(carry)
            connection.commit()
        counts = connection.execute(
            """
            SELECT (SELECT count(*) FROM source_documents d
                    JOIN control_narratives n ON n.id = d.legacy_narrative_id
                    WHERE n.engagement_control_id = %s),
                   (SELECT count(*) FROM source_document_controls WHERE engagement_control_id = %s),
                   (SELECT count(*) FROM process_understandings WHERE engagement_control_id = %s)
            """,
            (control["id"], control["id"], control["id"]),
        ).fetchone()
        mismatched = connection.execute(
            """
            SELECT c.control_ref FROM engagement_controls c
            WHERE c.project_id = %s AND c.test_attributes IS DISTINCT FROM (
                SELECT coalesce(jsonb_agg(a.text ORDER BY a.position), '[]'::jsonb)
                FROM control_attributes a
                WHERE a.engagement_control_id = c.id AND a.status = 'APPROVED')
            """,
            (team["project"],),
        ).fetchall()
    assert counts == (1, 1, 1)
    assert mismatched == []
    context = _context(client, team, control["id"])
    assert context["understanding"]["status"] == "CONFIRMED"
    assert context["understanding"]["built_by"] == "LEGACY"
    assert _check(context, "process")["status"] == "OK"
    assert [d["kind"] for d in context["documents"]] == ["NARRATIVE"]


# 15: no unsupported pass


def test_a_pass_stands_only_on_cited_evidence(migrated: Database) -> None:
    files = (ItemFile("t.csv", "other", "ticket,user", None, file_id=UUID(int=1)),)
    results = [
        {"index": 0, "result": "PASS", "note": "ok", "citations": []},
        {"index": 1, "result": "PASS", "note": "ok", "citations": [{"quote": "ticket"}]},
        {"index": 2, "result": "EXCEPTION", "note": "late", "citations": []},
        {"index": 3, "result": "UNABLE", "note": "?", "citations": []},
        {"index": 4, "result": "EXCEPTION", "note": "late", "citations": [{"quote": "ticket"}],
         "observed": "Approved after the grant.", "expected": "Approved before it."},
    ]  # fmt: skip
    kept = supported(results, files)
    # Rewritten in M3c (owner's rule: every exception explains the observed and expected
    # conditions and its supporting evidence). Before, an exception with neither citation
    # nor explanation (index 2) stood as EXCEPTION; it now goes to a person (REVIEW). An
    # explained, cited exception (index 4, added) still stands.
    assert [r["result"] for r in kept] == ["UNABLE", "PASS", "REVIEW", "UNABLE", "EXCEPTION"]
    assert kept[0]["note"].startswith(UNSUPPORTED_PASS)
    assert kept[2]["note"].startswith(UNSUPPORTED_EXCEPTION)
    assert [r["result"] for r in supported(results[1:2], ())] == ["UNABLE"]
    # End to end: a tester that passes everything without citing anything proves nothing.
    team, client, scheduler = _engagement(migrated, "ctx-pass")
    control = _new_control(client, team, control_ref="REV-25", domain="ITAC", nature="AUTOMATED",
                           application_id=_app(client, team))  # fmt: skip
    _add(client, team, "REV-25 configuration.txt", "Three-way match tolerance: 0%.",
         _request(migrated, team, "REV-25")["id"])  # fmt: skip
    _read_all(migrated, scheduler)
    sheet = _single_sheet(migrated, control["id"])
    attributes = len(control["test_attributes"])
    plain = _Provider([{"results": [{"index": i, "result": "PASS", "note": "Seen."}
                                    for i in range(attributes)]}])  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_sheet(connection, plain, sheet) == "DONE"
    found = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == str(sheet)
    )
    cells = found["items"][0]["cells"]
    assert [c["proposed"] for c in cells] == ["UNABLE"] * attributes
    assert all(c["note"].startswith(UNSUPPORTED_PASS) for c in cells)
    assert found["proposed_conclusion"] == "INCOMPLETE"


# The tester waits for a control that is not ready


def test_the_tester_waits_until_the_control_is_ready(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ctx-wait")
    control = _new_control(client, team, control_ref="REV-26", domain="ORDER_TO_CASH",
                           nature="AUTOMATED")  # fmt: skip
    cid = control["id"]
    assert _context(client, team, cid)["classifications"] == [
        "AUTOMATED_APPLICATION", "BUSINESS_PROCESS",
    ]  # fmt: skip
    _add(client, team, "REV-26 configuration.txt", "Credit limit block is active.",
         _request(migrated, team, "REV-26")["id"])  # fmt: skip
    _read_all(migrated, scheduler)
    sheet = _single_sheet(migrated, cid)
    count = len(control["test_attributes"])
    provider = _Citing(
        [{"results": [{"index": i, "result": "PASS", "note": "Seen."} for i in range(count)]}]
    )
    with connect(migrated.url) as connection:
        run_sheet(connection, provider, sheet)
    assert provider.requests == []
    waiting = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == str(sheet)
    )
    assert waiting["waiting_note"].startswith("Testing waits: process understanding incomplete.")
    assert all(item["state"] != "TESTED" for item in waiting["items"])
    client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"steps": [{"description": "SAP blocks orders over the credit limit.",
                         "control_point": True}], "version": 0, "confirm": True},
    )  # fmt: skip
    with connect(migrated.url) as connection:
        # The confirmation already asked the sheet to run again.
        assert resume_testing(connection, team["project"], UUID(cid)) == []
        assert run_sheet(connection, provider, sheet) == "DONE"
    assert len(provider.requests) == 1
    tested = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == str(sheet)
    )
    assert tested["waiting_note"] == ""
    assert all(item["state"] == "TESTED" for item in tested["items"])


# 16: boundaries


def test_the_context_stays_inside_its_engagement(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-mine")
    other, theirs, _other_scheduler = _engagement(migrated, "ctx-theirs")
    control = _control(client, team, "ITGC-AC-01")
    path = f"{_base(team)}/controls/{control['id']}/context"
    assert theirs.get(path).status_code in (403, 404)
    foreign = f"/organizations/{other['org']}/projects/{other['project']}/controls/{control['id']}"
    assert theirs.get(f"{foreign}/context").status_code == 404
    assert theirs.post(f"{foreign}/attributes", json={"text": "Mine now."}).status_code == 404
    # A document cannot be linked to another engagement's control.
    with connect(migrated.url) as connection:
        stranger = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id <> %s LIMIT 1", (team["project"],)
        ).fetchone()
    assert stranger is not None
    refused = client.post(
        f"{_base(team)}/source-documents",
        json={"kind": "OTHER", "title": "x", "text": "y", "control_ids": [str(stranger[0])]},
    )
    assert refused.status_code == 422
    secret = client.post(
        f"{_base(team)}/source-documents",
        json={"kind": "OTHER", "title": "keys", "text": "api_key=sk-live-123456789012345678"},
    )
    assert secret.status_code == 422


def _app(client: Any, team: dict[str, Any]) -> str:
    body = client.get(f"{_setup_base(team['org'], team['project'])}").json()
    return str(body["applications"][0]["id"])


def _single_sheet(migrated: Database, control_id: str) -> UUID:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT id FROM test_sheets WHERE engagement_control_id = %s "
            "AND method = 'TEST_OF_ONE' AND test_round_id IS NULL",
            (control_id,),
        ).fetchone()
    assert row is not None, "no test sheet for the control"
    return UUID(str(row[0]))


def test_a_control_tested_once_from_its_configuration_needs_no_population() -> None:
    """A manual control whose configuration evidence opened a single test is ready on
    that evidence, as the tester decides it; it is not waiting for a population."""
    from ai_workforce_api.readiness import Facts, evaluate

    facts = Facts(
        id=UUID(int=1),
        control_ref="ITGC-AC-01",
        title="Password configuration",
        activity="Password parameters are configured.",
        frequency="RECURRING",
        nature="MANUAL",
        domain="ACCESS",
        classifications=["ITGC"],
        application_id=None,
        approved=1,
        evidence_read=1,
        sheet_status="OPEN",
        sheet_method="TEST_OF_ONE",
        master_status="APPROVED",
        master_revision=1,
    )
    found = evaluate(facts)
    assert found.state == "READY"
    checks = {check.key: check.status for check in found.checks}
    assert (checks["evidence"], checks["scope"]) == ("OK", "NOT_APPLICABLE")
    # The same control waiting for a population is evidence pending, never blocked.
    waiting = evaluate(Facts(**{**facts.__dict__, "sheet_method": None, "sheet_status": None}))
    assert waiting.state == "EVIDENCE_PENDING" and not waiting.blocking


def test_a_later_review_replaces_the_agents_earlier_conflicts(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "ctx-supersede")
    control = _control(client, team, "ITGC-AC-02")
    written = client.post(
        f"{_base(team)}/source-documents",
        json={"kind": "POLICY", "title": "Access policy",
              "text": "New access is approved by the IT director.", "control_ids": [control["id"]]},
    )  # fmt: skip
    document = written.json()["document"]["id"]
    conflict = {
        "attributes": [],
        "issues": [
            {"kind": "CONFLICT", "topic": "Approver", "detail": "The RCM and policy differ.",
             "why": "The approver is tested.", "resolve": "Ask the owner.",
             "quotes": [{"source": document, "quote": "approved by the IT director"}]},
        ],
    }  # fmt: skip
    with connect(migrated.url) as connection:
        review_control(connection, _Provider([conflict]), team["org"], team["project"],
                       UUID(control["id"]), team["owner_id"])  # fmt: skip
    first = _context(client, team, control["id"])
    [issue] = [i for i in first["issues"] if i["status"] == "OPEN"]
    assert (issue["kind"], issue["origin"]) == ("CONFLICT", "ATTRIBUTES")
    assert first["readiness"]["state"] == "CONFLICT_REQUIRES_REVIEW"
    with connect(migrated.url) as connection:
        review_control(connection, _Provider([{"attributes": [], "issues": []}]), team["org"],
                       team["project"], UUID(control["id"]), team["owner_id"])  # fmt: skip
    second = _context(client, team, control["id"])
    assert [i for i in second["issues"] if i["status"] == "OPEN"] == []
    assert second["readiness"]["state"] != "CONFLICT_REQUIRES_REVIEW"
