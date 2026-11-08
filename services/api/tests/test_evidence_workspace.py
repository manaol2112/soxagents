"""The evidence workspace: what the reader found is recorded against each requirement, a
file serves another phase's requirement only when a person links it, the reader's
assessment is a proposal a person decides, and evidence already held is not requested
again."""

from typing import Any
from uuid import uuid4

from support import Database
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_outbound import migrated
from test_testing_engine import _add, _base, _controls, _engagement_with_apps, _read_all

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
    # What it found is the reason; the follow-ups are what to ask (22 Oct 2026: the
    # file's note led the follow-ups before, as "users.csv: No dates.").
    assert partial.reason == "users.csv covers it in part: No dates."
    assert partial.follow_ups == ["Ask for the dates."]
    # A file that does not cover the item says nothing to follow up about it: what it
    # says to follow up is about the file (22 Oct 2026; its gaps were listed here before).
    missing = assess([_file(coverage="NOT_COVERED", gaps=["Ask for the listing."])])
    assert (missing.proposal, missing.follow_ups) == ("INSUFFICIENT", [])
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


def test_a_file_serves_only_the_items_of_its_request_it_covers(migrated: Database) -> None:
    """One request asks for several items; a file answers some of them. When the model
    reads a file and finds it does not cover an item, the file is not that item's
    evidence: the item has not received anything, the file is named apart, and a person
    can still link it. A person's judgment keeps the files it rested on."""
    team, client, scheduler = _engagement(migrated, "ews-serves")
    control = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control}"
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    carried = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(carried) >= 2
    covers, other = carried[0], carried[1]
    _add(client, team, "access standard.txt", "Managers approve all access.", request_id)
    _read_all(migrated, scheduler)
    # As the model reads it: the standard covers the first item in part, not the second.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE evidence_analyses a SET source = 'MODEL',
                   classification = jsonb_set(a.classification, '{items}', %s::jsonb)
            FROM evidence_files f
            WHERE f.id = a.evidence_file_id AND f.file_name = 'access standard.txt'
            """,
            (
                '[{"index": 0, "coverage": "PARTIAL", "note": "No approver named.", '
                f'"requirement_id": "{covers["id"]}"}}, '
                '{"index": 1, "coverage": "NOT_COVERED", "note": "A standard, not a request.", '
                f'"requirement_id": "{other["id"]}"}}]',
            ),
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    first = next(r for r in design["requirements"] if r["id"] == covers["id"])
    second = next(r for r in design["requirements"] if r["id"] == other["id"])
    assert [f["name"] for f in first["files"]] == ["access standard.txt"]
    assert first["passed_over"] == [] and first["assessment"]["proposal"] == "FOLLOW_UP"
    assert second["files"] == [] and second["passed_over"] == ["access standard.txt"]
    assert second["assessment"]["proposal"] == "NONE"
    # The second item has nothing of its own: it stands where its request stands (a
    # request a person marked received says so, with "no file is linked"), not received
    # because of a file that does not cover it.
    status = design["requests"][0]["status"]
    assert second["state"] == requirement_state(
        "REQUESTED", status, None, "NOT_REVIEWED", False, False
    )
    if status not in ("PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"):
        assert second["state"] not in ("RECEIVED", "PARTIALLY_RECEIVED")
    # A person says it does serve the second item after all: linking it is allowed.
    files = client.get(f"{_base(team)}/evidence-register").json()["files"]
    standard = next(f["id"] for f in files if f["file_name"] == "access standard.txt")
    linked = client.post(
        f"{base}/evidence-requirements/{other['id']}/files",
        json={"file_id": standard, "reason": "It names the request tool.",
              "version": second["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    second = next(r for r in _phase(linked.json(), "DESIGN")["requirements"]
                  if r["id"] == other["id"])  # fmt: skip
    assert [(f["name"], f["via"]) for f in second["files"]] == [("access standard.txt", "LINK")]
    assert second["passed_over"] == []
    assert second["state"] in ("RECEIVED", "PARTIALLY_RECEIVED")
    # The first item's file serves it through its request: linking it there is refused.
    again = client.post(
        f"{base}/evidence-requirements/{covers['id']}/files",
        json={"file_id": standard, "reason": "Same.", "version": first["version"]},
    )
    assert again.status_code == 409
    assert again.json()["detail"] == "the file already serves it through its request"


def test_evidence_added_on_an_item_serves_that_item_only(migrated: Database) -> None:
    """A person adds a file on one item of a request: it serves that item only, and the
    reader judges it against that item only. The same file added on another item serves
    that one too; a replacement keeps the item."""
    team, client, scheduler = _engagement(migrated, "ews-item")
    control = _control(migrated, team, "ITGC-AC-01")
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    carried = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(carried) >= 2
    first, second = carried[0], carried[1]
    interim = _phase(_plan(client, team, control), "INTERIM")
    elsewhere = next(r["id"] for r in _open(interim) if r["request_id"] != request_id)

    def upload(item: str, name: str = "access standard.txt", **params: str) -> Any:
        return client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item, **params},
            content=b"Managers approve all access requests before access is granted.",
            headers={"content-type": "text/plain"},
        )  # fmt: skip

    # Only an item the request asks for, and only on its request.
    refused = upload(elsewhere)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "this item is not one the request asks for"
    alone = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "x.txt", "requirement_id": first["id"]},
        content=b"x", headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert alone.status_code == 409
    added = upload(first["id"])
    assert added.status_code == 200, added.text
    file_id = added.json()["file_id"]
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT a.classification, m.requirement_id FROM evidence_analyses a "
            "JOIN evidence_matches m ON m.evidence_file_id = a.evidence_file_id "
            "WHERE a.evidence_file_id = %s",
            (file_id,),
        ).fetchone()
    assert row is not None and str(row[1]) == first["id"]
    # Read against the first item only.
    assert {item["requirement_id"] for item in row[0]["items"]} == {first["id"]}
    design = _phase(_plan(client, team, control), "DESIGN")
    mine = next(r for r in design["requirements"] if r["id"] == first["id"])
    other = next(r for r in design["requirements"] if r["id"] == second["id"])
    assert [(f["name"], f["via"]) for f in mine["files"]] == [("access standard.txt", "REQUEST")]
    # Not the second item's, and nothing said about it there.
    assert other["files"] == [] and other["passed_over"] == []

    # The same file added on the second item serves it too.
    again = upload(second["id"])
    assert again.status_code == 200 and again.json()["duplicate"] is True
    design = _phase(_plan(client, team, control), "DESIGN")
    other = next(r for r in design["requirements"] if r["id"] == second["id"])
    assert [(f["name"], f["via"]) for f in other["files"]] == [("access standard.txt", "LINK")]

    # A replacement keeps the item it was added for.
    replaced = client.post(
        f"{_base(team)}/evidence-files/{file_id}/replace",
        params={"name": "access standard v2.txt", "reason": "Corrected version"},
        content=b"Managers approve all access requests. Version 2.",
        headers={"content-type": "text/plain"},
    )
    assert replaced.status_code == 200, replaced.text
    with connect(migrated.url) as connection:
        kept = connection.execute(
            "SELECT requirement_id FROM evidence_matches WHERE evidence_file_id = %s",
            (replaced.json()["file_id"],),
        ).fetchone()
    assert kept is not None and str(kept[0]) == first["id"]


def test_a_withdrawn_file_added_again_on_an_item_is_restored_for_it(migrated: Database) -> None:
    """The same bytes as a withdrawn file, added on an item: the person restores it, with
    the restoration recorded, and it is for that item, read against that item only. On
    the request itself it is refused, as before: it is restored from the withdrawn files."""
    team, client, scheduler = _engagement(migrated, "ews-again")
    control = _control(migrated, team, "ITGC-AC-01")
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    item = next(r for r in _open(design) if r["request_id"] == request_id)
    content = b"Managers approve all access requests before access is granted."

    def upload(**extra: str) -> Any:
        return client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": "access standard.txt",
                    "request_id": request_id, **extra},
            content=content, headers={"content-type": "text/plain"},
        )  # fmt: skip

    first = upload()
    assert first.status_code == 200, first.text
    file_id = first.json()["file_id"]
    _read_all(migrated, scheduler)
    # Withdrawn without a reason: who and when are recorded, and that none was given.
    withdrawn = client.post(f"{_base(team)}/evidence-files/{file_id}/withdraw", json={})
    assert withdrawn.status_code == 200, withdrawn.text
    assert withdrawn.json()["withdrawn"][0]["reason"] == "No reason given."
    # On the request itself: refused, with the way back named.
    refused = upload()
    assert refused.status_code == 409
    assert refused.json()["detail"].startswith("this file was withdrawn")
    # On an item: restored for it.
    again = upload(requirement_id=item["id"])
    assert again.status_code == 200, again.text
    assert again.json()["file_id"] == file_id
    _read_all(migrated, scheduler)
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT m.requirement_id, a.classification, w.restored_at IS NOT NULL, "
            "w.restore_reason FROM evidence_matches m "
            "JOIN evidence_analyses a ON a.evidence_file_id = m.evidence_file_id "
            "JOIN evidence_withdrawals w ON w.evidence_file_id = m.evidence_file_id "
            "WHERE m.evidence_file_id = %s",
            (file_id,),
        ).fetchone()
    assert row is not None and str(row[0]) == item["id"]
    assert {entry["requirement_id"] for entry in row[1]["items"]} == {item["id"]}
    assert row[2] is True and row[3] == "Added again on an item of its evidence request."
    design = _phase(_plan(client, team, control), "DESIGN")
    mine = next(r for r in design["requirements"] if r["id"] == item["id"])
    assert [f["name"] for f in mine["files"]] == ["access standard.txt"]


def test_a_policy_added_once_serves_the_systems_a_person_names(migrated: Database) -> None:
    """A policy added on one system's item, said by the person to apply to several of the
    control's systems, serves the same item on each of them; the systems left out keep
    waiting. The coordinator never changes the person's choice."""
    team, client, scheduler = _engagement_with_apps(
        migrated, "ews-shared", ["AWS IAM", "Oracle Database"]
    )
    instances = {
        row["application_name"]: row
        for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }
    assert set(instances) == {"SAP ERP", "AWS IAM", "Oracle Database"}
    designs = {
        name: _phase(_plan(client, team, row["id"]), "DESIGN") for name, row in instances.items()
    }
    sap = designs["SAP ERP"]
    policy = next(
        r for r in _open(sap) if "PROCESS_DOCUMENTATION" in r["categories"] and r["request_id"]
    )
    apps = {name: row["application_id"] for name, row in instances.items()}

    def upload(applications: str, name: str = "access policy.txt", **extra: str) -> Any:
        return client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": policy["request_id"],
                    "requirement_id": policy["id"], "applications": applications, **extra},
            content=b"Access to every system is approved by the user's manager.",
            headers={"content-type": "text/plain"},
        )  # fmt: skip

    # Only the control's own systems, checked before anything is stored.
    foreign = upload(str(uuid4()))
    assert foreign.status_code == 409
    assert foreign.json()["detail"] == "the control does not cover that application"
    assert upload("not-an-id").status_code == 409
    added = upload(f"{apps['SAP ERP']},{apps['AWS IAM']}")
    assert added.status_code == 200, added.text
    _read_all(migrated, scheduler)
    register = client.get(f"{_base(team)}/evidence-register").json()
    row = next(f for f in register["files"] if f["file_name"] == "access policy.txt")
    # The person's choice stands after the coordinator read the file.
    assert (row["application_scope"], row["application_by"]) == ("SOME", "PERSON")
    assert {a["name"] for a in row["applications"]} == {"SAP ERP", "AWS IAM"}

    def item(name: str) -> dict[str, Any]:
        phase = _phase(_plan(client, team, instances[name]["id"]), "DESIGN")
        return next(r for r in phase["requirements"] if r["key"] == policy["key"])

    assert [(f["name"], f["via"]) for f in item("SAP ERP")["files"]] == [
        ("access policy.txt", "REQUEST")
    ]
    aws = item("AWS IAM")
    assert [(f["name"], f["via"], f["shared_from"]) for f in aws["files"]] == [
        ("access policy.txt", "SHARED", "SAP ERP")
    ]
    assert aws["state"] in ("PARTIALLY_RECEIVED", "RECEIVED")
    # A person judges it there too: it has arrived through the policy shared with it.
    judged = client.post(
        f"{_base(team)}/controls/{instances['AWS IAM']['id']}"
        f"/evidence-requirements/{aws['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": aws["version"]},
    )
    assert judged.status_code == 200, judged.text
    assert item("AWS IAM")["state"] == "ACCEPTED"
    # Oracle Database was left out: its item still waits.
    assert item("Oracle Database")["files"] == []

    # All systems: the Oracle item is served too.
    every = upload("ALL", name="access policy v2.txt")
    assert every.status_code == 200, every.text
    _read_all(migrated, scheduler)
    assert [f["name"] for f in item("Oracle Database")["files"]] == ["access policy v2.txt"]


