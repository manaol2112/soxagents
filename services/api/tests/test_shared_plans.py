"""Unified planning, Release 1 (docs/unified-planning-r1.md): where a control operates,
shared control plans, and group approval with an individual record per implementation."""

import json
from types import SimpleNamespace
from typing import Any, cast
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database, settle_attributes
from test_evidence_intake import _client, _Scheduler
from test_onboarding import _complete_setup, _new_engagement
from test_outbound import migrated

from ai_workforce_api import shared_plans
from ai_workforce_api.console_tools import ToolContext, ToolFailed, _control
from ai_workforce_api.control_instances import FAMILY_FILES
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_plans import PlanState, shared_from_sibling
from ai_workforce_api.master_plans import ApproveBody, GroupLink, approve
from ai_workforce_api.shared_plans import (
    GroupApproveBody,
    GroupItem,
    differences,
    masked,
    reference_of,
)

_ = migrated


def _base(team: dict[str, Any]) -> str:
    return f"/organizations/{team['org']}/projects/{team['project']}"


def _engagement(
    database: Database,
    slug: str,
    systems: list[str],
    business: bool = False,
    library: tuple[str, ...] = (),
    domains: tuple[str, ...] = (),
) -> tuple[dict[str, Any], TestClient]:
    """An engagement started with more systems than SAP ERP, its plans proposed and its
    attributes settled, nothing approved yet; with one business process control in scope
    when asked, and any other library controls named."""
    team = _new_engagement(database, slug)
    client = _client(database, team["owner_id"], _Scheduler())
    _complete_setup(client, team)
    setup = f"{_base(team)}/onboarding"
    for name in systems:
        assert client.post(f"{setup}/applications", json={"name": name}).status_code == 200
    if business:
        # Account reconciliations: a business process control, with no system.
        added = client.post(
            f"{setup}/controls/add", json={"library_key": "rtr-account-reconciliations"}
        )
        assert added.status_code == 200, added.text
    if domains:
        # System-bound areas (automated application controls, key reports): one row per
        # system, as the library loads them.
        loaded = client.post(f"{setup}/controls/load-library", json={"domains": list(domains)})
        assert loaded.status_code == 200, loaded.text
    for key in library:
        added = client.post(f"{setup}/controls/add", json={"library_key": key})
        assert added.status_code == 200, added.text
    plan = client.post(f"{setup}/plan").json()["plan"]
    started = client.post(
        f"{setup}/plan/{plan['id']}/approve", json={"fingerprint": plan["fingerprint"]}
    )
    assert started.status_code == 200, started.text
    planned = client.post(f"{_base(team)}/evidence-plans/plan-missing")
    assert planned.status_code == 200, planned.text
    settle_attributes(database, team["project"])
    return team, client


def _families(client: TestClient, team: dict[str, Any]) -> dict[str, dict[str, Any]]:
    found = client.get(f"{_base(team)}/planning-review/families")
    assert found.status_code == 200, found.text
    body: dict[str, Any] = found.json()
    return {family["control_ref"]: family for family in body["families"]}


def _approve(
    client: TestClient, team: dict[str, Any], family: dict[str, Any], **change: Any
) -> Any:
    rows = {row["control_id"]: row for row in family["implementations"]}
    payload = {
        "control_ref": family["control_ref"],
        "items": [{"control_id": c, "version": rows[c]["version"]} for c in family["ready"]],
        "presented_hash": family["presented_hash"],
        "comment": "One plan for every system.",
        **change,
    }
    return client.post(f"{_base(team)}/planning-review/families/approve", json=payload)


# The comparison


