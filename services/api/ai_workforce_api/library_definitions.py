"""Library version 3 in an engagement: attributes linked to their testing definitions,
proposals for what needs a person's answer, and adoption by controls copied from version 2.

- link_definitions: a library control copied as version 3 gets each attribute's definition
  key, and its LOW and NOT_ESTABLISHED attributes as proposals carrying their question.
  A control whose design must be confirmed gets an open question that holds its testing.
  Run at launch and when a control joins scope. Idempotent: a proposal a person rejected is
  never proposed again, and a settled question is not raised again.
- library_update / adopt: a control copied from version 2 shows, attribute by attribute,
  what version 3 keeps, rewords, adds, proposes, and retires (with the reason); a person
  adopts it. Open and signed-off test sheets keep the attributes they were created with.
- sheet_definitions: the definitions behind a test sheet's attributes, for the tester.
"""

from typing import Any, Literal
from uuid import UUID

import psycopg
from psycopg.types.json import Json
from pydantic import BaseModel

from ai_workforce_api.control_context import ContextState, Issue, raise_issues
from ai_workforce_api.control_design import refresh_statement
from ai_workforce_api.controls import BY_KEY, LIBRARY, SPLITS
from ai_workforce_api.db import transaction
from ai_workforce_api.definition_registry import attribute_for, definition_for
from ai_workforce_api.testing_definitions import (
    DEFINITIONS_VERSION,
    SOURCES,
    TESTED,
    AttributeDef,
)


class DefinitionBody(BaseModel):
    """How one attribute is tested, for people and the tester."""

    key: str
    confidence: str
    condition: str
    why: str
    evidence: list[str]
    extract: list[str]
    compare: str
    passes: str
    fails: str
    insufficient: str
    review: str
    not_infer: str
    basis: list[str]
    question: str
    blocks: bool


def definition_body(item: AttributeDef) -> DefinitionBody:
    return DefinitionBody(
        key=item.key,
        confidence=item.confidence,
        condition=item.condition,
        why=item.why,
        evidence=list(item.evidence),
        extract=list(item.extract),
        compare=item.compare,
        passes=item.passes,
        fails=item.fails,
        insufficient=item.insufficient,
        review=item.review,
        not_infer=item.not_infer,
        basis=[SOURCES[ref].ref for ref in item.basis],
        question=item.question,
        blocks=item.blocks,
    )


def _control(cursor: psycopg.Cursor[Any], control_id: UUID) -> tuple[Any, ...] | None:
    row = cursor.execute(
        "SELECT organization_id, project_id, library_key, library_version "
        "FROM engagement_controls WHERE id = %s FOR UPDATE",
        (control_id,),
    ).fetchone()
    return None if row is None else tuple(row)


# Settled because the control's design is the configuration, not because a person
# confirmed a library version. Shown on the resolved question.
_CONFIGURATION_DESIGN = (
    "Authentication settings are the control. They are tested as a configuration: "
    "each configured value against the security policy, and the change history for the "
    "period. An annual review of the settings, if the client also performs one, is a "
    "separate control."
)


def retire_dropped_design_questions(
    executor: psycopg.Cursor[Any] | psycopg.Connection[Any], control_ids: list[UUID]
) -> None:
    """Bring an open design question in line with the control as it is defined now.

    A question the definition no longer asks is resolved, with why. A question that is
    still asked is restated in the current words. Nothing is dropped without a record."""
    if not control_ids:
        return
    rows = executor.execute(
        "SELECT id, coalesce(library_key, '') FROM engagement_controls WHERE id = ANY(%s)",
        (control_ids,),
    ).fetchall()
    for control_id, key in rows:
        definition = definition_for(str(key))
        current = definition.design_confirmation if definition is not None else ""
        if current:
            executor.execute(
                """
                UPDATE control_context_issues
                SET detail = %s, version = version + 1, updated_at = clock_timestamp()
                WHERE engagement_control_id = %s AND status = 'OPEN'
                  AND topic = 'Control design to confirm' AND raised_by = 'RULES'
                  AND btrim(detail) IS DISTINCT FROM btrim(%s)
                """,
                (current, control_id, current),
            )
            continue
        note = (
            _CONFIGURATION_DESIGN
            if key == "access-authentication"
            else (
                "The control's design is the one stated on the control. This confirmation "
                "described an earlier wording and is settled."
            )
        )
        executor.execute(
            """
            UPDATE control_context_issues
            SET status = 'RESOLVED', resolution_note = %s, resolved_at = clock_timestamp(),
                version = version + 1, updated_at = clock_timestamp()
            WHERE engagement_control_id = %s AND status = 'OPEN'
              AND topic = 'Control design to confirm' AND raised_by = 'RULES'
            """,
            (note, control_id),
        )


