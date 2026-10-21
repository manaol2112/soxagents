"""A control's test basis and its standard (standard library, milestone L2).

A person decides what a control's test plan is built from: the matched standard
(STANDARD), the standard as a starting point the firm tailors (CUSTOM), or the client's
own documented procedures (CLIENT). With no decision, a library copy follows its standard
and a client's control follows the client's procedures (controls.basis_of); nothing is
forced, and a match is a proposal until a person confirms it.

Candidates are found when a person asks. Fixed rules shortlist the standards of the
control's category and area, scored on word overlap with the control's title, activity,
and risk, on the nature and frequency fitting, and on the signals that name a standard
(a leaver, a transport, a three-way match). The rules give each candidate a qualitative
status: STRONG (the area, the nature, and the words agree, with a clear margin), PARTIAL,
or NONE; no number is presented as a calibrated confidence. When a model is configured it
adjudicates the shortlist (the match, the rationale in the control's own words, the
attributes that apply and those excluded with why, what the control does not state) and
its answer is checked before it is used: only shortlisted standards, only real attribute
keys, no threshold or deadline the control does not give; otherwise the rules' answer
stands, with the note.

Adopting a standard sets the control's library key, proposes the standard's attributes for
a person to decide, keeps the client's own attributes for a person to keep or retire,
and plans the control again with the rules; the plan then goes through its approval as
any other. A standard that is pending methodology review may be adopted (decided by the
product owner): the plan review says so, without holding approval.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
    permits,
)
from ai_workforce_api.controls import (
    BY_KEY,
    DOMAIN_LABELS,
    LIBRARY,
    LibraryControl,
    TestBasis,
    basis_of,
)
from ai_workforce_api.db import transaction
from ai_workforce_api.definition_registry import BY_LIBRARY_KEY, definition_version
from ai_workforce_api.evidence_matching import _words
from ai_workforce_api.library_governance import Status, category_for, effective_status
from ai_workforce_api.model_providers import fallback_note, live_model, provider_for
from ai_workforce_api.models import ModelProvider, ModelRequest
from ai_workforce_api.provenance import AgentCaller, Job, agent_actor
from ai_workforce_api.settings import Settings
from ai_workforce_api.statement_registry import statement_for
from ai_workforce_api.testing_definitions import TESTED, Definition

MatchStatus = Literal["STRONG", "PARTIAL", "NONE"]
DecidedBy = Literal["RULES", "MODEL", "FALLBACK"]

# A client RCM whose "test procedures" column only restates the activity states no
# procedure of its own: the client's basis would test nothing specific.
PLACEHOLDER = re.compile(
    r"(?i)^\s*(?:the\s+)?control\s+(?:operated|operates|is performed|performed)\s+as\s+"
    r"(?:described|documented|designed)"
)


class MatchState(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# The control as the matching reads it


@dataclass(frozen=True)
class ControlFacts:
    control_id: UUID
    organization_id: UUID
    project_id: UUID
    control_ref: str
    title: str
    activity: str
    risk: str
    domain: str
    nature: str
    frequency: str
    source: str
    library_key: str
    test_basis: TestBasis
    attributes: tuple[str, ...] = ()
    applications: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        return " ".join((self.title, self.activity, self.risk, *self.attributes))

    @property
    def client_procedures_stated(self) -> bool:
        """Whether the client's RCM states a test procedure of its own, rather than the
        placeholder that restates the activity."""
        return any(item.strip() and PLACEHOLDER.match(item) is None for item in self.attributes)


def load_control(connection: psycopg.Connection[Any], control_id: UUID) -> ControlFacts | None:
    row = connection.execute(
        """
        SELECT c.organization_id, c.project_id, c.control_ref, c.title,
               coalesce(c.activity, ''),
               coalesce(c.risk, ''), c.domain, coalesce(c.nature, ''), coalesce(c.frequency, ''),
               coalesce(c.source, ''), coalesce(c.library_key, ''), c.test_basis,
               c.test_attributes,
               ARRAY(SELECT a.name FROM engagement_applications a
                     WHERE a.id = ANY(c.application_ids) OR a.id = c.engagement_application_id)
        FROM engagement_controls c WHERE c.id = %s
        """,
        (control_id,),
    ).fetchone()
    if row is None:
        return None
    attributes = row[12] if isinstance(row[12], list) else []
    return ControlFacts(
        control_id=control_id,
        organization_id=row[0],
        project_id=row[1],
        control_ref=str(row[2]),
        title=str(row[3]),
        activity=str(row[4]),
        risk=str(row[5]),
        domain=str(row[6]),
        nature=str(row[7]),
        frequency=str(row[8]),
        source=str(row[9]),
        library_key=str(row[10]),
        test_basis=basis_of(str(row[9]), row[11]),
        attributes=tuple(str(item) for item in attributes if isinstance(item, str)),
        applications=tuple(str(name) for name in (row[13] or [])),
    )


# The rules


@dataclass
class Candidate:
    library_key: str
    score: float
    status: MatchStatus
    rationale: str
    applicable: list[str]
    excluded: list[dict[str, str]]
    missing: list[str]
    # Why the rules ranked it: the signals that fired, for the rationale.
    signals: list[str] = field(default_factory=list)


# Words that name a standard when they appear in a control: a deterministic signal the
# word overlap alone can miss. Each pattern is matched against the control's text.
SIGNALS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # Library version 4, wave 1: the specific standards come first, and _SPECIFIC_OVER says
    # which general signal each displaces.
    (
        "access-firefighter",
        re.compile(
            r"(?i)\b(firefighter|fire ?fighter|emergency access|break[- ]glass|elevated access "
            r"session)"
        ),
    ),
    (
        "access-transfer",
        re.compile(r"(?i)\b(transfer|change of role|role change|mover|job change|internal move)"),
    ),
    (
        "access-third-party",
        re.compile(
            r"(?i)\b(third[- ]party|vendor|contractor|external|supplier) (user|account|access|id)s?"
        ),
    ),
    (
        "access-sod-rules",
        re.compile(
            r"(?i)\b(segregation of duties|sod\b|conflict(ing)? (role|access)|rule ?set|risk "
            r"analysis)"
        ),
    ),
    (
        "access-direct-db-os",
        re.compile(
            r"(?i)\b(database|dba\b|operating system|os[- ]level|root access|sysadmin|direct "
            r"(db|database|table) access)"
        ),
    ),
    (
        "access-security-monitoring",
        re.compile(
            r"(?i)\b(siem|security (event|alert|log|monitoring|operations)|intrusion|soc analyst)"
        ),
    ),
    (
        "change-patching",
        re.compile(r"(?i)\b(patch|patching|security update|service pack|kernel update)"),
    ),
    (
        "change-sdlc",
        re.compile(
            r"(?i)\b(sdlc|development life ?cycle|user acceptance|uat\b|go[- ]live|project "
            r"(delivery|implementation)|new system)"
        ),
    ),
    (
        "change-data-migration",
        re.compile(
            r"(?i)\b(data (migration|conversion|load)|migrat(ed|ion) "
            r"(data|balances)|cutover|conversion)"
        ),
    ),
    (
        "operations-interfaces",
        re.compile(r"(?i)\b(interface|integration|data feeds?\b|middleware|record count)"),
    ),
    (
        "operations-soc-reports",
        re.compile(
            r"(?i)\b(soc ?1|soc ?2|ssae|isae ?3402|service organi[sz]ation|bridge letter|cuec)"
        ),
    ),
    (
        "operations-vulnerabilities",
        re.compile(r"(?i)\b(vulnerabilit|cve\b|scan(ning|ned)?|remediat|penetration test)"),
    ),
    (
        "itac-duplicate-invoice",
        re.compile(r"(?i)\b(duplicate (invoice|check|payment|vendor invoice)|same invoice number)"),
    ),
    (
        "itac-po-workflow",
        re.compile(
            r"(?i)\b(release strategy|(purchase "
            r"order|po\b).{0,50}(approv|workflow|release)|delegation of authority)"
        ),
    ),
    (
        "itac-nonpo-routing",
        re.compile(
            r"(?i)\b(non[- ]?po|without a purchase order|invoice (approval|coding) "
            r"workflow|route[sd]? .{0,30}invoice)"
        ),
    ),
    (
        "itac-period-lock",
        re.compile(
            r"(?i)\b(period (lock|close|status|control)|closed period|posting period|reopen)"
        ),
    ),
    (
        "itac-je-workflow",
        re.compile(
            r"(?i)\b(journal|je\b|entries).{0,60}(workflow|routed|system[- ]enforced|cannot be "
            r"posted|approval threshold)"
        ),
    ),
    (
        "itac-price-master",
        re.compile(r"(?i)\b(price (master|book|list)|pricing|list price|price override|discount)"),
    ),
    (
        "itac-ship-to-bill",
        re.compile(
            r"(?i)\b(billing due|unbilled|ship(ment|ped)?s?.{0,30}(invoice|bill)|goods "
            r"issue|billing run)"
        ),
    ),
    (
        "itac-depreciation-calc",
        re.compile(
            r"(?i)\b(depreciation (run|calculat|key|posting)|useful li(fe|ves)|asset class)"
        ),
    ),
    (
        "itac-payroll-calc",
        re.compile(r"(?i)\b(gross[- ]to[- ]net|payroll (calculat|engine|run)|tax table)"),
    ),
    (
        "itac-posting-validation",
        re.compile(
            r"(?i)\b(validation rule|required field|mandatory field|invalid "
            r"(account|combination)|unbalanced)"
        ),
    ),
    (
        "itac-interface-totals",
        re.compile(r"(?i)\b(control total|hash total|record count|batch total|error queue)"),
    ),
    (
        "ipe-inventory-valuation",
        re.compile(
            r"(?i)\b(inventory valuation|stock valuation|extended cost|inventory (report|listing))"
        ),
    ),
    (
        "ipe-fixed-asset-register",
        re.compile(r"(?i)\b((fixed )?asset register|asset subledger|asset listing)"),
    ),
    ("ipe-payroll-register", re.compile(r"(?i)\b(payroll register)")),
    (
        "ipe-billing-report",
        re.compile(r"(?i)\b(billing report|invoice register|sales register|billing listing)"),
    ),
    ("ipe-ap-aging", re.compile(r"(?i)\b((payables|ap|accounts payable|vendor) ag(e|ing))")),
    (
        "ipe-euc-spreadsheets",
        re.compile(r"(?i)\b(spreadsheet|euc\b|end[- ]user comput|excel|workbook)"),
    ),
    ("access-termination", re.compile(r"(?i)\b(terminat|leaver|offboard|deactivat|separat)")),
    (
        "access-review",
        re.compile(
            r"(?i)\b(recertif|certification|access review|review(s|ed)? (all )?(user|access|role|"
            r"account)s?\b|appropriate over time)"
        ),
    ),
    (
        "access-privileged",
        re.compile(
            r"(?i)\b(privileged|firefighter|sap_all|sap_new|superuser|emergency access|"
            r"admin(istrator)? access)"
        ),
    ),
    (
        "access-authentication",
        re.compile(
            r"(?i)\b(password|authenticat|mfa|multi-?factor|single sign|sso|lockout|complexity)"
        ),
    ),
    ("access-shared-accounts", re.compile(r"(?i)\b(shared|generic|service) (account|id)s?\b")),
    (
        "access-provisioning",
        re.compile(
            r"(?i)\b(provision|new (user|hire|access)|access (request|is requested)|grant(ed|"
            r"ing)? access|assign(ment)? of)"
        ),
    ),
    (
        "change-emergency",
        re.compile(r"(?i)\b(emergency change|hotfix|expedited|break-?fix|after the fact)"),
    ),
    (
        "change-segregation",
        re.compile(
            r"(?i)\b(developer|development).{0,60}(production|deploy)|segregat.{0,40}(change|"
            r"deploy)|independent of developers"
        ),
    ),
    (
        "change-data",
        re.compile(
            r"(?i)\b(direct (data|table|database) (change|update|fix)|data fix|dml|"
            r"script.{0,20}production data|manual (data )?correction)"
        ),
    ),
    (
        "change-configuration",
        re.compile(
            r"(?i)\b(configuration change|config(uration)? (setting|change)s?|parameter change|"
            r"table setting)"
        ),
    ),
    (
        "change-approval",
        re.compile(
            r"(?i)\b(transport|change request|change ticket|release|deploy|migrat|cab\b|"
            r"change advisory|promote.{0,20}production)"
        ),
    ),
    ("operations-backup-failures", re.compile(r"(?i)\bbackup.{0,40}(fail|error|monitor)")),
    (
        "operations-restore-test",
        re.compile(r"(?i)\b(restor(e|ation) test|test restor|recover(y|ed) (test|from backup))"),
    ),
    ("operations-backup", re.compile(r"(?i)\bbackup")),
    (
        "operations-scheduler-access",
        re.compile(r"(?i)\b(schedul(er|ing) (tool )?access|access to (the )?(job )?schedul)"),
    ),
    (
        "operations-scheduling",
        re.compile(r"(?i)\b(job schedule change|change(s)? to (the )?(job )?schedule|new job)"),
    ),
    (
        "operations-jobs",
        re.compile(
            r"(?i)\b(batch|scheduled job|job (fail|monitor|abend)|interface (fail|monitor|error)|"
            r"job run)"
        ),
    ),
    ("operations-incidents", re.compile(r"(?i)\b(incident|problem (ticket|management)|outage)")),
    (
        "operations-physical",
        re.compile(r"(?i)\b(physical access|data cent(er|re)|badge|server room)"),
    ),
    (
        "itac-three-way-match",
        re.compile(
            r"(?i)\b(three-?way|3-?way|match.{0,30}(invoice|receipt|purchase order)|"
            r"invoice.{0,30}match)"
        ),
    ),
    ("itac-credit-limit", re.compile(r"(?i)\bcredit limit")),
    (
        "ipe-aged-receivables",
        re.compile(r"(?i)\b(aged|aging|ageing) (receivable|trial balance|report)|ar aging"),
    ),
    (
        "ipe-journal-listing",
        re.compile(r"(?i)\b(journal (entry )?listing|je listing|listing of (manual )?journal)"),
    ),
    ("otc-customer-master", re.compile(r"(?i)\bcustomer master")),
    (
        "otc-revenue-cutoff",
        re.compile(r"(?i)\b(cut-?off|period end shipment|shipping document.{0,30}period)"),
    ),
    ("otc-cash-application", re.compile(r"(?i)\b(cash application|unapplied cash|cash receipt)")),
    ("otc-credit-memos", re.compile(r"(?i)\bcredit (memo|note)")),
    (
        "ptp-vendor-master",
        re.compile(r"(?i)\b(vendor|supplier) master|vendor onboard|bank (account )?detail"),
    ),
    (
        "ptp-purchase-approval",
        re.compile(r"(?i)\b(purchase order|requisition|purchase approval|delegation of authority)"),
    ),
    (
        "ptp-payment-run",
        re.compile(r"(?i)\b(payment run|payment batch|disbursement|wire release|payment file)"),
    ),
    (
        "ptp-accruals",
        re.compile(r"(?i)\b(accrual|unrecorded liabilit|goods received not invoiced|grni)"),
    ),
    (
        "rtr-journal-review",
        re.compile(
            r"(?i)\b(manual journal|journal entr(y|ies).{0,40}(approv|review)|je approval|"
            r"top-?side)"
        ),
    ),
    (
        "rtr-account-reconciliations",
        re.compile(
            r"(?i)\b(balance sheet reconcil|account reconcil|reconcil.{0,30}(ledger|sub-?ledger|"
            r"supporting))"
        ),
    ),
    (
        "rtr-flux-review",
        re.compile(
            r"(?i)\b(flux|fluctuation|variance analysis|unusual (change|variance)|budget to actual)"
        ),
    ),
    ("rtr-consolidation", re.compile(r"(?i)\b(consolidat|intercompany|elimination|translation)")),
    ("treasury-bank-reconciliation", re.compile(r"(?i)\bbank (statement )?reconcil")),
    (
        "treasury-bank-access",
        re.compile(
            r"(?i)\b(signator|bank portal|banking (access|platform)|wire (approv|authoriz)|"
            r"move funds)"
        ),
    ),
    ("treasury-covenants", re.compile(r"(?i)\bcovenant")),
    ("treasury-debt", re.compile(r"(?i)\b(debt|loan|borrowing|interest accru)")),
    (
        "h2r-payroll-changes",
        re.compile(
            r"(?i)\b(new hire|pay (rate )?change|payroll master|employee master|salary change|"
            r"termination.{0,20}payroll)"
        ),
    ),
    (
        "h2r-payroll-reconciliation",
        re.compile(r"(?i)\bpayroll.{0,40}(reconcil|agree.{0,20}ledger|general ledger)"),
    ),
    ("h2r-payroll-review", re.compile(r"(?i)\bpayroll.{0,40}(review|approv|register)")),
    (
        "inventory-counts",
        re.compile(r"(?i)\b(physical (inventory|count)|cycle count|stock ?take|count difference)"),
    ),
    (
        "inventory-valuation",
        re.compile(
            r"(?i)\b(obsolete|slow-?moving|excess inventory|inventory reserve|net realizable|"
            r"lower of cost)"
        ),
    ),
    ("inventory-standard-costs", re.compile(r"(?i)\bstandard cost")),
    (
        "fa-additions",
        re.compile(
            r"(?i)\b(capitaliz|fixed asset addition|asset addition|capital expenditure|capex)"
        ),
    ),
    ("fa-depreciation", re.compile(r"(?i)\b(depreciat|useful li(fe|ves))")),
    (
        "fa-disposals-impairment",
        re.compile(r"(?i)\b(disposal|retire(d|ment) of asset|asset write-?off)"),
    ),
    ("fa-impairment", re.compile(r"(?i)\bimpairment")),
    (
        "tax-provision",
        re.compile(r"(?i)\b(tax provision|income tax|deferred tax|effective tax rate)"),
    ),
    ("tax-indirect", re.compile(r"(?i)\b(indirect tax|vat|gst|sales tax|use tax|tax return)")),
    ("entity-code-of-conduct", re.compile(r"(?i)\bcode of conduct")),
    ("entity-whistleblower", re.compile(r"(?i)\b(whistleblow|hotline|ethics report)")),
)

# Standards whose signal is a word a more specific standard also uses: the specific one
# wins when both fire, so "emergency change" is not also "change approval".
_SPECIFIC_OVER: dict[str, tuple[str, ...]] = {
    "change-approval": (
        "change-emergency", "change-data", "change-configuration", "change-patching",
        "change-sdlc", "change-data-migration",
    ),
    "operations-backup": ("operations-backup-failures", "operations-restore-test"),
    "operations-jobs": (
        "operations-scheduler-access", "operations-scheduling", "operations-interfaces",
    ),
    "access-provisioning": (
        "access-termination", "access-review", "access-privileged", "access-transfer",
        "access-third-party",
    ),
    "access-privileged": ("access-firefighter", "access-direct-db-os"),
    "access-review": ("access-third-party", "access-direct-db-os"),
    "operations-incidents": ("access-security-monitoring",),
    "treasury-debt": ("treasury-covenants",),
    "fa-disposals-impairment": ("fa-impairment",),
    "h2r-payroll-review": ("h2r-payroll-reconciliation", "h2r-payroll-changes"),
    "rtr-account-reconciliations": ("treasury-bank-reconciliation",),
}  # fmt: skip

STRONG_SCORE = 0.55
PARTIAL_SCORE = 0.28
MARGIN = 0.12


def _library_text(control: LibraryControl, definition: Definition | None) -> str:
    parts = [control.title, control.risk, control.activity, *control.test_attributes]
    if definition is not None:
        parts.append(definition.objective)
        parts.extend(item.text for item in definition.attributes)
    statement = statement_for(control.key)
    if statement is not None:
        parts.extend((statement.text, statement.risk, statement.precision))
    return " ".join(parts)


def _nature_fit(control: str, standard: str) -> float:
    if not control or control == standard:
        return 0.1
    if "AUTOMATED" in (control, standard) and "MANUAL" in (control, standard):
        # One is a configuration, the other a person's act: different controls.
        return -0.3 if {control, standard} == {"AUTOMATED", "MANUAL"} else -0.1
    return 0.0


_PERIODIC = {"ANNUAL", "QUARTERLY", "MONTHLY", "WEEKLY", "DAILY"}


def _frequency_fit(control: str, standard: str) -> float:
    if not control or control == standard:
        return 0.05
    if (control in _PERIODIC) != (standard in _PERIODIC):
        return -0.1
    return 0.0


def _signals(text: str) -> set[str]:
    fired = {key for key, pattern in SIGNALS if pattern.search(text)}
    for general, specifics in _SPECIFIC_OVER.items():
        if general in fired and any(item in fired for item in specifics):
            fired.discard(general)
    return fired


def _missing(definition: Definition | None, library_key: str, text: str) -> list[str]:
    """What the standard needs that the control does not state: the client values that
    hold testing, where the control's words do not give them."""
    statement = statement_for(library_key)
    if statement is None:
        return []
    found: list[str] = []
    has_number = re.search(r"\d", text) is not None
    for slot in statement.slots:
        if not slot.blocks or slot.key == "system":
            continue
        if slot.kind in ("DAYS", "AMOUNT", "PERCENT", "PERIOD") and has_number:
            continue
        found.append(f"Record {slot.label}: {slot.why}" if slot.why else f"Record {slot.label}.")
    if definition is not None and definition.design_confirmation:
        found.append(definition.design_confirmation)
    return found[:6]


