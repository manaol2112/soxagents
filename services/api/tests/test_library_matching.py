"""Matching a client's control to a standard, and the test basis (standard library, L2).

The scenarios are written in the wording of real client RCMs: the matching must find the
standard when the control is one, say so only as strongly as the rules can, and decline
when the control is none of them.
"""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_execution import _add_user
from test_outbound import _session, _team, migrated

from ai_workforce_api.controls import basis_of
from ai_workforce_api.db import connect
from ai_workforce_api.library_matching import (
    ControlFacts,
    check_adjudication,
    rules_candidates,
)

__all__ = ["migrated"]


def facts(
    title: str,
    activity: str,
    domain: str,
    nature: str = "IT_DEPENDENT_MANUAL",
    frequency: str = "EVENT_DRIVEN",
    risk: str = "",
    attributes: tuple[str, ...] = ("The control operated as described in the control activity.",),
    source: str = "UPLOAD",
) -> ControlFacts:
    return ControlFacts(
        control_id=uuid4(),
        organization_id=uuid4(),
        project_id=uuid4(),
        control_ref="X-1",
        title=title,
        activity=activity,
        risk=risk,
        domain=domain,
        nature=nature,
        frequency=frequency,
        source=source,
        library_key="",
        test_basis=basis_of(source, None),
        attributes=attributes,
    )


