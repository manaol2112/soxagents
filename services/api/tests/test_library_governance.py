"""The standard library as a knowledge base, and its governance (standard library, L1)."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_execution import _add_user
from test_outbound import _session, _team, migrated

from ai_workforce_api.controls import LIBRARY, LIBRARY_VERSION
from ai_workforce_api.db import connect, transaction
from ai_workforce_api.definition_registry import DEFINITIONS
from ai_workforce_api.library_governance import category_for, effective_status

__all__ = ["migrated"]


def test_every_standard_control_reads_as_pending_review_until_a_reviewer_decides() -> None:
    assert effective_status(None, None) == "PENDING_REVIEW"
    assert effective_status("APPROVED", LIBRARY_VERSION) == "APPROVED"
    # An approval of an earlier library version is superseded once the library moves on.
    assert effective_status("APPROVED", LIBRARY_VERSION - 1) == "SUPERSEDED"
    assert effective_status("RETIRED", None) == "RETIRED"
    assert effective_status("DRAFT", None) == "DRAFT"


def test_the_library_sorts_into_the_five_categories() -> None:
    assert category_for("ACCESS") == "ITGC"
    assert category_for("CHANGE") == "ITGC"
    assert category_for("ITAC") == "ITAC"
    assert category_for("IPE") == "KEY_REPORT"
    assert category_for("ENTITY") == "ENTITY"
    assert category_for("RECORD_TO_REPORT") == "BUSINESS"
    # Every standard control has a definition to show.
    assert {control.key for control in LIBRARY} == {item.library_key for item in DEFINITIONS}


def _library(seeded: dict[str, Any]) -> str:
    return f"/organizations/{seeded['organization_id']}/library"


def test_the_library_lists_every_standard_control_with_its_status_and_use(
    migrated: Database,
) -> None:
    seeded, project_id, owner, _admin = _team(migrated, "library")
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO engagement_controls (
                organization_id, project_id, library_key, library_version, control_ref, domain,
                title, risk, activity, frequency, nature, test_attributes, pbc_items, agent_key,
                template_key
            )
            VALUES (%s, %s, 'access-provisioning', %s, 'ITGC-AC-01', 'ACCESS', 'New user access',
                    'r', 'a', 'EVENT_DRIVEN', 'MANUAL', '[]', '[]', 'itgc-access', 'itgc')
            """,
            (seeded["organization_id"], project_id, LIBRARY_VERSION),
        )
        connection.commit()
    listed = owner.get(_library(seeded))
    assert listed.status_code == 200
    body = listed.json()
    assert body["library_version"] == LIBRARY_VERSION
    assert len(body["entries"]) == len(LIBRARY)
    assert sum(item["entries"] for item in body["categories"]) == len(LIBRARY)
    assert body["counts"] == {"PENDING_REVIEW": len(LIBRARY)}
    row = next(item for item in body["entries"] if item["library_key"] == "access-provisioning")
    assert row["category"] == "ITGC"
    assert row["status"] == "PENDING_REVIEW"
    # Version 4: the provisioning standard has seven stepped procedures and five tested
    # attributes.
    assert row["procedures"] == 7 and row["attributes_tested"] == 5
    assert row["usage_engagements"] == 1 and row["usage_controls"] == 1

    entry = owner.get(f"{_library(seeded)}/access-provisioning")
    assert entry.status_code == 200
    detail = entry.json()
    # Version 4: two design procedures, four operating, one roll-forward, each as steps.
    assert [item["phase"] for item in detail["procedures"]] == (
        ["DESIGN"] * 2 + ["OPERATING"] * 4 + ["ROLLFORWARD"]
    )
    assert all(item["steps"] for item in detail["procedures"])
    assert all(item["tested"] for item in detail["attributes"])
    assert detail["statement"] is not None
    # Client values read as their labels until an engagement fills them.
    assert "[" in detail["statement"]["text"]
    assert detail["sources"] and detail["sources"][0]["says"]
    assert detail["usage"][0]["controls"] == 1
    assert detail["governance"]["can_decide"] is True
    assert owner.get(f"{_library(seeded)}/no-such-control").status_code == 404


