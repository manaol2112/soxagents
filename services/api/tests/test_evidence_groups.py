"""Grouped evidence requests (Release 2b-1, Option 1; migration 0107): one person receives
one request for a phase. The per-control requests stay authoritative; each is approved
through the approval engine and bound to the group's one email; the group's approval
record holds exactly what was approved; the email is sent once, durably; nothing in the
group sends or reminds on its own."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from support import Database, approve_evidence_plans
from test_evidence_center import _all, _ready
from test_evidence_flow import _drafted, _project
from test_execution import _add_project_member, _add_user
from test_outbound import _session, _TimesOut, migrated
from test_shared_plans import _engagement

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_groups import (
    DUE_SPREAD_DAYS,
    ApproveSendBody,
    Candidate,
    Section,
    SeenMember,
    _approve,
    _templates,
    approve_and_send,
    propose,
    render_group,
)
from ai_workforce_api.followups import DONE, advance, remindable_requests
from ai_workforce_api.mailbox import MailboxState, MockMailbox
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

# The reviewed wording of the group's email and its reminder (version 1 of each).
_APPROVED_GROUP_TEMPLATES = "ccc1831c643d0979cebbc30edf06c82ec43855b8800f5b128dad9dfb278025dc"


def _groups(client: Any, team: dict[str, Any], **params: Any) -> list[dict[str, Any]]:
    return [row for row in _all(client, team, grouped=1, **params) if row["group"]]


def _review(client: Any, team: dict[str, Any], group_id: str) -> Any:
    return client.get(f"{_project(team)}/evidence-groups/{group_id}")


def _seen(view: dict[str, Any], extra: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    members = [*view["members"], *(extra or [])]
    return [{"id": m["id"], "version": m["version"]} for m in members]


def _approve_send(client: Any, team: dict[str, Any], view: dict[str, Any], **body: Any) -> Any:
    return client.post(
        f"{_project(team)}/evidence-groups/{view['id']}/approve-send",
        json={"members": _seen(view), **body},
    )


def _principal(team: dict[str, Any]) -> Principal:
    return Principal(kind=PrincipalKind.USER, id=team["owner_id"])


def _settings(migrated: Database) -> Settings:
    return Settings(database_url=migrated.url)


def _one(connection: psycopg.Connection[Any], sql: str, *args: Any) -> Any:
    row = connection.execute(sql, args).fetchone()
    assert row is not None
    return row[0]


def _personal_split(client: Any, team: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The two groups for the access administrator in one phase: personal data apart."""
    groups = [g for g in _groups(client, team) if g["phase"] == "DESIGN"]
    standard = next(g for g in groups if "ITGC-AC-01" in g["control_title"])
    personal = next(g for g in groups if "ITGC-AC-02" in g["control_title"])
    return standard, personal


# Wording and grouping rules


def test_the_group_wording_is_the_reviewed_version() -> None:
    text = "\n".join(f"{t.template_id}\n{t.version}\n{t.subject}\n{t.body}" for t in _templates())
    assert hashlib.sha256(text.encode()).hexdigest() == _APPROVED_GROUP_TEMPLATES


def _candidate(n: int, **change: Any) -> Candidate:
    due = datetime(2026, 11, 30, 23, 59, tzinfo=UTC)
    request_id = UUID(int=n)
    fields: dict[str, Any] = {
        "id": request_id, "version": 1, "created_at": due, "recipient": "owner@client.example",
        "cc": (), "phase": "INTERIM", "workflow": "documents", "sensitivity": "STANDARD",
        "units": (), "due_at": due, "control_ref": f"C-{n:02d}", "family": "ACCESS",
        "items": 2, "requirements": (UUID(int=1000 + n),), "untouched": True,
        "system": "SAP ERP",
        "section": Section(
            id=request_id, control_ref=f"C-{n:02d}",
            description=f"Interim testing evidence for C-{n:02d}: Control {n}\n\n"
            "To test how this control operated in the period, please provide:\n\n"
            "1. A listing\n   Period: 1 July 2026 to 30 September 2026",
            due_at=due, recipient="owner@client.example", cc=(),
        ),
    }  # fmt: skip
    fields.update(change)
    return Candidate(**fields)