def rules_candidates(
    facts: ControlFacts, statuses: dict[str, Status], limit: int = 5
) -> list[Candidate]:
    """The standards that could be this control, scored and ranked by the fixed rules.
    Retired standards are never offered."""
    category = category_for(facts.domain) if facts.domain in DOMAIN_LABELS else None
    control_words = _words(facts.text)
    title_words = _words(facts.title)
    fired = _signals(facts.text)
    scored: list[Candidate] = []
    for control in LIBRARY:
        if statuses.get(control.key, "PENDING_REVIEW") == "RETIRED":
            continue
        if category is not None and category_for(control.domain) != category:
            continue
        definition = BY_LIBRARY_KEY.get(control.key)
        library_words = _words(_library_text(control, definition))
        if not library_words or not control_words:
            continue
        overlap = len(control_words & library_words) / len(control_words | library_words)
        title_overlap = (
            len(title_words & _words(control.title)) / max(len(title_words), 1)
            if title_words
            else 0.0
        )
        score = overlap * 2.0 + title_overlap * 0.4
        signals: list[str] = []
        if control.domain == facts.domain:
            score += 0.15
            signals.append(f"the same area ({DOMAIN_LABELS.get(control.domain, control.domain)})")
        if control.key in fired:
            score += 0.45
            signals.append("the control's words name this standard")
        fit = _nature_fit(facts.nature, control.nature)
        score += fit
        if fit < 0:
            signals.append("the nature differs")
        score += _frequency_fit(facts.frequency, control.frequency)
        scored.append(
            Candidate(
                library_key=control.key,
                score=round(score, 3),
                status="NONE",
                rationale="",
                applicable=[item.key for item in definition.approved] if definition else [],
                excluded=[],
                missing=_missing(definition, control.key, facts.text),
                signals=signals,
            )
        )
    scored.sort(key=lambda item: item.score, reverse=True)
    top = scored[:limit]
    for index, item in enumerate(top):
        second = top[1].score if len(top) > 1 else 0.0
        if (
            index == 0
            and item.score >= STRONG_SCORE
            and (
                item.score - second >= MARGIN
                or "the control's words name this standard" in item.signals
            )
            and "the nature differs" not in item.signals
        ):
            item.status = "STRONG"
        elif item.score >= PARTIAL_SCORE:
            item.status = "PARTIAL"
        else:
            item.status = "NONE"
        item.rationale = _rules_rationale(facts, item)
    return top


