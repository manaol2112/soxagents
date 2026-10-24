"""Controls per application (Milestone 8.5).

A control that covers several systems is one engagement control per system: the same
control ID, one application each, so each is requested, tested, and concluded on its own.
The rows with one ID in an engagement are its *family*. This module names an instance
("ITGC-AC-01 · Oracle"), finds a family, keeps a family's instances in step with the
applications a person chooses, and tells the readers of a control's evidence which files
of its siblings it shares (a policy tagged as covering every application).
"""

import json
import re
from typing import Any
from uuid import UUID

import psycopg

from ai_workforce_api.controls import SYSTEM_DOMAINS

SEPARATOR = " · "
_NAMED = re.compile(r"^(?P<ref>.+?)\s*(?:·|\(|\bfor\b|/|-\s)\s*(?P<app>[^()]+?)\)?\s*$")


def control_label(control_ref: str, application: str | None) -> str:
    """How a control instance is named everywhere: its ID, then its application."""
    return f"{control_ref}{SEPARATOR}{application}" if application else control_ref


def parse_control_name(value: str) -> tuple[str, str | None]:
    """A control named by a person or the agent: "ITGC-AC-01", "ITGC-AC-01 · Oracle",
    "ITGC-AC-01 (Oracle)", or "ITGC-AC-01 for Oracle"."""
    text = value.strip()
    if SEPARATOR.strip() in text or "(" in text or " for " in text or " / " in text:
        found = _NAMED.match(text)
        if found is not None and found.group("app").strip():
            return found.group("ref").strip(), found.group("app").strip()
    return text, None


# Files a family shares: a file filed to a sibling is evidence for this instance too
# when it is tagged as covering every application, or as showing this one.
FAMILY_FILES = """
    SELECT l.evidence_file_id
    FROM evidence_file_links l
    JOIN engagement_controls c ON c.id = l.engagement_control_id
    JOIN engagement_controls me ON me.id = %s
    WHERE c.project_id = me.project_id
      AND (c.id = me.id
           OR (c.control_ref = me.control_ref
               AND EXISTS (SELECT 1 FROM evidence_file_applications t
                           WHERE t.evidence_file_id = l.evidence_file_id
                             AND (t.scope = 'ALL'
                                  OR (t.scope = 'ONE'
                                      AND t.engagement_application_id
                                          = me.engagement_application_id)
                                  OR (t.scope = 'SOME'
                                      AND me.engagement_application_id
                                          = ANY(t.engagement_application_ids))))))
"""


def family_ids(connection: Any, project_id: UUID, control_id: UUID) -> list[UUID]:
    """Every instance of the control, this one first."""
    rows = connection.execute(
        """
        SELECT c.id FROM engagement_controls c
        JOIN engagement_controls me ON me.id = %s AND me.project_id = c.project_id
        WHERE c.project_id = %s AND c.control_ref = me.control_ref
        ORDER BY (c.id = me.id) DESC, c.created_at
        """,
        (control_id, project_id),
    ).fetchall()
    return [UUID(str(row[0])) for row in rows]


def shared_with_family(connection: Any, file_id: UUID) -> bool:
    """Whether a sibling instance may test the file too (see FAMILY_FILES)."""
    row = connection.execute(
        "SELECT 1 FROM evidence_file_applications "
        "WHERE evidence_file_id = %s AND scope IN ('ALL', 'ONE', 'SOME')",
        (file_id,),
    ).fetchone()
    return row is not None


class InstanceState(Exception):
    def __init__(self, detail: str) -> None:
        self.detail = detail


def _current_library(cursor: psycopg.Cursor[Any], source_id: UUID) -> dict[str, Any] | None:
    """For a library copy on an earlier definition version than the library's, the library's
    current record: a new instance starts there, not where its sibling was copied. None
    for a client's control or one already current."""
    from ai_workforce_api.controls import BY_KEY
    from ai_workforce_api.definition_registry import definition_version

    row = cursor.execute(
        "SELECT source, library_key, library_version FROM engagement_controls WHERE id = %s",
        (source_id,),
    ).fetchone()
    if row is None or row[0] != "LIBRARY" or row[1] is None:
        return None
    current = definition_version(str(row[1]))
    control = BY_KEY.get(str(row[1]))
    if control is None or int(row[2] or 0) >= current:
        return None
    return {
        "library_version": current,
        "title": control.title,
        "risk": control.risk,
        "frequency": control.frequency,
        "nature": control.nature,
        "test_attributes": json.dumps(list(control.test_attributes)),
        "pbc_items": json.dumps(list(control.pbc_items)),
    }


