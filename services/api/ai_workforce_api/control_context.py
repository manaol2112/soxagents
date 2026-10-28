"""A control's context: what it is, what documents support it, and what is unresolved.

Control attributes belong to the control (control_attributes.py). Process understanding is
built for the controls that depend on it (process_understanding.py). Evidence supports
testing and is judged on its own. This module holds what those share:

- the control's classification: ITGC, automated application control, IT-dependent manual
  control, business process control, entity-level control, key report. Derived from its
  area and nature, and overridable by the team when a control spans categories;
- supporting documents (narratives, policies, procedures, flowcharts, walkthrough notes,
  system documentation, prior-year workpapers), stored once per engagement as text and
  linked to any number of controls. A policy or procedure may instead govern systems and
  processes (migration 0112): it then applies to every control under them, unless a
  person takes it off one. A document is untrusted data;
- the sources a control's context can cite: its own RCM record ("control") and each linked
  document, with quotes checked against their text;
- issues: what is missing, ambiguous, or contradictory, why it matters, and what would
  resolve it. Raised by the agents or by deterministic rules, resolved by a person;
- the control context package the agents read.
"""

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.actions import contains_secret
from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.controls import DOMAIN_LABELS, ITGC_DOMAINS, SYSTEM_DOMAINS
from ai_workforce_api.evidence_extraction import extract

Classification = Literal[
    "ITGC",
    "AUTOMATED_APPLICATION",
    "IT_DEPENDENT_MANUAL",
    "BUSINESS_PROCESS",
    "ENTITY_LEVEL",
    "KEY_REPORT",
    "MANAGEMENT_REVIEW",
]
CLASSIFICATIONS: tuple[Classification, ...] = (
    "ITGC",
    "AUTOMATED_APPLICATION",
    "IT_DEPENDENT_MANUAL",
    "BUSINESS_PROCESS",
    "ENTITY_LEVEL",
    "KEY_REPORT",
    "MANAGEMENT_REVIEW",
)
DocumentKind = Literal[
    "NARRATIVE", "POLICY", "PROCEDURE", "FLOWCHART", "WALKTHROUGH", "SYSTEM", "PRIOR_YEAR",
    "OTHER",
]  # fmt: skip
DOCUMENT_KINDS: tuple[DocumentKind, ...] = (
    "NARRATIVE", "POLICY", "PROCEDURE", "FLOWCHART", "WALKTHROUGH", "SYSTEM", "PRIOR_YEAR",
    "OTHER",
)  # fmt: skip
IssueKind = Literal["MISSING", "AMBIGUOUS", "CONFLICT"]
IssueOrigin = Literal["ATTRIBUTES", "PROCESS", "SOURCES"]
Basis = Literal["DOCUMENTED", "INFERRED"]

MAX_DOCUMENT = 100_000
MAX_UPLOAD = 5 * 1024 * 1024
# How much of each source the agents read.
SOURCE_EXCERPT = 12_000
CONTROL_SOURCE = "control"
# The approved process narrative, quoted by the attribute agent as a source (26 October 2026).
NARRATIVE_SOURCE = "process-narrative"

BUSINESS_CYCLES = tuple(
    domain for domain in DOMAIN_LABELS if domain not in SYSTEM_DOMAINS and domain != "ENTITY"
)
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ContextState(Exception):
    """A 409: the record changed, or the request does not fit its state."""

    def __init__(self, detail: str) -> None:
        self.detail = detail


# Classification


def derived_classifications(domain: str, nature: str) -> list[Classification]:
    """What a control's area and nature say it is. A control may be several things."""
    found: list[Classification] = []
    if domain in ITGC_DOMAINS:
        found.append("ITGC")
    if domain == "ITAC" or (nature == "AUTOMATED" and domain not in ITGC_DOMAINS):
        found.append("AUTOMATED_APPLICATION")
    if nature == "IT_DEPENDENT_MANUAL":
        found.append("IT_DEPENDENT_MANUAL")
    if domain == "IPE":
        found.append("KEY_REPORT")
    if domain == "ENTITY":
        found.append("ENTITY_LEVEL")
    if domain in BUSINESS_CYCLES:
        found.append("BUSINESS_PROCESS")
    return found or ["BUSINESS_PROCESS"]