def _rules_rationale(facts: ControlFacts, item: Candidate) -> str:
    control = BY_KEY.get(item.library_key)
    name = control.control_ref if control is not None else item.library_key
    if item.status == "NONE":
        return f"{name} shares few words with this control; the rules do not propose it."
    reasons = ", ".join(item.signals) if item.signals else "the words overlap"
    return (
        f"{name} is a {item.status.lower()} candidate by the rules: {reasons}. "
        "A person confirms the match; the rules do not read the control's meaning."
    )[:1500]


# The model's adjudication


ADJUDICATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "match": {"type": "string", "maxLength": 60},
        "status": {"type": "string", "enum": ["STRONG", "PARTIAL", "NONE"]},
        "rationale": {"type": "string", "maxLength": 1200},
        "applicable": {
            "type": "array",
            "maxItems": 20,
            "items": {"type": "string", "maxLength": 60},
        },
        "excluded": {
            "type": "array",
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "key": {"type": "string", "maxLength": 60},
                    "reason": {"type": "string", "maxLength": 300},
                },
                "required": ["key", "reason"],
            },
        },
        "missing": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 300}},
    },
    "required": ["match", "status", "rationale", "applicable", "excluded", "missing"],
}  # fmt: skip

ADJUDICATE_SYSTEM = """You match one client control, as its risk and control matrix \
describes it, to the firm's standard controls. You read what the control does, not its \
name. You choose only among the candidates given, or none. You never add a requirement \
the control does not state, never invent a threshold, a frequency, or an approver, and \
never treat an attribute as applicable when the control as described would not produce \
the evidence for it. A quoted threshold or deadline in your rationale must appear in the \
control's own words. Where the control does not state something the standard needs, you \
list it as missing for a person to record. A person decides; you propose."""

