"""Evidence-requirement consistency scenarios (Milestone 3d).

A scenario set independent of M3c (corpus_m3c.py and its supplement, unchanged), built to
measure the owner's M3d item F: the approved evidence plan decides which evidence an
attribute requires; documents the plan does not require must not withhold a supported
PASS; a missing REQUIRED document must still prevent one.

The expected results follow the approved interim plan of the engagement these scenarios
run in (the library plan for ITGC-AC-01 and ITGC-CM-01), which lists, per attribute:

- ITGC-AC-01: the access request (A, D); the approval record (B, C, E); the manager
  relationship (B); the application owner list (B); the system record of the grant
  (C, D, E).
- ITGC-CM-01: the change ticket (A, E, F); the approvals (D, E); the owners by system (D);
  the deployment record (B, D, F); the test evidence (B, C).

Every sample carries each REQUIRED document as its own file named by the sample key,
except where one is deliberately left out. No sample carries the documents the plan does
not require (an access policy, a full role listing, a deployment-tool screenshot), so a
result withheld for them is an unnecessary inconclusive result.

Categories, fixed before any model runs:

- clean: everything REQUIRED is present and meets the attribute; PASS is right;
- negative (missing required): a REQUIRED document is absent; PASS is a false pass;
  UNABLE is expected;
- negative (exception): the required evidence shows a deviation; PASS is a false pass.
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

OWNERS = [
    "SAP ERP application owners (extract from the IT asset register)",
    "Accounts payable and receivable roles: Helen Cho, Finance Systems Lead",
    "General ledger roles: Helen Cho, Finance Systems Lead",
    "Payroll roles: Omar Haddad, HR Systems Lead",
]


def build(out: Path, year: int = PERIOD_YEAR) -> Manifest:
    out.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(period_year=year, controls=[_access(out, year), _changes(out, year)])
    (out / "manifest.json").write_text(
        json.dumps(manifest.as_json(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return manifest


def _access(out: Path, year: int) -> ControlSet:
    folder = f"consistency/{AC}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[AC]]
    # key, name, role, ticket, HR manager, approver as manager, day of approvals, day granted
    people = [
        ("u0401", "Hana Kobayashi", "AP Clerk", "REQ-4401", "Rafael Duarte", "Rafael Duarte", 2, 4),
        ("u0402", "Leo Martins", "GL Viewer", "REQ-4402", "Sofia Lindqvist", "Sofia Lindqvist",
         9, 11),
        ("u0403", "Ines Duval", "AR Clerk", "REQ-4403", "Mei Tanaka", "Mei Tanaka", 16, 18),
        ("u0404", "Sam Okoye", "AP Clerk", "REQ-4404", "Rafael Duarte", "Rafael Duarte", 21, 23),
        ("u0405", "Nora Feld", "AR Clerk", "REQ-4405", "Mei Tanaka", "Mei Tanaka", 28, 25),
        ("u0406", "Tariq Aziz", "GL Viewer", "REQ-4406", "Sofia Lindqvist", "Paul Brennan", 6, 8),
    ]  # fmt: skip
    files: dict[str, list[EvidenceFile]] = {}
    rows = [["User ID", "Name", "Application", "Role granted", "Date granted", "Granted by",
             "Ticket"]]  # fmt: skip
    for key, name, role, ticket, manager, approver, approved, granted in people:
        month = 10 if key in ("u0401", "u0402", "u0403", "u0404") else 11
        approved_on = _d(year, month, approved)
        granted_on = _d(year, month, granted)
        rows.append([key, name, APP, role, granted_on, "adm.kfischer", ticket])
        owned = [_text(out, f"{folder}/{key} {ticket} access request and approvals.txt", [
            f"Access request {ticket}",
            f"Requested for: {name} ({key})",
            f"Application: {APP}",
            f"Role requested: {role}",
            "",
            "Approvals",
            f"- Approved by {approver} (line manager) on {approved_on}",
            f"- Approved by Helen Cho (application owner) on {approved_on}",
        ])]  # fmt: skip
        if key != "u0404":
            owned.append(_text(out, f"{folder}/{key} HR manager record.txt", [
                "HR system extract: reporting line",
                f"Employee {key} {name}: line manager {manager}, effective {_d(year, 1, 1)}",
            ]))  # fmt: skip
        if key != "u0403":
            owned.append(_text(out, f"{folder}/{key} application owner list.txt", OWNERS))
        owned.append(_write(out, f"{folder}/{key} SAP user change log.csv", _csv([
            ["Timestamp", "User", "Role", "Action", "Changed by"],
            [f"{granted_on} 10:15", key, role, "Role assigned", "adm.kfischer"],
        ]), "text/csv"))  # fmt: skip
        files[key] = owned

    def clean(key: str) -> Sample:
        return Sample(key, "clean", "Every document the plan requires is present.", files[key],
                      _clean(5, {}))  # fmt: skip

    samples = [
        clean("u0401"),
        clean("u0402"),
        Sample("u0403", "missing", "The application owner list the plan requires is absent.",
               files["u0403"], _clean(5, {1: _negative(
                   1, "UNABLE", "The plan requires the application owner list for B; it is "
                   "not in the evidence.", "Approved by Helen Cho (application owner)",
                   ("REVIEW",))})),
        Sample("u0404", "missing", "The manager relationship the plan requires is absent.",
               files["u0404"], _clean(5, {1: _negative(
                   1, "UNABLE", "The plan requires the manager relationship for B; no HR "
                   "record is in the evidence.", "Approved by Rafael Duarte (line manager)",
                   ("REVIEW",))})),
        Sample("u0405", "exception",
               "The approvals are dated three days after the system recorded the grant.",
               files["u0405"], _clean(5, {2: _negative(
                   2, "EXCEPTION", f"Approved on {_d(year, 11, 28)}; the system shows the role "
                   f"assigned on {_d(year, 11, 25)}.",
                   f"Approved by Mei Tanaka (line manager) on {_d(year, 11, 28)}")})),
        Sample("u0406", "exception",
               "The request was approved as line manager by someone the HR record does not "
               "name as the user's manager.", files["u0406"], _clean(5, {1: _negative(
                   1, "EXCEPTION", "Paul Brennan approved as line manager; the HR record "
                   "names Sofia Lindqvist.", "Approved by Paul Brennan (line manager)")})),
    ]  # fmt: skip
    population = _write(out, f"{folder}/new user population listing.csv", _csv(rows), "text/csv")
    return ControlSet(AC, attributes, population, len(rows) - 1, samples)


def _changes(out: Path, year: int) -> ControlSet:
    folder = f"consistency/{CM}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[CM]]
    changes = [
        ("CHG-3001", "Vendor bank change approval", "Aiko Sato", "DEVK900701", 1),
        ("CHG-3002", "Duplicate invoice check", "Ravi Kumar", "DEVK900702", 8),
        ("CHG-3003", "Credit memo workflow", "Aiko Sato", "DEVK900703", 15),
        ("CHG-3004", "Payment proposal layout", "Ravi Kumar", "DEVK900704", 22),
    ]
    files: dict[str, list[EvidenceFile]] = {}
    rows = [["Change ID", "Description", "System", "Transport deployed", "Deployed on",
             "Deployed by"]]  # fmt: skip
    for key, title, developer, transport, day in changes:
        deployed = _d(year, 10, day + 5)
        rows.append([key, title, "SAP ERP PRD", transport, deployed, "basis.oivanova"])
        owned = [
            _text(out, f"{folder}/{key} change ticket.txt", [
                f"Change request {key}: {title}",
                f"Raised on {_d(year, 10, day)}",
                f"Developer: {developer}",
                f"Transport in the approved request: {transport}",
            ]),
            _text(out, f"{folder}/{key} approvals.txt", [
                f"Approvals for {key}",
                f"- Business owner: Elena Rossi approved on {_d(year, 10, day + 3)}",
                f"- IT owner: Marcus Lee approved on {_d(year, 10, day + 3)}",
            ]),
            _text(out, f"{folder}/{key} deployment record.txt", [
                f"Deployment record {key}",
                f"Transport {transport} imported to PRD on {deployed} by basis.oivanova "
                "(Olga Ivanova, Basis administrator)",
            ]),
        ]  # fmt: skip
        if key != "CHG-3003":
            owned.append(_text(out, f"{folder}/{key} SAP ERP owners by system.txt", [
                "Business owners and IT approvers by system (change management standard)",
                "SAP ERP: business owner Elena Rossi; IT approver Marcus Lee",
            ]))  # fmt: skip
        if key != "CHG-3004":
            owned.append(_text(out, f"{folder}/{key} test evidence.txt", [
                f"Test evidence {key}",
                f"Environment: QAS (non-production). Tested on {_d(year, 10, day + 2)} by "
                "Nadia Farouk; result: passed, 8 of 8 steps.",
            ]))  # fmt: skip
        files[key] = owned

    def clean(key: str) -> Sample:
        return Sample(key, "clean", "Every document the plan requires is present.", files[key],
                      _clean(6, {}))  # fmt: skip

    samples = [
        clean("CHG-3001"),
        clean("CHG-3002"),
        Sample("CHG-3003", "missing",
               "The owners-by-system record the plan requires for D is absent.",
               files["CHG-3003"], _clean(6, {3: _negative(
                   3, "UNABLE", "The plan requires the business owners and IT approvers by "
                   "system for D; it is not in the evidence.",
                   f"Business owner: Elena Rossi approved on {_d(year, 10, 18)}",
                   ("REVIEW",))})),
        Sample("CHG-3004", "missing", "The test evidence the plan requires is absent.",
               files["CHG-3004"], _clean(6, {
                   1: _negative(1, "UNABLE", "No test evidence is in the evidence.",
                                f"Raised on {_d(year, 10, 22)}", ("EXCEPTION", "REVIEW")),
                   2: _negative(2, "UNABLE", "No test environment is in the evidence.",
                                "Transport DEVK900704 imported to PRD", ("EXCEPTION", "REVIEW")),
               })),
    ]  # fmt: skip
    population = _write(
        out, f"{folder}/production change population listing.csv", _csv(rows), "text/csv"
    )
    return ControlSet(CM, attributes, population, len(rows) - 1, samples)
