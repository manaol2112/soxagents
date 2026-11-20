"""The points of the D&I workpaper, each settled where it belongs (product owner, 16 November
2026; docs/design-workpaper.md, section 3.9; migration 0169).

"Matters for the reviewer" is gone. What waited on a person there is a *point*, assembled on
each read from the same records (`points_of`, the open branches of the former matters):

- a check out of date (STALE), an open finding (FINDING), an attribute not concluded
  (NOT_CONCLUDED), an attribute shown only on files not relied on (NOT_RELIED), an
  attribute one request shows and another that asks for it does not (CONFLICT), a file held
  out of the check not by purpose (HELD), each sentence of a check's completeness review
  (COMPLETENESS) and each follow-up of a check (FOLLOW_UP). Since 16 November 2026 (B1l
  point 6, migration 0173) also each assumption an agent stated that a person accepted with
  its attribute without confirming it (ASSUMPTION): confirmed there, changed there (That's
  right, Change...), or considered with a reason. An open conflict the agents stated is one
  too, settled only by deciding it on its attribute, never by a consideration (after the
  review of B1k, 16 November 2026: a consideration would leave the conflict open, still
  holding the attributes' acceptance).
- Each has a `key` (the first 32 hexadecimal characters of the SHA-256 of its kind and of
  the identity of what it is about), a `place` where the view shows it, the existing
  actions that settle it (`settle`, CONSIDER last where it is offered) and the person's
  consideration that stands for its key, if any.
- A point is settled when its own action makes it go (it is then no longer assembled) or
  when a consideration stands for its key. A consideration whose point is no longer
  assembled is kept, and is neither shown nor counted.

What is not a point: a person's tickmark and a decision on a file (shown at their place in
sections 4 and 5, and on the file's line), an exception a person recorded (section 4 shows
it and the conclusion evaluates it), a file left out by purpose (its line says so), and the
agent's considerations, which are the draft of the preparer's message to the reviewer
(`observations_of`), never part of the workpaper.

The rules (the server decides; the page says so before the press):

- The preparer's sign-off of a design workpaper (prepare, and so "Sign and send for
  review") is refused while a point is not settled (`prepare_refusal`), after the
  refusals of section 3.7. The reviewer's sign-off is refused while a point is not settled
  (`signoff_refusal`): one can appear after the preparer signed, when the evidence or a
  check changes. A point raised after a sign-off does not, by itself, put it out of date.
  Demo seeding (a demo engagement, `projects.demo`, and a demo identity,
  `users.demo_organization_id`, both set only by demo initialization) is held to the rules
  it had, as for section 3.6.
- Considering a point and withdrawing a consideration are a person's (TASK_UPDATE, never
  an agent), on an open engagement, while the design workpaper is a draft that is not
  being drafted, sent from a page that shows its current version, for a point of the
  current read. Each bumps the workpaper's version (as recording a conclusion does) and is
  one audit event, with at most 200 characters of the reason. The reason is the person's
  own, 10 to 1,000 characters, cleaned as text is (untrusted).
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, Path, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field

from ai_workforce_api import file_reliability
from ai_workforce_api.authorization import Action, NotVisible, Principal
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line

if TYPE_CHECKING:
    from ai_workforce_api.design_workpaper import (
        AttributeRecord,
        CheckRecord,
        EvidenceBody,
        FindingRecord,
        Reading,
        RequestRecord,
    )
    from ai_workforce_api.file_reliability import Decision as FileDecision

logger = logging.getLogger(__name__)

PointKind = Literal[
    "STALE", "FINDING", "NOT_CONCLUDED", "NOT_RELIED", "CONFLICT", "HELD", "COMPLETENESS",
    "FOLLOW_UP", "ASSUMPTION",
]  # fmt: skip
# ASSUMPTION: That's right or Change... on the assumption (the attribute assumptions' routes).
SettleAction = Literal["RELIABILITY", "TICKMARK", "RERUN", "FINDING", "ASSUMPTION", "CONSIDER"]
PlaceAt = Literal["ATTRIBUTE", "FILE", "REQUEST"]

KEY_PATTERN = r"^[0-9a-f]{32}$"
# The agent's observations the preparer's message starts from: at most so many.
MAX_OBSERVATIONS = 20
# How much of the first point's words a refusal carries.
REFUSAL_TEXT = 160
# A point's sentence as a consideration keeps it (migration 0169).
POINT_TEXT_LIMIT = 2000
AUDIT_REASON = 200
SENTENCE_LIMIT = 600
NAME_LIMIT = 200
MAX_REFS = 8

CONSIDERED = "design_point.considered"
WITHDRAWN = "design_point.withdrawn"

NOT_MIGRATED = "D&I point considerations are not on record: migration 0169 is not applied"

# The refusals, each one sentence.
POINT_CHANGED = "This point changed; read the workpaper again."
NOT_CONSIDERED = "A conflict is settled by deciding it on its attribute, not by a consideration."
PREPARED_ALREADY = "The design workpaper is prepared; reopen it to settle a point."
# The gate's codes a person has nothing to do about: the file is left out by purpose.
_LEFT_OUT_BY_PURPOSE = frozenset({"POPULATION"})


# --- The response ------------------------------------------------------------------------


class PlaceBody(BaseModel):
    """Where the view shows a point: under an attribute's row in section 4, under the row
    naming a file (section 5, else its line in "Tickmarks and evidence"), or at the head of
    section 4 naming a request. `requirement_id` is also given, where it is known, for a
    point at an attribute or a file: the request a tickmark or a file decision is made on."""

    at: PlaceAt
    attribute_id: UUID | None = None
    file_id: UUID | None = None
    requirement_id: UUID | None = None


class PersonBody(BaseModel):
    id: UUID
    name: str


class ConsideredBody(BaseModel):
    id: UUID
    by: PersonBody
    at: datetime
    reason: str


class PointBody(BaseModel):
    key: str
    kind: PointKind
    text: str
    refs: list[str] = Field(default_factory=list)
    place: PlaceBody
    settle: list[SettleAction]
    considered: ConsideredBody | None = None


class ObservationBody(BaseModel):
    """One of the agent's observations (a check review's consideration), as text: the
    draft of the preparer's message to the reviewer, never part of the workpaper."""

    text: str
    refs: list[str] = Field(default_factory=list)


