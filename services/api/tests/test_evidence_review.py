"""Agent first-pass review of screenshots, and a person's sign-off.

Rewritten 18 November 2026 for the product owner's decision "Only after the set": a
per-file review no longer drafts a follow-up to the client. Old expectation: when a check
found an issue or an attribute was an exception, the review drafted a `recapture-` request
to the control owner (one per file), linked it from the review and audited
`pbc.follow_up_drafted`. New expectation: the review is stored for a person (checks,
attributes, proposed conclusion, feedback) with no follow-up request, no follow-up request
is created or rewritten, and `evidence.reviewed` records `follow_up_drafted: false`. Why:
each file is reviewed alone, so a draft per file asked the owner for evidence the request's
other files already held (nine drafts to one person for one D&I request of ITGC-AC-01).
The client is asked only for what is still missing after the request's files are checked
together (the D&I assurance check's follow-ups; the findings a person sends as one
message). Each test below that changed says what it expected before.
"""

import hashlib
import io
from typing import Any
from uuid import UUID, uuid4

import pytest
from evidence_store import store_attachment
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from support import Database, approve_plans_over_api
from test_evidence_analysis import _Engine, _engines, _no_ocr, _Provider
from test_evidence_assurance import _add_png, _Bench, _reading, _Readings, _scripted
from test_execution import _add_project_member, _add_user
from test_onboarding import _base as _setup_base
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api.auth import token_hash
from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_review import (
    AttributeTest,
    Check,
    Review,
    ReviewContext,
    check_review,
    proposed,
    unable_review,
)
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings

_ = migrated

# Pure rules


def test_the_answer_keeps_every_check_and_attribute_and_takes_text_from_the_control() -> None:
    answer = {
        "checks": [
            {"check": "legibility", "result": "OK", "note": "Clear."},
            {"check": "date_period", "result": "ISSUE", "note": "No clock visible."},
            {"check": "legibility", "result": "ISSUE", "note": "duplicate, ignored"},
        ],
        "attributes": [
            {
                "index": 0,
                "result": "PASS",
                "observed": "Minimum length 12",
                "expected": "At least 12 per policy",
                "note": "See https://evil.example/x",
            },
            {"index": 9, "result": "EXCEPTION"},
        ],
        "feedback": "Clear settings screenshot, but no date.",
        "follow_up": "Please send a new screenshot with the system clock visible.",
    }
    review = check_review(answer, _context())
    assert [check.check for check in review.checks] == [
        "legibility",
        "system",
        "date_period",
        "editing",
        "applicability",
    ]
    assert review.checks[0].result == "OK"
    assert review.checks[1].result == "UNCLEAR"
    assert [test.result for test in review.attributes] == ["PASS", "NOT_DETERMINABLE"]
    assert review.attributes[0].attribute == "Configured settings meet the security policy"
    assert "https://" not in review.attributes[0].note
    assert proposed(review) == "CANNOT_CONCLUDE"
    with pytest.raises(ValueError):
        check_review({**answer, "checks": [{"check": "vibes", "result": "OK"}]}, _context())


def test_the_conclusion_is_derived_from_the_results() -> None:
    def review(checks: dict[str, str], results: list[str]) -> Review:
        return Review(
            checks=[
                Check(check=key, result=checks.get(key, "OK"))  # type: ignore[arg-type]
                for key in ("legibility", "system", "date_period", "editing", "applicability")
            ],
            attributes=[
                AttributeTest(index=index, attribute=f"A{index}", result=result)  # type: ignore[arg-type]
                for index, result in enumerate(results)
            ],
        )

    assert proposed(review({}, ["PASS", "PASS"])) == "NO_EXCEPTION"
    assert proposed(review({}, ["PASS", "EXCEPTION"])) == "EXCEPTION"
    assert proposed(review({}, ["PASS", "NOT_DETERMINABLE"])) == "CANNOT_CONCLUDE"
    assert proposed(review({"legibility": "ISSUE"}, ["EXCEPTION"])) == "CANNOT_CONCLUDE"
    assert proposed(review({"editing": "ISSUE"}, ["PASS"])) == "CANNOT_CONCLUDE"
    assert proposed(review({"date_period": "UNCLEAR"}, ["PASS"])) == "NO_EXCEPTION"
    assert proposed(review({}, [])) == "CANNOT_CONCLUDE"


