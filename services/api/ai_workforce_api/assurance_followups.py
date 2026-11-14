"""Which follow-ups and considerations of an evidence check stand
(docs/evidence-assurance.md, section 10.5, items 5 and 6; the stored shape is 10.7).

When the files do not show something an approved attribute needs, a senior auditor asks
for exactly the missing fact, once, and stops asking when it is shown. Each of the two
readings proposes follow-up requests and considerations (observations no attribute asks
about). A reading proposes; this module decides, in code:

- a follow-up stands only for an element that is still open after the comparison, on an
  attribute the request asks for. One asked for an element that is shown, for an attribute
  or element that is not there, with nothing to ask, or with a secret in it is dropped and
  counted;
- an element that waits on a file not read gets none: the file is the next step;
- an element a record shows is not met takes a clarification, never a request for more
  evidence;
- the two readings' asks for one element are one follow-up, an open element neither asked
  about gets one written here from the element's own words, and asks with the same request
  are one follow-up covering several elements;
- at most six are shown, by priority; the rest are counted;
- a consideration stands with a passage, the two readings' merged, at most five. It is an
  observation: never a finding, an attribute or a requirement.

Text from a reading is untrusted data. It is cleaned to one bounded line and never
interpreted. Nothing here reads a database, calls a model or sends anything: a follow-up
is text for a person, who sends it through the existing request steps after approval.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.inbound import clean_line

FollowUpKind = Literal["EVIDENCE", "CLARIFICATION"]
Priority = Literal["HIGH", "MEDIUM", "LOW"]
ElementState = Literal[
    "NOT_SHOWN", "PARTLY", "CANNOT_TELL", "DISAGREE", "DEVIATION", "WAITING_FILE"
]  # fmt: skip

MISSING_LIMIT = 300
WHY_LIMIT = 300
REQUEST_LIMIT = 500
ALTERNATIVES_LIMIT = 300
CONSIDERATION_LIMIT = 300
MAX_FOLLOW_UPS = 6
MAX_CONSIDERATIONS = 5

ASSESSOR = "ASSESSOR"
REVIEWER = "REVIEWER"
CODE = "CODE"

# Longer than any text a reading may give: a text is checked whole for a secret before it
# is cut to its limit, so a secret past the cut still drops it.
_WHOLE = 100_000
_CODE_LIMIT = 20
_ELEMENT_LIMIT = 1000
# What clean_line puts in place of a secret it recognises.
_REDACTED = "[redacted]"
_NOT_WORD = re.compile(r"[\W_]+")
_RANK: dict[str, int] = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
# The states code asks about as a question to the organization, not as a record to provide.
_CLARIFIED: frozenset[str] = frozenset({"CANNOT_TELL", "DISAGREE", "DEVIATION"})


@dataclass(frozen=True)
class Ask:
    """A follow-up one reading proposes, as that reading wrote it."""

    # The attribute's code, such as "C".
    attribute: str
    # The element's key: "condition", "pass" or "wording".
    element: str
    # The fact that is missing.
    missing: str
    # Why it matters to the test.
    why: str
    # The specific record or clarification to ask for.
    request: str
    # An acceptable alternative.
    alternatives: str = ""
    kind: FollowUpKind = "EVIDENCE"
    priority: Priority = "MEDIUM"
    may_be_in_files: bool = False


@dataclass(frozen=True)
class OpenElement:
    """An element still open after the comparison, on an attribute the request asks for."""

    attribute_id: UUID
    code: str
    element: str
    # The element's own words.
    text: str
    state: ElementState
    # What the readings named as absent.
    absent: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.attribute_id}:{self.element}"


@dataclass(frozen=True)
class FollowUp:
    """One request to make, for one element or for several that the same request answers."""

    # "<attribute id>:<element>" of its first element.
    key: str
    attribute_ids: tuple[UUID, ...]
    codes: tuple[str, ...]
    # Parallel to attribute_ids and codes.
    elements: tuple[str, ...]
    missing: str
    why: str
    request: str
    alternatives: str
    kind: FollowUpKind
    priority: Priority
    # Of "ASSESSOR" and "REVIEWER", or ("CODE",) when neither reading asked.
    raised_by: tuple[str, ...]
    status: Literal["OPEN"] = "OPEN"
    # Every "<attribute id>:<element>" it covers.
    keys: tuple[str, ...] = ()

    def as_json(self) -> dict[str, Any]:
        """The stored shape of docs/evidence-assurance.md, section 10.7, with `keys`."""
        return {
            "key": self.key,
            "attribute_ids": [str(attribute_id) for attribute_id in self.attribute_ids],
            "codes": list(self.codes),
            "elements": list(self.elements),
            "missing": self.missing,
            "why": self.why,
            "request": self.request,
            "alternatives": self.alternatives,
            "kind": self.kind,
            "priority": self.priority,
            "raised_by": list(self.raised_by),
            "status": self.status,
            "keys": list(self.keys) or [self.key],
        }


@dataclass(frozen=True)
class FollowUps:
    """What stands of the two readings' asks."""

    shown: tuple[FollowUp, ...]
    # Open follow-ups beyond the limit.
    more: int
    # Asks dropped because their element is shown, unknown, not asked for, or unusable.
    dropped: int


