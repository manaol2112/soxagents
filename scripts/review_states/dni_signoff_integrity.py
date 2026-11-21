"""D&I sign-off integrity (dni-signoff-integrity, 19 November 2026): its design review states.

Each on an engagement of its own, built with the test suite's helpers through the API as
the team would (a person's decisions over the API; checks finished by the rules and
scripted readings, no model). The completion states write two records directly, as the
suite's own tests write them: a control made final (test_engagement_close._finish_the_work)
and its test sheet signed again after the review. Each state carries the owner's session
token (8 hours; synthetic users of this database only).

- dni-own-words-needed   the D&I Assessment step: a conclusion recorded and every point
                         settled, the conclusion section still the drafted text (D4: the
                         sign-off waits on the preparer's own words)
- dni-own-words-saved    the same, the conclusion section saved in the preparer's words
- dni-limitation         D&I Evidence and D&I Assessment: attribute B accepted as "Evidence
                         not available" (D1: it settles the follow-up, never the attribute)
- dni-not-relied         D&I Assessment: every attribute shown by two files together, one
                         decided not relied on (D3: nothing is shown)
- dni-rechecked          D&I Assessment: an Effective sign-off, then the request checked
                         again with the same result (D5: the sign-off is out of date)
- dni-rechecked-reviewer  the same, as the reviewer who signed reads it
- dni-completion-not-final  the engagement's status and close-out: its one control not
                         final (the sheet signed again after the review), with its reason
- dni-completion-scope   the engagement's status and close-out: every control taken out of
                         scope (C3: nothing in scope, so the card says only to archive it)
"""

from typing import Any

from seed_review_states import _token
from support import conclude_in_own_words
from test_assurance_engine2 import _engine_2
from test_attribute_dispositions import _record as _tickmark
from test_design_conclusion_choice import HOW_ALL_MET, _Draft, _shown_on_both_files
from test_engagement_close import _finish_the_work, _launched
from test_evidence_assurance import LOG, _reading, _Readings
from test_file_reliability import _files_said
from test_file_reliability import _record as _decide_reliability
from test_onboarding import _base

from ai_workforce_api.db import connect


def _draft_href(seed: Any, case: _Draft, step: str) -> str:
    return seed.href(case.bench.team, section="controls", control=case.bench.control, step=step)


def _owner_token(seed: Any, team: dict[str, Any]) -> str:
    return _token(seed.url, team["owner_id"])


def _own_words(seed: Any) -> None:
    needed = _Draft(seed.database, "dni-own-words", **HOW_ALL_MET)
    needed.chosen("EFFECTIVE")
    needed.settle_points()
    seed.add(
        "dni-own-words-needed",
        _draft_href(seed, needed, "designassessment"),
        token=_owner_token(seed, needed.bench.team),
    )
    saved = _Draft(seed.database, "dni-own-words-saved", **HOW_ALL_MET)
    saved.chosen("EFFECTIVE")
    saved.settle_points()
    conclude_in_own_words(
        saved.bench.owner,
        saved.bench.base,
        saved.bench.control,
        "The design is effective: every attribute is shown in the records of the instance "
        "walked through, and no exception stands.",
    )
    seed.add(
        "dni-own-words-saved",
        _draft_href(seed, saved, "designassessment"),
        token=_owner_token(seed, saved.bench.team),
    )


def _limitation(seed: Any) -> None:
    case = _Draft(seed.database, "dni-limited", A="MET", B="ABSENT", C="MET", D="MET", E="MET")
    accepted = _tickmark(case.bench, case.ids["B"], "NOT_AVAILABLE")
    assert accepted.status_code == 200, accepted.text
    assert case.body()["proposed_conclusion"] == "NOT_CONCLUDED"
    token = _owner_token(seed, case.bench.team)
    seed.add("dni-limitation", _draft_href(seed, case, "designassessment"), token=token)
    seed.add("dni-limitation-evidence", _draft_href(seed, case, "designevidence"), token=token)
    # The tickmark form's hint: attribute B before a person decides it.
    open_case = _Draft(
        seed.database, "dni-limited-form", A="MET", B="ABSENT", C="MET", D="MET", E="MET"
    )
    seed.add(
        "dni-limitation-form",
        _draft_href(seed, open_case, "designevidence"),
        token=_owner_token(seed, open_case.bench.team),
        attribute="B",
    )


