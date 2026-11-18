"""The preparer sends the D&I workpaper for review; the reviewer signs it in section 7
(product owner, 16 November 2026; docs/design-workpaper.md, section 3.8; migration 0168).

"Sign and send for review" is one press: it prepares the design workpaper through the
existing preparation (workpaper_service, section 3.7, its rules unchanged) and, in the same
transaction, opens a review request to the reviewer chosen. One request stands per control.

- **Who may be chosen.** The engagement's members who may sign the D&I conclusion
  (`control_reviews._is_reviewer`: the engagement role REVIEWER; anyone on the team where
  independence is off, as the sign-off itself). Where independence is required, the
  preparer and the person who recorded the standing conclusion are listed but not offered,
  with the reason (`why_not`). Each is listed with how many D&I workpapers of the
  engagement wait for them. The picker starts on the reviewer the viewer last sent to on
  the engagement while they can still be chosen, else on the only one who can, else on
  nobody (`default_of`).
- **While it stands.** Only the reviewer it names signs the conclusion (the sign-off names
  the request and ends it SIGNED in its own transaction) or returns it to the preparer
  (with a reason: the design workpaper is reopened through the existing path, and the
  request ends RETURNED). Another reviewer is told who it is with (403). The person who sent
  it, the workpaper's preparer or the engagement lead may change the reviewer (the request
  ends REASSIGNED and one opens to the new reviewer, under the same rules) or remind the
  reviewer, at most once an hour.
- **A reminder is an in-app notice only, never an email.** The platform has no in-app
  notification record for a person (the only notifications are support_notifications, the
  firm's own support mailbox), so a reminder is recorded on the request (`reminded_at`, the
  one column that changes, only forward) and shown where the reviewer reads what waits for
  them: the Home list (`GET …/review-requests/mine`) and the conclusion's `review_request`.
- **How a request ends otherwise.** Reopening the design workpaper, by the preparer or by
  the control's review, ends it REOPENED; preparing it again ends one still standing as
  SUPERSEDED. A request is never deleted and never rewritten.

Every write is a person's (TASK_UPDATE, never an agent) and one audit event, with the
message or the reason at most 200 characters in it. The message and the reason are the
person's own text, cleaned as text is (untrusted).

Where migration 0168 is not applied yet, nothing is on record: the reads find no request,
and the existing preparation and reopening go on as before (each read in a savepoint).
"""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from ai_workforce_api import independence
from ai_workforce_api.authorization import Action, NotVisible, Principal
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_text

logger = logging.getLogger(__name__)

EndedAs = Literal["SIGNED", "RETURNED", "REASSIGNED", "REOPENED", "SUPERSEDED"]

MESSAGE_MAX = 1000
REASON_MIN = 10
REASON_MAX = 1000
# How much of a message or a reason an audit event carries.
AUDIT_TEXT = 200
REMIND_EVERY = timedelta(hours=1)
# How many waiting requests the Home list carries at once (its count is the total).
MINE_LIMIT = 200

SENT = "design_review_request.sent"
REASSIGNED = "design_review_request.reassigned"
REMINDED = "design_review_request.reminded"
RETURNED = "design_review_request.returned"
ENDED = "design_review_request.ended"

NOT_MIGRATED = "D&I review requests are not on record: migration 0168 is not applied"

# Why a person is shown in the picker but not offered (where independence is required).
PREPARER_NOT_OFFERED = "Cannot review their own workpaper"
RECORDER_NOT_OFFERED = "Recorded the conclusion, so cannot sign it off"

# The refusals, each one sentence.
REVIEWER_NEEDED = "choose the reviewer to send the workpaper to"
MESSAGE_TOO_LONG = "the message can be at most 1,000 characters"
RETURN_REASON_NEEDED = f"give the reason in a sentence of at least {REASON_MIN} characters"
RETURN_REASON_TOO_LONG = "the reason can be at most 1,000 characters"
NOT_A_REVIEWER = "that person is not a reviewer on this engagement"
REVIEWER_IS_PREPARER = "the preparer cannot review their own workpaper; choose another reviewer"
REVIEWER_RECORDED = (
    "the person who recorded the conclusion cannot sign it off; choose another reviewer"
)
NOT_IN_REVIEW = "the design workpaper is not in review"
REQUEST_STALE = "the review request changed; read it again"
SAME_REVIEWER = "the workpaper is already in review with that person"
REMIND_TOO_SOON = "a reminder was sent less than an hour ago; remind again later"
CHANGE_FORBIDDEN = (
    "only the person who sent it, the preparer or the engagement lead changes the reviewer"
)
REMIND_FORBIDDEN = (
    "only the person who sent it, the preparer or the engagement lead sends a reminder"
)
ROLE_WORDS: dict[str, str] = {"LEAD": "Lead", "PREPARER": "Preparer", "REVIEWER": "Reviewer"}


