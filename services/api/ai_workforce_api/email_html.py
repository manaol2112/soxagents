"""The HTML part of a live email, laid out from its approved plain text.

The approved text is what the approver approved and what the plain-text part carries,
word for word; this module only lays the same words out for a mail client: the summary
lines as a table, each numbered item as a card with its details, questions as a list,
and the secure link as a button. Nothing is added to or taken from the wording, except a
fixed footer. Every piece of text is escaped. Inline styles and tables only, as mail
clients (Gmail, Outlook) require.
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


@dataclass
class _Item:
    number: str
    title: str
    text: list[str] = field(default_factory=list)
    details: list[tuple[str, str]] = field(default_factory=list)


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


def _item(item: _Item) -> str:
    text = "".join(
        f'<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:{_TEXT};">'
        f"{_inline(line)}</p>"
        for line in item.text
    )
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
            continue
        if item is not None and line.startswith("  "):
            item.text.append(stripped)
            continue
        numbered = _ITEM.match(stripped)
        if numbered is not None:
            flush()
            item = _Item(numbered.group(1), numbered.group(2))
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
