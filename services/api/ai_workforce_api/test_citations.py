"""What the tester relied on, for each attribute (Milestone 8.4b).

When the tester tests an item, it cites the passages of the evidence each result rests on:
the file, the exact words, and for a screenshot the box around them. Every citation is
checked here before it is kept:

- the file must be one of the item's files;
- the words must be found in the file's stored text (the text read from it, including
  OCR), so the tester cannot cite what is not there;
- a box must lie inside the image, with a sensible size. A screenshot citation whose
  words were not read by OCR is kept only when it has a valid box.

The page, sheet, or image a passage sits on comes from the stored text's markers, so a
preview can open the right page and highlight the passage.
"""

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from ai_workforce_api.console_citations import find_quote, location_of
from ai_workforce_api.inbound import clean_line

MAX_CITATIONS = 4
QUOTE_LENGTH = 200
_PAGE = re.compile(r"^Page (\d+)$")
_IMAGE = re.compile(r"\.(png|jpe?g|gif|bmp|tiff?|webp)$", re.I)

CITATION_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": MAX_CITATIONS,
    "items": {
        "type": "object",
        "properties": {
            "file": {"type": "integer", "minimum": 0},
            "quote": {"type": "string", "maxLength": QUOTE_LENGTH},
            "box": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "w": {"type": "number"},
                    "h": {"type": "number"},
                },
                "required": ["x", "y", "w", "h"],
                "additionalProperties": False,
            },
        },
        "required": ["file", "quote"],
        "additionalProperties": False,
    },
}


@dataclass(frozen=True)
class CitedFile:
    file_id: UUID
    file_name: str
    text: str
    # Shown to the tester as an image, so a box on it is meaningful.
    seen_as_image: bool


def is_image_name(name: str) -> bool:
    return _IMAGE.search(name) is not None


def _box(value: Any) -> dict[str, float] | None:
    """A box in fractions of the image, inside it and not a speck or the whole image."""
    if not isinstance(value, dict):
        return None
    try:
        x, y, w, h = (float(value[key]) for key in ("x", "y", "w", "h"))
    except KeyError, TypeError, ValueError:
        return None
    if not (0 <= x < 1 and 0 <= y < 1 and 0.01 <= w <= 1 and 0.005 <= h <= 1):
        return None
    if x + w > 1.001 or y + h > 1.001 or (w > 0.98 and h > 0.98):
        return None
    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}


def check_citations(raw: Any, files: tuple[CitedFile, ...]) -> list[dict[str, Any]]:
    """The tester's citations for one result, kept only where they check out."""
    if not isinstance(raw, list):
        return []
    kept: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for item in raw[: MAX_CITATIONS * 2]:
        if not isinstance(item, dict) or not isinstance(item.get("file"), int):
            continue
        index = int(item["file"])
        if not 0 <= index < len(files):
            continue
        cited = files[index]
        quote = str(item.get("quote") or "")[:QUOTE_LENGTH]
        span = find_quote(cited.text, quote) if quote.strip() else None
        box = _box(item.get("box")) if cited.seen_as_image else None
        if span is None and box is None:
            continue
        start = span[0] if span is not None else -1
        key = (str(cited.file_id), start if span is not None else hash(str(box)))
        if key in seen:
            continue
        seen.add(key)
        location = location_of(cited.text, start) if span is not None else ""
        page = _PAGE.match(location)
        kept.append(
            {
                "file_id": str(cited.file_id),
                "file_name": cited.file_name,
                # The file's own words, never the tester's paraphrase.
                "quote": clean_line(
                    cited.text[span[0] : span[1]] if span is not None else quote, QUOTE_LENGTH
                ),
                "found": span is not None,
                "location": clean_line(
                    location or ("Screenshot" if is_image_name(cited.file_name) else ""),
                    80,
                ),
                "page": int(page.group(1)) if page is not None else None,
                "box": box,
            }
        )
        if len(kept) >= MAX_CITATIONS:
            break
    return kept
