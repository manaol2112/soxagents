"""The Northstar evidence files, rendered from the records: CSV, XLSX, PDF and DOCX, the
same bytes every time (fixed document dates and archive timestamps), so a file's hash is
part of the dataset and a citation into it stays true.

Every file is written as the system that produced it would write it: a USR02 extract
has SAP's columns, a ServiceNow export has ticket fields, a PIM export has the role and
the assignment type. Nothing is a placeholder: the records behind each file are the
populations in records.py, and the scenarios live in single rows of them.
"""

# ruff: noqa: E501  (declarative column tables)
from __future__ import annotations

import csv
import io
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from ai_workforce_api.demo_northstar import records as R

CSV_TYPE = "text/csv"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_TYPE = "application/pdf"
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FIXED_STAMP = (2027, 10, 4, 9, 0, 0)
FIXED_DATETIME = datetime(2027, 10, 4, 9, 0, 0)
_CORE_STAMP = re.compile(r"(<dcterms:(?:created|modified)[^>]*>)[^<]*<")

Columns = tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class EvidenceFile:
    key: str
    file_name: str
    content_type: str
    content: bytes
    # Which controls the file belongs to (filed to the first; linked to the rest), the
    # system it came from (an application tag), and the folder it is filed under.
    controls: tuple[str, ...]
    system: str
    folder: str
    description: str

    @property
    def size(self) -> int:
        return len(self.content)


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return f"{value:.2f}" if value == value.quantize(Decimal("0.01")) else str(value)
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _rows(columns: Columns, rows: list[dict[str, object]]) -> list[list[str]]:
    return [[_cell(row.get(key)) for key, _ in columns] for row in rows]


