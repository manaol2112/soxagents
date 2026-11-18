"""The AI-proposed testing rationale in the effectiveness workpaper (Milestone 3c).

One section, added to the control's effectiveness workpaper when it is drafted:
"AI-Proposed Testing Rationale — Pending Auditor Review". It is written by code from the
tester's own results on the control's testing sheet (only what the model proposed, with
its verified citations, observed and expected conditions, rule checks and limitations),
never by a further model call. It proposes; it does not conclude.

It stays "Pending Auditor Review" until a person explicitly reviews it (M3c closure, the
owner's decision): the review is a confirmation on the existing Prepare action of the
workpaper, which only a person can take (`approve`), and preparing an effectiveness
workpaper is refused while its rationale is pending. A person may edit the section before
that, and an edit is not a review: it keeps the section pending and clears an earlier
review. The review records the person, the time, the workpaper version reviewed and the
results basis. When the results or the evidence behind them change (the basis covers the
proposed results and the hashes of each item's files), a new pending section replaces it
and the earlier review stays in the version history. The section never touches the
workpaper's conclusion, the sheet's conclusion, the independent review or a sign-off.
"""

import hashlib
import json
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.inbound import clean_line
from ai_workforce_api.workpaper_fill import Content, Section, SectionReview

KEY = "ai-testing-rationale"
PENDING_TITLE = "AI-Proposed Testing Rationale — Pending Auditor Review"
REVIEWED_TITLE = "AI-Proposed Testing Rationale — Reviewed by the auditor"
COLUMNS = [
    "Sample",
    "Attribute",
    "AI proposed",
    "Observed",
    "Expected",
    "Evidence cited",
    "Limitations",
]
LABELS = {
    "PASS": "Pass",
    "EXCEPTION": "Exception (proposed)",
    "UNABLE": "Unable to determine",
    "REVIEW": "Human review required",
    "NOT_APPLICABLE": "Not applicable",
}
SUMMARY = {
    "PASS": "passed",
    "EXCEPTION": "proposed exceptions",
    "UNABLE": "unable to determine",
    "REVIEW": "for human review",
    "NOT_APPLICABLE": "not applicable",
}
GUIDANCE = (
    "Proposed by the AI tester from its testing results. Not approved: an auditor reviews "
    "it. It is not the conclusion and does not change it. Exceptions are proposals, not "
    "deficiencies. Results basis {basis}."
)
MAX_ROWS = 200


def rationale(
    connection: psycopg.Connection[Any], project_id: UUID, control_id: UUID, tab: str
) -> Section | None:
    """The pending section from the interim sheet's model results, or None when the tester
    proposed nothing yet."""
    sheet = connection.execute(
        "SELECT id, attributes FROM test_sheets WHERE project_id = %s "
        "AND engagement_control_id = %s AND test_round_id IS NULL",
        (project_id, control_id),
    ).fetchone()
    if sheet is None:
        return None
    attributes = [str(item) for item in (sheet[1] if isinstance(sheet[1], list) else [])]
    rows: list[list[str]] = []
    counts: dict[str, int] = {}
    failed = 0
    hashes: list[str] = []
    for label, source, results, note, files in connection.execute(
        """
        SELECT i.label, i.source, i.results, i.note,
               (SELECT coalesce(array_agg(f.content_sha256 ORDER BY f.content_sha256), '{}')
                FROM test_item_files t JOIN evidence_files f ON f.id = t.evidence_file_id
                WHERE t.test_item_id = i.id)
        FROM test_items i WHERE i.test_sheet_id = %s ORDER BY i.position
        """,
        (sheet[0],),
    ).fetchall():
        hashes.append(f"{label}:{','.join(str(h) for h in files or [])}")
        if source == "FAILED":
            failed += 1
            rows.append([str(label), "All", "Execution failed (not tested)", "", "", "",
                         clean_line(str(note), 300)])  # fmt: skip
            continue
        if source != "MODEL":
            continue
        for entry in results if isinstance(results, list) else []:
            if not isinstance(entry, dict):
                continue
            index = int(entry.get("index", -1))
            if not 0 <= index < len(attributes):
                continue
            result = str(entry.get("result"))
            counts[result] = counts.get(result, 0) + 1
            cited = [_cited(c) for c in entry.get("citations", []) if isinstance(c, dict)][:3]
            ruled = [
                str(check.get("why", ""))
                for check in entry.get("checks", [])
                if isinstance(check, dict) and check.get("holds") is not None
            ][:2]
            rows.append(
                [
                    str(label),
                    f"{chr(65 + index) if index < 26 else index + 1}. {attributes[index][:160]}",
                    LABELS.get(result, result)
                    + (" (decided by a rule check)" if entry.get("decided_by_rule") else ""),
                    clean_line(str(entry.get("observed") or entry.get("note") or ""), 400),
                    clean_line(str(entry.get("expected") or ""), 400),
                    clean_line(" | ".join(cited + [f"Rule check: {why}" for why in ruled]), 1000),
                    clean_line(str(entry.get("limitations") or ""), 400),
                ]
            )
    if not rows:
        return None
    summary = ", ".join(
        f"{counts[key]} {phrase}" for key, phrase in SUMMARY.items() if counts.get(key)
    )
    if failed:
        summary = f"{summary}, {failed} not tested (execution failed)".lstrip(", ")
    rows = [["All samples", "Summary", summary or "No results", "", "", "",
             "A proposal for the auditor; the conclusion is the auditor's."]] + rows  # fmt: skip
    rows = rows[:MAX_ROWS]
    # The basis covers what was proposed and the evidence it rests on: a changed result or
    # a replaced file is a material change, and a review of the old basis no longer holds.
    basis = hashlib.sha256(json.dumps([rows, hashes], ensure_ascii=False).encode()).hexdigest()[:16]
    return Section(
        key=KEY,
        title=PENDING_TITLE,
        kind="table",
        guidance=GUIDANCE.format(basis=basis),
        columns=COLUMNS,
        rows=rows,
        source="AGENT",
        tab=tab,
    )


