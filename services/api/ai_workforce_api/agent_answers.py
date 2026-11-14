"""An agent's answer, corrected once where one part failed, and what a person is told when
no answer could be used (13 November 2026, after "Run again" on the Attributes step of
ITGC-AC-01: the reviewer's answer and two of the planner's were rejected for their shape or
one quote, and the screen said nothing).

Three parts, each the same for every agent that uses them:

- The answer's representation is read as the schema declares it for every model call
  (models.unnested, ModelRequest.unnest on by default): nothing here repeats that.
- `generate_read`: the agent's call, read by the caller's own check. When the check fails
  on one part (a property's shape, a missing required part, a rule the caller enforces), the
  same agent is asked once more with a correction naming the place and the reason
  (`correction_prompt`). The second answer goes through every check again; when it fails
  too, nothing of either is used and the caller keeps what stood before. A failed call (a
  timeout, the budget) is not corrected: the caller's retry policy is AgentCaller.generate's.
- `note_unusable` / `note_used`: what the system made of the agent's last answer, on the
  call's outcome record (model_call_outcomes, write-once): for an answer that could not be
  used, a plain sentence for the person of what failed, what was kept and what to do next.
  `notes_for` reads them back for the screens (the control context's
  `attributes_agent_notes`).

Nothing here decides anything about the audit, and nothing makes a rejected part usable: a
correction is a new answer, checked as the first was.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from pydantic import BaseModel, ValidationError

from ai_workforce_api.model_providers import call_note
from ai_workforce_api.models import ModelRequest
from ai_workforce_api.provenance import READABLE, AgentCaller, Call, record_outcome

# The previous answer is repeated in the correction only up to this length; a longer one is
# described instead (the planner's own correction repeats its plan, which is shorter).
PREVIOUS_LIMIT = 40_000
# How many corrections an agent's answer gets by default: one.
CORRECTIONS = 1
# The steps of the Attributes step's run, by the family of their prompt version (the part
# before "/"): the attribute agent, the reviewer of its drafts, the planner (which tailors
# the criteria), and the reviewer of the set. The attribute agent starts every run.
ATTRIBUTE_STEPS: tuple[str, ...] = (
    "attributes",
    "attribute-review",
    "engagement-planner",
    "attribute-set-review",
)
_WHO = {
    "attributes": "The attribute agent",
    "attribute-review": "The reviewer of the drafted attributes",
    "engagement-planner": "The planner",
    "attribute-set-review": "The reviewer of the attributes",
}


@dataclass(frozen=True)
class Answered[T]:
    """The outcome of an agent's call after at most its corrections: the value the caller's
    check read (None when no answer could be used), the last call made, every call made,
    and why the last answer could not be used: in the check's words (`problem`, for the
    record) and in fixed plain words (`plain`, for the person); both empty when used."""

    value: T | None
    call: Call
    calls: tuple[Call, ...]
    problem: str = ""
    plain: str = ""

    @property
    def used(self) -> bool:
        return self.value is not None


def place(loc: tuple[int | str, ...]) -> str:
    """A place in an answer as its JSON names it: attributes[0].follows."""
    return "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in loc).lstrip(".")


def problem_of(error: ValueError) -> str:
    """Why an answer failed the caller's check, naming the places by their path in the
    answer and the rule by its message, never a value (pydantic's messages carry none
    without input_value, which is not included)."""
    if isinstance(error, ValidationError):
        found = "; ".join(f"{place(item['loc'])}: {item['msg']}" for item in error.errors()[:8])
        return f"it does not match the schema: {found}"[:500]
    return (str(error).strip() or "it could not be read")[:500]


# What a person reads for why an answer could not be used: fixed plain words, never the
# schema's paths or a validator's message (those are the record's: the outcome's reason).
SHAPE = "the answer did not have the required shape"
MISQUOTE = "the answer quoted the records for something they do not say"
CUT_OFF = "the answer was cut off at the output limit"
RULE = "the answer broke a rule its work is checked against"


def plain_problem(problem: str) -> str:
    """The fixed plain words for a recorded reason (a check's or a call's)."""
    text = problem.lower()
    if "cut off" in text:
        return CUT_OFF
    if "quote" in text and ("does not say" in text or "do not hold" in text):
        return MISQUOTE
    if (
        "schema" in text
        or "required format" in text
        or "inside another property" in text
        or "did not fit" in text
    ):
        return SHAPE
    for status in ("TIMEOUT", "RATE_LIMITED", "MODEL_ERROR", "CANCELLED", "BUDGET_EXCEEDED"):
        said = call_note(status).rstrip(".")
        if said.lower() in text:
            return said[0].lower() + said[1:]
    return RULE


def unanswered(call: Call) -> str:
    """Why a call left no answer to read, in words."""
    if call.raw.stopped == "max_tokens":
        return "the answer was cut off at the output limit"
    if call.status == "MALFORMED" and call.raw.output is None:
        return SHAPE
    said = call_note(call.status).rstrip(".")
    return said[0].lower() + said[1:]


def correction_prompt(prompt: str, previous: Any, problem: str) -> str:
    """The agent's prompt again, with its previous answer and why it could not be used."""
    shown = json.dumps(previous, ensure_ascii=False, default=str)
    kept = (
        f"\n\n<your_previous_answer>\n{shown}\n</your_previous_answer>"
        if len(shown) <= PREVIOUS_LIMIT
        else "\n\nYour previous answer is too long to repeat here."
    )
    return (
        f"{prompt}{kept}\n\nYour previous answer could not be used: {problem}. Each place is "
        "named as it is in your answer (for example attributes[0].follows). Return the whole "
        "answer again with that fixed and everything else kept. Give every object and list as "
        "structured data, never as text, and leave out an optional property you have nothing "
        "for instead of sending null. Never invent a quote, a name or a figure to fill a gap: "
        "leave out what the sources do not support."
    )


