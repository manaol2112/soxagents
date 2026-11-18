"""Evidence findings (docs/evidence-intelligence.md, increment 2; migration 0137).

What the agents found wanting in a control's evidence, as records a person disposes of.
Findings are derived, never decided here:

- from a reading (`derive_from_analysis`): each gap the reader names (with the question it
  proposes when the reader gave one, and the passage it rests on when the quote is in the
  file's text), each requested item the file covers in part or not at all, and the
  deterministic checks on the read text (placeholder text, a policy whose version or
  effective date the text does not establish, dates outside the phase's window);
- from a mapping run (`derive_from_mapping`): the records an attribute still lacks, the
  conflicts between passages, and the passages kept apart as concerns;
- from an assurance run (`record_assurance_findings`, docs/evidence-assurance.md): an
  attribute both independent readings of a file find not met, partly met, contradicted
  or, where its request said the file would address it, not addressed. For a file the
  assurance chain covers, the reader's own model-derived findings are held, not proposed:
  they were never checked by a second reading (`ReaderFindings`, `hold_reader_findings`).

A finding is pinned to the plan revision and the file's hash; a later approval of the
plan or a replaced file marks it stale. A later reading on the same request, or the
owner's message, attaches to the open findings and proposes ANSWERED: a person then
resolves, accepts the clarification, asks for more, or dismisses. A follow-up goes to the
owner only when a person sends it, through the request's messages (the owner is emailed a
fresh link), and never from an agent. Uploaded text is untrusted: quotes are taken from
the stored text, cleaned, and shown, never followed.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from ai_workforce_api.authorization import (
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    _call,
    _session_principal,
    authorize,
)
from ai_workforce_api.console_citations import find_quote, location_of
from ai_workforce_api.db import transaction
from ai_workforce_api.inbound import clean_line
from ai_workforce_api.settings import Settings

Source = Literal["READER", "RULES", "MAPPING", "TRACE", "ASSURANCE"]
Kind = Literal[
    "GAP", "PARTIAL", "NOT_COVERED", "PLACEHOLDER", "VERSION", "PERIOD",
    "MISSING", "CONFLICT", "CONCERN", "LATE", "NOT_TRACED", "ACTIVITY",
    "NOT_MET", "PARTLY_MET", "CONTRADICTED", "NOT_ADDRESSED",
]  # fmt: skip
# The kinds only the assurance chain records (migration 0155).
AssuranceKind = Literal["NOT_MET", "PARTLY_MET", "CONTRADICTED", "NOT_ADDRESSED"]
Status = Literal[
    "PROPOSED", "ACCEPTED", "DISMISSED", "SENT", "ANSWERED", "RESOLVED",
    "CLARIFICATION_ACCEPTED", "MORE_NEEDED", "NOT_APPLICABLE", "ESCALATED",
]  # fmt: skip
Decision = Literal[
    "ACCEPT", "EDIT", "DISMISS", "RESOLVE", "CLARIFICATION_ACCEPTED", "MORE_NEEDED",
    "NOT_APPLICABLE", "ESCALATE", "REOPEN",
]  # fmt: skip

# Nothing the agents do moves a finding out of these; only a person's decision does.
OPEN: tuple[str, ...] = ("PROPOSED", "ACCEPTED", "SENT", "ANSWERED", "MORE_NEEDED", "ESCALATED")
CLOSED: tuple[str, ...] = ("DISMISSED", "RESOLVED", "CLARIFICATION_ACCEPTED", "NOT_APPLICABLE")
# A follow-up is sent from these.
SENDABLE: tuple[str, ...] = ("ACCEPTED", "MORE_NEEDED", "ESCALATED")

MAX_PLACEHOLDERS = 3
_PLACEHOLDER = re.compile(
    r"\[(?:\d{1,2}|x+|tbd|tbc|insert[^\]]{0,40}|placeholder[^\]]{0,40})\]"
    r"|\b(?:TBD|TBC)\b|\bX{3,}\b|<insert[^>]{0,40}>|lorem ipsum",
    re.IGNORECASE,
)
_VERSIONED = re.compile(
    r"(?i)\b(?:version|revision|rev\.?\s*\d|effective (?:date|from|as of)|approved (?:on|by|date)|"
    r"last (?:reviewed|updated|revised)|document (?:control|history))\b"
)
_DATE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S*")
_ASKS_FOR_ACCESS = re.compile(
    r"(?i)\b(?:send|share|provide|give)\b[^.\n]{0,40}\b(?:password|credential|login|log-in)s?\b"
)
POLICY_KINDS = ("policy", "design")


class FindingState(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# --- Derivation ------------------------------------------------------------------------


def _fingerprint(*parts: str) -> str:
    joined = "|".join(" ".join(part.split()).lower() for part in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def _clip(text: str, limit: int) -> str:
    clean = clean_line(text, limit + 1)
    if len(clean) <= limit:
        return clean
    cut = clean[:limit]
    stop = max(cut.rfind(". "), cut.rfind("; "), cut.rfind(", "))
    return (cut[:stop] if stop > limit // 2 else cut).rstrip() + "…"


def _title(text: str) -> str:
    clean = _clip(text, 200)
    return clean if len(clean) >= 3 else "Finding"


def _citation(text: str, quote: str, file_id: UUID | None, file_name: str) -> dict[str, Any] | None:
    """The passage a finding rests on, only when the quote is in the file's own text."""
    if file_id is None or not quote.strip():
        return None
    found = find_quote(text, quote)
    if found is None:
        return None
    start, end = found
    place = location_of(text, start)
    page = re.search(r"(?i)page (\d+)", place)
    return {
        "file_id": str(file_id),
        "file_name": file_name,
        "quote": clean_line(text[start:end], 300),
        "location": place,
        "page": int(page.group(1)) if page else None,
        "found": True,
    }


def _line_at(text: str, offset: int) -> str:
    start = text.rfind("\n", 0, offset) + 1
    end = text.find("\n", offset)
    return text[start : end if end >= 0 else len(text)]


class _Draft:
    def __init__(
        self,
        *,
        source: Source,
        kind: Kind,
        fingerprint: str,
        title: str,
        observation: str = "",
        question: str = "",
        expected: str = "",
        citation: dict[str, Any] | None = None,
        requirement_id: UUID | None = None,
        attribute_index: int | None = None,
        attribute_id: UUID | None = None,
        attribute_code: str = "",
        file_id: UUID | None = None,
    ) -> None:
        self.source = source
        self.kind = kind
        self.fingerprint = fingerprint
        self.title = title
        self.observation = clean_line(observation, 1000)
        self.question = clean_line(question, 1000)
        self.expected = clean_line(expected, 300)
        self.citation = citation
        self.requirement_id = requirement_id
        self.attribute_index = attribute_index
        self.attribute_id = attribute_id
        self.attribute_code = attribute_code[:20]
        self.file_id = file_id


def _question_for_gap(gap: str) -> str:
    text = " ".join(gap.split()).rstrip(".")
    if not text:
        return ""
    first = text[0].lower() + text[1:]
    if re.match(r"(?i)^(confirm|provide|clarify|state|explain|share|send|specify|give)\b", text):
        return f"Please {first}."
    return f"Please confirm or provide the following: {first}."


def _requirements_of(
    cursor: psycopg.Cursor[Any], request_id: UUID
) -> dict[str, tuple[str, str, date | None, date | None]]:
    rows = cursor.execute(
        "SELECT id, title, phase, period_start, period_end FROM evidence_requirements "
        "WHERE pbc_request_id = %s",
        (request_id,),
    ).fetchall()
    return {str(r[0]): (str(r[1]), str(r[2]), r[3], r[4]) for r in rows}


