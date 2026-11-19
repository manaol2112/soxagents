"""The Attributes step to review (attributes-review, 19 November 2026).

A second control of the seeded engagement (ITGC-AC-02) whose understanding is complete and
whose approved attributes carry criteria the agent tailored, none accepted yet: the state
the "Review attributes" redesign opens on. Two attributes rest on an assumption the agent
stated and no person confirmed; one attribute has a long wording, to show how a long row
wraps.

Built with the test suite's own helpers, as the API tests build the same state
(tests/test_understanding_once.py: the understanding completed once, the criteria marked as
the agent's, the assumptions recorded through attribute_assumptions.record).
"""

from typing import Any
from uuid import UUID

from test_attributes_follow_understanding import _answer_required
from test_evidence_plans import _control
from test_understanding_once import _assume, _completed_now
from test_walkthrough_answers import _values_and_questions_answered

from ai_workforce_api.db import connect

CONTROL = "ITGC-AC-02"

# Synthetic criteria, one set per attribute in list order (the rest reuse the last).
CRITERIA = [
    (
        "For each sampled grant in the system log, a request in the access request tool "
        "names the same user and the same role as the grant.",
        "A request names this user and this access.",
        "A grant was made with no request, or the request names different access.",
        True,
    ),
    (
        "For each sampled grant, the request shows approval by the user's manager, and by "
        "the application owner where the policy requires it.",
        "The manager approved, and the application owner too where the policy requires it.",
        "An approval is missing, or was given by someone other than the manager or the "
        "application owner.",
        True,
    ),
    (
        "The approval date on the request is compared with the grant date in the log.",
        "The approval is dated on or before the grant.",
        "The access was granted before it was approved.",
        False,
    ),
]

LONG_TEXT = (
    "The access granted in the system is the access that was approved, and no more: the "
    "role, the permission set, the company codes and the organisational units in the log "
    "match the request line by line, including any emergency elevation granted at quarter end"
)


def build(seed: Any) -> None:
    control = _control(seed.database, seed.team, CONTROL)
    _values_and_questions_answered(seed.database, seed.team, control)
    _answer_required(seed.database, seed.team, control, seed.client)
    _completed_now(seed.database, control)
    with connect(seed.database.url) as connection:
        rows = connection.execute(
            "SELECT id, code FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position, created_at",
            (UUID(control),),
        ).fetchall()
        assert len(rows) >= 3, f"{CONTROL} has {len(rows)} approved attributes"
        for index, (attribute_id, _code) in enumerate(rows):
            condition, passes, fails, judgment = CRITERIA[min(index, len(CRITERIA) - 1)]
            connection.execute(
                "UPDATE control_attributes SET criteria_origin = 'AGENT', condition = %s, "
                "pass_criteria = %s, fail_criteria = %s, judgment_required = %s, "
                "criteria_accepted_by = NULL, criteria_accepted_at = NULL WHERE id = %s",
                (condition, passes, fails, judgment, attribute_id),
            )
        connection.execute(
            "UPDATE control_attributes SET text = %s WHERE id = %s", (LONG_TEXT, rows[2][0])
        )
        connection.commit()
    codes = [str(row[1]) for row in rows]
    _assume(
        seed.database, seed.team, control, "Role mapping",
        "The client maps the business terms used in requests to the system's roles.",
        [codes[0]],
    )  # fmt: skip
    _assume(
        seed.database, seed.team, control, "Application owner approval",
        "The policy requires the application owner's approval for privileged roles.",
        [codes[1]],
    )  # fmt: skip
    seed.add(
        "attributes-review",
        seed.href(section="controls", control=control, step="attributes"),
        control=CONTROL,
        attributes=len(rows),
        assumptions=2,
    )
