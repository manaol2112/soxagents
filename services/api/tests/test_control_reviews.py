"""Milestone 9.1: independent review of a control instance."""

from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_evidence_analysis import _Provider
from test_outbound import _session, migrated
from test_phase_release import _prepare_design
from test_testing_engine import _base, _controls, _sheet
from test_workpapers import _tested_control

from ai_workforce_api.control_reviews import disagreements, run_reperformance
from ai_workforce_api.db import connect
from ai_workforce_api.settings import Settings
from ai_workforce_api.workpaper_service import run_draft

_ = migrated


def test_the_reviewer_re_performs_each_result_without_the_testers_answer() -> None:
    item = UUID("01a12dd4-0000-7000-8000-000000000001")
    finals: list[str | None] = ["PASS", "EXCEPTION", "NOT_APPLICABLE", None]
    reviewed = [
        {"index": 0, "result": "EXCEPTION", "note": "Approved after go-live.", "citations": []},
        {"index": 1, "result": "PASS", "note": "The ticket is approved."},
        {"index": 2, "result": "PASS", "note": "Applies."},
        {"index": 3, "result": "EXCEPTION", "note": "Not tested yet."},
        {"index": 9, "result": "PASS", "note": "No such attribute."},
    ]
    found = disagreements(item, "T-1", finals, reviewed)
    assert [(f.severity, f.target["indexes"]) for f in found] == [
        ("MUST_FIX", [0]),
        ("SHOULD_FIX", [1]),
        ("OBSERVATION", [2]),
    ]
    assert found[0].text.startswith(
        "T-1: attribute A is marked passed, but the reviewer found an exception"
    )
    assert found[0].target["reviewer_result"] == "EXCEPTION"


def test_preparing_the_effectiveness_workpaper_opens_the_review_and_proposes_notes(
    migrated: Database,
) -> None:
    team, client, sheet, ticket_file = _prepared_control(migrated, "review", "LOG")
    base = _base(team)
    scheduler = team["scheduler"]
    assert len(scheduler.reviews) == 1
    listed = client.get(f"{base}/reviews")
    assert listed.status_code == 200, listed.text
    review = listed.json()[0]
    assert review["control_id"] == sheet["control_id"]
    assert review["label"] == "ITGC-AC-01 · SAP ERP"
    assert (review["status"], review["reperforming"], review["reperform_state"]) == (
        "OPEN",
        True,
        "QUEUED",
    )
    assert review["sheet_status"] == "SIGNED_OFF"
    assert review["viewer_is_reviewer"] is False and review["viewer_prepared"] is True
    row = _row(client, team, sheet["control_id"])
    assert (row["stage"], row["review_left"]) == ("IN_REVIEW", "REPERFORMING")
    assert row["next_step"] == "The reviewer is re-performing the testing"
    assert row["waiting_on"] == "AGENT"

    # The reviewer re-performs each tested item: it sees an exception the tester passed,
    # and finds the tester's exception met.
    attributes = len(sheet["attributes"])
    provider = _Provider(
        [
            {
                "results": [
                    {
                        "index": 0,
                        "result": "EXCEPTION",
                        "note": "The approver is the requester.",
                        "citations": [{"file": 0, "quote": "Demo Manager"}],
                    },
                    *[
                        {"index": index, "result": "PASS", "note": "Seen."}
                        for index in range(1, attributes)
                    ],
                ]
            },
            _all_pass(attributes),
            _all_pass(attributes),
        ]
    )
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
        assert run_reperformance(connection, provider, UUID(review["id"])) == "SKIPPED"
    assert len(provider.requests) == 3
    assert "independent reviewer" in provider.requests[0].system
    assert provider.requests[0].prompt.startswith("Re-perform the test of this item")
    # The tester's results are never in the reviewer's prompt.
    assert "EXCEPTION" not in provider.requests[1].prompt.split("<evidence>")[0].replace(
        '"EXCEPTION"', ""
    )
    review = client.get(f"{base}/reviews").json()[0]
    assert (review["reperforming"], review["reperform_state"], review["reperform_source"]) == (
        False,
        "IDLE",
        "MODEL",
    )
    assert review["sheet_version_reviewed"] == _sheet(client, team)["version"]
    notes = review["notes"]
    assert all(n["status"] == "PROPOSED" and n["raised_by"] == "AGENT" for n in notes)
    by_kind = {(n["target_kind"], n["severity"]) for n in notes}
    assert ("SAMPLE", "MUST_FIX") in by_kind  # 3 items where the frequency asks for 25
    assert ("WORKPAPER", "SHOULD_FIX") in by_kind  # no design workpaper yet
    labels = [item["label"] for item in sheet["items"]]
    disagreed = [n for n in notes if "reviewer_result" in n["target"]]
    assert [(n["severity"], n["target"]["reviewer_result"]) for n in disagreed] == [
        ("MUST_FIX", "EXCEPTION"),
        ("SHOULD_FIX", "PASS"),
    ]
    assert disagreed[0]["text"].startswith(f"{labels[0]}: attribute A is marked passed")
    cited = disagreed[0]["target"]["citations"]
    assert cited[0]["file_id"] == ticket_file and cited[0]["found"] is True
    assert cited[0]["quote"] == "Demo Manager"
    # The tester's passes now always cite a passage that checks out (an uncited pass is
    # left for a person: testing_engine.supported), so the reviewer finds none uncited.
    uncited = [n for n in notes if "passed without a cited passage" in n["text"]]
    assert uncited == []
    assert review["blocking"] == [f"{len(notes)} notes not cleared yet"]
    row = _row(client, team, sheet["control_id"])
    assert (row["review_left"], row["next_step"]) == ("DECIDE", "Decide the reviewer's notes")


