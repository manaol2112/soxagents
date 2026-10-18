"""Testing definitions for the IT general, entity-level, application, and key report
controls of the standard library (library version 3). See testing_definitions.py.

Each attribute restates something the control description says the performer or system
does (basis DESIGN), or an inference marked as such. Where a value the attribute depends on
is not in the description (a number of days, a threshold, a list of approvers), the
attribute is LOW confidence and carries the question to answer; it is proposed, not tested.
"""

from typing import Any

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


# Logical access


ACCESS_PROVISIONING = Definition(
    library_key="access-provisioning",
    control_ref="ITGC-AC-01",
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
    procedures=(
        _design(
            "an access request",
            "the access management policy for who must approve which access",
            ("Access management policy", "One request, its approval, and the grant record"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected grant was requested and approved before it was "
            "made, for the access granted.",
            "For each selected grant, find its request, compare the approver and approval "
            "date with the policy and the grant date in the system, and compare the access in "
            "the system with the access approved.",
            ("Request and approval for each item", "System grant record for each item"),
            ("ac01-request", "ac01-approver", "ac01-before", "ac01-matches"),
        ),
        _roll_sampled(
            "new accounts and access changes",
            ("ac01-request", "ac01-approver", "ac01-before", "ac01-matches"),
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "ac01-request",
            "A request exists that names the user and the specific access (application, role, "
            "or permission) that was granted",
            condition="The request identifies the same user and the same access as the grant.",
            why="Without a request naming the access, the approval cannot be tied to what "
            "was granted.",
            evidence=("Access request form or ticket",),
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
        _a(
            "ac01-approver",
            "The request was approved by the user's manager and, where the access management "
            "policy requires it, by the application owner",
            condition="The approver is the user's manager, plus the application owner when "
            "the policy requires it for this access.",
            why="The control description names these approvers; an approval by anyone else "
            "does not meet it.",
            evidence=(
                "Approval record",
                "Organization chart or HR manager field",
                "Policy on application owner approval",
            ),  # fmt: skip
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
        _a(
            "ac01-before",
            "The approval is dated on or before the date the access was granted in the system",
            condition="Approval date is on or before the grant date recorded by the system.",
            why="The control is preventive: access granted before approval is not prevented.",
            evidence=("Approval timestamp", "System grant timestamp"),
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
        _a(
            "ac01-matches",
            "The access granted in the system is the access that was approved, and no more",
            condition="Access in the system equals the access on the approved request.",
            why="Approval of one role does not authorize another.",
            evidence=("Approved request", "System record of the user's access"),
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
    ),
)

ACCESS_TERMINATION = Definition(
    library_key="access-termination",
    control_ref="ITGC-AC-02",
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
    procedures=(
        _design(
            "a termination",
            "the policy setting the removal period and how the HR list reaches IT",
            ("Access policy (removal period)", "One leaver's HR record and removal record"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected leaver's access was removed within the policy period.",
            "For each selected leaver, find the account in the application, the date access "
            "was disabled or removed from the system's record, and compare it with the HR "
            "termination date and the policy period.",
            ("HR termination record", "System record of the removal with its date"),
            ("ac02-removed", "ac02-timely"),
        ),
        _p(
            "o-2",
            "OPERATING",
            "For a leaver removed late, assess what the access allowed in the gap.",
            "Only when access was removed late: inspect activity on the account after the "
            "termination date. This informs the deviation's effect; it is not a control "
            "attribute.",
            ("Account activity log after the termination date",),
            (),
            "Absence of activity reduces the effect of a deviation; it does not cure it.",
        ),
        _roll_sampled("terminations", ("ac02-removed", "ac02-timely")),
    ),
    attributes=(
        _a(
            "ac02-removed",
            "The leaver's access to the application was disabled or removed, as shown by the "
            "system's own record of the change",
            condition="The system shows the account disabled or removed.",
            why="Removal is the control.",
            evidence=("System audit record or user change log showing the removal",),
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
        _a(
            "ac02-timely",
            "Access was removed within [the number of days in the access policy] of the HR "
            "termination date",
            condition="Removal date minus termination date is within the policy period.",
            why="The control promises removal within a set period; the period is not in the "
            "control description.",
            evidence=("Access policy", "HR termination date", "System removal date"),
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
    ),
    retired=(
        Retired(
            "The account shows no activity after the termination date",
            "Not part of the control as described (removing access). It assesses the effect "
            "of a late removal, so it is now procedure o-2, performed only on a deviation.",
        ),
    ),
)

ACCESS_REVIEW = Definition(
    library_key="access-review",
    control_ref="ITGC-AC-03",
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
    procedures=(
        _design(
            "a quarterly review",
            "the access review procedure: who reviews which application, the timetable, and "
            "how removals are tracked",
            ("Access review procedure", "One completed review with its listing and tickets"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected review covered every account and was performed "
            "by the designated owner.",
            "For each selected quarter, agree the user listing the reviewer used to the "
            "system's user list at the time (record count and sample of users both ways), "
            "and compare the reviewer with the designated owner.",
            ("Review sign-off", "User listing and how it was produced", "System user list"),
            ("ac03-listing", "ac03-reviewer"),
        ),
        _p(
            "o-2",
            "OPERATING",
            "Determine whether the changes the reviewer asked for were made.",
            "For each removal or change the selected review requested, find the change in "
            "the system and its date.",
            ("Review decisions", "Tickets and system records of the changes"),
            ("ac03-actioned", "ac03-deadline", "ac03-investigated"),
        ),
        _roll_sampled("quarterly reviews", ("ac03-listing", "ac03-reviewer", "ac03-actioned")),
    ),
    attributes=(
        _a(
            "ac03-listing",
            "The user listing the reviewer used was complete and accurate: it agrees to the "
            "system's user list at the time it was produced",
            condition="Every account in the system at the extract date is on the listing, with "
            "its roles as in the system.",
            why="A review of an incomplete listing cannot find access that is not on it.",
            evidence=(
                "Listing as reviewed",
                "Report parameters and record count",
                "System user list for the same date",
            ),  # fmt: skip
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
        _a(
            "ac03-reviewer",
            "The review was signed off by the designated application owner, who did not "
            "approve their own access",
            condition="The signer is the owner designated for the application, and their own "
            "account was reviewed by someone else.",
            why="The control description assigns the review to application owners; reviewing "
            "one's own access is not an independent review.",
            evidence=("Review sign-off", "List of designated owners"),
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
        _a(
            "ac03-actioned",
            "Every removal or change the reviewer requested was made in the system",
            condition="Each requested change appears in the system.",
            why="The control description includes making the requested changes.",
            evidence=("Review decisions", "Tickets", "System change records"),
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
        _a(
            "ac03-deadline",
            "The review was completed, and its changes made, by [the deadline in the access "
            "review procedure]",
            condition="Sign-off and changes are within the procedure's deadline.",
            why="A late review leaves inappropriate access in place longer than designed.",
            evidence=("Review procedure", "Sign-off date", "Change dates"),
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
        _a(
            "ac03-investigated",
            "Access the reviewer found inappropriate was investigated to determine whether "
            "unauthorized activity was performed with it",
            condition="Each removal for inappropriate access has an investigation of activity.",
            why="KPMG's example includes this attribute; the library's description of this "
            "control does not.",
            evidence=("Investigation records",),
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

ACCESS_PRIVILEGED = Definition(
    library_key="access-privileged",
    control_ref="ITGC-AC-04",
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
    procedures=(
        _design(
            "a quarterly approval",
            "the definition of privileged access and the approval procedure",
            ("Definition of privileged roles", "One approved quarterly list"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected quarter's complete privileged list was approved, "
            "with a decision per user.",
            "Agree the approved list to the system's privileged users at the time, and inspect "
            "the approval for a dated sign-off and a decision for each user.",
            ("Approved list", "System list of privileged users"),
            ("ac04-complete", "ac04-approved"),
        ),
        _roll_sampled("quarterly approvals", ("ac04-complete", "ac04-approved")),
    ),
    attributes=(
        _a(
            "ac04-complete",
            "The privileged access list management approved agrees to the system's privileged "
            "users at the time",
            condition="Every privileged account in the system is on the approved list.",
            why="Approval of an incomplete list leaves unapproved privileged access.",
            evidence=("Approved list", "System list of privileged roles and members"),
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
        _a(
            "ac04-approved",
            "Management signed the quarter's privileged access list, with a recorded decision "
            "for each user that their role needs the access",
            condition="A dated management sign-off and a keep or remove decision per user.",
            why="The description says the list is approved by management; whether a role "
            "needs access is management's judgment, which the tester confirms was exercised.",
            evidence=("Signed list with decisions",),
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

ACCESS_AUTHENTICATION = Definition(
    library_key="access-authentication",
    control_ref="ITGC-AC-05",
    objective="Authentication settings enforce the company security policy for every user "
    "in scope.",
    control_type="PREVENTIVE",
    performer="The system (configured setting)",
    reviewer="None described",
    trigger="Every sign-in",
    population="Not sampled: the configuration and its change history for the period.",
    sampling=sampling("ANNUAL", automated=True),
    procedures=(
        _design(
            "the authentication settings",
            "the security policy's required values and where each is configured",
            ("Security policy", "Configuration screens or export"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each configured value meets the policy and stayed in place.",
            "Compare each configured value with the policy value, and inspect the change "
            "history of the settings for the period.",
            ("Configuration export with system and date", "Change history of the settings"),
            ("ac05-values", "ac05-unchanged"),
        ),
        _roll_config("the authentication settings", ("ac05-values", "ac05-unchanged")),
    ),
    attributes=(
        _a(
            "ac05-values",
            "Each configured authentication value (password length and complexity, lockout, "
            "multi-factor enforcement and the accounts it covers) meets the security policy",
            condition="Every configured value is at least as strict as the policy value.",
            why="The control is the configuration meeting the policy.",
            evidence=("Security policy", "Configuration export with the system name and date"),
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
        _a(
            "ac05-unchanged",
            "The settings did not change during the period, or each change was approved under "
            "change management, as shown by the system's change history",
            condition="The change history shows no change, or each change has approval.",
            why="One point-in-time value does not show the setting held for the period; reliance "
            "rests on the change history and on change management.",
            evidence=("System change history for the settings",),
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
    ),
)

ACCESS_SHARED = Definition(
    library_key="access-shared-accounts",
    control_ref="ITGC-AC-06",
    objective="Every shared, generic, and service account has an accountable owner and cannot "
    "be used to sign in interactively unless approved.",
    control_type="PREVENTIVE",
    performer="The account owner and administrators",
    reviewer="Not described",
    trigger="The quarterly inventory",
    population="The account inventory for each quarter, agreed to the system's accounts.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "the inventory",
            "the procedure for inventorying shared and service accounts",
            ("Inventory procedure", "One quarter's inventory"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each account in the inventory has an owner and is restricted.",
            "Agree the inventory to the system's non-personal accounts, then for each account "
            "inspect the owner and the sign-in restriction or its approval.",
            ("Inventory", "System account list", "Sign-in restriction settings or approvals"),
            ("ac06-inventory", "ac06-owner", "ac06-interactive"),
        ),
        _roll_sampled(
            "quarterly inventories", ("ac06-inventory", "ac06-owner", "ac06-interactive")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "ac06-inventory",
            "The inventory includes every shared, generic, and service account in the system",
            condition="Every non-personal account in the system is on the inventory.",
            why="An account missing from the inventory has no owner and no restriction.",
            evidence=("Inventory", "System account list with account types"),
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
        _a(
            "ac06-owner",
            "Each shared or service account has a named, current owner",
            condition="A named person who is a current employee owns the account.",
            why="Ownership is how activity under the account is made accountable.",
            evidence=("Inventory with owners", "HR status of owners"),
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
        _a(
            "ac06-interactive",
            "Interactive sign-in is disabled for the account, or an approval for interactive "
            "use exists",
            condition="The setting disables interactive sign-in, or a documented approval "
            "covers it.",
            why="The description permits interactive use only with approval.",
            evidence=("Account sign-in settings", "Approvals for interactive use"),
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
    ),
    retired=(
        Retired(
            "Credentials are stored in an approved vault",
            "Not in the control description. Test it only if the client's control requires a "
            "vault, by adding it to the description.",
        ),
    ),
)

# Change management


CHANGE_APPROVAL = Definition(
    library_key="change-approval",
    control_ref="ITGC-CM-01",
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
    procedures=(
        _design(
            "a change",
            "the change management procedure: approvals, testing, and deployment",
            ("Change procedure", "One change's ticket, tests, approvals, deployment record"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected change was requested, tested, and approved "
            "before deployment, and is the change deployed.",
            "For each selected deployment, find the ticket, test evidence, and approvals; "
            "compare approval dates with the deployment date; compare the deployed object or "
            "version with the ticket.",
            ("Ticket", "Test results", "Approvals", "Deployment record"),
            ("cm01-request", "cm01-tested", "cm01-approved", "cm01-matches"),
        ),
        _roll_sampled(
            "production changes", ("cm01-request", "cm01-tested", "cm01-approved", "cm01-matches")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "cm01-request",
            "A change request exists for the deployed change",
            condition="A ticket describes this change.",
            why="The description starts the control with a request.",
            evidence=("Change ticket",),
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
        _a(
            "cm01-tested",
            "The change was tested before deployment, with the test results documented",
            condition="Test evidence dated before deployment.",
            why="The description requires testing.",
            evidence=("Test results",),
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
        _a(
            "cm01-approved",
            "The business owner and the IT owner approved the change before it was deployed "
            "to production",
            condition="Both approvals dated before the deployment.",
            why="The description requires approval by business and IT owners before production.",
            evidence=("Approvals with dates", "Deployment record"),
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
        _a(
            "cm01-matches",
            "The object or version deployed is the one in the approved change request",
            condition="The deployment record's object or version equals the ticket's.",
            why="Approval covers what was approved, not something else deployed with it.",
            evidence=("Deployment record", "Ticket"),
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

CHANGE_EMERGENCY = Definition(
    library_key="change-emergency",
    control_ref="ITGC-CM-02",
    objective="Emergency changes are approved after the fact within the agreed time.",
    control_type="DETECTIVE",
    performer="The change implementer",
    reviewer="The approver of the retrospective review",
    trigger="An emergency change",
    population="Every change marked emergency in the period, with completeness support for "
    "how emergency changes are identified.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "an emergency change",
            "the emergency change procedure, its criteria, and its approval period",
            ("Emergency change procedure", "One emergency change"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected emergency change met the criteria and was "
            "approved within the period.",
            "Compare the change with the emergency criteria, and the retrospective approval "
            "date with the deployment date and the agreed period.",
            ("Ticket", "Retrospective approval", "Deployment record"),
            ("cm02-classified", "cm02-reviewed", "cm02-approved"),
        ),
        _roll_sampled("emergency changes", ("cm02-reviewed", "cm02-approved")),
    ),
    attributes=(
        _a(
            "cm02-classified",
            "The change met the procedure's criteria for an emergency change",
            condition="The ticket documents a reason that meets the written criteria.",
            why="A change wrongly treated as an emergency skips pre-approval.",
            evidence=("Criteria", "Ticket's stated reason"),
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
        _a(
            "cm02-reviewed",
            "The emergency change was reviewed and approved after deployment by an approver "
            "the emergency change procedure names",
            condition="A retrospective approval exists, by a named approver, after deployment.",
            why="The description requires emergency changes to be reviewed and approved after "
            "deployment.",
            evidence=("Retrospective approval", "Procedure's approvers"),
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
        _a(
            "cm02-approved",
            "The retrospective approval was given within [the number of days in the "
            "emergency change procedure] of deployment",
            condition="Approval date minus deployment date is within the agreed period.",
            why="The description requires approval within the agreed days.",
            evidence=("Approval", "Deployment record", "Procedure"),
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

CHANGE_SEGREGATION = Definition(
    library_key="change-segregation",
    control_ref="ITGC-CM-03",
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
    procedures=(
        _design(
            "the deployment access restriction",
            "who develops, who deploys, and how deployment access is granted",
            ("Developer list", "Deployer list", "Deployment access procedure"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether any developer could deploy to production at the dates tested.",
            "Obtain the complete developer list and the system's list of accounts with "
            "deployment rights at each date tested, and compare them.",
            ("Developer list", "System list of deployment rights"),
            ("cm03-separate", "cm03-authorized"),
            "Shows access at the dates tested only, unless the access change history covers "
            "the period.",
        ),
        _roll_sampled("dates tested", ("cm03-separate", "cm03-authorized")),
    ),
    attributes=(
        _a(
            "cm03-separate",
            "No account on the developer list has production deployment rights in the system",
            condition="The intersection of developers and deployers is empty.",
            why="This is the restriction the control describes.",
            evidence=("Complete developer list", "System list of deployment rights"),
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
        _a(
            "cm03-authorized",
            "Every account with deployment rights is on the approved list of the deployment group",
            condition="Each deployer is on the approved group list.",
            why="The description limits deployment to a separate, authorized group.",
            evidence=("Approved group list", "System deployers"),
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
    ),
)

CHANGE_CONFIGURATION = Definition(
    library_key="change-configuration",
    control_ref="ITGC-CM-04",
    objective="Changes to configuration that affects financial processing are requested, "
    "approved, and logged.",
    control_type="PREVENTIVE",
    performer="The person who changes the configuration",
    reviewer="The approver",
    trigger="A configuration change",
    population="Every change to in-scope configuration in the period, from the configuration "
    "change log, with completeness support.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a configuration change",
            "which configuration affects financial processing, and the change procedure",
            ("List of in-scope configuration", "Change procedure"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected configuration change was requested and approved, "
            "and logged as approved.",
            "For each logged change, find its request and approval and compare them with the "
            "log entry.",
            ("Configuration change log", "Request and approval"),
            ("cm04-request", "cm04-approval", "cm04-matches", "cm04-before"),
        ),
        _roll_sampled(
            "configuration changes", ("cm04-request", "cm04-approval", "cm04-matches")
        ),  # fmt: skip
    ),
    attributes=(
        _a(
            "cm04-request",
            "A request exists for the logged configuration change",
            condition="A request describes this change.",
            why="The description requires a request.",
            evidence=("Request",),
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
        _a(
            "cm04-approval",
            "The configuration change was approved by an authorized approver",
            condition="An approval by an authorized person.",
            why="The description requires approval.",
            evidence=("Approval", "List of authorized approvers"),
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
        _a(
            "cm04-matches",
            "The change in the configuration log is the change that was approved",
            condition="Object, old and new values in the log equal the approved change.",
            why="Approval covers only the change approved.",
            evidence=("Log entry", "Approved request"),
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
        _a(
            "cm04-before",
            "The approval is dated before the configuration change was made",
            condition="Approval date before the log date.",
            why="The description does not state the order; a preventive control would "
            "require approval first.",
            evidence=("Approval", "Log entry"),
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

CHANGE_DATA = Definition(
    library_key="change-data",
    control_ref="ITGC-CM-05",
    objective="Direct changes to production data are approved by the data owner and made "
    "by authorized staff.",
    control_type="PREVENTIVE",
    performer="Authorized staff who make the change",
    reviewer="The data owner who approves",
    trigger="A direct data change",
    population="Every direct data change in the period from the change log. Changes made "
    "outside the log cannot be found by sampling the log.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a data change",
            "the data change procedure, data owners, and authorized staff",
            ("Procedure", "Data owner list", "Authorized staff list"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected data change was approved by the data owner and "
            "made by authorized staff.",
            "For each logged change, inspect the request and data owner approval, and compare "
            "the person who made the change with the authorized staff list.",
            ("Change log", "Request and approval", "Authorized staff list"),
            ("cm05-approved", "cm05-performer"),
            "The log is the population: a change made without logging is outside this test.",
        ),
        _roll_sampled("direct data changes", ("cm05-approved", "cm05-performer")),
    ),
    attributes=(
        _a(
            "cm05-approved",
            "A request exists and the data owner approved the data change",
            condition="A request and an approval by the designated data owner.",
            why="The description requires data owner approval.",
            evidence=("Request", "Approval", "Data owner list"),
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
        _a(
            "cm05-performer",
            "The person who made the data change is on the list of authorized staff",
            condition="The performer in the log is authorized.",
            why="The description requires authorized staff.",
            evidence=("Log entry", "Authorized staff list"),
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
    ),
    retired=(
        Retired(
            "The change was logged",
            "The log is the population the sample is drawn from, so every sampled change is "
            "logged; the attribute could not fail. The limitation is stated on the procedure.",
        ),
    ),
)

# IT operations


OPERATIONS_JOBS = Definition(
    library_key="operations-jobs",
    control_ref="ITGC-OP-01",
    objective="Failures of financially relevant scheduled jobs are identified and resolved.",
    control_type="DETECTIVE",
    performer="The operations team who monitor jobs",
    reviewer="Not described",
    trigger="Each day's job runs",
    population="The days in the period; for each selected day, the job log of financially "
    "relevant jobs, with its completeness support.",
    sampling=sampling("DAILY"),
    procedures=(
        _design(
            "a job failure",
            "the list of financially relevant jobs and the monitoring procedure",
            ("Job schedule", "Monitoring procedure"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each failure on the selected days was identified and resolved.",
            "From the job log for each selected day, list the failures, and find each one's "
            "monitoring record and resolution.",
            ("Job log", "Monitoring records", "Resolution tickets"),
            ("op01-identified", "op01-resolved"),
        ),
        _roll_sampled("days", ("op01-identified", "op01-resolved")),
    ),
    attributes=(
        _a(
            "op01-identified",
            "Every failure of a financially relevant job on the selected day has a monitoring "
            "record",
            condition="Each failure in the job log has a ticket or monitoring entry.",
            why="Monitoring that misses failures does not detect them.",
            evidence=("Job log for the day", "Monitoring records"),
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
        _a(
            "op01-resolved",
            "Each failure was investigated and resolved, with the resolution documented",
            condition="Each record shows investigation and a resolution.",
            why="The description requires failures to be resolved to completion.",
            evidence=("Tickets",),
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
    ),
    retired=(
        Retired(
            "Resolution was documented",
            "Merged into op01-resolved; testing it separately duplicated the evidence.",
            "op01-resolved",
        ),
    ),
)

OPERATIONS_SCHEDULE = Definition(
    library_key="operations-scheduling",
    control_ref="ITGC-OP-02",
    objective="Changes to the job schedule are approved before they are made.",
    control_type="PREVENTIVE",
    performer="The scheduler administrator",
    reviewer="The approver of schedule changes",
    trigger="A change to the job schedule",
    population="Every change to the schedule of jobs that process financial data in the "
    "period, from the scheduler's own change log.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a schedule change",
            "how schedule changes are requested and approved",
            ("Change procedure", "One schedule change and its approval"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected schedule change was approved before it was made.",
            "For each selected change in the scheduler log, inspect its approval and compare "
            "the approval date with the change date.",
            ("Scheduler change log", "Approvals"),
            ("op02-approved",),
        ),
        _roll_sampled("schedule changes", ("op02-approved",)),
    ),
    attributes=(
        _a(
            "op02-approved",
            "Each schedule change was approved by an authorized approver before it was made",
            condition="An approval exists for the change, dated on or before the change.",
            why="The control requires approval before a schedule change.",
            evidence=("Approval", "Scheduler change log"),
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

OPERATIONS_SCHEDULER_ACCESS = Definition(
    library_key="operations-scheduler-access",
    control_ref="ITGC-OP-02.1",
    objective="Only people whose role needs it can change the job schedule.",
    control_type="DETECTIVE",
    performer="The control owner for IT operations",
    reviewer="None: the review is the control",
    trigger="Each quarter",
    population="The quarterly reviews in the period, each with the listing of users able to "
    "change the schedule.",
    sampling=sampling("QUARTERLY"),
    procedures=(
        _design(
            "a quarterly scheduler access review",
            "who can change the schedule and how the listing is produced",
            ("Scheduler user listing", "One review"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected quarter's review covered every user able to "
            "change the schedule and removed access no longer needed.",
            "Agree the listing to the scheduler at its production date; inspect the sign-off "
            "and the removal records.",
            ("Scheduler user listing with its date", "Sign-off", "Removal records"),
            ("op021-complete", "op021-access"),
        ),
        _roll_sampled("quarterly reviews", ("op021-complete", "op021-access")),
    ),
    attributes=(
        _a(
            "op021-complete",
            "The listing the reviewer used includes every user able to change the job "
            "schedule at its production date",
            condition="The listing agrees to the scheduler's own user list at that date.",
            why="A review of an incomplete listing cannot find access that is not on it "
            "(AS 1105.10).",
            evidence=("Listing with its production date", "Scheduler user list"),
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
        _a(
            "op021-access",
            "Every user able to change the job schedule was confirmed by the reviewer, or "
            "their access was removed",
            condition="Each user has a recorded decision; removals are recorded.",
            why="The control limits who can change batch processing.",
            evidence=("Signed listing", "Removal records"),
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

OPERATIONS_BACKUP = Definition(
    library_key="operations-backup",
    control_ref="ITGC-OP-03",
    objective="Financial data is backed up on the schedule and retention the policy requires.",
    control_type="PREVENTIVE",
    performer="The backup tool",
    reviewer="None: the configuration is the control",
    trigger="Each scheduled backup",
    population="The backup configuration for the in-scope system, and its changes in the period.",
    sampling=sampling("DAILY", automated=True),
    procedures=(
        _design(
            "the backup configuration",
            "the backup policy and how the configuration enforces it",
            ("Backup policy", "Backup configuration"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether the backup configuration covers the financial data on the "
            "required schedule and retention for the period.",
            "Inspect the configuration as shown from the tool and its change history; inspect "
            "the job history for one day to see it operated.",
            ("Backup configuration with a date", "Configuration change history", "Job history"),
            ("op03-config", "op03-ran"),
        ),
        _roll_config("backup configuration", ("op03-config",)),
    ),
    attributes=(
        _a(
            "op03-config",
            "The backup tool is configured to back up the system's financial data on the "
            "schedule and retention the policy requires",
            condition="Scope, schedule, and retention in the configuration.",
            why="The control is the configured backup.",
            evidence=("Configuration shown from the tool, dated", "Backup policy"),
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
        _a(
            "op03-ran",
            "Scheduled backups of financial data ran on the day examined",
            condition="The job history for the day shows each scheduled job.",
            why="Shows the configured control operated.",
            evidence=("Backup job history",),
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
    ),
    retired=(
        Retired(
            "A restore test succeeded during the period",
            "Moved to ITGC-OP-03.2, the annual restore test (milestone 8.9).",
            "op032-restore",
        ),
    ),
)

OPERATIONS_BACKUP_FAILURES = Definition(
    library_key="operations-backup-failures",
    control_ref="ITGC-OP-03.1",
    objective="Failed backups are found and resolved promptly.",
    control_type="DETECTIVE",
    performer="The team that monitors backups",
    reviewer="None",
    trigger="Each day's backup results",
    population="Every failed backup in the period, from the backup tool's job history.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "a failed backup",
            "how failures are reported, followed up, and recorded",
            ("Backup job history", "One failure and its resolution"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected failure was resolved within the time allowed.",
            "For each selected failure, inspect its resolution record and compare the "
            "resolution date with the failure date.",
            ("Job history", "Resolution records"),
            ("op031-resolved",),
        ),
        _roll_sampled("failed backups", ("op031-resolved",)),
    ),
    attributes=(
        _a(
            "op031-resolved",
            "The failed backup was rerun successfully or otherwise resolved within "
            "[the time allowed to resolve a failed backup], with the resolution recorded",
            condition="A resolution record dated within the time allowed.",
            why="An unresolved failure leaves data unrecoverable.",
            evidence=("Job history", "Resolution record"),
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

OPERATIONS_RESTORE = Definition(
    library_key="operations-restore-test",
    control_ref="ITGC-OP-03.2",
    objective="Backups of financial data can be restored.",
    control_type="DETECTIVE",
    performer="The team that performs restore tests",
    reviewer="The reviewer of restore tests",
    trigger="The annual restore test",
    population="The restore tests performed in the period.",
    sampling=sampling("ANNUAL"),
    procedures=(
        _design(
            "a restore test",
            "how a restore test is performed and judged complete",
            ("Restore test procedure",),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether a restore of financial data was tested successfully and "
            "signed off in the period.",
            "Inspect the restore test record: the backup used, the data restored, the checks "
            "performed, the result, and the sign-off.",
            ("Restore test record",),
            ("op032-restore",),
        ),
    ),
    attributes=(
        _a(
            "op032-restore",
            "A restore of the system's financial data was tested in the period, its result "
            "checked against the source, and the result signed off",
            condition="A dated restore test of financial data, with checks and sign-off.",
            why="Backups that cannot be restored do not protect the data.",
            evidence=("Restore test record",),
            extract=("Date", "Data restored", "Checks", "Result", "Sign-off"),
            compare="Test date against the period; checks and result.",
            passes="A successful, checked, signed-off test in the period.",
            fails="No test, a failed test, or no sign-off.",
            insufficient="The record does not show what was restored or checked.",
            review="Whether the data restored is the financial data.",
            not_infer="A backup's success is not a restore test.",
            basis=("DESIGN",),
            confidence="HIGH",
            was="A restore test succeeded during the period",
        ),
    ),
)

OPERATIONS_INCIDENTS = Definition(
    library_key="operations-incidents",
    control_ref="ITGC-OP-04",
    objective="Incidents affecting financial systems are tracked to resolution.",
    control_type="DETECTIVE",
    performer="IT support",
    reviewer="Not described",
    trigger="An incident",
    population="Incidents for financial systems in the period from the incident log.",
    sampling=sampling("EVENT_DRIVEN"),
    procedures=(
        _design(
            "an incident",
            "the incident procedure, priorities, and the definition of a major incident",
            ("Incident procedure",),
        ),
        _p(
            "o-1",
            "OPERATING",
            "Determine whether each selected incident was prioritized, resolved, and, if "
            "major, has a recorded root cause.",
            "Inspect each selected ticket for its priority, resolution, and root cause.",
            ("Incident tickets",),
            ("op04-priority", "op04-resolved", "op04-root-cause"),
        ),
        _roll_sampled("incidents", ("op04-priority", "op04-resolved")),
    ),
    attributes=(
        _a(
            "op04-priority",
            "The incident was logged with a priority under the incident procedure's criteria",
            condition="A priority consistent with the criteria.",
            why="The description requires logging and prioritizing.",
            evidence=("Ticket", "Priority criteria"),
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
        _a(
            "op04-resolved",
            "The incident was resolved and closed with the resolution recorded",
            condition="A resolution and closure.",
            why="The description requires tracking to resolution.",
            evidence=("Ticket",),
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
        _a(
            "op04-root-cause",
            "For a major incident, the root cause was recorded",
            condition="A major incident has a recorded root cause.",
            why="The description requires root cause for major incidents.",
            evidence=("Ticket", "Definition of major"),
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

OPERATIONS_DATACENTER = Definition(
    library_key="operations-physical",
    control_ref="ITGC-OP-05",
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
    procedures=(
        _design(
            "the access review",
            "who may enter the data center and how access is granted and reviewed",
            ("Access procedure", "Access list"),
        ),
        _p(
            "o-1",
            "OPERATING",
            "For an owned data center, determine whether everyone with access is authorized.",
            "Compare the access list with authorized personnel and the review sign-off.",
            ("Access list", "Authorized personnel", "Review sign-off"),
            ("op05-authorized",),
        ),
        _p(
            "o-2",
            "OPERATING",
            "For a hosted system, determine whether the provider's SOC 1 report covers "
            "physical access for the period.",
            "Inspect the report's period, the controls in scope, the opinion, exceptions, and "
            "complementary user entity controls, and the bridge letter for any gap.",
            ("SOC 1 report", "Bridge letter"),
            ("op05-soc",),
        ),
        _roll_sampled("access reviews", ("op05-authorized",)),
    ),
    attributes=(
        _a(
            "op05-authorized",
            "Everyone on the data center access list is an authorized person whose job needs "
            "physical access",
            condition="Each person on the list is authorized.",
            why="The description restricts physical access.",
            evidence=("Access list", "Authorization records"),
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
        _a(
            "op05-soc",
            "For a hosted system, the provider's SOC 1 report covers physical access for the "
            "period, with an unqualified opinion on it, and a bridge letter covers any gap",
            condition="Report period, scope, opinion, and bridge letter cover the period.",
            why="For a hosted system the provider operates the control.",
            evidence=("SOC 1 report", "Bridge letter"),
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
    ACCESS_PROVISIONING,
    ACCESS_TERMINATION,
    ACCESS_REVIEW,
    ACCESS_PRIVILEGED,
    ACCESS_AUTHENTICATION,
    ACCESS_SHARED,
    CHANGE_APPROVAL,
    CHANGE_EMERGENCY,
    CHANGE_SEGREGATION,
    CHANGE_CONFIGURATION,
    CHANGE_DATA,
    OPERATIONS_JOBS,
    OPERATIONS_SCHEDULE,
    OPERATIONS_SCHEDULER_ACCESS,
    OPERATIONS_BACKUP,
    OPERATIONS_BACKUP_FAILURES,
    OPERATIONS_RESTORE,
    OPERATIONS_INCIDENTS,
    OPERATIONS_DATACENTER,
    ENTITY_CODE,
    ENTITY_WHISTLEBLOWER,
    APP_THREE_WAY,
    APP_CREDIT,
    REPORT_AR_AGING,
    REPORT_JOURNALS,
)