def _clone(cursor: psycopg.Cursor[Any], source_id: UUID, application_id: UUID | None) -> UUID:
    """The family's instance for another system. A copy of a library control on an earlier
    version starts at the library's current version (its attributes, evidence items, title,
    and design), since a new instance has no testing to keep; the siblings keep theirs until
    a person adopts the update. A client's control is copied as it stands."""
    fresh = _current_library(cursor, source_id) or {}
    row = cursor.execute(
        """
        INSERT INTO engagement_controls (
            organization_id, project_id, library_key, library_version, control_ref, domain,
            title, risk, activity, frequency, nature, key_control, included, owner_name,
            owner_email, application_ids, test_attributes, pbc_items, template_key,
            agent_key, source, rcm_import_id, source_row,
            domain_label, frequency_label, nature_label, custom_fields,
            engagement_application_id
        )
        SELECT organization_id, project_id, library_key,
               coalesce(%(library_version)s, library_version), control_ref, domain,
               coalesce(%(title)s, title), coalesce(%(risk)s, risk), activity,
               coalesce(%(frequency)s, frequency), coalesce(%(nature)s, nature),
               key_control, included, owner_name, owner_email,
               CASE WHEN %(app)s::uuid IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[%(app)s::uuid] END,
               coalesce(%(test_attributes)s::jsonb, test_attributes),
               coalesce(%(pbc_items)s::jsonb, pbc_items), template_key,
               agent_key, source, rcm_import_id, source_row, domain_label, frequency_label,
               nature_label, custom_fields, %(app)s
        FROM engagement_controls WHERE id = %(source)s
        RETURNING id
        """,
        {
            "library_version": fresh.get("library_version"),
            "title": fresh.get("title"),
            "risk": fresh.get("risk"),
            "frequency": fresh.get("frequency"),
            "nature": fresh.get("nature"),
            "test_attributes": fresh.get("test_attributes"),
            "pbc_items": fresh.get("pbc_items"),
            "app": application_id,
            "source": source_id,
        },
    ).fetchone()
    assert row is not None
    copied = UUID(str(row[0]))
    if fresh:
        # Its attributes follow the definition: keys linked, low-confidence ones proposed.
        from ai_workforce_api.library_definitions import link_definitions

        link_definitions(cursor, copied, None)
    return copied


def _delete_instance(cursor: psycopg.Cursor[Any], control_id: UUID, label: str) -> None:
    try:
        with cursor.connection.transaction():
            cursor.execute("DELETE FROM engagement_controls WHERE id = %s", (control_id,))
    except psycopg.errors.IntegrityError:
        # A RESTRICT foreign key from requests, testing, or findings.
        raise InstanceState(
            f"{label} has requests, testing, or findings; it cannot be removed"
        ) from None


def clone_instance(
    cursor: psycopg.Cursor[Any], source_id: UUID, application_id: UUID | None
) -> UUID:
    """A copy of the control for another system: the family's instance there. Its
    statement names its own system (milestone 8.9)."""
    from ai_workforce_api.control_design import refresh_statement

    copied = _clone(cursor, source_id, application_id)
    refresh_statement(cursor, copied)
    return copied


def reconcile_family(
    cursor: psycopg.Cursor[Any],
    project_id: UUID,
    control_id: UUID,
    application_ids: list[UUID],
) -> list[UUID]:
    """Make the family's instances match the chosen applications. Returns the family.

    The rows for applications no longer chosen are removed when nothing depends on them;
    an application that is new to the family gets a copy of this row. With no
    applications chosen, one row remains, with none.
    """
    rows = cursor.execute(
        """
        SELECT c.id, c.engagement_application_id, c.control_ref, a.name
        FROM engagement_controls c
        JOIN engagement_controls me ON me.id = %s AND me.project_id = c.project_id
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s AND c.control_ref = me.control_ref
        ORDER BY (c.id = me.id) DESC, c.created_at
        FOR UPDATE OF c
        """,
        (control_id, project_id),
    ).fetchall()
    wanted = list(dict.fromkeys(application_ids))
    by_app = {row[1]: UUID(str(row[0])) for row in rows if row[1] is not None}
    unassigned = [UUID(str(row[0])) for row in rows if row[1] is None]
    ref = str(rows[0][2]) if rows else ""
    kept: list[UUID] = []
    if not wanted:
        # One row with no application: this one, freed of its application.
        keep = UUID(str(rows[0][0])) if rows else control_id
        for row in rows[1:]:
            _delete_instance(cursor, UUID(str(row[0])), control_label(ref, row[3]))
        cursor.execute(
            "UPDATE engagement_controls SET engagement_application_id = NULL, "
            "application_ids = ARRAY[]::uuid[], version = version + 1, "
            "updated_at = clock_timestamp() WHERE id = %s",
            (keep,),
        )
        return [keep]
    for app in wanted:
        if app in by_app:
            kept.append(by_app[app])
        elif unassigned:
            # A row without an application takes the first new one.
            taken = unassigned.pop(0)
            cursor.execute(
                "UPDATE engagement_controls SET engagement_application_id = %s, "
                "application_ids = ARRAY[%s]::uuid[], version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (app, app, taken),
            )
            kept.append(taken)
        else:
            kept.append(_clone(cursor, control_id, app))
    for row in rows:
        row_id = UUID(str(row[0]))
        if row_id not in kept:
            _delete_instance(cursor, row_id, control_label(ref, row[3]))
    return kept


