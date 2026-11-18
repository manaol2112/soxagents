"""The Systems & Processes workflow's processes (SP3) and control selection (SP4), decided by
the product owner on 24 October 2026: a process is added on its own with its systems and
approved areas, and controls are selected for a system or a process.

Rewritten 17 November 2026 (the product owner: "Remove the requirement to finalize the scope.
Scope keeps changing so it will never be finalized. This is a moving systems, controls, and
etc."). Old (SP6, Review and finalize): the engagement's work started only when a person
finalized the scope with `POST .../scope/finalize`. New: there is no finalize step and no
finalize route; a control selected on a running engagement gets its work at once, one added
later too, and one removed has its open work cancelled. Engagements whose scope was selected
under SP6 and never finalized get their controls' work when the worker starts
(scope_changes.start_waiting_scope)."""

import logging
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_engagement_close import _launched
from test_execution import _add_project_member, _add_user
from test_onboarding import _base, _choose_methodology, _new_engagement
from test_outbound import _session, migrated

from ai_workforce_api import scope_changes
from ai_workforce_api.db import connect
from ai_workforce_api.scope_changes import start_waiting_scope
from ai_workforce_api.system_scoping import include_control

__all__ = ["migrated"]


def _launched_empty(migrated: Database, slug: str) -> tuple[TestClient, str, dict[str, Any]]:
    """An engagement launched after its team, before any system or control."""
    team = _new_engagement(migrated, slug)
    owner, base = team["owner"], _base(team["org"], team["project"])
    scoped = owner.patch(
        f"{base}/scope", json={"scope": "ITGCs for FY2027", "period_end": "2027-12-31"}
    )
    assert scoped.status_code == 200, scoped.text
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        added = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert added.status_code == 200, added.text
    _choose_methodology(owner, base)
    preview = owner.get(base).json()["plan_preview"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": preview["fingerprint"]})
    assert launched.status_code == 200, launched.text
    # No finalization is recorded or shown (17 November 2026).
    assert "scope_finalized_at" not in launched.json()["settings"]
    return owner, base, team


def _work(database: Database, project: UUID) -> tuple[int, int, int]:
    """Controls with work, report tasks, and evidence requests."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT (SELECT count(DISTINCT engagement_control_id) FROM tasks
                    WHERE project_id = %s AND engagement_control_id IS NOT NULL
                      AND status <> 'CANCELLED'),
                   (SELECT count(*) FROM tasks WHERE project_id = %s AND plan_kind = 'report'),
                   (SELECT count(*) FROM pbc_requests WHERE project_id = %s)
            """,
            (project, project, project),
        ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1]), int(row[2])


def _options(owner: TestClient, base: str, **target: str) -> dict[str, Any]:
    answer = owner.get(f"{base}/scope/options", params=target)
    assert answer.status_code == 200, answer.text
    body: dict[str, Any] = answer.json()
    return body


def _counts(owner: TestClient, base: str) -> dict[str, int]:
    snapshot = owner.get(base).json()
    return {
        "systems": len(snapshot["applications"]),
        "processes": len(snapshot["processes"]),
        "controls": sum(1 for c in snapshot["controls"] if c["included"]),
    }


# SP3