def _plan_revision(cursor: psycopg.Cursor[Any], control_id: UUID) -> int | None:
    row = cursor.execute(
        "SELECT approved_revision FROM evidence_plans WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    return None if row is None or row[0] is None else int(row[0])


def period_dates(period: str) -> list[date]:
    """The dates written in the reader's period text. The text is the model's: a date that
    does not exist (2025-02-29) is skipped, never an error that loses the reading (bug hunt,
    9 November 2026)."""
    found: list[date] = []
    for year, month, day in _DATE.findall(period):
        try:
            found.append(date(int(year), int(month), int(day)))
        except ValueError:
            continue
    return found


class ReaderFindings:
    """The reader's own findings of one reading (source READER), kept back until the
    reading's transaction knows whether the assurance chain covers the file
    (docs/evidence-assurance.md, stage 5). `record` proposes them as before; a caller that
    finds the file covered does not call it, and they are never proposed: the reader's
    answer stays on the reading's record."""

    def __init__(self) -> None:
        self._drafts: list[_Draft] = []
        self._context: dict[str, Any] | None = None

    def __len__(self) -> int:
        return len(self._drafts)

    def keep(self, drafts: list[_Draft], **context: Any) -> None:
        self._drafts = drafts
        self._context = context

    def record(self, cursor: psycopg.Cursor[Any]) -> list[UUID]:
        if self._context is None or not self._drafts:
            return []
        drafts, self._drafts = self._drafts, []
        return _record_drafts(cursor, drafts=drafts, **self._context)


def derive_from_analysis(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    analysis_id: UUID,
    *,
    reader: ReaderFindings | None = None,
) -> list[UUID]:
    """The findings a finished reading gives. Idempotent: a finding already on record
    for the same content is left as it is; one proposed from an earlier reading of the
    same file and not found again is marked stale. With `reader`, the reader's own
    findings (source READER) are handed to it instead of being recorded here, for the
    caller to record or to hold; the deterministic checks (source RULES) are always
    recorded here."""
    row = cursor.execute(
        """
        SELECT a.evidence_file_id, a.pbc_request_id, a.classification, a.extracted_text,
               f.content_sha256, f.file_name, r.engagement_control_id, a.status, a.source
        FROM evidence_analyses a
        JOIN evidence_files f ON f.id = a.evidence_file_id
        LEFT JOIN pbc_requests r ON r.id = a.pbc_request_id
        WHERE a.id = %s AND a.project_id = %s
        """,
        (analysis_id, project_id),
    ).fetchone()
    if row is None or row[7] != "READY" or not isinstance(row[2], dict) or row[6] is None:
        return []
    file_id = UUID(str(row[0]))
    request_id = None if row[1] is None else UUID(str(row[1]))
    classification: dict[str, Any] = row[2]
    text = str(row[3] or "")
    digest = str(row[4] or "")
    file_name = str(row[5] or "")
    control_id = UUID(str(row[6]))
    by_rules = row[8] in ("RULES", "FALLBACK")
    requirements = _requirements_of(cursor, request_id) if request_id is not None else {}
    drafts: list[_Draft] = []

    # The reader's gaps, each with the question it proposed when it gave one.
    follow_ups = {
        int(item.get("gap_index", -1)): item
        for item in classification.get("follow_ups") or []
        if isinstance(item, dict)
    }
    for index, gap in enumerate(classification.get("gaps") or []):
        gap_text = " ".join(str(gap).split())
        if not gap_text:
            continue
        proposed = follow_ups.get(index, {})
        drafts.append(
            _Draft(
                source="READER",
                kind="GAP",
                fingerprint=_fingerprint("READER", "GAP", str(file_id), gap_text),
                title=_title(gap_text),
                observation=str(proposed.get("observation") or gap_text),
                question=str(proposed.get("question") or _question_for_gap(gap_text)),
                expected=str(proposed.get("expected") or ""),
                citation=_citation(text, str(proposed.get("quote") or ""), file_id, file_name),
                file_id=file_id,
            )
        )

    # Each requested item the file covers in part or not at all. The rules match a file's
    # kind, not its detail, so a reading by the rules says nothing about an item.
    if not by_rules:
        for item in classification.get("items") or []:
            if not isinstance(item, dict):
                continue
            requirement_id = str(item.get("requirement_id") or "")
            coverage = item.get("coverage")
            if requirement_id not in requirements or coverage not in ("PARTIAL", "NOT_COVERED"):
                continue
            title, _phase, _start, _end = requirements[requirement_id]
            note = " ".join(str(item.get("note") or "").split())
            partial = coverage == "PARTIAL"
            drafts.append(
                _Draft(
                    source="READER",
                    kind="PARTIAL" if partial else "NOT_COVERED",
                    fingerprint=_fingerprint(
                        "READER", str(coverage), str(file_id), requirement_id, note
                    ),
                    title=f"{'Covers in part' if partial else 'Does not cover'}: {title}"[:200],
                    observation=note or "The reader found nothing in this file for it.",
                    question=(
                        f'Please provide the part of "{title}" that is still missing'
                        + (f": {note.rstrip('.')}." if note else ".")
                        if partial
                        else f'Please provide evidence that shows "{title}".'
                    ),
                    requirement_id=UUID(requirement_id),
                    file_id=file_id,
                )
            )

    # Deterministic checks on the read text.
    seen_lines: set[str] = set()
    for match in _PLACEHOLDER.finditer(text):
        line = _line_at(text, match.start()).strip()
        if not line or line in seen_lines:
            continue
        seen_lines.add(line)
        if len(seen_lines) > MAX_PLACEHOLDERS:
            break
        drafts.append(
            _Draft(
                source="RULES",
                kind="PLACEHOLDER",
                fingerprint=_fingerprint("RULES", "PLACEHOLDER", str(file_id), line),
                title=f"Placeholder text: {_clip(match.group(0), 40)}",
                observation=f"The document still carries placeholder text: “{_clip(line, 200)}”.",
                question=(
                    "Please provide the approved version of the document, with the "
                    f"placeholder “{_clip(match.group(0), 40)}” completed."
                ),
                expected="The approved document, complete",
                citation=_citation(text, line[:200], file_id, file_name),
                file_id=file_id,
            )
        )
    kind = str(classification.get("kind") or "")
    if kind in POLICY_KINDS and text.strip() and not _VERSIONED.search(text):
        drafts.append(
            _Draft(
                source="RULES",
                kind="VERSION",
                fingerprint=_fingerprint("RULES", "VERSION", str(file_id)),
                title="Version and effective date not established",
                observation=(
                    "The text read from the document states no version, approval or "
                    "effective date, so the version in force during the period cannot be "
                    "established from it."
                ),
                question=(
                    "Please provide the approved version of this document effective during "
                    "the audit period, including its approval and effective dates."
                ),
                expected="The approved version with its dates",
                file_id=file_id,
            )
        )
    period = str(classification.get("period") or "")
    dates = period_dates(period)
    if dates:
        for requirement_id, (title, phase, start, end) in requirements.items():
            if phase == "DESIGN" or start is None or end is None:
                continue
            if all(found < start or found > end for found in dates):
                drafts.append(
                    _Draft(
                        source="RULES",
                        kind="PERIOD",
                        fingerprint=_fingerprint("RULES", "PERIOD", str(file_id), requirement_id),
                        title=f"Dates outside the window: {title}"[:200],
                        observation=(
                            f"The file shows {_clip(period, 120)}; the item covers "
                            f"{start.isoformat()} to {end.isoformat()}."
                        ),
                        question=(
                            f'Please provide "{title}" for {start.isoformat()} to '
                            f"{end.isoformat()}; the file provided shows another period."
                        ),
                        expected="Evidence dated within the window",
                        requirement_id=UUID(requirement_id),
                        file_id=file_id,
                    )
                )

    now = drafts
    if reader is not None:
        now = [draft for draft in drafts if draft.source != "READER"]
        reader.keep(
            [draft for draft in drafts if draft.source == "READER"],
            organization_id=organization_id, project_id=project_id, control_id=control_id,
            analysis_id=analysis_id, mapping_run_id=None, request_id=request_id,
            plan_revision=_plan_revision(cursor, control_id), digest=digest,
        )  # fmt: skip
    created = _record_drafts(
        cursor, organization_id, project_id, control_id, now,
        analysis_id=analysis_id, mapping_run_id=None, request_id=request_id,
        plan_revision=_plan_revision(cursor, control_id), digest=digest,
    )  # fmt: skip
    # A finding proposed from an earlier reading of this file and not found again.
    stale = cursor.execute(
        """
        SELECT id, status FROM evidence_findings
        WHERE evidence_file_id = %s AND source IN ('READER', 'RULES') AND NOT stale
          AND status = 'PROPOSED' AND fingerprint <> ALL(%s)
        """,
        (file_id, [draft.fingerprint for draft in drafts] or [""]),
    ).fetchall()
    for finding_id, status in stale:
        _mark_stale(
            cursor, UUID(str(finding_id)), str(status),
            "The file was read again and this was not found.", {"analysis_id": str(analysis_id)},
        )  # fmt: skip
    return created


def derive_from_mapping(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    run_id: UUID,
) -> list[UUID]:
    """The findings a mapping run gives: what each attribute still lacks (when files were
    there to look in), the conflicts between passages, and the concerns."""
    run = cursor.execute(
        "SELECT plan_revision, files FROM evidence_mapping_runs WHERE id = %s", (run_id,)
    ).fetchone()
    if run is None:
        return []
    files = {
        str(entry.get("file_name")): entry for entry in (run[1] or []) if isinstance(entry, dict)
    }
    rows = cursor.execute(
        """
        SELECT attribute_index, attribute_text, candidates, "references", missing, conflicts,
               concerns
        FROM evidence_mappings WHERE run_id = %s ORDER BY attribute_index
        """,
        (run_id,),
    ).fetchall()
    approved = approved_attributes(cursor, control_id)
    drafts: list[_Draft] = []
    for index, attribute, candidates, references, missing, conflicts, concerns in rows:
        index = int(index)
        attribute = str(attribute)
        attribute_id, attribute_code = attribute_at(approved, index)
        refs = [r for r in (references or []) if isinstance(r, dict)]
        named = [c for c in (candidates or []) if isinstance(c, dict)]
        only = files.get(str(named[0].get("file_name"))) if len(named) == 1 else None
        only_id = UUID(str(only["file_id"])) if only is not None and only.get("file_id") else None
        for text in missing or []:
            text = " ".join(str(text).split())
            if not text or not named:
                continue
            drafts.append(
                _Draft(
                    source="MAPPING",
                    kind="MISSING",
                    fingerprint=_fingerprint(
                        "MAPPING", "MISSING", str(control_id), str(index), text
                    ),
                    title=_title(text),
                    observation=f"For “{_clip(attribute, 120)}”: {text}",
                    question=f"Please provide {text[0].lower() + text[1:].rstrip('.')}.",
                    expected="The record itself, not the policy that describes it",
                    attribute_index=index,
                    attribute_id=attribute_id,
                    attribute_code=attribute_code,
                    file_id=only_id,
                )
            )
        for conflict in conflicts or []:
            if not isinstance(conflict, dict):
                continue
            text = " ".join(str(conflict.get("text") or "").split())
            cited = [
                refs[at]
                for at in conflict.get("references") or []
                if isinstance(at, int) and 0 <= at < len(refs)
            ]
            first = cited[0] if cited else None
            if not text:
                continue
            drafts.append(
                _Draft(
                    source="MAPPING",
                    kind="CONFLICT",
                    fingerprint=_fingerprint(
                        "MAPPING", "CONFLICT", str(control_id), str(index), text
                    ),
                    title=_title(text),
                    observation=_conflict_observation(attribute, text, cited),
                    question=(
                        f"The records disagree: {text.rstrip('.')}. Please confirm which "
                        "stands and provide the record that shows it."
                    ),
                    expected="The record in force, with its date",
                    citation=_reference_citation(first),
                    attribute_index=index,
                    attribute_id=attribute_id,
                    attribute_code=attribute_code,
                    file_id=_file_of(first),
                )
            )
        for concern in concerns or []:
            if not isinstance(concern, dict):
                continue
            quote = " ".join(str(concern.get("quote") or "").split())
            if not quote:
                continue
            entry = files.get(str(concern.get("file_name") or ""))
            file_id = UUID(str(entry["file_id"])) if entry and entry.get("file_id") else None
            location = str(concern.get("location") or "")
            page = re.search(r"(?i)page (\d+)", location)
            drafts.append(
                _Draft(
                    source="MAPPING",
                    kind="CONCERN",
                    fingerprint=_fingerprint(
                        "MAPPING", "CONCERN", str(control_id), str(index), quote
                    ),
                    title=f"{_concern_word(str(concern.get('kind') or ''))}: {_clip(quote, 120)}"[
                        :200
                    ],
                    observation=str(concern.get("reason") or ""),
                    question="",
                    citation=(
                        None
                        if file_id is None
                        else {
                            "file_id": str(file_id),
                            "file_name": str(concern.get("file_name") or ""),
                            "quote": clean_line(quote, 300),
                            "location": location,
                            "page": int(page.group(1)) if page else None,
                            "found": True,
                        }
                    ),
                    attribute_index=index,
                    attribute_id=attribute_id,
                    attribute_code=attribute_code,
                    file_id=file_id,
                )
            )
    created = _record_drafts(
        cursor, organization_id, project_id, control_id, drafts,
        analysis_id=None, mapping_run_id=run_id, request_id=None,
        plan_revision=int(run[0]), digest="",
    )  # fmt: skip
    stale = cursor.execute(
        """
        SELECT id, status FROM evidence_findings
        WHERE engagement_control_id = %s AND source = 'MAPPING' AND NOT stale
          AND mapping_run_id <> %s AND status = 'PROPOSED' AND fingerprint <> ALL(%s)
        """,
        (control_id, run_id, [draft.fingerprint for draft in drafts] or [""]),
    ).fetchall()
    for finding_id, status in stale:
        _mark_stale(
            cursor, UUID(str(finding_id)), str(status),
            "The evidence was mapped again and this was not found.", {"run_id": str(run_id)},
        )  # fmt: skip
    return created


_CONCERN_WORDS = {
    "INSTRUCTION": "Instruction to the reader",
    "IMPERSONATION": "Claims to speak for someone",
    "AUDIT_CLAIM": "Claim about the audit",
    "UNCORROBORATED": "Needs corroboration",
}


def _concern_word(kind: str) -> str:
    return _CONCERN_WORDS.get(kind, "Kept apart for review")


def approved_attributes(cursor: psycopg.Cursor[Any], control_id: UUID) -> list[tuple[UUID, str]]:
    """The control's approved attributes in the order the mapping reads them (the same
    order the test plan shows), each with its own identifier and code."""
    rows = cursor.execute(
        """
        SELECT id, code FROM control_attributes
        WHERE engagement_control_id = %s AND status = 'APPROVED'
        ORDER BY position, created_at
        """,
        (control_id,),
    ).fetchall()
    return [(UUID(str(row[0])), str(row[1] or "")) for row in rows]


def attribute_at(approved: list[tuple[UUID, str]], index: int) -> tuple[UUID | None, str]:
    """The approved attribute at a mapping index: its identifier and code; A{n} when the
    plan carries no code for it, and no identifier when the index is past the list."""
    if 0 <= index < len(approved):
        attribute_id, code = approved[index]
        return attribute_id, code or f"A{index + 1}"
    return None, f"A{index + 1}"


def _conflict_observation(attribute: str, text: str, cited: list[dict[str, Any]]) -> str:
    quoted = " ".join(
        f"“{_clip(str(r.get('quote') or ''), 120)}” "
        f"({r.get('location') or 'in the file'}, {r.get('file_name') or 'file'})."
        for r in cited[:2]
    )
    return f"For “{_clip(attribute, 120)}”: {text} {quoted}".strip()


def _reference_citation(reference: dict[str, Any] | None) -> dict[str, Any] | None:
    if reference is None or not reference.get("file_id"):
        return None
    page = reference.get("page")
    return {
        "file_id": str(reference["file_id"]),
        "file_name": str(reference.get("file_name") or ""),
        "quote": clean_line(str(reference.get("quote") or ""), 300),
        "location": str(reference.get("location") or ""),
        "page": int(page) if isinstance(page, int) else None,
        "found": bool(reference.get("found", True)),
    }


def _file_of(reference: dict[str, Any] | None) -> UUID | None:
    if reference is None or not reference.get("file_id"):
        return None
    try:
        return UUID(str(reference["file_id"]))
    except ValueError:
        return None


def _record_drafts(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    drafts: list[_Draft],
    *,
    analysis_id: UUID | None,
    mapping_run_id: UUID | None,
    request_id: UUID | None,
    plan_revision: int | None,
    digest: str,
    instance_id: UUID | None = None,
    assessment_id: UUID | None = None,
) -> list[UUID]:
    created: list[UUID] = []
    for draft in drafts:
        row = cursor.execute(
            """
            INSERT INTO evidence_findings (
                organization_id, project_id, engagement_control_id, evidence_file_id,
                analysis_id, mapping_run_id, requirement_id, pbc_request_id, attribute_index,
                attribute_id, attribute_code,
                source, kind, fingerprint, title, observation, question, expected, citation,
                plan_revision, file_sha256, walkthrough_instance_id, assessment_id
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s
            )
            ON CONFLICT (engagement_control_id, fingerprint) DO NOTHING
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                control_id,
                draft.file_id,
                analysis_id,
                mapping_run_id,
                draft.requirement_id,
                request_id,
                draft.attribute_index,
                draft.attribute_id,
                draft.attribute_code,
                draft.source,
                draft.kind,
                draft.fingerprint,
                draft.title,
                draft.observation,
                draft.question,
                draft.expected,
                None if draft.citation is None else Json(draft.citation),
                plan_revision,
                digest,
                instance_id,
                assessment_id,
            ),  # fmt: skip
        ).fetchone()
        if row is None:
            continue
        finding_id = UUID(str(row[0]))
        _event(
            cursor, finding_id, organization_id, project_id, "PROPOSED",
            "AGENT" if draft.source in ("READER", "MAPPING", "ASSURANCE") else "SYSTEM", None,
            "PROPOSED", "PROPOSED",
            note="", question=draft.question,
            points_at={
                k: v
                for k, v in (
                    ("analysis_id", None if analysis_id is None else str(analysis_id)),
                    ("run_id", None if mapping_run_id is None else str(mapping_run_id)),
                    ("walkthrough_instance_id", None if instance_id is None else str(instance_id)),
                    ("assessment_id", None if assessment_id is None else str(assessment_id)),
                )
                if v is not None
            },
        )  # fmt: skip
        created.append(finding_id)
    return created


def _event(
    cursor: psycopg.Cursor[Any],
    finding_id: UUID,
    organization_id: UUID,
    project_id: UUID,
    event: str,
    actor_kind: str,
    actor: UUID | None,
    before: str,
    after: str,
    *,
    note: str = "",
    question: str = "",
    points_at: dict[str, Any] | None = None,
) -> None:
    cursor.execute(
        """
        INSERT INTO evidence_finding_events (
            finding_id, organization_id, project_id, event, actor_kind, actor_user_id,
            status_before, status_after, note, question, points_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            finding_id,
            organization_id,
            project_id,
            event,
            actor_kind,
            actor,
            before,
            after,
            clean_line(note, 1000),
            clean_line(question, 1000),
            Json(points_at or {}),
        ),  # fmt: skip
    )


def _mark_stale(
    cursor: psycopg.Cursor[Any],
    finding_id: UUID,
    status: str,
    reason: str,
    points_at: dict[str, Any],
) -> None:
    row = cursor.execute(
        """
        UPDATE evidence_findings
        SET stale = true, stale_reason = %s, version = version + 1
        WHERE id = %s AND NOT stale
        RETURNING organization_id, project_id
        """,
        (clean_line(reason, 300), finding_id),
    ).fetchone()
    if row is None:
        return
    _event(
        cursor, finding_id, UUID(str(row[0])), UUID(str(row[1])), "STALE", "SYSTEM", None,
        status, status, note=reason, points_at=points_at,
    )  # fmt: skip


# --- What later arrivals do to open findings -----------------------------------------


def mark_stale_for_control(
    cursor: psycopg.Cursor[Any], control_id: UUID, revision: int, reason: str
) -> int:
    """The plan was approved again: open findings pinned to an earlier revision are stale.
    Not the assurance chain's: those are pinned to their run's basis (the file, the
    attributes, the requirement's links), and go stale with their run when it changes
    (mark_stale_for_assessment), so an issue both readings found never goes stale while
    its run still stands."""
    rows = cursor.execute(
        """
        SELECT id, status FROM evidence_findings
        WHERE engagement_control_id = %s AND NOT stale AND status = ANY(%s)
          AND source <> 'ASSURANCE'
          AND (plan_revision IS NULL OR plan_revision < %s)
        """,
        (control_id, list(OPEN), revision),
    ).fetchall()
    for finding_id, status in rows:
        _mark_stale(cursor, UUID(str(finding_id)), str(status), reason, {"plan_revision": revision})
    return len(rows)


def mark_stale_for_file(
    cursor: psycopg.Cursor[Any], file_id: UUID, reason: str, points_at: dict[str, Any]
) -> int:
    """The file was replaced or withdrawn: its open findings are stale."""
    rows = cursor.execute(
        "SELECT id, status FROM evidence_findings "
        "WHERE evidence_file_id = %s AND NOT stale AND status = ANY(%s)",
        (file_id, list(OPEN)),
    ).fetchall()
    for finding_id, status in rows:
        _mark_stale(cursor, UUID(str(finding_id)), str(status), reason, points_at)
    return len(rows)


# --- The assurance chain's findings (docs/evidence-assurance.md, stage 5) --------------

HELD_FOR_ASSURANCE = (
    "The file is checked against the attributes by two independent readings; the "
    "reader's own finding was not checked by a second reading."
)


@dataclass(frozen=True)
class AssuranceIssue:
    """An attribute both readings of a file agree is not met, partly met, contradicted,
    or not addressed where its request said it would be."""

    kind: AssuranceKind
    attribute_id: UUID
    attribute_code: str
    title: str
    observation: str
    question: str
    expected: str
    citation: dict[str, Any] | None
    # The file the finding points at (the cited passage's, or the only file read) and its
    # content hash; None where the issue rests on several files and no passage.
    file_id: UUID | None = None
    digest: str = ""


def assurance_fingerprint(
    requirement_id: UUID, attribute_id: UUID, basis_sha256: str, assessment_id: UUID | None = None
) -> str:
    """An assurance finding's fingerprint: the requirement, the attribute and the basis;
    with a run, that run's own (see record_assurance_findings)."""
    parts = ["ASSURANCE", str(requirement_id), str(attribute_id), basis_sha256]
    return _fingerprint(*parts, *([] if assessment_id is None else [str(assessment_id)]))


@dataclass(frozen=True)
class AssuranceFindingRef:
    id: UUID
    fingerprint: str
    requirement_id: UUID | None
    attribute_id: UUID | None
    assessment_id: UUID | None
    status: str
    stale: bool


def assurance_findings(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[AssuranceFindingRef]:
    """The control's assurance findings, oldest first."""
    return [
        AssuranceFindingRef(
            id=UUID(str(row[0])),
            fingerprint=str(row[1]),
            requirement_id=None if row[2] is None else UUID(str(row[2])),
            attribute_id=None if row[3] is None else UUID(str(row[3])),
            assessment_id=None if row[4] is None else UUID(str(row[4])),
            status=str(row[5]),
            stale=bool(row[6]),
        )
        for row in connection.execute(
            "SELECT id, fingerprint, requirement_id, attribute_id, assessment_id, status, stale "
            "FROM evidence_findings "
            "WHERE engagement_control_id = %s AND project_id = %s AND source = 'ASSURANCE' "
            "ORDER BY created_at, id",
            (control_id, project_id),
        ).fetchall()
    ]


def in_hand(status: str) -> bool:
    """A finding a person has acted on and not closed: accepted, sent, answered, asked
    again, escalated. A new check never marks it stale; its result is attached to it."""
    return status in OPEN and status != "PROPOSED"


def attach_assurance_result(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    requirement_id: UUID,
    attribute_id: UUID,
    attribute_code: str,
    assessment_id: UUID,
    verdict: str,
    result: str = "",
) -> bool:
    """A new run's result for an attribute, attached to the issue on it a person already
    has in hand (accepted, sent, answered...), from an earlier run of the same request.
    A new run that supports the attribute proposes ANSWERED; any other result is noted on
    the finding's history and leaves its status. Nothing is closed, and the finding is
    never marked stale by the new run: a person decides. Returns whether such a finding
    is in hand (the new run then records no finding of its own for the attribute). Once
    per finding and run."""
    rows = cursor.execute(
        """
        SELECT id, status FROM evidence_findings f
        WHERE source = 'ASSURANCE' AND requirement_id = %s AND attribute_id = %s
          AND NOT stale AND status = ANY(%s) AND assessment_id <> %s
          AND NOT EXISTS (
              SELECT 1 FROM evidence_finding_events v
              WHERE v.finding_id = f.id AND v.event = 'REASSESSED'
                AND v.points_at ->> 'assessment_id' = %s::text
          )
        FOR UPDATE
        """,
        (
            requirement_id, attribute_id, [x for x in OPEN if x != "PROPOSED"], assessment_id,
            str(assessment_id),
        ),
    ).fetchall()  # fmt: skip
    for finding_id, status in rows:
        after = str(status)
        if verdict == "SUPPORTED":
            after = "ANSWERED"
            note = (
                f"A new check of the request's evidence finds attribute {attribute_code} "
                "supported by both readings. A person decides whether this resolves it."
            )
            if status != "ANSWERED":
                cursor.execute(
                    "UPDATE evidence_findings SET status = 'ANSWERED', version = version + 1 "
                    "WHERE id = %s",
                    (finding_id,),
                )
        elif verdict == "ISSUE":
            phrase = {
                "CONTRADICTED": "contradicted",
                "NOT_MET": "not met",
                "PARTLY_MET": "met in part",
                "NOT_ADDRESSED": "not addressed",
            }.get(result, "not shown")
            note = (
                f"A new check of the request's evidence finds attribute {attribute_code} "
                f"{phrase}. A person decides."
            )
        else:
            note = (
                f"A new check of the request's evidence does not settle attribute "
                f"{attribute_code}. A person decides."
            )
        _event(
            cursor, UUID(str(finding_id)), organization_id, project_id, "REASSESSED", "AGENT",
            None, str(status), after, note=note,
            points_at={"assessment_id": str(assessment_id), "verdict": verdict},
        )  # fmt: skip
    in_hand_now = cursor.execute(
        "SELECT 1 FROM evidence_findings WHERE source = 'ASSURANCE' AND requirement_id = %s "
        "AND attribute_id = %s AND NOT stale AND status = ANY(%s) AND assessment_id <> %s "
        "LIMIT 1",
        (requirement_id, attribute_id, [x for x in OPEN if x != "PROPOSED"], assessment_id),
    ).fetchone()
    return in_hand_now is not None


def record_assurance_findings(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    assessment_id: UUID,
    issues: list[AssuranceIssue],
    *,
    requirement_id: UUID,
    request_id: UUID | None,
    basis_sha256: str,
) -> list[UUID]:
    """The findings of one reviewed assurance run: one per requirement, attribute and
    basis, pinned to the run. Saving the same run again adds nothing, and neither does a
    run that copies an earlier one of the same basis while that finding stands (open, or
    disposed of by a person: what they closed on this very basis is not raised again). A
    run on a changed basis records its own, and the earlier run's go stale with it. Where
    the finding of this basis went stale (the basis changed and came back), the issue is
    recorded again for this run, so an issue both readings agree on is never left without
    a finding a person can act on. A person accepts, edits, sends and resolves them as any
    other finding."""
    created: list[UUID] = []
    for issue in issues:
        fingerprint = assurance_fingerprint(requirement_id, issue.attribute_id, basis_sha256)
        earlier = cursor.execute(
            "SELECT stale, assessment_id FROM evidence_findings "
            "WHERE engagement_control_id = %s AND fingerprint = %s",
            (control_id, fingerprint),
        ).fetchone()
        if earlier is not None and earlier[0] and earlier[1] != assessment_id:
            fingerprint = assurance_fingerprint(
                requirement_id, issue.attribute_id, basis_sha256, assessment_id
            )
        draft = _Draft(
            source="ASSURANCE",
            kind=issue.kind,
            fingerprint=fingerprint,
            title=_title(issue.title),
            observation=issue.observation,
            question=issue.question,
            expected=issue.expected,
            citation=issue.citation,
            requirement_id=requirement_id,
            attribute_id=issue.attribute_id,
            attribute_code=issue.attribute_code,
            file_id=issue.file_id,
        )
        created += _record_drafts(
            cursor, organization_id, project_id, control_id, [draft],
            analysis_id=None, mapping_run_id=None, request_id=request_id,
            plan_revision=_plan_revision(cursor, control_id), digest=issue.digest,
            assessment_id=assessment_id,
        )  # fmt: skip
    return created


def mark_stale_for_assessment(cursor: psycopg.Cursor[Any], assessment_id: UUID, reason: str) -> int:
    """The assurance run went out of date: its findings nobody has acted on are stale. One
    a person has in hand (accepted, sent, answered...) is not: a client's reply or upload
    does not take it from them before they decide; the next run's result is attached to
    it instead (attach_assurance_result)."""
    rows = cursor.execute(
        "SELECT id, status FROM evidence_findings "
        "WHERE assessment_id = %s AND NOT stale AND status = 'PROPOSED'",
        (assessment_id,),
    ).fetchall()
    for finding_id, status in rows:
        _mark_stale(
            cursor, UUID(str(finding_id)), str(status), reason,
            {"assessment_id": str(assessment_id)},
        )  # fmt: skip
    return len(rows)


def hold_reader_findings(cursor: psycopg.Cursor[Any], file_id: UUID) -> int:
    """The assurance chain now covers the file: the reader's own findings on it that
    nobody has decided are no longer proposed. They stay on record, marked stale with
    the reason; a finding a person already accepted, sent or closed is theirs and is
    left as it is. The deterministic checks (source RULES) stay."""
    rows = cursor.execute(
        "SELECT id, status FROM evidence_findings "
        "WHERE evidence_file_id = %s AND source = 'READER' AND NOT stale "
        "AND status = 'PROPOSED'",
        (file_id,),
    ).fetchall()
    for finding_id, status in rows:
        _mark_stale(
            cursor, UUID(str(finding_id)), str(status), HELD_FOR_ASSURANCE,
            {"file_id": str(file_id)},
        )  # fmt: skip
    return len(rows)


def reassess_on_reading(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    analysis_id: UUID,
) -> int:
    """A later reading on a request with findings a person sent or accepted, or already
    answered: the file is attached to them and ANSWERED is proposed. A finding on an item
    the new file covers says so; the rest say a file arrived. A person decides what it
    resolves."""
    row = cursor.execute(
        """
        SELECT a.evidence_file_id, a.pbc_request_id, a.classification, f.file_name
        FROM evidence_analyses a JOIN evidence_files f ON f.id = a.evidence_file_id
        WHERE a.id = %s AND a.status = 'READY'
        """,
        (analysis_id,),
    ).fetchone()
    if row is None or row[1] is None:
        return 0
    file_id = UUID(str(row[0]))
    request_id = UUID(str(row[1]))
    classification = row[2] if isinstance(row[2], dict) else {}
    covered = {
        str(item.get("requirement_id"))
        for item in classification.get("items") or []
        if isinstance(item, dict) and item.get("coverage") == "COVERED"
    }
    # The file covers only the items it serves (evidence_plans.request_file_serves): filed
    # for one item, that item and those it is linked to; never another item its reading
    # names (a D&I evidence wizard file is read against every D&I item of its control).
    filed_for = cursor.execute(
        "SELECT requirement_id FROM evidence_matches "
        "WHERE evidence_file_id = %s AND status = 'FILED' AND requirement_id IS NOT NULL",
        (file_id,),
    ).fetchone()
    if filed_for is not None:
        covered &= {
            str(filed_for[0]),
            *(
                str(linked)
                for (linked,) in cursor.execute(
                    "SELECT requirement_id FROM evidence_requirement_files "
                    "WHERE evidence_file_id = %s AND status = 'LINKED'",
                    (file_id,),
                ).fetchall()
            ),
        }
    # An assurance finding rests on all of a requirement's files, often with no single
    # file of its own: it is matched on its requirement, whichever request carries it now.
    open_rows = cursor.execute(
        """
        SELECT id, status, requirement_id FROM evidence_findings
        WHERE status = ANY(%(statuses)s)
          AND (evidence_file_id <> %(file)s
               OR (source = 'ASSURANCE' AND evidence_file_id IS NULL))
          AND (
              pbc_request_id = %(request)s
              OR (source = 'ASSURANCE' AND requirement_id IN (
                  SELECT q.id FROM evidence_requirements q WHERE q.pbc_request_id = %(request)s
                  UNION
                  SELECT m.requirement_id FROM evidence_matches m
                  WHERE m.evidence_file_id = %(file)s AND m.requirement_id IS NOT NULL
              ))
          )
        """,
        {
            "request": request_id,
            "statuses": ["ACCEPTED", "SENT", "ANSWERED", "MORE_NEEDED", "ESCALATED"],
            "file": file_id,
        },
    ).fetchall()
    for finding_id, status, requirement_id in open_rows:
        covers = requirement_id is not None and str(requirement_id) in covered
        cursor.execute(
            """
            UPDATE evidence_findings
            SET status = 'ANSWERED', answered_by_file_id = %s, version = version + 1
            WHERE id = %s
            """,
            (file_id, finding_id),
        )
        _event(
            cursor, UUID(str(finding_id)), organization_id, project_id, "REASSESSED", "AGENT",
            None, str(status), "ANSWERED",
            note=(
                f"{row[3]} arrived and the reader finds it covers the item. A person decides."
                if covers
                else f"{row[3]} arrived on the request. A person decides whether it answers this."
            ),
            points_at={"file_id": str(file_id), "analysis_id": str(analysis_id), "covers": covers},
        )  # fmt: skip
    return len(open_rows)


def _owner_activity(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    note: str,
    points_at: dict[str, Any],
    message_id: UUID | None = None,
) -> int:
    """Something came back from the owner on the request: it is attached to the findings
    sent or accepted there and ANSWERED is proposed. A person decides what it resolves."""
    rows = cursor.execute(
        "SELECT id, status FROM evidence_findings WHERE pbc_request_id = %s AND status = ANY(%s)",
        (request_id, ["SENT", "ACCEPTED", "ANSWERED", "MORE_NEEDED", "ESCALATED"]),
    ).fetchall()
    for finding_id, status in rows:
        cursor.execute(
            """
            UPDATE evidence_findings
            SET status = 'ANSWERED',
                answered_by_message_id = COALESCE(%s, answered_by_message_id),
                version = version + 1
            WHERE id = %s
            """,
            (message_id, finding_id),
        )
        _event(
            cursor, UUID(str(finding_id)), organization_id, project_id, "REPLIED", "SYSTEM",
            None, str(status), "ANSWERED", note=note, points_at=points_at,
        )  # fmt: skip
    return len(rows)


def note_owner_reply(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    message_id: UUID,
) -> int:
    """The owner wrote on the request."""
    return _owner_activity(
        cursor, organization_id, project_id, request_id,
        "The control owner replied on the request. A person decides what it resolves.",
        {"message_id": str(message_id)}, message_id,
    )  # fmt: skip


def note_owner_answers(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    request_id: UUID,
    keys: list[str],
) -> int:
    """The owner answered the request's questions on the portal."""
    if not keys:
        return 0
    return _owner_activity(
        cursor, organization_id, project_id, request_id,
        f"The control owner answered {len(keys)} question{'' if len(keys) == 1 else 's'} on "
        "the portal. A person decides what it resolves.",
        {"answers": keys[:20]},
    )  # fmt: skip


def note_owner_submission(cursor: psycopg.Cursor[Any], request_id: UUID) -> int:
    """The owner submitted the request on the portal, with or without a note."""
    row = cursor.execute(
        "SELECT organization_id, project_id FROM pbc_requests WHERE id = %s", (request_id,)
    ).fetchone()
    if row is None:
        return 0
    return _owner_activity(
        cursor, UUID(str(row[0])), UUID(str(row[1])), request_id,
        "The control owner submitted the request on the portal. A person decides what it "
        "resolves.",
        {"submitted": True},
    )  # fmt: skip


# --- A person's decisions ------------------------------------------------------------


class DecisionBody(BaseModel):
    decision: Decision
    note: str = Field(default="", max_length=1000)
    question: str = Field(default="", max_length=1000)
    file_id: UUID | None = None
    version: int = Field(ge=1)


_TRANSITIONS: dict[str, tuple[tuple[str, ...], str, str]] = {
    # decision: (allowed from, status after, event)
    "ACCEPT": (("PROPOSED", "ANSWERED"), "ACCEPTED", "ACCEPTED"),
    "DISMISS": (("PROPOSED", "ACCEPTED", "ANSWERED"), "DISMISSED", "DISMISSED"),
    "RESOLVE": (
        ("ACCEPTED", "SENT", "ANSWERED", "MORE_NEEDED", "ESCALATED"),
        "RESOLVED",
        "RESOLVED",
    ),
    "CLARIFICATION_ACCEPTED": (
        ("SENT", "ANSWERED", "ESCALATED"),
        "CLARIFICATION_ACCEPTED",
        "CLARIFICATION_ACCEPTED",
    ),
    "MORE_NEEDED": (("ACCEPTED", "SENT", "ANSWERED", "ESCALATED"), "MORE_NEEDED", "MORE_NEEDED"),
    "NOT_APPLICABLE": (OPEN, "NOT_APPLICABLE", "NOT_APPLICABLE"),
    "ESCALATE": (
        ("PROPOSED", "ACCEPTED", "SENT", "ANSWERED", "MORE_NEEDED"),
        "ESCALATED",
        "ESCALATED",
    ),
    "REOPEN": (CLOSED, "ACCEPTED", "REOPENED"),
}
_NEEDS_NOTE = ("CLARIFICATION_ACCEPTED", "MORE_NEEDED", "NOT_APPLICABLE", "ESCALATE", "REOPEN")


def decide(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    finding_id: UUID,
    actor: UUID,
    body: DecisionBody,
) -> None:
    row = cursor.execute(
        "SELECT status, version, question FROM evidence_findings "
        "WHERE id = %s AND engagement_control_id = %s AND project_id = %s FOR UPDATE",
        (finding_id, control_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()
    status, version, question = str(row[0]), int(row[1]), str(row[2])
    if version != body.version:
        raise FindingState("the finding changed; look again")
    note = " ".join(body.note.split())
    if body.decision in _NEEDS_NOTE and len(note) < 10:
        raise FindingState("say why, in a sentence")
    new_question = " ".join(body.question.split())
    if body.decision == "EDIT":
        if status in CLOSED:
            raise FindingState("a closed finding is not edited; reopen it first")
        if len(new_question) < 10:
            raise FindingState("write the question to ask")
        cursor.execute(
            "UPDATE evidence_findings SET question = %s, version = version + 1 WHERE id = %s",
            (new_question, finding_id),
        )
        _event(
            cursor, finding_id, organization_id, project_id, "EDITED", "PERSON", actor,
            status, status, note=note, question=new_question,
        )  # fmt: skip
        _audit_decision(
            cursor,
            organization_id,
            project_id,
            control_id,
            finding_id,
            actor,
            body.decision,
            status,
        )
        return
    allowed, after, event = _TRANSITIONS[body.decision]
    if status not in allowed:
        was = status.lower().replace("_", " ")
        wanted = body.decision.lower().replace("_", " ")
        raise FindingState(f"a finding that is {was} cannot be {wanted}")
    if body.file_id is not None:
        owner = cursor.execute(
            "SELECT 1 FROM evidence_files WHERE id = %s AND project_id = %s",
            (body.file_id, project_id),
        ).fetchone()
        if owner is None:
            raise NotVisible()
    cursor.execute(
        """
        UPDATE evidence_findings
        SET status = %s, decided_by = %s, decided_at = clock_timestamp(), decision_note = %s,
            question = CASE WHEN %s <> '' THEN %s ELSE question END,
            answered_by_file_id = COALESCE(%s, answered_by_file_id),
            version = version + 1
        WHERE id = %s
        """,
        (after, actor, note, new_question, new_question, body.file_id, finding_id),
    )
    _event(
        cursor, finding_id, organization_id, project_id, event, "PERSON", actor, status, after,
        note=note, question=new_question if new_question and new_question != question else "",
        points_at={} if body.file_id is None else {"file_id": str(body.file_id)},
    )  # fmt: skip
    _audit_decision(
        cursor, organization_id, project_id, control_id, finding_id, actor, body.decision, after
    )


def _audit_decision(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    finding_id: UUID,
    actor: UUID,
    decision: str,
    status: str,
) -> None:
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'evidence.finding_decided', 'evidence_finding', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor,
            finding_id,
            Json({"control_id": str(control_id), "decision": decision, "status": status}),
        ),
    )


class FollowUpBody(BaseModel):
    request_id: UUID
    finding_ids: list[UUID] = Field(min_length=1, max_length=20)
    body: str = Field(min_length=1, max_length=4000)


def clean_follow_up(text: str) -> str:
    """A message to the client: links and requests for credentials are not allowed."""
    if _URL.search(text) or _ASKS_FOR_ACCESS.search(text):
        return ""
    lines = [clean_line(line, 400) for line in text.replace("\r", "").split("\n")]
    return "\n".join(lines).strip()[:4000]


def draft_follow_up(findings: list[tuple[str, str]], control_ref: str, control_title: str) -> str:
    """The message a person starts from: one numbered question per finding."""
    lines = [
        f"Following up on the evidence for {control_ref} {control_title}".strip() + ":",
        "",
    ]
    for number, (title, question) in enumerate(findings, start=1):
        ask = question or f"Please confirm: {title}"
        lines.append(f"{number}. {ask}")
    lines.append("")
    lines.append("Thank you.")
    return "\n".join(lines)


def send_follow_up(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
    body: FollowUpBody,
) -> UUID:
    """A person sends the accepted findings to the control owner as one message on the
    request. Returns the message; the caller emails the owner."""
    from ai_workforce_api.portal_workspace import MessageBody, post_team_message

    text = clean_follow_up(body.body)
    if text == "":
        raise FindingState("the message cannot carry links or ask for credentials")
    request = cursor.execute(
        "SELECT 1 FROM pbc_requests "
        "WHERE id = %s AND project_id = %s AND engagement_control_id = %s",
        (body.request_id, project_id, control_id),
    ).fetchone()
    if request is None:
        raise NotVisible()
    rows = cursor.execute(
        """
        SELECT id, status, pbc_request_id FROM evidence_findings
        WHERE id = ANY(%s) AND engagement_control_id = %s AND project_id = %s FOR UPDATE
        """,
        (list(body.finding_ids), control_id, project_id),
    ).fetchall()
    if len(rows) != len(set(body.finding_ids)):
        raise NotVisible()
    for _finding_id, status, request_id in rows:
        if status not in SENDABLE:
            raise FindingState("only an accepted finding is sent; accept it first")
        if request_id is not None and UUID(str(request_id)) != body.request_id:
            raise FindingState("a finding is sent on its own request")
    message_id = post_team_message(
        cursor, organization_id, project_id, body.request_id, actor, MessageBody(body=text)
    )
    for finding_id, status, _request_id in rows:
        cursor.execute(
            """
            UPDATE evidence_findings
            SET status = 'SENT', sent_message_id = %s, pbc_request_id = %s,
                decided_by = %s, decided_at = clock_timestamp(), version = version + 1
            WHERE id = %s
            """,
            (message_id, body.request_id, actor, finding_id),
        )
        _event(
            cursor, UUID(str(finding_id)), organization_id, project_id, "SENT", "PERSON", actor,
            str(status), "SENT", points_at={"message_id": str(message_id)},
        )  # fmt: skip
    cursor.execute(
        """
        INSERT INTO audit_events (
            organization_id, project_id, actor_user_id, action, target_type, target_id, payload
        )
        VALUES (%s, %s, %s, 'evidence.follow_up_sent', 'request_message', %s, %s)
        """,
        (
            organization_id,
            project_id,
            actor,
            message_id,
            Json(
                {
                    "control_id": str(control_id),
                    "request_id": str(body.request_id),
                    "findings": [str(f) for f in body.finding_ids],
                }
            ),
        ),  # fmt: skip
    )
    return message_id


# --- Reading -------------------------------------------------------------------------


class EventBody(BaseModel):
    event: str
    actor_kind: str
    actor: str | None
    note: str
    question: str
    points_at: dict[str, Any]
    created_at: str


class FindingBody(BaseModel):
    id: UUID
    file_id: UUID | None
    file_name: str
    analysis_id: UUID | None
    mapping_run_id: UUID | None
    # The assurance run a finding of source ASSURANCE rests on (migration 0155).
    assessment_id: UUID | None = None
    requirement_id: UUID | None
    requirement_title: str
    request_id: UUID | None
    attribute_index: int | None
    attribute_id: UUID | None
    attribute_code: str
    source: Source
    kind: Kind
    title: str
    observation: str
    question: str
    expected: str
    citation: dict[str, Any] | None
    plan_revision: int | None
    status: Status
    stale: bool
    stale_reason: str
    sent_message_id: UUID | None
    answered_by_message_id: UUID | None
    answered_by_file_id: UUID | None
    decided_by: str | None
    decided_at: str | None
    decision_note: str
    created_at: str
    updated_at: str
    version: int
    events: list[EventBody]


class FindingsBody(BaseModel):
    control_id: UUID
    findings: list[FindingBody]
    # By status, plus "stale" and "open": what a person has in front of them.
    summary: dict[str, int] = Field(default_factory=dict)


def summarize(findings: list[FindingBody]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.status] = counts.get(finding.status, 0) + 1
        if finding.stale:
            counts["stale"] = counts.get("stale", 0) + 1
        if finding.status in OPEN:
            counts["open"] = counts.get("open", 0) + 1
    return counts


def list_findings(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> FindingsBody:
    rows = connection.execute(
        """
        SELECT f.id, f.evidence_file_id, COALESCE(e.file_name, ''), f.analysis_id,
               f.mapping_run_id, f.requirement_id, COALESCE(q.title, ''), f.pbc_request_id,
               f.attribute_index, f.source, f.kind, f.title, f.observation, f.question,
               f.expected, f.citation, f.plan_revision, f.status, f.stale, f.stale_reason,
               f.sent_message_id, f.answered_by_message_id, f.answered_by_file_id,
               u.display_name, f.decided_at, f.decision_note, f.created_at, f.updated_at,
               f.version, f.attribute_id, f.attribute_code, f.assessment_id
        FROM evidence_findings f
        LEFT JOIN evidence_files e ON e.id = f.evidence_file_id
        LEFT JOIN evidence_requirements q ON q.id = f.requirement_id
        LEFT JOIN users u ON u.id = f.decided_by
        WHERE f.engagement_control_id = %s AND f.project_id = %s
        ORDER BY f.created_at DESC
        LIMIT 500
        """,
        (control_id, project_id),
    ).fetchall()
    ids = [row[0] for row in rows]
    events: dict[str, list[EventBody]] = {}
    if ids:
        for event in connection.execute(
            """
            SELECT v.finding_id, v.event, v.actor_kind, u.display_name, v.note, v.question,
                   v.points_at, v.created_at
            FROM evidence_finding_events v LEFT JOIN users u ON u.id = v.actor_user_id
            WHERE v.finding_id = ANY(%s)
            ORDER BY v.created_at
            """,
            (ids,),
        ).fetchall():
            events.setdefault(str(event[0]), []).append(
                EventBody(
                    event=str(event[1]),
                    actor_kind=str(event[2]),
                    actor=None if event[3] is None else str(event[3]),
                    note=str(event[4]),
                    question=str(event[5]),
                    points_at=event[6] if isinstance(event[6], dict) else {},
                    created_at=event[7].isoformat(),
                )  # fmt: skip
            )
    bodies = [
        FindingBody(
            id=row[0],
            file_id=row[1],
            file_name=str(row[2]),
            analysis_id=row[3],
            mapping_run_id=row[4],
            assessment_id=row[31],
            requirement_id=row[5],
            requirement_title=str(row[6]),
            request_id=row[7],
            attribute_index=row[8],
            attribute_id=row[29],
            attribute_code=str(row[30] or ""),
            source=row[9],
            kind=row[10],
            title=str(row[11]),
            observation=str(row[12]),
            question=str(row[13]),
            expected=str(row[14]),
            citation=row[15] if isinstance(row[15], dict) else None,
            plan_revision=row[16],
            status=row[17],
            stale=bool(row[18]),
            stale_reason=str(row[19]),
            sent_message_id=row[20],
            answered_by_message_id=row[21],
            answered_by_file_id=row[22],
            decided_by=None if row[23] is None else str(row[23]),
            decided_at=None if row[24] is None else row[24].isoformat(),
            decision_note=str(row[25]),
            created_at=row[26].isoformat(),
            updated_at=row[27].isoformat(),
            version=int(row[28]),
            events=events.get(str(row[0]), []),
        )  # fmt: skip
        for row in rows
    ]
    return FindingsBody(control_id=control_id, findings=bodies, summary=summarize(bodies))


class SentBody(BaseModel):
    message_id: UUID
    notified: bool
    findings: FindingsBody


# --- Routes --------------------------------------------------------------------------


def _visible(connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID) -> None:
    row = connection.execute(
        "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
        (control_id, project_id),
    ).fetchone()
    if row is None:
        raise NotVisible()


def register_evidence_findings(app: FastAPI, settings: Settings) -> None:
    base = "/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"

    def run[T](request: Request, work: Callable[[psycopg.Connection[Any], Principal], T]) -> T:
        principal = _session_principal(request)
        try:
            return _call(settings, lambda connection: work(connection, principal))
        except FindingState as error:
            raise HTTPException(status_code=409, detail=error.detail) from None

    @app.get(f"{base}/evidence-findings", response_model=FindingsBody)
    def read(
        organization_id: UUID, project_id: UUID, control_id: UUID, request: Request
    ) -> FindingsBody:
        def work(connection: psycopg.Connection[Any], principal: Principal) -> FindingsBody:
            authorize(connection, principal=principal, action=Action.PROJECT_READ,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            _visible(connection, project_id, control_id)
            return list_findings(connection, project_id, control_id)

        return run(request, work)

    @app.post(f"{base}/evidence-findings/{{finding_id}}/decide", response_model=FindingsBody)
    def decide_one(
        organization_id: UUID, project_id: UUID, control_id: UUID, finding_id: UUID,
        body: DecisionBody, request: Request,
    ) -> FindingsBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> FindingsBody:
            authorize(connection, principal=principal, action=Action.PROJECT_UPDATE,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            if principal.kind is not PrincipalKind.USER:
                raise FindingState("a person decides a finding")
            _visible(connection, project_id, control_id)
            with transaction(connection) as cursor:
                decide(
                    cursor, organization_id, project_id, control_id, finding_id, principal.id, body
                )
            return list_findings(connection, project_id, control_id)

        return run(request, work)

    @app.post(f"{base}/evidence-findings/follow-up", response_model=SentBody)
    def follow_up(
        organization_id: UUID, project_id: UUID, control_id: UUID, body: FollowUpBody,
        request: Request,
    ) -> SentBody:  # fmt: skip
        def work(connection: psycopg.Connection[Any], principal: Principal) -> SentBody:
            from ai_workforce_api.evidence_portal import notify_owner_of_reply

            authorize(connection, principal=principal, action=Action.PROJECT_UPDATE,
                      organization_id=organization_id, project_id=project_id)  # fmt: skip
            if principal.kind is not PrincipalKind.USER:
                raise FindingState("a person sends a follow-up")
            _visible(connection, project_id, control_id)
            with transaction(connection) as cursor:
                message_id = send_follow_up(
                    cursor, organization_id, project_id, control_id, principal.id, body
                )
            notified = notify_owner_of_reply(
                connection, settings, organization_id, project_id, body.request_id, message_id,
                principal.id, " ".join(body.body.split())[:4000],
            )  # fmt: skip
            return SentBody(
                message_id=message_id, notified=notified,
                findings=list_findings(connection, project_id, control_id),
            )  # fmt: skip

        return run(request, work)
