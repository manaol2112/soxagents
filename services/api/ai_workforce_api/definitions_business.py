"""Testing definitions for the business process controls of the standard library (library
version 3). See testing_definitions.py and definitions_itgc.py for the conventions.

Management review controls are tested on what the reviewer actually did: the threshold or
criteria applied (precision), the items meeting them, and their investigation and
resolution (KPMG ICFR Handbook Q5.10-5.11). Where the library does not hold the threshold,
the precision attribute is LOW confidence and carries the question.
"""

from ai_workforce_api.definitions_itgc import _a, _design, _p, _roll_sampled
from ai_workforce_api.testing_definitions import AttributeDef, Definition, Retired, sampling


def _reviewer(key: str, what: str, was: str = "") -> AttributeDef:
    """The review was signed by the person the control designates, who is not the preparer."""
    return _a(
        key,
        f"The {what} was signed off, with a date, by the reviewer the control designates, "
        "who is not its preparer",
        condition="A dated sign-off by the designated reviewer, different from the preparer.",
        why="The control assigns the review; a review by the preparer is not a review.",
        evidence=(
            "Sign-off",
            "Who prepared it",
            "Designated reviewer or delegation of authority",
        ),  # fmt: skip
        extract=("Preparer", "Reviewer", "Date"),
        compare="Reviewer against the designated reviewer and against the preparer.",
        passes="Signed by the designated reviewer, not the preparer.",
        fails="No sign-off, or signed by the preparer or someone not designated.",
        insufficient="No sign-off provided, or no record of who is designated.",
        review="The designated reviewer is not documented.",
        not_infer="A sign-off is evidence of review, not of what the reviewer checked.",
        basis=("DESIGN", "AS2201.44"),
        confidence="HIGH",
        was=was,
    )


def _precision(key: str, what: str, question: str, was: str = "") -> AttributeDef:
    """Every item meeting the control's criteria was identified (the review's precision).
    Blocks testing until the criteria are known."""
    return _a(
        key,
        f"Every {what} meeting [the threshold or criteria for investigation the control "
        "sets] was identified by the reviewer",
        condition="Items meeting the criteria in the underlying data all appear in the "
        "reviewer's investigation.",
        why="A review is only as precise as its criteria; without them it cannot be shown to "
        "detect a misstatement (KPMG Q5.10).",
        evidence=("The control's criteria", "Underlying data", "Reviewer's analysis"),
        extract=("Criteria", "Items meeting them", "Items the reviewer flagged"),
        compare="Items meeting the criteria against items the reviewer flagged (re-perform).",
        passes="Every qualifying item was flagged.",
        fails="A qualifying item was not flagged.",
        insufficient="The underlying data or the analysis is not provided.",
        review="The criteria are not defined.",
        not_infer="Do not set a threshold; do not judge one adequate.",
        basis=("DESIGN", "KPMG-5.10", "AS1105.15"),
        confidence="LOW",
        question=question,
        # A review control without its criteria cannot be tested for precision, the point
        # of the control: testing waits for the answer (AS 2201.42; KPMG Q5.10).
        blocks=True,
        was=was,
    )


def _resolved(key: str, what: str, was: str = "") -> AttributeDef:
    return _a(
        key,
        f"Each {what} the reviewer flagged was investigated, with an explanation supported "
        "by evidence and, where needed, a correction recorded",
        condition="Each flagged item has a supported explanation or a correction.",
        why="Identification without investigation and resolution does not detect or correct "
        "a misstatement (KPMG Q5.11).",
        evidence=("Explanations", "Supporting documents", "Adjusting entries"),
        extract=("Item", "Explanation", "Support", "Correction"),
        compare="Each explanation against its support.",
        passes="Every flagged item is explained with support or corrected.",
        fails="An item unexplained, explained without support, or uncorrected.",
        insufficient="Explanations or support not provided.",
        review="Whether an explanation is adequate is judgment.",
        not_infer="An explanation is not corroborated because it is plausible.",
        basis=("DESIGN", "KPMG-5.10"),
        confidence="HIGH",
        was=was,
    )


def _approval_before(key: str, what: str, approver: str, was: str = "") -> AttributeDef:
    return _a(
        key,
        f"The {what} was approved by {approver} before it was processed in the system",
        condition="An approval by the required approver, dated before processing.",
        why="The control is preventive: approval must come first.",
        evidence=("Approval", "System record of the change or posting"),
        extract=("Approver", "Approval date", "Processing date"),
        compare="Approver against the required approver; approval date against processing.",
        passes="Approved by the required approver before processing.",
        fails="Missing, after processing, or by someone else.",
        insufficient="Approval or processing date not provided.",
        review="Who may approve is not documented.",
        not_infer="Do not assume authority from a title.",
        basis=("DESIGN", "AS2201.44"),
        confidence="HIGH",
        was=was,
    )


def _matches(key: str, what: str, was: str = "") -> AttributeDef:
    return _a(
        key,
        f"The {what} in the system agrees to what was approved",
        condition="Values in the system equal the approved values.",
        why="Approval covers only what was approved.",
        evidence=("Approval", "System record"),
        extract=("Approved values", "System values"),
        compare="System values against approved values.",
        passes="They agree.",
        fails="They differ.",
        insufficient="System record not provided.",
        review="Values are described differently.",
        not_infer="Do not infer system values from the approval.",
        basis=("DESIGN",),
        confidence="HIGH",
        was=was,
    )


def _support(key: str, what: str, question: str, was: str = "") -> AttributeDef:
    return _a(
        key,
        f"The {what} is supported by [the documents the control requires]",
        condition="The required supporting documents exist and agree to the change.",
        why="The description requires support; what support is not stated.",
        evidence=("Supporting documents",),
        extract=("Documents", "Values"),
        compare="Support against the change.",
        passes="Required support agrees.",
        fails="Support missing or disagrees.",
        insufficient="Not provided.",
        review="What support is required is not defined.",
        not_infer="Do not decide what support suffices.",
        basis=("DESIGN",),
        confidence="LOW",
        question=question,
        was=was,
    )


def _agrees(key: str, text: str, what: str, was: str = "") -> AttributeDef:
    return _a(
        key,
        text,
        condition=f"{what} agree, or differences are reconciled.",
        why="Agreement to an independent balance is what the control does.",
        evidence=("The reconciliation or analysis", "The ledger or external balance"),
        extract=("Balances", "Dates"),
        compare="The balances, at the same date.",
        passes="They agree, or differences are reconciled.",
        fails="Unreconciled difference.",
        insufficient="A balance is missing.",
        review="Reconciling items need judgment.",
        not_infer="A balance typed onto the reconciliation is not the ledger.",
        basis=("DESIGN", "AS1105.15"),
        confidence="HIGH",
        was=was,
    )


def _change_control(
    key: str,
    ref: str,
    objective: str,
    what: str,
    approver: str,
    population: str,
    support_q: str,
    prefix: str,
    v2: tuple[str, str, str],
) -> Definition:
    """A master data or standing data change approved before it is made."""
    return Definition(
        library_key=key,
        control_ref=ref,
        objective=objective,
        control_type="PREVENTIVE",
        performer="The person who enters the change",
        reviewer=approver,
        trigger=f"A {what}",
        population=population,
        sampling=sampling("EVENT_DRIVEN"),
        procedures=(
            _design(
                f"a {what}",
                f"the procedure for {what}s and their approval",
                ("Procedure", f"One {what}"),
            ),  # fmt: skip
            _p(
                "o-1",
                "OPERATING",
                f"Determine whether each selected {what} was supported, approved before it "
                "was made, and entered as approved.",
                "For each selected change, inspect support and approval and compare them with "
                "the system's change record.",
                ("Change record", "Support", "Approval"),
                (f"{prefix}-support", f"{prefix}-approved", f"{prefix}-matches"),
            ),
            _roll_sampled(f"{what}s", (f"{prefix}-approved", f"{prefix}-matches")),
        ),
        attributes=(
            _support(f"{prefix}-support", what, support_q, v2[0]),
            _approval_before(f"{prefix}-approved", what, approver, v2[1]),
            _matches(f"{prefix}-matches", what, v2[2]),
        ),
    )


