"""The HTML part of a live email, laid out from its approved plain text.

The approved text is what the approver approved and what the plain-text part carries,
word for word; this module only lays the same words out for a mail client: the summary
lines as a table, each numbered item as a card with its details, questions as a list,
and the secure link as a button. Nothing is added to or taken from the wording, except a
fixed frame. Every piece of text is escaped. Inline styles and tables only, as mail
clients (Gmail, Outlook) require, with every text on a background of its own, so a mail
client's dark mode never shows light text on nothing.

An evidence request in the approved redesign (request template version 3, a group's
version 2; request_email.py) has its own layout (_request_html): a top band, a hero with
the stage, the control, its facts and the upload button, the greeting and the agent's
opening, "What we need" with one card per item (its own list as a checklist inside it,
then its labelled lines), "How to send it" as three steps, the signature, and a footer.
Everything in it comes from the subject and the text: the frame's own words (the band's
"Audit evidence request", the button, the note under it, the section headings, the steps
that lay out the text's fixed "HOW TO SEND IT" paragraph, and the footer's last line) are
the same for every email. Any other email, and a request approved on an earlier
version, keeps the layout it had, with an item's own list kept inside the item.
"""

import html
import re
from dataclasses import dataclass, field

# Colours and type: neutral, readable, and close to the workspace.
_INK = "#0b1220"
_TEXT = "#1d2433"
_MUTED = "#4f596b"
_FAINT = "#667085"
_LINE = "#e3e7ee"
_TINT = "#f6f7fa"
_ACCENT = "#3b5bdb"
_CANVAS = "#f1f3f6"
_FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

_URL = re.compile(r"https?://[^\s<>\"']+")
_ITEM = re.compile(r"^(\d{1,2})\.\s+(.+)$")
_DETAIL = re.compile(r"^\s{2,}([A-Z][A-Za-z ]{1,30}):\s*(.*)$")
_SUMMARY = re.compile(r"^(Request|Control|Due|Engagement|Phase|Reference):\s*(.+)$")
# A short label ending in a colon; a sentence that leads into a value ("Your code is:")
# stays a sentence.
_HEADING = re.compile(r"^([A-Z][^.:?!()]{2,60}):$")
_LEADS_IN = re.compile(r"\b(is|are|was|below)$", re.IGNORECASE)
_BULLET = re.compile(r"^[-•]\s+(.+)$")
_CODE = re.compile(r"^\d{6}$")
# An entry of a list inside an item ("1. ...", "2) ...", "- ...").
_INNER = re.compile(r"^(?:\d{1,2}[.)]|[-•*])\s+(\S.*)$")


@dataclass
class _Item:
    number: str
    title: str
    # The item's text, in order; an entry of its own list is "- text".
    text: list[str] = field(default_factory=list)
    details: list[tuple[str, str]] = field(default_factory=list)
    # The next number of an unindented list inside the item, while one is open.
    inner_next: int | None = None

    def restarts(self, number: int) -> bool:
        """Whether an unindented numbered line belongs to the item's own list: it goes
        on with the list in progress, or restarts from 1 after the item's first detail
        line (a draft saved before the drafter indented its inner lists)."""
        if self.inner_next is not None and number == self.inner_next:
            self.inner_next += 1
            return True
        if number == 1 and self.text:
            self.inner_next = 2
            return True
        return False


def _inline(text: str) -> str:
    """Escape a line, then make each web address in it a link."""
    out: list[str] = []
    last = 0
    for match in _URL.finditer(text):
        out.append(html.escape(text[last : match.start()]))
        url = match.group(0).rstrip(".,);")
        tail = match.group(0)[len(url) :]
        out.append(
            f'<a href="{html.escape(url, quote=True)}" style="color:{_ACCENT};'
            f'word-break:break-all;">{html.escape(url)}</a>{html.escape(tail)}'
        )
        last = match.end()
    out.append(html.escape(text[last:]))
    return "".join(out)


