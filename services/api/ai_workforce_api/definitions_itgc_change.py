"""Version 4 testing definitions for the change management controls (ITGC-CM-01 to -05).
See definitions_itgc_access.py for the conventions."""

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
    obtain_population,
    read_design,
    select_sample,
    step,
    update_sample,
    validate_population,
    walkthrough,
)
from ai_workforce_api.testing_definitions import Definition, Retired, sampling

# ITGC-CM-01 Changes are tested and approved

_CM01 = Suite(
    (
        ev(
            "cm01-e1",
            "Change management procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which changes it covers",
                "Testing required and where",
                "Who approves (business owner, IT approver) and before what",
                "How deployment is recorded",
            ),
        ),  # fmt: skip
        ev(
            "cm01-e2",
            "Walkthrough instance: one change from request to deployment",
            "TICKET",
            "The change manager",
            ("DESIGN",),
            "DESIGN",
            "One recent production change",
            ("The ticket", "Test results", "Approvals with dates", "The deployment record"),
        ),
        ev(
            "cm01-e3",
            "Production deployment log from the system",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested, from its first to its last day",
            (
                "Change or transport ID",
                "Object or version deployed",
                "Deployed by",
                "Deployment date and time",
                "Environment",
            ),
            completeness="From the system's own deployment, transport, or release records, not "
            "the ticketing tool; with the query, its parameters, the run date, and the record "
            "count; a selection of entries agreed both ways to the system.",
            not_acceptable="A list of closed change tickets: it misses deployments made without "
            "a ticket, which are what the control must catch.",
        ),  # fmt: skip
        ev(
            "cm01-e4",
            "Query parameters and record count for the deployment log",
            "SYSTEM_SCREEN",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the log",
            ("Query or report", "System and environment", "Date range", "Record count"),
            completeness="Shows the log covers the whole window and the production environment.",
        ),
        ev(
            "cm01-e5",
            "Change ticket for each selected deployment",
            "TICKET",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected deployment",
            ("Ticket ID", "Description and objects", "Requester", "Developer or implementer"),
            attributes=("cm01-request", "cm01-matches", "cm01-segregated"),
        ),
        ev(
            "cm01-e6",
            "Test evidence for each selected change",
            "DOCUMENT",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected deployment",
            ("Test cases or script", "Results", "Tester", "Test date", "Environment tested in"),
            not_acceptable="A 'tested' checkbox or status with no results attached.",
            attributes=("cm01-tested", "cm01-environment"),
        ),
        ev(
            "cm01-e7",
            "Approvals for each selected change",
            "SYSTEM_SCREEN",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected deployment",
            ("Approver and role", "Approval date and time", "What was approved"),
            not_acceptable="A workflow status of 'approved' without the approver and date.",
            attributes=("cm01-approved", "cm01-segregated"),
        ),
        ev(
            "cm01-e8",
            "Deployment record for each selected change",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected deployment",
            ("Object or version deployed", "Deployment date and time", "Deployed by"),
            attributes=("cm01-approved", "cm01-matches", "cm01-tested"),
        ),
        ev(
            "cm01-e9",
            "Business owners and IT approvers by system",
            "DOCUMENT",
            "The control owner for change management",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("System", "Business owner", "IT approver or board", "Delegations"),
            attributes=("cm01-approved",),
        ),
        ev(
            "cm01-e10",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for change management",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the tool, the approvers, or the deployment path",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_CM01_TESTED = (
    "cm01-request",
    "cm01-tested",
    "cm01-environment",
    "cm01-approved",
    "cm01-segregated",
    "cm01-matches",
)

CHANGE_APPROVAL = Definition(
    library_key="change-approval",
    control_ref="ITGC-CM-01",
    version=4,
    objective="Only tested changes approved by business and IT owners reach production.",
    control_type="PREVENTIVE",
    performer="The change implementer",
    reviewer="The business owner and the IT owner who approve",
    trigger="A change to the application, database, or infrastructure",
    population=(
        "Every change deployed to production in the period, from the deployment or change "
        "log of the system itself (not from the ticketing tool alone), with completeness "
        "support."
    ),
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM01.items,
    procedures=(
        _CM01.proc(
            "d-1",
            "DESIGN",
            "Understand the change path: what is tested, where, who approves, and how a "
            "deployment is recorded by the system.",
            "Read the change management procedure; identify the change types it covers, the "
            "testing and environments it requires, the approvers for each system, and the "
            "system record a deployment leaves.",
            (
                read_design("the change management procedure", ("cm01-e1",)),
                client_values(
                    "the change management tool, the IT approver for the system, and the "
                    "business owner for the system"
                ),
                information_used(
                    "the system's deployment or transport log the population comes from",
                    ("cm01-e3", "cm01-e4"),
                ),
            ),
        ),
        _CM01.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described by approvers with the "
            "authority it needs, addresses its risk and is implemented (AS 2201.42-.43).",
            "Walk one recent change from the request through testing and approval to the "
            "deployment record, asking the implementer and an approver what they check; confirm "
            "the approvers' authority and independence from development; assess whether testing "
            "and approval before deployment address the risk.",
            (
                walkthrough("a production change", ("cm01-e2",)),
                authority("the business owner and the IT approver"),
                assess_design(
                    "every production deployment is recorded by the system and tied to a "
                    "ticket; testing happens outside production with results kept; both "
                    "approvals are recorded before deployment by people who understand the "
                    "change and did not develop it; and the tool or the deployer prevents "
                    "deployment before approval."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM01.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of production deployments for the window.",
            "Obtain every deployment to production in the window from the system's own "
            "deployment or transport log, with the query's parameters and record count, and "
            "validate it against the system before any sample is selected.",
            (
                obtain_population("production deployments", ("cm01-e3", "cm01-e4")),
                validate_population(
                    "the system's transport or release history", ("cm01-e3", "cm01-e4")
                ),  # fmt: skip
            ),
        ),
        _CM01.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select deployments at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "production deployments"),),
        ),
        _CM01.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected change was requested, tested outside production, "
            "and approved by both owners before deployment, and is the change deployed.",
            "For each selected deployment, find the ticket, the test evidence, and the "
            "approvals; compare the approval dates with the deployment date; compare the "
            "approvers with the owners and with the developer; compare the deployed object or "
            "version with the ticket.",
            (
                step(
                    "Find the change ticket for the selected deployment and confirm it "
                    "describes the objects or version the deployment record shows.",
                    ("cm01-e5", "cm01-e8"),
                    "Ticket ID, its description and objects, and the deployment's objects.",
                    "A deployment with no ticket, or a ticket that cannot be linked to it other "
                    "than by a similar description, is an exception.",
                ),
                step(
                    "Inspect the test evidence: the cases, the results, the tester, the date, "
                    "and the environment; compare the test date with the deployment date.",
                    ("cm01-e6", "cm01-e8"),
                    "Test date, result, tester, environment, and the deployment date.",
                    "No results, testing after deployment, or testing in production is an "
                    "exception; a documented testing waiver is recorded for a person.",
                ),
                step(
                    "Identify each approver and compare with the business owner and the IT "
                    "approver for the system; compare each approval's date and time with the "
                    "deployment's.",
                    ("cm01-e7", "cm01-e9", "cm01-e8"),
                    "Each approver, their role, the owner of record, each approval timestamp, "
                    "and the deployment timestamp.",
                    "A missing approval, an approver who is not the owner of record, or an "
                    "approval after deployment is an exception.",
                ),
                step(
                    "Confirm that neither approver developed or implemented the change.",
                    ("cm01-e5", "cm01-e7"),
                    "The developer or implementer on the ticket and the approvers.",
                    "An approver who developed the change is an exception.",
                ),
                step(
                    "Compare the object or version in the deployment record with the one the "
                    "ticket approved, and confirm nothing beyond the ticket was deployed with it.",
                    ("cm01-e5", "cm01-e8"),
                    "Objects approved and objects deployed, side by side.",
                    "Something deployed that the ticket does not cover is an exception; a "
                    "deployment record that does not identify objects is insufficient evidence.",
                ),
            ),
            _CM01_TESTED,
        ),
        _CM01.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per change and attribute, cited to the evidence.",
            (evaluate_exceptions("change"), conclude("interim")),
        ),
        _CM01.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the tool, the approvers, or the deployment path "
            "changed since the interim date; obtain and validate the remaining period's "
            "deployments; test an update sample against the same attributes; record the "
            "results.",
            (
                inquire_changes(("cm01-e10",)),
                obtain_population(
                    "production deployments", ("cm01-e3", "cm01-e4"), "the remaining period"
                ),  # fmt: skip
                validate_population(
                    "the system's transport or release history", ("cm01-e3", "cm01-e4")
                ),  # fmt: skip
                update_sample("production deployments"),
                conclude("roll-forward"),
            ),
            _CM01_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM01.attr(
            "cm01-request",
            "A change request exists for the deployed change",
            ("cm01-e5", "cm01-e8"),
            condition="A ticket describes this change.",
            why="The description starts the control with a request.",
            extract=("Ticket ID", "Description"),
            compare="Ticket against the deployment.",
            passes="A ticket exists for it.",
            fails="A deployment with no ticket.",
            insufficient="The ticket is not provided.",
            review="The ticket cannot be linked to the deployment.",
            not_infer="Do not link by similar descriptions alone.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="A change request exists",
        ),
        _CM01.attr(
            "cm01-tested",
            "The change was tested before deployment, with the test results documented",
            ("cm01-e6", "cm01-e8"),
            condition="Test evidence dated before deployment.",
            why="The description requires testing.",
            extract=("Test date", "Result", "Tester"),
            compare="Test date against deployment date.",
            passes="Documented tests before deployment.",
            fails="No testing, or after deployment.",
            insufficient="Not provided.",
            review="Testing was waived under a documented exemption.",
            not_infer="A 'tested' checkbox without results is not test evidence.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The change was tested, with results documented",
        ),
        _CM01.attr(
            "cm01-environment",
            "The testing was performed in a non-production environment",
            ("cm01-e6",),
            condition="The test evidence names an environment other than production.",
            why="The statement says changes are tested in a non-production environment; a test "
            "in production is the change already deployed.",
            extract=("Environment tested in",),
            compare="The environment on the test evidence against the production environment.",
            passes="A non-production environment is named.",
            fails="Testing was performed in production.",
            insufficient="The test evidence does not name the environment.",
            review="The client has no non-production environment for this system.",
            not_infer="Do not assume the environment from the tester's team.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM01.attr(
            "cm01-approved",
            "The business owner and the IT owner approved the change before it was deployed "
            "to production",
            ("cm01-e7", "cm01-e9", "cm01-e8"),
            condition="Both approvals dated before the deployment.",
            why="The description requires approval by business and IT owners before production.",
            extract=("Approvers", "Approval dates", "Deployment date"),
            compare="Approval dates against the deployment date; approvers against owners.",
            passes="Both approved before deployment.",
            fails="An approval missing or after deployment.",
            insufficient="Approvals or the deployment date not provided.",
            review="Who the owners are for this system is not documented.",
            not_infer="An approval of a different ticket does not count.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The change was approved before deployment",
        ),
        _CM01.attr(
            "cm01-segregated",
            "Neither approver developed or implemented the change they approved",
            ("cm01-e5", "cm01-e7"),
            condition="The developer or implementer on the ticket is not an approver.",
            why="The statement requires approvers who did not develop the change; approving "
            "one's own change is not an independent approval.",
            extract=("Developer or implementer", "Approvers"),
            compare="The ticket's developer and implementer against the approvers.",
            passes="No approver developed or implemented the change.",
            fails="An approver is the developer or implementer.",
            insufficient="The ticket does not record who developed the change.",
            review="A small team where the IT approver manages the developers.",
            not_infer="Do not assume the requester is the developer.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's authority clause states the separation; an RCM description "
                "may not, so the attribute is marked as an inference.",
            ),  # fmt: skip
        ),
        _CM01.attr(
            "cm01-matches",
            "The object or version deployed is the one in the approved change request",
            ("cm01-e8", "cm01-e5"),
            condition="The deployment record's object or version equals the ticket's.",
            why="Approval covers what was approved, not something else deployed with it.",
            extract=("Object or version deployed", "Object or version approved"),
            compare="Deployed against approved.",
            passes="They match.",
            fails="Something else was deployed.",
            insufficient="No deployment record.",
            review="The deployment record does not identify objects.",
            not_infer="Do not infer the deployed content from the ticket.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The deployed change matches the approved change",
        ),
    ),
)