# --- The points (pure) -------------------------------------------------------------------


class AssumedRecord(BaseModel):
    """An assumption that is a point to settle (attribute_assumptions; `accepted_assumptions`
    reads which): what the agent assumed, the attribute codes it names (none: the set as a
    whole), its status and kind. ACCEPTED_WITH_ATTRIBUTE: a person accepted it with its
    attribute, not confirmed. OPEN: still open on an attribute whose criteria are accepted
    (or on an accepted set), or a conflict nobody decided."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    assumed: str
    codes: tuple[str, ...] = ()
    status: Literal["OPEN", "ACCEPTED_WITH_ATTRIBUTE"] = "ACCEPTED_WITH_ATTRIBUTE"
    kind: Literal["MISSING", "AMBIGUOUS", "CONFLICT", "NOT_KNOWN"] = "MISSING"


def assumption_points(
    assumptions: Sequence[AssumedRecord], attributes: Sequence[AttributeRecord]
) -> list[PointBody]:
    """Each assumption accepted with its attribute, not confirmed, is a point to settle before
    the preparer signs (B1l point 6, design-workpaper.md 3.9): at the first attribute it names
    that the workpaper concludes on (the set's: at the first attribute), settled by That's
    right or Change... on it, or considered with a reason. Its key is the assumption's own.
    One whose attributes are all gone is not a point: nothing rests on it."""
    by_code = {attribute.code: attribute for attribute in attributes}
    found: list[PointBody] = []
    for item in assumptions:
        named = [by_code[code] for code in item.codes if code in by_code]
        if item.codes and not named:
            continue
        on = named[0] if named else (attributes[0] if attributes else None)
        if on is None:
            continue
        assumed = _sentence(item.assumed, 500).rstrip(" .")
        accepted_with = f"attribute {named[0].code}" if named else "the attributes"
        if item.kind == "CONFLICT":
            said = (
                f"A conflict is not decided: {assumed}. It holds {accepted_with} until a "
                "person decides it."
            )
        elif item.status == "OPEN":
            said = (
                f"The agent assumed: {assumed}. It is open on {accepted_with}, accepted "
                "since, not confirmed."
            )
        else:
            said = (
                f"The agent assumed: {assumed}. It was accepted with {accepted_with}, "
                "not confirmed."
            )
        found.append(
            PointBody(
                key=point_key("ASSUMPTION", item.id),
                kind="ASSUMPTION",
                text=_sentence(said),
                place=PlaceBody(at="ATTRIBUTE", attribute_id=on.id),
                # A conflict only by deciding it: a consideration would leave it open,
                # still holding the attributes' acceptance.
                settle=["ASSUMPTION"] if item.kind == "CONFLICT" else _settle("ASSUMPTION"),
            )
        )
    return found


def point_key(kind: PointKind, *identity: object) -> str:
    """A point's key: the first 32 hexadecimal characters of the SHA-256 of its kind and of
    the identity of what it is about, the same on every read while the point is the same."""
    text = "\x1f".join([kind, *(str(part) for part in identity)])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def _sentence(text: str, limit: int = SENTENCE_LIMIT) -> str:
    return clean_line(text, limit).strip()


def _refs(file_ids: Sequence[UUID], evidence: Sequence[EvidenceBody]) -> list[str]:
    wanted = set(file_ids)
    return [entry.ref for entry in evidence if entry.file_id in wanted][:MAX_REFS]


def _settle(*actions: SettleAction) -> list[SettleAction]:
    """The actions that settle a point, CONSIDER always last."""
    return [*actions, "CONSIDER"]


def points_of(
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    attributes: Sequence[AttributeRecord],
    readings: Mapping[UUID, Sequence[Reading]],
    findings: Sequence[FindingRecord],
    evidence: Sequence[EvidenceBody],
    decisions: Sequence[FileDecision] = (),
    closed: Mapping[UUID, frozenset[UUID]] | None = None,
    assumptions: Sequence[AssumedRecord] = (),
    coded: Sequence[AttributeRecord] | None = None,
) -> list[PointBody]:
    """Everything that waits on a person, from the records, in the order a reviewer needs
    it: each check out of date, the open findings, the attributes a check leaves to a
    person, those shown only on files not relied on, those one request shows and another
    that asks for it does not, the files held out of a check not by purpose, what each
    current check's review says is incomplete or not yet reliable, and the checks'
    follow-ups. `readings` are the checks' words left to the checks
    (design_workpaper.attributes_of). A person's decision on a file's reliability
    (`decisions`, of `decisions_applying`) settles what the check says of that file's
    reliability; a follow-up whose attributes all carry a closing tickmark on its request
    (`closed`, of `closed_by_tickmark`) is answered. Each point once, by its key.

    Keys, by what each point is about (section 3.9: the same on every read while the point
    is the same, new when it changes, as when a new check has other words): STALE the
    request; FINDING the finding; NOT_CONCLUDED the attribute and the request that leaves
    it open; NOT_RELIED the attribute; CONFLICT the attribute and the request that does
    not show it; HELD the file and the gate's code; COMPLETENESS the request and the
    sentence; FOLLOW_UP the request and the follow-up's words. A check run again that says
    the same keeps the key, and a consideration of it still stands."""
    from ai_workforce_api import design_workpaper as view

    found: list[PointBody] = []
    keys: set[str] = set()

    def add(point: PointBody) -> None:
        if point.text and point.key not in keys:
            keys.add(point.key)
            found.append(point)

    names = {file.file_id: file.file_name for request in requests for file in request.files}
    titles = {request.requirement_id: clean_line(request.title, 120) for request in requests}
    listed = {entry.file_id for entry in evidence}
    for request in requests:
        check = checks.get(request.requirement_id)
        if check is None or check.status != "OUT_OF_DATE":
            continue
        why = check.out_of_date[0] if check.out_of_date else ""
        text = (
            f"The check of “{clean_line(request.title, 200)}” is out of date, "
            f"so nothing of it is used here. {why} Check the request again."
        )
        add(
            PointBody(
                key=point_key("STALE", request.requirement_id),
                kind="STALE",
                text=_sentence(" ".join(text.split())),
                refs=_refs([file.file_id for file in request.files], evidence),
                place=PlaceBody(at="REQUEST", requirement_id=request.requirement_id),
                settle=_settle("RERUN"),
            )
        )
    for finding in findings:
        if finding.file_id is not None and (
            finding.file_id in listed or finding.requirement_id is None
        ):
            place = PlaceBody(
                at="FILE", file_id=finding.file_id, requirement_id=finding.requirement_id
            )
        else:
            place = PlaceBody(at="REQUEST", requirement_id=finding.requirement_id)
        add(
            PointBody(
                key=point_key("FINDING", finding.id),
                kind="FINDING",
                text=_sentence(finding.title, 300),
                refs=_refs([finding.file_id] if finding.file_id else [], evidence),
                place=place,
                settle=_settle("FINDING"),
            )
        )
    for attribute in attributes:
        mine = readings.get(attribute.id, [])
        left = next((r for r in mine if r.open), None)
        if left is not None:
            add(
                PointBody(
                    key=point_key("NOT_CONCLUDED", attribute.id, left.requirement_id),
                    kind="NOT_CONCLUDED",
                    text=_sentence(f"Attribute {attribute.code} is not concluded. {left.basis}"),
                    refs=_refs([*left.exceptions, *left.shows], evidence),
                    place=PlaceBody(
                        at="ATTRIBUTE",
                        attribute_id=attribute.id,
                        requirement_id=left.requirement_id,
                    ),  # fmt: skip
                    settle=_settle("TICKMARK"),
                )
            )
    for attribute in attributes:
        supporting = [
            r for r in readings.get(attribute.id, []) if r.state in ("SHOWN", "SHOWN_IN_PART")
        ]
        if supporting and all(r.not_relied for r in supporting):
            # D3 (19 November 2026): a showing rests on a file not relied on where any of
            # its files is one; the point names those files only, never the relied ones
            # beside them (before, every file of the showing was named as not relied on).
            excluded = {
                (d.requirement_id, d.file_id) for d in decisions if d.kind == "NOT_RELIED_ON"
            }
            resting_on = list(
                dict.fromkeys(
                    file_id
                    for r in supporting
                    for file_id in r.shows
                    if (r.requirement_id, file_id) in excluded
                )
            )
            add(
                PointBody(
                    key=point_key("NOT_RELIED", attribute.id),
                    kind="NOT_RELIED",
                    text=_sentence(
                        f"Attribute {attribute.code} rests on "
                        f"{'files' if len(resting_on) > 1 else 'a file'} not relied on: "
                        f"{view._listed_names([names.get(f, 'a file') for f in resting_on])}."
                    ),
                    refs=_refs(resting_on, evidence),
                    place=PlaceBody(at="ATTRIBUTE", attribute_id=attribute.id),
                    settle=_settle("RELIABILITY"),
                )
            )
    for attribute in attributes:
        mine = readings.get(attribute.id, [])
        if view.standing(mine)[0] != "SHOWN":
            continue
        shown = next(r for r in mine if r.state == "SHOWN")
        short = next((r for r in mine if r.state == "NOT_SHOWN"), None)
        if short is not None:
            add(
                PointBody(
                    key=point_key("CONFLICT", attribute.id, short.requirement_id),
                    kind="CONFLICT",
                    text=_sentence(
                        f"Attribute {attribute.code} is shown by the evidence for "
                        f"“{titles.get(shown.requirement_id, '')}” and not shown by "
                        f"the evidence for “{titles.get(short.requirement_id, '')}”, "
                        "which also asks for it."
                    ),
                    refs=_refs(shown.shows, evidence),
                    place=PlaceBody(
                        at="ATTRIBUTE",
                        attribute_id=attribute.id,
                        requirement_id=short.requirement_id,
                    ),  # fmt: skip
                    settle=_settle("TICKMARK"),
                )
            )
    # Every file a gate left out, by purpose or not: its line says so, and the review's own
    # sentence about it is not said again.
    told: set[UUID] = set()
    for request in requests:
        check = checks.get(request.requirement_id)
        if check is None or not check.gated:
            continue
        for held in check.held:
            if held.file_id in told or held.file_id not in listed:
                continue
            told.add(held.file_id)
            if held.code in _LEFT_OUT_BY_PURPOSE:
                continue
            name = clean_line(names.get(held.file_id, "A file"), NAME_LIMIT)
            add(
                PointBody(
                    key=point_key("HELD", held.file_id, held.code),
                    kind="HELD",
                    text=_sentence(f"{name} is not part of the check. {held.reason}"),
                    refs=_refs([held.file_id], evidence),
                    place=PlaceBody(
                        at="FILE", file_id=held.file_id, requirement_id=request.requirement_id
                    ),
                    settle=_settle(),
                )
            )
    current = [
        (request, check)
        for request, check in view._current(requests, checks)
        if check.review is not None and check.engine >= 2
    ]
    said: set[str] = set()
    for request, check in current:
        assert check.review is not None
        mine_names = [file.file_name for file in request.files]
        decided = {d.file_id for d in decisions if d.requirement_id == request.requirement_id}
        asked = file_reliability.question_sentences(
            check.review, check.file_ids, {file.file_id: file.file_name for file in request.files}
        )
        questions = {
            _sentence(sentence): file_id
            for file_id, sentences in asked.items()
            for sentence in sentences
        }
        for reason in check.review.completeness.reasons:
            text = _sentence(reason)
            about = [request.files[i].file_id for i in view.named_files(text, mine_names)]
            asking = questions.get(text)
            # A file left out is already said on its line; a person's decision on a file's
            # reliability settles what the check says of it.
            if (
                not text
                or text in said
                or (asking is not None and asking in decided)
                or (about and all(f in told for f in about))
            ):
                continue
            said.add(text)
            on = asking if asking is not None else (about[0] if len(about) == 1 else None)
            add(
                PointBody(
                    key=point_key("COMPLETENESS", request.requirement_id, text),
                    kind="COMPLETENESS",
                    text=text,
                    refs=_refs(about if asking is None else [asking], evidence),
                    place=PlaceBody(at="REQUEST", requirement_id=request.requirement_id)
                    if on is None
                    else PlaceBody(at="FILE", file_id=on, requirement_id=request.requirement_id),
                    settle=_settle("RELIABILITY") if asking is not None else _settle(),
                )
            )
    approved = {attribute.id for attribute in attributes}
    for request, check in current:
        assert check.review is not None
        answered = (closed or {}).get(request.requirement_id, frozenset())
        for follow_up in check.review.follow_ups:
            # Every attribute it asks about carries a closing tickmark on this request:
            # the tickmark answered it, and nothing more waits for it.
            if follow_up.attribute_ids and all(a in answered for a in follow_up.attribute_ids):
                continue
            text = _sentence(follow_up.request, 500)
            on_attributes = [a for a in dict.fromkeys(follow_up.attribute_ids) if a in approved]
            add(
                PointBody(
                    key=point_key("FOLLOW_UP", request.requirement_id, text),
                    kind="FOLLOW_UP",
                    text=text,
                    refs=_refs(check.file_ids, evidence),
                    place=PlaceBody(
                        at="ATTRIBUTE", attribute_id=on_attributes[0],
                        requirement_id=request.requirement_id,
                    )
                    if len(on_attributes) == 1
                    else PlaceBody(at="REQUEST", requirement_id=request.requirement_id),
                    settle=_settle("TICKMARK") if follow_up.attribute_ids else _settle(),
                )
            )  # fmt: skip
    # The agents' assumptions a person accepted with an attribute, not confirmed (B1l). An
    # assumption names attributes by their stable code (A1, A2: control_attributes.code), not
    # by the workpaper's letter, so it is matched against `coded`, the same attributes under
    # those codes (attributes_coded); without it, `attributes` as given.
    for point in assumption_points(assumptions, attributes if coded is None else coded):
        add(point)
    return found


def observations_of(
    requests: Sequence[RequestRecord],
    checks: Mapping[UUID, CheckRecord],
    evidence: Sequence[EvidenceBody],
) -> list[ObservationBody]:
    """The agent's observations: the considerations of each current check's review (engine
    2), in the requests' order, each once, at most MAX_OBSERVATIONS."""
    from ai_workforce_api import design_workpaper as view

    found: list[ObservationBody] = []
    seen: set[str] = set()
    for _request, check in view._current(requests, checks):
        if check.review is None or check.engine < 2:
            continue
        for remark in check.review.considerations:
            text = _sentence(remark.text)
            if not text or text in seen:
                continue
            seen.add(text)
            found.append(
                ObservationBody(
                    text=text,
                    refs=_refs([passage.file_id for passage in remark.passages], evidence),
                )
            )
    return found[:MAX_OBSERVATIONS]


def with_considerations(
    points: Sequence[PointBody], standing: Mapping[str, ConsideredBody]
) -> list[PointBody]:
    """The points with the consideration that stands for each key, where one does. A point
    a consideration may not settle (no CONSIDER: an open conflict) is never read as
    settled by one."""
    return [
        point.model_copy(
            update={"considered": standing.get(point.key) if "CONSIDER" in point.settle else None}
        )
        for point in points
    ]


def unsettled(points: Sequence[PointBody]) -> list[PointBody]:
    """The points no consideration stands for (a point settled by its own action is not
    assembled at all)."""
    return [point for point in points if point.considered is None]


def _cut(text: str, limit: int = REFUSAL_TEXT) -> str:
    words = " ".join(text.split())
    if len(words) > limit:
        words = words[: limit - 1].rstrip() + "…"
    return words.rstrip(".")


def prepare_words(waiting: Sequence[PointBody]) -> str | None:
    """Why the preparer's sign-off is refused: the points not settled, and the first one's
    words. None where every point is settled."""
    if not waiting:
        return None
    return f"Settle the points first ({len(waiting)}): {_cut(waiting[0].text)}."


def signoff_words(waiting: Sequence[PointBody]) -> str | None:
    """Why the reviewer's sign-off is refused: points raised since the preparer signed
    (the preparer could not sign over one). None where every point is settled."""
    if not waiting:
        return None
    if len(waiting) == 1:
        return "1 point was raised since the preparer signed: return it to the preparer."
    return (
        f"{len(waiting)} points were raised since the preparer signed: return it to the preparer."
    )


# --- Reading -----------------------------------------------------------------------------


def _tolerant[T](connection: psycopg.Connection[Any], read: Callable[[], T], absent: T) -> T:
    """`read`, in a savepoint: where migration 0169 is not applied, `absent`, and the
    caller's transaction as it was."""
    try:
        with connection.transaction():
            return read()
    except psycopg.errors.UndefinedTable:
        logger.warning(NOT_MIGRATED)
        return absent


def considerations_standing(
    connection: psycopg.Connection[Any], workpaper_id: UUID | None, lock: bool = False
) -> dict[str, ConsideredBody]:
    """The considerations that stand on the design workpaper, by point key."""
    if workpaper_id is None:
        return {}

    def read() -> dict[str, ConsideredBody]:
        rows = connection.execute(
            """
            SELECT c.point_key, c.id, c.considered_by, u.display_name, c.considered_at, c.reason
            FROM design_point_considerations c LEFT JOIN users u ON u.id = c.considered_by
            WHERE c.workpaper_id = %s AND c.ended_at IS NULL
            ORDER BY c.considered_at, c.id
            """
            + (" FOR UPDATE OF c" if lock else ""),
            (workpaper_id,),
        ).fetchall()
        return {
            str(row[0]): ConsideredBody(
                id=UUID(str(row[1])),
                by=PersonBody(id=UUID(str(row[2])), name=str(row[3] or "")),
                at=row[4],
                reason=str(row[5]),
            )
            for row in rows
        }

    return _tolerant(connection, read, {})


# The assumptions that are points to settle before the preparer signs (B1l point 6), read
# from their state, not from the moment of an acceptance (after the review of B1k, 16 November
# 2026: before, only one accepted with its attribute was a point, so one recorded after the
# attribute was accepted, a "Review again" on an accepted control among them, held nothing):
# one accepted with its attribute and not confirmed since; one still open that names an
# attribute whose criteria are accepted (or a person's), or names none on an accepted set;
# and every open conflict.
_POINT_ASSUMPTIONS_SQL = """
    SELECT s.id, s.assumed, s.attribute_codes, s.status, s.kind
    FROM attribute_assumptions s
    WHERE s.engagement_control_id = %(c)s
      AND (s.status = 'ACCEPTED_WITH_ATTRIBUTE'
           OR (s.status = 'OPEN'
               AND (s.kind = 'CONFLICT'
                    OR EXISTS (SELECT 1 FROM control_attributes a
                               WHERE a.engagement_control_id = s.engagement_control_id
                                 AND a.status = 'APPROVED' AND a.code IS NOT NULL
                                 AND s.attribute_codes ? a.code
                                 AND (a.criteria_accepted_at IS NOT NULL
                                      OR a.criteria_origin = 'PERSON'))
                    OR (s.attribute_codes = '[]'::jsonb
                        AND EXISTS (SELECT 1 FROM control_attributes a
                                    WHERE a.engagement_control_id = %(c)s
                                      AND a.status = 'APPROVED')
                        AND NOT EXISTS (SELECT 1 FROM control_attributes a
                                        WHERE a.engagement_control_id = %(c)s
                                          AND a.status = 'PROPOSED')
                        AND NOT EXISTS (SELECT 1 FROM control_attributes a
                                        WHERE a.engagement_control_id = %(c)s
                                          AND a.status = 'APPROVED'
                                          AND a.criteria_accepted_at IS NULL
                                          AND a.criteria_origin IS DISTINCT FROM 'PERSON')))))
    ORDER BY s.created_at, s.id
"""


def accepted_assumptions(
    connection: psycopg.Connection[Any], control_id: UUID
) -> list[AssumedRecord]:
    """The control's assumptions that are points to settle (_POINT_ASSUMPTIONS_SQL), oldest
    first. Nothing when migration 0173 is not applied."""

    def read() -> list[AssumedRecord]:
        return [
            AssumedRecord(
                id=UUID(str(row[0])),
                assumed=str(row[1]),
                codes=tuple(str(code) for code in (row[2] or []) if isinstance(code, str)),
                status=row[3],
                kind=row[4],
            )
            for row in connection.execute(_POINT_ASSUMPTIONS_SQL, {"c": control_id}).fetchall()
        ]

    return _tolerant(connection, read, [])


def points_now(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    workpaper_id: UUID | None,
) -> list[PointBody]:
    """The control's points as the design workpaper's view assembles them now, from the
    same records and by the same rules, with the considerations that stand. Read in the
    caller's transaction (a preparation, a sign-off, a consideration). Nothing for a
    control that is not found."""
    from ai_workforce_api import design_workpaper as view
    from ai_workforce_api import evidence_assurance as assurance

    control = assurance._control(connection, project_id, control_id)
    if control is None:
        return []
    records = view._records(connection, project_id, control_id, control)
    evidence, _more = view.evidence_index(
        records.requests, records.checks, records.annotations, records.decisions
    )
    _shown, readings = view.attributes_of(
        records.attributes, records.requests, records.checks, records.annotations, evidence,
        None, records.dispositions, records.decisions,
    )  # fmt: skip
    stand = view.annotations_standing(records.annotations, records.requests, records.checks)
    applying = view.dispositions_applying(records.dispositions, records.checks, stand)
    findings = view.load_findings(
        connection, project_id, control_id, records.order, records.file_ids
    )
    points = points_of(
        records.requests, records.checks, records.attributes, readings, findings, evidence,
        records.decisions, view.closed_by_tickmark(applying),
        accepted_assumptions(connection, control_id),
        attributes_coded(connection, control_id, records.attributes),
    )  # fmt: skip
    return with_considerations(points, considerations_standing(connection, workpaper_id))


def attributes_coded(
    connection: psycopg.Connection[Any],
    control_id: UUID,
    attributes: Sequence[AttributeRecord],
) -> list[AttributeRecord]:
    """The workpaper's attributes under their stable codes (control_attributes.code: A1, A2),
    the codes an assumption names them by; one without a stable code keeps its letter.

    18 November 2026: the D&I workpaper letters its attributes by position (A, B, C:
    evidence_assurance.attribute_letter), while an assumption records the stable codes. Matched
    by letter, no assumption ever found its attribute, so an assumption accepted with its
    attribute was never a point before the preparer signs (B1l point 6)."""
    from ai_workforce_api.design_workpaper import AttributeRecord

    rows = connection.execute(
        "SELECT id, code FROM control_attributes "
        "WHERE engagement_control_id = %s AND status = 'APPROVED' AND code IS NOT NULL",
        (control_id,),
    ).fetchall()
    stable = {UUID(str(row[0])): str(row[1]) for row in rows}
    return [
        AttributeRecord(item.id, stable.get(item.id, item.code), item.text) for item in attributes
    ]


def demo_seeding(connection: psycopg.Connection[Any], project_id: UUID, user_id: UUID) -> bool:
    """Whether this is the demo seeding its own engagement: a demo engagement and a demo
    identity, two markers the database sets only in demo initialization and never changes
    (migrations 0128 and 0130); a demo identity can never sign in, so no person's act on a
    demo engagement or any other reads as seeding."""
    row = connection.execute(
        "SELECT coalesce(p.demo AND u.demo_organization_id IS NOT NULL, false) "
        "FROM projects p, users u WHERE p.id = %s AND u.id = %s",
        (project_id, user_id),
    ).fetchone()
    return row is not None and bool(row[0])


def prepare_refusal(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    workpaper_id: UUID,
    actor: UUID,
) -> str | None:
    """Why the preparer may not sign the design workpaper on its points (after the
    refusals of section 3.7): one not settled. None for the demo seeding its own
    engagement, which is held to the rules it had."""
    if demo_seeding(connection, project_id, actor):
        return None
    return prepare_words(unsettled(points_now(connection, project_id, control_id, workpaper_id)))


def signoff_refusal(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    workpaper_id: UUID,
    actor: UUID,
) -> str | None:
    """Why the reviewer may not sign the D&I conclusion on the workpaper's points: one
    raised since the preparer signed that is not settled. None for the demo seeding."""
    if demo_seeding(connection, project_id, actor):
        return None
    return signoff_words(unsettled(points_now(connection, project_id, control_id, workpaper_id)))


# --- Writing -----------------------------------------------------------------------------


class ConsiderBody(BaseModel):
    """Considered, with reason. `workpaper_version` is the design workpaper's record version
    the page shows (as a prepare's `version`). The reason is read and bounded in code, so
    that each refusal is one plain sentence."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=4000)
    workpaper_version: int = Field(ge=1)


class WithdrawBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consideration_id: UUID
    workpaper_version: int = Field(ge=1)


class ConsideredAnswer(BaseModel):
    consideration: ConsideredBody
    workpaper_version: int


class WithdrawnAnswer(BaseModel):
    workpaper_version: int


def _state(detail: str) -> Exception:
    from ai_workforce_api.design_conclusions import DesignConclusionState

    return DesignConclusionState(detail)


def _draft_paper(
    cursor: psycopg.Cursor[Any], project_id: UUID, control_id: UUID, version: int
) -> tuple[UUID, UUID]:
    """The control's design workpaper, locked, where a point may be settled on it now: a
    draft that is not being drafted, on an open engagement, shown at its current version.
    (id, organization)."""
    from ai_workforce_api import design_conclusions
    from ai_workforce_api.engagement_close import CLOSED, closed_detail

    row = cursor.execute(
        """
        SELECT w.id, w.organization_id, w.status, w.draft_status, w.current_version, w.version,
               p.status::text
        FROM workpapers w JOIN projects p ON p.id = w.project_id
        WHERE w.project_id = %s AND w.engagement_control_id = %s AND w.stage = 'DESIGN'
        FOR UPDATE OF w
        """,
        (project_id, control_id),
    ).fetchone()
    if row is None:
        found = cursor.execute(
            "SELECT 1 FROM engagement_controls WHERE project_id = %s AND id = %s",
            (project_id, control_id),
        ).fetchone()
        if found is None:
            raise NotVisible()
        raise _state(design_conclusions.DRAFT_FIRST)
    if str(row[6]) in CLOSED:
        raise _state(closed_detail(str(row[6])))
    if str(row[2]) != "DRAFT":
        raise _state(PREPARED_ALREADY)
    if str(row[3]) != "IDLE":
        raise _state(design_conclusions.BEING_DRAFTED)
    if int(row[4]) < 1:
        raise _state(design_conclusions.DRAFT_FIRST)
    if int(row[5]) != version:
        raise _state(POINT_CHANGED)
    return UUID(str(row[0])), UUID(str(row[1]))


def _bump(cursor: psycopg.Cursor[Any], workpaper_id: UUID) -> int:
    row = cursor.execute(
        "UPDATE workpapers SET version = version + 1 WHERE id = %s RETURNING version",
        (workpaper_id,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    target_id: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'design_point_consideration', %s, %s)
        """,
        (organization_id, project_id, actor, action, target_id, Json(payload)),
    )


