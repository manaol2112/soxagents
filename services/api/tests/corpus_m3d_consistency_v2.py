"""Evidence-requirement consistency scenarios, second set (Milestone 3d).

The first set (corpus_m3d_consistency.py, unchanged with its results) was found, in its
final live run, not to meet what the approved plan says counts: its owner lists were
undated, its approvals had no time, its change tickets named no requester, and its dates
fell after the interim window (1 January to 30 September of the period year) the plan
names. The M3d tester rightly withheld PASS for an undated owner list. That was a defect
of the set, not of the tester, and its expectations were not changed after the run.

This second set, written before any run of it, gives every clean sample each REQUIRED
document as the plan's `what_counts` describes it:

- ITGC-AC-01: the access request (ID, user, application and role, requester and date); the
  approval record (approver name and role, date and time, what was approved); the manager
  of record at the approval date; the application owner list in force for the window
  (application, designated owner, which access needs the owner's approval); the system
  record of the grant (user, role granted, date and time, granted by);
- ITGC-CM-01: the change ticket (ID, description and objects, requester, developer); the
  approvals (approver and role, date and time, what was approved); the owners by system in
  force for the window (system, business owner, IT approver, delegations); the deployment
  record (object, date and time, deployed by); the test evidence (script, results, tester,
  date, environment).

Every date falls inside the window. No sample carries a document the plan does not
require. Same categories and keys pattern as the first set, with new keys.
"""

import json
from pathlib import Path

from corpus import ATTRIBUTE_EXPECTATIONS, PERIOD_YEAR, _csv
from corpus_m3c import (
    AC,
    APP,
    CM,
    ControlSet,
    EvidenceFile,
    Manifest,
    Sample,
    _clean,
    _d,
    _negative,
    _text,
    _write,
)


