"""The Northstar records: one deterministic population per subject, and the engagement's
profile, people, systems and controls, all from one seed.

Each population is a list of dicts in a fixed column order, rendered as-is into the
evidence files (files.py). The scenarios the demo is built to show (a late termination,
an account still open, privileged access without a request, a transport without a CAB
approval and one approved after import, a stale configuration export, a failed load
without a ticket, a report short of the ledger, a review without an investigation) are
single, named records here, so the files, the controls' criteria and the tests all read
the same facts.
"""

# ruff: noqa: E501  (declarative data tables)
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

SEED = 20270101
DATASET_KEY = "northstar/1"
CLIENT_NAME = "Northstar Technologies, Inc."
ENGAGEMENT_NAME = "FY2027 IT SOX Audit"
ENGAGEMENT_SLUG = "northstar-fy2027-it-sox"
PERIOD_START = date(2027, 1, 1)
PERIOD_END = date(2027, 12, 31)
INTERIM_END = date(2027, 9, 30)
AS_OF = INTERIM_END

BUSINESS_DESCRIPTION = (
    "Northstar Technologies, Inc. is a Denver-based technology and professional services "
    "company with about 2,400 employees. Northstar Cloud Platform sells subscription "
    "software to mid-market finance teams; Northstar Advisory delivers implementation and "
    "managed services. Revenue is recognized in SAP S/4HANA from Zuora billing feeds; "
    "management reporting runs on Snowflake and Power BI. Identity is managed in Microsoft "
    "Entra ID with single sign-on to SAP and Snowflake; terminations flow from Workday to "
    "Entra ID; access and change requests are raised in ServiceNow."
)

ENTITIES: tuple[tuple[str, str, str], ...] = (
    # company code, name, country
    ("1000", "Northstar Technologies, Inc.", "US"),
    ("2000", "Northstar Cloud Services LLC", "US"),
    ("3000", "Northstar Advisory Group LLC", "US"),
    ("4000", "Northstar Technologies Europe B.V.", "NL"),
)

DEPARTMENTS: tuple[str, ...] = (
    "Finance", "Accounting", "Information Technology", "Sales", "Customer Success",
    "Engineering", "Human Resources", "Legal", "Procurement", "Advisory Services",
    "Marketing", "Revenue Operations",
)  # fmt: skip

FIRST_NAMES: tuple[str, ...] = (
    "Amara",
    "Ben",
    "Carla",
    "Dev",
    "Elif",
    "Farid",
    "Gwen",
    "Hiro",
    "Ines",
    "Jonas",
    "Keisha",
    "Luca",
    "Maya",
    "Nikhil",
    "Olivia",
    "Pavel",
    "Quinn",
    "Rosa",
    "Sven",
    "Tara",
    "Umar",
    "Vera",
    "Wes",
    "Ximena",
    "Yusuf",
    "Zoe",
    "Anders",
    "Bianca",
    "Caleb",
    "Dara",
    "Emeka",
    "Freya",
    "Gabriel",
    "Hana",
    "Idris",
    "Jade",
    "Kofi",
    "Leila",
    "Mateo",
    "Noor",
    "Oscar",
    "Petra",
    "Rafael",
    "Sana",
    "Tomas",
    "Uma",
    "Viktor",
    "Wren",
    "Yara",
    "Zach",
)
LAST_NAMES: tuple[str, ...] = (
    "Abbott",
    "Bauer",
    "Castillo",
    "Dunn",
    "Eriksen",
    "Fontaine",
    "Garza",
    "Holm",
    "Iqbal",
    "Jensen",
    "Kaur",
    "Lindgren",
    "Moreau",
    "Nakamura",
    "Olsen",
    "Pereira",
    "Quist",
    "Reyes",
    "Sato",
    "Thorne",
    "Ueda",
    "Varga",
    "Walsh",
    "Xu",
    "Yilmaz",
    "Zimmer",
    "Adeyemi",
    "Bergström",
    "Costa",
    "Dimitrov",
    "Esposito",
    "Fischer",
    "Guerrero",
    "Hughes",
    "Ivanova",
    "Jovanović",
    "Kimura",
    "Laurent",
    "Mensah",
    "Novak",
    "Okafor",
    "Park",
    "Rossi",
    "Schmidt",
    "Tanaka",
    "Umeh",
    "Visser",
    "Weber",
    "Yamada",
    "Zhao",
)


@dataclass(frozen=True)
class Person:
    """A synthetic person at Northstar or on the audit team."""

    key: str
    name: str
    title: str
    email: str
    side: str  # CLIENT or AUDIT


OWNERS: tuple[Person, ...] = (
    Person("priya", "Priya Raman", "Director, SAP Basis & Security", "priya.raman@northstar.example", "CLIENT"),
    Person("marcus", "Marcus Delgado", "Change & Release Manager", "marcus.delgado@northstar.example", "CLIENT"),
    Person("elena", "Elena Vasquez", "Identity & Access Manager", "elena.vasquez@northstar.example", "CLIENT"),
    Person("tom", "Tom Okonkwo", "Data Platform Lead", "tom.okonkwo@northstar.example", "CLIENT"),
    Person("grace", "Grace Lindqvist", "Corporate Controller", "grace.lindqvist@northstar.example", "CLIENT"),
    Person("jordan", "Jordan Patel", "IT Operations Manager", "jordan.patel@northstar.example", "CLIENT"),
    Person("hannah", "Hannah Weiss", "HR Operations Manager", "hannah.weiss@northstar.example", "CLIENT"),
    Person("samuel", "Samuel Osei", "Financial Systems Analyst", "samuel.osei@northstar.example", "CLIENT"),
)  # fmt: skip
AUDIT_TEAM: tuple[Person, ...] = (
    Person("dana", "Dana Whitfield", "Engagement lead", "dana.whitfield@firm.example", "AUDIT"),
    Person("riley", "Riley Okafor", "Independent reviewer", "riley.okafor@firm.example", "AUDIT"),
    Person("morgan", "Morgan Lee", "Senior, testing", "morgan.lee@firm.example", "AUDIT"),
)  # fmt: skip
PEOPLE: dict[str, Person] = {p.key: p for p in OWNERS + AUDIT_TEAM}

# Process areas a control belongs to.
PROCESSES: tuple[tuple[str, str], ...] = (
    ("ACCESS", "Access management"),
    ("CHANGE", "Change management"),
    ("OPERATIONS", "Computer operations"),
    ("P2P", "Procure to pay"),
    ("REVENUE", "Revenue reporting"),
    ("CLOSE", "Financial close"),
)


@dataclass(frozen=True)
class System:
    key: str
    name: str
    vendor: str
    kind: str
    owner: str
    description: str
    scope: tuple[str, ...]
    financial_relevance: str


SYSTEMS: tuple[System, ...] = (
    System(
        "sap",
        "SAP S/4HANA",
        "SAP SE",
        "ERP",
        "priya",
        "Primary ERP and system of record for the general ledger, accounts payable, "
        "accounts receivable, revenue and fixed assets, for all four company codes. Hosted "
        "on SAP RISE (private cloud); single sign-on from Microsoft Entra ID; transports "
        "managed with STMS and ServiceNow change tickets.",
        (
            "User access provisioning",
            "User access termination",
            "Privileged access",
            "Change management",
            "Automated financial controls",
        ),
        "All significant accounts; the general ledger and sub-ledgers.",
    ),  # fmt: skip
    System(
        "entra",
        "Microsoft Entra ID",
        "Microsoft",
        "Identity and access management",
        "elena",
        "Identity provider for the enterprise: single sign-on and multi-factor "
        "authentication for SAP and Snowflake, privileged roles through Privileged "
        "Identity Management, quarterly access certifications of the groups mapped to SAP "
        "roles. Joiner, mover and leaver events arrive from Workday.",
        (
            "User lifecycle management",
            "Privileged roles",
            "Authentication configuration",
            "Periodic access reviews",
        ),
        "Indirect: authentication and access to the financial systems.",
    ),  # fmt: skip
    System(
        "snowflake",
        "Snowflake",
        "Snowflake Inc.",
        "Enterprise data warehouse",
        "tom",
        "Enterprise data warehouse loaded nightly from SAP S/4HANA and Zuora; source of "
        "the monthly revenue-by-customer report and the management reporting used in the "
        "financial close. Pipelines are dbt models and Snowflake tasks, changed through "
        "peer-reviewed pull requests.",
        (
            "Data access management",
            "Privileged role assignments",
            "Scheduled data processing",
            "Report completeness and accuracy",
        ),
        "Information produced by the entity for revenue and the close.",
    ),  # fmt: skip
)
SYSTEM_BY_KEY: dict[str, System] = {s.key: s for s in SYSTEMS}


