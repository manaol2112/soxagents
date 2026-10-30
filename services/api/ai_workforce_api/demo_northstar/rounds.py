"""The later rounds of the Northstar engagement (Step 4B closure): the roll-forward
population of the access provisioning control, and the retest populations after
management remediated the late terminations and the unapproved production changes.

Deterministic from the dataset's seed, like everything else. The retest populations
show the fixes working: every termination after the lifecycle workflow went live is
locked within one business day, and every transport imported after the change workflow
went live carries an approval dated on or before the import.
"""

# ruff: noqa: E501  (declarative data tables)
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, cast

from ai_workforce_api.demo_northstar import files as F
from ai_workforce_api.demo_northstar import records as R

# The scenario clock: the engagement as of mid-December 2027, interim complete, the two
# remediations retested, roll-forward under way.
SCENARIO_AS_OF = date(2027, 12, 15)
SCENARIO_KICKOFF = date(2027, 1, 11)
# When each fix took effect (management's memos), and the retest windows that follow.
TERMINATION_FIX_ON = date(2027, 10, 18)
CHANGE_FIX_ON = date(2027, 10, 25)
ROLLFORWARD_FROM = date(2027, 10, 1)
ROLLFORWARD_TO = date(2027, 12, 10)


@dataclass
class RoundRecords:
    access_requests_q4: list[dict[str, object]]
    hr_terminations_q4: list[dict[str, object]]
    termination_removals_q4: list[dict[str, object]]
    sap_users_1130: list[dict[str, object]]
    transport_log_q4: list[dict[str, object]]
    change_tickets_q4: list[dict[str, object]]
    cab_meetings_q4: list[dict[str, object]]


