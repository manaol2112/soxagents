"""Evidence annotations (docs/evidence-annotations.md; migration 0161).

An annotation says, on a file of a D&I request, which passage is the basis for an
attribute, in one sentence, and is reviewed by a person: confirmed, edited, removed, or
added by them. The file is never changed: an annotation is a layer over it.

1. Positions (section 3). For an image file, the words the local OCR engine reads with
   their boxes (`make_word_boxes`, stored once in evidence_word_boxes). Only ever the
   local engine: the image never leaves the machine, whatever the firm's OCR choice for
   reading, and no model is called. `rects_for` finds a quote's words on a page and gives
   one box per line as fractions of the page; `words_under` reads the words under a box.
2. Proposals (section 2). `propose` writes, in code and from a finished engine 2 check
   alone, what the two checked answers give an annotation for: a passage of an element
   both readings find met (SHOWS), a record of a deviation (EXCEPTION), a fact both
   readings state alike (IDENTIFIES) and the words that show where a file comes from
   (SOURCE). No model call is made for it. The proposals are kept with the run's review
   (`with_proposals`), so a run that copies an earlier one of the same basis proposes the
   same; `record_proposals` writes them in the transaction that saves the run, adds only
   passages not annotated yet, and marks the agent's unreviewed proposals the run no
   longer cites SUPERSEDED. What a person confirmed, edited, added or removed is never
   changed by a run (the guard of migration 0161 refuses it as well).
3. The API (section 5): the list of one file on one request, and a person's decisions,
   each an audit event with the person as its actor.

An annotation is model-derived text until a person reviews it: it is shown, never sent
anywhere, never a finding, and it decides nothing. Proposing never fails a check: what
cannot be written is left out and logged.
"""

from __future__ import annotations

import io
import json
import logging
import re
import time
import unicodedata
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any, Literal, Self, cast
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from ai_workforce_api import assurance_facts
from ai_workforce_api.assurance_facts import CheckOutcome, Fact, FactKind, compare_values
from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.engagement_close import CLOSED
from ai_workforce_api.evidence_assurance import (
    QUOTE_LIMIT,
    REVIEW_LIMIT,
    SHOWS_LIMIT,
    ChainInput,
    Opinion,
    Outcome,
    Passage,
    _control,
    _requests,
    attribute_letter,
    said_sentence,
)
from ai_workforce_api.evidence_extraction import _ocr_png_bytes, sniff
from ai_workforce_api.evidence_ocr import OcrFailed, OcrUnavailable, TesseractOcr
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings
from ai_workforce_api.storage import ObjectStore, StoreError, digest_of, open_store

logger = logging.getLogger(__name__)

Kind = Literal["SHOWS", "IDENTIFIES", "SOURCE", "EXCEPTION"]
Origin = Literal["AGENT", "PERSON"]
Status = Literal["PROPOSED", "CONFIRMED", "EDITED", "REMOVED", "SUPERSEDED"]
KINDS: tuple[Kind, ...] = ("SHOWS", "IDENTIFIES", "SOURCE", "EXCEPTION")

# At most this many are proposed for one file (section 2).
MAX_PER_FILE = 12
# What a person may bring a file's list to with annotations of their own (the preview
# reads at most this many).
MAX_LISTED = 24
LABEL_LIMIT = 60
STATEMENT_LIMIT = 400
CHECK_LIMIT = 400
MAX_RECTS = 8
MAX_ATTRIBUTES = 30
# A run's proposals are kept with its review within this many bytes of JSON, and within
# what the review itself has left of its own limit (evidence_assurance.REVIEW_LIMIT).
ANNOTATIONS_LIMIT = 60_000
# A value shown in a label or a sentence code writes.
VALUE_LIMIT = 80
# The longest a run waits for the positions of its files before it is saved.
POSITIONS_SECONDS = 60.0

STALE = "This annotation changed since the page loaded. Refresh and try again."
GONE = "This annotation is no longer in the list. Refresh and try again."
NO_WORDS = "The box covers no words of the file."
NOTHING_CHANGED = "Nothing was changed."
NOT_AN_ATTRIBUTE = "An attribute chosen is not an approved attribute of this control."
NO_SUCH_PAGE = "That page is not in the file."
TOO_MANY = "This file has the most annotations it can take. Remove one first."


