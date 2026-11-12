class Database:
    """Connection target for one temporary database. The URL is omitted from repr."""

    def __init__(self, url: str) -> None:
        self.url = url

    def __repr__(self) -> str:
        return "Database(<redacted>)"


DESIGN_RELEASE_REASON = "Released in the test setup: the D&I release is not what this test covers."


def record_design_release(
    database: Database, project_id: object, controls: list[object] | None = None
) -> list[tuple[object, object, object]]:
    """Record the D&I release of the engagement's planned controls (or those named) as test
    setup: every live D&I request accepted by the engagement's owner, and the release
    recorded as theirs. Returns (organization, control, owner) for each control released
    here, for the caller to request the Design items.

    Rewritten 12 November 2026 (B1f, the D&I requests list; product owner: "Why do I need
    to have the release button? Simplify the workflow."). Old: the setup released D&I early
    through phase_release.release, with a reason, whatever the control's understanding and
    attributes. New: there is no early D&I release; the product releases D&I only once the
    requests list is settled (phase_release.settle_design), which needs the understanding,
    the attributes and their criteria settled first. Tests of what follows the release are
    not about any of that, so the setup records the acceptance and the release directly, as
    sign_off_design records a D&I conclusion; tests of the list and of the release itself
    (test_design_requests.py, test_design_release.py) go through the routes instead. As
    before: a control whose plan run is waiting or working, or whose plan says the D&I
    phase does not apply, is left; one already released is not released twice; and the
    release is on the audit trail (phase.released)."""
    from uuid import UUID

    from ai_workforce_api.db import connect, transaction
    from ai_workforce_api.phase_release import _record_design_release

    released: list[tuple[object, object, object]] = []
    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT p.organization_id, p.engagement_control_id, j.owner_user_id, p.revision
            FROM evidence_plans p
            JOIN projects j ON j.id = p.project_id
            JOIN evidence_plan_phases ph ON ph.plan_id = p.id AND ph.phase = 'DESIGN'
            WHERE p.project_id = %s
              AND (%s::uuid[] IS NULL OR p.engagement_control_id = ANY(%s::uuid[]))
              AND p.run_status NOT IN ('PENDING', 'WORKING')
              AND ph.applicability IN ('APPLICABLE', 'CONDITIONAL')
              AND NOT EXISTS (SELECT 1 FROM phase_releases r
                              WHERE r.engagement_control_id = p.engagement_control_id
                                AND r.phase = 'DESIGN')
            ORDER BY p.created_at
            """,
            (project_id, controls, controls),
        ).fetchall()
        for organization, control, owner, revision in rows:
            with transaction(connection) as cursor:
                cursor.execute(
                    """
                    UPDATE evidence_requirements
                    SET accepted_by = %s, accepted_at = clock_timestamp()
                    WHERE engagement_control_id = %s AND phase = 'DESIGN'
                      AND status IN ('PLANNED', 'AWAITING_DEPENDENCY', 'REQUESTED')
                      AND NOT coalesce((pending_change ->> 'add')::boolean, false)
                      AND accepted_at IS NULL
                    """,
                    (owner, control),
                )
                _record_design_release(
                    cursor, organization, UUID(str(project_id)), control, owner, revision,
                    automatic=False, reason=DESIGN_RELEASE_REASON,
                )  # fmt: skip
            released.append((organization, control, owner))
    return released


def release_design(
    database: Database, project_id: object, controls: list[object] | None = None
) -> list[object]:
    """Release the D&I evidence of the engagement's planned controls (or those named), as the
    engagement's owner would, and request it (phase_release.request_released). D&I evidence
    has its own release since B1 (product owner, 8 November 2026), so tests of what follows it
    use this; tests of the D&I release itself do not. Returns the drafts queued. Since 12
    November 2026 the release is recorded with the requests accepted (record_design_release,
    which says what changed and why)."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.phase_release import request_released

    queued: list[object] = []
    released = record_design_release(database, project_id, controls)
    with connect(database.url) as connection:
        for organization, control, owner in released:
            queued += request_released(
                connection, UUID(str(organization)), UUID(str(project_id)),
                UUID(str(control)), "DESIGN", UUID(str(owner)),
            )  # fmt: skip
    return queued


