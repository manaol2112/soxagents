"""A control's activity (the control record's Activity view), and its conclusion coming
only from a signed-off review. A person's tickmarks and their decisions on a file's
reliability read in plain words (docs/evidence-assurance.md, section 10.15, item 7)."""

from typing import Any
from uuid import uuid4

from psycopg.types.json import Jsonb
from support import Database
from test_attribute_dispositions import _ids
from test_attribute_dispositions import _record as _tickmark
from test_attribute_dispositions import _reopen as _reopen_tickmark
from test_control_progress import _controls
from test_engagement_data import _engagement, _requests
from test_evidence_assurance import _Bench
from test_evidence_review import _base
from test_file_reliability import _first_check as _first_check_with_a_report
from test_file_reliability import _record as _decide_reliability
from test_file_reliability import _reopen as _reopen_reliability
from test_outbound import migrated

from ai_workforce_api.db import connect

_ = migrated


def _activity(client: Any, team: dict[str, Any], control_id: str) -> Any:
    return client.get(f"{_base(team['org'], team['project'])}/controls/{control_id}/activity")


def test_a_control_shows_its_own_audit_trail_with_who_did_it(migrated: Database) -> None:
    team, client = _engagement(migrated, "activity")
    with connect(migrated.url) as connection:
        ids = _requests(connection, team["project"])
        control = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (ids[0],)
        ).fetchone()
        other = connection.execute(
            "SELECT engagement_control_id FROM pbc_requests WHERE id = %s", (ids[-1],)
        ).fetchone()
        assert control is not None and other is not None
        # An agent's work, as the console records it: the payload names the agent.
        connection.execute(
            """
            INSERT INTO audit_events (organization_id, project_id, action, target_type,
                                      target_id, payload)
            VALUES (%s, %s, 'evidence.analyzed', 'pbc_request', %s,
                    '{"agent": "evidence-coordinator", "kind": "POPULATION"}')
            """,
            (team["org"], team["project"], ids[0]),
        )
        connection.commit()
    response = _activity(client, team, str(control[0]))
    assert response.status_code == 200, response.text
    items = response.json()
    assert items, "the fixture's requests and plan leave a trail"
    # Newest first.
    assert [item["at"] for item in items] == sorted((item["at"] for item in items), reverse=True)
    read = next(item for item in items if item["action"] == "evidence.analyzed")
    assert (read["by"], read["actor"], read["category"], read["title"]) == (
        "agent", "Evidence coordinator", "evidence", "Evidence read"
    )  # fmt: skip
    # A person's own action is theirs.
    assert any(item["by"] == "person" for item in items)
    # Bookkeeping is left out, and so is another control's trail.
    assert not any(item["action"] in ("task.read", "model.called") for item in items)
    theirs = _activity(client, team, str(other[0])).json()
    assert read["id"] not in {item["id"] for item in theirs}
    # Statuses read as words.
    assert not any(item["detail"].isupper() for item in items if item["detail"])


def test_another_engagements_control_is_not_found(migrated: Database) -> None:
    team, _client = _engagement(migrated, "act-a")
    _other, other_client = _engagement(migrated, "act-b")
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s LIMIT 1",
            (team["project"],),
        ).fetchone()
    assert control is not None
    path = f"{_base(_other['org'], _other['project'])}/controls/{control[0]}/activity"
    assert other_client.get(path).status_code == 404


