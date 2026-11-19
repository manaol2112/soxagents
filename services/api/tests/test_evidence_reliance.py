"""Evidence reliance (increment E1, product owner, 18 November 2026).

One module says what relies on an evidence file and which change each reliance refuses
(evidence_reliance.py): a withdrawal or a replacement respects every reliance; taking the
file off one item or request only those on that item (or, through the filing, on that
request's items); a move those on its control's instances; a new reading every one but
the reading itself. A removal from a request never withdraws the file. A file that leaves
comes off every open test sheet that holds it, a sibling instance's too, and a signed-off
sheet is never touched. A replacement carries a person's links, never a judgment.
"""

from typing import Any, get_args
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_evidence_analysis import _no_ocr, _settings
from test_evidence_plans import _control, _phase, _plan
from test_evidence_portal import _code, _public, _sent, _verify
from test_outbound import _team, migrated

from ai_workforce_api import evidence_reliance as reliance
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import run_analysis
from ai_workforce_api.evidence_versions import REPLACED_NOT_RESTORED

_ = migrated


# The rule: which change respects which reliance


C, OTHER_C, R, OTHER_R, Q = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
WHERE = ("SAME", "ELSEWHERE", "SAME_REQUEST", "SIBLING")


def _scope(change: reliance.Change, where: str) -> reliance.Scope:
    """The change's reach: on the reliance's own control or item (SAME), on another one
    (ELSEWHERE), on another item of the reliance's request (SAME_REQUEST), or on another
    item while the file also stops serving the reliance's item, a sibling instance's
    (SIBLING: B1 and B3 of the E1 review)."""
    if change == "MOVE":
        return reliance.Scope(frozenset({C if where == "SAME" else OTHER_C}))
    if change in ("UNLINK", "REMOVE_FROM_REQUEST"):
        if where == "SAME":
            return reliance.Scope(requirement_id=R)
        if where == "SIBLING":
            return reliance.Scope(requirement_id=OTHER_R, items=frozenset({R}))
        return reliance.Scope(
            requirement_id=OTHER_R, request_id=Q if where == "SAME_REQUEST" else None
        )
    return reliance.Scope()


def _expected(kind: reliance.Kind, change: reliance.Change, where: str) -> bool:
    """The approved plan, written out on its own."""
    if change == "RESTORE":
        return False
    if change in ("WITHDRAW", "REPLACE"):
        return True
    if change == "REREAD":
        return kind != "READING"
    if kind in ("READING", "SCREENSHOT_SIGNED"):
        return True
    if change == "REMOVE_FROM_REQUEST" and where == "SAME_REQUEST":
        return True
    if change in ("UNLINK", "REMOVE_FROM_REQUEST") and where == "SIBLING":
        return True
    return where == "SAME"


def test_every_kind_and_change_is_named() -> None:
    assert set(reliance.KINDS) == set(get_args(reliance.Kind))
    assert set(reliance.CHANGES) == set(get_args(reliance.Change))
    assert set(reliance.REFUSED) == set(reliance.CHANGES)


@pytest.mark.parametrize("where", WHERE)
@pytest.mark.parametrize("change", reliance.CHANGES)
@pytest.mark.parametrize("kind", reliance.KINDS)
def test_each_change_respects_the_reliances_within_its_reach(
    kind: reliance.Kind, change: reliance.Change, where: str
) -> None:
    found = reliance.Reliance(kind, "relied on", C, R, Q)
    assert reliance.blocks(found, change, _scope(change, where)) is _expected(kind, change, where)


# A design request of ITGC-AC-01, sent, with two items


class _Design:
    def __init__(self, database: Database, slug: str) -> None:
        sent = _sent(database, slug, phase="DESIGN")
        self.database = database
        self.team: dict[str, Any] = sent["team"]
        self.client: TestClient = sent["client"]
        self.request_id = str(sent["request_id"])
        self.sent = sent
        self.base = f"/organizations/{self.team['org']}/projects/{self.team['project']}"
        self.control = _control(database, self.team, "ITGC-AC-01")
        items = [
            r
            for r in self.items()
            if r["request_id"] == self.request_id
            and r["state"] not in ("NOT_APPLICABLE", "REMOVED")
        ]
        self.first, self.second = str(items[0]["id"]), str(items[1]["id"])

    def items(self) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = _phase(_plan(self.client, self.team, self.control), "DESIGN")[
            "requirements"
        ]
        return found

    def item(self, item_id: str) -> dict[str, Any]:
        return next(r for r in self.items() if r["id"] == item_id)

    def add(self, item_id: str, name: str, read: bool = True) -> str:
        added = self.client.post(
            f"{self.base}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": self.request_id,
                    "requirement_id": item_id},
            content=f"{name}: managers approve each access request.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        if read:
            self.read()
        return str(added.json()["file_id"])

    def read(self) -> None:
        with connect(self.database.url) as connection:
            for (analysis_id,) in connection.execute(
                "SELECT id FROM evidence_analyses WHERE status = 'PENDING' ORDER BY created_at"
            ).fetchall():
                run_analysis(connection, _settings(self.database), None, analysis_id, _no_ocr)

    def accept(self, item_id: str) -> None:
        judged = self.client.post(
            f"{self.base}/controls/{self.control}/evidence-requirements/{item_id}/sufficiency",
            json={"sufficiency": "ACCEPTED", "version": self.item(item_id)["version"]},
        )
        assert judged.status_code == 200, judged.text

    def link(self, item_id: str, file_id: str) -> None:
        linked = self.client.post(
            f"{self.base}/controls/{self.control}/evidence-requirements/{item_id}/files",
            json={"file_id": file_id, "reason": "The rules name who grants access.",
                  "version": self.item(item_id)["version"]},
        )  # fmt: skip
        assert linked.status_code == 200, linked.text

    def withdraw(self, file_id: str, client: TestClient | None = None) -> Any:
        return (client or self.client).post(
            f"{self.base}/evidence-files/{file_id}/withdraw", json={"reason": "Sent in error."}
        )

    def remove(
        self, file_id: str, item_id: str, client: TestClient | None = None, **body: Any
    ) -> Any:
        if "version" not in body:
            seen = self.impact(file_id, "REMOVE_FROM_REQUEST", item_id).json()
            body["version"] = (seen.get("removal") or {}).get("version") or 1
        return (client or self.client).post(
            f"{self.base}/evidence-files/{file_id}/remove-from-request",
            json={"requirement_id": item_id, "reason": "It answers another item."} | body,
        )

    def impact(
        self,
        file_id: str,
        action: str,
        item_id: str | None = None,
        client: TestClient | None = None,
    ) -> Any:
        params = {"action": action} | ({} if item_id is None else {"requirement_id": item_id})
        return (client or self.client).get(
            f"{self.base}/evidence-files/{file_id}/impact", params=params
        )

    def rows(self, sql: str, *params: Any) -> list[tuple[Any, ...]]:
        with connect(self.database.url) as connection:
            return list(connection.execute(sql, params).fetchall())

    def run(self, sql: str, *params: Any) -> None:
        with connect(self.database.url) as connection:
            connection.execute(sql, params)

    def kinds(self, file_id: str) -> list[str]:
        with connect(self.database.url) as connection, connection.cursor() as cursor:
            return [
                r.kind
                for r in reliance.reliances(cursor, UUID(str(self.team["project"])), UUID(file_id))
            ]


