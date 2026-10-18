"""Control statements for business process controls (Milestone 8.9). See
control_statements.py for what each field means.

Every statement is a draft for a SOX methodology reviewer. A value only the client knows
is a {slot}; nothing here sets a threshold, a deadline, or a role on the client's behalf.
"""

from ai_workforce_api.control_statements import Assertion, Frequency, Information, Slot, Statement
from ai_workforce_api.statements_itgc import ACCESS_ITGCS, CHANGE_ITGCS

STATEMENTS: dict[str, Statement] = {}


def _add(key: str, statement: Statement) -> None:
    STATEMENTS[key] = statement


def _role(key: str, label: str, why: str, example: str) -> Slot:
    # A role names who performs or reviews; the tester reads the evidence of who did, so a
    # role never holds testing.
    return Slot(key, label, "ROLE", why, example, blocks=False)


def _owner(key: str, area: str, example: str) -> Slot:
    return _role(key, f"the control owner for {area}",
                 "Accountable for the control's design and operation.", example)  # fmt: skip


def _threshold(key: str, label: str, why: str, example: str, placeholder: str = "") -> Slot:
    return Slot(key, label, "AMOUNT", why, example, placeholder=placeholder)


# The wording 8.8's precision attributes use for a review's threshold.
PRECISION = "the threshold or criteria for investigation the control sets"


ERP = Slot("erp", "the financial system", "SYSTEM", "Where the transactions are recorded.",
           "SAP S/4HANA", blocks=False)  # fmt: skip
SYSTEM_ITGCS = ACCESS_ITGCS + CHANGE_ITGCS


def _master_data(
    key: str,
    what: str,
    fields: str,
    approver: str,
    approver_example: str,
    risk: str,
    assertions: tuple[Assertion, ...],
    owner_area: str,
    owner_example: str,
    support: str,
) -> Statement:
    """A master data change approved against support before it is made."""
    return Statement(
        text=f"Each {what} ({fields}) is requested with {{{key}-support}} and approved by "
        f"{{{key}-approver}} before {{{key}-maintainer}} makes it in {{erp}}. The maintainer "
        "is not the approver.",
        risk=risk,
        assertions=assertions,
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator=f"{{{key}-maintainer}}",
        reviewer=f"{{{key}-approver}}",
        owner=f"{{{key}-owner}}",
        authority="The approver must have authority over the data and must not make the change.",
        judgment="LOW",
        judgment_note="The approver checks a stated change against its support.",
        precision=f"Every {what} in the period, as listed from {{erp}}'s change log.",
        investigation="A change found without approval or support is reviewed with the "
        "approver and corrected if needed.",
        information=(
            Information(
                f"{what.capitalize()} log from the system",
                "SYSTEM_REPORT",
                ("Record", "Field", "Old value", "New value", "Changed by", "Date"),
            ),
        ),  # fmt: skip
        itgcs=SYSTEM_ITGCS,
        evidence="The request with its support and approval dated before the change, and "
        "{erp}'s change log.",
        slots=(
            ERP,
            Slot(
                f"{key}-support",
                "the support the control requires",
                "TEXT",
                "What the approver checks the change against.",
                support,
                blocks=False,
                placeholder="the documents the control requires",
            ),
            _role(f"{key}-approver", f"the approver of {what}s", "The reviewer.", approver_example),
            _role(
                f"{key}-maintainer",
                "the role that maintains the data",
                "The operator.",
                "Master data team",
            ),
            _owner(f"{key}-owner", owner_area, owner_example),
        ),  # fmt: skip
    )


def _analytic_review(
    key: str,
    *,
    text: str,
    risk: str,
    assertions: tuple[Assertion, ...],
    frequency: Frequency,
    info: tuple[Information, ...],
    owner_area: str,
    owner_example: str,
    preparer_example: str,
    reviewer_example: str,
    threshold_label: str,
    threshold_example: str,
    evidence: str,
    itgcs: tuple[str, ...] = SYSTEM_ITGCS,
    extra: tuple[Slot, ...] = (),
) -> Statement:
    """A review that looks for outliers above a threshold and resolves them."""
    return Statement(
        text=text,
        risk=risk,
        assertions=assertions,
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency=frequency,
        operator=f"{{{key}-preparer}}",
        reviewer=f"{{{key}-reviewer}}",
        owner=f"{{{key}-owner}}",
        authority="The reviewer must understand the account and the business well enough to "
        "judge an explanation, and must not have prepared the analysis.",
        judgment="HIGH",
        judgment_note="Whether an explanation is adequate and corroborated is a judgment.",
        precision=f"Every item above {{{key}-threshold}} is investigated.",
        investigation="Each item above the threshold is explained with corroborating "
        "evidence, and a correcting entry is recorded where the explanation shows an error.",
        information=info,
        itgcs=itgcs,
        evidence=evidence,
        slots=(
            ERP,
            _role(f"{key}-preparer", "the preparer", "The operator.", preparer_example),
            _role(f"{key}-reviewer", "the reviewer", "Must not be the preparer.", reviewer_example),
            _threshold(
                f"{key}-threshold",
                threshold_label,
                "The control's precision: what must be investigated.",
                threshold_example,
                PRECISION,
            ),
            _owner(f"{key}-owner", owner_area, owner_example),
            *extra,
        ),  # fmt: skip
    )


