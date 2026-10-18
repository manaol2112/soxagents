"""Library version 3 testing definitions (Milestone 8.8).

Each library attribute has a definition: when it applies, the evidence, what to compare,
and when it passes, fails, lacks evidence, or needs a person, with its source basis and
confidence. High and moderate attributes are tested; low and not-established ones are
proposed with their question. These tests check the structure and its plumbing, not the
methodology, which a reviewer decides.
"""

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient
from support import Database
from test_evidence_intake import _accept_population, _engagement, _request
from test_outbound import migrated
from test_testing_engine import _add, _answer, _base, _Citing, _read_all, _sheet, _year

from ai_workforce_api.control_context import Issue, raise_issues
from ai_workforce_api.controls import LIBRARY, SAMPLE_SIZES
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.definition_registry import (
    DEFINITIONS,
    definition_for,
    markdown,
    problems,
    v2_attributes,
)
from ai_workforce_api.library_definitions import (
    link_definitions,
    retire_dropped_design_questions,
)
from ai_workforce_api.testing_definitions import FREQUENCY_SAMPLES, SOURCES, TESTED
from ai_workforce_api.testing_engine import (
    SYSTEM_PROMPT,
    TEST_SCHEMA,
    ItemContext,
    ItemFile,
    ItemView,
    check_results,
    conclusion,
    definition_prompt,
    prompt_for,
    run_sheet,
)

__all__ = ["migrated"]

ROOT = Path(__file__).resolve().parents[3]


# The definitions


def test_the_definitions_pass_their_structural_checks() -> None:
    assert problems(v2_attributes()) == []
    for definition in DEFINITIONS:
        for item in definition.attributes:
            assert item.basis and all(ref in SOURCES for ref in item.basis), item.key
            if item.confidence not in TESTED:
                assert item.question, f"{item.key} is proposed without its question"
        for procedure in definition.procedures:
            known = {item.key for item in definition.attributes}
            assert set(procedure.attributes) <= known, procedure.key


def test_the_library_tests_only_high_and_moderate_attributes() -> None:
    assert len(LIBRARY) == len(DEFINITIONS) == 53
    for control in LIBRARY:
        definition = definition_for(control.key)
        assert definition is not None, control.key
        assert control.test_attributes == tuple(item.text for item in definition.approved)
        proposed = {item.text for item in definition.proposed}
        assert not proposed & set(control.test_attributes), control.key


def test_every_version_2_attribute_is_kept_reworded_or_retired_with_its_reason() -> None:
    for key, before in v2_attributes().items():
        definition = definition_for(key)
        assert definition is not None
        texts = {item.text for item in definition.attributes}
        was = {item.was for item in definition.attributes}
        retired = {item.text: item.reason for item in definition.retired}
        for text in before:
            assert text in texts or text in was or retired.get(text), (key, text)


def test_the_sample_table_is_the_engines_table_and_labelled_as_firm_methodology() -> None:
    assert {key: str(size) for key, size in SAMPLE_SIZES.items()} == FREQUENCY_SAMPLES
    sampled = [d for d in DEFINITIONS if d.sampling.startswith("Firm methodology table")]
    assert sampled and all("not a PCAOB requirement" in d.sampling for d in sampled)


def test_a_review_waits_for_its_precision_and_a_core_approval_is_tested() -> None:
    precision = [
        item
        for d in DEFINITIONS
        for item in d.attributes
        if "[the threshold or criteria for investigation" in item.text
    ]
    assert len(precision) >= 7
    assert all(item.blocks and item.confidence == "LOW" for item in precision)
    # The credit memo approval itself is tested; only the matrix level waits for an answer.
    memo = definition_for("otc-credit-memos")
    assert memo is not None
    before, level = memo.attribute("otc04-before"), memo.attribute("otc04-level")
    assert before is not None and before.confidence == "HIGH"
    assert level is not None and level.blocks and level.confidence == "LOW"


