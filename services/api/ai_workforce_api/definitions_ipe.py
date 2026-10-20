"""Version 4 testing definitions for the key reports added in library version 4, wave 1
(IPE-03 to IPE-08).

A key report control validates a report before a key control relies on it (AS 1105.10):
its parameters, its agreement to the ledger or source, and a recalculation or trace of
selected items. The shared shape is built by `_report` below; the spreadsheet control
(IPE-08) is written out. See definitions_itgc_access.py for the conventions and
statements_itgc_more.py for each control's design statement."""

from ai_workforce_api.definitions_support import (
    ROLL_LIMIT,
    WALKTHROUGH_LIMIT,
    Suite,
    assess_design,
    authority,
    client_values,
    conclude,
    ev,
    evaluate_exceptions,
    information_used,
    inquire_changes,
    read_design,
    select_sample,
    step,
    update_sample,
    walkthrough,
)
from ai_workforce_api.testing_definitions import AttributeDef, Definition, sampling


def _report(
    *,
    library_key: str,
    control_ref: str,
    prefix: str,
    report: str,
    objective: str,
    frequency: str,
    frequency_word: str,
    preparer: str,
    values: str,
    agree_to: str,
    agree_fields: tuple[str, ...],
    parameters: tuple[str, ...],
    item: str,
    item_check: str,
    item_evidence: tuple[str, ...],
    addresses: str,
    attributes: tuple[tuple[str, dict[str, object]], ...],
) -> Definition:
    e1, e2, e3, e4, e5, e6, e7, e8 = (f"{prefix}-e{n}" for n in range(1, 9))
    suite = Suite(
        (
            ev(
                e1,
                f"Report definition: the logic, sources, and parameters of {report}",
                "DOCUMENT",
                "The control owner",
                ("DESIGN",),
                "DESIGN",
                "The version in force during the period",
                (
                    "Query or logic",
                    "Data sources",
                    "Parameters and filters",
                    "Who may change the definition",
                ),
            ),
            ev(
                e2,
                f"Walkthrough instance: one validation of {report}",
                "DOCUMENT",
                preparer,
                ("DESIGN",),
                "DESIGN",
                "One recent use",
                (
                    "The report as run",
                    "The parameter record",
                    "The agreement to the ledger",
                    "The item check",
                    "The sign-off",
                ),
            ),
            ev(
                e3,
                f"Schedule of {frequency_word} uses of {report} in the window",
                "DOCUMENT",
                "The control owner",
                ("OPERATING", "ROLLFORWARD"),
                "POPULATION",
                f"The {frequency_word} periods in the window",
                ("Period", "Report run date", "Preparer", "Sign-off date"),
                completeness=f"One validation is expected per {frequency_word} period the report "
                "is used; the schedule is agreed to that expectation and to the sign-offs.",
            ),
            ev(
                e4,
                f"{report[:1].upper()}{report[1:]} as run for each selected period, with its "
                "parameters",
                "SYSTEM_REPORT",
                preparer,
                ("OPERATING", "ROLLFORWARD"),
                "COMPLETENESS",
                "Each selected period",
                (*parameters, "Run date", "Record count", "Report total"),
                completeness="The parameter screen or log captured when the report ran, so that "
                "the run can be shown to cover the period and every entity without an "
                "excluding filter.",
                not_acceptable="A spreadsheet copy of the report without its parameters.",
                attributes=(f"{prefix}-parameters", f"{prefix}-agreed"),
            ),
            ev(
                e5,
                f"{agree_to[:1].upper()}{agree_to[1:]} at each selected period's date",
                "SYSTEM_REPORT",
                preparer,
                ("OPERATING", "ROLLFORWARD"),
                "ATTRIBUTE",
                "Each selected period",
                agree_fields,
                attributes=(f"{prefix}-agreed",),
            ),
            ev(
                e6,
                f"Source documents for the {item}s checked in each selected period",
                "DOCUMENT",
                preparer,
                ("OPERATING", "ROLLFORWARD"),
                "ATTRIBUTE",
                "Each selected period",
                item_evidence,
                attributes=(f"{prefix}-items",),
            ),
            ev(
                e7,
                "Preparer's validation record and sign-off for each selected period",
                "DOCUMENT",
                preparer,
                ("OPERATING", "ROLLFORWARD"),
                "ATTRIBUTE",
                "Each selected period",
                (
                    "Parameters recorded",
                    "Agreement and differences",
                    "Items checked and results",
                    "Preparer and date",
                ),
                attributes=(
                    f"{prefix}-parameters",
                    f"{prefix}-agreed",
                    f"{prefix}-items",
                    f"{prefix}-signoff",
                ),
            ),
            ev(
                e8,
                "Changes to the report or the control since the interim date",
                "CORRESPONDENCE",
                "The control owner",
                ("ROLLFORWARD",),
                "CONTEXT",
                "From the interim date to period end",
                (
                    "Changes to the report's logic or parameters, the preparer, or the source",
                    "Documentation of each change",
                ),
            ),
        )
    )
    tested = tuple(
        key for key, fields in attributes if fields["confidence"] in ("HIGH", "MODERATE")
    )
    procedures = (
        suite.proc(
            "d-1",
            "DESIGN",
            f"Understand how {report} is produced and what the validation checks.",
            "Read the report's definition and the validation procedure; identify the logic "
            "and sources, the parameters each run must use, what the preparer agrees it to, "
            "and which items are checked.",
            (
                read_design(f"the definition of {report} and the validation procedure", (e1,)),
                client_values(values),
                information_used(report, (e1, e4)),
            ),
        ),
        suite.proc(
            "d-2",
            "DESIGN",
            "Determine whether the validation, performed as described, is precise enough to "
            "rely on the report, and is implemented (AS 2201.42-.43).",
            f"Walk one validation of {report} from the run to the sign-off, asking the preparer "
            "what a difference would look like; confirm the preparer's competence; assess "
            "whether parameters, agreement, and the item check address the risk.",
            (
                walkthrough(f"a validation of {report}", (e2,)),
                authority("the preparer who validates the report"),
                assess_design(addresses),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        suite.proc(
            "o-1",
            "OPERATING",
            "Establish the validations performed in the window and select the sample.",
            f"List the {frequency_word} validations performed in the window against the one "
            "expected per period the report was used; select periods at random with the firm's "
            f"size for a {frequency_word} control.",
            (
                step(
                    f"List the validations of {report} performed in the window with the run "
                    "date, preparer, and sign-off date, and compare with the periods the "
                    "report was used.",
                    (e3,),
                    "Each period, the validation found or missing, and the dates.",
                    "A period in which the report was used without a validation is a "
                    "deviation for that period.",
                ),
                select_sample(f"a {frequency_word}", "report uses"),
            ),
        ),
        suite.proc(
            "o-2",
            "OPERATING",
            "Determine whether, for each selected period, the report ran with the right "
            f"parameters, agreed to {agree_to}, the {item}s checked agree to their source, and "
            "the validation was signed off.",
            "For each selected period, read the captured parameters against the definition and "
            f"the period; re-agree the report total to {agree_to}; re-perform the {item} check "
            "from the source documents; inspect the sign-off.",
            (
                step(
                    "Read the parameters captured when the report ran and compare each with "
                    "the definition and the period: the as-of date or date range, the "
                    "entities or company codes, and any filter.",
                    (e4, e1),
                    "Each parameter, its expected value, and any difference.",
                    "A wrong date, a missing entity, or an excluding filter is an exception.",
                ),
                step(
                    f"Re-agree the report total to {agree_to} at the same date, and read the "
                    "preparer's reconciliation of any difference.",
                    (e4, e5, e7),
                    "Report total, the balance agreed to, the difference, and its reconciliation.",
                    "An unreconciled difference, or a total typed onto the report, is an "
                    "exception; reconciling items that need judgment are recorded for a "
                    "person.",
                ),
                step(
                    f"Re-perform the check of the {item}s the preparer selected: {item_check}",
                    (e6, e4, e7),
                    f"Each {item}, the source values, the report values, and any difference.",
                    f"A {item} that does not agree to its source is an exception; the report's "
                    "logic is then questioned for the period.",
                ),
                step(
                    "Inspect the validation record and sign-off: the preparer, their role, the "
                    "date, and that it precedes the report's use.",
                    (e7,),
                    "Preparer, role, date, and the date of use.",
                    "No sign-off, or one after the report was used, is an exception.",
                ),
            ),
            (f"{prefix}-parameters", f"{prefix}-agreed", f"{prefix}-items", f"{prefix}-signoff"),
        ),
        suite.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per period and attribute, cited to the evidence.",
            (evaluate_exceptions("report use"), conclude("interim")),
        ),
        suite.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the report's logic or parameters, the preparer, or the source "
            "changed since the interim date; test the validations of the remaining period per "
            "the roll-forward table against the same attributes; record the results.",
            (
                inquire_changes((e8,)),
                step(
                    f"List the validations of {report} performed in the remaining period "
                    "against the periods the report was used.",
                    (e3,),
                    "Each period and the validation found or missing.",
                    "A missing validation is a deviation for that period.",
                ),
                update_sample("report uses"),
                conclude("roll-forward"),
            ),
            tested,
            ROLL_LIMIT,
        ),
    )
    built: list[AttributeDef] = []
    for key, fields in attributes:
        text = str(fields.pop("text"))
        raw = fields.pop("evidence_keys")
        keys = tuple(str(k) for k in raw) if isinstance(raw, tuple) else ()
        built.append(suite.attr(key, text, keys, **fields))
    return Definition(
        library_key=library_key,
        control_ref=control_ref,
        version=4,
        objective=objective,
        control_type="DETECTIVE",
        performer=preparer,
        reviewer="None: the check is the control",
        trigger=f"Each {frequency_word} use of {report}",
        population=f"The {frequency_word} uses of {report} in the period, each validated before "
        "use.",
        sampling=sampling(frequency),
        evidence=suite.items,
        procedures=procedures,
        attributes=tuple(built),
    )


