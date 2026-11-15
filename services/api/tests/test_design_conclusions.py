"""The D&I conclusion, signed by an independent reviewer (migration 0143; the product owner,
8 November 2026: "OE can't start if design is failing").

An exception a person recorded on an attribute is never signed over as effective
(docs/evidence-assurance.md, section 10.15, item 5): while one stands on a D&I request of
the control, whatever the state of that request's check, and no design deficiency does,
the conclusion says so and the sign-off is refused with it; a design deficiency or a
changed or reopened tickmark lifts it; and a tickmark, or a decision on a file's
reliability, recorded or ended after the sign-off puts the sign-off out of date, the
reason naming the attributes and the files."""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
from support import Database
from test_attribute_dispositions import REASON, _ids
from test_attribute_dispositions import _record as _tickmark
from test_attribute_dispositions import _reopen as _reopen_tickmark
from test_design_workpaper import _draft_design
from test_evidence_assurance import LOG, _Bench, _reading
from test_evidence_flow import _project
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_outbound import _session, migrated
from test_phase_release import _launched, _prepare_design

from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import (
    GATE_DESIGN,
    GATE_NOT_EFFECTIVE,
    decisions_changed,
    design_verdict,
    oe_gate_reason,
    tickmarks_changed,
)

__all__ = ["migrated"]

EXCEPTION_ON = (
    "An exception is recorded on attribute {code}. Log a design deficiency for it, or "
    "change the tickmark with your reason."
)
# The same, where the request the exception is recorded on has no current check.
EXCEPTION_WAITING = (
    "An exception is recorded on attribute {code}, on a request waiting to be checked "
    "again. Log a design deficiency for it, or reopen the tickmark with your reason."
)
TICKMARK_ON_B = "a tickmark on attribute B changed after the sign-off"
EXCEPTION_UNANSWERED = (
    "an exception is recorded on an attribute and no design deficiency is logged for it"
)


def _control(team: dict[str, Any]) -> str:
    rows = team["owner"].get(f"{_project(team)}/workspace/controls").json()
    return str(next(row["id"] for row in rows if row["included"]))


def _reviewer_role(migrated: Database, team: dict[str, Any], user_id: UUID) -> None:
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
            VALUES (%s, %s, %s, 'REVIEWER')
            ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'
            """,
            (team["org"], team["project"], user_id),
        )


def _design_deficiency(migrated: Database, team: dict[str, Any], control: str) -> None:
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO deficiencies (organization_id, project_id, reference,
                                      engagement_control_id, title, deficiency_type, identified_by)
            VALUES (%s, %s, 'D-901', %s, 'No approval step in the design', 'DESIGN', %s)
            """,
            (team["org"], team["project"], control, team["owner_id"]),
        )


def _verdict(migrated: Database, team: dict[str, Any], control: str) -> str | None:
    with connect(migrated.url) as connection:
        return design_verdict(connection, team["project"], UUID(control))


