"""The control's context an evidence check is given (docs/evidence-assurance.md, 10.2).

A senior auditor judges evidence against how the control is designed and how it runs at
this organization, not against the attribute's words alone. Both readings of an engine 2
check are therefore given, as data:

- the control as designed: its statement with the organization's values in place, the risk
  it addresses, its type, nature and frequency, and who performs, reviews and owns it;
- the system the control is tested on and the audit period;
- the confirmed understanding, as the other agents get it
  (understanding_authority.for_agents), newest first, at most 40 facts;
- what this request asked for: the requirement's title and description.

The context has a hash, which is part of an engine 2 run's basis: a change to it puts the
run out of date. Where no fact of the understanding is confirmed the context is `thin`:
the readings are told so and the result says so; nothing fills it in.

Everything here is data the organization or the engagement team provided. It is placed in
the prompt as data, bounded, with the prompt's delimiters made inert by the caller, and is
never an instruction. `ControlContext` is pure; `load_control_side` reads the records.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.inbound import clean_line

# The most facts of the understanding a reading is given: the newest.
MAX_FACTS = 40
STATEMENT_LIMIT = 1500
RISK_LIMIT = 600
WORD_LIMIT = 120
PERSON_LIMIT = 200
SYSTEM_LIMIT = 120
TITLE_LIMIT = 300
DESCRIPTION_LIMIT = 1500
QUESTION_LIMIT = 220
ANSWER_LIMIT = 500


@dataclass(frozen=True)
class UnderstandingFact:
    """One confirmed fact of the control's understanding, as an agent's prompt carries it
    (understanding_authority.for_agents)."""

    ref: str
    question: str
    answer: str
    kind: str = "WALKTHROUGH_ANSWER"
    # When it was confirmed (ISO 8601, UTC), and by what: PERSON, or RECORDS when the
    # records filled it in and no person confirmed it.
    confirmed_at: str | None = None
    confirmed_by: str = "PERSON"

    def as_prompt(self) -> dict[str, Any]:
        return {
            "ref": clean_line(self.ref, 12),
            "kind": clean_line(self.kind, 40),
            "question": clean_line(self.question, QUESTION_LIMIT),
            "answer": clean_line(self.answer, ANSWER_LIMIT),
            "confirmed_at": (
                None if self.confirmed_at is None else clean_line(self.confirmed_at, 40)
            ),
            "confirmed_by": clean_line(self.confirmed_by, 20),
        }


@dataclass(frozen=True)
class ControlContext:
    """What the readings are given about the control besides its reference, title and
    activity. Every text is bounded where it is put in the prompt (`as_prompt`), and the
    hash is taken from that same form, so what is hashed is what is read."""

    statement: str = ""
    risk: str = ""
    control_type: str = ""
    nature: str = ""
    frequency: str = ""
    performer: str = ""
    reviewer: str = ""
    owner: str = ""
    # The system the control is tested on; "" where it is not known.
    system: str = ""
    # The audit period; None where a bound is not set.
    period_from: date | None = None
    period_to: date | None = None
    # The confirmed understanding, newest first.
    understanding: tuple[UnderstandingFact, ...] = ()
    # What this request asked for.
    request_title: str = ""
    request_description: str = ""

    @property
    def thin(self) -> bool:
        """No fact of the understanding was confirmed by a person: the evidence can only be
        judged against the attributes. A value the records filled in by themselves is not
        a person's understanding (understanding_authority.confirmed_by_a_person)."""
        return not any(fact.confirmed_by == "PERSON" for fact in self.understanding)

    @property
    def period(self) -> tuple[date | None, date | None]:
        return self.period_from, self.period_to

    def as_prompt(self) -> dict[str, Any]:
        """The context as a reading's prompt carries it, under `understanding` in the
        control_and_attributes block. Client-provided data, each text one bounded line."""
        return {
            "control": {
                "statement": clean_line(self.statement, STATEMENT_LIMIT),
                "risk": clean_line(self.risk, RISK_LIMIT),
                "type": clean_line(self.control_type, WORD_LIMIT),
                "nature": clean_line(self.nature, WORD_LIMIT),
                "frequency": clean_line(self.frequency, WORD_LIMIT),
                "performed_by": clean_line(self.performer, PERSON_LIMIT),
                "reviewed_by": clean_line(self.reviewer, PERSON_LIMIT),
                "owned_by": clean_line(self.owner, PERSON_LIMIT),
            },
            "system": clean_line(self.system, SYSTEM_LIMIT),
            "audit_period": {
                "from": None if self.period_from is None else self.period_from.isoformat(),
                "to": None if self.period_to is None else self.period_to.isoformat(),
            },
            "confirmed": [fact.as_prompt() for fact in self.understanding[:MAX_FACTS]],
            # Nothing about how the control runs is confirmed: say so, never fill it in.
            "thin": self.thin,
            "request": {
                "title": clean_line(self.request_title, TITLE_LIMIT),
                "description": clean_line(self.request_description, DESCRIPTION_LIMIT),
            },
        }

    @property
    def sha256(self) -> str:
        """The hash of what the readings are given. A fact's ref is its place in the list
        and when it was confirmed is not part of what it says (saving the same answer again
        stamps a new time), so the facts are hashed without either and in an order of their
        own: the same understanding always gives the same hash, and a check is never out of
        date for an answer that did not change."""
        shown = self.as_prompt()
        facts = sorted(
            [fact["kind"], fact["question"], fact["answer"], fact["confirmed_by"]]
            for fact in shown["confirmed"]
        )
        return hashlib.sha256(
            json.dumps({**shown, "confirmed": facts}, ensure_ascii=False, sort_keys=True).encode(
                "utf-8"
            )
        ).hexdigest()


