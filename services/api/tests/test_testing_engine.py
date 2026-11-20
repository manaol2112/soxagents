"""The testing engine: evidence placed on samples, tested, signed off, and concluded."""

import re
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database, approve_plans_over_api
from test_evidence_analysis import _no_ocr, _Provider
from test_evidence_intake import _accept_population, _engagement, _request, _settings
from test_outbound import migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.testing_engine import (
    ItemContext,
    ItemFile,
    ItemView,
    check_results,
    conclusion,
    excerpt,
    final_results,
    from_reviews,
    place,
    prompt_for,
    propose_deficiency,
    run_sheet,
)

_ = migrated


def test_a_file_is_placed_on_the_samples_it_names() -> None:
    keys = ["u0001", "u0002", "CHG-77", "7"]
    assert place(keys, "PBC/u0001 approval.pdf", "", True) == (
        "PLACED",
        [0],
        "Names sample u0001.",
    )
    placed, found, _reason = place(keys, "x.csv", "user U0002 and chg-77 approved", True)
    assert (placed, found) == ("PLACED", [1, 2])
    # A very short key is too easy to find by chance, and part of a word is not a match.
    assert place(keys, "x.csv", "row 7 of u00011", True)[0] == "UNPLACED"
    assert place(keys, "x.csv", "nothing here", False)[0] == "EXCLUDED"
    assert place(["The control, tested once"], "any.png", "", False)[:2] == ("PLACED", [0])
    text = "header\n" + "filler " * 800 + "u0002 approved by Lee on 2027-03-01\n" + "tail " * 800
    assert "u0002 approved by Lee" in excerpt(text, "u0002")
    assert excerpt(text, "u0002").startswith("header")


def test_the_conclusion_is_derived_with_zero_tolerance() -> None:
    passed = final_results(2, [{"index": 0, "result": "PASS"}, {"index": 1, "result": "PASS"}], [])
    assert passed == ("PASS", "PASS")
    overridden = final_results(
        2,
        [{"index": 0, "result": "UNABLE"}, {"index": 1, "result": "PASS"}],
        [{"index": 0, "result": "PASS", "reason": "Seen in the ticket", "by": "x", "at": "t"}],
    )
    assert overridden == ("PASS", "PASS")
    done = ItemView(has_evidence=True, tested=True, final=("PASS", "PASS"))
    assert conclusion([done, done]) == "EFFECTIVE"
    failed = ItemView(has_evidence=True, tested=True, final=("EXCEPTION", "PASS"))
    assert conclusion([done, failed]) == "NOT_EFFECTIVE"
    unsure = ItemView(has_evidence=True, tested=True, final=("UNABLE", "PASS"))
    assert conclusion([done, unsure]) == "INCOMPLETE"
    assert conclusion([failed, unsure]) == "INCOMPLETE"
    missing = ItemView(has_evidence=False, tested=False, final=(None, None))
    assert conclusion([done, missing]) == "INCOMPLETE"
    na = ItemView(has_evidence=True, tested=True, final=("NOT_APPLICABLE", "PASS"))
    assert conclusion([na]) == "EFFECTIVE"
    assert conclusion([]) == "INCOMPLETE"


def test_the_testers_answer_is_checked() -> None:
    results = check_results(
        {
            "results": [
                {"index": 0, "result": "PASS", "note": "Approved by Lee on 2027-03-01."},
                {"index": 0, "result": "EXCEPTION", "note": "repeat is ignored"},
                {"index": 7, "result": "PASS", "note": "no such attribute"},
                {"index": 2, "result": "MAYBE", "note": "not a result"},
                {"index": 1, "result": "EXCEPTION", "note": "See https://evil.example"},
            ]
        },
        3,
    )
    assert [item["result"] for item in results] == ["PASS", "EXCEPTION", "UNABLE"]
    assert "evil" not in results[1]["note"]
    assert results[2]["note"] == "The tester gave no result for this attribute."
    with pytest.raises(ValueError):
        check_results({"results": [{"index": 9, "result": "PASS", "note": ""}]}, 3)
    with pytest.raises(ValueError):
        check_results({"summary": "no results"}, 3)


def test_a_control_tested_once_reuses_its_screenshot_reviews() -> None:
    review = {
        "attributes": [
            {
                "index": 0,
                "attribute": "Minimum length is 12",
                "result": "PASS",
                "observed": "Minimum length 12",
            },
            {
                "index": 1,
                "attribute": "Lockout after 5 attempts",
                "result": "NOT_DETERMINABLE",
                "observed": "Lockout not shown",
            },
        ]
    }
    # Rewritten 19 November 2026 (ST-1, product owner). Old: the review's answers were
    # reused by their position, from a count of attributes. New: each is matched by the
    # wording it was reviewed against (evidence_review records it, AttributeTest.attribute).
    # Reason: after a removal, a new order or a rewording, a position names another
    # attribute, and a pass would be given to a test never made.
    # Rewritten 19 November 2026 (item 17 with D9 and FO-22). Old: the agent's review stood
    # in undecided, and its not determinable answer was UNABLE. New: it stands in only once
    # a person decided it (undecided: None, so the item is unable), and an answer that is
    # not a clean pass goes to a person (REVIEW). Reason: an agent's undecided review is a
    # proposal, and a review cites no passage a person can check (audit invariant I5).
    attributes = ("Minimum length is 12", "Lockout after 5 attempts")
    undecided = (ItemFile("settings.png", "configuration", "", review),)
    assert from_reviews(undecided, attributes) is None
    checks = [{"check": key, "result": "OK"} for key in ("legibility", "system", "date_period",
                                                          "editing", "applicability")]  # fmt: skip
    decided = {**review, "checks": checks, "decision": "OVERRIDDEN", "conclusion": "NO_EXCEPTION"}
    files = (ItemFile("settings.png", "configuration", "", decided),)
    results = from_reviews(files, attributes)
    assert results is not None
    assert [item["result"] for item in results] == ["PASS", "REVIEW"]
    assert results[0]["note"] == "settings.png: Minimum length 12"
    # Without a review for every file, or for every attribute, the tester tests it.
    no_review = (*files, ItemFile("policy.pdf", "policy", "text", None))
    assert from_reviews(no_review, attributes) is None
    assert from_reviews(files, (*attributes, "Passwords expire")) is None


def test_the_prompt_gives_the_attributes_the_item_and_its_evidence() -> None:
    context = ItemContext(
        control_ref="ITGC-AC-01",
        title="New user access is approved",
        activity="Access is approved before it is granted.",
        frequency="event-driven",
        nature="manual",
        period="the audit period ending 31 December 2027",
        attributes=("Approved before access", "Approver is independent"),
        item_label="u0002",
        item_detail=(("User ID", "u0002"), ("Date granted", "2027-03-02")),
        test_of_one=False,
        files=(ItemFile("tickets.csv", "sample", "u0002 approved 2027-03-01 by Lee", None),),
    )
    prompt = prompt_for(context)
    assert '"index": 1' in prompt and "Approver is independent" in prompt
    assert '"Date granted": "2027-03-02"' in prompt
    assert '<file index=0 name="tickets.csv">' in prompt and "u0002 approved" in prompt


def test_exceptions_draft_a_deficiency_with_a_suggested_severity() -> None:
    attributes = ("Approved before access", "Approver is independent")
    draft = propose_deficiency(
        "ITGC-AC-01",
        "New user access is approved",
        "Access is approved before it is granted.",
        "Unauthorised access to financial data.",
        True,
        attributes,
        [("u0002", 0, "Approved a day after access.")],
        3,
    )
    assert draft["severity"] == "SIGNIFICANT_DEFICIENCY"
    assert "1 of 3 items" in draft["condition"]
    assert "u0002, Approved before access: Approved a day after access." in draft["condition"]
    assert "- Approved before access" in draft["criteria"]
    assert draft["effect"] == "Unauthorised access to financial data."
    minor = propose_deficiency("C-1", "t", "a", "", False, attributes, [("x", 1, "n")], 25)
    assert minor["severity"] == "CONTROL_DEFICIENCY"
    assert minor["effect"].startswith("C-1 may not prevent")