class AnnotationState(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- Positions (section 3): pure ------------------------------------------------------

# One word the local engine read: its text and its box (x, y, width, height) in pixels.
Word = tuple[str, int, int, int, int]


@dataclass(frozen=True)
class PageWords:
    """The words of one page of a file, in reading order, with the page's size in the
    same pixels."""

    page: int
    width: int
    height: int
    words: tuple[Word, ...]


def _letters(text: str) -> str:
    """The letters and digits of a text, case, spacing and punctuation set aside."""
    return "".join(
        char for char in unicodedata.normalize("NFKC", text).casefold() if char.isalnum()
    )


def occurrence(text: str, start: int, quote: str) -> int:
    """Which occurrence of a quote's words in a text the one at `start` is (0 the first):
    how often its letters occur before it."""
    needle = _letters(quote)
    if not needle:
        return 0
    before = _letters(text[: max(0, start)])
    count, at = 0, before.find(needle)
    while at >= 0:
        count += 1
        at = before.find(needle, at + 1)
    return count


def _same_line(line: Sequence[Word], word: Word) -> bool:
    """Whether a word continues a line of words: it sits at the line's height and to the
    right of where the line's last word starts."""
    top = min(each[2] for each in line)
    bottom = max(each[2] + each[4] for each in line)
    middle = word[2] + word[4] / 2
    level = top <= middle <= bottom or word[2] <= (top + bottom) / 2 <= word[2] + word[4]
    return level and word[1] + word[3] > line[-1][1]


def _fraction(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 4)


def rects_for(quote: str, page: PageWords, nth: int = 0) -> list[list[float]]:
    """The boxes of the words a quote covers on a page, one per line, each [x, y, width,
    height] as fractions of the page. The quote's words are matched in order against the
    page's words with case, spacing and punctuation set aside, on their letters and
    digits run together: a word the engine split or joined differently still matches where
    the letters line up. A match that starts and ends on the page's own word boundaries is
    preferred; `nth` says which occurrence is meant where the words occur more than once
    (the first when there is no such occurrence). [] when the quote is not on the page."""
    needle = _letters(quote)
    if len(needle) < 2 or page.width <= 0 or page.height <= 0:
        return []
    owner: list[int] = []
    parts: list[str] = []
    starts: set[int] = set()
    ends: set[int] = set()
    for index, word in enumerate(page.words):
        own = _letters(word[0])
        if not own:
            continue
        starts.add(len(owner))
        owner.extend([index] * len(own))
        parts.append(own)
        ends.add(len(owner))
    hay = "".join(parts)
    found: list[int] = []
    at = hay.find(needle)
    while at >= 0:
        found.append(at)
        at = hay.find(needle, at + 1)
    aligned = [at for at in found if at in starts and at + len(needle) in ends]
    places = aligned or found
    if not places:
        return []
    place = places[nth] if 0 <= nth < len(places) else places[0]
    lines: list[list[Word]] = []
    for index in dict.fromkeys(owner[place : place + len(needle)]):
        word = page.words[index]
        if lines and _same_line(lines[-1], word):
            lines[-1].append(word)
        else:
            lines.append([word])
    rects: list[list[float]] = []
    for line in lines[:MAX_RECTS]:
        left = min(word[1] for word in line)
        top = min(word[2] for word in line)
        right = max(word[1] + word[3] for word in line)
        bottom = max(word[2] + word[4] for word in line)
        x, y = _fraction(left / page.width), _fraction(top / page.height)
        rects.append(
            [
                x,
                y,
                round(min(1.0 - x, max(0.0, (right - left) / page.width)), 4),
                round(min(1.0 - y, max(0.0, (bottom - top) / page.height)), 4),
            ]
        )
    return rects


def words_under(rects: Sequence[Sequence[float]], page: PageWords) -> str:
    """The words of a page whose centre lies under one of the boxes (fractions of the
    page), in reading order, as one bounded line. "" when the boxes cover no word."""
    if page.width <= 0 or page.height <= 0:
        return ""
    covered: list[str] = []
    for text, left, top, width, height in page.words:
        x = (left + width / 2) / page.width
        y = (top + height / 2) / page.height
        if any(
            len(rect) == 4
            and rect[0] <= x <= rect[0] + rect[2]
            and rect[1] <= y <= rect[1] + rect[3]
            for rect in rects
        ):
            covered.append(text)
    return clean_line(" ".join(covered), QUOTE_LIMIT).strip()


def _rects_meet(one: Sequence[Sequence[float]], other: Sequence[Sequence[float]]) -> bool:
    """Whether two sets of boxes on one page cover the same place: some box of one shares
    more than half of the smaller box's area with a box of the other."""
    for a in one:
        for b in other:
            if len(a) != 4 or len(b) != 4:
                continue
            wide = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            high = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            smaller = min(a[2] * a[3], b[2] * b[3])
            if wide > 0 and high > 0 and smaller > 0 and wide * high > 0.5 * smaller:
                return True
    return False


# --- Proposals (section 2): pure ------------------------------------------------------

_TAIL = " ,;:-–—("
_CLAUSE = re.compile(r"[.;:,(–—]\s|\s-\s")
# An annotation's kinds in the order they are kept when a file has more than its most:
# an exception first, then what shows an attribute, then what identifies, then the source.
_PRIORITY: dict[Kind, int] = {"EXCEPTION": 0, "SHOWS": 1, "IDENTIFIES": 2, "SOURCE": 3}
SOURCE_LABEL = "Source"
SOURCE_SENTENCE = "Shows where this file comes from."
# The facts an IDENTIFIES annotation is proposed on (section 10.5, item 3 of the chain's
# contract): the fixed words of its label, the sentence code writes with the value, and
# the one it writes without it (a value that names an address, a link or a secret).
_IDENTIFIES: dict[FactKind, tuple[str, str, str]] = {
    "SUBJECT": (
        "Right person or record",
        "The record is about {value}.",
        "Names the person or record this instance is about.",
    ),
    "SYSTEM": (
        "Right system",
        "The file names {value}, the system this control is tested on.",
        "Names the system this control is tested on.",
    ),
    "TRIGGER_AT": (
        "Starts the clock",
        "The date that starts the clock: {value}.",
        "Gives the date that starts the clock.",
    ),
    "REFERENCE": (
        "Reference",
        "The record's reference is {value}.",
        "Gives the record's reference.",
    ),
}
# A system the file names that code cannot tell is the control's (the control's system is
# not known, or the two names only share a word): the label and the sentence claim less.
_SYSTEM_NAMED = ("System", "The file names the system {value}.", "Names a system.")


def _cut(text: str, limit: int) -> str:
    """One line of at most `limit` characters, cut at a word."""
    line = clean_line(text, 4000).strip()
    if len(line) <= limit:
        return line
    head = line[: limit + 1]
    kept = head[: head.rfind(" ")] if " " in head else line[:limit]
    return kept.rstrip(_TAIL)


def label_of(text: str) -> str:
    """A short name for the legend, written in code from a sentence or an element's own
    words: its first clause where that is long enough to stand, cut at a word, at most
    LABEL_LIMIT characters."""
    line = clean_line(text, STATEMENT_LIMIT).strip()
    clause = next((found for found in _CLAUSE.finditer(line) if found.start() >= 12), None)
    if clause is not None:
        line = line[: clause.start()]
    return _cut(line, LABEL_LIMIT).rstrip(" .") or "Annotation"


def _listed(codes: Sequence[str]) -> str:
    if len(codes) <= 1:
        return "".join(codes)
    return f"{', '.join(codes[:-1])} and {codes[-1]}"


@dataclass(frozen=True)
class Proposal:
    """One annotation a finished check gives, as code writes it. No model writes a word of
    it beyond the sentence a reading gave for the passage it quoted, kept only where it
    passes (evidence_assurance.said_sentence)."""

    file_id: UUID
    kind: Kind
    label: str
    statement: str
    # The file's own words, as its stored text holds them.
    quote: str
    attribute_ids: tuple[UUID, ...]
    page: int
    # Where the passage is in the file's stored text, and which occurrence of its words.
    start: int
    end: int
    nth: int = 0
    check_sentence: str = ""

    def as_json(self) -> dict[str, Any]:
        return {
            "file_id": str(self.file_id),
            "kind": self.kind,
            "label": self.label,
            "statement": self.statement,
            "quote": self.quote,
            "attribute_ids": [str(item) for item in self.attribute_ids],
            "page": self.page,
            "start": self.start,
            "end": self.end,
            "nth": self.nth,
            "check_sentence": self.check_sentence,
        }


@dataclass(frozen=True)
class _Cite:
    """One passage an element's agreed answer rests on, for one attribute."""

    kind: Kind
    passage: Passage
    attribute_id: UUID
    code: str
    element: str
    # What a reading said the passage shows, and which reading (0 the first): the first
    # reading's where both give one.
    said: str
    said_by: int = 0


def _said_of(
    opinion: Opinion, attribute_id: UUID, key: str, passage: Passage, deviation: bool
) -> str:
    """What a reading said a passage shows, where it quoted it for that element and
    answered the element as the annotation reads it: met, for a passage that shows an
    attribute; not met on that very record, for an exception. A sentence a reading wrote
    for an element it found met is never put on an exception a comparison in code showed:
    code writes that one."""
    view = opinion.view(attribute_id)
    if view is None:
        return ""
    for element in view.elements:
        if element.key != key:
            continue
        if deviation:
            quoted = element.records if element.candidate else ()
        else:
            quoted = element.passages if element.result == "MET" else ()
        for own in quoted:
            if own.file_id == passage.file_id and own.start == passage.start and own.shows:
                return own.shows
    return ""


def _cites(
    first: Opinion, second: Opinion, outcomes: Sequence[Outcome], chain: ChainInput
) -> list[_Cite]:
    """The verified passages of each element both readings find met, on an attribute the
    request asks for (SHOWS), and the record passages of each deviation (EXCEPTION), which
    stands whether or not the request asks for the attribute, as its issue does."""
    files = {file.id for file in chain.files}
    found: list[_Cite] = []
    for outcome in outcomes:
        for element in outcome.elements:
            kind: Kind
            if element.deviation:
                kind = "EXCEPTION"
            elif element.result == "MET" and outcome.expected:
                kind = "SHOWS"
            else:
                continue
            for passage in element.passages:
                if passage.file_id not in files:
                    continue
                said = [
                    _said_of(opinion, outcome.attribute_id, element.key, passage, element.deviation)
                    for opinion in (first, second)
                ]
                found.append(
                    _Cite(
                        kind, passage, outcome.attribute_id, outcome.code, element.text,
                        said[0] or said[1], 0 if said[0] else 1,
                    )
                )  # fmt: skip
    return found


def _page(passage: Passage) -> int:
    page = passage.location.get("page")
    return page if isinstance(page, int) and 1 <= page <= 10000 else 1


def _backing(
    checks: Sequence[CheckOutcome], file_id: UUID, start: int, end: int, codes: Sequence[str]
) -> str:
    """The sentence of a comparison code made that uses a fact read from the passage: one
    that failed before one that passed, and one named for the annotation's own attribute
    before another's. "" where no comparison that was made uses it."""
    own = {code.strip().upper() for code in codes}
    using = [
        check
        for check in checks
        if check.status != "NOT_RUN"
        and check.sentence
        and any(
            fact.file_id == file_id and fact.start < end and start < fact.end
            for fact in check.facts
        )
    ]
    using.sort(key=lambda check: (check.status == "PASSED", check.attribute not in own))
    return clean_line(using[0].sentence, CHECK_LIMIT) if using else ""


def _shown(
    cites: Sequence[_Cite], chain: ChainInput, checks: Sequence[CheckOutcome]
) -> list[Proposal]:
    """One proposal per distinct passage: passages of one kind in one file that overlap,
    of one attribute or of several, are one annotation naming each attribute."""
    texts = {file.id: file.text for file in chain.files}
    rank = {attribute.id: index for index, attribute in enumerate(chain.attributes)}
    groups: list[list[_Cite]] = []
    reach = 0
    ordered = sorted(
        cites,
        key=lambda c: (
            c.kind, str(c.passage.file_id), c.passage.start, rank.get(c.attribute_id, 0),
        ),
    )  # fmt: skip
    for cite in ordered:
        last = groups[-1][0] if groups else None
        if (
            last is not None
            and last.kind == cite.kind
            and last.passage.file_id == cite.passage.file_id
            and cite.passage.start < reach
        ):
            groups[-1].append(cite)
            reach = max(reach, cite.passage.end)
        else:
            groups.append([cite])
            reach = cite.passage.end
    found: list[Proposal] = []
    for group in groups:
        head = group[0]
        start = min(cite.passage.start for cite in group)
        end = max(cite.passage.end for cite in group)
        text = texts.get(head.passage.file_id, "")
        quote = clean_line(text[start:end], QUOTE_LIMIT).strip() or head.passage.quote
        members = sorted(group, key=lambda c: (rank.get(c.attribute_id, 0), c.passage.start))
        attributes = tuple(dict.fromkeys(cite.attribute_id for cite in members))
        codes = list(dict.fromkeys(cite.code for cite in members))
        told = sorted((cite for cite in members if cite.said), key=lambda c: c.said_by)
        said = told[0].said if told else ""
        if said:
            statement, label = said, label_of(said)
        elif head.kind == "SHOWS":
            statement = (
                f"Shows attribute {codes[0]}: {members[0].element}"
                if len(codes) == 1
                else f"Shows attributes {_listed(codes)}."
            )
            label = label_of(members[0].element)
        else:
            statement = (
                f"The records show attribute {codes[0]} is not met: {members[0].element}"
                if len(codes) == 1
                else f"The records show attributes {_listed(codes)} are not met."
            )
            label = label_of(f"Not met: {members[0].element}")
        found.append(
            Proposal(
                file_id=head.passage.file_id,
                kind=head.kind,
                label=label,
                statement=_cut(statement, SHOWS_LIMIT),
                quote=quote,
                attribute_ids=attributes,
                page=_page(head.passage),
                start=start,
                end=end,
                nth=occurrence(text, start, quote),
                check_sentence=_backing(checks, head.passage.file_id, start, end, codes),
            )
        )
    return found


def _identified(
    first: Opinion, second: Opinion, chain: ChainInput, checks: Sequence[CheckOutcome]
) -> list[Proposal]:
    """One proposal per kind of fact and file, from the facts both readings state alike
    (the subject, the system, the date that starts the clock, a reference), on the first
    such fact's own quote. A system the file names that is provably not the control's, and
    a subject of a file code finds is about another subject, are not proposed: they
    identify nothing as right. Its attributes are those whose comparisons use the fact."""
    context = chain.given
    names = {file.id: file.name for file in chain.files}
    texts = {file.id: file.text for file in chain.files}
    by_code = {attribute.code.strip().upper(): attribute.id for attribute in chain.attributes}
    rank = {attribute.id: index for index, attribute in enumerate(chain.attributes)}
    agreed = assurance_facts._agreed(first.facts, second.facts)
    astray = {
        file_id
        for concern in assurance_facts.concerns(
            first.facts, second.facts, system=context.system, period=context.period,
            file_names=names,
        )
        if concern.code == "DIFFERENT_SUBJECT"
        for file_id in concern.file_ids
    }  # fmt: skip
    found: list[Proposal] = []
    for file in chain.files:
        for kind, words in _IDENTIFIES.items():
            stated = sorted(
                (fact for fact in agreed if fact.file_id == file.id and fact.kind == kind),
                key=lambda fact: fact.start,
            )
            fact: Fact | None = stated[0] if stated else None
            if kind == "SUBJECT" and file.id in astray:
                fact = None
            if kind == "SYSTEM" and stated:
                matches = [
                    (each, compare_values(each.value, context.system, system=True))
                    for each in stated
                    if context.system.strip()
                ]
                right = next((each for each, match in matches if match == "SAME"), None)
                unsure = next((each for each, match in matches if match != "DIFFERENT"), None)
                if right is not None:
                    fact = right
                elif context.system.strip() and unsure is None:
                    fact = None
                else:
                    fact, words = (unsure or stated[0]), _SYSTEM_NAMED
            if fact is None:
                continue
            head, with_value, without = words
            value = said_sentence(fact.value, VALUE_LIMIT).rstrip(" .")
            using = [
                check
                for check in checks
                if any(
                    used.file_id == fact.file_id
                    and used.kind == fact.kind
                    and used.start < fact.end
                    and fact.start < used.end
                    for used in check.facts
                )
            ]
            attributes = sorted(
                {by_code[check.attribute] for check in using if check.attribute in by_code},
                key=lambda item: rank.get(item, 0),
            )
            quote = clean_line(fact.quote, QUOTE_LIMIT).strip()
            found.append(
                Proposal(
                    file_id=file.id,
                    kind="IDENTIFIES",
                    label=_cut(f"{head}: {value}", LABEL_LIMIT) if value else head,
                    statement=with_value.format(value=value) if value else without,
                    quote=quote,
                    attribute_ids=tuple(attributes),
                    page=_page_at(texts.get(file.id, ""), fact.start),
                    start=fact.start,
                    end=fact.end,
                    nth=occurrence(texts.get(file.id, ""), fact.start, quote),
                    check_sentence=_backing(
                        checks, fact.file_id, fact.start, fact.end,
                        [check.attribute for check in using],
                    ),
                )
            )  # fmt: skip
    return found


def _page_at(text: str, start: int) -> int:
    """The page a place of a file's stored text is on, from the reader's own markers."""
    from ai_workforce_api.evidence_mapping import locate

    page = locate(text, start, start).get("page") if text else None
    return page if isinstance(page, int) and 1 <= page <= 10000 else 1


def _sourced(first: Opinion, second: Opinion, chain: ChainInput) -> list[Proposal]:
    """One proposal per file whose own words a reading quotes for where it comes from: the
    first reading's where both give one."""
    found: list[Proposal] = []
    for file in chain.files:
        passage = next(
            (
                source
                for opinion in (first, second)
                for source in opinion.sources
                if source.file_id == file.id
            ),
            None,
        )
        if passage is None:
            continue
        found.append(
            Proposal(
                file_id=file.id,
                kind="SOURCE",
                label=SOURCE_LABEL,
                statement=SOURCE_SENTENCE,
                quote=passage.quote,
                attribute_ids=(),
                page=_page(passage),
                start=passage.start,
                end=passage.end,
                nth=occurrence(file.text, passage.start, passage.quote),
            )
        )
    return found


def propose(
    first: Opinion,
    second: Opinion,
    outcomes: Sequence[Outcome],
    chain: ChainInput,
    checks: Sequence[CheckOutcome],
) -> tuple[Proposal, ...]:
    """The annotations a finished check gives (section 2), from the two checked answers,
    the outcomes as code lets them stand and the comparisons code made. Pure: no model, no
    database, and nothing here changes a result.

    SHOWS: one per distinct verified passage of an element both readings find met, on an
    attribute the request asks for. EXCEPTION: the same for a deviation's record passages.
    IDENTIFIES: the subject, the system, the date that starts the clock and a reference,
    from the facts both readings state alike, one per kind and file. SOURCE: the words a
    reading quotes for where the file comes from, one per file. The sentence is what the
    reading said the passage shows, where it gave one that passes, and otherwise written
    here from the element or the fact; the label is always written here. At most
    MAX_PER_FILE per file (an exception before what shows an attribute, before what
    identifies, before the source), in reading order: the files as the readings were given
    them, then the page, then the place in the file's text."""
    order = {file.id: index for index, file in enumerate(chain.files)}
    found = [
        *_shown(_cites(first, second, outcomes, chain), chain, checks),
        *_identified(first, second, chain, checks),
        *_sourced(first, second, chain),
    ]
    kept: list[Proposal] = []
    for file in chain.files:
        mine = [proposal for proposal in found if proposal.file_id == file.id]
        mine.sort(key=lambda p: (_PRIORITY[p.kind], p.page, p.start))
        kept.extend(mine[:MAX_PER_FILE])
    kept.sort(key=lambda p: (order[p.file_id], p.page, p.start, _PRIORITY[p.kind]))
    return tuple(kept)


def with_proposals(review: Mapping[str, Any], proposals: Sequence[Proposal]) -> dict[str, Any]:
    """A run's review with the proposals made from it, as the run keeps them (so a run
    that copies it proposes the same, with no model call and nothing read again). They
    take what the review has left of its own limit, and never more than ANNOTATIONS_LIMIT:
    what does not fit is not proposed."""
    used = len(json.dumps(dict(review), ensure_ascii=False).encode("utf-8"))
    room = min(ANNOTATIONS_LIMIT, REVIEW_LIMIT - used - 32)
    kept: list[dict[str, Any]] = []
    for proposal in proposals:
        item = proposal.as_json()
        room -= len(json.dumps(item, ensure_ascii=False).encode("utf-8")) + 2
        if room < 0:
            break
        kept.append(item)
    return {**review, "annotations": kept}


class _Stored(BaseModel):
    """One proposal as a run's review keeps it (Proposal.as_json)."""

    file_id: UUID
    kind: Kind
    label: str = Field(min_length=1, max_length=LABEL_LIMIT)
    statement: str = Field(min_length=1, max_length=STATEMENT_LIMIT)
    quote: str = Field(default="", max_length=QUOTE_LIMIT)
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=MAX_ATTRIBUTES)
    page: int = Field(default=1, ge=1, le=10000)
    start: int = Field(default=0, ge=0, le=2_000_000_000)
    end: int = Field(default=0, ge=0, le=2_000_000_000)
    nth: int = Field(default=0, ge=0)
    check_sentence: str = Field(default="", max_length=CHECK_LIMIT)