def generate_read[T](
    connection: psycopg.Connection[Any],
    caller: AgentCaller,
    request: ModelRequest,
    prompt_version: str,
    inputs: dict[str, Any],
    read: Callable[[dict[str, Any]], T],
    corrections: int = CORRECTIONS,
) -> Answered[T]:
    """The agent's answer as `read` takes it (its own check: a model's validation, a rule),
    asked again with a correction when that check fails, up to `corrections` times. Each
    answer goes through `read` whole: nothing of a rejected answer is kept or merged. An
    answer that was corrected has its outcome recorded as rejected, with why; the last
    call's outcome is the caller's to record (note_used, note_unusable)."""
    call = caller.generate(request, prompt_version, inputs)
    calls = [call]
    problem = plain = ""
    for attempt in range(corrections + 1):
        if call.status not in READABLE or call.raw.output is None:
            why = unanswered(call)
            return Answered(None, call, tuple(calls), why, why)
        try:
            return Answered(read(call.raw.output), call, tuple(calls))
        except ValueError as error:
            problem = problem_of(error)
            plain = SHAPE if isinstance(error, ValidationError) else plain_problem(problem)
        # One correction in all: a call AgentCaller already corrected has had it.
        if attempt == corrections or call.corrected:
            break
        record_outcome(
            connection, call.call_id,
            {"validation": "REJECTED", "reason": problem, "corrected": True},
        )  # fmt: skip
        previous = call.raw.returned if call.raw.returned is not None else call.raw.output
        call = caller.generate(
            replace(request, prompt=correction_prompt(request.prompt, previous, problem)),
            prompt_version,
            {**inputs, "correction": attempt + 1, "rejected": problem[:300]},
        )
        calls.append(call)
    return Answered(None, call, tuple(calls), problem, plain)


def note_used(
    connection: psycopg.Connection[Any], call: Call | None, details: dict[str, Any] | None = None
) -> None:
    """The agent's last answer was used: its outcome, with what was left out of it and why
    (`details`, such as a fact whose quote the records do not hold)."""
    if call is None:
        return
    record_outcome(connection, call.call_id, {"validation": "ACCEPTED", **(details or {})})


def note_unusable(
    connection: psycopg.Connection[Any],
    call: Call | None,
    reason: str,
    failed: str,
    kept: str,
    next_step: str,
) -> str:
    """No answer of the agent could be used: on the last call's outcome, why (`reason`, the
    check's words) and the person's sentence in three parts, what failed, what was kept, and
    what to do. Returns the sentence. A call that was never made (no model) records
    nothing; the caller says so as before."""
    sentence = " ".join(part.strip() for part in (failed, kept, next_step) if part.strip())
    if call is None:
        return sentence
    record_outcome(
        connection,
        call.call_id,
        {
            "validation": "REJECTED" if call.readable else "NOT_USED",
            "reason": reason[:500],
            "status": call.status,
            "note": {"failed": failed[:400], "kept": kept[:400], "next_step": next_step[:400]},
        },
    )
    return sentence


class AgentNoteBody(BaseModel):
    """What a person reads when an agent's last answer on the control could not be used.

    agent: who, in words ("The attribute agent", "The planner").
    step: the agent's step, by the family of its prompt version: attributes,
      attribute-review, engagement-planner or attribute-set-review.
    failed / kept / next_step: what failed, what was kept, and what to do next (run again,
      or the manual path), each one or two plain sentences.
    sentence: the three together, as one note to show.
    model_call_id: the call the note is about, for its record.
    at: when that call was made."""

    agent: str
    step: str
    failed: str
    kept: str
    next_step: str
    sentence: str
    model_call_id: UUID
    at: datetime


