"""The D&I evidence wizard's server (docs/evidence-wizard.md, section 2; migration 0158),
with scripted reader and assurance answers: the rules code enforces whatever a model says.

Evidence traceability and approval boundaries (critical tier):

- every file dropped is kept and shown, each with its stage, reading, classification and
  placement; the batch's state follows the contract's fields exactly;
- code places a file only where the model's sure reading lets one item stand out (the only
  item covered in full, or the only one its kind fits), on every item a bundle covers in
  full; a file the assurance gate would hold waits for a person with the gate's reason; a
  file that covers no item is kept in the control's files as not D&I evidence;
- a file from a row stays on the row's item: the reader only suggests a better fit;
- a placement is a filing for the item: the item's evidence is in hand as for a file
  added on it, and its check is queued once the batch's files have all been read;
- the reader's own model-derived findings are never proposed for a wizard file, the
  deterministic checks are;
- the attributes a file addresses come from its item's reviewed check, per file;
- a person's move supersedes the placement and keeps it, moves the filing, and the
  receipts and checks follow; a stale version is refused; placements are append-only;
- another firm sees nothing, a Reviewer reads and cannot move, an archived engagement
  changes nothing, and an upload may name only this control's D&I items and batch.
"""

import json
import re
import threading
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from support import Database
from test_design_evidence import _Case
from test_evidence_analysis import _no_ocr, _settings
from test_evidence_assurance import (
    APPROVAL,
    GRANT,
    LOG,
    POLICY,
    RULE,
    TICKET,
    _Readings,
    _Worker,
)
from test_evidence_intake import _client
from test_outbound import migrated
from test_projects import _seed_org

from ai_workforce_api import evidence_wizard as wizard_module
from ai_workforce_api.db import connect
from ai_workforce_api.evidence_analysis import fail_analysis, run_analysis
from ai_workforce_api.evidence_assurance import (
    HELD_REASONS,
    HeldCode,
    read_assurance,
    run_assessment,
)
from ai_workforce_api.evidence_receipts import _every_item_served, covered
from ai_workforce_api.evidence_wizard import (
    ADDED_ON_ITEM,
    CHANGED_REASON,
    LINKED_ON_LIST,
    MOVED_AWAY,
    NOT_DESIGN_REASON,
    PLACED_BY_PERSON,
    UNLINKED_ON_LIST,
    land_open_batches,
)
from ai_workforce_api.models import ModelConfig, ModelRaw, ModelRequest
from ai_workforce_api.pbc_drafting import run_draft

__all__ = ["migrated"]

MINUTES = "Minutes of the facilities meeting: the car park rota and the parking permits.\n"
NOTES = "Notes on access: requests are raised in the service desk tool and approved there.\n"
LISTING = "user,role,granted,approved_by\nDLEE,FI_AP_CLERK,2026-03-04,Priya Shah\n"
STATE_KEYS = {
    "batch_id", "control_id", "chosen_requirement_id", "created_at", "server_now", "stages",
    "files", "items",
}  # fmt: skip
STAGE_KEYS = {"stored", "read", "sorted", "checked_items", "items", "files"}
FILE_KEYS = {
    "file_id", "name", "size_bytes", "extension", "duplicate", "stage", "read", "classification",
    "placement", "addresses",
}  # fmt: skip
READ_KEYS = {"status", "method", "pages", "started_at", "finished_at", "note"}
CLASSIFICATION_KEYS = {"kind", "label", "confidence", "summary"}
PLACEMENT_KEYS = {"status", "method", "requirement_ids", "reason", "suggestions", "version"}
ITEM_KEYS = {"requirement_id", "title", "request_title", "letters", "file_ids", "assurance"}
PENDING = {
    "status": "PENDING", "method": "AGENT", "requirement_ids": [], "reason": "",
    "suggestions": [], "version": 0,
}  # fmt: skip


class _Reader:
    """The evidence reader, scripted for one file: what kind of evidence it is, how sure it
    is, and how it covers each item its prompt lists, named by the item's title."""

    def __init__(
        self,
        kind: str,
        confidence: str = "high",
        covers: dict[str, str] | None = None,
        **over: Any,
    ) -> None:
        self.kind = kind
        self.confidence = confidence
        self.covers = covers or {}
        self.over = over
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
        del config
        self.requests.append(request)
        found = re.search(r"<request_and_file>\n(.*?)\n</request_and_file>", request.prompt, re.S)
        assert found is not None
        facts = json.loads(found.group(1))
        answer: dict[str, Any] = {
            "kind": self.kind,
            "confidence": self.confidence,
            "summary": f"A {self.kind} file.",
            "reason": "From what the file shows.",
            "items": [
                {
                    "index": item["index"],
                    "coverage": self.covers.get(item["title"], "NOT_COVERED"),
                    "note": "",
                }
                for item in facts["request"]["items"]
            ],
            "gaps": [],
            "period": "",
            "application": "ALL",
        }
        return ModelRaw(answer | self.over, (), 800, 200)


def _shown_by(
    quotes: dict[str, tuple[str, str]], short: str = "B"
) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """A reading of an item's check: every attribute shown by the first file it reads that
    is quoted (with its passage and basis), except `short`, which no record shows."""

    def answer(facts: dict[str, Any]) -> dict[str, Any]:
        names = {str(f["name"]): int(f["index"]) for f in facts["files"]}
        cited = [
            {"file": names[name], "quote": quote, "basis": basis}
            for name, (quote, basis) in quotes.items()
            if name in names
        ][:1]
        return {
            "attributes": [
                {
                    "code": attribute["code"],
                    "reason": f"read for {attribute['code']}",
                    "elements": [
                        (
                            {
                                "result": "NOT_MET",
                                "quotes": [],
                                "reason": "not shown",
                                "absent": "No record that shows it.",
                            }
                            if attribute["code"] == short
                            else {"result": "MET", "quotes": cited, "absent": "", "reason": "shown"}
                        )
                        | {"element": element["key"]}
                        for element in attribute["elements"]
                    ],
                }  # fmt: skip
                for attribute in facts["attributes"]
            ]
        }

    return answer


# The first reading rests on the ticket (or the policy's rule); the second, blind to the
# first, on the change log (or the same rule).
FIRST = {
    "ticket REQ-1041.txt": (APPROVAL, "RECORD"),
    "access policy.txt": (RULE, "REQUIREMENT"),
}
SECOND = {
    "sap change log.txt": (GRANT, "RECORD"),
    "access policy.txt": (RULE, "REQUIREMENT"),
}


