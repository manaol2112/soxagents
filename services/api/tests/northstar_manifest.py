"""The expected outcomes of the Northstar demo, derived from the dataset's own records for
the tests (Step 4A). This module is the test oracle: it is imported by tests only, never
by the API, never stored, and never shown to an agent. The testing agent must find these
facts in the evidence and the approved criteria by itself.

Each expectation names the control, the outcome, the record, the attribute that fails,
the value the evidence shows, the criterion it breaks, and where in which file the fact
is found (file key, sheet or page, the row's key, the field)."""

# ruff: noqa: E501  (the expectations are read as sentences)
from __future__ import annotations

from dataclasses import dataclass

from ai_workforce_api.demo_northstar import records as R


@dataclass(frozen=True)
class Expectation:
    control_ref: str
    outcome: str  # PASS, EXCEPTION, INSUFFICIENT
    record: str
    attribute: str
    observed: str
    criterion: str
    # Where the fact is: the evidence file key, the sheet or page, the row key, the field.
    file_key: str
    location: str
    row_key: str
    field: str


def expectations(data: R.Records | None = None) -> list[Expectation]:
    data = data or R.build()
    late = next(
        r for r in data.termination_removals if r["employee_id"] == R.LATE_TERMINATION_EMPLOYEE
    )
    open_user = next(r for r in data.sap_users if r["employee_id"] == R.OPEN_TERMINATION_EMPLOYEE)
    privileged = next(
        r for r in data.privileged_access if r["user_id"] == R.UNAPPROVED_PRIVILEGED_USER
    )
    unapproved = next(r for r in data.change_tickets if r["ticket"] == R.UNAPPROVED_TICKET)
    late_ticket = next(r for r in data.change_tickets if r["ticket"] == R.LATE_APPROVED_TICKET)
    late_transport = next(
        r for r in data.transport_log if r["transport_id"] == R.LATE_APPROVED_TRANSPORT
    )
    failed_task = next(
        r for r in data.task_history
        if (r["task_name"], r["run_date"]) == R.FAILED_TASK_WITHOUT_TICKET
    )  # fmt: skip
    flux = next(r for r in data.flux_analysis if r["gl_account"] == R.UNEXPLAINED_FLUX_ACCOUNT)
    passing = ("NS-AC-01", "NS-AC-04", "NS-AC-05", "NS-AC-07", "NS-CM-02", "NS-OP-01", "NS-AP-01")
    found: list[Expectation] = [
        Expectation(ref, "PASS", "population", "", "", "", "", "", "", "") for ref in passing
    ]
    found += [
        Expectation(
            "NS-AC-02",
            "EXCEPTION",
            R.LATE_TERMINATION_EMPLOYEE,
            "Lock date within three business days of the termination date",
            f"{late['business_days']} business days (terminated {late['termination_date']}, locked {late['lock_date']})",
            "lock within 3 business days of the termination date",
            "termination_removals",
            "sheet 1",
            R.LATE_TERMINATION_EMPLOYEE,
            "Business Days to Lock",
        ),
        Expectation(
            "NS-AC-02",
            "EXCEPTION",
            R.OPEN_TERMINATION_EMPLOYEE,
            "SAP account locked and validity ended",
            f"lock status {open_user['lock_status']}, valid to {open_user['valid_to']}, no removal log entry",
            "account locked (UFLAG 64) with validity ended",
            "sap_users",
            "sheet 1",
            str(open_user["user_id"]),
            "Lock Status (UFLAG)",
        ),
        Expectation(
            "NS-AC-03",
            "EXCEPTION",
            R.UNAPPROVED_PRIVILEGED_USER,
            "Holder is an approved system account or has an approved firefighter request",
            f"{privileged['profile']} held by {privileged['user_type']} user {privileged['full_name']}, approval reference blank",
            "privileged profile only on an approved system account or an approved firefighter request",
            "privileged_access",
            "Privileged profiles",
            R.UNAPPROVED_PRIVILEGED_USER,
            "Approval Reference",
        ),
        Expectation(
            "NS-AC-06",
            "INSUFFICIENT",
            "CA001",
            "MFA policy enabled for all users and applications during the period",
            f"configuration export dated {R.STALE_EXPORT_DATE}, before the period",
            "configuration evidenced as of a date within the period",
            "conditional_access",
            "document",
            "CA001",
            "Exported",
        ),
        Expectation(
            "NS-CM-01",
            "EXCEPTION",
            R.UNAPPROVED_TRANSPORT,
            "Change approval recorded on or before the import date",
            f"{unapproved['category']} change {R.UNAPPROVED_TICKET}: approval date blank, no CAB record, test evidence blank",
            "approval recorded on or before the import date",
            "change_tickets",
            "Changes",
            R.UNAPPROVED_TICKET,
            "Approval Date",
        ),
        Expectation(
            "NS-CM-01",
            "EXCEPTION",
            R.LATE_APPROVED_TRANSPORT,
            "Change approval recorded on or before the import date",
            f"approved {late_ticket['approval_date']}, imported {late_transport['import_date']}",
            "approval recorded on or before the import date",
            "transport_log",
            "sheet 1",
            R.LATE_APPROVED_TRANSPORT,
            "Import Date",
        ),
        Expectation(
            "NS-OP-02",
            "EXCEPTION",
            f"{failed_task['task_name']} {failed_task['run_date']}",
            "Each failed task has an incident and a recorded resolution",
            "state FAILED, incident blank, resolution blank",
            "every failed task has an incident and a recorded resolution",
            "task_history",
            "sheet 1",
            str(failed_task["task_name"]),
            "Incident",
        ),
        Expectation(
            "NS-IP-01",
            "EXCEPTION",
            "2027-09",
            "Report total agrees to the ledger, or the difference is explained and resolved",
            f"report {R.REVENUE_REPORT_TOTAL} vs ledger {R.GL_REVENUE_TOTAL}: difference {R.REVENUE_REPORT_TOTAL - R.GL_REVENUE_TOTAL}, explanation blank; company code 4000 absent from the report",
            "report total agrees to the ledger or the difference is explained and resolved",
            "ipe_reconciliation",
            "Reconciliation",
            "Difference",
            "Amount USD",
        ),
        Expectation(
            "NS-MR-01",
            "EXCEPTION",
            f"{R.UNEXPLAINED_FLUX_ACCOUNT} 2027-09",
            "Every variance over the threshold has a documented explanation",
            f"variance {flux['variance_pct']}% ({flux['variance_usd']}) over threshold, explanation blank",
            "every variance over 10% and USD 250,000 has a documented explanation",
            "flux_analysis",
            "Flux Sep vs Aug",
            R.UNEXPLAINED_FLUX_ACCOUNT,
            "Explanation",
        ),
        Expectation(
            "NS-MR-01",
            "EXCEPTION",
            "2027-08 memo",
            "Review signed after the report run date",
            f"signed {R.AUGUST_REVIEW_DATE}, report run {R.AUGUST_REPORT_RUN}",
            "review signed on or after the report run date",
            "close_memo_aug",
            "document",
            "August 2027",
            "Reviewed and signed",
        ),
    ]
    return found


def outcome_by_control(data: R.Records | None = None) -> dict[str, str]:
    """The expected outcome per control: PASS, EXCEPTION, or INSUFFICIENT."""
    out: dict[str, str] = {}
    for item in expectations(data):
        out[item.control_ref] = (
            item.outcome if out.get(item.control_ref) != "EXCEPTION" else "EXCEPTION"
        )
    return out