def test_the_published_definitions_are_the_generated_ones() -> None:
    published = (ROOT / "docs" / "testing-definitions.md").read_text(encoding="utf-8")
    assert published.replace("\r\n", "\n") == markdown(v2_attributes())
    assert "draft for professional review" in published
    for definition in DEFINITIONS:
        assert f"### {definition.control_ref}" in published


# The tester


def test_the_tester_reads_each_definition_and_can_ask_a_person() -> None:
    definition = definition_for("access-provisioning")
    assert definition is not None
    first = definition.approved[0]
    context = ItemContext(
        control_ref="ITGC-AC-01",
        title="New user access is approved",
        activity="Access is approved before it is granted.",
        frequency="event-driven",
        nature="manual",
        period="the audit period ending 31 December 2027",
        attributes=(first.text, "A client attribute with no definition"),
        item_label="u0002",
        item_detail=(("User ID", "u0002"),),
        test_of_one=False,
        files=(ItemFile("ticket.txt", "sample", "u0002 approved 2027-03-01", None),),
        definitions=(definition_prompt(first), None),
    )
    prompt = prompt_for(context)
    facts = prompt.split("<control_and_item>\n", 1)[1].split("\n</control_and_item>", 1)[0]
    shown = json.loads(facts)["attributes"]
    assert shown[0]["definition"]["pass_when"] == first.passes
    assert shown[0]["definition"]["do_not_infer"] == first.not_infer
    assert "definition" not in shown[1]
    assert "REVIEW (human review required)" in SYSTEM_PROMPT
    assert "Missing evidence is never an EXCEPTION" in SYSTEM_PROMPT
    assert "A document being present is not a pass" in SYSTEM_PROMPT
    schema = TEST_SCHEMA["properties"]["results"]["items"]["properties"]["result"]
    assert "REVIEW" in schema["enum"]
    checked = check_results({"results": [{"index": 0, "result": "REVIEW", "note": "?"}]}, 1)
    assert checked[0]["result"] == "REVIEW"


def test_human_review_leaves_the_conclusion_to_a_person() -> None:
    done = ItemView(has_evidence=True, tested=True, final=("PASS", "PASS"))
    review = ItemView(has_evidence=True, tested=True, final=("REVIEW", "PASS"))
    failed = ItemView(has_evidence=True, tested=True, final=("EXCEPTION", "PASS"))
    assert conclusion([done, review]) == "INCOMPLETE"
    assert conclusion([failed, review]) == "INCOMPLETE"
    assert conclusion([done, failed]) == "NOT_EFFECTIVE"


# In an engagement


def _control_id(database: Database, team: dict[str, Any], ref: str) -> str:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND control_ref = %s",
            (team["project"], ref),
        ).fetchone()
    assert row is not None
    return str(row[0])


def _context(client: TestClient, team: dict[str, Any], control_id: str) -> dict[str, Any]:
    found = client.get(f"{_base(team)}/controls/{control_id}/context")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return body