def in_review_with(name: str) -> str:
    """What another reviewer is told where a request stands (403)."""
    return (
        f"this workpaper is in review with {name}; only they sign it off or return it, "
        "unless the preparer or the engagement lead makes you the reviewer"
    )


class ReviewForbidden(Exception):
    """The person may read the request and may not do this to it: a 403 with a sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class ReviewInvalid(Exception):
    """What was sent is not a message, a reason or a reviewer: a 422 with a sentence."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- The rules (pure) --------------------------------------------------------------------


def why_not(
    candidate: UUID, preparer: UUID | None, recorder: UUID | None, required: bool
) -> str | None:
    """Why a reviewer is shown and not offered: the preparer, or the person who recorded
    the standing conclusion, where independence is required. None where they are offered."""
    if not required:
        return None
    if preparer is not None and candidate == preparer:
        return PREPARER_NOT_OFFERED
    if recorder is not None and candidate == recorder:
        return RECORDER_NOT_OFFERED
    return None


def refusal_of(why: str | None) -> str | None:
    """The refusal of a send or a change to a reviewer who is not offered."""
    if why == PREPARER_NOT_OFFERED:
        return REVIEWER_IS_PREPARER
    if why == RECORDER_NOT_OFFERED:
        return REVIEWER_RECORDED
    return None


def default_of(offered: Sequence[UUID], last_sent_to: UUID | None) -> UUID | None:
    """Where the picker starts: the reviewer the viewer last sent to on the engagement,
    while they can still be chosen; else the only one who can; else nobody."""
    if last_sent_to is not None and last_sent_to in offered:
        return last_sent_to
    return offered[0] if len(offered) == 1 else None


def remind_refusal(reminded_at: datetime | None, now: datetime) -> str | None:
    """A reminder at most once an hour."""
    if reminded_at is not None and now - reminded_at < REMIND_EVERY:
        return REMIND_TOO_SOON
    return None


def may_manage(actor: UUID, sent_by: UUID, prepared_by: UUID | None, lead: bool) -> bool:
    """Who changes the reviewer or reminds them: the person who sent the request, the
    workpaper's preparer, or the engagement lead."""
    return actor == sent_by or (prepared_by is not None and actor == prepared_by) or lead


def clean_message(raw: str | None) -> str:
    """The sender's message as it is kept: their own text, cleaned (untrusted), at most
    MESSAGE_MAX characters; "" where none is given."""
    cleaned = clean_text(raw or "", MESSAGE_MAX)
    if cleaned.truncated:
        raise ReviewInvalid(MESSAGE_TOO_LONG)
    return cleaned.text.strip()


def clean_return_reason(raw: str) -> str:
    """The reviewer's reason for returning the workpaper: 10 to 1,000 characters."""
    cleaned = clean_text(raw, REASON_MAX)
    if cleaned.truncated:
        raise ReviewInvalid(RETURN_REASON_TOO_LONG)
    reason = cleaned.text.strip()
    if len(reason) < REASON_MIN:
        raise ReviewInvalid(RETURN_REASON_NEEDED)
    return reason


# --- What the page reads -----------------------------------------------------------------


class PersonRef(BaseModel):
    id: UUID
    name: str


class ReviewRequestRef(BaseModel):
    """The request that stands. `version` is the design workpaper's prepared version it
    was sent for; `reminded_at` the last reminder, or null."""

    id: UUID
    reviewer: PersonRef
    sent_by: PersonRef
    sent_at: datetime
    message: str
    reminded_at: datetime | None
    version: int


class ReturnRef(BaseModel):
    """The control's last request, where it was returned to the preparer and nothing has
    been sent since."""

    by: PersonRef
    at: datetime
    reason: str