class _Wizard(_Case):
    """ITGC-AC-01 with its D&I evidence released (a policy item and a walkthrough item on
    one draft request), and a wizard session opened on its D&I list."""

    def __init__(self, database: Database, slug: str, drafted: bool = False) -> None:
        super().__init__(database, slug)
        if drafted:
            # The coordinator drafts the request, as it does in the background once the
            # D&I evidence is released: its normal state before anyone approves it.
            with connect(database.url) as connection:
                [(draft_id,)] = connection.execute(
                    "SELECT id FROM pbc_drafts WHERE pbc_request_id = %s", (self.request,)
                ).fetchall()
                assert run_draft(connection, None, draft_id) == "DRAFTED"
        self.policy = next(i for i in self.items if "PROCESS_DOCUMENTATION" in i["categories"])
        self.walkthrough = next(i for i in self.items if "CONTROL_EXECUTION" in i["categories"])
        self.worker = _Worker()
        self.owner = _client(database, self.team["owner_id"], self.worker)
        self.batch = str(uuid4())

    def url(self, batch: str | None = None, control: str | None = None) -> str:
        return (
            f"{self.base}/controls/{control or self.control}/evidence-batches/{batch or self.batch}"
        )

    def drop(
        self,
        name: str,
        text: str,
        *,
        requirement_id: str | None = None,
        batch: str | None = None,
        control: str | None = None,
        client: TestClient | None = None,
    ) -> Any:
        params = {"batch_id": batch or self.batch, "name": name,
                  "design_control_id": control or self.control}  # fmt: skip
        if requirement_id is not None:
            params["requirement_id"] = requirement_id
        return (client or self.owner).post(
            f"{self.base}/evidence-uploads",
            params=params,
            content=text.encode(),
            headers={"content-type": "text/plain"},
        )

    def add(self, name: str, text: str, **options: Any) -> str:
        added = self.drop(name, text, **options)
        assert added.status_code == 200, added.text
        assert added.json()["duplicate"] is False
        return str(added.json()["file_id"])

    def read_file(self, file_id: str, reader: _Reader | None, store: Any = None) -> str:
        """The evidence reader finishes the file, by the scripted answer (or the rules),
        reading the stored bytes through `store` where one is given."""
        [(analysis_id,)] = self.rows(
            "SELECT id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(file_id)
        )
        settings = _settings(self.database)
        with connect(self.database.url) as connection:
            if store is None:
                return run_analysis(connection, settings, reader, analysis_id, _no_ocr)
            return run_analysis(connection, settings, reader, analysis_id, _no_ocr, store)

    def state(self, client: TestClient | None = None) -> dict[str, Any]:
        found = (client or self.owner).get(self.url())
        assert found.status_code == 200, found.text
        body: dict[str, Any] = found.json()
        return body

    def file(self, file_id: str) -> dict[str, Any]:
        entry: dict[str, Any] = next(f for f in self.state()["files"] if f["file_id"] == file_id)
        return entry

    def place(
        self, file_id: str, items: list[str], version: int, client: TestClient | None = None
    ) -> Any:
        return (client or self.owner).post(
            f"{self.url()}/files/{file_id}/placement",
            json={"requirement_ids": items, "version": version},
        )

    def filing(self, file_id: str) -> tuple[Any, ...]:
        [row] = self.rows(
            "SELECT pbc_request_id, requirement_id, filed_by FROM evidence_matches "
            "WHERE evidence_file_id = %s AND status = 'FILED'",
            UUID(file_id),
        )
        return row

    def placements(self, file_id: str) -> list[tuple[Any, ...]]:
        return self.rows(
            "SELECT version, status, method, requirement_ids, supersedes_id IS NOT NULL "
            "FROM evidence_placements WHERE evidence_file_id = %s ORDER BY version",
            UUID(file_id),
        )

    def runs(self) -> list[tuple[Any, ...]]:
        return self.rows(
            "SELECT id, requirement_id, status, stale_at IS NOT NULL, file_ids "
            "FROM evidence_assessments WHERE engagement_control_id = %s ORDER BY created_at, id",
            UUID(self.control),
        )

    def check(self, readings: _Readings) -> list[str]:
        """The worker runs every queued check."""
        with connect(self.database.url) as connection:
            queued = connection.execute(
                "SELECT id FROM evidence_assessments WHERE status = 'PENDING' "
                "AND stale_at IS NULL AND engagement_control_id = %s ORDER BY created_at",
                (UUID(self.control),),
            ).fetchall()
            return [
                run_assessment(connection, _settings(self.database), readings, run_id)
                for (run_id,) in queued
            ]

    def findings(self, file_id: str) -> list[tuple[str, str]]:
        found = self.owner.get(f"{self.base}/controls/{self.control}/evidence-findings")
        assert found.status_code == 200, found.text
        return sorted(
            (str(f["source"]), str(f["kind"]))
            for f in found.json()["findings"]
            if f["file_id"] == file_id and not f["stale"]
        )

    def design_requests(self) -> list[str]:
        return [str(r["id"]) for r in self.design()["requests"]]


