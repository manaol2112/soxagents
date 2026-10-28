"""The process narrative drafted and reviewed in the background (decided by the product owner
on 26 October 2026): fixed sections that explain every attribute, a reviewer agent recorded
apart from the drafter that fixes the draft for up to two rounds, the facts only the client
can give asked as questions instead of written into the narrative, and approval after a clean
review of the narrative as it stands, or with a person's written reason.
"""

from typing import Any
from uuid import UUID

from support import Database
from test_control_context import _context, _control, _new_control
from test_evidence_analysis import _Provider
from test_evidence_intake import _client, _engagement, _Scheduler
from test_outbound import migrated
from test_testing_engine import _base

from ai_workforce_api.db import connect
from ai_workforce_api.process_narrative import (
    DRAFT_TOKENS,
    REVIEW_TOKENS,
    open_runs,
    request,
    rules_findings,
    run_narrative,
)
from ai_workforce_api.process_understanding import SECTIONS, ReviewBody, Section, Step

__all__ = ["migrated"]

KEYS = [key for key, _heading in SECTIONS]


def _codes(migrated: Database, control_id: str) -> list[str]:
    with connect(migrated.url) as connection:
        return [
            str(row[0])
            for row in connection.execute(
                "SELECT code FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'APPROVED' AND code IS NOT NULL ORDER BY position, created_at",
                (control_id,),
            ).fetchall()
        ]


def _sections(codes: list[str], gap: bool = False) -> list[dict[str, Any]]:
    texts = {
        "PURPOSE": "The control makes sure only approved access is granted.",
        "INITIATION": "The requester raises an access request in ServiceNow.",
        "APPROVAL": "The user's manager approves the request in ServiceNow.",
        "EXECUTION": "The IT service desk administrator grants the approved access.",
        "RECORDING": "ServiceNow keeps the request, the approval and the grant date.",
        "EXCEPTIONS": "A request without approval is returned to the requester.",
        "MONITORING": "The IT Security Manager reviews provisioning each month.",
    }
    if gap:
        texts["MONITORING"] = "The sources do not say who monitors provisioning."
    return [
        {"key": key, "text": texts[key], "attributes": codes if key == "APPROVAL" else []}
        for key in KEYS
    ]


def _steps(codes: list[str]) -> list[dict[str, Any]]:
    return [
        {"description": "The requester raises the request in ServiceNow.", "actor": "Requester",
         "system": "ServiceNow", "control_point": False, "basis": "INFERRED", "source": "",
         "quote": "", "attributes": []},
        {"description": "The manager approves the request.", "actor": "Manager",
         "system": "ServiceNow", "control_point": True, "basis": "INFERRED", "source": "",
         "quote": "", "attributes": codes},
    ]  # fmt: skip


def _question() -> dict[str, Any]:
    return {
        "topic": "Exception route",
        "question": "What happens to an access request that is rejected?",
        "why": "The narrative explains how exceptions are handled.",
        "suggestions": ["Returned to the requester", "Closed in ServiceNow"],
    }


def _run(migrated: Database, provider: Any, control_id: str) -> str:
    with connect(migrated.url) as connection:
        return run_narrative(connection, provider, UUID(control_id))


def _ask(migrated: Database, team: dict[str, Any], control_id: str, mode: str = "DRAFT") -> bool:
    with connect(migrated.url) as connection:
        return request(
            connection, UUID(str(team["org"])), UUID(str(team["project"])), UUID(control_id),
            UUID(str(team["owner_id"])), mode,  # type: ignore[arg-type]
        )  # fmt: skip


