"""Policies and procedures that govern systems and processes (decided by the product owner on
25 October 2026, migration 0112). A document uploaded once governs any number of the
engagement's systems and processes; every control under them can cite it, unless a person
takes it off one control."""

from typing import Any
from uuid import UUID

from support import Database
from test_engagement_close import _launched
from test_execution import _ready
from test_outbound import migrated
from test_testing_engine import _base as _project_base

from ai_workforce_api.control_context import documents, linked_documents
from ai_workforce_api.db import connect

__all__ = ["migrated"]

POLICY = (
    b"Access Management Policy\n"
    b"Access to financially significant systems is granted only on an approved request.\n"
    b"Access is reviewed quarterly by the system owner.\n"
)


def _ids(database: Database, project: UUID) -> dict[str, Any]:
    with connect(database.url) as connection:
        system = connection.execute(
            "SELECT id FROM engagement_applications WHERE project_id = %s AND name = 'SAP ERP'",
            (project,),
        ).fetchone()
        controls = connection.execute(
            "SELECT id, engagement_application_id FROM engagement_controls "
            "WHERE project_id = %s AND included ORDER BY control_ref",
            (project,),
        ).fetchall()
    assert system is not None and controls
    under = [UUID(str(row[0])) for row in controls if row[1] == system[0]]
    other = [UUID(str(row[0])) for row in controls if row[1] != system[0]]
    return {"system": UUID(str(system[0])), "under": under, "other": other}


def _upload(team: dict[str, Any], **query: Any) -> Any:
    base = _project_base(team)
    return team["owner"].post(
        f"{base}/policies/upload",
        params={"kind": "POLICY", "title": "Access Management Policy",
                "file_name": "access-policy.txt", **query},
        content=POLICY,
        headers={"content-type": "text/plain"},
    )  # fmt: skip


def test_a_policy_governs_every_control_under_its_system(migrated: Database) -> None:
    team = _launched(migrated, "policy-system")
    ids = _ids(migrated, team["project"])
    uploaded = _upload(team, system_id=[str(ids["system"])])
    assert uploaded.status_code == 200, uploaded.text
    policy = uploaded.json()["policy"]
    assert policy["kind"] == "POLICY" and policy["system_ids"] == [str(ids["system"])]
    assert policy["controls"] == len(ids["under"]) and policy["excluded"] == 0
    document_id = UUID(policy["id"])
    with connect(migrated.url) as connection:
        for control_id in ids["under"]:
            assert document_id in {
                UUID(item.key) for item in linked_documents(connection, team["project"],
                                                            control_id)
            }  # fmt: skip
            listed = documents(connection, team["project"], control_id)
            mine = next(item for item in listed if item.id == document_id)
            # It applies through the system, not a link of the control's own.
            assert mine.inherited and mine.control_ids == []
        for control_id in ids["other"]:
            assert document_id not in {
                UUID(item.key) for item in linked_documents(connection, team["project"],
                                                            control_id)
            }  # fmt: skip
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'document.uploaded' "
            "AND target_id = %s",
            (document_id,),
        ).fetchone()
    assert audit is not None and audit[0]["systems"] == 1
    listed = team["owner"].get(f"{_project_base(team)}/policies").json()
    assert [item["id"] for item in listed] == [str(document_id)]


