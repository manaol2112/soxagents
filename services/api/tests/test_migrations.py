from pathlib import Path

import psycopg
import pytest
from support import Database

from ai_workforce_api.db import ConcurrentUpdateError, connect, require_one_row, transaction
from ai_workforce_api.migrate import (
    ChecksumMismatch,
    MigrationError,
    apply_migrations,
    list_migrations,
    migrations_dir,
)

ROOT = Path(__file__).resolve().parents[3]


def test_migration_names_must_be_contiguous(tmp_path: Path) -> None:
    (tmp_path / "0001_one.sql").write_text("SELECT 1;\n", encoding="utf-8")
    (tmp_path / "0003_three.sql").write_text("SELECT 1;\n", encoding="utf-8")
    with pytest.raises(MigrationError, match="contiguous"):
        list_migrations(tmp_path)


def test_migration_names_must_match_the_pattern(tmp_path: Path) -> None:
    (tmp_path / "not-a-migration.sql").write_text("SELECT 1;\n", encoding="utf-8")
    with pytest.raises(MigrationError, match="unexpected"):
        list_migrations(tmp_path)


def test_compose_sets_utc() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "timezone=UTC" in compose
    assert "log_timezone=UTC" in compose


def test_migrations_apply_once_on_an_empty_database(empty_database: Database) -> None:
    directory = migrations_dir()
    first = apply_migrations(empty_database.url, directory)
    second = apply_migrations(empty_database.url, directory)
    assert first == [
        "0001_conventions",
        "0002_initial_tables",
        "0003_auth_sessions",
        "0004_agent_execution_guard",
        "0005_task_agent_assignment",
        "0006_workflow_events",
        "0007_workflow_effects",
        "0008_model_calls",
        "0009_manager_plans",
        "0010_worker_results",
        "0011_action_restrictions",
        "0012_approvals",
        "0013_action_executions",
        "0014_mailbox",
        "0015_pbc_requests",
        "0016_outbound_messages",
        "0017_inbound_messages",
        "0018_agent_staffing",
        "0019_standard_workforce",
        "0020_pbc_follow_ups",
        "0021_evidence_files",
        "0022_engagement_onboarding",
        "0023_rcm_uploads",
        "0024_business_process_areas",
        "0025_pbc_drafts",
        "0026_rcm_systems",
        "0027_rcm_terms",
        "0028_engagement_workspace",
        "0029_evidence_analysis",
        "0030_evidence_reviews",
        "0031_control_tests",
        "0032_agent_console",
        "0033_evidence_intake",
        "0034_testing_engine",
        "0035_evidence_applications",
        "0036_console_citations",
        "0037_workpapers",
        "0038_evidence_withdrawals",
        "0039_engagement_profile_and_setup_drafts",
        "0040_testing_rounds",
        "0041_controls_per_application",
        "0042_control_reviews",
        "0043_demo_requests",
        "0044_user_identities",
        "0045_invitations",
        "0046_extra_engagement_roles",
        "0047_system_scoping",
        "0048_review_existing_systems",
        "0049_system_review_again",
        "0050_cuec_recommended_controls",
        "0051_no_system_soc_review",
        "0052_review_systems_without_soc",
        "0053_recommend_controls_by_kind",
        "0054_process_controls_without_systems",
        "0055_workpaper_templates",
        "0056_one_template_per_control",
        "0057_workpapers_follow_control_template",
        "0058_manual_controls",
        "0059_business_processes",
        "0060_control_narratives",
        "0061_control_context",
        "0062_phase_evidence_plans",
        "0063_attribute_definitions",
        "0064_control_parameters",
        "0065_system_applicability",
        "0066_evidence_portal",
        "0067_engagement_integrity",
        "0068_engagement_completion",
        "0069_workpaper_template_pinning",
        "0070_clients",
        "0071_engagement_exports",
        "0072_engagement_reports",
        "0073_evidence_workspace",
        "0074_engagement_profile",
        "0075_evidence_request_details",
        "0076_evidence_command_center",
        "0077_evidence_plan_runs",
        "0078_portal_collaboration",
        "0079_master_test_plans",
        "0080_master_plan_grounding",
        "0081_phase_releases",
        "0082_design_questions",
        "0083_library_governance",
        "0084_test_basis",
        "0085_library_attributes_approved",
        "0086_values_keep_approval",
        "0087_adapted_controls",
        "0088_stated_facts",
        "0089_testing_reopened",
        "0090_round_reviews",
        "0091_plan_impact",
        "0092_review_coverage_assessments",
        "0093_run_notes_and_round_basis",
    ]
    assert second == []
    with connect(empty_database.url) as connection:
        timezone = connection.execute("SHOW timezone").fetchone()
        assert timezone == ("UTC",)
        function = connection.execute(
            "SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'"
        ).fetchone()
        assert function == (1,)