CUSTOMER_MASTER = _change_control(
    "otc-customer-master",
    "OTC-01",
    "Only approved, supported customers, limits, terms, and bank details are recorded.",
    "customer master change",
    "credit management",
    "Every customer master change in the period from the system change log.",
    "What support does the client require for new customers and for changes to limits, "
    "terms, and bank details?",
    "otc01",
    (
        "The change was requested with support",
        "An authorized person approved it before it was made",
        "The change in the system matches what was approved",
    ),
)

REVENUE_CUTOFF = Definition(
    library_key="otc-revenue-cutoff",
    control_ref="OTC-02",
    objective="Revenue around period end is recorded in the period in which delivery occurs.",
    control_type="DETECTIVE",
    performer="The preparer of the cutoff analysis",
    reviewer="The designated reviewer",
    trigger="Each period end",
    population="The quarter-end cutoff analyses in the period.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a cutoff analysis",
            "the window around period end and the review",
            ("Cutoff procedure", "One analysis"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the analysis covered the window, differences were adjusted, "
            "and it was reviewed.",
            "Re-perform the comparison for selected shipments and invoices in the window; "
            "inspect adjustments and the sign-off.",
            ("Cutoff analysis", "Shipping documents", "Invoices", "Adjustments"),
            ("otc02-window", "otc02-adjusted", "otc02-reviewer"),
        ),
        _roll_sampled("cutoff analyses", ("otc02-window", "otc02-adjusted", "otc02-reviewer")),
    ),
    attributes=(
        _precision(
            "otc02-window",
            "shipment and invoice",
            "How many days before and after period end does the cutoff analysis cover, and "
            "from which source are shipments listed?",
            "Shipments near period end were compared to invoices",
        ),
        _resolved(
            "otc02-adjusted",
            "difference between shipment and invoice period",
            "Differences were investigated and adjusted",
        ),
        _reviewer(
            "otc02-reviewer",
            "cutoff analysis",
            "The review was performed and signed off by an appropriate person",
        ),  # fmt: skip
    ),
)

CASH_APPLICATION = Definition(
    library_key="otc-cash-application",
    control_ref="OTC-03",
    objective="Unapplied cash and receipt differences are resolved each week.",
    control_type="DETECTIVE",
    performer="Accounts receivable",
    reviewer="The designated reviewer",
    trigger="Each week",
    population="The weekly unapplied cash reviews in the period.",
    sampling=sampling("WEEKLY"),
    procedures=(
        _design(
            "a weekly review",
            "the unapplied cash report, its threshold, and the review",
            ("Report definition", "Review procedure"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the report used was complete, aged items were investigated, "
            "and the review is evidenced.",
            "Agree the report's total to unapplied cash in the ledger; re-perform the "
            "selection of items over the threshold; inspect follow-up and sign-off.",
            ("Unapplied cash report", "Ledger balance", "Follow-up", "Sign-off"),
            ("otc03-report", "otc03-aged", "otc03-resolved", "otc03-reviewer"),
        ),
        _roll_sampled(
            "weekly reviews", ("otc03-report", "otc03-aged", "otc03-resolved", "otc03-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "otc03-report",
            "The unapplied cash report the reviewer used agrees to the unapplied cash balance "
            "in the ledger at the same date",
            condition="Report total equals the ledger's unapplied cash.",
            why="The review relies on system information; an incomplete report hides items "
            "(KPMG ch. 6).",
            evidence=("Report", "Ledger balance"),
            extract=("Totals", "Date"),
            compare="Report total against ledger.",
            passes="Agree.",
            fails="Unreconciled difference.",
            insufficient="Not provided.",
            review="Timing differences.",
            not_infer="A report's existence is not its completeness.",
            basis=("KPMG-6", "AS1105.10"),
            confidence="MODERATE",
            assumptions=(
                "The report's completeness may instead be addressed by a separate "
                "control; confirm.",
            ),  # fmt: skip
        ),
        _precision(
            "otc03-aged",
            "unapplied item",
            "What age threshold makes an unapplied item one the reviewer must investigate?",
            "Items older than the threshold were investigated",
        ),
        _resolved("otc03-resolved", "unapplied item"),
        _reviewer("otc03-reviewer", "weekly review", "The review was evidenced by the reviewer"),
    ),
    retired=(
        Retired(
            "The unapplied cash report was reviewed",
            "Replaced by what the review must show: the report's reliability, the items "
            "identified, and their resolution.",
            "otc03-aged",
        ),
    ),
)

CREDIT_MEMOS = Definition(
    library_key="otc-credit-memos",
    control_ref="OTC-04",
    objective="Credit memos above the threshold are approved at the required level before "
    "they are issued.",
    control_type="PREVENTIVE",
    performer="Billing",
    reviewer="Management at the required level",
    trigger="A credit memo above the threshold",
    population="Credit memos above the threshold in the period.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a credit memo", "the approval matrix and threshold", ("Approval matrix",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected credit memo had a reason and was approved at the "
            "required level, for the amount issued.",
            "Inspect reason, approval, approver level per the matrix, and amounts.",
            ("Credit memo", "Approval", "Approval matrix"),
            ("otc04-reason", "otc04-before", "otc04-level", "otc04-amount"),
        ),
        _roll_sampled("credit memos", ("otc04-reason", "otc04-before", "otc04-amount")),
    ),
    attributes=(
        _a(
            "otc04-reason",
            "The credit memo records a reason",
            condition="A reason is documented.",
            why="An approver cannot judge a credit without its reason.",
            evidence=("Credit memo or request",),
            extract=("Reason",),
            compare="Memo for a reason.",
            passes="A reason is recorded.",
            fails="No reason.",
            insufficient="Not provided.",
            review="Reason is a code without meaning.",
            not_infer="Do not judge the reason's validity.",
            basis=("INFERENCE",),
            confidence="MODERATE",
            was="The credit memo has a documented reason",
        ),
        _a(
            "otc04-before",
            "The credit memo was approved before it was issued",
            condition="Every selected credit memo in the control's population.",
            why="The control description requires approval before issue; an approval after "
            "issue does not prevent an unauthorized credit.",
            evidence=("Approval record", "Credit memo with its issue date"),
            extract=("Approver", "Approval date", "Issue date"),
            compare="Approval date against the issue date.",
            passes="An approval exists and is dated on or before the issue date.",
            fails="No approval, or the approval is dated after the issue date.",
            insufficient="The approval or either date is not provided.",
            review="The approval is undated, or the dates conflict between records.",
            not_infer="Do not treat a memo being issued as evidence it was approved.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
            was="It was approved at the required level before it was issued",
        ),
        _a(
            "otc04-level",
            "The approver held the level the approval matrix requires for the credit memo amount",
            condition="Every selected credit memo, once the matrix is known.",
            why="The description requires approval at the appropriate level; the levels are "
            "set by the client's matrix, which the library does not know.",
            evidence=("Approval", "Approval matrix in force at the approval date"),
            extract=("Amount", "Approver", "Approver's level"),
            compare="Approver's level against the matrix level for the amount.",
            passes="The approver's level meets the matrix for the amount.",
            fails="The approver's level is below the matrix level for the amount.",
            insufficient="No matrix, or no evidence of the approver's level.",
            review="The matrix or the credit memo threshold is not provided.",
            not_infer="Do not assume a level from a job title.",
            basis=("DESIGN", "AS2201.44"),
            confidence="LOW",
            question="What threshold brings a credit memo into this control, and what approval "
            "matrix applies?",
            blocks=True,
        ),
        _matches(
            "otc04-amount", "credit memo amount", "The amount agrees to the approval"
        ),  # fmt: skip
    ),
)

VENDOR_MASTER = Definition(
    library_key="ptp-vendor-master",
    control_ref="PTP-01",
    objective="Only approved vendors and bank details are recorded, and bank changes are "
    "confirmed with the vendor.",
    control_type="PREVENTIVE",
    performer="Vendor master data",
    reviewer="Someone independent of purchasing and payments",
    trigger="A new vendor or a vendor bank change",
    population="Vendor master changes in the period from the system change log.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a vendor change", "the vendor procedure, approvers, and call-back", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected change was supported, independently approved "
            "before it was made, and, for bank details, confirmed by call-back.",
            "Inspect support and approval; compare the approver's role with purchasing and "
            "payments; inspect the call-back record and the number used.",
            ("Change record", "Support", "Approval", "Call-back record"),
            ("ptp01-support", "ptp01-approved", "ptp01-callback"),
        ),
        _roll_sampled("vendor changes", ("ptp01-approved", "ptp01-callback")),
    ),
    attributes=(
        _support(
            "ptp01-support",
            "vendor change",
            "What support does the client require for new vendors and bank changes?",
            "The change was requested with support",
        ),  # fmt: skip
        _a(
            "ptp01-approved",
            "The change was approved, before it was made, by someone who works in neither "
            "purchasing nor payments",
            condition="Approver's role is outside purchasing and payments; approval first.",
            why="The description requires independent approval.",
            evidence=("Approval", "Approver's role", "Change record"),
            extract=("Approver", "Role", "Dates"),
            compare="Approver's role; approval date against change date.",
            passes="Independent and before.",
            fails="Not independent, or after.",
            insufficient="Approver's role not provided.",
            review="Role boundaries unclear.",
            not_infer="Do not infer independence from a title.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="An independent person approved it before it was made",
        ),
        _a(
            "ptp01-callback",
            "A bank detail change was confirmed with the vendor by calling a contact number "
            "already on file, not one given in the change request",
            condition="A call-back record with a number from existing vendor records.",
            why="The description requires call-back on known contact details.",
            evidence=("Call-back record", "Vendor contact on file"),
            extract=("Number called", "Person", "Date"),
            compare="Number called against the number on file before the request.",
            passes="Confirmed using a known number.",
            fails="No call-back, or a number from the request.",
            insufficient="No call-back record.",
            review="The record does not show the number used.",
            not_infer="An email reply is not a call-back.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Bank detail changes were confirmed with the vendor using known contact details",
        ),
    ),
)

