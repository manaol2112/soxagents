"""Deterministic checks of objective testing conditions (Milestone 3c).

The tester proposes, beside each result, the comparisons the attribute turns on: a date
on or before another, two identifiers that must match or must differ, a number within a
limit. Each side names a value and where it is: a quote copied from one of the item's
files, or the item's own row of the population (file -1). The code then decides what
stands:

- a side is verified only when its quote is found in that file (the citation check) and
  its value appears in the quote, or, for the population row, when `population_match`
  finds it: a whole cell, or a whole-token run in one unambiguous cell (M3d);
- a verified comparison is evaluated here, never by the model: dates parsed by the
  sampling module's reader, identifiers compared case-insensitively without punctuation
  and leading zeros, numbers without separators;
- a PASS that any verified comparison contradicts becomes an EXCEPTION, with the observed
  and expected conditions written from the two values; a PASS that rests on a value the
  evidence does not hold (an unverified side), or on a comparison that cannot be evaluated
  (ambiguous, or a value of the wrong kind), becomes UNABLE; a result never moves up;
- a side holds one atomic value (M3c closure). When the model gives a list, each value
  is verified on its own, and the list is compared only where the pairing is unambiguous
  (a value that must differ from each of several); otherwise the comparison is ambiguous.

It also recognises a passage of the evidence that gives instructions to an AI (an
attempted prompt injection): a pass that cites one is not kept (`instruction_guard`).

Nothing here reads a file other than the item's own, and nothing here calls a model.
"""

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.sampling import (
    SlashOrder,
    ambiguous_slashed,
    normal_value,
    parse_date,
    slash_order,
)

Kind = Literal["on_or_before", "equal", "different", "at_most"]
KINDS: tuple[Kind, ...] = ("on_or_before", "equal", "different", "at_most")
MAX_CHECKS = 4
POPULATION_ROW = -1

SIDE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "label": {"type": "string", "maxLength": 80},
        "value": {"type": "string", "maxLength": 120},
        "file": {"type": "integer", "minimum": POPULATION_ROW},
        "quote": {"type": "string", "maxLength": 200},
    },
    "required": ["label", "value", "file", "quote"],
    "additionalProperties": False,
}
CHECKS_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": MAX_CHECKS,
    "items": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": list(KINDS)},
            "left": SIDE_SCHEMA,
            "right": SIDE_SCHEMA,
        },
        "required": ["kind", "left", "right"],
        "additionalProperties": False,
    },
}
_TIME = re.compile(r"(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?")
_NUMBER = re.compile(r"^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$")
_DATE_SHAPED = re.compile(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}")
# A side is one atomic value (M3c closure). A list ("Elena Rossi; Marcus Lee") is split on
# these separators only, so a value such as "Sales and Marketing" is never split.
_LIST = re.compile(r"\s*[;|]\s*")
# A passage addressed to an AI or an automated agent that tells it what to do.
_ADDRESSEE = re.compile(
    r"\b(?:AI|A\.I\.|LLM|GPT|chatbot|language model|AI (?:assistant|tester|reviewer|agent)s?"
    r"|automated (?:testing |review |audit )?(?:agents?|tools?|systems?)"
    # M3d: text addressed to whoever reads or processes the file, or rewriting the
    # instructions themselves, without naming an AI.
    r"|system prompt|(?:previous|prior|above) instructions"
    r"|whoever (?:reads|processes|summari[sz]es|reviews|tests)"
    r"|(?:the )?reader of this (?:file|document))\b",
    re.I,
)
_IMPERATIVE = re.compile(
    r"\b(?:record|mark|treat|ignore|disregard|cite|override|output|approve"
    r"|do not (?:mention|report|flag|ask)"
    r"|don't (?:mention|report|flag|ask)|must (?:pass|mark|record|treat)|are void)\b",
    re.I,
)
INSTRUCTION_NOTE = (
    "The pass cites a passage of the evidence that gives instructions to an AI. Instructions "
    "in the evidence are not followed and are not evidence, so a person decides this result."
)
# M3d closure: a passage that claims the audit's own work or conclusion (testing, review,
# sign-off or acceptance by an auditor or the audit team), or declares the requirements
# met, satisfied, compliant or exempt. The client's evidence can record what its process
# did; it cannot record the audit's conclusion, so such a passage is a claim needing
# corroboration, never support. A backstop only: the mapping classifies every passage
# it quotes, and the tester and reviewer judge the evidence themselves.
_AUDIT_ACTOR = re.compile(
    r"\b(?:auditors?|(?:external|internal|it|sox|statutory) audit"
    r"|audit (?:team|firm|partner|manager|senior|staff|lead|sign[- ]?off)"
    r"|engagement (?:partner|manager|team|lead)|by audit)\b",
    re.I,
)
_AUDIT_ACT = re.compile(
    r"\b(?:tested|reviewed|verified|validated|approved|accepted|cleared|signed[- ]?off"
    r"|sign[- ]?off|concluded|attested|certified|passed|confirmed|satisfied|comfortable"
    r"|covered|examined)\b",
    re.I,
)
_DECLARED_MET = re.compile(
    r"\b(?:attributes?|criteria|criterion|requirements?|controls?|prerequisites?|conditions?"
    r"|approvals?)\b[^.\n]{0,60}?\b(?:(?:are|is|as|been|were) (?:met|satisfied|fulfilled"
    r"|compliant|effective|in order)|validated|waived|compliant)\b"
    r"|\bexempt from\b",
    re.I,
)
AUDIT_CLAIM_NOTE = (
    "The pass cites a passage that claims the audit's own work or conclusion, or declares "
    "the requirements met. Such a claim needs corroboration and is not evidence, so a "
    "person decides this result."
)