def understand_and_settle_attributes(
    database: Database, project_id: object, control_id: object
) -> None:
    """Everything the D&I requests list waits for before its requests, for one control, as
    the engagement's owner would do it: its open questions resolved, the client values its
    statement asks recorded, its required walkthrough questions answered (Control
    Understanding complete), and the engagement's proposed attributes decided with
    criteria a person owns (the attributes settled)."""
    from uuid import UUID

    from ai_workforce_api.control_design import ValuesBody, design_for, set_values
    from ai_workforce_api.db import connect

    settle_attributes(database, project_id)
    tailor_criteria(database, project_id)
    control = UUID(str(control_id))
    with connect(database.url) as connection:
        connection.execute(
            "UPDATE control_context_issues SET status = 'RESOLVED', "
            "resolution_note = 'Answered in the walkthrough.', resolved_at = clock_timestamp() "
            "WHERE engagement_control_id = %s AND status = 'OPEN'",
            (control,),
        )
        connection.commit()
        owner_row = connection.execute(
            "SELECT organization_id, owner_user_id FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        assert owner_row is not None
        design = design_for(connection, control)
        assert design is not None
        values = {
            slot.key: slot.options[0] if slot.options else "The IT security manager"
            for slot in design.slots
            if not slot.automatic and not slot.document and not slot.value.strip()
        }
        if values:
            set_values(
                connection, owner_row[0], UUID(str(project_id)), control, owner_row[1],
                ValuesBody(values=values),
            )  # fmt: skip
    answer_walkthrough(database, project_id, [control])


def accept_design_requests(
    client: object, organization_id: object, project_id: object, control_id: object
) -> dict[str, object]:
    """Accept every D&I request of the control that waits for a person, through the API, as
    one decision ("Accept all"). Returns the evidence plan as the route answers it: when the
    acceptance settles the list, the D&I evidence is released in that request (B1f)."""
    base = f"/organizations/{organization_id}/projects/{project_id}/controls/{control_id}"
    plan = client.get(f"{base}/evidence-plan")  # type: ignore[attr-defined]
    assert plan.status_code == 200, plan.text
    items = [
        {"requirement_id": item["id"], "version": item["version"]}
        for phase in plan.json()["phases"]
        for item in phase["requirements"]
        if item["to_accept"]
    ]
    assert items, "no D&I request waits to be accepted"
    accepted = client.post(  # type: ignore[attr-defined]
        f"{base}/design-requests/accept", json={"items": items}
    )
    assert accepted.status_code == 200, accepted.text
    body: dict[str, object] = accepted.json()
    return body


def sign_off_design(
    database: Database, project_id: object, controls: list[object] | None = None
) -> None:
    """Record an effective D&I conclusion for the engagement's controls (or those named), as a
    reviewer signs it once the design workpaper is prepared (design_conclusions.py). OE work
    starts only after it (B0, product owner, 8 November 2026), so tests of what follows D&I
    use it; tests of the D&I conclusion and of the OE gate do not. A design workpaper not yet
    prepared is marked prepared at its current version."""
    from ai_workforce_api.db import connect

    with connect(database.url) as connection:
        rows = connection.execute(
            """
            SELECT c.id, c.organization_id, j.owner_user_id, c.template_key
            FROM engagement_controls c JOIN projects j ON j.id = c.project_id
            WHERE c.project_id = %s AND (%s::uuid[] IS NULL OR c.id = ANY(%s::uuid[]))
            """,
            (project_id, controls, controls),
        ).fetchall()
        for control, organization, owner, template in rows:
            standing = connection.execute(
                "SELECT 1 FROM design_conclusions WHERE engagement_control_id = %s "
                "AND reopened_at IS NULL",
                (control,),
            ).fetchone()
            if standing is not None:
                continue
            # The design workpaper as the service opens and drafts it (no model: its records),
            # so a prepared design workpaper has content, as a person's has.
            from uuid import UUID as _UUID

            from ai_workforce_api.db import transaction
            from ai_workforce_api.workpaper_service import ensure, run_draft

            with transaction(connection) as cursor:
                opened = ensure(
                    cursor, organization, _UUID(str(project_id)), control, owner, ("DESIGN",)
                )
            for paper_id in opened:
                run_draft(connection, None, paper_id)
            paper = connection.execute(
                """
                UPDATE workpapers
                SET status = 'PREPARED', prepared_by = coalesce(prepared_by, requested_by),
                    prepared_at = coalesce(prepared_at, clock_timestamp()),
                    prepared_version = coalesce(prepared_version, greatest(current_version, 1)),
                    draft_status = 'IDLE', started_at = coalesce(started_at, clock_timestamp())
                WHERE project_id = %s AND engagement_control_id = %s AND stage = 'DESIGN'
                RETURNING id, prepared_version
                """,
                (project_id, control),
            ).fetchone()
            if paper is None:
                paper = connection.execute(
                    """
                    INSERT INTO workpapers (
                        organization_id, project_id, engagement_control_id, stage, template_key,
                        status, draft_status, requested_by, prepared_by, prepared_at,
                        prepared_version, started_at
                    )
                    VALUES (%s, %s, %s, 'DESIGN', %s, 'PREPARED', 'IDLE', %s, %s,
                            clock_timestamp(), 1, clock_timestamp())
                    RETURNING id, prepared_version
                    """,
                    (organization, project_id, control, template or "design", owner, owner),
                ).fetchone()
            assert paper is not None
            connection.execute(
                """
                INSERT INTO design_conclusions (
                    organization_id, project_id, engagement_control_id, workpaper_id,
                    workpaper_version, verdict, signed_by, signoff_note
                )
                VALUES (%s, %s, %s, %s, %s, 'EFFECTIVE', %s, 'Signed off in the test setup.')
                """,
                (organization, project_id, control, paper[0], paper[1], owner),
            )


def release_interim(database: Database, project_id: object, design: bool = True) -> None:
    """Release the interim phase of every control whose plan is approved. OE starts only once
    the D&I conclusion is signed off effective (B0), so the setup records that sign-off first
    (sign_off_design). Tests of what follows the release use it; tests of the release itself
    do not."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import PlanState
    from ai_workforce_api.phase_release import ReleaseBody, release

    if design:
        sign_off_design(database, project_id)
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
    database: Database,
    project_id: object,
    settle: bool = True,
    release: bool = True,
    design: bool = True,
    design_release: bool = True,
) -> list[object]:
    """Approve every launched control's evidence plan that still waits for a person, as the
    engagement's owner would, and request what the planning gate then allows for every
    control (evidence_plans.release), as settling the attributes does in the app. Returns
    the drafts queued, which the test runs or schedules. Without design, no D&I conclusion
    is recorded, so nothing of OE is released (B0): for tests of the design work itself.
    Without design_release, the D&I evidence is not released (B1): for tests of that release."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.evidence_plans import PlanState, VersionBody, approve
    from ai_workforce_api.evidence_plans import release as release_requests

    if settle:
        settle_attributes(database, project_id)
    queued: list[object] = release_design(database, project_id) if design_release else []
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
        release_interim(database, project_id, design)
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
        # D&I evidence has its own release (B1). Rewritten 12 November 2026 (B1f). Old: the
        # setup posted an early release, with a reason, to the release route, which handed
        # the drafts to the background. New: there is no early D&I release, so the setup
        # records it (record_design_release), and the Design items are requested, with
        # their drafts handed to the background, by the routes below (the plan's approval
        # and plan-missing, which request what the gate allows). A control not planned
        # yet is skipped, as before.
        record_design_release(Database(settings.database_url), project_id, [row["id"]])
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


WALKTHROUGH_TEXT = "As the control owner described it in the walkthrough."


def walkthrough_value(item: object) -> str:
    """A valid answer to a walkthrough question, as a test gives it: the first option of a
    choice, "No" for a yes-or-no question, a plain sentence otherwise."""
    from ai_workforce_api.walkthrough_questions import Question

    assert isinstance(item, Question)
    if item.kind in ("CHOICE", "MULTI"):
        return item.options[0]
    if item.kind == "YES_NO":
        return "No"
    return WALKTHROUGH_TEXT


def answer_walkthrough(
    database: Database, project_id: object, controls: list[object] | None = None
) -> None:
    """Answer every required walkthrough question asked for the engagement's controls (or
    those named), as the engagement's owner would (walkthrough_answers.save): since 11
    November 2026 Control Understanding is complete only once they are answered. A follow-up
    an answer opens is answered too. Optional questions are left, as a person may."""
    from uuid import UUID

    from ai_workforce_api.db import connect
    from ai_workforce_api.walkthrough_answers import (
        AnswerIn,
        AnswersBody,
        answers_of,
        questions_asked,
        save,
        stands,
    )

    with connect(database.url) as connection:
        owner_row = connection.execute(
            "SELECT organization_id, owner_user_id FROM projects WHERE id = %s", (project_id,)
        ).fetchone()
        assert owner_row is not None
        organization, owner = owner_row
        ids = [
            UUID(str(row[0]))
            for row in connection.execute(
                "SELECT id FROM engagement_controls WHERE project_id = %s "
                "AND (%s::uuid[] IS NULL OR id = ANY(%s::uuid[])) ORDER BY id",
                (project_id, controls, controls),
            ).fetchall()
        ]
        for control in ids:
            # A follow-up appears once its parent is answered: a few rounds settle it.
            for _round in range(5):
                rows = answers_of(connection, control)
                open_items = [
                    item
                    for item in questions_asked(connection, control, rows)
                    if item.required and not stands(rows.get(item.key), item)
                ]
                if not open_items:
                    break
                save(
                    connection, organization, UUID(str(project_id)), control, owner,
                    AnswersBody(answers={
                        item.key: AnswerIn(value=walkthrough_value(item))
                        for item in open_items[:40]
                    }),
                )  # fmt: skip
        connection.commit()


def tailor_criteria(database: Database, project_id: object) -> None:
    """State criteria for every approved attribute whose criteria no person owns yet, as the
    engagement's owner would (11 November 2026): the D&I evidence is a test of one against
    them, so its release waits for them (phase_release.attribute_waits)."""
    from ai_workforce_api.control_attributes import CRITERIA_OWNED_SQL
    from ai_workforce_api.db import connect

    with connect(database.url) as connection:
        connection.execute(
            f"""
            UPDATE control_attributes a
            SET condition = 'As the attribute states, at this client: ' || left(a.text, 200),
                pass_criteria = 'The evidence shows: ' || left(a.text, 200),
                fail_criteria = 'The evidence shows it is not so: ' || left(a.text, 200),
                criteria_origin = 'PERSON', version = a.version + 1
            WHERE a.project_id = %s AND a.status = 'APPROVED'
              AND NOT coalesce({CRITERIA_OWNED_SQL}, false)
            """,
            (project_id,),
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
    queued = release_design(database, project, [control])
    with connect(database.url) as connection:
        return queued + list(release(connection, organization, project, control, owner))


def unrestricted(cursor: object, organization_id: object) -> None:
    """A firm with no trial limits (INTERNAL), as every firm that predates subscriptions
    is (migration 0127). The tests' hand-made firms are such firms, unless a test is
    about the trial, which signs up through the API instead. A database migrated only to
    a point before 0127 has no subscriptions and no trial: nothing to do."""
    cursor.execute(  # type: ignore[attr-defined]
        "SELECT to_regclass('public.organization_subscriptions')"
    )
    if cursor.fetchone()[0] is None:  # type: ignore[attr-defined]
        return
    cursor.execute(  # type: ignore[attr-defined]
        """
        UPDATE organization_subscriptions
        SET status = 'ACTIVE', plan_type = 'INTERNAL', limit_engagements = NULL,
            limit_systems = NULL, limit_controls = NULL, limit_members = NULL,
            limit_uploads = NULL, limit_upload_bytes = NULL, ai_budget_micros = NULL,
            ai_run_limit = NULL, ai_concurrent_runs = NULL, ai_run_seconds = NULL,
            status_reason = 'test fixture'
        WHERE organization_id = %s
        """,
        (organization_id,),
    )