def test_the_d_and_i_conclusion_is_signed_by_an_independent_reviewer(migrated: Database) -> None:
    team = _launched(migrated, "dc-sign")
    owner = team["owner"]
    control = _control(team)
    path = f"{_project(team)}/design-conclusions/{control}"

    # Nothing to conclude before the design workpaper is prepared.
    body = owner.get(path).json()
    assert (body["status"], body["proposed"], body["can_sign"]) == ("NOT_READY", None, False)
    assert body["blocking"] == ["the design workpaper is not prepared"]
    assert _verdict(migrated, team, control) is None

    # Prepared by the owner: the records propose an effective design.
    _prepare_design(migrated, team, control)
    body = owner.get(path).json()
    assert (body["status"], body["proposed"]) == ("TO_SIGN", "EFFECTIVE")
    assert body["viewer_prepared"] is True and body["can_sign"] is False
    sign = {"verdict": "EFFECTIVE", "workpaper_version": 1, "note": "Design walked through."}

    # Only the reviewer role signs, and never the preparer.
    refused = owner.post(f"{path}/sign-off", json=sign)
    assert refused.status_code == 409 and "reviewer role" in refused.json()["detail"]
    _reviewer_role(migrated, team, team["owner_id"])
    own = owner.post(f"{path}/sign-off", json=sign)
    assert own.status_code == 409 and "another reviewer" in own.json()["detail"]

    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    assert reviewer.get(path).json()["can_sign"] is True
    # The reviewer confirms the records' verdict, on the version they reviewed.
    other = reviewer.post(f"{path}/sign-off", json={**sign, "verdict": "NOT_EFFECTIVE"})
    assert other.status_code == 409 and "different verdict" in other.json()["detail"]
    stale = reviewer.post(f"{path}/sign-off", json={**sign, "workpaper_version": 2})
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]

    signed = reviewer.post(f"{path}/sign-off", json=sign)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["status"] == "SIGNED_OFF" and body["can_sign"] is False
    assert body["signed"]["verdict"] == "EFFECTIVE"
    assert body["signed"]["signoff_note"] == "Design walked through."
    assert _verdict(migrated, team, control) == "EFFECTIVE"
    again = reviewer.post(f"{path}/sign-off", json=sign)
    assert again.status_code == 409 and "signed off" in again.json()["detail"]

    # A design deficiency logged afterwards puts the sign-off out of date: OE is not cleared.
    _design_deficiency(migrated, team, control)
    body = reviewer.get(path).json()
    assert (body["status"], body["proposed"]) == ("OUT_OF_DATE", "NOT_EFFECTIVE")
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    assert [item["reference"] for item in body["deficiencies"]] == ["D-901"]
    assert _verdict(migrated, team, control) is None
    resigned = reviewer.post(f"{path}/sign-off", json={**sign, "verdict": "NOT_EFFECTIVE"})
    assert resigned.status_code == 200, resigned.text
    body = resigned.json()
    assert body["status"] == "SIGNED_OFF" and body["signed"]["deficiencies"] == ["D-901"]
    assert _verdict(migrated, team, control) == "NOT_EFFECTIVE"
    # The first sign-off is kept, marked superseded.
    assert [(item["verdict"], item["reopened_from"]) for item in body["history"]] == [
        ("NOT_EFFECTIVE", None),
        ("EFFECTIVE", "SUPERSEDED"),
    ]

    # A reviewer may open it again, with a reason.
    short = reviewer.post(f"{path}/reopen", json={"reason": "No."})
    assert short.status_code == 422
    reopened = reviewer.post(
        f"{path}/reopen", json={"reason": "The walkthrough must be performed again."}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "TO_SIGN"
    assert _verdict(migrated, team, control) is None

    with connect(migrated.url) as connection:
        actions = [
            str(row[0])
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE project_id = %s "
                "AND target_type = 'design_conclusion' ORDER BY created_at",
                (team["project"],),
            ).fetchall()
        ]
    assert actions == [
        "design_conclusion.signed_off",
        "design_conclusion.signed_off",
        "design_conclusion.reopened",
    ]