_THRESHOLD = re.compile(
    r"(?i)\b(\d+\s*(?:business\s+|calendar\s+|working\s+)?(?:days?|hours?|weeks?|months?|%"
    r"|percent)|"
    r"(?:usd|eur|gbp|\$|€|£)\s?\d[\d,.]*k?|\d[\d,.]*\s?(?:usd|eur|gbp))"
)


def _normal(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9%$€£]+", " ", text.lower()).split())


def adjudicate_prompt(facts: ControlFacts, shortlist: list[Candidate]) -> str:
    candidates = []
    for item in shortlist:
        control = BY_KEY.get(item.library_key)
        definition = BY_LIBRARY_KEY.get(item.library_key)
        if control is None:
            continue
        candidates.append(
            {
                "key": control.key,
                "id": control.control_ref,
                "title": control.title,
                "objective": definition.objective if definition else "",
                "what_it_is": control.activity,
                "nature": control.nature,
                "frequency": control.frequency,
                "attributes": [
                    {"key": a.key, "text": a.text}
                    for a in (definition.attributes if definition else ())
                    if a.confidence in TESTED
                ],
                "does_not_apply_when": list(definition.not_applicable) if definition else [],
                "rules_status": item.status,
            }
        )
    data = {
        "client_control": {
            "id": facts.control_ref,
            "title": facts.title,
            "activity": facts.activity,
            "risk": facts.risk,
            "area": DOMAIN_LABELS.get(facts.domain, facts.domain),
            "nature": facts.nature,
            "frequency": facts.frequency,
            "systems": list(facts.applications),
            "client_test_procedures": list(facts.attributes),
        },
        "candidates": candidates,
        "answer": {
            "match": "the key of the one standard this control is, or an empty string",
            "status": "STRONG when the control is this standard as described; PARTIAL when "
            "it is this standard with a material difference you name; NONE otherwise",
            "rationale": "why, quoting the control's own words",
            "applicable": "the matched standard's attribute keys the control would evidence",
            "excluded": "its attribute keys the control as described would not, each with why",
            "missing": "what the standard needs that the control does not state",
        },
    }
    text = json.dumps(data, ensure_ascii=False, indent=1)[:14000]
    return f"Match this client control to one of the firm's standards, or to none.\n\n{text}"


