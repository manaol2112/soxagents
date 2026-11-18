"""Evidence statuses in plain words (Release 2b-3; docs/release-2b.md).

Each requested item is Missing, Provided, Verified, or Accepted; a request is Ready for
testing when every item on it is accepted. Derived from the records, never stored:

- Missing: nothing serves it yet, or a person found what came short (their note says what
  is still needed).
- Provided: a file serves it (on its request, linked by a person, or a policy another
  system's instance of the control shares).
- Verified: provided, and the evidence reader proposes it is covered. A proposal only:
  it never becomes acceptance.
- Accepted: a person accepted it as sufficient.

Client progress counts the items provided (Provided, Verified, or Accepted).
"""

from collections import defaultdict
from typing import Any, Literal
from uuid import UUID

import psycopg
from pydantic import BaseModel

ItemState = Literal["MISSING", "PROVIDED", "VERIFIED", "ACCEPTED"]
LABELS: dict[str, str] = {
    "MISSING": "Missing",
    "PROVIDED": "Provided",
    "VERIFIED": "Verified",
    "ACCEPTED": "Accepted",
}
_SHORT = ("INSUFFICIENT", "FOLLOW_UP_REQUIRED")


class ItemStatus(BaseModel):
    requirement_id: UUID
    title: str
    status: ItemState
    label: str
    # What is still needed, when a person found what came short.
    note: str = ""


class Progress(BaseModel):
    total: int = 0
    provided: int = 0
    accepted: int = 0

    @property
    def ready_for_testing(self) -> bool:
        return self.total > 0 and self.accepted == self.total


def status_of(sufficiency: str, arrived: bool, proposal: str) -> ItemState:
    """An item's status from a person's judgment, whether anything serves it, and the
    reader's proposal. A person's judgment comes first; the reader never accepts."""
    if sufficiency == "ACCEPTED":
        return "ACCEPTED"
    if not arrived or sufficiency in _SHORT:
        return "MISSING"
    return "VERIFIED" if proposal == "SUFFICIENT" else "PROVIDED"


def progress(connection: psycopg.Connection[Any], project_id: UUID) -> dict[UUID, Progress]:
    """Each request's items: how many, how many provided, how many accepted. Waived and
    removed items do not count."""
    from ai_workforce_api.evidence_plans import request_file_serves, shared_from_sibling

    found: dict[UUID, Progress] = defaultdict(Progress)
    for request_id, sufficiency, arrived in connection.execute(
        """
        SELECT q.pbc_request_id, q.sufficiency,
               EXISTS (SELECT 1 FROM evidence_file_links l
                       LEFT JOIN evidence_analyses a ON a.evidence_file_id = l.evidence_file_id
                       WHERE l.pbc_request_id = q.pbc_request_id AND {SERVES})
               OR EXISTS ({SHARED})
               OR EXISTS (SELECT 1 FROM evidence_requirement_files ef
                          JOIN evidence_file_links l
                            ON l.evidence_file_id = ef.evidence_file_id
                           AND l.engagement_control_id = ef.engagement_control_id
                          WHERE ef.requirement_id = q.id AND ef.status = 'LINKED')
        FROM evidence_requirements q
        WHERE q.project_id = %s AND q.pbc_request_id IS NOT NULL
          AND q.status NOT IN ('WAIVED', 'REMOVED')
        """.replace("{SERVES}", request_file_serves("l.evidence_file_id")).replace(
            "{SHARED}", shared_from_sibling("1")
        ),
        (project_id,),
    ).fetchall():
        item = found[UUID(str(request_id))]
        item.total += 1
        state = status_of(str(sufficiency), arrived is True, "")
        if state != "MISSING":
            item.provided += 1
        if state == "ACCEPTED":
            item.accepted += 1
    return dict(found)


def item_statuses(
    connection: psycopg.Connection[Any], request_ids: list[UUID]
) -> dict[UUID, list[ItemStatus]]:
    """Each request's items with their status, in the plan's order, from the same records
    the control's evidence plan shows (evidence_plans._requirements)."""
    from ai_workforce_api.evidence_plans import _requirements

    plans = [
        UUID(str(row[0]))
        for row in connection.execute(
            "SELECT DISTINCT plan_id FROM evidence_requirements "
            "WHERE pbc_request_id = ANY(%s) AND plan_id IS NOT NULL",
            (request_ids,),
        ).fetchall()
    ]
    wanted = set(request_ids)
    found: dict[UUID, list[ItemStatus]] = defaultdict(list)
    for plan_id in plans:
        for requirement in _requirements(connection, plan_id):
            if requirement.request_id not in wanted or requirement.status in (
                "WAIVED",
                "REMOVED",
            ):
                continue
            state = status_of(
                requirement.sufficiency,
                bool(requirement.files),
                requirement.assessment.proposal,
            )
            found[requirement.request_id].append(
                ItemStatus(
                    requirement_id=requirement.id,
                    title=requirement.title,
                    status=state,
                    label=LABELS[state],
                    note=requirement.sufficiency_note if requirement.sufficiency in _SHORT else "",
                )
            )
    return dict(found)