def _audit(case: _Design, action: str, target: str) -> list[dict[str, Any]]:
    return [
        row[0]
        for row in case.rows(
            "SELECT payload FROM audit_events WHERE action = %s AND target_id = %s "
            "ORDER BY created_at",
            action,
            UUID(target),
        )
    ]


def _reread(database: Database, client: TestClient, base: str, file_id: str) -> Any:
    """A person asks for the file to be read again; its reading as it stood."""
    with connect(database.url) as connection:
        found = connection.execute(
            "SELECT id, version FROM evidence_analyses WHERE evidence_file_id = %s", (file_id,)
        ).fetchone()
    assert found is not None
    return client.post(f"{base}/evidence-analyses/{found[0]}/reanalyze", json={"version": found[1]})


def test_each_reliance_on_record_keeps_the_file_until_it_is_cleared(migrated: Database) -> None:
    case = _Design(migrated, "rel-kinds")
    owner = case.team["owner_id"]
    org, project = case.team["org"], case.team["project"]

    def refused(file_id: str, kind: str, sentence: str) -> None:
        assert case.kinds(file_id) == [kind]
        kept = case.withdraw(file_id)
        assert kept.status_code == 409
        assert kept.json()["detail"] == f"the file cannot be withdrawn: {sentence}"
        seen = case.impact(file_id, "WITHDRAW").json()
        assert (seen["allowed"], seen["refusal"]) == (False, kept.json()["detail"])
        assert [(b["kind"], b["sentence"]) for b in seen["blocking"]] == [(kind, sentence)]

    # The agent still reading it.
    reading = case.add(case.first, "reading.txt", read=False)
    refused(reading, "READING", reliance.READING)
    assert case.remove(reading, case.first).status_code == 409
    case.read()
    assert case.kinds(reading) == []

    # The walkthrough instance picked from it, until it is picked again.
    picked = case.add(case.first, "population.txt")
    case.run(
        """
        INSERT INTO walkthrough_instances (
            organization_id, project_id, engagement_control_id, requirement_id,
            population_file_id, population_sha256, row_number, columns, row_values, selected_by
        )
        SELECT %s, %s, %s, %s, f.id, f.content_sha256, 1, '[]', '[]', %s
        FROM evidence_files f WHERE f.id = %s
        """,
        org, project, case.control, case.first, owner, picked,
    )  # fmt: skip
    title = case.item(case.first)["title"]
    refused(
        picked,
        "WALKTHROUGH_PICK",
        f'the walkthrough instance for "{title}" for ITGC-AC-01 was picked from it; pick it '
        "again from another file first",
    )
    case.run(
        "UPDATE walkthrough_instances SET superseded_at = clock_timestamp(), superseded_by = %s "
        "WHERE population_file_id = %s",
        owner, picked,
    )  # fmt: skip
    assert case.withdraw(picked).status_code == 200

    # A finding on it a person decided, until the finding is closed; a new reading of it is
    # refused too, and leaves its reading as it was.
    found = case.add(case.first, "approvals.txt")
    case.run(
        """
        INSERT INTO evidence_findings (
            organization_id, project_id, engagement_control_id, evidence_file_id, analysis_id,
            requirement_id, pbc_request_id, source, kind, fingerprint, title, status,
            decided_by, decided_at
        )
        SELECT %s, %s, %s, a.evidence_file_id, a.id, %s, %s, 'READER', 'GAP', %s,
               'The approval date is missing', 'ACCEPTED', %s, clock_timestamp()
        FROM evidence_analyses a WHERE a.evidence_file_id = %s
        """,
        org, project, case.control, case.first, case.request_id, "a" * 64, owner, found,
    )  # fmt: skip
    refused(
        found,
        "SENT_FINDING",
        'a person decided the finding "The approval date is missing" for ITGC-AC-01 on it; '
        "close that finding first",
    )
    [(analysis_id, version, text)] = case.rows(
        "SELECT id, version, extracted_text FROM evidence_analyses WHERE evidence_file_id = %s",
        UUID(found),
    )
    again = case.client.post(
        f"{case.base}/evidence-analyses/{analysis_id}/reanalyze", json={"version": version}
    )
    assert again.status_code == 409
    assert again.json()["detail"] == (
        "This file's reading is relied on: a person decided the finding \"The approval date "
        'is missing" for ITGC-AC-01 on it; close that finding first'
    )
    assert case.rows(
        "SELECT version, extracted_text, status FROM evidence_analyses WHERE id = %s",
        analysis_id,
    ) == [(version, text, "READY")]
    case.run("UPDATE evidence_findings SET status = 'DISMISSED' WHERE evidence_file_id = %s", found)
    assert case.kinds(found) == []

    # The control's signed D&I conclusion, for a file that served a design item when it
    # was signed; one added after the sign-off was not part of it.
    served = case.add(case.first, "procedure.txt")
    case.run(
        """
        INSERT INTO workpapers (
            organization_id, project_id, engagement_control_id, stage, template_key,
            status, draft_status, current_version, requested_by
        )
        VALUES (%s, %s, %s, 'DESIGN', 'itgc', 'DRAFT', 'IDLE', 1, %s)
        ON CONFLICT (project_id, engagement_control_id, stage) DO NOTHING
        """,
        org, project, case.control, owner,
    )  # fmt: skip
    case.run(
        """
        INSERT INTO design_conclusions (
            organization_id, project_id, engagement_control_id, workpaper_id,
            workpaper_version, verdict, conclusion, signed_by
        )
        SELECT %s, %s, %s, w.id, 1, 'EFFECTIVE', 'EFFECTIVE', %s FROM workpapers w
        WHERE w.project_id = %s AND w.engagement_control_id = %s AND w.stage = 'DESIGN'
        """,
        org, project, case.control, owner, project, case.control,
    )  # fmt: skip
    later = case.add(case.second, "later procedure.txt")
    assert case.kinds(later) == []
    refused(
        served,
        "SIGNED_DI_CONCLUSION",
        "the signed design conclusion for ITGC-AC-01 rests on it; reopen that conclusion first",
    )
    case.run(
        "UPDATE design_conclusions SET reopened_at = clock_timestamp(), reopened_by = %s, "
        "reopened_from = 'PERSON', reopen_reason = 'The procedure was replaced.' "
        "WHERE engagement_control_id = %s AND reopened_at IS NULL",
        owner, case.control,
    )  # fmt: skip
    assert case.withdraw(served).status_code == 200

    # A finding on it sent to the client.
    asked = case.add(case.first, "tickets.txt")
    case.run(
        """
        WITH sent AS (
            INSERT INTO request_messages (
                organization_id, project_id, pbc_request_id, author_kind, author_user_id, body
            )
            VALUES (%s, %s, %s, 'TEAM', %s, 'Please send the approval for REQ-1041.')
            RETURNING id
        )
        INSERT INTO evidence_findings (
            organization_id, project_id, engagement_control_id, evidence_file_id, analysis_id,
            requirement_id, pbc_request_id, source, kind, fingerprint, title, status,
            decided_by, decided_at, sent_message_id
        )
        SELECT %s, %s, %s, a.evidence_file_id, a.id, %s, %s, 'READER', 'GAP', %s,
               'The approval is missing', 'SENT', %s, clock_timestamp(), sent.id
        FROM evidence_analyses a, sent WHERE a.evidence_file_id = %s
        """,
        org, project, case.request_id, owner,
        org, project, case.control, case.first, case.request_id, "b" * 64, owner, asked,
    )  # fmt: skip
    refused(
        asked,
        "SENT_FINDING",
        'the finding "The approval is missing" for ITGC-AC-01 was sent to the client on it; '
        "close that finding first",
    )

    # Its screenshot review signed off.
    shot = case.add(case.first, "screenshot.txt")
    case.run(
        """
        INSERT INTO evidence_reviews (
            organization_id, project_id, evidence_analysis_id, evidence_file_id, status,
            proposed, decision, conclusion, decided_by, decided_at
        )
        SELECT %s, %s, a.id, a.evidence_file_id, 'NEEDS_PERSON', 'CANNOT_CONCLUDE',
               'ACCEPTED', 'CANNOT_CONCLUDE', %s, clock_timestamp()
        FROM evidence_analyses a WHERE a.evidence_file_id = %s
        """,
        org, project, owner, shot,
    )  # fmt: skip
    refused(shot, "SCREENSHOT_SIGNED", reliance.SCREENSHOT_SIGNED)
    # File-wide: it is refused off any item too.
    assert case.remove(shot, case.first).json()["detail"] == (
        f"the file cannot be removed from this request: {reliance.SCREENSHOT_SIGNED}"
    )

    # The prepared design workpaper's current version cites it.
    cited = case.add(case.first, "cited policy.txt")
    case.run(
        """
        WITH paper AS (
            SELECT id FROM workpapers
            WHERE project_id = %s AND engagement_control_id = %s AND stage = 'DESIGN'
        ), written AS (
            INSERT INTO workpaper_versions (workpaper_id, number, content, source, created_by)
            SELECT id, 2, jsonb_build_object('walkthrough', %s::text), 'PERSON', %s FROM paper
            RETURNING workpaper_id
        )
        UPDATE workpapers SET current_version = 2, status = 'PREPARED', prepared_by = %s,
               prepared_at = clock_timestamp(), prepared_version = 2, draft_status = 'IDLE'
        WHERE id IN (SELECT workpaper_id FROM written)
        """,
        project, case.control, f'Managers approve access [cite:{cited} "managers approve"]',
        owner, owner,
    )  # fmt: skip
    refused(
        cited,
        "PREPARED_WORKPAPER",
        "the prepared design workpaper for ITGC-AC-01 cites it; reopen it first",
    )