def test_a_file_named_for_several_applications_is_tested_on_each() -> None:
    from ai_workforce_api.testing_engine import place_by_application

    one, two, three = uuid4(), uuid4(), uuid4()
    tag = ("SOME", None, "")
    assert place_by_application([one, two, three], tag, (one, three))[:2] == ("PLACED", [0, 2])
    assert place_by_application([two], tag, (one, three))[0] == "EXCLUDED"
    assert place_by_application([three], tag, (one, three))[:2] == ("PLACED", [0])


def test_a_request_is_received_when_a_person_accepts_its_last_item(migrated: Database) -> None:
    """Accepting every item a request asked for settles it: it is received and its open
    reminders stop, whatever the reader found. Migration 0103 does the same for a request
    settled before."""
    from pathlib import Path

    team, client, scheduler = _engagement(migrated, "ews-settle")
    control = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control}"
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    items = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(items) >= 2
    for index, item in enumerate(items):
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": f"evidence {index}.txt",
                    "request_id": request_id, "requirement_id": item["id"]},
            content=f"Evidence for item {index}.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
    _read_all(migrated, scheduler)

    def status() -> str:
        with connect(migrated.url) as connection:
            row = connection.execute(
                "SELECT status FROM pbc_requests WHERE id = %s", (request_id,)
            ).fetchone()
        assert row is not None
        return str(row[0])

    def accept(item_id: str) -> None:
        design = _phase(_plan(client, team, control), "DESIGN")
        current = next(r for r in design["requirements"] if r["id"] == item_id)
        judged = client.post(
            f"{base}/evidence-requirements/{item_id}/sufficiency",
            json={"sufficiency": "ACCEPTED", "version": current["version"]},
        )
        assert judged.status_code == 200, judged.text

    # As if the reader had not found every item covered, with a reminder due.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'PARTIALLY_RECEIVED', received_at = NULL "
            "WHERE id = %s",
            (request_id,),
        )
    for item in items[:-1]:
        accept(item["id"])
    assert status() == "PARTIALLY_RECEIVED"
    # Before the last item: the design evidence is the design work in hand (other work,
    # such as a drafted request, may come first as the next step).
    row = next(r for r in _controls(client, team) if r["id"] == control)
    assert row["design_step"] == "Review the design evidence"
    assert row["next_step"] != "Confirm the population"
    accept(items[-1]["id"])
    assert status() == "RECEIVED"
    # Every design item accepted: the agent drafts the design workpaper from them, and
    # that is the next step, before any population.
    with connect(migrated.url) as connection:
        drafted = connection.execute(
            "SELECT status, draft_status FROM workpapers "
            "WHERE engagement_control_id = %s AND stage = 'DESIGN'",
            (control,),
        ).fetchone()
    assert drafted is not None and drafted[1] in ("PENDING", "WORKING", "IDLE")
    row = next(r for r in _controls(client, team) if r["id"] == control)
    assert row["design_step"] in ("Drafting the design workpaper", "Prepare the design workpaper")
    assert row["next_step"] != "Confirm the population"

    # A request settled before this: the migration receives it.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_requests SET status = 'PARTIALLY_RECEIVED', received_at = NULL "
            "WHERE id = %s",
            (request_id,),
        )
        sql = (
            Path(__file__).resolve().parents[3] / "migrations" / "0103_received_when_accepted.sql"
        ).read_text(encoding="utf-8")
        connection.execute(sql)  # type: ignore[arg-type]
    assert status() == "RECEIVED"


