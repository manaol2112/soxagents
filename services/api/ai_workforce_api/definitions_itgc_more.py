"""Version 4 testing definitions for the IT general controls added in library version 4,
wave 1 (ITGC-AC-07 to -12, ITGC-CM-06 to -08, ITGC-OP-06 to -08). See
definitions_itgc_access.py for the conventions and statements_itgc_more.py for each
control's design statement, whose client values the bracketed attribute wording names."""

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
from ai_workforce_api.testing_definitions import Definition, EvidenceDef, Step, sampling

# Shared evidence items: the note of changes since the interim date.


def _changes(key: str, provider: str, what: str) -> EvidenceDef:
    return ev(
        key,
        "Changes to the control since the interim date",
        "CORRESPONDENCE",
        provider,
        ("ROLLFORWARD",),
        "CONTEXT",
        "From the interim date to period end",
        (f"Changes to {what}", "Documentation of each change"),
    )


def _quarters(key: str, provider: str, what: str) -> EvidenceDef:
    return ev(
        key,
        f"Schedule of quarterly {what} performed in the window",
        "DOCUMENT",
        provider,
        ("OPERATING", "ROLLFORWARD"),
        "POPULATION",
        "The quarters ending in the window",
        ("Quarter", "Reviewer", "Sign-off date"),
        completeness=f"One {what[:-1] if what.endswith('s') else what} is expected per "
        "quarter; the schedule is agreed to that expectation and to the sign-offs.",
    )


def _quarter_list(key: str, what: str) -> Step:
    return step(
        f"List the {what} performed in the window with the reviewer and sign-off date, and "
        "compare with the quarters the window contains.",
        (key,),
        f"Each quarter, the {what[:-1] if what.endswith('s') else what} found or missing, "
        "and the sign-off date.",
        f"A quarter with no {what[:-1] if what.endswith('s') else what} is a deviation for "
        "that quarter.",
    )


def _quarter_remaining(key: str, what: str) -> Step:
    return step(
        f"List the {what} performed in the remaining period against the quarters it contains.",
        (key,),
        f"Each quarter and the {what[:-1] if what.endswith('s') else what} found or missing.",
        f"A missing {what[:-1] if what.endswith('s') else what} is a deviation for that quarter.",
    )


# ITGC-AC-07 Access is re-approved on transfer

_AC07 = Suite(
    (
        ev(
            "ac07-e1",
            "Access policy: the transfer procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "How HR transfers reach the administrator",
                "Who re-approves the access kept",
                "The number of days allowed to remove access the new role does not need",
            ),
        ),
        ev(
            "ac07-e2",
            "Walkthrough instance: one transfer from the HR record to the access removed",
            "SYSTEM_SCREEN",
            "The access administrator",
            ("DESIGN",),
            "DESIGN",
            "One recent transfer in the period",
            ("The HR transfer record", "The new manager's re-approval", "The removal record"),
        ),
        ev(
            "ac07-e3",
            "HR transfer listing for the window",
            "SYSTEM_REPORT",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested, from its first to its last day",
            ("Employee ID and name", "Old role and new role", "Effective date"),
            completeness="Run from the HR system with its parameters, run date, and record "
            "count; a selection of transfers is agreed both ways to the HR system's job history.",
            not_acceptable="The list the administrator kept of transfers they processed.",
        ),
        ev(
            "ac07-e4",
            "Report parameters and record count for the transfer listing",
            "SYSTEM_SCREEN",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the listing",
            ("Report name", "HR system", "Date range and change types", "Record count"),
            completeness="Shows the listing covers the whole window and every kind of role "
            "change in scope.",
        ),
        ev(
            "ac07-e5",
            "New manager's re-approval for each selected transfer",
            "TICKET",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected transfer",
            ("Approver and role", "Approval date", "Access kept and access to remove"),
            not_acceptable="A ticket closed by the administrator without the manager's decision.",
            attributes=("ac07-reapproved", "ac07-removed", "ac07-timely"),
        ),
        ev(
            "ac07-e6",
            "System record of the user's roles before and after the transfer",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected transfer",
            (
                "Roles held at the effective date",
                "Roles removed with date",
                "Roles kept",
                "Changed by",
            ),
            not_acceptable="A current role listing: it shows what the user holds now, not what "
            "was removed and when.",
            attributes=("ac07-removed", "ac07-timely"),
        ),
        ev(
            "ac07-e7",
            "Manager of record for each selected user at the transfer date",
            "SYSTEM_REPORT",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The effective date of each selected transfer",
            ("User", "New manager of record"),
            attributes=("ac07-reapproved",),
        ),
        _changes(
            "ac07-e8",
            "The control owner for user access",
            "the HR feed, the administrators, or the system",
        ),
    )
)

_AC07_TESTED = ("ac07-reapproved", "ac07-removed")

ACCESS_TRANSFER = Definition(
    library_key="access-transfer",
    control_ref="ITGC-AC-07",
    version=4,
    objective="A user who changes role keeps only the access the new role needs, as the new "
    "manager approves it.",
    control_type="PREVENTIVE",
    performer="The administrator who removes access",
    reviewer="The user's new manager",
    trigger="A transfer or change of role recorded in the HR system",
    population="Every transfer and change of role in the period from the HR system, with "
    "effective dates and completeness support. Each user is matched to their accounts.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_AC07.items,
    procedures=(
        _AC07.proc(
            "d-1",
            "DESIGN",
            "Understand how transfers reach IT, who re-approves access, and within what time "
            "unneeded access is removed.",
            "Read the transfer procedure in the access policy; identify how HR transfers reach "
            "the administrator, who re-approves the access kept, the days allowed for removal, "
            "and the HR report transfers come from.",
            (
                read_design("the transfer procedure in the access policy", ("ac07-e1",)),
                client_values(
                    "the HR system, the role that administers access, and the number "
                    "of days the access policy allows after a transfer"
                ),
                information_used("the HR transfer listing", ("ac07-e3", "ac07-e4")),
            ),
        ),
        _AC07.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one transfer from the HR record through the new manager's re-approval to the "
            "access removed, asking the administrator how they know every role the user held; "
            "confirm the manager's and administrator's authority; assess whether re-approval "
            "and removal within the period address the risk of accumulated access.",
            (
                walkthrough("a transfer", ("ac07-e2",)),
                authority("the new managers who re-approve and the administrators who remove"),
                assess_design(
                    "every transfer reaches the administrator from HR, not from the user; the "
                    "new manager decides each role kept, knowing the new job; access not "
                    "re-approved is removed within the period; and the system's record shows "
                    "the removal."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC07.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of transfers for the window.",
            "Obtain every transfer and change of role in the window from the HR system, with "
            "the report's parameters and record count, and validate it against the HR system's "
            "job history before any sample is selected.",
            (
                obtain_population("transfers and changes of role", ("ac07-e3", "ac07-e4")),
                validate_population("the HR system's job history", ("ac07-e3", "ac07-e4")),
            ),
        ),
        _AC07.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select transfers at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "transfers"),),
        ),
        _AC07.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected transfer's access was re-approved by the new "
            "manager and the access not re-approved was removed within the period.",
            "For each selected transfer, find the new manager's re-approval and compare the "
            "approver with the manager of record; compare the roles kept and removed in the "
            "system with the decision; compute the days from the effective date to the removal "
            "and compare with the policy period.",
            (
                step(
                    "Find the re-approval for the selected transfer; compare the approver with "
                    "the user's new manager of record at the effective date, and read which "
                    "roles were kept and which were to be removed.",
                    ("ac07-e5", "ac07-e7"),
                    "Approver, role, the manager of record, and the decision per role.",
                    "No re-approval, or one by someone other than the new manager, is an "
                    "exception.",
                ),
                step(
                    "Read the system's record of the user's roles at the effective date and "
                    "the roles removed with their dates; compare with the manager's decision.",
                    ("ac07-e6", "ac07-e5"),
                    "Roles held, roles removed with dates, roles kept, and the decision.",
                    "A role the manager did not re-approve that remains is an exception; a "
                    "current role listing offered instead of the change record is "
                    "insufficient.",
                ),
                step(
                    "Compute the days from the effective date to the latest removal, in the "
                    "units the policy uses, and compare with the policy period.",
                    ("ac07-e6", "ac07-e5"),
                    "Effective date, latest removal date, days between, and the period.",
                    "Removal later than the period is an exception; where the period is not "
                    "recorded the attribute waits for the client's value.",
                ),
            ),
            ("ac07-reapproved", "ac07-removed", "ac07-timely"),
        ),
        _AC07.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per transfer and attribute, cited to the evidence.",
            (evaluate_exceptions("transfer"), conclude("interim")),
        ),
        _AC07.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the HR feed, the administrators, or the system changed since "
            "the interim date; obtain and validate the remaining period's transfers; test an "
            "update sample against the same attributes; record the results.",
            (
                inquire_changes(("ac07-e8",)),
                obtain_population(
                    "transfers and changes of role", ("ac07-e3", "ac07-e4"), "the remaining period"
                ),
                validate_population("the HR system's job history", ("ac07-e3", "ac07-e4")),
                update_sample("transfers"),
                conclude("roll-forward"),
            ),
            _AC07_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC07.attr(
            "ac07-reapproved",
            "The user's new manager re-approved the access the user keeps after the transfer, "
            "with a decision for each role held",
            ("ac07-e5", "ac07-e7"),
            condition="A re-approval by the manager of record at the effective date, deciding "
            "each role held.",
            why="The statement says the new manager re-approves the access kept; without it the "
            "old role's access stands unapproved for the new job.",
            extract=("Approver", "Manager of record", "Decision per role"),
            compare="The approver against the manager of record; roles held against roles decided.",
            passes="The new manager decided every role.",
            fails="No re-approval, an approver who is not the new manager, or roles left "
            "undecided.",
            insufficient="The re-approval or the manager of record is not provided.",
            review="The transfer is within the same manager's team.",
            not_infer="Do not treat the HR transfer record as the manager's approval of access.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC07.attr(
            "ac07-removed",
            "Every role the new manager did not re-approve was removed from the user in the system",
            ("ac07-e6", "ac07-e5"),
            condition="Each role not re-approved shows removed in the system's record.",
            why="Removal of the old role's access is the control.",
            extract=("Roles not re-approved", "Roles removed with dates"),
            compare="Roles not re-approved against the system's removals.",
            passes="Every such role was removed.",
            fails="A role not re-approved remains.",
            insufficient="Only a current role listing is provided.",
            review="A role was kept under a documented temporary handover.",
            not_infer="Do not infer removal from the ticket's closure.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC07.attr(
            "ac07-timely",
            "Access the new role does not need was removed within [the number of days the "
            "access policy allows after a transfer] of the effective date",
            ("ac07-e6", "ac07-e5"),
            condition="Latest removal date minus effective date is within the policy period.",
            why="The statement sets a period; the period is the client's.",
            extract=("Effective date", "Latest removal date", "Policy period"),
            compare="Days between against the policy period.",
            passes="Within the period.",
            fails="Later than the period.",
            insufficient="Either date is missing.",
            review="The period is not provided.",
            not_infer="Do not assume a period.",
            basis=("DESIGN",),
            confidence="LOW",
            question="How many days after a transfer's effective date does the access policy "
            "allow for removing access the new role does not need?",
            blocks=True,
        ),
    ),
)

# ITGC-AC-08 Emergency (firefighter) access is approved and its activity reviewed

_AC08 = Suite(
    (
        ev(
            "ac08-e1",
            "Emergency access procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "When emergency access may be used",
                "Who approves a checkout",
                "Who reviews the activity log and within how many days",
                "What the reviewer compares the log with",
            ),
        ),
        ev(
            "ac08-e2",
            "Walkthrough instance: one firefighter session from checkout to review",
            "SYSTEM_SCREEN",
            "The reviewer of firefighter activity logs",
            ("DESIGN",),
            "DESIGN",
            "One recent session",
            ("The checkout with its ticket and approval", "The activity log", "The review"),
        ),
        ev(
            "ac08-e3",
            "Firefighter session log from the tool for the window",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Session ID", "User", "Firefighter ID", "Ticket", "Approver", "Start and end"),
            completeness="From the tool's own session log with the query, parameters, run date, "
            "and record count; agreed to the system's sign-in log for the firefighter IDs, so "
            "that a session the tool did not record is found.",
            not_acceptable="The reviewer's own list of sessions reviewed.",
        ),
        ev(
            "ac08-e4",
            "System sign-in log for the firefighter IDs",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            ("Firefighter ID", "Sign-in time", "Terminal or user"),
            completeness="Shows every use of a firefighter ID, against which the tool's session "
            "log is agreed.",
        ),
        ev(
            "ac08-e5",
            "Checkout request and approval for each selected session",
            "TICKET",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected session",
            ("Ticket and its stated purpose", "Approver and role", "Approval time"),
            attributes=("ac08-approved", "ac08-purpose"),
        ),
        ev(
            "ac08-e6",
            "Activity log of each selected session",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected session",
            ("Transaction or command", "Object", "Time"),
            not_acceptable="A summary the user wrote of what they did.",
            attributes=("ac08-purpose", "ac08-reviewed"),
        ),
        ev(
            "ac08-e7",
            "Reviewer's sign-off and investigation for each selected session",
            "DOCUMENT",
            "The reviewer of firefighter activity logs",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected session",
            (
                "Reviewer and role",
                "Review date",
                "Activity outside the purpose and its investigation",
            ),
            attributes=("ac08-reviewed", "ac08-timely"),
        ),
        _changes(
            "ac08-e8",
            "The control owner for user access",
            "the tool, the approvers, the reviewer, or the firefighter IDs",
        ),
    )
)

_AC08_TESTED = ("ac08-approved", "ac08-purpose", "ac08-reviewed")