SCENARIOS: list[tuple[str, ControlFacts, str, str]] = [
    (
        "SAP user provisioning",
        facts(
            "Access to SAP is authorized and commensurate with job responsibilities",
            "New or modified SAP access is requested through ServiceNow and approved by the "
            "user's manager and the role owner before provisioning. SAP GRC Access Control "
            "runs an SoD risk analysis; conflicts must be remediated or mitigated before the "
            "role is assigned.",
            "ACCESS",
        ),
        "access-provisioning",
        "STRONG",
    ),
    (
        "Workday termination",
        facts(
            "Access is removed timely upon termination.",
            "Upon termination in Workday, an automated feed triggers a ServiceNow ticket; IT "
            "Security locks the SAP user within 1 business day of the termination date. "
            "Monthly, IT Security reconciles the Workday terminations listing to SAP users.",
            "ACCESS",
        ),
        "access-termination",
        "STRONG",
    ),
    (
        "quarterly user access review",
        facts(
            "User access remains appropriate over time.",
            "Quarterly, role owners and managers review all SAP users and roles via SAP GRC "
            "access certification, including SoD conflict reports. Access marked for removal "
            "is removed within 10 business days and verified by IT Security.",
            "ACCESS",
            frequency="QUARTERLY",
        ),
        "access-review",
        "STRONG",
    ),
    (
        "privileged and firefighter access",
        facts(
            "Privileged access is restricted and monitored.",
            "Privileged profiles (SAP_ALL/SAP_NEW) are assigned to no dialog users. Emergency "
            "access uses GRC firefighter IDs with ticket-based checkout; the IT Controls "
            "Manager reviews firefighter logs weekly.",
            "ACCESS",
            frequency="WEEKLY",
        ),
        "access-firefighter",
        "STRONG",
    ),
    (
        "quarterly privileged access review",
        facts(
            "Privileged access is reviewed.",
            "Quarterly, the Head of IT receives the listing of users holding SAP_ALL and "
            "basis administrator roles, confirms each one is still required, and signs the "
            "listing; access not confirmed is removed by the security team.",
            "ACCESS",
            frequency="QUARTERLY",
        ),
        "access-privileged",
        "STRONG",
    ),
    (
        "firefighter session review",
        facts(
            "Emergency access is controlled",
            "Firefighter IDs in SAP GRC are checked out against an incident ticket with IT "
            "Security Manager approval; the IT Controls Manager reviews each session activity "
            "log within 5 business days.",
            "ACCESS",
        ),
        "access-firefighter",
        "STRONG",
    ),
    (
        "segregation of duties ruleset",
        facts(
            "Segregation of duties conflicts are remediated",
            "Quarterly, the Business Controls Manager runs the SAP GRC risk analysis against "
            "the finance ruleset; each conflicting role combination is removed or a mitigating "
            "control is approved and documented.",
            "ACCESS",
            frequency="QUARTERLY",
        ),
        "access-sod-rules",
        "STRONG",
    ),
    (
        "transfer re-approval",
        facts(
            "Access is updated on transfer",
            "When Workday records an internal move, the new manager re-approves the SAP roles "
            "retained and IT removes roles not re-approved within 10 business days.",
            "ACCESS",
        ),
        "access-transfer",
        "STRONG",
    ),
    (
        "security monitoring",
        facts(
            "Security events are monitored",
            "Security operations reviews Sentinel high and critical alerts daily, investigates "
            "each, and raises a security incident for confirmed unauthorized access.",
            "ACCESS",
            frequency="DAILY",
        ),
        "access-security-monitoring",
        "STRONG",
    ),
    (
        "patching",
        facts(
            "Patches are managed",
            "Monthly OS and database patches for the SAP landscape are tested in QA and "
            "approved by the Infrastructure Change Manager in ServiceNow before production "
            "deployment.",
            "CHANGE",
        ),
        "change-patching",
        "STRONG",
    ),
    (
        "data migration",
        facts(
            "Data conversion is reconciled",
            "For the S/4 migration, record counts and control totals were reconciled between "
            "ECC and S/4 for each data object and approved by the Controller before cutover.",
            "CHANGE",
        ),
        "change-data-migration",
        "STRONG",
    ),
    (
        "interface monitoring",
        facts(
            "Interfaces are monitored",
            "Daily, integration support reviews the PI/PO run log for the billing-to-GL and "
            "payroll-to-GL interfaces for failures and record count mismatches and reprocesses "
            "errors.",
            "OPERATIONS",
            frequency="DAILY",
        ),
        "operations-interfaces",
        "STRONG",
    ),
    (
        "service organization report",
        facts(
            "Service organization reports are reviewed",
            "Annually, IT Compliance obtains the hosting provider SOC 1 Type 2 report and "
            "bridge letter, assesses exceptions, and maps complementary user entity controls.",
            "OPERATIONS",
            nature="MANUAL",
            frequency="ANNUAL",
        ),
        "operations-soc-reports",
        "STRONG",
    ),
    (
        "vulnerability remediation",
        facts(
            "Vulnerabilities are remediated",
            "Qualys scans the SAP servers monthly; critical and high vulnerabilities are "
            "remediated within 30 and 90 days or risk-accepted by the CISO.",
            "OPERATIONS",
            frequency="MONTHLY",
        ),
        "operations-vulnerabilities",
        "STRONG",
    ),
    (
        "duplicate invoice check",
        facts(
            "Duplicate invoices are prevented",
            "SAP checks vendor, invoice number, and invoice date on entry and blocks an invoice "
            "that matches one already posted; only the AP supervisor can release.",
            "ITAC",
            nature="AUTOMATED",
            frequency="RECURRING",
        ),
        "itac-duplicate-invoice",
        "STRONG",
    ),
    (
        "period lock",
        facts(
            "Posting periods are controlled",
            "Prior posting periods are closed in SAP after the close; only the GL Manager can "
            "reopen a period and postings to closed periods are rejected.",
            "ITAC",
            nature="AUTOMATED",
            frequency="RECURRING",
        ),
        "itac-period-lock",
        "STRONG",
    ),
    (
        "journal entry workflow",
        facts(
            "Journal entries are approved in the system",
            "Manual journal entries above 10,000 are routed by workflow to an approver other "
            "than the preparer and cannot be posted until approved.",
            "ITAC",
            nature="AUTOMATED",
            frequency="RECURRING",
        ),
        "itac-je-workflow",
        "STRONG",
    ),
    (
        "Salesforce pricing configuration",
        facts(
            "System prevents unauthorized price overrides.",
            "CPQ pulls list price from the active price book; the List Price field is "
            "read-only for all Sales profiles via field-level security, so reps can only apply "
            "discounts within their approval limits.",
            "ITAC",
            nature="AUTOMATED",
            frequency="RECURRING",
        ),
        "itac-price-master",
        "STRONG",
    ),
    (
        "inventory valuation report",
        facts(
            "Inventory valuation report is validated",
            "Quarterly, the cost accountant agrees the inventory valuation report total to the "
            "GL inventory accounts and recalculates the extended cost of 25 items.",
            "IPE",
            frequency="QUARTERLY",
        ),
        "ipe-inventory-valuation",
        "STRONG",
    ),
    (
        "key spreadsheets",
        facts(
            "Key spreadsheets",
            "Key SOX spreadsheets are kept in the SharePoint finance library with restricted "
            "access and version history; before each use the owner agrees inputs to source and "
            "checks formulas.",
            "IPE",
            nature="MANUAL",
            frequency="QUARTERLY",
        ),
        "ipe-euc-spreadsheets",
        "STRONG",
    ),
    (
        "emergency production change",
        facts(
            "Emergency changes are controlled.",
            "An emergency change to production is deployed with the CAB chair's verbal "
            "approval and documented, tested, and approved after the fact within 5 business "
            "days in ServiceNow.",
            "CHANGE",
        ),
        "change-emergency",
        "STRONG",
    ),
    (
        "CI/CD production deployment",
        facts(
            "Changes to SAP are authorized, tested, approved, and migrated by appropriate "
            "personnel",
            "All SAP transports are tested in QA, approved by the business owner and CAB in "
            "ServiceNow, and imported to production by Basis (independent of developers). "
            "The production client is locked for changes.",
            "CHANGE",
        ),
        "change-approval",
        "STRONG",
    ),
    (
        "batch job monitoring",
        facts(
            "Scheduled jobs complete.",
            "Daily, the operations team reviews the Control-M job schedule for failed or "
            "abended batch jobs feeding the general ledger and resolves failures through an "
            "incident ticket before the next run.",
            "OPERATIONS",
            frequency="DAILY",
        ),
        "operations-jobs",
        "STRONG",
    ),
    (
        "Oracle automated three-way match",
        facts(
            "Invoices are matched before payment.",
            "Oracle Payables performs a three-way match of invoice, purchase order, and receipt; "
            "invoices outside the 2% price tolerance are placed on hold and cannot be paid "
            "until the hold is released by the AP manager.",
            "ITAC",
            nature="AUTOMATED",
            frequency="RECURRING",
        ),
        "itac-three-way-match",
        "STRONG",
    ),
    (
        "monthly account reconciliations",
        facts(
            "Balance sheet accounts are reconciled.",
            "Monthly, preparers reconcile key balance sheet accounts in BlackLine to supporting "
            "detail; reconciling items over $25,000 are explained and the reviewer approves "
            "each reconciliation within 10 days of close.",
            "RECORD_TO_REPORT",
            frequency="MONTHLY",
        ),
        "rtr-account-reconciliations",
        "STRONG",
    ),
    (
        "management review of revenue variances",
        facts(
            "Revenue is reasonable.",
            "Monthly, the Controller reviews the flux analysis of revenue by product line "
            "against budget and prior month; variances over 5% and $100,000 are investigated "
            "with the business and explanations documented.",
            "RECORD_TO_REPORT",
            frequency="MONTHLY",
        ),
        "rtr-flux-review",
        "STRONG",
    ),
    (
        "aged receivables report",
        facts(
            "Report is complete and accurate.",
            "Quarterly, the Credit Manager agrees the aged receivables report total to the "
            "general ledger and tests the aging buckets of five invoices to source documents "
            "before it is used for the bad debt reserve.",
            "IPE",
            frequency="QUARTERLY",
        ),
        "ipe-aged-receivables",
        "STRONG",
    ),
    (
        "journal entry listing",
        facts(
            "Report is complete and accurate.",
            "Monthly, the accounting manager documents the parameters of the manual journal "
            "entry listing and agrees the count and total to the ledger before the review.",
            "IPE",
            frequency="MONTHLY",
        ),
        "ipe-journal-listing",
        "STRONG",
    ),
    (
        "bank reconciliation",
        facts(
            "Cash is reconciled.",
            "Monthly, treasury prepares the bank statement reconciliation for each operating "
            "account; reconciling items are cleared within 30 days and the Treasurer approves.",
            "TREASURY",
            frequency="MONTHLY",
        ),
        "treasury-bank-reconciliation",
        "STRONG",
    ),
]

