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
