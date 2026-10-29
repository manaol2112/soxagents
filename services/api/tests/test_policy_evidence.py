"""A policy or procedure on file, proposed as evidence for a request's item (decided by the
product owner on 28 October 2026, migration 0125). The agent proposes a document only for an
item it fits, quoting it; a person accepts, which files the original on the item as a
person's upload would, or dismisses it. A document uploaded before its file was kept is
replaced first."""

from typing import Any
from uuid import UUID

from support import Database
from test_evidence_center import _ready
from test_evidence_flow import _project
from test_onboarding import _new_engagement
from test_outbound import migrated
from test_system_applicability import _Scripted

from ai_workforce_api.db import connect
from ai_workforce_api.policy_evidence import (
    SYSTEM,
    effective_of,
    open_runs,
    run_policy_evidence,
    unread_pairs,
)

__all__ = ["migrated"]

ACCESS = (
    "IT Access Management Standard v4.2\n"
    "Version 4.2 - effective 1 October 2024 - next review October 2026\n"
    "Section 3. Access approval. Access to a financially significant system is granted only "
    "after the Application Owner approves the request in ServiceNow.\n"
    "The System Administrator checks the approval before granting access.\n"
)
CHANGE = (
    "IT Change Management Standard v3.1\n"
    "Every change to production is approved by the Change Advisory Board before deployment.\n"
)


def _item(database: Database, project: UUID) -> dict[str, Any]:
    """An open item of a request that asks for a document of the process."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT q.id, q.engagement_control_id, q.pbc_request_id, c.engagement_application_id
            FROM evidence_requirements q
            JOIN engagement_controls c ON c.id = q.engagement_control_id
            WHERE q.project_id = %s AND q.status = 'REQUESTED' AND q.pbc_request_id IS NOT NULL
              AND 'PROCESS_DOCUMENTATION' = ANY(q.categories)
              AND c.engagement_application_id IS NOT NULL
            ORDER BY c.control_ref, q.created_at LIMIT 1
            """,
            (project,),
        ).fetchone()
    assert row is not None, "the engagement asks for a policy somewhere"
    return {"id": UUID(str(row[0])), "control": UUID(str(row[1])),
            "request": UUID(str(row[2])), "system": UUID(str(row[3]))}  # fmt: skip