ACCESS_FIREFIGHTER = Definition(
    library_key="access-firefighter",
    control_ref="ITGC-AC-08",
    version=4,
    objective="Emergency privileged access is used only with approval, for the purpose "
    "approved, and every session's activity is reviewed.",
    control_type="DETECTIVE",
    performer="The reviewer of firefighter activity logs",
    reviewer="None: the review is the control",
    trigger="A firefighter session",
    population="Every firefighter session in the period from the tool's session log, agreed to "
    "the system's sign-in log for the firefighter IDs.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_AC08.items,
    procedures=(
        _AC08.proc(
            "d-1",
            "DESIGN",
            "Understand when emergency access may be used, who approves it, and how its "
            "activity is reviewed.",
            "Read the emergency access procedure; identify the firefighter IDs, the approver, "
            "the reviewer, the days allowed for review, and what the reviewer compares the "
            "activity log with.",
            (
                read_design("the emergency access procedure", ("ac08-e1",)),
                client_values(
                    "the emergency access tool, the approver, the reviewer, and the "
                    "number of days the emergency access procedure allows for review"
                ),
                information_used(
                    "the tool's session log and the activity log", ("ac08-e3", "ac08-e4")
                ),
            ),
        ),
        _AC08.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one session from the checkout through the activity log to the review, asking "
            "the reviewer how they judge activity against the ticket; confirm the approver's "
            "and reviewer's independence from the user; assess whether approval before use and "
            "review of every session address the risk.",
            (
                walkthrough("a firefighter session", ("ac08-e2",)),
                authority("the approver and the reviewer of emergency access"),
                assess_design(
                    "a firefighter ID cannot be used without a checkout against a ticket and an "
                    "approval; the activity log is the system's own and the user cannot alter "
                    "it; a reviewer independent of the user reads every session's log against "
                    "the ticket within the period; and activity beyond the purpose is "
                    "investigated."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC08.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of firefighter sessions for the window.",
            "Obtain every session in the window from the tool's session log, with the query's "
            "parameters and record count, and agree it to the system's sign-in log for the "
            "firefighter IDs before any sample is selected.",
            (
                obtain_population("firefighter sessions", ("ac08-e3",)),
                validate_population(
                    "the system's sign-in log for the firefighter IDs", ("ac08-e3", "ac08-e4")
                ),
            ),
        ),
        _AC08.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select sessions at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "firefighter sessions"),),
        ),
        _AC08.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected session was approved before use for a stated "
            "purpose, its activity stayed within that purpose, and a reviewer other than the "
            "user reviewed the log within the period.",
            "For each selected session, find the checkout ticket and approval and compare the "
            "approval time with the session start; read the activity log against the ticket's "
            "purpose; find the reviewer's sign-off, compare the reviewer with the user, and "
            "compare the review date with the session end and the period allowed.",
            (
                step(
                    "Find the checkout ticket and the approval; compare the approver with the "
                    "procedure's approver and with the user, and the approval time with the "
                    "session start.",
                    ("ac08-e5", "ac08-e3"),
                    "Ticket, stated purpose, approver, approval time, and session start.",
                    "No approval, approval by the user, or approval after the session started "
                    "is an exception.",
                ),
                step(
                    "Read the activity log and list each transaction or command; compare each "
                    "with the ticket's stated purpose.",
                    ("ac08-e6", "ac08-e5"),
                    "Each activity, and whether it fits the purpose.",
                    "Activity outside the purpose that the reviewer did not investigate is an "
                    "exception; whether borderline activity fits is recorded for a person.",
                ),
                step(
                    "Find the reviewer's sign-off; compare the reviewer with the user and the "
                    "approver, and compute the days from the session end to the review.",
                    ("ac08-e7", "ac08-e3"),
                    "Reviewer, role, review date, session end, days between, and the period.",
                    "No review, a review by the user, or a review later than the period is an "
                    "exception; where the period is not recorded the attribute waits for the "
                    "client's value.",
                ),
            ),
            ("ac08-approved", "ac08-purpose", "ac08-reviewed", "ac08-timely"),
        ),
        _AC08.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per session and attribute, cited to the evidence.",
            (evaluate_exceptions("session"), conclude("interim")),
        ),
        _AC08.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the tool, the approvers, the reviewer, or the firefighter IDs "
            "changed since the interim date; obtain and validate the remaining period's "
            "sessions; test an update sample against the same attributes; record the results.",
            (
                inquire_changes(("ac08-e8",)),
                obtain_population("firefighter sessions", ("ac08-e3",), "the remaining period"),
                validate_population(
                    "the system's sign-in log for the firefighter IDs", ("ac08-e3", "ac08-e4")
                ),
                update_sample("firefighter sessions"),
                conclude("roll-forward"),
            ),
            _AC08_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC08.attr(
            "ac08-approved",
            "The session was checked out against a ticket and approved by the approver the "
            "procedure names, before the session started",
            ("ac08-e5", "ac08-e3"),
            condition="A ticket, and an approval by the named approver timed before the start.",
            why="The statement says access is checked out against a ticket and approved before "
            "use.",
            extract=("Ticket", "Approver", "Approval time", "Session start"),
            compare="Approver against the procedure; approval time against the start.",
            passes="Approved by the named approver before the start.",
            fails="No ticket or approval, the user approving, or approval after the start.",
            insufficient="The checkout record is not provided.",
            review="The approver is a delegate without a documented delegation.",
            not_infer="Do not treat the tool's automatic checkout as an approval.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC08.attr(
            "ac08-purpose",
            "The session's logged activity stayed within the ticket's stated purpose, or any "
            "activity beyond it was investigated by the reviewer",
            ("ac08-e6", "ac08-e5"),
            condition="Each logged activity fits the purpose, or the review records an "
            "investigation of it.",
            why="The statement says activity beyond the ticket's purpose is investigated; that "
            "is what the review is for.",
            extract=("Activities", "Purpose", "Investigation"),
            compare="Each activity against the purpose; activity outside it against the "
            "investigation.",
            passes="All within the purpose, or the rest investigated.",
            fails="Activity outside the purpose with no investigation.",
            insufficient="The activity log is not the system's own, or is incomplete.",
            review="Whether an activity fits the purpose is a judgment; a person decides.",
            not_infer="Do not accept the user's summary as the activity log.",
            basis=("DESIGN", "AS2201.44"),
            confidence="MODERATE",
            assumptions=(
                "Whether activity fits a purpose is the reviewer's judgment; the tester "
                "confirms the review addressed it.",
            ),
        ),
        _AC08.attr(
            "ac08-reviewed",
            "The session's activity log was reviewed and signed off by the reviewer the "
            "procedure names, who is not the session's user",
            ("ac08-e7", "ac08-e6"),
            condition="A dated sign-off by the named reviewer, who differs from the user.",
            why="The review is the control.",
            extract=("Reviewer", "Review date", "User"),
            compare="The reviewer against the procedure and the user.",
            passes="Reviewed and signed by the named reviewer.",
            fails="No review, or the user reviewing their own session.",
            insufficient="The sign-off is not provided.",
            review="The sign-off is a tool status without the reviewer's name.",
            not_infer="Do not treat closing the session as its review.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
        _AC08.attr(
            "ac08-timely",
            "The review was completed within [the number of days the emergency access "
            "procedure allows for review] of the session's end",
            ("ac08-e7", "ac08-e3"),
            condition="Review date minus session end is within the period.",
            why="A review long after the session leaves unauthorized activity in place.",
            extract=("Session end", "Review date", "Period"),
            compare="Days between against the period.",
            passes="Within the period.",
            fails="Later than the period.",
            insufficient="Either date is missing.",
            review="The period is not provided.",
            not_infer="Do not assume a period.",
            basis=("DESIGN",),
            confidence="LOW",
            question="How many days after a firefighter session does the procedure allow for "
            "the review of its activity log?",
            blocks=True,
        ),
    ),
)

# ITGC-AC-09 Third-party accounts are sponsored, time-limited, and reviewed

_AC09 = Suite(
    (
        ev(
            "ac09-e1",
            "Third-party access procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "How third-party accounts are identified in the system",
                "Who sponsors and approves them",
                "How the expiry date is set",
                "Who reviews them each quarter",
            ),
        ),
        ev(
            "ac09-e2",
            "Walkthrough instance: one quarterly review with its listing and disablements",
            "DOCUMENT",
            "The reviewer of third-party accounts",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The listing", "The sponsor confirmations", "The sign-off", "Accounts disabled"),
        ),
        _quarters("ac09-e3", "The control owner for user access", "third-party account reviews"),
        ev(
            "ac09-e4",
            "Third-party account listing each selected review covered, with how it was produced",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "Account",
                "Third party",
                "Sponsor",
                "Expiry date",
                "Report and parameters",
                "Date produced",
                "Record count",
            ),
            completeness="Agreed to the system's accounts of the third-party type at the "
            "production date.",
            attributes=("ac09-complete",),
        ),
        ev(
            "ac09-e5",
            "System account list with account types at each production date",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected listing",
            ("Account", "Account type", "Expiry date set in the system", "Status"),
            attributes=("ac09-complete", "ac09-expiry"),
        ),
        ev(
            "ac09-e6",
            "Sponsor approval for each account on a selected listing",
            "TICKET",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each account on a selected listing",
            ("Sponsor and role", "Approval date", "Engagement end date"),
            attributes=("ac09-sponsored", "ac09-expiry"),
        ),
        ev(
            "ac09-e7",
            "Reviewer's decisions, sign-off, and disablement records for each selected review",
            "DOCUMENT",
            "The reviewer of third-party accounts",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Decision per account", "Signer and date", "Disable records with dates"),
            attributes=("ac09-reviewed",),
        ),
        _changes(
            "ac09-e8",
            "The control owner for user access",
            "the procedure, the reviewer, or how third-party accounts are identified",
        ),
    )
)

_AC09_TESTED = ("ac09-complete", "ac09-sponsored", "ac09-expiry", "ac09-reviewed")

ACCESS_THIRD_PARTY = Definition(
    library_key="access-third-party",
    control_ref="ITGC-AC-09",
    version=4,
    objective="Every third-party account has an accountable sponsor, an approval, and an "
    "expiry, and is confirmed or disabled each quarter.",
    control_type="DETECTIVE",
    performer="The reviewer of third-party accounts",
    reviewer="None: the review is the control",
    trigger="The quarterly review cycle",
    population="The quarterly reviews in the period, each with the listing of third-party "
    "accounts agreed to the system's accounts of that type.",
    sampling=sampling("QUARTERLY"),
    evidence=_AC09.items,
    procedures=(
        _AC09.proc(
            "d-1",
            "DESIGN",
            "Understand how third-party accounts are identified, sponsored, expired, and reviewed.",
            "Read the third-party access procedure; identify how the system marks a third-party "
            "account, who sponsors and approves it, how its expiry is set, and who reviews the "
            "listing each quarter.",
            (
                read_design("the third-party access procedure", ("ac09-e1",)),
                client_values(
                    "the role that reviews third-party accounts and the role that "
                    "administers access"
                ),
                information_used("the third-party account listing", ("ac09-e4",)),
            ),
        ),
        _AC09.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one quarterly review from the listing's production to the accounts disabled, "
            "asking the reviewer how they confirm an engagement continues; confirm the "
            "reviewer's knowledge; assess whether sponsorship, expiry, and the review address "
            "the risk.",
            (
                walkthrough("a quarterly third-party account review", ("ac09-e2",)),
                authority("the reviewer and the sponsors of third-party accounts"),
                assess_design(
                    "the system distinguishes third-party accounts so the listing is complete; "
                    "each account has a named internal sponsor and an approval; the expiry set "
                    "in the system is no later than the engagement's end; and the reviewer "
                    "confirms or disables each account each quarter."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC09.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly reviews performed in the window against the one expected per "
            "quarter; select reviews at random with the firm's size for a quarterly control.",
            (
                _quarter_list("ac09-e3", "third-party account reviews"),
                select_sample("a quarterly", "reviews"),
            ),
        ),
        _AC09.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected review covered every third-party account, each "
            "account was sponsored and approved with an expiry within its engagement, and the "
            "review confirmed or disabled each one.",
            "Agree the listing to the system's third-party accounts at its production date; for "
            "each account find the sponsor's approval and compare the expiry set in the system "
            "with the engagement end; inspect the decisions, the sign-off, and the disable "
            "records.",
            (
                step(
                    "Agree the listing to the system's accounts of the third-party type at the "
                    "production date.",
                    ("ac09-e4", "ac09-e5"),
                    "Production date, record counts, and any third-party account not on the "
                    "listing.",
                    "A third-party account missing from the listing is an exception of its "
                    "completeness; accounts whose type the system does not mark are recorded "
                    "for a person.",
                ),
                step(
                    "For each account on the listing, find the sponsor's approval and the "
                    "engagement end date; compare the expiry set in the system with it.",
                    ("ac09-e6", "ac09-e5"),
                    "Per account: sponsor, approval date, engagement end, and the system's expiry.",
                    "No sponsor or approval, no expiry, or an expiry after the engagement end "
                    "is an exception.",
                ),
                step(
                    "Inspect the review's decision for each account, the sign-off, and the "
                    "system record of each account disabled.",
                    ("ac09-e7", "ac09-e5"),
                    "Decisions, signer, date, and each disablement with its date.",
                    "An account without a decision, no sign-off, or a disablement decided but "
                    "not made is an exception.",
                ),
            ),
            _AC09_TESTED,
        ),
        _AC09.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review, account, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("account"), conclude("interim")),
        ),
        _AC09.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the reviewer, or the account typing changed "
            "since the interim date; test the reviews of the remaining period per the "
            "roll-forward table against the same attributes; record the results.",
            (
                inquire_changes(("ac09-e8",)),
                _quarter_remaining("ac09-e3", "third-party account reviews"),
                update_sample("reviews"),
                conclude("roll-forward"),
            ),
            _AC09_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC09.attr(
            "ac09-complete",
            "The listing the reviewer used includes every third-party account in the system at "
            "its production date",
            ("ac09-e4", "ac09-e5"),
            condition="Every account of the third-party type in the system is on the listing.",
            why="A review of an incomplete listing cannot find an account that is not on it "
            "(AS 1105.10).",
            extract=("Production date", "Record counts", "Accounts traced"),
            compare="The system's third-party accounts against the listing.",
            passes="They agree.",
            fails="A third-party account is missing from the listing.",
            insufficient="No production date, or no system list to compare.",
            review="The system does not mark third-party accounts by type.",
            not_infer="Do not assume a listing is complete because it came from the system.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _AC09.attr(
            "ac09-sponsored",
            "Each third-party account has a named internal sponsor and a recorded approval",
            ("ac09-e6",),
            condition="A named employee as sponsor and an approval with its date.",
            why="The statement says each account has a sponsor and an approval; the sponsor is "
            "who is accountable.",
            extract=("Account", "Sponsor", "Approval date"),
            compare="Each account against its sponsor and approval.",
            passes="Sponsored and approved.",
            fails="No sponsor, or no approval.",
            insufficient="The approvals are not provided.",
            review="The sponsor has left the company.",
            not_infer="Do not treat the vendor's own contact as the sponsor.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _AC09.attr(
            "ac09-expiry",
            "The account's expiry date set in the system is no later than the engagement's end "
            "date",
            ("ac09-e5", "ac09-e6"),
            condition="System expiry is on or before the engagement end.",
            why="The statement says the expiry is no later than the engagement's end; an open "
            "account outlives the engagement.",
            extract=("System expiry", "Engagement end"),
            compare="Expiry against the engagement end.",
            passes="On or before.",
            fails="No expiry, or an expiry after the engagement end.",
            insufficient="The engagement end date is not provided.",
            review="The engagement is open-ended under a framework contract.",
            not_infer="Do not take the sponsor's approval date as the expiry.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _AC09.attr(
            "ac09-reviewed",
            "The quarter's review recorded a decision for every account, was signed off, and "
            "every account not confirmed was disabled",
            ("ac09-e7", "ac09-e5"),
            condition="A decision per account, a dated sign-off, and a disable record for each "
            "account not confirmed.",
            why="The statement says the reviewer confirms each account and the rest are disabled.",
            extract=("Decisions", "Signer", "Date", "Disablements"),
            compare="Accounts against decisions; non-confirmed accounts against disable records.",
            passes="Every account decided, signed, and the rest disabled.",
            fails="An account undecided, no sign-off, or a disablement not made.",
            insufficient="The decisions or the disable records are not provided.",
            review="The signer is a delegate without a documented delegation.",
            not_infer="An unsigned listing is not a review.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

# ITGC-AC-10 Segregation-of-duties conflicts are detected and resolved

_AC10 = Suite(
    (
        ev(
            "ac10-e1",
            "Segregation-of-duties ruleset and the review procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "The rules and the business risk each addresses",
                "Who reviews the conflict report and when",
                "What counts as an approved mitigating control",
                "Who approves a rule change",
            ),
        ),
        ev(
            "ac10-e2",
            "Walkthrough instance: one quarterly conflict review",
            "DOCUMENT",
            "The reviewer of conflicts",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The conflict report", "Removals and mitigations", "The sign-off"),
        ),
        _quarters("ac10-e3", "The control owner for user access", "conflict reviews"),
        ev(
            "ac10-e4",
            "Conflict report each selected review covered, with how it was produced",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "User",
                "Conflicting roles",
                "Rule",
                "Report parameters and ruleset version",
                "Date produced",
                "Record count",
            ),
            completeness="Run from the tool against the full ruleset and every user of the "
            "system, with its parameters; the ruleset version is the one in force.",
            not_acceptable="A report run against a subset of rules or users.",
            attributes=("ac10-complete",),
        ),
        ev(
            "ac10-e5",
            "Ruleset in force at each selected review and its change log",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Rules active", "Rule changes with approver and date"),
            attributes=("ac10-complete", "ac10-rules"),
        ),
        ev(
            "ac10-e6",
            "Resolution of each conflict in a selected review",
            "DOCUMENT",
            "The reviewer of conflicts",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each conflict on a selected report",
            ("User and rule", "Removal record with date, or mitigating control and its approval"),
            not_acceptable="A mitigation noted without an approval or without naming the control.",
            attributes=("ac10-resolved",),
        ),
        ev(
            "ac10-e7",
            "Reviewer's sign-off for each selected review",
            "DOCUMENT",
            "The reviewer of conflicts",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Signer and role", "Date", "Report date it refers to"),
            attributes=("ac10-signoff",),
        ),
        _changes(
            "ac10-e8", "The control owner for user access", "the ruleset, the tool, or the reviewer"
        ),
    )
)