def _normal(text: str) -> str:
    """The text with case, whitespace and punctuation taken out of the comparison."""
    return _NOT_WORD.sub(" ", text.casefold()).strip()


def _line(raw: str, limit: int) -> str | None:
    """One bounded line of a reading's text, or None when the text holds a secret.

    clean_line redacts a token it recognises, after which the line no longer reads as a
    secret. The text as given is checked as well, and a redaction counts: an ask or a
    remark that carried a secret is dropped whole, not shown with a hole in it."""
    whole = clean_line(raw, _WHOLE)
    if contains_secret({"given": raw, "cleaned": whole}):
        return None
    if whole.count(_REDACTED) > raw.count(_REDACTED):
        return None
    return whole[:limit].strip()


def _bare(text: str) -> str:
    """An element's words on one line, without the full stop a sentence built around
    them adds."""
    return clean_line(text, _ELEMENT_LIMIT).rstrip(" .")


def _around(before: str, words: str, after: str, limit: int = REQUEST_LIMIT) -> str:
    """A sentence around an element's words that keeps its own ending within the limit.

    Cutting the finished sentence would lose the full stop and the instruction after it,
    so the element's words are shortened instead, at a word."""
    room = max(limit - len(before) - len(after), 0)
    if len(words) > room:
        words = words[:room].rsplit(" ", 1)[0].rstrip(" .")
    return f"{before}{words}{after}"


@dataclass(frozen=True)
class _Wording:
    """A follow-up's text for one element, cleaned and bounded."""

    missing: str
    why: str
    request: str
    alternatives: str
    kind: FollowUpKind
    priority: Priority


@dataclass(frozen=True)
class _Item:
    """The one follow-up of one open element, before identical requests are grouped."""

    element: OpenElement
    wording: _Wording
    raised_by: tuple[str, ...]


def _place(code: str, element: str) -> tuple[str, str]:
    return clean_line(code, _CODE_LIMIT).upper(), clean_line(element, _CODE_LIMIT).lower()


def _usable(ask: Ask) -> _Wording | None:
    """The ask cleaned, or None when it asks for nothing or holds a secret."""
    missing = _line(ask.missing, MISSING_LIMIT)
    why = _line(ask.why, WHY_LIMIT)
    request = _line(ask.request, REQUEST_LIMIT)
    alternatives = _line(ask.alternatives, ALTERNATIVES_LIMIT)
    if missing is None or why is None or request is None or alternatives is None:
        return None
    if not _normal(request):
        return None
    return _Wording(
        missing=missing,
        why=why,
        request=request,
        alternatives=alternatives,
        # A value outside the schema is read as the default, never passed on.
        kind="CLARIFICATION" if ask.kind == "CLARIFICATION" else "EVIDENCE",
        priority=ask.priority if ask.priority in _RANK else "MEDIUM",
    )


def _absent(element: OpenElement) -> str:
    """The first thing the readings named as absent, where it can be shown. A reading
    wrote it, so one with a secret in it is passed over."""
    for entry in element.absent:
        line = _line(entry, MISSING_LIMIT)
        if line:
            return line
    return ""


