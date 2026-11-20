"""What relies on an evidence file, and which changes that reliance refuses (increment E1,
evidence reliance; product owner, 18 November 2026).

One place says why a file cannot be withdrawn, replaced, moved, taken off an item or a
request, or read again: `reliances` lists every reliance on the file, `check` refuses a
change with the first reliance it would break, and `impact` says, read-only, what a change
would do before a person makes it. Evidence someone relied on stays until that person's
decision is changed or the work that rests on it is reopened.

The reliances, in the order a refusal names them:

- READING: the agent is still reading the file.
- SCREENSHOT_SIGNED: its screenshot review is decided.
- APPROVED_SAMPLE: an approved sample was drawn from it (a population file).
- ACCEPTED_ITEM: a person accepted an evidence item it served at the time (a file that
  came to serve it after the acceptance, one filed back onto its request included, was not
  part of it: the time its filing landed counts, not when it was stored; migration 0176).
- SIGNED_TESTING: it is on an item of signed-off testing.
- PREPARED_WORKPAPER: a prepared workpaper's current version cites it.
- TICKMARK: a person rested an attribute's "Shown, on my review" on their own annotation
  of the file.
- RELIABILITY: a person's reliability decision on the file stands.
- WALKTHROUGH_PICK: the current walkthrough instance of a design item was picked from the
  file, or named in it.
- SIGNED_DI_CONCLUSION: the control's signed D&I conclusion, not reopened, was signed while
  the file served one of its design items.
- SENT_FINDING: an open finding on the file that a person decided or sent to the client,
  not stale.

Which reliances a change must respect (`blocks`): a withdrawal or replacement every one; a
removal from an item or a request, or an unlink, only those on that item (or, for the
file's filing, on that request's items, and on the sibling instances' items the filing
shares the file with), with the reading and the screenshot review; a move those on the
file's control (its family of instances), with the reading and the screenshot review; a
new reading every one but the reading itself (refused already); a restoration none.
Changing the applications a file applies to respects those on the sibling items it would
stop serving (B3 of the E1 review).

A refusal is a RelianceRefused, answered 409 by every route that makes one of these
changes.

The lock order (E1, 18 November 2026: a reading and a wizard batch's landing deadlocked,
and the reading's check of its file was lost). Every transaction that locks rows of more
than one of these tables takes them in this order, and within a table in this order:

1. evidence_plans, by control id (lock_served);
2. evidence_requirements, by id (lock_served); then pbc_requests, a requirement's request
   (evidence_plans._request_held, before an item on a draft is reworded or removed; a
   reading's receipt, evidence_receipts.apply_receipt, before its checks are queued);
3. evidence_assessments, the current runs of each control, the controls by id
   (evidence_assurance.queue_for_file) and a control's runs by created_at, then id
   (evidence_assurance.reconcile, which every queueing of a check goes through);
   Then evidence_assessment_retries, by control id (migration 0177): reconcile removes a
   control's row after its runs; a failed queueing records it after its savepoint was
   rolled back (evidence_assurance.record_queue_failure);
4. test_sheets, by id (testing_engine.request_run, runs_for_file, off_open_sheets).

So a change brings the checks in step before it asks the tester to look again: a reading
queues its file's checks before its tests (evidence_analysis.run_analysis), a move lands
the wizard's batch before it takes the file off the open sheets (evidence_intake._file),
and a restoration queues its checks before testing again (evidence_versions.restore_file).
A transaction that waits on a lock earlier in the order then holds nothing later in it, so
the two cannot wait on each other. Each site says "(lock order: evidence_reliance)".

The plan before the sheets holds for the sheet's own changes too (ST-1, 19 November 2026):
plan approval and accepted criteria hold the plan and then bring the control's open sheets
in step (testing_engine.resync_open_sheets, after testing_engine.lock_plan), so every change
of a sheet (test_sheets.change_sheet), a review's lock (control_reviews._locked, before a
review note reopens the testing) and an impact assessment's reperformance
(plan_impact.decide) take the plan first. Before, a sign-off or a reopening locked the
sheet and then the plan (refresh_decisions), and could wait on an approval waiting on it.
A client value's fill (control_design.refresh_statement) takes the plan before it puts the
control's runs out of date and brings its sheets in step; a fill of several controls
(set_values everywhere, set_values_many) takes every plan, by control id, before any.

Known exceptions, left for the lock work of P1 I4a (18 November 2026). A foreign key check
takes a key-share lock on the row it references, which waits on FOR UPDATE (lock_served
takes it on the items):

- reconcile records a run after it has locked the control's runs, so its key-share lock on
  the item (step 2) comes after step 3: a change that holds the item (lock_served) and then
  queues its checks can wait on a reconcile that waits on it;
- recording a tickmark's disposition (attribute_dispositions.record) or a reliability
  decision (file_reliability.record) locks the request's current run and then inserts a row
  that references the item: step 3, then step 2;
- a withdrawal queues its checks (step 3) before its request follows the evidence left on
  it (evidence_receipts.follow_evidence locks the request, step 2), while a reading takes
  its request's receipt before it queues its checks: the two can wait on each other.

A key-share lock on a control's items taken before its runs closes the first, but makes
the third more likely; it was tried and not kept.
"""

from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

from ai_workforce_api.authorization import NotVisible
from ai_workforce_api.control_instances import family_ids