_AC10_TESTED = ("ac10-resolved", "ac10-rules", "ac10-signoff")

ACCESS_SOD_RULES = Definition(
    library_key="access-sod-rules",
    control_ref="ITGC-AC-10",
    version=4,
    objective="No user holds a combination of access the ruleset defines as a conflict "
    "without the conflict being removed or mitigated with approval.",
    control_type="DETECTIVE",
    performer="The reviewer of conflicts",
    reviewer="None: the review is the control",
    trigger="The quarterly conflict review",
    population="The quarterly conflict reviews in the period; the conflict report within each "
    "is information used in the control, tested for completeness per review.",
    sampling=sampling("QUARTERLY"),
    evidence=_AC10.items,
    procedures=(
        _AC10.proc(
            "d-1",
            "DESIGN",
            "Understand the ruleset, who reviews conflicts, and what counts as a mitigation.",
            "Read the ruleset and the review procedure; identify the rules and the risk each "
            "addresses, the reviewer, what an approved mitigating control is, and who approves "
            "a rule change.",
            (
                read_design("the ruleset and the conflict review procedure", ("ac10-e1",)),
                client_values(
                    "the segregation-of-duties tool, the ruleset in scope, and the "
                    "role that reviews conflicts and approves rule changes"
                ),
                information_used("the conflict report", ("ac10-e4",)),
            ),
        ),
        _AC10.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one quarterly review from the report's run to each conflict's resolution, "
            "asking the reviewer how they judge a mitigation; confirm the reviewer's knowledge "
            "and that they hold no conflict; assess whether the ruleset, the report, and the "
            "resolutions address the risk.",
            (
                walkthrough("a quarterly conflict review", ("ac10-e2",)),
                authority("the reviewer of conflicts"),
                assess_design(
                    "the ruleset covers the finance processes in scope and changes to it are "
                    "approved; the report runs against every user and every rule; each "
                    "conflict is removed or carries a mitigating control approved by someone "
                    "who understands the risk; and the reviewer holds no conflict themselves."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC10.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly conflict reviews performed in the window against the one "
            "expected per quarter; select reviews at random with the firm's size for a "
            "quarterly control.",
            (_quarter_list("ac10-e3", "conflict reviews"), select_sample("a quarterly", "reviews")),
        ),
        _AC10.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected review ran the full ruleset against every user, "
            "resolved each conflict by removal or approved mitigation, and was signed off; and "
            "whether rule changes in the window were approved.",
            "Agree the report's parameters to the ruleset and the user population; for each "
            "conflict find the removal record or the mitigation and its approval; inspect the "
            "sign-off; inspect the ruleset change log for approvals.",
            (
                step(
                    "Agree the conflict report's parameters to the ruleset version in force "
                    "and to the system's full user population at the report date.",
                    ("ac10-e4", "ac10-e5"),
                    "Report date, ruleset version, rules run, users covered, and record count.",
                    "A report run against fewer rules or users than in force is an exception "
                    "of the report's completeness; where the ruleset in scope is not recorded "
                    "the attribute waits for the client's value.",
                ),
                step(
                    "For each conflict on the report, find the removal in the system's record "
                    "or the mitigating control named and its approval.",
                    ("ac10-e6",),
                    "Per conflict: the removal and date, or the control, its approver, and date.",
                    "A conflict with neither is an exception; whether a mitigation covers the "
                    "risk is the reviewer's judgment, recorded for a person where the record "
                    "is unclear.",
                ),
                step(
                    "Inspect the ruleset change log for the window; find the approval for "
                    "each change.",
                    ("ac10-e5",),
                    "Each rule change, its approver, and date, or the evidence of no change.",
                    "A rule change without approval is an exception.",
                ),
                step(
                    "Inspect the sign-off: the signer, their role, the date, and the report "
                    "it refers to.",
                    ("ac10-e7", "ac10-e4"),
                    "Signer, role, date, and report date.",
                    "No sign-off, or one that refers to a different report, is an exception.",
                ),
            ),
            ("ac10-complete", "ac10-resolved", "ac10-rules", "ac10-signoff"),
        ),
        _AC10.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review, conflict, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("conflict"), conclude("interim")),
        ),
        _AC10.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the ruleset, the tool, or the reviewer changed since the "
            "interim date; test the reviews of the remaining period per the roll-forward table "
            "against the same attributes; record the results.",
            (
                inquire_changes(("ac10-e8",)),
                _quarter_remaining("ac10-e3", "conflict reviews"),
                update_sample("reviews"),
                conclude("roll-forward"),
            ),
            _AC10_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC10.attr(
            "ac10-complete",
            "The conflict report was run against [the segregation-of-duties ruleset] in force "
            "and every user of the system at its production date",
            ("ac10-e4", "ac10-e5"),
            condition="The report's parameters name the full ruleset version in force and the "
            "whole user population.",
            why="A report that runs fewer rules or users cannot find the conflicts outside them "
            "(AS 1105.10); which ruleset is in scope is the client's.",
            extract=("Ruleset version", "Rules run", "Users covered", "Date"),
            compare="Parameters against the ruleset in force and the user population.",
            passes="Full ruleset, every user.",
            fails="A subset of rules or users.",
            insufficient="The parameters are not shown.",
            review="The ruleset in scope is not provided.",
            not_infer="Do not assume the default ruleset is the one in scope.",
            basis=("DESIGN", "AS1105.10"),
            confidence="LOW",
            question="Which segregation-of-duties ruleset (and version) is in scope for the "
            "system, and does it cover every user?",
            blocks=True,
        ),
        _AC10.attr(
            "ac10-resolved",
            "Each conflict on the report was removed in the system, or carries a named "
            "mitigating control with a recorded approval",
            ("ac10-e6",),
            condition="A removal record, or a named control and an approval, per conflict.",
            why="The statement says each conflict is removed or mitigated with approval; an "
            "unresolved conflict is the risk.",
            extract=("Conflict", "Removal date", "Mitigating control", "Approver"),
            compare="Each conflict against its resolution.",
            passes="Every conflict removed or mitigated with approval.",
            fails="A conflict with neither.",
            insufficient="The resolutions are not provided.",
            review="Whether a mitigating control covers the risk is a judgment.",
            not_infer="A note that a conflict is 'accepted' is not a mitigation.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC10.attr(
            "ac10-rules",
            "Each change to the ruleset in the period was approved by the reviewer the "
            "procedure names",
            ("ac10-e5",),
            condition="Each rule change in the log has an approval by the named reviewer.",
            why="The statement says changes to the ruleset are approved; an unapproved change "
            "can silence a rule.",
            extract=("Rule change", "Approver", "Date"),
            compare="Each change against its approval.",
            passes="Every change approved, or no change.",
            fails="A change without approval.",
            insufficient="No change log.",
            review="The tool keeps no change log: a person decides an alternative.",
            not_infer="Do not infer no changes from the absence of a log.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _AC10.attr(
            "ac10-signoff",
            "The quarter's review was signed off by the reviewer, referring to the report "
            "produced on a recorded date",
            ("ac10-e7", "ac10-e4"),
            condition="A dated sign-off by the reviewer on the report with its production date.",
            why="Without the sign-off there is no evidence the review happened.",
            extract=("Signer", "Role", "Date", "Report date"),
            compare="The signer against the procedure's reviewer and the report's date.",
            passes="Signed by the reviewer, on the dated report.",
            fails="No sign-off, or one for a different report.",
            insufficient="The sign-off is not provided.",
            review="The signer is a delegate without a documented delegation.",
            not_infer="A tool status is not a sign-off.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

# ITGC-AC-11 Direct database and operating-system access is restricted and logged

_AC11 = Suite(
    (
        ev(
            "ac11-e1",
            "Infrastructure access procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which roles may hold database and operating-system access",
                "Who reviews each quarter",
                "What privileged activity is logged and where",
                "Who can alter the log",
            ),
        ),
        ev(
            "ac11-e2",
            "Walkthrough instance: one quarterly review with its listings and removals",
            "DOCUMENT",
            "The reviewer of infrastructure access",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The database and operating-system listings", "Decisions and sign-off", "Removals"),
        ),
        _quarters("ac11-e3", "The control owner for user access", "infrastructure access reviews"),
        ev(
            "ac11-e4",
            "Database and operating-system account listings each selected review covered",
            "SYSTEM_REPORT",
            "The infrastructure administrators",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "Layer",
                "Account",
                "Privilege",
                "Command or query used to produce it",
                "Date produced",
                "Record count",
            ),
            completeness="Produced from each layer's own catalogue of accounts and privileges, "
            "with the command used, and agreed to it.",
            attributes=("ac11-complete",),
        ),
        ev(
            "ac11-e5",
            "Each layer's account and privilege catalogue at the production date",
            "SYSTEM_REPORT",
            "The infrastructure administrators",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected listing",
            ("Account", "Privilege", "Account type"),
            attributes=("ac11-complete", "ac11-restricted"),
        ),
        ev(
            "ac11-e6",
            "Reviewer's decisions, sign-off, and removal records for each selected review",
            "DOCUMENT",
            "The reviewer of infrastructure access",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Decision per account", "Signer and date", "Removal records with dates"),
            attributes=("ac11-restricted", "ac11-reviewed"),
        ),
        ev(
            "ac11-e7",
            "Privileged activity logging configuration at each layer",
            "CONFIGURATION",
            "The infrastructure administrators",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the interim date and at period end",
            (
                "Logging enabled for privileged activity",
                "Log destination",
                "Accounts able to alter or delete the log",
                "Date shown",
            ),
            not_acceptable="A statement that logging is on, without the configuration.",
            attributes=("ac11-logged",),
        ),
        _changes(
            "ac11-e8",
            "The control owner for user access",
            "the layers, the administrators, the reviewer, or the logging",
        ),
    )
)

_AC11_TESTED = ("ac11-complete", "ac11-restricted", "ac11-reviewed", "ac11-logged")