def test_the_reviewer_decides_notes_a_must_fix_reopens_the_work_and_signs_off(
    migrated: Database,
) -> None:
    team, client, sheet, _ticket_file = _prepared_control(migrated, "review-notes", "DISMISS")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    assert review["reperform_source"] == "RULES"
    assert "re-performs the testing by hand" in review["reperform_note"]
    path = f"{base}/reviews/{review['id']}"
    sample_note = next(n for n in review["notes"] if n["target_kind"] == "SAMPLE")
    # The preparer, who signed off the testing, is not the reviewer.
    refused = client.post(
        f"{path}/notes/{sample_note['id']}/decide",
        json={"version": review["version"], "action": "DISMISS", "reason": "Agreed."},
    )
    assert refused.status_code == 409 and "reviewer role" in refused.json()["detail"]
    reviewer = _session(migrated, team["reviewer_id"])
    no_reason = reviewer.post(
        f"{path}/notes/{sample_note['id']}/decide",
        json={"version": review["version"], "action": "DISMISS"},
    )
    assert no_reason.status_code == 422
    dismissed = reviewer.post(
        f"{path}/notes/{sample_note['id']}/decide",
        json={
            "version": review["version"],
            "action": "DISMISS",
            "reason": "Three of three events in the period: the whole population.",
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    review = dismissed.json()
    assert review["viewer_is_reviewer"] is True and review["viewer_prepared"] is False
    decided = next(n for n in review["notes"] if n["id"] == sample_note["id"])
    assert decided["status"] == "DISMISSED" and decided["decided_by_name"]
    assert decided["decision_reason"].startswith("Three of three")
    stale = reviewer.post(
        f"{path}/notes/{sample_note['id']}/decide",
        json={"version": review["version"], "action": "ACCEPT"},
    )
    assert stale.status_code == 409  # already decided

    # The reviewer raises a must-fix note on a result: the sheet and the workpaper reopen.
    first_item = sheet["items"][0]["id"]
    raised = reviewer.post(
        f"{path}/notes",
        json={
            "version": review["version"],
            "target_kind": "RESULT",
            "severity": "MUST_FIX",
            "text": "Attribute A: the approver on T-0 is the requester. Test it again.",
            "item_id": first_item,
        },
    )
    assert raised.status_code == 200, raised.text
    review = raised.json()
    mine = next(n for n in review["notes"] if n["raised_by"] == "PERSON")
    assert mine["status"] == "OPEN" and mine["target"] == {"item_id": first_item}
    assert mine["reopened"][0] == "SHEET" and mine["reopened"][1].startswith("WORKPAPER:")
    assert _sheet(client, team)["status"] == "OPEN"
    papers = client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()
    assert [p["status"] for p in papers] == ["DRAFT"]
    assert "the testing is not signed off" in review["blocking"]
    blocked = reviewer.post(f"{path}/sign-off", json={"version": review["version"]})
    assert blocked.status_code == 409 and "not signed off" in blocked.json()["detail"]
    # The reopened sheet comes first; the review waits behind it.
    row = _row(client, team, sheet["control_id"])
    assert (row["review_left"], row["next_step"]) == ("DECIDE", "Sign off the testing")

    # The remaining proposals are dismissed; the preparer answers the note.
    for note in review["notes"]:
        if note["status"] == "PROPOSED":
            review = reviewer.post(
                f"{path}/notes/{note['id']}/decide",
                json={"version": review["version"], "action": "DISMISS", "reason": "Noted."},
            ).json()
    assert _row(client, team, sheet["control_id"])["review_left"] == "ADDRESS"
    responded = client.post(
        f"{path}/notes/{mine['id']}/respond",
        json={"version": review["version"], "response": "Re-tested: the approver is the manager."},
    )
    assert responded.status_code == 200, responded.text
    review = responded.json()
    assert next(n for n in review["notes"] if n["id"] == mine["id"])["status"] == "RESPONDED"
    assert _row(client, team, sheet["control_id"])["review_left"] == "CLEAR"
    returned = reviewer.post(
        f"{path}/notes/{mine['id']}/clear",
        json={"version": review["version"], "action": "RETURN", "reason": "Cite the ticket."},
    )
    assert returned.status_code == 200, returned.text
    review = returned.json()
    assert next(n for n in review["notes"] if n["id"] == mine["id"])["status"] == "OPEN"
    review = client.post(
        f"{path}/notes/{mine['id']}/respond",
        json={"version": review["version"], "response": "Cited T-0, approved_by Demo Manager."},
    ).json()
    cleared = reviewer.post(f"{path}/notes/{mine['id']}/clear", json={"version": review["version"]})
    assert cleared.status_code == 200, cleared.text
    review = cleared.json()
    note = next(n for n in review["notes"] if n["id"] == mine["id"])
    assert note["status"] == "CLEARED" and note["cleared_by_name"]

    # The preparer signs the testing off again, logs the deficiency, and prepares the
    # workpaper again: the review is re-performed, and the old proposals are withdrawn.
    current = _sheet(client, team)
    signed = client.post(
        f"{base}/test-sheets/{current['id']}/sign-off", json={"version": current["version"]}
    )
    assert signed.status_code == 200, signed.text
    current = signed.json()
    logged = client.post(
        f"{base}/test-sheets/{current['id']}/deficiency",
        json={"version": current["version"], "action": "LOG"},
    )
    assert logged.status_code == 200, logged.text
    paper = client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()[0]
    with connect(migrated.url) as connection:
        assert run_draft(connection, _Provider([{"sections": []}]), UUID(paper["id"])) == "DONE"
    paper = client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()[0]
    prepared = client.post(
        f"{base}/workpapers/{paper['id']}/prepare", json={"version": paper["version"]}
    )
    assert prepared.status_code == 200, prepared.text
    assert len(team["scheduler"].reviews) == 2
    review = client.get(f"{base}/reviews").json()[0]
    assert review["reperforming"] is True
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    statuses = {n["status"] for n in review["notes"]}
    assert "WITHDRAWN" not in statuses  # the dismissed ones stay dismissed
    for note in review["notes"]:
        if note["status"] == "PROPOSED":
            review = reviewer.post(
                f"{path}/notes/{note['id']}/decide",
                json={"version": review["version"], "action": "DISMISS", "reason": "Noted."},
            ).json()
    assert review["blocking"] == []
    assert _row(client, team, sheet["control_id"])["review_left"] == "SIGN"
    # The dashboard and the inbox say where the review stands (9.2).
    dashboard = client.get(f"{base}/workspace/dashboard").json()["review"]
    assert (dashboard["in_scope"], dashboard["to_sign"], dashboard["signed_off"]) == (31, 1, 0)
    assert dashboard["not_started"] == 30 and dashboard["complete"] is False
    inbox = client.get(f"{base}/console/inbox").json()["waiting"]
    waiting = next(item for item in inbox if item["kind"] == "control_review")
    assert waiting["title"] == "Sign off the review of ITGC-AC-01 · SAP ERP"
    assert waiting["link"] == "controls"
    # Only this control is in scope now, so its review completes the engagement's.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE project_id = %s AND id <> %s",
            (team["project"], UUID(sheet["control_id"])),
        )

    # Nobody signs off a review of work they signed off: the preparer, given the reviewer
    # role, is still refused.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE project_memberships SET engagement_role = 'REVIEWER' "
            "WHERE project_id = %s AND user_id = %s",
            (team["project"], team["owner_id"]),
        )
    own = client.post(f"{path}/sign-off", json={"version": review["version"]})
    assert own.status_code == 409 and "another reviewer" in own.json()["detail"]
    # Design and implementation testing is applicable to the control: its workpaper is
    # prepared before the review signs off, or the conclusion cannot be final (workflow
    # integrity W1, owner's decision 4).
    _prepare_design(migrated, team, sheet["control_id"])
    signed_off = reviewer.post(
        f"{path}/sign-off", json={"version": review["version"], "note": "Reviewed."}
    )
    assert signed_off.status_code == 200, signed_off.text
    review = signed_off.json()
    assert (review["status"], review["signoff_note"]) == ("SIGNED_OFF", "Reviewed.")
    row = _row(client, team, sheet["control_id"])
    assert (row["stage"], row["conclusion"], row["review_left"]) == (
        "CONCLUDED",
        "EXCEPTION",
        "SIGNED",
    )
    assert row["next_step"] == "Concluded with exceptions"
    assert row["final"] is True and row["not_final"] == []
    dashboard = client.get(f"{base}/workspace/dashboard").json()["review"]
    assert (dashboard["in_scope"], dashboard["signed_off"], dashboard["complete"]) == (1, 1, True)
    marks = {m["key"]: m for m in client.get(f"{base}/workspace/plan").json()["milestones"]}
    assert marks["REVIEW_COMPLETE"]["status"] == "DONE"
    with connect(migrated.url) as connection:
        task = connection.execute(
            "SELECT status::text FROM tasks WHERE project_id = %s AND engagement_control_id = %s "
            "AND plan_kind = 'review'",
            (team["project"], UUID(sheet["control_id"])),
        ).fetchone()
        actions = [
            str(r[0])
            for r in connection.execute(
                "SELECT action FROM audit_events WHERE target_type = 'control_review' "
                "AND target_id = %s ORDER BY created_at",
                (UUID(review["id"]),),
            ).fetchall()
        ]
    assert task == ("SUCCEEDED",)
    assert actions[0] == "review.reperformed" and actions[-1] == "review.signed_off"
    assert {
        "review.note_decided",
        "review.note_raised",
        "review.note_responded",
        "review.note_cleared",
    } <= set(actions)
    reopened = reviewer.post(
        f"{path}/reopen", json={"version": review["version"], "reason": "One more look."}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "OPEN"
    assert _row(client, team, sheet["control_id"])["stage"] == "IN_REVIEW"
    marks = {m["key"]: m for m in client.get(f"{base}/workspace/plan").json()["milestones"]}
    assert marks["REVIEW_COMPLETE"]["status"] != "DONE"
    assert client.get(f"{base}/workspace/dashboard").json()["review"]["complete"] is False


def test_the_console_reads_and_decides_a_review_for_the_person(migrated: Database) -> None:
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console_tools import ToolContext, ToolFailed, execute, parse

    team, client, sheet, _ticket_file = _prepared_control(migrated, "review-console", "LOG")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"

        def context_for(user_id: UUID) -> ToolContext:
            return ToolContext(
                connection=connection,
                settings=Settings(database_url=migrated.url),
                principal=Principal(kind=PrincipalKind.USER, id=user_id),
                organization_id=team["org"],
                project_id=team["project"],
            )

        def call(context: ToolContext, name: str, **arguments: Any) -> dict[str, Any]:
            tool, parsed = parse(name, arguments)
            return execute(tool, parsed, context)

        preparer = context_for(team["owner_id"])
        reviewer = context_for(team["reviewer_id"])
        with pytest.raises(ToolFailed, match="not under review yet"):
            call(preparer, "get_review", control_ref="ITGC-AC-02")
        shown = call(preparer, "get_review", control_ref="ITGC-AC-01")
        assert shown["control"] == "ITGC-AC-01 · SAP ERP"
        assert shown["you_prepared_this_work"] is True and shown["you_are_the_reviewer"] is False
        numbers = [note["number"] for note in shown["notes"] if note["status"] == "PROPOSED"]
        assert numbers
        # The preparer is not the reviewer: the step fails safely and says so.
        with pytest.raises(ToolFailed, match="reviewer role"):
            call(
                preparer,
                "decide_review_note",
                control_ref="ITGC-AC-01",
                note=numbers[0],
                action="DISMISS",
                reason="Noted.",
            )
        with pytest.raises(ToolFailed, match="no note #999"):
            call(
                reviewer,
                "decide_review_note",
                control_ref="ITGC-AC-01",
                note=999,
                action="DISMISS",
                reason="Noted.",
            )
        for number in numbers:
            decided = call(
                reviewer,
                "decide_review_note",
                control_ref="ITGC-AC-01",
                note=number,
                action="DISMISS",
                reason="Whole population tested.",
            )
        assert decided["counts"]["DISMISSED"] == len(numbers)
        raised = call(
            reviewer,
            "raise_review_note",
            control_ref="ITGC-AC-01",
            text="Confirm the approver on T-0 is not the requester.",
            severity="SHOULD_FIX",
            about="RESULT",
            item=sheet["items"][0]["label"],
        )
        mine = next(n for n in raised["notes"] if n["status"] == "OPEN")
        answered = call(
            preparer,
            "respond_review_note",
            control_ref="ITGC-AC-01",
            note=mine["number"],
            response="The approver is the line manager.",
        )
        assert (
            next(n for n in answered["notes"] if n["number"] == mine["number"])["status"]
            == "RESPONDED"
        )
        with pytest.raises(ToolFailed, match="reviewer role"):
            call(preparer, "clear_review_note", control_ref="ITGC-AC-01", note=mine["number"])
        cleared = call(reviewer, "clear_review_note", control_ref="ITGC-AC-01", note=mine["number"])
        assert cleared["blocking"] == []
        with pytest.raises(ToolFailed, match="another reviewer"):
            # The preparer, even as a reviewer, cannot sign off their own work.
            connection.execute(
                "UPDATE project_memberships SET engagement_role = 'REVIEWER' "
                "WHERE project_id = %s AND user_id = %s",
                (team["project"], team["owner_id"]),
            )
            call(preparer, "sign_off_control_review", control_ref="ITGC-AC-01")
        signed = call(
            reviewer,
            "sign_off_control_review",
            control_ref="ITGC-AC-01",
            note="Reviewed on the console.",
        )
        assert signed["status"] == "SIGNED_OFF" and signed["signed_by"]
        with pytest.raises(ToolFailed, match="signed off"):
            call(reviewer, "reperform_review", control_ref="ITGC-AC-01")


# Helpers


def _prepared_control(
    migrated: Database, slug: str, decision: str
) -> tuple[dict[str, Any], Any, dict[str, Any], str]:
    """A tested, signed-off control, its proposed deficiency decided, and its
    effectiveness workpaper prepared."""
    team, client, sheet, ticket_file = _tested_control(migrated, slug)
    current = _sheet(client, team)
    decided = client.post(
        f"{_base(team)}/test-sheets/{current['id']}/deficiency",
        json={"version": current["version"], "action": decision, "reason": "Decided."},
    )
    assert decided.status_code == 200, decided.text
    base = f"{_base(team)}/workpapers"
    paper = client.get(base, params={"control_id": sheet["control_id"]}).json()[0]
    provider = _Provider(
        [{"sections": [{"key": "population", "text": "The population was the user listing."}]}]
    )
    with connect(migrated.url) as connection:
        assert run_draft(connection, provider, UUID(paper["id"])) == "DONE"
    paper = client.get(base, params={"control_id": sheet["control_id"]}).json()[0]
    prepared = client.post(f"{base}/{paper['id']}/prepare", json={"version": paper["version"]})
    assert prepared.status_code == 200, prepared.text
    return team, client, sheet, ticket_file


def _all_pass(attributes: int) -> dict[str, Any]:
    return {
        "results": [
            {"index": index, "result": "PASS", "note": "Seen."} for index in range(attributes)
        ]
    }


def _row(client: Any, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    return next(row for row in _controls(client, team) if row["id"] == control_id)