def _written(element: OpenElement) -> _Wording:
    """The follow-up code writes for an open element, from the element's own words and
    what is absent: what neither reading asked for is still asked for, once."""
    code = clean_line(element.code, _CODE_LIMIT)
    words = _bare(element.text) or f"attribute {code}"
    absent = _absent(element)
    why = f"The request asks for attribute {code}, and the files do not show this part of it."
    if element.state == "DEVIATION":
        # The files do show this part: they show it is not met. The reason says so.
        why = f"The request asks for attribute {code}, and a record shows this part is not met."
        request = _around(
            "The records show this is not met: ",
            words,
            ". Explain it, or provide the record that corrects it.",
        )
    elif element.state == "PARTLY":
        rest = absent.rstrip(" .") or words
        request = _around("Provide the record that shows the rest: ", rest, ".")
    elif element.state == "CANNOT_TELL":
        request = _around(
            "The files could not be read or related for: ",
            words,
            ". Provide a clearer copy or the record itself.",
        )
    elif element.state == "DISAGREE":
        request = _around(
            "The two readings read the files differently on: ",
            words,
            ". Confirm which record shows it.",
        )
    else:
        request = _around("Provide the record that shows: ", words, ".")
    return _Wording(
        missing=(absent or clean_line(element.text, MISSING_LIMIT) or words)[:MISSING_LIMIT],
        why=clean_line(why, WHY_LIMIT),
        request=clean_line(request, REQUEST_LIMIT),
        alternatives="",
        kind="CLARIFICATION" if element.state in _CLARIFIED else "EVIDENCE",
        priority="HIGH" if element.state == "DEVIATION" else "MEDIUM",
    )


def _settled(element: OpenElement, one: _Wording | None, two: _Wording | None) -> _Item:
    """The one follow-up of an open element: the first reading's wording where it asked,
    else the second's, else code's; the higher priority; evidence if either asks for
    evidence, except that a deviation takes only a clarification."""
    written = _written(element)
    asked = [wording for wording in (one, two) if wording is not None]
    if not asked:
        return _Item(element, written, (CODE,))
    lead = asked[0]
    clarification = element.state == "DEVIATION" or all(
        wording.kind == "CLARIFICATION" for wording in asked
    )
    return _Item(
        element,
        _Wording(
            # A reading that gave only the request is completed from the element.
            missing=lead.missing or written.missing,
            why=lead.why or written.why,
            request=lead.request,
            alternatives=lead.alternatives,
            kind="CLARIFICATION" if clarification else "EVIDENCE",
            priority=min((wording.priority for wording in asked), key=lambda p: _RANK[p]),
        ),
        tuple(name for name, wording in ((ASSESSOR, one), (REVIEWER, two)) if wording is not None),
    )


def _grouped(items: Sequence[_Item]) -> FollowUp:
    """One follow-up for the elements the same request answers, in their order."""
    lead = items[0]
    readings = {name for item in items for name in item.raised_by}
    return FollowUp(
        key=lead.element.key,
        attribute_ids=tuple(item.element.attribute_id for item in items),
        codes=tuple(clean_line(item.element.code, _CODE_LIMIT) for item in items),
        elements=tuple(item.element.element for item in items),
        missing=lead.wording.missing,
        why=lead.wording.why,
        request=lead.wording.request,
        alternatives=next(
            (item.wording.alternatives for item in items if item.wording.alternatives), ""
        ),
        kind=(
            "CLARIFICATION"
            if all(item.wording.kind == "CLARIFICATION" for item in items)
            else "EVIDENCE"
        ),
        priority=min((item.wording.priority for item in items), key=lambda p: _RANK[p]),
        raised_by=tuple(name for name in (ASSESSOR, REVIEWER) if name in readings) or (CODE,),
        keys=tuple(item.element.key for item in items),
    )