def test_migrations_upgrade_through_each_file(empty_database: Database, tmp_path: Path) -> None:
    steps: list[list[str]] = []
    for path in sorted(migrations_dir().glob("*.sql")):
        (tmp_path / path.name).write_bytes(path.read_bytes())
        steps.append(apply_migrations(empty_database.url, tmp_path))
    assert steps == [
        ["0001_conventions"],
        ["0002_initial_tables"],
        ["0003_auth_sessions"],
        ["0004_agent_execution_guard"],
        ["0005_task_agent_assignment"],
        ["0006_workflow_events"],
        ["0007_workflow_effects"],
        ["0008_model_calls"],
        ["0009_manager_plans"],
        ["0010_worker_results"],
        ["0011_action_restrictions"],
        ["0012_approvals"],
        ["0013_action_executions"],
        ["0014_mailbox"],
        ["0015_pbc_requests"],
        ["0016_outbound_messages"],
        ["0017_inbound_messages"],
        ["0018_agent_staffing"],
        ["0019_standard_workforce"],
        ["0020_pbc_follow_ups"],
        ["0021_evidence_files"],
        ["0022_engagement_onboarding"],
        ["0023_rcm_uploads"],
        ["0024_business_process_areas"],
        ["0025_pbc_drafts"],
        ["0026_rcm_systems"],
        ["0027_rcm_terms"],
        ["0028_engagement_workspace"],
        ["0029_evidence_analysis"],
        ["0030_evidence_reviews"],
        ["0031_control_tests"],
        ["0032_agent_console"],
        ["0033_evidence_intake"],
        ["0034_testing_engine"],
        ["0035_evidence_applications"],
        ["0036_console_citations"],
        ["0037_workpapers"],
        ["0038_evidence_withdrawals"],
        ["0039_engagement_profile_and_setup_drafts"],
        ["0040_testing_rounds"],
        ["0041_controls_per_application"],
        ["0042_control_reviews"],
        ["0043_demo_requests"],
        ["0044_user_identities"],
        ["0045_invitations"],
        ["0046_extra_engagement_roles"],
        ["0047_system_scoping"],
        ["0048_review_existing_systems"],
        ["0049_system_review_again"],
        ["0050_cuec_recommended_controls"],
        ["0051_no_system_soc_review"],
        ["0052_review_systems_without_soc"],
        ["0053_recommend_controls_by_kind"],
        ["0054_process_controls_without_systems"],
        ["0055_workpaper_templates"],
        ["0056_one_template_per_control"],
        ["0057_workpapers_follow_control_template"],
        ["0058_manual_controls"],
        ["0059_business_processes"],
        ["0060_control_narratives"],
        ["0061_control_context"],
        ["0062_phase_evidence_plans"],
        ["0063_attribute_definitions"],
        ["0064_control_parameters"],
        ["0065_system_applicability"],
        ["0066_evidence_portal"],
        ["0067_engagement_integrity"],
        ["0068_engagement_completion"],
        ["0069_workpaper_template_pinning"],
        ["0070_clients"],
        ["0071_engagement_exports"],
        ["0072_engagement_reports"],
        ["0073_evidence_workspace"],
        ["0074_engagement_profile"],
        ["0075_evidence_request_details"],
        ["0076_evidence_command_center"],
        ["0077_evidence_plan_runs"],
        ["0078_portal_collaboration"],
        ["0079_master_test_plans"],
        ["0080_master_plan_grounding"],
        ["0081_phase_releases"],
        ["0082_design_questions"],
        ["0083_library_governance"],
        ["0084_test_basis"],
        ["0085_library_attributes_approved"],
        ["0086_values_keep_approval"],
        ["0087_adapted_controls"],
        ["0088_stated_facts"],
        ["0089_testing_reopened"],
        ["0090_round_reviews"],
        ["0091_plan_impact"],
        ["0092_review_coverage_assessments"],
        ["0093_run_notes_and_round_basis"],
    ]
    with connect(empty_database.url) as connection:
        organizations = connection.execute("SELECT to_regclass('public.organizations')").fetchone()
        sessions = connection.execute("SELECT to_regclass('public.auth_sessions')").fetchone()
    assert organizations == ("organizations",)
    assert sessions == ("auth_sessions",)
    assert apply_migrations(empty_database.url, tmp_path) == []