def stored_proposals(review: Mapping[str, Any] | None) -> list[Proposal] | None:
    """The proposals a run's review keeps, each held to its shape (one that is not is left
    out). None for a review that keeps none: a run of the first engine, or one recorded
    before annotations were proposed, which proposes and supersedes nothing."""
    given = review.get("annotations") if isinstance(review, Mapping) else None
    if not isinstance(given, list):
        return None
    found: list[Proposal] = []
    for item in given:
        try:
            read = _Stored.model_validate(item)
        except ValidationError:
            continue
        if not read.label.strip() or not read.statement.strip():
            continue
        found.append(
            Proposal(
                file_id=read.file_id,
                kind=read.kind,
                label=read.label,
                statement=read.statement,
                quote=read.quote,
                attribute_ids=tuple(read.attribute_ids),
                page=read.page,
                start=read.start,
                end=max(read.end, read.start),
                nth=read.nth,
                check_sentence=read.check_sentence,
            )
        )
    return found


# --- Positions: the records -----------------------------------------------------------

StoreFactory = Callable[[Settings, psycopg.Connection[Any]], ObjectStore]
_IMAGE_NAME = re.compile(r"(?i)\.(png|jpe?g|gif|bmp|tiff?|webp)$")


def _page_words(row: Sequence[Any]) -> PageWords:
    words: list[Word] = []
    for item in row[3] if isinstance(row[3], list) else []:
        if (
            isinstance(item, list)
            and len(item) == 5
            and isinstance(item[0], str)
            and all(isinstance(number, int) and not isinstance(number, bool) for number in item[1:])
        ):
            words.append((item[0], item[1], item[2], item[3], item[4]))
    return PageWords(int(row[0]), int(row[1]), int(row[2]), tuple(words))


