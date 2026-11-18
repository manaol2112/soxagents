"""The D&I evidence wizard: files dropped on a control's D&I list, sorted into its items
(docs/evidence-wizard.md, section 2; decided by the product owner on 13 November 2026).

Uploading (2.1). An upload names the control whose D&I items its files are sorted into
(`design_control_id`), the item when the wizard was opened from a row (`requirement_id`),
and its session (`batch_id`). The transaction of the session's first upload that stores a
file, or records one held already, records the batch (evidence_batches; never before such
an upload, so no batch is empty); the batch keeps its control and its item. A file for the
whole control is filed to the control with its placement pending; a file from a row is
placed on the row's item at once, a person's choice. A file the engagement holds already,
dropped again, is listed in the session with the placement it has
(evidence_batch_duplicates). Custody, de-duplication and the archived-engagement guard are
evidence_intake's, unchanged.

Reading (2.2). A wizard file is read by the evidence reader against every D&I item of the
control that still expects evidence (evidence_analysis.run_analysis), so what the file
covers is recorded against each item. The reader's own model-derived findings are never
proposed for a wizard file: the assurance chain judges D&I evidence once the file is
placed. The deterministic findings are derived once the file is on an item's request.

Placement (2.3). Code decides from the reading (`decide`); the model only proposes. A file
the assurance gate would hold needs a person, with the gate's reason. A file the model
read with high or medium confidence is placed when one item stands out: the only item it
covers in full, or, covering items only in part, the only one its kind fits; a file that
covers several items in full (a bundle) is placed on each of them its kind fits. Never on
an item a person accepted: that needs the person, who reopens the decision on the list
first. Anything else needs a person, with the items ranked; a file that covers no item is
not D&I evidence and stays in the control's files. A file from a row stays on the row's
item and carries a suggestion when the reader is sure another item fits better: nothing
moves without a person.

A placement is a filing for the item: on the item's request (the file's evidence_matches
filing names the request and the item), or, for a further item or an item not requested
yet, a link to it (evidence_requirement_files). So the item counts the file as evidence in
hand (evidence_receipts) and its check is queued (evidence_assurance) as for a file added
on the item. Both wait for the batch: whichever way a reading ends (read, failed,
cancelled, out of attempts), the one hook `reading_ended` runs in the transaction that
records the ending, and once none of the batch's files on its control is still being read
the batch lands: its placements' receipts are applied (on the request of each item a file
is on) and its checks queued, so files that arrive together are checked once; a person's
move before then waits for the landing too. A start-up backstop lands a batch that ended
without landing. Every placement is recorded in evidence_placements, append-only: a
person's move is a new placement that supersedes the earlier one, which is kept, and a
move elsewhere (the Evidence center's filing, the D&I list's link or unlink) is recorded
the same way. The batch's state shows each file where it is now, from its filing and
links, never where it was.

Locks: every path that writes a wizard file's placement takes the file's reading, then the
batch, then the evidence plan, then a request, in that order (an upload, whose reading is
new, takes the batch first), so no two of them wait for each other.

The routes: the control's recent batches, a batch's state, and a person's move. File
names, the reader's notes and the model's answer are untrusted: they are cleaned and shown
as text.
"""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, cast
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.errors import UniqueViolation
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.after_commit import after_commit, committed
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.evidence_assurance import (
    CUSTODY_FAILED_NOTE,
    HELD_REASONS,
    GateFacts,
    Held,
    HeldCode,
    RequestBody,
    Verdict,
    attribute_letter,
    gate,
    lens_for,
    queue_for_file,
    queue_safely,
    read_assurance,
    reconcile,
    schedule_assessments,
)
from ai_workforce_api.evidence_classify import (
    KIND_LABELS,
    MAX_ITEMS,
    Classification,
    Confidence,
    RequestedItem,
)
from ai_workforce_api.evidence_findings import ReaderFindings, derive_from_analysis
from ai_workforce_api.evidence_links import RequestRef
from ai_workforce_api.evidence_receipts import (
    apply_receipt,
    ask_again_for_items_left,
    follow_evidence,
    release_receipt,
)
from ai_workforce_api.evidence_withdrawn import in_force, is_withdrawn
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings

logger = logging.getLogger(__name__)

PlacementStatus = Literal["PLACED", "NEEDS_PERSON", "NOT_DESIGN"]
Method = Literal["AGENT", "PERSON"]
FileStage = Literal["STORED", "READING", "READ", "SORTED", "NEEDS_PERSON", "NOT_DESIGN", "FAILED"]
ReadStatus = Literal["PENDING", "WORKING", "READY", "FAILED"]
ReadMethod = Literal["TEXT", "OCR", "NONE"]
ShownStatus = Literal["PLACED", "NEEDS_PERSON", "NOT_DESIGN", "PENDING"]

MAX_SUGGESTIONS = 5
REASON_LIMIT = 500
# The batches the control's list shows, the most recent first.
RECENT_BATCHES = 10
# The files one batch lists.
MAX_LISTED = 500
# A check that has ended: reviewed, held by its gate, or failed.
_CHECKED = frozenset({"REVIEWED", "HELD", "FAILED"})

NOT_DESIGN_REASON = (
    "The reader found it is not evidence for any of the control's D&I items. It stays in "
    "the control's files."
)
NO_ITEMS_REASON = (
    "The control has no D&I item that still expects evidence, so the file stays in the "
    "control's files."
)
MORE_ITEMS_REASON = (
    "The control has more D&I items than one reading weighs, and the file covers none of "
    "those read. Choose where it goes."
)
NOT_SURE_REASON = "The reader is not sure enough of this file to place it. Choose where it goes."
SEVERAL_REASON = (
    "The reader found it covers several items in part, and no one item stands out. Choose "
    "where it goes."
)
CHANGED_REASON = (
    "The item the reader found it fits changed while the file was read. Choose where it goes."
)
# An item a person accepted takes no more evidence until the decision is reopened on the
# D&I list (decided by the product owner, 13 November 2026): nothing is added under an
# acceptance, by the agent or by a person.
ACCEPTED_REASON = "Its evidence is accepted. Reopen the decision on the list first."
NONE_FITS_REASON = (
    "The reader found it covers several items in full, and its kind fits none of them. "
    "Choose where it goes."
)
ADDED_ON_ITEM = "Added on this item by a person."
PLACED_BY_PERSON = "Placed by a person."
MOVED_OUT = "Taken off the D&I items by a person: it is not D&I evidence."
# Where another flow moved a wizard file (recorded as a person's placement).
MOVED_AWAY = "Moved to another control in the Evidence center."
TAKEN_OFF_CONTROL = "Taken off its control in the Evidence center."
FILED_HERE = "Filed to this control in the Evidence center."
LINKED_ON_LIST = "Linked to an item on the D&I list."
ADDED_AGAIN = "Added again from the row."
UNLINKED_ON_LIST = "Taken off an item on the D&I list."
# What the state says of a file whose placement no longer says where it is.
ELSEWHERE = "It is filed to another control now."
OFF_ITEMS = "It is not on any of the control's D&I items now."
HELD_BEFORE = "Held before it was dropped in this session."

# What a file of each kind is said to look like, for a row's suggestion.
_LOOKS_LIKE: dict[str, str] = {
    "population": "a population or listing",
    "walkthrough": "walkthrough evidence",
    "design": "design evidence",
    "configuration": "a configuration or settings record",
    "change_history": "a change history or audit log",
    "report": "a key report or query",
    "policy": "a policy or procedure",
    "sample": "sample evidence",
}
# The evidence categories a file of each kind fits: a policy or procedure (or a narrative)
# is process documentation; a ticket, log, listing, screenshot or sign-off is the control's
# execution, and the item's own category where an item asks for exactly that.
_FITS: dict[str, frozenset[str]] = {
    "policy": frozenset({"PROCESS_DOCUMENTATION"}),
    "design": frozenset({"PROCESS_DOCUMENTATION"}),
    "walkthrough": frozenset({"CONTROL_EXECUTION"}),
    "change_history": frozenset({"CONTROL_EXECUTION", "CHANGE_HISTORY"}),
    "population": frozenset({"CONTROL_EXECUTION", "POPULATION"}),
    "report": frozenset({"CONTROL_EXECUTION", "REPORT_RELIABILITY"}),
    "configuration": frozenset({"CONTROL_EXECUTION", "CONFIGURATION"}),
    "sample": frozenset({"CONTROL_EXECUTION", "SAMPLE"}),
}


class WizardState(Exception):
    """A 409: the batch, the file or the item does not allow what was asked."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class AcceptedItem(WizardState):
    """A 409: an item a person accepted takes no more evidence."""

    def __init__(self) -> None:
        super().__init__(ACCEPTED_REASON)


Reader = psycopg.Connection[Any] | psycopg.Cursor[Any]


def _quoted(title: str) -> str:
    return f"“{clean_line(title, 200)}”"


def _reason(text: str) -> str:
    cleaned = clean_line(text, REASON_LIMIT)
    return cleaned if len(cleaned.strip()) >= 3 else "Placed by the evidence wizard."


def _sentence(text: str, limit: int = 240) -> str:
    """The reader's note on an item, as one plain sentence (it is untrusted text, shown as
    text): cleaned, cut, and ended with a full stop."""
    cleaned = clean_line(text, limit - 1).strip()
    if not cleaned:
        return ""
    return cleaned if cleaned[-1] in ".!?" else f"{cleaned}."


# --- The control's D&I items ---------------------------------------------------------


@dataclass(frozen=True)
class Item:
    """A D&I item a wizard file can be placed on: a DESIGN requirement of the control that
    still expects evidence (planned, waiting on another or requested; not waived or removed,
    not a proposed addition nobody accepted, not on a cancelled or closed request, in a D&I
    phase that applies), with the request that carries it, if any."""

    requirement_id: UUID
    title: str
    description: str
    categories: tuple[str, ...]
    period: str
    request_id: UUID | None
    # The approved attributes it links, in the control's order: (letter, wording).
    attributes: tuple[tuple[str, str], ...]
    # A person's judgment of its evidence (evidence_requirements.sufficiency).
    sufficiency: str = "NOT_REVIEWED"

    @property
    def letters(self) -> list[str]:
        return [code for code, _text in self.attributes]

    @property
    def accepted(self) -> bool:
        """A person accepted its evidence: it takes no more until that is reopened."""
        return self.sufficiency == "ACCEPTED"


def linked_attributes(
    connection: Reader, control_id: UUID
) -> dict[UUID, tuple[tuple[str, str], ...]]:
    """The approved attributes each of the control's requirements links
    (evidence_requirement_attributes), in the control's order, as the D&I list letters
    them (evidence_assurance.attribute_letter): (letter, wording)."""
    approved = connection.execute(
        "SELECT id, text FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'APPROVED' ORDER BY position, created_at",
        (control_id,),
    ).fetchall()
    lettered = {
        UUID(str(row[0])): (index, attribute_letter(index), clean_line(str(row[1]), 300))
        for index, row in enumerate(approved)
    }
    links: dict[UUID, list[tuple[int, str, str]]] = {}
    for requirement_id, attribute_id in connection.execute(
        "SELECT requirement_id, attribute_id FROM evidence_requirement_attributes "
        "WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchall():
        found = lettered.get(UUID(str(attribute_id)))
        if found is not None:
            links.setdefault(UUID(str(requirement_id)), []).append(found)
    return {
        requirement_id: tuple((code, text) for _index, code, text in sorted(found))
        for requirement_id, found in links.items()
    }


def design_items(connection: Reader, project_id: UUID, control_id: UUID) -> list[Item]:
    """The control's D&I items that still expect evidence, in the plan's order. The same
    rule the assurance chain counts "another request asks for it" by
    (evidence_assurance._linked), and a closed request takes no more evidence
    (evidence_intake._request_target)."""
    links = linked_attributes(connection, control_id)
    rows = connection.execute(
        """
        SELECT q.id, q.title, q.description, q.categories, q.period_label, q.pbc_request_id,
               q.sufficiency
        FROM evidence_requirements q
        LEFT JOIN pbc_requests r ON r.id = q.pbc_request_id
        LEFT JOIN evidence_plan_phases ph ON ph.plan_id = q.plan_id AND ph.phase = q.phase
        WHERE q.engagement_control_id = %s AND q.project_id = %s AND q.phase = 'DESIGN'
          AND q.status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED')
          AND NOT coalesce((q.pending_change ->> 'add')::boolean, false)
          AND coalesce(r.status, '') NOT IN ('CANCELLED', 'CLOSED')
          AND coalesce(ph.applicability, '') <> 'NOT_APPLICABLE'
        ORDER BY q.created_at, q.requirement_key
        """,
        (control_id, project_id),
    ).fetchall()
    return [
        Item(
            requirement_id=UUID(str(row[0])),
            title=str(row[1]),
            description=str(row[2]),
            categories=tuple(str(item) for item in (row[3] or [])),
            period=str(row[4] or ""),
            request_id=None if row[5] is None else UUID(str(row[5])),
            attributes=links.get(UUID(str(row[0])), ()),
            sufficiency=str(row[6] or "NOT_REVIEWED"),
        )
        for row in rows
    ]


def listed_items(items: Sequence[Item], chosen: UUID | None) -> tuple[Item, ...]:
    """The items one reading weighs: as many as the reader takes (MAX_ITEMS), in the plan's
    order, the row's own item always among them."""
    shown = list(items[:MAX_ITEMS])
    if chosen is not None and all(item.requirement_id != chosen for item in shown):
        extra = next((item for item in items if item.requirement_id == chosen), None)
        if extra is not None:
            shown = [*shown[: MAX_ITEMS - 1], extra]
    return tuple(shown)