def _when(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _suggestion(item: dict[str, Any], reason: str) -> dict[str, Any]:
    return {"requirement_id": item["id"], "title": item["title"], "reason": reason}


@pytest.mark.parametrize("drafted", [False, True])
def test_a_batch_is_sorted_into_the_items_and_its_state_follows_the_contract(
    migrated: Database, drafted: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = _Wizard(migrated, f"sort{int(drafted)}", drafted)
    # Polling stays cheap: the assurance chain is read once per state, and not at all
    # before any placed item has a check.
    reads: list[UUID] = []

    def counted(connection: Any, project_id: UUID, control_id: UUID, *rest: Any) -> Any:
        reads.append(control_id)
        return read_assurance(connection, project_id, control_id, *rest)

    monkeypatch.setattr(wizard_module, "read_assurance", counted)
    policy_item, walk_item = case.policy, case.walkthrough
    files = {
        "policy": case.add("access policy.txt", POLICY),
        "ticket": case.add("ticket REQ-1041.txt", TICKET),
        "log": case.add("sap change log.txt", LOG),
        "minutes": case.add("parking minutes.txt", MINUTES),
        "notes": case.add("access notes.txt", NOTES),
    }
    # Stored with their custody records, waiting to be read: kept in the control's files,
    # on no request, and placed nowhere yet.
    waiting = case.state()
    assert set(waiting) == STATE_KEYS
    assert waiting["stages"] == {
        "stored": 5, "read": 0, "sorted": 0, "checked_items": 0, "items": 0, "files": 5,
    }  # fmt: skip
    assert [f["file_id"] for f in waiting["files"]] == list(files.values())
    for entry in waiting["files"]:
        assert (entry["stage"], entry["read"]["status"], entry["read"]["method"]) == (
            "STORED", "PENDING", "NONE",
        )  # fmt: skip
        assert entry["placement"] == PENDING and entry["classification"] is None
        assert entry["read"]["started_at"] is None and entry["addresses"] == []
    assert all(case.filing(file_id) == (None, None, "PERSON") for file_id in files.values())
    readers = {
        "policy": _Reader("policy", covers={policy_item["title"]: "COVERED"}),
        "ticket": _Reader("walkthrough", covers={walk_item["title"]: "COVERED"}),
        "log": _Reader("change_history", covers={walk_item["title"]: "PARTIAL"}),
        "minutes": _Reader("other"),
        "notes": _Reader(
            "walkthrough", "low",
            covers={walk_item["title"]: "PARTIAL", policy_item["title"]: "PARTIAL"},
        ),
    }  # fmt: skip
    for name in ("policy", "ticket", "log", "minutes"):
        assert case.read_file(files[name], readers[name]) == "READY"
        # The batch is still being read: no check is queued and no request has moved, so
        # files that arrive together are checked once.
        assert case.runs() == []
        assert case.read(case.request)["status"] == "DRAFT"
        # Each item holding a file is listed as not checked yet, never silently skipped.
        assert {i["assurance"]["status"] for i in case.state()["items"]} == {"NOT_CHECKED"}
    assert reads == []
    assert case.read_file(files["notes"], readers["notes"]) == "READY"
    # Each reading weighed every D&I item of the control, by its own wording, categories
    # and the attributes it links.
    for reader in readers.values():
        [asked] = reader.requests
        assert policy_item["title"] in asked.prompt and walk_item["title"] in asked.prompt
        assert "Evidence category: Control execution." in asked.prompt
        assert "Attributes it addresses: A. " in asked.prompt

    state = case.state()
    assert set(state) == STATE_KEYS
    assert (state["batch_id"], state["control_id"], state["chosen_requirement_id"]) == (
        case.batch, case.control, None,
    )  # fmt: skip
    assert _when(state["created_at"]) <= _when(state["server_now"])
    assert set(state["stages"]) == STAGE_KEYS
    assert state["stages"] == {
        "stored": 5, "read": 5, "sorted": 5, "checked_items": 0, "items": 2, "files": 5,
    }  # fmt: skip
    # Nothing lost: every file dropped is listed, once, in the order it was added.
    assert [f["file_id"] for f in state["files"]] == list(files.values())
    by_id = {f["file_id"]: f for f in state["files"]}
    for entry in state["files"]:
        assert set(entry) == FILE_KEYS and set(entry["read"]) == READ_KEYS
        assert set(entry["classification"]) == CLASSIFICATION_KEYS
        assert set(entry["placement"]) == PLACEMENT_KEYS
        assert (entry["read"]["status"], entry["read"]["method"]) == ("READY", "TEXT")
        assert _when(entry["read"]["started_at"]) <= _when(entry["read"]["finished_at"])
        assert entry["extension"] == "txt" and entry["size_bytes"] > 0
        assert entry["addresses"] == []
    policy = by_id[files["policy"]]
    assert policy["name"] == "access policy.txt" and policy["stage"] == "SORTED"
    assert policy["classification"] == {
        "kind": "policy", "label": "Policy or procedure", "confidence": "high",
        "summary": "A policy file.",
    }  # fmt: skip
    assert policy["placement"] == {
        "status": "PLACED", "method": "AGENT", "requirement_ids": [policy_item["id"]],
        "reason": f"The reader found it covers “{policy_item['title']}”.",
        "suggestions": [], "version": 1,
    }  # fmt: skip
    ticket, log = by_id[files["ticket"]], by_id[files["log"]]
    assert ticket["stage"] == log["stage"] == "SORTED"
    assert ticket["placement"]["requirement_ids"] == [walk_item["id"]]
    # Covered only in part, it is the only item a change log fits.
    assert log["placement"]["requirement_ids"] == [walk_item["id"]]
    assert log["placement"]["method"] == "AGENT"
    assert "in part, and it is the only item" in log["placement"]["reason"]
    minutes = by_id[files["minutes"]]
    assert (minutes["stage"], minutes["placement"]["status"]) == ("NOT_DESIGN", "NOT_DESIGN")
    assert minutes["placement"]["reason"] == NOT_DESIGN_REASON
    assert minutes["placement"]["requirement_ids"] == []
    # Not sure what it is: the gate would hold it, so a person chooses, with the items
    # ranked (the one its kind fits first).
    notes = by_id[files["notes"]]
    assert (notes["stage"], notes["placement"]["status"]) == ("NEEDS_PERSON", "NEEDS_PERSON")
    assert notes["placement"]["reason"] == HELD_REASONS["KIND_UNSURE"]
    assert notes["classification"]["confidence"] == "low"
    in_part = "The reader found it covers this item in part."
    assert notes["placement"]["suggestions"] == [
        _suggestion(walk_item, in_part), _suggestion(policy_item, in_part),
    ]  # fmt: skip
    # Each placement is a filing on its item's request for that item; the files that are
    # not placed stay in the control's files.
    request = UUID(case.request)
    assert case.filing(files["policy"]) == (request, UUID(policy_item["id"]), "AGENT")
    assert case.filing(files["ticket"]) == (request, UUID(walk_item["id"]), "AGENT")
    assert case.filing(files["log"]) == (request, UUID(walk_item["id"]), "AGENT")
    assert case.filing(files["minutes"]) == (None, None, "PERSON")
    assert case.filing(files["notes"]) == (None, None, "PERSON")
    # One card per item that received files, each with its letters and its check.
    items = {item["requirement_id"]: item for item in state["items"]}
    assert set(items) == {policy_item["id"], walk_item["id"]}
    for item in state["items"]:
        assert set(item) == ITEM_KEYS
        assert item["request_title"] == f"Request PBC-{UUID(case.request).hex[-8:].upper()}"
        assert item["assurance"]["status"] == "QUEUED"
    assert items[walk_item["id"]]["letters"] == ["A", "B", "C", "D", "E"]
    assert items[policy_item["id"]]["letters"] == []
    assert items[walk_item["id"]]["file_ids"] == [files["ticket"], files["log"]]
    assert set(items[walk_item["id"]]["assurance"]["file_ids"]) == {files["ticket"], files["log"]}
    assert items[policy_item["id"]]["file_ids"] == [files["policy"]]
    assert items[walk_item["id"]]["title"] == walk_item["title"]
    # Both items in hand when the batch had been read: the request is received as provided
    # directly, whole; nothing is split off or sent.
    received = case.read(case.request)
    assert (received["status"], received["provided_directly"]) == ("RECEIVED", True)
    assert case.design_requests() == [case.request]
    assert case.count("outbound_messages") == 0
    # One check per item, queued once its files had all been read.
    queued = {(str(r[1]), r[2], r[3], frozenset(str(f) for f in r[4])) for r in case.runs()}
    assert queued == {
        (policy_item["id"], "PENDING", False, frozenset({files["policy"]})),
        (walk_item["id"], "PENDING", False, frozenset({files["ticket"], files["log"]})),
    }

    # The attributes a file addresses: the letters whose verified passages in its item's
    # reviewed check are in that file, with the attribute's verdict.
    assert case.check(_Readings(_shown_by(FIRST), _shown_by(SECOND))) == ["READY", "READY"]
    reviewed = case.state()
    assert reads == [UUID(case.control)] * 2, "once per state, once its items have checks"
    assert reviewed["stages"]["checked_items"] == 2
    by_id = {f["file_id"]: f for f in reviewed["files"]}
    supported = [{"code": code, "verdict": "SUPPORTED"} for code in "ACDE"]
    # The ticket holds the first reading's passages, the change log the second's; neither
    # holds one for B, which no record shows.
    assert by_id[files["ticket"]]["addresses"] == supported
    assert by_id[files["log"]]["addresses"] == supported
    assert by_id[files["policy"]]["addresses"] == supported
    assert by_id[files["minutes"]]["addresses"] == by_id[files["notes"]]["addresses"] == []
    check = next(i for i in reviewed["items"] if i["requirement_id"] == walk_item["id"])
    assert check["assurance"]["status"] == "REVIEWED"
    verdicts = {a["code"]: a["verdict"] for a in check["assurance"]["attributes"]}
    assert verdicts["B"] == "ISSUE" and verdicts["A"] == "SUPPORTED"


def test_a_file_from_a_row_stays_on_the_row_and_the_reader_only_suggests(
    migrated: Database,
) -> None:
    case = _Wizard(migrated, "row")
    row, other = case.walkthrough, case.policy
    policy = case.add("access policy.txt", POLICY, requirement_id=row["id"])
    ticket = case.add("ticket REQ-1041.txt", TICKET, requirement_id=row["id"])
    # Placed on the row's item as it was added: the person's choice, on the item's request.
    added = case.file(policy)
    assert added["stage"] == "STORED"
    assert added["placement"] == {
        "status": "PLACED", "method": "PERSON", "requirement_ids": [row["id"]],
        "reason": ADDED_ON_ITEM, "suggestions": [], "version": 1,
    }  # fmt: skip
    assert case.state()["chosen_requirement_id"] == row["id"]
    assert case.filing(policy) == (UUID(case.request), UUID(row["id"]), "PERSON")
    # The reader is sure the policy fits the policy item better; it agrees about the ticket.
    case.read_file(policy, _Reader("policy", covers={other["title"]: "COVERED"}))
    case.read_file(ticket, _Reader("walkthrough", covers={row["title"]: "COVERED"}))
    placed = case.file(policy)
    assert placed["stage"] == "SORTED"
    assert placed["placement"] == {
        "status": "PLACED", "method": "PERSON", "requirement_ids": [row["id"]],
        "reason": ADDED_ON_ITEM,
        "suggestions": [
            _suggestion(
                other,
                f"This looks like a policy or procedure. Move it to “{other['title']}”?",
            )
        ],
        "version": 2,
    }  # fmt: skip
    # Nothing moved without a person: still filed on the row's item; the first placement
    # is kept, superseded by the one that carries the suggestion.
    assert case.filing(policy) == (UUID(case.request), UUID(row["id"]), "PERSON")
    assert case.placements(policy) == [
        (1, "PLACED", "PERSON", [UUID(row["id"])], False),
        (2, "PLACED", "PERSON", [UUID(row["id"])], True),
    ]
    agreed = case.file(ticket)
    assert agreed["placement"]["suggestions"] == [] and agreed["placement"]["version"] == 1
    assert [f["file_id"] for f in case.item(row["id"])["files"]] == [policy, ticket]
    # A batch opened from a row takes its files for that row only.
    elsewhere = case.drop("another.txt", NOTES, requirement_id=other["id"])
    assert elsewhere.status_code == 409 and "another item" in elsewhere.json()["detail"]


def test_a_bundle_is_placed_on_every_item_it_covers_in_full(migrated: Database) -> None:
    case = _Wizard(migrated, "bundle")
    pack = case.add("access pack.txt", POLICY + TICKET)
    covers = {case.policy["title"]: "COVERED", case.walkthrough["title"]: "COVERED"}
    case.read_file(pack, _Reader("walkthrough", covers=covers))
    entry = case.file(pack)
    assert entry["placement"]["status"] == "PLACED"
    assert entry["placement"]["requirement_ids"] == [case.policy["id"], case.walkthrough["id"]]
    assert entry["placement"]["reason"].startswith("The reader found it covers each of these")
    # Filed on the request for its first item, and linked to the other by the agent.
    assert case.filing(pack) == (UUID(case.request), UUID(case.policy["id"]), "AGENT")
    assert case.rows(
        "SELECT requirement_id, status, origin, linked_by FROM evidence_requirement_files "
        "WHERE evidence_file_id = %s",
        UUID(pack),
    ) == [(UUID(case.walkthrough["id"]), "LINKED", "AGENT", None)]
    # Each item counts it as its own evidence: the request is received whole.
    for item in (case.policy, case.walkthrough):
        held = case.item(item["id"])
        assert [f["file_id"] for f in held["files"]] == [pack] and held["in_hand"] is True
    assert case.read(case.request)["status"] == "RECEIVED"
    assert {(str(r[1]), r[2], tuple(str(f) for f in r[4])) for r in case.runs()} == {
        (case.policy["id"], "PENDING", (pack,)),
        (case.walkthrough["id"], "PENDING", (pack,)),
    }
    # A person confirms the agent's placement: the same filing, now theirs.
    confirmed = case.place(pack, [case.policy["id"], case.walkthrough["id"]], 1)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["placement"]["method"] == "PERSON"
    assert confirmed.json()["placement"]["version"] == 2
    assert case.filing(pack) == (UUID(case.request), UUID(case.policy["id"]), "PERSON")
    assert [r[2] for r in case.runs()] == ["PENDING", "PENDING"]


def test_a_file_the_gate_would_hold_is_not_placed_and_waits_for_a_person(
    migrated: Database,
) -> None:
    case = _Wizard(migrated, "gate")
    walk = case.walkthrough["title"]
    blank = case.add("scan.txt", "   \n")
    unsure = case.add("access notes.txt", NOTES)
    listing = case.add("new users.txt", LISTING)
    tampered = case.add("approval.txt", TICKET + "Ticket closed.\n")
    broken = case.add("export.txt", TICKET)
    never = _Reader("walkthrough", covers={walk: "COVERED"})
    case.read_file(blank, never)
    case.read_file(unsure, _Reader("walkthrough", "low", covers={walk: "COVERED"}))
    case.read_file(listing, _Reader("population", covers={walk: "COVERED"}))

    class Tampered:
        """The stored object no longer matches its custody record."""

        def put(self, key: str, content: bytes) -> str:
            raise AssertionError("never written")

        def get(self, key: str) -> bytes:
            return b"Approved by: nobody\n"

    assert case.read_file(tampered, never, lambda _settings, _connection: Tampered()) == "FAILED"
    # The last reading does not finish: after its last attempt it is failed.
    [(analysis_id,)] = case.rows(
        "SELECT id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(broken)
    )
    with connect(migrated.url) as connection:
        fail_analysis(connection, analysis_id)
    assert never.requests == [], "nothing readable, so the model is never asked"
    held: list[tuple[str, HeldCode, str]] = [
        (blank, "UNREADABLE", "NEEDS_PERSON"),
        (unsure, "KIND_UNSURE", "NEEDS_PERSON"),
        (listing, "POPULATION", "NEEDS_PERSON"),
        (tampered, "CUSTODY", "FAILED"),
        (broken, "READ_FAILED", "FAILED"),
    ]
    for file_id, code, stage in held:
        entry = case.file(file_id)
        assert (entry["stage"], entry["placement"]["status"]) == (stage, "NEEDS_PERSON")
        assert entry["placement"]["reason"] == HELD_REASONS[code]
        assert entry["placement"]["requirement_ids"] == []
        assert case.filing(file_id) == (None, None, "PERSON")
    # Even the file the reader thought covered the walkthrough is only a suggestion.
    assert [s["requirement_id"] for s in case.file(unsure)["placement"]["suggestions"]] == [
        case.walkthrough["id"]
    ]
    # Nothing is on an item: no check, and the request has not moved.
    assert case.runs() == []
    assert case.read(case.request)["status"] == "DRAFT"
    assert case.state()["stages"]["sorted"] == 5


def test_the_readers_own_findings_are_held_for_a_wizard_file_and_the_checks_stay(
    migrated: Database,
) -> None:
    case = _Wizard(migrated, "findings")
    policy = case.add("access policy.txt", POLICY)
    gaps: dict[str, Any] = {
        "gaps": ["The emergency approval timeframe is not stated."],
        "follow_ups": [{"gap_index": 0, "question": "Please state the emergency timeframe."}],
    }
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "PARTIAL"}, **gaps))
    # Covered in part, and the only item a policy fits: placed there.
    entry = case.file(policy)
    assert entry["placement"]["requirement_ids"] == [case.policy["id"]]
    # The reader's own findings (its gap, the item it covers in part) are not proposed; the
    # deterministic check, located in the text, is.
    assert case.findings(policy) == [("RULES", "PLACEHOLDER")]
    assert case.rows(
        "SELECT classification -> 'gaps' FROM evidence_analyses WHERE evidence_file_id = %s",
        UUID(policy),
    ) == [(gaps["gaps"],)]


