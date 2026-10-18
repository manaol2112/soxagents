"""Citations in the agent's answers: the exact words of an evidence file, checked.

The agent cites a file by quoting it: [cite:<evidence_file_id> "the exact words"]. Before
an answer is saved, each quote is looked up in that file's stored text, in this
engagement only. A quote that is found becomes a numbered citation, [^1], with the
passage around it and where in the file it is (a page, a sheet, or an image). A quote
that is not found is dropped, so the person never sees a citation the file does not
support. Quotes are matched loosely on spacing, case, and quote marks, never on words.
"""

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.evidence_withdrawn import in_force
from ai_workforce_api.inbound import clean_line

MAX_CITATIONS = 40
CONTEXT = 220
_MARKER = re.compile(
    r"\[cite:\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
    r"\s*[\"“](.{3,600}?)[\"”]\s*\]",
    re.S,
)
_UNCHECKED = re.compile(r"[ \t]*" + _MARKER.pattern, re.S)
# Where a passage sits, from the markers the reader writes into a file's text.
_PLACE = re.compile(r"^\[(Page \d+|Image \d+)[^\]]*\]|^## Sheet: (.+)$", re.M)
_FOLD = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def unchecked_hidden(text: str) -> str:
    """An answer still being written, without its citations: they are shown only once
    they are checked, so neither a quote nor a file id reaches the reader unchecked. A
    citation the model is part way through is cut off too."""
    # Each marker goes with the space before it, so the sentence closes up around it.
    shown = re.sub(r"[ \t]*\[cite:[^\]]*\]", "", _UNCHECKED.sub("", text))
    start = shown.rfind("[cite:")
    if start != -1 and "]" not in shown[start:]:
        shown = shown[:start]
    # A marker cut so early that only its opening is written yet: "[", "[ci".
    return re.sub(r"\[(?:c(?:i(?:t(?:e)?)?)?)?$", "", shown).rstrip(" ")


@dataclass(frozen=True)
class Citation:
    number: int
    file_id: UUID
    file_name: str
    quote: str
    before: str
    after: str
    location: str
    offset: int

    def dump(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "evidence_file_id": str(self.file_id),
            "file_name": self.file_name,
            "quote": self.quote,
            "before": self.before,
            "after": self.after,
            "location": self.location,
            "offset": self.offset,
        }


def _folded(text: str) -> tuple[str, list[int]]:
    """The text folded for matching, and where each folded character came from."""
    out: list[str] = []
    origin: list[int] = []
    space = False
    for index, char in enumerate(text.translate(_FOLD)):
        if char.isspace():
            if not space and out:
                out.append(" ")
                origin.append(index)
            space = True
            continue
        space = False
        out.append(char.lower())
        origin.append(index)
    return "".join(out), origin


def find_quote(text: str, quote: str) -> tuple[int, int] | None:
    """Where the quote is in the text, as (start, end) offsets of the original text."""
    folded, origin = _folded(text)
    needle, _ = _folded(quote.strip())
    needle = needle.strip(" .…")
    if len(needle) < 3:
        return None
    at = folded.find(needle)
    if at < 0:
        return None
    return origin[at], origin[at + len(needle) - 1] + 1


def location_of(text: str, offset: int) -> str:
    """The page, image, or sheet a passage is on, from the reader's markers."""
    place = ""
    for found in _PLACE.finditer(text):
        if found.start() > offset:
            break
        place = found.group(1) or f"Sheet {found.group(2).strip()}"
    return place


def resolve(
    connection: psycopg.Connection[Any], project_id: UUID, answer: str
) -> tuple[str, list[Citation], int]:
    """The answer with checked citations as [^n], the citations, and how many were dropped."""
    texts: dict[UUID, tuple[str, str] | None] = {}
    citations: list[Citation] = []
    seen: dict[tuple[UUID, int], int] = {}
    dropped = 0

    def replace(found: re.Match[str]) -> str:
        nonlocal dropped
        file_id = UUID(found.group(1).lower())
        if file_id not in texts:
            row = connection.execute(
                "SELECT f.file_name, a.extracted_text FROM evidence_files f "
                "JOIN evidence_analyses a ON a.evidence_file_id = f.id "
                "WHERE f.id = %s AND f.project_id = %s AND a.status = 'READY' AND NOT "
                + in_force("f"),
                (file_id, project_id),
            ).fetchone()
            texts[file_id] = None if row is None else (str(row[0]), str(row[1] or ""))
        source = texts[file_id]
        span = None if source is None else find_quote(source[1], found.group(2))
        if source is None or span is None or len(citations) >= MAX_CITATIONS:
            dropped += 1
            return ""
        name, text = source
        start, end = span
        key = (file_id, start)
        if key not in seen:
            seen[key] = len(citations) + 1
            citations.append(
                Citation(
                    number=seen[key],
                    file_id=file_id,
                    file_name=name,
                    quote=text[start:end][:600],
                    before=_edge(text[max(0, start - CONTEXT) : start], left=True),
                    after=_edge(text[end : end + CONTEXT], left=False),
                    location=clean_line(
                        location_of(text, start)
                        or (
                            "Screenshot, read by OCR"
                            if re.search(r"\.(png|jpe?g|gif|bmp|tiff?|webp)$", name, re.I)
                            else ""
                        ),
                        80,
                    ),
                    offset=start,
                )
            )
        return f"[^{seen[key]}]"

    cited = _MARKER.sub(replace, answer)
    # A dropped marker can leave a stray space before punctuation.
    cited = re.sub(r"[ \t]+([.,;:)])", r"\1", cited)
    return cited, citations, dropped


def _edge(text: str, left: bool) -> str:
    """Context cut at a word boundary, so the passage reads cleanly."""
    if left:
        cut = text.find(" ") if len(text) >= CONTEXT else -1
        text = text[cut + 1 :] if cut >= 0 else text
    else:
        cut = text.rfind(" ") if len(text) >= CONTEXT else -1
        text = text[:cut] if cut >= 0 else text
    return text