def _not_relied(seed: Any) -> None:
    case = _Draft(seed.database, "dni-combined", **HOW_ALL_MET)
    bench = case.bench
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    reading = _engine_2(
        _shown_on_both_files, _files_said("ticket REQ-1041.txt", "sap change log.txt")
    )
    assert bench.check(_Readings(reading, reading)) == ["READY"]
    decided = _decide_reliability(bench, log, "NOT_RELIED_ON")
    assert decided.status_code == 200, decided.text
    assert case.body()["implementation"]["result"] == "OPEN"
    token = _owner_token(seed, bench.team)
    seed.add("dni-not-relied", _draft_href(seed, case, "designassessment"), token=token)


def _rechecked(seed: Any) -> None:
    case = _Draft(seed.database, "dni-rechecked", **HOW_ALL_MET)
    case.concluded_and_signed("EFFECTIVE")
    case.later_check(**HOW_ALL_MET)
    body = case.body()
    assert body["status"] == "OUT_OF_DATE", body
    seed.add(
        "dni-rechecked",
        _draft_href(seed, case, "designassessment"),
        token=_owner_token(seed, case.bench.team),
        out_of_date=body["out_of_date"],
    )
    # The same state as the reviewer who signed reads it: with no request standing, a
    # reviewer who may sign signs again.
    reviewer = case.reviewer.get(case.path).json()
    seed.add(
        "dni-rechecked-reviewer",
        _draft_href(seed, case, "designassessment"),
        token=_token(seed.url, case.reviewer_id),
        can_sign=reviewer["can_sign"],
        blocking=reviewer["blocking"],
    )


def _completion_not_final(seed: Any) -> None:
    team = _launched(seed.database, "dni-not-final")
    control = _finish_the_work(seed.database, team)
    with connect(seed.url) as connection:
        connection.execute(
            "UPDATE test_sheets SET signed_at = clock_timestamp() + interval '1 minute', "
            "version = version + 1 WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    project = f"/organizations/{team['org']}/projects/{team['project']}"
    state = team["owner"].get(f"{project}/completion").json()
    assert state["can_complete"] is False, state
    seed.add(
        "dni-completion-not-final",
        seed.href(team, section="projects", manage="engagement"),
        token=_owner_token(seed, team),
        open_items=state["open_items"],
    )


def _completion_scope(seed: Any) -> None:
    team = _launched(seed.database, "dni-all-out")
    owner = team["owner"]
    base = _base(team["org"], team["project"])
    with connect(seed.url) as connection:
        controls = [
            row[0]
            for row in connection.execute(
                "SELECT id FROM engagement_controls WHERE project_id = %s AND included",
                (team["project"],),
            ).fetchall()
        ]
    for control in controls:
        out = owner.post(
            f"{base}/controls/{control}/scope",
            json={"included": False, "reason": "Covered by the vendor's SOC 1 report."},
        )
        assert out.status_code == 200, out.text
    project = f"/organizations/{team['org']}/projects/{team['project']}"
    state = owner.get(f"{project}/completion").json()
    # Nothing in scope: one SCOPE item only, never a system to mark out of scope.
    assert [i["kind"] for i in state["open_items"] if i["kind"] == "SCOPE"] == ["SCOPE"]
    assert state["nothing_in_scope"] is True
    seed.add(
        "dni-completion-scope",
        seed.href(team, section="projects", manage="engagement"),
        token=_owner_token(seed, team),
        open_items=state["open_items"],
    )


def build(seed: Any) -> None:
    _own_words(seed)
    _limitation(seed)
    _not_relied(seed)
    _rechecked(seed)
    _completion_not_final(seed)
    _completion_scope(seed)