def test_a_linked_file_has_arrived_even_before_its_requirement_is_requested() -> None:
    assert requirement_state("PLANNED", None, None, "NOT_REVIEWED") == "NOT_GENERATED"
    assert requirement_state("PLANNED", None, None, "NOT_REVIEWED", True, True) == "RECEIVED"
    assert requirement_state("PLANNED", None, None, "ACCEPTED", True, True) == "ACCEPTED"
    # A partly received request has some of its items in: one with nothing of its own is
    # still awaited; one with a file that serves it is partly received.
    assert requirement_state("REQUESTED", "PARTIALLY_RECEIVED", None, "NOT_REVIEWED") == "SENT"
    assert (
        requirement_state("REQUESTED", "PARTIALLY_RECEIVED", None, "NOT_REVIEWED", True)
        == "PARTIALLY_RECEIVED"
    )
    assert requirement_state("REQUESTED", "RECEIVED", None, "NOT_REVIEWED") == "RECEIVED"
    # A person's judgment stands on a partly received request.
    assert requirement_state("REQUESTED", "PARTIALLY_RECEIVED", None, "INSUFFICIENT") == (
        "INSUFFICIENT"
    )


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
    # Lean (27 October 2026): the roll-forward's list is the item linked here; its selected
    # samples wait for the list. Anything else the phase holds is requested.
    others = [r for r in _open(roll) if r["id"] != target["id"]]
    assert others and all(
        r["state"] == "AWAITING_DEPENDENCY" or r["request_id"] is not None for r in others
    )
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


