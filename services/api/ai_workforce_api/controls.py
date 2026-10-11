"""Standard control library. It is code, so a change to it needs code review.

The library covers IT general controls and starter controls for each business cycle.

An engagement copies the controls it needs into its RCM and tailors them there:
which are in scope, who owns each one, how often it runs, and which applications it
covers. The copy keeps the library key and version, so the source is always known.
"""

import hashlib
import json
from dataclasses import asdict, dataclass

LIBRARY_VERSION = 2

# Standard areas. A client's own term for its process or area maps to one of these.
DOMAIN_LABELS: dict[str, str] = {
    "ACCESS": "Logical access",
    "CHANGE": "Change management",
    "OPERATIONS": "IT operations",
    "ITAC": "Application controls (ITAC)",
    "IPE": "Key reports and IPE",
    "ENTITY": "Entity-level controls",
    "ORDER_TO_CASH": "Order to cash / revenue",
    "PROCURE_TO_PAY": "Procure to pay / purchasing",
    "RECORD_TO_REPORT": "Record to report / financial close",
    "TREASURY": "Treasury and cash",
    "HIRE_TO_RETIRE": "Hire to retire / payroll",
    "INVENTORY": "Inventory and cost of sales",
    "FIXED_ASSETS": "Fixed assets and leases",
    "TAX": "Tax",
    "OTHER_BUSINESS": "Other business process",
}
DOMAINS = tuple(DOMAIN_LABELS)
ITGC_DOMAINS = ("ACCESS", "CHANGE", "OPERATIONS")
FREQUENCIES = ("ANNUAL", "QUARTERLY", "MONTHLY", "WEEKLY", "DAILY", "RECURRING", "EVENT_DRIVEN")
NATURES = ("MANUAL", "AUTOMATED", "IT_DEPENDENT_MANUAL")

# The standard worker who tests each area. A person can pick another tester per control.
BUSINESS_TESTER = "business-process-tester"
DOMAIN_AGENTS = {
    "ACCESS": "itgc-access-tester",
    "CHANGE": "itgc-change-tester",
    "OPERATIONS": "itgc-operations-tester",
    **{domain: BUSINESS_TESTER for domain in DOMAINS if domain not in ITGC_DOMAINS},
}
TESTER_KEYS = tuple(dict.fromkeys(DOMAIN_AGENTS.values()))

# Sample sizes commonly used for manual controls, by how often the control runs.
# An automated control is tested once, relying on effective change management.
SAMPLE_SIZES = {
    "ANNUAL": 1,
    "QUARTERLY": 2,
    "MONTHLY": 2,
    "WEEKLY": 5,
    "DAILY": 20,
    "RECURRING": 25,
    "EVENT_DRIVEN": 25,
}


@dataclass(frozen=True)
class LibraryControl:
    key: str
    control_ref: str
    domain: str
    title: str
    risk: str
    activity: str
    frequency: str
    nature: str
    test_attributes: tuple[str, ...]
    pbc_items: tuple[str, ...]


def _control(
    key: str,
    ref: str,
    domain: str,
    title: str,
    risk: str,
    activity: str,
    frequency: str,
    nature: str,
    attributes: tuple[str, ...],
    pbc: tuple[str, ...],
) -> LibraryControl:
    return LibraryControl(
        key, ref, domain, title, risk, activity, frequency, nature, attributes, pbc
    )