def test_a_process_is_added_with_its_systems_owner_and_areas(migrated: Database) -> None:
    team = _new_engagement(migrated, "process-setup")
    owner, base = team["owner"], _base(team["org"], team["project"])
    sap = owner.post(f"{base}/systems", json={"name": "SAP ERP", "layer": "APPLICATION"})
    sap_id = sap.json()["applications"][0]["id"]
    draft = {"name": "Procure to pay", "domain": "PROCURE_TO_PAY", "system_ids": [sap_id]}
    preview = owner.post(f"{base}/processes/areas", json=draft)
    assert preview.status_code == 200, preview.text
    areas = {item["area"]: item for item in preview.json()["areas"]}
    assert areas["BUSINESS"]["suggested"] and areas["ITAC"]["suggested"]
    assert not areas["ITGC"]["suggested"]
    assert owner.get(base).json()["processes"] == []
    added = owner.post(
        f"{base}/processes/setup",
        json={**draft, "description": "Buying and paying", "owner": "AP Lead",
              "primary_system_id": sap_id, "approved_areas": ["BUSINESS"]},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    process = added.json()["processes"][0]
    assert (process["owner"], process["description"]) == ("AP Lead", "Buying and paying")
    assert process["system_ids"] == [sap_id] and process["primary_system_id"] == sap_id
    assert process["control_areas"] == ["BUSINESS"]
    assert process["control_areas_suggested"]["source"] == "RULES"
    system = added.json()["applications"][0]
    assert system["process_ids"] == [process["id"]]
    # No control joined the scope.
    assert not any(c["included"] for c in added.json()["controls"])
    # A process needs no system; refusals.
    alone = owner.post(f"{base}/processes/setup", json={"name": "Treasury", "domain": "TREASURY"})
    assert alone.status_code == 200, alone.text
    assert (
        next(p for p in alone.json()["processes"] if p["name"] == "Treasury")["control_areas"]
        is None
    )
    assert owner.post(f"{base}/processes/setup", json=draft).status_code == 409
    for body in (
        {"name": "X", "domain": "ACCESS"},
        {"name": "X", "domain": "TAX", "system_ids": [str(uuid4())]},
        {"name": "X", "domain": "TAX", "primary_system_id": sap_id},
        {"name": "X", "domain": "TAX", "approved_areas": ["ALL"]},
    ):
        assert owner.post(f"{base}/processes/setup", json=body).status_code == 422, body


# SP4: selection starts the work (SP6's finalization removed, 17 November 2026)


def test_selected_controls_start_their_work_at_once(migrated: Database) -> None:
    """Rewritten 17 November 2026 from test_selected_controls_wait_for_the_scope_to_be_finalized.
    Old: the controls selected waited, with no work, until a person finalized the scope with
    the counts reviewed; a second finalization was refused. New (the product owner: the scope
    is never finalized): each control selected on the running engagement gets its work at
    once, without any finalize call, and the report task comes with the first control's work.
    Selecting the same controls again creates nothing more."""
    owner, base, team = _launched_empty(migrated, "select-starts")
    project = team["project"]
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    payroll = owner.post(
        f"{base}/processes/setup",
        json={"name": "Payroll", "domain": "HIRE_TO_RETIRE", "system_ids": [sap["id"]]},
    ).json()["processes"][0]
    options = _options(owner, base, system_id=sap["id"])
    assert options["target_kind"] == "SYSTEM" and options["approved_areas"] == ["ITGC"]
    keys = [c["library_key"] for c in options["controls"] if c["area"] == "ITGC"][:3]
    assert len(keys) == 3 and not any(c["in_scope"] for c in options["controls"])
    # Adding systems and processes puts no control in scope, so it creates no work.
    assert _work(migrated, project) == (0, 0, 0)
    chosen = owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": keys})
    assert chosen.status_code == 200, chosen.text
    assert {
        c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
        if c["in_scope"]
    } == set(keys)  # fmt: skip
    # Selected on a running engagement: the work starts now, with no finalize step.
    assert _work(migrated, project)[:2] == (3, 1)
    hr = _options(owner, base, process_id=payroll["id"])
    assert {c["domain"] for c in hr["controls"]} == {"HIRE_TO_RETIRE"}
    hr_key = hr["controls"][0]["library_key"]
    picked = owner.post(
        f"{base}/scope/select", json={"process_id": payroll["id"], "library_keys": [hr_key]}
    )
    assert picked.status_code == 200, picked.text
    process_control = next(c for c in picked.json()["controls"] if c["included"]
                           and c["process_id"] == payroll["id"])  # fmt: skip
    assert process_control["application_id"] is None
    with_work, reports, requests = _work(migrated, project)
    assert (with_work, reports) == (4, 1)
    with connect(migrated.url) as connection:
        tasks = connection.execute(
            "SELECT count(*) FROM tasks WHERE project_id = %s", (project,)
        ).fetchone()
        waits = connection.execute(
            """
            SELECT count(*) FROM task_dependencies d
            JOIN tasks r ON r.id = d.task_id AND r.plan_kind = 'report'
            WHERE d.project_id = %s
            """,
            (project,),
        ).fetchone()
        added = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action = 'scope.control_added'",
            (project,),
        ).fetchone()
    # The report waits for every control's review.
    assert waits == (4,) and added == (4,)
    # Idempotent: the same selection again creates no second round of work.
    again = owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": keys})
    assert again.status_code == 200, again.text
    assert _work(migrated, project) == (4, 1, requests)
    with connect(migrated.url) as connection:
        assert (
            connection.execute(
                "SELECT count(*) FROM tasks WHERE project_id = %s", (project,)
            ).fetchone()
            == tasks
        )
    # The finalize step is gone (17 November 2026).
    gone = owner.post(f"{base}/scope/finalize", json=_counts(owner, base))
    assert gone.status_code in (404, 405)