def test_a_plan_is_compared_with_the_implementations_own_names_set_aside() -> None:
    snapshot = {
        "revision": 3,
        "control": {"control_ref": "AC-01", "application": "SAP ERP", "title": "Access"},
        "procedures": [{"code": "D1", "text": "Inspect the SAP ERP role list."}],
        "attributes": [{"code": "A1", "text": "Approved before access in SAP ERP."}],
        "evidence": [{"code": "E1", "title": "Policy"}],
    }
    other = json.loads(json.dumps(snapshot).replace("SAP ERP", "Oracle Database"))
    other["revision"] = 7
    assert masked(snapshot, ["SAP ERP"]) == masked(other, ["Oracle Database"])
    # Whole names only: a name inside another word is not the implementation's.
    assert masked({"x": "SAPling"}, ["SAP"])["x"] == "SAPling"
    # Anything else differs, and says what: a report name is never set aside by rule.
    other["procedures"][0]["text"] = "Inspect the Oracle Database role list from report RPT-9."
    other["evidence"].append({"code": "E2", "title": "Report RPT-9"})
    found = differences(masked(snapshot, ["SAP ERP"]), masked(other, ["Oracle Database"]))
    assert [(d.section, d.item, d.change) for d in found] == [
        ("procedures", "D1", "CHANGED"),
        ("evidence", "E2", "ADDED"),
    ]
    assert found[0].fields == ["text"]
    # One field that differs is shown as its value, as a person reads it.
    assert found[0].this == "Inspect the {implementation} role list from report RPT-9."
    # Names are set aside exactly as recorded: a unit named "US" is not the word "us".
    assert masked({"x": "Send us the US listing"}, ["US"])["x"] == (
        "Send us the {implementation} listing"
    )


def test_the_reference_plan_is_the_approved_one_else_the_largest_group_never_a_tie() -> None:
    a, b, c, d = (UUID(int=n) for n in range(1, 5))
    # Nothing approved: the plan most implementations share is proposed, whatever the order.
    found = reference_of([(a, "x", False), (b, "y", False), (c, "y", False)])
    assert (found.control_id, found.basis, found.agree, found.of) == (b, "LARGEST_GROUP", 2, 3)
    # A tie is no reference: each plan is reviewed on its own.
    tie = reference_of([(a, "x", False), (b, "y", False)])
    assert (tie.control_id, tie.basis) == (None, "NONE")
    assert reference_of([(a, "x", False), (b, "x", False), (c, "y", False), (d, "y", False)]) \
        .basis == "NONE"  # fmt: skip
    # An approved plan is the reference, even where more plans share another.
    approved = reference_of([(a, "x", False), (b, "x", False), (c, "y", True)])
    assert (approved.control_id, approved.basis, approved.agree) == (c, "APPROVED", 1)
    # Approved plans that differ leave no reference.
    conflict = reference_of([(a, "x", True), (b, "y", True), (c, "x", False)])
    assert (conflict.control_id, conflict.basis, conflict.conflicting) == (None, "NONE", True)
    # One plan is its own reference; none is none.
    assert reference_of([(a, "x", False)]).basis == "ONLY_PLAN"
    assert reference_of([]).basis == "NONE"


# One decision for every system