def _p(text: str, *, muted: bool = False, size: int = 15) -> str:
    color = _MUTED if muted else _TEXT
    return (
        f'<p style="margin:0 0 14px;font-size:{size}px;line-height:1.6;color:{color};">'
        f"{_inline(text)}</p>"
    )


def _heading(text: str) -> str:
    return (
        f'<p style="margin:22px 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;'
        f'text-transform:uppercase;color:{_FAINT};">{html.escape(text)}</p>'
    )


def _summary(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:6px 16px 6px 0;font-size:13px;color:{_FAINT};'
        f'white-space:nowrap;vertical-align:top;">{html.escape(key)}</td>'
        f'<td style="padding:6px 0;font-size:14px;font-weight:600;color:{_INK};">'
        f"{html.escape(value)}</td></tr>"
        for key, value in rows
    )
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;margin:4px 0 18px;background:{_TINT};border:1px solid {_LINE};'
        f'border-radius:8px;"><tr><td style="padding:12px 16px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0">{cells}'
        f"</table></td></tr></table>"
    )


def _detail_value(key: str, value: str) -> str:
    # A list of fields reads as a list.
    parts = [part.strip() for part in value.split(";") if part.strip()]
    if key.lower() in ("include", "fields") and len(parts) > 1:
        items = "".join(f'<li style="margin:0 0 3px;">{_inline(part)}</li>' for part in parts)
        return f'<ul style="margin:0;padding-left:18px;">{items}</ul>'
    return _inline(value)


def _item_text(lines: list[str]) -> str:
    """An item's text: its sentences as paragraphs, its own list as a list."""
    out: list[str] = []
    entries: list[str] = []

    def close() -> None:
        if entries:
            listed = "".join(f'<li style="margin:0 0 4px;">{_inline(e)}</li>' for e in entries)
            out.append(
                f'<ul style="margin:0 0 10px;padding-left:20px;font-size:14px;'
                f'line-height:1.6;color:{_TEXT};">{listed}</ul>'
            )
            entries.clear()

    for line in lines:
        if line.startswith("- "):
            entries.append(line[2:])
            continue
        close()
        out.append(
            f'<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:{_TEXT};">'
            f"{_inline(line)}</p>"
        )
    close()
    return "".join(out)


def _item(item: _Item) -> str:
    text = _item_text(item.text)
    details = "".join(
        f'<tr><td style="padding:5px 14px 5px 0;font-size:12px;font-weight:600;'
        f'color:{_FAINT};white-space:nowrap;vertical-align:top;">{html.escape(key)}</td>'
        f'<td style="padding:5px 0;font-size:13px;line-height:1.5;color:{_TEXT};">'
        f"{_detail_value(key, value)}</td></tr>"
        for key, value in item.details
    )
    table = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;margin-top:4px;border-top:1px solid {_LINE};">{details}</table>'
        if details
        else ""
    )
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;margin:0 0 12px;border:1px solid {_LINE};border-radius:8px;">'
        f'<tr><td style="padding:14px 16px;">'
        f'<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:{_INK};">'
        f'<span style="display:inline-block;min-width:22px;color:{_ACCENT};">'
        f"{html.escape(item.number)}.</span>{html.escape(item.title)}</p>"
        f"{text}{table}</td></tr></table>"
    )


def _button(url: str, label: str) -> str:
    safe = html.escape(url, quote=True)
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:6px 0 10px;"><tr><td style="border-radius:8px;background:{_ACCENT};">'
        f'<a href="{safe}" style="display:inline-block;padding:12px 22px;font-size:15px;'
        f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">'
        f"{html.escape(label)}</a></td></tr></table>"
        f'<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:{_FAINT};">'
        f"Or open this address: "
        f'<a href="{safe}" style="color:{_ACCENT};word-break:break-all;">'
        f"{html.escape(url)}</a></p>"
    )