def test_changed_migration_checksum_is_rejected(empty_database: Database, tmp_path: Path) -> None:
    script = tmp_path / "0001_sample.sql"
    script.write_text("CREATE TABLE sample_kept (id integer PRIMARY KEY);\n", encoding="utf-8")
    apply_migrations(empty_database.url, tmp_path)
    script.write_text(
        "CREATE TABLE sample_kept (id integer PRIMARY KEY, extra text);\n", encoding="utf-8"
    )
    with pytest.raises(ChecksumMismatch):
        apply_migrations(empty_database.url, tmp_path)


def test_failed_migration_rolls_back(empty_database: Database, tmp_path: Path) -> None:
    (tmp_path / "0001_kept.sql").write_text(
        "CREATE TABLE sample_kept (id integer PRIMARY KEY);\n",
        encoding="utf-8",
    )
    (tmp_path / "0002_bad.sql").write_text(
        "CREATE TABLE sample_lost (id integer PRIMARY KEY);\nSELECT 1 / 0;\n",
        encoding="utf-8",
    )
    with pytest.raises(psycopg.Error):
        apply_migrations(empty_database.url, tmp_path)
    with connect(empty_database.url) as connection:
        versions = connection.execute(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).fetchall()
        kept = connection.execute("SELECT to_regclass('public.sample_kept')").fetchone()
        lost = connection.execute("SELECT to_regclass('public.sample_lost')").fetchone()
    assert versions == [("0001_kept",)]
    assert kept == ("sample_kept",)
    assert lost == (None,)


def test_versioned_update_and_updated_at_share_one_transaction(empty_database: Database) -> None:
    apply_migrations(empty_database.url, migrations_dir())
    with connect(empty_database.url) as connection:
        with transaction(connection) as cursor:
            cursor.execute(
                """
                CREATE TABLE convention_probe (
                    id uuid PRIMARY KEY DEFAULT uuidv7(),
                    version integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
                    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
                )
                """
            )
            cursor.execute(
                """
                CREATE TRIGGER convention_probe_updated
                BEFORE UPDATE ON convention_probe
                FOR EACH ROW
                EXECUTE FUNCTION set_updated_at()
                """
            )
            cursor.execute(
                "INSERT INTO convention_probe DEFAULT VALUES RETURNING id, version, updated_at"
            )
            inserted = cursor.fetchone()
            assert inserted is not None
            row_id, version, original_updated_at = inserted
            cursor.execute(
                """
                UPDATE convention_probe
                SET version = version + 1
                WHERE id = %s AND version = %s
                RETURNING version, updated_at
                """,
                (row_id, version),
            )
            require_one_row(cursor)
            updated = cursor.fetchone()
            assert updated is not None
            assert updated[0] == 2
            assert updated[1] > original_updated_at
            cursor.execute(
                """
                UPDATE convention_probe
                SET version = version + 1
                WHERE id = %s AND version = %s
                """,
                (row_id, 1),
            )
            with pytest.raises(ConcurrentUpdateError):
                require_one_row(cursor)
