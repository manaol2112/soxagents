"""The preparer concludes; the agent proposes (docs/design-workpaper.md, section 3.6; the
product owner, 15 November 2026; migration 0165). Synthetic data only.

Audit integrity:

- the preparer's conclusion is a person's (TASK_UPDATE, never an agent), recorded only on
  a draft design workpaper that is not being drafted, written once and ended once (as
  REPLACED by the next), never deleted, one standing per control, read-only on an archived
  engagement, and a stale page records nothing;
- the records' rules refuse what they must (effective while a deficiency, an exception or
  anything open stands; exceptions noted and no instance while a deficiency stands), and a
  basis or reason missing where the table needs one is a 422; no instance is refused,
  at the choice and at the sign-off, unless the design result is DESIGNED;
- the design workpaper is prepared only on a standing conclusion that is not "Not
  concluded" (section 3.7): the server refuses it otherwise, whatever page sent it, and
  prepares nothing;
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
from support import Database, consider_design_points, sign_off_design
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
from test_evidence_assurance import LOG, _Bench, _reading
from test_evidence_flow import _project
from test_execution import _add_user
from test_file_reliability import _check as _finish_check
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_file_reliability import _reopen as _reopen_decision
from test_outbound import _session, migrated
from test_phase_release import _launched

from ai_workforce_api import design_conclusions, independence
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.design_conclusions import (
    BASIS_NEEDED,
    BASIS_NOT_TAKEN,
    BEING_DRAFTED,
    CHOICE_CHANGED,
    CHOICE_NOT_STANDING,
    CHOICE_RECORDED_SINCE,
    CHOICE_STALE,
    DEFICIENCY_FIRST,
    DEFICIENCY_LOGGED_SINCE,
    DESIGN_NOT_SHOWN,
    DRAFT_FIRST,
    EXCEPTION_SINCE,
    EXCEPTIONS_NEEDED,
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
    RECORDER_CANNOT_SIGN,
    design_verdict,
    effective_controls,
    oe_gate_reason,
)
from ai_workforce_api.engagement_close import closed_detail
from ai_workforce_api.migrate import apply_migrations, migrations_dir
from ai_workforce_api.workpaper_service import PREPARE_NEEDS_CONCLUSION, PREPARE_NOT_CONCLUDED

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

    def settle_points(self) -> None:
        """Every point of the design workpaper not settled is considered, with a reason,
        as preparing it needs (section 3.9, 16 November 2026). The check's review leaves
        the ticket's reliability open (a report that does not show its basis): before
        section 3.9 the workpaper was prepared over it; now its point is considered first.
        Moves the workpaper's version on."""
        consider_design_points(self.bench.owner, self.bench.base, self.bench.control)

    def prepare(self) -> None:
        self.settle_points()
        paper = self.paper()
        prepared = self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/prepare",
            json={"version": paper["version"]},
        )
        assert prepared.status_code == 200, prepared.text
        self.version = int(prepared.json()["prepared_version"])

    def prepare_refused(self, detail: str) -> None:
        """The owner's Prepare, sent from a page that has the latest version, is refused
        with the sentence, and nothing is prepared or audited."""
        paper = self.paper()
        before = self.rows(
            "SELECT status, prepared_by, prepared_at, prepared_version, version, "
            "(SELECT count(*) FROM audit_events WHERE action = 'workpaper.prepared' "
            "AND target_id = w.id) FROM workpapers w WHERE id = %s",
            UUID(paper["id"]),
        )
        refused = self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/prepare",
            json={"version": paper["version"]},
        )
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"] == detail
        assert (
            self.rows(
                "SELECT status, prepared_by, prepared_at, prepared_version, version, "
                "(SELECT count(*) FROM audit_events WHERE action = 'workpaper.prepared' "
                "AND target_id = w.id) FROM workpapers w WHERE id = %s",
                UUID(paper["id"]),
            )
            == before
        )
        assert before[0][0] == "DRAFT" and before[0][1] is None

    def prepared_before_the_rule(self) -> None:
        """The design workpaper marked prepared at its current version, written directly:
        a workpaper prepared before the server refused a prepare with no conclusion, or
        with "Not concluded" (section 3.7, 16 November 2026), which the service cannot
        make now. The sign-off still refuses to sign it."""
        with connect(self.database.url) as connection:
            row = connection.execute(
                "UPDATE workpapers SET status = 'PREPARED', prepared_by = requested_by, "
                "prepared_at = clock_timestamp(), prepared_version = current_version, "
                "version = version + 1 WHERE id = %s RETURNING prepared_version",
                (self.paper()["id"],),
            ).fetchone()
        assert row is not None
        self.version = int(row[0])

    def reopen(self) -> None:
        paper = self.paper()
        opened = self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/reopen",
            json={"version": paper["version"], "reason": "To conclude on what changed."},
        )
        assert opened.status_code == 200, opened.text

    def sign_as(
        self, conclusion: str, client: TestClient | None = None, choice_id: Any = _STANDING
    ) -> Any:
        """The reviewer signs `conclusion`, naming the choice they read (by default the one
        standing now; where none stands, an id that names no choice)."""
        if choice_id is _STANDING:
            standing = self.body()["choice"]
            choice_id = str(uuid4()) if standing is None else standing["id"]
        return (client or self.reviewer).post(
            f"{self.path}/sign-off",
            json={"conclusion": conclusion, "choice_id": choice_id,
                  "workpaper_version": self.version},
        )  # fmt: skip

    def view(self) -> dict[str, Any]:
        """The design workpaper's assembled view."""
        bench = self.bench
        found = bench.owner.get(f"{bench.base}/controls/{bench.control}/design-workpaper")
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

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

    def verdict(self) -> str | None:
        with connect(self.database.url) as connection:
            return design_verdict(
                connection, UUID(str(self.bench.team["project"])), UUID(self.bench.control)
            )

    def shut(self) -> None:
        """OE is not cleared, as each of the gate's readers reads it: the verdict, the gate,
        the engagement's effective controls, and the phase progress the page reads."""
        assert self.verdict() is None
        assert self.gate() == GATE_DESIGN
        assert not self.effective()
        assert self.design_complete() is False

    def cleared(self) -> None:
        assert self.verdict() == "EFFECTIVE"
        assert self.gate() is None
        assert self.effective()
        assert self.design_complete() is True

    def design_complete(self) -> bool:
        """Whether the phase progress (the route the page reads) has D&I complete."""
        bench = self.bench
        found = bench.owner.get(f"{bench.base}/phase-progress")
        assert found.status_code == 200, found.text
        control = next(c for c in found.json()["controls"] if c["control_id"] == bench.control)
        return bool(next(p for p in control["phases"] if p["phase"] == "DESIGN")["complete"])

    def later_check(self, **how: str) -> None:
        """Another file reaches the request and the request is checked again, by `how`
        (every attribute shown unless it says otherwise): a check that finishes now."""
        self.bench.add("sap change log.txt", LOG)
        self.bench.read_next(_reading("change_history"))
        _finish_check(self.bench, "ticket REQ-1041.txt", "sap change log.txt", **how)

    def concluded_and_signed(self, kind: str) -> dict[str, Any]:
        """The preparer records `kind` on the draft, prepares, and the reviewer signs it
        through the service. The D&I conclusion's body after the sign-off."""
        self.chosen(kind)
        self.prepare()
        signed = self.sign_as(kind)
        assert signed.status_code == 200, signed.text
        body: dict[str, Any] = signed.json()
        assert (body["status"], body["out_of_date"]) == ("SIGNED_OFF", [])
        return body

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
    # Exceptions noted needs an exception on record (independent review, 15 November 2026,
    # docs/design-workpaper.md section 3.6). Old: recorded here with every attribute shown
    # and no exception; new: refused so, and recorded once a person's exception stands on
    # B, which is then reopened for the kinds that follow.
    _refused(
        case.choose("EXCEPTIONS_NOTED", reason=REASONS["EXCEPTIONS_NOTED"]), 409,
        EXCEPTIONS_NEEDED,
    )  # fmt: skip
    assert _tickmark(case.bench, case.ids["B"], "EXCEPTION").status_code == 200
    case.chosen("EXCEPTIONS_NOTED")
    [(disposition,)] = case.rows(
        "SELECT id FROM attribute_dispositions WHERE attribute_id = %s AND ended_at IS NULL",
        UUID(case.ids["B"]),
    )
    assert _reopen_tickmark(case.bench, case.ids["B"], str(disposition)).status_code == 200
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
    # No instance says the design is effective: refused while the design is open.
    _refused(case.choose("NO_INSTANCE", reason=NO_INSTANCE_REASON), 409, DESIGN_NOT_SHOWN)
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
    # The design reads as an exception, not as designed: no instance is refused.
    _refused(case.choose("NO_INSTANCE", reason=NO_INSTANCE_REASON), 409, DESIGN_NOT_SHOWN)
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
    # No conclusion recorded: nothing to sign. Rewritten 16 November 2026 (section 3.7, the
    # server refuses the preparer's sign-off without a conclusion). Old: the workpaper was
    # prepared with none, then the sign-off refused. New: the prepare is refused with the
    # sentence; a workpaper prepared before that rule (written directly) is still not
    # signed, with the same sentence as before.
    case.prepare_refused(PREPARE_NEEDS_CONCLUSION)
    case.prepared_before_the_rule()
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

    # Not concluded is never signed. Rewritten 16 November 2026 (section 3.7). Old: the
    # workpaper was prepared on Not concluded, then the sign-off refused. New: the prepare
    # is refused with the sentence; one prepared before that rule (written directly) is
    # still never signed, with the same sentence as before.
    case.reopen()
    case.chosen("NOT_CONCLUDED")
    case.prepare_refused(PREPARE_NOT_CONCLUDED)
    case.prepared_before_the_rule()
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
    # Recorded while the design was shown, it can no longer be signed once the design is
    # open: the only file is decided not relied on, so nothing shows the attributes.
    assert _decide_reliability(case.bench, case.ticket, "NOT_RELIED_ON").status_code == 200
    body = case.body(case.reviewer)
    assert body["design"]["result"] == "OPEN"
    assert (body["blocking"], body["can_sign"]) == ([DESIGN_NOT_SHOWN], False)
    _refused(case.sign_as("NO_INSTANCE"), 409, DESIGN_NOT_SHOWN)
    assert case.gate() == GATE_DESIGN
    # The decision reopened: the design is shown again, and the reviewer signs.
    [(decision,)] = case.rows(
        "SELECT id FROM file_reliability_decisions WHERE ended_at IS NULL "
        "AND engagement_control_id = %s",
        UUID(case.bench.control),
    )
    assert _reopen_decision(case.bench, case.ticket, str(decision)).status_code == 200
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
    # The exception is what it concludes on: nothing keeps the reviewer from signing.
    # Independent review, 15 November 2026 (docs/design-workpaper.md section 3.6). Old: the
    # two-value verdict the screen sent ({"verdict": "EFFECTIVE"}) signed the preparer's
    # conclusion; new: `verdict` is not accepted (422, nothing signed), and the sign-off
    # names the conclusion and the choice.
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([], True)
    assert [e["code"] for e in body["exceptions"]] == ["B"]
    retired = case.reviewer.post(
        f"{case.path}/sign-off", json={"verdict": "EFFECTIVE", "workpaper_version": case.version}
    )
    assert retired.status_code == 422
    assert case.rows("SELECT count(*) FROM design_conclusions") == [(0,)]
    signed = case.sign_as("EXCEPTIONS_NOTED")
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
    # Independent review, 15 November 2026 (docs/design-workpaper.md section 3.6): old,
    # shown_by None; new, "NOT_RELIED", which counts for neither result (asserted below).
    assert {a["shown_by"] for a in after["attributes"]} == {"NOT_RELIED"}
    assert {a["state"] for a in after["attributes"]} == {"SHOWN"}
    assert (after["design"]["result"], after["implementation"]["result"]) == ("OPEN", "OPEN")
    assert case.body()["proposed_conclusion"] == "NOT_CONCLUDED"
    answer = case.choose("EFFECTIVE")
    assert answer.status_code == 409 and "cannot be “Effective”" in answer.json()["detail"]


