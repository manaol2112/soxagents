"""Business processes the team names itself, beside the standard cycles, with the controls
it writes for them."""

from support import Database
from test_manual_controls import _body
from test_onboarding import _base, _new_engagement
from test_outbound import migrated

__all__ = ["migrated"]


def test_the_team_names_a_process_and_writes_controls_for_it(migrated: Database) -> None:
    team = _new_engagement(migrated, "named-processes")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    added = owner.post(
        f"{base}/processes", json={"name": "  Lease   accounting ", "domain": "FIXED_ASSETS"}
    )
    assert added.status_code == 200, added.text
    processes = added.json()["processes"]
    assert [(p["name"], p["domain"], p["controls_in_scope"]) for p in processes] == [
        ("Lease accounting", "FIXED_ASSETS", 0)
    ]
    assert processes[0]["domain_label"] == "Fixed assets and leases"
    leases = processes[0]["id"]
    # The same name again is refused; so is a process based on an IT area or nothing.
    assert (
        owner.post(
            f"{base}/processes", json={"name": "Lease accounting", "domain": "TAX"}
        ).status_code
        == 409
    )
    assert (
        owner.post(f"{base}/processes", json={"name": "Access", "domain": "ACCESS"}).status_code
        == 422
    )
    assert owner.post(f"{base}/processes", json={"name": "   ", "domain": "TAX"}).status_code == 422
    # A control written for the process takes the process's cycle as its area and keeps
    # the process's name as its own word for it.
    written = owner.post(
        f"{base}/controls/new",
        json=_body(
            control_ref="LEASE-01",
            title="Lease schedules are reviewed",
            domain="",
            process_id=leases,
        ),
    )
    assert written.status_code == 200, written.text
    control = next(c for c in written.json()["controls"] if c["control_ref"] == "LEASE-01")
    assert control["process_id"] == leases
    assert (control["domain"], control["domain_label"]) == ("FIXED_ASSETS", "Lease accounting")
    assert control["template_key"] == "business"
    assert control["agent_key"] == "business-process-tester"
    assert written.json()["processes"][0]["controls_in_scope"] == 1
    # The register shows the process as the control's area.
    listed = owner.get(f"/organizations/{org}/projects/{project}/workspace/controls").json()
    assert next(c for c in listed if c["control_ref"] == "LEASE-01")["area"] == "Lease accounting"
    # An unknown process is refused.
    unknown = owner.post(
        f"{base}/controls/new",
        json=_body(control_ref="LEASE-02", process_id="01a10000-0000-7000-8000-000000000000"),
    )
    assert unknown.status_code == 422
    # A process with controls stays; an empty one can be removed.
    kept = owner.post(f"{base}/processes/{leases}/remove")
    assert kept.status_code == 409
    assert kept.json()["detail"] == "process has controls"
    royalties = owner.post(
        f"{base}/processes", json={"name": "Royalties", "domain": "OTHER_BUSINESS"}
    )
    assert royalties.status_code == 200, royalties.text
    royalty_id = next(p["id"] for p in royalties.json()["processes"] if p["name"] == "Royalties")
    removed = owner.post(f"{base}/processes/{royalty_id}/remove")
    assert removed.status_code == 200, removed.text
    assert [p["name"] for p in removed.json()["processes"]] == ["Lease accounting"]
    assert owner.post(f"{base}/processes/{royalty_id}/remove").status_code == 422