PURCHASE_APPROVAL = Definition(
    library_key="ptp-purchase-approval",
    control_ref="PTP-02",
    objective="Purchase orders are approved within the delegation of authority before they "
    "are sent.",
    control_type="PREVENTIVE",
    performer="The system workflow and approvers",
    reviewer="Approvers per the delegation of authority",
    trigger="A purchase order",
    population="Purchase orders in the period from the system.",
    sampling=sampling("EVENT_DRIVEN"),
    design_confirmation=(
        "Approval 'in the system' suggests a configured workflow. If the workflow enforces "
        "the delegation of authority, test it as an application control (configuration and "
        "one instance) rather than a sample."
    ),
    procedures=(
        _design(
            "a purchase order",
            "the workflow and delegation of authority",
            ("Workflow configuration", "Delegation of authority"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected order was approved within authority before it "
            "was issued.",
            "Inspect the approval history against the delegation of authority and the issue date.",
            ("Approval history", "Delegation of authority"),
            ("ptp02-before", "ptp02-authority"),
        ),
        _roll_sampled("purchase orders", ("ptp02-before", "ptp02-authority")),
    ),
    attributes=(
        _a(
            "ptp02-before",
            "The purchase order was approved before it was issued to the vendor",
            condition="Approval date before issue date.",
            why="The description requires approval before sending.",
            evidence=("Approval history", "Issue record"),
            extract=("Dates",),
            compare="Approval against issue.",
            passes="Before.",
            fails="After or missing.",
            insufficient="Dates missing.",
            review="Issue date not recorded.",
            not_infer="Do not use creation date as issue date.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The purchase order was approved before it was issued",
        ),
        _a(
            "ptp02-authority",
            "The approver's limit in the delegation of authority covers the order's amount",
            condition="Approver's limit is at least the order amount.",
            why="The description requires approval within authority.",
            evidence=("Delegation of authority", "Approval"),
            extract=("Amount", "Approver", "Limit"),
            compare="Amount against limit.",
            passes="Within limit.",
            fails="Over limit.",
            insufficient="No delegation of authority.",
            review="Order split to stay under limits.",
            not_infer="Do not assume limits.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
            was="The approver had authority for the amount",
        ),
    ),
)

ACCRUALS = Definition(
    library_key="ptp-accruals",
    control_ref="PTP-03",
    objective="Liabilities for goods and services received by period end are recorded.",
    control_type="DETECTIVE",
    performer="The preparer of the accrual analysis",
    reviewer="The designated reviewer",
    trigger="Each period end",
    population="Quarter-end accrual analyses.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "an accrual review", "its sources, search period, and threshold", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether qualifying items were identified and accrued, and the review "
            "was signed off.",
            "Re-perform the identification from received-not-invoiced balances and subsequent "
            "invoices over the threshold; inspect accrual entries and sign-off.",
            ("Analysis", "Subsequent disbursements", "Journal entries"),
            ("ptp03-identified", "ptp03-accrued", "ptp03-reviewer"),
        ),
        _roll_sampled(
            "accrual reviews", ("ptp03-identified", "ptp03-accrued", "ptp03-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _precision(
            "ptp03-identified",
            "received-not-invoiced balance and subsequent invoice",
            "Which sources, search period after period end, and amount threshold does the "
            "accrual review use?",
            "Received-not-invoiced balances and subsequent invoices were reviewed",
        ),
        _resolved(
            "ptp03-accrued",
            "item belonging to the period",
            "Accruals were recorded for items that belong to the period",
        ),  # fmt: skip
        _reviewer(
            "ptp03-reviewer", "accrual analysis", "The review was approved by an appropriate person"
        ),  # fmt: skip
    ),
)

