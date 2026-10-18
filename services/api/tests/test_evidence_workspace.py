"""The evidence workspace: what the reader found is recorded against each requirement, a
file serves another phase's requirement only when a person links it, the reader's
assessment is a proposal a person decides, and evidence already held is not requested
again."""

from typing import Any

from support import Database
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_outbound import migrated
from test_testing_engine import _add, _base, _read_all

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_classify import (
    Classification,
    ClassifyContext,
    ItemCoverage,
    RequestedItem,
    check_classification,
    with_requirements,
)
from ai_workforce_api.evidence_plans import RequirementFile, assess, requirement_state

_ = migrated


def _open(phase: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in phase["requirements"] if r["state"] not in ("NOT_APPLICABLE", "REMOVED")]


def test_the_reader_records_what_it_found_against_each_requirement(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ews-read")
    control = _control(migrated, team, "ITGC-AC-01")
    interim = _phase(_plan(client, team, control), "INTERIM")
    request_id = interim["requests"][0]["id"]
    carried = {r["id"] for r in interim["requirements"] if r["request_id"] == request_id}
    assert carried
    _add(client, team, "access population.csv", "User ID,Name,Date granted\nu1,A,2027-02-01\n",
         request_id)  # fmt: skip
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT a.classification FROM evidence_analyses a "
            "JOIN evidence_files f ON f.id = a.evidence_file_id WHERE f.file_name = %s",
            ("access population.csv",),
        ).fetchone()
    assert row is not None
    # Each item the reader judged is one of the request's requirements.
    assert {item["requirement_id"] for item in row[0]["items"]} == carried
    interim = _phase(_plan(client, team, control), "INTERIM")
    for requirement in interim["requirements"]:
        if requirement["id"] not in carried:
            continue
        assert [f["name"] for f in requirement["files"]] == ["access population.csv"]
        found = requirement["files"][0]
        assert found["via"] == "REQUEST" and found["coverage"] in (
            "COVERED", "PARTIAL", "NOT_COVERED"
        )  # fmt: skip
        # Read by the rules (no model in tests): a proposal only on a full field match.
        assert found["read_by"] == "RULES"
        assert requirement["assessment"]["proposal"] in ("SUFFICIENT", "NONE")
        # A proposal is not a judgment: nothing is accepted until a person accepts it.
        assert requirement["sufficiency"] == "NOT_REVIEWED"
        assert requirement["state"] != "ACCEPTED"


def test_the_answer_never_says_which_requirement_an_item_is() -> None:
    context = ClassifyContext(
        file_name="users.csv", file_kind="csv", read_as="table", read_status="READ",
        read_note="", text="User ID\nu1", columns=("User ID",), rows=1, pages=None,
        request_title="Interim", request_description="",
        items=(
            RequestedItem("population", "Every grant", (), "2027", requirement_id="req-a"),
            RequestedItem("report", "How the list was made", (), "", requirement_id="req-b"),
        ),
        control_ref="ITGC-AC-01", control_title="Access", control_activity="Approve access",
        area="Access", frequency="Event driven", systems=("SAP ERP",), period="2027",
    )  # fmt: skip
    answer = {
        "kind": "population", "confidence": "high", "summary": "A user listing.",
        "reason": "Columns.", "gaps": [], "period": "2027",
        "items": [
            {"index": 1, "coverage": "COVERED", "requirement_id": "req-a"},
            {"index": 0, "coverage": "PARTIAL", "note": "No dates."},
        ],
    }  # fmt: skip
    checked = with_requirements(check_classification(answer, context), context)
    assert [(i.index, i.requirement_id, i.coverage) for i in checked.items] == [
        (0, "req-a", "PARTIAL"),
        (1, "req-b", "COVERED"),
    ]
    stray = Classification(
        kind="population", confidence="low", summary="x", reason="",
        items=[ItemCoverage(index=5, coverage="COVERED")], gaps=[], period="",
    )  # fmt: skip
    assert with_requirements(stray, context).items[0].requirement_id == ""


def _file(**fields: Any) -> RequirementFile:
    values: dict[str, Any] = {
        "file_id": "00000000-0000-0000-0000-000000000001",
        "name": "users.csv",
        "via": "REQUEST",
        "read_status": "READY",
    }
    values.update(fields)
    return RequirementFile(**values)