def _criteria(context: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = next(
        c for c in context["readiness"]["checks"] if c["key"] == "criteria"
    )
    return found


def test_kickoff_links_definitions_and_waits_for_the_answers_testing_needs(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "defs-kickoff", settle=False)
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    context = _context(client, team, leavers)
    approved = context["attributes"]["approved"]
    assert approved and all(a["definition"] is not None for a in approved)
    assert approved[0]["definition"]["key"] == "ac02-removed"
    assert approved[0]["definition"]["confidence"] == "HIGH"
    assert context["testing"]["procedures"] and context["library_update"] is None
    # The timeliness threshold is the client's: proposed with its question, not tested.
    (timely,) = context["attributes"]["proposed"]
    assert timely["definition"]["key"] == "ac02-timely" and timely["definition"]["blocks"]
    assert "days" in timely["note"] and timely["source_kind"] == "LIBRARY"
    assert timely["text"] not in [a["text"] for a in approved]
    criteria = _criteria(context)
    assert criteria["status"] == "BLOCKED"
    assert any("Proposed by the library" in b["detail"] for b in criteria["blockers"])
    # The same value is a slot in the control's statement (8.9): testing waits for it too.
    assert any("removal" in b["detail"] for b in criteria["blockers"])
    # A person enters the client's value once: the statement and the proposal both use it.
    filled = client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"removal-days": "5 business days"}},
    )
    assert filled.status_code == 200, filled.text
    context = filled.json()
    assert "within 5 business days of the termination date" in context["design"]["text"]
    (timely,) = context["attributes"]["proposed"]
    assert timely["text"] == (
        "Access was removed within 5 business days of the HR termination date"
    )
    # Approving it as worded: the definition stays with the attribute.
    decided = client.post(
        f"{_base(team)}/controls/{leavers}/attributes/{timely['id']}/decide",
        json={"decision": "APPROVE", "version": timely["version"]},
    )
    assert decided.status_code == 200, decided.text
    context = _context(client, team, leavers)
    answered = context["attributes"]["approved"][-1]
    assert answered["definition"]["key"] == "ac02-timely"
    assert _criteria(context)["status"] == "OK"
    # An optional proposal does not hold testing; rejecting it is final.
    incidents = _control_id(migrated, team, "ITGC-OP-04")
    context = _context(client, team, incidents)
    assert _criteria(context)["status"] == "WARN"
    assert "optional" in _criteria(context)["summary"]
    for proposal in context["attributes"]["proposed"]:
        rejected = client.post(
            f"{_base(team)}/controls/{incidents}/attributes/{proposal['id']}/decide",
            json={"decision": "REJECT", "version": proposal["version"]},
        )
        assert rejected.status_code == 200, rejected.text
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        assert link_definitions(cursor, UUID(incidents), None) == 0
        assert link_definitions(cursor, UUID(leavers), None) == 0
    assert _context(client, team, incidents)["attributes"]["proposed"] == []
    # Password settings are the configuration. The old version label is not a question,
    # and one left open from before does not hold the plan.
    passwords = _control_id(migrated, team, "ITGC-AC-05")
    assert not any(
        issue["topic"] == "Control design to confirm" and issue["status"] == "OPEN"
        for issue in _context(client, team, passwords)["issues"]
    )
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        row = cursor.execute(
            "SELECT organization_id, project_id FROM engagement_controls WHERE id = %s",
            (passwords,),
        ).fetchone()
        assert row is not None
        raise_issues(
            cursor,
            row[0],
            row[1],
            UUID(passwords),
            [
                Issue(
                    origin="ATTRIBUTES",
                    kind="AMBIGUOUS",
                    topic="Control design to confirm",
                    detail="Version 2 labelled this control 'annual, automated'.",
                    why="Library history.",
                    resolve="Confirm the design.",
                )
            ],
            "RULES",
        )
        retire_dropped_design_questions(cursor, [UUID(passwords)])
    settled = [
        issue
        for issue in _context(client, team, passwords)["issues"]
        if issue["topic"] == "Control design to confirm"
    ]
    assert settled and all(issue["status"] == "RESOLVED" for issue in settled)
    assert "configuration" in settled[0]["resolution_note"].lower()
    # A control whose design does not fit together waits for a person to confirm it.
    hosted = _context(client, team, _control_id(migrated, team, "ITGC-OP-05"))
    assert any(i["topic"] == "Control design to confirm" for i in hosted["issues"])
    assert _criteria(hosted)["status"] == "BLOCKED"


