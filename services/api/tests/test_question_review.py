"""An independent agent turns every agent's question into a short interview before a person sees
it (product owner, 4 November 2026: "the same workflow as how turbotax does it"): one short
question on each screen and the next chosen by the answer. It adds no fact, deterministic checks
hold its answer, and a question it could not clear says so.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any
from uuid import UUID

from support import Database
from test_control_context import _context, _control, _new_control
from test_evidence_analysis import _Provider
from test_evidence_intake import _engagement
from test_narrative_review import _ask, _clean, _codes, _point, _run, _sections, _steps
from test_outbound import migrated
from test_testing_engine import _base

import ai_workforce_api
from ai_workforce_api.context_routes import review_control
from ai_workforce_api.db import connect
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.process_narrative import DRAFTER_PROMPT
from ai_workforce_api.question_review import (
    INTERVIEW_PROMPT,
    INTERVIEW_REVIEW_PROMPT,
    MAX_SAYS,
    interview_problems,
    invented,
    review_open_questions,
    statement_along_usual,
)

__all__ = ["migrated"]

QUESTION = "Are contractors on the HR termination list?"
ON_LIST = "Contractor leavers are on the HR termination list."
OFF_LIST = "Contractor leavers are tracked outside the HR termination list."
WHY = "The answer decides which population is sampled."


def _steps_of(**over: Any) -> list[dict[str, Any]]:
    return [
        {
            "key": "s1",
            "question": QUESTION,
            "why": WHY,
            "usual": "Yes",
            "basis": "TYPICAL",
            "answers": [
                {"label": "Yes", "says": ON_LIST, "next": ""},
                {"label": "No", "says": OFF_LIST, "next": "s2"},
            ],
            **over,
        },
        {
            "key": "s2",
            "question": "Where are they tracked?",
            "why": "The other source becomes part of the population.",
            "usual": "",
            "basis": "",
            "answers": [
                {"label": "IT list", "says": "IT keeps a list of contractor leavers.", "next": ""},
                {"label": "Not tracked", "says": "Nobody tracks contractor leavers.", "next": ""},
            ],
        },
    ]


def _reviewed(ref: str = "q1", **over: Any) -> dict[str, Any]:
    return {
        "ref": ref,
        "steps": _steps_of(),
        "why": "",
        "detail": "It is unclear whether contractor leavers are on the HR list.",
        **over,
    }


def _answer(*items: dict[str, Any]) -> dict[str, Any]:
    return {"items": list(items), "fixes": ["Split the question into two steps."]}


GAP = {
    "kind": "AMBIGUOUS",
    "topic": "Contractors in scope",
    "detail": "It is unclear wether contractors leavers are on the HR list.",
    "why": "Attribute A2 needs it, so the narrative must state it.",
    "resolve": "",
    "quotes": [],
    "question": "Which contractors are in scope, and where are they tracked?",
    "proposal": "contractors are in scope",
    "proposal_basis": "TYPICAL",
    "suggestions": ["Out of scope"],
}

DRAFT = {"attributes": [], "issues": [GAP]}


def _raised(provider: _Provider, migrated: Database, ref: str) -> tuple[Any, dict[str, Any], str]:
    team, client, _scheduler = _engagement(migrated, f"question-review-{ref}")
    cid = _new_control(client, team, control_ref=f"REV-{ref}", domain="ORDER_TO_CASH")["id"]
    with connect(migrated.url) as connection:
        review_control(connection, provider, team["org"], team["project"], UUID(cid),
                       team["owner_id"])  # fmt: skip
    return client, team, cid


def _gap(client: Any, team: dict[str, Any], cid: str) -> dict[str, Any]:
    return next(
        item
        for item in _context(client, team, cid)["issues"]
        if item["topic"] == "Contractors in scope"
    )


def _problems(steps: list[dict[str, Any]]) -> str:
    return " ".join(interview_problems("MISSING", steps, ""))


def test_the_checks_read_an_interview_as_a_person_would() -> None:
    assert interview_problems("MISSING", _steps_of(), WHY) == []
    # Yes and no are welcome: short answers are the point.
    assert _steps_of()[0]["answers"][0]["label"] == "Yes"
    assert "at most 14 words" in _problems(_steps_of(question=" ".join(["word"] * 15) + "?"))
    assert "one question mark" in _problems(_steps_of(question="Who reviews it"))
    assert "one question mark" in _problems(_steps_of(question="Who? When?"))
    assert "usual must be one" in _problems(_steps_of(usual="Maybe"))
    # A long answer is what this replaced: the sentence belongs in says, not on the button.
    long_label = {"label": "The administrator runs the report daily", "says": ON_LIST, "next": ""}
    assert "5 words or fewer" in _problems(
        _steps_of(answers=[long_label, _steps_of()[0]["answers"][1]])
    )
    # The screen offers Other itself.
    catch_all = {"label": "Someone else", "says": OFF_LIST, "next": ""}
    assert "catch-all" in _problems(_steps_of(answers=[catch_all, _steps_of()[0]["answers"][0]]))
    # What says records is read without the screen.
    for says in ("Yes, they are.", "This is done monthly.", "contractors are on it.", "No period"):
        leaning = {"label": "Yes", "says": says, "next": ""}
        assert "stands alone" in _problems(
            _steps_of(answers=[leaning, _steps_of()[0]["answers"][1]])
        )
    too_long = {"label": "Yes", "says": "A" + "a" * MAX_SAYS + ".", "next": ""}
    assert "stands alone" in _problems(_steps_of(answers=[too_long, _steps_of()[0]["answers"][1]]))
    # An interview runs forward, and every step can be reached.
    backward = _steps_of()
    backward[1]["answers"][0]["next"] = "s1"
    assert "later step" in _problems(backward)
    unreachable = _steps_of(answers=[{"label": "Yes", "says": ON_LIST, "next": ""},
                                     {"label": "No", "says": OFF_LIST, "next": ""}])  # fmt: skip
    assert "never reached" in _problems(unreachable)
    assert "one to 3 steps" in _problems([])
    assert "one to 3 steps" in _problems(_steps_of() * 2)
    # Read as a paragraph in the audit file, a path must not say the same thing twice.
    repeats = _steps_of()
    repeats[1]["answers"][0]["says"] = "Contractor leavers are tracked outside the HR list by IT."
    assert "repeats the sentence" in _problems(repeats)
    # The repeat that prompted this, from a real interview.
    real = _steps_of(
        answers=[
            {"label": "Yes", "says": "The manager compares terminations with the user listing.",
             "next": "s2"},
            {"label": "No", "says": "Nobody compares terminations with the user listing.",
             "next": ""},
        ],
    )  # fmt: skip
    real[0]["usual"] = "Yes"
    real[1]["answers"][0]["says"] = (
        "The manager compares terminations with the user listing monthly."
    )
    assert "repeats the sentence" in _problems(real)
    # A short sentence sharing its subject still adds a fact: it was wrongly held back.
    assert "repeats" not in _problems(_steps_of())
    # The reason is for the auditor, not a note between agents.
    assert any(
        "naming no agent" in text
        for text in interview_problems(
            "MISSING",
            _steps_of(why="Attribute A2 requires it, so the narrative must state it."),
            "",
        )
    )
    # A conflict is decided between its sources.
    assert interview_problems("CONFLICT", [], WHY) == []
    assert interview_problems("CONFLICT", _steps_of(), "") != []


def test_the_statement_is_the_sentences_along_the_usual_answers() -> None:
    assert statement_along_usual(_steps_of()) == (ON_LIST, "TYPICAL")
    steps = _steps_of(usual="No", basis="SOURCES")
    steps[1]["usual"] = "IT list"
    assert statement_along_usual(steps) == (
        f"{OFF_LIST} IT keeps a list of contractor leavers.", "SOURCES",
    )  # fmt: skip
    # Nothing usual to say: asked open, with no statement.
    assert statement_along_usual(_steps_of(usual="")) == ("", "")
    assert statement_along_usual([]) == ("", "")


def test_a_name_or_figure_the_records_do_not_hold_is_found() -> None:
    known = "The IT Security Manager reviews Workday within 3 business days."
    assert invented("The IT Security Manager reviews Workday within 3 business days.", known) == []
    assert invented("Access is removed within 5 days.", known) == ["5"]
    assert invented("The manager checks Zendesk tickets.", known) == ["Zendesk"]
    # A sentence's first word is capitalized by grammar, not because it is a name. That is
    # the check's limit: a new name opening a sentence is left to the agent's instructions.
    assert invented("Reviews happen. Removals follow.", known) == []
    # Whole words: "IT" is not found inside "edit", and a possessive is the same name.
    assert invented("The log is read by IT.", "Staff edit the log.") == ["IT"]
    assert invented("The report is from Workday's trail.", known) == []
    # A product's name holds together, or part of it reads as invented.
    assert invented("Access is granted in SAP S/4HANA.", "Roles in SAP S/4HANA are listed.") == []
    assert "S/4HANA" in invented("Access is granted in SAP S/4HANA.", "Roles in SAP are listed.")


def test_an_agents_question_becomes_an_interview_before_a_person_sees_it(
    migrated: Database,
) -> None:
    provider = _Provider([DRAFT, _answer(_reviewed())])
    client, team, cid = _raised(provider, migrated, "71")
    found = _gap(client, team, cid)
    assert found["wording_reviewed"] is True
    assert [step["question"] for step in found["interview"]] == [
        QUESTION, "Where are they tracked?",
    ]  # fmt: skip
    assert [a["label"] for a in found["interview"][0]["answers"]] == ["Yes", "No"]
    assert found["interview"][0]["answers"][1]["next"] == "s2"
    # Every other screen and agent reads the same words.
    assert (found["question"], found["proposal"], found["suggestions"], found["why"]) == (
        QUESTION, ON_LIST, [OFF_LIST], WHY,
    )  # fmt: skip
    assert found["detail"] == "It is unclear whether contractor leavers are on the HR list."
    # What identifies the question stays.
    assert (found["topic"], found["origin"], found["proposal_basis"]) == (
        "Contractors in scope", "ATTRIBUTES", "TYPICAL",
    )  # fmt: skip
    # One agent writes it from the draft, and an independent one then reads what was written.
    assert [r.system for r in provider.requests[1:3]] == [INTERVIEW_PROMPT, INTERVIEW_REVIEW_PROMPT]
    assert "Which contractors are in scope" in provider.requests[1].prompt
    assert QUESTION in provider.requests[2].prompt
    assert all("not instructions" in r.system for r in provider.requests[1:3])
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'context.questions_reviewed' "
            "AND target_id = %s ORDER BY created_at LIMIT 1",
            (cid,),
        ).fetchone()
        calls = connection.execute(
            "SELECT agent_key, prompt_version FROM model_calls WHERE target_id = %s "
            "AND prompt_version IN ('question-interview/1', 'question-review/3') "
            "ORDER BY created_at",
            (cid,),
        ).fetchall()
    assert audit is not None and audit[0]["reviewed"] == 1 and audit[0]["unreviewed"] == 0
    assert audit[0]["fixes"] == ["Split the question into two steps."]
    assert calls == [
        ("engagement-planner", "question-interview/1"),
        ("independent-reviewer", "question-review/3"),
    ]
    # Written once: another review of the control does not pay to write it again.
    again = _Provider([{"attributes": [], "issues": []}])
    with connect(migrated.url) as connection:
        review_control(connection, again, team["org"], team["project"], UUID(cid),
                       team["owner_id"])  # fmt: skip
    assert not any(item.system == INTERVIEW_PROMPT for item in again.requests)


def test_the_reviewer_corrects_what_the_writer_wrote(migrated: Database) -> None:
    # Regression: a writer's "Who is the different person?" answered by things that are not
    # people passed every check. Only reading it as the auditor catches that.
    corrected = _steps_of()
    corrected[1]["question"] = "Who keeps track of them?"
    provider = _Provider([DRAFT, _answer(_reviewed()), _answer(_reviewed(steps=corrected))])
    client, team, cid = _raised(provider, migrated, "84")
    found = _gap(client, team, cid)
    assert found["interview"][1]["question"] == "Who keeps track of them?"
    assert found["wording_reviewed"] is True


def test_nothing_passes_without_the_reviewer(migrated: Database) -> None:
    # The writer finished and the reviewer did not: the draft stands and says so.
    provider = _Provider([DRAFT, _answer(_reviewed()), None])
    client, team, cid = _raised(provider, migrated, "85")
    found = _gap(client, team, cid)
    assert (found["wording_reviewed"], found["interview"]) == (False, [])
    assert found["question"] == GAP["question"]
    # What the reviewer returns is held to the same checks: it cannot add a fact either.
    invented_step = _steps_of()
    invented_step[0]["answers"][0]["says"] = "Contractors are recorded in Zendesk by 17 people."
    provider = _Provider([DRAFT, _answer(_reviewed()), _answer(_reviewed(steps=invented_step))])
    client, team, cid = _raised(provider, migrated, "86")
    found = _gap(client, team, cid)
    assert (found["wording_reviewed"], found["interview"]) == (False, [])
    assert "Zendesk" not in str(found)


def test_many_questions_are_written_in_small_batches(migrated: Database) -> None:
    # Regression: nine at once did not finish, and left all nine as drafted.
    issues = [{**GAP, "topic": f"Gap {at}"} for at in range(6)]
    items = [_reviewed(ref=f"q{at}") for at in range(1, 5)]
    provider = _Provider([{"attributes": [], "issues": issues[:5]}, _answer(*items)])
    client, team, cid = _raised(provider, migrated, "87")
    calls = [r for r in provider.requests if r.system == INTERVIEW_PROMPT]
    assert len(calls) >= 2
    assert all(r.prompt.count('"ref"') <= 4 for r in calls)
    opened = [i for i in _context(client, team, cid)["issues"] if i["topic"].startswith("Gap")]
    assert len(opened) == 5
    assert all(i["wording_reviewed"] for i in opened)


def test_a_question_raised_without_its_wording_gets_it(migrated: Database) -> None:
    blank = {**GAP, "question": "", "proposal": "", "proposal_basis": "", "suggestions": []}
    provider = _Provider([{"attributes": [], "issues": [blank]}, _answer(_reviewed())])
    client, team, cid = _raised(provider, migrated, "72")
    found = _gap(client, team, cid)
    assert (found["question"], found["proposal"], found["proposal_basis"]) == (
        QUESTION, ON_LIST, "TYPICAL",
    )  # fmt: skip


def test_what_fails_the_checks_goes_back_once_then_keeps_its_draft(migrated: Database) -> None:
    # Still one long sentence, then corrected on the way back with the problem named.
    bad = _reviewed(steps=_steps_of(question=" ".join(["word"] * 20) + "?"))
    provider = _Provider([DRAFT, _answer(bad), _answer(_reviewed())])
    client, team, cid = _raised(provider, migrated, "73")
    assert _gap(client, team, cid)["question"] == QUESTION
    assert "at most 14 words" in provider.requests[2].prompt
    # Failing again, the draft stands and is not passed off as reviewed. (An ITGC, so the
    # review builds no process map, whose own check would try once more.)
    stuck = _Provider([DRAFT, _answer(bad)])
    team, client, _scheduler = _engagement(migrated, "question-review-stuck")
    cid = _control(client, team, "ITGC-AC-02")["id"]
    with connect(migrated.url) as connection:
        review_control(connection, stuck, team["org"], team["project"], UUID(cid),
                       team["owner_id"])  # fmt: skip
    found = _gap(client, team, cid)
    assert found["wording_reviewed"] is False
    assert found["question"] == GAP["question"] and found["interview"] == []
    assert len([r for r in stuck.requests if r.system == INTERVIEW_PROMPT]) == 2


def test_the_agent_cannot_add_a_name_or_a_figure(migrated: Database) -> None:
    made_up = _steps_of()
    made_up[0]["answers"][0]["says"] = "Contractor leavers are recorded in Zendesk within 17 days."
    provider = _Provider([DRAFT, _answer(_reviewed(steps=made_up))])
    client, team, cid = _raised(provider, migrated, "75")
    found = _gap(client, team, cid)
    assert found["wording_reviewed"] is False
    assert found["proposal"] == "contractors are in scope"
    assert "Zendesk" in provider.requests[2].prompt and "must not be added" in (
        provider.requests[2].prompt
    )
    # Why it was held back is on record, for whoever looks into it.
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'context.questions_reviewed' "
            "AND target_id = %s ORDER BY created_at LIMIT 1",
            (cid,),
        ).fetchone()
    assert audit is not None
    assert audit[0]["held_back"][0]["topic"] == "Contractors in scope"
    assert "must not be added" in audit[0]["held_back"][0]["problems"][0]


def test_short_answers_are_not_read_as_invented_names(migrated: Database) -> None:
    # Regression: the pieces were checked joined up, so a label read as a name mid-sentence,
    # and the agent dropped "Quarterly" to pass.
    steps = _steps_of(
        usual="Quarterly",
        answers=[
            {"label": "Quarterly", "says": "The list is read every quarter.", "next": ""},
            {"label": "Annually", "says": "The list is read once a year.", "next": "s2"},
        ],
    )
    client, team, cid = _raised(_Provider([DRAFT, _answer(_reviewed(steps=steps))]), migrated, "83")
    assert _gap(client, team, cid)["wording_reviewed"] is True


def test_a_secret_never_reaches_the_screen_through_the_agent(migrated: Database) -> None:
    leaked = _steps_of()
    leaked[0]["answers"][0]["says"] = "The password=hunter2secret opens the list."
    client, team, cid = _raised(
        _Provider([DRAFT, _answer(_reviewed(steps=leaked))]), migrated, "76"
    )
    found = _gap(client, team, cid)
    assert found["wording_reviewed"] is False
    assert "hunter2secret" not in str(found)


def test_a_failed_review_is_never_passed_off_as_a_review(migrated: Database) -> None:
    client, team, cid = _raised(_Provider([DRAFT, None]), migrated, "77")
    found = _gap(client, team, cid)
    assert (found["wording_reviewed"], found["question"]) == (False, GAP["question"])
    assert found["interview"] == []
    # An answer that does not fit the shape is the same.
    client, team, cid = _raised(_Provider([DRAFT, {"nothing": True}]), migrated, "78")
    assert _gap(client, team, cid)["wording_reviewed"] is False
    # So is an interview with no steps.
    client, team, cid = _raised(_Provider([DRAFT, _answer(_reviewed(steps=[]))]), migrated, "82")
    assert _gap(client, team, cid)["wording_reviewed"] is False
    # Without a model nothing can be cleared.
    with connect(migrated.url) as connection:
        review_control(connection, None, team["org"], team["project"], UUID(cid),
                       team["owner_id"])  # fmt: skip
    assert _gap(client, team, cid)["wording_reviewed"] is False


def test_a_conflict_is_corrected_but_has_no_interview(migrated: Database) -> None:
    # Without a quote found in a source a conflict reads as unclear, so it is made one below.
    conflict = {
        "kind": "AMBIGUOUS",
        "topic": "Contractors in scope",
        "detail": "The two records disagre.",
        "why": "The deadline decides which samples pass.",
        "resolve": "",
        "quotes": [],
    }
    team, client, _scheduler = _engagement(migrated, "question-review-conflict")
    cid = _new_control(client, team, control_ref="REV-79", domain="ORDER_TO_CASH")["id"]
    with connect(migrated.url) as connection:
        review_control(connection, _Provider([{"attributes": [], "issues": [conflict]}, None]),
                       team["org"], team["project"], UUID(cid), team["owner_id"])  # fmt: skip
        connection.execute(
            "UPDATE control_context_issues SET kind = 'CONFLICT' WHERE engagement_control_id = %s",
            (cid,),
        )
        connection.commit()
        review_open_questions(
            connection,
            _Provider([_answer(_reviewed(steps=[], detail="The two records disagree.",
                                         why="The deadline decides which samples pass."))]),
            team["org"], team["project"], UUID(cid), team["owner_id"], {}, [],
        )  # fmt: skip
    found = _gap(client, team, cid)
    assert found["wording_reviewed"] is True
    assert found["detail"] == "The two records disagree."
    assert (found["question"], found["proposal"], found["suggestions"]) == ("", "", [])
    assert found["interview"] == []


class _AnsweredMeanwhile(_Provider):
    """A person answers the question, through the real route, while the agent works."""

    def __init__(self, outputs: list[Any], answer: Callable[[], None]) -> None:
        super().__init__(outputs)
        self.answer = answer

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        self.answer()
        return super().complete(request, config)


def test_a_question_answered_meanwhile_is_left_alone(migrated: Database) -> None:
    client, team, cid = _raised(_Provider([DRAFT, None]), migrated, "80")
    held = _gap(client, team, cid)

    def answer() -> None:
        if _gap(client, team, cid)["status"] == "RESOLVED":
            return
        answered = client.post(
            f"{_base(team)}/controls/{cid}/issues/{held['id']}/resolve",
            json={"status": "RESOLVED", "note": "A person answered.",
                  "version": held["version"]},
        )  # fmt: skip
        assert answered.status_code == 200, answered.text

    provider = _AnsweredMeanwhile([_answer(_reviewed())], answer)
    with connect(migrated.url) as connection:
        review_open_questions(
            connection, provider, team["org"], team["project"], UUID(cid), team["owner_id"],
            {}, [],
        )  # fmt: skip
    found = _gap(client, team, cid)
    assert (found["status"], found["resolution_note"]) == ("RESOLVED", "A person answered.")
    assert found["question"] == GAP["question"]
    assert found["wording_reviewed"] is False


def test_a_narratives_points_get_theirs_before_the_run_reads_as_finished(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "question-review-narrative")
    cid = _new_control(client, team, control_ref="REV-81", domain="ORDER_TO_CASH")["id"]
    codes = _codes(migrated, cid)
    draft = {"sections": _sections(codes), "steps": _steps(codes)}
    # The interview names HR and IT, so the draft must: this control's records do not.
    point = {
        **_point("Contractors in scope", codes),
        "question": "Are contractors on the HR list?",
        "proposal": "IT works from the HR list.",
    }
    assert _ask(migrated, team, cid)
    seen: list[str] = []

    class _Watching(_Provider):
        def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
            if request.system in (INTERVIEW_PROMPT, INTERVIEW_REVIEW_PROMPT):
                with connect(migrated.url) as connection:
                    row = connection.execute(
                        "SELECT run_status FROM process_narrative_runs "
                        "WHERE engagement_control_id = %s",
                        (cid,),
                    ).fetchone()
                seen.append(str(row[0]) if row is not None else "")
            return super().complete(request, config)

    provider = _Watching([{**draft, "questions": [point]}, _clean(False), _answer(_reviewed())])
    _run(migrated, provider, cid)
    assert seen == ["WORKING", "WORKING"]
    found = _gap(client, team, cid)
    assert (found["question"], found["wording_reviewed"]) == (QUESTION, True)
    assert len(found["interview"]) == 2
    # Still a point: answered through its round, and it holds the narrative's review.
    assert found["origin"] == "PROCESS"
    assert _context(client, team, cid)["understanding"]["review"]["passed"] is False
    answered = client.post(
        f"{_base(team)}/controls/{cid}/process/points",
        json={"items": [{"issue_id": found["id"], "version": found["version"],
                         "answer": f"{OFF_LIST} Nobody tracks contractor leavers."}]},
    )  # fmt: skip
    assert answered.status_code == 200, answered.text
    # The sentences a person's clicks mean are what the narrative's agents read next.
    with connect(migrated.url) as connection:
        note = connection.execute(
            "SELECT resolution_note FROM control_context_issues WHERE id = %s", (found["id"],)
        ).fetchone()
    assert note == (f"{OFF_LIST} Nobody tracks contractor leavers.",)


def test_every_path_that_raises_an_agents_question_is_reviewed() -> None:
    root = Path(ai_workforce_api.__file__).parent
    for module in ("control_attributes.py", "process_narrative.py", "process_understanding.py"):
        assert "review_open_questions(" in (root / module).read_text(encoding="utf-8"), module


def test_the_drafters_are_told_how_a_question_must_read() -> None:
    # Regression: the prompt's example was copied into answers that did not fit the question.
    assert "A system-enforced workflow" not in DRAFTER_PROMPT
    assert "each a short phrase" not in DRAFTER_PROMPT
    assert "naming no agent, narrative or attribute code" in DRAFTER_PROMPT
    # The form the interview's agent learns from is on another control, so it is not copied.
    assert "bank reconciliations" in INTERVIEW_PROMPT
    # The reviewer is told to read for sense, which no deterministic check can do.
    assert "actually answers its question" in INTERVIEW_REVIEW_PROMPT
    assert "usual is how a well-run control" in INTERVIEW_REVIEW_PROMPT