# --- Tightened after the independent review (15 November 2026; section 3.6, last part) ---

ALL_ABSENT = {code: "ABSENT" for code in "ABCDE"}


def _exception_stands(code: str) -> str:
    return f"an exception stands on attribute {code}, so the conclusion cannot be “Effective”"


def test_the_person_who_recorded_the_conclusion_cannot_sign_it(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Finding 1. The reviewer records the preparer's conclusion (they may update the
    work); the owner prepares the workpaper. Where independence is required the person who
    recorded the standing choice cannot sign it: `can_sign` is false and `blocking` says
    so to them alone, the route refuses with the sentence and nothing is signed; another
    reviewer signs it."""
    case = _Draft(migrated, "dcc-recorder")
    recorded = case.chosen("EFFECTIVE", client=case.reviewer)["choice"]
    assert recorded["recorded_by"] == case.bench.name(case.reviewer_id)
    case.prepare()
    mine = case.body(case.reviewer)
    assert (mine["viewer_recorded"], mine["viewer_prepared"]) == (True, False)
    assert (mine["blocking"], mine["can_sign"]) == ([RECORDER_CANNOT_SIGN], False)
    _refused(case.sign_as("EFFECTIVE"), 409, RECORDER_CANNOT_SIGN)
    assert case.rows("SELECT count(*) FROM design_conclusions") == [(0,)]
    case.shut()
    # The owner did not record it: nothing is said to them of it.
    theirs = case.body()
    assert theirs["viewer_recorded"] is False and RECORDER_CANNOT_SIGN not in theirs["blocking"]
    assert RECORDER_CANNOT_SIGN == (
        "you recorded this conclusion; another reviewer must sign it off"
    )
    # Development with independence off: the rule is not applied, as for the preparer.
    with monkeypatch.context() as patched:
        patched.setattr(independence, "_required", False)
        off = case.body(case.reviewer)
        assert (off["blocking"], off["can_sign"]) == ([], True)
    # Another reviewer signs it.
    second_id, second = case.bench.member("ADMIN")
    case.engagement_role(second_id, "REVIEWER")
    theirs = case.body(second)
    assert (theirs["viewer_recorded"], theirs["blocking"], theirs["can_sign"]) == (
        False, [], True,
    )  # fmt: skip
    signed = case.sign_as("EFFECTIVE", second)
    assert signed.status_code == 200, signed.text
    case.cleared()


def test_exceptions_noted_needs_an_exception_and_every_other_attribute_shown(
    migrated: Database,
) -> None:
    """Finding 2, at the choice. Refused with no exception at all (every attribute shown,
    or none shown), and with an exception while another attribute is open; the proposal
    is then not concluded, naming both; a closing tickmark on what is open makes it the
    proposal, and it is recorded."""
    # Nothing shown, no exception.
    none = _Draft(migrated, "dcc-en-none", True, **ALL_ABSENT)
    body = none.body()
    assert body["design"]["result"] == "OPEN" and body["proposed_conclusion"] == "NOT_CONCLUDED"
    reason = REASONS["EXCEPTIONS_NOTED"]
    _refused(none.choose("EXCEPTIONS_NOTED", reason=reason), 409, EXCEPTIONS_NEEDED)
    # Every attribute shown, no exception.
    shown = _Draft(migrated, "dcc-en-shown")
    _refused(shown.choose("EXCEPTIONS_NOTED", reason=reason), 409, EXCEPTIONS_NEEDED)
    # The check's exception on B, and C not shown.
    mixed = _Draft(migrated, "dcc-en-mixed", B="DEVIATION", C="ABSENT")
    body = mixed.body()
    assert [(a["code"], a["state"]) for a in mixed.view()["attributes"]][1:3] == [
        ("B", "EXCEPTION"), ("C", "NOT_SHOWN"),
    ]  # fmt: skip
    assert (body["proposed_conclusion"], body["proposed_reasons"]) == (
        "NOT_CONCLUDED",
        ["An exception stands on attribute B.",
         "Attribute C is not yet shown in the records of an instance."],
    )  # fmt: skip
    _refused(mixed.choose("EXCEPTIONS_NOTED", reason=reason), 409, EXCEPTIONS_NEEDED)
    # A person's exception, with C still open: the same.
    person = _Draft(migrated, "dcc-en-person", C="ABSENT")
    assert _tickmark(person.bench, person.ids["B"], "EXCEPTION").status_code == 200
    body = person.body()
    assert body["proposed_conclusion"] == "NOT_CONCLUDED"
    assert body["proposed_reasons"][0] == "An exception stands on attribute B."
    _refused(person.choose("EXCEPTIONS_NOTED", reason=reason), 409, EXCEPTIONS_NEEDED)
    assert [c for case in (none, shown, mixed, person) for c in case.choices()] == []
    # C settled by a closing tickmark: exceptions noted is proposed and recorded.
    assert _tickmark(mixed.bench, mixed.ids["C"], "NOT_APPLICABLE").status_code == 200
    body = mixed.body()
    assert (body["proposed_conclusion"], body["proposed_reasons"]) == (
        "EXCEPTIONS_NOTED", ["An exception stands on attribute B."],
    )  # fmt: skip
    assert mixed.chosen("EXCEPTIONS_NOTED")["choice"]["proposed_kind"] == "EXCEPTIONS_NOTED"


def test_exceptions_noted_is_refused_at_the_sign_off_for_an_exception_noted_since(
    migrated: Database,
) -> None:
    """Finding 2, at the sign-off. What is compared with the choice's `recorded_at`: a
    person's exception's own `recorded_at`, and for an exception a check shows, the
    `finished_at` of the latest current check run that shows it."""
    # A person's exception recorded after the choice.
    case = _Draft(migrated, "dcc-en-since")
    assert _tickmark(case.bench, case.ids["B"], "EXCEPTION").status_code == 200
    case.chosen("EXCEPTIONS_NOTED")
    assert _tickmark(case.bench, case.ids["A"], "EXCEPTION").status_code == 200
    case.prepare()
    body = case.body(case.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([EXCEPTION_SINCE], False)
    _refused(case.sign_as("EXCEPTIONS_NOTED"), 409, EXCEPTION_SINCE)
    case.shut()
    # The preparer records it again on the reopened workpaper: then it is signed.
    case.reopen()
    case.chosen("EXCEPTIONS_NOTED")
    case.prepare()
    assert case.sign_as("EXCEPTIONS_NOTED").status_code == 200
    case.cleared()

    # A check that finds the exception again after the choice was recorded.
    found = _Draft(migrated, "dcc-en-found", B="DEVIATION")
    found.chosen("EXCEPTIONS_NOTED")
    found.later_check(B="DEVIATION")
    found.prepare()
    body = found.body(found.reviewer)
    assert (body["blocking"], body["can_sign"]) == ([EXCEPTION_SINCE], False)
    _refused(found.sign_as("EXCEPTIONS_NOTED"), 409, EXCEPTION_SINCE)
    found.shut()


def test_a_sign_off_stops_clearing_oe_when_its_conclusions_rule_stops_holding(
    migrated: Database,
) -> None:
    """Finding 3, through the service's choice and sign-off: each conclusion signed, then
    a later check changes what the records show, with nothing recorded by a person since.
    The sign-off is out of date, in the rule's own sentence, and none of the gate's
    readers (the verdict, the gate, the effective controls, the phase progress route)
    reads it."""
    # Effective, then a later check finds an exception on B.
    effective = _Draft(migrated, "dcc-held-effective")
    effective.concluded_and_signed("EFFECTIVE")
    effective.cleared()
    effective.later_check(B="DEVIATION")
    body = effective.body()
    assert (body["status"], body["out_of_date"]) == ("OUT_OF_DATE", [_exception_stands("B")])
    effective.shut()

    # Design effective, no instance, then a later check no longer shows B.
    no_instance = _Draft(migrated, "dcc-held-no-instance")
    no_instance.concluded_and_signed("NO_INSTANCE")
    no_instance.cleared()
    no_instance.later_check(B="ABSENT")
    body = no_instance.body()
    assert (body["status"], body["out_of_date"]) == ("OUT_OF_DATE", [DESIGN_NOT_SHOWN])
    no_instance.shut()

    # Exceptions noted, then a later check shows B: no exception is left.
    noted = _Draft(migrated, "dcc-held-noted", B="DEVIATION")
    noted.concluded_and_signed("EXCEPTIONS_NOTED")
    noted.cleared()
    noted.later_check()
    body = noted.body()
    assert (body["status"], body["out_of_date"]) == ("OUT_OF_DATE", [EXCEPTIONS_NEEDED])
    noted.shut()


def test_what_a_person_decides_after_an_effective_sign_off_puts_it_out_of_date(
    migrated: Database,
) -> None:
    """Finding 13. A person's exception on an attribute whose state is not "Shown" keeps
    effective from being recorded; the only file decided not relied on after the sign-off
    puts it out of date (the decision, and the rule: nothing shows the attributes); a
    design deficiency logged after it puts it out of date in the assembled view."""
    waiting = _Draft(migrated, "dcc-not-shown", B="ABSENT")
    assert _tickmark(waiting.bench, waiting.ids["B"], "EXCEPTION").status_code == 200
    assert next(a for a in waiting.view()["attributes"] if a["code"] == "B")["state"] != "SHOWN"
    _refused(waiting.choose("EFFECTIVE"), 409, _exception_stands("B"))

    relied = _Draft(migrated, "dcc-not-relied")
    relied.concluded_and_signed("EFFECTIVE")
    assert _decide_reliability(relied.bench, relied.ticket, "NOT_RELIED_ON").status_code == 200
    body = relied.body()
    assert body["status"] == "OUT_OF_DATE"
    decided, rule = body["out_of_date"]
    assert decided == "the reliability decision on ticket REQ-1041.txt changed after the sign-off"
    assert rule.endswith("not yet shown in the records of an instance, so the conclusion "
                         "cannot be “Effective”")  # fmt: skip
    assert {a["shown_by"] for a in relied.view()["attributes"]} == {"NOT_RELIED"}
    relied.shut()

    logged = _Draft(migrated, "dcc-logged")
    logged.concluded_and_signed("EFFECTIVE")
    assert logged.view()["review"]["status"] == "SIGNED_OFF"
    logged.deficiency()
    view = logged.view()
    assert (view["review"]["status"], view["review"]["out_of_date"]) == (
        "OUT_OF_DATE", [DEFICIENCY_LOGGED_SINCE],
    )  # fmt: skip
    assert view["conclusion"]["signed"] is False
    logged.shut()


def test_the_sign_off_names_the_choice_it_signs(migrated: Database) -> None:
    """Finding 4 and 7. A choice_id that is not the standing choice's is refused with
    the sentence; a body with the two-value verdict and no conclusion, or no choice_id,
    is a 422; nothing is signed."""
    case = _Draft(migrated, "dcc-names")
    first = case.chosen("EFFECTIVE")["choice"]
    second = case.chosen("NO_INSTANCE")["choice"]
    case.prepare()
    _refused(case.sign_as("NO_INSTANCE", choice_id=first["id"]), 409, CHOICE_NOT_STANDING)
    _refused(case.sign_as("NO_INSTANCE", choice_id=str(uuid4())), 409, CHOICE_NOT_STANDING)
    assert CHOICE_NOT_STANDING == "the preparer's conclusion changed; read it again"
    for sent in (
        {"verdict": "EFFECTIVE", "choice_id": second["id"], "workpaper_version": case.version},
        {"conclusion": "NO_INSTANCE", "workpaper_version": case.version},
        {"conclusion": "NO_INSTANCE", "choice_id": second["id"], "verdict": "EFFECTIVE",
         "workpaper_version": case.version},
    ):  # fmt: skip
        assert case.reviewer.post(f"{case.path}/sign-off", json=sent).status_code == 422
    assert case.rows("SELECT count(*) FROM design_conclusions") == [(0,)]
    signed = case.sign_as("NO_INSTANCE", choice_id=second["id"])
    assert signed.status_code == 200, signed.text
    assert case.signed_row()[4] == UUID(second["id"])


def test_the_design_workpaper_is_prepared_only_on_a_recorded_conclusion(
    migrated: Database,
) -> None:
    """Review of 16 November 2026, finding 1 (docs/design-workpaper.md, section 3.7: "a
    conclusion is recorded (3.6) and it is not 'Not concluded' ... the server refuses").
    The preparer's attestation says the conclusion above is complete and supported, so a
    Prepare sent from any page (a stale tab, the older form route, a direct request) is
    refused where none stands, or where the standing one is Not concluded: nothing is
    prepared and nothing is audited. A conclusion recorded and then replaced by Not
    concluded is refused too; replaced again by one that can be signed, it is prepared."""
    case = _Draft(migrated, "dcc-prepare-needs")
    case.prepare_refused(PREPARE_NEEDS_CONCLUSION)
    # A page that has not read the latest version is told so first, as before.
    paper = case.paper()
    stale = case.bench.owner.post(
        f"{case.bench.base}/workpapers/{paper['id']}/prepare",
        json={"version": paper["version"] + 1},
    )
    assert (stale.status_code, stale.json()["detail"]) == (409, "the workpaper changed")
    # Not concluded, recorded by the preparer (as the proposal, or with a reason): refused.
    case.chosen("NOT_CONCLUDED")
    case.prepare_refused(PREPARE_NOT_CONCLUDED)
    case.chosen("EFFECTIVE")
    case.chosen("NOT_CONCLUDED")
    case.prepare_refused(PREPARE_NOT_CONCLUDED)
    assert [kind for kind, _ended_as, _by in case.choices()] == [
        "NOT_CONCLUDED", "EFFECTIVE", "NOT_CONCLUDED",
    ]  # fmt: skip
    # Each conclusion that can be signed is prepared on: here, not effective and effective.
    case.chosen("NOT_EFFECTIVE")
    case.prepare()
    paper = case.paper()
    assert (paper["status"], paper["prepared_version"]) == ("PREPARED", case.version)
    [(audited,)] = case.rows(
        "SELECT count(*) FROM audit_events WHERE action = 'workpaper.prepared' AND target_id = %s",
        UUID(paper["id"]),
    )
    assert audited == 1
    case.reopen()
    case.chosen("EFFECTIVE")
    case.prepare()
    assert case.paper()["status"] == "PREPARED"


def test_recording_a_choice_makes_a_prepare_from_an_older_page_stale(migrated: Database) -> None:
    """Finding 9, with two people: the owner reads the draft workpaper; another person
    records the conclusion on it; the owner's Prepare, sent from the page that has not
    seen the choice, is refused as stale and prepares nothing. Read again, it prepares."""
    case = _Draft(migrated, "dcc-version")
    seen = case.paper()
    case.chosen("EFFECTIVE", client=case.reviewer)
    [(version,)] = case.rows("SELECT version FROM workpapers WHERE id = %s", UUID(seen["id"]))
    assert version == seen["version"] + 1
    stale = case.bench.owner.post(
        f"{case.bench.base}/workpapers/{seen['id']}/prepare", json={"version": seen["version"]}
    )
    assert stale.status_code == 409, stale.text
    assert case.paper()["status"] != "PREPARED"
    case.prepare()
    assert case.paper()["status"] == "PREPARED"


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