def _standard_attributes(
    prefix: str, report: str, agree_to: str, item: str, item_text: str, sample_placeholder: str
) -> tuple[tuple[str, dict[str, object]], ...]:
    return (
        (
            f"{prefix}-parameters",
            dict(
                text=f"{report[:1].upper()}{report[1:]} was run as at the period's date for every "
                "entity in scope, with no filter that excludes records, as the captured "
                "parameters show",
                evidence_keys=(f"{prefix}-e4", f"{prefix}-e7"),
                condition="As-of date or range equals the period; all entities; no excluding "
                "filter.",
                why="Wrong parameters make a complete-looking report incomplete (AS 1105.10).",
                extract=("Date", "Entities", "Filters"),
                compare="Parameters against the period and the entity list.",
                passes="Correct.",
                fails="Wrong date, missing entity, or excluding filter.",
                insufficient="Parameters not captured when the report ran.",
                review="A filter whose effect is unclear.",
                not_infer="A report title is not its parameters.",
                basis=("AS1105.10",),
                confidence="HIGH",
            ),
        ),
        (
            f"{prefix}-agreed",
            dict(
                text=f"The report's total agrees to {agree_to} at the same date, or the difference "
                "is reconciled",
                evidence_keys=(f"{prefix}-e4", f"{prefix}-e5", f"{prefix}-e7"),
                condition="Report total equals the balance, or every difference is explained.",
                why="Completeness of the report (AS 1105.10).",
                extract=("Report total", "Balance", "Date", "Differences"),
                compare="Totals.",
                passes="Equal, or differences reconciled.",
                fails="An unreconciled difference.",
                insufficient="Either figure missing.",
                review="Reconciling items need judgment.",
                not_infer="Do not accept a total typed onto the report.",
                basis=("DESIGN", "AS1105.10"),
                confidence="HIGH",
            ),
        ),
        (
            f"{prefix}-items",
            dict(
                text=f"For [{sample_placeholder}], {item_text}",
                evidence_keys=(f"{prefix}-e6", f"{prefix}-e4", f"{prefix}-e7"),
                condition=f"Each selected {item} agrees to its source.",
                why="Accuracy of the report (AS 1105.10); how many items the client checks is its "
                "own choice.",
                extract=(f"Selected {item}s", "Source values", "Report values"),
                compare="Report against source per item.",
                passes="All agree.",
                fails="An item disagrees.",
                insufficient="Source documents not provided.",
                review="The number of items the procedure requires is not provided.",
                not_infer="Do not assume the extent of the check.",
                basis=("AS1105.10", "AS1105.15"),
                confidence="LOW",
                question=f"How many {item}s does the procedure require the preparer to check each "
                "period?",
                blocks=False,
            ),
        ),
        (
            f"{prefix}-signoff",
            dict(
                text="The validation was recorded and signed off by the preparer before the report "
                "was used",
                evidence_keys=(f"{prefix}-e7",),
                condition="A dated sign-off by the preparer, before the use.",
                why="Without it there is no evidence the validation happened before reliance.",
                extract=("Preparer", "Date", "Date of use"),
                compare="The sign-off date against the use.",
                passes="Signed before use.",
                fails="No sign-off, or signed after use.",
                insufficient="The record is not provided.",
                review="The date of use is not documented.",
                not_infer="A filed report is not a validation.",
                basis=("DESIGN", "AS2201.44"),
                confidence="HIGH",
            ),
        ),
    )


