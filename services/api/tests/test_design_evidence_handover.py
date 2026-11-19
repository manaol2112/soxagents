"""The D&I requests after the release (B1g; decided by the product owner on 12 November
2026, docs/control-workflow-plan.md), continued from test_design_evidence.py: split from it
on 19 November 2026, whole tests moved unchanged, so that no one file sets the slowest CI
part. Its engagement and request helpers are imported from there.

Approval boundary and evidence traceability (critical tier):

- a reviewer reads and is refused, and another firm sees nothing;
- the interim phase keeps its behaviour, and requests sent as one email to one person are
  handed over on record when email is off;
- after the independent review of 12 November 2026: a request whose email may be with the
  owner is never split; a hand-over is held to everything a send is held to and never ends
  without a record with the actor; an approval with email off says what it recorded; no
  item is stranded by a split, which requests only the items it took off and whose draft
  is split again; every item served is received; a send applies evidence that came in hand
  after the approval; a file read while the request is approved leaves one consistent
  record.
"""

from typing import Any
from uuid import UUID, uuid4

import pytest
from support import Database
from test_design_evidence import AC01, _added, _Case
from test_evidence_analysis import _no_ocr, _settings
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_outbound import _session, migrated

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.outbound import IN_HAND_ALL, IN_HAND_CHANGED

__all__ = ["migrated"]


def test_a_reviewer_reads_and_is_refused_and_another_firm_sees_nothing(
    migrated: Database,
) -> None:
    case = _Case(migrated, "roles")
    item = case.items[0]
    _reviewer_id, reviewer = case.member("REVIEWER")
    # Reads, with the new fields.
    plan = _plan(reviewer, case.team, case.control)
    assert plan["live_email"] is True
    assert all("in_hand" in r for r in _phase(plan, "DESIGN")["requirements"])
    assert case.read(case.request, reviewer)["delivery"] is None
    # Refused wherever its neighbours refuse.
    assert case.approve(case.request, reviewer).status_code == 403
    assert case.upload(item, "policy.txt", reviewer).status_code == 403
    control = f"{case.base}/controls/{case.control}"
    assert (
        reviewer.post(
            f"{control}/evidence-requirements",
            json={
                "phase": "DESIGN",
                "title": "Another request",
                "description": "Something the reviewer would like to see.",
                "categories": ["OTHER"],
                "objective": "None they may ask for.",
                "rationale": "A reviewer reads; they do not change the work.",
            },
        ).status_code
        == 403
    )
    assert (
        reviewer.post(
            f"{control}/evidence-requirements/{item['id']}/edit",
            json={"title": item["title"], "description": "Reworded by a reader.", "version": 1},
        ).status_code
        == 403
    )
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    assert case.send(case.request, approval_id, reviewer).status_code == 403
    # A reader where email is off hands nothing over either.
    off = case.email_off(_reviewer_id)
    assert case.send(case.request, approval_id, off).status_code == 403
    assert case.read(case.request)["delivery"] is None
    # A contributor prepares requests and may not approve one (as before).
    other = _Case(migrated, "roles-b")
    _contributor_id, contributor = other.member("CONTRIBUTOR")
    assert other.approve(other.request, contributor).status_code == 403
    # Another firm's person sees none of it.
    outsider = other.client
    assert outsider.get(f"{case.base}/pbc-requests/{case.request}").status_code in (403, 404)
    assert outsider.post(
        f"{case.base}/pbc-requests/{case.request}/send", json={"approval_id": approval_id}
    ).status_code in (403, 404)
    assert outsider.get(f"{control}/evidence-plan").status_code in (403, 404)
    assert case.audit("pbc.handed_over", case.request) == []


