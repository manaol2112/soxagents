"""Each point of the D&I workpaper is settled where it belongs (docs/design-workpaper.md,
section 3.9; the product owner, 16 November 2026; migration 0169). Synthetic data only.

Audit integrity (critical tier):

- a point is considered, with a reason, only by a person with TASK_UPDATE (never an
  agent, a firm Reviewer or anyone outside the engagement), on an open engagement, while
  the design workpaper is a draft shown at its current version, for a point of the current
  read that is not settled; a stale page or a point that changed is refused (409) and
  nothing is recorded;
- a consideration is written once and ended once (WITHDRAWN), never deleted, one standing
  per workpaper and point; each write bumps the workpaper's version and is one audit event
  with at most 200 characters of the reason; an archived engagement's are read-only;
- the preparer's sign-off (prepare, and "Sign and send for review") is refused while a
  point is not settled, in its exact words, and prepares nothing; settled by a
  consideration, it is allowed;
- the reviewer's sign-off is refused while a point raised since the preparer signed is not
  settled; a point raised after a sign-off does not by itself put the sign-off out of date;
- demo seeding (a demo engagement and a demo identity, markers only demo initialization
  sets) keeps the rules it had.
"""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database
from test_design_conclusion_choice import _Draft, _refused
from test_evidence_assurance import _Bench
from test_execution import _add_user
from test_outbound import _session, migrated

from ai_workforce_api import design_conclusions, design_points
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.design_conclusions import REASON_NEEDED, REASON_TOO_LONG
from ai_workforce_api.design_points import (
    CONSIDERED,
    POINT_CHANGED,
    PREPARED_ALREADY,
    WITHDRAWN,
    prepare_words,
    signoff_words,
)
from ai_workforce_api.engagement_close import closed_detail

__all__ = ["migrated"]

REASON = "The owner confirmed the ticket's source in the walkthrough; it is the system's own."
LONG_REASON = "The owner showed the export being run. " + "x" * 300


class _Points(_Draft):
    """A control whose design workpaper is drafted on a finished check that leaves the
    ticket's reliability to a person (a point), with the preparer's conclusion recorded
    (effective) unless `choose` is False."""

    def __init__(self, migrated: Database, slug: str, choose: bool = True) -> None:
        super().__init__(migrated, slug)
        if choose:
            self.chosen("EFFECTIVE")

    def points(self, client: Any = None) -> list[dict[str, Any]]:
        bench = self.bench
        found = (client or bench.owner).get(
            f"{bench.base}/controls/{bench.control}/design-workpaper"
        )
        assert found.status_code == 200, found.text
        points: list[dict[str, Any]] = found.json()["points"]
        return points

    def waiting(self) -> list[dict[str, Any]]:
        return [p for p in self.points() if p["considered"] is None]

    def consider(
        self, key: str, reason: str = REASON, version: int | None = None, client: Any = None
    ) -> Any:
        sent = {
            "reason": reason,
            "workpaper_version": self.paper()["version"] if version is None else version,
        }
        return (client or self.bench.owner).post(f"{self.path}/points/{key}/consider", json=sent)

    def withdraw(
        self, key: str, consideration_id: str, version: int | None = None, client: Any = None
    ) -> Any:
        sent = {
            "consideration_id": consideration_id,
            "workpaper_version": self.paper()["version"] if version is None else version,
        }
        return (client or self.bench.owner).post(f"{self.path}/points/{key}/withdraw", json=sent)

    def considerations(self) -> list[tuple[Any, ...]]:
        """Every consideration on record, oldest first: key, kind, text, reason, ended_as,
        who ended it."""
        return self.rows(
            "SELECT point_key, point_kind, point_text, reason, ended_as, ended_by "
            "FROM design_point_considerations WHERE engagement_control_id = %s "
            "ORDER BY considered_at, id",
            UUID(self.bench.control),
        )

    def events(self, action: str) -> list[tuple[Any, ...]]:
        return self.rows(
            "SELECT actor_user_id, target_id, payload FROM audit_events WHERE action = %s "
            "AND project_id = %s ORDER BY occurred_at, id",
            action,
            self.bench.team["project"],
        )

    def raise_finding(self, title: str) -> str:
        """An open finding on the request's check, as the chain records one (synthetic):
        a FINDING point. Its title."""
        bench = self.bench
        self.rows(
            """
            INSERT INTO evidence_findings (
                organization_id, project_id, engagement_control_id, requirement_id,
                attribute_id, attribute_code, source, kind, fingerprint, title,
                observation, status, assessment_id
            )
            VALUES (%s, %s, %s, %s, %s, 'A', 'ASSURANCE', 'NOT_MET', %s, %s, 'Synthetic.',
                    'PROPOSED', %s)
            RETURNING id
            """,
            bench.team["org"],
            bench.team["project"],
            UUID(bench.control),
            UUID(bench.item_id),
            UUID(self.ids["A"]),
            uuid4().hex + uuid4().hex,
            title,
            UUID(bench.entry()["run_id"]),
        )
        return title

    def signed_rows(self) -> list[tuple[Any, ...]]:
        return self.rows(
            "SELECT id FROM design_conclusions WHERE engagement_control_id = %s",
            UUID(self.bench.control),
        )

    def prepare_answer(self) -> Any:
        # Since 19 November 2026 (D4): the conclusion in the preparer's own words first.
        self.own_words()
        paper = self.paper()
        return self.bench.owner.post(
            f"{self.bench.base}/workpapers/{paper['id']}/prepare",
            json={"version": paper["version"]},
        )