def requested_item(item: Item) -> RequestedItem:
    """An item as the reader is asked about it: its requirement, title, description,
    categories and the attributes it links (each with its letter and wording)."""
    from ai_workforce_api.evidence_planning import CATEGORY_LABELS
    from ai_workforce_api.pbc_drafting import PRIMARY_KIND

    labels = ", ".join(CATEGORY_LABELS.get(category, category) for category in item.categories)
    shows = " ".join(f"{code}. {text.rstrip('.')}." for code, text in item.attributes)
    detail = item.description.strip()
    if labels:
        detail += f" Evidence category: {labels}."
    if shows:
        detail += f" Attributes it addresses: {shows}"
    return RequestedItem(
        kind=PRIMARY_KIND.get(item.categories[0] if item.categories else "", "other"),
        title=clean_line(item.title, 220),
        fields=(),
        period=clean_line(item.period, 200),
        requirement_id=str(item.requirement_id),
        detail=clean_line(detail, 1500),
    )


# --- Batches and placements on record --------------------------------------------------


@dataclass(frozen=True)
class Batch:
    id: UUID
    organization_id: UUID
    project_id: UUID
    control_id: UUID
    requirement_id: UUID | None
    created_by: UUID
    created_at: datetime
    landed_at: datetime | None = None


@dataclass(frozen=True)
class Current:
    """A file's current placement: its latest version."""

    id: UUID
    version: int
    status: PlacementStatus
    method: Method
    requirement_ids: tuple[UUID, ...]
    reason: str
    suggestions: tuple[dict[str, Any], ...]
    confidence: str | None
    decided_by: UUID | None
    decided_at: datetime


@dataclass(frozen=True)
class WizardFile:
    file_id: UUID
    batch: Batch
    current: Current | None


_BATCH_COLUMNS = (
    "b.id, b.organization_id, b.project_id, b.engagement_control_id, b.requirement_id, "
    "b.created_by, b.created_at, b.landed_at"
)
_PLACEMENT = (
    "id, version, status, method, requirement_ids, reason, suggestions, confidence, "
    "decided_by, decided_at"
)


def _batch_of(row: tuple[Any, ...] | None) -> Batch | None:
    if row is None:
        return None
    return Batch(
        id=UUID(str(row[0])),
        organization_id=UUID(str(row[1])),
        project_id=UUID(str(row[2])),
        control_id=UUID(str(row[3])),
        requirement_id=None if row[4] is None else UUID(str(row[4])),
        created_by=UUID(str(row[5])),
        created_at=row[6],
        landed_at=row[7],
    )


def _batch(connection: Reader, batch_id: UUID) -> Batch | None:
    return _batch_of(
        connection.execute(
            f"SELECT {_BATCH_COLUMNS} FROM evidence_batches b WHERE b.id = %s",  # noqa: S608
            (batch_id,),
        ).fetchone()
    )


def _current_of(row: tuple[Any, ...]) -> Current:
    return Current(
        id=UUID(str(row[0])),
        version=int(row[1]),
        status=cast(PlacementStatus, str(row[2])),
        method=cast(Method, str(row[3])),
        requirement_ids=tuple(UUID(str(item)) for item in (row[4] or [])),
        reason=str(row[5]),
        suggestions=tuple(item for item in (row[6] or []) if isinstance(item, dict)),
        confidence=None if row[7] is None else str(row[7]),
        decided_by=None if row[8] is None else UUID(str(row[8])),
        decided_at=row[9],
    )


def _current(connection: Reader, file_id: UUID) -> Current | None:
    row = connection.execute(
        f"SELECT {_PLACEMENT} FROM evidence_placements "  # noqa: S608
        "WHERE evidence_file_id = %s ORDER BY version DESC LIMIT 1",
        (file_id,),
    ).fetchone()
    return None if row is None else _current_of(row)


def _currents(connection: Reader, file_ids: Sequence[UUID]) -> dict[UUID, Current]:
    """Each file's current placement, whichever session recorded it."""
    if not file_ids:
        return {}
    return {
        UUID(str(row[0])): _current_of(row[1:])
        for row in connection.execute(
            f"""
            SELECT DISTINCT ON (evidence_file_id) evidence_file_id, {_PLACEMENT}
            FROM evidence_placements WHERE evidence_file_id = ANY(%s)
            ORDER BY evidence_file_id, version DESC
            """,  # noqa: S608
            (list(file_ids),),
        ).fetchall()
    }


def wizard_file(connection: Reader, project_id: UUID, file_id: UUID) -> WizardFile | None:
    """The batch a file was uploaded in, when it is a wizard batch and the file is still
    filed to the batch's control; None otherwise (a file filed elsewhere since is read as
    any other upload, and is not its batch's to wait for)."""
    row = connection.execute(
        f"""
        SELECT {_BATCH_COLUMNS}
        FROM evidence_files f
        JOIN evidence_batches b ON b.id = f.upload_batch_id AND b.project_id = f.project_id
        JOIN evidence_matches m
          ON m.evidence_file_id = f.id AND m.status = 'FILED'
         AND m.engagement_control_id = b.engagement_control_id
        WHERE f.id = %s AND f.project_id = %s AND f.source = 'UPLOAD'
        """,  # noqa: S608
        (file_id, project_id),
    ).fetchone()
    batch = _batch_of(row)
    if batch is None:
        return None
    return WizardFile(file_id=file_id, batch=batch, current=_current(connection, file_id))


def _placement_batch(connection: Reader, project_id: UUID, file_id: UUID) -> Batch | None:
    """The session a file's placements belong to: the wizard batch it was uploaded in, else
    the session its current placement was recorded in (a file held before the wizard,
    placed from a session it was dropped in again). None for a file the wizard never had."""
    own = _batch_of(
        connection.execute(
            f"""
            SELECT {_BATCH_COLUMNS} FROM evidence_files f
            JOIN evidence_batches b ON b.id = f.upload_batch_id AND b.project_id = f.project_id
            WHERE f.id = %s AND f.project_id = %s
            """,  # noqa: S608
            (file_id, project_id),
        ).fetchone()
    )
    if own is not None:
        return own
    return _batch_of(
        connection.execute(
            f"""
            SELECT {_BATCH_COLUMNS} FROM evidence_placements p
            JOIN evidence_batches b ON b.id = p.batch_id
            WHERE p.evidence_file_id = %s AND p.project_id = %s
            ORDER BY p.version DESC LIMIT 1
            """,  # noqa: S608
            (file_id, project_id),
        ).fetchone()
    )


def _lock(cursor: psycopg.Cursor[Any], batch_id: UUID) -> None:
    """The batch's row, held to the end of the transaction: every write of a batch's
    placements, and the check of whether its readings have all ended, take it, so two
    readings that end together agree on which one was the last."""
    cursor.execute("SELECT 1 FROM evidence_batches WHERE id = %s FOR UPDATE", (batch_id,))


def lock_wizard(cursor: psycopg.Cursor[Any], project_id: UUID, file_id: UUID) -> Batch | None:
    """For a flow outside the wizard that changes where a file is (the Evidence center's
    filing, the D&I list's link and unlink), before anything else it locks: when the wizard
    has the file, its reading and then its session's batch, held to the end of the
    transaction, the order every wizard write takes them in. None for any other file."""
    batch = _placement_batch(cursor, project_id, file_id)
    if batch is None:
        return None
    cursor.execute(
        "SELECT 1 FROM evidence_analyses WHERE evidence_file_id = %s FOR UPDATE", (file_id,)
    )
    _lock(cursor, batch.id)
    return batch


def _insert(
    cursor: psycopg.Cursor[Any],
    batch: Batch,
    file_id: UUID,
    *,
    status: PlacementStatus,
    method: Method,
    requirement_ids: Sequence[UUID],
    confidence: str | None,
    reason: str,
    suggestions: Sequence[dict[str, Any]],
    analysis_id: UUID | None,
    decided_by: UUID | None,
    supersedes: Current | None,
    decided_at: datetime | None = None,
) -> int:
    """Record a placement, superseding the file's current one. Returns its version."""
    version = 1 if supersedes is None else supersedes.version + 1
    ids = list(requirement_ids) if status == "PLACED" else []
    cursor.execute(
        """
        INSERT INTO evidence_placements (
            organization_id, project_id, engagement_control_id, batch_id, evidence_file_id,
            version, supersedes_id, status, method, requirement_id, requirement_ids,
            confidence, reason, suggestions, analysis_id, decided_by, decided_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, %s, %s,
                coalesce(%s, clock_timestamp()))
        """,
        (
            batch.organization_id, batch.project_id, batch.control_id, batch.id, file_id,
            version, None if supersedes is None else supersedes.id, status, method,
            ids[0] if ids else None, ids,
            confidence if confidence in ("high", "medium", "low") else None,
            _reason(reason), Json(list(suggestions)[:MAX_SUGGESTIONS]), analysis_id,
            decided_by if method == "PERSON" else None, decided_at,
        ),
    )  # fmt: skip
    return version


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (organization_id, project_id, actor, action, target_type, target_id, Json(payload)),
    )


# --- The placement rules (code decides, the model proposes) --------------------------


@dataclass(frozen=True)
class Suggestion:
    requirement_id: UUID
    title: str
    reason: str

    def dump(self) -> dict[str, str]:
        return {
            "requirement_id": str(self.requirement_id),
            "title": clean_line(self.title, 200),
            "reason": clean_line(self.reason, 300),
        }


@dataclass(frozen=True)
class Decision:
    status: PlacementStatus
    requirement_ids: tuple[UUID, ...]
    reason: str
    suggestions: tuple[Suggestion, ...]


