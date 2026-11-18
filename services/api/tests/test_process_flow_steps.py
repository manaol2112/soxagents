"""The process flow as a diagram (decided by the product owner on 27 October 2026): each
step's title, the decisions where the process branches and where each answer leads, and
the records each step leaves, checked before they are kept."""

from ai_workforce_api import process_narrative, process_understanding
from ai_workforce_api.process_understanding import (
    FLOW_STEP_REQUIRED,
    FLOW_STEP_RULES,
    MAX_EVIDENCE,
    PROCESS_SCHEMA,
    Step,
    checked_steps,
)


def _step(description: str, **extra: object) -> Step:
    return Step.model_validate({"description": description, "basis": "INFERRED", **extra})


def test_a_decision_keeps_where_each_answer_leads() -> None:
    steps = checked_steps(
        [
            _step("Employee submits an access request.", title="Submit access request"),
            _step("Manager approves or refuses.", title="Approved?", kind="DECISION", yes=3, no=1),
            _step("Administrator grants the role.", title="Provision approved role"),
        ],
        [],
    )
    assert [(s.title, s.kind, s.yes, s.no) for s in steps] == [
        ("Submit access request", "STEP", 0, 0),
        ("Approved?", "DECISION", 3, 1),
        ("Provision approved role", "STEP", 0, 0),
    ]


def test_branches_follow_their_steps_when_a_step_is_dropped() -> None:
    steps = checked_steps(
        [
            _step("Employee submits an access request."),
            _step(""),  # dropped: no description
            _step("Manager approves?", kind="DECISION", yes=4, no=1),
            _step("Administrator grants the role."),
        ],
        [],
    )
    # Keys keep the numbers given; the diagram numbers steps by position, and the branches
    # follow: step 4 is now the third step, step 1 stays the first.
    assert [s.key for s in steps] == ["s1", "s3", "s4"]
    assert (steps[1].yes, steps[1].no) == (3, 1)


def test_a_branch_to_nowhere_or_to_itself_continues() -> None:
    steps = checked_steps(
        [
            _step("Request."),
            _step("Approved?", kind="DECISION", yes=2, no=9),
            _step("Grant."),
            _step("Ordinary step with a stray branch.", yes=1, no=1),
        ],
        [],
    )
    # Its own number and a step that does not exist lead nowhere: it is an ordinary step.
    assert (steps[1].kind, steps[1].yes, steps[1].no) == ("STEP", 0, 0)
    # Only a decision branches.
    assert (steps[3].yes, steps[3].no) == (0, 0)


def test_titles_and_evidence_are_cleaned() -> None:
    steps = checked_steps(
        [
            _step(
                "Administrator grants the role.",
                title="  Provision   approved role ",
                evidence=[" Approved ticket ", "Approved ticket", ""],
            )
        ],
        [],
    )
    assert steps[0].title == "Provision approved role"
    assert steps[0].evidence == ["Approved ticket"]
    assert MAX_EVIDENCE == 3


def test_both_agents_answer_with_the_diagram_fields() -> None:
    step_schema = PROCESS_SCHEMA["properties"]["steps"]["items"]
    for field in FLOW_STEP_REQUIRED:
        assert field in step_schema["required"]
        assert field in process_narrative._STEP_SCHEMA["required"]
    assert FLOW_STEP_RULES in process_understanding.SYSTEM_PROMPT
    assert FLOW_STEP_RULES in process_narrative.DRAFTER_PROMPT
    assert FLOW_STEP_RULES in process_narrative.REVIEWER_PROMPT
    # Room for seven sections and fifteen diagram steps.
    assert process_narrative.DRAFT_TOKENS >= 16000
