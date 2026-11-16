"""The preparer concludes; the agent proposes (docs/design-workpaper.md, section 3.6; the
product owner, 15 November 2026; migration 0165). Synthetic data only.

Audit integrity:

- the preparer's conclusion is a person's (TASK_UPDATE, never an agent), recorded only on
  a draft design workpaper that is not being drafted, written once and ended once (as
  REPLACED by the next), never deleted, one standing per control, read-only on an archived
  engagement, and a stale page records nothing;
- the records' rules refuse what they must (effective while a deficiency, an exception or
  anything open stands; exceptions noted and no instance while a deficiency stands), and a
  basis or reason missing where the table needs one is a 422;
- the reviewer signs exactly the preparer's standing conclusion, recorded before the
  preparation, with its rules read again in the transaction; not concluded is never
  signed; not effective needs a standing design deficiency and opens the control's review
  as before; independence, the prepared version and out of date still hold;
- the OE gate reads the two-value verdict: effective, exceptions noted and no instance
  clear it; not effective keeps OE from being performed; a sign-off no longer holds once
  the preparer's conclusion changed;
- migration 0165 gives every existing sign-off conclusion = verdict, keeps its guard, and
  leaves the OE gate as it was.
"""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database, sign_off_design
from test_attribute_dispositions import _ids
from test_attribute_dispositions import _record as _tickmark
from test_attribute_dispositions import _reopen as _reopen_tickmark
from test_design_conclusions import (
    DEFICIENCY_EFFECTIVE,
    DEFICIENCY_NO_INSTANCE,
    EXCEPTION_ON,
    NO_INSTANCE_REASON,
    NOT_EFFECTIVE_REASON,
    _control,
)
from test_design_workpaper import _draft_design
from test_evidence_assurance import _Bench
from test_evidence_flow import _project
from test_execution import _add_user
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_outbound import _session, migrated
from test_phase_release import _launched

from ai_workforce_api import design_conclusions
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import (
    BASIS_NEEDED,
    BASIS_NOT_TAKEN,
    BEING_DRAFTED,
    CHOICE_CHANGED,
    CHOICE_RECORDED_SINCE,
    CHOICE_STALE,
    DEFICIENCY_FIRST,
    DRAFT_FIRST,
    GATE_DESIGN,
    GATE_NOT_EFFECTIVE,
    IN_PLACE_SENTENCE,
    NEVER_SIGNED,
    NO_CHOICE,
    NO_DEFICIENCY_NOR_EXCEPTION,
    PREPARED_ALREADY,
    REASON_NEEDED,
    REASON_TOO_LONG,
    RECORDED_AFTER,
    effective_controls,
    oe_gate_reason,
)
from ai_workforce_api.engagement_close import closed_detail
from ai_workforce_api.migrate import apply_migrations, migrations_dir

__all__ = ["migrated"]

REASONS = {
    "EXCEPTIONS_NOTED": "The exception on B is a timing slip, not a design deficiency.",
    "NOT_EFFECTIVE": NOT_EFFECTIVE_REASON,
    "NO_INSTANCE": NO_INSTANCE_REASON,
    "NOT_CONCLUDED": "The walkthrough is to be performed again with the new owner.",
}
_STANDING: Any = object()