# --- Considered, with reason -------------------------------------------------------------


def test_the_preparer_considers_a_point_and_withdraws_it(migrated: Database) -> None:
    case = _Points(migrated, "dpt-consider")
    owner_id = case.bench.team["owner_id"]
    waiting = case.waiting()
    assert waiting, "the fixture's check leaves a point to a person"
    point = waiting[0]
    assert point["settle"][-1] == "CONSIDER"
    version = case.paper()["version"]

    def nothing_recorded() -> None:
        assert case.considerations() == []
        assert case.events(CONSIDERED) == []
        assert case.paper()["version"] == version

    # A stale page, a key no point has, a reason out of bounds, a key that is no key.
    _refused(case.consider(point["key"], version=version - 1), 409, POINT_CHANGED)
    _refused(case.consider("0" * 32), 409, POINT_CHANGED)
    _refused(case.consider(point["key"], reason="Too short"), 422, REASON_NEEDED)
    _refused(case.consider(point["key"], reason="   \n  "), 422, REASON_NEEDED)
    _refused(case.consider(point["key"], reason="x" * 1001), 422, REASON_TOO_LONG)
    assert case.consider("NOT-A-KEY").status_code == 422
    assert case.consider(point["key"].upper()).status_code == 422
    nothing_recorded()

    # Considered: the answer names the consideration and the workpaper's new version.
    answer = case.consider(point["key"], reason=f"<b>{LONG_REASON}</b>")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    consideration = body["consideration"]
    assert set(body) == {"consideration", "workpaper_version"}
    assert set(consideration) == {"id", "by", "at", "reason"}
    assert consideration["by"] == {"id": str(owner_id), "name": case.bench.name(owner_id)}
    # The reason is the person's own text, cleaned as text is.
    assert consideration["reason"] == LONG_REASON
    assert body["workpaper_version"] == version + 1 == case.paper()["version"]
    # The point stays, with the same key, settled by the consideration.
    [again] = [p for p in case.points() if p["key"] == point["key"]]
    assert again["considered"] == consideration
    assert {k: v for k, v in again.items() if k != "considered"} == {
        k: v for k, v in point.items() if k != "considered"
    }
    assert case.considerations() == [
        (point["key"], point["kind"], point["text"], LONG_REASON, None, None)
    ]
    [(actor, target, event)] = case.events(CONSIDERED)
    assert (actor, str(target)) == (owner_id, consideration["id"])
    assert event == {
        "control_id": case.bench.control, "workpaper_id": case.paper()["id"],
        "consideration_id": consideration["id"], "point_key": point["key"],
        "point_kind": point["kind"], "workpaper_version": version + 1,
        "reason": LONG_REASON[:200],
    }  # fmt: skip
    # Once considered, it is not considered again; one stands per workpaper and point.
    _refused(case.consider(point["key"]), 409, POINT_CHANGED)
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(
            "INSERT INTO design_point_considerations (organization_id, project_id, "
            "engagement_control_id, workpaper_id, point_key, point_kind, point_text, reason, "
            "considered_by) SELECT organization_id, project_id, engagement_control_id, "
            "workpaper_id, point_key, point_kind, point_text, reason, considered_by "
            "FROM design_point_considerations WHERE id = %s",
            (UUID(consideration["id"]),),
        )

    # Withdrawn: naming the consideration the page shows, at the current version.
    now = case.paper()["version"]
    _refused(case.withdraw(point["key"], str(uuid4())), 409, POINT_CHANGED)
    _refused(case.withdraw(point["key"], consideration["id"], version=now - 1), 409, POINT_CHANGED)
    _refused(case.withdraw("0" * 32, consideration["id"]), 409, POINT_CHANGED)
    withdrawn = case.withdraw(point["key"], consideration["id"])
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json() == {"workpaper_version": now + 1}
    assert case.paper()["version"] == now + 1
    [after] = [p for p in case.points() if p["key"] == point["key"]]
    assert after["considered"] is None
    # Kept, ended once, by the person; one audit event.
    assert case.considerations() == [
        (point["key"], point["kind"], point["text"], LONG_REASON, "WITHDRAWN", owner_id)
    ]
    [(actor, target, event)] = case.events(WITHDRAWN)
    assert (actor, str(target)) == (owner_id, consideration["id"])
    assert event == {
        "control_id": case.bench.control, "workpaper_id": case.paper()["id"],
        "consideration_id": consideration["id"], "point_key": point["key"],
        "point_kind": point["kind"], "workpaper_version": now + 1,
    }  # fmt: skip
    _refused(case.withdraw(point["key"], consideration["id"]), 409, POINT_CHANGED)
    # It may be considered again: a new consideration.
    assert case.consider(point["key"]).status_code == 200
    assert [row[4] for row in case.considerations()] == ["WITHDRAWN", None]


