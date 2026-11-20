"""Milestone 9.1: independent review of a control instance."""

from typing import Any
from uuid import UUID

import pytest
from support import Database
from test_evidence_analysis import _Provider
from test_outbound import _session, migrated
from test_planning_gate import _plan, _project
from test_testing_engine import _base, _controls, _sheet
from test_workpapers import _tested_control

from ai_workforce_api.control_reviews import (
    disagreements,
    partly_reperformed,
    run_reperformance,
)
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
    # Rewritten 19 November 2026 (item 4): old, a reviewer who found an attribute the
    # tester marked not applicable applies raised an OBSERVATION; new, a SHOULD_FIX.
    # Reason: a not applicable the reviewer disputes can hide an untested attribute, so it
    # is addressed before sign-off, not only noted.
    assert [(f.severity, f.target["indexes"]) for f in found] == [
        ("MUST_FIX", [0]),
        ("SHOULD_FIX", [1]),
        ("SHOULD_FIX", [2]),
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
                        "elements": [],
                    },
                    *_all_pass(attributes)["results"][1:],
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
    # Rewritten 8 November 2026 (B0): the design workpaper is prepared before OE, so the
    # note the agent raised for a missing one ("no design workpaper yet") no longer arises.
    assert ("WORKPAPER", "SHOULD_FIX") not in by_kind
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
    # B3 (8 November 2026): the deficiency logged from testing is rated by a person
    # before the review signs off; before, only the notes held it. Rewritten 9 November 2026
    # (bug hunt): the severity proposed at logging waits for the reviewer, and so does the
    # review; before, it could sign off with that decision open.
    assert review["blocking"] == [
        "1 deficiency not rated yet",
        "1 deficiency change waiting for the reviewer's decision",
        f"{len(notes)} notes not cleared yet",
    ]
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
    # The effectiveness workpaper reopens; the design workpaper (prepared before OE, B0) stays.
    assert [p["status"] for p in papers if p["stage"] == "EFFECTIVENESS"] == ["DRAFT"]
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

    def effectiveness() -> dict[str, Any]:
        # Since B0 the prepared design workpaper is listed beside it.
        return next(
            w
            for w in client.get(
                f"{base}/workpapers", params={"control_id": sheet["control_id"]}
            ).json()
            if w["stage"] == "EFFECTIVENESS"
        )

    paper = effectiveness()
    with connect(migrated.url) as connection:
        assert run_draft(connection, _Provider([{"sections": []}]), UUID(paper["id"])) == "DONE"
    paper = effectiveness()
    prepared = client.post(
        f"{base}/workpapers/{paper['id']}/prepare",
        json={"version": paper["version"], "rationale_reviewed": True},
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
    # B3: the logged deficiency is rated before the review signs off. Rewritten 9 November 2026
    # (bug hunt): before, only the rating was listed and the review signed off with the
    # significant deficiency proposed at logging still waiting; that decision is the
    # reviewer's, and the review now waits for it too.
    assert review["blocking"] == [
        "1 deficiency not rated yet",
        "1 deficiency change waiting for the reviewer's decision",
    ]
    with connect(migrated.url) as connection:
        _rate_all(connection, team)
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert review["blocking"] == ["1 deficiency change waiting for the reviewer's decision"]
    _decide_changes(migrated, reviewer, base, team, "The effect is limited to this control.")
    with connect(migrated.url) as connection:
        _rate_all(connection, team)
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert review["blocking"] == []
    # A severity raised to a material weakness waits for the reviewer, and so does the review
    # (bug hunt, 9 November 2026): before, the rating naming the waiting severity counted as
    # rated and the review could sign off on the old severity with the decision still open.
    with connect(migrated.url) as connection:
        from ai_workforce_api.authorization import Principal, PrincipalKind
        from ai_workforce_api.control_conclusions import RateBody, rate

        found = connection.execute(
            "SELECT id, version FROM deficiencies WHERE project_id = %s "
            "AND engagement_control_id = %s AND status <> 'CLOSED'",
            (team["project"], UUID(sheet["control_id"])),
        ).fetchone()
        assert found is not None
        rate(
            connection, Principal(kind=PrincipalKind.USER, id=team["owner_id"]), team["org"],
            team["project"], UUID(sheet["control_id"]), found[0],
            RateBody(severity="MATERIAL_WEAKNESS", version=found[1],
                     rationale="The access reaches every financial system."),
        )  # fmt: skip
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert review["blocking"] == ["1 deficiency change waiting for the reviewer's decision"]
    held = reviewer.post(f"{path}/sign-off", json={"version": review["version"]})
    assert held.status_code == 409 and "waiting for the reviewer" in held.json()["detail"]
    _decide_changes(migrated, reviewer, base, team, "A control deficiency, as rated.")
    with connect(migrated.url) as connection:
        _rate_all(connection, team)
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert review["blocking"] == []
    # Rewritten 20 November 2026 (S5). Old: with every note cleared the register's step was
    # SIGN and the inbox said "Sign off the review of ITGC-AC-01 · SAP ERP". New: the run
    # was the rules' alone (0 of 3 items re-performed by the agent), so the review signs
    # only over a second run or the reviewer's record of re-performing by hand (FO-1): the
    # step is REPERFORM and the inbox says to re-perform, naming the record. Reason: no
    # screen offers a sign-off the sign-off then refuses (one screen, one story).
    assert review["attestation_needed"] is True
    assert _row(client, team, sheet["control_id"])["review_left"] == "REPERFORM"
    # The dashboard and the inbox say where the review stands (9.2).
    dashboard = client.get(f"{base}/workspace/dashboard").json()["review"]
    assert (dashboard["in_scope"], dashboard["to_sign"], dashboard["signed_off"]) == (31, 1, 0)
    assert dashboard["not_started"] == 30 and dashboard["complete"] is False
    inbox = client.get(f"{base}/console/inbox").json()["waiting"]
    waiting = next(item for item in inbox if item["kind"] == "control_review")
    assert waiting["title"] == "Re-perform the testing for the review of ITGC-AC-01 · SAP ERP"
    reviewer_queue = reviewer.get(f"{base}/queue").json()["items"]
    [queued] = [i for i in reviewer_queue if i["id"] == f"review:{review['id']}"]
    assert queued["reason"] == (
        "The reviewer agent re-performed 0 of 3 items; re-perform again, or sign off with a "
        "record of re-performing them by hand."
    )
    assert not any(i["title"].startswith("Sign off the review") for i in reviewer_queue)
    assert waiting["link"] == "controls"
    # Only this control is in scope now, so its review completes the engagement's.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE project_id = %s AND id <> %s",
            (team["project"], UUID(sheet["control_id"])),
        )

    # Rewritten 19 November 2026 (FP-7, decision D5, product owner). Old: with the interim
    # exceptions found, the conclusion was final with the roll-forward left PENDING by
    # the rules. New: an undecided phase holds the conclusion, so a person decides the
    # roll-forward first (the plan approved again, the impact decided VALID). Reason: the
    # rest of the period is either tested or scoped out by a person, never assumed.
    _rollforward_decided(migrated, team, client, sheet["control_id"])
    review = client.get(f"{base}/reviews").json()[0]

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
    # integrity W1, owner's decision 4). Since B0 it is prepared before OE begins, so it is
    # read here rather than prepared (rewritten 8 November 2026).
    papers = client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()
    assert [w["status"] for w in papers if w["stage"] == "DESIGN"] == ["PREPARED"]
    # Rewritten 19 November 2026 (FO-1 with UH-9). Old: the review signed with the note
    # "Reviewed." over a re-performance no model ran (RULES). New: it signs only over a full
    # re-performance by the agent, or with the reviewer's record that they re-performed the
    # testing by hand and a note of at least 10 characters saying what, kept on the
    # coverage. Reason: a review signed over a re-performance nobody did is no independent
    # re-performance (I13); the sign-off itself is unchanged.
    assert review["attestation_needed"] is True
    due = review["reperformance"]["due"]
    assert (review["reperformance"]["source"], due, review["reperformance"]["done"]) == (
        "RULES",
        3,
        0,
    )
    unattested = reviewer.post(
        f"{path}/sign-off", json={"version": review["version"], "note": "Reviewed."}
    )
    assert unattested.status_code == 409
    assert "re-performed 0 of 3 items" in unattested.json()["detail"]
    short = reviewer.post(
        f"{path}/sign-off",
        json={"version": review["version"], "note": "Reviewed.", "reperformed_by_hand": True},
    )
    assert short.status_code == 409 and "at least 10 characters" in short.json()["detail"]
    attested = "Re-performed T-0 to T-2 by hand against the tickets."
    signed_off = reviewer.post(
        f"{path}/sign-off",
        json={"version": review["version"], "note": attested, "reperformed_by_hand": True},
    )
    assert signed_off.status_code == 200, signed_off.text
    review = signed_off.json()
    assert (review["status"], review["signoff_note"]) == ("SIGNED_OFF", attested)
    covered = review["coverage"]["reperformance"]
    assert (covered["by_hand"], covered["items_due"], covered["items_reperformed"]) == (
        True,
        3,
        0,
    )
    assert covered["attestation"] == attested and covered["by"] == str(team["reviewer_id"])
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
    # Rewritten 19 November 2026 (FO-1). Old: the console signed the review off over a
    # re-performance no model ran (run_reperformance with no provider). New: the model
    # re-performs every item, since a review signs over a partial or rules-only
    # re-performance only with the reviewer's record of one by hand, which the console's
    # sign-off tool does not carry yet (refused, fail closed). Reason: the console path is
    # tested as before over a full re-performance; the hold is tested in
    # test_the_review_signs_only_over_a_full_re_performance_or_one_recorded_by_hand.
    passing = _all_pass(len(sheet["attributes"]))
    with connect(migrated.url) as connection:
        provider = _Provider([passing, passing, passing])
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"

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
        # B3 (8 November 2026): the logged deficiency's severity is rated by a person before
        # the review signs off. Rewritten 9 November 2026 (bug hunt): before, only the rating
        # held the review; the severity proposed when the deficiency was logged waits for the
        # reviewer's decision too, and the review waits for it.
        assert cleared["blocking"] == [
            "1 deficiency not rated yet",
            "1 deficiency change waiting for the reviewer's decision",
        ]
        connection.commit()
        _decide_changes(
            migrated, _session(migrated, team["reviewer_id"]), base, team, "As recorded."
        )
        _rate_all(connection, team)
        assert call(reviewer, "get_review", control_ref="ITGC-AC-01")["blocking"] == []
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


