"""The engagement profile: the period agrees with the engagement's own words or a person
confirms it, the methodology is chosen before launch, independence cannot be switched off
in production, and team and scope changes say what they affect first."""

from collections.abc import Iterator
from datetime import date
from typing import Any
from uuid import UUID

import pytest
from support import Database, approve_evidence_plans
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _complete_setup, _control_fields, _new_engagement
from test_outbound import migrated

from ai_workforce_api import independence
from ai_workforce_api.db import connect
from ai_workforce_api.main import create_app
from ai_workforce_api.profile_checks import basis, period_conflicts
from ai_workforce_api.settings import Settings
from ai_workforce_api.setup_drafting import _Answer, _checked
from ai_workforce_api.setup_suggest import SetupFacts, rules_draft

__all__ = ["migrated"]

TODAY = date(2026, 10, 17)


@pytest.fixture(autouse=True)
def _restore() -> Iterator[None]:
    yield
    independence.configure(True)


def _readiness(owner: Any, base: str) -> dict[str, dict[str, Any]]:
    return {item["step"]: item for item in owner.get(base).json()["readiness"]}


def _launch(owner: Any, base: str) -> None:
    preview = owner.get(base).json()["plan_preview"]
    started = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert started.status_code == 200, started.text


# The checks themselves


def test_a_name_and_scope_that_name_another_year_disagree_with_the_period() -> None:
    conflicts = period_conflicts(
        "2027 SOX Audit",
        "IT general controls for the fiscal year ending December 31, 2027.",
        None,
        date(2026, 12, 31),
        "",
        TODAY,
    )
    assert {c.kind for c in conflicts} == {"NAME_YEAR", "SCOPE_DATE"}
    assert all(c.blocking for c in conflicts)
    assert "31 December 2026" in conflicts[0].message


def test_a_name_that_points_at_another_year_offers_both_corrections() -> None:
    # Corrected where the conflict is shown (decided by the product owner): move the
    # period end to the name's year, or change the name's year to the period's.
    conflicts = period_conflicts("SOX FY2028", "", None, date(2027, 12, 31), "", TODAY)
    name_year = next(c for c in conflicts if c.kind == "NAME_YEAR")
    assert name_year.period_end_fix == date(2028, 12, 31)
    assert name_year.name_fix == "SOX FY2027"
    # The name keeps its own style: two digits stay two digits.
    short = period_conflicts("SOX FY28", "", None, date(2027, 6, 30), "", TODAY)
    fixes = next(c for c in short if c.kind == "NAME_YEAR")
    assert (fixes.name_fix, fixes.period_end_fix) == ("SOX FY27", date(2028, 6, 30))
    # Other conflicts carry no correction of this kind.
    scope_only = period_conflicts(
        "SOX audit", "Testing through December 31, 2028.", None, date(2027, 12, 31), "", TODAY
    )
    assert all(c.period_end_fix is None and c.name_fix is None for c in scope_only)


def test_an_interim_date_or_an_agreeing_period_is_not_flagged() -> None:
    assert (
        period_conflicts(
            "SOX FY27",
            "Interim testing through 30 September 2027; period ending 31 December 2027.",
            date(2027, 1, 1),
            date(2027, 12, 31),
            "FY2027",
            TODAY,
        )
        == []
    )


def test_the_fiscal_year_label_order_and_length_are_checked() -> None:
    labelled = period_conflicts("Audit", "", None, date(2026, 12, 31), "FY2027", TODAY)
    assert [c.kind for c in labelled] == ["FISCAL_YEAR"]
    short = period_conflicts("Audit", "", date(2026, 7, 1), date(2026, 12, 31), "", TODAY)
    assert [(c.kind, c.blocking) for c in short] == [("PERIOD_LENGTH", False)]
    backwards = period_conflicts("Audit", "", date(2027, 1, 1), date(2026, 12, 31), "", TODAY)
    assert [c.kind for c in backwards] == ["PERIOD_ORDER"]


def test_the_basis_changes_with_any_of_the_words_or_dates() -> None:
    first = basis("SOX 2027", "Scope", None, date(2027, 12, 31), "")
    assert first == basis("SOX  2027", "Scope ", None, date(2027, 12, 31), "")
    assert first != basis("SOX 2027", "Scope.", None, date(2027, 12, 31), "")
    assert first != basis("SOX 2027", "Scope", None, date(2026, 12, 31), "")