def test_untouched_drafts_group_by_person_phase_kind_sensitivity_and_units() -> None:
    project = uuid4()
    base = [_candidate(n) for n in range(1, 4)]
    [one] = propose(project, base, "SOX 2027", set())
    assert [c.id for c in one.members] == [c.id for c in base]
    # Each of these travels apart from the first three, and alone is no group.
    apart = [
        _candidate(10, recipient="other@client.example"),
        _candidate(11, phase="DESIGN"),
        _candidate(12, workflow="samples"),
        _candidate(13, sensitivity="PERSONAL"),
        _candidate(14, units=("EU",)),
        _candidate(15, cc=("copy@client.example",)),
    ]
    proposals = propose(project, [*base, *apart], "SOX 2027", set())
    assert len(proposals) == 1 and len(proposals[0].members) == 3
    # The same id while the proposal stands; never an id an approved group holds.
    assert proposals[0].id == one.id
    assert propose(project, base, "SOX 2027", {one.id})[0].id != one.id
    # A changed draft is not regrouped on its own; it is offered for a person to include.
    touched = _candidate(20, untouched=False)
    [offered] = propose(project, [*base, touched], "SOX 2027", set())
    assert [c.id for c in offered.members] == [c.id for c in base]
    assert [c.id for c in offered.optional] == [touched.id]
    # Split as R2a decided: over 25 items across more than two families, by family; a
    # family still over 25 items across systems, by system; dues far apart, by date.
    # Otherwise one person's work for a phase stays one request.
    big = [_candidate(n, items=10, family=f) for n, f in zip(range(30, 36), "AABBCC", strict=True)]
    assert [len(p.members) for p in propose(project, big, "SOX 2027", set())] == [2, 2, 2]
    systems = zip(range(50, 54), "XXYY", strict=True)
    two = [_candidate(n, items=10, family="A", system=s) for n, s in systems]
    assert [len(p.members) for p in propose(project, two, "SOX 2027", set())] == [2, 2]
    single = [_candidate(n, items=10) for n in range(60, 64)]
    assert [len(p.members) for p in propose(project, single, "SOX 2027", set())] == [4]
    pair = [_candidate(n, items=10, family=f) for n, f in zip(range(70, 74), "AABB", strict=True)]
    assert [len(p.members) for p in propose(project, pair, "SOX 2027", set())] == [4]
    later = base[0].due_at + timedelta(days=DUE_SPREAD_DAYS + 1)
    spread = [*base, *(_candidate(n, due_at=later) for n in range(40, 42))]
    assert sorted(len(p.members) for p in propose(project, spread, "SOX 2027", set())) == [2, 3]


def test_a_request_too_long_for_one_email_names_every_control_and_links_the_items() -> None:
    many = [
        _candidate(n, section=Section(
            id=UUID(int=n), control_ref=f"C-{n:02d}", control_title=f"Control {n}",
            description="\n\n".join(f"{i}. A long listing of things {'x' * 120}\n   Period: Q3"
                                     for i in range(1, 6)),
            due_at=datetime(2026, 11, 30, tzinfo=UTC), recipient="owner@client.example", cc=(),
        )).section
        for n in range(1, 13)
    ]  # fmt: skip
    message = render_group(uuid4(), many[0].id, many, "SOX 2027")
    assert len(message.body) <= 3800 and "Period:" not in message.body
    lines = message.body.splitlines()
    assert all(f"- Control {n}" in lines for n in range(1, 13))
    assert "where each item is described in full:" in message.body


# The list and the review