@dataclass(frozen=True)
class Side:
    label: str
    value: str
    file: int
    quote: str
    verified: bool
    place: str
    # The atomic values the side holds: one, or several when the model gave a list (each
    # verified on its own; see _compare for when a list can be compared at all).
    values: tuple[str, ...] = ()
    # The population row's column the value is in, when it is one column (for its date
    # order); None for a value quoted from a file.
    column: str | None = None


@dataclass(frozen=True)
class Check:
    kind: Kind
    left: Side
    right: Side
    # True or False when both sides are verified and the values could be compared; None
    # when a side is unverified or a value could not be read as the kind needs.
    holds: bool | None
    why: str

    def as_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "left": {"label": self.left.label, "value": self.left.value,
                     "verified": self.left.verified, "where": self.left.place},
            "right": {"label": self.right.label, "value": self.right.value,
                      "verified": self.right.verified, "where": self.right.place},
            "holds": self.holds,
            "why": self.why,
        }  # fmt: skip


def date_orders(details: Iterable[Iterable[tuple[str, str]]]) -> dict[str, SlashOrder]:
    """Each population column's day and month order where its values show it, and only
    then (slash_order, strict): read over every sampled row of the sheet."""
    by_column: dict[str, list[str]] = {}
    for detail in details:
        for column, value in detail:
            by_column.setdefault(column, []).append(value)
    found: dict[str, SlashOrder] = {}
    for column, values in by_column.items():
        order = slash_order(values, strict=True)
        if order is not None:
            found[column] = order
    return found


def evaluate(
    raw: Any,
    texts: list[tuple[str, str]],
    detail: tuple[tuple[str, str], ...],
    orders: dict[str, SlashOrder] | None = None,
) -> list[Check]:
    """The tester's proposed comparisons, verified and evaluated. `texts` is each item
    file's (name, stored text), by index; `detail` is the item's population row; `orders`
    the population columns' date orders (date_orders), without which an ambiguous slashed
    date is not read."""
    if not isinstance(raw, list):
        return []
    found: list[Check] = []
    for entry in raw[: MAX_CHECKS * 2]:
        if not isinstance(entry, dict) or entry.get("kind") not in KINDS:
            continue
        left = _side(entry.get("left"), texts, detail)
        right = _side(entry.get("right"), texts, detail)
        if left is None or right is None:
            continue
        holds, why = _compare(entry["kind"], left, right, orders)
        found.append(Check(entry["kind"], left, right, holds, why))
        if len(found) >= MAX_CHECKS:
            break
    return found


