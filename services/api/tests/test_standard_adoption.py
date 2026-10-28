"""Client controls following the firm's standards, decided together (decided by the product
owner on 25 October 2026). The rules match an imported RCM's controls to the standards; a
person confirms the strong matches as one grouped decision, and each control's plan then
follows its standard's procedures."""

from typing import Any
from uuid import UUID, uuid4

from support import Database
from test_execution import _add_user
from test_library_matching import _seed_control
from test_onboarding import _base, _new_engagement
from test_outbound import _session, _team, migrated
from test_rcm_uploads import CLIENT_RCM, _upload

from ai_workforce_api.db import connect

__all__ = ["migrated"]


def _unrelated(database: Database, seeded: dict[str, Any], project_id: UUID) -> UUID:
    """A client control no standard describes."""
    with connect(database.url) as connection:
        row = connection.execute(
            """
            INSERT INTO engagement_controls (
                organization_id, project_id, library_key, library_version, control_ref, domain,
                title, risk, activity, frequency, nature, test_attributes, pbc_items, agent_key,
                template_key, source, implementation_key
            )
            VALUES (%s, %s, '', 0, 'X-99', 'TREASURY', 'Hedge designations are reviewed',
                    'Hedges are misstated.',
                    'Quarterly, Treasury reviews each hedge relationship designation memo and '
                    'the effectiveness assessment prepared under ASC 815 before the hedge '
                    'accounting entries are recorded.',
                    'QUARTERLY', 'MANUAL', '["Done"]', '[]', 'itgc-access', 'itgc', 'MANUAL',
                    'x-99')
            RETURNING id
            """,
            (seeded["organization_id"], project_id),
        ).fetchone()
        connection.commit()
    assert row is not None
    return UUID(str(row[0]))


def _finalized(database: Database, project_id: UUID) -> None:
    with connect(database.url) as connection:
        connection.execute(
            """
            INSERT INTO engagement_settings (organization_id, project_id, scope_finalized_at)
            SELECT organization_id, id, clock_timestamp() FROM projects WHERE id = %s
            ON CONFLICT (project_id) DO UPDATE SET scope_finalized_at = clock_timestamp()
            """,
            (project_id,),
        )
        connection.commit()


def test_strong_matches_are_followed_together_and_planned_from_the_standard(
    migrated: Database,
) -> None:
    seeded, project_id, owner, _admin = _team(migrated, "adopt")
    leavers = _seed_control(migrated, seeded, project_id)
    unrelated = _unrelated(migrated, seeded, project_id)
    _finalized(migrated, project_id)
    base = f"/organizations/{seeded['organization_id']}/projects/{project_id}/standards"
    before = owner.get(f"{base}/matches").json()
    assert before["unmatched"] == 2 and before["strong"] == []

    matched = owner.post(f"{base}/match")
    assert matched.status_code == 200, matched.text
    body = matched.json()
    assert [item["control_id"] for item in body["strong"]] == [str(leavers)]
    assert body["strong"][0]["standard_ref"] == "ITGC-AC-02"
    assert body["unmatched"] == 0 and body["none"] + body["partial"] == 1

    # Only strong matches are decided together: one that is not refuses the whole decision.
    refused = owner.post(f"{base}/adopt", json={"control_ids": [str(leavers), str(unrelated)]})
    assert refused.status_code == 409
    with connect(migrated.url) as connection:
        undecided = connection.execute(
            "SELECT count(*) FROM engagement_controls WHERE id = ANY(%s) AND test_basis IS NULL",
            ([leavers, unrelated],),
        ).fetchone()
    assert undecided == (2,)

    adopted = owner.post(f"{base}/adopt", json={"control_ids": [str(leavers)]})
    assert adopted.status_code == 200, adopted.text
    assert adopted.json() == {"adopted": 1, "replanned": True}
    with connect(migrated.url) as connection:
        control = connection.execute(
            "SELECT test_basis, library_key, test_basis_by FROM engagement_controls WHERE id = %s",
            (leavers,),
        ).fetchone()
        design = connection.execute(
            "SELECT text FROM plan_procedures WHERE engagement_control_id = %s "
            "AND status = 'ACTIVE' AND phase = 'DESIGN' ORDER BY position LIMIT 1",
            (leavers,),
        ).fetchone()
        audit = connection.execute(
            "SELECT payload FROM audit_events WHERE action = 'library.adopted_together' "
            "AND project_id = %s",
            (project_id,),
        ).fetchone()
    # A person's decision: the standard, with its procedures in the plan.
    assert control == ("STANDARD", "access-termination", seeded["user_id"])
    assert design is not None and design[0].startswith("Read the access policy's removal period")
    assert audit is not None and audit[0]["controls"] == [str(leavers)]
    # Decided, it leaves the list; the unrelated control stays the client's.
    after = owner.get(f"{base}/matches").json()
    assert after["strong"] == [] and after["none"] + after["partial"] == 1