ACCESS_DIRECT_DB_OS = Definition(
    library_key="access-direct-db-os",
    control_ref="ITGC-AC-11",
    version=4,
    objective="Only named administrators can reach the database and operating system directly, "
    "their access is reviewed each quarter, and what they do there is logged beyond their "
    "reach.",
    control_type="DETECTIVE",
    performer="The reviewer of infrastructure access",
    reviewer="None: the review is the control",
    trigger="The quarterly review cycle",
    population="The quarterly reviews in the period, each with the database and "
    "operating-system account listings agreed to each layer's catalogue.",
    sampling=sampling("QUARTERLY"),
    evidence=_AC11.items,
    procedures=(
        _AC11.proc(
            "d-1",
            "DESIGN",
            "Understand who may reach each layer, how the listings are produced, and how "
            "privileged activity is logged.",
            "Read the infrastructure access procedure; identify the roles allowed direct access "
            "at each layer, the reviewer, how each layer's account listing is produced, and "
            "what is logged and where.",
            (
                read_design("the infrastructure access procedure", ("ac11-e1",)),
                client_values(
                    "the role allowed direct database and operating-system access, "
                    "and the role that reviews infrastructure access"
                ),
                information_used("each layer's account and privilege listing", ("ac11-e4",)),
            ),
        ),
        _AC11.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one quarterly review from the listings' production to the removals, asking "
            "the reviewer how they know who needs each layer; inspect the logging "
            "configuration; confirm the reviewer is not one of the administrators; assess "
            "whether the restriction, the review, and the logging address the risk.",
            (
                walkthrough("a quarterly infrastructure access review", ("ac11-e2",)),
                step(
                    "Inspect the privileged activity logging configuration at each layer: "
                    "what is logged, where it is sent, and who can alter or delete it.",
                    ("ac11-e7",),
                    "Per layer: the logging setting, destination, and the accounts able to "
                    "alter the log.",
                    "A log the administrators can alter, or privileged activity not logged, "
                    "is a design gap for a person to assess.",
                ),
                authority("the reviewer of infrastructure access"),
                assess_design(
                    "the listings come from each layer's own catalogue; only the named "
                    "administrator roles hold direct access; the reviewer, who is not an "
                    "administrator, confirms or removes each account each quarter; and "
                    "privileged activity is logged where the administrators cannot alter it."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC11.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly reviews performed in the window against the one expected per "
            "quarter; select reviews at random with the firm's size for a quarterly control.",
            (
                _quarter_list("ac11-e3", "infrastructure access reviews"),
                select_sample("a quarterly", "reviews"),
            ),
        ),
        _AC11.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected review covered every account at each layer, "
            "access was limited to the named roles, the review confirmed or removed each "
            "account, and privileged activity stayed logged.",
            "Agree each layer's listing to its catalogue at the production date; compare the "
            "accounts with the roles allowed; inspect the decisions, sign-off, and removals; "
            "inspect the logging configuration for the window.",
            (
                step(
                    "Agree each layer's listing to the layer's own catalogue of accounts and "
                    "privileges at the production date, using the command that produced it.",
                    ("ac11-e4", "ac11-e5"),
                    "Per layer: production date, command, record counts, and any account not "
                    "on the listing.",
                    "A privileged account missing from a listing is an exception of its "
                    "completeness.",
                ),
                step(
                    "Compare each account with direct access with the roles the procedure "
                    "allows, and read the reviewer's decision for it.",
                    ("ac11-e5", "ac11-e6"),
                    "Per account: privilege, the role it belongs to, and the decision.",
                    "An account outside the allowed roles that the review did not remove is an "
                    "exception; an account without a decision is an exception.",
                ),
                step(
                    "Inspect the sign-off and the system record of each removal decided.",
                    ("ac11-e6", "ac11-e5"),
                    "Signer, role, date, and each removal with its date.",
                    "No sign-off, or a removal decided but not made, is an exception.",
                ),
                step(
                    "Inspect the logging configuration at each layer as at the window's end "
                    "and confirm privileged activity is logged to a destination the "
                    "administrators cannot alter.",
                    ("ac11-e7",),
                    "Per layer: the setting, destination, and who can alter the log.",
                    "Logging off, or a log the administrators can alter, is an exception.",
                ),
            ),
            _AC11_TESTED,
        ),
        _AC11.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review, account, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("account"), conclude("interim")),
        ),
        _AC11.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the layers, the administrators, the reviewer, or the logging "
            "changed since the interim date; test the reviews of the remaining period per the "
            "roll-forward table against the same attributes; inspect the logging configuration "
            "at period end; record the results.",
            (
                inquire_changes(("ac11-e8",)),
                _quarter_remaining("ac11-e3", "infrastructure access reviews"),
                update_sample("reviews"),
                step(
                    "Inspect the logging configuration at each layer as at period end and "
                    "agree it to the interim result.",
                    ("ac11-e7",),
                    "Per layer: the period-end setting against the interim setting.",
                    "A change that turned logging off or opened the log to administrators is "
                    "an exception from its date.",
                ),
                conclude("roll-forward"),
            ),
            _AC11_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC11.attr(
            "ac11-complete",
            "The listings the reviewer used agree to each layer's own catalogue of accounts "
            "and privileges at their production date",
            ("ac11-e4", "ac11-e5"),
            condition="Every privileged account in each layer's catalogue is on the listing.",
            why="A review of an incomplete listing cannot find an account that is not on it "
            "(AS 1105.10).",
            extract=("Layer", "Production date", "Record counts", "Accounts traced"),
            compare="Each catalogue against its listing.",
            passes="They agree at every layer.",
            fails="A privileged account is missing from a listing.",
            insufficient="The command that produced a listing is not shown.",
            review="A layer's catalogue cannot be queried by the client.",
            not_infer="Do not assume a listing is complete because an administrator produced it.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _AC11.attr(
            "ac11-restricted",
            "Every account with direct database or operating-system access belongs to a role "
            "the procedure allows, or was removed by the review",
            ("ac11-e5", "ac11-e6"),
            condition="Each account is within the allowed roles, or the review removed it.",
            why="The statement limits direct access to the named administrator roles.",
            extract=("Account", "Privilege", "Role", "Decision"),
            compare="Each account against the allowed roles and the review's decision.",
            passes="All within the roles, or removed.",
            fails="An account outside the roles left in place.",
            insufficient="The allowed roles are not recorded.",
            review="A service account holds the privilege for an application's own use.",
            not_infer="Do not assume an account is an administrator's from its name.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC11.attr(
            "ac11-reviewed",
            "The quarter's review recorded a decision for every account, was signed off by the "
            "reviewer, and each removal decided was made",
            ("ac11-e6", "ac11-e5"),
            condition="A decision per account, a dated sign-off, and a removal record per "
            "removal decided.",
            why="The statement says the reviewer confirms each account's need and has the rest "
            "removed.",
            extract=("Decisions", "Signer", "Date", "Removals"),
            compare="Accounts against decisions; removal decisions against records.",
            passes="Every account decided, signed, and removals made.",
            fails="An account undecided, no sign-off, or a removal not made.",
            insufficient="The sign-off or the removal records are not provided.",
            review="The reviewer is also an administrator at one layer.",
            not_infer="An unsigned listing is not a review.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
        _AC11.attr(
            "ac11-logged",
            "Privileged activity at the database and operating system is logged to a "
            "destination the administrators cannot alter, as the configuration shows",
            ("ac11-e7",),
            condition="Logging of privileged activity is on at each layer and the log's "
            "destination is outside the administrators' control.",
            why="The statement says activity is logged and the log cannot be altered by the "
            "administrators; without it a change below the application leaves no trace.",
            extract=("Logging setting", "Destination", "Who can alter the log"),
            compare="The configuration against the procedure.",
            passes="Logged, to a destination the administrators cannot alter.",
            fails="Logging off, or a log the administrators can alter or delete.",
            insufficient="The configuration is not shown from the layer, or is undated.",
            review="The log is forwarded to a tool whose access is not in evidence.",
            not_infer="Do not take a policy statement as evidence of the configuration.",
            basis=("DESIGN", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement states the log's protection; an RCM description may "
                "not, so the attribute is marked as an inference.",
            ),
        ),
    ),
)

# ITGC-AC-12 Security events are monitored

_AC12 = Suite(
    (
        ev(
            "ac12-e1",
            "Security monitoring procedure and alert criteria",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which sources are collected",
                "Which alerts the daily review covers",
                "How an alert is investigated and closed",
                "When an alert becomes an incident",
            ),
        ),
        ev(
            "ac12-e2",
            "Walkthrough instance: one day's alert review",
            "SYSTEM_SCREEN",
            "The security operations team",
            ("DESIGN",),
            "DESIGN",
            "One recent day",
            ("The day's alerts", "Each alert's investigation and outcome", "Any escalation"),
        ),
        ev(
            "ac12-e3",
            "Calendar of days in the window",
            "DOCUMENT",
            "The audit team",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Each calendar day",),
            completeness="The days are the population; no system support is needed.",
        ),
        ev(
            "ac12-e4",
            "Alert listing from the monitoring tool for each selected day",
            "SYSTEM_REPORT",
            "The security operations team",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected day",
            (
                "Alert",
                "Rule",
                "Source",
                "Time",
                "Severity",
                "Status",
                "Outcome",
                "Query parameters and record count",
            ),
            completeness="Exported from the tool for the day with its parameters; covers every "
            "alert meeting the criteria, closed or open.",
            not_acceptable="A listing of alerts the team closed: it omits alerts never worked.",
            attributes=("ac12-reviewed",),
        ),
        ev(
            "ac12-e5",
            "Log source configuration and last-received times",
            "CONFIGURATION",
            "The security operations team",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the interim date and at period end",
            ("Source", "Events collected", "Last event received", "Date shown"),
            not_acceptable="A list of intended sources without the tool's own status.",
            attributes=("ac12-sources",),
        ),
        ev(
            "ac12-e6",
            "Investigation record for each alert on a selected day",
            "TICKET",
            "The security operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each alert meeting the criteria on a selected day",
            ("Alert", "Analyst", "Investigation notes", "Outcome", "Closed on", "Incident raised"),
            attributes=("ac12-reviewed", "ac12-escalated"),
        ),
        ev(
            "ac12-e7",
            "Security incidents raised in the window",
            "SYSTEM_REPORT",
            "The security operations team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The window tested",
            ("Incident", "Alert it came from", "Opened", "Status"),
            attributes=("ac12-escalated",),
        ),
        _changes(
            "ac12-e8",
            "The control owner for IT operations",
            "the tool, the sources, the criteria, or the team",
        ),
    )
)

_AC12_TESTED = ("ac12-sources", "ac12-reviewed", "ac12-escalated")

ACCESS_SECURITY_MONITORING = Definition(
    library_key="access-security-monitoring",
    control_ref="ITGC-AC-12",
    version=4,
    objective="Security events from the system are collected, the alerts that matter are "
    "investigated each day, and unauthorized access or change is escalated.",
    control_type="DETECTIVE",
    performer="The security operations team",
    reviewer="None",
    trigger="Each day's alerts",
    population="The days in the period; for each selected day, the alerts meeting the criteria "
    "from the tool, with its completeness support.",
    sampling=sampling("DAILY"),
    evidence=_AC12.items,
    procedures=(
        _AC12.proc(
            "d-1",
            "DESIGN",
            "Understand which events are collected, which alerts are reviewed, and how an "
            "alert is handled.",
            "Read the monitoring procedure and the alert criteria; identify the sources "
            "collected from the system and its infrastructure, the alerts the daily review "
            "covers, and how an alert is investigated, closed, or escalated.",
            (
                read_design(
                    "the security monitoring procedure and the alert criteria", ("ac12-e1",)
                ),
                client_values(
                    "the security monitoring tool, the team that reviews alerts, and "
                    "the alert criteria the daily review covers"
                ),
                information_used("the tool's alert listing", ("ac12-e4",)),
            ),
        ),
        _AC12.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one day's review from the alert listing to each outcome, asking the analyst "
            "how they judge an alert; inspect the source configuration; confirm the team's "
            "competence; assess whether collection, daily review, and escalation address the "
            "risk.",
            (
                walkthrough("a day's alert review", ("ac12-e2",)),
                step(
                    "Inspect the log source configuration: the system's and its "
                    "infrastructure's sources, the events collected, and the last event "
                    "received from each.",
                    ("ac12-e5",),
                    "Each source, events collected, and the last-received time.",
                    "A source not collected, or one silent for longer than the procedure "
                    "allows, is a design gap for a person to assess.",
                ),
                authority("the analysts who review and escalate alerts"),
                assess_design(
                    "the system's authentication, privileged-use, and change events reach the "
                    "tool; the criteria select the alerts that would show unauthorized access "
                    "or change; each is investigated to a recorded outcome the same day; and a "
                    "confirmed one becomes an incident."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC12.proc(
            "o-1",
            "OPERATING",
            "Select the sample of days.",
            "Select days at random from the window with the firm's size for a daily control "
            "and a recorded seed; for each selected day obtain the tool's alert listing with "
            "its parameters and record count.",
            (
                select_sample("a daily", "days"),
                obtain_population(
                    "the selected day's alerts", ("ac12-e3", "ac12-e4"), "each selected day"
                ),
                step(
                    "Confirm the day's listing was produced for every alert meeting the "
                    "criteria, open or closed, by its parameters.",
                    ("ac12-e4", "ac12-e1"),
                    "Parameters, the criteria, and the record count.",
                    "A listing of closed alerts only is insufficient; ask for the day's full "
                    "listing.",
                ),
            ),
        ),
        _AC12.proc(
            "o-2",
            "OPERATING",
            "Determine whether the sources were collected, each alert on the selected days was "
            "investigated to an outcome, and confirmed unauthorized access or change became an "
            "incident.",
            "Inspect the source configuration for the window; for each alert on each selected "
            "day find its investigation and outcome; for each alert whose outcome indicates "
            "unauthorized access or change, find the incident raised.",
            (
                step(
                    "Inspect the source configuration as at the window's end and the "
                    "last-received times; confirm the system's sources were collected through "
                    "the window.",
                    ("ac12-e5",),
                    "Each source and its collection status.",
                    "A source of the system not collected for part of the window is an "
                    "exception for that part.",
                ),
                step(
                    "For each alert on the day meeting the criteria, read the investigation "
                    "record: analyst, notes, outcome, and closure.",
                    ("ac12-e4", "ac12-e6"),
                    "Per alert: analyst, outcome, and closure date, or that the day had none.",
                    "An alert with no investigation, or closed without an outcome, is an "
                    "exception; whether an outcome is reasonable is a judgment for a person.",
                ),
                step(
                    "For each alert whose outcome indicates unauthorized access or change, "
                    "find the security incident raised from it.",
                    ("ac12-e6", "ac12-e7"),
                    "Each such alert and its incident, or that none arose.",
                    "A confirmed unauthorized access or change with no incident is an exception.",
                ),
            ),
            _AC12_TESTED,
        ),
        _AC12.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per day, alert, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("alert"), conclude("interim")),
        ),
        _AC12.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the tool, the sources, the criteria, or the team changed since "
            "the interim date; select an update sample of days from the remaining period and "
            "test each against the same attributes; inspect the source configuration at period "
            "end; record the results.",
            (
                inquire_changes(("ac12-e8",)),
                update_sample("days"),
                step(
                    "Inspect the source configuration as at period end and agree it to the "
                    "interim result.",
                    ("ac12-e5",),
                    "Each source at period end against interim.",
                    "A source dropped since interim is an exception from its date.",
                ),
                conclude("roll-forward"),
            ),
            _AC12_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC12.attr(
            "ac12-sources",
            "The system's and its infrastructure's security events were collected by the "
            "monitoring tool throughout the window, as the source configuration and "
            "last-received times show",
            ("ac12-e5",),
            condition="Each in-scope source is configured and received events through the window.",
            why="The statement says events from the system are collected; alerts cannot fire "
            "on events that never arrive.",
            extract=("Sources", "Events collected", "Last received"),
            compare="The configured sources against the system and its infrastructure; the "
            "last-received times against the window.",
            passes="Every in-scope source collected throughout.",
            fails="A source not collected, or silent for part of the window.",
            insufficient="The tool's source status is not shown.",
            review="Which infrastructure components are in scope is not defined.",
            not_infer="Do not take a design document's source list as the configuration.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _AC12.attr(
            "ac12-reviewed",
            "Every alert meeting [the alert criteria the daily review covers] on the selected "
            "day was investigated to a recorded outcome",
            ("ac12-e4", "ac12-e6"),
            condition="Each alert meeting the criteria has an investigation record with an "
            "outcome.",
            why="The daily review is the control; which alerts it must cover is the client's "
            "criteria.",
            extract=("Alerts", "Analyst", "Outcome", "Closure"),
            compare="Alerts meeting the criteria against investigation records.",
            passes="Every such alert investigated with an outcome, or none occurred.",
            fails="An alert with no investigation or no outcome.",
            insufficient="The day's full alert listing is not provided.",
            review="The criteria are not provided.",
            not_infer="Do not assume an auto-closed alert was reviewed.",
            basis=("DESIGN",),
            confidence="LOW",
            question="Which alerts (severities, rules, or sources) does the daily review cover "
            "for the system?",
            blocks=True,
        ),
        _AC12.attr(
            "ac12-escalated",
            "An alert whose investigation found unauthorized access or change was escalated as "
            "a security incident",
            ("ac12-e6", "ac12-e7"),
            condition="Each such outcome has an incident raised from it.",
            why="The statement says a confirmed unauthorized access or change becomes an "
            "incident; without that the finding goes nowhere.",
            extract=("Outcome", "Incident raised"),
            compare="Confirmed outcomes against incidents.",
            passes="Each escalated, or none confirmed.",
            fails="A confirmed finding without an incident.",
            insufficient="The incident log is not provided.",
            review="Whether an outcome counts as unauthorized is a judgment.",
            not_infer="Do not treat a closed alert as proof nothing was found.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
    ),
)

# ITGC-CM-06 Patches are tested and approved

_CM06 = Suite(
    (
        ev(
            "cm06-e1",
            "Patch management procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which patches it covers",
                "Testing required and where",
                "Who approves before production",
                "How an emergency patch is handled",
            ),
        ),
        ev(
            "cm06-e2",
            "Walkthrough instance: one patch from request to production",
            "TICKET",
            "The change manager",
            ("DESIGN",),
            "DESIGN",
            "One recent patch",
            ("The change record", "Test results", "The approval", "The patch history entry"),
        ),
        ev(
            "cm06-e3",
            "Patch history from the system for the window",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Patch ID", "Layer", "Applied on", "Applied by"),
            completeness="From the platform's or database's own patch inventory, with the query, "
            "parameters, run date, and record count.",
            not_acceptable="A list of patch tickets: a patch applied without a ticket is what "
            "the history must show.",
        ),
        ev(
            "cm06-e4",
            "Query parameters and record count for the patch history",
            "SYSTEM_SCREEN",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the history",
            ("Query", "Hosts and layers", "Date range", "Record count"),
            completeness="Shows the history covers every host and layer of the system for the "
            "whole window.",
        ),
        ev(
            "cm06-e5",
            "Change record for each selected patch",
            "TICKET",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected patch",
            ("Change ID", "Patch and hosts", "Requester", "Implementer"),
            attributes=("cm06-record", "cm06-independent"),
        ),
        ev(
            "cm06-e6",
            "Test evidence for each selected patch",
            "DOCUMENT",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected patch",
            ("Environment", "Checks performed", "Result", "Tester", "Date"),
            not_acceptable="A 'tested' status with no result.",
            attributes=("cm06-tested",),
        ),
        ev(
            "cm06-e7",
            "Approval for each selected patch",
            "SYSTEM_SCREEN",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected patch",
            ("Approver and role", "Approval date and time"),
            attributes=("cm06-approved", "cm06-independent"),
        ),
        ev(
            "cm06-e8",
            "Patch history entry for each selected patch",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected patch",
            ("Applied on", "Applied by", "Hosts"),
            attributes=("cm06-record", "cm06-approved", "cm06-tested"),
        ),
        _changes(
            "cm06-e9",
            "The control owner for change management",
            "the procedure, the approver, or the patching tool",
        ),
    )
)

