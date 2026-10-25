"""Library version 3 testing definitions (Milestone 8.8).

Each library attribute has a definition: when it applies, the evidence, what to compare,
and when it passes, fails, lacks evidence, or needs a person, with its source basis and
confidence. Every attribute of a standard enters an engagement approved with it (the firm
decides them in its library review, milestone L3e); a low or not-established one carries
its question, and testing waits for the client's value it depends on. These tests check the
structure and its plumbing, not the methodology, which a reviewer decides.
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

from ai_workforce_api.control_attributes import _write_list
from ai_workforce_api.control_context import Issue, raise_issues
from ai_workforce_api.control_design import open_values
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
    adopt_latest,
    library_update,
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
    assert len(LIBRARY) == len(DEFINITIONS) == 82
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
    # M3d: a note that holds no analysis ("?") makes the whole answer an execution failure
    # (test_reliability); a REVIEW with its reason stands.
    checked = check_results(
        {"results": [{"index": 0, "result": "REVIEW", "note": "Whether the approver had "
                      "authority is a judgment the definition leaves to a person."}]},
        1,
    )  # fmt: skip
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
    # The timeliness threshold is the client's. The firm decided the attribute in its library
    # review, so it arrives approved with its question; the plan does not decide it again.
    assert context["attributes"]["proposed"] == []
    timely = next(a for a in approved if a["definition"]["key"] == "ac02-timely")
    assert timely["definition"]["blocks"] and timely["source_kind"] == "LIBRARY"
    assert "days" in timely["note"] and "[" in timely["text"]
    criteria = _criteria(context)
    assert criteria["status"] == "BLOCKED"
    assert not any("Proposed by the library" in b["detail"] for b in criteria["blockers"])
    # Testing waits for the client's value it depends on, a slot of the statement (8.9).
    assert any("removal" in b["detail"] for b in criteria["blockers"])
    # A person enters the client's value once: the statement and the attribute both use it.
    filled = client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"removal-days": "5 business days"}},
    )
    assert filled.status_code == 200, filled.text
    context = filled.json()
    assert "within 5 business days of the termination date" in context["design"]["text"]
    answered = next(
        a for a in context["attributes"]["approved"] if a["definition"]["key"] == "ac02-timely"
    )
    assert answered["text"] == (
        "Access was removed within 5 business days of the HR termination date"
    )
    assert _criteria(_context(client, team, leavers))["status"] == "OK"
    # An optional library attribute is approved with the standard too; one still showing a
    # client value in brackets holds testing until that value is entered, and the plan
    # review asks for it.
    incidents = _control_id(migrated, team, "ITGC-OP-04")
    context = _context(client, team, incidents)
    assert context["attributes"]["proposed"] == []
    keys = {(a["definition"] or {}).get("key") for a in context["attributes"]["approved"]}
    assert {"op04-priority", "op04-root-cause"} <= keys
    assert _criteria(context)["status"] == "OK"
    reviews = _control_id(migrated, team, "ITGC-AC-03")
    context = _context(client, team, reviews)
    deadline = next(
        a
        for a in context["attributes"]["approved"]
        if (a["definition"] or {}).get("key") == "ac03-deadline"
    )
    assert "[the deadline in the access review procedure]" in deadline["text"]
    (blocker,) = _criteria(context)["blockers"]
    assert "the deadline in the access review procedure" in blocker["detail"]
    slot = next(s for s in context["design"]["slots"] if "deadline" in s["label"])
    assert slot["blocks"]
    with connect(migrated.url) as connection:
        asked = [value.key for value in open_values(connection, UUID(reviews))]
    assert slot["key"] in asked
    filled = client.put(
        f"{_base(team)}/controls/{reviews}/values",
        json={"values": {slot["key"]: "30 days after quarter end"}},
    )
    assert filled.status_code == 200, filled.text
    deadline = next(
        a
        for a in filled.json()["attributes"]["approved"]
        if (a["definition"] or {}).get("key") == "ac03-deadline"
    )
    assert "30 days after quarter end" in deadline["text"] and "[" not in deadline["text"]
    assert _criteria(_context(client, team, reviews))["status"] == "OK"
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
        # Its attributes carry no definition keys: version 2 had none.
        cursor.execute(
            "UPDATE control_attributes SET definition_key = NULL WHERE engagement_control_id = %s",
            (control,),
        )
    context = _context(client, team, control)
    assert [a["text"] for a in context["attributes"]["approved"]] == list(before)
    assert context["testing"] is None
    # The latest version always applies (adopt_latest, with every deploy): the control
    # does not offer it to a person, and what it changes is shown by library_update.
    assert context["library_update"] is None
    with connect(migrated.url) as connection:
        update = library_update(connection, UUID(str(control))).model_dump(mode="json")
    # The leaver control's definition is version 4 (steps and an evidence suite).
    assert update["library_version"] == 2 and update["current_version"] == 4
    changes = {item["change"] for item in update["items"]}
    assert {"REWORD", "PROPOSE", "RETIRE"} <= changes
    retiring = next(item for item in update["items"] if item["change"] == "RETIRE")
    assert retiring["was"] == "The account shows no activity after the termination date"
    assert retiring["reason"]
    # The deploy adopts it; no person is asked.
    with connect(migrated.url) as connection:
        assert adopt_latest(connection, team["project"]).adopted == 1
    body = _context(client, team, control)
    assert body["library_update"] is None and body["testing"] is not None
    definition = definition_for("access-termination")
    assert definition is not None
    # The attribute that depends on the client is adopted approved with the rest, its
    # question kept as a note; nothing waits for a decision on the plan.
    approved = body["attributes"]["approved"]
    timely = next(a for a in approved if a["definition"]["key"] == "ac02-timely")
    assert [a["text"] for a in approved if a is not timely] == [
        item.text for item in definition.approved
    ]
    assert timely["note"].startswith("From the library standard; it depends on the client:")
    assert body["attributes"]["proposed"] == []
    history = {a["text"]: a["note"] for a in body["attributes"]["history"]}
    assert history[retiring["was"]].startswith("Retired by library v4:")
    with connect(migrated.url) as connection:
        assert adopt_latest(connection, team["project"]).adopted == 0
        row = connection.execute(
            "SELECT count(*), count(actor_user_id) FROM audit_events "
            "WHERE action = 'control.library_adopted' AND target_id = %s",
            (control,),
        ).fetchone()
    # Adopted once, as the library's adoption, not a person's.
    assert row == (1, 0)


def test_migration_0085_approves_open_library_proposals_into_the_attribute_list(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "defs-0085", settle=False)
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    # As an engagement launched before L3e has it: the timeliness attribute still a
    # proposal, and not on the control's attribute list.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE control_attributes SET status = 'PROPOSED', proposal = 'ADD', "
            "decided_at = NULL, note = 'Library v3, low confidence: How many days?' "
            "WHERE engagement_control_id = %s AND definition_key = 'ac02-timely'",
            (leavers,),
        )
        _write_list(cursor, UUID(leavers))
    before = _context(client, team, leavers)["attributes"]
    assert [a["definition"]["key"] for a in before["proposed"]] == ["ac02-timely"]
    script = ROOT / "migrations" / "0085_library_attributes_approved.sql"
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(script.read_text(encoding="utf-8"))
        (listed,) = cursor.execute(
            "SELECT test_attributes FROM engagement_controls WHERE id = %s", (leavers,)
        ).fetchone() or (None,)
    after = _context(client, team, leavers)["attributes"]
    assert after["proposed"] == []
    timely = next(a for a in after["approved"] if a["definition"]["key"] == "ac02-timely")
    assert timely["note"] == (
        "From the library standard (approved by migration 0085); it depends on the client: "
        "How many days?"
    )
    # The control's attribute list carries it, so the trigger does not retire it later.
    assert listed == [a["text"] for a in after["approved"]]
    assert timely["text"] in listed


def test_a_copy_of_a_library_attribute_is_that_attribute_not_a_second_one(
    migrated: Database,
) -> None:
    definition = definition_for("access-termination")
    assert definition is not None
    # A person typed the value in place of the bracket, however spaced.
    for typed in (
        "Access was removed within5 days of the HR termination date",
        "access was removed within 5 business days of the HR termination date",
    ):
        found = definition.filled_from(typed)
        assert found is not None and found.key == "ac02-timely"
    assert definition.filled_from("Access was removed of the HR termination date") is None
    assert definition.filled_from("The leaver's access was removed") is None
    team, client, _scheduler = _engagement(migrated, "defs-copies", settle=False)
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    filled = client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"removal-days": "5 business days"}},
    )
    assert filled.status_code == 200, filled.text
    worded = "Access was removed within 5 business days of the HR termination date"

    def timely() -> list[tuple[str, str | None, str, str]]:
        with connect(migrated.url) as connection:
            return [
                (str(r[0]), r[1], str(r[2]), str(r[3]))
                for r in connection.execute(
                    "SELECT status, definition_key, text, note FROM control_attributes "
                    "WHERE engagement_control_id = %s AND text ILIKE 'Access was removed within%%' "
                    "ORDER BY created_at",
                    (leavers,),
                ).fetchall()
            ]

    def copy(text: str) -> int:
        """As a copy of the control carries it: approved, without its link. Then linked."""
        with connect(migrated.url) as connection, transaction(connection) as cursor:
            cursor.execute(
                "INSERT INTO control_attributes (organization_id, project_id, "
                "engagement_control_id, position, text, status, basis, source_kind, decided_at) "
                "SELECT organization_id, project_id, id, 9, %s, 'APPROVED', 'DOCUMENTED', "
                "'LIBRARY', clock_timestamp() FROM engagement_controls WHERE id = %s",
                (text, leavers),
            )
            _write_list(cursor, UUID(leavers))
            return link_definitions(cursor, UUID(leavers), None)

    # Beside the library's own: the copy is retired, the library's kept with the value.
    assert copy("Access was removed within5 days of the HR termination date") == 1
    rows = timely()
    assert [(r[1], r[2]) for r in rows if r[0] == "APPROVED"] == [("ac02-timely", worded)]
    retired = next(r for r in rows if "within5" in r[2])
    assert retired[0] == "RETIRED" and retired[3].startswith("Repeats the library standard")
    # Alone (the library's was retired): the copy becomes the library's attribute, worded
    # with the client's recorded value, and nothing is added beside it.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE control_attributes SET status = 'RETIRED' WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND definition_key = 'ac02-timely'",
            (leavers,),
        )
        _write_list(cursor, UUID(leavers))
    assert copy("Access was removed within 7 days of the HR termination date") == 1
    assert [(r[1], r[2]) for r in timely() if r[0] == "APPROVED"] == [("ac02-timely", worded)]
    listed = _context(client, team, leavers)["attributes"]["approved"]
    assert [a["text"] for a in listed].count(worded) == 1
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        assert link_definitions(cursor, UUID(leavers), None) == 0


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


def test_the_latest_library_version_applies_except_where_the_engagement_is_closed(
    migrated: Database,
) -> None:
    """The deploy adopts the latest library version on every open engagement; nobody is
    asked. An archived engagement is read-only and keeps the versions it closed with."""
    team, client, _scheduler = _engagement(migrated, "defs-latest")
    control = _control_id(migrated, team, "ITGC-AC-02")
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE engagement_controls SET library_version = 2 WHERE id = %s", (control,)
        )
        cursor.execute("UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (team["project"],))
    with connect(migrated.url) as connection:
        assert adopt_latest(connection, team["project"]).adopted == 0
        version = connection.execute(
            "SELECT library_version FROM engagement_controls WHERE id = %s", (control,)
        ).fetchone()
    assert version == (2,)
    assert _context(client, team, control)["library_update"] is None