def test_an_interim_request_keeps_its_behaviour(migrated: Database) -> None:
    """The per-item rule is the D&I phase's. An unsent interim request still follows the
    earlier rule when a file comes for one of its items: the request moves as a whole and
    its items stay on it (the same defect exists there; it is reported, not changed)."""
    team, client, _scheduler = _engagement(migrated, f"de-interim-{uuid4().hex[:4]}")
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    control = _control(migrated, team, AC01)
    interim = _phase(_plan(client, team, control), "INTERIM")
    request = next(r for r in interim["requests"] if r["status"] == "DRAFT")
    carried = [
        r
        for r in interim["requirements"]
        if r["request_id"] == request["id"] and r["status"] == "REQUESTED"
    ]
    assert carried
    added = client.post(
        f"{base}/evidence-uploads",
        params={
            "batch_id": str(uuid4()),
            "name": "population.txt",
            "request_id": request["id"],
            "requirement_id": carried[0]["id"],
        },
        content=b"User ID, name, date granted.",
        headers={"content-type": "text/plain"},
    )
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        for (analysis_id,) in connection.execute(
            "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
        ).fetchall():
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
    after = _phase(_plan(client, team, control), "INTERIM")
    moved = next(r for r in after["requests"] if r["id"] == request["id"])
    assert moved["status"] in ("RECEIVED", "PARTIALLY_RECEIVED")
    assert moved["status"] == ("RECEIVED" if len(carried) == 1 else "PARTIALLY_RECEIVED")
    # No item left it, and no other interim request was drafted for the rest.
    still = [r for r in after["requirements"] if r["request_id"] == request["id"]]
    assert {r["id"] for r in still} >= {r["id"] for r in carried}
    assert [r["id"] for r in after["requests"]] == [r["id"] for r in interim["requests"]]


def test_requests_sent_as_one_email_are_handed_over_when_email_is_off(migrated: Database) -> None:
    """Requests that travel to one person as one email (the evidence centre's group):
    approved and sent with email off, each request is recorded as handed over by that
    person, nothing is sent, and the same email still goes out once a mailbox is on."""
    from test_evidence_center import _ready
    from test_evidence_flow import _project
    from test_evidence_groups import _approve_send, _personal_split, _review

    team = _ready(migrated, f"de-group-{uuid4().hex[:4]}")
    off = _session(migrated, team["owner_id"], email_provider="graph")
    standard, _personal = _personal_split(off, team)
    view = _review(off, team, standard["id"]).json()
    members = [str(m["id"]) for m in view["members"]]
    approved = _approve_send(off, team, view, reason="Checked the request.")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "APPROVED"
    assert "handed over" in approved.json()["notice"]
    with connect(migrated.url) as connection:
        name = connection.execute(
            "SELECT display_name FROM users WHERE id = %s", (team["owner_id"],)
        ).fetchone()
        sent = connection.execute(
            "SELECT (SELECT count(*) FROM outbound_messages WHERE project_id = %s), "
            "(SELECT count(*) FROM mailbox_messages WHERE project_id = %s)",
            (team["project"], team["project"]),
        ).fetchone()
        actors = connection.execute(
            "SELECT target_id, actor_user_id FROM audit_events WHERE action = 'pbc.handed_over' "
            "AND project_id = %s",
            (team["project"],),
        ).fetchall()
    assert name is not None and sent == (0, 0)
    assert sorted(actors) == sorted((UUID(member), team["owner_id"]) for member in members)
    for member in members:
        read = off.get(f"{_project(team)}/pbc-requests/{member}").json()
        assert read["status"] == "APPROVAL_PENDING" and read["live_email"] is False
        assert read["delivery"]["mode"] == "HANDED_OVER" and read["delivery"]["by"] == name[0]
    # With a mailbox on, the approved email goes out as approved; the delivery is then it.
    delivered = team["owner"].post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert delivered.status_code == 200, delivered.text
    assert delivered.json()["status"] == "SENT"
    for member in members:
        read = team["owner"].get(f"{_project(team)}/pbc-requests/{member}").json()
        assert read["status"] == "SENT" and read["delivery"]["mode"] == "EMAIL"


# After the independent review of 12 November 2026 (docs/control-workflow-plan.md, B1g
# "After the independent review"): each finding with its regression test.


