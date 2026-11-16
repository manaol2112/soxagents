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
from test_file_reliability import _check as _finish_check
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_outbound import _session, migrated
from test_phase_release import _launched, _prepare_design

from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import (
    CHOICE_NOT_STANDING,
    DRAFT_FIRST,
    GATE_DESIGN,
    GATE_NOT_EFFECTIVE,
    NO_CHOICE,
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
DEFICIENCY_EFFECTIVE = "a design deficiency is logged, so the conclusion cannot be “Effective”"
# The rule of an effective conclusion, as a sign-off made from the preparer's choice is
# held to it (independent review, 15 November 2026).
EXCEPTION_STANDS = (
    "an exception stands on attribute {code}, so the conclusion cannot be “Effective”"
)
DEFICIENCY_NO_INSTANCE = (
    "a design deficiency is logged, so the conclusion cannot be "
    "“Design effective, no instance to walk through”"
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


# Section 3.6 (product owner, 15 November 2026): the preparer records the conclusion on the
# draft design workpaper, and the reviewer signs it. The tests below that sign do so on a
# conclusion recorded first.
NO_INSTANCE_REASON = "No change was made in the period, so there is no instance to walk."
NOT_EFFECTIVE_REASON = "The design has no approval step, as the deficiency logged says."


def _draft_paper(migrated: Database, team: dict[str, Any], control: str) -> None:
    """The design workpaper as a draft a person may record the conclusion on (drafted, not
    being drafted), at version 1."""
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO workpapers (
                organization_id, project_id, engagement_control_id, stage, template_key,
                status, draft_status, current_version, requested_by
            )
            VALUES (%s, %s, %s, 'DESIGN', 'itgc', 'DRAFT', 'IDLE', 1, %s)
            ON CONFLICT (project_id, engagement_control_id, stage) DO NOTHING
            """,
            (team["org"], team["project"], control, team["owner_id"]),
        )


def _choose(
    client: TestClient,
    path: str,
    kind: str,
    replaces: str | None = None,
    **more: Any,
) -> Any:
    """The preparer records the conclusion, having seen `replaces` standing."""
    return client.post(f"{path}/choice", json={"kind": kind, "replaces": replaces, **more})


def _concluded(
    migrated: Database,
    team: dict[str, Any],
    control: str,
    kind: str = "NOT_EFFECTIVE",
    **more: Any,
) -> dict[str, Any]:
    """The design workpaper drafted, the preparer's conclusion recorded on it, and the
    workpaper prepared. By default not effective: with no check of the evidence the
    records leave the design and the instance open, so effective and no instance are
    refused, and not effective is signed once a design deficiency is logged. The D&I
    conclusion's body."""
    _draft_paper(migrated, team, control)
    if kind == "NOT_EFFECTIVE":
        more = {"basis": "DESIGN", "reason": NOT_EFFECTIVE_REASON} | more
    elif kind != "EFFECTIVE":
        more = {"reason": NO_INSTANCE_REASON} | more
    path = f"{_project(team)}/design-conclusions/{control}"
    recorded = _choose(team["owner"], path, kind, **more)
    assert recorded.status_code == 200, recorded.text
    _prepare_design(migrated, team, control)
    body: dict[str, Any] = team["owner"].get(path).json()
    return body


def _signing(body: dict[str, Any], conclusion: str, version: int = 1) -> dict[str, Any]:
    """A sign-off of the preparer's conclusion that stands in `body` (the D&I conclusion
    as read), naming it by its id (independent review, 15 November 2026,
    docs/design-workpaper.md section 3.6)."""
    return {
        "conclusion": conclusion, "choice_id": body["choice"]["id"], "workpaper_version": version,
    }  # fmt: skip


def _reopen_paper(migrated: Database, team: dict[str, Any], paper_id: str, reason: str) -> None:
    """A person reopens the prepared design workpaper, through its own route."""
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT version FROM workpapers WHERE id = %s", (paper_id,)
        ).fetchone()
    assert found is not None
    opened = team["owner"].post(
        f"{_project(team)}/workpapers/{paper_id}/reopen",
        json={"version": found[0], "reason": reason},
    )
    assert opened.status_code == 200, opened.text


def test_the_d_and_i_conclusion_is_signed_by_an_independent_reviewer(migrated: Database) -> None:
    """Rewritten for section 3.6 (product owner, 15 November 2026, docs/design-workpaper.md
    section 3.6). Old expectation: on a control with no check of its evidence, the records
    proposed the verdict once the workpaper was prepared (effective, with no deficiency)
    and the reviewer signed exactly that verdict, a different one refused with "the records
    support a different verdict"; a logged deficiency was signed again as not effective
    over the standing sign-off (SUPERSEDED). New expectation: on a control whose evidence
    is checked and shows every attribute in the instance, the preparer records effective
    on the draft, and the reviewer signs that conclusion, another refused with "the
    preparer's conclusion is ..."; after a deficiency the preparer concludes not effective
    on the reopened workpaper, and a superseded sign-off is one signed again on the same
    conclusion. Kept: only the reviewer role signs, never the preparer, on the prepared
    version, once; a logged deficiency puts it out of date and shuts OE; superseded
    sign-offs are kept; a reviewer reopens with a reason; the audit trail."""
    case = _Signing(migrated, "dc-sign", concluded=False)
    bench = case.bench
    team, owner, path = bench.team, bench.owner, case.path

    # Nothing to conclude before the design workpaper is drafted and prepared.
    body = case.body(owner)
    assert (body["status"], body["proposed"], body["can_sign"]) == ("NOT_READY", None, False)
    assert body["blocking"] == ["the design workpaper is not prepared", NO_CHOICE]
    assert (body["choice"], body["can_choose"]) == (None, False)
    refused = _choose(owner, path, "EFFECTIVE")
    assert (refused.status_code, refused.json()["detail"]) == (409, DRAFT_FIRST)
    assert case.verdict() is None

    # On the draft the records propose effective; the preparer records it.
    case.draft()
    body = case.body(owner)
    assert (body["proposed_conclusion"], body["can_choose"]) == ("EFFECTIVE", True)
    assert (body["design"]["result"], body["implementation"]["result"]) == (
        "DESIGNED", "IN_PLACE",
    )  # fmt: skip
    assert _choose(owner, path, "NO_INSTANCE").status_code == 422
    recorded = _choose(owner, path, "EFFECTIVE")
    assert recorded.status_code == 200, recorded.text
    choice = recorded.json()["choice"]
    assert (choice["kind"], choice["proposed_kind"], choice["reason"]) == (
        "EFFECTIVE", "EFFECTIVE", "",
    )  # fmt: skip

    # Prepared by the owner.
    case.prepare()
    body = case.body(owner)
    assert (body["status"], body["proposed"]) == ("TO_SIGN", "EFFECTIVE")
    assert body["viewer_prepared"] is True and body["can_sign"] is False
    sign = {
        "conclusion": "EFFECTIVE",
        "choice_id": choice["id"],
        "workpaper_version": case.version,
        "note": "Design walked through.",
    }

    # Only the reviewer role signs, and never the preparer.
    refused = owner.post(f"{path}/sign-off", json=sign)
    assert refused.status_code == 409 and "reviewer role" in refused.json()["detail"]
    _reviewer_role(migrated, team, team["owner_id"])
    own = owner.post(f"{path}/sign-off", json=sign)
    assert own.status_code == 409 and "another reviewer" in own.json()["detail"]

    reviewer = case.reviewer
    assert case.body()["can_sign"] is True
    # The reviewer signs the preparer's conclusion, on the version they reviewed.
    # Independent review, 15 November 2026 (docs/design-workpaper.md section 3.6). Old: the
    # two-value `verdict` ({"conclusion": None, "verdict": "NOT_EFFECTIVE"}) was refused
    # as another conclusion (409); new: `verdict` is not accepted at all (422), and the
    # sign-off names the choice it signs: another than the standing one is a 409.
    mismatch = reviewer.post(f"{path}/sign-off", json={**sign, "conclusion": "NO_INSTANCE"})
    assert mismatch.status_code == 409
    assert mismatch.json()["detail"].startswith("the preparer's conclusion is “Effective”")
    by_verdict = {key: value for key, value in sign.items() if key != "conclusion"}
    for retired in ({**by_verdict, "verdict": "EFFECTIVE"}, {**sign, "verdict": "EFFECTIVE"}):
        assert reviewer.post(f"{path}/sign-off", json=retired).status_code == 422
    assert reviewer.post(f"{path}/sign-off", json=by_verdict).status_code == 422
    unread = reviewer.post(f"{path}/sign-off", json={**sign, "choice_id": str(uuid4())})
    assert (unread.status_code, unread.json()["detail"]) == (409, CHOICE_NOT_STANDING)
    assert case.verdict() is None
    stale = reviewer.post(f"{path}/sign-off", json={**sign, "workpaper_version": case.version + 1})
    assert stale.status_code == 409 and "changed" in stale.json()["detail"]

    signed = reviewer.post(f"{path}/sign-off", json=sign)
    assert signed.status_code == 200, signed.text
    body = signed.json()
    assert body["status"] == "SIGNED_OFF" and body["can_sign"] is False
    assert (body["signed"]["verdict"], body["signed"]["conclusion"]) == ("EFFECTIVE", "EFFECTIVE")
    assert (body["signed"]["basis"], body["signed"]["reason"]) == (None, "")
    assert body["signed"]["signoff_note"] == "Design walked through."
    assert case.verdict() == "EFFECTIVE"
    again = reviewer.post(f"{path}/sign-off", json=sign)
    assert again.status_code == 409 and "signed off" in again.json()["detail"]

    # A design deficiency logged afterwards puts the sign-off out of date: OE is not
    # cleared, and the preparer's conclusion can no longer be signed.
    case.deficiency()
    body = case.body()
    assert (body["status"], body["proposed"]) == ("OUT_OF_DATE", "NOT_EFFECTIVE")
    assert body["proposed_conclusion"] == "NOT_EFFECTIVE"
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    assert [item["reference"] for item in body["deficiencies"]] == ["D-901"]
    assert case.verdict() is None
    held = reviewer.post(f"{path}/sign-off", json=sign)
    assert (held.status_code, held.json()["detail"]) == (409, DEFICIENCY_EFFECTIVE)
    # The preparer concludes not effective on the reopened workpaper; the reviewer signs it.
    case.reopen_paper()
    standing = case.standing()
    without = _choose(owner, path, "NOT_EFFECTIVE", standing, reason=NOT_EFFECTIVE_REASON)
    assert without.status_code == 422
    recorded = _choose(
        owner, path, "NOT_EFFECTIVE", standing, basis="BOTH", reason=NOT_EFFECTIVE_REASON
    )
    assert recorded.status_code == 200, recorded.text
    case.prepare()
    # The sign-off still naming the effective choice it was about to sign: refused.
    unread = reviewer.post(
        f"{path}/sign-off",
        json={**sign, "conclusion": "NOT_EFFECTIVE", "workpaper_version": case.version},
    )
    assert (unread.status_code, unread.json()["detail"]) == (409, CHOICE_NOT_STANDING)
    not_effective = {
        **sign, "conclusion": "NOT_EFFECTIVE", "workpaper_version": case.version,
        "choice_id": recorded.json()["choice"]["id"],
    }  # fmt: skip
    resigned = reviewer.post(f"{path}/sign-off", json=not_effective)
    assert resigned.status_code == 200, resigned.text
    body = resigned.json()
    assert body["status"] == "SIGNED_OFF" and body["signed"]["deficiencies"] == ["D-901"]
    assert (body["signed"]["conclusion"], body["signed"]["basis"]) == ("NOT_EFFECTIVE", "BOTH")
    assert case.verdict() == "NOT_EFFECTIVE"
    # Another deficiency: out of date, and signed again on the same conclusion.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO deficiencies (organization_id, project_id, reference, "
            "engagement_control_id, title, deficiency_type, identified_by) "
            "VALUES (%s, %s, 'D-902', %s, 'No review of the approval', 'DESIGN', %s)",
            (team["org"], team["project"], bench.control, team["owner_id"]),
        )
    assert case.body()["status"] == "OUT_OF_DATE"
    resigned = reviewer.post(f"{path}/sign-off", json=not_effective)
    assert resigned.status_code == 200, resigned.text
    body = resigned.json()
    # Every sign-off is kept: superseded, or reopened with the workpaper.
    assert [(i["conclusion"], i["verdict"], i["reopened_from"]) for i in body["history"]] == [
        ("NOT_EFFECTIVE", "NOT_EFFECTIVE", None),
        ("NOT_EFFECTIVE", "NOT_EFFECTIVE", "SUPERSEDED"),
        ("EFFECTIVE", "EFFECTIVE", "WORKPAPER"),
    ]
    assert body["signed"]["deficiencies"] == ["D-901", "D-902"]

    # A reviewer may open it again, with a reason.
    short = reviewer.post(f"{path}/reopen", json={"reason": "No."})
    assert short.status_code == 422
    reopened = reviewer.post(
        f"{path}/reopen", json={"reason": "The walkthrough must be performed again."}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["status"] == "TO_SIGN"
    assert case.verdict() is None

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
        "design_conclusion.chosen",
        "design_conclusion.signed_off",
        "design_conclusion.reopened",
        "design_conclusion.chosen",
        "design_conclusion.signed_off",
        "design_conclusion.signed_off",
        "design_conclusion.reopened",
    ]


