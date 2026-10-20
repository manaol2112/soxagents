"""Each client value as the question the team puts to the client (milestone L3d).

A value's label names it as the statement uses it ("the access management policy"); the
question asks for it as an auditor would ("Which policy sets who may approve access?").
The plan review and the control record ask the question; the label stays for the
statement's wording and the audit trail.
"""

from ai_workforce_api.control_statements import Slot

# The subject each control's preparer and reviewer work on, by the prefix of its keys.
_SUBJECTS: dict[str, str] = {
    "accrual": "the period-end accruals",
    "bank": "the bank reconciliations",
    "cash": "the cash application",
    "consol": "the consolidation",
    "count": "the inventory counts",
    "covenant": "the covenant compliance calculations",
    "cutoff": "the revenue cutoff review",
    "debt": "the debt reconciliation",
    "depreciation": "the depreciation review",
    "flux": "the account fluctuation (flux) analysis",
    "impairment": "the impairment assessment",
    "indirect-tax": "the indirect tax reconciliation",
    "payroll-recon": "the payroll reconciliation",
    "payroll-run": "the payroll review before payment",
    "recon": "the balance sheet account reconciliations",
    "reserve": "the inventory reserve calculation",
    "tax": "the income tax provision",
}

QUESTIONS: dict[str, str] = {
    # Logical access
    "access-owner": "Who is accountable for the user access controls?",
    "access-policy": "Which policy sets who may approve access, and to what?",
    "access-tool": "Where are access requests raised and approved?",
    "account-reviewer": "Who reviews shared, generic, and service accounts?",
    "admin-role": "Who grants, changes, and removes user access in the system?",
    "auth-settings": "What password and sign-in settings does the policy require?",
    "data-admin": "Who is allowed to change data directly in the database?",
    "deploy-reviewer": "Who reviews who can deploy changes to production?",
    "facilities-reviewer": "Who reviews access to the data center or server room?",
    "feed-frequency": "How often does IT receive the list of leavers from HR?",
    "ff-approver": "Who approves a request for emergency (firefighter) access?",
    "ff-review-days": "Within how many days must an emergency access log be reviewed?",
    "ff-reviewer": "Who reviews what was done with emergency access?",
    "ff-tool": "Which tool grants and logs emergency (firefighter) access?",
    "hr-system": "Which system does HR record leavers in?",
    "infra-admin-role": "Who is allowed direct access to the database and operating system?",
    "infra-reviewer": "Who reviews access to the database and operating system?",
    "privileged-definition": "Which roles or accounts does the client treat as privileged?",
    "privileged-reviewer": "Who approves privileged access?",
    "removal-days": "Within how many days of leaving must access be removed?",
    "review-deadline": "By when must each periodic access review be completed?",
    "review-owner": "Who performs the periodic review of user access?",
    "security-policy": "Which policy sets the client's information security requirements?",
    "sod-reviewer": "Who reviews segregation-of-duties conflicts and approves rule changes?",
    "sod-ruleset": "Which segregation-of-duties ruleset is used?",
    "sod-tool": "Which tool checks access for segregation-of-duties conflicts?",
    "sponsor-reviewer": "Who reviews the accounts of contractors and third parties?",
    "transfer-days": "Within how many days of a transfer must access no longer needed be removed?",
    "alert-criteria": "Which security alerts does the daily review cover?",
    "siem-tool": "Which tool monitors and raises security alerts?",
    "soc-role": "Who reviews the security alerts?",
    # Change management
    "change-owner": "Who is accountable for the change management controls?",
    "change-tool": "Where are system changes requested, approved, and tracked?",
    "config-approver": "Who approves changes to the system's configuration?",
    "config-scope": "Which configuration settings affect financial processing?",
    "emergency-approver": "Who approves emergency changes?",
    "emergency-criteria": "What makes a change an emergency change?",
    "emergency-days": "Within how many days must an emergency change be approved after the fact?",
    "go-live-approver": "Who approves a new system or major release going live?",
    "it-approver": "Who in IT approves a change before it goes to production?",
    "migration-approver": "Who signs off the reconciliation of migrated data?",
    "patch-approver": "Who approves patches before they are applied?",
    # IT operations
    "backup-fix-days": "Within what time must a failed backup be resolved?",
    "backup-frequency": "How often do backups run?",
    "backup-tool": "Which tool runs the backups?",
    "incident-procedure": "Which procedure governs how IT incidents are handled?",
    "incident-tool": "Where are IT incidents logged and tracked?",
    "interface-owner": "Who resolves interface errors when totals do not agree?",
    "interface-tool": "Which tool runs the financially relevant interfaces?",
    "interfaces": "Which interfaces feed financial data into or out of the system?",
    "major-priority": "Which incident priority counts as a major incident?",
    "ops-owner": "Who is accountable for the IT operations controls?",
    "ops-role": "Who monitors scheduled jobs and acts on failures?",
    "restore-reviewer": "Who reviews the results of restore tests?",
    "retention": "How long are backups kept?",
    "risk-acceptor": "Who approves accepting the risk of a vulnerability left unfixed?",
    "scan-tool": "Which tool scans for vulnerabilities?",
    "schedule-approver": "Who approves changes to the job schedule?",
    "scheduler": "Which tool schedules and runs the batch jobs?",
    "service-orgs": "Which service organizations does the client rely on?",
    "soc-reviewer": "Who reviews the service organizations' SOC reports?",
    "vuln-owner": "Who reviews vulnerability scan findings?",
    "vuln-sla": "Within how many days must critical and high vulnerabilities be fixed?",
    # Systems
    "erp": "Which financial system does this control operate in?",
    "source-system": "Which system sends the data through the interface?",
    "system": "Which system is in scope for this control?",
    "euc-location": "Where are the key spreadsheets kept?",
    "euc-inventory": "Where is the list of key spreadsheets maintained?",
    "euc-owner": "Who owns each key spreadsheet?",
    # Purchasing and payables
    "ap-owner": "Who is accountable for the accounts payable controls?",
    "ap-preparer": "Who validates the accounts payable aging report?",
    "ap-sample": "How many invoices are recalculated each period?",
    "bank-mandate": "Which document sets who may approve payments and in what amounts?",
    "bank-portal": "Which banking portal are payments released through?",
    "doa": "Which delegation of authority sets who may approve purchases?",
    "doa-matrix": "Which approval limits apply to purchase orders?",
    "dup-criteria": "Which fields does the duplicate invoice check match on?",
    "dup-reviewer": "Who reviews invoices blocked as possible duplicates?",
    "match-tolerance": "What price and quantity tolerance does the three-way match allow?",
    "nonpo-matrix": "Who may approve invoices without a purchase order, and up to what amount?",
    "payment-checks": "What does the reviewer check before approving a payment run?",
    "payment-owner": "Who is accountable for the payment controls?",
    "payment-reviewer": "Who reviews and approves each payment proposal?",
    "po-owner": "Who is accountable for the purchasing controls?",
    "ptp-owner": "Who is accountable for the procure-to-pay controls?",
    "release-role": "Who may release an invoice blocked for payment?",
    "vendor-approver": "Who approves changes to vendor master data?",
    "vendor-maintainer": "Who makes changes to vendor master data?",
    "vendor-owner": "Who is accountable for the vendor master data controls?",
    "vendor-support": "What support must a vendor change have before it is made?",
    # Order to cash
    "approval-matrix": "Who may approve a credit memo, and up to what amount?",
    "ar-owner": "Who is accountable for the accounts receivable controls?",
    "ar-preparer": "Who prepares the aged receivables report?",
    "bill-sample": "How many invoices are traced to shipments each period?",
    "billing-run": "Which job or process creates the invoices?",
    "credit-owner": "Who is accountable for the credit controls?",
    "credit-release-role": "Who may release an order held for exceeding a credit limit?",
    "customer-approver": "Who approves changes to customer master data?",
    "customer-maintainer": "Who makes changes to customer master data?",
    "customer-owner": "Who is accountable for the customer master data controls?",
    "customer-support": "What support must a new customer or credit change have?",
    "cutoff-window": "How many days either side of period end are reviewed for cutoff?",
    "discount-limit": "What discount or price override is allowed without approval?",
    "memo-owner": "Who is accountable for the credit memo controls?",
    "pricing-approver": "Who approves price overrides?",
    "rev-preparer": "Who validates the billing report?",
    "revenue-owner": "Who is accountable for the revenue controls?",
    "cutoff-owner": "Who is accountable for the revenue cutoff controls?",
    # Record to report
    "gl-owner": "Who is accountable for the general ledger controls?",
    "je-approver": "Who approves manual journal entries?",
    "je-matrix": "Which document sets who may approve journal entries, and up to what amount?",
    "je-owner": "Who is accountable for the journal entry controls?",
    "je-preparer": "Who prepares the journal entry listing?",
    "je-support": "What support must a manual journal entry have?",
    "reopen-role": "Who may reopen a closed accounting period?",
    "validation-rules": "Which posting validation rules are in scope?",
    "consol-tool": "Which system is the consolidation performed in?",
    "accrual-window": (
        "How many days after period end are invoices reviewed for unrecorded liabilities?"
    ),
    "bank-deadline": "By when must the bank reconciliations be completed?",
    "recon-deadline": "By when must the account reconciliations be completed?",
    "cash-age": "After how many days must an unapplied cash item be investigated?",
    # Payroll
    "pay-preparer": "Who validates the payroll register?",
    "pay-rules": "Which pay rules and statutory tax tables are in scope?",
    "pay-sample": "How many employees are agreed to their records each payroll?",
    "payroll-approver": "Who approves changes to employee pay and master data?",
    "payroll-maintainer": "Who makes changes to employee pay and master data?",
    "payroll-owner": "Who is accountable for the payroll master data controls?",
    "payroll-recon-deadline": "By when must the payroll reconciliation be completed?",
    "payroll-recon-owner": "Who is accountable for the payroll accounting controls?",
    "payroll-run-owner": "Who is accountable for the payroll controls?",
    "payroll-support": "What support must a pay change have before it is made?",
    # Fixed assets and inventory
    "cap-policy": "Which policy sets what is capitalized as a fixed asset?",
    "cost-approver": "Who approves changes to standard costs?",
    "cost-maintainer": "Who updates standard costs in the system?",
    "cost-owner": "Who is accountable for the standard cost controls?",
    "cost-support": "What support must a standard cost change have?",
    "count-method": "Are inventory counts full counts or cycle counts, and how often?",
    "count-owner": "Who is accountable for the inventory count controls?",
    "count-team": "Who performs the inventory counts?",
    "depreciation-keys": "Which asset classes and depreciation methods are in scope?",
    "depreciation-owner": "Who is accountable for the depreciation controls?",
    "disposal-approver": "Who approves asset disposals?",
    "fa-classes": "Which asset classes are agreed to the ledger each period?",
    "fa-owner": "Who is accountable for the fixed asset controls?",
    "fa-preparer": "Who validates the fixed asset register?",
    "fa-reviewer": "Who reviews and approves fixed asset additions?",
    "impairment-policy": "Which policy sets how assets are assessed for impairment?",
    "inv-owner": "Who is accountable for the inventory accounting controls?",
    "inv-preparer": "Who validates the inventory valuation report?",
    "inv-sample": "How many inventory items are recalculated each period?",
    "reserve-owner": "Who is accountable for the inventory valuation controls?",
    "reserve-policy": "Which policy sets how the inventory reserve is calculated?",
    # Treasury and tax
    "debt-agreements": "Which debt agreements contain the covenants?",
    "signatory-owner": "Who is accountable for the bank access controls?",
    "signatory-reviewer": "Who reviews who has access to the bank accounts?",
    "covenant-escalation": "Who are covenant breaches reported to?",
    "indirect-tax-deadline": "By when must the indirect tax reconciliation be completed?",
    "indirect-tax-owner": "Who is accountable for the indirect tax controls?",
    "tax-advisor": "Does an external advisor help prepare the tax provision, and who?",
    "tax-owner": "Who is accountable for the income tax controls?",
    "bank-owner": "Who is accountable for the bank reconciliation controls?",
    "cash-owner": "Who is accountable for the cash application controls?",
    "consol-owner": "Who is accountable for the consolidation controls?",
    "debt-owner": "Who is accountable for the debt controls?",
    "flux-owner": "Who is accountable for the financial reporting review controls?",
    "recon-owner": "Who is accountable for the account reconciliation controls?",
    "accrual-owner": "Who is accountable for the accrual controls?",
    # Entity level
    "ack-deadline": "By when must employees acknowledge the code of conduct each year?",
    "ack-tool": "Where do employees acknowledge the code of conduct?",
    "conduct-oversight": "Who is the code of conduct completion rate reported to?",
    "conduct-owner": "Who owns the code of conduct?",
    "hotline": "How do employees report concerns (the whistleblower channel)?",
    "investigator": "Who investigates whistleblower reports?",
    "wb-oversight": "Who reviews the summary of whistleblower reports?",
    # Reports
    "aging-report": "Which report or transaction produces the aged receivables listing?",
    # Preparers and reviewers whose work does not read as "prepares the ...".
    "cash-preparer": "Who applies customer receipts to open invoices?",
    "cash-reviewer": "Who reviews the cash application and unapplied items?",
    "count-preparer": "Who reconciles the count results to the ledger?",
    "count-reviewer": "Who reviews the count results and differences?",
    "cutoff-preparer": "Who performs the revenue cutoff review?",
    "cutoff-reviewer": "Who reviews and approves the revenue cutoff results?",
    "depreciation-preparer": "Who runs and checks the depreciation each period?",
    "depreciation-reviewer": "Who reviews the depreciation each period?",
    "payroll-run-preparer": "Who checks the payroll before it is paid?",
    "payroll-run-reviewer": "Who reviews and approves the payroll before it is paid?",
}