def _upload(team: dict[str, Any], title: str, text: str, system: UUID) -> str:
    answer = team["owner"].post(
        f"{_project(team)}/policies/upload",
        params={"kind": "POLICY", "title": title, "file_name": f"{title}.txt",
                "system_id": [str(system)]},
        content=text.encode(),
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert answer.status_code == 200, answer.text
    return str(answer.json()["policy"]["id"])


def _verdicts(answers: list[tuple[str, bool, str, str]]) -> dict[str, Any]:
    return {
        "documents": [
            {"document": key, "fits": fits, "reason": reason, "quote": quote}
            for key, fits, reason, quote in answers
        ]
    }


def _run(database: Database, project: UUID, provider: Any) -> str:
    with connect(database.url) as connection:
        return run_policy_evidence(connection, provider, project)


def _read(team: dict[str, Any], control: UUID) -> dict[str, Any]:
    answer = team["owner"].get(f"{_project(team)}/controls/{control}/policy-evidence")
    assert answer.status_code == 200, answer.text
    body: dict[str, Any] = answer.json()
    return body


def _filed(database: Database, item: UUID) -> list[tuple[str, str, str]]:
    with connect(database.url) as connection:
        return [
            (str(r[0]), str(r[1]), str(r[2]))
            for r in connection.execute(
                "SELECT f.file_name, m.filed_by, m.status FROM evidence_matches m "
                "JOIN evidence_files f ON f.id = m.evidence_file_id WHERE m.requirement_id = %s",
                (item,),
            ).fetchall()
        ]


def test_the_agent_proposes_only_the_policy_that_fits_and_a_person_files_it(
    migrated: Database,
) -> None:
    team = _ready(migrated, "pe-fit")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    change = _upload(team, "IT Change Management Standard v3.1", CHANGE, item["system"])
    with connect(migrated.url) as connection:
        # Each upload asked the agent to read; the original file is kept with the text.
        assert team["project"] in open_runs(connection)
        kept = connection.execute(
            "SELECT object_key, content_type, size_bytes FROM source_documents WHERE id = %s",
            (UUID(access),),
        ).fetchone()
        pairs = unread_pairs(connection, team["project"], item["control"])
    assert kept is not None and str(kept[0]).startswith("documents/")
    assert kept[1] == "text/plain" and kept[2] == len(ACCESS.encode())
    assert (item["id"], UUID(access)) in pairs and (item["id"], UUID(change)) in pairs

    # The agent reads both for the item: the access standard fits, quoted; the change
    # standard does not. A fit it cannot quote from the document is not proposed.
    model = _Scripted([
        _verdicts([
            ("D1", True, "It sets that the Application Owner approves access before it is "
             "granted.", "granted only after the Application Owner approves the request"),
            ("D2", False, "It covers changes to production, not access approval.", ""),
        ])
    ] * 20)  # fmt: skip
    assert _run(migrated, team["project"], model) == "DONE"
    assert model.requests and model.requests[0].system == SYSTEM
    assert "IT Access Management Standard v4.2" in model.requests[0].prompt
    body = _read(team, item["control"])
    mine = [p for p in body["proposals"] if p["requirement_id"] == str(item["id"])]
    assert [p["document_id"] for p in mine] == [access]
    assert mine[0]["usable"] is True and mine[0]["document_title"].startswith("IT Access")
    assert mine[0]["effective"] == "1 Oct 2024"
    assert mine[0]["quote"] == "granted only after the Application Owner approves the request"
    assert "Application Owner" in mine[0]["reason"]
    with connect(migrated.url) as connection:
        # Read once: the same pairs are not read again.
        assert unread_pairs(connection, team["project"], item["control"]) == []

    # Accepted: the original is filed on the item, as a person's upload.
    accepted = team["owner"].post(f"{_project(team)}/policy-evidence/{mine[0]['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    assert _filed(migrated, item["id"]) == [
        ("IT Access Management Standard v4.2.txt", "PERSON", "FILED")
    ]
    with connect(migrated.url) as connection:
        decided = connection.execute(
            "SELECT status, evidence_file_id IS NOT NULL, decided_by FROM "
            "policy_evidence_proposals WHERE id = %s",
            (UUID(mine[0]["id"]),),
        ).fetchone()
        audit = connection.execute(
            "SELECT count(*) FROM audit_events WHERE action = 'policy_evidence.accepted' "
            "AND target_id = %s",
            (UUID(mine[0]["id"]),),
        ).fetchone()
    assert decided is not None and decided[0] == "ACCEPTED" and decided[1] is True
    assert decided[2] is not None and audit == (1,)
    # Decided once; the item has its evidence, so nothing more is proposed for it.
    again = team["owner"].post(f"{_project(team)}/policy-evidence/{mine[0]['id']}/accept")
    assert again.status_code == 409
    assert not [p for p in _read(team, item["control"])["proposals"]
                if p["requirement_id"] == str(item["id"])]  # fmt: skip


def test_a_dismissed_proposal_stays_dismissed_and_others_cannot_decide(
    migrated: Database,
) -> None:
    team = _ready(migrated, "pe-dismiss")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    model = _Scripted([
        _verdicts([("D1", True, "It sets who approves access.",
                    "granted only after the Application Owner approves the request")])
    ] * 20)  # fmt: skip
    _run(migrated, team["project"], model)
    proposal = next(p for p in _read(team, item["control"])["proposals"]
                    if p["requirement_id"] == str(item["id"]))  # fmt: skip
    assert proposal["document_id"] == access
    # Someone outside the engagement sees nothing of it.
    other = _new_engagement(migrated, "pe-outsider")
    stranger = other["owner"].post(f"{_project(team)}/policy-evidence/{proposal['id']}/dismiss")
    assert stranger.status_code == 404
    dismissed = team["owner"].post(f"{_project(team)}/policy-evidence/{proposal['id']}/dismiss")
    assert dismissed.status_code == 200, dismissed.text
    assert proposal["id"] not in {p["id"] for p in _read(team, item["control"])["proposals"]}
    assert _filed(migrated, item["id"]) == []
    with connect(migrated.url) as connection:
        assert (item["id"], UUID(access)) not in unread_pairs(
            connection, team["project"], item["control"]
        )


def test_a_policy_taken_off_the_control_is_never_read_for_it(migrated: Database) -> None:
    team = _ready(migrated, "pe-scope")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    with connect(migrated.url) as connection:
        assert (item["id"], UUID(access)) in unread_pairs(
            connection, team["project"], item["control"]
        )
        # A person took it off this control: it no longer applies (0112), so it is not read
        # for the control's items, nor shown for them.
        connection.execute(
            "INSERT INTO source_document_exclusions (document_id, engagement_control_id, "
            "project_id) VALUES (%s, %s, %s)",
            (UUID(access), item["control"], team["project"]),
        )
        assert all(
            document != UUID(access)
            for _, document in unread_pairs(connection, team["project"], item["control"])
        )


def test_an_unquoted_fit_is_not_proposed_and_without_a_model_nothing_is_read(
    migrated: Database,
) -> None:
    team = _ready(migrated, "pe-quote")
    item = _item(migrated, team["project"])
    _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    # No model: the run finishes and reads nothing.
    assert _run(migrated, team["project"], None) == "SKIPPED"
    with connect(migrated.url) as connection:
        assert unread_pairs(connection, team["project"], item["control"])
        connection.execute(
            "UPDATE policy_evidence_runs SET run_status = 'PENDING' WHERE project_id = %s",
            (team["project"],),
        )
    # The model says it fits but quotes words the document does not hold.
    model = _Scripted([
        _verdicts([("D1", True, "It covers access.", "Access is approved by the CEO.")])
    ] * 20)  # fmt: skip
    _run(migrated, team["project"], model)
    assert not [p for p in _read(team, item["control"])["proposals"]
                if p["requirement_id"] == str(item["id"])]  # fmt: skip


def test_a_policy_uploaded_before_its_file_was_kept_is_replaced_first(
    migrated: Database,
) -> None:
    team = _ready(migrated, "pe-legacy")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    with connect(migrated.url) as connection:
        # As one uploaded before migration 0125: the text only.
        connection.execute(
            "UPDATE source_documents SET object_key = NULL, size_bytes = NULL WHERE id = %s",
            (UUID(access),),
        )
    model = _Scripted([
        _verdicts([("D1", True, "It sets who approves access.",
                    "granted only after the Application Owner approves the request")])
    ] * 20)  # fmt: skip
    _run(migrated, team["project"], model)
    proposal = next(p for p in _read(team, item["control"])["proposals"]
                    if p["requirement_id"] == str(item["id"]))  # fmt: skip
    assert proposal["usable"] is False
    refused = team["owner"].post(f"{_project(team)}/policy-evidence/{proposal['id']}/accept")
    assert refused.status_code == 409
    assert "Replace it with its file" in refused.json()["detail"]
    assert _filed(migrated, item["id"]) == []


def test_an_item_whose_file_was_withdrawn_is_read_again(migrated: Database) -> None:
    # Found on the product owner's engagement (28 October 2026): the standard had been
    # added on the item, then withdrawn, and the item was taken as already provided.
    team = _ready(migrated, "pe-withdrawn")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    model = _Scripted([
        _verdicts([("D1", True, "It sets who approves access.",
                    "granted only after the Application Owner approves the request")])
    ] * 20)  # fmt: skip
    _run(migrated, team["project"], model)
    proposal = next(p for p in _read(team, item["control"])["proposals"]
                    if p["requirement_id"] == str(item["id"]))  # fmt: skip
    assert (
        team["owner"].post(f"{_project(team)}/policy-evidence/{proposal['id']}/accept").status_code
        == 200
    )
    with connect(migrated.url) as connection:
        assert (item["id"], UUID(access)) not in unread_pairs(
            connection, team["project"], item["control"]
        )
        connection.execute(
            """
            INSERT INTO evidence_withdrawals (
                organization_id, project_id, evidence_file_id, reason, withdrawn_by
            )
            SELECT m.organization_id, m.project_id, m.evidence_file_id, 'Wrong version.',
                   %s
            FROM evidence_matches m WHERE m.requirement_id = %s AND m.status = 'FILED'
            """,
            (team["owner_id"], item["id"]),
        )
    # The item is open again: a newer document on file is read for it.
    change = _upload(team, "IT Access Management Standard v4.3", ACCESS + "Revised.\n",
                     item["system"])  # fmt: skip
    with connect(migrated.url) as connection:
        assert (item["id"], UUID(change)) in unread_pairs(
            connection, team["project"], item["control"]
        )


def test_the_effective_date_is_read_as_the_document_states_it() -> None:
    assert effective_of("Version 4.2 - effective 1 October 2024 - next review") == "1 Oct 2024"
    assert effective_of("Effective date: October 1, 2024") == "1 Oct 2024"
    assert effective_of("Effective from 15 Sept. 2025") == "15 Sep 2025"
    assert effective_of("Access is effective immediately.") == ""
    assert effective_of("effective 41 Smarch 2024") == ""


def test_the_original_file_opens_from_the_list_and_only_for_the_team(migrated: Database) -> None:
    team = _ready(migrated, "pe-open")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    listed = team["owner"].get(f"{_project(team)}/policies").json()
    mine = next(p for p in listed if p["id"] == access)
    assert mine["file_kept"] is True and mine["file_size"] == len(ACCESS.encode())
    assert mine["file_type"] == "text/plain"
    opened = team["owner"].get(f"{_project(team)}/policies/{access}/file")
    assert opened.status_code == 200, opened.text
    assert opened.content == ACCESS.encode()
    # Not a PDF or an image: downloaded, never shown in the page.
    assert opened.headers["content-disposition"].startswith("attachment;")
    assert opened.headers["x-content-type-options"] == "nosniff"
    other = _new_engagement(migrated, "pe-open-other")
    assert other["owner"].get(f"{_project(team)}/policies/{access}/file").status_code == 404
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE source_documents SET object_key = NULL, size_bytes = NULL WHERE id = %s",
            (UUID(access),),
        )
    # Uploaded before its file was kept: the text only, and no file to open.
    listed = team["owner"].get(f"{_project(team)}/policies").json()
    assert next(p for p in listed if p["id"] == access)["file_kept"] is False
    assert team["owner"].get(f"{_project(team)}/policies/{access}/file").status_code == 404


