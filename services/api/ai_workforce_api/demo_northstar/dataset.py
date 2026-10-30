"""The `northstar/1` dataset: writes the Northstar engagement for one firm, inside the
demo initialization's transaction (demo.py), through the application's own tables and
services and nothing demo-specific.

What is written (Step 4A): the client and the engagement's profile, the client's
contacts, three systems, three business processes, fourteen controls with their test
attributes, and twenty-seven evidence files stored in the firm's object store, filed to
their controls, tagged to their systems, and read by the extraction pipeline (no model
call: the rules classify them, and the record says so). The engagement is then launched
through the real setup launch when its readiness checks pass; the request drafts that
launch queues are marked skipped so no background worker spends the firm's AI allowance
on them. Approvals, testing, reviews, remediation and reports are Step 4B.

Everything is deterministic: the records come from one seed, the files are byte-stable,
and every id of a stored file derives from the engagement's id, so building the same
demo twice writes the same thing and never duplicates it.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid5

import psycopg
from psycopg.types.json import Json

from ai_workforce_api.demo_northstar import files as F
from ai_workforce_api.demo_northstar import records as R

logger = logging.getLogger(__name__)

NAMESPACE = UUID("6f1c2b3a-0f1e-4c4a-9b1d-2d7e8a9b0c11")
SEEDED_NOTE = "Prepared by the Northstar demo dataset (northstar/1)"

DOMAIN_OF = {
    "ITGC_ACCESS": "ACCESS",
    "ITGC_CHANGE": "CHANGE",
    "ITGC_OPERATIONS": "OPERATIONS",
    "ITAC": "ITAC",
    "IPE": "IPE",
    "MRC": "RECORD_TO_REPORT",
}
CLASSIFICATIONS_OF = {
    "ITGC_ACCESS": ["ITGC"],
    "ITGC_CHANGE": ["ITGC"],
    "ITGC_OPERATIONS": ["ITGC"],
    "ITAC": ["AUTOMATED_APPLICATION"],
    "IPE": ["KEY_REPORT", "IT_DEPENDENT_MANUAL"],
    "MRC": ["MANAGEMENT_REVIEW"],
}
FREQUENCY_OF = {
    "EACH_OCCURRENCE": "EVENT_DRIVEN",
    "CONTINUOUS": "RECURRING",
    "QUARTERLY": "QUARTERLY",
    "MONTHLY": "MONTHLY",
    "DAILY": "DAILY",
}
# The business processes the non-ITGC controls belong to (engagement_processes domains).
PROCESS_DOMAINS = {
    "P2P": ("Procure to pay", "PROCURE_TO_PAY"),
    "REVENUE": ("Revenue reporting", "ORDER_TO_CASH"),
    "CLOSE": ("Financial close", "RECORD_TO_REPORT"),
}
SYSTEM_FACTS = {
    "sap": ("SAP", "VENDOR_HOSTED", True),
    "entra": ("ENTRA", "SAAS", True),
    "snowflake": ("SNOW", "SAAS", True),
}
SCOPE = (
    "FY2027 IT SOX audit of Northstar Technologies, Inc. for the year ending 31 December "
    "2027: IT general controls over SAP S/4HANA, Microsoft Entra ID and Snowflake (access, "
    "change, operations), the three-way match application control, the revenue-by-customer "
    "report used in the close, and the Controller's monthly flux review. Interim testing as "
    "of 30 September 2027; roll-forward to the period end."
)


class NorthstarDataset:
    key = R.DATASET_KEY
    title = f"{R.CLIENT_NAME}: {R.ENGAGEMENT_NAME}"
    # The audit lifecycle is on the engagement (Step 4B: approved plans, received and
    # accepted evidence, tested samples, signed sheets, reviews, deficiencies in
    # remediation): the demo is shown as ready.
    complete = True

    def build(self, cursor: psycopg.Cursor[Any], context: Any) -> UUID:
        from ai_workforce_api.demo_datasets import free_slug

        connection = cursor.connection
        organization_id: UUID = context.organization_id
        requester: UUID = context.requested_by
        data = R.build()
        evidence = F.render(data)
        slug = free_slug(cursor, organization_id, R.ENGAGEMENT_SLUG)
        project_id = _create_project(cursor, organization_id, requester, slug)
        team = _personnel(cursor, organization_id, project_id)
        _profile(cursor, organization_id, project_id, requester)
        _contacts(cursor, organization_id, project_id, requester)
        systems = _systems(cursor, organization_id, project_id, requester)
        processes = _processes(cursor, organization_id, project_id)
        controls = _controls(cursor, organization_id, project_id, systems, processes)
        stored, filed = _evidence(
            cursor, connection, context.settings, organization_id, project_id, requester,
            systems, controls, evidence,
        )  # fmt: skip
        launched = _launch(connection, cursor, organization_id, project_id, team["dana"])
        lifecycle: dict[str, Any] = {}
        if launched:
            from ai_workforce_api.demo_northstar.lifecycle import run_lifecycle

            lifecycle = run_lifecycle(
                connection, cursor, organization_id, project_id, team, controls, systems,
                filed, data, evidence, context.settings,
            )  # fmt: skip
        cursor.execute(
            """
            INSERT INTO audit_events (
                organization_id, project_id, actor_user_id, action, target_type, target_id, payload
            )
            VALUES (%s, %s, %s, 'demo.dataset_built', 'project', %s, %s)
            """,
            (
                organization_id,
                project_id,
                requester,
                project_id,
                Json(
                    {
                        "dataset": self.key,
                        "systems": len(systems),
                        "controls": len(controls),
                        "evidence_files": stored,
                        "launched": launched,
                        "team": {key: str(value) for key, value in team.items()},
                        "lifecycle": lifecycle,
                    }
                ),
            ),
        )
        return project_id


def _create_project(
    cursor: psycopg.Cursor[Any], organization_id: UUID, requester: UUID, slug: str
) -> UUID:
    cursor.execute(
        """
        INSERT INTO projects (
            organization_id, name, slug, scope, owner_user_id, status, starts_on, ends_on, demo
        )
        VALUES (%s, %s, %s, %s, %s, 'DRAFT', %s, %s, true)
        RETURNING id
        """,
        (
            organization_id,
            R.ENGAGEMENT_NAME,
            slug,
            SCOPE,
            requester,
            R.PERIOD_START,
            R.MILESTONES[-1][1],
        ),
    )
    row = cursor.fetchone()
    assert row is not None
    project_id = UUID(str(row[0]))
    # The person who started the demo joins its team to work in it; the audit's own roles
    # (lead, reviewer, tester) are the demo's personnel, so independence holds.
    cursor.execute(
        """
        INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
        VALUES (%s, %s, %s, 'PREPARER')
        """,
        (organization_id, project_id, requester),
    )
    return project_id


# The demo's audit team (migration 0130): identities in name only, made here and only
# here, members of this firm alone and of its demo engagements alone, never able to sign
# in. Their org roles let the audit's services act as them; the firm's trial counts none
# of them.
TEAM_ROLES: tuple[tuple[str, str, str], ...] = (
    # person key, firm role, engagement role
    ("dana", "PROJECT_MANAGER", "LEAD"),
    ("riley", "CONTRIBUTOR", "REVIEWER"),
    ("morgan", "CONTRIBUTOR", "PREPARER"),
)


def _personnel(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID
) -> dict[str, UUID]:
    team: dict[str, UUID] = {}
    for key, firm_role, engagement_role in TEAM_ROLES:
        person = R.PEOPLE[key]
        # One identity per firm: a reset finds the same people again.
        cursor.execute(
            "SELECT id FROM users WHERE demo_organization_id = %s AND email = %s",
            (organization_id, _demo_email(person.email, organization_id)),
        )
        found = cursor.fetchone()
        if found is None:
            cursor.execute(
                """
                INSERT INTO users (email, display_name, demo_organization_id)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (_demo_email(person.email, organization_id), person.name, organization_id),
            )
            found = cursor.fetchone()
        assert found is not None
        user_id = UUID(str(found[0]))
        cursor.execute(
            """
            INSERT INTO memberships (organization_id, user_id, role)
            VALUES (%s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (organization_id, user_id, firm_role),
        )
        cursor.execute(
            """
            INSERT INTO project_memberships (organization_id, project_id, user_id, engagement_role)
            VALUES (%s, %s, %s, %s)
            """,
            (organization_id, project_id, user_id, engagement_role),
        )
        team[key] = user_id
    return team


def _demo_email(email: str, organization_id: UUID) -> str:
    """Each firm's demo people have addresses of their own (emails are unique across
    firms); the names are the same everywhere."""
    local, _, domain = email.partition("@")
    return f"{local}+{str(organization_id)[-12:]}@{domain}"


def _profile(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, requester: UUID
) -> None:
    from ai_workforce_api.clients import assign_client
    from ai_workforce_api.profile_checks import basis

    coordinator = R.PEOPLE["samuel"]
    confirmed = basis(R.ENGAGEMENT_NAME, SCOPE, R.PERIOD_START, R.PERIOD_END, "FY2027")
    cursor.execute(
        """
        UPDATE engagement_settings
        SET engagement_type = 'SOX_ITGC', period_start = %s, period_end = %s,
            fiscal_year = 'FY2027', methodology = 'EXTERNAL_ICFR',
            frameworks = ARRAY['ITGC', 'ITAC', 'KEY_REPORT', 'BUSINESS'],
            reporting_objectives = %s,
            client_coordinator_name = %s, client_coordinator_email = %s,
            client_domains = ARRAY['northstar.example'],
            period_confirmed_at = clock_timestamp(), period_confirmed_by = %s,
            period_confirmed_basis = %s,
            version = version + 1, updated_at = clock_timestamp()
        WHERE project_id = %s
        """,
        (
            R.PERIOD_START,
            R.PERIOD_END,
            "Report on the design and operating effectiveness of IT general controls and the "
            "selected application controls, key reports and management review controls "
            "supporting Northstar's internal control over financial reporting for FY2027.",
            coordinator.name,
            coordinator.email,
            requester,
            confirmed,
            project_id,
        ),
    )
    assign_client(cursor, organization_id, project_id, requester, name=R.CLIENT_NAME)


def _contacts(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, requester: UUID
) -> None:
    for person in R.OWNERS:
        cursor.execute(
            """
            INSERT INTO engagement_contacts (
                organization_id, project_id, name, email, role, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (organization_id, project_id, person.name, person.email, person.title, requester),
        )