def word_boxes(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], file_ids: Sequence[UUID]
) -> dict[UUID, dict[int, PageWords]]:
    """The words on record for each file, by page; nothing for a file with none."""
    found: dict[UUID, dict[int, PageWords]] = {}
    if not file_ids:
        return found
    for row in connection.execute(
        "SELECT evidence_file_id, page, width, height, words FROM evidence_word_boxes "
        "WHERE evidence_file_id = ANY(%s) ORDER BY evidence_file_id, page",
        (list(file_ids),),
    ).fetchall():
        page = _page_words(row[1:])
        found.setdefault(UUID(str(row[0])), {})[page.page] = page
    return found


def has_positions(pages: Mapping[int, PageWords]) -> bool:
    return any(page.words for page in pages.values())


def make_word_boxes(
    connection: psycopg.Connection[Any],
    settings: Settings,
    project_id: UUID,
    file_id: UUID,
    store: StoreFactory = open_store,
) -> dict[int, PageWords]:
    """The words of an image file with their boxes, made once: those on record, or, where
    there are none, read now by the local OCR engine and recorded.

    Only ever the local engine (Tesseract's own word boxes, with the language and page
    segmentation the text reading uses): the image never leaves the machine, whatever the
    firm's OCR choice for reading, and no model is called. The bytes are read through the
    store and their digest and size compared with the custody record; a mismatch gives no
    positions. Nothing of the file's stored text or its hash is touched. Without the local
    engine, for a file that is not an image, under an engagement that is closed, or when
    anything here fails, there are no positions: {} and never an error to the person."""
    try:
        found = word_boxes(connection, [file_id]).get(file_id)
        if found:
            return found
        command = TesseractOcr.locate(settings.ocr_tesseract_path)
        if command is None:
            return {}
        stored = connection.execute(
            """
            SELECT f.organization_id, f.object_key, f.content_sha256, f.size_bytes,
                   f.content_type, f.file_name, coalesce(a.extraction, ''), p.status::text
            FROM evidence_files f
            JOIN projects p ON p.id = f.project_id
            LEFT JOIN evidence_analyses a ON a.evidence_file_id = f.id
            WHERE f.id = %s AND f.project_id = %s
            """,
            (file_id, project_id),
        ).fetchone()
        if stored is None or str(stored[7]) in CLOSED:
            return {}
        name, declared = str(stored[5]), str(stored[4])
        # Told before the bytes are fetched, so a file that is plainly no image is never
        # read for this: an image by its declared type or its name, or a file the reader
        # read by OCR that neither says is a PDF (a scanned PDF's pages are not boxed).
        pdf = "pdf" in declared.lower() or name.lower().endswith(".pdf")
        if not (
            declared.lower().startswith("image/")
            or _IMAGE_NAME.search(name)
            or (str(stored[6]) == "OCR" and not pdf)
        ):
            return {}
        content = store(settings, connection).get(str(stored[1]))
        if digest_of(content) != stored[2] or len(content) != int(stored[3]):
            return {}
        if sniff(content, name, declared) != "image":
            return {}
        page = _read_words(content, TesseractOcr(command, settings.ocr_languages))
        with transaction(connection) as cursor:
            cursor.execute(
                """
                INSERT INTO evidence_word_boxes (
                    evidence_file_id, page, organization_id, project_id, width, height, words,
                    engine
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (evidence_file_id, page) DO NOTHING
                """,
                (
                    file_id, page.page, stored[0], project_id, page.width, page.height,
                    Json([list(word) for word in page.words]),
                    f"tesseract {settings.ocr_languages}"[:80],
                ),
            )  # fmt: skip
            _place_proposed(cursor, file_id, {page.page: page})
        return {page.page: page}
    except StoreError, OcrFailed, OcrUnavailable:
        return {}
    except psycopg.Error as error:
        logger.warning(
            "word positions could not be recorded: %s %s",
            type(error).__name__,
            error.sqlstate or "",
        )
        return {}
    except Exception as error:
        # An image that cannot be opened, or anything else: no positions, never an error.
        logger.warning("word positions could not be read: %s", type(error).__name__)
        return {}


def _read_words(content: bytes, engine: TesseractOcr) -> PageWords:
    """The words of an image, each box in the image's own pixels (the image upright). The
    engine reads the picture as it is prepared for the text reading (grayscale, upright,
    scaled to a readable size), so the boxes are scaled back to the file's own size."""
    from PIL import Image, ImageOps

    prepared = _ocr_png_bytes(content)
    with Image.open(io.BytesIO(content)) as picture:
        picture.seek(0)
        upright = ImageOps.exif_transpose(picture) or picture
        width, height = upright.size
    with Image.open(io.BytesIO(prepared)) as scaled:
        read_width, read_height = scaled.size
    across, down = width / read_width, height / read_height
    read = engine.words(prepared)
    words: list[Word] = []
    for word, text in zip(read, redacted_words([word.text for word in read]), strict=True):
        if not text:
            continue
        box = (
            round(word.left * across),
            round(word.top * down),
            max(1, round(word.width * across)),
            max(1, round(word.height * down)),
        )
        words.append((text, *box))
    return PageWords(1, width, height, tuple(words))