def test_samples_are_tested_signed_off_and_an_exception_becomes_a_deficiency(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "engine")
    base = _base(team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    # An ITGC with approved attributes and its population read is ready: no narrative.
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sheet = _sheet(client, team)
    assert (sheet["method"], sheet["status"], sheet["proposed_conclusion"]) == (
        "SAMPLE",
        "OPEN",
        "INCOMPLETE",
    )
    labels = [item["label"] for item in sheet["items"]]
    assert sorted(labels) == ["u0001", "u0002", "u0003"]
    assert all(item["state"] == "NO_EVIDENCE" for item in sheet["items"])
    attributes = len(sheet["attributes"])
    samples = approved.json()["sample_request_id"]
    # Evidence arrives on the sample request: one file for two samples, one by its name.
    _add(client, team, "approvals.csv", f"ticket,user\nA-1,{labels[0]}\nA-2,{labels[1]}\n", samples)
    _add(client, team, f"{labels[2]} ticket.txt", "Approved by Demo Manager.", samples)
    _add(client, team, "cover note.txt", "Please find the evidence attached.", samples)
    _read_all(migrated, scheduler)
    answers: list[dict[str, Any] | None] = [
        _answer(["PASS"] * attributes),
        _answer(["EXCEPTION"] + ["PASS"] * (attributes - 1)),
        _answer(["PASS", "UNABLE"] + ["PASS"] * (attributes - 2)),
    ]
    provider = _Citing(answers)
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    assert len(provider.requests) == 3
    assert "Test this item" in provider.requests[0].prompt
    sheet = _sheet(client, team)
    placements = {entry["file_name"]: entry["placement"] for entry in sheet["placements"]}
    assert placements == {
        "access population.csv": "EXCLUDED",
        "approvals.csv": "PLACED",
        f"{labels[2]} ticket.txt": "PLACED",
        "cover note.txt": "UNPLACED",
    }
    assert [len(item["files"]) for item in sheet["items"]] == [1, 1, 1]
    assert all(item["state"] == "TESTED" for item in sheet["items"])
    assert sheet["counts"]["exceptions"] == 1
    assert sheet["counts"]["unplaced"] == 1
    assert sheet["proposed_conclusion"] == "INCOMPLETE"
    assert "1 result has insufficient evidence and needs a person to decide" in sheet["blocking"]
    path = f"{base}/test-sheets/{sheet['id']}"
    blocked = client.post(f"{path}/sign-off", json={"version": sheet["version"]})
    assert blocked.status_code == 409
    assert "needs a person" in blocked.json()["detail"]
    # A person decides the result the tester could not.
    third = sheet["items"][2]
    decided = client.post(
        f"{path}/items/{third['id']}/override",
        json={
            "version": third["version"],
            "index": 1,
            "result": "PASS",
            "reason": "The approver is the manager named in the ticket.",
        },
    )
    assert decided.status_code == 200, decided.text
    sheet = decided.json()
    cell = sheet["items"][2]["cells"][1]
    assert (cell["proposed"], cell["final"]) == ("UNABLE", "PASS")
    assert cell["overridden_by"]
    assert sheet["proposed_conclusion"] == "NOT_EFFECTIVE"
    # The cover note is set aside; nobody's results change.
    note = next(e for e in sheet["placements"] if e["file_name"] == "cover note.txt")
    aside = client.post(
        f"{path}/links",
        json={"file_id": note["file_id"], "action": "EXCLUDE", "reason": "A cover note."},
    )
    assert aside.status_code == 200
    assert aside.json()["proposed_conclusion"] == "NOT_EFFECTIVE"
    signed = client.post(
        f"{path}/sign-off", json={"version": aside.json()["version"], "note": "Tested 3 of 3."}
    )
    assert signed.status_code == 200, signed.text
    sheet = signed.json()
    assert (sheet["status"], sheet["conclusion"]) == ("SIGNED_OFF", "NOT_EFFECTIVE")
    assert sheet["proposal_status"] == "PROPOSED"
    assert labels[1] in sheet["proposal"]["condition"]
    assert sheet["proposal"]["severity"] == "SIGNIFICANT_DEFICIENCY"
    # Signed off: results are final until someone reopens the sheet.
    late = client.post(
        f"{path}/items/{third['id']}/override",
        json={"version": 99, "index": 0, "result": "PASS", "reason": "too late"},
    )
    assert late.status_code == 409
    no_reason = client.post(
        f"{path}/deficiency", json={"version": sheet["version"], "action": "DISMISS"}
    )
    assert no_reason.status_code == 409
    logged = client.post(
        f"{path}/deficiency",
        json={"version": sheet["version"], "action": "LOG", "cause": "Approver was on leave."},
    )
    assert logged.status_code == 200, logged.text
    sheet = logged.json()
    assert sheet["proposal_status"] == "LOGGED"
    assert sheet["deficiency_reference"] == "D-001"
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT source, cause, severity, pending_change ->> 'severity' FROM deficiencies "
            "WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
        audit = str(
            connection.execute(
                "SELECT array_agg(action) FROM audit_events WHERE target_type = 'test_sheet'"
            ).fetchone()
        )
    # A severe finding starts as a control deficiency until the reviewer agrees (7.2).
    assert found == ("TESTING", "Approver was on leave.", "CONTROL_DEFICIENCY",
                     "SIGNIFICANT_DEFICIENCY")  # fmt: skip
    for action in (
        "testing.sheet_opened",
        "testing.items_tested",
        "testing.result_overridden",
        "testing.signed_off",
        "testing.deficiency_logged",
    ):
        assert action in audit
    reopened = client.post(f"{path}/reopen", json={"version": sheet["version"], "reason": "x y z"})
    assert reopened.status_code == 409
    # The control's register row shows the signed-off test.
    row = next(c for c in _controls(client, team) if c["control_ref"] == "ITGC-AC-01")
    assert row["test_result"] == "NOT_EFFECTIVE"
    assert row["stages"]["test"] == "SUCCEEDED"
    assert row["next_step"] == "Prepare the workpapers for review"


def test_an_automated_control_is_tested_once_from_its_evidence(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "once")
    # The library labels this setting "annual": a person confirms the design first (8.8).
    _confirm_design(client, team, "ITGC-AC-05")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "password settings.csv", "Setting,Value\nMinimum length,12\n", request["id"])
    _read_all(migrated, scheduler)
    sheet = _sheet(client, team)
    assert sheet["method"] == "TEST_OF_ONE"
    # The one item stands for the control's one application.
    assert [item["label"] for item in sheet["items"]] == ["SAP ERP"]
    # Without a model, every result waits for a person.
    with connect(migrated.url) as connection:
        run_sheet(connection, None, UUID(sheet["id"]))
    unsure = _sheet(client, team)
    assert unsure["counts"]["unable"] == len(unsure["attributes"])
    assert "No model is configured" in unsure["items"][0]["cells"][0]["note"]
    path = f"{_base(team)}/test-sheets/{sheet['id']}"
    again = client.post(f"{path}/retest", json={"version": unsure["version"]})
    assert again.status_code == 200, again.text
    provider = _Citing([_answer(["PASS"] * len(sheet["attributes"]))])
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    ready = _sheet(client, team)
    assert ready["proposed_conclusion"] == "EFFECTIVE"
    signed = client.post(f"{path}/sign-off", json={"version": ready["version"]})
    assert signed.status_code == 200, signed.text
    assert (signed.json()["conclusion"], signed.json()["proposal_status"]) == ("EFFECTIVE", "NONE")
    reopened = client.post(
        f"{path}/reopen", json={"version": signed.json()["version"], "reason": "New evidence came."}
    )
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "OPEN"


def test_configuration_evidence_is_tested_once_until_samples_replace_it(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "config")
    kickoff = _request(migrated, team, "ITGC-AC-01")
    # A sampled control with no sample plan gets configuration evidence: tested once.
    _add(
        client,
        team,
        "password settings.csv",
        "Setting,Value\nMinimum password length,14\nLockout threshold,5\n",
        kickoff["id"],
    )
    _read_all(migrated, scheduler)
    single = _sheet(client, team)
    assert (single["control_ref"], single["method"]) == ("ITGC-AC-01", "TEST_OF_ONE")
    with connect(migrated.url) as connection:
        run_sheet(connection, None, UUID(single["id"]))
    single = _sheet(client, team)
    assert [len(item["files"]) for item in single["items"]] == [1]
    # A population then brings a sample plan; approving it replaces the open test of one.
    year = _year(migrated, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    with connect(migrated.url) as connection:
        run_analysis(connection, _settings(migrated), None, scheduler.analyses[-1], _no_ocr)
    plan = client.get(f"{_base(team)}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{_base(team)}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sampled = _sheet(client, team)
    assert sampled["method"] == "SAMPLE"
    assert sampled["id"] != single["id"]
    assert len(sampled["items"]) == 3
    with connect(migrated.url) as connection:
        replaced = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'testing.sheet_replaced'"
        ).fetchone()
    assert replaced == (1,)


def test_the_console_can_decide_results_and_sign_off_testing(migrated: Database) -> None:
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console_tools import ToolContext, ToolFailed, execute, parse

    team, client, scheduler = _engagement(migrated, "tools")
    _confirm_design(client, team, "ITGC-AC-05")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "settings.csv", "Setting,Value\nLockout,5 attempts\n", request["id"])
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        run_sheet(connection, None, UUID(_sheet(client, team)["id"]))
        context = ToolContext(
            connection=connection,
            settings=_settings(migrated),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )

        def call(name: str, **arguments: Any) -> dict[str, Any]:
            tool, parsed = parse(name, arguments)
            return execute(tool, parsed, context)

        summary = call("get_control", control_ref="itgc-ac-05")["test_sheet"]
        assert summary["method"] == "TEST_OF_ONE"
        assert summary["proposed_conclusion"] == "INCOMPLETE"
        with pytest.raises(ToolFailed, match="not complete|needs? a person"):
            call("sign_off_testing", control_ref="ITGC-AC-05")
        for index in range(len(summary["attributes"])):
            decided = call(
                "override_test_result",
                control_ref="ITGC-AC-05",
                item="SAP ERP",
                attribute_index=index,
                result="PASS",
                reason="The settings file shows the configured value.",
            )
        assert decided["proposed_conclusion"] == "EFFECTIVE"
        signed = call("sign_off_testing", control_ref="ITGC-AC-05", note="Checked the settings.")
        assert signed == {"conclusion": "EFFECTIVE", "proposed_deficiency": False}
        with pytest.raises(ToolFailed, match="no test sheet"):
            call("sign_off_testing", control_ref="ITGC-AC-02")


def _approved_samples(migrated: Database, slug: str) -> tuple[dict[str, Any], Any, Any, Any]:
    """A sampled control with its population accepted and its test plan proposed."""
    team, client, scheduler = _engagement(migrated, slug)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{_base(team)}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    return team, client, scheduler, plan


def test_new_evidence_clears_a_persons_override_so_the_new_result_is_decided_again(
    migrated: Database,
) -> None:
    """Bug hunt, 9 November 2026: an override made on the old evidence beat the tester's
    result on the new evidence, so an exception stayed a pass and the sheet effective."""
    team, client, scheduler, plan = _approved_samples(migrated, "override-stale")
    base = _base(team)
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sheet = _sheet(client, team)
    labels = [item["label"] for item in sheet["items"]]
    attributes = len(sheet["attributes"])
    samples = approved.json()["sample_request_id"]
    tickets = "ticket,user\n" + "".join(f"T-{n},{label}\n" for n, label in enumerate(labels))
    _add(client, team, "approvals.csv", tickets, samples)
    _add(client, team, "manager email.txt", "Approval given for the requested access.", samples)
    _read_all(migrated, scheduler)
    provider = _Citing(
        [
            _answer(["PASS"] * attributes),
            _answer(["EXCEPTION"] + ["PASS"] * (attributes - 1)),
            _answer(["PASS"] * attributes),
            # The second item tested again on its new evidence: still an exception.
            _answer(["EXCEPTION"] + ["PASS"] * (attributes - 1)),
        ]
    )
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    sheet = _sheet(client, team)
    second = sheet["items"][1]
    path = f"{base}/test-sheets/{sheet['id']}"
    overridden = client.post(
        f"{path}/items/{second['id']}/override",
        json={
            "version": second["version"],
            "index": 0,
            "result": "PASS",
            "reason": "The approval was given by email; the email is to follow.",
        },
    )
    assert overridden.status_code == 200, overridden.text
    assert overridden.json()["proposed_conclusion"] == "EFFECTIVE"
    # The evidence for the item changes: the email is linked to it, and it is tested again.
    email = next(
        e for e in overridden.json()["placements"] if e["file_name"] == "manager email.txt"
    )
    linked = client.post(
        f"{path}/links",
        json={
            "file_id": email["file_id"],
            "action": "LINK",
            "item_id": second["id"],
            "reason": "The email for this grant.",
        },
    )
    assert linked.status_code == 200, linked.text
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    after = _sheet(client, team)
    cell = after["items"][1]["cells"][0]
    assert (cell["proposed"], cell["final"], cell["overridden_by"]) == (
        "EXCEPTION",
        "EXCEPTION",
        None,
    )
    assert after["proposed_conclusion"] == "NOT_EFFECTIVE"
    with connect(migrated.url) as connection:
        cleared = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'testing.overrides_cleared' "
            "AND target_id = %s",
            (sheet["id"],),
        ).fetchall()
    assert len(cleared) == 1
    payload = cleared[0][0]
    assert payload["item_id"] == second["id"]
    assert [(o["index"], o["result"]) for o in payload["overrides"]] == [(0, "PASS")]
    assert payload["overrides"][0]["reason"].startswith("The approval was given by email")


