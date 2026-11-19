"""The questions the agents add after their review, end to end (product owner, 18 November
2026, on ITGC-AC-03 / BlackLine): a follow-up is raised only when the control's requirements
truly need it and it is not already asked or answered, and it is asked as the same short
interview as every other question, from one source.

On the database, with scripted agents and synthetic data only: the walkthrough answered as a
person does; the IT audit specialist's read made in the plan run; its questions worded by the
interview writer and its reviewer; the review's body read back as the page reads it.
"""

import json
from typing import Any
from uuid import UUID

from support import Database, run_plan_through
from test_attributes_follow_understanding import _Agents, _answer_required, _path, _plan_run, _ready
from test_outbound import migrated
from test_planning_gate import _rows
from test_understanding_once import _left_open

from ai_workforce_api import understanding_review as review
from ai_workforce_api import walkthrough_questions
from ai_workforce_api.db import connect
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.question_review import (
    INTERVIEW_PROMPT,
    INTERVIEW_REVIEW_PROMPT,
    REVIEWER_LABEL,
    WRITER_LABEL,
)

__all__ = ["migrated"]

AC03 = "ITGC-AC-03"
OWN_ACCESS = "wt-ac03-own-access"
LISTING_CHECK = "wt-ac03-listing-check"
# Which accounts the review includes (POPULATION on ac03-listing, as the listing check is):
# answered in the person's own words, it leaves the listing's completeness open.
COVERAGE = "wt-ac03-coverage"
CONTRACTORS = "contractor accounts kept on a separate list"
LISTING = "How is the listing's completeness confirmed?"
COMPARED = "The reviewer compares the listing's count to the system."
NOT_CONFIRMED = "Nobody confirms the listing's completeness."


def _question(topic: str, text: str, fact: str, blocks: str) -> dict[str, Any]:
    return {
        "topic": topic, "text": text, "fact": fact, "blocks": blocks,
        "suggested": COMPARED if fact == "POPULATION" else "A ticket records it.",
        "options": [COMPARED, NOT_CONFIRMED] if fact == "POPULATION"
        else ["A ticket records it.", "The review spreadsheet records it."],
    }  # fmt: skip


def _unit_asking(given: dict[str, Any], key: str) -> str:
    """The unit a walkthrough question of the bank informs, by that question's words."""
    asked = walkthrough_questions.question(key)
    assert asked is not None
    return str(
        next(
            item["unit"]
            for item in given["attributes"]
            if any(entry["question"] == asked.text for entry in item["questions"])
        )
    )


def _ref_of(given: dict[str, Any], key: str) -> str:
    """The ref the review's inputs give a walkthrough question of the bank's answer."""
    asked = walkthrough_questions.question(key)
    assert asked is not None
    return str(
        next(
            entry["ref"]
            for item in given["attributes"]
            for entry in item["questions"]
            if entry["question"] == asked.text
        )
    )