@dataclass(frozen=True)
class Control:
    ref: str
    name: str
    category: str  # ITGC_ACCESS, ITGC_CHANGE, ITGC_OPERATIONS, ITAC, IPE, MRC
    process: str
    systems: tuple[str, ...]
    frequency: str
    nature: str  # MANUAL, AUTOMATED, IT_DEPENDENT_MANUAL
    kind: str  # PREVENTIVE, DETECTIVE
    owner: str
    risk: str
    objective: str
    description: str
    procedures: tuple[str, ...]
    attributes: tuple[str, ...]
    evidence: tuple[str, ...]
    sampling: str
    # The evidence files (files.py keys) that belong to this control.
    files: tuple[str, ...] = field(default=())


CONTROLS: tuple[Control, ...] = (
    Control(
        "NS-AC-01",
        "New user access approved before provisioning",
        "ITGC_ACCESS",
        "ACCESS",
        ("sap",),
        "EACH_OCCURRENCE",
        "MANUAL",
        "PREVENTIVE",
        "priya",
        "Users are granted SAP access, or roles, that are not appropriate to their job, "
        "allowing unauthorized transactions or a loss of segregation of duties.",
        "Only access that has been requested and approved by the user's manager and the "
        "role owner is provisioned in SAP S/4HANA.",
        "A ServiceNow access request (REQ) is raised for each new SAP user or role change. "
        "The user's manager approves the business need and the role owner approves the "
        "roles. The SAP security team provisions the access only after both approvals are "
        "recorded on the request; the request records the approvals and the provisioning "
        "date.",
        (
            "Obtain the population of SAP access requests for the period and agree its "
            "completeness to the SAP user listing (accounts created in the period).",
            "Select a sample of 25 requests.",
            "For each, inspect the request for the manager's approval and the role owner's "
            "approval, with dates on or before the provisioning date, and agree the roles "
            "provisioned to the roles requested.",
        ),
        (
            "Manager approval recorded before provisioning",
            "Role owner approval recorded before provisioning",
            "Roles provisioned agree to roles requested",
        ),
        (
            "ServiceNow access request export for the period",
            "SAP user listing (USR02) as of the period end",
        ),
        "Recurring manual control, population of about 180 requests in the interim period: "
        "25 items, random, keyed on the request id.",
        ("access_requests", "sap_users"),
    ),  # fmt: skip
    Control(
        "NS-AC-02",
        "Terminated users removed within three business days",
        "ITGC_ACCESS",
        "ACCESS",
        ("sap", "entra"),
        "EACH_OCCURRENCE",
        "MANUAL",
        "DETECTIVE",
        "priya",
        "A terminated employee or contractor retains SAP access and can post or alter "
        "financial transactions after leaving.",
        "SAP access of terminated personnel is disabled within three business days of the "
        "termination date recorded in Workday.",
        "Workday sends a daily termination feed to Entra ID and to the SAP security "
        "mailbox. The SAP security analyst locks the user (lock status 64) and sets the "
        "validity end date within three business days of the termination date, and records "
        "the removal in the termination removal log. HR reconciles the log to the "
        "termination listing monthly.",
        (
            "Obtain the HR termination listing for the period and the SAP termination removal log.",
            "Select a sample of 25 terminated personnel with SAP accounts.",
            "For each, agree the termination date to the HR listing, agree the lock date to "
            "the SAP user listing (validity end and lock status), and recompute the business "
            "days between termination and lock.",
        ),
        (
            "SAP account locked and validity ended",
            "Lock date within three business days of the termination date",
            "Removal recorded in the termination removal log",
        ),
        (
            "Workday termination listing for the period",
            "SAP user listing (USR02) as of the period end",
            "SAP termination removal log",
        ),
        "Population of 58 terminations with SAP accounts in the interim period: 25 items, "
        "random, keyed on the employee id.",
        ("hr_terminations", "sap_users", "termination_removals"),
    ),  # fmt: skip
    Control(
        "NS-AC-03",
        "Privileged SAP access restricted and approved",
        "ITGC_ACCESS",
        "ACCESS",
        ("sap",),
        "QUARTERLY",
        "MANUAL",
        "PREVENTIVE",
        "priya",
        "Broad or privileged SAP authorizations (SAP_ALL, SAP_NEW, firefighter IDs) are "
        "held by users who could make unauthorized changes to programs, configuration or "
        "financial data without detection.",
        "Privileged SAP access is limited to approved system and firefighter accounts; "
        "firefighter use is requested, approved and its log reviewed.",
        "SAP_ALL and SAP_NEW are assigned only to the system accounts on the approved "
        "list. Emergency access uses firefighter IDs checked out through a firefighter "
        "request approved by the SAP security director; the session log is reviewed by the "
        "control owner within five business days. The security director reviews the "
        "privileged access report quarterly.",
        (
            "Obtain the privileged access report (SAP_ALL, SAP_NEW, firefighter IDs) as of the "
            "period end and the firefighter request log.",
            "For every privileged assignment, agree the holder to the approved list of system "
            "accounts or to an approved firefighter request covering the dates.",
            "For a sample of firefighter sessions, inspect the approval and the log review.",
        ),
        (
            "Holder is an approved system account or has an approved firefighter request",
            "Firefighter session log reviewed within five business days",
        ),
        (
            "SAP privileged access report as of the period end",
            "Firefighter request log for the period",
            "Approved list of privileged system accounts",
        ),
        "Whole population of privileged assignments (about 12); firefighter sessions: all "
        "in the period (about 40).",
        ("privileged_access", "firefighter_log"),
    ),  # fmt: skip
    Control(
        "NS-AC-04",
        "Quarterly user access certification",
        "ITGC_ACCESS",
        "ACCESS",
        ("entra", "sap"),
        "QUARTERLY",
        "MANUAL",
        "DETECTIVE",
        "elena",
        "Users accumulate SAP roles no longer needed for their job, including after a "
        "transfer, and inappropriate access goes unnoticed.",
        "Managers certify quarterly that the SAP role groups held by their reports remain "
        "appropriate, and access not certified is revoked.",
        "Each quarter an Entra ID access review campaign covers every group mapped to an "
        "SAP role. Managers approve or deny each assignment within the campaign window; "
        "denied assignments are removed automatically and the identity team confirms the "
        "removals. The campaign report records reviewers, decisions and revocations.",
        (
            "Obtain the access certification reports for each quarter in the period.",
            "Inspect each campaign for completion within the window, reviewer sign-off, and "
            "the count of denied assignments.",
            "For a sample of denied assignments, agree the revocation to the SAP user listing.",
        ),
        (
            "Campaign completed within the window",
            "Every assignment decided by the manager",
            "Denied assignments revoked",
        ),
        (
            "Entra ID access review campaign reports (Q1, Q2, Q3)",
            "SAP user listing (USR02) as of the period end",
        ),
        "Three quarterly campaigns in the interim period: all three; revocations: all (about 30).",
        ("access_certifications", "certification_revocations", "certification_report", "sap_users"),
    ),  # fmt: skip
    Control(
        "NS-AC-05",
        "Entra ID privileged roles approved and limited",
        "ITGC_ACCESS",
        "ACCESS",
        ("entra",),
        "EACH_OCCURRENCE",
        "MANUAL",
        "PREVENTIVE",
        "elena",
        "Unauthorized holders of Global Administrator or other privileged directory roles "
        "could change authentication settings, grant themselves access to financial "
        "systems or bypass controls.",
        "Privileged Entra ID roles are assigned only through PIM, with an approved request, "
        "as eligible assignments requiring MFA at activation.",
        "Privileged roles are managed in Privileged Identity Management. A role "
        "assignment requires a ServiceNow request approved by the identity and access "
        "manager; standing (active) assignments are limited to two break-glass accounts. "
        "Activation requires MFA and a justification.",
        (
            "Obtain the PIM role assignment export as of the period end and the approvals "
            "for assignments made in the period.",
            "For every assignment, agree the holder and role to an approved request and "
            "inspect the assignment type (eligible) and the MFA requirement.",
        ),
        (
            "Assignment supported by an approved request",
            "Assignment is eligible, or holder is an approved break-glass account",
            "MFA required at activation",
        ),
        ("Entra ID PIM role assignment export", "Privileged role approval records for the period"),
        "Whole population of privileged role assignments (about 14).",
        ("entra_pim", "entra_role_approvals"),
    ),  # fmt: skip
    Control(
        "NS-AC-06",
        "Multi-factor authentication enforced for all users",
        "ITGC_ACCESS",
        "ACCESS",
        ("entra",),
        "CONTINUOUS",
        "AUTOMATED",
        "PREVENTIVE",
        "elena",
        "A compromised password alone gives access to SAP and Snowflake.",
        "Conditional access requires multi-factor authentication for every interactive "
        "sign-in to the financial systems.",
        "The conditional access policy CA001 'Require MFA for all users' is enabled for "
        "all users and all cloud applications, with the two break-glass accounts excluded "
        "and monitored. Changes to conditional access policies follow the change "
        "management control.",
        (
            "Obtain the conditional access policy configuration as of a date in the period.",
            "Inspect the MFA policy for state, assignment to all users and applications, and "
            "exclusions, and agree any exclusion to the approved break-glass accounts.",
        ),
        (
            "MFA policy enabled for all users and applications during the period",
            "Exclusions limited to approved break-glass accounts",
        ),
        ("Conditional access policy export, dated within the period",),
        "Automated configuration: a test of one as of a date in the period.",
        ("conditional_access",),
    ),  # fmt: skip
    Control(
        "NS-AC-07",
        "Snowflake privileged roles restricted and approved",
        "ITGC_ACCESS",
        "ACCESS",
        ("snowflake",),
        "EACH_OCCURRENCE",
        "MANUAL",
        "PREVENTIVE",
        "tom",
        "Users with ACCOUNTADMIN, SECURITYADMIN or SYSADMIN could alter the revenue data or "
        "the pipelines that produce management reports.",
        "Snowflake privileged roles are granted only to approved platform engineers "
        "through an approved request.",
        "Grants of ACCOUNTADMIN, SECURITYADMIN and SYSADMIN require a ServiceNow request "
        "approved by the data platform lead. The platform team reviews SHOW GRANTS output "
        "monthly against the approved holders.",
        (
            "Obtain the grants export (SHOW GRANTS) as of the period end and the approvals "
            "for grants made in the period.",
            "For every privileged grant, agree the grantee to an approved request.",
        ),
        (
            "Privileged grant supported by an approved request",
            "Grantee is a named platform engineer, not a shared account",
        ),
        ("Snowflake grants export", "Privileged role approval records"),
        "Whole population of privileged grants (about 9).",
        ("snowflake_grants", "snowflake_role_approvals"),
    ),  # fmt: skip
    Control(
        "NS-CM-01",
        "SAP transports approved and tested before production import",
        "ITGC_CHANGE",
        "CHANGE",
        ("sap",),
        "EACH_OCCURRENCE",
        "MANUAL",
        "PREVENTIVE",
        "marcus",
        "Unauthorized or untested changes to SAP programs or configuration reach "
        "production and alter how transactions are processed or reported.",
        "Every transport imported to production is linked to a change ticket approved by "
        "the Change Advisory Board before import, with test evidence, and is imported by "
        "someone other than its developer.",
        "Changes are raised as ServiceNow change tickets. The CAB meets weekly and records "
        "its approval on the ticket; emergency changes are approved by the change manager "
        "and ratified at the next CAB. Basis imports a transport to production only when "
        "its ticket shows approval and test evidence; the STMS import log records who "
        "imported and when.",
        (
            "Obtain the STMS production import log for the period and the change ticket "
            "population; agree the import log to the tickets for completeness.",
            "Select a sample of 25 transports.",
            "For each, inspect the ticket for CAB (or emergency) approval dated on or before "
            "the import, test evidence, and agree that the importer differs from the "
            "transport owner.",
        ),
        (
            "Change approval recorded on or before the import date",
            "Test evidence attached to the ticket",
            "Importer differs from the transport owner",
        ),
        (
            "STMS production import log for the period",
            "ServiceNow change ticket export for the period",
            "CAB meeting approvals for the period",
        ),
        "Population of about 740 production imports in the interim period: 25 items, "
        "random, keyed on the transport id.",
        ("transport_log", "change_tickets", "cab_approvals"),
    ),  # fmt: skip
    Control(
        "NS-CM-02",
        "Snowflake pipeline changes peer-reviewed before merge",
        "ITGC_CHANGE",
        "CHANGE",
        ("snowflake",),
        "EACH_OCCURRENCE",
        "MANUAL",
        "PREVENTIVE",
        "tom",
        "A change to a dbt model or Snowflake task alters the revenue report or the "
        "nightly loads without review.",
        "Every change to the pipeline repository is reviewed and approved by a second "
        "engineer before it is merged and deployed.",
        "Pipeline code lives in the northstar-data repository. The main branch is "
        "protected: a pull request needs one approving review from a platform engineer "
        "other than the author before merge; the deployment runs from main.",
        (
            "Obtain the pull request population merged in the period.",
            "Select a sample of 25 pull requests.",
            "For each, inspect that an approving review by someone other than the author is "
            "recorded before the merge.",
        ),
        (
            "Approving review by a reviewer other than the author",
            "Review recorded before the merge",
        ),
        ("Pull request export from the repository for the period",),
        "Population of about 90 merged pull requests: 25 items, random, keyed on the "
        "pull request id.",
        ("pipeline_prs",),
    ),  # fmt: skip
    Control(
        "NS-OP-01",
        "SAP finance batch jobs monitored and failures resolved",
        "ITGC_OPERATIONS",
        "OPERATIONS",
        ("sap",),
        "DAILY",
        "MANUAL",
        "DETECTIVE",
        "jordan",
        "A failed posting, payment or interface job goes unnoticed and the ledger is "
        "incomplete or late.",
        "Failed finance batch jobs are identified daily and resolved, with the failure "
        "and its resolution recorded.",
        "IT operations reviews the SM37 job log each morning for cancelled finance jobs, "
        "raises an incident for each, and records the resolution and rerun on the daily "
        "monitoring sheet.",
        (
            "Obtain the daily job monitoring sheet for a sample of 25 days in the period.",
            "For each day, inspect the review sign-off, and for each cancelled job the incident "
            "and its resolution.",
        ),
        (
            "Daily review performed and signed",
            "Each cancelled job has an incident and a recorded resolution",
        ),
        ("SAP batch job monitoring sheet (SM37 extract with incidents)",),
        "Daily control: 25 days, random, from the interim period.",
        ("batch_monitoring",),
    ),  # fmt: skip
    Control(
        "NS-OP-02",
        "Snowflake nightly loads monitored and failures investigated",
        "ITGC_OPERATIONS",
        "OPERATIONS",
        ("snowflake",),
        "DAILY",
        "MANUAL",
        "DETECTIVE",
        "tom",
        "A failed or partial nightly load leaves the warehouse, and the reports built on "
        "it, incomplete.",
        "Failed Snowflake tasks are identified daily, investigated, and rerun, with an "
        "incident recorded for each failure.",
        "The platform team reviews the task history each morning. Each failed task gets a "
        "ServiceNow incident with the cause and the rerun; the review is recorded in the "
        "task history export's resolution columns.",
        (
            "Obtain the task history for a sample of 25 days in the period.",
            "For each failed task, inspect the incident, the cause, and the rerun.",
        ),
        (
            "Each failed task has an incident and a recorded resolution",
            "Failed task rerun successfully",
        ),
        ("Snowflake task history export with incident references",),
        "Daily control: 25 days, random, from the interim period.",
        ("task_history",),
    ),  # fmt: skip
    Control(
        "NS-AP-01",
        "Three-way match tolerance blocks invoices outside tolerance",
        "ITAC",
        "P2P",
        ("sap",),
        "CONTINUOUS",
        "AUTOMATED",
        "PREVENTIVE",
        "samuel",
        "Supplier invoices that differ from the purchase order or goods receipt beyond "
        "tolerance are paid without review.",
        "SAP blocks for payment any invoice whose price variance exceeds 5 percent or USD "
        "500 against the purchase order, until released by an authorized approver.",
        "Tolerance key PE in OMR6 is configured for each company code at 5 percent / USD "
        "500. Invoices outside tolerance receive payment block R and appear on the blocked "
        "invoice list for release by accounts payable management.",
        (
            "Inspect the OMR6 tolerance configuration for each company code.",
            "Obtain the invoice population for a month and recompute the variance for every "
            "invoice; agree that every invoice outside tolerance carries block R and none "
            "inside tolerance does.",
            "Agree the blocked invoice list to the recomputation.",
        ),
        (
            "Tolerance configured at 5% / USD 500 for every company code",
            "Every invoice outside tolerance is blocked",
            "No invoice inside tolerance is blocked",
        ),
        (
            "OMR6 tolerance configuration",
            "AP invoice population for a month",
            "Blocked invoice list for the month",
        ),
        "Automated control: configuration as of a date plus a full recomputation of one "
        "month's invoices.",
        ("tolerance_config", "ap_invoices", "blocked_invoices"),
    ),  # fmt: skip
    Control(
        "NS-IP-01",
        "Revenue-by-customer report complete and accurate to the ledger",
        "IPE",
        "REVENUE",
        ("snowflake", "sap"),
        "MONTHLY",
        "IT_DEPENDENT_MANUAL",
        "DETECTIVE",
        "samuel",
        "The monthly revenue-by-customer report used in the close review and for revenue "
        "analytics omits an entity or misstates amounts, and decisions rest on it.",
        "The Snowflake revenue-by-customer report is reconciled monthly to the SAP general "
        "ledger revenue by company code, and differences are explained and resolved.",
        "After the nightly loads for the month end, the financial systems analyst runs the "
        "revenue-by-customer report and reconciles its total to SAP GL revenue accounts "
        "4000 to 4199 by company code. Differences are explained on the reconciliation and "
        "cleared before the report is issued to the Controller.",
        (
            "Obtain the report, the GL extract and the reconciliation for a sample month.",
            "Re-foot the report, agree its total and the GL total to the sources, recompute "
            "the difference and inspect the explanation of any difference.",
        ),
        (
            "Report total agrees to the ledger, or the difference is explained and resolved",
            "Every company code is present in the report",
            "Reconciliation prepared and reviewed",
        ),
        (
            "Revenue-by-customer report for the month",
            "SAP GL revenue extract for the month",
            "Report-to-ledger reconciliation",
        ),
        "Monthly control: one month (September 2027) in full; roll forward at year end.",
        (
            "close_calendar",
            "revenue_report",
            "gl_revenue",
            "ipe_reconciliation",
            "revenue_report_aug",
            "gl_revenue_aug",
            "ipe_reconciliation_aug",
        ),
    ),  # fmt: skip
    Control(
        "NS-MR-01",
        "Monthly close flux review by the Controller",
        "MRC",
        "CLOSE",
        ("sap", "snowflake"),
        "MONTHLY",
        "MANUAL",
        "DETECTIVE",
        "grace",
        "A misstatement in a significant account goes undetected at the close because "
        "variances are not investigated.",
        "The Controller reviews the monthly fluctuation analysis, investigates every "
        "variance over 10 percent and USD 250,000, and documents the explanation before "
        "signing off the close.",
        "Accounting prepares the flux analysis from SAP after the ledger closes. The "
        "Controller reviews each account against the threshold, documents the explanation "
        "for every variance over it, and signs the close review memo with the review date "
        "and the report run date.",
        (
            "Obtain the flux analysis and the close review memo for a sample of months.",
            "Inspect that every variance over the threshold has a documented, specific "
            "explanation, and that the review is signed after the report was run.",
        ),
        (
            "Every variance over the threshold has a documented explanation",
            "Review signed after the report run date",
            "Reviewer is the Controller",
        ),
        ("Monthly fluctuation analysis", "Close review memo"),
        "Monthly control: two months (August and September 2027); roll forward at year end.",
        ("close_calendar", "flux_analysis", "close_memo_sep", "close_memo_aug"),
    ),  # fmt: skip
)
CONTROL_BY_REF: dict[str, Control] = {c.ref: c for c in CONTROLS}