_CM06_TESTED = ("cm06-record", "cm06-tested", "cm06-approved", "cm06-independent")

CHANGE_PATCHING = Definition(
    library_key="change-patching",
    control_ref="ITGC-CM-06",
    version=4,
    objective="Only tested and approved patches reach the production system.",
    control_type="PREVENTIVE",
    performer="The administrator who applies the patch",
    reviewer="The approver of patches",
    trigger="A patch to the operating system, database, or application",
    population="Every patch applied to production in the period, from the system's own patch "
    "history, with completeness support.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM06.items,
    procedures=(
        _CM06.proc(
            "d-1",
            "DESIGN",
            "Understand which patches the procedure covers, how they are tested, and who "
            "approves them.",
            "Read the patch management procedure; identify the layers and patch types it "
            "covers, the testing and environment required, the approver, and how the system "
            "records a patch applied.",
            (
                read_design("the patch management procedure", ("cm06-e1",)),
                client_values("the change management tool and the approver of patches"),
                information_used("the system's patch history", ("cm06-e3", "cm06-e4")),
            ),
        ),
        _CM06.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one patch from the change record through testing and approval to the patch "
            "history, asking the approver what they check; confirm the approver's authority "
            "and independence from the administrator; assess whether testing and approval "
            "before production address the risk.",
            (
                walkthrough("a production patch", ("cm06-e2",)),
                authority("the approver of patches"),
                assess_design(
                    "every patch applied to production is recorded by the platform and tied "
                    "to a change record; it is tested outside production for its effect on "
                    "the system's processing, interfaces, and jobs; an approver who did not "
                    "apply it approves before production; and an emergency patch follows the "
                    "emergency procedure."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM06.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of patches applied in the window.",
            "Obtain every patch applied to production in the window from the system's own "
            "patch history, with the query's parameters and record count, and validate it "
            "before any sample is selected.",
            (
                obtain_population("patches applied to production", ("cm06-e3", "cm06-e4")),
                validate_population(
                    "the platform's installed-patch inventory", ("cm06-e3", "cm06-e4")
                ),
            ),
        ),
        _CM06.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select patches at random from the validated population, with the firm's size for "
            "an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "patches"),),
        ),
        _CM06.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected patch has a change record, was tested outside "
            "production, and was approved before it was applied by someone other than the "
            "administrator who applied it.",
            "For each selected patch, find its change record, test evidence, and approval; "
            "compare the approval time with the applied time; compare the approver with the "
            "procedure's approver and the administrator who applied it.",
            (
                step(
                    "Find the change record for the selected patch and confirm it names the "
                    "patch and hosts the history entry shows.",
                    ("cm06-e5", "cm06-e8"),
                    "Change ID, patch and hosts on the record, and the history entry.",
                    "A patch applied with no change record is an exception.",
                ),
                step(
                    "Inspect the test evidence: environment, checks, result, tester, and date; "
                    "compare the date with the applied date.",
                    ("cm06-e6", "cm06-e8"),
                    "Environment, checks, result, test date, and applied date.",
                    "No result, testing in production, or testing after the patch was applied "
                    "is an exception; a documented waiver is recorded for a person.",
                ),
                step(
                    "Find the approval; compare the approver with the procedure's approver and "
                    "with the administrator who applied the patch; compare the approval time "
                    "with the applied time.",
                    ("cm06-e7", "cm06-e5", "cm06-e8"),
                    "Approver, role, implementer, approval time, and applied time.",
                    "No approval, approval by the administrator who applied it, or approval "
                    "after application is an exception; an emergency patch is tested under "
                    "the emergency procedure and recorded here as such.",
                ),
            ),
            _CM06_TESTED,
        ),
        _CM06.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per patch and attribute, cited to the evidence.",
            (evaluate_exceptions("patch"), conclude("interim")),
        ),
        _CM06.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the approver, or the patching tool changed "
            "since the interim date; obtain and validate the remaining period's patches; test "
            "an update sample against the same attributes; record the results.",
            (
                inquire_changes(("cm06-e9",)),
                obtain_population(
                    "patches applied to production", ("cm06-e3", "cm06-e4"), "the remaining period"
                ),
                validate_population(
                    "the platform's installed-patch inventory", ("cm06-e3", "cm06-e4")
                ),
                update_sample("patches"),
                conclude("roll-forward"),
            ),
            _CM06_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM06.attr(
            "cm06-record",
            "A change record exists for the patch applied, naming the patch and the hosts",
            ("cm06-e5", "cm06-e8"),
            condition="A change record describes this patch on these hosts.",
            why="The statement says each patch is raised in the change tool.",
            extract=("Change ID", "Patch", "Hosts"),
            compare="The record against the patch history entry.",
            passes="A record names the patch and hosts.",
            fails="No record, or a record for a different patch.",
            insufficient="The record is not provided.",
            review="One record covers a batch of patches applied together.",
            not_infer="Do not link a record to a patch by date alone.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM06.attr(
            "cm06-tested",
            "The patch was tested in a non-production environment before it was applied, with "
            "the result documented",
            ("cm06-e6", "cm06-e8"),
            condition="Test evidence names a non-production environment, a result, and a date "
            "before the applied date.",
            why="The statement says patches are tested in a non-production environment.",
            extract=("Environment", "Result", "Test date", "Applied date"),
            compare="Test date against applied date; environment against production.",
            passes="Tested outside production, with a result, before application.",
            fails="No result, tested in production, or tested after application.",
            insufficient="The test evidence is not provided.",
            review="A documented waiver under the procedure.",
            not_infer="A 'tested' status is not test evidence.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM06.attr(
            "cm06-approved",
            "The approver the procedure names approved the patch before it was applied to "
            "production",
            ("cm06-e7", "cm06-e8"),
            condition="An approval by the named approver timed before the applied time.",
            why="The statement requires approval before production.",
            extract=("Approver", "Approval time", "Applied time"),
            compare="Approver against the procedure; approval time against applied time.",
            passes="Approved by the named approver first.",
            fails="No approval, or approval after application.",
            insufficient="The approval or the applied time is not provided.",
            review="An emergency patch approved after the fact under the emergency procedure.",
            not_infer="Do not treat the change record's creation as its approval.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM06.attr(
            "cm06-independent",
            "The approver is not the administrator who applied the patch",
            ("cm06-e7", "cm06-e5"),
            condition="The approver differs from the implementer and the 'applied by'.",
            why="The statement says the approver must not be the administrator applying the "
            "patch; self-approval is no check.",
            extract=("Approver", "Implementer", "Applied by"),
            compare="The approver against both.",
            passes="Different people.",
            fails="The administrator approved their own patch.",
            insufficient="The history does not record who applied the patch.",
            review="The patch was applied by an automated tool under a service account.",
            not_infer="Do not assume independence from titles.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's authority clause states the separation; an RCM "
                "description may not, so the attribute is marked as an inference.",
            ),
        ),
    ),
)

# ITGC-CM-07 Projects follow the development life cycle

_CM07 = Suite(
    (
        ev(
            "cm07-e1",
            "Development life cycle procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which projects and releases it covers",
                "Who approves requirements",
                "Who signs off acceptance testing and against what",
                "Who approves go-live",
            ),
        ),
        ev(
            "cm07-e2",
            "Walkthrough instance: one release from requirements to go-live",
            "DOCUMENT",
            "The project or release manager",
            ("DESIGN",),
            "DESIGN",
            "One recent release",
            (
                "Approved requirements",
                "Acceptance test results and sign-off",
                "Go-live approval",
                "The deployment record",
            ),
        ),
        ev(
            "cm07-e3",
            "Release register for the window",
            "SYSTEM_REPORT",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Project or release", "Scope", "Go-live date", "Approver"),
            completeness="Agreed to the system's deployment log for releases in scope, so that "
            "a release the register omits is found.",
            not_acceptable="The project office's list alone.",
        ),
        ev(
            "cm07-e4",
            "Production deployment log for releases in the window",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            ("Deployment", "Release", "Date"),
            completeness="Shows every release deployed, against which the register is agreed.",
        ),
        ev(
            "cm07-e5",
            "Approved requirements for each selected release",
            "DOCUMENT",
            "The project or release manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected release",
            ("Requirements", "Business owner approval and date"),
            attributes=("cm07-requirements", "cm07-uat"),
        ),
        ev(
            "cm07-e6",
            "Acceptance test results and sign-off for each selected release",
            "DOCUMENT",
            "The project or release manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected release",
            (
                "Test cases mapped to requirements",
                "Results",
                "Defects open at sign-off",
                "Business owner sign-off and date",
            ),
            not_acceptable="A test summary without results per requirement.",
            attributes=("cm07-uat",),
        ),
        ev(
            "cm07-e7",
            "Go-live approval and deployment record for each selected release",
            "SYSTEM_SCREEN",
            "The change manager",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected release",
            ("Approver and role", "Approval date", "Deployment date"),
            attributes=("cm07-golive",),
        ),
        _changes(
            "cm07-e8",
            "The control owner for change management",
            "the procedure, the approvers, or the release path",
        ),
    )
)

_CM07_TESTED = ("cm07-requirements", "cm07-uat", "cm07-golive")