def test_before_the_scope_is_final_nothing_is_planned(migrated: Database) -> None:
    seeded, project_id, owner, _admin = _team(migrated, "adopt-draft")
    leavers = _seed_control(migrated, seeded, project_id)
    base = f"/organizations/{seeded['organization_id']}/projects/{project_id}/standards"
    owner.post(f"{base}/match")
    adopted = owner.post(f"{base}/adopt", json={"control_ids": [str(leavers)]})
    assert adopted.status_code == 200, adopted.text
    assert adopted.json() == {"adopted": 1, "replanned": False}
    with connect(migrated.url) as connection:
        plans = connection.execute(
            "SELECT count(*) FROM evidence_plans WHERE engagement_control_id = %s", (leavers,)
        ).fetchone()
        basis = connection.execute(
            "SELECT test_basis FROM engagement_controls WHERE id = %s", (leavers,)
        ).fetchone()
    assert plans == (0,) and basis == ("STANDARD",)


def test_only_a_person_who_updates_the_engagement_decides(migrated: Database) -> None:
    seeded, project_id, owner, _admin = _team(migrated, "adopt-access")
    leavers = _seed_control(migrated, seeded, project_id)
    base = f"/organizations/{seeded['organization_id']}/projects/{project_id}/standards"
    owner.post(f"{base}/match")
    with connect(migrated.url) as connection:
        reader = _add_user(
            connection, seeded["organization_id"], f"c-{uuid4().hex[:6]}@example.com", "CONTRIBUTOR"
        )
        connection.execute(
            "INSERT INTO project_memberships (organization_id, project_id, user_id) "
            "VALUES (%s, %s, %s)",
            (seeded["organization_id"], project_id, reader),
        )
        connection.commit()
    contributor = _session(migrated, reader)
    assert contributor.get(f"{base}/matches").status_code == 200
    assert contributor.post(f"{base}/adopt", json={"control_ids": [str(leavers)]}).status_code in (
        403,
        404,
    )
    assert contributor.post(f"{base}/match").status_code in (403, 404)


def test_an_imported_rcm_is_matched_to_the_standards_at_once(migrated: Database) -> None:
    team = _new_engagement(migrated, "adopt-import")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    uploaded = _upload(owner, base, CLIENT_RCM)
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    with connect(migrated.url) as connection:
        counts = connection.execute(
            """
            SELECT count(*), count(r.id)
            FROM engagement_controls c
            LEFT JOIN library_match_runs r ON r.engagement_control_id = c.id
            WHERE c.project_id = %s AND c.source = 'UPLOAD' AND c.included
            """,
            (project,),
        ).fetchone()
    assert counts is not None and counts[0] > 0 and counts[0] == counts[1]
    matches = owner.get(f"/organizations/{org}/projects/{project}/standards/matches").json()
    assert matches["unmatched"] == 0


def test_loading_the_library_over_a_matched_upload_replaces_it(migrated: Database) -> None:
    # The matches proposed for an upload's controls go with them when the library replaces
    # the upload before kickoff (found by the critical run on 25 October 2026).
    team = _new_engagement(migrated, "adopt-replace")
    owner, org, project = team["owner"], team["org"], team["project"]
    base = _base(org, project)
    uploaded = _upload(owner, base, CLIENT_RCM)
    imported = owner.post(
        f"{base}/rcm/uploads/{uploaded['id']}/import", json={"version": uploaded["version"]}
    )
    assert imported.status_code == 200, imported.text
    loaded = owner.post(f"{base}/controls/load-library")
    assert loaded.status_code == 200, loaded.text
    with connect(migrated.url) as connection:
        left = connection.execute(
            "SELECT count(*) FROM library_match_runs WHERE project_id = %s", (project,)
        ).fetchone()
    assert left == (0,)