def build(out: Path, year: int = PERIOD_YEAR) -> Manifest:
    out.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(period_year=year, controls=[_access(out, year), _changes(out, year)])
    (out / "manifest.json").write_text(
        json.dumps(manifest.as_json(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return manifest


def _owners(year: int) -> list[str]:
    return [
        "SAP ERP application owner list (IT asset register extract)",
        f"In force from {_d(year, 1, 1)} to {_d(year, 12, 31)}; last reviewed {_d(year, 1, 5)}",
        "Accounts payable and receivable roles: designated owner Helen Cho (Finance Systems "
        "Lead); every role in these modules needs the owner's approval",
        "General ledger roles: designated owner Helen Cho (Finance Systems Lead); every role "
        "needs the owner's approval",
    ]


def _access(out: Path, year: int) -> ControlSet:
    folder = f"consistency2/{AC}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[AC]]
    # key, name, role, ticket, manager of record, approver as manager, month, approve, grant
    people = [
        ("u0451", "Rosa Lind", "AP Clerk", "REQ-4451", "Rafael Duarte", "Rafael Duarte", 2, 3, 5),
        ("u0452", "Omar Said", "GL Viewer", "REQ-4452", "Sofia Lindqvist", "Sofia Lindqvist",
         3, 10, 12),
        ("u0453", "Ana Reyes", "AR Clerk", "REQ-4453", "Mei Tanaka", "Mei Tanaka", 4, 14, 16),
        ("u0454", "Tom Weiss", "AP Clerk", "REQ-4454", "Rafael Duarte", "Rafael Duarte", 5, 19, 21),
        ("u0455", "Lia Moretti", "AR Clerk", "REQ-4455", "Mei Tanaka", "Mei Tanaka", 6, 24, 21),
        ("u0456", "Ben Adler", "GL Viewer", "REQ-4456", "Sofia Lindqvist", "Paul Brennan",
         7, 7, 9),
    ]  # fmt: skip
    files: dict[str, list[EvidenceFile]] = {}
    rows = [["User ID", "Name", "Application", "Role granted", "Date granted", "Granted by",
             "Ticket"]]  # fmt: skip
    for key, name, role, ticket, manager, approver, month, approved, granted in people:
        approved_on = _d(year, month, approved)
        granted_on = _d(year, month, granted)
        requested_on = _d(year, month, 1)
        rows.append([key, name, APP, role, granted_on, "adm.kfischer", ticket])
        owned = [_text(out, f"{folder}/{key} {ticket} access request and approvals.txt", [
            f"Access request {ticket}",
            f"Requested for: {name} ({key})",
            f"Application: {APP}; role requested: {role}",
            f"Requested by {name} on {requested_on}",
            "",
            "Approval record",
            f"- {approver}, line manager: approved {role} in {APP} on {approved_on} 09:30",
            f"- Helen Cho, application owner: approved {role} in {APP} on {approved_on} 11:00",
        ])]  # fmt: skip
        if key != "u0454":
            owned.append(_text(out, f"{folder}/{key} HR manager of record.txt", [
                f"HR system extract, as at {approved_on}",
                f"Employee {key} {name}: manager of record {manager}, since {_d(year, 1, 1)}",
            ]))  # fmt: skip
        if key != "u0453":
            owned.append(_text(out, f"{folder}/{key} application owner list.txt", _owners(year)))
        owned.append(_write(out, f"{folder}/{key} SAP user change log.csv", _csv([
            ["Timestamp", "User", "Role granted", "Action", "Granted by"],
            [f"{granted_on} 14:05", key, role, "Role assigned", "adm.kfischer"],
        ]), "text/csv"))  # fmt: skip
        files[key] = owned

    def clean(key: str) -> Sample:
        return Sample(key, "clean", "Every document the plan requires, as it describes it.",
                      files[key], _clean(5, {}))  # fmt: skip

    samples = [
        clean("u0451"),
        clean("u0452"),
        Sample("u0453", "missing", "The application owner list the plan requires is absent.",
               files["u0453"], _clean(5, {1: _negative(
                   1, "UNABLE", "The plan requires the application owner list for B; it is "
                   "not in the evidence.", "Helen Cho, application owner: approved",
                   ("REVIEW",))})),
        Sample("u0454", "missing", "The manager of record the plan requires is absent.",
               files["u0454"], _clean(5, {1: _negative(
                   1, "UNABLE", "The plan requires the manager relationship for B; no HR "
                   "record is in the evidence.", "Rafael Duarte, line manager: approved",
                   ("REVIEW",))})),
        Sample("u0455", "exception",
               "The approvals are dated three days after the system recorded the grant.",
               files["u0455"], _clean(5, {2: _negative(
                   2, "EXCEPTION", f"Approved on {_d(year, 6, 24)}; the system shows the role "
                   f"assigned on {_d(year, 6, 21)}.",
                   f"Mei Tanaka, line manager: approved AR Clerk in {APP} on {_d(year, 6, 24)}")})),
        Sample("u0456", "exception",
               "The line manager approval is by someone the HR record does not name as the "
               "user's manager.", files["u0456"], _clean(5, {1: _negative(
                   1, "EXCEPTION", "Paul Brennan approved as line manager; the HR record "
                   "names Sofia Lindqvist.", "Paul Brennan, line manager: approved")})),
    ]  # fmt: skip
    population = _write(out, f"{folder}/new user population listing.csv", _csv(rows), "text/csv")
    return ControlSet(AC, attributes, population, len(rows) - 1, samples)


def _changes(out: Path, year: int) -> ControlSet:
    folder = f"consistency2/{CM}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[CM]]
    changes = [
        ("CHG-3051", "Vendor bank change approval", "ZFI_VENDOR_BANK", "Aiko Sato",
         "DEVK900751", 2),
        ("CHG-3052", "Duplicate invoice check", "ZAP_DUP_CHECK", "Ravi Kumar", "DEVK900752", 4),
        ("CHG-3053", "Credit memo workflow", "ZAR_CREDIT_WF", "Aiko Sato", "DEVK900753", 6),
        ("CHG-3054", "Payment proposal layout", "ZFI_PAY_LAYOUT", "Ravi Kumar", "DEVK900754", 8),
    ]  # fmt: skip
    files: dict[str, list[EvidenceFile]] = {}
    rows = [["Change ID", "Description", "System", "Transport deployed", "Deployed on",
             "Deployed by"]]  # fmt: skip
    for key, title, objects, developer, transport, month in changes:
        deployed = _d(year, month, 20)
        rows.append([key, title, "SAP ERP PRD", transport, deployed, "basis.oivanova"])
        owned = [
            _text(out, f"{folder}/{key} change ticket.txt", [
                f"Change request {key}: {title}",
                f"Objects: {objects}; transport {transport}",
                f"Requested by Elena Rossi on {_d(year, month, 5)}",
                f"Developer: {developer}",
            ]),
            _text(out, f"{folder}/{key} approvals.txt", [
                f"Approvals for {key} (transport {transport})",
                f"- Elena Rossi, business owner: approved on {_d(year, month, 15)} 10:00",
                f"- Marcus Lee, IT approver: approved on {_d(year, month, 15)} 16:30",
            ]),
            _text(out, f"{folder}/{key} deployment record.txt", [
                f"Deployment record {key}",
                f"Transport {transport} ({objects}) imported to PRD on {deployed} 19:10 by "
                "basis.oivanova (Olga Ivanova, Basis administrator)",
            ]),
        ]  # fmt: skip
        if key != "CHG-3053":
            owned.append(_text(out, f"{folder}/{key} SAP ERP owners by system.txt", [
                "Business owners and IT approvers by system (change management standard)",
                f"In force from {_d(year, 1, 1)} to {_d(year, 12, 31)}",
                "SAP ERP: business owner Elena Rossi; IT approver Marcus Lee; delegations: none",
            ]))  # fmt: skip
        if key != "CHG-3054":
            owned.append(_text(out, f"{folder}/{key} test evidence.txt", [
                f"Test evidence {key}, script TS-{key[-4:]}",
                f"Environment: QAS (non-production). Tested on {_d(year, month, 12)} by Nadia "
                "Farouk; results: 8 of 8 steps passed.",
            ]))  # fmt: skip
        files[key] = owned

    def clean(key: str) -> Sample:
        return Sample(key, "clean", "Every document the plan requires, as it describes it.",
                      files[key], _clean(6, {}))  # fmt: skip

    samples = [
        clean("CHG-3051"),
        clean("CHG-3052"),
        Sample("CHG-3053", "missing",
               "The owners-by-system record the plan requires for D is absent.",
               files["CHG-3053"], _clean(6, {3: _negative(
                   3, "UNABLE", "The plan requires the business owners and IT approvers by "
                   "system for D; it is not in the evidence.",
                   f"Elena Rossi, business owner: approved on {_d(year, 6, 15)}",
                   ("REVIEW",))})),
        Sample("CHG-3054", "missing", "The test evidence the plan requires is absent.",
               files["CHG-3054"], _clean(6, {
                   1: _negative(1, "UNABLE", "No test evidence is in the evidence.",
                                f"Requested by Elena Rossi on {_d(year, 8, 5)}",
                                ("EXCEPTION", "REVIEW")),
                   2: _negative(2, "UNABLE", "No test environment is in the evidence.",
                                "Transport DEVK900754", ("EXCEPTION", "REVIEW")),
               })),
    ]  # fmt: skip
    population = _write(
        out, f"{folder}/production change population listing.csv", _csv(rows), "text/csv"
    )
    return ControlSet(CM, attributes, population, len(rows) - 1, samples)