def test_an_owner_approves_an_entry_and_a_contributor_can_only_read(
    migrated: Database,
) -> None:
    seeded, _project_id, owner, admin = _team(migrated, "library-decide")
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection,
            seeded["organization_id"],
            f"reader-{uuid4().hex[:6]}@example.com",
            "CONTRIBUTOR",
        )
    contributor = _session(migrated, contributor_id)
    path = f"{_library(seeded)}/change-approval/status"

    refused = contributor.put(path, json={"status": "APPROVED"})
    assert refused.status_code == 403
    read = contributor.get(f"{_library(seeded)}/change-approval")
    assert read.status_code == 200
    assert read.json()["governance"]["can_decide"] is False

    approved = admin.put(path, json={"status": "APPROVED", "note": "Reviewed against the handbook"})
    assert approved.status_code == 200
    governance = approved.json()
    assert governance["status"] == "APPROVED"
    assert governance["approved_version"] == LIBRARY_VERSION
    assert governance["approved_by"] is not None
    assert governance["note"] == "Reviewed against the handbook"
    # The same decision twice is refused, so a decision is never silently overwritten.
    assert admin.put(path, json={"status": "APPROVED"}).status_code == 409

    retired = owner.put(path, json={"status": "RETIRED", "note": "Replaced by the split"})
    assert retired.status_code == 200
    assert retired.json()["status"] == "RETIRED"
    # The last approval is kept with the entry.
    assert retired.json()["approved_version"] == LIBRARY_VERSION

    listed = owner.get(_library(seeded)).json()
    assert listed["counts"]["RETIRED"] == 1
    with connect(migrated.url) as connection:
        events = connection.execute(
            """
            SELECT payload->>'from', payload->>'to' FROM audit_events
            WHERE organization_id = %s AND action = 'library.status' ORDER BY occurred_at
            """,
            (seeded["organization_id"],),
        ).fetchall()
    assert events == [("PENDING_REVIEW", "APPROVED"), ("APPROVED", "RETIRED")]


def test_anyone_submits_a_change_and_an_owner_decides_it_without_editing_the_library(
    migrated: Database,
) -> None:
    seeded, _project_id, owner, _admin = _team(migrated, "library-change")
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection,
            seeded["organization_id"],
            f"prop-{uuid4().hex[:6]}@example.com",
            "CONTRIBUTOR",
        )
    contributor = _session(migrated, contributor_id)
    requests = f"{_library(seeded)}/change-requests"

    too_short = contributor.post(
        requests,
        json={"library_key": "access-review", "kind": "CHANGE", "title": "Add", "detail": "x"},
    )
    assert too_short.status_code == 422
    unknown = contributor.post(
        requests,
        json={
            "library_key": "not-a-control",
            "kind": "CHANGE",
            "title": "Something",
            "detail": "A change to a control the library does not have.",
        },
    )
    assert unknown.status_code == 409
    submitted = contributor.post(
        requests,
        json={
            "library_key": "access-review",
            "kind": "CHANGE",
            "title": "Review the service accounts too",
            "detail": "The quarterly review should cover service accounts, which the client's "
            "policy includes in the privileged population.",
        },
    )
    assert submitted.status_code == 201
    request_id = UUID(submitted.json()["id"])
    proposed_new = contributor.post(
        requests,
        json={
            "kind": "NEW",
            "title": "Firefighter access",
            "detail": "Emergency access granted for one incident and removed after it, "
            "with the activity reviewed by someone else.",
        },
    )
    assert proposed_new.status_code == 201

    entry = owner.get(f"{_library(seeded)}/access-review").json()
    assert entry["row"]["open_requests"] == 1
    assert entry["change_requests"][0]["status"] == "OPEN"
    assert entry["change_requests"][0]["submitted_by"].startswith("prop-")
    index = owner.get(_library(seeded)).json()
    assert [item["kind"] for item in index["new_requests"]] == ["NEW"]

    # A contributor cannot decide; an owner can, once.
    assert (
        contributor.put(f"{requests}/{request_id}", json={"decision": "ACCEPTED"}).status_code
        == 403
    )
    decided = owner.put(
        f"{requests}/{request_id}",
        json={"decision": "ACCEPTED", "note": "For library version 4"},
    )
    assert decided.status_code == 200
    assert owner.put(f"{requests}/{request_id}", json={"decision": "DECLINED"}).status_code == 409
    after = owner.get(f"{_library(seeded)}/access-review").json()
    assert after["change_requests"][0]["status"] == "ACCEPTED"
    assert after["change_requests"][0]["decision_note"] == "For library version 4"
    # Accepting a change edits nothing: the definition is the code's.
    definition = next(item for item in DEFINITIONS if item.library_key == "access-review")
    assert after["row"]["attributes_tested"] == len(definition.approved)
    assert after["row"]["open_requests"] == 0