def test_a_control_added_later_starts_and_one_removed_stops(migrated: Database) -> None:
    """New, 17 November 2026 (the product owner: the scope is a moving set of systems and
    controls): a control added after others are running gets its work at once, and one taken
    out of scope has its open tasks and unsent requests cancelled, the others untouched."""
    owner, base, team = _launched_empty(migrated, "select-moves")
    project = team["project"]
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    keys = [c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
            if c["area"] == "ITGC"][:3]  # fmt: skip
    first = owner.post(
        f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": keys[:2]}
    )
    assert first.status_code == 200, first.text
    assert _work(migrated, project)[:2] == (2, 1)
    later = owner.post(
        f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": keys[2:]}
    )
    assert later.status_code == 200, later.text
    assert _work(migrated, project)[:2] == (3, 1)
    leaving = next(
        c for c in later.json()["controls"] if c["included"] and c["library_key"] == keys[0]
    )
    out = owner.post(f"{base}/controls/{leaving['id']}/scope", json={"included": False})
    assert out.status_code == 200, out.text
    assert _work(migrated, project)[:2] == (2, 1)
    with connect(migrated.url) as connection:
        left = connection.execute(
            """
            SELECT (SELECT count(*) FROM tasks WHERE engagement_control_id = %(c)s
                    AND status <> 'CANCELLED'),
                   (SELECT count(*) FROM tasks WHERE engagement_control_id = %(c)s
                    AND status = 'CANCELLED'),
                   (SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %(c)s
                    AND status IN ('DRAFT', 'APPROVAL_PENDING'))
            """,
            {"c": leaving["id"]},
        ).fetchone()
        removed = connection.execute(
            "SELECT count(*) FROM audit_events WHERE project_id = %s "
            "AND action = 'scope.control_removed'",
            (project,),
        ).fetchone()
    assert left is not None and left[0] == 0 and left[1] > 0 and left[2] == 0
    assert removed == (1,)


def test_a_never_finalized_engagement_gets_its_work_at_the_worker_start(
    migrated: Database,
) -> None:
    """New, 17 November 2026: an engagement whose controls were selected under SP6 and whose
    scope was never finalized holds controls in scope with no work. The worker's start gives
    them their work (and the report task) as a scope change would, once: a second start
    creates nothing. An engagement not launched is left alone."""
    owner, base, team = _launched_empty(migrated, "never-final")
    project = team["project"]
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    keys = [c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
            if c["area"] == "ITGC"][:2]  # fmt: skip
    draft = _new_engagement(migrated, "never-final-draft")
    draft_sap = (
        draft["owner"]
        .post(
            f"{_base(draft['org'], draft['project'])}/systems",
            json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
        )
        .json()["applications"][0]
    )
    with connect(migrated.url) as connection:
        # As SP6 left them: in scope, with no work (selected, never finalized).
        with connection.cursor() as cursor:
            for key in keys:
                include_control(cursor, team["org"], project, UUID(sap["id"]), None, key)
                include_control(
                    cursor, draft["org"], draft["project"], UUID(draft_sap["id"]), None, key
                )
        connection.commit()
    assert _work(migrated, project) == (0, 0, 0)
    with connect(migrated.url) as connection:
        started = start_waiting_scope(connection)
    assert project in started and draft["project"] not in started
    with_work, reports, requests = _work(migrated, project)
    assert (with_work, reports) == (2, 1)
    assert _work(migrated, draft["project"]) == (0, 0, 0)
    with connect(migrated.url) as connection:
        plans = connection.execute(
            "SELECT count(*) FROM evidence_plans WHERE project_id = %s", (project,)
        ).fetchone()
        audit = connection.execute(
            "SELECT actor_user_id, payload->>'source' FROM audit_events WHERE project_id = %s "
            "AND action = 'task.created' ORDER BY created_at LIMIT 1",
            (project,),
        ).fetchone()
    assert plans == (2,)
    # Recorded as made by the person who launched the engagement, as a catch-up.
    assert audit == (team["owner_id"], "scope_catch_up")
    # Idempotent: the next start finds nothing waiting.
    with connect(migrated.url) as connection:
        assert project not in start_waiting_scope(connection)
    assert _work(migrated, project) == (2, 1, requests)


class _Connection:
    """A connection that only counts commits and rollbacks."""

    def __init__(self) -> None:
        self.rollbacks = 0

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        self.rollbacks += 1