def test_migration_0169_keeps_each_consideration_as_it_was_recorded(migrated: Database) -> None:
    case = _Points(migrated, "dpt-table")
    point = case.waiting()[0]
    considered = case.consider(point["key"]).json()["consideration"]
    consideration_id = UUID(considered["id"])

    def refused(error: type[Exception], match: str, query: str, *params: Any) -> None:
        with connect(migrated.url) as connection, pytest.raises(error, match=match):
            connection.execute(query, params)

    raise_ = psycopg.errors.RaiseException
    refused(raise_, "never changes",
            "UPDATE design_point_considerations SET reason = 'Another reason entirely.' "
            "WHERE id = %s", consideration_id)  # fmt: skip
    refused(raise_, "never changes",
            "UPDATE design_point_considerations SET point_key = repeat('a', 32) WHERE id = %s",
            consideration_id)  # fmt: skip
    refused(raise_, "only by ending",
            "UPDATE design_point_considerations SET ended_as = NULL WHERE id = %s",
            consideration_id)  # fmt: skip
    refused(raise_, "never deleted",
            "DELETE FROM design_point_considerations WHERE id = %s", consideration_id)  # fmt: skip
    # Ended only as WITHDRAWN, with who and when together.
    refused(psycopg.errors.CheckViolation, "ended_as",
            "UPDATE design_point_considerations SET ended_at = clock_timestamp(), "
            "ended_by = considered_by, ended_as = 'REPLACED' WHERE id = %s",
            consideration_id)  # fmt: skip
    refused(psycopg.errors.CheckViolation, "design_point_considerations_ended",
            "UPDATE design_point_considerations SET ended_at = clock_timestamp(), "
            "ended_as = 'WITHDRAWN' WHERE id = %s", consideration_id)  # fmt: skip
    insert = (
        "INSERT INTO design_point_considerations (organization_id, project_id, "
        "engagement_control_id, workpaper_id, point_key, point_kind, point_text, reason, "
        "considered_by) SELECT organization_id, project_id, engagement_control_id, "
        "workpaper_id, %s, point_kind, point_text, %s, considered_by "
        "FROM design_point_considerations WHERE id = %s"
    )
    # A key is 32 lowercase hexadecimal characters; a reason 10 to 1,000 characters.
    refused(psycopg.errors.CheckViolation, "design_point_considerations_key", insert,
            "A" * 32, REASON, consideration_id)  # fmt: skip
    refused(psycopg.errors.CheckViolation, "design_point_considerations_reason", insert,
            "b" * 32, "too short", consideration_id)  # fmt: skip
    # Only on the control's own design workpaper, while it is a draft.
    refused(raise_, "design workpaper",
            "INSERT INTO design_point_considerations (organization_id, project_id, "
            "engagement_control_id, workpaper_id, point_key, point_kind, point_text, reason, "
            "considered_by) SELECT c.organization_id, c.project_id, c.engagement_control_id, "
            "w.id, repeat('c', 32), c.point_kind, c.point_text, c.reason, c.considered_by "
            "FROM design_point_considerations c JOIN workpapers w "
            "ON w.engagement_control_id = c.engagement_control_id AND w.stage <> 'DESIGN' "
            "WHERE c.id = %s", consideration_id)  # fmt: skip
    # Ended once, then never changed.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE design_point_considerations SET ended_at = clock_timestamp(), "
            "ended_by = considered_by, ended_as = 'WITHDRAWN' WHERE id = %s",
            (consideration_id,),
        )
    refused(raise_, "never changed",
            "UPDATE design_point_considerations SET ended_at = clock_timestamp() WHERE id = %s",
            consideration_id)  # fmt: skip


