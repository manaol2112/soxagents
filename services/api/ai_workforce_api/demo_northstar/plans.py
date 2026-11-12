"""The words of the Northstar plans (Step 4B): the test criteria behind each attribute,
the evidence requests as the coordinator reads them, and the reviewer's notes.

Prepared with the dataset (SEEDED), never a model's answer at the time a person looks:
the criteria are the testing basis a person accepts, the requests say what the control
owner was asked for, the notes are the reviewer's own words on the demo's workpapers.
"""

# ruff: noqa: E501  (the criteria read as sentences)
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Criterion:
    attribute: str
    condition: str
    passes: str
    fails: str
    judgment: bool = False
    automatable: bool = True


CRITERIA: dict[str, tuple[Criterion, ...]] = {
    "NS-AC-01": (
        Criterion(
            "Manager approval recorded before provisioning",
            "The access request carries the manager's approval and the date of it.",
            "The manager approval date is on or before the provisioned date on the request.",
            "No manager approval is recorded, or its date is after the provisioned date.",
        ),
        Criterion(
            "Role owner approval recorded before provisioning",
            "The access request carries the role owner's approval and the date of it.",
            "The role owner approval date is on or before the provisioned date on the request.",
            "No role owner approval is recorded, or its date is after the provisioned date.",
        ),
        Criterion(
            "Roles provisioned agree to roles requested",
            "The request lists the roles requested and the roles provisioned.",
            "The roles provisioned are the roles requested, no more and no fewer.",
            "A role was provisioned that was not requested, or a requested role is missing.",
        ),
    ),
    "NS-AC-02": (
        Criterion(
            "SAP account locked and validity ended",
            "The SAP user listing shows the account of the terminated person.",
            "Lock status is 64 (administrator lock) and the validity end date is set to the lock date.",
            "The account is unlocked (lock status 0) or its validity runs past the period end.",
        ),
        Criterion(
            "Lock date within three business days of the termination date",
            "The termination date is in the HR listing; the lock date is in the removal log and the user listing.",
            "The business days from the termination date to the lock date are three or fewer.",
            "More than three business days passed, or the account was never locked.",
        ),
        Criterion(
            "Removal recorded in the termination removal log",
            "The removal log lists the person, the SAP user, the dates and who removed the access.",
            "A removal log entry exists for the person with the same termination date as HR.",
            "No removal log entry exists, or its termination date differs from HR's.",
        ),
    ),
    "NS-AC-03": (
        Criterion(
            "Holder is an approved system account or has an approved firefighter request",
            "The privileged access report names the holder, the profile and the approval reference.",
            "The holder is a system or firefighter account on the approved list with an approval reference, or a dialog user with an approved firefighter request covering the assignment.",
            "A dialog user holds SAP_ALL or SAP_NEW with no approval reference and no firefighter request.",
            judgment=True,
        ),
        Criterion(
            "Firefighter session log reviewed within five business days",
            "The firefighter request log records the session and the review of its log.",
            "The log review date is within five business days of the session.",
            "No review is recorded, or it came later than five business days.",
        ),
    ),
    "NS-AC-04": (
        Criterion(
            "Campaign completed within the window",
            "The campaign report gives the opened, due and closed dates.",
            "The closed date is on or before the due date and completion is 100%.",
            "The campaign closed after its due date or did not reach 100%.",
        ),
        Criterion(
            "Every assignment decided by the manager",
            "The campaign report counts assignments and decisions.",
            "Decided equals assignments.",
            "Some assignments were left undecided.",
        ),
        Criterion(
            "Denied assignments revoked",
            "The revocation listing names each denied assignment and its revocation date.",
            "Every denied assignment in the campaign has a revocation dated after the campaign closed.",
            "A denied assignment has no revocation, or the user still holds the group.",
        ),
    ),
    "NS-AC-05": (
        Criterion(
            "Assignment supported by an approved request",
            "The PIM export names the approval reference; the approvals list the request.",
            "The assignment's approval reference matches an approved request for the same role and person.",
            "No approval reference, or the approval names another role or person.",
        ),
        Criterion(
            "Assignment is eligible, or holder is an approved break-glass account",
            "The PIM export gives the assignment type.",
            "Type is Eligible, or the holder is one of the two approved break-glass accounts.",
            "A standing (Active) assignment on an ordinary account.",
        ),
        Criterion(
            "MFA required at activation",
            "The PIM export states whether MFA is required on activation.",
            "MFA on activation is Yes (break-glass accounts are sealed and monitored instead).",
            "MFA on activation is No for an eligible assignment.",
        ),
    ),
    "NS-AC-06": (
        Criterion(
            "MFA policy enabled for all users and applications during the period",
            "The conditional access export, dated within the period, shows policy CA001.",
            "CA001 is On for all users and all cloud apps on an export dated within FY2027.",
            "CA001 is off or report-only, scoped narrower, or the export is dated outside the period.",
            automatable=False,
        ),
        Criterion(
            "Exclusions limited to approved break-glass accounts",
            "The export lists the exclusions of the MFA policy.",
            "The only exclusions are breakglass01 and breakglass02.",
            "Any other account or group is excluded.",
        ),
    ),
    "NS-AC-07": (
        Criterion(
            "Privileged grant supported by an approved request",
            "SHOW GRANTS lists the grantee and an approval reference; the approvals list the request.",
            "For ACCOUNTADMIN, SECURITYADMIN and SYSADMIN the approval reference matches an approved request for the grantee.",
            "A privileged grant with no approval reference or one that names someone else.",
        ),
        Criterion(
            "Grantee is a named platform engineer, not a shared account",
            "SHOW GRANTS names the grantee.",
            "The grantee is a named person's user, not a service or shared account.",
            "A privileged role granted to a shared or service account.",
            judgment=True,
        ),
    ),
    "NS-CM-01": (
        Criterion(
            "Change approval recorded on or before the import date",
            "The change ticket carries the approval date and approver; the import log gives the import date.",
            "The ticket's approval date is on or before the transport's import date.",
            "No approval is recorded on the ticket, or its date is after the import date.",
        ),
        Criterion(
            "Test evidence attached to the ticket",
            "The change ticket names its test evidence.",
            "A test evidence reference is present on the ticket.",
            "The test evidence field is blank.",
        ),
        Criterion(
            "Importer differs from the transport owner",
            "The import log names the owner and the importer of the transport.",
            "The importer is not the owner.",
            "The same user developed and imported the transport.",
        ),
    ),
    "NS-CM-02": (
        Criterion(
            "Approving review by a reviewer other than the author",
            "The pull request export names the author and the reviewer and the review state.",
            "Review state is Approved and the reviewer is not the author.",
            "No approving review, or the author reviewed their own change.",
        ),
        Criterion(
            "Review recorded before the merge",
            "The export gives the approval time and the merge time.",
            "The approval time is before the merge time.",
            "The merge came before the approval.",
        ),
    ),
    "NS-OP-01": (
        Criterion(
            "Daily review performed and signed",
            "The monitoring sheet records the reviewer and the review date for the day.",
            "The day's rows carry a reviewer and a review date.",
            "A day without a reviewer or a review date.",
        ),
        Criterion(
            "Each cancelled job has an incident and a recorded resolution",
            "The monitoring sheet records the job status, the incident and its resolution.",
            "Every cancelled job on the day has an incident number and a resolution with a date.",
            "A cancelled job without an incident or without a resolution.",
        ),
    ),
    "NS-OP-02": (
        Criterion(
            "Each failed task has an incident and a recorded resolution",
            "The task history records the state, the incident and the resolution.",
            "Every FAILED run has an incident and a resolution.",
            "A FAILED run with a blank incident or resolution.",
        ),
        Criterion(
            "Failed task rerun successfully",
            "The task history records the rerun in the resolution.",
            "The resolution names a successful rerun.",
            "No rerun is recorded for a failed run.",
        ),
    ),
    "NS-AP-01": (
        Criterion(
            "Tolerance configured at 5% / USD 500 for every company code",
            "The OMR6 display lists tolerance key PE per company code.",
            "Every company code shows upper and lower limits of 5.0% and USD 500.00 with the check limit on.",
            "A company code with a different limit or the check off.",
        ),
        Criterion(
            "Every invoice outside tolerance is blocked",
            "The invoice population gives the variance and the payment block.",
            "Every invoice whose variance exceeds 5% or USD 500 carries payment block R.",
            "An invoice outside tolerance without block R.",
        ),
        Criterion(
            "No invoice inside tolerance is blocked",
            "The invoice population gives the variance and the payment block.",
            "No invoice within both limits carries block R.",
            "An invoice inside tolerance blocked for price variance.",
        ),
    ),
    "NS-IP-01": (
        Criterion(
            "Report total agrees to the ledger, or the difference is explained and resolved",
            "The reconciliation gives the report total, the ledger total, the difference and the explanation.",
            "The difference is zero, or it is explained and marked resolved before the report was issued.",
            "A difference with a blank explanation, or an unresolved difference.",
        ),
        Criterion(
            "Every company code is present in the report",
            "The report lists revenue by customer with the company code; the ledger lists every company code.",
            "Every company code with ledger revenue appears in the report.",
            "A company code with ledger revenue is missing from the report.",
        ),
        Criterion(
            "Reconciliation prepared and reviewed",
            "The reconciliation names the preparer and the reviewer.",
            "Both a preparer and a reviewer are named with dates.",
            "The reviewer line is blank.",
        ),
    ),
    "NS-MR-01": (
        Criterion(
            "Every variance over the threshold has a documented explanation",
            "The flux analysis marks variances over 10% and USD 250,000 and records the explanation.",
            "Every row marked over the threshold has a specific explanation and an investigator.",
            "A row over the threshold with a blank explanation.",
            judgment=True,
        ),
        Criterion(
            "Review signed after the report run date",
            "The close memo gives the report run date and the review date.",
            "The review date is on or after the report run date.",
            "The memo was signed before the report was run.",
        ),
        Criterion(
            "Reviewer is the Controller",
            "The close memo names the reviewer.",
            "The reviewer is the Corporate Controller.",
            "Someone other than the Controller signed the review.",
        ),
    ),
}