def _systems(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID, requester: UUID
) -> dict[str, UUID]:
    from ai_workforce_api.system_review_queue import track_review

    ids: dict[str, UUID] = {}
    for system in R.SYSTEMS:
        ref_code, hosting, soc = SYSTEM_FACTS[system.key]
        owner = R.PEOPLE[system.owner]
        areas = (
            ["ITGC"]
            + (["ITAC"] if system.key == "sap" else [])
            + (["IPE"] if system.key in ("snowflake", "sap") else [])
        )
        cursor.execute(
            """
            INSERT INTO engagement_applications (
                organization_id, project_id, name, description, layer, hosting, soc_expected,
                facts_source, facts_confirmed, purpose, processes, owner, ref_code,
                environment, control_areas, control_areas_decided_at, control_areas_decided_by
            )
            VALUES (%s, %s, %s, %s, 'APPLICATION', %s, %s, 'PERSON', true, %s, %s, %s, %s,
                    'PRODUCTION', %s, clock_timestamp(), %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                system.name,
                f"{system.kind} ({system.vendor}). {system.financial_relevance}"[:500],
                hosting,
                soc,
                system.description[:1000],
                "; ".join(system.scope)[:500],
                f"{owner.name}, {owner.title}"[:200],
                ref_code,
                areas,
                requester,
            ),
        )
        row = cursor.fetchone()
        assert row is not None
        ids[system.key] = UUID(str(row[0]))
        track_review(cursor, organization_id, project_id, ids[system.key], requester)
    return ids


def _processes(
    cursor: psycopg.Cursor[Any], organization_id: UUID, project_id: UUID
) -> dict[str, UUID]:
    ids: dict[str, UUID] = {}
    for key, (name, domain) in PROCESS_DOMAINS.items():
        cursor.execute(
            """
            INSERT INTO engagement_processes (organization_id, project_id, name, domain)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (organization_id, project_id, name, domain),
        )
        row = cursor.fetchone()
        assert row is not None
        ids[key] = UUID(str(row[0]))
    return ids


