"""The preparer sends the D&I workpaper for review; the reviewer signs it in section 7
(docs/design-workpaper.md, section 3.8; the product owner, 16 November 2026; migration
0168). Synthetic data only.

Audit integrity:

- "Sign and send for review" prepares the design workpaper through the existing
  preparation and opens the request in one transaction: a refusal of either prepares
  nothing and sends nothing;
- a request goes only to someone who may sign the D&I conclusion (the engagement role
  REVIEWER, as the sign-off reads it), never, where independence is required, to the
  preparer or to the person who recorded the standing conclusion;
- only the reviewer the request names signs the conclusion or returns the workpaper; the
  sign-off names the request it answers (a stale one is refused) and ends it SIGNED in its
  own transaction; a return reopens the workpaper through the existing path and ends the
  request RETURNED with the reason;
- a request is written once and ended once (SIGNED, RETURNED, REASSIGNED, REOPENED or
  SUPERSEDED), never deleted; one stands per control; its reminder only moves forward, at
  most once an hour, and is an in-app notice, never an email;
- every write is a person's (never an agent's) and one audit event with at most 200
  characters of the message or the reason; an archived engagement's requests are
  read-only.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_design_conclusion_choice import _Draft, _refused
from test_evidence_assurance import _Bench
from test_execution import _add_user
from test_outbound import _session, migrated

from ai_workforce_api import design_conclusions, design_review_requests, independence
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.design_review_requests import (
    CHANGE_FORBIDDEN,
    MESSAGE_TOO_LONG,
    NOT_A_REVIEWER,
    NOT_IN_REVIEW,
    PREPARER_NOT_OFFERED,
    RECORDER_NOT_OFFERED,
    REMIND_FORBIDDEN,
    REMIND_TOO_SOON,
    REQUEST_STALE,
    RETURN_REASON_NEEDED,
    RETURN_REASON_TOO_LONG,
    REVIEWER_IS_PREPARER,
    REVIEWER_NEEDED,
    REVIEWER_RECORDED,
    SAME_REVIEWER,
    clean_message,
    clean_return_reason,
    default_of,
    in_review_with,
    may_manage,
    refusal_of,
    remind_refusal,
    why_not,
)
from ai_workforce_api.engagement_close import closed_detail

__all__ = ["migrated"]

REASON = "Attribute B's evidence is the wrong period; attach the Q3 ticket."
MESSAGE = "Please look at attribute B first; the ticket is the one from September."


class _Review(_Draft):
    """A control whose design workpaper is drafted, its conclusion recorded (effective),
    and a reviewer on the engagement who did not prepare it (`reviewer`)."""

    def __init__(self, migrated: Database, slug: str, choose: bool = True) -> None:
        super().__init__(migrated, slug)
        # The engagement's setup named an independent reviewer of its own: a preparer here,
        # so that who may be chosen is exactly who each test makes a reviewer.
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE project_memberships SET engagement_role = 'PREPARER' "
                "WHERE project_id = %s AND engagement_role = 'REVIEWER' AND user_id <> %s",
                (self.bench.team["project"], self.reviewer_id),
            )
        if choose:
            self.chosen("EFFECTIVE")

    def send(
        self,
        reviewer_id: Any,
        message: str | None = None,
        client: TestClient | None = None,
        version: int | None = None,
    ) -> Any:
        sent: dict[str, Any] = {
            "workpaper_version": self.paper()["version"] if version is None else version,
            "reviewer_id": None if reviewer_id is None else str(reviewer_id),
        }
        if message is not None:
            sent["message"] = message
        return (client or self.bench.owner).post(f"{self.path}/send-for-review", json=sent)

    def sent(self, reviewer_id: Any, message: str | None = None) -> dict[str, Any]:
        answer = self.send(reviewer_id, message)
        assert answer.status_code == 200, answer.text
        body: dict[str, Any] = answer.json()
        self.version = int(body["workpaper"]["prepared_version"])
        return body

    def standing(self, client: TestClient | None = None) -> dict[str, Any]:
        request: dict[str, Any] = self.body(client)["review_request"]
        assert request is not None
        return request

    def act(self, action: str, client: TestClient | None = None, **body: Any) -> Any:
        return (client or self.bench.owner).post(f"{self.path}/{action}", json=body)

    def sign(self, request_id: Any, client: TestClient | None = None) -> Any:
        return (client or self.reviewer).post(
            f"{self.path}/sign-off",
            json={"conclusion": "EFFECTIVE", "choice_id": self.body()["choice"]["id"],
                  "workpaper_version": self.version,
                  "request_id": None if request_id is None else str(request_id)},
        )  # fmt: skip

    def requests(self) -> list[tuple[Any, ...]]:
        """Every request on record, oldest first: reviewer, sender, how it ended, by whom,
        the reason, the message, the version."""
        return self.rows(
            "SELECT reviewer_id, sent_by, ended_as, ended_by, ended_reason, message, "
            "workpaper_version FROM design_review_requests WHERE engagement_control_id = %s "
            "ORDER BY sent_at, id",
            UUID(self.bench.control),
        )

    def events(self, action: str) -> list[dict[str, Any]]:
        return [
            row[0]
            for row in self.rows(
                "SELECT payload FROM audit_events WHERE action = %s AND project_id = %s "
                "ORDER BY occurred_at, id",
                action,
                self.bench.team["project"],
            )
        ]

    def status(self) -> str:
        return str(self.paper()["status"])

    def mine(self, client: TestClient) -> dict[str, Any]:
        found = client.get(f"{self.bench.base}/review-requests/mine")
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def reviewer_named(self, role: str = "REVIEWER") -> tuple[UUID, TestClient]:
        """Another person of the firm who may update the work, on the engagement with the
        role."""
        person, client = self.bench.member("ADMIN")
        self.engagement_role(person, role)
        return person, client


def _role_of(case: _Draft, user_id: Any) -> str:
    [(role,)] = case.rows(
        "SELECT engagement_role FROM project_memberships WHERE project_id = %s AND user_id = %s",
        case.bench.team["project"],
        user_id,
    )
    return str(role)


# --- The rules (pure) --------------------------------------------------------------------


def test_who_is_offered_and_where_the_picker_starts() -> None:
    preparer, recorder, other = UUID(int=1), UUID(int=2), UUID(int=3)
    assert why_not(preparer, preparer, recorder, True) == PREPARER_NOT_OFFERED
    assert why_not(recorder, preparer, recorder, True) == RECORDER_NOT_OFFERED
    assert why_not(other, preparer, recorder, True) is None
    # Development with independence off: anyone who may sign is offered.
    assert why_not(preparer, preparer, recorder, False) is None
    assert refusal_of(PREPARER_NOT_OFFERED) == REVIEWER_IS_PREPARER
    assert refusal_of(RECORDER_NOT_OFFERED) == REVIEWER_RECORDED
    assert refusal_of(None) is None
    # The last reviewer sent to, while offered; else the only one; else nobody.
    assert default_of([other, recorder], other) == other
    assert default_of([other, recorder], preparer) is None
    assert default_of([other], preparer) == other
    assert default_of([other], None) == other
    assert default_of([], other) is None
    assert default_of([other, recorder], None) is None


def test_a_reminder_at_most_once_an_hour_and_who_manages_a_request() -> None:
    now = datetime(2026, 11, 16, 12, 0, tzinfo=UTC)
    assert remind_refusal(None, now) is None
    assert remind_refusal(now - timedelta(minutes=59, seconds=59), now) == REMIND_TOO_SOON
    assert remind_refusal(now - timedelta(hours=1), now) is None
    sender, preparer, lead = UUID(int=1), UUID(int=2), UUID(int=3)
    assert may_manage(sender, sender, preparer, False)
    assert may_manage(preparer, sender, preparer, False)
    assert may_manage(lead, sender, preparer, True)
    assert not may_manage(lead, sender, preparer, False)
    assert not may_manage(lead, sender, None, False)


def test_the_message_and_the_reason_are_the_persons_own_text_cleaned() -> None:
    assert clean_message(None) == ""
    assert clean_message("  <b>Look</b> at B​ first.  ") == "Look at B first."
    assert len(clean_message("x" * 1000)) == 1000
    with pytest.raises(Exception, match=MESSAGE_TOO_LONG):
        clean_message("x" * 1001)
    assert clean_return_reason("<i>" + REASON + "</i>") == REASON
    for short in ("Too short", "   \n   ", "<b>1234</b>     "):
        with pytest.raises(Exception, match=RETURN_REASON_NEEDED):
            clean_return_reason(short)
    with pytest.raises(Exception, match=RETURN_REASON_TOO_LONG):
        clean_return_reason("x" * 1001)
    assert in_review_with("Riley Park") == (
        "this workpaper is in review with Riley Park; only they sign it off or return it, "
        "unless the preparer or the engagement lead makes you the reviewer"
    )


# --- Sending -----------------------------------------------------------------------------


def test_sign_and_send_prepares_the_workpaper_and_opens_one_request(migrated: Database) -> None:
    case = _Review(migrated, "drr-send")
    owner_id = case.bench.team["owner_id"]
    reviewer_name = case.bench.name(case.reviewer_id)

    # The picker: the one person who may sign, offered, with nothing waiting; it starts on
    # them. Nothing is in review.
    body = case.body()
    assert body["review_request"] is None and body["last_return"] is None
    assert body["reviewers"] == [
        {"id": str(case.reviewer_id), "name": reviewer_name, "role": "Reviewer", "waiting": 0,
         "offered": True, "why_not": None},
    ]  # fmt: skip
    assert body["default_reviewer_id"] == str(case.reviewer_id)
    assert body["workpaper"]["version"] == case.paper()["version"]

    def nothing_sent() -> None:
        assert case.status() == "DRAFT"
        assert case.requests() == []
        assert case.events("workpaper.prepared") == []

    # No reviewer chosen, a message too long, a stale page, someone who may not sign:
    # nothing is prepared and nothing is sent.
    _refused(case.send(None), 422, REVIEWER_NEEDED)
    _refused(case.send(case.reviewer_id, "x" * 1001), 422, MESSAGE_TOO_LONG)
    _refused(
        case.send(case.reviewer_id, version=case.paper()["version"] - 1),
        409,
        "the workpaper changed",
    )
    member_id, _member = case.bench.member("ADMIN")
    assert _role_of(case, member_id) != "REVIEWER"
    _refused(case.send(member_id), 409, NOT_A_REVIEWER)
    _refused(case.send(uuid4()), 409, NOT_A_REVIEWER)
    nothing_sent()

    # Sent: prepared by the owner, and in review with the reviewer, with the message as
    # the person wrote it, cleaned (untrusted).
    message = "<b>Please</b> look at B​ first. " + "The walkthrough evidence is attached. " * 25
    body = case.sent(case.reviewer_id, message)
    kept = "Please look at B first. " + ("The walkthrough evidence is attached. " * 25).strip()
    assert len(kept) <= 1000
    assert body["workpaper"]["status"] == "PREPARED"
    assert body["workpaper"]["prepared_by"] == case.bench.name(owner_id)
    request = body["review_request"]
    assert request["reviewer"] == {"id": str(case.reviewer_id), "name": reviewer_name}
    assert request["sent_by"] == {"id": str(owner_id), "name": case.bench.name(owner_id)}
    assert (request["message"], request["reminded_at"]) == (kept, None)
    assert request["version"] == body["workpaper"]["prepared_version"] == case.version
    assert body["reviewers"][0]["waiting"] == 1
    assert case.requests() == [(case.reviewer_id, owner_id, None, None, "", kept, case.version)]
    # Two records changed, each with its audit event: the preparation (the existing one)
    # and the request, with at most 200 characters of the message.
    assert len(case.events("workpaper.prepared")) == 1
    [event] = case.events("design_review_request.sent")
    assert event["message"] == kept[:200] and len(event["message"]) == 200
    assert (event["reviewer_id"], event["workpaper_version"]) == (
        str(case.reviewer_id), case.version,
    )  # fmt: skip

    # A prepared workpaper is not sent again; one request stands.
    _refused(case.send(case.reviewer_id), 409, "the workpaper changed")
    assert len(case.requests()) == 1


def test_the_preparation_rules_still_hold_when_sending(migrated: Database) -> None:
    """Sign and send for review prepares through the existing preparation: with no
    conclusion recorded it is refused with its sentence, and nothing is sent."""
    case = _Review(migrated, "drr-rules", choose=False)
    from ai_workforce_api.workpaper_service import PREPARE_NEEDS_CONCLUSION

    _refused(case.send(case.reviewer_id), 409, PREPARE_NEEDS_CONCLUSION)
    assert (case.status(), case.requests()) == ("DRAFT", [])


def test_the_picker_lists_who_may_sign_and_leaves_out_the_preparer_and_the_recorder(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Review(migrated, "drr-picker", choose=False)
    owner_id = case.bench.team["owner_id"]
    # The owner, who will prepare, is a reviewer too; a second reviewer records the
    # conclusion.
    case.engagement_role(owner_id, "REVIEWER")
    second_id, second = case.reviewer_named()
    case.chosen("EFFECTIVE", client=second)

    by_id = {item["id"]: item for item in case.body()["reviewers"]}
    assert set(by_id) == {str(owner_id), str(case.reviewer_id), str(second_id)}
    assert (by_id[str(owner_id)]["offered"], by_id[str(owner_id)]["why_not"]) == (
        False, PREPARER_NOT_OFFERED,
    )  # fmt: skip
    assert (by_id[str(second_id)]["offered"], by_id[str(second_id)]["why_not"]) == (
        False, RECORDER_NOT_OFFERED,
    )  # fmt: skip
    assert by_id[str(case.reviewer_id)]["offered"] is True
    # The only one offered: the picker starts on them.
    assert case.body()["default_reviewer_id"] == str(case.reviewer_id)
    # A third reviewer: two offered, never sent to; the picker starts on nobody.
    third_id, _third = case.reviewer_named()
    assert case.body()["default_reviewer_id"] is None
    # Neither is sent the workpaper.
    _refused(case.send(owner_id), 409, REVIEWER_IS_PREPARER)
    _refused(case.send(second_id), 409, REVIEWER_RECORDED)
    assert (case.status(), case.requests()) == ("DRAFT", [])
    # A person who is no longer active is not listed.
    with connect(migrated.url) as connection:
        connection.execute("UPDATE users SET status = 'DISABLED' WHERE id = %s", (third_id,))
    assert str(third_id) not in {item["id"] for item in case.body()["reviewers"]}
    _refused(case.send(third_id), 409, NOT_A_REVIEWER)

    # Development with independence off: everyone on the team may sign, and is offered.
    with monkeypatch.context() as patched:
        patched.setattr(independence, "_required", False)
        listed = case.body()["reviewers"]
        assert {item["id"] for item in listed} >= {str(owner_id), str(second_id)}
        assert all(item["offered"] for item in listed)

    # Sent to the reviewer: next time the picker starts on them, though two are offered.
    case.sent(case.reviewer_id)
    case.reopen()
    with connect(migrated.url) as connection:
        connection.execute("UPDATE users SET status = 'ACTIVE' WHERE id = %s", (third_id,))
    assert case.body()["default_reviewer_id"] == str(case.reviewer_id)


# --- While a request stands --------------------------------------------------------------


def test_change_reviewer_and_remind(migrated: Database) -> None:
    case = _Review(migrated, "drr-change")
    owner_id = case.bench.team["owner_id"]
    second_id, second = case.reviewer_named()
    case.sent(case.reviewer_id, MESSAGE)
    first = case.standing()

    # A stale request, the same reviewer, someone who may not sign: nothing changes.
    _refused(case.act("review-request/reviewer", request_id=str(uuid4()),
                      reviewer_id=str(second_id)), 409, REQUEST_STALE)  # fmt: skip
    _refused(case.act("review-request/reviewer", request_id=first["id"],
                      reviewer_id=str(case.reviewer_id)), 409, SAME_REVIEWER)  # fmt: skip
    _refused(case.act("review-request/reviewer", request_id=first["id"],
                      reviewer_id=str(owner_id)), 409, NOT_A_REVIEWER)  # fmt: skip
    # Another reviewer neither sent it, prepared it nor leads the engagement.
    assert _role_of(case, second_id) == "REVIEWER"
    _refused(
        case.act("review-request/reviewer", second, request_id=first["id"],
                 reviewer_id=str(second_id)), 403, CHANGE_FORBIDDEN,
    )  # fmt: skip
    _refused(case.act("review-request/remind", second, request_id=first["id"]), 403,
             REMIND_FORBIDDEN)  # fmt: skip
    assert len(case.requests()) == 1

    # The preparer changes the reviewer: the request ends REASSIGNED and one opens to the
    # second reviewer, for the same version, with the same message.
    changed = case.act("review-request/reviewer", request_id=first["id"],
                       reviewer_id=str(second_id))  # fmt: skip
    assert changed.status_code == 200, changed.text
    now = changed.json()["review_request"]
    assert now["reviewer"]["id"] == str(second_id) and now["id"] != first["id"]
    assert (now["message"], now["version"]) == (MESSAGE, first["version"])
    assert case.requests() == [
        (case.reviewer_id, owner_id, "REASSIGNED", owner_id, "", MESSAGE, case.version),
        (second_id, owner_id, None, None, "", MESSAGE, case.version),
    ]
    [event] = case.events("design_review_request.reassigned")
    assert (event["from_reviewer_id"], event["reviewer_id"], event["replaced"]) == (
        str(case.reviewer_id), str(second_id), first["id"],
    )  # fmt: skip

    # The first reviewer is told who it is with, and cannot sign it.
    theirs = case.body(case.reviewer)
    told = in_review_with(case.bench.name(second_id))
    assert told in theirs["blocking"] and theirs["can_sign"] is False
    _refused(case.sign(now["id"]), 403, told)

    # The engagement lead may change it back.
    lead_id, lead = case.reviewer_named("LEAD")
    back = case.act("review-request/reviewer", lead, request_id=now["id"],
                    reviewer_id=str(case.reviewer_id))  # fmt: skip
    assert back.status_code == 200, back.text
    last = back.json()["review_request"]
    assert (last["reviewer"]["id"], last["sent_by"]["id"]) == (str(case.reviewer_id), str(lead_id))

    # Remind: an in-app notice, recorded on the request; at most once an hour.
    reminded = case.act("review-request/remind", request_id=last["id"])
    assert reminded.status_code == 200, reminded.text
    at = reminded.json()["review_request"]["reminded_at"]
    assert at is not None
    _refused(case.act("review-request/remind", request_id=last["id"]), 409, REMIND_TOO_SOON)
    _refused(case.act("review-request/remind", request_id=first["id"]), 409, REQUEST_STALE)
    [event] = case.events("design_review_request.reminded")
    assert (event["reviewer_id"], event["delivery"]) == (str(case.reviewer_id), "IN_APP")
    # The reviewer sees it where they read what waits for them.
    [waiting] = case.mine(case.reviewer)["requests"]
    assert (waiting["id"], waiting["reminded_at"]) == (last["id"], at)
    # Nothing is sent by email: no message to the mail server is recorded.
    assert case.rows(
        "SELECT count(*) FROM outbound_messages WHERE project_id = %s", case.bench.team["project"]
    ) == [(0,)]
    # A reminder only moves forward (the table refuses one moved back).
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="only moves forward"),
    ):
        connection.execute(
            "UPDATE design_review_requests SET reminded_at = reminded_at - interval '2 hours' "
            "WHERE id = %s",
            (UUID(last["id"]),),
        )


def test_only_the_named_reviewer_signs_and_the_sign_off_ends_the_request(
    migrated: Database,
) -> None:
    case = _Review(migrated, "drr-sign")
    second_id, second = case.reviewer_named()
    case.sent(case.reviewer_id)
    request = case.standing()
    told = in_review_with(case.bench.name(case.reviewer_id))

    # Another reviewer: told who it is with; nothing signed.
    theirs = case.body(second)
    assert told in theirs["blocking"] and theirs["can_sign"] is False
    _refused(case.sign(request["id"], second), 403, told)
    # The named reviewer, without the request or naming another: stale.
    _refused(case.sign(None), 409, REQUEST_STALE)
    _refused(case.sign(uuid4()), 409, REQUEST_STALE)
    assert case.rows("SELECT count(*) FROM design_conclusions") == [(0,)]
    mine = case.body(case.reviewer)
    assert told not in mine["blocking"] and mine["can_sign"] is True

    signed = case.sign(request["id"])
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert (body["status"], body["review_request"]) == ("SIGNED_OFF", None)
    [row] = case.requests()
    assert (row[2], row[3]) == ("SIGNED", case.reviewer_id)
    [event] = case.events("design_conclusion.signed_off")
    assert event["request_id"] == request["id"]
    case.cleared()
    assert case.mine(case.reviewer) == {"count": 0, "requests": []}
    # A request that ended is never changed.
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="never changed"),
    ):
        connection.execute(
            "UPDATE design_review_requests SET reminded_at = clock_timestamp() WHERE id = %s",
            (UUID(request["id"]),),
        )
    del second_id


def test_return_to_preparer(migrated: Database) -> None:
    case = _Review(migrated, "drr-return")
    owner_id = case.bench.team["owner_id"]
    second_id, second = case.reviewer_named()
    case.sent(case.reviewer_id)
    request = case.standing()

    def returned(client: TestClient | None = None, **body: Any) -> Any:
        return case.act("return", client or case.reviewer, **({"request_id": request["id"]} | body))

    # Another reviewer, the owner (no reviewer role), a reason too short or too long, a
    # stale request: nothing is returned.
    _refused(
        returned(second, reason=REASON), 403, in_review_with(case.bench.name(case.reviewer_id))
    )
    _refused(returned(case.bench.owner, reason=REASON), 409,
             "only a team member with the reviewer role can do this")  # fmt: skip
    _refused(returned(reason="Too short"), 422, RETURN_REASON_NEEDED)
    _refused(returned(reason="x" * 1001), 422, RETURN_REASON_TOO_LONG)
    _refused(returned(request_id=str(uuid4()), reason=REASON), 409, REQUEST_STALE)
    assert case.status() == "PREPARED" and case.requests()[0][2] is None

    # Returned: the request ends RETURNED with the reason, and the workpaper is a draft
    # again, through the existing reopening (its audit event).
    back = returned(reason="<b>" + REASON + "</b>")
    assert back.status_code == 200, back.text
    body = back.json()
    assert (body["workpaper"]["status"], body["review_request"]) == ("DRAFT", None)
    assert body["last_return"]["by"] == {
        "id": str(case.reviewer_id), "name": case.bench.name(case.reviewer_id),
    }  # fmt: skip
    assert body["last_return"]["reason"] == REASON
    assert case.requests() == [
        (case.reviewer_id, owner_id, "RETURNED", case.reviewer_id, REASON, "", case.version),
    ]
    [event] = case.events("design_review_request.returned")
    assert event["reason"] == REASON[:200]
    [reopened] = case.events("workpaper.reopened")
    assert reopened["because"] == "returned_by_reviewer"
    _refused(returned(reason=REASON), 409, NOT_IN_REVIEW)
    # The preparer sees it; the picker starts on the same reviewer, though two are offered.
    theirs = case.body()
    assert theirs["last_return"]["reason"] == REASON
    assert sum(item["offered"] for item in theirs["reviewers"]) == 2
    assert theirs["default_reviewer_id"] == str(case.reviewer_id)

    # Sign and send again: a new request, and the return is behind it.
    again = case.sent(case.reviewer_id)
    assert again["last_return"] is None and again["review_request"]["id"] != request["id"]
    # The sign-off names the new request, not the returned one.
    _refused(case.sign(request["id"]), 409, REQUEST_STALE)
    signed = case.sign(again["review_request"]["id"])
    assert signed.status_code == 200, signed.text
    assert [row[2] for row in case.requests()] == ["RETURNED", "SIGNED"]
    del second_id


def test_reopening_ends_the_request_and_preparing_again_supersedes_it(migrated: Database) -> None:
    case = _Review(migrated, "drr-reopen")
    owner_id = case.bench.team["owner_id"]
    case.sent(case.reviewer_id)

    # The preparer reopens the workpaper: the request ends REOPENED with the reason.
    case.reopen()
    [row] = case.requests()
    assert (row[2], row[3], row[4]) == ("REOPENED", owner_id, "To conclude on what changed.")
    [event] = case.events("design_review_request.ended")
    assert event["ended_as"] == "REOPENED"
    assert case.body()["review_request"] is None and case.body()["last_return"] is None

    # A request still standing on a workpaper that became a draft some other way (written
    # directly here) is superseded when the workpaper is prepared again, in the same
    # transaction that opens the new one.
    case.sent(case.reviewer_id)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET status = 'DRAFT', prepared_by = NULL, prepared_at = NULL, "
            "prepared_version = NULL, version = version + 1 WHERE id = %s",
            (UUID(case.paper()["id"]),),
        )
    case.sent(case.reviewer_id)
    assert [row[2] for row in case.requests()] == ["REOPENED", "SUPERSEDED", None]
    # So is one standing when the workpaper is prepared by the plain prepare.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET status = 'DRAFT', prepared_by = NULL, prepared_at = NULL, "
            "prepared_version = NULL, version = version + 1 WHERE id = %s",
            (UUID(case.paper()["id"]),),
        )
    case.prepare()
    assert [row[2] for row in case.requests()] == ["REOPENED", "SUPERSEDED", "SUPERSEDED"]
    assert case.body()["review_request"] is None
    # Prepared without a request (the plain prepare): the sign-off names none.
    signed = case.sign(None)
    assert signed.status_code == 200, signed.text


# --- Home --------------------------------------------------------------------------------


def test_the_reviewers_list_on_home(migrated: Database) -> None:
    case = _Review(migrated, "drr-home")
    bench = case.bench
    owner_id = bench.team["owner_id"]
    assert case.mine(case.reviewer) == {"count": 0, "requests": []}
    case.sent(case.reviewer_id, MESSAGE)
    request = case.standing()

    found = case.mine(case.reviewer)
    assert found["count"] == 1
    [line] = found["requests"]
    [(ref, title)] = case.rows(
        "SELECT control_ref, title FROM engagement_controls WHERE id = %s", UUID(bench.control)
    )
    assert line == {
        "id": request["id"], "control_id": bench.control, "control_reference": ref,
        "control_title": title, "stage": "DESIGN",
        "sent_by": {"id": str(owner_id), "name": bench.name(owner_id)},
        "sent_at": line["sent_at"], "message": MESSAGE, "reminded_at": None,
        "version": case.version, "conclusion": "EFFECTIVE", "conclusion_words": "Effective",
        "urgent_notes": 0,
    }  # fmt: skip
    # The preparer has nothing waiting for them.
    assert case.mine(bench.owner) == {"count": 0, "requests": []}

    # An urgent review note on the workpaper: the line says so.
    raised = case.reviewer.post(
        f"{bench.base}/workpapers/{case.paper_id}/review-notes",
        json={"anchor_kind": "WORKPAPER", "workpaper_version": 1,
              "text": "The walkthrough does not name the approver.", "criticality": "URGENT",
              "owner_id": str(owner_id)},
    )  # fmt: skip
    assert raised.status_code == 200, raised.text
    assert case.mine(case.reviewer)["requests"][0]["urgent_notes"] == 1

    # Another firm's person is not shown it; nobody signed in is refused.
    outsider = _Bench(migrated, "drr-home-b").client
    assert outsider.get(f"{bench.base}/review-requests/mine").status_code == 404
    assert TestClient(bench.owner.app).get(f"{bench.base}/review-requests/mine").status_code == 401
    with connect(migrated.url) as connection:
        stranger_id = _add_user(
            connection, bench.team["org"], f"stranger-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
    assert _session(migrated, stranger_id).get(
        f"{bench.base}/review-requests/mine"
    ).status_code in (403, 404)


def test_the_home_list_is_one_query_whatever_its_length(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Home reads the reviewer's list and its urgent notes in one query: a waiting line
    adds no statement (no per-line count of urgent notes), and the count is still only
    the urgent notes that are open or responded to."""
    case = _Review(migrated, "drr-home-queries")
    bench = case.bench
    owner_id = bench.team["owner_id"]
    reviewer = Principal(kind=PrincipalKind.USER, id=case.reviewer_id)
    org, project = UUID(str(bench.team["org"])), UUID(str(bench.team["project"]))

    def counted() -> tuple[int, Any]:
        statements: list[Any] = []
        execute = psycopg.Cursor.execute

        def counting(self: Any, query: Any, *args: Any, **kwargs: Any) -> Any:
            statements.append(query)
            return execute(self, query, *args, **kwargs)

        with monkeypatch.context() as patched, connect(migrated.url) as connection:
            patched.setattr(psycopg.Cursor, "execute", counting)
            found = design_review_requests.mine(connection, reviewer, org, project)
        return len(statements), found

    none, empty = counted()
    assert (empty.count, empty.requests) == (0, [])
    assert none > 0
    case.sent(case.reviewer_id, MESSAGE)
    for criticality in ("URGENT", "NORMAL"):
        raised = case.reviewer.post(
            f"{bench.base}/workpapers/{case.paper_id}/review-notes",
            json={"anchor_kind": "WORKPAPER", "workpaper_version": 1,
                  "text": f"A {criticality.lower()} note on the walkthrough.",
                  "criticality": criticality, "owner_id": str(owner_id)},
        )  # fmt: skip
        assert raised.status_code == 200, raised.text
    one, found = counted()
    assert one == none
    [line] = found.requests
    [(ref,)] = case.rows(
        "SELECT control_ref FROM engagement_controls WHERE id = %s", UUID(bench.control)
    )
    assert (line.control_reference, line.urgent_notes) == (ref, 1)