def _in_hand(case: _Wizard, file_id: str) -> tuple[Any, ...]:
    """What the evidence in hand did to the D&I requests: the request the file is on, its
    items, and the request the other item is asked for on."""
    first = case.read(case.request)
    held, other = case.item(case.policy["id"]), case.item(case.walkthrough["id"])
    asked = case.read(str(other["request_id"]))
    filed = case.filing(file_id)
    return (
        (filed[0] == UUID(case.request), filed[1] == UUID(case.policy["id"])),
        (first["status"], first["provided_directly"]),
        (held["in_hand"], held["request_id"] == case.request, held["state"]),
        (other["in_hand"], other["status"], other["request_id"] == case.request),
        (
            asked["status"],
            asked["drafted_by"],
            case.policy["title"] in asked["evidence_description"],
        ),
        len(case.design_requests()),
        len(case.audit("pbc.items_requested_separately", case.request)),
        case.count("outbound_messages"),
    )


@pytest.mark.parametrize("drafted", [False, True])
def test_a_placement_puts_its_item_in_hand_as_a_file_added_on_the_item_does(
    migrated: Database, drafted: bool
) -> None:
    # Placed by the agent in the wizard.
    wizard = _Wizard(migrated, f"hand-a{int(drafted)}", drafted)
    placed = wizard.add("access policy.txt", POLICY)
    wizard.read_file(placed, _Reader("policy", covers={wizard.policy["title"]: "COVERED"}))
    # Added on the item's row as before the wizard.
    row = _Wizard(migrated, f"hand-b{int(drafted)}", drafted)
    added = row.owner.post(
        f"{row.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "access policy.txt",
                "request_id": row.request, "requirement_id": row.policy["id"]},
        content=POLICY.encode(), headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    row.read_file(
        added.json()["file_id"], _Reader("policy", covers={row.policy["title"]: "COVERED"})
    )
    outcome = _in_hand(wizard, placed)
    assert outcome == _in_hand(row, added.json()["file_id"])
    # The item in hand is received as provided directly; the other is asked for on its
    # own, in a draft that needs a person's approval; nothing is sent.
    assert outcome[1] == ("RECEIVED", True) and outcome[2][0] is True
    assert outcome[3][:2] == (False, "REQUESTED") and outcome[4][0] == "DRAFT"
    assert outcome[5:] == (2, 1, 0)


def test_a_person_moves_a_file_and_its_receipts_and_checks_follow(migrated: Database) -> None:
    case = _Wizard(migrated, "move")
    policy_item, walk_item = case.policy, case.walkthrough
    policy = case.add("access policy.txt", POLICY)
    case.read_file(policy, _Reader("policy", covers={policy_item["title"]: "COVERED"}))
    first = case.request
    asked = str(case.item(walk_item["id"])["request_id"])
    assert asked != first and case.read(first)["status"] == "RECEIVED"
    assert case.check(_Readings(_shown_by(FIRST), _shown_by(SECOND))) == ["READY"]
    assert case.file(policy)["addresses"] != []
    [(old_run, *_rest)] = case.runs()
    # A stale version is refused, and nothing changes.
    stale = case.place(policy, [walk_item["id"]], 0)
    assert stale.status_code == 409 and stale.json()["detail"] == "the placement changed"
    # A person moves the policy to the walkthrough item.
    moved = case.place(policy, [walk_item["id"]], 1)
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert set(body) == FILE_KEYS and body["stage"] == "SORTED"
    assert body["placement"] == {
        "status": "PLACED", "method": "PERSON", "requirement_ids": [walk_item["id"]],
        "reason": PLACED_BY_PERSON, "suggestions": [], "version": 2,
    }  # fmt: skip
    # The new item's check has not run, so the file addresses nothing there yet.
    assert body["addresses"] == []
    # The earlier placement is superseded and kept.
    assert case.placements(policy) == [
        (1, "PLACED", "AGENT", [UUID(policy_item["id"])], False),
        (2, "PLACED", "PERSON", [UUID(walk_item["id"])], True),
    ]
    # The filing moved; the requests follow the evidence: the one it left is a draft
    # again for its item, the one it went to is received as provided directly.
    assert case.filing(policy) == (UUID(asked), UUID(walk_item["id"]), "PERSON")
    left = case.read(first)
    assert (left["status"], left["provided_directly"]) == ("DRAFT", False)
    assert (case.read(asked)["status"], case.read(asked)["provided_directly"]) == ("RECEIVED", True)
    assert case.item(policy_item["id"])["in_hand"] is False
    assert case.item(walk_item["id"])["in_hand"] is True
    # The old item's check is out of date; the new item's is queued and handed over.
    runs = {(str(r[1]), r[2], r[3]): r for r in case.runs()}
    assert set(runs) == {
        (policy_item["id"], "READY", True), (walk_item["id"], "PENDING", False),
    }  # fmt: skip
    new_run = runs[(walk_item["id"], "PENDING", False)][0]
    assert [str(f) for f in runs[(walk_item["id"], "PENDING", False)][4]] == [policy]
    assert case.worker.assessments == [new_run] and old_run != new_run
    [(action, payload)] = case.rows(
        "SELECT action, payload FROM audit_events WHERE target_id = %s "
        "AND action = 'evidence.placement_moved'",
        UUID(policy),
    )
    assert payload["from"] == [policy_item["id"]] and payload["requirement_ids"] == [
        walk_item["id"]
    ]
    # The same version again is stale now.
    assert case.place(policy, [policy_item["id"]], 1).status_code == 409
    # Out of D&I: kept in the control's files, on no request; its request follows.
    out = case.place(policy, [], 2)
    assert out.status_code == 200, out.text
    assert out.json()["stage"] == "NOT_DESIGN"
    assert out.json()["placement"]["status"] == "NOT_DESIGN"
    assert out.json()["placement"]["version"] == 3
    assert case.filing(policy) == (None, None, "PERSON")
    assert case.read(asked)["status"] == "DRAFT"
    assert case.state()["items"] == []
    # An item it may not go to, or the same item twice, is refused.
    assert case.place(policy, [str(uuid4())], 3).status_code == 409
    twice = case.place(policy, [walk_item["id"], walk_item["id"]], 3)
    assert twice.status_code == 409 and twice.json()["detail"] == "name each item once"