CHANGE_SDLC = Definition(
    library_key="change-sdlc",
    control_ref="ITGC-CM-07",
    version=4,
    objective="A new system or major release reaches production only with approved "
    "requirements, acceptance testing signed off against them, and a go-live approval.",
    control_type="PREVENTIVE",
    performer="The project or release manager",
    reviewer="The business owner and the go-live approver",
    trigger="A project or major release in the development life cycle",
    population="Every project or release the life cycle covers that reached production in the "
    "period, from the release register agreed to the deployment log.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM07.items,
    procedures=(
        _CM07.proc(
            "d-1",
            "DESIGN",
            "Understand which projects the life cycle covers and the approvals it requires.",
            "Read the development life cycle procedure; identify the projects and releases it "
            "covers, who approves requirements, who signs off acceptance testing and against "
            "what, and who approves go-live.",
            (
                read_design("the development life cycle procedure", ("cm07-e1",)),
                client_values("the change management tool and the approver of go-live"),
                information_used(
                    "the release register and the deployment log", ("cm07-e3", "cm07-e4")
                ),
            ),
        ),
        _CM07.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one release from its requirements through acceptance testing to go-live, "
            "asking the business owner how they judged the testing; confirm the owners' and "
            "approver's authority; assess whether the three approvals address the risk.",
            (
                walkthrough("a release under the life cycle", ("cm07-e2",)),
                authority("the business owner and the go-live approver"),
                assess_design(
                    "the requirements come from the business owner who owns the process; "
                    "acceptance tests map to the requirements and the owner signs off their "
                    "results; a go-live approver independent of the project approves before "
                    "production; and a release outside the life cycle cannot reach production "
                    "unnoticed."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM07.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of releases for the window.",
            "Obtain the release register for the window and agree it to the system's "
            "deployment log for releases, so that a release the register omits is found.",
            (
                obtain_population(
                    "projects and releases that reached production", ("cm07-e3", "cm07-e4")
                ),
                validate_population(
                    "the system's deployment log for releases", ("cm07-e3", "cm07-e4")
                ),
            ),
        ),
        _CM07.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select releases at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed; where fewer releases exist than "
            "the size, test them all.",
            (select_sample("an event-driven", "releases"),),
        ),
        _CM07.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected release had approved requirements, acceptance "
            "testing signed off against them, and a go-live approval before deployment.",
            "For each selected release, find the approved requirements, the acceptance test "
            "results mapped to them with the business owner's sign-off, and the go-live "
            "approval; compare the approvers with the procedure and the approval dates with the "
            "deployment date.",
            (
                step(
                    "Find the requirements and the business owner's approval of them; confirm "
                    "the approver owns the process the release affects.",
                    ("cm07-e5",),
                    "Requirements document, approver, role, and date.",
                    "No approved requirements, or approval by someone who does not own the "
                    "process, is an exception.",
                ),
                step(
                    "Read the acceptance test results: cases mapped to the requirements, "
                    "results, defects open at sign-off, and the business owner's sign-off; "
                    "compare the sign-off date with the deployment date.",
                    ("cm07-e6", "cm07-e5", "cm07-e7"),
                    "Coverage of the requirements, results, open defects, signer, and dates.",
                    "No sign-off, a sign-off before testing finished, or requirements without "
                    "a test is an exception; whether open defects were acceptable is the "
                    "owner's judgment, recorded for a person where unclear.",
                ),
                step(
                    "Find the go-live approval; compare the approver with the procedure's and "
                    "with the project team; compare the approval date with the deployment "
                    "date.",
                    ("cm07-e7",),
                    "Approver, role, approval date, and deployment date.",
                    "No approval, approval by the project team, or approval after deployment "
                    "is an exception.",
                ),
            ),
            _CM07_TESTED,
        ),
        _CM07.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per release and attribute, cited to the evidence.",
            (evaluate_exceptions("release"), conclude("interim")),
        ),
        _CM07.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the approvers, or the release path changed "
            "since the interim date; obtain and validate the remaining period's releases; test "
            "each against the same attributes; record the results.",
            (
                inquire_changes(("cm07-e8",)),
                obtain_population(
                    "projects and releases that reached production",
                    ("cm07-e3", "cm07-e4"),
                    "the remaining period",
                ),
                validate_population(
                    "the system's deployment log for releases", ("cm07-e3", "cm07-e4")
                ),
                update_sample("releases"),
                conclude("roll-forward"),
            ),
            _CM07_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM07.attr(
            "cm07-requirements",
            "The release's requirements were approved by the business owner of the process it "
            "affects",
            ("cm07-e5",),
            condition="A requirements document with the business owner's dated approval.",
            why="The statement says requirements are approved by the business owner.",
            extract=("Requirements", "Approver", "Date"),
            compare="The approver against the owner of the process.",
            passes="Approved by the business owner.",
            fails="No approved requirements, or approval by someone else.",
            insufficient="The requirements or approval are not provided.",
            review="The release affects several processes with different owners.",
            not_infer="Do not treat a project charter as approved requirements.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM07.attr(
            "cm07-uat",
            "Acceptance testing covered the approved requirements and was signed off by the "
            "business owner before go-live, with the defects open at sign-off recorded",
            ("cm07-e6", "cm07-e5"),
            condition="Test cases map to each requirement, results are recorded, open defects "
            "are listed, and the owner's sign-off predates deployment.",
            why="The statement says acceptance testing is performed and signed off against the "
            "requirements.",
            extract=("Requirements covered", "Results", "Open defects", "Signer", "Date"),
            compare="Test cases against requirements; sign-off date against deployment.",
            passes="Covered, signed off before go-live.",
            fails="Requirements untested, no sign-off, or sign-off after go-live.",
            insufficient="Results are not mapped to requirements.",
            review="Whether the open defects were acceptable is the owner's judgment.",
            not_infer="A test summary without results per requirement is not coverage.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
        _CM07.attr(
            "cm07-golive",
            "The go-live approver the procedure names, independent of the project team, "
            "approved go-live before the release reached production",
            ("cm07-e7",),
            condition="An approval by the named approver, not on the project team, dated "
            "before deployment.",
            why="The statement requires go-live approval before production by an independent "
            "approver.",
            extract=("Approver", "Role", "Approval date", "Deployment date"),
            compare="Approver against the procedure and the team; dates.",
            passes="Approved first, by the named independent approver.",
            fails="No approval, a team member approving, or approval after deployment.",
            insufficient="The approval or the deployment date is not provided.",
            review="The approver's independence from the project is not documented.",
            not_infer="Do not treat the deployment ticket's approval as go-live approval.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
    ),
)

# ITGC-CM-08 Data migrations are reconciled and approved

_CM08 = Suite(
    (
        ev(
            "cm08-e1",
            "Data migration procedure",
            "POLICY",
            "The control owner for change management",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "What is reconciled (counts, totals) per data object",
                "Who resolves differences",
                "Who approves before cutover",
            ),
        ),
        ev(
            "cm08-e2",
            "Walkthrough instance: one migrated data object from extract to approval",
            "DOCUMENT",
            "The migration team",
            ("DESIGN",),
            "DESIGN",
            "One recent migration or data object",
            ("Source and target extracts", "The reconciliation", "The approval"),
        ),
        ev(
            "cm08-e3",
            "Register of migrations and converted data objects in the window",
            "DOCUMENT",
            "The migration team",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Migration", "Data object", "Cutover date", "Approver"),
            completeness="Agreed to the system's load logs, so that an object loaded without a "
            "reconciliation is found.",
        ),
        ev(
            "cm08-e4",
            "System load logs for migrated data",
            "SYSTEM_LOG",
            "The system administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The window tested",
            ("Load", "Object", "Records loaded", "Date"),
            completeness="Shows every data load, against which the register is agreed.",
        ),
        ev(
            "cm08-e5",
            "Reconciliation for each selected data object",
            "DOCUMENT",
            "The migration team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected data object",
            (
                "Source count and control total",
                "Target count and control total",
                "Difference",
                "Resolution of each difference",
            ),
            not_acceptable="A reconciliation of counts only, without control totals, for "
            "financial data.",
            attributes=("cm08-reconciled", "cm08-resolved"),
        ),
        ev(
            "cm08-e6",
            "Source and target extracts for each selected data object",
            "SYSTEM_REPORT",
            "The migration team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected data object",
            ("Record count", "Control total", "Extract date and parameters"),
            attributes=("cm08-reconciled",),
        ),
        ev(
            "cm08-e7",
            "Approval for each selected data object",
            "DOCUMENT",
            "The migration team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected data object",
            ("Approver and role", "Approval date", "Cutover date"),
            attributes=("cm08-approved",),
        ),
        _changes(
            "cm08-e8",
            "The control owner for change management",
            "the procedure, the approver, or the migration tooling",
        ),
    )
)

_CM08_TESTED = ("cm08-reconciled", "cm08-resolved", "cm08-approved")

CHANGE_DATA_MIGRATION = Definition(
    library_key="change-data-migration",
    control_ref="ITGC-CM-08",
    version=4,
    objective="Data migrated into the system is complete and unaltered, shown by reconciliation "
    "and approved before cutover.",
    control_type="DETECTIVE",
    performer="The migration team",
    reviewer="The approver of migration reconciliations",
    trigger="A migration or conversion of data into the system",
    population="Every data object migrated or converted in the period, from the migration "
    "register agreed to the system's load logs.",
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_CM08.items,
    procedures=(
        _CM08.proc(
            "d-1",
            "DESIGN",
            "Understand what is reconciled for each data object, who resolves differences, and "
            "who approves.",
            "Read the data migration procedure; identify the counts and control totals "
            "reconciled per data object, how a difference is resolved, and who approves before "
            "cutover.",
            (
                read_design("the data migration procedure", ("cm08-e1",)),
                client_values("the approver of migration reconciliations"),
                information_used(
                    "the migration register and the load logs", ("cm08-e3", "cm08-e4")
                ),
            ),
        ),
        _CM08.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one data object from its extracts through the reconciliation to the approval, "
            "asking the team how a difference is traced; confirm the approver owns the data and "
            "did not run the migration; assess whether counts and totals, resolution, and "
            "approval before cutover address the risk.",
            (
                walkthrough("a migrated data object", ("cm08-e2",)),
                authority("the approver of migration reconciliations"),
                assess_design(
                    "every data object loaded is on the register; counts and control totals "
                    "(amounts, not counts alone) are reconciled between source and target; "
                    "each difference is traced to records and corrected or accepted with the "
                    "reason; and the data owner approves before cutover."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _CM08.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of migrated data objects for the window.",
            "Obtain the migration register for the window and agree it to the system's load "
            "logs, so that an object loaded without a reconciliation is found.",
            (
                obtain_population("migrated or converted data objects", ("cm08-e3", "cm08-e4")),
                validate_population("the system's load logs", ("cm08-e3", "cm08-e4")),
            ),
        ),
        _CM08.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select data objects at random from the validated population, with the firm's size "
            "for an event-driven control and a recorded seed; where fewer exist than the size, "
            "test them all.",
            (select_sample("an event-driven", "data objects"),),
        ),
        _CM08.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected data object was reconciled on counts and control "
            "totals to its extracts, each difference resolved, and the reconciliation approved "
            "before cutover.",
            "For each selected object, agree the reconciliation's counts and totals to the "
            "source and target extracts; read the resolution of each difference; find the "
            "approval and compare its date with the cutover date and the approver with the "
            "procedure.",
            (
                step(
                    "Agree the reconciliation's source and target counts and control totals "
                    "to the extracts, and recompute the difference.",
                    ("cm08-e5", "cm08-e6"),
                    "Counts and totals per side, the difference, and the extracts' dates.",
                    "A reconciliation whose figures do not agree to the extracts, or that "
                    "omits control totals for financial data, is an exception.",
                ),
                step(
                    "Read the resolution of each difference: the records traced and the "
                    "correction or the accepted reason.",
                    ("cm08-e5",),
                    "Each difference and its resolution.",
                    "An unresolved difference at cutover is an exception; an acceptance "
                    "without a reason is recorded for a person.",
                ),
                step(
                    "Find the approval; compare the approver with the procedure's and with the "
                    "migration team; compare the approval date with the cutover date.",
                    ("cm08-e7",),
                    "Approver, role, approval date, and cutover date.",
                    "No approval, approval by the team that ran the migration, or approval "
                    "after cutover is an exception.",
                ),
            ),
            _CM08_TESTED,
        ),
        _CM08.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per data object and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("data object"), conclude("interim")),
        ),
        _CM08.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the approver, or the tooling changed since the "
            "interim date; obtain and validate the remaining period's migrations; test each "
            "against the same attributes; record the results.",
            (
                inquire_changes(("cm08-e8",)),
                obtain_population(
                    "migrated or converted data objects",
                    ("cm08-e3", "cm08-e4"),
                    "the remaining period",
                ),
                validate_population("the system's load logs", ("cm08-e3", "cm08-e4")),
                update_sample("data objects"),
                conclude("roll-forward"),
            ),
            _CM08_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _CM08.attr(
            "cm08-reconciled",
            "Record counts and control totals were reconciled between the source and the "
            "target for the data object, and agree to the extracts",
            ("cm08-e5", "cm08-e6"),
            condition="The reconciliation's counts and totals equal the extracts' and the "
            "difference is computed.",
            why="The statement says counts and control totals are reconciled per object.",
            extract=("Source count and total", "Target count and total", "Difference"),
            compare="The reconciliation against the extracts.",
            passes="Reconciled on counts and totals, agreeing to the extracts.",
            fails="Counts only for financial data, or figures that do not agree to the extracts.",
            insufficient="The extracts are not provided.",
            review="A control total the data does not naturally carry (master data).",
            not_infer="Do not accept a reconciliation whose figures were typed in.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _CM08.attr(
            "cm08-resolved",
            "Each difference was traced to its records and corrected, or accepted with a "
            "recorded reason, before cutover",
            ("cm08-e5",),
            condition="Every difference has a resolution dated before cutover.",
            why="The statement says each difference is resolved before cutover.",
            extract=("Differences", "Resolutions", "Dates"),
            compare="Each difference against its resolution and the cutover date.",
            passes="All resolved before cutover.",
            fails="A difference unresolved at cutover.",
            insufficient="The resolutions are not provided.",
            review="Whether an accepted reason is adequate is a judgment.",
            not_infer="A note that a difference is 'immaterial' is not a resolution.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _CM08.attr(
            "cm08-approved",
            "The approver the procedure names, who did not run the migration, approved the "
            "reconciliation before cutover",
            ("cm08-e7",),
            condition="An approval by the named approver, not on the migration team, dated "
            "before cutover.",
            why="The statement requires approval before cutover by the data's owner.",
            extract=("Approver", "Role", "Approval date", "Cutover date"),
            compare="Approver against the procedure and the team; dates.",
            passes="Approved first, by the named approver.",
            fails="No approval, approval by the team, or approval after cutover.",
            insufficient="The approval or the cutover date is not provided.",
            review="The approver's independence from the migration is not documented.",
            not_infer="Do not treat the cutover go decision as the reconciliation's approval.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
    ),
)

# ITGC-OP-06 Interfaces are monitored

_OP06 = Suite(
    (
        ev(
            "op06-e1",
            "Interface inventory and the monitoring procedure",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which interfaces carry financial data",
                "Who reviews the run log and when",
                "How a failure or mismatch is reprocessed",
                "How the resolution is recorded",
            ),
        ),
        ev(
            "op06-e2",
            "Walkthrough instance: one interface failure from the log to its reprocessing",
            "TICKET",
            "The integration support team",
            ("DESIGN",),
            "DESIGN",
            "One recent failure or mismatch",
            ("The run log entry", "The investigation", "The reprocessing with counts"),
        ),
        ev(
            "op06-e3",
            "Calendar of days in the window",
            "DOCUMENT",
            "The audit team",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested",
            ("Each calendar day",),
            completeness="The days are the population; no system support is needed.",
        ),
        ev(
            "op06-e4",
            "Interface run log for each selected day",
            "SYSTEM_REPORT",
            "The integration support team",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected day",
            (
                "Interface",
                "Run time",
                "Status",
                "Records sent",
                "Records received",
                "Errors",
                "Query parameters",
            ),
            completeness="Exported from the integration tool for the day; covers every "
            "financially relevant interface, including runs that did not start.",
            not_acceptable="A report of successful runs only.",
            attributes=("op06-identified",),
        ),
        ev(
            "op06-e5",
            "Daily review record for each selected day",
            "DOCUMENT",
            "The integration support team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected day",
            ("Who reviewed", "When", "Failures and mismatches noted"),
            alternatives=("The tool's alert acknowledgement log",),
            attributes=("op06-identified",),
        ),
        ev(
            "op06-e6",
            "Investigation and reprocessing record for each failure or mismatch",
            "TICKET",
            "The integration support team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each failure or mismatch on a selected day",
            (
                "Interface and run",
                "Cause",
                "Records reprocessed or corrected",
                "Counts after the fix",
                "Resolved by and when",
            ),
            attributes=("op06-resolved", "op06-complete"),
        ),
        ev(
            "op06-e7",
            "Rerun log entry for each failure or mismatch",
            "SYSTEM_LOG",
            "The integration support team",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each failure or mismatch on a selected day",
            ("Rerun time", "Status", "Records sent and received"),
            attributes=("op06-complete",),
        ),
        _changes(
            "op06-e8",
            "The control owner for IT operations",
            "the interfaces, the tool, or the team",
        ),
    )
)