def test_a_file_on_a_whole_request_comes_off_it_only_when_no_item_relies_on_it(
    migrated: Database,
) -> None:
    """A file filed for the request (no item named) serves each of its items: taking it off
    one item takes it off the request, so an acceptance of any of them refuses it; once
    that is reopened, it lets go of the request and stays filed to its control."""
    case = _Design(migrated, "rel-whole")
    added = case.client.post(
        f"{case.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "both items.txt",
                "request_id": case.request_id},
        content=b"The policy and one approved request, end to end.",
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    whole = str(added.json()["file_id"])
    case.read()
    assert case.rows(
        "SELECT requirement_id FROM evidence_matches WHERE evidence_file_id = %s", UUID(whole)
    ) == [(None,)]
    case.accept(case.first)
    seen = case.impact(whole, "REMOVE_FROM_REQUEST", case.second).json()
    assert (seen["removal"]["via"], seen["allowed"]) == ("FILING", False)
    refused = case.remove(whole, case.second)
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        f"the file cannot be removed from this request: the evidence item "
        f'"{case.item(case.first)["title"]}" was accepted with it; change that decision first'
    )
    reopened = case.client.post(
        f"{case.base}/controls/{case.control}/evidence-requirements/{case.first}/sufficiency",
        json={"sufficiency": "NOT_REVIEWED", "version": case.item(case.first)["version"]},
    )
    assert reopened.status_code == 200, reopened.text
    removed = case.remove(whole, case.second)
    assert removed.status_code == 200, removed.text
    assert case.rows(
        "SELECT status, pbc_request_id FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(whole),
    ) == [("FILED", None)]
    # The reading names no request now (N6).
    assert case.rows(
        "SELECT pbc_request_id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(whole)
    ) == [(None,)]


