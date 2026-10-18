"""What the agents suggest during engagement setup (Milestone 8.3c), without the model.

The reviewed rules here draft what they can from the engagement's own records: a scope
narrative from the client, the kind of engagement, and the control areas; a period end
from the fiscal year in the engagement's name; the evidence-request cadence from how many
controls there are; and owner emails from the pattern the client's other owners follow.
Claude improves on the narrative and the cadence when a model is configured
(setup_drafting.py). Every suggestion is shown to a person, who accepts or edits it.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from ai_workforce_api.controls import DOMAIN_LABELS, ITGC_DOMAINS

EngagementType = Literal["SOX_ITGC", "SOX_FULL", "IT_AUDIT"]
ENGAGEMENT_TYPES: dict[str, str] = {
    "SOX_ITGC": "SOX IT general controls",
    "SOX_FULL": "SOX ITGC and business process controls",
    "IT_AUDIT": "IT audit",
}
_FISCAL_YEAR = re.compile(r"(?:FY|fiscal year)\s*'?(\d{2}|\d{4})\b|\b(20\d{2})\b", re.I)
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_WORD = re.compile(r"[a-z]+")

MAX_SCOPE = 1500


class SetupDraftBody(BaseModel):
    """The planner's suggestions for setup, as the page shows them."""

    status: Literal["IDLE", "PENDING", "WORKING"]
    drafting: bool
    note: str
    source: Literal["NONE", "RULES", "AGENT"]
    scope_text: str
    period_end: date | None
    pbc_due_days: int | None
    pbc_follow_up_days: int | None
    pbc_max_follow_ups: int | None
    reasons: dict[str, str]
    drafted_at: Any
    version: int


class OwnerSuggestion(BaseModel):
    """An email for an owner the RCM names without one, from the client's pattern."""

    owner_name: str
    owner_email: str
    control_refs: list[str]
    pattern: str


@dataclass(frozen=True)
class SetupFacts:
    """Everything the draft is made from. All of it is the engagement's own records."""

    project_name: str
    client_name: str
    engagement_type: str
    scope: str
    period_end: date | None
    today: date
    # Control counts by standard area, in-scope controls only.
    areas: dict[str, int] = field(default_factory=dict)
    systems: list[str] = field(default_factory=list)
    key_controls: int = 0
    owners: int = 0


# The rules


def fiscal_year_of(name: str, today: date) -> int | None:
    """The fiscal year an engagement's name points at, such as "FY27" or "SOX 2027"."""
    found = _FISCAL_YEAR.search(name)
    if found is None:
        return None
    raw = found.group(1) or found.group(2)
    year = int(raw) + (2000 if len(raw) == 2 else 0)
    return year if today.year - 3 <= year <= today.year + 3 else None


def suggest_period_end(facts: SetupFacts) -> tuple[date | None, str]:
    if facts.period_end is not None:
        return facts.period_end, "Already set."
    year = fiscal_year_of(facts.project_name, facts.today)
    if year is None:
        return None, "Name the fiscal year in the engagement's name, or set the date here."
    return date(year, 12, 31), (
        f"The engagement is for fiscal year {year}; a calendar year end is assumed. "
        "Change it if the client's fiscal year ends on another date."
    )


def suggest_cadence(facts: SetupFacts) -> tuple[tuple[int, int, int], str]:
    """Due days, days between reminders, reminders before escalating."""
    total = sum(facts.areas.values())
    if total >= 40:
        return (14, 4, 2), (
            f"{total} controls means many requests at once; two weeks gives owners room "
            "and a reminder every four days keeps them moving."
        )
    if total == 0:
        return (10, 3, 2), "The usual cadence: ten days, a reminder every three, then escalate."
    return (10, 3, 2), (
        f"{total} controls is a typical first round; ten days with a reminder every three "
        "days and escalation after two is the usual cadence."
    )


def suggest_scope(facts: SetupFacts) -> tuple[str, str]:
    """A scope narrative from the records, in plain audit language."""
    client = facts.client_name or "the client"
    kind = facts.engagement_type
    year = fiscal_year_of(facts.project_name, facts.today)
    period = (
        f"the period ending {facts.period_end.isoformat()}"
        if facts.period_end is not None
        else (f"fiscal year {year}" if year is not None else "the audit period")
    )
    itgc = [DOMAIN_LABELS[d].lower() for d in ITGC_DOMAINS if facts.areas.get(d, 0) > 0]
    business = [
        DOMAIN_LABELS[d].lower()
        for d, n in facts.areas.items()
        if n > 0 and d not in ITGC_DOMAINS and d in DOMAIN_LABELS
    ]
    systems = _join(facts.systems[:8])
    total = sum(facts.areas.values())
    if kind == "IT_AUDIT":
        opening = f"IT audit of {client} for {period}."
    elif kind == "SOX_FULL":
        opening = (
            f"SOX 404 testing of {client}'s IT general controls and business process "
            f"controls for {period}."
        )
    else:
        opening = (
            f"SOX 404 testing of {client}'s IT general controls over financial reporting "
            f"for {period}."
        )
    parts = [opening]
    if systems:
        parts.append(f"In-scope systems: {systems}.")
    if itgc:
        parts.append(f"IT general control areas: {_join(itgc)}.")
    if business:
        parts.append(f"Business process areas: {_join(business)}.")
    if total:
        parts.append(
            f"{total} control{'s' if total != 1 else ''} in scope"
            + (f", {facts.key_controls} key" if facts.key_controls else "")
            + ". Each is walked through, tested for operating effectiveness from evidence "
            "the control owners provide, and independently reviewed."
        )
    else:
        parts.append(
            "The controls in scope come from the risk and control matrix; each is walked "
            "through, tested for operating effectiveness, and independently reviewed."
        )
    text = " ".join(parts)[:MAX_SCOPE]
    reason = (
        "Written from the engagement's name, client, kind, controls, and systems. "
        "Edit it to match the engagement letter."
    )
    return text, reason