class _Draft:
    """A control whose D&I request is checked (every attribute shown in the records of the
    instance, unless `how` says otherwise; the ticket read as a report that does not show
    its basis), whose design workpaper the owner drafted (unless `draft` is False), and a
    reviewer who did not prepare it."""

    def __init__(self, migrated: Database, slug: str, draft: bool = True, **how: str) -> None:
        self.database = migrated
        self.bench = bench = _Bench(migrated, slug)
        self.ticket, first = _first_check_with_a_report(bench, **how)
        self.ids = _ids(first)
        self.path = f"{bench.base}/design-conclusions/{bench.control}"
        self.version = 0
        reviewer_id, self.reviewer = bench.member("ADMIN")
        self.reviewer_id = reviewer_id
        self.engagement_role(reviewer_id, "REVIEWER")
        self.paper_id = ""
        if draft:
            self.draft()

    def engagement_role(self, user_id: Any, role: str) -> None:
        with connect(self.database.url) as connection:
            connection.execute(
                "INSERT INTO project_memberships (organization_id, project_id, user_id, "
                "engagement_role) VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (project_id, user_id) DO UPDATE SET engagement_role = %s",
                (self.bench.team["org"], self.bench.team["project"], user_id, role, role),
            )

    def draft(self) -> None:
        self.paper_id = str(_draft_design(self.bench, None)["id"])

    def body(self, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.bench.owner).get(self.path)
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def choose(
        self, kind: str, replaces: Any = _STANDING, client: TestClient | None = None, **more: Any
    ) -> Any:
        """The preparer records the conclusion, having seen what stands (by default, what
        stands now)."""
        if replaces is _STANDING:
            standing = self.body()["choice"]
            replaces = None if standing is None else standing["id"]
        sent = {"kind": kind, "replaces": replaces, **more}
        return (client or self.bench.owner).post(f"{self.path}/choice", json=sent)

    def chosen(self, kind: str, **more: Any) -> dict[str, Any]:
        if kind in REASONS and "reason" not in more:
            more["reason"] = REASONS[kind]
        if kind == "NOT_EFFECTIVE" and "basis" not in more:
            more["basis"] = "DESIGN"
        answer = self.choose(kind, **more)
        assert answer.status_code == 200, answer.text
        body: dict[str, Any] = answer.json()
        return body

    def paper(self) -> dict[str, Any]:
        bench = self.bench
        listed = bench.owner.get(f"{bench.base}/workpapers", params={"control_id": bench.control})
        found: dict[str, Any] = next(p for p in listed.json() if p["stage"] == "DESIGN")
        return found

    def prepare(self) -> None:
        paper = self.paper()
        prepared = self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/prepare",
            json={"version": paper["version"]},
        )
        assert prepared.status_code == 200, prepared.text
        self.version = int(prepared.json()["prepared_version"])

    def reopen(self) -> None:
        paper = self.paper()
        opened = self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/reopen",
            json={"version": paper["version"], "reason": "To conclude on what changed."},
        )
        assert opened.status_code == 200, opened.text

    def sign_as(self, conclusion: str, client: TestClient | None = None) -> Any:
        return (client or self.reviewer).post(
            f"{self.path}/sign-off",
            json={"conclusion": conclusion, "workpaper_version": self.version},
        )

    def rows(self, query: str, *params: Any) -> list[tuple[Any, ...]]:
        with connect(self.database.url) as connection:
            return list(connection.execute(query, params).fetchall())

    def choices(self) -> list[tuple[Any, ...]]:
        """Every choice on record: kind, ended_as, who ended it, oldest first."""
        return self.rows(
            "SELECT kind, ended_as, ended_by FROM design_conclusion_choices "
            "WHERE engagement_control_id = %s ORDER BY recorded_at, id",
            UUID(self.bench.control),
        )

    def signed_row(self) -> tuple[Any, ...]:
        [row] = self.rows(
            "SELECT verdict, conclusion, conclusion_basis, conclusion_reason, choice_id "
            "FROM design_conclusions WHERE engagement_control_id = %s AND reopened_at IS NULL",
            UUID(self.bench.control),
        )
        return row

    def gate(self) -> str | None:
        with connect(self.database.url) as connection:
            return oe_gate_reason(connection, UUID(self.bench.control))

    def effective(self) -> bool:
        with connect(self.database.url) as connection:
            found = effective_controls(connection, UUID(str(self.bench.team["project"])))
        return UUID(self.bench.control) in found

    def deficiency(self, reference: str = "D-901") -> None:
        bench = self.bench
        with connect(self.database.url) as connection:
            connection.execute(
                "INSERT INTO deficiencies (organization_id, project_id, reference, "
                "engagement_control_id, title, deficiency_type, identified_by) "
                "VALUES (%s, %s, %s, %s, 'No approval step in the design', 'DESIGN', %s)",
                (bench.team["org"], bench.team["project"], reference, bench.control,
                 bench.team["owner_id"]),
            )  # fmt: skip


def _refused(answer: Any, status: int, detail: str) -> None:
    assert (answer.status_code, answer.json()["detail"]) == (status, detail), answer.text