def test_an_items_reliance_keeps_it_there_and_a_removal_takes_it_off_one_item(
    migrated: Database,
) -> None:
    case = _Design(migrated, "rel-remove")
    rules = case.add(case.first, "approval rules.txt")
    case.accept(case.first)
    case.link(case.second, rules)
    first_title = case.item(case.first)["title"]
    accepted = f'the evidence item "{first_title}" was accepted with it; change that decision first'

    # Its acceptance on the first item keeps the file in the engagement.
    kept = case.withdraw(rules)
    assert kept.json()["detail"] == f"the file cannot be withdrawn: {accepted}"
    again = _reread(migrated, case.client, case.base, rules)
    assert again.json()["detail"] == f"This file's reading is relied on: {accepted}"
    seen = case.impact(rules, "WITHDRAW").json()
    assert seen["allowed"] is False
    assert [(b["kind"], b["requirement_id"]) for b in seen["blocking"]] == [
        ("ACCEPTED_ITEM", case.first)
    ]
    assert {(i["id"], i["via"]) for i in seen["items"]} == {
        (case.first, "FILING"),
        (case.second, "LINK"),
    }
    assert [(r["id"], r["control_ref"]) for r in seen["requests"]] == [
        (case.request_id, "ITGC-AC-01")
    ]
    assert [c["control_ref"] for c in seen["controls"]] == ["ITGC-AC-01"]
    assert seen["removal"] is None and seen["retested_sheets"] == []

    # It is not relied on for the second item: it comes off that item only, through its
    # link, and stays filed for the first.
    off_second = case.impact(rules, "REMOVE_FROM_REQUEST", case.second).json()
    assert (off_second["allowed"], off_second["removal"]["via"]) == (True, "LINK")
    removed = case.remove(rules, case.second, version=off_second["removal"]["version"])
    assert removed.status_code == 200, removed.text
    assert (removed.json()["via"], removed.json()["request_id"]) == ("LINK", case.request_id)
    assert case.rows(
        "SELECT status FROM evidence_requirement_files WHERE evidence_file_id = %s",
        UUID(rules),
    ) == [("REMOVED",)]
    assert case.rows(
        "SELECT status, engagement_control_id::text, pbc_request_id::text, requirement_id::text "
        "FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(rules),
    ) == [("FILED", case.control, case.request_id, case.first)]
    assert (
        case.rows("SELECT 1 FROM evidence_withdrawals WHERE evidence_file_id = %s", UUID(rules))
        == []
    )
    assert case.item(case.first)["sufficiency"] == "ACCEPTED"
    assert _audit(case, "evidence.removed_from_request", rules) == [
        {"requirement_id": case.second, "request_id": case.request_id,
         "reason": "It answers another item.", "via": "LINK"}
    ]  # fmt: skip
    # Off the first item is off its request: the acceptance refuses it.
    refused = case.remove(rules, case.first)
    assert refused.status_code == 409
    assert refused.json()["detail"] == f"the file cannot be removed from this request: {accepted}"
    # An item it does not serve.
    assert case.remove(rules, case.second).json()["detail"] == reliance.NOT_SERVED

    # A file filed for the second item, linked to the first too: its removal from the
    # second item goes through its filing, lets go of the request, and keeps its control
    # and its link.
    walkthrough = case.add(case.second, "walkthrough.txt")
    case.link(case.first, walkthrough)
    stale = case.remove(walkthrough, case.second, version=999)
    assert stale.status_code == 409
    seen = case.impact(walkthrough, "REMOVE_FROM_REQUEST", case.second).json()
    assert seen["allowed"] is True
    assert (seen["removal"]["via"], seen["removal"]["request_id"]) == ("FILING", case.request_id)
    removed = case.remove(walkthrough, case.second, version=seen["removal"]["version"])
    assert removed.status_code == 200, removed.text
    assert removed.json()["via"] == "FILING"
    assert case.rows(
        "SELECT status, engagement_control_id::text, pbc_request_id, requirement_id "
        "FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(walkthrough),
    ) == [("FILED", case.control, None, None)]
    assert case.rows(
        "SELECT requirement_id::text, status FROM evidence_requirement_files "
        "WHERE evidence_file_id = %s",
        UUID(walkthrough),
    ) == [(case.first, "LINKED")]
    assert (
        case.rows(
            "SELECT 1 FROM evidence_withdrawals WHERE evidence_file_id = %s", UUID(walkthrough)
        )
        == []
    )
    assert walkthrough not in [f["file_id"] for f in case.item(case.second)["files"]]
    assert walkthrough in [f["file_id"] for f in case.item(case.first)["files"]]
    [event] = _audit(case, "evidence.removed_from_request", walkthrough)
    assert event == {"requirement_id": case.second, "request_id": case.request_id,
                     "reason": "It answers another item.", "via": "FILING"}  # fmt: skip
    # The other file is as it was.
    assert case.rows(
        "SELECT pbc_request_id::text FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(rules),
    ) == [(case.request_id,)]

    # Only a person with update rights removes; a reader may ask what a change would do;
    # another firm finds neither.
    from test_design_requests import _member

    _reviewer_id, reviewer = _member(migrated, case.team, "REVIEWER")
    assert case.remove(rules, case.first, client=reviewer, version=1).status_code == 403
    read = case.impact(walkthrough, "WITHDRAW", client=reviewer)
    assert read.status_code == 200
    assert (read.json()["allowed"], read.json()["refusal"]) == (
        False, "you can read this engagement's evidence but not change it",
    )  # fmt: skip
    _seeded, _project, outsider, _admin = _team(migrated, f"rel-out-{uuid4().hex[:4]}")
    assert case.remove(rules, case.first, client=outsider).status_code == 404
    assert case.impact(rules, "WITHDRAW", client=outsider).status_code == 404
    elsewhere = case.client.get(
        f"/organizations/{case.team['org']}/projects/{uuid4()}/evidence-files/{rules}/impact",
        params={"action": "WITHDRAW"},
    )
    assert elsewhere.status_code == 404
    missing = case.client.get(
        f"{case.base}/evidence-files/{uuid4()}/impact", params={"action": "WITHDRAW"}
    )
    assert missing.status_code == 404
    # A version is required (N10): a stale page cannot remove a file.
    unversioned = case.client.post(
        f"{case.base}/evidence-files/{rules}/remove-from-request",
        json={"requirement_id": case.first, "reason": "It answers another item."},
    )
    assert unversioned.status_code == 422
    # An engagement that is not active changes no evidence; its impact says so.
    case.run("UPDATE projects SET status = 'PAUSED' WHERE id = %s", case.team["project"])
    paused = case.remove(walkthrough, case.first, version=1)
    assert (paused.status_code, paused.json()["detail"]) == (
        409, "the engagement is not active, so it takes no new evidence",
    )  # fmt: skip
    seen = case.impact(walkthrough, "WITHDRAW").json()
    assert (seen["allowed"], seen["refusal"]) == (
        False, "the engagement is not active, so it takes no new evidence",
    )  # fmt: skip


def test_a_replacement_carries_the_links_and_no_judgment(migrated: Database) -> None:
    case = _Design(migrated, "rel-replace")
    policy = case.add(case.first, "policy.txt")
    case.accept(case.first)
    # Linked after the first item was accepted: not part of that acceptance.
    rules = case.add(case.second, "rules.txt")
    case.link(case.first, rules)
    assert case.kinds(rules) == []
    replaced = case.client.post(
        f"{case.base}/evidence-files/{rules}/replace",
        params={"name": "rules v2.txt", "reason": "Corrected version"},
        content=b"rules v2: managers approve each access request.",
        headers={"content-type": "text/plain"},
    )
    assert replaced.status_code == 200, replaced.text
    newer = replaced.json()["file_id"]
    [(link_id, origin, linked_by)] = case.rows(
        "SELECT id::text, origin, linked_by FROM evidence_requirement_files "
        "WHERE evidence_file_id = %s AND requirement_id = %s AND status = 'LINKED'",
        UUID(newer), UUID(case.first),
    )  # fmt: skip
    assert (origin, linked_by) == ("PERSON", case.team["owner_id"])
    # The old file's link stays on record with it.
    assert case.rows(
        "SELECT status FROM evidence_requirement_files WHERE evidence_file_id = %s",
        UUID(rules),
    ) == [("LINKED",)]
    [event] = _audit(case, "evidence.replaced", rules)
    carried = [
        (c["requirement_id"], c["link_id"], c["origin"], c["linked_by"])
        for c in event["links_carried"]
    ]
    assert carried == [(case.first, link_id, "PERSON", "KEPT")]
    # Filed for the item the old one was for; never accepted with the first item.
    assert case.rows(
        "SELECT requirement_id::text FROM evidence_matches WHERE evidence_file_id = %s",
        UUID(newer),
    ) == [(case.second,)]
    case.read()
    assert case.kinds(newer) == []
    assert case.item(case.first)["sufficiency"] == "ACCEPTED"
    assert case.kinds(policy) == ["ACCEPTED_ITEM"]
    # A replaced file stays in its version history.
    restore = case.client.post(
        f"{case.base}/evidence-files/{rules}/restore", json={"reason": "Use the old one."}
    )
    assert (restore.status_code, restore.json()["detail"]) == (409, REPLACED_NOT_RESTORED)
    seen = case.impact(rules, "RESTORE").json()
    assert (seen["allowed"], seen["refusal"]) == (False, REPLACED_NOT_RESTORED)


