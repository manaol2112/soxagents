"""The planner drafts the engagement's setup; a person accepts it field by field."""

from datetime import date
from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_evidence_analysis import _Provider
from test_onboarding import _base, _complete_setup, _new_engagement, _pbc
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.setup_drafting import open_drafts, run_draft
from ai_workforce_api.setup_suggest import (
    SetupFacts,
    fiscal_year_of,
    owner_email_suggestions,
    rules_draft,
    suggest_cadence,
    suggest_period_end,
)

_ = migrated
TODAY = date(2026, 10, 12)


def _facts(**overrides: Any) -> SetupFacts:
    base: dict[str, Any] = {
        "project_name": "SOX FY27 Acme",
        "client_name": "Acme Corp",
        "engagement_type": "SOX_ITGC",
        "scope": "",
        "period_end": None,
        "today": TODAY,
        "areas": {"ACCESS": 6, "CHANGE": 5, "OPERATIONS": 5},
        "systems": ["SAP ECC", "Workday"],
        "key_controls": 4,
        "owners": 3,
    }
    base.update(overrides)
    return SetupFacts(**base)


def test_the_rules_draft_scope_period_and_cadence_from_the_records() -> None:
    assert fiscal_year_of("SOX FY27 Acme", TODAY) == 2027
    assert fiscal_year_of("Fiscal Year 2026 ITGC", TODAY) == 2026
    assert fiscal_year_of("Joanna Corp", TODAY) is None
    # A year far from today is not a fiscal year.
    assert fiscal_year_of("Project 1999", TODAY) is None
    period, why = suggest_period_end(_facts())
    assert period == date(2027, 12, 31)
    assert "fiscal year 2027" in why
    assert suggest_period_end(_facts(period_end=date(2027, 3, 31)))[0] == date(2027, 3, 31)
    assert suggest_cadence(_facts())[0] == (10, 3, 2)
    assert suggest_cadence(_facts(areas={"ACCESS": 45}))[0] == (14, 4, 2)
    draft = rules_draft(_facts())
    scope = draft["scope_text"]
    assert scope.startswith("SOX 404 testing of Acme Corp's IT general controls")
    assert "SAP ECC and Workday" in scope
    assert "logical access, change management and it operations" in scope
    assert "16 controls in scope, 4 key" in scope
    assert set(draft["reasons"]) == {"scope", "period_end", "cadence"}
    full = rules_draft(_facts(engagement_type="SOX_FULL", areas={"ACCESS": 2, "TREASURY": 3}))
    assert "business process controls" in full["scope_text"]
    assert "Business process areas: treasury and cash." in full["scope_text"]


class _Control:
    def __init__(self, ref: str, name: str, email: str, included: bool = True) -> None:
        self.control_ref = ref
        self.owner_name = name
        self.owner_email = email
        self.included = included


def test_owner_emails_follow_the_pattern_the_client_already_uses() -> None:
    controls = [
        _Control("AC-01", "Dana Ruiz", "dana.ruiz@client.example"),
        _Control("AC-02", "Priya Shah", "priya.shah@client.example"),
        _Control("AC-03", "Lee Park", ""),
        _Control("AC-04", "Lee Park", ""),
        _Control("CM-01", "Sam O'Neil-Jones", ""),
        _Control("CM-02", "Madonna", ""),
        _Control("CM-03", "Out Of Scope", "", included=False),
    ]
    found = owner_email_suggestions(controls, ["client.example"])
    assert [(s.owner_name, s.owner_email, s.control_refs, s.pattern) for s in found] == [
        ("Lee Park", "lee.park@client.example", ["AC-03", "AC-04"], "first.last"),
        ("Sam O'Neil-Jones", "sam.jones@client.example", ["CM-01"], "first.last"),
    ]
    # Two different patterns, or a domain outside the client's, suggest nothing.
    mixed = controls + [_Control("OP-01", "Kim Lee", "klee@client.example")]
    assert owner_email_suggestions(mixed, ["client.example"]) == []
    assert owner_email_suggestions(controls, ["other.example"]) == []
    # Without any emails to learn from, nothing is suggested.
    assert owner_email_suggestions(controls[2:], ["client.example"]) == []