def test_more_approved_attributes_than_a_sheet_holds_refuse_the_samples(
    migrated: Database,
) -> None:
    """Bug hunt, 9 November 2026: a control with more than 12 approved attributes was
    tested on the first 12 alone, the rest silently dropped."""
    from ai_workforce_api.testing_engine import MAX_ATTRIBUTES, TooManyAttributes, _attributes

    assert len(_attributes([f"Attribute {n}" for n in range(MAX_ATTRIBUTES)])) == MAX_ATTRIBUTES
    with pytest.raises(TooManyAttributes):
        _attributes([f"Attribute {n}" for n in range(MAX_ATTRIBUTES + 1)])
    team, client, _scheduler, plan = _approved_samples(migrated, "too-many-attributes")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET test_attributes = %s::jsonb WHERE id = %s",
            (
                "[" + ",".join(f'"Attribute {n}"' for n in range(MAX_ATTRIBUTES + 1)) + "]",
                plan["engagement_control_id"],
            ),
        )
        connection.commit()
    # The changed attributes need the test plan approved again before samples are.
    approve_plans_over_api(client, team["org"], team["project"])
    plan = client.get(f"{_base(team)}/control-tests").json()[0]
    refused = client.post(
        f"{_base(team)}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert refused.status_code == 409, refused.text
    assert "13 approved test attributes" in refused.json()["detail"]
    assert client.get(f"{_base(team)}/test-sheets").json() == []
    assert client.get(f"{_base(team)}/control-tests").json()[0]["status"] == "PROPOSED"


# Helpers


def _base(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _add(client: TestClient, team: dict[str, Any], name: str, text: str, request_id: str) -> None:
    added = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": name, "request_id": request_id},
        content=text.encode(),
        headers={"content-type": "text/csv" if name.endswith(".csv") else "text/plain"},
    )
    assert added.status_code == 200, added.text


class _Citing(_Provider):
    """A tester that cites what it saw: each pass and each exception quotes the first line
    of the first file it was given, as a real tester must for either to stand."""

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        raw = super().complete(request, config)
        output = raw.output
        found = re.search(r"<file index=0 [^>]*>\n(.*?)\n</file>", request.prompt, re.S)
        if not isinstance(output, dict) or found is None:
            return raw
        quote = next(
            (part.strip() for part in found.group(1).splitlines() if len(part.strip()) >= 3),
            "",
        )[:120]
        results = [
            {**item, "citations": item.get("citations") or [{"file": 0, "quote": quote}]}
            if isinstance(item, dict) and item.get("result") in ("PASS", "EXCEPTION")
            else item
            for item in output.get("results", [])
        ]
        return ModelRaw({**output, "results": results}, raw.tool_calls, raw.input_tokens,
                        raw.output_tokens)  # fmt: skip


def _read_all(database: Database, scheduler: Any) -> None:
    with connect(database.url) as connection:
        for analysis_id in scheduler.analyses:
            run_analysis(connection, _settings(database), None, analysis_id, _no_ocr)


def _confirm_design(client: TestClient, team: dict[str, Any], ref: str) -> None:
    """A person confirms a library control's design where version 3 asks for it, as the
    team does before testing such a control."""
    controls = client.get(f"{_base(team)}/workspace/controls").json()
    control_id = next(c["id"] for c in controls if c["control_ref"] == ref)
    context = client.get(f"{_base(team)}/controls/{control_id}/context").json()
    for issue in context["issues"]:
        if issue["topic"] == "Control design to confirm" and issue["status"] == "OPEN":
            resolved = client.post(
                f"{_base(team)}/controls/{control_id}/issues/{issue['id']}/resolve",
                json={"status": "RESOLVED", "note": "Design confirmed with the control owner.",
                      "version": issue["version"]},
            )  # fmt: skip
            assert resolved.status_code == 200, resolved.text


def _year(database: Database, team: dict[str, Any]) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT period_end FROM engagement_settings WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert row is not None
    return int(row[0].year)


def _answer(results: list[str]) -> dict[str, Any]:
    """A tester's answer. Since M3c an exception carries what was observed and what the
    attribute expects, as a compliant tester's must (an unexplained one goes to a person)."""
    return {
        "results": [
            {"index": index, "result": result, "note": f"Seen: {result.lower()}."}
            | (
                {
                    "observed": "The evidence shows the attribute is not met.",
                    "expected": "The attribute is met for this item.",
                }
                if result == "EXCEPTION"
                else {}
            )  # fmt: skip
            for index, result in enumerate(results)
        ]
    }


def _sheet(client: TestClient, team: dict[str, Any]) -> dict[str, Any]:
    listed = client.get(f"{_base(team)}/test-sheets")
    assert listed.status_code == 200, listed.text
    sheets: list[dict[str, Any]] = listed.json()
    assert len(sheets) == 1
    return sheets[0]


def _controls(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    found = client.get(f"{_base(team)}/workspace/controls")
    assert found.status_code == 200, found.text
    body: list[dict[str, Any]] = found.json()
    return body


def test_each_file_is_tagged_with_the_application_it_shows() -> None:
    from ai_workforce_api.evidence_apps import (
        Application,
        Tag,
        model_tag,
        request_default,
        rules_tag,
    )

    names = [
        "Oracle E-Business Suite (HALPRD)",
        "AWS IAM",
        "Oracle Database (HALPRD DB)",
        "Microsoft Active Directory",
        "Red Hat Enterprise Linux",
    ]
    apps = [Application(uuid4(), name) for name in names]
    by_file = {
        "PWD-01_AD_Default_Domain_Password_Policy.png": "Microsoft Active Directory",
        "PWD-03_Oracle_EBS_Signon_Profile_Options.png": "Oracle E-Business Suite (HALPRD)",
        "PWD-04_Oracle_DB_HALPRD_Password_Profiles.png": "Oracle Database (HALPRD DB)",
        "PWD-05_RHEL_halebsapp01_Password_Config.png": "Red Hat Enterprise Linux",
        "PWD-06_AWS_IAM_Account_Password_Policy.png": "AWS IAM",
    }
    for name, expected in by_file.items():
        tag = rules_tag(apps, name, "", "", "configuration")
        assert (tag.scope, tag.application and tag.application.name) == ("ONE", expected), name
    policy = rules_tag(
        apps, "ISS-07 standard.pdf", "", "Applies to Active Directory and AWS IAM.", "policy"
    )
    assert policy.scope == "ALL"
    # A shared word ("Oracle") or a common short word in the text names no application.
    assert rules_tag(apps, "oracle notes.txt", "", "a red pen", "other").scope == "UNKNOWN"
    assert rules_tag(apps[:1], "anything.txt", "", "", "other").scope == "ONE"
    # Claude's answer counts only when it names one of the control's applications.
    assert model_tag(apps, "aws iam") is not None
    assert model_tag(apps, "ALL") is not None and model_tag(apps, "ALL").scope == "ALL"  # type: ignore[union-attr]
    assert model_tag(apps, "SAP ERP") is None
    # A file no rule or answer places takes the application of its request's instance; a
    # file that shows another application, or all of them, keeps its own tag.
    ad = apps[3]
    unknown = rules_tag(apps, "notes.txt", "", "", "other")
    assert request_default(unknown, ad) == Tag(
        "ONE", ad, "Uploaded to the request for Microsoft Active Directory."
    )
    assert request_default(unknown, None).scope == "UNKNOWN"
    shown = rules_tag(apps, "PWD-06_AWS_IAM_Account_Password_Policy.png", "", "", "configuration")
    assert request_default(shown, ad) == shown
    assert request_default(policy, ad) == policy


def test_a_control_over_several_applications_is_tested_per_application(
    migrated: Database,
) -> None:
    from ai_workforce_api.testing_engine import place_by_application

    one, two = uuid4(), uuid4()
    assert place_by_application([one, two], ("ONE", two, ""))[:2] == ("PLACED", [1])
    assert place_by_application([one, two], ("ALL", None, ""))[:2] == ("PLACED", [0, 1])
    assert place_by_application([one, two], None)[0] == "UNPLACED"
    assert place_by_application([one], None)[:2] == ("PLACED", [0])
    # An instance tests one application: a file showing another one is its sibling's.
    assert place_by_application([one], ("ONE", two, ""))[0] == "EXCLUDED"
    assert place_by_application([one], ("ONE", one, ""))[:2] == ("PLACED", [0])

    # Three more systems join before kickoff: ITGC-AC-05 becomes four instances, each
    # with its own request and test sheet.
    team, client, scheduler = _engagement_with_apps(
        migrated, "perapp", ["Microsoft Active Directory", "Oracle Database", "AWS IAM"]
    )
    instances = {
        row["application_name"]: row for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }  # fmt: skip
    assert set(instances) == {"SAP ERP", "Microsoft Active Directory", "Oracle Database", "AWS IAM"}
    assert instances["Oracle Database"]["label"] == "ITGC-AC-05 · Oracle Database"
    requests = {
        name: _instance_request(migrated, team, row["id"]) for name, row in instances.items()
    }
    assert len({request["id"] for request in requests.values()}) == 4

    # The owner sends everything to the Active Directory request.
    ad_request = requests["Microsoft Active Directory"]["id"]
    _add(client, team, "PWD-01_AD_settings.csv", "Setting,Value\nLength,14\n", ad_request)
    _add(client, team, "PWD-04_Oracle_DB_profiles.csv", "Profile,Limit\nDEFAULT,10\n", ad_request)
    _add(client, team, "notes.csv", "Item,Value\nreviewed,yes\n", ad_request)
    _read_all(migrated, scheduler)
    register = client.get(f"{_base(team)}/evidence-register").json()
    tags = {row["file_name"]: (row["application_scope"], (row["application"] or {}).get("name"))
            for row in register["files"]}  # fmt: skip
    # The notes name no application, so they take the one of the request they came in on
    # (22 Oct 2026; they were left UNKNOWN before, though testing placed them on this
    # instance all the same). The Oracle file still shows its own application.
    assert tags == {
        "PWD-01_AD_settings.csv": ("ONE", "Microsoft Active Directory"),
        "PWD-04_Oracle_DB_profiles.csv": ("ONE", "Oracle Database"),
        "notes.csv": ("ONE", "Microsoft Active Directory"),
    }
    notes = next(row for row in register["files"] if row["file_name"] == "notes.csv")
    assert notes["application_by"] == "AGENT"
    assert notes["application_reason"] == "Uploaded to the request for Microsoft Active Directory."
    # The register names each file's instance and offers the family's applications.
    filed = next(row for row in register["files"] if row["file_name"] == "notes.csv")
    assert filed["control"]["control_ref"] == "ITGC-AC-05"
    assert filed["control"]["application"] == "Microsoft Active Directory"
    offered = next(c for c in register["controls"] if c["id"] == instances["AWS IAM"]["id"])
    assert {a["name"] for a in offered["applications"]} == set(instances)

    # The Active Directory instance keeps its own files; the Oracle file is excluded
    # there and tested on the Oracle instance instead.
    sheets = _sheets_by_application(client, team, instances)
    with connect(migrated.url) as connection:
        for sheet in sheets.values():
            run_sheet(connection, None, UUID(sheet["id"]))
    sheets = _sheets_by_application(client, team, instances)
    assert _files_on(sheets["Microsoft Active Directory"]) == {
        "Microsoft Active Directory": ["PWD-01_AD_settings.csv", "notes.csv"]
    }
    assert _files_on(sheets["Oracle Database"]) == {
        "Oracle Database": ["PWD-04_Oracle_DB_profiles.csv"]
    }
    assert _files_on(sheets["AWS IAM"]) == {"AWS IAM": []}
    placements = {
        e["file_name"]: e["placement"] for e in sheets["Microsoft Active Directory"]["placements"]
    }
    assert placements["PWD-04_Oracle_DB_profiles.csv"] == "EXCLUDED"

    # A person says the notes are about AWS IAM; they move to that instance's sheet.
    aws_id = instances["AWS IAM"]["application_id"]
    tagged = client.post(
        f"{_base(team)}/evidence-files/{filed['id']}/application",
        json={"scope": "ONE", "application_id": aws_id},
    )
    assert tagged.status_code == 200, tagged.text
    assert tagged.json()["files"][0]["application_by"] == "PERSON"
    wrong = client.post(
        f"{_base(team)}/evidence-files/{filed['id']}/application",
        json={"scope": "ONE", "application_id": str(uuid4())},
    )
    assert wrong.status_code == 409
    with connect(migrated.url) as connection:
        for sheet in sheets.values():
            run_sheet(connection, None, UUID(sheet["id"]))
    sheets = _sheets_by_application(client, team, instances)
    assert _files_on(sheets["AWS IAM"]) == {"AWS IAM": ["notes.csv"]}
    assert _files_on(sheets["Microsoft Active Directory"]) == {
        "Microsoft Active Directory": ["PWD-01_AD_settings.csv"]
    }
    # Each instance's register row counts its own files.
    rows = {
        row["application_name"]: row["by_application"]
        for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }
    assert {name: s["files"] for name, s in rows["AWS IAM"].items()} == {"AWS IAM": 1}
    assert {name: s["files"] for name, s in rows["Oracle Database"].items()} == {
        "Oracle Database": 1
    }


def test_earlier_files_left_unknown_take_their_requests_application(migrated: Database) -> None:
    """Migration 0100: a file the coordinator left UNKNOWN on an instance's request takes
    that instance's application; a person's tag stays as it is."""
    from pathlib import Path

    team, client, scheduler = _engagement_with_apps(migrated, "backfill", ["AWS IAM"])
    instances = {
        row["application_name"]: row for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }  # fmt: skip
    request = _instance_request(migrated, team, instances["AWS IAM"]["id"])["id"]
    _add(client, team, "notes.csv", "Item,Value\nreviewed,yes\n", request)
    _add(client, team, "minutes.csv", "Item,Value\nmet,yes\n", request)
    _read_all(migrated, scheduler)
    names = {row["file_name"]: row["id"] for row in client.get(
        f"{_base(team)}/evidence-register").json()["files"]}  # fmt: skip
    # As tagged before this change: the coordinator could not tell; a person said the
    # minutes cover no one application.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_file_applications SET scope = 'UNKNOWN', "
            "engagement_application_id = NULL, reason = 'Not clear.' "
            "WHERE evidence_file_id = %s",
            (names["notes.csv"],),
        )
        connection.execute(
            "UPDATE evidence_file_applications SET scope = 'UNKNOWN', "
            "engagement_application_id = NULL, tagged_by = 'PERSON', decided_by = %s "
            "WHERE evidence_file_id = %s",
            (team["owner_id"], names["minutes.csv"]),
        )
        migration = Path(__file__).resolve().parents[3] / "migrations"
        sql = (migration / "0100_request_application_default.sql").read_text(encoding="utf-8")
        connection.execute(sql)
        rows = dict(
            (str(row[0]), (row[1], row[2], row[3]))
            for row in connection.execute(
                "SELECT t.evidence_file_id, t.scope, a.name, t.reason "
                "FROM evidence_file_applications t "
                "LEFT JOIN engagement_applications a ON a.id = t.engagement_application_id "
                "WHERE t.evidence_file_id = ANY(%s)",
                ([UUID(names["notes.csv"]), UUID(names["minutes.csv"])],),
            ).fetchall()
        )
    assert rows[names["notes.csv"]] == ("ONE", "AWS IAM", "Uploaded to the request for AWS IAM.")
    assert rows[names["minutes.csv"]][:2] == ("UNKNOWN", None)


def _engagement_with_apps(
    database: Database, slug: str, names: list[str]
) -> tuple[dict[str, Any], TestClient, Any]:
    """An engagement started with more in-scope systems than SAP ERP alone."""
    from test_evidence_intake import _client, _Scheduler
    from test_onboarding import _complete_setup, _new_engagement

    team = _new_engagement(database, slug)
    scheduler = _Scheduler()
    client = _client(database, team["owner_id"], scheduler)
    _complete_setup(client, team)
    setup = f"{_base(team)}/onboarding"
    for name in names:
        assert client.post(f"{setup}/applications", json={"name": name}).status_code == 200
    plan = client.post(f"{setup}/plan").json()["plan"]
    started = client.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_plans_over_api(client, team["org"], team["project"])
    return team, client, scheduler


def _instance_request(database: Database, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id, version FROM pbc_requests "
            "WHERE project_id = %s AND engagement_control_id = %s",
            (team["project"], control_id),
        ).fetchone()
    assert row is not None
    return {"id": str(row[0]), "version": int(row[1])}


def _sheets_by_application(
    client: TestClient, team: dict[str, Any], instances: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    listed = client.get(f"{_base(team)}/test-sheets")
    assert listed.status_code == 200, listed.text
    by_control = {sheet["control_id"]: sheet for sheet in listed.json()}
    return {
        name: by_control[row["id"]] for name, row in instances.items() if row["id"] in by_control
    }


def _files_on(sheet: dict[str, Any]) -> dict[str, list[str]]:
    return {item["label"]: sorted(f["file_name"] for f in item["files"]) for item in sheet["items"]}


def test_the_console_names_a_control_by_its_application(migrated: Database) -> None:
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console_tools import ToolContext, ToolFailed, execute, parse
    from ai_workforce_api.control_instances import InstanceState, remove_application_everywhere
    from ai_workforce_api.db import transaction

    team, client, _scheduler = _engagement_with_apps(migrated, "console-apps", ["Oracle Database"])
    with connect(migrated.url) as connection:
        context = ToolContext(
            connection=connection,
            settings=_settings(migrated),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )

        def call(name: str, **arguments: Any) -> dict[str, Any]:
            tool, parsed = parse(name, arguments)
            return execute(tool, parsed, context)

        listed = call("list_controls")["controls"]
        instances = [c for c in listed if c["control_ref"].startswith("ITGC-AC-05")]
        assert sorted(c["application"] for c in instances) == ["Oracle Database", "SAP ERP"]
        assert sorted(c["control_ref"] for c in instances) == [
            "ITGC-AC-05 · Oracle Database",
            "ITGC-AC-05 · SAP ERP",
        ]
        with pytest.raises(ToolFailed, match="tested per application. Name one"):
            call("get_control", control_ref="ITGC-AC-05")
        for name in (
            "ITGC-AC-05 · Oracle Database",
            "itgc-ac-05 (oracle)",
            "ITGC-AC-05 for Oracle",
        ):
            shown = call("get_control", control_ref=name)["control"]
            assert (shown["control_ref"], shown["application"]) == ("ITGC-AC-05", "Oracle Database")
            assert shown["label"] == "ITGC-AC-05 · Oracle Database", name
        # Once the engagement runs, an instance with requests stays.
        oracle = next(c for c in instances if c["application"] == "Oracle Database")
        with (
            pytest.raises(InstanceState, match="cannot be removed"),
            transaction(connection) as cursor,
        ):
            remove_application_everywhere(cursor, team["project"], UUID(oracle["application_id"]))


# Bug hunt, 9 November 2026: a confirmed step decides on the record as the person saw it.


def test_samples_drawn_again_after_their_approval_was_proposed_are_not_approved(
    migrated: Database,
) -> None:
    """Before, approve_samples read the plan's version when the person confirmed it, so a
    draw again (a routine step) in between had the person approve samples never shown."""
    from test_console import _ask as _console_ask
    from test_console import _call, _reply, _Script
    from test_console import _thread as _console_thread

    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console import run_turn
    from ai_workforce_api.console_tools import ToolContext, execute, parse

    team, client, scheduler = _engagement(migrated, "pinsamples")
    base = _base(team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    asked = _console_ask(client, team, "Approve the samples for ITGC-AC-01.")
    # Whatever the model says the pin is, the console sets it.
    script = _Script([
        _reply("", _call("approve_samples", control_ref="ITGC-AC-01", pinned="forged")),
        _reply("Proposed."),
    ])  # fmt: skip
    with connect(migrated.url) as connection:
        assert run_turn(connection, _settings(migrated), script, asked) == "DONE"
    step = _console_thread(client, team)["messages"][-1]["actions"][0]
    assert step["arguments"]["pinned"] == f"control_test:{plan['id']}@{plan['version']}"
    with connect(migrated.url) as connection:
        context = ToolContext(
            connection=connection,
            settings=_settings(migrated),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )
        tool, parsed = parse("propose_samples", {"control_ref": "ITGC-AC-01"})
        execute(tool, parsed, context)
    console = f"{base}/console"
    ran = client.post(f"{console}/actions/{step['id']}/confirm")
    assert ran.status_code == 200, ran.text
    failed = ran.json()["messages"][-1]["actions"][0]
    assert failed["status"] == "FAILED"
    assert failed["error"].startswith("The samples changed since this step was proposed")
    assert client.get(f"{base}/control-tests").json()[0]["status"] == "PROPOSED"
    # Asked again, the step is proposed on the samples as they are, and runs.
    again = _console_ask(client, team, "Approve them now.")
    script = _Script([
        _reply("", _call("approve_samples", control_ref="ITGC-AC-01")), _reply("Proposed."),
    ])  # fmt: skip
    with connect(migrated.url) as connection:
        run_turn(connection, _settings(migrated), script, again)
    done = client.post(f"{console}/messages/{again}/confirm").json()["messages"][-1]["actions"]
    assert done[0]["status"] == "DONE", done


def test_a_confirmed_plan_carries_its_own_changes_and_stops_at_anyone_elses(
    migrated: Database,
) -> None:
    """Results set and a sign-off proposed in one answer run together: each step's change
    is one the person confirmed. A change made by anyone else after the steps were
    proposed stops them."""
    from test_console import _ask as _console_ask
    from test_console import _call, _reply, _Script

    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.console import run_turn
    from ai_workforce_api.console_tools import ToolContext, execute, parse

    team, client, scheduler = _engagement(migrated, "pinsheet")
    _confirm_design(client, team, "ITGC-AC-05")
    request = _request(migrated, team, "ITGC-AC-05")
    _add(client, team, "settings.csv", "Setting,Value\nLockout,5 attempts\n", request["id"])
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        run_sheet(connection, None, UUID(_sheet(client, team)["id"]))
    attributes = len(_sheet(client, team)["attributes"])
    reason = "The settings file shows the configured value."

    def plan() -> _Script:
        return _Script([
            _reply("", *[
                _call("override_test_result", control_ref="ITGC-AC-05", item="SAP ERP",
                      attribute_index=index, result="PASS", reason=reason)
                for index in range(attributes)
            ], _call("sign_off_testing", control_ref="ITGC-AC-05", note="Checked.")),
            _reply("Proposed."),
        ])  # fmt: skip

    console = f"{_base(team)}/console"
    first = _console_ask(client, team, "Pass every attribute and sign off ITGC-AC-05.")
    with connect(migrated.url) as connection:
        assert run_turn(connection, _settings(migrated), plan(), first) == "DONE"
        # Someone else changes the sheet before the person confirms.
        context = ToolContext(
            connection=connection,
            settings=_settings(migrated),
            principal=Principal(kind=PrincipalKind.USER, id=team["owner_id"]),
            organization_id=team["org"],
            project_id=team["project"],
        )
        tool, parsed = parse(
            "override_test_result",
            {"control_ref": "ITGC-AC-05", "item": "SAP ERP", "attribute_index": 0,
             "result": "PASS", "reason": "Seen again by someone else."},
        )  # fmt: skip
        execute(tool, parsed, context)
    stopped = client.post(f"{console}/messages/{first}/confirm").json()["messages"][-1]["actions"]
    assert stopped[0]["status"] == "FAILED"
    assert stopped[0]["error"].startswith("The test sheet changed since this step was proposed")
    assert all(step["status"] == "PROPOSED" for step in stopped[1:])
    assert _sheet(client, team)["status"] == "OPEN"
    # Proposed again on the sheet as it is: the results and the sign-off run in turn.
    second = _console_ask(client, team, "Do it again on the sheet as it is now.")
    with connect(migrated.url) as connection:
        run_turn(connection, _settings(migrated), plan(), second)
    ran = client.post(f"{console}/messages/{second}/confirm").json()["messages"][-1]["actions"]
    assert [step["status"] for step in ran] == ["DONE"] * (attributes + 1), ran
    assert ran[-1]["result"]["conclusion"] == "EFFECTIVE"


def test_a_screenshot_review_is_reused_by_the_attribute_it_answered() -> None:
    """ST-1 (product owner, 19 November 2026). Before, a test of one reused the screenshot
    review's answers by position, so after a new order a pass went to another attribute;
    now each answer goes to the attribute it was reviewed against, and an answer to a
    wording no longer approved leaves the item to the tester or a person."""
    review = {
        "attributes": [
            {"index": 0, "attribute": "Minimum length is 12", "result": "PASS", "observed": "12"},
            {"index": 1, "attribute": "Lockout after 5 attempts", "result": "EXCEPTION",
             "observed": "Lockout after 10"},
        ]
    }  # fmt: skip
    # Rewritten 19 November 2026 (item 17 with FO-22). Old: the agent's undecided review
    # stood in, so its exception and its pass were reused. New: the review is decided by a
    # person (here, the exception accepted), and a review's exception goes to a person
    # (REVIEW, as it cites no passage); the answers still follow their attribute, as the
    # notes show. Reason: the attribute mapping is what this test guards, unchanged.
    review = {**review, "checks": [], "decision": "ACCEPTED", "conclusion": "EXCEPTION"}  # type: ignore[dict-item]
    files = (ItemFile("settings.png", "configuration", "", review),)
    reordered = from_reviews(files, ("Lockout after 5 attempts", "Minimum length is 12"))
    assert reordered is not None
    assert [item["result"] for item in reordered] == ["REVIEW", "REVIEW"]
    assert [item["note"] for item in reordered] == [
        "settings.png: Lockout after 10",
        "settings.png: 12",
    ]
    assert [item["index"] for item in reordered] == [0, 1]
    assert from_reviews(files, ("Lockout after 3 attempts", "Minimum length is 12")) is None


def test_results_and_overrides_follow_their_attribute_not_their_position() -> None:
    """ST-1 (product owner, 19 November 2026; decision D2): each result and override moves
    with its attribute's identity; one whose attribute was removed or reworded is dropped."""
    from ai_workforce_api.testing_engine import remap_results

    results = [
        {"index": 0, "result": "PASS", "note": "a"},
        {"index": 1, "result": "EXCEPTION", "note": "b"},
        {"index": 2, "result": "PASS", "note": "c"},
    ]
    overrides = [{"index": 1, "result": "PASS", "reason": "Seen.", "by": "x", "at": "t"}]
    moved, kept = remap_results(["a", "b", "c"], ["c", "a", "d"], results, overrides)
    assert sorted((item["index"], item["note"]) for item in moved) == [(0, "c"), (1, "a")]
    assert kept == []
    # A removal keeps the rest, at their new places, with a person's override.
    moved, kept = remap_results(["a", "b", "c"], ["b", "c"], results, overrides)
    assert sorted((item["index"], item["note"]) for item in moved) == [(0, "b"), (1, "c")]
    assert [item["index"] for item in kept] == [0]


def _open_tested(migrated: Database, slug: str) -> tuple[dict[str, Any], Any, dict[str, Any]]:
    from test_workpapers import _tested_control

    team, client, sheet, _file = _tested_control(migrated, slug, sign=False)
    return team, client, sheet


def _sheet_of(client: TestClient, team: dict[str, Any], sheet_id: str) -> dict[str, Any]:
    found: dict[str, Any] = next(
        s for s in client.get(f"{_base(team)}/test-sheets").json() if s["id"] == sheet_id
    )
    return found


def test_accepted_criteria_on_an_open_sheet_hold_sign_off_until_retested(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026). Accepting the agent's criteria changes what
    the tester is given without revising the plan, so approval never brings the open sheet
    in step. Before, the items tested against the standard's definition signed off; now
    they are tested again against the criteria a person owns."""
    team, client, sheet = _open_tested(migrated, "basis-criteria")
    control = sheet["control_id"]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert row is not None
        # The planner agent's criteria, not accepted yet (the plan revised and approved).
        connection.execute(
            "UPDATE control_attributes SET criteria_origin = 'AGENT', criteria_accepted_at = NULL, "
            "condition = 'An access request is approved', "
            "pass_criteria = 'A named approver approved it before access was granted', "
            "fail_criteria = 'No approval, or one after access was granted' WHERE id = %s",
            (row[0],),
        )
        connection.commit()
    from test_master_plans import _approve

    _approve(team, control)
    assert _sheet_of(client, team, sheet["id"])["counts"]["out_of_date"] == 0
    with connect(migrated.url) as connection:
        version = connection.execute(
            "SELECT version FROM control_attributes WHERE id = %s", (row[0],)
        ).fetchone()
    assert version is not None
    accepted = team["owner"].post(
        f"{_base(team)}/controls/{control}/master-plan/criteria/accept",
        json={"attributes": [{"id": str(row[0]), "version": int(version[0])}]},
    )
    assert accepted.status_code == 200, accepted.text
    current = _sheet_of(client, team, sheet["id"])
    assert all(item["state"] == "WAITING" for item in current["items"])
    assert current["running"] is True
    refused = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/sign-off", json={"version": current["version"]}
    )
    assert refused.status_code == 409 and refused.json()["detail"] == "the tester is still testing"


def test_more_attributes_than_a_sheet_holds_leave_the_sheet_and_hold_its_sign_off(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026): a control approved with more attributes than
    a sheet holds never aborts the approval; the open sheet is left as it is, and its
    sign-off waits with the reason."""
    import json

    from test_master_plans import _approve

    from ai_workforce_api.db import transaction
    from ai_workforce_api.testing_engine import MAX_ATTRIBUTES, resync_open_sheets

    team, client, sheet = _open_tested(migrated, "basis-many")
    control = UUID(sheet["control_id"])
    many = [f"Attribute {n} holds" for n in range(MAX_ATTRIBUTES + 1)]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET test_attributes = %s::jsonb WHERE id = %s",
            (json.dumps(many), control),
        )
        connection.commit()
    # Approving them brings the open sheet in step: refused to it, never to the approval.
    _approve(team, str(control))
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            assert resync_open_sheets(cursor, team["org"], team["project"], control, None) == []
    current = _sheet_of(client, team, sheet["id"])
    assert current["attributes"] == sheet["attributes"]
    assert any("a test sheet holds at most" in line for line in current["blocking"])
    assert current["proposed_conclusion"] == "INCOMPLETE"


def test_a_new_order_during_a_run_asks_the_run_to_look_again(migrated: Database) -> None:
    """ST-1 review note N5 (19 November 2026). A new list bumps every item, so a run in
    progress has its writes refused. Before, only an item marked to be tested again asked
    for a run: with no tested item (or a removal), the run ended and its untested items
    stayed untested with nothing asked. Now the run is asked to look again."""
    import json

    from ai_workforce_api.db import transaction
    from ai_workforce_api.testing_engine import lock_plan, resync_open_sheets

    team, _client, sheet = _open_tested(migrated, "basis-working")
    control = UUID(sheet["control_id"])
    with connect(migrated.url) as connection:
        stored = connection.execute(
            "SELECT test_attributes FROM engagement_controls WHERE id = %s", (control,)
        ).fetchone()
        assert stored is not None and len(stored[0]) >= 2
        # Nothing tested yet, and a run under way; then a new order.
        connection.execute(
            "UPDATE test_items SET tested_at = NULL, needs_test = true WHERE test_sheet_id = %s",
            (sheet["id"],),
        )
        connection.execute(
            "UPDATE test_sheets SET run_status = 'WORKING', "
            "run_requested_at = '2000-01-01T00:00:00Z' WHERE id = %s",
            (sheet["id"],),
        )
        connection.execute(
            "UPDATE engagement_controls SET test_attributes = %s::jsonb WHERE id = %s",
            (json.dumps(list(reversed(stored[0]))), control),
        )
        connection.commit()
        with transaction(connection) as cursor:
            lock_plan(cursor, control)
            queued = resync_open_sheets(cursor, team["org"], team["project"], control, None)
        row = connection.execute(
            "SELECT run_status, run_requested_at, attributes FROM test_sheets WHERE id = %s",
            (sheet["id"],),
        ).fetchone()
    assert row is not None
    assert row[2] == list(reversed(stored[0]))
    assert queued == [UUID(sheet["id"])]
    assert row[0] == "WORKING" and row[1].year > 2000


def test_the_deploy_pass_brings_open_sheets_in_step_one_control_at_a_time(
    migrated: Database,
) -> None:
    """ST-1 review note N6 (19 November 2026). At deploy, every open sheet of a running
    engagement is brought in step with the approved attributes. Before, the controls were
    read outside a transaction block, so every control's block was a savepoint of one
    transaction: a failure rolled the whole pass back and every plan stayed locked to the
    end. Now each control commits on its own."""
    import json

    import psycopg
    from psycopg.pq import TransactionStatus

    from ai_workforce_api.testing_engine import resync_everywhere

    _team, _client, sheet = _open_tested(migrated, "basis-deploy")
    control = UUID(sheet["control_id"])
    with connect(migrated.url) as connection:
        stored = connection.execute(
            "SELECT test_attributes FROM engagement_controls WHERE id = %s", (control,)
        ).fetchone()
        assert stored is not None and len(stored[0]) >= 2
        connection.execute(
            "UPDATE engagement_controls SET test_attributes = %s::jsonb WHERE id = %s",
            (json.dumps(list(reversed(stored[0]))), control),
        )
        connection.commit()
    # A fresh connection, as the deploy step (migrate.py) opens it.
    with psycopg.connect(migrated.url, connect_timeout=3) as connection:
        resync_everywhere(connection)
        assert connection.info.transaction_status == TransactionStatus.IDLE
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT attributes FROM test_sheets WHERE id = %s", (sheet["id"],)
        ).fetchone()
    assert row is not None and row[0] == list(reversed(stored[0]))


def test_a_filled_in_client_value_is_the_same_attribute_and_its_items_are_tested_again(
    migrated: Database,
) -> None:
    """ST-1 (product owner, 19 November 2026; milestone L3e). A client value filled into an
    approved attribute's brackets is the same attribute and revises no plan: the open
    sheet takes the new wording by the attribute's identity and keeps its results there.

    Rewritten 19 November 2026 (N1, product owner: "Yes, retest them"). Old expectation:
    the items kept their state and no run was asked (the fill tested nothing again). New
    expectation: every item tested on the bracket is tested again, and the run is asked.
    Why: the items were tested without the value the attribute now holds them to, so the
    sheet could sign off on results that never read it. The identity, the approval kept
    and the results following their attribute are asserted as before."""
    from test_master_plans import _approve

    from ai_workforce_api.control_attributes import _write_list
    from ai_workforce_api.db import transaction
    from ai_workforce_api.testing_engine import lock_plan, resync_open_sheets

    team, client, sheet = _open_tested(migrated, "basis-fill")
    control = sheet["control_id"]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert row is not None
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE control_attributes SET text = %s WHERE id = %s",
                (f"{row[1]} within [the agreed days]", row[0]),
            )
            _write_list(cursor, UUID(control))
    # The bracketed wording is a change of wording (the plan revised): approved, the sheet
    # is in step and tested on it.
    _approve(team, control)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE test_items SET needs_test = false WHERE test_sheet_id = %s", (sheet["id"],)
        )
        connection.commit()
    bracketed = _sheet_of(client, team, sheet["id"])
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE control_attributes SET text = %s WHERE id = %s",
                (f"{row[1]} within 5 days", row[0]),
            )
            _write_list(cursor, UUID(control))
            lock_plan(cursor, UUID(control))
            assert resync_open_sheets(
                cursor, team["org"], team["project"], UUID(control), None
            ) == [UUID(sheet["id"])]
        plan = connection.execute(
            "SELECT status FROM evidence_plans WHERE engagement_control_id = %s", (control,)
        ).fetchone()
    assert plan == ("APPROVED",)
    filled = _sheet_of(client, team, sheet["id"])
    assert filled["attributes"][0].endswith("within 5 days")
    assert all(i["state"] != "WAITING" for i in bracketed["items"])
    assert [i["state"] for i in filled["items"]] == ["WAITING"] * len(bracketed["items"])
    assert filled["running"] is True
    assert [[c["proposed"] for c in i["cells"]] for i in filled["items"]] == [
        [c["proposed"] for c in i["cells"]] for i in bracketed["items"]
    ]