IPE_INVENTORY_VALUATION = _report(
    library_key="ipe-inventory-valuation",
    control_ref="IPE-03",
    prefix="ipe03",
    report="the inventory valuation report",
    objective="The inventory valuation report used for the inventory balance and reserves is "
    "complete and accurate.",
    frequency="QUARTERLY",
    frequency_word="quarterly",
    preparer="The cost accountant who validates the report",
    values="the number of items recalculated each period",
    agree_to="the inventory accounts in the general ledger",
    agree_fields=("Account", "Balance", "Date"),
    parameters=("As-of date", "Plants or entities", "Valuation area", "Filters"),
    item="item",
    item_check="recompute extended cost as quantity times unit cost from the stock and cost "
    "records at the as-of date and compare with the report.",
    item_evidence=("Stock record at the as-of date", "Unit cost record", "Report line"),
    addresses="the report draws from the stock and cost records for every plant in scope; its "
    "total is agreed to the ledger each period before use; the extended cost of selected "
    "items is recomputed; and a difference stops the report's use until reconciled.",
    attributes=_standard_attributes(
        "ipe03",
        "the inventory valuation report",
        "the inventory accounts in the general ledger",
        "item",
        "the extended cost recomputed from quantity and unit cost at the "
        "as-of date equals the report",
        "the number of items recalculated each period",
    ),
)