def apply(result: dict[str, Any], checks: list[Check]) -> dict[str, Any]:
    """The result after the rule checks: never moved up, moved down when a verified check
    contradicts a pass or a pass rests on a value the evidence does not hold."""
    updated = {**result, "checks": [check.as_json() for check in checks]}
    # A not applicable whose own comparison does not hold goes to a person, never to a
    # rule-decided exception (19 November 2026): the tester said the attribute does not
    # apply, so the values compared may be placeholders. Before, it stood unchanged.
    if result.get("result") == "NOT_APPLICABLE":
        failed_na = [check for check in checks if check.holds is False]
        if failed_na:
            return {
                **updated,
                "result": "REVIEW",
                "note": clean_line(
                    f"A rule check of the values does not hold: {failed_na[0].why} The "
                    f"tester's not applicable goes to a person. {result.get('note', '')}",
                    400,
                ),
                "decided_by_rule": True,
                "rule": "NA_CHECK",
            }
        return updated
    if result.get("result") != "PASS":
        return updated
    failed = [check for check in checks if check.holds is False]
    if failed:
        first = failed[0]
        return {
            **updated,
            "result": "EXCEPTION",
            "observed": clean_line(
                f"{first.left.label} {first.left.value} ({first.left.place}); "
                f"{first.right.label} {first.right.value} ({first.right.place}).",
                400,
            ),
            "expected": clean_line(_expected(first), 400),
            "note": clean_line(
                f"A rule check of verified values does not hold: {first.why} The tester's "
                f"pass is not kept. {result.get('note', '')}",
                400,
            ),
            "decided_by_rule": True,
        }
    unverified = [check for check in checks if not (check.left.verified and check.right.verified)]
    if unverified:
        return {
            **updated,
            "result": "UNABLE",
            "note": clean_line(
                "The pass rests on a value the evidence does not hold "
                f"({unverified[0].left.label} or {unverified[0].right.label}), so a person "
                f"decides. {result.get('note', '')}",
                400,
            ),
            "decided_by_rule": True,
        }
    # A comparison that could not be evaluated (ambiguous, or a value of the wrong kind)
    # does not support a pass: unable to determine, for a person (M3c closure).
    unresolved = [check for check in checks if check.holds is None]
    if unresolved:
        return {
            **updated,
            "result": "UNABLE",
            "note": clean_line(
                f"A comparison the pass rests on could not be evaluated: {unresolved[0].why} "
                f"A person decides. {result.get('note', '')}",
                400,
            ),
            "decided_by_rule": True,
        }
    return updated


def instructs_ai(text: str) -> bool:
    """Whether a passage addresses an AI or an automated agent with an instruction."""
    return bool(_ADDRESSEE.search(text) and _IMPERATIVE.search(text))


def claims_audit(text: str) -> bool:
    """Whether a passage claims the audit's own work or conclusion, or declares the
    requirements met (M3d closure)."""
    return bool(
        (_AUDIT_ACTOR.search(text) and _AUDIT_ACT.search(text)) or _DECLARED_MET.search(text)
    )


def untrusted_kind(text: str) -> Literal["INSTRUCTION", "AUDIT_CLAIM"] | None:
    """What makes a line of the evidence unusable as support, if anything."""
    if instructs_ai(text):
        return "INSTRUCTION"
    if claims_audit(text):
        return "AUDIT_CLAIM"
    return None


def line_of(text: str, span: tuple[int, int]) -> str:
    """The whole lines a passage sits on: a passage is judged in its own line."""
    start = text.rfind("\n", 0, span[0]) + 1
    end = text.find("\n", span[1])
    return text[start : len(text) if end < 0 else end]


def instruction_guard(results: list[dict[str, Any]], texts: dict[str, str]) -> list[dict[str, Any]]:
    """A pass (or not applicable) that cites a line of the evidence giving instructions to
    an AI, or claiming the audit's own conclusion (M3d closure), goes to a person. `texts`
    is each item file's stored text by file id."""
    guarded: list[dict[str, Any]] = []
    for result in results:
        if result.get("result") in ("PASS", "NOT_APPLICABLE"):
            kinds = {
                _cited_kind(citation, texts)
                for citation in result.get("citations", [])
                if isinstance(citation, dict)
            } - {None}
            if kinds:
                note = INSTRUCTION_NOTE if "INSTRUCTION" in kinds else AUDIT_CLAIM_NOTE
                result = {
                    **result,
                    "result": "REVIEW",
                    "note": clean_line(f"{note} {result.get('note', '')}", 400),
                    "instruction_cited": True,
                }
        guarded.append(result)
    return guarded