def _code(code: str) -> str:
    return (
        f'<p style="margin:6px 0 18px;font-family:Consolas, Menlo, monospace;font-size:28px;'
        f"font-weight:700;letter-spacing:0.25em;color:{_INK};background:{_TINT};"
        f'border:1px solid {_LINE};border-radius:8px;padding:14px 18px;display:inline-block;">'
        f"{html.escape(code)}</p>"
    )


def _blocks(body: str) -> list[list[str]]:
    """The text as blocks separated by blank lines."""
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in body.replace("\r\n", "\n").split("\n"):
        if line.strip() == "":
            if current:
                blocks.append(current)
                current = []
        else:
            current.append(line.rstrip())
    if current:
        blocks.append(current)
    return blocks


def _render_block(lines: list[str]) -> str:
    out: list[str] = []
    paragraph: list[str] = []
    summary: list[tuple[str, str]] = []
    bullets: list[str] = []
    item: _Item | None = None

    def flush() -> None:
        nonlocal item
        if paragraph:
            out.append(_p(" ".join(paragraph)))
            paragraph.clear()
        if summary:
            out.append(_summary(list(summary)))
            summary.clear()
        if bullets:
            items = "".join(f'<li style="margin:0 0 6px;">{_inline(text)}</li>' for text in bullets)
            out.append(
                f'<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;'
                f'line-height:1.6;color:{_TEXT};">{items}</ul>'
            )
            bullets.clear()
        if item is not None:
            out.append(_item(item))
            item = None

    for line in lines:
        stripped = line.strip()
        url = _URL.fullmatch(stripped)
        if url is not None:
            flush()
            out.append(_button(stripped, _button_label(lines)))
            continue
        if _CODE.fullmatch(stripped):
            flush()
            out.append(_code(stripped))
            continue
        detail = _DETAIL.match(line)
        if item is not None and detail is not None:
            item.details.append((detail.group(1), detail.group(2)))
            item.inner_next = None
            continue
        if item is not None and line.startswith("  "):
            # An indented line is the item's, and an indented list entry is its list's.
            inner = _INNER.match(stripped)
            item.text.append(stripped if inner is None else f"- {inner.group(1)}")
            continue
        numbered = _ITEM.match(stripped)
        if numbered is not None:
            if item is not None and item.restarts(int(numbered.group(1))):
                item.text.append(f"- {numbered.group(2)}")
                continue
            flush()
            item = _Item(numbered.group(1), numbered.group(2))
            continue
        if item is not None and item.inner_next is not None:
            # A line after the item's own list, before its labelled lines: still the item's.
            item.text.append(stripped)
            continue
        heading = _HEADING.match(stripped)
        if (
            heading is not None
            and len(heading.group(1).split()) <= 8
            and _LEADS_IN.search(heading.group(1)) is None
        ):
            flush()
            out.append(_heading(heading.group(1)))
            continue
        pair = _SUMMARY.match(stripped)
        if pair is not None:
            if paragraph or bullets or item is not None:
                flush()
            summary.append((pair.group(1), pair.group(2)))
            continue
        bullet = _BULLET.match(stripped)
        if bullet is not None:
            if paragraph or summary or item is not None:
                flush()
            bullets.append(bullet.group(1))
            continue
        if summary or bullets or item is not None:
            flush()
        paragraph.append(stripped)
    flush()
    return "".join(out)


def _button_label(lines: list[str]) -> str:
    text = " ".join(lines).lower()
    if "upload" in text or "evidence" in text:
        return "Open the secure upload page"
    if "sign in" in text or "welcome" in text:
        return "Open the workspace"
    return "Open the link"