_OP06_TESTED = ("op06-identified", "op06-resolved", "op06-complete")

OPERATIONS_INTERFACES = Definition(
    library_key="operations-interfaces",
    control_ref="ITGC-OP-06",
    version=4,
    objective="Failures and record mismatches of the interfaces that carry financial data are "
    "found each day and the records recovered.",
    control_type="DETECTIVE",
    performer="The integration support team",
    reviewer="None",
    trigger="Each day's interface runs",
    population="The days in the period; for each selected day, the run log of the financially "
    "relevant interfaces, with its completeness support.",
    sampling=sampling("DAILY"),
    evidence=_OP06.items,
    procedures=(
        _OP06.proc(
            "d-1",
            "DESIGN",
            "Understand which interfaces matter, how they are monitored, and how a failure is "
            "recovered.",
            "Read the interface inventory and the monitoring procedure; identify the interfaces "
            "that carry financial data, who reviews the run log and when, and how a failure or "
            "mismatch is reprocessed and recorded.",
            (
                read_design("the interface inventory and the monitoring procedure", ("op06-e1",)),
                client_values(
                    "the integration tool, the team that monitors interfaces, and "
                    "the financially relevant interfaces"
                ),
                information_used("the interface run log", ("op06-e4",)),
            ),
        ),
        _OP06.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one failure from the run log through the investigation to its reprocessing, "
            "asking the operator how they know every record arrived; confirm the team's rights "
            "and competence; assess whether daily review of counts and recovery address the "
            "risk.",
            (
                walkthrough("an interface failure", ("op06-e2",)),
                authority("the operators who review interface runs and reprocess records"),
                assess_design(
                    "the inventory names every interface that carries financial data; the run "
                    "log shows record counts sent and received, not only status; the team "
                    "reviews it each day; and a failure or mismatch is reprocessed until the "
                    "counts agree, with the resolution recorded."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP06.proc(
            "o-1",
            "OPERATING",
            "Select the sample of days.",
            "Select days at random from the window with the firm's size for a daily control "
            "and a recorded seed; for each selected day obtain the run log of the financially "
            "relevant interfaces with its parameters.",
            (
                select_sample("a daily", "days"),
                obtain_population(
                    "the selected day's interface runs", ("op06-e3", "op06-e4"), "each selected day"
                ),
                step(
                    "Confirm the day's run log covers every interface in the inventory, "
                    "including runs that did not start.",
                    ("op06-e4", "op06-e1"),
                    "Interfaces in the inventory, interfaces in the log, and any missing.",
                    "An interface scheduled but absent from the log is treated as a failure "
                    "to investigate; a log of successes only is insufficient.",
                ),
            ),
        ),
        _OP06.proc(
            "o-2",
            "OPERATING",
            "Determine whether each failure or mismatch on the selected days was identified, "
            "investigated, and reprocessed so that the records sent equal the records "
            "received.",
            "From the run log for each selected day, list the failures and count mismatches; "
            "find each one's review record, investigation, and reprocessing; confirm the counts "
            "agree after the fix.",
            (
                step(
                    "List every failed run and every run whose records received differ from "
                    "records sent on the day.",
                    ("op06-e4",),
                    "Each failure or mismatch with the interface, time, and counts, or that "
                    "the day shows none.",
                    "None; a day with no failures passes the dependent attributes as not "
                    "applicable, with the log cited.",
                ),
                step(
                    "For each, find the day's review record noting it and the investigation "
                    "opened.",
                    ("op06-e5", "op06-e6"),
                    "Per failure: the review record and the investigation's reference.",
                    "A failure or mismatch the day's review did not note is an exception.",
                ),
                step(
                    "Read the investigation and the rerun log entry; confirm the records were "
                    "reprocessed or corrected and the counts sent and received agree after "
                    "the fix.",
                    ("op06-e6", "op06-e7"),
                    "Cause, action, rerun time and status, and counts after the fix.",
                    "An unresolved failure, or counts that still differ, is an exception; "
                    "whether a partial reprocessing recovered the records is a judgment for a "
                    "person.",
                ),
            ),
            _OP06_TESTED,
        ),
        _OP06.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per day, failure, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("failure"), conclude("interim")),
        ),
        _OP06.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the interfaces, the tool, or the team changed since the "
            "interim date; select an update sample of days from the remaining period and test "
            "each against the same attributes; record the results.",
            (inquire_changes(("op06-e8",)), update_sample("days"), conclude("roll-forward")),
            _OP06_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP06.attr(
            "op06-identified",
            "Every failed run and every record-count mismatch of [the financially relevant "
            "interfaces] on the selected day was noted by the daily review",
            ("op06-e4", "op06-e5"),
            condition="Each failure or mismatch in the run log appears in the day's review record.",
            why="Monitoring that misses a failure does not detect it; which interfaces are in "
            "scope is the client's.",
            extract=("Failures and mismatches", "Review record"),
            compare="The log's failures and mismatches against the review record.",
            passes="Every one noted, or none occurred.",
            fails="A failure or mismatch not noted.",
            insufficient="No run log with counts, or no review record.",
            review="Which interfaces are financially relevant is not defined.",
            not_infer="A day with no tickets does not mean no failures.",
            basis=("DESIGN", "AS1105.10"),
            confidence="LOW",
            question="Which interfaces carry financial data into or out of the system and are "
            "covered by the daily review?",
            blocks=True,
        ),
        _OP06.attr(
            "op06-resolved",
            "Each failure or mismatch was investigated and the records reprocessed or "
            "corrected, with the resolution recorded",
            ("op06-e6",),
            condition="An investigation record with a cause, an action, and who resolved it "
            "and when.",
            why="The statement says each is investigated and reprocessed or corrected and the "
            "resolution recorded.",
            extract=("Cause", "Action", "Resolved by", "Date"),
            compare="Each failure against its record.",
            passes="Investigated and resolved with a record.",
            fails="No investigation, or closed without an action.",
            insufficient="The record is not provided.",
            review="The resolution was a manual journal rather than a reprocessing.",
            not_infer="A closed ticket without an action is not a resolution.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP06.attr(
            "op06-complete",
            "After the reprocessing, the records received equal the records sent for the run",
            ("op06-e7", "op06-e6"),
            condition="The rerun's or corrected run's counts sent and received agree.",
            why="The statement says the operator confirms the counts agree after the fix; "
            "without that the recovery is unproven.",
            extract=("Records sent", "Records received", "Rerun status"),
            compare="Sent against received after the fix.",
            passes="They agree.",
            fails="They still differ, or no rerun was made.",
            insufficient="The rerun log does not show counts.",
            review="Records were intentionally excluded with the business owner's agreement.",
            not_infer="Do not treat a successful rerun status as proof the counts agree.",
            basis=("DESIGN", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's investigation clause states the count check; an RCM "
                "description may not, so the attribute is marked as an inference.",
            ),
        ),
    ),
)

# ITGC-OP-07 Service organization reports are reviewed

_OP07 = Suite(
    (
        ev(
            "op07-e1",
            "Service organization oversight procedure and the list of service "
            "organizations relied on",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which service organizations are relied on and for what",
                "Who reviews each report",
                "What the review covers (period, scope, opinion, exceptions, "
                "complementary controls)",
                "How a gap to period end is covered",
            ),
        ),
        ev(
            "op07-e2",
            "Walkthrough instance: one report review memo",
            "DOCUMENT",
            "The reviewer of service organization reports",
            ("DESIGN",),
            "DESIGN",
            "One recent review",
            ("The report", "The memo", "The complementary control mapping", "The sign-off"),
        ),
        ev(
            "op07-e3",
            "List of service organizations relied on for the system in the period",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING",),
            "POPULATION",
            "The period",
            ("Service organization", "Service relied on", "Report expected"),
            completeness="Agreed to the system scoping's hosted or outsourced services and to "
            "the vendor master, so that a service organization relied on without a report is "
            "found.",
        ),
        ev(
            "op07-e4",
            "SOC 1 Type 2 report and bridge letter for each service organization",
            "THIRD_PARTY_REPORT",
            "The service organization, through the control owner",
            ("OPERATING",),
            "ATTRIBUTE",
            "The period, with a bridge letter for any gap",
            (
                "Report period",
                "Services and systems in scope",
                "Service auditor's opinion",
                "Exceptions noted",
                "Complementary user entity controls",
                "Bridge letter period and changes",
            ),
            not_acceptable="A SOC 2 report, a Type 1 report, or a report whose period does not "
            "cover the company's period, without a bridge letter.",
            attributes=("op07-coverage", "op07-exceptions", "op07-cuecs"),
        ),
        ev(
            "op07-e5",
            "Reviewer's memo for each service organization",
            "DOCUMENT",
            "The reviewer of service organization reports",
            ("OPERATING",),
            "ATTRIBUTE",
            "Each service organization",
            (
                "Period and scope conclusion",
                "Each exception assessed",
                "Each complementary control mapped to a company control",
                "Reviewer and date",
            ),
            attributes=("op07-coverage", "op07-exceptions", "op07-cuecs", "op07-signoff"),
        ),
        ev(
            "op07-e6",
            "The company controls the complementary user entity controls map to",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING",),
            "ATTRIBUTE",
            "The period",
            ("Complementary control", "Company control", "Where it is tested"),
            attributes=("op07-cuecs",),
        ),
    )
)

_OP07_TESTED = ("op07-coverage", "op07-exceptions", "op07-cuecs", "op07-signoff")