def test_the_agents_message_never_asks_for_access_and_an_unreadable_image_is_an_issue() -> None:
    # Rewritten 18 November 2026 ("Only after the set"). Old: follow_up_message built the
    # per-file client follow-up (empty when nothing was wrong; from the issues and
    # exceptions otherwise, "full resolution" for an unreadable image). That builder is
    # removed with the per-file drafts. Kept: the model's message is still cleaned, so one
    # that asks for credentials or carries a link is dropped; an unreadable image is a
    # legibility issue the person sees; a review without a visual read cannot conclude.
    risky = check_review(
        {
            "checks": [{"check": "system", "result": "ISSUE"}],
            "attributes": [{"index": 0, "result": "EXCEPTION", "observed": "Length 6"}],
            "feedback": "",
            "follow_up": "Please share your admin password so we can check.",
        },
        _context(),
    )
    assert risky.follow_up == ""
    assert proposed(risky) == "EXCEPTION"
    linked = check_review(
        {
            "checks": [],
            "attributes": [],
            "feedback": "See https://evil.example/x",
            "follow_up": "Upload it at https://evil.example/upload",
        },
        _context(),
    )
    assert linked.follow_up == "" and "https://" not in linked.feedback
    unreadable = unable_review(_context(), "The image is too small to read.", unreadable=True)
    assert unreadable.checks[0].result == "ISSUE"
    assert "too small" in unreadable.feedback and unreadable.follow_up == ""
    local = unable_review(_context(), "The firm reads images locally.", unreadable=False)
    assert all(check.result == "UNCLEAR" for check in local.checks)
    assert proposed(local) == "CANNOT_CONCLUDE"


# Against the database


def test_the_tester_reviews_a_screenshot_and_a_person_signs_it_off(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "review")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(client, team, request, _png("Minimum length 12", 900, 300))
    requests_before = _request_count(migrated, team["project"])
    provider = _Provider(
        [
            {"pages": [{"text": "Minimum password length: 12. Lockout: 5 attempts."}]},
            {
                "kind": "configuration",
                "confidence": "high",
                "summary": "Password settings screenshot.",
                "items": [],
                "gaps": [],
            },
            {
                "checks": [
                    {"check": "legibility", "result": "OK"},
                    {"check": "system", "result": "OK", "note": "Shows the ERP, production."},
                    {"check": "date_period", "result": "ISSUE", "note": "No date or clock."},
                    {"check": "editing", "result": "OK"},
                    {"check": "applicability", "result": "OK"},
                ],
                "attributes": [
                    {"index": 0, "result": "PASS", "observed": "Length 12, lockout 5"},
                    {"index": 1, "result": "NOT_DETERMINABLE", "note": "Needs change history."},
                ],
                "feedback": "Settings look right, but the screenshot is undated.",
                "follow_up": "Please send the same screenshot with the system clock visible.",
            },
        ]
    )
    with connect(migrated.url) as connection:
        before = _request_row(connection, request["id"])
        run_analysis(
            connection,
            Settings(database_url=migrated.url),
            provider,
            analysis_id,
            _engines(_Engine("LOCAL", ["unused"])),
        )
        after = _request_row(connection, request["id"])
        follow_ups = connection.execute(
            "SELECT status, recipient, evidence_description, engagement_control_id "
            "FROM pbc_requests WHERE project_id = %s AND operation_key LIKE 'recapture-%%'",
            (team["project"],),
        ).fetchall()
    assert before == after
    assert len(provider.requests[2].images) == 1
    first = next(c for c in LIBRARY if c.key == "access-authentication").test_attributes[0]
    assert first in provider.requests[2].prompt
    review = _reviews(client, team)[0]
    assert review["status"] == "READY"
    assert review["proposed"] == "CANNOT_CONCLUDE"
    assert [check["result"] for check in review["checks"]][2] == "ISSUE"
    assert review["attributes"][0]["result"] == "PASS"
    assert review["feedback"].startswith("Settings look right")
    # Rewritten 18 November 2026 ("Only after the set"). Old: one DRAFT follow-up request
    # to the request's recipient carrying the agent's message ("system clock visible"),
    # linked from the review, and `pbc.follow_up_drafted` audited. New: the date issue is
    # the person's to see on the review; no request is drafted, linked or audited.
    assert follow_ups == []
    assert _request_count(migrated, team["project"]) == requests_before
    assert review["follow_up_request_id"] is None
    assert review["follow_up_status"] is None
    audit = _audit(migrated)
    assert "evidence.reviewed" in audit
    assert "itgc-access-tester" in audit
    assert "pbc.follow_up_drafted" not in audit
    [payload] = _reviewed_payloads(migrated)
    assert payload["follow_up_drafted"] is False and payload["issues"] == ["date_period"]
    path = _decide_path(team, review["id"])
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection, team["org"], f"c-{uuid4().hex[:6]}@example.com", "REVIEWER"
        )
        _add_project_member(connection, team["org"], team["project"], contributor_id)
    other = _client(migrated, contributor_id)
    body = {"version": review["version"], "decision": "ACCEPTED"}
    assert other.post(path, json=body).status_code == 403
    vague = client.post(
        path,
        json={"version": review["version"], "decision": "OVERRIDDEN", "conclusion": "NO_EXCEPTION"},
    )
    assert vague.status_code == 409
    accepted = client.post(path, json=body)
    assert accepted.status_code == 200
    assert accepted.json()["conclusion"] == "CANNOT_CONCLUDE"
    assert accepted.json()["decided_by_name"]
    assert (
        client.post(path, json={**body, "version": accepted.json()["version"]}).status_code == 409
    )
    analysis = client.get(f"{_base(team['org'], team['project'])}/evidence-analyses").json()[0]
    reread = client.post(
        f"{_base(team['org'], team['project'])}/evidence-analyses/{analysis['id']}/reanalyze",
        json={"version": analysis["version"]},
    )
    assert reread.status_code == 409
    assert reread.json()["detail"] == "review is signed off"
    assert "evidence.review_signed_off" in _audit(migrated)


