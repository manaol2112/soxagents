"""Secure evidence upload links (Milestone 8.12): the request email carries a link; the
owner verifies a code sent to the same address and uploads evidence to the request,
which files it to the request's control."""

import hashlib
import re
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient
from support import Database
from test_evidence_analysis import _no_ocr
from test_evidence_intake import _engagement, _request, _settings
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_portal import CODE_TRIES, CODES_PER_HOUR, LINK_PLACEHOLDER
from ai_workforce_api.main import create_app
from ai_workforce_api.settings import Settings

_ = migrated
_LINK = re.compile(r"/upload/([A-Za-z0-9_-]{32,64})")


def test_the_request_email_carries_a_link_and_only_its_hash_is_kept(migrated: Database) -> None:
    sent = _sent(migrated, "link")
    assert LINK_PLACEHOLDER not in sent["body"]
    assert "attachments are not accepted as evidence" in sent["body"]
    token = sent["token"]
    with connect(migrated.url) as connection:
        stored = connection.execute(
            "SELECT recipient::text, token_hash FROM evidence_portal_links WHERE project_id = %s",
            (sent["team"]["project"],),
        ).fetchall()
        everywhere = str(
            connection.execute(
                "SELECT (SELECT string_agg(payload::text, ' ') FROM audit_events), "
                "(SELECT string_agg(subject, ' ') FROM outbound_messages), "
                "(SELECT string_agg(token_hash, ' ') FROM evidence_portal_links)"
            ).fetchone()
        )
    assert stored == [(sent["recipient"], hashlib.sha256(token.encode()).hexdigest())]
    assert token not in everywhere


def test_the_owner_verifies_a_code_and_uploads_to_the_request(migrated: Database) -> None:
    sent = _sent(migrated, "upload")
    public = _public(migrated)
    token = sent["token"]
    status = public.get(f"/public/evidence-portal/links/{token}")
    assert status.status_code == 200, status.text
    assert status.json()["state"] == "ACTIVE"
    assert status.json()["masked_email"].endswith("@client.example")
    assert sent["recipient"] not in status.text
    # Nothing is open before the code.
    assert public.get("/public/evidence-portal/session").status_code == 401
    code = _code(public, token)
    guess = "000000" if code != "000000" else "111111"
    wrong = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": guess})
    assert wrong.status_code == 409
    assert "tries left" in wrong.json()["detail"]
    session = _verify(public, token, code)
    # A code works once.
    reused = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": code})
    assert reused.status_code == 409
    listed = public.get("/public/evidence-portal/session", headers=session)
    assert listed.status_code == 200, listed.text
    requests = listed.json()["requests"]
    assert [item["id"] for item in requests] == [sent["request_id"]]
    added = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "access population.csv"},
        content=b"User ID,Name,Date granted\nu0001,Demo User 1,2027-01-10\n",
        headers={**session, "content-type": "text/csv"},
    )
    assert added.status_code == 200, added.text
    assert added.json() == {"file_name": "access population.csv", "duplicate": False}
    again = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "access population.csv"},
        content=b"User ID,Name,Date granted\nu0001,Demo User 1,2027-01-10\n",
        headers={**session, "content-type": "text/csv"},
    )
    assert again.json()["duplicate"] is True
    # The owner sees the names of their own files on the request, and nothing else.
    files = public.get("/public/evidence-portal/session", headers=session).json()
    assert [f["file_name"] for f in files["requests"][0]["files"]] == ["access population.csv"]
    # The team sees it filed to the request's control, by the owner, through the link.
    team = sent["team"]
    register = sent["client"].get(
        f"/organizations/{team['org']}/projects/{team['project']}/evidence-register"
    )
    row = register.json()["files"][0]
    assert row["control"]["control_ref"] == "ITGC-AC-01"
    assert row["filed_by"] == "OWNER"
    assert row["added_by"] == f"{sent['recipient']} (secure link)"
    # The coordinator reads it and the request is received.
    with connect(migrated.url) as connection:
        analysis = connection.execute(
            "SELECT id, requested_by_user_id FROM evidence_analyses WHERE project_id = %s",
            (team["project"],),
        ).fetchone()
        assert analysis is not None and analysis[1] == team["owner_id"]
        run_analysis(connection, _settings(migrated), None, analysis[0], _no_ocr)
        status_now = connection.execute(
            "SELECT status FROM pbc_requests WHERE id = %s", (sent["request_id"],)
        ).fetchone()
        audit = connection.execute(
            "SELECT action, actor_user_id, payload::text FROM audit_events "
            "WHERE action LIKE 'evidence%%portal%%' OR action = 'evidence.portal_uploaded'"
        ).fetchall()
    assert status_now is not None and status_now[0] in ("RECEIVED", "PARTIALLY_RECEIVED")
    assert {row[0] for row in audit} >= {
        "evidence_portal.code_sent",
        "evidence_portal.code_refused",
        "evidence_portal.verified",
        "evidence.portal_uploaded",
    }
    assert all(row[1] is None for row in audit)
    assert sent["recipient"] not in str(audit)