def test_a_tickmark_and_a_reliability_decision_keep_the_file(migrated: Database) -> None:
    import test_attribute_dispositions as dispositions
    import test_file_reliability as reliability_tests
    from test_evidence_assurance import _Bench

    bench = _Bench(migrated, "rel-decided")
    # A report that does not show its basis (a reliability question) with B, C and D absent.
    ticket, first = reliability_tests._first_check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    files = f"{bench.base}/evidence-files/{ticket}"
    ids = dispositions._ids(first)
    mark = dispositions._annotate(bench, ticket, ids["B"])
    done = dispositions._record(bench, ids["B"], "SHOWN_ON_REVIEW", annotation_id=mark)
    assert done.status_code == 200, done.text
    title = next(
        str(r[0])
        for r in bench.rows(
            "SELECT title FROM evidence_requirements WHERE id = %s", UUID(bench.item_id)
        )
    )
    tickmark = (
        f'an attribute of "{title}" for ITGC-AC-01 is shown on a tickmark a person made on it; '
        "reopen that decision first"
    )
    kept = bench.owner.post(f"{files}/withdraw", json={"reason": "Sent in error"})
    assert kept.json()["detail"] == f"the file cannot be withdrawn: {tickmark}"
    again = _reread(migrated, bench.owner, bench.base, ticket)
    assert again.json()["detail"] == f"This file's reading is relied on: {tickmark}"
    register = bench.owner.get(f"{bench.base}/evidence-register").json()
    filing = next(f for f in register["files"] if f["id"] == ticket)["filing_version"]
    moved = bench.owner.post(
        f"{bench.base}/evidence-files/{ticket}/filing", json={"version": filing, "control_id": None}
    )
    assert moved.json()["detail"] == f"the file cannot be moved: {tickmark}"
    disposition = dispositions._by_code(done.json())["B"]["disposition"]["id"]
    reopened = dispositions._reopen(bench, ids["B"], disposition)
    assert reopened.status_code == 200, reopened.text

    decided = reliability_tests._record(bench, ticket, "NOT_RELIED_ON")
    assert decided.status_code == 200, decided.text
    kept = bench.owner.post(f"{files}/withdraw", json={"reason": "Sent in error"})
    assert kept.json()["detail"] == (
        "the file cannot be withdrawn: a person's decision on whether it is reliable stands "
        f'for "{title}" for ITGC-AC-01; reopen that decision first'
    )
    again = _reread(migrated, bench.owner, bench.base, ticket)
    assert again.json()["detail"].startswith(
        "This file's reading is relied on: a person's decision on whether it is reliable"
    )
    decision = reliability_tests._on(decided.json(), ticket)["decision"]["id"]
    assert reliability_tests._reopen(bench, ticket, decision).status_code == 200
    withdrawn = bench.owner.post(f"{files}/withdraw", json={"reason": "Sent in error"})
    assert withdrawn.status_code == 200, withdrawn.text


def test_signed_testing_and_an_approved_sample_keep_their_files(migrated: Database) -> None:
    from test_evidence_intake import _base
    from test_workpapers import _tested_control

    team, client, sheet, ticket = _tested_control(migrated, "rel-signed")
    base = _base(team)
    signed = "testing for ITGC-AC-01 is signed off on it; reopen it first"
    register = client.get(f"{base}/evidence-register").json()
    row = next(f for f in register["files"] if f["id"] == ticket)
    other = next(c["id"] for c in register["controls"] if c["control_ref"] != "ITGC-AC-01")
    moved = client.post(
        f"{base}/evidence-files/{ticket}/filing",
        json={"version": row["filing_version"], "control_id": other},
    )
    assert moved.json()["detail"] == f"the file cannot be moved: {signed}"
    with connect(migrated.url) as connection:
        found = connection.execute(
            "SELECT id, version, extracted_text FROM evidence_analyses WHERE evidence_file_id = %s",
            (ticket,),
        ).fetchone()
    assert found is not None
    again = client.post(
        f"{base}/evidence-analyses/{found[0]}/reanalyze", json={"version": found[1]}
    )
    assert again.json()["detail"] == f"This file's reading is relied on: {signed}"
    with connect(migrated.url) as connection:
        after = connection.execute(
            "SELECT version, extracted_text FROM evidence_analyses WHERE id = %s", (found[0],)
        ).fetchone()
    assert after == (found[1], found[2])
    population = next(
        f["id"] for f in register["files"] if f["file_name"] == "access population.csv"
    )
    seen = client.get(
        f"{base}/evidence-files/{population}/impact", params={"action": "REPLACE"}
    ).json()
    assert "APPROVED_SAMPLE" in [b["kind"] for b in seen["blocking"]]
    assert seen["refusal"].startswith("the file cannot be replaced: ")
    drawn = client.post(
        f"{base}/evidence-files/{population}/withdraw", json={"reason": "Wrong population"}
    )
    assert (drawn.status_code, drawn.json()["detail"]) == (
        409, "the file cannot be withdrawn: the approved sample for ITGC-AC-01 was drawn from it",
    )  # fmt: skip


# A file of a control over several systems, on each instance's open sheet


def _family(migrated: Database, slug: str) -> dict[str, Any]:
    from test_testing_engine import (
        _add,
        _controls,
        _engagement_with_apps,
        _instance_request,
        _read_all,
    )

    team, client, scheduler = _engagement_with_apps(migrated, slug, ["AWS IAM", "Oracle Database"])
    instances = {
        row["application_name"]: row["id"]
        for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }
    request = _instance_request(migrated, team, instances["SAP ERP"])["id"]
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    names = ("settings.csv", "settings two.csv", "settings three.csv")
    for name in names:
        _add(client, team, name, f"Setting,Value\n{name},14\n", request)
    _read_all(migrated, scheduler)
    files = {
        f["file_name"]: f["id"]
        for f in client.get(f"{base}/evidence-register").json()["files"]
        if f["file_name"] in names
    }
    for file_id in files.values():
        tagged = client.post(f"{base}/evidence-files/{file_id}/application", json={"scope": "ALL"})
        assert tagged.status_code == 200, tagged.text
    return {"team": team, "client": client, "scheduler": scheduler, "instances": instances,
            "base": base, "files": files}  # fmt: skip


