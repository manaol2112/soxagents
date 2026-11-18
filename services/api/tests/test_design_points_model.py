"""The points of the D&I workpaper (docs/design-workpaper.md, section 3.9; the product
owner, 16 November 2026): the pure part, with synthetic records only. No database, no
model, no file.

Audit integrity:

- every kind of point comes from the records, with its place and the existing actions
  that settle it (CONSIDER always offered, last);
- a point's key is the same on every read while the point is the same, and new when it
  changes (a new check, other words, another request, another file);
- a person's tickmark, a decision on a file, a person's exception, a file left out by
  purpose and the agent's considerations are never points;
- a point is settled by its own action (it is no longer assembled) or by the
  consideration that stands for its key; the refusals of the preparer's and the
  reviewer's sign-off count exactly the points not settled, in their exact words.
"""

import re
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from test_design_workpaper_model import (
    ATTRIBUTES,
    F1,
    F2,
    F3,
    R1,
    R2,
    REQUESTS,
    RUN1,
    RUN2,
    A,
    B,
    C,
    D,
    _check,
    _disposed,
    _gap,
    _index,
    _item,
    _open,
    _review,
    _said,
)

from ai_workforce_api import design_points as points_module
from ai_workforce_api.attribute_dispositions import Disposition
from ai_workforce_api.design_points import (
    KEY_PATTERN,
    MAX_OBSERVATIONS,
    ConsideredBody,
    PersonBody,
    PointBody,
    observations_of,
    point_key,
    points_of,
    prepare_words,
    signoff_words,
    unsettled,
    with_considerations,
)
from ai_workforce_api.design_workpaper import (
    CheckRecord,
    FindingRecord,
    HeldFile,
    attributes_of,
    closed_by_tickmark,
    dispositions_applying,
)
from ai_workforce_api.evidence_assurance import ConsiderationBody, ReviewFollowUpBody
from ai_workforce_api.file_reliability import Decision as FileDecision

NOT_SHOWN_F2 = (
    "sap change log.txt is a report or listing that does not show its source, run date or "
    "parameters, so its completeness and accuracy are not established."
)
RECORDED_AT = datetime(2026, 11, 16, 9, 0, tzinfo=UTC)


def _points(
    checks: dict[UUID, CheckRecord],
    *,
    dispositions: Sequence[Disposition] = (),
    decisions: Sequence[FileDecision] = (),
    findings: Sequence[FindingRecord] = (),
) -> list[PointBody]:
    """The points of the records, the attributes as the view assembles them."""
    evidence = _index(checks=checks)
    _shown, left = attributes_of(
        ATTRIBUTES, REQUESTS, checks, [], evidence, None, dispositions, decisions,
    )  # fmt: skip
    applying = dispositions_applying(dispositions, checks, [])
    return points_of(
        REQUESTS, checks, ATTRIBUTES, left, findings, evidence, decisions,
        closed_by_tickmark(applying),
    )  # fmt: skip


def _decided(kind: str, file: UUID, requirement: UUID = R1) -> FileDecision:
    return FileDecision(
        id=UUID(int=880 + file.int), requirement_id=requirement, file_id=file, kind=kind,  # type: ignore[arg-type]
        reason="The owner ran the report with me and I inspected it.",
        relied_on="Watched it run." if kind == "ESTABLISHED_ON_REVIEW" else "",
        assessment_id=RUN1, recorded_by_name="Dana Lee", recorded_at=RECORDED_AT, version=1,
    )  # fmt: skip


def _considered(key: str) -> ConsideredBody:
    return ConsideredBody(
        id=UUID(int=990), by=PersonBody(id=UUID(int=991), name="Dana Lee"), at=RECORDED_AT,
        reason=f"Considered {key[:4]}: the owner confirmed it in the walkthrough.",
    )  # fmt: skip


# --- Each kind, its place and what settles it --------------------------------------------