def test_a_file_for_one_item_never_marks_the_whole_request_received(migrated: Database) -> None:
    """Found by the product owner on 31 October 2026: a policy added on one design item
    marked the request received, so the other item, with no file, read "Received, not yet
    reviewed". A request sent from the evidence plan has no drafted item list (its draft is
    skipped), and the receipt counted that as every item covered. Now each requested item
    counts by its own evidence: one item in makes the request partly received, the other
    stays awaited, and the request is received once both are in."""
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "receipt-item", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    with connect(migrated.url) as connection:
        # As a request sent from the evidence plan: its draft was skipped.
        connection.execute(
            "UPDATE pbc_drafts SET status = 'SKIPPED' WHERE pbc_request_id = %s", (request_id,)
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    carried = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(carried) >= 2
    first, rest = carried[0], carried[1:]

    def add_for(item: dict[str, Any], name: str) -> None:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item["id"]},
            content=f"Evidence for {item['title']}: managers approve access.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        with connect(migrated.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)

    def states() -> tuple[str, dict[str, str]]:
        phase = _phase(_plan(client, team, control), "DESIGN")
        request = next(r for r in phase["requests"] if r["id"] == request_id)
        items = {
            r["id"]: r["state"] for r in phase["requirements"] if r["request_id"] == request_id
        }
        return str(request["status"]), items

    add_for(first, "access policy.txt")
    status, items = states()
    assert status == "PARTIALLY_RECEIVED"
    assert items[first["id"]] == "PARTIALLY_RECEIVED"
    # The items with nothing of their own are still awaited from the owner.
    assert all(items[item["id"]] == "SENT" for item in rest)

    for number, item in enumerate(rest):
        add_for(item, f"evidence {number}.txt")
    status, items = states()
    assert status == "RECEIVED"
    assert all(items[item["id"]] == "RECEIVED" for item in carried)