def fits(kind: str, categories: Sequence[str]) -> bool:
    """Whether a file of this kind fits an item of these evidence categories."""
    return bool(_FITS.get(kind, frozenset()) & set(categories))


def decide(
    classification: Classification,
    kind: str,
    source: str,
    held: Held | None,
    listed: Sequence[Item],
    more: bool = False,
) -> Decision:
    """Where a wizard file goes, from its reading (docs/evidence-wizard.md, 2.3). `kind` is
    the file's kind (a person's confirmed kind where there is one), `source` who read it
    (MODEL, or the rules), `held` the assurance gate's result for the file, `listed` the
    items the reading weighed, and `more` whether the control has items it did not."""
    coverage = {
        item.requirement_id: (item.coverage, _sentence(item.note))
        for item in classification.items
        if item.requirement_id
    }

    def covering(entry: Item) -> str:
        return coverage.get(str(entry.requirement_id), ("NOT_COVERED", ""))[0]

    covered = [entry for entry in listed if covering(entry) == "COVERED"]
    partial = [entry for entry in listed if covering(entry) == "PARTIAL"]
    # Ranked for a person: covered in full first, then in part; the items its kind fits
    # first within each; then the plan's order.
    ranked = tuple(
        Suggestion(
            entry.requirement_id,
            entry.title,
            " ".join(
                part
                for part in (
                    "The reader found it covers this item."
                    if covering(entry) == "COVERED"
                    else "The reader found it covers this item in part.",
                    coverage.get(str(entry.requirement_id), ("", ""))[1],
                )
                if part
            ),
        )
        for entry in sorted(
            [*covered, *partial],
            key=lambda entry: (covering(entry) != "COVERED", not fits(kind, entry.categories)),
        )
    )[:MAX_SUGGESTIONS]
    # 1. What the assurance gate would hold is not placed.
    if held is not None:
        return Decision("NEEDS_PERSON", (), held.reason, ranked)
    # 5. A file that covers no item is not D&I evidence.
    if not covered and not partial:
        if not listed:
            return Decision("NOT_DESIGN", (), NO_ITEMS_REASON, ())
        if more:
            return Decision("NEEDS_PERSON", (), MORE_ITEMS_REASON, ())
        return Decision("NOT_DESIGN", (), NOT_DESIGN_REASON, ())
    # 3. Only the model's reading, with high or medium confidence, places a file.
    if source != "MODEL" or classification.confidence not in ("high", "medium"):
        return Decision("NEEDS_PERSON", (), NOT_SURE_REASON, ranked)

    def placed(entries: Sequence[Item], reason: str) -> Decision:
        # Never under an acceptance: an item a person accepted waits for them to reopen it.
        if any(entry.accepted for entry in entries):
            return Decision("NEEDS_PERSON", (), ACCEPTED_REASON, ranked)
        return Decision("PLACED", tuple(entry.requirement_id for entry in entries), reason, ())

    label = KIND_LABELS.get(kind, kind).lower()
    if len(covered) == 1:
        return placed(covered, f"The reader found it covers {_quoted(covered[0].title)}.")
    if covered:
        # A bundle: it covers several items in full, and is placed on each its kind fits.
        bundle = [entry for entry in covered if fits(kind, entry.categories)]
        if len(bundle) > 1:
            return placed(
                bundle,
                "The reader found it covers each of these items in full: "
                + ", ".join(_quoted(entry.title) for entry in bundle)
                + ".",
            )
        if len(bundle) == 1:
            return placed(
                bundle,
                f"The reader found it covers {_quoted(bundle[0].title)} in full, and of the "
                f"items it covers in full it is the only one a file of this kind ({label}) "
                "fits.",
            )
        return Decision("NEEDS_PERSON", (), NONE_FITS_REASON, ranked)
    fitting = [entry for entry in partial if fits(kind, entry.categories)]
    if len(fitting) == 1:
        return placed(
            fitting,
            f"The reader found it covers {_quoted(fitting[0].title)} in part, and it is the "
            f"only item a file of this kind ({label}) fits.",
        )
    # 4. Otherwise a person chooses, with the candidates ranked.
    if len(partial) == 1:
        return Decision(
            "NEEDS_PERSON",
            (),
            f"The reader found it covers {_quoted(partial[0].title)} only in part, and its "
            "kind does not fit that item. Choose where it goes.",
            ranked,
        )
    return Decision("NEEDS_PERSON", (), SEVERAL_REASON, ranked)


def better_fit(
    decision: Decision, placed: Sequence[UUID], kind: str, listed: Sequence[Item]
) -> tuple[Suggestion, ...]:
    """For a file a person placed (from a row): the items the reader is sure fit better,
    as suggestions only. None when the reader would place it there too, or is not sure."""
    if decision.status != "PLACED" or set(decision.requirement_ids) & set(placed):
        return ()
    titles = {entry.requirement_id: entry.title for entry in listed}
    looks = _LOOKS_LIKE.get(kind)
    return tuple(
        Suggestion(
            requirement_id,
            titles.get(requirement_id, ""),
            (f"This looks like {looks}. " if looks else "The reader found it fits another item. ")
            + f"Move it to {_quoted(titles.get(requirement_id, 'that item'))}?",
        )
        for requirement_id in decision.requirement_ids
    )[:MAX_SUGGESTIONS]


# --- When a reading ends (every way it ends) -------------------------------------------


@dataclass(frozen=True)
class Placing:
    """What a reading decided for a wizard file, before the reading's transaction."""

    # The version of the file's placement the decision was made from (0: none yet).
    based_on: int
    # The agent's placement to record, or None when the file's current one stands.
    decision: Decision | None
    # For a file a person placed: the items the reader is sure fit better.
    suggestions: tuple[Suggestion, ...]
    confidence: str
    # The request the reading means to file the file on (what it is read for meanwhile);
    # None where the reading's own stands.
    request: RequestRef | None


def plan_placement(
    connection: psycopg.Connection[Any],
    analysis_id: UUID,
    wizard: WizardFile,
    classification: Classification,
    source: str,
    text: str,
    listed: Sequence[Item],
    more: bool,
) -> Placing:
    """Decide where the reading puts the file. The agent places a file it has not placed
    yet, or could not place on an earlier reading; a person's placement, and one the agent
    made, stand (a person moves a file)."""
    confirmed_row = connection.execute(
        "SELECT confirmed_kind FROM evidence_analyses WHERE id = %s", (analysis_id,)
    ).fetchone()
    confirmed = None if confirmed_row is None or confirmed_row[0] is None else str(confirmed_row[0])
    kind = confirmed or classification.kind
    held = gate(
        GateFacts(
            custody_failed=False,
            readable=bool(text.strip()),
            kind=kind,
            kind_confirmed=confirmed is not None,
            confidence=classification.confidence,
            source=source,
        )
    )
    decision = decide(classification, kind, source, held, listed, more)
    current = wizard.current
    based_on = 0 if current is None else current.version
    if current is None or (current.method == "AGENT" and current.status != "PLACED"):
        request: RequestRef | None = None
        if decision.status == "PLACED":
            by_id = {entry.requirement_id: entry for entry in listed}
            primary = next(
                (
                    by_id[item].request_id
                    for item in decision.requirement_ids
                    if by_id[item].request_id is not None
                ),
                None,
            )
            request = None if primary is None else request_ref(connection, primary)
        return Placing(based_on, decision, (), classification.confidence, request)
    suggestions: tuple[Suggestion, ...] = ()
    if current.method == "PERSON" and current.status == "PLACED":
        suggestions = better_fit(decision, current.requirement_ids, kind, listed)
    return Placing(based_on, None, suggestions, classification.confidence, None)


def request_ref(connection: Reader, request_id: UUID) -> RequestRef | None:
    row = connection.execute(
        "SELECT id, control_ref, evidence_description, engagement_control_id "
        "FROM pbc_requests WHERE id = %s",
        (request_id,),
    ).fetchone()
    if row is None:
        return None
    return UUID(str(row[0])), str(row[1]), str(row[2]), row[3]


def _record(
    cursor: psycopg.Cursor[Any],
    wizard: WizardFile,
    placing: Placing,
    analysis_id: UUID,
    actor: UUID,
) -> None:
    """File the file where the agent placed it and record the placement, or record the
    reader's suggestion on a person's placement. The filing is tried first: an item that
    changed while the file was read (waived, removed, its request closed) leaves the file
    unplaced, and the reading's request follows from where the file is."""
    batch = wizard.batch
    current = _current(cursor, wizard.file_id)
    if (0 if current is None else current.version) != placing.based_on:
        # A person placed the file while it was read: their placement stands.
        return
    decision = placing.decision
    if decision is not None:
        if decision.status == "PLACED":
            try:
                with cursor.connection.transaction():
                    _file_on(
                        cursor, batch, wizard.file_id, decision.requirement_ids, (),
                        person=None, reason=decision.reason, actor=actor,
                    )  # fmt: skip
            except AcceptedItem:
                # A person accepted the item while the file was read.
                decision = Decision("NEEDS_PERSON", (), ACCEPTED_REASON, decision.suggestions)
            except WizardState:
                decision = Decision("NEEDS_PERSON", (), CHANGED_REASON, decision.suggestions)
        version = _insert(
            cursor, batch, wizard.file_id, status=decision.status, method="AGENT",
            requirement_ids=decision.requirement_ids, confidence=placing.confidence,
            reason=decision.reason, suggestions=[s.dump() for s in decision.suggestions],
            analysis_id=analysis_id, decided_by=None, supersedes=current,
        )  # fmt: skip
        _audit(
            cursor, batch.organization_id, batch.project_id, actor, "evidence.placed",
            "evidence_file", wizard.file_id,
            {"agent": "evidence-coordinator", "batch_id": str(batch.id), "version": version,
             "status": decision.status, "method": "AGENT",
             "requirement_ids": [str(item) for item in decision.requirement_ids],
             "analysis_id": str(analysis_id)},
        )  # fmt: skip
        return
    dumped = [s.dump() for s in placing.suggestions]
    if current is None or not dumped or list(current.suggestions) == dumped:
        return
    # A person's placement stands; the reader's better fit is recorded with it.
    version = _insert(
        cursor, batch, wizard.file_id, status=current.status, method=current.method,
        requirement_ids=current.requirement_ids, confidence=placing.confidence,
        reason=current.reason, suggestions=dumped, analysis_id=analysis_id,
        decided_by=current.decided_by, decided_at=current.decided_at, supersedes=current,
    )  # fmt: skip
    _audit(
        cursor, batch.organization_id, batch.project_id, actor, "evidence.placement_suggested",
        "evidence_file", wizard.file_id,
        {"agent": "evidence-coordinator", "batch_id": str(batch.id), "version": version,
         "suggested": [item["requirement_id"] for item in dumped],
         "analysis_id": str(analysis_id)},
    )  # fmt: skip


@dataclass(frozen=True)
class Ended:
    # Whether the assurance chain covers the file (False while its batch is still read).
    covered: bool
    # The request the file is filed on now (None: on no request).
    request_id: UUID | None
    # The checks its batch's landing queued, to hand to the worker once this commits.
    queued: list[UUID] = field(default_factory=list)