class ReviewerOption(BaseModel):
    """A person who may sign the D&I conclusion. `waiting` is how many D&I workpapers of
    the engagement wait for them; `offered` whether they can be chosen now, and `why_not`
    why not where they cannot. `role` is their engagement role in words."""

    id: UUID
    name: str
    role: str
    waiting: int
    offered: bool
    why_not: str | None


class ReviewFields(BaseModel):
    review_request: ReviewRequestRef | None = None
    last_return: ReturnRef | None = None
    reviewers: list[ReviewerOption] = Field(default_factory=list)
    default_reviewer_id: UUID | None = None


@dataclass(frozen=True)
class Standing:
    id: UUID
    workpaper_id: UUID
    workpaper_version: int
    reviewer_id: UUID
    reviewer_name: str
    sent_by: UUID
    sent_by_name: str
    sent_at: datetime
    message: str
    reminded_at: datetime | None

    def ref(self) -> ReviewRequestRef:
        return ReviewRequestRef(
            id=self.id,
            reviewer=PersonRef(id=self.reviewer_id, name=self.reviewer_name),
            sent_by=PersonRef(id=self.sent_by, name=self.sent_by_name),
            sent_at=self.sent_at,
            message=self.message,
            reminded_at=self.reminded_at,
            version=self.workpaper_version,
        )


def _tolerant[T](connection: psycopg.Connection[Any], read: Callable[[], T], absent: T) -> T:
    """`read`, in a savepoint: where migration 0168 is not applied, `absent`, and the
    caller's transaction as it was."""
    try:
        with connection.transaction():
            return read()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return absent


def standing(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, lock: bool = False
) -> Standing | None:
    """The request that stands on the control, or None. Locked where it is to change."""

    def read() -> Standing | None:
        row = connection.execute(
            """
            SELECT r.id, r.workpaper_id, r.workpaper_version, r.reviewer_id, v.display_name,
                   r.sent_by, s.display_name, r.sent_at, r.message, r.reminded_at
            FROM design_review_requests r
            LEFT JOIN users v ON v.id = r.reviewer_id
            LEFT JOIN users s ON s.id = r.sent_by
            WHERE r.project_id = %s AND r.engagement_control_id = %s AND r.ended_at IS NULL
            """
            + (" FOR UPDATE OF r" if lock else ""),
            (project_id, control_id),
        ).fetchone()
        if row is None:
            return None
        return Standing(
            id=UUID(str(row[0])),
            workpaper_id=UUID(str(row[1])),
            workpaper_version=int(row[2]),
            reviewer_id=UUID(str(row[3])),
            reviewer_name=str(row[4] or ""),
            sent_by=UUID(str(row[5])),
            sent_by_name=str(row[6] or ""),
            sent_at=row[7],
            message=str(row[8]),
            reminded_at=row[9],
        )

    return _tolerant(connection, read, None)


