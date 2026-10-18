"""Workpaper templates after launch (Milestone 8.16): they still change, the change reaches
workpapers that have not started, and a started workpaper keeps the template it began with.
Confirming the templates is a step before launch and is not asked again after it."""

from typing import Any
from uuid import UUID

from support import Database
from test_engagement_close import _launched
from test_evidence_analysis import _Provider
from test_manual_controls import _body
from test_onboarding import _base as _setup
from test_outbound import migrated
from test_testing_engine import _base
from test_workpapers import _tested_control

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.workpaper_service import ensure, run_draft

__all__ = ["migrated"]


def _workpaper(migrated: Database, workpaper_id: str) -> tuple[Any, ...]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT template_key, started_at IS NOT NULL, template_snapshot, draft_status "
            "FROM workpapers WHERE id = %s",
            (workpaper_id,),
        ).fetchone()
    assert row is not None
    return tuple(row)


def test_templates_stay_confirmed_after_launch_and_still_change(migrated: Database) -> None:
    team = _launched(migrated, "tpl-after-launch")
    owner, base = team["owner"], _setup(team["org"], team["project"])
    # A control added after launch does not ask for the templates to be confirmed again.
    assert owner.post(f"{base}/controls/new", json=_body()).status_code == 200
    body = owner.get(base).json()
    assert body["settings"]["templates_confirmed_at"] is not None
    workpapers = next(item for item in body["readiness"] if item["step"] == "workpapers")
    assert workpapers["complete"] is True, workpapers["issues"]
    # The team customises a standard template and applies it, after launch.
    made = owner.post(f"{base}/workpaper-templates/customize", json={"base_key": "itgc"})
    assert made.status_code == 200, made.text
    firm = next(t for t in made.json()["templates"] if t["source"] == "FIRM")
    applied = owner.post(f"{base}/workpaper-templates/{firm['template_id']}/apply")
    assert applied.status_code == 200, applied.text
    after = applied.json()
    assert after["settings"]["templates_confirmed_at"] is not None
    itgc = [c for c in after["controls"] if c["domain"] in ("ACCESS", "CHANGE", "OPERATIONS")]
    assert itgc and all(c["template_key"] == firm["key"] for c in itgc)


def test_a_started_workpaper_keeps_its_template(migrated: Database) -> None:
    team, client, sheet, _ticket = _tested_control(migrated, "tpl-pin")
    workpapers = f"{_base(team)}/workpapers"
    started = client.get(workpapers, params={"control_id": sheet["control_id"]}).json()[0]
    assert _workpaper(migrated, started["id"])[1] is False
    # The agent writes in it: it starts, and keeps the template it began with.
    draft = {"sections": [{"key": "population", "text": "The population was the listing."}]}
    with connect(migrated.url) as connection:
        assert run_draft(connection, _Provider([draft]), UUID(started["id"])) == "DONE"
    key, is_started, snapshot, _status = _workpaper(migrated, started["id"])
    assert is_started is True and key == "itgc"
    assert snapshot["key"] == "itgc" and snapshot["tabs"]
    # Another control's workpaper is open but not started.
    with connect(migrated.url) as connection:
        other = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND domain = 'ACCESS' "
            "AND id <> %s AND included ORDER BY control_ref LIMIT 1",
            (team["project"], sheet["control_id"]),
        ).fetchone()
        assert other is not None
        with transaction(connection) as cursor:
            ensure(cursor, team["org"], team["project"], other[0], team["owner_id"], ("DESIGN",))
        waiting = connection.execute(
            "SELECT id FROM workpapers WHERE engagement_control_id = %s AND stage = 'DESIGN'",
            (other[0],),
        ).fetchone()
        assert waiting is not None
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE' WHERE id = %s", (waiting[0],)
        )
        connection.commit()
    # The firm's template goes in for every IT general control.
    setup = _setup(team["org"], team["project"])
    made = client.post(f"{setup}/workpaper-templates/customize", json={"base_key": "itgc"})
    assert made.status_code == 200, made.text
    firm = next(t for t in made.json()["templates"] if t["source"] == "FIRM")
    assert (
        client.post(f"{setup}/workpaper-templates/{firm['template_id']}/apply").status_code == 200
    )
    # The one not started follows, and is drafted again in the new shape; the started one
    # keeps its own.
    key, is_started, _snapshot, status = _workpaper(migrated, str(waiting[0]))
    assert (key, is_started, status) == (firm["key"], False, "PENDING")
    key, is_started, snapshot, status = _workpaper(migrated, started["id"])
    assert (key, is_started) == ("itgc", True) and status == "IDLE"
    # Drafted again later, it is still drafted in the template it began with.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'PENDING' WHERE id = %s", (started["id"],)
        )
        connection.commit()
        assert run_draft(connection, None, UUID(started["id"])) == "DONE"
    body = client.get(workpapers, params={"control_id": sheet["control_id"]}).json()[0]
    assert body["content"]["template_key"] == "itgc"