def test_who_may_read_and_move_and_what_an_upload_may_name(migrated: Database) -> None:
    case = _Wizard(migrated, "roles")
    policy = case.add("access policy.txt", POLICY)
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "COVERED"}))
    move_to = [case.walkthrough["id"]]
    # A Reviewer reads, and can neither move a file nor add one.
    _reviewer_id, reviewer = case.member("REVIEWER")
    assert case.state(reviewer)["files"][0]["file_id"] == policy
    assert case.place(policy, move_to, 1, reviewer).status_code == 403
    assert case.drop("more.txt", NOTES, client=reviewer).status_code == 403
    # Another firm's person sees nothing.
    with connect(migrated.url) as connection:
        stranger = _seed_org(
            connection, f"wizard-{uuid4().hex[:6]}", f"{uuid4().hex[:8]}@example.com"
        )
    outsider = _client(migrated, stranger["user_id"], None)
    assert outsider.get(case.url()).status_code == 404
    assert case.place(policy, move_to, 1, outsider).status_code == 404
    assert case.drop("more.txt", NOTES, client=outsider).status_code == 404
    # A batch is read only under its own control; an unknown batch is not found.
    other_control = str(
        case.rows(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
            "AND id <> %s ORDER BY control_ref LIMIT 1",
            case.team["project"], UUID(case.control),
        )[0][0]
    )  # fmt: skip
    assert case.owner.get(case.url(control=other_control)).status_code == 404
    assert case.owner.get(case.url(batch=str(uuid4()))).status_code == 404
    # An upload names only this control's D&I items that still expect evidence.
    foreign = str(
        case.rows(
            "SELECT id FROM evidence_requirements WHERE project_id = %s AND phase = 'DESIGN' "
            "AND engagement_control_id <> %s LIMIT 1",
            case.team["project"], UUID(case.control),
        )[0][0]
    )  # fmt: skip
    interim = str(
        case.rows(
            "SELECT id FROM evidence_requirements WHERE engagement_control_id = %s "
            "AND phase = 'INTERIM' LIMIT 1",
            UUID(case.control),
        )[0][0]
    )
    for requirement_id in (foreign, interim):
        refused = case.drop("more.txt", NOTES, requirement_id=requirement_id, batch=str(uuid4()))
        assert refused.status_code == 409
        assert "D&I items that still expect evidence" in refused.json()["detail"]
    # A batch keeps its control, and a plain upload never joins a wizard batch.
    reused = case.drop("more.txt", NOTES, control=other_control)
    assert reused.status_code == 409 and "another control" in reused.json()["detail"]
    plain = case.owner.post(
        f"{case.base}/evidence-uploads", params={"batch_id": case.batch, "name": "more.txt"},
        content=NOTES.encode(), headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert plain.status_code == 409 and "wizard" in plain.json()["detail"]
    # A control that is not this engagement's is not found.
    assert case.drop("more.txt", NOTES, control=str(uuid4()), batch=str(uuid4())).status_code == 404
    # The same file dropped again is the one held: nothing new is stored.
    again = case.drop("access policy.txt", POLICY)
    assert again.status_code == 200 and again.json() == {
        "file_id": policy, "file_name": "access policy.txt", "folder_path": "", "duplicate": True,
    }  # fmt: skip
    assert len(case.state()["files"]) == 1
    # Placements and batches are kept as written.
    with connect(migrated.url) as connection:
        for statement in (
            "UPDATE evidence_placements SET reason = 'Changed afterwards.'",
            "DELETE FROM evidence_placements",
            "UPDATE evidence_batches SET created_at = created_at - interval '1 day'",
            "UPDATE evidence_batches SET landed_at = NULL",
            "UPDATE evidence_batches SET landed_at = landed_at - interval '1 hour'",
            "DELETE FROM evidence_batches",
        ):
            with pytest.raises(psycopg.Error), connection.transaction():
                connection.execute(statement)
    # An archived engagement is read, and changes nothing.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (case.team["project"],)
        )
    assert case.state()["files"][0]["placement"]["version"] == 1
    assert case.place(policy, move_to, 1).status_code == 409
    assert case.drop("late.txt", NOTES).status_code == 409
    assert case.placements(policy) == [(1, "PLACED", "AGENT", [UUID(case.policy["id"])], False)]


# --- After the independent review of 13 November 2026 (probes P1 to P9) ----------------

BATCH_KEYS = {
    "batch_id", "created_at", "created_by_name", "chosen_requirement_id", "files",
    "in_progress", "needs_person", "not_design", "finished", "finished_at",
}  # fmt: skip


def _row_upload(case: _Wizard, item: dict[str, Any], name: str, text: str) -> str:
    """A file added on an item's row as before the wizard (no design_control_id)."""
    added = case.owner.post(
        f"{case.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": name, "request_id": item["request_id"],
                "requirement_id": item["id"]},
        content=text.encode(), headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert added.status_code == 200, added.text
    return str(added.json()["file_id"])


def _items_now(case: _Wizard) -> dict[str, tuple[Any, ...]]:
    """Per item: whether it is in hand, its status, and whether the first request still
    carries it."""
    found: dict[str, tuple[Any, ...]] = {}
    for key, item in (("policy", case.policy), ("walkthrough", case.walkthrough)):
        now = case.item(item["id"])
        found[key] = (now["in_hand"], now["status"], now["request_id"] == case.request)
    return found


def _outcome(case: _Wizard, approval_id: str) -> dict[str, Any]:
    first = case.read(case.request)
    return {
        "request": (first["status"], first["provided_directly"]),
        "items": _items_now(case),
        "requests": len(case.design_requests()),
        "split": len(case.audit("pbc.items_requested_separately", case.request)),
        "approval": case.rows(
            "SELECT decision::text, execution_status::text FROM approvals WHERE id = %s",
            UUID(approval_id),
        ),
        "sent": case.count("outbound_messages"),
    }


def _other_control(case: _Wizard) -> str:
    """An in-scope control of the engagement other than ITGC-AC-01 and its instances."""
    [(control_id,)] = case.rows(
        "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
        "AND control_ref <> (SELECT control_ref FROM engagement_controls WHERE id = %s) "
        "ORDER BY control_ref LIMIT 1",
        case.team["project"], UUID(case.control),
    )  # fmt: skip
    return str(control_id)


def _refile(case: _Wizard, file_id: str, control_id: str | None) -> Any:
    """The Evidence center files the file to a control (None: off its control)."""
    [(version,)] = case.rows(
        "SELECT version FROM evidence_matches WHERE evidence_file_id = %s", UUID(file_id)
    )
    return case.owner.post(
        f"{case.base}/evidence-files/{file_id}/filing",
        json={"control_id": control_id, "version": version},
    )


