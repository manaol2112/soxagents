"""The Northstar audit lifecycle (Step 4B; migration 0130, demo_northstar/lifecycle.py):
the demo's own people, who never sign in and never leave the demo; the plans approved
through the planning service with their criteria accepted; the requests, receipts and a
person's acceptance of the evidence; the samples drawn from the population files; the
results cited from the files' own words; the sheets signed by the tester and the reviews
by an independent reviewer; the deficiencies and the two remediation scenarios; and the
dashboard figures reconciling to the records."""

# ruff: noqa: E501  (the queries and assertions read as sentences)
from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from northstar_manifest import expectations, outcome_by_control
from support import Database
from test_google import FakeProvider
from test_northstar import _rows, _start
from test_outbound import migrated
from test_subscriptions import _project, _settings, _sign_in

from ai_workforce_api.authorization import (
    AccessDenied,
    Action,
    NotVisible,
    Principal,
    PrincipalKind,
    authorize,
)
from ai_workforce_api.console_citations import find_quote
from ai_workforce_api.db import connect
from ai_workforce_api.demo_northstar import records as R
from ai_workforce_api.identity import Identity
from ai_workforce_api.main import create_app

__all__ = ["migrated"]


_BUILT: dict[str, dict[str, Any]] = {}


@pytest.fixture
def demo(migrated: Database) -> dict[str, Any]:
    """One built demo per database: the build is deterministic, and a dozen tests read
    the same records (the database fixture is function-scoped, so the build is cached
    by its URL)."""
    if migrated.url in _BUILT:
        return _BUILT[migrated.url]
    client, organization_id, user_id, project_id = _start(migrated)
    team = {
        str(row[0]): UUID(str(row[1]))
        for row in _rows(
            migrated.url,
            "SELECT display_name, id FROM users WHERE demo_organization_id = %s",
            organization_id,
        )
    }
    controls = {
        str(row[0]): UUID(str(row[1]))
        for row in _rows(
            migrated.url,
            "SELECT control_ref, id FROM engagement_controls WHERE project_id = %s",
            project_id,
        )
    }
    _BUILT[migrated.url] = {
        "client": client,
        "organization_id": organization_id,
        "user_id": user_id,
        "project_id": project_id,
        "team": team,
        "controls": controls,
        "url": migrated.url,
    }
    return _BUILT[migrated.url]


def _team(demo: dict[str, Any], name: str) -> UUID:
    person = demo["team"][name]
    assert isinstance(person, UUID)
    return person


# 1-3. The demo's people


def test_demo_personnel_exist_only_for_the_demo_and_never_sign_in(
    migrated: Database, demo: dict[str, Any]
) -> None:
    url, organization_id, project_id = demo["url"], demo["organization_id"], demo["project_id"]
    assert set(demo["team"]) == {"Dana Whitfield", "Riley Okafor", "Morgan Lee"}
    dana, riley, morgan = (_team(demo, n) for n in ("Dana Whitfield", "Riley Okafor", "Morgan Lee"))
    roles = _rows(
        url,
        "SELECT u.display_name, pm.engagement_role FROM project_memberships pm JOIN users u ON u.id = pm.user_id "
        "WHERE pm.project_id = %s AND u.demo_organization_id IS NOT NULL ORDER BY 1",
        project_id,
    )
    assert roles == [
        ("Dana Whitfield", "LEAD"),
        ("Morgan Lee", "PREPARER"),
        ("Riley Okafor", "REVIEWER"),
    ]
    # The trial's own person is on the team too, and the trial's member count is still one.
    assert _rows(
        url,
        "SELECT count(*) FROM project_memberships WHERE project_id = %s AND user_id = %s",
        project_id,
        demo["user_id"],
    ) == [(1,)]
    usage = demo["client"].get(f"/organizations/{organization_id}/subscription").json()["usage"]
    assert usage["members"] == 1
    # Not in the firm's member list, not assignable, not invitable.
    listed = demo["client"].get(f"/organizations/{organization_id}/memberships").json()
    assert all(UUID(m["user_id"]) not in (dana, riley, morgan) for m in listed)
    email = str(_rows(url, "SELECT email::text FROM users WHERE id = %s", dana)[0][0])
    invited = demo["client"].post(
        f"/organizations/{organization_id}/invitations", json={"email": email, "role": "REVIEWER"}
    )
    assert invited.status_code in (404, 409, 422), invited.text
    with connect(url) as connection:
        # No session and no login identity, by any path.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (%s, repeat('a', 64), clock_timestamp() + interval '1 hour')",
                (dana,),
            )
        connection.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO user_identities (user_id, issuer, subject) VALUES (%s, 'google', 'sub-dana')",
                (riley,),
            )
        connection.rollback()
        # Not a member of any other firm, not on any real engagement.
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO users (email, display_name, demo_organization_id) VALUES ('forged@firm.example', 'Forged', %s)",
                (organization_id,),
            )
        connection.rollback()
    # Google sign-in with the demo person's address is refused, whatever Google says.
    identity = Identity(
        subject="sub-dana-demo", email=email, issuer="google", display_name="Dana Whitfield"
    )
    stranger = TestClient(
        create_app(_settings(url), None, google_identity_provider=FakeProvider(identity))
    )
    stranger.get("/auth/google/login", follow_redirects=False)
    done = stranger.get(
        "/auth/google/callback?code=good-code&state=google-state", follow_redirects=False
    )
    assert done.status_code != 200 or "aw_session" not in done.cookies, done.text
    assert _rows(url, "SELECT count(*) FROM auth_sessions WHERE user_id = %s", dana) == [(0,)]