ITGC_LIBRARY: tuple[LibraryControl, ...] = (
    _control(
        "access-provisioning",
        "ITGC-AC-01",
        "ACCESS",
        "New user access is approved",
        "Users receive access they do not need, or access no one authorized.",
        "Access for new users and changes to access are requested and approved by the "
        "user's manager and, where required, the application owner before they are granted.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "A request exists for the access granted",
            "The request was approved by an appropriate person",
            "Approval happened before access was granted",
            "The access granted matches the access approved",
        ),
        (
            "Population of new users and access changes in the period, with grant dates",
            "Access request and approval for each selected user",
        ),
    ),
    _control(
        "access-termination",
        "ITGC-AC-02",
        "ACCESS",
        "Leavers lose access promptly",
        "People who have left keep access to the application or its data.",
        "Access for terminated users is removed within the agreed timeframe, triggered by "
        "the HR termination list.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The leaver's access was removed",
            "Removal happened within the agreed timeframe",
            "The account shows no activity after the termination date",
        ),
        (
            "HR list of terminations in the period, with termination dates",
            "Current user listing, or deactivation evidence for each selected leaver",
        ),
    ),
    _control(
        "access-review",
        "ITGC-AC-03",
        "ACCESS",
        "User access is reviewed periodically",
        "Inappropriate access built up over time goes unnoticed.",
        "Application owners review all user access at least quarterly, and changes they "
        "request are made and tracked to completion.",
        "QUARTERLY",
        "IT_DEPENDENT_MANUAL",
        (
            "The review covered a complete and accurate user listing",
            "The reviewer is appropriate and independent of the access reviewed",
            "Changes requested in the review were made",
            "The review was completed on time",
        ),
        (
            "Completed access reviews for the selected quarters, with sign-off",
            "Evidence of how the user listing was produced",
            "Tickets for the access changes the reviews requested",
        ),
    ),
    _control(
        "access-privileged",
        "ITGC-AC-04",
        "ACCESS",
        "Privileged access is restricted",
        "Too many people can change configuration, data, or security settings.",
        "Administrator and other privileged access is limited to people whose role needs "
        "it, and the list is approved by management.",
        "QUARTERLY",
        "MANUAL",
        (
            "Each privileged user has a role that needs the access",
            "Privileged access was approved",
            "No generic privileged account is used without accountability",
        ),
        (
            "Listing of users with privileged access to the application, database, and OS",
            "Job titles or roles for each privileged user",
        ),
    ),
    _control(
        "access-authentication",
        "ITGC-AC-05",
        "ACCESS",
        "Authentication settings meet policy",
        "Weak authentication lets someone use another person's account.",
        "Password, lockout, and multi-factor authentication settings are configured to "
        "meet the company security policy.",
        "ANNUAL",
        "AUTOMATED",
        (
            "Configured settings meet the security policy",
            "Settings did not change during the period, or changes were approved",
        ),
        (
            "Security policy for authentication",
            "System-generated screenshot or report of the authentication settings",
        ),
    ),
    _control(
        "access-shared-accounts",
        "ITGC-AC-06",
        "ACCESS",
        "Shared and service accounts are controlled",
        "Activity under shared accounts cannot be traced to a person.",
        "Shared, generic, and service accounts are inventoried, have a named owner, and "
        "cannot be used for interactive sign-in unless approved.",
        "QUARTERLY",
        "MANUAL",
        (
            "Each shared or service account has a named owner",
            "Interactive use is disabled or approved",
            "Credentials are stored in an approved vault",
        ),
        (
            "Inventory of shared, generic, and service accounts with owners",
            "Evidence of interactive sign-in restrictions",
        ),
    ),
    _control(
        "change-approval",
        "ITGC-CM-01",
        "CHANGE",
        "Changes are tested and approved",
        "Untested or unauthorized changes break processing or financial data.",
        "Changes to the application, database, and infrastructure are requested, tested, "
        "and approved by business and IT owners before they reach production.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "A change request exists",
            "The change was tested, with results documented",
            "The change was approved before deployment",
            "The deployed change matches the approved change",
        ),
        (
            "System-generated list of production changes in the period",
            "Change ticket, test evidence, and approval for each selected change",
        ),
    ),
    _control(
        "change-emergency",
        "ITGC-CM-02",
        "CHANGE",
        "Emergency changes are approved after the fact",
        "Urgent changes bypass review and are never checked.",
        "Emergency changes follow an expedited path and are reviewed and approved within "
        "the agreed number of days after deployment.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The change was correctly classified as an emergency",
            "Retrospective approval was obtained within the agreed timeframe",
        ),
        (
            "List of emergency changes in the period",
            "Retrospective approval for each selected emergency change",
        ),
    ),
    _control(
        "change-segregation",
        "ITGC-CM-03",
        "CHANGE",
        "Developers cannot deploy to production",
        "A developer moves their own unapproved change into production.",
        "People who develop changes cannot deploy them to production. Deployment access is "
        "limited to a separate, authorized group.",
        "QUARTERLY",
        "IT_DEPENDENT_MANUAL",
        (
            "No developer has production deployment access",
            "Deployment access is limited to the authorized group",
        ),
        (
            "List of developers",
            "List of users who can deploy to production",
        ),
    ),
    _control(
        "change-configuration",
        "ITGC-CM-04",
        "CHANGE",
        "Configuration changes are approved",
        "Changes to financial settings, such as tolerances or workflows, are made without review.",
        "Changes to application configuration that affect financial processing are "
        "requested, approved, and logged.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "A request and approval exist for the configuration change",
            "The change log matches the approved change",
        ),
        (
            "Configuration change log for the period",
            "Request and approval for each selected configuration change",
        ),
    ),
    _control(
        "change-data",
        "ITGC-CM-05",
        "CHANGE",
        "Direct data changes are approved",
        "Someone edits financial data directly in the database without authorization.",
        "Direct changes to production data are requested, approved by the data owner, "
        "performed by authorized staff, and logged.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "A request and data-owner approval exist",
            "The change was performed by an authorized person",
            "The change was logged",
        ),
        (
            "Log of direct data changes in the period",
            "Request and approval for each selected data change",
        ),
    ),
    _control(
        "operations-jobs",
        "ITGC-OP-01",
        "OPERATIONS",
        "Scheduled jobs are monitored and failures resolved",
        "A failed job leaves financial data incomplete and no one notices.",
        "Scheduled batch jobs are monitored. Failures are logged, investigated, and "
        "resolved to completion.",
        "DAILY",
        "IT_DEPENDENT_MANUAL",
        (
            "Job failures on the selected days were identified",
            "Each failure was investigated and resolved",
            "Resolution was documented",
        ),
        (
            "Job schedule for financially relevant jobs",
            "Job monitoring logs and tickets for failures on the selected days",
        ),
    ),
    _control(
        "operations-scheduling",
        "ITGC-OP-02",
        "OPERATIONS",
        "Job schedule changes are restricted",
        "Someone changes or disables a financial job without approval.",
        "Access to change the job schedule is limited, and schedule changes are approved.",
        "QUARTERLY",
        "MANUAL",
        (
            "Only authorized people can change the job schedule",
            "Schedule changes were approved",
        ),
        (
            "Users with access to change the job schedule",
            "Log of job schedule changes and their approvals",
        ),
    ),
    _control(
        "operations-backup",
        "ITGC-OP-03",
        "OPERATIONS",
        "Backups run and can be restored",
        "Financial data is lost and cannot be recovered.",
        "Financial data is backed up on schedule, failures are resolved, and restores are "
        "tested at least annually.",
        "DAILY",
        "AUTOMATED",
        (
            "Backups completed on the selected days, or failures were resolved",
            "A restore test succeeded during the period",
        ),
        (
            "Backup schedule and backup job reports for the selected days",
            "Evidence of the most recent restore test",
        ),
    ),
    _control(
        "operations-incidents",
        "ITGC-OP-04",
        "OPERATIONS",
        "Incidents are tracked to resolution",
        "Problems affecting financial systems go unresolved.",
        "Incidents affecting financial systems are logged, prioritized, and tracked to "
        "resolution, with root cause recorded for major incidents.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The incident was logged and prioritized",
            "The incident was resolved",
            "Root cause was recorded for major incidents",
        ),
        (
            "Incident log for financial systems in the period",
            "Tickets for the selected incidents",
        ),
    ),
    _control(
        "operations-physical",
        "ITGC-OP-05",
        "OPERATIONS",
        "Data center access is restricted",
        "Unauthorized people physically reach the servers that run financial systems.",
        "Physical access to the data center, or the hosting provider's controls over it, "
        "is restricted and reviewed.",
        "ANNUAL",
        "MANUAL",
        (
            "Access to the data center is limited to authorized people",
            "For a hosted system, the provider's assurance report covers the control",
        ),
        (
            "Data center access listing, or the hosting provider's SOC 1 report",
            "Bridge letter covering any gap to the period end",
        ),
    ),
)