def criteria_for(control_ref: str, attribute_text: str) -> Criterion | None:
    for criterion in CRITERIA.get(control_ref, ()):
        if criterion.attribute == attribute_text:
            return criterion
    return None


# The requests, as the coordinator read them: one summary per control, the items from
# the plan's own requirements.
REQUEST_SUMMARIES: dict[str, str] = {
    "NS-AC-01": "For our testing of SAP access provisioning, please provide the ServiceNow access request export for 1 January to 30 September 2027 and the SAP user listing as of 30 September.",
    "NS-AC-02": "For our testing of access terminations, please provide the Workday termination listing for January to September 2027, the SAP termination removal log, and the SAP user listing as of 30 September.",
    "NS-AC-03": "For our testing of privileged SAP access, please provide the privileged access report (SAP_ALL, SAP_NEW, firefighter IDs) as of 30 September 2027 and the firefighter request log for the period.",
    "NS-AC-04": "For our testing of the quarterly access certifications, please provide the Entra ID access review campaign reports for Q1 to Q3 2027 with the denied assignments and their revocations.",
    "NS-AC-05": "For our testing of privileged directory roles, please provide the PIM role assignment export as of 30 September 2027 and the approvals for assignments made in the period.",
    "NS-AC-06": "For our testing of multi-factor authentication, please provide the conditional access policy configuration as of a date within FY2027.",
    "NS-AC-07": "For our testing of Snowflake privileged roles, please provide SHOW GRANTS output as of 30 September 2027 and the approvals for privileged grants made in the period.",
    "NS-CM-01": "For our testing of SAP change management, please provide the STMS production import log for 1 January to 30 September 2027, the ServiceNow change ticket export, and the CAB meeting approvals.",
    "NS-CM-02": "For our testing of pipeline changes, please provide the pull request export for the northstar-data repository, 1 January to 30 September 2027.",
    "NS-OP-01": "For our testing of batch job monitoring, please provide the daily SM37 monitoring sheets for September 2027 with incidents and resolutions.",
    "NS-OP-02": "For our testing of nightly load monitoring, please provide the Snowflake task history for September 2027 with incidents and resolutions.",
    "NS-AP-01": "For our testing of the three-way match tolerance, please provide the OMR6 tolerance configuration, the September 2027 invoice population with variances, and the blocked invoice list.",
    "NS-IP-01": "For our testing of the revenue-by-customer report, please provide the report, the SAP GL revenue extract and the reconciliation for August and September 2027, and the monthly close calendar.",
    "NS-MR-01": "For our testing of the Controller's flux review, please provide the flux analysis and the close review memos for August and September 2027, and the monthly close calendar.",
}

