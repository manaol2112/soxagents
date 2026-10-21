"""Supplementary grounded-testing scenarios (M3c closure).

The owner asked, after the M3c validation, whether the documents the agents asked for on
clean samples (an access policy, an application or system owner register, a system role
listing) are required by the approved attributes. The analysis
(docs/review/m3c/evidence-requirements.md) found each of them to be supporting evidence
for the original scenario set, and mandatory only where it decides the result. These
scenarios are those cases: the document is present, and the right result depends on it.

They are separate from the M3c scenario set (corpus_m3c.py), whose files, manifest and
expected results are unchanged. Every name, ticket, transport and date is invented.
`build(out, year)` writes the files and `manifest.json` under `out`.
"""

import json
from pathlib import Path

from corpus import ATTRIBUTE_EXPECTATIONS, PERIOD_YEAR, _csv
from corpus_m3c import (
    AC,
    ADMIN,
    APP,
    CM,
    OWNER,
    ControlSet,
    Manifest,
    Sample,
    _Change,
    _clean,
    _d,
    _dependent,
    _negative,
    _qas,
    _record,
    _text,
    _ticket,
    _User,
    _write,
)

POLICY = [
    "Access management policy AM-2 (extract), section 4",
    "Approval of new access: the user's line manager approves every request. The "
    "application owner also approves a privileged role: any role whose name ends in Admin.",
    "Other roles need the line manager's approval only.",
]