# --- Who may write, and the archive ------------------------------------------------------


def test_agents_and_an_archived_engagement_are_refused(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Review(migrated, "drr-who")
    bench = case.bench
    # The routes take their principal from the session, always a person's: an agent
    # principal reaching them is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(design_conclusions, "_session_principal", lambda _request: agent)
        assert case.send(case.reviewer_id).status_code in (403, 404)
        assert bench.owner.get(f"{bench.base}/review-requests/mine").status_code in (403, 404)
    assert (case.status(), case.requests()) == ("DRAFT", [])
    # A firm Reviewer without TASK_UPDATE sends nothing.
    _viewer_id, viewer = bench.member("REVIEWER")
    assert case.send(case.reviewer_id, client=viewer).status_code == 403
    assert case.requests() == []

    case.sent(case.reviewer_id)
    request = case.standing()
    with monkeypatch.context() as patched:
        agent_reviewer = Principal(kind=PrincipalKind.AGENT, id=case.reviewer_id)
        patched.setattr(design_conclusions, "_session_principal", lambda _request: agent_reviewer)
        for action, body in (
            ("return", {"request_id": request["id"], "reason": REASON}),
            ("review-request/remind", {"request_id": request["id"]}),
        ):
            assert case.act(action, **body).status_code in (403, 404)
    assert case.requests()[0][2] is None

    # An archived engagement is read-only: the middleware refuses the change, and the
    # table refuses a write that reaches it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    _refused(case.act("review-request/remind", request_id=request["id"]), 409,
             closed_detail("ARCHIVED"))  # fmt: skip
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        connection.execute(
            "UPDATE design_review_requests SET reminded_at = clock_timestamp() WHERE id = %s",
            (UUID(request["id"]),),
        )
    assert case.mine(case.reviewer)["count"] == 1