def last_return(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ReturnRef | None:
    """The control's last request, where it was returned (and none was sent since)."""

    def read() -> ReturnRef | None:
        row = connection.execute(
            """
            SELECT r.ended_as, r.ended_by, u.display_name, r.ended_at, r.ended_reason
            FROM design_review_requests r LEFT JOIN users u ON u.id = r.ended_by
            WHERE r.project_id = %s AND r.engagement_control_id = %s
            ORDER BY r.sent_at DESC, r.id DESC LIMIT 1
            """,
            (project_id, control_id),
        ).fetchone()
        if row is None or row[0] != "RETURNED":
            return None
        return ReturnRef(
            by=PersonRef(id=UUID(str(row[1])), name=str(row[2] or "")),
            at=row[3],
            reason=str(row[4]),
        )

    return _tolerant(connection, read, None)


def _waiting(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, int]:
    def read() -> dict[UUID, int]:
        return {
            UUID(str(row[0])): int(row[1])
            for row in connection.execute(
                "SELECT reviewer_id, count(*) FROM design_review_requests "
                "WHERE project_id = %s AND ended_at IS NULL GROUP BY reviewer_id",
                (project_id,),
            ).fetchall()
        }

    return _tolerant(connection, read, {})


def reviewers(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    preparer: UUID | None,
    recorder: UUID | None,
) -> list[ReviewerOption]:
    """The engagement's members who may sign the D&I conclusion (the rule the sign-off
    uses, `control_reviews._is_reviewer`), each active, with an active membership of the
    firm (a demo identity only on a demo engagement), by name."""
    required = independence.required()
    rows = connection.execute(
        """
        SELECT u.id, u.display_name, pm.engagement_role
        FROM project_memberships AS pm
        JOIN projects AS p ON p.id = pm.project_id AND p.organization_id = pm.organization_id
        JOIN users AS u ON u.id = pm.user_id
        JOIN memberships AS m
          ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
        WHERE pm.organization_id = %s
          AND pm.project_id = %s
          AND p.deleted_at IS NULL
          AND m.status = 'ACTIVE'
          AND u.status = 'ACTIVE'
          AND (u.demo_organization_id IS NULL OR p.demo)
          AND (NOT %s OR pm.engagement_role = 'REVIEWER')
        ORDER BY u.display_name, u.id
        """,
        (organization_id, project_id, required),
    ).fetchall()
    waiting = _waiting(connection, project_id)
    options: list[ReviewerOption] = []
    for row in rows:
        person = UUID(str(row[0]))
        reason = why_not(person, preparer, recorder, required)
        options.append(
            ReviewerOption(
                id=person,
                name=str(row[1]),
                role=ROLE_WORDS.get(str(row[2]), str(row[2]).capitalize()),
                waiting=waiting.get(person, 0),
                offered=reason is None,
                why_not=reason,
            )
        )
    return options


def last_sent_to(
    connection: psycopg.Connection[Any], project_id: UUID, sender: UUID
) -> UUID | None:
    """The reviewer the person last sent a D&I workpaper to on the engagement."""

    def read() -> UUID | None:
        row = connection.execute(
            "SELECT reviewer_id FROM design_review_requests WHERE project_id = %s "
            "AND sent_by = %s ORDER BY sent_at DESC, id DESC LIMIT 1",
            (project_id, sender),
        ).fetchone()
        return None if row is None else UUID(str(row[0]))

    return _tolerant(connection, read, None)


def fields(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    viewer: UUID,
    prepared_by: UUID | None,
    recorder: UUID | None,
) -> ReviewFields:
    """What the D&I conclusion's body carries of the review request. The preparer the
    picker leaves out is the workpaper's, once prepared; before, the viewer, who would
    prepare it by sending it."""
    preparer = prepared_by if prepared_by is not None else viewer
    options = reviewers(connection, organization_id, project_id, preparer, recorder)
    request = standing(connection, project_id, control_id)
    offered = [option.id for option in options if option.offered]
    return ReviewFields(
        review_request=None if request is None else request.ref(),
        last_return=None
        if request is not None
        else last_return(connection, project_id, control_id),
        reviewers=options,
        default_reviewer_id=default_of(offered, last_sent_to(connection, project_id, viewer)),
    )


def eligibility_refusal(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    reviewer_id: UUID,
    preparer: UUID | None,
    recorder: UUID | None,
) -> str | None:
    """Why the person cannot be sent the workpaper: not someone who may sign it, or not
    offered (the picker's rules). None where they can."""
    options = reviewers(connection, organization_id, project_id, preparer, recorder)
    found = next((option for option in options if option.id == reviewer_id), None)
    if found is None:
        return NOT_A_REVIEWER
    return refusal_of(found.why_not)


# --- Writing -----------------------------------------------------------------------------


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    request_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'design_review_request', %s, %s)
        """,
        (organization_id, project_id, actor, action, request_id, Json(payload)),
    )


def open_request(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    workpaper_id: UUID,
    workpaper_version: int,
    reviewer_id: UUID,
    sender: UUID,
    message: str,
) -> UUID:
    row = cursor.execute(
        """
        INSERT INTO design_review_requests (
            organization_id, project_id, engagement_control_id, workpaper_id,
            workpaper_version, reviewer_id, sent_by, message
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (organization_id, project_id, control_id, workpaper_id, workpaper_version,
         reviewer_id, sender, message),
    ).fetchone()  # fmt: skip
    assert row is not None
    return UUID(str(row[0]))