# Milestones of the engagement (name, due date).
MILESTONES: tuple[tuple[str, date], ...] = (
    ("Planning and scoping complete", date(2027, 3, 31)),
    ("Walkthroughs and design evaluation", date(2027, 5, 28)),
    ("Interim testing (as of 30 September)", date(2027, 11, 12)),
    ("Remediation retest", date(2027, 12, 17)),
    ("Roll-forward testing", date(2028, 1, 28)),
    ("Reporting and sign-off", date(2028, 2, 18)),
)

# The scenarios: the one record each file set tells about.
LATE_TERMINATION_EMPLOYEE = "NS-EMP-0417"  # Kowalski: locked 9 business days late
OPEN_TERMINATION_EMPLOYEE = "NS-EMP-0533"  # Brandt: still active at the period end
UNAPPROVED_PRIVILEGED_USER = "NSUSR0388"  # contractor Devin Marsh holds SAP_ALL
UNAPPROVED_TRANSPORT = "TRN-27-0712"  # CHG0027144, emergency, no CAB approval
LATE_APPROVED_TRANSPORT = "TRN-27-0655"  # CHG0027131, approved after import
UNAPPROVED_TICKET = "CHG0027144"
LATE_APPROVED_TICKET = "CHG0027131"
STALE_EXPORT_DATE = date(2026, 10, 14)
FAILED_TASK_WITHOUT_TICKET = ("LOAD_SAP_GL_DAILY", date(2027, 9, 14))
REVENUE_REPORT_TOTAL = Decimal("48215680.00")
GL_REVENUE_TOTAL = Decimal("48400000.00")
MISSING_ENTITY_REVENUE = Decimal("184320.00")  # company code 4000
UNEXPLAINED_FLUX_ACCOUNT = "4100"
AUGUST_REVIEW_DATE = date(2027, 9, 3)
AUGUST_REPORT_RUN = date(2027, 9, 5)
SEPTEMBER_REVIEW_DATE = date(2027, 10, 6)
SEPTEMBER_REPORT_RUN = date(2027, 10, 5)