IPE_FIXED_ASSET_REGISTER = _report(
    library_key="ipe-fixed-asset-register",
    control_ref="IPE-04",
    prefix="ipe04",
    report="the fixed asset register",
    objective="The fixed asset register used for the close and disclosures agrees to the ledger "
    "by class.",
    frequency="QUARTERLY",
    frequency_word="quarterly",
    preparer="The fixed asset accountant who validates the register",
    values="which asset classes and ledgers the register covers",
    agree_to="the fixed asset cost and accumulated depreciation accounts in the general ledger, "
    "by class",
    agree_fields=("Class", "Cost account balance", "Accumulated depreciation balance", "Date"),
    parameters=("As-of date", "Company codes", "Depreciation area", "Asset classes"),
    item="class",
    item_check="agree the class's cost, accumulated depreciation, and net book value totals to "
    "the ledger accounts mapped to it.",
    item_evidence=(
        "Class totals on the register",
        "Ledger account balances by class",
        "Account mapping",
    ),
    addresses="the register draws from the asset subledger for every company code in scope; its "
    "totals are agreed to the ledger by class each period; and a difference is traced to its "
    "postings before the register is used.",
    attributes=_standard_attributes(
        "ipe04",
        "the fixed asset register",
        "the fixed asset cost and accumulated depreciation accounts in the general ledger",
        "class",
        "the cost, accumulated depreciation, and net "
        "book value totals agree to the ledger accounts mapped to the class",
        "the asset classes agreed each period",
    ),
)

