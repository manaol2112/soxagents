"""Common answers for the client values a control's statement asks for (milestone L3d).

A client value is the client's fact: who approves, which tool, how many days the policy
allows. The library cannot know it, but for most values the answer is one of a few that
auditors meet again and again: an access request is approved by the user's line manager,
the role owner, or the business process owner; changes are ticketed in ServiceNow or Jira.
Each value offers those as suggestions, so the team picks one instead of typing it, and
still types the client's own answer when it differs.

A suggestion is never recorded by itself: a person chooses it and saves it, as the
client's value. Amounts, tolerances, and lists only the client's documents set (the
interfaces in scope, the ruleset) offer none: a threshold depends on the client's
materiality, and a guessed list would read as the client's.
"""

from ai_workforce_api.control_statements import Slot

MAX_OPTIONS = 6

# Roles, by the area a value belongs to: who owns, reviews, or approves the control, and
# who prepares or maintains what it covers.
_SENIOR: dict[str, tuple[str, ...]] = {
    "finance": ("Controller", "Assistant Controller", "Accounting Manager", "CFO"),
    "consolidation": ("Group Financial Controller", "Controller", "CFO"),
    "payables": ("AP Manager", "AP Supervisor", "Controller"),
    "receivables": ("AR Manager", "Credit Manager", "Revenue Controller", "Controller"),
    "revenue": ("Revenue Controller", "Controller", "Sales Operations Manager"),
    "treasury": ("Treasurer", "Treasury Manager", "CFO"),
    "tax": ("Tax Director", "Tax Manager", "CFO"),
    "payroll": ("Payroll Manager", "HR Director", "Controller"),
    "assets": ("Controller", "Accounting Manager", "Fixed Asset Manager"),
    "inventory": ("Plant Controller", "Cost Accounting Manager", "Controller"),
    "procurement": ("Procurement Manager", "Head of Procure to Pay", "AP Manager"),
    "compliance": ("Chief Compliance Officer", "General Counsel", "Head of Internal Audit"),
    "access": ("IT Security Manager", "Identity and Access Management Lead", "IT Director"),
    "change": ("IT Applications Manager", "Change Manager", "IT Director"),
    "operations": ("IT Operations Manager", "Infrastructure Manager", "Head of IT"),
    "security": ("Chief Information Security Officer", "IT Security Manager", "Head of IT"),
}
_STAFF: dict[str, tuple[str, ...]] = {
    "finance": ("General ledger accountant", "Senior accountant", "Financial analyst"),
    "consolidation": ("Group reporting accountant", "Consolidation analyst"),
    "payables": ("AP specialist", "AP accountant"),
    "receivables": ("AR specialist", "Cash application specialist", "Credit analyst"),
    "revenue": ("Revenue accountant", "Billing specialist"),
    "treasury": ("Treasury analyst", "Cash manager"),
    "tax": ("Tax accountant", "Tax analyst"),
    "payroll": ("Payroll specialist", "Payroll accountant"),
    "assets": ("Fixed asset accountant", "Staff accountant"),
    "inventory": ("Cost accountant", "Inventory controller", "Warehouse supervisor"),
    "procurement": ("Procurement specialist", "Buyer"),
    "compliance": ("Compliance analyst", "Internal audit analyst"),
    "access": ("IT service desk", "Identity and access management team"),
    "change": ("Application developer", "Release manager"),
    "operations": ("IT operations team", "System administrator"),
    "security": ("Security operations", "Security analyst"),
}
# Who maintains master data, by area.
_MAINTAINERS: tuple[str, ...] = ("Master data team", "Shared services team")

# The area of each value, by the prefix of its key.
_AREA_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("indirect-tax", "tax"),
    ("tax", "tax"),
    ("consol", "consolidation"),
    ("payroll", "payroll"),
    ("pay-", "payroll"),
    ("ap-", "payables"),
    ("dup-", "payables"),
    ("release-role", "payables"),
    ("nonpo", "payables"),
    ("payment", "treasury"),
    ("bank", "treasury"),
    ("debt", "treasury"),
    ("covenant", "treasury"),
    ("signatory", "treasury"),
    ("ar-", "receivables"),
    ("cash", "receivables"),
    ("credit", "receivables"),
    ("customer", "receivables"),
    ("memo", "receivables"),
    ("cutoff", "revenue"),
    ("revenue", "revenue"),
    ("rev-", "revenue"),
    ("pricing", "revenue"),
    ("fa-", "assets"),
    ("depreciation", "assets"),
    ("disposal", "assets"),
    ("impairment", "assets"),
    ("inv-", "inventory"),
    ("count", "inventory"),
    ("cost", "inventory"),
    ("reserve", "inventory"),
    ("vendor", "procurement"),
    ("po-", "procurement"),
    ("ptp", "procurement"),
    ("conduct", "compliance"),
    ("investigator", "compliance"),
    ("wb-", "compliance"),
    ("access", "access"),
    ("admin-role", "access"),
    ("account-reviewer", "access"),
    ("review-owner", "access"),
    ("privileged", "access"),
    ("sponsor", "access"),
    ("infra-", "access"),
    ("data-admin", "access"),
    ("ff-", "access"),
    ("deploy", "access"),
    ("facilities", "access"),
    ("sod", "access"),
    ("change", "change"),
    ("it-approver", "change"),
    ("emergency", "change"),
    ("config", "change"),
    ("patch", "change"),
    ("go-live", "change"),
    ("schedule", "operations"),
    ("ops", "operations"),
    ("restore", "operations"),
    ("interface", "operations"),
    ("vuln", "security"),
    ("risk-acceptor", "security"),
    ("soc-", "security"),
    ("euc", "finance"),
    ("je-", "finance"),
    ("accrual", "finance"),
    ("recon", "finance"),
    ("flux", "finance"),
    ("gl-", "finance"),
)

