"""Testing definitions for the entity-level, application, and key report controls of the
standard library (version 3), and the composed list with the IT general controls, which are
version 4 (definitions_itgc_access.py, definitions_itgc_change.py,
definitions_itgc_operations.py). See testing_definitions.py.

Each attribute restates something the control description says the performer or system
does (basis DESIGN), or an inference marked as such. Where a value the attribute depends on
is not in the description (a number of days, a threshold, a list of approvers), the
attribute is LOW confidence and carries the question to answer; it is proposed, not tested.
"""

from typing import Any

from ai_workforce_api import (
    definitions_ipe,
    definitions_itac,
    definitions_itgc_access,
    definitions_itgc_change,
    definitions_itgc_more,
    definitions_itgc_operations,
)
from ai_workforce_api.testing_definitions import (
    AttributeDef,
    Definition,
    ProcedureDef,
    Retired,
    sampling,
)


def _a(key: str, text: str, **fields: Any) -> AttributeDef:
    return AttributeDef(key=key, text=text, **fields)


def _p(
    key: str,
    phase: str,
    objective: str,
    action: str,
    evidence: tuple[str, ...],
    attributes: tuple[str, ...] = (),
    limitation: str = "",
) -> ProcedureDef:
    return ProcedureDef(key, phase, objective, action, evidence, attributes, limitation)  # type: ignore[arg-type]


ROLL_LIMIT = (
    "Inquiry alone is not relied on. AS 2201.56 allows inquiry alone only when the risk that "
    "the control stopped working is assessed as low; that assessment is a reviewer's decision."
)


def _roll_sampled(what: str, attributes: tuple[str, ...]) -> ProcedureDef:
    return _p(
        "rf-1",
        "ROLLFORWARD",
        "Conclude whether the control kept operating from the interim date to period end "
        "(AS 2201.55-.56).",
        f"Obtain the population of {what} for the remaining period with its completeness "
        "support. Ask the control owner whether the control, its performers, or its systems "
        "changed since interim, and inspect documentation of any change. Select an update "
        "sample from the remaining period only (firm roll-forward table) and test the same "
        "attributes. Do not reselect interim items.",
        (f"Population of {what} for the remaining period", "Documentation of any change"),
        attributes,
        ROLL_LIMIT,
    )


def _roll_config(setting: str, attributes: tuple[str, ...]) -> ProcedureDef:
    return _p(
        "rf-1",
        "ROLLFORWARD",
        "Conclude whether the setting stayed in place from the interim date to period end "
        "(AS 2201.55-.56, .B29).",
        f"Inspect the change history of {setting} for the remaining period. If it did not "
        "change, inspect the setting as at period end and agree it to the interim result. If "
        "it changed, test the change's approval and test the setting again as changed.",
        (f"Change history of {setting} for the remaining period", "The setting at period end"),
        attributes,
        "A setting at period end shows nothing about the period before it without the change "
        "history.",
    )


def _design(control: str, what: str, evidence: tuple[str, ...]) -> ProcedureDef:
    return _p(
        "d-1",
        "DESIGN",
        "Determine whether the control, performed as described by people with the authority "
        "and competence it needs, addresses its risk, and is implemented (AS 2201.42-.43).",
        f"Inspect {what}. Walk one recent instance of {control} through from its trigger to "
        "its evidence of completion (AS 2201.37-.38), asking the performer what they check "
        "and what they do with exceptions. Confirm the performer's role or delegation gives "
        "them the authority the control requires.",
        evidence,
        (),
        "A walkthrough of one instance shows the design is implemented; it does not show the "
        "control operated throughout the period.",
    )


# Entity level