# Thresholds, by key: above what amount the reviewer acts.
_THRESHOLDS: dict[str, str] = {
    "accrual-threshold": "Above what amount is an accrual recorded?",
    "bank-threshold": "Above what amount are reconciling items on the bank reconciliations "
    "investigated?",
    "capex-threshold": "Above what amount is a purchase capitalized?",
    "cash-threshold": "Above what amount is an unapplied cash item investigated?",
    "consol-threshold": "Above what amount is an intercompany difference investigated?",
    "count-threshold": "Above what amount is an inventory count difference investigated?",
    "covenant-headroom": "At what headroom to a covenant limit is it escalated?",
    "cutoff-threshold": "Above what amount is a cutoff difference adjusted?",
    "debt-threshold": "Above what amount is a difference to the lender statement investigated?",
    "depreciation-threshold": "Above what difference must depreciation be explained?",
    "flux-threshold": "Above what change must an account fluctuation be explained?",
    "indirect-tax-threshold": "Above what amount are reconciling items on the indirect tax "
    "reconciliation investigated?",
    "je-approval-threshold": "Above what amount must a journal entry be approved?",
    "je-threshold": "Above what amount are journal entries reviewed?",
    "memo-threshold": "Above what amount must a credit memo be approved?",
    "payroll-recon-threshold": "Above what amount are reconciling items on the payroll "
    "reconciliation investigated?",
    "payroll-run-threshold": "Above what change in an employee's pay must it be explained?",
    "recon-threshold": "Above what amount are reconciling items on account reconciliations "
    "investigated?",
    "reserve-threshold": "Above what amount is an inventory item reviewed for a reserve?",
}