_REDACTED = "[redacted]"


def redacted_words(words: Sequence[str]) -> list[str]:
    """The words as they may be kept: each one line of plain text, and a secret's value
    replaced as the file's stored text replaces it ("password: ..." and a key token,
    inbound.clean_line), read with the two words before it so a value that follows its
    label is caught. "" for a word with nothing left to keep."""
    kept: list[str] = []
    for index, word in enumerate(words):
        own = clean_line(word, 60).strip()
        told = clean_line(" ".join(words[max(0, index - 2) : index + 1]), 4000).strip()
        if told.endswith(_REDACTED) and not word.strip().endswith(_REDACTED):
            own = _REDACTED
        kept.append(own)
    return kept


def _place_proposed(
    cursor: psycopg.Cursor[Any], file_id: UUID, pages: Mapping[int, PageWords]
) -> None:
    """The agent's proposals of a file that were written before the file had positions get
    their boxes now. Only what nobody reviewed, and only where it has none."""
    for annotation_id, quote, page in cursor.execute(
        "SELECT id, quote, page FROM evidence_annotations WHERE evidence_file_id = %s "
        "AND origin = 'AGENT' AND status = 'PROPOSED' AND rects = '[]'::jsonb",
        (file_id,),
    ).fetchall():
        words = pages.get(int(page))
        rects = [] if words is None else rects_for(str(quote), words)
        if rects:
            cursor.execute(
                "UPDATE evidence_annotations SET rects = %s WHERE id = %s AND status = 'PROPOSED'",
                (Json(rects), annotation_id),
            )


def prepare_positions(
    connection: psycopg.Connection[Any],
    settings: Settings,
    project_id: UUID,
    proposals: Sequence[Proposal],
    seconds: float = POSITIONS_SECONDS,
) -> None:
    """The positions of each file a run is about to propose annotations on, made before
    the transaction that saves the run opens (reading an image takes seconds, and nothing
    is held while it does). Never fails the run, and never keeps it long: the files not
    reached within `seconds` get their positions when their annotations are first asked
    for."""
    until = time.monotonic() + seconds
    for file_id in dict.fromkeys(proposal.file_id for proposal in proposals):
        if time.monotonic() >= until:
            break
        make_word_boxes(connection, settings, project_id, file_id)


# --- Proposals: the records -----------------------------------------------------------


def _audit(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID | None,
    agent_instance: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, actor_agent_instance_id, action,
            target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            organization_id, project_id, actor, agent_instance, action, target_type, target_id,
            Json(payload),
        ),
    )  # fmt: skip


@dataclass(frozen=True)
class _Known:
    """An annotation on record, as a run reads it to tell what is annotated already."""

    id: UUID
    file_id: UUID
    kind: str
    label: str
    quote: str
    position: int
    page: int
    rects: list[list[float]]
    origin: str
    status: str


def _head(label: str) -> str:
    return label.split(":", 1)[0].strip().casefold()


def _same_place(known: _Known, proposal: Proposal, rects: Sequence[Sequence[float]]) -> bool:
    """Whether a proposal is the passage an annotation on record already annotates: the
    same file and kind (and, for what identifies, the same kind of fact where both are the
    agent's), and the passages overlap in the file's text, or one's words hold the
    other's, or their boxes cover the same place on the page."""
    if known.file_id != proposal.file_id or known.kind != proposal.kind:
        return False
    if (
        proposal.kind == "IDENTIFIES"
        and known.origin == "AGENT"
        and _head(known.label) != _head(proposal.label)
    ):
        return False
    if (
        known.origin == "AGENT"
        and known.position < max(proposal.end, proposal.start + 1)
        and proposal.start < known.position + max(1, len(known.quote))
    ):
        return True
    mine, theirs = _letters(known.quote), _letters(proposal.quote)
    if mine and theirs and (mine in theirs or theirs in mine):
        return True
    return known.page == proposal.page and _rects_meet(known.rects, rects)


def _rects_of(value: Any) -> list[list[float]]:
    found: list[list[float]] = []
    for item in value if isinstance(value, list) else []:
        if (
            isinstance(item, list)
            and len(item) == 4
            and all(isinstance(n, (int, float)) and not isinstance(n, bool) for n in item)
        ):
            found.append([float(n) for n in item])
    return found[:MAX_RECTS]


def record_proposals(
    cursor: psycopg.Cursor[Any],
    *,
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    run_id: UUID,
    review: Mapping[str, Any] | None,
    agent_instance: UUID | None = None,
) -> int:
    """Write a reviewed run's proposals, in the transaction that records the run, and
    return how many were added. Idempotent: a passage annotated already (by an earlier
    run, or by a person) is not proposed again, so the same run recorded twice adds
    nothing. The agent's proposals nobody reviewed that this run no longer cites are
    marked SUPERSEDED; what a person confirmed, edited, added or removed is never touched.
    One audit event per file where something was proposed or superseded, with no person
    as its actor.

    It runs in a savepoint of its own and never fails the run it is called for: a run's
    readings are paid for, and an annotation decides nothing."""
    proposals = stored_proposals(review)
    if proposals is None:
        return 0
    try:
        with cursor.connection.transaction():
            return _write_proposals(
                cursor, organization_id, project_id, control_id, requirement_id, run_id,
                proposals, agent_instance,
            )  # fmt: skip
    except psycopg.Error as error:
        logger.warning(
            "evidence annotations could not be proposed: %s %s",
            type(error).__name__,
            error.sqlstate or "",
        )
        return 0


