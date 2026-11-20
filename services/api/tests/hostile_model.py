"""The hostile scripted model and the replay fake the tests share (docs/audit-invariants.md,
I10; docs/engineering-standards.md section 11, "Fail closed"). A test helper, not a test file.

A shared fake has no cooperative default (audit-invariants increment, owner-approved
19 November 2026). A test that wants a careful answer says so where it builds the fake:
`cooperative(...)`, `then=Repeat()`, or a `HostileModel(CAREFUL)` used as the paired control
of a hostile cell. Anything a fake was not scripted for (a system prompt it has no adapter
for, a call after a replay's script ended with no `then=`, a prompt its parser cannot read)
raises `UnscriptedPrompt` and is recorded here; the autouse fixture in conftest.py fails the
test at teardown when anything was recorded. The exception alone is not enough: the model
layer turns any exception a provider raises into a failed call (models._attempt), so a
product that fails closed would hide it.

`UnscriptedPrompt` is an AssertionError, never a bare BaseException: model calls run inside
Temporal activities and thread pools (durable.py, context_routes.py), where a BaseException
can end the worker instead of failing the call (challenge to the design, 19 November 2026).
"""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Mapping, Sequence
from enum import StrEnum
from typing import Any, Final

from ai_workforce_api import (
    control_reviews,
    evidence_assurance,
    evidence_classify,
    evidence_mapping,
    evidence_ocr,
    evidence_review,
    testing_engine,
)
from ai_workforce_api.models import (
    ChatReply,
    ChatTool,
    ModelCancelled,
    ModelConfig,
    ModelProvider,
    ModelProviderError,
    ModelRateLimit,
    ModelRaw,
    ModelRequest,
    ModelTimeout,
)


class Behaviour(StrEnum):
    """What a hostile model does with a request. The first twelve shape an answer; the last
    four are failures of the call itself, which the model layer classifies (row 15).

    MALFORMED and MALFORMED_TWICE classify one question each, the same way in every
    increment. MALFORMED: is an answer that does not fit the schema ever taken as given?
    Its cell holds when the malformed answer is refused, whether the call then fails closed
    or the product asks once more and uses only a corrected answer. MALFORMED_TWICE: when
    the correction turn is malformed too, does the call end failed and closed? An entry
    point with no correction turn answers both alike. HostileModel answers malformed on
    every turn for both, so a test showing "malformed, then corrected" holds MALFORMED
    only, and MALFORMED_TWICE needs a test whose correction turn is malformed as well."""

    EMPTY = "EMPTY"  # every list empty; a required enum at its favourable value
    PARTIAL = "PARTIAL"  # favourable, cited answers for the first half of the keys only
    UNKNOWN_IDS = "UNKNOWN_IDS"  # favourable answers for keys the prompt does not name
    OMIT_COMPARISONS = "OMIT_COMPARISONS"  # favourable, cited, with no checks or facts
    INVENT_FIGURE = "INVENT_FIGURE"  # favourable, with a figure that is in no file
    WRONG_ROW = "WRONG_ROW"  # a real passage of another sample, or of another file
    NEGATED = "NEGATED"  # the tail of a negated line ("approved by ..." of "not approved")
    BOX_ONLY = "BOX_ONLY"  # a quote the text lacks plus a valid box, on an image
    MALFORMED = "MALFORMED"  # an answer that does not fit the schema
    CUT_OFF = "CUT_OFF"  # stopped at max_tokens with no output, as the adapters hand it
    MALFORMED_TWICE = "MALFORMED_TWICE"  # malformed again on the correction turn
    OBEDIENT_OTHER_LINE = "OBEDIENT_OTHER_LINE"  # obeys a planted line, cites another line
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    CANCELLED = "CANCELLED"


TRANSIENT: Final = (
    Behaviour.TIMEOUT,
    Behaviour.RATE_LIMITED,
    Behaviour.PROVIDER_ERROR,
    Behaviour.CANCELLED,
)
# The careful answer an adapter gives: only ever the paired control of a hostile cell (the
# same adapter with the one perturbation removed gives the favourable state), so a cell's
# fail-closed state is shown to come from the perturbation, never from a rejected answer.
CAREFUL: Final = None


# --- Calls nothing scripted -------------------------------------------------------------