def _specialist(given: dict[str, Any]) -> dict[str, Any]:
    """The ITGC-AC-03 read of 18 November 2026, on synthetic answers: who reviews the owner's
    own access (APPROVER, which "Reviewed by someone else" already settles), asked twice, as a
    verdict's question and as a follow-up the specialist writes of that answer itself (review
    finding B2); where each investigation is recorded (RECORD, which ac03-investigated's
    criteria do not need); and how the listing's completeness is confirmed (POPULATION, which
    the coverage answered in the person's own words leaves open).

    Re-based 18 November 2026 (product owner, "Yes/No always settles"). Old: the listing
    question followed the listing check's "No" (wt-ac03-listing-check). New: a "No" settles
    the listing check, so it follows the coverage answered as "Other: ..." (wt-ac03-coverage),
    an answer that still opens one."""
    reviewer = _unit_asking(given, OWN_ACCESS)
    listing = _unit_asking(given, LISTING_CHECK)
    investigated = next(item["unit"] for item in given["attributes"]
                        if item["needs"] == ["EXCEPTION"])  # fmt: skip
    answer = review.established(
        given,
        f"The answers establish the listing and the review. They do not yet establish who "
        f"reviews the application owner's own access, which attribute {reviewer} depends on. "
        f"They do not establish where each investigation is recorded, which attribute "
        f"{investigated} depends on. They do not establish how the listing's completeness is "
        f"confirmed, which attribute {listing} depends on. These are asked now.",
    )
    answer["marked"] = [
        "who reviews the application owner's own access",
        "where each investigation is recorded",
        "how the listing's completeness is confirmed",
    ]
    asks = {
        reviewer: _question(
            "Review of the owner's own access",
            "Who reviews the application owner's own access?", "APPROVER",
            f"The {reviewer} criterion cannot be written without naming that reviewer.",
        ),
        investigated: _question(
            "Investigation record", "Where is each investigation recorded?", "RECORD",
            f"The {investigated} evidence request cannot be written without it.",
        ),
        listing: _question(
            "Listing completeness", LISTING, "POPULATION",
            f"The {listing} criterion cannot be written without it.",
        ),
    }  # fmt: skip
    answer["verdicts"] = [
        verdict
        if verdict["attribute"] not in asks
        else {
            "attribute": verdict["attribute"],
            "verdict": "NOT_ESTABLISHED",
            "rests_on": [],
            "question": asks[verdict["attribute"]],
        }  # fmt: skip
        for verdict in answer["verdicts"]
    ]
    answer["follow_ups"] = [
        {
            **_question(
                "Reviewer of the owner's own access",
                "Does someone other than the application owner review the owner's own access?",
                "APPROVER",
                f"The {reviewer} criterion cannot be written without naming that reviewer.",
            ),
            "parent": _ref_of(given, OWN_ACCESS),
            "attribute": reviewer,
        }
    ]
    return answer


def _interview(ref: str) -> dict[str, Any]:
    return {
        "ref": ref,
        "steps": [
            {
                "key": "s1",
                "question": LISTING,
                "why": "The answer decides how the listing is tested.",
                "usual": "Count compared",
                "basis": "TYPICAL",
                "answers": [
                    {"label": "Count compared", "says": COMPARED, "next": ""},
                    {"label": "Not confirmed", "says": NOT_CONFIRMED, "next": ""},
                ],
            }
        ],
        "why": "",
        "detail": LISTING,
    }


class _Wording(_Agents):
    """The run's agents, with the interview writer and its reviewer scripted too."""

    def __init__(self, database: Database, team: dict[str, Any], control: str) -> None:
        super().__init__(database, team, control)
        self.wording: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        if request.system in (INTERVIEW_PROMPT, INTERVIEW_REVIEW_PROMPT):
            self.wording.append(request)
            items = json.loads(request.prompt.split("<items>\n", 1)[1].split("\n</items>")[0])
            return ModelRaw(
                {"items": [_interview(item["ref"]) for item in items], "fixes": []}, (), 100, 100
            )
        return super().complete(request, config)