def test_an_engagement_whose_catch_up_fails_is_named_with_its_cause_and_the_rest_start(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Added 18 November 2026, after the independent review of this change: a failure was
    logged without saying which engagement or why (docs/engineering-standards.md section 4).
    One engagement's failure is rolled back and named, with the error's type (never its
    message, which can carry data), and the next engagement still gets its work."""
    failing, starting = uuid4(), uuid4()
    monkeypatch.setattr(
        scope_changes,
        "_waiting",
        lambda _c, _l: [(uuid4(), failing, uuid4()), (uuid4(), starting, uuid4())],
    )

    def reconcile(_c: Any, _o: Any, project_id: UUID, _a: Any, source: str) -> list[UUID]:
        assert source == "scope_catch_up"
        if project_id == failing:
            raise RuntimeError("the database said something")
        return []

    monkeypatch.setattr(scope_changes, "reconcile_scope", reconcile)
    connection = _Connection()
    with caplog.at_level(logging.WARNING, logger=scope_changes.logger.name):
        started = start_waiting_scope(connection)  # type: ignore[arg-type]
    assert started == [starting] and connection.rollbacks == 1
    (said,) = [r.getMessage() for r in caplog.records]
    assert str(failing) in said and "RuntimeError" in said
    assert "the database said something" not in said


def test_the_catch_up_keeps_a_plan_the_control_already_has(migrated: Database) -> None:
    """Regression (18 November 2026, the independent review of PR #3, finding E1): a control
    selected under SP6 can get its evidence plan before the worker's start gives it its work
    (evidence_plans.plan_to_follow, when the agents have something to do on it). The
    catch-up then planned it again with the rules, writing over the planner agent's work on
    a plan no person had approved. The approved workflow plans a control once and changes a
    plan only through the planner's run or a person (agent proposes, the human approves):
    the catch-up gives the control its tasks and keeps the plan as it stands."""
    from ai_workforce_api.evidence_plans import generate

    owner, base, team = _launched_empty(migrated, "catch-up-keeps-plan")
    project = team["project"]
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    key = next(c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
               if c["area"] == "ITGC")  # fmt: skip
    with connect(migrated.url) as connection:
        with connection.cursor() as cursor:
            include_control(cursor, team["org"], project, UUID(sap["id"]), None, key)
        connection.commit()
        [(control,)] = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included", (project,)
        ).fetchall()
        # Planned before the catch-up, then refined by the planner agent: its own words on
        # the plan and on one request, on a plan no person approved.
        generate(connection, None, team["org"], project, UUID(str(control)), team["owner_id"])
        connection.execute(
            "UPDATE evidence_plans SET source = 'MODEL', run_attempts = 1, "
            "understanding = understanding || '{\"agent_note\": \"The planner''s reading\"}' "
            "WHERE engagement_control_id = %s",
            (control,),
        )
        [(requirement, title)] = connection.execute(
            "UPDATE evidence_requirements SET title = 'The planner''s wording', origin = 'AGENT' "
            "WHERE id = (SELECT id FROM evidence_requirements WHERE engagement_control_id = %s "
            "AND status <> 'REMOVED' ORDER BY phase, requirement_key LIMIT 1) "
            "RETURNING id, title",
            (control,),
        ).fetchall()
        connection.commit()
        plan_before = connection.execute(
            "SELECT id, source, status, understanding, version FROM evidence_plans "
            "WHERE engagement_control_id = %s",
            (control,),
        ).fetchone()
        requirements_before = connection.execute(
            "SELECT id, status, title, pending_change FROM evidence_requirements "
            "WHERE engagement_control_id = %s ORDER BY id",
            (control,),
        ).fetchall()
    assert _work(migrated, project)[0] == 0
    with connect(migrated.url) as connection:
        assert project in start_waiting_scope(connection)
    # The control has its work now.
    assert _work(migrated, project)[0] == 1
    with connect(migrated.url) as connection:
        plan_after = connection.execute(
            "SELECT id, source, status, understanding, version FROM evidence_plans "
            "WHERE engagement_control_id = %s",
            (control,),
        ).fetchone()
        requirements_after = connection.execute(
            "SELECT id, status, title, pending_change FROM evidence_requirements "
            "WHERE engagement_control_id = %s ORDER BY id",
            (control,),
        ).fetchall()
    # The plan, its content and every request are as the agent and the people left them.
    assert plan_after == plan_before
    assert requirements_after == requirements_before
    assert (requirement, title) in [(r[0], r[2]) for r in requirements_after]


def test_selection_before_launch_creates_no_work(migrated: Database) -> None:
    """Rewritten 17 November 2026 from test_finalizing_needs_a_launch_and_a_control. Old: the
    finalize route refused before the launch ("launch the engagement first") and with no
    control selected. New: that route is removed with the finalize step; what it protected
    stays: nothing is created before the launch, which plans what is in scope then."""
    team = _new_engagement(migrated, "select-early")
    owner, base = team["owner"], _base(team["org"], team["project"])
    sap = owner.post(
        f"{base}/systems",
        json={"name": "SAP ERP", "layer": "APPLICATION", "approved_areas": ["ITGC"]},
    ).json()["applications"][0]
    key = next(c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
               if c["area"] == "ITGC")  # fmt: skip
    chosen = owner.post(
        f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": [key]}
    )
    assert chosen.status_code == 200, chosen.text
    assert _work(migrated, team["project"]) == (0, 0, 0)


def test_an_engagement_launched_with_controls_keeps_starting_new_ones(
    migrated: Database,
) -> None:
    """Rewritten 17 November 2026 from
    test_an_engagement_launched_with_controls_is_final_from_launch. Old: the launch marked the
    scope final (scope_finalized_at set). New: nothing is marked final, and a control selected
    afterwards still gets its work at once."""
    team = _launched(migrated, "final-at-launch")
    owner, base = team["owner"], _base(team["org"], team["project"])
    snapshot = owner.get(base).json()
    assert "scope_finalized_at" not in snapshot["settings"]
    sap = next(a for a in snapshot["applications"] if a["name"] == "SAP ERP")
    before = _work(migrated, team["project"])[0]
    free = [c["library_key"] for c in _options(owner, base, system_id=sap["id"])["controls"]
            if not c["in_scope"]][:1]  # fmt: skip
    assert free
    owner.post(f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": free})
    assert _work(migrated, team["project"])[0] == before + 1


def test_selection_refuses_what_does_not_apply(migrated: Database) -> None:
    owner, base, team = _launched_empty(migrated, "select-refusals")
    sap = owner.post(f"{base}/systems", json={"name": "SAP", "layer": "APPLICATION"}).json()[
        "applications"
    ][0]
    snapshot = owner.post(
        f"{base}/processes/setup", json={"name": "Payroll", "domain": "HIRE_TO_RETIRE"}
    ).json()
    payroll = snapshot["processes"][0]
    other = owner.post(
        f"{base}/processes/setup", json={"name": "Contractors", "domain": "HIRE_TO_RETIRE"}
    ).json()
    contractors = next(p for p in other["processes"] if p["name"] == "Contractors")
    itgc = _options(owner, base, system_id=sap["id"])["controls"][0]["library_key"]
    hr = _options(owner, base, process_id=payroll["id"])["controls"][0]["library_key"]
    for body in (
        {"system_id": sap["id"], "library_keys": [hr]},
        {"process_id": payroll["id"], "library_keys": [itgc]},
        {"system_id": sap["id"], "process_id": payroll["id"], "library_keys": [itgc]},
        {"system_id": sap["id"], "library_keys": ["not-a-control"]},
    ):
        assert owner.post(f"{base}/scope/select", json=body).status_code == 422, body
    assert (
        owner.post(
            f"{base}/scope/select", json={"system_id": str(uuid4()), "library_keys": [itgc]}
        ).status_code
        == 404
    )
    # One library row per process control: given to one process, it stays with it.
    assert (
        owner.post(
            f"{base}/scope/select", json={"process_id": payroll["id"], "library_keys": [hr]}
        ).status_code
        == 200
    )
    taken = owner.post(
        f"{base}/scope/select", json={"process_id": contractors["id"], "library_keys": [hr]}
    )
    assert taken.status_code == 409
    with connect(migrated.url) as connection:
        reader_id = _add_user(
            connection, team["org"], f"reader-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], reader_id)
    reader = _session(migrated, reader_id)
    assert reader.get(f"{base}/scope/options", params={"system_id": sap["id"]}).status_code == 403
    # Rewritten 17 November 2026: the reader was refused Review and finalize, which is removed;
    # the reader is refused the selection that now starts the work.
    assert (
        reader.post(
            f"{base}/scope/select", json={"system_id": sap["id"], "library_keys": [itgc]}
        ).status_code
        == 403
    )