def link_definitions(cursor: psycopg.Cursor[Any], control_id: UUID, actor: UUID | None) -> int:
    """Link a version 3 library control's attributes to their definitions and propose its
    low-confidence attributes. Returns how many proposals were added."""
    control = _control(cursor, control_id)
    if control is None:
        return 0
    retire_dropped_design_questions(cursor, [control_id])
    if int(control[3]) < DEFINITIONS_VERSION:
        return 0
    # The description follows the statement, with the client's values filled so far.
    refresh_statement(cursor, control_id)
    definition = definition_for(str(control[2]))
    if definition is None:
        return 0
    rows = cursor.execute(
        "SELECT id, text, definition_key FROM control_attributes WHERE engagement_control_id = %s",
        (control_id,),
    ).fetchall()
    known = {str(row[2]) for row in rows if row[2] is not None}
    for row_id, text, key in rows:
        if key is None:
            match = definition.matching(str(text))
            if match is not None:
                cursor.execute(
                    "UPDATE control_attributes SET definition_key = %s WHERE id = %s",
                    (match.key, row_id),
                )
                known.add(match.key)
    added = 0
    position = len(rows)
    for item in definition.proposed:
        if item.key in known:
            continue
        cursor.execute(
            """
            INSERT INTO control_attributes (
                organization_id, project_id, engagement_control_id, position, text, status,
                basis, source_kind, note, proposal, created_by, definition_key
            )
            VALUES (%s, %s, %s, %s, %s, 'PROPOSED', %s, 'LIBRARY', %s, 'ADD', %s, %s)
            """,
            (
                control[0], control[1], control_id, position, item.text,
                "DOCUMENTED" if "DESIGN" in item.basis else "INFERRED",
                f"Library v3, {item.confidence.lower().replace('_', ' ')} confidence: "
                f"{item.question}"[:500],
                actor, item.key,
            ),
        )  # fmt: skip
        position += 1
        added += 1
    _confirm_design(cursor, control, control_id, definition)
    return added


def _confirm_design(
    cursor: psycopg.Cursor[Any], control: tuple[Any, ...], control_id: UUID, definition: Any
) -> None:
    """A control whose description, frequency, or nature do not fit together waits for a
    person to confirm its design: an open question on the control holds its testing."""
    if not definition.design_confirmation:
        return
    raise_issues(
        cursor, control[0], control[1], control_id,
        [Issue(
            origin="ATTRIBUTES", kind="AMBIGUOUS", topic="Control design to confirm",
            detail=definition.design_confirmation,
            why="The library's definition rests on this design. If the client's control works "
            "differently, its attributes test the wrong thing.",
            resolve="Confirm the design with the control owner, adjust the attributes if "
            "needed, and resolve this with a note of what was confirmed.",
        )],
        "RULES",
    )  # fmt: skip


ChangeKind = Literal["KEEP", "REWORD", "ADD", "PROPOSE", "RETIRE"]


class UpdateItem(BaseModel):
    change: ChangeKind
    key: str
    text: str
    was: str
    reason: str
    confidence: str


class FieldChange(BaseModel):
    """A change version 3 makes to how the control itself is described."""

    field: Literal["title", "activity", "risk", "frequency", "nature"]
    was: str
    now: str


class SplitControl(BaseModel):
    """A control version 3 splits out of this one, added when it is adopted."""

    control_ref: str
    title: str
    reason: str


class UpdateBody(BaseModel):
    control_id: UUID
    library_version: int
    current_version: int
    available: bool
    items: list[UpdateItem]
    note: str
    # Milestone 8.9: the control statement's changes, and the controls split out of it.
    fields: list[FieldChange] = []
    splits: list[SplitControl] = []