# ITGC-CM-02 Emergency changes are approved after the fact

_CM02 = Suite(
    (
        ev(
            "cm02-e1",
            "Emergency change procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "The criteria for an emergency change",
                "Who approves after deployment",
                "The number of days allowed for the retrospective approval",
                "How emergency changes are flagged in the tool",
            ),
            not_acceptable="A procedure that leaves 'emergency' to the requester's judgment "
            "without criteria.",
        ),  # fmt: skip
        ev(
            "cm02-e2",
            "Walkthrough instance: one emergency change from deployment to approval",
            "TICKET",
            "The change manager",
            ("DESIGN",),
            "DESIGN",
            "One recent emergency change",
            ("The ticket with its reason", "The deployment record", "The retrospective approval"),
        ),
        ev(
            "cm02-e3",
            "Listing of emergency changes from the change tool",
            "SYSTEM_REPORT",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Change ID", "Emergency flag or type", "Deployment date", "Approval date", "Approver"),
            completeness="With the query, its parameters, the run date, and the record count; "
            "agreed to the production deployment log's entries flagged or deployed outside the "
            "normal release path, so that an emergency change not flagged as one is found.",
            not_acceptable="A list the change manager keeps by hand.",
        ),  # fmt: skip
        ev(
            "cm02-e4",
            "Production deployment log entries outside the normal release path",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            ("Deployment ID", "Deployment date", "Release or path", "Deployed by"),
            completeness="Shows how emergency changes are identified from the system's own "
            "records, not only from the tool's flag.",
        ),
        ev(
            "cm02-e5",
            "Emergency change ticket for each selected change",
            "TICKET",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected emergency change",
            ("Ticket ID", "Stated reason", "Implementer", "Objects changed"),
            attributes=("cm02-classified", "cm02-record", "cm02-independent"),
        ),
        ev(
            "cm02-e6",
            "Retrospective approval for each selected change",
            "SYSTEM_SCREEN",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected emergency change",
            ("Approver and role", "Approval date and time", "What was reviewed"),
            not_acceptable="The implementer's own closure note.",
            attributes=("cm02-reviewed", "cm02-approved", "cm02-independent"),
        ),
        ev(
            "cm02-e7",
            "Deployment record for each selected change",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected emergency change",
            ("Objects deployed", "Deployment date and time", "Deployed by"),
            attributes=("cm02-record", "cm02-approved"),
        ),
        ev(
            "cm02-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for change management",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            ("Changes to the criteria, the approver, or the tool", "Documentation of each change"),
        ),  # fmt: skip
    )
)