def _send_with_unknown_outcome(case: _Case, request_id: str, approval_id: str) -> Any:
    """A send whose provider delivered the message and then timed out: its outcome is
    unknown, and the request still awaits its send on record."""
    from test_outbound import _TimesOut

    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.outbound import send_request
    from ai_workforce_api.settings import Settings

    with connect(case.database.url) as connection:
        return send_request(
            connection,
            Settings(database_url=case.database.url),
            Principal(kind=PrincipalKind.USER, id=case.team["owner_id"]),
            UUID(str(case.team["org"])),
            UUID(str(case.team["project"])),
            UUID(request_id),
            UUID(approval_id),
            lambda settings, c, org, project: _TimesOut(  # type: ignore[arg-type,return-value]
                case.database.url, org, project, deliver=True
            ),
        )


def test_a_request_whose_email_may_be_with_the_owner_is_never_split(migrated: Database) -> None:
    """Review finding 1: a send was started and its outcome is unknown (the message may
    have been delivered). A file then read for one item must not take the other items off
    the request and reword it as never sent: it is treated as asked for, whole."""
    case = _Case(migrated, "flight")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    worded = case.read(case.request)["evidence_description"]
    unknown = _send_with_unknown_outcome(case, case.request, approved.json()["approval"]["id"])
    assert unknown.status == "UNKNOWN"
    assert case.read(case.request)["status"] == "APPROVAL_PENDING"
    case.add_for(case.items[0], "access policy.txt")
    after = case.read(case.request)
    assert after["status"] == "PARTIALLY_RECEIVED"
    assert after["evidence_description"] == worded
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    assert [r["id"] for r in case.design()["requests"]] == [case.request]
    assert case.audit("pbc.items_requested_separately", case.request) == []
    # Nor at an approval or a send: the settle leaves it alone too.
    assert case.rows(
        "SELECT status FROM outbound_messages WHERE pbc_request_id = %s", UUID(case.request)
    ) == [("UNKNOWN",)]


def test_a_hand_over_is_held_to_everything_a_send_is_held_to(
    migrated: Database, monkeypatch: Any
) -> None:
    """Review finding 2: the hand-over skipped the recipient allow-list and the action
    policy, which a send enforces. Where a send would be refused, nothing is recorded."""
    from ai_workforce_api import outbound
    from ai_workforce_api.outbound import NOT_HANDED_OVER, OutboundState

    # A recipient outside the allowed domains: a send to them is refused, so is this.
    case = _Case(migrated, "held")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    narrow = _session(
        migrated,
        case.team["owner_id"],
        email_provider="graph",
        email_allowed_recipient_domains="elsewhere.example",
    )
    assert case.send(case.request, approval_id, narrow).status_code == 409
    assert case.read(case.request)["delivery"] is None
    # The action policy: sending requests is restricted on this engagement.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO action_restrictions (organization_id, project_id, action_id) "
            "VALUES (%s, %s, 'mail.pbc')",
            (case.team["org"], case.team["project"]),
        )
    assert case.send(case.request, approval_id, case.email_off()).status_code == 409
    assert case.read(case.request)["delivery"] is None
    assert case.audit("pbc.handed_over", case.request) == []
    # Without the restriction the same send is refused for email alone, and handed over.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM action_restrictions WHERE project_id = %s", (case.team["project"],)
        )
    assert case.send(case.request, approval_id, case.email_off()).status_code == 409
    assert case.read(case.request)["delivery"]["mode"] == "HANDED_OVER"

    # An approver whose send would be refused approves, and nothing is handed over: the
    # answer says so. (Asking for the approval is itself refused under a restriction, so
    # the refusal is placed where the hand-over checks it.)
    other = _Case(migrated, "held-b")

    def refuse(*_args: Any, **_kwargs: Any) -> None:
        raise OutboundState("action is not allowed")

    monkeypatch.setattr(outbound, "_require_policy", refuse)
    answered = other.approve(other.request, other.email_off())
    assert answered.status_code == 200, answered.text
    body = answered.json()
    assert body["approval"]["decision"] == "APPROVED"
    assert (body["handed_over"], body["notice"]) == (False, NOT_HANDED_OVER)
    assert body["request"]["delivery"] is None and body["live_email"] is False
    assert other.audit("pbc.handed_over", other.request) == []
    assert other.read(other.request)["delivery"] is None