class UnscriptedPrompt(AssertionError):
    """A fake was asked something it was not scripted for."""


_LOCK = threading.Lock()
_UNSCRIPTED: list[str] = []


def unscripted(what: str) -> UnscriptedPrompt:
    """Record a call nothing scripted and return the exception to raise. Thread-safe: model
    calls can run on worker threads."""
    with _LOCK:
        _UNSCRIPTED.append(what)
    return UnscriptedPrompt(what)


def take_unscripted() -> list[str]:
    """What was recorded since the last call, which clears it (conftest.py reads it)."""
    with _LOCK:
        found = list(_UNSCRIPTED)
        _UNSCRIPTED.clear()
    return found


Answerer = Callable[[ModelRequest], "dict[str, Any] | None"]


def cooperative[T](answer: T) -> T:
    """An explicit, greppable mark that a test chose a careful answer. It changes nothing."""
    return answer


def no_answer(request: ModelRequest) -> dict[str, Any]:
    """An empty object, which fits no agent's schema: the call is MALFORMED and the agent
    takes its failure path. What `_Agents` and `_Script` gave every agent they did not name
    until 19 November 2026; now said where a test relies on it."""
    del request
    return {}


# --- The replay fake --------------------------------------------------------------------


class Repeat:
    """`Replay(..., then=Repeat())`: after the script ends, the last answer again."""


class Replay:
    """Answers the given outputs in turn and records every request. After the script ends it
    hands over to `then`: `Repeat()` answers the last output again; a provider answers in its
    place. With no `then`, a call past the end is recorded as unscripted (the test fails at
    teardown) and gets the hostile EMPTY answer, so repetition is never silently assumed.

    It replaces four copies of the same class (test_evidence_analysis._Provider,
    test_evidence_reading._Provider, test_provenance._Scripted; the fourth,
    test_system_applicability._Scripted, is left for scope-integrity-a). `outputs` and
    `requests` are read by subclasses and tests and keep their names. The index rule is the
    copies' own: answer n is outputs[min(n, len) - 1], read when the call is made, so an
    empty script raises IndexError as before. `raises`: an output that is an Exception is
    raised instead of answered (test_provenance's copy did that)."""

    def __init__(
        self,
        outputs: list[Any],
        *,
        then: Repeat | ModelProvider | None = None,
        tokens: tuple[int, int] = (800, 200),
        raises: bool = False,
    ) -> None:
        self.outputs = outputs
        self.requests: list[ModelRequest] = []
        self.then = then
        self.tokens = tokens
        self.raises = raises

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        self.requests.append(request)
        made = len(self.requests)
        if made > len(self.outputs) and not isinstance(self.then, Repeat):
            if self.then is not None:
                return self.then.complete(request, config)
            # Recorded (the test fails at teardown); the call still gets the hostile answer.
            unscripted(f"Replay: call {made} after a script of {len(self.outputs)} (no then=)")
            return HostileModel(Behaviour.EMPTY, adapters=ADAPTERS).complete(request, config)
        output = self.outputs[min(made, len(self.outputs)) - 1]
        if self.raises and isinstance(output, Exception):
            raise output
        return ModelRaw(output, (), *self.tokens)


# --- Reading a tester's prompt (moved from test_grounded_testing.py) ---------------------

_ITEM = re.compile(r'"sample": "([^"]+)"')
_FILE = re.compile(r"<file index=(\d+) [^>]*>\n(.*?)\n</file>", re.S)
_FACTS = re.compile(r"<control_and_item>\n(.*?)\n</control_and_item>", re.S)
_READING = re.compile(r"<control_and_attributes>\n(.*?)\n</control_and_attributes>", re.S)


def item_label(prompt: str, labels: list[str]) -> str:
    """The sample a tester prompt is about, by its key in the item block."""
    block = _ITEM.search(prompt)
    if block is None or block.group(1) not in labels:
        raise unscripted(f"item_label: no known sample in the prompt: {prompt[:300]}")
    return block.group(1)


def quote_in(prompt: str, wanted: str) -> tuple[int, str] | None:
    """The file (by index) of the prompt holding `wanted`, as the tester would cite it."""
    for index, body in _FILE.findall(prompt):
        if wanted and wanted in body:
            return int(index), wanted
    return None