_CM02_TESTED = ("cm02-record", "cm02-reviewed", "cm02-independent")

CHANGE_EMERGENCY = Definition(
    library_key="change-emergency",
    control_ref="ITGC-CM-02",
    version=4,
    objective="Emergency changes are approved after the fact within the agreed time.",
    control_type="DETECTIVE",
    performer="The change implementer",
    reviewer="The approver of the retrospective review",
    trigger="An emergency change",
    population="Every change marked emergency in the period, with completeness support for "
    "how emergency changes are identified.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM02.items,
    procedures=(
        _CM02.proc(
            "d-1",
            "DESIGN",
            "Understand what qualifies as an emergency change, who approves it afterwards, and "
            "within what time.",
            "Read the emergency change procedure; record its criteria, the approver, the days "
            "allowed for retrospective approval, and how the tool flags an emergency change.",
            (
                read_design("the emergency change procedure", ("cm02-e1",)),
                client_values(
                    "the criteria for an emergency change, the approver of emergency changes, "
                    "and the number of days allowed for retrospective approval"
                ),
                information_used("the emergency change listing", ("cm02-e3", "cm02-e4")),
            ),
        ),
        _CM02.proc(
            "d-2",
            "DESIGN",
            "Determine whether the retrospective approval, performed as described, addresses "
            "the risk of the emergency path and is implemented (AS 2201.42-.43).",
            "Walk one emergency change from its deployment to its retrospective approval, "
            "asking the approver what they review; confirm the approver's authority and "
            "independence from the implementer; assess whether the criteria and the approval "
            "within the period address the risk.",
            (
                walkthrough("an emergency change", ("cm02-e2",)),
                authority("the approver of emergency changes"),
                assess_design(
                    "the criteria limit the emergency path to what cannot wait; every emergency "
                    "deployment is flagged or otherwise found from the system's records; an "
                    "approver who did not make the change reviews it within the agreed days; "
                    "and a change that did not meet the criteria is escalated."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM02.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of emergency changes for the window.",
            "Obtain the emergency changes in the window from the change tool, with the query's "
            "parameters and record count, and agree them to the deployment log's entries outside "
            "the normal release path, so that an unflagged emergency change is found.",
            (
                obtain_population("emergency changes", ("cm02-e3",)),
                validate_population(
                    "the production deployment log's entries outside the normal release path",
                    ("cm02-e3", "cm02-e4"),
                ),
            ),
        ),
        _CM02.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select emergency changes at random from the validated population, with the firm's "
            "size for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "emergency changes"),),
        ),
        _CM02.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected emergency change has a record, met the criteria, "
            "and was reviewed and approved after deployment by an independent approver within "
            "the period.",
            "For each selected change, find its ticket and deployment record; compare the stated "
            "reason with the emergency criteria; find the retrospective approval, compare the "
            "approver with the procedure and the implementer, and compare the approval date with "
            "the deployment date and the agreed period.",
            (
                step(
                    "Find the ticket for the selected emergency change and confirm it "
                    "identifies the objects the deployment record shows.",
                    ("cm02-e5", "cm02-e7"),
                    "Ticket ID, objects on the ticket, and objects deployed.",
                    "An emergency deployment with no ticket is an exception.",
                ),
                step(
                    "Compare the ticket's stated reason with the procedure's emergency criteria.",
                    ("cm02-e5", "cm02-e1"),
                    "The reason and the criterion it meets, or does not.",
                    "A reason that does not meet the criteria is an exception; where no "
                    "criteria are written, the attribute waits for the client's value.",
                ),
                step(
                    "Find the retrospective approval: the approver, their role, and the date and "
                    "time; compare the approver with the one the procedure names and with the "
                    "implementer.",
                    ("cm02-e6", "cm02-e5"),
                    "Approver, role, approval timestamp, the procedure's approver, and the "
                    "implementer.",
                    "No retrospective approval, or approval by the implementer, is an exception.",
                ),
                step(
                    "Compute the days from the deployment date to the approval date, in the "
                    "units the procedure uses, and compare with the agreed period.",
                    ("cm02-e7", "cm02-e6"),
                    "Deployment date, approval date, days between, and the agreed period.",
                    "Approval later than the period is an exception; where the period is not "
                    "recorded the attribute waits for the client's value.",
                ),
            ),
            (
                "cm02-record",
                "cm02-classified",
                "cm02-reviewed",
                "cm02-independent",
                "cm02-approved",
            ),  # fmt: skip
        ),
        _CM02.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per change and attribute, cited to the evidence.",
            (evaluate_exceptions("emergency change"), conclude("interim")),
        ),
        _CM02.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the criteria, the approver, or the tool changed since the "
            "interim date; obtain and validate the remaining period's emergency changes; test an "
            "update sample against the same attributes; record the results.",
            (
                inquire_changes(("cm02-e8",)),
                obtain_population("emergency changes", ("cm02-e3",), "the remaining period"),
                validate_population(
                    "the production deployment log's entries outside the normal release path",
                    ("cm02-e3", "cm02-e4"),
                ),
                update_sample("emergency changes"),
                conclude("roll-forward"),
            ),
            _CM02_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM02.attr(
            "cm02-record",
            "The emergency change has a ticket in the change tool that identifies the objects "
            "deployed",
            ("cm02-e5", "cm02-e7"),
            condition="A ticket exists and names the objects the deployment record shows.",
            why="The statement says each emergency change is reviewed in the change tool; a "
            "deployment with no ticket cannot be reviewed.",
            extract=("Ticket ID", "Objects on the ticket", "Objects deployed"),
            compare="The ticket's objects against the deployment record.",
            passes="A ticket names the deployed objects.",
            fails="No ticket, or a ticket for different objects.",
            insufficient="The deployment record does not identify objects.",
            review="The ticket was raised after deployment by someone other than the implementer.",
            not_infer="Do not link a ticket to a deployment by date alone.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM02.attr(
            "cm02-classified",
            "The change met the procedure's criteria for an emergency change",
            ("cm02-e5", "cm02-e1"),
            condition="The ticket documents a reason that meets the written criteria.",
            why="A change wrongly treated as an emergency skips pre-approval.",
            extract=("Reason", "Criteria"),
            compare="Reason against criteria.",
            passes="The reason meets the criteria.",
            fails="It does not.",
            insufficient="No reason documented.",
            review="No written criteria: whether it was an emergency is judgment.",
            not_infer="Urgency stated by the requester is not the criteria.",
            basis=("DESIGN",),
            confidence="LOW",
            question="What criteria does the client's procedure use for an emergency change?",
            was="The change was correctly classified as an emergency",
        ),
        _CM02.attr(
            "cm02-reviewed",
            "The emergency change was reviewed and approved after deployment by an approver "
            "the emergency change procedure names",
            ("cm02-e6",),
            condition="A retrospective approval exists, by a named approver, after deployment.",
            why="The description requires emergency changes to be reviewed and approved after "
            "deployment.",
            extract=("Approver", "Approval date"),
            compare="Approver against the procedure; the approval exists.",
            passes="Approved after deployment by a named approver.",
            fails="No retrospective approval.",
            insufficient="Approval not provided.",
            review="The procedure does not name approvers.",
            not_infer="The implementer's own sign-off is not the review.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM02.attr(
            "cm02-independent",
            "The retrospective approver did not make the emergency change",
            ("cm02-e6", "cm02-e5"),
            condition="The approver differs from the implementer on the ticket and the deployer.",
            why="The statement says the approver must not have made the change; a review by "
            "the implementer reviews nothing.",
            extract=("Approver", "Implementer", "Deployed by"),
            compare="The approver against the implementer and the deployer.",
            passes="The approver is neither.",
            fails="The implementer or deployer approved their own change.",
            insufficient="The ticket does not record the implementer.",
            review="The deployment was made under a shared account.",
            not_infer="Do not assume the approver's independence from their title.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's authority clause states the separation; an RCM description "
                "may not, so the attribute is marked as an inference.",
            ),  # fmt: skip
        ),
        _CM02.attr(
            "cm02-approved",
            "The retrospective approval was given within [the number of days in the "
            "emergency change procedure] of deployment",
            ("cm02-e7", "cm02-e6"),
            condition="Approval date minus deployment date is within the agreed period.",
            why="The description requires approval within the agreed days.",
            extract=("Approval date", "Deployment date", "Agreed days"),
            compare="Days between deployment and approval against the agreed period.",
            passes="Within the period.",
            fails="Late or missing.",
            insufficient="Dates not provided.",
            review="The period is not provided.",
            not_infer="Do not assume a period.",
            basis=("DESIGN",),
            confidence="LOW",
            question="How many days after deployment does the procedure allow for "
            "retrospective approval?",
            blocks=True,
            was="Retrospective approval was obtained within the agreed timeframe",
        ),
    ),
)

