"""Untrusted text placed inside a prompt's own tags, made inert.

A file's text, its name, the text read from a screenshot, a document linked to a control,
and anything a model or a client wrote are data. A prompt gives them inside tags of its
own (<file>, <evidence>, <client_evidence> ...). Were such text to carry one of those tags,
it could close its block and speak as the request. `neutral` turns the opening bracket of
every tag-shaped token into "‹" (and its look-alikes and the HTML entity with it), so no
untrusted text can close a block or open another (security review, 17 November 2026:
the tester, the evidence mapper and matcher, the screenshot review, the control's sources
and the console's evidence reading gave the text as it was).

Any tag name is made inert, not only the ones listed, so no list has to keep up with the
prompts (owner-approved, 18 November 2026). A bracket followed by a letter ("<name",
"</name"), by a slash and a letter whatever the spacing ("< / name"), or by a spaced name
the bracket closes ("< name >") is a tag; a bracket with a space, a figure or "=" after it
("a < b", "x <= 3") is not, and stays as it is. The prompts' own tag names are made inert
whatever the spacing.

Everything else is kept as written, so a quote of it still matches the stored text:
citation matching folds "‹" back to "<" (console_citations).
"""

import re

# The tag names the prompts used around data when the neutraliser was first shared, longest
# first so that a longer name is never read as a shorter one followed by more letters (the
# \b keeps that true too). Any tag name is made inert (_DELIMITER); these are also made
# inert with a space and no closing bracket after the bracket ("< file key=").
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
# brackets, and the HTML entity), as evidence_assurance.neutral reads them, and the closing
# ones that end a spaced tag.
_OPENING = r"(?:<|&lt;|\uff1c|\ufe64|\u3008|\u2329|\u27e8)"
_CLOSING = r"(?:>|&gt;|\uff1e|\ufe65|\u3009|\u232a|\u27e9)"
# The slash and its look-alikes (fullwidth, fraction and division slashes).
_SLASH = r"[/\uff0f\u2044\u2215]"
_NAME = r"[A-Za-z][\w:-]*"
# Only the bracket is replaced: what follows it is looked at, never consumed or changed.
# No two adjacent repeats can match the same characters, so a match takes linear time on
# any run of spaces.
_DELIMITER = re.compile(
    _OPENING
    + r"(?="
    + _SLASH + r"?[A-Za-z]"  # <name, </name
    + r"|\s*" + _SLASH + r"\s*[A-Za-z]"  # < / name
    + r"|\s+" + _NAME + r"\s*(?:" + _SLASH + r"\s*)?" + _CLOSING  # < name >, < name />
    + r"|\s*(?:" + _SLASH + r"\s*)?(?:" + "|".join(PROMPT_TAGS) + r")\b"  # own tag, spaced
    + r")",
    re.I,
)  # fmt: skip


def neutral(text: str) -> str:
    """Text with every tag-shaped token made inert (‹file instead of <file, ‹/evidence
    instead of </evidence, ‹b> instead of <b>, whatever the spacing, the case or the
    look-alike bracket). A bracket that does not start a tag ("a < b") is kept."""
    return _DELIMITER.sub("\u2039", text)


def attribute_value(text: str) -> str:
    """A value placed inside a tag's attribute in double quotes: neutral, on one line, and
    with no double quote to end the attribute early."""
    return neutral(" ".join(text.split())).replace('"', "\u201d")