def test_an_exception_is_proposed_and_a_person_can_override_it_with_a_reason(
    migrated: Database,
) -> None:
    team, client, request = _sent_engagement_request(migrated, "override")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(client, team, request, _png("Minimum length 6", 900, 300))
    provider = _Provider(
        [
            {"pages": [{"text": "Minimum password length: 6"}]},
            {
                "kind": "configuration",
                "confidence": "high",
                "summary": "Settings.",
                "items": [],
                "gaps": [],
            },
            {
                "checks": [
                    {"check": key, "result": "OK"}
                    for key in ("legibility", "system", "date_period", "editing", "applicability")
                ],
                "attributes": [
                    {
                        "index": 0,
                        "result": "EXCEPTION",
                        "observed": "Minimum length 6",
                        "expected": "At least 12 per the security policy",
                    },
                    {"index": 1, "result": "PASS"},
                ],
                "feedback": "The minimum password length is below policy.",
                "follow_up": "",
            },
        ]
    )
    with connect(migrated.url) as connection:
        run_analysis(
            connection,
            Settings(database_url=migrated.url),
            provider,
            analysis_id,
            _engines(_Engine("LOCAL", ["unused"])),
        )
        drafted = connection.execute(
            "SELECT evidence_description FROM pbc_requests "
            "WHERE project_id = %s AND operation_key LIKE 'recapture-%%'",
            (team["project"],),
        ).fetchone()
    review = _reviews(client, team)[0]
    assert review["proposed"] == "EXCEPTION"
    # Rewritten 18 November 2026 ("Only after the set"). Old: with no message from the
    # agent, a follow-up was built from the exception ("Minimum length 6") and drafted.
    # New: the exception is on the review for the person to decide; nothing is drafted.
    assert drafted is None
    assert review["attributes"][0]["observed"] == "Minimum length 6"
    assert review["follow_up_request_id"] is None
    overridden = client.post(
        _decide_path(team, review["id"]),
        json={
            "version": review["version"],
            "decision": "OVERRIDDEN",
            "conclusion": "NO_EXCEPTION",
            "note": "Approved policy exception for this system, see the exception register.",
        },
    )
    assert overridden.status_code == 200
    assert overridden.json()["decision"] == "OVERRIDDEN"
    assert overridden.json()["conclusion"] == "NO_EXCEPTION"
    assert '"proposed": "EXCEPTION"' in _audit(migrated)


