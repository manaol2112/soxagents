"""Starting Control Understanding from the same control on another system (product owner,
11 November 2026). The answers the same control holds on another of the engagement's
systems are shown as proposals when the review is read, for a person to confirm or change;
nothing is copied or stored until a person confirms, through the usual saves. This
control's own answers, last year's proposals and its own stored proposals win; a source's
answer is proposed only where it is a valid answer to this control's question."""

from typing import Any
from uuid import UUID, uuid4

from support import WALKTHROUGH_TEXT, Database
from test_onboarding import _base, _new_engagement
from test_outbound import migrated
from test_understanding_chat import _control_path, _on_systems

from ai_workforce_api.db import connect
from ai_workforce_api.walkthrough_answers import propose

__all__ = ["migrated"]

AC01 = "ITGC-AC-01"


def _systems(migrated: Database, slug: str, names: tuple[str, ...]) -> dict[str, Any]:
    """An engagement whose IT general controls run on each of `names`."""
    team = _new_engagement(migrated, slug)
    owner = team["owner"]
    base = _base(team["org"], team["project"])
    assert (
        owner.patch(
            f"{base}/scope", json={"scope": "ITGCs for FY2027", "period_end": "2027-12-31"}
        ).status_code
        == 200
    )
    for name in names:
        assert owner.post(f"{base}/applications", json={"name": name}).status_code == 200
    assert owner.post(f"{base}/controls/load-library").status_code == 200
    rows = owner.get(
        f"/organizations/{team['org']}/projects/{team['project']}/workspace/controls"
    ).json()
    team["ac01"] = {
        row["application_name"]: row["id"] for row in rows if row["control_ref"] == AC01
    }
    assert set(team["ac01"]) == set(names), team["ac01"]
    team["rows"] = rows
    return team


def _review(team: dict[str, Any], control: str, start: str | None = None) -> dict[str, Any]:
    params = {} if start is None else {"from": start}
    read = team["owner"].get(f"{_control_path(team, control)}/understanding/review", params=params)
    assert read.status_code == 200, read.text
    body: dict[str, Any] = read.json()
    return body


