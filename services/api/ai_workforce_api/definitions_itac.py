"""Version 4 testing definitions for the application controls added in library version 4,
wave 1 (ITAC-03 to ITAC-13).

An application control is a configuration the system applies to every transaction. It is
tested as a test of one: the configuration against its approved design or criterion, one
instance showing it operates, and the configuration's change history for the period; the
period between the dates inspected rests on the access and change-management controls
over the system (AS 2201.B28-.B33). The shared shape is built by `_automated` below;
each control's attributes and evidence are its own. See definitions_itgc_access.py for
the conventions and statements_itgc_more.py for each control's design statement."""

from ai_workforce_api.definitions_support import (
    Suite,
    assess_design,
    client_values,
    conclude,
    config_change_history,
    ev,
    evaluate_exceptions,
    read_design,
    step,
)
from ai_workforce_api.testing_definitions import (
    AttributeDef,
    Definition,
    EvidenceDef,
    EvidenceForm,
    ProcedureDef,
    Step,
    sampling,
)

ITGC_RELIANCE = (
    "Relies on the access and change-management controls over the system for the period "
    "between the dates inspected (AS 2201.B29)."
)


def _automated(
    *,
    library_key: str,
    control_ref: str,
    prefix: str,
    objective: str,
    trigger: str,
    design_doc: tuple[str, tuple[str, ...]],
    values: str,
    configuration: tuple[str, tuple[str, ...]],
    instance: tuple[str, EvidenceForm, tuple[str, ...], str],
    addresses: str,
    compare_step: tuple[str, str, str],
    instance_step: tuple[str, str, str],
    extra_evidence: tuple[EvidenceDef, ...],
    extra_steps: tuple[tuple[str, tuple[str, ...], str, str], ...],
    attributes: tuple[tuple[str, dict[str, object]], ...],
    design_confirmation: str = "",
    questions: tuple[str, ...] = (),
) -> Definition:
    """One application control: its suite (the design document, the configuration, one
    instance, the change history, who can change it, and the control's own extras), the
    test-of-one procedures, and its attributes, keyed by the suite."""
    e_design, e_config, e_instance, e_history, e_access = (
        f"{prefix}-e1", f"{prefix}-e2", f"{prefix}-e3", f"{prefix}-e4", f"{prefix}-e5",
    )  # fmt: skip
    attribute_keys = tuple(key for key, _ in attributes)
    config_attrs = tuple(
        k for k in attribute_keys if k.endswith("-config") or k.endswith("-criteria")
    )
    suite = Suite(
        (
            ev(
                e_design,
                design_doc[0],
                "DOCUMENT",
                "The control owner",
                ("DESIGN", "OPERATING", "ROLLFORWARD"),
                "DESIGN",
                "The version in force during the period",
                design_doc[1],
                not_acceptable="A description of the intended behaviour without the values "
                "the configuration must hold.",
                attributes=config_attrs,
            ),
            ev(
                e_config,
                configuration[0],
                "CONFIGURATION",
                "The system administrator",
                ("DESIGN", "OPERATING", "ROLLFORWARD"),
                "ATTRIBUTE",
                "At the interim date and at period end",
                (*configuration[1], "System and client", "Date shown"),
                not_acceptable="A document describing the configuration, or a screenshot "
                "without the system and date.",
                attributes=(*config_attrs, f"{prefix}-operates"),
            ),
            ev(
                e_instance,
                instance[0],
                instance[1],
                "The system administrator",
                ("DESIGN", "OPERATING"),
                "ATTRIBUTE",
                "One instance in the window",
                instance[2],
                not_acceptable=instance[3],
                attributes=(f"{prefix}-operates",),
            ),
            ev(
                e_history,
                f"Change history of {configuration[0].split(' as ')[0].lower()}",
                "SYSTEM_LOG",
                "The system administrator",
                ("OPERATING", "ROLLFORWARD"),
                "ATTRIBUTE",
                "The window tested",
                (
                    "Setting changed",
                    "Old and new value",
                    "Date",
                    "Changed by",
                    "Change ticket or approval reference",
                ),
                completeness="How the history was produced, so that an empty history shows no "
                "change rather than no logging.",
                not_acceptable="A statement that nothing changed, without the log.",
                attributes=(f"{prefix}-unchanged",),
            ),
            ev(
                e_access,
                "Users and roles able to change the configuration",
                "SYSTEM_REPORT",
                "The system administrator",
                ("DESIGN",),
                "CONTEXT",
                "At the interim date",
                ("User or role", "Permission", "How the list was produced"),
            ),
            *extra_evidence,
        )
    )
    operating_steps: list[Step] = [
        step(compare_step[0], (e_config, e_design), compare_step[1], compare_step[2]),
        step(instance_step[0], (e_instance, e_config), instance_step[1], instance_step[2]),
    ]
    for action, evidence, record, exception in extra_steps:
        operating_steps.append(step(action, evidence, record, exception))
    operating_steps.append(
        config_change_history(configuration[0].split(" as ")[0].lower(), (e_history,))
    )
    procedures: tuple[ProcedureDef, ...] = (
        suite.proc(
            "d-1",
            "DESIGN",
            "Understand what the configuration must enforce and where it is set.",
            f"Read {design_doc[0][:1].lower()}{design_doc[0][1:]}; identify where the "
            "configuration is set, the values it must hold, what it applies to, and who can "
            "change it; record the client's values the test depends on.",
            (
                read_design(f"{design_doc[0][:1].lower()}{design_doc[0][1:]}", (e_design,)),
                client_values(values),
                step(
                    "Identify where the configuration is set, the transactions, company codes, "
                    "or objects it applies to, and the users and roles able to change it.",
                    (e_config, e_access),
                    "The configuration's location, its scope, and the roles able to change it.",
                    "A required setting that cannot be located, or scope the configuration "
                    "does not cover, is a design gap for a person to assess.",
                ),
            ),
        ),
        suite.proc(
            "d-2",
            "DESIGN",
            "Determine whether the configuration, as set, addresses the risk and is implemented "
            "(AS 2201.42-.43).",
            f"Inspect one instance of {trigger} that shows the configuration operating; assess "
            "whether the configuration, protected by change management and restricted access, "
            "addresses the risk.",
            (
                step(
                    f"Inspect one instance of {trigger} that shows the configuration operating "
                    "as set, or observe it in a walkthrough.",
                    (e_instance,),
                    "The instance, what the system did, and the date.",
                    "A configuration that does not operate as set is a design matter for a "
                    "person; the configuration export alone does not show implementation.",
                ),
                assess_design(addresses),
            ),
            limitation="Observation shows the configuration at the time observed (AS 1105.15).",
        ),
        suite.proc(
            "o-1",
            "OPERATING",
            "Determine whether the configuration met its design at the interim date, operated "
            "on an instance, and stayed in place through the window.",
            f"Compare the configuration, as shown from the system, with {design_doc[0][:1].lower()}"
            f"{design_doc[0][1:]} value by value; inspect one instance of {trigger} showing it "
            "operated; inspect the configuration's change history for the window.",
            tuple(operating_steps),
            attribute_keys,
            ITGC_RELIANCE,
        ),
        suite.proc(
            "o-2",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per value and attribute, cited to the evidence.",
            (evaluate_exceptions("configured value"), conclude("interim")),
        ),
        suite.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the configuration stayed in place from the interim date to period "
            "end (AS 2201.55-.56, .B29).",
            "Inspect the configuration's change history for the remaining period. If it did "
            "not change, inspect the configuration as at period end and agree it to the "
            "interim result. If it changed, test the change's approval and test the "
            "configuration again as changed.",
            (
                config_change_history(configuration[0].split(" as ")[0].lower(), (e_history,)),
                step(
                    "Inspect the configuration as at period end and agree each value to the "
                    "interim result, or, where a value changed, compare the new value with "
                    "the design.",
                    (e_config, e_design),
                    "Per value: the period-end value, the interim value, and the design value.",
                    "A period-end value that does not meet the design is an exception from "
                    "its change date.",
                ),
                conclude("roll-forward"),
            ),
            tuple(k for k in attribute_keys if k != f"{prefix}-operates"),
            "A configuration at period end shows nothing about the period before it without "
            "the change history.",
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
        control_type="PREVENTIVE",
        performer="The system (configured setting)",
        reviewer="None: the configuration is the control",
        trigger=trigger,
        population="Not sampled: the configuration and its change history for the period, with "
        "one instance showing it operates.",
        sampling=sampling("RECURRING", automated=True),
        evidence=suite.items,
        procedures=procedures,
        attributes=tuple(built),
        design_confirmation=design_confirmation,
        questions=questions,
    )