def to_html(subject: str, body: str) -> str:
    """The email as HTML, from its approved text."""
    if _is_request(body):
        return _request_html(subject, body)
    content = "".join(_render_block(block) for block in _blocks(body))
    # The reference tag ("[PBC-…]") stays in the subject for replies; the summary shows it.
    title = html.escape(re.sub(r"^\[[^\]]{1,40}\]\s*", "", subject))
    return (
        "<!doctype html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{title}</title></head>"
        f'<body style="margin:0;padding:0;background:{_CANVAS};">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;background:{_CANVAS};font-family:{_FONT};">'
        '<tr><td align="center" style="padding:28px 12px;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;max-width:640px;background:#ffffff;border:1px solid {_LINE};'
        f'border-radius:12px;">'
        f'<tr><td style="padding:22px 28px 18px;border-bottom:1px solid {_LINE};">'
        f'<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;'
        f'text-transform:uppercase;color:{_ACCENT};">Audit evidence</p>'
        f'<p style="margin:6px 0 0;font-size:19px;font-weight:700;line-height:1.35;'
        f'color:{_INK};">{title}</p></td></tr>'
        f'<tr><td style="padding:22px 28px 10px;">{content}</td></tr>'
        f'<tr><td style="padding:16px 28px 22px;border-top:1px solid {_LINE};'
        f'background:{_TINT};border-radius:0 0 12px 12px;">'
        f'<p style="margin:0;font-size:12px;line-height:1.6;color:{_FAINT};">'
        "Sent on behalf of the audit team. Evidence is accepted only through the secure "
        "upload link, not as email attachments.</p></td></tr>"
        "</table></td></tr></table></body></html>"
    )


# The evidence request in the approved redesign (request_email.py)

_NEED = "WHAT WE NEED"
_SEND = "HOW TO SEND IT"
_PAGE = "#eef0f4"
_HERO = "#f7f8fb"
_SOFT = "#eef2ff"
_RULE = "#eef0f4"
_FACT = re.compile(r"^(Control|Controls|System|Systems|Stage|Due|Reference):\s+(\S.*)$")
_ROW = re.compile(
    r"^(Covers|Make sure it shows|Format|Show|Complete when|If not available):\s*(.*)$"
)
_SUBJECT = re.compile(
    r"^(?P<reminder>Reminder: )?(?P<title>.+?)(?: \((?P<refs>[^()]+)\))?: "
    r"(?:(?P<count>\d+) items?|evidence) due (?P<due>.+?) \[(?P<reference>[^\]]{1,40})\]$"
)
_SIGNATURE = re.compile(r"^The (?P<team>.+) team$")
_REMINDER = re.compile(r"^This is reminder (\d+) of (\d+)\b")
_MEMBER = re.compile(r"^(?P<text>.+\)(?:, due [^:]{1,40})?):$")
_OPEN_PAGE = re.compile(
    r"^Open your secure upload page(?P<full>, where each item is described in full)?:$"
)
_STEPS_TEXT = (
    "Enter the one-time code we email to this address, then upload each file against its "
    "item. Please do not send evidence as email attachments."
)


def _is_request(body: str) -> bool:
    lines = {line.strip() for line in body.replace("\r\n", "\n").split("\n")}
    return _NEED in lines and _SEND in lines


@dataclass
class _Request:
    subject: str
    greeting: str = ""
    intro: list[str] = field(default_factory=list)
    facts: dict[str, str] = field(default_factory=dict)
    need: list[list[str]] = field(default_factory=list)
    send: list[list[str]] = field(default_factory=list)

    @property
    def url(self) -> str:
        for block in self.send:
            for line in block:
                if _URL.fullmatch(line.strip()):
                    return line.strip()
        return ""

    @property
    def team(self) -> str:
        for block in self.send:
            if len(block) == 2 and block[0].strip() == "Thank you,":
                found = _SIGNATURE.match(block[1].strip())
                if found is not None:
                    return found.group("team")
        return ""


def _read(subject: str, body: str) -> _Request:
    request = _Request(subject=subject)
    part = "intro"
    for block in _blocks(body):
        stripped = [line.strip() for line in block]
        if stripped == [_NEED]:
            part = "need"
            continue
        if stripped == [_SEND]:
            part = "send"
            continue
        if part == "need":
            request.need.append(block)
        elif part == "send":
            request.send.append(block)
        elif (
            not request.greeting
            and not request.intro
            and len(block) == 1
            and stripped[0].startswith("Hello")
            and stripped[0].endswith(",")
        ):
            request.greeting = stripped[0]
        elif all(_FACT.match(line) for line in stripped):
            for line in stripped:
                fact = _FACT.match(line)
                if fact is not None:
                    request.facts[fact.group(1)] = fact.group(2)
        else:
            request.intro.append(" ".join(stripped))
    return request