def _sheets(migrated: Database, project: str) -> dict[str, str]:
    with connect(migrated.url) as connection:
        return {
            str(row[1]): str(row[0])
            for row in connection.execute(
                "SELECT s.id, s.engagement_control_id FROM test_sheets s "
                "JOIN engagement_controls c ON c.id = s.engagement_control_id "
                "WHERE s.project_id = %s AND c.control_ref = 'ITGC-AC-05'",
                (project,),
            ).fetchall()
        }


def _held(migrated: Database, sheet_id: str) -> set[str]:
    with connect(migrated.url) as connection:
        rows = connection.execute(
            "SELECT evidence_file_id FROM test_sheet_files WHERE test_sheet_id = %s "
            "UNION SELECT t.evidence_file_id FROM test_item_files t "
            "JOIN test_items i ON i.id = t.test_item_id WHERE i.test_sheet_id = %s",
            (sheet_id, sheet_id),
        ).fetchall()
    return {str(row[0]) for row in rows}


def test_a_file_that_leaves_comes_off_every_open_sheet_and_never_a_signed_one(
    migrated: Database,
) -> None:
    from ai_workforce_api.testing_engine import run_sheet

    family = _family(migrated, "rel-family")
    team, client, base, files = family["team"], family["client"], family["base"], family["files"]
    sheets = _sheets(migrated, team["project"])
    by_app = {name: sheets[control] for name, control in family["instances"].items()}
    with connect(migrated.url) as connection:
        for sheet_id in by_app.values():
            run_sheet(connection, None, UUID(sheet_id))
    every = set(files.values())
    for sheet_id in by_app.values():
        assert every <= _held(migrated, sheet_id), sheet_id
    # Oracle's sheet is signed off holding the files on its list but on no item.
    signed = by_app["Oracle Database"]
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM test_item_files t USING test_items i "
            "WHERE i.id = t.test_item_id AND i.test_sheet_id = %s",
            (signed,),
        )
        connection.execute(
            "UPDATE test_sheets SET status = 'SIGNED_OFF', signed_by = %s, "
            "signed_at = clock_timestamp(), conclusion = 'EFFECTIVE', run_status = 'IDLE' "
            "WHERE id = %s",
            (team["owner_id"], signed),
        )
        before = connection.execute(
            "SELECT id, results, overrides, needs_test, version FROM test_items "
            "WHERE test_sheet_id = %s "
            "ORDER BY id",
            (signed,),
        ).fetchall()
    open_sheets = [by_app["SAP ERP"], by_app["AWS IAM"]]

    # Withdrawn: off both open sheets, the sibling's too.
    withdrawn = client.post(
        f"{base}/evidence-files/{files['settings.csv']}/withdraw", json={"reason": "Wrong one"}
    )
    assert withdrawn.status_code == 200, withdrawn.text
    for sheet_id in open_sheets:
        assert files["settings.csv"] not in _held(migrated, sheet_id)

    # Replaced: the new file is on exactly the open sheets the old one was on, never
    # beside it; the impact named both sheets before.
    old = files["settings two.csv"]
    seen = client.get(f"{base}/evidence-files/{old}/impact", params={"action": "REPLACE"}).json()
    assert {s["id"] for s in seen["retested_sheets"]} == set(open_sheets)
    replaced = client.post(
        f"{base}/evidence-files/{old}/replace",
        params={"name": "settings two v2.csv", "reason": "Corrected export"},
        content=b"Setting,Value\nLength,16\n",
        headers={"content-type": "text/csv"},
    )
    assert replaced.status_code == 200, replaced.text
    newer = replaced.json()["file_id"]
    for sheet_id in open_sheets:
        held = _held(migrated, sheet_id)
        assert newer in held and old not in held

    # Moved to another control: off both open sheets.
    moving = files["settings three.csv"]
    register = client.get(f"{base}/evidence-register").json()
    row = next(f for f in register["files"] if f["id"] == moving)
    other = next(c["id"] for c in register["controls"] if c["control_ref"] == "ITGC-AC-01")
    moved = client.post(
        f"{base}/evidence-files/{moving}/filing",
        json={"version": row["filing_version"], "control_id": other},
    )
    assert moved.status_code == 200, moved.text
    for sheet_id in open_sheets:
        assert moving not in _held(migrated, sheet_id)

    # The signed-off sheet is as it was: its list, its items and their results.
    assert every <= _held(migrated, signed) and newer not in _held(migrated, signed)
    with connect(migrated.url) as connection:
        after = connection.execute(
            "SELECT id, results, overrides, needs_test, version FROM test_items "
            "WHERE test_sheet_id = %s "
            "ORDER BY id",
            (signed,),
        ).fetchall()
    assert after == before


def test_the_owner_and_the_attachment_picker_no_longer_see_a_withdrawn_file(
    migrated: Database,
) -> None:
    sent = _sent(migrated, "rel-portal")
    team, client = sent["team"], sent["client"]
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    public = _public(migrated)
    session = _verify(public, sent["token"], _code(public, sent["token"]))
    added = public.post(
        f"/public/evidence-portal/session/requests/{sent['request_id']}/files",
        params={"name": "access population.csv"},
        content=b"User ID,Name,Date granted\nu0001,Demo User 1,2027-01-10\n",
        headers={**session, "content-type": "text/csv"},
    )
    assert added.status_code == 200, added.text

    def listed() -> list[str]:
        body = public.get("/public/evidence-portal/session", headers=session).json()
        return [f["file_name"] for f in body["requests"][0]["files"]]

    def offered() -> list[str]:
        found = client.get(f"{base}/pbc-requests/{sent['request_id']}/attachment-sources")
        assert found.status_code == 200, found.text
        return [f["file_name"] for f in found.json()["files"]]

    assert listed() == ["access population.csv"]
    assert "access population.csv" in offered()
    with connect(migrated.url) as connection:
        for (analysis_id,) in connection.execute(
            "SELECT id FROM evidence_analyses WHERE status = 'PENDING'"
        ).fetchall():
            run_analysis(connection, _settings(migrated), None, analysis_id, _no_ocr)
        [(file_id,)] = connection.execute(
            "SELECT id FROM evidence_files WHERE project_id = %s", (team["project"],)
        ).fetchall()
    withdrawn = client.post(f"{base}/evidence-files/{file_id}/withdraw", json={})
    assert withdrawn.status_code == 200, withdrawn.text
    assert listed() == []
    assert "access population.csv" not in offered()
    from ai_workforce_api.portal_workspace import _owner_files

    with connect(migrated.url) as connection:
        assert (
            _owner_files(
                connection,
                UUID(str(team["project"])),
                UUID(str(sent["request_id"])),
                sent["recipient"],
            )
            == []
        )


# A policy one system's item holds, shared with a sibling instance (B1, B3)