# Starter business process controls. Typical key controls per cycle, written to be
# tailored: a client's own RCM replaces them when the team uploads one.
BUSINESS_LIBRARY: tuple[LibraryControl, ...] = (
    _control(
        "entity-code-of-conduct",
        "ELC-01",
        "ENTITY",
        "Code of conduct is acknowledged",
        "Employees act against the company's ethical standards without consequence.",
        "Employees acknowledge the code of conduct each year, and exceptions are followed "
        "up by HR or compliance.",
        "ANNUAL",
        "MANUAL",
        (
            "The code of conduct was approved and communicated in the period",
            "Selected employees acknowledged it",
            "Missing acknowledgements were followed up",
        ),
        (
            "Approved code of conduct and its communication",
            "Acknowledgement report for the period, with exceptions",
        ),
    ),
    _control(
        "entity-whistleblower",
        "ELC-02",
        "ENTITY",
        "Whistleblower reports are investigated",
        "Reported fraud or misconduct is not investigated or reported to the audit committee.",
        "Reports through the whistleblower line are logged, investigated, and summarized to "
        "the audit committee each quarter.",
        "QUARTERLY",
        "MANUAL",
        (
            "Each report was logged",
            "Each report was investigated and closed with a documented outcome",
            "The audit committee received the quarterly summary",
        ),
        (
            "Whistleblower log for the period",
            "Investigation files for the selected reports",
            "Audit committee materials and minutes",
        ),
    ),
    _control(
        "itac-three-way-match",
        "ITAC-01",
        "ITAC",
        "Invoices are blocked without a three-way match",
        "Vendors are paid for goods not ordered or not received, or at the wrong price.",
        "The system blocks a vendor invoice for payment when its quantity or price differs "
        "from the purchase order and goods receipt beyond the configured tolerance.",
        "RECURRING",
        "AUTOMATED",
        (
            "The match and tolerance configuration is as designed",
            "An invoice outside tolerance is blocked",
            "Only authorized users can change the configuration or release a block",
        ),
        (
            "Screenshot or export of the match and tolerance configuration",
            "Test transaction or a blocked invoice from the period",
            "Users who can change the configuration or release blocks",
        ),
    ),
    _control(
        "itac-credit-limit",
        "ITAC-02",
        "ITAC",
        "Orders over the credit limit are held",
        "Sales are made to customers who cannot pay.",
        "The system holds a sales order when the customer's exposure would exceed the "
        "approved credit limit until an authorized user releases it.",
        "RECURRING",
        "AUTOMATED",
        (
            "The credit check configuration is as designed",
            "An order over the limit is held",
            "Only authorized users can release a credit hold or change limits",
        ),
        (
            "Credit check configuration",
            "Test order or a held order from the period",
            "Users who can release credit holds or change limits",
        ),
    ),
    _control(
        "ipe-aged-receivables",
        "IPE-01",
        "IPE",
        "The aged receivables report is complete and accurate",
        "Decisions on the bad debt reserve rely on a report that is incomplete or wrong.",
        "The report used for the bad debt reserve is reconciled to the general ledger, and "
        "its logic and parameters are validated.",
        "QUARTERLY",
        "IT_DEPENDENT_MANUAL",
        (
            "The report total agrees to the receivables balance in the ledger",
            "Report parameters (date, entities) are appropriate",
            "Aging buckets are calculated correctly for selected items",
        ),
        (
            "Aged receivables report used for the reserve, with parameters",
            "Ledger balance for the same date",
            "Report logic or query description",
        ),
    ),
    _control(
        "ipe-journal-listing",
        "IPE-02",
        "IPE",
        "The journal entry listing is complete",
        "Journal entry testing misses entries because the listing is incomplete.",
        "The journal entry listing used for review and testing is reconciled to the change "
        "in ledger balances for the period.",
        "QUARTERLY",
        "IT_DEPENDENT_MANUAL",
        (
            "The listing's total activity agrees to the movement in the trial balance",
            "The listing covers every entity, source, and day in the period",
        ),
        (
            "Journal entry listing for the period, with extraction parameters",
            "Opening and closing trial balances",
        ),
    ),
    _control(
        "otc-customer-master",
        "OTC-01",
        "ORDER_TO_CASH",
        "Customer master changes are approved",
        "Fictitious customers are created, or terms and limits are changed without approval.",
        "New customers and changes to credit limits, terms, or bank details are approved "
        "by credit management and checked against support before they are made.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The change was requested with support",
            "An authorized person approved it before it was made",
            "The change in the system matches what was approved",
        ),
        (
            "Customer master change log for the period",
            "Approval and support for each selected change",
        ),
    ),
    _control(
        "otc-revenue-cutoff",
        "OTC-02",
        "ORDER_TO_CASH",
        "Revenue is recorded in the right period",
        "Revenue is recognized before control of the goods or services transfers.",
        "At each period end, shipments and invoices around the cutoff date are compared, and "
        "revenue is adjusted where delivery happened in the other period.",
        "QUARTERLY",
        "MANUAL",
        (
            "Shipments near period end were compared to invoices",
            "Differences were investigated and adjusted",
            "The review was performed and signed off by an appropriate person",
        ),
        (
            "Cutoff analysis for the period end",
            "Shipping documents and invoices for the selected items",
            "Any resulting adjustments",
        ),
    ),
    _control(
        "otc-cash-application",
        "OTC-03",
        "ORDER_TO_CASH",
        "Customer receipts are applied correctly",
        "Cash is applied to the wrong customer or invoice, misstating receivables.",
        "Unapplied cash and differences between receipts and open invoices are reviewed "
        "and resolved each week.",
        "WEEKLY",
        "IT_DEPENDENT_MANUAL",
        (
            "The unapplied cash report was reviewed",
            "Items older than the threshold were investigated",
            "The review was evidenced by the reviewer",
        ),
        (
            "Unapplied cash reports for the selected weeks",
            "Evidence of review and follow-up",
        ),
    ),
    _control(
        "otc-credit-memos",
        "OTC-04",
        "ORDER_TO_CASH",
        "Credit memos are approved",
        "Revenue is reduced, or receivables written off, without authorization.",
        "Credit memos above the threshold are approved by the appropriate level of "
        "management before they are issued.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The credit memo has a documented reason",
            "It was approved at the required level before it was issued",
            "The amount agrees to the approval",
        ),
        (
            "Credit memo listing for the period",
            "Approval and support for each selected credit memo",
        ),
    ),
    _control(
        "ptp-vendor-master",
        "PTP-01",
        "PROCURE_TO_PAY",
        "Vendor master changes are approved",
        "Payments are diverted through fictitious vendors or changed bank details.",
        "New vendors and changes to vendor bank details are approved by someone independent "
        "of purchasing and payments, and bank changes are confirmed with the vendor by a "
        "call-back.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The change was requested with support",
            "An independent person approved it before it was made",
            "Bank detail changes were confirmed with the vendor using known contact details",
        ),
        (
            "Vendor master change log for the period",
            "Approval, support, and call-back evidence for each selected change",
        ),
    ),
    _control(
        "ptp-purchase-approval",
        "PTP-02",
        "PROCURE_TO_PAY",
        "Purchase orders are approved within authority",
        "Goods or services are bought without authorization.",
        "Purchase orders are approved in the system according to the delegation of "
        "authority before they are sent to the vendor.",
        "EVENT_DRIVEN",
        "IT_DEPENDENT_MANUAL",
        (
            "The purchase order was approved before it was issued",
            "The approver had authority for the amount",
        ),
        (
            "Purchase order listing for the period",
            "Approval history for each selected order",
            "Delegation of authority matrix",
        ),
    ),
    _control(
        "ptp-accruals",
        "PTP-03",
        "PROCURE_TO_PAY",
        "Unrecorded liabilities are accrued",
        "Expenses for goods and services received before period end are not recorded.",
        "At each period end, goods received not invoiced and invoices received after period "
        "end are reviewed, and accruals are recorded for the period.",
        "QUARTERLY",
        "MANUAL",
        (
            "Received-not-invoiced balances and subsequent invoices were reviewed",
            "Accruals were recorded for items that belong to the period",
            "The review was approved by an appropriate person",
        ),
        (
            "Accrual analysis for the period end",
            "Subsequent disbursements listing",
            "Journal entries for the accruals",
        ),
    ),
    _control(
        "ptp-payment-run",
        "PTP-04",
        "PROCURE_TO_PAY",
        "Payment runs are approved",
        "Unauthorized or duplicate payments are made.",
        "Each payment run is reviewed and approved by two authorized people before it is "
        "released to the bank.",
        "WEEKLY",
        "MANUAL",
        (
            "The payment proposal was reviewed",
            "Two authorized people approved it before release",
            "The released amount agrees to the approved proposal",
        ),
        (
            "Payment run listing for the period",
            "Approved payment proposals and bank release evidence for the selected runs",
        ),
    ),
    _control(
        "rtr-journal-review",
        "RTR-01",
        "RECORD_TO_REPORT",
        "Manual journal entries are reviewed",
        "Erroneous or fraudulent journal entries are posted.",
        "Manual journal entries above the threshold are reviewed and approved by someone "
        "other than the preparer, with support.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The entry has support",
            "Someone other than the preparer approved it",
            "The approver was authorized for the amount",
        ),
        (
            "Manual journal entry listing for the period",
            "Support and approval for each selected entry",
        ),
    ),
    _control(
        "rtr-account-reconciliations",
        "RTR-02",
        "RECORD_TO_REPORT",
        "Balance sheet accounts are reconciled",
        "Misstatements in account balances are not found and corrected.",
        "Key balance sheet accounts are reconciled to supporting detail each month, and "
        "reconciling items are investigated and reviewed.",
        "MONTHLY",
        "MANUAL",
        (
            "The reconciliation agrees to the ledger",
            "Reconciling items are explained and cleared timely",
            "It was prepared and reviewed on time by different people",
        ),
        (
            "Reconciliation listing for the period",
            "Selected reconciliations with support and sign-offs",
        ),
    ),
    _control(
        "rtr-flux-review",
        "RTR-03",
        "RECORD_TO_REPORT",
        "Financial results are analyzed for unusual changes",
        "Material errors in the financial statements go unnoticed.",
        "Management compares results with the prior period and budget, and investigates "
        "changes above the threshold.",
        "QUARTERLY",
        "MANUAL",
        (
            "Changes above the threshold were identified",
            "Each was explained with corroborated reasons",
            "The analysis was reviewed by an appropriate person",
        ),
        (
            "Flux analysis for the selected quarters",
            "Evidence of review and explanations",
        ),
    ),
    _control(
        "rtr-consolidation",
        "RTR-04",
        "RECORD_TO_REPORT",
        "Consolidation and eliminations are reviewed",
        "Intercompany balances are not eliminated, or the consolidation is wrong.",
        "The consolidation, including intercompany eliminations and currency translation, "
        "is reviewed and approved at each period end.",
        "QUARTERLY",
        "IT_DEPENDENT_MANUAL",
        (
            "Intercompany balances agree between entities or differences are resolved",
            "Eliminations and translation were recorded correctly",
            "The consolidation was reviewed and approved",
        ),
        (
            "Consolidation package for the period end",
            "Intercompany reconciliation",
            "Evidence of review",
        ),
    ),
    _control(
        "treasury-bank-reconciliation",
        "TRS-01",
        "TREASURY",
        "Bank accounts are reconciled",
        "Cash is misstated, or unauthorized transactions go unnoticed.",
        "Each bank account is reconciled to the ledger every month, and reconciling items "
        "are investigated and reviewed.",
        "MONTHLY",
        "MANUAL",
        (
            "The reconciliation agrees to the bank statement and the ledger",
            "Reconciling items are explained and cleared timely",
            "It was reviewed by someone other than the preparer",
        ),
        (
            "List of bank accounts",
            "Selected bank reconciliations with statements and sign-offs",
        ),
    ),
    _control(
        "treasury-bank-access",
        "TRS-02",
        "TREASURY",
        "Bank signatories and portal access are reviewed",
        "People who should not can move company funds.",
        "Bank signatories and banking portal users are reviewed each quarter against "
        "current roles and the board-approved mandate.",
        "QUARTERLY",
        "MANUAL",
        (
            "Every signatory and portal user is authorized",
            "Changes were made for people who moved or left",
        ),
        (
            "Bank mandates and portal user listings",
            "Evidence of the quarterly review and resulting changes",
        ),
    ),
    _control(
        "treasury-debt",
        "TRS-03",
        "TREASURY",
        "Debt and covenants are monitored",
        "Debt is misstated, or a covenant breach is not disclosed.",
        "Debt balances are agreed to lender statements and covenant calculations are "
        "prepared and reviewed each quarter.",
        "QUARTERLY",
        "MANUAL",
        (
            "Debt balances agree to lender confirmations or statements",
            "Covenant calculations are accurate and reviewed",
        ),
        (
            "Lender statements and debt schedule",
            "Covenant calculations with evidence of review",
        ),
    ),
    _control(
        "h2r-payroll-changes",
        "HTR-01",
        "HIRE_TO_RETIRE",
        "Payroll master changes are approved",
        "Ghost employees are paid, or pay rates change without authorization.",
        "New hires, leavers, and pay rate changes are approved by HR and the manager before "
        "they are entered in payroll.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The change has HR and manager approval",
            "Approval happened before the change was processed",
            "The change in payroll matches what was approved",
        ),
        (
            "Payroll master change report for the period",
            "Approvals for each selected change",
        ),
    ),
    _control(
        "h2r-payroll-review",
        "HTR-02",
        "HIRE_TO_RETIRE",
        "Each payroll is reviewed before payment",
        "Payroll errors or unauthorized payments are made.",
        "Each payroll register is compared with the prior run, and changes above the "
        "threshold are investigated and approved before payment.",
        "MONTHLY",
        "IT_DEPENDENT_MANUAL",
        (
            "The register was compared with the prior run",
            "Changes above the threshold were explained",
            "The payroll was approved before payment",
        ),
        (
            "Payroll registers and variance analyses for the selected runs",
            "Evidence of approval",
        ),
    ),
    _control(
        "h2r-payroll-reconciliation",
        "HTR-03",
        "HIRE_TO_RETIRE",
        "Payroll is reconciled to the ledger",
        "Payroll expense and liabilities are misstated.",
        "Payroll expense and withholding liabilities are reconciled to the ledger each "
        "month and reviewed.",
        "MONTHLY",
        "MANUAL",
        (
            "The reconciliation agrees to the payroll register and the ledger",
            "Differences were investigated and resolved",
            "It was reviewed by someone other than the preparer",
        ),
        ("Payroll reconciliations for the selected months, with sign-offs",),
    ),
    _control(
        "inventory-counts",
        "INV-01",
        "INVENTORY",
        "Inventory is counted and differences are resolved",
        "Inventory recorded does not exist.",
        "Inventory is counted (cycle counts or a full count), and differences above the "
        "threshold are investigated and approved before adjustment.",
        "MONTHLY",
        "MANUAL",
        (
            "Counts followed the count instructions",
            "Differences above the threshold were investigated",
            "Adjustments were approved before they were posted",
        ),
        (
            "Count schedule and results for the period",
            "Investigation and approval of adjustments",
        ),
    ),
    _control(
        "inventory-valuation",
        "INV-02",
        "INVENTORY",
        "Slow-moving and obsolete inventory is reserved",
        "Inventory is carried above what it can be sold for.",
        "Management reviews aged, slow-moving, and excess inventory each quarter and "
        "records a reserve under the reserve policy.",
        "QUARTERLY",
        "MANUAL",
        (
            "The aging report used was complete and accurate",
            "The reserve follows the approved policy",
            "The reserve was reviewed and approved",
        ),
        (
            "Inventory aging report and reserve calculation",
            "Reserve policy and evidence of review",
        ),
    ),
    _control(
        "inventory-standard-costs",
        "INV-03",
        "INVENTORY",
        "Standard cost changes are approved",
        "Inventory and cost of sales are misstated by wrong standard costs.",
        "Changes to standard costs are reviewed and approved by cost accounting before they "
        "are updated in the system.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The change has support",
            "It was approved before it was updated",
            "The cost in the system matches what was approved",
        ),
        (
            "Standard cost change log for the period",
            "Support and approval for each selected change",
        ),
    ),
    _control(
        "fa-additions",
        "FA-01",
        "FIXED_ASSETS",
        "Capital additions are approved and capitalized correctly",
        "Expenses are capitalized, or assets are recorded without authorization.",
        "Capital expenditures are approved under the delegation of authority, and additions "
        "are reviewed against the capitalization policy before they are recorded.",
        "EVENT_DRIVEN",
        "MANUAL",
        (
            "The expenditure was approved within authority",
            "It meets the capitalization policy",
            "The asset was recorded at the right amount and in-service date",
        ),
        (
            "Fixed asset additions listing for the period",
            "Approval and invoice for each selected addition",
        ),
    ),
    _control(
        "fa-depreciation",
        "FA-02",
        "FIXED_ASSETS",
        "Depreciation is reviewed",
        "Depreciation expense is misstated.",
        "Depreciation is calculated by the system from approved useful lives, and the "
        "monthly charge is reviewed for reasonableness.",
        "MONTHLY",
        "IT_DEPENDENT_MANUAL",
        (
            "Useful lives match the approved policy",
            "The monthly charge was reviewed and differences were explained",
        ),
        (
            "Depreciation run and fixed asset register",
            "Evidence of the monthly review",
        ),
    ),
    _control(
        "fa-disposals-impairment",
        "FA-03",
        "FIXED_ASSETS",
        "Disposals and impairment are assessed",
        "Assets no longer in use stay on the books, or impairment is not recorded.",
        "Disposals are approved and recorded, and indicators of impairment are assessed each year.",
        "ANNUAL",
        "MANUAL",
        (
            "Disposals were approved and removed from the register",
            "Impairment indicators were assessed and documented",
        ),
        (
            "Disposals listing with approvals",
            "Impairment assessment for the year",
        ),
    ),
    _control(
        "tax-provision",
        "TAX-01",
        "TAX",
        "The income tax provision is reviewed",
        "Current and deferred tax are misstated.",
        "The income tax provision, including deferred taxes and uncertain positions, is "
        "prepared and reviewed by tax management and, where used, an external advisor.",
        "QUARTERLY",
        "MANUAL",
        (
            "The provision agrees to pre-tax income and supported adjustments",
            "Deferred tax balances roll forward correctly",
            "The provision was reviewed and approved",
        ),
        (
            "Tax provision workpapers for the period",
            "Evidence of review",
        ),
    ),
    _control(
        "tax-indirect",
        "TAX-02",
        "TAX",
        "Indirect tax returns are reconciled",
        "Sales and use tax or VAT liabilities are misstated.",
        "Indirect tax returns are reconciled to the ledger before they are filed and "
        "reviewed by someone other than the preparer.",
        "MONTHLY",
        "MANUAL",
        (
            "The return agrees to the ledger",
            "Differences were explained",
            "It was reviewed before filing",
        ),
        ("Selected returns with reconciliations and evidence of review",),
    ),
)

