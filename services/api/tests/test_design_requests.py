"""The D&I requests list (B1e; decided by the product owner on 12 November 2026,
docs/control-workflow-plan.md): "Why do I need to have the release button? Simplify the
workflow. After the attributes approval, list down the evidences so that I can add, modify
or update, or delete." and "Agent proposes, the human approves. For each request, I want to
show which specific attributes it is addressing to make sure I get coverage."

Approval boundary and evidence traceability (critical tier):

- a D&I request is accepted by a person, or is the agent's proposal to accept; a person's
  own add, edit, links change or restore accepts it as that person;
- the planner never overwrites an accepted request: its change or removal arrives as the
  request's pending change, and what it adds arrives unaccepted;
- every approved attribute is addressed by a live D&I request, or a person recorded why
  not (an exception with a reason);
- the D&I evidence is released in the request of the person who completes the list, as
  theirs, and never by a worker, a scheduler or an agent; there is no early D&I release.
"""

from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import (
    Database,
    accept_design_requests,
    tailor_criteria,
    understand_and_settle_attributes,
)
from test_evidence_plans import _Planner
from test_execution import _add_project_member, _add_user
from test_outbound import _session, migrated
from test_planning_gate import _control, _launched, _plan, _project, _rows

from ai_workforce_api.auth import token_hash
from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.control_attributes import AttributeAdd, add_attribute
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_planning import rules_plan
from ai_workforce_api.evidence_plans import fail_plan_run, generate, load_facts, run_plan
from ai_workforce_api.main import create_app
from ai_workforce_api.migrate import migrations_dir
from ai_workforce_api.pbc_drafting import run_draft
from ai_workforce_api.phase_release import settle_design, settle_design_after_run
from ai_workforce_api.settings import Settings

__all__ = ["migrated"]

AC02 = "ITGC-AC-02"
NEW = "The removal is recorded on the leaver's ticket with the date it was done"
WHY = "Evidenced at interim only: the ticket date is tested on each sampled leaver."
STALE = "A request changed after you opened the list. Read the list again, then accept."
LIVE = ("PLANNED", "AWAITING_DEPENDENCY", "REQUESTED")


def _path(team: dict[str, Any], control: str) -> str:
    return f"{_project(team)}/controls/{control}"


def _prepared(migrated: Database, slug: str) -> tuple[dict[str, Any], str]:
    """A launched control with everything the list waits for before its requests: Control
    Understanding complete, and the attributes settled with criteria a person owns. Its D&I
    requests are as the planner proposed them: none accepted yet."""
    team = _launched(migrated, slug)
    control = str(_control(team, AC02)["id"])
    understand_and_settle_attributes(migrated, team["project"], control)
    # The evidence is planned again from the understanding, as the run that follows it
    # does (here by the rules): planning it once more, unchanged, then changes nothing.
    with connect(migrated.url) as connection:
        generate(
            connection, None, UUID(str(team["org"])), UUID(str(team["project"])),
            UUID(control), team["owner_id"],
        )  # fmt: skip
        connection.commit()
    return team, control


def _requests(team: dict[str, Any], control: str, client: Any = None) -> list[dict[str, Any]]:
    """The control's D&I requests in the list, as the plan's body gives them."""
    reader = client or team["owner"]
    read = reader.get(f"{_path(team, control)}/evidence-plan")
    assert read.status_code == 200, read.text
    design = next(item for item in read.json()["phases"] if item["phase"] == "DESIGN")
    found: list[dict[str, Any]] = [
        item for item in design["requirements"] if item["status"] in LIVE
    ]
    return found


def _summary(team: dict[str, Any], control: str) -> dict[str, Any]:
    found: dict[str, Any] = _plan(team, control)["design_requests"]
    return found


def _design(team: dict[str, Any], control: str) -> dict[str, Any]:
    read = team["owner"].get(f"{_project(team)}/phase-progress")
    assert read.status_code == 200, read.text
    row = next(item for item in read.json()["controls"] if item["control_id"] == control)
    found: dict[str, Any] = next(item for item in row["phases"] if item["phase"] == "DESIGN")
    return found


def _approved(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT id, text FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'APPROVED' ORDER BY position, created_at",
        UUID(control),
    )


def _releases(migrated: Database, control: str) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT released_by, early, automatic, reason FROM phase_releases "
        "WHERE engagement_control_id = %s AND phase = 'DESIGN'",
        UUID(control),
    )


def _audit(migrated: Database, action: str, target: Any) -> list[tuple[Any, ...]]:
    return _rows(
        migrated,
        "SELECT actor_user_id, payload FROM audit_events WHERE action = %s AND target_id = %s "
        "ORDER BY occurred_at, id",
        action,
        target if isinstance(target, UUID) else UUID(str(target)),
    )


def _accept(client: Any, team: dict[str, Any], control: str, items: list[dict[str, Any]]) -> Any:
    return client.post(
        f"{_path(team, control)}/design-requests/accept",
        json={
            "items": [{"requirement_id": item["id"], "version": item["version"]} for item in items]
        },
    )


def _member(migrated: Database, team: dict[str, Any], role: str) -> tuple[UUID, Any]:
    with connect(migrated.url) as connection:
        user = _add_user(
            connection, team["org"], f"{role.lower()}-{uuid4().hex[:6]}@example.com", role
        )
        _add_project_member(connection, team["org"], team["project"], user)
    return user, _session(migrated, user)


def _name(migrated: Database, user_id: Any) -> str:
    return str(_rows(migrated, "SELECT display_name FROM users WHERE id = %s", user_id)[0][0])


def _unsettle_attributes(migrated: Database, control: str) -> None:
    """The attribute agent proposes a wording: the attributes are not settled."""
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                basis, source_kind, proposal
            )
            SELECT organization_id, project_id, id, 99,
                   'Access is removed within one business day of the approval being withdrawn.',
                   'PROPOSED', 'INFERRED', 'AGENT', 'ADD'
            FROM engagement_controls WHERE id = %s
            """,
            (control,),
        )
        connection.commit()


def _reject_proposals(migrated: Database, control: str) -> None:
    """The proposal is gone without a person's request on the control (a direct write, as
    no route would): the list can then be settled with nobody's request last."""
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE control_attributes SET status = 'REJECTED' "
            "WHERE engagement_control_id = %s AND status = 'PROPOSED'",
            (control,),
        )
        connection.commit()


def test_the_requests_wait_to_be_accepted_and_show_the_attributes_they_address(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-list")
    approved = {str(row[0]) for row in _approved(migrated, control)}
    assert len(approved) >= 2
    requests = _requests(team, control)
    assert requests
    # As the planner proposed them: none accepted, each to accept, each showing the approved
    # attributes it addresses (its links), and together covering every attribute.
    for item in requests:
        assert (item["accepted"], item["to_accept"]) == (False, True), item
        assert item["accepted_by"] is None and item["accepted_at"] is None
        assert set(item["attribute_ids"]) <= approved
    assert {a for item in requests for a in item["attribute_ids"]} == approved
    instance = next(item for item in requests if "CONTROL_EXECUTION" in item["categories"])
    assert set(instance["attribute_ids"]) == approved
    # The links are the record: the body shows exactly what evidence_requirement_attributes holds.
    linked = _rows(
        migrated,
        "SELECT attribute_id FROM evidence_requirement_attributes WHERE requirement_id = %s",
        UUID(instance["id"]),
    )
    assert {str(row[0]) for row in linked} == set(instance["attribute_ids"])
    summary = _summary(team, control)
    count = len(requests)
    assert summary == {
        "settled": False,
        "released": False,
        "to_accept": count,
        "uncovered": [],
        "exceptions": [],
        "waiting_for": f"{count} D&I request{'' if count == 1 else 's'} "
        f"{'waits' if count == 1 else 'wait'} to be accepted.",
        "working": False,
        "drafting": False,
    }
    # The operating phases' items are not part of the list.
    plan = _plan(team, control)
    for phase in plan["phases"]:
        if phase["phase"] != "DESIGN":
            assert not any(item["to_accept"] or item["accepted"] for item in phase["requirements"])
    # The phase status says the same, and nothing is released or requested.
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "REQUESTS")
    assert design["step_label"] == "Requests to accept"
    assert design["waiting_for"] == summary["waiting_for"]
    assert _releases(migrated, control) == []
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]