ENTITY_CODE = Definition(
    library_key="entity-code-of-conduct",
    control_ref="ELC-01",
    objective="Employees acknowledge the code of conduct each year, and missing "
    "acknowledgements are followed up.",
    control_type="PREVENTIVE",
    performer="HR or compliance",
    reviewer="Not described",
    trigger="The annual acknowledgement cycle",
    population="Employees during the year, from HR, with completeness support.",
    sampling=sampling(
        "ANNUAL",
        note="The employees within the annual cycle are sampled at the event-driven size; confirm.",
    ),  # fmt: skip
    procedures=(
        _design(
            "the acknowledgement cycle",
            "the approved code and the acknowledgement process",
            ("Approved code", "Communication"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the code was approved and communicated, selected employees "
            "acknowledged it, and missing acknowledgements were followed up.",
            "Inspect the approval and communication; for selected employees, inspect the "
            "acknowledgement; for the exception report, inspect the follow-up.",
            ("Approval", "Communication", "Acknowledgements", "Exception follow-up"),
            ("elc01-approved", "elc01-acknowledged", "elc01-followed-up"),
        ),
    ),
    attributes=(
        _a(
            "elc01-approved",
            "The code of conduct in effect was approved and communicated to employees in the "
            "period",
            condition="Approval and a dated communication in the period.",
            why="The description requires a communicated code.",
            evidence=("Approval", "Communication"),
            extract=("Approver", "Dates"),
            compare="Dates against the period.",
            passes="Approved and communicated.",
            fails="Not communicated in the period.",
            insufficient="Not provided.",
            review="Approval authority undefined.",
            not_infer="A published page is not communication to employees.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The code of conduct was approved and communicated in the period",
        ),
        _a(
            "elc01-acknowledged",
            "The selected employee acknowledged the code in the period",
            condition="A dated acknowledgement by the employee.",
            why="The description requires annual acknowledgement.",
            evidence=("Acknowledgement record",),
            extract=("Employee", "Date"),
            compare="Employee against acknowledgement.",
            passes="Acknowledged in the period.",
            fails="Not acknowledged and not followed up.",
            insufficient="No record.",
            review="Employee joined or left during the cycle.",
            not_infer="Do not assume acknowledgement from training completion.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Selected employees acknowledged it",
        ),
        _a(
            "elc01-followed-up",
            "Each missing acknowledgement on the exception report was followed up by HR or "
            "compliance",
            condition="Follow-up recorded for each exception.",
            why="The description requires follow-up.",
            evidence=("Exception report", "Follow-up records"),
            extract=("Exceptions", "Follow-up"),
            compare="Exceptions against follow-up.",
            passes="Each followed up.",
            fails="One not followed up.",
            insufficient="No exception report.",
            review="What counts as follow-up.",
            not_infer="An unsent reminder is not follow-up.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Missing acknowledgements were followed up",
        ),
    ),
)

ENTITY_WHISTLEBLOWER = Definition(
    library_key="entity-whistleblower",
    control_ref="ELC-02",
    objective="Whistleblower reports are investigated and summarized to the audit committee.",
    control_type="DETECTIVE",
    performer="Compliance or internal audit",
    reviewer="The audit committee",
    trigger="A report, and each quarter",
    population="Reports in the whistleblower log. Reports never logged cannot be found by "
    "sampling the log.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a report",
            "the hotline procedure and committee reporting",
            ("Procedure", "One investigation file"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether selected reports were investigated and the committee received "
            "the quarterly summaries.",
            "Inspect investigation files for selected reports, and committee materials for "
            "each quarter.",
            ("Investigation files", "Committee materials and minutes"),
            ("elc02-investigated", "elc02-committee"),
            "The log is the population: an unlogged report is outside this test.",
        ),
        _roll_sampled(
            "reports and quarterly summaries", ("elc02-investigated", "elc02-committee")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "elc02-investigated",
            "The report was investigated and closed with a documented outcome",
            condition="An investigation and an outcome.",
            why="The description requires investigation.",
            evidence=("Investigation file",),
            extract=("Steps", "Outcome", "Closure"),
            compare="File for an outcome.",
            passes="Investigated with an outcome.",
            fails="Not investigated.",
            insufficient="File not provided.",
            review="Whether the investigation was adequate is judgment.",
            not_infer="Do not judge adequacy.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Each report was investigated and closed with a documented outcome",
        ),
        _a(
            "elc02-committee",
            "The audit committee received the quarter's summary of reports",
            condition="Committee materials or minutes include the summary.",
            why="The description requires quarterly summaries to the committee.",
            evidence=("Committee materials", "Minutes"),
            extract=("Quarter", "Summary"),
            compare="Quarter against materials.",
            passes="Received.",
            fails="Not presented.",
            insufficient="Materials not provided.",
            review="The summary omits reports in the log.",
            not_infer="An agenda item alone is not the summary.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The audit committee received the quarterly summary",
        ),
    ),
    retired=(
        Retired(
            "Each report was logged",
            "The log is the population; a logged report always passes. The limitation is "
            "stated on the procedure.",
        ),
    ),
)