# The reviewer's notes: one control returned to the preparer, two with a comment cleared.
REVIEW_NOTES: dict[str, tuple[str, str, str]] = {
    # control ref: (severity, note, preparer's response)
    "NS-CM-01": (
        "MUST_FIX",
        "The exception on TRN-27-0655 cites the import log for the import date but not the ticket for the approval date. Cite both so the two days' gap is evidenced from the records, and restate the expected result as the criterion reads.",
        "Added the change ticket citation for the approval date on TRN-27-0655 and restated the expected result from the approved criterion.",
    ),
    "NS-AC-01": (
        "SHOULD_FIX",
        "Two sampled requests were role changes rather than new users; note on the workpaper that the control covers both, so the sample's composition reads as intended.",
        "Noted on the workpaper: the request population includes role changes, which the control covers by the same approvals.",
    ),
    "NS-OP-01": (
        "OBSERVATION",
        "Several sampled days fall on weekends and show the Monday review date; that is within the procedure but worth a line in the conclusion.",
        "Added the line: weekend job runs are reviewed on the next business day, as the procedure allows.",
    ),
}

# The control owners' answers to the walkthrough's questions (walkthrough_questions.py), as
# the audit team recorded them in each design walkthrough (closure.py's memos): a person's
# confirmed answers, not a model's. The demo's controls are its own (library keys
# "manual:northstar-*"), so the bank asks each of them its universal questions. None of the
# owners knew of a deviation or a change in the period at the walkthrough (the exceptions
# the testing finds come later), and every system is hosted by its vendor: SAP S/4HANA on
# RISE with SAP, Entra ID and Snowflake as cloud services (records.SYSTEMS). Each vendor's
# SOC 1 Type 2 report covers 1 October 2026 to 30 September 2027, so it covers part of the
# 2027 period and a bridge letter takes it to 31 December 2027 (SERVICE_ORGANIZATIONS).
WALKTHROUGH_ANSWERS: dict[str, str] = {
    "wt-known-deviations": "No",
    "wt-changes-in-period": "No",
    "wt-service-org": "Yes",
    "wt-service-org-report": "A SOC 1 Type 2 report covering part of the period (bridge letter needed)",
}
SERVICE_ORGANIZATIONS: dict[str, str] = {
    "sap": "SAP SE hosts SAP S/4HANA on RISE with SAP (private cloud) and operates its infrastructure, database and backups; Northstar performs this control itself. SAP's SOC 1 Type 2 report for RISE with SAP covers 1 October 2026 to 30 September 2027, with a bridge letter to 31 December 2027; the complementary user entity controls relied on are Northstar's own user access and change management over S/4HANA.",
    "entra": "Microsoft hosts Entra ID as a cloud service and operates its platform; Northstar configures its tenant and performs this control itself. Microsoft's SOC 1 Type 2 report for Microsoft Entra covers 1 October 2026 to 30 September 2027, with a bridge letter to 31 December 2027; the complementary user entity controls relied on are Northstar's administration of its tenant, its privileged roles and its access reviews.",
    "snowflake": "Snowflake Inc. hosts the data warehouse as a cloud service and operates its platform; Northstar performs this control itself. Snowflake's SOC 1 Type 2 report covers 1 October 2026 to 30 September 2027, with a bridge letter to 31 December 2027; the complementary user entity controls relied on are Northstar's management of its own users, roles, tasks and pipeline changes.",
}


def walkthrough_answer(systems: tuple[str, ...], key: str) -> str | None:
    """The owner's answer to one walkthrough question for a control on these systems; None
    for a question the demo leaves unanswered (an optional one)."""
    if key == "wt-service-org-detail":
        return " ".join(SERVICE_ORGANIZATIONS[system] for system in systems)
    return WALKTHROUGH_ANSWERS.get(key)


WORKPAPER_NOTE = (
    "Prepared with the Northstar demo dataset: the engagement as of 30 September 2027 (simulated)."
)
