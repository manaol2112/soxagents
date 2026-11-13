"""The evidence request email's wording, as the product owner approved its redesign
(12 November 2026): request template version 3, reminder version 3, and the grouped
request and its reminder version 2 (outbound.py, evidence_groups.py).

The approved text is still the system of record: what the approver reads is what the
plain-text part carries, word for word, and the send renders it again and refuses
anything else. This module only composes that text, deterministically, from the request
as it stands: a greeting by name when the recipient's name is on record, the agent's
opening, a few facts (control, system, stage, due date, reference), "WHAT WE NEED" with
every item, "HOW TO SEND IT", and the signature. The HTML part (email_html.py) lays the
same words out; it adds only a fixed frame.

The request's own wording is read back tolerantly (parse): an item's labels are renamed
in words an owner understands (Period becomes Covers, Include becomes Make sure it shows,
Completeness becomes Complete when), and a list inside an item stays inside it as
indented "- " lines, also for a draft saved before the drafter indented its inner lists
(an unindented list numbered from 1 that restarts inside an item belongs to that item).
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
HOW_TO_SEND = (
    "Enter the one-time code we email to this address, then upload each file against its "
    "item. Please do not send evidence as email attachments."
)
QUESTIONS = "Questions for you:"

_ITEM = re.compile(r"^(\d{1,2})\.\s+(\S.*)$")
_INNER = re.compile(r"^(?:\d{1,2}[.)]|[-•*])\s+(\S.*)$")
_LABELLED = re.compile(r"^(Period|Include|Format|Show|Completeness|If not available):\s*(.*)$")
_FREQUENCY_WORD = frozenset({"periodic", "annual", "quarterly", "monthly", "weekly", "daily"})
_EMAIL = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
# Words that make a contact's name a role, a team or a mailbox rather than a person's.
_ROLE_WORDS = frozenset(
    {
        "access", "accounting", "accounts", "admin", "administrator", "administrators",
        "analyst", "approver", "audit", "compliance", "contact", "control", "controller",
        "coordinator", "department", "desk", "engineering", "finance", "group", "helpdesk",
        "hr", "infrastructure", "it", "lead", "mailbox", "manager", "office", "operations",
        "ops", "owner", "owners", "payroll", "process", "reviewer", "security", "service",
        "services", "support", "system", "team", "the", "user", "users",
    }
)  # fmt: skip


@dataclass(frozen=True)
class Facts:
    """What the email names besides the request's own wording, read from its records:
    the control's name, a short line describing it, its system, and the recipient's name
    when a record holds it (never one made up from the address)."""

    control_title: str = ""
    control_line: str = ""
    system: str = ""
    recipient_name: str = ""


@dataclass
class Item:
    number: int
    title: str
    # The item's text and inner list, in order; an inner list entry is "- text".
    body: list[str] = field(default_factory=list)
    # Its labelled lines, under the email's labels.
    rows: list[tuple[str, str]] = field(default_factory=list)
    # The next number of an unindented inner list in progress, if any.
    inner_next: int | None = None

    def text(self, *, brief: bool = False) -> str:
        lines = [f"{self.number}. {self.title}"]
        if brief:
            lines.extend(f"   {key}: {value}" for key, value in self.rows if key == "Covers")
        else:
            lines.extend(f"   {line}" for line in self.body)
            lines.extend(f"   {key}: {value}" for key, value in self.rows)
        return "\n".join(lines)


@dataclass
class Wording:
    opening: list[str] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    questions: list[str] = field(default_factory=list)
    # Paragraphs after the items that belong to none of them (a closing line).
    after: list[str] = field(default_factory=list)


def _feed(item: Item, line: str) -> None:
    """One line of an item's detail: a labelled line, an inner list entry, or text."""
    text = line.strip()
    if not text:
        return
    labelled = _LABELLED.match(text)
    if labelled is not None:
        item.rows.append((LABELS[labelled.group(1)], labelled.group(2).strip()))
        item.inner_next = None
        return
    inner = _INNER.match(text)
    if inner is not None:
        item.body.append(f"- {inner.group(1)}")
        return
    item.body.append(text)


def _inner_entry(item: Item | None, number: int) -> bool:
    """Whether an unindented numbered line belongs to the open item's own list: it goes
    on with the list in progress, or restarts from 1 after the item's first detail
    line. Otherwise it is the next item."""
    if item is None:
        return False
    if item.inner_next is not None and number == item.inner_next:
        item.inner_next += 1
        return True
    if number == 1 and item.body:
        item.inner_next = 2
        return True
    return False


def parse(description: str) -> Wording:
    """The request's wording read into its opening, items, questions and closing. A
    wording with no numbered items comes back as its opening alone."""
    wording = Wording()
    current: Item | None = None
    in_questions = False
    paragraphs: list[list[str]] = []
    for block in description.replace("\r\n", "\n").strip().split("\n\n"):
        lines = [line.rstrip() for line in block.split("\n") if line.strip()]
        if lines:
            paragraphs.append(lines)
    for lines in paragraphs:
        first = lines[0].strip()
        if first == QUESTIONS.strip():
            in_questions = True
            wording.questions.extend(_bullets(lines[1:]))
            continue
        if in_questions and all(line.strip().startswith("- ") for line in lines):
            wording.questions.extend(_bullets(lines))
            continue
        in_questions = False
        rest = lines
        head = _ITEM.match(lines[0]) if not lines[0].startswith(" ") else None
        if head is not None:
            if current is not None and _inner_entry(current, int(head.group(1))):
                current.body.append(f"- {head.group(2).strip()}")
            else:
                current = Item(int(head.group(1)), head.group(2).strip())
                wording.items.append(current)
            rest = lines[1:]
        elif current is None:
            wording.opening.append("\n".join(line.strip() for line in lines))
            continue
        elif (
            head is None
            and not lines[0].startswith(" ")
            and len(lines) == 1
            and first.endswith("Thank you.")
        ):
            # A one-line closing after the items: not part of the last item. The
            # signature thanks the reader, so a bare "Thank you." is not repeated.
            if first != "Thank you.":
                wording.after.append(first)
            continue
        if current is None:
            continue
        for line in rest:
            numbered = _ITEM.match(line) if not line.startswith(" ") else None
            if numbered is not None and not _inner_entry(current, int(numbered.group(1))):
                current = Item(int(numbered.group(1)), numbered.group(2).strip())
                wording.items.append(current)
                continue
            if numbered is not None:
                current.body.append(f"- {numbered.group(2).strip()}")
                continue
            _feed(current, line)
    return wording


