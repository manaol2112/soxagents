"""Control statements for IT general controls, application controls, key reports, and
entity-level controls (Milestone 8.9). See control_statements.py for what each field means.

Every statement is a draft for a SOX methodology reviewer. A value only the client knows
is a {slot}; nothing here sets a threshold, a deadline, or a role on the client's behalf.
"""

from ai_workforce_api.control_statements import Information, Slot, Statement

# Slots shared across IT general controls.


def _system() -> Slot:
    return Slot("system", "the in-scope system", "SYSTEM",
                "Each IT general control is performed for one system.", "SAP S/4HANA",
                blocks=False)  # fmt: skip


def _role(key: str, label: str, why: str, example: str) -> Slot:
    # A role names who performs or reviews; the tester reads the evidence of who did, so a
    # role never holds testing.
    return Slot(key, label, "ROLE", why, example, blocks=False)


ADMIN = _role(
    "admin-role", "the role that administers user access",
    "The operator: who grants, changes, and removes access.", "IT service desk administrator",
)  # fmt: skip
POLICY = Slot(
    "access-policy", "the access management policy", "TEXT",
    "The criteria the approver applies: who may approve which access.",
    "Access Management Standard v4", blocks=False,
)  # fmt: skip
CHANGE_TOOL = Slot(
    "change-tool", "the change management tool", "SYSTEM",
    "Where requests, tests, and approvals are recorded.", "ServiceNow", blocks=False,
)  # fmt: skip

# The IT general controls most application controls and reports rely on.
ACCESS_ITGCS = ("ITGC-AC-01", "ITGC-AC-02", "ITGC-AC-03", "ITGC-AC-04")
CHANGE_ITGCS = ("ITGC-CM-01", "ITGC-CM-03", "ITGC-CM-04")

STATEMENTS: dict[str, Statement] = {}


def _add(key: str, statement: Statement) -> None:
    STATEMENTS[key] = statement