def notes_for(
    connection: psycopg.Connection[Any], control_id: UUID, steps: tuple[str, ...] = ATTRIBUTE_STEPS
) -> list[AgentNoteBody]:
    """The notes of the control's agents whose last answer could not be used, in the order
    of the run's steps. Each step's latest call on the control speaks for it, and only when
    it is not older than the attribute agent's latest call, which starts every run: a step
    the latest run did not reach (no drafts to review, say) does not repeat an older run's
    note. A step whose latest answer was used has no note."""
    rows = connection.execute(
        """
        WITH latest AS (
            SELECT DISTINCT ON (split_part(m.prompt_version, '/', 1))
                   split_part(m.prompt_version, '/', 1) AS step, m.id, m.created_at
            FROM model_calls m
            WHERE m.target_type = 'engagement_control' AND m.target_id = %s
              AND split_part(m.prompt_version, '/', 1) = ANY(%s)
            ORDER BY split_part(m.prompt_version, '/', 1), m.created_at DESC, m.id DESC
        )
        SELECT l.step, l.id, l.created_at, o.outcome
        FROM latest l
        JOIN model_call_outcomes o ON o.model_call_id = l.id
        WHERE o.outcome ? 'note'
          AND l.created_at >= coalesce(
              (SELECT max(created_at) FROM latest WHERE step = %s), '-infinity')
        """,
        (control_id, list(steps), steps[0]),
    ).fetchall()
    found: list[AgentNoteBody] = []
    for step, call_id, at, outcome in rows:
        note = outcome.get("note") if isinstance(outcome, dict) else None
        if not isinstance(note, dict):
            continue
        parts = [str(note.get(key) or "").strip() for key in ("failed", "kept", "next_step")]
        found.append(
            AgentNoteBody(
                agent=_WHO.get(str(step), "The agent"),
                step=str(step),
                failed=parts[0],
                kept=parts[1],
                next_step=parts[2],
                sentence=" ".join(part for part in parts if part),
                model_call_id=UUID(str(call_id)),
                at=at,
            )
        )
    order = {step: index for index, step in enumerate(steps)}
    return sorted(found, key=lambda item: order.get(item.step, len(order)))


# The statuses whose call left no answer at all; a malformed call with an answer may still
# have been read by its caller's own check, so only its recorded outcome says it was not.
_NO_ANSWER = ("TIMEOUT", "RATE_LIMITED", "MODEL_ERROR", "BUDGET_EXCEEDED")
# The sentence a run's note ends with when some of its readings gave no usable answer
# (unusable_sentence), and the words failure_note finds it by.
UNUSABLE_MARK = "The agent could not finish"


def unusable_in_run(connection: psycopg.Connection[Any], job_id: UUID) -> int:
    """How many of a run's model calls (one job: AgentCaller.job.job_id) gave no usable
    answer, in one query: an outcome that says it was rejected or not used (a corrected
    call's rejection is not counted: its correction answers for it), or, with no outcome
    recorded, a call that left no answer at all."""
    row = connection.execute(
        """
        SELECT count(*) FROM model_calls m
        LEFT JOIN model_call_outcomes o ON o.model_call_id = m.id
        WHERE m.job_id = %s AND m.operation = 'generate'
          AND CASE WHEN o.model_call_id IS NOT NULL
                   THEN o.outcome ->> 'validation' IN ('REJECTED', 'NOT_USED')
                        AND coalesce(o.outcome ->> 'corrected', 'false') <> 'true'
                   ELSE m.status = ANY(%s)
                        OR (m.status = 'MALFORMED' AND m.output_sha256 IS NULL)
              END
        """,
        (job_id, list(_NO_ANSWER)),
    ).fetchone()
    return 0 if row is None else int(row[0])


def unusable_sentence(count: int) -> str:
    """What a run's note says when `count` of its readings gave no usable answer; empty
    when none did."""
    if count <= 0:
        return ""
    return (
        f"{UNUSABLE_MARK} {count} of its readings: "
        f"{'the answer' if count == 1 else 'the answers'} could not be used."
    )


def run_failure_note(note: str, kept: str, next_step: str) -> str:
    """`failure_note` of a run whose note carries unusable_sentence: that sentence, what was
    kept and what to do; empty otherwise."""
    at = note.find(UNUSABLE_MARK)
    if at < 0:
        return ""
    return f"{note[at:].strip()} {kept} {next_step}".strip()