def reading_ended(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    actor: UUID,
    *,
    analysis_id: UUID,
    placing: Placing | None = None,
    failed: HeldCode | None = None,
) -> Ended | None:
    """The one hook for every way a wizard file's reading ends, run in the transaction that
    records the ending (evidence_analysis.run_analysis when read; its custody check and its
    last attempt, and agent_runs when cancelled, queued or running): where it was read, its
    placement (or the reader's suggestion on a person's); where it ended unread and nothing
    was placed, a person's choice with the gate's reason; then its batch's landing check.
    None for a file that is not a wizard file (or no longer on its batch's control)."""
    wizard = wizard_file(cursor, project_id, file_id)
    if wizard is None:
        return None
    _lock(cursor, wizard.batch.id)
    if placing is not None:
        _record(cursor, wizard, placing, analysis_id, actor)
    elif failed is not None:
        current = _current(cursor, file_id)
        if current is None or (current.method == "AGENT" and current.status != "PLACED"):
            version = _insert(
                cursor, wizard.batch, file_id, status="NEEDS_PERSON", method="AGENT",
                requirement_ids=(), confidence=None, reason=HELD_REASONS[failed],
                suggestions=(), analysis_id=analysis_id, decided_by=None, supersedes=current,
            )  # fmt: skip
            _audit(
                cursor, wizard.batch.organization_id, project_id, actor, "evidence.placed",
                "evidence_file", file_id,
                {"agent": "evidence-coordinator", "batch_id": str(wizard.batch.id),
                 "version": version, "status": "NEEDS_PERSON", "method": "AGENT",
                 "held": failed},
            )  # fmt: skip
    landing = land(cursor, wizard.batch, actor, file_id)
    filed = cursor.execute(
        "SELECT pbc_request_id FROM evidence_matches WHERE evidence_file_id = %s "
        "AND status = 'FILED'",
        (file_id,),
    ).fetchone()
    return Ended(
        landing.covered,
        None if filed is None or filed[0] is None else UUID(str(filed[0])),
        landing.queued,
    )


def analysis_ended(cursor: psycopg.Cursor[Any], analysis_id: UUID, actor: UUID) -> list[UUID]:
    """A reading cancelled by a person (agent_runs: queued, or stopped at its next check),
    in the cancellation's own transaction: for a wizard file, the one hook above. Returns
    the checks its batch's landing queued, which the caller hands to the worker once the
    cancellation has committed (a reading the worker stopped is handed on by the worker)."""
    row = cursor.execute(
        "SELECT project_id, evidence_file_id FROM evidence_analyses WHERE id = %s",
        (analysis_id,),
    ).fetchone()
    if row is None:
        return []
    ended = reading_ended(
        cursor, UUID(str(row[0])), UUID(str(row[1])), actor, analysis_id=analysis_id,
        failed="READ_FAILED",
    )  # fmt: skip
    return [] if ended is None else ended.queued


@dataclass(frozen=True)
class Landing:
    # Whether the assurance chain covers the file the landing was checked for.
    covered: bool = False
    # Checks queued by a landing no reading asked for, to hand to the worker on commit.
    queued: list[UUID] = field(default_factory=list)
    landed: bool = False


def land(
    cursor: psycopg.Cursor[Any], batch: Batch, actor: UUID, file_id: UUID | None = None
) -> Landing:
    """The batch's landing check: when none of its files still filed to its control is
    being read (a file of the batch filed to another control since is not the batch's to
    wait for), the receipts of its placements are applied, the control's checks are
    brought in step (the assurance chain queues each item's check once all its files are
    read), and when it landed is recorded. `file_id`, the file whose reading just ended;
    without one, the Evidence center took a file off the batch's control. Either way the
    checks it queues are returned, for the caller to hand to the worker on commit."""
    _lock(cursor, batch.id)
    if _still_read(cursor, batch, file_id):
        return Landing()
    _apply_receipts(cursor, batch, actor)
    covered = False
    queued: list[UUID] = []
    if file_id is not None:
        # The reading's own hook (evidence_assurance.queue_after_reading), keeping the
        # checks it queues: in a savepoint, so a failure never loses the reading.
        try:
            with cursor.connection.transaction():
                made = queue_for_file(cursor, batch.project_id, file_id, actor)
            covered, queued = file_id in made.covered, made.queued
        except Exception as error:
            logger.warning(
                "the evidence assessment of a file could not be queued (%s)",
                type(error).__name__,
            )
    else:
        try:
            with cursor.connection.transaction():
                queued = reconcile(cursor, batch.project_id, batch.control_id, actor).queued
        except Exception as error:
            logger.warning(
                "a wizard batch's checks could not be brought in step (%s)",
                type(error).__name__,
            )
    cursor.execute(
        "UPDATE evidence_batches SET landed_at = clock_timestamp() WHERE id = %s", (batch.id,)
    )
    return Landing(covered=covered, queued=queued, landed=True)


def _still_read(cursor: psycopg.Cursor[Any], batch: Batch, file_id: UUID | None) -> bool:
    """Whether a file of the batch still filed to its control, other than `file_id`, is
    being read (queued or working)."""
    return (
        cursor.execute(
            f"""
            SELECT 1 FROM evidence_files f
            JOIN evidence_analyses a ON a.evidence_file_id = f.id
            JOIN evidence_matches m
              ON m.evidence_file_id = f.id AND m.status = 'FILED'
             AND m.engagement_control_id = %s
            WHERE f.project_id = %s AND f.upload_batch_id = %s
              AND (%s::uuid IS NULL OR f.id <> %s)
              AND a.status IN ('PENDING', 'WORKING') AND NOT {in_force("f")}
            LIMIT 1
            """,  # noqa: S608
            (batch.control_id, batch.project_id, batch.id, file_id, file_id),
        ).fetchone()
        is not None
    )


def _waits_for_landing(cursor: psycopg.Cursor[Any], batch: Batch, file_id: UUID) -> bool:
    """Whether a person's move of the file waits for its batch's landing to apply its
    receipts and queue its checks: the file is one of the batch's own, came after the batch
    last landed (so the landing has not applied it yet), and another of its files on its
    control is still being read (so the landing is still to come). A file held before,
    dropped again in a session, never waits: no landing of that session applies it."""
    row = cursor.execute(
        "SELECT created_at FROM evidence_files WHERE id = %s AND upload_batch_id = %s",
        (file_id, batch.id),
    ).fetchone()
    if row is None:
        return False
    current = cursor.execute(
        "SELECT landed_at FROM evidence_batches WHERE id = %s", (batch.id,)
    ).fetchone()
    landed_at = None if current is None else current[0]
    if landed_at is not None and row[0] <= landed_at:
        return False
    return _still_read(cursor, batch, file_id)


def _receipts(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    file_id: UUID,
    filing: tuple[UUID, UUID | None],
    actor: UUID,
    by: Literal["AGENT", "PERSON"],
) -> None:
    """A placed file moves the request it is filed on (`filing`: its evidence_matches
    filing and that request), as a file read on its request does, and the own request of
    each further D&I item it is linked to (a bundle's other items), so a sent request stops
    chasing evidence in hand: each by the same per-item rule (evidence_receipts.
    apply_receipt), so an unsent D&I request's other items are asked for on their own.
    Applying it again changes nothing."""
    match_id, request_id = filing
    if request_id is not None:
        apply_receipt(cursor, organization_id, project_id, match_id, request_id, actor, by)
    for (other,) in cursor.execute(
        """
        SELECT DISTINCT q.pbc_request_id FROM evidence_requirement_files ef
        JOIN evidence_requirements q ON q.id = ef.requirement_id
        WHERE ef.evidence_file_id = %s AND ef.engagement_control_id = %s
          AND ef.status = 'LINKED' AND q.phase = 'DESIGN' AND q.status = 'REQUESTED'
          AND q.pbc_request_id IS NOT NULL AND q.pbc_request_id IS DISTINCT FROM %s
        ORDER BY q.pbc_request_id
        """,
        (file_id, control_id, request_id),
    ).fetchall():
        # Not this file's filing: the request's receipt is recorded on the request alone.
        apply_receipt(cursor, organization_id, project_id, None, UUID(str(other)), actor, by)


def _apply_receipts(cursor: psycopg.Cursor[Any], batch: Batch, actor: UUID) -> None:
    """Each placed file of the batch still on its control moves the requests of the items
    it is on (_receipts), in the order the files came."""
    rows = cursor.execute(
        f"""
        SELECT DISTINCT ON (p.evidence_file_id) p.evidence_file_id, p.status, p.method, m.id,
               m.pbc_request_id, f.created_at
        FROM evidence_files f
        JOIN evidence_placements p ON p.evidence_file_id = f.id
        JOIN evidence_matches m
          ON m.evidence_file_id = f.id AND m.status = 'FILED' AND m.engagement_control_id = %s
        WHERE f.project_id = %s AND f.upload_batch_id = %s AND NOT {in_force("f")}
        ORDER BY p.evidence_file_id, p.version DESC
        """,  # noqa: S608
        (batch.control_id, batch.project_id, batch.id),
    ).fetchall()
    for row in sorted(rows, key=lambda found: (found[5], str(found[0]))):
        if row[1] != "PLACED":
            continue
        _receipts(
            cursor, batch.organization_id, batch.project_id, batch.control_id,
            UUID(str(row[0])), (UUID(str(row[3])), None if row[4] is None else UUID(str(row[4]))),
            actor, "AGENT" if row[2] == "AGENT" else "PERSON",
        )  # fmt: skip


def land_open_batches(connection: psycopg.Connection[Any], limit: int = 50) -> int:
    """The start-up backstop, beside the assurance chain's backfill: a batch whose files on
    its control have all ended since it last landed (a reading that ended by a way that did
    not land it, or before the hook existed) lands now. A file that ended unread with
    nothing placed needs a person, with the gate's reason. Bounded, the oldest first, in
    active engagements; never raises. Returns how many batches landed."""
    ended = """
        SELECT 1 FROM evidence_files f
        JOIN evidence_analyses a ON a.evidence_file_id = f.id
        JOIN evidence_matches m
          ON m.evidence_file_id = f.id AND m.status = 'FILED'
         AND m.engagement_control_id = b.engagement_control_id
        WHERE f.project_id = b.project_id AND f.upload_batch_id = b.id
    """
    try:
        with connection.transaction():
            rows = connection.execute(
                f"""
                SELECT b.id FROM evidence_batches b
                JOIN projects p ON p.id = b.project_id AND p.status = 'ACTIVE'
                WHERE EXISTS ({ended}
                      AND a.status IN ('READY', 'FAILED')
                      AND coalesce(a.finished_at, a.cancelled_at, a.updated_at)
                          > coalesce(b.landed_at, '-infinity'::timestamptz))
                  AND NOT EXISTS ({ended} AND a.status IN ('PENDING', 'WORKING'))
                ORDER BY b.created_at
                LIMIT %s
                """,  # noqa: S608
                (limit,),
            ).fetchall()
    except psycopg.Error as error:
        logger.warning("wizard batches could not be checked (%s)", type(error).__name__)
        return 0
    landed = 0
    for (batch_id,) in rows:
        try:
            with transaction(connection) as cursor:
                batch = _batch(cursor, UUID(str(batch_id)))
                if batch is None:
                    continue
                _lock(cursor, batch.id)
                for file_id, analysis_id, note in cursor.execute(
                    f"""
                    SELECT f.id, a.id, a.note FROM evidence_files f
                    JOIN evidence_analyses a ON a.evidence_file_id = f.id
                    JOIN evidence_matches m
                      ON m.evidence_file_id = f.id AND m.status = 'FILED'
                     AND m.engagement_control_id = %s
                    WHERE f.upload_batch_id = %s AND a.status = 'FAILED'
                      AND NOT {in_force("f")}
                      AND NOT EXISTS (SELECT 1 FROM evidence_placements p
                                      WHERE p.evidence_file_id = f.id)
                    """,  # noqa: S608
                    (batch.control_id, batch.id),
                ).fetchall():
                    code: HeldCode = "CUSTODY" if note == CUSTODY_FAILED_NOTE else "READ_FAILED"
                    _insert(
                        cursor, batch, UUID(str(file_id)), status="NEEDS_PERSON",
                        method="AGENT", requirement_ids=(), confidence=None,
                        reason=HELD_REASONS[code], suggestions=(),
                        analysis_id=UUID(str(analysis_id)), decided_by=None, supersedes=None,
                    )  # fmt: skip
                if land(cursor, batch, batch.created_by).landed:
                    landed += 1
        except Exception as error:
            logger.warning("a wizard batch could not be landed (%s)", type(error).__name__)
    return landed


