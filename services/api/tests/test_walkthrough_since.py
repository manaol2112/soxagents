"""A question added to the walkthrough bank does not disturb finished work (B1k and B1l,
agreed by the product owner on 16 November 2026, docs/control-workflow-plan.md).

The questions B1k added (Question.since) are required of a control still in progress, and
hold its Control Understanding until answered. They never hold a control whose attributes
are accepted (it counts as completed), nor one whose understanding is completed
(engagement_controls.understanding_completed_at, migration 0172), whatever the day (since the
review of B1k, 16 November 2026; before, only one completed before the day they were added).
A question in the bank from the start holds every control as before.

Database tests: walkthrough_answers.unanswered_required, the engagement-wide read and the
one control's, and the waits of Control Understanding it feeds."""

from datetime import date
from typing import Any
from uuid import UUID

import pytest
from support import Database, settle_attributes, walkthrough_value
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _project, _rows

from ai_workforce_api.control_context import attributes_accepted
from ai_workforce_api.control_design import ValuesBody, design_for, set_values
from ai_workforce_api.db import connect
from ai_workforce_api.phase_release import understanding_waits
from ai_workforce_api.walkthrough_answers import (
    _finished,
    answers_of,
    questions_asked,
    stands,
    unanswered_required,
)
from ai_workforce_api.walkthrough_questions import B1K_ADDED, question

__all__ = ["migrated", "_session"]

CM06, CM05, AC07, AC02 = "ITGC-CM-06", "ITGC-CM-05", "ITGC-AC-07", "ITGC-AC-02"
PATCHING_ADDED = ("wt-cm06-who-applies", "wt-cm06-change-link", "wt-cm06-unapproved")
# A required question of the bank from the start, left unanswered on ITGC-AC-02.
OLD_LEFT = "wt-ac02-leaver-list"


def _facts(migrated: Database, control: str) -> tuple[UUID, str, str, str]:
    row = _rows(
        migrated,
        "SELECT library_key, coalesce(nature, ''), coalesce(frequency, '') "
        "FROM engagement_controls WHERE id = %s",
        UUID(control),
    )[0]
    return UUID(control), str(row[0]), str(row[1]), str(row[2])


def _answer_all_but(
    migrated: Database, team: dict[str, Any], control: str, left: tuple[str, ...] = ()
) -> None:
    """Answer every required question asked, through the route, except those added by B1k
    and those named: a follow-up an answer opens is answered too."""
    for _round in range(5):
        with connect(migrated.url) as connection:
            rows = answers_of(connection, UUID(control))
            waiting = [
                item
                for item in questions_asked(connection, UUID(control), rows)
                if item.required
                and not stands(rows.get(item.key), item)
                and item.since is None
                and item.key not in left
            ]
        if not waiting:
            return
        saved = team["owner"].put(
            f"{_project(team)}/controls/{control}/walkthrough-answers",
            json={
                "answers": {
                    item.key: {"value": walkthrough_value(item), "not_applicable": False}
                    for item in waiting
                }
            },
        )
        assert saved.status_code == 200, saved.text
    raise AssertionError("the walkthrough did not settle")


def _values_and_questions_answered(migrated: Database, team: dict[str, Any], control: str) -> None:
    """Everything else Control Understanding asks: its open questions resolved and the
    statement's values recorded (as test_walkthrough_answers does)."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', "
            "resolution_note = 'Answered in the walkthrough.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND status = 'OPEN'",
            (control,),
        )
        connection.commit()
        design = design_for(connection, UUID(control))
        assert design is not None
        values = {
            slot.key: slot.options[0] if slot.options else "The IT security manager"
            for slot in design.slots
            if not slot.automatic and not slot.document and not slot.value.strip()
        }
        if values:
            set_values(
                connection, team["org"], team["project"], UUID(control), team["owner_id"],
                ValuesBody(values=values),
            )  # fmt: skip


def _complete_on(migrated: Database, control: str, when: str) -> None:
    """The control's understanding recorded as completed at `when` (set once, as 0172 keeps
    it)."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET understanding_completed_at = %s::timestamptz "
            "WHERE id = %s AND understanding_completed_at IS NULL",
            (when, UUID(control)),
        )
        connection.commit()
    completed = _rows(
        migrated,
        "SELECT understanding_completed_at::date FROM engagement_controls WHERE id = %s",
        UUID(control),
    )[0][0]
    assert str(completed) == when[:10]


