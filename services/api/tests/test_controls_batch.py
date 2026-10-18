"""The Controls register at scale: drafted requests submitted for approval together (each
still approved on its own), an owner set on chosen controls, and each control's agents at
work, from their run records."""

from typing import Any
from uuid import UUID

from support import Database
from test_control_progress import _controls
from test_engagement_data import _engagement, _requests
from test_evidence_intake import _client, _Scheduler
from test_execution import _add_project_member, _add_user
from test_outbound import migrated

from ai_workforce_api.control_reviews import REPERFORM_FAILED
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.workpaper_service import DRAFT_FAILED, ensure

_ = migrated


def _drafts(database: Database, project: UUID) -> list[tuple[str, int]]:
    with connect(database.url) as connection:
        return [
            (str(row[0]), int(row[1]))
            for row in connection.execute(
                "SELECT id, version FROM pbc_requests WHERE project_id = %s AND status = 'DRAFT' "
                "ORDER BY created_at",
                (project,),
            ).fetchall()
        ]


def test_drafted_requests_go_for_approval_together_and_each_is_still_approved(
    migrated: Database,
) -> None:
    team, client = _engagement(migrated, "batch")
    drafts = _drafts(migrated, team["project"])
    assert len(drafts) >= 3
    (first, v1), (second, v2), (stale, v3) = drafts[:3]
    path = f"/organizations/{team['org']}/projects/{team['project']}/pbc-request-batches/submit"
    answer = client.post(
        path,
        json={
            "items": [
                {"request_id": first, "version": v1},
                {"request_id": second, "version": v2},
                {"request_id": first, "version": v1},
                {"request_id": stale, "version": v3 + 5},
            ]
        },
    )
    assert answer.status_code == 200, answer.text
    result = answer.json()
    assert (result["submitted"], result["failed"]) == (2, 1)
    assert [(o["request_id"], o["ok"], o["detail"]) for o in result["outcomes"]] == [
        (first, True, ""),
        (second, True, ""),
        (stale, False, "pbc request changed"),
    ]
    with connect(migrated.url) as connection:
        statuses = dict(
            connection.execute(
                "SELECT id::text, status FROM pbc_requests WHERE id = ANY(%s::uuid[])",
                ([first, second, stale],),
            ).fetchall()
        )
        # One approval per request, each for its own message; nothing has gone out.
        approvals = connection.execute(
            "SELECT count(*) FROM approvals WHERE project_id = %s AND decision = 'PENDING'",
            (team["project"],),
        ).fetchone()
        sent = connection.execute(
            "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
    assert statuses == {first: "APPROVAL_PENDING", second: "APPROVAL_PENDING", stale: "DRAFT"}
    assert approvals is not None and approvals[0] >= 2
    assert sent == (0,)
    # An empty batch is refused.
    assert client.post(path, json={"items": []}).status_code == 422


def test_an_owner_is_set_on_chosen_controls_by_someone_who_may(migrated: Database) -> None:
    team, owner = _engagement(migrated, "owners")
    rows = _controls(owner, team)
    chosen = sorted(rows)[:2]
    path = (
        f"/organizations/{team['org']}/projects/{team['project']}/onboarding/controls/owner-batch"
    )
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection, team["org"], f"c-{team['project'].hex[:6]}@example.com", "CONTRIBUTOR"
        )
        _add_project_member(connection, team["org"], team["project"], contributor_id)
    contributor = _client(migrated, contributor_id, _Scheduler())
    body: dict[str, Any] = {
        "control_ids": chosen,
        "owner_name": "Morgan Lee",
        "owner_email": "Morgan.Lee@client.example",
    }
    # Setting owners is setup work: a contributor cannot.
    assert contributor.post(path, json=body).status_code in (403, 404)
    assert owner.post(path, json={**body, "owner_email": "not-an-email"}).status_code == 422
    done = owner.post(path, json=body)
    assert done.status_code == 200, done.text
    assert done.json()["updated"] >= 2
    after = _controls(owner, team)
    refs = {after[c]["control_ref"] for c in chosen}
    for row in after.values():
        if row["control_ref"] in refs:
            # Every instance of a chosen control, as the control editor does.
            assert (row["owner_name"], row["owner_email"]) == (
                "Morgan Lee", "morgan.lee@client.example"
            )  # fmt: skip
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT payload FROM audit_events WHERE project_id = %s "
            "AND action = 'onboarding.control' ORDER BY created_at DESC LIMIT 1",
            (team["project"],),
        ).fetchone()
    assert audited is not None and audited[0]["bulk_owner"] is True


def test_each_control_says_what_its_agents_are_doing(migrated: Database) -> None:
    team, client = _engagement(migrated, "agents")
    with connect(migrated.url) as connection:
        ids = _requests(connection, team["project"])
        control = connection.execute(
            "SELECT engagement_control_id, organization_id FROM pbc_requests WHERE id = %s",
            (ids[0],),
        ).fetchone()
        assert control is not None
        control_id, org = control
        # The tester's run is queued; the workpaper draft gave up; the reviewer agent's
        # re-performance did not finish.
        connection.execute(
            """
            INSERT INTO test_sheets (organization_id, project_id, engagement_control_id,
                                     method, attributes, requested_by, run_status)
            VALUES (%s, %s, %s, 'TEST_OF_ONE', '["Approved"]', %s, 'PENDING')
            """,
            (org, team["project"], control_id, team["owner_id"]),
        )
        with transaction(connection) as cursor:
            ensure(cursor, org, team["project"], control_id, team["owner_id"], ("DESIGN",))
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE', draft_note = %s "
            "WHERE engagement_control_id = %s",
            (DRAFT_FAILED, control_id),
        )
        connection.execute(
            """
            INSERT INTO control_reviews (organization_id, project_id, engagement_control_id,
                                         opened_by, status, reperform_status, reperform_note)
            VALUES (%s, %s, %s, %s, 'OPEN', 'IDLE', %s)
            """,
            (org, team["project"], control_id, team["owner_id"], REPERFORM_FAILED),
        )
        app = connection.execute(
            "SELECT engagement_application_id FROM engagement_controls WHERE id = %s",
            (control_id,),
        ).fetchone()
        if app is not None and app[0] is not None:
            connection.execute(
                "UPDATE engagement_applications SET layer = 'DATABASE', hosting = 'SAAS' "
                "WHERE id = %s",
                (app[0],),
            )
        connection.commit()
    rows = _controls(client, team)
    row = rows[str(control_id)]
    assert row["agents"] == {
        "reading": 0,
        "read_failed": 0,
        "testing": "QUEUED",
        "drafting": "IDLE",
        "reviewing": "IDLE",
        "stopped": ["drafting", "reviewing"],
    }
    if app is not None and app[0] is not None:
        assert (row["application_layer"], row["application_hosting"]) == ("DATABASE", "SAAS")
    # A control nothing runs on says so.
    quiet = next(r for c, r in rows.items() if c != str(control_id))
    assert quiet["agents"]["testing"] == "IDLE" and quiet["agents"]["stopped"] == []