def business_days_between(start: date, end: date) -> int:
    """Business days after `start` up to and including `end` (weekends only)."""
    days = 0
    current = start
    while current < end:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


def add_business_days(start: date, days: int) -> date:
    current = start
    while days > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days -= 1
    return current


def _name(rng: random.Random, used: set[str]) -> str:
    while True:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        if name not in used:
            used.add(name)
            return name


@dataclass
class Records:
    """Every population, built once from the seed."""

    employees: list[dict[str, object]]
    sap_users: list[dict[str, object]]
    hr_terminations: list[dict[str, object]]
    termination_removals: list[dict[str, object]]
    access_requests: list[dict[str, object]]
    privileged_access: list[dict[str, object]]
    firefighter_log: list[dict[str, object]]
    access_certifications: list[dict[str, object]]
    certification_revocations: list[dict[str, object]]
    entra_pim: list[dict[str, object]]
    entra_role_approvals: list[dict[str, object]]
    conditional_access: list[dict[str, object]]
    snowflake_grants: list[dict[str, object]]
    snowflake_role_approvals: list[dict[str, object]]
    transport_log: list[dict[str, object]]
    change_tickets: list[dict[str, object]]
    cab_meetings: list[dict[str, object]]
    pipeline_prs: list[dict[str, object]]
    batch_monitoring: list[dict[str, object]]
    task_history: list[dict[str, object]]
    tolerance_config: list[dict[str, object]]
    ap_invoices: list[dict[str, object]]
    blocked_invoices: list[dict[str, object]]
    revenue_report: list[dict[str, object]]
    gl_revenue: list[dict[str, object]]
    ipe_reconciliation: list[dict[str, object]]
    flux_analysis: list[dict[str, object]]
    close_calendar: list[dict[str, object]]
    revenue_report_aug: list[dict[str, object]]
    gl_revenue_aug: list[dict[str, object]]
    ipe_reconciliation_aug: list[dict[str, object]]