def _cell(content: str, style: str, background: str = "") -> str:
    """A table cell; one with a background names it twice (style and bgcolor), so a mail
    client that drops one keeps the other."""
    bg = f' bgcolor="{background}"' if background else ""
    full = f"{style}background:{background};" if background else style
    return f'<td style="{full}"{bg}>{content}</td>'


def _table(rows: str, style: str = "", width: bool = True) -> str:
    wide = ' width="100%"' if width else ""
    full = f"width:100%;{style}" if width else style
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0"{wide} '
        f'style="{full}">{rows}</table>'
    )


def _section(text: str) -> str:
    return (
        f'<p style="margin:22px 0 10px;font-size:12px;font-weight:700;letter-spacing:0.06em;'
        f'text-transform:uppercase;color:{_FAINT};">{html.escape(text)}</p>'
    )


def _para(text: str, *, size: int = 15, color: str = _TEXT, margin: str = "0 0 14px") -> str:
    return (
        f'<p style="margin:{margin};font-size:{size}px;line-height:1.6;color:{color};">'
        f"{_inline(text)}</p>"
    )


def _checklist(entries: list[str]) -> str:
    box = (
        '<div style="width:11px;height:11px;border:2px solid #9aa4b5;border-radius:3px;'
        'background:#ffffff;font-size:1px;line-height:1px;">&nbsp;</div>'
    )
    rows = "".join(
        "<tr>"
        + _cell(box, "width:15px;padding:4px 10px 6px 0;vertical-align:top;")
        + _cell(
            _inline(entry),
            f"padding:0 0 6px;font-size:14px;line-height:1.55;color:{_TEXT};vertical-align:top;",
        )
        + "</tr>"
        for entry in entries
    )
    return _table(rows, "margin:0 0 10px;")


def _rows(rows: list[tuple[str, str]]) -> str:
    cells = ""
    for key, value in rows:
        parts = [part.strip() for part in value.split(";") if part.strip()]
        shown = (
            " &middot; ".join(_inline(part) for part in parts)
            if key == "Make sure it shows" and len(parts) > 1
            else _inline(value)
        )
        cells += (
            "<tr>"
            + _cell(
                html.escape(key),
                f"width:96px;padding:7px 12px 7px 0;font-size:13px;font-weight:600;"
                f"line-height:1.45;color:{_FAINT};vertical-align:top;"
                f"border-bottom:1px solid {_RULE};",
            )
            + _cell(
                shown,
                f"padding:7px 0;font-size:13px;line-height:1.5;color:{_TEXT};"
                f"vertical-align:top;border-bottom:1px solid {_RULE};",
            )
            + "</tr>"
        )
    return _table(cells, f"border-collapse:collapse;border-top:1px solid {_RULE};margin:2px 0 0;")


def _badge(
    text: str, *, round_: bool = False, background: str = _SOFT, color: str = _ACCENT
) -> str:
    radius = "999px" if round_ else "6px"
    return (
        f'<div style="width:24px;height:24px;line-height:24px;border-radius:{radius};'
        f"background:{background};color:{color};font-size:12px;font-weight:700;"
        f'text-align:center;">{html.escape(text)}</div>'
    )