def library_update(connection: psycopg.Connection[Any], control_id: UUID) -> UpdateBody:
    """What adopting version 3 would change on a control copied from an earlier version."""
    row = connection.execute(
        "SELECT library_key, library_version, title, activity, risk, frequency, nature "
        "FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    if row is None:
        raise ContextState("control not found")
    definition = definition_for(str(row[0]))
    version = int(row[1])
    if definition is None or version >= DEFINITIONS_VERSION:
        return UpdateBody(
            control_id=control_id, library_version=version,
            current_version=DEFINITIONS_VERSION, available=False, items=[],
            note="This control is not a library control on an earlier version.",
        )  # fmt: skip
    approved = {
        " ".join(str(text).lower().split()): str(text)
        for (text,) in connection.execute(
            "SELECT text FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED'",
            (control_id,),
        ).fetchall()
    }

    # Split parts the engagement already has for this control's system are not added again.
    present = {
        str(key)
        for (key,) in connection.execute(
            """
            SELECT x.library_key FROM engagement_controls x JOIN engagement_controls c
              ON c.project_id = x.project_id
             AND c.engagement_application_id IS NOT DISTINCT FROM x.engagement_application_id
            WHERE c.id = %s AND x.library_key IS NOT NULL
            """,
            (control_id,),
        ).fetchall()
    }

    def has(text: str) -> bool:
        return " ".join(text.lower().split()) in approved

    items: list[UpdateItem] = []
    for item in definition.attributes:
        tested = item.confidence in TESTED
        if has(item.text):
            change: ChangeKind = "KEEP"
        elif item.was and has(item.was):
            change = "REWORD" if tested else "PROPOSE"
        else:
            change = "ADD" if tested else "PROPOSE"
        reason = item.why if tested else f"Proposed, not tested: {item.question}"
        items.append(UpdateItem(change=change, key=item.key, text=item.text, was=item.was,
                                reason=reason, confidence=item.confidence))  # fmt: skip
    for retired in definition.retired:
        if has(retired.text) and not any(i.was == retired.text for i in items):
            items.append(UpdateItem(change="RETIRE", key="", text="", was=retired.text,
                                    reason=retired.reason, confidence=""))  # fmt: skip
    return UpdateBody(
        control_id=control_id,
        library_version=version,
        current_version=DEFINITIONS_VERSION,
        available=True,
        items=items,
        note="Attributes the team added stay as they are. Open and signed-off test sheets "
        "keep the attributes they were created with; new sheets use the adopted ones. The "
        "description follows the version 3 statement, with the client's values once filled.",
        fields=_field_changes(str(row[0]), row[2:]),
        splits=[
            SplitControl(
                control_ref=part.control_ref,
                title=part.title,
                reason=_split_reason(str(row[0]), part.control_ref, part.key),
            )
            for part in SPLITS.get(str(row[0]), ())
            if part.key not in present
        ],  # fmt: skip
    )


def _field_changes(library_key: str, current: tuple[Any, ...]) -> list[FieldChange]:
    """How the control's own description changes: title, activity, risk, frequency, and
    nature, from version 3's statement."""
    v3 = BY_KEY.get(library_key)
    if v3 is None:
        return []
    now = (v3.title, v3.activity, v3.risk, v3.frequency, v3.nature)
    names: tuple[Literal["title", "activity", "risk", "frequency", "nature"], ...] = (
        "title", "activity", "risk", "frequency", "nature",
    )  # fmt: skip
    return [
        FieldChange(field=name, was=str(was or ""), now=new)
        for name, was, new in zip(names, current, now, strict=True)
        if str(was or "") != new
    ]


def _split_reason(library_key: str, part_ref: str, part_key: str) -> str:
    """Why version 3 splits the part out: the retirement that names it, or its objective."""
    definition = definition_for(library_key)
    for retired in () if definition is None else definition.retired:
        if part_ref in retired.reason:
            return retired.reason
    split = definition_for(part_key)
    return "" if split is None else f"Split out as its own control: {split.objective}"


def _add_split(
    cursor: psycopg.Cursor[Any], parent_id: UUID, library_key: str, actor: UUID
) -> UUID | None:
    """Add a control split out of the parent, for the same system or process, in scope
    when the parent is. Nothing is added twice."""
    part = BY_KEY.get(library_key)
    if part is None:
        return None
    row = cursor.execute(
        """
        INSERT INTO engagement_controls (
            organization_id, project_id, library_key, library_version, control_ref, domain,
            title, risk, activity, frequency, nature, key_control, included, owner_name,
            owner_email, application_ids, test_attributes, pbc_items, template_key,
            agent_key, source, domain_label, engagement_application_id, process_id
        )
        SELECT p.organization_id, p.project_id, %s, %s, %s, %s, %s, %s, %s, %s, %s,
               p.key_control, p.included, p.owner_name, p.owner_email, p.application_ids,
               %s, %s, p.template_key, p.agent_key, p.source, p.domain_label,
               p.engagement_application_id, p.process_id
        FROM engagement_controls p
        WHERE p.id = %s AND NOT EXISTS (
            SELECT 1 FROM engagement_controls x
            WHERE x.project_id = p.project_id AND x.library_key = %s
              AND x.engagement_application_id IS NOT DISTINCT FROM p.engagement_application_id
        )
        RETURNING id
        """,
        (
            part.key, DEFINITIONS_VERSION, part.control_ref, part.domain, part.title,
            part.risk, part.activity, part.frequency, part.nature,
            Json(list(part.test_attributes)), Json(list(part.pbc_items)), parent_id,
            part.key,
        ),
    ).fetchone()  # fmt: skip
    if row is None:
        return None
    new_id = UUID(str(row[0]))
    link_definitions(cursor, new_id, actor)
    return new_id


def adopt(
    connection: psycopg.Connection[Any],
    organization_id: UUID,
    project_id: UUID,
    control_id: UUID,
    actor: UUID,
) -> UpdateBody:
    """Adopt version 3 on a control copied from an earlier version, as library_update shows."""
    from ai_workforce_api.control_attributes import _write_list

    update = library_update(connection, control_id)
    if not update.available:
        raise ContextState("no library update for this control")
    with transaction(connection) as cursor:
        control = _control(cursor, control_id)
        if control is None or int(control[3]) >= DEFINITIONS_VERSION:
            raise ContextState("the control changed")
        rows = cursor.execute(
            "SELECT id, text, position FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED' ORDER BY position",
            (control_id,),
        ).fetchall()
        by_text = {" ".join(str(r[1]).lower().split()): r for r in rows}
        # A proposal already open, or one a person rejected, is not proposed again.
        settled = {
            str(key)
            for (key,) in cursor.execute(
                "SELECT definition_key FROM control_attributes WHERE engagement_control_id = %s "
                "AND status IN ('PROPOSED', 'REJECTED') AND definition_key IS NOT NULL",
                (control_id,),
            ).fetchall()
        }

        def retire(text: str, note: str) -> int | None:
            found = by_text.pop(" ".join(text.lower().split()), None)
            if found is None:
                return None
            cursor.execute(
                "UPDATE control_attributes SET status = 'RETIRED', note = %s, decided_by = %s, "
                "decided_at = clock_timestamp(), version = version + 1, "
                "updated_at = clock_timestamp() WHERE id = %s",
                (note[:500], actor, found[0]),
            )
            return int(found[2])

        end = len(rows)
        for item in update.items:
            if item.change == "RETIRE":
                retire(item.was, f"Retired by library v3: {item.reason}")
                continue
            if item.change == "KEEP":
                kept = by_text.get(" ".join(item.text.lower().split()))
                if kept is not None:
                    cursor.execute(
                        "UPDATE control_attributes SET definition_key = %s WHERE id = %s",
                        (item.key, kept[0]),
                    )
                continue
            status = "APPROVED" if item.change in ("ADD", "REWORD") else "PROPOSED"
            position = retire(item.was, "Reworded by library v3.") if item.was else None
            if status == "PROPOSED" and item.key in settled:
                continue
            cursor.execute(
                """
                INSERT INTO control_attributes (
                    organization_id, project_id, engagement_control_id, position, text,
                    status, basis, source_kind, note, proposal, created_by, decided_by,
                    decided_at, definition_key
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'DOCUMENTED', 'LIBRARY', %s, %s, %s, %s,
                        CASE WHEN %s = 'APPROVED' THEN clock_timestamp() END, %s)
                """,
                (
                    organization_id, project_id, control_id,
                    position if position is not None else end, item.text, status,
                    item.reason[:500] if status == "PROPOSED" else "Library v3.",
                    "ADD" if status == "PROPOSED" else None, actor,
                    actor if status == "APPROVED" else None, status, item.key,
                ),
            )  # fmt: skip
            if position is None:
                end += 1
        remaining = cursor.execute(
            "SELECT count(*) FROM control_attributes WHERE engagement_control_id = %s "
            "AND status = 'APPROVED'",
            (control_id,),
        ).fetchone()
        if remaining is None or int(remaining[0]) == 0:
            raise ContextState("a control keeps at least one attribute")
        _write_list(cursor, control_id)
        v3 = BY_KEY.get(str(control[2]))
        cursor.execute(
            "UPDATE engagement_controls SET library_version = %s, version = version + 1, "
            "title = coalesce(%s, title), risk = coalesce(%s, risk), "
            "frequency = coalesce(%s, frequency), nature = coalesce(%s, nature), "
            "updated_at = clock_timestamp() WHERE id = %s",
            (
                DEFINITIONS_VERSION,
                None if v3 is None else v3.title, None if v3 is None else v3.risk,
                None if v3 is None else v3.frequency, None if v3 is None else v3.nature,
                control_id,
            ),
        )  # fmt: skip
        refresh_statement(cursor, control_id)
        added = [
            str(new_id)
            for part in update.splits
            for new_id in [_add_split(cursor, control_id, _key_for(part.control_ref), actor)]
            if new_id is not None
        ]
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id,
                payload
            )
            VALUES (%s, %s, %s, 'control.library_adopted', 'engagement_control', %s, %s)
            """,
            (
                organization_id, project_id, actor, control_id,
                Json({"version": DEFINITIONS_VERSION,
                      "changes": [i.change for i in update.items],
                      "fields": [f.field for f in update.fields], "added": added}),
            ),
        )  # fmt: skip
    return library_update(connection, control_id)


def _key_for(control_ref: str) -> str:
    return next((c.key for c in LIBRARY if c.control_ref == control_ref), "")


def sheet_definitions(
    connection: psycopg.Connection[Any], control_id: UUID, texts: list[str]
) -> list[AttributeDef | None]:
    """The definition behind each of a sheet's attributes, by key where the attribute
    record has one, otherwise by wording; None for a client's own attribute."""
    row = connection.execute(
        "SELECT library_key FROM engagement_controls WHERE id = %s", (control_id,)
    ).fetchone()
    if row is None:
        return [None for _ in texts]
    keys = {
        " ".join(str(text).lower().split()): str(key)
        for text, key in connection.execute(
            "SELECT text, definition_key FROM control_attributes "
            "WHERE engagement_control_id = %s AND definition_key IS NOT NULL",
            (control_id,),
        ).fetchall()
    }
    return [
        attribute_for(str(row[0]), keys.get(" ".join(text.lower().split()), ""), text)
        for text in texts
    ]