def test_a_shared_plan_is_approved_once_for_every_system(migrated: Database) -> None:
    team, client = _engagement(migrated, "shared-sys", ["Microsoft Active Directory", "AWS IAM"])
    family = _families(client, team)["ITGC-AC-05"]
    labels = {row["label"]: row for row in family["implementations"]}
    assert set(labels) == {"SAP ERP", "Microsoft Active Directory", "AWS IAM"}
    assert family["group"] == "TOGETHER"
    assert {row["applicability"] for row in family["implementations"]} == {"SAME_PLAN"}
    assert len(family["ready"]) == 3 and family["presented_hash"]
    assert family["shared"]["procedures"] and family["shared"]["evidence"]

    # What was shown must be what is approved: a stale fingerprint, a subset, or an old
    # version refuses the whole decision.
    stale = _approve(client, team, family, presented_hash="0" * 64)
    assert stale.status_code == 409
    assert "changed" in stale.json()["detail"]
    first = family["implementations"][0]
    subset = _approve(client, team, family, items=[
        {"control_id": first["control_id"], "version": first["version"]}
    ])  # fmt: skip
    assert subset.status_code == 409
    old = _approve(client, team, family, items=[
        {"control_id": row["control_id"], "version": row["version"] + 1}
        for row in family["implementations"]
    ])  # fmt: skip
    assert old.status_code == 409
    with connect(migrated.url) as connection:
        assert connection.execute("SELECT count(*) FROM plan_group_decisions").fetchone() == (0,)

    approved = _approve(client, team, family)
    assert approved.status_code == 200, approved.text
    group_id = approved.json()["group_decision_id"]
    with connect(migrated.url) as connection:
        decisions = connection.execute(
            """
            SELECT d.engagement_control_id, d.decision, d.group_decision_id, d.shared_hash,
                   d.scope, d.content_hash, v.content_hash, p.status
            FROM plan_decisions d
            JOIN plan_versions v ON v.id = d.plan_version_id
            JOIN evidence_plans p ON p.id = d.plan_id
            WHERE d.group_decision_id = %s
            """,
            (group_id,),
        ).fetchall()
        group = connection.execute(
            "SELECT presented, presented_hash, shared_hash, comment FROM plan_group_decisions "
            "WHERE id = %s",
            (group_id,),
        ).fetchone()
    # Each system has its own decision, on its own fingerprinted version, naming its scope,
    # the group, and the shared plan.
    assert len(decisions) == 3
    assert {str(row[0]) for row in decisions} == set(family["ready"])
    assert all(row[1] == "APPROVED" and row[3] == family["shared_hash"] for row in decisions)
    assert all(row[5] == row[6] and row[7] == "APPROVED" for row in decisions)
    assert {row[4]["application"] for row in decisions} == set(labels)
    assert group is not None
    assert group[1] == family["presented_hash"] and group[2] == family["shared_hash"]
    assert [item["label"] for item in group[0]["implementations"]] == [
        row["label"] for row in family["implementations"]
    ]
    assert group[3] == "One plan for every system."
    # A group decision cannot be changed.
    with connect(migrated.url) as connection, pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            "UPDATE plan_group_decisions SET comment = 'edited' WHERE id = %s", (group_id,)
        )
    after = _families(client, team)["ITGC-AC-05"]
    assert after["group"] == "DONE" and after["ready"] == []
    assert after["last_group_decision_by"]
    again = _approve(client, team, family)
    assert again.status_code == 409


def _ask_for_another_report(database: Database, control_id: str) -> None:
    """The implementation's plan asks for a different report: a difference, never set
    aside by rule."""
    with connect(database.url) as connection:
        connection.execute(
            """
            UPDATE evidence_requirements SET title = title || ' (from report AD-17)'
            WHERE id = (SELECT id FROM evidence_requirements
                        WHERE engagement_control_id = %s ORDER BY requirement_key LIMIT 1)
            """,
            (control_id,),
        )


def test_a_different_plan_is_reviewed_on_its_own(migrated: Database) -> None:
    # Rewritten 23 October 2026 (owner, Release 1 closure): it expected the plan first in
    # label order to lead and the other to differ from it. The reference is now the plan
    # the largest group shares, proposed for review, so the plan that differs is the one
    # unlike the others, wherever it sorts. The audit assertions are kept: a different
    # plan cannot join a group decision, and is reviewed on its own.
    team, client = _engagement(migrated, "shared-diff", ["Microsoft Active Directory", "AWS IAM"])
    family = _families(client, team)["ITGC-AC-05"]
    # The first in label order differs, so it cannot be the reference by its position.
    target = family["implementations"][0]
    _ask_for_another_report(migrated, target["control_id"])
    family = _families(client, team)["ITGC-AC-05"]
    rows = {row["control_id"]: row for row in family["implementations"]}
    odd = rows[target["control_id"]]
    assert odd["applicability"] == "DIFFERENT_PLAN" and not odd["lead"]
    assert odd["differences"] and odd["differences"][0]["section"] == "evidence"
    assert "AD-17" in odd["differences"][0]["this"]
    assert family["reference_basis"] == "LARGEST_GROUP"
    assert "2 of 3" in family["reference_note"]
    assert family["ready"] == [
        r["control_id"] for r in family["implementations"] if r["control_id"] != odd["control_id"]
    ]
    # It cannot join the group decision.
    sneaked = _approve(client, team, family, items=[
        {"control_id": row["control_id"], "version": row["version"]}
        for row in family["implementations"]
    ])  # fmt: skip
    assert sneaked.status_code == 409
    assert "review it on its own" in sneaked.json()["detail"]
    # The plans that are the same are approved together; the different one waits for its
    # own review.
    assert _approve(client, team, family).status_code == 200
    family = _families(client, team)["ITGC-AC-05"]
    assert family["group"] == "SEPARATE"
    assert family["ready"] == []
    # Now the approved plan is the reference.
    assert family["reference_basis"] == "APPROVED"