def reconcile_follow_ups(
    first: Sequence[Ask],
    second: Sequence[Ask],
    open_elements: Sequence[OpenElement],
    *,
    limit: int = MAX_FOLLOW_UPS,
) -> FollowUps:
    """Decide which follow-ups stand: the minimum that the open elements need.

    An ask is kept only for an element in `open_elements`; with none open, nothing is
    asked whatever the readings proposed. The asks for one element become one follow-up,
    an open element nobody asked about gets one written from its own words, an element
    waiting on a file gets none, and a deviation is asked about as a clarification.
    Follow-ups with the same request are one. They are ordered by priority, then in the
    order of `open_elements`; at most `limit` are shown and the rest counted."""
    elements: dict[tuple[str, str], OpenElement] = {}
    for element in open_elements:
        elements.setdefault(_place(element.code, element.element), element)

    dropped = 0
    asked: tuple[dict[tuple[str, str], _Wording], dict[tuple[str, str], _Wording]] = ({}, {})
    for asks, kept in zip((first, second), asked, strict=True):
        for ask in asks:
            place = _place(ask.attribute, ask.element)
            found = elements.get(place)
            if found is None:
                # Shown already, not asked for by this request, or not an element at all.
                dropped += 1
                continue
            if found.state == "WAITING_FILE":
                # Not unneeded, only early: the unread file is the next step.
                continue
            wording = _usable(ask)
            if wording is None:
                dropped += 1
                continue
            # A reading that asks twice for one element is heard once.
            kept.setdefault(place, wording)

    # A request that reports a deviation is grouped only with others that do: it is never
    # folded into a request for evidence, and never hides one.
    groups: dict[tuple[str, bool], list[_Item]] = {}
    for place, element in elements.items():
        if element.state == "WAITING_FILE":
            continue
        item = _settled(element, asked[0].get(place), asked[1].get(place))
        same = (_normal(item.wording.request), element.state == "DEVIATION")
        groups.setdefault(same, []).append(item)

    # The sort is stable, so equal priorities stay in the order of `open_elements`.
    ordered = sorted(
        (_grouped(items) for items in groups.values()), key=lambda found: _RANK[found.priority]
    )
    shown = ordered[: max(limit, 0)]
    return FollowUps(shown=tuple(shown), more=len(ordered) - len(shown), dropped=dropped)


def _covered(follow_up: Mapping[str, Any], key: str) -> list[str]:
    keys = follow_up.get("keys")
    listed = [item for item in keys if isinstance(item, str)] if isinstance(keys, list) else []
    return list(dict.fromkeys([key, *listed]))


def resolved_since(
    previous: Sequence[Mapping[str, Any]],
    open_keys: Collection[str],
    supported_keys: Collection[str],
) -> list[dict[str, Any]]:
    """The previous run's follow-ups that the new evidence resolved, in their order.

    A follow-up is resolved when every element it covers is now supported and none is
    open. One whose element is still open is not resolved however many files arrived, and
    one whose element is neither open nor supported (the attribute left the test) is not
    listed: nothing shows it was answered."""
    resolved: list[dict[str, Any]] = []
    seen: set[str] = set()
    for follow_up in previous:
        if not isinstance(follow_up, Mapping):
            continue
        key = follow_up.get("key")
        if not isinstance(key, str) or key == "" or key in seen:
            continue
        covered = _covered(follow_up, key)
        if any(item in open_keys for item in covered):
            continue
        if not all(item in supported_keys for item in covered):
            continue
        seen.add(key)
        codes = follow_up.get("codes")
        resolved.append(
            {
                "key": key,
                "request": clean_line(str(follow_up.get("request") or ""), REQUEST_LIMIT),
                "codes": [
                    clean_line(code, _CODE_LIMIT)
                    for code in (codes if isinstance(codes, list) else [])
                    if isinstance(code, str)
                ],
            }
        )
    return resolved


@dataclass(frozen=True)
class Remark:
    """A consideration one reading raised, its quote already verified by the caller."""

    text: str
    # Each {"quote", "file_id", "location"}, with "start" and "end" where it was placed.
    passages: tuple[Mapping[str, Any], ...]
    raised_by: tuple[str, ...]

    def as_json(self) -> dict[str, Any]:
        """The stored shape of docs/evidence-assurance.md, section 10.7."""
        return {
            "text": self.text,
            "passages": [
                {
                    "quote": str(passage.get("quote") or ""),
                    "file_id": str(passage.get("file_id") or ""),
                    "location": _location(passage),
                }
                for passage in self.passages
            ],
            "raised_by": list(self.raised_by),
        }


def _location(passage: Mapping[str, Any]) -> dict[str, Any]:
    location = passage.get("location")
    return dict(location) if isinstance(location, Mapping) else {}


def _file(passage: Mapping[str, Any]) -> str:
    return str(passage.get("file_id") or "").lower()