# Values whose common answers are particular to them, ahead of their area's.
_EXPLICIT: dict[str, tuple[str, ...]] = {
    # Access
    "admin-role": (
        "IT service desk",
        "Identity and access management team",
        "Application security administrator",
        "System administrator",
    ),
    "review-owner": ("Application owner", "Line manager", "Business process owner"),
    "account-reviewer": ("IT Security Analyst", "Application owner", "System owner"),
    "sponsor-reviewer": ("IT Security Analyst", "Vendor relationship owner", "Line manager"),
    "privileged-reviewer": ("Head of IT", "IT Director", "Chief Information Security Officer"),
    "infra-reviewer": ("Head of Infrastructure", "IT Director", "IT Security Manager"),
    "infra-admin-role": ("Database and platform administrators", "Infrastructure team"),
    "data-admin": ("Database administrator", "Application support team"),
    "ff-approver": ("IT Security Manager", "Business process owner", "Line manager"),
    "ff-reviewer": ("IT Controls Manager", "Business process owner", "IT Security Manager"),
    "deploy-reviewer": ("IT Applications Manager", "Change Manager", "IT Security Manager"),
    "facilities-reviewer": ("Facilities manager", "Data center manager", "IT Security Manager"),
    "sod-reviewer": ("Business Controls Manager", "Business process owner", "Controller"),
    # Change
    "it-approver": (
        "Change Advisory Board (CAB)",
        "IT Applications Manager",
        "Change Manager",
        "IT Director",
    ),
    "emergency-approver": ("IT Director", "Emergency CAB", "Change Manager"),
    "config-approver": ("Finance systems lead", "Business process owner", "Controller"),
    "patch-approver": ("Infrastructure Change Manager", "Change Advisory Board (CAB)"),
    "go-live-approver": ("IT Steering Committee", "Business process owner", "Project sponsor"),
    "migration-approver": ("Corporate Controller", "Business process owner", "Project sponsor"),
    "schedule-approver": ("IT Operations Manager", "Change Advisory Board (CAB)"),
    # Operations and security
    "ops-role": ("IT operations", "Service desk", "Managed service provider"),
    "restore-reviewer": ("Application owner", "IT Operations Manager", "Backup administrator"),
    "interface-owner": ("Integration support", "Application support team", "IT Operations"),
    "vuln-owner": ("Security Engineering Lead", "IT Security Manager", "Infrastructure Manager"),
    "soc-role": ("Security operations", "Managed security service provider"),
    "soc-reviewer": ("IT Compliance Manager", "Vendor management", "IT Security Manager"),
    "risk-acceptor": ("Chief Information Security Officer", "IT Director", "Risk committee"),
    # Oversight
    "conduct-oversight": ("Audit committee", "Board of directors"),
    "covenant-escalation": ("Audit committee", "CFO", "Board of directors"),
    "wb-oversight": ("Audit committee", "Board of directors"),
    "investigator": ("Head of Internal Audit", "General Counsel", "Chief Compliance Officer"),
    "euc-owner": ("The preparer of the control the spreadsheet feeds", "Controller"),
    "count-team": ("Finance and warehouse staff", "Warehouse team", "Third-party counters"),
    "disposal-approver": ("Plant manager", "Controller", "Fixed Asset Manager"),
    "pricing-approver": ("Sales Director", "Pricing committee", "Revenue Controller"),
    "credit-release-role": ("Credit manager", "AR Manager"),
    "release-role": ("AP supervisor", "AP Manager"),
    "reopen-role": ("GL Manager", "Controller"),
    "je-approver": ("Assistant Controller", "Controller", "Accounting Manager"),
    "payroll-approver": ("HR Business Partner", "Payroll Manager", "HR Director"),
    # Systems: the tools usually used for the job.
    "access-tool": ("ServiceNow", "SailPoint", "Saviynt", "Jira Service Management"),
    "change-tool": ("ServiceNow", "Jira Service Management", "BMC Remedy", "Azure DevOps"),
    "incident-tool": ("ServiceNow", "Jira Service Management", "BMC Remedy"),
    "scheduler": ("Control-M", "Redwood RunMyJobs", "AutoSys", "SAP job scheduling (SM36)"),
    "backup-tool": ("Veeam", "Commvault", "Azure Backup", "AWS Backup"),
    "siem-tool": ("Microsoft Sentinel", "Splunk", "IBM QRadar"),
    "scan-tool": ("Qualys", "Tenable", "Rapid7"),
    "sod-tool": ("SAP GRC Access Risk Analysis", "Pathlock", "SafePaaS"),
    "ff-tool": ("SAP GRC Firefighter", "CyberArk", "BeyondTrust"),
    "interface-tool": ("SAP PI/PO", "MuleSoft", "Boomi", "Azure Integration Services"),
    "consol-tool": ("OneStream", "Oracle FCCS", "SAP Group Reporting"),
    "hr-system": ("Workday", "SAP SuccessFactors", "Oracle HCM Cloud", "ADP"),
    "ack-tool": ("Workday Learning", "The learning management system", "DocuSign"),
    "euc-location": ("SharePoint finance library", "A restricted network drive"),
    "bank-portal": ("The bank's online portal", "Kyriba", "SWIFT"),
    # Days and deadlines: the usual policy choices.
    "removal-days": ("1 business day", "3 business days", "5 business days"),
    "transfer-days": ("5 business days", "10 business days", "30 days"),
    "emergency-days": ("1 business day", "2 business days", "5 business days"),
    "ff-review-days": ("1 business day", "2 business days", "5 business days"),
    "backup-fix-days": ("1 business day", "2 business days"),
    "vuln-sla": (
        "30 days for critical, 90 days for high",
        "15 days for critical, 30 days for high",
    ),
    "cash-age": ("30 days", "60 days", "90 days"),
    "accrual-window": ("15 days", "30 days", "45 days"),
    "cutoff-window": ("3 business days", "5 business days", "10 business days"),
    "bank-deadline": ("5 business days after month end", "10 business days after month end"),
    "recon-deadline": ("10 business days after month end", "15 business days after month end"),
    "payroll-recon-deadline": (
        "10 business days after month end",
        "15 business days after month end",
    ),
    "review-deadline": ("30 days after quarter end", "45 days after quarter end"),
    "ack-deadline": ("31 March", "within 30 days of joining", "by year end"),
    "indirect-tax-deadline": (
        "before the filing deadline",
        "10 business days after period end",
    ),
    "retention": ("30 days", "35 days", "90 days"),
    "feed-frequency": ("daily", "in real time", "weekly"),
    "backup-frequency": ("daily", "daily incremental and weekly full"),
    "major-priority": ("priority 1 or 2", "priority 1"),
    # Policies and procedures, by their usual names.
    "security-policy": ("Information Security Policy", "IT Security Standard"),
    "access-policy": ("Access Management Standard", "Information Security Policy"),
    "incident-procedure": ("IT Incident Procedure", "Incident Management Policy"),
    "doa": ("the Delegation of Authority policy", "the approval matrix"),
    "hotline": ("EthicsPoint hotline", "NAVEX", "An external ethics hotline"),
    "tax-advisor": ("none", "the external tax advisor"),
}