def test_a_firm_that_reads_locally_gets_feedback_instead_of_a_visual_review(
    migrated: Database,
) -> None:
    team, client, request = _sent_engagement_request(migrated, "local")
    analysis_id = _store_screenshot(client, team, request, _png("Lockout 5", 900, 300))
    provider = _Provider(
        [
            {
                "kind": "configuration",
                "confidence": "low",
                "summary": "Settings.",
                "items": [],
                "gaps": [],
            }
        ]
    )
    with connect(migrated.url) as connection:
        run_analysis(
            connection,
            Settings(database_url=migrated.url),
            provider,
            analysis_id,
            _engines(_Engine("LOCAL", ["Account lockout threshold: 5"])),
        )
        drafts = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s "
            "AND operation_key LIKE 'recapture-%%'",
            (team["project"],),
        ).fetchone()
    review = _reviews(client, team)[0]
    assert review["status"] == "NEEDS_PERSON"
    assert "model OCR" in review["note"]
    assert review["proposed"] == "CANNOT_CONCLUDE"
    assert all(request.images == () for request in provider.requests)
    assert drafts == (0,)


def test_an_unreadable_screenshot_is_a_legibility_issue_for_a_person(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "tiny")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(client, team, request, _png("x", 20, 20))
    with connect(migrated.url) as connection:
        run_analysis(
            connection, Settings(database_url=migrated.url), _Provider([{}]), analysis_id, _no_ocr
        )
        drafted = connection.execute(
            "SELECT evidence_description FROM pbc_requests WHERE project_id = %s "
            "AND operation_key LIKE 'recapture-%%'",
            (team["project"],),
        ).fetchone()
    review = _reviews(client, team)[0]
    assert review["status"] == "NEEDS_PERSON"
    assert review["checks"][0]["result"] == "ISSUE"
    assert "too small" in review["feedback"]
    # Rewritten 18 November 2026 ("Only after the set"). Old (named "asks the owner for a
    # new one"): a follow-up asking for a full-resolution capture was drafted. New: the
    # legibility issue and its reason are the person's to see; nothing is drafted.
    assert drafted is None
    assert review["follow_up_request_id"] is None


def test_screenshots_each_incomplete_draft_nothing_per_file_and_are_checked_as_a_set(
    migrated: Database,
) -> None:
    """Owner's report, 18 November 2026: screenshots re-added to one D&I request of
    ITGC-AC-01, each reviewed alone and each found to show only part of the request, drafted
    one follow-up to the process owner per file, each asking for what the other files
    already showed. Decision "Only after the set": every file is still reviewed and its
    review is stored for a person, but no request is created or rewritten for it; the
    request's files are checked together in one run, and what that check still finds
    missing is its follow-ups, listed once on the request for a person to send."""
    bench = _Bench(migrated, "set")
    path = f"/organizations/{bench.team['org']}/evidence-settings"
    version = bench.owner.get(path).json()["version"]
    turned = bench.owner.put(path, json={"ocr_engine": "MODEL", "version": version})
    assert turned.status_code == 200, turned.text
    names = ["1_ticket.png", "2_approval.png", "3_user-record.png"]
    shots = [_add_png(bench, name) for name in names]
    project = bench.team["project"]
    keys_before = _request_keys(bench)
    outbound_before = bench.count("outbound_messages")
    partial = {
        "checks": [
            {"check": "legibility", "result": "OK"},
            {"check": "system", "result": "OK"},
            {"check": "date_period", "result": "OK"},
            {"check": "editing", "result": "OK"},
            {"check": "applicability", "result": "ISSUE", "note": "Shows one part only."},
        ],
        "attributes": [{"index": 0, "result": "NOT_DETERMINABLE", "note": "Needs more."}],
        "feedback": "This screenshot shows one part of what the request asks for.",
        "follow_up": "Please send the procedure and the screenshot of the user record.",
    }
    with connect(migrated.url) as connection:
        pending = connection.execute(
            "SELECT id, evidence_file_id FROM evidence_analyses WHERE status = 'PENDING' "
            "ORDER BY created_at"
        ).fetchall()
        assert {str(row[1]) for row in pending} == set(shots)
        for analysis_id, _file_id in pending:
            provider = _Provider(
                [
                    {"pages": [{"text": "REQ-1041 approved by Priya Shah"}]},
                    _reading("walkthrough"),
                    partial,
                ]
            )
            assert (
                run_analysis(
                    connection,
                    Settings(database_url=migrated.url),
                    provider,
                    analysis_id,
                    _engines(_Engine("LOCAL", ["unused"])),
                )
                == "READY"
            )
            assert any(request.images for request in provider.requests[1:])

    # Every file was reviewed, and each review is the person's to see.
    reviews = _reviews(bench.client, bench.team)
    assert {r["evidence_file_id"] for r in reviews} == set(shots)
    for review in reviews:
        assert review["status"] == "READY" and review["proposed"] == "CANNOT_CONCLUDE"
        assert review["checks"][4]["result"] == "ISSUE"
        assert review["feedback"].startswith("This screenshot shows one part")
        assert review["follow_up_request_id"] is None and review["follow_up_status"] is None
        # On a request: before 18 November 2026 each of these drafted a follow-up.
        assert review["pbc_request_id"] is not None
    # No request was drafted for any file, and none was created or rewritten.
    assert bench.rows(
        "SELECT count(*) FROM pbc_requests WHERE project_id = %s "
        "AND operation_key LIKE 'recapture-%%'",
        project,
    ) == [(0,)]
    _no_follow_up_drafted(bench, keys_before)
    payloads = _reviewed_payloads(migrated)
    assert len(payloads) == 3 and {p["follow_up_drafted"] for p in payloads} == {False}
    assert "pbc.follow_up_drafted" not in _audit(migrated)

    # The set: one check of the request, reading the three files together.
    [(run_id, status, stale, _held, _reused, _why)] = bench.runs()
    assert (status, stale) == ("PENDING", False)
    assert set(bench.entry()["file_ids"]) == set(shots)
    shortfall = _scripted(
        lambda _code, _facts: {
            "result": "NOT_MET",
            "quotes": [],
            "reason": "not shown",
            "absent": "No record that shows it.",
        }
    )
    readings = _Readings(shortfall, shortfall)
    assert bench.check(readings) == ["READY"]
    assert all(name in readings.requests[0].prompt for name in names)
    done = bench.entry()
    assert done["run_id"] == str(run_id)
    follow_ups = done["review"]["follow_ups"]
    # What is still missing after the set is its follow-ups, once on the request: no two
    # ask the same thing, and the check drafted and sent nothing.
    assert follow_ups
    assert len({f["request"] for f in follow_ups}) == len(follow_ups)
    assert len(bench.runs()) == 1
    _no_follow_up_drafted(bench, keys_before)
    assert bench.count("outbound_messages") == outbound_before


