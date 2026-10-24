"""Evidence statuses (Release 2b-3): each item Missing, Provided, Verified, or Accepted; a
request Ready for testing when a person accepted every item. The reader's verification
never becomes acceptance; client progress counts what was provided."""

from typing import Any
from uuid import UUID, uuid4

from psycopg.types.json import Json
from support import Database
from test_evidence_intake import _engagement
from test_evidence_plans import _control, _phase, _plan
from test_outbound import migrated
from test_testing_engine import _base, _read_all

from ai_workforce_api.db import connect
from ai_workforce_api.evidence_status import item_statuses, progress, status_of

__all__ = ["migrated"]


def test_a_persons_judgment_decides_and_the_reader_only_verifies() -> None:
    assert status_of("NOT_REVIEWED", False, "NONE") == "MISSING"
    assert status_of("NOT_REVIEWED", True, "NONE") == "PROVIDED"
    assert status_of("UNDER_REVIEW", True, "FOLLOW_UP") == "PROVIDED"
    # The reader proposes; it never accepts.
    assert status_of("NOT_REVIEWED", True, "SUFFICIENT") == "VERIFIED"
    assert status_of("UNDER_REVIEW", True, "SUFFICIENT") == "VERIFIED"
    # A person's judgment comes first.
    assert status_of("ACCEPTED", True, "NONE") == "ACCEPTED"
    assert status_of("INSUFFICIENT", True, "SUFFICIENT") == "MISSING"
    assert status_of("FOLLOW_UP_REQUIRED", True, "SUFFICIENT") == "MISSING"


def test_items_move_from_missing_to_accepted_and_the_request_becomes_ready(
    migrated: Database,
) -> None:
    team, client, scheduler = _engagement(migrated, "es-flow")
    control = _control(migrated, team, "ITGC-AC-01")
    base = f"{_base(team)}/controls/{control}"
    design = _phase(_plan(client, team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    items = [r for r in design["requirements"]
             if r["request_id"] == request_id and r["status"] != "WAIVED"]  # fmt: skip
    assert len(items) >= 2
    first, second, *rest = items

    def statuses() -> dict[str, tuple[str, str]]:
        with connect(migrated.url) as connection:
            found = item_statuses(connection, [UUID(request_id)])[UUID(request_id)]
        return {str(i.requirement_id): (i.status, i.note) for i in found}

    def counts() -> tuple[int, int, int]:
        with connect(migrated.url) as connection:
            p = progress(connection, team["project"])[UUID(request_id)]
        return p.total, p.provided, p.accepted

    def upload(item: dict[str, Any]) -> None:
        added = client.post(
            f"{_base(team)}/evidence-uploads",
            params={"batch_id": str(uuid4()), "name": f"{item['key']}.txt",
                    "request_id": request_id, "requirement_id": item["id"]},
            content=f"Evidence for {item['title']}.".encode(),
            headers={"content-type": "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text

    def judge(item: dict[str, Any], sufficiency: str, note: str = "") -> None:
        current = next(
            r for r in _phase(_plan(client, team, control), "DESIGN")["requirements"]
            if r["id"] == item["id"]
        )  # fmt: skip
        judged = client.post(
            f"{base}/evidence-requirements/{item['id']}/sufficiency",
            json={"sufficiency": sufficiency, "version": current["version"], "note": note},
        )
        assert judged.status_code == 200, judged.text

    assert set(statuses().values()) == {("MISSING", "")}
    assert counts() == (len(items), 0, 0)
    upload(first)
    upload(second)
    _read_all(migrated, scheduler)
    # The reader proposes that the second is covered (as a model's reading would).
    with connect(migrated.url) as connection:
        connection.execute(
            """
            UPDATE evidence_analyses a SET source = 'MODEL',
                   classification = jsonb_set(coalesce(a.classification, '{}'::jsonb),
                                              '{items}', %s::jsonb)
            FROM evidence_matches m
            WHERE m.evidence_file_id = a.evidence_file_id AND m.requirement_id = %s
            """,
            (Json([{"index": 0, "requirement_id": second["id"], "coverage": "COVERED",
                    "title": second["title"], "note": ""}]), second["id"]),
        )  # fmt: skip
    now = statuses()
    assert now[first["id"]] == ("PROVIDED", "")
    assert now[second["id"]] == ("VERIFIED", "")
    assert all(now[r["id"]] == ("MISSING", "") for r in rest)
    # Client progress counts what was provided; nothing is accepted by the reader.
    assert counts() == (len(items), 2, 0)

    # A person accepts one and asks for more on the other: still needed, with the note.
    # The first is accepted straight from Provided: the reader's verification is advisory,
    # never a step a person must wait for.
    judge(first, "ACCEPTED")
    judge(second, "FOLLOW_UP_REQUIRED", "Include the approval dates.")
    now = statuses()
    assert now[first["id"]] == ("ACCEPTED", "")
    assert now[second["id"]] == ("MISSING", "Include the approval dates.")
    assert counts() == (len(items), 1, 1)

    # Every item accepted: the request is ready for testing.
    for item in rest:
        upload(item)
    _read_all(migrated, scheduler)
    for item in [second, *rest]:
        judge(item, "ACCEPTED")
    assert set(statuses().values()) == {("ACCEPTED", "")}
    total, provided, accepted = counts()
    assert total == provided == accepted == len(items)
    listed = client.get(f"{_base(team)}/evidence-requests", params={"size": 200}).json()
    [row] = [r for r in listed["rows"] if r["id"] == request_id]
    assert (row["stage"], row["stage_label"]) == ("READY_FOR_TESTING", "Ready for testing")
    assert (row["items_total"], row["items_provided"], row["items_accepted"]) == (
        len(items), len(items), len(items),
    )  # fmt: skip
    assert listed["kpis"]["completed"] >= 1
    # The trail keeps every decision with its note, and the evidence stays: sending an item
    # back changed only its outstanding status.
    with connect(migrated.url) as connection:
        decisions = connection.execute(
            "SELECT payload ->> 'sufficiency', payload ->> 'note', actor_user_id "
            "FROM audit_events WHERE action = 'evidence_requirement.sufficiency' "
            "AND target_id = %s ORDER BY created_at",
            (second["id"],),
        ).fetchall()
        files = connection.execute(
            "SELECT count(*) FROM evidence_matches WHERE requirement_id = %s AND status = 'FILED'",
            (second["id"],),
        ).fetchone()
    assert [(d[0], d[1]) for d in decisions] == [
        ("FOLLOW_UP_REQUIRED", "Include the approval dates."), ("ACCEPTED", ""),
    ]  # fmt: skip
    assert {d[2] for d in decisions} == {team["owner_id"]}
    assert files is not None and files[0] == 1