def test_the_assessment_proposes_and_says_why() -> None:
    assert assess([]).proposal == "NONE"
    covered = assess([_file(coverage="COVERED", note="Every field is there.")])
    assert (covered.proposal, covered.reason) == (
        "SUFFICIENT", "users.csv covers it: Every field is there."
    )  # fmt: skip
    partial = assess([_file(coverage="PARTIAL", note="No dates.", gaps=["Ask for the dates."])])
    assert partial.proposal == "FOLLOW_UP"
    assert partial.follow_ups == ["users.csv: No dates.", "Ask for the dates."]
    missing = assess([_file(coverage="NOT_COVERED", gaps=["Ask for the listing."])])
    assert (missing.proposal, missing.follow_ups) == ("INSUFFICIENT", ["Ask for the listing."])
    reading = assess([_file(read_status="WORKING")])
    assert (reading.proposal, reading.reason) == (
        "NONE", "The evidence reader is still reading 1 file."
    )  # fmt: skip
    failed = assess([_file(read_status="FAILED")])
    assert failed.proposal == "NONE" and "could not be read" in failed.reason
    # The rules match kinds, not detail: only their full field match proposes.
    rules = assess([_file(read_by="RULES", coverage="PARTIAL", note="The kind matches.")])
    assert rules.proposal == "NONE" and "without a model" in rules.reason
    assert assess([_file(read_by="RULES", coverage="NOT_COVERED")]).proposal == "NONE"
    assert assess([_file(read_by="RULES", coverage="COVERED")]).proposal == "SUFFICIENT"
    # A linked file was read against its own request: the reader has no view on it here.
    linked = assess([_file(via="LINK", coverage=None)])
    assert linked.proposal == "NONE" and "has not assessed" in linked.reason


def test_a_linked_file_has_arrived_even_before_its_requirement_is_requested() -> None:
    assert requirement_state("PLANNED", None, None, "NOT_REVIEWED") == "NOT_GENERATED"
    assert requirement_state("PLANNED", None, None, "NOT_REVIEWED", True, True) == "RECEIVED"
    assert requirement_state("PLANNED", None, None, "ACCEPTED", True, True) == "ACCEPTED"