def test_a_policy_governs_the_controls_of_a_process(migrated: Database) -> None:
    team = _launched(migrated, "policy-process")
    ids = _ids(migrated, team["project"])
    with connect(migrated.url) as connection:
        process = connection.execute(
            "INSERT INTO engagement_processes (organization_id, project_id, name, domain) "
            "VALUES (%s, %s, 'Procure to pay', 'PROCURE_TO_PAY') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        assert process is not None
        connection.execute(
            "UPDATE engagement_controls SET process_id = %s WHERE id = %s",
            (process[0], ids["under"][0]),
        )
        connection.commit()
    uploaded = _upload(team, process_id=[str(process[0])])
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["policy"]["controls"] == 1
    document_id = UUID(uploaded.json()["policy"]["id"])
    with connect(migrated.url) as connection:
        keys = {
            UUID(item.key)
            for item in linked_documents(connection, team["project"], ids["under"][0])
        }
        others = {
            UUID(item.key)
            for item in linked_documents(connection, team["project"], ids["under"][1])
        }
    assert document_id in keys and document_id not in others


def test_a_person_takes_a_policy_off_one_control_and_back(migrated: Database) -> None:
    team = _launched(migrated, "policy-exclude")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    document_id = _upload(team, system_id=[str(ids["system"])]).json()["policy"]["id"]
    target = ids["under"][0]
    off = team["owner"].post(
        f"{base}/source-documents/{document_id}/unlink", json={"control_id": str(target)}
    )
    assert off.status_code == 200, off.text
    with connect(migrated.url) as connection:
        assert UUID(document_id) not in {
            UUID(item.key) for item in linked_documents(connection, team["project"], target)
        }
    policy = team["owner"].get(f"{base}/policies").json()[0]
    assert policy["excluded"] == 1 and policy["controls"] == len(ids["under"]) - 1
    back = team["owner"].post(
        f"{base}/source-documents/{document_id}/links", json={"control_ids": [str(target)]}
    )
    assert back.status_code == 200, back.text
    policy = team["owner"].get(f"{base}/policies").json()[0]
    assert policy["excluded"] == 0 and policy["controls"] == len(ids["under"])


def test_what_a_policy_governs_is_checked_and_can_change(migrated: Database) -> None:
    team = _launched(migrated, "policy-scope")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    # It must govern something, and only the engagement's own systems.
    assert _upload(team).status_code == 409
    _other, other_project, _stranger = _ready(migrated, "policy-scope-other")
    with connect(migrated.url) as connection:
        foreign = connection.execute(
            "SELECT id FROM engagement_applications WHERE project_id = %s LIMIT 1",
            (other_project,),
        ).fetchone()
        stored = connection.execute(
            "SELECT count(*) FROM source_documents WHERE project_id = %s", (team["project"],)
        ).fetchone()
    assert stored == (0,)
    if foreign is not None:
        assert _upload(team, system_id=[str(foreign[0])]).status_code == 422
    document_id = _upload(team, system_id=[str(ids["system"])]).json()["policy"]["id"]
    empty = team["owner"].put(
        f"{base}/policies/{document_id}/scope", json={"system_ids": [], "process_ids": []}
    )
    assert empty.status_code == 409
    with connect(migrated.url) as connection:
        process = connection.execute(
            "INSERT INTO engagement_processes (organization_id, project_id, name, domain) "
            "VALUES (%s, %s, 'Record to report', 'RECORD_TO_REPORT') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        connection.commit()
    assert process is not None
    moved = team["owner"].put(
        f"{base}/policies/{document_id}/scope",
        json={"system_ids": [], "process_ids": [str(process[0])]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["system_ids"] == [] and moved.json()["controls"] == 0
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'document.scoped' AND target_id = %s",
            (UUID(document_id),),
        ).fetchone()
    assert audit == (1,)


def test_only_the_engagement_reads_and_changes_its_policies(migrated: Database) -> None:
    team = _launched(migrated, "policy-access")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    document_id = _upload(team, system_id=[str(ids["system"])]).json()["policy"]["id"]
    _other, _project, stranger = _ready(migrated, "policy-stranger")
    assert stranger.get(f"{base}/policies").status_code == 404
    assert (
        stranger.put(
            f"{base}/policies/{document_id}/scope", json={"system_ids": [str(ids["system"])]}
        ).status_code
        == 404
    )
    refused = stranger.post(
        f"{base}/policies/upload", params={"system_id": [str(ids["system"])]}, content=POLICY
    )
    assert refused.status_code == 404


def test_an_unreadable_file_is_not_kept(migrated: Database) -> None:
    team = _launched(migrated, "policy-unreadable")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    answer = team["owner"].post(
        f"{base}/policies/upload",
        params={"file_name": "policy.exe", "system_id": [str(ids["system"])]},
        content=b"MZ\x00\x01binary",
        headers={"content-type": "application/octet-stream"},
    )
    assert answer.status_code == 200 and answer.json()["readable"] is False
    assert team["owner"].get(f"{base}/policies").json() == []


# Removed and replaced (decided by the product owner on 25 October 2026, migration 0113).


def test_a_removed_policy_applies_to_nothing_and_stays_on_record(migrated: Database) -> None:
    team = _launched(migrated, "policy-remove")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    document_id = _upload(team, system_id=[str(ids["system"])]).json()["policy"]["id"]
    removed = team["owner"].post(f"{base}/policies/{document_id}/remove")
    assert removed.status_code == 200, removed.text
    assert removed.json() == []
    with connect(migrated.url) as connection:
        for control_id in ids["under"]:
            assert UUID(document_id) not in {
                UUID(item.key) for item in linked_documents(connection, team["project"], control_id)
            }
            assert all(
                item.id != UUID(document_id)
                for item in documents(connection, team["project"], control_id)
            )
        kept = connection.execute(
            "SELECT removed_by, char_length(text) > 0 FROM source_documents WHERE id = %s",
            (UUID(document_id),),
        ).fetchone()
        audit = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'document.removed' "
            "AND target_id = %s",
            (UUID(document_id),),
        ).fetchone()
    # Kept on record, with who removed it, and the removal audited.
    assert kept == (team["owner_id"], True) and audit == (1,)
    # A removed document cannot be removed, scoped, or linked again.
    assert team["owner"].post(f"{base}/policies/{document_id}/remove").status_code == 404
    assert (
        team["owner"]
        .put(f"{base}/policies/{document_id}/scope", json={"system_ids": [str(ids["system"])]})
        .status_code
        == 404
    )
    assert (
        team["owner"]
        .post(
            f"{base}/source-documents/{document_id}/links",
            json={"control_ids": [str(ids["under"][0])]},
        )
        .status_code
        == 404
    )


def test_a_replacement_takes_over_what_the_old_version_governed(migrated: Database) -> None:
    team = _launched(migrated, "policy-replace")
    ids = _ids(migrated, team["project"])
    base = _project_base(team)
    old_id = _upload(team, system_id=[str(ids["system"])]).json()["policy"]["id"]
    taken_off = ids["under"][0]
    team["owner"].post(
        f"{base}/source-documents/{old_id}/unlink", json={"control_id": str(taken_off)}
    )
    replaced = team["owner"].post(
        f"{base}/policies/{old_id}/replace",
        params={"file_name": "access-policy-v2.txt"},
        content=POLICY + b"Version 2: access is reviewed monthly.\n",
        headers={"content-type": "text/plain"},
    )
    assert replaced.status_code == 200, replaced.text
    new = replaced.json()["policy"]
    # The same title, what it governs, and the control taken off stays off.
    assert new["title"] == "Access Management Policy" and new["id"] != old_id
    assert new["system_ids"] == [str(ids["system"])] and new["excluded"] == 1
    listed = team["owner"].get(f"{base}/policies").json()
    assert [item["id"] for item in listed] == [new["id"]]
    with connect(migrated.url) as connection:
        cited = {
            UUID(item.key)
            for item in linked_documents(connection, team["project"], ids["under"][1])
        }
        off = {UUID(item.key) for item in linked_documents(connection, team["project"], taken_off)}
        old = connection.execute(
            "SELECT removed_at IS NOT NULL, replaced_by FROM source_documents WHERE id = %s",
            (UUID(old_id),),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'document.replaced' "
            "AND target_id = %s",
            (UUID(new["id"]),),
        ).fetchone()
    assert UUID(new["id"]) in cited and UUID(old_id) not in cited
    assert UUID(new["id"]) not in off
    assert old == (True, UUID(new["id"]))
    assert audit is not None and audit[0]["previous"] == old_id
    # The old version can no longer be replaced.
    again = team["owner"].post(
        f"{base}/policies/{old_id}/replace", content=POLICY, headers={"content-type": "text/plain"}
    )
    assert again.status_code == 404


# Process narratives and flow diagrams, on the References tab (decided by the product owner
# on 26 October 2026): linked to the processes and systems they describe, like a policy.


def test_a_narrative_describes_the_controls_of_its_process(migrated: Database) -> None:
    team = _launched(migrated, "narrative-process")
    ids = _ids(migrated, team["project"])
    with connect(migrated.url) as connection:
        process = connection.execute(
            "INSERT INTO engagement_processes (organization_id, project_id, name, domain) "
            "VALUES (%s, %s, 'Procure to pay', 'PROCURE_TO_PAY') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        assert process is not None
        connection.execute(
            "UPDATE engagement_controls SET process_id = %s WHERE id = %s",
            (process[0], ids["under"][0]),
        )
        connection.commit()
    uploaded = team["owner"].post(
        f"{_project_base(team)}/policies/upload",
        params={
            "kind": "NARRATIVE",
            "title": "Procure to pay narrative",
            "file_name": "p2p-narrative.txt",
            "process_id": [str(process[0])],
        },
        content=b"Purchase orders are raised in the ERP and approved by the buyer's manager.\n",
        headers={"content-type": "text/plain"},
    )
    assert uploaded.status_code == 200, uploaded.text
    narrative = uploaded.json()["policy"]
    assert narrative["kind"] == "NARRATIVE" and narrative["controls"] == 1
    with connect(migrated.url) as connection:
        sources = {
            (item.kind, UUID(item.key))
            for item in linked_documents(connection, team["project"], ids["under"][0])
        }
    assert ("NARRATIVE", UUID(narrative["id"])) in sources
    listed = team["owner"].get(f"{_project_base(team)}/policies").json()
    assert [item["kind"] for item in listed] == ["NARRATIVE"]


def test_a_diagram_image_is_read_by_ocr_or_asked_for_as_a_pdf(migrated: Database) -> None:
    from ai_workforce_api.evidence_ocr import local_ocr_available
    from ai_workforce_api.settings import Settings

    team = _launched(migrated, "diagram-image")
    ids = _ids(migrated, team["project"])
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00"
        b"\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
        b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    answer = team["owner"].post(
        f"{_project_base(team)}/policies/upload",
        params={
            "kind": "FLOWCHART",
            "title": "Access flow",
            "file_name": "access-flow.png",
            "system_id": [str(ids["system"])],
        },
        content=png,
        headers={"content-type": "image/png"},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    if not local_ocr_available(Settings(database_url=migrated.url)):
        # No OCR engine and the firm keeps images in: nothing kept, and the way forward said.
        assert body["readable"] is False and "PDF" in body["note"]
        assert team["owner"].get(f"{_project_base(team)}/policies").json() == []
    else:
        # A blank image yields no text: still not kept, with the same advice.
        assert body["readable"] is False
