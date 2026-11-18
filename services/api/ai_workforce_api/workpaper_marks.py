"""A formatted text section without its marks (docs/design-workpaper.md, section 3.3).

A text section's formatting is stored in its text as marks, so that a reader that knows
nothing of them still shows readable text. This module is the server's reader of that
grammar: `plain` returns the text as a file that cannot show formatting writes it (the
Excel export). The web reads the same grammar (`apps/web/src/rich-text-model.ts`); the
cases both sides must agree on are in `tests/fixtures/rich-text/cases.json`.

The grammar:

- Line endings are LF (CRLF and CR are read as LF). Every line is read without the spaces
  around it; a line of spaces is blank. Blocks are separated by one or more blank lines.
- A block whose every line is "- " and some text is a bulleted list; digits, ". " and
  some text, a numbered list, numbered from one whatever was written. Any other block is
  a paragraph, and a line break inside it is a line break.
- Inside a line the marks are `**` (bold), `''` (italic, two apostrophes) and `++`
  (underline). Each is two characters of its own, read left to right, so a single `*`,
  `'` or `+` is never a mark. A mark opens only directly before a character that is not
  a space, and closes at the next same mark in the line that stands directly after one,
  with something between them. Marks nest: what opens inside a run closes inside it. A
  mark with no partner is plain text. A mark never spans lines.
- A backslash directly before `*`, `+`, `'`, a backslash, `-` or `.` makes that character
  plain and is itself dropped; any other backslash is a backslash.

A space is what the web's reader calls one (JavaScript's white space, as `trim` and `\\s`
read it), listed here so both readers agree on any text.

Pure and linear: one pass per line, and a closing mark is found by position, never by
scanning again. Nothing here is a pattern that can backtrack.
"""

from bisect import bisect_right

# JavaScript's white space and line terminators, less LF and CR (lines are split on them).
SPACES = "\t\x0b\x0c                  　﻿"
_SPACE = frozenset(SPACES)
_MARKS = frozenset("*'+")
_ESCAPED = frozenset("*+'\\-.")
_DIGITS = frozenset("0123456789")


def plain(text: str) -> str:
    """The text without its marks: paragraphs and lists as lines, blocks one blank line
    apart, a list item with its "- " or its number."""
    lines = [
        line.strip(SPACES) for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    ]
    blocks: list[str] = []
    block: list[str] = []
    for line in [*lines, ""]:
        if line:
            block.append(line)
        elif block:
            blocks.append(_block(block))
            block = []
    return "\n\n".join(blocks)


def _block(lines: list[str]) -> str:
    bullets = [_bullet(line) for line in lines]
    if all(item is not None for item in bullets):
        return "\n".join(f"- {_line(item)}" for item in bullets if item is not None)
    numbered = [_numbered(line) for line in lines]
    if all(item is not None for item in numbered):
        found = [item for item in numbered if item is not None]
        return "\n".join(f"{number}. {_line(item)}" for number, item in enumerate(found, 1))
    return "\n".join(_line(line) for line in lines)


def _bullet(line: str) -> str | None:
    """The text of a bulleted item, or None where the line is not one."""
    if not line.startswith("- "):
        return None
    return line[2:].strip(SPACES) or None


def _numbered(line: str) -> str | None:
    """The text of a numbered item, or None where the line is not one."""
    digits = 0
    while digits < len(line) and line[digits] in _DIGITS:
        digits += 1
    if digits == 0 or line[digits : digits + 2] != ". ":
        return None
    return line[digits + 2 :].strip(SPACES) or None


def _line(line: str) -> str:
    """One line without the marks that have a partner, and without the backslash of an
    escaped character."""
    if "\\" not in line and "**" not in line and "''" not in line and "++" not in line:
        return line
    # The line as pieces: a character, an escaped character, or a two-character mark.
    pieces: list[str] = []
    marks: list[str] = []  # the mark's character where the piece is a mark, else ""
    at, end = 0, len(line)
    while at < end:
        char = line[at]
        following = line[at + 1] if at + 1 < end else ""
        if char == "\\" and following and following in _ESCAPED:
            pieces.append(following)
            marks.append("")
            at += 2
        elif char in _MARKS and following == char:
            pieces.append(char + char)
            marks.append(char)
            at += 2
        else:
            pieces.append(char)
            marks.append("")
            at += 1
    count = len(pieces)
    # Where each mark could close: directly after a piece that is not a space.
    closers: dict[str, list[int]] = {mark: [] for mark in _MARKS}
    for index in range(1, count):
        if marks[index] and pieces[index - 1] not in _SPACE:
            closers[marks[index]].append(index)
    kept: list[str] = []
    # The closing mark of each run that is open; a run closes inside the one it opened in.
    open_until = [count]
    index = 0
    while index < count:
        if index == open_until[-1]:
            open_until.pop()
            index += 1
            continue
        mark = marks[index]
        if mark and index + 1 < count and pieces[index + 1] not in _SPACE:
            candidates = closers[mark]
            # The next same mark that can close, with something between the two.
            nearest = bisect_right(candidates, index + 1)
            if nearest < len(candidates) and candidates[nearest] < open_until[-1]:
                open_until.append(candidates[nearest])
                index += 1
                continue
        kept.append(pieces[index])
        index += 1
    return "".join(kept)