def end(
    cursor: psycopg.Cursor[Any], request_id: UUID, actor: UUID, ended_as: EndedAs, reason: str = ""
) -> None:
    cursor.execute(
        """
        UPDATE design_review_requests
        SET ended_at = clock_timestamp(), ended_by = %s, ended_as = %s, ended_reason = %s
        WHERE id = %s AND ended_at IS NULL
        """,
        (actor, ended_as, reason, request_id),
    )


def end_standing(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    ended_as: Literal["REOPENED", "SUPERSEDED"],
    reason: str = "",
) -> UUID | None:
    """The design workpaper was reopened (REOPENED, with the reopening's reason) or is
    prepared again (SUPERSEDED): the request that stands, if any, ends, in the caller's
    transaction, with an audit event. Where migration 0168 is not applied, nothing."""
    request = standing(cursor.connection, project_id, control_id, lock=True)
    if request is None:
        return None
    kept = clean_text(reason, REASON_MAX).text.strip() if ended_as == "REOPENED" else ""
    end(cursor, request.id, actor, ended_as, kept)
    _audit(cursor, organization_id, project_id, actor, request.id, ENDED,
           {"control_id": str(control_id), "ended_as": ended_as,
            "reviewer_id": str(request.reviewer_id), "reason": kept[:AUDIT_TEXT]})  # fmt: skip
    return request.id


def _is_lead(connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID) -> bool:
    row = connection.execute(
        "SELECT 1 FROM project_memberships WHERE project_id = %s AND user_id = %s "
        "AND engagement_role = 'LEAD'",
        (project_id, user_id),
    ).fetchone()
    return row is not None


def _paper(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID
) -> tuple[UUID, str, UUID | None, UUID] | None:
    """The control's design workpaper, locked: (id, status, prepared_by, organization)."""
    row = cursor.execute(
        "SELECT id, status, prepared_by, organization_id FROM workpapers "
        "WHERE project_id = %s AND engagement_control_id = %s AND stage = 'DESIGN' FOR UPDATE",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        return None
    return (
        UUID(str(row[0])),
        str(row[1]),
        None if row[2] is None else UUID(str(row[2])),
        UUID(str(row[3])),
    )


class SendBody(BaseModel):
    """Sign and send for review. `workpaper_version` is the design workpaper's record
    version the page shows (`workpaper.version` in the D&I conclusion, the prepare's
    `version`), so a page that has not seen a change prepares nothing. The message is read
    and bounded in code (`clean_message`), so that each refusal is one plain sentence."""

    model_config = ConfigDict(extra="forbid")

    workpaper_version: int = Field(ge=1)
    reviewer_id: UUID | None = None
    message: str | None = Field(default=None, max_length=4 * MESSAGE_MAX)
    prepare_note: str = Field(default="", max_length=500)


class ReviewerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    reviewer_id: UUID


class RemindBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID


class ReturnBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: UUID
    reason: str = Field(max_length=4 * REASON_MAX)


def _control_found(cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID) -> None:
    """A control of another engagement, or none, is not found."""
    row = cursor.execute(
        "SELECT 1 FROM engagement_controls WHERE project_id = %s AND id = %s",
        (project_id, control_id),
    ).fetchone()
    if row is None:
        raise NotVisible()


def _standing_or_refused(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, request_id: UUID
) -> Standing:
    request = standing(cursor.connection, project_id, control_id, lock=True)
    if request is None:
        raise _state(NOT_IN_REVIEW)
    if request.id != request_id:
        raise _state(REQUEST_STALE)
    return request


def _state(detail: str) -> Exception:
    from ai_workforce_api.design_conclusions import DesignConclusionState

    return DesignConclusionState(detail)


def send_for_review(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: SendBody,
) -> Any:
    """Sign and send for review: prepare the design workpaper (the existing preparation,
    its rules and its record) and open the request to the reviewer, in one transaction.
    Refused, with nothing prepared, where no reviewer is chosen, where the one chosen may
    not sign it or is not offered, and wherever the preparation is refused."""
    from ai_workforce_api import design_conclusions
    from ai_workforce_api.workpaper_service import PrepareBody, prepare_in

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_UPDATE)  # fmt: skip
    if body.reviewer_id is None:
        raise ReviewInvalid(REVIEWER_NEEDED)
    message = clean_message(body.message)
    with transaction(connection) as cursor:
        # The workpaper row is locked first, as the preparation and a choice lock it.
        paper = _paper(cursor, project_id, control_id)
        if paper is None:
            _control_found(cursor, project_id, control_id)
            raise _state(design_conclusions.DRAFT_FIRST)
        _choice, recorder = design_conclusions._standing_choice(
            cursor.connection, project_id, control_id
        )
        refusal = eligibility_refusal(
            cursor.connection, organization_id, project_id, body.reviewer_id, principal.id,
            recorder,
        )  # fmt: skip
        if refusal is not None:
            raise _state(refusal)
        prepare_in(
            cursor, principal, organization_id, project_id, paper[0],
            PrepareBody(version=body.workpaper_version, note=body.prepare_note),
        )  # fmt: skip
        row = cursor.execute(
            "SELECT prepared_version FROM workpapers WHERE id = %s", (paper[0],)
        ).fetchone()
        assert row is not None and row[0] is not None
        version = int(row[0])
        request_id = open_request(
            cursor, paper[3], project_id, control_id, paper[0], version, body.reviewer_id,
            principal.id, message,
        )  # fmt: skip
        _audit(cursor, paper[3], project_id, principal.id, request_id, SENT,
               {"control_id": str(control_id), "workpaper_id": str(paper[0]),
                "workpaper_version": version, "reviewer_id": str(body.reviewer_id),
                "message": message[:AUDIT_TEXT]})  # fmt: skip
    return design_conclusions._viewed(connection, principal, organization_id, project_id,
                                      control_id)  # fmt: skip