def test_demo_personnel_cannot_touch_a_real_engagement(
    migrated: Database, demo: dict[str, Any]
) -> None:
    url, organization_id = demo["url"], demo["organization_id"]
    dana = _team(demo, "Dana Whitfield")
    own = _project(demo["client"], organization_id, demo["user_id"], "sox-fy27-real")
    assert own.status_code == 201, own.text
    real_project = UUID(own.json()["id"])
    with connect(url) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute(
                "INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role) VALUES (%s, %s, %s, 'REVIEWER')",
                (organization_id, real_project, dana),
            )
        connection.rollback()
        principal = Principal(PrincipalKind.USER, dana)
        with pytest.raises(NotVisible):
            authorize(
                connection,
                principal=principal,
                action=Action.PROJECT_READ,
                organization_id=organization_id,
                project_id=real_project,
            )
        with pytest.raises(NotVisible):
            authorize(
                connection,
                principal=principal,
                action=Action.ORGANIZATION_READ,
                organization_id=organization_id,
            )
        # On the demo engagement, the lead acts; the reviewer's firm role carries no approvals.
        authorize(
            connection,
            principal=principal,
            action=Action.PROJECT_UPDATE,
            organization_id=organization_id,
            project_id=demo["project_id"],
        )
        with pytest.raises(AccessDenied):
            authorize(
                connection,
                principal=Principal(PrincipalKind.USER, _team(demo, "Riley Okafor")),
                action=Action.PROJECT_UPDATE,
                organization_id=organization_id,
                project_id=demo["project_id"],
            )


# 4-6. Launch and planning