def clean_point_reason(raw: str) -> str:
    """The person's reason as it is kept: cleaned as text is (untrusted), 10 to 1,000
    characters. Refused (422) otherwise, as the preparer's conclusion's reason is."""
    from ai_workforce_api import design_conclusions

    reason = design_conclusions.clean_reason(raw)
    if not reason:
        raise design_conclusions.ChoiceInvalid(design_conclusions.REASON_NEEDED)
    return reason


def consider(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    key: str,
    body: ConsiderBody,
) -> ConsideredAnswer:
    """Considered, with reason: a person settles a point of the current read that is not
    settled, on the draft design workpaper shown at its current version."""
    from ai_workforce_api import design_conclusions

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_UPDATE)  # fmt: skip
    reason = clean_point_reason(body.reason)
    with transaction(connection) as cursor:
        # The workpaper row is locked first, as a preparation and a choice lock it: a
        # consideration and a preparation never pass each other.
        paper, organization = _draft_paper(cursor, project_id, control_id, body.workpaper_version)
        point = next(
            (p for p in points_now(cursor.connection, project_id, control_id, paper)
             if p.key == key),
            None,
        )  # fmt: skip
        if point is None or point.considered is not None:
            raise _state(POINT_CHANGED)
        if "CONSIDER" not in point.settle:
            raise _state(NOT_CONSIDERED)
        row = cursor.execute(
            """
            INSERT INTO design_point_considerations (
                organization_id, project_id, engagement_control_id, workpaper_id, point_key,
                point_kind, point_text, reason, considered_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, considered_at
            """,
            (organization, project_id, control_id, paper, key, point.kind,
             point.text[:POINT_TEXT_LIMIT], reason, principal.id),
        ).fetchone()  # fmt: skip
        assert row is not None
        consideration = UUID(str(row[0]))
        version = _bump(cursor, paper)
        name = cursor.execute(
            "SELECT display_name FROM users WHERE id = %s", (principal.id,)
        ).fetchone()
        _audit(cursor, organization, project_id, principal.id, consideration, CONSIDERED,
               {"control_id": str(control_id), "workpaper_id": str(paper),
                "consideration_id": str(consideration), "point_key": key,
                "point_kind": point.kind, "workpaper_version": version,
                "reason": reason[:AUDIT_REASON]})  # fmt: skip
    return ConsideredAnswer(
        consideration=ConsideredBody(
            id=consideration,
            by=PersonBody(id=principal.id, name="" if name is None else str(name[0] or "")),
            at=row[1],
            reason=reason,
        ),
        workpaper_version=version,
    )