def test_the_preparer_records_each_conclusion_on_the_draft_and_one_stands(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-record")
    owner_id = case.bench.team["owner_id"]

    # Every attribute shown in the instance: the records propose effective, and say why.
    body = case.body()
    assert (body["proposed_conclusion"], body["can_choose"], body["choice"]) == (
        "EFFECTIVE", True, None,
    )  # fmt: skip
    assert body["proposed_reasons"] == [NO_DEFICIENCY_NOR_EXCEPTION, IN_PLACE_SENTENCE]
    assert (body["design"]["result"], body["implementation"]["result"]) == (
        "DESIGNED", "IN_PLACE",
    )  # fmt: skip

    # What the table needs, or does not take: 422, and nothing is recorded.
    _refused(case.choose("NOT_EFFECTIVE", reason=NOT_EFFECTIVE_REASON), 422, BASIS_NEEDED)
    _refused(case.choose("NOT_EFFECTIVE", basis="DESIGN"), 422, REASON_NEEDED)
    _refused(case.choose("EXCEPTIONS_NOTED"), 422, REASON_NEEDED)
    _refused(case.choose("NO_INSTANCE", reason="Too short"), 422, REASON_NEEDED)
    _refused(case.choose("NO_INSTANCE", reason="   \n  "), 422, REASON_NEEDED)
    _refused(case.choose("EFFECTIVE", basis="DESIGN"), 422, BASIS_NOT_TAKEN)
    # Not concluded differs from the proposal here, so it needs the reason.
    _refused(case.choose("NOT_CONCLUDED"), 422, REASON_NEEDED)
    _refused(case.choose("NO_INSTANCE", reason="x" * 1001), 422, REASON_TOO_LONG)
    assert case.choose("MAYBE").status_code == 422
    assert case.choices() == []

    # Each kind, each replacing the one before it: one stands, the others ended as
    # REPLACED by the person, never deleted.
    effective = case.chosen("EFFECTIVE")["choice"]
    assert (effective["kind"], effective["basis"], effective["reason"]) == ("EFFECTIVE", None, "")
    assert (effective["proposed_kind"], effective["workpaper_version"]) == ("EFFECTIVE", 1)
    assert effective["recorded_by"] == case.bench.name(owner_id)
    case.chosen("EXCEPTIONS_NOTED")
    case.chosen("NOT_EFFECTIVE", basis="BOTH")
    hostile = "<b>No change</b> was made​ in the period, so there is nothing to walk."
    no_instance = case.chosen("NO_INSTANCE", reason=hostile)["choice"]
    # The person's text, cleaned as text is.
    assert no_instance["reason"] == "No change was made in the period, so there is nothing to walk."
    last = case.chosen("NOT_CONCLUDED")["choice"]
    assert (last["kind"], last["reason"]) == ("NOT_CONCLUDED", REASONS["NOT_CONCLUDED"])
    assert case.choices() == [
        ("EFFECTIVE", "REPLACED", owner_id),
        ("EXCEPTIONS_NOTED", "REPLACED", owner_id),
        ("NOT_EFFECTIVE", "REPLACED", owner_id),
        ("NO_INSTANCE", "REPLACED", owner_id),
        ("NOT_CONCLUDED", None, None),
    ]
    [(basis,)] = case.rows(
        "SELECT basis FROM design_conclusion_choices WHERE kind = 'NOT_EFFECTIVE'"
    )
    assert basis == "BOTH"

    # A stale page records nothing: one recorded since, or one that never stood.
    _refused(case.choose("EFFECTIVE", replaces=None), 409, CHOICE_RECORDED_SINCE)
    _refused(case.choose("EFFECTIVE", replaces=no_instance["id"]), 409, CHOICE_RECORDED_SINCE)
    assert len(case.choices()) == 5
    other = _Draft(migrated, "dcc-record-b")
    _refused(other.choose("EFFECTIVE", replaces=str(uuid4())), 409, CHOICE_STALE)

    # Each is an audit event of the person, with no more than 200 characters of the reason.
    long_reason = "The walkthrough could not be performed this year. " * 12
    case.chosen("NO_INSTANCE", reason=long_reason)
    events = case.rows(
        "SELECT actor_user_id, payload FROM audit_events WHERE action = %s "
        "AND project_id = %s ORDER BY created_at, id",
        "design_conclusion.chosen",
        case.bench.team["project"],
    )
    assert [payload["kind"] for _actor, payload in events] == [
        "EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_EFFECTIVE", "NO_INSTANCE", "NOT_CONCLUDED",
        "NO_INSTANCE",
    ]  # fmt: skip
    assert {actor for actor, _payload in events} == {owner_id}
    first, *_middle, latest = [payload for _actor, payload in events]
    assert first | {"choice_id": ""} == {
        "control_id": case.bench.control, "choice_id": "", "kind": "EFFECTIVE", "basis": None,
        "proposed_kind": "EFFECTIVE", "workpaper_version": 1, "reason": "", "replaced": None,
        "replaced_kind": None,
    }  # fmt: skip
    assert events[2][1]["basis"] == "BOTH"
    assert latest["reason"] == long_reason.strip()[:200] and len(latest["reason"]) == 200
    assert latest["replaced_kind"] == "NOT_CONCLUDED"

    # The table keeps what was recorded: written once, ended once, never deleted.
    with connect(migrated.url) as connection:
        for statement, message in (
            ("UPDATE design_conclusion_choices SET kind = 'EFFECTIVE' WHERE ended_at IS NULL",
             "never changes"),
            ("UPDATE design_conclusion_choices SET reason = 'Another reason entirely.' "
             "WHERE ended_at IS NOT NULL", "never changed"),
            ("DELETE FROM design_conclusion_choices", "never deleted"),
        ):  # fmt: skip
            with pytest.raises(psycopg.errors.RaiseException, match=message):
                connection.execute(statement)
            connection.rollback()
        # One standing per control.
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute(
                "INSERT INTO design_conclusion_choices (organization_id, project_id, "
                "engagement_control_id, workpaper_id, workpaper_version, kind, proposed_kind, "
                "recorded_by) SELECT organization_id, project_id, engagement_control_id, "
                "workpaper_id, workpaper_version, 'EFFECTIVE', 'EFFECTIVE', recorded_by "
                "FROM design_conclusion_choices WHERE ended_at IS NULL"
            )
        connection.rollback()
        # A basis only for not effective, and a reason where one is needed.
        for kind, basis, reason in (
            ("EFFECTIVE", "'DESIGN'", "''"),
            ("NOT_EFFECTIVE", "NULL", f"'{NOT_EFFECTIVE_REASON}'"),
            ("NOT_EFFECTIVE", "'DESIGN'", "''"),
            ("NO_INSTANCE", "NULL", "'short'"),
        ):
            connection.execute(
                "UPDATE design_conclusion_choices SET ended_at = clock_timestamp(), "
                "ended_by = recorded_by, ended_as = 'REPLACED' WHERE ended_at IS NULL"
            )
            with pytest.raises(psycopg.errors.CheckViolation):
                connection.execute(
                    "INSERT INTO design_conclusion_choices (organization_id, project_id, "
                    "engagement_control_id, workpaper_id, workpaper_version, kind, basis, "
                    "reason, proposed_kind, recorded_by) SELECT organization_id, project_id, "
                    f"engagement_control_id, workpaper_id, workpaper_version, '{kind}', "
                    f"{basis}, {reason}, 'EFFECTIVE', recorded_by "
                    "FROM design_conclusion_choices LIMIT 1"
                )
            connection.rollback()


def test_only_a_person_who_may_update_the_work_records_a_conclusion(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Draft(migrated, "dcc-who")
    outsider = _Bench(migrated, "dcc-who-b").client
    bench = case.bench

    def asks(client: TestClient | None) -> int:
        answer = case.choose("EFFECTIVE", replaces=None, client=client)
        return int(answer.status_code)

    # A Reviewer of the firm reads the conclusion and records nothing; so does the reviewer
    # who signs (an engagement role does not give TASK_UPDATE).
    _reviewer_id, reviewer = bench.member("REVIEWER")
    assert reviewer.get(case.path).status_code == 200
    assert asks(reviewer) == 403
    # A person of the firm who is not on the engagement, and another firm's person: as the
    # conclusion's own read answers them. No session: not signed in.
    with connect(migrated.url) as connection:
        stranger_id = _add_user(
            connection, bench.team["org"], f"stranger-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
    stranger = _session(migrated, stranger_id)
    assert asks(stranger) == stranger.get(case.path).status_code
    assert asks(stranger) in (403, 404)
    assert asks(outsider) == 404
    assert asks(TestClient(bench.owner.app)) == 401
    # The route takes its principal from the session, always a person's: an agent
    # principal reaching it is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(design_conclusions, "_session_principal", lambda _request: agent)
        assert asks(None) in (403, 404)
    assert case.choices() == []
    # The owner may.
    assert asks(None) == 200

    # An archived engagement is read-only: the middleware refuses the change, and the
    # table refuses a write that reaches it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    archived = case.choose("NO_INSTANCE", reason=NO_INSTANCE_REASON)
    _refused(archived, 409, closed_detail("ARCHIVED"))
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        connection.execute(
            "UPDATE design_conclusion_choices SET ended_at = clock_timestamp(), "
            "ended_by = recorded_by, ended_as = 'REPLACED'"
        )
    assert case.choices() == [("EFFECTIVE", None, None)]
    assert case.body()["can_choose"] is False


def test_a_conclusion_is_recorded_only_on_a_draft_that_is_not_being_drafted(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-paper", draft=False)
    # No design workpaper yet.
    assert case.body()["can_choose"] is False
    _refused(case.choose("EFFECTIVE"), 409, DRAFT_FIRST)
    case.draft()
    # Being drafted by the agent.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'PENDING' WHERE id = %s", (case.paper_id,)
        )
    assert case.body()["can_choose"] is False
    _refused(case.choose("EFFECTIVE"), 409, BEING_DRAFTED)
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE workpapers SET draft_status = 'IDLE' WHERE id = %s", (case.paper_id,)
        )
    first = case.chosen("EFFECTIVE")["choice"]
    # Prepared: reopened first.
    case.prepare()
    assert case.body()["can_choose"] is False
    _refused(case.choose("NO_INSTANCE", reason=NO_INSTANCE_REASON), 409, PREPARED_ALREADY)
    case.reopen()
    # The choice stands on the reopened workpaper, and may be changed there.
    body = case.body()
    assert (body["choice"], body["can_choose"]) == (first, True)
    assert case.chosen("NO_INSTANCE")["choice"]["kind"] == "NO_INSTANCE"


def test_the_records_rules_refuse_what_they_must(migrated: Database) -> None:
    case = _Draft(migrated, "dcc-rules", B="ABSENT")
    ids = case.ids
    # B is not shown: open, so effective cannot be recorded.
    body = case.body()
    assert body["proposed_conclusion"] == "NOT_CONCLUDED"
    assert body["implementation"]["open"] == ["B"] and body["design"]["open"] == ["B"]
    _refused(
        case.choose("EFFECTIVE"), 409,
        "attribute B is not yet shown in the records of an instance, so the conclusion "
        "cannot be “Effective”",
    )  # fmt: skip
    # A closing tickmark settles it: effective is proposed and can be recorded.
    assert _tickmark(case.bench, ids["B"], "NOT_APPLICABLE").status_code == 200
    body = case.body()
    assert (body["proposed_conclusion"], body["implementation"]["result"]) == (
        "EFFECTIVE", "IN_PLACE",
    )  # fmt: skip
    assert case.chosen("EFFECTIVE")["choice"]["proposed_kind"] == "EFFECTIVE"
    # A person's exception: exceptions noted is proposed, effective refused.
    assert _tickmark(case.bench, ids["A"], "EXCEPTION").status_code == 200
    body = case.body()
    assert (body["proposed_conclusion"], body["proposed_reasons"]) == (
        "EXCEPTIONS_NOTED", ["An exception stands on attribute A."],
    )  # fmt: skip
    _refused(
        case.choose("EFFECTIVE"), 409,
        "an exception stands on attribute A, so the conclusion cannot be “Effective”",
    )  # fmt: skip
    case.chosen("EXCEPTIONS_NOTED")
    # A design deficiency: not effective is proposed; effective, exceptions noted and no
    # instance are refused; not effective and not concluded are recorded.
    case.deficiency()
    body = case.body()
    assert (body["proposed_conclusion"], body["proposed_reasons"]) == (
        "NOT_EFFECTIVE", ["A design deficiency is logged against the control."],
    )  # fmt: skip
    _refused(case.choose("EFFECTIVE"), 409, DEFICIENCY_EFFECTIVE)
    _refused(
        case.choose("EXCEPTIONS_NOTED", reason=REASONS["EXCEPTIONS_NOTED"]), 409,
        "a design deficiency is logged, so the conclusion cannot be “Exceptions noted”",
    )  # fmt: skip
    _refused(case.choose("NO_INSTANCE", reason=NO_INSTANCE_REASON), 409, DEFICIENCY_NO_INSTANCE)
    assert case.chosen("NOT_CONCLUDED")["choice"]["proposed_kind"] == "NOT_EFFECTIVE"
    chosen = case.chosen("NOT_EFFECTIVE", basis="IMPLEMENTATION")["choice"]
    assert (chosen["kind"], chosen["basis"]) == ("NOT_EFFECTIVE", "IMPLEMENTATION")
    assert [kind for kind, _ended, _by in case.choices()] == [
        "EFFECTIVE", "EXCEPTIONS_NOTED", "NOT_CONCLUDED", "NOT_EFFECTIVE",
    ]  # fmt: skip


def test_the_reviewer_signs_the_preparers_conclusion_and_the_oe_gate_reads_its_verdict(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-sign")
    # Prepared with no conclusion recorded: nothing to sign.
    case.prepare()
    body = case.body(case.reviewer)
    assert NO_CHOICE in body["blocking"] and body["can_sign"] is False
    _refused(case.sign_as("EFFECTIVE"), 409, NO_CHOICE)
    assert case.gate() == GATE_DESIGN

    # Effective, recorded on the draft, then prepared: signed with what it rests on.
    case.reopen()
    choice = case.chosen("EFFECTIVE")["choice"]
    case.prepare()
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([], True)
    signed = case.sign_as("EFFECTIVE")
    assert signed.status_code == 200, signed.text
    record = signed.json()["signed"]
    assert (record["verdict"], record["conclusion"], record["basis"], record["reason"]) == (
        "EFFECTIVE", "EFFECTIVE", None, "",
    )  # fmt: skip
    assert case.signed_row() == ("EFFECTIVE", "EFFECTIVE", None, "", UUID(choice["id"]))
    assert case.gate() is None and case.effective()
    [(payload,)] = case.rows(
        "SELECT payload FROM audit_events WHERE action = 'design_conclusion.signed_off' "
        "AND project_id = %s",
        case.bench.team["project"],
    )
    assert (payload["conclusion"], payload["verdict"], payload["choice_id"]) == (
        "EFFECTIVE", "EFFECTIVE", choice["id"],
    )  # fmt: skip

    # The preparer's conclusion changed under the sign-off (here, written in the table
    # while the workpaper stays prepared): the sign-off no longer holds, and the one now
    # standing was recorded after the preparation, so it cannot be signed.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE design_conclusion_choices SET ended_at = clock_timestamp(), "
            "ended_by = recorded_by, ended_as = 'REPLACED' WHERE ended_at IS NULL"
        )
        connection.execute(
            "INSERT INTO design_conclusion_choices (organization_id, project_id, "
            "engagement_control_id, workpaper_id, workpaper_version, kind, reason, "
            "proposed_kind, recorded_by) SELECT organization_id, project_id, "
            "engagement_control_id, workpaper_id, workpaper_version, 'NO_INSTANCE', %s, "
            "'EFFECTIVE', recorded_by FROM design_conclusion_choices LIMIT 1",
            (NO_INSTANCE_REASON,),
        )
    body = case.body(case.reviewer)
    assert (body["status"], body["out_of_date"]) == ("OUT_OF_DATE", [CHOICE_CHANGED])
    assert case.gate() == GATE_DESIGN and not case.effective()
    assert body["blocking"] == [RECORDED_AFTER]
    _refused(case.sign_as("NO_INSTANCE"), 409, RECORDED_AFTER)

    # Not concluded is never signed.
    case.reopen()
    case.chosen("NOT_CONCLUDED")
    case.prepare()
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([NEVER_SIGNED], False)
    _refused(case.sign_as("NOT_CONCLUDED"), 409, NEVER_SIGNED)

    # No instance to walk through: never by the preparer, and signed by the reviewer, it
    # clears OE with the verdict effective.
    case.reopen()
    case.chosen("NO_INSTANCE")
    case.prepare()
    owner_id = case.bench.team["owner_id"]
    case.engagement_role(owner_id, "REVIEWER")
    own = case.sign_as("NO_INSTANCE", case.bench.owner)
    assert own.status_code == 409 and "another reviewer" in own.json()["detail"]
    signed = case.sign_as("NO_INSTANCE")
    assert signed.status_code == 200, signed.text
    assert case.signed_row()[:4] == ("EFFECTIVE", "NO_INSTANCE", None, NO_INSTANCE_REASON)
    assert case.gate() is None and case.effective()


def test_exceptions_noted_is_signed_over_a_persons_exception_and_effective_is_not(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-exceptions")
    ids = case.ids
    assert _tickmark(case.bench, ids["B"], "EXCEPTION").status_code == 200
    body = case.body()
    assert body["proposed_conclusion"] == "EXCEPTIONS_NOTED"
    assert (body["design"]["result"], body["implementation"]["result"]) == (
        "EXCEPTIONS", "EXCEPTIONS",
    )  # fmt: skip
    case.chosen("EXCEPTIONS_NOTED")
    case.prepare()
    # The exception is what it concludes on: nothing keeps the reviewer from signing, and
    # the two-value verdict the screen sends today signs the preparer's conclusion.
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([], True)
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    signed = case.reviewer.post(
        f"{case.path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": case.version}
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["signed"]["conclusion"] == "EXCEPTIONS_NOTED"
    assert (signed.json()["status"], signed.json()["out_of_date"]) == ("SIGNED_OFF", [])
    assert case.signed_row()[:4] == (
        "EFFECTIVE", "EXCEPTIONS_NOTED", None, REASONS["EXCEPTIONS_NOTED"],
    )  # fmt: skip
    # It clears OE, and the standing exception does not put it out of date.
    assert case.gate() is None and case.effective()

    # Effective is never signed over a person's exception: one recorded after the
    # preparer chose effective is read again at the sign-off.
    case.reopen()
    disposition = case.rows(
        "SELECT id FROM attribute_dispositions WHERE attribute_id = %s AND ended_at IS NULL",
        UUID(ids["B"]),
    )[0][0]
    assert _reopen_tickmark(case.bench, ids["B"], str(disposition)).status_code == 200
    case.chosen("EFFECTIVE")
    assert _tickmark(case.bench, ids["B"], "EXCEPTION").status_code == 200
    case.prepare()
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([EXCEPTION_ON.format(code="B")], False)
    _refused(case.sign_as("EFFECTIVE"), 409, EXCEPTION_ON.format(code="B"))
    assert case.gate() == GATE_DESIGN and not case.effective()


def test_not_effective_needs_a_standing_design_deficiency_and_opens_the_review(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-not-effective")
    case.chosen("NOT_EFFECTIVE", basis="IMPLEMENTATION")
    case.prepare()
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([DEFICIENCY_FIRST], False)
    _refused(case.sign_as("NOT_EFFECTIVE"), 409, DEFICIENCY_FIRST)
    assert case.gate() == GATE_DESIGN
    case.deficiency()
    signed = case.sign_as("NOT_EFFECTIVE")
    assert signed.status_code == 200, signed.text
    assert signed.json()["signed"]["deficiencies"] == ["D-901"]
    assert case.signed_row()[:4] == (
        "NOT_EFFECTIVE", "NOT_EFFECTIVE", "IMPLEMENTATION", NOT_EFFECTIVE_REASON,
    )  # fmt: skip
    # OE is not performed, and the control's review opens on the design alone, as before.
    assert case.gate() == GATE_NOT_EFFECTIVE and not case.effective()
    assert case.rows(
        "SELECT status, reperform_status FROM control_reviews "
        "WHERE engagement_control_id = %s AND test_round_id IS NULL",
        UUID(case.bench.control),
    ) == [("OPEN", "IDLE")]


def test_the_workpaper_view_carries_the_results_and_a_file_not_relied_on_shows_nothing(
    migrated: Database,
) -> None:
    case = _Draft(migrated, "dcc-view")
    bench = case.bench
    case.chosen("EFFECTIVE")

    def view() -> dict[str, Any]:
        found = bench.owner.get(f"{bench.base}/controls/{bench.control}/design-workpaper")
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    # Shown in the records of the instance; the results and the conclusion as the D&I
    # conclusion gives them, from the one read.
    shown = view()
    assert {a["shown_by"] for a in shown["attributes"]} == {"IMPLEMENTATION"}
    conclusion = case.body()
    assert (shown["design"], shown["implementation"]) == (
        conclusion["design"], conclusion["implementation"],
    )  # fmt: skip
    assert shown["implementation"]["result"] == "IN_PLACE"
    part = shown["conclusion"]
    assert (part["proposed_conclusion"], part["proposed_reasons"], part["choice"]) == (
        conclusion["proposed_conclusion"], conclusion["proposed_reasons"], conclusion["choice"],
    )  # fmt: skip
    assert part["choice"]["kind"] == "EFFECTIVE"

    # The ticket is the only file, and a person decides it is not relied on: nothing shows
    # the attributes any more, so the instance is open and effective cannot be recorded.
    assert _decide_reliability(bench, case.ticket, "NOT_RELIED_ON").status_code == 200
    after = view()
    assert {a["shown_by"] for a in after["attributes"]} == {None}
    assert {a["state"] for a in after["attributes"]} == {"SHOWN"}
    assert (after["design"]["result"], after["implementation"]["result"]) == ("OPEN", "OPEN")
    assert case.body()["proposed_conclusion"] == "NOT_CONCLUDED"
    answer = case.choose("EFFECTIVE")
    assert answer.status_code == 409 and "cannot be “Effective”" in answer.json()["detail"]


# The 0143 guard as that migration created it: the first statement of its rollback.
def _guard_of_0143() -> str:
    text = (migrations_dir() / "0143_design_conclusions.sql").read_text(encoding="utf-8")
    start = text.index("CREATE FUNCTION design_conclusions_immutable()")
    end = text.index("$$;", start) + len("$$;")
    return "CREATE OR REPLACE" + text[start + len("CREATE") : end]


def test_migration_0165_gives_each_sign_off_its_conclusion_and_keeps_the_oe_gate(
    migrated: Database,
) -> None:
    """The rollback in the migration's header, then the migration applied again over
    sign-offs made before it: a standing one and a reopened one. Each is given conclusion
    = verdict and nothing else; the guard still refuses a change; the OE gate reads the
    standing one as it did."""
    team = _launched(migrated, "dcc-migrate")
    first = _control(team)
    second = next(
        row["id"]
        for row in team["owner"].get(f"{_project(team)}/workspace/controls").json()
        if row["included"] and row["id"] != first
    )
    sign_off_design(migrated, team["project"], [first, second])
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE design_conclusions SET reopened_at = clock_timestamp(), reopened_by = "
            "signed_by, reopen_reason = 'Reopened before the migration.', reopened_from = "
            "'PERSON' WHERE engagement_control_id = %s",
            (second,),
        )
        # The rollback, as the header says it.
        connection.execute(_guard_of_0143())
        connection.execute(
            "ALTER TABLE design_conclusions DROP COLUMN choice_id, DROP COLUMN "
            "conclusion_reason, DROP COLUMN conclusion_basis, DROP COLUMN conclusion"
        )
        connection.execute("DROP TABLE design_conclusion_choices")
        connection.execute(
            "DROP FUNCTION guard_design_conclusion_choice_update(), "
            "prevent_design_conclusion_choice_deletion()"
        )
        connection.execute(
            "DELETE FROM schema_migrations WHERE version = '0165_design_conclusion_choices'"
        )
        connection.commit()
    assert apply_migrations(migrated.url, migrations_dir()) == ["0165_design_conclusion_choices"]
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT engagement_control_id, verdict, conclusion, conclusion_basis, "
            "conclusion_reason, choice_id, reopened_at IS NOT NULL FROM design_conclusions "
            "ORDER BY engagement_control_id = %s",
            (second,),
        ).fetchall()
        assert [tuple(row[1:]) for row in rows] == [
            ("EFFECTIVE", "EFFECTIVE", None, None, None, False),
            ("EFFECTIVE", "EFFECTIVE", None, None, None, True),
        ]
        # A sign-off made before preparers chose holds while none stands.
        assert oe_gate_reason(connection, UUID(first)) is None
        assert oe_gate_reason(connection, UUID(second)) == GATE_DESIGN
        with pytest.raises(psycopg.errors.RaiseException, match="never changed"):
            connection.execute("UPDATE design_conclusions SET conclusion = 'NO_INSTANCE'")
        connection.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO design_conclusions (organization_id, project_id, "
                "engagement_control_id, workpaper_id, workpaper_version, verdict, signed_by, "
                "conclusion) SELECT organization_id, project_id, engagement_control_id, "
                "workpaper_id, workpaper_version, 'EFFECTIVE', signed_by, 'NOT_EFFECTIVE' "
                "FROM design_conclusions WHERE reopened_at IS NOT NULL"
            )
    body = team["owner"].get(f"{_project(team)}/design-conclusions/{first}").json()
    assert (body["status"], body["choice"]) == ("SIGNED_OFF", None)
    assert (body["signed"]["conclusion"], body["signed"]["basis"], body["signed"]["reason"]) == (
        "EFFECTIVE", None, None,
    )  # fmt: skip