def add_application_everywhere(
    cursor: psycopg.Cursor[Any], project_id: UUID, application_id: UUID
) -> int:
    """A new in-scope system joins every family of a library standard: a row without an
    application takes it, otherwise the family gets one more instance. The client's own
    controls from its RCM are each for their own system, as is a control adapted to one
    (adapted_controls): a new system is scoped from them in the system wizard, never
    given copies (decided by the product owner)."""
    from ai_workforce_api.controls import LIBRARY

    standards = [control.control_ref for control in LIBRARY]
    families = cursor.execute(
        """
        SELECT min(id::text)::uuid, control_ref,
               bool_or(engagement_application_id = %s),
               (array_agg(id ORDER BY created_at)
                FILTER (WHERE engagement_application_id IS NULL))[1]
        FROM engagement_controls
        -- A library standard, under its own reference. A business process control belongs
        -- to its process, not a system.
        WHERE project_id = %s AND source = 'LIBRARY' AND control_ref = ANY(%s)
          AND domain = ANY(%s)
        GROUP BY control_ref
        """,
        (application_id, project_id, standards, list(SYSTEM_DOMAINS)),
    ).fetchall()
    added = 0
    for first_id, _ref, has_it, unassigned in families:
        if has_it:
            continue
        if unassigned is not None:
            # A library control left without a system when its last system was removed
            # comes back into scope with the new one, as a freshly loaded control would. A
            # client's own control keeps the scope a person gave it.
            cursor.execute(
                "UPDATE engagement_controls SET engagement_application_id = %s, "
                "application_ids = ARRAY[%s]::uuid[], "
                "included = included OR source = 'LIBRARY', "
                "version = version + 1, updated_at = clock_timestamp() WHERE id = %s",
                (application_id, application_id, unassigned),
            )
        else:
            _clone(cursor, UUID(str(first_id)), application_id)
        added += 1
    return added


def remove_application_everywhere(
    cursor: psycopg.Cursor[Any], project_id: UUID, application_id: UUID
) -> None:
    """A system leaves scope: its instances go, or, when one is its family's only row,
    it loses its application and leaves scope with the system. Kept that way, a system
    added later takes it back (add_application_everywhere)."""
    rows = cursor.execute(
        """
        SELECT c.id, c.control_ref, a.name,
               (SELECT count(*) FROM engagement_controls o
                WHERE o.project_id = c.project_id AND o.control_ref = c.control_ref),
               c.source
        FROM engagement_controls c
        LEFT JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s AND c.engagement_application_id = %s
        """,
        (project_id, application_id),
    ).fetchall()
    for control_id, ref, name, siblings, source in rows:
        # A system's own control (its SOC report review) goes with it.
        if int(siblings) > 1 or source == "AGENT":
            _delete_instance(cursor, UUID(str(control_id)), control_label(str(ref), name))
        else:
            cursor.execute(
                "UPDATE engagement_controls SET engagement_application_id = NULL, "
                "application_ids = ARRAY[]::uuid[], included = false, version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (control_id,),
            )


def family_applications(connection: Any, project_id: UUID, control_id: UUID) -> list[Any]:
    """The applications of every instance of the control, so a file can be tagged as
    showing one of them or all of them."""
    from ai_workforce_api.evidence_apps import Application

    rows = connection.execute(
        """
        SELECT DISTINCT a.id, a.name
        FROM engagement_controls c
        JOIN engagement_controls me ON me.id = %s AND me.project_id = c.project_id
        JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s AND c.control_ref = me.control_ref
        ORDER BY a.name
        """,
        (control_id, project_id),
    ).fetchall()
    return [Application(id=UUID(str(row[0])), name=str(row[1])) for row in rows]