# --- Where a file is: filing it, and following it --------------------------------------


@dataclass(frozen=True)
class Filed:
    match_id: UUID
    # The request the file is filed on now, or None (on no request: in the control's files).
    request_id: UUID | None
    # The requests whose items it left (its filing's, or a link's).
    left: tuple[UUID, ...] = ()


def _file_on(
    cursor: psycopg.Cursor[Any],
    batch: Batch,
    file_id: UUID,
    wanted: Sequence[UUID],
    before: Sequence[UUID],
    *,
    person: UUID | None,
    reason: str,
    actor: UUID,
) -> Filed:
    """File the file for the items `wanted`, where it served `before`: on the first one's
    request for that item where it is requested (the file's evidence_matches filing),
    linked to every other one; with none, on no request (the control's files). A person's
    move also takes it off the items it leaves, and a judgment that rested on it alone goes
    back to not reviewed (as evidence_plans.unlink_file does). The requests it leaves follow
    the evidence left on them; the caller applies the receipt of the request it goes to."""
    from ai_workforce_api.evidence_plans import _has_own_evidence

    project_id, control_id = batch.project_id, batch.control_id
    # The plan's row before its requirements, as every writer of a plan takes them.
    cursor.execute(
        "SELECT 1 FROM evidence_plans WHERE project_id = %s AND engagement_control_id = %s "
        "FOR UPDATE",
        (project_id, control_id),
    )
    known = {item.requirement_id: item for item in design_items(cursor, project_id, control_id)}
    missing = [item for item in wanted if item not in known]
    if missing:
        raise WizardState("that item is not one the control's D&I evidence still asks for")
    if any(known[item].accepted for item in wanted if item not in before):
        # Nothing is added under a person's acceptance: they reopen it on the list first.
        raise AcceptedItem()
    match = cursor.execute(
        "SELECT id, pbc_request_id, requirement_id FROM evidence_matches "
        "WHERE evidence_file_id = %s AND status = 'FILED' AND engagement_control_id = %s "
        "FOR UPDATE",
        (file_id, control_id),
    ).fetchone()
    if match is None:
        raise WizardState("the file is no longer filed to this control")
    match_id = UUID(str(match[0]))
    primary = next((known[item] for item in wanted if known[item].request_id is not None), None)
    target = (None, None) if primary is None else (primary.request_id, primary.requirement_id)
    released = None
    if (match[1], match[2]) != target:
        released = release_receipt(cursor, match_id)
        cursor.execute(
            """
            UPDATE evidence_matches
            SET pbc_request_id = %s, requirement_id = %s, filed_by = %s, decided_by = %s,
                reason = %s, version = version + 1
            WHERE id = %s
            """,
            (target[0], target[1], "AGENT" if person is None else "PERSON", person,
             _reason(reason), match_id),
        )  # fmt: skip
    elif person is not None:
        # The same filing, now a person's.
        cursor.execute(
            "UPDATE evidence_matches SET filed_by = 'PERSON', decided_by = %s, "
            "version = version + 1 WHERE id = %s",
            (person, match_id),
        )
    left: list[UUID] = []
    if match[1] is not None and match[1] != target[0]:
        left.append(UUID(str(match[1])))
    linked = {
        UUID(str(row[1])): (UUID(str(row[0])), None if row[2] is None else UUID(str(row[2])))
        for row in cursor.execute(
            """
            SELECT ef.id, ef.requirement_id, q.pbc_request_id FROM evidence_requirement_files ef
            JOIN evidence_requirements q ON q.id = ef.requirement_id
            WHERE ef.evidence_file_id = %s AND ef.engagement_control_id = %s
              AND ef.status = 'LINKED' AND q.phase = 'DESIGN'
            FOR UPDATE OF ef
            """,
            (file_id, control_id),
        ).fetchall()
    }
    keep = {item for item in wanted if primary is None or item != primary.requirement_id}
    # The requests of the items a link is taken off: each follows the evidence left on it,
    # as on a person's unlinking (evidence_plans.unlink_file).
    unlinked: list[UUID] = []
    if person is not None:
        for requirement_id, (link_id, carried) in linked.items():
            if requirement_id in keep:
                continue
            if carried is not None:
                unlinked.append(carried)
            cursor.execute(
                """
                UPDATE evidence_requirement_files
                SET status = 'REMOVED', removed_by = %s, removed_at = clock_timestamp(),
                    removed_reason = %s, version = version + 1
                WHERE id = %s
                """,
                (person, "Moved by a person in the evidence wizard.", link_id),
            )
            cursor.execute(
                "UPDATE evidence_requirements SET version = version + 1 WHERE id = %s",
                (requirement_id,),
            )
            _audit(
                cursor, batch.organization_id, project_id, person,
                "evidence_requirement.file_unlinked", "evidence_requirement", requirement_id,
                {"link_id": str(link_id), "evidence_file_id": str(file_id), "by": "PERSON",
                 "wizard_batch_id": str(batch.id)},
            )  # fmt: skip
    for requirement_id in [item for item in wanted if item in keep]:
        if requirement_id in linked:
            continue
        saved = cursor.execute(
            """
            INSERT INTO evidence_requirement_files (
                organization_id, project_id, engagement_control_id, requirement_id,
                evidence_file_id, status, origin, reason, linked_by
            )
            VALUES (%s, %s, %s, %s, %s, 'LINKED', %s, %s, %s)
            ON CONFLICT (requirement_id, evidence_file_id) DO UPDATE
            SET status = 'LINKED', origin = EXCLUDED.origin, reason = EXCLUDED.reason,
                linked_by = EXCLUDED.linked_by, linked_at = clock_timestamp(),
                removed_by = NULL, removed_at = NULL, removed_reason = '',
                version = evidence_requirement_files.version + 1
            WHERE evidence_requirement_files.status <> 'LINKED'
            RETURNING id
            """,
            (
                batch.organization_id, project_id, control_id, requirement_id, file_id,
                "AGENT" if person is None else "PERSON",
                "Placed on this item by the evidence wizard."
                if person is None
                else "Placed on this item by a person in the evidence wizard.",
                person,
            ),
        ).fetchone()  # fmt: skip
        if saved is None:
            continue
        cursor.execute(
            "UPDATE evidence_requirements SET version = version + 1 WHERE id = %s",
            (requirement_id,),
        )
        _audit(
            cursor, batch.organization_id, project_id, actor,
            "evidence_requirement.file_linked", "evidence_requirement", requirement_id,
            {"evidence_file_id": str(file_id), "link_id": str(saved[0]),
             "by": "AGENT" if person is None else "PERSON", "wizard_batch_id": str(batch.id)},
        )  # fmt: skip
    # A judgment that rested on the file alone goes back to not reviewed.
    for requirement_id in [item for item in before if item not in wanted]:
        if _has_own_evidence(cursor, requirement_id):
            continue
        cursor.execute(
            """
            UPDATE evidence_requirements
            SET sufficiency = 'NOT_REVIEWED', sufficiency_note = '', sufficiency_by = NULL,
                sufficiency_at = NULL, version = version + 1
            WHERE id = %s AND sufficiency <> 'NOT_REVIEWED'
            """,
            (requirement_id,),
        )
    if released is not None:
        follow_evidence(
            cursor, batch.organization_id, project_id, released.request_id, actor,
            released.before,
        )  # fmt: skip
    for request_id in dict.fromkeys(unlinked):
        if released is None or request_id != released.request_id:
            follow_evidence(cursor, batch.organization_id, project_id, request_id, actor)
    gone = [*left, *([] if released is None else [released.request_id]), *unlinked]
    return Filed(match_id, target[0], tuple(dict.fromkeys(gone)))


def _location(
    connection: Reader, control_id: UUID, file_ids: Sequence[UUID]
) -> dict[UUID, tuple[bool, list[UUID]]]:
    """Where each file is now: whether it is filed to the control, and the control's D&I
    items it serves there, in the plan's order: filed for an item on its request, filed on
    a request as a whole (each of its items the reader did not find it misses), or linked.
    The rule of evidence_plans.requirement_files, never a placement's record."""
    from ai_workforce_api.evidence_plans import request_file_serves

    if not file_ids:
        return {}
    found: dict[UUID, tuple[bool, list[UUID]]] = {
        UUID(str(row[0])): (True, [])
        for row in connection.execute(
            "SELECT evidence_file_id FROM evidence_file_links "
            "WHERE evidence_file_id = ANY(%s) AND engagement_control_id = %s",
            (list(file_ids), control_id),
        ).fetchall()
    }
    rows = connection.execute(
        f"""
        SELECT f.id, q.id
        FROM evidence_files f
        JOIN evidence_file_links l
          ON l.evidence_file_id = f.id AND l.engagement_control_id = %(control)s
        JOIN evidence_requirements q
          ON q.engagement_control_id = %(control)s AND q.phase = 'DESIGN'
         AND q.status <> 'REMOVED'
        LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
        WHERE f.id = ANY(%(files)s) AND (
            (l.pbc_request_id IS NOT NULL AND l.pbc_request_id = q.pbc_request_id
             AND {request_file_serves("f.id")})
            OR EXISTS (
                SELECT 1 FROM evidence_requirement_files ef
                WHERE ef.requirement_id = q.id AND ef.evidence_file_id = f.id
                  AND ef.status = 'LINKED' AND ef.engagement_control_id = %(control)s))
        ORDER BY q.created_at, q.requirement_key
        """,  # noqa: S608
        {"control": control_id, "files": list(file_ids)},
    ).fetchall()
    for file_id, requirement_id in rows:
        entry = found.setdefault(UUID(str(file_id)), (True, []))
        if UUID(str(requirement_id)) not in entry[1]:
            entry[1].append(UUID(str(requirement_id)))
    return found


def _ordered(first: Sequence[UUID], actual: Sequence[UUID]) -> list[UUID]:
    """The items a file is on, in the order its placement named them, then the plan's."""
    return [item for item in first if item in actual] + [
        item for item in actual if item not in first
    ]


def _repoint(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    *,
    derive: bool,
) -> UUID | None:
    """The reading names the request the file is filed on now; where that changed and it
    is on a request, its deterministic findings are derived there (`derive`). The reader's
    own findings stay held. Returns the request."""
    row = cursor.execute(
        """
        SELECT a.id, a.status, a.pbc_request_id, m.pbc_request_id
        FROM evidence_analyses a
        LEFT JOIN evidence_matches m ON m.evidence_file_id = a.evidence_file_id
         AND m.status = 'FILED'
        WHERE a.evidence_file_id = %s
        """,
        (file_id,),
    ).fetchone()
    if row is None:
        return None
    now = None if row[3] is None else UUID(str(row[3]))
    if row[1] != "READY":
        return now
    if row[2] != row[3]:
        cursor.execute(
            "UPDATE evidence_analyses SET pbc_request_id = %s, version = version + 1, "
            "updated_at = clock_timestamp() WHERE id = %s",
            (now, row[0]),
        )
    if derive and now is not None:
        derive_from_analysis(
            cursor, organization_id, project_id, UUID(str(row[0])), reader=ReaderFindings()
        )
    return now