def test_each_kind_of_point_with_its_place_and_its_settling_actions() -> None:
    review = _review(
        "RELIABILITY_UNRESOLVED",
        (NOT_SHOWN_F2, "A file is partly unreadable: page 2."),
        files=[_said(F1), _said(F2, basis="NOT_SHOWN")],
        follow_ups=[
            ReviewFollowUpBody(key=f"{B}:wording", attribute_ids=[B], kind="EVIDENCE",
                               request="Provide the line manager record.", priority="HIGH"),
            ReviewFollowUpBody(key="request", kind="EVIDENCE", priority="HIGH",
                               request="Say which tool raised the ticket."),
        ],
    )  # fmt: skip
    checks = {
        R1: _check(
            _item(A, files=(F2,)), _open(B), _item(C, summary="Shown by the ticket."),
            review=review,
        ),
        R2: _check(_gap(C), requirement=R2, run=RUN2, files=(F3, F1), status="REVIEWED"),
    }  # fmt: skip
    finding = FindingRecord(UUID(int=70), "The ticket is not the period's", F1, R1)
    found = _points(checks, findings=[finding])
    by_kind = {p.kind: p for p in found}
    assert [p.kind for p in found] == [
        "FINDING", "NOT_CONCLUDED", "CONFLICT", "COMPLETENESS", "COMPLETENESS", "FOLLOW_UP",
        "FOLLOW_UP",
    ]  # fmt: skip
    assert by_kind["FINDING"].place.model_dump() == {
        "at": "FILE", "attribute_id": None, "file_id": F1, "requirement_id": R1,
    }  # fmt: skip
    assert by_kind["FINDING"].settle == ["FINDING", "CONSIDER"]
    assert by_kind["NOT_CONCLUDED"].place.model_dump() == {
        "at": "ATTRIBUTE", "attribute_id": B, "file_id": None, "requirement_id": R1,
    }  # fmt: skip
    assert by_kind["NOT_CONCLUDED"].settle == ["TICKMARK", "CONSIDER"]
    # Shown on R1, not shown on R2 which also asks for it: at the attribute, naming R2.
    assert (by_kind["CONFLICT"].place.attribute_id, by_kind["CONFLICT"].place.requirement_id) == (
        C, R2,
    )  # fmt: skip
    assert by_kind["CONFLICT"].settle == ["TICKMARK", "CONSIDER"]
    reliability, unreadable = [p for p in found if p.kind == "COMPLETENESS"]
    # The review's reliability question is at the file it asks about, settled by a
    # decision on that file; a sentence no action answers is only considered.
    assert (reliability.text, reliability.place.at, reliability.place.file_id) == (
        NOT_SHOWN_F2, "FILE", F2,
    )  # fmt: skip
    assert reliability.settle == ["RELIABILITY", "CONSIDER"]
    assert (unreadable.place.at, unreadable.place.requirement_id) == ("REQUEST", R1)
    assert unreadable.settle == ["CONSIDER"]
    for_b, for_none = [p for p in found if p.kind == "FOLLOW_UP"]
    assert (for_b.place.at, for_b.place.attribute_id, for_b.settle) == (
        "ATTRIBUTE", B, ["TICKMARK", "CONSIDER"],
    )  # fmt: skip
    assert (for_none.place.at, for_none.settle) == ("REQUEST", ["CONSIDER"])
    # A file the check's gate held out, not by purpose: at the file; nothing but a
    # consideration settles it (a new check comes only of changed evidence).
    held = {R1: _check(_item(A), held=(HeldFile(F2, "CUSTODY", "Its custody is not shown."),))}
    [kept_out] = _points(held)
    assert (kept_out.kind, kept_out.place.at, kept_out.place.file_id, kept_out.settle) == (
        "HELD", "FILE", F2, ["CONSIDER"],
    )  # fmt: skip
    assert kept_out.text == "sap change log.txt is not part of the check. Its custody is not shown."
    # Out of date: at its request, settled by checking it again.
    stale = {R2: _check(requirement=R2, status="OUT_OF_DATE", out_of_date=("A file changed.",))}
    [told] = _points(stale)
    assert (told.kind, told.place.at, told.place.requirement_id, told.settle) == (
        "STALE", "REQUEST", R2, ["RERUN", "CONSIDER"],
    )  # fmt: skip
    # Shown only on a file not relied on: at the attribute, settled by a file decision.
    not_relied = [_decided("NOT_RELIED_ON", F2)]
    only = {R1: _check(_item(A, files=(F2,)), review=_review(files=[_said(F1), _said(F2)]))}
    [resting] = _points(only, decisions=not_relied)
    assert (resting.kind, resting.place.attribute_id, resting.settle) == (
        "NOT_RELIED", A, ["RELIABILITY", "CONSIDER"],
    )  # fmt: skip
    # Every key is 32 lowercase hexadecimal characters, CONSIDER always last.
    for point in [*found, kept_out, told, resting]:
        assert re.fullmatch(KEY_PATTERN, point.key)
        assert point.settle[-1] == "CONSIDER" and point.settle.count("CONSIDER") == 1
        assert point.considered is None