def change_reviewer(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ReviewerBody,
) -> Any:
    """Change reviewer: the request that stands ends REASSIGNED and one opens to the new
    reviewer, for the same prepared version and with the same message. By the person who
    sent it, the preparer or the engagement lead; the picker's rules apply."""
    from ai_workforce_api import design_conclusions

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_UPDATE)  # fmt: skip
    with transaction(connection) as cursor:
        paper = _paper(cursor, project_id, control_id)
        if paper is None:
            _control_found(cursor, project_id, control_id)
            raise _state(NOT_IN_REVIEW)
        request = _standing_or_refused(cursor, project_id, control_id, body.request_id)
        lead = _is_lead(cursor.connection, project_id, principal.id)
        if not may_manage(principal.id, request.sent_by, paper[2], lead):
            raise ReviewForbidden(CHANGE_FORBIDDEN)
        if body.reviewer_id == request.reviewer_id:
            raise _state(SAME_REVIEWER)
        _choice, recorder = design_conclusions._standing_choice(
            cursor.connection, project_id, control_id
        )
        refusal = eligibility_refusal(
            cursor.connection, organization_id, project_id, body.reviewer_id, paper[2], recorder
        )
        if refusal is not None:
            raise _state(refusal)
        end(cursor, request.id, principal.id, "REASSIGNED")
        opened = open_request(
            cursor, paper[3], project_id, control_id, request.workpaper_id,
            request.workpaper_version, body.reviewer_id, principal.id, request.message,
        )  # fmt: skip
        _audit(cursor, paper[3], project_id, principal.id, opened, REASSIGNED,
               {"control_id": str(control_id), "replaced": str(request.id),
                "from_reviewer_id": str(request.reviewer_id),
                "reviewer_id": str(body.reviewer_id),
                "workpaper_version": request.workpaper_version})  # fmt: skip
    return design_conclusions._viewed(connection, principal, organization_id, project_id,
                                      control_id)  # fmt: skip