def follow_filing(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    file_id: UUID,
    actor: UUID,
    reason: str,
    *,
    moved: bool = False,
) -> None:
    """A flow outside the wizard moved a file the wizard has (the Evidence center's filing,
    `moved` when it changed the file's control; the D&I list's link or unlink): its
    placement follows where the file is now, recorded as a person's, superseding the
    current one, which is kept. Called in that flow's transaction after its change, with
    lock_wizard taken before it. Nothing is recorded where nothing changed."""
    batch = _placement_batch(cursor, project_id, file_id)
    if batch is None:
        return
    on_control, actual = _location(cursor, batch.control_id, [file_id]).get(file_id, (False, []))
    current = _current(cursor, file_id)
    items = _ordered(() if current is None else current.requirement_ids, actual)
    status: PlacementStatus
    if items:
        status = "PLACED"
    elif not on_control:
        status = "NOT_DESIGN"
    elif current is None:
        # Not placed yet, and on no item: its reading places it.
        return
    elif current.status == "PLACED":
        status = "NOT_DESIGN"
    else:
        status = current.status
    same = (
        current is not None and current.status == status and list(current.requirement_ids) == items
    )
    if same and not moved:
        return
    analysis = cursor.execute(
        "SELECT id, classification ->> 'confidence' FROM evidence_analyses "
        "WHERE evidence_file_id = %s",
        (file_id,),
    ).fetchone()
    version = _insert(
        cursor, batch, file_id, status=status, method="PERSON", requirement_ids=items,
        confidence=None if analysis is None else analysis[1], reason=reason, suggestions=(),
        analysis_id=None if analysis is None else UUID(str(analysis[0])), decided_by=actor,
        supersedes=current,
    )  # fmt: skip
    _audit(
        cursor, batch.organization_id, project_id, actor, "evidence.placement_followed",
        "evidence_file", file_id,
        {"batch_id": str(batch.id), "version": version, "status": status, "method": "PERSON",
         "requirement_ids": [str(item) for item in items], "reason": reason},
    )  # fmt: skip
    if on_control:
        _repoint(cursor, batch.organization_id, project_id, file_id, derive=True)


# --- Uploading into the wizard (evidence_intake) -------------------------------------


@dataclass(frozen=True)
class Scope:
    """A wizard upload's scope, checked: its batch, the control, the row's item and the
    request that carries it (None when the item is not requested yet)."""

    batch_id: UUID
    control_id: UUID
    requirement_id: UUID | None
    request_id: UUID | None


def _same(batch: Batch, project_id: UUID, control_id: UUID, requirement_id: UUID | None) -> None:
    if batch.project_id != project_id:
        raise NotVisible()
    if batch.control_id != control_id:
        raise WizardState("this batch belongs to another control; start the wizard again")
    if batch.requirement_id is None and requirement_id is not None:
        raise WizardState(
            "this batch is for all of the control's D&I items; open the wizard from the row "
            "to add files for one item"
        )
    if batch.requirement_id != requirement_id:
        raise WizardState("this batch was opened for another item; start the wizard again")