NEGATIVES: list[tuple[str, ControlFacts]] = [
    (
        "stock-based compensation, which the library does not have",
        facts(
            "Stock-based compensation expense review",
            "Quarterly, the Equity Administrator generates stock-based compensation expense "
            "from Carta, reconciles grants to board approvals, and validates valuation inputs.",
            "HIRE_TO_RETIRE",
            frequency="QUARTERLY",
        ),
    ),
    (
        "a hedge accounting designation review, which the library does not have",
        facts(
            "Hedge designations are reviewed",
            "Quarterly, Treasury reviews each hedge relationship designation memo and the "
            "effectiveness assessment prepared under ASC 815 before the hedge accounting "
            "entries are recorded.",
            "TREASURY",
            frequency="QUARTERLY",
        ),
    ),
]


def test_each_scenario_finds_its_standard_as_strongly_as_the_rules_can() -> None:
    for name, control, expected, status in SCENARIOS:
        found = rules_candidates(control, {})
        assert found, name
        assert found[0].library_key == expected, (name, [c.library_key for c in found])
        assert found[0].status == status, (name, found[0].status, found[0].score)
        # The rules say why, and that a person confirms.
        assert "A person confirms" in found[0].rationale, name
        assert found[0].applicable, name


def test_the_rules_decline_what_the_library_does_not_have() -> None:
    for name, control in NEGATIVES:
        found = rules_candidates(control, {})
        assert all(item.status != "STRONG" for item in found), (
            name,
            [(c.library_key, c.status, c.score) for c in found],
        )