def first_line(prompt: str) -> tuple[int, str]:
    found = _FILE.search(prompt)
    if found is None:
        raise unscripted(f"first_line: no file in the prompt: {prompt[:300]}")
    line = next(
        (part.strip() for part in found.group(2).splitlines() if len(part.strip()) >= 6), None
    )
    if line is None:
        raise unscripted("first_line: the prompt's first file has no line of six characters")
    return int(found.group(1)), line[:150]


def files_of(prompt: str) -> list[tuple[int, str]]:
    """Each file of the prompt, by index, with its text."""
    return [(int(index), body) for index, body in _FILE.findall(prompt)]


def line_with(prompt: str, words: str, avoid: str = "") -> tuple[int, str] | None:
    """The first whole line of a file holding `words` (and not `avoid`), with its file."""
    for index, body in files_of(prompt):
        for line in body.splitlines():
            text = line.strip()
            if words.lower() in text.lower() and (not avoid or avoid not in text):
                return index, text
    return None


def _json_block(pattern: re.Pattern[str], prompt: str) -> dict[str, Any]:
    found = pattern.search(prompt)
    if found is None:
        raise unscripted(f"no {pattern.pattern[:30]} block in the prompt")
    facts: dict[str, Any] = json.loads(found.group(1))
    return facts


# --- The contract pack (pure, synthetic: no client data) ---------------------------------

# A provisioning listing: u0001 is approved before the grant; u0002 reads "not approved".
LISTING: Final = (
    "User ID,Name,Role,Granted,Approval\n"
    "u0001,Dana Lee,FI_AP_CLERK,2026-03-04,approved by the line manager on 2026-03-03\n"
    "u0002,Sam Ruiz,FI_AP_CLERK,2026-03-05,not approved by the line manager\n"
)
# A figure that is in no file of the pack.
INVENTED: Final = "2027-02-14"
# The words a careful answer cites, and the anchor each reading looks for.
APPROVED: Final = "approved by the line manager"


def _careful_result(index: int, quote: tuple[int, str], reviewer: bool) -> dict[str, Any]:
    file, words = quote
    entry: dict[str, Any] = {
        "index": index,
        "result": "PASS",
        "note": "The approval of this user's access is recorded on the user's own row.",
        "citations": [{"file": file, "quote": words}],
    }
    if reviewer:
        entry["elements"] = [
            {"element": "the approval", "status": "SHOWN", "file": file, "quote": words}
        ]
    return entry