def test_a_value_filled_into_the_wording_tested_is_a_retest_and_nothing_else_is() -> None:
    """N1 (product owner, 19 November 2026: "Yes, retest them"): the rule. Items tested on
    an attribute whose bracketed client value was unfilled are tested again once it is
    filled; the attribute is the same (its key), so nothing else would mark them."""
    from ai_workforce_api.testing_engine import Basis, filled_since

    def basis(*texts: str, keys: tuple[str, ...] = ("a1", "a2")) -> Basis:
        return Basis(tuple(texts), keys, (None,) * len(texts), 1)

    tested_on = ["Access is removed within [N] days", "The removal is approved"]
    keys = ["a1", "a2"]
    assert filled_since(tested_on, keys, basis("Access is removed within 5 days", tested_on[1]))
    # In a new order: the value follows the attribute, not the position.
    assert filled_since(
        tested_on,
        keys,
        basis("The removal is approved", "Access is removed within 5 days", keys=("a2", "a1")),
    )
    # One of two values filled is a value filled.
    assert filled_since(
        ["Removed within [N] days by [the role]"],
        ["a1"],
        Basis(("Removed within 5 days by [the role]",), ("a1",), (None,), 1),
    )
    # Nothing filled, a new order, a value changed once filled, another attribute's
    # wording: not a fill (the other rules decide those).
    assert not filled_since(tested_on, keys, basis(*tested_on))
    assert not filled_since(tested_on, keys, basis(*reversed(tested_on), keys=("a2", "a1")))
    assert not filled_since(
        ["Access is removed within 5 days"],
        ["a1"],
        Basis(("Access is removed within 3 days",), ("a1",), (None,), 1),
    )
    assert not filled_since(
        tested_on, keys, basis("Access is removed within 5 days", tested_on[1], keys=("a3", "a2"))
    )


