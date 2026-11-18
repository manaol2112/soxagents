"""Version 4 testing definitions for the IT operations controls (ITGC-OP-01 to -05).
See definitions_itgc_access.py for the conventions."""

from ai_workforce_api.definitions_support import (
    ROLL_LIMIT,
    WALKTHROUGH_LIMIT,
    Suite,
    assess_design,
    authority,
    client_values,
    conclude,
    config_change_history,
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

# ITGC-OP-01 Scheduled jobs are monitored and failures resolved

_OP01 = Suite(
    (
        ev(
            "op01-e1",
            "Job schedule of financially relevant jobs and the monitoring procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which jobs process financial data",
                "Who monitors and when",
                "How a failure is logged, investigated, and rerun",
                "How the resolution is recorded",
            ),
            not_acceptable="The full scheduler job list with no indication of which jobs are "
            "financially relevant: the population cannot be drawn from it.",
        ),  # fmt: skip
        ev(
            "op01-e2",
            "Walkthrough instance: one job failure from the scheduler to its resolution",
            "TICKET",
            "The IT operations team",
            ("DESIGN",),
            "DESIGN",
            "One recent failure",
            ("The scheduler's failure record", "The incident", "The rerun or resolution"),
        ),
        ev(
            "op01-e3",
            "Calendar of days in the window",
            "DOCUMENT",
            "The audit team",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Each calendar day", "Whether jobs were scheduled on it"),
            completeness="The days are the population; no system support is needed.",
        ),
        ev(
            "op01-e4",
            "Scheduler run history for each selected day",
            "SYSTEM_REPORT",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected day",
            ("Job", "Scheduled time", "Run time", "Status", "Return code"),
            completeness="Exported from the scheduler for the day with its parameters and "
            "record count; covers every financially relevant job scheduled that day, including "
            "jobs that did not start.",
            not_acceptable="A report listing only successful runs: it may omit failures and "
            "jobs that did not start.",
            attributes=("op01-identified",),
        ),
        ev(
            "op01-e5",
            "Monitoring record for each selected day",
            "DOCUMENT",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected day",
            ("Who monitored", "When", "Failures noted"),
            alternatives=("The scheduler's acknowledgement log for the day's alerts",),
            attributes=("op01-identified",),
        ),
        ev(
            "op01-e6",
            "Incident for each failure on a selected day",
            "TICKET",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each failure on a selected day",
            (
                "Incident ID",
                "Job and failure",
                "Opened",
                "Investigation and root cause",
                "Action taken",
                "Rerun outcome",
                "Closed",
            ),
            not_acceptable="A ticket closed with no resolution text.",
            attributes=("op01-logged", "op01-resolved", "op01-complete"),
        ),  # fmt: skip
        ev(
            "op01-e7",
            "Rerun or recovery evidence for each failure",
            "SYSTEM_LOG",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each failure on a selected day",
            (
                "Rerun job and time",
                "Status",
                "Records processed, or the reconciliation of the data affected",
            ),
            attributes=("op01-resolved", "op01-complete"),
        ),  # fmt: skip
        ev(
            "op01-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for IT operations",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the job list, the scheduler, or the monitoring team",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_OP01_TESTED = ("op01-identified", "op01-logged", "op01-resolved", "op01-complete")

OPERATIONS_JOBS = Definition(
    library_key="operations-jobs",
    control_ref="ITGC-OP-01",
    version=4,
    objective="Failures of financially relevant scheduled jobs are identified and resolved.",
    control_type="DETECTIVE",
    performer="The operations team who monitor jobs",
    reviewer="Not described",
    trigger="Each day's job runs",
    population="The days in the period; for each selected day, the job log of financially "
    "relevant jobs, with its completeness support.",
    sampling=sampling("DAILY"),
    evidence=_OP01.items,
    procedures=(
        _OP01.proc(
            "d-1",
            "DESIGN",
            "Understand which jobs matter, how they are monitored, and what happens on a failure.",
            "Read the list of financially relevant jobs and the monitoring procedure; identify "
            "who monitors, how a failure reaches them, and how an incident is opened, "
            "investigated, rerun, and closed.",
            (
                read_design("the job schedule and the monitoring procedure", ("op01-e1",)),
                client_values(
                    "the job scheduler, the team that monitors jobs, and the jobs that process "
                    "financial data"
                ),
                information_used("the scheduler's run history", ("op01-e4",)),
            ),
        ),
        _OP01.proc(
            "d-2",
            "DESIGN",
            "Determine whether the monitoring, performed as described, addresses its risk and "
            "is implemented (AS 2201.42-.43).",
            "Walk one failure from the scheduler's record through the incident to its rerun, "
            "asking the operator how they know a rerun recovered the processing; confirm the "
            "operators' rights and competence; assess whether daily monitoring and resolution "
            "address the risk.",
            (
                walkthrough("a job failure", ("op01-e2",)),
                authority("the operators who monitor and rerun jobs"),
                assess_design(
                    "every failure of a financially relevant job reaches the monitoring team "
                    "the same day; each is logged as an incident and investigated; the rerun or "
                    "resolution shows the data was processed once and completely; and the "
                    "resolution is recorded."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP01.proc(
            "o-1",
            "OPERATING",
            "Select the sample of days.",
            "Select days at random from the window with the firm's size for a daily control and "
            "a recorded seed; for each selected day obtain the scheduler's run history for the "
            "financially relevant jobs, with its parameters and record count.",
            (
                select_sample("a daily", "days"),
                obtain_population(
                    "the selected day's job runs", ("op01-e3", "op01-e4"), "each selected day"
                ),  # fmt: skip
                step(
                    "Confirm the day's run history covers every financially relevant job "
                    "scheduled that day, including jobs that did not start, by comparing it "
                    "with the job schedule.",
                    ("op01-e4", "op01-e1"),
                    "Jobs scheduled, jobs in the history, and any missing.",
                    "A job scheduled but absent from the history is treated as a failure to "
                    "investigate; a history that lists successes only is insufficient.",
                ),
            ),
        ),
        _OP01.proc(
            "o-2",
            "OPERATING",
            "Determine whether each failure on the selected days was identified, logged as an "
            "incident, investigated, and resolved so that the data was processed completely.",
            "From the run history for each selected day, list the failures; find each one's "
            "monitoring record, incident, investigation, and rerun or recovery; confirm the "
            "resolution shows the processing was completed once.",
            (
                step(
                    "List every failed, abended, or not-started financially relevant job on the "
                    "day from the run history.",
                    ("op01-e4",),
                    "Each failure with the job, time, and return code, or the statement that "
                    "the history shows none.",
                    "None; a day with no failures passes the attributes that depend on a "
                    "failure as not applicable, with the history cited.",
                ),
                step(
                    "For each failure, find the monitoring record or acknowledged alert and the "
                    "incident opened for it, with its opening time.",
                    ("op01-e5", "op01-e6"),
                    "Per failure: the monitoring record and the incident ID and opening time.",
                    "A failure with no monitoring record or no incident is an exception: it was "
                    "not identified.",
                ),
                step(
                    "Read the incident's investigation and action, and find the rerun or "
                    "recovery record; confirm the resolution states how the affected data was "
                    "processed once and completely.",
                    ("op01-e6", "op01-e7"),
                    "Per failure: cause, action, rerun time and status, and the statement or "
                    "reconciliation of the data processed.",
                    "An incident closed without a resolution, a rerun that itself failed, or a "
                    "resolution silent on the data's completeness is an exception; whether a "
                    "resolution addressed the data impact is recorded for a person where the "
                    "record is unclear.",
                ),
            ),
            _OP01_TESTED,
        ),
        _OP01.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per day, failure, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("failure"), conclude("interim")),
        ),
        _OP01.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the job list, the scheduler, or the monitoring team changed "
            "since the interim date; select an update sample of days from the remaining period "
            "and test each against the same attributes; record the results.",
            (
                inquire_changes(("op01-e8",)),
                update_sample("days"),
                conclude("roll-forward"),
            ),
            _OP01_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP01.attr(
            "op01-identified",
            "Every failure of a financially relevant job on the selected day has a monitoring "
            "record",
            ("op01-e4", "op01-e5"),
            condition="Each failure in the job log has a ticket or monitoring entry.",
            why="Monitoring that misses failures does not detect them.",
            extract=("Failed jobs", "Records"),
            compare="Failures against records.",
            passes="Every failure has a record (or no failures occurred).",
            fails="A failure without a record.",
            insufficient="No job log, or its completeness is unsupported.",
            review="Whether a job is financially relevant.",
            not_infer="A day with no tickets does not mean no failures.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
            was="Job failures on the selected days were identified",
        ),
        _OP01.attr(
            "op01-logged",
            "Each failure was logged as an incident, opened on the day of the failure",
            ("op01-e6", "op01-e4"),
            condition="An incident exists for the failure with an opening time on the failure's "
            "day.",
            why="The statement says each failed job is logged as an incident; the incident is "
            "what carries the investigation and resolution.",
            extract=("Failure time", "Incident ID", "Opened"),
            compare="Each failure against the incident opened for it.",
            passes="An incident opened on the day.",
            fails="No incident, or one opened later than the day.",
            insufficient="The incident log for the day is not provided.",
            review="Several failures of one job were logged as one incident.",
            not_infer="A monitoring note is not an incident unless the procedure defines it so.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP01.attr(
            "op01-resolved",
            "Each failure was investigated and resolved, with the resolution documented",
            ("op01-e6", "op01-e7"),
            condition="Each record shows investigation and a resolution.",
            why="The description requires failures to be resolved to completion.",
            extract=("Root cause or action", "Resolution", "Rerun outcome"),
            compare="Each failure's record for a resolution.",
            passes="Resolved with documentation.",
            fails="Unresolved or undocumented.",
            insufficient="Tickets not provided.",
            review="Whether the resolution addressed the data impact.",
            not_infer="A closed ticket without a resolution is not resolved.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Each failure was investigated and resolved",
        ),
        _OP01.attr(
            "op01-complete",
            "The resolution shows the affected data was processed once and completely (a "
            "successful rerun, or a reconciliation of the data affected)",
            ("op01-e7", "op01-e6"),
            condition="A rerun with a successful status, or a reconciliation, covers the "
            "failed run's data.",
            why="The statement says the operator confirms the data was processed once and "
            "completely; a failure closed without that leaves transactions unprocessed or "
            "doubled.",
            extract=("Rerun status", "Records processed", "Reconciliation"),
            compare="The failed run's scope against the rerun's or reconciliation's.",
            passes="The rerun succeeded for the failed run's scope, or the reconciliation "
            "shows the data complete.",
            fails="No rerun or reconciliation, or one that does not cover the failed scope.",
            insufficient="The rerun record shows a status but not what it processed.",
            review="Whether a partial rerun recovered the processing is a judgment.",
            not_infer="Do not treat the next day's successful run as recovering the failed one.",
            basis=("DESIGN", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's investigation clause states the completeness check; an RCM "
                "description may not, so the attribute is marked as an inference.",
            ),  # fmt: skip
        ),
    ),
    retired=(
        Retired(
            "Resolution was documented",
            "Merged into op01-resolved; testing it separately duplicated the evidence.",
            "op01-resolved",
        ),
    ),
)

# ITGC-OP-02 Job schedule changes are approved

_OP02 = Suite(
    (
        ev(
            "op02-e1",
            "Schedule change procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "What counts as a schedule change",
                "Who approves and before what",
                "How the scheduler logs changes",
            ),
        ),  # fmt: skip
        ev(
            "op02-e2",
            "Walkthrough instance: one schedule change from request to the scheduler's log",
            "TICKET",
            "The scheduler administrator",
            ("DESIGN",),
            "DESIGN",
            "One recent schedule change",
            ("The request", "The approval", "The scheduler's change log entry"),
        ),
        ev(
            "op02-e3",
            "Schedule change log from the scheduler for jobs that process financial data",
            "SYSTEM_LOG",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            (
                "Job",
                "Change (new, timing, parameters, dependencies, removal)",
                "Old and new definition",
                "Changed by",
                "Date and time",
            ),
            completeness="From the scheduler's own audit log, with the query, parameters, run "
            "date, and record count; the log is shown to have been on for the window.",
            not_acceptable="A list of change tickets.",
        ),  # fmt: skip
        ev(
            "op02-e4",
            "Query parameters and record count for the schedule change log",
            "SYSTEM_SCREEN",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the log",
            ("Scheduler", "Jobs filtered", "Date range", "Record count"),
            completeness="Shows the log covers the whole window and the jobs in scope.",
        ),
        ev(
            "op02-e5",
            "Request for each selected schedule change",
            "TICKET",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Request ID", "Job and change requested", "Requester"),
            attributes=("op02-request", "op02-matches"),
        ),
        ev(
            "op02-e6",
            "Approval for each selected schedule change",
            "SYSTEM_SCREEN",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Approver and role", "Approval date and time", "What was approved"),
            attributes=("op02-approved",),
        ),
        ev(
            "op02-e7",
            "Scheduler log entry for each selected change",
            "SYSTEM_LOG",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected change",
            ("Job", "Old and new definition", "Changed by", "Date and time"),
            attributes=("op02-approved", "op02-matches"),
        ),
        ev(
            "op02-e8",
            "Authorized approvers of schedule changes",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("Approver", "Delegations"),
            attributes=("op02-approved",),
        ),
        ev(
            "op02-e9",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for IT operations",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the approver, or the scheduler",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_OP02_TESTED = ("op02-request", "op02-approved", "op02-matches")

OPERATIONS_SCHEDULE = Definition(
    library_key="operations-scheduling",
    control_ref="ITGC-OP-02",
    version=4,
    objective="Changes to the job schedule are approved before they are made.",
    control_type="PREVENTIVE",
    performer="The scheduler administrator",
    reviewer="The approver of schedule changes",
    trigger="A change to the job schedule",
    population="Every change to the schedule of jobs that process financial data in the "
    "period, from the scheduler's own change log.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_OP02.items,
    procedures=(
        _OP02.proc(
            "d-1",
            "DESIGN",
            "Understand how schedule changes are requested, approved, and logged.",
            "Read the schedule change procedure; identify what counts as a change, who approves "
            "it before it is made, and what the scheduler logs about each change.",
            (
                read_design("the schedule change procedure", ("op02-e1",)),
                client_values(
                    "the job scheduler, the change tool, and the approver of schedule changes"
                ),
                information_used("the scheduler's change log", ("op02-e3", "op02-e4")),
            ),
        ),
        _OP02.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one schedule change from the request through the approval to the scheduler's "
            "log entry, asking the approver how they judge the job's effect; confirm the "
            "approver's authority; assess whether approval before the change addresses the "
            "risk.",
            (
                walkthrough("a schedule change", ("op02-e2",)),
                authority("the approver of schedule changes"),
                assess_design(
                    "every change to a job that processes financial data is logged by the "
                    "scheduler; an approver who understands the job's effect approves the "
                    "stated change before it is made; and the administrator makes only the "
                    "change approved."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP02.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of schedule changes for the window.",
            "Obtain every change to the schedule of financially relevant jobs in the window from "
            "the scheduler's own log, with the query's parameters and record count, and validate "
            "it before any sample is selected.",
            (
                obtain_population("schedule changes", ("op02-e3", "op02-e4")),
                validate_population("the scheduler's audit log", ("op02-e3", "op02-e4")),
            ),
        ),
        _OP02.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select schedule changes at random from the validated population, with the firm's "
            "size for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "schedule changes"),),
        ),
        _OP02.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected schedule change was requested and approved by an "
            "authorized approver before it was made, and is the change approved.",
            "For each selected change in the scheduler log, find its request and approval, "
            "compare the approver with the authorized approvers, compare the approval date with "
            "the change date, and compare the change made with the change approved.",
            (
                step(
                    "Find the request for the logged change and confirm it names the job and "
                    "the change the log entry shows.",
                    ("op02-e5", "op02-e7"),
                    "Request ID, the job and change requested, and the log entry.",
                    "A logged change with no request is an exception.",
                ),
                step(
                    "Identify the approver and compare with the authorized approvers; compare "
                    "the approval date and time with the change date and time in the log.",
                    ("op02-e6", "op02-e8", "op02-e7"),
                    "Approver, role, the authorized approver of record, and both timestamps.",
                    "No approval, an unauthorized approver, or approval after the change is an "
                    "exception; the person who made the change is not its approver.",
                ),
                step(
                    "Compare the old and new definition in the scheduler's log with the change "
                    "approved.",
                    ("op02-e7", "op02-e6"),
                    "The approved change and the logged change, side by side.",
                    "A change other than, or beyond, the one approved is an exception.",
                ),
            ),
            _OP02_TESTED,
        ),
        _OP02.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per change and attribute, cited to the evidence.",
            (evaluate_exceptions("schedule change"), conclude("interim")),
        ),
        _OP02.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the approver, or the scheduler changed since the "
            "interim date; obtain and validate the remaining period's schedule changes; test an "
            "update sample against the same attributes; record the results.",
            (
                inquire_changes(("op02-e9",)),
                obtain_population(
                    "schedule changes", ("op02-e3", "op02-e4"), "the remaining period"
                ),  # fmt: skip
                validate_population("the scheduler's audit log", ("op02-e3", "op02-e4")),
                update_sample("schedule changes"),
                conclude("roll-forward"),
            ),
            _OP02_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP02.attr(
            "op02-request",
            "A request in the change tool describes the schedule change that was made",
            ("op02-e5", "op02-e7"),
            condition="A request names the job and the change the log entry shows.",
            why="The statement says a schedule change is requested in the change tool; a "
            "change with no request was not put to the approver.",
            extract=("Request ID", "Job", "Change requested"),
            compare="The request against the scheduler's log entry.",
            passes="A request describes the logged change.",
            fails="No request, or a request for a different change.",
            insufficient="The request is not provided.",
            review="The request describes the change in business terms the log does not use.",
            not_infer="Do not link a request to a change by date alone.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP02.attr(
            "op02-approved",
            "Each schedule change was approved by an authorized approver before it was made",
            ("op02-e6", "op02-e8", "op02-e7"),
            condition="An approval exists for the change, dated on or before the change.",
            why="The control requires approval before a schedule change.",
            extract=("Approver", "Approval date", "Change date"),
            compare="Approval date against the change date; approver against the procedure.",
            passes="Approved by an authorized approver on or before the change.",
            fails="Not approved, or approved after the change.",
            insufficient="The approval or the change date is not provided.",
            review="The procedure does not say who may approve.",
            not_infer="Do not treat the person who made the change as its approver.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Schedule changes were approved",
        ),
        _OP02.attr(
            "op02-matches",
            "The change made in the scheduler is the change that was approved",
            ("op02-e7", "op02-e6"),
            condition="The old and new definition in the log equal the approved change.",
            why="Approval of one change does not authorize another made with it.",
            extract=("Job", "Old definition", "New definition"),
            compare="The logged change against the approved change.",
            passes="They match.",
            fails="A different or additional change was made.",
            insufficient="The log does not show the definitions.",
            review="The approval describes the change less precisely than the log.",
            not_infer="Do not infer what was changed from the request.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
    ),
    retired=(
        Retired(
            "Only authorized people can change the job schedule",
            "Moved to ITGC-OP-02.1, the quarterly review of scheduler access: access and "
            "approval of changes are two controls with different frequencies (milestone 8.9).",
            "op021-access",
        ),
    ),
)

# ITGC-OP-02.1 Access to change the job schedule is reviewed

_OP021 = Suite(
    (
        ev(
            "op021-e1",
            "Scheduler access review procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Who reviews each quarter",
                "What rights count as able to change the schedule",
                "How the listing is produced",
                "How removals are made",
            ),
        ),  # fmt: skip
        ev(
            "op021-e2",
            "Walkthrough instance: one quarterly review with its listing and removals",
            "DOCUMENT",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The listing", "The decisions and sign-off", "The removals"),
        ),
        ev(
            "op021-e3",
            "Schedule of quarterly reviews performed in the window",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters ending in the window",
            ("Quarter", "Reviewer", "Sign-off date"),
            completeness="One review is expected per quarter; the schedule is agreed to that "
            "expectation and to the sign-offs.",
        ),
        ev(
            "op021-e4",
            "Scheduler user listing each selected review covered, with how it was produced",
            "SYSTEM_REPORT",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            ("User", "Rights", "Report and parameters", "Date produced", "Record count"),
            completeness="Agreed to the scheduler's own user and rights list at the production "
            "date.",
            attributes=("op021-complete",),
        ),
        ev(
            "op021-e5",
            "Scheduler user and rights list at each selected production date",
            "SYSTEM_REPORT",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected review's listing",
            ("User", "Rights", "Account type"),
            attributes=("op021-complete",),
        ),
        ev(
            "op021-e6",
            "Signed listing with a decision per user for each selected review",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Signer and role", "Sign-off date", "Decision per user"),
            attributes=("op021-signoff", "op021-access"),
        ),
        ev(
            "op021-e7",
            "Removal records for access not confirmed",
            "SYSTEM_LOG",
            "The scheduler administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each removal decided in a selected review",
            ("User", "Rights removed", "Date", "Removed by"),
            attributes=("op021-access",),
        ),
        ev(
            "op021-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for IT operations",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the reviewer, the scheduler, or the rights in scope",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_OP021_TESTED = ("op021-complete", "op021-signoff", "op021-access")

OPERATIONS_SCHEDULER_ACCESS = Definition(
    library_key="operations-scheduler-access",
    control_ref="ITGC-OP-02.1",
    version=4,
    objective="Only people whose role needs it can change the job schedule.",
    control_type="DETECTIVE",
    performer="The control owner for IT operations",
    reviewer="None: the review is the control",
    trigger="Each quarter",
    population="The quarterly reviews in the period, each with the listing of users able to "
    "change the schedule.",
    sampling=sampling("QUARTERLY"),
    evidence=_OP021.items,
    procedures=(
        _OP021.proc(
            "d-1",
            "DESIGN",
            "Understand which rights allow a schedule change, who reviews them, and how the "
            "listing is produced.",
            "Read the review procedure; identify the rights in scope, the reviewer, how the "
            "listing is produced from the scheduler, and how a removal is made.",
            (
                read_design("the scheduler access review procedure", ("op021-e1",)),
                client_values("the job scheduler and the control owner who reviews access to it"),
                information_used("the scheduler user listing", ("op021-e4",)),
            ),
        ),
        _OP021.proc(
            "d-2",
            "DESIGN",
            "Determine whether the review, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one quarterly review from the listing's production to the removals, asking "
            "the reviewer how they judge each user's need; confirm the reviewer's knowledge; "
            "assess whether the review's scope and follow-through address the risk.",
            (
                walkthrough("a quarterly scheduler access review", ("op021-e2",)),
                authority("the reviewer of scheduler access"),
                assess_design(
                    "the listing comes from the scheduler at a recorded date and covers every "
                    "right that allows a schedule change, including service accounts; the "
                    "reviewer knows who needs to change the schedule and records a decision for "
                    "each user; and access not confirmed is removed and the removal recorded."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP021.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly reviews performed in the window against the one expected per "
            "quarter; select reviews at random with the firm's size for a quarterly control.",
            (
                step(
                    "List the reviews performed in the window with the reviewer and sign-off "
                    "date, and compare with the quarters the window contains.",
                    ("op021-e3",),
                    "Each quarter, the review found or missing, and the sign-off date.",
                    "A quarter with no review is a deviation for that quarter.",
                ),
                select_sample("a quarterly", "reviews"),
            ),
        ),
        _OP021.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected quarter's review covered every user able to "
            "change the schedule, was signed off with a decision per user, and removed access "
            "not confirmed.",
            "Agree the listing to the scheduler's users and rights at its production date; "
            "inspect the sign-off and the decision for each user; find the removal record for "
            "each user not confirmed.",
            (
                step(
                    "Agree the listing to the scheduler's own user and rights list at the "
                    "production date, for every right that allows a schedule change.",
                    ("op021-e4", "op021-e5"),
                    "Production date, rights compared, record counts, and any user with change "
                    "rights not on the listing.",
                    "A user with change rights missing from the listing is an exception of the "
                    "listing's completeness.",
                ),
                step(
                    "Inspect the sign-off: the signer, their role, the date, and a decision "
                    "recorded for every user on the listing.",
                    ("op021-e6",),
                    "Signer, role, date, users listed, and users with a decision.",
                    "No sign-off, or a user without a decision, is an exception.",
                ),
                step(
                    "For each user not confirmed, find the removal in the scheduler's own record "
                    "and its date.",
                    ("op021-e6", "op021-e7"),
                    "Each remove decision, the removal record, and its date.",
                    "A removal decided but not made is an exception.",
                ),
            ),
            _OP021_TESTED,
        ),
        _OP021.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review and attribute, cited to the evidence.",
            (evaluate_exceptions("review"), conclude("interim")),
        ),
        _OP021.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the reviewer, the scheduler, or the rights in scope changed "
            "since the interim date; test the reviews of the remaining period per the "
            "roll-forward table against the same attributes; record the results.",
            (
                inquire_changes(("op021-e8",)),
                step(
                    "List the reviews performed in the remaining period against the quarters "
                    "it contains.",
                    ("op021-e3",),
                    "Each quarter and the review found or missing.",
                    "A missing review is a deviation for that quarter.",
                ),
                update_sample("reviews"),
                conclude("roll-forward"),
            ),
            _OP021_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP021.attr(
            "op021-complete",
            "The listing the reviewer used includes every user able to change the job "
            "schedule at its production date",
            ("op021-e4", "op021-e5"),
            condition="The listing agrees to the scheduler's own user list at that date.",
            why="A review of an incomplete listing cannot find access that is not on it "
            "(AS 1105.10).",
            extract=("Users", "Rights", "Date"),
            compare="Listing against the scheduler's users at that date.",
            passes="The listing agrees.",
            fails="A user with change rights is missing from the listing.",
            insufficient="No production date or no way to agree the listing.",
            review="The listing was produced by a method the evidence does not show.",
            not_infer="Do not assume a listing is complete because it came from the system.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _OP021.attr(
            "op021-signoff",
            "The quarter's review was signed off by the control owner, with the date",
            ("op021-e6",),
            condition="A dated sign-off by the reviewer the procedure names.",
            why="The statement says the control owner reviews the listing each quarter; "
            "without the sign-off there is no evidence the review happened.",
            extract=("Signer", "Role", "Date"),
            compare="The signer against the reviewer the procedure names.",
            passes="Signed by the reviewer, dated.",
            fails="No sign-off.",
            insufficient="The sign-off is not provided.",
            review="The signer is a delegate without a documented delegation.",
            not_infer="An unsigned listing is not a review.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
        _OP021.attr(
            "op021-access",
            "Every user able to change the job schedule was confirmed by the reviewer, or "
            "their access was removed",
            ("op021-e6", "op021-e7"),
            condition="Each user has a recorded decision; removals are recorded.",
            why="The control limits who can change batch processing.",
            extract=("User", "Decision", "Removal date"),
            compare="Each user's decision against the access remaining.",
            passes="Every user confirmed or removed.",
            fails="A user neither confirmed nor removed, or a removal not made.",
            insufficient="The signed listing or the removal records are not provided.",
            review="The reviewer's basis for confirming a user is not recorded.",
            not_infer="Do not treat an unsigned listing as a review.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Only authorized people can change the job schedule",
        ),
    ),
)

# ITGC-OP-03 Backups are configured and run on schedule

_OP03 = Suite(
    (
        ev(
            "op03-e1",
            "Backup policy",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "DESIGN",
            "The version in force during the period",
            ("Which data must be backed up", "How often", "Retention", "Where backups are kept"),
            not_acceptable="A policy that requires 'regular' backups without a schedule.",
            attributes=("op03-config",),
        ),
        ev(
            "op03-e2",
            "Backup configuration as shown from the tool, dated",
            "CONFIGURATION",
            "The backup administrator",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the interim date and at period end",
            (
                "Backup job and scope (the system's databases and file systems)",
                "Schedule",
                "Retention",
                "Tool and date shown",
            ),
            not_acceptable="A document describing the intended backup design.",
            attributes=("op03-config",),
        ),  # fmt: skip
        ev(
            "op03-e3",
            "Backup job history for one day",
            "SYSTEM_REPORT",
            "The backup administrator",
            ("DESIGN", "OPERATING"),
            "ATTRIBUTE",
            "One day in the window, chosen by the audit team",
            ("Job", "Scheduled time", "Run time", "Status", "Data backed up"),
            not_acceptable="A report of successful jobs only.",
            attributes=("op03-ran",),
        ),
        ev(
            "op03-e4",
            "Change history of the backup configuration",
            "SYSTEM_LOG",
            "The backup administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The window tested",
            ("Setting changed", "Old and new value", "Date", "Changed by", "Approval reference"),
            completeness="How the history was produced, so that an empty history shows no "
            "change rather than no logging.",
            attributes=("op03-unchanged",),
        ),
        ev(
            "op03-e5",
            "Users and roles able to change the backup configuration",
            "SYSTEM_REPORT",
            "The backup administrator",
            ("DESIGN",),
            "CONTEXT",
            "At the interim date",
            ("User or role", "Permission", "How the list was produced"),
        ),
    )
)

_OP03_TESTED = ("op03-config", "op03-ran", "op03-unchanged")

OPERATIONS_BACKUP = Definition(
    library_key="operations-backup",
    control_ref="ITGC-OP-03",
    version=4,
    objective="Financial data is backed up on the schedule and retention the policy requires.",
    control_type="PREVENTIVE",
    performer="The backup tool",
    reviewer="None: the configuration is the control",
    trigger="Each scheduled backup",
    population="The backup configuration for the in-scope system, and its changes in the period.",
    sampling=sampling("DAILY", automated=True),
    evidence=_OP03.items,
    procedures=(
        _OP03.proc(
            "d-1",
            "DESIGN",
            "Understand what the policy requires and how the configuration enforces it.",
            "Read the backup policy; identify the system's financial data stores, the backup "
            "jobs that cover them, their schedule and retention, and who can change the "
            "configuration.",
            (
                read_design("the backup policy", ("op03-e1",)),
                client_values(
                    "the backup tool, how often backups must run, and the retention period"
                ),
                step(
                    "Identify the system's financial data stores and the backup job that covers "
                    "each, with its schedule and retention, and who can change the "
                    "configuration.",
                    ("op03-e2", "op03-e5"),
                    "Each data store, the job covering it, the schedule, the retention, and the "
                    "roles able to change the configuration.",
                    "A data store no job covers is a design gap for a person to assess.",
                ),
            ),
        ),
        _OP03.proc(
            "d-2",
            "DESIGN",
            "Determine whether the configuration, as set, meets the policy and is implemented "
            "(AS 2201.42-.43).",
            "Inspect the job history for one day to see the configured jobs ran; compare the "
            "configuration with the policy; assess whether the configuration, protected by "
            "change management and restricted access, addresses the risk.",
            (
                step(
                    "Inspect the backup job history for one day and confirm each configured job "
                    "ran for the system's financial data.",
                    ("op03-e3", "op03-e2"),
                    "The day, each configured job, and its run status.",
                    "A configured job that did not run is referred to the failure control "
                    "(ITGC-OP-03.1) and recorded here as a design observation.",
                ),
                assess_design(
                    "every financial data store of the system is in a backup job's scope; the "
                    "schedule and retention meet the policy; backups are kept where a loss of "
                    "the primary site does not lose them; and changes to the configuration go "
                    "through change management by administrators whose access is reviewed."
                ),
            ),
            limitation="One day's history shows the configuration operated that day.",
        ),
        _OP03.proc(
            "o-1",
            "OPERATING",
            "Determine whether the backup configuration covered the financial data on the "
            "required schedule and retention for the window, and stayed in place.",
            "Inspect the configuration as shown from the tool and compare scope, schedule, and "
            "retention with the policy; inspect the job history for one day to see it operated; "
            "inspect the configuration's change history for the window.",
            (
                step(
                    "Compare the configuration's scope, schedule, and retention, as shown from "
                    "the tool with its date, with the policy's requirements.",
                    ("op03-e2", "op03-e1"),
                    "Per data store: the job, schedule, retention, and the policy value for each.",
                    "A data store out of scope, or a schedule or retention short of the policy, "
                    "is an exception; a policy silent on a value is recorded for a person.",
                ),
                step(
                    "Inspect the job history for the chosen day and confirm each scheduled job "
                    "ran, with the data it backed up.",
                    ("op03-e3", "op03-e2"),
                    "The day, each scheduled job, its status, and the data backed up.",
                    "A scheduled job that did not run or failed is an exception for the day "
                    "and is referred to the failure control; a history of successes only is "
                    "insufficient.",
                ),
                config_change_history("the backup configuration", ("op03-e4",)),
            ),
            _OP03_TESTED,
            "Relies on the access and change-management controls over the tool for the period "
            "between the dates inspected (AS 2201.B29).",
        ),
        _OP03.proc(
            "o-2",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per data store and attribute, cited to the evidence.",
            (evaluate_exceptions("data store or job"), conclude("interim")),
        ),
        _OP03.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the configuration stayed in place from the interim date to period "
            "end (AS 2201.55-.56, .B29).",
            "Inspect the change history of the backup configuration for the remaining period. "
            "If it did not change, inspect the configuration as at period end and agree it to "
            "the interim result. If it changed, test the change's approval and test the "
            "configuration again as changed.",
            (
                config_change_history("the backup configuration", ("op03-e4",)),
                step(
                    "Inspect the configuration as at period end and agree its scope, schedule, "
                    "and retention to the interim result, or, where it changed, compare the new "
                    "values with the policy.",
                    ("op03-e2", "op03-e1"),
                    "Per data store: the period-end configuration, the interim configuration, "
                    "and the policy value.",
                    "A period-end value short of the policy is an exception from its change date.",
                ),
                conclude("roll-forward"),
            ),
            ("op03-config", "op03-unchanged"),
            "A setting at period end shows nothing about the period before it without the "
            "change history.",
        ),
    ),
    attributes=(
        _OP03.attr(
            "op03-config",
            "The backup tool is configured to back up the system's financial data on the "
            "schedule and retention the policy requires",
            ("op03-e2", "op03-e1"),
            condition="Scope, schedule, and retention in the configuration.",
            why="The control is the configured backup.",
            extract=("Scope", "Schedule", "Retention"),
            compare="Configuration against the policy.",
            passes="Scope, schedule, and retention meet the policy.",
            fails="The financial data is not in scope, or the schedule or retention falls "
            "short of the policy.",
            insufficient="The configuration is not shown from the tool, or is undated.",
            review="The policy does not state the schedule or retention.",
            not_infer="Do not take a policy document as evidence of the configuration.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP03.attr(
            "op03-ran",
            "Scheduled backups of financial data ran on the day examined",
            ("op03-e3",),
            condition="The job history for the day shows each scheduled job.",
            why="Shows the configured control operated.",
            extract=("Jobs", "Status", "Date"),
            compare="Scheduled jobs against jobs run.",
            passes="Every scheduled job ran.",
            fails="A scheduled job did not run.",
            insufficient="No job history for the day.",
            review="Whether a failed job held financial data.",
            not_infer="A report listing only successes may omit failures.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Backups completed on the selected days, or failures were resolved",
        ),
        _OP03.attr(
            "op03-unchanged",
            "The backup configuration did not change during the period, or each change was "
            "approved under change management, as shown by the tool's change history",
            ("op03-e4",),
            condition="The change history shows no change, or each change has approval.",
            why="One point-in-time configuration does not show the backups held for the "
            "period; reliance rests on the change history and on change management.",
            extract=("Changes", "Dates", "Who changed", "Approval"),
            compare="Changes against approvals.",
            passes="No change, or every change approved.",
            fails="An unapproved change to scope, schedule, or retention.",
            insufficient="No change history.",
            review="The tool keeps no change history: a person decides an alternative.",
            not_infer="Do not infer no changes from the absence of a log.",
            basis=("DESIGN", "AS2201.B28", "INFERENCE"),
            confidence="MODERATE",
        ),
    ),
    retired=(
        Retired(
            "A restore test succeeded during the period",
            "Moved to ITGC-OP-03.2, the annual restore test (milestone 8.9).",
            "op032-restore",
        ),
    ),
)

# ITGC-OP-03.1 Failed backups are resolved

_OP031 = Suite(
    (
        ev(
            "op031-e1",
            "Backup monitoring procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Who reviews backup results each day",
                "How a failure is reported",
                "The time allowed to resolve a failed backup",
                "How the resolution is recorded",
            ),
        ),  # fmt: skip
        ev(
            "op031-e2",
            "Walkthrough instance: one failed backup from the tool's alert to its resolution",
            "TICKET",
            "The IT operations team",
            ("DESIGN",),
            "DESIGN",
            "One recent failure",
            ("The tool's failure record", "The review that found it", "The rerun or resolution"),
        ),
        ev(
            "op031-e3",
            "Backup job history for the window, filtered to failures",
            "SYSTEM_REPORT",
            "The backup administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Job", "Date and time", "Status", "Error"),
            completeness="From the backup tool's own history, with the query, parameters, run "
            "date, and record count; the unfiltered count of runs is given so the failures can "
            "be seen to be a subset of it.",
            not_acceptable="The operations team's log of failures they noticed.",
        ),
        ev(
            "op031-e4",
            "Query parameters and record counts for the job history",
            "SYSTEM_SCREEN",
            "The backup administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the history",
            ("Tool", "Date range", "Status filter", "Record count filtered and unfiltered"),
            completeness="Shows the history covers the whole window.",
        ),
        ev(
            "op031-e5",
            "Daily review record for the day of each selected failure",
            "DOCUMENT",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The day of each selected failure",
            ("Who reviewed", "When", "Failures noted"),
            alternatives=("The tool's alert acknowledgement log",),
            attributes=("op031-identified",),
        ),
        ev(
            "op031-e6",
            "Resolution record for each selected failure",
            "TICKET",
            "The IT operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected failure",
            (
                "Failure",
                "Investigation",
                "Rerun or other resolution",
                "Resolution date and time",
                "Who resolved",
            ),
            not_acceptable="A note that the next scheduled backup succeeded, unless the "
            "procedure defines that as the resolution.",
            attributes=("op031-identified", "op031-resolved"),
        ),  # fmt: skip
        ev(
            "op031-e7",
            "Rerun record in the tool for each selected failure",
            "SYSTEM_LOG",
            "The backup administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected failure",
            ("Rerun job", "Date and time", "Status", "Data backed up"),
            attributes=("op031-resolved",),
        ),
        ev(
            "op031-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for IT operations",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            ("Changes to the tool, the team, or the time allowed", "Documentation of each change"),
        ),  # fmt: skip
    )
)

_OP031_TESTED = ("op031-identified", "op031-resolved")

OPERATIONS_BACKUP_FAILURES = Definition(
    library_key="operations-backup-failures",
    control_ref="ITGC-OP-03.1",
    version=4,
    objective="Failed backups are found and resolved promptly.",
    control_type="DETECTIVE",
    performer="The team that monitors backups",
    reviewer="None",
    trigger="Each day's backup results",
    population="Every failed backup in the period, from the backup tool's job history.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_OP031.items,
    procedures=(
        _OP031.proc(
            "d-1",
            "DESIGN",
            "Understand how failures are reported, found, and resolved, and within what time.",
            "Read the backup monitoring procedure; identify who reviews results each day, how "
            "the tool reports a failure, the time allowed to resolve one, and how the resolution "
            "is recorded.",
            (
                read_design("the backup monitoring procedure", ("op031-e1",)),
                client_values(
                    "the team that monitors backups and the time allowed to resolve a failed backup"
                ),
                information_used("the backup tool's job history", ("op031-e3", "op031-e4")),
            ),
        ),
        _OP031.proc(
            "d-2",
            "DESIGN",
            "Determine whether the daily review, performed as described, addresses its risk and "
            "is implemented (AS 2201.42-.43).",
            "Walk one failure from the tool's record through the daily review to its rerun, "
            "asking the operator how they know every failure reached them; confirm the "
            "operators' rights; assess whether the review and resolution within the time "
            "allowed address the risk.",
            (
                walkthrough("a failed backup", ("op031-e2",)),
                authority("the operators who review backup results and rerun backups"),
                assess_design(
                    "every failure the tool reports reaches the team the same day; each is "
                    "investigated and rerun or otherwise resolved within the time allowed; and "
                    "the resolution is recorded with what was backed up."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP031.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of failed backups for the window.",
            "Obtain every failed backup in the window from the tool's own job history, with the "
            "query's parameters and the filtered and unfiltered record counts, and validate it "
            "before any sample is selected.",
            (
                obtain_population("failed backups", ("op031-e3", "op031-e4")),
                validate_population("the tool's unfiltered job history", ("op031-e3", "op031-e4")),
            ),
        ),
        _OP031.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select failures at random from the validated population, with the firm's size for "
            "an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "failed backups"),),
        ),
        _OP031.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected failure was found by the daily review and resolved "
            "within the time allowed, with the resolution recorded.",
            "For each selected failure, find the day's review record and the resolution record; "
            "find the rerun in the tool; compare the resolution date with the failure date and "
            "the time allowed.",
            (
                step(
                    "Find the day's review record or acknowledged alert that notes the failure, "
                    "and the resolution record opened for it.",
                    ("op031-e5", "op031-e6"),
                    "Per failure: the review record, who reviewed, when, and the resolution "
                    "record's ID.",
                    "A failure the day's review does not note is an exception: it was not "
                    "identified.",
                ),
                step(
                    "Read the resolution record and find the rerun in the tool; confirm the "
                    "rerun succeeded for the failed job's data, or the record states the other "
                    "resolution the procedure allows.",
                    ("op031-e6", "op031-e7"),
                    "Per failure: the investigation, the rerun's time and status and data, or "
                    "the other resolution.",
                    "No resolution, a rerun that failed, or a resolution the procedure does not "
                    "allow is an exception.",
                ),
                step(
                    "Compute the time from the failure to the resolution, in the units the "
                    "procedure uses, and compare with the time allowed.",
                    ("op031-e3", "op031-e6"),
                    "Failure time, resolution time, the difference, and the time allowed.",
                    "Resolution later than the time allowed is an exception; where the time "
                    "allowed is not recorded the attribute waits for the client's value.",
                ),
            ),
            _OP031_TESTED,
        ),
        _OP031.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per failure and attribute, cited to the evidence.",
            (evaluate_exceptions("failed backup"), conclude("interim")),
        ),
        _OP031.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the tool, the team, or the time allowed changed since the "
            "interim date; obtain and validate the remaining period's failures; test an update "
            "sample against the same attributes; record the results.",
            (
                inquire_changes(("op031-e8",)),
                obtain_population(
                    "failed backups", ("op031-e3", "op031-e4"), "the remaining period"
                ),  # fmt: skip
                validate_population("the tool's unfiltered job history", ("op031-e3", "op031-e4")),
                update_sample("failed backups"),
                conclude("roll-forward"),
            ),
            _OP031_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP031.attr(
            "op031-identified",
            "The failed backup was noted by the daily review of backup results on the day it "
            "failed",
            ("op031-e5", "op031-e6"),
            condition="The day's review record or acknowledged alert notes the failure.",
            why="The statement says the team reviews results each day; a failure the review "
            "misses is not resolved.",
            extract=("Failure date", "Review record", "Reviewer"),
            compare="The failure against the day's review record.",
            passes="The review noted it on the day.",
            fails="The review did not note it, or noted it later than the day.",
            insufficient="No review record for the day.",
            review="The failure occurred after the day's review ran.",
            not_infer="A resolution record is not evidence the daily review found the failure.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP031.attr(
            "op031-resolved",
            "The failed backup was rerun successfully or otherwise resolved within "
            "[the time allowed to resolve a failed backup], with the resolution recorded",
            ("op031-e6", "op031-e7"),
            condition="A resolution record dated within the time allowed.",
            why="An unresolved failure leaves data unrecoverable.",
            extract=("Failure date", "Resolution", "Resolution date"),
            compare="Resolution date against the failure date and the time allowed.",
            passes="Resolved within the time allowed.",
            fails="Not resolved, or resolved late.",
            insufficient="No resolution record.",
            review="The time allowed is not defined.",
            not_infer="Do not treat the next day's successful backup as resolving the failure "
            "unless the procedure says so.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
    ),
)

# ITGC-OP-03.2 Restores from backup are tested

_OP032 = Suite(
    (
        ev(
            "op032-e1",
            "Restore test procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "How often a restore is tested",
                "What is restored and where",
                "What checks make the restored data complete and readable",
                "Who signs off",
            ),
        ),  # fmt: skip
        ev(
            "op032-e2",
            "Restore test record for each test in the period",
            "DOCUMENT",
            "The IT operations team",
            ("OPERATING",),
            "POPULATION",
            "The period",
            (
                "Test date",
                "Backup used and its date",
                "Data restored",
                "Environment",
                "Checks performed and results",
                "Reviewer's sign-off and date",
            ),
            completeness="The procedure's frequency sets the expected count; each test in the "
            "period is listed.",
            attributes=("op032-restore", "op032-compared", "op032-signoff"),
        ),  # fmt: skip
        ev(
            "op032-e3",
            "Source comparison for the restored data",
            "SYSTEM_SCREEN",
            "The IT operations team",
            ("OPERATING",),
            "ATTRIBUTE",
            "Each restore test",
            (
                "Record counts or totals in the restored data",
                "The same from the source at the backup date",
                "Readability check",
            ),
            not_acceptable="A restore job's success status alone.",
            attributes=("op032-compared",),
        ),  # fmt: skip
        ev(
            "op032-e4",
            "Backup catalog entry for the backup restored",
            "SYSTEM_LOG",
            "The backup administrator",
            ("OPERATING",),
            "ATTRIBUTE",
            "Each restore test",
            ("Backup job", "Date", "Data included"),
            attributes=("op032-restore",),
        ),
    )
)

_OP032_TESTED = ("op032-restore", "op032-compared", "op032-signoff")

OPERATIONS_RESTORE = Definition(
    library_key="operations-restore-test",
    control_ref="ITGC-OP-03.2",
    version=4,
    objective="Backups of financial data can be restored.",
    control_type="DETECTIVE",
    performer="The team that performs restore tests",
    reviewer="The reviewer of restore tests",
    trigger="The annual restore test",
    population="The restore tests performed in the period.",
    sampling=sampling("ANNUAL"),
    evidence=_OP032.items,
    procedures=(
        _OP032.proc(
            "d-1",
            "DESIGN",
            "Understand how a restore test is performed and judged complete.",
            "Read the restore test procedure; identify what is restored, where, what checks "
            "compare the restored data with the source, and who signs off.",
            (
                read_design("the restore test procedure", ("op032-e1",)),
                client_values(
                    "the team that performs restore tests and the reviewer who signs them off"
                ),
                assess_design(
                    "the test restores the system's financial data, not only a file; the "
                    "restored data is compared with the source at the backup date and read; and "
                    "a reviewer who can judge completeness signs off the result."
                ),
            ),
            limitation="The design is assessed from the procedure; the test itself is the "
            "operating evidence.",
        ),
        _OP032.proc(
            "o-1",
            "OPERATING",
            "Determine whether a restore of financial data was tested in the period, its result "
            "compared with the source, and signed off.",
            "Inspect each restore test record in the period: the backup used, the data restored, "
            "the checks performed against the source, the result, and the sign-off.",
            (
                step(
                    "List the restore tests performed in the period against the frequency the "
                    "procedure sets; for each, read the test date, the backup used, and the data "
                    "restored, and agree the backup to the catalog.",
                    ("op032-e2", "op032-e4"),
                    "Each test's date, backup and its date, data restored, and the catalog entry.",
                    "No test in the period, or a test that did not restore the system's "
                    "financial data, is an exception.",
                ),
                step(
                    "Read the checks performed: the restored data's record counts or totals "
                    "compared with the source at the backup date, and the readability check.",
                    ("op032-e2", "op032-e3"),
                    "The counts or totals compared, the differences, and the readability check.",
                    "A test with no comparison to the source, or with unexplained differences, "
                    "is an exception; whether the data restored is the financial data is "
                    "recorded for a person where unclear.",
                ),
                step(
                    "Inspect the reviewer's sign-off: who, their role against the procedure, "
                    "and the date.",
                    ("op032-e2",),
                    "Signer, role, and date.",
                    "No sign-off, or a sign-off by the person who performed the restore, is an "
                    "exception.",
                ),
                evaluate_exceptions("restore test"),
                conclude("period"),
            ),
            _OP032_TESTED,
        ),
    ),
    attributes=(
        _OP032.attr(
            "op032-restore",
            "A restore of the system's financial data from a backup was performed in the period",
            ("op032-e2", "op032-e4"),
            condition="A dated restore test in the period, from a catalogued backup, of the "
            "system's financial data.",
            why="Backups that cannot be restored do not protect the data.",
            extract=("Test date", "Backup used", "Data restored"),
            compare="Test date against the period; the backup against the catalog; the data "
            "against the system's financial data stores.",
            passes="A restore of the financial data in the period from a catalogued backup.",
            fails="No test in the period, or a restore of other data.",
            insufficient="The record does not show what was restored.",
            review="Whether the data restored is the financial data.",
            not_infer="A backup's success is not a restore test.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="A restore test succeeded during the period",
        ),
        _OP032.attr(
            "op032-compared",
            "The restored data was compared with the source at the backup date and found "
            "complete and readable",
            ("op032-e2", "op032-e3"),
            condition="Record counts or totals of the restored data agree to the source, and a "
            "readability check passed.",
            why="The statement says the reviewer confirms the restored data is complete and "
            "readable; a restore that runs to completion may still be unusable.",
            extract=("Restored counts or totals", "Source counts or totals", "Readability check"),
            compare="Restored against source.",
            passes="They agree and the data was read.",
            fails="A difference not explained, or data that could not be read.",
            insufficient="No comparison was recorded.",
            review="Differences explained by activity after the backup date.",
            not_infer="A restore job status of success is not a comparison.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP032.attr(
            "op032-signoff",
            "The reviewer of restore tests signed off the result",
            ("op032-e2",),
            condition="A dated sign-off by the reviewer the procedure names.",
            why="The statement names a reviewer who signs off the result.",
            extract=("Signer", "Role", "Date"),
            compare="The signer against the procedure's reviewer and the performer.",
            passes="Signed off by the reviewer.",
            fails="No sign-off, or signed by the performer.",
            insufficient="The sign-off is not provided.",
            review="The reviewer is a delegate without a documented delegation.",
            not_infer="The performer's completion note is not the sign-off.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

# ITGC-OP-04 Incidents are tracked to resolution

_OP04 = Suite(
    (
        ev(
            "op04-e1",
            "Incident management procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "The priority criteria",
                "Which priority counts as major",
                "Target resolution times",
                "What a closed incident must record",
            ),
        ),  # fmt: skip
        ev(
            "op04-e2",
            "Walkthrough instance: one incident from logging to closure",
            "TICKET",
            "IT support",
            ("DESIGN",),
            "DESIGN",
            "One recent incident affecting the system",
            ("The ticket", "Its priority", "Its resolution", "Root cause if major"),
        ),
        ev(
            "op04-e3",
            "Incident listing from the incident tool for the system",
            "SYSTEM_REPORT",
            "The incident manager",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Incident ID", "System affected", "Priority", "Opened", "Closed", "Status"),
            completeness="With the query, parameters, run date, and record count; filtered to "
            "the system by its configuration item, not by free text.",
            not_acceptable="A list the support team keeps outside the tool.",
        ),
        ev(
            "op04-e4",
            "Query parameters and record count for the incident listing",
            "SYSTEM_SCREEN",
            "The incident manager",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the listing",
            ("Tool", "Configuration items filtered", "Date range", "Record count"),
            completeness="Shows the listing covers the whole window and the system.",
        ),
        ev(
            "op04-e5",
            "Incident ticket for each selected incident",
            "TICKET",
            "IT support",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected incident",
            (
                "Description and impact",
                "Priority and who set it",
                "Work notes",
                "Resolution",
                "Closure date",
                "Root cause",
            ),
            attributes=("op04-logged", "op04-priority", "op04-resolved", "op04-root-cause"),
        ),  # fmt: skip
        ev(
            "op04-e6",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for IT operations",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the tool, or the support team",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_OP04_TESTED = ("op04-logged", "op04-resolved")

OPERATIONS_INCIDENTS = Definition(
    library_key="operations-incidents",
    control_ref="ITGC-OP-04",
    version=4,
    objective="Incidents affecting financial systems are tracked to resolution.",
    control_type="DETECTIVE",
    performer="IT support",
    reviewer="Not described",
    trigger="An incident",
    population="Incidents for financial systems in the period from the incident log.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_OP04.items,
    procedures=(
        _OP04.proc(
            "d-1",
            "DESIGN",
            "Understand how incidents are logged, prioritized, resolved, and closed.",
            "Read the incident management procedure; identify the priority criteria, which "
            "priority is major, the target times, and what a closed incident must record.",
            (
                read_design("the incident management procedure", ("op04-e1",)),
                client_values(
                    "the incident tool, the incident procedure's priority criteria, and the "
                    "priority that counts as major"
                ),
                information_used("the incident listing", ("op04-e3", "op04-e4")),
            ),
        ),
        _OP04.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one incident from its logging through its resolution to closure, asking "
            "support how an incident affecting financial processing is recognized; confirm the "
            "support staff's competence to resolve or escalate; assess whether tracking to "
            "resolution with root cause for major incidents addresses the risk.",
            (
                walkthrough("an incident", ("op04-e2",)),
                authority("the support staff who resolve or escalate incidents"),
                assess_design(
                    "every incident affecting the system is logged against it in the tool; a "
                    "priority is set under written criteria; each is tracked to a recorded "
                    "resolution; and a major incident's root cause is recorded so that it does "
                    "not recur."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP04.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of incidents for the window.",
            "Obtain every incident logged against the system in the window from the incident "
            "tool, with the query's parameters and record count, and validate it before any "
            "sample is selected.",
            (
                obtain_population("incidents affecting the system", ("op04-e3", "op04-e4")),
                validate_population(
                    "the incident tool's records for the system's configuration items",
                    ("op04-e3", "op04-e4"),
                ),  # fmt: skip
            ),
        ),
        _OP04.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select incidents at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "incidents"),),
        ),
        _OP04.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected incident was logged, prioritized under the "
            "criteria, resolved and closed with the resolution recorded, and, if major, has a "
            "recorded root cause.",
            "Inspect each selected ticket for the system it names, its priority against the "
            "criteria, its resolution and closure, and its root cause where the priority is "
            "major.",
            (
                step(
                    "Read the ticket: the system it is logged against, its description and "
                    "impact, and when it was opened.",
                    ("op04-e5",),
                    "Incident ID, system, description, impact, and opening time.",
                    "A ticket not logged against the system, or without a description, is an "
                    "exception.",
                ),
                step(
                    "Compare the priority set with the procedure's criteria for the impact "
                    "described.",
                    ("op04-e5", "op04-e1"),
                    "Priority set, the impact, and the criterion it meets.",
                    "A priority inconsistent with the criteria is an exception; where no "
                    "criteria are written the attribute waits for the client's value.",
                ),
                step(
                    "Read the resolution and closure: what was done, when, and by whom.",
                    ("op04-e5",),
                    "Resolution text, closure date, and resolver.",
                    "An incident closed without a resolution, or open beyond the procedure's "
                    "target without escalation, is an exception.",
                ),
                step(
                    "Where the priority is major under the procedure, find the recorded root "
                    "cause.",
                    ("op04-e5", "op04-e1"),
                    "Whether the incident is major, and the root cause recorded.",
                    "A major incident without a root cause is an exception; where the client "
                    "has not defined major, the attribute waits for the value.",
                ),
            ),
            ("op04-logged", "op04-priority", "op04-resolved", "op04-root-cause"),
        ),
        _OP04.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per incident and attribute, cited to the evidence.",
            (evaluate_exceptions("incident"), conclude("interim")),
        ),
        _OP04.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the tool, or the support team changed since the "
            "interim date; obtain and validate the remaining period's incidents; test an update "
            "sample against the same attributes; record the results.",
            (
                inquire_changes(("op04-e6",)),
                obtain_population(
                    "incidents affecting the system", ("op04-e3", "op04-e4"), "the remaining period"
                ),  # fmt: skip
                validate_population(
                    "the incident tool's records for the system's configuration items",
                    ("op04-e3", "op04-e4"),
                ),  # fmt: skip
                update_sample("incidents"),
                conclude("roll-forward"),
            ),
            _OP04_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP04.attr(
            "op04-logged",
            "The incident is logged in the incident tool against the system, with its "
            "description, impact, and opening time",
            ("op04-e5",),
            condition="A ticket names the system and records the description, impact, and "
            "opening time.",
            why="The statement says incidents affecting the system are logged in the tool; the "
            "log is what makes tracking possible.",
            extract=("System", "Description", "Impact", "Opened"),
            compare="The ticket's fields against the procedure's logging requirements.",
            passes="Logged against the system with the fields recorded.",
            fails="Not logged against the system, or without a description or opening time.",
            insufficient="The ticket is not provided.",
            review="The ticket names a related system rather than this one.",
            not_infer="An email about an outage is not a logged incident.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP04.attr(
            "op04-priority",
            "The incident was logged with a priority under the incident procedure's criteria",
            ("op04-e5", "op04-e1"),
            condition="A priority consistent with the criteria.",
            why="The description requires logging and prioritizing.",
            extract=("Priority", "Impact"),
            compare="Priority against criteria.",
            passes="Logged with a fitting priority.",
            fails="No priority, or one inconsistent with the criteria.",
            insufficient="Criteria not provided.",
            review="Criteria are not written.",
            not_infer="Do not judge priority without criteria.",
            basis=("DESIGN",),
            confidence="LOW",
            question="What criteria does the incident procedure use to prioritize incidents?",
            was="The incident was logged and prioritized",
        ),
        _OP04.attr(
            "op04-resolved",
            "The incident was resolved and closed with the resolution recorded",
            ("op04-e5",),
            condition="A resolution and closure.",
            why="The description requires tracking to resolution.",
            extract=("Resolution", "Closure date"),
            compare="Ticket status and resolution.",
            passes="Resolved with a recorded resolution.",
            fails="Open beyond the procedure's target, or closed without resolution.",
            insufficient="Ticket not provided.",
            review="Target times not defined.",
            not_infer="Closure alone is not resolution.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="The incident was resolved",
        ),
        _OP04.attr(
            "op04-root-cause",
            "For a major incident, the root cause was recorded",
            ("op04-e5", "op04-e1"),
            condition="A major incident has a recorded root cause.",
            why="The description requires root cause for major incidents.",
            extract=("Major or not", "Root cause"),
            compare="Major incidents against root cause records.",
            passes="Recorded, or the incident is not major.",
            fails="A major incident without root cause.",
            insufficient="Definition of major not provided.",
            review="Whether the incident is major.",
            not_infer="Do not decide what is major.",
            basis=("DESIGN",),
            confidence="LOW",
            question="How does the client define a major incident?",
            was="Root cause was recorded for major incidents",
        ),
    ),
)

# ITGC-OP-05 Data center access is restricted

_OP05 = Suite(
    (
        ev(
            "op05-e1",
            "Physical access procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Whether the data center is owned or hosted",
                "Who may hold access",
                "Who reviews the list and how often",
                "How access is removed",
            ),
        ),  # fmt: skip
        ev(
            "op05-e2",
            "Walkthrough instance: the most recent access review",
            "DOCUMENT",
            "The reviewer of data center access",
            ("DESIGN",),
            "DESIGN",
            "The most recent review",
            ("The access list", "The decisions and sign-off", "The removals"),
        ),
        ev(
            "op05-e3",
            "Data center access list at the review date, from the badge system",
            "SYSTEM_REPORT",
            "Facilities or the hosting provider",
            ("OPERATING",),
            "POPULATION",
            "The review date",
            ("Person", "Badge or credential", "Areas", "Date produced", "Record count"),
            completeness="Produced from the badge or access control system with its parameters "
            "and record count; not a list typed by facilities.",
            attributes=("op05-authorized", "op05-review"),
        ),
        ev(
            "op05-e4",
            "Authorization records for each person on the list",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING",),
            "ATTRIBUTE",
            "In force at the review date",
            ("Person", "Role and the need for access", "Approver", "Date"),
            not_acceptable="The badge list itself: it shows who has access, not who was "
            "authorized to.",
            attributes=("op05-authorized",),
        ),
        ev(
            "op05-e5",
            "Reviewer's decisions and sign-off for the annual review",
            "DOCUMENT",
            "The reviewer of data center access",
            ("OPERATING",),
            "ATTRIBUTE",
            "The review in the period",
            ("Decision per person", "Signer and role", "Sign-off date"),
            attributes=("op05-review", "op05-removed"),
        ),
        ev(
            "op05-e6",
            "Removal records for access not confirmed",
            "SYSTEM_LOG",
            "Facilities or the hosting provider",
            ("OPERATING",),
            "ATTRIBUTE",
            "Each removal decided in the review",
            ("Person", "Date access removed", "Removed by"),
            attributes=("op05-removed",),
        ),
        ev(
            "op05-e7",
            "Provider's SOC 1 report and bridge letter",
            "THIRD_PARTY_REPORT",
            "The hosting provider, through the control owner",
            ("OPERATING",),
            "ATTRIBUTE",
            "The period, with a bridge letter for any gap to period end",
            (
                "Report period",
                "Controls in scope",
                "Opinion",
                "Exceptions",
                "Complementary user entity controls",
                "Bridge letter period",
            ),
            attributes=("op05-soc",),
        ),  # fmt: skip
    )
)

_OP05_TESTED = ("op05-authorized", "op05-review", "op05-removed")

OPERATIONS_DATACENTER = Definition(
    library_key="operations-physical",
    control_ref="ITGC-OP-05",
    version=4,
    objective="Only authorized people can physically reach the servers of financial systems.",
    control_type="PREVENTIVE",
    performer="Facilities or the hosting provider",
    reviewer="The reviewer of the access list",
    trigger="The annual review",
    population="The data center access list at the review date, or the provider's SOC 1 "
    "report and bridge letter.",
    sampling=sampling("ANNUAL"),
    design_confirmation=(
        "Owned or hosted? For a hosted system the procedure is an evaluation of the "
        "provider's SOC 1 report, which this framework has not defined: AS 2601 (service "
        "organizations) was not reviewed, and scoping left the SOC review to entity-level "
        "controls."
    ),
    evidence=_OP05.items,
    procedures=(
        _OP05.proc(
            "d-1",
            "DESIGN",
            "Understand who may enter the data center, how access is granted and reviewed, and "
            "whether the data center is owned or hosted.",
            "Read the physical access procedure; establish whether the servers are in an owned "
            "data center or a provider's; identify who may hold access, who reviews the list, "
            "and how access is removed.",
            (
                read_design("the physical access procedure", ("op05-e1",)),
                client_values(
                    "whether the data center is owned or hosted, and the reviewer of data "
                    "center access"
                ),
                information_used("the access list from the badge system", ("op05-e3",)),
            ),
        ),
        _OP05.proc(
            "d-2",
            "DESIGN",
            "Determine whether the review, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk the most recent access review from the list's production to the removals, "
            "asking the reviewer how they judge each person's need; confirm the reviewer's "
            "knowledge; assess whether the list, the review, and the removals address the risk.",
            (
                walkthrough("the annual access review", ("op05-e2",)),
                authority("the reviewer of data center access"),
                assess_design(
                    "the list comes from the badge system at a recorded date; each person on it "
                    "has an authorization naming the need; the reviewer confirms or removes each "
                    "person each year; and removals are made in the badge system."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP05.proc(
            "o-1",
            "OPERATING",
            "For an owned data center, determine whether the annual review covered everyone "
            "with access, each was authorized, and access not confirmed was removed.",
            "Obtain the access list from the badge system at the review date; compare each "
            "person with their authorization record and the review's decision; find the removal "
            "record for each person not confirmed; inspect the sign-off.",
            (
                step(
                    "Obtain the access list from the badge system at the review date with its "
                    "parameters and record count, and agree it to the list the reviewer used.",
                    ("op05-e3", "op05-e5"),
                    "Production date, record count, and any person on the system's list not on "
                    "the reviewed list.",
                    "A person with access not on the reviewed list is an exception of the "
                    "review's completeness.",
                ),
                step(
                    "For each person on the list, find the authorization record naming their "
                    "role and the need for access, and the reviewer's decision.",
                    ("op05-e3", "op05-e4", "op05-e5"),
                    "Per person: the authorization, its approver and date, and the decision.",
                    "A person without an authorization, or without a decision, is an exception; "
                    "whether a job needs access is the reviewer's judgment, not the tester's.",
                ),
                step(
                    "For each person not confirmed, find the removal in the badge system and its "
                    "date; inspect the review's sign-off.",
                    ("op05-e5", "op05-e6"),
                    "Each removal decided and made, the signer, and the sign-off date.",
                    "A removal decided but not made, or no sign-off, is an exception.",
                ),
                evaluate_exceptions("person"),
                conclude("period"),
            ),
            _OP05_TESTED,
        ),
        _OP05.proc(
            "o-2",
            "OPERATING",
            "For a hosted system, determine whether the provider's SOC 1 report covers physical "
            "access for the period.",
            "Inspect the report's period, the controls in scope, the opinion, exceptions, and "
            "complementary user entity controls, and the bridge letter for any gap.",
            (
                step(
                    "Read the report's period, the physical access controls in scope, the "
                    "opinion, any exceptions on those controls, and the complementary user "
                    "entity controls; read the bridge letter for the gap to period end.",
                    ("op05-e7",),
                    "Report period, controls in scope, opinion, exceptions, CUECs, and the "
                    "bridge letter's period.",
                    "A report that does not cover the period or the controls, or with "
                    "exceptions on physical access, is recorded for a person: evaluating a SOC "
                    "report is not yet defined in this framework.",
                ),
                step(
                    "List the complementary user entity controls the report expects of the "
                    "client for physical access, and record whether the client performs each "
                    "and where it is tested.",
                    ("op05-e7",),
                    "Each complementary user entity control, the client's control that meets "
                    "it, and where that control is tested, or that none does.",
                    "A complementary user entity control no client control meets is recorded "
                    "for a person; the report's coverage does not extend to it.",
                ),
            ),
            ("op05-soc",),
        ),
    ),
    attributes=(
        _OP05.attr(
            "op05-authorized",
            "Everyone on the data center access list is an authorized person whose job needs "
            "physical access",
            ("op05-e3", "op05-e4"),
            condition="Each person on the list is authorized.",
            why="The description restricts physical access.",
            extract=("People", "Authorization"),
            compare="List against authorizations.",
            passes="All authorized.",
            fails="An unauthorized person.",
            insufficient="No authorization records.",
            review="Whether a job needs access.",
            not_infer="A badge list is not an authorization record.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Access to the data center is limited to authorized people",
        ),
        _OP05.attr(
            "op05-review",
            "The annual review covered the access list from the badge system, with a decision "
            "for each person and a dated sign-off by the reviewer",
            ("op05-e3", "op05-e5"),
            condition="The reviewed list agrees to the badge system's at the review date; each "
            "person has a decision; the reviewer signed and dated it.",
            why="The statement says the reviewer reviews the list each year and confirms each "
            "person's need.",
            extract=("Production date", "Record counts", "Decisions", "Signer", "Date"),
            compare="The badge system's list against the reviewed list; persons against decisions.",
            passes="Lists agree, every person decided, signed and dated.",
            fails="A person with access not reviewed, a person without a decision, or no sign-off.",
            insufficient="The badge system's list at the review date is not provided.",
            review="The reviewer is a delegate without a documented delegation.",
            not_infer="A list typed by facilities is not the badge system's list.",
            basis=("DESIGN", "AS1105.10", "AS2201.44"),
            confidence="HIGH",
        ),
        _OP05.attr(
            "op05-removed",
            "Access the reviewer did not confirm was removed in the badge system",
            ("op05-e5", "op05-e6"),
            condition="Each remove decision has a removal record in the badge system.",
            why="The statement says access no longer needed is removed; a decision not acted "
            "on leaves the access.",
            extract=("Remove decisions", "Removal record and date"),
            compare="Each decision against the removal record.",
            passes="Every removal decided was made.",
            fails="A removal decided but not made.",
            insufficient="The removal records are not provided.",
            review="The removal was made after a delay the procedure does not address.",
            not_infer="A note to facilities is not the removal.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP05.attr(
            "op05-soc",
            "For a hosted system, the provider's SOC 1 report covers physical access for the "
            "period, with an unqualified opinion on it, and a bridge letter covers any gap",
            ("op05-e7",),
            condition="Report period, scope, opinion, and bridge letter cover the period.",
            why="For a hosted system the provider operates the control.",
            extract=("Period", "Controls in scope", "Opinion", "Exceptions", "CUECs"),
            compare="Report period and scope against the period and the control.",
            passes="Covers it without exceptions affecting physical access.",
            fails="Not covered, or exceptions.",
            insufficient="Report not provided.",
            review="Always: evaluating a SOC report is not yet defined.",
            not_infer="A report's existence is not coverage.",
            basis=("DESIGN",),
            confidence="NOT_ESTABLISHED",
            question="How is the provider's SOC 1 report evaluated for this control (who, "
            "against which criteria), given scoping assigns SOC review to entity-level "
            "controls?",
            blocks=True,
            was="For a hosted system, the provider's assurance report covers the control",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    OPERATIONS_JOBS,
    OPERATIONS_SCHEDULE,
    OPERATIONS_SCHEDULER_ACCESS,
    OPERATIONS_BACKUP,
    OPERATIONS_BACKUP_FAILURES,
    OPERATIONS_RESTORE,
    OPERATIONS_INCIDENTS,
    OPERATIONS_DATACENTER,
)
