"""Scope integrity part A (scope-integrity-a, 19 November 2026).

The states the branch changes, each on an engagement of its own (one firm each, so the
owner signs in with the token in the state's facts):

- scope-rcm-held       an uploaded RCM whose preview holds the import: a control ID on two
                       rows that differ, and an unreadable row whose control ID another row
                       imports; the systems scanned by the rules (no model)
- scope-rcm-held-many  the same with more conflicts than are listed one by one ("And N
                       more"), for long content
- scope-rcm-held-launched  HELD_RCM uploaded on Controls after a launch with no controls:
                       the same problems outside the guided setup page
- scope-wizard-reason  Workday reviewed by the standard checks, the IT general controls in
                       scope, then launched (the wizard is on Systems & Processes, which
                       opens at launch): leaving out a control the checks assessed asks one
                       reason for all of them
- scope-wizard-reason-soc  the same, with a SOC 1 report for Workday read: the suggested
                       reasons offer reliance on it (with no report on file, they say the
                       controls are expected to be covered by one)
- scope-wizard-record  a launched engagement (SAP ERP) with a test sheet on ITGC-AC-02, the
                       system reviewed by the standard checks: taking controls out in the
                       wizard shows the work on record and asks why

Built with the test suite's own helpers, as tests/test_engagement_integrity.py builds them.
"""

import secrets
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from test_engagement_integrity import _launched, _ready_without_controls, _test_sheet
from test_onboarding import _base, _choose_methodology, _new_engagement, _pbc
from test_rcm_uploads import _upload
from test_system_applicability import REPORT, _answer, _read, _Scripted, _wand
from test_system_applicability import _setup as _wizard_setup

from ai_workforce_api.auth import token_hash
from ai_workforce_api.db import connect
from ai_workforce_api.rcm_systems import run_scan
from ai_workforce_api.system_scoping import run_review

HEAD = "Ctrl #,Control Activity,How Often,Manual / Automated,Process,Control Owner,Systems\n"
# Rows 2 and 3 share AC 1.01 but differ in description and owner; row 4 has no
# description and repeats AC 1.02, which row 5 imports.
HELD_RCM = HEAD + (
    "AC 1.01,Managers approve new access requests before access is granted.,As needed,"
    "Manual,User Access,Dana Ruiz,Ledger One\n"
    "AC 1.01,HR approves new access requests for joiners.,As needed,Manual,User Access,"
    "Lee Park,Workday\n"
    "AC 1.02,,Quarterly,Manual,User Access,Dana Ruiz,Workday\n"
    "AC 1.02,System owners review user access each quarter and remove access that is no "
    "longer needed.,Quarterly,Manual,User Access,Dana Ruiz,Ledger One\n"
    "CM 2.01,Changes are tested and approved before release to production.,Quarterly,"
    "Manual,Program Change,Lee Park,Ledger One\n"
)
# Seven control IDs that differ (five listed, then "And 2 more") and two unreadable rows.
HELD_MANY_RCM = (
    HEAD
    + "".join(
        f"AC 2.0{n},Access to the general ledger application is approved for role {n}.,"
        f"Daily,Manual,User Access,Dana Ruiz,Ledger One\n"
        f"AC 2.0{n},Access for role {n} is approved by the HR business partner and the "
        f"application owner together.,Daily,Manual,User Access,Lee Park,Workday\n"
        for n in range(1, 8)
    )
    + "CM 3.01,,Quarterly,Manual,Program Change,Lee Park,Workday\n"
    "CM 3.01,Changes are tested and approved before release to production.,Quarterly,"
    "Manual,Program Change,Lee Park,Ledger One\n"
    "CM 3.02,,Quarterly,Manual,Program Change,Lee Park,Workday\n"
    "CM 3.02,Emergency changes are approved after the fact within two business days.,"
    "Quarterly,Manual,Program Change,Lee Park,Ledger One\n"
)