def test_items_tested_on_an_unfilled_value_hold_sign_off_until_tested_again_with_it(
    migrated: Database,
) -> None:
    """N1 (product owner, 19 November 2026: "Yes, retest them"). The items are tested on
    "removed within [N] days"; N is filled in as 5 (as control_design.refresh_statement
    saves a fill: the wording, the list, the plan held, the open sheets brought in step).
    The plan keeps its approval, the sheet's sign-off is refused, and once the items are
    tested again with the value, it signs off. Before, the sheet signed off on results
    tested without the value."""
    from test_master_plans import _approve

    from ai_workforce_api.control_attributes import _write_list
    from ai_workforce_api.db import transaction
    from ai_workforce_api.testing_engine import lock_plan, resync_open_sheets

    team, client, sheet = _open_tested(migrated, "basis-fill-signoff")
    control = sheet["control_id"]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position LIMIT 1",
            (control,),
        ).fetchone()
        assert row is not None
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE control_attributes SET text = %s WHERE id = %s",
                ("Access is removed within [N] days", row[0]),
            )
            _write_list(cursor, UUID(control))
    _approve(team, control)
    attributes = len(_sheet_of(client, team, sheet["id"])["attributes"])
    with connect(migrated.url) as connection:
        assert (
            run_sheet(connection, _Citing([_answer(["PASS"] * attributes)]), UUID(sheet["id"]))
            == "DONE"
        )
    bracketed = _sheet_of(client, team, sheet["id"])
    assert bracketed["attributes"][0] == "Access is removed within [N] days"
    assert bracketed["running"] is False
    assert bracketed["proposed_conclusion"] != "INCOMPLETE", bracketed["blocking"]
    with connect(migrated.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                "UPDATE control_attributes SET text = %s WHERE id = %s",
                ("Access is removed within 5 days", row[0]),
            )
            _write_list(cursor, UUID(control))
            lock_plan(cursor, UUID(control))
            resync_open_sheets(cursor, team["org"], team["project"], UUID(control), None)
        plan = connection.execute(
            "SELECT status FROM evidence_plans WHERE engagement_control_id = %s", (control,)
        ).fetchone()
    assert plan == ("APPROVED",)
    filled = _sheet_of(client, team, sheet["id"])
    assert filled["attributes"][0] == "Access is removed within 5 days"
    assert [i["state"] for i in filled["items"]] == ["WAITING"] * len(filled["items"])
    refused = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/sign-off", json={"version": filled["version"]}
    )
    assert refused.status_code == 409, refused.text
    # Tested again with the value: the sheet signs off.
    with connect(migrated.url) as connection:
        assert (
            run_sheet(connection, _Citing([_answer(["PASS"] * attributes)]), UUID(sheet["id"]))
            == "DONE"
        )
    retested = _sheet_of(client, team, sheet["id"])
    assert all(i["state"] != "WAITING" for i in retested["items"])
    signed = client.post(
        f"{_base(team)}/test-sheets/{sheet['id']}/sign-off", json={"version": retested["version"]}
    )
    assert signed.status_code == 200, signed.text


