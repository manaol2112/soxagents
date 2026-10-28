"""A system's candidate controls, the review job, and adding controls to a system.

Milestone 8.10 replaced the review that guessed hosting, SOC coverage, and CUECs from what
such reports usually say; its tests went with it. The assessment, the wizard, and SOC 1
reports are tested in test_system_applicability.py. What stays here is shared by both:
which controls a system can take, the job that runs a review, and adding a control.
"""

from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from support import Database
from test_onboarding import _base, _new_engagement
from test_outbound import migrated
from test_rcm_uploads import CLIENT_RCM, _upload

import ai_workforce_api.system_scoping as system_scoping
from ai_workforce_api.controls import LIBRARY
from ai_workforce_api.db import connect
from ai_workforce_api.system_scoping import run_review

__all__ = ["migrated"]

ITGC = ["ACCESS", "CHANGE", "OPERATIONS"]


def _engagement(database: Database) -> tuple[TestClient, str]:
    team = _new_engagement(database, "scoping")
    return team["owner"], _base(team["org"], team["project"])


def _system(snapshot: dict[str, Any], name: str) -> dict[str, Any]:
    found: dict[str, Any] = next(a for a in snapshot["applications"] if a["name"] == name)
    return found


def test_a_review_asked_for_mid_run_runs_again_with_what_changed(
    migrated: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The library loading while a system is being assessed is not missed."""
    owner, base = _engagement(migrated)
    body = owner.post(f"{base}/applications/known", json={"names": ["Workday"]}).json()
    workday = _system(body, "Workday")
    assert owner.post(f"{base}/systems/{workday['id']}/review").status_code == 200
    real_gather = system_scoping.gather
    calls: list[int] = []
    loads: list[bool] = []

    def gather_then_load(connection: Any, application_id: UUID) -> Any:
        facts = real_gather(connection, application_id)
        if loads and not loads[-1]:
            # A request made while the library loads renders the engagement, which reads
            # the system through this same function: it must not load again (M3d closure:
            # without this guard each nested request loaded and asked again, recursing
            # until PostgreSQL refused a connection, which hung or starved the full suite).
            return facts
        if not calls:
            loads.append(False)
            owner.post(f"{base}/controls/load-library", json={"domains": ITGC})
            # The team asks again while the first run is under way.
            owner.post(f"{base}/systems/{workday['id']}/review")
            loads[-1] = True
        calls.append(len(facts.controls) if facts is not None else -1)
        return facts

    monkeypatch.setattr(system_scoping, "gather", gather_then_load)
    with connect(migrated.url) as connection:
        assert run_review(connection, None, UUID(workday["id"])) == "DONE"
    assert calls[0] == 0 and calls[-1] > 0
    assert loads == [True], "the library is loaded once, by the first run"
    workday = _system(owner.get(base).json(), "Workday")
    assert workday["assessment"]["status"] == "IDLE"
    assert any(c["in_scope"] for c in workday["assessment"]["candidates"])


def test_a_key_report_is_added_for_another_system(migrated: Database) -> None:
    owner, base = _engagement(migrated)
    owner.post(f"{base}/applications/known", json={"names": ["Workday", "SAP ECC"]})
    owner.post(f"{base}/controls/load-library", json={"domains": ["IPE"]})
    body = owner.get(base).json()
    report = {c["application_name"]: c for c in body["controls"] if c["control_ref"] == "IPE-01"}
    sap = _system(body, "SAP ECC")
    # As if the RCM had named the report for Workday only.
    with connect(migrated.url) as connection:
        connection.execute(
            "DELETE FROM engagement_controls WHERE id = %s", (report["SAP ECC"]["id"],)
        )
        connection.commit()
    # No question about how the system is run comes first.
    added = owner.post(
        f"{base}/systems/{sap['id']}/controls/add", json={"control_id": report["Workday"]["id"]}
    )
    assert added.status_code == 200, added.text
    rows = [c for c in added.json()["controls"] if c["control_ref"] == "IPE-01"]
    assert sorted((c["application_name"], c["included"]) for c in rows) == [
        ("SAP ECC", True),
        ("Workday", True),
    ]
    # A business process control has no system to be added for.
    owner.post(f"{base}/controls/load-library", json={"domains": ["ENTITY"]})
    entity = next(c for c in owner.get(base).json()["controls"] if c["domain"] == "ENTITY")
    refused = owner.post(
        f"{base}/systems/{sap['id']}/controls/add", json={"control_id": entity["id"]}
    )
    assert refused.status_code == 409


def test_an_uploaded_rcm_is_scoped_with_the_clients_own_controls(migrated: Database) -> None:
    owner, base = _engagement(migrated)
    uploaded = _upload(owner, base, CLIENT_RCM)
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    workday = _system(imported.json(), "Workday")
    candidates = {c["control_ref"]: c for c in workday["assessment"]["candidates"]}
    # The client's own IT controls are offered, and the library beside them (decided by
    # the product owner).
    assert {c["origin"] for c in candidates.values()} >= {"RCM", "LIBRARY"}
    assert set(candidates) & {c.control_ref for c in LIBRARY}
    # "Managers approve new access." is on SAP ERP only; it can be chosen for Workday too.
    # This client's references name no system (AC 1.02 is on both): it is one family, offered
    # under its own reference and wording.
    assert "AC 1.01" in candidates and candidates["AC 1.01"]["in_scope"] is False
    assert candidates["AC 1.01"]["origin"] == "RCM"
    assert candidates["AC 1.01"]["adapted_from"] == []
    assert imported.json()["process_offers"] == []
    saved = owner.put(
        f"{base}/systems/{workday['id']}/applicability",
        json={"selections": [{"control_ref": "AC 1.01", "selected": True}]},
    )
    assert saved.status_code == 200, saved.text
    # Workday gets its own copy of the client's control.
    rows = [c for c in saved.json()["controls"] if c["control_ref"] == "AC 1.01"]
    assert sorted((c["application_name"], c["included"]) for c in rows) == [
        ("SAP ERP", True),
        ("Workday", True),
    ]


SYSTEM_RCM = (
    "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner,"
    "Owner E-mail,Systems,Region,Assertion\n"
    "ITGC-SAP-01,New SAP access is requested in ServiceNow and approved by the user's manager "
    "before it is granted.,As needed,Manual,User Access,Dana Ruiz,,SAP ERP,EMEA,Existence\n"
    "ITGC-SAP-02,SAP access is removed timely upon termination: IT Security locks the SAP user "
    "within 1 business day of the HR termination date.,As needed,Manual,User Access,"
    "Dana Ruiz,,SAP ERP,EMEA,Existence\n"
    "ITGC-WD-01,New Workday access is requested and approved by the manager before it is "
    "granted.,As needed,Manual,User Access,Dana Ruiz,,Workday,EMEA,Existence\n"
    "ITGC-WD-02,Workday access is removed timely upon termination of employment.,As needed,"
    "Manual,User Access,Dana Ruiz,,Workday,EMEA,Existence\n"
)


def test_a_system_added_by_hand_is_scoped_from_the_library_and_the_clients_controls(
    migrated: Database,
) -> None:
    """Decided by the product owner: a system the client's RCM does not cover starts with
    nothing in scope; the wizard offers the library and the client's controls on other
    systems, adapted to it under a reference for it and the standard's wording."""
    owner, base = _engagement(migrated)
    uploaded = _upload(owner, base, SYSTEM_RCM)
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    added = owner.post(f"{base}/applications", json={"name": "Active Directory"})
    assert added.status_code == 200, added.text
    directory = _system(added.json(), "Active Directory")
    # No copies of the other systems' controls.
    assert directory["controls_in_scope"] == 0
    assert not [c for c in added.json()["controls"]
                if c["application_name"] == "Active Directory"]  # fmt: skip
    # The row's "Add controls from the library" offers the library, not other systems'
    # controls as they are.
    offers = directory["other_controls"]
    assert offers and all(item["library_key"] for item in offers)
    assessment = directory["assessment"]
    assert assessment["ref_code"] == "AD"
    candidates = {c["control_ref"]: c for c in assessment["candidates"]}
    adapted = [c for c in candidates.values() if c["adapted_from"]]
    assert adapted and all(c["control_ref"].startswith("ITGC-AD-") for c in adapted)
    assert all(c["domain"] in ITGC for c in adapted)
    # The same standard on SAP and Workday is offered once, from both.
    joined = next(c for c in adapted if len(c["adapted_from"]) > 1)
    assert joined["follows"] and joined["library_key"]
    assert "SAP" not in joined["description"]
    # The library is offered beside it, without the standard the adapted control follows.
    assert any(c["origin"] == "LIBRARY" for c in candidates.values())
    assert joined["follows"] not in candidates
    # A person picks it: Active Directory gets its own control, flagged for the client.
    saved = owner.put(
        f"{base}/systems/{directory['id']}/applicability",
        json={"selections": [{"control_ref": joined["control_ref"], "selected": True}]},
    )
    assert saved.status_code == 200, saved.text
    mine = [c for c in saved.json()["controls"] if c["application_name"] == "Active Directory"]
    assert [(c["control_ref"], c["included"]) for c in mine] == [(joined["control_ref"], True)]
    with connect(migrated.url) as connection:
        row = connection.execute(
            "SELECT c.adapted_from, c.library_key, c.activity, i.topic, i.status "
            "FROM engagement_controls c JOIN control_context_issues i "
            "ON i.engagement_control_id = c.id WHERE c.id = %s",
            (mine[0]["id"],),
        ).fetchone()
    assert row is not None
    assert row[0] == joined["adapted_from"] and row[1] == joined["library_key"]
    assert "Active Directory" in row[2]
    assert row[3] == "Confirm the control for this system" and row[4] == "OPEN"
    # The row's library offers leave out the standard Active Directory has in scope; adding
    # it again from the library is refused with why, not ignored.
    row = _system(saved.json(), "Active Directory")
    assert joined["library_key"] not in {o["library_key"] for o in row["other_controls"]}
    duplicate = owner.post(
        f"{base}/systems/{directory['id']}/controls/add",
        json={"library_key": joined["library_key"]},
    )
    assert duplicate.status_code == 409
    assert joined["control_ref"] in duplicate.json()["detail"]
    # Taken out of scope, it is offered back under its own reference, and comes back.
    removed = owner.post(
        f"{base}/systems/{directory['id']}/controls/remove",
        json={"control_id": mine[0]["id"]},
    )
    assert removed.status_code == 200, removed.text
    offer = next(
        o for o in _system(removed.json(), "Active Directory")["other_controls"]
        if o["library_key"] == joined["library_key"]
    )  # fmt: skip
    assert offer["control_ref"] == joined["control_ref"] and offer["control_id"] == mine[0]["id"]
    back = owner.post(
        f"{base}/systems/{directory['id']}/controls/add", json={"control_id": offer["control_id"]}
    )
    assert back.status_code == 200, back.text
    assert [
        (c["control_ref"], c["included"]) for c in back.json()["controls"]
        if c["application_name"] == "Active Directory"
    ] == [(joined["control_ref"], True)]  # fmt: skip
    # It is not offered again, and its reference stays its own.
    again = _system(owner.get(base).json(), "Active Directory")["assessment"]["candidates"]
    assert not [c for c in again if c["adapted_from"] == joined["adapted_from"]
                and c["origin"] == "RCM"]  # fmt: skip
    # The team sets the system's code: the references follow it.
    renamed = owner.patch(f"{base}/systems/{directory['id']}/details", json={"ref_code": "ADS"})
    assert renamed.status_code == 200, renamed.text
    system_now = _system(owner.get(base).json(), "Active Directory")
    later = system_now["assessment"]
    assert later["ref_code"] == "ADS" and system_now["ref_code"] == "ADS"
    # Saving the other details keeps the code a person set.
    kept = owner.patch(f"{base}/systems/{directory['id']}/details", json={"owner": "IT Ops"})
    assert kept.status_code == 200, kept.text
    assert _system(owner.get(base).json(), "Active Directory")["ref_code"] == "ADS"
    assert all(c["control_ref"].startswith("ITGC-ADS-")
               for c in later["candidates"] if c["adapted_from"])  # fmt: skip
    assert (
        owner.patch(
            f"{base}/systems/{directory['id']}/details", json={"ref_code": "ad"}
        ).status_code
        == 422
    )


def test_an_engagement_loads_after_the_rules_stood_in_for_a_failed_review(
    migrated: Database,
) -> None:
    """A review whose model call failed is saved with source FALLBACK (migration 0094).
    Reading the engagement refused it (422) until the response allowed it, so every page of
    the engagement failed after the agent was asked (27 October 2026)."""
    owner, base = _engagement(migrated)
    body = owner.post(f"{base}/applications/known", json={"names": ["Workday"]}).json()
    workday = _system(body, "Workday")
    assert owner.post(f"{base}/systems/{workday['id']}/review").status_code == 200
    with connect(migrated.url) as connection:
        assert run_review(connection, None, UUID(workday["id"])) == "DONE"
        # As _assess leaves it when the model's answer did not fit.
        connection.execute(
            "UPDATE system_reviews SET source = 'FALLBACK', note = %s WHERE application_id = %s",
            (
                "The agent did not answer, so the reviewed rules were used.",
                UUID(workday["id"]),
            ),
        )
        connection.commit()
    loaded = owner.get(base)
    assert loaded.status_code == 200, loaded.text
    workday = _system(loaded.json(), "Workday")
    assert workday["review"]["source"] == "FALLBACK"
    assert workday["assessment"]["status"] == "IDLE"


def test_the_review_has_room_for_every_candidate() -> None:
    """8192 output tokens cut off a review of an infrastructure system's ~50 candidates, so
    the reviewed rules stood in for the agent every time (27 October 2026)."""
    from ai_workforce_api import system_applicability

    assert system_applicability.ASSESS_MAX_TOKENS >= 32000
    assert "every candidate" in system_applicability.ASSESS_PROMPT