def test_the_planner_never_keeps_a_narrative_that_names_another_period() -> None:
    facts = SetupFacts(
        project_name="2027 SOX Audit",
        client_name="Acme Corp",
        engagement_type="SOX_ITGC",
        scope="",
        period_end=date(2026, 12, 31),
        today=TODAY,
        systems=["SAP ECC"],
    )
    rules = rules_draft(facts)
    answer = _Answer(
        scope_text="ITGCs over SAP ECC through December 31, 2027.",
        period_end=date(2027, 12, 31),
        pbc_due_days=10,
        pbc_follow_up_days=3,
        pbc_max_follow_ups=2,
    )
    checked = _checked(answer, rules, facts)
    # The recorded period stands, and the narrative is the rules' own.
    assert checked["period_end"] == date(2026, 12, 31)
    assert checked["scope_text"] == rules["scope_text"]
    assert checked["note"] != ""
    agreeing = answer.model_copy(update={"scope_text": "ITGCs over SAP ECC for 2026."})
    kept = _checked(agreeing, rules, facts)
    assert kept["scope_text"] == "ITGCs over SAP ECC for 2026."
    assert kept["note"] == ""


# Before launch


def test_launch_waits_for_the_methodology(migrated: Database) -> None:
    team = _new_engagement(migrated, "methodology")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET methodology = NULL WHERE project_id = %s",
            (team["project"],),
        )
    state = owner.get(base).json()
    assert state["ready"] is False
    assert "Choose the audit methodology." in _readiness(owner, base)["scope"]["issues"]
    refused = owner.patch(
        f"{base}/profile",
        json={"client_name": "Acme", "engagement_type": "SOX_ITGC", "methodology": "GUESSWORK"},
    )
    assert refused.status_code == 422
    chosen = owner.patch(
        f"{base}/profile",
        json={
            "client_name": "Acme",
            "engagement_type": "SOX_ITGC",
            "methodology": "MANAGEMENT_404",
            "period_start": "2027-01-01",
            "fiscal_year": "FY2027",
            "reporting_objectives": "Management's assessment of ITGCs over SAP ERP.",
        },
    )
    assert chosen.status_code == 200, chosen.text
    settings = chosen.json()["settings"]
    assert settings["methodology"] == "MANAGEMENT_404"
    assert settings["period_start"] == "2027-01-01"
    assert settings["fiscal_year"] == "FY2027"
    assert chosen.json()["ready"] is True


def test_a_period_that_starts_after_it_ends_is_refused(migrated: Database) -> None:
    team = _new_engagement(migrated, "period-order")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    refused = owner.patch(
        f"{base}/profile",
        json={"client_name": "Acme", "engagement_type": "SOX_ITGC", "period_start": "2028-01-01"},
    )
    assert refused.status_code == 422
    assert owner.get(base).json()["settings"]["period_start"] is None


def test_the_profile_and_scope_save_together_or_not_at_all(migrated: Database) -> None:
    """The profile step has one Save: the profile and the scope land in one transaction,
    and a scope the API refuses leaves the profile as it was too."""
    team = _new_engagement(migrated, "one-save")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    current = owner.get(base).json()["settings"]
    profile = {
        "client_name": current["client_name"],
        "engagement_type": current["engagement_type"],
        "fiscal_year": "FY2027",
    }
    saved = owner.patch(
        f"{base}/profile", json={**profile, "scope": "  ITGCs over SAP ERP for FY2027.  "}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["settings"]["fiscal_year"] == "FY2027"
    assert saved.json()["scope"] == "ITGCs over SAP ERP for FY2027."
    audited = _setup_audits(migrated, team["project"])
    refused = owner.patch(
        f"{base}/profile",
        json={**profile, "fiscal_year": "FY2028", "scope": "password: hunter2"},
    )
    assert refused.status_code == 422, refused.text
    after = owner.get(base).json()
    assert after["settings"]["fiscal_year"] == "FY2027"
    assert after["scope"] == "ITGCs over SAP ERP for FY2027."
    # Nothing of the refused save reached the audit trail either.
    assert _setup_audits(migrated, team["project"]) == audited
    # Without a scope, the profile alone is saved and the scope is kept.
    alone = owner.patch(f"{base}/profile", json={**profile, "fiscal_year": "FY2029"})
    assert alone.status_code == 200, alone.text
    assert alone.json()["settings"]["fiscal_year"] == "FY2029"
    assert alone.json()["scope"] == "ITGCs over SAP ERP for FY2027."
    assert _setup_audits(migrated, team["project"]) == {
        **audited,
        "onboarding.profile": audited.get("onboarding.profile", 0) + 1,
    }


def _setup_audits(database: Database, project: str) -> dict[str, int]:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT action, count(*) FROM audit_events WHERE project_id = %s "
            "AND action IN ('onboarding.profile', 'onboarding.scope') GROUP BY action",
            (project,),
        ).fetchall()
    return {str(action): int(count) for action, count in rows}