PAYMENT_RUN = Definition(
    library_key="ptp-payment-run",
    control_ref="PTP-04",
    objective="Only reviewed payment runs approved by two authorized people are released.",
    control_type="PREVENTIVE",
    performer="Treasury or accounts payable",
    reviewer="Two authorized approvers",
    trigger="Each payment run",
    population="Payment runs in the period.",
    sampling=sampling("WEEKLY"),
    procedures=(
        _design(
            "a payment run",
            "the approval procedure and the bank mandate",
            ("Procedure", "Bank mandate"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected run was reviewed and approved by two authorized "
            "people before release, for the amount released.",
            "Inspect the proposal review, the two approvals against the mandate, and the bank "
            "release amount.",
            ("Proposal", "Approvals", "Bank release record", "Mandate"),
            ("ptp04-reviewed", "ptp04-two", "ptp04-amount"),
        ),
        _roll_sampled("payment runs", ("ptp04-reviewed", "ptp04-two", "ptp04-amount")),
    ),
    attributes=(
        _a(
            "ptp04-reviewed",
            "The payment proposal shows evidence of review against [what the procedure "
            "requires the reviewer to check]",
            condition="Review evidence covering the procedure's checks.",
            why="The description requires review; what is checked is not stated.",
            evidence=("Reviewed proposal",),
            extract=("Checks evidenced",),
            compare="Evidence against required checks.",
            passes="Reviewed as required.",
            fails="No review.",
            insufficient="Not provided.",
            review="Required checks not defined.",
            not_infer="A signature is not evidence of the checks.",
            basis=("DESIGN",),
            confidence="LOW",
            question="What must the payment run reviewer check (duplicates, vendor bank "
            "changes, amounts against invoices)?",
            was="The payment proposal was reviewed",
        ),
        _a(
            "ptp04-two",
            "Two people authorized under the bank mandate approved the run before it was "
            "released to the bank",
            condition="Two distinct authorized approvers, before release.",
            why="The description requires two authorized approvers.",
            evidence=("Approvals", "Bank mandate", "Release time"),
            extract=("Approvers", "Times"),
            compare="Approvers against the mandate; times against release.",
            passes="Two authorized, before release.",
            fails="Fewer, unauthorized, or after.",
            insufficient="Mandate or approvals missing.",
            review="Approvals inside the bank portal not visible.",
            not_infer="Two clicks by the same person are one approval.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Two authorized people approved it before release",
        ),
        _matches(
            "ptp04-amount",
            "amount released to the bank",
            "The released amount agrees to the approved proposal",
        ),  # fmt: skip
    ),
)

JOURNAL_REVIEW = Definition(
    library_key="rtr-journal-review",
    control_ref="RTR-01",
    objective="Manual journal entries above the threshold are reviewed and approved by "
    "someone other than the preparer, against support.",
    control_type="PREVENTIVE",
    performer="The preparer",
    reviewer="An approver other than the preparer, within authority",
    trigger="A manual entry above the threshold",
    population="Manual journal entries above the threshold, from the journal listing (IPE-02).",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a manual entry",
            "the threshold, support required, and approver authority",
            ("Procedure", "Authority matrix"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected entry has support and was approved by an "
            "authorized person other than the preparer.",
            "Inspect support, compare preparer and approver user IDs, and the approver's "
            "authority for the amount.",
            ("Entry", "Support", "Approval"),
            ("rtr01-support", "rtr01-not-preparer", "rtr01-authority"),
        ),
        _roll_sampled(
            "manual journal entries", ("rtr01-support", "rtr01-not-preparer", "rtr01-authority")
        ),  # fmt: skip
    ),
    attributes=(
        _support(
            "rtr01-support",
            "journal entry",
            "What support must accompany a manual journal entry, and what threshold "
            "brings an entry into this control?",
            "The entry has support",
        ),  # fmt: skip
        _a(
            "rtr01-not-preparer",
            "The approver is a different user from the preparer",
            condition="Approver ID differs from preparer ID.",
            why="The description requires someone other than the preparer.",
            evidence=("Entry with preparer and approver",),
            extract=("Preparer ID", "Approver ID"),
            compare="IDs.",
            passes="Different.",
            fails="Same.",
            insufficient="IDs not shown.",
            review="Shared accounts.",
            not_infer="Different names on paper do not prove different users in the system.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Someone other than the preparer approved it",
        ),
        _a(
            "rtr01-authority",
            "The approver's authority in the authority matrix covers the entry's amount",
            condition="Approver's limit is at least the amount.",
            why="The description requires an authorized approver.",
            evidence=("Authority matrix",),
            extract=("Amount", "Limit"),
            compare="Amount against limit.",
            passes="Within.",
            fails="Over.",
            insufficient="No matrix.",
            review="Matrix not provided.",
            not_infer="Do not assume limits.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
            was="The approver was authorized for the amount",
        ),
    ),
)

ACCOUNT_RECS = Definition(
    library_key="rtr-account-reconciliations",
    control_ref="RTR-02",
    objective="Key balance sheet accounts agree to supporting detail each month, and "
    "reconciling items are resolved.",
    control_type="DETECTIVE",
    performer="The preparer",
    reviewer="A reviewer other than the preparer",
    trigger="Each month end",
    population="Key account reconciliations per month.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design(
            "a reconciliation",
            "the reconciliation policy: deadlines and item clearing",
            ("Policy",),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected reconciliation agrees, its items are resolved, "
            "and it was prepared and reviewed on time by different people.",
            "Agree balances; inspect reconciling items' support and age; compare dates with "
            "the deadline and preparer with reviewer.",
            ("Reconciliation", "Ledger", "Support"),
            ("rtr02-agrees", "rtr02-items", "rtr02-reviewer", "rtr02-timely"),
        ),
        _roll_sampled("reconciliations", ("rtr02-agrees", "rtr02-items", "rtr02-reviewer")),
    ),
    attributes=(
        _agrees(
            "rtr02-agrees",
            "The reconciliation's ledger balance agrees to the general ledger, and its "
            "supporting balance to the supporting detail, at the month end",
            "Ledger and supporting balances",
            "The reconciliation agrees to the ledger",
        ),  # fmt: skip
        _resolved(
            "rtr02-items", "reconciling item", "Reconciling items are explained and cleared timely"
        ),  # fmt: skip
        _reviewer(
            "rtr02-reviewer",
            "reconciliation",
            "It was prepared and reviewed on time by different people",
        ),  # fmt: skip
        _a(
            "rtr02-timely",
            "The reconciliation was prepared and reviewed by [the deadline in the "
            "reconciliation policy]",
            condition="Dates within the deadline.",
            why="Late reconciliations detect late.",
            evidence=("Policy", "Dates"),
            extract=("Dates", "Deadline"),
            compare="Dates against deadline.",
            passes="Within.",
            fails="Late.",
            insufficient="Dates missing.",
            review="Deadline not defined.",
            not_infer="Do not assume a deadline.",
            basis=("DESIGN",),
            confidence="LOW",
            question="What deadline after month end does the reconciliation policy set for "
            "preparation and review?",
        ),
    ),
)

FLUX_REVIEW = Definition(
    library_key="rtr-flux-review",
    control_ref="RTR-03",
    objective="Unusual changes in results are identified and explained with corroboration.",
    control_type="DETECTIVE",
    performer="Finance",
    reviewer="The designated reviewer",
    trigger="Each quarter",
    population="Quarterly flux analyses.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design("a flux review", "the comparison basis and threshold", ("Procedure",)),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether every change over the threshold was identified and explained "
            "with corroboration, and the analysis was reviewed.",
            "Re-perform the comparison to prior period and budget; compare changes over the "
            "threshold with those explained; inspect corroboration and sign-off.",
            ("Flux analysis", "Trial balances", "Budget", "Corroboration"),
            ("rtr03-identified", "rtr03-explained", "rtr03-reviewer"),
        ),
        _roll_sampled(
            "flux analyses", ("rtr03-identified", "rtr03-explained", "rtr03-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _precision(
            "rtr03-identified",
            "change against prior period or budget",
            "What threshold (amount and percentage) makes a change one the flux "
            "review must explain?",
            "Changes above the threshold were identified",
        ),  # fmt: skip
        _resolved(
            "rtr03-explained",
            "change over the threshold",
            "Each was explained with corroborated reasons",
        ),  # fmt: skip
        _reviewer(
            "rtr03-reviewer", "flux analysis", "The analysis was reviewed by an appropriate person"
        ),  # fmt: skip
    ),
)