def _decide_changes(
    migrated: Database, reviewer: Any, base: str, team: dict[str, Any], reason: str
) -> None:
    """The reviewer declines each deficiency change waiting on the engagement, so each keeps
    its recorded severity (workspace._decide)."""
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT id, version FROM deficiencies WHERE project_id = %s "
            "AND pending_change IS NOT NULL",
            (team["project"],),
        ).fetchall()
    assert rows
    for deficiency, version in rows:
        decided = reviewer.post(
            f"{base}/deficiencies/{deficiency}/changes/decide",
            json={"version": version, "approve": False, "reason": reason},
        )
        assert decided.status_code == 200, decided.text


def _rate_all(connection: Any, team: dict[str, Any]) -> None:
    """A person rates each of the engagement's open deficiencies at its current severity
    (control_conclusions.rate, B3), as the Control Conclusion step asks before the review."""
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.control_conclusions import RateBody, rate

    rows = connection.execute(
        "SELECT id, engagement_control_id, severity, version FROM deficiencies "
        "WHERE project_id = %s AND status <> 'CLOSED'",
        (team["project"],),
    ).fetchall()
    for deficiency, control, severity, version in rows:
        rate(
            connection,
            Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            team["org"],
            team["project"],
            control,
            deficiency,
            RateBody(
                severity=severity,
                version=version,
                rationale="Rated at its recorded severity for the test.",
            ),
        )


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
    # The effectiveness workpaper: since B0 the prepared design workpaper is listed too.
    paper = next(
        w
        for w in client.get(base, params={"control_id": sheet["control_id"]}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    provider = _Provider(
        [{"sections": [{"key": "population", "text": "The population was the user listing."}]}]
    )
    with connect(migrated.url) as connection:
        assert run_draft(connection, provider, UUID(paper["id"])) == "DONE"
    paper = next(
        w
        for w in client.get(base, params={"control_id": sheet["control_id"]}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    prepared = client.post(
        f"{base}/{paper['id']}/prepare",
        json={"version": paper["version"], "rationale_reviewed": True},
    )
    assert prepared.status_code == 200, prepared.text
    return team, client, sheet, ticket_file


def _rollforward_decided(
    migrated: Database, team: dict[str, Any], client: Any, control_id: str
) -> None:
    """A person decides the roll-forward the rules left PENDING after interim exceptions
    (decision D5, product owner, 19 November 2026: an undecided phase holds the conclusion
    until a person decides it): not applicable, with a reason. The decision revises the
    plan; the owner approves it again, and a reviewer decides the signed interim results'
    impact assessment VALID, as the agent recommends."""
    phase = next(p for p in _plan(team, control_id)["phases"] if p["phase"] == "ROLLFORWARD")
    decided = team["owner"].post(
        f"{_project(team)}/controls/{control_id}/evidence-plan/phases/ROLLFORWARD",
        json={
            "applicability": "NOT_APPLICABLE",
            "rationale": "The interim testing covers the period under audit this year.",
            "version": phase["version"],
        },
    )
    assert decided.status_code == 200, decided.text
    plan = _plan(team, control_id)
    approved = team["owner"].post(
        f"{_project(team)}/controls/{control_id}/evidence-plan/approve",
        json={"version": plan["version"], "comment": ""},
    )
    assert approved.status_code == 200, approved.text
    base = _base(team)
    reviewer = _session(migrated, team["reviewer_id"])
    for assessment in client.get(f"{base}/impact").json():
        if assessment["status"] == "PENDING" and assessment["control_id"] == control_id:
            valid = reviewer.post(
                f"{base}/impact/{assessment['id']}/decide",
                json={
                    "version": assessment["version"],
                    "decision": "VALID",
                    "rationale": "Only the roll-forward decision changed; the interim stands.",
                },
            )
            assert valid.status_code == 200, valid.text


def _all_pass(attributes: int) -> dict[str, Any]:
    """The reviewer passing every attribute, in its answer format (M3d closure): each pass
    shows the element it verified with a passage of the ticket file."""
    shown = {"element": "the approval", "status": "SHOWN", "file": 0, "quote": "Demo Manager"}
    return {
        "results": [
            {"index": index, "result": "PASS", "note": "Seen.", "elements": [shown]}
            for index in range(attributes)
        ]
    }


def _row(client: Any, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    return next(row for row in _controls(client, team) if row["id"] == control_id)


def test_a_rejected_reviewer_answer_is_said_in_plain_words(migrated: Database) -> None:
    """B1i review (13 November 2026): when the reviewer's re-performance is rejected by its
    check, the review's note and failure_note say so in fixed plain words; the check's own
    words are only on the call's outcome."""
    team, client, _sheet_body, _file = _prepared_control(migrated, "review-plain", "LOG")
    review = client.get(f"{_base(team)}/reviews").json()[0]
    provider = _Provider([{"results": [{"index": 99, "result": "PASS", "note": "x"}]}])
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
        reasons = [
            row[0]["reason"]
            for row in connection.execute(
                "SELECT o.outcome FROM model_calls m JOIN model_call_outcomes o "
                "ON o.model_call_id = m.id WHERE m.project_id = %s "
                "AND o.outcome ->> 'validation' = 'REJECTED'",
                (team["project"],),
            ).fetchall()
        ]
    review = client.get(f"{_base(team)}/reviews").json()[0]
    plain = "the answer broke a rule its work is checked against."
    # Rewritten (design review, 20 November 2026): the agent is "the reviewer agent",
    # never "the reviewer" (the person). Old: "The reviewer could not finish ".
    assert review["reperform_note"].startswith("The reviewer agent could not finish ")
    assert "the model" not in review["reperform_note"] + review["failure_note"]
    assert plain in review["reperform_note"] and plain in review["failure_note"]
    assert reasons and all(reason not in review["failure_note"] for reason in reasons)


def test_a_partial_reperformance_names_the_items_that_stand(migrated: Database) -> None:
    """Design review (20 November 2026). Before, a re-performance the reviewer agent did
    for 1 of 3 items said "2 of 3 items could not be re-performed by the model. The
    reviewer could not finish u0002: the answer broke a rule its work is checked against."
    beside "Reviewer · You": "the reviewer" and "the model" for the agent, and a check's
    internal words in a person's line. Now it says what the reviewer agent did and which
    items stand as the preparer left them, and the next actions."""
    team, client, sheet, _file = _prepared_control(migrated, "review-partial", "DISMISS")
    _rollforward_decided(migrated, team, client, sheet["control_id"])
    review = client.get(f"{_base(team)}/reviews").json()[0]
    rejected = {"results": [{"index": 99, "result": "PASS", "note": "x"}]}
    provider = _Provider([_all_pass(len(sheet["attributes"])), rejected, rejected])
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
    review = client.get(f"{_base(team)}/reviews").json()[0]
    record = review["reperformance"]
    assert (record["source"], record["due"], record["done"]) == ("MODEL", 3, 1), record
    labels = [item["label"] for item in sheet["items"]]
    said = review["reperform_note"]
    assert said.startswith("The reviewer agent re-performed 1 of 3 items. "), said
    assert said.endswith(" stand as the preparer left them."), said
    assert sum(label in said for label in labels) == 2, (said, labels)
    assert review["failure_note"] == f"{said} Re-perform to try again, or re-perform them by hand."
    for words in ("the model", "The reviewer could", "broke a rule", "checked against"):
        assert words not in review["failure_note"], words
    assert review["attestation_needed"] is True


def test_partly_reperformed_names_at_most_three_items() -> None:
    assert partly_reperformed(2, ["u0003"]) == (
        "The reviewer agent re-performed 2 of 3 items. u0003 stands as the preparer left it."
    )
    assert partly_reperformed(1, ["a", "b", "c", "d", "e"]).endswith(
        "a, b, c and 2 more stand as the preparer left them."
    )


def test_an_undecided_deficiency_proposal_holds_the_review(migrated: Database) -> None:
    """ST-2 (product owner, 19 November 2026). Before, the review could be signed while
    the deficiency the tester proposed from the exceptions was still undecided, and the
    conclusion then read final Effective. Now the review waits for the proposal to be
    logged or dismissed; the re-performer no longer raises a second note for it."""
    team, client, sheet, _file = _tested_control(migrated, "review-undecided")
    base = _base(team)
    current = _sheet(client, team)
    assert (current["conclusion"], current["proposal_status"]) == ("NOT_EFFECTIVE", "PROPOSED")
    paper = next(
        w
        for w in client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    with connect(migrated.url) as connection:
        assert run_draft(connection, _Provider([{"sections": []}]), UUID(paper["id"])) == "DONE"
    paper = next(
        w
        for w in client.get(f"{base}/workpapers", params={"control_id": sheet["control_id"]}).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    prepared = client.post(
        f"{base}/workpapers/{paper['id']}/prepare",
        json={"version": paper["version"], "rationale_reviewed": True},
    )
    assert prepared.status_code == 200, prepared.text
    review = client.get(f"{base}/reviews").json()[0]
    # Reworded 19 November 2026 (E3 design review): old "the proposed deficiency is not
    # logged or dismissed yet: decide it on the test sheet before the testing is
    # re-performed"; new, the same hold without a second colon inside "Before sign-off:".
    held = "the proposed deficiency is not yet logged or dismissed on the test sheet"
    assert held in review["blocking"]
    reviewer = _session(migrated, team["reviewer_id"])
    refused = reviewer.post(f"{base}/reviews/{review['id']}/sign-off", json={"version": 1})
    assert refused.status_code == 409
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    assert not any("is not decided" in note["text"] for note in review["notes"])
    refused = reviewer.post(
        f"{base}/reviews/{review['id']}/sign-off", json={"version": review["version"]}
    )
    assert refused.status_code == 409 and held in refused.json()["detail"]
    current = _sheet(client, team)
    dismissed = client.post(
        f"{base}/test-sheets/{current['id']}/deficiency",
        json={"version": current["version"], "action": "DISMISS", "reason": "Decided."},
    )
    assert dismissed.status_code == 200, dismissed.text
    review = client.get(f"{base}/reviews").json()[0]
    assert held not in review["blocking"]


def test_the_review_waits_while_the_plan_is_revised_and_not_approved(migrated: Database) -> None:
    """ST-4 (product owner, 19 November 2026). Before, the reviewer could sign the review
    while the test plan was revised and not approved again, and while the signed-off
    results predated its approved revision with no impact decided. Now the review waits
    for the approval, then for a reviewer's impact decision."""
    team, client, sheet, _file = _prepared_control(migrated, "review-plan-gate", "DISMISS")
    base = _base(team)
    control = sheet["control_id"]
    review = client.get(f"{base}/reviews").json()[0]
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, UUID(review["id"])) == "DONE"
        # A material change to the approved plan, as the revision triggers make it.
        connection.execute(
            "SELECT revise_evidence_plan(id) FROM evidence_plans WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert "approve the test plan first" in review["blocking"]
    reviewer = _session(migrated, team["reviewer_id"])
    refused = reviewer.post(
        f"{base}/reviews/{review['id']}/sign-off", json={"version": review["version"]}
    )
    assert refused.status_code == 409 and "approve the test plan first" in refused.json()["detail"]
    plan = _plan(team, control)
    approved = team["owner"].post(
        f"{_project(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"], "comment": ""},
    )
    assert approved.status_code == 200, approved.text
    review = client.get(f"{base}/reviews").json()[0]
    # Reworded 19 November 2026 (E3 design review): old "1 signed-off result predates the
    # plan's approved revision: a reviewer decides the impact assessment first"; new, the
    # same hold said once, without a second colon.
    impact = "1 signed-off result awaits a reviewer's impact decision"
    assert "approve the test plan first" not in review["blocking"]
    assert impact in review["blocking"]
    refused = reviewer.post(
        f"{base}/reviews/{review['id']}/sign-off", json={"version": review["version"]}
    )
    assert refused.status_code == 409 and impact in refused.json()["detail"]
    [assessment] = [a for a in client.get(f"{base}/impact").json() if a["status"] == "PENDING"]
    valid = reviewer.post(
        f"{base}/impact/{assessment['id']}/decide",
        json={
            "version": assessment["version"],
            "decision": "VALID",
            "rationale": "The revision changed nothing the interim results rest on.",
        },
    )
    assert valid.status_code == 200, valid.text
    review = client.get(f"{base}/reviews").json()[0]
    assert impact not in review["blocking"]


def _disagreeing(attributes: int) -> dict[str, Any]:
    """The reviewer finding an exception on attribute A of the first item, every other
    attribute met: one re-performance note, MUST_FIX."""
    return {
        "results": [
            {
                "index": 0,
                "result": "EXCEPTION",
                "note": "The approver is the requester.",
                "citations": [{"file": 0, "quote": "Demo Manager"}],
                "elements": [],
            },
            *_all_pass(attributes)["results"][1:],
        ]
    }


def _proposed(review: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {note["id"]: note for note in review["notes"] if note["status"] == "PROPOSED"}


def test_a_run_that_re_performs_nothing_keeps_the_proposed_notes(migrated: Database) -> None:
    """FO-2 (audit invariants I13, 19 November 2026). Before, every run withdrew every
    proposed agent note, so a must-fix no person had decided disappeared on a run whose
    model calls all failed (FALLBACK) or that no model ran (RULES). Now a run withdraws only
    the notes it raises again: the rules' notes when the rules ran, and a re-performance
    note only when the model re-performed its item in this run."""
    team, client, sheet, _file = _prepared_control(migrated, "review-keep-notes", "LOG")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    path = f"{base}/reviews/{review['id']}"
    attributes = len(sheet["attributes"])
    passing = _all_pass(attributes)
    with connect(migrated.url) as connection:
        provider = _Provider([_disagreeing(attributes), passing, passing])
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    first = _proposed(review)
    reperformed = {key for key, note in first.items() if "reviewer_result" in note["target"]}
    rules = set(first) - reperformed
    assert reperformed and rules
    assert {first[key]["target"]["source"] for key in reperformed} == {"REPERFORMANCE"}
    assert {first[key]["target"]["source"] for key in rules} == {"RULES"}

    # Every model call fails, then no model runs: the rules ran again, the model
    # re-performed nothing.
    for provider_or_none in (_Provider([None]), None):
        asked = client.post(f"{path}/reperform", json={"version": review["version"]})
        assert asked.status_code == 200, asked.text
        with connect(migrated.url) as connection:
            assert run_reperformance(connection, provider_or_none, UUID(review["id"])) == "DONE"
        review = client.get(f"{base}/reviews").json()[0]
        assert review["reperform_source"] == ("FALLBACK" if provider_or_none else "RULES")
        again = _proposed(review)
        assert reperformed <= set(again), "the undecided must-fix is kept"
        assert not rules & set(again), "the rules' notes are raised again"
        assert len(set(again) - reperformed) == len(rules)

    # A run the model completes re-performs the item: its note is raised again.
    asked = client.post(f"{path}/reperform", json={"version": review["version"]})
    assert asked.status_code == 200, asked.text
    with connect(migrated.url) as connection:
        provider = _Provider([_disagreeing(attributes), passing, passing])
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
    review = client.get(f"{base}/reviews").json()[0]
    last = _proposed(review)
    assert not reperformed & set(last)
    assert sorted(n["severity"] for n in last.values() if "reviewer_result" in n["target"]) == (
        sorted(first[key]["severity"] for key in reperformed)
    )


def _claimed(connection: Any, review_id: UUID, ago: str = "0 seconds") -> Any:
    """The review claimed for a run, as run_reperformance claims it: its start returned."""
    row = connection.execute(
        "UPDATE control_reviews SET reperform_status = 'WORKING', "
        "reperform_started_at = clock_timestamp() - %s::interval WHERE id = %s "
        "RETURNING reperform_started_at",
        (ago, review_id),
    ).fetchone()
    connection.commit()
    assert row is not None
    return row[0]


def test_a_run_that_lost_its_claim_changes_nothing(migrated: Database) -> None:
    """FO-2 (19 November 2026). Before, _finish withdrew and wrote the notes before it
    checked the claim, and checked only that the review was WORKING: a run whose lease
    another run had taken, or one cancelled, still rewrote the notes. Now the claim is taken
    first, against the run's own start, and a stale run records nothing."""
    from ai_workforce_api.control_reviews import Finding, RunRecord, _finish

    team, client, _sheet_body, _file = _prepared_control(migrated, "review-stale", "LOG")
    review_id = UUID(client.get(f"{_base(team)}/reviews").json()[0]["id"])
    stale = Finding("GENERAL", {}, "MUST_FIX", "A stale run's note.")
    with connect(migrated.url) as connection:
        assert run_reperformance(connection, None, review_id) == "DONE"
        before = connection.execute(
            "SELECT id, status FROM review_notes WHERE control_review_id = %s ORDER BY id",
            (review_id,),
        ).fetchall()
        first = _claimed(connection, review_id, "1 hour")
        # A second run reclaims the review after the first one's lease ran out.
        second = _claimed(connection, review_id)
        recorded = _finish(
            connection, review_id, 1, "MODEL", "", None, [stale],
            started_at=first, run=RunRecord(rules_ran=True, due=()),
        )  # fmt: skip
        assert recorded is False
        after = connection.execute(
            "SELECT id, status FROM review_notes WHERE control_review_id = %s ORDER BY id",
            (review_id,),
        ).fetchall()
        assert after == before
        status = connection.execute(
            "SELECT reperform_status FROM control_reviews WHERE id = %s", (review_id,)
        ).fetchone()
        assert status == ("WORKING",)
        assert _finish(
            connection, review_id, 1, "MODEL", "", None, [stale],
            started_at=second, run=RunRecord(rules_ran=True, due=()),
        )  # fmt: skip


def test_notes_over_the_cap_keep_the_most_severe_and_count_the_rest(migrated: Database) -> None:
    """FO-2 (19 November 2026). Before, findings[:MAX_NOTES] kept the first 200 raised, the
    rules' first, so must-fix disagreements past them were dropped without a trace. Now the
    most severe are kept, and the run records how many it dropped."""
    from ai_workforce_api.control_reviews import MAX_NOTES, Finding, RunRecord, _finish

    team, client, _sheet_body, _file = _prepared_control(migrated, "review-cap", "LOG")
    review_id = UUID(client.get(f"{_base(team)}/reviews").json()[0]["id"])
    findings = [
        Finding("GENERAL", {}, "OBSERVATION", f"Observation {n}.") for n in range(MAX_NOTES)
    ] + [Finding("GENERAL", {}, "MUST_FIX", "The must-fix raised last.")]
    version = _sheet(client, team)["version"]
    with connect(migrated.url) as connection:
        started = _claimed(connection, review_id)
        assert _finish(
            connection, review_id, version, "RULES", "", None, findings,
            started_at=started, run=RunRecord(rules_ran=True, due=()),
        )  # fmt: skip
        severities = [
            row[0]
            for row in connection.execute(
                "SELECT severity FROM review_notes WHERE control_review_id = %s "
                "AND status = 'PROPOSED'",
                (review_id,),
            ).fetchall()
        ]
        payload = connection.execute(
            "SELECT payload FROM audit_events WHERE target_id = %s "
            "AND action = 'review.reperformed' ORDER BY created_at DESC LIMIT 1",
            (review_id,),
        ).fetchone()
    assert len(severities) == MAX_NOTES and "MUST_FIX" in severities
    assert payload is not None and payload[0]["dropped"] == 1
    # Any drop holds the sign-off: the review cannot show every note it raised.
    review = client.get(f"{_base(team)}/reviews").json()[0]
    assert "1 reviewer agent note over the limit of 200 was not recorded" in review["blocking"]


def test_the_review_signs_only_over_a_full_re_performance_or_one_recorded_by_hand(
    migrated: Database,
) -> None:
    """FO-1 with UH-9 (audit invariant I13, 19 November 2026). Before, the review signed
    over a re-performance whose model calls all failed (FALLBACK), that no model ran
    (RULES), that the model did in part, or that read no signed sheet (a missing reviewed
    version skipped the version check). Now the run's typed record says how many items were
    due and re-performed, and the review needs the reviewer's record of a re-performance by
    hand unless the agent re-performed them all; a design not effective, where nothing was
    tested, and a sheet with nothing to re-perform need none."""
    from ai_workforce_api.control_reviews import ReperformanceBody, needs_attestation

    full = ReperformanceBody(known=True, source="MODEL", due=3, done=3)
    assert needs_attestation(True, full) is False
    assert needs_attestation(True, ReperformanceBody(source="SEEDED")) is False
    assert needs_attestation(False, ReperformanceBody()) is False  # D&I not effective
    assert needs_attestation(True, ReperformanceBody(known=True, source="RULES")) is False
    for partial in (
        ReperformanceBody(known=True, source="MODEL", due=3, done=2),
        ReperformanceBody(known=True, source="MODEL", due=40, done=30, capped=True),
        ReperformanceBody(known=True, source="FALLBACK", due=3),
        ReperformanceBody(known=True, source="RULES", due=3),
        ReperformanceBody(source="MODEL"),  # re-performed before the record was kept
    ):
        assert needs_attestation(True, partial) is True, partial

    team, client, sheet, _file = _prepared_control(migrated, "review-attest", "LOG")
    base = _base(team)
    review = client.get(f"{base}/reviews").json()[0]
    path = f"{base}/reviews/{review['id']}"
    attributes = len(sheet["attributes"])
    passing = _all_pass(attributes)
    rejected = {"results": [{"index": 99, "result": "PASS", "note": "x"}]}
    runs: list[tuple[list[dict[str, Any] | None], str, int, bool]] = [
        ([None], "FALLBACK", 0, True),
        ([passing, rejected, rejected], "MODEL", 1, True),
        ([passing, passing, passing], "MODEL", 3, False),
    ]
    for outputs, source, done, attest in runs:
        if review["reperform_state"] != "QUEUED":
            asked = client.post(f"{path}/reperform", json={"version": review["version"]})
            assert asked.status_code == 200, asked.text
        with connect(migrated.url) as connection:
            assert run_reperformance(connection, _Provider(outputs), UUID(review["id"])) == "DONE"
        review = client.get(f"{base}/reviews").json()[0]
        record = review["reperformance"]
        assert (record["known"], record["source"], record["due"], record["done"]) == (
            True,
            source,
            3,
            done,
        )
        assert review["attestation_needed"] is attest
        assert (review["failure_note"] != "") is attest
    # A run that read no signed sheet re-performed nothing: the version is not skipped.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_reviews SET sheet_version_reviewed = NULL WHERE id = %s",
            (UUID(review["id"]),),
        )
        connection.commit()
    review = client.get(f"{base}/reviews").json()[0]
    assert "the testing has not been re-performed" in review["blocking"]


def test_the_disagreement_table_covers_every_reachable_pair() -> None:
    """Item 4 and UH-4 (audit invariant I13, 19 November 2026). Before, a reviewer who
    could not conclude (UNABLE or REVIEW) on a tester's not applicable or exception raised
    nothing, and the reason of a note was the pair's alone, so an attribute the reviewer
    left out read as a finding on the evidence. Now every pair where the tester's final is
    decided (a pass, an exception, not applicable: what a signed sheet holds) and the
    reviewer's differs raises a note, and its reason follows the typed rule."""
    item = UUID("01a12dd4-0000-7000-8000-000000000002")
    decided = ("PASS", "EXCEPTION", "NOT_APPLICABLE")
    results = ("PASS", "EXCEPTION", "UNABLE", "REVIEW", "NOT_APPLICABLE")
    for final in decided:
        for reviewer in results:
            if reviewer == final:
                continue
            found = disagreements(
                item, "T-1", [final], [{"index": 0, "result": reviewer, "note": "x"}]
            )
            assert len(found) == 1, (final, reviewer)
    left_out = disagreements(
        item, "T-1", ["PASS"], [{"index": 0, "result": "UNABLE", "rule": "OMITTED"}]
    )
    assert "the reviewer gave no result for it" in left_out[0].text
    unshown = disagreements(
        item, "T-1", ["PASS"], [{"index": 0, "result": "UNABLE", "rule": "ELEMENT_GAP"}]
    )
    assert "could not show each element" in unshown[0].text
    plain = disagreements(item, "T-1", ["PASS"], [{"index": 0, "result": "UNABLE"}])
    assert "found the evidence insufficient" in plain[0].text


def test_the_review_waits_on_urgent_workpaper_notes(migrated: Database) -> None:
    """Item 19, OE part (19 November 2026). Before, an urgent review note open on the
    prepared effectiveness workpaper held that workpaper's own sign-off but not the
    control's review, which signed off over it. Now the review waits for it too."""
    team, client, _sheet_body, _file = _prepared_control(migrated, "review-urgent", "LOG")
    base = _base(team)
    paper = next(
        w
        for w in client.get(
            f"{base}/workpapers", params={"control_id": _sheet_body["control_id"]}
        ).json()
        if w["stage"] == "EFFECTIVENESS"
    )
    held = "effectiveness workpaper: clear or dismiss the urgent review notes first (1)"
    assert held not in client.get(f"{base}/reviews").json()[0]["blocking"]
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO workpaper_review_notes (
                organization_id, project_id, workpaper_id, number, anchor_kind,
                workpaper_version, text, criticality, owner_id, raised_by
            )
            VALUES (%s, %s, %s, 1, 'WORKPAPER', 1, 'Explain the population source.', 'URGENT',
                    %s, %s)
            """,
            (team["org"], team["project"], UUID(paper["id"]), team["owner_id"],
             team["reviewer_id"]),
        )  # fmt: skip
        connection.commit()
    assert held in client.get(f"{base}/reviews").json()[0]["blocking"]


def _facts(prompt: str) -> dict[str, Any]:
    """The control-and-item facts a tester's or re-performer's prompt carries."""
    import json

    start = prompt.index("<control_and_item>") + len("<control_and_item>")
    end = prompt.index("</control_and_item>")
    found: dict[str, Any] = json.loads(prompt[start:end])
    return found


def test_the_re_performer_reads_the_testers_criteria_and_basis(migrated: Database) -> None:
    """Item 8 (audit invariant I11, 19 November 2026). Before, the re-performer was given
    neither the attributes' library definitions nor a person's owned criteria, the design or
    the walkthrough, and was told to re-perform by a replace on the tester's first sentence
    (which a rewording would silently undo). Now it reads the basis the tester's own builder
    gives (testing_basis), the period as the tester reads it, a typed re-perform instruction,
    and its call records the basis re-performed as the tester's call does."""
    from ai_workforce_api.pbc_drafting import load_context
    from ai_workforce_api.testing_engine import testing_basis

    team, client, sheet, _file = _prepared_control(migrated, "review-basis", "LOG")
    review = client.get(f"{_base(team)}/reviews").json()[0]
    control = UUID(sheet["control_id"])
    attributes = tuple(sheet["attributes"])
    provider = _Provider([_all_pass(len(attributes))])
    with connect(migrated.url) as connection:
        basis = testing_basis(connection, control, attributes)
        period = load_context(connection, UUID(str(team["project"])), control).period
        assert run_reperformance(connection, provider, UUID(review["id"])) == "DONE"
        inputs = connection.execute(
            "SELECT inputs FROM model_calls WHERE target_id = %s ORDER BY created_at LIMIT 1",
            (UUID(review["id"]),),
        ).fetchone()
    assert any(basis.definitions) or basis.design or basis.walkthrough, "a basis to read"
    prompt = provider.requests[0].prompt
    assert prompt.startswith("Re-perform the test of this item against each attribute.")
    facts = _facts(prompt)
    assert facts["audit_period"] == period
    assert facts["control"].get("design") == (basis.design or None)
    for index, entry in enumerate(facts["attributes"]):
        assert entry.get("definition") == (basis.definitions[index] or None), index
        assert entry.get("tailored_criteria") == (basis.tailored[index] or None), index
    assert "mapped_passages" not in prompt
    assert inputs is not None
    assert {"criteria_sha256", "attribute_basis"} <= set(inputs[0])
    assert len(inputs[0]["attribute_basis"]) == len(attributes)


def test_the_weakest_supported_items_are_re_performed_first() -> None:
    """Critic 8 (19 November 2026). Before, a capped re-performance took the first
    MAX_REVIEWED_ITEMS items in sheet order. Now the items whose results rest most thinly
    on the evidence (a person's override, a final not applicable, a pass on one citation or
    a box alone, a rule check that failed) come first; ties keep the sheet's order; an item
    not tested or without files is not due."""
    from ai_workforce_api.control_reviews import reperform_order
    from ai_workforce_api.test_sheets import CellBody, ItemBody, ItemFileBody

    two = [{"file": 0, "quote": "Approved by Demo Manager"}, {"file": 0, "quote": "Ticket 7"}]

    def make(n: int, state: str = "TESTED", files: bool = True, **fields: Any) -> ItemBody:
        cell = CellBody(index=0, proposed="PASS", note="", final="PASS", override_reason="",
                        overridden_by=None, citations=two)  # fmt: skip
        return ItemBody(
            id=UUID(int=n), position=n, label=f"S-{n}", detail=[],
            files=[ItemFileBody(id=UUID(int=100 + n), file_name="t.txt")] if files else [],
            state=state, source="MODEL", note="", version=1,  # type: ignore[arg-type]
            cells=[cell.model_copy(update=fields)],
        )  # fmt: skip

    strong = make(1)
    overridden = make(2, overridden_by="a person", final="EXCEPTION", proposed="PASS")
    one_cite = make(3, citations=two[:1])
    box_only = make(4, citations=[two[0], {"file": 0, "quote": "", "box": [0, 0, 1, 1]}])
    not_tested = make(5, state="WAITING")
    no_files = make(6, files=False)
    strong_two = make(7)
    na = make(8, final="NOT_APPLICABLE", proposed="NOT_APPLICABLE")
    ordered = reperform_order(
        [strong, overridden, one_cite, box_only, not_tested, no_files, strong_two, na]
    )
    assert [found.position for found in ordered] == [2, 3, 4, 8, 1, 7]