def check_adjudication(
    output: dict[str, Any], facts: ControlFacts, shortlist: list[Candidate]
) -> list[Candidate]:
    """The model's answer, checked: it names a shortlisted standard or none, real
    attribute keys, and no threshold the control does not give. Returns the shortlist with
    the model's judgment on the match and the rest demoted."""
    keys = {item.library_key for item in shortlist}
    match = str(output.get("match", "")).strip()
    status = str(output.get("status", "NONE"))
    if match == "":
        if status != "NONE":
            raise ValueError("no match named with a status")
        for item in shortlist:
            item.status = "NONE"
            item.rationale = f"{str(output.get('rationale', ''))[:1400]}".strip() or item.rationale
        return shortlist
    if match not in keys:
        raise ValueError("the model named a standard outside the shortlist")
    if status == "NONE":
        raise ValueError("a match named with status NONE")
    definition = BY_LIBRARY_KEY.get(match)
    known = {item.key for item in definition.attributes} if definition else set()
    applicable = [str(key) for key in output.get("applicable", []) if str(key) in known]
    excluded = [
        {"key": str(item.get("key", "")), "reason": str(item.get("reason", ""))[:300]}
        for item in output.get("excluded", [])
        if isinstance(item, dict)
        and str(item.get("key", "")) in known
        and str(item.get("reason", "")).strip()
    ]
    if len(applicable) != len(output.get("applicable", [])) or len(excluded) != len(
        output.get("excluded", [])
    ):
        raise ValueError("the model named an attribute the standard does not have")
    if set(applicable) & {item["key"] for item in excluded}:
        raise ValueError("an attribute is both applicable and excluded")
    rationale = str(output.get("rationale", "")).strip()
    if not rationale:
        raise ValueError("no rationale")
    sources = _normal(facts.text)
    for found in _THRESHOLD.finditer(rationale):
        if _normal(found.group(0)) not in sources:
            raise ValueError("the rationale states a threshold the control does not give")
    missing = [str(item)[:300] for item in output.get("missing", []) if str(item).strip()]
    ordered = sorted(shortlist, key=lambda item: 0 if item.library_key == match else 1)
    for item in ordered:
        if item.library_key == match:
            item.status = status  # type: ignore[assignment]
            item.rationale = rationale[:1500]
            item.applicable = applicable
            item.excluded = excluded
            item.missing = missing or item.missing
        else:
            item.status = "NONE"
    return ordered