CONSOLIDATION = Definition(
    library_key="rtr-consolidation",
    control_ref="RTR-04",
    objective="Intercompany balances eliminate and the consolidation, including translation, "
    "is correct.",
    control_type="DETECTIVE",
    performer="Group reporting",
    reviewer="The designated reviewer",
    trigger="Each period end",
    population="Quarterly consolidations.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a consolidation", "what the reviewer checks and tolerances", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether intercompany balances agree, eliminations and translation are "
            "correct, and the consolidation was reviewed.",
            "Agree intercompany pairs; recalculate selected eliminations and translations; "
            "inspect the sign-off.",
            ("Consolidation package", "Intercompany reconciliation", "Rates"),
            ("rtr04-intercompany", "rtr04-recalculated", "rtr04-reviewer"),
        ),
        _roll_sampled("consolidations", ("rtr04-intercompany", "rtr04-reviewer")),
    ),
    attributes=(
        _agrees(
            "rtr04-intercompany",
            "Intercompany balances agree between the entities, or differences are "
            "resolved before elimination",
            "Intercompany pairs",
            "Intercompany balances agree between entities or differences are resolved",
        ),  # fmt: skip
        _a(
            "rtr04-recalculated",
            "Selected eliminations and currency translations recalculate correctly",
            condition="Recalculation equals the recorded amounts.",
            why="Recording them correctly is the control's purpose.",
            evidence=("Package", "Rates"),
            extract=("Amounts", "Rates"),
            compare="Recalculated against recorded.",
            passes="Equal.",
            fails="Different.",
            insufficient="Rates or package missing.",
            review="Complex translation (hyperinflation, step acquisitions).",
            not_infer="Do not judge accounting policy.",
            basis=("DESIGN", "AS1105.15"),
            confidence="MODERATE",
            assumptions=(
                "Recalculation tests the outcome; the review's precision should be "
                "confirmed separately.",
            ),  # fmt: skip
            was="Eliminations and translation were recorded correctly",
        ),
        _reviewer(
            "rtr04-reviewer", "consolidation", "The consolidation was reviewed and approved"
        ),  # fmt: skip
    ),
    questions=("What does the consolidation reviewer check, and at what tolerance?",),
)

BANK_RECS = Definition(
    library_key="treasury-bank-reconciliation",
    control_ref="TRS-01",
    objective="Cash agrees to the bank each month and reconciling items are resolved.",
    control_type="DETECTIVE",
    performer="Treasury or accounting",
    reviewer="A reviewer other than the preparer",
    trigger="Each month end",
    population="Bank account reconciliations per month.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design(
            "a bank reconciliation", "the reconciliation procedure", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected reconciliation agrees to the statement and "
            "ledger, items are resolved, and it was independently reviewed.",
            "Agree the statement balance and ledger balance; inspect items; compare preparer "
            "and reviewer.",
            ("Reconciliation", "Bank statement", "Ledger"),
            ("trs01-agrees", "trs01-items", "trs01-reviewer"),
        ),
        _roll_sampled(
            "bank reconciliations", ("trs01-agrees", "trs01-items", "trs01-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _agrees(
            "trs01-agrees",
            "The reconciliation agrees to the bank statement balance and to the general "
            "ledger balance at the month end",
            "Statement, ledger, and reconciliation balances",
            "The reconciliation agrees to the bank statement and the ledger",
        ),  # fmt: skip
        _resolved(
            "trs01-items", "reconciling item", "Reconciling items are explained and cleared timely"
        ),  # fmt: skip
        _reviewer(
            "trs01-reviewer",
            "bank reconciliation",
            "It was reviewed by someone other than the preparer",
        ),  # fmt: skip
    ),
)

BANK_ACCESS = Definition(
    library_key="treasury-bank-access",
    control_ref="TRS-02",
    objective="Only authorized people can move company funds.",
    control_type="DETECTIVE",
    performer="Treasury",
    reviewer="The reviewer of signatories and portal users",
    trigger="Each quarter",
    population="Quarterly reviews.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a quarterly review", "the board mandate and the review procedure", ("Board mandate",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether every signatory and portal user is authorized and leavers and "
            "movers were removed.",
            "Compare bank signatories and portal users with the mandate; compare the HR "
            "leaver and mover list with removals.",
            ("Bank mandate", "Portal user list", "HR changes", "Review"),
            ("trs02-authorized", "trs02-movers"),
        ),
        _roll_sampled("quarterly reviews", ("trs02-authorized", "trs02-movers")),
    ),
    attributes=(
        _a(
            "trs02-authorized",
            "Every bank signatory and banking portal user at the review date is authorized "
            "by the board-approved mandate",
            condition="Each signatory and user is in the mandate.",
            why="The description reviews against the mandate.",
            evidence=("Bank signatory list", "Portal user list", "Mandate"),
            extract=("People", "Rights"),
            compare="People against the mandate.",
            passes="All authorized.",
            fails="Someone not in the mandate.",
            insufficient="Lists from the bank not provided.",
            review="Portal rights differ from mandate wording.",
            not_infer="An internal list is not the bank's list.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Every signatory and portal user is authorized",
        ),
        _a(
            "trs02-movers",
            "People who left or changed roles were removed from signatories and the portal",
            condition="Each leaver or mover on the HR list is no longer a signatory or user.",
            why="The description requires changes for people who moved or left.",
            evidence=("HR leaver and mover list", "Bank lists"),
            extract=("People", "Status"),
            compare="HR list against bank lists.",
            passes="All removed.",
            fails="One still has access.",
            insufficient="HR list not provided.",
            review="Removal pending with the bank.",
            not_infer="Do not assume an HR list is complete.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
            was="Changes were made for people who moved or left",
        ),
    ),
)

DEBT = Definition(
    library_key="treasury-debt",
    control_ref="TRS-03",
    objective="Debt and accrued interest are recorded at the balances the lenders report.",
    control_type="DETECTIVE",
    performer="Treasury",
    reviewer="The designated reviewer",
    trigger="Each quarter",
    population="The quarterly agreements of debt balances to lender statements in the period.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a quarter's agreement of debt balances",
            "the debt schedule and how it is agreed to lender statements",
            ("Debt schedule", "Lender statements"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected quarter's debt balances agree to the lenders and "
            "the agreement was reviewed.",
            "Agree each facility's balance and accrued interest to the lender's statement; "
            "inspect the sign-off.",
            ("Lender statements", "Debt schedule", "Sign-off"),
            ("trs03-balances", "trs03-reviewer"),
        ),
        _roll_sampled("quarters", ("trs03-balances", "trs03-reviewer")),
    ),
    attributes=(
        _agrees(
            "trs03-balances",
            "Debt balances in the schedule agree to lender statements or confirmations at "
            "the quarter end",
            "Schedule and lender balances",
            "Debt balances agree to lender confirmations or statements",
        ),  # fmt: skip
        _reviewer("trs03-reviewer", "agreement of debt balances to lender statements"),
    ),
    retired=(
        Retired(
            "Covenant calculations are accurate and reviewed",
            "Moved to TRS-03.1, the quarterly covenant calculation: agreeing balances and "
            "calculating covenants are two controls (milestone 8.9).",
            "trs031-covenants",
        ),
    ),
)

COVENANTS = Definition(
    library_key="treasury-covenants",
    control_ref="TRS-03.1",
    objective="Covenant compliance is calculated as the debt agreements define it, reviewed, "
    "and breaches or near breaches are escalated.",
    control_type="DETECTIVE",
    performer="Treasury",
    reviewer="The designated reviewer",
    trigger="Each quarter",
    population="The quarterly covenant calculations in the period.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a quarter's covenant calculation",
            "the covenant definitions in the debt agreements",
            ("Debt agreements", "One calculation"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected calculation recalculates from the agreement's "
            "definitions and was reviewed.",
            "Recalculate each covenant from the agreement's definitions and the period's "
            "financial statements; inspect the sign-off and any escalation.",
            ("Covenant calculation", "Debt agreements", "Financial statements", "Sign-off"),
            ("trs031-covenants", "trs031-reviewer"),
        ),
        _roll_sampled("quarters", ("trs031-covenants", "trs031-reviewer")),
    ),
    attributes=(
        _a(
            "trs031-covenants",
            "Covenant calculations recalculate correctly using the debt agreement's "
            "definitions and the period's financial statements",
            condition="Recalculation equals the reported result.",
            why="An incorrect calculation can hide a breach.",
            evidence=("Calculation", "Agreement definitions", "Financial statements"),
            extract=("Inputs", "Definitions", "Result"),
            compare="Recalculated against reported.",
            passes="Equal.",
            fails="Different.",
            insufficient="The agreement or the inputs are not provided.",
            review="The agreement's definitions are ambiguous.",
            not_infer="Do not interpret the agreement's terms.",
            basis=("DESIGN", "AS1105.15"),
            confidence="HIGH",
        ),
        _reviewer("trs031-reviewer", "covenant calculation"),
    ),
)

