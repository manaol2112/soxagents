"""Control statements for the standard controls added in library version 4, wave 1
(milestone L3c): twelve IT general controls, eleven application controls, and six key
reports. See control_statements.py for what each field means and statements_itgc.py for
the shared slots.

Every statement is a draft for a SOX methodology reviewer. A value only the client knows
is a {slot}; nothing here sets a threshold, a deadline, or a role on the client's behalf.
"""

from ai_workforce_api.control_statements import Information, Slot, Statement
from ai_workforce_api.statements_itgc import (
    ACCESS_ITGCS,
    ADMIN,
    CHANGE_ITGCS,
    CHANGE_TOOL,
    _role,
    _system,
)

STATEMENTS: dict[str, Statement] = {}


def _add(key: str, statement: Statement) -> None:
    STATEMENTS[key] = statement


ACCESS_OWNER = _role(
    "access-owner",
    "the control owner for user access",
    "Accountable for the control's design and operation.",
    "IT Security Manager",
)
CHANGE_OWNER = _role(
    "change-owner",
    "the control owner for change management",
    "Accountable for the control's design and operation.",
    "IT Applications Manager",
)
OPS_OWNER = _role(
    "ops-owner",
    "the control owner for IT operations",
    "Accountable for the control's design and operation.",
    "IT Operations Manager",
)
# The IT general controls an automated control relies on, including the reviews of
# segregation of duties and privileged activity added in this wave.
AUTOMATED_ITGCS = ACCESS_ITGCS + CHANGE_ITGCS

# Logical access