def _analysis(case: _Wizard, file_id: str) -> str:
    [(analysis_id,)] = case.rows(
        "SELECT id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(file_id)
    )
    return str(analysis_id)


def test_a_file_from_a_row_counts_only_for_its_item_on_a_drafted_request(
    migrated: Database,
) -> None:
    """P1, the blocker: a wizard file is read against every D&I item of its control, and a
    combined file added from the walkthrough's row was counted for the policy item too,
    on a request the coordinator had drafted: the whole request was received, its approval
    withdrawn, and the policy item never asked for. A file filed for an item counts only
    for that item and those it is linked to: the outcome is the one the same file added on
    the row before the wizard has."""
    outcomes: dict[str, dict[str, Any]] = {}
    for mode in ("wizard", "plain"):
        case = _Wizard(migrated, f"p1{mode}", drafted=True)
        approved = case.approve(case.request)
        assert approved.status_code == 200, approved.text
        approval_id = str(approved.json()["approval"]["id"])
        covers = {item["title"]: "COVERED" for item in case.items}
        if mode == "wizard":
            file_id = case.add(
                "access pack.txt", POLICY + TICKET, requirement_id=case.walkthrough["id"]
            )
        else:
            file_id = _row_upload(case, case.walkthrough, "access pack.txt", POLICY + TICKET)
        assert case.read_file(file_id, _Reader("walkthrough", covers=covers)) == "READY"
        assert case.filing(file_id)[1] == UUID(case.walkthrough["id"])
        outcomes[mode] = _outcome(case, approval_id)
    assert outcomes["wizard"] == outcomes["plain"]
    found = outcomes["wizard"]
    # The row's item is in hand on its request, received as provided directly; the policy
    # item is asked for again in a draft of its own; the earlier approval sends nothing.
    assert found["request"] == ("RECEIVED", True)
    assert found["items"] == {
        "policy": (False, "REQUESTED", False), "walkthrough": (True, "REQUESTED", True),
    }  # fmt: skip
    assert (found["requests"], found["split"], found["sent"]) == (2, 1, 0)
    [(decision, execution)] = found["approval"]
    assert (decision, execution) != ("APPROVED", "NOT_STARTED")


@pytest.mark.parametrize("drafted", [False, True])
def test_moving_a_bundle_off_an_item_asks_for_that_item_again(
    migrated: Database, drafted: bool
) -> None:
    """P2: a bundle placed on both items, moved by a person to the walkthrough alone. Its
    request was only ever provided directly, so the item left without evidence is asked
    for again in a draft of its own (it needs approval like any other); the request keeps
    the item in hand, received as provided directly."""
    case = _Wizard(migrated, f"p2{int(drafted)}", drafted)
    pack = case.add("access pack.txt", POLICY + TICKET)
    covers = {item["title"]: "COVERED" for item in case.items}
    case.read_file(pack, _Reader("walkthrough", covers=covers))
    assert case.read(case.request)["status"] == "RECEIVED"
    assert _items_now(case) == {
        "policy": (True, "REQUESTED", True), "walkthrough": (True, "REQUESTED", True),
    }  # fmt: skip
    moved = case.place(pack, [case.walkthrough["id"]], 1)
    assert moved.status_code == 200, moved.text
    first = case.read(case.request)
    assert (first["status"], first["provided_directly"]) == ("RECEIVED", True)
    assert _items_now(case) == {
        "policy": (False, "REQUESTED", False), "walkthrough": (True, "REQUESTED", True),
    }  # fmt: skip
    again = case.read(str(case.item(case.policy["id"])["request_id"]))
    assert again["status"] == "DRAFT"
    assert case.policy["title"] in again["evidence_description"]
    assert case.count("outbound_messages") == 0
    [(_actor, _agent, split)] = case.audit("pbc.items_requested_separately", case.request)
    assert split["requirements"] == [case.policy["id"]]
    [(moved_payload,)] = case.rows(
        "SELECT payload FROM audit_events WHERE target_id = %s "
        "AND action = 'evidence.placement_moved'",
        UUID(pack),
    )
    assert moved_payload["asked_again"] == [case.request]


def test_a_file_filed_to_another_control_never_keeps_its_batch_from_landing(
    migrated: Database,
) -> None:
    """P3: a file of the batch filed to another control in the Evidence center (its reading
    starts again there) is not the batch's to wait for: the batch lands once its own files
    are read. Its placement is superseded by a person's, kept, that says where it went."""
    case = _Wizard(migrated, "p3")
    policy = case.add("access policy.txt", POLICY)
    ticket = case.add("ticket REQ-1041.txt", TICKET)
    minutes = case.add("parking minutes.txt", MINUTES)
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "COVERED"}))
    case.read_file(minutes, _Reader("other"))
    refiled = _refile(case, minutes, _other_control(case))
    assert refiled.status_code == 200, refiled.text
    assert case.rows(
        "SELECT status FROM evidence_analyses WHERE evidence_file_id = %s", UUID(minutes)
    ) == [("PENDING",)]
    entry = case.file(minutes)
    assert (entry["stage"], entry["placement"]["status"], entry["placement"]["method"]) == (
        "NOT_DESIGN", "NOT_DESIGN", "PERSON",
    )  # fmt: skip
    assert entry["placement"]["reason"] == MOVED_AWAY
    assert [row[1:3] for row in case.placements(minutes)] == [
        ("NOT_DESIGN", "AGENT"), ("NOT_DESIGN", "PERSON"),
    ]  # fmt: skip
    walk = {case.walkthrough["title"]: "COVERED"}
    assert case.read_file(ticket, _Reader("walkthrough", covers=walk)) == "READY"
    assert {(str(r[1]), r[2]) for r in case.runs()} == {
        (case.policy["id"], "PENDING"), (case.walkthrough["id"], "PENDING"),
    }  # fmt: skip
    assert case.read(case.request)["status"] == "RECEIVED"
    state = case.state()
    assert state["stages"] == {
        "stored": 3, "read": 3, "sorted": 3, "checked_items": 0, "items": 2, "files": 3,
    }  # fmt: skip
    assert all(minutes not in item["file_ids"] for item in state["items"])
    assert case.rows(
        "SELECT landed_at IS NOT NULL FROM evidence_batches WHERE id = %s", UUID(case.batch)
    ) == [(True,)]


def test_a_file_moved_by_another_flow_is_shown_where_it_is(migrated: Database) -> None:
    """P4: the D&I list's link and unlink, and the Evidence center's filing, move a wizard
    file outside the wizard: each records a person's placement that supersedes the one
    before (kept), and the state shows the file where it is, never where it was."""
    case = _Wizard(migrated, "p4")
    policy = case.add("access policy.txt", POLICY)
    notes = case.add("access notes.txt", NOTES)
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "COVERED"}))
    case.read_file(notes, _Reader("walkthrough", "low"))
    assert case.file(notes)["placement"]["status"] == "NEEDS_PERSON"
    item = case.item(case.walkthrough["id"])
    requirement = f"{case.base}/controls/{case.control}/evidence-requirements/{item['id']}"
    linked = case.owner.post(
        f"{requirement}/files",
        json={"file_id": notes, "reason": "It is the walkthrough's notes.",
              "version": item["version"]},
    )  # fmt: skip
    assert linked.status_code == 200, linked.text
    placed = case.file(notes)
    assert placed["stage"] == "SORTED"
    assert placed["placement"] == {
        "status": "PLACED", "method": "PERSON", "requirement_ids": [item["id"]],
        "reason": LINKED_ON_LIST, "suggestions": [], "version": 2,
    }  # fmt: skip
    assert [i["file_ids"] for i in case.state()["items"] if i["requirement_id"] == item["id"]] == [
        [notes]
    ]
    link = next(f for f in case.item(item["id"])["files"] if f["file_id"] == notes)
    unlinked = case.owner.post(
        f"{requirement}/files/{link['link_id']}/remove",
        json={"reason": "Not the walkthrough after all.", "version": link["link_version"]},
    )
    assert unlinked.status_code == 200, unlinked.text
    off = case.file(notes)["placement"]
    assert (off["status"], off["reason"], off["version"], off["requirement_ids"]) == (
        "NOT_DESIGN", UNLINKED_ON_LIST, 3, [],
    )  # fmt: skip
    # The placed policy is filed to another control in the Evidence center.
    refiled = _refile(case, policy, _other_control(case))
    assert refiled.status_code == 200, refiled.text
    state = case.state()
    entry = next(f for f in state["files"] if f["file_id"] == policy)
    assert (entry["stage"], entry["placement"]["status"], entry["placement"]["reason"]) == (
        "NOT_DESIGN", "NOT_DESIGN", MOVED_AWAY,
    )  # fmt: skip
    assert entry["placement"]["requirement_ids"] == [] and state["items"] == []
    refused = case.place(policy, [case.walkthrough["id"]], entry["placement"]["version"])
    assert refused.status_code == 409
    assert refused.json()["detail"] == "the file is no longer filed to this control"
    assert [row[1:3] for row in case.placements(policy)] == [
        ("PLACED", "AGENT"), ("NOT_DESIGN", "PERSON"),
    ]  # fmt: skip
    # The request it left follows: nothing is in hand on it any more.
    assert case.read(case.request)["status"] == "DRAFT"