def test_a_review_question_is_asked_only_when_needed_and_from_one_source(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uqf-flow", AC03)
    # The walkthrough as a person answers it: the owner's own access "Reviewed by someone
    # else", the listing check "No", the accounts the review includes in their own words.
    _answer_required(migrated, team, control, client)
    _left_open(team, control, client, COVERAGE, CONTRACTORS)
    with connect(migrated.url) as connection:
        answered = dict(
            connection.execute(
                "SELECT question_key, value FROM control_walkthrough_answers "
                "WHERE engagement_control_id = %s AND status = 'CONFIRMED'",
                (UUID(control),),
            ).fetchall()
        )
    assert answered[OWN_ACCESS] == "Reviewed by someone else"
    assert answered[LISTING_CHECK] == "No"
    assert answered[COVERAGE] == f"Other: {CONTRACTORS}"
    agents = _Wording(migrated, team, control)
    agents.specialist = _specialist
    with connect(migrated.url) as connection:
        assert run_plan_through(connection, agents, _plan_run(migrated, control)[0]) == "DONE"
    [given] = agents.specialist_given
    reviewer = _unit_asking(given, OWN_ACCESS)
    listing = _unit_asking(given, LISTING_CHECK)
    investigated = next(i["unit"] for i in given["attributes"] if i["needs"] == ["EXCEPTION"])

    # Fix 2: what the walkthrough already answers is never raised, in any words: neither the
    # verdict's question nor the follow-up the specialist wrote of that answer (B2). The "No"
    # to the listing check settles it; the coverage in the person's own words opens one.
    issues = _rows(
        migrated,
        "SELECT id, topic, asks_code, asks_fact, asks_parent_key, wording_reviewed, status "
        "FROM control_context_issues WHERE engagement_control_id = %s AND raised_by = 'AGENT'",
        UUID(control),
    )
    assert [(row[2], row[3], row[4]) for row in issues] == [(listing, "POPULATION", COVERAGE)]
    assert not any(row[2] == reviewer or row[4] == OWN_ACCESS for row in issues)
    # Fix 3: a fact the criteria do not need is an assumption on the attribute, not a question.
    # Rewritten 18 November 2026 (owner-approved F2, after the independent revalidation). Old:
    # the walkthrough's "Reviewed by someone else" was read as establishing who reviews the
    # owner's own access: the verdict was rewritten ESTABLISHED, the narrative's sentence on it
    # left out, and nothing recorded, so the only assumption was the investigation record.
    # New: it is still not asked again, but never read as established: the verdict and the
    # narrative stay as the specialist wrote them, and the point is an assumption a person
    # sees, showing the walkthrough answer, for the verdict's question (keyed on the
    # attribute's APPROVER) and for the follow-up the specialist wrote of that answer (by its
    # matter). Methodology: an agent's finding is never discarded on a rule's reading; a person
    # decides it (That's right or Change...).
    # Rewritten again 19 November 2026 (screenshot pass of q_ui3: two near-duplicate
    # assumptions on one attribute). Old: the follow-up of the same answer on the same fact was
    # a second assumption, by its matter. New: one point per attribute and kind of fact, said
    # once, as a statement ending in a full stop (never the specialist's question).
    assumed = _rows(
        migrated,
        "SELECT matter, attribute_codes, asks_fact, status, assumed FROM attribute_assumptions "
        "WHERE engagement_control_id = %s ORDER BY created_at",
        UUID(control),
    )
    assert [row[:4] for row in assumed] == [
        ("Investigation record", [investigated], "RECORD", "OPEN"),
        ("Review of the owner's own access", [reviewer], "APPROVER", "OPEN"),
    ]
    own = walkthrough_questions.question(OWN_ACCESS)
    assert own is not None
    for row in assumed[1:]:
        # The specialist's suggested answer ("A ticket records it.") names no one for who
        # reviews, so the assumption states the attribute's own wording, with the answer as
        # its basis (r5, 19 November 2026: never "it", never "not yet established").
        subject = next(str(u["text"]) for u in given["units"] if u["key"] == reviewer)
        assert row[4] == (
            f'{subject.rstrip(". ")}, as the walkthrough answer "Reviewed by someone else" '
            f"({own.text}) indicates."
        )
    # Guard: every assumption recorded is a statement.
    for row in assumed:
        assert not row[4].rstrip().endswith("?") and "not yet established" not in row[4]
    # The review never says it asks what it does not ask, and keeps what it found open.
    [(narrative, marked, verdicts, asked, assumed_count)] = _rows(
        migrated,
        "SELECT narrative, marked, verdicts, asked, assumed FROM understanding_reviews "
        "WHERE engagement_control_id = %s",
        UUID(control),
    )
    assert (asked, assumed_count) == (1, 2)
    assert f"own access, which attribute {reviewer} depends on" in narrative
    assert "who reviews the application owner's own access" in marked
    by_unit = {item["attribute"]: item for item in verdicts}
    assert by_unit[reviewer]["verdict"] == "NOT_ESTABLISHED"

    # Fix 4: the writer and its reviewer read the walkthrough's answers and the answer the
    # follow-up follows, under the new prompt versions.
    assert [request.system for request in agents.wording] == [
        INTERVIEW_PROMPT, INTERVIEW_REVIEW_PROMPT,
    ]  # fmt: skip
    for request in agents.wording:
        package = json.loads(
            request.prompt.split("<control_context>\n", 1)[1].split("\n</control_context>")[0]
        )
        own = walkthrough_questions.question(OWN_ACCESS)
        assert own is not None
        assert {"question": own.text, "answer": "Reviewed by someone else"} in package[
            "walkthrough_answers"
        ]
        [item] = json.loads(request.prompt.split("<items>\n", 1)[1].split("\n</items>")[0])
        coverage = walkthrough_questions.question(COVERAGE)
        assert coverage is not None
        assert item["follows"] == {"question": coverage.text, "answer": f"Other: {CONTRACTORS}"}
    calls = _rows(
        migrated,
        "SELECT agent_key, prompt_version FROM model_calls WHERE target_id = %s "
        "AND prompt_version IN (%s, %s) ORDER BY created_at",
        UUID(control), WRITER_LABEL, REVIEWER_LABEL,
    )  # fmt: skip
    assert calls == [("engagement-planner", WRITER_LABEL), ("independent-reviewer", REVIEWER_LABEL)]

    # Fix 1: the review's body carries the question its need asks, reviewed, so the page asks
    # it in place from that one source.
    [(question_id, _topic, *_rest)] = issues
    read = client.get(f"{_path(team, control)}/understanding/review")
    assert read.status_code == 200, read.text
    [need] = [item for item in read.json()["needs"] if item["kind"] == "QUESTION"]
    assert need["key"] == str(question_id)
    carried = need["issue"]
    assert carried["id"] == str(question_id) and carried["status"] == "OPEN"
    assert carried["wording_reviewed"] is True and carried["wording_pending"] is False
    assert [step["question"] for step in carried["interview"]] == [LISTING]
    assert carried["proposal"] == COMPARED and carried["suggestions"] == [NOT_CONFIRMED]
    assert carried["from_review"] is True and carried["blocks"]
    assert read.json()["questions_checking"] == 0


def test_only_an_attribute_whose_needs_the_bank_records_is_held_to_them(
    migrated: Database,
) -> None:
    # Review finding N1 (18 November 2026): every attribute was held to a needs set, so a
    # tailored or custom attribute the bank records no needs for was held to what its words
    # name (needs_of), and an APPROVER or TIMING question on it was silently assumed. Only an
    # attribute whose definition the bank records the needs of is held to them.
    team, control, _scheduler, _client = _ready(migrated, "uqf-needs", AC03)
    with connect(migrated.url) as connection:
        codes = dict(
            connection.execute(
                "SELECT definition_key, code FROM control_attributes "
                "WHERE engagement_control_id = %s AND status = 'APPROVED'",
                (UUID(control),),
            ).fetchall()
        )
        assert walkthrough_questions.criteria_needs("ac03-reviewer") == ("APPROVER",)
        custom = codes["ac03-reviewer"]
        connection.execute(
            "UPDATE control_attributes SET definition_key = NULL "
            "WHERE engagement_control_id = %s AND code = %s",
            (UUID(control), custom),
        )
        connection.commit()
        inputs = review.inputs_for(connection, team["project"], UUID(control), 1)
    by_code = {unit.code: unit for unit in inputs.units}
    assert by_code[custom].needs is None
    listing = codes["ac03-listing"]
    assert by_code[listing].needs == ("POPULATION",)
    # An approver question on the custom attribute is asked, never assumed by a needs set.
    approver = {"topic": "Reviewer", "text": "Who signs off the review?", "fact": "APPROVER",
                "blocks": "The criterion names the reviewer.", "suggested": "The CFO.",
                "options": ["The CFO.", "The controller."]}  # fmt: skip
    # The other units' ESTABLISHED verdicts cite what establishes their needs (owner-approved
    # F1, 18 November 2026; old: they rested on nothing, which the check now refuses). Read
    # once corrected (strict False): what this test is about is the custom attribute's
    # question, whatever the inputs of this synthetic control give the others to cite.
    verdicts = [
        {"attribute": unit.key, "verdict": "NOT_ESTABLISHED", "rests_on": [],
         "question": approver}
        if unit.code == custom
        else {"attribute": unit.key, "verdict": "ESTABLISHED",
              **review.verdict_support(inputs.data, unit.key)}
        for unit in inputs.units
    ]  # fmt: skip
    answer = review.Answer.model_validate(
        {
            "narrative": "The answers do not yet establish who signs off the review.",
            "marked": [],
            "verdicts": verdicts,
            "follow_ups": [],
        }
    )
    [asked] = [
        item
        for item in review.check(answer, inputs.units, inputs.parents, 1, False, inputs.texts).asked
        if item.code == custom
    ]
    assert (asked.code, asked.fact, asked.assume_only) == (custom, "APPROVER", False)


# Design review, 19 November 2026 (S5), decided the same day (Option B): the review's
# support said the listing's count is agreed to the system, from a question the person
# answered, while "Population for testing" still told the walkthrough's "No".


def test_a_later_answer_on_a_fact_holds_over_the_walkthrough_sentence(
    migrated: Database,
) -> None:
    team, control, _scheduler, client = _ready(migrated, "uqf-later", AC03)
    _answer_required(migrated, team, control, client)
    item = walkthrough_questions.question(LISTING_CHECK)
    assert item is not None
    told = item.narrative_no

    def section(name: str) -> list[dict[str, Any]]:
        read = client.get(f"{_path(team, control)}/understanding/review")
        assert read.status_code == 200, read.text
        [topic] = [t for t in read.json()["narrative"] if t["topic"] == name]
        return list(topic["parts"])

    def population() -> list[dict[str, Any]]:
        return section("POPULATION")

    # The coverage (SCOPE), on the same attribute and the same kind of fact (POPULATION).
    def coverage() -> list[str]:
        return [part["text"] for part in section("SCOPE") if part["key"] == COVERAGE]

    scope = coverage()
    assert scope

    # The walkthrough's "No" tells the listing check.
    assert {"text": told, "key": LISTING_CHECK, "answered_at": None} in population()
    with connect(migrated.url) as connection:
        [(code,)] = connection.execute(
            "SELECT code FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' AND definition_key = 'ac03-listing'",
            (UUID(control),),
        ).fetchall()

    def answered(parent: str, mark: str) -> UUID:
        """A person's answer to the specialist's listing question, on the attribute and the
        fact it asks; `parent`: the walkthrough question it follows, "" for none."""
        with connect(migrated.url) as connection:
            [(made,)] = connection.execute(
                """
                INSERT INTO control_context_issues (
                    organization_id, project_id, engagement_control_id, origin, kind, topic,
                    detail, fingerprint, raised_by, status, resolution_note, resolved_by,
                    resolved_at, question, asks_code, asks_fact, asks_parent_key
                )
                VALUES (%s, %s, %s, 'ATTRIBUTES', 'MISSING', 'Listing completeness', %s, %s,
                        'AGENT', 'RESOLVED', %s, %s, clock_timestamp(), %s, %s, 'POPULATION',
                        %s)
                RETURNING id
                """,
                (team["org"], team["project"], UUID(control), LISTING, mark, COMPARED,
                 team["owner_id"], LISTING, code, parent),
            ).fetchall()  # fmt: skip
            connection.commit()
        return UUID(str(made))

    # Final design review, 19 November 2026 (N1). A question on the attribute and the fact
    # alone does not say which walkthrough question it answers (the coverage and the listing
    # check both record POPULATION on ac03-listing): nothing is replaced.
    answered("", "uqf-later-listing")
    assert {"text": told, "key": LISTING_CHECK, "answered_at": None} in population()
    assert coverage() == scope
    # As the specialist raised it: a follow-up of the coverage answer (asks_parent_key). It
    # adds to the coverage, never replaces it, which leaves the listing check as the one
    # question it answers.
    issue = answered(COVERAGE, "uqf-later-listing-follow-up")
    # Answered later by a person on that fact: the sentence follows that answer, dated,
    # once, and the walkthrough's sentence is no longer told; the coverage stays as told.
    after = population()
    assert told not in [part["text"] for part in after]
    [later] = [part for part in after if part["answered_at"] is not None]
    assert (later["text"], later["key"]) == (COMPARED, None)
    assert coverage() == scope
    # An answer older than the walkthrough's does not hold over it (holds_over: the later).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET resolved_at = clock_timestamp() - "
            "interval '30 days' WHERE id = %s",
            (issue,),
        )
        connection.commit()
    assert {"text": told, "key": LISTING_CHECK, "answered_at": None} in population()
