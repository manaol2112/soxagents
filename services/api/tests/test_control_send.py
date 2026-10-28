"""Approve and send a control's requests from its Request step, to its owner (decided by the
product owner on 28 October 2026). The drafts go through the Evidence center's own approval
and send; a control with no owner asks for one before anything goes."""

from typing import Any
from uuid import UUID

from support import Database
from test_evidence_center import _all, _ready
from test_evidence_flow import _project
from test_evidence_owners import _unaddress
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _control_of(migrated: Database, draft_id: str) -> str:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (UUID(draft_id),)
        ).fetchone()
    assert row is not None
    return str(row[0])


def _state(migrated: Database, control: str) -> tuple[list[tuple[str, str]], tuple[str, str]]:
    with connect(migrated.url) as connection:
        drafts = [
            (str(r[0]), str(r[1]))
            for r in connection.execute(
                "SELECT status, recipient FROM pbc_requests WHERE engagement_control_id = %s "
                "ORDER BY created_at",
                (UUID(control),),
            ).fetchall()
        ]
        owner = connection.execute(
            "SELECT owner_name, owner_email FROM engagement_controls WHERE id = %s",
            (UUID(control),),
        ).fetchone()
    assert owner is not None
    return drafts, (str(owner[0]), str(owner[1]))


def _send(client: Any, team: dict[str, Any], control: str, **body: Any) -> dict[str, Any]:
    answer = client.post(
        f"{_project(team)}/controls/{control}/evidence-requests/approve-send", json=body
    )
    assert answer.status_code == 200, answer.text
    result: dict[str, Any] = answer.json()
    return result


def test_a_control_without_an_owner_asks_for_one_then_sends_to_them(
    migrated: Database,
) -> None:
    team = _ready(migrated, "cs-owner")
    owner = team["owner"]
    rows = [r for r in _all(owner, team) if r["control_ref"] == "ITGC-AC-06"]
    assert rows, "the control has drafted requests"
    control = _control_of(migrated, rows[0]["id"])
    _unaddress(migrated, team, rows, ["ITGC-AC-06"])
    before, _ = _state(migrated, control)

    # No owner on record: nothing goes, and the page asks for one.
    asked = _send(owner, team, control, preview=True)
    assert asked["needs_owner"] is True and asked["targets"] == []
    # The pop-up names the control and offers the engagement's people at the client.
    assert asked["control_ref"] == "ITGC-AC-06" and asked["control_title"]
    assert asked["domains"]
    assert all({"name", "email", "role"} <= set(c) for c in asked["contacts"])
    assert _send(owner, team, control, preview=False)["needs_owner"] is True
    assert _state(migrated, control)[0] == before

    # With the owner named: the preview says where each goes and changes nothing.
    named = {"owner_name": "Dana Reyes", "owner_email": "dana.reyes@client.example"}
    preview = _send(owner, team, control, preview=True, **named)
    assert preview["needs_owner"] is False and preview["targets"]
    assert {t["recipient"] for t in preview["targets"]} == {"dana.reyes@client.example"}
    # A request is named by its title or its phase, never by the control's code.
    assert all(t["title"] and t["title"] != "ITGC-AC-06" for t in preview["targets"])
    assert _state(migrated, control) == (before, ("", ""))

    # Sent: the owner is the control's, each draft goes to them, approved and sent.
    sent = _send(owner, team, control, preview=False, **named)
    assert sent["refused"] == 0, sent["targets"]
    assert sent["done"] == len(sent["targets"]) >= 1
    drafts, recorded = _state(migrated, control)
    assert recorded == ("Dana Reyes", "dana.reyes@client.example")
    assert drafts and all(status == "SENT" for status, _ in drafts), drafts
    assert {recipient for _, recipient in drafts} == {"dana.reyes@client.example"}
    # The Evidence center shows them as sent: they are its own records.
    center = {r["id"]: r for r in _all(owner, team)}
    assert all(center[r["id"]]["status"] == "SENT" for r in rows if r["id"] in center)
    # Nothing left to send.
    again = _send(owner, team, control, preview=True)
    assert (again["drafts"], again["targets"]) == (0, [])


def test_an_owner_on_record_receives_the_requests_without_asking(migrated: Database) -> None:
    team = _ready(migrated, "cs-known")
    owner = team["owner"]
    rows = [r for r in _all(owner, team) if r["control_ref"] == "ITGC-AC-03"]
    control = _control_of(migrated, rows[0]["id"])
    # Addressed to no one, but the control's owner is on record.
    _unaddress(migrated, team, rows, [])
    _, recorded = _state(migrated, control)
    assert recorded[1] != ""
    preview = _send(owner, team, control, preview=True)
    assert preview["needs_owner"] is False
    assert {t["recipient"] for t in preview["targets"]} == {recorded[1]}