def test_a_finding_without_a_listed_file_is_at_its_request() -> None:
    on_request = FindingRecord(UUID(int=71), "Asked for the Q3 sample.", None, R2)
    off_list = FindingRecord(UUID(int=72), "A file beyond the list.", UUID(int=999), R1)
    no_request = FindingRecord(UUID(int=73), "A file with no request named.", F1, None)
    found = _points({}, findings=[on_request, off_list, no_request])
    assert [(p.place.at, p.place.file_id, p.place.requirement_id) for p in found] == [
        ("REQUEST", None, R2), ("REQUEST", None, R1), ("FILE", F1, None),
    ]  # fmt: skip


# --- Keys ---------------------------------------------------------------------------------


def test_a_key_is_stable_while_the_point_is_the_same_and_new_when_it_changes() -> None:
    assert point_key("STALE", R1) == point_key("STALE", R1)
    assert len(point_key("FINDING", UUID(int=70))) == 32
    # Kind and identity both count.
    assert point_key("STALE", R1) != point_key("FOLLOW_UP", R1)
    assert point_key("STALE", R1) != point_key("STALE", R2)
    unread = ("Page 2 is unreadable.",)
    checks = {R1: _check(_open(B), review=_review("INCOMPLETE", unread))}
    first = _points(checks)
    again = _points(checks)
    assert [p.key for p in first] == [p.key for p in again]
    # The request checked again (another run) that says the same: the same points, so a
    # consideration of them still stands (the contract: new when the point changes, as
    # when a new check has other words).
    rerun = {R1: _check(_open(B), run=RUN2, review=_review("INCOMPLETE", unread))}
    assert [p.key for p in _points(rerun)] == [p.key for p in first]
    # Other words from the check: a new completeness point; the open attribute keeps its key.
    worded = {R1: _check(_open(B), review=_review("INCOMPLETE", ("Page 3 is unreadable.",)))}
    changed = {p.kind: p.key for p in _points(worded)}
    kept = {p.kind: p.key for p in first}
    assert changed["NOT_CONCLUDED"] == kept["NOT_CONCLUDED"]
    assert changed["COMPLETENESS"] != kept["COMPLETENESS"]
    # Left open by another request: another point.
    elsewhere = {R2: _check(_open(C), requirement=R2, run=RUN2, files=(F3, F1))}
    assert _points(elsewhere)[0].key != point_key("NOT_CONCLUDED", C, R1)
    assert _points(elsewhere)[0].key == point_key("NOT_CONCLUDED", C, R2)
    # A finding keeps its key whatever its title becomes; another finding has its own.
    one = _points({}, findings=[FindingRecord(UUID(int=70), "Old title", F1, R1)])
    renamed = _points({}, findings=[FindingRecord(UUID(int=70), "New title", F1, R1)])
    other = _points({}, findings=[FindingRecord(UUID(int=71), "Old title", F1, R1)])
    assert one[0].key == renamed[0].key != other[0].key


def test_each_point_once_by_its_key() -> None:
    same = "Page 2 is unreadable."
    checks = {R1: _check(_item(A), review=_review("INCOMPLETE", (same, same)))}
    assert [p.text for p in _points(checks)] == [same]
    twice = FindingRecord(UUID(int=70), "Twice", F1, R1)
    assert len(_points({}, findings=[twice, twice])) == 1


# --- What is not a point ------------------------------------------------------------------