def remind(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: RemindBody,
) -> Any:
    """Remind the reviewer: an in-app notice (recorded on the request and shown in the
    reviewer's list), at most once an hour; never an email."""
    from ai_workforce_api import design_conclusions

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_UPDATE)  # fmt: skip
    with transaction(connection) as cursor:
        paper = _paper(cursor, project_id, control_id)
        if paper is None:
            _control_found(cursor, project_id, control_id)
            raise _state(NOT_IN_REVIEW)
        request = _standing_or_refused(cursor, project_id, control_id, body.request_id)
        lead = _is_lead(cursor.connection, project_id, principal.id)
        if not may_manage(principal.id, request.sent_by, paper[2], lead):
            raise ReviewForbidden(REMIND_FORBIDDEN)
        # The hour is the database's clock, in the same statement that records the reminder.
        row = cursor.execute(
            """
            UPDATE design_review_requests SET reminded_at = clock_timestamp()
            WHERE id = %s AND ended_at IS NULL
              AND (reminded_at IS NULL OR reminded_at <= clock_timestamp() - %s)
            RETURNING reminded_at
            """,
            (request.id, REMIND_EVERY),
        ).fetchone()
        if row is None:
            raise _state(REMIND_TOO_SOON)
        _audit(cursor, paper[3], project_id, principal.id, request.id, REMINDED,
               {"control_id": str(control_id), "reviewer_id": str(request.reviewer_id),
                "delivery": "IN_APP"})  # fmt: skip
    return design_conclusions._viewed(connection, principal, organization_id, project_id,
                                      control_id)  # fmt: skip


def return_to_preparer(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    body: ReturnBody,
) -> Any:
    """Return to preparer: by the reviewer the request names, with a reason (10 to 1,000
    characters). The request ends RETURNED with the reason, and the design workpaper goes
    back to a draft through the existing reopening, in the same transaction."""
    from ai_workforce_api import design_conclusions
    from ai_workforce_api.workpaper_service import _reopen_prepared

    design_conclusions._reviewer(connection, principal, organization_id, project_id)
    reason = clean_return_reason(body.reason)
    with transaction(connection) as cursor:
        paper = _paper(cursor, project_id, control_id)
        if paper is None:
            _control_found(cursor, project_id, control_id)
            raise _state(NOT_IN_REVIEW)
        request = standing(cursor.connection, project_id, control_id, lock=True)
        if request is None:
            raise _state(NOT_IN_REVIEW)
        if request.reviewer_id != principal.id:
            raise ReviewForbidden(in_review_with(request.reviewer_name))
        if request.id != body.request_id:
            raise _state(REQUEST_STALE)
        end(cursor, request.id, principal.id, "RETURNED", reason)
        if paper[1] == "PREPARED":
            # The existing reopening of a design workpaper (workpaper_service._reopen):
            # the D&I conclusion that rests on it opens again, then the workpaper.
            design_conclusions.reopen_for_workpaper(
                cursor, paper[3], project_id, control_id, principal.id, reason
            )
            _reopen_prepared(
                cursor, paper[3], project_id, principal.id, paper[0],
                {"reason": reason[:AUDIT_TEXT], "because": "returned_by_reviewer",
                 "request_id": str(request.id)},
            )  # fmt: skip
        _audit(cursor, paper[3], project_id, principal.id, request.id, RETURNED,
               {"control_id": str(control_id), "workpaper_version": request.workpaper_version,
                "reason": reason[:AUDIT_TEXT]})  # fmt: skip
    return design_conclusions._viewed(connection, principal, organization_id, project_id,
                                      control_id)  # fmt: skip


# --- The reviewer's list on Home ---------------------------------------------------------


class WaitingRequest(BaseModel):
    """One D&I workpaper waiting for the viewer's review. `conclusion` is the preparer's
    standing conclusion (null where none stands); `urgent_notes` the workpaper's urgent
    review notes that are open or responded to, which hold the sign-off. The control's
    reference is `control_reference`, the name the web's Home list reads."""

    id: UUID
    control_id: UUID
    control_reference: str
    control_title: str
    stage: Literal["DESIGN"] = "DESIGN"
    sent_by: PersonRef
    sent_at: datetime
    message: str
    reminded_at: datetime | None
    version: int
    conclusion: str | None
    conclusion_words: str | None
    urgent_notes: int


class MineBody(BaseModel):
    count: int
    requests: list[WaitingRequest]