def test_accepting_the_last_request_releases_the_d_and_i_evidence_as_that_person(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-accept")
    owner = team["owner"]
    requests = _requests(team, control)
    assert len(requests) >= 2
    first, rest = requests[0], requests[1:]
    sent = _rows(
        migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
    )
    # One request accepted: it is that person's, and the list still waits for the others.
    one = _accept(owner, team, control, [first])
    assert one.status_code == 200, one.text
    after = {item["id"]: item for item in _requests(team, control)}
    assert after[first["id"]]["accepted"] is True and after[first["id"]]["to_accept"] is False
    assert after[first["id"]]["accepted_by"] == _name(migrated, team["owner_id"])
    assert after[first["id"]]["accepted_at"]
    assert after[first["id"]]["version"] == first["version"] + 1
    assert all(after[item["id"]]["to_accept"] for item in rest)
    assert one.json()["design_requests"]["to_accept"] == len(rest)
    assert one.json()["design_requests"]["released"] is False
    assert _releases(migrated, control) == []
    recorded = _audit(migrated, "evidence_requirement.accepted", first["id"])
    assert [(row[0], row[1]["by"], row[1]["change"]) for row in recorded] == [
        (team["owner_id"], "ACCEPT", None)
    ]
    group = _audit(migrated, "design_requests.accepted", control)
    assert [(row[0], row[1]["items"]) for row in group] == [
        (team["owner_id"], [{"requirement": first["id"], "change": None}])
    ]
    # The rest accepted in one decision ("Accept all"): the list is settled, and the D&I
    # evidence is released in that request, by that person, with no release pressed.
    done = _accept(owner, team, control, [after[item["id"]] for item in rest])
    assert done.status_code == 200, done.text
    summary = done.json()["design_requests"]
    assert summary == {
        "settled": True,
        "released": True,
        "to_accept": 0,
        "uncovered": [],
        "exceptions": [],
        "waiting_for": "",
        "working": False,
        # No worker in this test: the drafts wait, so the requests are still being drafted.
        "drafting": True,
    }
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    design = _design(team, control)
    assert (design["step"], design["early"], design["automatic"]) == ("RELEASED", False, True)
    assert design["released_by"] == _name(migrated, team["owner_id"])
    # What was released is on the audit trail, with the person as the actor: the attributes
    # as worded, each request with the attributes it addresses, and no exception.
    approved = _approved(migrated, control)
    audit = _audit(migrated, "phase.released", control)
    assert len(audit) == 1 and audit[0][0] == team["owner_id"]
    payload = audit[0][1]
    assert (payload["phase"], payload["early"], payload["automatic"]) == ("DESIGN", False, True)
    assert payload["attributes"] == [row[1] for row in approved]
    assert payload["exceptions"] == []
    final = {item["id"]: item for item in _requests(team, control)}
    assert {item["id"] for item in payload["requirements"]} == set(final)
    for item in payload["requirements"]:
        assert item["title"] == final[item["id"]]["title"]
        assert item["attribute_ids"] == final[item["id"]]["attribute_ids"]
    assert {a for item in payload["requirements"] for a in item["attribute_ids"]} == {
        str(row[0]) for row in approved
    }
    # The Design items are requested: drafts for a person to approve. Nothing is sent.
    drafted = _rows(
        migrated,
        "SELECT status FROM pbc_requests WHERE engagement_control_id = %s "
        "AND testing_phase = 'DESIGN'",
        UUID(control),
    )
    assert drafted and all(row[0] == "DRAFT" for row in drafted)
    assert all(item["status"] == "REQUESTED" for item in final.values())
    assert (
        _rows(
            migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
        )
        == sent
    )
    # Idempotent: accepting again at the versions now shown, and the release route, change
    # nothing; the stale versions are refused.
    stale = _accept(owner, team, control, rest)
    assert stale.status_code == 409 and stale.json()["detail"] == STALE
    again = _accept(owner, team, control, list(final.values()))
    assert again.status_code == 200, again.text
    manual = owner.post(f"{_path(team, control)}/phases/DESIGN/release", json={})
    assert manual.status_code == 200, manual.text
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    assert len(_audit(migrated, "phase.released", control)) == 1
    assert len(_audit(migrated, "design_requests.accepted", control)) == 2
    assert len(
        _rows(
            migrated,
            "SELECT 1 FROM pbc_requests WHERE engagement_control_id = %s "
            "AND testing_phase = 'DESIGN'",
            UUID(control),
        )
    ) == len(drafted)


def test_an_acceptance_is_all_or_none_at_the_versions_the_person_saw(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-all-or-none")
    owner = team["owner"]
    requests = _requests(team, control)
    assert len(requests) >= 2

    def untouched() -> None:
        assert not any(item["accepted"] for item in _requests(team, control))
        assert [item["version"] for item in _requests(team, control)] == [
            item["version"] for item in requests
        ]
        for item in requests:
            assert _audit(migrated, "evidence_requirement.accepted", item["id"]) == []
        assert _audit(migrated, "design_requests.accepted", control) == []
        assert _releases(migrated, control) == []

    # One stale version refuses the whole decision: the current ones are not accepted.
    stale = [requests[0], {**requests[1], "version": requests[1]["version"] + 3}]
    refused = _accept(owner, team, control, stale)
    assert refused.status_code == 409 and refused.json()["detail"] == STALE
    untouched()
    # A request of another phase, one listed twice, and one that is not this control's.
    interim = next(
        item
        for phase in _plan(team, control)["phases"]
        if phase["phase"] == "INTERIM"
        for item in phase["requirements"]
    )
    other = _accept(owner, team, control, [requests[0], interim])
    assert other.status_code == 409
    assert other.json()["detail"] == "Only a D&I request is accepted here."
    twice = _accept(owner, team, control, [requests[0], requests[0]])
    assert twice.status_code == 409 and twice.json()["detail"] == "A request is listed twice."
    unknown = _accept(owner, team, control, [requests[0], {"id": str(uuid4()), "version": 1}])
    assert unknown.status_code == 404
    elsewhere = str(_control(team, "ITGC-AC-01")["id"])
    assert _accept(owner, team, elsewhere, [requests[0]]).status_code == 404
    assert owner.post(
        f"{_path(team, control)}/design-requests/accept", json={"items": []}
    ).status_code == 422  # fmt: skip
    untouched()


def test_a_reviewer_is_refused_and_a_contributors_acceptance_is_theirs(
    migrated: Database,
) -> None:
    """Authorized as accepting the attributes is (who may change the engagement's work): a
    member with the reviewer role reads the list and is refused; an agent is no person."""
    team, control = _prepared(migrated, "dr-roles")
    requests = _requests(team, control)
    reviewer_id, reviewer = _member(migrated, team, "REVIEWER")
    assert _requests(team, control, reviewer) == requests
    assert _accept(reviewer, team, control, requests).status_code == 403
    attribute = str(_approved(migrated, control)[0][0])
    exception = f"{_path(team, control)}/design-coverage/{attribute}/exception"
    assert reviewer.put(exception, json={"reason": WHY}).status_code == 403
    assert reviewer.delete(exception).status_code == 403
    # Outside the engagement, and signed out.
    with connect(migrated.url) as connection:
        outsider = _add_user(connection, team["org"], "dr-outsider@example.com", "CONTRIBUTOR")
    assert _accept(_session(migrated, outsider), team, control, requests).status_code in (403, 404)
    anonymous = TestClient(
        create_app(Settings(database_url=migrated.url, session_cookie_secure=False))
    )
    assert _accept(anonymous, team, control, requests).status_code == 401
    assert not any(item["accepted"] for item in _requests(team, control))
    assert _releases(migrated, control) == []
    # Neither a reviewer nor an agent can have the list settled in their name.
    with connect(migrated.url) as connection:
        org, project = UUID(str(team["org"])), UUID(str(team["project"]))
        for principal in (
            Principal(PrincipalKind.USER, reviewer_id),
            Principal(PrincipalKind.AGENT, team["owner_id"]),
            Principal(PrincipalKind.USER, uuid4()),
        ):
            assert settle_design(connection, principal, org, project, UUID(control)) is False
    # A contributor may: the acceptance, and the release that follows it, are theirs.
    contributor_id, contributor = _member(migrated, team, "CONTRIBUTOR")
    done = _accept(contributor, team, control, requests)
    assert done.status_code == 200, done.text
    assert {item["accepted_by"] for item in _requests(team, control)} == {
        _name(migrated, contributor_id)
    }
    assert _releases(migrated, control) == [(contributor_id, False, True, "")]


def test_a_persons_add_edit_links_and_restore_accept_the_request_as_that_person(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-own")
    owner = team["owner"]
    admin_id, admin = _member(migrated, team, "ADMIN")
    base = _path(team, control)
    # Added by a person: accepted by that act, by them.
    added = owner.post(
        f"{base}/evidence-requirements",
        json={
            "phase": "DESIGN",
            "title": "Leaver process narrative",
            "description": "The current narrative of how a leaver's access is removed.",
            "categories": ["PROCESS_DOCUMENTATION"],
            "objective": "Show how the control is designed to operate.",
            "rationale": "The design is assessed against the documented process.",
        },
    )
    assert added.status_code == 200, added.text
    mine = next(i for i in _requests(team, control) if i["title"] == "Leaver process narrative")
    assert (mine["origin"], mine["accepted"], mine["to_accept"]) == ("PERSON", True, False)
    assert mine["accepted_by"] == _name(migrated, team["owner_id"])
    by = _audit(migrated, "evidence_requirement.accepted", mine["id"])
    assert [(row[0], row[1]["by"]) for row in by] == [(team["owner_id"], "ADD")]
    # An operating item a person adds is not part of the list.
    interim = owner.post(
        f"{base}/evidence-requirements",
        json={
            "phase": "INTERIM",
            "title": "Leaver listing from HR",
            "description": "The HR listing of leavers for the period under review.",
            "categories": ["POPULATION"],
            "objective": "Show the population the samples are selected from.",
            "rationale": "The population is needed before samples are selected.",
        },
    )
    assert interim.status_code == 200, interim.text
    listing = next(
        item
        for phase in interim.json()["phases"]
        if phase["phase"] == "INTERIM"
        for item in phase["requirements"]
        if item["title"] == "Leaver listing from HR"
    )
    assert (listing["accepted"], listing["to_accept"]) == (False, False)
    # Reworded by another person: theirs from then on, and the planner keeps their wording.
    agents = [i for i in _requests(team, control) if i["origin"] != "PERSON"]
    assert len(agents) >= 2
    edited = admin.post(
        f"{base}/evidence-requirements/{agents[0]['id']}/edit",
        json={
            "title": "One leaver traced from HR to the system",
            "description": "One leaver in the period, from the HR record to the removal.",
            "version": agents[0]["version"],
        },
    )
    assert edited.status_code == 200, edited.text
    reworded = next(i for i in _requests(team, control) if i["id"] == agents[0]["id"])
    assert (reworded["accepted"], reworded["person_edited"]) == (True, True)
    assert reworded["accepted_by"] == _name(migrated, admin_id)
    by = _audit(migrated, "evidence_requirement.accepted", agents[0]["id"])
    assert [(row[0], row[1]["by"]) for row in by] == [(admin_id, "EDIT")]
    # The attributes it addresses set by a person: accepted by them, at a new version.
    target = agents[1]
    attribute = str(_approved(migrated, control)[0][0])
    linked = owner.put(
        f"{base}/master-plan/evidence/{target['id']}/links",
        json={"attribute_ids": [attribute], "procedure_ids": []},
    )
    assert linked.status_code == 200, linked.text
    relinked = next(i for i in _requests(team, control) if i["id"] == target["id"])
    assert relinked["attribute_ids"] == [attribute]
    assert (relinked["accepted"], relinked["version"]) == (True, target["version"] + 1)
    by = _audit(migrated, "evidence_requirement.accepted", target["id"])
    assert [(row[0], row[1]["by"]) for row in by] == [(team["owner_id"], "LINKS")]
    # Removed, it leaves the list; restored by a person, it is theirs.
    gone = owner.post(
        f"{base}/evidence-requirements/{mine['id']}/remove", json={"version": mine["version"]}
    )
    assert gone.status_code == 200, gone.text
    assert mine["id"] not in {i["id"] for i in _requests(team, control)}
    removed = next(
        item
        for phase in gone.json()["phases"]
        for item in phase["requirements"]
        if item["id"] == mine["id"]
    )
    assert (removed["status"], removed["accepted"], removed["to_accept"]) == (
        "REMOVED", False, False,
    )  # fmt: skip
    back = admin.post(
        f"{base}/evidence-requirements/{mine['id']}/restore",
        json={"version": removed["version"]},
    )
    assert back.status_code == 200, back.text
    restored = next(i for i in _requests(team, control) if i["id"] == mine["id"])
    assert restored["accepted"] is True and restored["accepted_by"] == _name(migrated, admin_id)


def _replanned(connection: Any, project: UUID, control: UUID) -> dict[str, Any]:
    output: dict[str, Any] = rules_plan(load_facts(connection, project, control)).model_dump(
        mode="json", exclude_none=True
    )
    return output


def test_the_planner_never_overwrites_an_accepted_request(migrated: Database) -> None:
    team, control = _prepared(migrated, "dr-planner")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    requests = _requests(team, control)
    assert len(requests) >= 2
    instance = next(item for item in requests if "CONTROL_EXECUTION" in item["categories"])
    other = next(item for item in requests if item["id"] != instance["id"])
    # The instance is accepted; the other request stays the agent's proposal.
    assert _accept(owner, team, control, [instance]).status_code == 200
    accepted = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    # The planner plans again: it rewords both, and adds a request.
    with connect(migrated.url) as connection:
        output = _replanned(connection, project, UUID(control))
        design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        for requirement in design["requirements"]:
            requirement["title"] = f"{requirement['title']} (replanned)"
        extra = dict(next(r for r in design["requirements"] if r["key"] == other["key"]))
        extra.update(
            key="design-change-7",
            title="Leaver checklist template",
            description="The checklist IT follows when a leaver's access is removed.",
        )
        design["requirements"].append(extra)
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
        connection.commit()
    after = {item["id"]: item for item in _requests(team, control)}
    kept = after[instance["id"]]
    # The accepted request reads exactly as accepted; the planner's change waits on it as
    # its pending change, and it is to accept again.
    assert (kept["title"], kept["description"]) == (accepted["title"], accepted["description"])
    assert kept["accepted"] is True and kept["to_accept"] is True
    assert kept["accepted_by"] == _name(migrated, team["owner_id"])
    assert kept["pending_change"]["title"] == f"{accepted['title']} (replanned)"
    # The proposal it had not accepted is the agent's to change, and still to accept.
    assert after[other["id"]]["title"] == f"{other['title']} (replanned)"
    assert after[other["id"]]["pending_change"] is None
    assert (after[other["id"]]["accepted"], after[other["id"]]["to_accept"]) == (False, True)
    # What the planner adds arrives unaccepted.
    new = next(i for i in after.values() if i["key"] == "design-change-7")
    assert (new["accepted"], new["to_accept"], new["accepted_by"]) == (False, True, None)
    assert _releases(migrated, control) == []
    # Rejecting the change keeps the accepted request, and who accepted it.
    dismissed = owner.post(
        f"{_path(team, control)}/evidence-requirements/{instance['id']}/change",
        json={"decision": "DISMISS", "version": kept["version"]},
    )
    assert dismissed.status_code == 200, dismissed.text
    same = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    assert (same["title"], same["pending_change"]) == (accepted["title"], None)
    assert (same["accepted"], same["to_accept"]) == (True, False)
    assert same["accepted_at"] == accepted["accepted_at"]
    # The planner proposes it again, and now also drops the accepted request from its plan
    # in a later run: a removal is proposed too, never done.
    with connect(migrated.url) as connection:
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
        connection.commit()
    proposed = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    assert proposed["pending_change"]["title"] == f"{accepted['title']} (replanned)"
    # Accepting applies the change: the request reads as the planner proposed, and is theirs.
    admin_id, admin = _member(migrated, team, "ADMIN")
    applied = _accept(admin, team, control, [proposed])
    assert applied.status_code == 200, applied.text
    now = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    assert now["title"] == f"{accepted['title']} (replanned)" and now["pending_change"] is None
    assert (now["accepted"], now["to_accept"]) == (True, False)
    assert now["accepted_by"] == _name(migrated, admin_id)
    recorded = _audit(migrated, "evidence_requirement.accepted", instance["id"])
    assert [(row[0], row[1]["by"], row[1]["change"]) for row in recorded] == [
        (team["owner_id"], "ACCEPT", None),
        (admin_id, "ACCEPT", "CHANGE"),
    ]
    decided = _audit(migrated, "evidence_requirement.change_decided", instance["id"])
    assert [(row[0], row[1]["decision"]) for row in decided] == [
        (team["owner_id"], "DISMISS"),
        (admin_id, "ACCEPT"),
    ]
    with connect(migrated.url) as connection:
        without = _replanned(connection, project, UUID(control))
        design = next(phase for phase in without["phases"] if phase["phase"] == "DESIGN")
        design["requirements"] = [r for r in design["requirements"] if r["key"] != instance["key"]]
        for requirement in design["requirements"]:
            requirement["depends_on"] = None
        generate(connection, _Planner(without), org, project, UUID(control), team["owner_id"])
        connection.commit()
    held = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    assert held["status"] in LIVE and held["pending_change"] == {"remove": True}
    assert (held["accepted"], held["to_accept"]) == (True, True)
    assert held["title"] == f"{accepted['title']} (replanned)"


def test_the_background_planner_and_the_attribute_repair_respect_an_accepted_request(
    migrated: Database,
) -> None:
    """The repair that puts every approved attribute on the walkthrough instance
    (evidence_planning._instance_against_every_attribute) extends an accepted instance only
    through its pending change: the links follow the person's acceptance."""
    team, control = _prepared(migrated, "dr-repair")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    requests = _requests(team, control)
    instance = next(item for item in requests if "CONTROL_EXECUTION" in item["categories"])
    before = set(instance["attribute_ids"])
    assert _accept(owner, team, control, [instance]).status_code == 200
    # A person adds an attribute; the evidence is planned again by the background run.
    with connect(migrated.url) as connection:
        add_attribute(
            connection, org, project, UUID(control), team["owner_id"], AttributeAdd(text=NEW)
        )
        connection.commit()
    tailor_criteria(migrated, team["project"])
    new_id = next(str(row[0]) for row in _approved(migrated, control) if row[1] == NEW)
    with connect(migrated.url) as connection:
        plan_id = connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0 "
            "WHERE engagement_control_id = %s RETURNING id",
            (control,),
        ).fetchone()
        connection.commit()
        assert plan_id is not None
        with connect(migrated.url) as worker:
            output = _replanned(worker, project, UUID(control))
            assert run_plan(worker, _Planner(output), plan_id[0]) == "DONE"
    held = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    # The instance is not relinked under the person: the new attribute is in its pending
    # change, and stays uncovered until they accept it.
    assert set(held["attribute_ids"]) == before and new_id not in held["attribute_ids"]
    assert NEW in held["pending_change"]["attributes"]
    assert (held["accepted"], held["to_accept"]) == (True, True)
    assert _summary(team, control)["uncovered"] == [new_id]
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "EVIDENCE")
    # Nothing was released by the run.
    assert _releases(migrated, control) == []
    applied = _accept(owner, team, control, [held])
    assert applied.status_code == 200, applied.text
    now = next(i for i in _requests(team, control) if i["id"] == instance["id"])
    assert set(now["attribute_ids"]) == before | {new_id}
    assert applied.json()["design_requests"]["uncovered"] == []


def test_an_addition_the_planner_proposes_stays_proposed_until_a_person_accepts_it(
    migrated: Database,
) -> None:
    """On a released phase the planner's addition is proposed to a person (B1). Planned
    again unchanged, or revised, it is still only proposed: no run makes it part of the
    plan, or of the released phase's requests (found while building the list, 12 November
    2026: a second identical run cleared the proposal)."""
    team, control = _prepared(migrated, "dr-addition")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    released = accept_design_requests(owner, team["org"], team["project"], control)
    assert released["design_requests"]["released"] is True  # type: ignore[index]
    with connect(migrated.url) as connection:
        output = _replanned(connection, project, UUID(control))
        design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        extra = dict(next(r for r in design["requirements"] if r["attributes"]))
        extra.update(
            key="design-change-8",
            title="Access approval matrix",
            description="The current matrix of who may approve access to the system.",
            depends_on=None,
        )
        design["requirements"].append(extra)
        for _run in range(2):
            generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
            connection.commit()
        extra["description"] = "The matrix of who may approve access, as at period end."
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
        connection.commit()
    row = _rows(
        migrated,
        "SELECT id, version, status, pending_change, pbc_request_id, accepted_at, description "
        "FROM evidence_requirements WHERE engagement_control_id = %s "
        "AND requirement_key = 'design-change-8'",
        UUID(control),
    )
    assert len(row) == 1
    requirement_id, version, status, change, request, accepted_at, description = row[0]
    assert (status, change, request, accepted_at) == ("PLANNED", {"add": True}, None, None)
    assert description == "The matrix of who may approve access, as at period end."
    proposed = next(i for i in _requests(team, control) if i["id"] == str(requirement_id))
    assert (proposed["accepted"], proposed["to_accept"]) == (False, True)
    # It shows the approved attributes it names, though its links wait for the acceptance.
    assert proposed["attribute_ids"]
    assert _rows(
        migrated,
        "SELECT count(*) FROM evidence_requirement_attributes WHERE requirement_id = %s",
        requirement_id,
    ) == [(0,)]
    # Accepted by a person: part of the plan, theirs, linked, and requested.
    done = _accept(owner, team, control, [{"id": str(requirement_id), "version": version}])
    assert done.status_code == 200, done.text
    final = next(i for i in _requests(team, control) if i["id"] == str(requirement_id))
    assert (final["accepted"], final["pending_change"], final["status"]) == (
        True, None, "REQUESTED",
    )  # fmt: skip
    assert final["attribute_ids"] == proposed["attribute_ids"]
    recorded = _audit(migrated, "evidence_requirement.accepted", requirement_id)
    assert [(row[1]["by"], row[1]["change"]) for row in recorded] == [("ACCEPT", "ADD")]


def test_an_attribute_no_request_addresses_holds_the_list_until_linked_or_excepted(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-coverage")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    base = _path(team, control)
    # A person adds an attribute after the evidence was planned: no request addresses it.
    with connect(migrated.url) as connection:
        add_attribute(
            connection, org, project, UUID(control), team["owner_id"], AttributeAdd(text=NEW)
        )
        connection.commit()
    tailor_criteria(migrated, team["project"])
    new_id = next(str(row[0]) for row in _approved(migrated, control) if row[1] == NEW)
    held = (
        "The D&I requests do not cover the attributes: 1 approved attribute is not addressed "
        "by any D&I request. Add each to a request, or record why it is not evidenced at D&I."
    )
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "EVIDENCE")
    assert design["waiting_for"] == held
    assert design["step_label"] == "Evidence not planned against the attributes"
    summary = _summary(team, control)
    assert summary["uncovered"] == [new_id] and summary["waiting_for"] == held
    assert summary["settled"] is False
    # Every request accepted: the list is still not settled, and nothing is released.
    body = accept_design_requests(owner, team["org"], team["project"], control)
    assert body["design_requests"] == {
        "settled": False, "released": False, "to_accept": 0, "uncovered": [new_id],
        "exceptions": [], "waiting_for": held, "working": False, "drafting": False,
    }  # fmt: skip
    assert _releases(migrated, control) == []
    # The release route refuses it, reason or not: there is no early D&I release.
    route = f"{base}/phases/DESIGN/release"
    for sent in ({}, {"reason": "Released now: the walkthrough is booked for this week."}):
        refused = owner.post(route, json=sent)
        assert refused.status_code == 409 and refused.json()["detail"] == held
    # An exception needs a reason of at least 20 characters, with no credential in it, for
    # an approved attribute of this control.
    exception = f"{base}/design-coverage/{new_id}/exception"
    # Each refusal is a sentence the page shows as it is.
    for reason, sentence in (
        ("Not at D&I.", "Say why in at least 20 characters."),
        ("  too   short   " + " " * 20, "Say why in at least 20 characters."),
        ("x" * 501, "Keep the reason to 500 characters or fewer."),
        (
            "The service account password: hunter2hunter2 is why.",
            "The reason must not contain a password or a key.",
        ),
    ):
        short = owner.put(exception, json={"reason": reason})
        assert (short.status_code, short.json()["detail"]) == (422, sentence)
    assert owner.put(
        f"{base}/design-coverage/{uuid4()}/exception", json={"reason": WHY}
    ).status_code == 404  # fmt: skip
    covered = str(_approved(migrated, control)[0][0])
    already = owner.put(f"{base}/design-coverage/{covered}/exception", json={"reason": WHY})
    assert already.status_code == 409
    assert already.json()["detail"] == "A D&I request already addresses this attribute."
    assert _releases(migrated, control) == []
    assert _audit(migrated, "design_coverage.exception_recorded", new_id) == []
    # Unsettled attributes hold it first, so the exception is recorded without a release.
    _unsettle_attributes(migrated, control)
    recorded = owner.put(exception, json={"reason": f"  {WHY}  "})
    assert recorded.status_code == 200, recorded.text
    summary = recorded.json()["design_requests"]
    assert summary["uncovered"] == [] and summary["released"] is False
    assert [
        (item["attribute_id"], item["reason"], item["recorded_by"])
        for item in summary["exceptions"]
    ] == [(new_id, WHY, _name(migrated, team["owner_id"]))]
    assert summary["exceptions"][0]["recorded_at"]
    assert summary["waiting_for"].startswith("The attributes are not settled")
    audit = _audit(migrated, "design_coverage.exception_recorded", new_id)
    assert [(row[0], row[1]["reason"], row[1]["replaced"]) for row in audit] == [
        (team["owner_id"], WHY, False)
    ]
    # Clearing it holds the list again.
    cleared = owner.delete(exception)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["design_requests"]["uncovered"] == [new_id]
    assert cleared.json()["design_requests"]["exceptions"] == []
    gone = _audit(migrated, "design_coverage.exception_cleared", new_id)
    assert [(row[0], row[1]["reason"]) for row in gone] == [(team["owner_id"], WHY)]
    assert owner.delete(exception).status_code == 200
    assert len(_audit(migrated, "design_coverage.exception_cleared", new_id)) == 1
    _reject_proposals(migrated, control)
    assert _design(team, control)["waiting_on"] == "EVIDENCE"
    # Linking the attribute to a request clears it, and that request completes the list:
    # the D&I evidence is released in the links request, by that person.
    target = next(
        item for item in _requests(team, control) if "CONTROL_EXECUTION" in item["categories"]
    )
    linked = owner.put(
        f"{base}/master-plan/evidence/{target['id']}/links",
        json={"attribute_ids": [*target["attribute_ids"], new_id], "procedure_ids": []},
    )
    assert linked.status_code == 200, linked.text
    assert _summary(team, control) == {
        "settled": True, "released": True, "to_accept": 0, "uncovered": [],
        "exceptions": [], "waiting_for": "", "working": False, "drafting": True,
    }  # fmt: skip
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    payload = _audit(migrated, "phase.released", control)[0][1]
    assert payload["exceptions"] == []
    assert new_id in next(
        item["attribute_ids"] for item in payload["requirements"] if item["id"] == target["id"]
    )


def test_recording_the_last_exception_releases_and_the_release_names_it(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-exception")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    with connect(migrated.url) as connection:
        add_attribute(
            connection, org, project, UUID(control), team["owner_id"], AttributeAdd(text=NEW)
        )
        connection.commit()
    tailor_criteria(migrated, team["project"])
    new_id = next(str(row[0]) for row in _approved(migrated, control) if row[1] == NEW)
    accept_design_requests(owner, team["org"], team["project"], control)
    assert _releases(migrated, control) == []
    recorded = owner.put(
        f"{_path(team, control)}/design-coverage/{new_id}/exception", json={"reason": WHY}
    )
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["design_requests"]["released"] is True
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    payload = _audit(migrated, "phase.released", control)[0][1]
    assert payload["automatic"] is True
    assert payload["exceptions"] == [
        {"attribute_id": new_id, "reason": WHY, "recorded_by": str(team["owner_id"])}
    ]
    assert NEW in payload["attributes"]
    assert not any(new_id in item["attribute_ids"] for item in payload["requirements"])


def test_the_list_is_not_settled_under_a_run_unsettled_attributes_or_a_pending_change(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-not-settled")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    requests = _requests(team, control)

    def run(status: str) -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE evidence_plans SET run_status = %s WHERE engagement_control_id = %s",
                (status, control),
            )
            connection.commit()

    # While the planner works the list may still change: nothing is accepted under it.
    for status in ("PENDING", "WORKING"):
        run(status)
        design = _design(team, control)
        assert (design["step"], design["waiting_on"]) == ("WAITING", "REQUESTS")
        assert design["step_label"] == "Requests being updated"
        assert design["waiting_for"] == "The planner is still updating the D&I requests."
        refused = _accept(owner, team, control, requests)
        assert refused.status_code == 409
        assert refused.json()["detail"] == "The planner is still updating the D&I requests."
    run("IDLE")
    assert not any(item["accepted"] for item in _requests(team, control))
    # Unsettled attributes: every request accepted, and still nothing is released.
    _unsettle_attributes(migrated, control)
    body = accept_design_requests(owner, team["org"], team["project"], control)
    summary: Any = body["design_requests"]
    assert (summary["settled"], summary["released"], summary["to_accept"]) == (False, False, 0)
    assert summary["waiting_for"].startswith("The attributes are not settled")
    assert _design(team, control)["waiting_on"] == "ATTRIBUTES"
    assert _releases(migrated, control) == []
    # A change the planner proposes on an accepted request: to accept again, not settled.
    _reject_proposals(migrated, control)
    assert _design(team, control)["step"] == "READY"
    with connect(migrated.url) as connection:
        output = _replanned(connection, project, UUID(control))
        design_phase = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        design_phase["requirements"][0]["title"] += " (replanned)"
        generate(connection, _Planner(output), org, project, UUID(control), team["owner_id"])
        connection.commit()
    pending = [item for item in _requests(team, control) if item["pending_change"]]
    assert len(pending) == 1 and pending[0]["to_accept"] is True
    design = _design(team, control)
    assert (design["step"], design["waiting_on"]) == ("WAITING", "REQUESTS")
    assert design["waiting_for"] == "1 D&I request waits to be accepted."
    # A person's request that does not complete the list releases nothing.
    others = [item for item in _requests(team, control) if not item["pending_change"]]
    assert _accept(owner, team, control, others).status_code == 200
    assert _releases(migrated, control) == []
    # Under a run, accepting the change is refused; once the run is over it completes the
    # list, and the D&I evidence is released by that acceptance.
    run("WORKING")
    assert _accept(owner, team, control, pending).status_code == 409
    assert _releases(migrated, control) == []
    run("IDLE")
    done = _accept(owner, team, control, pending)
    assert done.status_code == 200, done.text
    assert done.json()["design_requests"]["released"] is True
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]


def _completed_before_the_run_ended(
    migrated: Database, slug: str
) -> tuple[dict[str, Any], str, UUID, UUID, str]:
    """A list two people completed while something else still held it (here the attributes,
    then let go by a direct write no request made), with the planner's run queued: settled
    but for the run, and not released. Returns the team, the control, the plan, the person
    whose acceptance was last, and the request they accepted."""
    team, control = _prepared(migrated, slug)
    _unsettle_attributes(migrated, control)
    requests = _requests(team, control)
    assert len(requests) >= 2
    assert _accept(team["owner"], team, control, requests[:-1]).status_code == 200
    admin_id, admin = _member(migrated, team, "ADMIN")
    assert _accept(admin, team, control, requests[-1:]).status_code == 200
    _reject_proposals(migrated, control)
    assert _design(team, control)["step"] == "READY", _design(team, control)
    assert _summary(team, control)["settled"] is True
    assert _releases(migrated, control) == []
    with connect(migrated.url) as connection:
        plan = connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0 "
            "WHERE engagement_control_id = %s RETURNING id",
            (control,),
        ).fetchone()
        connection.commit()
    assert plan is not None
    waiting = _summary(team, control)
    assert (waiting["settled"], waiting["working"], waiting["released"]) == (False, True, False)
    return team, control, plan[0], admin_id, requests[-1]["id"]