def _controls(
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    systems: dict[str, UUID],
    processes: dict[str, UUID],
) -> dict[str, UUID]:
    from ai_workforce_api.controls import DOMAIN_AGENTS
    from ai_workforce_api.workpapers import default_template

    ids: dict[str, UUID] = {}
    process_names = dict(R.PROCESSES)
    for control in R.CONTROLS:
        domain = DOMAIN_OF[control.category]
        owner = R.PEOPLE[control.owner]
        primary = systems[control.systems[0]]
        applications = [systems[key] for key in control.systems]
        activity = control.description
        # The control's own words beyond the standard columns, as the register shows them.
        custom = [
            {"label": "Control objective", "value": control.objective},
            {"label": "Process", "value": process_names[control.process]},
            {"label": "Control type", "value": control.kind.title()},
            {
                "label": "Systems",
                "value": ", ".join(R.SYSTEM_BY_KEY[k].name for k in control.systems),
            },
            {
                "label": "Testing procedures",
                "value": "\n".join(f"{i}. {p}" for i, p in enumerate(control.procedures, 1)),
            },
            {"label": "Expected evidence", "value": "; ".join(control.evidence)},
            {"label": "Sampling", "value": control.sampling},
            {
                "label": "Relevant period",
                "value": "FY2027 (1 January to 31 December 2027); interim as of 30 September 2027",
            },
        ]
        cursor.execute(
            """
            INSERT INTO engagement_controls (
                organization_id, project_id, library_key, library_version, control_ref,
                domain, title, risk, activity, frequency, nature, key_control, included,
                owner_name, owner_email, application_ids, engagement_application_id,
                process_id, test_attributes, pbc_items, template_key, agent_key, source,
                classifications, custom_fields, domain_label
            )
            VALUES (%s, %s, %s, 0, %s, %s, %s, %s, %s, %s, %s, true, true, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, 'MANUAL', %s, %s, %s)
            RETURNING id
            """,
            (
                organization_id,
                project_id,
                f"manual:northstar-{control.ref.lower()}",
                control.ref,
                domain,
                control.name,
                control.risk,
                activity,
                FREQUENCY_OF[control.frequency],
                control.nature,
                owner.name,
                owner.email,
                applications,
                primary,
                processes.get(control.process),
                Json(list(control.attributes)),
                Json(list(control.evidence)),
                default_template(domain),
                DOMAIN_AGENTS[domain],
                CLASSIFICATIONS_OF[control.category],
                Json(custom),
                process_names[control.process],
            ),
        )
        row = cursor.fetchone()
        assert row is not None
        ids[control.ref] = UUID(str(row[0]))
    # The attributes the trigger made from the list carry the control's objective.
    for control in R.CONTROLS:
        cursor.execute(
            "UPDATE control_attributes SET objective = %s WHERE engagement_control_id = %s",
            (control.objective[:500], ids[control.ref]),
        )
    return ids


