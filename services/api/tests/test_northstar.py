"""The Northstar synthetic engagement (Step 4A; `northstar/1`, demo_northstar/*): three
systems, fourteen controls on them, twenty-seven real evidence files read by the real
extraction, every scenario record consistent across the files that tell it, the same
bytes every time, nothing of it visible to another firm or counted against the trial, no
model call while it is built, and the same engagement when asked again."""

from __future__ import annotations

import hashlib
import time
from collections import Counter
from datetime import date
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

import pytest
from northstar_manifest import expectations, outcome_by_control
from support import Database
from test_demo import _demo, _initialize
from test_execution import _seed_org
from test_outbound import _session, migrated
from test_subscriptions import _member, _project, _sign_up

from ai_workforce_api.db import connect, transaction
from ai_workforce_api.demo_northstar import files as F
from ai_workforce_api.demo_northstar import records as R
from ai_workforce_api.evidence_extraction import extract
from ai_workforce_api.workforce import sync_standard_workforce

__all__ = ["migrated"]

NORTHSTAR = {"demo_dataset": "northstar/1"}


def _start(migrated: Database, **overrides: Any) -> tuple[Any, UUID, UUID, UUID]:
    # The deployment's standard workforce, as a deploy installs it: a firm's agents come
    # from it, and setup readiness asks for them.
    with connect(migrated.url) as connection:
        sync_standard_workforce(connection)
    client, organization_id, user_id = _sign_up(
        migrated, overrides.pop("email", "dana@firm.example"), **NORTHSTAR, **overrides
    )
    started = _initialize(client, organization_id)
    assert started.status_code == 200, started.text
    assert started.json()["state"] == "READY"
    return client, organization_id, user_id, UUID(started.json()["project_id"])


def _rows(url: str, sql: str, *params: Any) -> list[tuple[Any, ...]]:
    with connect(url) as connection:
        return connection.execute(sql, params).fetchall()


# The records and the files, before any database