def test_an_approval_is_superseded_by_the_entrys_own_definition_version(
    migrated: Database,
) -> None:
    """Each definition carries its version: the IT general controls are version 4 (steps
    and an evidence suite), the others still 3. An approval at version 3 stands for a
    version 3 definition and reads as superseded for a version 4 one. The entry shows its
    version, its steps, and its suite."""
    seeded, _project_id, owner, _admin = _team(migrated, "library-versions")
    leaver = owner.get(f"{_library(seeded)}/access-termination").json()
    assert leaver["definition_version"] == 4
    assert leaver["evidence_suite"] and leaver["evidence_suite"][0]["key"] == "ac02-e1"
    design = next(item for item in leaver["procedures"] if item["key"] == "d-1")
    assert len(design["steps"]) >= 2 and design["steps"][0]["evidence"] == ["ac02-e1"]
    assert all(item["evidence_keys"] for item in leaver["attributes"])
    memo = owner.get(f"{_library(seeded)}/otc-credit-memos").json()
    assert memo["definition_version"] == 3 and memo["evidence_suite"] == []
    assert all(item["steps"] == [] for item in memo["procedures"])

    for key in ("access-termination", "otc-credit-memos"):
        approved = owner.put(
            f"{_library(seeded)}/{key}/status", json={"status": "APPROVED", "note": "Reviewed"}
        )
        assert approved.status_code == 200 and approved.json()["status"] == "APPROVED"
    # As a firm that approved library version 3 before the IT general controls were rewritten.
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute(
            "UPDATE library_entries SET approved_version = 3 WHERE organization_id = %s",
            (seeded["organization_id"],),
        )
    leaver = owner.get(f"{_library(seeded)}/access-termination").json()
    memo = owner.get(f"{_library(seeded)}/otc-credit-memos").json()
    assert leaver["governance"]["status"] == "SUPERSEDED"
    assert memo["governance"]["status"] == "APPROVED"
    listed = owner.get(_library(seeded)).json()
    statuses = {item["library_key"]: item["status"] for item in listed["entries"]}
    assert statuses["access-termination"] == "SUPERSEDED"
    assert statuses["otc-credit-memos"] == "APPROVED"
    assert listed["library_version"] == LIBRARY_VERSION == 4


def test_an_owner_approves_a_selection_at_once_each_recorded_on_its_own(
    migrated: Database,
) -> None:
    seeded, _project_id, owner, admin = _team(migrated, "library-bulk")
    with connect(migrated.url) as connection:
        contributor_id = _add_user(
            connection,
            seeded["organization_id"],
            f"bulk-{uuid4().hex[:6]}@example.com",
            "CONTRIBUTOR",
        )
    path = f"{_library(seeded)}/status"
    keys = ["access-provisioning", "access-termination", "change-approval"]
    refused = _session(migrated, contributor_id).put(
        path, json={"library_keys": keys, "status": "APPROVED"}
    )
    assert refused.status_code == 403
    # One already approved is skipped, not refused; the rest are approved.
    assert (
        admin.put(
            f"{_library(seeded)}/change-approval/status", json={"status": "APPROVED"}
        ).status_code
        == 200
    )
    approved = owner.put(
        path, json={"library_keys": keys, "status": "APPROVED", "note": "Batch review"}
    )
    assert approved.status_code == 200, approved.text
    assert approved.json() == {
        "decided": ["access-provisioning", "access-termination"],
        "skipped": ["change-approval"],
    }
    listed = {e["library_key"]: e["status"] for e in owner.get(_library(seeded)).json()["entries"]}
    assert all(listed[key] == "APPROVED" for key in keys)
    entry = owner.get(f"{_library(seeded)}/access-termination").json()["governance"]
    assert entry["note"] == "Batch review" and entry["approved_by"] is not None
    with connect(migrated.url) as connection:
        events = connection.execute(
            "SELECT payload->>'library_key' FROM audit_events WHERE organization_id = %s "
            "AND action = 'library.status' ORDER BY occurred_at",
            (seeded["organization_id"],),
        ).fetchall()
    assert [key for (key,) in events] == ["change-approval", *keys[:2]]
    # All or none: a key not in the library leaves every entry as it was.
    unknown = owner.put(
        path,
        json={"library_keys": ["access-review", "not-a-standard"], "status": "APPROVED"},
    )
    assert unknown.status_code == 409 and "not-a-standard" in unknown.json()["detail"]
    after = {e["library_key"]: e["status"] for e in owner.get(_library(seeded)).json()["entries"]}
    assert after["access-review"] == "PENDING_REVIEW"
    assert owner.put(path, json={"library_keys": [], "status": "APPROVED"}).status_code == 422
