"""Version 4 testing definitions for the logical access controls (ITGC-AC-01 to -06).

Each definition carries its standard evidence suite, procedures as numbered steps that
name the evidence they use, and attributes judged from that evidence. Attributes restate
what the control's statement says the performer or system does (basis DESIGN); an
inference the statement does not state is marked as such and MODERATE at most; a value
only the client knows stays LOW with its question. See definitions_support.py.
"""

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

# ITGC-AC-01 New user access is approved

_AC01 = Suite(
    (
        ev(
            "ac01-e1",
            "Access management policy",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period, with its effective date",
            (
                "Who may approve which access (the user's manager; when the application owner)",
                "What a request must name",
                "The rule that access is granted only after approval",
            ),
            not_acceptable="A security policy that does not say who approves access does not "
            "set the criterion the approval is tested against.",
        ),
        ev(
            "ac01-e2",
            "Walkthrough instance: one access request from request to grant",
            "TICKET",
            "The access administrator",
            ("DESIGN",),
            "DESIGN",
            "One recent grant in the period",
            ("The request", "The approvals with their dates", "The grant in the system"),
        ),
        ev(
            "ac01-e3",
            "Population of accounts created and access changes, from the system",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested, from its first to its last day",
            (
                "User ID and name",
                "Role or permission granted",
                "Date granted and granted by",
                "Whether the entry is a new account or a change",
            ),
            completeness="Taken from the system's own user or audit records, not the ticketing "
            "tool; the report or query, its parameters, the run date, and the record count "
            "taken when it ran are provided with it, and a selection of entries is agreed "
            "both ways to the system's change log.",
            not_acceptable="A list of closed access tickets: it shows requests, not grants, "
            "and misses access granted without a ticket.",
        ),
        ev(
            "ac01-e4",
            "Report parameters and record count for the population",
            "SYSTEM_SCREEN",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the population",
            ("Report or query name", "System", "Date range and filters", "Record count"),
            completeness="Shows the population was produced for the whole window without an "
            "excluding filter.",
        ),
        ev(
            "ac01-e5",
            "Access request for each selected grant",
            "TICKET",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected grant",
            (
                "Request ID",
                "User named",
                "Access requested (application, role, permission)",
                "Requester and request date",
            ),
            not_acceptable="An email thread that does not name the access requested.",
            attributes=("ac01-request", "ac01-matches"),
        ),  # fmt: skip
        ev(
            "ac01-e6",
            "Approval record for each selected grant",
            "SYSTEM_SCREEN",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected grant",
            ("Approver name and role", "Approval date and time", "What was approved"),
            not_acceptable="A ticket status of 'approved' with no approver and date.",
            attributes=("ac01-approver", "ac01-before", "ac01-not-self"),
        ),
        ev(
            "ac01-e7",
            "System record of the grant for each selected item",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected grant",
            ("User", "Role or permission as granted", "Grant date and time", "Granted by"),
            not_acceptable="The ticket's closure date: it is not the date the system "
            "recorded the grant.",
            attributes=("ac01-before", "ac01-matches", "ac01-not-self"),
        ),
        ev(
            "ac01-e8",
            "Manager relationship for each selected user",
            "SYSTEM_REPORT",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the approval date of each selected grant",
            ("User", "Manager of record"),
            alternatives=("An organization chart dated in the window",),
            attributes=("ac01-approver",),
        ),
        ev(
            "ac01-e9",
            "Application owner list",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("Application", "Designated owner", "Which access needs the owner's approval"),
            attributes=("ac01-approver",),
        ),
        ev(
            "ac01-e10",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for user access",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the approvers, the tool, or the system",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

ACCESS_PROVISIONING = Definition(
    library_key="access-provisioning",
    control_ref="ITGC-AC-01",
    version=4,
    objective="Only access that an authorized person approved is granted to users.",
    control_type="PREVENTIVE",
    performer="The administrator who grants access",
    reviewer="The user's manager and, where the policy requires it, the application owner",
    trigger="A request for new access or a change to access",
    population=(
        "Every account created and every access change in the period, from the system's own "
        "user or audit records (not from the ticketing tool alone), with the grant date. "
        "Completeness support: the report or query, its parameters, and the record count."
    ),
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_AC01.items,
    procedures=(
        _AC01.proc(
            "d-1",
            "DESIGN",
            "Understand how access is requested, approved, and granted, and who has the "
            "authority to approve it.",
            "Read the access management policy and the request workflow; identify the "
            "approvers the policy names for each kind of access, the administrator who grants, "
            "and the record each step leaves; record the client's values the test depends on.",
            (
                read_design("the access management policy and the request workflow", ("ac01-e1",)),
                client_values(
                    "which access needs the application owner's approval, the request tool, and "
                    "the role that administers access"
                ),
                information_used(
                    "the system's user and role change log the population comes from",
                    ("ac01-e3", "ac01-e4"),
                ),
            ),
        ),
        _AC01.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described by people with the authority "
            "and competence it needs, addresses its risk and is implemented (AS 2201.42-.43).",
            "Walk one recent access request from the request to the grant in the system, "
            "asking the administrator what they compare before granting; confirm the approvers' "
            "authority; assess whether approval before grant, by the manager and owner, "
            "addresses the risk of unapproved access.",
            (
                walkthrough("an access request", ("ac01-e2",)),
                authority("the approvers named in the policy and the administrator"),
                assess_design(
                    "every grant needs a recorded approval by someone who can judge the user's "
                    "need and is not the user; the administrator grants only what was approved, "
                    "and only after the approval; nothing in the workflow lets access be granted "
                    "first and approved later."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC01.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of grants and changes for the window.",
            "Obtain every account created and every access change in the window from the "
            "system's own records, with the report's parameters and record count, and validate "
            "it against the system's change log before any sample is selected.",
            (
                obtain_population("accounts created and access changes", ("ac01-e3", "ac01-e4")),
                validate_population("the system's user or audit log", ("ac01-e3", "ac01-e4")),
            ),
        ),
        _AC01.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select grants at random from the validated population, with the firm's size for "
            "an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "grants and access changes"),),
        ),
        _AC01.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected grant was requested and approved before it was "
            "made, by the approvers the policy requires, for the access granted.",
            "For each selected grant, find its request, compare the approver and approval date "
            "with the policy and the grant date in the system, and compare the access in the "
            "system with the access approved.",
            (
                step(
                    "Find the request for the selected grant and confirm it names the same user "
                    "and the same access (application, role, or permission) as the grant.",
                    ("ac01-e5", "ac01-e7"),
                    "Request ID, the user and access on the request, and the user and access in "
                    "the system record.",
                    "No request, or a request for different access: record the attribute as an "
                    "exception with both records cited.",
                ),
                step(
                    "Identify the approver and compare them with the user's manager of record "
                    "at the approval date and, where the policy requires it for this access, "
                    "with the designated application owner.",
                    ("ac01-e6", "ac01-e8", "ac01-e9"),
                    "Approver name and role, the manager of record, the owner where required, "
                    "and the policy rule applied.",
                    "An approver who is neither the manager nor the required owner is an "
                    "exception; a case the policy does not settle is recorded for a person.",
                ),
                step(
                    "Compare the approval date and time with the grant date and time in the "
                    "system's own record.",
                    ("ac01-e6", "ac01-e7"),
                    "Both timestamps, their time zones if they differ, and the difference.",
                    "A grant before its approval is an exception; same-day entries without "
                    "times are recorded for a person.",
                ),
                step(
                    "Compare the role or permission granted in the system with the access on "
                    "the approved request, and confirm nothing more was granted.",
                    ("ac01-e5", "ac01-e7"),
                    "Access approved and access granted, side by side.",
                    "Access granted beyond the approval is an exception; role names that "
                    "differ between the request and the system are matched with the client's "
                    "role mapping, or recorded for a person.",
                ),
                step(
                    "Confirm the approver is not the user and the administrator who granted the "
                    "access did not approve it.",
                    ("ac01-e6", "ac01-e7"),
                    "The user, the approver, and the person who granted.",
                    "Self-approval, or an administrator approving their own grant, is an "
                    "exception.",
                ),
            ),
            ("ac01-request", "ac01-approver", "ac01-before", "ac01-matches", "ac01-not-self"),
        ),
        _AC01.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per item and attribute, cited to the evidence.",
            (evaluate_exceptions("grant"), conclude("interim")),
        ),
        _AC01.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the control, its approvers, or the system changed since the "
            "interim date; obtain and validate the remaining period's population of grants; "
            "test an update sample against the same attributes; record the results.",
            (
                inquire_changes(("ac01-e10",)),
                obtain_population(
                    "accounts created and access changes",
                    ("ac01-e3", "ac01-e4"),
                    "the remaining period",
                ),  # fmt: skip
                validate_population("the system's user or audit log", ("ac01-e3", "ac01-e4")),
                update_sample("grants and access changes"),
                conclude("roll-forward"),
            ),
            ("ac01-request", "ac01-approver", "ac01-before", "ac01-matches", "ac01-not-self"),
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC01.attr(
            "ac01-request",
            "A request exists that names the user and the specific access (application, role, "
            "or permission) that was granted",
            ("ac01-e5", "ac01-e7"),
            condition="The request identifies the same user and the same access as the grant.",
            why="Without a request naming the access, the approval cannot be tied to what "
            "was granted.",
            extract=("Request ID", "User", "Access requested"),
            compare="User and access on the request against the selected grant.",
            passes="A request names this user and this access.",
            fails="No request exists for a grant that the evidence shows was made, or the "
            "request names different access.",
            insufficient="The request is not provided, or it does not show the access requested.",
            review="The request describes access in business terms that cannot be matched to "
            "the system role without the client's role mapping.",
            not_infer="Do not treat an approval email as a request unless it names the user "
            "and the access.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
            was="A request exists for the access granted",
        ),
        _AC01.attr(
            "ac01-approver",
            "The request was approved by the user's manager and, where the access management "
            "policy requires it, by the application owner",
            ("ac01-e6", "ac01-e8", "ac01-e9"),
            condition="The approver is the user's manager, plus the application owner when "
            "the policy requires it for this access.",
            why="The control description names these approvers; an approval by anyone else "
            "does not meet it.",
            extract=("Approver name and role", "User's manager", "Access type"),
            compare="Approver against the user's manager and, when required, the application "
            "owner list.",
            passes="The required approvers approved.",
            fails="The approval is missing, or given by someone who is not the manager or the "
            "required application owner.",
            insufficient="The approver's relationship to the user cannot be established from "
            "the evidence.",
            review="Which access needs application owner approval is not defined; a person "
            "decides until the policy is provided.",
            not_infer="Do not assume a senior title confers authority.",
            basis=("DESIGN", "KPMG-7.3.10", "AS2201.44"),
            confidence="HIGH",
            assumptions=(
                "The policy defines which access needs application owner approval; "
                "until it is provided that part is reviewed by a person.",
            ),  # fmt: skip
            was="The request was approved by an appropriate person",
        ),
        _AC01.attr(
            "ac01-before",
            "The approval is dated on or before the date the access was granted in the system",
            ("ac01-e6", "ac01-e7"),
            condition="Approval date is on or before the grant date recorded by the system.",
            why="The control is preventive: access granted before approval is not prevented.",
            extract=("Approval date and time", "Grant date and time"),
            compare="Approval date against grant date.",
            passes="Approval is on or before the grant.",
            fails="Approval is after the grant.",
            insufficient="Either date is missing.",
            review="Dates are in different time zones or the same day without times.",
            not_infer="Do not use the ticket closure date as the grant date.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Approval happened before access was granted",
        ),
        _AC01.attr(
            "ac01-matches",
            "The access granted in the system is the access that was approved, and no more",
            ("ac01-e5", "ac01-e7"),
            condition="Access in the system equals the access on the approved request.",
            why="Approval of one role does not authorize another.",
            extract=("Access approved", "Access granted"),
            compare="Granted access against approved access.",
            passes="They match.",
            fails="The user received access not on the approved request.",
            insufficient="The system record of the access granted is not provided.",
            review="Role names differ between the request and the system.",
            not_infer="Do not infer the granted access from the request.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
            was="The access granted matches the access approved",
        ),
        _AC01.attr(
            "ac01-not-self",
            "The approver is not the user, and the administrator who granted the access did "
            "not approve it",
            ("ac01-e6", "ac01-e7"),
            condition="The approver differs from the user and from the person who granted.",
            why="The statement requires that the approver is not the user and that the "
            "administrator does not approve what they grant; an approval by either is not an "
            "independent approval.",
            extract=("User", "Approver", "Granted by"),
            compare="Approver against the user and against the person who granted.",
            passes="Three different people, or the approver differs from both.",
            fails="The user approved their own access, or the administrator approved the "
            "grant they made.",
            insufficient="The system record does not show who granted.",
            review="The grant was made under a shared administrator account.",
            not_infer="Do not assume the ticket assignee is the person who granted.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's authority clause states the separation; the control "
                "description in an RCM may not, so the attribute is marked as an inference.",
            ),  # fmt: skip
        ),
    ),
)