def test_an_approval_with_email_off_says_what_it_recorded(migrated: Database) -> None:
    """Review findings 2 and 7: the approve answer, and the bulk "Approve", say that the
    request was handed over when it was, in one sentence."""
    from ai_workforce_api.outbound import HANDED_OVER

    case = _Case(migrated, "says")
    answered = case.approve(case.request, case.email_off())
    assert answered.status_code == 200, answered.text
    assert (answered.json()["handed_over"], answered.json()["notice"]) == (True, HANDED_OVER)
    # With a mailbox on there is nothing to say: it waits to be sent.
    on = _Case(migrated, "says-on")
    answered = on.approve(on.request)
    assert (answered.json()["handed_over"], answered.json()["notice"]) == (False, "")

    bulk = _Case(migrated, "says-bulk")
    current = bulk.read(bulk.request)
    changed = bulk.email_off().post(
        f"{bulk.base}/evidence-requests/bulk",
        json={
            "action": "APPROVE",
            "items": [{"id": bulk.request, "version": current["version"]}],
            "reason": "Read it; asks for the right items.",
        },
    )
    assert changed.status_code == 200, changed.text
    outcome = next(o for o in changed.json()["outcomes"] if o["id"] == bulk.request)
    assert (outcome["ok"], outcome["detail"]) == (True, HANDED_OVER)
    assert bulk.read(bulk.request)["delivery"]["mode"] == "HANDED_OVER"


def test_a_handed_over_request_that_receives_evidence_and_loses_it(migrated: Database) -> None:
    """Review findings 3 and 6. A handed-over request was asked for, whole: evidence that
    arrives for one item is received, not "in hand", and nothing is split. When that
    evidence is withdrawn the request returns to draft and its hand-over ends, on the
    trail, with who withdrew the file and why."""
    case = _Case(migrated, "ho-evidence")
    approved = case.approve(case.request, case.email_off())
    assert approved.json()["handed_over"] is True
    first = case.items[0]
    file_id = case.add_for(first, "access policy.txt")
    after = case.read(case.request)
    assert (after["status"], after["provided_directly"]) == ("PARTIALLY_RECEIVED", True)
    assert after["delivery"]["mode"] == "HANDED_OVER"
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    held = case.item(first["id"])
    assert [f["name"] for f in held["files"]] == ["access policy.txt"]
    assert held["in_hand"] is False
    assert case.audit("pbc.items_requested_separately", case.request) == []

    withdrawn = case.client.post(
        f"{case.base}/evidence-files/{file_id}/withdraw", json={"reason": "The wrong version."}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    back = case.read(case.request)
    assert (back["status"], back["delivery"]) == ("DRAFT", None)
    ended = case.audit("pbc.handover_withdrawn", case.request)
    assert [(row[0], row[1]) for row in ended] == [(case.team["owner_id"], None)]
    assert ended[0][2]["reason"] == "its evidence was withdrawn"
    assert ended[0][2]["approval_id"] == approved.json()["approval"]["id"]
    assert ended[0][2]["handed_over_by"] == str(case.team["owner_id"])


def test_a_hand_over_never_ends_without_a_record(migrated: Database) -> None:
    """Review finding 3: every path that returns a handed-over request to draft says so
    on the trail, with the actor and the reason, and the database refuses one that does
    not (migration 0153)."""
    import psycopg

    # An approval of it rejected.
    case = _Case(migrated, "ho-reject")
    approved = case.approve(case.request, case.email_off())
    assert approved.json()["handed_over"] is True
    with connect(migrated.url) as connection:
        # As when its approval can no longer send it; a new approval is then asked.
        connection.execute(
            "UPDATE approvals SET execution_status = 'REFUSED' WHERE id = %s",
            (approved.json()["approval"]["id"],),
        )
    current = case.read(case.request)
    submitted = case.client.post(
        f"{case.base}/pbc-requests/{case.request}/submit", json={"version": current["version"]}
    )
    assert submitted.status_code == 200, submitted.text
    reviewer = _session(migrated, case.team["reviewer_id"])
    rejected = reviewer.post(
        f"{case.base}/approvals/{submitted.json()['approval']['id']}/decision",
        json={"decision": "REJECTED", "reason": "Ask for the signed version."},
    )
    assert rejected.status_code == 200, rejected.text
    assert (case.read(case.request)["status"], case.read(case.request)["delivery"]) == (
        "DRAFT",
        None,
    )
    ended = case.audit("pbc.handover_withdrawn", case.request)
    assert [row[0] for row in ended] == [case.team["reviewer_id"]]
    assert ended[0][2]["reason"] == "an approval of it was rejected"

    # A path that records nothing is refused, and the hand-over stands.
    other = _Case(migrated, "ho-bypass")
    assert other.approve(other.request, other.email_off()).json()["handed_over"] is True
    with pytest.raises(psycopg.errors.RaiseException, match="hand-over"):
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE pbc_requests SET status = 'DRAFT' WHERE id = %s", (other.request,)
            )
    assert other.read(other.request)["delivery"]["mode"] == "HANDED_OVER"
    assert other.audit("pbc.handover_withdrawn", other.request) == []