def test_the_list_shows_one_request_per_person_and_phase(migrated: Database) -> None:
    team = _ready(migrated, "eg-list")
    owner = team["owner"]
    every = _all(owner, team)
    grouped = _all(owner, team, grouped=1)
    groups = [row for row in grouped if row["group"]]
    assert groups and len(grouped) < len(every)
    by_id = {row["id"]: row for row in every}
    covered = [m for g in groups for m in g["member_ids"]]
    # Each request is in at most one group, and every group's requests share a person and
    # a phase. Nothing else in the list changes; without grouped=1 it is as before.
    assert len(covered) == len(set(covered))
    for group in groups:
        members = [by_id[m] for m in group["member_ids"]]
        assert len(members) >= 2
        assert {m["recipient"] for m in members} == {group["recipient"]}
        assert {m["phase"] for m in members} == {group["phase"]}
        assert group["due_at"] == min(m["due_at"] for m in members)
        assert group["stage"] == "READY_FOR_REVIEW"
        assert group["title"] == f"Evidence for {len(members)} controls"
    assert {row["id"] for row in grouped if not row["group"]} == set(by_id) - set(covered)
    # A group is reviewed and sent from its own panel, never selected for bulk changes.
    listed = owner.get(f"{_project(team)}/evidence-requests", params={"grouped": 1, "size": 200})
    matching = {item["id"] for item in listed.json()["matching"]}
    assert not matching & {g["id"] for g in groups}
    # Personal data travels on its own (R2a's reviewed sensitivity).
    standard, personal = _personal_split(owner, team)
    assert _review(owner, team, standard["id"]).json()["personal_data"] is False
    assert _review(owner, team, personal["id"]).json()["personal_data"] is True
    # Filtering by control finds the group it travels in.
    control = by_id[standard["member_ids"][0]]["control_id"]
    assert standard["id"] in {row["id"] for row in _all(owner, team, grouped=1, control=control)}


def test_every_kind_of_control_travels_by_person_phase_and_system(migrated: Database) -> None:
    """A freshly onboarded engagement with ITGCs over two systems, application controls,
    key reports, a business process control, management reviews, and a payroll control."""
    team, client = _engagement(
        migrated, "eg-types", ["Workday"], business=True, domains=("ITAC", "IPE"),
        library=("rtr-flux-review", "rtr-journal-review", "h2r-payroll-review"),
    )  # fmt: skip
    approve_evidence_plans(migrated, team["project"])
    _drafted(migrated, team)
    every = {row["id"]: row for row in _all(client, team)}
    groups = _groups(client, team)
    refs = {g["id"]: [every[m]["control_ref"] for m in g["member_ids"]] for g in groups}
    for group in groups:
        members = [every[m] for m in group["member_ids"]]
        assert {m["recipient"] for m in members} == {group["recipient"]}
        assert {m["phase"] for m in members} == {group["phase"]}
        # Each control's request for each system once; a small request may carry both
        # systems' requests for a control (the panel names the system under each).
        pairs = [(m["control_ref"], tuple(m["systems"])) for m in members]
        assert len(pairs) == len(set(pairs))
    # One request per person, phase, and system for the IT general controls, not fragments.
    access = [g for g in groups if g["phase"] == "DESIGN" and "ITGC-AC-01" in refs[g["id"]]]
    assert len(access) == 2
    assert {tuple(g["systems"]) for g in access} == {("SAP ERP",), ("Workday",)}
    # Business process and management review controls travel together to their owner;
    # application controls and key reports likewise.
    [process] = [g for g in groups if g["phase"] == "INTERIM" and "RTR-01" in refs[g["id"]]]
    assert set(refs[process["id"]]) == {"RTR-01", "RTR-02", "RTR-03"}
    assert any(set(r) >= {"ITAC-03", "ITAC-13"} for r in refs.values())
    assert any("IPE-03" in r for r in refs.values())
    # Payroll evidence is personal data and travels only with personal data.
    [payroll] = [g for g in groups if "HTR-02" in refs[g["id"]]]
    assert _review(client, team, payroll["id"]).json()["personal_data"] is True
    assert _review(client, team, process["id"]).json()["personal_data"] is False
    # Approving the business process and management reviews sends one email for them.
    view = _review(client, team, process["id"]).json()
    sent = _approve_send(client, team, view)
    assert sent.status_code == 200 and sent.json()["status"] == "SENT", sent.text
    assert {m["status"] for m in sent.json()["members"]} == {"SENT"}