def test_a_run_that_ends_and_changed_nothing_completes_the_release_as_the_last_acceptor(
    migrated: Database,
) -> None:
    """The one release a worker completes (B1e, the product owner wants no release button
    at all): every request and coverage decision on the list was already a person's, and
    only the planner's run was still in the way. It is recorded as the last acceptor's,
    automatic, and marked deferred with the run that ended."""
    team, control, plan_id, admin_id, last = _completed_before_the_run_ended(
        migrated, "dr-deferred"
    )
    sent = _rows(
        migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
    )
    with connect(migrated.url) as worker:
        assert run_plan(worker, None, plan_id) == "DONE"
    assert _releases(migrated, control) == [(admin_id, False, True, "")]
    audit = _audit(migrated, "phase.released", control)
    assert len(audit) == 1 and audit[0][0] == admin_id
    payload = audit[0][1]
    assert (payload["automatic"], payload["deferred"], payload["early"]) == (True, True, False)
    assert payload["run"]["plan_id"] == str(plan_id)
    assert payload["run"]["last_acceptance"]["requirement"] == last
    accepted_at = _rows(
        migrated, "SELECT accepted_at FROM evidence_requirements WHERE id = %s", UUID(last)
    )[0][0]
    assert payload["run"]["last_acceptance"]["at"] == accepted_at.isoformat()
    assert payload["attributes"] == [row[1] for row in _approved(migrated, control)]
    assert {item["id"] for item in payload["requirements"]} == {
        item["id"] for item in _requests(team, control)
    }
    # The Design items are requested: drafts that wait for the worker and for a person's
    # approval. Nothing is sent.
    summary = _summary(team, control)
    assert (summary["settled"], summary["released"], summary["working"], summary["drafting"]) == (
        True, True, False, True,
    )  # fmt: skip
    drafted = _rows(
        migrated,
        "SELECT r.status, d.status FROM pbc_requests r JOIN pbc_drafts d "
        "ON d.pbc_request_id = r.id WHERE r.engagement_control_id = %s "
        "AND r.testing_phase = 'DESIGN'",
        UUID(control),
    )
    assert drafted and all(row == ("DRAFT", "PENDING") for row in drafted)
    assert (
        _rows(
            migrated, "SELECT count(*) FROM mailbox_messages WHERE project_id = %s", team["project"]
        )
        == sent
    )
    # A later run releases nothing twice.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0 WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
    with connect(migrated.url) as worker:
        assert run_plan(worker, None, plan_id) == "DONE"
    assert len(_releases(migrated, control)) == 1
    assert len(_audit(migrated, "phase.released", control)) == 1
    # Once the coordinator has written them, nothing is being drafted any more.
    settings = Settings(database_url=migrated.url, session_cookie_secure=False)
    for (draft_id,) in _rows(
        migrated,
        "SELECT id FROM pbc_drafts WHERE engagement_control_id = %s AND status = 'PENDING'",
        UUID(control),
    ):
        with connect(migrated.url) as connection:
            run_draft(connection, None, draft_id, settings)
    assert _summary(team, control)["drafting"] is False