def rules_draft(facts: SetupFacts) -> dict[str, Any]:
    """The whole draft from the rules, in the shape the draft record stores."""
    scope, scope_reason = suggest_scope(facts)
    period, period_reason = suggest_period_end(facts)
    (due, follow, escalate), cadence_reason = suggest_cadence(facts)
    return {
        "scope_text": scope,
        "period_end": period,
        "pbc_due_days": due,
        "pbc_follow_up_days": follow,
        "pbc_max_follow_ups": escalate,
        "reasons": {
            "scope": scope_reason,
            "period_end": period_reason,
            "cadence": cadence_reason,
        },
    }


def _join(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


# Owner emails from the client's pattern


_PATTERNS: dict[str, Any] = {
    "first.last": lambda first, last: f"{first}.{last}",
    "firstlast": lambda first, last: f"{first}{last}",
    "flast": lambda first, last: f"{first[0]}{last}",
    "first_last": lambda first, last: f"{first}_{last}",
    "first": lambda first, last: first,
    "last.first": lambda first, last: f"{last}.{first}",
}


def _name_parts(name: str) -> tuple[str, str] | None:
    words = _WORD.findall(name.lower())
    if len(words) < 2:
        return None
    return words[0], words[-1]


def _pattern_of(name: str, email: str) -> tuple[str, str] | None:
    """Which pattern and domain an owner's email follows, if any."""
    parts = _name_parts(name)
    if parts is None or _EMAIL.fullmatch(email) is None:
        return None
    local, domain = email.lower().rsplit("@", 1)
    for key, make in _PATTERNS.items():
        if make(*parts) == local:
            return key, domain
    return None


def owner_email_suggestions(
    controls: list[Any], client_domains: list[str]
) -> list[OwnerSuggestion]:
    """Emails for owners named without one, when the client's other owners share a pattern.

    Each control has owner_name, owner_email, control_ref, and included. A suggestion is
    only made when one pattern and one domain explain every owner email already entered,
    and that domain is one of the client's. It is a suggestion to confirm, never applied
    on its own.
    """
    included = [c for c in controls if getattr(c, "included", True)]
    seen: dict[tuple[str, str], int] = Counter()
    for control in included:
        found = _pattern_of(control.owner_name, control.owner_email)
        if found is not None:
            seen[found] += 1
    if len(seen) != 1:
        return []
    (pattern, domain), _count = next(iter(seen.items()))
    allowed = {d.lower() for d in client_domains}
    if allowed and domain not in allowed:
        return []
    missing: dict[str, list[str]] = {}
    for control in included:
        name = control.owner_name.strip()
        if name and control.owner_email.strip() == "":
            missing.setdefault(name, []).append(control.control_ref)
    suggestions: list[OwnerSuggestion] = []
    for name, refs in missing.items():
        parts = _name_parts(name)
        if parts is None:
            continue
        local = _PATTERNS[pattern](*parts)
        email = f"{local}@{domain}"
        if _EMAIL.fullmatch(email) is None:
            continue
        suggestions.append(
            OwnerSuggestion(owner_name=name, owner_email=email, control_refs=refs, pattern=pattern)
        )
    return suggestions


# The draft record, read


def draft_body(connection: Any, project_id: UUID) -> SetupDraftBody | None:
    row = connection.execute(
        """
        SELECT draft_status, draft_note, source, scope_text, period_end, pbc_due_days,
               pbc_follow_up_days, pbc_max_follow_ups, reasons, drafted_at, version
        FROM setup_drafts WHERE project_id = %s
        """,
        (project_id,),
    ).fetchone()
    if row is None:
        return None
    reasons = row[8] if isinstance(row[8], dict) else {}
    return SetupDraftBody(
        status=row[0],
        drafting=row[0] in ("PENDING", "WORKING"),
        note=str(row[1]),
        source=row[2],
        scope_text=str(row[3]),
        period_end=row[4],
        pbc_due_days=row[5],
        pbc_follow_up_days=row[6],
        pbc_max_follow_ups=row[7],
        reasons={str(k): str(v)[:300] for k, v in reasons.items() if isinstance(v, str)},
        drafted_at=row[9],
        version=int(row[10]),
    )


Methodology = Literal["EXTERNAL_ICFR", "MANAGEMENT_404", "INTERNAL_AUDIT"]
METHODOLOGIES: dict[str, str] = {
    "EXTERNAL_ICFR": "External audit of ICFR (PCAOB AS 2201, integrated)",
    "MANAGEMENT_404": "Management's SOX 404 testing",
    "INTERNAL_AUDIT": "Internal audit or IT audit",
}


class ProfileUpdate(BaseModel):
    client_name: str = Field(max_length=200)
    engagement_type: EngagementType
    period_end: date | None = None
    # Left out: kept as they are. Every methodology requires reviewer independence.
    period_start: date | None = None
    fiscal_year: str | None = Field(default=None, max_length=20)
    methodology: Methodology | None = None
    reporting_objectives: str | None = Field(default=None, max_length=2000)