IPE_PAYROLL_REGISTER = _report(
    library_key="ipe-payroll-register",
    control_ref="IPE-05",
    prefix="ipe05",
    report="the payroll register",
    objective="The payroll register agrees to what is posted and paid before each payroll is "
    "approved.",
    frequency="MONTHLY",
    frequency_word="monthly",
    preparer="The payroll specialist who validates the register",
    values="which payrolls and companies the register covers",
    agree_to="the payroll journal posted to the general ledger and the payment file total",
    agree_fields=("Journal gross, deductions, and net", "Payment file total and payees", "Date"),
    parameters=("Pay period", "Payroll areas or companies", "Run type"),
    item="employee",
    item_check="agree gross, deductions, and net on the register to the employee's pay slip "
    "and the payment file line.",
    item_evidence=("Pay slip", "Payment file line", "Register line"),
    addresses="the register is the system's own output for every payroll area in scope; its "
    "totals are agreed to the journal and the payment file before approval; and a difference "
    "is reconciled to employees before payment.",
    attributes=_standard_attributes(
        "ipe05",
        "the payroll register",
        "the payroll journal and the payment file total",
        "employee",
        "gross pay, deductions, and net pay on the register agree to the pay slip "
        "and the payment file line",
        "the employees agreed each payroll",
    ),
)

IPE_BILLING_REPORT = _report(
    library_key="ipe-billing-report",
    control_ref="IPE-06",
    prefix="ipe06",
    report="the billing report",
    objective="The billing report used for the revenue close and cut-off review is complete "
    "and accurate.",
    frequency="MONTHLY",
    frequency_word="monthly",
    preparer="The revenue accountant who validates the report",
    values="the number of invoices traced each period",
    agree_to="revenue in the general ledger",
    agree_fields=("Revenue accounts", "Balance or period movement", "Date"),
    parameters=("Date range", "Sales organizations or entities", "Document types", "Filters"),
    item="invoice",
    item_check="agree the invoice's customer, date, and amount on the report to the invoice "
    "document and its accounting document.",
    item_evidence=("Invoice document", "Accounting document", "Report line"),
    addresses="the report draws every billing document type for every sales organization in "
    "scope; its total is agreed to revenue each period; and selected invoices are traced to "
    "their documents before the report is used for cut-off.",
    attributes=_standard_attributes(
        "ipe06",
        "the billing report",
        "revenue in the general ledger",
        "invoice",
        "the "
        "customer, date, and amount on the report agree to the invoice and its accounting "
        "document",
        "the number of invoices traced each period",
    ),
)

IPE_AP_AGING = _report(
    library_key="ipe-ap-aging",
    control_ref="IPE-07",
    prefix="ipe07",
    report="the accounts payable aging",
    objective="The accounts payable aging used for the accrual review and disclosures is "
    "complete and correctly aged.",
    frequency="QUARTERLY",
    frequency_word="quarterly",
    preparer="The payables accountant who validates the aging",
    values="the number of invoices recalculated each period",
    agree_to="the payables accounts in the general ledger",
    agree_fields=("Payables accounts", "Balance", "Date"),
    parameters=("As-of date", "Company codes", "Vendor account groups", "Aging basis"),
    item="invoice",
    item_check="recompute the aging bucket from the invoice or due date to the as-of date and "
    "compare with the report's bucket.",
    item_evidence=("Invoice with its dates", "Report line and bucket"),
    addresses="the aging draws every open item for every company code in scope; its total is "
    "agreed to the ledger each period; the aging basis is documented; and selected invoices' "
    "buckets are recomputed before the aging is used.",
    attributes=_standard_attributes(
        "ipe07",
        "the accounts payable aging",
        "the payables accounts in the general ledger",
        "invoice",
        "the aging bucket recomputed from the invoice's dates to the as-of date "
        "equals the report's bucket",
        "the number of invoices recalculated each period",
    ),
)