PAYROLL_CHANGES = _change_control(
    "h2r-payroll-changes",
    "HTR-01",
    "Only approved hires, leavers, and pay changes are processed in payroll.",
    "payroll master change",
    "HR and the employee's manager",
    "Payroll master changes in the period from the payroll system.",
    "What documents must support a hire, a leaver, and a pay rate change?",
    "htr01",
    (
        "The change has HR and manager approval",
        "Approval happened before the change was processed",
        "The change in payroll matches what was approved",
    ),
)

PAYROLL_REVIEW = Definition(
    library_key="h2r-payroll-review",
    control_ref="HTR-02",
    objective="Each payroll is reviewed for unusual changes and approved before payment.",
    control_type="PREVENTIVE",
    performer="Payroll",
    reviewer="The payroll approver",
    trigger="Each payroll run",
    population="Payroll runs in the period.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design(
            "a payroll review", "the variance threshold and approval", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the register used was complete, changes over the threshold "
            "were explained, and the payroll was approved before payment.",
            "Agree the register to the payroll system totals; re-perform the comparison with "
            "the prior run; inspect explanations and approval date against payment date.",
            ("Registers", "Variance analysis", "Approval", "Payment record"),
            ("htr02-register", "htr02-identified", "htr02-explained", "htr02-approved"),
        ),
        _roll_sampled(
            "payroll runs",
            ("htr02-register", "htr02-identified", "htr02-explained", "htr02-approved"),
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "htr02-register",
            "The payroll register used for the review agrees to the payroll system's totals "
            "for the run",
            condition="Register totals equal the system's run totals.",
            why="The review relies on system information (KPMG ch. 6).",
            evidence=("Register", "System run totals"),
            extract=("Gross", "Net", "Headcount"),
            compare="Register against system.",
            passes="Agree.",
            fails="Differ.",
            insufficient="Not provided.",
            review="Timing differences.",
            not_infer="A register's existence is not completeness.",
            basis=("KPMG-6", "AS1105.10"),
            confidence="MODERATE",
        ),
        _precision(
            "htr02-identified",
            "employee-level change against the prior run",
            "What threshold makes a change against the prior payroll one the reviewer "
            "must explain?",
            "The register was compared with the prior run",
        ),  # fmt: skip
        _resolved(
            "htr02-explained",
            "change over the threshold",
            "Changes above the threshold were explained",
        ),  # fmt: skip
        _a(
            "htr02-approved",
            "The payroll was approved by the payroll approver before payment was released",
            condition="Approval before payment.",
            why="The description requires approval before payment.",
            evidence=("Approval", "Payment record"),
            extract=("Approver", "Dates"),
            compare="Approval against payment.",
            passes="Before.",
            fails="After or missing.",
            insufficient="Dates missing.",
            review="Approver authority undefined.",
            not_infer="Do not assume the approver.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The payroll was approved before payment",
        ),
    ),
)

PAYROLL_REC = Definition(
    library_key="h2r-payroll-reconciliation",
    control_ref="HTR-03",
    objective="Payroll expense and withholding liabilities agree to the ledger each month.",
    control_type="DETECTIVE",
    performer="Payroll accounting",
    reviewer="A reviewer other than the preparer",
    trigger="Each month end",
    population="Monthly payroll reconciliations.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design(
            "a payroll reconciliation", "the reconciliation procedure", ("Procedure",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the reconciliation agrees, differences were resolved, and it "
            "was independently reviewed.",
            "Agree register and ledger; inspect differences; compare preparer and reviewer.",
            ("Reconciliation", "Register", "Ledger"),
            ("htr03-agrees", "htr03-items", "htr03-reviewer"),
        ),
        _roll_sampled(
            "payroll reconciliations", ("htr03-agrees", "htr03-items", "htr03-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _agrees(
            "htr03-agrees",
            "The reconciliation agrees to the payroll register and to the general ledger "
            "for the month",
            "Register, ledger, and reconciliation totals",
            "The reconciliation agrees to the payroll register and the ledger",
        ),  # fmt: skip
        _resolved("htr03-items", "difference", "Differences were investigated and resolved"),
        _reviewer(
            "htr03-reviewer",
            "payroll reconciliation",
            "It was reviewed by someone other than the preparer",
        ),  # fmt: skip
    ),
)

COUNTS = Definition(
    library_key="inventory-counts",
    control_ref="INV-01",
    objective="Recorded inventory exists, and count differences are resolved and approved "
    "before adjustment.",
    control_type="DETECTIVE",
    performer="Warehouse and inventory control",
    reviewer="The approver of adjustments",
    trigger="Each count",
    population="Counts in the period.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design(
            "a count",
            "the count instructions, threshold, and adjustment approval",
            ("Count instructions",),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether differences over the threshold were investigated and "
            "adjustments approved before posting.",
            "Re-perform the identification of differences over the threshold; inspect "
            "investigations and the approval date against the posting date.",
            ("Count results", "Investigations", "Adjustment approvals"),
            ("inv01-identified", "inv01-investigated", "inv01-approved"),
        ),
        _p(
            "o-2",
            "OPERATING",
            "Determine whether counts followed the instructions.",
            "Observe a count (AS 1105.16: evidence is limited to the time observed), or "
            "inspect count sheets for the steps the instructions require.",
            ("Observation notes", "Count sheets"),
            ("inv01-instructions",),
        ),
        _roll_sampled("counts", ("inv01-identified", "inv01-investigated", "inv01-approved")),
    ),
    attributes=(
        _a(
            "inv01-instructions",
            "The count followed the count instructions (blind counts, segregated counters, "
            "cutoff), as observed or as evidenced on the count sheets",
            condition="The steps the instructions require are evidenced.",
            why="Uncontrolled counts make differences unreliable.",
            evidence=("Instructions", "Observation", "Count sheets"),
            extract=("Steps required", "Steps evidenced"),
            compare="Evidence against instructions.",
            passes="Steps evidenced.",
            fails="A required step not followed.",
            insufficient="No observation and sheets do not show the steps.",
            review="Always for an observation the agent did not make.",
            not_infer="Count sheets do not prove the count was blind.",
            basis=("DESIGN", "AS1105.15"),
            confidence="MODERATE",
            was="Counts followed the count instructions",
        ),
        _precision(
            "inv01-identified",
            "count difference",
            "What quantity or value threshold makes a count difference one that must "
            "be investigated?",
        ),  # fmt: skip
        _resolved(
            "inv01-investigated",
            "count difference over the threshold",
            "Differences above the threshold were investigated",
        ),  # fmt: skip
        _approval_before(
            "inv01-approved",
            "inventory adjustment",
            "the designated approver",
            "Adjustments were approved before they were posted",
        ),  # fmt: skip
    ),
)