# The system values that name one of the engagement's own systems.
_OWN_SYSTEM = frozenset({"system", "erp", "source-system"})
# Kinds whose answer only the client's documents set: no suggestion stands in for them.
_NO_SUGGESTION = frozenset({"AMOUNT", "PERCENT", "REPORT"})


def area_of(key: str) -> str | None:
    return next((area for prefix, area in _AREA_BY_PREFIX if key.startswith(prefix)), None)


def options_for(slot: Slot, systems: tuple[str, ...] = ()) -> list[str]:
    """The common answers to offer for a value: the library's own example (not for free
    text), the answers particular to the value, then those of its area; for a system, the
    engagement's own systems, or those of them that are a usual tool for the job. At most
    MAX_OPTIONS, none repeated."""
    if slot.kind in _NO_SUGGESTION:
        return []
    found: list[str] = []
    common = _EXPLICIT.get(slot.key, ())
    if slot.kind == "SYSTEM" and slot.key in _OWN_SYSTEM:
        found.extend(systems)
    elif slot.kind == "SYSTEM":
        # One of the engagement's own systems that is a usual tool for the job comes first:
        # the client runs it.
        found.extend(
            system for system in systems
            if any(tool.lower() in system.lower() for tool in common)
        )  # fmt: skip
    # The library's example is a usual answer for a role, a tool, or a period; for free
    # text it describes one client (a policy's version, a system's privileged roles) and
    # stays a hint in the field, never a choice. A system the control runs in is only ever
    # one of the engagement's own.
    if slot.example and slot.kind != "TEXT" and slot.key not in _OWN_SYSTEM:
        found.append(slot.example)
    found.extend(common)
    if slot.kind == "ROLE" and slot.key not in _EXPLICIT:
        area = area_of(slot.key)
        if slot.key.endswith("-maintainer"):
            found.extend(_MAINTAINERS)
        elif area is not None:
            staff = slot.key.endswith(("-preparer", "-role"))
            found.extend((_STAFF if staff else _SENIOR)[area])
            found.extend((_SENIOR if staff else _STAFF)[area][:1])
    unique: list[str] = []
    seen: set[str] = set()
    for item in found:
        text = " ".join(item.split())
        if text and text.lower() not in seen:
            seen.add(text.lower())
            unique.append(text)
    return unique[:MAX_OPTIONS]