def test_the_records_are_the_same_every_time_and_tell_one_story() -> None:
    first, second = R.build(), R.build()
    assert first == second
    files = F.render(first)
    again = F.render(second)
    assert [f.file_name for f in files] == list(
        F.render(first)[i].file_name for i in range(len(files))
    )
    assert all(a.content == b.content for a, b in zip(files, again, strict=True))
    assert len(files) == 33 and len({f.file_name for f in files}) == 33
    assert len(R.SYSTEMS) == 3 and len(R.CONTROLS) == 14
    assert len({c.ref for c in R.CONTROLS}) == 14
    assert Counter(c.category for c in R.CONTROLS) == {
        "ITGC_ACCESS": 7, "ITGC_CHANGE": 2, "ITGC_OPERATIONS": 2, "ITAC": 1, "IPE": 1, "MRC": 1,
    }  # fmt: skip
    # Every file belongs to a control and every control has evidence.
    by_key = {f.key: f for f in files}
    for control in R.CONTROLS:
        assert control.files, control.ref
        for key in control.files:
            assert control.ref in by_key[key].controls, (control.ref, key)
        for system in control.systems:
            assert system in R.SYSTEM_BY_KEY

    # The late termination: one person, the same dates, in the HR listing, the removal
    # log and the user listing; nine business days, against a criterion of three.
    hr = next(r for r in first.hr_terminations if r["employee_id"] == R.LATE_TERMINATION_EMPLOYEE)
    removal = next(
        r for r in first.termination_removals if r["employee_id"] == R.LATE_TERMINATION_EMPLOYEE
    )
    user = next(r for r in first.sap_users if r["employee_id"] == R.LATE_TERMINATION_EMPLOYEE)
    assert hr["termination_date"] == removal["termination_date"]
    assert removal["lock_date"] == user["valid_to"] and user["lock_status"] == 64
    assert (
        removal["business_days"]
        == 9
        == R.business_days_between(
            cast(date, hr["termination_date"]), cast(date, removal["lock_date"])
        )
    )
    # The account still open: in the HR listing, not in the removal log, unlocked.
    assert any(r["employee_id"] == R.OPEN_TERMINATION_EMPLOYEE for r in first.hr_terminations)
    assert not any(
        r["employee_id"] == R.OPEN_TERMINATION_EMPLOYEE for r in first.termination_removals
    )
    open_user = next(r for r in first.sap_users if r["employee_id"] == R.OPEN_TERMINATION_EMPLOYEE)
    assert (open_user["lock_status"], str(open_user["valid_to"])) == (0, "9999-12-31")
    # Every other termination was locked within three business days.
    others = [
        r for r in first.termination_removals if r["employee_id"] != R.LATE_TERMINATION_EMPLOYEE
    ]
    assert others and all(int(r["business_days"]) <= 3 for r in others)  # type: ignore[call-overload]
    # Privileged access: the contractor, in the user listing and the report, with no request.
    assert any(r["user_id"] == R.UNAPPROVED_PRIVILEGED_USER for r in first.sap_users)
    assert not any(r["sap_user"] == R.UNAPPROVED_PRIVILEGED_USER for r in first.firefighter_log)
    # Changes: the unapproved transport is in the log, on its ticket, and in no CAB meeting;
    # the late one is approved two days after its import; every other import follows its
    # approval, and no transport is imported by its own developer.
    tickets = {str(t["ticket"]): t for t in first.change_tickets}
    cab = {ticket for m in first.cab_meetings for ticket in cast(list[str], m["approved_tickets"])}
    assert R.UNAPPROVED_TICKET not in cab and R.LATE_APPROVED_TICKET in cab
    for row in first.transport_log:
        ticket = tickets[str(row["change_ticket"])]
        assert row["owner"] != row["imported_by"]
        assert str(row["transport_id"]) in str(ticket["transports"])
        if row["transport_id"] == R.UNAPPROVED_TRANSPORT:
            assert ticket["approval_date"] is None and ticket["test_evidence"] == ""
        elif row["transport_id"] == R.LATE_APPROVED_TRANSPORT:
            assert ticket["approval_date"] > row["import_date"]  # type: ignore[operator]
        else:
            assert ticket["approval_date"] <= row["import_date"]  # type: ignore[operator]
            if ticket["category"] == "Normal":
                assert str(ticket["ticket"]) in cab
    # Revenue: the report is short of the ledger by exactly the missing entity.
    assert (
        sum(Decimal(str(r["revenue_usd"])) for r in first.revenue_report) == R.REVENUE_REPORT_TOTAL
    )
    assert sum(Decimal(str(r["amount_usd"])) for r in first.gl_revenue) == R.GL_REVENUE_TOTAL
    assert R.GL_REVENUE_TOTAL - R.REVENUE_REPORT_TOTAL == R.MISSING_ENTITY_REVENUE
    assert {r["company_code"] for r in first.revenue_report} == {"1000", "2000", "3000"}
    missing = [r for r in first.gl_revenue if r["company_code"] == "4000"]
    assert sum(Decimal(str(r["amount_usd"])) for r in missing) == R.MISSING_ENTITY_REVENUE
    # Invoices: blocked exactly when outside tolerance.
    for row in first.ap_invoices:
        outside = (
            abs(Decimal(str(row["variance_pct"]))) > 5
            or abs(Decimal(str(row["variance_usd"]))) > 500
        )
        assert (row["payment_block"] == "R") == outside, row
    assert {r["invoice"] for r in first.blocked_invoices} == {
        r["invoice"] for r in first.ap_invoices if r["payment_block"] == "R"
    }
    # Flux: the one unexplained variance is over the threshold; every other over-threshold
    # variance has an explanation and an investigator.
    for row in first.flux_analysis:
        if row["gl_account"] == R.UNEXPLAINED_FLUX_ACCOUNT:
            assert row["over_threshold"] == "Yes" and row["explanation"] == ""
        elif row["over_threshold"] == "Yes":
            assert row["explanation"] and row["investigated_by"]
    # Every certification is complete and every denial was revoked after it closed.
    for campaign in first.access_certifications:
        assert campaign["decided"] == campaign["assignments"]
        revoked = [
            r
            for r in first.certification_revocations
            if r["campaign_id"] == campaign["campaign_id"]
        ]
        assert len(revoked) == campaign["denied"]
        assert all(r["revoked_on"] > campaign["closed_on"] for r in revoked)  # type: ignore[operator]
    # Nothing in the files is dated outside the audit's world: the stale export aside,
    # every evidence date is in FY2027 or before the period end.
    assert R.STALE_EXPORT_DATE < R.PERIOD_START