INVENTORY_RESERVE = Definition(
    library_key="inventory-valuation",
    control_ref="INV-02",
    objective="Slow-moving and obsolete inventory is reserved under the approved policy.",
    control_type="DETECTIVE",
    performer="Inventory accounting",
    reviewer="The designated reviewer",
    trigger="Each quarter",
    population="Quarterly reserve calculations.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a reserve calculation", "the reserve policy and aging report", ("Reserve policy",)
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the aging report was complete and accurate, the reserve "
            "follows policy, and it was reviewed.",
            "Agree the aging report to the inventory ledger and recalculate aging for "
            "selected items; recalculate the reserve under the policy; inspect sign-off.",
            ("Aging report", "Ledger", "Reserve calculation", "Policy"),
            ("inv02-report", "inv02-policy", "inv02-reviewer"),
        ),
        _roll_sampled(
            "reserve calculations", ("inv02-report", "inv02-policy", "inv02-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "inv02-report",
            "The aging report used agrees to the inventory ledger, and aging recalculates "
            "for selected items",
            condition="Totals agree; selected items' aging recalculates.",
            why="The reserve relies on the report (KPMG ch. 6).",
            evidence=("Aging report", "Ledger", "Receipt dates"),
            extract=("Totals", "Item dates", "Buckets"),
            compare="Totals; recalculated aging against report.",
            passes="Agree.",
            fails="Differ.",
            insufficient="Not provided.",
            review="Aging basis undocumented.",
            not_infer="Do not assume the aging basis.",
            basis=("DESIGN", "AS1105.10", "KPMG-6"),
            confidence="HIGH",
            was="The aging report used was complete and accurate",
        ),
        _a(
            "inv02-policy",
            "The reserve recalculates under the approved reserve policy",
            condition="Recalculated reserve equals recorded.",
            why="The description requires a reserve under the policy.",
            evidence=("Policy", "Calculation"),
            extract=("Rates", "Balances"),
            compare="Recalculated against recorded.",
            passes="Equal.",
            fails="Different.",
            insufficient="Policy not provided.",
            review="Management overrides of the policy need judgment.",
            not_infer="Do not judge whether the policy is adequate.",
            basis=("DESIGN", "AS1105.15"),
            confidence="HIGH",
            was="The reserve follows the approved policy",
        ),
        _reviewer(
            "inv02-reviewer", "reserve calculation", "The reserve was reviewed and approved"
        ),  # fmt: skip
    ),
)

STANDARD_COSTS = _change_control(
    "inventory-standard-costs",
    "INV-03",
    "Only approved standard costs are recorded.",
    "standard cost change",
    "cost accounting",
    "Standard cost changes in the period from the system change log.",
    "What support must a standard cost change have (cost build-up, quotes)?",
    "inv03",
    (
        "The change has support",
        "It was approved before it was updated",
        "The cost in the system matches what was approved",
    ),
)

ADDITIONS = Definition(
    library_key="fa-additions",
    control_ref="FA-01",
    objective="Capital additions are authorized and recorded under the capitalization policy.",
    control_type="PREVENTIVE",
    performer="Fixed asset accounting",
    reviewer="Approvers per the delegation of authority",
    trigger="A capital expenditure",
    population="Fixed asset additions in the period.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "an addition",
            "the capitalization policy and authority",
            ("Policy", "Delegation of authority"),
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected addition was approved within authority, meets "
            "the policy, and is recorded at the right amount and in-service date.",
            "Inspect approval against authority; compare the item with the policy criteria; "
            "agree amount to invoice and in-service date to evidence.",
            ("Approval", "Invoice", "In-service evidence", "Policy"),
            ("fa01-authority", "fa01-policy", "fa01-recorded"),
        ),
        _roll_sampled("additions", ("fa01-authority", "fa01-policy", "fa01-recorded")),
    ),
    attributes=(
        _a(
            "fa01-authority",
            "The expenditure was approved by an approver whose authority covers its amount",
            condition="Approver's limit covers the amount.",
            why="The description requires approval under the delegation of authority.",
            evidence=("Approval", "Delegation of authority"),
            extract=("Amount", "Approver", "Limit"),
            compare="Amount against limit.",
            passes="Within.",
            fails="Over or missing.",
            insufficient="No delegation of authority.",
            review="Project approvals spanning items.",
            not_infer="Do not assume limits.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
            was="The expenditure was approved within authority",
        ),
        _a(
            "fa01-policy",
            "The item meets the capitalization policy's criteria (threshold, useful life, "
            "nature of cost)",
            condition="Each criterion in the policy is met.",
            why="The description reviews additions against the policy.",
            evidence=("Policy", "Invoice"),
            extract=("Amount", "Nature", "Life"),
            compare="Item against criteria.",
            passes="Meets the criteria.",
            fails="Does not.",
            insufficient="Policy not provided.",
            review="Nature of cost needs judgment (repair or improvement).",
            not_infer="Do not decide capital or expense where the policy is silent.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="It meets the capitalization policy",
        ),
        _a(
            "fa01-recorded",
            "The asset is recorded at the invoiced cost and with the in-service date shown by "
            "evidence",
            condition="Recorded cost equals invoice; in-service date matches evidence.",
            why="Amount and date drive depreciation.",
            evidence=("Register", "Invoice", "In-service evidence"),
            extract=("Cost", "Dates"),
            compare="Recorded against evidence.",
            passes="Agree.",
            fails="Differ.",
            insufficient="In-service evidence missing.",
            review="Capitalized internal costs.",
            not_infer="Do not use the invoice date as in-service.",
            basis=("DESIGN",),
            confidence="MODERATE",
            was="The asset was recorded at the right amount and in-service date",
        ),
    ),
)

DEPRECIATION = Definition(
    library_key="fa-depreciation",
    control_ref="FA-02",
    objective="Depreciation is calculated from approved useful lives and reviewed monthly.",
    control_type="DETECTIVE",
    performer="The system calculates; accounting reviews",
    reviewer="The designated reviewer",
    trigger="Each month end",
    population="Monthly depreciation reviews.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _p(
            "d-1",
            "DESIGN",
            "Determine whether configured useful lives equal the approved policy.",
            "Compare the system's useful life by asset class with the policy (a configuration "
            "check, AS 2201.B30).",
            ("Asset class configuration", "Policy"),
            ("fa02-lives",),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the monthly charge was reviewed and variances explained.",
            "Re-perform the expectation and identify variances over the threshold; inspect "
            "explanations and sign-off.",
            ("Depreciation run", "Register", "Review"),
            ("fa02-identified", "fa02-explained", "fa02-reviewer"),
        ),
        _roll_sampled(
            "monthly reviews", ("fa02-identified", "fa02-explained", "fa02-reviewer")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "fa02-lives",
            "Useful lives configured by asset class equal the approved depreciation policy",
            condition="Configured life equals policy life for each class.",
            why="The system calculates from them.",
            evidence=("Configuration", "Policy"),
            extract=("Class", "Life"),
            compare="Configured against policy.",
            passes="Equal.",
            fails="Different.",
            insufficient="Not provided.",
            review="Asset-level overrides.",
            not_infer="Do not assume default lives.",
            basis=("DESIGN", "AS2201.B28"),
            confidence="HIGH",
            was="Useful lives match the approved policy",
        ),
        _precision(
            "fa02-identified",
            "variance in the monthly charge",
            "What threshold makes a variance in the monthly depreciation charge one "
            "the reviewer must explain?",
        ),  # fmt: skip
        _resolved(
            "fa02-explained",
            "variance",
            "The monthly charge was reviewed and differences were explained",
        ),  # fmt: skip
        _reviewer("fa02-reviewer", "depreciation review"),
    ),
)