def test_a_recorded_d_and_i_conclusion_is_never_changed_or_deleted(migrated: Database) -> None:
    team = _launched(migrated, "dc-keep")
    control = _control(team)
    _prepare_design(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    signed = reviewer.post(
        f"{path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": 1}
    )
    assert signed.status_code == 200, signed.text
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.RaiseException, match="never changed"):
            connection.execute("UPDATE design_conclusions SET verdict = 'NOT_EFFECTIVE'")
        connection.rollback()
        with pytest.raises(psycopg.errors.RaiseException, match="never deleted"):
            connection.execute("DELETE FROM design_conclusions")
        connection.rollback()
        # Only one sign-off stands per control.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                """
                INSERT INTO design_conclusions (organization_id, project_id,
                    engagement_control_id, workpaper_id, workpaper_version, verdict, signed_by)
                SELECT organization_id, project_id, engagement_control_id, workpaper_id,
                       workpaper_version, verdict, signed_by
                FROM design_conclusions
                """
            )


def test_reopening_the_design_workpaper_opens_the_d_and_i_conclusion(migrated: Database) -> None:
    team = _launched(migrated, "dc-reopen")
    owner = team["owner"]
    control = _control(team)
    _prepare_design(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    assert (
        reviewer.post(
            f"{path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": 1}
        ).status_code
        == 200
    )
    paper = owner.get(f"{path}").json()["workpaper"]
    with connect(migrated.url) as connection:
        version = connection.execute(
            "SELECT version FROM workpapers WHERE id = %s", (paper["id"],)
        ).fetchone()
    assert version is not None
    opened = owner.post(
        f"{_project(team)}/workpapers/{paper['id']}/reopen",
        json={"version": version[0], "reason": "Walkthrough notes to correct."},
    )
    assert opened.status_code == 200, opened.text
    body = owner.get(path).json()
    assert (body["status"], body["signed"]) == ("NOT_READY", None)
    assert body["history"][0]["reopened_from"] == "WORKPAPER"
    assert body["history"][0]["reopen_reason"] == "Walkthrough notes to correct."
    assert _verdict(migrated, team, control) is None


def test_a_control_of_another_engagement_is_not_found(migrated: Database) -> None:
    team = _launched(migrated, "dc-tenant")
    missing = team["owner"].get(f"{_project(team)}/design-conclusions/{uuid4()}")
    assert missing.status_code == 404


class _Signing:
    """A control whose D&I request is checked (attribute B is not shown, the others are;
    the ticket is read as a report that does not show its basis), whose design workpaper
    a person prepared, and a reviewer who did not prepare it."""

    def __init__(self, migrated: Database, slug: str) -> None:
        self.database = migrated
        self.bench = bench = _Bench(migrated, slug)
        self.ticket, first = _first_check_with_a_report(bench, B="ABSENT")
        self.ids = _ids(first)
        paper = _draft_design(bench, None)
        prepared = bench.owner.post(
            f"{bench.base}/workpapers/{paper['id']}/prepare", json={"version": paper["version"]}
        )
        assert prepared.status_code == 200, prepared.text
        self.version = int(prepared.json()["prepared_version"])
        reviewer_id, self.reviewer = bench.member("ADMIN")
        with connect(migrated.url) as connection:
            connection.execute(
                "INSERT INTO project_memberships (organization_id, project_id, user_id, "
                "engagement_role) VALUES (%s, %s, %s, 'REVIEWER') "
                "ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'",
                (bench.team["org"], bench.team["project"], reviewer_id),
            )
        self.path = f"{bench.base}/design-conclusions/{bench.control}"

    def body(self, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.reviewer).get(self.path)
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def sign(self, verdict: str = "EFFECTIVE") -> Any:
        return self.reviewer.post(
            f"{self.path}/sign-off",
            json={"verdict": verdict, "workpaper_version": self.version},
        )

    def verdict(self) -> str | None:
        with connect(self.database.url) as connection:
            return design_verdict(
                connection, UUID(str(self.bench.team["project"])), UUID(self.bench.control)
            )

    def gate(self) -> str | None:
        """Why OE work on the control cannot start, as the OE gate reads it (None: open)."""
        with connect(self.database.url) as connection:
            return oe_gate_reason(connection, UUID(self.bench.control))

    def signed_rows(self) -> int:
        return int(self.bench.rows("SELECT count(*) FROM design_conclusions")[0][0])

    def tickmark(self, code: str) -> dict[str, Any]:
        """The tickmark that stands on the attribute, as the D&I list gives it."""
        attribute = next(a for a in self.bench.entry()["attributes"] if a["code"] == code)
        found: dict[str, Any] = attribute["disposition"]
        return found

    def tickmark_id(self, code: str) -> str:
        """The id of the tickmark standing on the attribute, as recorded (the D&I list
        shows none of a request whose check is not current)."""
        [row] = self.bench.rows(
            "SELECT d.id FROM attribute_dispositions d WHERE d.requirement_id = %s "
            "AND d.attribute_id = %s AND d.ended_at IS NULL",
            UUID(self.bench.item_id),
            UUID(self.ids[code]),
        )
        return str(row[0])

    def deficiency(self) -> None:
        bench = self.bench
        with connect(self.database.url) as connection:
            connection.execute(
                "INSERT INTO deficiencies (organization_id, project_id, reference, "
                "engagement_control_id, title, deficiency_type, identified_by) "
                "VALUES (%s, %s, 'D-901', %s, 'No approval step in the design', 'DESIGN', %s)",
                (bench.team["org"], bench.team["project"], bench.control, bench.team["owner_id"]),
            )


def test_an_exception_a_person_recorded_is_never_signed_over_as_effective(
    migrated: Database,
) -> None:
    """Section 10.15, item 5. Before (the end-to-end trace): the proposed verdict was
    effective unless a design deficiency stood, and nothing but the assembled workpaper
    read a tickmark, so an exception a person recorded could be signed over as
    "Effective". Now, while one stands on a current check and no design deficiency does,
    the conclusion says so, attribute by attribute, and the sign-off is refused with it;
    changing the tickmark with a reason lifts it."""
    case = _Signing(migrated, "dc-exception")
    bench, ids = case.bench, case.ids
    owner_name = bench.name(bench.team["owner_id"])

    # No tickmark: nothing keeps the reviewer from signing.
    body = case.body()
    assert (body["status"], body["proposed"], body["can_sign"]) == ("TO_SIGN", "EFFECTIVE", True)
    assert (body["blocking"], body["exceptions"]) == ([], [])

    # A tickmark that closes an attribute keeps nobody from signing.
    assert _tickmark(bench, ids["D"], "NOT_APPLICABLE").status_code == 200
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)

    # A person records an exception on B. The records still propose the verdict they
    # proposed; what changed is that it cannot be signed.
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    body = case.body()
    assert (body["status"], body["proposed"], body["can_sign"]) == ("TO_SIGN", "EFFECTIVE", False)
    assert body["blocking"] == [EXCEPTION_ON.format(code="B")]
    [exception] = body["exceptions"]
    assert exception | {"recorded_at": ""} == {
        "disposition_id": case.tickmark("B")["id"], "attribute_id": ids["B"], "code": "B",
        "requirement_id": bench.item_id, "recorded_by_name": owner_name, "recorded_at": "",
        "reason": REASON, "check_current": True,
    }  # fmt: skip
    assert exception["recorded_at"] == case.tickmark("B")["recorded_at"]
    # The person who recorded it reads the same.
    assert case.body(bench.owner)["blocking"] == body["blocking"]
    # Refused with the sentence, whatever verdict is asked for, and nothing is signed.
    for verdict in ("EFFECTIVE", "NOT_EFFECTIVE"):
        refused = case.sign(verdict)
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == EXCEPTION_ON.format(code="B")
    assert case.signed_rows() == 0 and case.verdict() is None

    # A second exception, on an attribute the check shows: one sentence per attribute,
    # in the attributes' order, and the refusal carries both.
    assert _tickmark(bench, ids["A"], "EXCEPTION").status_code == 200
    body = case.body()
    assert body["blocking"] == [EXCEPTION_ON.format(code="A"), EXCEPTION_ON.format(code="B")]
    assert [e["code"] for e in body["exceptions"]] == ["A", "B"]
    refused = case.sign()
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        f"{EXCEPTION_ON.format(code='A')} {EXCEPTION_ON.format(code='B')}"
    )

    # Lifted by changing the tickmarks, each with a reason: A's is reopened, B's is
    # changed to an accepted limitation. Nothing waits, and the reviewer signs.
    assert _reopen_tickmark(bench, ids["A"], case.tickmark("A")["id"]).status_code == 200
    assert case.body()["blocking"] == [EXCEPTION_ON.format(code="B")]
    changed = _tickmark(bench, ids["B"], "NOT_AVAILABLE", replaces=case.tickmark("B")["id"])
    assert changed.status_code == 200, changed.text
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)
    signed = case.sign()
    assert signed.status_code == 200, signed.text
    assert (signed.json()["status"], signed.json()["out_of_date"]) == ("SIGNED_OFF", [])
    assert case.verdict() == "EFFECTIVE"


def test_a_tickmark_changed_after_the_sign_off_puts_it_out_of_date(migrated: Database) -> None:
    """Section 10.15, item 5. Before: `out_of_date` read only the workpaper's version and
    the design deficiencies, so a sign-off stood whatever a person recorded on the
    attributes afterwards. Now a tickmark, or a decision on a file's reliability, recorded
    or ended after the sign-off puts it out of date, and the OE gate no longer reads its
    verdict; an exception recorded then is lifted by a design deficiency, on which the
    existing rule applies (not effective).

    Rewritten after the independent review of 15 November 2026 (item 10a). Old
    expectation: the one reason "a tickmark changed after the sign-off", also where what
    changed was a decision on a file's reliability, and never saying which. New: the
    reason names the attribute ("a tickmark on attribute B changed after the sign-off")
    or the file ("the reliability decision on ticket REQ-1041.txt changed after the
    sign-off"), one reason for each kind. Every other assertion is kept: what puts the
    sign-off out of date, and that the OE gate then reads no verdict."""
    case = _Signing(migrated, "dc-changed")
    bench, ids = case.bench, case.ids

    def resign(verdict: str = "EFFECTIVE") -> None:
        signed = case.sign(verdict)
        assert signed.status_code == 200, signed.text
        assert (signed.json()["status"], signed.json()["out_of_date"]) == ("SIGNED_OFF", [])
        assert case.verdict() == verdict

    def out_of_date() -> dict[str, Any]:
        body = case.body()
        assert body["status"] == "OUT_OF_DATE" and case.verdict() is None
        return body

    # A tickmark recorded before the sign-off is part of what was signed.
    assert _tickmark(bench, ids["D"], "NOT_APPLICABLE").status_code == 200
    resign()
    assert case.body()["status"] == "SIGNED_OFF"

    # Recorded after the sign-off: the reason names the attribute.
    assert _tickmark(bench, ids["B"], "NOT_APPLICABLE").status_code == 200
    assert out_of_date()["out_of_date"] == [TICKMARK_ON_B]
    resign()
    # Ended after the sign-off (a person reopened it).
    assert _reopen_tickmark(bench, ids["B"], case.tickmark("B")["id"]).status_code == 200
    assert out_of_date()["out_of_date"] == [TICKMARK_ON_B]
    resign()
    # A decision on a file's reliability recorded after the sign-off: the reason names
    # the file, and says it is a reliability decision, not a tickmark.
    assert _decide_reliability(bench, case.ticket, "NOT_RELIED_ON").status_code == 200
    assert out_of_date()["out_of_date"] == [
        "the reliability decision on ticket REQ-1041.txt changed after the sign-off"
    ]
    # Tickmarks on two attributes as well: each kind has its own reason, the attributes
    # in their order.
    assert _tickmark(bench, ids["C"], "NOT_APPLICABLE").status_code == 200
    assert _tickmark(bench, ids["A"], "NOT_AVAILABLE").status_code == 200
    assert out_of_date()["out_of_date"] == [
        "tickmarks on attributes A and C changed after the sign-off",
        "the reliability decision on ticket REQ-1041.txt changed after the sign-off",
    ]
    resign()

    # An exception recorded after the sign-off: out of date, and it cannot be signed again
    # as it is.
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    body = out_of_date()
    assert (body["out_of_date"], body["proposed"]) == ([TICKMARK_ON_B], "EFFECTIVE")
    assert (body["blocking"], body["can_sign"]) == ([EXCEPTION_ON.format(code="B")], False)
    refused = case.sign()
    assert refused.status_code == 409
    assert refused.json()["detail"] == EXCEPTION_ON.format(code="B")
    assert case.verdict() is None

    # Lifted by a design deficiency logged for it: the existing rule applies. The records
    # propose not effective, nothing more is said of the exception, which stays on the
    # conclusion for the reviewer to read, and the reviewer signs that verdict.
    case.deficiency()
    body = out_of_date()
    assert body["out_of_date"] == [
        "a design deficiency was logged after the sign-off", TICKMARK_ON_B,
    ]  # fmt: skip
    assert (body["proposed"], body["blocking"], body["can_sign"]) == ("NOT_EFFECTIVE", [], True)
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    still = case.sign("EFFECTIVE")
    assert still.status_code == 409 and "different verdict" in still.json()["detail"]
    resign("NOT_EFFECTIVE")
    body = case.body()
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    assert body["signed"]["deficiencies"] == ["D-901"]


def test_what_changed_after_the_sign_off_is_named_and_bounded() -> None:
    """Item 10a (pure). The reason names the attributes, or the files, at most three and
    then how many more; a tickmark on an attribute that is no longer approved has no
    letter and is counted."""
    after = "changed after the sign-off"
    assert tickmarks_changed(["B"]) == f"a tickmark on attribute B {after}"
    assert tickmarks_changed(["A", "C"]) == f"tickmarks on attributes A and C {after}"
    assert tickmarks_changed(["A", "B", "D"]) == f"tickmarks on attributes A, B and D {after}"
    assert tickmarks_changed(list("ABCDE")) == (
        f"tickmarks on attributes A, B, C and 2 more {after}"
    )
    assert tickmarks_changed(["B"], 1) == f"tickmarks on attribute B and 1 more {after}"
    assert tickmarks_changed(list("ABC"), 2) == (
        f"tickmarks on attributes A, B, C and 2 more {after}"
    )
    assert tickmarks_changed([], 1) == f"a tickmark on an attribute no longer approved {after}"
    assert tickmarks_changed([], 3) == f"tickmarks on 3 attributes no longer approved {after}"
    assert decisions_changed(["report.csv"]) == f"the reliability decision on report.csv {after}"
    assert decisions_changed(["a.csv", "b.csv"]) == (
        f"the reliability decisions on a.csv and b.csv {after}"
    )
    assert decisions_changed(["a.csv", "b.csv", "c.csv", "d.csv", "e.csv"]) == (
        f"the reliability decisions on a.csv, b.csv, c.csv and 2 more {after}"
    )
    # A file's name is untrusted text: one cleaned line, bounded.
    hostile = decisions_changed(["first line\nsecond line " + "x" * 400])
    assert "\n" not in hostile and len(hostile) < 200 and hostile.endswith(after)


def test_an_exception_is_never_signed_over_whatever_the_state_of_its_requests_check(
    migrated: Database,
) -> None:
    """Independent review of 15 November 2026 (item 1), rewritten from
    `test_an_exception_that_applies_again_under_a_sign_off_puts_it_out_of_date`.

    Old expectation (it encoded the defect): once the request's check was out of date the
    conclusion gave `(blocking, exceptions, can_sign) == ([], [], True)`, the sign-off as
    effective answered 200 and `design_verdict` read EFFECTIVE, with the exception still
    standing; only when the check was current again did the sign-off go out of date. So a
    reviewer could sign "Effective" over a standing exception simply because a file had
    been added to its request, and the OE gate opened on it.

    New expectation: an exception a person recorded stands until a person reopens or
    replaces it (10.13), so it keeps the conclusion from being signed whatever the state
    of its request's check and whether or not the request is set aside; `exceptions`
    lists it with `check_current`, and the sentence says the request waits to be checked
    again. The OE gate never reads EFFECTIVE while it stands. Kept from the old test: an
    exception that comes to stand under a sign-off as effective with nothing recorded
    since (here: on a request restored after it was removed) puts that sign-off out of
    date, and a design deficiency lifts it by the existing rule."""
    case = _Signing(migrated, "dc-again")
    bench, ids = case.bench, case.ids
    requirement = UUID(bench.item_id)

    def blocked(sentence: str, current: bool) -> dict[str, Any]:
        """The conclusion cannot be signed, for the one reason, and nothing is signed."""
        body = case.body()
        assert (body["status"], body["proposed"], body["can_sign"]) == (
            "TO_SIGN", "EFFECTIVE", False,
        )  # fmt: skip
        assert body["blocking"] == [sentence.format(code="B")]
        assert [(e["code"], e["check_current"]) for e in body["exceptions"]] == [("B", current)]
        for verdict in ("EFFECTIVE", "NOT_EFFECTIVE"):
            refused = case.sign(verdict)
            assert refused.status_code == 409, refused.text
            assert refused.json()["detail"] == sentence.format(code="B")
        assert case.signed_rows() == 0 and case.verdict() is None
        assert case.gate() == GATE_DESIGN
        return body

    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    blocked(EXCEPTION_ON, True)

    # What the check read changes (the request no longer asks for A): the check is out of
    # date and the tickmark is kept, not shown on the request. It still stands.
    with connect(migrated.url) as connection:
        [(link,)] = connection.execute(
            "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
            "AND attribute_id = %s RETURNING to_jsonb(evidence_requirement_attributes)",
            (requirement, UUID(ids["A"])),
        ).fetchall()
    entry = bench.entry()
    assert (entry["status"], entry["tickmarks_kept"]) == ("OUT_OF_DATE", 1)
    waiting = blocked(EXCEPTION_WAITING, False)
    assert waiting["exceptions"][0]["disposition_id"] == case.tickmark_id("B")
    # The request reads as it did when it was checked: current again, the sentence too.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO evidence_requirement_attributes "
            "SELECT * FROM jsonb_populate_record(NULL::evidence_requirement_attributes, %s)",
            (Jsonb(link),),
        )
    assert bench.entry()["status"] == "REVIEWED"
    blocked(EXCEPTION_ON, True)

    # The request set aside as not applicable: the tickmark stands, so it still blocks.
    waived = bench.owner.post(
        f"{bench.base}/controls/{bench.control}/evidence-requirements/{bench.item_id}/waive",
        json={"reason": "Covered by the walkthrough of the other system.",
              "version": bench.item(bench.item_id)["version"]},
    )  # fmt: skip
    assert waived.status_code == 200, waived.text
    assert bench.item(bench.item_id)["status"] == "WAIVED"
    # Setting a request aside changes nothing its check read (its files stay in force
    # on it), so the check stays current, and the sentence is the one for a current check.
    assert bench.entry()["status"] == "REVIEWED"
    set_aside = case.body()
    assert set_aside["can_sign"] is False
    assert [(e["code"], e["check_current"]) for e in set_aside["exceptions"]] == [("B", True)]
    assert set_aside["blocking"] == [EXCEPTION_ON.format(code="B")]
    assert case.sign().status_code == 409 and case.verdict() is None

    # A request that is removed is no longer part of the control's evidence: its
    # exception is not read, and the conclusion can be signed.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET status = 'REMOVED', waive_reason = '', "
            "waived_by = NULL, waived_at = NULL WHERE id = %s",
            (requirement,),
        )
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)
    signed = case.sign()
    assert signed.status_code == 200, signed.text
    assert case.verdict() == "EFFECTIVE" and case.gate() is None

    # The request is in the list again, and its exception with it. Nothing was recorded
    # since the sign-off, and still it no longer holds: the OE gate never reads a verdict
    # signed over a standing exception.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET status = 'REQUESTED' WHERE id = %s", (requirement,)
        )
    body = case.body()
    assert body["status"] == "OUT_OF_DATE" and case.verdict() is None
    assert case.gate() == GATE_DESIGN
    assert body["out_of_date"] == [EXCEPTION_UNANSWERED]
    assert [e["code"] for e in body["exceptions"]] == ["B"] and body["can_sign"] is False
    assert case.sign().status_code == 409
    # With a design deficiency logged the existing rule applies.
    case.deficiency()
    body = case.body()
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    assert (body["proposed"], body["blocking"]) == ("NOT_EFFECTIVE", [])
    assert case.sign("NOT_EFFECTIVE").status_code == 200
    assert case.verdict() == "NOT_EFFECTIVE" and case.gate() == GATE_NOT_EFFECTIVE


def test_a_file_added_to_the_request_does_not_take_its_exception_out_of_the_way(
    migrated: Database,
) -> None:
    """Independent review of 15 November 2026 (item 1), the scenario found: an exception on
    B, then a file is added to the request. The new check is queued (or being read, held
    or failed), the D&I list shows no attribute of the request, and before, the conclusion
    listed no exception and could be signed as effective. Now it says the exception is on
    a request waiting to be checked again, and is lifted only by a design deficiency or by
    reopening the tickmark, which the conclusion names by its id. An exception on an
    attribute that is no longer approved is left out, and counts again with the
    attribute."""
    case = _Signing(migrated, "dc-added")
    bench, ids = case.bench, case.ids
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    assert case.body()["blocking"] == [EXCEPTION_ON.format(code="B")]
    recorded = case.tickmark_id("B")

    bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    entry = bench.entry()
    assert (entry["status"], entry["attributes"], entry["tickmarks_kept"]) == ("QUEUED", [], 1)
    body = case.body()
    assert (body["proposed"], body["can_sign"]) == ("EFFECTIVE", False)
    assert body["blocking"] == [EXCEPTION_WAITING.format(code="B")]
    [exception] = body["exceptions"]
    assert (exception["disposition_id"], exception["check_current"]) == (recorded, False)
    for verdict in ("EFFECTIVE", "NOT_EFFECTIVE"):
        refused = case.sign(verdict)
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == EXCEPTION_WAITING.format(code="B")
    assert case.signed_rows() == 0 and case.verdict() is None and case.gate() == GATE_DESIGN
    # The design workpaper's own view of the conclusion says the same.
    paper = bench.owner.get(f"{bench.base}/controls/{bench.control}/design-workpaper")
    assert paper.status_code == 200, paper.text
    assert paper.json()["conclusion"]["signed"] is False

    # An attribute that is no longer approved is not concluded on: its exception is left
    # out while it is not, and counts again as soon as it is approved again.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'SUPERSEDED' WHERE id = %s", (UUID(ids["B"]),)
        )
    body = case.body()
    assert (body["blocking"], body["exceptions"]) == ([], [])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'APPROVED' WHERE id = %s", (UUID(ids["B"]),)
        )
    assert case.body()["blocking"] == [EXCEPTION_WAITING.format(code="B")]

    # Reopened with a reason, by the id the conclusion gives (the D&I list shows no
    # tickmark of a request that waits to be checked): nothing stands, and it is signed.
    reopened = _reopen_tickmark(bench, ids["B"], recorded)
    assert reopened.status_code == 200, reopened.text
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)
    signed = case.sign()
    assert signed.status_code == 200, signed.text
    assert case.verdict() == "EFFECTIVE" and case.gate() is None
