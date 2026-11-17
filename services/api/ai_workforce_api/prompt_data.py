"""Untrusted text placed inside a prompt's own tags, made inert.

A file's text, its name, the text read from a screenshot, a document linked to a control,
and anything a model or a client wrote are data. A prompt gives them inside tags of its
own (<file>, <evidence>, <client_evidence> ...). Were such text to carry one of those tags,
it could close its block and speak as the request. `neutral` turns the opening bracket of
every tag name any prompt uses into "‹" (and its look-alikes and the HTML entity with it),
so no untrusted text can close a block or open another (security review, 17 November 2026:
the tester, the evidence mapper and matcher, the screenshot review, the control's sources
and the console's evidence reading gave the text as it was).

Everything else is kept as written, so a quote of it still matches the stored text:
citation matching folds "‹" back to "<" (console_citations).
"""

import re

# Every tag name the prompts use around data, longest first so that a longer name is
# never read as a shorter one followed by more letters (the \b keeps that true too).
PROMPT_TAGS: tuple[str, ...] = tuple(
    sorted(
        {
            "attribute",
            "auditor_record",
            "client_evidence",
            "control",
            "control_and_attribute",
            "control_and_attributes",
            "control_and_item",
            "control_context",
            "drafted_attributes",
            "element",
            "evidence",
            "evidence_excerpt",
            "file",
            "file_and_candidates",
            "file_name",
            "mapped_passages",
            "request_and_file",
            "source",
            "sources",
            "text_read_from_the_images",
            "workpaper_facts",
        },
        key=lambda tag: (-len(tag), tag),
    )
)

# The angle bracket and its look-alikes (fullwidth, small, CJK and mathematical angle
# brackets, and the HTML entity), as evidence_assurance.neutral reads them.
_DELIMITER = re.compile(
    r"(?:<|&lt;|\uff1c|\ufe64|\u3008|\u2329|\u27e8)(\s*/?\s*)(" + "|".join(PROMPT_TAGS) + r")\b",
    re.I,
)


def neutral(text: str) -> str:
    """Text with every prompt tag made inert (‹file instead of <file, ‹/evidence instead of
    </evidence, whatever the spacing, the case or the look-alike bracket)."""
    return _DELIMITER.sub(lambda found: "\u2039" + found.group(1) + found.group(2), text)


def attribute_value(text: str) -> str:
    """A value placed inside a tag's attribute in double quotes: neutral, on one line, and
    with no double quote to end the attribute early."""
    return neutral(" ".join(text.split())).replace('"', "\u201d")