def test_only_a_person_on_the_engagement_settles_a_point_on_a_draft(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Points(migrated, "dpt-who")
    bench = case.bench
    point = case.waiting()[0]
    # An agent principal reaching the route is refused before anything is read or written.
    agent = Principal(kind=PrincipalKind.AGENT, id=bench.team["owner_id"])
    with monkeypatch.context() as patched:
        patched.setattr(design_conclusions, "_session_principal", lambda _request: agent)
        assert case.consider(point["key"]).status_code == 403
        assert case.withdraw(point["key"], str(uuid4())).status_code == 403
    # A firm Reviewer (no TASK_UPDATE) is refused; one outside the engagement or the firm
    # finds nothing.
    _viewer_id, viewer = bench.member("REVIEWER")
    assert case.consider(point["key"], client=viewer).status_code == 403
    with connect(migrated.url) as connection:
        stranger = _add_user(
            connection, bench.team["org"], f"off-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
    assert case.consider(point["key"], client=_session(migrated, stranger)).status_code == 404
    other = _Bench(migrated, "dpt-other")
    assert case.consider(point["key"], client=other.owner).status_code == 404
    elsewhere = f"{other.base}/design-conclusions/{bench.control}/points/{point['key']}/consider"
    assert (
        other.owner.post(elsewhere, json={"reason": REASON, "workpaper_version": 1}).status_code
        == 404
    )
    assert case.considerations() == []
    # The view tells the page who may settle: the preparer may; the Reviewer may not.
    url = f"{bench.base}/controls/{bench.control}/design-workpaper"
    assert bench.owner.get(url).json()["can_settle"] is True
    assert viewer.get(url).json()["can_settle"] is False

    # Prepared: nothing is settled on it until it is reopened.
    considered = case.consider(point["key"]).json()["consideration"]
    for waiting in case.waiting():
        assert case.consider(waiting["key"]).status_code == 200
    case.prepare()
    assert bench.owner.get(url).json()["can_settle"] is False
    _refused(case.withdraw(point["key"], considered["id"]), 409, PREPARED_ALREADY)
    _refused(case.consider("0" * 32), 409, PREPARED_ALREADY)
    case.reopen()
    assert bench.owner.get(url).json()["can_settle"] is True
    # A consideration recorded on the draft still stands after the reopening.
    assert [p["considered"] for p in case.points() if p["key"] == point["key"]] == [considered]

    # An archived engagement is read-only: the middleware refuses the change, and the
    # table refuses a write that reaches it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (bench.team["project"],)
        )
    _refused(case.withdraw(point["key"], considered["id"]), 409, closed_detail("ARCHIVED"))
    with (
        connect(migrated.url) as connection,
        pytest.raises(psycopg.errors.CheckViolation, match="archived"),
    ):
        connection.execute(
            "UPDATE design_point_considerations SET ended_at = clock_timestamp(), "
            "ended_by = considered_by, ended_as = 'WITHDRAWN' WHERE id = %s",
            (UUID(considered["id"]),),
        )


# --- The sign-offs --------------------------------------------------------------------------


def test_the_preparers_sign_off_waits_for_every_point(migrated: Database) -> None:
    case = _Points(migrated, "dpt-prepare", choose=False)
    # The refusals of section 3.7 come first.
    case.prepare_refused("record a conclusion first")
    case.chosen("EFFECTIVE")
    # Since 19 November 2026 (D4): the conclusion section in the preparer's own words, a
    # refusal of section 3.7 that comes before the points (old: none was needed here).
    case.own_words()
    waiting = case.waiting()
    first = " ".join(waiting[0]["text"].split())
    expected = f"Settle the points first ({len(waiting)}): {first[:160].rstrip('.')}."
    if len(first) > 160:
        expected = f"Settle the points first ({len(waiting)}): {first[:159].rstrip()}…."
    case.prepare_refused(expected)
    # Sign and send for review prepares it: refused the same, and nothing is sent.
    sent = case.bench.owner.post(
        f"{case.path}/send-for-review",
        json={"workpaper_version": case.paper()["version"], "reviewer_id": str(case.reviewer_id)},
    )
    _refused(sent, 409, expected)
    assert (
        case.rows(
            "SELECT 1 FROM design_review_requests WHERE engagement_control_id = %s",
            UUID(case.bench.control),
        )
        == []
    )
    assert case.paper()["status"] == "DRAFT"
    # All but one considered: still refused, now counting the one left.
    for point in waiting[:-1]:
        assert case.consider(point["key"]).status_code == 200
    last = waiting[-1]
    case.prepare_refused(prepare_words([_as_point(last)]) or "")
    # The last considered: the preparer signs.
    assert case.consider(last["key"]).status_code == 200
    assert case.waiting() == []
    prepared = case.prepare_answer()
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["status"] == "PREPARED"


def test_the_preparers_sign_off_reads_the_conclusion_again(migrated: Database) -> None:
    """Section 3.9: the rule that allowed the conclusion is applied again when the preparer
    signs. A design deficiency or a person's exception recorded after an Effective choice
    no longer lets the workpaper be prepared on it, with the rule's own sentence."""
    from test_attribute_dispositions import _record as _tickmark

    case = _Points(migrated, "dpt-refit")
    for point in case.waiting():
        assert case.consider(point["key"]).status_code == 200
    assert case.waiting() == []
    # A person's exception on B after the Effective choice.
    assert _tickmark(case.bench, case.ids["B"], "EXCEPTION").status_code == 200
    for point in case.waiting():
        assert case.consider(point["key"]).status_code == 200
    paper = case.paper()
    refused = case.bench.owner.post(
        f"{case.bench.base}/workpapers/{paper['id']}/prepare", json={"version": paper["version"]}
    )
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail.startswith("The conclusion no longer fits the records: an exception stands on ")
    assert detail.endswith("so the conclusion cannot be \u201cEffective\u201d. Record it again.")
    assert case.paper()["status"] == "DRAFT"
    # A design deficiency logged too: its rule's sentence comes first.
    case.deficiency()
    case.prepare_refused(
        "The conclusion no longer fits the records: a design deficiency is logged, so the "
        "conclusion cannot be \u201cEffective\u201d. Record it again."
    )


def test_a_point_settled_by_its_own_action_is_no_longer_assembled(migrated: Database) -> None:
    from test_file_reliability import _record as _decide

    case = _Points(migrated, "dpt-own")
    reliability = [p for p in case.waiting() if "RELIABILITY" in p["settle"]]
    assert reliability, "the fixture's check asks about the ticket's reliability"
    point = reliability[0]
    assert point["place"]["at"] == "FILE" and point["place"]["file_id"] == case.ticket
    decided = _decide(case.bench, case.ticket, "ESTABLISHED_ON_REVIEW")
    assert decided.status_code == 200, decided.text
    assert point["key"] not in [p["key"] for p in case.points()]
    # The file's line says the decision, as section 5 would.
    paper = case.view()
    [line] = [e for e in paper["evidence"] if e["file_id"] == case.ticket]
    assert line["established"].startswith("Reliability established on review by ")


def test_the_reviewers_sign_off_waits_for_a_point_raised_since_the_preparer_signed(
    migrated: Database,
) -> None:
    case = _Points(migrated, "dpt-review")
    case.prepare()
    assert case.waiting() == []
    # After the preparer signed, the evidence raises a finding (as a later check of the
    # request records one): a point nobody settled.
    raised = case.raise_finding("Attribute A: the approval is dated after the grant.")
    waiting = case.waiting()
    assert [(p["kind"], p["text"]) for p in waiting] == [("FINDING", raised)]
    words = "1 point was raised since the preparer signed: return it to the preparer."
    assert signoff_words([_as_point(p) for p in waiting]) == words
    _refused(case.sign_as("EFFECTIVE"), 409, words)
    assert case.signed_rows() == []
    # Two raised: counted in the plural.
    case.raise_finding("Attribute B: the approver is not the line manager.")
    _refused(
        case.sign_as("EFFECTIVE"),
        409,
        "2 points were raised since the preparer signed: return it to the preparer.",
    )
    # Nothing is settled on the prepared workpaper: it goes back to the preparer, who
    # settles them; signed again, the reviewer signs.
    _refused(case.consider(case.waiting()[0]["key"]), 409, PREPARED_ALREADY)
    case.reopen()
    for point in case.waiting():
        assert case.consider(point["key"]).status_code == 200
    case.prepare()
    signed = case.sign_as("EFFECTIVE")
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "SIGNED_OFF"
    assert len(case.signed_rows()) == 1


def test_a_point_raised_after_the_sign_off_does_not_by_itself_put_it_out_of_date(
    migrated: Database,
) -> None:
    case = _Points(migrated, "dpt-after")
    case.prepare()
    signed = case.sign_as("EFFECTIVE")
    assert signed.status_code == 200, signed.text
    assert case.verdict() == "EFFECTIVE"
    # A consideration ends after the sign-off (as when its point comes back): the point is
    # not settled again, and the sign-off still stands and clears OE.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE design_point_considerations SET ended_at = clock_timestamp(), "
            "ended_by = considered_by, ended_as = 'WITHDRAWN' WHERE ended_at IS NULL"
        )
    assert case.waiting()
    body = case.body()
    assert (body["status"], body["out_of_date"]) == ("SIGNED_OFF", [])
    assert case.verdict() == "EFFECTIVE" and case.gate() is None