def test_codes_expire_lock_after_five_tries_and_are_rate_limited(migrated: Database) -> None:
    sent = _sent(migrated, "codes")
    public = _public(migrated)
    token = sent["token"]
    code = _code(public, token)
    wrong = "111111" if code != "111111" else "222222"
    for _try in range(CODE_TRIES):
        refused = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": wrong})
        assert refused.status_code == 409
    locked = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": code})
    assert locked.status_code == 409
    assert "too many wrong codes" in locked.json()["detail"]
    fresh = _code(public, token)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_portal_codes SET expires_at = clock_timestamp() - interval '1 minute'"
        )
    expired = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": fresh})
    assert expired.status_code == 409
    assert "expired" in expired.json()["detail"]
    for _more in range(CODES_PER_HOUR - 2):
        _code(public, token)
    limited = public.post(f"/public/evidence-portal/links/{token}/code")
    assert limited.status_code == 429


def test_a_link_stops_when_revoked_past_due_or_cancelled(migrated: Database) -> None:
    sent = _sent(migrated, "stops")
    public = _public(migrated)
    token = sent["token"]
    team, client = sent["team"], sent["client"]
    session = _verify(public, token, _code(public, token))
    base = f"/organizations/{team['org']}/projects/{team['project']}/evidence-portal"
    links = client.get(f"{base}/links").json()
    assert [(item["recipient"], item["active_links"]) for item in links] == [(sent["recipient"], 1)]
    # Past 30 days after the due date the request is no longer open to the owner.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET due_at = clock_timestamp() - interval '31 days' WHERE id = %s",
            (sent["request_id"],),
        )
    assert public.get(f"/public/evidence-portal/links/{token}").json()["state"] == "CLOSED"
    closed = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "late.txt"},
        content=b"late",
        headers=session,
    )
    assert closed.status_code == 409
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET due_at = clock_timestamp() + interval '5 days' WHERE id = %s",
            (sent["request_id"],),
        )
    assert public.get(f"/public/evidence-portal/links/{token}").json()["state"] == "ACTIVE"
    revoked = client.post(f"{base}/revoke", json={"recipient": sent["recipient"].upper()})
    assert revoked.status_code == 200, revoked.text
    assert revoked.json() == {"revoked": 1}
    assert public.get(f"/public/evidence-portal/links/{token}").json()["state"] == "REVOKED"
    assert public.get("/public/evidence-portal/session", headers=session).status_code == 404
    assert public.post(f"/public/evidence-portal/links/{token}/code").status_code == 409


def test_the_owner_reaches_only_their_own_open_requests(migrated: Database) -> None:
    sent = _sent(migrated, "scope")
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    # Another control's request goes to a different owner: not listed, not open to upload.
    other = _request(migrated, sent["team"], "ITGC-CM-01")
    listed = public.get("/public/evidence-portal/session", headers=session).json()
    assert other["id"] not in [item["id"] for item in listed["requests"]]
    for request_id in (other["id"], str(uuid4())):
        refused = public.post(
            f"/public/evidence-portal/session/requests/{request_id}/files",
            params={"name": "x.txt"},
            content=b"x",
            headers=session,
        )
        assert refused.status_code == 409
    # Names cannot climb out of the folder; an empty file is refused.
    empty = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "empty.txt"},
        content=b"",
        headers=session,
    )
    assert empty.status_code == 409