# Running a match and keeping it


def run_match(
    connection: psycopg.Connection[Any],
    provider: ModelProvider | None,
    facts: ControlFacts,
    actor: UUID,
) -> tuple[list[Candidate], DecidedBy, str]:
    statuses = {
        str(row[0]): effective_status(str(row[1]), row[2], str(row[0]))
        for row in connection.execute(
            "SELECT library_key, status, approved_version FROM library_entries "
            "WHERE organization_id = %s",
            (facts.organization_id,),
        ).fetchall()
    }
    shortlist = rules_candidates(facts, statuses)
    decided: DecidedBy = "RULES"
    note = ""
    call_id: UUID | None = None
    if provider is not None and shortlist:
        call = AgentCaller(
            connection,
            provider,
            Job(
                "evidence-reader",
                "engagement_control",
                facts.control_id,
                facts.organization_id,
                facts.project_id,
                actor,
                agent_instance_id=agent_actor(connection, facts.project_id, "evidence-coordinator"),
            ),  # fmt: skip
        ).generate(
            ModelRequest(
                operation="generate",
                prompt=adjudicate_prompt(facts, shortlist),
                output_schema=ADJUDICATE_SCHEMA,
                allowed_tool_ids=(),
                timeout_seconds=90,
                cancelled=False,
                system=ADJUDICATE_SYSTEM,
            ),
            "library-match/1",
            {"control": str(facts.control_id), "candidates": len(shortlist)},
        )
        status, raw, call_id = call.status, call.raw, call.call_id
        if status == "SUCCEEDED" and raw.output is not None:
            try:
                shortlist = check_adjudication(dict(raw.output), facts, shortlist)
                decided = "MODEL"
            except ValueError as error:
                decided = "FALLBACK"
                note = f"The agent's match was rejected ({error}); the rules' candidates stand."
        else:
            decided = "FALLBACK"
            note = fallback_note(status, "the rules' candidates stand")
    elif provider is None:
        note = "No model is configured; the rules ranked the candidates."
    with transaction(connection) as cursor:
        cursor.execute(
            "DELETE FROM library_match_runs WHERE engagement_control_id = %s", (facts.control_id,)
        )
        row = cursor.execute(
            """
            INSERT INTO library_match_runs (
                organization_id, project_id, engagement_control_id, decided_by, note, no_match,
                model_call_id, requested_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (
                facts.organization_id, facts.project_id, facts.control_id, decided, note[:1000],
                not any(item.status != "NONE" for item in shortlist), call_id, actor,
            ),
        ).fetchone()  # fmt: skip
        assert row is not None
        for rank, item in enumerate(shortlist, start=1):
            cursor.execute(
                """
                INSERT INTO library_matches (
                    run_id, engagement_control_id, library_key, rank, status, score, rationale,
                    applicable, excluded, missing
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row[0], facts.control_id, item.library_key, rank, item.status,
                    min(item.score, 999.999), item.rationale[:1500], Json(item.applicable),
                    Json(item.excluded), Json(item.missing),
                ),
            )  # fmt: skip
        _audit(
            cursor, facts, actor, "library.match",
            {"decided_by": decided, "candidates": [item.library_key for item in shortlist],
             "top_status": shortlist[0].status if shortlist else "NONE"},
        )  # fmt: skip
    return shortlist, decided, note