def test_the_reviewer_fixes_the_draft_and_the_gaps_become_questions(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-review")
    cid = _control(client, team, "ITGC-AC-02")["id"]
    codes = _codes(migrated, cid)
    assert len(codes) >= 2
    # The drafter leaves an attribute out, comments on a gap, and asks one question.
    draft = {
        "sections": _sections(codes[:1], gap=True),
        "steps": _steps(codes[:1]),
        "questions": [_question()],
    }
    # The reviewer finds both, rewrites the narrative, and passes it.
    review = {
        "passed": True,
        "coverage": [{"code": code, "covered": True, "note": ""} for code in codes],
        # What it corrected is reported apart from what still falls short (none here).
        "findings": [],
        "fixes": [f"{codes[1]} was not explained; it is now.", "Gap commentary removed."],
        "revised": True,
        "sections": _sections(codes),
        "steps": _steps(codes),
        "questions": [],
    }
    assert _ask(migrated, team, cid)
    with connect(migrated.url) as connection:
        assert UUID(cid) in open_runs(connection)
    provider = _Provider([draft, review])
    assert _run(migrated, provider, cid) == "REVIEWED"
    # Drafted by the planner, reviewed by the independent reviewer: two agents on record.
    with connect(migrated.url) as connection:
        agents = [
            str(row[0])
            for row in connection.execute(
                "SELECT agent_key FROM model_calls WHERE project_id = %s "
                "AND prompt_version LIKE 'process-narrative%%' ORDER BY created_at",
                (team["project"],),
            ).fetchall()
        ]
    assert agents == ["engagement-planner", "independent-reviewer"]
    # The reviewer sees what the drafter already asked, so it does not ask it again.
    assert '"questions_for_the_client"' in provider.requests[1].prompt
    assert "What happens to an access request that is rejected?" in provider.requests[1].prompt
    context = _context(client, team, cid)
    understanding = context["understanding"]
    # The narrative is the reviewer's: every section, in order, every attribute explained.
    assert [s["key"] for s in understanding["sections"]] == KEYS
    assert "do not say" not in understanding["summary"]
    assert understanding["summary"].startswith("Purpose and scope\n")
    review_body = understanding["review"]
    # The drafter's question stays open, so the review does not pass yet.
    assert review_body["passed"] is False and review_body["reviewer"] == "AGENT"
    assert review_body["rounds"] == 1 and review_body["version"] == understanding["version"]
    # Held only by the client's fact: the reviewer's corrections are not findings.
    assert (review_body["findings"], review_body["questions"]) == ([], 1)
    assert review_body["fixes"] == [f"{codes[1]} was not explained; it is now.",
                                    "Gap commentary removed."]  # fmt: skip
    assert {c["code"]: c["sections"] for c in review_body["coverage"]} == {
        code: ["APPROVAL"] for code in codes
    }
    assert understanding["run"]["status"] == "IDLE"
    [question] = [i for i in context["issues"] if i["status"] == "OPEN" and i["question"]]
    assert question["question"] == "What happens to an access request that is rejected?"
    assert question["suggestions"] == ["Returned to the requester", "Closed in ServiceNow"]
    # Regression (26 October 2026): reviewed again before the client answers, a reviewer
    # that asks nothing more neither drops the waiting question nor passes the narrative.
    assert _ask(migrated, team, cid, "REVIEW")
    again = _Provider([{**review, "fixes": [], "revised": False, "sections": [], "steps": []}])
    assert _run(migrated, again, cid) == "REVIEWED"
    assert "What happens to an access request that is rejected?" in again.requests[0].prompt
    still = _context(client, team, cid)
    [waiting] = [i for i in still["issues"] if i["status"] == "OPEN" and i["question"]]
    assert (waiting["id"], waiting["version"]) == (question["id"], question["version"])
    assert still["understanding"]["review"]["passed"] is False
    assert still["understanding"]["review"]["questions"] == 1
    # The client answers; the narrative is drafted again from it and passes review.
    answered = client.post(
        f"{_base(team)}/controls/{cid}/issues/{question['id']}/resolve",
        json={"status": "RESOLVED", "note": "Returned to the requester", "version": 1},
    )
    assert answered.status_code == 200, answered.text
    assert _ask(migrated, team, cid)
    clean = {**review, "findings": [], "revised": False, "sections": [], "steps": []}
    second = _Provider(
        [{"sections": _sections(codes), "steps": _steps(codes), "questions": []}, clean]
    )
    assert _run(migrated, second, cid) == "PASSED"
    # The client's answer reached the drafter.
    assert "Returned to the requester" in second.requests[0].prompt
    passed = _context(client, team, cid)["understanding"]
    assert passed["review"]["passed"] is True
    approved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={
            "sections": passed["sections"],
            "steps": passed["steps"],
            "version": passed["version"],
            "confirm": True,
        },
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["understanding"]["status"] == "CONFIRMED"
    # The approval records that the review stood for the narrative as approved.
    assert _approval(migrated, cid)["review_passed"] is True
    # Regression (26 October 2026): approving saved a new version, so the review read as
    # "changed since the review" though nothing changed. It stays with the new version.
    after = approved.json()["understanding"]
    assert after["review"]["version"] == after["version"] == passed["version"] + 1
    # A real edit still leaves the review behind.
    edited = [{**s, "text": s["text"] + " Edited."} for s in after["sections"]]
    saved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"sections": edited, "steps": after["steps"], "version": after["version"],
              "confirm": False},
    )  # fmt: skip
    assert saved.status_code == 200, saved.text
    moved = saved.json()["understanding"]
    assert moved["review"]["version"] == after["version"] != moved["version"]


def _approval(migrated: Database, control_id: str) -> dict[str, Any]:
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'process.confirmed' "
            "AND target_id = %s ORDER BY created_at DESC LIMIT 1",
            (control_id,),
        ).fetchone()
    assert row is not None
    payload: dict[str, Any] = row[0]
    return payload