def test_tickmarks_decisions_exceptions_left_out_files_and_considerations_are_no_points() -> None:
    review = _review(
        "RELIABILITY_UNRESOLVED", (NOT_SHOWN_F2,),
        files=[_said(F1), _said(F2, basis="NOT_SHOWN")],
        considerations=[ConsiderationBody(text="The ticket was closed by the same admin.")],
    )  # fmt: skip
    checks = {
        R1: _check(_item(A), _gap(B), _open(C), review=review),
        R2: _check(requirement=R2, run=RUN2, status="HELD", files=(),
                   held=(HeldFile(F3, "POPULATION", "This file is a population."),)),
    }  # fmt: skip
    assert [p.kind for p in _points(checks)] == ["NOT_CONCLUDED", "COMPLETENESS"]
    settled = _points(
        checks,
        dispositions=[
            _disposed("NOT_APPLICABLE", C), _disposed("EXCEPTION", A), _disposed("NOT_AVAILABLE", B)
        ],
        decisions=[_decided("ESTABLISHED_ON_REVIEW", F2)],
    )  # fmt: skip
    # The tickmark settles the open attribute, the decision the reliability question; the
    # person's exception, the other tickmark, the decision, the file left out by purpose
    # and the consideration are none of them a point.
    assert settled == []


def test_observations_are_the_considerations_each_once_in_order_and_bounded() -> None:
    first = _review(considerations=[
        ConsiderationBody(text="The ticket was closed by the same admin who granted it."),
        ConsiderationBody(text="  The sign-on report covers 1 to 14 October only. "),
    ])  # fmt: skip
    second = _review(considerations=[
        ConsiderationBody(text="The ticket was closed by the same admin who granted it."),
        ConsiderationBody(text=""),
        ConsiderationBody(text="A third remark."),
    ])  # fmt: skip
    checks = {
        R1: _check(_item(A), review=first),
        R2: _check(_item(D), requirement=R2, run=RUN2, files=(F3, F1), review=second),
    }
    told = observations_of(REQUESTS, checks, _index(checks=checks))
    assert [o.text for o in told] == [
        "The ticket was closed by the same admin who granted it.",
        "The sign-on report covers 1 to 14 October only.",
        "A third remark.",
    ]
    many = _review(considerations=[ConsiderationBody(text=f"Remark {n}.") for n in range(25)])
    assert len(observations_of(REQUESTS, {R1: _check(_item(A), review=many)}, [])) == (
        MAX_OBSERVATIONS
    )


# --- Settled, and the refusals --------------------------------------------------------------


def test_a_consideration_settles_its_point_and_the_refusals_count_the_rest() -> None:
    findings = [
        FindingRecord(UUID(int=70), "The ticket is not the period's.", F1, R1),
        FindingRecord(UUID(int=71), "x" * 300, F1, R1),
    ]
    found = _points({}, findings=findings)
    assert len(unsettled(found)) == 2
    assert prepare_words(unsettled(found)) == (
        "Settle the points first (2): The ticket is not the period's."
    )
    assert signoff_words(unsettled(found)) == (
        "2 points were raised since the preparer signed: return it to the preparer."
    )
    # One considered: settled, and said so on the point.
    first = found[0]
    standing = {first.key: _considered(first.key)}
    attached = with_considerations(found, standing)
    assert attached[0].considered == standing[first.key] and attached[1].considered is None
    waiting = unsettled(attached)
    assert waiting == [attached[1]]
    # The first point's words are cut to 160 characters.
    words = prepare_words(waiting)
    assert words is not None
    assert words == f"Settle the points first (1): {'x' * 159}…."
    assert signoff_words(waiting) == (
        "1 point was raised since the preparer signed: return it to the preparer."
    )
    # A consideration for a key no point has is neither shown nor counted.
    stray = with_considerations(found, {"0" * 32: _considered("0" * 32)})
    assert len(unsettled(stray)) == 2
    # Everything settled: nothing is refused.
    every = with_considerations(found, {p.key: _considered(p.key) for p in found})
    assert unsettled(every) == []
    assert prepare_words([]) is None and signoff_words([]) is None


def test_the_words_written_here_never_say_the_client_nor_open() -> None:
    written = [
        points_module.POINT_CHANGED, points_module.PREPARED_ALREADY,
        prepare_words([PointBody(key="0" * 32, kind="FINDING", text="A finding.",
                                 place={"at": "REQUEST"}, settle=["CONSIDER"])]) or "",  # type: ignore[arg-type]
        signoff_words([_points({}, findings=[FindingRecord(UUID(int=1), "x", F1, R1)])[0]]) or "",
    ]  # fmt: skip
    for text in written:
        assert "client" not in text.lower() and " open" not in text.lower(), text
    assert points_module.POINT_CHANGED == "This point changed; read the workpaper again."