def _audit(
    cursor: psycopg.Cursor[Any],
    facts: ControlFacts,
    actor: UUID,
    action: str,
    payload: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, %s, 'engagement_control', %s, %s)
        """,
        (facts.organization_id, facts.project_id, actor, action, facts.control_id, Json(payload)),
    )


# Deciding the basis


class BasisWrite(BaseModel):
    basis: TestBasis
    # The standard to follow, for STANDARD or CUSTOM; the control's own when it has one.
    library_key: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,59}$")
    note: str = Field(default="", max_length=1000)


def decide_basis(
    connection: psycopg.Connection[Any],
    facts: ControlFacts,
    actor: UUID,
    write: BasisWrite,
) -> str:
    """A person decides the control's test basis. Following a standard the control does not
    have yet adopts it: the control takes the standard's key, its tested attributes are
    proposed for a person to decide, its low-confidence ones with their question, and the
    control is planned again with the rules. The client's own attributes stay for a
    person to keep or retire. Returns a note for the team."""
    key = write.library_key or facts.library_key
    if write.basis in ("STANDARD", "CUSTOM"):
        if not key or key not in BY_KEY:
            raise MatchState("choose the standard to follow first")
        if write.basis == "STANDARD" and facts.source != "LIBRARY" and facts.library_key != key:
            pass  # adopting a standard for a client's control: handled below
    elif (
        write.basis == "CLIENT" and not facts.client_procedures_stated and facts.source != "LIBRARY"
    ):
        # Allowed: the client's RCM governs even when it states no specific procedure; the
        # plan review says so. A person may still prefer a standard.
        pass
    if write.basis == facts.test_basis and (write.basis == "CLIENT" or key == facts.library_key):
        raise MatchState(f"the control already follows {_basis_words(write.basis)}")
    adopted = False
    with transaction(connection) as cursor:
        if write.basis in ("STANDARD", "CUSTOM") and key != facts.library_key:
            entry = connection.execute(
                "SELECT status, approved_version FROM library_entries "
                "WHERE organization_id = %s AND library_key = %s",
                (facts.organization_id, key),
            ).fetchone()
            if entry is not None and effective_status(str(entry[0]), entry[1], key) == "RETIRED":
                raise MatchState("that standard is retired")
            cursor.execute(
                """
                UPDATE engagement_controls
                SET library_key = %s, library_version = %s, version = version + 1,
                    updated_at = clock_timestamp()
                WHERE id = %s
                """,
                (key, definition_version(key), facts.control_id),
            )
            _propose_tested(cursor, facts, key, actor)
            from ai_workforce_api.library_definitions import link_definitions

            link_definitions(cursor, facts.control_id, actor)
            adopted = True
        cursor.execute(
            """
            UPDATE engagement_controls
            SET test_basis = %s, test_basis_by = %s, test_basis_at = clock_timestamp(),
                test_basis_note = %s, version = version + 1, updated_at = clock_timestamp()
            WHERE id = %s
            """,
            (write.basis, actor, write.note.strip(), facts.control_id),
        )
        _audit(
            cursor, facts, actor, "control.test_basis",
            {"from": facts.test_basis, "to": write.basis, "library_key": key or None,
             "adopted": adopted},
        )  # fmt: skip
    note = f"The control now follows {_basis_words(write.basis)}."
    if adopted or write.basis != facts.test_basis:
        from ai_workforce_api.evidence_plans import generate

        try:
            _changes, _drafts, planned = generate(
                connection, None, facts.organization_id, facts.project_id, facts.control_id, actor
            )
            note = f"{note} {planned}".strip() if adopted else note
        except Exception:  # noqa: BLE001 - planning is the next step, not this decision
            note = f"{note} The plan could not be drawn up again; plan the control again."
    return note[:1000]


def _basis_words(basis: str) -> str:
    return {
        "STANDARD": "the standard",
        "CUSTOM": "a customized standard",
        "CLIENT": "the client's own procedures",
    }.get(basis, basis.lower())


def _propose_tested(
    cursor: psycopg.Cursor[Any], facts: ControlFacts, library_key: str, actor: UUID
) -> int:
    """Propose the standard's tested attributes to the control, for a person to decide; an
    attribute the control already states (by wording) is linked instead of proposed."""
    definition = BY_LIBRARY_KEY.get(library_key)
    control = BY_KEY.get(library_key)
    if definition is None or control is None:
        return 0
    rows = cursor.execute(
        "SELECT id, text, definition_key, status FROM control_attributes "
        "WHERE engagement_control_id = %s",
        (facts.control_id,),
    ).fetchall()
    known = {str(row[2]) for row in rows if row[2] is not None}
    normal = {_normal(str(row[1])): row[0] for row in rows if row[3] in ("APPROVED", "PROPOSED")}
    added = 0
    position = len(rows)
    for item in definition.approved:
        if item.key in known:
            continue
        existing = normal.get(_normal(item.text))
        if existing is not None:
            cursor.execute(
                "UPDATE control_attributes SET definition_key = %s WHERE id = %s",
                (item.key, existing),
            )
            continue
        cursor.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                basis, source_kind, note, proposal, created_by, definition_key
            )
            VALUES (%s, %s, %s, %s, %s, 'PROPOSED', %s, 'LIBRARY', %s, 'ADD', %s, %s)
            """,
            (
                facts.organization_id, facts.project_id, facts.control_id, position, item.text,
                "DOCUMENTED" if "DESIGN" in item.basis else "INFERRED",
                f"Standard {control.control_ref}, {item.confidence.lower()} confidence: "
                f"{item.why}"[:500],
                actor, item.key,
            ),
        )  # fmt: skip
        position += 1
        added += 1
    return added


# What the record shows


def _wording(definition: Definition | None, key: str) -> str:
    """An attribute as a person reads it: its wording, or the key when it is unknown."""
    found = None if definition is None else definition.attribute(key)
    return key if found is None else found.text


class CandidateBody(BaseModel):
    library_key: str
    control_ref: str
    title: str
    objective: str
    rank: int
    status: MatchStatus
    rationale: str
    applicable: list[str]
    excluded: list[dict[str, str]]
    missing: list[str]
    # The firm's methodology review of the standard (library_governance).
    library_status: Status


class RunBody(BaseModel):
    decided_by: DecidedBy
    note: str
    no_match: bool
    computed_at: str


class StandardBody(BaseModel):
    library_key: str
    control_ref: str
    title: str
    library_status: Status


class TestBasisBody(BaseModel):
    control_id: UUID
    source: str
    basis: TestBasis
    # A person's decision, when there is one; otherwise the default by source.
    decided: bool
    decided_by: str | None
    decided_at: str | None
    note: str
    standard: StandardBody | None
    # Whether the client's RCM states a test procedure of its own.
    client_procedures_stated: bool
    client_procedures: list[str]
    run: RunBody | None
    candidates: list[CandidateBody]
    # Whether the viewer may decide the basis and ask for a match (project.update).
    can_decide: bool
    model_available: bool


