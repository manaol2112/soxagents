"""The firm's testing methodology, versioned (product owner, 8 November 2026): version 1 is
the platform's default, labelled as not approved; an Owner or Admin proposes a version and a
different one approves it; an engagement keeps the version it launched on, and moving it is a
recorded decision; the size of every sample comes from the version the engagement follows.
"""

from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_evidence_intake import _engagement
from test_execution import _add_user
from test_execution import _client as _session
from test_onboarding import _base as _setup_base
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api import independence
from ai_workforce_api.controls import SAMPLE_SIZES
from ai_workforce_api.db import connect
from ai_workforce_api.methodology import (
    FREQUENCIES,
    PLATFORM_DEFAULT,
    RETEST_RULES,
    ROLLFORWARD_SIZES,
    Rules,
    for_project,
    rules_for,
)
from ai_workforce_api.test_rounds import retest_rule, rollforward_size

__all__ = ["migrated"]


def _base(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/testing-methodology"


def _rules(**changes: Any) -> dict[str, Any]:
    rules = PLATFORM_DEFAULT.model_dump()
    for key, value in changes.items():
        rules[key] = {**rules[key], **value}
    return rules


def _propose(client: Any, team: dict[str, Any], **body: Any) -> Any:
    current = client.get(_base(team)).json()["current"]
    payload = {
        "rules": _rules(sample_sizes={"QUARTERLY": 3, "MONTHLY": 3}),
        "rationale": "Firm methodology manual 2027, section 4.2: larger samples for "
        "quarterly and monthly controls.",
        "based_on": current["id"],
        **body,
    }
    return client.post(f"{_base(team)}/proposals", json=payload)


def _pinned(database: Database, project: UUID) -> UUID | None:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT methodology_version_id FROM projects WHERE id = %s", (project,)
        ).fetchone()
    return None if row is None or row[0] is None else UUID(str(row[0]))


def _launched(database: Database, slug: str) -> dict[str, Any]:
    team, client, _scheduler = _engagement(database, slug)
    return {**team, "client": client}


def test_the_platform_default_is_todays_rules_exactly() -> None:
    """Nothing a running engagement planned changes when the methodology arrives."""
    assert dict(PLATFORM_DEFAULT.sample_sizes) == {key: SAMPLE_SIZES[key] for key in FREQUENCIES}
    assert dict(PLATFORM_DEFAULT.rollforward_sizes) == ROLLFORWARD_SIZES
    assert {k: (v.size, v.days) for k, v in PLATFORM_DEFAULT.retest.items()} == RETEST_RULES
    assert PLATFORM_DEFAULT.tolerance == "ZERO"
    assert PLATFORM_DEFAULT.automated == "TEST_OF_ONE"
    # A frequency it does not know is sized as the most frequent, as before.
    assert PLATFORM_DEFAULT.sample_size("UNKNOWN", "MANUAL") == 25
    assert PLATFORM_DEFAULT.rollforward("UNKNOWN", "MANUAL") == ("SAMPLE", 10)
    assert PLATFORM_DEFAULT.retest_rule("UNKNOWN", "MANUAL") == ("SAMPLE", 25, 30)
    # An automated control is tested once, in every phase.
    assert PLATFORM_DEFAULT.sample_size("DAILY", "AUTOMATED") == 1
    assert rollforward_size("DAILY", "AUTOMATED") == ("TEST_OF_ONE", 1)
    assert retest_rule("DAILY", "AUTOMATED") == ("TEST_OF_ONE", 1, 0)


def test_rules_must_cover_every_frequency_within_bounds() -> None:
    with pytest.raises(ValueError, match="every frequency"):
        Rules.model_validate({**PLATFORM_DEFAULT.model_dump(), "sample_sizes": {"ANNUAL": 1}})
    with pytest.raises(ValueError, match="1 to 200"):
        Rules.model_validate(_rules(sample_sizes={"DAILY": 0}))
    with pytest.raises(ValueError):
        Rules.model_validate(_rules(retest={"QUARTERLY": {"size": 2, "days": 400}}))
    # Zero tolerance and test of one are the only rules this version of the platform applies.
    with pytest.raises(ValueError):
        Rules.model_validate({**PLATFORM_DEFAULT.model_dump(), "tolerance": "BANDS"})
    with pytest.raises(ValueError):
        Rules.model_validate({**PLATFORM_DEFAULT.model_dump(), "extra": 1})