def _reconciliation(
    key: str,
    *,
    what: str,
    ledger: str,
    detail: str,
    risk: str,
    assertions: tuple[Assertion, ...],
    owner_area: str,
    owner_example: str,
    preparer_example: str,
    reviewer_example: str,
    deadline_example: str,
    info: tuple[Information, ...],
    itgcs: tuple[str, ...] = SYSTEM_ITGCS,
) -> Statement:
    return Statement(
        text=f"Each month, {{{key}-preparer}} reconciles {ledger} to {detail} by "
        f"{{{key}-deadline}}. Reconciling items above {{{key}-threshold}} are investigated and "
        f"cleared or explained, and {{{key}-reviewer}} reviews and signs off the "
        "reconciliation.",
        risk=risk,
        assertions=assertions,
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="MONTHLY",
        operator=f"{{{key}-preparer}}",
        reviewer=f"{{{key}-reviewer}}",
        owner=f"{{{key}-owner}}",
        authority="The reviewer must not have prepared the reconciliation and must be able to "
        "judge whether reconciling items are valid.",
        judgment="MODERATE",
        judgment_note="Whether a reconciling item is valid and timely is a judgment.",
        precision=f"The {what} agrees, and every reconciling item above "
        f"{{{key}-threshold}} is explained.",
        investigation="Each reconciling item is cleared, explained with support, or corrected "
        "by an entry; aged items are escalated.",
        information=info,
        itgcs=itgcs,
        evidence="The signed reconciliation with its supporting detail, the reconciling items "
        "and their support, and the review date.",
        slots=(
            ERP,
            _role(f"{key}-preparer", "the preparer", "The operator.", preparer_example),
            _role(f"{key}-reviewer", "the reviewer", "Must not be the preparer.", reviewer_example),
            Slot(
                f"{key}-deadline",
                "the reconciliation deadline",
                "PERIOD",
                "When a month's reconciliation counts as late.",
                deadline_example,
                blocks=False,
                placeholder="the deadline in the reconciliation policy",
            ),
            _threshold(
                f"{key}-threshold",
                "the threshold for investigating reconciling items",
                "The control's precision.",
                "5,000",
            ),
            _owner(f"{key}-owner", owner_area, owner_example),
        ),  # fmt: skip
    )


# Order to cash

