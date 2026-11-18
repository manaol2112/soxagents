"""Agent first-pass review of screenshots, and a person's sign-off."""

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
    follow_up_message,
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


def test_a_follow_up_is_drafted_only_when_something_is_wrong_and_never_asks_for_access() -> None:
    clean = check_review(
        {
            "checks": [{"check": key, "result": "OK"} for key in ("legibility", "system")],
            "attributes": [{"index": 0, "result": "PASS"}, {"index": 1, "result": "PASS"}],
            "feedback": "",
            "follow_up": "",
        },
        _context(),
    )
    assert follow_up_message(clean, _context()) == ""
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
    message = follow_up_message(risky, _context())
    assert "ITGC-AC-05" in message
    assert "production environment" in message
    assert "Length 6" in message
    assert "password" not in message.lower().replace("configured settings", "")
    unreadable = unable_review(_context(), "The image is too small to read.", unreadable=True)
    assert unreadable.checks[0].result == "ISSUE"
    assert "full resolution" in follow_up_message(unreadable, _context())
    local = unable_review(_context(), "The firm reads images locally.", unreadable=False)
    assert follow_up_message(local, _context()) == ""
    assert proposed(local) == "CANNOT_CONCLUDE"


# Against the database


def test_the_tester_reviews_a_screenshot_and_a_person_signs_it_off(migrated: Database) -> None:
    team, client, request = _sent_engagement_request(migrated, "review")
    _opt_into_model(client, team)
    analysis_id = _store_screenshot(client, team, request, _png("Minimum length 12", 900, 300))
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
    assert len(follow_ups) == 1
    assert follow_ups[0][0] == "DRAFT"
    assert follow_ups[0][1] == request["recipient"]
    assert "system clock visible" in follow_ups[0][2]
    assert review["follow_up_request_id"] is not None
    assert review["follow_up_status"] == "DRAFT"
    audit = _audit(migrated)
    assert "evidence.reviewed" in audit
    assert "itgc-access-tester" in audit
    assert "pbc.follow_up_drafted" in audit
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
    # No message from the agent, so the follow-up is built from the exception.
    assert drafted is not None and "Minimum length 6" in drafted[0]
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


def test_an_unreadable_screenshot_asks_the_owner_for_a_new_one(migrated: Database) -> None:
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
    assert drafted is not None and "full resolution" in drafted[0]


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


def _audit(database: Database) -> str:
    with connect(database.url) as connection:
        rows = connection.execute("SELECT action, payload::text FROM audit_events").fetchall()
    return str(rows)