LIBRARY: tuple[LibraryControl, ...] = ITGC_LIBRARY + BUSINESS_LIBRARY

LIBRARY_KEYS = tuple(control.key for control in LIBRARY)
BY_KEY = {control.key: control for control in LIBRARY}


def library_fingerprint() -> str:
    """A test pins this, so the library cannot change without review."""
    payload = [asdict(control) for control in LIBRARY]
    text = json.dumps({"version": LIBRARY_VERSION, "controls": payload}, sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()


def library_problems() -> list[str]:
    problems: list[str] = []
    if len(set(LIBRARY_KEYS)) != len(LIBRARY_KEYS):
        problems.append("library keys repeat")
    refs = [control.control_ref for control in LIBRARY]
    if len(set(refs)) != len(refs):
        problems.append("control references repeat")
    for control in LIBRARY:
        if control.domain not in DOMAINS:
            problems.append(f"{control.key}: domain is unknown")
        if control.frequency not in FREQUENCIES:
            problems.append(f"{control.key}: frequency is unknown")
        if control.nature not in NATURES:
            problems.append(f"{control.key}: nature is unknown")
        if not control.test_attributes or not control.pbc_items:
            problems.append(f"{control.key}: attributes and PBC items are required")
    return problems


def sample_size(frequency: str, nature: str) -> int:
    """How many instances a tester selects. An automated control is tested once."""
    if nature == "AUTOMATED":
        return 1
    return SAMPLE_SIZES.get(frequency, 25)


def default_templates(nature: str) -> tuple[str, str]:
    """Design and operating effectiveness templates for a control."""
    effectiveness = "oe-automated" if nature == "AUTOMATED" else "oe-manual"
    return ("design-walkthrough", effectiveness)
