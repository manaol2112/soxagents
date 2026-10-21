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
            {"index": 0, "result": "PASS", "observed": "Minimum length 12"},
            {"index": 1, "result": "NOT_DETERMINABLE", "observed": "Lockout not shown"},
        ]
    }
    files = (ItemFile("settings.png", "configuration", "", review),)
    results = from_reviews(files, 2)
    assert results is not None
    assert [item["result"] for item in results] == ["PASS", "UNABLE"]
    assert results[0]["note"] == "settings.png: Minimum length 12"
    # Without a review for every file, or for every attribute, the tester tests it.
    assert from_reviews((*files, ItemFile("policy.pdf", "policy", "text", None)), 2) is None
    assert from_reviews(files, 3) is None


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
    from ai_workforce_api.evidence_apps import Application, model_tag, rules_tag

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
    assert tags == {
        "PWD-01_AD_settings.csv": ("ONE", "Microsoft Active Directory"),
        "PWD-04_Oracle_DB_profiles.csv": ("ONE", "Oracle Database"),
        "notes.csv": ("UNKNOWN", None),
    }
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