def test_testing_sign_off_waits_while_attributes_are_unsettled(migrated: Database) -> None:
    """FO-11 (audit invariant I1, 19 November 2026). Before, the testing sign-off read the
    plan's gate with no phase, so only the plan's approval held it: a sheet signed off while
    an agent's attribute proposal waited for a person. Now the gate reads the phase tested,
    so the attributes are settled first."""
    from test_workpapers import _tested_control

    team, client, sheet, _file = _tested_control(migrated, "sheet-unsettled", sign=False)
    base = _base(team)
    with connect(migrated.url) as connection:
        added = connection.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                source_kind, proposal
            )
            SELECT organization_id, project_id, id, 99, 'Approval is evidenced before access',
                   'PROPOSED', 'AGENT', 'ADD'
            FROM engagement_controls WHERE id = %s
            RETURNING id
            """,
            (UUID(sheet["control_id"]),),
        ).fetchone()
        connection.commit()
    assert added is not None
    current = _sheet(client, team)
    held = client.post(
        f"{base}/test-sheets/{current['id']}/sign-off", json={"version": current["version"]}
    )
    assert held.status_code == 409
    assert "settle the control's attributes first" in held.json()["detail"]
    with connect(migrated.url) as connection:
        connection.execute("DELETE FROM control_attributes WHERE id = %s", (added[0],))
        connection.commit()
    current = _sheet(client, team)
    signed = client.post(
        f"{base}/test-sheets/{current['id']}/sign-off", json={"version": current["version"]}
    )
    assert signed.status_code == 200, signed.text


def _tested_with(
    migrated: Database, slug: str, answers: list[dict[str, Any]]
) -> tuple[dict[str, Any], TestClient, dict[str, Any]]:
    """A sampled control of three items, tested on the given answers (one per item), not
    signed off."""
    team, client, scheduler = _engagement(migrated, slug)
    base = _base(team)
    kickoff = _request(migrated, team, "ITGC-AC-01")
    year = _year(migrated, team)
    population = "User ID,Name,Date granted\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10\n" for n in range(1, 4)
    )
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    ).json()
    sheet = _sheet(client, team)
    tickets = "ticket,user,approved_by\n" + "".join(
        f"T-{n},{item['label']},Demo Manager\n" for n, item in enumerate(sheet["items"])
    )
    _add(client, team, "access tickets.csv", tickets, approved["sample_request_id"])
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        run_sheet(connection, _Citing(list(answers)), UUID(sheet["id"]))
    return team, client, _sheet(client, team)


def test_an_agent_not_applicable_is_a_proposal_until_a_person_confirms_it(
    migrated: Database,
) -> None:
    """Decision D1 (product owner, 19 November 2026; audit invariant I7). Before, the
    tester's not applicable concluded the attribute, so a sheet whose only support was an
    agent's not applicable read EFFECTIVE. Now, on an open sheet, it is a proposal a person
    confirms with a reason: until then its final is REVIEW and the sheet is incomplete. A
    signed sheet keeps what was signed, and the review raises the unconfirmed ones."""
    from ai_workforce_api.control_reviews import ControlFacts, rules_findings
    from ai_workforce_api.test_sheets import _sheet as sheet_body

    proposed = [
        {"index": 0, "result": "NOT_APPLICABLE", "note": "No change was made in the period."},
        {"index": 1, "result": "PASS", "note": "Seen."},
    ]
    assert final_results(2, proposed, []) == ("NOT_APPLICABLE", "PASS")
    finals = final_results(2, proposed, [], confirm_not_applicable=True)
    assert finals == ("REVIEW", "PASS")
    assert conclusion([ItemView(True, True, finals)]) == "INCOMPLETE"
    person = [{"index": 0, "result": "NOT_APPLICABLE", "reason": "No change was made.",
               "by": "someone", "at": "2027-01-01"}]  # fmt: skip
    assert final_results(2, proposed, person, confirm_not_applicable=True) == (
        "NOT_APPLICABLE",
        "PASS",
    )

    attributes = 5  # ITGC-AC-01's approved attributes
    na_first = {
        "results": [
            {"index": 0, "result": "NOT_APPLICABLE",
             "note": "No access was granted to this user in the period, so no approval applies."},
            *[{"index": i, "result": "PASS", "note": "Seen: pass."} for i in range(1, attributes)],
        ]
    }  # fmt: skip
    passing = _answer(["PASS"] * attributes)
    team, client, sheet = _tested_with(migrated, "agent-na", [na_first, passing, passing])
    assert len(sheet["attributes"]) == attributes
    cell = sheet["items"][0]["cells"][0]
    assert (cell["proposed"], cell["final"]) == ("NOT_APPLICABLE", "REVIEW")
    assert sheet["proposed_conclusion"] == "INCOMPLETE"
    assert "1 result needs human review: a person decides" in sheet["blocking"]
    path = f"{_base(team)}/test-sheets/{sheet['id']}/items/{sheet['items'][0]['id']}/override"
    version = sheet["items"][0]["version"]
    short = client.post(
        path, json={"version": version, "index": 0, "result": "NOT_APPLICABLE", "reason": "N/A."}
    )
    assert short.status_code == 422
    missing = client.post(
        path,
        json={"version": version, "index": 0, "result": "NOT_APPLICABLE",
              "reason": "The evidence was not provided by the client."},
    )  # fmt: skip
    assert missing.status_code == 422
    reason = "No access was granted to this user in the period; the HR record shows no change."
    confirmed = client.post(
        path, json={"version": version, "index": 0, "result": "NOT_APPLICABLE", "reason": reason}
    )
    assert confirmed.status_code == 200, confirmed.text
    sheet = _sheet(client, team)
    assert sheet["items"][0]["cells"][0]["final"] == "NOT_APPLICABLE"
    assert sheet["proposed_conclusion"] == "EFFECTIVE"
    with connect(migrated.url) as connection:
        audited = connection.execute(
            "SELECT payload FROM audit_events WHERE target_id = %s "
            "AND action = 'testing.result_overridden'",
            (UUID(sheet["id"]),),
        ).fetchone()
        assert audited is not None and audited[0]["reason"] == reason
        # A sheet signed before D1 keeps its agent's not applicable on the record, and the
        # review raises it for the reviewer to decide.
        connection.execute(
            "UPDATE test_items SET overrides = '[]'::jsonb WHERE id = %s",
            (UUID(sheet["items"][0]["id"]),),
        )
        connection.execute(
            "UPDATE test_sheets SET status = 'SIGNED_OFF', signed_by = %s, "
            "signed_at = clock_timestamp(), conclusion = 'EFFECTIVE' WHERE id = %s",
            (team["owner_id"], UUID(sheet["id"])),
        )
        connection.commit()
        signed = sheet_body(connection, UUID(str(team["project"])), UUID(sheet["id"]))
        assert signed.items[0].cells[0].final == "NOT_APPLICABLE"
        found = rules_findings(
            signed, ControlFacts("ITGC-AC-01", "EVENT", "", "MANUAL", True), (), None
        )
    raised = [f for f in found if f.target.get("rule") == "UNCONFIRMED_NA"]
    assert [(f.severity, f.target["indexes"]) for f in raised] == [("MUST_FIX", [0])]


def test_a_not_applicable_override_needs_ten_characters_and_never_missing_evidence() -> None:
    """Decision D1 (19 November 2026). Before, any reason of 3 characters confirmed a not
    applicable, missing evidence included. Now a not applicable needs at least 10, and the
    evidence planner's rule (missing evidence is never the reason) is reused; a pass or an
    exception keeps its 3."""
    from pydantic import ValidationError

    from ai_workforce_api.test_sheets import OverrideBody

    def body(result: str, reason: str) -> OverrideBody:
        return OverrideBody.model_validate(
            {"version": 1, "index": 0, "result": result, "reason": reason}
        )

    for refused in ("N/A here", "Evidence not provided.", "Awaiting evidence from IT."):
        with pytest.raises(ValidationError):
            body("NOT_APPLICABLE", refused)
    assert body("NOT_APPLICABLE", "No change was made to the system in the period.").reason
    assert body("PASS", "Seen.").reason == "Seen."
    assert body("EXCEPTION", "Late.").reason == "Late."


def test_comparison_primitives_leave_ambiguous_values_open() -> None:
    """Item 5 with FO-18 (audit invariants I6, I10; 19 November 2026). Before, a value was
    found inside a longer word ("Lee" in "Ashlee"), two values differing only in separators
    matched, a non-Latin name was "", ISO times read as 23:59, an ambiguous slashed date
    was read month first, and "1,5" read as 15. Now each is decided only when it can be:
    otherwise the comparison is open (holds None), and a pass on it goes to a person."""
    from ai_workforce_api.testing_checks import date_orders
    from ai_workforce_api.testing_checks import evaluate as evaluate_checks

    texts = [(
        "ticket.txt",
        "Approved by Ashlee Park on 2027-03-15T10:00\n"
        "Requester: jsmith2\n"
        "Requested by j.smith on 2027-03-15\n"
        "Approver: Elena Rossi\n"
        "Granted on 10/03/2027 at 10:00 PM\n"
        "Change size 1,5 and 1,500\n"
        "Owner Иван Петров, reviewer Иван Петров\n"
        "Approved 03/15/2027",
    )]  # fmt: skip
    detail = (("User ID", "jsmith"), ("Name", "Rossi, Elena"), ("Granted", "10/03/2027"),
              ("Approved", "2027-03-15"))  # fmt: skip

    def side(value: str, file: int, quote: str = "", label: str = "Value") -> dict[str, Any]:
        return {"label": label, "value": value, "file": file, "quote": quote}

    def check(kind: str, left: dict[str, Any], right: dict[str, Any], orders: Any = None) -> Any:
        [found] = evaluate_checks([{"kind": kind, "left": left, "right": right}], texts, detail,
                                  orders)  # fmt: skip
        return found

    # A value is found only as whole tokens.
    assert not check("equal", side("Lee", 0, "Approved by Ashlee Park"),
                     side("Lee", -1)).left.verified  # fmt: skip
    assert not check("equal", side("jsmith", 0, "Requester: jsmith2"),
                     side("jsmith", -1, "", "User ID")).left.verified  # fmt: skip
    assert not check("on_or_before", side("2027-03-1", 0, "on 2027-03-15T10:00"),
                     side("2027-03-15", -1, "", "Approved")).left.verified  # fmt: skip
    # Separators alone, or a name against an account, cannot be told apart.
    loose = check("equal", side("j.smith", 0, "Requested by j.smith"),
                  side("jsmith", -1, "", "User ID"))  # fmt: skip
    assert loose.holds is None
    # A "Last, First" name is the same person as "First Last".
    named = check("equal", side("Elena Rossi", 0, "Approver: Elena Rossi"),
                  side("Rossi, Elena", -1, "", "Name"))  # fmt: skip
    assert named.holds is True
    # Non-Latin names compare as themselves, never as "".
    cyrillic = check("different", side("Иван Петров", 0, "Owner Иван Петров"),
                     side("Иван Петров", 0, "reviewer Иван Петров"))  # fmt: skip
    assert (cyrillic.left.verified, cyrillic.holds) == (True, False)
    # A date written two ways is the same date.
    two_ways = check("equal", side("03/15/2027", 0, "Approved 03/15/2027"),
                     side("2027-03-15", -1, "", "Approved"))  # fmt: skip
    assert two_ways.holds is True
    # The same day with a date alone on one side is open; an ISO time is read whole.
    same_day = check("on_or_before", side("2027-03-15T10:00", 0, "on 2027-03-15T10:00"),
                     side("2027-03-15", -1, "", "Approved"))  # fmt: skip
    assert same_day.holds is None
    # An ambiguous slashed date is read only where its own column tells the order.
    granted = side("10/03/2027", -1, "", "Granted")
    approved = side("2027-03-15T10:00", 0, "on 2027-03-15T10:00")
    assert check("on_or_before", granted, approved).holds is None
    assert date_orders([(("Granted", "10/03/2027"),)]) == {}
    day_first = date_orders([(("Granted", "10/03/2027"),), (("Granted", "25/03/2027"),)])
    assert day_first == {"Granted": "dmy"}
    assert check("on_or_before", granted, approved, day_first).holds is True
    # A quoted file's ambiguous slashed date is never read.
    quoted = check("on_or_before", side("10/03/2027", 0, "Granted on 10/03/2027"),
                   side("2027-03-15", -1, "", "Approved"), day_first)  # fmt: skip
    assert quoted.holds is None
    # A decimal comma is open; grouping in threes is a number.
    assert check("at_most", side("1,5", 0, "Change size 1,5"),
                 side("1,500", 0, "and 1,500")).holds is None  # fmt: skip


def test_a_not_applicable_with_a_failing_check_goes_to_a_person() -> None:
    """Critic 13 (19 November 2026). A not applicable whose own comparison does not hold
    is decided by a person, never turned into a rule-decided exception (the values may be
    placeholders); before, it stood unchanged."""
    from ai_workforce_api.testing_checks import apply as apply_checks
    from ai_workforce_api.testing_checks import evaluate as evaluate_checks

    texts = [("ticket.txt", "Approved on 2027-04-01\nGranted on 2027-03-01")]
    raw = [{"kind": "on_or_before",
            "left": {"label": "Approved", "value": "2027-04-01", "file": 0,
                     "quote": "Approved on 2027-04-01"},
            "right": {"label": "Granted", "value": "2027-03-01", "file": 0,
                      "quote": "Granted on 2027-03-01"}}]  # fmt: skip
    checks = evaluate_checks(raw, texts, ())
    assert checks[0].holds is False
    kept = apply_checks({"index": 0, "result": "NOT_APPLICABLE", "note": "No grant."}, checks)
    assert (kept["result"], kept["rule"]) == ("REVIEW", "NA_CHECK")


def test_a_screenshot_review_stands_in_only_once_a_person_decided_it() -> None:
    """Item 17 with D9 and FO-22 (audit invariants I5, I7; 19 November 2026). The full
    matrix: a person's decision (accepted or overridden) and conclusion, against the
    review's answer. Before, the agent's undecided review stood in, an exception in it stood
    even when the person overrode it to no exception, and an unclear system or period still
    passed."""
    ok = [{"check": key, "result": "OK"} for key in ("legibility", "system", "date_period",
                                                      "editing", "applicability")]  # fmt: skip
    unclear = [{**check, "result": "UNCLEAR"} if check["check"] == "system" else check
               for check in ok]  # fmt: skip
    attributes = ("Minimum length is 12",)

    def outcome(decision: Any, conclusion: Any, answer: str, checks: Any = ok) -> Any:
        review = {"checks": checks, "decision": decision, "conclusion": conclusion,
                  "attributes": [{"index": 0, "attribute": attributes[0], "result": answer,
                                  "observed": "Seen."}]}  # fmt: skip
        found = from_reviews((ItemFile("s.png", "configuration", "", review),), attributes)
        return None if found is None else found[0]["result"]

    for answer in ("PASS", "EXCEPTION", "NOT_DETERMINABLE"):
        assert outcome(None, None, answer) is None
        for decision in ("ACCEPTED", "OVERRIDDEN"):
            assert outcome(decision, "CANNOT_CONCLUDE", answer) is None
            assert outcome(decision, "EXCEPTION", answer) == "REVIEW"
            expected = "PASS" if answer == "PASS" else "REVIEW"
            assert outcome(decision, "NO_EXCEPTION", answer) == expected, (decision, answer)
    # An unclear system holds a pass a person accepted, not one a person overrode.
    assert outcome("ACCEPTED", "NO_EXCEPTION", "PASS", unclear) == "REVIEW"
    assert outcome("OVERRIDDEN", "NO_EXCEPTION", "PASS", unclear) == "PASS"
    issue = [{**check, "result": "ISSUE"} if check["check"] == "editing" else check
             for check in ok]  # fmt: skip
    assert outcome("OVERRIDDEN", "NO_EXCEPTION", "PASS", issue) == "REVIEW"


def test_no_attribute_is_invented_and_a_sheet_without_one_cannot_conclude() -> None:
    """FO-21 (audit invariant I1, 19 November 2026). Before, a control with no approved
    attribute was tested on an invented "The control operated as described", which a tester
    could pass and the sheet conclude on. Now none is invented, a placeholder that only
    restates the control is no attribute, and an item with no attribute cannot conclude."""
    from ai_workforce_api.testing_engine import _attributes

    assert _attributes([]) == []
    assert _attributes(None) == []
    assert _attributes(["The control operated as described in the control activity."]) == []
    assert _attributes(["Access is approved before it is granted."]) == [
        "Access is approved before it is granted."
    ]
    assert conclusion([ItemView(True, True, ())]) == "INCOMPLETE"
    assert conclusion([ItemView(True, True, ("PASS",))]) == "EFFECTIVE"


def test_required_evidence_follows_the_attribute_through_a_rewording(
    migrated: Database,
) -> None:
    """Item 16 (audit invariant I11, 19 November 2026). Before, the plan's REQUIRED
    evidence was given to an attribute only by its exact wording, so a reworded attribute
    lost it, and a removed requirement was still given. Now a requirement follows the
    attribute by its id through the wordings it replaced, and a removed one is left out."""
    from test_workpapers import _tested_control

    from ai_workforce_api.testing_engine import plan_evidence

    team, client, sheet, _file = _tested_control(migrated, "plan-by-id", sign=False)
    control = UUID(sheet["control_id"])
    attributes = tuple(_sheet(client, team)["attributes"])
    with connect(migrated.url) as connection:
        before = plan_evidence(connection, UUID(sheet["id"]), control, attributes)
        index = next(i for i, found in enumerate(before) if found)
        old = connection.execute(
            "SELECT id FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND text = %s",
            (control, attributes[index]),
        ).fetchone()
        assert old is not None
        reworded = attributes[index].rstrip(".") + ", as the approved ticket shows."
        # An approved change, as control_attributes applies one: the old wording retired,
        # the new one approved in its place.
        connection.execute(
            "UPDATE control_attributes SET status = 'RETIRED' WHERE id = %s", (old[0],)
        )
        connection.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                source_kind, replaces_id
            )
            SELECT organization_id, project_id, engagement_control_id, 97, %s, 'APPROVED',
                   source_kind, id
            FROM control_attributes WHERE id = %s
            """,
            (reworded, old[0]),
        )
        connection.commit()
        renamed = (*attributes[:index], reworded, *attributes[index + 1 :])
        after = plan_evidence(connection, UUID(sheet["id"]), control, renamed)
        assert after[index] == before[index]
        # A removed requirement is not given.
        connection.execute(
            "UPDATE evidence_requirements SET status = 'REMOVED' WHERE engagement_control_id = %s "
            "AND title = %s",
            (control, before[index][0]["evidence"]),
        )
        connection.commit()
        removed = plan_evidence(connection, UUID(sheet["id"]), control, renamed)
    assert before[index][0]["evidence"] not in [entry["evidence"] for entry in removed[index]]