def place(content: Content, old: Content | None, new: Section | None) -> Content:
    """The workpaper with its rationale: the existing one (a person's edits, a review) kept
    while the results and evidence it rests on are unchanged; otherwise the new pending one;
    nothing when there are no results."""
    kept = None if old is None else next((s for s in old.sections if s.key == KEY), None)
    sections = [section for section in content.sections if section.key != KEY]
    chosen: Section | None = new
    if new is None:
        chosen = kept
    elif (
        kept is not None
        and (kept.source == "PERSON" or kept.review is not None)
        and _basis(kept) == _basis(new)
    ):
        chosen = kept
    if chosen is None:
        return content.model_copy(update={"sections": sections})
    # On its own tab, before that tab's conclusion and sign-off: the proposal is read
    # beside the results it rests on, never after the people's sections.
    on_tab = [i for i, section in enumerate(sections) if section.tab == chosen.tab]
    closing = [i for i in on_tab if any(w in sections[i].key for w in ("conclusion", "sign-off"))]
    at = closing[0] if closing else (on_tab[-1] + 1 if on_tab else len(sections))
    return content.model_copy(update={"sections": [*sections[:at], chosen, *sections[at:]]})


def interim_tab(content: Content) -> str:
    """The tab the interim testing's sections are on (the rationale rests on that sheet)."""
    keys = [tab.key for tab in content.tabs]
    if "interim" in keys:
        return "interim"
    if keys:
        return keys[0]
    return content.sections[0].tab if content.sections else ""


def edited(section: Section) -> dict[str, Any]:
    """What a person's edit of the rationale changes beside its content: it is pending
    again. An edit is not a review, and it voids an earlier review."""
    return {"title": PENDING_TITLE, "review": None} if section.key == KEY else {}


def pending(content: Content) -> bool:
    """Whether the workpaper holds an AI-proposed rationale no person has reviewed."""
    return any(s.key == KEY and s.review is None for s in content.sections)


def approve(
    content: Content, person: UUID, person_name: str, at: str, content_version: int
) -> Content:
    """The workpaper with its rationale reviewed by this person: who, when, the workpaper
    version they reviewed and its results basis. Only the Prepare route calls this, which
    only a person can take; nothing an agent runs does."""
    sections = []
    for section in content.sections:
        if section.key == KEY and section.review is None:
            section = section.model_copy(
                update={
                    "title": REVIEWED_TITLE,
                    "review": SectionReview(
                        by=str(person), by_name=clean_line(person_name, 200), at=at,
                        content_version=content_version, basis=_basis(section),
                    ),
                }
            )  # fmt: skip
        sections.append(section)
    return content.model_copy(update={"sections": sections})


def basis_of(content: Content) -> str:
    section = next((s for s in content.sections if s.key == KEY), None)
    return "" if section is None else _basis(section)


def _basis(section: Section) -> str:
    marker = "Results basis "
    at = section.guidance.find(marker)
    return section.guidance[at + len(marker) :].rstrip(".") if at >= 0 else ""


def _cited(citation: dict[str, Any]) -> str:
    where = f" · {citation.get('location')}" if citation.get("location") else ""
    quote = clean_line(str(citation.get("quote", "")), 160)
    return f"{citation.get('file_name', '')}{where}: “{quote}”"