def mine(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
) -> MineBody:
    """The viewer's standing requests on the engagement, the longest waiting first. One
    query lists them with their urgent notes (counted for the engagement's workpapers in
    one grouped subquery, as `workpaper_review_notes.urgent_open` counts them for one), so
    a long list costs no more round trips than a short one. Migration 0166, which holds
    the notes, comes before 0168: where the requests are on record, so are the notes."""
    from ai_workforce_api import design_conclusions

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_READ)  # fmt: skip

    def read() -> MineBody:
        total = connection.execute(
            "SELECT count(*) FROM design_review_requests WHERE project_id = %s "
            "AND organization_id = %s AND reviewer_id = %s AND ended_at IS NULL",
            (project_id, organization_id, principal.id),
        ).fetchone()
        rows = connection.execute(
            """
            SELECT r.id, r.engagement_control_id, c.control_ref, c.title, r.sent_by,
                   s.display_name, r.sent_at, r.message, r.reminded_at, r.workpaper_version,
                   (SELECT ch.kind FROM design_conclusion_choices ch
                    WHERE ch.project_id = r.project_id
                      AND ch.engagement_control_id = r.engagement_control_id
                      AND ch.ended_at IS NULL),
                   coalesce(u.urgent, 0)
            FROM design_review_requests r
            JOIN engagement_controls c
              ON c.project_id = r.project_id AND c.id = r.engagement_control_id
            LEFT JOIN users s ON s.id = r.sent_by
            LEFT JOIN (
                SELECT n.workpaper_id, count(*) AS urgent
                FROM workpaper_review_notes n
                WHERE n.project_id = %s AND n.criticality = 'URGENT'
                  AND n.status IN ('OPEN', 'RESPONDED')
                GROUP BY n.workpaper_id
            ) u ON u.workpaper_id = r.workpaper_id
            WHERE r.project_id = %s AND r.organization_id = %s AND r.reviewer_id = %s
              AND r.ended_at IS NULL
            ORDER BY r.sent_at, r.id
            LIMIT %s
            """,
            (project_id, project_id, organization_id, principal.id, MINE_LIMIT),
        ).fetchall()
        return MineBody(
            count=0 if total is None else int(total[0]),
            requests=[
                WaitingRequest(
                    id=UUID(str(row[0])),
                    control_id=UUID(str(row[1])),
                    control_reference=str(row[2]),
                    control_title=str(row[3]),
                    sent_by=PersonRef(id=UUID(str(row[4])), name=str(row[5] or "")),
                    sent_at=row[6],
                    message=str(row[7]),
                    reminded_at=row[8],
                    version=int(row[9]),
                    conclusion=None if row[10] is None else str(row[10]),
                    conclusion_words=None
                    if row[10] is None
                    else design_conclusions.KIND_WORDS.get(str(row[10])),
                    urgent_notes=int(row[11]),
                )
                for row in rows
            ],
        )

    return _tolerant(connection, read, MineBody(count=0, requests=[]))


def register_design_review_requests(
    app: FastAPI,
    base: str,
    run: Callable[[Request, Callable[[psycopg.Connection[Any], Principal], Any]], Any],
    response_model: type[BaseModel],
) -> None:
    """The routes of section 3.8, under the D&I conclusion's base, answered by its `run`
    (which maps each refusal to its status) with the D&I conclusion's body; and the
    reviewer's list for Home."""

    @app.post(f"{base}/{{control_id}}/send-for-review", response_model=response_model)
    def sent(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: SendBody,
        request: Request,
    ) -> Any:  # fmt: skip
        return run(
            request,
            lambda c, p: send_for_review(c, p, organization_id, project_id, control_id, body),
        )

    @app.post(f"{base}/{{control_id}}/review-request/reviewer", response_model=response_model)
    def reassigned(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ReviewerBody,
        request: Request,
    ) -> Any:  # fmt: skip
        return run(
            request,
            lambda c, p: change_reviewer(c, p, organization_id, project_id, control_id, body),
        )

    @app.post(f"{base}/{{control_id}}/review-request/remind", response_model=response_model)
    def reminded(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: RemindBody,
        request: Request,
    ) -> Any:  # fmt: skip
        return run(
            request, lambda c, p: remind(c, p, organization_id, project_id, control_id, body)
        )

    @app.post(f"{base}/{{control_id}}/return", response_model=response_model)
    def returned(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ReturnBody,
        request: Request,
    ) -> Any:  # fmt: skip
        return run(
            request,
            lambda c, p: return_to_preparer(c, p, organization_id, project_id, control_id, body),
        )

    @app.get(
        "/organizations/{organization_id}/projects/{project_id}/review-requests/mine",
        response_model=MineBody,
    )
    def waiting(organization_id: UUID, project_id: UUID, request: Request) -> MineBody:
        found: MineBody = run(request, lambda c, p: mine(c, p, organization_id, project_id))
        return found