def _two_items(database: Database, project: UUID) -> list[dict[str, Any]]:
    """Open items of two different controls that ask for a document of the process."""
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT ON (q.engagement_control_id)
                   q.id, q.engagement_control_id, q.pbc_request_id, c.engagement_application_id
            FROM evidence_requirements q
            JOIN engagement_controls c ON c.id = q.engagement_control_id
            WHERE q.project_id = %s AND q.status = 'REQUESTED' AND q.pbc_request_id IS NOT NULL
              AND 'PROCESS_DOCUMENTATION' = ANY(q.categories)
              AND c.engagement_application_id IS NOT NULL
            ORDER BY q.engagement_control_id, q.created_at
            LIMIT 2
            """,
            (project,),
        ).fetchall()
    assert len(rows) == 2, "two controls ask for a policy"
    return [
        {"id": UUID(str(r[0])), "control": UUID(str(r[1])), "request": UUID(str(r[2])),
         "system": UUID(str(r[3]))}
        for r in rows
    ]  # fmt: skip


def test_one_policy_is_filed_for_two_controls(migrated: Database) -> None:
    # Found by the product owner (28 October 2026): the standard filed on one control's item
    # could not be filed on another's ("That did not work"): the upload was taken for the
    # file the first control held, which does not serve another control.
    team = _ready(migrated, "pe-two")
    first, second = _two_items(migrated, team["project"])
    for system in {first["system"], second["system"]}:
        access = _upload(team, "IT Access Management Standard v4.2", ACCESS, system)
    model = _Scripted([
        _verdicts([("D1", True, "It sets who approves access.",
                    "granted only after the Application Owner approves the request")])
    ] * 40)  # fmt: skip
    _run(migrated, team["project"], model)
    for item in (first, second):
        proposal = next(
            p for p in _read(team, item["control"])["proposals"]
            if p["requirement_id"] == str(item["id"])
        )  # fmt: skip
        accepted = team["owner"].post(f"{_project(team)}/policy-evidence/{proposal['id']}/accept")
        assert accepted.status_code == 200, accepted.text
        assert [name for name, _, _ in _filed(migrated, item["id"])] == [
            "IT Access Management Standard v4.2.txt"
        ]
    with connect(migrated.url) as connection:
        folders = connection.execute(
            "SELECT f.folder_path FROM evidence_matches m JOIN evidence_files f "
            "ON f.id = m.evidence_file_id WHERE m.requirement_id = ANY(%s) ORDER BY 1",
            ([first["id"], second["id"]],),
        ).fetchall()
    # Each control's own copy, in its own folder.
    assert len({row[0] for row in folders}) == 2
    assert all(str(row[0]).startswith("Policies on file/") for row in folders)
    _ = access


def test_a_person_files_a_policy_on_file_themselves(migrated: Database) -> None:
    team = _ready(migrated, "pe-choose")
    item = _item(migrated, team["project"])
    access = _upload(team, "IT Access Management Standard v4.2", ACCESS, item["system"])
    # The agent did not think it fits; the person decides otherwise.
    model = _Scripted([_verdicts([("D1", False, "Not about this item.", "")])] * 20)
    _run(migrated, team["project"], model)
    body = _read(team, item["control"])
    assert [d["id"] for d in body["documents"]] == [access]
    assert body["documents"][0]["usable"] is True
    assert body["documents"][0]["effective"] == "1 Oct 2024"
    chosen = team["owner"].post(
        f"{_project(team)}/controls/{item['control']}/items/{item['id']}/policy-evidence",
        json={"document_id": access},
    )
    assert chosen.status_code == 200, chosen.text
    assert [name for name, by, _ in _filed(migrated, item["id"])] == [
        "IT Access Management Standard v4.2.txt"
    ]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT status, reason FROM policy_evidence_proposals "
            "WHERE document_id = %s AND requirement_id = %s",
            (UUID(access), item["id"]),
        ).fetchone()
    assert row is not None and row[0] == "ACCEPTED" and str(row[1]).startswith("Chosen by")
    # A document that does not apply to the control cannot be filed on its item.
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO source_document_exclusions (document_id, engagement_control_id, "
            "project_id) VALUES (%s, %s, %s)",
            (UUID(access), item["control"], team["project"]),
        )
    refused = team["owner"].post(
        f"{_project(team)}/controls/{item['control']}/items/{item['id']}/policy-evidence",
        json={"document_id": access},
    )
    assert refused.status_code == 409