def test_a_run_that_changed_or_added_anything_releases_nothing(migrated: Database) -> None:
    team, control, plan_id, _admin_id, _last = _completed_before_the_run_ended(
        migrated, "dr-deferred-changed"
    )
    owner = team["owner"]
    project = UUID(str(team["project"]))
    # The run rewords an accepted request and adds one.
    with connect(migrated.url) as worker:
        output = _replanned(worker, project, UUID(control))
        design = next(phase for phase in output["phases"] if phase["phase"] == "DESIGN")
        design["requirements"][0]["title"] += " (replanned)"
        extra = dict(next(r for r in design["requirements"] if r["attributes"]))
        extra.update(
            key="design-change-6",
            title="Leaver checklist template",
            description="The checklist IT follows when a leaver's access is removed.",
            depends_on=None,
        )
        design["requirements"].append(extra)
        assert run_plan(worker, _Planner(output), plan_id) == "DONE"
    assert _releases(migrated, control) == []
    assert _audit(migrated, "phase.released", control) == []
    waiting = [item for item in _requests(team, control) if item["to_accept"]]
    assert len(waiting) == 2
    assert {bool(item["pending_change"]) for item in waiting} == {True, False}
    design_status = _design(team, control)
    assert (design_status["step"], design_status["waiting_on"]) == ("WAITING", "REQUESTS")
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s",
        UUID(control),
    ) == [(0,)]
    # The person accepts what the run left: their request releases it, and it is not deferred.
    done = _accept(owner, team, control, waiting)
    assert done.status_code == 200, done.text
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    payload = _audit(migrated, "phase.released", control)[0][1]
    assert (payload["automatic"], payload["deferred"]) == (True, False) and "run" not in payload