def test_migration_0168_keeps_each_request_as_it_was_sent(migrated: Database) -> None:
    case = _Review(migrated, "drr-table")
    case.sent(case.reviewer_id, MESSAGE)
    request_id = UUID(case.standing()["id"])
    team = case.bench.team

    def refused(error: type[Exception], match: str, query: str, *params: Any) -> None:
        with connect(migrated.url) as connection, pytest.raises(error, match=match):
            connection.execute(query, params)

    raise_ = psycopg.errors.RaiseException
    refused(
        raise_,
        "never changes",
        "UPDATE design_review_requests SET message = 'changed' WHERE id = %s",
        request_id,
    )
    refused(
        raise_,
        "never changes",
        "UPDATE design_review_requests SET reviewer_id = sent_by WHERE id = %s",
        request_id,
    )
    refused(
        raise_,
        "only by a reminder or by ending",
        "UPDATE design_review_requests SET ended_reason = '' WHERE id = %s",
        request_id,
    )
    refused(raise_, "never deleted", "DELETE FROM design_review_requests WHERE id = %s", request_id)
    # A return gives its reason; other endings give none.
    refused(
        psycopg.errors.CheckViolation,
        "ended_reason",
        "UPDATE design_review_requests SET ended_at = clock_timestamp(), ended_by = sent_by, "
        "ended_as = 'RETURNED', ended_reason = 'short' WHERE id = %s",
        request_id,
    )
    refused(psycopg.errors.CheckViolation, "ended_reason",
            "UPDATE design_review_requests SET ended_at = clock_timestamp(), ended_by = sent_by, "
            "ended_as = 'SIGNED', ended_reason = 'A reason no signing gives.' WHERE id = %s",
            request_id)  # fmt: skip
    insert = (
        "INSERT INTO design_review_requests (organization_id, project_id, "
        "engagement_control_id, workpaper_id, workpaper_version, reviewer_id, sent_by) "
        "SELECT organization_id, project_id, engagement_control_id, workpaper_id, %s, "
        "reviewer_id, sent_by FROM design_review_requests WHERE id = %s"
    )
    # Only for the prepared version, and one standing per control.
    refused(raise_, "prepared version", insert, case.version + 1, request_id)
    refused(psycopg.errors.UniqueViolation, "design_review_requests_standing", insert,
            case.version, request_id)  # fmt: skip
    # Only for the control's own design workpaper.
    refused(raise_, "design workpaper",
            "INSERT INTO design_review_requests (organization_id, project_id, "
            "engagement_control_id, workpaper_id, workpaper_version, reviewer_id, sent_by) "
            "SELECT r.organization_id, r.project_id, r.engagement_control_id, w.id, 1, "
            "r.reviewer_id, r.sent_by FROM design_review_requests r JOIN workpapers w "
            "ON w.engagement_control_id = r.engagement_control_id AND w.stage <> 'DESIGN' "
            "WHERE r.id = %s", request_id)  # fmt: skip
    assert case.requests()[0][2] is None
    del team