def test_profile_dates_can_be_cleared_explicitly(migrated: Database) -> None:
    team = _new_engagement(migrated, "period-clear")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    current = owner.get(base).json()["settings"]
    set_start = owner.patch(
        f"{base}/profile",
        json={
            "client_name": current["client_name"],
            "engagement_type": current["engagement_type"],
            "period_start": "2027-01-01",
        },
    )
    assert set_start.status_code == 200, set_start.text
    cleared = owner.patch(
        f"{base}/profile",
        json={
            "client_name": current["client_name"],
            "engagement_type": current["engagement_type"],
            "period_start": None,
            "period_end": None,
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["settings"]["period_start"] is None
    assert cleared.json()["settings"]["period_end"] is None
    assert cleared.json()["ready"] is False
    assert "Set the period end date." in _readiness(owner, base)["scope"]["issues"]


def test_a_conflicting_period_blocks_launch_until_a_person_confirms_it(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "period-confirm")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    # "SOX 2027" with a 2026 year end and a scope that says 2027: nothing is changed.
    owner.patch(
        f"{base}/scope",
        json={"scope": "ITGCs through December 31, 2027.", "period_end": "2026-12-31"},
    )
    state = owner.get(base).json()
    assert state["ready"] is False
    assert state["settings"]["period_end"] == "2026-12-31"
    assert {c["kind"] for c in state["period"]["conflicts"]} == {"NAME_YEAR", "SCOPE_DATE"}
    issues = _readiness(owner, base)["scope"]["issues"]
    assert any("name points to 2027" in issue for issue in issues)
    stale = owner.post(f"{base}/period/confirm", json={"basis": "0" * 32})
    assert stale.status_code == 409
    confirmed = owner.post(f"{base}/period/confirm", json={"basis": state["period"]["basis"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["period"]["confirmed"] is True
    assert confirmed.json()["ready"] is True
    # Any change to the words or dates asks again.
    owner.patch(
        f"{base}/scope",
        json={"scope": "ITGCs through 31 December 2027.", "period_end": "2026-12-31"},
    )
    again = owner.get(base).json()
    assert again["period"]["confirmed"] is False and again["ready"] is False
    # Fixing the dates instead clears the conflict; there is nothing left to confirm.
    owner.patch(
        f"{base}/scope",
        json={"scope": "ITGCs through 31 December 2027.", "period_end": "2027-12-31"},
    )
    fixed = owner.get(base).json()
    assert fixed["period"]["conflicts"] == [] and fixed["ready"] is True
    nothing = owner.post(f"{base}/period/confirm", json={"basis": fixed["period"]["basis"]})
    assert nothing.status_code == 409
    with connect(migrated.url) as connection:
        actions = [
            row[0]
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s ORDER BY created_at",
                (team["project"],),
            ).fetchall()
        ]
    assert actions.count("onboarding.period_confirmed") == 1


def test_development_mode_is_said_plainly_in_readiness(migrated: Database) -> None:
    team = _new_engagement(migrated, "dev-mode")
    owner, base = team["owner"], _base(team["org"], team["project"])
    assert _readiness(owner, base)["team"]["advisories"] == []
    independence.configure(False)
    advisories = _readiness(owner, base)["team"]["advisories"]
    assert any(advice.startswith("Development mode") for advice in advisories)


def test_several_roles_are_given_at_once_only_without_independence(migrated: Database) -> None:
    """Development mode lets one person hold several roles, and they are given in one
    step. With independence required, one person holds one role: a second is refused and
    nothing changes."""
    team = _new_engagement(migrated, "roles-at-once")
    owner, base = team["owner"], _base(team["org"], team["project"])
    person = str(team["reviewer_id"])
    both = {"user_id": person, "engagement_role": "PREPARER", "additional_roles": ["REVIEWER"]}

    def roles() -> set[str]:
        body = owner.get(base).json()
        return {m["engagement_role"] for m in body["team"] if m["user_id"] == person}

    refused = owner.post(f"{base}/team", json=both)
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "one role per person while reviewer independence is required"
    assert roles() == set()
    independence.configure(False)
    given = owner.post(f"{base}/team", json=both)
    assert given.status_code == 200, given.text
    assert roles() == {"PREPARER", "REVIEWER"}
    with connect(migrated.url) as connection:
        audited = [
            row[0]["engagement_role"]
            for row in connection.execute(
                "SELECT payload FROM audit_events WHERE project_id = %s "
                "AND action = 'onboarding.team' AND payload->>'user_id' = %s",
                (team["project"], person),
            ).fetchall()
        ]
    # Each role is recorded on its own, as when given one at a time.
    assert sorted(audited) == ["PREPARER", "REVIEWER"]
    # Repeating a role is harmless.
    again = owner.post(
        f"{base}/team",
        json={**both, "engagement_role": "REVIEWER", "additional_roles": ["REVIEWER"]},
    )
    assert again.status_code == 200, again.text
    assert roles() == {"PREPARER", "REVIEWER"}


def test_independence_cannot_be_switched_off_in_production(migrated: Database) -> None:
    with pytest.raises(independence.IndependenceOff):
        create_app(
            Settings(
                database_url=migrated.url,
                app_env="production",
                review_independence_required=False,
            )
        )
    assert independence.required() is True
    create_app(
        Settings(
            database_url=migrated.url, app_env="development", review_independence_required=False
        )
    )
    assert independence.required() is False


# After launch


def test_a_name_and_period_conflict_is_corrected_either_way(migrated: Database) -> None:
    team = _new_engagement(migrated, "period-align")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    # The name says 2027; set a 2026 year end to disagree with it.
    owner.patch(f"{base}/scope", json={"scope": "ITGCs over SAP ERP", "period_end": "2026-12-31"})
    state = owner.get(base).json()
    assert state["ready"] is False
    conflict = next(c for c in state["period"]["conflicts"] if c["kind"] == "NAME_YEAR")
    assert conflict["period_end_fix"] == "2027-12-31"
    assert conflict["name_fix"] == "SOX 2026"
    # What the page showed must still hold.
    stale = owner.post(f"{base}/period/align", json={"basis": "0" * 32, "to": "period_end"})
    assert stale.status_code == 409
    # Move the period to the name's year: the end, and the twelve months before it.
    moved = owner.post(
        f"{base}/period/align", json={"basis": state["period"]["basis"], "to": "period_end"}
    )
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["settings"]["period_end"] == "2027-12-31"
    assert body["settings"]["period_start"] == "2027-01-01"
    assert body["period"]["conflicts"] == [] and body["ready"] is True
    # Nothing left to align.
    again = owner.post(
        f"{base}/period/align", json={"basis": body["period"]["basis"], "to": "name"}
    )
    assert again.status_code == 409
    # Or the other way: the name takes the period's year. (Back to a 2026 period, start
    # and end together, as the database keeps the start before the end.)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET period_start = NULL, period_end = '2026-12-31' "
            "WHERE project_id = %s",
            (team["project"],),
        )
        connection.commit()
    state = owner.get(base).json()
    renamed = owner.post(
        f"{base}/period/align", json={"basis": state["period"]["basis"], "to": "name"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["project_name"] == "SOX 2026"
    assert renamed.json()["period"]["conflicts"] == []
    with connect(migrated.url) as connection:
        aligned = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.period_aligned'",
            (team["project"],),
        ).fetchone()
    assert aligned is not None and aligned[0] == 2


def test_a_scope_or_label_that_names_another_year_offers_its_correction() -> None:
    """The scope and the fiscal year label follow the recorded period, written as they
    were; an interim date is not a period end and stays (27 October 2026)."""
    today = date(2026, 10, 27)
    scope = (
        "ITGCs for the period ending 31 December 2026 (FY26), with interim testing through "
        "30 September 2026; year end December 31, 2026 and 2026-12-31."
    )
    found = period_conflicts("SOX audit", scope, date(2027, 1, 1), date(2027, 12, 31), "", today)
    dated = next(c for c in found if c.kind == "SCOPE_DATE")
    assert dated.scope_fix == (
        "ITGCs for the period ending 31 December 2027 (FY27), with interim testing through "
        "30 September 2026; year end December 31, 2027 and 2027-12-31."
    )
    named = period_conflicts(
        "SOX audit", "Fiscal year 2026 ITGCs.", None, date(2027, 12, 31), "", today
    )
    assert [(c.kind, c.scope_fix) for c in named] == [("SCOPE_YEAR", "Fiscal year 2027 ITGCs.")]
    labelled = period_conflicts("SOX audit", "", None, date(2027, 12, 31), "FY2026", today)
    assert [(c.kind, c.fiscal_year_fix) for c in labelled] == [("FISCAL_YEAR", "FY2027")]
    plain = period_conflicts("SOX audit", "", None, date(2027, 12, 31), "Year 2026", today)
    assert plain[0].fiscal_year_fix == "Year 2027"
    # A name is corrected its own way, never through the scope.
    assert (
        period_conflicts("SOX FY26", "", None, date(2027, 12, 31), "", today)[0].scope_fix is None
    )


def test_a_scope_naming_another_year_end_is_corrected_not_only_confirmed(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "scope-align")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    # The name says 2027 and so does the period; the scope still names 2026's year end.
    scoped = owner.patch(
        f"{base}/scope",
        json={
            "scope": "ITGCs over SAP ERP for the period ending 31 December 2026.",
            "period_end": "2027-12-31",
        },
    )
    assert scoped.status_code == 200, scoped.text
    state = owner.get(base).json()
    conflict = next(c for c in state["period"]["conflicts"] if c["kind"] == "SCOPE_DATE")
    assert conflict["scope_fix"] == "ITGCs over SAP ERP for the period ending 31 December 2027."
    assert state["ready"] is False
    stale = owner.post(f"{base}/period/align", json={"basis": "0" * 32, "to": "scope"})
    assert stale.status_code == 409
    fixed = owner.post(
        f"{base}/period/align", json={"basis": state["period"]["basis"], "to": "scope"}
    )
    assert fixed.status_code == 200, fixed.text
    body = fixed.json()
    assert body["scope"] == "ITGCs over SAP ERP for the period ending 31 December 2027."
    assert body["settings"]["period_end"] == "2027-12-31"
    assert body["period"]["conflicts"] == [] and body["ready"] is True
    assert body["period"]["confirmed"] is False
    nothing = owner.post(
        f"{base}/period/align", json={"basis": body["period"]["basis"], "to": "fiscal_year"}
    )
    assert nothing.status_code == 409
    with connect(migrated.url) as connection:
        actions = [
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s "
                "AND action IN ('onboarding.period_aligned', 'onboarding.scope') "
                "ORDER BY occurred_at",
                (team["project"],),
            ).fetchall()
        ]
    assert actions[-2:] == ["onboarding.scope", "onboarding.period_aligned"]


def test_a_running_engagement_with_a_conflicting_period_is_flagged_and_confirmed(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "period-running")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    _launch(owner, base)
    workspace = f"/organizations/{team['org']}/projects/{team['project']}/workspace/dashboard"
    assert owner.get(workspace).json()["period_conflicts"] == []
    # An engagement launched before the checks existed, with its period as created.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_settings SET period_end = '2026-12-31' WHERE project_id = %s",
            (team["project"],),
        )
    flagged = owner.get(workspace).json()["period_conflicts"]
    assert len(flagged) == 2
    state = owner.get(base).json()
    confirmed = owner.post(f"{base}/period/confirm", json={"basis": state["period"]["basis"]})
    assert confirmed.status_code == 200, confirmed.text
    assert owner.get(workspace).json()["period_conflicts"] == []
    with connect(migrated.url) as connection:
        period_end = connection.execute(
            "SELECT period_end FROM engagement_settings WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
    assert period_end == (date(2026, 12, 31),)


def test_the_last_reviewer_stays_and_a_leavers_open_work_goes_back_to_the_team(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "team-impact")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    _complete_setup(owner, team)
    with connect(migrated.url) as connection:
        preparer = _add_user(connection, org, "prep-impact@example.com", "CONTRIBUTOR")
        _add_project_member(connection, org, project, preparer)
    owner.post(f"{base}/team", json={"user_id": str(preparer), "engagement_role": "PREPARER"})
    _launch(owner, base)
    reviewer = team["reviewer_id"]
    impact = owner.get(f"{base}/team/{reviewer}/impact").json()
    assert impact["last_reviewer"] is True
    refused = owner.post(f"{base}/team/{reviewer}/remove")
    assert refused.status_code == 409
    assert "reviewer" in refused.json()["detail"]
    with connect(migrated.url) as connection:
        assigned = connection.execute(
            """
            UPDATE tasks SET assignee_user_id = %s
            WHERE id IN (SELECT id FROM tasks WHERE project_id = %s
                         AND status::text IN ('DRAFT', 'READY', 'WAITING') LIMIT 2)
            RETURNING id
            """,
            (preparer, project),
        ).fetchall()
    assert len(assigned) == 2
    impact = owner.get(f"{base}/team/{preparer}/impact").json()
    assert impact == {"assigned_tasks": 2, "last_reviewer": False}
    removed = owner.post(f"{base}/team/{preparer}/remove")
    assert removed.status_code == 200, removed.text
    with connect(migrated.url) as connection:
        left = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s AND assignee_user_id = %s",
            (project, preparer),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s AND action = 'onboarding.team'"
            " ORDER BY created_at DESC LIMIT 1",
            (project,),
        ).fetchone()
    assert left == (0,)
    assert audit is not None and audit[0]["released_tasks"] == 2


def test_taking_a_control_with_work_on_record_out_of_scope_needs_a_reason(
    migrated: Database,
) -> None:
    team = _new_engagement(migrated, "scope-reason")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    _complete_setup(owner, team)
    _launch(owner, base)
    # Nothing is requested before a person approves each control's evidence plan.
    approve_evidence_plans(migrated, project)
    control_id = owner.get(base).json()["controls"][0]["id"]
    quiet = owner.get(f"{base}/scope-impact", params={"control_id": control_id}).json()
    assert quiet["controls"] == 1 and quiet["material"] is False
    # Unsent requests and open tasks are not work on record; a recorded deficiency is.
    assert quiet["open_tasks"] > 0 and quiet["unsent_requests"] > 0
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (
                organization_id, project_id, reference, engagement_control_id, title,
                deficiency_type, identified_by
            )
            VALUES (%s, %s, 'D-001', %s, 'Late review', 'OPERATING', %s)
            """,
            (org, project, control_id, team["owner_id"]),
        )
    impact = owner.get(f"{base}/scope-impact", params={"control_id": control_id}).json()
    assert impact["deficiencies"] == 1 and impact["material"] is True
    unexplained = owner.post(f"{base}/controls/{control_id}/scope", json={"included": False})
    assert unexplained.status_code == 409
    assert "say why" in unexplained.json()["detail"]
    explained = owner.post(
        f"{base}/controls/{control_id}/scope",
        json={"included": False, "reason": "Control retired in Q3; replaced by AC-07."},
    )
    assert explained.status_code == 200, explained.text
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.control_scope' ORDER BY created_at DESC LIMIT 1",
            (project,),
        ).fetchone()
    assert audit is not None
    payload: dict[str, Any] = audit[0]
    assert payload["reason"] == "Control retired in Q3; replaced by AC-07."
    assert payload["impact"]["deficiencies"] == 1


def test_scope_changes_before_launch_need_no_reason(migrated: Database) -> None:
    team = _new_engagement(migrated, "scope-early")
    owner, base = team["owner"], _base(team["org"], team["project"])
    _complete_setup(owner, team)
    control_id = owner.get(base).json()["controls"][0]["id"]
    out = owner.post(f"{base}/controls/{control_id}/scope", json={"included": False})
    assert out.status_code == 200, out.text
    assert UUID(control_id) not in {UUID(c["id"]) for c in out.json()["controls"] if c["included"]}


def test_the_control_editor_asks_for_the_same_reason(migrated: Database) -> None:
    team = _new_engagement(migrated, "editor-reason")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    _complete_setup(owner, team)
    _launch(owner, base)
    control = owner.get(base).json()["controls"][0]
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (
                organization_id, project_id, reference, engagement_control_id, title,
                deficiency_type, identified_by
            )
            VALUES (%s, %s, 'D-001', %s, 'Late review', 'OPERATING', %s)
            """,
            (org, project, control["id"], team["owner_id"]),
        )
    fields = {**_control_fields(control), "included": False}
    unexplained = owner.patch(f"{base}/controls/{control['id']}", json=fields)
    assert unexplained.status_code == 409
    assert "say why" in unexplained.json()["detail"]
    explained = owner.patch(
        f"{base}/controls/{control['id']}", json={**fields, "reason": "Retired in Q3."}
    )
    assert explained.status_code == 200, explained.text
    # Keeping it in scope while changing other fields needs no reason.
    other = explained.json()["controls"][1]
    kept = owner.patch(
        f"{base}/controls/{other['id']}", json={**_control_fields(other), "key_control": True}
    )
    assert kept.status_code == 200, kept.text