def test_no_other_background_path_releases_and_the_release_route_is_a_persons(
    migrated: Database,
) -> None:
    """Outside the finished run of a list a person completed, nothing in the background
    releases: not a failed run, not a run whose last acceptor may no longer change the
    engagement's work, not the planner answering in a person's request, not a read."""
    team, control, plan_id, admin_id, _last = _completed_before_the_run_ended(
        migrated, "dr-background"
    )
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    # The run fails: nothing is released for a planner that did not finish.
    with connect(migrated.url) as worker:
        fail_plan_run(worker, plan_id)
        worker.commit()
        assert settle_design_after_run(worker, org, project, UUID(control), plan_id) is False
    assert _releases(migrated, control) == []
    # The last acceptor is now a reviewer: the run that ends releases nothing in their name.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE memberships SET role = 'REVIEWER' WHERE user_id = %s AND organization_id = %s",
            (admin_id, team["org"]),
        )
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'PENDING', run_attempts = 0 WHERE id = %s",
            (plan_id,),
        )
        connection.commit()
    with connect(migrated.url) as worker:
        assert run_plan(worker, None, plan_id) == "DONE"
    assert _design(team, control)["step"] == "READY"
    assert _releases(migrated, control) == []
    # A person asking the planner to plan again, answered in their request, is the agent's
    # work: it releases nothing. Nor does a read.
    planned = owner.post(f"{_path(team, control)}/evidence-plan/generate")
    assert planned.status_code == 200, planned.text
    assert _plan(team, control)["design_requests"]["released"] is False
    assert _design(team, control)["step"] == "READY"
    assert _releases(migrated, control) == []
    assert _audit(migrated, "phase.released", control) == []
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s "
        "AND testing_phase = 'DESIGN'",
        UUID(control),
    ) == [(0,)]
    # An agent has no request to settle a list in.
    with connect(migrated.url) as connection:
        assert (
            settle_design(
                connection, Principal(PrincipalKind.AGENT, team["owner_id"]), org, project,
                UUID(control),
            )
            is False
        )  # fmt: skip
    assert _releases(migrated, control) == []
    # The release route, kept for a settled list nothing released: a contributor is refused,
    # as before; the owner's release is theirs and is not marked automatic.
    route = f"{_path(team, control)}/phases/DESIGN/release"
    _, contributor = _member(migrated, team, "CONTRIBUTOR")
    assert contributor.post(route, json={}).status_code == 403
    released = owner.post(route, json={})
    assert released.status_code == 200, released.text
    status = next(item for item in released.json()["phases"] if item["phase"] == "DESIGN")
    assert (status["step"], status["early"], status["automatic"]) == ("RELEASED", False, False)
    assert _releases(migrated, control) == [(team["owner_id"], False, False, "")]
    payload = _audit(migrated, "phase.released", control)[0][1]
    assert (payload["automatic"], payload["deferred"]) == (False, False)
    assert payload["requirements"]
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_requests WHERE engagement_control_id = %s "
        "AND testing_phase = 'DESIGN' AND status = 'DRAFT'",
        UUID(control),
    ) != [(0,)]