def build(data: R.Records) -> RoundRecords:
    rng = random.Random(R.SEED + 4)
    employees = data.employees

    # Roll-forward: 60 access requests, 1 October to 10 December, all approved first.
    access_requests_q4: list[dict[str, object]] = []
    for i in range(1, 61):
        emp = employees[(i * 7 + 3) % 540]
        roles = sorted(
            rng.sample(
                (
                    "Z_FI_GL_ACCOUNTANT",
                    "Z_FI_AP_CLERK",
                    "Z_FI_AR_CLERK",
                    "Z_FI_DISPLAY",
                    "Z_MM_BUYER",
                    "Z_SD_BILLING",
                ),
                rng.choice((1, 1, 2)),
            )
        )
        manager = ROLLFORWARD_FROM + timedelta(days=rng.randrange(0, 68))
        while manager.weekday() >= 5:
            manager += timedelta(days=1)
        owner = R.add_business_days(manager, rng.choice((0, 0, 1)))
        provisioned = R.add_business_days(owner, rng.choice((0, 1, 1, 2)))
        access_requests_q4.append(
            {
                "request_id": f"REQ-27-{1000 + i:04d}",
                "sap_user": f"NSUSR{((i * 7 + 3) % 540) + 1:04d}",
                "name": emp["name"],
                "request_type": "New access" if i % 4 else "Role change",
                "roles_requested": ", ".join(roles),
                "roles_provisioned": ", ".join(roles),
                "requested_by": emp["manager"],
                "manager_approval": manager,
                "role_owner": "Priya Raman" if i % 3 else "Grace Lindqvist",
                "role_owner_approval": owner,
                "provisioned_on": provisioned,
                "provisioned_by": rng.choice(("NSUSR0007", "NSUSR0012")),
                "status": "Closed Complete",
            }
        )

    # Retest of the terminations: 30 leavers from 18 October to 30 November, every one
    # locked within one business day by the automated workflow.
    hr_terminations_q4: list[dict[str, object]] = []
    termination_removals_q4: list[dict[str, object]] = []
    terminated = {str(t["employee_id"]) for t in data.hr_terminations}
    pool = [e for e in employees if str(e["employee_id"]) not in terminated]
    for n, emp in enumerate(rng.sample(pool, 30), start=1):
        left = TERMINATION_FIX_ON + timedelta(days=rng.randrange(0, 43))
        while left.weekday() >= 5:
            left += timedelta(days=1)
        locked = R.add_business_days(left, rng.choice((0, 0, 1)))
        hr_terminations_q4.append(
            {
                "employee_id": emp["employee_id"],
                "name": emp["name"],
                "department": emp["department"],
                "entity": emp["entity"],
                "termination_date": left,
                "last_working_day": left,
                "termination_type": rng.choice(("Voluntary", "Voluntary", "Involuntary")),
                "notified_by": "Workday termination feed (automated lock)",
            }
        )
        termination_removals_q4.append(
            {
                "employee_id": emp["employee_id"],
                "sap_user": f"NSUSR{employees.index(emp) + 1:04d}",
                "termination_date": left,
                "lock_date": locked,
                "business_days": R.business_days_between(left, locked),
                "removed_by": "ENTRA_LIFECYCLE",
                "ticket": f"AUTO-{27500 + n}",
            }
        )
    removed = {str(r["employee_id"]): r for r in termination_removals_q4}
    # The user listing as of 30 November: the open account from the interim is locked
    # now, and the new leavers are locked at their dates.
    sap_users_1130: list[dict[str, object]] = []
    for row in data.sap_users:
        user = dict(row)
        if str(user["employee_id"]) == R.OPEN_TERMINATION_EMPLOYEE:
            user["valid_to"] = date(2027, 10, 4)
            user["lock_status"] = 64
        elif str(user["employee_id"]) in removed:
            user["valid_to"] = removed[str(user["employee_id"])]["lock_date"]
            user["lock_status"] = 64
            user["last_logon"] = removed[str(user["employee_id"])]["termination_date"]
        elif user["lock_status"] == 0 and user["user_type"] == "Dialog":
            user["last_logon"] = date(2027, 11, 30) - timedelta(days=rng.randrange(0, 20))
        sap_users_1130.append(user)

    # Retest of change management: 40 transports from 25 October to 5 December, each
    # with a ticket approved on or before its import and test evidence attached.
    transport_log_q4: list[dict[str, object]] = []
    change_tickets_q4: list[dict[str, object]] = []
    developers = [f"NSUSR{((d * 29) % 60) + 1:04d}" for d in range(1, 13)]
    basis = ("NSUSR0007", "NSUSR0012", "NSUSR0021")
    mondays = [date(2027, 10, 25) + timedelta(days=7 * w) for w in range(7)]
    cab: dict[date, list[str]] = {m: [] for m in mondays}
    for t in range(1, 41):
        ticket = f"CHG00{27300 + t}"
        raised = CHANGE_FIX_ON + timedelta(days=rng.randrange(0, 38))
        while raised.weekday() >= 5:
            raised += timedelta(days=1)
        emergency = t % 13 == 0
        approval = (
            next((m for m in mondays if m >= raised), mondays[-1]) if not emergency else raised
        )
        approver = "Marcus Delgado" if emergency else "Change Advisory Board"
        imported = R.add_business_days(approval, rng.choice((1, 2, 3)))
        if not emergency:
            cab[approval].append(ticket)
        dev = rng.choice(developers)
        imp = rng.choice(basis)
        if imp == dev:
            imp = basis[0] if dev != basis[0] else basis[1]
        transport = f"TRN-27-{1200 + t:04d}"
        transport_log_q4.append(
            {
                "transport_id": transport,
                "description": rng.choice(
                    (
                        "FI: posting period variant update",
                        "AP: payment proposal fix",
                        "SD: billing output form",
                        "FI: new GL account mapping",
                        "Basis: kernel parameter",
                    )
                ),
                "type": "Workbench" if t % 3 else "Customizing",
                "owner": dev,
                "imported_by": imp,
                "import_date": imported,
                "import_time": f"{rng.randrange(18, 23):02d}:{rng.randrange(0, 60):02d}",
                "return_code": 0 if t % 11 else 4,
                "change_ticket": ticket,
            }
        )
        change_tickets_q4.append(
            {
                "ticket": ticket,
                "short_description": f"{'Emergency: ' if emergency else ''}{transport_log_q4[-1]['description']}",
                "category": "Emergency" if emergency else "Normal",
                "requested_by": employees[(t * 5) % 60]["name"],
                "raised_on": raised,
                "transports": transport,
                "approval_date": approval,
                "approved_by": approver,
                "test_evidence": f"TEST-{ticket}.pdf",
                "status": "Closed",
            }
        )
    transport_log_q4.sort(key=lambda r: (str(r["import_date"]), str(r["transport_id"])))
    cab_meetings_q4: list[dict[str, object]] = [
        {
            "meeting_date": m,
            "chair": "Marcus Delgado",
            "attendees": "Marcus Delgado, Priya Raman, Jordan Patel, Samuel Osei",
            "approved_tickets": sorted(cab[m]),
            "deferred": 0,
            "note": "Ratified: CHG0027144 (emergency, August) with test evidence attached."
            if m == mondays[0]
            else "",
        }
        for m in mondays
    ]
    return RoundRecords(
        access_requests_q4=access_requests_q4,
        hr_terminations_q4=hr_terminations_q4,
        termination_removals_q4=termination_removals_q4,
        sap_users_1130=sap_users_1130,
        transport_log_q4=transport_log_q4,
        change_tickets_q4=change_tickets_q4,
        cab_meetings_q4=cab_meetings_q4,
    )


