class Database:
    """Connection target for one temporary database. The URL is omitted from repr."""

    def __init__(self, url: str) -> None:
        self.url = url

    def __repr__(self) -> str:
        return "Database(<redacted>)"


def release_interim(database: Database, project_id: object) -> None:
    """Release the interim phase of every control whose plan is approved, as a reviewer may
    before design testing is complete (phase_release.py: early, with the reason recorded).
    Tests of what follows the release use it; tests of the release itself do not."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import PlanState
    from ai_workforce_api.phase_release import ReleaseBody, release

    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT p.organization_id, p.engagement_control_id, j.owner_user_id
            FROM evidence_plans p JOIN projects j ON j.id = p.project_id
            WHERE p.project_id = %s AND p.status IN ('APPROVED', 'CHANGES_PROPOSED')
            """,
            (project_id,),
        ).fetchall()
        for organization, control, owner in rows:
            try:
                release(
                    connection, organization, UUID(str(project_id)), control, "INTERIM",
                    owner, ReleaseBody(reason="Released early in the test setup: design "
                                       "testing is not part of what this test covers."),
                )  # fmt: skip
            except PlanState:
                continue


def approve_evidence_plans(
    database: Database, project_id: object, settle: bool = True, release: bool = True
) -> list[object]:
    """Approve every launched control's evidence plan that still waits for a person, as the
    engagement's owner would, and request what the planning gate then allows for every
    control (evidence_plans.release), as settling the attributes does in the app. Returns
    the drafts queued, which the test runs or schedules."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import PlanState, VersionBody, approve
    from ai_workforce_api.evidence_plans import release as release_requests

    if settle:
        settle_attributes(database, project_id)
    queued: list[object] = []
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT p.organization_id, p.engagement_control_id, p.version, j.owner_user_id,
                   p.status
            FROM evidence_plans p JOIN projects j ON j.id = p.project_id
            WHERE p.project_id = %s
            ORDER BY p.created_at
            """,
            (project_id,),
        ).fetchall()
        for organization, control, version, owner, status in rows:
            if status == "PROPOSED":
                try:
                    approve(
                        connection, organization, UUID(str(project_id)), control, owner,
                        VersionBody(version=version),
                    )  # fmt: skip
                except PlanState:
                    # Approving the plan approves the attributes with it (master test plans):
                    # a plan whose attributes are left unsettled waits, as it does in the app.
                    continue
            queued += release_requests(
                connection, organization, UUID(str(project_id)), control, owner
            )
    if release:
        release_interim(database, project_id)
    return queued


def approve_plans_over_api(client: object, organization_id: object, project_id: object) -> int:
    """Approve each in-scope control's proposed evidence plan through the API, as a person
    does on the control, which releases its requests and hands their drafts to the
    background. Returns how many plans were approved."""
    settings = client.app.state.settings  # type: ignore[attr-defined]
    settle_attributes(Database(settings.database_url), project_id)
    base = f"/organizations/{organization_id}/projects/{project_id}"
    approved = 0
    rows = client.get(f"{base}/workspace/controls").json()  # type: ignore[attr-defined]
    for row in rows:
        if not row.get("included"):
            continue
        plan = client.get(f"{base}/controls/{row['id']}/evidence-plan")  # type: ignore[attr-defined]
        if plan.status_code != 200 or plan.json().get("status") != "PROPOSED":
            continue
        done = client.post(  # type: ignore[attr-defined]
            f"{base}/controls/{row['id']}/evidence-plan/approve",
            json={"version": plan.json()["version"]},
        )
        assert done.status_code == 200, done.text
        approved += 1
    # Request what an approved plan and the settled attributes now allow, through the
    # route that hands the drafts to the background.
    released = client.post(f"{base}/evidence-plans/plan-missing")  # type: ignore[attr-defined]
    assert released.status_code == 200, released.text
    release_interim(Database(settings.database_url), project_id)
    return approved


def settle_attributes(database: Database, project_id: object) -> None:
    """Decide every control's proposed attributes (approve, else reject) and resolve its
    open attribute and source conflicts, as the engagement's owner would: operating
    evidence is requested only once a control's attributes are settled."""
    from uuid import UUID

    from ai_workforce_api.control_attributes import AttributeDecision, decide
    from ai_workforce_api.db import connect

    with connect(database.url) as connection:
        owner_row = connection.execute(
            "SELECT organization_id, owner_user_id FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        assert owner_row is not None
        organization, owner = owner_row
        for attribute, control, version in connection.execute(
            """
            SELECT a.id, a.engagement_control_id, a.version FROM control_attributes a
            WHERE a.project_id = %s AND a.status = 'PROPOSED' ORDER BY a.created_at
            """,
            (project_id,),
        ).fetchall():
            for decision in ("APPROVE", "REJECT"):
                try:
                    decide(
                        connection, organization, UUID(str(project_id)), control, attribute,
                        owner, AttributeDecision(decision=decision, version=version),
                    )  # fmt: skip
                    break
                except Exception:
                    connection.rollback()
        connection.execute(
            """
            UPDATE control_context_issues
            SET status = 'RESOLVED', resolution_note = 'Settled for the test.',
                resolved_by = %s, resolved_at = clock_timestamp(), version = version + 1
            WHERE engagement_control_id IN (SELECT id FROM engagement_controls
                                            WHERE project_id = %s)
              AND status = 'OPEN' AND origin IN ('ATTRIBUTES', 'SOURCES')
            """,
            (owner, project_id),
        )
        connection.commit()


def approve_control_plan(database: Database, control_id: object) -> list[object]:
    """Approve one control's proposed evidence plan as the engagement's owner, and request
    what the planning gate allows. Its attributes are left as they are."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import VersionBody, approve, release

    with connect(database.url) as connection:
        row = connection.execute(
            """
            SELECT p.organization_id, p.project_id, p.version, j.owner_user_id, p.status
            FROM evidence_plans p JOIN projects j ON j.id = p.project_id
            WHERE p.engagement_control_id = %s
            """,
            (control_id,),
        ).fetchone()
        if row is None:
            return []
        organization, project, version, owner, status = row
        control = UUID(str(control_id))
        if status == "PROPOSED":
            approve(connection, organization, project, control, owner, VersionBody(version=version))
        return list(release(connection, organization, project, control, owner))
