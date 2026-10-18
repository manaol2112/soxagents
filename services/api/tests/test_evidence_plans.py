"""Evidence plans, end to end: every control planned by phase at kickoff, requests made
by phase, planning again without duplicates, populations validated before sampling, and
people's decisions kept."""

from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from support import Database
from test_evidence_intake import _engagement, _request
from test_outbound import migrated
from test_testing_engine import _add, _base, _read_all, _year

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import PHASES, rules_plan
from ai_workforce_api.evidence_plans import generate, load_facts, plan_body
from ai_workforce_api.master_plans import PendingRevisionDecision, decide_pending_revision
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest

_ = migrated


def _control(database: Database, team: dict[str, Any], ref: str) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s",
            (team["project"], ref),
        ).fetchone()
    assert row is not None
    return str(row[0])


def _plan(client: TestClient, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    found = client.get(f"{_base(team)}/controls/{control_id}/evidence-plan")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _phase(plan: dict[str, Any], phase: str) -> dict[str, Any]:
    return next(item for item in plan["phases"] if item["phase"] == phase)


def _requirement(plan: dict[str, Any], phase: str, key: str) -> dict[str, Any]:
    return next(r for r in _phase(plan, phase)["requirements"] if r["key"] == key)


def _counts(database: Database, control_id: str) -> tuple[int, int, int]:
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT (SELECT count(*) FROM evidence_requirements WHERE engagement_control_id = %s),
                   (SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s),
                   (SELECT count(*) FROM evidence_plans WHERE engagement_control_id = %s)
            """,
            (control_id, control_id, control_id),
        ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1]), int(row[2])


def test_kickoff_plans_every_phase_of_every_control(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-kickoff")
    with connect(migrated.url) as connection:
        plans = connection.execute(
            "SELECT count(*) FROM evidence_plans WHERE project_id = %s", (team["project"],)
        ).fetchone()
        phases = connection.execute(
            "SELECT count(*) FROM evidence_plan_phases WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert plans == (19,)
    assert phases == (57,)
    plan = _plan(client, team, _control(migrated, team, "ITGC-AC-01"))
    # Kickoff proposed it; the fixture approved it, as a person does, which released the
    # requests (the planning gate).
    assert plan["status"] == "APPROVED"
    assert plan["source"] == "RULES"
    assert [p["phase"] for p in plan["phases"]] == list(PHASES)
    design, interim, roll = (_phase(plan, phase) for phase in PHASES)
    # Design and interim each have their own request; the roll-forward waits, and says so.
    assert design["applicability"] == interim["applicability"] == "APPLICABLE"
    assert len(design["requests"]) == len(interim["requests"]) == 1
    assert design["requests"][0]["id"] != interim["requests"][0]["id"]
    # Drafted at kickoff and not sent: not outstanding with the owner yet.
    assert design["state"] == interim["state"] == "NOT_SENT"
    assert design["state_label"] == "Requests drafted, not sent"
    assert roll["applicability"] == "CONDITIONAL"
    assert roll["state"] == "CONDITIONAL"
    assert roll["requests"] == []
    assert roll["condition"]
    assert {r["state"] for r in roll["requirements"]} <= {"NOT_GENERATED", "AWAITING_DEPENDENCY"}
    for phase in plan["phases"]:
        for requirement in phase["requirements"]:
            assert requirement["rationale"] and requirement["categories"]
            assert requirement["objective"] and requirement["phase"] == phase["phase"]
    # Sample evidence waits for the population and the sample the team selects.
    sample = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert sample["state"] == "AWAITING_DEPENDENCY"
    assert (
        sample["depends_on_title"] == _requirement(plan, "INTERIM", "interim-population")["title"]
    )
    assert "POPULATION" in _requirement(plan, "INTERIM", "interim-population")["categories"]
    assert not {c for r in design["requirements"] for c in r["categories"]} & {
        "POPULATION",
        "SAMPLE",
    }
    # An automated control is tested from its configuration, without a population.
    automated = _plan(client, team, _control(migrated, team, "ITGC-AC-05"))
    for phase in automated["phases"]:
        assert not {c for r in phase["requirements"] for c in r["categories"]} & {
            "POPULATION",
            "SAMPLE",
        }


def test_planning_again_never_duplicates_and_changes_to_an_approved_plan_wait(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-again")
    control_id = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control_id}"
    before = _counts(migrated, control_id)
    for _ in range(2):
        again = client.post(f"{base}/evidence-plan/generate")
        assert again.status_code == 200, again.text
    assert _counts(migrated, control_id) == before
    plan = again.json()
    assert len(plan["runs"]) == 3
    assert plan["runs"][0]["changes"] == {
        "added": [],
        "updated": [],
        "flagged": [],
        "removed": [],
        "kept": [],
    }
    approved = client.post(f"{base}/evidence-plan/approve", json={"version": plan["version"]})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert approved.json()["approved_by"]

    # The agent plans again over the approved plan: its change is proposed, never applied.
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(control_id))
        output = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        interim = next(p for p in output["phases"] if p["phase"] == "INTERIM")
        item = next(r for r in interim["requirements"] if r["key"] == "interim-population")
        item["description"] += " Include each monthly access listing as its own sheet."
        generate(connection, _Planner(output), org, project, UUID(control_id), team["owner_id"])
    replanned = _plan(client, team, control_id)
    assert replanned["status"] == "CHANGES_PROPOSED"
    assert replanned["pending_changes"] > 0
    pending = [
        r for p in replanned["phases"] for r in p["requirements"] if r["pending_change"] is not None
    ]
    population = _requirement(replanned, "INTERIM", "interim-population")
    assert population in pending
    assert "monthly" not in population["description"].lower()
    assert "monthly" in population["pending_change"]["description"].lower()
    refused = client.post(f"{base}/evidence-plan/approve", json={"version": replanned["version"]})
    assert refused.status_code == 409
    for requirement in pending:
        decided = client.post(
            f"{base}/evidence-requirements/{requirement['id']}/change",
            json={"decision": "ACCEPT", "version": requirement["version"]},
        )
        assert decided.status_code == 200, decided.text
    current = decided.json()
    assert current["pending_changes"] == 0
    # Accepting it revised the plan: it goes back for approval before anything else runs.
    assert current["status"] == "PROPOSED" and current["revision"] > replanned["revision"]
    accepted = _requirement(current, "INTERIM", "interim-population")
    assert "monthly" in accepted["description"].lower()
    # The interim request is still a draft, so it now asks for the monthly population.
    with connect(migrated.url) as connection:
        text = connection.execute(
            "SELECT evidence_description FROM pbc_requests WHERE id = %s",
            (accepted["request_id"],),
        ).fetchone()
    assert text is not None and "monthly" in str(text[0])
    approved = client.post(f"{base}/evidence-plan/approve", json={"version": current["version"]})
    assert approved.status_code == 200, approved.text
    assert approved.json()["needs_review"] == 0
    assert approved.json()["approved_revision"] == current["revision"]

    # The control itself changes after approval: the plan is no longer approved, and
    # planning again applies to the plan the reviewer will see.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET frequency = 'WEEKLY' WHERE id = %s", (control_id,)
        )
        connection.commit()
    withdrawn = _plan(client, team, control_id)
    assert withdrawn["status"] == "PROPOSED" and withdrawn["approved_by"] is None
    assert withdrawn["revision"] > current["revision"]
    replanned = client.post(f"{base}/evidence-plan/generate").json()
    assert replanned["status"] == "PROPOSED" and replanned["pending_changes"] == 0


def test_a_change_after_interim_adds_roll_forward_evidence_for_review(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-change")
    year = _year(migrated, team)
    control_id = _control(migrated, team, "ITGC-AC-05")
    base = f"{_base(team)}/controls/{control_id}"
    plan = _plan(client, team, control_id)
    client.post(f"{base}/evidence-plan/approve", json={"version": plan["version"]})
    changed = client.post(
        f"{base}/control-changes",
        json={
            "effective_on": f"{year}-11-15",
            "kind": "CONFIGURATION",
            "description": "Password length raised to 14 characters",
        },
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert [c["kind"] for c in body["changes"]] == ["CONFIGURATION"]
    added = _requirement(body, "ROLLFORWARD", "rollforward-change-1")
    assert f"15 November {year}" in added["description"]
    assert added["needs_review"] is True
    assert _requirement(body, "DESIGN", "design-change-1")["needs_review"] is True
    assert body["status"] == "CHANGES_PROPOSED"
    # The plan was approved: the change's exceptions and approvals are proposed to the
    # reviewer with the revised understanding, not written into the approved plan.
    assert body["pending_revision"] is True
    assert not body["understanding"]["exceptions"]
    master = client.get(f"{base}/master-plan").json()
    assert master["pending_revision"]["understanding"]["exceptions"]
    assert master["pending_revision"]["understanding"]["approvals_required"]
    assert master["state"] == "APPROVED"
    accepted = client.post(
        f"{base}/evidence-plan/pending-revision",
        json={"decision": "ACCEPT", "version": master["version"]},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["understanding"]["exceptions"]
    assert accepted.json()["understanding"]["approvals_required"]
    assert accepted.json()["state"] != "APPROVED"
    too_late = client.post(
        f"{base}/control-changes",
        json={"effective_on": f"{year + 1}-02-01", "kind": "PROCESS", "description": "Later"},
    )
    assert too_late.status_code == 422


def test_samples_wait_for_a_population_a_person_accepted(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "plan-population")
    year = _year(migrated, team)
    control_id = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control_id}"
    interim = _request(migrated, team, "ITGC-AC-01")
    plan = _plan(client, team, control_id)
    # Nothing has arrived for the design evidence: it cannot be judged sufficient.
    design_item = _phase(plan, "DESIGN")["requirements"][0]
    early = client.post(
        f"{base}/evidence-requirements/{design_item['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": design_item["version"]},
    )
    assert early.status_code == 409
    assert early.json()["detail"] == "nothing has been received for this requirement yet"

    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, interim["id"])
    _read_all(migrated, scheduler)
    plan = _plan(client, team, control_id)
    received = _requirement(plan, "INTERIM", "interim-population")
    # Received is not validated: the phase says so, and the samples wait.
    assert received["state"] == "RECEIVED"
    assert _phase(plan, "INTERIM")["state"] == "RECEIVED_NOT_VALIDATED"
    [test] = client.get(f"{_base(team)}/control-tests").json()
    blocked = client.post(
        f"{_base(team)}/control-tests/{test['id']}/approve", json={"version": test["version"]}
    )
    assert blocked.status_code == 409
    assert "population is not validated" in blocked.json()["detail"]
    register = client.get(f"{_base(team)}/workspace/controls").json()
    row = next(c for c in register if c["id"] == control_id)
    assert row["next_step"] == "Accept the population on the evidence plan"

    insufficient = client.post(
        f"{base}/evidence-requirements/{received['id']}/sufficiency",
        json={"sufficiency": "INSUFFICIENT", "version": received["version"]},
    )
    assert insufficient.status_code == 422
    for key in ("interim-population", "interim-population-support"):
        item = _requirement(_plan(client, team, control_id), "INTERIM", key)
        accepted = client.post(
            f"{base}/evidence-requirements/{item['id']}/sufficiency",
            json={"sufficiency": "ACCEPTED", "version": item["version"]},
        )
        assert accepted.status_code == 200, accepted.text
    approved = client.post(
        f"{_base(team)}/control-tests/{test['id']}/approve", json={"version": test["version"]}
    )
    assert approved.status_code == 200, approved.text
    sample_request = approved.json()["sample_request_id"]
    plan = _plan(client, team, control_id)
    sample = _requirement(plan, "INTERIM", "interim-sample-evidence")
    assert sample["status"] == "REQUESTED"
    assert sample["request_id"] == sample_request
    with connect(migrated.url) as connection:
        phase = connection.execute(
            "SELECT testing_phase, evidence_description FROM pbc_requests WHERE id = %s",
            (sample_request,),
        ).fetchone()
    assert phase is not None and phase[0] == "INTERIM"
    assert "evidence the control was performed as designed" in str(phase[1])
    # Accepted evidence is not completed testing: the sample request is drafted, and
    # nothing has gone to the owner for it yet.
    assert _phase(plan, "INTERIM")["state"] == "NOT_SENT"
    assert _phase(plan, "INTERIM")["testing_complete"] is False


def test_a_person_decides_whether_a_phase_applies_and_planning_keeps_it(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-phase")
    control_id = _control(migrated, team, "ITGC-AC-02")
    base = f"{_base(team)}/controls/{control_id}"
    roll = _phase(_plan(client, team, control_id), "ROLLFORWARD")
    missing = client.post(
        f"{base}/evidence-plan/phases/ROLLFORWARD",
        json={
            "applicability": "NOT_APPLICABLE",
            "rationale": "The population was not received from the owner yet, so skip it.",
            "version": roll["version"],
        },
    )
    assert missing.status_code == 409
    assert missing.json()["detail"] == "missing evidence is not a reason a phase does not apply"
    short = client.post(
        f"{base}/evidence-plan/phases/ROLLFORWARD",
        json={"applicability": "NOT_APPLICABLE", "rationale": "Not needed.", "version": 1},
    )
    assert short.status_code == 422
    reason = (
        "The engagement scope covers this control to the interim date only; the client "
        "retires the application on 30 September and its year-end replacement is in scope."
    )
    decided = client.post(
        f"{base}/evidence-plan/phases/ROLLFORWARD",
        json={"applicability": "NOT_APPLICABLE", "rationale": reason, "version": roll["version"]},
    )
    assert decided.status_code == 200, decided.text
    roll = _phase(decided.json(), "ROLLFORWARD")
    assert (roll["applicability"], roll["origin"], roll["state"]) == (
        "NOT_APPLICABLE",
        "PERSON",
        "NOT_APPLICABLE",
    )
    assert roll["rationale"] == reason
    assert {r["state"] for r in roll["requirements"]} == {"REMOVED"}
    # Planning again keeps the person's decision.
    again = client.post(f"{base}/evidence-plan/generate").json()
    assert _phase(again, "ROLLFORWARD")["applicability"] == "NOT_APPLICABLE"
    assert _phase(again, "ROLLFORWARD")["rationale"] == reason
    # Made applicable again, the phase gets its evidence back and its own request.
    reopened = client.post(
        f"{base}/evidence-plan/phases/ROLLFORWARD",
        json={
            "applicability": "APPLICABLE",
            "rationale": "Coverage to year end is needed after all.",
            "version": _phase(again, "ROLLFORWARD")["version"],
        },
    )
    assert reopened.status_code == 200, reopened.text
    # Deciding a phase revises the plan: nothing is requested until it is approved again.
    assert reopened.json()["status"] == "PROPOSED"
    assert _phase(reopened.json(), "ROLLFORWARD")["requests"] == []
    approved = client.post(
        f"{base}/evidence-plan/approve", json={"version": reopened.json()["version"]}
    )
    assert approved.status_code == 200, approved.text
    roll = _phase(approved.json(), "ROLLFORWARD")
    assert len(roll["requests"]) == 1
    assert {r["state"] for r in roll["requirements"]} <= {"DRAFT", "AWAITING_DEPENDENCY"}
    with connect(migrated.url) as connection:
        phase = connection.execute(
            "SELECT testing_phase FROM pbc_requests WHERE id = %s", (roll["requests"][0]["id"],)
        ).fetchone()
    assert phase == ("ROLLFORWARD",)


def test_waiving_needs_a_reason_and_takes_the_item_off_its_draft_request(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-waive")
    control_id = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control_id}"
    plan = _plan(client, team, control_id)
    item = _requirement(plan, "DESIGN", "design-procedure")
    refused = client.post(
        f"{base}/evidence-requirements/{item['id']}/waive",
        json={"reason": "No evidence was provided by the owner.", "version": item["version"]},
    )
    assert refused.status_code == 409
    waived = client.post(
        f"{base}/evidence-requirements/{item['id']}/waive",
        json={
            "reason": "The access policy is already on file from the prior-year audit.",
            "version": item["version"],
        },
    )
    assert waived.status_code == 200, waived.text
    after = _requirement(waived.json(), "DESIGN", "design-procedure")
    assert after["state"] == "NOT_APPLICABLE"
    assert after["waive_reason"].startswith("The access policy")
    with connect(migrated.url) as connection:
        text = connection.execute(
            "SELECT evidence_description FROM pbc_requests WHERE id = %s", (item["request_id"],)
        ).fetchone()
    assert text is not None and item["title"] not in str(text[0])
    restored = client.post(
        f"{base}/evidence-requirements/{item['id']}/restore", json={"version": after["version"]}
    )
    assert restored.status_code == 200, restored.text
    assert _requirement(restored.json(), "DESIGN", "design-procedure")["status"] == "REQUESTED"


class _Planner:
    """A model that answers with a given plan."""

    def __init__(self, output: dict[str, Any]) -> None:
        self.output = output
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        return ModelRaw(self.output, (), 100, 100)


def test_the_agent_plans_when_its_plan_passes_the_checks(migrated: Database) -> None:
    team, _client, _scheduler = _engagement(migrated, "plan-agent")
    control_id = UUID(_control(migrated, team, "ITGC-AC-03"))
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, control_id)
        good = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        good["understanding"]["summary"] = "The agent's own reading of the access review."
        planner = _Planner(good)
        generate(connection, planner, org, project, control_id, team["owner_id"])
        body = plan_body(connection, project, control_id)
        assert body.source == "MODEL"
        # The plan was approved: the agent's reading is proposed to the reviewer, and
        # applied only when they accept it.
        assert body.pending_revision is True and body.status == "CHANGES_PROPOSED"
        assert body.understanding["summary"] != "The agent's own reading of the access review."
        decide_pending_revision(
            connection, org, project, control_id, team["owner_id"],
            PendingRevisionDecision(version=body.version, decision="ACCEPT"),
        )  # fmt: skip
        body = plan_body(connection, project, control_id)
        assert body.status == "PROPOSED"
        assert body.understanding["summary"] == "The agent's own reading of the access review."
        assert "<control>" in planner.requests[0].prompt
        assert planner.requests[0].system.startswith("You are an experienced SOX IT audit")
        bad = rules_plan(facts).model_dump(mode="json", exclude_none=True)
        interim = next(p for p in bad["phases"] if p["phase"] == "INTERIM")
        interim["requirements"][0]["description"] = "Please choose 2 samples yourself."
        bad["understanding"]["summary"] = "You select the samples from the review list."
        generate(connection, _Planner(bad), org, project, control_id, team["owner_id"])
        body = plan_body(connection, project, control_id)
        calls = connection.execute(
            "SELECT count(*) FROM model_calls WHERE project_id = %s", (project,)
        ).fetchone()
    assert body.source == "RULES"
    assert "rejected" in body.note and "select samples" in body.note
    assert calls == (2,)


def test_reading_a_plan_needs_project_access(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "plan-access")
    other, other_client, _ = _engagement(migrated, "plan-other")
    control_id = _control(migrated, team, "ITGC-AC-01")
    assert other_client.get(f"{_base(team)}/controls/{control_id}/evidence-plan").status_code in (
        403,
        404,
    )
    # A control from another engagement is not visible through this one.
    foreign = _control(migrated, other, "ITGC-AC-01")
    assert client.get(f"{_base(team)}/controls/{foreign}/evidence-plan").status_code == 404