def test_demo_seeding_keeps_the_rules_it_had(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Points(migrated, "dpt-demo")
    bench = case.bench
    project, control = UUID(str(bench.team["project"])), UUID(bench.control)
    paper, owner = UUID(case.paper()["id"]), bench.team["owner_id"]
    with connect(migrated.url) as connection:
        refusal = design_points.prepare_refusal(connection, project, control, paper, owner)
        assert refusal is not None and refusal.startswith("Settle the points first (")
        assert design_points.signoff_refusal(connection, project, control, paper, owner)
        # Only a demo engagement and a demo identity together are the demo seeding.
        assert design_points.demo_seeding(connection, project, owner) is False
        organization = UUID(str(bench.team["org"]))
        with transaction(connection) as cursor:
            cursor.execute(
                "SELECT set_config('aw.demo_initialization', %s, true)", (str(organization),)
            )
            demo_project = cursor.execute(
                "INSERT INTO projects (organization_id, name, slug, owner_user_id, demo) "
                "VALUES (%s, 'Demo', %s, %s, true) RETURNING id",
                (organization, f"demo-{uuid4().hex[:6]}", owner),
            ).fetchone()
            demo_person = cursor.execute(
                "INSERT INTO users (email, display_name, demo_organization_id) "
                "VALUES (%s, 'Demo preparer', %s) RETURNING id",
                (f"demo-{uuid4().hex[:6]}@example.com", organization),
            ).fetchone()
        assert demo_project is not None and demo_person is not None
        demo_id, person_id = UUID(str(demo_project[0])), UUID(str(demo_person[0]))
        assert design_points.demo_seeding(connection, demo_id, person_id) is True
        assert design_points.demo_seeding(connection, demo_id, owner) is False
        assert design_points.demo_seeding(connection, project, person_id) is False
    # The demo seeding its own engagement is held to the rules it had: no point refuses it.
    monkeypatch.setattr(design_points, "demo_seeding", lambda *_args: True)
    with connect(migrated.url) as connection:
        assert design_points.prepare_refusal(connection, project, control, paper, owner) is None
        assert design_points.signoff_refusal(connection, project, control, paper, owner) is None


def _as_point(point: dict[str, Any]) -> design_points.PointBody:
    return design_points.PointBody.model_validate(point)