def _card(number: str, title: str, lines: list[str]) -> str:
    """One item: its number and title, its text with its own list as a checklist, then
    its labelled lines."""
    rows: list[tuple[str, str]] = []
    body: list[str] = []
    entries: list[str] = []

    def close() -> None:
        if entries:
            body.append(_checklist(list(entries)))
            entries.clear()

    for line in lines:
        text = line.strip()
        row = _ROW.match(text)
        if row is not None:
            rows.append((row.group(1), row.group(2)))
            continue
        inner = _INNER.match(text)
        if inner is not None:
            entries.append(inner.group(1))
            continue
        close()
        body.append(_para(text, size=14, margin="0 0 10px"))
    close()
    if rows:
        body.append(_rows(rows))
    head = _table(
        "<tr>"
        + _cell(_badge(number), "width:24px;vertical-align:top;")
        + _cell(
            html.escape(title),
            f"padding:2px 0 0 12px;font-size:15px;font-weight:700;line-height:1.4;"
            f"color:{_INK};vertical-align:top;",
        )
        + "</tr>",
        width=False,
    )
    # The card's white is on the table itself (style and bgcolor), so its rounded border
    # is not covered by square cells.
    inner_rows = "<tr>" + _cell(head, "padding:14px 16px 8px;") + "</tr>"
    if body:
        inner_rows += "<tr>" + _cell("".join(body), "padding:0 16px 12px 52px;") + "</tr>"
    return _table(
        inner_rows,
        f"margin:0 0 12px;border:1px solid {_LINE};border-radius:10px;"
        "border-collapse:separate;background:#ffffff;",
    ).replace("<table ", '<table bgcolor="#ffffff" ', 1)


def _need(blocks: list[list[str]]) -> str:
    out: list[str] = []
    for block in blocks:
        first = block[0].strip()
        head = _ITEM.match(first) if not block[0].startswith(" ") else None
        if head is not None:
            # Every line of the block after the title is the item's: request_email writes
            # an item as one block.
            out.append(_card(head.group(1), head.group(2), block[1:]))
            continue
        if first == "Questions for you:":
            out.append(
                f'<p style="margin:16px 0 8px;font-size:14px;font-weight:700;color:{_INK};">'
                "Questions for you</p>"
            )
            out.append(_checklist([line.strip()[2:] for line in block[1:]]))
            continue
        member = _MEMBER.match(first)
        if member is not None and len(block) == 1:
            out.append(
                f'<p style="margin:18px 0 10px;font-size:14px;font-weight:700;'
                f'line-height:1.45;color:{_INK};">{html.escape(member.group("text"))}</p>'
            )
            continue
        if all(line.strip().startswith("- ") for line in block):
            out.append(_checklist([line.strip()[2:] for line in block]))
            continue
        out.append(_para(" ".join(line.strip() for line in block), size=14))
    return "".join(out)


def _steps(url: str, full: bool) -> str:
    """The text's fixed HOW TO SEND IT paragraph, laid out as three steps."""
    where = (
        f'<a href="{html.escape(url, quote=True)}" style="color:{_ACCENT};'
        f'word-break:break-all;">{html.escape(url)}</a>'
        if url
        else html.escape("the secure link")
    )
    described = ", where each item is described in full," if full else ""
    steps = [
        f"Open your secure upload page{described} with the button above, or this address: {where}",
        html.escape("Enter the one-time code we email to this address."),
        html.escape(
            "Upload each file against its item. You can upload in several sittings; the "
            "page shows every open request we have sent you for this audit."
        ),
    ]
    rows = "".join(
        "<tr>"
        + _cell(
            _badge(str(n), round_=True, background="#f1f3f6", color=_MUTED),
            "width:24px;padding:0 10px 8px 0;vertical-align:top;",
        )
        + _cell(
            step,
            f"padding:2px 0 8px;font-size:14px;line-height:1.55;color:{_TEXT};vertical-align:top;",
        )
        + "</tr>"
        for n, step in enumerate(steps, 1)
    )
    return _table(rows, "margin:0 0 6px;") + _para(
        "Please do not send evidence as email attachments: we can only accept it through "
        "the secure page.",
        size=14,
    )