def _cited_kind(
    citation: dict[str, Any], texts: dict[str, str]
) -> Literal["INSTRUCTION", "AUDIT_CLAIM"] | None:
    text = texts.get(str(citation.get("file_id")), "")
    quote = str(citation.get("quote") or "")
    span = find_quote(text, quote) if text and quote.strip() else None
    return untrusted_kind(quote if span is None else line_of(text, span))


def _side(
    raw: Any, texts: list[tuple[str, str]], detail: tuple[tuple[str, str], ...]
) -> Side | None:
    if not isinstance(raw, dict):
        return None
    label = clean_line(str(raw.get("label") or ""), 80) or "value"
    value = clean_line(str(raw.get("value") or ""), 120)
    quote = str(raw.get("quote") or "")[:200]
    index = raw.get("file")
    if not value or not isinstance(index, int):
        return None
    values = tuple(part for part in _LIST.split(value) if part.strip()) or (value,)
    if index == POPULATION_ROW:
        hits = [population_match(atom, label, detail) for atom in values]
        found = all(hit is not None for hit in hits)
        where = ", ".join(str(hit) for hit in hits if hit)
        columns = {str(c) for c, _v in detail}
        named = hits[0].removesuffix(" (token)") if len(hits) == 1 and hits[0] else None
        return Side(label, value, index, quote, found,
                    f"population row, {where}" if where else "population row", values,
                    named if named in columns else None)  # fmt: skip
    if not 0 <= index < len(texts):
        return None
    name, text = texts[index]
    span = find_quote(text, quote) if quote.strip() else None
    # Every value of the side is in the quoted passage, each on its own.
    verified = span is not None and all(_contains(text[span[0] : span[1]], atom) for atom in values)
    return Side(label, value, index, quote, verified, name, values)


# Letters and digits in any script, joined by - _ . or / (item 5, 19 November 2026;
# before, a to z and 0 to 9 only, so a non-Latin value had no tokens).
_TOKEN = re.compile(r"[^\W_]+(?:[-_./][^\W_]+)*")


def population_match(value: str, label: str, detail: tuple[tuple[str, str], ...]) -> str | None:
    """Where in the item's population row a value is, or None when it cannot be verified
    (M3d). The match is deterministic and never inferred from part of a word:

    - when the side's label names a column of the row, only that column counts: the value
      is its whole cell, or a whole-token run inside it; any other value there is a
      conflict, and the side is not verified even if another cell holds the value;
    - otherwise the value is a whole cell (one or more), or a whole-token run that occurs
      once, in exactly one cell of the row (a run found in two cells, or twice in one, is
      ambiguous).

    Tokens are runs of letters and digits joined by - _ . or / (so "DEVK900512" and
    "2027-04-12" are single tokens); "PR" is not found in "SAP ERP PRD"."""
    wanted = _tokens(value)
    if not wanted:
        return None
    named = [(column, cell) for column, cell in detail if _same_label(column, label)]
    if named:
        column, cell = named[0]
        if _same_text(cell, value):
            return str(column)
        return f"{column} (token)" if _runs(_tokens(cell), wanted) == 1 else None
    # A whole cell is the value itself, so it is verified even if two cells hold it.
    exact = [str(column) for column, cell in detail if _same_text(cell, value)]
    if exact:
        return " and ".join(exact)
    counts = [(column, _runs(_tokens(cell), wanted)) for column, cell in detail]
    found = [(column, n) for column, n in counts if n]
    if len(found) == 1 and found[0][1] == 1:
        return f"{found[0][0]} (token)"
    return None


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(_squash(text))


def _runs(tokens: list[str], wanted: list[str]) -> int:
    """How many times the token run `wanted` occurs in `tokens`, on token boundaries."""
    size = len(wanted)
    return sum(1 for at in range(len(tokens) - size + 1) if tokens[at : at + size] == wanted)