def _bullets(lines: list[str]) -> list[str]:
    return [line.strip()[2:].strip() for line in lines if line.strip().startswith("- ")]


# The parts the templates carry


def first_name(name: str) -> str:
    """The first word of a person's name a record holds. Empty for none, for an address,
    and for a name that is a role or a team ("Access administrator", "IT Service Desk"):
    "Hello," then, never "Hello Access,". A person's name is capitalized word by word."""
    clean = " ".join(name.split())
    if not clean or "@" in clean or _EMAIL.fullmatch(clean):
        return ""
    words = [w.strip(",;:.()") for w in clean.split(" ")]
    if any(w.lower() in _ROLE_WORDS for w in words):
        return ""
    particles = {"de", "da", "di", "du", "del", "der", "la", "le", "van", "von", "bin", "y"}
    if not all(w[:1].isupper() or w in particles for w in words if w and w[:1].isalpha()):
        return ""
    word = words[0]
    return word[:60] if word[:1].isalpha() else ""


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
    """ "<title> (<refs>): <N> items due <D Mon YYYY> [<reference>]", the title shortened
    to keep the subject within 200 characters. The bracketed reference is what a reply
    is matched on (inbound.references)."""
    tail = f": {count_words(count)} due {due_short(due)} [{reference}]"
    clean = " ".join(title.replace("[", "(").replace("]", ")").split())
    named = f" ({refs})" if refs and refs != clean else ""
    room = 200 - len(tail) - len(named)
    if not clean:
        return f"{refs or 'Evidence request'}{tail}"[:200]
    if len(clean) > room:
        clean = clean[: max(room, 1)].rsplit(" ", 1)[0].rstrip(" ,;:-") or clean[:room]
    return f"{clean}{named}{tail}"


def control_line(title: str, frequency: str, system: str) -> str:
    """A short line describing the control, from its name, frequency and system:
    "Quarterly Active Directory user access review" for the "Periodic User Access
    Review" of Active Directory, performed quarterly. Empty when nothing is known."""
    words = title.split()
    when = FREQUENCY_WORDS.get(frequency.strip().upper(), "")
    if when and words and words[0].lower() in _FREQUENCY_WORD:
        words = words[1:]
    words = [w.lower() if w[:1].isupper() and w[1:].islower() else w for w in words]
    named = " ".join(words)
    where = system.strip()
    if where and where.lower() in title.lower():
        where = ""
    line = " ".join(part for part in (when, where, named) if part)
    return (line[:1].upper() + line[1:])[:200] if line else ""


def facts_block(rows: list[tuple[str, str]]) -> str:
    """The facts as aligned lines ("Control:   ...")."""
    return "\n".join(f"{key + ':':<11}{value}" for key, value in rows if value)


def control_fact(control_ref: str, facts: Facts) -> str:
    ref = control_ref.strip()[:120]
    line = facts.control_line.strip()
    return f"{ref}, {line}" if ref and line else ref or line


def items_text(wording: Wording, *, brief: bool, note: str = "") -> str:
    """WHAT WE NEED: each item (in brief: its title and what it covers), the questions,
    and any closing line; for a wording with no items, the wording itself."""
    parts: list[str] = []
    if wording.items:
        parts.extend(item.text(brief=brief) for item in wording.items)
    if wording.questions:
        parts.append("\n".join([QUESTIONS, *(f"- {q}" for q in wording.questions)]))
    if wording.after:
        parts.extend(wording.after)
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
    reminder: bool,
) -> dict[str, Any]:
    """The template values of a single request's email (outbound.PBC_REQUEST_V3 and
    PBC_REMINDER_V3)."""
    wording = parse(description)
    if not wording.items:
        # Wording a person wrote freely: it is what we need, as written.
        need = Wording(opening=[], items=[], after=list(wording.opening))
        need.questions = wording.questions
        opening: list[str] = []
    else:
        need = wording
        opening = wording.opening
    stage = PHASE_WORDS.get(str(phase or ""), "")
    rows = [
        ("Control", control_fact(control_ref, facts)),
        ("System", facts.system.strip()[:120]),
        ("Stage", stage),
        ("Due", due_long(due)),
        ("Reference", reference),
    ]
    title = facts.control_title.strip()[:160]
    return {
        "subject_line": subject(title, control_ref.strip()[:120], len(need.items), due, reference),
        "greeting": greeting(facts.recipient_name),
        "opening": "" if reminder else "".join(f"{p}\n\n" for p in opening),
        "facts": facts_block(rows),
        "items": items_text(need, brief=brief, note=note),
        "team": team(engagement),
        "reference": reference,
        "count": str(len(need.items)),
    }