def test_a_bad_owner_is_refused_and_only_the_team_may_send(migrated: Database) -> None:
    team = _ready(migrated, "cs-refused")
    owner = team["owner"]
    rows = [r for r in _all(owner, team) if r["control_ref"] == "ITGC-AC-06"]
    control = _control_of(migrated, rows[0]["id"])
    refused = owner.post(
        f"{_project(team)}/controls/{control}/evidence-requests/approve-send",
        json={"preview": False, "owner_name": "", "owner_email": "not an email"},
    )
    assert refused.status_code == 422
    other = _ready(migrated, "cs-other")
    stranger = other["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-requests/approve-send",
        json={"preview": True},
    )
    assert stranger.status_code == 404


def test_design_evidence_is_held_to_the_plans_own_rule() -> None:
    """The test plan does not hold design evidence to an approved attribute (the design is
    assessed from it); the send check did, so a design request the plan showed as sound
    could not be sent (28 October 2026). Operating evidence still must map to one."""
    from uuid import uuid4

    from ai_workforce_api.request_quality import quality_from

    def mapping(phase: str) -> bool:
        item = (uuid4(), "E8", "One access grant traced", ["CONTROL_EXECUTION"], None, None,
                False, False)  # fmt: skip
        checks = quality_from(
            uuid4(), uuid4(), phase, "One access grant traced from request to grant.",
            "DRAFT", [item], None, False,
        )  # fmt: skip
        return next(check.ok for check in checks if check.key == "mapping")

    assert mapping("DESIGN") is True
    assert mapping("INTERIM") is False
    assert mapping("ROLLFORWARD") is False


def test_a_request_held_for_its_phase_waits_and_is_not_a_failure(
    migrated: Database, monkeypatch: Any
) -> None:
    """Interim and roll-forward requests are prepared ahead and wait for their phase to be
    released (milestone E): Approve and send leaves them, says they wait, and sends the
    rest (28 October 2026)."""
    import ai_workforce_api.evidence_plans as evidence_plans

    team = _ready(migrated, "cs-held")
    owner = team["owner"]
    rows = [r for r in _all(owner, team) if r["control_ref"] == "ITGC-AC-03"]
    control = _control_of(migrated, rows[0]["id"])
    held = rows[0]["id"]
    real = evidence_plans.held_for_planning

    def hold(connection: Any, request_id: UUID) -> str | None:
        if str(request_id) == held:
            return "release the interim phase first"
        return real(connection, request_id)

    monkeypatch.setattr(evidence_plans, "held_for_planning", hold)
    preview = _send(owner, team, control, preview=True)
    waiting = [t for t in preview["targets"] if t["waiting"]]
    assert [t["id"] for t in waiting] == [held]
    assert waiting[0]["ok"] is False
    assert waiting[0]["detail"] == (
        "Will become available after design and implementation testing and interim release."
    )
    # Never sent, never counted as refused.
    sent = _send(owner, team, control, preview=False)
    assert all(t["id"] != held or t["waiting"] for t in sent["targets"])
    with connect(migrated.url) as connection:
        status = connection.execute(
            "SELECT status FROM pbc_requests WHERE id = %s", (UUID(held),)
        ).fetchone()
    assert status is not None and status[0] == "DRAFT"


def test_the_review_can_change_who_a_request_goes_to_and_copy_others(
    migrated: Database,
) -> None:
    """In the review, a request's recipient is changed and others are copied; it is sent to
    them, through the request's own assignment (28 October 2026)."""
    team = _ready(migrated, "cs-route")
    owner = team["owner"]
    rows = [r for r in _all(owner, team) if r["control_ref"] == "ITGC-AC-03"]
    control = _control_of(migrated, rows[0]["id"])
    preview = _send(owner, team, control, preview=True)
    assert "contacts" in preview and preview["domains"]
    chosen = next(t for t in preview["targets"] if t["ok"])

    bad = owner.post(
        f"{_project(team)}/controls/{control}/evidence-requests/approve-send",
        json={"preview": False, "routing": [{"id": chosen["id"], "recipient": "nobody"}]},
    )
    assert bad.status_code == 422
    assert all(status == "DRAFT" for status, _ in _state(migrated, control)[0])

    sent = _send(
        owner, team, control, preview=False,
        routing=[{
            "id": chosen["id"], "recipient": "maria.chen@client.example",
            "cc": ["dana.reyes@client.example"],
        }],
    )  # fmt: skip
    assert sent["refused"] == 0, sent["targets"]
    with connect(migrated.url) as connection:
        routed = connection.execute(
            "SELECT status, recipient, cc_recipients FROM pbc_requests "
            "WHERE engagement_control_id = %s AND recipient = 'maria.chen@client.example'",
            (UUID(control),),
        ).fetchall()
    assert routed, "the changed request went to the new recipient"
    assert all(str(r[0]) == "SENT" for r in routed)
    assert all(list(r[2]) == ["dana.reyes@client.example"] for r in routed)
