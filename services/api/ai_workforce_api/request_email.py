"""The evidence request email's wording, as the product owner approved its redesign
(12 November 2026): request template version 3, reminder version 3, and the grouped
request and its reminder version 2 (outbound.py, evidence_groups.py).

The approved text is still the system of record: what the approver reads is what the
plain-text part carries, word for word, and the send renders it again and refuses
anything else. This module only composes that text, deterministically, from the request
as it stands and the facts its approval holds (migration 0157): a greeting by name when
a record holds a person's name for the recipient, the agent's opening, a few facts
(control, system, stage, due date, reference), "WHAT WE NEED" with every item, "HOW TO
SEND IT", and the signature. The HTML part (email_html.py) lays the same words out; it
adds only a fixed frame.

The request's own wording is read back tolerantly (parse) and never shortened here: every
line of it is in the email, in its order. An item's labels are renamed in words an owner
understands (Period becomes Covers, Include becomes Make sure it shows, Completeness
becomes Complete when). A list inside an item stays inside it as indented "- " lines,
also for a draft saved before the drafter indented its inner lists: within an item's own
paragraph, an unindented list numbered from 1 belongs to the item. A new paragraph that
starts with a number is always a new item.
"""

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

# The drafter's labels (pbc_drafting.render, evidence_plans.render), stored as written,
# and the words the email uses for them.
LABELS: dict[str, str] = {
    "Period": "Covers",
    "Include": "Make sure it shows",
    "Format": "Format",
    "Show": "Show",
    "Completeness": "Complete when",
    "If not available": "If not available",
}
# The testing phase in words an owner understands.
PHASE_WORDS: dict[str, str] = {
    "DESIGN": "Design review",
    "INTERIM": "Interim testing",
    "ROLLFORWARD": "Roll-forward",
    "RETEST": "Retest",
    "REMEDIATION": "Remediation testing",
}
FREQUENCY_WORDS: dict[str, str] = {
    "ANNUAL": "Annual",
    "QUARTERLY": "Quarterly",
    "MONTHLY": "Monthly",
    "WEEKLY": "Weekly",
    "DAILY": "Daily",
}
QUESTIONS = "Questions for you:"
# The lines the templates head their sections with. The HTML part finds the sections by
# them, so a line of the wording that is one of them is written in sentence case: the
# same words, and never a section of the email.
SECTION_MARKERS: dict[str, str] = {
    "WHAT WE NEED": "What we need",
    "HOW TO SEND IT": "How to send it",
}

_ITEM = re.compile(r"^(\d{1,2})\.\s+(\S.*)$")
_INNER = re.compile(r"^(?:\d{1,2}[.)]|[-•*])\s+(\S.*)$")
_LABELLED = re.compile(r"^(Period|Include|Format|Show|Completeness|If not available):\s*(.*)$")
_FREQUENCY_WORD = frozenset({"periodic", "annual", "quarterly", "monthly", "weekly", "daily"})
_REFERENCE = re.compile(r"(?i)\bPBC-(?=[0-9A-F]{8}\b)")
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_HONORIFIC = re.compile(
    r"^(?:(?:dr|mr|mrs|ms|miss|mx|prof|professor|sir|madam|mme)\.?\s+)+", re.IGNORECASE
)
_PARTICLES = frozenset({"de", "da", "di", "du", "del", "der", "la", "le", "van", "von", "bin", "y"})
# Words that make a contact's name a role, a team or a mailbox rather than a person's.
_ROLE_WORDS = frozenset(
    {
        "access", "accounting", "accounts", "admin", "administration", "administrator",
        "administrators", "advisory", "analyst", "approver", "audit", "basis", "board",
        "cloud", "committee", "compliance", "contact", "control", "controller",
        "coordinator", "database", "department", "desk", "engineering", "finance",
        "function", "group", "helpdesk", "hr", "inbox", "infrastructure", "it", "lead",
        "legal", "mailbox", "manager", "network", "office", "operations", "ops", "owner",
        "owners", "payables", "payroll", "platform", "process", "procurement",
        "receivables", "reviewer", "sales", "security", "service", "services", "shared",
        "support", "system", "systems", "tax", "team", "the", "treasury", "unit", "user",
        "users",
    }
)  # fmt: skip


