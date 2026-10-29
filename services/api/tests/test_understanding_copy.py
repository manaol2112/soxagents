"""Bringing forward another control's answers (decided by the product owner on 28 October
2026): a control whose process is the same as one already answered takes its answers by
choice, each read from the source itself, saved as answers are, and recorded with where it
came from."""

from support import Database
from test_control_statements import _context, _control_id
from test_evidence_intake import _engagement
from test_onboarding import _new_engagement
from test_outbound import migrated
from test_testing_engine import _base

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def test_a_control_takes_the_answers_of_another_by_choice(migrated: Database) -> None:
    team, client, _scheduler = _engagement(migrated, "copy-answers")
    provisioning = _control_id(migrated, team, "ITGC-AC-01")
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    answered = client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"admin-role": "Identity team"}},
    )
    assert answered.status_code == 200, answered.text

    listed = client.get(f"{_base(team)}/controls/{provisioning}/understanding/sources")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["target"]["control_ref"] == "ITGC-AC-01"
    assert "admin-role" not in body["target"]["values"]
    source = next(s for s in body["sources"] if s["control_id"] == leavers)
    assert source["control_ref"] == "ITGC-AC-02" and source["same_control"] is False
    answer = next(a for a in source["answers"] if a["key"] == "admin-role")
    assert answer["value"] == "Identity team" and answer["question"] and answer["kind"]
    assert "system" not in {a["key"] for a in source["answers"]}

    copied = client.post(
        f"{_base(team)}/controls/{provisioning}/understanding/copy",
        json={"source_control_id": leavers, "keys": ["admin-role"]},
    )
    assert copied.status_code == 200, copied.text
    slots = {s["key"]: s for s in _context(client, team, provisioning)["design"]["slots"]}
    assert slots["admin-role"]["value"] == "Identity team"
    assert slots["admin-role"]["filled_by"]
    with connect(migrated.url) as connection:
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'control.understanding_copied' "
            "ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
    assert audit is not None
    assert audit[0]["source_control_id"] == leavers and audit[0]["keys"] == ["admin-role"]


def test_a_copy_takes_only_what_the_source_answered_and_this_control_asks(
    migrated: Database,
) -> None:
    team, client, _scheduler = _engagement(migrated, "copy-refused")
    provisioning = _control_id(migrated, team, "ITGC-AC-01")
    leavers = _control_id(migrated, team, "ITGC-AC-02")
    copy = f"{_base(team)}/controls/{provisioning}/understanding/copy"
    # Nothing answered on the source yet.
    assert (
        client.post(copy, json={"source_control_id": leavers, "keys": ["admin-role"]}).status_code
        == 409
    )
    client.put(
        f"{_base(team)}/controls/{leavers}/values",
        json={"values": {"admin-role": "Identity team"}},
    )
    # A question this control does not ask, the system, or copying from itself.
    for keys, source in ((["no-such-slot"], leavers), (["system"], leavers),
                         (["admin-role"], provisioning)):  # fmt: skip
        refused = client.post(copy, json={"source_control_id": source, "keys": keys})
        assert refused.status_code == 409, (keys, refused.text)
    # Someone outside the engagement sees nothing.
    other = _new_engagement(migrated, "copy-outsider")
    outsider = other["owner"]
    assert (
        outsider.get(f"{_base(team)}/controls/{provisioning}/understanding/sources").status_code
        == 404
    )
    assert (
        outsider.post(copy, json={"source_control_id": leavers, "keys": ["admin-role"]}).status_code
        == 404
    )