def test_a_person_links_a_file_to_another_phase_and_it_is_not_requested_again(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "ews-link")
    control = _control(migrated, team, "ITGC-AC-02")
    base = f"{_base(team)}/controls/{control}"
    plan = _plan(client, team, control)
    design_request = _phase(plan, "DESIGN")["requests"][0]["id"]
    _add(client, team, "access procedure.txt", "Managers approve every change.", design_request)
    _read_all(migrated, scheduler)
    files = client.get(f"{_base(team)}/evidence-register").json()["files"]
    procedure = next(f["id"] for f in files if f["file_name"] == "access procedure.txt")
    # A roll-forward requirement, planned and not requested.
    roll = _phase(_plan(client, team, control), "ROLLFORWARD")
    target = next(r for r in _open(roll) if r["state"] == "NOT_GENERATED")
    assert target["files"] == [] and target["assessment"]["proposal"] == "NONE"
    # Nothing arrived: a judgment is refused.
    early = client.post(
        f"{base}/evidence-requirements/{target['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": target["version"]},
    )
    assert early.status_code == 409
    # A file of another control cannot be linked; neither can it be linked without a reason.
    other = _control(migrated, team, "ITGC-AC-01")
    other_request = _phase(_plan(client, team, other), "DESIGN")["requests"][0]["id"]
    _add(client, team, "other control.txt", "Another control's policy.", other_request)
    _read_all(migrated, scheduler)
    files = client.get(f"{_base(team)}/evidence-register").json()["files"]
    foreign = next(f["id"] for f in files if f["file_name"] == "other control.txt")
    refused = client.post(
        f"{base}/evidence-requirements/{target['id']}/files",
        json={"file_id": foreign, "reason": "Same policy.", "version": target["version"]},
    )
    assert refused.status_code == 409
    assert refused.json()["detail"] == "the file is not one of this control's evidence files"
    linked = client.post(
        f"{base}/evidence-requirements/{target['id']}/files",
        json={
            "file_id": procedure,
            "reason": "The procedure covers the whole year, so it serves the roll-forward.",
            "version": target["version"],
        },
    )
    assert linked.status_code == 200, linked.text
    target = next(r for r in _phase(linked.json(), "ROLLFORWARD")["requirements"]
                  if r["id"] == target["id"])  # fmt: skip
    assert target["state"] == "RECEIVED"
    assert [(f["name"], f["via"]) for f in target["files"]] == [("access procedure.txt", "LINK")]
    assert target["files"][0]["reason"].startswith("The procedure covers")
    assert target["files"][0]["linked_by"]
    # Linking it twice is refused; the design requirement it came with still has it.
    twice = client.post(
        f"{base}/evidence-requirements/{target['id']}/files",
        json={"file_id": procedure, "reason": "Again.", "version": target["version"]},
    )
    assert twice.status_code == 409
    # A person accepts it.
    accepted = client.post(
        f"{base}/evidence-requirements/{target['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": target["version"]},
    )
    assert accepted.status_code == 200, accepted.text
    # The roll-forward becomes applicable: everything else is requested, not this one.
    roll = _phase(accepted.json(), "ROLLFORWARD")
    opened = client.post(
        f"{base}/evidence-plan/phases/ROLLFORWARD",
        json={
            "applicability": "APPLICABLE",
            "rationale": "The client asked for coverage to year end from the start.",
            "version": roll["version"],
        },
    )
    assert opened.status_code == 200, opened.text
    # Deciding the phase revised the plan: it is requested once the plan is approved again.
    assert opened.json()["status"] == "PROPOSED"
    reapproved = client.post(
        f"{base}/evidence-plan/approve", json={"version": opened.json()["version"]}
    )
    assert reapproved.status_code == 200, reapproved.text
    roll = _phase(reapproved.json(), "ROLLFORWARD")
    mine = next(r for r in roll["requirements"] if r["id"] == target["id"])
    assert mine["request_id"] is None and mine["state"] == "ACCEPTED"
    others = [
        r for r in _open(roll) if r["id"] != target["id"] and r["state"] != "AWAITING_DEPENDENCY"
    ]
    assert others and all(r["request_id"] is not None for r in others)
    # Unlinking says why; the judgment that rested on it alone goes back to not reviewed.
    link = mine["files"][0]
    unlinked = client.post(
        f"{base}/evidence-requirements/{target['id']}/files/{link['link_id']}/remove",
        json={"reason": "The procedure changed in October.", "version": link["link_version"]},
    )
    assert unlinked.status_code == 200, unlinked.text
    mine = next(r for r in _phase(unlinked.json(), "ROLLFORWARD")["requirements"]
                if r["id"] == target["id"])  # fmt: skip
    assert (mine["files"], mine["sufficiency"]) == ([], "NOT_REVIEWED")
    with connect(migrated.url) as connection:
        actions = [
            row[0]
            for row in connection.execute(
                "SELECT action FROM audit_events WHERE target_id = %s ORDER BY created_at",
                (target["id"],),
            ).fetchall()
        ]
    assert actions[-3:] == [
        "evidence_requirement.file_linked",
        "evidence_requirement.sufficiency",
        "evidence_requirement.file_unlinked",
    ]


def test_a_file_already_on_the_request_is_not_linked_again(migrated: Database) -> None:
    team, client, scheduler = _engagement(migrated, "ews-same")
    control = _control(migrated, team, "ITGC-AC-02")
    base = f"{_base(team)}/controls/{control}"
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    _add(client, team, "walkthrough.txt", "One change, end to end.", request_id)
    _read_all(migrated, scheduler)
    files = client.get(f"{_base(team)}/evidence-register").json()["files"]
    walkthrough = next(f["id"] for f in files if f["file_name"] == "walkthrough.txt")
    target = next(r for r in design["requirements"] if r["request_id"] == request_id)
    same = client.post(
        f"{base}/evidence-requirements/{target['id']}/files",
        json={
            "file_id": walkthrough,
            "reason": "It is the walkthrough.",
            "version": target["version"],
        },
    )
    assert same.status_code == 409
    assert same.json()["detail"] == "the file already serves it through its request"
