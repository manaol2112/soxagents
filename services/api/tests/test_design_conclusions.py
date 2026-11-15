"""The D&I conclusion, signed by an independent reviewer (migration 0143; the product owner,
8 November 2026: "OE can't start if design is failing").

An exception a person recorded on an attribute is never signed over as effective
(docs/evidence-assurance.md, section 10.15, item 5): while one stands on a current check
and no design deficiency does, the conclusion says so and the sign-off is refused with it;
a design deficiency or a changed tickmark lifts it; and a tickmark, or a decision on a
file's reliability, recorded or ended after the sign-off puts the sign-off out of date."""

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
from test_evidence_assurance import _Bench
from test_evidence_flow import _project
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_outbound import _session, migrated
from test_phase_release import _launched, _prepare_design

from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import design_verdict

__all__ = ["migrated"]

EXCEPTION_ON = (
    "An exception is recorded on attribute {code}. Log a design deficiency for it, or "
    "change the tickmark with your reason."
)
TICKMARK_CHANGED = "a tickmark changed after the sign-off"


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

    def signed_rows(self) -> int:
        return int(self.bench.rows("SELECT count(*) FROM design_conclusions")[0][0])

    def tickmark(self, code: str) -> dict[str, Any]:
        """The tickmark that stands on the attribute, as the D&I list gives it."""
        attribute = next(a for a in self.bench.entry()["attributes"] if a["code"] == code)
        found: dict[str, Any] = attribute["disposition"]
        return found

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
        "attribute_id": ids["B"], "code": "B", "requirement_id": bench.item_id,
        "recorded_by_name": owner_name, "recorded_at": "", "reason": REASON,
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
    existing rule applies (not effective)."""
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

    # Recorded after the sign-off.
    assert _tickmark(bench, ids["B"], "NOT_APPLICABLE").status_code == 200
    assert out_of_date()["out_of_date"] == [TICKMARK_CHANGED]
    resign()
    # Ended after the sign-off (a person reopened it).
    assert _reopen_tickmark(bench, ids["B"], case.tickmark("B")["id"]).status_code == 200
    assert out_of_date()["out_of_date"] == [TICKMARK_CHANGED]
    resign()
    # A decision on a file's reliability recorded after the sign-off.
    assert _decide_reliability(bench, case.ticket, "NOT_RELIED_ON").status_code == 200
    assert out_of_date()["out_of_date"] == [TICKMARK_CHANGED]
    resign()

    # An exception recorded after the sign-off: out of date, and it cannot be signed again
    # as it is.
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    body = out_of_date()
    assert (body["out_of_date"], body["proposed"]) == ([TICKMARK_CHANGED], "EFFECTIVE")
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
        "a design deficiency was logged after the sign-off", TICKMARK_CHANGED,
    ]  # fmt: skip
    assert (body["proposed"], body["blocking"], body["can_sign"]) == ("NOT_EFFECTIVE", [], True)
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    still = case.sign("EFFECTIVE")
    assert still.status_code == 409 and "different verdict" in still.json()["detail"]
    resign("NOT_EFFECTIVE")
    body = case.body()
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    assert body["signed"]["deficiencies"] == ["D-901"]


def test_an_exception_that_applies_again_under_a_sign_off_puts_it_out_of_date(
    migrated: Database,
) -> None:
    """An exception is read only on a request whose check is current. One recorded while
    the check was current, kept while it was not (and so not in the way of a sign-off
    then), applies again once the check is current: nothing was recorded or ended after
    the sign-off, and still the sign-off as effective no longer holds, so the OE gate
    never rests on a verdict signed over a standing exception."""
    case = _Signing(migrated, "dc-again")
    bench, ids = case.bench, case.ids
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    assert case.body()["blocking"] == [EXCEPTION_ON.format(code="B")]

    # What the check read changes (the request no longer asks for A): the check is out of
    # date, nothing of it is read, and the tickmark is kept, not applied.
    with connect(migrated.url) as connection:
        [(link,)] = connection.execute(
            "DELETE FROM evidence_requirement_attributes WHERE requirement_id = %s "
            "AND attribute_id = %s RETURNING to_jsonb(evidence_requirement_attributes)",
            (UUID(bench.item_id), UUID(ids["A"])),
        ).fetchall()
    entry = bench.entry()
    assert (entry["status"], entry["tickmarks_kept"]) == ("OUT_OF_DATE", 1)
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)
    signed = case.sign()
    assert signed.status_code == 200, signed.text
    assert case.verdict() == "EFFECTIVE"

    # The request reads as it did when it was checked: its check is current again, and the
    # exception with it. No tickmark changed since the sign-off.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO evidence_requirement_attributes "
            "SELECT * FROM jsonb_populate_record(NULL::evidence_requirement_attributes, %s)",
            (Jsonb(link),),
        )
    assert bench.entry()["status"] == "REVIEWED"
    body = case.body()
    assert body["status"] == "OUT_OF_DATE" and case.verdict() is None
    assert body["out_of_date"] == [
        "an exception is recorded on an attribute and no design deficiency is logged for it"
    ]
    assert body["blocking"] == [EXCEPTION_ON.format(code="B")]
    assert case.sign().status_code == 409
    # With a design deficiency logged the existing rule applies.
    case.deficiency()
    body = case.body()
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    assert (body["proposed"], body["blocking"]) == ("NOT_EFFECTIVE", [])
    assert case.sign("NOT_EFFECTIVE").status_code == 200
    assert case.verdict() == "NOT_EFFECTIVE"