def withdraw(
    connection: psycopg.Connection[Any],
    principal: Principal,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    key: str,
    body: WithdrawBody,
) -> WithdrawnAnswer:
    """A consideration that stands for a point of the current read is withdrawn (ended
    WITHDRAWN, kept), by the same rules: the point is then not settled again."""
    from ai_workforce_api import design_conclusions

    design_conclusions._person(connection, principal, organization_id, project_id,
                               Action.TASK_UPDATE)  # fmt: skip
    with transaction(connection) as cursor:
        paper, organization = _draft_paper(cursor, project_id, control_id, body.workpaper_version)
        standing = considerations_standing(cursor.connection, paper, lock=True)
        mine = standing.get(key)
        point = next(
            (p for p in points_now(cursor.connection, project_id, control_id, paper)
             if p.key == key),
            None,
        )  # fmt: skip
        if mine is None or mine.id != body.consideration_id or point is None:
            raise _state(POINT_CHANGED)
        cursor.execute(
            """
            UPDATE design_point_considerations
            SET ended_at = clock_timestamp(), ended_by = %s, ended_as = 'WITHDRAWN'
            WHERE id = %s AND ended_at IS NULL
            """,
            (principal.id, mine.id),
        )
        version = _bump(cursor, paper)
        _audit(cursor, organization, project_id, principal.id, mine.id, WITHDRAWN,
               {"control_id": str(control_id), "workpaper_id": str(paper),
                "consideration_id": str(mine.id), "point_key": key, "point_kind": point.kind,
                "workpaper_version": version})  # fmt: skip
    return WithdrawnAnswer(workpaper_version=version)