def test_two_plans_that_differ_have_no_shared_plan_until_one_is_approved(
    migrated: Database,
) -> None:
    team, client = _engagement(migrated, "shared-tie", ["Microsoft Active Directory"])
    family = _families(client, team)["ITGC-AC-05"]
    first, second = family["implementations"]
    _ask_for_another_report(migrated, second["control_id"])
    # One against one is a tie: no plan is proposed, and each is reviewed on its own.
    family = _families(client, team)["ITGC-AC-05"]
    assert family["reference_basis"] == "NONE" and family["shared"] is None
    assert family["group"] == "SEPARATE" and family["ready"] == []
    assert not any(row["lead"] for row in family["implementations"])
    assert {row["applicability"] for row in family["implementations"]} == {"DIFFERENT_PLAN"}
    assert _approve(client, team, {**family, "ready": [first["control_id"]],
                                   "presented_hash": "0" * 64}).status_code == 409  # fmt: skip
    # Approved on its own, the first plan becomes the reference; the other differs from it.
    approved = client.post(
        f"{_base(team)}/controls/{first['control_id']}/evidence-plan/approve",
        json={"version": first["version"]},
    )
    assert approved.status_code == 200, approved.text
    family = _families(client, team)["ITGC-AC-05"]
    rows = {row["control_id"]: row for row in family["implementations"]}
    assert family["reference_basis"] == "APPROVED" and rows[first["control_id"]]["lead"]
    assert rows[second["control_id"]]["applicability"] == "DIFFERENT_PLAN"
    assert "AD-17" in rows[second["control_id"]]["differences"][0]["this"]


def test_every_kind_of_control_is_planned_once_and_approved_together(
    migrated: Database,
) -> None:
    """ITGC, automated application, key report (IPE), entity-level, business process, and
    management review controls all share a plan the same way."""
    library = ("entity-code-of-conduct", "rtr-flux-review")
    team, client = _engagement(
        migrated, "shared-kinds", ["Microsoft Active Directory"], business=True,
        library=library, domains=("ITAC", "IPE"),
    )  # fmt: skip
    with connect(migrated.url) as connection:
        refs = dict(
            connection.execute(
                "SELECT library_key, control_ref FROM engagement_controls "
                "WHERE project_id = %s AND library_key = ANY(%s)",
                (
                    team["project"],
                    [
                        *library,
                        "rtr-account-reconciliations",
                        "itac-three-way-match",
                        "ipe-aged-receivables",
                    ],
                ),
            ).fetchall()
        )
    # A management review control is one by the team's classification.
    review = _families(client, team)[refs["rtr-flux-review"]]
    for row in review["implementations"]:
        put = client.put(
            f"{_base(team)}/controls/{row['control_id']}/classifications",
            json={"classifications": ["BUSINESS_PROCESS", "MANAGEMENT_REVIEW"]},
        )
        assert put.status_code == 200, put.text
    found = _families(client, team)
    expected = {
        "ITGC-AC-05": "ITGC",
        refs["itac-three-way-match"]: "AUTOMATED_APPLICATION",
        refs["ipe-aged-receivables"]: "KEY_REPORT",
        refs["entity-code-of-conduct"]: "ENTITY_LEVEL",
        refs["rtr-account-reconciliations"]: "BUSINESS_PROCESS",
        refs["rtr-flux-review"]: "MANAGEMENT_REVIEW",
    }
    for ref, kind in expected.items():
        family = found[ref]
        assert kind in family["classifications"], (ref, family["classifications"])
        if not family["ready"]:
            continue
        assert family["reference_basis"] in ("LARGEST_GROUP", "ONLY_PLAN"), ref
        approved = _approve(client, team, family)
        assert approved.status_code == 200, (ref, approved.text)
        with connect(migrated.url) as connection:
            count = connection.execute(
                "SELECT count(*) FROM plan_decisions WHERE group_decision_id = %s",
                (approved.json()["group_decision_id"],),
            ).fetchone()
        assert count == (len(family["ready"]),), ref
    # Every kind was approvable: none was left without a plan to compare.
    assert all(found[ref]["ready"] for ref in expected), {
        ref: found[ref]["group"] for ref in expected if not found[ref]["ready"]
    }