def _same_label(column: str, label: str) -> bool:
    return bool(label.strip()) and _tokens(column) == _tokens(label)


def _compare(
    kind: Kind, left: Side, right: Side, orders: dict[str, SlashOrder] | None = None
) -> tuple[bool | None, str]:
    if not (left.verified and right.verified):
        return None, "A side is not in the evidence."
    if len(left.values) > 1 or len(right.values) > 1:
        # Several values: compared only where every pairing is unambiguous, that is a
        # value that must differ from each of the others; anything else is ambiguous.
        if kind != "different":
            return None, "A side holds more than one value, so the comparison is ambiguous."
        pairs = [
            (a, b, _same(a, b, left, right, orders)) for a in left.values for b in right.values
        ]
        if any(same is None for _a, _b, same in pairs):
            return None, "Two of the values cannot be told the same or different."
        clash = next(((a, b) for a, b, same in pairs if same), None)
        if clash is not None:
            return False, f"{left.label} {clash[0]} matches {right.label} {clash[1]}."
        return True, f"{left.label} {left.value} differs from each of {right.label} {right.value}."
    if kind == "on_or_before":
        a, b = (
            _moment(left.value, _order(left, orders)),
            _moment(right.value, _order(right, orders)),
        )
        if a is None or b is None:
            return None, "A value is not a date, or its day and month order is unknown."
        if (a.at.tzinfo is None) != (b.at.tzinfo is None) or (
            a.at.tzinfo is not None and a.at.utcoffset() != b.at.utcoffset()
        ):
            return None, "The two times are in different or unstated time zones."
        if a.at.date() == b.at.date() and not (a.timed and b.timed):
            return None, "Both values are on the same day and a time is not given for both."
        holds = a.at <= b.at
        return holds, (
            f"{left.label} {left.value} is {'on or before' if holds else 'after'} "
            f"{right.label} {right.value}."
        )
    if kind in ("equal", "different"):
        same = _same(left.value, right.value, left, right, orders)
        if same is None:
            return None, (
                f"{left.label} {left.value} and {right.label} {right.value} cannot be told "
                "the same or different."
            )
        holds = same if kind == "equal" else not same
        relation = "matches" if same else "does not match"
        return holds, f"{left.label} {left.value} {relation} {right.label} {right.value}."
    x, y = _number(left.value), _number(right.value)
    if x is None or y is None or x[1] != y[1]:
        return None, "A value is not a number, or the two are in different units."
    holds = x[0] <= y[0]
    relation = "within" if holds else "over"
    return holds, f"{left.label} {left.value} is {relation} {right.label} {right.value}."


def _expected(check: Check) -> str:
    return {
        "on_or_before": f"{check.left.label} on or before {check.right.label}.",
        "equal": f"{check.left.label} the same as {check.right.label}.",
        "different": f"{check.left.label} not the same as {check.right.label}.",
        "at_most": f"{check.left.label} at most {check.right.label}.",
    }[check.kind]


@dataclass(frozen=True)
class _Moment:
    at: datetime
    # Whether the value states a time; a date alone is the whole day.
    timed: bool


def _order(side: Side, orders: dict[str, SlashOrder] | None) -> SlashOrder | None:
    """The day and month order of a side's slashed date: known only for a value of the
    population row, from its own column's values (slash_order, strict); never guessed for
    a value quoted from a file (item 5, 19 November 2026)."""
    if side.file != POPULATION_ROW or not orders or side.column is None:
        return None
    return orders.get(side.column)