def _unchanged(prefix: str, what: str) -> tuple[str, dict[str, object]]:
    return (
        f"{prefix}-unchanged",
        dict(
            text=f"The {what} configuration did not change during the period, or each change "
            "was approved under change management, as shown by the system's change history",
            evidence_keys=(f"{prefix}-e4",),
            condition="The change history shows no change, or each change has approval.",
            why="One point-in-time configuration does not show the control held for the "
            "period; reliance rests on the change history and on change management.",
            extract=("Changes", "Dates", "Who changed", "Approval"),
            compare="Changes against approvals.",
            passes="No change, or every change approved.",
            fails="An unapproved change.",
            insufficient="No change history.",
            review="The system keeps no change history: a person decides an alternative.",
            not_infer="Do not infer no changes from the absence of a log.",
            basis=("DESIGN", "AS2201.B28", "INFERENCE"),
            confidence="MODERATE",
        ),
    )


# ITAC-03 Duplicate invoices are rejected

ITAC_DUPLICATE_INVOICE = _automated(
    library_key="itac-duplicate-invoice",
    control_ref="ITAC-03",
    prefix="itac03",
    objective="The same vendor invoice cannot be recorded twice.",
    trigger="a vendor invoice entered with the same vendor and invoice number as one recorded",
    design_doc=(
        "Approved design of the duplicate invoice check",
        (
            "Fields matched",
            "Action on a match (reject or block)",
            "Who may release a blocked invoice",
            "Approval of the design",
        ),
    ),
    values="the fields the duplicate check matches on and the role that reviews blocked duplicates",
    configuration=(
        "Duplicate invoice check configuration as shown from the system",
        ("Check active per company code", "Fields matched", "Action on match"),
    ),
    instance=(
        "A rejected or blocked duplicate invoice",
        "SYSTEM_SCREEN",
        ("The invoice entered", "The earlier invoice it matched", "The system's message or block"),
        "A duplicate the clerk noticed by hand: it shows the person, not the system.",
    ),
    addresses="the check is active for every company code in scope; it matches on fields that "
    "identify an invoice (vendor and invoice number at least); a match is rejected or blocked, "
    "not warned; and only a restricted role can release a block.",
    compare_step=(
        "Compare the configured check, company code by company code, with the "
        "approved design: active, the fields matched, and the action on a match.",
        "Per company code: active, fields, action, and the design value for each.",
        "A company code with the check off, fewer fields than the design, or a "
        "warning instead of a block is an exception.",
    ),
    instance_step=(
        "Inspect one invoice the system rejected or blocked as a duplicate: the "
        "invoice, the earlier invoice it matched, and the system's action.",
        "Invoice, earlier invoice, matched fields, the action, and the date.",
        "No instance in the window is recorded as untested on this attribute; an "
        "instance where the system only warned is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac03-config",
            dict(
                text="The duplicate invoice check is active for every company code in scope and "
                "matches on the fields the approved design names, rejecting or blocking a match",
                evidence_keys=("itac03-e2", "itac03-e1"),
                condition="Active in each company code; fields and action equal the design.",
                why="The control is the configuration.",
                extract=("Company codes", "Fields matched", "Action"),
                compare="Configured against the design.",
                passes="Equal in every company code.",
                fails="Off, fewer fields, or a warning only.",
                insufficient="The configuration is not shown from the system, or the design is not "
                "approved.",
                review="The design matches on fewer fields than the statement names.",
                not_infer="Do not assume the vendor's default settings.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac03-operates",
            dict(
                text="An invoice entered with the same vendor and invoice number as one recorded "
                "was "
                "rejected or blocked by the system",
                evidence_keys=("itac03-e3", "itac03-e2"),
                condition="An instance in the window shows the system's rejection or block.",
                why="Shows the configuration operates.",
                extract=("Invoice", "Earlier invoice", "Action", "Date"),
                compare="The matched fields and the action against the configuration.",
                passes="Rejected or blocked.",
                fails="Posted, or warned only.",
                insufficient="No instance is available.",
                review="The instance predates a change to the configuration.",
                not_infer="A duplicate caught by a person shows nothing about the system.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac03", "duplicate check"),
    ),
)

# ITAC-04 Purchase orders are routed for approval

ITAC_PO_WORKFLOW = _automated(
    library_key="itac-po-workflow",
    control_ref="ITAC-04",
    prefix="itac04",
    objective="No purchase order reaches a vendor without the approvals the delegation of "
    "authority requires.",
    trigger="a purchase order held for approval",
    design_doc=(
        "Delegation of authority for purchase orders and the approved workflow design",
        (
            "Amount bands",
            "Approver role per band and cost center",
            "Rule that the order is not released before approval",
            "Approval of the design",
        ),
    ),
    values="the delegation of authority for purchase orders",
    configuration=(
        "Purchase order release strategy as shown from the system",
        (
            "Release strategy and groups",
            "Amount bands",
            "Approver roles per band",
            "Output blocked until release",
        ),
    ),
    instance=(
        "A purchase order held until its approvals were recorded",
        "SYSTEM_SCREEN",
        (
            "The order and its amount",
            "Approvals required and recorded with times",
            "Release time",
            "Output or transmission time",
        ),
        "An order approved by email outside the system.",
    ),
    addresses="every order type in scope is covered by the release strategy; the bands and "
    "approver roles equal the delegation of authority; the order cannot be output or sent "
    "before every required release; and release rights are restricted to the approver roles.",
    compare_step=(
        "Compare the release strategy, band by band, with the delegation of "
        "authority: the amount bands, the approver roles, and the rule that output "
        "waits for release.",
        "Per band: the configured band and roles against the delegation.",
        "A band or approver role that differs from the delegation, or an order type "
        "outside the strategy, is an exception; where the delegation is not provided "
        "the attribute waits for the client's value.",
    ),
    instance_step=(
        "Inspect one order whose amount required approval: the releases the system "
        "required, who released and when, and that output followed the last "
        "release.",
        "Order, amount, releases required and recorded, and the output time.",
        "An order output before its last release is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac04-criteria",
            dict(
                text="The release strategy's amount bands and approver roles equal [the delegation "
                "of authority for purchase orders], for every order type in scope",
                evidence_keys=("itac04-e2", "itac04-e1"),
                condition="Each band and role in the configuration equals the delegation.",
                why="The control enforces the delegation; the delegation is the client's.",
                extract=("Bands", "Roles", "Order types"),
                compare="Configured against the delegation.",
                passes="Equal.",
                fails="A band or role differs, or an order type is uncovered.",
                insufficient="The delegation is not provided.",
                review="The delegation names people rather than roles.",
                not_infer="Do not assume the delegation from the configuration.",
                basis=("DESIGN",),
                confidence="LOW",
                question="What delegation of authority (amount bands and approver roles) must the "
                "purchase order workflow enforce?",
                blocks=True,
            ),
        ),
        (
            "itac04-operates",
            dict(
                text="An order requiring approval was held by the system until every required "
                "release was recorded, and was output only after",
                evidence_keys=("itac04-e3", "itac04-e2"),
                condition="Releases recorded before output on an instance in the window.",
                why="Shows the configuration operates.",
                extract=("Releases", "Release times", "Output time"),
                compare="Output time against the last release.",
                passes="Output after the last release.",
                fails="Output before release.",
                insufficient="No instance is available.",
                review="The instance's order type is outside the strategy.",
                not_infer="An approval recorded outside the system shows nothing about it.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac04", "release strategy"),
    ),
)

# ITAC-05 Invoices without a purchase order are routed for approval

ITAC_NONPO_ROUTING = _automated(
    library_key="itac-nonpo-routing",
    control_ref="ITAC-05",
    prefix="itac05",
    objective="No invoice without a purchase order is posted without the approval the matrix "
    "requires.",
    trigger="an invoice without a purchase order held for approval",
    design_doc=(
        "Approval matrix for invoices without a purchase order and the approved routing design",
        (
            "Approver per cost center and amount band",
            "Rule that posting waits for approval",
            "Approval of the design",
        ),
    ),
    values="the approval matrix for invoices without a purchase order",
    configuration=(
        "Invoice routing configuration as shown from the system",
        ("Routing rules", "Cost center owners", "Amount bands", "Posting blocked until approval"),
    ),
    instance=(
        "An invoice without a purchase order held until approved",
        "SYSTEM_SCREEN",
        (
            "The invoice and cost center",
            "Approver the system routed to",
            "Approval time",
            "Posting time",
        ),
        "An invoice approved on paper and keyed as approved.",
    ),
    addresses="every invoice without a purchase order enters the routing; the approver per "
    "cost center and band equals the matrix; the invoice cannot post before approval; and "
    "the routing rules can be changed only under change management.",
    compare_step=(
        "Compare the routing rules, cost center by cost center and band by band, "
        "with the approval matrix, and confirm posting is blocked until approval.",
        "Per rule: the configured approver and band against the matrix.",
        "An approver or band that differs from the matrix, or a path that posts "
        "without approval, is an exception; where the matrix is not provided the "
        "attribute waits for the client's value.",
    ),
    instance_step=(
        "Inspect one invoice without a purchase order: the approver the system "
        "routed to, the approval time, and the posting time.",
        "Invoice, cost center, approver, approval time, posting time.",
        "An invoice posted before approval, or routed to someone the matrix does "
        "not name, is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac05-criteria",
            dict(
                text="The routing rules equal [the approval matrix for invoices without a purchase "
                "order], and an invoice cannot post before the routed approval",
                evidence_keys=("itac05-e2", "itac05-e1"),
                condition="Each rule equals the matrix; posting waits for approval.",
                why="The control enforces the matrix; the matrix is the client's.",
                extract=("Rules", "Approvers", "Bands", "Posting block"),
                compare="Configured against the matrix.",
                passes="Equal, with posting blocked.",
                fails="A rule differs, or posting is possible before approval.",
                insufficient="The matrix is not provided.",
                review="The matrix is maintained in the system itself.",
                not_infer="Do not assume the matrix from the configuration.",
                basis=("DESIGN",),
                confidence="LOW",
                question="Which approval matrix (approver per cost center and amount) must the "
                "routing of invoices without a purchase order enforce?",
                blocks=True,
            ),
        ),
        (
            "itac05-operates",
            dict(
                text="An invoice without a purchase order was routed to the matrix's approver and "
                "posted only after that approval",
                evidence_keys=("itac05-e3", "itac05-e2"),
                condition="Routed to the configured approver; posting time after approval time.",
                why="Shows the configuration operates.",
                extract=("Approver", "Approval time", "Posting time"),
                compare="Posting time against approval time; approver against the matrix.",
                passes="Routed correctly and posted after approval.",
                fails="Posted first, or routed elsewhere.",
                insufficient="No instance is available.",
                review="The approver was a delegate recorded in the system.",
                not_infer="A paper approval shows nothing about the system.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac05", "invoice routing"),
    ),
)

# ITAC-06 Closed periods cannot be posted to

ITAC_PERIOD_LOCK = _automated(
    library_key="itac-period-lock",
    control_ref="ITAC-06",
    prefix="itac06",
    objective="Nothing is posted into a closed accounting period unless an authorized person "
    "reopens it, and every reopening is logged.",
    trigger="a posting dated in a closed period",
    design_doc=(
        "Period close procedure and the approved period control design",
        (
            "When each period is closed",
            "The role allowed to reopen",
            "Rule that postings to closed periods are rejected",
            "Approval of the design",
        ),
    ),
    values="the role allowed to reopen a period",
    configuration=(
        "Posting period configuration as shown from the system",
        (
            "Period status per company code and ledger",
            "Roles allowed to post to special or prior periods",
            "Roles allowed to change period status",
        ),
    ),
    instance=(
        "A posting to a closed period rejected by the system",
        "SYSTEM_SCREEN",
        ("The document attempted", "Its posting date", "The system's rejection message", "Date"),
        "A posting the accountant chose not to make.",
    ),
    addresses="each period is closed after the close for every company code and ledger; a "
    "posting dated in a closed period is rejected, not warned; only the named role can "
    "reopen; and each reopening is logged with who and when.",
    compare_step=(
        "Compare the period status per company code and ledger with the close "
        "procedure's timetable, and the roles able to reopen with the role the "
        "procedure names.",
        "Per company code and ledger: status, close date, and the roles able to reopen.",
        "A period open past the procedure's date, or a reopening right beyond the "
        "named role, is an exception.",
    ),
    instance_step=(
        "Inspect one posting the system rejected because its date fell in a closed period.",
        "Document, posting date, period status, and the rejection.",
        "No instance in the window is recorded as untested on this attribute; a "
        "warning the user could bypass is an exception.",
    ),
    extra_evidence=(
        ev(
            "itac06-e6",
            "Period status change log for the window",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The window tested",
            ("Period", "Company code", "Opened or closed", "By whom", "Date and time"),
            completeness="From the system's own change log of the period table, with how it "
            "was produced.",
            attributes=("itac06-reopen",),
        ),
    ),
    extra_steps=(
        (
            "Inspect the period status change log for the window; for each reopening, compare "
            "who reopened with the named role and find the postings made while the period was "
            "open and the close that followed.",
            ("itac06-e6", "itac06-e2"),
            "Each reopening: period, by whom, when, the postings made, and the re-close.",
            "A reopening by someone outside the named role, or a period left open, is an "
            "exception; the postings made while open are listed for the close review.",
        ),
    ),
    attributes=(
        (
            "itac06-config",
            dict(
                text="Each accounting period is closed after the close for every company code and "
                "ledger, postings dated in a closed period are rejected, and only [the role "
                "allowed to reopen a period] can reopen one",
                evidence_keys=("itac06-e2", "itac06-e1"),
                condition="Periods closed per the timetable; rejection configured; reopening "
                "limited to the named role.",
                why="The control is the configuration.",
                extract=("Period status", "Close dates", "Roles able to reopen"),
                compare="Configured against the procedure.",
                passes="Closed on time, rejecting, restricted.",
                fails="A period open late, a bypassable warning, or a wider reopening right.",
                insufficient="The configuration is not shown from the system.",
                review="A period kept open for a documented reason under the procedure.",
                not_infer="Do not assume the role from the configuration's role names.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac06-operates",
            dict(
                text="A posting dated in a closed period was rejected by the system",
                evidence_keys=("itac06-e3", "itac06-e2"),
                condition="An instance in the window shows the rejection.",
                why="Shows the configuration operates.",
                extract=("Document", "Posting date", "Rejection"),
                compare="The posting date against the period status.",
                passes="Rejected.",
                fails="Posted, or warned only.",
                insufficient="No instance is available.",
                review="The instance was in a special period the procedure allows.",
                not_infer="A posting not attempted shows nothing.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        (
            "itac06-reopen",
            dict(
                text="Each reopening of a period in the window was made by the role allowed, is "
                "logged with who and when, and the period was closed again",
                evidence_keys=("itac06-e6", "itac06-e2"),
                condition="Every log entry's user is in the named role and each reopening has a "
                "re-close.",
                why="The statement says only the named role reopens and each reopening is logged; "
                "an unlogged or unauthorized reopening defeats the lock.",
                extract=("Reopenings", "By whom", "Re-close"),
                compare="Each reopening's user against the role; each against its re-close.",
                passes="All by the role, logged, and re-closed, or no reopening.",
                fails="A reopening by someone else, or a period left open.",
                insufficient="No change log of the period table.",
                review="The log does not identify the user.",
                not_infer="Do not infer no reopenings from the absence of a log.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac06", "posting period"),
    ),
)

# ITAC-07 Manual journal entries above the threshold need approval

ITAC_JE_WORKFLOW = _automated(
    library_key="itac-je-workflow",
    control_ref="ITAC-07",
    prefix="itac07",
    objective="No manual journal entry above the threshold posts without an approval by "
    "someone other than its preparer.",
    trigger="a manual journal entry above the threshold awaiting approval",
    design_doc=(
        "Journal entry policy and the approved workflow design",
        (
            "The approval threshold",
            "Approver roles",
            "Rule that the preparer cannot approve",
            "Rule that posting waits for approval",
            "Approval of the design",
        ),
    ),
    values="the journal entry approval threshold",
    configuration=(
        "Journal entry workflow configuration as shown from the system",
        (
            "Threshold",
            "Approver roles",
            "Preparer-approver separation",
            "Posting blocked until approval",
            "Document types covered",
        ),
    ),
    instance=(
        "A manual journal entry held until approved",
        "SYSTEM_SCREEN",
        ("The entry and its amount", "Preparer", "Approver and approval time", "Posting time"),
        "An entry approved on a cover sheet.",
    ),
    addresses="every manual document type is in the workflow; the threshold equals the "
    "policy's; the preparer cannot approve their own entry; and the entry cannot post before "
    "approval.",
    compare_step=(
        "Compare the workflow's threshold, approver roles, preparer-approver "
        "separation, and document types with the policy.",
        "Each configured value against the policy's.",
        "A threshold above the policy's, a missing separation, a document type "
        "outside the workflow, or posting possible before approval is an exception; "
        "where the threshold is not provided the attribute waits for the client's "
        "value.",
    ),
    instance_step=(
        "Inspect one manual entry above the threshold: its preparer, the approver, "
        "the approval time, and the posting time.",
        "Entry, amount, preparer, approver, approval time, posting time.",
        "An entry posted before approval, or approved by its preparer, is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac07-criteria",
            dict(
                text="The workflow routes every manual journal entry above [the journal entry "
                "approval threshold] to an approver other than the preparer and blocks posting "
                "until approved",
                evidence_keys=("itac07-e2", "itac07-e1"),
                condition="Threshold, separation, and posting block configured as the policy "
                "states, for every manual document type.",
                why="The control enforces the policy's threshold; the threshold is the client's.",
                extract=("Threshold", "Separation", "Posting block", "Document types"),
                compare="Configured against the policy.",
                passes="Equal, with separation and the block.",
                fails="A higher threshold, no separation, or posting before approval.",
                insufficient="The threshold is not provided.",
                review="Different thresholds by company code.",
                not_infer="Do not assume the threshold from the configuration.",
                basis=("DESIGN",),
                confidence="LOW",
                question="What approval threshold does the journal entry policy set for the "
                "system's workflow?",
                blocks=True,
            ),
        ),
        (
            "itac07-operates",
            dict(
                text="A manual journal entry above the threshold was approved by someone other "
                "than "
                "its preparer before it posted",
                evidence_keys=("itac07-e3", "itac07-e2"),
                condition="Approver differs from preparer; approval time before posting time.",
                why="Shows the configuration operates.",
                extract=("Preparer", "Approver", "Approval time", "Posting time"),
                compare="Approver against preparer; times.",
                passes="Approved by another first.",
                fails="Posted first, or self-approved.",
                insufficient="No instance is available.",
                review="The instance is a recurring entry the policy exempts.",
                not_infer="A signed cover sheet shows nothing about the system.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac07", "journal workflow"),
    ),
)

# ITAC-08 Prices come from the price master

ITAC_PRICE_MASTER = _automated(
    library_key="itac-price-master",
    control_ref="ITAC-08",
    prefix="itac08",
    objective="Sales are priced from the approved price master, and an override beyond the "
    "limit needs approval in the system.",
    trigger="a sales order line priced from the master, or an override held for approval",
    design_doc=(
        "Pricing policy and the approved pricing configuration design",
        (
            "Price source for each order type",
            "Override or discount limit without approval",
            "Approver role",
            "Approval of the design",
        ),
    ),
    values="the discount or override limit without approval and the role that approves "
    "price overrides",
    configuration=(
        "Pricing configuration as shown from the system",
        (
            "Price source per order type",
            "Override permission",
            "Discount limit",
            "Approval block for overrides beyond the limit",
            "Approver role",
        ),
    ),
    instance=(
        "A sales order with an override held for approval",
        "SYSTEM_SCREEN",
        (
            "The order line, master price, and entered price",
            "The system's hold",
            "Approver and approval time",
        ),
        "A discount approved by email after shipment.",
    ),
    addresses="every order type in scope prices from the master; a user cannot type a price "
    "below the limit without the system holding the line; the limit and approver role equal "
    "the policy; and the price master itself is changed only under the master data control.",
    compare_step=(
        "Compare the pricing configuration, order type by order type, with the "
        "policy: the price source, the override permission, the limit, and the "
        "approver role.",
        "Per order type: each configured value against the policy.",
        "An order type priced by hand, a limit above the policy's, or an approver "
        "role that differs is an exception; where the limit is not provided the "
        "attribute waits for the client's value.",
    ),
    instance_step=(
        "Inspect one order line whose entered price exceeded the limit: the master "
        "price, the entered price, the hold, and the approval.",
        "Order, master price, entered price, hold, approver, approval time.",
        "A line saved beyond the limit without a hold is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac08-criteria",
            dict(
                text="Every order type in scope prices from the price master, and an override or "
                "discount beyond [the discount or override limit without approval] is held for "
                "approval by the configured approver role",
                evidence_keys=("itac08-e2", "itac08-e1"),
                condition="Price source, limit, hold, and approver role configured as the policy "
                "states.",
                why="The control enforces the policy's limit; the limit is the client's.",
                extract=("Price source", "Limit", "Approver role"),
                compare="Configured against the policy.",
                passes="Equal.",
                fails="A hand-priced order type, a higher limit, or no hold.",
                insufficient="The limit is not provided.",
                review="Different limits by customer group.",
                not_infer="Do not assume the limit from the configuration.",
                basis=("DESIGN",),
                confidence="LOW",
                question="What discount or override limit may a sales user apply without approval, "
                "and who approves beyond it?",
                blocks=True,
            ),
        ),
        (
            "itac08-operates",
            dict(
                text="An order line priced beyond the limit was held by the system until the "
                "configured approver approved it",
                evidence_keys=("itac08-e3", "itac08-e2"),
                condition="A hold on an instance in the window, released by the approver role.",
                why="Shows the configuration operates.",
                extract=("Master price", "Entered price", "Hold", "Approver"),
                compare="The hold and approver against the configuration.",
                passes="Held and approved by the role.",
                fails="Saved without a hold, or released by another role.",
                insufficient="No instance is available.",
                review="The override was within a customer-specific agreement.",
                not_infer="An email approval shows nothing about the system.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac08", "pricing"),
    ),
)

# ITAC-09 Shipments are billed once

ITAC_SHIP_TO_BILL = _automated(
    library_key="itac-ship-to-bill",
    control_ref="ITAC-09",
    prefix="itac09",
    objective="Every shipment or service confirmation is invoiced exactly once.",
    trigger="a goods issue or service confirmation picked up by the billing run",
    design_doc=(
        "Billing design: what is billing-relevant, the billing run, and the duplicate check",
        (
            "Billing relevance per document type",
            "The billing run and its schedule",
            "Rule that a shipment cannot be invoiced twice",
            "Approval of the design",
        ),
    ),
    values="the billing run that creates invoices",
    configuration=(
        "Billing configuration as shown from the system",
        (
            "Billing relevance per item category",
            "Billing run schedule and selection",
            "Duplicate billing check",
        ),
    ),
    instance=(
        "One shipment traced to its single invoice, and the billing due list after a run",
        "SYSTEM_REPORT",
        (
            "The goods issue",
            "The invoice created from it",
            "The billing due list after the run with the items still unbilled",
        ),
        "A list of invoices without the shipments they came from.",
    ),
    addresses="every billable document type is billing-relevant; the billing run picks up "
    "every open billable item on its schedule; a shipment already invoiced is not picked up "
    "again; and an item left unbilled stays visible on the due list.",
    compare_step=(
        "Compare the billing relevance per item category, the run's schedule and "
        "selection, and the duplicate check with the billing design.",
        "Each configured value against the design.",
        "A billable item category not billing-relevant, a run that excludes a sales "
        "area, or no duplicate check is an exception.",
    ),
    instance_step=(
        "Trace one goods issue in the window to its invoice; confirm no second "
        "invoice exists for it; inspect the billing due list after the run for items "
        "older than the run.",
        "Goods issue, invoice, the search for a second invoice, and the due list.",
        "A shipment with no invoice after the run, or with two, is an exception; "
        "items aged on the due list are listed for the revenue cut-off review.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac09-config",
            dict(
                text="Every billable document type is configured as billing-relevant, the billing "
                "run selects every open billable item on its schedule, and a shipment already "
                "invoiced cannot be invoiced again",
                evidence_keys=("itac09-e2", "itac09-e1"),
                condition="Relevance, run selection, and duplicate check equal the design.",
                why="The control is the configuration.",
                extract=("Relevance", "Run schedule and selection", "Duplicate check"),
                compare="Configured against the design.",
                passes="Equal.",
                fails="An uncovered item category, an excluded area, or no duplicate check.",
                insufficient="The configuration is not shown from the system.",
                review="Item categories billed under a separate contract process.",
                not_infer="Do not assume the vendor's defaults.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac09-operates",
            dict(
                text="A shipment in the window was invoiced once by the billing run, and the "
                "billing due list after the run shows no shipment older than the run",
                evidence_keys=("itac09-e3", "itac09-e2"),
                condition="One invoice per traced shipment; no aged item on the due list.",
                why="Shows the configuration operates.",
                extract=("Goods issue", "Invoice", "Second invoice search", "Due list"),
                compare="Shipment against invoices; due list against the run date.",
                passes="One invoice, nothing aged.",
                fails="No invoice, two invoices, or aged unbilled items.",
                insufficient="The due list after the run is not provided.",
                review="Aged items held for a documented billing block.",
                not_infer="An invoice listing alone does not show every shipment was billed.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac09", "billing"),
    ),
)

# ITAC-10 Depreciation is calculated by the system

ITAC_DEPRECIATION = _automated(
    library_key="itac-depreciation-calc",
    control_ref="ITAC-10",
    prefix="itac10",
    objective="Depreciation is calculated for every asset from its class's configured method "
    "and life, and posted each period.",
    trigger="the period's depreciation run",
    design_doc=(
        "Fixed asset accounting policy: methods and useful lives by asset class",
        (
            "Asset classes in scope",
            "Method and useful life per class",
            "Posting frequency",
            "Approval of the policy",
        ),
    ),
    values="the asset classes and depreciation keys in scope",
    configuration=(
        "Depreciation configuration as shown from the system",
        ("Asset class", "Depreciation key", "Method", "Useful life", "Posting frequency"),
    ),
    instance=(
        "One asset's depreciation recalculated, and the period's depreciation run log",
        "SYSTEM_REPORT",
        (
            "The asset's cost, capitalization date, class, and life",
            "The period's depreciation posted",
            "The run log with assets processed and errors",
        ),
        "A depreciation schedule kept in a spreadsheet.",
    ),
    addresses="every asset class in scope has a key whose method and life equal the policy; "
    "the run posts each period for every asset with a capitalization date; and errors on "
    "the run are resolved before the close.",
    compare_step=(
        "Compare the depreciation key's method and useful life, class by class, with the policy.",
        "Per class: configured method and life against the policy.",
        "A class whose method or life differs from the policy is an exception; a "
        "class with no key is recorded for a person.",
    ),
    instance_step=(
        "Recalculate one asset's period depreciation from its cost, capitalization "
        "date, class method, and life, and agree it to the amount the run posted; "
        "inspect the run log for errors.",
        "Asset, inputs, recalculated amount, posted amount, and the run's errors.",
        "A difference beyond rounding is an exception; an unresolved run error is "
        "an exception for the assets it affects.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac10-config",
            dict(
                text="Each asset class in scope has a depreciation key whose method and useful "
                "life "
                "equal the fixed asset accounting policy, posting each period",
                evidence_keys=("itac10-e2", "itac10-e1"),
                condition="Method, life, and frequency per class equal the policy.",
                why="The control is the configuration.",
                extract=("Class", "Method", "Life", "Frequency"),
                compare="Configured against the policy.",
                passes="Equal for every class.",
                fails="A class whose method or life differs.",
                insufficient="The policy does not state the life per class.",
                review="A class whose life the policy gives as a range.",
                not_infer="Do not take the system's defaults as the policy.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac10-operates",
            dict(
                text="The depreciation the run posted for an asset equals a recalculation from its "
                "cost, capitalization date, and class, and the run processed every asset without "
                "unresolved errors",
                evidence_keys=("itac10-e3", "itac10-e2"),
                condition="Recalculated amount equals posted amount; the run log shows no "
                "unresolved error.",
                why="Shows the configuration operates.",
                extract=("Inputs", "Recalculated", "Posted", "Run errors"),
                compare="Recalculated against posted; errors against resolutions.",
                passes="Equal, with no unresolved error.",
                fails="A difference beyond rounding, or an unresolved error.",
                insufficient="The run log is not provided.",
                review="A mid-period acquisition convention the policy does not state.",
                not_infer="A spreadsheet schedule is not the system's calculation.",
                basis=("DESIGN", "AS1105.15"),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac10", "depreciation"),
    ),
)

# ITAC-11 Payroll is calculated by the system

ITAC_PAYROLL_CALC = _automated(
    library_key="itac-payroll-calc",
    control_ref="ITAC-11",
    prefix="itac11",
    objective="Each employee's gross pay, deductions, and net pay are calculated from the "
    "configured pay rules and statutory tables.",
    trigger="a payroll run",
    design_doc=(
        "Pay rules and statutory table sources in scope",
        (
            "Pay rules (overtime, allowances, deductions)",
            "Statutory tables and their source and effective dates",
            "Approval of the rules",
        ),
    ),
    values="the pay rules and statutory tables in scope",
    configuration=(
        "Pay rule and tax table configuration as shown from the system",
        ("Rule", "Rate or formula", "Effective date", "Statutory table version"),
    ),
    instance=(
        "One employee's pay recalculated, and the payroll run log",
        "SYSTEM_REPORT",
        (
            "The employee's master data and time",
            "Gross, deductions, and net per the register",
            "The run log with employees processed and errors",
        ),
        "A payroll summary without the inputs.",
    ),
    addresses="the configured rules equal the approved pay rules; the statutory tables are "
    "the current published ones; the run processes every active employee; and errors are "
    "resolved before payment.",
    compare_step=(
        "Compare each configured pay rule with the approved rules and each "
        "statutory table version with the published source for the period.",
        "Per rule and table: configured against approved or published.",
        "A rule that differs from the approved one, or an out-of-date statutory "
        "table, is an exception.",
    ),
    instance_step=(
        "Recalculate one employee's gross, deductions, and net from their master "
        "data, time, the rules, and the tables, and agree to the register; inspect "
        "the run log for errors.",
        "Employee, inputs, recalculated amounts, register amounts, and run errors.",
        "A difference beyond rounding, or an unresolved run error, is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac11-config",
            dict(
                text="The configured pay rules equal the approved rules and the statutory tables "
                "in "
                "the system are the published versions in force for the period",
                evidence_keys=("itac11-e2", "itac11-e1"),
                condition="Rules equal the approved ones; table versions equal the published ones.",
                why="The control is the configuration.",
                extract=("Rules", "Table versions", "Effective dates"),
                compare="Configured against approved and published.",
                passes="Equal and current.",
                fails="A differing rule or an outdated table.",
                insufficient="The approved rules are not provided.",
                review="A statutory change effective mid-period.",
                not_infer="Do not take the vendor's delivered tables as approved.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac11-operates",
            dict(
                text="An employee's gross pay, deductions, and net pay on the register equal a "
                "recalculation from their master data, time, the rules, and the tables, and the "
                "run processed every active employee without unresolved errors",
                evidence_keys=("itac11-e3", "itac11-e2"),
                condition="Recalculated amounts equal the register; no unresolved run error.",
                why="Shows the configuration operates.",
                extract=("Inputs", "Recalculated", "Register", "Run errors"),
                compare="Recalculated against the register; errors against resolutions.",
                passes="Equal, with no unresolved error.",
                fails="A difference beyond rounding, or an unresolved error.",
                insufficient="The inputs or the run log are not provided.",
                review="A retroactive adjustment in the run.",
                not_infer="The register's totals agreeing to the ledger is a different control.",
                basis=("DESIGN", "AS1105.15"),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac11", "pay rule and tax table"),
    ),
)

# ITAC-12 Postings are validated

ITAC_POSTING_VALIDATION = _automated(
    library_key="itac-posting-validation",
    control_ref="ITAC-12",
    prefix="itac12",
    objective="A journal line that lacks a required field, uses an invalid account or cost "
    "object, or leaves the document unbalanced is rejected.",
    trigger="a posting that breaches a validation rule",
    design_doc=(
        "Posting validation rules in scope",
        (
            "Required fields per document type",
            "Account and cost object validity checks",
            "Document balance check",
            "Approval of the rules",
        ),
    ),
    values="the posting validation rules in scope",
    configuration=(
        "Validation configuration as shown from the system",
        (
            "Rule",
            "Fields required",
            "Account and cost object checks",
            "Balance check",
            "Active per company code",
        ),
    ),
    instance=(
        "A posting rejected by a validation rule",
        "SYSTEM_SCREEN",
        ("The document attempted", "The rule breached", "The system's rejection", "Date"),
        "A posting corrected by the accountant before entry.",
    ),
    addresses="every rule in scope is active for every company code; a breach is rejected, "
    "not warned; the account and cost object checks use the current master data; and the "
    "balance check cannot be bypassed.",
    compare_step=(
        "Compare each configured validation with the rules in scope: the fields "
        "required, the checks, the balance rule, and the company codes it is active "
        "for.",
        "Per rule: configured against the rules in scope.",
        "A rule inactive for a company code, a check missing, or a warning instead "
        "of a rejection is an exception; where the rules in scope are not provided "
        "the attribute waits for the client's value.",
    ),
    instance_step=(
        "Inspect one posting the system rejected under a rule in scope: the "
        "document, the rule, and the rejection.",
        "Document, rule, rejection, date.",
        "No instance in the window is recorded as untested on this attribute; a "
        "warning the user could bypass is an exception.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac12-criteria",
            dict(
                text="Every validation in [the posting validation rules in scope] is active for "
                "each company code and rejects, rather than warns on, a breach",
                evidence_keys=("itac12-e2", "itac12-e1"),
                condition="Each rule active everywhere in scope, rejecting.",
                why="The control is the configuration; which rules are in scope is the client's.",
                extract=("Rules", "Company codes", "Action"),
                compare="Configured against the rules in scope.",
                passes="All active and rejecting.",
                fails="A rule inactive somewhere, or warning only.",
                insufficient="The rules in scope are not provided.",
                review="A rule set to warn by a documented design decision.",
                not_infer="Do not assume the rules from the configuration.",
                basis=("DESIGN",),
                confidence="LOW",
                question="Which posting validation rules (required fields, account and cost object "
                "checks, balance) are in scope for the system?",
                blocks=True,
            ),
        ),
        (
            "itac12-operates",
            dict(
                text="A posting that breached a rule in scope was rejected by the system",
                evidence_keys=("itac12-e3", "itac12-e2"),
                condition="An instance in the window shows the rejection.",
                why="Shows the configuration operates.",
                extract=("Document", "Rule", "Rejection"),
                compare="The breach against the rule and the action.",
                passes="Rejected.",
                fails="Posted, or warned only.",
                insufficient="No instance is available.",
                review="The instance breached a rule outside the scope.",
                not_infer="A correction made by a person shows nothing about the system.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac12", "validation"),
    ),
)

# ITAC-13 Interface totals are checked

ITAC_INTERFACE_TOTALS = _automated(
    library_key="itac-interface-totals",
    control_ref="ITAC-13",
    prefix="itac13",
    objective="A batch posts from the source system only when its record count and control "
    "total agree with what was sent; a mismatch is held.",
    trigger="an interface batch received from the source system",
    design_doc=(
        "Interface design: the count and total checks and the error queue",
        (
            "Fields compared (count, total)",
            "Action on mismatch (hold in error queue)",
            "Who works the queue",
            "Approval of the design",
        ),
    ),
    values="the source system of the interface and the role that resolves interface errors",
    configuration=(
        "Interface control configuration as shown from the tool",
        ("Count check", "Total check", "Action on mismatch", "Error queue assignment"),
    ),
    instance=(
        "One mismatched batch held in the error queue, and one batch posted with its counts",
        "SYSTEM_REPORT",
        (
            "Batch, records sent and received, totals",
            "The hold or the posting",
            "The queue entry and its resolution",
        ),
        "A run log of statuses without counts.",
    ),
    addresses="the interface compares both count and control total; a mismatch holds the "
    "whole batch rather than posting the records that arrived; the queue is worked by the "
    "named role; and nothing in the queue is posted by hand without the counts agreeing.",
    compare_step=(
        "Compare the configured checks and the action on mismatch with the interface design.",
        "Count check, total check, action, and queue assignment against the design.",
        "A missing total check, a mismatch that posts, or an unassigned queue is an exception.",
    ),
    instance_step=(
        "Inspect one batch the tool held for a mismatch and its resolution, and one "
        "batch it posted with sent and received counts equal.",
        "Both batches with counts, totals, action, and resolution.",
        "A mismatched batch that posted, or a held batch posted by hand without "
        "agreement, is an exception; no held batch in the window is recorded as "
        "untested on that part.",
    ),
    extra_evidence=(),
    extra_steps=(),
    attributes=(
        (
            "itac13-config",
            dict(
                text="The interface compares record counts and control totals between sent and "
                "received on each run and holds a mismatched batch in the error queue for the "
                "named role",
                evidence_keys=("itac13-e2", "itac13-e1"),
                condition="Count and total checks on; mismatch holds; queue assigned.",
                why="The control is the configuration.",
                extract=("Checks", "Action", "Queue"),
                compare="Configured against the design.",
                passes="Both checks, hold, assigned.",
                fails="A check off, a mismatch that posts, or no assignment.",
                insufficient="The configuration is not shown from the tool.",
                review="A count check only, for non-financial records.",
                not_infer="Do not take the design document as the configuration.",
                basis=("DESIGN", "AS2201.B28"),
                confidence="HIGH",
            ),
        ),
        (
            "itac13-operates",
            dict(
                text="A batch with a mismatch was held in the error queue and resolved before "
                "posting, and a batch with agreeing counts and totals posted",
                evidence_keys=("itac13-e3", "itac13-e2"),
                condition="The held batch did not post until resolved; the agreeing batch posted.",
                why="Shows the configuration operates.",
                extract=("Counts", "Totals", "Action", "Resolution"),
                compare="Each batch's counts against its action.",
                passes="Held and resolved; agreeing posted.",
                fails="A mismatch posted, or a held batch posted by hand.",
                insufficient="No held batch in the window.",
                review="A batch resolved by correcting the source and resending.",
                not_infer="A status log without counts shows nothing.",
                basis=("DESIGN",),
                confidence="HIGH",
            ),
        ),
        _unchanged("itac13", "interface control"),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    ITAC_DUPLICATE_INVOICE,
    ITAC_PO_WORKFLOW,
    ITAC_NONPO_ROUTING,
    ITAC_PERIOD_LOCK,
    ITAC_JE_WORKFLOW,
    ITAC_PRICE_MASTER,
    ITAC_SHIP_TO_BILL,
    ITAC_DEPRECIATION,
    ITAC_PAYROLL_CALC,
    ITAC_POSTING_VALIDATION,
    ITAC_INTERFACE_TOTALS,
)