def test_every_file_is_read_by_the_extraction_and_says_what_the_manifest_expects() -> None:
    data = R.build()
    files = {f.key: f for f in F.render(data)}
    texts: dict[str, str] = {}
    for key, item in files.items():
        read = extract(item.content, item.file_name, item.content_type)
        assert read.status == "EXTRACTED", (key, read.status, read.note)
        assert read.method in ("TABLE", "PDF_TEXT", "DOCUMENT"), key
        texts[key] = read.text
    for expected in expectations(data):
        if expected.outcome == "PASS":
            continue
        text = texts[expected.file_key]
        assert expected.row_key in text, (expected.control_ref, expected.row_key)
        assert expected.field in text, (expected.control_ref, expected.field)
    # The facts the exceptions rest on are in the words of the files themselves.
    assert (
        "NS-EMP-0417" in texts["termination_removals"] and "| 9 |" in texts["termination_removals"]
    )
    assert "NSUSR0388" in texts["privileged_access"] and "Devin Marsh" in texts["privileged_access"]
    assert "CHG0027144" in texts["change_tickets"] and "CHG0027144" not in texts["cab_approvals"]
    assert "CHG0027131" in texts["cab_approvals"]
    assert "2026-10-14" in texts["conditional_access"]
    assert "-184320.00" in texts["ipe_reconciliation"]
    assert "2027-09-03" in texts["close_memo_aug"] and "2027-09-05" in texts["close_memo_aug"]
    assert outcome_by_control(data) == {
        "NS-AC-01": "PASS", "NS-AC-02": "EXCEPTION", "NS-AC-03": "EXCEPTION", "NS-AC-04": "PASS",
        "NS-AC-05": "PASS", "NS-AC-06": "INSUFFICIENT", "NS-AC-07": "PASS", "NS-CM-01": "EXCEPTION",
        "NS-CM-02": "PASS", "NS-OP-01": "PASS", "NS-OP-02": "EXCEPTION", "NS-AP-01": "PASS",
        "NS-IP-01": "EXCEPTION", "NS-MR-01": "EXCEPTION",
    }  # fmt: skip


# The engagement in the database