# IPE-08 Key spreadsheets are controlled

_IPE08 = Suite(
    (
        ev(
            "ipe08-e1",
            "End-user computing procedure, the inventory of key spreadsheets, and the "
            "documented logic of each",
            "DOCUMENT",
            "The control owner for the general ledger",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Spreadsheet",
                "Owner",
                "Control it feeds",
                "Location",
                "Logic documentation",
                "What each use must check",
            ),
        ),
        ev(
            "ipe08-e2",
            "Walkthrough instance: one spreadsheet's use with its checks",
            "DOCUMENT",
            "The owner of the spreadsheet",
            ("DESIGN",),
            "DESIGN",
            "One recent use",
            ("The version used", "Input agreement", "Formula check", "Sign-off"),
        ),
        ev(
            "ipe08-e3",
            "Schedule of quarterly uses of key spreadsheets in the window",
            "DOCUMENT",
            "The control owner for the general ledger",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters in the window",
            ("Spreadsheet", "Period", "Use date", "Owner", "Sign-off date"),
            completeness="Each spreadsheet on the inventory is expected to be used and checked "
            "each period its control runs; the schedule is agreed to the inventory and the "
            "controls' calendar.",
        ),
        ev(
            "ipe08-e4",
            "Access and version history for each selected spreadsheet",
            "SYSTEM_REPORT",
            "The owner of the spreadsheet",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected use",
            (
                "Location",
                "Who has access",
                "Versions with author and date",
                "Query or logic of the version used",
            ),
            completeness="From the location's own access and version log, so that an unrecorded "
            "change is found.",
            not_acceptable="A copy of the file emailed around.",
            attributes=("ipe08-protected",),
        ),
        ev(
            "ipe08-e5",
            "The version used, its inputs, and their source reports",
            "SYSTEM_REPORT",
            "The owner of the spreadsheet",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected use",
            ("Input cells and values", "Source report with parameters and run date", "Agreement"),
            attributes=("ipe08-inputs",),
        ),
        ev(
            "ipe08-e6",
            "Formula check against the documented logic for the version used",
            "DOCUMENT",
            "The owner of the spreadsheet",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected use",
            ("Documented logic", "Formulas checked", "Differences and corrections"),
            attributes=("ipe08-formulas",),
        ),
        ev(
            "ipe08-e7",
            "Owner's sign-off on the version used",
            "DOCUMENT",
            "The owner of the spreadsheet",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected use",
            ("Owner", "Date", "Version signed"),
            attributes=("ipe08-signoff",),
        ),
        ev(
            "ipe08-e8",
            "Changes to the spreadsheets or the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for the general ledger",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            ("Spreadsheets added, retired, or relocated", "Documentation of each change"),
        ),
    )
)

_IPE08_TESTED = ("ipe08-protected", "ipe08-inputs", "ipe08-formulas", "ipe08-signoff")