def _accept_attributes(migrated: Database, control: str) -> None:
    """A person's criteria on every approved attribute of the control (as tailor_criteria does
    for an engagement), so its attributes are accepted."""
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE control_attributes a
            SET condition = 'As the attribute states, at this organization: ' || left(a.text, 200),
                pass_criteria = 'The evidence shows: ' || left(a.text, 200),
                fail_criteria = 'The evidence shows it is not so: ' || left(a.text, 200),
                criteria_origin = 'PERSON', version = a.version + 1
            WHERE a.engagement_control_id = %s AND a.status = 'APPROVED'
            """,
            (UUID(control),),
        )
        connection.commit()


def _held(migrated: Database, team: dict[str, Any], controls: list[str]) -> dict[UUID, int]:
    facts = [_facts(migrated, control) for control in controls]
    with connect(migrated.url) as connection:
        every = unanswered_required(connection, team["project"], facts)
        # The one control's read agrees with the engagement-wide one.
        for fact in facts:
            one = unanswered_required(connection, team["project"], [fact], fact[0])
            assert one == ({fact[0]: every[fact[0]]} if fact[0] in every else {}), fact
    return every


def test_a_question_added_later_holds_a_control_in_progress_only(migrated: Database) -> None:
    team = _launched(migrated, "wt-since")
    settle_attributes(migrated, team["project"])
    ids = {ref: str(_control(team, ref)["id"]) for ref in (CM06, CM05, AC07, AC02)}
    for ref, control in ids.items():
        _values_and_questions_answered(migrated, team, control)
        _answer_all_but(migrated, team, control, (OLD_LEFT,) if ref == AC02 else ())
    for key in (*PATCHING_ADDED, "wt-cm05-data-owner", "wt-ac07-removal-record"):
        added = question(key)
        assert added is not None and added.since == B1K_ADDED and added.required, key
    cm06, cm05, ac07, ac02 = (UUID(ids[ref]) for ref in (CM06, CM05, AC07, AC02))

    # In progress: every control is held by what B1k added, as well as by the old question
    # left on ITGC-AC-02 (its follow-up on local accounts, opened by "No", added by B1k).
    with connect(migrated.url) as connection:
        rows = answers_of(connection, ac02)
        assert "wt-ac02-account-mapping" in {
            item.key for item in questions_asked(connection, ac02, rows)
        }
    controls = [ids[ref] for ref in (CM06, CM05, AC07, AC02)]
    assert _held(migrated, team, controls) == {cm06: 3, cm05: 1, ac07: 1, ac02: 2}
    with connect(migrated.url) as connection:
        waits = understanding_waits(connection, team["project"])
    assert waits[cm06] == (
        "Control Understanding is not complete: 3 walkthrough questions are not answered."
    )
    assert waits[cm05] == (
        "Control Understanding is not complete: 1 walkthrough question is not answered."
    )

    # Completed before the questions were added: ITGC-CM-05 and ITGC-AC-02 are not held by
    # them; the question in the bank from the start still holds ITGC-AC-02.
    _complete_on(migrated, ids[CM05], "2026-11-10T12:00:00+00:00")
    _complete_on(migrated, ids[AC02], "2026-11-10T12:00:00+00:00")
    # Attributes accepted, never completed: ITGC-AC-07 counts as completed.
    _accept_attributes(migrated, ids[AC07])
    with connect(migrated.url) as connection, connection.cursor() as cursor:
        assert attributes_accepted(cursor, ac07)
        assert not attributes_accepted(cursor, cm06)
        # The engagement-wide read of acceptance agrees with the control's own.
        finished = _finished(connection, team["project"], [cm06, cm05, ac07, ac02])
        assert set(finished) == {cm06, cm05, ac07, ac02}
        for each, (_day, accepted) in finished.items():
            assert accepted == attributes_accepted(cursor, each), each
    assert finished[cm05] == (B1K_ADDED.replace(day=10), False)
    assert finished[cm06] == (None, False)
    assert _held(migrated, team, controls) == {cm06: 3, ac02: 1}
    with connect(migrated.url) as connection:
        waits = understanding_waits(connection, team["project"])
        assert understanding_waits(connection, team["project"], cm05) == {}
    assert cm05 not in waits and ac07 not in waits
    assert waits[ac02] == (
        "Control Understanding is not complete: 1 walkthrough question is not answered."
    )

    # Rewritten after the review of B1k (16 November 2026; B1l point 2 and B1j point 2: a
    # completion is never reopened). Old: completed the day the questions were added, they
    # were taken to have been asked before it and still held ITGC-CM-06 ({cm06: 3, ac02: 1}).
    # New: a completed control is never held by a question added later, whatever the day.
    _complete_on(migrated, ids[CM06], "2026-11-16T18:00:00+00:00")
    assert _held(migrated, team, controls) == {ac02: 1}
    # Answered: nothing holds ITGC-CM-06 any more, and the answers stand as given.
    saved = team["owner"].put(
        f"{_project(team)}/controls/{ids[CM06]}/walkthrough-answers",
        json={
            "answers": {
                key: {"value": walkthrough_value(question(key)), "not_applicable": False}
                for key in PATCHING_ADDED
            }
        },
    )
    assert saved.status_code == 200, saved.text
    assert _held(migrated, team, controls) == {ac02: 1}
    with connect(migrated.url) as connection:
        rows = answers_of(connection, cm06)
    assert all(stands(rows.get(key), question(key)) for key in PATCHING_ADDED)


def test_a_control_waiting_only_on_questions_from_the_start_is_counted_as_before(
    migrated: Database,
) -> None:
    # Completed long ago or not, a required question in the bank from the start holds the
    # control until it is answered: the since rule changes nothing for it.
    team = _launched(migrated, "wt-since-old")
    settle_attributes(migrated, team["project"])
    control = str(_control(team, CM06)["id"])
    _values_and_questions_answered(migrated, team, control)
    with connect(migrated.url) as connection:
        asked = questions_asked(connection, UUID(control))
        before = unanswered_required(connection, team["project"], [_facts(migrated, control)])
    old = [item for item in asked if item.required and item.since is None]
    added = [item for item in asked if item.required and item.since is not None]
    assert old and _keys(added) == list(PATCHING_ADDED)
    assert before == {UUID(control): len(old) + len(added)}
    _complete_on(migrated, control, "2026-11-01T09:00:00+00:00")
    with connect(migrated.url) as connection:
        after = unanswered_required(connection, team["project"], [_facts(migrated, control)])
        # No control named: nothing to read.
        assert _finished(connection, team["project"], []) == {}
    assert after == {UUID(control): len(old)}


def _keys(items: list[Any]) -> list[str]:
    return [str(item.key) for item in items]


# SOC 1, no report (owner decision, 19 November 2026, the interim fix of SOL's defect 5):
# after "No SOC 1 report" nothing asks about the report, and one required question records
# how the team will obtain evidence over the service organization's part. Added later
# (since), so a completed understanding is not reopened. Invariants: I3 and I7 in part (no
# reliance is narrated from a report that does not exist; the evidence approach is a
# person's answer). The new names are read inside the tests, so this file still loads
# without the change.

NO_REPORT = "wt-service-org-no-report"
NO_REPORT_OPTIONS = (
    "Test the service organization's controls directly",
    "Rely on another assurance report (for example SOC 2 or ISAE 3402)",
    "Test the user entity's own controls over the outsourced work",
    "For the audit team to decide",
)
REPORTS = (
    "A SOC 1 Type 2 report covering the period",
    "A SOC 1 Type 2 report covering part of the period (bridge letter needed)",
    "A SOC 1 Type 1 report only",
)


def _service(report: str) -> dict[str, str]:
    return {"wt-service-org": "Yes", "wt-service-org-report": report}


def test_no_soc_1_report_asks_how_the_provider_is_evidenced_not_about_its_report() -> None:
    from ai_workforce_api import walkthrough_questions as bank

    for scope in bank._scopes():
        asked = bank.applicable(bank.questions_for(scope), _service("No SOC 1 report"))
        keys = [item.key for item in asked]
        assert NO_REPORT in keys, scope
        assert keys.index(NO_REPORT) == keys.index("wt-service-org-report") + 1, scope
        assert not [item.key for item in asked if "in its report" in item.text], scope
        for report in REPORTS:
            opened = bank.applicable(bank.questions_for(scope), _service(report))
            assert NO_REPORT not in [item.key for item in opened], (scope, report)
        # Not opened either when no service organization takes part.
        closed = bank.applicable(
            bank.questions_for(scope), {**_service("No SOC 1 report"), "wt-service-org": "No"}
        )
        assert NO_REPORT not in [item.key for item in closed], scope
    added = bank.question(NO_REPORT)
    assert added is not None
    assert (added.kind, added.topic, added.required, added.allows_other) == (
        "CHOICE", "SERVICE_ORG", True, True,
    )  # fmt: skip
    assert added.when == ("wt-service-org-report", "No SOC 1 report")
    assert added.options == NO_REPORT_OPTIONS
    assert added.since == bank.SOC1_NO_REPORT_ADDED == date(2026, 11, 19)
    # It reaches the team's evidence decision: what is requested and what is tested.
    assert set(added.informs) == {"RELIANCE", "EVIDENCE"}
    assert set(added.drives) >= {"EVIDENCE", "SCOPE"}
    # The details question no longer presumes a report.
    detail = bank.question("wt-service-org-detail")
    assert detail is not None and "report" not in detail.text and "report" not in detail.why
    assert bank.problems() == []


def _service_parts(bank: Any, asked: Any, answers: dict[str, str]) -> list[Any]:
    return [parts for topic, parts in bank.narrate(asked, answers) if topic == "SERVICE_ORG"]


def test_the_no_report_answer_reads_as_the_teams_evidence_decision() -> None:
    from ai_workforce_api import walkthrough_questions as bank

    asked = bank.questions_for("change-approval")
    told = []
    for answer in (*NO_REPORT_OPTIONS, f"{bank.OTHER}A bridge letter and a site visit"):
        answers = {**_service("No SOC 1 report"), NO_REPORT: answer}
        [service] = [
            parts for topic, parts in bank.narrate(asked, answers) if topic == "SERVICE_ORG"
        ]
        assert [key for _text, key in service if key] == [
            "wt-service-org", "wt-service-org-report", NO_REPORT,
        ]  # fmt: skip
        told.append("".join(text for text, key in service if key == NO_REPORT))
        # Rewritten 19 November 2026 (design review). Old: "Without a SOC 1 report, the
        # approach to evidence over the service organization's part is as follows: {answer}."
        # New: "Evidence over the service organization's part: {answer}." Why: the parent's
        # sentence directly before already says there is no SOC 1 report, and "is as
        # follows: for the audit team to decide" was not a sentence.
        sentence = "".join(text for text, _key in service).split(". ")[-1]
        assert sentence.startswith("Evidence over the service organization's part: "), sentence
        assert sentence.endswith(".") and sentence.count("SOC 1") == 0, sentence
        assert "complementary user entity controls relied on" not in sentence
    assert told == [
        "test the service organization's controls directly",
        "rely on another assurance report (for example SOC 2 or ISAE 3402)",
        "test the user entity's own controls over the outsourced work",
        "for the audit team to decide",
        "a bridge letter and a site visit",
    ]
    answers = {**_service("No SOC 1 report"), NO_REPORT: NO_REPORT_OPTIONS[0]}
    [service] = _service_parts(bank, asked, answers)
    assert "".join(text for text, _key in service).endswith(
        "The service organization provides no SOC 1 report. Evidence over the service "
        "organization's part: test the service organization's controls directly."
    )
    # A report chosen later: the no-report answer is no longer told.
    answers["wt-service-org-report"] = REPORTS[0]
    [service] = _service_parts(bank, asked, answers)
    assert NO_REPORT not in [key for _text, key in service]


def test_the_no_report_question_holds_only_a_control_in_progress() -> None:
    from ai_workforce_api.walkthrough_answers import holds

    added = question(NO_REPORT)
    assert added is not None
    assert holds(added, None, False) is True
    assert holds(added, date(2026, 11, 19), False) is False
    assert holds(added, date(2026, 11, 1), False) is False
    assert holds(added, None, True) is False


def test_a_follow_up_is_still_reported_away_from_its_parent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The order check takes a follow-up after its parent or anything under its parent
    # (the bank's first follow-up of a follow-up, 19 November 2026), and still reports one
    # that something else separates from its parent.
    from ai_workforce_api import walkthrough_questions as bank

    real = bank.questions_for
    assert bank._order("change-approval", "", "") == []
    assert question(NO_REPORT) is not None

    def moved(key: str) -> Any:
        def ordered(scope: str, nature: str = "", frequency: str = "") -> tuple[Any, ...]:
            asked = list(real(scope, nature, frequency))
            item = next(each for each in asked if each.key == key)
            asked.remove(item)
            after = next(at for at, each in enumerate(asked) if each.key == "wt-service-org-detail")
            asked.insert(after + 1, item)
            return tuple(asked)

        return ordered

    # The no-report question after the details question, which is not under the report.
    monkeypatch.setattr(bank, "questions_for", moved(NO_REPORT))
    assert f"{NO_REPORT}: not directly after its parent for change-approval" in bank._order(
        "change-approval", "", ""
    )
    # A direct follow-up after a question of another topic is reported too.
    monkeypatch.setattr(bank, "questions_for", real)
    asked = list(real("change-approval"))
    vendor = next(each for each in asked if each.key == "wt-cm-vendor-changes")
    asked.remove(vendor)
    asked.append(vendor)
    monkeypatch.setattr(bank, "questions_for", lambda *_args: tuple(asked))
    assert "wt-cm-vendor-changes: not directly after its parent for change-approval" in bank._order(
        "change-approval", "", ""
    )


def test_one_save_closes_or_opens_the_no_report_question_with_its_parents(
    migrated: Database,
) -> None:
    team = _launched(migrated, "wt-soc1-none")
    control = str(_control(team, CM06)["id"])
    path = f"{_project(team)}/controls/{control}/walkthrough-answers"

    def save(answers: dict[str, str]) -> Any:
        return team["owner"].put(
            path,
            json={
                "answers": {
                    key: {"value": value, "not_applicable": False} for key, value in answers.items()
                }
            },
        )

    def stored() -> dict[str, str]:
        with connect(migrated.url) as connection:
            rows = answers_of(connection, UUID(control))
        return {key: row.value for key, row in rows.items() if key.startswith("wt-service-org")}

    # No service organization: the report and the no-report answer under it are both closed
    # by the same save (the parent of the no-report question is itself closed), so neither
    # is stored.
    closed = save(
        {"wt-service-org": "No", "wt-service-org-report": "No SOC 1 report",
         NO_REPORT: NO_REPORT_OPTIONS[3]}
    )  # fmt: skip
    assert closed.status_code == 200, closed.text
    assert closed.json() == {"saved": 1, "ignored": 2}
    assert stored() == {"wt-service-org": "No"}
    # A service organization with no report: the report and its follow-up in one save.
    assert save({"wt-service-org": "Yes"}).status_code == 200
    with connect(migrated.url) as connection:
        rows = answers_of(connection, UUID(control))
        asked = {item.key: item for item in questions_asked(connection, UUID(control), rows)}
    assert NO_REPORT not in asked
    opened = save({"wt-service-org-report": "No SOC 1 report", NO_REPORT: NO_REPORT_OPTIONS[0]})
    assert opened.status_code == 200, opened.text
    assert opened.json() == {"saved": 2, "ignored": 0}
    with connect(migrated.url) as connection:
        rows = answers_of(connection, UUID(control))
        asked = {item.key: item for item in questions_asked(connection, UUID(control), rows)}
    assert asked[NO_REPORT].required and stands(rows.get(NO_REPORT), asked[NO_REPORT])
    # A report chosen later: no longer asked, and its answer stays on record as given.
    assert save({"wt-service-org-report": REPORTS[0]}).status_code == 200
    with connect(migrated.url) as connection:
        rows = answers_of(connection, UUID(control))
        asked = {item.key: item for item in questions_asked(connection, UUID(control), rows)}
    assert NO_REPORT not in asked
    assert stored()[NO_REPORT] == NO_REPORT_OPTIONS[0]
    # The no-report answer alone, with a report on record, is refused: it is not asked.
    refused = save({NO_REPORT: NO_REPORT_OPTIONS[1]})
    assert refused.status_code == 409, refused.text