def test_only_a_signed_off_review_concludes_a_control(migrated: Database) -> None:
    team, client = _engagement(migrated, "concludes")
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT id FROM engagement_controls WHERE project_id = %s AND included "
            "ORDER BY control_ref LIMIT 1",
            (team["project"],),
        ).fetchone()
        assert control is not None
        # The review's task marked done by hand, with no review signed off.
        connection.execute(
            "UPDATE tasks SET status = 'SUCCEEDED' "
            "WHERE engagement_control_id = %s AND plan_kind = 'review'",
            (control[0],),
        )
        connection.commit()
    row = _controls(client, team)[str(control[0])]
    assert row["conclusion"] == "NOT_CONCLUDED"
    assert row["progress"] != "CONCLUDED"
    # Signed off by the independent reviewer: the review is signed, but nothing is tested.
    with connect(migrated.url) as connection:
        connection.execute(
            """
            INSERT INTO control_reviews (
                organization_id, project_id, engagement_control_id, opened_by, status,
                reperform_status, signed_by, signed_at
            )
            VALUES (%s, %s, %s, %s, 'SIGNED_OFF', 'IDLE', %s, clock_timestamp())
            """,
            (team["org"], team["project"], control[0], team["owner_id"], team["reviewer_id"]),
        )
        connection.commit()
    row = _controls(client, team)[str(control[0])]
    # Rewritten 19 November 2026 (ST-2, one screen one story, product owner decision 19 Nov
    # 2026). Old expectation: EFFECTIVE, the opinion following the signed review alone.
    # New: NOT_CONCLUDED, because nothing is tested or proposed, so no verdict holds and
    # the register never reads Effective unless the records and the signed verdict both
    # are.
    assert row["conclusion"] == "NOT_CONCLUDED"
    # The conclusion is final only once the testing behind it is complete (workflow
    # integrity W1). Here nothing was tested: the register says what is outstanding
    # instead of reading the control as concluded, and the signed review is not asked for
    # again.
    assert row["final"] is False and row["progress"] != "CONCLUDED"
    # Rewritten 9 November 2026: the shared setup records each control's D&I conclusion
    # (support.sign_off_design, B0), which prepares the design workpaper, so design is no
    # longer outstanding here. Before, the list also named "Design and implementation testing
    # outstanding". What testing is outstanding is still listed, and the control not final.
    assert [item["text"] for item in row["not_final"]] == [
        "Interim testing outstanding",
        "Roll-forward testing outstanding",
    ]
    assert row["next_step"] == "Interim testing outstanding"