def upload_scope(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    batch_id: UUID,
    control_id: UUID,
    requirement_id: UUID | None,
) -> Scope:
    """Check a wizard upload before anything is stored: the control is this engagement's
    and in scope; the row's item, if any, is one of its D&I items that still expect
    evidence; and the batch, once recorded, keeps its control and its item."""
    control = connection.execute(
        "SELECT included FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if control is None:
        raise NotVisible()
    if not control[0]:
        raise WizardState("the control is not in scope, so it takes no D&I evidence")
    request_id: UUID | None = None
    if requirement_id is not None:
        item = next(
            (
                entry
                for entry in design_items(connection, project_id, control_id)
                if entry.requirement_id == requirement_id
            ),
            None,
        )
        if item is None:
            raise WizardState(
                "this item is not one of the control's D&I items that still expect evidence"
            )
        if item.accepted:
            raise AcceptedItem()
        request_id = item.request_id
    batch = _batch(connection, batch_id)
    if batch is not None:
        _same(batch, project_id, control_id, requirement_id)
    elif (
        connection.execute(
            "SELECT 1 FROM evidence_files WHERE project_id = %s AND upload_batch_id = %s LIMIT 1",
            (project_id, batch_id),
        ).fetchone()
        is not None
    ):
        raise WizardState("this batch was used for other uploads; start the wizard again")
    return Scope(batch_id, control_id, requirement_id, request_id)


def open_batch(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    scope: Scope,
    actor: UUID,
) -> Batch:
    """First in the transaction of a wizard upload that stores a file, or records one held
    already: the session's batch, recorded by its first such upload (never before it, so
    no batch is empty), and held to the end of the transaction before the upload files
    anything on a request or takes the plan, so an upload and its batch's landing both
    take the batch first. Two first uploads at once agree on the one recorded."""
    made = cursor.execute(
        """
        INSERT INTO evidence_batches (
            id, organization_id, project_id, engagement_control_id, requirement_id, created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
        """,
        (scope.batch_id, organization_id, project_id, scope.control_id, scope.requirement_id,
         actor),
    ).fetchone()  # fmt: skip
    batch = _batch_of(
        cursor.execute(
            f"SELECT {_BATCH_COLUMNS} FROM evidence_batches b WHERE b.id = %s "  # noqa: S608
            "FOR UPDATE",
            (scope.batch_id,),
        ).fetchone()
    )
    if batch is None:
        raise NotVisible()
    _same(batch, project_id, scope.control_id, scope.requirement_id)
    if made is not None:
        _audit(
            cursor, organization_id, project_id, actor, "evidence.batch_started",
            "evidence_batch", scope.batch_id,
            {"control_id": str(scope.control_id), "phase": "DESIGN",
             "requirement_id": None if scope.requirement_id is None
             else str(scope.requirement_id)},
        )  # fmt: skip
    return batch


def record_duplicate(cursor: psycopg.Cursor[Any], batch: Batch, file_id: UUID, actor: UUID) -> None:
    """A file the engagement holds already, dropped again in this session: listed in it,
    with the placement it has. Nothing is stored twice; dropped again in its own session,
    it is listed there already."""
    cursor.execute(
        """
        INSERT INTO evidence_batch_duplicates (
            batch_id, evidence_file_id, organization_id, project_id, added_by
        )
        SELECT %s, f.id, %s, %s, %s FROM evidence_files f
        WHERE f.id = %s AND f.project_id = %s AND f.upload_batch_id IS DISTINCT FROM %s
        ON CONFLICT (batch_id, evidence_file_id) DO NOTHING
        """,
        (batch.id, batch.organization_id, batch.project_id, actor, file_id, batch.project_id,
         batch.id),
    )  # fmt: skip


def refuse_wizard_batch(
    connection: psycopg.Connection[Any], project_id: UUID, batch_id: UUID
) -> None:
    """An upload that is not the wizard's never joins a wizard batch."""
    row = connection.execute(
        "SELECT 1 FROM evidence_batches WHERE id = %s AND project_id = %s", (batch_id, project_id)
    ).fetchone()
    if row is not None:
        raise WizardState("this batch belongs to the D&I evidence wizard; add the files there")


def place_on_upload(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    scope: Scope,
    batch: Batch,
    file_id: UUID,
    actor: UUID,
) -> None:
    """In the upload's transaction: a file added from a row is placed on the row's item, a
    person's choice (the file's filing names the item's request and the item; an item not
    requested yet is linked to the file instead). A file for the whole control waits for
    its reading."""
    if scope.requirement_id is None:
        return
    if scope.request_id is None:
        _file_on(
            cursor, batch, file_id, (scope.requirement_id,), (), person=actor,
            reason=ADDED_ON_ITEM, actor=actor,
        )  # fmt: skip
    version = _insert(
        cursor, batch, file_id, status="PLACED", method="PERSON",
        requirement_ids=(scope.requirement_id,), confidence=None, reason=ADDED_ON_ITEM,
        suggestions=(), analysis_id=None, decided_by=actor, supersedes=None,
    )  # fmt: skip
    _audit(
        cursor, organization_id, project_id, actor, "evidence.placed", "evidence_file",
        file_id,
        {"batch_id": str(scope.batch_id), "version": version, "status": "PLACED",
         "method": "PERSON", "requirement_ids": [str(scope.requirement_id)]},
    )  # fmt: skip


# --- The batch's state (2.4) ---------------------------------------------------------


class ReadBody(BaseModel):
    status: ReadStatus
    method: ReadMethod
    # Null where the file has no pages (a text file, a spreadsheet) or is not read yet.
    pages: int | None
    started_at: datetime | None
    finished_at: datetime | None
    note: str
    # One plain sentence for the person when the file's reading gave no usable answer
    # (B1i): why, what was kept and what to do; "" unless FAILED.
    failure_note: str = ""


def read_failure_note(status: str, note: str) -> str:
    """ReadBody.failure_note, from the reading's status and note."""
    if status != "FAILED":
        return ""
    reason = note.strip() or "The file could not be read."
    return f"{reason} The file is kept. Read it again, or place it on its item yourself."


class ClassificationBody(BaseModel):
    kind: str
    label: str
    confidence: Confidence
    summary: str


class SuggestionBody(BaseModel):
    requirement_id: UUID
    title: str
    reason: str


class PlacementBody(BaseModel):
    status: ShownStatus
    method: Method
    # The items the file is on now, from its filing and links.
    requirement_ids: list[UUID]
    reason: str
    suggestions: list[SuggestionBody]
    # The current placement's version, which a move is made at; 0 before any is recorded.
    version: int


class AddressBody(BaseModel):
    code: str
    verdict: Verdict


class FileBody(BaseModel):
    file_id: UUID
    name: str
    size_bytes: int
    extension: str
    # True for a file the engagement held already, dropped again in this session.
    duplicate: bool
    stage: FileStage
    read: ReadBody
    # Null until the file is read.
    classification: ClassificationBody | None
    placement: PlacementBody
    addresses: list[AddressBody]


class ItemBody(BaseModel):
    requirement_id: UUID
    title: str
    request_title: str
    letters: list[str]
    file_ids: list[UUID]
    # The item's entry of GET .../evidence-assurance (NOT_CHECKED until it has a run).
    assurance: RequestBody | None
    # For each of its files (by id), the attributes that file addresses in this item's own
    # REVIEWED entry, each with its verdict there; [] until it is reviewed.
    addresses: dict[UUID, list[AddressBody]]


class StagesBody(BaseModel):
    stored: int
    read: int
    sorted: int
    checked_items: int
    items: int
    files: int


class BatchBody(BaseModel):
    batch_id: UUID
    control_id: UUID
    chosen_requirement_id: UUID | None
    created_at: datetime
    server_now: datetime
    stages: StagesBody
    files: list[FileBody]
    items: list[ItemBody]


class BatchSummaryBody(BaseModel):
    """One of the control's recent wizard sessions, for the D&I list's progress line and to
    reopen it from any device."""

    batch_id: UUID
    created_at: datetime
    created_by_name: str
    chosen_requirement_id: UUID | None
    files: int
    # Files still being read, or read and not yet placed.
    in_progress: int
    needs_person: int
    not_design: int
    # Every file's reading ended and every placed item's check ended.
    finished: bool
    finished_at: datetime | None


class BatchesBody(BaseModel):
    batches: list[BatchSummaryBody]


class PlacementChange(BaseModel):
    """A person's placement: the items the file goes to (none: not D&I evidence), at the
    version of the placement they saw."""

    requirement_ids: list[UUID] = Field(default_factory=list, max_length=MAX_ITEMS)
    version: int = Field(ge=0)


# Each listed file of the batches named: its own files, then those dropped again in them.
_LISTED = f"""
    SELECT listed.batch_id, f.id, f.file_name, f.size_bytes, coalesce(a.status, 'PENDING'),
           a.extraction, a.page_count,
           CASE WHEN a.status <> 'PENDING' THEN a.started_at END,
           CASE WHEN a.status IN ('READY', 'FAILED')
                THEN coalesce(a.finished_at, a.cancelled_at) END,
           coalesce(a.note, ''), a.classification, a.confirmed_kind, listed.duplicate,
           coalesce(btrim(a.extracted_text) <> '', false), coalesce(a.source, ''),
           EXISTS (SELECT 1 FROM evidence_batches ob WHERE ob.id = f.upload_batch_id),
           (SELECT m.filed_by FROM evidence_matches m
            WHERE m.evidence_file_id = f.id AND m.status = 'FILED')
    FROM (
        SELECT f.upload_batch_id AS batch_id, f.id AS file_id, false AS duplicate,
               f.created_at AS listed_at
        FROM evidence_files f
        WHERE f.project_id = %(project)s AND f.upload_batch_id = ANY(%(batches)s)
        UNION ALL
        SELECT d.batch_id, d.evidence_file_id, true, d.added_at
        FROM evidence_batch_duplicates d
        WHERE d.project_id = %(project)s AND d.batch_id = ANY(%(batches)s)
    ) listed
    JOIN evidence_files f ON f.id = listed.file_id
    LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
    WHERE NOT {in_force("f")}
    ORDER BY listed.batch_id, listed.listed_at, f.id
"""


def _extension(name: str) -> str:
    stem, dot, tail = name.rpartition(".")
    if not dot or not stem or not tail.isalnum() or len(tail) > 10:
        return ""
    return tail.lower()


def _read_method(extraction: Any) -> ReadMethod:
    if extraction in (None, "NONE"):
        return "NONE"
    return "OCR" if extraction == "OCR" else "TEXT"


def _addresses(file_id: UUID, entry: RequestBody | None) -> list[AddressBody]:
    """The attributes the file addresses for one item: those whose verified passages (the
    attribute's or its elements') in that item's own REVIEWED assurance entry are in this
    file, each with that attribute's verdict there. Empty until the item's check is
    reviewed. Never merged across items: the same letter can stand for another attribute,
    with another verdict, on another item."""
    if entry is None or entry.status != "REVIEWED":
        return []
    found: list[AddressBody] = []
    for attribute in entry.attributes:
        passages = [
            *attribute.passages,
            *(passage for element in attribute.elements for passage in element.passages),
        ]
        if any(passage.file_id == file_id for passage in passages):
            found.append(AddressBody(code=attribute.code, verdict=attribute.verdict))
    return sorted(found, key=lambda address: (len(address.code), address.code))


def _classification(row: tuple[Any, ...]) -> ClassificationBody | None:
    if str(row[4]) != "READY" or not isinstance(row[10], dict):
        return None
    kind = str(row[11] or row[10].get("kind") or "other")
    confidence = row[10].get("confidence")
    return ClassificationBody(
        kind=kind,
        label=KIND_LABELS.get(kind, kind),
        confidence=(
            cast(Confidence, confidence) if confidence in ("high", "medium", "low") else "low"
        ),
        summary=clean_line(str(row[10].get("summary") or ""), 300),
    )


def _file_body(
    row: tuple[Any, ...],
    current: Current | None,
    on_control: bool,
    actual: list[UUID],
    entries: dict[UUID, RequestBody],
) -> FileBody:
    """A file's entry: where it is now (its filing and links), never where a placement
    said it was; its placement's record (who decided, why, at which version) beside it."""
    file_id = UUID(str(row[1]))
    status = str(row[4])
    read_status: ReadStatus = (
        cast(ReadStatus, status)
        if status in ("PENDING", "WORKING", "READY", "FAILED")
        else "PENDING"
    )
    items = _ordered(() if current is None else current.requirement_ids, actual)
    shown: ShownStatus
    reason = "" if current is None else current.reason
    if not on_control:
        # Filed to another control since: not this control's D&I evidence any more.
        shown = "NOT_DESIGN"
        if current is None or current.status != "NOT_DESIGN":
            reason = ELSEWHERE
    elif items:
        shown = "PLACED"
        if current is None:
            reason = HELD_BEFORE
    elif current is None:
        # The wizard's own file waits for its reading; one held before it is on no item.
        shown = "PENDING" if bool(row[15]) else "NOT_DESIGN"
        reason = "" if bool(row[15]) else HELD_BEFORE
    elif current.status == "PLACED":
        shown = "NOT_DESIGN"
        reason = OFF_ITEMS
    else:
        shown = current.status
    stage: FileStage
    if not on_control:
        stage = "NOT_DESIGN"
    elif read_status == "FAILED":
        stage = "FAILED"
    elif read_status == "PENDING":
        stage = "STORED"
    elif read_status == "WORKING":
        stage = "READING"
    elif shown == "PENDING":
        stage = "READ"
    elif shown == "PLACED":
        stage = "SORTED"
    elif shown == "NEEDS_PERSON":
        stage = "NEEDS_PERSON"
    else:
        stage = "NOT_DESIGN"
    method: Method = (
        current.method if current is not None else "AGENT" if row[16] == "AGENT" else "PERSON"
    )
    if current is None and bool(row[15]):
        method = "AGENT"
    return FileBody(
        file_id=file_id,
        name=clean_line(str(row[2]), 200),
        size_bytes=int(row[3]),
        extension=_extension(str(row[2])),
        duplicate=bool(row[12]),
        stage=stage,
        read=ReadBody(
            status=read_status,
            method=_read_method(row[5]) if read_status in ("READY", "FAILED") else "NONE",
            pages=None if row[6] is None else int(row[6]),
            started_at=row[7],
            finished_at=row[8],
            note=clean_line(str(row[9]), 300) if read_status in ("READY", "FAILED") else "",
            failure_note=read_failure_note(read_status, clean_line(str(row[9]), 300)),
        ),
        classification=_classification(row),
        placement=PlacementBody(
            status=shown,
            method=method,
            requirement_ids=items,
            reason=reason,
            suggestions=(
                []
                if current is None
                else [SuggestionBody.model_validate(item) for item in current.suggestions]
            ),
            version=0 if current is None else current.version,
        ),
        # Kept for one release (docs/evidence-wizard.md, 2.4): filled only for a file on
        # exactly one item; per item, items[].addresses.
        addresses=_addresses(file_id, entries.get(items[0])) if len(items) == 1 else [],
    )


def _ended(file: FileBody, away: set[UUID]) -> bool:
    """Whether the session is done with a file's reading: it ended, or the file was filed
    to another control since (`away`), whose reading is that control's."""
    return file.read.status in ("READY", "FAILED") or file.file_id in away


def _not_checked(
    requirement_id: UUID, categories: tuple[str, ...], rows: Sequence[tuple[Any, ...]]
) -> RequestBody:
    """An item's entry before any check of it was recorded: NOT_CHECKED, as the assurance
    chain lists it (never silently skipped), with the lens its files read now would take
    (lens_for over the files that ended and pass the gate)."""
    kinds: list[str] = []
    for row in rows:
        status = str(row[4])
        if status not in ("READY", "FAILED"):
            continue
        classification = row[10] if isinstance(row[10], dict) else {}
        custody = status == "FAILED" and str(row[9]) == CUSTODY_FAILED_NOTE
        kind = str(row[11] or classification.get("kind") or "other")
        held = gate(
            GateFacts(
                custody_failed=custody,
                readable=bool(row[13]),
                kind=kind,
                kind_confirmed=row[11] is not None,
                confidence=str(classification.get("confidence") or ""),
                source=str(row[14]),
                read_failed=status == "FAILED" and not custody,
            )
        )
        if held is None:
            kinds.append(kind)
    return RequestBody(
        requirement_id=requirement_id,
        run_id=None,
        status="NOT_CHECKED",
        stage="GATE",
        held=None,
        lens=lens_for(categories, kinds),
        read_in_part=False,
    )


@dataclass(frozen=True)
class _Composed:
    files: list[FileBody]
    items: list[ItemBody]
    # The files filed to another control since they were dropped.
    away: set[UUID]


def _compose(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    batches: Sequence[Batch],
) -> dict[UUID, _Composed]:
    """The files and items of the sessions named, from the records, with one read of where
    the files are and, once any placed item has a check, one read of the assurance chain."""
    from ai_workforce_api.evidence_plans import reference

    rows = connection.execute(
        _LISTED, {"project": project_id, "batches": [batch.id for batch in batches]}
    ).fetchall()
    by_batch: dict[UUID, list[tuple[Any, ...]]] = {batch.id: [] for batch in batches}
    for row in rows:
        listed = by_batch.get(UUID(str(row[0])))
        if listed is not None and len(listed) < MAX_LISTED:
            listed.append(row)
    file_ids = list(dict.fromkeys(UUID(str(row[1])) for row in rows))
    currents = _currents(connection, file_ids)
    located = _location(connection, control_id, file_ids)
    placed = list(dict.fromkeys(item for _on, items in located.values() for item in items))
    details: dict[UUID, tuple[str, UUID | None, tuple[str, ...]]] = {
        UUID(str(row[0])): (
            str(row[1]),
            None if row[2] is None else UUID(str(row[2])),
            tuple(str(item) for item in (row[3] or [])),
        )
        for row in connection.execute(
            "SELECT id, title, pbc_request_id, categories FROM evidence_requirements "
            "WHERE id = ANY(%s) AND engagement_control_id = %s",
            (placed, control_id),
        ).fetchall()
    }
    checked = bool(placed) and (
        connection.execute(
            "SELECT 1 FROM evidence_assessments WHERE requirement_id = ANY(%s) LIMIT 1",
            (placed,),
        ).fetchone()
        is not None
    )
    entries: dict[UUID, RequestBody] = {}
    if checked:
        entries = {
            entry.requirement_id: entry
            for entry in read_assurance(connection, project_id, control_id).requests
        }
    else:
        by_file = {UUID(str(row[1])): row for row in rows}
        for requirement_id in placed:
            on_item = [
                by_file[file_id]
                for file_id, (_on, items) in located.items()
                if requirement_id in items and file_id in by_file
            ]
            entries[requirement_id] = _not_checked(
                requirement_id, details.get(requirement_id, ("", None, ()))[2], on_item
            )
    links = linked_attributes(connection, control_id) if placed else {}
    composed: dict[UUID, _Composed] = {}
    for batch in batches:
        files: list[FileBody] = []
        away: set[UUID] = set()
        on_items: dict[UUID, list[UUID]] = {}
        for row in by_batch[batch.id]:
            file_id = UUID(str(row[1]))
            on_control, actual = located.get(file_id, (False, []))
            if not on_control:
                away.add(file_id)
            body = _file_body(row, currents.get(file_id), on_control, actual, entries)
            files.append(body)
            if body.placement.status == "PLACED":
                for requirement_id in body.placement.requirement_ids:
                    on_items.setdefault(requirement_id, []).append(file_id)
        items: list[ItemBody] = []
        for requirement_id, item_files in on_items.items():
            title, request_id, _categories = details.get(requirement_id, ("", None, ()))
            items.append(
                ItemBody(
                    requirement_id=requirement_id,
                    title=clean_line(title, 200),
                    request_title=(
                        "Not yet requested"
                        if request_id is None
                        else f"Request {reference(request_id)}"
                    ),
                    letters=[code for code, _text in links.get(requirement_id, ())],
                    file_ids=item_files,
                    assurance=entries.get(requirement_id),
                    addresses={
                        file_id: _addresses(file_id, entries.get(requirement_id))
                        for file_id in item_files
                    },
                )
            )
        composed[batch.id] = _Composed(files, items, away)
    return composed


def _visible_batch(connection: Reader, project_id: UUID, control_id: UUID, batch_id: UUID) -> Batch:
    batch = _batch(connection, batch_id)
    if batch is None or batch.project_id != project_id or batch.control_id != control_id:
        raise NotVisible()
    return batch


def batch_state(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, batch_id: UUID
) -> BatchBody:
    """The batch as the wizard shows it, every state from the records: each file's stage,
    reading, classification, where it is and the attributes it addresses; each item that
    holds one of its files, with its check (the assurance chain's entry for it)."""
    batch = _visible_batch(connection, project_id, control_id, batch_id)
    composed = _compose(connection, project_id, control_id, [batch])[batch.id]
    files, items, away = composed.files, composed.items, composed.away
    now = connection.execute("SELECT clock_timestamp()").fetchone()
    return BatchBody(
        batch_id=batch.id,
        control_id=batch.control_id,
        chosen_requirement_id=batch.requirement_id,
        created_at=batch.created_at,
        server_now=batch.created_at if now is None else now[0],
        stages=StagesBody(
            stored=len(files),
            read=sum(1 for file in files if _ended(file, away)),
            sorted=sum(1 for file in files if file.placement.status != "PENDING"),
            checked_items=sum(
                1
                for item in items
                if item.assurance is not None and item.assurance.status in _CHECKED
            ),
            items=len(items),
            files=len(files),
        ),
        files=files,
        items=items,
    )


def list_batches(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> BatchesBody:
    """The control's recent wizard sessions, the most recent first: how many files each
    holds, how many are still being read or sorted, wait for a person or are not D&I
    evidence, and whether it has finished (every file's reading ended and every placed
    item's check ended), and when."""
    known = connection.execute(
        "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if known is None:
        raise NotVisible()
    rows = connection.execute(
        f"""
        SELECT {_BATCH_COLUMNS}, coalesce(u.display_name, '')
        FROM evidence_batches b LEFT JOIN users u ON u.id = b.created_by
        WHERE b.project_id = %s AND b.engagement_control_id = %s
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT %s
        """,  # noqa: S608
        (project_id, control_id, RECENT_BATCHES),
    ).fetchall()
    batches = [batch for batch in (_batch_of(row[:8]) for row in rows) if batch is not None]
    names = {UUID(str(row[0])): str(row[8]) for row in rows}
    composed = _compose(connection, project_id, control_id, batches) if batches else {}
    found: list[BatchSummaryBody] = []
    for batch in batches:
        files, items = composed[batch.id].files, composed[batch.id].items
        finished = all(_ended(file, composed[batch.id].away) for file in files) and all(
            item.assurance is not None and item.assurance.status in _CHECKED for item in items
        )
        moments = [file.read.finished_at for file in files if file.read.finished_at] + [
            item.assurance.finished_at
            for item in items
            if item.assurance is not None and item.assurance.finished_at is not None
        ]
        found.append(
            BatchSummaryBody(
                batch_id=batch.id,
                created_at=batch.created_at,
                created_by_name=clean_line(names.get(batch.id, ""), 200),
                chosen_requirement_id=batch.requirement_id,
                files=len(files),
                in_progress=sum(1 for file in files if file.stage in ("STORED", "READING", "READ")),
                needs_person=sum(1 for file in files if file.placement.status == "NEEDS_PERSON"),
                not_design=sum(1 for file in files if file.placement.status == "NOT_DESIGN"),
                finished=finished,
                finished_at=max(moments) if finished and moments else None,
            )
        )
    return BatchesBody(batches=found)


def file_entry(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    batch_id: UUID,
    file_id: UUID,
) -> FileBody:
    body = batch_state(connection, project_id, control_id, batch_id)
    found = next((file for file in body.files if file.file_id == file_id), None)
    if found is None:
        raise NotVisible()
    return found


# --- A person's move -------------------------------------------------------------------


def _person(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    action: Action,
) -> None:
    authorize(
        connection,
        principal=principal,
        action=action,
        organization_id=organization_id,
        project_id=project_id,
    )
    if principal.kind is not PrincipalKind.USER:
        raise NotVisible()


def move(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    batch_id: UUID,
    file_id: UUID,
    body: PlacementChange,
) -> tuple[FileBody, list[UUID]]:
    """A person places a file of the session (its own, or one dropped again in it): on the
    items named (none: not D&I evidence), at the version they saw; never onto an item a
    person accepted (reopened on the list first). The filing moves with it (off the items
    it leaves, onto the ones it goes to); the requests follow the evidence: those of the
    items it goes to are received as for a file added on its item, and on a D&I request
    only ever provided directly, the items it left without evidence are asked for again in
    a draft of their own; the reading names the request it is on now, where its
    deterministic findings are derived; and the checks of both items are brought in step.
    Before the file's batch has landed, the receipts and the checks wait for the landing.
    The earlier placement is superseded and kept. Returns the file's entry and the checks
    to hand to the worker once this has committed."""
    _person(connection, principal, organization_id, project_id, Action.TASK_UPDATE)
    status = connection.execute(
        "SELECT status::text FROM projects WHERE id = %s AND organization_id = %s",
        (project_id, organization_id),
    ).fetchone()
    if status is None:
        raise NotVisible()
    if status[0] != "ACTIVE":
        raise WizardState("the engagement is not active, so its evidence stays where it is")
    wanted = list(body.requirement_ids)
    if len(set(wanted)) != len(wanted):
        raise WizardState("name each item once")
    try:
        with transaction(connection) as cursor:
            # The file's reading first, then the batch, as a reading's own transaction
            # takes them, so a move and the end of a reading wait for each other.
            reading = cursor.execute(
                """
                SELECT a.id, a.status,
                       f.upload_batch_id = %s OR EXISTS (
                           SELECT 1 FROM evidence_batch_duplicates d
                           WHERE d.batch_id = %s AND d.evidence_file_id = f.id)
                FROM evidence_files f
                JOIN evidence_analyses a ON a.evidence_file_id = f.id
                WHERE f.id = %s AND f.project_id = %s AND f.organization_id = %s
                FOR UPDATE OF a
                """,
                (batch_id, batch_id, file_id, project_id, organization_id),
            ).fetchone()
            if reading is None or not reading[2]:
                raise NotVisible()
            session = _visible_batch(cursor, project_id, control_id, batch_id)
            # The batch the file's placements and landing belong to: its own wizard batch,
            # else this session.
            own = _placement_batch(cursor, project_id, file_id) or session
            _lock(cursor, own.id)
            if is_withdrawn(cursor, file_id):
                raise WizardState("this file is withdrawn; restore it first")
            current = _current(cursor, file_id)
            if (0 if current is None else current.version) != body.version:
                raise WizardState("the placement changed")
            on_control, before = _location(cursor, control_id, [file_id]).get(file_id, (False, []))
            if not on_control:
                raise WizardState("the file is no longer filed to this control")
            if reading[1] in ("PENDING", "WORKING"):
                raise WizardState("the agent is still reading this file")
            from ai_workforce_api.evidence_review import review_decided

            analysis_id = UUID(str(reading[0]))
            if review_decided(connection, analysis_id):
                raise WizardState(
                    "the screenshot review is signed off, so the file stays where it is"
                )
            reason = PLACED_BY_PERSON if wanted else MOVED_OUT
            filed = _file_on(
                cursor, session, file_id, wanted, before, person=principal.id, reason=reason,
                actor=principal.id,
            )  # fmt: skip
            confidence = cursor.execute(
                "SELECT classification ->> 'confidence' FROM evidence_analyses WHERE id = %s",
                (analysis_id,),
            ).fetchone()
            version = _insert(
                cursor, session, file_id, status="PLACED" if wanted else "NOT_DESIGN",
                method="PERSON", requirement_ids=wanted,
                confidence=None if confidence is None else confidence[0], reason=reason,
                suggestions=(), analysis_id=analysis_id, decided_by=principal.id,
                supersedes=current,
            )  # fmt: skip
            # Before its batch has landed (another of its files is still read, and this one
            # came after the batch last landed), the placement is recorded and nothing
            # else: the landing applies the receipts and queues the checks, so files that
            # arrive together are checked once and an unsent request is not split early.
            waits = _waits_for_landing(cursor, own, file_id)
            asked: list[UUID] = []
            if not waits:
                _receipts(
                    cursor, organization_id, project_id, control_id, file_id,
                    (filed.match_id, filed.request_id), principal.id, "PERSON",
                )  # fmt: skip
                # A D&I request only ever provided directly: the items the move left
                # without evidence are asked for again in a draft of their own.
                asked = [
                    request_id
                    for request_id in filed.left
                    if ask_again_for_items_left(
                        cursor, organization_id, project_id, request_id, principal.id
                    )
                ]
            _repoint(cursor, organization_id, project_id, file_id, derive=True)
            _audit(
                cursor, organization_id, project_id, principal.id, "evidence.placement_moved",
                "evidence_file", file_id,
                {"batch_id": str(session.id), "version": version, "method": "PERSON",
                 "status": "PLACED" if wanted else "NOT_DESIGN",
                 "requirement_ids": [str(item) for item in wanted],
                 "from": [str(item) for item in before],
                 "from_status": None if current is None else current.status,
                 "asked_again": [str(item) for item in asked], "waits_for_landing": waits},
            )  # fmt: skip
            queued = [] if waits else queue_safely(cursor, project_id, file_id, principal.id)
    except UniqueViolation:
        raise WizardState("the placement changed") from None
    return file_entry(connection, project_id, control_id, batch_id, file_id), queued


# --- Routes ----------------------------------------------------------------------------


def register_evidence_wizard(
    app: FastAPI, settings: Settings, scheduler: object | None = None
) -> None:
    control = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
    base = f"{control}/evidence-batches/{{batch_id}}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            # The checks a move queues are handed to the worker once it has committed.
            return committed(
                lambda: _call(settings, lambda connection: work(connection, principal))
            )
        except WizardState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    @app.get(f"{control}/evidence-batches", response_model=BatchesBody)
    def batches(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> BatchesBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> BatchesBody:
            authorize(connection, principal=principal, action=Action.PROJECT_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            return list_batches(connection, project_id, control_id)

        return run(request, work)

    @app.get(base, response_model=BatchBody)
    def state(
        organization_id: UUID, project_id: UUID, control_id: UUID, batch_id: UUID,
        request: Request,
    ) -> BatchBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> BatchBody:
            authorize(connection, principal=principal, action=Action.PROJECT_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            return batch_state(connection, project_id, control_id, batch_id)

        return run(request, work)

    @app.post(f"{base}/files/{{file_id}}/placement", response_model=FileBody)
    def placement(
        organization_id: UUID, project_id: UUID, control_id: UUID, batch_id: UUID,
        file_id: UUID, body: PlacementChange, request: Request,
    ) -> FileBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> FileBody:
            entry, queued = move(
                connection, principal, organization_id, project_id, control_id, batch_id,
                file_id, body,
            )  # fmt: skip
            after_commit(lambda: schedule_assessments(scheduler, queued))
            return entry

        return run(request, work)


__all__ = [
    "BatchBody",
    "BatchesBody",
    "Decision",
    "FileBody",
    "Item",
    "PlacementChange",
    "WizardState",
    "batch_state",
    "decide",
    "design_items",
    "list_batches",
    "move",
    "register_evidence_wizard",
]