DISPOSALS = Definition(
    library_key="fa-disposals-impairment",
    control_ref="FA-03",
    objective="Disposed assets are approved and removed from the register in the period they "
    "leave.",
    control_type="PREVENTIVE",
    performer="Fixed asset accounting",
    reviewer="The approver of disposals",
    trigger="A disposal",
    population="Disposals in the period, from the fixed asset register's retirement records.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design("a disposal", "the disposal procedure", ("Disposal procedure", "One disposal")),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected disposal was approved before the asset left and "
            "removed from the register in the period.",
            "Inspect the approval and compare its date with the disposal date; agree the "
            "register removal and its period.",
            ("Disposal approvals", "Register"),
            ("fa03-disposals",),
        ),
        _roll_sampled("disposals", ("fa03-disposals",)),
    ),
    attributes=(
        _a(
            "fa03-disposals",
            "Each selected disposal was approved before the asset left and removed from the "
            "register in the period it occurred",
            condition="An approval dated before the disposal, and removal in the same period.",
            why="The control requires approved disposals to be recorded when they occur.",
            evidence=("Approval", "Register"),
            extract=("Asset", "Approval date", "Disposal date", "Removal period"),
            compare="Approval date against disposal date; removal period against disposal.",
            passes="Approved before, and removed in the period.",
            fails="Not approved, approved after, or not removed in the period.",
            insufficient="The approval or the register record is not provided.",
            review="The approver's authority is not defined.",
            not_infer="Do not assume removal from a disposal form.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Disposals were approved and removed from the register",
        ),
    ),
    retired=(
        Retired(
            "Impairment indicators were assessed and documented",
            "Moved to FA-03.1, the annual impairment assessment: disposals and impairment are "
            "two controls with different frequencies (milestone 8.9).",
            "fa031-impairment",
        ),
    ),
)

IMPAIRMENT = Definition(
    library_key="fa-impairment",
    control_ref="FA-03.1",
    objective="Indicators of impairment are assessed each year and acted on.",
    control_type="DETECTIVE",
    performer="Financial reporting",
    reviewer="The designated reviewer",
    trigger="The annual assessment",
    population="The annual impairment assessments in the period.",
    sampling=sampling("ANNUAL"),
    procedures=(
        _design(
            "the impairment assessment",
            "the indicators the policy lists and how the assessment is documented",
            ("Impairment policy",),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the year's assessment considered each indicator for each asset "
            "group and was reviewed.",
            "Inspect the assessment against the policy's indicators; inspect any test and the "
            "sign-off.",
            ("Assessment", "Impairment policy", "Sign-off"),
            ("fa031-impairment", "fa031-reviewer"),
        ),
    ),
    attributes=(
        _a(
            "fa031-impairment",
            "Each indicator the policy lists was assessed for each asset group, and the "
            "assessment documented for the year",
            condition="A documented assessment covering each indicator and asset group.",
            why="The control requires the assessment.",
            evidence=("Assessment", "Impairment policy"),
            extract=("Indicators considered", "Asset groups", "Conclusion"),
            compare="Assessment against the policy's indicators.",
            passes="Every indicator assessed for every group.",
            fails="Not performed, or an indicator or group omitted.",
            insufficient="The assessment or the policy is not provided.",
            review="Always: whether an indicator exists is judgment.",
            not_infer="Do not conclude on impairment.",
            basis=("DESIGN",),
            confidence="MODERATE",
        ),
        _reviewer("fa031-reviewer", "impairment assessment"),
    ),
)

TAX_PROVISION = Definition(
    library_key="tax-provision",
    control_ref="TAX-01",
    objective="The income tax provision is correctly calculated and reviewed.",
    control_type="DETECTIVE",
    performer="Tax",
    reviewer="Tax management and, where used, an external advisor",
    trigger="Each quarter",
    population="Quarterly provisions.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a provision", "the provision process and review", ("Process", "Review")
        ),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the provision starts from reported pre-tax income, deferred "
            "taxes roll forward, and it was reviewed.",
            "Agree pre-tax income to the ledger; inspect support for adjustments; "
            "recalculate the deferred tax roll-forward; inspect review evidence.",
            ("Provision workpapers", "Ledger", "Review"),
            ("tax01-income", "tax01-deferred", "tax01-reviewer"),
        ),
        _roll_sampled("provisions", ("tax01-income", "tax01-deferred", "tax01-reviewer")),
    ),
    attributes=(
        _a(
            "tax01-income",
            "The provision starts from pre-tax income agreed to the ledger, and each "
            "adjustment has support",
            condition="Pre-tax income agrees; adjustments supported.",
            why="Errors in inputs flow to the provision.",
            evidence=("Provision", "Ledger", "Support"),
            extract=("Pre-tax income", "Adjustments"),
            compare="Income against ledger; adjustments against support.",
            passes="Agrees and supported.",
            fails="Differs or unsupported.",
            insufficient="Not provided.",
            review="Whether a tax position is appropriate is specialist judgment.",
            not_infer="Do not evaluate tax positions.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The provision agrees to pre-tax income and supported adjustments",
        ),
        _a(
            "tax01-deferred",
            "Deferred tax balances roll forward from opening to closing with each movement "
            "explained",
            condition="Opening plus movements equals closing.",
            why="The description includes deferred taxes.",
            evidence=("Roll-forward",),
            extract=("Balances", "Movements"),
            compare="Recalculation.",
            passes="Rolls forward.",
            fails="Unexplained difference.",
            insufficient="Not provided.",
            review="Rate changes or valuation allowances.",
            not_infer="Do not judge valuation allowances.",
            basis=("DESIGN", "AS1105.15"),
            confidence="HIGH",
            was="Deferred tax balances roll forward correctly",
        ),
        _reviewer("tax01-reviewer", "tax provision", "The provision was reviewed and approved"),
    ),
    questions=(
        "What does tax management check in its review, and when is an external advisor used?",
    ),  # fmt: skip
)

INDIRECT_TAX = Definition(
    library_key="tax-indirect",
    control_ref="TAX-02",
    objective="Indirect tax returns agree to the ledger and are reviewed before filing.",
    control_type="DETECTIVE",
    performer="Tax",
    reviewer="A reviewer other than the preparer",
    trigger="Each return",
    population="Returns filed in the period.",
    sampling=sampling("MONTHLY"),
    procedures=(
        _design("a return", "the reconciliation and review", ("Procedure",)),  # fmt: skip
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the return agrees to the ledger, differences were explained, "
            "and it was reviewed before filing.",
            "Agree the return to the ledger; inspect explanations; compare review and filing "
            "dates.",
            ("Return", "Ledger", "Review", "Filing record"),
            ("tax02-agrees", "tax02-explained", "tax02-before"),
        ),
        _roll_sampled("returns", ("tax02-agrees", "tax02-explained", "tax02-before")),
    ),
    attributes=(
        _agrees(
            "tax02-agrees",
            "The return agrees to the tax accounts in the general ledger for the period",
            "Return and ledger amounts",
            "The return agrees to the ledger",
        ),  # fmt: skip
        _resolved("tax02-explained", "difference", "Differences were explained"),
        _a(
            "tax02-before",
            "The return was reviewed by someone other than the preparer before it was filed",
            condition="Review by another person, dated before filing.",
            why="The description requires review before filing.",
            evidence=("Review", "Filing record"),
            extract=("Reviewer", "Dates"),
            compare="Reviewer against preparer; review against filing date.",
            passes="Different person, before filing.",
            fails="Same person or after filing.",
            insufficient="Dates missing.",
            review="Filing date not recorded.",
            not_infer="Do not use submission confirmation as review.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="It was reviewed before filing",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    CUSTOMER_MASTER,
    REVENUE_CUTOFF,
    CASH_APPLICATION,
    CREDIT_MEMOS,
    VENDOR_MASTER,
    PURCHASE_APPROVAL,
    ACCRUALS,
    PAYMENT_RUN,
    JOURNAL_REVIEW,
    ACCOUNT_RECS,
    FLUX_REVIEW,
    CONSOLIDATION,
    BANK_RECS,
    BANK_ACCESS,
    DEBT,
    COVENANTS,
    PAYROLL_CHANGES,
    PAYROLL_REVIEW,
    PAYROLL_REC,
    COUNTS,
    INVENTORY_RESERVE,
    STANDARD_COSTS,
    ADDITIONS,
    DEPRECIATION,
    DISPOSALS,
    IMPAIRMENT,
    TAX_PROVISION,
    INDIRECT_TAX,
)