def render(rounds: RoundRecords) -> list[F.EvidenceFile]:
    """The round evidence files, keyed `rf_*` (roll-forward) and `rt_*` (retest)."""
    files: list[F.EvidenceFile] = []

    def add(
        key: str,
        name: str,
        kind: str,
        content: bytes,
        controls: tuple[str, ...],
        system: str,
        folder: str,
        description: str,
    ) -> None:
        files.append(
            F.EvidenceFile(key, name, kind, content, controls, system, folder, description)
        )

    add(
        "rf_access_requests_q4",
        "SAP_Access_Requests_FY2027_Q4.xlsx",
        F.XLSX_TYPE,
        F.xlsx_bytes([("Requests", F.ACCESS_REQUESTS, rounds.access_requests_q4)]),
        ("NS-AC-01",),
        "sap",
        "Access/Provisioning/Roll-forward",
        "ServiceNow SAP access requests closed 1 October to 10 December 2027",
    )
    add(
        "rt_hr_terminations_q4",
        "HR_Terminations_FY2027_Oct-Nov.xlsx",
        F.XLSX_TYPE,
        F.xlsx_bytes([("Terminations", F.HR_TERMINATIONS, rounds.hr_terminations_q4)]),
        ("NS-AC-02",),
        "entra",
        "Access/Terminations/Retest",
        "Workday termination listing, 18 October to 30 November 2027",
    )
    add(
        "rt_termination_removals_q4",
        "SAP_Termination_Removal_Log_FY2027_Oct-Nov.csv",
        F.CSV_TYPE,
        F.csv_bytes(F.TERMINATION_REMOVALS, rounds.termination_removals_q4),
        ("NS-AC-02",),
        "sap",
        "Access/Terminations/Retest",
        "Automated termination locks from the Entra ID lifecycle workflow, 18 October to 30 November 2027",
    )
    add(
        "rt_sap_users_1130",
        "SAP_User_Listing_USR02_2027-11-30.csv",
        F.CSV_TYPE,
        F.csv_bytes(F.SAP_USERS, rounds.sap_users_1130),
        ("NS-AC-02",),
        "sap",
        "Access/Terminations/Retest",
        "SAP S/4HANA user master (USR02) as of 30 November 2027",
    )
    add(
        "rt_transport_log_q4",
        "SAP_Transport_Import_Log_FY2027_Oct-Dec.csv",
        F.CSV_TYPE,
        F.csv_bytes(F.TRANSPORT_LOG, rounds.transport_log_q4),
        ("NS-CM-01",),
        "sap",
        "Change/SAP/Retest",
        "STMS production import log, 25 October to 5 December 2027",
    )
    add(
        "rt_change_tickets_q4",
        "ServiceNow_Change_Tickets_FY2027_Oct-Dec.xlsx",
        F.XLSX_TYPE,
        F.xlsx_bytes([("Changes", F.CHANGE_TICKETS, rounds.change_tickets_q4)]),
        ("NS-CM-01",),
        "sap",
        "Change/SAP/Retest",
        "ServiceNow change tickets with approvals recorded before import, 25 October to 5 December 2027",
    )
    cab_sections: list[tuple[str, F.Columns | None, Any]] = [
        (
            f"CAB meeting {m['meeting_date']}: chair {m['chair']}; attendees {m['attendees']}",
            None,
            [
                f"Approved: {', '.join(cast(list[str], m['approved_tickets'])) or 'none'}",
                f"Deferred: {m['deferred']}",
            ]
            + ([str(m["note"])] if m["note"] else []),
        )
        for m in rounds.cab_meetings_q4
    ]
    add(
        "rt_cab_approvals_q4",
        "CAB_Meeting_Approvals_FY2027_Oct-Dec.pdf",
        F.PDF_TYPE,
        F.pdf_bytes(
            "Change Advisory Board: approvals by meeting, October to December 2027",
            [
                "Weekly CAB, Mondays. Since 25 October 2027 the import task is released only once the approval is recorded.",
                "Minutes extracted 2027-12-08 by Marcus Delgado",
            ],
            cab_sections,
        ),
        ("NS-CM-01",),
        "sap",
        "Change/SAP/Retest",
        "CAB meeting approvals, 25 October to 6 December 2027",
    )
    return files