def test_a_sibling_instance_that_relies_on_a_shared_file_keeps_it(migrated: Database) -> None:
    from test_testing_engine import _controls, _engagement_with_apps, _read_all

    team, client, scheduler = _engagement_with_apps(migrated, "rel-sibling", ["AWS IAM"])
    base = f"/organizations/{team['org']}/projects/{team['project']}"
    instances = {
        row["application_name"]: row
        for row in _controls(client, team)
        if row["control_ref"] == "ITGC-AC-05"
    }

    def design(name: str) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = _phase(_plan(client, team, instances[name]["id"]), "DESIGN")[
            "requirements"
        ]
        return found

    sap_item = next(
        r for r in design("SAP ERP")
        if "PROCESS_DOCUMENTATION" in r["categories"] and r["request_id"]
    )  # fmt: skip

    def aws_item() -> dict[str, Any]:
        return next(r for r in design("AWS IAM") if r["key"] == sap_item["key"])

    apps = {name: row["application_id"] for name, row in instances.items()}
    added = client.post(
        f"{base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "access policy.txt",
                "request_id": sap_item["request_id"], "requirement_id": sap_item["id"],
                "applications": f"{apps['SAP ERP']},{apps['AWS IAM']}"},
        content=b"Access to every system is approved by the user's manager.",
        headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    policy = str(added.json()["file_id"])
    _read_all(migrated, scheduler)
    aws = aws_item()
    assert [f["via"] for f in aws["files"]] == ["SHARED"]
    sufficiency = (
        f"{base}/controls/{instances['AWS IAM']['id']}/evidence-requirements/{aws['id']}"
        "/sufficiency"
    )
    accepted = client.post(sufficiency, json={"sufficiency": "ACCEPTED", "version": aws["version"]})
    assert accepted.status_code == 200, accepted.text
    held = f'the evidence item "{aws["title"]}" was accepted with it; change that decision first'

    def impact(item_id: str) -> dict[str, Any]:
        found = client.get(
            f"{base}/evidence-files/{policy}/impact",
            params={"action": "REMOVE_FROM_REQUEST", "requirement_id": item_id},
        )
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def remove(item_id: str) -> Any:
        version = (impact(item_id).get("removal") or {}).get("version") or 1
        return client.post(
            f"{base}/evidence-files/{policy}/remove-from-request",
            json={"requirement_id": item_id, "version": version,
                  "reason": "It belongs to another request."},
        )  # fmt: skip

    def tag(scope: str, **more: Any) -> Any:
        return client.post(
            f"{base}/evidence-files/{policy}/application", json={"scope": scope, **more}
        )

    # Off the SAP item through its filing is off the AWS item too: its acceptance refuses
    # it, and the impact names the AWS item as shared.
    seen = impact(sap_item["id"])
    assert (seen["allowed"], seen["removal"]["via"]) == (False, "FILING")
    assert [(b["kind"], b["requirement_id"]) for b in seen["blocking"]] == [
        ("ACCEPTED_ITEM", aws["id"])
    ]
    assert (aws["id"], "SHARED") in {(i["id"], i["via"]) for i in seen["items"]}
    refused = remove(sap_item["id"])
    assert refused.json()["detail"] == f"the file cannot be removed from this request: {held}"
    # The AWS item holds it only through the share.
    assert remove(aws["id"]).json()["detail"] == reliance.SHARED_ONLY
    # Nor can the tag drop AWS IAM while that acceptance stands; the tag is as it was.
    narrowed = tag("ONE", application_id=apps["SAP ERP"])
    assert narrowed.status_code == 409
    assert narrowed.json()["detail"] == f"{reliance.APPLICATIONS_REFUSED}{held}"
    with connect(migrated.url) as connection:
        assert connection.execute(
            "SELECT scope FROM evidence_file_applications WHERE evidence_file_id = %s",
            (policy,),
        ).fetchall() == [("SOME",)]
    assert [f["via"] for f in aws_item()["files"]] == ["SHARED"]

    # A record from before the file arrived: an acceptance the file was not part of. The
    # tag drops AWS IAM, and the AWS item, left with nothing of its own, loses it, on record.
    def legacy_acceptance() -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                "UPDATE evidence_requirements SET sufficiency = 'ACCEPTED', sufficiency_by = %s, "
                "sufficiency_at = (SELECT created_at - interval '1 hour' FROM evidence_files "
                "WHERE id = %s) WHERE id = %s",
                (team["owner_id"], policy, aws["id"]),
            )

    def resets() -> list[str]:
        with connect(migrated.url) as connection:
            return [
                str(row[0]["by"])
                for row in connection.execute(
                    "SELECT payload FROM audit_events WHERE target_id = %s "
                    "AND action = 'evidence_requirement.sufficiency_reset' ORDER BY created_at",
                    (aws["id"],),
                ).fetchall()
            ]

    legacy_acceptance()
    assert tag("ONE", application_id=apps["SAP ERP"]).status_code == 200
    gone = aws_item()
    assert (gone["files"], gone["sufficiency"]) == ([], "NOT_REVIEWED")
    assert resets() == ["APPLICATIONS_CHANGED"]

    # Shared again, and the same record: removed from the SAP item's request, the AWS item
    # loses it as well; the impact said so first.
    assert tag("SOME", application_ids=[apps["SAP ERP"], apps["AWS IAM"]]).status_code == 200
    legacy_acceptance()
    shared = next(i for i in impact(sap_item["id"])["items"] if i["id"] == aws["id"])
    assert (shared["via"], shared["resets"]) == ("SHARED", True)
    removed = remove(sap_item["id"])
    assert removed.status_code == 200, removed.text
    assert aws_item()["sufficiency"] == "NOT_REVIEWED"
    assert resets() == ["APPLICATIONS_CHANGED", "FILE_REMOVED_FROM_REQUEST"]


# The evidence wizard's placement (B2)