# ITGC-AC-02 Leavers lose access promptly

_AC02 = Suite(
    (
        ev(
            "ac02-e1",
            "Access policy: the removal period for leavers",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "The number of days allowed for removal and whether they are business or "
                "calendar days",
                "From which date they count",
                "Who removes access",
            ),
            not_acceptable="A statement that access is removed 'promptly' or 'timely' sets no "
            "period the test can apply.",
        ),  # fmt: skip
        ev(
            "ac02-e2",
            "Walkthrough instance: one termination from the HR record to the disabled account",
            "SYSTEM_SCREEN",
            "The access administrator",
            ("DESIGN",),
            "DESIGN",
            "One recent termination in the period",
            ("The HR termination record", "How IT received it", "The account's disable record"),
        ),
        ev(
            "ac02-e3",
            "HR termination listing for the window",
            "SYSTEM_REPORT",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The window tested, from its first to its last day",
            ("Employee or contractor ID and name", "Termination date", "Worker type", "Department"),
            completeness="Run from the HR system with its parameters, run date, and record "
            "count; includes contractors and transfers out where the policy covers them; a "
            "selection of leavers is agreed both ways to the HR system's status history.",
            not_acceptable="The list IT received by email during the period: it is what IT "
            "acted on, not the population of terminations.",
        ),  # fmt: skip
        ev(
            "ac02-e4",
            "Report parameters and record count for the termination listing",
            "SYSTEM_SCREEN",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "The run that produced the listing",
            ("Report name", "HR system", "Date range and worker types", "Record count"),
            completeness="Shows the listing covers the whole window and every worker type in "
            "scope.",
        ),
        ev(
            "ac02-e5",
            "System record of each selected leaver's accounts and their disable or removal dates",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected leaver",
            (
                "Each account of the leaver in the system",
                "Status",
                "Date and time disabled or removed",
                "Who disabled it",
            ),
            not_acceptable="A current user listing showing the leaver absent: it shows absence "
            "now, not when access was removed.",
            alternatives=("The system's user change log filtered to the leaver's accounts",),
            attributes=("ac02-removed", "ac02-timely", "ac02-accounts"),
        ),  # fmt: skip
        ev(
            "ac02-e6",
            "Account-to-person mapping for the system",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the window's end",
            ("Account ID", "Person", "Account type"),
            alternatives=("The user master with the employee ID field populated",),
            attributes=("ac02-accounts",),
        ),
        ev(
            "ac02-e7",
            "Activity log after the termination date for a leaver removed late",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "CONTEXT",
            "From the termination date to the removal date of the leaver concerned",
            ("Sign-ins", "Transactions or changes under the account"),
            not_acceptable="Absence of a log is not absence of activity.",
        ),
        ev(
            "ac02-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for user access",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the HR feed, the administrators, or the system",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

ACCESS_TERMINATION = Definition(
    library_key="access-termination",
    control_ref="ITGC-AC-02",
    version=4,
    objective="Leavers' access is removed within the period the policy allows.",
    control_type="PREVENTIVE",
    performer="The administrator who removes access",
    reviewer="None described",
    trigger="A termination on the HR termination list",
    population=(
        "Every termination in the period from the HR system, with termination dates, and its "
        "completeness support. Each leaver is matched to their application accounts."
    ),
    sampling=sampling("EVENT_DRIVEN"),
    evidence=_AC02.items,
    procedures=(
        _AC02.proc(
            "d-1",
            "DESIGN",
            "Understand how terminations reach IT and what the policy requires of the removal.",
            "Read the access policy's removal period and the procedure by which HR terminations "
            "reach the administrator; record the period, the date it counts from, and the HR "
            "system the dates come from.",
            (
                read_design("the access policy and the termination procedure", ("ac02-e1",)),
                client_values(
                    "the number of days the policy allows for removal and whether they are "
                    "business or calendar days, the HR system, and how often IT receives the "
                    "termination list"
                ),
                information_used("the HR termination listing", ("ac02-e3", "ac02-e4")),
            ),
        ),
        _AC02.proc(
            "d-2",
            "DESIGN",
            "Determine whether the control, performed as described, addresses its risk and is "
            "implemented (AS 2201.42-.43).",
            "Walk one recent termination from the HR record through the feed to the disabled "
            "account, asking the administrator how they find every account of a leaver; confirm "
            "their rights to disable; assess whether removal within the period, for every "
            "account, addresses the risk.",
            (
                walkthrough("a termination", ("ac02-e2",)),
                authority("the administrators who disable accounts"),
                assess_design(
                    "every termination reaches the administrator without depending on the "
                    "leaver's manager remembering; every account of the leaver is found, not "
                    "only the primary one; the period is short enough that a leaver cannot act "
                    "in the system after leaving; and a late removal is investigated."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC02.proc(
            "o-1",
            "OPERATING",
            "Obtain and validate the population of terminations for the window.",
            "Obtain every termination in the window from the HR system, with the report's "
            "parameters and record count, and validate it against the HR system's status "
            "history before any sample is selected.",
            (
                obtain_population("terminations", ("ac02-e3", "ac02-e4")),
                validate_population("the HR system's status history", ("ac02-e3", "ac02-e4")),
            ),
        ),
        _AC02.proc(
            "o-2",
            "OPERATING",
            "Select the sample.",
            "Select leavers at random from the validated population, with the firm's size for "
            "an event-driven control and a recorded seed.",
            (select_sample("an event-driven", "leavers"),),
        ),
        _AC02.proc(
            "o-3",
            "OPERATING",
            "Determine whether each selected leaver's access was removed, for every account, "
            "within the policy period.",
            "For each selected leaver, find every account in the application, the date each "
            "was disabled or removed from the system's own record, and compare it with the HR "
            "termination date and the policy period.",
            (
                step(
                    "Find every account that belongs to the selected leaver, using the "
                    "account-to-person mapping or the employee ID on the user master; do not "
                    "stop at the first match.",
                    ("ac02-e6", "ac02-e5"),
                    "The leaver's identifier and each account found, with how it was matched.",
                    "A leaver whose accounts cannot be matched by ID or name is recorded for a "
                    "person; absence of a match is not evidence of no account.",
                ),
                step(
                    "For each account, read the system's own record of the change: the status, "
                    "the date and time it was disabled or removed, and who did it.",
                    ("ac02-e5",),
                    "Per account: status, disable date and time, and the record it comes from.",
                    "An account still active after the policy period is an exception; a current "
                    "listing offered instead of the change record is insufficient evidence.",
                ),
                step(
                    "Compute the days from the HR termination date to the disable date of the "
                    "latest account, in the units the policy uses, and compare with the policy "
                    "period.",
                    ("ac02-e3", "ac02-e5"),
                    "Termination date, latest disable date, days between, the unit, and the "
                    "policy period.",
                    "Removal later than the period is an exception; where the period is not "
                    "recorded the attribute waits for the client's value and is not inferred.",
                ),
            ),
            ("ac02-removed", "ac02-timely", "ac02-accounts"),
        ),
        _AC02.proc(
            "o-4",
            "OPERATING",
            "For a leaver removed late, assess what the access allowed in the gap.",
            "Only when access was removed late: inspect activity on the account between the "
            "termination date and the removal. This informs the deviation's effect; it is not "
            "a control attribute.",
            (
                step(
                    "Obtain the account's activity log from the termination date to the "
                    "removal date and list each sign-in and each transaction or change.",
                    ("ac02-e7",),
                    "Each activity with its date, or the evidence that the log is complete and "
                    "shows none.",
                    "Activity after the termination date is reported to the control owner and "
                    "the business owner for investigation; the agent does not judge its effect.",
                ),
            ),
            (),
            "Absence of activity reduces the effect of a deviation; it does not cure it.",
        ),
        _AC02.proc(
            "o-5",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per leaver and attribute, cited to the evidence.",
            (evaluate_exceptions("leaver"), conclude("interim")),
        ),
        _AC02.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the HR feed, the administrators, or the system changed since "
            "the interim date; obtain and validate the remaining period's terminations; test an "
            "update sample against the same attributes; record the results.",
            (
                inquire_changes(("ac02-e8",)),
                obtain_population("terminations", ("ac02-e3", "ac02-e4"), "the remaining period"),
                validate_population("the HR system's status history", ("ac02-e3", "ac02-e4")),
                update_sample("leavers"),
                conclude("roll-forward"),
            ),
            ("ac02-removed", "ac02-timely", "ac02-accounts"),
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC02.attr(
            "ac02-removed",
            "The leaver's access to the application was disabled or removed, as shown by the "
            "system's own record of the change",
            ("ac02-e5",),
            condition="The system shows the account disabled or removed.",
            why="Removal is the control.",
            extract=("Account ID", "Removal date and time", "Status"),
            compare="Account of the leaver against the system's removal record.",
            passes="The system shows the removal.",
            fails="The account was still active after the removal period.",
            insufficient="Only a current user listing is provided: it shows absence now, not "
            "when access was removed.",
            review="The leaver's account cannot be matched to HR records by name or ID.",
            not_infer="Do not treat absence from a current listing as removal on time.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
            was="The leaver's access was removed",
        ),
        _AC02.attr(
            "ac02-timely",
            "Access was removed within [the number of days in the access policy] of the HR "
            "termination date",
            ("ac02-e3", "ac02-e5"),
            condition="Removal date minus termination date is within the policy period.",
            why="The control promises removal within a set period; the period is not in the "
            "control description.",
            extract=("Termination date", "Removal date", "Policy period"),
            compare="Days between termination and removal against the policy period.",
            passes="Within the policy period.",
            fails="Later than the policy period.",
            insufficient="Either date is missing.",
            review="The policy period is not provided.",
            not_infer="Do not assume a period (such as one day or seven days).",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="LOW",
            question="How many days after the termination date does the client's policy "
            "allow for removing access, and are they business or calendar days?",
            blocks=True,
            was="Removal happened within the agreed timeframe",
        ),
        _AC02.attr(
            "ac02-accounts",
            "Every account of the leaver in the system was disabled or removed, not only the "
            "primary one",
            ("ac02-e5", "ac02-e6"),
            condition="Each account mapped to the leaver shows disabled or removed.",
            why="The statement says the administrator disables the leaver's accounts; a second "
            "account left active gives the leaver the access the control is meant to remove.",
            extract=("Accounts mapped to the leaver", "Status of each"),
            compare="The leaver's accounts from the mapping against the system's status of each.",
            passes="Every mapped account is disabled or removed.",
            fails="An account of the leaver remains active.",
            insufficient="No account-to-person mapping, so the leaver's accounts cannot be "
            "enumerated.",
            review="An account is mapped to the leaver but shared with others.",
            not_infer="Do not assume a leaver has one account because one was disabled.",
            basis=("DESIGN", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The system can map accounts to people; where it cannot, the attribute is "
                "reviewed by a person.",
            ),  # fmt: skip
        ),
    ),
    retired=(
        Retired(
            "The account shows no activity after the termination date",
            "Not part of the control as described (removing access). It assesses the effect "
            "of a late removal, so it is now procedure o-4, performed only on a deviation.",
        ),
    ),
)

# ITGC-AC-03 User access is reviewed periodically

_AC03 = Suite(
    (
        ev(
            "ac03-e1",
            "Access review procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Who reviews which application",
                "What the reviewer checks",
                "The timetable and the deadline for sign-off and changes",
                "How requested changes are tracked",
            ),
        ),  # fmt: skip
        ev(
            "ac03-e2",
            "Walkthrough instance: one completed review with its listing and change tickets",
            "DOCUMENT",
            "The application owner who reviews",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The listing as reviewed", "The decisions", "The sign-off", "The change tickets"),
        ),
        ev(
            "ac03-e3",
            "Schedule of quarterly reviews performed in the window",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters ending in the window",
            ("Quarter", "Application", "Reviewer", "Sign-off date"),
            completeness="One review is expected per quarter per in-scope application; the "
            "schedule is agreed to that expectation and to the sign-offs.",
        ),
        ev(
            "ac03-e4",
            "User listing each selected review covered, with how it was produced",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "User",
                "Roles",
                "Status",
                "Report name and parameters",
                "Date produced",
                "Record count",
            ),
            completeness="Agreed to the system's user list at the production date: record "
            "counts, and a selection of users and roles both ways.",
            not_acceptable="A spreadsheet of users with no production date or source.",
            attributes=("ac03-listing",),
        ),  # fmt: skip
        ev(
            "ac03-e5",
            "System user list at each selected review's production date",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected review's listing",
            ("User", "Roles", "Status"),
            alternatives=(
                "The system's user change log, used to roll a current list back to "
                "the production date",
            ),
            attributes=("ac03-listing",),
        ),  # fmt: skip
        ev(
            "ac03-e6",
            "Reviewer's decisions and sign-off for each selected review",
            "DOCUMENT",
            "The application owner who reviews",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Decision per user (keep, remove, change)", "Signer and role", "Sign-off date"),
            not_acceptable="An email forwarding the listing without decisions.",
            attributes=("ac03-reviewer", "ac03-decisions", "ac03-deadline"),
        ),
        ev(
            "ac03-e7",
            "List of designated application owners",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "In force during the window",
            ("Application", "Designated owner", "Delegations"),
            attributes=("ac03-reviewer",),
        ),
        ev(
            "ac03-e8",
            "Tickets and system records of the changes each selected review requested",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each change requested by a selected review",
            ("User", "Change requested", "Change made in the system", "Date made"),
            not_acceptable="A closed ticket with no system record of the change.",
            attributes=("ac03-actioned", "ac03-deadline"),
        ),
        ev(
            "ac03-e9",
            "Investigation records for access found inappropriate",
            "DOCUMENT",
            "The application owner who reviews",
            ("OPERATING",),
            "CONTEXT",
            "Each removal for inappropriate access in a selected review",
            ("Account", "Activity reviewed", "Outcome"),
            attributes=("ac03-investigated",),
        ),
        ev(
            "ac03-e10",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for user access",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the reviewers, or the listing's source",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_AC03_TESTED = ("ac03-listing", "ac03-reviewer", "ac03-decisions", "ac03-actioned")

ACCESS_REVIEW = Definition(
    library_key="access-review",
    control_ref="ITGC-AC-03",
    version=4,
    objective="Access that is no longer appropriate is found and removed each quarter.",
    control_type="DETECTIVE",
    performer="The application owner who reviews access",
    reviewer="The application owner (the review is the control)",
    trigger="The quarterly review cycle",
    population=(
        "The quarterly reviews in the period (four a year). The user listing within each "
        "review is information used in the control, tested for completeness per review."
    ),
    sampling=sampling("QUARTERLY"),
    evidence=_AC03.items,
    procedures=(
        _AC03.proc(
            "d-1",
            "DESIGN",
            "Understand the review: who reviews which application, against what, by when, and "
            "how the listing they review is produced.",
            "Read the access review procedure; identify the reviewers, the timetable and "
            "deadline, what the reviewer compares each user's access with, how removals are "
            "tracked, and how the listing is produced from the system.",
            (
                read_design("the access review procedure", ("ac03-e1",)),
                client_values(
                    "the role that reviews access for each application and the deadline for "
                    "completing a quarter's review and its changes"
                ),
                information_used("the user listing the reviewer receives", ("ac03-e4",)),
            ),
        ),
        _AC03.proc(
            "d-2",
            "DESIGN",
            "Determine whether the review, performed as described, is precise enough to find "
            "inappropriate access, and is implemented (AS 2201.42-.43).",
            "Walk one completed review from the listing's production to the last change made, "
            "asking the reviewer how they judge whether a role fits a job; confirm the "
            "reviewer's knowledge and independence; assess whether the review's scope, "
            "criteria, and follow-through address the risk.",
            (
                walkthrough("a quarterly review", ("ac03-e2",)),
                authority("the reviewers"),
                assess_design(
                    "the listing covers every user and role of the application at a recorded "
                    "date; the reviewer knows what each user's job needs and does not review "
                    "their own access; every user receives a decision; and each requested change "
                    "is made and its completion recorded within the deadline."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC03.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly reviews performed in the window against the one expected per "
            "quarter per application; select reviews at random with the firm's size for a "
            "quarterly control.",
            (
                step(
                    "List the reviews performed in the window, one per quarter per in-scope "
                    "application, with the reviewer and sign-off date, and compare with the "
                    "quarters the window contains.",
                    ("ac03-e3",),
                    "Each quarter and application, the review found or missing, and the "
                    "sign-off date.",
                    "A quarter with no review is a deviation of the control for that quarter; "
                    "it is recorded, not sampled around.",
                ),
                select_sample("a quarterly", "reviews"),
            ),
        ),
        _AC03.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected review covered every account and was performed by "
            "the designated owner, with a decision for every user.",
            "For each selected quarter, agree the user listing the reviewer used to the "
            "system's user list at the time (record count and sample of users both ways), "
            "compare the reviewer with the designated owner, and confirm each user received a "
            "decision.",
            (
                step(
                    "Agree the listing the reviewer used to the system's user list at the "
                    "listing's production date: record counts, and a selection of users and "
                    "their roles traced both ways.",
                    ("ac03-e4", "ac03-e5"),
                    "Production date, both record counts, the users traced each way, and any "
                    "difference.",
                    "A user in the system but not on the listing, or roles that differ, is an "
                    "exception of the listing's completeness; a listing produced on a different "
                    "date from the system list is recorded for a person.",
                ),
                step(
                    "Identify who signed the review and compare with the designated owner for "
                    "the application; check that the signer's own account, if on the listing, "
                    "was decided by someone else.",
                    ("ac03-e6", "ac03-e7"),
                    "Signer, role, the designated owner, and who decided the signer's own access.",
                    "A signer who is not the designated owner, without a documented delegation, "
                    "is an exception; self-review of the signer's access is an exception.",
                ),
                step(
                    "Check that every user on the listing has a recorded decision: keep, "
                    "remove, or change.",
                    ("ac03-e4", "ac03-e6"),
                    "Users on the listing, users with a decision, and any without.",
                    "A user without a decision is an exception: that access was not reviewed.",
                ),
            ),
            ("ac03-listing", "ac03-reviewer", "ac03-decisions"),
        ),
        _AC03.proc(
            "o-3",
            "OPERATING",
            "Determine whether the changes the reviewer asked for were made, and whether the "
            "review met its deadline.",
            "For each removal or change the selected review requested, find the change in the "
            "system and its date; compare the sign-off and change dates with the procedure's "
            "deadline where it is recorded.",
            (
                step(
                    "For each removal or change the review requested, find the change in the "
                    "system's own record and its date.",
                    ("ac03-e6", "ac03-e8"),
                    "Each requested change, the system record of it, and the date made.",
                    "A requested change not found in the system is an exception; a closed ticket "
                    "without a system record is insufficient evidence.",
                ),
                step(
                    "Where the procedure's deadline is recorded, compare the sign-off date and "
                    "the latest change date with it.",
                    ("ac03-e6", "ac03-e8"),
                    "Quarter end, sign-off date, latest change date, and the deadline.",
                    "A review or change after the deadline is an exception; where no deadline "
                    "is recorded, the attribute waits for the client's value.",
                ),
                step(
                    "Where the client's review includes investigating activity on access found "
                    "inappropriate, inspect the investigation record for each such removal.",
                    ("ac03-e9",),
                    "Each removal for inappropriate access and its investigation outcome.",
                    "Tested only when the client confirms this is part of the control; otherwise "
                    "recorded as not applicable with the reason.",
                ),
            ),
            ("ac03-actioned", "ac03-deadline", "ac03-investigated"),
        ),
        _AC03.proc(
            "o-4",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review and attribute, cited to the evidence.",
            (evaluate_exceptions("review"), conclude("interim")),
        ),
        _AC03.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the reviewers, or the listing's source changed "
            "since the interim date; test the reviews of the remaining period per the "
            "roll-forward table against the same attributes; record the results.",
            (
                inquire_changes(("ac03-e10",)),
                step(
                    "List the reviews performed in the remaining period against the quarters "
                    "it contains.",
                    ("ac03-e3",),
                    "Each quarter and the review found or missing.",
                    "A missing review is a deviation for that quarter.",
                ),
                update_sample("reviews"),
                conclude("roll-forward"),
            ),
            _AC03_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC03.attr(
            "ac03-listing",
            "The user listing the reviewer used was complete and accurate: it agrees to the "
            "system's user list at the time it was produced",
            ("ac03-e4", "ac03-e5"),
            condition="Every account in the system at the extract date is on the listing, with "
            "its roles as in the system.",
            why="A review of an incomplete listing cannot find access that is not on it.",
            extract=("Extract date", "Record counts", "Sample users and roles"),
            compare="Record counts and selected users both ways between listing and system.",
            passes="Counts agree and the users agree both ways.",
            fails="Accounts in the system are missing from the listing, or roles differ.",
            insufficient="No evidence of how the listing was produced, or no system list to "
            "compare.",
            review="The listing was produced on a different date from the system list.",
            not_infer="A file labelled 'user listing' is not complete because of its name.",
            basis=("AS1105.10", "KPMG-6", "DESIGN"),
            confidence="HIGH",
            was="The review covered a complete and accurate user listing",
        ),
        _AC03.attr(
            "ac03-reviewer",
            "The review was signed off by the designated application owner, who did not "
            "approve their own access",
            ("ac03-e6", "ac03-e7"),
            condition="The signer is the owner designated for the application, and their own "
            "account was reviewed by someone else.",
            why="The control description assigns the review to application owners; reviewing "
            "one's own access is not an independent review.",
            extract=("Signer", "Date", "Designated owner"),
            compare="Signer against the designated owner; signer's own account against who "
            "reviewed it.",
            passes="The designated owner signed and did not review their own access.",
            fails="Signed by someone else, or the owner approved their own access.",
            insufficient="No sign-off, or no list of designated owners.",
            review="Ownership was delegated without a documented delegation.",
            not_infer="Do not treat an email forwarding the listing as a sign-off.",
            basis=("DESIGN", "KPMG-7.3.10", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "Not approving one's own access is an inference from the purpose of "
                "the review; the description does not state it.",
            ),  # fmt: skip
            was="The reviewer is appropriate and independent of the access reviewed",
        ),
        _AC03.attr(
            "ac03-decisions",
            "The reviewer recorded a decision (keep, remove, or change) for every user on the "
            "listing",
            ("ac03-e4", "ac03-e6"),
            condition="Each user on the listing has a recorded decision.",
            why="The statement says the reviewer reviews each user's access and marks what to "
            "remove or change; a user with no decision was not reviewed.",
            extract=("Users on the listing", "Decision per user"),
            compare="Users on the listing against users with a decision.",
            passes="Every user has a decision.",
            fails="A user on the listing has no decision.",
            insufficient="The decisions are not provided, or the listing reviewed is not the "
            "one the decisions refer to.",
            review="The review records decisions per role rather than per user.",
            not_infer="A signature on the listing is not a decision for each user unless the "
            "procedure defines it so.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
        _AC03.attr(
            "ac03-actioned",
            "Every removal or change the reviewer requested was made in the system",
            ("ac03-e6", "ac03-e8"),
            condition="Each requested change appears in the system.",
            why="The control description includes making the requested changes.",
            extract=("Requested changes", "System change and date"),
            compare="Each requested change against the system record.",
            passes="Every requested change was made.",
            fails="A requested change was not made.",
            insufficient="The requested changes, or the system records, are not provided.",
            review="The reviewer's request is ambiguous about which access to remove.",
            not_infer="A closed ticket is not proof the system changed.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
            was="Changes requested in the review were made",
        ),
        _AC03.attr(
            "ac03-deadline",
            "The review was completed, and its changes made, by [the deadline in the access "
            "review procedure]",
            ("ac03-e6", "ac03-e8"),
            condition="Sign-off and changes are within the procedure's deadline.",
            why="A late review leaves inappropriate access in place longer than designed.",
            extract=("Quarter end", "Sign-off date", "Change dates", "Deadline"),
            compare="Dates against the deadline.",
            passes="Within the deadline.",
            fails="After the deadline.",
            insufficient="Dates missing.",
            review="The deadline is not defined.",
            not_infer="Do not assume a deadline.",
            basis=("DESIGN",),
            confidence="LOW",
            question="What deadline does the access review procedure set for completing each "
            "quarterly review and making its changes?",
            was="The review was completed on time",
        ),
        _AC03.attr(
            "ac03-investigated",
            "Access the reviewer found inappropriate was investigated to determine whether "
            "unauthorized activity was performed with it",
            ("ac03-e9",),
            condition="Each removal for inappropriate access has an investigation of activity.",
            why="KPMG's example includes this attribute; the library's description of this "
            "control does not.",
            extract=("Account", "Activity reviewed", "Outcome"),
            compare="Removed inappropriate access against investigation records.",
            passes="Each was investigated with an outcome.",
            fails="Not investigated.",
            insufficient="No records.",
            review="Always, until the client confirms it is part of their control.",
            not_infer="Do not test it unless the client's control includes it.",
            basis=("KPMG-7.3.10",),
            confidence="NOT_ESTABLISHED",
            question="Does the client's access review require investigating activity on access "
            "found inappropriate? If so, add it to the control description.",
        ),
    ),
)

# ITGC-AC-04 Privileged access is reviewed quarterly

_AC04 = Suite(
    (
        ev(
            "ac04-e1",
            "Definition of privileged access and the approval procedure",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "Which roles in each layer (application, database, operating system) count as "
                "privileged",
                "Who approves the quarterly list",
                "How removals are made",
            ),
            not_acceptable="A list of administrators with no statement of which roles are "
            "privileged: it is a result of the definition, not the definition.",
        ),  # fmt: skip
        ev(
            "ac04-e2",
            "Walkthrough instance: one approved quarterly list with its removals",
            "DOCUMENT",
            "Management who approve the list",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The listing as produced", "The decisions", "The sign-off", "The removal records"),
        ),
        ev(
            "ac04-e3",
            "Schedule of quarterly approvals performed in the window",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters ending in the window",
            ("Quarter", "Layer", "Approver", "Sign-off date"),
            completeness="One approval is expected per quarter per in-scope layer; the schedule "
            "is agreed to that expectation and to the sign-offs.",
        ),
        ev(
            "ac04-e4",
            "Privileged user listing each selected approval covered, with how it was produced",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected approval",
            (
                "User",
                "Privileged role",
                "Layer",
                "Report name and parameters",
                "Date produced",
                "Record count",
            ),
            completeness="Agreed to the system's members of each privileged role at the "
            "production date.",
            attributes=("ac04-complete",),
        ),  # fmt: skip
        ev(
            "ac04-e5",
            "System list of privileged roles and their members at each selected production date",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected approval's listing",
            ("Role", "Members", "Layer"),
            attributes=("ac04-complete",),
        ),
        ev(
            "ac04-e6",
            "Signed list with a decision per user for each selected approval",
            "DOCUMENT",
            "Management who approve the list",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected approval",
            ("Signer and role", "Sign-off date", "Decision per user"),
            not_acceptable="A listing with a signature but no decision per user.",
            attributes=("ac04-approved", "ac04-independent"),
        ),
        ev(
            "ac04-e7",
            "Removal records for access the approver did not confirm",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each removal decided in a selected approval",
            ("User", "Role removed", "Date removed", "Removed by"),
            attributes=("ac04-removed",),
        ),
        ev(
            "ac04-e8",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for user access",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the definition of privileged access, the approver, or the systems",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_AC04_TESTED = ("ac04-complete", "ac04-approved", "ac04-independent", "ac04-removed")

ACCESS_PRIVILEGED = Definition(
    library_key="access-privileged",
    control_ref="ITGC-AC-04",
    version=4,
    objective="Privileged access is held only by people whose role needs it, as approved by "
    "management each quarter.",
    control_type="DETECTIVE",
    performer="Management who approve the privileged access list",
    reviewer="Management (the approval is the control)",
    trigger="The quarterly approval cycle",
    population="The quarterly approvals in the period.",
    sampling=sampling("QUARTERLY"),
    design_confirmation=(
        "This control is the quarterly review of who has privileged access, done by someone "
        "who does not hold that access. Granting privileged access is a different control. "
        "Confirm that the client relies on this review, which layers are in scope "
        "(application, database, and operating system), and how the client defines "
        "privileged access."
    ),
    evidence=_AC04.items,
    procedures=(
        _AC04.proc(
            "d-1",
            "DESIGN",
            "Understand what the client defines as privileged, in which layers, and who "
            "approves the list.",
            "Read the definition of privileged access and the approval procedure; record the "
            "roles defined as privileged in each layer in scope, the approver, and how the "
            "listing is produced.",
            (
                read_design(
                    "the definition of privileged access and the approval procedure", ("ac04-e1",)
                ),  # fmt: skip
                client_values(
                    "the roles the client defines as privileged in each layer, the layers in "
                    "scope, and the role that approves the list"
                ),
                information_used("the privileged user listing", ("ac04-e4",)),
            ),
        ),
        _AC04.proc(
            "d-2",
            "DESIGN",
            "Determine whether the approval, performed as described by someone independent of "
            "the privileged users, addresses its risk and is implemented (AS 2201.42-.43).",
            "Walk one quarterly approval from the listing's production to the removals, asking "
            "the approver how they judge that a role needs the access; confirm the approver's "
            "seniority and independence; assess whether the definition, the approval, and the "
            "removals address the risk.",
            (
                walkthrough("a quarterly approval", ("ac04-e2",)),
                authority("the approver of the privileged list"),
                assess_design(
                    "the definition of privileged access covers every layer the system runs on; "
                    "the listing is produced from the system on a recorded date; the approver is "
                    "independent of the users listed and records a decision for each; and access "
                    "not confirmed is removed and the removal recorded."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC04.proc(
            "o-1",
            "OPERATING",
            "Establish the approvals performed in the window and select the sample.",
            "List the quarterly approvals performed in the window against the one expected per "
            "quarter per layer; select approvals at random with the firm's size for a quarterly "
            "control.",
            (
                step(
                    "List the approvals performed in the window, one per quarter per layer in "
                    "scope, with the approver and sign-off date, and compare with the quarters "
                    "the window contains.",
                    ("ac04-e3",),
                    "Each quarter and layer, the approval found or missing, and the sign-off date.",
                    "A quarter with no approval is a deviation for that quarter.",
                ),
                select_sample("a quarterly", "approvals"),
            ),
        ),
        _AC04.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected quarter's complete privileged list was approved, "
            "by someone independent, with a decision per user, and whether access not confirmed "
            "was removed.",
            "Agree the approved list to the system's privileged users at the time; inspect the "
            "approval for a dated sign-off and a decision for each user; compare the approver "
            "with the users listed; find the removal record for each user not confirmed.",
            (
                step(
                    "Agree the approved list to the system's members of each privileged role at "
                    "the listing's production date, for every layer in scope.",
                    ("ac04-e4", "ac04-e5"),
                    "Production date, the roles compared, record counts, and any member in the "
                    "system not on the list.",
                    "A privileged account missing from the approved list is an exception; where "
                    "the client's definition of privileged is not recorded, the attribute waits "
                    "for it.",
                ),
                step(
                    "Inspect the sign-off: the signer, their role, the date, and a keep or "
                    "remove decision recorded for every user on the list.",
                    ("ac04-e6",),
                    "Signer, role, date, users on the list, and users with a decision.",
                    "No sign-off, or a user without a decision, is an exception. Whether a role "
                    "needs the access is management's judgment: the tester confirms the "
                    "decision exists and does not substitute their own.",
                ),
                step(
                    "Check that the approver does not hold the privileged access reviewed, or "
                    "that their own access was decided by someone else.",
                    ("ac04-e6", "ac04-e5"),
                    "The approver, whether they appear on the listing, and who decided their "
                    "access.",
                    "An approver confirming their own privileged access is an exception.",
                ),
                step(
                    "For each user the approver did not confirm, find the removal in the "
                    "system's own record and its date.",
                    ("ac04-e6", "ac04-e7"),
                    "Each remove decision, the system record of the removal, and its date.",
                    "A removal decided but not made is an exception.",
                ),
            ),
            _AC04_TESTED,
        ),
        _AC04.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per approval and attribute, cited to the evidence.",
            (evaluate_exceptions("approval"), conclude("interim")),
        ),
        _AC04.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the definition, the approver, or the systems changed since the "
            "interim date; test the approvals of the remaining period per the roll-forward table "
            "against the same attributes; record the results.",
            (
                inquire_changes(("ac04-e8",)),
                step(
                    "List the approvals performed in the remaining period against the quarters "
                    "it contains.",
                    ("ac04-e3",),
                    "Each quarter and the approval found or missing.",
                    "A missing approval is a deviation for that quarter.",
                ),
                update_sample("approvals"),
                conclude("roll-forward"),
            ),
            _AC04_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC04.attr(
            "ac04-complete",
            "The privileged access list management approved agrees to the system's privileged "
            "users at the time",
            ("ac04-e4", "ac04-e5"),
            condition="Every privileged account in the system is on the approved list.",
            why="Approval of an incomplete list leaves unapproved privileged access.",
            extract=("Accounts", "Roles", "Dates"),
            compare="System privileged accounts against the approved list.",
            passes="Every system privileged account is on the list.",
            fails="A privileged account is missing from the approved list.",
            insufficient="No system list to compare.",
            review="Which roles count as privileged is not defined.",
            not_infer="Do not assume a role is not privileged from its name.",
            basis=("DESIGN", "AS1105.10"),
            confidence="LOW",
            question="Which roles in each layer does the client define as privileged?",
            blocks=True,
        ),
        _AC04.attr(
            "ac04-approved",
            "Management signed the quarter's privileged access list, with a recorded decision "
            "for each user that their role needs the access",
            ("ac04-e6",),
            condition="A dated management sign-off and a keep or remove decision per user.",
            why="The description says the list is approved by management; whether a role "
            "needs access is management's judgment, which the tester confirms was exercised.",
            extract=("Signer", "Date", "Decision per user"),
            compare="Users on the list against recorded decisions.",
            passes="Signed, with a decision for every user.",
            fails="Not signed, or users without a decision.",
            insufficient="Sign-off not provided.",
            review="Whether a user's role needs the access: the tester does not decide this.",
            not_infer="Do not judge whether a role needs access; confirm the decision exists.",
            basis=("DESIGN", "AS2201.44"),
            confidence="MODERATE",
            was="Privileged access was approved",
        ),
        _AC04.attr(
            "ac04-independent",
            "The approver does not hold the privileged access reviewed, or their own access was "
            "decided by someone else",
            ("ac04-e6", "ac04-e5"),
            condition="The approver is not on the listing, or another person decided the "
            "approver's own access.",
            why="The statement requires an approver senior to and independent of the privileged "
            "users; confirming one's own privileged access is not a review.",
            extract=("Approver", "Approver's presence on the listing", "Who decided it"),
            compare="The approver against the listing's users and the decision on their row.",
            passes="The approver is not listed, or their row was decided by someone else.",
            fails="The approver confirmed their own privileged access.",
            insufficient="The listing does not identify users well enough to tell.",
            review="The approver's access was decided by a delegate without a documented "
            "delegation.",
            not_infer="Do not assume independence from the approver's title.",
            basis=("DESIGN", "AS2201.44", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The statement's authority clause states the independence; an RCM description "
                "may not, so the attribute is marked as an inference.",
            ),  # fmt: skip
        ),
        _AC04.attr(
            "ac04-removed",
            "Privileged access the approver did not confirm was removed, with the removal "
            "recorded in the system",
            ("ac04-e6", "ac04-e7"),
            condition="Each remove decision has a system record of the removal.",
            why="The statement says access no longer needed is removed by the administrator; "
            "a decision not acted on leaves the access in place.",
            extract=("Remove decisions", "Removal record and date"),
            compare="Each remove decision against the system's removal record.",
            passes="Every remove decision was made in the system.",
            fails="A remove decision with no removal.",
            insufficient="The removal records are not provided.",
            review="The decision names a user but not which privileged role to remove.",
            not_infer="A ticket closed as done is not the system's record of the removal.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
    ),
    retired=(
        Retired(
            "Each privileged user has a role that needs the access",
            "This is management's judgment within the control. The tester confirms a decision "
            "was recorded for each user (ac04-approved) and does not substitute their own.",
            "ac04-approved",
        ),
        Retired(
            "No generic privileged account is used without accountability",
            "Generic and shared accounts are the subject of ITGC-AC-06.",
        ),
    ),
)

# ITGC-AC-05 Authentication settings meet policy

_AC05 = Suite(
    (
        ev(
            "ac05-e1",
            "Information security policy: the required authentication settings",
            "POLICY",
            "The control owner for user access",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "DESIGN",
            "The version in force during the period",
            (
                "Required password length and complexity",
                "Lockout threshold and duration",
                "Multi-factor authentication and the accounts it must cover",
                "Any permitted exceptions",
            ),
            not_acceptable="A policy that says settings must be 'strong' without values sets "
            "no criterion the configuration can be compared with.",
            attributes=("ac05-values",),
        ),  # fmt: skip
        ev(
            "ac05-e2",
            "Authentication configuration as shown from the system, dated",
            "CONFIGURATION",
            "The system administrator",
            ("DESIGN", "OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "At the interim date and at period end",
            (
                "Each parameter and its configured value",
                "System name",
                "Date shown",
                "Which user groups or sign-in paths each setting applies to",
            ),
            not_acceptable="A screenshot without the system name and date, or a document "
            "describing the intended settings.",
            attributes=("ac05-values", "ac05-scope"),
        ),  # fmt: skip
        ev(
            "ac05-e3",
            "Walkthrough observation: a sign-in that shows the settings enforced",
            "OBSERVATION",
            "The system administrator",
            ("DESIGN",),
            "DESIGN",
            "During the walkthrough",
            (
                "A sign-in prompting for the second factor",
                "A rejected weak password or a lockout after the threshold",
            ),
        ),  # fmt: skip
        ev(
            "ac05-e4",
            "Change history of the authentication settings",
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
            attributes=("ac05-unchanged",),
        ),  # fmt: skip
        ev(
            "ac05-e5",
            "Users and roles able to change the authentication settings",
            "SYSTEM_REPORT",
            "The system administrator",
            ("DESIGN",),
            "CONTEXT",
            "At the interim date",
            ("User or role", "Permission", "How the list was produced"),
        ),
        ev(
            "ac05-e6",
            "Exempt accounts or sign-in paths and their approvals",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The window tested",
            ("Account or path exempted", "Which setting", "Approval and its date"),
            attributes=("ac05-scope",),
        ),
    )
)

_AC05_TESTED = ("ac05-values", "ac05-unchanged", "ac05-scope")

ACCESS_AUTHENTICATION = Definition(
    library_key="access-authentication",
    control_ref="ITGC-AC-05",
    version=4,
    objective="Authentication settings enforce the company security policy for every user "
    "in scope.",
    control_type="PREVENTIVE",
    performer="The system (configured setting)",
    reviewer="None described",
    trigger="Every sign-in",
    population="Not sampled: the configuration and its change history for the period.",
    sampling=sampling("ANNUAL", automated=True),
    evidence=_AC05.items,
    procedures=(
        _AC05.proc(
            "d-1",
            "DESIGN",
            "Understand which settings the policy requires and where each is configured.",
            "Read the security policy's required values; identify where each is configured in "
            "the system, which sign-in paths and user groups it applies to, and who can change "
            "it.",
            (
                read_design("the security policy's authentication requirements", ("ac05-e1",)),
                client_values(
                    "the security policy's required values for each setting and the accounts "
                    "multi-factor authentication must cover"
                ),
                step(
                    "Identify where each required setting is configured, the sign-in paths and "
                    "user groups it applies to, and who can change it.",
                    ("ac05-e2", "ac05-e5"),
                    "Each setting, its location, its scope, and the roles able to change it.",
                    "A required setting that cannot be located in the configuration is a design "
                    "gap for a person to assess.",
                ),
            ),
        ),
        _AC05.proc(
            "d-2",
            "DESIGN",
            "Determine whether the configuration, as set, meets the policy for every sign-in in "
            "scope and is implemented (AS 2201.42-.43).",
            "Observe a sign-in that shows the settings enforced; compare the design of the "
            "settings with the policy; assess whether the configuration, protected by change "
            "management and restricted access, addresses the risk.",
            (
                step(
                    "Observe, or inspect system evidence of, the settings operating: a prompt "
                    "for the second factor, a rejected weak password, or a lockout after the "
                    "threshold.",
                    ("ac05-e3",),
                    "What was observed, for which account and path, and the date.",
                    "A setting that does not operate as configured is a design matter for a "
                    "person; the configuration export alone does not show implementation.",
                ),
                assess_design(
                    "each policy value is configured at least as strictly as required; the "
                    "settings apply to every interactive sign-in path and user group in scope; "
                    "exemptions are approved and listed; and changes to the settings go through "
                    "change management by administrators whose access is reviewed."
                ),
            ),
            limitation="Observation shows the setting at the time observed (AS 1105.15).",
        ),
        _AC05.proc(
            "o-1",
            "OPERATING",
            "Determine whether each configured value met the policy at the interim date, for "
            "every sign-in in scope, and stayed in place through the window.",
            "Compare each configured value with the policy value, parameter by parameter; "
            "confirm the settings apply to every sign-in path and user group in scope, with "
            "exemptions approved; inspect the change history of the settings for the window.",
            (
                step(
                    "Compare each configured value, as shown from the system with its date, "
                    "with the policy's required value, parameter by parameter.",
                    ("ac05-e1", "ac05-e2"),
                    "Per parameter: policy value, configured value, and whether the "
                    "configured value is at least as strict.",
                    "A configured value weaker than the policy is an exception; a parameter the "
                    "policy is silent on is recorded for a person.",
                ),
                step(
                    "Confirm the settings apply to every interactive sign-in path and user group "
                    "in scope, and that each exempt account or path has a recorded approval.",
                    ("ac05-e2", "ac05-e6"),
                    "The paths and groups covered, each exemption, and its approval.",
                    "An exemption without approval, or a path the settings do not cover, is an "
                    "exception.",
                ),
                config_change_history("the authentication settings", ("ac05-e4",)),
            ),
            _AC05_TESTED,
            "Relies on the access and change-management controls over the system for the "
            "period between the dates inspected (AS 2201.B29).",
        ),
        _AC05.proc(
            "o-2",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per parameter and attribute, cited to the evidence.",
            (evaluate_exceptions("parameter"), conclude("interim")),
        ),
        _AC05.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the settings stayed in place from the interim date to period end "
            "(AS 2201.55-.56, .B29).",
            "Inspect the change history of the authentication settings for the remaining "
            "period. If they did not change, inspect the settings as at period end and agree "
            "them to the interim result. If they changed, test the change's approval and test "
            "the settings again as changed.",
            (
                config_change_history("the authentication settings", ("ac05-e4",)),
                step(
                    "Inspect the settings as at period end and agree each value to the interim "
                    "result, or, where a value changed, compare the new value with the policy.",
                    ("ac05-e1", "ac05-e2"),
                    "Per parameter: the period-end value, the interim value, and the policy value.",
                    "A period-end value weaker than the policy is an exception for the period "
                    "from its change date.",
                ),
                conclude("roll-forward"),
            ),
            _AC05_TESTED,
            "A setting at period end shows nothing about the period before it without the "
            "change history.",
        ),
    ),
    attributes=(
        _AC05.attr(
            "ac05-values",
            "Each configured authentication value (password length and complexity, lockout, "
            "multi-factor enforcement and the accounts it covers) meets the security policy",
            ("ac05-e1", "ac05-e2"),
            condition="Every configured value is at least as strict as the policy value.",
            why="The control is the configuration meeting the policy.",
            extract=("Each parameter and its value", "Policy value", "Accounts MFA covers"),
            compare="Configured value against policy value, parameter by parameter.",
            passes="Every value meets the policy.",
            fails="A value is weaker than the policy.",
            insufficient="The policy values or the configuration are not provided, or a "
            "screenshot does not show the system and date.",
            review="The policy is silent on a parameter, or MFA scope is unclear.",
            not_infer="A screenshot shows the value on its date only.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Configured settings meet the security policy",
        ),
        _AC05.attr(
            "ac05-unchanged",
            "The settings did not change during the period, or each change was approved under "
            "change management, as shown by the system's change history",
            ("ac05-e4",),
            condition="The change history shows no change, or each change has approval.",
            why="One point-in-time value does not show the setting held for the period; reliance "
            "rests on the change history and on change management.",
            extract=("Changes", "Dates", "Who changed", "Approval"),
            compare="Changes against approvals.",
            passes="No change, or every change approved.",
            fails="An unapproved change.",
            insufficient="No change history.",
            review="The system keeps no change history: a person decides an alternative.",
            not_infer="Do not infer no changes from the absence of a log.",
            basis=("DESIGN", "AS2201.B28", "INFERENCE"),
            confidence="MODERATE",
            was="Settings did not change during the period, or changes were approved",
        ),
        _AC05.attr(
            "ac05-scope",
            "The settings apply to every interactive sign-in path and user group in scope, and "
            "each exempt account or path has a recorded approval",
            ("ac05-e2", "ac05-e6"),
            condition="No in-scope path or group is outside the settings without an approved "
            "exemption.",
            why="The statement says the settings apply to every interactive sign-in; a path or "
            "group left out is a sign-in the policy does not protect.",
            extract=("Paths and groups covered", "Exemptions", "Approvals"),
            compare="The configuration's scope against the sign-in paths and groups in scope; "
            "each exemption against its approval.",
            passes="Every path and group is covered, or exempted with approval.",
            fails="A path or group is not covered and not exempted, or an exemption has no "
            "approval.",
            insufficient="The configuration does not show its scope.",
            review="Whether a service or API sign-in counts as interactive.",
            not_infer="Do not assume a setting is global because it is set once.",
            basis=("DESIGN", "INFERENCE"),
            confidence="MODERATE",
            assumptions=(
                "The sign-in paths in scope are the interactive ones the statement names; "
                "service sign-ins are decided by a person.",
            ),  # fmt: skip
        ),
    ),
)

# ITGC-AC-06 Shared and service accounts are controlled

_AC06 = Suite(
    (
        ev(
            "ac06-e1",
            "Procedure for shared, generic, and service accounts",
            "POLICY",
            "The control owner for user access",
            ("DESIGN",),
            "DESIGN",
            "The version in force during the period",
            (
                "How accounts are classified as shared, generic, or service",
                "Who reviews the inventory and when",
                "What an owner is",
                "When interactive sign-in may be approved and by whom",
            ),
        ),  # fmt: skip
        ev(
            "ac06-e2",
            "Walkthrough instance: one quarter's inventory review with its outcomes",
            "DOCUMENT",
            "The reviewer of shared and service accounts",
            ("DESIGN",),
            "DESIGN",
            "One quarter in the period",
            ("The inventory as produced", "Owners and approvals", "Accounts disabled"),
        ),
        ev(
            "ac06-e3",
            "Schedule of quarterly inventory reviews performed in the window",
            "DOCUMENT",
            "The control owner for user access",
            ("OPERATING", "ROLLFORWARD"),
            "POPULATION",
            "The quarters ending in the window",
            ("Quarter", "Reviewer", "Sign-off date"),
            completeness="One review is expected per quarter; the schedule is agreed to that "
            "expectation and to the sign-offs.",
        ),
        ev(
            "ac06-e4",
            "Account inventory each selected review covered, with how it was produced",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "COMPLETENESS",
            "Each selected review",
            (
                "Account",
                "Type",
                "Owner",
                "Interactive sign-in allowed",
                "Report name and parameters",
                "Date produced",
                "Record count",
            ),
            completeness="Agreed to the system's account list at the production date, with "
            "non-personal accounts identified by the system's account type.",
            attributes=("ac06-inventory",),
        ),  # fmt: skip
        ev(
            "ac06-e5",
            "System account list with account types at each selected production date",
            "SYSTEM_REPORT",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "The production date of each selected inventory",
            ("Account", "Account type", "Status"),
            not_acceptable="A list where account types must be guessed from names.",
            attributes=("ac06-inventory",),
        ),
        ev(
            "ac06-e6",
            "Reviewer's sign-off for each selected review",
            "DOCUMENT",
            "The reviewer of shared and service accounts",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review",
            ("Signer and role", "Sign-off date", "Production date of the inventory reviewed"),
            attributes=("ac06-signoff",),
        ),
        ev(
            "ac06-e7",
            "HR status of each named owner at the review date",
            "SYSTEM_REPORT",
            "HR",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each selected review's date",
            ("Owner", "Employment status"),
            attributes=("ac06-owner",),
        ),
        ev(
            "ac06-e8",
            "Sign-in settings and interactive-use approvals for each account",
            "CONFIGURATION",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each account in a selected inventory",
            (
                "Account",
                "Interactive sign-in setting",
                "Approval for interactive use, approver, and date",
            ),
            not_acceptable="An inventory column stating 'disabled' with no system setting "
            "behind it.",
            attributes=("ac06-interactive",),
        ),  # fmt: skip
        ev(
            "ac06-e9",
            "System records of accounts disabled after each selected review",
            "SYSTEM_LOG",
            "The access administrator",
            ("OPERATING", "ROLLFORWARD"),
            "ATTRIBUTE",
            "Each account the review found without an owner or approval",
            ("Account", "Date disabled", "Disabled by"),
            attributes=("ac06-disabled",),
        ),
        ev(
            "ac06-e10",
            "Changes to the control since the interim date",
            "CORRESPONDENCE",
            "The control owner for user access",
            ("ROLLFORWARD",),
            "CONTEXT",
            "From the interim date to period end",
            (
                "Changes to the procedure, the reviewer, or the system",
                "Documentation of each change",
            ),
        ),  # fmt: skip
    )
)

_AC06_TESTED = (
    "ac06-inventory",
    "ac06-signoff",
    "ac06-owner",
    "ac06-interactive",
    "ac06-disabled",
)

ACCESS_SHARED = Definition(
    library_key="access-shared-accounts",
    control_ref="ITGC-AC-06",
    version=4,
    objective="Every shared, generic, and service account has an accountable owner and cannot "
    "be used to sign in interactively unless approved.",
    control_type="PREVENTIVE",
    performer="The account owner and administrators",
    reviewer="Not described",
    trigger="The quarterly inventory",
    population="The account inventory for each quarter, agreed to the system's accounts.",
    sampling=sampling("QUARTERLY"),
    evidence=_AC06.items,
    procedures=(
        _AC06.proc(
            "d-1",
            "DESIGN",
            "Understand how non-personal accounts are identified, owned, and restricted.",
            "Read the procedure for shared, generic, and service accounts; identify how the "
            "system distinguishes them from personal accounts, who reviews the inventory, what "
            "ownership means, and who may approve interactive use.",
            (
                read_design(
                    "the procedure for shared, generic, and service accounts", ("ac06-e1",)
                ),  # fmt: skip
                client_values(
                    "the role that reviews the inventory and who may approve interactive "
                    "sign-in for an account"
                ),
                information_used("the account inventory", ("ac06-e4",)),
            ),
        ),
        _AC06.proc(
            "d-2",
            "DESIGN",
            "Determine whether the inventory review, performed as described, addresses its risk "
            "and is implemented (AS 2201.42-.43).",
            "Walk one quarter's review from the inventory's production to the accounts disabled, "
            "asking the reviewer how they identify an account's purpose and owner; confirm the "
            "reviewer's knowledge; assess whether the inventory, ownership, and restriction "
            "address the risk.",
            (
                walkthrough("a quarterly inventory review", ("ac06-e2",)),
                authority("the reviewer of shared and service accounts"),
                assess_design(
                    "the inventory is produced from the system by account type, not assembled "
                    "by hand; every account has a named person as owner; interactive sign-in "
                    "is disabled unless approved by someone the procedure names; and an account "
                    "without an owner or approval is disabled, not merely noted."
                ),
            ),
            limitation=WALKTHROUGH_LIMIT,
        ),
        _AC06.proc(
            "o-1",
            "OPERATING",
            "Establish the reviews performed in the window and select the sample.",
            "List the quarterly inventory reviews performed in the window against the one "
            "expected per quarter; select reviews at random with the firm's size for a "
            "quarterly control.",
            (
                step(
                    "List the inventory reviews performed in the window with the reviewer and "
                    "sign-off date, and compare with the quarters the window contains.",
                    ("ac06-e3",),
                    "Each quarter, the review found or missing, and the sign-off date.",
                    "A quarter with no review is a deviation for that quarter.",
                ),
                select_sample("a quarterly", "inventory reviews"),
            ),
        ),
        _AC06.proc(
            "o-2",
            "OPERATING",
            "Determine whether each selected inventory was complete and signed off, and whether "
            "each account has an owner and is restricted.",
            "Agree the inventory to the system's non-personal accounts; inspect the sign-off; "
            "then for each account inspect the owner and their status, and the sign-in "
            "restriction or its approval; find the record of each account disabled.",
            (
                step(
                    "Agree the inventory to the system's non-personal accounts at the "
                    "production date, by the system's account type.",
                    ("ac06-e4", "ac06-e5"),
                    "Production date, record counts, and any non-personal account in the system "
                    "not on the inventory.",
                    "A non-personal account missing from the inventory is an exception; where "
                    "account types cannot be identified from the system list, the attribute is "
                    "recorded for a person.",
                ),
                step(
                    "Inspect the sign-off: the signer, their role, the date, and that it refers "
                    "to the inventory produced on the recorded date.",
                    ("ac06-e6", "ac06-e4"),
                    "Signer, role, sign-off date, and the production date it refers to.",
                    "No sign-off, or one that refers to a different inventory, is an exception.",
                ),
                step(
                    "For each account, read the named owner and confirm they were a current "
                    "employee at the review date.",
                    ("ac06-e4", "ac06-e7"),
                    "Per account: the owner and their employment status at the review date.",
                    "No owner, an owner who had left, or a team mailbox as owner, is an exception.",
                ),
                step(
                    "For each account, read the interactive sign-in setting from the system; "
                    "where sign-in is enabled, find the approval, its approver, and its date.",
                    ("ac06-e8",),
                    "Per account: the setting, and the approval where enabled.",
                    "Interactive sign-in enabled without an approval is an exception; an "
                    "approver the procedure does not name is recorded for a person.",
                ),
                step(
                    "For each account the review found without an owner or approval, find the "
                    "system record that it was disabled and its date.",
                    ("ac06-e6", "ac06-e9"),
                    "Each such account, the disable record, and its date.",
                    "An account the review found deficient and left enabled is an exception.",
                ),
            ),
            _AC06_TESTED,
        ),
        _AC06.proc(
            "o-3",
            "OPERATING",
            "Evaluate deviations and record the interim results.",
            "Record each deviation with its facts and the owner's explanation for a person to "
            "evaluate; record the results per review, account, and attribute, cited to the "
            "evidence.",
            (evaluate_exceptions("account"), conclude("interim")),
        ),
        _AC06.proc(
            "rf-1",
            "ROLLFORWARD",
            "Conclude whether the control kept operating from the interim date to period end "
            "(AS 2201.55-.56).",
            "Corroborate whether the procedure, the reviewer, or the system changed since the "
            "interim date; test the reviews of the remaining period per the roll-forward table "
            "against the same attributes; record the results.",
            (
                inquire_changes(("ac06-e10",)),
                step(
                    "List the inventory reviews performed in the remaining period against the "
                    "quarters it contains.",
                    ("ac06-e3",),
                    "Each quarter and the review found or missing.",
                    "A missing review is a deviation for that quarter.",
                ),
                update_sample("inventory reviews"),
                conclude("roll-forward"),
            ),
            _AC06_TESTED,
            ROLL_LIMIT,
        ),
    ),
    attributes=(
        _AC06.attr(
            "ac06-inventory",
            "The inventory includes every shared, generic, and service account in the system",
            ("ac06-e4", "ac06-e5"),
            condition="Every non-personal account in the system is on the inventory.",
            why="An account missing from the inventory has no owner and no restriction.",
            extract=("Accounts", "Types"),
            compare="System non-personal accounts against the inventory.",
            passes="All are on it.",
            fails="An account is missing.",
            insufficient="No system list.",
            review="Account types are not identifiable from the system list.",
            not_infer="Do not classify accounts as personal by their names alone.",
            basis=("DESIGN", "AS1105.10"),
            confidence="MODERATE",
        ),
        _AC06.attr(
            "ac06-signoff",
            "The quarter's inventory review was signed off by the reviewer, referring to the "
            "inventory produced on a recorded date",
            ("ac06-e6", "ac06-e4"),
            condition="A dated sign-off by the reviewer on the inventory with its production date.",
            why="The statement says the reviewer reviews the inventory each quarter, produced "
            "from the system on a recorded date; without the sign-off there is no evidence the "
            "review happened.",
            extract=("Signer", "Role", "Sign-off date", "Production date"),
            compare="The sign-off against the reviewer the procedure names and the inventory's "
            "production date.",
            passes="Signed by the reviewer, on the inventory with its production date.",
            fails="No sign-off, or a sign-off on an inventory without a production date.",
            insufficient="The sign-off is not provided.",
            review="The signer is a delegate without a documented delegation.",
            not_infer="An email saying the review is done is not a sign-off on the inventory.",
            basis=("DESIGN", "AS2201.44"),
            confidence="HIGH",
        ),
        _AC06.attr(
            "ac06-owner",
            "Each shared or service account has a named, current owner",
            ("ac06-e4", "ac06-e7"),
            condition="A named person who is a current employee owns the account.",
            why="Ownership is how activity under the account is made accountable.",
            extract=("Account", "Owner", "Owner status"),
            compare="Owner against current employees.",
            passes="A current, named owner.",
            fails="No owner, or the owner has left.",
            insufficient="Owners not provided.",
            review="The owner is a team rather than a person.",
            not_infer="A team mailbox is not a named owner.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Each shared or service account has a named owner",
        ),
        _AC06.attr(
            "ac06-interactive",
            "Interactive sign-in is disabled for the account, or an approval for interactive "
            "use exists",
            ("ac06-e8",),
            condition="The setting disables interactive sign-in, or a documented approval "
            "covers it.",
            why="The description permits interactive use only with approval.",
            extract=("Account", "Setting", "Approval"),
            compare="Setting and approval per account.",
            passes="Disabled, or approved.",
            fails="Enabled without approval.",
            insufficient="Settings not provided.",
            review="The approver's authority is not defined.",
            not_infer="Do not infer the setting from the account's name.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="Interactive use is disabled or approved",
        ),
        _AC06.attr(
            "ac06-disabled",
            "An account the review found without an owner or approval was disabled, with the "
            "system's record of it",
            ("ac06-e6", "ac06-e9"),
            condition="Each account the review marked deficient has a system record of being "
            "disabled.",
            why="The statement says accounts without an owner or approval are disabled by the "
            "administrator; a finding not acted on leaves the account usable.",
            extract=("Accounts marked deficient", "Disable record and date"),
            compare="Each deficient account against the system's disable record.",
            passes="Every deficient account was disabled, or none was found.",
            fails="A deficient account left enabled.",
            insufficient="The review's findings or the disable records are not provided.",
            review="The review gave the account an owner instead of disabling it, and the "
            "procedure allows that.",
            not_infer="An inventory column saying 'to disable' is not the disable record.",
            basis=("DESIGN", "KPMG-7.3.10"),
            confidence="HIGH",
        ),
    ),
    retired=(
        Retired(
            "Credentials are stored in an approved vault",
            "Not in the control description. Test it only if the client's control requires a "
            "vault, by adding it to the description.",
        ),
    ),
)

DEFINITIONS: tuple[Definition, ...] = (
    ACCESS_PROVISIONING,
    ACCESS_TERMINATION,
    ACCESS_REVIEW,
    ACCESS_PRIVILEGED,
    ACCESS_AUTHENTICATION,
    ACCESS_SHARED,
)