def _span(passage: Mapping[str, Any]) -> tuple[int, int] | None:
    start, end = passage.get("start"), passage.get("end")
    if type(start) is int and type(end) is int:
        return start, end
    return None


def _same_place(one: Mapping[str, Any], two: Mapping[str, Any]) -> bool:
    """Whether two passages of one file overlap: by where they sit when both were placed,
    else by the same quote."""
    if _file(one) != _file(two):
        return False
    here, there = _span(one), _span(two)
    if here is not None and there is not None:
        return here[0] < there[1] and there[0] < here[1]
    quote = _normal(str(one.get("quote") or ""))
    return quote != "" and quote == _normal(str(two.get("quote") or ""))


def _repeats(one: Mapping[str, Any], two: Mapping[str, Any]) -> bool:
    """Whether two passages are the same passage, so that only one is kept."""
    if _file(one) != _file(two):
        return False
    here, there = _span(one), _span(two)
    if here is not None and there is not None:
        return here == there
    return _normal(str(one.get("quote") or "")) == _normal(str(two.get("quote") or ""))


@dataclass
class _Consideration:
    """One consideration while the readings' remarks are merged into it."""

    text: str
    texts: set[str]
    passages: list[Mapping[str, Any]]
    raised_by: list[str]
    readings: set[int] = field(default_factory=set)

    def same_as(self, other: _Consideration) -> bool:
        return bool(self.texts & other.texts) or any(
            _same_place(mine, theirs) for mine in self.passages for theirs in other.passages
        )

    def take(self, other: _Consideration) -> None:
        """Merge a later remark in: the first wording stays."""
        self.texts |= other.texts
        self.readings |= other.readings
        for passage in other.passages:
            if not any(_repeats(passage, kept) for kept in self.passages):
                self.passages.append(passage)
        for name in other.raised_by:
            if name not in self.raised_by:
                self.raised_by.append(name)


def _consideration(remark: Remark, reading: int) -> _Consideration | None:
    """The remark cleaned, or None when it says nothing, rests on no passage or holds a
    secret."""
    text = _line(remark.text, CONSIDERATION_LIMIT)
    passages = [
        passage
        for passage in remark.passages
        if isinstance(passage, Mapping)
        and str(passage.get("quote") or "").strip()
        and _file(passage)
    ]
    if not text or not _normal(text) or not passages:
        return None
    distinct: list[Mapping[str, Any]] = []
    for passage in passages:
        if not any(_repeats(passage, kept) for kept in distinct):
            distinct.append(passage)
    names = [name for name in dict.fromkeys(remark.raised_by) if name]
    return _Consideration(
        text=text,
        texts={_normal(text)},
        passages=distinct,
        raised_by=names or [(ASSESSOR, REVIEWER)[reading]],
        readings={reading},
    )


def reconcile_considerations(
    first: Sequence[Remark], second: Sequence[Remark], *, limit: int = MAX_CONSIDERATIONS
) -> tuple[Remark, ...]:
    """Merge the two readings' considerations, at most `limit`.

    A remark is kept only with text and a passage. Two remarks are one consideration when
    a passage of one overlaps a passage of the other in the same file, or when they say
    the same thing: the first wording, the passages of both, raised by both. The ones
    both readings raised come first, then the first reading's, then the second's."""
    merged: list[_Consideration] = []
    for reading, remarks in enumerate((first, second)):
        for remark in remarks:
            found = _consideration(remark, reading)
            if found is None:
                continue
            same = [kept for kept in merged if kept.same_as(found)]
            if not same:
                merged.append(found)
                continue
            # A remark that matches two earlier ones shows they were one consideration.
            into = same[0]
            for other in (*same[1:], found):
                into.take(other)
            merged = [kept for kept in merged if all(kept is not other for other in same[1:])]

    def rank(found: _Consideration) -> int:
        return 0 if len(found.readings) == 2 else 1 + min(found.readings)

    order = {ASSESSOR: 0, REVIEWER: 1}
    return tuple(
        Remark(
            text=found.text,
            passages=tuple(found.passages),
            raised_by=tuple(sorted(found.raised_by, key=lambda name: order.get(name, 2))),
        )
        for found in sorted(merged, key=rank)[: max(limit, 0)]
    )