def _population_check(kind: str, left: str, right: str) -> Any:
    """One rule check of two population-row values, evaluated."""
    from ai_workforce_api.testing_checks import evaluate as evaluate_checks

    detail = (("Left", left), ("Right", right))
    [found] = evaluate_checks(
        [{"kind": kind, "left": {"label": "Left", "value": left, "file": -1},
          "right": {"label": "Right", "value": right, "file": -1}}],
        [], detail,
    )  # fmt: skip
    return found


def test_equal_and_different_leave_mixed_dates_and_units_open() -> None:
    """Review B1 (audit invariants I6, I10; 20 November 2026). Before, equal and different
    read a date alone against a time on the same day, an aware time against a naive one,
    and "100%" against "100" as not the same, so a different check held and supported a
    pass and an equal check failed and turned a pass into an exception. Now each is open,
    as on or before already was; a date alone against a date alone still compares."""
    for left, right in (
        ("2027-03-15", "2027-03-15T10:00"),
        ("2027-03-15T10:00Z", "2027-03-15T10:00"),
        ("2027-03-15T10:00+01:00", "2027-03-15T10:00Z"),
        ("100%", "100"),
    ):
        for kind in ("equal", "different"):
            found = _population_check(kind, left, right)
            assert found.left.verified and found.right.verified
            assert found.holds is None, (kind, left, right)
    assert _population_check("equal", "2027-03-15", "2027-03-15").holds is True
    assert _population_check("different", "2027-03-14", "2027-03-15T10:00").holds is True
    assert _population_check("equal", "100%", "100%").holds is True


