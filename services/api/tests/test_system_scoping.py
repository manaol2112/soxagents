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

    def gather_then_load(connection: Any, application_id: UUID) -> Any:
        facts = real_gather(connection, application_id)
        if not calls:
            owner.post(f"{base}/controls/load-library", json={"domains": ITGC})
            # The team asks again while the first run is under way.
            owner.post(f"{base}/systems/{workday['id']}/review")
        calls.append(len(facts.controls) if facts is not None else -1)
        return facts

    monkeypatch.setattr(system_scoping, "gather", gather_then_load)
    with connect(migrated.url) as connection:
        assert run_review(connection, None, UUID(workday["id"])) == "DONE"
    assert calls[0] == 0 and calls[-1] > 0
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
    # Nothing from the library next to the client's RCM: its own IT controls are offered.
    assert candidates and not set(candidates) & {c.control_ref for c in LIBRARY}
    # "Managers approve new access." is on SAP ERP only; it can be chosen for Workday too.
    assert "AC 1.01" in candidates and candidates["AC 1.01"]["in_scope"] is False
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
