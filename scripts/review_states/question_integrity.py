"""Control Understanding's questions after question integrity A (question-integrity-a,
19 November 2026).

Three controls of the seeded engagement, each opened on Control Understanding:

- service-org-no-report  ITGC-CM-06, its walkthrough answered up to its service organization
                         topic: a service organization takes part ("Yes") and the SOC 1 report
                         question is the next one asked. Saving "No SOC 1 report" opens the
                         new question on how the team obtains evidence over the provider's
                         part (wt-service-org-no-report). A check that saves it changes the
                         state: seed a new database to see it again.
- question-usual         ITGC-AC-07, one agent question raised as "from the records" with no
                         quote, then reviewed by a scripted writer and reviewer that claim the
                         records too: it reads as the usual practice (records_basis).
- question-held          ITGC-AC-03, one agent question whose scripted interview writer asks
                         about another matter in both rounds: held back (_strays), it keeps its
                         raised wording and says the wording is not checked.

Built with the test suite's own helpers and scripted models (no model key), as the API tests
build the same states (tests/test_understanding_questions_flow.py, test_walkthrough_since.py).
"""

from typing import Any
from uuid import UUID

from support import walkthrough_value
from test_attributes_follow_understanding import _path
from test_evidence_analysis import _Provider
from test_evidence_plans import _control
from test_question_review import GAP, WHY, _answer, _reviewed, _steps_of
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api import question_review
from ai_workforce_api.control_context import AnswerIssue, checked_issues, raise_issues
from ai_workforce_api.db import connect
from ai_workforce_api.walkthrough_answers import answers_of, questions_asked, stands

SERVICE_CONTROL = "ITGC-CM-06"
USUAL_CONTROL = "ITGC-AC-07"
HELD_CONTROL = "ITGC-AC-03"

VISITOR_STEPS = [
    {
        "key": "s1", "question": "Where is the office visitor register kept?", "why": WHY,
        "usual": "Reception", "basis": "TYPICAL",
        "answers": [
            {"label": "Reception", "next": "",
             "says": "The receptionist keeps the office visitor register."},
            {"label": "Security desk", "next": "",
             "says": "The security desk keeps the office visitor register."},
        ],
    }
]  # fmt: skip


def _save(seed: Any, control: str, answers: dict[str, str]) -> None:
    saved = seed.client.put(
        f"{_path(seed.team, control)}/walkthrough-answers",
        json={
            "answers": {
                key: {"value": value, "not_applicable": False} for key, value in answers.items()
            }
        },
    )
    assert saved.status_code == 200, saved.text


def _up_to_service_org(seed: Any, control: str) -> list[str]:
    """Answer, as a person does, every question asked before the service organization's,
    then "Yes" to it; returns the keys answered."""
    done: list[str] = []
    for _round in range(8):
        with connect(seed.database.url) as connection:
            rows = answers_of(connection, UUID(control))
            asked = questions_asked(connection, UUID(control), rows)
        keys = [item.key for item in asked]
        assert "wt-service-org" in keys, keys
        before = asked[: keys.index("wt-service-org")]
        waiting = {
            item.key: walkthrough_value(item)
            for item in before
            if not stands(rows.get(item.key), item)
        }
        if not waiting:
            break
        _save(seed, control, waiting)
        done.extend(waiting)
    else:
        raise AssertionError("the walkthrough before the service organization did not settle")
    _save(seed, control, {"wt-service-org": "Yes"})
    with connect(seed.database.url) as connection:
        rows = answers_of(connection, UUID(control))
        asked = questions_asked(connection, UUID(control), rows)
    keys = [item.key for item in asked]
    assert "wt-service-org-report" in keys and "wt-service-org-no-report" not in keys, keys
    return done


def _raise(seed: Any, control: str, raw: dict[str, Any]) -> None:
    with connect(seed.database.url) as connection:
        with connection.transaction():
            raise_issues(
                connection.cursor(), seed.team["org"], seed.team["project"], UUID(control),
                checked_issues([AnswerIssue.model_validate(raw)], [], "ATTRIBUTES"), "AGENT",
            )  # fmt: skip


def _review(seed: Any, control: str, provider: Any) -> None:
    with connect(seed.database.url) as connection:
        question_review.review_open_questions(
            connection, provider, seed.team["org"], seed.team["project"], UUID(control),
            seed.team["owner_id"], {}, [],
        )  # fmt: skip
        connection.commit()


def _issue(seed: Any, control: str) -> tuple[str, bool, str]:
    with connect(seed.database.url) as connection:
        row = connection.execute(
            "SELECT proposal_basis, wording_reviewed, question FROM control_context_issues "
            "WHERE engagement_control_id = %s AND topic = %s AND status = 'OPEN'",
            (UUID(control), GAP["topic"]),
        ).fetchone()
    assert row is not None
    return str(row[0]), bool(row[1]), str(row[2])


def build(seed: Any) -> None:
    service = _control(seed.database, seed.team, SERVICE_CONTROL)
    _values_and_questions_answered(seed.database, seed.team, service)
    answered = _up_to_service_org(seed, service)
    seed.add(
        "service-org-no-report",
        seed.href(section="controls", control=service, step="understanding"),
        control=SERVICE_CONTROL,
        control_id=service,
        answered_before=len(answered),
        report_key="wt-service-org-report",
        report_answer="No SOC 1 report",
        no_report_key="wt-service-org-no-report",
    )

    usual = _control(seed.database, seed.team, USUAL_CONTROL)
    _values_and_questions_answered(seed.database, seed.team, usual)
    _raise(seed, usual, {**GAP, "proposal_basis": "SOURCES"})
    sourced = _answer(_reviewed(steps=_steps_of(basis="SOURCES")))
    _review(seed, usual, _Provider([sourced]))
    basis, reviewed, _question = _issue(seed, usual)
    assert (basis, reviewed) == ("TYPICAL", True), (basis, reviewed)
    seed.add(
        "question-usual",
        seed.href(section="controls", control=usual, step="understanding"),
        control=USUAL_CONTROL,
        control_id=usual,
        topic=GAP["topic"],
        basis=basis,
    )

    held = _control(seed.database, seed.team, HELD_CONTROL)
    _values_and_questions_answered(seed.database, seed.team, held)
    _raise(seed, held, GAP)
    off = _answer(_reviewed(steps=VISITOR_STEPS))
    _review(seed, held, _Provider([off]))
    _basis, reviewed, question = _issue(seed, held)
    assert reviewed is False and question == GAP["question"], (reviewed, question)
    seed.add(
        "question-held",
        seed.href(section="controls", control=held, step="understanding"),
        control=HELD_CONTROL,
        control_id=held,
        topic=GAP["topic"],
        question=question,
    )