_add(
    "access-transfer",
    Statement(
        text="When HR records a transfer or change of role in {hr-system}, {admin-role} receives "
        "it and the user's new manager re-approves the access the user keeps in {system}. "
        "Access the new role does not need is removed within {transfer-days} of the "
        "effective date.",
        risk="A user who changes role keeps the access of the old role, accumulating access that "
        "no one approved for the new job.",
        it_risk="Unauthorized access to data through access that outlived the job it was "
        "approved for.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{admin-role}",
        reviewer="The user's new manager",
        owner="{access-owner}",
        authority="The new manager must know what the new role needs and must not be the user; "
        "the administrator removes only what the manager did not re-approve.",
        judgment="LOW",
        judgment_note="The manager decides which access the new role needs; the administrator "
        "matches the removal to the decision.",
        precision="Every transfer and change of role recorded in {hr-system} in the period.",
        investigation="Access found kept without re-approval is removed or approved after the "
        "fact, and the reason is recorded.",
        information=(
            Information(
                "HR transfer listing",
                "SYSTEM_REPORT",
                ("Employee", "Old role", "New role", "Effective date"),
            ),
            Information(
                "User and role change log from the system",
                "SYSTEM_REPORT",
                ("User", "Role removed or kept", "Date", "Changed by"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The transfer record, the new manager's re-approval, and the system's record of "
        "the access removed with its date.",
        slots=(
            _system(),
            ADMIN,
            Slot(
                "hr-system",
                "the HR system",
                "SYSTEM",
                "The source of transfers.",
                "Workday",
                blocks=False,
            ),
            Slot(
                "transfer-days",
                "the number of days allowed to remove access after a transfer",
                "DAYS",
                "The control's precision: what counts as late.",
                "10 business days",
                placeholder="the number of days the access policy allows after a transfer",
            ),
            ACCESS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "access-firefighter",
    Statement(
        text="Emergency (firefighter) access to {system} is checked out through {ff-tool} against "
        "a ticket and approved by {ff-approver} before use; the session's activity log is "
        "reviewed by {ff-reviewer} within {ff-review-days} of the session, and any activity "
        "beyond the ticket's purpose is investigated.",
        risk="Someone uses emergency privileged access to change data, configuration, or security "
        "settings outside the incident it was granted for, without anyone seeing it.",
        it_risk="Unauthorized changes to data, programs, or configuration through privileged "
        "emergency access.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="EVENT_DRIVEN",
        operator="{ff-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must be able to read the system's activity log and must not be "
        "the user of the session; the approver must not be the user.",
        judgment="MODERATE",
        judgment_note="Whether logged activity fits the ticket's purpose is a judgment.",
        precision="Every firefighter session in the period, as the tool's session log lists them.",
        investigation="Activity outside the ticket's purpose is investigated with the session's "
        "user and the system owner, and any change it made is reviewed for reversal.",
        information=(
            Information(
                "Firefighter session log from the tool",
                "SYSTEM_REPORT",
                ("Session", "User", "Firefighter ID", "Ticket", "Start and end", "Approver"),
            ),
            Information(
                "Session activity log",
                "SYSTEM_REPORT",
                ("Transaction or command", "Object", "Time"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The session log with its ticket and approval, the activity log, and the "
        "reviewer's sign-off with any investigation.",
        slots=(
            _system(),
            Slot(
                "ff-tool",
                "the emergency access tool",
                "SYSTEM",
                "Where sessions are checked out and logged.",
                "SAP GRC Firefighter",
                blocks=False,
            ),
            _role(
                "ff-approver",
                "the approver of emergency access",
                "Approves the checkout.",
                "IT Security Manager",
            ),
            _role(
                "ff-reviewer",
                "the reviewer of firefighter activity logs",
                "The operator.",
                "IT Controls Manager",
            ),
            Slot(
                "ff-review-days",
                "the number of days allowed to review a session log",
                "DAYS",
                "When a review counts as late.",
                "5 business days",
                placeholder="the number of days the emergency access procedure allows for review",
            ),
            ACCESS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "access-third-party",
    Statement(
        text="Each account in {system} held by a vendor, contractor, or other third party has a "
        "named internal sponsor, an approval, and an expiry date no later than the "
        "engagement's end. Each quarter, {sponsor-reviewer} reviews the listing of third-party "
        "accounts, produced from the system on a recorded date, confirms each is still needed, "
        "and has {admin-role} disable the rest.",
        risk="A vendor or contractor keeps access after the engagement ends, or holds access no "
        "one inside the company is accountable for.",
        it_risk="Unauthorized access to data by people outside the organization.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{sponsor-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must know the engagements the third parties work on.",
        judgment="LOW",
        judgment_note="Whether an engagement continues is a fact the sponsor knows.",
        precision="Every third-party account in {system} at the listing date.",
        investigation="An account without a sponsor, approval, or expiry, or past its expiry, is "
        "disabled and the decision recorded.",
        information=(
            Information(
                "Third-party account listing from the system",
                "SYSTEM_REPORT",
                ("Account", "Third party", "Sponsor", "Expiry date", "Date produced"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed listing with its production date, the sponsor approvals, the "
        "sign-off, and the records of accounts disabled.",
        slots=(
            _system(),
            ADMIN,
            _role(
                "sponsor-reviewer",
                "the role that reviews third-party accounts",
                "The operator.",
                "IT Security Analyst",
            ),
            ACCESS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "access-sod-rules",
    Statement(
        text="{sod-tool} holds {sod-ruleset} for {system}. Each quarter, {sod-reviewer} runs the "
        "conflict report, produced on a recorded date, and for each user with a conflict "
        "either has the conflicting access removed by {admin-role} or records an approved "
        "mitigating control. Changes to the ruleset are approved by {sod-reviewer}.",
        risk="One person can both initiate and approve, or record and conceal, a transaction "
        "because their roles together conflict, and no one knows.",
        it_risk="Unauthorized or fraudulent transactions through combinations of access that "
        "defeat segregation of duties.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{sod-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must understand the business processes the rules protect and "
        "must not hold a conflict themselves.",
        judgment="MODERATE",
        judgment_note="Whether a mitigating control covers a conflict is a judgment.",
        precision="Every user with a conflict under {sod-ruleset} at the report date.",
        investigation="A conflict without a removal or an approved mitigation is escalated to "
        "{access-owner}; activity under an unmitigated conflict is examined.",
        information=(
            Information(
                "Segregation-of-duties conflict report",
                "SYSTEM_REPORT",
                ("User", "Conflicting roles", "Rule", "Mitigation", "Date produced"),
            ),
            Information(
                "Ruleset change log",
                "SYSTEM_REPORT",
                ("Rule", "Change", "Approver", "Date"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The conflict report with its production date, each conflict's removal record "
        "or mitigation approval, the sign-off, and the ruleset change log.",
        slots=(
            _system(),
            ADMIN,
            Slot(
                "sod-tool",
                "the segregation-of-duties tool",
                "SYSTEM",
                "Where the rules run.",
                "SAP GRC Access Risk Analysis",
                blocks=False,
            ),
            Slot(
                "sod-ruleset",
                "the segregation-of-duties ruleset",
                "TEXT",
                "The population: which combinations count as conflicts.",
                "the firm's SAP ruleset v5, finance rules only",
            ),
            _role(
                "sod-reviewer",
                "the role that reviews conflicts and approves rule changes",
                "The operator.",
                "Business Controls Manager",
            ),
            ACCESS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "access-direct-db-os",
    Statement(
        text="Direct access to {system}'s database and operating system is limited to "
        "{infra-admin-role}. Each quarter, {infra-reviewer} reviews a listing, produced on a "
        "recorded date, of every account with database or operating-system access, confirms "
        "each one's need, and has access no longer needed removed. Privileged activity at "
        "those layers is logged, and the log cannot be altered by the administrators.",
        risk="Someone changes financial data or programs below the application, where the "
        "application's controls do not apply, and the change leaves no trace.",
        it_risk="Unauthorized access to data and programs through the database and operating "
        "system.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="QUARTERLY",
        operator="{infra-reviewer}",
        reviewer="None: the review is the control",
        owner="{access-owner}",
        authority="The reviewer must know who administers each layer and must not be one of the "
        "administrators reviewed.",
        judgment="LOW",
        judgment_note="The population is small and each administrator's need is usually clear.",
        precision="Every account with database or operating-system access at the listing date.",
        investigation="Access not confirmed is removed and the removal recorded; a log found "
        "alterable by administrators is escalated to {access-owner}.",
        information=(
            Information(
                "Database and operating-system account listings",
                "SYSTEM_REPORT",
                ("Layer", "Account", "Privilege", "Date produced"),
            ),
            Information(
                "Privileged activity log configuration",
                "SYSTEM_SCREEN",
                ("Logging enabled", "Log destination", "Who can alter the log"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reviewed listings with their production dates, the sign-off, the removals, "
        "and the logging configuration shown from each layer.",
        slots=(
            _system(),
            _role(
                "infra-admin-role",
                "the role allowed direct database and operating-system access",
                "The administrators.",
                "Database and platform administrators",
            ),
            _role(
                "infra-reviewer",
                "the role that reviews infrastructure access",
                "The operator.",
                "Head of Infrastructure",
            ),
            ACCESS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "access-security-monitoring",
    Statement(
        text="Security events from {system} and its infrastructure are collected in {siem-tool}. "
        "Each day, {soc-role} reviews the alerts that meet {alert-criteria}, investigates each, "
        "and records the outcome; an alert that indicates unauthorized access or change is "
        "escalated as a security incident.",
        risk="Unauthorized access to, or change of, financial systems goes unnoticed because no "
        "one reads the system's security events.",
        it_risk="Unauthorized access to data and programs that is not detected.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="DAILY",
        operator="{soc-role}",
        reviewer="None",
        owner="{ops-owner}",
        authority="The operator must be able to read the events, judge an alert, and escalate.",
        judgment="MODERATE",
        judgment_note="Whether an alert is a true positive is a judgment under the criteria.",
        precision="Every alert meeting {alert-criteria} on the day, as the tool lists them.",
        investigation="Each alert is investigated to a recorded outcome; a confirmed unauthorized "
        "access or change becomes a security incident under the incident procedure.",
        information=(
            Information(
                "Alert listing from the monitoring tool",
                "SYSTEM_REPORT",
                ("Alert", "Rule", "Source", "Time", "Status", "Outcome"),
            ),
            Information(
                "Log source configuration",
                "SYSTEM_SCREEN",
                ("Source", "Events collected", "Last received"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The day's alert listing with each alert's investigation and outcome, and the "
        "log source configuration showing the system's events are collected.",
        slots=(
            _system(),
            Slot(
                "siem-tool",
                "the security monitoring tool",
                "SYSTEM",
                "Where events are collected and alerts raised.",
                "Microsoft Sentinel",
                blocks=False,
            ),
            _role(
                "soc-role",
                "the team that reviews security alerts",
                "The operator.",
                "Security operations",
            ),
            Slot(
                "alert-criteria",
                "the alert criteria the daily review covers",
                "TEXT",
                "The population: which alerts must be reviewed.",
                "high and critical alerts on in-scope servers and privileged account events",
            ),
            OPS_OWNER,
        ),  # fmt: skip
    ),
)

# Change management

_add(
    "change-patching",
    Statement(
        text="Each operating-system, database, or application patch for {system} is raised in "
        "{change-tool}, tested in a non-production environment, and approved by "
        "{patch-approver} before it is applied to production. A patch applied without prior "
        "approval follows the emergency change procedure.",
        risk="A patch changes how the system behaves, or breaks a financial interface or job, "
        "without anyone having tested or approved it.",
        it_risk="Unauthorized or untested changes to the system's programs and platform.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The administrator who applies the patch",
        reviewer="{patch-approver}",
        owner="{change-owner}",
        authority="The approver must understand the patch's effect on the system and must not "
        "be the administrator applying it.",
        judgment="MODERATE",
        judgment_note="The approver judges whether the testing covered the patch's effect.",
        precision="Every patch applied to production in the period, as the system's patch "
        "history lists them.",
        investigation="A patch found applied without approval is assessed for its effect and "
        "approved after the fact or reversed.",
        information=(
            Information(
                "Patch history from the system",
                "SYSTEM_REPORT",
                ("Patch", "Layer", "Applied on", "Applied by"),
            ),
            Information(
                "Change record",
                "SYSTEM_SCREEN",
                ("Test results", "Approver", "Approval date"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The change record with test results and the approval dated before the patch, "
        "and the system's patch history.",
        slots=(
            _system(),
            CHANGE_TOOL,
            _role(
                "patch-approver",
                "the approver of patches",
                "Approves before production.",
                "Infrastructure Change Manager",
            ),
            CHANGE_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "change-sdlc",
    Statement(
        text="A new system, module, or major upgrade affecting {system} is delivered under the "
        "development life cycle: requirements are approved by the business owner, user "
        "acceptance testing is performed and signed off by the business owner against those "
        "requirements, and {go-live-approver} approves go-live in {change-tool} before the "
        "release reaches production.",
        risk="A new system or major release processes financial data in a way the business did "
        "not specify or test, and the defect reaches the financial statements.",
        it_risk="Inaccurate or incomplete processing from systems implemented without adequate "
        "requirements, testing, and approval.",
        assertions=(),
        control_type="PREVENTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The project or release manager",
        reviewer="The business owner and {go-live-approver}",
        owner="{change-owner}",
        authority="The business owner must own the process the release affects; the go-live "
        "approver must be independent of the project team.",
        judgment="HIGH",
        judgment_note="Whether acceptance testing covered the requirements is a judgment.",
        precision="Every project or release the development life cycle covers that reached "
        "production in the period.",
        investigation="A release found in production without acceptance sign-off or go-live "
        "approval is escalated to {change-owner} and its processing reviewed.",
        information=(
            Information(
                "Release register",
                "SYSTEM_REPORT",
                ("Project or release", "Go-live date", "Approver"),
            ),
            Information(
                "Acceptance test results",
                "DOCUMENT",
                ("Requirement", "Test case", "Result", "Tester", "Sign-off"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The approved requirements, the acceptance test results with the business "
        "owner's sign-off, and the go-live approval dated before the release.",
        slots=(
            _system(),
            CHANGE_TOOL,
            _role(
                "go-live-approver",
                "the approver of go-live",
                "Approves the release.",
                "IT Steering Committee",
            ),
            CHANGE_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "change-data-migration",
    Statement(
        text="When data is migrated or converted into {system}, the migration team reconciles "
        "record counts and control totals between the source and {system} for each data "
        "object, resolves each difference, and {migration-approver} approves the "
        "reconciliation before cutover.",
        risk="Balances or master data arrive incomplete or altered in the new system and the "
        "error is carried into the financial statements.",
        it_risk="Incomplete or inaccurate data from a migration or conversion.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="EVENT_DRIVEN",
        operator="The migration team",
        reviewer="{migration-approver}",
        owner="{change-owner}",
        authority="The approver must own the data migrated and must not have run the migration.",
        judgment="MODERATE",
        judgment_note="Whether a difference is explained is a judgment.",
        precision="Every data object migrated, reconciled to record counts and control totals.",
        investigation="A difference is traced to its records and corrected in the source or the "
        "target before cutover, or accepted by {migration-approver} with the reason recorded.",
        information=(
            Information(
                "Migration reconciliation",
                "SPREADSHEET",
                (
                    "Data object",
                    "Source count and total",
                    "Target count and total",
                    "Difference",
                    "Resolution",
                ),
            ),
            Information(
                "Source and target extracts",
                "SYSTEM_REPORT",
                ("Record count", "Control total", "Extract date"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The reconciliation for each data object with the source and target extracts, "
        "the resolution of each difference, and the approval dated before cutover.",
        slots=(
            _system(),
            _role(
                "migration-approver",
                "the approver of migration reconciliations",
                "Approves before cutover.",
                "Corporate Controller",
            ),
            CHANGE_OWNER,
        ),  # fmt: skip
    ),
)

# IT operations

_add(
    "operations-interfaces",
    Statement(
        text="Each day, {ops-role} reviews the run log of {interfaces} into {system} in "
        "{interface-tool} for "
        "failed runs and record-count or control-total mismatches between source and target, "
        "investigates each, and reprocesses or corrects the records; the resolution is "
        "recorded.",
        risk="Transactions are lost, duplicated, or altered between systems and the receiving "
        "ledger is incomplete or inaccurate without anyone knowing.",
        it_risk="Incomplete or inaccurate transfer of data between systems.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="DAILY",
        operator="{ops-role}",
        reviewer="None",
        owner="{ops-owner}",
        authority="The operator must be able to reprocess an interface and judge whether a "
        "rerun recovered the records.",
        judgment="MODERATE",
        judgment_note="Whether a reprocessing recovered every record is a judgment.",
        precision="Every run of {interfaces} on the day, with its record counts.",
        investigation="Each failure or mismatch is investigated and the records reprocessed or "
        "corrected; the operator confirms the counts agree after the fix.",
        information=(
            Information(
                "Interface run log",
                "SYSTEM_REPORT",
                ("Interface", "Run time", "Status", "Records sent", "Records received", "Errors"),
            ),
        ),  # fmt: skip
        itgcs=("ITGC-AC-04",),
        evidence="The day's run log with counts, and the record of each failure's investigation "
        "and reprocessing.",
        slots=(
            _system(),
            Slot(
                "interface-tool",
                "the integration tool",
                "SYSTEM",
                "Where interface runs are logged.",
                "SAP PI/PO",
                blocks=False,
            ),
            Slot(
                "interfaces",
                "the financially relevant interfaces",
                "TEXT",
                "The population: which interfaces the daily review covers.",
                "the billing-to-GL and payroll-to-GL interfaces",
            ),
            _role(
                "ops-role",
                "the team that monitors interfaces",
                "The operator.",
                "Integration support",
            ),
            OPS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "operations-soc-reports",
    Statement(
        text="Each year, for each of {service-orgs}, {soc-reviewer} obtains the service "
        "organization's SOC 1 Type 2 report, confirms it covers {system}'s services and the "
        "period (with a bridge letter for any gap to period end), reads the opinion and the "
        "exceptions, maps each complementary user entity control to a control the company "
        "performs, and records the conclusion.",
        risk="The company relies on controls a service organization operates without knowing "
        "whether they operated, or without performing the controls the service organization "
        "expects of it.",
        it_risk="Unauthorized access, changes, or processing failures at a service organization "
        "that go unassessed.",
        assertions=(),
        control_type="DETECTIVE",
        nature="MANUAL",
        frequency="ANNUAL",
        operator="{soc-reviewer}",
        reviewer="None: the review is the control",
        owner="{ops-owner}",
        authority="The reviewer must be able to read a SOC 1 report and know which company "
        "controls meet each complementary user entity control.",
        judgment="HIGH",
        judgment_note="Judging an exception's effect and a complementary control's coverage.",
        precision="Every service organization in {service-orgs}, for the whole period.",
        investigation="An exception affecting the company's reliance, a gap in coverage, or an "
        "unmet complementary control is escalated to {ops-owner} and compensating testing is "
        "decided.",
        information=(
            Information(
                "SOC 1 Type 2 report",
                "DOCUMENT",
                (
                    "Period",
                    "Services and systems in scope",
                    "Opinion",
                    "Exceptions",
                    "Complementary user entity controls",
                ),
            ),
            Information(
                "Bridge letter", "DOCUMENT", ("Period covered", "Changes since the report")
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="The report and bridge letter, the reviewer's memo with the exceptions assessed "
        "and each complementary control mapped, and the sign-off.",
        slots=(
            _system(),
            Slot(
                "service-orgs",
                "the service organizations relied on",
                "TEXT",
                "The population: which service organizations' reports are reviewed.",
                "the hosting provider and the payroll bureau",
            ),
            _role(
                "soc-reviewer",
                "the role that reviews service organization reports",
                "The operator.",
                "IT Compliance Manager",
            ),
            OPS_OWNER,
        ),  # fmt: skip
    ),
)

_add(
    "operations-vulnerabilities",
    Statement(
        text="Each month, {scan-tool} scans {system}'s servers and database, and {vuln-owner} "
        "reviews the findings: each critical or high vulnerability is remediated within "
        "{vuln-sla} or carries a risk acceptance approved by {risk-acceptor}, and the status "
        "is recorded.",
        risk="A known weakness on a financial system is left open and used to gain unauthorized "
        "access or change data.",
        it_risk="Unauthorized access to data and programs through unremediated vulnerabilities.",
        assertions=(),
        control_type="DETECTIVE",
        nature="IT_DEPENDENT_MANUAL",
        frequency="MONTHLY",
        operator="{vuln-owner}",
        reviewer="None: the review is the control",
        owner="{ops-owner}",
        authority="The operator must be able to assign and track remediation; the risk "
        "acceptor must be senior to the system's administrators.",
        judgment="MODERATE",
        judgment_note="Whether a risk acceptance is justified is a judgment.",
        precision="Every critical or high finding on {system}'s servers and database in each "
        "month's scan.",
        investigation="A finding past {vuln-sla} without a risk acceptance is escalated to "
        "{ops-owner}.",
        information=(
            Information(
                "Vulnerability scan results",
                "SYSTEM_REPORT",
                ("Host", "Finding", "Severity", "First seen", "Status", "Remediated on"),
            ),
            Information(
                "Scan scope configuration",
                "SYSTEM_SCREEN",
                ("Hosts in scope", "Schedule"),
            ),
        ),  # fmt: skip
        itgcs=(),
        evidence="Each month's scan results with the scope, the remediation or risk acceptance "
        "for each critical or high finding, and the review sign-off.",
        slots=(
            _system(),
            Slot(
                "scan-tool",
                "the vulnerability scanner",
                "SYSTEM",
                "Where findings come from.",
                "Qualys",
                blocks=False,
            ),
            _role(
                "vuln-owner",
                "the role that reviews scan findings",
                "The operator.",
                "Security Engineering Lead",
            ),
            Slot(
                "vuln-sla",
                "the time allowed to remediate a critical or high finding",
                "DAYS",
                "When a finding counts as overdue.",
                "30 days for critical, 90 days for high",
                placeholder="the remediation time the vulnerability policy allows",
            ),
            _role(
                "risk-acceptor",
                "the role that approves risk acceptances",
                "Approves leaving a finding open.",
                "Chief Information Security Officer",
            ),
            OPS_OWNER,
        ),  # fmt: skip
    ),
)

# Application controls


def _automated(
    key: str,
    text: str,
    risk: str,
    assertions: tuple[str, ...],
    precision: str,
    investigation: str,
    information: tuple[Information, ...],
    evidence: str,
    slots: tuple[Slot, ...],
    owner_slot: Slot,
    authority: str = "Only administrators authorized under user access controls can change "
    "the configuration.",
) -> None:
    _add(
        key,
        Statement(
            text=text,
            risk=risk,
            assertions=assertions,  # type: ignore[arg-type]
            control_type="PREVENTIVE",
            nature="AUTOMATED",
            frequency="RECURRING",
            operator="The system",
            reviewer="None: the configuration is the control",
            owner="{" + owner_slot.key + "}",
            authority=authority,
            judgment="LOW",
            judgment_note="The system applies the configuration without judgment.",
            precision=precision,
            investigation=investigation,
            information=information,
            itgcs=AUTOMATED_ITGCS,
            evidence=evidence,
            slots=(_system(), *slots, owner_slot),
        ),
    )


AP_OWNER = _role(
    "ap-owner",
    "the control owner for accounts payable",
    "Accountable for the control's design and operation.",
    "AP Manager",
)
GL_OWNER = _role(
    "gl-owner",
    "the control owner for the general ledger",
    "Accountable for the control's design and operation.",
    "Corporate Controller",
)
REVENUE_OWNER = _role(
    "revenue-owner",
    "the control owner for revenue",
    "Accountable for the control's design and operation.",
    "Revenue Controller",
)
FA_OWNER = _role(
    "fa-owner",
    "the control owner for fixed assets",
    "Accountable for the control's design and operation.",
    "Fixed Asset Accountant",
)
PAYROLL_OWNER = _role(
    "payroll-owner",
    "the control owner for payroll",
    "Accountable for the control's design and operation.",
    "Payroll Manager",
)

_automated(
    "itac-duplicate-invoice",
    "{system} rejects, or blocks for review by {dup-reviewer}, a vendor invoice whose vendor "
    "and invoice number match an invoice already recorded, under {dup-criteria}.",
    "The same vendor invoice is recorded and paid twice.",
    ("EXISTENCE_OCCURRENCE",),
    "Every vendor invoice entered, matched on {dup-criteria}.",
    "A blocked invoice is compared with the earlier one by {dup-reviewer} and released only "
    "when it is a different invoice.",
    (
        Information(
            "Duplicate check configuration",
            "SYSTEM_SCREEN",
            ("Check active", "Fields matched", "Action on match"),
        ),
    ),
    "The configuration shown from the system, its change history, and one rejected or "
    "blocked duplicate showing the control operated.",
    (
        Slot(
            "dup-criteria",
            "the fields the duplicate check matches on",
            "TEXT",
            "The control's precision.",
            "vendor, invoice number, and invoice date",
            blocks=False,
        ),
        _role(
            "dup-reviewer",
            "the role that reviews blocked duplicates",
            "Releases or rejects.",
            "AP supervisor",
        ),
    ),
    AP_OWNER,
)

_automated(
    "itac-po-workflow",
    "{system} routes each purchase order for approval under {doa-matrix} by amount and cost "
    "center, and does not release the order to the vendor until every required approval is "
    "recorded.",
    "Goods or services are ordered without the authority the delegation requires.",
    ("EXISTENCE_OCCURRENCE", "RIGHTS_OBLIGATIONS"),
    "Every purchase order, routed under {doa-matrix}.",
    "An order found released without the required approval is investigated with purchasing "
    "and the workflow configuration corrected.",
    (
        Information(
            "Approval workflow configuration",
            "SYSTEM_SCREEN",
            ("Release strategy", "Amount bands", "Approver roles"),
        ),
    ),
    "The workflow configuration shown from the system, its change history, and one order "
    "showing the approvals the system required.",
    (
        Slot(
            "doa-matrix",
            "the delegation of authority for purchase orders",
            "TEXT",
            "The criterion the routing is judged against.",
            "DOA v3: up to 10,000 manager; up to 100,000 director; above, CFO",
        ),
    ),
    _role(
        "ptp-owner",
        "the control owner for procure to pay",
        "Accountable for the control's design and operation.",
        "Head of Procure to Pay",
    ),
)

_automated(
    "itac-nonpo-routing",
    "{system} routes each vendor invoice without a purchase order to the approver that "
    "{nonpo-matrix} names for its cost center and amount, and does not post the invoice until "
    "that approval is recorded.",
    "An invoice with no purchase order is recorded and paid without anyone with authority "
    "agreeing it is owed.",
    ("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION"),
    "Every non-purchase-order invoice, routed under {nonpo-matrix}.",
    "An invoice found posted without the required approval is investigated and the routing "
    "configuration corrected.",
    (
        Information(
            "Invoice routing configuration",
            "SYSTEM_SCREEN",
            ("Routing rules", "Cost center owners", "Amount bands"),
        ),
    ),
    "The routing configuration shown from the system, its change history, and one invoice "
    "showing the approval the system required.",
    (
        Slot(
            "nonpo-matrix",
            "the approval matrix for invoices without a purchase order",
            "TEXT",
            "The criterion the routing is judged against.",
            "cost center owner up to 25,000; department head above",
        ),
    ),
    AP_OWNER,
)

_automated(
    "itac-period-lock",
    "{system} closes each accounting period after the close, rejects postings dated in a "
    "closed period, and lets only {reopen-role} reopen a period, each reopening being logged.",
    "A transaction is posted into a closed period after the results were reported, changing "
    "them without review.",
    ("COMPLETENESS", "EXISTENCE_OCCURRENCE"),
    "Every posting to {system}, against the period status at the posting date.",
    "A reopened period is reviewed by {gl-owner} for the postings made while open and closed "
    "again.",
    (
        Information(
            "Posting period configuration",
            "SYSTEM_SCREEN",
            ("Period", "Status", "Roles allowed to post"),
        ),
        Information(
            "Period change log", "SYSTEM_REPORT", ("Period", "Opened or closed by", "Date")
        ),
    ),
    "The period status shown from the system, the change log of period openings, and one "
    "rejected posting to a closed period.",
    (
        _role(
            "reopen-role",
            "the role allowed to reopen a period",
            "Reopening must be restricted.",
            "GL Manager",
        ),
    ),
    GL_OWNER,
    authority="Only {reopen-role} can reopen a period; the role is restricted under user "
    "access controls.",
)

_automated(
    "itac-je-workflow",
    "{system} routes each manual journal entry above {je-approval-threshold} to an approver "
    "other than the preparer, and does not post the entry until the approval is recorded.",
    "A manual journal entry is posted without independent approval and misstates the ledger.",
    ("EXISTENCE_OCCURRENCE", "VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
    "Every manual journal entry above {je-approval-threshold}; the preparer cannot approve.",
    "An entry found posted above the threshold without approval is reviewed by {gl-owner} and "
    "the workflow configuration corrected.",
    (
        Information(
            "Journal workflow configuration",
            "SYSTEM_SCREEN",
            ("Threshold", "Approver roles", "Preparer-approver separation"),
        ),
    ),
    "The workflow configuration shown from the system, its change history, and one entry "
    "showing the approval the system required.",
    (
        Slot(
            "je-approval-threshold",
            "the journal entry approval threshold",
            "AMOUNT",
            "The control's precision.",
            "10,000",
        ),
    ),
    GL_OWNER,
)

_automated(
    "itac-price-master",
    "{system} prices each sales order line from the active price master; a price override "
    "or discount beyond {discount-limit} cannot be saved without approval by "
    "{pricing-approver} in the system.",
    "Goods are sold below the approved price, or at a price someone typed, without authority.",
    ("VALUATION_ALLOCATION", "EXISTENCE_OCCURRENCE"),
    "Every sales order line, priced from the master; overrides beyond {discount-limit} "
    "need approval.",
    "An order found with an unapproved override is investigated with sales and the "
    "configuration corrected.",
    (
        Information(
            "Pricing configuration",
            "SYSTEM_SCREEN",
            ("Price source", "Override permission", "Discount limit", "Approver role"),
        ),
    ),
    "The pricing configuration shown from the system, its change history, and one order "
    "showing an override held for approval.",
    (
        Slot(
            "discount-limit",
            "the discount or override limit without approval",
            "PERCENT",
            "The control's precision.",
            "5%",
        ),
        _role(
            "pricing-approver",
            "the role that approves price overrides",
            "Approves in the system.",
            "Sales Director",
        ),
    ),
    REVENUE_OWNER,
)

_automated(
    "itac-ship-to-bill",
    "{system} creates the customer invoice from each goods issue or service confirmation "
    "through {billing-run}; a shipment cannot be invoiced twice, and a shipment not yet "
    "invoiced appears on the billing due list until it is.",
    "Goods shipped are never invoiced, or are invoiced twice, so revenue and receivables are "
    "misstated.",
    ("COMPLETENESS", "EXISTENCE_OCCURRENCE"),
    "Every goods issue and service confirmation in {system}.",
    "An item left on the billing due list past the run is investigated by {revenue-owner}; a "
    "duplicate invoice is reversed.",
    (
        Information(
            "Billing configuration",
            "SYSTEM_SCREEN",
            ("Billing relevance", "Billing run schedule", "Duplicate check"),
        ),
        Information(
            "Billing due list", "SYSTEM_REPORT", ("Shipment", "Shipped on", "Invoice", "Status")
        ),
    ),
    "The billing configuration shown from the system, its change history, the billing due "
    "list after a run, and one shipment traced to its single invoice.",
    (
        Slot(
            "billing-run",
            "the billing run",
            "TEXT",
            "How invoices are created.",
            "the nightly billing job VF04",
            blocks=False,
        ),
    ),
    REVENUE_OWNER,
)

_automated(
    "itac-depreciation-calc",
    "{system} calculates depreciation for each asset from the method and useful life of its "
    "asset class under {depreciation-keys}, and posts it each period through the depreciation "
    "run.",
    "Depreciation is calculated with the wrong method or life, or not posted, misstating "
    "expense and net book value.",
    ("VALUATION_ALLOCATION", "COMPLETENESS"),
    "Every asset with a capitalization date, each period.",
    "An asset whose depreciation differs from a recalculation is investigated by {fa-owner} "
    "and the asset's class or configuration corrected.",
    (
        Information(
            "Depreciation configuration",
            "SYSTEM_SCREEN",
            ("Asset class", "Depreciation key", "Method", "Useful life"),
        ),
        Information(
            "Depreciation run log", "SYSTEM_REPORT", ("Period", "Assets processed", "Errors")
        ),
    ),
    "The configuration shown from the system, its change history, the depreciation run log, "
    "and one asset's depreciation recalculated.",
    (
        Slot(
            "depreciation-keys",
            "the asset classes and depreciation keys in scope",
            "TEXT",
            "The population and the criterion.",
            "classes 1000-4000, straight line over the class life",
            blocks=False,
        ),
    ),
    FA_OWNER,
)

_automated(
    "itac-payroll-calc",
    "{system} calculates each employee's gross pay, deductions, and net pay from the "
    "configured pay rules and statutory tables under {pay-rules}, from the master data and "
    "time recorded, and produces the payroll register.",
    "Employees are paid or taxed at the wrong amounts because the calculation is wrong.",
    ("VALUATION_ALLOCATION", "EXISTENCE_OCCURRENCE"),
    "Every employee in each payroll run.",
    "An employee whose pay differs from a recalculation is investigated by {payroll-owner} "
    "and the rule or master data corrected before payment.",
    (
        Information(
            "Pay rule and tax table configuration",
            "SYSTEM_SCREEN",
            ("Rule", "Rate or formula", "Effective date"),
        ),
        Information("Payroll run log", "SYSTEM_REPORT", ("Run", "Employees processed", "Errors")),
    ),
    "The configuration shown from the system, its change history (including statutory table "
    "updates), the run log, and one employee's pay recalculated.",
    (
        Slot(
            "pay-rules",
            "the pay rules and statutory tables in scope",
            "TEXT",
            "The criterion the calculation is judged against.",
            "the US federal and state tax tables and the company's overtime rule",
            blocks=False,
        ),
    ),
    PAYROLL_OWNER,
)

_automated(
    "itac-posting-validation",
    "{system} rejects a journal line that lacks a required field, uses an account or cost "
    "object that is blocked or invalid for the company code, or leaves the document "
    "unbalanced, under {validation-rules}.",
    "A posting lands in the wrong account or company code, or an unbalanced document "
    "corrupts the ledger.",
    ("VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
    "Every journal line posted to {system}, under {validation-rules}.",
    "A posting found to breach a rule is investigated by {gl-owner} and the validation "
    "configuration corrected.",
    (
        Information(
            "Validation configuration",
            "SYSTEM_SCREEN",
            ("Rule", "Fields required", "Account and cost object checks", "Balance check"),
        ),
    ),
    "The validation configuration shown from the system, its change history, and one "
    "rejected posting showing the control operated.",
    (
        Slot(
            "validation-rules",
            "the posting validation rules in scope",
            "TEXT",
            "The criterion the test is judged against.",
            "required-field, account-cost center, and document balance validations",
        ),
    ),
    GL_OWNER,
)

_automated(
    "itac-interface-totals",
    "The interface from {source-system} to {system} compares record counts and control totals "
    "between what was sent and what was received on each run, posts only a batch whose "
    "totals agree, and places a batch with a mismatch in the error queue for "
    "{interface-owner}.",
    "Transactions are lost or duplicated between {source-system} and {system} and the ledger "
    "is incomplete or inaccurate.",
    ("COMPLETENESS", "EXISTENCE_OCCURRENCE"),
    "Every run of the interface from {source-system} to {system}.",
    "A batch in the error queue is investigated by {interface-owner}, corrected, and "
    "reprocessed; nothing in the queue is posted by hand without the counts agreeing.",
    (
        Information(
            "Interface control configuration",
            "SYSTEM_SCREEN",
            ("Count check", "Total check", "Action on mismatch"),
        ),
        Information(
            "Interface run log",
            "SYSTEM_REPORT",
            ("Run", "Records sent", "Records received", "Totals", "Status"),
        ),
    ),
    "The interface configuration shown from the tool, its change history, the run log, and "
    "one mismatched batch held in the error queue.",
    (
        Slot(
            "source-system",
            "the source system of the interface",
            "SYSTEM",
            "Where the batch comes from.",
            "Salesforce",
            blocks=False,
        ),
        _role(
            "interface-owner",
            "the role that resolves interface errors",
            "Works the error queue.",
            "Integration support",
        ),
    ),
    GL_OWNER,
)

# Key reports


def _report(
    key: str,
    text: str,
    risk: str,
    assertions: tuple[str, ...],
    frequency: str,
    precision: str,
    investigation: str,
    information: tuple[Information, ...],
    evidence: str,
    slots: tuple[Slot, ...],
    operator_slot: Slot,
    owner_slot: Slot,
    nature: str = "IT_DEPENDENT_MANUAL",
    judgment: str = "LOW",
    judgment_note: str = "Agreeing totals and parameters is mechanical.",
) -> None:
    _add(
        key,
        Statement(
            text=text,
            risk=risk,
            assertions=assertions,  # type: ignore[arg-type]
            control_type="DETECTIVE",
            nature=nature,  # type: ignore[arg-type]
            frequency=frequency,  # type: ignore[arg-type]
            operator="{" + operator_slot.key + "}",
            reviewer="None: the check is the control",
            owner="{" + owner_slot.key + "}",
            authority="The operator must be able to run the report and read the ledger.",
            judgment=judgment,  # type: ignore[arg-type]
            judgment_note=judgment_note,
            precision=precision,
            investigation=investigation,
            information=information,
            itgcs=AUTOMATED_ITGCS,
            evidence=evidence,
            slots=(_system(), operator_slot, *slots, owner_slot),
        ),
    )


_report(
    "ipe-inventory-valuation",
    "Before the inventory valuation report from {system} is used for the period's inventory "
    "balance and reserves, {inv-preparer} records its parameters, agrees its total to the "
    "inventory accounts in the general ledger, and recalculates the extended cost of selected "
    "items from quantity and unit cost.",
    "Inventory is valued from a report that is incomplete or wrong, misstating inventory and "
    "cost of sales.",
    ("COMPLETENESS", "VALUATION_ALLOCATION"),
    "QUARTERLY",
    "The report as run for each period used, agreed to the ledger to the cent and recalculated "
    "for {inv-sample} items.",
    "A difference to the ledger is reconciled before the report is used; a recalculation "
    "difference is traced to the item's cost or quantity and corrected.",
    (
        Information(
            "Inventory valuation report",
            "SYSTEM_REPORT",
            ("Item", "Quantity", "Unit cost", "Extended cost", "Parameters", "Run date"),
        ),
    ),
    "The report with its parameters, the agreement to the ledger, and the recalculation of "
    "the selected items.",
    (
        Slot(
            "inv-sample",
            "the number of items recalculated each period",
            "TEXT",
            "The check's extent.",
            "25 items",
            blocks=False,
        ),
    ),
    _role(
        "inv-preparer",
        "the role that validates the valuation report",
        "The operator.",
        "Cost Accountant",
    ),
    _role(
        "inv-owner",
        "the control owner for inventory accounting",
        "Accountable for the control's design and operation.",
        "Inventory Controller",
    ),
)

_report(
    "ipe-fixed-asset-register",
    "Before the fixed asset register from {system} is used for the period's close and "
    "disclosures, {fa-preparer} records its parameters and agrees its cost, accumulated "
    "depreciation, and net book value totals to the general ledger for {fa-classes}.",
    "Fixed asset balances and depreciation are reported from a register that does not agree "
    "to the ledger.",
    ("COMPLETENESS", "VALUATION_ALLOCATION", "PRESENTATION_DISCLOSURE"),
    "QUARTERLY",
    "The register as run for each period used, agreed to the ledger by asset class.",
    "A difference by class is reconciled to its postings before the register is used.",
    (
        Information(
            "Fixed asset register",
            "SYSTEM_REPORT",
            (
                "Asset",
                "Class",
                "Cost",
                "Accumulated depreciation",
                "Net book value",
                "Parameters",
                "Run date",
            ),
        ),
    ),
    "The register with its parameters and the agreement to the ledger by class.",
    (
        Slot(
            "fa-classes",
            "the asset classes agreed each period",
            "TEXT",
            "The check's extent.",
            "every asset class",
            blocks=False,
        ),
    ),
    _role(
        "fa-preparer",
        "the role that validates the asset register",
        "The operator.",
        "Fixed Asset Accountant",
    ),
    _role(
        "fa-owner",
        "the control owner for fixed assets",
        "Accountable for the control's design and operation.",
        "Fixed Asset Manager",
    ),
)

_report(
    "ipe-payroll-register",
    "Before each payroll is approved for payment, {pay-preparer} records the parameters of "
    "the payroll register from {system}, agrees its gross pay, deductions, and net pay totals "
    "to the payroll journal posted to the general ledger and to the payment file total, and "
    "agrees {pay-sample} to their pay slips and payment file lines.",
    "Payroll is paid and recorded from a register that does not agree to what is posted or paid.",
    ("COMPLETENESS", "VALUATION_ALLOCATION"),
    "MONTHLY",
    "Every payroll register in the period, agreed to the journal and the payment file.",
    "A difference is reconciled to its employees before the payroll is approved.",
    (
        Information(
            "Payroll register",
            "SYSTEM_REPORT",
            ("Employee", "Gross", "Deductions", "Net", "Parameters", "Run date"),
        ),
        Information("Payment file total", "SYSTEM_REPORT", ("Payees", "Total")),
    ),
    "The register with its parameters, the payroll journal, the payment file total, and the "
    "agreement.",
    (
        Slot(
            "pay-sample",
            "the employees agreed each payroll",
            "TEXT",
            "The check's extent.",
            "five employees",
            blocks=False,
        ),
    ),
    _role(
        "pay-preparer",
        "the role that validates the payroll register",
        "The operator.",
        "Payroll Specialist",
    ),
    PAYROLL_OWNER,
)

_report(
    "ipe-billing-report",
    "Before the billing report from {system} is used for the revenue close and the cut-off "
    "review, {rev-preparer} records its parameters, agrees its invoiced total to revenue in "
    "the general ledger, and traces selected invoices from the report to the invoice "
    "documents.",
    "Revenue is closed and reviewed from a billing report that is incomplete or wrong.",
    ("COMPLETENESS", "EXISTENCE_OCCURRENCE"),
    "MONTHLY",
    "The report as run for each period used, agreed to the ledger and traced for "
    "{bill-sample} invoices.",
    "A difference to the ledger is reconciled before the report is used; an invoice that does "
    "not agree to its document is investigated.",
    (
        Information(
            "Billing report",
            "SYSTEM_REPORT",
            ("Invoice", "Customer", "Date", "Amount", "Parameters", "Run date"),
        ),
    ),
    "The report with its parameters, the agreement to the ledger, and the invoices traced.",
    (
        Slot(
            "bill-sample",
            "the number of invoices traced each period",
            "TEXT",
            "The check's extent.",
            "10 invoices",
            blocks=False,
        ),
    ),
    _role(
        "rev-preparer",
        "the role that validates the billing report",
        "The operator.",
        "Revenue Accountant",
    ),
    REVENUE_OWNER,
)

_report(
    "ipe-ap-aging",
    "Before the accounts payable aging from {system} is used for the accrual review and "
    "disclosures, {ap-preparer} records its parameters, agrees its total to the payables "
    "accounts in the general ledger, and recalculates the aging bucket of selected invoices "
    "from their dates.",
    "Payables and the unrecorded-liability review rest on an aging that is incomplete or misaged.",
    ("COMPLETENESS", "VALUATION_ALLOCATION"),
    "QUARTERLY",
    "The aging as run for each period used, agreed to the ledger and recalculated for "
    "{ap-sample} invoices.",
    "A difference to the ledger is reconciled before the aging is used; a misaged invoice is "
    "traced to its date and the report's logic checked.",
    (
        Information(
            "Accounts payable aging",
            "SYSTEM_REPORT",
            ("Vendor", "Invoice", "Date", "Bucket", "Amount", "Parameters", "Run date"),
        ),
    ),
    "The aging with its parameters, the agreement to the ledger, and the invoices recalculated.",
    (
        Slot(
            "ap-sample",
            "the number of invoices recalculated each period",
            "TEXT",
            "The check's extent.",
            "10 invoices",
            blocks=False,
        ),
    ),
    _role(
        "ap-preparer",
        "the role that validates the payables aging",
        "The operator.",
        "AP Accountant",
    ),
    AP_OWNER,
)

_report(
    "ipe-euc-spreadsheets",
    "Each spreadsheet on {euc-inventory} that feeds a key control over {system}'s data is "
    "kept in {euc-location} with access restricted to its owner and change history on; before "
    "each use, {euc-owner} agrees its inputs to their source reports, checks its formulas "
    "against the documented logic, and signs the version used.",
    "A key control relies on a spreadsheet whose inputs or formulas are wrong or were changed "
    "without anyone knowing.",
    ("COMPLETENESS", "VALUATION_ALLOCATION"),
    "QUARTERLY",
    "Every spreadsheet on {euc-inventory}, each time it is used for a key control.",
    "An input that does not agree to its source, or a formula that differs from the "
    "documented logic, is corrected before the spreadsheet's output is used, and the cause "
    "recorded.",
    (
        Information(
            "Spreadsheet inventory",
            "SPREADSHEET",
            ("Spreadsheet", "Owner", "Control it feeds", "Location", "Logic documentation"),
        ),
        Information(
            "Version and access history",
            "SYSTEM_REPORT",
            ("Version", "Changed by", "Date", "Who has access"),
        ),
    ),
    "The inventory, each spreadsheet's access and version history, and the signed version "
    "with the input agreement and formula check for each use.",
    (
        Slot(
            "euc-inventory",
            "the inventory of key spreadsheets",
            "TEXT",
            "The population.",
            "the SOX EUC register",
            blocks=False,
        ),
        Slot(
            "euc-location",
            "where key spreadsheets are kept",
            "SYSTEM",
            "Where access and versions are controlled.",
            "SharePoint finance library",
            blocks=False,
        ),
    ),
    _role(
        "euc-owner",
        "the owner of each key spreadsheet",
        "The operator.",
        "The preparer of the control the spreadsheet feeds",
    ),
    GL_OWNER,
    nature="MANUAL",
    judgment="MODERATE",
    judgment_note="Checking a formula against its documented logic takes judgment.",
)