def test_a_group_decision_never_stands_without_a_record_for_each_plan(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Found in the Release 1 closure: the same decision sent twice, quickly, recorded a
    second group decision with no plan records, because the second request had read the
    plans before the first committed and approving an approved plan records nothing."""
    team, client = _engagement(migrated, "shared-race", ["Microsoft Active Directory"])
    family = _families(client, team)["ITGC-AC-05"]
    rows = {row["control_id"]: row for row in family["implementations"]}
    body = GroupApproveBody(
        control_ref="ITGC-AC-05",
        items=[GroupItem(control_id=UUID(c), version=rows[c]["version"]) for c in family["ready"]],
        presented_hash=family["presented_hash"],
    )
    with connect(migrated.url) as connection:
        # What the second request read: the family before the first decision committed.
        stale = shared_plans.family_of(connection, team["project"], "ITGC-AC-05")
    assert _approve(client, team, family).status_code == 200
    monkeypatch.setattr(shared_plans, "family_of", lambda *_args: stale)
    with connect(migrated.url) as connection, pytest.raises(PlanState):
        shared_plans.approve_group(connection, team["org"], team["project"], team["owner_id"], body)
    with connect(migrated.url) as connection:
        found = connection.execute(
            """
            SELECT g.id, (SELECT count(*) FROM plan_decisions d WHERE d.group_decision_id = g.id)
            FROM plan_group_decisions g WHERE g.project_id = %s
            """,
            (team["project"],),
        ).fetchall()
        assert [row[1] for row in found] == [len(family["ready"])]
        # Approving an approved plan as part of a group decision is refused, never skipped.
        with pytest.raises(PlanState, match="approved meanwhile"):
            approve(
                connection, team["org"], team["project"], UUID(family["ready"][0]),
                team["owner_id"], ApproveBody(version=rows[family["ready"][0]]["version"]),
                group=GroupLink(group_decision_id=found[0][0], shared_hash="0" * 64),
            )  # fmt: skip


# Business process controls, entities, and coverage


def test_a_business_control_operates_per_entity_only_when_a_lead_decides(
    migrated: Database,
) -> None:
    team, client = _engagement(migrated, "shared-bpc", [], business=True)
    families = _families(client, team)
    process = next(
        (f for f in families.values() if "BUSINESS_PROCESS" in f["classifications"]), None
    )
    assert process is not None, "the standard engagement has a business process control"
    assert len(process["implementations"]) == 1
    only = process["implementations"][0]
    assert only["label"] == "Whole engagement"
    base = _base(team)
    units = {}
    for name in ("Acme US Inc.", "Acme UK Ltd"):
        added = client.post(f"{base}/scope-units", json={"kind": "ENTITY", "name": name})
        assert added.status_code == 200, added.text
        units = {unit["name"]: unit["id"] for unit in added.json()}
    duplicate = client.post(f"{base}/scope-units", json={"kind": "ENTITY", "name": "acme us inc."})
    assert duplicate.status_code == 409
    control = f"{base}/controls/{only['control_id']}"

    # Run centrally and covering both entities, it stays one implementation.
    covered = client.post(f"{control}/coverage", json={"unit_ids": list(units.values())})
    assert covered.status_code == 200, covered.text
    assert sorted(covered.json()["covers"]) == ["Acme UK Ltd", "Acme US Inc."]
    process = _families(client, team)[process["control_ref"]]
    assert len(process["implementations"]) == 1

    # Split by entity: a decision with its reason.
    short = client.post(f"{control}/split", json={"unit_ids": list(units.values()), "reason": "x"})
    assert short.status_code == 422
    split = client.post(f"{control}/split", json={
        "unit_ids": [units["Acme US Inc."], units["Acme UK Ltd"]],
        "reason": "Each entity's finance team reconciles on its own ledger.",
    })  # fmt: skip
    assert split.status_code == 200, split.text
    assert len(split.json()) == 1
    again = client.post(f"{control}/split", json={
        "unit_ids": [units["Acme US Inc."], units["Acme UK Ltd"]],
        "reason": "Each entity's finance team reconciles on its own ledger.",
    })  # fmt: skip
    assert again.status_code == 409
    process = _families(client, team)[process["control_ref"]]
    labels = sorted(row["label"] for row in process["implementations"])
    assert labels == ["Acme UK Ltd", "Acme US Inc."]
    # Named apart wherever controls are listed: the register and engagement setup.
    ref = process["control_ref"]
    named = [f"{ref} · Acme UK Ltd", f"{ref} · Acme US Inc."]
    register = client.get(f"{base}/workspace/controls")
    assert register.status_code == 200, register.text
    assert sorted(row["label"] for row in register.json() if row["control_ref"] == ref) == named
    setup = client.get(f"{base}/onboarding").json()["controls"]
    assert sorted(row["label"] for row in setup if row["control_ref"] == ref) == named
    # And where a plan is approved, evidence is released and filed, and a control opened:
    # each split row carries its units, so the wrong entity is never picked.
    entities = ["Acme UK Ltd", "Acme US Inc."]
    queue = client.get(f"{base}/planning-review").json()["controls"]
    assert sorted(row["units"] for row in queue if row["control_ref"] == ref) == entities
    phases = client.get(f"{base}/phase-progress").json()["controls"]
    assert sorted(row["units"] for row in phases if row["control_ref"] == ref) == entities
    filed = client.get(f"{base}/evidence-register").json()["controls"]
    assert sorted(row["units"] for row in filed if row["control_ref"] == ref) == entities
    assert sorted(row["units"] for row in register.json() if row["control_ref"] == ref) == entities
    page = client.get(f"{control}/master-plan")
    assert page.status_code == 200, page.text
    assert page.json()["control"]["units"] in entities
    # The agent names a split control by its unit, and asks which when it is not named.
    with connect(migrated.url) as connection:
        context = cast(
            ToolContext,
            SimpleNamespace(connection=connection, project_id=team["project"]),
        )
        with pytest.raises(ToolFailed, match="Name one"):
            _control(context, ref)
        assert _control(context, f"{ref} · Acme UK Ltd")[1] == f"{ref} · Acme UK Ltd"
    with connect(migrated.url) as connection:
        keys = connection.execute(
            "SELECT implementation_key FROM engagement_controls WHERE project_id = %s "
            "AND control_ref = %s",
            (team["project"], process["control_ref"]),
        ).fetchall()
    assert len({row[0] for row in keys}) == 2
    # The same plan for both entities: one decision, two records naming each entity.
    assert process["group"] == "TOGETHER" and len(process["ready"]) == 2
    approved = _approve(client, team, process)
    assert approved.status_code == 200, approved.text
    with connect(migrated.url) as connection:
        scopes = connection.execute(
            "SELECT scope FROM plan_decisions WHERE group_decision_id = %s",
            (approved.json()["group_decision_id"],),
        ).fetchall()
    assert sorted(row[0]["operates"][0] for row in scopes) == ["Acme UK Ltd", "Acme US Inc."]

    # An answer for one entity never fills the other by itself, even when asked to fill
    # every control that has none: each entity may name a different person.
    split_rows = {
        row["units"]: row
        for row in client.get(f"{base}/planning-review").json()["controls"]
        if row["control_ref"] == ref
    }
    uk, us = split_rows["Acme UK Ltd"], split_rows["Acme US Inc."]
    asked = {item["key"] for item in uk["open_values"]} & {
        item["key"] for item in us["open_values"]
    }
    assert asked, "both entities ask for the same client value"
    key = sorted(asked)[0]
    put = client.put(
        f"{base}/controls/{uk['control_id']}/values",
        json={"values": {key: "UK finance controller"}, "everywhere": True},
    )
    assert put.status_code == 200, put.text
    with connect(migrated.url) as connection:
        filled = connection.execute(
            "SELECT engagement_control_id FROM control_parameters "
            "WHERE slot_key = %s AND value <> '' AND engagement_control_id = ANY(%s)",
            (key, [UUID(uk["control_id"]), UUID(us["control_id"])]),
        ).fetchall()
    assert [str(row[0]) for row in filled] == [uk["control_id"]]


# Evidence stays within its implementation's units


def _filed(
    database: Database,
    client: TestClient,
    team: dict[str, Any],
    requirement: tuple[str, str, str],
    name: str,
    scope: str = "ALL",
    by: str = "PERSON",
) -> UUID:
    """A file uploaded and filed by a person to one item (control, requirement) of a
    request, with the application tag given: as a person adds a policy on one item."""
    uploaded = client.post(
        f"{_base(team)}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": name, "path": ""},
        content=f"file,{name}\n".encode(),
        headers={"content-type": "text/csv"},
    )
    assert uploaded.status_code == 200, uploaded.text
    file_id = UUID(uploaded.json()["file_id"])
    control_id, requirement_id, request_id = requirement
    with connect(database.url) as connection:
        filed = connection.execute(
            "UPDATE evidence_matches SET status = 'FILED', engagement_control_id = %s, "
            "requirement_id = %s, pbc_request_id = %s, filed_by = 'PERSON', decided_by = %s "
            "WHERE evidence_file_id = %s",
            (control_id, requirement_id, request_id, team["owner_id"], file_id),
        ).rowcount
        if filed == 0:
            connection.execute(
                "INSERT INTO evidence_matches (organization_id, project_id, evidence_file_id, "
                "status, engagement_control_id, requirement_id, pbc_request_id, filed_by, "
                "decided_by) VALUES (%s, %s, %s, 'FILED', %s, %s, %s, 'PERSON', %s)",
                (team["org"], team["project"], file_id, control_id, requirement_id,
                 request_id, team["owner_id"]),
            )  # fmt: skip
        connection.execute(
            "DELETE FROM evidence_file_applications WHERE evidence_file_id = %s", (file_id,)
        )
        one = scope == "ONE"
        connection.execute(
            "INSERT INTO evidence_file_applications (evidence_file_id, organization_id, "
            "project_id, scope, tagged_by, decided_by, engagement_application_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, "
            "(SELECT engagement_application_id FROM engagement_controls WHERE id = %s AND %s))",
            (file_id, team["org"], team["project"], scope, by,
             team["owner_id"] if by == "PERSON" else None, control_id, one),
        )  # fmt: skip
    return file_id


def _item_files(database: Database, requirement_id: str) -> set[UUID]:
    """The files a sibling shares with this item (evidence_plans.shared_from_sibling)."""
    with connect(database.url) as connection:
        return {
            UUID(str(row[0]))
            for row in connection.execute(
                f"""
                SELECT x.id FROM evidence_requirements q
                CROSS JOIN LATERAL ({shared_from_sibling("f.id AS id")}) x
                WHERE q.id = %s
                """,
                (requirement_id,),
            ).fetchall()
        }


def _control_files(database: Database, control_id: str) -> set[UUID]:
    """The files a control's family shares with it (control_instances.FAMILY_FILES)."""
    with connect(database.url) as connection:
        return {
            UUID(str(row[0])) for row in connection.execute(FAMILY_FILES, (control_id,)).fetchall()
        }


def _same_item(
    database: Database, team: dict[str, Any], ids: list[str]
) -> list[tuple[str, str, str]]:
    """One requested item each of the given controls (control, requirement, request), the
    same phase and item in all."""
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT engagement_control_id, id, phase, requirement_key, pbc_request_id
            FROM evidence_requirements
            WHERE project_id = %s AND engagement_control_id = ANY(%s)
              AND pbc_request_id IS NOT NULL
            ORDER BY phase, requirement_key, engagement_control_id
            """,
            (team["project"], [UUID(i) for i in ids]),
        ).fetchall()
    items: dict[tuple[str, str], dict[str, tuple[str, str]]] = {}
    for control_id, requirement_id, phase, key, request_id in rows:
        items.setdefault((str(phase), str(key)), {})[str(control_id)] = (
            str(requirement_id),
            str(request_id),
        )
    shared = next(found for found in items.values() if set(found) == set(ids))
    return [(i, *shared[i]) for i in ids]


def test_evidence_is_never_shared_across_entities_and_still_shared_across_systems(
    migrated: Database,
) -> None:
    """Release 1 closure (owner): a split control's entities never take each other's
    evidence, through the files a control's family shares or the files a sibling adds on
    the same item, whatever a file's application tag says. Release 1 has no authorized
    relationship that shares evidence across entities: that is Release 2's consolidation.
    Within one scope, a control per system, what a person tags still serves as before."""
    team, client = _engagement(
        migrated, "shared-evidence", ["Microsoft Active Directory"], business=True
    )
    base = _base(team)
    families = _families(client, team)
    process = next(f for f in families.values() if "BUSINESS_PROCESS" in f["classifications"])
    units = {}
    for name in ("Acme US Inc.", "Acme UK Ltd"):
        added = client.post(f"{base}/scope-units", json={"kind": "ENTITY", "name": name})
        units = {unit["name"]: unit["id"] for unit in added.json()}
    split = client.post(
        f"{base}/controls/{process['implementations'][0]['control_id']}/split",
        json={"unit_ids": [units["Acme UK Ltd"], units["Acme US Inc."]],
              "reason": "Each entity's finance team reconciles on its own ledger."},
    )  # fmt: skip
    assert split.status_code == 200, split.text
    # Approved, each implementation's requests are drafted for its items.
    after = _families(client, team)
    for ref in (process["control_ref"], "ITGC-AC-05"):
        assert _approve(client, team, after[ref]).status_code == 200
    entities = {
        row["label"]: row["control_id"] for row in after[process["control_ref"]]["implementations"]
    }
    uk, us = _same_item(migrated, team, [entities["Acme UK Ltd"], entities["Acme US Inc."]])
    systems = {row["label"]: row["control_id"] for row in families["ITGC-AC-05"]["implementations"]}
    sap, ad = _same_item(
        migrated, team, [systems["SAP ERP"], systems["Microsoft Active Directory"]]
    )

    # One entity's file, which a person tagged as covering every system, is that entity's.
    reconciliation = _filed(migrated, client, team, uk, "uk-reconciliation.csv")
    assert reconciliation in _control_files(migrated, uk[0])
    assert reconciliation not in _control_files(migrated, us[0])
    assert reconciliation not in _item_files(migrated, us[1])

    # Within one scope nothing changed: a policy a person tags for every system serves
    # the same item of the control's other systems, and its family.
    policy = _filed(migrated, client, team, sap, "access-policy.csv")
    assert policy in _item_files(migrated, ad[1])
    assert policy in _control_files(migrated, ad[0])
    # And what never served still does not: a tag only the agent gave, or one naming
    # another system.
    guessed = _filed(migrated, client, team, sap, "guessed-policy.csv", by="AGENT")
    assert guessed not in _item_files(migrated, ad[1])
    own = _filed(migrated, client, team, sap, "sap-only.csv", scope="ONE")
    assert own not in _item_files(migrated, ad[1])
    assert own not in _control_files(migrated, ad[0])


# What existed stays as it was


def test_existing_controls_keep_their_identity_and_one_row_per_implementation(
    migrated: Database,
) -> None:
    team, _client = _engagement(migrated, "shared-keep", ["AWS IAM"])
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT id, control_ref, engagement_application_id, implementation_key, "
            "organization_id, library_key FROM engagement_controls WHERE project_id = %s",
            (team["project"],),
        ).fetchall()
        # Every row's key is its system, or nothing.
        assert all(row[3] == ("" if row[2] is None else str(row[2])) for row in rows)
        system = next(row for row in rows if row[2] is not None)
        # Still one row per control and system: a copy of a row is refused.
        connection.execute(
            "CREATE TEMP TABLE duplicate AS SELECT * FROM engagement_controls WHERE id = %s",
            (system[0],),
        )
        connection.execute("UPDATE duplicate SET id = uuidv7()")
        with pytest.raises(psycopg.errors.UniqueViolation):
            connection.execute("INSERT INTO engagement_controls SELECT * FROM duplicate")
    with connect(migrated.url) as connection:
        # Management review joins the classifications, which overlap.
        connection.execute(
            "UPDATE engagement_controls SET classifications = "
            "ARRAY['MANAGEMENT_REVIEW', 'IT_DEPENDENT_MANUAL', 'BUSINESS_PROCESS'] "
            "WHERE id = %s",
            (UUID(str(rows[0][0])),),
        )