def test_a_control_copied_from_version_2_adopts_version_3_when_a_person_chooses(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "defs-adopt")
    control = _control_id(migrated, team, "ITGC-AC-02")
    before = v2_attributes()["access-termination"]
    # As an engagement launched before version 3 has it.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE engagement_controls SET library_version = 2, test_attributes = %s "
            "WHERE id = %s",
            (json.dumps(list(before)), control),
        )
    context = _context(client, team, control)
    assert [a["text"] for a in context["attributes"]["approved"]] == list(before)
    assert context["testing"] is None
    update = context["library_update"]
    assert update["library_version"] == 2 and update["current_version"] == 3
    changes = {item["change"] for item in update["items"]}
    assert {"REWORD", "PROPOSE", "RETIRE"} <= changes
    retiring = next(item for item in update["items"] if item["change"] == "RETIRE")
    assert retiring["was"] == "The account shows no activity after the termination date"
    assert retiring["reason"]
    # A person adopts it.
    adopted = client.post(f"{_base(team)}/controls/{control}/library-update/adopt")
    assert adopted.status_code == 200, adopted.text
    body = adopted.json()
    assert body["library_update"] is None and body["testing"] is not None
    definition = definition_for("access-termination")
    assert definition is not None
    assert [a["text"] for a in body["attributes"]["approved"]] == [
        item.text for item in definition.approved
    ]
    # The proposal already raised at kickoff is not proposed twice.
    keys = [a["definition"]["key"] for a in body["attributes"]["proposed"]]
    assert keys == ["ac02-timely"]
    history = {a["text"]: a["note"] for a in body["attributes"]["history"]}
    assert history[retiring["was"]].startswith("Retired by library v3:")
    again = client.post(f"{_base(team)}/controls/{control}/library-update/adopt")
    assert again.status_code == 409
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'control.library_adopted' "
            "AND target_id = %s",
            (control,),
        ).fetchone()
    assert row == (1,)


def test_a_result_needing_human_review_holds_sign_off_until_a_person_decides(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "defs-review")
    base = _base(team)
    year = _year(migrated, team)
    population = "User ID,Name,Date granted,Ticket\n" + "".join(
        f"u000{n},Demo User {n},{year}-0{n}-10,REQ-{n}\n" for n in range(1, 4)
    )
    kickoff = _request(migrated, team, "ITGC-AC-01")
    _add(client, team, "access population.csv", population, kickoff["id"])
    _read_all(migrated, scheduler)
    plan = client.get(f"{base}/control-tests").json()[0]
    _accept_population(client, team, plan["engagement_control_id"])
    approved = client.post(
        f"{base}/control-tests/{plan['id']}/approve", json={"version": plan["version"]}
    )
    assert approved.status_code == 200, approved.text
    sheet = _sheet(client, team)
    labels = [item["label"] for item in sheet["items"]]
    samples = approved.json()["sample_request_id"]
    for label in labels:
        _add(client, team, f"{label} ticket.txt", f"{label} approved by Demo Manager.", samples)
    _read_all(migrated, scheduler)
    attributes = len(sheet["attributes"])
    provider = _Citing(
        [
            _answer(["PASS"] * attributes),
            _answer(["PASS"] * attributes),
            _answer(["REVIEW"] + ["PASS"] * (attributes - 1)),
        ]
    )
    with connect(migrated.url) as connection:
        assert run_sheet(connection, provider, UUID(sheet["id"])) == "DONE"
    # The tester was given each attribute's definition.
    assert '"pass_when"' in provider.requests[0].prompt
    sheet = _sheet(client, team)
    assert sheet["counts"]["review"] == 1 and sheet["counts"]["unable"] == 0
    assert sheet["proposed_conclusion"] == "INCOMPLETE"
    assert "1 result needs human review: a person decides" in sheet["blocking"]
    path = f"{base}/test-sheets/{sheet['id']}"
    blocked = client.post(f"{path}/sign-off", json={"version": sheet["version"]})
    assert blocked.status_code == 409
    # After follow-up the item still cannot be tested: a person records it as a deviation
    # (AS 2315.40). The agent never does.
    item = next(i for i in sheet["items"] if i["cells"][0]["proposed"] == "REVIEW")
    decided = client.post(
        f"{path}/items/{item['id']}/override",
        json={
            "version": item["version"],
            "index": 0,
            "result": "EXCEPTION",
            "reason": "No approval was provided after two follow-ups; treated as a deviation.",
        },
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["proposed_conclusion"] == "NOT_EFFECTIVE"