def _standard(
    connection: psycopg.Connection[Any], organization_id: UUID, key: str
) -> StandardBody | None:
    control = BY_KEY.get(key)
    if control is None:
        return None
    row = connection.execute(
        "SELECT status, approved_version FROM library_entries "
        "WHERE organization_id = %s AND library_key = %s",
        (organization_id, key),
    ).fetchone()
    return StandardBody(
        library_key=key,
        control_ref=control.control_ref,
        title=control.title,
        library_status=effective_status(
            None if row is None else str(row[0]), None if row is None else row[1], key
        ),
    )  # fmt: skip


def test_basis_body(
    connection: psycopg.Connection[Any],
    facts: ControlFacts,
    can_decide: bool,
    model_available: bool,
) -> TestBasisBody:
    decision = connection.execute(
        """
        SELECT c.test_basis, c.test_basis_at, c.test_basis_note,
               coalesce(nullif(u.display_name, ''), u.email)
        FROM engagement_controls c LEFT JOIN users u ON u.id = c.test_basis_by
        WHERE c.id = %s
        """,
        (facts.control_id,),
    ).fetchone()
    run = connection.execute(
        "SELECT id, decided_by, note, no_match, computed_at FROM library_match_runs "
        "WHERE engagement_control_id = %s",
        (facts.control_id,),
    ).fetchone()
    candidates: list[CandidateBody] = []
    if run is not None:
        statuses = {
            str(row[0]): effective_status(str(row[1]), row[2], str(row[0]))
            for row in connection.execute(
                "SELECT library_key, status, approved_version FROM library_entries "
                "WHERE organization_id = %s",
                (facts.organization_id,),
            ).fetchall()
        }
        for row in connection.execute(
            "SELECT library_key, rank, status, rationale, applicable, excluded, missing "
            "FROM library_matches WHERE run_id = %s ORDER BY rank",
            (run[0],),
        ).fetchall():
            control = BY_KEY.get(str(row[0]))
            if control is None:
                continue
            definition = BY_LIBRARY_KEY.get(control.key)
            candidates.append(
                CandidateBody(
                    library_key=control.key,
                    control_ref=control.control_ref,
                    title=control.title,
                    objective=definition.objective if definition else "",
                    rank=int(row[1]),
                    status=row[2],
                    rationale=str(row[3]),
                    # Attributes are named by their wording, not their internal key.
                    applicable=[_wording(definition, str(item)) for item in row[4] or []],
                    excluded=[
                        {
                            "key": _wording(definition, str(item.get("key", ""))),
                            "reason": str(item.get("reason", "")),
                        }
                        for item in row[5] or []
                        if isinstance(item, dict)
                    ],
                    missing=[str(item) for item in row[6] or []],
                    library_status=statuses.get(control.key, "PENDING_REVIEW"),
                )
            )
    return TestBasisBody(
        control_id=facts.control_id,
        source=facts.source,
        basis=facts.test_basis,
        decided=decision is not None and decision[0] is not None,
        decided_by=None if decision is None or decision[0] is None else decision[3],
        decided_at=None if decision is None or decision[1] is None else decision[1].isoformat(),
        note="" if decision is None else str(decision[2]),
        standard=_standard(connection, facts.organization_id, facts.library_key)
        if facts.library_key
        else None,
        client_procedures_stated=facts.client_procedures_stated,
        client_procedures=list(facts.attributes),
        run=None
        if run is None
        else RunBody(
            decided_by=run[1],
            note=str(run[2]),
            no_match=bool(run[3]),
            computed_at=run[4].isoformat(),
        ),
        candidates=candidates,
        can_decide=can_decide,
        model_available=model_available,
    )


# Routes


def register_library_matching(
    app: FastAPI, settings: Settings, provider: ModelProvider | None = None
) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}/test-basis"

    def model() -> ModelProvider | None:
        if provider is not None:
            return provider
        return provider_for(settings) if live_model(settings) else None

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except MatchState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    def allowed(
        connection: psycopg.Connection[Any],
        principal: Principal,
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        action: Action,
    ) -> tuple[ControlFacts, bool]:
        authorize(
            connection,
            principal=principal,
            action=action,
            organization_id=organization_id,
            project_id=project_id,
        )
        if action is not Action.TASK_READ and principal.kind is not PrincipalKind.USER:
            raise AccessDenied()
        facts = load_control(connection, control_id)
        if (
            facts is None
            or facts.project_id != project_id
            or facts.organization_id != organization_id
        ):
            raise NotVisible()
        decides = permits(
            connection,
            principal=principal,
            action=Action.PROJECT_UPDATE,
            organization_id=organization_id,
            project_id=project_id,
        )
        return facts, decides

    @app.get(base)
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> TestBasisBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> TestBasisBody:
            facts, decides = allowed(
                c, p, organization_id, project_id, control_id, Action.TASK_READ
            )
            return test_basis_body(c, facts, decides, model() is not None)

        return run(request, work)

    @app.post(f"{base}/match")
    def match(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> TestBasisBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> TestBasisBody:
            facts, decides = allowed(
                c, p, organization_id, project_id, control_id, Action.PROJECT_UPDATE
            )
            run_match(c, model(), facts, p.id)
            return test_basis_body(c, facts, decides, model() is not None)

        return run(request, work)

    @app.put(base)
    def decide(
        organization_id: UUID,
        project_id: UUID,
        control_id: UUID,
        body: BasisWrite,
        request: Request,
    ) -> TestBasisBody:
        def work(c: psycopg.Connection[Any], p: Principal) -> TestBasisBody:
            facts, decides = allowed(
                c, p, organization_id, project_id, control_id, Action.PROJECT_UPDATE
            )
            decide_basis(c, facts, p.id, body)
            after = load_control(c, control_id)
            assert after is not None
            return test_basis_body(c, after, decides, model() is not None)

        return run(request, work)
