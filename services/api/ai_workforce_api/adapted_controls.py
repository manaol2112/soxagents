"""The client's own controls adapted to a system they do not cover (decided by the product
owner). A system added to an engagement built from the client's RCM is scoped from the
library and from the client's controls on other systems. A control taken from another
system becomes this system's: a reference in the client's scheme for it (ITGC-SAP-02 for
Active Directory becomes ITGC-AD-02), and the wording of the standard it matches, or the
client's wording with the other system's name replaced. The client confirms it.

These are the pure parts: the system's code in the references, the reference a control
takes, and a client's wording restated for another system. system_scoping gathers the
candidates and adds the control.
"""

import re
from collections import Counter
from collections.abc import Iterable

_WORD = re.compile(r"[A-Za-z0-9]+")
_MINOR = {"and", "of", "the", "for", "a", "an", "to", "on"}
_NUMBER = re.compile(r"^(\d+)$")


def suggested_code(name: str) -> str:
    """The system's code in control references, suggested from its name: an acronym it
    starts with (SAP S/4HANA: SAP), the initials of several words (Active Directory: AD,
    Oracle E-Business Suite: OEBS), or the start of a single word (Workday: WOR). A person
    may set another."""
    # A qualifier in brackets (Salesforce (Sales Cloud / CPQ)) is not part of its name.
    plain = re.sub(r"\([^)]*\)", " ", name)
    words = [str(word) for word in _WORD.findall(plain) if str(word).lower() not in _MINOR]
    if not words:
        return "SYS"
    first = words[0]
    if len(first) >= 2 and first.isupper() and first.isalpha():
        return first[:8]
    if len(words) == 1:
        return re.sub(r"[^A-Z0-9]", "", first.upper())[:3] or "SYS"
    initials = "".join(word[0] for word in words if word[0].isalpha()).upper()
    return initials[:8] if len(initials) >= 2 else first.upper()[:3]


def system_token(refs: Iterable[str]) -> str | None:
    """The part of a system's control references that names the system: the one part
    shared by most of them that is neither their first part (ITGC, ITAC, IPE) nor a
    number. None when the references do not name a system."""
    counts: Counter[str] = Counter()
    total = 0
    for ref in refs:
        parts = ref.upper().split("-")
        if len(parts) < 3:
            continue
        total += 1
        for part in set(parts[1:-1]):
            if part and not part.isdigit():
                counts[part] += 1
    if not counts:
        return None
    token, seen = counts.most_common(1)[0]
    return token if seen * 2 > total else None


def adapted_ref(source_ref: str, token: str | None, code: str, taken: set[str]) -> str:
    """The reference a control from another system takes on this one: the other system's
    part replaced by this system's code (ITGC-SAP-02 to ITGC-AD-02), or the code added when
    the reference names no system. Taken references are skipped by numbering on."""
    parts = source_ref.split("-")
    upper = [part.upper() for part in parts]
    if token is not None and token in upper[1:-1]:
        parts[upper.index(token, 1)] = code
    else:
        parts.insert(len(parts) - 1 if len(parts) > 1 else len(parts), code)
    ref = "-".join(parts)
    used = {item.upper() for item in taken}
    if ref.upper() not in used:
        return ref
    number = _NUMBER.match(parts[-1])
    width = len(parts[-1]) if number else 2
    start = int(number.group(1)) + 1 if number else 1
    stem = parts[:-1] if number else parts
    for count in range(start, start + 500):
        candidate = "-".join([*stem, str(count).zfill(width)])
        if candidate.upper() not in used:
            return candidate
    return f"{ref}-{len(used)}"


def restated(text: str, names: Iterable[str], system: str) -> str:
    """A client's wording for another system, restated for this one: each of the other
    system's names (its name and its code in references) replaced by this system's name."""
    for name in sorted({item for item in names if item.strip()}, key=len, reverse=True):
        text = re.sub(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])", system, text)
    return text