def test_requests_sent_as_one_email_and_not_sent_end_their_hand_over_on_record(
    migrated: Database,
) -> None:
    """Review finding 3, for requests that travel as one email: handed over with email
    off, then changed, so the email is not sent as approved and they return to draft."""
    from test_evidence_center import _ready
    from test_evidence_flow import _project
    from test_evidence_groups import _approve_send, _personal_split, _review

    team = _ready(migrated, f"de-retire-{uuid4().hex[:4]}")
    off = _session(migrated, team["owner_id"], email_provider="graph")
    standard, _personal = _personal_split(off, team)
    view = _review(off, team, standard["id"]).json()
    members = [str(m["id"]) for m in view["members"]]
    assert _approve_send(off, team, view, reason="Checked the request.").status_code == 200
    with connect(migrated.url) as connection:
        # One of them changed after the approval.
        connection.execute(
            "UPDATE pbc_requests SET version = version + 1 WHERE id = %s", (members[0],)
        )
    refused = team["owner"].post(f"{_project(team)}/evidence-groups/{view['id']}/send")
    assert refused.status_code == 409, refused.text
    with connect(migrated.url) as connection:
        states = connection.execute(
            "SELECT status, handed_over_at FROM pbc_requests WHERE id = ANY(%s::uuid[])",
            (members,),
        ).fetchall()
        ended = connection.execute(
            "SELECT target_id, actor_user_id FROM audit_events "
            "WHERE action = 'pbc.handover_withdrawn' AND project_id = %s",
            (team["project"],),
        ).fetchall()
    assert states == [("DRAFT", None)] * len(members)
    assert sorted(ended) == sorted((UUID(member), team["owner_id"]) for member in members)


def test_items_that_cannot_be_requested_again_stay_on_their_request(migrated: Database) -> None:
    """Review finding 4: the split took the remaining items off the request even when
    they could not be requested again (here a kickoff draft waits to be settled against
    the plan), leaving them planned with no request and an audit record of none. Now the
    request stays whole, as before the per-item rule: no item is stranded."""
    case = _Case(migrated, "strand")
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO pbc_requests (organization_id, project_id, operation_key, control_ref, "
            "owner_user_id, recipient, due_at, evidence_description, engagement_control_id, "
            "drafted_by) SELECT organization_id, project_id, 'kickoff-legacy', control_ref, "
            "owner_user_id, recipient, due_at, 'Drafted at kickoff.', engagement_control_id, "
            "'AGENT' FROM pbc_requests WHERE id = %s",
            (case.request,),
        )
    case.add_for(case.items[0], "access policy.txt")
    after = case.read(case.request)
    assert (after["status"], after["provided_directly"]) == ("PARTIALLY_RECEIVED", True)
    assert {r["id"] for r in case.carried(case.request)} == {r["id"] for r in case.items}
    assert case.audit("pbc.items_requested_separately", case.request) == []
    assert case.rows(
        "SELECT count(*) FROM evidence_requirements WHERE engagement_control_id = %s "
        "AND phase = 'DESIGN' AND status = 'PLANNED' AND id = ANY(%s::uuid[])",
        UUID(case.control),
        [r["id"] for r in case.items],
    ) == [(0,)]