class ProcedureBody(BaseModel):
    key: str
    phase: str
    objective: str
    action: str
    evidence: list[str]
    attributes: list[str]
    limitation: str


class TestingBody(BaseModel):
    """How a library control is tested under version 3, for people to inspect."""

    version: int
    objective: str
    control_type: str
    population: str
    sampling: str
    procedures: list[ProcedureBody]
    design_confirmation: str
    assumptions: list[str]
    questions: list[str]
    not_applicable: list[str]


def testing_body(connection: psycopg.Connection[Any], control_id: UUID) -> TestingBody | None:
    """The version 3 procedures behind a library control on version 3; None for a client's
    own control, or one still on an earlier version (library_update shows what changes)."""
    row = connection.execute(
        "SELECT library_key, library_version FROM engagement_controls WHERE id = %s",
        (control_id,),
    ).fetchone()
    if row is None or row[0] is None or int(row[1] or 0) < DEFINITIONS_VERSION:
        return None
    definition = definition_for(str(row[0]))
    if definition is None:
        return None
    texts = {item.key: item.text for item in definition.attributes}
    return TestingBody(
        version=DEFINITIONS_VERSION,
        objective=definition.objective,
        control_type=definition.control_type,
        population=definition.population,
        sampling=definition.sampling,
        procedures=[
            ProcedureBody(
                key=p.key,
                phase=p.phase,
                objective=p.objective,
                action=p.action,
                evidence=list(p.evidence),
                attributes=[texts.get(k, k) for k in p.attributes],
                limitation=p.limitation,
            )  # fmt: skip
            for p in definition.procedures
        ],
        design_confirmation=definition.design_confirmation,
        assumptions=list(definition.assumptions),
        questions=list(definition.questions),
        not_applicable=list(definition.not_applicable),
    )