def test_a_firm_starts_on_the_platform_default_and_launching_pins_it(migrated: Database) -> None:
    team = _launched(migrated, "method-default")
    client = team["client"]
    read = client.get(_base(team))
    assert read.status_code == 200, read.text
    body = read.json()
    assert (body["current"]["number"], body["current"]["status"]) == (1, "PLATFORM_DEFAULT")
    assert body["current"]["rules"] == PLATFORM_DEFAULT.model_dump()
    assert body["current"]["engagements"] == 1
    assert body["pending"] is None and body["can_propose"] is True
    # The engagement launched on it and keeps it.
    assert _pinned(migrated, team["project"]) == UUID(body["current"]["id"])
    engagement = client.get(
        f"/organizations/{team['org']}/projects/{team['project']}/testing-methodology"
    )
    assert engagement.status_code == 200, engagement.text
    assert engagement.json()["label"] == (
        "Firm methodology v1: platform default, not approved by the firm"
    )
    assert engagement.json()["pinned"] is True


def test_a_proposal_is_approved_by_someone_else_and_reaches_new_engagements_only(
    migrated: Database,
) -> None:
    team = _launched(migrated, "method-approve")
    owner = team["client"]
    admin = _session(migrated, team["reviewer_id"])
    proposed = _propose(owner, team)
    assert proposed.status_code == 200, proposed.text
    pending = proposed.json()["pending"]
    assert (pending["number"], pending["status"], pending["based_on"]) == (2, "PENDING", 1)
    # Nothing changes until it is approved.
    assert proposed.json()["current"]["number"] == 1
    assert proposed.json()["can_propose"] is False
    # One proposal at a time.
    assert _propose(owner, team).status_code == 409
    # The proposer cannot approve their own change.
    assert proposed.json()["can_decide"] is False
    decision = {"decision": "APPROVE", "note": "", "version": pending["version"]}
    own = owner.post(f"{_base(team)}/versions/{pending['id']}/decision", json=decision)
    assert own.status_code == 403
    assert "cannot approve" in own.json()["detail"]
    # Another Owner or Admin can.
    assert admin.get(_base(team)).json()["can_decide"] is True
    approved = admin.post(f"{_base(team)}/versions/{pending['id']}/decision", json=decision)
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert (body["current"]["number"], body["current"]["status"]) == (2, "APPROVED")
    assert body["current"]["decided_by"] and body["current"]["proposed_by"]
    # A decision is made once.
    again = admin.post(f"{_base(team)}/versions/{pending['id']}/decision", json=decision)
    assert again.status_code == 409
    # The engagement that was running keeps version 1 and its sizes.
    old = for_project_of(migrated, team["project"])
    assert (old.number, old.rules.sample_size("QUARTERLY", "MANUAL")) == (1, 2)
    # Another firm's engagement follows that firm's own default, never this firm's change.
    second = _new_engagement(migrated, "method-approve-2")
    with connect(migrated.url) as connection:
        assert rules_for(connection, second["project"]).sample_size("QUARTERLY", "MANUAL") == 2
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT action FROM audit_events WHERE organization_id = %s "
            "AND target_type = 'methodology' ORDER BY created_at",
            (team["org"],),
        ).fetchall()
    assert [row[0] for row in audit][-2:] == ["methodology.proposed", "methodology.approved"]


def for_project_of(database: Database, project: UUID) -> Any:
    with connect(database.url) as connection:
        return for_project(connection, project)