def test_the_demo_engagement_is_built_through_the_applications_own_tables(
    migrated: Database,
) -> None:
    client, organization_id, user_id, project_id = _start(migrated)
    url = migrated.url
    base = f"/organizations/{organization_id}/projects/{project_id}"

    systems = _rows(url, "SELECT name, ref_code, owner, control_areas FROM engagement_applications "
                    "WHERE project_id = %s ORDER BY name", project_id)  # fmt: skip
    assert [row[0] for row in systems] == ["Microsoft Entra ID", "SAP S/4HANA", "Snowflake"]
    assert all(row[1] and row[2] and row[3] for row in systems)

    controls = _rows(
        url,
        """
        SELECT c.control_ref, c.domain, c.frequency, c.nature, c.owner_name, a.name, c.included,
               c.source, c.classifications, jsonb_array_length(c.test_attributes),
               (SELECT count(*) FROM control_attributes x
                WHERE x.engagement_control_id = c.id AND x.status = 'APPROVED')
        FROM engagement_controls c
        JOIN engagement_applications a ON a.id = c.engagement_application_id
        WHERE c.project_id = %s ORDER BY c.control_ref
        """,
        project_id,
    )
    assert len(controls) == 14
    assert [row[0] for row in controls] == sorted(c.ref for c in R.CONTROLS)
    by_ref = {row[0]: row for row in controls}
    for control in R.CONTROLS:
        row = by_ref[control.ref]
        assert row[5] == R.SYSTEM_BY_KEY[control.systems[0]].name, control.ref
        assert row[4] == R.PEOPLE[control.owner].name
        assert row[6] is True and row[7] == "MANUAL"
        assert row[9] == len(control.attributes) == row[10], control.ref
    assert by_ref["NS-AP-01"][3] == "AUTOMATED" and by_ref["NS-MR-01"][8] == [
        "MANAGEMENT_REVIEW",
    ]
    assert by_ref["NS-IP-01"][1] == "IPE" and by_ref["NS-MR-01"][1] == "RECORD_TO_REPORT"

    files = _rows(
        url,
        """
        SELECT f.file_name, f.content_sha256, f.size_bytes, f.content_type, c.control_ref, a.name,
               an.status, an.extraction_status, an.source, an.extracted_text, an.classification
        FROM evidence_files f
        JOIN evidence_matches m ON m.evidence_file_id = f.id
        JOIN engagement_controls c ON c.id = m.engagement_control_id
        JOIN evidence_file_applications t ON t.evidence_file_id = f.id
        JOIN engagement_applications a ON a.id = t.engagement_application_id
        JOIN evidence_analyses an ON an.evidence_file_id = f.id
        WHERE f.project_id = %s ORDER BY f.file_name
        """,
        project_id,
    )
    assert len(files) == 36  # 33 files, three of them filed to a second or third control
    rendered = {f.file_name: f for f in F.render(R.build())}
    for name, sha, size, kind, ref, system, status, read, source, text, classification in files:
        item = rendered[name]
        assert sha == hashlib.sha256(item.content).hexdigest() and size == item.size
        assert kind == item.content_type and ref in item.controls
        assert system == R.SYSTEM_BY_KEY[item.system].name
        assert (status, read, source) == ("READY", "EXTRACTED", "RULES")
        assert text and classification["kind"]
    # The register and a download work through the ordinary routes.
    listed = client.get(f"{base}/evidence-files").json()
    assert len(listed) >= 36
    first = next(
        item for item in listed if item["file_name"] == "SAP_User_Listing_USR02_2027-09-30.csv"
    )
    content = client.get(f"{base}/evidence-files/{first['id']}/content")
    assert content.status_code == 200 and b"NSUSR0417" in content.content
    reading = client.get(f"{base}/evidence-files/{first['id']}/reading")
    assert reading.status_code == 200 and "NSUSR0533" in reading.json()["text"]

    # The profile: the client, the period, the contacts, the processes.
    settings = _rows(
        url,
        "SELECT s.client_name, s.engagement_type, s.period_start, s.period_end, s.fiscal_year, "
        "s.methodology, s.period_confirmed_at IS NOT NULL, p.status::text, p.demo "
        "FROM engagement_settings s JOIN projects p ON p.id = s.project_id WHERE s.project_id = %s",
        project_id,
    )[0]
    assert settings[:6] == (
        R.CLIENT_NAME,
        "SOX_ITGC",
        R.PERIOD_START,
        R.PERIOD_END,
        "FY2027",
        "EXTERNAL_ICFR",
    )
    assert settings[6] is True and settings[8] is True
    assert _rows(
        url, "SELECT count(*) FROM engagement_contacts WHERE project_id = %s", project_id
    ) == [(8,)]
    assert _rows(
        url, "SELECT count(*) FROM engagement_processes WHERE project_id = %s", project_id
    ) == [(3,)]
    # The demo's own team (lead, reviewer, tester) satisfies readiness: the engagement
    # launches through the real setup, and the build's record says so.
    assert settings[7] == "ACTIVE"
    built = _rows(
        url,
        "SELECT payload FROM audit_events WHERE project_id = %s AND action = 'demo.dataset_built'",
        project_id,
    )
    assert built[0][0]["launched"] is True and built[0][0]["evidence_files"] == 36
    assert set(built[0][0]["team"]) == {"dana", "riley", "morgan"}

    # No model was called, nothing is queued for a worker, and the trial's own allowance
    # is untouched: the demo counts for nothing.
    assert _rows(url, "SELECT count(*) FROM model_calls WHERE project_id = %s", project_id) == [
        (0,)
    ]
    assert _rows(
        url,
        "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
        organization_id,
    ) == [(0,)]
    assert _rows(
        url,
        "SELECT count(*) FROM evidence_analyses WHERE project_id = %s AND status <> 'READY'",
        project_id,
    ) == [(0,)]
    assert _rows(
        url,
        "SELECT count(*) FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING'",
        project_id,
    ) == [(0,)]
    usage = client.get(f"/organizations/{organization_id}/subscription").json()["usage"]
    assert (usage["engagements"], usage["systems"], usage["controls"], usage["uploads"]) == (
        0,
        0,
        0,
        0,
    )
    own = _project(client, organization_id, user_id, "sox-fy27")
    assert own.status_code == 201, own.text