def _stable_zip(content: bytes) -> bytes:
    """The same archive with every entry's timestamp fixed, so the bytes never move."""
    source = zipfile.ZipFile(io.BytesIO(content))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            info = zipfile.ZipInfo(item.filename, date_time=FIXED_STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = item.external_attr
            data = source.read(item.filename)
            if item.filename == "docProps/core.xml":
                # The writers stamp the save time here; the dataset has one date.
                data = _CORE_STAMP.sub(
                    lambda m: f"{m.group(1)}{FIXED_DATETIME.strftime('%Y-%m-%dT%H:%M:%SZ')}<",
                    data.decode("utf-8"),
                ).encode("utf-8")
            target.writestr(info, data)
    return out.getvalue()


def csv_bytes(columns: Columns, rows: list[dict[str, object]]) -> bytes:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow([label for _, label in columns])
    writer.writerows(_rows(columns, rows))
    return out.getvalue().encode("utf-8")


def xlsx_bytes(sheets: list[tuple[str, Columns, list[dict[str, object]]]]) -> bytes:
    from openpyxl import Workbook

    book = Workbook()
    book.properties.creator = "Northstar Technologies, Inc."
    book.properties.created = FIXED_DATETIME
    book.properties.modified = FIXED_DATETIME
    book.properties.lastModifiedBy = "Northstar Technologies, Inc."
    first = True
    for title, columns, rows in sheets:
        sheet = book.active if first else book.create_sheet()
        first = False
        sheet.title = title[:31]
        sheet.append([label for _, label in columns])
        for row in _rows(columns, rows):
            sheet.append(row)
    out = io.BytesIO()
    book.save(out)
    return _stable_zip(out.getvalue())


def pdf_bytes(
    title: str,
    meta: list[str],
    sections: list[tuple[str, Columns | None, list[dict[str, object]] | list[str]]],
) -> bytes:
    """Pages of a report: a title, its header lines, then sections of lines or tables, as
    text pypdf reads back line by line."""
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    page = canvas.Canvas(out, pagesize=landscape(letter), invariant=1)
    page.setTitle(title)
    page.setAuthor("Northstar Technologies, Inc.")
    width, height = landscape(letter)
    y = height - 48
    number = 1

    def line(text: str, size: int = 9, bold: bool = False) -> None:
        nonlocal y, number
        if y < 48:
            page.setFont("Helvetica", 8)
            page.drawString(48, 30, f"{title} - page {number}")
            page.showPage()
            number += 1
            y = height - 48
        page.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        page.drawString(48, y, text[:170])
        y -= size + 5

    line(title, 14, True)
    for item in meta:
        line(item, 9)
    y -= 6
    for heading, columns, rows in sections:
        if y < height - 60:
            y -= 4
        if heading:
            line(heading, 11, True)
        if columns is None:
            for text in rows:
                line(str(text))
        else:
            line(" | ".join(label for _, label in columns), 8, True)
            for row in _rows(columns, rows):  # type: ignore[arg-type]
                line(" | ".join(row), 8)
        y -= 6
    page.setFont("Helvetica", 8)
    page.drawString(48, 30, f"{title} - page {number}")
    page.showPage()
    page.save()
    return out.getvalue()


def docx_bytes(
    title: str,
    paragraphs: list[str],
    tables: list[tuple[str, Columns, list[dict[str, object]]]],
    closing: list[str] | None = None,
) -> bytes:
    from docx import Document

    document = Document()
    core = document.core_properties
    core.author = "Northstar Technologies, Inc."
    core.created = FIXED_DATETIME
    core.modified = FIXED_DATETIME
    core.last_modified_by = "Northstar Technologies, Inc."
    core.revision = 1
    document.add_heading(title, level=1)
    for text in paragraphs:
        document.add_paragraph(text)
    for heading, columns, rows in tables:
        if heading:
            document.add_heading(heading, level=2)
        table = document.add_table(rows=1, cols=len(columns))
        for cell, (_, label) in zip(table.rows[0].cells, columns, strict=True):
            cell.text = label
        for row in _rows(columns, rows):
            cells = table.add_row().cells
            for cell, value in zip(cells, row, strict=True):
                cell.text = value
    for text in closing or []:
        document.add_paragraph(text)
    out = io.BytesIO()
    document.save(out)
    return _stable_zip(out.getvalue())


# Column labels, as the source systems name them.

HR_TERMINATIONS: Columns = (
    ("employee_id", "Employee ID"), ("name", "Employee Name"), ("department", "Department"),
    ("entity", "Legal Entity"), ("termination_date", "Termination Date"),
    ("last_working_day", "Last Working Day"), ("termination_type", "Termination Type"),
    ("notified_by", "Notification Source"),
)  # fmt: skip
SAP_USERS: Columns = (
    ("user_id", "User ID"), ("full_name", "Full Name"), ("employee_id", "Employee ID"),
    ("user_type", "User Type"), ("department", "Department"), ("company_code", "Company Code"),
    ("created_on", "Created On"), ("valid_from", "Valid From"), ("valid_to", "Valid To"),
    ("lock_status", "Lock Status (UFLAG)"), ("last_logon", "Last Logon"),
)  # fmt: skip
TERMINATION_REMOVALS: Columns = (
    ("employee_id", "Employee ID"), ("sap_user", "SAP User ID"),
    ("termination_date", "Termination Date (Workday)"), ("lock_date", "SAP Lock Date"),
    ("business_days", "Business Days to Lock"), ("removed_by", "Removed By"), ("ticket", "Ticket"),
)  # fmt: skip
ACCESS_REQUESTS: Columns = (
    ("request_id", "Request"), ("sap_user", "SAP User ID"), ("name", "Requested For"),
    ("request_type", "Request Type"), ("roles_requested", "Roles Requested"),
    ("roles_provisioned", "Roles Provisioned"), ("requested_by", "Requested By (Manager)"),
    ("manager_approval", "Manager Approval Date"), ("role_owner", "Role Owner"),
    ("role_owner_approval", "Role Owner Approval Date"), ("provisioned_on", "Provisioned On"),
    ("provisioned_by", "Provisioned By"), ("status", "Status"),
)  # fmt: skip
PRIVILEGED_ACCESS: Columns = (
    ("user_id", "User ID"), ("full_name", "Full Name"), ("user_type", "User Type"),
    ("profile", "Profile"), ("assigned_on", "Assigned On"), ("approved_list", "On Approved List"),
    ("approval_ref", "Approval Reference"),
)  # fmt: skip
FIREFIGHTER_LOG: Columns = (
    ("request_id", "Firefighter Request"), ("firefighter_id", "Firefighter ID"),
    ("requested_by", "Requested By"), ("sap_user", "Requester SAP User"), ("reason", "Reason"),
    ("approved_by", "Approved By"), ("approved_on", "Approved On"),
    ("session_start", "Session Start"), ("session_end", "Session End"),
    ("log_reviewed_by", "Log Reviewed By"), ("log_reviewed_on", "Log Reviewed On"),
)  # fmt: skip
CERTIFICATIONS: Columns = (
    ("campaign_id", "Campaign"), ("scope", "Scope"), ("opened_on", "Opened"),
    ("closed_on", "Closed"), ("due_on", "Due"), ("assignments", "Assignments"), ("decided", "Decided"),
    ("approved", "Approved"), ("denied", "Denied"), ("reviewers", "Reviewers"),
    ("completion", "Completion"), ("signed_off_by", "Signed Off By"), ("signed_off_on", "Signed Off On"),
)  # fmt: skip
REVOCATIONS: Columns = (
    ("campaign_id", "Campaign"), ("sap_user", "SAP User ID"), ("name", "User"),
    ("group", "Group (SAP Role)"), ("decision", "Decision"), ("decided_by", "Decided By"),
    ("revoked_on", "Revoked On"), ("revoked_by", "Revoked By"),
)  # fmt: skip
ENTRA_PIM: Columns = (
    ("role", "Role"), ("principal", "Principal"), ("upn", "User Principal Name"),
    ("assignment_type", "Assignment Type"), ("mfa_required", "MFA on Activation"),
    ("assigned_on", "Assigned On"), ("approval_ref", "Approval Reference"),
)  # fmt: skip
ROLE_APPROVALS: Columns = (
    ("approval_ref", "Approval Reference"), ("role", "Role"), ("principal", "Principal"),
    ("requested_by", "Requested By"), ("approved_by", "Approved By"), ("approved_on", "Approved On"),
    ("justification", "Justification"),
)  # fmt: skip
CONDITIONAL_ACCESS: Columns = (
    ("policy_id", "Policy"), ("name", "Name"), ("state", "State"), ("users", "Users"),
    ("exclusions", "Exclusions"), ("applications", "Cloud Apps"), ("grant", "Grant Controls"),
)  # fmt: skip
SNOWFLAKE_GRANTS: Columns = (
    ("grant_id", "grant_id"), ("role", "role"), ("granted_to", "granted_to"), ("grantee_name", "grantee_name"),
    ("granted_by", "granted_by"), ("created_on", "created_on"), ("approval_ref", "approval_ref"),
)  # fmt: skip
SNOWFLAKE_APPROVALS: Columns = (
    ("approval_ref", "Approval Reference"), ("role", "Role"), ("grantee", "Grantee"),
    ("approved_by", "Approved By"), ("approved_on", "Approved On"), ("justification", "Justification"),
)  # fmt: skip
TRANSPORT_LOG: Columns = (
    ("transport_id", "Transport Request ID"), ("description", "Description"), ("type", "Type"),
    ("owner", "Owner"), ("imported_by", "Imported By"), ("import_date", "Import Date"),
    ("import_time", "Import Time"), ("return_code", "Return Code"), ("change_ticket", "Change Ticket"),
)  # fmt: skip
CHANGE_TICKETS: Columns = (
    ("ticket", "Change"), ("short_description", "Short Description"), ("category", "Category"),
    ("requested_by", "Requested By"), ("raised_on", "Raised On"), ("transports", "Transports"),
    ("approval_date", "Approval Date"), ("approved_by", "Approved By"),
    ("test_evidence", "Test Evidence"), ("status", "Status"),
)  # fmt: skip
PIPELINE_PRS: Columns = (
    ("pr_id", "Pull Request"), ("title", "Title"), ("author", "Author"), ("reviewer", "Reviewer"),
    ("review_state", "Review State"), ("approved_at", "Approved At"), ("merged_at", "Merged At"),
    ("deployed_from", "Deployed From"),
)  # fmt: skip
BATCH_MONITORING: Columns = (
    ("job_run", "Job Run ID"), ("run_date", "Run Date"), ("job_name", "Job Name"), ("status", "Status"),
    ("start_time", "Start Time"), ("incident", "Incident"), ("resolution", "Resolution"),
    ("resolved_on", "Resolved On"), ("reviewed_by", "Reviewed By"), ("reviewed_on", "Reviewed On"),
)  # fmt: skip
TASK_HISTORY: Columns = (
    ("run_id", "Run ID"), ("run_date", "Run Date"), ("task_name", "Task"), ("scheduled_time", "Scheduled"),
    ("state", "State"), ("error_message", "Error"), ("incident", "Incident"),
    ("resolution", "Resolution"), ("reviewed_by", "Reviewed By"),
)  # fmt: skip
TOLERANCE: Columns = (
    ("company_code", "Company Code"), ("tolerance_key", "Tolerance Key"), ("description", "Description"),
    ("lower_pct", "Lower Limit %"), ("upper_pct", "Upper Limit %"), ("lower_abs_usd", "Lower Limit USD"),
    ("upper_abs_usd", "Upper Limit USD"), ("check_limit", "Check Limit"), ("changed_by", "Changed By"),
    ("changed_on", "Changed On"),
)  # fmt: skip
AP_INVOICES: Columns = (
    ("invoice", "Invoice"), ("company_code", "Company Code"), ("vendor", "Vendor"),
    ("purchase_order", "Purchase Order"), ("posting_date", "Posting Date"),
    ("po_amount_usd", "PO Amount USD"), ("invoice_amount_usd", "Invoice Amount USD"),
    ("variance_usd", "Variance USD"), ("variance_pct", "Variance %"), ("payment_block", "Payment Block"),
)  # fmt: skip
BLOCKED_INVOICES: Columns = (
    ("invoice", "Invoice"), ("company_code", "Company Code"), ("vendor", "Vendor"),
    ("posting_date", "Posting Date"), ("invoice_amount_usd", "Invoice Amount USD"),
    ("variance_usd", "Variance USD"), ("variance_pct", "Variance %"), ("block_reason", "Block Reason"),
    ("released_by", "Released By"), ("released_on", "Released On"),
)  # fmt: skip
REVENUE_REPORT: Columns = (
    ("customer_id", "Customer ID"), ("customer", "Customer"), ("company_code", "Company Code"),
    ("entity", "Entity"), ("segment", "Segment"), ("revenue_usd", "Revenue USD"), ("period", "Period"),
)  # fmt: skip
GL_REVENUE: Columns = (
    ("company_code", "Company Code"), ("entity", "Entity"), ("gl_account", "GL Account"),
    ("account_name", "Account Name"), ("period", "Period"), ("amount_usd", "Amount USD"),
)  # fmt: skip
RECONCILIATION: Columns = (("line", "Line"), ("amount_usd", "Amount USD"))
CLOSE_CALENDAR: Columns = (
    ("period", "Period"), ("period_end", "Period End"), ("ledger_closed", "Ledger Closed"),
    ("flux_report_run", "Flux Report Run"), ("controller_review", "Controller Review"),
    ("revenue_report_run", "Revenue Report Run"),
    ("reconciliation_prepared", "Reconciliation Prepared"), ("status", "Status"),
)  # fmt: skip
FLUX: Columns = (
    ("gl_account", "GL Account"), ("account_name", "Account"), ("august_usd", "August 2027 USD"),
    ("september_usd", "September 2027 USD"), ("variance_usd", "Variance USD"),
    ("variance_pct", "Variance %"), ("over_threshold", "Over Threshold"),
    ("explanation", "Explanation"), ("investigated_by", "Investigated By"),
)  # fmt: skip


def _total(rows: list[dict[str, object]], key: str) -> Decimal:
    return sum((Decimal(str(r[key])) for r in rows), Decimal("0"))


def render(data: R.Records) -> list[EvidenceFile]:
    """Every evidence file of the engagement, in a fixed order."""
    files: list[EvidenceFile] = []

    def add(
        key: str, name: str, kind: str, content: bytes, controls: tuple[str, ...], system: str,
        folder: str, description: str,
    ) -> None:  # fmt: skip
        files.append(EvidenceFile(key, name, kind, content, controls, system, folder, description))

    add("hr_terminations", "HR_Terminations_FY2027_Jan-Sep.xlsx", XLSX_TYPE,
        xlsx_bytes([("Terminations", HR_TERMINATIONS, data.hr_terminations)]),
        ("NS-AC-02",), "entra", "Access/Terminations",
        "Workday termination listing, 1 January to 30 September 2027")  # fmt: skip
    add("sap_users", "SAP_User_Listing_USR02_2027-09-30.csv", CSV_TYPE,
        csv_bytes(SAP_USERS, data.sap_users),
        ("NS-AC-02", "NS-AC-01", "NS-AC-04"), "sap", "Access/SAP",
        "SAP S/4HANA user master (USR02) as of 30 September 2027")  # fmt: skip
    add("termination_removals", "SAP_Termination_Removal_Log_FY2027.csv", CSV_TYPE,
        csv_bytes(TERMINATION_REMOVALS, data.termination_removals),
        ("NS-AC-02",), "sap", "Access/Terminations",
        "SAP security termination removal log, 1 January to 30 September 2027")  # fmt: skip
    add("access_requests", "SAP_Access_Requests_FY2027.xlsx", XLSX_TYPE,
        xlsx_bytes([("Requests", ACCESS_REQUESTS, data.access_requests)]),
        ("NS-AC-01",), "sap", "Access/Provisioning",
        "ServiceNow SAP access requests closed 1 January to 30 September 2027")  # fmt: skip
    add("privileged_access", "SAP_Privileged_Access_Report_2027-09-30.xlsx", XLSX_TYPE,
        xlsx_bytes([("Privileged profiles", PRIVILEGED_ACCESS, data.privileged_access)]),
        ("NS-AC-03",), "sap", "Access/Privileged",
        "SAP_ALL, SAP_NEW and firefighter assignments as of 30 September 2027")  # fmt: skip
    add("firefighter_log", "SAP_Firefighter_Request_Log_FY2027.csv", CSV_TYPE,
        csv_bytes(FIREFIGHTER_LOG, data.firefighter_log),
        ("NS-AC-03",), "sap", "Access/Privileged",
        "Firefighter requests, sessions and log reviews, 1 January to 30 September 2027")  # fmt: skip
    certification_sections: list[tuple[str, Columns | None, Any]] = []
    for campaign in data.access_certifications:
        cid = str(campaign["campaign_id"])
        certification_sections.append((f"Campaign {cid}", CERTIFICATIONS, [campaign]))
        certification_sections.append(
            (f"{cid}: denied assignments and revocations", REVOCATIONS,
             [r for r in data.certification_revocations if r["campaign_id"] == cid])
        )  # fmt: skip
    add("access_certifications", "Entra_Access_Review_Campaigns_2027_Q1-Q3.xlsx", XLSX_TYPE,
        xlsx_bytes([("Campaigns", CERTIFICATIONS, data.access_certifications)]),
        ("NS-AC-04",), "entra", "Access/Certifications",
        "Quarterly access review campaigns (groups mapped to SAP roles), Q1 to Q3 2027")  # fmt: skip
    add("certification_revocations", "Entra_Access_Review_Revocations_2027_Q1-Q3.csv", CSV_TYPE,
        csv_bytes(REVOCATIONS, data.certification_revocations),
        ("NS-AC-04",), "entra", "Access/Certifications",
        "Denied assignments and their revocations, by campaign")  # fmt: skip
    add("certification_report", "Entra_Access_Certifications_2027_Q1-Q3.pdf", PDF_TYPE,
        pdf_bytes("Entra ID access review campaigns, FY2027 Q1 to Q3",
                  ["Microsoft Entra ID access reviews: groups mapped to SAP S/4HANA roles",
                   "Exported 2027-10-01 by Elena Vasquez, Identity & Access Manager"],
                  certification_sections),
        ("NS-AC-04",), "entra", "Access/Certifications",
        "Signed campaign report with reviewers, decisions and revocations")  # fmt: skip
    add("entra_pim", "Entra_PIM_Role_Assignments_2027-09-30.csv", CSV_TYPE,
        csv_bytes(ENTRA_PIM, data.entra_pim),
        ("NS-AC-05",), "entra", "Access/Privileged",
        "Privileged Identity Management role assignments as of 30 September 2027")  # fmt: skip
    add("entra_role_approvals", "Entra_Privileged_Role_Approvals_FY2027.xlsx", XLSX_TYPE,
        xlsx_bytes([("Approvals", ROLE_APPROVALS, data.entra_role_approvals)]),
        ("NS-AC-05",), "entra", "Access/Privileged",
        "Approved requests for privileged directory roles")  # fmt: skip
    add("conditional_access", "Entra_Conditional_Access_Policies.docx", DOCX_TYPE,
        docx_bytes("Conditional Access policies: configuration export",
                   [f"Tenant: northstar.example. Exported {R.STALE_EXPORT_DATE.isoformat()} by "
                    "Elena Vasquez from the Entra admin center (Protection > Conditional Access).",
                    "This export lists every policy and its state at the time of export."],
                   [("Policies", CONDITIONAL_ACCESS, data.conditional_access)],
                   ["Break-glass accounts breakglass01 and breakglass02 are excluded from CA001 "
                    "and CA003 and monitored through sign-in alerts."]),
        ("NS-AC-06",), "entra", "Access/Authentication",
        "Conditional access policy export (exported 14 October 2026)")  # fmt: skip
    add("snowflake_grants", "Snowflake_Grants_2027-09-30.csv", CSV_TYPE,
        csv_bytes(SNOWFLAKE_GRANTS, data.snowflake_grants),
        ("NS-AC-07",), "snowflake", "Access/Snowflake",
        "SHOW GRANTS output for account roles as of 30 September 2027")  # fmt: skip
    add("snowflake_role_approvals", "Snowflake_Privileged_Role_Approvals_FY2027.xlsx", XLSX_TYPE,
        xlsx_bytes([("Approvals", SNOWFLAKE_APPROVALS, data.snowflake_role_approvals)]),
        ("NS-AC-07",), "snowflake", "Access/Snowflake",
        "Approved requests for ACCOUNTADMIN, SECURITYADMIN and SYSADMIN")  # fmt: skip
    add("transport_log", "SAP_Transport_Import_Log_FY2027.csv", CSV_TYPE,
        csv_bytes(TRANSPORT_LOG, data.transport_log),
        ("NS-CM-01",), "sap", "Change/SAP",
        "STMS production import log, 1 January to 30 September 2027")  # fmt: skip
    add("change_tickets", "ServiceNow_Change_Tickets_FY2027.xlsx", XLSX_TYPE,
        xlsx_bytes([("Changes", CHANGE_TICKETS, data.change_tickets)]),
        ("NS-CM-01",), "sap", "Change/SAP",
        "ServiceNow change tickets with transports, approvals and test evidence")  # fmt: skip
    cab_sections: list[tuple[str, Columns | None, Any]] = [
        (f"CAB meeting {m['meeting_date']}: chair {m['chair']}; attendees {m['attendees']}",
         None,
         [f"Approved: {', '.join(m['approved_tickets']) or 'none'}",  # type: ignore[arg-type]
          f"Deferred: {m['deferred']}"])
        for m in data.cab_meetings
    ]  # fmt: skip
    add("cab_approvals", "CAB_Meeting_Approvals_FY2027.pdf", PDF_TYPE,
        pdf_bytes("Change Advisory Board: approvals by meeting, FY2027",
                  ["Weekly CAB, Mondays. Emergency changes are approved by the change manager "
                   "and ratified at the next meeting.",
                   "Minutes extracted 2027-10-01 by Marcus Delgado"],
                  cab_sections),
        ("NS-CM-01",), "sap", "Change/SAP", "CAB meeting approvals, 4 January to 27 September 2027")  # fmt: skip
    add("pipeline_prs", "Snowflake_Pipeline_Pull_Requests_FY2027.csv", CSV_TYPE,
        csv_bytes(PIPELINE_PRS, data.pipeline_prs),
        ("NS-CM-02",), "snowflake", "Change/Snowflake",
        "Pull requests merged to northstar-data main, 1 January to 30 September 2027")  # fmt: skip
    add("batch_monitoring", "SAP_Batch_Job_Monitoring_2027-09.xlsx", XLSX_TYPE,
        xlsx_bytes([("September 2027", BATCH_MONITORING, data.batch_monitoring)]),
        ("NS-OP-01",), "sap", "Operations/SAP",
        "Daily SM37 finance job review with incidents, September 2027")  # fmt: skip
    add("task_history", "Snowflake_Task_History_2027-09.csv", CSV_TYPE,
        csv_bytes(TASK_HISTORY, data.task_history),
        ("NS-OP-02",), "snowflake", "Operations/Snowflake",
        "Snowflake task history with incidents, September 2027")  # fmt: skip
    add("tolerance_config", "SAP_OMR6_Tolerance_Configuration_2027-09-30.pdf", PDF_TYPE,
        pdf_bytes("SAP S/4HANA: invoice tolerance keys (OMR6)",
                  ["Transaction OMR6, client 100, production. Displayed 2027-09-30 by Samuel Osei.",
                   "Tolerance key PE: price variance, invoice against purchase order."],
                  [("Tolerance limits by company code", TOLERANCE, data.tolerance_config)]),
        ("NS-AP-01",), "sap", "ITAC/Three-way match",
        "OMR6 tolerance configuration as of 30 September 2027")  # fmt: skip
    add("ap_invoices", "SAP_AP_Invoice_Population_2027-09.csv", CSV_TYPE,
        csv_bytes(AP_INVOICES, data.ap_invoices),
        ("NS-AP-01",), "sap", "ITAC/Three-way match",
        "Purchase-order invoices posted in September 2027 with variances and blocks")  # fmt: skip
    add("blocked_invoices", "SAP_Blocked_Invoices_2027-09.csv", CSV_TYPE,
        csv_bytes(BLOCKED_INVOICES, data.blocked_invoices),
        ("NS-AP-01",), "sap", "ITAC/Three-way match",
        "Invoices blocked for price variance in September 2027")  # fmt: skip
    report_rows = list(data.revenue_report) + [
        {"customer_id": "", "customer": "Total", "company_code": "", "entity": "", "segment": "",
         "revenue_usd": _total(data.revenue_report, "revenue_usd"), "period": "2027-09"}
    ]  # fmt: skip
    add("revenue_report", "Revenue_by_Customer_2027-09.xlsx", XLSX_TYPE,
        xlsx_bytes([("Revenue by customer", REVENUE_REPORT, report_rows)]),
        ("NS-IP-01",), "snowflake", "IPE/Revenue",
        "Snowflake revenue-by-customer report, September 2027 (run 2027-10-02 06:10)")  # fmt: skip
    gl_rows = list(data.gl_revenue) + [
        {"company_code": "", "entity": "Total", "gl_account": "4000-4199", "account_name": "Revenue",
         "period": "2027-09", "amount_usd": _total(data.gl_revenue, "amount_usd")}
    ]  # fmt: skip
    add("gl_revenue", "SAP_GL_Revenue_by_Company_Code_2027-09.csv", CSV_TYPE,
        csv_bytes(GL_REVENUE, gl_rows),
        ("NS-IP-01",), "sap", "IPE/Revenue",
        "SAP GL revenue accounts 4000 to 4199 by company code, September 2027")  # fmt: skip
    add("ipe_reconciliation", "IPE_Revenue_Report_Reconciliation_2027-09.xlsx", XLSX_TYPE,
        xlsx_bytes([("Reconciliation", RECONCILIATION, data.ipe_reconciliation)]),
        ("NS-IP-01",), "snowflake", "IPE/Revenue",
        "Report-to-ledger reconciliation, September 2027")  # fmt: skip
    add("close_calendar", "Monthly_Close_Calendar_FY2027.xlsx", XLSX_TYPE,
        xlsx_bytes([("Close calendar", CLOSE_CALENDAR, data.close_calendar)]),
        ("NS-MR-01", "NS-IP-01"), "sap", "Close/Calendar",
        "Monthly close calendar, January to September 2027: ledger close, report runs, reviews")  # fmt: skip
    report_rows_aug = list(data.revenue_report_aug) + [
        {"customer_id": "", "customer": "Total", "company_code": "", "entity": "", "segment": "",
         "revenue_usd": _total(data.revenue_report_aug, "revenue_usd"), "period": "2027-08"}
    ]  # fmt: skip
    add("revenue_report_aug", "Revenue_by_Customer_2027-08.xlsx", XLSX_TYPE,
        xlsx_bytes([("Revenue by customer", REVENUE_REPORT, report_rows_aug)]),
        ("NS-IP-01",), "snowflake", "IPE/Revenue",
        "Snowflake revenue-by-customer report, August 2027 (run 2027-09-01 06:10)")  # fmt: skip
    gl_rows_aug = list(data.gl_revenue_aug) + [
        {"company_code": "", "entity": "Total", "gl_account": "4000-4199", "account_name": "Revenue",
         "period": "2027-08", "amount_usd": _total(data.gl_revenue_aug, "amount_usd")}
    ]  # fmt: skip
    add("gl_revenue_aug", "SAP_GL_Revenue_by_Company_Code_2027-08.csv", CSV_TYPE,
        csv_bytes(GL_REVENUE, gl_rows_aug),
        ("NS-IP-01",), "sap", "IPE/Revenue",
        "SAP GL revenue accounts 4000 to 4199 by company code, August 2027")  # fmt: skip
    add("ipe_reconciliation_aug", "IPE_Revenue_Report_Reconciliation_2027-08.xlsx", XLSX_TYPE,
        xlsx_bytes([("Reconciliation", RECONCILIATION, data.ipe_reconciliation_aug)]),
        ("NS-IP-01",), "snowflake", "IPE/Revenue",
        "Report-to-ledger reconciliation, August 2027: agreed")  # fmt: skip
    add("flux_analysis", "Flux_Analysis_2027-09.xlsx", XLSX_TYPE,
        xlsx_bytes([("Flux Sep vs Aug", FLUX, data.flux_analysis)]),
        ("NS-MR-01",), "sap", "Close/Flux",
        "Monthly fluctuation analysis, September versus August 2027 (threshold 10% and USD 250,000)")  # fmt: skip
    add("close_memo_sep", "Close_Review_Memo_2027-09.docx", DOCX_TYPE,
        docx_bytes("Monthly close review memo: September 2027",
                   ["Prepared by: Accounting (close team). Reviewer: Grace Lindqvist, Corporate Controller.",
                    f"Flux analysis report run: {R.SEPTEMBER_REPORT_RUN.isoformat()} from SAP S/4HANA (FAGLL03H, all company codes).",
                    "Threshold: variances over 10 percent and USD 250,000 are investigated and explained.",
                    "Accounts over the threshold this month: 4100 Subscription revenue (+12.4%); 5100 Cost of subscription revenue (+11.8%); 6300 Sales commissions (+18.6%); 1200 Accounts receivable (+14.9%).",
                    "Explanations are recorded on the flux analysis. Account 4100: explanation to follow from Revenue Operations.",
                    ],
                   [],
                   [f"Reviewed and signed: Grace Lindqvist, Corporate Controller, {R.SEPTEMBER_REVIEW_DATE.isoformat()}."]),
        ("NS-MR-01",), "sap", "Close/Memos", "Close review memo, September 2027")  # fmt: skip
    add("close_memo_aug", "Close_Review_Memo_2027-08.docx", DOCX_TYPE,
        docx_bytes("Monthly close review memo: August 2027",
                   ["Prepared by: Accounting (close team). Reviewer: Grace Lindqvist, Corporate Controller.",
                    f"Flux analysis report run: {R.AUGUST_REPORT_RUN.isoformat()} from SAP S/4HANA (FAGLL03H, all company codes).",
                    "Threshold: variances over 10 percent and USD 250,000 are investigated and explained.",
                    "Accounts over the threshold this month: 6300 Sales commissions (+11.2%), explained by the mid-year plan true-up.",
                    ],
                   [],
                   [f"Reviewed and signed: Grace Lindqvist, Corporate Controller, {R.AUGUST_REVIEW_DATE.isoformat()}."]),
        ("NS-MR-01",), "sap", "Close/Memos", "Close review memo, August 2027")  # fmt: skip
    return files


FILE_KEYS: tuple[str, ...] = (
    "hr_terminations", "sap_users", "termination_removals", "access_requests",
    "privileged_access", "firefighter_log", "access_certifications", "entra_pim",
    "entra_role_approvals", "conditional_access", "snowflake_grants",
    "snowflake_role_approvals", "transport_log", "change_tickets", "cab_approvals",
    "pipeline_prs", "batch_monitoring", "task_history", "tolerance_config", "ap_invoices",
    "blocked_invoices", "revenue_report", "gl_revenue", "ipe_reconciliation",
    "close_calendar", "revenue_report_aug", "gl_revenue_aug", "ipe_reconciliation_aug",
    "flux_analysis", "close_memo_sep", "close_memo_aug", "certification_revocations",
    "certification_report",
)  # fmt: skip
