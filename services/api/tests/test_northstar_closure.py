"""The Northstar lifecycle's closure (Step 4B closure; migration 0131, demo_northstar/
closure.py): the scenario date reaches only a demo engagement's own date checks; the
retests run in new rounds with their own evidence and citations while the original
exceptions stay; one control is final; the design evidence stands behind the design
assessments; what stays open is open on purpose; the reports reconcile to the records."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
from support import Database
from test_northstar import _rows
from test_northstar_lifecycle import _team, demo
from test_outbound import migrated
from test_subscriptions import _project

from ai_workforce_api.authorization import Principal, PrincipalKind
from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.db import connect
from ai_workforce_api.demo_northstar import rounds as RD
from ai_workforce_api.scenario import scenario_today

__all__ = ["demo", "migrated"]


# 1-2. The scenario date and what it never touches


def test_the_scenario_date_belongs_to_the_demo_alone(
    migrated: Database, demo: dict[str, Any]
) -> None:
    url, organization_id, project_id = demo["url"], demo["organization_id"], demo["project_id"]
    own = _project(demo["client"], organization_id, demo["user_id"], "sox-fy27-closure")
    assert own.status_code == 201, own.text
    real_project = UUID(own.json()["id"])
    today = datetime.now(UTC).date()
    with connect(url) as connection:
        assert scenario_today(connection, project_id) == RD.SCENARIO_AS_OF
        assert scenario_today(connection, real_project) == today
        assert scenario_today(connection, None) == today
        # A real engagement can never carry a scenario date, by any writer.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE engagement_settings SET scenario_as_of = %s WHERE project_id = %s",
                (RD.SCENARIO_AS_OF, real_project),
            )
        connection.rollback()
        # Nor can anyone move the demo's date outside demo initialization.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "UPDATE engagement_settings SET scenario_as_of = %s WHERE project_id = %s",
                (date(2028, 6, 1), project_id),
            )
        connection.rollback()
    assert _rows(
        url,
        "SELECT count(*) FROM engagement_settings s JOIN projects p ON p.id = s.project_id WHERE s.scenario_as_of IS NOT NULL AND NOT p.demo",
    ) == [(0,)]
    # The demo's own check reads the scenario date: a fix dated after it is "in the
    # future" there, as a fix dated after today is on a real engagement.
    from ai_workforce_api.workspace import DeficiencyProgress, _progress

    open_id, version = _rows(
        url,
        "SELECT id, version FROM deficiencies WHERE project_id = %s AND status = 'OPEN' ORDER BY reference LIMIT 1",
        project_id,
    )[0]
    with connect(url) as connection:
        principal = Principal(PrincipalKind.USER, _team(demo, "Dana Whitfield"))
        _progress(
            connection,
            principal,
            organization_id,
            project_id,
            UUID(str(open_id)),
            DeficiencyProgress(version=int(version), status="REMEDIATION_IN_PROGRESS"),
        )
        with pytest.raises(ValueError, match="future"):
            _progress(
                connection,
                principal,
                organization_id,
                project_id,
                UUID(str(open_id)),
                DeficiencyProgress(
                    version=int(version) + 1,
                    status="READY_FOR_RETEST",
                    remediated_on=RD.SCENARIO_AS_OF + timedelta(days=1),
                ),
            )
        connection.rollback()


def test_subscription_expiry_still_reads_the_clock(
    migrated: Database, demo: dict[str, Any]
) -> None:
    """The trial's end is the server's, whatever the demo's year: the firm's subscription
    reads TRIAL today, with seven days left, although its demo stands in December 2027."""
    organization_id = demo["organization_id"]
    body = demo["client"].get(f"/organizations/{organization_id}/subscription").json()
    assert body["state"] == "TRIAL" and 6 <= body["days_left"] <= 7
    assert _rows(demo["url"], "SELECT subscription_state(%s)", organization_id) == [("TRIAL",)]
    assert _rows(
        demo["url"],
        "SELECT count(*) FROM auth_sessions a JOIN users u ON u.id = a.user_id WHERE u.demo_organization_id = %s",
        organization_id,
    ) == [(0,)]


# 3-7. Retests


def test_the_retests_run_in_new_rounds_with_their_own_evidence_and_the_originals_stand(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    riley, morgan, dana = (_team(demo, n) for n in ("Riley Okafor", "Morgan Lee", "Dana Whitfield"))
    rounds = _rows(
        url,
        """
        SELECT c.control_ref, t.kind, t.status, t.conclusion, t.test_from, t.window_start, d.status, d.retest_result, d.remediated_on,
               s.signed_by, r.signed_by, s.id
        FROM test_rounds t JOIN engagement_controls c ON c.id = t.engagement_control_id
        LEFT JOIN deficiencies d ON d.id = t.deficiency_id
        LEFT JOIN test_sheets s ON s.test_round_id = t.id
        LEFT JOIN control_reviews r ON r.test_round_id = t.id
        WHERE t.project_id = %s AND t.kind = 'RETEST' ORDER BY 1
        """,
        project_id,
    )
    assert [(r[0], r[2], r[3], r[6], r[7]) for r in rounds] == [
        ("NS-AC-02", "SIGNED_OFF", "EFFECTIVE", "CLOSED", "PASSED"),
        ("NS-CM-01", "SIGNED_OFF", "EFFECTIVE", "CLOSED", "PASSED"),
    ]
    for (
        _ref,
        _,
        _,
        _,
        test_from,
        window_start,
        _,
        _,
        remediated_on,
        sheet_by,
        review_by,
        _,
    ) in rounds:
        # Retest dates are valid in the scenario: the fix in October 2027, the retest
        # window from it, the test start before the scenario date.
        assert remediated_on in (RD.TERMINATION_FIX_ON, RD.CHANGE_FIX_ON)
        assert window_start == remediated_on and remediated_on < test_from <= RD.SCENARIO_AS_OF
        assert sheet_by == morgan and review_by == riley
    # The retest items cite the round's own files, every PASS supported.
    for _ref, *_rest, sheet_id in rounds:
        items = _rows(
            url, "SELECT i.results, i.source FROM test_items i WHERE i.test_sheet_id = %s", sheet_id
        )
        assert items and all(i[1] == "SEEDED" for i in items)
        files = {
            str(f[0]): str(f[1])
            for f in _rows(
                url,
                "SELECT f.id, a.extracted_text FROM evidence_files f JOIN evidence_analyses a ON a.evidence_file_id = f.id WHERE f.project_id = %s",
                project_id,
            )
        }
        assert files
        for results, _ in items:
            for result in results:
                assert result["result"] in ("PASS", "NOT_APPLICABLE"), result
                if result["result"] == "PASS":
                    assert any(
                        c["found"] and find_quote(files[c["file_id"]], c["quote"]) is not None
                        for c in result["citations"]
                    )
    # The original interim exceptions are untouched, and their sheets still signed.
    originals = _rows(
        url,
        "SELECT count(*) FROM test_items i JOIN test_sheets s ON s.id = i.test_sheet_id JOIN engagement_controls c ON c.id = s.engagement_control_id, "
        "jsonb_array_elements(i.results) r WHERE s.project_id = %s AND s.test_round_id IS NULL AND c.control_ref IN ('NS-AC-02', 'NS-CM-01') AND r->>'result' = 'EXCEPTION'",
        project_id,
    )
    assert originals == [(7,)]
    assert _rows(
        url,
        "SELECT count(*) FROM test_sheets s JOIN engagement_controls c ON c.id = s.engagement_control_id WHERE s.project_id = %s AND s.test_round_id IS NULL AND c.control_ref IN ('NS-AC-02', 'NS-CM-01') AND s.status = 'SIGNED_OFF' AND s.conclusion = 'NOT_EFFECTIVE'",
        project_id,
    ) == [(2,)]
    # Closure was the lead's request and the reviewer's decision, on the record.
    assert _rows(
        url,
        "SELECT actor_user_id, count(*) FROM audit_events WHERE project_id = %s AND action = 'deficiency.change_decided' GROUP BY 1",
        project_id,
    ) == [(riley, 4)]
    assert (
        _rows(
            url,
            "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'deficiency.change_requested' AND actor_user_id = %s",
            project_id,
            dana,
        )[0][0]
        >= 2
    )
    assert (
        _rows(
            url,
            "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'testing.round_started'",
            project_id,
        )[0][0]
        >= 9
    )


def test_one_control_is_final_and_reviewer_independence_holds_on_every_round(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    riley, morgan = _team(demo, "Riley Okafor"), _team(demo, "Morgan Lee")
    final = _rows(
        url,
        """
        SELECT t.kind, t.status, t.conclusion, s.signed_by, r.signed_by
        FROM test_rounds t JOIN engagement_controls c ON c.id = t.engagement_control_id
        JOIN test_sheets s ON s.test_round_id = t.id JOIN control_reviews r ON r.test_round_id = t.id
        WHERE t.project_id = %s AND c.control_ref = 'NS-AC-01'
        """,
        project_id,
    )
    assert final == [("ROLLFORWARD", "SIGNED_OFF", "EFFECTIVE", morgan, riley)]
    assert _rows(
        url,
        "SELECT count(*) FROM test_rounds t JOIN engagement_controls c ON c.id = t.engagement_control_id WHERE t.project_id = %s AND c.control_ref = 'NS-AC-01' AND t.status IN ('REQUESTED', 'TESTING')",
        project_id,
    ) == [(0,)]
    # Every signed review, interim or round, is the reviewer's; every signed sheet the tester's.
    assert _rows(
        url,
        "SELECT DISTINCT signed_by FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
        project_id,
    ) == [(riley,)]
    assert _rows(
        url,
        "SELECT DISTINCT signed_by FROM test_sheets WHERE project_id = %s AND status = 'SIGNED_OFF'",
        project_id,
    ) == [(morgan,)]
    assert _rows(
        url,
        "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF'",
        project_id,
    ) == [(13,)]
    assert _rows(
        url,
        "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'OPEN'",
        project_id,
    ) == [(3,)]
    # The engagement card and the control register agree.
    listed = next(
        p
        for p in demo["client"].get(f"/organizations/{demo['organization_id']}/projects").json()
        if p["id"] == str(project_id)
    )
    assert listed["open_deficiencies"] == 4


# 8-9. Evidence: design assessments and what stays open on purpose


def test_design_evidence_supports_the_design_assessments_and_open_items_are_intentional(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    morgan = _team(demo, "Morgan Lee")
    design = _rows(
        url,
        """
        SELECT q.sufficiency, count(*) FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE r.project_id = %s AND q.phase = 'DESIGN' AND q.status NOT IN ('WAIVED', 'REMOVED') GROUP BY 1
        """,
        project_id,
    )
    assert design == [("ACCEPTED", 27)]
    memos = _rows(
        url,
        "SELECT count(*) FROM evidence_files WHERE project_id = %s AND folder_path = 'Design/Walkthroughs'",
        project_id,
    )
    assert memos[0][0] >= 13  # a control whose design request had nothing open gets no memo
    assert (
        _rows(
            url,
            "SELECT count(*) FROM workpapers WHERE project_id = %s AND stage = 'DESIGN' AND status = 'PREPARED' AND prepared_by = %s",
            project_id,
            morgan,
        )[0][0]
        == 14
    )  # every control's design workpaper is prepared, the returned one re-prepared
    # Every requirement is in one of the workflow's own states, each for a reason.
    states = _rows(
        url,
        """
        SELECT q.phase, q.sufficiency, c.control_ref, q.title
        FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
        JOIN engagement_controls c ON c.id = r.engagement_control_id
        WHERE r.project_id = %s AND q.status NOT IN ('WAIVED', 'REMOVED')
        """,
        project_id,
    )
    counts: dict[str, int] = {}
    for phase, sufficiency, ref, _title in states:
        if phase == "ROLLFORWARD" and sufficiency != "ACCEPTED":
            kind = "future_phase"
        elif sufficiency == "ACCEPTED":
            kind = "accepted"
        elif sufficiency == "INSUFFICIENT":
            kind = "insufficient"
        else:
            assert ref in ("NS-AC-06", "NS-OP-02", "NS-AC-03"), (ref, _title)
            kind = "open_by_design"
        counts[kind] = counts.get(kind, 0) + 1
    assert counts == {"accepted": 52, "insufficient": 1, "open_by_design": 3, "future_phase": 8}
    assert counts["accepted"] + counts["insufficient"] + counts["open_by_design"] + counts[
        "future_phase"
    ] == len(states)
    # Nothing unsupported is accepted: every accepted item has a file on its request or linked.
    unsupported = _rows(
        url,
        """
        SELECT count(*) FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE r.project_id = %s AND q.sufficiency = 'ACCEPTED'
          AND NOT EXISTS (SELECT 1 FROM evidence_matches m WHERE m.requirement_id = q.id)
          AND NOT EXISTS (SELECT 1 FROM evidence_requirement_files f WHERE f.requirement_id = q.id AND f.status = 'LINKED')
          AND NOT EXISTS (SELECT 1 FROM evidence_matches m WHERE m.pbc_request_id = q.pbc_request_id)
        """,
        project_id,
    )
    assert unsupported == [(0,)]


# 10. Reporting


def test_the_reports_reconcile_to_the_records(demo: dict[str, Any]) -> None:
    from ai_workforce_api import reports

    url, project_id, organization_id = demo["url"], demo["project_id"], demo["organization_id"]
    exports = _rows(
        url,
        "SELECT dataset, file_format, object_key FROM engagement_exports WHERE project_id = %s ORDER BY 1",
        project_id,
    )
    assert [(e[0], e[1]) for e in exports] == [
        ("control_summary", "docx"),
        ("exceptions_report", "pdf"),
        ("executive_summary", "docx"),
        ("status_report", "pdf"),
    ]
    # The engine rebuilds the same figures from the records now.
    with connect(url) as connection:
        built = reports.build(
            connection,
            Principal(PrincipalKind.USER, demo["user_id"]),
            organization_id,
            project_id,
            "status_report",
            {},
            "test",
        )
    assert built.engagement and built.client == "Northstar Technologies, Inc."
    titles = [section.title.lower() for section in built.sections]
    assert any("deficienc" in t for t in titles) and any("review" in t for t in titles)
    open_deficiencies = _rows(
        url,
        "SELECT count(*) FROM deficiencies WHERE project_id = %s AND status <> 'CLOSED'",
        project_id,
    )[0][0]
    assert open_deficiencies == 4
    # The stored report downloads through the ordinary route and is the same engine's output.
    export_id = _rows(
        url,
        "SELECT id FROM engagement_exports WHERE project_id = %s AND dataset = 'status_report'",
        project_id,
    )[0][0]
    fetched = demo["client"].get(
        f"/organizations/{organization_id}/projects/{project_id}/exports/{export_id}"
    )
    assert fetched.status_code == 200 and fetched.content[:4] == b"%PDF"


def test_reporting_reads_the_current_result_and_keeps_the_original_outcome(
    demo: dict[str, Any],
) -> None:
    """Rulebook v1.1: a control remediated and retested effective is no longer failed, its
    interim failure stays visible, its closed deficiency counts as logged, and a reviewed
    control waiting on roll-forward evidence is told apart from one awaiting review."""
    from ai_workforce_api import engagement_data, reports

    url, project_id, organization_id = demo["url"], demo["project_id"], demo["organization_id"]
    principal = Principal(PrincipalKind.USER, demo["user_id"])
    with connect(url) as connection:
        status = engagement_data.status(connection, principal, organization_id, project_id)
        listed = engagement_data.controls(
            connection, principal, organization_id, project_id,
            engagement_data.ControlFilters(), limit=None,
        )  # fmt: skip
        built = reports.build(
            connection, principal, organization_id, project_id, "status_report", {}, "test"
        )
    rows = {row["control_ref"].split(" ")[0]: row for row in listed["controls"]}
    for ref in ("NS-AC-02", "NS-CM-01"):
        row = rows[ref]
        assert row["test_result"] == "NOT_EFFECTIVE", ref  # the original outcome stands
        assert row["current_result"] == "EFFECTIVE" and row["current_result_basis"] == "Retest 1"
        assert row["retested"] and not row["failed"] and row["testing_status"] == "complete"
        assert row["open_deficiencies"] == 0 and row["closed_deficiencies"] == 1
        assert row["deficiencies_logged"] == 1
    # A failed control whose deficiency is still open stays failed, with the interim basis.
    assert rows["NS-AC-03"]["failed"] and rows["NS-AC-03"]["current_result"] == "NOT_EFFECTIVE"
    assert rows["NS-AC-03"]["current_result_basis"] == "Interim"
    # The roll-forward of NS-AC-01 is the current result, and the control is complete.
    assert rows["NS-AC-01"]["current_result_basis"] == "Roll-forward 1"
    assert rows["NS-AC-01"]["testing_status"] == "complete"
    # Every failed control has a deficiency logged, open or closed: the check is silent.
    assert "failed_without_deficiency" not in {c["check"] for c in listed["data_quality"]}
    assert status["exceptions"]["failed_tests_without_deficiency"] == 0
    # Four controls still fail on their current result; the two retested ones do not.
    assert status["controls"]["failed"] == 4
    assert status["controls"]["interim_failed"] == 6
    assert status["controls"]["retested_effective"] == 2
    by_status = status["controls"]["by_testing_status"]
    assert by_status["complete"] == 5
    assert by_status["awaiting_rollforward"] == 5 and by_status["awaiting_review"] == 3
    assert by_status["in_testing"] == 1 and sum(by_status.values()) == 14
    assert status["review"]["controls_awaiting_rollforward"] == 5
    # Closed deficiencies are counted and listed, never dropped.
    assert status["exceptions"]["open_deficiencies"] == 4
    assert status["exceptions"]["closed_deficiencies"] == 2
    passed = _rows(
        url,
        "SELECT count(*) FROM deficiencies WHERE project_id = %s AND status IN ('REMEDIATED', 'CLOSED') AND retest_result = 'PASSED'",
        project_id,
    )[0][0]
    assert status["exceptions"]["remediated_and_retested"] == passed
    titles = [section.title for section in built.sections]
    assert "Closed deficiencies and remediation outcomes" in titles
    closed = next(s for s in built.sections if s.title.startswith("Closed deficiencies"))
    assert closed.tables[0].total == 2
    assert {row[0].split(":")[0] for row in closed.tables[0].rows} == {"D-001", "D-003"}
    table = next(s for s in built.sections if s.title == "Control testing progress").tables[0]
    words = {row[0]: row[1] for row in table.rows}
    assert words["Awaiting roll-forward evidence"] == "5"
    assert words["Remediated and retested effective"] == "2"
    assert words["Interim result not effective (original outcome)"] == "6"
    # Evidence requirements: exclusive states that add up, and the phase as a second dimension.
    requirements = status["evidence"]["requirements"]
    states = requirements["by_state"]
    assert sum(states.values()) == requirements["total"] > 0
    # The three items kept open on purpose read as the records hold them: one on a request
    # that went out, two on interim requests still drafted.
    assert states["accepted"] == 52 and states["insufficient"] == 1 and states["outstanding"] == 1
    assert states["received_not_reviewed"] == 0 and states["waived"] == 0
    assert requirements["by_phase"]["INTERIM"]["not_yet_requested"] == 2
    assert sum(sum(c.values()) for c in requirements["by_phase"].values()) == requirements["total"]
    assert requirements["by_phase"]["ROLLFORWARD"]["accepted"] == 1
    assert status["evidence"]["future_phase"] > 0
    # Roll-forward requests not yet sent no longer read as evidence outstanding on a
    # concluded control.
    outstanding = next(
        (c for c in status["data_quality"] if c["check"] == "concluded_with_pending_evidence"),
        None,
    )
    assert outstanding is None or "NS-AC-02" not in outstanding["examples"]
    assert (
        status["rules"]
        == engagement_data.RULES_VERSION
        == "Metrics rulebook v1.1, pending approval"
    )


# 11-12. Idempotent, and no model


def test_the_closure_is_idempotent_and_called_no_model(demo: dict[str, Any]) -> None:
    url, project_id, organization_id = demo["url"], demo["project_id"], demo["organization_id"]
    before = _rows(url, "SELECT count(*) FROM test_rounds WHERE project_id = %s", project_id)
    again = demo["client"].post(f"/organizations/{organization_id}/demo/initialize")
    assert (
        again.status_code == 200
        and again.json()["state"] == "READY"
        and again.json()["dataset_complete"] is True
    )
    assert (
        _rows(url, "SELECT count(*) FROM test_rounds WHERE project_id = %s", project_id) == before
    )
    assert _rows(
        url, "SELECT count(*) FROM engagement_exports WHERE project_id = %s", project_id
    ) == [(4,)]
    assert _rows(url, "SELECT count(*) FROM model_calls WHERE project_id = %s", project_id) == [
        (0,)
    ]
    assert _rows(
        url,
        "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
        organization_id,
    ) == [(0,)]
    built = _rows(
        url,
        "SELECT payload FROM audit_events WHERE project_id = %s AND action = 'demo.dataset_built'",
        project_id,
    )[0][0]
    assert built["lifecycle"]["closure"]["acceptance"] == []