@dataclass(frozen=True)
class Facts:
    """What the email names besides the request's own wording, read from its records
    when the message is first rendered for an approval and kept with that approval
    (migration 0157): the control's name, a short line describing it, its system, and
    the recipient's name as a record holds it (never one made up from the address)."""

    control_title: str = ""
    control_line: str = ""
    system: str = ""
    recipient_name: str = ""

    def as_json(self) -> dict[str, str]:
        return {
            "control_title": self.control_title,
            "control_line": self.control_line,
            "system": self.system,
            "recipient_name": self.recipient_name,
        }

    @staticmethod
    def from_json(value: Any) -> Facts:
        held = value if isinstance(value, dict) else {}
        return Facts(
            control_title=str(held.get("control_title", "")),
            control_line=str(held.get("control_line", "")),
            system=str(held.get("system", "")),
            recipient_name=str(held.get("recipient_name", "")),
        )


@dataclass
class Item:
    number: int
    title: str
    # The item's lines in their order, as the email writes them: its text, an entry of
    # its own list ("- text"), or a labelled line under the email's label ("Covers: ...").
    lines: list[str] = field(default_factory=list)
    # Which of them are labelled lines read from the wording's own labels.
    rows: list[int] = field(default_factory=list)
    # The next number of an unindented list inside the item, within its paragraph.
    inner_next: int | None = None

    def text(self, *, brief: bool = False) -> str:
        out = [f"{self.number}. {self.title}"]
        for index, line in enumerate(self.lines):
            if not brief or (index in self.rows and line.startswith("Covers:")):
                out.append(f"   {line}")
        return "\n".join(out)


@dataclass
class Text:
    """A paragraph of the wording that is no item's: kept where it stands."""

    lines: list[str] = field(default_factory=list)

    def text(self) -> str:
        return "\n".join(self.lines)


@dataclass
class Questions:
    entries: list[str] = field(default_factory=list)

    def text(self) -> str:
        return "\n".join([QUESTIONS, *(f"- {entry}" for entry in self.entries)])


@dataclass
class Wording:
    # The paragraphs before the first item.
    opening: list[str] = field(default_factory=list)
    # Everything from the first item on, in its order.
    blocks: list[Item | Text | Questions] = field(default_factory=list)

    @property
    def items(self) -> list[Item]:
        return [block for block in self.blocks if isinstance(block, Item)]


def _plain(text: str) -> str:
    """A line of the wording as the email writes it: one that is a section heading of
    the email, in sentence case."""
    return SECTION_MARKERS.get(text, text)


def _feed(item: Item, line: str) -> None:
    """One line of an item: a labelled line, an entry of its own list, or text."""
    text = line.strip()
    labelled = _LABELLED.match(text)
    if labelled is not None:
        item.rows.append(len(item.lines))
        item.lines.append(f"{LABELS[labelled.group(1)]}: {labelled.group(2).strip()}".rstrip())
        item.inner_next = None
        return
    inner = _INNER.match(text)
    item.lines.append(f"- {inner.group(1)}" if inner is not None else _plain(text))