def _moment(value: str, order: SlashOrder | None = None) -> _Moment | None:
    """A date, and its time when the value states one (item 5 with FO-18, 19 November
    2026). An ISO value with T, Z or an offset is read whole; a time keeps its AM or PM; a
    slashed date whose day and month could be either way is unread unless its order is
    known. Before, "2027-03-15T10:00" read as 23:59, "10:00 PM" as 10:00, and 03/04/2027
    as 4 March whatever the source."""
    text = value.strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is not None:
        return _Moment(parsed, bool(re.search(r"\d[T ]\d", text)))
    head = text.split(" ")[0]
    if ambiguous_slashed(head) and order is None:
        return None
    day = parse_date(head, order or "mdy") or parse_date(text, order or "mdy")
    if day is None:
        return None
    rest = text[len(head) :]
    time = _TIME.search(rest)
    if time is None:
        return _Moment(datetime(day.year, day.month, day.day), False)
    hour, minute = int(time.group(1)), int(time.group(2))
    half = (time.group(3) or "").lower()
    if half:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if half == "pm" else 0)
    if hour > 23 or minute > 59:
        return None
    return _Moment(datetime(day.year, day.month, day.day, hour, minute), True)


def _strict(value: str) -> str:
    """A value folded for comparison, in any script (NFKC, case folded, spaces collapsed)."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _identifier(value: str) -> str:
    """A value's letters and digits only, in any script: what is left after its separators
    are dropped. Before, only a to z and 0 to 9 were kept, so two non-Latin names both read
    as "" and matched (item 5, 19 November 2026)."""
    return "".join(ch for ch in _strict(value) if ch.isalnum())


def _account_shaped(value: str) -> bool:
    """One token with a digit, a dot or an underscore in it: an account or an ID."""
    text = _strict(value)
    return " " not in text and bool(re.search(r"[\d._]", text))


def _name_shaped(value: str) -> bool:
    """Two or more words of letters: a person's display name."""
    words = normal_value(value).split(" ")
    return len(words) >= 2 and all(word.isalpha() for word in words)


def _same(
    a: str, b: str, left: Side, right: Side, orders: dict[str, SlashOrder] | None
) -> bool | None:
    """Whether two values are the same, or None when that cannot be told (item 5 with
    FO-18, 19 November 2026). Dates compare as dates and numbers as numbers; names compare
    after their words are folded and a "Last, First" name is turned round; values that
    differ only by separators or zero padding ("j.smith" and "jsmith", "EMP001" and
    "EMP1"), an empty value, and an account against a display name are left open. Before,
    every separator and leading zero was dropped, so "1.5" matched "15" and "j.smith"
    matched "j_smith"; and a date written two ways did not match."""
    if not _identifier(a) or not _identifier(b):
        return None
    if _strict(a) == _strict(b):
        return True
    moments = _moment(a, _order(left, orders)), _moment(b, _order(right, orders))
    if _DATE_SHAPED.search(a) or _DATE_SHAPED.search(b):
        if moments[0] is None or moments[1] is None:
            return None
        return moments[0].at == moments[1].at
    numbers = _number(a), _number(b)
    if numbers[0] is not None and numbers[1] is not None:
        return numbers[0] == numbers[1]
    if normal_value(a) and normal_value(a) == normal_value(b):
        return True
    if (_account_shaped(a) and _name_shaped(b)) or (_name_shaped(a) and _account_shaped(b)):
        return None
    padded = re.compile(r"(?<=[^\W\d_])0+(?=\d)")
    if padded.sub("", _identifier(a)) == padded.sub("", _identifier(b)):
        return None
    return False


def _number(value: str) -> tuple[float, str] | None:
    """A number and its unit (a percent sign, or none). Grouping commas only in groups of
    three, so "1,5" and "1.234,5" are unread rather than read as 15 and 1234.5 (item 5)."""
    text = value.strip()
    unit = ""
    if text.endswith("%"):
        unit, text = "%", text[:-1].strip()
    if not _NUMBER.match(text):
        return None
    return float(text.replace(",", "")), unit


def _contains(quote: str, value: str) -> bool:
    """Whether the quoted passage holds the value as a whole-token run (item 5): "Lee" is
    not in "Ashlee", "jsmith" not in "jsmith2", "2027-03-1" not in "2027-03-15"."""
    wanted = _tokens(value)
    return bool(wanted) and _runs(_tokens(quote), wanted) > 0


def _same_text(cell: str, value: str) -> bool:
    return bool(_identifier(value)) and _strict(cell) == _strict(value)


def _squash(text: str) -> str:
    return " ".join(
        unicodedata.normalize("NFKC", text).casefold().replace("‐", "-").replace("–", "-").split()
    )