def test_a_retired_standard_is_never_offered_and_the_nature_counts() -> None:
    control = SCENARIOS[0][1]
    without = rules_candidates(control, {"access-provisioning": "RETIRED"})
    assert all(item.library_key != "access-provisioning" for item in without)
    # A manual review described as automated is not a strong match for a manual standard.
    automated = facts(
        "Access is authorized.",
        "New SAP access is requested in ServiceNow and approved by the manager before "
        "provisioning.",
        "ACCESS",
        nature="AUTOMATED",
    )
    top = rules_candidates(automated, {})[0]
    assert top.library_key == "access-provisioning"
    assert top.status != "STRONG"


def test_the_rules_say_what_the_control_does_not_state() -> None:
    vague = facts(
        "Leavers lose access.",
        "When an employee leaves, IT disables their accounts after HR notifies them.",
        "ACCESS",
    )
    top = rules_candidates(vague, {})[0]
    assert top.library_key == "access-termination"
    # No number in the control: the policy's days must be recorded by a person.
    assert any("days" in item.lower() or "record" in item.lower() for item in top.missing)


def test_the_models_answer_is_checked_before_it_is_used() -> None:
    control = SCENARIOS[1][1]
    shortlist = rules_candidates(control, {})
    keys = [item.library_key for item in shortlist]
    good = {
        "match": "access-termination",
        "status": "STRONG",
        "rationale": "Accounts are locked within 1 business day of the termination date.",
        "applicable": ["ac02-removed", "ac02-days"],
        "excluded": [],
        "missing": [],
    }
    definition_keys = {
        item.key
        for item in __import__("ai_workforce_api.definition_registry", fromlist=["BY_LIBRARY_KEY"])
        .BY_LIBRARY_KEY["access-termination"]
        .attributes
    }
    good["applicable"] = sorted(definition_keys)[:2]
    checked = check_adjudication(dict(good), control, [c for c in rules_candidates(control, {})])
    assert checked[0].library_key == "access-termination"
    assert checked[0].status == "STRONG"
    assert all(item.status == "NONE" for item in checked[1:])
    # Outside the shortlist, an invented attribute, a threshold the control never gives,
    # or a match with no status are each refused.
    for bad in (
        {**good, "match": "treasury-covenants"},
        {**good, "applicable": ["no-such-attribute"]},
        {**good, "rationale": "Accounts are locked within 3 business days."},
        {**good, "status": "NONE"},
        {**good, "match": "", "status": "STRONG"},
    ):
        try:
            check_adjudication(dict(bad), control, rules_candidates(control, {}))
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad}")
    assert "access-termination" in keys


def test_the_default_basis_follows_the_source_until_a_person_decides() -> None:
    assert basis_of("LIBRARY", None) == "STANDARD"
    assert basis_of("UPLOAD", None) == "CLIENT"
    assert basis_of("UPLOAD", "CUSTOM") == "CUSTOM"
    assert basis_of("LIBRARY", "CLIENT") == "CLIENT"


def _seed_control(database: Database, seeded: dict[str, Any], project_id: UUID) -> UUID:
    with connect(database.url) as connection:
        row = connection.execute(
            """
            INSERT INTO engagement_controls (
                organization_id, project_id, library_key, library_version, control_ref, domain,
                title, risk, activity, frequency, nature, test_attributes, pbc_items, agent_key,
                template_key, source
            )
            VALUES (%s, %s, '', 0, 'ITGC-SAP-02', 'ACCESS',
                    'Access is removed timely upon termination.',
                    'Leavers keep access.',
                    'Upon termination in Workday, an automated feed triggers a ServiceNow '
                    'ticket; IT Security locks the SAP user within 1 business day of the '
                    'termination date.',
                    'EVENT_DRIVEN', 'IT_DEPENDENT_MANUAL',
                    '["The control operated as described in the control activity."]',
                    '["Termination listing"]', 'itgc-access', 'itgc', 'MANUAL')
            RETURNING id
            """,
            (seeded["organization_id"], project_id),
        ).fetchone()
        connection.commit()
    assert row is not None
    return UUID(str(row[0]))