def classifications_of(
    override: list[str] | None, domain: str, nature: str
) -> list[Classification]:
    if override:
        return [item for item in CLASSIFICATIONS if item in override]
    return derived_classifications(domain, nature)


def needs_process_understanding(classifications: list[Classification]) -> bool:
    """A business process control is tested against an understanding of its process: the
    transaction flow, handoffs, approvals, and exceptions. An ITGC, an automated control,
    or a report is defined well enough by its own criteria and configuration."""
    return "BUSINESS_PROCESS" in classifications


# Text


def clean(raw: str, limit: int) -> str:
    """Plain text: normal line breaks, no control characters, no runs of blank lines."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_CHARS.sub("", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()[:limit]


def line(raw: str, limit: int) -> str:
    return " ".join(_CONTROL_CHARS.sub("", raw).split())[:limit]


# Sources


@dataclass(frozen=True)
class Source:
    """Something a control's context can cite: its RCM record, or a linked document."""

    key: str
    title: str
    kind: str
    text: str


def control_text(context: Any) -> str:
    """The control's own record as one text, so a quote from it can be checked."""
    parts = [
        f"Control: {context.control_ref} {context.title}",
        f"Activity: {context.activity}",
        f"Risk: {context.risk}",
        f"Frequency: {context.frequency_label or context.frequency}",
        f"Nature: {context.nature_label or context.nature}",
        f"Owner: {context.owner_name}",
    ]
    parts += [f"Test attribute: {item}" for item in context.test_attributes]
    parts += [f"Evidence requested: {item}" for item in context.pbc_items]
    parts += [f"{label}: {value}" for label, value in context.custom_fields]
    return "\n".join(part for part in parts if part.split(": ", 1)[-1].strip())


def applies_to(control: str) -> str:
    """SQL: the document `d` applies to the control `control` (a column or a parameter):
    linked to it, or governing its system or process and not taken off it (0112). A
    removed document applies to none (0113)."""
    return f"""
        d.removed_at IS NULL AND
        (EXISTS (SELECT 1 FROM source_document_controls al
                 WHERE al.document_id = d.id AND al.engagement_control_id = {control})
         OR (NOT EXISTS (SELECT 1 FROM source_document_exclusions ax
                         WHERE ax.document_id = d.id AND ax.engagement_control_id = {control})
             AND EXISTS (
                 SELECT 1 FROM engagement_controls ac
                 WHERE ac.id = {control}
                   AND (EXISTS (SELECT 1 FROM source_document_systems asy
                                WHERE asy.document_id = d.id
                                  AND asy.engagement_application_id
                                      = ac.engagement_application_id)
                        OR EXISTS (SELECT 1 FROM source_document_processes apr
                                   WHERE apr.document_id = d.id
                                     AND apr.process_id = ac.process_id)))))
    """


def governs(cursor: psycopg.Cursor[Any], document_id: UUID, control_id: UUID) -> bool:
    """The document governs the control's system or process (0112)."""
    row = cursor.execute(
        """
        SELECT EXISTS (SELECT 1 FROM source_document_systems s
                       WHERE s.document_id = %s
                         AND s.engagement_application_id = c.engagement_application_id)
            OR EXISTS (SELECT 1 FROM source_document_processes s
                       WHERE s.document_id = %s AND s.process_id = c.process_id)
        FROM engagement_controls c WHERE c.id = %s
        """,
        (document_id, document_id, control_id),
    ).fetchone()
    return row is not None and bool(row[0])


def linked_documents(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID
) -> list[Source]:
    """The documents that apply to the control: linked to it, or governing its system or
    process."""
    return [
        Source(key=str(row[0]), title=str(row[1]), kind=str(row[2]), text=str(row[3]))
        for row in connection.execute(
            f"""
            SELECT d.id, d.title, d.kind, d.text
            FROM source_documents d
            WHERE d.project_id = %s AND {applies_to("%s")}
            ORDER BY d.created_at
            """,
            (project_id, control_id, control_id, control_id),
        ).fetchall()
    ]