def test_a_request_added_for_an_uncovered_attribute_in_one_step_completes_the_list(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-add-linked")
    owner = team["owner"]
    org, project = UUID(str(team["org"])), UUID(str(team["project"]))
    base = _path(team, control)
    with connect(migrated.url) as connection:
        add_attribute(
            connection, org, project, UUID(control), team["owner_id"], AttributeAdd(text=NEW)
        )
        connection.commit()
    tailor_criteria(migrated, team["project"])
    new_id = next(str(row[0]) for row in _approved(migrated, control) if row[1] == NEW)
    accept_design_requests(owner, team["org"], team["project"], control)
    assert _summary(team, control)["uncovered"] == [new_id]
    request = {
        "phase": "DESIGN",
        "title": "Leaver ticket showing the removal date",
        "description": "One leaver's ticket, showing the date the access was removed.",
        "categories": ["CONTROL_EXECUTION"],
        "objective": "Show the removal is recorded with its date.",
        "rationale": "The attribute is tested against the ticket's record.",
    }
    # Only the control's approved attributes are linked: anything else is refused in a
    # sentence, and nothing is added.
    foreign = str(_approved(migrated, str(_control(team, "ITGC-AC-01")["id"]))[0][0])
    count = len(_requests(team, control))
    for wrong in ([foreign], [str(uuid4())], [new_id, foreign]):
        refused = owner.post(
            f"{base}/evidence-requirements", json={**request, "attribute_ids": wrong}
        )
        assert refused.status_code == 422
        assert refused.json()["detail"] == "Link only the control's approved attributes."
    assert len(_requests(team, control)) == count and _releases(migrated, control) == []
    added = owner.post(f"{base}/evidence-requirements", json={**request, "attribute_ids": [new_id]})
    assert added.status_code == 200, added.text
    mine = next(i for i in _requests(team, control) if i["title"] == request["title"])
    assert (mine["attribute_ids"], mine["accepted"], mine["origin"]) == ([new_id], True, "PERSON")
    assert _rows(
        migrated,
        "SELECT origin, created_by FROM evidence_requirement_attributes WHERE requirement_id = %s",
        UUID(mine["id"]),
    ) == [("PERSON", team["owner_id"])]
    # It covered the last attribute, accepted by the same act: the list is settled and the
    # D&I evidence released, in that one request.
    summary = added.json()["design_requests"]
    assert (summary["settled"], summary["released"], summary["uncovered"]) == (True, True, [])
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]