def test_a_split_requests_only_the_items_it_took_off(migrated: Database) -> None:
    """Review finding 5: the re-issue requested every planned item of every phase of the
    control. A D&I file now requests only the D&I items it left to ask for."""
    case = _Case(migrated, "narrow")
    waiting = case.rows(
        "SELECT q.id, q.pbc_request_id, r.version FROM evidence_requirements q "
        "JOIN pbc_requests r ON r.id = q.pbc_request_id "
        "WHERE q.engagement_control_id = %s AND q.phase = 'INTERIM' AND q.status = 'REQUESTED' "
        "AND q.depends_on IS NULL AND r.status = 'DRAFT' ORDER BY q.created_at LIMIT 1",
        UUID(case.control),
    )
    assert waiting, "the control has an interim item in a draft"
    item, request, _version = waiting[0]
    with connect(migrated.url) as connection:
        # An interim item planned and not requested, as one a person restored would be.
        connection.execute(
            "UPDATE evidence_requirements SET status = 'PLANNED', pbc_request_id = NULL "
            "WHERE id = %s",
            (item,),
        )
    before = case.rows(
        "SELECT version, evidence_description FROM pbc_requests WHERE id = %s", request
    )
    case.add_for(case.items[0], "access policy.txt")
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.rows(
        "SELECT status, pbc_request_id FROM evidence_requirements WHERE id = %s", item
    ) == [("PLANNED", None)]
    assert (
        case.rows("SELECT version, evidence_description FROM pbc_requests WHERE id = %s", request)
        == before
    )
    assert case.rows(
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'pbc.updated' "
        "AND payload ->> 'source' = 'evidence_in_hand' AND payload ->> 'phase' <> 'DESIGN'",
        case.team["project"],
    ) == [(0,)]


def test_every_item_served_is_received_whatever_the_draft_counted(migrated: Database) -> None:
    """Review finding 8: with the coordinator's draft on record, a request whose every
    item had a file of its own was marked partly received while the approval was told
    nothing needed sending. Both now say received."""
    from ai_workforce_api.pbc_drafting import run_draft

    for slug, read in (("served-read", True), ("served-approve", False)):
        case = _Case(migrated, slug)
        with connect(migrated.url) as connection:
            draft = connection.execute(
                "SELECT id FROM pbc_drafts WHERE pbc_request_id = %s", (case.request,)
            ).fetchone()
            assert draft is not None
            assert run_draft(connection, None, draft[0]) == "DRAFTED"
        for number, item in enumerate(case.items):
            case.add_for(item, f"evidence {number}.txt", read=False)
        if read:
            case.read_files()
        else:
            refused = case.approve(case.request)
            assert refused.status_code == 409 and refused.json()["detail"] == IN_HAND_ALL
        assert case.read(case.request)["status"] == "RECEIVED"