OPERATIONS_SOC_REPORTS = Definition(
    library_key="operations-soc-reports",
    control_ref="ITGC-OP-07",
    version=4,
    objective="Reliance on a service organization's controls rests on a report that covers the "
    "services and the period, read for exceptions, with the company's own complementary "
    "controls in place.",
    control_type="DETECTIVE",
    performer="The reviewer of service organization reports",
    reviewer="None: the review is the control",
    trigger="The annual report cycle for each service organization",
    population="Every service organization relied on for the system in the period.",
    sampling=sampling(
        "ANNUAL", note="Every service organization relied on is reviewed; there is no sample."
    ),
    evidence=_OP07.items,
    procedures=(
        _OP07.proc(
            "d-1",
            "DESIGN",
            "Understand which service organizations are relied on and what the review must cover.",
            "Read the oversight procedure and the list of service organizations; identify the "
            "service relied on from each, the reviewer, what the review covers, and how a gap "
            "between the report's period and the company's period end is covered.",
            (
                read_design("the service organization oversight procedure", ("op07-e1",)),
                client_values(
                    "the service organizations relied on and the role that reviews their reports"
                ),
                assess_design(
                    "every outsourced service the system depends on has a service organization "
                    "on the list; the reviewer can read a SOC 1 report; the review covers "
                    "period, scope, opinion, exceptions, and complementary controls; and a gap "
                    "to period end is bridged or tested."
                ),
            ),
            limitation="The design is assessed from the procedure; the reviews themselves are "
            "the operating evidence.",
        ),
        _OP07.proc(
            "d-2",
            "DESIGN",
            "Confirm the control is implemented (AS 2201.42-.43).",
            "Walk one report review from the report's receipt to the memo's sign-off, asking "
            "the reviewer how they assess an exception and map a complementary control; "
            "confirm the reviewer's competence.",
            (
                walkthrough("a service organization report review", ("op07-e2",)),
                authority("the reviewer of service organization reports"),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP07.proc(
            "o-1",
            "OPERATING",
            "Establish the service organizations relied on in the period.",
            "Obtain the list of service organizations relied on for the system and agree it to "
            "the system scoping's hosted or outsourced services and the vendor master, so that "
            "a reliance without a report is found.",
            (
                step(
                    "Obtain the list of service organizations relied on and agree it to the "
                    "hosted or outsourced services in the system's scoping and to the vendor "
                    "master's IT service vendors.",
                    ("op07-e3",),
                    "Each service organization, the service, and the report expected.",
                    "A service relied on with no service organization on the list is an "
                    "exception of the list's completeness.",
                ),
            ),
        ),
        _OP07.proc(
            "o-2",
            "OPERATING",
            "Determine, for each service organization, whether the report covers the services "
            "and the period with an opinion the company can rely on, exceptions were assessed, "
            "complementary controls are mapped and in place, and the review was signed off.",
            "Read each report's period, scope, opinion, and exceptions and compare with the "
            "company's period and the service relied on; read the bridge letter for any gap; "
            "agree the reviewer's memo to the report; agree each complementary control to a "
            "company control and where it is tested; inspect the sign-off.",
            (
                step(
                    "Read the report's type and period, the services and systems in scope, "
                    "and the opinion; compare with the service relied on and the company's "
                    "period; read the bridge letter for the gap to period end.",
                    ("op07-e4", "op07-e3"),
                    "Type, period, scope, opinion, bridge letter period, and the comparison.",
                    "A Type 1 or SOC 2 report, a period or scope that does not cover the "
                    "reliance, a qualified opinion on the relevant controls, or an unbridged "
                    "gap is recorded for a person: whether reliance stands is their decision.",
                ),
                step(
                    "List the exceptions on the controls relied on and agree the reviewer's "
                    "assessment of each to the memo.",
                    ("op07-e4", "op07-e5"),
                    "Each exception, the control it affects, and the memo's assessment.",
                    "An exception on a relied-on control that the memo does not assess is an "
                    "exception; whether its effect was judged well is for a person.",
                ),
                step(
                    "List the complementary user entity controls and agree each to the "
                    "company control named for it and where that control is tested.",
                    ("op07-e4", "op07-e5", "op07-e6"),
                    "Each complementary control, the company control, and its test.",
                    "A complementary control with no company control, or one not tested, is "
                    "an exception.",
                ),
                step(
                    "Inspect the memo's reviewer, role, and date; compare with the procedure "
                    "and the period.",
                    ("op07-e5",),
                    "Reviewer, role, date.",
                    "No memo, or a memo not signed in the period, is an exception.",
                ),
                evaluate_exceptions("service organization"),
                conclude("period"),
            ),
            _OP07_TESTED,
        ),
    ),
    attributes=(
        _OP07.attr(
            "op07-coverage",
            "A SOC 1 Type 2 report, with a bridge letter for any gap, covers the service relied "
            "on and the company's period, with an unqualified opinion on the controls relied "
            "on",
            ("op07-e4", "op07-e5"),
            condition="Type 2; services and period covered, bridged to period end; opinion "
            "unqualified for the relevant controls.",
            why="The statement says the reviewer confirms the report covers the services and "
            "the period; reliance without coverage is no reliance.",
            extract=("Type", "Period", "Scope", "Opinion", "Bridge letter period"),
            compare="Report period and scope against the reliance and the company's period.",
            passes="Covered and unqualified.",
            fails="Not covered, a Type 1, or a qualified opinion on the controls relied on.",
            insufficient="The report or the bridge letter is not provided.",
            review="A qualification on a control the company does not rely on.",
            not_infer="A report's existence is not coverage.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP07.attr(
            "op07-exceptions",
            "Each exception the report notes on a control relied on was assessed by the "
            "reviewer for its effect on the company's reliance",
            ("op07-e4", "op07-e5"),
            condition="Each relevant exception has an assessment in the memo.",
            why="The statement says the reviewer reads the exceptions; an unassessed exception "
            "leaves the reliance unexamined.",
            extract=("Exceptions", "Controls affected", "Assessments"),
            compare="Exceptions on relied-on controls against the memo.",
            passes="Each assessed, or none noted.",
            fails="A relevant exception not assessed.",
            insufficient="The memo is not provided.",
            review="Whether the assessment is adequate is a judgment.",
            not_infer="Do not treat an unqualified opinion as 'no exceptions'.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP07.attr(
            "op07-cuecs",
            "Each complementary user entity control the report expects is mapped to a company "
            "control that is in place and tested",
            ("op07-e4", "op07-e5", "op07-e6"),
            condition="Every complementary control has a company control named and a test.",
            why="The statement says each complementary control is mapped; the service "
            "organization's controls work only with them.",
            extract=("Complementary controls", "Company controls", "Tests"),
            compare="Each complementary control against its mapping and test.",
            passes="All mapped and tested.",
            fails="One unmapped, or mapped to a control not tested.",
            insufficient="The mapping is not provided.",
            review="A complementary control that does not apply to the company's use.",
            not_infer="Do not assume a company control covers a complementary one by its name.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP07.attr(
            "op07-signoff",
            "The review was recorded in a memo signed by the reviewer the procedure names, in "
            "the period",
            ("op07-e5",),
            condition="A memo with the named reviewer's dated sign-off in the period.",
            why="The statement says the reviewer records the conclusion.",
            extract=("Reviewer", "Role", "Date"),
            compare="The reviewer against the procedure; the date against the period.",
            passes="Signed in the period by the named reviewer.",
            fails="No memo, or not signed in the period.",
            insufficient="The memo is not provided.",
            review="The reviewer is a delegate without a documented delegation.",
            not_infer="A filed report is not a review.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

# ITGC-OP-08 Vulnerabilities are remediated

_OP08 = Suite(
    (
        ev(
            "op08-e1",
            "Vulnerability management policy",
            "POLICY",
            "The control owner for IT operations",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which hosts are scanned and how often",
                "Severity definitions",
                "Remediation time allowed per severity",
                "Who may accept a risk",
            ),
        ),
        ev(
            "op08-e2",
            "Walkthrough instance: one month's scan review",
            "SYSTEM_SCREEN",
            "The security engineering lead",
            ("DESIGN",),
            "DESIGN",
            "One recent month",
            ("The scan results", "Remediation and risk acceptances", "The sign-off"),
        ),
        ev(
            "op08-e3",
            "Schedule of monthly scan reviews performed in the window",
            "DOCUMENT",
            "The control owner for IT operations",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The months in the window",
            ("Month", "Reviewer", "Sign-off date"),
            completeness="One review is expected per month; the schedule is agreed to that "
            "expectation and to the sign-offs.",
        ),
        ev(
            "op08-e4",
            "Scan results for each selected month, with the scope configuration",
            "SYSTEM_REPORT",
            "The security engineering lead",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected month",
            (
                "Host",
                "Finding",
                "Severity",
                "First seen",
                "Status",
                "Remediated on",
                "Hosts in scope and schedule",
            ),
            completeness="Exported from the scanner with the scope configuration, agreed to the "
            "system's server and database inventory, so that an unscanned host is found.",
            not_acceptable="A dashboard screenshot without the host list.",
            attributes=("op08-scope",),
        ),
        ev(
            "op08-e5",
            "Server and database inventory for the system at each selected month",
            "SYSTEM_REPORT",
            "The infrastructure administrators",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected month",
            ("Host", "Role", "Status"),
            attributes=("op08-scope",),
        ),
        ev(
            "op08-e6",
            "Remediation or risk acceptance for each critical or high finding",
            "TICKET",
            "The security engineering lead",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each critical or high finding in a selected month",
            (
                "Finding",
                "Remediated on, with the rescan showing it closed",
                "Or risk acceptance: approver, date, reason, expiry",
            ),
            not_acceptable="A ticket closed without a rescan or an acceptance.",
            attributes=("op08-remediated", "op08-accepted"),
        ),
        ev(
            "op08-e7",
            "Reviewer's sign-off for each selected month",
            "DOCUMENT",
            "The security engineering lead",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected month",
            ("Signer and role", "Date", "Scan it refers to"),
            attributes=("op08-signoff",),
        ),
        _changes(
            "op08-e8",
            "The control owner for IT operations",
            "the scanner, the scope, the policy's times, or the reviewer",
        ),
    )
)

_OP08_TESTED = ("op08-scope", "op08-accepted", "op08-signoff")

OPERATIONS_VULNERABILITIES = Definition(
    library_key="operations-vulnerabilities",
    control_ref="ITGC-OP-08",
    version=4,
    objective="Critical and high vulnerabilities on the system's servers and database are "
    "found each month and remediated within the policy's time or accepted with approval.",
    control_type="DETECTIVE",
    performer="The security engineering lead",
    reviewer="None: the review is the control",
    trigger="Each month's scan",
    population="The monthly scan reviews in the period; the scan within each is information "
    "used in the control, tested for scope per review.",
    sampling=sampling("MONTHLY"),
    evidence=_OP08.items,
    procedures=(
        _OP08.proc(
            "d-1",
            "DESIGN",
            "Understand what is scanned, how severity and remediation time are defined, and "
            "who may accept a risk.",
            "Read the vulnerability management policy; identify the hosts and schedule, the "
            "severity definitions, the remediation time per severity, who reviews the results, "
            "and who may accept a risk.",
            (
                read_design("the vulnerability management policy", ("op08-e1",)),
                client_values(
                    "the vulnerability scanner, the reviewer of findings, the role "
                    "that approves risk acceptances, and the remediation time the "
                    "vulnerability policy allows"
                ),
                information_used("the scan results and scope configuration", ("op08-e4",)),
            ),
        ),
        _OP08.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one month's review from the scan to each finding's remediation or acceptance, "
            "asking the reviewer how they track a finding to its rescan; confirm the reviewer's "
            "and risk acceptor's authority; assess whether scope, time limits, and approved "
            "acceptances address the risk.",
            (
                walkthrough("a monthly scan review", ("op08-e2",)),
                authority("the reviewer of findings and the approver of risk acceptances"),
                assess_design(
                    "every server and database of the system is in the scan scope; findings "
                    "are rated by a defined severity; each critical or high finding is closed "
                    "by a rescan within the time allowed or carries an approved, reasoned, "
                    "expiring risk acceptance; and the reviewer signs each month's review."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _OP08.proc(
            "o-1",
            "OPERATING",
            "Establish the monthly reviews performed in the window and select the sample.",
            "List the monthly scan reviews performed in the window against the one expected "
            "per month; select months at random with the firm's size for a monthly control.",
            (
                step(
                    "List the scan reviews performed in the window with the reviewer and "
                    "sign-off date, and compare with the months the window contains.",
                    ("op08-e3",),
                    "Each month, the review found or missing, and the sign-off date.",
                    "A month with no review is a deviation for that month.",
                ),
                select_sample("a monthly", "monthly reviews"),
            ),
        ),
        _OP08.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected month's scan covered every host of the system, "
            "each critical or high finding was remediated within the time allowed or accepted "
            "with approval, and the review was signed off.",
            "Agree the scan scope to the system's host inventory; for each critical or high "
            "finding compute the days from first seen to remediation and compare with the "
            "policy, or inspect the risk acceptance; inspect the sign-off.",
            (
                step(
                    "Agree the scan's scope configuration and the hosts scanned to the "
                    "system's server and database inventory for the month.",
                    ("op08-e4", "op08-e5"),
                    "Hosts in the inventory, hosts scanned, and any not scanned.",
                    "A host of the system not scanned is an exception of the scan's scope.",
                ),
                step(
                    "For each critical or high finding, find the remediation and the rescan "
                    "showing it closed; compute the days from first seen to remediation and "
                    "compare with the time the policy allows for its severity.",
                    ("op08-e4", "op08-e6"),
                    "Per finding: severity, first seen, remediated on, days, and the time allowed.",
                    "A finding past the time allowed without a risk acceptance is an "
                    "exception; where the time is not recorded the attribute waits for the "
                    "client's value.",
                ),
                step(
                    "For each finding carrying a risk acceptance, read the approver, date, "
                    "reason, and expiry; compare the approver with the policy.",
                    ("op08-e6",),
                    "Approver, date, reason, expiry.",
                    "An acceptance without an approver the policy names, without a reason, or "
                    "past its expiry is an exception; whether the reason is adequate is for a "
                    "person.",
                ),
                step(
                    "Inspect the sign-off: signer, role, date, and the scan it refers to.",
                    ("op08-e7", "op08-e4"),
                    "Signer, role, date, scan.",
                    "No sign-off, or one for a different scan, is an exception.",
                ),
            ),
            ("op08-scope", "op08-remediated", "op08-accepted", "op08-signoff"),
        ),
        _OP08.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per month, finding, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("finding"), conclude("interim")),
        ),
        _OP08.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the scanner, the scope, the policy's times, or the reviewer "
            "changed since the interim date; test the months of the remaining period per the "
            "roll-forward table against the same attributes; record the results.",
            (
                inquire_changes(("op08-e8",)),
                step(
                    "List the scan reviews performed in the remaining period against the "
                    "months it contains.",
                    ("op08-e3",),
                    "Each month and the review found or missing.",
                    "A missing review is a deviation for that month.",
                ),
                update_sample("monthly reviews"),
                conclude("roll-forward"),
            ),
            _OP08_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _OP08.attr(
            "op08-scope",
            "The month's scan covered every server and database of the system, as the scope "
            "configuration and the host inventory show",
            ("op08-e4", "op08-e5"),
            condition="Every host in the inventory was scanned.",
            why="A finding on an unscanned host is never found (AS 1105.10).",
            extract=("Hosts in inventory", "Hosts scanned"),
            compare="The inventory against the hosts scanned.",
            passes="All scanned.",
            fails="A host of the system not scanned.",
            insufficient="The scope configuration or the inventory is not provided.",
            review="A host decommissioned during the month.",
            not_infer="Do not assume the scanner's default scope is the system.",
            basis=("DESIGN", "AS1105.10"),
            confidence="HIGH",
        ),
        _OP08.attr(
            "op08-remediated",
            "Each critical or high finding was remediated, as a rescan shows, within [the "
            "remediation time the vulnerability policy allows] of first being seen, or carries "
            "a risk acceptance",
            ("op08-e4", "op08-e6"),
            condition="Remediated-on minus first-seen is within the time allowed for the "
            "severity, confirmed by rescan, or an acceptance exists.",
            why="The statement sets the time per severity; the time is the client's.",
            extract=("Severity", "First seen", "Remediated on", "Time allowed"),
            compare="Days between against the time allowed; closure against the rescan.",
            passes="Within the time, closed by rescan, or accepted.",
            fails="Past the time with no acceptance, or closed without a rescan.",
            insufficient="First-seen or remediation dates are missing.",
            review="The time allowed is not provided.",
            not_infer="Do not assume a time; do not treat a closed ticket as a rescan.",
            basis=("DESIGN",),
            confidence="LOW",
            question="How many days does the vulnerability policy allow to remediate a "
            "critical and a high finding on the system?",
            blocks=True,
        ),
        _OP08.attr(
            "op08-accepted",
            "Each risk acceptance was approved by the approver the policy names, with a reason "
            "and an expiry not yet passed",
            ("op08-e6",),
            condition="Approver per the policy, a reason, and an unexpired expiry.",
            why="The statement says a finding left open carries an approved acceptance; an "
            "unapproved or expired one leaves the risk unowned.",
            extract=("Approver", "Date", "Reason", "Expiry"),
            compare="The approver against the policy; the expiry against the review date.",
            passes="Approved, reasoned, unexpired.",
            fails="Unapproved, unreasoned, or expired.",
            insufficient="The acceptance is not provided.",
            review="Whether the reason justifies the acceptance is a judgment.",
            not_infer="Do not treat a ticket comment as an approval.",
            basis=("DESIGN",),
            confidence="HIGH",
        ),
        _OP08.attr(
            "op08-signoff",
            "The month's review was signed off by the reviewer, referring to the month's scan",
            ("op08-e7", "op08-e4"),
            condition="A dated sign-off by the reviewer on the month's scan.",
            why="Without the sign-off there is no evidence the review happened.",
            extract=("Signer", "Role", "Date", "Scan"),
            compare="The signer against the policy's reviewer and the scan.",
            passes="Signed by the reviewer on the scan.",
            fails="No sign-off, or one for a different scan.",
            insufficient="The sign-off is not provided.",
            review="The signer is a delegate without a documented delegation.",
            not_infer="A dashboard view is not a sign-off.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    ACCESS_TRANSFER,
    ACCESS_FIREFIGHTER,
    ACCESS_THIRD_PARTY,
    ACCESS_SOD_RULES,
    ACCESS_DIRECT_DB_OS,
    ACCESS_SECURITY_MONITORING,
    CHANGE_PATCHING,
    CHANGE_SDLC,
    CHANGE_DATA_MIGRATION,
    OPERATIONS_INTERFACES,
    OPERATIONS_SOC_REPORTS,
    OPERATIONS_VULNERABILITIES,
)