def test_unknown_or_malformed_links_are_not_found(migrated: Database) -> None:
    public = _public(migrated)
    for token in ("short", "x" * 43):
        assert public.get(f"/public/evidence-portal/links/{token}").status_code == 404
        assert public.post(f"/public/evidence-portal/links/{token}/code").status_code == 404
    # A path that climbs out of the portal is not public at all.
    climbing = public.get("/public/evidence-portal/links/../../organizations")
    assert climbing.status_code in (401, 404)
    bad = {"x-portal-session": "y" * 43}
    assert public.get("/public/evidence-portal/session", headers=bad).status_code == 404


def test_preview_links_exist_only_with_the_mock_mailbox_and_for_the_team(
    migrated: Database,
) -> None:
    sent = _sent(migrated, "preview")
    team = sent["team"]
    base = f"/organizations/{team['org']}/projects/{team['project']}/evidence-portal"
    preview = sent["client"].post(f"{base}/preview-link", json={"recipient": sent["recipient"]})
    assert preview.status_code == 200, preview.text
    assert _LINK.search(preview.json()["url"]) is not None
    stranger = sent["client"].post(f"{base}/preview-link", json={"recipient": "who@else.example"})
    assert stranger.status_code == 404
    live = _session(migrated, team["owner_id"], email_provider="graph")
    refused = live.post(f"{base}/preview-link", json={"recipient": sent["recipient"]})
    assert refused.status_code == 409


# Helpers


def _sent(database: Database, slug: str, phase: str = "INTERIM") -> dict[str, Any]:
    """An active engagement whose ITGC-AC-01 request for the phase (interim unless said)
    has been approved and sent."""
    team, _client, _scheduler = _engagement(database, f"portal-{slug}-{uuid4().hex[:4]}")
    client = _session(database, team["owner_id"], email_mock_inbound_enabled=True)
    admin = _session(database, team["reviewer_id"])
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    request = _request(database, team, "ITGC-AC-01", phase)
    submitted = client.post(
        f"{base}/pbc-requests/{request['id']}/submit", json={"version": request["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    approval = submitted.json()["approval"]["id"]
    decided = admin.post(
        f"{base}/approvals/{approval}/decision",
        json={"decision": "APPROVED", "reason": "Checked the request"},
    )
    assert decided.status_code == 200, decided.text
    delivered = client.post(
        f"{base}/pbc-requests/{request['id']}/send", json={"approval_id": approval}
    )
    assert delivered.status_code == 200, delivered.text
    with connect(database.url) as connection:
        row = connection.execute(
            "SELECT body, recipient FROM mailbox_messages WHERE project_id = %s "
            "AND body LIKE '%%/upload/%%' ORDER BY created_at DESC LIMIT 1",
            (team["project"],),
        ).fetchone()
    assert row is not None
    found = _LINK.search(str(row[0]))
    assert found is not None
    return {
        "team": team,
        "client": client,
        "request_id": request["id"],
        "recipient": str(row[1]).lower(),
        "body": str(row[0]),
        "token": found.group(1),
    }


def _public(database: Database) -> TestClient:
    settings = Settings(
        database_url=database.url, session_cookie_secure=False, email_mock_inbound_enabled=True
    )
    return TestClient(create_app(settings))


def _code(public: TestClient, token: str) -> str:
    sent = public.post(f"/public/evidence-portal/links/{token}/code")
    assert sent.status_code == 200, sent.text
    code = sent.json()["preview_code"]
    assert isinstance(code, str) and len(code) == 6
    return code


def _verify(public: TestClient, token: str, code: str) -> dict[str, str]:
    verified = public.post(f"/public/evidence-portal/links/{token}/verify", json={"code": code})
    assert verified.status_code == 200, verified.text
    return {"x-portal-session": verified.json()["session_token"]}


def test_no_code_is_issued_when_email_cannot_send_it(migrated: Database) -> None:
    sent = _sent(migrated, "nomail")
    unavailable = TestClient(
        create_app(
            Settings(database_url=migrated.url, session_cookie_secure=False, email_provider="graph")
        )
    )
    refused = unavailable.post(f"/public/evidence-portal/links/{sent['token']}/code")
    assert refused.status_code == 409
    assert "contact the audit team" in refused.json()["detail"]
    with connect(migrated.url) as connection:
        delivery = connection.execute("SELECT delivery FROM evidence_portal_codes").fetchall()
    # Recorded as not sent, and never usable.
    assert delivery == [("NOT_SENT",)]
    verify = unavailable.post(
        f"/public/evidence-portal/links/{sent['token']}/verify", json={"code": "123456"}
    )
    assert verify.status_code == 409