def _needs(review: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {need["key"]: need for need in review["needs"]}


def _answer_keys(review: dict[str, Any]) -> list[str]:
    return [need["key"] for need in review["needs"] if need["kind"] == "ANSWER"]


def _walk(
    review: dict[str, Any], kinds: tuple[str, ...] = ("CHOICE", "MULTI", "YES_NO")
) -> list[dict[str, Any]]:
    """The walkthrough's open root questions (no parent) of these kinds."""
    return [
        need
        for need in review["needs"]
        if need["kind"] == "WALKTHROUGH"
        and need["status"] == "MISSING"
        and need["when_key"] == ""
        and need["answer_kind"] in kinds
    ]


def _value(need: dict[str, Any], second: bool = False) -> str:
    """A valid answer to a walkthrough question; `second` gives a different valid one."""
    if need["answer_kind"] == "YES_NO":
        return "Yes" if second else "No"
    if need["answer_kind"] in ("CHOICE", "MULTI"):
        return str(need["options"][1 if second else 0])
    return "A second answer from the walkthrough." if second else WALKTHROUGH_TEXT


def _put_values(team: dict[str, Any], control: str, values: dict[str, str]) -> None:
    saved = team["owner"].put(f"{_control_path(team, control)}/values", json={"values": values})
    assert saved.status_code == 200, saved.text


def _put_walk(team: dict[str, Any], control: str, answers: dict[str, Any]) -> None:
    saved = team["owner"].put(
        f"{_control_path(team, control)}/walkthrough-answers",
        json={"answers": {key: {"value": value} for key, value in answers.items()}},
    )
    assert saved.status_code == 200, saved.text


def _held(migrated: Database, project: Any) -> tuple[int, int, int]:
    """What the engagement holds: statement answers, walkthrough answers, audit events."""
    with connect(migrated.url) as connection:
        row = connection.execute(
            """
            SELECT (SELECT count(*) FROM control_parameters WHERE project_id = %(p)s),
                   (SELECT count(*) FROM control_walkthrough_answers WHERE project_id = %(p)s),
                   (SELECT count(*) FROM audit_events WHERE project_id = %(p)s)
            """,
            {"p": project},
        ).fetchone()
    assert row is not None
    return int(row[0]), int(row[1]), int(row[2])


def test_answers_on_another_system_are_proposed_to_start_from(migrated: Database) -> None:
    team = _systems(migrated, "sf-basic", ("SAP ERP", "Oracle EBS"))
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    first = _review(team, sap)
    # Nothing answered anywhere: nothing to start from.
    assert first["start_from"] == {"chosen": None, "options": []}
    keys = _answer_keys(first)
    walk = _walk(first)
    assert len(keys) >= 2 and len(walk) >= 2
    _put_values(team, oracle, {keys[0]: "Line manager", keys[1]: "IT security"})
    _put_walk(team, oracle, {walk[0]["key"]: _value(walk[0]), walk[1]["key"]: _value(walk[1])})

    before = _held(migrated, team["project"])
    review = _review(team, sap)
    assert review["start_from"] == {
        "chosen": oracle,
        "options": [{"control_id": oracle, "system": "Oracle EBS", "answers": 4}],
    }
    needs = _needs(review)
    detail = "From ITGC-AC-01 on Oracle EBS"
    for key, value in (
        (keys[0], "Line manager"),
        (keys[1], "IT security"),
        (walk[0]["key"], _value(walk[0])),
        (walk[1]["key"], _value(walk[1])),
    ):
        need = needs[key]
        assert (need["value"], need["status"], need["source"], need["source_detail"]) == (
            value, "PROPOSED", "OTHER_SYSTEM", detail,
        ), key  # fmt: skip
    # The count is the proposals shown.
    assert sum(1 for n in review["needs"] if n["source"] == "OTHER_SYSTEM") == 4
    # A proposal is not an answer: the evidence still waits for it.
    assert review["evidence"]["ready"] is False
    assert walk[0]["question"] in review["evidence"]["missing"]
    # Asking for it by name reads the same.
    assert _review(team, sap, oracle)["needs"] == review["needs"]
    # SAP ERP holds no answers yet, so Oracle EBS has nothing to start from.
    assert _review(team, oracle)["start_from"] == {"chosen": None, "options": []}

    # "none": no source, so no proposal from another system.
    plain = _review(team, sap, "none")
    assert plain["start_from"]["chosen"] is None
    assert plain["start_from"]["options"] == review["start_from"]["options"]
    assert all(n["source"] != "OTHER_SYSTEM" for n in plain["needs"])
    assert _needs(plain)[walk[0]["key"]]["status"] == "MISSING"

    # Only a source offered: not this control, not another control, not a stranger, not
    # words; each is refused as invalid.
    other_control = next(
        row["id"]
        for row in team["rows"]
        if row["control_ref"] != AC01 and row["application_name"] == "Oracle EBS"
    )
    path = f"{_control_path(team, sap)}/understanding/review"
    for bad in (sap, other_control, str(uuid4()), "not-a-control", "NONE", ""):
        refused = team["owner"].get(path, params={"from": bad})
        assert refused.status_code == 422, (bad, refused.text)
    assert team["owner"].get(path, params={"from": "x" * 65}).status_code == 422

    # Reading writes nothing: no answer, no proposal, no audit event.
    assert _held(migrated, team["project"]) == before

    # Confirming uses the usual saves and is a person's answer.
    _put_values(team, sap, {keys[0]: needs[keys[0]]["value"]})
    _put_walk(team, sap, {walk[0]["key"]: needs[walk[0]["key"]]["value"]})
    after = _review(team, sap)
    confirmed = _needs(after)
    for key in (keys[0], walk[0]["key"]):
        assert (confirmed[key]["status"], confirmed[key]["source"]) == ("CONFIRMED", "PERSON")
        assert confirmed[key]["source_detail"] == ""
    assert after["start_from"]["options"] == [
        {"control_id": oracle, "system": "Oracle EBS", "answers": 2}
    ]
    with connect(migrated.url) as connection:
        filled = connection.execute(
            "SELECT filled_by FROM control_parameters WHERE engagement_control_id = %s "
            "AND slot_key = %s",
            (sap, keys[0]),
        ).fetchone()
        answered = connection.execute(
            "SELECT status, source, answered_by FROM control_walkthrough_answers "
            "WHERE engagement_control_id = %s AND question_key = %s",
            (sap, walk[0]["key"]),
        ).fetchone()
    assert filled is not None and str(filled[0]) == str(team["owner_id"])
    assert answered is not None
    assert (answered[0], answered[1], str(answered[2])) == (
        "CONFIRMED", "PERSON", str(team["owner_id"]),
    )  # fmt: skip


def test_own_answers_last_year_and_own_proposals_win(migrated: Database) -> None:
    team = _systems(migrated, "sf-wins", ("SAP ERP", "Oracle EBS"))
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    first = _review(team, sap)
    keys = _answer_keys(first)
    walk = _walk(first, ("CHOICE", "MULTI"))
    assert len(keys) >= 2 and len(walk) >= 2
    w_own, w_proposed = walk[0], walk[1]
    _put_values(team, oracle, {keys[0]: "Line manager", keys[1]: "IT security"})
    _put_walk(team, oracle, {w_own["key"]: _value(w_own), w_proposed["key"]: _value(w_proposed)})

    # SAP ERP answers one statement question itself and has last year's for the other; it
    # confirms one walkthrough question itself, and the planner proposed the other from notes.
    _put_values(team, sap, {keys[0]: "Service desk"})
    _put_walk(team, sap, {w_own["key"]: _value(w_own, second=True)})
    with connect(migrated.url) as connection:
        document = connection.execute(
            "INSERT INTO source_documents (organization_id, project_id, kind, title, text, "
            "origin) VALUES (%s, %s, 'POLICY', 'FY2026 access workpaper', 'Basis admins.', "
            "'WRITTEN') RETURNING id",
            (team["org"], team["project"]),
        ).fetchone()
        assert document is not None
        match = connection.execute(
            "INSERT INTO prior_year_matches (organization_id, project_id, document_id, "
            "engagement_control_id, basis, status) VALUES (%s, %s, %s, %s, 'REFERENCE', "
            "'CONFIRMED') RETURNING id",
            (team["org"], team["project"], document[0], sap),
        ).fetchone()
        assert match is not None
        proposal = connection.execute(
            "INSERT INTO prior_year_proposals (organization_id, project_id, match_id, "
            "engagement_control_id, kind, slot_key, value, title, quote) VALUES (%s, %s, %s, "
            "%s, 'ANSWER', %s, 'Basis administrators', 'Last year', 'Basis admins.') "
            "RETURNING id",
            (team["org"], team["project"], match[0], sap, keys[1]),
        ).fetchone()
        assert proposal is not None
        connection.commit()
        recorded = propose(
            connection, UUID(str(team["org"])), UUID(str(team["project"])), UUID(sap),
            team["owner_id"], [(w_proposed["key"], _value(w_proposed, second=True), "notes")],
            "RULES",
        )  # fmt: skip
        assert recorded == 1

    for start in (None, oracle):
        review = _review(team, sap, start)
        needs = _needs(review)
        assert (needs[keys[0]]["value"], needs[keys[0]]["source"]) == ("Service desk", "PERSON")
        assert needs[keys[0]]["status"] == "CONFIRMED"
        assert (needs[keys[1]]["value"], needs[keys[1]]["source"]) == (
            "Basis administrators", "PRIOR_YEAR",
        )  # fmt: skip
        assert needs[keys[1]]["proposal_id"] == str(proposal[0])
        assert (needs[w_own["key"]]["status"], needs[w_own["key"]]["value"]) == (
            "CONFIRMED", _value(w_own, second=True),
        )  # fmt: skip
        assert (needs[w_proposed["key"]]["source"], needs[w_proposed["key"]]["value"]) == (
            "AGENT", _value(w_proposed, second=True),
        )  # fmt: skip
        assert all(n["source"] != "OTHER_SYSTEM" for n in review["needs"])
        # Listed, as it holds answers, but it answers nothing open here: not chosen by
        # default.
        assert review["start_from"]["options"] == [
            {"control_id": oracle, "system": "Oracle EBS", "answers": 0}
        ]
        assert review["start_from"]["chosen"] == (None if start is None else oracle)


def test_sources_are_sorted_by_how_much_they_answer(migrated: Database) -> None:
    team = _systems(migrated, "sf-sort", ("SAP ERP", "Oracle EBS", "Active Directory"))
    sap = team["ac01"]["SAP ERP"]
    oracle, directory = team["ac01"]["Oracle EBS"], team["ac01"]["Active Directory"]
    keys = _answer_keys(_review(team, sap))
    assert len(keys) >= 2
    _put_values(team, oracle, {keys[0]: "Line manager"})
    _put_values(team, directory, {keys[0]: "Directory admins", keys[1]: "IT security"})
    review = _review(team, sap)
    assert review["start_from"] == {
        "chosen": directory,
        "options": [
            {"control_id": directory, "system": "Active Directory", "answers": 2},
            {"control_id": oracle, "system": "Oracle EBS", "answers": 1},
        ],
    }
    assert _needs(review)[keys[0]]["value"] == "Directory admins"
    assert _needs(review)[keys[0]]["source_detail"] == "From ITGC-AC-01 on Active Directory"
    # Another source chosen: its answers, and only where it has them.
    chosen = _needs(_review(team, sap, oracle))
    assert (chosen[keys[0]]["value"], chosen[keys[0]]["source"]) == (
        "Line manager", "OTHER_SYSTEM",
    )  # fmt: skip
    assert chosen[keys[1]]["source"] != "OTHER_SYSTEM"
    # A tie goes by system name.
    _put_values(team, oracle, {keys[1]: "IT security"})
    tied = _review(team, sap)["start_from"]["options"]
    assert [(o["system"], o["answers"]) for o in tied] == [
        ("Active Directory", 2), ("Oracle EBS", 2),
    ]  # fmt: skip
    # A control out of scope is no source.
    with connect(migrated.url) as connection:
        connection.execute(
            "UPDATE engagement_controls SET included = false WHERE id = %s", (directory,)
        )
        connection.commit()
    assert [o["system"] for o in _review(team, sap)["start_from"]["options"]] == ["Oracle EBS"]
    assert (
        team["owner"]
        .get(f"{_control_path(team, sap)}/understanding/review", params={"from": directory})
        .status_code
        == 422
    )


def test_only_answers_valid_for_this_control_are_proposed(migrated: Database) -> None:
    team = _systems(migrated, "sf-valid", ("SAP ERP", "Oracle EBS"))
    sap, oracle = team["ac01"]["SAP ERP"], team["ac01"]["Oracle EBS"]
    first = _review(team, sap)
    optional = next(
        (
            n
            for n in first["needs"]
            if n["kind"] == "WALKTHROUGH" and not n["required"] and n["when_key"] == ""
        ),
        None,
    )
    assert optional is not None
    choice = next(n for n in _walk(first, ("CHOICE", "MULTI")) if n["key"] != optional["key"])
    # Oracle EBS marks the optional question not applicable (an answer that stands, with no
    # value), and holds a confirmed answer no longer valid for its question (an option since
    # reworded, written directly as the bank would leave it).
    marked = team["owner"].put(
        f"{_control_path(team, oracle)}/walkthrough-answers",
        json={"answers": {optional["key"]: {"value": "", "not_applicable": True}}},
    )
    assert marked.status_code == 200, marked.text
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO control_walkthrough_answers (organization_id, project_id, "
            "engagement_control_id, question_key, value, status, source, answered_by, "
            "answered_at) VALUES (%s, %s, %s, %s, 'An option since reworded', 'CONFIRMED', "
            "'PERSON', %s, clock_timestamp())",
            (team["org"], team["project"], oracle, choice["key"], team["owner_id"]),
        )
        connection.commit()
    review = _review(team, sap)
    needs = _needs(review)
    for key in (optional["key"], choice["key"]):
        assert (needs[key]["status"], needs[key]["source"]) == ("MISSING", "NONE"), key
    assert review["start_from"] == {
        "chosen": None,
        "options": [{"control_id": oracle, "system": "Oracle EBS", "answers": 0}],
    }
    assert all(n["source"] != "OTHER_SYSTEM" for n in _review(team, sap, oracle)["needs"])


def test_a_governing_document_is_proposed_only_when_this_control_has_it(
    migrated: Database,
) -> None:
    team = _systems(migrated, "sf-doc", ("SAP ERP", "Oracle EBS"))
    on = _on_systems(migrated, team["project"])
    sap, oracle = on[("access-provisioning", "SAP ERP")], on[("access-provisioning", "Oracle EBS")]
    title = "Access Management Policy v3"
    with connect(migrated.url) as connection:
        connection.execute(
            "INSERT INTO control_parameters (organization_id, project_id, "
            "engagement_control_id, slot_key, value, filled_by, filled_at) "
            "VALUES (%s, %s, %s, 'access-policy', %s, %s, clock_timestamp())",
            (team["org"], team["project"], oracle, title, team["owner_id"]),
        )
        connection.commit()

    def policy() -> tuple[dict[str, Any], dict[str, Any]]:
        review = _review(team, sap)
        return _needs(review)["access-policy"], review["start_from"]

    need, start = policy()
    # No such document applies to SAP ERP's control: nothing proposed, nothing counted.
    assert (need["kind"], need["status"], need["source"]) == ("DOCUMENT", "MISSING", "NONE")
    assert start == {
        "chosen": None,
        "options": [{"control_id": oracle, "system": "Oracle EBS", "answers": 0}],
    }
    with connect(migrated.url) as connection:
        document = connection.execute(
            "INSERT INTO source_documents (organization_id, project_id, kind, title, text, "
            "origin) VALUES (%s, %s, 'POLICY', %s, 'Access is approved.', 'WRITTEN') "
            "RETURNING id",
            (team["org"], team["project"], title),
        ).fetchone()
        assert document is not None
        connection.execute(
            "INSERT INTO source_document_systems (document_id, project_id, "
            "engagement_application_id) SELECT %s, %s, engagement_application_id "
            "FROM engagement_controls WHERE id = %s",
            (document[0], team["project"], sap),
        )
        connection.commit()
    need, start = policy()
    assert (need["value"], need["status"], need["source"], need["source_detail"]) == (
        title, "PROPOSED", "OTHER_SYSTEM", "From ITGC-AC-01 on Oracle EBS",
    )  # fmt: skip
    assert start == {
        "chosen": oracle,
        "options": [{"control_id": oracle, "system": "Oracle EBS", "answers": 1}],
    }