def test_the_planner_drafts_the_setup_and_a_person_accepts_it(migrated: Database) -> None:
    team = _new_engagement(migrated, "setupdraft")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    profiled = owner.patch(
        f"{base}/profile", json={"client_name": "Acme Corp", "engagement_type": "SOX_FULL"}
    )
    assert profiled.status_code == 200, profiled.text
    assert profiled.json()["settings"]["client_name"] == "Acme Corp"
    assert profiled.json()["setup_draft"] is None
    asked = owner.post(f"{base}/suggestions/draft")
    assert asked.status_code == 200, asked.text
    assert asked.json()["setup_draft"]["status"] == "PENDING"
    with connect(migrated.url) as connection:
        assert open_drafts(connection) == [project]
        # Without a model, the rules draft it.
        assert run_draft(connection, None, project) == "DONE"
        assert run_draft(connection, None, project) == "SKIPPED"
    draft = owner.get(base).json()["setup_draft"]
    assert (draft["status"], draft["source"], draft["drafting"]) == ("IDLE", "RULES", False)
    assert draft["period_end"] == "2027-12-31"
    assert draft["scope_text"].startswith("SOX 404 testing of Acme Corp's IT general controls")
    assert "reviewed rules" in draft["note"]
    # Claude's draft is checked: a period far from today falls back to the rules.
    assert owner.post(f"{base}/suggestions/draft").status_code == 200
    provider = _Provider(
        [
            {
                "scope_text": "The engagement covers Acme Corp's ITGCs for FY2027.",
                "period_end": "1999-12-31",
                "pbc_due_days": 12,
                "pbc_follow_up_days": 4,
                "pbc_max_follow_ups": 3,
                "reasons": {"cadence": "Owners are new to the process."},
            }
        ]
    )
    with connect(migrated.url) as connection:
        assert run_draft(connection, provider, project) == "DONE"
    assert "Client: Acme Corp" in provider.requests[0].prompt
    draft = owner.get(base).json()["setup_draft"]
    assert draft["source"] == "AGENT"
    assert draft["scope_text"] == "The engagement covers Acme Corp's ITGCs for FY2027."
    assert draft["period_end"] == "2027-12-31"
    assert (draft["pbc_due_days"], draft["pbc_follow_up_days"], draft["pbc_max_follow_ups"]) == (
        12,
        4,
        3,
    )
    assert draft["reasons"]["cadence"] == "Owners are new to the process."
    assert "fiscal year 2027" in draft["reasons"]["period_end"]
    # Accepting applies only the chosen fields, against the version shown.
    stale = owner.post(
        f"{base}/suggestions/accept", json={"version": draft["version"] - 1, "fields": ["scope"]}
    )
    assert stale.status_code == 409
    accepted = owner.post(
        f"{base}/suggestions/accept",
        json={"version": draft["version"], "fields": ["scope", "cadence"]},
    )
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["scope"] == "The engagement covers Acme Corp's ITGCs for FY2027."
    assert body["settings"]["pbc_due_days"] == 12
    assert body["settings"]["period_end"] is None
    later = owner.post(
        f"{base}/suggestions/accept", json={"version": draft["version"], "fields": ["period_end"]}
    )
    assert later.status_code == 200
    assert later.json()["settings"]["period_end"] == "2027-12-31"
    with connect(migrated.url) as connection:
        actions = {
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE target_id = %s", (project,)
            ).fetchall()
        }
    assert {
        "onboarding.profile",
        "onboarding.setup_drafted",
        "onboarding.setup_accepted",
    } <= actions


def test_owner_emails_are_suggested_and_applied_to_every_control_they_own(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "ownermail")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    # The library needs an in-scope system first.
    assert owner.post(f"{base}/applications", json={"name": "SAP ERP"}).status_code == 200
    assert owner.post(f"{base}/controls/load-library").status_code == 200
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    controls = owner.get(base).json()["controls"]
    access = [c for c in controls if c["domain"] == "ACCESS"]
    change = [c for c in controls if c["domain"] == "CHANGE"]
    # One owner with an email teaches the pattern; two are named without one.
    taught = owner.post(
        f"{base}/controls/owner",
        json={
            "domain": "ACCESS",
            "owner_name": "Dana Ruiz",
            "owner_email": "dana.ruiz@client.example",
        },
    )
    assert taught.status_code == 200, taught.text
    for control in change[:2]:
        fields = {
            "version": control["version"],
            "included": True,
            "key_control": control["key_control"],
            "owner_name": "Lee Park",
            "owner_email": "",
            "frequency": control["frequency"],
            "nature": control["nature"],
            "application_ids": [],
            "template_key": control["template_key"],
        }
        patched = owner.patch(f"{base}/controls/{control['id']}", json=fields)
        assert patched.status_code == 200, patched.text
    suggested = owner.get(base).json()["owner_suggestions"]
    assert [(s["owner_name"], s["owner_email"]) for s in suggested] == [
        ("Lee Park", "lee.park@client.example")
    ]
    assert sorted(suggested[0]["control_refs"]) == sorted(c["control_ref"] for c in change[:2])
    applied = owner.post(
        f"{base}/controls/owner-emails",
        json={"entries": [{"owner_name": "lee park", "owner_email": "Lee.Park@client.example"}]},
    )
    assert applied.status_code == 200, applied.text
    after = {c["control_ref"]: c["owner_email"] for c in applied.json()["controls"]}
    for control in change[:2]:
        assert after[control["control_ref"]] == "lee.park@client.example"
    assert applied.json()["owner_suggestions"] == []
    assert all(after[c["control_ref"]] == "dana.ruiz@client.example" for c in access)
    bad = owner.post(
        f"{base}/controls/owner-emails",
        json={"entries": [{"owner_name": "Lee Park", "owner_email": "not-an-email"}]},
    )
    assert bad.status_code == 422