@dataclass(frozen=True)
class ControlSide:
    """The part of the context that is the control's own, the same for each of its
    requests: read once for a control."""

    statement: str = ""
    risk: str = ""
    control_type: str = ""
    nature: str = ""
    frequency: str = ""
    performer: str = ""
    reviewer: str = ""
    owner: str = ""
    system: str = ""
    period_from: date | None = None
    period_to: date | None = None
    understanding: tuple[UnderstandingFact, ...] = ()

    def for_request(self, title: str, description: str) -> ControlContext:
        return ControlContext(
            statement=self.statement,
            risk=self.risk,
            control_type=self.control_type,
            nature=self.nature,
            frequency=self.frequency,
            performer=self.performer,
            reviewer=self.reviewer,
            owner=self.owner,
            system=self.system,
            period_from=self.period_from,
            period_to=self.period_to,
            understanding=self.understanding,
            request_title=title,
            request_description=description,
        )


def load_control_side(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> ControlSide:
    """The control's side of the context, from the records: its design
    (control_design.design_for; none for a control with no library statement), the system
    it is tested on (its application), the engagement's audit period
    (engagement_settings), and the confirmed understanding (understanding_authority.facts)
    as its agents get it, the newest MAX_FACTS."""
    from ai_workforce_api.control_design import design_for
    from ai_workforce_api.understanding_authority import facts, for_agents

    row = connection.execute(
        """
        SELECT coalesce(a.name, ''), s.period_start, s.period_end
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        LEFT JOIN engagement_settings s ON s.project_id = c.project_id
        WHERE c.id = %s AND c.project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    if row is None:
        return ControlSide()
    design = design_for(connection, control_id)
    confirmed = facts(connection, control_id)
    # Newest first, as the authority orders them; facts confirmed at the same moment are
    # put in an order of their own, so which of them fall within the newest MAX_FACTS
    # never depends on the order the rows were read in.
    ordered = sorted(
        zip(confirmed, for_agents(confirmed, ANSWER_LIMIT), strict=False),
        key=lambda pair: (
            -(pair[0].confirmed_at.timestamp() if pair[0].confirmed_at is not None else 0.0),
            pair[0].kind,
            pair[0].key,
        ),
    )
    return ControlSide(
        statement="" if design is None else design.text,
        risk="" if design is None else design.risk,
        control_type="" if design is None else design.control_type,
        nature="" if design is None else design.nature,
        frequency="" if design is None else design.frequency,
        performer="" if design is None else design.operator,
        reviewer="" if design is None else design.reviewer,
        owner="" if design is None else design.owner,
        system=str(row[0] or ""),
        period_from=row[1] if isinstance(row[1], date) else None,
        period_to=row[2] if isinstance(row[2], date) else None,
        understanding=tuple(
            UnderstandingFact(
                ref=str(shown["ref"]),
                question=str(shown["question"]),
                answer=str(shown["answer"]),
                kind=str(shown["kind"]),
                confirmed_at=None if shown["confirmed_at"] is None else str(shown["confirmed_at"]),
                confirmed_by=str(shown["confirmed_by"]),
            )
            for _fact, shown in ordered[:MAX_FACTS]
        ),
    )