def test_the_review_shows_every_control_item_and_the_email(migrated: Database) -> None:
    team = _ready(migrated, "eg-review")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"])
    assert view.status_code == 200, view.text
    body = view.json()
    assert body["status"] == "PROPOSED" and body["ready"] is True and body["can_approve"]
    assert len(body["members"]) == len(standard["member_ids"])
    assert all(m["items"] and m["problem"] is None for m in body["members"])
    # Short and client-friendly: the engagement and the due date; each control by its name
    # and system, then its items; no internal control IDs and no grouping.
    assert body["subject"] == f"[{body['reference']}] Evidence request for SOX 2027"
    assert "needs the evidence below by" in body["body"]
    for member in body["members"]:
        assert f"{member['control_title']} ({member['systems'][0]})" in body["body"]
        assert member["items"][0] in body["body"]
        assert member["control_ref"] not in body["body"]
    assert "controls" not in body["body"] and "group" not in body["body"].lower()
    assert "[secure upload link, added when the request is sent]" in body["body"]
    # Another firm sees nothing; an unknown id is not found.
    other = _new_outsider(migrated)
    assert _review(other, team, standard["id"]).status_code in (403, 404)
    assert _review(owner, team, str(uuid4())).status_code == 404


def _new_outsider(migrated: Database) -> Any:
    from test_evidence_center import _ready as ready

    outsider = ready(migrated, "eg-outsider")
    return outsider["owner"]


# Approval and sending