class RelianceRefused(Exception):
    """A change refused because something relies on the file, or because the file does
    not serve the item named: answered 409 with `detail`."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


Kind = Literal[
    "READING",
    "SCREENSHOT_SIGNED",
    "APPROVED_SAMPLE",
    "ACCEPTED_ITEM",
    "SIGNED_TESTING",
    "PREPARED_WORKPAPER",
    "TICKMARK",
    "RELIABILITY",
    "WALKTHROUGH_PICK",
    "SIGNED_DI_CONCLUSION",
    "SENT_FINDING",
]
KINDS: tuple[Kind, ...] = (
    "READING",
    "SCREENSHOT_SIGNED",
    "APPROVED_SAMPLE",
    "ACCEPTED_ITEM",
    "SIGNED_TESTING",
    "PREPARED_WORKPAPER",
    "TICKMARK",
    "RELIABILITY",
    "WALKTHROUGH_PICK",
    "SIGNED_DI_CONCLUSION",
    "SENT_FINDING",
)
# Reliance on the file as a whole: every change but a restoration respects it.
FILE_WIDE: frozenset[Kind] = frozenset({"READING", "SCREENSHOT_SIGNED"})

Change = Literal[
    "WITHDRAW", "REPLACE", "REMOVE_FROM_REQUEST", "UNLINK", "MOVE", "REREAD", "RESTORE"
]
CHANGES: tuple[Change, ...] = (
    "WITHDRAW",
    "REPLACE",
    "REMOVE_FROM_REQUEST",
    "UNLINK",
    "MOVE",
    "REREAD",
    "RESTORE",
)

# How each refusal starts; the reliance's sentence follows.
REFUSED: dict[Change, str] = {
    "WITHDRAW": "the file cannot be withdrawn: ",
    "REPLACE": "the file cannot be replaced: ",
    "REMOVE_FROM_REQUEST": "the file cannot be removed from this request: ",
    "UNLINK": "the file cannot be taken off this item: ",
    "MOVE": "the file cannot be moved: ",
    "REREAD": "This file's reading is relied on: ",
    "RESTORE": "the file cannot be restored: ",
}
# Not a change the impact route names: the applications a file applies to (the sibling
# instances it serves) are changed on the file's own panel.
APPLICATIONS_REFUSED = "the file's applications cannot be changed: "

READING = "the agent is still reading this file; try again in a moment"
SCREENSHOT_SIGNED = "its screenshot review is signed off"


@dataclass(frozen=True)
class Reliance:
    """One reliance on a file: what kind, the plain sentence that says it and how to clear
    it, and where it is (the control, the evidence item and its request), where it has a
    place. A reliance on the file as a whole (its reading, its screenshot review) has
    none."""

    kind: Kind
    sentence: str
    engagement_control_id: UUID | None = None
    requirement_id: UUID | None = None
    request_id: UUID | None = None


@dataclass(frozen=True)
class Scope:
    """Where a change reaches: the controls a move takes the file off, the evidence item an
    unlink or a removal is for, the request whose items a removal through the file's
    filing reaches, and the sibling instances' items the file stops serving (`items`: the
    items its filing shares it with, or that an application change takes it off)."""

    control_ids: frozenset[UUID] = frozenset()
    requirement_id: UUID | None = None
    request_id: UUID | None = None
    items: frozenset[UUID] = frozenset()


def blocks(reliance: Reliance, change: Change, scope: Scope) -> bool:
    """Whether the change must respect the reliance. The one rule for every refusal."""
    if change == "RESTORE":
        return False
    if change in ("WITHDRAW", "REPLACE"):
        return True
    if change == "REREAD":
        # A reading under way is refused by the reading's own checks.
        return reliance.kind != "READING"
    if reliance.kind in FILE_WIDE:
        return True
    if change == "MOVE":
        return reliance.engagement_control_id in scope.control_ids
    on_item = (
        scope.requirement_id is not None and reliance.requirement_id == scope.requirement_id
    ) or (reliance.requirement_id is not None and reliance.requirement_id in scope.items)
    if change == "UNLINK":
        return on_item
    on_request = scope.request_id is not None and reliance.request_id == scope.request_id
    return on_item or on_request


# What relies on the file


def _id(value: Any) -> UUID | None:
    return None if value is None else UUID(str(value))


def reliances(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> list[Reliance]:
    """Every reliance on the file in this engagement, in the order a refusal names them."""
    found: list[Reliance] = []
    reading = cursor.execute(
        "SELECT 1 FROM evidence_analyses WHERE evidence_file_id = %s "
        "AND status IN ('PENDING', 'WORKING')",
        (file_id,),
    ).fetchone()
    if reading is not None:
        found.append(Reliance("READING", READING))
    decided = cursor.execute(
        "SELECT 1 FROM evidence_reviews WHERE evidence_file_id = %s AND decision IS NOT NULL",
        (file_id,),
    ).fetchone()
    if decided is not None:
        found.append(Reliance("SCREENSHOT_SIGNED", SCREENSHOT_SIGNED))
    for control_id, ref in cursor.execute(
        """
        SELECT c.id, c.control_ref FROM control_tests t
        JOIN engagement_controls c ON c.id = t.engagement_control_id
        WHERE t.population_file_id = %s AND t.status = 'APPROVED'
        ORDER BY t.created_at, t.id
        """,
        (file_id,),
    ).fetchall():
        found.append(
            Reliance(
                "APPROVED_SAMPLE",
                f"the approved sample for {ref} was drawn from it",
                _id(control_id),
            )
        )
    found += _accepted(cursor, file_id)
    for control_id, ref in cursor.execute(
        """
        SELECT DISTINCT ON (s.id) c.id, c.control_ref FROM test_item_files f
        JOIN test_items i ON i.id = f.test_item_id
        JOIN test_sheets s ON s.id = i.test_sheet_id
        JOIN engagement_controls c ON c.id = s.engagement_control_id
        WHERE f.evidence_file_id = %s AND s.project_id = %s AND s.status = 'SIGNED_OFF'
        ORDER BY s.id
        """,
        (file_id, project_id),
    ).fetchall():
        found.append(
            Reliance(
                "SIGNED_TESTING",
                f"testing for {ref} is signed off on it; reopen it first",
                _id(control_id),
            )
        )
    for control_id, ref, stage in cursor.execute(
        """
        SELECT c.id, c.control_ref, w.stage FROM workpapers w
        JOIN workpaper_versions v ON v.workpaper_id = w.id AND v.number = w.current_version
        JOIN engagement_controls c ON c.id = w.engagement_control_id
        WHERE w.project_id = %s AND w.status = 'PREPARED'
          AND strpos(v.content::text, %s) > 0
        ORDER BY w.stage, c.control_ref, w.id
        """,
        (project_id, str(file_id)),
    ).fetchall():
        kind = "design" if stage == "DESIGN" else "effectiveness"
        found.append(
            Reliance(
                "PREPARED_WORKPAPER",
                f"the prepared {kind} workpaper for {ref} cites it; reopen it first",
                _id(control_id),
            )
        )
    # Migrations 0162 and 0163 are applied: a missing table fails loudly (E1 review, N9).
    found += _tickmarks(cursor, file_id)
    found += _reliability(cursor, file_id)
    found += _picks(cursor, file_id)
    found += _concluded(cursor, project_id, file_id)
    found += _findings(cursor, file_id)
    return found


def _served_at(at: str) -> str:
    """SQL: whether the file (%(file)s) served q at the time `at` (an SQL expression; a
    NULL time is read as covering the file), as the evidence plan counts an item's files:
    on q's request and not read as missing it, since its filing landed there
    (evidence_matches.filed_at; a file from a reply, since it was stored); linked to q by a
    person, since the link; or shared to q from a sibling instance's item, since the
    sibling's filing landed on that item. When the file was stored does not say: a file
    moved off its control and filed back after a decision was not part of it, though it
    was stored before (E1, found on the real screen, 18 November 2026; migration 0176). A
    filing with no time (an archived engagement's, from before 0176) is read as covering
    the file, as a decision with no time is."""
    from ai_workforce_api.evidence_plans import request_file_serves, shared_from_sibling

    filing = _covers(
        "CASE WHEN arrived.source = 'UPLOAD' THEN fm.filed_at ELSE arrived.created_at END", at
    )
    return f"""
        (
            EXISTS (
                SELECT 1 FROM evidence_file_links l
                JOIN evidence_files arrived ON arrived.id = l.evidence_file_id
                LEFT JOIN evidence_matches fm
                  ON fm.evidence_file_id = l.evidence_file_id AND fm.status = 'FILED'
                LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
                WHERE l.evidence_file_id = %(file)s AND l.pbc_request_id = q.pbc_request_id
                  AND {request_file_serves("l.evidence_file_id")}
                  AND {filing})
            OR EXISTS (
                SELECT 1 FROM evidence_requirement_files ef
                WHERE ef.evidence_file_id = %(file)s AND ef.requirement_id = q.id
                  AND ef.status = 'LINKED' AND {_covers("ef.linked_at", at)})
            OR EXISTS ({shared_from_sibling("1")}
                       AND f.id = %(file)s AND {_covers("m.filed_at", at)})
        )
    """


def _covers(since: str, at: str) -> str:
    """SQL: what began at `since` was there at `at`; either time missing reads as yes."""
    return f"({at} IS NULL OR ({since}) IS NULL OR ({since}) <= {at})"


def _accepted(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[Reliance]:
    """The items a person accepted with the file: one the file serves (filed for it, filed
    for its request and not read as missing it, linked to it by a person, or shared to it
    from a sibling control, as the evidence plan counts an item's files) and already served
    when the person accepted it (_served_at). A file that came to serve the item after the
    acceptance was not part of that decision, so a replacement (a new file, added now), or
    a file filed back onto the item's request after it, never counts as accepted with an
    item accepted before. The items are those a person can judge
    (evidence_plans.JUDGEABLE_SQL): the requested ones, and an item in hand without a
    request (planned, or a D&I item that waits for an earlier one) accepted on a file
    linked to it. Before, only requested items were read, so the file such an item was
    accepted with could be withdrawn or replaced with no refusal (independent review of
    docs/evidence-assurance.md section 10.15, 15 November 2026). Moved here from
    evidence_versions._accepted_with (E1), unchanged but for naming every such item."""
    from ai_workforce_api.evidence_plans import JUDGEABLE_SQL

    rows = cursor.execute(
        """
        SELECT q.title, q.id, q.engagement_control_id, q.pbc_request_id
        FROM evidence_requirements q
        -- An acceptance with no time (older records) is read as covering the file.
        WHERE {JUDGEABLE} AND q.sufficiency = 'ACCEPTED' AND {SERVED}
        ORDER BY q.created_at, q.id
        """.replace("{SERVED}", _served_at("q.sufficiency_at")).replace(
            "{JUDGEABLE}", JUDGEABLE_SQL
        ),
        {"file": file_id},
    ).fetchall()
    return [
        Reliance(
            "ACCEPTED_ITEM",
            f'the evidence item "{title}" was accepted with it; change that decision first',
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for title, requirement_id, control_id, request_id in rows
    ]


def _tickmarks(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[Reliance]:
    rows = cursor.execute(
        """
        SELECT DISTINCT ON (q.id) q.title, c.control_ref, q.id, q.engagement_control_id,
               q.pbc_request_id
        FROM attribute_dispositions d
        JOIN evidence_annotations n ON n.id = d.annotation_id
        JOIN evidence_requirements q ON q.id = d.requirement_id
        JOIN engagement_controls c ON c.id = q.engagement_control_id
        -- A person's annotation: theirs, or the agent's they confirmed or edited.
        WHERE n.evidence_file_id = %s AND n.status IN ('CONFIRMED', 'EDITED')
          AND d.ended_at IS NULL AND d.kind = 'SHOWN_ON_REVIEW'
        ORDER BY q.id
        """,
        (file_id,),
    ).fetchall()
    return [
        Reliance(
            "TICKMARK",
            f'an attribute of "{title}" for {ref} is shown on a tickmark a person made on '
            "it; reopen that decision first",
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for title, ref, requirement_id, control_id, request_id in rows
    ]


def _reliability(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[Reliance]:
    rows = cursor.execute(
        """
        SELECT q.title, c.control_ref, q.id, q.engagement_control_id, q.pbc_request_id
        FROM file_reliability_decisions d
        JOIN evidence_requirements q ON q.id = d.requirement_id
        JOIN engagement_controls c ON c.id = q.engagement_control_id
        WHERE d.evidence_file_id = %s AND d.ended_at IS NULL
        ORDER BY d.recorded_at, d.id
        """,
        (file_id,),
    ).fetchall()
    return [
        Reliance(
            "RELIABILITY",
            f'a person\'s decision on whether it is reliable stands for "{title}" for {ref}; '
            "reopen that decision first",
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for title, ref, requirement_id, control_id, request_id in rows
    ]


def _picks(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[Reliance]:
    rows = cursor.execute(
        """
        SELECT q.title, c.control_ref, q.id, q.engagement_control_id, q.pbc_request_id
        FROM walkthrough_instances w
        JOIN evidence_requirements q ON q.id = w.requirement_id
        JOIN engagement_controls c ON c.id = q.engagement_control_id
        WHERE w.superseded_at IS NULL
          AND (w.population_file_id = %s OR w.named_in_file_id = %s)
        ORDER BY w.created_at, w.id
        """,
        (file_id, file_id),
    ).fetchall()
    return [
        Reliance(
            "WALKTHROUGH_PICK",
            f'the walkthrough instance for "{title}" for {ref} was picked from it; pick it '
            "again from another file first",
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for title, ref, requirement_id, control_id, request_id in rows
    ]


def _concluded(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> list[Reliance]:
    """The control's signed D&I conclusion, not reopened, for each design item the file
    served when it was signed (_served_at): a file that came to serve it after the sign-off
    was not part of it (as for an acceptance; product owner, 31 October 2026)."""
    rows = cursor.execute(
        """
        SELECT c.control_ref, q.id, q.engagement_control_id, q.pbc_request_id
        FROM design_conclusions dc
        JOIN engagement_controls c ON c.id = dc.engagement_control_id
        JOIN evidence_requirements q
          ON q.engagement_control_id = dc.engagement_control_id AND q.phase = 'DESIGN'
         AND q.status NOT IN ('WAIVED', 'REMOVED')
        WHERE dc.project_id = %(project)s AND dc.reopened_at IS NULL AND {SERVED}
        ORDER BY c.control_ref, q.created_at, q.id
        """.replace("{SERVED}", _served_at("dc.signed_at")),
        {"file": file_id, "project": project_id},
    ).fetchall()
    return [
        Reliance(
            "SIGNED_DI_CONCLUSION",
            f"the signed design conclusion for {ref} rests on it; reopen that conclusion first",
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for ref, requirement_id, control_id, request_id in rows
    ]


def _findings(cursor: psycopg.Cursor[Any], file_id: UUID) -> list[Reliance]:
    """An open finding on the file a person decided or sent to the client. A finding a
    person closed (dismissed, resolved) no longer holds the file, so closing it clears the
    reliance; a stale one (its file changed) never did."""
    from ai_workforce_api.evidence_findings import OPEN

    rows = cursor.execute(
        """
        SELECT x.title, c.control_ref, x.sent_message_id IS NOT NULL, x.requirement_id,
               x.engagement_control_id, coalesce(x.pbc_request_id, q.pbc_request_id)
        FROM evidence_findings x
        JOIN engagement_controls c ON c.id = x.engagement_control_id
        LEFT JOIN evidence_requirements q ON q.id = x.requirement_id
        WHERE x.evidence_file_id = %s AND NOT x.stale AND x.status = ANY(%s)
          AND (x.decided_by IS NOT NULL OR x.sent_message_id IS NOT NULL)
        ORDER BY x.created_at, x.id
        """,
        (file_id, list(OPEN)),
    ).fetchall()
    return [
        Reliance(
            "SENT_FINDING",
            (
                f'the finding "{title}" for {ref} was sent to the client on it; close that '
                "finding first"
                if sent
                else f'a person decided the finding "{title}" for {ref} on it; close that '
                "finding first"
            ),
            _id(control_id),
            _id(requirement_id),
            _id(request_id),
        )
        for title, ref, sent, requirement_id, control_id, request_id in rows
    ]


# Where a removal from an item goes


Via = Literal["LINK", "FILING"]


@dataclass(frozen=True)
class Removal:
    """How the file serves the item a person takes it off: a link to the item (unlinked),
    or its filing on the item's request (the request let go, the control kept). `version`
    is the link's or the filing's, as the change compares it."""

    via: Via
    control_id: UUID
    requirement_id: UUID
    request_id: UUID | None
    link_id: UUID | None
    match_id: UUID | None
    version: int


NOT_SERVED = "the file does not serve that item"
SHARED_ONLY = (
    "the file serves that item from another instance of the control; change the "
    "applications it applies to instead"
)


def removal(
    cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID, requirement_id: UUID
) -> Removal:
    """How the file serves the item, for taking it off: through a person's link to the item
    first, else through its filing for the item or for the item's request. Refused when it
    serves the item neither way."""
    item = cursor.execute(
        "SELECT engagement_control_id, pbc_request_id FROM evidence_requirements "
        "WHERE id = %s AND project_id = %s",
        (requirement_id, project_id),
    ).fetchone()
    if item is None:
        raise NotVisible()
    link = cursor.execute(
        "SELECT id, version, engagement_control_id FROM evidence_requirement_files "
        "WHERE requirement_id = %s AND evidence_file_id = %s AND status = 'LINKED'",
        (requirement_id, file_id),
    ).fetchone()
    if link is not None:
        return Removal(
            "LINK", UUID(str(link[2])), requirement_id, _id(item[1]), UUID(str(link[0])), None,
            int(link[1]),
        )  # fmt: skip
    match = cursor.execute(
        """
        SELECT m.id, m.version, m.engagement_control_id, m.pbc_request_id, m.requirement_id
        FROM evidence_matches m JOIN evidence_files f ON f.id = m.evidence_file_id
        WHERE m.evidence_file_id = %s AND m.project_id = %s AND m.status = 'FILED'
          AND f.source = 'UPLOAD'
        """,
        (file_id, project_id),
    ).fetchone()
    if match is not None and match[3] is not None:
        for_item = match[4] is not None and UUID(str(match[4])) == requirement_id
        for_request = match[4] is None and item[1] is not None and match[3] == item[1]
        if for_item or for_request:
            return Removal(
                "FILING", UUID(str(match[2])), requirement_id, UUID(str(match[3])), None,
                UUID(str(match[0])), int(match[1]),
            )  # fmt: skip
    from ai_workforce_api.evidence_plans import shared_from_sibling

    shared = cursor.execute(
        f"SELECT 1 FROM evidence_requirements q WHERE q.id = %s "  # noqa: S608
        f"AND EXISTS ({shared_from_sibling('1')} AND f.id = %s)",
        (requirement_id, file_id),
    ).fetchone()
    raise RelianceRefused(SHARED_ONLY if shared is not None else NOT_SERVED)


# Refusing a change


def scope_of(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None = None,
) -> Scope:
    """Where the change reaches: for a move, the family of the control the file is filed
    to; for an unlink, the item; for a removal, the item, and, when it goes through the
    file's filing, the request and every sibling instance's item the filing shares the
    file with (shared_from_sibling rests on the filing's item: it ends with it)."""
    if change == "MOVE":
        row = cursor.execute(
            "SELECT engagement_control_id FROM evidence_matches "
            "WHERE evidence_file_id = %s AND project_id = %s AND status = 'FILED'",
            (file_id, project_id),
        ).fetchone()
        if row is None or row[0] is None:
            return Scope()
        return Scope(frozenset(family_ids(cursor, project_id, UUID(str(row[0])))))
    if change in ("UNLINK", "REMOVE_FROM_REQUEST"):
        if requirement_id is None:
            raise RelianceRefused("choose the evidence item")
        if change == "UNLINK":
            return Scope(requirement_id=requirement_id)
        found = removal(cursor, project_id, file_id, requirement_id)
        if found.via == "LINK":
            return Scope(requirement_id=requirement_id)
        return Scope(
            requirement_id=requirement_id,
            request_id=found.request_id,
            items=shared_items(cursor, project_id, file_id),
        )
    return Scope()


def shared_items(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> frozenset[UUID]:
    """The sibling instances' items the file serves through its filing and a person's
    application tag (evidence_plans.shared_from_sibling), as the evidence plan counts
    them."""
    return frozenset(
        item for item, via, _control in served(cursor, project_id, file_id) if via == "SHARED"
    )


def served(
    cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID
) -> list[tuple[UUID, str, UUID]]:
    """Each open item the file serves, how (FILING: on its filing's request, as the plan
    counts that request's files; LINK: a person's link; SHARED: from a sibling instance's
    filing), and the item's control, in a stable order."""
    from ai_workforce_api.evidence_plans import request_file_serves, shared_from_sibling

    rows = cursor.execute(
        """
        SELECT q.id, served.via, q.engagement_control_id
        FROM (
            SELECT q.id, 'FILING' AS via FROM evidence_matches fm
            JOIN evidence_requirements q ON q.pbc_request_id = fm.pbc_request_id
            LEFT JOIN evidence_analyses a ON a.evidence_file_id = fm.evidence_file_id
            WHERE fm.evidence_file_id = %(file)s AND fm.status = 'FILED'
              AND {SERVES}
            UNION
            SELECT ef.requirement_id, 'LINK' FROM evidence_requirement_files ef
            WHERE ef.evidence_file_id = %(file)s AND ef.status = 'LINKED'
            UNION
            SELECT q.id, 'SHARED' FROM evidence_requirements q
            WHERE q.project_id = %(project)s AND EXISTS ({SHARED} AND f.id = %(file)s)
        ) served
        JOIN evidence_requirements q ON q.id = served.id
        JOIN engagement_controls c ON c.id = q.engagement_control_id
        WHERE q.project_id = %(project)s AND q.status NOT IN ('WAIVED', 'REMOVED')
        ORDER BY c.control_ref, q.created_at, q.id, served.via
        """.replace("{SERVES}", request_file_serves("fm.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        {"project": project_id, "file": file_id},
    ).fetchall()
    return [(UUID(str(row[0])), str(row[1]), UUID(str(row[2]))) for row in rows]


def lock_served(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> list[UUID]:
    """Before a change reads what relies on the file: the plan rows of every control whose
    items the file serves, then those items, FOR UPDATE, in the order every writer of a
    plan takes them (plan row first), so an acceptance cannot land between the check and
    the change (E1 review, N5). Returns the items. The first two steps of the lock order
    (module docstring). FOR UPDATE, not FOR NO KEY UPDATE: a reliance is recorded by
    inserting a row that references the item (a tickmark's disposition, a reliability
    decision, a walkthrough pick), and only FOR UPDATE makes that insert's key-share lock
    wait until the change has committed."""
    found = served(cursor, project_id, file_id)
    controls = sorted({control for _item, _via, control in found}, key=str)
    for control_id in controls:
        cursor.execute(
            "SELECT 1 FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s "
            "FOR UPDATE",
            (project_id, control_id),
        )
    items = sorted({item for item, _via, _control in found}, key=str)
    if items:
        cursor.execute(
            "SELECT 1 FROM evidence_requirements WHERE id = ANY(%s) ORDER BY id FOR UPDATE",
            (items,),
        )
    return items


def blocking(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None = None,
    *,
    file_wide: bool = True,
) -> list[Reliance]:
    """The reliances the change would break, in the order a refusal names them. Without
    `file_wide`, the reading and the screenshot review are left to the caller, whose own
    checks refuse them first (the evidence wizard's placement)."""
    if change == "RESTORE":
        return []
    scope = scope_of(cursor, project_id, file_id, change, requirement_id)
    return [
        r
        for r in reliances(cursor, project_id, file_id)
        if blocks(r, change, scope) and (file_wide or r.kind not in FILE_WIDE)
    ]


def refusal(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None = None,
    *,
    file_wide: bool = True,
) -> str | None:
    """The sentence the change is refused with (the first reliance it would break), or
    None. For a caller whose own refusal type answers 409 (the evidence plan's, the
    reading's, the wizard's)."""
    found = blocking(cursor, project_id, file_id, change, requirement_id, file_wide=file_wide)
    return None if not found else REFUSED[change] + found[0].sentence


def check(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None = None,
) -> None:
    """Refuse the change (RelianceRefused, answered 409) when a reliance on the file stands
    in its way, naming the first one and how to clear it."""
    why = refusal(cursor, project_id, file_id, change, requirement_id)
    if why is not None:
        raise RelianceRefused(why)


def check_items_left(found: list[Reliance], items: frozenset[UUID], prefix: str) -> None:
    """Refuse a change that takes the file off `items` (read before the change, `found`:
    the reliances as they stood) where a reliance rests on one of them."""
    for reliance in found:
        if reliance.kind not in FILE_WIDE and blocks(reliance, "UNLINK", Scope(items=items)):
            raise RelianceRefused(prefix + reliance.sentence)


# What a change would do, before a person makes it


class ImpactReliance(BaseModel):
    kind: Kind
    sentence: str
    control_id: UUID | None
    requirement_id: UUID | None
    request_id: UUID | None


class ImpactControl(BaseModel):
    id: UUID
    control_ref: str
    title: str
    application: str | None


class ImpactRequest(BaseModel):
    id: UUID
    title: str
    phase: str | None
    status: str
    control_id: UUID
    control_ref: str


class ImpactItem(BaseModel):
    id: UUID
    title: str
    phase: str
    control_id: UUID
    control_ref: str
    request_id: UUID | None
    # FILING: on its request through the file's filing; LINK: a link to it; SHARED: from
    # a sibling instance's filing.
    via: Literal["FILING", "LINK", "SHARED"]
    sufficiency: str
    # The item's judgment goes back to not reviewed when the change is made.
    resets: bool


class ImpactSheet(BaseModel):
    id: UUID
    control_id: UUID
    control_ref: str
    application: str | None
    # The sheet's items the file is on now.
    items: int


class ImpactRemoval(BaseModel):
    via: Via
    request_id: UUID | None
    link_id: UUID | None
    # The version a removal sends: the link's, or the file's filing.
    version: int


class ImpactBody(BaseModel):
    file_id: UUID
    action: Change
    requirement_id: UUID | None
    # The change can be made now.
    allowed: bool
    # The refusal the change would answer with, as the API words it.
    refusal: str | None
    blocking: list[ImpactReliance]
    removal: ImpactRemoval | None
    # Where the file is used now.
    controls: list[ImpactControl]
    requests: list[ImpactRequest]
    items: list[ImpactItem]
    # The open test sheets the tester looks at again.
    retested_sheets: list[ImpactSheet]


def impact(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None = None,
    refused: str | None = None,
) -> ImpactBody:
    """What the change would do to the file, read-only: whether it is allowed, what stands
    in its way, where the file is used, which open test sheets would be tested again, and
    which items' judgments would go back to not reviewed. The caller has authorized the
    read; `refused` is its own refusal of the change, where it has one (the engagement is
    not active, or the reader may not change its evidence), and it comes first."""
    found = cursor.execute(
        "SELECT 1 FROM evidence_files WHERE id = %s AND project_id = %s AND organization_id = %s",
        (file_id, project_id, organization_id),
    ).fetchone()
    if found is None:
        raise NotVisible()
    withdrawn = cursor.execute(
        "SELECT replaced_by_file_id IS NOT NULL FROM evidence_withdrawals "
        "WHERE evidence_file_id = %s AND restored_at IS NULL",
        (file_id,),
    ).fetchone()
    state: str | None = None
    if change == "RESTORE":
        if withdrawn is None:
            state = "this file is not withdrawn"
        elif withdrawn[0]:
            from ai_workforce_api.evidence_versions import REPLACED_NOT_RESTORED

            state = REPLACED_NOT_RESTORED
    elif withdrawn is not None:
        state = "this file is withdrawn; restore it first"
    found_removal: Removal | None = None
    if change in ("REMOVE_FROM_REQUEST", "UNLINK") and requirement_id is None:
        state = state or "choose the evidence item"
    if change == "REMOVE_FROM_REQUEST" and requirement_id is not None and state is None:
        try:
            found_removal = removal(cursor, project_id, file_id, requirement_id)
        except RelianceRefused as error:
            state = error.detail
    stands: list[Reliance] = []
    if state is None:
        stands = blocking(cursor, project_id, file_id, change, requirement_id)
    sentence = refused or state or (None if not stands else REFUSED[change] + stands[0].sentence)
    seen: set[str] = set()
    shown: list[ImpactReliance] = []
    for reliance in stands:
        if reliance.sentence in seen:
            continue
        seen.add(reliance.sentence)
        shown.append(
            ImpactReliance(
                kind=reliance.kind, sentence=reliance.sentence,
                control_id=reliance.engagement_control_id,
                requirement_id=reliance.requirement_id, request_id=reliance.request_id,
            )
        )  # fmt: skip
    items = _items(cursor, project_id, file_id, change, requirement_id, found_removal)
    return ImpactBody(
        file_id=file_id,
        action=change,
        requirement_id=requirement_id,
        allowed=sentence is None,
        refusal=sentence,
        blocking=shown,
        removal=None
        if found_removal is None
        else ImpactRemoval(
            via=found_removal.via,
            request_id=found_removal.request_id,
            link_id=found_removal.link_id,
            version=found_removal.version,
        ),
        controls=_controls(cursor, project_id, file_id),
        requests=_requests(cursor, project_id, file_id),
        items=items,
        retested_sheets=_retested(cursor, project_id, file_id, change),
    )


def _controls(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> list[ImpactControl]:
    """The control the file is filed to, and each control a person linked it to an item of
    (the file's filing is read whether or not it is withdrawn: a restoration returns it)."""
    rows = cursor.execute(
        """
        SELECT DISTINCT c.id, c.control_ref, c.title, a.name
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %(project)s AND (
            c.id IN (SELECT engagement_control_id FROM evidence_matches
                     WHERE evidence_file_id = %(file)s AND status = 'FILED')
            OR c.id IN (SELECT engagement_control_id FROM evidence_requirement_files
                        WHERE evidence_file_id = %(file)s AND status = 'LINKED'))
        ORDER BY c.control_ref, a.name NULLS FIRST, c.id
        """,
        {"project": project_id, "file": file_id},
    ).fetchall()
    return [
        ImpactControl(id=row[0], control_ref=str(row[1]), title=str(row[2] or ""),
                      application=None if row[3] is None else str(row[3]))
        for row in rows
    ]  # fmt: skip


def _requests(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> list[ImpactRequest]:
    """The request the file is filed on, and the request of each item it is linked to."""
    from ai_workforce_api.workspace import _request_title

    rows = cursor.execute(
        """
        SELECT DISTINCT r.id, r.evidence_description, r.title, r.testing_phase, r.status,
               c.id, c.control_ref, r.created_at
        FROM pbc_requests r
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        WHERE r.project_id = %(project)s AND (
            r.id IN (SELECT pbc_request_id FROM evidence_matches
                     WHERE evidence_file_id = %(file)s AND status = 'FILED')
            OR r.id IN (SELECT q.pbc_request_id FROM evidence_requirement_files ef
                        JOIN evidence_requirements q ON q.id = ef.requirement_id
                        WHERE ef.evidence_file_id = %(file)s AND ef.status = 'LINKED'))
        ORDER BY r.created_at, r.id
        """,
        {"project": project_id, "file": file_id},
    ).fetchall()
    return [
        ImpactRequest(
            id=row[0], title=_request_title(str(row[1] or ""), str(row[2] or "")),
            phase=None if row[3] is None else str(row[3]), status=str(row[4]),
            control_id=row[5], control_ref=str(row[6]),
        )
        for row in rows
    ]  # fmt: skip


def _items(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    change: Change,
    requirement_id: UUID | None,
    found_removal: Removal | None,
) -> list[ImpactItem]:
    """The items the file serves (served): on its filing's request, through a person's
    link, or shared from a sibling instance; and whether the change takes each item's
    judgment back to not reviewed, as the change itself decides it."""
    from ai_workforce_api.evidence_plans import unsupported_judgment

    found = served(cursor, project_id, file_id)
    if not found:
        return []
    details = {
        UUID(str(row[0])): row
        for row in cursor.execute(
            """
            SELECT q.id, q.title, q.phase, q.engagement_control_id, c.control_ref,
                   q.pbc_request_id, q.sufficiency
            FROM evidence_requirements q
            JOIN engagement_controls c ON c.id = q.engagement_control_id
            WHERE q.id = ANY(%s)
            """,
            ([item for item, _via, _control in found],),
        ).fetchall()
    }
    filing = found_removal is not None and found_removal.via == "FILING"
    items: list[ImpactItem] = []
    for item_id, via, _control in found:
        row = details[item_id]
        resets = False
        judged = str(row[6]) != "NOT_REVIEWED"
        if judged and via == "LINK" and change in ("WITHDRAW", "REPLACE"):
            # As reset_judgments_left_without_file decides once the file is out of force.
            resets = unsupported_judgment(cursor, item_id, excluding=file_id) is not None
        elif judged and filing and via in ("FILING", "SHARED"):
            # As the removal decides for the items its filing served.
            resets = unsupported_judgment(cursor, item_id, excluding=file_id) is not None
        elif (
            judged
            and via == "LINK"
            and item_id == requirement_id
            and (change == "UNLINK" or (found_removal is not None and found_removal.via == "LINK"))
        ):
            # As unlink_file decides: nothing else linked to the item, and nothing on its
            # request.
            resets = not _others(cursor, item_id, file_id)
        items.append(
            ImpactItem(
                id=item_id, title=str(row[1]), phase=str(row[2]), control_id=row[3],
                control_ref=str(row[4]), request_id=_id(row[5]),
                via=via,  # type: ignore[arg-type]
                sufficiency=str(row[6]), resets=resets,
            )
        )  # fmt: skip
    return items


def _others(cursor: psycopg.Cursor[Any], requirement_id: UUID, file_id: UUID) -> bool:
    """unlink_file's test of what is left on the item without this file's link."""
    row = cursor.execute(
        """
        SELECT
          EXISTS (
            SELECT 1 FROM evidence_requirement_files ef
            JOIN evidence_file_links l
              ON l.evidence_file_id = ef.evidence_file_id
             AND l.engagement_control_id = ef.engagement_control_id
            WHERE ef.requirement_id = q.id AND ef.status = 'LINKED'
              AND ef.evidence_file_id <> %(file)s)
          OR (q.pbc_request_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM evidence_file_links l WHERE l.pbc_request_id = q.pbc_request_id))
        FROM evidence_requirements q WHERE q.id = %(item)s
        """,
        {"file": file_id, "item": requirement_id},
    ).fetchone()
    return row is not None and bool(row[0])


def _retested(
    cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID, change: Change
) -> list[ImpactSheet]:
    """The open sheets the tester looks at again: for a withdrawal, a replacement or a
    move, every open sheet that holds the file and its control's open sheets
    (testing_engine.off_open_sheets); for a restoration, its control's open sheets."""
    if change not in ("WITHDRAW", "REPLACE", "MOVE", "RESTORE"):
        return []
    control = cursor.execute(
        "SELECT engagement_control_id FROM evidence_matches "
        "WHERE evidence_file_id = %s AND status = 'FILED'",
        (file_id,),
    ).fetchone()
    control_id = None if control is None else control[0]
    holding = change != "RESTORE"
    rows = cursor.execute(
        """
        SELECT s.id, s.engagement_control_id, c.control_ref, a.name,
               (SELECT count(*) FROM test_item_files t JOIN test_items i ON i.id = t.test_item_id
                WHERE i.test_sheet_id = s.id AND t.evidence_file_id = %(file)s)
        FROM test_sheets s
        JOIN engagement_controls c ON c.id = s.engagement_control_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE s.project_id = %(project)s AND s.status = 'OPEN' AND (
            s.engagement_control_id = %(control)s::uuid
            OR (%(holding)s::boolean AND (
                EXISTS (SELECT 1 FROM test_sheet_files f
                        WHERE f.test_sheet_id = s.id AND f.evidence_file_id = %(file)s)
                OR EXISTS (SELECT 1 FROM test_item_files t
                           JOIN test_items i ON i.id = t.test_item_id
                           WHERE i.test_sheet_id = s.id AND t.evidence_file_id = %(file)s))))
        ORDER BY c.control_ref, s.created_at, s.id
        """,
        {"project": project_id, "file": file_id, "control": control_id, "holding": holding},
    ).fetchall()
    return [
        ImpactSheet(id=row[0], control_id=row[1], control_ref=str(row[2]),
                    application=None if row[3] is None else str(row[3]), items=int(row[4]))
        for row in rows
    ]  # fmt: skip