def test_a_new_engagement_of_the_firm_launches_on_the_approved_version(
    migrated: Database,
) -> None:
    team = _launched(migrated, "method-new")
    owner, admin = team["client"], _session(migrated, team["reviewer_id"])
    pending = _propose(owner, team).json()["pending"]
    admin.post(
        f"{_base(team)}/versions/{pending['id']}/decision",
        json={"decision": "APPROVE", "note": "Agreed.", "version": pending["version"]},
    )
    created = owner.post(
        f"/organizations/{team['org']}/projects",
        json={"name": "SOX 2027 controls", "slug": "sox-2027-method", "scope": "",
              "owner_user_id": str(team["owner_id"]), "status": "DRAFT"},
    )  # fmt: skip
    assert created.status_code in (200, 201), created.text
    project = UUID(created.json()["id"])
    # A draft follows the firm's current version and is not pinned until it launches.
    with connect(migrated.url) as connection:
        assert rules_for(connection, project).sample_size("QUARTERLY", "MANUAL") == 3
    assert _pinned(migrated, project) is None
    launch = {**team, "project": project}
    _complete_setup(owner, launch)
    setup = _setup_base(team["org"], project)
    planned = owner.post(f"{setup}/plan")
    assert "plan" in planned.json(), planned.text
    plan = planned.json()["plan"]
    started = owner.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    assert _pinned(migrated, project) == UUID(pending["id"])
    # Its controls are sized by version 2.
    controls = owner.get(f"{setup}").json()["controls"]
    quarterly = [
        c for c in controls if c["frequency"] == "QUARTERLY" and c["nature"] != "AUTOMATED"
    ]
    assert quarterly and all(c["sample_size"] == 3 for c in quarterly)


def test_only_owners_and_admins_change_it_and_every_change_says_why(migrated: Database) -> None:
    team = _launched(migrated, "method-roles")
    owner = team["client"]
    with connect(migrated.url) as connection:
        reviewer = _add_user(connection, team["org"], "method-rev@example.com", "REVIEWER")
        contributor = _add_user(connection, team["org"], "method-con@example.com", "CONTRIBUTOR")
    for user in (reviewer, contributor):
        session = _session(migrated, user)
        read = session.get(_base(team))
        assert read.status_code == 200
        assert read.json()["can_propose"] is False
        assert _propose(session, team).status_code == 403
    assert _propose(owner, team, rationale="Because.").status_code == 409
    assert _propose(owner, team, rules=PLATFORM_DEFAULT.model_dump()).status_code == 409
    incomplete = _propose(owner, team, rules={**_rules(), "sample_sizes": {"ANNUAL": 1}})
    assert incomplete.status_code == 409 and "every frequency" in incomplete.json()["detail"]
    stale = _propose(owner, team, based_on="00000000-0000-0000-0000-000000000000")
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]
    # A rejection says why; only the proposer withdraws.
    pending = _propose(owner, team).json()["pending"]
    admin = _session(migrated, team["reviewer_id"])
    path = f"{_base(team)}/versions/{pending['id']}"
    bare = {"decision": "REJECT", "note": "", "version": pending["version"]}
    assert admin.post(f"{path}/decision", json=bare).status_code == 409
    assert admin.post(f"{path}/withdraw", json={"version": pending["version"]}).status_code == 409
    withdrawn = owner.post(f"{path}/withdraw", json={"version": pending["version"]})
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["pending"] is None
    assert withdrawn.json()["current"]["number"] == 1


def test_a_running_engagement_moves_only_to_an_approved_version_with_a_reason(
    migrated: Database,
) -> None:
    team = _launched(migrated, "method-move")
    owner, admin = team["client"], _session(migrated, team["reviewer_id"])
    path = f"/organizations/{team['org']}/projects/{team['project']}/testing-methodology"
    pending = _propose(owner, team).json()["pending"]
    # Not to a version still waiting for its decision.
    waiting = owner.put(
        path, json={"version_id": pending["id"], "reason": "Move it to the new one."}
    )
    assert waiting.status_code == 409
    admin.post(
        f"{_base(team)}/versions/{pending['id']}/decision",
        json={"decision": "APPROVE", "note": "", "version": pending["version"]},
    )
    choices = owner.get(path).json()
    assert [item["number"] for item in choices["choices"]] == [2] and choices["can_move"] is True
    short = owner.put(path, json={"version_id": pending["id"], "reason": "New."})
    assert short.status_code == 409
    moved = owner.put(
        path,
        json={"version_id": pending["id"], "reason": "The audit committee adopted the 2027 "
              "manual mid-year."},
    )  # fmt: skip
    assert moved.status_code == 200, moved.text
    assert moved.json()["applied"]["number"] == 2
    assert moved.json()["label"] == "Firm methodology v2"
    with connect(migrated.url) as connection:
        assert rules_for(connection, team["project"]).sample_size("QUARTERLY", "MANUAL") == 3
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'methodology.moved' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchone()
    assert audit is not None and (audit[0]["from"], audit[0]["to"]) == (1, 2)
    assert "audit committee" in audit[0]["reason"]
    # Another firm's engagement is not found, and nothing of it is read or pinned.
    other = _launched(migrated, "method-move-other")
    before = _pinned(migrated, other["project"])
    foreign = owner.put(
        f"/organizations/{team['org']}/projects/{other['project']}/testing-methodology",
        json={"version_id": pending["id"], "reason": "Not this firm's engagement at all."},
    )
    assert foreign.status_code == 404
    assert _pinned(migrated, other["project"]) == before