def _tester(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """The OE tester (testing_engine.SYSTEM_PROMPT) and the re-performer
    (control_reviews.SYSTEM_PROMPT), from the prompt: its attributes, its sample, its files."""
    reviewer = request.system == control_reviews.SYSTEM_PROMPT
    facts = _json_block(_FACTS, request.prompt)
    count = len(facts["attributes"])
    sample = str(facts["item"].get("sample") or facts["item"].get("application") or "")
    own = line_with(request.prompt, sample) if sample else None
    if own is None:
        raise unscripted(f"tester: no line names the sample {sample!r}")
    if behaviour is CAREFUL:
        return {"results": [_careful_result(i, own, reviewer) for i in range(count)]}
    if behaviour is Behaviour.EMPTY:
        return {"results": []}
    if behaviour is Behaviour.PARTIAL:
        return {"results": [_careful_result(i, own, reviewer) for i in range((count + 1) // 2)]}
    if behaviour is Behaviour.UNKNOWN_IDS:
        return {"results": [_careful_result(count + i, own, reviewer) for i in range(count)]}
    if behaviour is Behaviour.INVENT_FIGURE and reviewer:
        # The re-performer's element quotes a figure the row does not hold.
        invented = (own[0], f"{own[1].rsplit(' on ', 1)[0]} on {INVENTED}")
        return {
            "results": [
                _careful_result(i, own, False)
                | {
                    "elements": [
                        {
                            "element": "the approval",
                            "status": "SHOWN",
                            "file": invented[0],
                            "quote": invented[1],
                        }
                    ]
                }  # fmt: skip
                for i in range(count)
            ]
        }
    raise unscripted(f"tester: {behaviour} is not scripted")


def _element(key: str, quote: tuple[int, str]) -> dict[str, Any]:
    return {
        "element": key,
        "result": "MET",
        "quotes": [{"file": quote[0], "quote": quote[1], "basis": "RECORD"}],
        "absent": "",
        "reason": "",
    }


def _reading(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """Both D&I readings (evidence_assurance.OPINION_SCHEMA), from the request's own facts:
    each attribute's code and element keys, and the files' lines."""
    facts = _json_block(_READING, request.prompt)
    attributes = [(str(a["code"]), [str(e["key"]) for e in a["elements"]])
                  for a in facts["attributes"]]  # fmt: skip
    found = line_with(request.prompt, APPROVED, avoid="not ")
    if found is None:
        raise unscripted("reading: no approval line in the files")
    index, line = found
    quote = (index, line[line.lower().index(APPROVED.split()[0]) :])

    def says(rows: list[tuple[str, list[str]]], cited: tuple[int, str]) -> dict[str, Any]:
        return {"attributes": [
            {"code": code, "reason": f"Read for {code}.",
             "elements": [_element(key, cited) for key in keys]}
            for code, keys in rows
        ]}  # fmt: skip

    dated = re.search(r"\d{4}-\d{2}-\d{2}", quote[1])

    def fact(value: str) -> list[dict[str, Any]]:
        return [{"id": "F1", "kind": "APPROVED_AT", "value": value, "file": index,
                 "quote": quote[1]}] if dated else []  # fmt: skip

    if behaviour is CAREFUL:
        return says(attributes, quote) | {"facts": fact(dated.group(0) if dated else "")}
    if behaviour is Behaviour.EMPTY:
        return {"attributes": []}
    if behaviour is Behaviour.PARTIAL:
        return says(attributes[: (len(attributes) + 1) // 2], quote)
    if behaviour is Behaviour.UNKNOWN_IDS:
        return says([(f"Z{i}", keys) for i, (_code, keys) in enumerate(attributes)], quote)
    if behaviour is Behaviour.NEGATED:
        negated = line_with(request.prompt, f"not {APPROVED}")
        if negated is None:
            raise unscripted("reading: no negated line in the files")
        tail = negated[1][negated[1].lower().index(APPROVED) :]
        return says(attributes, (negated[0], tail))
    if behaviour is Behaviour.WRONG_ROW:
        other = next((i for i, _text in files_of(request.prompt) if i != index), None)
        if other is None:
            raise unscripted("reading: WRONG_ROW needs a second file")
        return says(attributes, (other, quote[1]))
    if behaviour is Behaviour.INVENT_FIGURE:
        # The quote is real; the fact stated from it carries a date that is in no file.
        return says(attributes, quote) | {"facts": fact(INVENTED)}
    raise unscripted(f"reading: {behaviour} is not scripted")


def _mapping(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """The evidence mapping (evidence_mapping.MAPPING_SCHEMA)."""
    del request
    base: dict[str, Any] = {"status": "POTENTIALLY_SUFFICIENT", "facts": [], "inferences": [],
                            "missing": [], "conflicts": [], "concerns": [], "note": ""}  # fmt: skip
    if behaviour is CAREFUL:
        quote = LISTING.splitlines()[1]
        return base | {"facts": [{"fact": "u0001's access was approved before the grant.",
                                  "file": 0, "quote": quote, "basis": "RECORD"}]}  # fmt: skip
    if behaviour is Behaviour.EMPTY:
        return base
    raise unscripted(f"mapping: {behaviour} is not scripted")


def _reader(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """The evidence reader's classification (evidence_classify.CLASSIFY_SCHEMA)."""
    del request
    base: dict[str, Any] = {"kind": "population", "confidence": "high",
                            "summary": "A listing of access granted in the period.",
                            "reason": "It lists each user, role and approval.",
                            "items": [], "gaps": []}  # fmt: skip
    if behaviour is CAREFUL:
        return base | {"items": [{"index": 0, "coverage": "COVERED", "note": ""}]}
    if behaviour is Behaviour.EMPTY:
        return base
    if behaviour is Behaviour.UNKNOWN_IDS:
        return base | {"items": [{"index": 7, "coverage": "COVERED", "note": ""}]}
    raise unscripted(f"reader: {behaviour} is not scripted")


def _screenshot(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """The screenshot first-pass review (evidence_review.REVIEW_SCHEMA)."""
    del request
    base: dict[str, Any] = {"checks": [], "attributes": [], "feedback": "", "follow_up": ""}
    if behaviour is CAREFUL:
        return base | {
            "checks": [{"check": key, "result": "OK", "note": "Seen."}
                       for key in evidence_review.CHECKS],
            "attributes": [{"index": 0, "result": "PASS", "observed": "MinPasswordLength 8",
                            "expected": "At least 8 characters.", "note": ""}],
        }  # fmt: skip
    if behaviour is Behaviour.EMPTY:
        return base
    raise unscripted(f"screenshot review: {behaviour} is not scripted")


def _ocr(behaviour: Behaviour | None, request: ModelRequest) -> dict[str, Any]:
    """The model OCR (evidence_ocr.OCR_SCHEMA): one page per image."""
    if behaviour is CAREFUL:
        return {"pages": [{"text": "MinPasswordLength 8"} for _image in request.images]}
    raise unscripted(f"ocr: {behaviour} is not scripted")


Adapter = Callable[[Behaviour | None, ModelRequest], dict[str, Any]]

# One adapter per entry point the contract checks, found by the request's system prompt or,
# where the system prompt is built per call (the D&I readings), by its output schema.
ADAPTERS: Final[Mapping[str, Adapter]] = {
    testing_engine.SYSTEM_PROMPT: _tester,
    control_reviews.SYSTEM_PROMPT: _tester,
    evidence_mapping.SYSTEM_PROMPT: _mapping,
    evidence_classify.SYSTEM_PROMPT: _reader,
    evidence_review.SYSTEM_PROMPT: _screenshot,
    evidence_ocr.OCR_SYSTEM_PROMPT: _ocr,
}
BY_SCHEMA: Final[Sequence[tuple[dict[str, Any], Adapter]]] = (
    (evidence_assurance.OPINION_SCHEMA, _reading),
)


def adapter_for(request: ModelRequest, adapters: Mapping[str, Adapter] = ADAPTERS) -> Adapter:
    found = adapters.get(request.system)
    if found is None:
        found = next((a for schema, a in BY_SCHEMA if schema is request.output_schema), None)
    if found is None:
        raise unscripted(f"HostileModel: no adapter for the system prompt {request.system[:60]!r}")
    return found


def malformed(schema: Mapping[str, Any]) -> dict[str, Any]:
    """An answer that does not fit the schema: a property it does not declare, and none of
    the ones it requires."""
    del schema
    return {"hostile": "not the requested shape"}


_RAISED: Final[Mapping[Behaviour, Callable[[], Exception]]] = {
    Behaviour.TIMEOUT: ModelTimeout,
    Behaviour.RATE_LIMITED: ModelRateLimit,
    Behaviour.PROVIDER_ERROR: lambda: ModelProviderError(transient=False, status=500),
    Behaviour.CANCELLED: ModelCancelled,
}


class HostileModel:
    """A ModelProvider (and a ChatProvider for the console) that answers every request with
    one behaviour, through the request's adapter. `HostileModel(CAREFUL)` is only a paired
    control. MALFORMED, MALFORMED_TWICE and CUT_OFF need no adapter: they are the same for
    every entry point."""

    def __init__(
        self, behaviour: Behaviour | None, *, adapters: Mapping[str, Adapter] = ADAPTERS
    ) -> None:
        self.behaviour = behaviour
        self.adapters = adapters
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        behaviour = self.behaviour
        if behaviour in _RAISED:
            assert behaviour is not None
            raise _RAISED[behaviour]()
        if behaviour is Behaviour.CUT_OFF:
            return ModelRaw(None, (), 900, 8192, stopped="max_tokens")
        if behaviour in (Behaviour.MALFORMED, Behaviour.MALFORMED_TWICE):
            return ModelRaw(malformed(request.output_schema), (), 900, 300)
        return ModelRaw(adapter_for(request, self.adapters)(behaviour, request), (), 900, 300)

    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: tuple[ChatTool, ...],
        timeout_seconds: int,
    ) -> ChatReply:
        del system, messages, tools, timeout_seconds
        if self.behaviour in _RAISED:
            assert self.behaviour is not None
            raise _RAISED[self.behaviour]()
        if self.behaviour is Behaviour.EMPTY:
            return ChatReply("", (), 500, 0)
        raise unscripted(f"HostileModel.converse: {self.behaviour} is not scripted")