def test_each_request_gives_its_procedures_so_a_links_change_keeps_them(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-procedures")
    owner = team["owner"]
    plan = _plan(team, control)
    everything = [item for phase in plan["phases"] for item in phase["requirements"]]
    # Each requirement gives the plan's active procedures it is linked to.
    for item in everything:
        linked = _rows(
            migrated,
            "SELECT rp.procedure_id FROM evidence_requirement_procedures rp "
            "JOIN plan_procedures pp ON pp.id = rp.procedure_id "
            "WHERE rp.requirement_id = %s AND pp.status = 'ACTIVE'",
            UUID(item["id"]),
        )
        assert set(item["procedure_ids"]) == {str(row[0]) for row in linked}
    target = next(item for item in _requests(team, control) if len(item["attribute_ids"]) >= 2)
    procedure = str(
        _rows(
            migrated,
            "SELECT pp.id FROM plan_procedures pp JOIN evidence_plans p ON p.id = pp.plan_id "
            "WHERE p.engagement_control_id = %s AND pp.status = 'ACTIVE' AND pp.phase = 'DESIGN' "
            "ORDER BY pp.position LIMIT 1",
            UUID(control),
        )[0][0]
    )
    links = f"{_path(team, control)}/master-plan/evidence/{target['id']}/links"
    served = owner.put(
        links, json={"attribute_ids": target["attribute_ids"], "procedure_ids": [procedure]}
    )
    assert served.status_code == 200, served.text
    shown = next(i for i in _requests(team, control) if i["id"] == target["id"])
    assert shown["procedure_ids"] == [procedure]
    # "Change attributes": the attributes change, the procedures are sent back as they were.
    changed = owner.put(
        links,
        json={
            "attribute_ids": shown["attribute_ids"][:1],
            "procedure_ids": shown["procedure_ids"],
        },
    )
    assert changed.status_code == 200, changed.text
    after = next(i for i in _requests(team, control) if i["id"] == target["id"])
    assert after["attribute_ids"] == target["attribute_ids"][:1]
    assert after["procedure_ids"] == [procedure]


def test_working_says_when_an_agent_run_holds_the_list(migrated: Database) -> None:
    team, control = _prepared(migrated, "dr-working")
    assert _summary(team, control)["working"] is False
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO process_narrative_runs (
                engagement_control_id, organization_id, project_id, run_status, stage
            )
            SELECT id, organization_id, project_id, 'WORKING', 'ATTRIBUTES'
            FROM engagement_controls WHERE id = %s
            ON CONFLICT (engagement_control_id)
            DO UPDATE SET run_status = 'WORKING', stage = 'ATTRIBUTES'
            """,
            (control,),
        )
        connection.commit()
    held = _summary(team, control)
    assert held["working"] is True and held["settled"] is False
    assert held["waiting_for"].endswith("the agent is still updating them.")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE process_narrative_runs SET run_status = 'IDLE', stage = '' "
            "WHERE engagement_control_id = %s",
            (control,),
        )
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'WORKING' WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    assert _summary(team, control)["working"] is True
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_plans SET run_status = 'IDLE' WHERE engagement_control_id = %s",
            (control,),
        )
        connection.commit()
    assert _summary(team, control)["working"] is False


def test_an_early_d_and_i_release_is_refused_with_what_it_waits_for(
    migrated: Database,
) -> None:
    """Rewritten rule (B1e, product owner, 12 November 2026: "Why do I need to have the
    release button? Simplify the workflow."). Old: a person released D&I early with a
    reason of 20 characters, at any time after the plan. New: the release route releases
    D&I only when the requests list is settled, and says what it waits for otherwise."""
    team = _launched(migrated, "dr-early")
    owner = team["owner"]
    control = str(_control(team, AC02)["id"])
    route = f"{_path(team, control)}/phases/DESIGN/release"
    reason = {"reason": "The walkthrough is booked for this week, before the answers are in."}
    # Before the understanding.
    first = owner.post(route, json=reason)
    assert first.status_code == 409
    assert first.json()["detail"].startswith("Control Understanding is not complete")
    # Understood and the attributes settled: it waits for the requests to be accepted.
    understand_and_settle_attributes(migrated, team["project"], control)
    for sent in ({}, reason):
        refused = owner.post(route, json=sent)
        assert refused.status_code == 409
        assert refused.json()["detail"].endswith("to be accepted.")
    batch = owner.post(
        f"{_project(team)}/phases/release",
        json={"phase": "DESIGN", "control_ids": [control], **reason},
    )
    assert batch.status_code == 200, batch.text
    outcome = batch.json()["outcomes"][0]
    assert outcome["released"] is False and outcome["detail"].endswith("to be accepted.")
    assert _releases(migrated, control) == []
    assert _audit(migrated, "phase.released", control) == []


class _Worker:
    """A background worker that notes the drafts it is handed, and whether the release
    that queued them was committed by then (read on a connection of its own)."""

    def __init__(self, database: Database, control: str, fail: bool = False) -> None:
        self.database, self.control, self.fail = database, control, fail
        self.drafts: list[UUID] = []
        self.committed: list[bool] = []

    def schedule_test_runs(self, sheet_ids: list[UUID]) -> None:
        del sheet_ids

    def schedule_plan_runs(self, plan_ids: list[UUID]) -> None:
        del plan_ids

    def schedule_drafts(self, draft_ids: list[UUID]) -> None:
        with connect(self.database.url) as connection:
            seen = connection.execute(
                "SELECT 1 FROM phase_releases WHERE engagement_control_id = %s "
                "AND phase = 'DESIGN'",
                (self.control,),
            ).fetchone()
        self.committed.append(seen is not None)
        if self.fail:
            raise RuntimeError("the worker is unavailable")
        self.drafts.extend(draft_ids)


def _session_with(database: Database, user_id: UUID, worker: _Worker) -> TestClient:
    settings = Settings(database_url=database.url, session_cookie_secure=False)
    token = uuid4().hex
    with connect(database.url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '1 hour')",
            (user_id, token_hash(token)),
        )
    return TestClient(create_app(settings, draft_scheduler=worker), cookies={"aw_session": token})


def test_the_drafts_are_handed_to_the_worker_only_once_the_release_has_committed(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-after-commit")
    worker = _Worker(migrated, control)
    client = _session_with(migrated, team["owner_id"], worker)
    body = accept_design_requests(client, team["org"], team["project"], control)
    assert body["design_requests"]["released"] is True  # type: ignore[index]
    queued = _rows(
        migrated,
        "SELECT id FROM pbc_drafts WHERE engagement_control_id = %s AND status = 'PENDING'",
        UUID(control),
    )
    assert queued and sorted(worker.drafts) == sorted(row[0] for row in queued)
    # Handed over after the commit: the worker's own connection already saw the release.
    assert worker.committed == [True]


def test_a_worker_that_cannot_be_reached_never_fails_the_acceptance(migrated: Database) -> None:
    team, control = _prepared(migrated, "dr-unreachable")
    worker = _Worker(migrated, control, fail=True)
    client = _session_with(migrated, team["owner_id"], worker)
    body = accept_design_requests(client, team["org"], team["project"], control)
    # Recorded and answered 200 (the helper asserts it); the drafts stay queued.
    assert body["design_requests"]["released"] is True  # type: ignore[index]
    assert worker.committed == [True] and worker.drafts == []
    assert _releases(migrated, control) == [(team["owner_id"], False, True, "")]
    assert _rows(
        migrated,
        "SELECT count(*) FROM pbc_drafts WHERE engagement_control_id = %s AND status = 'PENDING'",
        UUID(control),
    ) != [(0,)]


def test_completing_the_understanding_or_the_attributes_last_releases_too(
    migrated: Database,
) -> None:
    """The list can be accepted before the attributes are settled (through the API). The
    person's decision that settles them is then the request that completes the list."""
    team, control = _prepared(migrated, "dr-attributes-last")
    owner = team["owner"]
    _unsettle_attributes(migrated, control)
    accept_design_requests(owner, team["org"], team["project"], control)
    assert _releases(migrated, control) == []
    proposal = _rows(
        migrated,
        "SELECT id, version FROM control_attributes WHERE engagement_control_id = %s "
        "AND status = 'PROPOSED'",
        UUID(control),
    )[0]
    admin_id, admin = _member(migrated, team, "ADMIN")
    decided = admin.post(
        f"{_path(team, control)}/attributes/{proposal[0]}/decide",
        json={"decision": "REJECT", "version": proposal[1]},
    )
    assert decided.status_code == 200, decided.text
    assert _releases(migrated, control) == [(admin_id, False, True, "")]
    assert _audit(migrated, "phase.released", control)[0][0] == admin_id


def test_the_backfill_accepts_what_a_person_released_and_nothing_else(
    migrated: Database,
) -> None:
    """Migration 0149's backfill, run on rows as they stood before it (no acceptance): the
    D&I requests of a control a person released are accepted by the releaser at the
    release; a release with no releaser on record, a control not released, a proposed
    addition, a removed request and the operating items are left."""
    team = _launched(migrated, "dr-backfill")
    owner = team["owner"]
    released = str(_control(team, AC02)["id"])
    unnamed = str(_control(team, "ITGC-AC-01")["id"])
    untouched = str(_control(team, "ITGC-AC-03")["id"])
    understand_and_settle_attributes(migrated, team["project"], released)
    accept_design_requests(owner, team["org"], team["project"], released)
    assert _releases(migrated, released) == [(team["owner_id"], False, True, "")]
    with connect(migrated.url) as connection:
        # As 0145 recorded a release for requests already under way: nobody named.
        connection.execute(
            """
            INSERT INTO phase_releases (
                organization_id, project_id, engagement_control_id, phase, reason
            )
            SELECT organization_id, project_id, id, 'DESIGN', 'Under way before the release.'
            FROM engagement_controls WHERE id = %s
            """,
            (unnamed,),
        )
        # Before the migration no request carried an acceptance.
        connection.execute(
            "UPDATE evidence_requirements SET accepted_by = NULL, accepted_at = NULL "
            "WHERE project_id = %s",
            (team["project"],),
        )
        rows = connection.execute(
            "SELECT id FROM evidence_requirements WHERE engagement_control_id = %s "
            "AND phase = 'DESIGN' ORDER BY created_at, requirement_key",
            (released,),
        ).fetchall()
        assert len(rows) >= 2
        proposed = rows[-1][0]
        connection.execute(
            "UPDATE evidence_requirements SET pending_change = '{\"add\": true}'::jsonb, "
            "status = 'PLANNED', pbc_request_id = NULL WHERE id = %s",
            (proposed,),
        )
        connection.commit()
        script = (migrations_dir() / "0149_design_request_acceptance.sql").read_text("utf-8")
        marker = "-- Backfill: what a person released is accepted by that person, at the release."
        assert script.count(marker) == 1
        backfill = script.split(marker)[1]
        assert backfill.strip().startswith("UPDATE evidence_requirements")
        connection.execute(backfill.encode())
        connection.commit()
    release = _rows(
        migrated,
        "SELECT released_by, released_at FROM phase_releases WHERE engagement_control_id = %s",
        UUID(released),
    )[0]
    accepted = _rows(
        migrated,
        "SELECT id, phase, accepted_by, accepted_at, engagement_control_id "
        "FROM evidence_requirements WHERE project_id = %s AND accepted_at IS NOT NULL",
        team["project"],
    )
    assert accepted
    for requirement_id, phase, by, at, control_id in accepted:
        assert (str(control_id), phase) == (released, "DESIGN")
        assert (by, at) == (release[0], release[1]) and requirement_id != proposed
    live = _rows(
        migrated,
        "SELECT count(*) FROM evidence_requirements WHERE engagement_control_id = %s "
        "AND phase = 'DESIGN' AND status <> 'REMOVED' "
        "AND NOT coalesce((pending_change ->> 'add')::boolean, false)",
        UUID(released),
    )
    assert live == [(len(accepted),)]
    for other in (unnamed, untouched):
        assert _rows(
            migrated,
            "SELECT count(*) FROM evidence_requirements WHERE engagement_control_id = %s "
            "AND accepted_at IS NOT NULL",
            UUID(other),
        ) == [(0,)]
    # Running it again changes nothing.
    with connect(migrated.url) as connection:
        assert connection.execute(backfill.encode()).rowcount == 0


def test_the_migration_keeps_acceptance_whole_and_an_automatic_release_named(
    migrated: Database,
) -> None:
    team, control = _prepared(migrated, "dr-schema")
    requirement = _requests(team, control)[0]["id"]
    with connect(migrated.url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE evidence_requirements SET accepted_at = clock_timestamp() WHERE id = %s",
                (requirement,),
            )
        connection.rollback()
        # An automatic release names its person, is the D&I one, and is never early.
        for phase, early, by, reason in (
            ("DESIGN", False, None, ""),
            ("INTERIM", False, team["owner_id"], ""),
            ("DESIGN", True, team["owner_id"], "Released early, which an automatic one never is."),
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                connection.execute(
                    """
                    INSERT INTO phase_releases (
                        organization_id, project_id, engagement_control_id, phase, early,
                        reason, released_by, automatic
                    )
                    SELECT organization_id, project_id, id, %s, %s, %s, %s, true
                    FROM engagement_controls WHERE id = %s
                    """,
                    (phase, early, reason, by, control),
                )
            connection.rollback()
        # An exception is a person's, with a reason, once per attribute.
        attribute = _approved(migrated, control)[0][0]
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                """
                INSERT INTO design_coverage_exceptions (
                    organization_id, project_id, engagement_control_id, attribute_id, reason,
                    recorded_by
                )
                SELECT organization_id, project_id, id, %s, 'Too short.', %s
                FROM engagement_controls WHERE id = %s
                """,
                (attribute, team["owner_id"], control),
            )
        connection.rollback()