def test_the_build_is_repeatable_and_the_same_for_every_firm(migrated: Database) -> None:
    client, organization_id, _, project_id = _start(migrated)
    again = _initialize(client, organization_id).json()
    assert UUID(again["project_id"]) == project_id and again["attempts"] == 1
    assert _rows(
        migrated.url,
        "SELECT count(*) FROM projects WHERE organization_id = %s AND demo",
        organization_id,
    ) == [(1,)]
    assert (
        _rows(
            migrated.url, "SELECT count(*) FROM evidence_files WHERE project_id = %s", project_id
        )[0][0]
        >= 38
    )
    # Another firm's demo has the same files, byte for byte, and nothing of the first's.
    other, other_firm, _, other_project = _start(migrated, email="lee@other.example")
    mine = _rows(
        migrated.url,
        "SELECT file_name, content_sha256 FROM evidence_files WHERE project_id = %s ORDER BY 1",
        project_id,
    )
    theirs = _rows(
        migrated.url,
        "SELECT file_name, content_sha256 FROM evidence_files WHERE project_id = %s ORDER BY 1",
        other_project,
    )
    assert mine == theirs
    tables = (
        "engagement_controls", "engagement_applications", "evidence_files", "evidence_matches",
        "evidence_analyses", "engagement_contacts", "audit_events",
    )  # fmt: skip
    for table in tables:
        assert _rows(
            migrated.url,
            f"SELECT count(*) FROM {table} WHERE project_id = %s AND organization_id <> %s",  # noqa: S608
            other_project,
            other_firm,
        ) == [(0,)]
    assert other.get(f"/organizations/{organization_id}/projects/{project_id}").status_code == 404
    assert client.get(f"/organizations/{other_firm}/projects/{other_project}").status_code == 404
    # The demo answers for each firm name their own engagement.
    assert UUID(_demo(client, organization_id)["project_id"]) == project_id
    assert UUID(_demo(other, other_firm)["project_id"]) == other_project


def test_a_reset_can_build_the_demo_again_beside_the_archived_one(migrated: Database) -> None:
    """Compatibility with the reset to come (Step 6): once the first demo is archived, the
    record builds another, with its own slug and its own files, and nothing collides."""
    client, organization_id, user_id, project_id = _start(migrated)
    with connect(migrated.url) as connection, transaction(connection) as cursor:
        cursor.execute("UPDATE projects SET status = 'ARCHIVED' WHERE id = %s", (project_id,))
        cursor.execute(
            "UPDATE organization_demos SET state = 'ARCHIVED', archived_at = clock_timestamp(), "
            "resets = resets + 1 WHERE organization_id = %s",
            (organization_id,),
        )
    body = _demo(client, organization_id)
    assert (body["state"], body["invited"]) == ("ARCHIVED", False)
    rebuilt = _initialize(client, organization_id)
    assert rebuilt.status_code == 200, rebuilt.text
    second = UUID(rebuilt.json()["project_id"])
    assert second != project_id
    slugs = _rows(
        migrated.url,
        "SELECT slug FROM projects WHERE organization_id = %s AND demo ORDER BY created_at",
        organization_id,
    )
    assert slugs == [(R.ENGAGEMENT_SLUG,), (f"{R.ENGAGEMENT_SLUG}-2",)]
    assert (
        _rows(migrated.url, "SELECT count(*) FROM evidence_files WHERE project_id = %s", second)[0][
            0
        ]
        >= 38
    )
    assert user_id is not None