def sources_for(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, context: Any
) -> list[Source]:
    record = Source(CONTROL_SOURCE, f"{context.control_ref} (RCM record)", "RCM", "")
    return [
        Source(record.key, record.title, record.kind, control_text(context)),
        *linked_documents(connection, project_id, control_id),
    ]


@dataclass(frozen=True)
class Citation:
    source: str
    title: str
    quote: str


def check_quote(sources: list[Source], source: str, quote: str) -> Citation | None:
    """The source's own words, when the quote is found in it; otherwise nothing."""
    found = next((item for item in sources if item.key == source), None)
    if found is None or not quote.strip():
        return None
    span = find_quote(found.text, quote)
    if span is None:
        return None
    return Citation(found.key, found.title, line(found.text[span[0] : span[1]], 200))


# Issues


class IssueBody(BaseModel):
    id: UUID
    origin: IssueOrigin
    kind: IssueKind
    topic: str
    detail: str
    why: str
    resolve: str
    quotes: list[dict[str, str]]
    raised_by: Literal["AGENT", "RULES"]
    status: Literal["OPEN", "RESOLVED", "DISMISSED", "SUPERSEDED"]
    resolution_note: str
    version: int
    # A question the narrative's agents need the client to answer, and the answers the
    # records suggest (0117); empty for any other issue.
    question: str = ""
    suggestions: list[str] = []
    # A point to confirm (0118): the agents' statement of the fact (empty when the question
    # is asked open), the narrative section and attribute codes it serves, its round, and
    # whether it is a missing fact or a contradiction.
    proposal: str = ""
    section: str = ""
    attributes: list[str] = []
    round: int = 0
    point_kind: str = ""
    # Where the statement comes from (0121): SOURCES, the client's records and answers;
    # TYPICAL, the usual practice for a control of its kind; "" when asked open.
    proposal_basis: str = ""


@dataclass(frozen=True)
class Issue:
    origin: IssueOrigin
    kind: IssueKind
    topic: str
    detail: str
    why: str
    resolve: str
    quotes: tuple[Citation, ...] = ()