def test_every_way_a_reading_ends_runs_the_hook_and_the_backstop_lands_the_rest(
    migrated: Database,
) -> None:
    """P5: a reading cancelled while it ran, and one cancelled while queued, each need a
    person (with the gate's reason) and run the batch's landing check in their own
    transaction: the batch lands when the last ends. A batch whose readings ended without
    landing (before the hook existed) is landed by the start-up backstop."""
    case = _Wizard(migrated, "p5")
    policy = case.add("access policy.txt", POLICY)
    ticket = case.add("ticket REQ-1041.txt", TICKET)
    log = case.add("sap change log.txt", LOG)
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "COVERED"}))

    class Cancelling(_Reader):
        """A person cancels the reading while the model works on it."""

        def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
            asked = case.owner.post(
                f"{case.base}/agent-runs/analysis/{_analysis(case, log)}/cancel"
            )
            assert asked.status_code == 200 and asked.json()["state"] == "REQUESTED"
            return super().complete(request, config)

    walk = {case.walkthrough["title"]: "COVERED"}
    assert case.read_file(log, Cancelling("change_history", covers=walk)) == "CANCELLED"
    stopped = case.file(log)
    assert (stopped["stage"], stopped["placement"]["status"]) == ("FAILED", "NEEDS_PERSON")
    assert stopped["placement"]["reason"] == HELD_REASONS["READ_FAILED"]
    assert case.runs() == [], "the ticket is still queued"
    cancelled = case.owner.post(f"{case.base}/agent-runs/analysis/{_analysis(case, ticket)}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["state"] == "CANCELLED"
    state = case.state()
    assert state["stages"]["sorted"] == state["stages"]["files"] == 3
    queued = next(f for f in state["files"] if f["file_id"] == ticket)
    assert (queued["stage"], queued["placement"]["status"]) == ("FAILED", "NEEDS_PERSON")
    assert queued["placement"]["reason"] == HELD_REASONS["READ_FAILED"]
    assert [(str(r[1]), r[2]) for r in case.runs()] == [(case.policy["id"], "PENDING")]
    assert case.read(case.request)["status"] == "RECEIVED"
    # A batch whose last reading ended by a way that did not land it.
    case.batch = str(uuid4())
    second = case.add("access policy v2.txt", POLICY + "Revised.\n")
    third = case.add("ticket REQ-1042.txt", TICKET.replace("1041", "1042"))
    case.read_file(second, _Reader("policy", covers={case.policy["title"]: "COVERED"}))
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE evidence_analyses SET status = 'FAILED', lease_until = NULL, "
            "note = 'Reading the file did not finish.', finished_at = clock_timestamp() "
            "WHERE evidence_file_id = %s",
            (third,),
        )
    assert case.file(third)["placement"]["status"] == "PENDING"
    with connect(migrated.url) as connection:
        assert land_open_batches(connection) == 1
    after = case.file(third)
    assert (after["stage"], after["placement"]["status"]) == ("FAILED", "NEEDS_PERSON")
    assert after["placement"]["reason"] == HELD_REASONS["READ_FAILED"]
    with connect(migrated.url) as connection:
        assert land_open_batches(connection) == 0, "landed, and nothing ended since"


def test_an_upload_and_its_batchs_landing_take_the_batch_first(migrated: Database) -> None:
    """P6: a landing holds the batch and then takes a request; an upload into the batch
    used to file on that request before waiting for the batch, and the two deadlocked.
    The upload now takes the batch first, so it waits and both go through."""
    case = _Wizard(migrated, "p6")
    walk = case.walkthrough["id"]
    case.add("ticket REQ-1041.txt", TICKET, requirement_id=walk)
    uploader = _client(migrated, case.team["owner_id"], None)
    outcomes: list[Any] = []
    landing = psycopg.connect(migrated.url)
    watch = psycopg.connect(migrated.url, autocommit=True)
    try:
        landing.execute("SELECT 1 FROM evidence_batches WHERE id = %s FOR UPDATE", (case.batch,))

        def upload() -> None:
            dropped = case.drop("sap change log.txt", LOG, requirement_id=walk, client=uploader)
            outcomes.append(dropped.status_code)

        worker = threading.Thread(target=upload)
        worker.start()
        # Until the upload waits on a lock the landing holds.
        for _ in range(200):
            row = watch.execute(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            ).fetchone()
            if row is not None and int(row[0]) >= 1:
                break
            time.sleep(0.05)
        landing.execute(
            "SELECT 1 FROM pbc_requests WHERE id = %s FOR UPDATE", (UUID(case.request),)
        )
        outcomes.append("landing went on")
        landing.commit()
        worker.join(30)
    finally:
        landing.close()
        watch.close()
    assert outcomes == ["landing went on", 200]
    assert len(case.state()["files"]) == 2


def _covered_before(cursor: Any, project_id: UUID, request_id: UUID) -> bool:
    """evidence_receipts.covered as it was at 7c93228, before the wizard: today's rule for
    the flows outside it."""
    planned = [
        str(row[0])
        for row in cursor.execute(
            "SELECT id FROM evidence_requirements WHERE pbc_request_id = %s "
            "AND status = 'REQUESTED' ORDER BY CASE necessity WHEN 'REQUIRED' THEN 0 "
            "WHEN 'CONDITIONAL' THEN 1 ELSE 2 END, created_at, requirement_key",
            (request_id,),
        ).fetchall()
    ]
    draft = cursor.execute(
        "SELECT content FROM pbc_drafts WHERE pbc_request_id = %s AND status = 'DRAFTED'",
        (request_id,),
    ).fetchone()
    items = draft[0].get("items", []) if draft is not None and isinstance(draft[0], dict) else []
    wanted = min(len(items), 8) if isinstance(items, list) else 0
    if wanted == 0:
        return not planned or _every_item_served(cursor, request_id)
    found: set[int] = set()
    for (classification,) in cursor.execute(
        "SELECT a.classification FROM evidence_file_links l JOIN evidence_analyses a "
        "ON a.evidence_file_id = l.evidence_file_id WHERE l.project_id = %s "
        "AND l.pbc_request_id = %s AND a.status = 'READY'",
        (project_id, request_id),
    ).fetchall():
        for item in (classification or {}).get("items", []):
            if not isinstance(item, dict) or item.get("coverage") != "COVERED":
                continue
            named = str(item.get("requirement_id") or "")
            if named in planned:
                found.add(planned.index(named))
            elif isinstance(item.get("index"), int):
                found.add(item["index"])
    return all(index in found for index in range(wanted))


def test_an_item_waived_on_its_own_request_counts_as_before(migrated: Database) -> None:
    """P7: outside the wizard, two files on a drafted request as a whole, each covering
    every item; the last item is waived and the second file withdrawn. An item the reading
    names that is no longer requested on this request still counts by its place in the
    list, as before the wizard: the request stays received."""
    case = _Wizard(migrated, "p7", drafted=True)
    covers = {item["title"]: "COVERED" for item in case.items}
    files: list[str] = []
    for name in ("pack one.txt", "pack two.txt"):
        added = case.owner.post(
            f"{case.base}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": name, "request_id": case.request},
            content=(POLICY + TICKET + name).encode(), headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        files.append(str(added.json()["file_id"]))
        assert case.read_file(files[-1], _Reader("walkthrough", covers=covers)) == "READY"
    assert case.read(case.request)["status"] == "RECEIVED"
    [last] = [
        str(row[0])
        for row in case.rows(
            "SELECT id FROM evidence_requirements WHERE pbc_request_id = %s "
            "AND status = 'REQUESTED' ORDER BY CASE necessity WHEN 'REQUIRED' THEN 0 "
            "WHEN 'CONDITIONAL' THEN 1 ELSE 2 END DESC, created_at DESC, requirement_key DESC "
            "LIMIT 1",
            UUID(case.request),
        )
    ]
    waived = case.owner.post(
        f"{case.base}/controls/{case.control}/evidence-requirements/{last}/waive",
        json={"reason": "Not applicable: the system has no such report.",
              "version": case.item(last)["version"]},
    )  # fmt: skip
    assert waived.status_code == 200, waived.text
    withdrawn = case.owner.post(
        f"{case.base}/evidence-files/{files[1]}/withdraw",
        json={"reason": "Duplicate of the first pack."},
    )
    assert withdrawn.status_code == 200, withdrawn.text
    assert case.read(case.request)["status"] == "RECEIVED"
    project, request = UUID(str(case.team["project"])), UUID(case.request)
    with connect(migrated.url) as connection, connection.cursor() as cursor:
        assert covered(cursor, project, request) is True
        assert _covered_before(cursor, project, request) is True


