"""Controls the team writes itself: a business process control for a cycle, a key report
for a system, refused when the ID is taken or a system-bound area names no system."""

from support import Database
from test_onboarding import _base, _new_engagement
from test_outbound import migrated

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "control_ref": "REV-09",
        "title": "Credit notes are approved",
        "risk": "Unapproved credit notes reduce revenue.",
        "activity": "The finance manager approves every credit note over the threshold.",
        "domain": "ORDER_TO_CASH",
        "frequency": "WEEKLY",
        "nature": "MANUAL",
        "key_control": True,
        "test_attributes": ["Approval is by the finance manager", "Approval precedes posting"],
        "pbc_items": ["Credit note listing for the period"],
    }
    body.update(overrides)
    return body


def test_the_team_writes_its_own_controls(migrated: Database) -> None:
    team = _new_engagement(migrated, "manual-controls")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    owner.post(f"{base}/applications", json={"name": "SAP ERP", "description": ""})
    sap = next(a for a in owner.get(base).json()["applications"] if a["name"] == "SAP ERP")
    # A business process control belongs to its cycle, not a system.
    added = owner.post(f"{base}/controls/new", json=_body())
    assert added.status_code == 200, added.text
    control = next(c for c in added.json()["controls"] if c["control_ref"] == "REV-09")
    assert control["source"] == "MANUAL"
    assert control["included"] is True
    assert control["application_id"] is None
    assert control["template_key"] == "business"
    assert control["agent_key"] == "business-process-tester"
    assert control["test_attributes"] == [
        "Approval is by the finance manager",
        "Approval precedes posting",
    ]
    # The same ID again is refused; a different system-bound control needs its system.
    assert owner.post(f"{base}/controls/new", json=_body()).status_code == 409
    no_system = owner.post(
        f"{base}/controls/new",
        json=_body(control_ref="KR-09", title="Aged debtors report", domain="IPE"),
    )
    assert no_system.status_code == 422
    report = owner.post(
        f"{base}/controls/new",
        json=_body(
            control_ref="KR-09",
            title="Aged debtors report",
            domain="IPE",
            application_id=sap["id"],
        ),
    )
    assert report.status_code == 200, report.text
    kr = next(c for c in report.json()["controls"] if c["control_ref"] == "KR-09")
    assert kr["application_id"] == sap["id"] and kr["template_key"] == "key-report"
    # Bad fields are refused: an unknown area, an empty activity, a secret-shaped value.
    assert owner.post(f"{base}/controls/new", json=_body(domain="NOPE")).status_code == 422
    assert owner.post(f"{base}/controls/new", json=_body(activity="  ")).status_code == 422
    assert (
        owner.post(
            f"{base}/controls/new",
            json=_body(control_ref="X-1", activity="api_key=sk-live-123456789012345678"),
        ).status_code
        == 422
    )
    with connect(migrated.url) as connection:
        sources = connection.execute(
            "SELECT source, count(*) FROM engagement_controls WHERE project_id = %s "
            "GROUP BY source ORDER BY source",
            (project,),
        ).fetchall()
    assert ("MANUAL", 2) in [(str(a), int(b)) for a, b in sources]