def fingerprint(issue: Issue) -> str:
    quotes = "|".join(f"{item.source}:{item.quote.lower()}" for item in issue.quotes)
    raw = f"{issue.origin}|{issue.kind}|{issue.topic.lower()}|{quotes}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def raise_issues(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    issues: list[Issue],
    raised_by: Literal["AGENT", "RULES"],
    call_id: UUID | None = None,
) -> int:
    """Record issues once each. One a person already resolved or dismissed is not raised
    again; one superseded by a later review comes back."""
    raised = 0
    for issue in issues:
        mark = fingerprint(issue)
        held = cursor.execute(
            "SELECT id, status FROM control_context_issues "
            "WHERE engagement_control_id = %s AND fingerprint = %s "
            "ORDER BY created_at DESC LIMIT 1",
            (control_id, mark),
        ).fetchone()
        if held is not None and str(held[1]) in ("OPEN", "RESOLVED", "DISMISSED"):
            continue
        cursor.execute(
            """
            INSERT INTO control_context_issues (
                organization_id, project_id, engagement_control_id, origin, kind, topic,
                detail, why, resolve, quotes, fingerprint, raised_by, model_call_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                organization_id,
                project_id,
                control_id,
                issue.origin,
                issue.kind,
                line(issue.topic, 120) or "Context",
                line(issue.detail, 600) or issue.topic,
                line(issue.why, 400),
                line(issue.resolve, 400),
                Json([item.__dict__ for item in issue.quotes]),
                mark,
                raised_by,
                call_id,
            ),
        )
        raised += 1
    return raised


def supersede_agent_issues(
    cursor: psycopg.Cursor[Any], control_id: UUID, origin: IssueOrigin
) -> None:
    """A new review replaces the agent's open issues of the same kind of origin."""
    cursor.execute(
        """
        UPDATE control_context_issues
        SET status = 'SUPERSEDED', version = version + 1, updated_at = clock_timestamp()
        WHERE engagement_control_id = %s AND origin = %s AND raised_by = 'AGENT'
          AND status = 'OPEN'
        """,
        (control_id, origin),
    )


def issues_for(connection: psycopg.Connection[Any], control_id: UUID) -> list[IssueBody]:
    return [
        IssueBody(
            id=row[0],
            origin=row[1],
            kind=row[2],
            topic=str(row[3]),
            detail=str(row[4]),
            why=str(row[5]),
            resolve=str(row[6]),
            quotes=[
                {k: str(v) for k, v in item.items()} for item in row[7] if isinstance(item, dict)
            ],
            raised_by=row[8],
            status=row[9],
            resolution_note=str(row[10]),
            version=int(row[11]),
            question=str(row[12]),
            suggestions=[str(item) for item in row[13] if isinstance(item, str)]
            if isinstance(row[13], list)
            else [],
            proposal=str(row[14]),
            section=str(row[15]),
            attributes=[str(item) for item in row[16] if isinstance(item, str)]
            if isinstance(row[16], list)
            else [],
            round=int(row[17]),
            point_kind=str(row[18]),
            proposal_basis=str(row[19]),
        )
        for row in connection.execute(
            """
            SELECT id, origin, kind, topic, detail, why, resolve, quotes, raised_by, status,
                   resolution_note, version, question, suggestions, proposal,
                   narrative_section, attribute_codes, point_round, point_kind, proposal_basis
            FROM control_context_issues
            WHERE engagement_control_id = %s AND status <> 'SUPERSEDED'
            ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END, created_at
            """,
            (control_id,),
        ).fetchall()
    ]


# Deterministic rules

_FREQUENCY_WORDS: dict[str, re.Pattern[str]] = {
    "DAILY": re.compile(r"\b(daily|every day|each day)\b", re.I),
    "WEEKLY": re.compile(r"\b(weekly|every week|each week)\b", re.I),
    "MONTHLY": re.compile(r"\b(monthly|every month|each month)\b", re.I),
    "QUARTERLY": re.compile(r"\b(quarterly|every quarter|each quarter)\b", re.I),
    "ANNUAL": re.compile(r"\b(annual|annually|yearly|every year|once a year)\b", re.I),
}
_FREQUENCY_LABELS = {
    "DAILY": "daily",
    "WEEKLY": "weekly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "ANNUAL": "annually",
}


def frequency_conflicts(frequency: str, documents: list[Source]) -> list[Issue]:
    """A document that names one frequency for the control, other than the RCM's, is a
    conflict for a person to settle: the frequency decides the sample size."""
    if frequency not in _FREQUENCY_WORDS:
        return []
    found: list[Issue] = []
    for document in documents:
        if document.key == CONTROL_SOURCE:
            continue
        named = {
            key: match
            for key, pattern in _FREQUENCY_WORDS.items()
            if (match := pattern.search(document.text)) is not None
        }
        if len(named) != 1 or frequency in named:
            continue
        other, match = next(iter(named.items()))
        start = max(0, document.text.rfind("\n", 0, match.start()) + 1, match.start() - 120)
        end = min(len(document.text), match.end() + 80)
        stop = document.text.find("\n", match.end())
        if 0 <= stop < end:
            end = stop
        quote = line(document.text[start:end], 200)
        cited = check_quote(documents, document.key, quote)
        found.append(
            Issue(
                origin="SOURCES",
                kind="CONFLICT",
                topic="Frequency",
                detail=(
                    f"The RCM says the control runs {_FREQUENCY_LABELS[frequency]}; "
                    f"{document.title} says {_FREQUENCY_LABELS[other]}."
                ),
                why="The frequency decides the population and the sample size.",
                resolve=(
                    "Confirm the frequency with the control owner, then correct the RCM or "
                    "note why the document does not apply."
                ),
                quotes=() if cited is None else (cited,),
            )
        )
    return found


# Supporting documents


class DocumentBody(BaseModel):
    id: UUID
    kind: DocumentKind
    title: str
    file_name: str
    origin: Literal["UPLOAD", "WRITTEN", "AGENT"]
    characters: int
    excerpt: str
    created_by: str | None
    created_at: Any
    control_ids: list[UUID]
    # For the control the list was asked for: when the agent last reviewed it there.
    reviewed: bool = False
    # What a governing policy or procedure applies to (0112), and the controls a person
    # took it off.
    system_ids: list[UUID] = []
    process_ids: list[UUID] = []
    excluded_control_ids: list[UUID] = []
    # For the control the list was asked for: it applies through the control's system or
    # process, not a link of its own.
    inherited: bool = False


@dataclass(frozen=True)
class ReadDocument:
    file_name: str
    sha256: str
    text: str
    readable: bool
    note: str


def read_document(content: bytes, file_name: str, content_type: str) -> ReadDocument:
    """The text of a supporting document. The file is untrusted and is not kept."""
    name = line(file_name, 200) or "document"
    extraction = extract(content, name, content_type)
    text = clean(extraction.text, MAX_DOCUMENT)
    kinds = ("pdf", "document", "text", "workbook", "csv")
    readable = extraction.file_kind in kinds and text != ""
    note = extraction.note
    if extraction.file_kind not in kinds:
        readable = False
        note = "Upload a Word document (.docx), a PDF, a workbook, or a text file."
    elif text == "" and not note:
        note = "No text could be read from the file. Paste the text instead."
    elif extraction.truncated:
        note = "The document is long; only its first part was kept."
    return ReadDocument(
        file_name=name,
        sha256=hashlib.sha256(content).hexdigest(),
        text=text if readable else "",
        readable=readable,
        note=note,
    )


def store_document(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    actor: UUID,
    *,
    kind: str,
    title: str,
    text: str,
    origin: Literal["UPLOAD", "WRITTEN", "AGENT"],
    file_name: str = "",
    sha256: str = "",
) -> UUID:
    body = clean(text, MAX_DOCUMENT)
    name = line(title, 200)
    if kind not in DOCUMENT_KINDS or body == "" or name == "":
        raise ValueError("document is invalid")
    if contains_secret({"text": body[:20000], "title": name}):
        raise ValueError("document holds a secret")
    row = cursor.execute(
        """
        INSERT INTO source_documents (
            organization_id, project_id, kind, title, file_name, file_sha256, text, origin,
            created_by
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            organization_id,
            project_id,
            kind,
            name,
            line(file_name, 200),
            sha256,
            body,
            origin,
            actor,
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def link_document(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    document_id: UUID,
    control_ids: list[UUID],
    actor: UUID,
) -> list[UUID]:
    """Link a document to controls of the same engagement. Returns those newly linked. A
    control a person took a governing document off has it again."""
    linked: list[UUID] = []
    for control_id in dict.fromkeys(control_ids):
        found = cursor.execute(
            "SELECT 1 FROM engagement_controls WHERE id = %s AND project_id = %s",
            (control_id, project_id),
        ).fetchone()
        if found is None:
            raise ValueError("control is not in this engagement")
        cursor.execute(
            "DELETE FROM source_document_exclusions WHERE document_id = %s "
            "AND engagement_control_id = %s",
            (document_id, control_id),
        )
        row = cursor.execute(
            """
            INSERT INTO source_document_controls (
                document_id, engagement_control_id, project_id, linked_by
            )
            VALUES (%s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            RETURNING engagement_control_id
            """,
            (document_id, control_id, project_id, actor),
        ).fetchone()
        if row is not None:
            linked.append(UUID(str(row[0])))
    return linked


def documents(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID | None = None
) -> list[DocumentBody]:
    rows = connection.execute(
        f"""
        SELECT d.id, d.kind, d.title, d.file_name, d.origin, char_length(d.text),
               left(d.text, 400), u.display_name, d.created_at,
               ARRAY(SELECT l.engagement_control_id FROM source_document_controls l
                     WHERE l.document_id = d.id ORDER BY l.linked_at),
               (SELECT l.reviewed_at IS NOT NULL FROM source_document_controls l
                WHERE l.document_id = d.id AND l.engagement_control_id = %s),
               ARRAY(SELECT s.engagement_application_id FROM source_document_systems s
                     WHERE s.document_id = d.id ORDER BY s.linked_at),
               ARRAY(SELECT s.process_id FROM source_document_processes s
                     WHERE s.document_id = d.id ORDER BY s.linked_at),
               ARRAY(SELECT x.engagement_control_id FROM source_document_exclusions x
                     WHERE x.document_id = d.id ORDER BY x.excluded_at),
               %s::uuid IS NOT NULL AND NOT EXISTS (
                   SELECT 1 FROM source_document_controls l
                   WHERE l.document_id = d.id AND l.engagement_control_id = %s)
        FROM source_documents d
        LEFT JOIN users u ON u.id = d.created_by
        WHERE d.project_id = %s AND d.removed_at IS NULL
          AND (%s::uuid IS NULL OR {applies_to("%s")})
        ORDER BY d.created_at
        """,
        (
            control_id, control_id, control_id, project_id, control_id, control_id,
            control_id, control_id,
        ),
    ).fetchall()  # fmt: skip
    return [
        DocumentBody(
            id=row[0],
            kind=row[1],
            title=str(row[2]),
            file_name=str(row[3]),
            origin=row[4],
            characters=int(row[5]),
            excerpt=str(row[6]),
            created_by=None if row[7] is None else str(row[7]),
            created_at=row[8],
            control_ids=[UUID(str(item)) for item in row[9]],
            reviewed=bool(row[10]),
            system_ids=[UUID(str(item)) for item in row[11]],
            process_ids=[UUID(str(item)) for item in row[12]],
            excluded_control_ids=[UUID(str(item)) for item in row[13]],
            inherited=bool(row[14]),
        )
        for row in rows
    ]


# The context package the agents read


def context_package(
    connection: psycopg.Connection[Any],
    project_id: UUID,
    control_id: UUID,
    context: Any,
    classifications: list[Classification],
) -> dict[str, Any]:
    """What is known about the control, from the records, for the agents to reason over.
    Source texts go with it separately, as data to quote."""
    from ai_workforce_api.control_design import design_for
    from ai_workforce_api.prior_year import prior_year_points

    design = design_for(connection, control_id)

    attributes = connection.execute(
        """
        SELECT id, text, basis, source_kind, status, proposal, code
        FROM control_attributes
        WHERE engagement_control_id = %s AND status IN ('APPROVED', 'PROPOSED')
        ORDER BY status, position, created_at
        """,
        (control_id,),
    ).fetchall()
    understanding = connection.execute(
        "SELECT status, jsonb_array_length(steps) FROM process_understandings "
        "WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchone()
    open_issues = connection.execute(
        "SELECT kind, topic, detail FROM control_context_issues "
        "WHERE engagement_control_id = %s AND status = 'OPEN' ORDER BY created_at",
        (control_id,),
    ).fetchall()
    evidence = connection.execute(
        """
        SELECT count(*) FILTER (WHERE a.status = 'READY'),
               array_agg(DISTINCT coalesce(a.confirmed_kind, a.classification ->> 'kind'))
                   FILTER (WHERE a.status = 'READY')
        FROM evidence_file_links l
        JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
        WHERE l.engagement_control_id = %s
        """,
        (control_id,),
    ).fetchone()
    return {
        "control": {
            "control_ref": context.control_ref,
            "objective": context.title,
            "description": context.activity,
            "risk": context.risk,
            "area": DOMAIN_LABELS.get(context.domain, context.domain),
            "client_area": context.domain_label,
            "classifications": list(classifications),
            "systems": list(context.applications),
            "owner": context.owner_name or "(not named)",
            "frequency": context.frequency_label or context.frequency,
            "nature": context.nature_label or context.nature,
            "key_control": context.key_control,
            "sample_size": context.samples,
            "evidence_requested": list(context.pbc_items),
            "client_fields": [{"label": k, "value": v} for k, v in context.custom_fields],
        },
        "approved_attributes": [
            {
                "id": str(row[0]),
                "code": str(row[6] or ""),
                "text": str(row[1]),
                "basis": str(row[2]),
                "source": str(row[3]),
            }
            for row in attributes
            if row[4] == "APPROVED"
        ],
        "proposed_attributes": [
            {"id": str(row[0]), "text": str(row[1]), "proposal": str(row[5] or "ADD")}
            for row in attributes
            if row[4] == "PROPOSED"
        ],
        "process_understanding": (
            {"status": "NONE", "steps": 0}
            if understanding is None
            else {"status": str(understanding[0]), "steps": int(understanding[1])}
        ),
        # Already raised and not settled: not to be raised again.
        "open_issues": [
            {"kind": str(row[0]), "topic": str(row[1]), "detail": str(row[2])}
            for row in open_issues
        ],
        "evidence": {
            "files_read": 0 if evidence is None else int(evidence[0] or 0),
            "kinds": [] if evidence is None or evidence[1] is None else list(evidence[1]),
        },
        # Accepted by a person from the prior year (0112): exceptions to address and how
        # the control was tested. A reference for planning, never evidence of operation.
        "prior_year": prior_year_points(connection, control_id),
        # The control statement with the client's answers in it, and the answers given in
        # the client-specific walkthrough (decided by the product owner on 26 October 2026).
        "statement": "" if design is None else design.text,
        "client_answers": []
        if design is None
        else [
            {"question": slot.question or slot.label, "answer": slot.value}
            for slot in design.slots
            if not slot.automatic and slot.value.strip()
        ],
        # How the control operates here, as a person approved it: the attributes and the
        # evidence follow it (product owner, 26 October 2026). Absent until approved.
        **(
            {"approved_process_narrative": narrative}
            if (narrative := approved_narrative(connection, control_id)) is not None
            else {}
        ),
    }


def approved_narrative(
    connection: psycopg.Connection[Any], control_id: UUID
) -> dict[str, Any] | None:
    from ai_workforce_api.process_understanding import approved_narrative as narrative

    return narrative(connection, control_id)


def source_blocks(sources: list[Source]) -> str:
    return "\n".join(
        f'<source id="{item.key}" kind="{item.kind}" title="{line(item.title, 120)}">\n'
        f"{item.text[:SOURCE_EXCERPT]}\n</source>"
        for item in sources
    )


ISSUES_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": 5,
    "items": {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": ["MISSING", "AMBIGUOUS", "CONFLICT"]},
            "topic": {"type": "string", "maxLength": 80},
            "detail": {"type": "string", "maxLength": 400},
            "why": {"type": "string", "maxLength": 300},
            "resolve": {"type": "string", "maxLength": 300},
            "quotes": {
                "type": "array",
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "source": {"type": "string", "maxLength": 60},
                        "quote": {"type": "string", "maxLength": 200},
                    },
                    "required": ["source", "quote"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["kind", "topic", "detail", "why", "resolve", "quotes"],
        "additionalProperties": False,
    },
}


class _IssueQuote(BaseModel):
    source: str
    quote: str


class AnswerIssue(BaseModel):
    kind: IssueKind
    topic: str
    detail: str
    why: str = ""
    resolve: str = ""
    quotes: list[_IssueQuote] = []


def checked_issues(
    raw: list[AnswerIssue], sources: list[Source], origin: IssueOrigin
) -> list[Issue]:
    """The agent's issues, with only the quotes that are found in their sources. A
    conflict nobody can point to in the sources is ambiguity, not a conflict."""
    found: list[Issue] = []
    for item in raw[:5]:
        quotes = tuple(
            cited
            for quote in item.quotes[:3]
            if (cited := check_quote(sources, quote.source, quote.quote)) is not None
        )
        kind: IssueKind = item.kind
        if kind == "CONFLICT" and not quotes:
            kind = "AMBIGUOUS"
        if not line(item.detail, 600):
            continue
        found.append(
            Issue(
                # Filed under the run that raised it, so the next run supersedes it.
                origin=origin,
                kind=kind,
                topic=item.topic,
                detail=item.detail,
                why=item.why,
                resolve=item.resolve,
                quotes=quotes,
            )
        )
    return found