def build() -> Records:
    """The whole dataset, the same every time."""
    rng = random.Random(SEED)
    used_names: set[str] = set()

    # People: 540 employees with SAP accounts, 2 named for the scenarios, 1 contractor.
    employees: list[dict[str, object]] = []
    for n in range(1, 541):
        emp_id = f"NS-EMP-{n:04d}"
        name = _name(rng, used_names)
        if emp_id == LATE_TERMINATION_EMPLOYEE:
            name = "Anna Kowalski"
        if emp_id == OPEN_TERMINATION_EMPLOYEE:
            name = "Lukas Brandt"
        entity = ENTITIES[rng.choices(range(4), weights=(55, 25, 15, 5))[0]]
        department = rng.choice(DEPARTMENTS)
        hired = date(2019, 1, 1) + timedelta(days=rng.randrange(0, 2900))
        employees.append(
            {
                "employee_id": emp_id,
                "name": name,
                "department": department,
                "company_code": entity[0],
                "entity": entity[1],
                "hire_date": hired,
                "manager": "",
                "employment": "Employee",
            }
        )
    for i, emp in enumerate(employees):
        emp["manager"] = employees[(i * 7 + 13) % 540]["name"] if i % 9 else "Grace Lindqvist"
    contractor = {
        "employee_id": "NS-CTR-0388",
        "name": "Devin Marsh",
        "department": "Information Technology",
        "company_code": "1000",
        "entity": ENTITIES[0][1],
        "hire_date": date(2027, 5, 24),
        "manager": "Priya Raman",
        "employment": "Contractor",
    }

    # Terminations: 58 in January to September, each with an SAP account.
    hr_terminations: list[dict[str, object]] = []
    termination_removals: list[dict[str, object]] = []
    others = [n for n in range(60, 540) if n not in (417, 533)]
    terminated_ids = sorted(rng.sample(others, 56) + [417, 533])
    for n in terminated_ids:
        emp = employees[n - 1]
        if emp["employee_id"] == LATE_TERMINATION_EMPLOYEE:
            terminated = date(2027, 5, 14)
        elif emp["employee_id"] == OPEN_TERMINATION_EMPLOYEE:
            terminated = date(2027, 8, 20)
        else:
            terminated = PERIOD_START + timedelta(days=rng.randrange(3, 270))
            while terminated.weekday() >= 5:
                terminated += timedelta(days=1)
        hr_terminations.append(
            {
                "employee_id": emp["employee_id"],
                "name": emp["name"],
                "department": emp["department"],
                "entity": emp["entity"],
                "termination_date": terminated,
                "last_working_day": terminated,
                "termination_type": rng.choice(("Voluntary", "Voluntary", "Involuntary")),
                "notified_by": "Workday termination feed",
            }
        )
        if emp["employee_id"] == OPEN_TERMINATION_EMPLOYEE:
            continue  # never removed: no row in the removal log
        if emp["employee_id"] == LATE_TERMINATION_EMPLOYEE:
            locked = date(2027, 5, 27)  # 9 business days
        else:
            locked = add_business_days(terminated, rng.choice((0, 1, 1, 2, 2, 3)))
        termination_removals.append(
            {
                "employee_id": emp["employee_id"],
                "sap_user": f"NSUSR{n:04d}",
                "termination_date": terminated,
                "lock_date": locked,
                "business_days": business_days_between(terminated, locked),
                "removed_by": rng.choice(("NSUSR0007", "NSUSR0012")),
                "ticket": f"RITM00{27000 + n}",
            }
        )
    removal_by_id = {str(r["employee_id"]): r for r in termination_removals}

    # SAP user listing (USR02) as of the period end.
    sap_users: list[dict[str, object]] = []
    for n, emp in enumerate(employees, start=1):
        user = f"NSUSR{n:04d}"
        hire_value = emp["hire_date"]
        assert isinstance(hire_value, date)
        created = max(date(2019, 1, 7), hire_value)
        row: dict[str, object] = {
            "user_id": user,
            "full_name": emp["name"],
            "employee_id": emp["employee_id"],
            "user_type": "Dialog",
            "department": emp["department"],
            "company_code": emp["company_code"],
            "created_on": created,
            "valid_from": created,
            "valid_to": date(9999, 12, 31),
            "lock_status": 0,
            "last_logon": AS_OF - timedelta(days=rng.randrange(0, 20)),
        }
        removal = removal_by_id.get(str(emp["employee_id"]))
        if removal is not None:
            row["valid_to"] = removal["lock_date"]
            row["lock_status"] = 64
            row["last_logon"] = removal["termination_date"]
        elif str(emp["employee_id"]) == OPEN_TERMINATION_EMPLOYEE:
            row["last_logon"] = date(2027, 8, 19)
        sap_users.append(row)
    sap_users.append(
        {
            "user_id": UNAPPROVED_PRIVILEGED_USER,
            "full_name": contractor["name"],
            "employee_id": contractor["employee_id"],
            "user_type": "Dialog",
            "department": contractor["department"],
            "company_code": "1000",
            "created_on": date(2027, 5, 24),
            "valid_from": date(2027, 5, 24),
            "valid_to": date(2027, 12, 31),
            "lock_status": 0,
            "last_logon": date(2027, 9, 29),
        }
    )
    for user, name, kind in (
        ("DDIC", "SAP Data Dictionary", "System"),
        ("SAP*", "SAP Super User", "System"),
        ("TMSADM", "Transport Management", "System"),
        ("BATCHADM", "Batch Administration", "System"),
        ("ALEREMOTE", "ALE Interface", "Communication"),
        ("WF-BATCH", "Workflow Batch", "System"),
        ("FF_FIN01", "Firefighter Finance 01", "Service"),
        ("FF_FIN02", "Firefighter Finance 02", "Service"),
        ("FF_BAS01", "Firefighter Basis 01", "Service"),
    ):
        sap_users.append(
            {
                "user_id": user,
                "full_name": name,
                "employee_id": "",
                "user_type": kind,
                "department": "Information Technology",
                "company_code": "1000",
                "created_on": date(2019, 1, 7),
                "valid_from": date(2019, 1, 7),
                "valid_to": date(9999, 12, 31),
                "lock_status": 0 if kind != "System" or user in ("DDIC", "BATCHADM") else 64,
                "last_logon": AS_OF - timedelta(days=rng.randrange(0, 3)),
            }
        )
    sap_users.sort(key=lambda r: str(r["user_id"]))

    # Access requests: 180 new users or role changes in the period, all approved before
    # provisioning.
    role_catalog = (
        "Z_FI_GL_ACCOUNTANT", "Z_FI_AP_CLERK", "Z_FI_AR_CLERK", "Z_FI_DISPLAY",
        "Z_MM_BUYER", "Z_SD_BILLING", "Z_CO_ANALYST", "Z_FI_CLOSE_SUPERVISOR",
    )  # fmt: skip
    access_requests: list[dict[str, object]] = []
    for i in range(1, 181):
        emp = employees[(i * 3) % 540]
        roles = sorted(rng.sample(role_catalog, rng.choice((1, 1, 2))))
        approved_manager = PERIOD_START + timedelta(days=rng.randrange(0, 268))
        while approved_manager.weekday() >= 5:
            approved_manager += timedelta(days=1)
        approved_owner = add_business_days(approved_manager, rng.choice((0, 0, 1)))
        provisioned = add_business_days(approved_owner, rng.choice((0, 1, 1, 2)))
        access_requests.append(
            {
                "request_id": f"REQ-27-{i:04d}",
                "sap_user": f"NSUSR{((i * 3) % 540) + 1:04d}",
                "name": emp["name"],
                "request_type": "New access" if i % 4 else "Role change",
                "roles_requested": ", ".join(roles),
                "roles_provisioned": ", ".join(roles),
                "requested_by": emp["manager"],
                "manager_approval": approved_manager,
                "role_owner": "Priya Raman" if i % 3 else "Grace Lindqvist",
                "role_owner_approval": approved_owner,
                "provisioned_on": provisioned,
                "provisioned_by": rng.choice(("NSUSR0007", "NSUSR0012")),
                "status": "Closed Complete",
            }
        )

    # Privileged access: the approved system accounts, the firefighter IDs, and one
    # contractor who should not be there.
    privileged_access: list[dict[str, object]] = [
        {"user_id": "DDIC", "full_name": "SAP Data Dictionary", "user_type": "System",
         "profile": "SAP_ALL", "assigned_on": date(2019, 1, 7), "approved_list": "Yes",
         "approval_ref": "PRIV-BASELINE-2019"},
        {"user_id": "SAP*", "full_name": "SAP Super User", "user_type": "System",
         "profile": "SAP_ALL", "assigned_on": date(2019, 1, 7), "approved_list": "Yes",
         "approval_ref": "PRIV-BASELINE-2019"},
        {"user_id": "TMSADM", "full_name": "Transport Management", "user_type": "System",
         "profile": "SAP_NEW", "assigned_on": date(2019, 1, 7), "approved_list": "Yes",
         "approval_ref": "PRIV-BASELINE-2019"},
        {"user_id": "BATCHADM", "full_name": "Batch Administration", "user_type": "System",
         "profile": "SAP_ALL", "assigned_on": date(2019, 1, 7), "approved_list": "Yes",
         "approval_ref": "PRIV-BASELINE-2019"},
        {"user_id": "FF_FIN01", "full_name": "Firefighter Finance 01", "user_type": "Service",
         "profile": "SAP_ALL", "assigned_on": date(2021, 3, 1), "approved_list": "Yes",
         "approval_ref": "PRIV-FF-2021"},
        {"user_id": "FF_FIN02", "full_name": "Firefighter Finance 02", "user_type": "Service",
         "profile": "SAP_ALL", "assigned_on": date(2021, 3, 1), "approved_list": "Yes",
         "approval_ref": "PRIV-FF-2021"},
        {"user_id": "FF_BAS01", "full_name": "Firefighter Basis 01", "user_type": "Service",
         "profile": "SAP_ALL", "assigned_on": date(2021, 3, 1), "approved_list": "Yes",
         "approval_ref": "PRIV-FF-2021"},
        {"user_id": UNAPPROVED_PRIVILEGED_USER, "full_name": "Devin Marsh", "user_type": "Dialog",
         "profile": "SAP_ALL", "assigned_on": date(2027, 6, 2), "approved_list": "No",
         "approval_ref": ""},
    ]  # fmt: skip
    firefighter_log: list[dict[str, object]] = []
    for i in range(1, 41):
        start = PERIOD_START + timedelta(days=rng.randrange(0, 270))
        while start.weekday() >= 5:
            start += timedelta(days=1)
        emp = employees[(i * 11) % 60]
        reviewed = add_business_days(start, rng.choice((1, 2, 3, 4)))
        firefighter_log.append(
            {
                "request_id": f"FFR-27-{i:03d}",
                "firefighter_id": rng.choice(("FF_FIN01", "FF_FIN02", "FF_BAS01")),
                "requested_by": emp["name"],
                "sap_user": f"NSUSR{((i * 11) % 60) + 1:04d}",
                "reason": rng.choice(
                    (
                        "Month-end posting correction",
                        "Emergency interface restart",
                        "Payment run rerun",
                        "Period close configuration",
                    )
                ),
                "approved_by": "Priya Raman",
                "approved_on": start,
                "session_start": datetime(start.year, start.month, start.day, 18, 5),
                "session_end": datetime(start.year, start.month, start.day, 20, 40),
                "log_reviewed_by": "Priya Raman",
                "log_reviewed_on": reviewed,
            }
        )

    # Access certifications: three quarterly campaigns and their revocations.
    access_certifications: list[dict[str, object]] = []
    certification_revocations: list[dict[str, object]] = []
    for quarter, (opened, closed) in enumerate(
        ((date(2027, 1, 11), date(2027, 1, 29)), (date(2027, 4, 12), date(2027, 4, 30)),
         (date(2027, 7, 12), date(2027, 7, 30))),
        start=1,
    ):  # fmt: skip
        decided = 486 + quarter * 3
        denied = (9, 11, 8)[quarter - 1]
        access_certifications.append(
            {
                "campaign_id": f"AR-2027-Q{quarter}",
                "scope": "Entra ID groups mapped to SAP S/4HANA roles (31 groups)",
                "opened_on": opened,
                "closed_on": closed,
                "due_on": closed,
                "assignments": decided,
                "decided": decided,
                "approved": decided - denied,
                "denied": denied,
                "reviewers": 42,
                "completion": "100%",
                "signed_off_by": "Elena Vasquez",
                "signed_off_on": closed,
            }
        )
        for k in range(denied):
            emp = employees[(quarter * 50 + k * 7) % 540]
            certification_revocations.append(
                {
                    "campaign_id": f"AR-2027-Q{quarter}",
                    "sap_user": f"NSUSR{((quarter * 50 + k * 7) % 540) + 1:04d}",
                    "name": emp["name"],
                    "group": rng.choice(role_catalog),
                    "decision": "Deny",
                    "decided_by": emp["manager"],
                    "revoked_on": add_business_days(closed, 1),
                    "revoked_by": "Entra ID access review (automatic)",
                }
            )

    # Entra privileged roles (PIM) and their approvals.
    entra_pim: list[dict[str, object]] = []
    entra_role_approvals: list[dict[str, object]] = []
    pim_roles = (
        ("Global Administrator", 3), ("Privileged Role Administrator", 2),
        ("Security Administrator", 3), ("Conditional Access Administrator", 2),
        ("Exchange Administrator", 2), ("User Administrator", 2),
    )  # fmt: skip
    n = 0
    for role, count in pim_roles:
        for _ in range(count):
            n += 1
            emp = employees[(n * 17) % 40]
            approved = date(2026, 11, 1) + timedelta(days=rng.randrange(0, 300))
            entra_pim.append(
                {
                    "role": role,
                    "principal": emp["name"],
                    "upn": f"{str(emp['name']).lower().replace(' ', '.')}@northstar.example",
                    "assignment_type": "Eligible",
                    "mfa_required": "Yes",
                    "assigned_on": approved,
                    "approval_ref": f"REQ-PIM-{n:03d}",
                }
            )
            entra_role_approvals.append(
                {
                    "approval_ref": f"REQ-PIM-{n:03d}",
                    "role": role,
                    "principal": emp["name"],
                    "requested_by": emp["manager"],
                    "approved_by": "Elena Vasquez",
                    "approved_on": approved,
                    "justification": "Operational duty within the identity platform team",
                }
            )
    for glass in ("breakglass01@northstar.example", "breakglass02@northstar.example"):
        entra_pim.append(
            {
                "role": "Global Administrator",
                "principal": "Break-glass account",
                "upn": glass,
                "assignment_type": "Active",
                "mfa_required": "N/A (monitored, sealed credential)",
                "assigned_on": date(2024, 2, 1),
                "approval_ref": "SEC-BREAKGLASS-2024",
            }
        )

    conditional_access: list[dict[str, object]] = [
        {"policy_id": "CA001", "name": "Require MFA for all users", "state": "On",
         "users": "All users", "exclusions": "breakglass01, breakglass02",
         "applications": "All cloud apps", "grant": "Require multifactor authentication"},
        {"policy_id": "CA002", "name": "Block legacy authentication", "state": "On",
         "users": "All users", "exclusions": "None", "applications": "All cloud apps",
         "grant": "Block"},
        {"policy_id": "CA003", "name": "Require compliant device for SAP", "state": "On",
         "users": "All users", "exclusions": "breakglass01, breakglass02",
         "applications": "SAP S/4HANA (SSO)", "grant": "Require compliant device"},
        {"policy_id": "CA004", "name": "Privileged role activation MFA", "state": "On",
         "users": "Directory roles: all privileged", "exclusions": "None",
         "applications": "Microsoft Admin Portals", "grant": "Require MFA, sign-in frequency 1 hour"},
    ]  # fmt: skip

    # Snowflake grants and approvals.
    snowflake_grants: list[dict[str, object]] = []
    snowflake_role_approvals: list[dict[str, object]] = []
    engineers = [employees[(k * 23) % 80]["name"] for k in range(1, 7)]
    k = 0
    for role, holders in (("ACCOUNTADMIN", 2), ("SECURITYADMIN", 2), ("SYSADMIN", 4)):
        for h in range(holders):
            k += 1
            who = engineers[(k + h) % 6]
            granted = date(2027, 1, 11) + timedelta(days=rng.randrange(0, 250))
            snowflake_grants.append(
                {
                    "grant_id": f"GR-{k:03d}",
                    "role": role,
                    "granted_to": "USER",
                    "grantee_name": str(who).upper().replace(" ", "_"),
                    "granted_by": "SECURITYADMIN",
                    "created_on": granted,
                    "approval_ref": f"REQ-SF-{k:03d}",
                }
            )
            snowflake_role_approvals.append(
                {
                    "approval_ref": f"REQ-SF-{k:03d}",
                    "role": role,
                    "grantee": who,
                    "approved_by": "Tom Okonkwo",
                    "approved_on": granted,
                    "justification": "Platform engineering duty",
                }
            )
    for i in range(1, 41):
        emp = employees[(i * 13) % 540]
        snowflake_grants.append(
            {
                "grant_id": f"GR-{100 + i:03d}",
                "role": rng.choice(("ANALYST_FINANCE", "ANALYST_REVENUE", "REPORT_READER")),
                "granted_to": "USER",
                "grantee_name": str(emp["name"]).upper().replace(" ", "_"),
                "granted_by": "SECURITYADMIN",
                "created_on": date(2026, 1, 1) + timedelta(days=rng.randrange(0, 600)),
                "approval_ref": f"REQ-27-{(i * 4) % 180 + 1:04d}",
            }
        )

    # Changes: tickets, transports and the CAB that approved them.
    change_tickets: list[dict[str, object]] = []
    transport_log: list[dict[str, object]] = []
    cab_meetings: list[dict[str, object]] = []
    developers = [f"NSUSR{((d * 29) % 60) + 1:04d}" for d in range(1, 13)]
    basis = ("NSUSR0007", "NSUSR0012", "NSUSR0021")
    mondays = [date(2027, 1, 4) + timedelta(days=7 * w) for w in range(39)]
    cab_by_date: dict[date, list[str]] = {m: [] for m in mondays}
    transport_no = 0
    for t in range(1, 261):
        ticket = f"CHG00{27000 + t}"
        raised = PERIOD_START + timedelta(days=rng.randrange(0, 262))
        while raised.weekday() >= 5:
            raised += timedelta(days=1)
        emergency = ticket == UNAPPROVED_TICKET or (t % 23 == 0)
        cab_date = next((m for m in mondays if m >= raised), mondays[-1])
        approver = "Change Advisory Board" if not emergency else "Marcus Delgado"
        approval: date | None = cab_date if not emergency else add_business_days(raised, 0)
        import_date = add_business_days(approval, rng.choice((1, 2, 3, 5)))  # type: ignore[arg-type]
        if ticket == UNAPPROVED_TICKET:
            approval = None
            approver = ""
            import_date = date(2027, 8, 23)
        if ticket == LATE_APPROVED_TICKET:
            approval = date(2027, 7, 19)
            approver = "Change Advisory Board"
            import_date = date(2027, 7, 17)
        if approval is not None and not emergency:
            cab_by_date.setdefault(approval, []).append(ticket)
        count = 1 if t % 3 else rng.choice((2, 3, 4))
        transports: list[str] = []
        for _ in range(count):
            transport_no += 1
            transport = f"TRN-27-{transport_no:04d}"
            transports.append(transport)
        if ticket == UNAPPROVED_TICKET:
            transports = [UNAPPROVED_TRANSPORT]
        if ticket == LATE_APPROVED_TICKET:
            transports = [LATE_APPROVED_TRANSPORT]
        owner = rng.choice(developers)
        for transport in transports:
            transport_log.append(
                {
                    "transport_id": transport,
                    "description": rng.choice(
                        (
                            "FI: posting period variant update",
                            "AP: payment proposal fix",
                            "SD: billing output form",
                            "MM: tolerance key maintenance",
                            "FI: new GL account mapping",
                            "CO: cost center hierarchy",
                            "Basis: kernel parameter",
                            "FI: revenue recognition rule",
                        )
                    ),
                    "type": "Workbench" if transport_no % 3 else "Customizing",
                    "owner": owner,
                    "imported_by": rng.choice(basis),
                    "import_date": import_date,
                    "import_time": f"{rng.randrange(18, 23):02d}:{rng.randrange(0, 60):02d}",
                    "return_code": 0 if transport_no % 11 else 4,
                    "change_ticket": ticket,
                }
            )
        change_tickets.append(
            {
                "ticket": ticket,
                "short_description": f"{'Emergency: ' if emergency else ''}{transport_log[-1]['description']}",
                "category": "Emergency" if emergency else "Normal",
                "requested_by": employees[(t * 5) % 60]["name"],
                "raised_on": raised,
                "transports": ", ".join(transports),
                "approval_date": approval,
                "approved_by": approver,
                "test_evidence": "" if ticket == UNAPPROVED_TICKET else f"TEST-{ticket}.pdf",
                "status": "Closed",
            }
        )
    # Bring the two named transports' owners apart from their importers, as all are.
    for row in transport_log:
        if row["owner"] == row["imported_by"]:
            row["imported_by"] = basis[0] if row["owner"] != basis[0] else basis[1]
    transport_log.sort(key=lambda r: (str(r["import_date"]), str(r["transport_id"])))
    for meeting in mondays:
        approved_tickets = sorted(cab_by_date.get(meeting, []))
        cab_meetings.append(
            {
                "meeting_date": meeting,
                "chair": "Marcus Delgado",
                "attendees": "Marcus Delgado, Priya Raman, Jordan Patel, Samuel Osei",
                "approved_tickets": approved_tickets,
                "deferred": 0 if len(approved_tickets) % 4 else 1,
            }
        )

    # Pipeline pull requests.
    pipeline_prs: list[dict[str, object]] = []
    for i in range(1, 91):
        author = engineers[i % 6]
        reviewer = engineers[(i + 1) % 6]
        approved = PERIOD_START + timedelta(days=rng.randrange(0, 270))
        merged = approved + timedelta(hours=rng.randrange(1, 30))
        pipeline_prs.append(
            {
                "pr_id": f"PR-{i:03d}",
                "title": rng.choice(
                    (
                        "dbt: revenue mart incremental model",
                        "task: LOAD_SAP_GL_DAILY schedule",
                        "dbt: customer dimension SCD2",
                        "task: Zuora billing load retry",
                        "dbt: FX rates snapshot",
                        "macro: audit columns",
                    )
                ),
                "author": author,
                "reviewer": reviewer,
                "review_state": "Approved",
                "approved_at": datetime(approved.year, approved.month, approved.day, 10, 15),
                "merged_at": datetime(approved.year, approved.month, approved.day, 10, 15)
                + timedelta(hours=rng.randrange(1, 30)),
                "deployed_from": "main",
            }
        )
        _ = merged

    # SAP batch jobs, September.
    batch_monitoring: list[dict[str, object]] = []
    jobs = ("ZFI_GL_POST_INTERFACE", "ZFI_AP_PAYMENT_RUN", "ZSD_BILLING_DUE_LIST",
            "ZFI_FX_REVALUATION", "ZCO_SETTLEMENT")  # fmt: skip
    for day in range(1, 31):
        run_date = date(2027, 9, day)
        for job in jobs:
            cancelled = rng.random() < 0.04
            batch_monitoring.append(
                {
                    "job_run": f"JR-{run_date:%m%d}-{jobs.index(job) + 1:02d}",
                    "run_date": run_date,
                    "job_name": job,
                    "status": "Cancelled" if cancelled else "Finished",
                    "start_time": "02:00" if "GL" in job else "03:30",
                    "incident": f"INC00{27800 + day}" if cancelled else "",
                    "resolution": "Rerun after interface file redelivery" if cancelled else "",
                    "resolved_on": run_date if cancelled else None,
                    "reviewed_by": "Jordan Patel",
                    "reviewed_on": run_date
                    if run_date.weekday() < 5
                    else run_date + timedelta(days=7 - run_date.weekday()),
                }
            )

    # Snowflake task history, September: one failure with no ticket.
    task_history: list[dict[str, object]] = []
    tasks = ("LOAD_SAP_GL_DAILY", "LOAD_ZUORA_BILLING", "BUILD_REVENUE_MART", "REFRESH_FX_RATES")
    for day in range(1, 31):
        run_date = date(2027, 9, day)
        for task in tasks:
            state = "SUCCEEDED"
            incident = ""
            resolution = ""
            if (task, run_date) == FAILED_TASK_WITHOUT_TICKET:
                state = "FAILED"
            elif task == "LOAD_ZUORA_BILLING" and day == 3:
                state = "FAILED"
                incident = "INC0027811"
                resolution = "Source API timeout; task rerun 2027-09-03 07:10, succeeded"
            task_history.append(
                {
                    "run_id": f"TR-{run_date:%m%d}-{tasks.index(task) + 1:02d}",
                    "run_date": run_date,
                    "task_name": task,
                    "scheduled_time": "01:00" if "LOAD" in task else "04:00",
                    "state": state,
                    "error_message": ""
                    if state == "SUCCEEDED"
                    else (
                        "Statement timed out after 3600 s"
                        if task == "LOAD_SAP_GL_DAILY"
                        else "External function returned HTTP 504"
                    ),
                    "incident": incident,
                    "resolution": resolution,
                    "reviewed_by": "Tom Okonkwo",
                }
            )

    # Three-way match tolerance and September invoices.
    tolerance_config = [
        {"company_code": code, "tolerance_key": "PE", "description": "Price variance: invoice to PO",
         "lower_pct": "5.0", "upper_pct": "5.0", "lower_abs_usd": "500.00", "upper_abs_usd": "500.00",
         "check_limit": "Yes", "changed_by": "NSUSR0203", "changed_on": date(2026, 2, 11)}
        for code, _, _ in ENTITIES
    ]  # fmt: skip
    ap_invoices: list[dict[str, object]] = []
    blocked_invoices: list[dict[str, object]] = []
    for i in range(1, 301):
        code = ENTITIES[rng.choices(range(4), weights=(55, 25, 15, 5))[0]][0]
        po_amount = Decimal(rng.randrange(1200, 180000)) / 4
        po_amount = po_amount.quantize(Decimal("0.01"))
        if i in (37, 158, 244):
            variance_pct = Decimal(rng.choice(("7.5", "12.0", "6.2")))
        else:
            variance_pct = Decimal(rng.choice(("0.0", "0.0", "0.0", "1.5", "-2.0", "3.9", "4.5")))
        invoice_amount = (po_amount * (1 + variance_pct / 100)).quantize(Decimal("0.01"))
        variance = (invoice_amount - po_amount).quantize(Decimal("0.01"))
        outside = abs(variance_pct) > 5 or abs(variance) > 500
        if abs(variance_pct) <= 5 and abs(variance) > 500:
            # Keep within-tolerance invoices within both limits.
            invoice_amount = (po_amount + Decimal("480.00")).quantize(Decimal("0.01"))
            variance = Decimal("480.00")
            variance_pct = (variance / po_amount * 100).quantize(Decimal("0.1"))
            outside = False
        posted = date(2027, 9, 1) + timedelta(days=rng.randrange(0, 30))
        row = {
            "invoice": f"INV-27-{51000 + i:05d}",
            "company_code": code,
            "vendor": f"V{rng.randrange(10000, 99999)}",
            "purchase_order": f"45000{rng.randrange(10000, 99999)}",
            "posting_date": posted,
            "po_amount_usd": po_amount,
            "invoice_amount_usd": invoice_amount,
            "variance_usd": variance,
            "variance_pct": variance_pct,
            "payment_block": "R" if outside else "",
        }
        ap_invoices.append(row)
        if outside:
            blocked_invoices.append(
                {
                    "invoice": row["invoice"],
                    "company_code": code,
                    "vendor": row["vendor"],
                    "posting_date": posted,
                    "invoice_amount_usd": invoice_amount,
                    "variance_usd": variance,
                    "variance_pct": variance_pct,
                    "block_reason": "Price variance outside tolerance PE",
                    "released_by": "",
                    "released_on": None,
                }
            )

    # The monthly close calendar: the population of the monthly controls (one row per
    # period closed in the interim window), with the dates the memos and reports carry.
    close_calendar: list[dict[str, object]] = []
    for month in range(1, 10):
        period = f"2027-{month:02d}"
        last = date(2027, month + 1, 1) - timedelta(days=1)
        report_run = add_business_days(last, 3)
        review = add_business_days(report_run, 1)
        if period == "2027-08":
            report_run, review = AUGUST_REPORT_RUN, AUGUST_REVIEW_DATE
        if period == "2027-09":
            report_run, review = SEPTEMBER_REPORT_RUN, SEPTEMBER_REVIEW_DATE
        close_calendar.append(
            {
                "period": period,
                "period_end": last,
                "ledger_closed": add_business_days(last, 2),
                "flux_report_run": report_run,
                "controller_review": review,
                "revenue_report_run": add_business_days(last, 1),
                "reconciliation_prepared": add_business_days(last, 2),
                "status": "Closed",
            }
        )

    # Revenue: the Snowflake report misses company code 4000.
    customers = [
        f"Customer {chr(65 + (c // 26))}{chr(65 + (c % 26))} {rng.choice(('Holdings', 'Group', 'Partners', 'Industries', 'Labs'))}"
        for c in range(42)
    ]
    weights = [rng.randrange(20, 400) for _ in customers]
    revenue_report: list[dict[str, object]] = []
    gl_revenue: list[dict[str, object]] = []
    by_code = {
        "1000": Decimal("26620000.00"),
        "2000": Decimal("14520000.00"),
        "3000": Decimal("7075680.00"),
        "4000": MISSING_ENTITY_REVENUE,
    }
    assert sum(by_code.values()) == GL_REVENUE_TOTAL
    assert sum(v for k, v in by_code.items() if k != "4000") == REVENUE_REPORT_TOTAL
    for code in ("1000", "2000", "3000"):
        members = [c for c in range(42) if c % 3 == ("1000", "2000", "3000").index(code)]
        total_weight = sum(weights[c] for c in members)
        remaining = by_code[code]
        for idx, c in enumerate(members):
            if idx == len(members) - 1:
                amount = remaining
            else:
                amount = (by_code[code] * weights[c] / total_weight).quantize(Decimal("0.01"))
                remaining -= amount
            revenue_report.append(
                {
                    "customer_id": f"C{1000 + c}",
                    "customer": customers[c],
                    "company_code": code,
                    "entity": next(e[1] for e in ENTITIES if e[0] == code),
                    "segment": "Cloud Platform" if c % 2 else "Advisory",
                    "revenue_usd": amount,
                    "period": "2027-09",
                }
            )
    for code, name, _ in ENTITIES:
        subscription = (by_code[code] * Decimal("0.62")).quantize(Decimal("0.01"))
        gl_revenue.append({"company_code": code, "entity": name, "gl_account": "4100",
                           "account_name": "Subscription revenue", "period": "2027-09",
                           "amount_usd": subscription})  # fmt: skip
        gl_revenue.append({"company_code": code, "entity": name, "gl_account": "4200",
                           "account_name": "Professional services revenue", "period": "2027-09",
                           "amount_usd": by_code[code] - subscription})  # fmt: skip
    ipe_reconciliation: list[dict[str, object]] = [
        {"line": "Revenue-by-customer report total (Snowflake, run 2027-10-02 06:10)",
         "amount_usd": REVENUE_REPORT_TOTAL},
        {"line": "SAP GL revenue 4000-4199, all company codes, period 2027-09",
         "amount_usd": GL_REVENUE_TOTAL},
        {"line": "Difference", "amount_usd": REVENUE_REPORT_TOTAL - GL_REVENUE_TOTAL},
        {"line": "Explanation", "amount_usd": None},
        {"line": "Prepared by Samuel Osei, 2027-10-02", "amount_usd": None},
        {"line": "Reviewed by", "amount_usd": None},
    ]  # fmt: skip

    # August: the same report and ledger agree to the cent, every entity present.
    august_scale = Decimal("0.934")
    revenue_report_aug: list[dict[str, object]] = []
    gl_revenue_aug: list[dict[str, object]] = []
    august_by_code: dict[str, Decimal] = {}
    for code, _, _ in ENTITIES:
        rows_for_code = [r for r in revenue_report if r["company_code"] == code]
        if code == "4000":
            amount = (MISSING_ENTITY_REVENUE * august_scale).quantize(Decimal("0.01"))
            revenue_report_aug.append(
                {"customer_id": "C1099", "customer": "Customer NL Holdings B.V.",
                 "company_code": code, "entity": ENTITIES[3][1], "segment": "Cloud Platform",
                 "revenue_usd": amount, "period": "2027-08"}
            )  # fmt: skip
            august_by_code[code] = amount
            continue
        total = Decimal("0")
        for r in rows_for_code:
            amount = (Decimal(str(r["revenue_usd"])) * august_scale).quantize(Decimal("0.01"))
            total += amount
            revenue_report_aug.append({**r, "revenue_usd": amount, "period": "2027-08"})
        august_by_code[code] = total
    for code, name, _ in ENTITIES:
        subscription = (august_by_code[code] * Decimal("0.62")).quantize(Decimal("0.01"))
        gl_revenue_aug.append({"company_code": code, "entity": name, "gl_account": "4100",
                               "account_name": "Subscription revenue", "period": "2027-08",
                               "amount_usd": subscription})  # fmt: skip
        gl_revenue_aug.append({"company_code": code, "entity": name, "gl_account": "4200",
                               "account_name": "Professional services revenue", "period": "2027-08",
                               "amount_usd": august_by_code[code] - subscription})  # fmt: skip
    august_total = sum(august_by_code.values())
    ipe_reconciliation_aug: list[dict[str, object]] = [
        {"line": "Revenue-by-customer report total (Snowflake, run 2027-09-01 06:10)",
         "amount_usd": august_total},
        {"line": "SAP GL revenue 4000-4199, all company codes, period 2027-08",
         "amount_usd": august_total},
        {"line": "Difference", "amount_usd": Decimal("0.00")},
        {"line": "Explanation", "amount_usd": None},
        {"line": "Agreed: no difference", "amount_usd": None},
        {"line": "Prepared by Samuel Osei, 2027-09-01", "amount_usd": None},
        {"line": "Reviewed by Grace Lindqvist, 2027-09-02", "amount_usd": None},
    ]  # fmt: skip

    # Flux analysis, September versus August.
    flux_analysis = []
    accounts = (
        ("4100", "Subscription revenue", Decimal("16036800.00"), Decimal("12.4"), ""),
        ("4200", "Professional services revenue", Decimal("18392000.00"), Decimal("-3.1"),
         "Within threshold"),
        ("5100", "Cost of subscription revenue", Decimal("5210000.00"), Decimal("11.8"),
         "Cloud hosting true-up for Q3 usage (invoice CH-2027-0912), USD 548k; expected."),
        ("6100", "Salaries and benefits", Decimal("9840000.00"), Decimal("2.2"),
         "Within threshold"),
        ("6300", "Sales commissions", Decimal("1964000.00"), Decimal("18.6"),
         "Quarter-end accelerator payouts per plan; agreed to commission statements."),
        ("7100", "Depreciation and amortization", Decimal("1120000.00"), Decimal("0.4"),
         "Within threshold"),
        ("2100", "Deferred revenue", Decimal("41220000.00"), Decimal("9.1"),
         "Within threshold"),
        ("1200", "Accounts receivable", Decimal("38510000.00"), Decimal("14.9"),
         "Annual billing cycle for 11 enterprise accounts in September; cash received October."),
    )  # fmt: skip
    for account, name, september, pct, explanation in accounts:
        august = (september / (1 + pct / 100)).quantize(Decimal("0.01"))
        variance = september - august
        over = abs(pct) > 10 and abs(variance) > 250000
        flux_analysis.append(
            {
                "gl_account": account,
                "account_name": name,
                "august_usd": august,
                "september_usd": september,
                "variance_usd": variance,
                "variance_pct": pct,
                "over_threshold": "Yes" if over else "No",
                "explanation": explanation,
                "investigated_by": "Grace Lindqvist" if over and explanation else "",
            }
        )

    return Records(
        employees=employees,
        sap_users=sap_users,
        hr_terminations=hr_terminations,
        termination_removals=termination_removals,
        access_requests=access_requests,
        privileged_access=privileged_access,
        firefighter_log=firefighter_log,
        access_certifications=access_certifications,
        certification_revocations=certification_revocations,
        entra_pim=entra_pim,
        entra_role_approvals=entra_role_approvals,
        conditional_access=conditional_access,
        snowflake_grants=snowflake_grants,
        snowflake_role_approvals=snowflake_role_approvals,
        transport_log=transport_log,
        change_tickets=change_tickets,
        cab_meetings=cab_meetings,
        pipeline_prs=pipeline_prs,
        batch_monitoring=batch_monitoring,
        task_history=task_history,
        tolerance_config=tolerance_config,
        ap_invoices=ap_invoices,
        blocked_invoices=blocked_invoices,
        revenue_report=revenue_report,
        gl_revenue=gl_revenue,
        ipe_reconciliation=ipe_reconciliation,
        flux_analysis=flux_analysis,
        close_calendar=close_calendar,
        revenue_report_aug=revenue_report_aug,
        gl_revenue_aug=gl_revenue_aug,
        ipe_reconciliation_aug=ipe_reconciliation_aug,
    )