def register_design_points(
    app: FastAPI,
    base: str,
    run: Callable[[Request, Callable[[psycopg.Connection[Any], Principal], Any]], Any],
) -> None:
    """The routes of section 3.9, under the D&I conclusion's base, answered by its `run`
    (which maps each refusal to its status)."""

    @app.post(f"{base}/{{control_id}}/points/{{key}}/consider", response_model=ConsideredAnswer)
    def considered(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ConsiderBody,
        request: Request, key: str = Path(pattern=KEY_PATTERN),
    ) -> Any:  # fmt: skip
        return run(
            request,
            lambda c, p: consider(c, p, organization_id, project_id, control_id, key, body),
        )

    @app.post(f"{base}/{{control_id}}/points/{{key}}/withdraw", response_model=WithdrawnAnswer)
    def withdrawn(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: WithdrawBody,
        request: Request, key: str = Path(pattern=KEY_PATTERN),
    ) -> Any:  # fmt: skip
        return run(
            request,
            lambda c, p: withdraw(c, p, organization_id, project_id, control_id, key, body),
        )


__all__ = [
    "AssumedRecord",
    "ConsideredBody",
    "ObservationBody",
    "PlaceBody",
    "PointBody",
    "accepted_assumptions",
    "attributes_coded",
    "assumption_points",
    "considerations_standing",
    "consider",
    "observations_of",
    "point_key",
    "points_now",
    "points_of",
    "prepare_refusal",
    "prepare_words",
    "register_design_points",
    "signoff_refusal",
    "signoff_words",
    "unsettled",
    "withdraw",
    "with_considerations",
]