def test_a_started_engagement_is_not_redrafted(migrated: Database) -> None:
    team = _new_engagement(migrated, "setupdone")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    _complete_setup(owner, team)
    plan = owner.post(f"{base}/plan").json()["plan"]
    started = owner.post(
        f"{base}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    assert owner.post(f"{base}/suggestions/draft").status_code == 409
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO setup_drafts (project_id, organization_id, requested_by) "
            "VALUES (%s, %s, %s)",
            (project, org, team["owner_id"]),
        )
        connection.commit()
        assert run_draft(connection, None, project) == "SKIPPED"
    assert owner.get(base).json()["setup_draft"]["status"] == "IDLE"


def test_a_new_engagement_carries_its_profile(migrated: Database) -> None:
    team = _new_engagement(migrated, "profile")
    owner, org = team["owner"], team["org"]
    created = owner.post(
        f"/organizations/{org}/projects",
        json={
            "name": "FY27 ITGC Globex",
            "slug": f"globex-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(team["owner_id"]),
            "status": "DRAFT",
            "client_name": "Globex",
            "engagement_type": "IT_AUDIT",
            "period_end": "2027-06-30",
        },
    )
    assert created.status_code in (200, 201), created.text
    body = owner.get(_base(org, UUID(created.json()["id"]))).json()
    assert body["settings"]["client_name"] == "Globex"
    assert body["settings"]["engagement_type"] == "IT_AUDIT"
    assert body["settings"]["period_end"] == "2027-06-30"
    refused = owner.post(
        f"/organizations/{org}/projects",
        json={
            "name": "Bad",
            "slug": f"bad-{uuid4().hex[:6]}",
            "scope": "",
            "owner_user_id": str(team["owner_id"]),
            "engagement_type": "SOMETHING",
        },
    )
    assert refused.status_code == 422


def test_a_draft_ending_before_the_period_starts_is_refused_not_failed(
    migrated: Database,
) -> None:
    """A draft made before the period was aligned to the name's year can end before the
    period now starts; accepting it was a database error (503). It is refused, and the
    period and the rest of the draft stay usable."""
    team = _new_engagement(migrated, "setupstale")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    profiled = owner.patch(
        f"{base}/profile",
        json={
            "client_name": "Acme Corp",
            "engagement_type": "SOX_ITGC",
            "period_start": "2027-01-01",
            "period_end": "2027-12-31",
        },
    )
    assert profiled.status_code == 200, profiled.text
    assert owner.post(f"{base}/suggestions/draft").status_code == 200
    with connect(migrated.url) as connection:
        assert run_draft(connection, None, project) == "DONE"
        # The draft as it stood before the period moved to fiscal 2027.
        connection.execute(
            "UPDATE setup_drafts SET period_end = '2026-12-31' WHERE project_id = %s",
            (project,),
        )
        connection.commit()
    draft = owner.get(base).json()["setup_draft"]
    refused = owner.post(
        f"{base}/suggestions/accept",
        json={"version": draft["version"], "fields": ["scope", "period_end"]},
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "the suggested period end is not after the period start"
    settings = owner.get(base).json()["settings"]
    assert (settings["period_start"], settings["period_end"]) == ("2027-01-01", "2027-12-31")
    accepted = owner.post(
        f"{base}/suggestions/accept", json={"version": draft["version"], "fields": ["scope"]}
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["scope"] == draft["scope_text"]