def test_a_single_token_against_a_display_name_is_left_open() -> None:
    """Review B2 (audit invariants I6, I10; 20 November 2026). Before, an account with no
    digit, dot or underscore ("jsmith") read as different from a display name ("John
    Smith"), so a segregation-of-duties different check held and a pass stood. Now an
    account against a name is open, and a pass on it goes to a person."""
    from ai_workforce_api.testing_checks import apply as apply_checks

    for kind in ("equal", "different"):
        assert _population_check(kind, "jsmith", "John Smith").holds is None
        assert _population_check(kind, "John Smith", "jsmith").holds is None
    # Two accounts, or two names, are still told apart.
    assert _population_check("different", "jsmith", "mjones").holds is True
    assert _population_check("different", "John Smith", "Mary Jones").holds is True
    kept = apply_checks(
        {"index": 0, "result": "PASS", "note": "The approver is not the requester."},
        [_population_check("different", "jsmith", "John Smith")],
    )
    assert kept["result"] != "PASS"


def test_a_negated_passage_verifies_no_side() -> None:
    """Review B3 (audit invariants I6, I10; 20 November 2026). Before, a side quoting
    "approved by Elena Rossi", or "not approved by Elena Rossi", of "Change 42 was not
    approved by Elena Rossi" was verified, and its comparison could support a pass. Now a
    negated passage verifies nothing; one that is not negated still does."""
    from ai_workforce_api.testing_checks import evaluate as evaluate_checks

    texts = [("ticket.txt", "Change 42 was not approved by Elena Rossi.\n"
                            "Change 43 approved by Mark Lee.\nRequested by jdoe.")]  # fmt: skip
    requester = {"label": "Requester", "value": "jdoe", "file": 0, "quote": "Requested by jdoe"}
    for quote, value in (("approved by Elena Rossi", "Elena Rossi"),
                         ("not approved by Elena Rossi", "Elena Rossi"),
                         ("Elena Rossi", "Elena Rossi"),
                         ("approved by Mark Lee", "Mark Lee")):  # fmt: skip
        [found] = evaluate_checks(
            [{"kind": "different", "left": {"label": "Approver", "value": value, "file": 0,
                                            "quote": quote}, "right": requester}],
            texts, (),
        )  # fmt: skip
        assert found.left.verified is (value == "Mark Lee"), quote
        assert found.right.verified