def question_for(slot: Slot) -> str:
    """The question that asks for a value: written for it, or for its control's preparer
    and reviewer, else made from its label."""
    if slot.key in QUESTIONS:
        return QUESTIONS[slot.key]
    if slot.key in _THRESHOLDS:
        return _THRESHOLDS[slot.key]
    for role, verb in (("-preparer", "prepares"), ("-reviewer", "reviews")):
        if slot.key.endswith(role):
            subject = _SUBJECTS.get(slot.key[: -len(role)])
            if subject is not None:
                return f"Who {verb} {subject}?"
    label = slot.label.removeprefix("the ")
    return f"What is {label}?" if slot.kind != "ROLE" else f"Who is {slot.label}?"


# Policies, procedures, and matrices: answered with the document's own name.
_DOCUMENTS = (
    "policy",
    "procedure",
    "matrix",
    "doa",
    "mandate",
    "agreements",
    "ruleset",
)


def hint_for(slot: Slot) -> str:
    """How to answer a value, for whoever fills it in: what form the answer takes and
    where it is usually found."""
    if slot.kind == "ROLE":
        return (
            "Use a role or team, not a person's name. It is usually named in the RCM, the "
            "process narrative, or the walkthrough."
        )
    if slot.kind == "SYSTEM":
        return "Use the product name the client uses, as in its system inventory."
    if slot.kind in ("DAYS", "PERIOD"):
        return (
            "As the client's policy or procedure states it. If no document sets it, record "
            "what the control owner says and note that it is not documented."
        )
    if slot.kind in ("AMOUNT", "PERCENT"):
        return "As the client's procedure sets it, in the reporting currency where it is an amount."
    if slot.kind == "REPORT":
        return "The report name or transaction code as it is run in the system."
    if any(word in slot.key or word in slot.label for word in _DOCUMENTS):
        return "The document's title and version, as the client names it."
    return "As the client's documentation or the control owner describes it."