def test_without_a_model_the_rules_draft_but_never_pass_it(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-rules-review")
    control = _new_control(client, team, control_ref="REV-41", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    asked = client.post(f"{_base(team)}/controls/{cid}/process/narrate")
    assert asked.status_code == 200, asked.text
    assert asked.json()["understanding"]["run"]["status"] in ("PENDING", "WORKING", "IDLE")
    _run(migrated, None, cid)
    understanding = _context(client, team, cid)["understanding"]
    assert understanding["built_by"] == "RULES"
    assert [s["key"] for s in understanding["sections"]] == KEYS
    review = understanding["review"]
    assert review["passed"] is False and review["reviewer"] == "RULES"
    assert any("No model reviewed" in item for item in review["findings"])
    assert all(c["sections"] and c["steps"] for c in review["coverage"]), codes
    payload = {
        "sections": understanding["sections"],
        "steps": understanding["steps"],
        "version": understanding["version"],
        "confirm": True,
    }
    # Approving needs no reason (product owner, 26 October 2026); the record says the
    # narrative had not passed its review when it was approved.
    approved = client.put(f"{_base(team)}/controls/{cid}/process", json=payload)
    assert approved.status_code == 200, approved.text
    assert approved.json()["understanding"]["status"] == "CONFIRMED"
    record = _approval(migrated, cid)
    assert record["review_passed"] is False and "override_reason" not in record


def test_the_run_is_scheduled_only_once_it_is_committed(migrated: Database) -> None:
    """Regression (26 October 2026): scheduled inside the request's transaction, the local
    worker started before the run was committed, found nothing waiting and skipped it."""
    team, client, _scheduler = _engagement(migrated, "narrative-commit")
    control = _new_control(client, team, control_ref="REV-43", domain="ORDER_TO_CASH")
    cid = UUID(control["id"])
    seen: list[list[UUID]] = []

    class Worker(_Scheduler):
        def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
            del sheet_ids

        def schedule_narrative_runs(self, ids: list[UUID]) -> None:
            # What a worker on its own connection finds when it is handed the run.
            with connect(migrated.url) as connection:
                seen.append([i for i in open_runs(connection) if i in ids])

    client = _client(migrated, UUID(str(team["owner_id"])), Worker())
    for path in ("narrate", "review-narrative"):
        if seen:
            _run(migrated, None, str(cid))
        asked = client.post(f"{_base(team)}/controls/{cid}/process/{path}")
        assert asked.status_code == 200, asked.text
    assert seen == [[cid], [cid]]
    # A run already waiting is left to finish, and is not scheduled twice.
    again = client.post(f"{_base(team)}/controls/{cid}/process/review-narrative")
    assert again.status_code == 200, again.text
    assert len(seen) == 2


def test_a_review_the_agent_did_not_finish_is_flagged_to_run_again(migrated: Database) -> None:
    """Regression (26 October 2026): the reviewer's answer was cut off at the provider's
    default 4,096 tokens and rejected, and the box showed it as a point to resolve with no
    way forward. The calls now ask for room for the whole answer, and an unfinished review
    is flagged, not counted as a finding."""
    team, client, _scheduler = _engagement(migrated, "narrative-unfinished")
    control = _new_control(client, team, control_ref="REV-44", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    draft = {"sections": _sections(codes), "steps": _steps(codes), "questions": [_question()]}
    provider = _Provider([draft, None])
    assert _ask(migrated, team, cid)
    assert _run(migrated, provider, cid) == "REVIEWED"
    assert [r.max_tokens for r in provider.requests] == [DRAFT_TOKENS, REVIEW_TOKENS]
    review = _context(client, team, cid)["understanding"]["review"]
    assert (review["passed"], review["incomplete"], review["findings"]) == (False, True, [])
    assert review["questions"] == 1
    # A review stored before the flag reads the same way.
    legacy = ReviewBody.model_validate(
        {"passed": False, "reviewer": "AGENT", "rounds": 0, "version": 1,
         "findings": ["The reviewer agent could not complete its review.", "A2."]}
    )  # fmt: skip
    assert (legacy.incomplete, legacy.findings) == (True, ["A2."])


def _point(topic: str, codes: list[str], kind: str = "MISSING") -> dict[str, Any]:
    return {
        "topic": topic,
        "question": f"How is {topic.lower()} done?",
        "proposal": f"{topic} is recorded in ServiceNow by the role owner.",
        "why": "The narrative explains it.",
        "section": "RECORDING",
        "attributes": [codes[0], "Z9"],
        "kind": kind,
    }


def _open_points(client: Any, team: dict[str, Any], cid: str) -> list[dict[str, Any]]:
    issues = _context(client, team, cid)["issues"]
    return [i for i in issues if i["status"] == "OPEN" and i["question"]]


def _clean(passed: bool) -> dict[str, Any]:
    return {"passed": passed, "coverage": [], "findings": [], "fixes": [], "revised": False,
            "sections": [], "steps": [], "questions": []}  # fmt: skip


def _confirm(client: Any, team: dict[str, Any], cid: str, items: list[dict[str, Any]]) -> Any:
    return client.post(f"{_base(team)}/controls/{cid}/process/points", json={"items": items})


def test_points_come_in_one_round_then_only_contradictions(migrated: Database) -> None:
    """Decided by the product owner on 26 October 2026: the agents raise what they need at
    once, as statements to confirm; after one round only a contradiction may be raised, a
    topic is never asked twice, and after a second round nothing more."""
    team, client, _scheduler = _engagement(migrated, "narrative-points")
    control = _new_control(client, team, control_ref="REV-45", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    draft = {"sections": _sections(codes), "steps": _steps(codes)}
    # Round one: the points are stored as statements, with their section and codes.
    assert _ask(migrated, team, cid)
    first = _Provider([{**draft, "questions": [_point("Evidence of the check", codes)]},
                       _clean(True)])  # fmt: skip
    _run(migrated, first, cid)
    [point] = _open_points(client, team, cid)
    assert point["proposal"] == (
        "Evidence of the check is recorded in ServiceNow by the role owner."
    )
    assert (point["section"], point["attributes"], point["round"], point["point_kind"]) == (
        "RECORDING", [codes[0]], 1, "MISSING",
    )  # fmt: skip
    # The agents are told what they may raise.
    assert '"may_ask": "ALL"' in first.requests[0].prompt
    # The round is confirmed as one decision; the narrative is drafted again.
    confirmed = _confirm(client, team, cid, [
        {"issue_id": point["id"], "version": point["version"], "answer": point["proposal"]},
    ])  # fmt: skip
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["understanding"]["run"]["status"] == "PENDING"
    # Round two: a new missing fact and the same topic again are dropped; a contradiction
    # is raised.
    second = _Provider([
        {**draft, "questions": [
            _point("Evidence of the check", codes),
            _point("Retention of the listing", codes),
            _point("Approver of record", codes, "CONTRADICTION"),
        ]},
        _clean(False),
    ])  # fmt: skip
    _run(migrated, second, cid)
    assert '"may_ask": "CONTRADICTIONS"' in second.requests[0].prompt
    assert '"asked_topics": [' in second.requests[0].prompt
    [contradiction] = _open_points(client, team, cid)
    assert (contradiction["topic"], contradiction["round"], contradiction["point_kind"]) == (
        "Approver of record", 2, "CONTRADICTION",
    )  # fmt: skip
    confirmed = _confirm(client, team, cid, [
        {"issue_id": contradiction["id"], "version": contradiction["version"],
         "answer": "The user's manager approves in ServiceNow."},
    ])  # fmt: skip
    assert confirmed.status_code == 200, confirmed.text
    # After the second round nothing more is asked, and the review can pass on what is known.
    third = _Provider([
        {**draft, "questions": [_point("Monitoring of grants", codes, "CONTRADICTION")]},
        _clean(True),
    ])  # fmt: skip
    assert _run(migrated, third, cid) == "PASSED"
    assert '"may_ask": "NONE"' in third.requests[0].prompt
    assert _open_points(client, team, cid) == []


def test_a_round_is_confirmed_as_one_decision_or_not_at_all(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-confirm")
    control = _new_control(client, team, control_ref="REV-46", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    points = [_point("Evidence of the check", codes), _point("Retention of the listing", codes)]
    assert _ask(migrated, team, cid)
    drafted = {"sections": _sections(codes), "steps": _steps(codes), "questions": points}
    _run(migrated, _Provider([drafted, _clean(False)]), cid)
    first, second = _open_points(client, team, cid)
    # A stale version fails the whole round: nothing is recorded.
    stale = _confirm(client, team, cid, [
        {"issue_id": first["id"], "version": first["version"], "answer": "Yes."},
        {"issue_id": second["id"], "version": second["version"] + 1, "answer": "Yes."},
    ])  # fmt: skip
    assert stale.status_code == 409
    assert len(_open_points(client, team, cid)) == 2
    # A secret is never kept as an answer.
    secret = _confirm(client, team, cid, [
        {"issue_id": first["id"], "version": first["version"],
         "answer": "api_key=EXAMPLE-NOT-A-REAL-KEY"},
    ])  # fmt: skip
    assert secret.status_code in (400, 422)
    assert len(_open_points(client, team, cid)) == 2
    # Confirmed and corrected together: one is the statement, one the person's words.
    done = _confirm(client, team, cid, [
        {"issue_id": first["id"], "version": first["version"], "answer": first["proposal"]},
        {"issue_id": second["id"], "version": second["version"],
         "answer": "Kept in SharePoint for seven years."},
    ])  # fmt: skip
    assert done.status_code == 200, done.text
    assert _open_points(client, team, cid) == []
    with connect(migrated.url) as connection:
        audits = [
            row[0]
            for row in connection.execute(
                "SELECT payload FROM audit_events WHERE action = 'context.issue_resolved' "
                "AND target_id = ANY(%s) ORDER BY created_at",
                ([UUID(first["id"]), UUID(second["id"])],),
            ).fetchall()
        ]
        notes = dict(
            connection.execute(
                "SELECT id::text, resolution_note FROM control_context_issues WHERE id = ANY(%s)",
                ([UUID(first["id"]), UUID(second["id"])],),
            ).fetchall()
        )
        assert UUID(cid) in open_runs(connection)
    assert sorted(a["as_proposed"] for a in audits) == [False, True]
    assert notes[second["id"]] == "Kept in SharePoint for seven years."
    # The redraft records its progress while it works.
    redraft = {"sections": _sections(codes), "steps": _steps(codes), "questions": []}
    _run(migrated, _Provider([redraft, _clean(False)]), cid)
    run = _context(client, team, cid)["understanding"]["run"]
    assert run["started_at"] and run["stage_at"]
    assert run["progress"]["attributes"] == len(codes)
    assert run["progress"]["answers"] >= 2


class _Watching:
    """A model that, when called, looks at the run from another connection: what the page
    would see while the agent works."""

    def __init__(self, url: str, control_id: str, outputs: list[dict[str, Any]]) -> None:
        self.url, self.control_id, self.outputs = url, control_id, outputs
        self.seen: list[tuple[str, str]] = []
        self.requests: list[Any] = []

    def complete(self, request: Any, config: Any) -> Any:
        from ai_workforce_api.models import ModelRaw

        del config
        self.requests.append(request)
        with connect(self.url) as connection:
            row = connection.execute(
                "SELECT run_status, stage FROM process_narrative_runs "
                "WHERE engagement_control_id = %s",
                (self.control_id,),
            ).fetchone()
        assert row is not None
        self.seen.append((str(row[0]), str(row[1])))
        output = self.outputs[min(len(self.requests), len(self.outputs)) - 1]
        return ModelRaw(output, (), 800, 200)


def test_the_page_sees_each_stage_while_the_agents_work(migrated: Database) -> None:
    """Regression (26 October 2026): the run was one transaction, so its claim, stages and
    progress stayed invisible until it ended, and the page showed only "waiting"."""
    team, client, _scheduler = _engagement(migrated, "narrative-visible")
    control = _new_control(client, team, control_ref="REV-47", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    draft = {"sections": _sections(codes), "steps": _steps(codes), "questions": []}
    watching = _Watching(migrated.url, cid, [draft, _clean(True)])
    assert _ask(migrated, team, cid)
    _run(migrated, watching, cid)
    assert watching.seen == [("WORKING", "DRAFTING"), ("WORKING", "REVIEWING")]


def test_an_over_long_point_does_not_discard_the_draft(migrated: Database) -> None:
    """Regression (26 October 2026): one point longer than the limit rejected the whole
    drafted narrative, and the reviewed rules drafted it instead."""
    team, client, _scheduler = _engagement(migrated, "narrative-tidy")
    control = _new_control(client, team, control_ref="REV-48", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    long = ("The role owner signs the listing in ServiceNow. " * 12).strip()
    point = {**_point("Evidence of the check", codes), "proposal": long, "section": "BOGUS",
             "kind": "OTHER"}  # fmt: skip
    draft = {"sections": _sections(codes), "steps": _steps(codes), "questions": [point]}
    assert _ask(migrated, team, cid)
    _run(migrated, _Provider([draft, _clean(False)]), cid)
    assert _context(client, team, cid)["understanding"]["built_by"] == "AGENT"
    [kept] = _open_points(client, team, cid)
    assert len(kept["proposal"]) <= 400 and kept["proposal"].endswith("ServiceNow.")
    assert (kept["section"], kept["point_kind"]) == ("", "MISSING")


def test_every_point_arrives_with_a_statement_and_says_where_it_comes_from(
    migrated: Database,
) -> None:
    """Decided by the product owner on 27 October 2026 ("Agent should always be able to
    provide a suggestion based on the nature of the controls"): the agents always state an
    answer to confirm, from the records or as the usual practice, with other common answers
    to pick; a point asked open before is restated with a statement on the next run."""
    from ai_workforce_api.process_narrative import DRAFT_SCHEMA, DRAFTER_PROMPT

    # The agents are told to, and their answer's shape requires it.
    assert "Always give a proposal" in DRAFTER_PROMPT
    point_schema = DRAFT_SCHEMA["properties"]["questions"]["items"]
    assert {"proposal_basis", "suggestions"} <= set(point_schema["required"])
    team, client, _scheduler = _engagement(migrated, "narrative-basis")
    control = _new_control(client, team, control_ref="REV-50", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    draft = {"sections": _sections(codes), "steps": _steps(codes)}
    typical = {
        **_point("Evidence of the check", codes),
        "proposal_basis": "TYPICAL",
        "suggestions": ["A system-enforced workflow in ServiceNow", "A manual check"],
    }
    # A point raised before this change, asked open, with no statement.
    blank = {**_point("Retention of the listing", codes), "proposal": ""}
    assert _ask(migrated, team, cid)
    _run(migrated, _Provider([{**draft, "questions": [typical, blank]}, _clean(False)]), cid)
    stated, asked_open = _open_points(client, team, cid)
    assert (stated["proposal_basis"], stated["suggestions"]) == (
        "TYPICAL", ["A system-enforced workflow in ServiceNow", "A manual check"],
    )  # fmt: skip
    assert (asked_open["proposal"], asked_open["proposal_basis"]) == ("", "")
    # The next run restates the open point, same topic and question, with a statement.
    restated = {
        **blank,
        "proposal": "The listing is kept with the review ticket in ServiceNow.",
        "proposal_basis": "SOURCES",
        "suggestions": ["Kept in SharePoint"],
    }
    assert _ask(migrated, team, cid)
    second = _Provider([{**draft, "questions": [restated]}, _clean(False)])
    _run(migrated, second, cid)
    assert '"open_questions": [' in second.requests[0].prompt
    points = {item["topic"]: item for item in _open_points(client, team, cid)}
    assert set(points) == {"Evidence of the check", "Retention of the listing"}
    kept = points["Retention of the listing"]
    assert kept["id"] == asked_open["id"] and kept["version"] == asked_open["version"] + 1
    assert (kept["proposal"], kept["proposal_basis"], kept["suggestions"]) == (
        "The listing is kept with the review ticket in ServiceNow.", "SOURCES",
        ["Kept in SharePoint"],
    )  # fmt: skip
    # A point that already has a statement is never rewritten by a later run.
    assert points["Evidence of the check"]["proposal"] == stated["proposal"]


def _approve_narrative(client: Any, team: dict[str, Any], cid: str, codes: list[str]) -> Any:
    sections = _sections(codes)
    sections[3]["text"] = "The IT service desk administrator grants the access in Sample ERP."
    approved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"sections": sections, "steps": _steps(codes), "version": 0, "confirm": True},
    )
    assert approved.status_code == 200, approved.text
    return approved.json()["understanding"]


def test_the_approved_narrative_reaches_the_attribute_and_evidence_agents(
    migrated: Database,
) -> None:
    """Decided by the product owner on 26 October 2026: controls are tested as they are set
    up, so the attributes and the evidence are planned from the approved narrative."""
    from ai_workforce_api.context_routes import _generate
    from ai_workforce_api.evidence_planning import prompt_for
    from ai_workforce_api.evidence_plans import load_facts

    team, client, _scheduler = _engagement(migrated, "narrative-plans")
    control = _new_control(client, team, control_ref="REV-49", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    # Before approval, neither agent is given a narrative.
    with connect(migrated.url) as connection:
        assert "approved_process_narrative" not in prompt_for(
            load_facts(connection, project, UUID(cid))
        )
    _approve_narrative(client, team, cid, codes)
    with connect(migrated.url) as connection:
        facts = load_facts(connection, project, UUID(cid))
        prompt = prompt_for(facts)
    assert "approved_process_narrative" in prompt
    assert "grants the access in Sample ERP" in prompt
    # The plan may quote the narrative's facts.
    assert any("grants the access in Sample ERP" in text for text in facts.sources())
    assert any("[the control operates here]" in line for line in facts.narrative_steps)
    # The attribute agent is given it, and may quote it as a source.
    provider = _Provider([{"attributes": [], "issues": []}])
    with connect(migrated.url) as connection:
        _generate(connection, provider, org, project, UUID(cid), team["owner_id"])
    [request] = provider.requests
    assert '"approved_process_narrative"' in request.prompt
    assert "process-narrative" in request.prompt


def test_approving_the_narrative_updates_the_plan_in_the_background(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-plan-run")
    control = _new_control(client, team, control_ref="REV-50", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    approved = _approve_narrative(client, team, cid, codes)
    assert approved["status"] == "CONFIRMED"
    assert approved["run"]["status"] == "PENDING" and approved["run"]["mode"] == "PLAN"
    with connect(migrated.url) as connection:
        assert UUID(cid) in open_runs(connection)
    # Without a model the rules plan the evidence again; nothing is proposed by an agent.
    assert _run(migrated, None, cid) == "PLANNED"
    run = _context(client, team, cid)["understanding"]["run"]
    assert (run["status"], run["stage"]) == ("IDLE", "")
    assert run["plan_outcome"] is not None and run["planned_at"] is not None
    assert set(run["plan_outcome"]) >= {"attributes", "evidence", "evidence_proposed"}
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'process.plan_updated' "
            "AND target_id = %s",
            (cid,),
        ).fetchone()
    assert audit == (1,)
    # Saving a draft (not approving) does not update the plan.
    after = _context(client, team, cid)["understanding"]
    saved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={"sections": after["sections"], "steps": after["steps"],
              "version": after["version"], "confirm": False},
    )  # fmt: skip
    assert saved.status_code == 200, saved.text
    assert saved.json()["understanding"]["run"]["status"] == "IDLE"


def test_an_attribute_quoting_the_narrative_is_kept_and_the_planner_has_room(
    migrated: Database,
) -> None:
    """Regressions found on 26 October 2026: an attribute proposal quoting the approved
    narrative crashed the run (its source has no document id), and the evidence planner's
    plan was cut off at the provider's default 4,096 tokens."""
    from ai_workforce_api.context_routes import _generate
    from ai_workforce_api.evidence_plans import PLANNER_TOKENS, generate

    team, client, _scheduler = _engagement(migrated, "narrative-quote")
    control = _new_control(client, team, control_ref="REV-51", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    _approve_narrative(client, team, cid, codes)
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    proposal = {
        "attributes": [
            {
                "action": "ADD",
                "replaces": "",
                "text": "The IT service desk administrator grants only the approved access.",
                "basis": "DOCUMENTED",
                "source": "process-narrative",
                "quote": "The IT service desk administrator grants the access in Sample ERP.",
                "note": "From the approved narrative.",
            }
        ],
        "issues": [],
    }
    with connect(migrated.url) as connection:
        _generate(connection, _Provider([proposal]), org, project, UUID(cid), team["owner_id"])
        row = connection.execute(
            "SELECT basis, source_kind, source_document_id, source_quote FROM control_attributes "
            "WHERE engagement_control_id = %s AND status = 'PROPOSED' AND text LIKE %s",
            (cid, "The IT service desk administrator grants only%"),
        ).fetchone()
    assert row is not None
    assert (row[0], row[1], row[2]) == ("DOCUMENTED", "AGENT", None)
    assert row[3].startswith("The IT service desk administrator grants the access")
    # The planner asks for room for a whole plan.
    planner = _Provider([{}])
    with connect(migrated.url) as connection:
        generate(connection, planner, org, project, UUID(cid), team["owner_id"])
    assert planner.requests and planner.requests[0].max_tokens == PLANNER_TOKENS


def test_a_narrative_a_person_wrote_is_proposed_beside_never_replaced(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "narrative-beside")
    control = _new_control(client, team, control_ref="REV-42", domain="ORDER_TO_CASH")
    cid = control["id"]
    codes = _codes(migrated, cid)
    saved = client.put(
        f"{_base(team)}/controls/{cid}/process",
        json={
            "sections": [{"key": "PURPOSE", "text": "The team's own narrative."}],
            "steps": _steps(codes),
            "version": 0,
        },
    )
    assert saved.status_code == 200, saved.text
    assert _ask(migrated, team, cid)
    _run(migrated, None, cid)
    understanding = _context(client, team, cid)["understanding"]
    assert [s["text"] for s in understanding["sections"]] == ["The team's own narrative."]
    assert [s["key"] for s in understanding["proposed_sections"]] == KEYS
    # The review is of the draft beside it, and goes with it when it is taken (regression,
    # 26 October 2026: the taken draft read as "changed since the review").
    assert understanding["review"]["version"] == -1
    adopted = client.post(
        f"{_base(team)}/controls/{cid}/process/adopt",
        json={"version": understanding["version"]},
    )
    assert adopted.status_code == 200, adopted.text
    taken = adopted.json()["understanding"]
    assert taken["review"]["version"] == taken["version"] == understanding["version"] + 1
    # A run already waiting is not asked for twice.
    assert _ask(migrated, team, cid, "REVIEW")
    assert not _ask(migrated, team, cid, "REVIEW")


def test_the_rules_find_what_a_narrative_misses() -> None:
    sections = [
        Section(key="PURPOSE", text="We check access.", attributes=["A1"]),
        Section(key="APPROVAL", text="The approver is unknown.", attributes=[]),
    ]
    steps = [Step(description="Access is granted.", attributes=["A1"])]
    found = rules_findings(sections, steps, ["A1", "A2"])
    assert "The section Initiation is missing." in found
    assert "A2 is not explained in any section." in found
    assert "A2 is not evaluated at any step of the flow." in found
    assert "Purpose and scope is written in the first person." in found
    assert "Review and approval comments on what the sources leave out." in found
    assert "No step is marked as where the control operates." in found


def _gap(topic: str, kind: str = "MISSING", proposal: str = "") -> dict[str, Any]:
    return {
        "kind": kind, "topic": topic, "detail": f"The {topic.lower()} is not stated.",
        "why": "The tester cannot define the population.", "resolve": "Confirm it.",
        "quotes": [], "question": f"What is the {topic.lower()}?" if proposal else "",
        "proposal": proposal, "proposal_basis": "TYPICAL" if proposal else "",
    }  # fmt: skip


def test_a_gap_found_after_the_narrative_is_approved_goes_back_to_it_as_a_point(
    migrated: Database,
) -> None:
    """Product owner, 27 October 2026 ("If the process narrative is finalized, shouldn't
    that questions in narrative be capturing this?"): once the narrative is approved, a
    missing fact the attribute agent finds is a narrative point with a statement to
    confirm, not an open question on the attributes; a conflict between sources stays
    with the attributes. Before approval nothing changes."""
    from ai_workforce_api.context_routes import _generate
    from ai_workforce_api.control_attributes import ATTRIBUTES_SCHEMA, SYSTEM_PROMPT
    from ai_workforce_api.process_narrative import DRAFTER_PROMPT

    # The narrative agents settle what testing needs up front; missing documents are not
    # points or issues, the evidence requests obtain them.
    assert 'never only "periodically"' in DRAFTER_PROMPT
    assert "One not among the sources is never a point" in DRAFTER_PROMPT
    assert "is not an issue: the control's evidence requests obtain it" in SYSTEM_PROMPT
    issue = ATTRIBUTES_SCHEMA["properties"]["issues"]["items"]
    assert {"question", "proposal", "proposal_basis"} <= set(issue["required"])

    team, client, _scheduler = _engagement(migrated, "narrative-late-gaps")
    control = _new_control(client, team, control_ref="REV-51", domain="ORDER_TO_CASH")
    cid = control["id"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    review = "The IT Security Manager reviews the access granted each quarter."
    answer = {"attributes": [], "issues": [
        _gap("Review frequency", proposal=review),
        _gap("Approver of record", kind="CONFLICT"),
    ]}  # fmt: skip

    def raised() -> dict[str, tuple[str, str, str, str]]:
        with connect(migrated.url) as connection:
            return {
                str(row[0]): (str(row[1]), str(row[2]), str(row[3]), str(row[4]))
                for row in connection.execute(
                    "SELECT topic, origin, proposal, proposal_basis, status "
                    "FROM control_context_issues WHERE engagement_control_id = %s "
                    "AND status = 'OPEN'",
                    (UUID(cid),),
                ).fetchall()
            }

    # Before the narrative is approved, both stay with the attributes.
    with connect(migrated.url) as connection:
        _generate(connection, _Provider([answer]), org, project, UUID(cid), team["owner_id"])
    before = raised()
    assert before["Review frequency"][0] == "ATTRIBUTES"
    assert before["Approver of record"][0] == "ATTRIBUTES"
    # Approved: the missing fact becomes a narrative point with its statement.
    _approve_narrative(client, team, cid, _codes(migrated, cid))
    with connect(migrated.url) as connection:
        _generate(connection, _Provider([answer]), org, project, UUID(cid), team["owner_id"])
    after = raised()
    assert after["Review frequency"] == ("PROCESS", review, "TYPICAL", "OPEN")
    assert after["Approver of record"][0] == "ATTRIBUTES"
    [point] = [i for i in _open_points(client, team, cid) if i["topic"] == "Review frequency"]
    assert point["question"] == "What is the review frequency?"
    assert point["point_kind"] == "MISSING"
    # Raised again, the same topic is not asked twice.
    with connect(migrated.url) as connection:
        _generate(connection, _Provider([answer]), org, project, UUID(cid), team["owner_id"])
    assert len([i for i in _open_points(client, team, cid) if i["origin"] == "PROCESS"]) == 1


def _drafted(text: str, passes: str, fails: str) -> dict[str, Any]:
    return {
        "action": "ADD", "replaces": "", "text": text, "basis": "INFERRED", "source": "",
        "quote": "", "note": "The narrative names this review.",
        "condition": f"Check that {text[0].lower()}{text[1:]}", "pass_criteria": passes,
        "fail_criteria": fails, "judgment_required": False,
    }  # fmt: skip


def test_an_independent_agent_reviews_each_drafted_attribute_before_a_person_sees_it(
    migrated: Database,
) -> None:
    """Product owner, 27 October 2026 ("I want an agent to review the drafted attribute
    before it ask the user to review it"): every drafted attribute comes with its
    condition and pass and fail criteria; an independent reviewer agent corrects the
    drafts, and criteria a tester could not apply are left for a person, never kept."""
    from ai_workforce_api.context_routes import _generate
    from ai_workforce_api.control_attributes import ATTRIBUTES_SCHEMA, REVIEW_PROMPT

    item = ATTRIBUTES_SCHEMA["properties"]["attributes"]["items"]
    assert {"condition", "pass_criteria", "fail_criteria", "judgment_required"} <= set(
        item["required"]
    )
    team, client, _scheduler = _engagement(migrated, "attribute-review")
    cid = _control(client, team, "ITGC-AC-02")["id"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    vague = _drafted("Leavers are removed promptly.", "Removed in a timely manner.",
                     "Not removed appropriately.")  # fmt: skip
    drafted = {"attributes": [vague], "issues": []}
    corrected = _drafted(
        "Each leaver's Sample ERP account is disabled within three business days of the "
        "termination date in the HR record.",
        "The disable date is no more than three business days after the termination date.",
        "The account is disabled later, or is still active.",
    )
    still_vague = _drafted("Removals are reviewed.", "Reviewed appropriately.",
                           "Not reviewed adequately.")  # fmt: skip
    fix = "Replaced 'promptly' with the three business days the narrative states."
    reviewed = {"attributes": [corrected, still_vague], "fixes": [fix]}
    provider = _Provider([drafted, reviewed])
    with connect(migrated.url) as connection:
        note = _generate(connection, provider, org, project, UUID(cid), team["owner_id"])
    # The reviewer is a second, independent call, with its own instructions.
    assert len(provider.requests) == 2
    assert provider.requests[1].system == REVIEW_PROMPT
    assert "Leavers are removed promptly." in provider.requests[1].prompt
    assert "did not finish" not in note
    with connect(migrated.url) as connection:
        rows = {
            str(row[0]): row[1:]
            for row in connection.execute(
                "SELECT text, condition, pass_criteria, fail_criteria, criteria_origin, note "
                "FROM control_attributes WHERE engagement_control_id = %s "
                "AND status = 'PROPOSED'",
                (UUID(cid),),
            ).fetchall()
        }
        agents = {
            str(row[0])
            for row in connection.execute(
                "SELECT prompt_version FROM model_calls WHERE target_id = %s",
                (UUID(cid),),
            ).fetchall()
        }
    # The draft a person sees is the reviewer's, with its criteria.
    assert "Leavers are removed promptly." not in rows
    kept = rows[corrected["text"]]
    assert kept[:4] == (corrected["condition"], corrected["pass_criteria"],
                        corrected["fail_criteria"], "AGENT")  # fmt: skip
    # Criteria a tester could not apply are not kept: a person states them.
    blank = rows["Removals are reviewed."]
    assert blank[:4] == ("", "", "", None)
    assert "The criteria need a person" in str(blank[4])
    assert {"attributes/3", "attribute-review/1"} <= agents
    # When the reviewer keeps none, the team is told why, not that nothing was found.
    dropped = {"attributes": [], "fixes": ["Left out the draft: it repeats A1."]}
    with connect(migrated.url) as connection:
        note = _generate(connection, _Provider([drafted, dropped]), org, project, UUID(cid),
                         team["owner_id"])  # fmt: skip
    assert note.startswith("The reviewer agent kept none of the drafted attributes.")
    assert note.endswith("Left out the draft: it repeats A1.")


def test_an_attribute_approved_after_the_draft_plan_gets_its_evidence_planned(
    migrated: Database, monkeypatch: Any
) -> None:
    """Regression (27 October 2026): an attribute approved after the evidence plan was made
    had no evidence and no criteria until a person planned again. Approving it sends the
    plan back for approval, and now the planner agent plans it again in the background."""
    team, client, _scheduler = _engagement(migrated, "attribute-replan")
    cid = _control(client, team, "ITGC-AC-02")["id"]
    planned: list[UUID] = []

    class _Planning(_Scheduler):
        def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
            del sheet_ids

        def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
            planned.extend(plan_ids)

    base = f"{_base(team)}/controls/{cid}/attributes"
    # Without a worker that runs plans, or without a model, nothing is left waiting: a plan
    # waiting for a run nobody starts could not be approved.
    added = client.post(base, json={"text": "The HR record shows the termination date."})
    assert added.status_code == 200, added.text
    client = _client(migrated, team["owner_id"], _Planning())
    added = client.post(base, json={"text": "The disable date is in the change log."})
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        idle = connection.execute(
            "SELECT run_status FROM evidence_plans WHERE engagement_control_id = %s",
            (UUID(cid),),
        ).fetchone()
    assert idle is not None and str(idle[0]) != "PENDING" and planned == []
    import ai_workforce_api.context_routes as routes

    monkeypatch.setattr(routes, "live_model", lambda _settings: True)
    monkeypatch.setattr(routes, "provider_for", lambda _settings: object())
    client = _client(migrated, team["owner_id"], _Planning())
    added = client.post(base, json={"text": "The requester is told when access is removed."})
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT id, run_status, status FROM evidence_plans WHERE engagement_control_id = %s",
            (UUID(cid),),
        ).fetchone()
    assert row is not None and (str(row[1]), str(row[2])) == ("PENDING", "PROPOSED")
    assert planned == [UUID(str(row[0]))]
    # Already waiting for the planner: not asked twice.
    client.post(base, json={"text": "The ticket is closed after the disable."})
    assert planned == [UUID(str(row[0]))]