IPE_EUC_SPREADSHEETS = Definition(
    library_key="ipe-euc-spreadsheets",
    control_ref="IPE-08",
    version=4,
    objective="A key control relies on a spreadsheet only when its access is restricted, its "
    "versions are kept, its inputs agree to their source, and its formulas match the "
    "documented logic.",
    control_type="DETECTIVE",
    performer="The owner of each key spreadsheet",
    reviewer="None: the check is the control",
    trigger="Each use of a key spreadsheet for a key control",
    population="The uses of each spreadsheet on the inventory in the period, one per period "
    "the control it feeds runs.",
    sampling=sampling("QUARTERLY"),
    evidence=_IPE08.items,
    procedures=(
        _IPE08.proc(
            "d-1",
            "DESIGN",
            "Understand which spreadsheets are key, where they live, and what each use checks.",
            "Read the end-user computing procedure and the inventory; identify each key "
            "spreadsheet, the control it feeds, its location and access, its logic "
            "documentation, and the checks each use must make.",
            (
                read_design("the end-user computing procedure and the inventory", ("ipe08-e1",)),
                client_values(
                    "the inventory of key spreadsheets and where key spreadsheets are kept"
                ),
                step(
                    "For each spreadsheet on the inventory, identify the query or logic its "
                    "documentation describes and the source reports its inputs come from.",
                    ("ipe08-e1",),
                    "Per spreadsheet: the logic documented and the input sources.",
                    "A spreadsheet with no logic documentation cannot be checked against it: "
                    "a design gap for a person.",
                ),
            ),
        ),
        _IPE08.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one spreadsheet's use from the version opened to the sign-off, asking the "
            "owner how they agree inputs and check formulas; confirm the owners' competence; "
            "assess whether access, versions, input agreement, and formula checks address the "
            "risk.",
            (
                walkthrough("a key spreadsheet's use", ("ipe08-e2",)),
                authority("the owners of key spreadsheets"),
                assess_design(
                    "the inventory names every spreadsheet a key control relies on; each is "
                    "kept where access is restricted to its owner and versions are logged; "
                    "each use agrees the inputs to their source reports and checks the formulas "
                    "against documented logic; and the owner signs the version used."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _IPE08.proc(
            "o-1",
            "OPERATING",
            "Establish the uses in the window and select the sample.",
            "List the uses of key spreadsheets in the window against the inventory and the "
            "controls' calendar; select uses at random with the firm's size for a quarterly "
            "control.",
            (
                step(
                    "List the uses of each key spreadsheet in the window with the use date, "
                    "owner, and sign-off date, and compare with the inventory and the periods "
                    "the controls ran.",
                    ("ipe08-e3", "ipe08-e1"),
                    "Each spreadsheet and period, the use found or missing, and the dates.",
                    "A period in which a control ran on a spreadsheet with no recorded check "
                    "is a deviation for that period.",
                ),
                select_sample("a quarterly", "spreadsheet uses"),
            ),
        ),
        _IPE08.proc(
            "o-2",
            "OPERATING",
            "Determine whether, for each selected use, the spreadsheet was access-restricted "
            "and versioned, its inputs agreed to their source, its formulas matched the "
            "documented logic, and the owner signed the version.",
            "For each selected use, read the location's access and version history; re-agree "
            "the input cells to the source reports; re-perform the formula check against the "
            "documented logic; inspect the sign-off.",
            (
                step(
                    "Read the location's access list and version history for the "
                    "spreadsheet; compare the access with the owner and the versions with the "
                    "one used.",
                    ("ipe08-e4",),
                    "Who has access, each version with author and date, and the version used.",
                    "Access beyond the owner and reviewers, or a version used that the "
                    "history does not show, is an exception; a file outside the controlled "
                    "location is an exception.",
                ),
                step(
                    "Re-agree each input cell of the version used to its source report, with "
                    "the report's parameters and run date.",
                    ("ipe08-e5",),
                    "Each input, its source value, and any difference.",
                    "An input that does not agree to its source is an exception.",
                ),
                step(
                    "Re-perform the formula check: compare the formulas in the version used "
                    "with the documented logic, and recompute the output from the inputs.",
                    ("ipe08-e6", "ipe08-e5"),
                    "Formulas checked, differences from the logic, and the recomputed output.",
                    "A formula that differs from the documented logic, or an output that does "
                    "not recompute, is an exception.",
                ),
                step(
                    "Inspect the owner's sign-off on the version used and its date against the "
                    "control's use.",
                    ("ipe08-e7",),
                    "Owner, date, version signed, and the date of use.",
                    "No sign-off, a sign-off on a different version, or one after the use is "
                    "an exception.",
                ),
            ),
            _IPE08_TESTED,
        ),
        _IPE08.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per use and attribute, cited to the evidence.",
            (evaluate_exceptions("spreadsheet use"), conclude("interim")),
        ),
        _IPE08.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the inventory, the locations, or the owners changed since the "
            "interim date; test the uses of the remaining period per the roll-forward table "
            "against the same attributes; record the results.",
            (
                inquire_changes(("ipe08-e8",)),
                step(
                    "List the uses of key spreadsheets in the remaining period against the "
                    "inventory and the controls' calendar.",
                    ("ipe08-e3",),
                    "Each spreadsheet and period, the use found or missing.",
                    "A missing check is a deviation for that period.",
                ),
                update_sample("spreadsheet uses"),
                conclude("roll-forward"),
            ),
            _IPE08_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _IPE08.attr(
            "ipe08-protected",
            "The spreadsheet is kept in the controlled location with access restricted to its "
            "owner, and the version used appears in the location's version history",
            ("ipe08-e4",),
            condition="Access limited to the owner (and named reviewers); the version used is "
            "in the history.",
            why="The statement says key spreadsheets are kept with restricted access and change "
            "history on; without that a change can go unnoticed.",
            extract=("Location", "Access list", "Versions", "Version used"),
            compare="Access against the owner; the version used against the history.",
            passes="Restricted and versioned.",
            fails="Wider access, a version not in the history, or a file outside the location.",
            insufficient="The location's access and version log is not provided.",
            review="Read access granted to a reviewer the procedure names.",
            not_infer="Do not assume the location from the file's name.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _IPE08.attr(
            "ipe08-inputs",
            "Every input of the version used agrees to its source report, as run with recorded "
            "parameters",
            ("ipe08-e5",),
            condition="Each input cell equals the source report's value.",
            why="The statement says inputs are agreed to their source before use.",
            extract=("Inputs", "Source values", "Parameters"),
            compare="Input against source, cell by cell.",
            passes="All agree.",
            fails="An input differs from its source.",
            insufficient="The source report or its parameters are not provided.",
            review="An input taken from a source outside the system.",
            not_infer="Do not accept a hard-coded value as an agreed input.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _IPE08.attr(
            "ipe08-formulas",
            "The formulas of the version used match the documented logic and the output "
            "recomputes from the inputs",
            ("ipe08-e6", "ipe08-e5"),
            condition="No formula differs from the logic; the output recomputes.",
            why="The statement says formulas are checked against the documented logic.",
            extract=("Formulas", "Logic", "Recomputed output"),
            compare="Formulas against logic; output recomputed.",
            passes="Match and recompute.",
            fails="A differing formula or an output that does not recompute.",
            insufficient="No logic documentation.",
            review="A formula changed under an approved change to the logic.",
            not_infer="Do not treat a protected sheet as proof the formulas are right.",
            basis=("DESIGN", "AS1105.15"),
            confidence="HIGH",
        ),
        _IPE08.attr(
            "ipe08-signoff",
            "The owner signed the version used before the control relied on it",
            ("ipe08-e7",),
            condition="A dated sign-off by the owner on the version used, before the use.",
            why="The statement says the owner signs the version used.",
            extract=("Owner", "Date", "Version", "Date of use"),
            compare="The sign-off against the version and the use.",
            passes="Signed on the version, before use.",
            fails="No sign-off, a different version, or signed after use.",
            insufficient="The sign-off is not provided.",
            review="The owner is also the control's performer.",
            not_infer="A file's modified date is not a sign-off.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    IPE_INVENTORY_VALUATION,
    IPE_FIXED_ASSET_REGISTER,
    IPE_PAYROLL_REGISTER,
    IPE_BILLING_REPORT,
    IPE_AP_AGING,
    IPE_EUC_SPREADSHEETS,
)
