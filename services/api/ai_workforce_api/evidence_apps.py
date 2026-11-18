"""Which of a control's applications an evidence file shows.

A control often covers several applications. Each file is tagged with the one it shows
(ONE), with all of them when it applies to every one (ALL, such as a policy), or as not
known (UNKNOWN) for a person to set. Claude suggests the application while it classifies
the file; these rules are the fallback, and a person can always change the tag.

Rules look for an application's full name, its acronyms (Microsoft Active Directory ->
AD, Oracle E-Business Suite -> EBS, Red Hat Enterprise Linux -> RHEL), and words only
that application has, in the file's name and folder first, then its text.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import psycopg

from ai_workforce_api.inbound import clean_line

Scope = Literal["ONE", "ALL", "UNKNOWN"]
# A person may also name several applications (SOME); the coordinator never does.
_GENERIC = frozenset(
    {
        "microsoft", "oracle", "enterprise", "suite", "system", "systems", "server",
        "cloud", "platform", "services", "service", "the", "and", "for", "prod",
        "production", "application", "applications", "management", "online",
    }
)  # fmt: skip
_SHORT = {"database": "db", "directory": "ad", "kubernetes": "k8s", "windows": "win"}
# Short words that are ordinary English, so they do not name an application in text.
_COMMON = frozenset({"red", "hat", "bs", "el", "ai", "od", "hel", "mad", "active", "net"})


def tag_covers(application_sql: str, alias: str = "t") -> str:
    """SQL: the file's application tag (evidence_file_applications as alias) covers the
    application: every one (ALL), that one (ONE), or one of several a person named (SOME,
    migration 0102)."""
    return (
        f"({alias}.scope = 'ALL'"
        f" OR ({alias}.scope = 'ONE' AND {alias}.engagement_application_id = {application_sql})"
        f" OR ({alias}.scope = 'SOME'"
        f" AND {application_sql} = ANY({alias}.engagement_application_ids)))"
    )


@dataclass(frozen=True)
class Application:
    id: UUID
    name: str


@dataclass(frozen=True)
class Tag:
    scope: Scope
    application: Application | None
    reason: str


def control_applications(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], project_id: UUID, control_id: UUID
) -> list[Application]:
    rows = connection.execute(
        """
        SELECT a.id, a.name FROM engagement_controls c
        JOIN engagement_applications a
          ON a.project_id = c.project_id AND a.id = ANY(c.application_ids)
        WHERE c.id = %s AND c.project_id = %s
        ORDER BY a.name
        """,
        (control_id, project_id),
    ).fetchall()
    return [Application(id=UUID(str(row[0])), name=str(row[1])) for row in rows]


def own_application(
    connection: psycopg.Connection[Any] | psycopg.Cursor[Any], project_id: UUID, control_id: UUID
) -> Application | None:
    """The application a control instance is for, if it is one application's instance."""
    row = connection.execute(
        """
        SELECT a.id, a.name FROM engagement_controls c
        JOIN engagement_applications a
          ON a.project_id = c.project_id AND a.id = c.engagement_application_id
        WHERE c.id = %s AND c.project_id = %s
        """,
        (control_id, project_id),
    ).fetchone()
    return None if row is None else Application(id=UUID(str(row[0])), name=str(row[1]))


def request_default(tag: Tag, own: Application | None) -> Tag:
    """A file the reader could not place takes the application of the request it came in
    on: the request belongs to one instance of the control, for one application (by the
    product owner's decision, 22 Oct 2026). A file the reader sees showing another
    application, or all of them, keeps that tag; a person can always change it."""
    if tag.scope != "UNKNOWN" or own is None:
        return tag
    return Tag("ONE", own, clean_line(f"Uploaded to the request for {own.name}.", 300))


def _words(name: str) -> list[str]:
    return [word for word in re.split(r"[^A-Za-z0-9]+", name) if word]