def _evidence(
    cursor: psycopg.Cursor[Any],
    connection: psycopg.Connection[Any],
    settings: Any,
    organization_id: UUID,
    project_id: UUID,
    requester: UUID,
    systems: dict[str, UUID],
    controls: dict[str, UUID],
    evidence: list[F.EvidenceFile],
) -> tuple[int, dict[tuple[str, str], UUID]]:
    """Store every file, file it to its control, tag its system, and read it as the
    pipeline would, without a model."""
    from ai_workforce_api.evidence_analysis import _context
    from ai_workforce_api.evidence_classify import rules_classify
    from ai_workforce_api.evidence_extraction import extract
    from ai_workforce_api.storage import open_store

    if settings is None:
        raise ValueError("the demo dataset needs the deployment's settings for its files")
    store = open_store(settings, connection)
    batch_id = uuid5(NAMESPACE, f"{project_id}:batch")
    stored = 0
    filed: dict[tuple[str, str], UUID] = {}
    for item in evidence:
        # A file that serves several controls is filed to each (the register binds a
        # file to one control): the same bytes and hash, under the control's folder.
        for index, control_ref in enumerate(item.controls):
            folder = item.folder if index == 0 else f"{item.folder}/{control_ref}"
            stored += 1
            file_id = uuid5(NAMESPACE, f"{project_id}:{item.key}:{control_ref}")
            filed[(item.key, control_ref)] = file_id
            key = f"evidence/{file_id}"
            sha256 = store.put(key, item.content)
            cursor.execute(
                """
                INSERT INTO evidence_files (
                    id, organization_id, project_id, object_key, content_sha256, size_bytes,
                    content_type, file_name, stored_by, source, folder_path, upload_batch_id
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'UPLOAD', %s, %s)
                """,
                (
                    file_id,
                    organization_id,
                    project_id,
                    key,
                    sha256,
                    item.size,
                    item.content_type,
                    item.file_name,
                    requester,
                    folder,
                    batch_id,
                ),
            )
            cursor.execute(
                """
                INSERT INTO evidence_matches (
                    organization_id, project_id, evidence_file_id, status, engagement_control_id,
                    filed_by, decided_by, reason
                )
                VALUES (%s, %s, %s, 'FILED', %s, 'PERSON', %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    file_id,
                    controls[control_ref],
                    requester,
                    f"{SEEDED_NOTE}: {item.description}"[:500],
                ),
            )
            cursor.execute(
                """
                INSERT INTO evidence_file_applications (
                    evidence_file_id, organization_id, project_id, scope,
                    engagement_application_id, tagged_by, decided_by, reason
                )
                VALUES (%s, %s, %s, 'ONE', %s, 'PERSON', %s, %s)
                """,
                (
                    file_id,
                    organization_id,
                    project_id,
                    systems[item.system],
                    requester,
                    SEEDED_NOTE,
                ),
            )
            extraction = extract(item.content, item.file_name, item.content_type)
            classification = rules_classify(
                _context(connection, project_id, item.file_name, extraction, None)
            )
            cursor.execute(
                """
                INSERT INTO evidence_analyses (
                    organization_id, project_id, evidence_file_id, requested_by_user_id, status,
                    attempts, extraction, extraction_status, extracted_text, text_truncated,
                    content_redacted, page_count, row_count, columns, classification, source, note
                )
                VALUES (%s, %s, %s, %s, 'READY', 1, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'RULES', %s)
                """,
                (
                    organization_id,
                    project_id,
                    file_id,
                    requester,
                    extraction.method,
                    extraction.status,
                    extraction.text,
                    extraction.truncated,
                    extraction.redacted,
                    extraction.pages,
                    extraction.rows,
                    Json(list(extraction.columns)),
                    Json(classification.model_dump()),
                    f"Read when the demo was prepared. {extraction.note}".strip()[:500],
                ),
            )
            cursor.execute(
                """
                INSERT INTO audit_events (
                    organization_id, project_id, actor_user_id, action, target_type,
                    target_id, payload
                )
                VALUES (%s, %s, %s, 'evidence.uploaded', 'evidence_file', %s, %s)
                """,
                (
                    organization_id,
                    project_id,
                    requester,
                    file_id,
                    Json(
                        {
                            "file_name": item.file_name,
                            "size_bytes": item.size,
                            "seeded": True,
                            "dataset": R.DATASET_KEY,
                            "control_ref": control_ref,
                        }
                    ),
                ),
            )
    return stored, filed


def _launch(
    connection: psycopg.Connection[Any],
    cursor: psycopg.Cursor[Any],
    organization_id: UUID,
    project_id: UUID,
    requester: UUID,
) -> bool:
    """Launch through the real setup launch, when its readiness checks pass (a lead and,
    with review independence, a reviewer on the team; period, scope and systems in
    place). The drafts the launch queues are skipped: no worker drafts them with the
    model, and the firm's AI allowance is untouched. Not ready leaves the engagement a
    draft, said so in the build's audit event."""
    from ai_workforce_api.authorization import Principal, PrincipalKind
    from ai_workforce_api.onboarding import (
        OnboardingState,
        PlanApproval,
        _snapshot,
        launch_engagement,
    )

    principal = Principal(PrincipalKind.USER, requester)
    snapshot = _snapshot(connection, organization_id, project_id)
    if not snapshot.ready or snapshot.plan_preview is None:
        logger.info("northstar demo left as a draft: setup readiness not met")
        return False
    try:
        launch_engagement(
            connection, principal, organization_id, project_id,
            PlanApproval(fingerprint=snapshot.plan_preview.fingerprint),
        )  # fmt: skip
    except OnboardingState as state:
        logger.info("northstar demo left as a draft: %s", state)
        return False
    cursor.execute(
        """
        UPDATE pbc_drafts
        SET status = 'SKIPPED', note = %s, lease_until = NULL, updated_at = clock_timestamp()
        WHERE project_id = %s AND status = 'PENDING'
        """,
        ("Prepared with the demo; drafted in a later step", project_id),
    )
    return True