def test_withdrawing_one_items_file_steps_the_request_back(migrated: Database) -> None:
    """Found by the product owner on 31 October 2026: withdrawing a file left its request
    received. The request now follows the evidence left on it: partly received while some
    items still have files, back to sent once none has, and received again when a file is
    restored. Each move is audited."""
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "receipt-withdraw", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_drafts SET status = 'SKIPPED' WHERE pbc_request_id = %s", (request_id,)
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    carried = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(carried) >= 2

    def add_for(item: dict[str, Any], name: str) -> str:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item["id"]},
            content=f"Evidence for {item['title']}: managers approve access.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        with connect(migrated.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
            row = connection.execute(
                "SELECT id FROM evidence_files WHERE file_name = %s AND project_id = %s",
                (name, team["project"]),
            ).fetchone()
        assert row is not None
        return str(row[0])

    def status() -> str:
        phase = _phase(_plan(client, team, control), "DESIGN")
        return str(next(r for r in phase["requests"] if r["id"] == request_id)["status"])

    def change(file_id: str, action: str) -> None:
        moved = client.post(
            f"{_base(team)}/evidence-files/{file_id}/{action}",
            json={"reason": "Uploaded the wrong document."},
        )
        assert moved.status_code == 200, moved.text

    files = [add_for(item, f"evidence {number}.txt") for number, item in enumerate(carried)]
    assert status() == "RECEIVED"

    # The last item's file goes: the other items still have theirs.
    change(files[-1], "withdraw")
    assert status() == "PARTIALLY_RECEIVED"
    # Every file goes: the request is back where it was before any evidence came.
    for file_id in files[:-1]:
        change(file_id, "withdraw")
    assert status() == "SENT"
    # A file restored counts again.
    change(files[0], "restore")
    assert status() == "PARTIALLY_RECEIVED"
    for file_id in files[1:]:
        change(file_id, "restore")
    assert status() == "RECEIVED"

    # A person accepted every item: its files are relied on, so none can be withdrawn
    # (product owner, 31 October 2026), and the request stays received.
    for item in _open(_phase(_plan(client, team, control), "DESIGN")):
        if item["request_id"] != request_id:
            continue
        accepted = client.post(
            f"{_base(team)}/controls/{control}/evidence-requirements/{item['id']}/sufficiency",
            json={"sufficiency": "ACCEPTED", "version": item["version"]},
        )
        assert accepted.status_code == 200, accepted.text
    kept = client.post(
        f"{_base(team)}/evidence-files/{files[-1]}/withdraw",
        json={"reason": "Uploaded the wrong document."},
    )
    assert kept.status_code == 409
    assert "was accepted with it" in kept.json()["detail"]
    assert status() == "RECEIVED"

    with connect(migrated.url) as connection:
        moves = [
            (row[0]["from"], row[0]["status"])
            for row in connection.execute(
                "SELECT payload FROM audit_events WHERE action = 'pbc.receipt_undone' "
                "AND target_id = %s ORDER BY occurred_at",
                (request_id,),
            ).fetchall()
        ]
    assert moves == [("RECEIVED", "PARTIALLY_RECEIVED"), ("PARTIALLY_RECEIVED", "SENT")]