def test_the_trial_demo_launches_with_approved_plans_and_accepted_criteria(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    assert _rows(url, "SELECT status::text FROM projects WHERE id = %s", project_id) == [
        ("ACTIVE",)
    ]
    plans = _rows(
        url,
        "SELECT status, approved_by, approved_revision = revision, source FROM evidence_plans WHERE project_id = %s",
        project_id,
    )
    assert len(plans) == 14
    assert all(
        p[0] == "APPROVED" and p[1] == _team(demo, "Dana Whitfield") and p[2] is True for p in plans
    )
    assert {p[3] for p in plans} == {"RULES"}  # the planner's rules, honestly so
    # Approval history through the planning service: a version and a decision per plan.
    assert _rows(
        url,
        "SELECT count(*) FROM plan_versions v JOIN evidence_plans p ON p.id = v.plan_id WHERE p.project_id = %s",
        project_id,
    ) == [(14,)]
    assert _rows(
        url,
        "SELECT count(*) FROM plan_decisions d JOIN evidence_plans p ON p.id = d.plan_id WHERE p.project_id = %s AND d.decision = 'APPROVED'",
        project_id,
    ) == [(14,)]
    assert _rows(
        url,
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'evidence_plan.approved'",
        project_id,
    ) == [(14,)]
    # Every attribute carries prepared criteria, accepted by the lead.
    attributes = _rows(
        url,
        "SELECT a.criteria_origin, a.pass_criteria <> '', a.fail_criteria <> '', a.criteria_accepted_by "
        "FROM control_attributes a JOIN engagement_controls c ON c.id = a.engagement_control_id "
        "WHERE c.project_id = %s AND a.status = 'APPROVED'",
        project_id,
    )
    assert len(attributes) == 36
    assert all(a == ("SEEDED", True, True, _team(demo, "Dana Whitfield")) for a in attributes)
    assert _rows(
        url,
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'control_attribute.criteria_accepted'",
        project_id,
    ) == [(36,)]
    assert _rows(
        url,
        "SELECT count(*) FROM phase_releases r JOIN engagement_controls c ON c.id = r.engagement_control_id WHERE c.project_id = %s AND r.phase = 'INTERIM'",
        project_id,
    ) == [(14,)]


# 7-8. Evidence


def test_evidence_requests_map_to_their_controls_and_acceptance_is_a_persons(
    demo: dict[str, Any],
) -> None:
    url, project_id = demo["url"], demo["project_id"]
    requests = _rows(
        url,
        "SELECT r.testing_phase, r.status, c.control_ref FROM pbc_requests r JOIN engagement_controls c ON c.id = r.engagement_control_id "
        "WHERE r.project_id = %s AND r.operation_key LIKE 'plan-%%'",
        project_id,
    )
    refs = {ref for _, _, ref in requests}
    assert refs == set(demo["controls"])
    assert all(phase in ("DESIGN", "INTERIM", "ROLLFORWARD") for phase, _, _ in requests)
    received = [r for r in requests if r[1] in ("RECEIVED", "PARTIALLY_RECEIVED")]
    assert len(received) >= 14 and all(r[0] in ("INTERIM", "DESIGN") for r in received)
    # Every stored copy is filed to a request and a requirement of its own control.
    unfiled = _rows(
        url,
        """
        SELECT count(*) FROM evidence_matches m JOIN evidence_files f ON f.id = m.evidence_file_id
        WHERE f.project_id = %s AND f.folder_path NOT LIKE 'Remediation/%%' AND f.folder_path NOT LIKE 'Design/%%' AND f.folder_path NOT LIKE '%%/Retest' AND f.folder_path NOT LIKE '%%/Roll-forward' AND (m.pbc_request_id IS NULL OR m.requirement_id IS NULL)
        """,
        project_id,
    )
    assert unfiled == [(0,)]
    cross = _rows(
        url,
        """
        SELECT count(*) FROM evidence_matches m JOIN pbc_requests r ON r.id = m.pbc_request_id
        WHERE m.project_id = %s AND r.engagement_control_id <> m.engagement_control_id
        """,
        project_id,
    )
    assert cross == [(0,)]
    # Prepared request drafts say so.
    assert (
        _rows(
            url,
            "SELECT count(*) FROM pbc_drafts WHERE project_id = %s AND status = 'DRAFTED' AND source = 'SEEDED'",
            project_id,
        )[0][0]
        >= 14
    )
    assert _rows(
        url,
        "SELECT count(*) FROM pbc_drafts WHERE project_id = %s AND status = 'PENDING'",
        project_id,
    ) == [(0,)]
    # Acceptance is the tester's decision with its audit event; the stale export is refused;
    # what no file reached stays not reviewed (missing).
    morgan = _team(demo, "Morgan Lee")
    sufficiency = _rows(
        url,
        """
        SELECT q.sufficiency, q.sufficiency_by, count(*) FROM evidence_requirements q JOIN pbc_requests r ON r.id = q.pbc_request_id
        WHERE r.project_id = %s AND r.testing_phase = 'INTERIM' GROUP BY 1, 2 ORDER BY 1
        """,
        project_id,
    )
    by_state = {row[0]: (row[1], int(row[2])) for row in sufficiency}
    assert by_state["ACCEPTED"][0] == morgan and by_state["ACCEPTED"][1] >= 12
    assert by_state["INSUFFICIENT"] == (morgan, 1)
    assert by_state["NOT_REVIEWED"][1] == 3  # open on purpose
    assert (
        _rows(
            url,
            "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'evidence_requirement.sufficiency' AND actor_user_id = %s",
            project_id,
            morgan,
        )[0][0]
        >= 13
    )
    # The web's register distinguishes the states.
    register = demo["client"].get(
        f"/organizations/{demo['organization_id']}/projects/{project_id}/evidence-register"
    )
    assert register.status_code == 200, register.text


# 9-12. Testing


def test_samples_come_from_the_populations_and_results_cite_the_files(demo: dict[str, Any]) -> None:
    url, project_id = demo["url"], demo["project_id"]
    morgan = _team(demo, "Morgan Lee")
    tests = _rows(
        url,
        """
        SELECT c.control_ref, t.status, t.approved_by, f.file_name, t.key_column, t.sample_size,
               (SELECT array_agg(s.key_value ORDER BY s.position) FROM control_test_samples s WHERE s.control_test_id = t.id)
        FROM control_tests t JOIN engagement_controls c ON c.id = t.engagement_control_id
        JOIN evidence_files f ON f.id = t.population_file_id
        WHERE t.project_id = %s AND t.test_round_id IS NULL ORDER BY 1
        """,
        project_id,
    )
    assert len(tests) == 12  # every sampled control; the two automated ones are tested once
    assert all(t[1] == "APPROVED" and t[2] == _team(demo, "Dana Whitfield") for t in tests)
    # Every sampled key is a row of its population file, read as the sampler read it.
    from ai_workforce_api.demo_northstar import files as F
    from ai_workforce_api.evidence_extraction import read_table

    rendered = {f.file_name: f for f in F.render(R.build())}
    for ref, _, _, file_name, key_column, _, keys in tests:
        table = read_table(rendered[file_name].content, file_name, rendered[file_name].content_type)
        assert table is not None
        index = table.columns.index(str(key_column))
        values = {row[index].strip() for row in table.rows}
        assert set(keys) <= values, (ref, set(keys) - values)
    # Every result was written as prepared, and every PASS or EXCEPTION rests on a quote
    # found in the cited file's extracted text.
    items = _rows(
        url,
        """
        SELECT c.control_ref, i.label, i.results, i.source
        FROM test_items i JOIN test_sheets s ON s.id = i.test_sheet_id
        JOIN engagement_controls c ON c.id = s.engagement_control_id
        WHERE s.project_id = %s AND s.test_round_id IS NULL
        """,
        project_id,
    )
    assert items and all(item[3] == "SEEDED" for item in items)
    texts = {
        str(row[0]): str(row[1])
        for row in _rows(
            url,
            "SELECT f.id, a.extracted_text FROM evidence_analyses a JOIN evidence_files f ON f.id = a.evidence_file_id WHERE f.project_id = %s",
            project_id,
        )
    }
    cited = 0
    for _ref, _label, results, _ in items:
        for result in results:
            if result["result"] in ("PASS", "EXCEPTION"):
                assert result["citations"], (_ref, _label, result)
                for citation in result["citations"]:
                    assert citation["found"] is True
                    assert find_quote(texts[citation["file_id"]], citation["quote"]) is not None
                    cited += 1
            if result["result"] == "EXCEPTION":
                assert result["observed"] and result["expected"]
    assert cited > 300
    # The planted exceptions are the items the files condemn, and only those.
    exceptions = {
        (str(ref), str(label))
        for ref, label, results, _ in items
        if any(r["result"] == "EXCEPTION" for r in results)
    }
    assert exceptions == {
        ("NS-AC-02", R.LATE_TERMINATION_EMPLOYEE), ("NS-AC-02", R.OPEN_TERMINATION_EMPLOYEE),
        ("NS-AC-03", R.UNAPPROVED_PRIVILEGED_USER),
        ("NS-CM-01", R.UNAPPROVED_TRANSPORT), ("NS-CM-01", R.LATE_APPROVED_TRANSPORT),
        ("NS-OP-02", "TR-0914-01"),
        ("NS-IP-01", "2027-09"),
        ("NS-MR-01", "2027-09"), ("NS-MR-01", "2027-08"),
    }  # fmt: skip
    # Conclusions as the manifest expects; the insufficient one stays open.
    sheets = {
        str(row[0]): (str(row[1]), row[2], row[3])
        for row in _rows(
            url,
            "SELECT c.control_ref, s.status, s.conclusion, s.signed_by FROM test_sheets s JOIN engagement_controls c ON c.id = s.engagement_control_id "
            "WHERE s.project_id = %s AND s.test_round_id IS NULL",
            project_id,
        )
    }
    assert len(sheets) == 14
    for ref, outcome in outcome_by_control().items():
        status, conclusion, signed_by = sheets[ref]
        if outcome == "PASS":
            assert (status, conclusion, signed_by) == ("SIGNED_OFF", "EFFECTIVE", morgan), ref
        elif outcome == "EXCEPTION":
            assert (status, conclusion, signed_by) == ("SIGNED_OFF", "NOT_EFFECTIVE", morgan), ref
        else:
            assert (status, conclusion) == ("OPEN", None), ref
    assert (
        _rows(
            url,
            "SELECT count(*) FROM test_sheet_signoffs s JOIN test_sheets t ON t.id = s.test_sheet_id WHERE t.project_id = %s",
            project_id,
        )[0][0]
        >= 13
    )


# 13. Review independence


def test_reviews_are_signed_by_the_independent_reviewer_only(demo: dict[str, Any]) -> None:
    url, project_id = demo["url"], demo["project_id"]
    riley, morgan = _team(demo, "Riley Okafor"), _team(demo, "Morgan Lee")
    reviews = _rows(
        url,
        """
        SELECT c.control_ref, r.status, r.signed_by, r.reperform_source, t.signed_by
        FROM control_reviews r JOIN engagement_controls c ON c.id = r.engagement_control_id
        JOIN test_sheets t ON t.engagement_control_id = r.engagement_control_id AND t.test_round_id IS NULL
        WHERE r.project_id = %s AND r.test_round_id IS NULL
        """,
        project_id,
    )
    assert len(reviews) == 13
    signed = [r for r in reviews if r[1] == "SIGNED_OFF"]
    pending = [r for r in reviews if r[1] == "OPEN"]
    assert len(signed) == 10 and {r[0] for r in pending} == {"NS-AC-03", "NS-AC-07", "NS-OP-02"}
    assert all(r[2] == riley and r[4] == morgan and r[2] != r[4] for r in signed)
    assert all(r[3] == "SEEDED" for r in reviews)
    # Workpapers prepared by the tester, never by the reviewer; the reviewer's notes raised,
    # answered and cleared, one of them returning the workpaper first.
    prepared = _rows(
        url,
        "SELECT DISTINCT prepared_by FROM workpapers WHERE project_id = %s AND status = 'PREPARED'",
        project_id,
    )
    assert prepared == [(morgan,)]
    notes = _rows(
        url,
        "SELECT n.severity, n.status, n.raised_by_user, n.responded_by, n.cleared_by FROM review_notes n JOIN control_reviews r ON r.id = n.control_review_id WHERE r.project_id = %s ORDER BY n.severity",
        project_id,
    )
    assert len(notes) == 3 and all(
        n[1] == "CLEARED" and n[2] == riley and n[3] == morgan and n[4] == riley for n in notes
    )
    assert (
        _rows(
            url,
            "SELECT count(*) FROM audit_events WHERE project_id = %s AND action = 'workpaper.reopened'",
            project_id,
        )[0][0]
        >= 1
    )
    assert _rows(
        url,
        "SELECT count(*) FROM control_review_signoffs s JOIN control_reviews r ON r.id = s.control_review_id WHERE r.project_id = %s",
        project_id,
    ) == [(13,)]
    # The reviewer cannot sign a review of work they prepared: the service refuses it.
    from ai_workforce_api.control_reviews import ReviewState, SignOffBody, _sign_off

    review_id, version = _rows(
        url,
        "SELECT r.id, r.version FROM control_reviews r JOIN engagement_controls c ON c.id = r.engagement_control_id WHERE r.project_id = %s AND c.control_ref = 'NS-AC-03'",
        project_id,
    )[0]
    with connect(url) as connection:
        with pytest.raises((ReviewState, NotVisible, AccessDenied)):
            _sign_off(
                connection,
                Principal(PrincipalKind.USER, morgan),
                demo["organization_id"],
                project_id,
                UUID(str(review_id)),
                SignOffBody(version=int(version), note="not mine to sign"),
            )
        connection.rollback()


# 14-15. Deficiencies and remediation


def test_deficiencies_and_the_two_remediation_scenarios(demo: dict[str, Any]) -> None:
    url, project_id = demo["url"], demo["project_id"]
    deficiencies = _rows(
        url,
        """
        SELECT d.reference, c.control_ref, d.status, d.severity, d.pending_change IS NOT NULL, d.remediation_owner,
               d.remediation_plan <> '', r.status, d.source
        FROM deficiencies d JOIN engagement_controls c ON c.id = d.engagement_control_id
        LEFT JOIN pbc_requests r ON r.id = d.remediation_request_id
        WHERE d.project_id = %s ORDER BY d.reference
        """,
        project_id,
    )
    by_control = {row[1]: row for row in deficiencies}
    assert set(by_control) == {
        "NS-AC-02",
        "NS-AC-03",
        "NS-CM-01",
        "NS-OP-02",
        "NS-IP-01",
        "NS-MR-01",
    }
    assert all(row[8] == "TESTING" for row in deficiencies)
    for ref in ("NS-AC-02", "NS-CM-01"):
        ref_, _, status, severity, pending, owner, planned, request_status, _ = by_control[ref]
        assert (status, severity, pending, planned) == (
            "CLOSED",
            "SIGNIFICANT_DEFICIENCY",
            False,
            True,
        ), ref_
        assert owner and request_status == "RECEIVED"
    # The reviewer's severity decision was taken for the two, and waits on the third.
    assert by_control["NS-AC-03"][4] is True and by_control["NS-AC-03"][3] == "CONTROL_DEFICIENCY"
    decided = _rows(
        url,
        "SELECT actor_user_id, count(*) FROM audit_events WHERE project_id = %s AND action = 'deficiency.change_decided' GROUP BY 1",
        project_id,
    )
    assert decided == [(_team(demo, "Riley Okafor"), 4)]
    # Management's memo is on the remediation request and read; the original exceptions
    # and the signed sheets are untouched (a logged deficiency's sheet cannot reopen).
    memos = _rows(
        url,
        "SELECT f.file_name, a.status FROM evidence_files f JOIN evidence_analyses a ON a.evidence_file_id = f.id WHERE f.project_id = %s AND f.folder_path LIKE 'Remediation/%%' ORDER BY 1",
        project_id,
    )
    assert memos == [
        ("Remediation_Memo_NS-AC-02_2027-10.docx", "READY"),
        ("Remediation_Memo_NS-CM-01_2027-10.docx", "READY"),
    ]
    original = _rows(
        url,
        "SELECT count(*) FROM test_items i JOIN test_sheets s ON s.id = i.test_sheet_id JOIN engagement_controls c ON c.id = s.engagement_control_id, "
        "jsonb_array_elements(i.results) r WHERE s.project_id = %s AND c.control_ref IN ('NS-AC-02', 'NS-CM-01') AND r->>'result' = 'EXCEPTION'",
        project_id,
    )
    assert original == [(7,)]
    from ai_workforce_api.test_sheets import ReopenBody, change_sheet, reopen_work

    sheet_id, version = _rows(
        url,
        "SELECT s.id, s.version FROM test_sheets s JOIN engagement_controls c ON c.id = s.engagement_control_id WHERE s.project_id = %s AND c.control_ref = 'NS-AC-02' AND s.test_round_id IS NULL",
        project_id,
    )[0]
    with connect(url) as connection:
        with pytest.raises(Exception, match="deficiency|logged|reopen"):
            change_sheet(
                connection,
                Principal(PrincipalKind.USER, _team(demo, "Morgan Lee")),
                demo["organization_id"],
                project_id,
                UUID(str(sheet_id)),
                reopen_work(
                    ReopenBody(version=int(version), reason="try to rewrite the failed result")
                ),
            )
        connection.rollback()
    # The two retests ran in rounds of their own (closure); the other roll-forward
    # rounds the effective interims opened wait for year-end evidence.
    rounds = _rows(
        url,
        "SELECT kind, status, count(*) FROM test_rounds WHERE project_id = %s GROUP BY 1, 2",
        project_id,
    )
    assert sorted(rounds) == [
        ("RETEST", "SIGNED_OFF", 2),
        ("ROLLFORWARD", "REQUESTED", 6),
        ("ROLLFORWARD", "SIGNED_OFF", 1),
    ]


# 16. Reporting reconciles to the records


def test_the_dashboard_figures_derive_from_the_records(demo: dict[str, Any]) -> None:
    url, project_id, organization_id = demo["url"], demo["project_id"], demo["organization_id"]
    base = f"/organizations/{organization_id}/projects/{project_id}"
    dashboard = demo["client"].get(f"{base}/workspace/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    controls, deficiencies, review = body["controls"], body["deficiencies"], body["review"]
    assert controls["in_scope"] == 14
    assert (
        deficiencies["open"]
        == _rows(
            url,
            "SELECT count(*) FROM deficiencies WHERE project_id = %s AND status <> 'CLOSED'",
            project_id,
        )[0][0]
        == 4
    )
    assert (
        deficiencies["awaiting_approval"]
        == _rows(
            url,
            "SELECT count(*) FROM deficiencies WHERE project_id = %s AND pending_change IS NOT NULL",
            project_id,
        )[0][0]
        == 1
    )
    by_severity = deficiencies["by_severity"]
    assert by_severity.get("CONTROL_DEFICIENCY") == 4 and not by_severity.get(
        "SIGNIFICANT_DEFICIENCY"
    )
    # Concluded controls are those whose review is signed; the effective ones among them
    # agree to the signed sheets.
    signed_reviews = _rows(
        url,
        "SELECT count(*) FROM control_reviews WHERE project_id = %s AND status = 'SIGNED_OFF' AND test_round_id IS NULL",
        project_id,
    )[0][0]
    assert signed_reviews == 10
    assert controls["concluded"] <= signed_reviews
    effective_signed = _rows(
        url,
        "SELECT count(*) FROM control_reviews r JOIN test_sheets t ON t.engagement_control_id = r.engagement_control_id AND t.test_round_id IS NULL "
        "WHERE r.project_id = %s AND r.status = 'SIGNED_OFF' AND r.test_round_id IS NULL AND t.conclusion = 'EFFECTIVE'",
        project_id,
    )[0][0]
    # Effective counts the remediated controls too, once their retests are reviewed.
    assert effective_signed <= controls["effective"] <= signed_reviews
    assert (
        controls["exceptions"]
        == _rows(
            url,
            "SELECT count(DISTINCT engagement_control_id) FROM deficiencies WHERE project_id = %s AND status <> 'CLOSED'",
            project_id,
        )[0][0]
    )
    assert isinstance(review, dict) and review
    steps = demo["client"].get(f"{base}/next-steps")
    assert steps.status_code == 200, steps.text
    # The engagement card and the register read the same records.
    listed = next(
        p
        for p in demo["client"].get(f"/organizations/{organization_id}/projects").json()
        if p["id"] == str(project_id)
    )
    assert listed["open_deficiencies"] == 4 and listed["demo"] is True
    # Every control's workpapers can be exported.
    exported = demo["client"].get(
        f"{base}/workpapers/export.xlsx?control_id={demo['controls']['NS-AC-02']}"
    )
    assert exported.status_code == 200 and exported.content[:2] == b"PK"


# 17-19. Safeguards


def test_no_model_call_and_the_same_engagement_again(demo: dict[str, Any]) -> None:
    url, project_id, organization_id = demo["url"], demo["project_id"], demo["organization_id"]
    assert _rows(url, "SELECT count(*) FROM model_calls WHERE project_id = %s", project_id) == [
        (0,)
    ]
    assert _rows(
        url,
        "SELECT count(*) FROM model_call_reservations WHERE organization_id = %s",
        organization_id,
    ) == [(0,)]
    again = demo["client"].post(f"/organizations/{organization_id}/demo/initialize")
    assert again.status_code == 200 and UUID(again.json()["project_id"]) == project_id
    assert again.json()["dataset_complete"] is True
    assert _rows(
        url, "SELECT count(*) FROM projects WHERE organization_id = %s AND demo", organization_id
    ) == [(1,)]
    assert _rows(url, "SELECT count(*) FROM deficiencies WHERE project_id = %s", project_id) == [
        (6,)
    ]
    for table in (
        "test_sheets",
        "control_reviews",
        "evidence_files",
        "pbc_requests",
        "deficiencies",
        "workpapers",
    ):
        assert _rows(
            url,
            f"SELECT count(*) FROM {table} WHERE project_id = %s AND organization_id <> %s",
            project_id,
            organization_id,
        ) == [(0,)]  # noqa: S608
    # The manifest's expectations are the tests' alone: nothing in the database names them.
    assert _rows(
        url,
        "SELECT count(*) FROM audit_events WHERE project_id = %s AND payload::text ILIKE '%%manifest%%'",
        project_id,
    ) == [(0,)]
    assert expectations()  # the oracle lives in the tests


def test_a_second_sign_in_changes_nothing(migrated: Database, demo: dict[str, Any]) -> None:
    _sign_in(demo["client"])
    body = demo["client"].get(f"/organizations/{demo['organization_id']}/demo").json()
    assert (body["state"], body["invitation"], body["invited"]) == ("READY", "ACCEPTED", False)