def _write_proposals(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    run_id: UUID,
    proposals: Sequence[Proposal],
    agent_instance: UUID | None,
) -> int:
    known = [
        _Known(
            id=UUID(str(row[0])),
            file_id=UUID(str(row[1])),
            kind=str(row[2]),
            label=str(row[3]),
            quote=str(row[4]),
            position=int(row[5]),
            page=int(row[6]),
            rects=_rects_of(row[7]),
            origin=str(row[8]),
            status=str(row[9]),
        )
        for row in cursor.execute(
            """
            SELECT id, evidence_file_id, kind, label, quote, position, page, rects, origin, status
            FROM evidence_annotations
            WHERE requirement_id = %s AND engagement_control_id = %s AND status <> 'SUPERSEDED'
            """,
            (requirement_id, control_id),
        ).fetchall()
    ]
    pages = word_boxes(cursor, list(dict.fromkeys(p.file_id for p in proposals)))
    cited: set[UUID] = set()
    added: dict[UUID, list[UUID]] = {}
    kept: dict[UUID, int] = {}
    for proposal in proposals:
        words = pages.get(proposal.file_id, {}).get(proposal.page)
        rects = [] if words is None else rects_for(proposal.quote, words, proposal.nth)
        already = [each for each in known if _same_place(each, proposal, rects)]
        if already:
            cited.update(each.id for each in already)
            kept[proposal.file_id] = kept.get(proposal.file_id, 0) + 1
            continue
        row = cursor.execute(
            """
            INSERT INTO evidence_annotations (
                organization_id, project_id, engagement_control_id, requirement_id,
                evidence_file_id, assessment_id, kind, label, statement, agent_statement,
                quote, attribute_ids, page, rects, check_sentence, origin, status, position
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, 'AGENT',
                'PROPOSED', %s
            )
            RETURNING id
            """,
            (
                organization_id, project_id, control_id, requirement_id, proposal.file_id,
                run_id, proposal.kind, proposal.label, proposal.statement, proposal.statement,
                proposal.quote, list(proposal.attribute_ids), proposal.page, Json(rects),
                proposal.check_sentence, proposal.start,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        new = UUID(str(row[0]))
        cited.add(new)
        added.setdefault(proposal.file_id, []).append(new)
        known.append(
            _Known(
                new, proposal.file_id, proposal.kind, proposal.label, proposal.quote,
                proposal.start, proposal.page, rects, "AGENT", "PROPOSED",
            )
        )  # fmt: skip
    superseded: dict[UUID, list[UUID]] = {}
    for annotation_id, file_id in cursor.execute(
        """
        UPDATE evidence_annotations
        SET status = 'SUPERSEDED', version = version + 1
        WHERE requirement_id = %s AND engagement_control_id = %s AND origin = 'AGENT'
          AND status = 'PROPOSED' AND NOT (id = ANY(%s::uuid[]))
        RETURNING id, evidence_file_id
        """,
        (requirement_id, control_id, list(cited)),
    ).fetchall():
        superseded.setdefault(UUID(str(file_id)), []).append(UUID(str(annotation_id)))
    for file_id in dict.fromkeys([*added, *superseded]):
        _audit(
            cursor, organization_id, project_id, None, agent_instance,
            "evidence_annotations.proposed", "evidence_file", file_id,
            {
                "run_id": str(run_id),
                "requirement_id": str(requirement_id),
                "control_id": str(control_id),
                "proposed": [str(item) for item in added.get(file_id, [])],
                "superseded": [str(item) for item in superseded.get(file_id, [])],
                "kept": kept.get(file_id, 0),
            },
        )  # fmt: skip
    return sum(len(items) for items in added.values())


# --- The API (section 5) --------------------------------------------------------------


class PageBody(BaseModel):
    page: int
    width: int
    height: int


class AttributeRow(BaseModel):
    id: UUID
    code: str
    text: str
    annotation_ids: list[UUID]


class AnnotationBody(BaseModel):
    id: UUID
    # The place in the list, from 1.
    number: int
    kind: Kind
    label: str
    statement: str
    agent_statement: str
    quote: str
    attribute_ids: list[UUID]
    codes: list[str]
    page: int
    rects: list[list[float]]
    check_sentence: str
    origin: Origin
    status: Status
    version: int
    decided_by_name: str | None
    decided_at: datetime | None


class AnnotationsBody(BaseModel):
    file_id: UUID
    requirement_id: UUID
    positions: bool
    pages: list[PageBody]
    attributes: list[AttributeRow]
    annotations: list[AnnotationBody]
    reviewed: int
    total: int
    can_edit: bool


_Share = Annotated[float, Field(ge=0, le=1)]
_Rect = Annotated[list[_Share], Field(min_length=4, max_length=4)]


def _bounded(rects: list[list[float]]) -> list[list[float]]:
    """Boxes held to the page: each within it, and none without a width or a height."""
    found: list[list[float]] = []
    for x, y, width, height in rects:
        wide, high = min(width, 1.0 - x), min(height, 1.0 - y)
        if wide <= 0 or high <= 0:
            raise ValueError("a box has no width or no height on the page")
        found.append([round(x, 4), round(y, 4), round(wide, 4), round(high, 4)])
    return found


def _sentence(value: str) -> str:
    cleaned = clean_line(value, STATEMENT_LIMIT).strip()
    if not cleaned:
        raise ValueError("the sentence is empty")
    return cleaned


def _distinct_ids(value: list[UUID]) -> list[UUID]:
    return list(dict.fromkeys(value))


class VersionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


class ConfirmAllBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement_id: UUID
    file_id: UUID


class EditBody(BaseModel):
    """A person's change to an annotation: at least one of its sentence, the attributes it
    supports, and where it is."""

    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)
    statement: str | None = Field(default=None, min_length=1, max_length=STATEMENT_LIMIT)
    attribute_ids: list[UUID] | None = Field(default=None, max_length=MAX_ATTRIBUTES)
    rects: list[_Rect] | None = Field(default=None, max_length=MAX_RECTS)
    page: int | None = Field(default=None, ge=1, le=10000)

    @field_validator("statement")
    @classmethod
    def _one_line(cls, value: str | None) -> str | None:
        return None if value is None else _sentence(value)

    @field_validator("rects")
    @classmethod
    def _on_the_page(cls, value: list[list[float]] | None) -> list[list[float]] | None:
        return None if value is None else _bounded(value)

    @field_validator("attribute_ids")
    @classmethod
    def _each_once(cls, value: list[UUID] | None) -> list[UUID] | None:
        return None if value is None else _distinct_ids(value)

    @model_validator(mode="after")
    def _changes_something(self) -> Self:
        if (
            self.statement is None
            and self.attribute_ids is None
            and self.rects is None
            and self.page is None
        ):
            raise ValueError("an edit changes the sentence, the attributes or the box")
        return self


class AddBody(BaseModel):
    """A person's own annotation."""

    model_config = ConfigDict(extra="forbid")

    requirement_id: UUID
    file_id: UUID
    page: int = Field(ge=1, le=10000)
    rects: list[_Rect] = Field(max_length=MAX_RECTS)
    statement: str = Field(min_length=1, max_length=STATEMENT_LIMIT)
    attribute_ids: list[UUID] = Field(default_factory=list, max_length=MAX_ATTRIBUTES)
    kind: Kind

    @field_validator("statement")
    @classmethod
    def _one_line(cls, value: str) -> str:
        return _sentence(value)

    @field_validator("rects")
    @classmethod
    def _on_the_page(cls, value: list[list[float]]) -> list[list[float]]:
        return _bounded(value)

    @field_validator("attribute_ids")
    @classmethod
    def _each_once(cls, value: list[UUID]) -> list[UUID]:
        return _distinct_ids(value)


@dataclass(frozen=True)
class _Scope:
    """A file in force on a D&I request of a control, in one engagement."""

    organization_id: UUID
    project_id: UUID
    control_id: UUID
    requirement_id: UUID
    file_id: UUID


def _scope(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    requirement_id: UUID,
    file_id: UUID,
) -> _Scope:
    """The file as a file in force on that request of that control in that engagement
    (never a withdrawn file, never another control's request); not found otherwise."""
    control = _control(connection, project_id, control_id)
    if control is None:
        raise NotVisible()
    request = next(
        (
            item
            for item in _requests(connection, project_id, control_id)
            if item.requirement_id == requirement_id
        ),
        None,
    )
    if request is None or all(file.file_id != file_id for file in request.files):
        raise NotVisible()
    return _Scope(control.organization_id, project_id, control_id, requirement_id, file_id)


def _attributes(
    connection: psycopg.Connection[Any], control_id: UUID
) -> list[tuple[UUID, str, str]]:
    """The control's approved attributes in the order the D&I list letters them: each id,
    letter and wording (evidence_assurance._approved, without the criteria)."""
    rows = connection.execute(
        """
        SELECT id, text FROM control_attributes
        WHERE engagement_control_id = %s AND status = 'APPROVED'
        ORDER BY position, created_at
        """,
        (control_id,),
    ).fetchall()
    return [
        (UUID(str(row[0])), attribute_letter(index), str(row[1])) for index, row in enumerate(rows)
    ]


def _editable(connection: psycopg.Connection[Any], principal: Principal, scope: _Scope) -> bool:
    """Whether the caller may decide annotations here: a person who may decide evidence
    (TASK_UPDATE), on an engagement that is not completed or archived."""
    if principal.kind is not PrincipalKind.USER:
        return False
    status = connection.execute(
        "SELECT status::text FROM projects WHERE id = %s", (scope.project_id,)
    ).fetchone()
    if status is None or str(status[0]) in CLOSED:
        return False
    return permits(
        connection, principal=principal, action=Action.TASK_UPDATE,
        organization_id=scope.organization_id, project_id=scope.project_id,
    )  # fmt: skip


def _order(row: Sequence[Any]) -> tuple[Any, ...]:
    """Reading order: the page, then top to bottom (and left to right) where the
    annotation has boxes, then, for what has none, its place in the file's text."""
    rects = _rects_of(row[8])
    top = min((rect[1] for rect in rects), default=0.0)
    left = min((rect[0] for rect in rects if rect[1] == top), default=0.0)
    return (int(row[7]), 0 if rects else 1, top, left, int(row[15]), row[16], str(row[0]))


def read_annotations(
    connection: psycopg.Connection[Any],
    settings: Settings,
    principal: Principal,
    scope: _Scope,
) -> AnnotationsBody:
    """The list of one file on one request, as the preview shows it. REMOVED and
    SUPERSEDED annotations are not listed. The file's positions are made here where it has
    none yet (once; an image, the local engine, an engagement that is open)."""
    can_edit = _editable(connection, principal, scope)
    pages = make_word_boxes(connection, settings, scope.project_id, scope.file_id)
    attributes = _attributes(connection, scope.control_id)
    letters = {attribute[0]: attribute[1] for attribute in attributes}
    rows = connection.execute(
        """
        SELECT a.id, a.kind, a.label, a.statement, a.agent_statement, a.quote, a.attribute_ids,
               a.page, a.rects, a.check_sentence, a.origin, a.status, a.version,
               u.display_name, a.decided_at, a.position, a.created_at
        FROM evidence_annotations a
        LEFT JOIN users u ON u.id = a.decided_by
        WHERE a.requirement_id = %s AND a.evidence_file_id = %s
          AND a.engagement_control_id = %s AND a.project_id = %s
          AND a.status NOT IN ('REMOVED', 'SUPERSEDED')
        """,
        (scope.requirement_id, scope.file_id, scope.control_id, scope.project_id),
    ).fetchall()
    listed: list[AnnotationBody] = []
    for number, row in enumerate(sorted(rows, key=_order), start=1):
        bears = [UUID(str(item)) for item in (row[6] or [])]
        listed.append(
            AnnotationBody(
                id=UUID(str(row[0])),
                number=number,
                kind=cast(Kind, str(row[1])),
                label=str(row[2]),
                statement=str(row[3]),
                agent_statement=str(row[4]),
                quote=str(row[5]),
                attribute_ids=bears,
                codes=[letters[a[0]] for a in attributes if a[0] in bears],
                page=int(row[7]),
                rects=_rects_of(row[8]),
                check_sentence=str(row[9]),
                origin=cast(Origin, str(row[10])),
                status=cast(Status, str(row[11])),
                version=int(row[12]),
                decided_by_name=None if row[13] is None else str(row[13]),
                decided_at=row[14],
            )
        )
    return AnnotationsBody(
        file_id=scope.file_id,
        requirement_id=scope.requirement_id,
        positions=has_positions(pages),
        pages=[
            PageBody(page=page.page, width=page.width, height=page.height)
            for page in pages.values()
        ],
        attributes=[
            AttributeRow(
                id=attribute[0],
                code=attribute[1],
                text=attribute[2],
                annotation_ids=[item.id for item in listed if attribute[0] in item.attribute_ids],
            )
            for attribute in attributes
        ],
        annotations=listed,
        reviewed=sum(1 for item in listed if item.status in ("CONFIRMED", "EDITED")),
        total=len(listed),
        can_edit=can_edit,
    )


@dataclass(frozen=True)
class _Row:
    id: UUID
    requirement_id: UUID
    file_id: UUID
    kind: Kind
    label: str
    statement: str
    quote: str
    attribute_ids: list[UUID]
    page: int
    rects: list[list[float]]
    origin: str
    status: str
    version: int


def _found(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, annotation_id: UUID
) -> tuple[UUID, UUID]:
    """The request and the file an annotation of this control is on; not found otherwise."""
    row = connection.execute(
        "SELECT requirement_id, evidence_file_id FROM evidence_annotations "
        "WHERE id = %s AND project_id = %s AND engagement_control_id = %s",
        (annotation_id, project_id, control_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    return UUID(str(row[0])), UUID(str(row[1]))


def _locked(cursor: psycopg.Cursor[Any], scope: _Scope, annotation_id: UUID, version: int) -> _Row:
    """The annotation, locked for a person's decision, at the version the person saw and
    still in the list."""
    row = cursor.execute(
        """
        SELECT id, requirement_id, evidence_file_id, kind, label, statement, quote,
               attribute_ids, page, rects, origin, status, version
        FROM evidence_annotations
        WHERE id = %s AND project_id = %s AND engagement_control_id = %s
          AND requirement_id = %s AND evidence_file_id = %s
        FOR UPDATE
        """,
        (annotation_id, scope.project_id, scope.control_id, scope.requirement_id, scope.file_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    found = _Row(
        id=UUID(str(row[0])),
        requirement_id=UUID(str(row[1])),
        file_id=UUID(str(row[2])),
        kind=cast(Kind, str(row[3])),
        label=str(row[4]),
        statement=str(row[5]),
        quote=str(row[6]),
        attribute_ids=[UUID(str(item)) for item in (row[7] or [])],
        page=int(row[8]),
        rects=_rects_of(row[9]),
        origin=str(row[10]),
        status=str(row[11]),
        version=int(row[12]),
    )
    if found.version != version:
        raise AnnotationState(STALE)
    if found.status in ("REMOVED", "SUPERSEDED"):
        raise AnnotationState(GONE)
    return found


def _event(
    cursor: psycopg.Cursor[Any], scope: _Scope, person: UUID, action: str, row_id: UUID,
    payload: dict[str, Any],
) -> None:  # fmt: skip
    _audit(
        cursor, scope.organization_id, scope.project_id, person, None, action,
        "evidence_annotation", row_id,
        {
            "control_id": str(scope.control_id),
            "requirement_id": str(scope.requirement_id),
            "file_id": str(scope.file_id),
            **payload,
        },
    )  # fmt: skip


def confirm(
    cursor: psycopg.Cursor[Any], scope: _Scope, annotation_id: UUID, version: int, person: UUID
) -> None:
    """A person confirms a proposed annotation. One already reviewed stays as it is."""
    row = _locked(cursor, scope, annotation_id, version)
    if row.status != "PROPOSED":
        return
    cursor.execute(
        "UPDATE evidence_annotations SET status = 'CONFIRMED', decided_by = %s, "
        "decided_at = clock_timestamp(), version = version + 1 WHERE id = %s",
        (person, row.id),
    )
    _event(
        cursor, scope, person, "evidence_annotation.confirmed", row.id,
        {"kind": row.kind, "origin": row.origin, "version": row.version + 1},
    )  # fmt: skip


def confirm_all(cursor: psycopg.Cursor[Any], scope: _Scope, person: UUID) -> int:
    """A person confirms every proposed annotation of the file, as one decision."""
    confirmed = [
        UUID(str(row[0]))
        for row in cursor.execute(
            """
            UPDATE evidence_annotations
            SET status = 'CONFIRMED', decided_by = %s, decided_at = clock_timestamp(),
                version = version + 1
            WHERE requirement_id = %s AND evidence_file_id = %s
              AND engagement_control_id = %s AND project_id = %s AND status = 'PROPOSED'
            RETURNING id
            """,
            (person, scope.requirement_id, scope.file_id, scope.control_id, scope.project_id),
        ).fetchall()
    ]
    if confirmed:
        _audit(
            cursor, scope.organization_id, scope.project_id, person, None,
            "evidence_annotations.confirmed", "evidence_file", scope.file_id,
            {
                "control_id": str(scope.control_id),
                "requirement_id": str(scope.requirement_id),
                "annotation_ids": [str(item) for item in confirmed],
                "count": len(confirmed),
            },
        )  # fmt: skip
    return len(confirmed)


def _chosen(
    connection: psycopg.Connection[Any], scope: _Scope, attribute_ids: Sequence[UUID]
) -> list[UUID]:
    """The attributes a person chose, as approved attributes of the control and in the
    order the control letters them; refused when one is not."""
    approved = [attribute[0] for attribute in _attributes(connection, scope.control_id)]
    if any(item not in approved for item in attribute_ids):
        raise AnnotationState(NOT_AN_ATTRIBUTE)
    return [item for item in approved if item in attribute_ids]


def _person_label(kind: Kind, statement: str) -> str:
    return SOURCE_LABEL if kind == "SOURCE" else label_of(statement)


def edit(
    cursor: psycopg.Cursor[Any], scope: _Scope, annotation_id: UUID, body: EditBody, person: UUID
) -> None:
    """A person changes an annotation's sentence, its attributes, or where it is. The
    agent's own sentence is kept beside the person's. A box that moves on a file with
    positions takes the words under it as its quote, and is refused where it covers none."""
    row = _locked(cursor, scope, annotation_id, body.version)
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    label = row.label
    if body.statement is not None and body.statement != row.statement:
        before["statement"], after["statement"] = row.statement, body.statement
        if row.kind in ("SHOWS", "EXCEPTION") or row.origin == "PERSON":
            label = _person_label(row.kind, body.statement)
    if body.attribute_ids is not None:
        chosen = _chosen(cursor.connection, scope, body.attribute_ids)
        if chosen != row.attribute_ids:
            before["attribute_ids"] = [str(item) for item in row.attribute_ids]
            after["attribute_ids"] = [str(item) for item in chosen]
    page = row.page if body.page is None else body.page
    rects = row.rects if body.rects is None else body.rects
    quote = row.quote
    if page != row.page or rects != row.rects:
        pages = word_boxes(cursor, [scope.file_id]).get(scope.file_id, {})
        if has_positions(pages):
            words = pages.get(page)
            if words is None:
                raise AnnotationState(NO_SUCH_PAGE)
            if rects:
                quote = words_under(rects, words)
                if not quote:
                    raise AnnotationState(NO_WORDS)
        before.update({"page": row.page, "rects": row.rects, "quote": row.quote})
        after.update({"page": page, "rects": rects, "quote": quote})
    if not after:
        raise AnnotationState(NOTHING_CHANGED)
    cursor.execute(
        """
        UPDATE evidence_annotations
        SET status = 'EDITED', label = %s, statement = %s, attribute_ids = %s::uuid[],
            page = %s, rects = %s, quote = %s, decided_by = %s,
            decided_at = clock_timestamp(), version = version + 1
        WHERE id = %s
        """,
        (
            label,
            after.get("statement", row.statement),
            [UUID(item) for item in after["attribute_ids"]]
            if "attribute_ids" in after
            else row.attribute_ids,
            page,
            Json(rects),
            quote,
            person,
            row.id,
        ),
    )
    _event(
        cursor, scope, person, "evidence_annotation.edited", row.id,
        {"kind": row.kind, "origin": row.origin, "version": row.version + 1,
         "status_before": row.status, "before": before, "after": after},
    )  # fmt: skip


def remove(
    cursor: psycopg.Cursor[Any], scope: _Scope, annotation_id: UUID, version: int, person: UUID
) -> None:
    """A person removes an annotation from the list. It stays on record."""
    row = _locked(cursor, scope, annotation_id, version)
    cursor.execute(
        "UPDATE evidence_annotations SET status = 'REMOVED', decided_by = %s, "
        "decided_at = clock_timestamp(), version = version + 1 WHERE id = %s",
        (person, row.id),
    )
    _event(
        cursor, scope, person, "evidence_annotation.removed", row.id,
        {"kind": row.kind, "origin": row.origin, "version": row.version + 1,
         "status_before": row.status},
    )  # fmt: skip


def add(cursor: psycopg.Cursor[Any], scope: _Scope, body: AddBody, person: UUID) -> UUID:
    """A person's own annotation: theirs from the start, so it is confirmed as written."""
    listed = cursor.execute(
        "SELECT count(*) FROM evidence_annotations WHERE requirement_id = %s "
        "AND evidence_file_id = %s AND status NOT IN ('REMOVED', 'SUPERSEDED')",
        (scope.requirement_id, scope.file_id),
    ).fetchone()
    if listed is not None and int(listed[0]) >= MAX_LISTED:
        raise AnnotationState(TOO_MANY)
    chosen = _chosen(cursor.connection, scope, body.attribute_ids)
    pages = word_boxes(cursor, [scope.file_id]).get(scope.file_id, {})
    quote = ""
    if has_positions(pages):
        words = pages.get(body.page)
        if words is None:
            raise AnnotationState(NO_SUCH_PAGE)
        quote = words_under(body.rects, words)
    row = cursor.execute(
        """
        INSERT INTO evidence_annotations (
            organization_id, project_id, engagement_control_id, requirement_id,
            evidence_file_id, kind, label, statement, quote, attribute_ids, page, rects,
            origin, status, created_by, decided_by, decided_at
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, 'PERSON', 'CONFIRMED',
            %s, %s, clock_timestamp()
        )
        RETURNING id
        """,
        (
            scope.organization_id, scope.project_id, scope.control_id, scope.requirement_id,
            scope.file_id, body.kind, _person_label(body.kind, body.statement), body.statement,
            quote, chosen, body.page, Json(body.rects), person, person,
        ),
    ).fetchone()  # fmt: skip
    assert row is not None
    new = UUID(str(row[0]))
    _event(
        cursor, scope, person, "evidence_annotation.added", new,
        {"kind": body.kind, "origin": "PERSON", "statement": body.statement,
         "attribute_ids": [str(item) for item in chosen], "page": body.page,
         "rects": body.rects},
    )  # fmt: skip
    return new


def register_evidence_annotations(app: FastAPI, settings: Settings) -> None:
    base = (
        "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
        "/evidence-annotations"
    )

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except AnnotationState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def person(
        connection: psycopg.Connection[Any], principal: Principal, organization_id: UUID,
        project_id: UUID,
    ) -> UUID:  # fmt: skip
        """Who decides: a person who may decide evidence in this engagement."""
        authorize(connection, principal=principal, action=Action.TASK_UPDATE,
                  organization_id=organization_id, project_id=project_id)  # fmt: skip
        if principal.kind is not PrincipalKind.USER:
            raise NotVisible()
        return principal.id

    @app.get(base, response_model=AnnotationsBody)
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, requirement_id: UUID,
        file_id: UUID, request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> AnnotationsBody:
            authorize(connection, principal=principal, action=Action.PROJECT_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            scope = _scope(connection, project_id, control_id, requirement_id, file_id)
            return read_annotations(connection, settings, principal, scope)

        return run(request, work)

    @app.post(f"{base}/confirm-all", response_model=AnnotationsBody)
    def confirm_every(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: ConfirmAllBody,
        request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> AnnotationsBody:
            who = person(connection, principal, organization_id, project_id)
            scope = _scope(connection, project_id, control_id, body.requirement_id, body.file_id)
            with transaction(connection) as cursor:
                confirm_all(cursor, scope, who)
            return read_annotations(connection, settings, principal, scope)

        return run(request, work)

    def decide(
        request: Request, organization_id: UUID, project_id: UUID, control_id: UUID,
        annotation_id: UUID,
        change: Callable[[psycopg.Cursor[Any], _Scope, UUID], None],
    ) -> AnnotationsBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> AnnotationsBody:
            who = person(connection, principal, organization_id, project_id)
            requirement_id, file_id = _found(connection, project_id, control_id, annotation_id)
            scope = _scope(connection, project_id, control_id, requirement_id, file_id)
            with transaction(connection) as cursor:
                change(cursor, scope, who)
            return read_annotations(connection, settings, principal, scope)

        return run(request, work)

    @app.post(f"{base}/{{annotation_id}}/confirm", response_model=AnnotationsBody)
    def confirm_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, annotation_id: UUID,
        body: VersionBody, request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        return decide(
            request, organization_id, project_id, control_id, annotation_id,
            lambda cursor, scope, who: confirm(cursor, scope, annotation_id, body.version, who),
        )  # fmt: skip

    @app.post(f"{base}/{{annotation_id}}/edit", response_model=AnnotationsBody)
    def edit_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, annotation_id: UUID,
        body: EditBody, request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        return decide(
            request, organization_id, project_id, control_id, annotation_id,
            lambda cursor, scope, who: edit(cursor, scope, annotation_id, body, who),
        )  # fmt: skip

    @app.post(f"{base}/{{annotation_id}}/remove", response_model=AnnotationsBody)
    def remove_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, annotation_id: UUID,
        body: VersionBody, request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        return decide(
            request, organization_id, project_id, control_id, annotation_id,
            lambda cursor, scope, who: remove(cursor, scope, annotation_id, body.version, who),
        )  # fmt: skip

    @app.post(base, response_model=AnnotationsBody)
    def add_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: AddBody,
        request: Request,
    ) -> AnnotationsBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> AnnotationsBody:
            who = person(connection, principal, organization_id, project_id)
            scope = _scope(connection, project_id, control_id, body.requirement_id, body.file_id)
            with transaction(connection) as cursor:
                add(cursor, scope, body, who)
            return read_annotations(connection, settings, principal, scope)

        return run(request, work)


__all__ = [
    "AnnotationState",
    "PageWords",
    "Proposal",
    "label_of",
    "make_word_boxes",
    "occurrence",
    "prepare_positions",
    "propose",
    "read_annotations",
    "record_proposals",
    "rects_for",
    "register_evidence_annotations",
    "stored_proposals",
    "with_proposals",
    "words_under",
]