def test_an_item_that_changes_while_its_file_is_read_leaves_the_file_unplaced(
    migrated: Database,
) -> None:
    """P8: the item is waived while its file is read. The filing is tried first: the file
    is not placed, needs a person, and its reading names no request (nothing is derived
    against the request it was meant for)."""
    case = _Wizard(migrated, "p8")
    policy = case.add("access policy.txt", POLICY)

    class Waiving(_Reader):
        """A person waives the policy item while the model reads the file."""

        def complete(self, request: ModelRequest, config: ModelConfig) -> ModelRaw:
            item = case.item(case.policy["id"])
            waived = case.owner.post(
                f"{case.base}/controls/{case.control}/evidence-requirements/{item['id']}/waive",
                json={"reason": "Not applicable: the policy is group-wide.",
                      "version": item["version"]},
            )  # fmt: skip
            assert waived.status_code == 200, waived.text
            return super().complete(request, config)

    covers = {case.policy["title"]: "COVERED"}
    assert case.read_file(policy, Waiving("policy", covers=covers)) == "READY"
    entry = case.file(policy)
    assert (entry["placement"]["status"], entry["placement"]["reason"]) == (
        "NEEDS_PERSON", CHANGED_REASON,
    )  # fmt: skip
    assert case.filing(policy) == (None, None, "PERSON")
    assert case.rows(
        "SELECT pbc_request_id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(policy)
    ) == [(None,)]
    assert case.findings(policy) == []


def test_a_file_held_already_is_listed_in_a_new_session_and_sessions_are_listed(
    migrated: Database,
) -> None:
    """P9 and the control's sessions: a file held already, dropped in a new session, is
    listed there as a duplicate with the placement it has (nothing is stored twice). The
    control's recent sessions are listed, the most recent first, with their progress."""
    case = _Wizard(migrated, "p9")
    first_batch = case.batch
    policy = case.add("access policy.txt", POLICY)
    case.read_file(policy, _Reader("policy", covers={case.policy["title"]: "COVERED"}))
    case.batch = str(uuid4())
    again = case.drop("access policy.txt", POLICY)
    assert again.status_code == 200, again.text
    assert (again.json()["file_id"], again.json()["duplicate"]) == (policy, True)
    state = case.state()
    [entry] = state["files"]
    assert set(entry) == FILE_KEYS
    assert (entry["file_id"], entry["duplicate"], entry["stage"]) == (policy, True, "SORTED")
    assert entry["placement"] == {
        "status": "PLACED", "method": "AGENT", "requirement_ids": [case.policy["id"]],
        "reason": f"The reader found it covers “{case.policy['title']}”.", "suggestions": [],
        "version": 1,
    }  # fmt: skip
    assert [item["file_ids"] for item in state["items"]] == [[policy]]
    own = case.owner.get(case.url(batch=first_batch))
    assert own.status_code == 200 and own.json()["files"][0]["duplicate"] is False
    assert case.rows("SELECT count(*) FROM evidence_files WHERE project_id = %s",
                     case.team["project"]) == [(1,)]  # fmt: skip
    listed = case.owner.get(f"{case.base}/controls/{case.control}/evidence-batches")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert set(body) == {"batches"}
    assert [b["batch_id"] for b in body["batches"]] == [case.batch, first_batch]
    for summary in body["batches"]:
        assert set(summary) == BATCH_KEYS
        assert _when(summary["created_at"]) <= _when(state["server_now"])
    newest = body["batches"][0]
    assert {key: value for key, value in newest.items() if key != "created_at"} == {
        "batch_id": case.batch, "created_by_name": case.name(case.team["owner_id"]),
        "chosen_requirement_id": None, "files": 1, "in_progress": 0, "needs_person": 0,
        "not_design": 0, "finished": False, "finished_at": None,
    }  # fmt: skip
    # Its item's check ends: both sessions have finished, and when.
    assert case.check(_Readings(_shown_by(FIRST), _shown_by(SECOND))) == ["READY"]
    done = case.owner.get(f"{case.base}/controls/{case.control}/evidence-batches").json()
    assert [(b["finished"], b["finished_at"] is not None) for b in done["batches"]] == [
        (True, True), (True, True),
    ]  # fmt: skip
    # A Reviewer reads the list; another firm does not.
    _reviewer_id, reviewer = case.member("REVIEWER")
    assert reviewer.get(f"{case.base}/controls/{case.control}/evidence-batches").status_code == 200
    with connect(migrated.url) as connection:
        stranger = _seed_org(
            connection, f"list-{uuid4().hex[:6]}", f"{uuid4().hex[:8]}@example.com"
        )
    outsider = _client(migrated, stranger["user_id"], None)
    assert outsider.get(f"{case.base}/controls/{case.control}/evidence-batches").status_code == 404


def test_deterministic_findings_follow_a_file_onto_a_request(migrated: Database) -> None:
    """Items 9 and 10: a file read on no request (it waited for a person) has no findings;
    placed on an item's request by a person, the reading names that request and its
    deterministic findings are derived there, and moved on to another request the reading
    names that one. The reader's own findings stay held."""
    case = _Wizard(migrated, "rules")
    policy = case.add("access policy.txt", POLICY)
    gaps: dict[str, Any] = {"gaps": ["The emergency approval timeframe is not stated."]}
    case.read_file(policy, _Reader("policy", "low", covers={case.policy["title"]: "COVERED"},
                                   **gaps))  # fmt: skip
    assert case.file(policy)["placement"]["status"] == "NEEDS_PERSON"
    assert case.findings(policy) == []
    moved = case.place(policy, [case.policy["id"]], 1)
    assert moved.status_code == 200, moved.text
    assert case.rows(
        "SELECT pbc_request_id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(policy)
    ) == [(UUID(case.request),)]
    assert case.findings(policy) == [("RULES", "PLACEHOLDER")]
    # The walkthrough item is now asked for on a request of its own; moved there, the
    # reading names that request (item 9), and its findings are not proposed twice.
    asked = str(case.item(case.walkthrough["id"])["request_id"])
    assert asked != case.request
    again = case.place(policy, [case.walkthrough["id"]], 2)
    assert again.status_code == 200, again.text
    assert case.rows(
        "SELECT pbc_request_id FROM evidence_analyses WHERE evidence_file_id = %s", UUID(policy)
    ) == [(UUID(asked),)]
    assert case.findings(policy) == [("RULES", "PLACEHOLDER")]


def test_a_refused_first_upload_records_no_batch(migrated: Database) -> None:
    """Item 12: the batch is recorded in the transaction of the session's first upload that
    stores a file or lists one held already, never before: a refused first upload leaves
    no batch."""
    case = _Wizard(migrated, "empty")
    held = case.owner.post(
        f"{case.base}/evidence-uploads",
        params={"batch_id": str(uuid4()), "name": "access notes.txt"},
        content=NOTES.encode(), headers={"content-type": "text/plain"},
    )  # fmt: skip
    assert held.status_code == 200, held.text
    refused = case.drop("access notes.txt", NOTES)
    assert refused.status_code == 409 and "held elsewhere" in refused.json()["detail"]
    assert case.owner.get(case.url()).status_code == 404
    assert case.rows("SELECT count(*) FROM evidence_batches WHERE id = %s", UUID(case.batch)) == [
        (0,)
    ]
    listed = case.owner.get(f"{case.base}/controls/{case.control}/evidence-batches")
    assert listed.status_code == 200 and listed.json() == {"batches": []}