def test_a_person_asks_for_a_match_adopts_the_standard_and_the_clients_text_stays(
    migrated: Database,
) -> None:
    seeded, project_id, owner, _admin = _team(migrated, "basis")
    control_id = _seed_control(migrated, seeded, project_id)
    base = (
        f"/organizations/{seeded['organization_id']}/projects/{project_id}"
        f"/controls/{control_id}/test-basis"
    )

    before = owner.get(base)
    assert before.status_code == 200
    body = before.json()
    assert body["basis"] == "CLIENT" and body["decided"] is False
    assert body["client_procedures_stated"] is False
    assert body["candidates"] == [] and body["run"] is None

    matched = owner.post(f"{base}/match")
    assert matched.status_code == 200
    body = matched.json()
    assert body["run"]["decided_by"] == "RULES"
    assert body["candidates"][0]["library_key"] == "access-termination"
    assert body["candidates"][0]["status"] == "STRONG"
    assert body["candidates"][0]["library_status"] == "PENDING_REVIEW"

    # Following a standard adopts it: the key, the proposed attributes, a new rules plan,
    # and the client's activity text untouched.
    adopted = owner.put(
        base, json={"basis": "STANDARD", "library_key": "access-termination", "note": "Fits"}
    )
    assert adopted.status_code == 200, adopted.text
    body = adopted.json()
    assert body["basis"] == "STANDARD" and body["decided"] is True
    assert body["standard"]["control_ref"] == "ITGC-AC-02"
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT library_key, library_version, activity FROM engagement_controls WHERE id = %s",
            (control_id,),
        ).fetchone()
        assert row is not None
        # Adoption stamps the standard's definition version (4: steps and a suite).
        assert row[0] == "access-termination" and row[1] == 4
        assert row[2].startswith("Upon termination in Workday")
        proposed = connection.execute(
            "SELECT count(*) FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'PROPOSED' AND source_kind = 'LIBRARY' AND definition_key IS NOT NULL",
            (control_id,),
        ).fetchone()
        assert proposed is not None and proposed[0] >= 2
        events = connection.execute(
            "SELECT action FROM audit_events WHERE target_id = %s ORDER BY occurred_at",
            (control_id,),
        ).fetchall()
    assert [row[0] for row in events] == ["library.match", "control.test_basis"]
    # The new plan follows the standard's procedures before its attributes are approved.
    plan_path = (
        f"/organizations/{seeded['organization_id']}/projects/{project_id}"
        f"/controls/{control_id}/master-plan"
    )
    planned = owner.get(plan_path)
    assert planned.status_code == 200
    design = [item for item in planned.json()["procedures"] if item["phase"] == "DESIGN"]
    assert design and design[0]["text"].startswith("Read the access policy's removal period")
    # The row links to the standard's steps on the Library.
    assert design[0]["standard_key"] == "d-1"
    # The same basis twice is refused; the client's own is always a choice.
    assert owner.put(base, json={"basis": "STANDARD"}).status_code == 409
    back = owner.put(base, json={"basis": "CLIENT", "note": "The client's RCM governs"})
    assert back.status_code == 200
    assert back.json()["basis"] == "CLIENT"

    # The plan review knows the basis and says the standard is pending review.
    plan = owner.get(plan_path)
    assert plan.status_code == 200
    control = plan.json()["control"]
    assert control["test_basis"] == "CLIENT" and control["library_ref"] == "ITGC-AC-02"


def test_a_contributor_reads_the_basis_but_does_not_decide_it(migrated: Database) -> None:
    seeded, project_id, _owner, _admin = _team(migrated, "basis-read")
    control_id = _seed_control(migrated, seeded, project_id)
    with connect(migrated.url) as connection:
        reader = _add_user(
            connection, seeded["organization_id"], f"c-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
        connection.execute(
            "INSERT INTO project_memberships (organization_id, project_id, user_id) "
            "VALUES (%s, %s, %s)",
            (seeded["organization_id"], project_id, reader),
        )
        connection.commit()
    client = _session(migrated, reader)
    base = (
        f"/organizations/{seeded['organization_id']}/projects/{project_id}"
        f"/controls/{control_id}/test-basis"
    )
    read = client.get(base)
    assert read.status_code == 200
    assert read.json()["can_decide"] is False
    assert client.post(f"{base}/match").status_code == 403
    assert client.put(base, json={"basis": "CLIENT"}).status_code == 403