_add(
    "access-provisioning",
    Statement(
        text="When a user needs new access or a change to access in {system}, a request naming the "
        "user and the specific role or permission is raised in {access-tool}. The user's manager "
        "and, where {access-policy} requires it, the application owner approve the request in the "
        "tool. {admin-role} grants only the approved access, and only after the approval is "
        "recorded.",
        risk="A user receives access no one with authority approved, or more access than was "
        "approved, and can record or change financial data inappropriately.",
        it_risk="Unauthorized access to data, which could result in the destruction of data or "
        "improper changes to it, including unauthorized or nonexistent transactions.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{admin-role}",
        reviewer="The user's manager and, where {access-policy} requires it, the application owner",
        owner="{access-owner}",
        authority="The approver must be able to judge whether the user's job needs the access and "
        "must not be the user; the administrator must not approve the access they grant.",
        judgment="LOW",
        judgment_note="The approver decides whether the access fits the user's job; the "
        "administrator matches the grant to the approval.",
        precision="Every grant and change to access in {system}: no access is granted without a "
        "recorded approval for that user and that access.",
        investigation="A grant found without approval is removed or approved after the fact, and "
        "the reason is recorded; the access granted is compared with what was approved.",
        information=(
            Information(
                "Access request and approval record",
                "SYSTEM_SCREEN",
                ("User", "Access requested", "Approver", "Approval date"),
            ),
            Information(
                "User and role change log from the system",
                "SYSTEM_REPORT",
                ("User", "Role or permission", "Date granted", "Granted by"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The request and its approval in {access-tool}, and the system's own record of "
        "the grant with its date.",
        slots=(
            _system(),
            ADMIN,
            POLICY,
            Slot(
                "access-tool",
                "the access request tool",
                "SYSTEM",
                "Where requests and approvals are recorded.",
                "ServiceNow",
                blocks=False,
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "access-termination",
    Statement(
        text="HR records each termination in {hr-system}. {admin-role} receives the termination "
        "list {feed-frequency} and disables or removes the leaver's accounts in {system} within "
        "{removal-days} of the termination date.",
        risk="A former employee or contractor keeps access and records or changes financial data "
        "after leaving, or their account is used by someone else.",
        it_risk="Unauthorized access to data by users who have left the organization.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{admin-role}",
        reviewer="None: the removal itself is the control",
        owner="{access-owner}",
        authority="The administrator must have rights to disable accounts in {system}.",
        judgment="LOW",
        judgment_note="Matching the leaver to their accounts is mechanical once accounts are named "
        "consistently; it needs judgment when they are not.",
        precision="Every termination in the period: each leaver's accounts are disabled within "
        "{removal-days} of the termination date.",
        investigation="An account removed late is checked for activity after the termination "
        "date, and any activity is investigated with the business owner.",
        information=(
            Information(
                "HR termination listing", "SYSTEM_REPORT", ("Employee", "Termination date"), ipe=""
            ),
            Information(
                "System user listing with disable dates",
                "SYSTEM_REPORT",
                ("User", "Status", "Date disabled"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The termination record and the system's own record of when each account was "
        "disabled.",
        slots=(
            _system(),
            ADMIN,
            Slot(
                "hr-system",
                "the HR system",
                "SYSTEM",
                "The source of termination dates.",
                "Workday",
                blocks=False,
            ),
            Slot(
                "feed-frequency",
                "how often IT receives terminations",
                "TEXT",
                "How quickly IT can act on a termination.",
                "daily",
                blocks=False,
            ),
            Slot(
                "removal-days",
                "the number of days the access policy allows for removal",
                "DAYS",
                "The control's precision: what counts as late.",
                "3 business days",
                placeholder="the number of days in the access policy",
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "access-review",
    Statement(
        text="Each quarter, {review-owner} for {system} receives a listing of every user and their "
        "roles, produced from the system on a recorded date. They review each user's access "
        "against the user's current job, mark access to remove or change, and sign off the "
        "review by {review-deadline}. {admin-role} makes every change requested and records its "
        "completion.",
        risk="Access that is no longer appropriate, built up through job changes or missed "
        "removals, goes unnoticed and is used to record or change financial data.",
        it_risk="Unauthorized access to data through access that is no longer appropriate.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{review-owner}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must know what each user's job requires and must not review their "
        "own access.",
        judgment="MODERATE",
        judgment_note="Whether a role fits a job is a judgment the reviewer makes for each user.",
        precision="Every user with access to {system} at the listing date; access the reviewer "
        "cannot link to a current job need is flagged.",
        investigation="Each flagged user's access is removed or changed and the change recorded; "
        "access found inappropriate is checked for activity it was used for.",
        information=(
            Information(
                "User access listing from the system",
                "SYSTEM_REPORT",
                ("User", "Role", "Status", "Date produced"),
                ipe="",
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The listing with its production date and record count, the reviewer's sign-off "
        "and decisions, and the records of the changes made.",
        slots=(
            _system(),
            ADMIN,
            _role(
                "review-owner",
                "the role that reviews access",
                "The operator: the person with knowledge of each user's job.",
                "Application owner",
            ),
            Slot(
                "review-deadline",
                "the deadline in the access review procedure",
                "PERIOD",
                "When a quarter's review counts as late.",
                "30 days after quarter end",
                blocks=False,
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "access-privileged",
    Statement(
        title="Privileged access is reviewed quarterly",
        text="Each quarter, {privileged-reviewer} receives a listing, produced from {system} on a "
        "recorded date, of every user with {privileged-definition}. They confirm for each user "
        "that the role needs the access, and sign the listing. Access no longer needed is removed "
        "by {admin-role}.",
        risk="Administrator or other powerful access is held by people who do not need it, who "
        "could change data, configuration, or security settings without detection.",
        it_risk="Unauthorized access to data and to system settings through privileged accounts.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{privileged-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must be senior to, and independent of, the privileged users.",
        judgment="MODERATE",
        judgment_note="Whether a role needs privileged access is a judgment for each user.",
        precision="Every user with {privileged-definition} in {system} at the listing date.",
        investigation="Access the reviewer does not confirm is removed and its removal recorded; "
        "activity under that access since the last review is examined.",
        information=(
            Information(
                "Privileged user listing from the system",
                "SYSTEM_REPORT",
                ("User", "Privileged role", "Date produced"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The signed listing with its production date and the removal records.",
        slots=(
            _system(),
            ADMIN,
            _role(
                "privileged-reviewer",
                "the role that approves privileged access",
                "The operator; must be independent of the privileged users.",
                "Head of IT",
            ),
            Slot(
                "privileged-definition",
                "the roles the client defines as privileged",
                "TEXT",
                "The population: which access counts as privileged, in each layer.",
                "SAP_ALL, database DBA, and operating system root",
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "access-authentication",
    Statement(
        text="{system} enforces the authentication settings that {security-policy} requires: "
        "{auth-settings}. The settings apply to every interactive sign-in.",
        risk="Weak authentication lets someone sign in as another user and record or change "
        "financial data in their name.",
        it_risk="Unauthorized access to data through weak or bypassed authentication.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="AUTOMATED",
        frequency="RECURRING",
        operator="The system",
        reviewer="None: the configuration is the control",
        owner="{access-owner}",
        authority="Only administrators authorized under user access controls can change the "
        "settings.",
        judgment="LOW",
        judgment_note="The system applies the settings without judgment.",
        precision="Every interactive sign-in to {system}.",
        investigation="A setting found below policy is corrected through change management and "
        "the period it applied is assessed.",
        information=(
            Information(
                "Authentication configuration",
                "SYSTEM_SCREEN",
                ("Setting", "Configured value", "Date shown"),
            ),
        ),  # fmt: skip
        itgcs=("ITGC-AC-04", "ITGC-CM-04"),
        evidence="The configured settings shown from the system with a date, and the history of "
        "changes to them in the period.",
        slots=(
            _system(),
            Slot(
                "security-policy",
                "the information security policy",
                "TEXT",
                "The criteria the settings are compared with.",
                "Information Security Policy v7",
                blocks=False,
            ),
            Slot(
                "auth-settings",
                "the required settings",
                "TEXT",
                "What the system must enforce.",
                "passwords of 12 or more characters, lockout after 5 failed attempts, and "
                "multi-factor authentication",
                blocks=False,
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "access-shared-accounts",
    Statement(
        text="Each quarter, {account-reviewer} reviews the inventory of shared, generic, and "
        "service accounts in {system}, produced from the system on a recorded date. Each "
        "account has a named owner, and an account able to sign in interactively has a "
        "recorded approval. Accounts without an owner or approval are disabled by "
        "{admin-role}.",
        risk="An account no one owns is used to record or change data with no one accountable.",
        it_risk="Unauthorized access to data through accounts not assigned to a person.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{account-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must be able to identify each account's purpose and owner.",
        judgment="MODERATE",
        judgment_note="Whether an account still has a purpose is a judgment.",
        precision="Every shared, generic, and service account in {system} at the listing date.",
        investigation="An account without an owner or approval is disabled, or given an owner and "
        "approved, and the decision recorded.",
        information=(
            Information(
                "Account inventory from the system",
                "SYSTEM_REPORT",
                ("Account", "Type", "Owner", "Interactive sign-in allowed"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed inventory with its production date, the reviewer's sign-off, and "
        "the records of accounts disabled.",
        slots=(
            _system(),
            ADMIN,
            _role(
                "account-reviewer",
                "the role that reviews shared and service accounts",
                "The operator.",
                "IT Security Analyst",
            ),
            _role(
                "access-owner",
                "the control owner for user access",
                "Accountable for the control's design and operation.",
                "IT Security Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "change-approval",
    Statement(
        text="Every change to {system}'s programs, database, or infrastructure is raised in "
        "{change-tool}, tested in a non-production environment with the test results attached, "
        "and approved by the business owner and {it-approver} in the tool before it is deployed "
        "to production.",
        risk="An untested or unapproved change alters how {system} processes or calculates "
        "financial data.",
        it_risk="Unauthorized or untested changes to programs, which could cause transactions to "
        "be processed incorrectly.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The change implementer",
        reviewer="The business owner and {it-approver}",
        owner="{change-owner}",
        authority="Approvers must understand the change's effect and must not have developed it.",
        judgment="MODERATE",
        judgment_note="Approvers judge whether testing was adequate for the change.",
        precision="Every change deployed to production in the period, as listed from the system's "
        "own deployment or transport records.",
        investigation="A change found deployed without testing or approval is assessed for its "
        "effect and approved after the fact or reversed.",
        information=(
            Information(
                "Production deployment log from the system",
                "SYSTEM_REPORT",
                ("Change ID", "Deployed by", "Deployment date"),
            ),
            Information(
                "Change record", "SYSTEM_SCREEN", ("Test evidence", "Approvers", "Approval dates")
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The change record with test results and approvals dated before deployment, and "
        "the system's deployment record.",
        slots=(
            _system(),
            CHANGE_TOOL,
            _role(
                "it-approver",
                "the IT approver of changes",
                "Approves the change for IT.",
                "IT Change Advisory Board",
            ),
            _role(
                "change-owner",
                "the control owner for change management",
                "Accountable for the control's design and operation.",
                "IT Applications Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "change-emergency",
    Statement(
        text="A change that {emergency-criteria} may be deployed to {system} before approval. "
        "{emergency-approver} reviews and approves each emergency change in {change-tool} within "
        "{emergency-days} of its deployment.",
        risk="The emergency path is used to deploy changes that would not have been approved, "
        "without anyone checking them afterwards.",
        it_risk="Unauthorized changes to programs through the emergency change path.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The change implementer",
        reviewer="{emergency-approver}",
        owner="{change-owner}",
        authority="The approver must not have made the change.",
        judgment="MODERATE",
        judgment_note="Whether the change met the emergency criteria is a judgment.",
        precision="Every change deployed through the emergency path in the period.",
        investigation="A change that did not meet the criteria, or was not approved in time, is "
        "reviewed for its effect and escalated to {change-owner}.",
        information=(
            Information(
                "Emergency change listing from the change tool",
                "SYSTEM_REPORT",
                ("Change ID", "Deployment date", "Approval date", "Approver"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="Each emergency change's record with its deployment date and its retrospective "
        "approval date.",
        slots=(
            _system(),
            CHANGE_TOOL,
            Slot(
                "emergency-criteria",
                "the criteria for an emergency change",
                "TEXT",
                "What may use the emergency path.",
                "restores a failed production service",
                blocks=False,
            ),
            _role(
                "emergency-approver",
                "the approver of emergency changes",
                "Approves after deployment; must not be the implementer.",
                "IT Director",
            ),
            Slot(
                "emergency-days",
                "the number of days allowed for retrospective approval",
                "DAYS",
                "When an approval counts as late.",
                "2 business days",
                placeholder="the number of days in the emergency change procedure",
            ),
            _role(
                "change-owner",
                "the control owner for change management",
                "Accountable for the control's design and operation.",
                "IT Applications Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "change-segregation",
    Statement(
        title="Production deployment access is reviewed",
        text="Each quarter, {deploy-reviewer} reviews a listing, produced from {system} on a "
        "recorded date, of every user who can deploy changes to production, and confirms that "
        "none of them develops changes for {system}. Access that conflicts is removed by "
        "{admin-role}.",
        risk="A developer deploys their own unreviewed change to production.",
        it_risk="Unauthorized changes to programs by people who can both develop and deploy.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{deploy-reviewer}",
        reviewer="None: the review is the control",
        owner="{change-owner}",
        authority="The reviewer must know who develops changes and must not hold deployment "
        "access themselves.",
        judgment="LOW",
        judgment_note="Comparing the deployers with the developers is mechanical once both lists "
        "exist.",
        precision="Every user with production deployment access to {system} at the listing date.",
        investigation="A conflict is removed, or an approved exception is documented with a "
        "monitoring control over the user's deployments.",
        information=(
            Information(
                "Production deployment access listing",
                "SYSTEM_REPORT",
                ("User", "Role", "Date produced"),
            ),
            Information("Developer listing", "DOCUMENT", ("User", "Team")),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed listing with its production date, the sign-off, and removal "
        "records.",
        slots=(
            _system(),
            ADMIN,
            _role(
                "deploy-reviewer",
                "the role that reviews deployment access",
                "The operator.",
                "IT Applications Manager",
            ),
            _role(
                "change-owner",
                "the control owner for change management",
                "Accountable for the control's design and operation.",
                "IT Applications Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "change-configuration",
    Statement(
        text="A change to {system}'s configuration that affects financial processing "
        "({config-scope}) is requested in {change-tool} and approved by {config-approver} "
        "before it is made; the system logs each configuration change.",
        risk="A configuration change alters a tolerance, account determination, or workflow "
        "without authorization.",
        it_risk="Unauthorized changes to configuration that affect how transactions are processed.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The person who changes the configuration",
        reviewer="{config-approver}",
        owner="{change-owner}",
        authority="The approver must understand the financial effect of the setting.",
        judgment="MODERATE",
        judgment_note="The approver judges the financial effect of the change.",
        precision="Every logged change to {config-scope} in the period.",
        investigation="A change without approval is assessed and approved after the fact or "
        "reversed.",
        information=(
            Information(
                "Configuration change log from the system",
                "SYSTEM_REPORT",
                ("Setting", "Old value", "New value", "Changed by", "Date"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The request and its approval, and the system's configuration change log.",
        slots=(
            _system(),
            CHANGE_TOOL,
            Slot(
                "config-scope",
                "the configuration that affects financial processing",
                "TEXT",
                "The population: which settings are in scope.",
                "tolerances, account determination, and approval workflows",
                blocks=False,
            ),
            _role(
                "config-approver",
                "the approver of configuration changes",
                "Approves before the change.",
                "Finance systems lead",
            ),
            _role(
                "change-owner",
                "the control owner for change management",
                "Accountable for the control's design and operation.",
                "IT Applications Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "change-data",
    Statement(
        text="A direct change to production data in {system} (outside the application's normal "
        "screens) is requested in {change-tool}, approved by the data owner, made by {data-admin}, "
        "and logged by the system.",
        risk="Financial data is altered directly, bypassing the application's controls.",
        it_risk="Unauthorized changes to data through direct database access.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{data-admin}",
        reviewer="The data owner",
        owner="{change-owner}",
        authority="Only {data-admin} can change data directly; the data owner must not make the "
        "change.",
        judgment="LOW",
        judgment_note="The approval is of a specific, stated change.",
        precision="Every direct data change logged in the period.",
        investigation="A change without approval is reviewed with the data owner and corrected if "
        "needed.",
        information=(
            Information(
                "Direct data change log", "SYSTEM_REPORT", ("Table", "Change", "Made by", "Date")
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The request with the data owner's approval, and the system's log of the change.",
        slots=(
            _system(),
            CHANGE_TOOL,
            _role(
                "data-admin",
                "the role allowed to change data directly",
                "The operator.",
                "Database administrator",
            ),
            _role(
                "change-owner",
                "the control owner for change management",
                "Accountable for the control's design and operation.",
                "IT Applications Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-jobs",
    Statement(
        text="{ops-role} monitors the scheduled batch jobs for {system} in {scheduler} each day. "
        "Each failed job is logged as an incident, investigated, and rerun or resolved, and the "
        "resolution is recorded.",
        risk="A failed interface or batch job leaves transactions unprocessed or processed twice.",
        it_risk="Incomplete or inaccurate processing of data through failed jobs.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="DAILY",
        operator="{ops-role}",
        reviewer="None",
        owner="{ops-owner}",
        authority="The operator must be able to rerun jobs and judge whether a rerun is complete.",
        judgment="MODERATE",
        judgment_note="Whether a rerun fully recovered the processing is a judgment.",
        precision="Every failure of a job that processes financial data, as the scheduler reports "
        "it.",
        investigation="Each failure is logged, investigated, and resolved; the operator confirms "
        "the data was processed once and completely.",
        information=(
            Information(
                "Job run history from the scheduler", "SYSTEM_REPORT", ("Job", "Run date", "Status")
            ),
        ),  # fmt: skip
        itgcs=("ITGC-AC-04",),
        evidence="The scheduler's run history, and the incident record for each failure with its "
        "resolution.",
        slots=(
            _system(),
            Slot(
                "scheduler",
                "the job scheduler",
                "SYSTEM",
                "Where jobs run and are monitored.",
                "Control-M",
                blocks=False,
            ),
            _role("ops-role", "the team that monitors jobs", "The operator.", "IT operations"),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-scheduling",
    Statement(
        title="Job schedule changes are approved",
        text="A change to {system}'s job schedule (a new job, or a change to a job's timing, "
        "parameters, or dependencies) is requested in {change-tool} and approved by "
        "{schedule-approver} before it is made in {scheduler}.",
        risk="A job is added, removed, or retimed without authorization, so transactions are "
        "processed incorrectly or not at all.",
        it_risk="Unauthorized changes to batch processing.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The scheduler administrator",
        reviewer="{schedule-approver}",
        owner="{ops-owner}",
        authority="The approver must understand the job's effect on financial processing.",
        judgment="LOW",
        judgment_note="The approval is of a stated change.",
        precision="Every change to the schedule of jobs that process financial data.",
        investigation="A change without approval is assessed and approved after the fact or "
        "reversed.",
        information=(
            Information(
                "Schedule change log from the scheduler",
                "SYSTEM_REPORT",
                ("Job", "Change", "Changed by", "Date"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The change request with its approval dated before the change, and the "
        "scheduler's change log.",
        slots=(
            _system(),
            CHANGE_TOOL,
            Slot(
                "scheduler",
                "the job scheduler",
                "SYSTEM",
                "Where jobs run and are monitored.",
                "Control-M",
                blocks=False,
            ),
            _role(
                "schedule-approver",
                "the approver of schedule changes",
                "Approves the change.",
                "IT Operations Manager",
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-scheduler-access",
    Statement(
        text="Each quarter, {ops-owner} reviews a listing, produced from {scheduler} on a recorded "
        "date, of every user who can change {system}'s job schedule, confirms each one's need, "
        "and has access no longer needed removed.",
        risk="People who should not change batch processing can do so.",
        it_risk="Unauthorized changes to batch processing through excessive scheduler access.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{ops-owner}",
        reviewer="None: the review is the control",
        owner="{ops-owner}",
        authority="The reviewer must know who needs to change the schedule.",
        judgment="LOW",
        judgment_note="The population is small and the need is usually clear.",
        precision="Every user able to change the schedule at the listing date.",
        investigation="Access not confirmed is removed and the removal recorded.",
        information=(
            Information("Scheduler user listing", "SYSTEM_REPORT", ("User", "Rights", "Date")),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed listing with its production date, the sign-off, and removals.",
        slots=(
            _system(),
            Slot(
                "scheduler",
                "the job scheduler",
                "SYSTEM",
                "Where jobs run and are monitored.",
                "Control-M",
                blocks=False,
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-backup",
    Statement(
        title="Backups are configured and run on schedule",
        text="{backup-tool} backs up {system}'s financial data {backup-frequency} under a "
        "configured schedule and retention of {retention}.",
        risk="Financial data is lost and cannot be recovered after a failure.",
        it_risk="Loss of data that cannot be recovered.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="AUTOMATED",
        frequency="DAILY",
        operator="{backup-tool}",
        reviewer="None: the configuration is the control",
        owner="{ops-owner}",
        authority="Only authorized administrators can change the schedule or retention.",
        judgment="LOW",
        judgment_note="The tool runs on its configuration.",
        precision="Every scheduled backup of {system}'s financial data.",
        investigation="Failures are followed up under ITGC-OP-03.1.",
        information=(
            Information(
                "Backup configuration", "SYSTEM_SCREEN", ("Scope", "Schedule", "Retention")
            ),
        ),  # fmt: skip
        itgcs=("ITGC-AC-04", "ITGC-CM-04"),
        evidence="The backup configuration shown from the tool with a date, and changes to it in "
        "the period.",
        slots=(
            _system(),
            Slot(
                "backup-tool", "the backup tool", "SYSTEM", "The operator.", "Veeam", blocks=False
            ),
            Slot(
                "backup-frequency",
                "how often backups run",
                "TEXT",
                "The policy the schedule is compared with.",
                "daily",
                blocks=False,
            ),
            Slot(
                "retention",
                "the retention period",
                "PERIOD",
                "How long backups are kept.",
                "35 days",
                blocks=False,
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-backup-failures",
    Statement(
        text="{ops-role} reviews {system}'s backup results each day. Each failed backup is "
        "investigated and rerun, or otherwise resolved, within {backup-fix-days}, and the "
        "resolution is recorded.",
        risk="A failed backup goes unnoticed, leaving data unrecoverable.",
        it_risk="Loss of data that cannot be recovered.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="DAILY",
        operator="{ops-role}",
        reviewer="None",
        owner="{ops-owner}",
        authority="The operator must be able to rerun backups.",
        judgment="LOW",
        judgment_note="A failure is reported by the tool.",
        precision="Every failed backup the tool reports.",
        investigation="Each failure is rerun or resolved and the result recorded.",
        information=(
            Information("Backup job history", "SYSTEM_REPORT", ("Job", "Date", "Status")),
        ),  # fmt: skip
        itgcs=("ITGC-AC-04",),
        evidence="The backup history and, for each failure, the record of its resolution.",
        slots=(
            _system(),
            _role("ops-role", "the team that monitors backups", "The operator.", "IT operations"),
            Slot(
                "backup-fix-days",
                "the time allowed to resolve a failed backup",
                "DAYS",
                "When a resolution counts as late.",
                "1 business day",
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-restore-test",
    Statement(
        text="At least once a year, {ops-role} restores {system}'s financial data from a backup to "
        "a test environment, and {restore-reviewer} confirms the restored data is complete and "
        "readable and signs off the result.",
        risk="Backups exist but cannot be restored when needed.",
        it_risk="Loss of data that cannot be recovered.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="ANNUAL",
        operator="{ops-role}",
        reviewer="{restore-reviewer}",
        owner="{ops-owner}",
        authority="The reviewer must be able to judge whether the restored data is complete.",
        judgment="MODERATE",
        judgment_note="Judging the restored data complete needs a comparison with the source.",
        precision="A restore of {system}'s financial data, compared with its source.",
        investigation="A failed or incomplete restore is investigated and the backup process "
        "corrected; the test is repeated.",
        information=(
            Information(
                "Restore test record",
                "DOCUMENT",
                ("Backup used", "Restore date", "Checks performed", "Result"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The restore test record with the checks performed and the reviewer's sign-off.",
        slots=(
            _system(),
            _role(
                "ops-role", "the team that performs restore tests", "The operator.", "IT operations"
            ),
            _role(
                "restore-reviewer",
                "the reviewer of restore tests",
                "Signs off the result.",
                "Application owner",
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-incidents",
    Statement(
        text="Incidents affecting {system} are logged in {incident-tool} with a priority under "
        "{incident-procedure}, tracked to resolution, and closed with the resolution recorded; for "
        "an incident of {major-priority}, the root cause is recorded.",
        risk="An incident that affects financial processing is not resolved, or recurs.",
        it_risk="Incomplete or inaccurate processing of data from unresolved incidents.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="IT support",
        reviewer="None",
        owner="{ops-owner}",
        authority="Support staff must be able to diagnose and resolve incidents or escalate them.",
        judgment="MODERATE",
        judgment_note="Prioritizing an incident is a judgment under the procedure's criteria.",
        precision="Every incident logged against {system} in the period.",
        investigation="An incident open beyond its target is escalated under the procedure.",
        information=(
            Information(
                "Incident listing from the incident tool",
                "SYSTEM_REPORT",
                ("Incident", "Priority", "Opened", "Closed", "Resolution"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="Each incident record with its priority, resolution, and dates.",
        slots=(
            _system(),
            Slot(
                "incident-tool",
                "the incident tool",
                "SYSTEM",
                "Where incidents are logged.",
                "ServiceNow",
                blocks=False,
            ),
            Slot(
                "incident-procedure",
                "the incident management procedure",
                "TEXT",
                "The criteria for priority.",
                "IT Incident Procedure",
                blocks=False,
            ),
            Slot(
                "major-priority",
                "the priority that counts as major",
                "TEXT",
                "Which incidents need a root cause.",
                "priority 1 or 2",
                blocks=False,
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "operations-physical",
    Statement(
        text="Each year, {facilities-reviewer} reviews the list of people with physical access to "
        "the data center hosting {system}, confirms each person's need, and has access no longer "
        "needed removed.",
        risk="Someone without a need reaches the servers and damages or tampers with them.",
        it_risk="Unauthorized physical access to systems and data.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="ANNUAL",
        operator="{facilities-reviewer}",
        reviewer="None: the review is the control",
        owner="{ops-owner}",
        authority="The reviewer must know who needs physical access.",
        judgment="LOW",
        judgment_note="The population is small and the need is usually clear.",
        precision="Every person on the data center access list at the review date.",
        investigation="Access not confirmed is removed and the removal recorded.",
        information=(
            Information("Data center access list", "SYSTEM_REPORT", ("Person", "Badge", "Date")),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed access list with its date, the sign-off, and removals.",
        slots=(
            _system(),
            _role(
                "facilities-reviewer",
                "the reviewer of data center access",
                "The operator.",
                "Facilities manager",
            ),
            _role(
                "ops-owner",
                "the control owner for IT operations",
                "Accountable for the control's design and operation.",
                "IT Operations Manager",
            ),
        ),  # fmt: skip
        applies_when="The client owns or operates the data center. For a system hosted by a "
        "vendor, physical security is covered by the vendor's SOC 1 report and system scoping "
        "takes this control out.",
    ),
)

_add(
    "entity-code-of-conduct",
    Statement(
        text="Each year, every employee acknowledges the code of conduct in {ack-tool} by "
        "{ack-deadline}. {conduct-owner} follows up each employee who has not acknowledged it, "
        "and reports the completion rate to {conduct-oversight}.",
        risk="Employees act against the company's ethical standards without consequence.",
        principle="Principle 1: The organization demonstrates a commitment to integrity and "
        "ethical values.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="ANNUAL",
        operator="{conduct-owner}",
        reviewer="{conduct-oversight}",
        owner="{conduct-owner}",
        authority="The operator must be able to require acknowledgement and escalate.",
        judgment="LOW",
        judgment_note="Completion is a count.",
        precision="Every employee employed at {ack-deadline}.",
        investigation="Each employee not acknowledged is followed up until they acknowledge or "
        "the matter is escalated.",
        information=(
            Information(
                "Acknowledgement listing", "SYSTEM_REPORT", ("Employee", "Acknowledged on")
            ),
            Information("Employee listing from HR", "SYSTEM_REPORT", ("Employee", "Status")),
        ),  # fmt: skip
        itgcs=(),
        evidence="The acknowledgement listing compared with the employee listing, the follow-ups, "
        "and the report to {conduct-oversight}.",
        slots=(
            Slot(
                "ack-tool",
                "the acknowledgement tool",
                "SYSTEM",
                "Where acknowledgements are recorded.",
                "Workday Learning",
                blocks=False,
            ),
            Slot(
                "ack-deadline",
                "the acknowledgement deadline",
                "PERIOD",
                "When the year's acknowledgements must be complete.",
                "31 March",
                blocks=False,
            ),
            _role(
                "conduct-owner",
                "the role that owns the code of conduct",
                "The operator.",
                "Chief Compliance Officer",
            ),
            _role(
                "conduct-oversight",
                "the body the completion rate is reported to",
                "The reviewer.",
                "Audit committee",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "entity-whistleblower",
    Statement(
        text="Each report received through {hotline} is logged and investigated by "
        "{investigator}. Each quarter, {investigator} summarizes the reports, their status, and "
        "their outcomes to {wb-oversight}, which reviews the summary.",
        risk="Reports of fraud or misconduct are not investigated or not seen by those charged "
        "with governance.",
        principle="Principle 14: The organization internally communicates information, including "
        "objectives and responsibilities for internal control, necessary to support the "
        "functioning of internal control. Also Principle 8: The organization considers the "
        "potential for fraud in assessing risks to the achievement of objectives (KPMG ICFR "
        "Handbook (2025) Examples 2.5 and 2.6.20 place the hotline and its reporting there).",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="QUARTERLY",
        operator="{investigator}",
        reviewer="{wb-oversight}",
        owner="{investigator}",
        authority="The investigator must be independent of the people reported on.",
        judgment="HIGH",
        judgment_note="Investigating a report and deciding its outcome are judgments.",
        precision="Every report received in the period.",
        investigation="Each report is investigated to a recorded outcome; matters involving senior "
        "management go directly to {wb-oversight}.",
        information=(
            Information(
                "Hotline report log", "SYSTEM_REPORT", ("Report", "Date", "Status", "Outcome")
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The report log, investigation files, the quarterly summaries, and the minutes "
        "recording {wb-oversight}'s review.",
        slots=(
            Slot(
                "hotline",
                "the whistleblower channel",
                "TEXT",
                "How reports are received.",
                "EthicsPoint hotline",
                blocks=False,
            ),
            _role(
                "investigator",
                "the role that investigates reports",
                "The operator.",
                "Head of Internal Audit",
            ),
            _role(
                "wb-oversight",
                "the body that reviews the summary",
                "The reviewer.",
                "Audit committee",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "itac-three-way-match",
    Statement(
        text="{system} compares each vendor invoice with its purchase order and goods receipt and "
        "blocks the invoice for payment when the quantity or price differs by more than "
        "{match-tolerance}. Only {release-role} can release a blocked invoice.",
        risk="An invoice for goods not ordered or not received, or at the wrong price, is paid.",
        assertions=("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
        control_type="PREVENTIVE",
        nature="AUTOMATED",
        frequency="RECURRING",
        operator="The system",
        reviewer="None: the configuration is the control",
        owner="{ap-owner}",
        authority="Only {release-role} can release a block.",
        judgment="LOW",
        judgment_note="The system applies the configured tolerance.",
        precision="Every invoice posted against a purchase order, at a tolerance of "
        "{match-tolerance}.",
        investigation="A blocked invoice is investigated with purchasing and the vendor and "
        "released only when resolved.",
        information=(
            Information(
                "Tolerance configuration",
                "SYSTEM_SCREEN",
                ("Tolerance key", "Quantity tolerance", "Price tolerance"),
            ),
        ),  # fmt: skip
        itgcs=ACCESS_ITGCS + CHANGE_ITGCS,
        evidence="The configured tolerances shown from the system, their change history, and one "
        "blocked invoice showing the control operated.",
        slots=(
            _system(),
            Slot(
                "match-tolerance",
                "the configured tolerance",
                "PERCENT",
                "The control's precision.",
                "2% or 100 in price; 0 in quantity",
            ),
            _role(
                "release-role",
                "the role allowed to release a payment block",
                "Release must be restricted.",
                "AP supervisor",
            ),
            _role(
                "ap-owner",
                "the control owner for accounts payable",
                "Accountable for the control's design and operation.",
                "AP Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "itac-credit-limit",
    Statement(
        text="{system} holds a sales order when the customer's open receivables plus the order "
        "would exceed the customer's credit limit. Only {credit-release-role} can release a held "
        "order.",
        risk="Goods are sold to customers unlikely to pay, overstating receivables.",
        assertions=("VALUATION_ALLOCATION",),
        control_type="PREVENTIVE",
        nature="AUTOMATED",
        frequency="RECURRING",
        operator="The system",
        reviewer="None: the configuration is the control",
        owner="{credit-owner}",
        authority="Only {credit-release-role} can release a hold.",
        judgment="LOW",
        judgment_note="The system applies the configured check.",
        precision="Every sales order for a customer with a credit limit.",
        investigation="A held order is reviewed by credit management and released or cancelled.",
        information=(
            Information(
                "Credit check configuration",
                "SYSTEM_SCREEN",
                ("Credit control area", "Check rule", "Exposure included"),
            ),
        ),  # fmt: skip
        itgcs=ACCESS_ITGCS + CHANGE_ITGCS,
        evidence="The configured credit check, its change history, and one held order showing the "
        "control operated.",
        slots=(
            _system(),
            _role(
                "credit-release-role",
                "the role allowed to release a credit hold",
                "Release must be restricted.",
                "Credit manager",
            ),
            _role(
                "credit-owner",
                "the control owner for credit",
                "Accountable for the control's design and operation.",
                "Credit Manager",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "ipe-aged-receivables",
    Statement(
        text="Each quarter, {ar-preparer} produces the aged receivables report from {system} using "
        "{aging-report} with recorded parameters, agrees its total to the receivables balance in "
        "the general ledger at the same date, and investigates any difference before the report "
        "is used for the bad debt reserve.",
        risk="The bad debt reserve is calculated from a report that is incomplete or ages items "
        "incorrectly.",
        assertions=("VALUATION_ALLOCATION", "COMPLETENESS"),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{ar-preparer}",
        reviewer="The reviewer of the bad debt reserve",
        owner="{ar-owner}",
        authority="The preparer must be able to explain differences between the report and the "
        "ledger.",
        judgment="LOW",
        judgment_note="Agreeing totals is mechanical; explaining a difference may need judgment.",
        precision="The report total agrees to the ledger exactly, or each difference is explained.",
        investigation="A difference is investigated and the report rerun or corrected before use.",
        information=(
            Information(
                "Aged receivables report",
                "SYSTEM_REPORT",
                ("Customer", "Invoice", "Amount", "Due date", "Aging bucket"),
            ),
            Information(
                "General ledger trial balance", "SYSTEM_REPORT", ("Account", "Balance", "Date")
            ),
        ),  # fmt: skip
        itgcs=ACCESS_ITGCS + CHANGE_ITGCS,
        evidence="The report with its parameters and run date, the agreement to the ledger, and "
        "the explanation of any difference.",
        slots=(
            _system(),
            Slot(
                "aging-report",
                "the report name or transaction",
                "REPORT",
                "Which report is relied on.",
                "S_ALR_87012178",
                blocks=False,
            ),
            _role("ar-preparer", "the preparer of the report", "The operator.", "AR accountant"),
            _role(
                "ar-owner",
                "the control owner for receivables",
                "Accountable for the control's design and operation.",
                "Controller",
            ),
        ),  # fmt: skip
    ),
)

_add(
    "ipe-journal-listing",
    Statement(
        text="Each quarter, {je-preparer} produces the listing of journal entries from {system} "
        "with recorded parameters and agrees the net of the entries for each account to the "
        "change in that account's ledger balance for the period, before the listing is used for "
        "journal entry review or testing.",
        risk="Journal entry review or testing misses entries because the listing is incomplete.",
        assertions=("COMPLETENESS", "EXISTENCE_OCCURRENCE"),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{je-preparer}",
        reviewer="None",
        owner="{je-owner}",
        authority="The preparer must be able to explain differences.",
        judgment="LOW",
        judgment_note="The roll-forward is mechanical.",
        precision="The net entries agree to each account's balance change exactly, or each "
        "difference is explained.",
        investigation="A difference is investigated and the listing rerun with corrected "
        "parameters.",
        information=(
            Information(
                "Journal entry listing",
                "QUERY",
                ("Entry", "Account", "Amount", "Posted by", "Posting date", "Source"),
            ),
            Information(
                "Trial balance at the start and end of the period",
                "SYSTEM_REPORT",
                ("Account", "Balance", "Date"),
            ),
        ),  # fmt: skip
        itgcs=ACCESS_ITGCS + CHANGE_ITGCS,
        evidence="The listing with its parameters and run date, and the roll-forward to the "
        "ledger with any differences explained.",
        slots=(
            _system(),
            _role(
                "je-preparer",
                "the preparer of the listing",
                "The operator.",
                "Financial reporting analyst",
            ),
            _role(
                "je-owner",
                "the control owner for journal entries",
                "Accountable for the control's design and operation.",
                "Controller",
            ),
        ),  # fmt: skip
    ),
)