def build(out: Path, year: int = PERIOD_YEAR) -> Manifest:
    out.mkdir(parents=True, exist_ok=True)
    manifest = Manifest(period_year=year, controls=[_access(out, year), _changes(out, year)])
    (out / "manifest.json").write_text(
        json.dumps(manifest.as_json(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return manifest


def _access(out: Path, year: int) -> ControlSet:
    folder = f"supplement/{AC}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[AC]]
    users = [
        # The policy decides attribute B: an ordinary role needs the manager only.
        _User("u0101", "Olivia Grant", "AP Clerk", "AP Clerk", "REQ-3201", "Rafael Duarte",
              _d(year, 9, 1), f"Line manager approval: Rafael Duarte approved on {_d(year, 9, 2)}",
              "Application owner approval: none", _d(year, 9, 4)),
        # The policy decides attribute B: a privileged role also needs the owner.
        _User("u0102", "Peter Novak", "Payroll Admin", "Payroll Admin", "REQ-3202", "Mei Tanaka",
              _d(year, 9, 8), f"Line manager approval: Mei Tanaka approved on {_d(year, 9, 9)}",
              "Application owner approval: none", _d(year, 9, 11)),
        # The system's role listing decides attribute D: more was granted than approved.
        _User("u0103", "Rita Mehta", "AR Clerk", "AR Clerk", "REQ-3203", "Mei Tanaka",
              _d(year, 9, 14), f"Line manager approval: Mei Tanaka approved on {_d(year, 9, 15)}",
              f"Application owner approval: {OWNER} approved on {_d(year, 9, 15)}",
              _d(year, 9, 17)),
    ]  # fmt: skip
    files = {
        u.key: [_text(out, f"{folder}/{u.key} {u.ticket} access request.txt", _ticket(u))]
        for u in users
    }
    for key in ("u0101", "u0102"):
        files[key].append(_text(out, f"{folder}/{key} access policy AM-2 extract.txt", POLICY))
    files["u0103"].append(
        _write(out, f"{folder}/u0103 SAP ERP user role listing.csv", _csv([
            ["User ID", "Name", "Role", "Valid from", "Assigned by"],
            ["u0103", "Rita Mehta", "AR Clerk", _d(year, 9, 17), "adm.kfischer"],
            ["u0103", "Rita Mehta", "AR Supervisor", _d(year, 9, 17), "adm.kfischer"],
        ]), "text/csv")
    )  # fmt: skip
    samples = [
        Sample("u0101", "clean",
               "Manager approval only, for a role the policy does not make privileged.",
               files["u0101"], _clean(5, {})),
        Sample("u0102", "exception",
               "Manager approval only, for a privileged role the policy says the owner must "
               "also approve.", files["u0102"], _clean(5, {
                   1: _negative(1, "EXCEPTION", "AM-2 §4 requires the application owner's "
                                "approval for a role ending in Admin; there is none.",
                                f"Line manager approval: Mei Tanaka approved on {_d(year, 9, 9)}"),
                   2: _dependent(2, "The manager's approval predates the grant; the owner's "
                                 "required approval does not exist.",
                                 ("PASS", "EXCEPTION", "UNABLE", "REVIEW")),
                   3: _dependent(3, "The role granted is the one requested, but it was not "
                                 "fully approved.", ("PASS", "EXCEPTION", "UNABLE", "REVIEW")),
               })),
        Sample("u0103", "exception",
               "The system's role listing shows AR Supervisor granted with the approved AR "
               "Clerk role.", files["u0103"], _clean(5, {3: _negative(
                   3, "EXCEPTION", "AR Clerk was approved; the system shows AR Clerk and AR "
                   "Supervisor assigned on the grant date.",
                   f"Granted role AR Clerk in {APP} on {_d(year, 9, 17)}")})),
    ]  # fmt: skip
    rows = [["User ID", "Name", "Application", "Role granted", "Date granted", "Granted by",
             "Ticket"]]  # fmt: skip
    for user in users:
        rows.append([user.key, user.name, APP, user.role_granted, user.granted, "adm.kfischer",
                     user.ticket])  # fmt: skip
    population = _write(out, f"{folder}/new user population listing.csv", _csv(rows), "text/csv")
    _ = ADMIN
    return ControlSet(AC, attributes, population, len(rows) - 1, samples)


def _changes(out: Path, year: int) -> ControlSet:
    folder = f"supplement/{CM}"
    attributes = [entry.text for entry in ATTRIBUTE_EXPECTATIONS[CM]]
    # The owner register decides attribute D: the business approver is not the owner.
    change = _Change(
        "CHG-2101", "Supplier bank detail approval step", "Aiko Sato", "DEVK900601",
        "DEVK900601", _d(year, 9, 1), _qas(_d(year, 9, 8), "TS-2101", 7),
        f"Business owner approval: Jonas Brandt approved on {_d(year, 9, 9)}",
        f"IT owner approval: Marcus Lee approved on {_d(year, 9, 9)}", _d(year, 9, 12),
    )  # fmt: skip
    files = [
        _text(out, f"{folder}/CHG-2101 change record.txt", _record(change)),
        _text(out, f"{folder}/CHG-2101 SAP ERP owner register.txt", [
            "SAP ERP system owner register (extract)",
            "Business owner, finance changes: Elena Rossi (Finance Director)",
            "IT owner: Marcus Lee (Head of ERP Applications)",
            "Jonas Brandt: Accounts Payable team lead (not a designated owner)",
        ]),
    ]  # fmt: skip
    sample = Sample(
        "CHG-2101", "exception",
        "The business approval is by a person the owner register says is not the owner.",
        files, _clean(6, {3: _negative(
            3, "EXCEPTION", "Jonas Brandt approved as business owner; the register names Elena "
            "Rossi as the business owner.",
            f"Business owner approval: Jonas Brandt approved on {_d(year, 9, 9)}")}),
    )  # fmt: skip
    rows = [["Change ID", "Description", "System", "Transport deployed", "Deployed on",
             "Deployed by"],
            [change.key, change.title, "SAP ERP PRD", change.deployed_transport, change.deployed,
             "basis.oivanova"]]  # fmt: skip
    population = _write(
        out, f"{folder}/production change population listing.csv", _csv(rows), "text/csv"
    )
    return ControlSet(CM, attributes, population, 1, [sample])