def test_sending_applies_evidence_that_came_in_hand_after_the_approval(
    migrated: Database,
) -> None:
    """Review finding 9: evidence in hand for one item after the approval (its reading not
    ended, or a file linked) left the send emailing the approved wording, which still
    asked for it. The send is refused, and the shorter wording is approved again."""
    case = _Case(migrated, "resettle")
    approved = case.approve(case.request)
    assert approved.status_code == 200, approved.text
    approval_id = approved.json()["approval"]["id"]
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt", read=False)
    refused = case.send(case.request, approval_id)
    assert refused.status_code == 409 and refused.json()["detail"] == IN_HAND_CHANGED
    assert case.count("outbound_messages") == 0 and case.count("mailbox_messages") == 0
    assert case.read(case.request)["status"] == "RECEIVED"
    assert case.rows(
        "SELECT decision::text, execution_status FROM approvals WHERE id = %s", UUID(approval_id)
    ) == [("APPROVED", "REFUSED")]
    outgoing = str(case.item(rest[0]["id"])["request_id"])
    again = case.approve(outgoing)
    assert again.status_code == 200, again.text
    assert case.send(outgoing, again.json()["approval"]["id"]).status_code == 200
    mailed = case.rows(
        "SELECT body FROM mailbox_messages WHERE project_id = %s", case.team["project"]
    )
    assert len(mailed) == 1 and first["title"] not in mailed[0][0]


def test_the_draft_made_by_a_split_is_split_again(migrated: Database) -> None:
    """The draft for the remaining items is a request like any other: a file for one of
    its items leaves the rest to be asked for once more, without either item in hand."""
    case = _Case(migrated, "twice")
    _added(case, "Approval ticket for the new joiner")
    items = case.carried(case.request)
    assert len(items) >= 3
    first, second, rest = items[0], items[1], items[2:]
    case.add_for(first, "first.txt")
    middle = str(case.item(second["id"])["request_id"])
    assert middle != case.request
    case.add_for(case.item(second["id"]), "second.txt")
    assert case.read(middle)["status"] == "RECEIVED"
    assert case.item(second["id"])["request_id"] == middle
    last = {str(case.item(item["id"])["request_id"]) for item in rest}
    assert len(last) == 1 and not last & {case.request, middle}
    final = case.read(last.pop())
    assert final["status"] == "DRAFT"
    assert first["title"] not in final["evidence_description"]
    assert second["title"] not in final["evidence_description"]
    assert all(item["title"] in final["evidence_description"] for item in rest)
    assert len(case.audit("pbc.items_requested_separately", middle)) == 1
    assert all(case.item(item["id"])["in_hand"] for item in (first, second))
    assert case.count("outbound_messages") == 0


def test_an_upload_read_while_the_request_is_approved_leaves_one_consistent_record(
    migrated: Database,
) -> None:
    """The reading of a file for one item ends while a person approves the request: both
    finish (one waits for the other), the request with the item in hand is received, the
    rest are in a draft, and no approval is left that could send either wording."""
    import threading

    case = _Case(migrated, "race")
    first, rest = case.items[0], case.items[1:]
    case.add_for(first, "access policy.txt", read=False)
    start = threading.Barrier(2)
    answers: list[Any] = []
    failures: list[BaseException] = []

    def approve() -> None:
        try:
            start.wait(timeout=30)
            answers.append(case.approve(case.request))
        except BaseException as error:
            failures.append(error)

    def read() -> None:
        try:
            start.wait(timeout=30)
            case.read_files()
        except BaseException as error:
            failures.append(error)

    workers = [threading.Thread(target=approve), threading.Thread(target=read)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=120)
    assert not any(worker.is_alive() for worker in workers) and failures == []
    # The approval never went through: the item was in hand before it could.
    assert [answer.status_code for answer in answers] == [409], answers[0].text
    assert case.read(case.request)["status"] == "RECEIVED"
    assert {r["id"] for r in case.carried(case.request)} == {first["id"]}
    carrying = {str(case.item(item["id"])["request_id"]) for item in rest}
    assert len(carrying) == 1 and case.read(carrying.pop())["status"] == "DRAFT"
    assert case.rows(
        "SELECT count(*) FROM approvals WHERE project_id = %s AND action_id = 'mail.pbc' "
        "AND (decision = 'PENDING' OR (decision = 'APPROVED' "
        "AND execution_status = 'NOT_STARTED'))",
        case.team["project"],
    ) == [(0,)]
    assert len(case.audit("pbc.items_requested_separately", case.request)) == 1
    assert case.count("outbound_messages") == 0