def test_the_wizard_moves_a_file_only_off_an_item_that_does_not_rely_on_it(
    migrated: Database,
) -> None:
    from test_evidence_assurance import POLICY
    from test_evidence_wizard import _Reader, _Wizard

    case = _Wizard(migrated, "rel-wizard")
    policy = case.add("access policy.txt", POLICY)
    case.read_file(policy, _Reader("policy", "low", covers={case.policy["title"]: "COVERED"}))
    placed = case.place(policy, [case.policy["id"]], 1)
    assert placed.status_code == 200, placed.text
    version = placed.json()["placement"]["version"]
    sufficiency = (
        f"{case.base}/controls/{case.control}/evidence-requirements/{case.policy['id']}/sufficiency"
    )
    accepted = case.client.post(
        sufficiency,
        json={"sufficiency": "ACCEPTED", "version": case.item(case.policy["id"])["version"]},
    )
    assert accepted.status_code == 200, accepted.text
    filing = case.filing(policy)
    moved = case.place(policy, [case.walkthrough["id"]], version)
    assert moved.status_code == 409
    assert moved.json()["detail"] == (
        f'the file cannot be taken off this item: the evidence item "{case.policy["title"]}" '
        "was accepted with it; change that decision first"
    )
    assert case.filing(policy) == filing
    # A record from before the file arrived: the acceptance does not rest on it, so it
    # moves, and the item it left loses the judgment on the audit trail.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_requirements SET sufficiency_at = (SELECT created_at - "
            "interval '1 hour' FROM evidence_files WHERE id = %s) WHERE id = %s",
            (policy, case.policy["id"]),
        )
    moved = case.place(policy, [case.walkthrough["id"]], version)
    assert moved.status_code == 200, moved.text
    assert case.item(case.policy["id"])["sufficiency"] == "NOT_REVIEWED"
    events = case.rows(
        "SELECT payload FROM audit_events WHERE target_id = %s "
        "AND action = 'evidence_requirement.sufficiency_reset'",
        UUID(case.policy["id"]),
    )
    assert [(e[0]["was"], e[0]["by"], e[0]["evidence_file_id"]) for e in events] == [
        ("ACCEPTED", "FILE_MOVED", policy)
    ]


# A record from before E1: a file out of force while decisions stood on it (N8)


def test_a_file_out_of_force_by_an_earlier_record_still_ends_what_rested_on_it(
    migrated: Database,
) -> None:
    """Since E1 a person cannot take away a file a decision stands on. A file withdrawn by
    a record from before that, while a reliability decision and a "Shown, on my review"
    stood on it, still ends both when the chain next follows the control: FILE_GONE and
    ANNOTATION_GONE, naming nobody, one event per decision."""
    import test_attribute_dispositions as dispositions
    import test_file_reliability as reliability_tests
    from test_evidence_assurance import LOG, _Bench, _reading

    from ai_workforce_api import attribute_dispositions, file_reliability
    from ai_workforce_api.evidence_assurance import follow_control

    bench = _Bench(migrated, "rel-legacy")
    _ticket, first = reliability_tests._first_check(bench, B="ABSENT", C="ABSENT", D="ABSENT")
    ids = dispositions._ids(first)
    log = bench.add("sap change log.txt", LOG)
    bench.read_next(_reading("change_history"))
    reliability_tests._check(
        bench, "ticket REQ-1041.txt", "sap change log.txt", B="ABSENT", C="ABSENT", D="ABSENT"
    )
    decided = reliability_tests._record(bench, log, "NOT_RELIED_ON")
    assert decided.status_code == 200, decided.text
    mark = dispositions._annotate(bench, log, ids["B"])
    shown = dispositions._record(bench, ids["B"], "SHOWN_ON_REVIEW", annotation_id=mark)
    assert shown.status_code == 200, shown.text
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO evidence_withdrawals (organization_id, project_id, evidence_file_id, "
            "reason, withdrawn_by) VALUES (%s, %s, %s, 'Withdrawn before E1.', %s)",
            (bench.team["org"], bench.team["project"], log, bench.team["owner_id"]),
        )
        follow_control(
            connection, UUID(str(bench.team["project"])), UUID(bench.control), None, None,
            always=True,
        )  # fmt: skip
    [(ended_as, ended_by)] = bench.rows(
        "SELECT ended_as, ended_by FROM file_reliability_decisions WHERE evidence_file_id = %s",
        UUID(log),
    )
    assert (ended_as, ended_by) == ("FILE_GONE", None)
    [(actor, agent, _event)] = bench.audit(file_reliability.ENDED_WITH_FILE, bench.item_id)
    assert (actor, agent) == (None, None)
    b = dispositions._by_code(bench.entry())["B"]
    assert b["disposition"] is None
    ended = b["disposition_history"][0]
    assert (ended["ended_as"], ended["ended_by_name"]) == ("ANNOTATION_GONE", None)
    by_check = dispositions._events(bench, attribute_dispositions.ENDED_BY_CHECK)
    assert [(a, g) for a, g, _payload in by_check] == [(None, None)]


# The file's version and withdrawal history


def test_a_files_history_reads_its_versions_withdrawals_and_links(migrated: Database) -> None:
    from test_design_requests import _member

    case = _Design(migrated, "rel-history")
    files = f"{case.base}/evidence-files"
    rules = case.add(case.first, "rules.txt")
    case.link(case.second, rules)
    assert case.withdraw(rules).status_code == 200
    restored = case.client.post(f"{files}/{rules}/restore", json={"reason": "It was right."})
    assert restored.status_code == 200, restored.text
    replaced = case.client.post(
        f"{files}/{rules}/replace",
        params={"name": "rules v2.txt", "reason": "Corrected version"},
        content=b"rules v2: managers approve each access request.",
        headers={"content-type": "text/plain"},
    )
    assert replaced.status_code == 200, replaced.text
    newer = replaced.json()["file_id"]
    case.read()
    removed = case.remove(newer, case.first)
    assert removed.status_code == 200, removed.text

    def history(file_id: str, client: TestClient | None = None) -> Any:
        return (client or case.client).get(f"{files}/{file_id}/history")

    body = history(rules).json()
    assert body["file_name"] == "rules.txt"
    kinds = [(e["kind"], e["reason"]) for e in body["events"]]
    assert kinds == [
        ("ADDED", ""),
        ("LINKED", "The rules name who grants access."),
        ("WITHDRAWN", "Sent in error."),
        ("RESTORED", "It was right."),
        ("WITHDRAWN", "Corrected version"),
    ]
    added, linked, first_out, back, last_out = body["events"]
    assert (added["source"], added["by"], added["replaces"]) == ("UPLOAD", back["by"], None)
    assert added["size_bytes"] > 0 and back["by"]
    assert linked["requirement_id"] == case.second
    assert first_out["replaced_by"] is None
    assert last_out["replaced_by"] == {"id": newer, "name": "rules v2.txt"}
    stamps = [e["at"] for e in body["events"]]
    assert stamps == sorted(stamps)
    later = history(newer).json()["events"]
    assert [e["kind"] for e in later] == ["ADDED", "LINKED", "REMOVED_FROM_REQUEST"]
    assert later[0]["replaces"] == {"id": rules, "name": "rules.txt"}
    assert (later[2]["requirement_id"], later[2]["reason"]) == (
        case.first, "It answers another item.",
    )  # fmt: skip
    # A reader reads it; another firm, or another engagement, finds nothing.
    _reviewer_id, reviewer = _member(migrated, case.team, "REVIEWER")
    assert history(rules, reviewer).status_code == 200
    _seeded, _project, outsider, _admin = _team(migrated, f"rel-hist-{uuid4().hex[:4]}")
    assert history(rules, outsider).status_code == 404
    elsewhere = case.client.get(
        f"/organizations/{case.team['org']}/projects/{uuid4()}/evidence-files/{rules}/history"
    )
    assert elsewhere.status_code == 404
