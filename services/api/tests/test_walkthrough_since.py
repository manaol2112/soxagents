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

from typing import Any
from uuid import UUID

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