def test_approve_and_send_sends_one_email_and_keeps_each_control_traceable(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-send")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    members = [m["id"] for m in view["members"]]
    with connect(migrated.url) as connection:
        linked = {
            str(row[0]): str(row[1])
            for row in connection.execute(
                "SELECT id, pbc_request_id FROM evidence_requirements WHERE pbc_request_id = "
                "ANY(%s::uuid[])",
                (members,),
            ).fetchall()
        }
    sent = _approve_send(owner, team, view, reason="Checked the request.")
    assert sent.status_code == 200, sent.text
    result = sent.json()
    assert (result["status"], result["delivery"]) == ("SENT", "ACCEPTED")
    with connect(migrated.url) as connection:
        outbound = connection.execute(
            "SELECT pbc_request_id, template_id, approval_id, thread_id, provider_message_id "
            "FROM outbound_messages WHERE project_id = %s",
            (team["project"],),
        ).fetchall()
        # One email, recorded against the lead's approval, in the group's wording.
        assert len(outbound) == 1
        lead, template, lead_approval, thread, provider = outbound[0]
        assert (str(lead), template) == (members[0], "pbc-group")
        assert _one(connection, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s",
                    team["project"]) == 1  # fmt: skip
        # Every request is sent in that one thread; each has its own approval, decided by
        # the person, asked by the evidence coordinator, executed once.
        requests = connection.execute(
            "SELECT id, status, thread_id, outbound_message_id FROM pbc_requests "
            "WHERE id = ANY(%s::uuid[])",
            (members,),
        ).fetchall()
        assert {(r[1], r[2], r[3]) for r in requests} == {("SENT", thread, provider)}
        approvals = connection.execute(
            """
            SELECT m.pbc_request_id, a.decision::text, a.execution_status, a.approver_user_id,
                   a.requesting_agent_id IS NOT NULL, a.parameters ->> 'request_ref',
                   (SELECT count(*) FROM action_executions x
                    WHERE x.approval_id = a.id AND x.status = 'SUCCEEDED'), a.id
            FROM evidence_request_group_members m JOIN approvals a ON a.id = m.approval_id
            WHERE m.group_id = %s ORDER BY m.position
            """,
            (view["id"],),
        ).fetchall()
        assert [str(a[0]) for a in approvals] == members
        assert all(
            a[1:5] == ("APPROVED", "SUCCEEDED", team["owner_id"], True) and a[6] == 1
            for a in approvals
        )
        # Each approval binds its own request to the group's one email.
        for a in approvals:
            assert str(a[5]).startswith(f"pbc/{a[0]}/pbc-group-v1/{view['id']}/")
        assert lead_approval == _one(
            connection,
            "SELECT lead_approval_id FROM evidence_request_groups WHERE id = %s",
            view["id"],
        )
        # The record holds exactly what was approved: each request and its requirements,
        # with their fingerprints, and the content digest.
        record = connection.execute(
            "SELECT members, content_sha256, subject, recipient, decision_reason "
            "FROM evidence_group_approvals WHERE group_id = %s",
            (view["id"],),
        ).fetchone()
        assert record is not None
        frozen = record[0]
        assert [m["request_id"] for m in frozen] == members
        recorded = {r["id"]: m["request_id"] for m in frozen for r in m["requirements"]}
        assert recorded == linked
        specs = dict(
            connection.execute(
                "SELECT requirement_id::text, spec_hash FROM evidence_specifications "
                "WHERE requirement_id = ANY(%s::uuid[])",
                (list(linked),),
            ).fetchall()
        )
        assert {r["id"]: r["spec_hash"] for m in frozen for r in m["requirements"]} == specs
        assert record[2] == view["subject"] and record[4] == "Checked the request."
        # The requirements still belong to their own requests: receipts and testing stay
        # per control.
        after = dict(
            connection.execute(
                "SELECT id::text, pbc_request_id::text FROM evidence_requirements "
                "WHERE id = ANY(%s::uuid[])",
                (list(linked),),
            ).fetchall()
        )
        assert after == linked
        # What was approved cannot be changed or removed.
        for statement in (
            "UPDATE evidence_group_approvals SET subject = 'x' WHERE group_id = %s",
            "DELETE FROM evidence_group_approvals WHERE group_id = %s",
            "UPDATE evidence_request_group_members SET position = 9 WHERE group_id = %s",
            "DELETE FROM evidence_request_groups WHERE id = %s",
            "UPDATE evidence_request_groups SET status = 'APPROVED', sent_at = NULL, "
            "version = version + 1 WHERE id = %s",
        ):
            with pytest.raises(psycopg.Error):
                connection.execute(statement, (view["id"],))
            connection.rollback()
    # A repeat never approves or sends again.
    again = _approve_send(owner, team, view)
    assert again.status_code == 200 and again.json()["status"] == "SENT"
    assert owner.post(f"{_project(team)}/evidence-groups/{view['id']}/send").status_code == 200
    # A request in the group never sends on its own.
    alone = owner.post(
        f"{_project(team)}/pbc-requests/{members[1]}/send",
        json={"approval_id": str(approvals[1][7])},
    )
    assert alone.status_code == 409
    with connect(migrated.url) as connection:
        assert _one(connection, "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
                    team["project"]) == 1  # fmt: skip
        assert (
            _one(
                connection,
                "SELECT count(*) FROM audit_events WHERE target_id = %s "
                "AND action IN ('evidence.group_approved', 'evidence.group_sent')",
                view["id"],
            )
            == 2
        )
    # The list shows it as one request with the client.
    [row] = [g for g in _groups(owner, team) if g["id"] == view["id"]]
    assert (row["stage"], row["group_status"]) == ("AWAITING_EVIDENCE", "SENT")


def test_a_persons_recipient_due_date_and_priority_are_never_overwritten(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-routing")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    moved, later = view["members"][1], view["members"][2]
    due = datetime.fromisoformat(later["due_at"]).date() + timedelta(days=5)

    def assign(member: dict[str, Any], **change: Any) -> None:
        current = {row["id"]: row for row in _all(owner, team)}[member["id"]]
        body = {
            "version": current["version"], "recipient": current["recipient"], "cc": [],
            "due_on": current["due_at"][:10], "priority": current["priority"], **change,
        }  # fmt: skip
        changed = owner.post(f"{_project(team)}/pbc-requests/{member['id']}/assignment", json=body)
        assert changed.status_code == 200, changed.text

    assign(moved, recipient="ops@client.example")
    assign(later, due_on=due.isoformat(), priority="HIGH")
    # Regrouping follows the person's routing: the reassigned draft goes with its new
    # recipient's request for the phase; the other stays, with its own date and priority.
    groups = _groups(owner, team)
    stays = next(g for g in groups if later["id"] in g["member_ids"])
    assert moved["id"] not in stays["member_ids"]
    assert any(
        moved["id"] in g["member_ids"] and g["recipient"] == "ops@client.example" for g in groups
    )
    assert stays["priority"] == "HIGH"
    again = _review(owner, team, stays["id"]).json()
    [kept] = [m for m in again["members"] if m["id"] == later["id"]]
    assert kept["due_differs"] is True and kept["due_at"][:10] == due.isoformat()
    assert f"(due {due.day} {due:%B %Y})" in again["body"]
    # Approving and sending changes none of it.
    assert _approve_send(owner, team, again).json()["status"] == "SENT"
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT recipient, due_at::date, priority FROM pbc_requests WHERE id = %s",
            (later["id"],),
        ).fetchone()
        other = connection.execute(
            "SELECT recipient, status FROM pbc_requests WHERE id = %s", (moved["id"],)
        ).fetchone()
    assert row is not None and (row[1], row[2]) == (due, "HIGH")
    assert other == ("ops@client.example", "DRAFT")


def test_a_changed_or_partial_view_is_refused_and_nothing_is_approved(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-stale")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    base = f"{_project(team)}/evidence-groups/{view['id']}/approve-send"
    seen = _seen(view)
    stale = [{**seen[0], "version": seen[0]["version"] + 1}, *seen[1:]]
    assert owner.post(base, json={"members": stale}).status_code == 409
    assert owner.post(base, json={"members": seen[:2]}).status_code == 409
    stranger = [*seen, {"id": str(uuid4()), "version": 1}]
    assert owner.post(base, json={"members": stranger}).status_code == 409
    # Only someone who may approve may approve and send.
    with connect(migrated.url) as connection:
        member = _add_user(connection, team["org"], f"c-{uuid4().hex[:6]}@example.com",
                           "CONTRIBUTOR")  # fmt: skip
        _add_project_member(connection, team["org"], team["project"], member)
    assert _session(migrated, member).post(base, json={"members": seen}).status_code == 403
    with connect(migrated.url) as connection:
        assert _one(connection, "SELECT count(*) FROM evidence_request_groups") == 0
        assert (
            _one(
                connection,
                "SELECT count(*) FROM approvals WHERE project_id = %s AND action_id = 'mail.pbc'",
                team["project"],
            )
            == 0
        )
        assert _one(
            connection,
            "SELECT count(*) FROM pbc_requests WHERE id = ANY(%s::uuid[]) AND status = 'DRAFT'",
            [m["id"] for m in view["members"]],
        ) == len(view["members"])


def test_a_changed_draft_is_kept_apart_and_offered_for_inclusion(migrated: Database) -> None:
    team = _ready(migrated, "eg-touched")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    first = _review(owner, team, standard["id"]).json()
    changed = first["members"][-1]
    every = {row["id"]: row for row in _all(owner, team)}
    classified = owner.post(
        f"{_project(team)}/pbc-requests/{changed['id']}/classification",
        json={"version": changed["version"], "request_type": every[changed["id"]]["request_type"],
              "title": "Access administrator listing"},
    )  # fmt: skip
    assert classified.status_code == 200, classified.text
    groups = _groups(owner, team)
    holding = next(g for g in groups if first["members"][0]["id"] in g["member_ids"])
    assert changed["id"] not in holding["member_ids"]
    view = _review(owner, team, holding["id"]).json()
    [offered] = view["optional"]
    assert offered["id"] == changed["id"]
    included = owner.post(
        f"{_project(team)}/evidence-groups/{view['id']}/approve-send",
        json={"members": _seen(view, [offered])},
    )
    assert included.status_code == 200, included.text
    assert [m["id"] for m in included.json()["members"]][-1] == changed["id"]


def test_an_interrupted_send_resumes_and_sends_once(migrated: Database) -> None:
    team = _ready(migrated, "eg-resume")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()

    def sends_then_times_out(
        settings: Settings, connection: psycopg.Connection[Any], org: UUID, project: UUID
    ) -> Any:
        return _TimesOut(migrated.url, org, project, deliver=True)

    with connect(migrated.url) as connection:
        first = approve_and_send(
            connection, _settings(migrated), _principal(team), team["org"], team["project"],
            UUID(view["id"]),
            ApproveSendBody(members=[SeenMember(**m) for m in _seen(view)]),
            sends_then_times_out,
        )  # fmt: skip
    assert (first.status, first.delivery) == ("APPROVED", "UNKNOWN")
    assert "not yet confirmed" in first.notice
    with connect(migrated.url) as connection:
        assert _one(
            connection,
            "SELECT count(*) FROM pbc_requests WHERE id = ANY(%s::uuid[]) "
            "AND status = 'APPROVAL_PENDING'",
            [m["id"] for m in view["members"]],
        ) == len(view["members"])
    resumed = owner.post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert resumed.status_code == 200, resumed.text
    assert (resumed.json()["status"], resumed.json()["delivery"]) == ("SENT", "ACCEPTED")
    with connect(migrated.url) as connection:
        assert _one(connection, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s",
                    team["project"]) == 1  # fmt: skip
        assert _one(connection, "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
                    team["project"]) == 1  # fmt: skip


def test_an_approval_committed_before_a_crash_is_sent_by_a_later_call(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-crash")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    with connect(migrated.url) as connection:
        _approve(
            connection, _settings(migrated), _principal(team), team["org"], team["project"],
            UUID(view["id"]), ApproveSendBody(members=[SeenMember(**m) for m in _seen(view)]),
            "Reviewed and approved.",
        )  # fmt: skip
        connection.commit()
    pending = _review(owner, team, view["id"]).json()
    assert (pending["status"], pending["delivery"]) == ("APPROVED", "")
    [row] = [g for g in _groups(owner, team) if g["id"] == view["id"]]
    assert row["stage"] == "APPROVED"
    # Approved and waiting: a request in it still never sends on its own, even with its own
    # approval.
    member = view["members"][1]["id"]
    with connect(migrated.url) as connection:
        own = _one(
            connection,
            "SELECT approval_id FROM evidence_request_group_members WHERE pbc_request_id = %s",
            member,
        )
    alone = owner.post(
        f"{_project(team)}/pbc-requests/{member}/send", json={"approval_id": str(own)}
    )
    assert alone.status_code == 409, alone.text
    with connect(migrated.url) as connection:
        assert _one(connection, "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
                    team["project"]) == 0  # fmt: skip
    sent = owner.post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert sent.status_code == 200 and sent.json()["status"] == "SENT"


def test_a_change_after_approval_is_not_sent_and_the_requests_return_to_draft(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-changed")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    with connect(migrated.url) as connection:
        _approve(
            connection, _settings(migrated), _principal(team), team["org"], team["project"],
            UUID(view["id"]), ApproveSendBody(members=[SeenMember(**m) for m in _seen(view)]),
            "Reviewed and approved.",
        )  # fmt: skip
        connection.commit()
        # The control's evidence plan is revised after the approval.
        connection.execute(
            "UPDATE evidence_plans SET revision = revision + 1, status = 'CHANGES_REQUESTED' "
            "WHERE engagement_control_id = (SELECT engagement_control_id FROM pbc_requests "
            "WHERE id = %s)",
            (view["members"][1]["id"],),
        )
    refused = owner.post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert refused.status_code == 409
    assert refused.json()["detail"].startswith("A request in it changed after it was approved.")
    after = _review(owner, team, view["id"]).json()
    assert after["status"] == "NOT_SENT" and after["reason"]
    with connect(migrated.url) as connection:
        assert _one(connection, "SELECT count(*) FROM outbound_messages WHERE project_id = %s",
                    team["project"]) == 0  # fmt: skip
        statuses = connection.execute(
            """
            SELECT r.status, a.execution_status, m.released_at IS NOT NULL
            FROM evidence_request_group_members m
            JOIN pbc_requests r ON r.id = m.pbc_request_id
            JOIN approvals a ON a.id = m.approval_id
            WHERE m.group_id = %s
            """,
            (view["id"],),
        ).fetchall()
    assert set(statuses) == {("DRAFT", "REFUSED", True)}
    # Back in draft, they are grouped again for a person to review, under a new id.
    again = _groups(owner, team)
    assert view["id"] not in {g["id"] for g in again}
    assert any(view["members"][0]["id"] in g["member_ids"] for g in again)


def test_a_refused_delivery_returns_the_requests_to_draft(migrated: Database) -> None:
    team = _ready(migrated, "eg-refused")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()

    class Refusing(MockMailbox):
        def send(self, **fields: Any) -> Any:
            raise MailboxState("refused")

    def refusing(
        settings: Settings, connection: psycopg.Connection[Any], org: UUID, project: UUID
    ) -> Any:
        return Refusing(connection, org, project)

    with connect(migrated.url) as connection:
        result = approve_and_send(
            connection, _settings(migrated), _principal(team), team["org"], team["project"],
            UUID(view["id"]), ApproveSendBody(members=[SeenMember(**m) for m in _seen(view)]),
            refusing,
        )  # fmt: skip
    assert (result.status, result.delivery) == ("NOT_SENT", "FAILED")
    assert result.reason == "The mail provider did not accept it."
    with connect(migrated.url) as connection:
        assert _one(
            connection,
            "SELECT count(*) FROM pbc_requests WHERE id = ANY(%s::uuid[]) AND status = 'DRAFT'",
            [m["id"] for m in view["members"]],
        ) == len(view["members"])
        assert _one(connection, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s",
                    team["project"]) == 0  # fmt: skip


# After sending: one reminder workflow, replies to a person


def test_one_reminder_workflow_for_the_group_and_none_for_its_members(
    migrated: Database,
) -> None:
    team = _ready(migrated, "eg-remind")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    assert _approve_send(owner, team, view).json()["status"] == "SENT"
    lead, second, *rest = [UUID(m["id"]) for m in view["members"]]
    later = datetime.now(UTC) + timedelta(days=60)
    with connect(migrated.url) as connection:
        # A member never reminds on its own; the lead reminds for the group.
        assert advance(connection, team["org"], team["project"], second, later) == DONE
        assert advance(connection, team["org"], team["project"], lead, later) != DONE
        due = connection.execute(
            "SELECT pbc_request_id, id FROM pbc_follow_ups WHERE project_id = %s "
            "AND status = 'DUE'",
            (team["project"],),
        ).fetchall()
        assert [row[0] for row in due] == [lead]
        follow_up = due[0][1]
        # The lead's own evidence came in: it still reminds while others are open.
        connection.execute(
            "UPDATE pbc_requests SET status = 'RECEIVED', version = version + 1 WHERE id = %s",
            (lead,),
        )
        assert lead in {row[2] for row in remindable_requests(connection, team["org"])}
    reminded = owner.post(f"{_project(team)}/pbc-requests/{lead}/follow-ups/{follow_up}/remind")
    assert reminded.status_code == 200, reminded.text
    preview = reminded.json()["preview"]
    assert preview["subject"] == f"[{view['reference']}] Reminder: evidence request for SOX 2027"
    outstanding = preview["body"].split("Still outstanding:")[1].splitlines()
    named = [f"- {m['control_title']} ({m['systems'][0]})" for m in view["members"]]
    assert named[0] not in outstanding and all(line in outstanding for line in named[1:])
    assert reminded.json()["delivery"]["status"] == "ACCEPTED"
    # A person asking to remind a member reminds the group, in its thread.
    now = owner.post(f"{_project(team)}/pbc-requests/{second}/follow-ups/now")
    assert now.status_code == 200, now.text
    assert now.json()["follow_up"]["pbc_request_id"] == str(lead)
    assert now.json()["preview"]["subject"] == preview["subject"]
    with connect(migrated.url) as connection:
        assert _one(
            connection,
            "SELECT count(*) FROM pbc_follow_ups WHERE project_id = %s "
            "AND pbc_request_id <> %s",
            team["project"], lead,
        ) == 0  # fmt: skip


def test_a_reply_in_the_groups_thread_goes_to_a_person(migrated: Database) -> None:
    team = _ready(migrated, "eg-reply")
    owner = team["owner"]
    standard, _ = _personal_split(owner, team)
    view = _review(owner, team, standard["id"]).json()
    assert _approve_send(owner, team, view).json()["status"] == "SENT"
    with connect(migrated.url) as connection:
        thread = _one(connection, "SELECT thread_id FROM pbc_requests WHERE id = %s",
                      view["members"][0]["id"])  # fmt: skip
    client = _session(migrated, team["owner_id"], email_mock_inbound_enabled=True)
    reply = client.post(
        f"{_project(team)}/mailbox/simulated-inbound",
        json={
            "notification_key": uuid4().hex,
            "sender": view["recipient"],
            "subject": f"Re: [{view['reference']}] Evidence request",
            "body": "Attached is what you asked for.",
            "thread_id": thread,
        },
    )
    assert reply.status_code == 200, reply.text
    # Several controls share the thread: which one it answers is for a person to decide.
    assert (reply.json()["match_status"], reply.json()["pbc_request_id"]) == ("UNMATCHED", None)
    assert reply.json()["unmatched_reason"] == "ambiguous_reference"