def test_a_file_no_one_relied_on_can_be_withdrawn(migrated: Database) -> None:
    """Product owner, 31 October 2026: evidence uploaded and not yet accepted or used in
    testing can be removed. A file was kept because its control's design workpaper had
    been prepared before the file arrived. Now only reliance on the file itself keeps it:
    an item accepted with it, or a prepared workpaper that cites it."""
    from psycopg.types.json import Json
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "withdraw-unused", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    design = _phase(_plan(client, team, control), "DESIGN")
    first, second = [r for r in _open(design) if r["request_id"] == request_id][:2]

    def add_for(item: dict[str, Any], name: str) -> str:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item["id"]},
            content=f"{name}: managers approve access for {item['title']}.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        with connect(migrated.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
            row = connection.execute(
                "SELECT id FROM evidence_files WHERE file_name = %s AND project_id = %s",
                (name, team["project"]),
            ).fetchone()
        assert row is not None
        return str(row[0])

    cited = add_for(first, "policy.txt")
    accepted = add_for(second, "walkthrough.txt")
    # A person accepts the second item with its file.
    item = next(
        r for r in _phase(_plan(client, team, control), "DESIGN")["requirements"]
        if r["id"] == second["id"]
    )  # fmt: skip
    judged = client.post(
        f"{_base(team)}/controls/{control}/evidence-requirements/{item['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": item["version"]},
    )
    assert judged.status_code == 200, judged.text
    # The design workpaper is prepared, citing the policy.
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT id, current_version FROM workpapers "
            "WHERE project_id = %s AND engagement_control_id = %s AND stage = 'DESIGN'",
            (team["project"], control),
        ).fetchone()
        if found is None:
            found = connection.execute(
                """
                INSERT INTO workpapers (organization_id, project_id, engagement_control_id,
                                        stage, template_key, requested_by, draft_status)
                VALUES (%s, %s, %s, 'DESIGN', 'itgc', %s, 'IDLE')
                RETURNING id, current_version
                """,
                (team["org"], team["project"], control, team["owner_id"]),
            ).fetchone()
        assert found is not None
        number = int(found[1]) + 1
        connection.execute(
            "INSERT INTO workpaper_versions (workpaper_id, number, content, source, created_by) "
            "VALUES (%s, %s, %s, 'PERSON', %s)",
            (found[0], number,
             Json({"walkthrough": f'Managers approve access [cite:{cited} "managers approve"]'}),
             team["owner_id"]),
        )  # fmt: skip
        connection.execute(
            "UPDATE workpapers SET current_version = %s, status = 'PREPARED', prepared_by = %s, "
            "prepared_at = clock_timestamp(), prepared_version = %s, draft_status = 'IDLE' "
            "WHERE id = %s",
            (number, team["owner_id"], number, found[0]),
        )
    # A file added after: no one accepted it or used it in testing.
    later = add_for(first, "later upload.txt")

    def withdraw(file_id: str) -> Any:
        return client.post(
            f"{_base(team)}/evidence-files/{file_id}/withdraw",
            json={"reason": "Uploaded by mistake."},
        )

    kept = withdraw(cited)
    assert kept.status_code == 409
    assert "prepared design workpaper for ITGC-AC-01 cites it" in kept.json()["detail"]
    kept = withdraw(accepted)
    assert kept.status_code == 409
    assert "was accepted with it" in kept.json()["detail"]
    # The prepared workpaper does not keep a file it does not cite.
    removed = withdraw(later)
    assert removed.status_code == 200, removed.text
    # A file added to the accepted item after it was accepted was not part of that decision.
    after = add_for(second, "after acceptance.txt")
    removed = withdraw(after)
    assert removed.status_code == 200, removed.text