def test_tickmarks_and_reliability_decisions_read_in_plain_words(migrated: Database) -> None:
    """docs/evidence-assurance.md, section 10.15, item 7. Before: the activity had no
    words for a tickmark or a decision on a file's reliability, so each read as its raw
    action ("Evidence: attribute disposition recorded") with the person's reason, or a
    code, as its detail. Now each has a plain title, and one line that says the kind in
    words and the attribute's letter or the file's name; who did it is the item's actor."""
    bench = _Bench(migrated, "act-tick")
    ticket, first = _first_check_with_a_report(bench, B="ABSENT", C="ABSENT")
    ids = _ids(first)
    owner_name = bench.name(bench.team["owner_id"])

    # A person's acts, through their routes: a tickmark recorded, changed and reopened; a
    # decision on the ticket's reliability recorded, changed and reopened.
    recorded = _tickmark(bench, ids["B"], "NOT_APPLICABLE")
    assert recorded.status_code == 200, recorded.text
    seen = next(a for a in recorded.json()["attributes"] if a["code"] == "B")["disposition"]["id"]
    changed = _tickmark(bench, ids["B"], "NOT_AVAILABLE", replaces=seen)
    assert changed.status_code == 200, changed.text
    seen = next(a for a in changed.json()["attributes"] if a["code"] == "B")["disposition"]["id"]
    assert _reopen_tickmark(bench, ids["B"], seen).status_code == 200
    assert _tickmark(bench, ids["C"], "EXCEPTION").status_code == 200
    decided = _decide_reliability(bench, ticket, "NOT_RELIED_ON")
    assert decided.status_code == 200, decided.text
    decision = decided.json()["file_reliability"][0]["decision"]["id"]
    again = _decide_reliability(bench, ticket, "ESTABLISHED_ON_REVIEW", replaces=decision)
    assert again.status_code == 200, again.text
    decision = again.json()["file_reliability"][0]["decision"]["id"]
    assert _reopen_reliability(bench, ticket, decision).status_code == 200

    # What ends one without the person asking, as the modules record it: a later check,
    # the annotation it rested on, the file leaving the request.
    def event(action: str, actor: Any, payload: dict[str, Any]) -> None:
        with connect(migrated.url) as connection:
            connection.execute(
                "INSERT INTO audit_events (organization_id, project_id, actor_user_id, action, "
                "target_type, target_id, payload) "
                "VALUES (%s, %s, %s, %s, 'evidence_requirement', %s, %s)",
                (
                    bench.team["org"], bench.team["project"], actor, action, bench.item_id,
                    Jsonb({"control_id": bench.control} | payload),
                ),
            )  # fmt: skip

    for attribute, kind, ended_as in (
        (ids["B"], "NOT_AVAILABLE", "SUPERSEDED_BY_CHECK"),
        (ids["D"], "NOT_APPLICABLE", "OVERTAKEN_BY_CHECK"),
        (ids["E"], "SHOWN_ON_REVIEW", "ANNOTATION_GONE"),
    ):
        event(
            "evidence.attribute_disposition_ended_by_check", None,
            {"attribute_id": attribute, "kind": kind, "ended_as": ended_as},
        )  # fmt: skip
    event(
        "evidence.attribute_disposition_annotation_gone", bench.team["owner_id"],
        {"attribute_id": ids["A"], "kind": "SHOWN_ON_REVIEW", "ended_as": "ANNOTATION_GONE",
         "reason": "The annotation it rests on was removed."},
    )  # fmt: skip
    # On an attribute that is no longer approved: said so, never by its id.
    event(
        "evidence.attribute_disposition_reopened",
        bench.team["owner_id"],
        {"attribute_id": str(uuid4()), "kind": "EXCEPTION", "reason": "Recorded in error."},
    )
    event(
        "evidence.file_reliability_ended_with_file", None,
        {"file_id": ticket, "kind": "ESTABLISHED_ON_REVIEW", "ended_as": "FILE_GONE",
         "changed_by": str(bench.team["owner_id"])},
    )  # fmt: skip
    event(
        "evidence.file_reliability_ended_with_file",
        None,
        {"file_id": ticket, "kind": "NOT_RELIED_ON", "ended_as": "FILE_GONE", "changed_by": None},
    )

    found = bench.owner.get(f"{bench.base}/controls/{bench.control}/activity")
    assert found.status_code == 200, found.text
    items = [item for item in found.json() if ".attribute_disposition" in item["action"]
             or ".file_reliability" in item["action"]]  # fmt: skip
    # Oldest first, each as (title, detail, by, actor).
    said = [(i["title"], i["detail"], i["by"], i["actor"]) for i in reversed(items)]
    assert said == [
        ("Tickmark recorded", "Attribute B: “Not applicable to this instance”",
         "person", owner_name),
        ("Tickmark recorded",
         "Attribute B: “Evidence not available, accepted”, in place of "
         "“Not applicable to this instance”", "person", owner_name),
        ("Tickmark reopened", "Attribute B: “Evidence not available, accepted”",
         "person", owner_name),
        ("Tickmark recorded", "Attribute C: “Exception”", "person", owner_name),
        ("File reliability decided", "ticket REQ-1041.txt: “Not relied on”",
         "person", owner_name),
        ("File reliability decided",
         "ticket REQ-1041.txt: “Reliability established on my review”, in place of "
         "“Not relied on”", "person", owner_name),
        ("File reliability decision reopened",
         "ticket REQ-1041.txt: “Reliability established on my review”", "person", owner_name),
        ("Tickmark ended by a later check",
         "Attribute B: “Evidence not available, accepted”. The later check found the "
         "attribute supported.", "workspace", "Workspace"),
        ("Tickmark ended by a later check",
         "Attribute D: “Not applicable to this instance”. The later check found the records "
         "contradict the attribute.", "workspace", "Workspace"),
        ("Tickmark ended by a later check",
         "Attribute E: “Shown, on my review”. The file its annotation is on is no longer in "
         "force on the request.", "workspace", "Workspace"),
        ("Tickmark ended with its annotation",
         "Attribute A: “Shown, on my review”. The annotation it rests on was removed.",
         "person", owner_name),
        ("Tickmark reopened", "An attribute no longer approved: “Exception”",
         "person", owner_name),
        ("File reliability decision ended",
         "ticket REQ-1041.txt: “Reliability established on my review”. The file is no longer "
         f"in force on the request. After a change by {owner_name}.", "workspace", "Workspace"),
        ("File reliability decision ended",
         "ticket REQ-1041.txt: “Not relied on”. The file is no longer in force on the request.",
         "workspace", "Workspace"),
    ]  # fmt: skip
    # All of them are evidence events, and none reads as its raw action or a code.
    assert {item["category"] for item in items} == {"evidence"}
    for item in items:
        words = f"{item['title']} {item['detail']}"
        assert "disposition" not in words.lower() and "_" not in words
        assert not any(code in words for code in ("NOT_", "SHOWN_ON", "EXCEPTION", "FILE_GONE"))
        assert not any(value in words for value in ids.values()) and ticket not in words