# Application controls


APP_THREE_WAY = Definition(
    library_key="itac-three-way-match",
    control_ref="ITAC-01",
    objective="Invoices outside tolerance of the purchase order and receipt cannot be paid "
    "until resolved.",
    control_type="PREVENTIVE",
    performer="The system",
    reviewer="Not described",
    trigger="Each invoice posting",
    population="Not sampled: the configuration, with one instance of the block.",
    sampling=sampling("RECURRING", automated=True),
    procedures=(
        _design(
            "the match",
            "the configured tolerances against the approved design",
            ("Approved design", "Configuration"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the configuration matches the design and blocks an invoice "
            "outside tolerance.",
            "Compare configured tolerances with the design; observe or inspect one invoice "
            "outside tolerance being blocked.",
            ("Configuration export", "Blocked invoice or test transaction"),
            ("itac01-config", "itac01-blocks", "itac01-release"),
            "Relies on ITGCs over changes and access to the configuration (AS 2201.B29).",
        ),
        _p(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the configuration stayed in place to period end.",
            "Inspect the configuration change history for the remaining period; if changed, "
            "test again.",
            ("Configuration change history",),
            ("itac01-config",),
        ),
    ),
    attributes=(
        _a(
            "itac01-config",
            "The configured quantity and price tolerances for the three-way match equal the "
            "approved design",
            condition="Each configured tolerance equals the approved value.",
            why="The control is the configuration.",
            evidence=("Configuration export with system and date", "Approved design"),
            extract=("Tolerance parameters", "Values"),
            compare="Configured against approved.",
            passes="Equal.",
            fails="Different.",
            insufficient="No approved design or configuration.",
            review="Tolerance applies differently by vendor or company code.",
            not_infer="Do not assume default settings.",
            basis=("DESIGN", "AS2201.B28"),
            confidence="HIGH",
            was="The match and tolerance configuration is as designed",
        ),
        _a(
            "itac01-blocks",
            "An invoice outside tolerance was blocked for payment",
            condition="A test or real invoice outside tolerance shows a payment block.",
            why="Shows the configuration operates.",
            evidence=("Invoice with block status",),
            extract=("Invoice", "Variance", "Block"),
            compare="Variance against tolerance, and the block.",
            passes="Blocked.",
            fails="Not blocked.",
            insufficient="No instance.",
            review="The instance is from a different configuration.",
            not_infer="A blocked invoice within tolerance shows nothing.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="An invoice outside tolerance is blocked",
        ),
        _a(
            "itac01-release",
            "Only authorized users can release a payment block",
            condition="Users with release rights are authorized.",
            why="Release is not in the control description.",
            evidence=("Users with release rights", "Authorized list"),
            extract=("Users",),
            compare="Users against list.",
            passes="All authorized.",
            fails="Unauthorized user.",
            insufficient="No list.",
            review="Until the client confirms release is part of this control.",
            not_infer="Configuration change access is an ITGC, not this attribute.",
            basis=("INFERENCE",),
            confidence="LOW",
            question="Is releasing a blocked invoice part of this control in the client's "
            "design? If so, who may release?",
            was="Only authorized users can change the configuration or release a block",
        ),
    ),
)

APP_CREDIT = Definition(
    library_key="itac-credit-limit",
    control_ref="ITAC-02",
    objective="Orders that would exceed the customer's approved credit limit are held until "
    "an authorized user releases them.",
    control_type="PREVENTIVE",
    performer="The system, and authorized users for release",
    reviewer="Not described",
    trigger="Each sales order",
    population="Not sampled: the configuration, one held order, and release rights.",
    sampling=sampling("RECURRING", automated=True),
    procedures=(
        _design(
            "the credit check",
            "the configured credit check against the design",
            ("Approved design", "Configuration"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the check is configured as designed, holds an order over the "
            "limit, and only authorized users release holds.",
            "Compare configuration with design; inspect one held order; compare users with "
            "release rights with the authorized list.",
            ("Configuration", "Held order", "Users with release rights"),
            ("itac02-config", "itac02-holds", "itac02-release"),
        ),
        _p(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the configuration and release rights stayed in place.",
            "Inspect change history of the configuration and of release rights for the "
            "remaining period.",
            ("Change history",),
            ("itac02-config", "itac02-release"),
        ),
    ),
    attributes=(
        _a(
            "itac02-config",
            "The credit check is configured as designed for the order types and customers in scope",
            condition="Configuration equals design.",
            why="The control is the configuration.",
            evidence=("Configuration", "Design"),
            extract=("Parameters",),
            compare="Configured against design.",
            passes="Equal.",
            fails="Different.",
            insufficient="Not provided.",
            review="Exempt order types or customers.",
            not_infer="Do not assume defaults.",
            basis=("DESIGN", "AS2201.B28"),
            confidence="HIGH",
            was="The credit check configuration is as designed",
        ),
        _a(
            "itac02-holds",
            "An order that would exceed the credit limit was held",
            condition="An order over the limit shows a credit hold.",
            why="Shows the configuration operates.",
            evidence=("Held order",),
            extract=("Exposure", "Limit", "Hold"),
            compare="Exposure against limit, and the hold.",
            passes="Held.",
            fails="Not held.",
            insufficient="No instance.",
            review="Exposure calculation unclear.",
            not_infer="A hold for another reason shows nothing.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="An order over the limit is held",
        ),
        _a(
            "itac02-release",
            "Only authorized users can release a credit hold",
            condition="Users with release rights are on the authorized list.",
            why="The description names release by an authorized user.",
            evidence=("Users with release rights", "Authorized list"),
            extract=("Users",),
            compare="Users against list.",
            passes="All authorized.",
            fails="Unauthorized user.",
            insufficient="No authorized list.",
            review="Authorization by role without a list.",
            not_infer="Do not assume sales managers are authorized.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Only authorized users can release a credit hold or change limits",
        ),
    ),
    retired=(),
    assumptions=(
        "Changes to credit limits are a master data control, not this one; the v2 "
        "attribute's 'change limits' is dropped from release.",
    ),  # fmt: skip
)

# Key reports


REPORT_AR_AGING = Definition(
    library_key="ipe-aged-receivables",
    control_ref="IPE-01",
    objective="The aged receivables report used for the bad debt reserve is complete and accurate.",
    control_type="DETECTIVE",
    performer="The preparer of the reserve",
    reviewer="Not described",
    trigger="Each quarter's reserve",
    population="The quarterly reports used in the period.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a report run",
            "the report's logic, parameters, and reconciliation",
            ("Report logic", "Parameters", "Reconciliation"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the selected report was complete and accurate.",
            "Agree the report total to the ledger; inspect its parameters; recalculate aging "
            "for selected invoices.",
            ("Report as run", "Ledger balance", "Invoices"),
            ("ipe01-total", "ipe01-parameters", "ipe01-aging"),
        ),
        _roll_sampled("report runs", ("ipe01-total", "ipe01-parameters", "ipe01-aging")),
    ),
    attributes=(
        _a(
            "ipe01-total",
            "The report's total agrees to the receivables balance in the general ledger at "
            "the same date",
            condition="Report total equals the ledger balance.",
            why="Completeness of the report (AS 1105.10).",
            evidence=("Report", "Ledger balance"),
            extract=("Report total", "Ledger balance", "Date"),
            compare="Totals.",
            passes="Equal, or differences reconciled.",
            fails="Unreconciled difference.",
            insufficient="Either figure missing.",
            review="Reconciling items need judgment.",
            not_infer="Do not accept a total typed onto the report.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
            was="The report total agrees to the receivables balance in the ledger",
        ),
        _a(
            "ipe01-parameters",
            "The report was run as at the reserve date for every entity, with no filter that "
            "excludes receivables",
            condition="As-of date equals the reserve date; all entities; no excluding filter.",
            why="Wrong parameters make a complete-looking report incomplete.",
            evidence=("Parameter screenshot or log",),
            extract=("As-of date", "Entities", "Filters"),
            compare="Parameters against the reserve date and entity list.",
            passes="Correct.",
            fails="Wrong date, missing entity, or excluding filter.",
            insufficient="Parameters not shown.",
            review="A filter's effect is unclear.",
            not_infer="A report title is not its parameters.",
            basis=("AS1105.10",),
            confidence="HIGH",
            was="Report parameters (date, entities) are appropriate",
        ),
        _a(
            "ipe01-aging",
            "Aging buckets are correct for selected invoices, recalculated from invoice date "
            "or due date to the as-of date",
            condition="Recalculated days fall in the report's bucket.",
            why="Accuracy of the report (AS 1105.10).",
            evidence=("Invoices", "Report"),
            extract=("Invoice date", "Due date", "Bucket"),
            compare="Recalculated bucket against report bucket.",
            passes="Agree.",
            fails="Disagree.",
            insufficient="Invoices not provided.",
            review="Whether aging is from invoice or due date is not documented.",
            not_infer="Do not assume the aging basis.",
            basis=("AS1105.10", "AS1105.15"),
            confidence="HIGH",
            was="Aging buckets are calculated correctly for selected items",
        ),
    ),
)

REPORT_JOURNALS = Definition(
    library_key="ipe-journal-listing",
    control_ref="IPE-02",
    objective="The journal entry listing used for review and testing is complete.",
    control_type="DETECTIVE",
    performer="The preparer of the listing",
    reviewer="Not described",
    trigger="Each quarter",
    population="The quarterly listings used.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a listing",
            "how the listing is extracted and reconciled",
            ("Extraction parameters", "Reconciliation"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the selected listing is complete.",
            "Agree total activity to the movement in the trial balance; inspect parameters for "
            "entities, sources, and dates.",
            ("Listing", "Opening and closing trial balances", "Parameters"),
            ("ipe02-activity", "ipe02-scope"),
        ),
        _roll_sampled("listings", ("ipe02-activity", "ipe02-scope")),
    ),
    attributes=(
        _a(
            "ipe02-activity",
            "The listing's total activity agrees to the movement in the trial balance for the "
            "period",
            condition="Listing totals equal closing minus opening balances.",
            why="Completeness (AS 1105.10).",
            evidence=("Listing", "Trial balances"),
            extract=("Totals", "Balances"),
            compare="Totals against movement.",
            passes="Agree.",
            fails="Unreconciled difference.",
            insufficient="Not provided.",
            review="Reconciling items need judgment.",
            not_infer="Do not net debits and credits to zero as proof.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
            was="The listing's total activity agrees to the movement in the trial balance",
        ),
        _a(
            "ipe02-scope",
            "The listing covers every entity, journal source, and day in the period",
            condition="Parameters include all entities, sources, and dates.",
            why="A filtered listing can reconcile and still miss sources.",
            evidence=("Parameters",),
            extract=("Entities", "Sources", "Dates"),
            compare="Parameters against the lists.",
            passes="All included.",
            fails="Something excluded.",
            insufficient="Parameters not shown.",
            review="List of sources not provided.",
            not_infer="Do not assume all sources.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
            was="The listing covers every entity, source, and day in the period",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    # The IT general controls are version 4 (steps and evidence suites, milestone L3a).
    *definitions_itgc_access.DEFINITIONS,
    *definitions_itgc_change.DEFINITIONS,
    *definitions_itgc_operations.DEFINITIONS,
    *definitions_itgc_more.DEFINITIONS,
    ENTITY_CODE,
    ENTITY_WHISTLEBLOWER,
    APP_THREE_WAY,
    APP_CREDIT,
    REPORT_AR_AGING,
    REPORT_JOURNALS,
    # Added in library version 4, wave 1 (milestone L3c).
    *definitions_itac.DEFINITIONS,
    *definitions_ipe.DEFINITIONS,
)