def test_a_spreadsheet_gets_no_screenshot_review(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "sheet")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(
        client, team, request, b"User,Role\nann,admin\nbob,user\ncid,user\n", name="users.csv"
    )
    with connect(migrated.url) as connection:
        run_analysis(connection, Settings(database_url=migrated.url), None, analysis_id, _no_ocr)
    assert _reviews(client, team) == []


# Helpers


def _base(org: UUID, project: UUID) -> str:
    return f"/organizations/{org}/projects/{project}"


def _context() -> ReviewContext:
    return ReviewContext(
        file_name="settings.png",
        control_ref="ITGC-AC-05",
        control_title="Authentication settings meet policy",
        control_activity="Password, lockout, and MFA settings meet the security policy.",
        systems=("SAP ERP",),
        period="the audit period ending 31 December 2027",
        attributes=(
            "Configured settings meet the security policy",
            "Settings did not change during the period, or changes were approved",
        ),
        requested=("System-generated screenshot of the authentication settings",),
        ocr_text="Minimum password length: 12",
    )


class _Scheduler:
    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        del draft_ids

    def schedule_evidence_analyses(self, analysis_ids: list[UUID]) -> None:
        del analysis_ids


def _client(database: Database, user_id: UUID) -> TestClient:
    settings = Settings(
        database_url=database.url, session_cookie_secure=False, email_mock_inbound_enabled=True
    )
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (user_id, token_hash(token)),
        )
    return TestClient(
        create_app(settings, draft_scheduler=_Scheduler()), cookies={"aw_session": token}
    )


def _sent_engagement_request(
    database: Database, slug: str, control_ref: str = "ITGC-AC-05"
) -> tuple[dict[str, Any], TestClient, dict[str, Any]]:
    """An onboarded engagement whose request for one control has gone out in a thread."""
    team = _new_engagement(database, slug)
    client = _client(database, team["owner_id"])
    _complete_setup(client, team)
    setup = _setup_base(team["org"], team["project"])
    plan = client.post(f"{setup}/plan").json()["plan"]
    started = client.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    # Nothing is requested before a person approves each control's evidence plan.
    approve_plans_over_api(client, team["org"], team["project"])
    thread = f"thread-{uuid4().hex[:8]}"
    with connect(database.url) as connection:
        row = connection.execute(
            """
            UPDATE pbc_requests r SET status = 'SENT', thread_id = %s, outbound_message_id = %s
            FROM engagement_controls c
            WHERE c.id = r.engagement_control_id AND r.project_id = %s
              AND c.control_ref = %s AND r.testing_phase = 'INTERIM'
            RETURNING r.id, r.recipient, r.thread_id
            """,
            (thread, f"msg-{thread}", team["project"], control_ref),
        ).fetchone()
    assert row is not None
    return team, client, {"id": str(row[0]), "recipient": str(row[1]), "thread_id": row[2]}