def _send_part(request: _Request) -> str:
    out: list[str] = []
    for block in request.send:
        stripped = [line.strip() for line in block]
        page = _OPEN_PAGE.match(stripped[0])
        if page is not None and len(stripped) == 3 and stripped[2] == _STEPS_TEXT:
            out.append(_steps(request.url, page.group("full") is not None))
            continue
        if len(stripped) == 2 and stripped[0] == "Thank you,":
            out.append(
                f'<p style="margin:18px 0 6px;font-size:15px;line-height:1.6;color:{_TEXT};">'
                f'Thank you,<br><b style="color:{_INK};font-weight:700;">'
                f"{html.escape(stripped[1])}</b></p>"
            )
            continue
        if stripped[0].startswith("Questions?"):
            out.append(_para(" ".join(stripped), size=14, color=_MUTED))
            continue
        for line in stripped:
            if _URL.fullmatch(line):
                out.append(_button(line, "Open the secure upload page"))
            else:
                out.append(_para(line, size=14))
    return "".join(out)


def _items_words(count: str) -> str:
    return {"": "Evidence", "1": "1 item"}.get(count, f"{count} items")


def _hero(request: _Request, count: str, title: str, refs: str, reminder: str) -> str:
    stage = request.facts.get("Stage", "")
    kicker = " · ".join(part for part in (reminder, stage) if part) or "Evidence request"
    words = _items_words(count)
    still = " still" if reminder else ""
    if title:
        # "the Periodic User Access Review", "the SOX FY2027 audit"; a bare reference
        # (a request whose control has no name on record) stands alone.
        article = "the " if " " in title else ""
        heading = f"{words}{still} needed for {article}{title}"
    else:
        heading = f"{words}{still} needed"
    controls = request.facts.get("Controls", "")
    control = request.facts.get("Control", "")
    if controls:
        line = " · ".join(part.strip() for part in controls.split(","))
    else:
        line = " · ".join(part.strip() for part in control.split(",", 1)) if control else ""
    chips: list[str] = []
    due = request.facts.get("Due", "")
    if due:
        chips.append(
            '<span style="display:inline-block;margin:0 6px 8px 0;padding:5px 10px;'
            "border-radius:999px;border:1px solid #f3d9a4;background:#fff7e8;color:#8a3d06;"
            f'font-size:13px;font-weight:600;">Due {html.escape(due)}</span>'
        )
    systems = request.facts.get("System", "") or request.facts.get("Systems", "")
    for chip in (words if count else "", systems):
        if chip:
            chips.append(
                '<span style="display:inline-block;margin:0 6px 8px 0;padding:5px 10px;'
                f"border-radius:999px;border:1px solid {_LINE};background:#ffffff;"
                f'color:{_TEXT};font-size:13px;">{html.escape(chip)}</span>'
            )
    url = request.url
    look = (
        "display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;"
        f"line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;"
        f"background:{_ACCENT};"
    )
    button = (
        f'<a href="{html.escape(url, quote=True)}" style="{look}">Upload evidence</a>'
        if url
        else f'<span style="{look}">Upload evidence</span>'
    )
    described = (
        f'<p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:{_MUTED};">'
        f"{html.escape(line)}</p>"
        if line
        else ""
    )
    return (
        f'<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.08em;'
        f'text-transform:uppercase;color:{_ACCENT};">{html.escape(kicker)}</p>'
        f'<h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:700;color:{_INK};">'
        f"{html.escape(heading)}</h1>"
        f"{described}"
        f'<p style="margin:16px 0 10px;line-height:1;">{"".join(chips)}</p>'
        + _table("<tr>" + _cell(button, "border-radius:8px;", _ACCENT) + "</tr>", width=False)
        + f'<p style="margin:10px 0 0;font-size:12.5px;line-height:1.5;color:{_FAINT};">'
        "Opens your secure upload page. A one-time code is sent to this address when you "
        "open it.</p>"
    )