def test_a_recorded_d_and_i_conclusion_is_never_changed_or_deleted(migrated: Database) -> None:
    """Section 3.6 (product owner, 15 November 2026, docs/design-workpaper.md section 3.6).
    Old expectation: the sign-off was made on the records' verdict (effective) once the
    workpaper was prepared. New: on the preparer's conclusion recorded first (here not
    effective, on a logged design deficiency: with no check of the evidence nothing else
    can be signed); what it signed (the conclusion, its reason and the choice) is as
    unchangeable as the rest. Every assertion is kept."""
    team = _launched(migrated, "dc-keep")
    control = _control(team)
    concluded = _concluded(migrated, team, control)
    _design_deficiency(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    signed = reviewer.post(f"{path}/sign-off", json=_signing(concluded, "NOT_EFFECTIVE"))
    assert signed.status_code == 200, signed.text
    with connect(migrated.url) as connection:
        for change in (
            "verdict = 'EFFECTIVE'",
            "conclusion = 'EXCEPTIONS_NOTED'",
            "conclusion_reason = 'Another reason for the conclusion.'",
            "choice_id = NULL",
        ):
            with pytest.raises(psycopg.errors.RaiseException, match="never changed"):
                connection.execute(f"UPDATE design_conclusions SET {change}")
            connection.rollback()
        with pytest.raises(psycopg.errors.RaiseException, match="never deleted"):
            connection.execute("DELETE FROM design_conclusions")
        connection.rollback()
        # Only one sign-off stands per control.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                """
                INSERT INTO design_conclusions (organization_id, project_id,
                    engagement_control_id, workpaper_id, workpaper_version, verdict,
                    signed_by, conclusion, conclusion_basis, conclusion_reason, choice_id)
                SELECT organization_id, project_id, engagement_control_id, workpaper_id,
                       workpaper_version, verdict, signed_by, conclusion, conclusion_basis,
                       conclusion_reason, choice_id
                FROM design_conclusions
                """
            )


def test_reopening_the_design_workpaper_opens_the_d_and_i_conclusion(migrated: Database) -> None:
    """Section 3.6 (product owner, 15 November 2026, docs/design-workpaper.md section 3.6).
    Old expectation: the sign-off was made on the records' verdict (effective). New: on
    the preparer's conclusion (here not effective, on a logged design deficiency), which
    stays standing when the workpaper is reopened, for the preparer to keep or change on
    the draft. Every other assertion is kept."""
    team = _launched(migrated, "dc-reopen")
    owner = team["owner"]
    control = _control(team)
    concluded = _concluded(migrated, team, control)
    _design_deficiency(migrated, team, control)
    _reviewer_role(migrated, team, team["reviewer_id"])
    reviewer = _session(migrated, team["reviewer_id"])
    path = f"{_project(team)}/design-conclusions/{control}"
    signing = _signing(concluded, "NOT_EFFECTIVE")
    assert reviewer.post(f"{path}/sign-off", json=signing).status_code == 200
    before = owner.get(path).json()
    _reopen_paper(migrated, team, before["workpaper"]["id"], "Walkthrough notes to correct.")
    body = owner.get(path).json()
    assert (body["status"], body["signed"]) == ("NOT_READY", None)
    assert body["history"][0]["reopened_from"] == "WORKPAPER"
    assert body["history"][0]["reopen_reason"] == "Walkthrough notes to correct."
    assert _verdict(migrated, team, control) is None
    # The preparer's conclusion stands on the draft, and may be changed there.
    assert body["choice"] == before["choice"] and body["can_choose"] is True


def test_a_control_of_another_engagement_is_not_found(migrated: Database) -> None:
    team = _launched(migrated, "dc-tenant")
    missing = team["owner"].get(f"{_project(team)}/design-conclusions/{uuid4()}")
    assert missing.status_code == 404


class _Signing:
    """A control whose D&I request is checked (every attribute shown in the records of the
    instance; the ticket is read as a report that does not show its basis), whose design
    workpaper a person drafted, concluded on as effective and prepared (unless `concluded`
    is False: then nothing is drafted yet), and a reviewer who did not prepare it.

    Section 3.6 (product owner, 15 November 2026, docs/design-workpaper.md section 3.6).
    Old: attribute B was not shown, and the records proposed effective all the same (only
    a design deficiency counted against it); the workpaper was prepared with no conclusion
    recorded. New: every attribute is shown, so that effective is the records' proposal
    and can be recorded, and the preparer records it on the draft before preparing."""

    def __init__(self, migrated: Database, slug: str, concluded: bool = True) -> None:
        self.database = migrated
        self.bench = bench = _Bench(migrated, slug)
        self.ticket, first = _first_check_with_a_report(bench)
        self.ids = _ids(first)
        self.path = f"{bench.base}/design-conclusions/{bench.control}"
        self.paper_id = ""
        self.version = 0
        self.reviewer_id, self.reviewer = bench.member("ADMIN")
        with connect(migrated.url) as connection:
            connection.execute(
                "INSERT INTO project_memberships (organization_id, project_id, user_id, "
                "engagement_role) VALUES (%s, %s, %s, 'REVIEWER') "
                "ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = 'REVIEWER'",
                (bench.team["org"], bench.team["project"], self.reviewer_id),
            )
        if concluded:
            self.draft()
            chosen = _choose(bench.owner, self.path, "EFFECTIVE")
            assert chosen.status_code == 200, chosen.text
            self.prepare()

    def draft(self) -> None:
        self.paper_id = str(_draft_design(self.bench, None)["id"])

    def prepare(self) -> None:
        bench = self.bench
        listed = bench.owner.get(f"{bench.base}/workpapers", params={"control_id": bench.control})
        paper = next(item for item in listed.json() if item["stage"] == "DESIGN")
        prepared = bench.owner.post(
            f"{bench.base}/workpapers/{paper['id']}/prepare", json={"version": paper["version"]}
        )
        assert prepared.status_code == 200, prepared.text
        self.version = int(prepared.json()["prepared_version"])

    def reopen_paper(self) -> None:
        bench = self.bench
        [(version,)] = bench.rows(
            "SELECT version FROM workpapers WHERE id = %s", UUID(self.paper_id)
        )
        opened = bench.owner.post(
            f"{bench.base}/workpapers/{self.paper_id}/reopen",
            json={"version": version, "reason": "To conclude on what changed."},
        )
        assert opened.status_code == 200, opened.text

    def standing(self) -> str | None:
        """The id of the preparer's conclusion that stands, as the page shows it."""
        choice = self.body(self.bench.owner)["choice"]
        return None if choice is None else str(choice["id"])

    def conclude_again(self, kind: str, **more: Any) -> dict[str, Any]:
        """The preparer reopens the design workpaper, records another conclusion on the
        draft, and prepares it again. The D&I conclusion's body."""
        self.reopen_paper()
        if kind == "NOT_EFFECTIVE":
            more = {"basis": "DESIGN", "reason": NOT_EFFECTIVE_REASON} | more
        elif kind != "EFFECTIVE":
            more = {"reason": NO_INSTANCE_REASON} | more
        chosen = _choose(self.bench.owner, self.path, kind, self.standing(), **more)
        assert chosen.status_code == 200, chosen.text
        self.prepare()
        return self.body(self.bench.owner)

    def body(self, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.reviewer).get(self.path)
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def sign(self, conclusion: str = "EFFECTIVE") -> Any:
        """The reviewer signs `conclusion`, naming the preparer's choice that stands.

        Independent review, 15 November 2026 (docs/design-workpaper.md section 3.6). Old:
        it named the two-value verdict as the screen sent it then ({"verdict": ...}); new:
        the `verdict` field is no longer accepted, so it names the conclusion and the
        choice. The conclusions it is called with (effective, not effective) are those
        verdicts' own words, so each call keeps its meaning."""
        return self.sign_as(conclusion)

    def sign_as(self, conclusion: str) -> Any:
        """The reviewer signs, naming the preparer's conclusion and the choice that stands
        (where none stands, an id that names no choice)."""
        return self.reviewer.post(
            f"{self.path}/sign-off",
            json={
                "conclusion": conclusion,
                "choice_id": self.standing() or str(uuid4()),
                "workpaper_version": self.version,
            },
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
    sign-off out of date, and that the OE gate then reads no verdict.

    Rewritten for section 3.6 (product owner, 15 November 2026, docs/design-workpaper.md
    section 3.6). Old expectation: the decision recorded was "not relied on" on the only
    file, and the records' verdict was signed again as effective; once a design deficiency
    was logged nothing kept the reviewer from signing not effective, and effective was
    refused with "the records support a different verdict". New: a file not relied on no
    longer shows the attributes in the instance, so effective could not be signed again on
    it; the decision is "reliability established on review" (the same reason, naming the
    file). With the deficiency logged, the preparer's effective conclusion is refused with
    its sentence, and the preparer concludes not effective on the reopened workpaper,
    which the reviewer signs. Kept: every reason out of date, the OE gate reading none,
    the exception refused, and the exception listed after the sign-off of not effective."""
    case = _Signing(migrated, "dc-changed")
    bench, ids = case.bench, case.ids

    def resign(conclusion: str = "EFFECTIVE") -> None:
        signed = case.sign(conclusion)
        assert signed.status_code == 200, signed.text
        assert (signed.json()["status"], signed.json()["out_of_date"]) == ("SIGNED_OFF", [])
        assert case.verdict() == conclusion

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
    assert _decide_reliability(bench, case.ticket, "ESTABLISHED_ON_REVIEW").status_code == 200
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
    # Independent review, 15 November 2026 (docs/design-workpaper.md section 3.6): old,
    # the one reason [TICKMARK_ON_B]; new, the sign-off was made from the preparer's
    # effective choice, so the rule that allowed it is read again and its own sentence
    # follows (an exception stands on B).
    assert _tickmark(bench, ids["B"], "EXCEPTION").status_code == 200
    body = out_of_date()
    assert (body["out_of_date"], body["proposed"]) == (
        [TICKMARK_ON_B, EXCEPTION_STANDS.format(code="B")], "EFFECTIVE",
    )  # fmt: skip
    assert (body["blocking"], body["can_sign"]) == ([EXCEPTION_ON.format(code="B")], False)
    refused = case.sign()
    assert refused.status_code == 409
    assert refused.json()["detail"] == EXCEPTION_ON.format(code="B")
    assert case.verdict() is None

    # A design deficiency logged for it: the records propose not effective, nothing more
    # is said of the exception, which stays on the conclusion for the reviewer to read,
    # and the preparer's effective conclusion cannot be signed.
    case.deficiency()
    body = out_of_date()
    assert body["out_of_date"] == [
        "a design deficiency was logged after the sign-off", TICKMARK_ON_B,
    ]  # fmt: skip
    assert (body["proposed"], body["proposed_conclusion"]) == ("NOT_EFFECTIVE", "NOT_EFFECTIVE")
    assert (body["blocking"], body["can_sign"]) == ([DEFICIENCY_EFFECTIVE], False)
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    still = case.sign("EFFECTIVE")
    assert (still.status_code, still.json()["detail"]) == (409, DEFICIENCY_EFFECTIVE)
    # The preparer concludes not effective on the reopened workpaper; the reviewer signs.
    case.conclude_again("NOT_EFFECTIVE")
    resign("NOT_EFFECTIVE")
    body = case.body()
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    assert body["signed"]["deficiencies"] == ["D-901"]
    assert body["signed"]["conclusion"] == "NOT_EFFECTIVE"


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
    # exception is not read. Section 3.6 (product owner, 15 November 2026,
    # docs/design-workpaper.md section 3.6): old expectation, the conclusion could then be
    # signed as effective (only a design deficiency counted against it); new, nothing shows
    # the attributes any more, so the preparer's effective conclusion cannot be signed.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET status = 'REMOVED', waive_reason = '', "
            "waived_by = NULL, waived_at = NULL WHERE id = %s",
            (requirement,),
        )
    body = case.body()
    assert (body["exceptions"], body["can_sign"]) == ([], False)
    [held] = body["blocking"]
    assert held.endswith("not yet shown in the records of an instance, so the conclusion "
                         "cannot be “Effective”")  # fmt: skip
    assert case.sign().status_code == 409 and case.verdict() is None

    # A sign-off as effective made from the preparer's effective choice while the request
    # was removed: the rules of section 3.6 refuse it through the route, so it is written
    # here directly. Independent review, 15 November 2026 (docs/design-workpaper.md
    # section 3.6): old, such a sign-off held (SIGNED_OFF, the OE gate open) until the
    # exception counted again; new, a sign-off made from a choice is held to its
    # conclusion's rule on the records as they are, so with nothing showing the
    # attributes it is out of date at once, in the rule's own sentence, and the OE gate
    # stays shut.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO design_conclusions (
                organization_id, project_id, engagement_control_id, workpaper_id,
                workpaper_version, verdict, signed_by, conclusion, conclusion_reason, choice_id
            )
            SELECT organization_id, project_id, engagement_control_id, workpaper_id, %s,
                   'EFFECTIVE', %s, 'EFFECTIVE', reason, id
            FROM design_conclusion_choices
            WHERE engagement_control_id = %s AND ended_at IS NULL AND kind = 'EFFECTIVE'
            """,
            (case.version, case.reviewer_id, UUID(bench.control)),
        )
    body = case.body()
    assert body["status"] == "OUT_OF_DATE" and case.verdict() is None
    assert case.gate() == GATE_DESIGN
    [broken] = body["out_of_date"]
    assert broken.endswith("not yet shown in the records of an instance, so the conclusion "
                           "cannot be “Effective”")  # fmt: skip

    # The rule this test keeps (an exception that comes to stand under a sign-off as
    # effective, with nothing recorded since, puts it out of date) now applies to a
    # sign-off made before preparers chose (no choice_id, and no choice standing), which
    # the service can no longer make: the one above is reopened, the choice ended and the
    # sign-off written as one of those, while the request is removed.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE design_conclusions SET reopened_at = clock_timestamp(), reopened_by = %s, "
            "reopen_reason = 'Written again as a sign-off made before section 3.6.', "
            "reopened_from = 'PERSON' WHERE engagement_control_id = %s AND reopened_at IS NULL",
            (case.reviewer_id, UUID(bench.control)),
        )
        connection.execute(
            "UPDATE design_conclusion_choices SET ended_at = clock_timestamp(), "
            "ended_by = recorded_by, ended_as = 'REPLACED' "
            "WHERE engagement_control_id = %s AND ended_at IS NULL",
            (UUID(bench.control),),
        )
        connection.execute(
            """
            INSERT INTO design_conclusions (
                organization_id, project_id, engagement_control_id, workpaper_id,
                workpaper_version, verdict, signed_by, conclusion
            )
            SELECT organization_id, project_id, engagement_control_id, id, %s, 'EFFECTIVE',
                   %s, 'EFFECTIVE'
            FROM workpapers WHERE engagement_control_id = %s AND stage = 'DESIGN'
            """,
            (case.version, case.reviewer_id, UUID(bench.control)),
        )
    assert case.body()["status"] == "SIGNED_OFF"
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
    # Old: refused with EXCEPTION_ON (the effective choice stood); new: no choice stands
    # in the state a sign-off made before section 3.6 is in, so NO_CHOICE comes first
    # (the exception's refusal of effective is asserted above, in `blocked`).
    refused = case.sign_as("EFFECTIVE")
    assert (refused.status_code, refused.json()["detail"]) == (409, NO_CHOICE)
    # With a design deficiency logged the records propose not effective; the preparer
    # concludes so on the reopened workpaper, and the reviewer signs it.
    case.deficiency()
    body = case.body()
    assert body["out_of_date"] == ["a design deficiency was logged after the sign-off"]
    # Old: blocking [DEFICIENCY_EFFECTIVE] (the effective choice stood); new: [NO_CHOICE].
    assert (body["proposed"], body["blocking"]) == ("NOT_EFFECTIVE", [NO_CHOICE])
    case.conclude_again("NOT_EFFECTIVE")
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
    # out while it is not, and counts again as soon as it is approved again. Section 3.6
    # (product owner, 15 November 2026, docs/design-workpaper.md section 3.6): old
    # expectation, nothing at all then kept the reviewer from signing; new, the request
    # waits to be checked again, so nothing shows the other attributes in the instance and
    # the preparer's effective conclusion still cannot be signed, for that reason (the
    # four approved attributes, lettered again without B).
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'SUPERSEDED' WHERE id = %s", (UUID(ids["B"]),)
        )
    body = case.body()
    assert body["exceptions"] == [] and body["can_sign"] is False
    assert body["blocking"] == [
        "attributes A, B, C and 1 more are not yet shown in the records of an instance, so "
        "the conclusion cannot be “Effective”"
    ]
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'APPROVED' WHERE id = %s", (UUID(ids["B"]),)
        )
    assert case.body()["blocking"] == [EXCEPTION_WAITING.format(code="B")]

    # Reopened with a reason, by the id the conclusion gives (the D&I list shows no
    # tickmark of a request that waits to be checked): nothing stands. Section 3.6: old
    # expectation, it was then signed at once; new, it is signed once the request's check
    # has finished and shows the attributes again.
    reopened = _reopen_tickmark(bench, ids["B"], recorded)
    assert reopened.status_code == 200, reopened.text
    body = case.body()
    assert (body["exceptions"], body["can_sign"]) == ([], False)
    _finish_check(bench, "ticket REQ-1041.txt")
    body = case.body()
    assert (body["blocking"], body["exceptions"], body["can_sign"]) == ([], [], True)
    signed = case.sign()
    assert signed.status_code == 200, signed.text
    assert case.verdict() == "EFFECTIVE" and case.gate() is None