def _sign_in(url: str, user_id: object) -> str:
    """An eight-hour owner session for the state's own firm (as seed_review_states does)."""
    token = secrets.token_urlsafe(32)
    with connect(url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            "VALUES (%s, %s, clock_timestamp() + interval '8 hours')",
            (user_id, token_hash(token)),
        )
        connection.commit()
    return token


def _name(url: str, team: dict[str, Any], firm: str) -> None:
    with connect(url) as connection:
        connection.execute("UPDATE organizations SET name = %s WHERE id = %s", (firm, team["org"]))
        connection.execute(
            "UPDATE users SET display_name = 'Engagement lead', email = %s WHERE id = %s",
            (f"lead.{str(team['org'])[-6:]}@example.com", team["owner_id"]),
        )
        connection.execute(
            "UPDATE users SET display_name = 'Engagement reviewer', email = %s WHERE id = %s",
            (f"reviewer.{str(team['org'])[-6:]}@example.com", team["reviewer_id"]),
        )
        connection.commit()


def _held(seed: Any, name: str, text: str) -> None:
    team = _new_engagement(seed.database, name)
    owner, base = team["owner"], _base(team["org"], team["project"])
    uploaded = _upload(owner, base, text, file_name="Example RCM FY2027.csv")
    assert uploaded["ready"] is False, uploaded
    with connect(seed.database.url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
    preview = owner.get(f"{base}/rcm/uploads/{uploaded['id']}").json()
    assert preview["ready"] is False and preview["preview"]["problems"], preview
    _name(seed.database.url, team, "Example Audit Firm")
    seed.add(
        name,
        seed.href(team, section="setup", step="controls"),
        token=_sign_in(seed.database.url, team["owner_id"]),
        problems=preview["preview"]["problems"],
    )


def held_after_launch(url: str, owner: Any, team: dict[str, Any]) -> dict[str, Any]:
    """An engagement launched with no controls (as it may be, 25 October 2026), then
    HELD_RCM uploaded on Controls and its systems scanned by the rules: the preview's
    problems show there, outside the guided setup page. Takes any client with the test
    client's get/post/patch (the scratch API's too), so a seeded database can gain it."""
    base = _base(team["org"], team["project"])
    _ready_without_controls(owner, team)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    uploaded = _upload(owner, base, HELD_RCM, file_name="Example RCM FY2027.csv")
    assert uploaded["ready"] is False, uploaded
    with connect(url) as connection:
        assert run_scan(connection, None, UUID(uploaded["id"])) == "READY"
    preview = owner.get(f"{base}/rcm/uploads/{uploaded['id']}").json()
    assert preview["ready"] is False and preview["preview"]["problems"], preview
    return preview


def reviewed_then_launched(
    url: str, owner: Any, team: dict[str, Any], system_id: str
) -> dict[str, str]:
    """Workday reviewed by the standard checks (no model), then the engagement launched:
    the system wizard is reached on Systems & Processes, which opens at launch. The
    statuses the checks gave, by control ID."""
    base = _base(team["org"], team["project"])
    system = _wand(SimpleNamespace(url=url), owner, base, system_id)
    statuses = {c["control_ref"]: c["status"] for c in system["assessment"]["candidates"]}
    scoped = owner.patch(
        f"{base}/scope", json={"scope": "ITGCs over Workday for FY2027", "period_end": "2027-12-31"}
    )
    assert scoped.status_code == 200, scoped.text
    for user_id, role in ((team["owner_id"], "LEAD"), (team["reviewer_id"], "REVIEWER")):
        joined = owner.post(f"{base}/team", json={"user_id": str(user_id), "engagement_role": role})
        assert joined.status_code == 200, joined.text
    for domain, email in (
        ("ACCESS", "iam@client.example"),
        ("CHANGE", "release@client.example"),
        ("OPERATIONS", "ops@client.example"),
    ):
        owner.post(
            f"{base}/controls/owner",
            json={"domain": domain, "owner_name": f"{domain.title()} owner", "owner_email": email},
        )
    assert owner.patch(f"{base}/pbc", json=_pbc()).status_code == 200
    assert owner.post(f"{base}/templates/confirm").status_code == 200
    _choose_methodology(owner, base)
    fingerprint = owner.get(base).json()["plan_preview"]["fingerprint"]
    launched = owner.post(f"{base}/plan/launch", json={"fingerprint": fingerprint})
    assert launched.status_code == 200, launched.text
    return statuses


def with_soc_report(
    url: str, owner: Any, base: str, system_id: str, statuses: dict[str, str]
) -> dict[str, str]:
    """A synthetic SOC 1 report for the system uploaded and read by a scripted model (as
    test_an_uploaded_report_gives_the_cuecs_and_their_mapping reads it), the assessment
    keeping the statuses the standard checks gave. The report as the API lists it."""
    uploaded = owner.post(
        f"{base}/systems/{system_id}/soc-reports/upload",
        params={"file_name": "Workday SOC 1 2027.txt"},
        content=REPORT.encode(),
        headers={"content-type": "text/plain"},
    )
    assert uploaded.status_code == 200, uploaded.text
    refs = sorted(statuses)
    answer = _answer(
        refs,
        controls=[
            {
                "control_ref": ref,
                "status": statuses[ref],
                "rationale": "Usual for application systems.",
                "support": "System details",
                "missing": "",
                "confidence": "LOW",
            }
            for ref in refs
        ],
    )
    with connect(url) as connection:
        assert run_review(connection, _Scripted([_read(refs), answer]), UUID(system_id)) == "DONE"
    system = next(a for a in owner.get(base).json()["applications"] if a["id"] == system_id)
    (report,) = system["soc_reports"]
    assert (report["status"], report["report_kind"]) == ("READ", "SOC1"), report
    return {"status": report["status"], "report_kind": report["report_kind"]}


def build(seed: Any) -> None:
    _held(seed, "scope-rcm-held", HELD_RCM)
    _held(seed, "scope-rcm-held-many", HELD_MANY_RCM)

    team = _new_engagement(seed.database, "rcm-held-launched")
    preview = held_after_launch(seed.database.url, team["owner"], team)
    _name(seed.database.url, team, "Example Audit Firm")
    seed.add(
        "scope-rcm-held-launched",
        seed.href(team, section="register", step="controls"),
        token=_sign_in(seed.database.url, team["owner_id"]),
        problems=preview["preview"]["problems"],
    )

    owner, base, system_id, team = _wizard_setup(seed.database)
    statuses = reviewed_then_launched(seed.database.url, owner, team, system_id)
    _name(seed.database.url, team, "Example Audit Firm")
    seed.add(
        "scope-wizard-reason",
        seed.href(team, section="controls", system=system_id),
        token=_sign_in(seed.database.url, team["owner_id"]),
        system_id=system_id,
        statuses=statuses,
    )

    owner, base, system_id, team = _wizard_setup(seed.database)
    statuses = reviewed_then_launched(seed.database.url, owner, team, system_id)
    report = with_soc_report(seed.database.url, owner, base, system_id, statuses)
    _name(seed.database.url, team, "Example Audit Firm")
    seed.add(
        "scope-wizard-reason-soc",
        seed.href(team, section="controls", system=system_id),
        token=_sign_in(seed.database.url, team["owner_id"]),
        system_id=system_id,
        report=report,
    )

    team, owner, base = _launched(seed.database, "wizard-record")
    state = owner.get(base).json()
    sap = next(a["id"] for a in state["applications"] if a["name"] == "SAP ERP")
    tested = next(
        c
        for c in state["controls"]
        if c["application_id"] == sap and c["control_ref"] == "ITGC-AC-02"
    )
    _test_sheet(seed.database, team, UUID(tested["id"]))
    _wand(seed.database, owner, base, sap)
    _name(seed.database.url, team, "Example Audit Firm")
    seed.add(
        "scope-wizard-record",
        seed.href(team, section="controls", system=sap),
        token=_sign_in(seed.database.url, team["owner_id"]),
        system_id=sap,
        tested="ITGC-AC-02",
    )