def test_unlinking_an_items_only_file_steps_the_request_back(migrated: Database) -> None:
    """Found by the product owner on 31 October 2026: after an item's only file was
    unlinked, the item read "Provided" with nothing linked, because its request stayed
    received. The request now follows the evidence left on it, as when a file is
    withdrawn."""
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "receipt-unlink", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_drafts SET status = 'SKIPPED' WHERE pbc_request_id = %s", (request_id,)
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    carried = [r for r in _open(design) if r["request_id"] == request_id]
    assert len(carried) == 2
    first, second = carried
    items = f"{_base(team)}/controls/{control}/evidence-requirements"

    def add_for(item: dict[str, Any], name: str) -> str:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item["id"]},
            content=f"{name}: managers approve access for {item['title']}.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        with connect(migrated.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
            row = connection.execute(
                "SELECT id FROM evidence_files WHERE file_name = %s AND project_id = %s",
                (name, team["project"]),
            ).fetchone()
        assert row is not None
        return str(row[0])

    def current(item_id: str) -> dict[str, Any]:
        phase = _phase(_plan(client, team, control), "DESIGN")
        return next(r for r in phase["requirements"] if r["id"] == item_id)

    def status() -> str:
        phase = _phase(_plan(client, team, control), "DESIGN")
        return str(next(r for r in phase["requests"] if r["id"] == request_id)["status"])

    shared = add_for(first, "approval rules.txt")
    assert status() == "PARTIALLY_RECEIVED"
    # The same file is linked to the second item, then the first item gets another file.
    linked = client.post(
        f"{items}/{second['id']}/files",
        json={"file_id": shared, "reason": "The rules name who grants access.",
              "version": current(second["id"])["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    add_for(first, "approval rules v2.txt")
    assert status() == "RECEIVED"

    link = next(f for f in current(second["id"])["files"] if f["via"] == "LINK")
    removed = client.post(
        f"{items}/{second['id']}/files/{link['link_id']}/remove",
        json={"reason": "It does not show who grants access.", "version": link["link_version"]},
    )
    assert removed.status_code == 200, removed.text
    assert status() == "PARTIALLY_RECEIVED"
    assert current(second["id"])["state"] == "SENT"
    with connect(migrated.url) as connection:
        moved = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'pbc.receipt_undone' "
            "AND target_id = %s",
            (request_id,),
        ).fetchall()
    assert [row[0]["status"] for row in moved] == ["PARTIALLY_RECEIVED"]


def test_an_item_without_its_own_file_cannot_be_accepted(migrated: Database) -> None:
    """Found by the product owner on 31 October 2026: an item with no file showed Accept,
    because its request had received a file for another item; accepted, it had nothing to
    stand on and no way back. Accepting now needs a file of the item's own, and a person
    can reopen a decision, with why."""
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "accept-own", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_drafts SET status = 'SKIPPED' WHERE pbc_request_id = %s", (request_id,)
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    first, second = [r for r in _open(design) if r["request_id"] == request_id][:2]
    added = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "policy.txt", "request_id": request_id,
                "requirement_id": first["id"]},
        content=b"Managers approve access before it is granted.",
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    with connect(migrated.url) as connection:
        for (analysis_id,) in connection.execute(
            "SELECT id FROM evidence_analyses WHERE status = 'PENDING'"
        ).fetchall():
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)

    items = f"{_base(team)}/controls/{control}/evidence-requirements"

    def current(item_id: str) -> dict[str, Any]:
        phase = _phase(_plan(client, team, control), "DESIGN")
        return next(r for r in phase["requirements"] if r["id"] == item_id)

    def judge(item_id: str, sufficiency: str, note: str = "") -> Any:
        return client.post(
            f"{items}/{item_id}/sufficiency",
            json={"sufficiency": sufficiency, "note": note,
                  "version": current(item_id)["version"]},
        )  # fmt: skip

    refused = judge(second["id"], "ACCEPTED")
    assert refused.status_code == 409
    assert "no file serves this item yet" in refused.json()["detail"]
    assert current(second["id"])["state"] != "ACCEPTED"
    # The item with its own file is accepted, and the decision can be reopened.
    assert judge(first["id"], "ACCEPTED").status_code == 200
    assert current(first["id"])["state"] == "ACCEPTED"
    reopened = judge(first["id"], "NOT_REVIEWED", "Accepted on the wrong version.")
    assert reopened.status_code == 200, reopened.text
    assert current(first["id"])["state"] != "ACCEPTED"