def _opt_into_model(client: TestClient, team: dict[str, Any]) -> None:
    path = f"/organizations/{team['org']}/evidence-settings"
    version = client.get(path).json()["version"]
    assert client.put(path, json={"ocr_engine": "MODEL", "version": version}).status_code == 200


def _store_screenshot(
    client: TestClient,
    team: dict[str, Any],
    request: dict[str, Any],
    content: bytes,
    name: str = "settings.png",
) -> UUID:
    base = _base(team["org"], team["project"])
    reply = client.post(
        f"{base}/mailbox/simulated-inbound",
        json={
            "notification_key": f"shot-{uuid4().hex[:8]}",
            "sender": f"Owner <{request['recipient']}>",
            "subject": f"RE: [PBC-{UUID(request['id']).hex[-8:].upper()}] Evidence request",
            "body": "Screenshot attached.",
            "thread_id": None,
            "attachments": [
                {
                    "file_name": name,
                    "content_type": "image/png",
                    "size_bytes": len(content),
                    "content_sha256": hashlib.sha256(content).hexdigest(),
                }
            ],
        },
    )
    assert reply.status_code == 200, reply.text
    assert reply.json()["match_status"] == "MATCHED"
    store_attachment(
        client, team["org"], team["project"], reply.json()["attachments"][0]["id"], content
    )
    analyses = client.get(f"{base}/evidence-analyses").json()
    return UUID(analyses[0]["id"])


def _reviews(client: TestClient, team: dict[str, Any]) -> list[dict[str, Any]]:
    listed = client.get(f"{_base(team['org'], team['project'])}/evidence-reviews")
    assert listed.status_code == 200, listed.text
    body: list[dict[str, Any]] = listed.json()
    return body


def _decide_path(team: dict[str, Any], review_id: str) -> str:
    return f"{_base(team['org'], team['project'])}/evidence-reviews/{review_id}/decide"


def _request_row(connection: Any, request_id: str) -> Any:
    return connection.execute(
        "SELECT status, version, received_at FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()


def _png(text: str, width: int, height: int) -> bytes:
    picture = Image.new("RGB", (width, height), "white")
    ImageDraw.Draw(picture).text((10, height // 2), text, fill="black")
    output = io.BytesIO()
    picture.save(output, format="PNG")
    return output.getvalue()


def _request_count(database: Database, project_id: UUID) -> int:
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT count(*) FROM pbc_requests WHERE project_id = %s", (project_id,)
        ).fetchone()
    assert row is not None
    return int(row[0])


def _request_keys(bench: _Bench) -> set[str]:
    return {
        str(row[0])
        for row in bench.rows(
            "SELECT operation_key FROM pbc_requests WHERE project_id = %s", bench.team["project"]
        )
    }


def _no_follow_up_drafted(bench: _Bench, keys_before: set[str]) -> None:
    """No follow-up request exists for the files: none keyed as one, and none carrying the
    reviews' messages. A request the evidence plan drafts for an item it still asks for
    (`plan-` keys, evidence_plans.issue) is the plan's, not a follow-up."""
    added = _request_keys(bench) - keys_before
    assert all(key.startswith("plan-") for key in added), added
    assert bench.rows(
        "SELECT count(*) FROM pbc_requests WHERE project_id = %s AND ("
        "operation_key LIKE 'recapture-%%' "
        "OR evidence_description LIKE '%%Follow-up on the evidence you sent%%' "
        "OR evidence_description LIKE '%%the screenshot of the user record%%')",
        bench.team["project"],
    ) == [(0,)]


def _reviewed_payloads(database: Database) -> list[dict[str, Any]]:
    with connect(database.url) as connection:
        rows = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'evidence.reviewed' "
            "ORDER BY created_at, id"
        ).fetchall()
    return [dict(row[0]) for row in rows]


def _audit(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