def test_a_version_cannot_be_rewritten_and_follows_only_its_own_firm(migrated: Database) -> None:
    team = _launched(migrated, "method-frozen")
    other = _launched(migrated, "method-frozen-other")
    with connect(migrated.url) as connection:
        version = connection.execute(
            "SELECT methodology_version_id FROM projects WHERE id = %s", (team["project"],)
        ).fetchone()
        assert version is not None
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                'UPDATE methodology_versions SET rules = rules || \'{"tolerance": "BANDS"}\' '
                "WHERE id = %s",
                (version[0],),
            )
        connection.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE methodology_versions SET status = 'WITHDRAWN' WHERE id = %s",
                (version[0],),
            )
        connection.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE projects SET methodology_version_id = %s WHERE id = %s",
                (version[0], other["project"]),
            )


def test_without_independence_one_admin_can_decide_and_the_page_says_so(
    migrated: Database,
) -> None:
    team = _launched(migrated, "method-dev")
    owner = team["client"]
    independence.configure(False)
    try:
        pending = _propose(owner, team).json()["pending"]
        read = owner.get(_base(team)).json()
        assert (read["can_decide"], read["independence"]) == (True, False)
        decided = owner.post(
            f"{_base(team)}/versions/{pending['id']}/decision",
            json={"decision": "APPROVE", "note": "", "version": pending["version"]},
        )
        assert decided.status_code == 200, decided.text
    finally:
        independence.configure(True)
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'methodology.approved' "
            "AND organization_id = %s",
            (team["org"],),
        ).fetchone()
    # The record shows the proposer decided their own change.
    assert audit is not None and audit[0]["own"] is True


# Added 10 November 2026: the full suite found the console's read-only status tool failing on
# any engagement not yet pinned, because reading the rules wrote the firm's version 1 (an
# INSERT, even when nothing was inserted). A read never writes; the next write pins.
def test_reading_the_rules_never_writes_and_the_next_write_pins(migrated: Database) -> None:
    from ai_workforce_api.engagement_data import snapshot

    draft = _new_engagement(migrated, "method-read")

    def versions(connection: Any) -> Any:
        return connection.execute(
            "SELECT count(*) FROM methodology_versions WHERE organization_id = %s",
            (draft["org"],),
        ).fetchone()

    with connect(migrated.url) as connection:
        before = versions(connection)
        # Ended, so the console's snapshot opens its own read-only transaction.
        connection.rollback()
        # A draft engagement read read-only follows the firm's current version (here the
        # platform default, the firm having none written yet), and the read writes nothing.
        with snapshot(connection):
            assert rules_for(connection, draft["project"]) == PLATFORM_DEFAULT
        assert versions(connection) == before
    team = _launched(migrated, "method-unpinned")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET methodology_version_id = NULL WHERE id = %s", (team["project"],)
        )
        connection.commit()
        # A running engagement read read-only is not pinned by the read.
        with snapshot(connection):
            assert rules_for(connection, team["project"]) == PLATFORM_DEFAULT
        assert _pinned(migrated, team["project"]) is None
        # The next read that may write pins it, as before.
        assert for_project(connection, team["project"]).number == 1
        connection.commit()
    assert _pinned(migrated, team["project"]) is not None