# ITGC-CM-03 Production deployment access is reviewed

_CM03 = Suite(
    (
        ev(
            "cm03-e1",
            "Deployment access procedure and the quarterly review procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Who may hold deployment access (the authorized group)",
                "Who reviews it each quarter",
                "How developers are identified",
                "How a conflict is resolved",
            ),
        ),  # fmt: skip
        ev(
            "cm03-e2",
            "Walkthrough instance: one quarterly review with its listings and removals",
            "DOCUMENT",
            "The reviewer of deployment access",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            (
                "The deployment access listing",
                "The developer listing",
                "The comparison and sign-off",
                "Removals",
            ),
        ),  # fmt: skip
        ev(
            "cm03-e3",
            "Schedule of quarterly reviews performed in the window",
            "DOCUMENT",
            "The control owner for change management",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters ending in the window",
            ("Quarter", "Reviewer", "Sign-off date"),
            completeness="One review is expected per quarter; the schedule is agreed to that "
            "expectation and to the sign-offs.",
        ),
        ev(
            "cm03-e4",
            "Production deployment access listing each selected review covered",
            "SYSTEM_REPORT",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "User",
                "Role or permission that allows deployment",
                "Report and parameters",
                "Date produced",
                "Record count",
            ),
            completeness="Agreed to the system's holders of each deployment role or permission "
            "at the production date, including service accounts that deploy.",
            attributes=("cm03-listing",),
        ),  # fmt: skip
        ev(
            "cm03-e5",
            "System list of deployment roles and their holders at each production date",
            "SYSTEM_REPORT",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected review's listing",
            ("Role or permission", "Holders", "Account type"),
            attributes=("cm03-listing", "cm03-separate", "cm03-authorized"),
        ),
        ev(
            "cm03-e6",
            "Developer listing at each selected review date",
            "DOCUMENT",
            "The development manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review's date",
            ("User", "Team", "Systems developed for"),
            completeness="Supported by the development tool's user list or HR's team "
            "assignments, so that a developer missing from the list is found.",
            not_acceptable="A list the reviewer typed from memory.",
            attributes=("cm03-separate",),
        ),
        ev(
            "cm03-e7",
            "Approved membership of the deployment group",
            "DOCUMENT",
            "The control owner for change management",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force at each selected review date",
            ("Member", "Approval and date"),
            attributes=("cm03-authorized",),
        ),
        ev(
            "cm03-e8",
            "Reviewer's sign-off and removal records for each selected review",
            "DOCUMENT",
            "The reviewer of deployment access",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            (
                "Signer and role",
                "Sign-off date",
                "Conflicts found",
                "Removal records with dates",
                "Approved exceptions",
            ),
            attributes=("cm03-signoff",),
        ),  # fmt: skip
        ev(
            "cm03-e9",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for change management",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the deployment path, the reviewer, or the teams",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_CM03_TESTED = ("cm03-listing", "cm03-separate", "cm03-authorized", "cm03-signoff")

CHANGE_SEGREGATION = Definition(
    library_key="change-segregation",
    control_ref="ITGC-CM-03",
    version=4,
    objective="No one who develops changes can deploy them to production.",
    control_type="PREVENTIVE",
    performer="Administrators who manage deployment access",
    reviewer="Not described",
    trigger="Quarterly, per the library",
    population="Not sampled: the developer and deployer lists at the dates tested.",
    sampling=sampling(
        "QUARTERLY",
        note="AS 2315.32: segregation of duties is usually tested by inspection, not sampling.",
    ),  # fmt: skip
    design_confirmation=(
        "This control is the quarterly review of who can deploy changes to production. "
        "The restriction on deployment access is set through user access. Confirm that "
        "the client performs this quarterly review."
    ),
    evidence=_CM03.items,
    procedures=(
        _CM03.proc(
            "d-1",
            "DESIGN",
            "Understand who develops, who may deploy, and how the quarterly review compares them.",
            "Read the deployment access and review procedures; identify the authorized "
            "deployment group, how developers are identified, who reviews each quarter, and "
            "how a conflict is resolved.",
            (
                read_design(
                    "the deployment access procedure and the review procedure", ("cm03-e1",)
                ),  # fmt: skip
                client_values(
                    "the role that reviews deployment access and the approved membership of "
                    "the deployment group"
                ),
                information_used(
                    "the deployment access listing and the developer listing",
                    ("cm03-e4", "cm03-e6"),
                ),  # fmt: skip
            ),
        ),
        _CM03.proc(
            "d-2",
            "DESIGN",
            "Determine whether the review, performed as described by a reviewer who holds no "
            "deployment access, addresses its risk and is implemented (AS 2201.42-.43).",
            "Walk one quarterly review from the listings' production to the removals, asking "
            "the reviewer how they know who develops; confirm the reviewer's knowledge and that "
            "they hold no deployment access; assess whether the comparison and its follow-up "
            "address the risk.",
            (
                walkthrough("a quarterly deployment access review", ("cm03-e2",)),
                authority("the reviewer of deployment access"),
                assess_design(
                    "the deployment listing comes from the system at a recorded date and "
                    "includes service accounts that deploy; the developer listing is complete "
                    "for every team that develops for the system; the reviewer compares the two "
                    "and holds no deployment access; and a conflict is removed or covered by an "
                    "approved exception with monitoring."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM03.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly reviews performed in the window against the one expected per "
            "quarter; select reviews at random with the firm's size for a quarterly control.",
            (
                step(
                    "List the reviews performed in the window with the reviewer and sign-off "
                    "date, and compare with the quarters the window contains.",
                    ("cm03-e3",),
                    "Each quarter, the review found or missing, and the sign-off date.",
                    "A quarter with no review is a deviation for that quarter.",
                ),
                select_sample("a quarterly", "reviews"),
            ),
        ),
        _CM03.proc(
            "o-2",
            "OPERATING",
            "Determine whether, at each selected review, the deployment listing was complete, "
            "no developer could deploy, every deployer was authorized, and the review was "
            "signed off with conflicts removed.",
            "Agree the deployment listing to the system's deployment roles at its production "
            "date; compare the developer list with the deployers; compare the deployers with the "
            "approved group; inspect the sign-off and the removal of each conflict.",
            (
                step(
                    "Agree the deployment access listing to the system's holders of each "
                    "deployment role or permission at the production date, including service "
                    "accounts.",
                    ("cm03-e4", "cm03-e5"),
                    "Production date, roles compared, record counts, and any holder not on the "
                    "listing.",
                    "A deployer missing from the listing is an exception of the listing's "
                    "completeness.",
                ),
                step(
                    "Compare the developer listing with the deployers and list every account "
                    "that appears on both; check the developer listing's support.",
                    ("cm03-e6", "cm03-e5"),
                    "Each developer with deployment rights, or the evidence of no overlap, and "
                    "the developer listing's support.",
                    "A developer who can deploy is an exception unless covered by an approved "
                    "exception with monitoring, which is recorded for a person; a developer "
                    "listing without support leaves the attribute insufficiently evidenced.",
                ),
                step(
                    "Compare every account with deployment rights with the approved membership "
                    "of the deployment group.",
                    ("cm03-e5", "cm03-e7"),
                    "Each deployer and their approval, or its absence.",
                    "A deployer not on the approved membership is an exception.",
                ),
                step(
                    "Inspect the sign-off and, for each conflict the review found, the system "
                    "record of the removal or the approved exception.",
                    ("cm03-e8", "cm03-e5"),
                    "Signer, role, date, each conflict, and its removal or exception.",
                    "No sign-off, or a conflict neither removed nor excepted, is an exception.",
                ),
            ),
            _CM03_TESTED,
            "Shows access at the dates tested only, unless the access change history covers "
            "the period.",
        ),
        _CM03.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review and attribute, cited to the evidence.",
            (evaluate_exceptions("review"), conclude("interim")),
        ),
        _CM03.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the deployment path, the reviewer, or the teams changed since "
            "the interim date; test the reviews of the remaining period per the roll-forward "
            "table against the same attributes; record the results.",
            (
                inquire_changes(("cm03-e9",)),
                step(
                    "List the reviews performed in the remaining period against the quarters "
                    "it contains.",
                    ("cm03-e3",),
                    "Each quarter and the review found or missing.",
                    "A missing review is a deviation for that quarter.",
                ),
                update_sample("reviews"),
                conclude("roll-forward"),
            ),
            _CM03_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM03.attr(
            "cm03-listing",
            "The deployment access listing the reviewer used agrees to the system's holders of "
            "deployment rights at its production date, including service accounts",
            ("cm03-e4", "cm03-e5"),
            condition="Every holder of a deployment role or permission in the system is on the "
            "listing.",
            why="A review of an incomplete listing cannot find a deployer who is not on it "
            "(AS 1105.10).",
            extract=("Production date", "Record counts", "Holders traced"),
            compare="The system's holders against the listing, both ways.",
            passes="They agree.",
            fails="A holder of deployment rights is missing from the listing.",
            insufficient="No production date, or no system list to compare.",
            review="Deployment rights are granted through nested groups the report does not "
            "expand.",
            not_infer="Do not assume a listing is complete because it came from the system.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _CM03.attr(
            "cm03-separate",
            "No account on the developer list has production deployment rights in the system",
            ("cm03-e6", "cm03-e5"),
            condition="The intersection of developers and deployers is empty.",
            why="This is the restriction the control describes.",
            extract=("Developer accounts", "Deployer accounts"),
            compare="Developers against deployers.",
            passes="No overlap.",
            fails="A developer can deploy.",
            insufficient="Either list missing or its completeness unsupported.",
            review="A shared or service account deploys on developers' behalf.",
            not_infer="Do not assume the developer list is complete.",
            basis=("DESIGN", "AS2315.32"),
            confidence="HIGH",
            was="No developer has production deployment access",
        ),
        _CM03.attr(
            "cm03-authorized",
            "Every account with deployment rights is on the approved list of the deployment group",
            ("cm03-e5", "cm03-e7"),
            condition="Each deployer is on the approved group list.",
            why="The description limits deployment to a separate, authorized group.",
            extract=("Deployers", "Approved members"),
            compare="System deployers against the approved list.",
            passes="All approved.",
            fails="An unapproved deployer.",
            insufficient="No approved list.",
            review="The group is defined by role without a list.",
            not_infer="Membership of an admin group is not approval.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Deployment access is limited to the authorized group",
        ),
        _CM03.attr(
            "cm03-signoff",
            "The quarter's review was signed off by the reviewer, and each conflict it found was "
            "removed or covered by an approved exception",
            ("cm03-e8", "cm03-e5"),
            condition="A dated sign-off, and a removal record or approved exception for each "
            "conflict.",
            why="The statement says the reviewer confirms no deployer develops and conflicting "
            "access is removed; a conflict found and left is the risk unaddressed.",
            extract=("Signer", "Date", "Conflicts", "Removals or exceptions"),
            compare="Each conflict against its removal record or exception approval.",
            passes="Signed, with every conflict removed or excepted.",
            fails="No sign-off, or a conflict neither removed nor excepted.",
            insufficient="The sign-off or the removal records are not provided.",
            review="An exception's monitoring control is not described.",
            not_infer="A note that access 'will be removed' is not a removal.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

# ITGC-CM-04 Configuration changes are approved

_CM04 = Suite(
    (
        ev(
            "cm04-e1",
            "List of in-scope configuration and the configuration change procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which configuration objects affect financial processing",
                "Who approves a configuration change",
                "Whether approval must precede the change",
                "How the system logs configuration changes",
            ),
            not_acceptable="A procedure that does not say which configuration is in scope: the "
            "population cannot be drawn without it.",
        ),  # fmt: skip
        ev(
            "cm04-e2",
            "Walkthrough instance: one configuration change from request to log entry",
            "TICKET",
            "The change manager",
            ("DESIGN",),
            "DESIGN",
            "One recent configuration change",
            ("The request", "The approval", "The log entry with old and new values"),
        ),
        ev(
            "cm04-e3",
            "Configuration change log from the system for the in-scope objects",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Object or setting", "Old value", "New value", "Changed by", "Date and time"),
            completeness="From the system's own configuration log (table logging or audit "
            "trail) filtered to the in-scope objects, with the query, parameters, run date, and "
            "record count; the logging setting is shown to have been on for the window.",
            not_acceptable="A list of configuration change tickets: it misses changes made "
            "without a ticket.",
        ),
        ev(
            "cm04-e4",
            "Logging setting and query parameters for the configuration log",
            "SYSTEM_SCREEN",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            (
                "The logging setting and since when",
                "Objects filtered",
                "Date range",
                "Record count",
            ),
            completeness="Shows the log was kept for the whole window and covers the in-scope "
            "objects.",
        ),  # fmt: skip
        ev(
            "cm04-e5",
            "Request for each selected configuration change",
            "TICKET",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Request ID", "Setting and intended values", "Requester", "Who made the change"),
            attributes=("cm04-request", "cm04-matches", "cm04-independent"),
        ),
        ev(
            "cm04-e6",
            "Approval for each selected configuration change",
            "SYSTEM_SCREEN",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Approver and role", "Approval date and time", "What was approved"),
            attributes=("cm04-approval", "cm04-before", "cm04-independent"),
        ),
        ev(
            "cm04-e7",
            "Log entry for each selected configuration change",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Object", "Old value", "New value", "Changed by", "Date and time"),
            attributes=("cm04-matches", "cm04-before", "cm04-independent"),
        ),
        ev(
            "cm04-e8",
            "Authorized approvers of configuration changes",
            "DOCUMENT",
            "The control owner for change management",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("Configuration area", "Approver", "Delegations"),
            attributes=("cm04-approval",),
        ),
        ev(
            "cm04-e9",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for change management",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the in-scope list, the approver, or the logging",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_CM04_TESTED = ("cm04-request", "cm04-approval", "cm04-matches", "cm04-independent")

CHANGE_CONFIGURATION = Definition(
    library_key="change-configuration",
    control_ref="ITGC-CM-04",
    version=4,
    objective="Changes to configuration that affects financial processing are requested, "
    "approved, and logged.",
    control_type="PREVENTIVE",
    performer="The person who changes the configuration",
    reviewer="The approver",
    trigger="A configuration change",
    population="Every change to in-scope configuration in the period, from the configuration "
    "change log, with completeness support.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM04.items,
    procedures=(
        _CM04.proc(
            "d-1",
            "DESIGN",
            "Understand which configuration is in scope, who approves a change to it, and how "
            "the system logs the change.",
            "Read the list of in-scope configuration and the change procedure; identify the "
            "approver, whether approval must precede the change, and the system log that "
            "records each change with its values.",
            (
                read_design(
                    "the list of in-scope configuration and the change procedure", ("cm04-e1",)
                ),  # fmt: skip
                client_values(
                    "the configuration objects that affect financial processing, the approver "
                    "of configuration changes, and whether approval must precede the change"
                ),
                information_used("the system's configuration change log", ("cm04-e3", "cm04-e4")),
            ),
        ),
        _CM04.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one configuration change from the request through the approval to the log "
            "entry, asking the approver how they judge the financial effect; confirm the "
            "approver's authority; assess whether request, approval, and logging address the "
            "risk.",
            (
                walkthrough("a configuration change", ("cm04-e2",)),
                authority("the approver of configuration changes"),
                assess_design(
                    "the in-scope list covers the settings that decide how transactions are "
                    "processed; the system logs every change to them with old and new values; "
                    "an approver who understands the financial effect approves the stated "
                    "values; and a change without approval is found from the log and acted on."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM04.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of configuration changes for the window.",
            "Obtain every change to in-scope configuration in the window from the system's own "
            "log, with the logging setting, the query's parameters, and the record count, and "
            "validate it before any sample is selected.",
            (
                obtain_population(
                    "configuration changes to in-scope objects", ("cm04-e3", "cm04-e4")
                ),  # fmt: skip
                step(
                    "Confirm the logging setting was on for the in-scope objects throughout the "
                    "window, and that the query's object filter matches the in-scope list.",
                    ("cm04-e4", "cm04-e1"),
                    "The logging setting and its history, the objects filtered, and the "
                    "in-scope list.",
                    "A window in which logging was off is a population gap for a person to "
                    "assess; an object in scope but not logged is recorded as untested.",
                ),
                validate_population(
                    "the system's configuration audit trail", ("cm04-e3", "cm04-e4")
                ),
            ),
        ),
        _CM04.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select configuration changes at random from the validated population, with the "
            "firm's size for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "configuration changes"),),
        ),
        _CM04.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected configuration change was requested, approved by an "
            "authorized approver who did not make it, and is the change approved.",
            "For each logged change, find its request and approval; compare the approver with "
            "the authorized list and with the person who made the change; compare the log "
            "entry's object and values with the approved change; compare the dates where the "
            "procedure requires approval first.",
            (
                step(
                    "Find the request for the logged change and confirm it names the setting "
                    "and the intended values the log entry shows.",
                    ("cm04-e5", "cm04-e7"),
                    "Request ID, the setting and values requested, and the log entry.",
                    "A logged change with no request is an exception; linking by date alone "
                    "is not a link.",
                ),
                step(
                    "Identify the approver and compare with the authorized approvers for the "
                    "configuration area; compare the approver with the person who made the "
                    "change.",
                    ("cm04-e6", "cm04-e8", "cm04-e7"),
                    "Approver, role, the authorized approver of record, and who made the change.",
                    "No approval, an unauthorized approver, or an approver who made the change "
                    "is an exception.",
                ),
                step(
                    "Compare the object, old value, and new value in the log entry with the "
                    "approved change.",
                    ("cm04-e7", "cm04-e6"),
                    "The log's object and values beside the approved ones.",
                    "A value changed other than as approved is an exception; a log without "
                    "values is insufficient evidence.",
                ),
                step(
                    "Where the procedure requires approval before the change, compare the "
                    "approval date and time with the log entry's.",
                    ("cm04-e6", "cm04-e7"),
                    "Both timestamps and the procedure's rule.",
                    "A change before its approval is an exception where the procedure requires "
                    "approval first; where the procedure is silent the attribute waits for the "
                    "client's answer.",
                ),
            ),
            ("cm04-request", "cm04-approval", "cm04-matches", "cm04-independent", "cm04-before"),
        ),
        _CM04.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per change and attribute, cited to the evidence.",
            (evaluate_exceptions("configuration change"), conclude("interim")),
        ),
        _CM04.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the in-scope list, the approver, or the logging changed since "
            "the interim date; obtain and validate the remaining period's configuration changes; "
            "test an update sample against the same attributes; record the results.",
            (
                inquire_changes(("cm04-e9",)),
                obtain_population(
                    "configuration changes to in-scope objects",
                    ("cm04-e3", "cm04-e4"),
                    "the remaining period",
                ),  # fmt: skip
                validate_population(
                    "the system's configuration audit trail", ("cm04-e3", "cm04-e4")
                ),
                update_sample("configuration changes"),
                conclude("roll-forward"),
            ),
            _CM04_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM04.attr(
            "cm04-request",
            "A request exists for the logged configuration change",
            ("cm04-e5", "cm04-e7"),
            condition="A request describes this change.",
            why="The description requires a request.",
            extract=("Request ID", "Change described"),
            compare="Request against log entry.",
            passes="A request exists.",
            fails="No request.",
            insufficient="Not provided.",
            review="Cannot link request to entry.",
            not_infer="Do not link by date alone.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="A request and approval exist for the configuration change",
        ),
        _CM04.attr(
            "cm04-approval",
            "The configuration change was approved by an authorized approver",
            ("cm04-e6", "cm04-e8"),
            condition="An approval by an authorized person.",
            why="The description requires approval.",
            extract=("Approver", "Date"),
            compare="Approver against the authorized list.",
            passes="Approved by an authorized person.",
            fails="Not approved, or by someone unauthorized.",
            insufficient="No approval, or no approver list.",
            review="Authority is not defined.",
            not_infer="Do not assume authority from seniority.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM04.attr(
            "cm04-matches",
            "The change in the configuration log is the change that was approved",
            ("cm04-e7", "cm04-e6"),
            condition="Object, old and new values in the log equal the approved change.",
            why="Approval covers only the change approved.",
            extract=("Object", "Old value", "New value"),
            compare="Log against approval.",
            passes="They match.",
            fails="A different change.",
            insufficient="Log lacks values.",
            review="Values described differently.",
            not_infer="Do not infer values from the request.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The change log matches the approved change",
        ),
        _CM04.attr(
            "cm04-independent",
            "The approver did not make the configuration change they approved",
            ("cm04-e6", "cm04-e7"),
            condition="The approver differs from the 'changed by' in the log.",
            why="An approval by the person who made the change is not a check on it; the "
            "statement names a separate approver.",
            extract=("Approver", "Changed by"),
            compare="The approver against the log's 'changed by'.",
            passes="Different people.",
            fails="The approver made the change.",
            insufficient="The log does not record who made the change.",
            review="The change was made under a shared or system account.",
            not_infer="Do not assume the requester made the change.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement separates the approver from the person who changes the "
                "configuration; an RCM description may not, so the attribute is marked as an "
                "inference.",
            ),  # fmt: skip
        ),
        _CM04.attr(
            "cm04-before",
            "The approval is dated before the configuration change was made",
            ("cm04-e6", "cm04-e7"),
            condition="Approval date before the log date.",
            why="The description does not state the order; a preventive control would "
            "require approval first.",
            extract=("Approval date", "Change date"),
            compare="Dates.",
            passes="Approval first.",
            fails="Change first.",
            insufficient="Dates missing.",
            review="Until the client confirms approval must precede the change.",
            not_infer="Do not assume the required order.",
            basis=("INFERENCE",),
            confidence="LOW",
            question="Must configuration changes be approved before they are made, or may they "
            "be approved after?",
        ),
    ),
    questions=("Which configuration objects affect financial processing (the population)?",),
)

# ITGC-CM-05 Direct data changes are approved

_CM05 = Suite(
    (
        ev(
            "cm05-e1",
            "Direct data change procedure, data owner list, and authorized staff list",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "What counts as a direct data change",
                "Who owns which data",
                "Who may make the change",
                "How the system logs it",
            ),
        ),  # fmt: skip
        ev(
            "cm05-e2",
            "Walkthrough instance: one direct data change from request to log entry",
            "TICKET",
            "The change manager",
            ("DESIGN",),
            "DESIGN",
            "One recent direct data change",
            ("The request", "The data owner's approval", "The log entry"),
        ),
        ev(
            "cm05-e3",
            "Direct data change log from the system",
            "SYSTEM_LOG",
            "The database administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            (
                "Table or object",
                "Records and values changed",
                "Made by",
                "Date and time",
                "Reference to the request",
            ),
            completeness="From the system's or database's own log of direct changes, with the "
            "query, parameters, run date, and record count, and the logging shown to have been "
            "on for the window.",
            not_acceptable="A list of data change tickets: a change made without a ticket is "
            "what the log must show.",
        ),  # fmt: skip
        ev(
            "cm05-e4",
            "Logging setting and query parameters for the data change log",
            "SYSTEM_SCREEN",
            "The database administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            (
                "The logging setting and since when",
                "Scope of the log",
                "Date range",
                "Record count",
            ),
            completeness="Shows the log was kept for the whole window.",
        ),  # fmt: skip
        ev(
            "cm05-e5",
            "Request and data owner approval for each selected change",
            "TICKET",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            (
                "Request ID",
                "Data and values to change",
                "Approver and role",
                "Approval date and time",
            ),
            attributes=("cm05-approved", "cm05-matches", "cm05-before"),
        ),  # fmt: skip
        ev(
            "cm05-e6",
            "Log entry for each selected change",
            "SYSTEM_LOG",
            "The database administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Table or object", "Records and values changed", "Made by", "Date and time"),
            attributes=("cm05-performer", "cm05-matches", "cm05-before"),
        ),
        ev(
            "cm05-e7",
            "Data owner list and authorized staff list in force",
            "DOCUMENT",
            "The control owner for change management",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("Data area", "Data owner", "Staff authorized to change data directly"),
            attributes=("cm05-approved", "cm05-performer"),
        ),
        ev(
            "cm05-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for change management",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the owners, the authorized staff, or the logging",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_CM05_TESTED = ("cm05-approved", "cm05-performer", "cm05-matches")

CHANGE_DATA = Definition(
    library_key="change-data",
    control_ref="ITGC-CM-05",
    version=4,
    objective="Direct changes to production data are approved by the data owner and made "
    "by authorized staff.",
    control_type="PREVENTIVE",
    performer="Authorized staff who make the change",
    reviewer="The data owner who approves",
    trigger="A direct data change",
    population="Every direct data change in the period from the change log. Changes made "
    "outside the log cannot be found by sampling the log.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM05.items,
    procedures=(
        _CM05.proc(
            "d-1",
            "DESIGN",
            "Understand what a direct data change is, who owns the data, who may make the "
            "change, and how it is logged.",
            "Read the direct data change procedure with its data owner and authorized staff "
            "lists; identify what the system logs about each change and whether the log can "
            "be bypassed.",
            (
                read_design("the direct data change procedure and its lists", ("cm05-e1",)),
                client_values(
                    "the role allowed to change data directly and the data owner for each data area"
                ),
                information_used("the system's direct data change log", ("cm05-e3", "cm05-e4")),
            ),
        ),
        _CM05.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one direct data change from the request through the data owner's approval to "
            "the log entry, asking the administrator how changes outside the procedure would "
            "appear; confirm the owner's and the staff's authority; assess whether approval of "
            "a stated change, by its owner, made by authorized staff, addresses the risk.",
            (
                walkthrough("a direct data change", ("cm05-e2",)),
                authority("the data owners and the staff authorized to change data directly"),
                assess_design(
                    "the approval names the data and values to change; the data owner, not IT, "
                    "approves; only the authorized staff can change data directly, which user "
                    "access controls enforce; and the system logs each change so that a change "
                    "without approval can be found."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM05.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of direct data changes for the window.",
            "Obtain every direct data change in the window from the system's own log, with the "
            "logging setting, the query's parameters, and the record count, and validate it "
            "before any sample is selected.",
            (
                obtain_population("direct data changes", ("cm05-e3", "cm05-e4")),
                step(
                    "Confirm the logging was on throughout the window and covers every path by "
                    "which data can be changed directly.",
                    ("cm05-e4",),
                    "The logging setting, its history, and the paths it covers.",
                    "A window or path without logging is a population gap for a person to "
                    "assess; the test cannot find changes the log does not hold.",
                ),
                validate_population("the database's audit trail", ("cm05-e3", "cm05-e4")),
            ),
        ),
        _CM05.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select direct data changes at random from the validated population, with the "
            "firm's size for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "direct data changes"),),
        ),
        _CM05.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected data change was approved by the data owner, made "
            "by authorized staff, and is the change approved.",
            "For each logged change, inspect the request and the data owner's approval, compare "
            "the approver with the data owner list, compare the person who made the change with "
            "the authorized staff list, and compare the change made with the change approved.",
            (
                step(
                    "Find the request and approval for the logged change; compare the approver "
                    "with the data owner for the data area changed.",
                    ("cm05-e5", "cm05-e7"),
                    "Request ID, approver, role, and the data owner of record.",
                    "No approval, or an approval by someone other than the data owner (an IT "
                    "approval, for example), is an exception.",
                ),
                step(
                    "Compare the person who made the change, from the log, with the authorized "
                    "staff list.",
                    ("cm05-e6", "cm05-e7"),
                    "The log's 'made by' and the authorized list.",
                    "A change made by someone not on the list is an exception; a change made "
                    "under a shared account is recorded for a person.",
                ),
                step(
                    "Compare the table, records, and values changed in the log with those the "
                    "approval states.",
                    ("cm05-e6", "cm05-e5"),
                    "The approved change and the logged change, side by side.",
                    "A change beyond or other than the one approved is an exception; a log that "
                    "does not show values is insufficient evidence.",
                ),
                step(
                    "Where the procedure requires approval before the change, compare the "
                    "approval date and time with the log entry's.",
                    ("cm05-e5", "cm05-e6"),
                    "Both timestamps and the procedure's rule.",
                    "A change before its approval is an exception where the procedure requires "
                    "approval first; where it is silent the attribute waits for the client's "
                    "answer.",
                ),
            ),
            ("cm05-approved", "cm05-performer", "cm05-matches", "cm05-before"),
            "The log is the population: a change made without logging is outside this test.",
        ),
        _CM05.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per change and attribute, cited to the evidence.",
            (evaluate_exceptions("data change"), conclude("interim")),
        ),
        _CM05.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the owners, the authorized staff, or the logging "
            "changed since the interim date; obtain and validate the remaining period's data "
            "changes; test an update sample against the same attributes; record the results.",
            (
                inquire_changes(("cm05-e8",)),
                obtain_population(
                    "direct data changes", ("cm05-e3", "cm05-e4"), "the remaining period"
                ),  # fmt: skip
                validate_population("the database's audit trail", ("cm05-e3", "cm05-e4")),
                update_sample("direct data changes"),
                conclude("roll-forward"),
            ),
            _CM05_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM05.attr(
            "cm05-approved",
            "A request exists and the data owner approved the data change",
            ("cm05-e5", "cm05-e7"),
            condition="A request and an approval by the designated data owner.",
            why="The description requires data owner approval.",
            extract=("Approver", "Data owner"),
            compare="Approver against the data owner.",
            passes="Approved by the data owner.",
            fails="Missing or by someone else.",
            insufficient="Not provided.",
            review="Data owner not defined for the data changed.",
            not_infer="Do not treat IT approval as data owner approval.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="A request and data-owner approval exist",
        ),
        _CM05.attr(
            "cm05-performer",
            "The person who made the data change is on the list of authorized staff",
            ("cm05-e6", "cm05-e7"),
            condition="The performer in the log is authorized.",
            why="The description requires authorized staff.",
            extract=("Performer",),
            compare="Performer against the list.",
            passes="Authorized.",
            fails="Not authorized.",
            insufficient="No list, or no performer in the log.",
            review="Performed under a shared account.",
            not_infer="Do not assume a DBA is authorized.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The change was performed by an authorized person",
        ),
        _CM05.attr(
            "cm05-matches",
            "The data change made, as the log shows it, is the change the data owner approved",
            ("cm05-e6", "cm05-e5"),
            condition="Table, records, and values in the log equal those in the approval.",
            why="The statement says the approval is of a specific, stated change; a different "
            "change is unapproved.",
            extract=("Table or object", "Records", "Old and new values"),
            compare="The logged change against the approved change.",
            passes="They match.",
            fails="The change made differs from, or exceeds, the one approved.",
            insufficient="The log does not show the values changed.",
            review="The approval states the change in business terms the log does not use.",
            not_infer="Do not infer what was changed from the request.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM05.attr(
            "cm05-before",
            "The data owner's approval is dated before the change was made",
            ("cm05-e5", "cm05-e6"),
            condition="Approval date and time before the log entry's.",
            why="The statement lists request, approval, then change; whether the client's "
            "procedure requires that order is not confirmed.",
            extract=("Approval date", "Change date"),
            compare="Dates.",
            passes="Approval first.",
            fails="Change first.",
            insufficient="Dates missing.",
            review="Until the client confirms approval must precede the change.",
            not_infer="Do not assume the required order.",
            basis=("DESIGN", "INFERENCE"),
            confidence="LOW",
            question="Must a direct data change be approved before it is made, or may the data "
            "owner approve it afterwards?",
        ),
    ),
    retired=(
        Retired(
            "The change was logged",
            "The log is the population the sample is drawn from, so every sampled change is "
            "logged; the attribute could not fail. The limitation is stated on the procedure.",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    CHANGE_APPROVAL,
    CHANGE_EMERGENCY,
    CHANGE_SEGREGATION,
    CHANGE_CONFIGURATION,
    CHANGE_DATA,
)