def test_a_firm_with_a_reviewer_launches_the_demo_through_the_real_setup(
    migrated: Database,
) -> None:
    """With a lead and a reviewer on the team (an internal firm here; a trial firm needs
    the personnel decision), the build launches the engagement: active, a plan per
    control, the schedule's milestones, and the request drafts skipped, not queued."""
    from ai_workforce_api.demo_datasets import DemoContext, configured
    from ai_workforce_api.settings import Settings

    with connect(migrated.url) as connection:
        sync_standard_workforce(connection)
        seeded = _seed_org(connection, "internal")
        organization_id, user_id = seeded["organization_id"], seeded["user_id"]
        _member(connection, organization_id, "morgan@internal.example")
        reviewer = connection.execute(
            "SELECT id FROM users WHERE email = 'morgan@internal.example'"
        ).fetchone()
        assert reviewer is not None
        settings = Settings(database_url=migrated.url, demo_dataset="northstar/1")
        dataset = configured(settings)
        assert dataset is not None and dataset.key == "northstar/1" and dataset.complete is True
        started = time.monotonic()
        with transaction(connection) as cursor:
            cursor.execute(
                "SELECT set_config('aw.demo_initialization', %s, true)", (str(organization_id),)
            )
            # The reviewer joins before the launch decides readiness: the dataset adds the
            # requester as lead; the team's reviewer is the firm's own.
            context = DemoContext(organization_id, user_id, 1, R.AS_OF, settings)
            project_id = _build_with_reviewer(cursor, dataset, context, reviewer[0])
        elapsed = time.monotonic() - started
    assert elapsed < 30, elapsed
    url = migrated.url
    assert _rows(url, "SELECT status::text, demo FROM projects WHERE id = %s", project_id) == [
        ("ACTIVE", True)
    ]
    assert _rows(
        url,
        "SELECT kicked_off_at IS NOT NULL, scope_finalized_at IS NOT NULL "
        "FROM engagement_settings WHERE project_id = %s",
        project_id,
    ) == [(True, True)]
    assert _rows(url, "SELECT count(*) FROM evidence_plans WHERE project_id = %s", project_id) == [
        (14,)
    ]
    assert _rows(
        url,
        "SELECT count(*) FROM evidence_plans WHERE project_id = %s AND run_status <> 'IDLE'",
        project_id,
    ) == [(0,)]
    assert _rows(
        url,
        "SELECT count(*) FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING'",
        project_id,
    ) == [(0,)]
    assert (
        _rows(url, "SELECT count(*) FROM engagement_milestones WHERE project_id = %s", project_id)[
            0
        ][0]
        >= 8
    )
    assert _rows(url, "SELECT count(*) FROM model_calls WHERE project_id = %s", project_id) == [
        (0,)
    ]
    built = _rows(
        url,
        "SELECT payload FROM audit_events WHERE project_id = %s AND action = 'demo.dataset_built'",
        project_id,
    )
    assert built[0][0]["launched"] is True
    client = _session(migrated, user_id)
    detail = client.get(f"/organizations/{organization_id}/projects/{project_id}").json()
    assert (detail["demo"], detail["launched"], detail["status"]) == (True, True, "ACTIVE")


def _build_with_reviewer(cursor: Any, dataset: Any, context: Any, reviewer: UUID) -> UUID:
    """The dataset's build, with the firm's reviewer put on the team before the launch
    step looks at readiness (the build adds the lead; the reviewer is the firm's)."""
    from ai_workforce_api.demo_northstar import dataset as D

    original = D._launch

    def launch(
        connection: Any, cur: Any, organization_id: UUID, project_id: UUID, requester: UUID
    ) -> bool:
        cur.execute(
            "INSERT INTO project_memberships "
            "(organization_id, project_id, user_id, engagement_role) "
            "VALUES (%s, %s, %s, 'REVIEWER')",
            (organization_id, project_id, reviewer),
        )
        return original(connection, cur, organization_id, project_id, requester)

    setattr(D, "_launch", launch)  # noqa: B010
    try:
        return UUID(str(dataset.build(cursor, context)))
    finally:
        setattr(D, "_launch", original)  # noqa: B010


def test_a_live_model_is_never_needed_or_called(migrated: Database) -> None:
    """The build never touches a provider: a deployment with a live key configured builds
    the same demo and records no call and no reservation."""
    client, organization_id, _, project_id = _start(
        migrated, model_provider="anthropic", model_api_key="not-a-real-key-and-never-used"
    )
    assert _rows(
        migrated.url, "SELECT count(*) FROM model_calls WHERE organization_id = %s", organization_id
    ) == [(0,)]
    assert _rows(
        migrated.url,
        "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
        organization_id,
    ) == [(0,)]
    assert _demo(client, organization_id)["dataset_complete"] is True
    assert project_id is not None


@pytest.mark.parametrize("key", F.FILE_KEYS)
def test_each_file_key_is_rendered_once(key: str) -> None:
    files = [f for f in F.render(R.build()) if f.key == key]
    assert len(files) == 1
    assert files[0].size < 1_000_000