_add(
    "otc-customer-master",
    _master_data(
        "customer",
        "customer master change",
        "new customers, credit limits, payment terms, and bank details",
        "credit management",
        "Credit Manager",
        "A fictitious customer, an unapproved credit limit, or changed terms or bank details lead "
        "to sales that are not collectible or to misdirected refunds.",
        ("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        "credit",
        "Credit Manager",
        "a signed customer application or contract and a credit assessment",
    ),
)

_add(
    "otc-revenue-cutoff",
    _analytic_review(
        "cutoff",
        text="At each quarter end, {cutoff-preparer} lists shipments and invoices in the "
        "{cutoff-window} either side of period end from {erp}, compares each invoice's period "
        "with its proof of delivery, and records an adjustment for revenue recognized in the "
        "wrong period above {cutoff-threshold}. {cutoff-reviewer} reviews the analysis and "
        "adjustments and signs it off.",
        risk="Revenue is recognized before control of the goods or services transfers to the "
        "customer.",
        assertions=("EXISTENCE_OCCURRENCE", "COMPLETENESS"),
        frequency="QUARTERLY",
        info=(
            Information(
                "Shipments and invoices around period end",
                "SYSTEM_REPORT",
                ("Invoice", "Amount", "Invoice date", "Shipment", "Delivery date"),
            ),
            Information("Proof of delivery", "DOCUMENT", ("Shipment", "Delivered on")),
        ),
        owner_area="revenue",
        owner_example="Revenue Controller",
        preparer_example="Revenue accountant",
        reviewer_example="Revenue Controller",
        threshold_label="the threshold for adjusting a cutoff difference",
        threshold_example="10,000",
        evidence="The cutoff analysis with the listing's parameters, proof of delivery for the "
        "items examined, the adjustments, and the reviewer's sign-off.",
        extra=(
            Slot(
                "cutoff-window",
                "the number of days examined either side of period end",
                "DAYS",
                "Which transactions are compared.",
                "5 business days",
            ),
        ),
    ),
)

_add(
    "otc-cash-application",
    _analytic_review(
        "cash",
        text="Each week, {cash-preparer} reviews the unapplied cash report from {erp} and the "
        "differences between receipts and the invoices they pay. Items older than "
        "{cash-age} or above {cash-threshold} are investigated and applied, refunded, or "
        "written off with approval. {cash-reviewer} reviews the report and signs it off.",
        risk="Receipts are applied to the wrong customer or invoice, or left unapplied, so "
        "receivables and the allowance are misstated.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        frequency="WEEKLY",
        info=(
            Information(
                "Unapplied cash report",
                "SYSTEM_REPORT",
                ("Receipt", "Customer", "Amount", "Date received"),
            ),
        ),
        owner_area="cash application",
        owner_example="AR Manager",
        preparer_example="AR specialist",
        reviewer_example="AR Manager",
        threshold_label="the threshold for investigating an unapplied item",
        threshold_example="5,000",
        evidence="The week's unapplied cash report with the investigation of each item and the "
        "reviewer's sign-off.",
        extra=(
            Slot(
                "cash-age",
                "the age at which an unapplied item must be investigated",
                "DAYS",
                "The control's precision for small items.",
                "30 days",
            ),
        ),
    ),
)

_add(
    "otc-credit-memos",
    Statement(
        text="Each credit memo above {memo-threshold} is approved in {erp} before it is issued by "
        "the approver {approval-matrix} requires for its amount. The approver checks the reason "
        "and the amount against the original invoice and the customer's claim.",
        risk="Credits are issued without valid reason or authority, understating revenue or "
        "concealing misappropriated receipts.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="Billing",
        reviewer="The approver {approval-matrix} requires",
        owner="{memo-owner}",
        authority="The approver must hold the level {approval-matrix} sets for the amount and "
        "must not have raised the credit.",
        judgment="MODERATE",
        judgment_note="Whether the reason is valid is a judgment.",
        precision="Every credit memo above {memo-threshold} in the period.",
        investigation="A memo issued without approval is reviewed and, if invalid, reversed.",
        information=(
            Information(
                "Credit memo listing",
                "SYSTEM_REPORT",
                ("Memo", "Customer", "Amount", "Reason", "Issued on", "Approver"),
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The credit memo with its reason, the original invoice, and the approval dated "
        "before issue.",
        slots=(
            ERP,
            _threshold(
                "memo-threshold", "the credit memo threshold", "Which memos need approval.", "1,000"
            ),
            Slot(
                "approval-matrix",
                "the credit memo approval matrix",
                "TEXT",
                "Who may approve which amount.",
                "the Credit Memo Authority Matrix",
            ),
            _owner("memo-owner", "credit memos", "Revenue Controller"),
        ),  # fmt: skip
    ),
)

# Procure to pay

_add(
    "ptp-vendor-master",
    Statement(
        text="Each new vendor and each change to a vendor's bank details is requested with "
        "{vendor-support} and approved by {vendor-approver}, who works in neither purchasing nor "
        "payments, before {vendor-maintainer} makes it in {erp}. Each bank detail change is first "
        "confirmed with the vendor by calling a contact number already on file.",
        risk="A fictitious vendor is created, or a vendor's bank details are changed so payments "
        "go to a fraudster.",
        assertions=("EXISTENCE_OCCURRENCE",),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{vendor-maintainer}",
        reviewer="{vendor-approver}",
        owner="{vendor-owner}",
        authority="The approver must be independent of purchasing and payments.",
        judgment="LOW",
        judgment_note="The approver checks a stated change against support and the call-back.",
        precision="Every new vendor and bank detail change in the period, from {erp}'s change log.",
        investigation="A change without approval or call-back is frozen until verified with the "
        "vendor.",
        information=(
            Information(
                "Vendor master change log",
                "SYSTEM_REPORT",
                ("Vendor", "Field", "Old value", "New value", "Changed by", "Date"),
            ),
            Information(
                "Call-back record",
                "DOCUMENT",
                ("Vendor", "Number called", "Person confirming", "Date"),
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The request with support, the call-back record, the approval dated before the "
        "change, and the change log.",
        slots=(
            ERP,
            Slot(
                "vendor-support",
                "the support the control requires",
                "TEXT",
                "What the approver checks.",
                "a W-9 and a bank letter on letterhead",
                blocks=False,
                placeholder="the documents the control requires",
            ),
            _role(
                "vendor-approver",
                "the approver of vendor changes",
                "Must work in neither purchasing nor payments.",
                "Finance operations lead",
            ),
            _role(
                "vendor-maintainer",
                "the role that maintains vendors",
                "The operator.",
                "Master data team",
            ),
            _owner("vendor-owner", "vendor master data", "AP Manager"),
        ),  # fmt: skip
    ),
)

_add(
    "ptp-purchase-approval",
    Statement(
        text="Each purchase order is approved in {erp} by the approvers {doa} requires for its "
        "amount and category before it is sent to the vendor; {erp} routes the order for approval "
        "and does not release it until approved.",
        risk="Goods or services are bought without authority.",
        assertions=("EXISTENCE_OCCURRENCE",),
        control_type="PREVENTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The approvers {doa} requires",
        reviewer="None: the approval is the control",
        owner="{po-owner}",
        authority="Each approver must hold the authority {doa} sets for the amount.",
        judgment="LOW",
        judgment_note="The approver confirms a business need within their authority.",
        precision="Every purchase order released in the period.",
        investigation="An order released without the required approval is investigated and the "
        "workflow corrected.",
        information=(
            Information(
                "Purchase order approval workflow configuration",
                "SYSTEM_SCREEN",
                ("Release strategy", "Amount bands", "Approvers"),
            ),
            Information(
                "Purchase order listing",
                "SYSTEM_REPORT",
                ("Order", "Amount", "Approver", "Approved on", "Sent on"),
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The order's approval history in {erp} and the workflow configuration.",
        slots=(
            ERP,
            Slot(
                "doa",
                "the delegation of authority",
                "TEXT",
                "Who may approve which amount.",
                "the Delegation of Authority policy",
                blocks=False,
            ),
            _owner("po-owner", "purchasing", "Procurement Manager"),
        ),  # fmt: skip
        applies_when="If {erp}'s workflow enforces {doa} so an order cannot be released without "
        "the right approval, the control is tested as an application control: the configuration, "
        "and one order showing it operated.",
    ),
)

_add(
    "ptp-accruals",
    _analytic_review(
        "accrual",
        text="At each quarter end, {accrual-preparer} reviews goods received not invoiced from "
        "{erp} and invoices received in the {accrual-window} after period end, identifies "
        "liabilities for the period above {accrual-threshold}, and records accruals for them. "
        "{accrual-reviewer} reviews the analysis and the accruals and signs it off.",
        risk="Liabilities for goods or services received by period end are not recorded.",
        assertions=("COMPLETENESS", "VALUATION_ALLOCATION"),
        frequency="QUARTERLY",
        info=(
            Information(
                "Goods received not invoiced report",
                "SYSTEM_REPORT",
                ("Purchase order", "Receipt date", "Amount"),
            ),
            Information(
                "Invoices received after period end",
                "SYSTEM_REPORT",
                ("Invoice", "Service period", "Amount", "Received on"),
            ),
        ),
        owner_area="accruals",
        owner_example="Controller",
        preparer_example="General ledger accountant",
        reviewer_example="Controller",
        threshold_label="the threshold for recording an accrual",
        threshold_example="10,000",
        evidence="The analysis with the reports' parameters, the accruals recorded, and the "
        "reviewer's sign-off.",
        extra=(
            Slot(
                "accrual-window",
                "the number of days after period end examined",
                "DAYS",
                "Which subsequent invoices are reviewed.",
                "30 days",
            ),
        ),
    ),
)

_add(
    "ptp-payment-run",
    Statement(
        text="Before each payment run is released to the bank, {payment-reviewer} reviews the "
        "proposal from {erp} against {payment-checks}, and two people authorized under "
        "{bank-mandate} approve it in {bank-portal}.",
        risk="Unauthorized, duplicate, or incorrect payments are made.",
        assertions=("EXISTENCE_OCCURRENCE",),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="WEEKLY",
        operator="{payment-reviewer}",
        reviewer="Two approvers authorized under {bank-mandate}",
        owner="{payment-owner}",
        authority="Approvers must be authorized under {bank-mandate}; the reviewer must not have "
        "prepared the run.",
        judgment="MODERATE",
        judgment_note="Spotting an unusual payment in a run is a judgment.",
        precision="Every payment run released in the period, with the checks in {payment-checks}.",
        investigation="A payment questioned in review is removed from the run until resolved.",
        information=(
            Information(
                "Payment proposal", "SYSTEM_REPORT", ("Vendor", "Amount", "Bank account", "Invoice")
            ),
            Information(
                "Bank approval record",
                "SYSTEM_SCREEN",
                ("Run", "Approvers", "Approved on", "Released on"),
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The reviewed proposal and the bank portal's record of both approvals before "
        "release.",
        slots=(
            ERP,
            _role(
                "payment-reviewer",
                "the reviewer of payment proposals",
                "The operator.",
                "AP Manager",
            ),
            Slot(
                "payment-checks",
                "what the reviewer checks",
                "TEXT",
                "The control's precision.",
                "duplicates, new bank details, and payments over 50,000",
                blocks=False,
                placeholder="what the procedure requires the reviewer to check",
            ),
            Slot(
                "bank-mandate",
                "the bank mandate",
                "TEXT",
                "Who may approve payments.",
                "the board-approved bank mandate",
                blocks=False,
            ),
            Slot(
                "bank-portal",
                "the banking portal",
                "SYSTEM",
                "Where approvals are recorded.",
                "the bank's online portal",
                blocks=False,
            ),
            _owner("payment-owner", "payments", "Treasurer"),
        ),  # fmt: skip
    ),
)

# Record to report

_add(
    "rtr-journal-review",
    Statement(
        text="Each manual journal entry above {je-threshold} is approved in {erp} before posting "
        "by {je-approver}, who is not the preparer and whose authority under {je-matrix} covers "
        "the amount. The approver checks the entry against {je-support} for accuracy, account "
        "coding, and period.",
        risk="Erroneous or fraudulent journal entries are posted.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The preparer",
        reviewer="{je-approver}",
        owner="{je-owner}",
        authority="The approver must not be the preparer and must hold authority for the amount.",
        judgment="MODERATE",
        judgment_note="Judging whether support justifies the entry and its coding.",
        precision="Every manual journal entry above {je-threshold} in the period.",
        investigation="An entry posted without approval is reviewed and reversed if unsupported.",
        information=(
            Information(
                "Manual journal entry listing",
                "QUERY",
                ("Entry", "Amount", "Preparer", "Approver", "Posting date"),
                ipe="IPE-02",
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="Each entry with its support and the approval recorded before posting.",
        slots=(
            ERP,
            _threshold(
                "je-threshold",
                "the journal entry review threshold",
                "Which entries need approval.",
                "25,000",
            ),
            Slot(
                "je-support",
                "the support the control requires",
                "TEXT",
                "What the approver checks the entry against.",
                "the invoice, contract, or calculation behind the entry",
                blocks=False,
                placeholder="the documents the control requires",
            ),
            _role(
                "je-approver",
                "the journal entry approver",
                "Must not be the preparer.",
                "Assistant Controller",
            ),
            Slot(
                "je-matrix",
                "the journal entry authority matrix",
                "TEXT",
                "Who may approve which amount.",
                "the JE Approval Matrix",
                blocks=False,
            ),
            _owner("je-owner", "journal entries", "Controller"),
        ),  # fmt: skip
    ),
)

_add(
    "rtr-account-reconciliations",
    _reconciliation(
        "recon",
        what="account",
        ledger="each key balance sheet account in {erp}",
        detail="its supporting detail or subledger",
        risk="Balance sheet accounts include errors or unsupported balances that go undetected.",
        assertions=("EXISTENCE_OCCURRENCE", "COMPLETENESS", "VALUATION_ALLOCATION"),
        owner_area="account reconciliations",
        owner_example="Controller",
        preparer_example="General ledger accountant",
        reviewer_example="Accounting Manager",
        deadline_example="10 business days after month end",
        info=(
            Information("Trial balance", "SYSTEM_REPORT", ("Account", "Balance", "Date")),
            Information(
                "Subledger or supporting detail", "SYSTEM_REPORT", ("Item", "Amount", "Date")
            ),
        ),
    ),
)

_add(
    "rtr-flux-review",
    _analytic_review(
        "flux",
        text="Each quarter, {flux-preparer} compares each financial statement line in {erp} with "
        "the prior period and budget, and explains every change above {flux-threshold} with "
        "corroborating evidence. {flux-reviewer} reviews the explanations and signs off.",
        risk="Misstatements causing unusual changes in results go undetected.",
        assertions=("EXISTENCE_OCCURRENCE", "COMPLETENESS", "VALUATION_ALLOCATION"),
        frequency="QUARTERLY",
        info=(
            Information(
                "Financial statement lines for the period, prior period, and budget",
                "SPREADSHEET",
                ("Line", "Actual", "Prior", "Budget"),
            ),
        ),
        owner_area="financial reporting",
        owner_example="CFO",
        preparer_example="Financial reporting manager",
        reviewer_example="CFO",
        threshold_label="the threshold for explaining a change",
        threshold_example="10% and 100,000",
        evidence="The analysis with explanations and their corroboration, and the reviewer's "
        "sign-off.",
    ),
)

_add(
    "rtr-consolidation",
    _analytic_review(
        "consol",
        text="At each quarter end, {consol-preparer} prepares the consolidation in {consol-tool}, "
        "agrees intercompany balances between entities in {erp} and investigates differences "
        "above "
        "{consol-threshold}, and checks currency translation at the period's rates. "
        "{consol-reviewer} reviews the consolidation, eliminations, and translation and signs off.",
        risk="Intercompany balances are not eliminated, or foreign operations are translated "
        "incorrectly.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
        frequency="QUARTERLY",
        info=(
            Information(
                "Intercompany balance report",
                "SYSTEM_REPORT",
                ("Entity", "Counterparty", "Balance"),
            ),
            Information("Exchange rate table", "SYSTEM_SCREEN", ("Currency", "Rate", "Date")),
        ),
        owner_area="consolidation",
        owner_example="Group Financial Controller",
        preparer_example="Group reporting accountant",
        reviewer_example="Group Financial Controller",
        threshold_label="the threshold for investigating an intercompany difference",
        threshold_example="5,000",
        evidence="The consolidation package with intercompany reconciliations, the rates used, "
        "and the reviewer's sign-off.",
        extra=(
            Slot(
                "consol-tool",
                "the consolidation system",
                "SYSTEM",
                "Where the consolidation is prepared.",
                "OneStream",
                blocks=False,
            ),
        ),
    ),
)

# Treasury

_add(
    "treasury-bank-reconciliation",
    _reconciliation(
        "bank",
        what="bank balance",
        ledger="each bank account's ledger balance in {erp}",
        detail="the bank statement",
        risk="Cash is misstated, or unauthorized payments go undetected.",
        assertions=("EXISTENCE_OCCURRENCE", "COMPLETENESS"),
        owner_area="bank reconciliations",
        owner_example="Treasurer",
        preparer_example="Treasury analyst",
        reviewer_example="Treasurer",
        deadline_example="5 business days after month end",
        info=(
            Information("Bank statement", "DOCUMENT", ("Account", "Closing balance", "Date")),
            Information("Cash ledger", "SYSTEM_REPORT", ("Account", "Balance", "Date")),
        ),
    ),
)

_add(
    "treasury-bank-access",
    Statement(
        text="Each quarter, {signatory-reviewer} reviews the bank signatories and the users of "
        "{bank-portal} against current roles and {bank-mandate}, and has changes made for anyone "
        "who has left or changed role.",
        risk="Someone without authority can approve or release payments.",
        assertions=("EXISTENCE_OCCURRENCE",),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="QUARTERLY",
        operator="{signatory-reviewer}",
        reviewer="None: the review is the control",
        owner="{signatory-owner}",
        authority="The reviewer must not be a portal administrator reviewing their own access.",
        judgment="LOW",
        judgment_note="Comparing users with roles and the mandate is largely mechanical.",
        precision="Every signatory and every portal user at the review date.",
        investigation="A user or signatory not supported is removed through the bank.",
        information=(
            Information(
                "Portal user listing from the bank", "SYSTEM_REPORT", ("User", "Rights", "Date")
            ),
            Information("Bank mandate", "DOCUMENT", ("Signatory", "Limits")),
        ),
        itgcs=(),
        evidence="The reviewed listings with their dates, the sign-off, and the change requests "
        "to the bank.",
        slots=(
            _role("signatory-reviewer", "the reviewer of bank access", "The operator.", "CFO"),
            Slot(
                "bank-portal",
                "the banking portal",
                "SYSTEM",
                "Where users are listed.",
                "the bank's online portal",
                blocks=False,
            ),
            Slot(
                "bank-mandate",
                "the bank mandate",
                "TEXT",
                "Who may approve payments.",
                "the board-approved bank mandate",
                blocks=False,
            ),
            _owner("signatory-owner", "bank access", "Treasurer"),
        ),  # fmt: skip
    ),
)

_add(
    "treasury-debt",
    Statement(
        title="Debt balances agree to lender statements",
        text="Each quarter, {debt-preparer} agrees each debt balance and the accrued interest in "
        "{erp} to the lender's statement, investigates any difference above {debt-threshold}, "
        "and {debt-reviewer} reviews and signs off the agreement.",
        risk="Debt or interest is misstated.",
        assertions=("COMPLETENESS", "VALUATION_ALLOCATION", "RIGHTS_OBLIGATIONS"),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="QUARTERLY",
        operator="{debt-preparer}",
        reviewer="{debt-reviewer}",
        owner="{debt-owner}",
        authority="The reviewer must not have prepared the agreement.",
        judgment="LOW",
        judgment_note="Agreeing balances is mechanical.",
        precision="Every debt facility, agreed exactly or with differences above "
        "{debt-threshold} explained.",
        investigation="A difference is investigated with the lender and corrected.",
        information=(
            Information("Lender statements", "DOCUMENT", ("Facility", "Principal", "Interest")),
            Information("Debt ledger", "SYSTEM_REPORT", ("Facility", "Balance", "Date")),
        ),
        itgcs=(),
        evidence="The signed agreement of balances to lender statements.",
        slots=(
            ERP,
            _role("debt-preparer", "the preparer", "The operator.", "Treasury analyst"),
            _role("debt-reviewer", "the reviewer", "Must not be the preparer.", "Treasurer"),
            _threshold(
                "debt-threshold",
                "the threshold for investigating a difference",
                "The control's precision.",
                "1,000",
            ),
            _owner("debt-owner", "debt", "Treasurer"),
        ),  # fmt: skip
    ),
)

_add(
    "treasury-covenants",
    Statement(
        text="Each quarter, {covenant-preparer} calculates each financial covenant as "
        "{debt-agreements} define it, from the period's financial statements, and "
        "{covenant-reviewer} reviews the calculation and its inputs and signs off. A breach or "
        "a covenant within {covenant-headroom} of breach is reported to {covenant-escalation}.",
        risk="A covenant breach goes unidentified, so debt classification and disclosure are "
        "wrong.",
        assertions=("PRESENTATION_DISCLOSURE", "RIGHTS_OBLIGATIONS"),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="QUARTERLY",
        operator="{covenant-preparer}",
        reviewer="{covenant-reviewer}",
        owner="{debt-owner}",
        authority="The reviewer must understand the agreements' definitions.",
        judgment="MODERATE",
        judgment_note="Applying the agreements' definitions to the financial statements needs "
        "judgment.",
        precision="Every covenant in every debt agreement, each period.",
        investigation="A breach or near breach is escalated, and its effect on classification "
        "and disclosure assessed.",
        information=(
            Information("Debt agreements", "DOCUMENT", ("Covenant", "Definition", "Threshold")),
            Information(
                "Covenant calculation", "SPREADSHEET", ("Covenant", "Inputs", "Result", "Threshold")
            ),
        ),
        itgcs=(),
        evidence="The calculation with its inputs traced to the financial statements, the "
        "reviewer's sign-off, and any escalation.",
        slots=(
            _role("covenant-preparer", "the preparer", "The operator.", "Treasury analyst"),
            _role("covenant-reviewer", "the reviewer", "Must not be the preparer.", "CFO"),
            Slot(
                "debt-agreements",
                "the debt agreements",
                "TEXT",
                "Where covenants are defined.",
                "the revolving credit facility agreement",
                blocks=False,
            ),
            Slot(
                "covenant-headroom",
                "the headroom that triggers escalation",
                "PERCENT",
                "When a near breach is escalated.",
                "10%",
                blocks=False,
            ),
            _role(
                "covenant-escalation",
                "who breaches are reported to",
                "Escalation.",
                "Audit committee",
            ),
            _owner("debt-owner", "debt", "Treasurer"),
        ),  # fmt: skip
    ),
)

# Hire to retire

_add(
    "h2r-payroll-changes",
    _master_data(
        "payroll",
        "payroll master change",
        "new hires, leavers, and pay rate changes",
        "HR and the employee's manager",
        "HR Business Partner",
        "Ghost employees are paid, leavers continue to be paid, or pay rates are changed without "
        "authority.",
        ("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        "payroll master data",
        "Payroll Manager",
        "a signed offer letter, termination notice, or approved pay change form",
    ),
)

_add(
    "h2r-payroll-review",
    _analytic_review(
        "payroll-run",
        text="Before each payroll is paid, {payroll-run-preparer} compares the payroll "
        "register from {erp} with the prior run, explains each employee-level change above "
        "{payroll-run-threshold}, and {payroll-run-reviewer} reviews the comparison and approves "
        "the payroll before payment is released.",
        risk="Erroneous or fraudulent payroll payments are made.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        frequency="MONTHLY",
        info=(
            Information(
                "Payroll register", "SYSTEM_REPORT", ("Employee", "Gross pay", "Net pay", "Run")
            ),
        ),
        owner_area="payroll",
        owner_example="Payroll Manager",
        preparer_example="Payroll specialist",
        reviewer_example="Payroll Manager",
        threshold_label="the threshold for explaining a change in an employee's pay",
        threshold_example="10% or 1,000",
        evidence="The comparison with explanations, and the approval dated before payment.",
    ),
)

_add(
    "h2r-payroll-reconciliation",
    _reconciliation(
        "payroll-recon",
        what="payroll",
        ledger="payroll expense and withholding liabilities in {erp}",
        detail="the payroll system's totals",
        risk="Payroll costs or liabilities are misstated.",
        assertions=("COMPLETENESS", "VALUATION_ALLOCATION"),
        owner_area="payroll accounting",
        owner_example="Controller",
        preparer_example="Payroll accountant",
        reviewer_example="Accounting Manager",
        deadline_example="10 business days after month end",
        info=(
            Information("Payroll system totals", "SYSTEM_REPORT", ("Component", "Amount", "Run")),
            Information("Ledger balances", "SYSTEM_REPORT", ("Account", "Balance")),
        ),
    ),
)

# Inventory

_add(
    "inventory-counts",
    _analytic_review(
        "count",
        text="{count-team} counts inventory under the count instructions ({count-method}), with "
        "counters independent of the custodians. {count-preparer} compares the counts with "
        "{erp}, investigates each difference above {count-threshold}, and {count-reviewer} "
        "approves each adjustment before it is posted.",
        risk="Recorded inventory does not exist, or differences are adjusted without "
        "investigation.",
        assertions=("EXISTENCE_OCCURRENCE", "COMPLETENESS"),
        frequency="MONTHLY",
        info=(
            Information("Count sheets", "DOCUMENT", ("Item", "Location", "Counted quantity")),
            Information("Book quantities", "SYSTEM_REPORT", ("Item", "Location", "Quantity")),
        ),
        owner_area="inventory",
        owner_example="Plant Controller",
        preparer_example="Inventory controller",
        reviewer_example="Plant Controller",
        threshold_label="the threshold for investigating a count difference",
        threshold_example="2,500",
        evidence="Count sheets, the comparison with differences investigated, and the approved "
        "adjustments.",
        extra=(
            _role(
                "count-team",
                "the team that counts",
                "Counters must be independent of the custodians.",
                "Finance and warehouse staff",
            ),
            Slot(
                "count-method",
                "cycle counts or a full count, and how often",
                "TEXT",
                "The population and timing.",
                "monthly cycle counts covering all items each year",
                blocks=False,
            ),
        ),
    ),
)

_add(
    "inventory-valuation",
    _analytic_review(
        "reserve",
        text="Each quarter, {reserve-preparer} calculates the reserve for slow-moving, excess, "
        "and obsolete inventory from {erp}'s aging and usage report under {reserve-policy}, "
        "investigates items above {reserve-threshold} with operations, and {reserve-reviewer} "
        "reviews the calculation and its assumptions and approves the reserve.",
        risk="Inventory is carried above its net realizable value.",
        assertions=("VALUATION_ALLOCATION",),
        frequency="QUARTERLY",
        info=(
            Information(
                "Inventory aging and usage report",
                "SYSTEM_REPORT",
                ("Item", "Quantity", "Value", "Last movement", "Usage"),
            ),
        ),
        owner_area="inventory valuation",
        owner_example="Controller",
        preparer_example="Cost accountant",
        reviewer_example="Controller",
        threshold_label="the threshold for investigating an item",
        threshold_example="10,000",
        evidence="The calculation with the report's parameters, the policy applied, the "
        "investigations, and the approval.",
        extra=(
            Slot(
                "reserve-policy",
                "the inventory reserve policy",
                "TEXT",
                "The criteria applied.",
                "Inventory Reserve Policy",
                blocks=False,
            ),
        ),
    ),
)

_add(
    "inventory-standard-costs",
    _master_data(
        "cost",
        "standard cost change",
        "material, labor, and overhead rates",
        "cost accounting",
        "Cost Accounting Manager",
        "Inventory and cost of sales are valued at unapproved costs.",
        ("VALUATION_ALLOCATION",),
        "standard costs",
        "Controller",
        "the cost roll-up with its inputs and the reason for the change",
    ),
)

# Fixed assets

_add(
    "fa-additions",
    Statement(
        text="Each capital expenditure above {capex-threshold} is approved under {doa} before it "
        "is committed, and {fa-reviewer} reviews each addition against {cap-policy} (asset class, "
        "useful life, and in-service date) before it is recorded in {erp}.",
        risk="Expenses are capitalized, or assets are recorded with the wrong life or class.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="Fixed asset accounting",
        reviewer="{fa-reviewer}",
        owner="{fa-owner}",
        authority="Approvers must hold the authority {doa} sets; the reviewer must know the "
        "capitalization policy.",
        judgment="MODERATE",
        judgment_note="Whether a cost is capital is a judgment under the policy.",
        precision="Every addition above {capex-threshold} in the period.",
        investigation="An addition not meeting the policy is expensed or corrected.",
        information=(
            Information(
                "Fixed asset additions report",
                "SYSTEM_REPORT",
                ("Asset", "Class", "Cost", "Useful life", "In-service date"),
            ),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The approved request, the addition with its support, and the reviewer's "
        "sign-off before recording.",
        slots=(
            ERP,
            _threshold(
                "capex-threshold",
                "the capitalization threshold",
                "Which costs are capitalized.",
                "5,000",
            ),
            Slot(
                "doa",
                "the delegation of authority",
                "TEXT",
                "Who may approve which amount.",
                "the Delegation of Authority policy",
                blocks=False,
            ),
            Slot(
                "cap-policy",
                "the capitalization policy",
                "TEXT",
                "The criteria applied.",
                "Fixed Asset Policy",
                blocks=False,
            ),
            _role(
                "fa-reviewer",
                "the reviewer of additions",
                "The reviewer.",
                "Fixed asset accountant lead",
            ),
            _owner("fa-owner", "fixed assets", "Controller"),
        ),  # fmt: skip
    ),
)

_add(
    "fa-depreciation",
    _analytic_review(
        "depreciation",
        text="Each month, {erp} calculates depreciation from each asset's class, cost, and "
        "useful life. {depreciation-preparer} compares the month's charge with expectation by "
        "asset class, explains differences above {depreciation-threshold}, and "
        "{depreciation-reviewer} reviews and signs off.",
        risk="Depreciation is misstated through wrong lives or calculation errors.",
        assertions=("VALUATION_ALLOCATION",),
        frequency="MONTHLY",
        info=(
            Information(
                "Depreciation run report", "SYSTEM_REPORT", ("Asset class", "Charge", "Period")
            ),
            Information(
                "Useful life configuration by asset class",
                "SYSTEM_SCREEN",
                ("Asset class", "Useful life", "Method"),
            ),
        ),
        owner_area="fixed assets",
        owner_example="Controller",
        preparer_example="Fixed asset accountant",
        reviewer_example="Accounting Manager",
        threshold_label="the threshold for explaining a depreciation difference",
        threshold_example="5% or 10,000",
        evidence="The depreciation run, the expectation and explanations, and the sign-off.",
    ),
)

_add(
    "fa-disposals-impairment",
    Statement(
        title="Disposals are approved and recorded",
        text="Each disposal of a fixed asset is approved by {disposal-approver} before the asset "
        "leaves, and fixed asset accounting records it in {erp} in the period it occurs, with "
        "the proceeds and the gain or loss.",
        risk="Disposed assets remain recorded, or gains and losses are misstated.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="Fixed asset accounting",
        reviewer="{disposal-approver}",
        owner="{fa-owner}",
        authority="The approver must have authority over the asset.",
        judgment="LOW",
        judgment_note="Recording a disposal is mechanical once approved.",
        precision="Every disposal in the period.",
        investigation="A disposal recorded late or without approval is corrected and the cause "
        "addressed.",
        information=(
            Information("Disposal form", "DOCUMENT", ("Asset", "Date", "Proceeds", "Approver")),
            Information("Fixed asset register", "SYSTEM_REPORT", ("Asset", "Status", "Date")),
        ),
        itgcs=SYSTEM_ITGCS,
        evidence="The approved disposal form and the entry recording the disposal.",
        slots=(
            ERP,
            _role(
                "disposal-approver", "the approver of disposals", "The reviewer.", "Plant manager"
            ),
            _owner("fa-owner", "fixed assets", "Controller"),
        ),  # fmt: skip
    ),
)

_add(
    "fa-impairment",
    Statement(
        text="Each year, {impairment-preparer} assesses fixed assets for indicators of impairment "
        "listed in {impairment-policy}, documents the assessment, and tests any asset group with "
        "an indicator. {impairment-reviewer} reviews the assessment and any test and signs off.",
        risk="Impaired assets are carried above their recoverable amount.",
        assertions=("VALUATION_ALLOCATION",),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="ANNUAL",
        operator="{impairment-preparer}",
        reviewer="{impairment-reviewer}",
        owner="{fa-owner}",
        authority="The reviewer must understand the business's plans for its assets.",
        judgment="HIGH",
        judgment_note="Identifying indicators and estimating recoverable amounts are judgments.",
        precision="Every asset group, against each indicator in {impairment-policy}.",
        investigation="An indicator leads to an impairment test and, where needed, an impairment "
        "charge.",
        information=(
            Information(
                "Impairment indicator assessment",
                "SPREADSHEET",
                ("Asset group", "Indicator", "Conclusion"),
            ),
        ),
        itgcs=(),
        evidence="The documented assessment, any impairment test, and the sign-off.",
        slots=(
            _role("impairment-preparer", "the preparer", "The operator.", "Financial reporting"),
            _role("impairment-reviewer", "the reviewer", "Must not be the preparer.", "CFO"),
            Slot(
                "impairment-policy",
                "the impairment policy",
                "TEXT",
                "The indicators considered.",
                "Long-lived Asset Impairment Policy",
                blocks=False,
            ),
            _owner("fa-owner", "fixed assets", "Controller"),
        ),  # fmt: skip
    ),
)

# Tax

_add(
    "tax-provision",
    Statement(
        text="Each quarter, {tax-preparer} prepares the income tax provision, including current "
        "and deferred taxes and uncertain tax positions, and {tax-reviewer} reviews it, "
        "including the rate reconciliation and the deferred tax roll-forward, and signs off. "
        "{tax-advisor} reviews it where the client uses one.",
        risk="Income tax expense, deferred taxes, or uncertain positions are misstated.",
        assertions=("VALUATION_ALLOCATION", "COMPLETENESS", "PRESENTATION_DISCLOSURE"),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="QUARTERLY",
        operator="{tax-preparer}",
        reviewer="{tax-reviewer}",
        owner="{tax-owner}",
        authority="The reviewer must have tax technical competence and must not have prepared "
        "the provision.",
        judgment="HIGH",
        judgment_note="Uncertain positions and valuation allowances are judgments.",
        precision="Every component of the provision, with the rate reconciliation explaining "
        "the effective rate.",
        investigation="Unexplained items in the rate reconciliation are investigated and the "
        "provision corrected.",
        information=(
            Information("Tax provision workpapers", "SPREADSHEET", ("Component", "Amount", "Rate")),
            Information(
                "Pre-tax income by jurisdiction",
                "SYSTEM_REPORT",
                ("Jurisdiction", "Pre-tax income"),
            ),
        ),
        itgcs=(),
        evidence="The provision workpapers, the rate reconciliation, and the reviewer's sign-off.",
        slots=(
            _role("tax-preparer", "the preparer", "The operator.", "Tax manager"),
            _role("tax-reviewer", "the reviewer", "Must not be the preparer.", "Tax director"),
            Slot(
                "tax-advisor",
                "the external tax advisor, if any",
                "TEXT",
                "A second review, where used.",
                "none",
                blocks=False,
            ),
            _owner("tax-owner", "income taxes", "Tax Director"),
        ),  # fmt: skip
    ),
)

_add(
    "tax-indirect",
    _reconciliation(
        "indirect-tax",
        what="indirect tax return",
        ledger="each indirect tax return",
        detail="the indirect tax accounts in {erp} before filing",
        risk="Indirect tax is misstated or misfiled.",
        assertions=("COMPLETENESS", "VALUATION_ALLOCATION"),
        owner_area="indirect tax",
        owner_example="Tax Manager",
        preparer_example="Tax accountant",
        reviewer_example="Tax Manager",
        deadline_example="before the filing deadline",
        info=(
            Information("Indirect tax return", "DOCUMENT", ("Box", "Amount", "Period")),
            Information("Indirect tax ledger accounts", "SYSTEM_REPORT", ("Account", "Balance")),
        ),
        itgcs=(),
    ),
)