def signals(app: Application, others: list[Application]) -> set[str]:
    """What names this application in a file: its name, acronyms, and its own words."""
    main = re.sub(r"\(.*?\)", " ", app.name)
    inside = " ".join(re.findall(r"\((.*?)\)", app.name))
    words = _words(main)
    found = {app.name.lower(), " ".join(words).lower()}
    if len(words) >= 2:
        found.add("".join(word[0] for word in words).lower())
        found.add("".join(word[0] for word in words[-2:]).lower())
    # "E-Business Suite" -> EBS: the hyphenated parts count as words.
    parts = re.split(r"[\s]+", main.strip())
    hyphenated = [piece for part in parts for piece in part.split("-") if piece]
    if len(hyphenated) >= 2:
        found.add("".join(piece[0] for piece in hyphenated[1:]).lower())
    taken = {word.lower() for other in others if other.id != app.id for word in _words(other.name)}
    for word in [*words, *_words(inside)]:
        lowered = word.lower()
        if len(lowered) >= 2 and lowered not in _GENERIC and lowered not in taken:
            found.add(lowered)
            # The usual short form of a word, as file names use it (Oracle_DB_profiles).
            short = _SHORT.get(lowered)
            if short is not None and short not in taken:
                found.add(short)
    return {item for item in found if len(item) >= 2}


def _hits(signal_set: set[str], text: str) -> int:
    return sum(
        1
        for signal in signal_set
        if re.search(r"(?<![a-z0-9])" + re.escape(signal) + r"(?![a-z0-9])", text)
    )


def rules_tag(apps: list[Application], file_name: str, folder: str, text: str, kind: str) -> Tag:
    if len(apps) == 1:
        return Tag("ONE", apps[0], "The control covers one application.")
    if not apps:
        return Tag("UNKNOWN", None, "The control lists no applications.")
    where = f"{folder}/{file_name}".lower()
    body = text[:20_000].lower()
    scored = []
    for app in apps:
        own = signals(app, apps)
        # In running text, short signals ("ad", "red", "el") are too common to count.
        strong = {signal for signal in own if len(signal) >= 5 or " " in signal or (
            len(signal) >= 3 and signal not in _COMMON
        )}  # fmt: skip
        scored.append((_hits(own, where) * 3 + min(_hits(strong, body), 2), app))
    scored.sort(key=lambda entry: -entry[0])
    named_in_text = [app for score, app in scored if score > 0]
    top, second = scored[0], scored[1]
    if top[0] >= 3 and top[0] > second[0]:
        return Tag("ONE", top[1], clean_line(f"The file name names {top[1].name}.", 300))
    if kind == "policy" and len(named_in_text) >= 2:
        return Tag("ALL", None, "A policy that covers the control's applications.")
    if top[0] >= 2 and second[0] == 0:
        return Tag("ONE", top[1], clean_line(f"The file shows {top[1].name}.", 300))
    return Tag("UNKNOWN", None, "Which application the file shows is not clear.")


def model_tag(apps: list[Application], answer: str) -> Tag | None:
    """The application Claude named, if it is one of the control's. None to use rules."""
    value = answer.strip()
    if not value:
        return None
    if value.upper() == "ALL":
        return Tag("ALL", None, "Applies to every application of the control.")
    for app in apps:
        if app.name.lower() == value.lower():
            return Tag("ONE", app, clean_line(f"The file shows {app.name}.", 300))
    return None


def save_tag(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    file_id: UUID,
    tag: Tag,
) -> None:
    """Record the coordinator's tag. A person's tag is never overwritten."""
    cursor.execute(
        """
        INSERT INTO evidence_file_applications (
            evidence_file_id, organization_id, project_id, scope, engagement_application_id,
            tagged_by, reason
        )
        VALUES (%s, %s, %s, %s, %s, 'AGENT', %s)
        ON CONFLICT (evidence_file_id) DO UPDATE
        SET scope = EXCLUDED.scope,
            engagement_application_id = EXCLUDED.engagement_application_id,
            reason = EXCLUDED.reason, version = evidence_file_applications.version + 1
        WHERE evidence_file_applications.tagged_by = 'AGENT'
        """,
        (
            file_id,
            organization_id,
            project_id,
            tag.scope,
            None if tag.application is None else tag.application.id,
            tag.reason[:300],
        ),
    )