def _request_html(subject: str, body: str) -> str:
    """An evidence request in the approved redesign, from its subject and text."""
    request = _read(subject, body)
    match = _SUBJECT.match(subject.strip())
    title = refs = count = reminder = ""
    reference = request.facts.get("Reference", "")
    if match is not None:
        title = match.group("title")
        refs = match.group("refs") or ""
        count = match.group("count") or ""
        reference = reference or match.group("reference")
    for paragraph in request.intro:
        found = _REMINDER.match(paragraph)
        if found is not None:
            reminder = f"Reminder {found.group(1)} of {found.group(2)}"
    team = request.team
    audit = team or "audit"
    engagement = audit[: -len(" audit")] if audit.endswith(" audit") else audit
    due = request.facts.get("Due", "")
    preheader = (
        f"{'Reminder: ' if reminder else ''}{_items_words(count)} for the {audit}"
        + (f", due {due}" if due else "")
        + f". Upload {'it' if count == '1' else 'them'} through your secure link."
    )
    contact = request.facts.get("Controls") or request.facts.get("Control", "").split(",", 1)[0]
    names = [part.strip() for part in contact.split(",") if part.strip()]
    if len(names) > 1:
        whom = ", ".join(names[:-1]) + f" and {names[-1]}"
    else:
        whom = names[0] if names else ""
    footer = (
        f"You are receiving this because you are the contact for {whom} in the {audit}."
        if whom
        else f"You are receiving this because the {audit} team asked you for evidence."
    )
    content = (
        (_para(request.greeting) if request.greeting else "")
        + "".join(_para(p) for p in request.intro)
        + _section("What we need")
        + _need(request.need)
        + _section("How to send it")
        + _send_part(request)
    )
    muted = f"font-size:12px;line-height:1.5;color:{_FAINT};letter-spacing:0.02em;"
    named = f'<b style="color:{_INK};font-weight:600;">{html.escape(engagement)}</b> · '
    band = _table(
        "<tr>"
        + _cell((named if team else "") + "Audit evidence request", muted)
        + (
            _cell(
                f"Ref. {html.escape(reference)}",
                f"{muted}text-align:right;white-space:nowrap;padding-left:12px;",
            )
            if reference
            else ""
        )
        + "</tr>"
    )
    closing = (
        f'<p style="margin:0 0 6px;font-size:12px;line-height:1.55;color:{_FAINT};">'
        f"{html.escape(footer)}</p>"
        f'<p style="margin:0;font-size:12px;line-height:1.55;color:{_FAINT};">'
        "We will never ask for your password or for access to a system by email.</p>"
    )
    rows = (
        "<tr>"
        + _cell(band, f"padding:14px 24px;border-bottom:1px solid {_LINE};", "#ffffff")
        + "</tr><tr>"
        + _cell(
            _hero(request, count, title, refs, reminder),
            f"padding:26px 24px 22px;border-bottom:1px solid {_LINE};",
            _HERO,
        )
        + "</tr><tr>"
        + _cell(content, "padding:24px 24px 8px;", "#ffffff")
        + "</tr><tr>"
        + _cell(
            closing,
            f"padding:16px 24px 20px;border-top:1px solid {_LINE};border-radius:0 0 12px 12px;",
            _HERO,
        )
        + "</tr>"
    )
    card = _table(
        rows,
        f"max-width:640px;border:1px solid {_LINE};border-radius:12px;"
        "border-collapse:separate;background:#ffffff;",
    )
    shown = html.escape(re.sub(r"\s*\[[^\]]{1,40}\]\s*$", "", subject.strip()))
    hidden = (
        f'<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;'
        f'mso-hide:all;font-size:1px;line-height:1px;color:{_PAGE};">'
        f"{html.escape(preheader)}{'&#8199;&#847;' * 40}</div>"
    )
    page = _table(
        '<tr><td align="center" bgcolor="' + _PAGE + '" style="padding:24px 12px;'
        f'background:{_PAGE};">{card}</td></tr>',
        f"background:{_PAGE};font-family:{_FONT};",
    )
    return (
        "<!doctype html>"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="color-scheme" content="light">'
        '<meta name="supported-color-schemes" content="light">'
        f"<title>{shown}</title></head>"
        f'<body style="margin:0;padding:0;background:{_PAGE};" bgcolor="{_PAGE}">'
        f"{hidden}{page}</body></html>"
    )