def parse(description: str) -> Wording:
    """The request's wording read into its opening, then its items, questions and other
    paragraphs in their order. No line is left out. A wording with no numbered items
    comes back as its opening and whatever follows it."""
    wording = Wording()
    current: Item | None = None
    questions: Questions | None = None
    text: Text | None = None
    opening: list[str] | None = None
    fresh = True  # the next line starts a paragraph
    for raw in description.replace("\r\n", "\n").replace("\r", "\n").strip().split("\n"):
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            fresh = True
            if current is not None:
                # An item's own list goes on only within its paragraph.
                current.inner_next = None
            continue
        starts, fresh = fresh, False
        indented = line[:1] in (" ", "\t")
        numbered = None if indented else _ITEM.match(line)
        if stripped == QUESTIONS:
            questions = Questions()
            wording.blocks.append(questions)
            current = text = opening = None
            continue
        if questions is not None:
            bullet = re.match(r"^[-•*]\s+(\S.*)$", stripped)
            if bullet is not None:
                questions.entries.append(_plain(bullet.group(1)))
                continue
            if numbered is not None and (not starts or not questions.entries):
                questions.entries.append(_plain(numbered.group(2).strip()))
                continue
            if not starts:
                # A question that runs on to the next line, or one written with no dash.
                if questions.entries:
                    questions.entries[-1] = f"{questions.entries[-1]} {stripped}"
                else:
                    questions.entries.append(_plain(stripped))
                continue
            questions = None
        if numbered is not None:
            number, title = int(numbered.group(1)), numbered.group(2).strip()
            if current is not None and not starts:
                if current.inner_next is not None and number == current.inner_next:
                    current.inner_next += 1
                    current.lines.append(f"- {title}")
                    continue
                if number == 1 and current.lines:
                    current.inner_next = 2
                    current.lines.append(f"- {title}")
                    continue
                if number != current.number + 1:
                    # A sentence that wrapped onto a line starting with a number.
                    current.lines.append(_plain(stripped))
                    continue
            current = Item(number, _plain(title))
            wording.blocks.append(current)
            text = opening = None
            continue
        if current is not None and (indented or not starts):
            _feed(current, line)
            continue
        current = None
        if not wording.blocks:
            if opening is None or starts:
                opening = []
                wording.opening.append("")
            opening.append(_plain(stripped))
            wording.opening[-1] = "\n".join(opening)
            continue
        if text is None or starts:
            text = Text()
            wording.blocks.append(text)
        text.lines.append(_plain(stripped))
    return wording


# The parts the templates carry


def first_name(name: str) -> str:
    """The first name to greet by, from a name a record holds; empty ("Hello,") unless it
    reads as one person's name: at least two words once a title (Dr, Mr, Ms, Prof) and
    anything in brackets are set aside, each capitalized (particles such as "de" and
    "bin" apart), written first name first (no comma), naming one person (no "/", "&" or
    "and"), with a first word that is a word (not a letter, an initial or all capitals),
    and no word that makes it a role, a team or a mailbox ("Access administrator",
    "Treasury", "AP Shared Inbox")."""
    clean = " ".join(re.sub(r"\([^)]*\)", " ", name).split())
    if not clean or "@" in clean or any(mark in clean for mark in (",", "/", "&", ";", ":")):
        return ""
    clean = _HONORIFIC.sub("", clean)
    words = clean.split(" ")
    if len(words) < 2 or any(w.lower() in ("and", "or") for w in words):
        return ""
    if any(w.lower().strip(".") in _ROLE_WORDS for w in words):
        return ""
    if not all(w[:1].isupper() or w.lower() in _PARTICLES for w in words):
        return ""
    first = words[0]
    if len(first) < 2 or first.endswith(".") or first.isupper() or not first[:1].isupper():
        return ""
    if not all(ch.isalpha() or ch in "-'’" for ch in first):
        return ""
    return first[:60]


def one_name(names: list[str]) -> str:
    """The name to greet an address by, from every name the records hold for it: the
    first of them when all name the same person by first name; none when a name is not a
    person's, or the address is held by more than one (a shared mailbox)."""
    held = [" ".join(name.split()) for name in names if name.strip()]
    firsts = {first_name(name).casefold() for name in held}
    if not held or "" in firsts or len(firsts) != 1:
        return ""
    return held[0][:200]


def greeting(facts_name: str) -> str:
    first = first_name(facts_name)
    return f"Hello {first}," if first else "Hello,"


def team(engagement: str) -> str:
    """Who signs: "SOX FY2027 audit team", or "FY 2026 Audit team" for an engagement
    whose name already says audit."""
    name = " ".join(engagement.split())[:200]
    if not name:
        return "audit team"
    return f"{name} team" if name.lower().endswith("audit") else f"{name} audit team"


def due_long(moment: datetime) -> str:
    due = moment.astimezone(UTC)
    return f"{due:%A} {due.day} {due:%B %Y}"


def due_short(moment: datetime) -> str:
    due = moment.astimezone(UTC)
    return f"{due.day} {due:%b %Y}"


def count_words(count: int) -> str:
    """ "2 items", "1 item", or "evidence" for a wording with no numbered items."""
    if count <= 0:
        return "evidence"
    return f"{count} item" if count == 1 else f"{count} items"