def test_a_phase_waits_until_each_item_is_complete(migrated: Database) -> None:
    """Found by the product owner on 31 October 2026: one design file moved the control to
    Testing. A file the reader finds covers an item only in part does not complete it; a
    phase goes to testing once each item is accepted by a person, covered in full by a
    file, or marked not applicable."""
    from psycopg.types.json import Json
    from test_control_progress import _controls
    from test_evidence_analysis import _no_ocr, _settings
    from test_evidence_portal import _sent

    from ai_workforce_api.evidence_analysis import run_analysis

    sent = _sent(migrated, "phase-complete", phase="DESIGN")
    team, client, request_id = sent["team"], sent["client"], str(sent["request_id"])
    control = _control(migrated, team, "ITGC-AC-01")
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE pbc_drafts SET status = 'SKIPPED' WHERE pbc_request_id = %s", (request_id,)
        )
    design = _phase(_plan(client, team, control), "DESIGN")
    first, second = [r for r in _open(design) if r["request_id"] == request_id][:2]
    items = f"{_base(team)}/controls/{control}/evidence-requirements"

    def add_for(item: dict[str, Any], name: str) -> str:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": request_id,
                    "requirement_id": item["id"]},
            content=f"{name}: managers approve access for {item['title']}.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        with connect(migrated.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING'"
            ).fetchall():
                run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
            row = connection.execute(
                "SELECT id FROM evidence_files WHERE file_name = %s AND project_id = %s",
                (name, team["project"]),
            ).fetchone()
        assert row is not None
        return str(row[0])

    def coverage(file_id: str, item_id: str, value: str) -> None:
        # What the reader found, pinned for the test: "covers it in part" or in full.
        with connect(migrated.url) as connection:
            found = connection.execute(
                "SELECT classification FROM evidence_analyses WHERE evidence_file_id = %s",
                (file_id,),
            ).fetchone()
            assert found is not None
            classification = dict(found[0])
            classification["items"] = [
                {"index": 0, "title": "item", "coverage": value, "requirement_id": item_id}
            ]
            connection.execute(
                "UPDATE evidence_analyses SET classification = %s WHERE evidence_file_id = %s",
                (Json(classification), file_id),
            )

    def version_of(item_id: str) -> int:
        phase = _phase(_plan(client, team, control), "DESIGN")
        return int(next(r for r in phase["requirements"] if r["id"] == item_id)["version"])

    def design_phase() -> tuple[str, dict[str, Any]]:
        journey = _controls(client, team)[control]["journey"]
        phase = next(item for item in journey["phases"] if item["phase"] == "DESIGN")
        return str(journey["step"]), phase

    policy = add_for(first, "policy.txt")
    trace = add_for(second, "one leaver.txt")
    coverage(policy, first["id"], "PARTIAL")
    coverage(trace, second["id"], "PARTIAL")
    status = _phase(_plan(client, team, control), "DESIGN")
    assert next(r for r in status["requests"] if r["id"] == request_id)["status"] == "RECEIVED"
    # Both files cover their items only in part: the phase still waits on its evidence.
    step, phase = design_phase()
    assert (step, phase["state"]) == ("REQUEST", "REQUESTED")
    assert any("2 evidence items are not complete" in b for b in phase["blockers"])

    accepted = client.post(
        f"{items}/{first['id']}/sufficiency",
        json={"sufficiency": "ACCEPTED", "version": version_of(first["id"])},
    )
    assert accepted.status_code == 200, accepted.text
    step, phase = design_phase()
    assert (step, phase["state"]) == ("REQUEST", "REQUESTED")
    assert any("1 evidence item is not complete" in b for b in phase["blockers"])

    # The reader finds the other item covered in full: the phase is ready for testing.
    coverage(trace, second["id"], "COVERED")
    step, phase = design_phase()
    assert (step, phase["state"]) == ("TEST", "RECEIVED")
    assert not any("not complete" in b for b in phase["blockers"])

    # Covered only in part again, then marked not applicable: ready again.
    coverage(trace, second["id"], "PARTIAL")
    assert design_phase()[1]["state"] == "REQUESTED"
    waived = client.post(
        f"{items}/{second['id']}/waive",
        json={"reason": "The walkthrough is covered by the policy for this period.",
              "version": version_of(second["id"])},
    )  # fmt: skip
    assert waived.status_code == 200, waived.text
    # Marking an item not applicable revises the test plan; once approved again, the
    # phase is ready for testing.
    assert design_phase()[0] == "PLAN"
    plan = _plan(client, team, control)
    approved = client.post(
        f"{_base(team)}/controls/{control}/evidence-plan/approve",
        json={"version": plan["version"], "comment": ""},
    )
    assert approved.status_code == 200, approved.text
    step, phase = design_phase()
    assert (step, phase["state"]) == ("TEST", "RECEIVED")