def subject(title: str, refs: str, count: int, due: datetime, reference: str) -> str:
    """ "<title> (<refs>): <N> items due <D Mon YYYY> [<reference>]", never over 200
    characters: the references are left out when they do not fit, then the title is
    shortened. The bracketed reference is what a reply is matched on
    (inbound.references)."""
    tail = f": {count_words(count)} due {due_short(due)} [{reference}]"
    clean, named = (
        # Nothing in the title reads as a reference of its own: a reply is matched on
        # the one in brackets.
        " ".join(_REFERENCE.sub("PBC ", part.replace("[", "(").replace("]", ")")).split())
        for part in (title, refs)
    )
    if not clean:
        clean, named = named or "Evidence request", ""
    if named == clean or len(named) > 200 - len(tail) - 3 - min(len(clean), 40):
        named = ""
    shown = f" ({named})" if named else ""
    room = max(200 - len(tail) - len(shown), 1)
    if len(clean) > room:
        clean = clean[:room].rsplit(" ", 1)[0].rstrip(" ,;:-") or clean[:room]
    return f"{clean}{shown}{tail}"


def control_line(title: str, frequency: str, system: str) -> str:
    """A short line describing the control, from its frequency, its system and its name
    as written: "Quarterly Active Directory User Access Review" for the "Periodic User
    Access Review" of Active Directory, performed quarterly. The name keeps its own
    capitals. Empty when nothing is known."""
    words = title.split()
    when = FREQUENCY_WORDS.get(frequency.strip().upper(), "")
    if when and words and words[0].lower() in _FREQUENCY_WORD:
        words = words[1:]
    named = " ".join(words)
    where = system.strip()
    if where and where.lower() in title.lower():
        where = ""
    return " ".join(part for part in (when, where, named) if part)[:200]


def facts_block(rows: list[tuple[str, str]]) -> str:
    """The facts as aligned lines ("Control:   ...")."""
    return "\n".join(f"{key + ':':<11}{value}" for key, value in rows if value)


def control_fact(control_ref: str, facts: Facts) -> str:
    ref = control_ref.strip()[:120]
    line = facts.control_line.strip()
    return f"{ref}, {line}" if ref and line else ref or line


def need_text(blocks: list[Item | Text | Questions], *, brief: bool, note: str = "") -> str:
    """WHAT WE NEED: every block in its order; in brief, an item is its title and what
    it covers, and the note says where the full wording is."""
    parts = [
        block.text(brief=brief) if isinstance(block, Item) else block.text() for block in blocks
    ]
    if brief and note:
        parts.append(note)
    return "\n\n".join(parts)


def tidy(body: str) -> str:
    """No run of blank lines where an optional part was empty."""
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def values_for_request(
    *,
    reference: str,
    control_ref: str,
    phase: str | None,
    due: datetime,
    description: str,
    engagement: str,
    facts: Facts,
    brief: bool,
    note: str,
) -> dict[str, Any]:
    """The template values of a single request's email (outbound.PBC_REQUEST_V3 and
    PBC_REMINDER_V3)."""
    wording = parse(description)
    if wording.items:
        opening, blocks = wording.opening, wording.blocks
    else:
        # Wording a person wrote freely: it is what we need, as written.
        opening = []
        blocks = [*(Text(p.split("\n")) for p in wording.opening), *wording.blocks]
    stage = PHASE_WORDS.get(str(phase or ""), "")
    rows = [
        ("Control", control_fact(control_ref, facts)),
        ("System", facts.system.strip()[:120]),
        ("Stage", stage),
        ("Due", due_long(due)),
        ("Reference", reference),
    ]
    title = facts.control_title.strip()[:160]
    count = len(wording.items)
    return {
        "subject_line": subject(title, control_ref.strip()[:120], count, due, reference),
        "greeting": greeting(facts.recipient_name),
        "opening": "".join(f"{p}\n\n" for p in opening),
        "facts": facts_block(rows),
        "items": need_text(blocks, brief=brief, note=note),
        "team": team(engagement),
        "reference": reference,
        "count": str(count),
    }
