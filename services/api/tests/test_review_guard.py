"""The guard of the scratch stack and the review-state seeder (scripts/review_guard.py): a
development database can never be served or seeded, and no developer setting reaches a
scratch process. No database is used.

Testing assessment, 19 November 2026, step 4: a branch API was pointed at the owner's
development database by hand on 18 November.
"""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from ai_workforce_api.settings import Settings

ROOT = Path(__file__).resolve().parents[3]


def _guard() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "review_guard", ROOT / "scripts" / "review_guard.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard: Any = _guard()


@pytest.mark.parametrize(
    "name",
    [
        "ai_workforce",
        "ai_workforce_fresh",
        "postgres",
        "template1",
        "ai_workforce_fresh_ui",
        "ai_workforce_prod_ui",
        "ai_workforce_backup_ui",
        "ai_workforce_x_restorecheck_1",
        "ai_workforce_copy",
        "ai_workforce_test_0a1b2c",
        "workforce_states_ui1",
        "AI_WORKFORCE_STATES_UI1",
        "ai_workforce_states_ui1; DROP DATABASE x",
        "ai_workforce_states_ui1\n",
        "",
        # The owner's own synthetic databases (demos, scale runs, the walkthrough) and any
        # name of their kind.
        "ai_workforce_demo",
        "ai_workforce_scale",
        "ai_workforce_scale400",
        "ai_workforce_walk",
        "ai_workforce_m3c_demo",
        "ai_workforce_states_demo_ui",
        "ai_workforce_rescale_ui1",
        "ai_workforce_walk2_ui",
        # A suffix other than _ui, or no word before it.
        "ai_workforce_ui",
        "ai_workforce_states_ui1x",
    ],
)
def test_a_development_or_unknown_database_is_refused(name: str) -> None:
    with pytest.raises(guard.Refused):
        guard.check_name(name)


# Independent review, 19 November 2026 (blocking): old expectation, ai_workforce_ui,
# ai_workforce_scale400, ai_workforce_walk and ai_workforce_demo passed as synthetic names;
# new, only ai_workforce_<words>_ui passes, and those four are refused above. Why: the
# scale, walk and demo databases are the owner's own (review screenshots, demos), so with
# `mark` and `start --worker` a scratch process could serve and write to them.
@pytest.mark.parametrize(
    "name",
    ["ai_workforce_states_ui1", "ai_workforce_q_ui4", "ai_workforce_ah_ui", "ai_workforce_eg_ui"],
)
def test_a_scratch_name_passes(name: str) -> None:
    assert guard.check_name(name) == name


def test_the_database_any_checkouts_env_names_is_refused(tmp_path: Path) -> None:
    main, branch = tmp_path / "main", tmp_path / "branch"
    for checkout, name in ((main, "ai_workforce_mine_ui"), (branch, "ai_workforce_other_ui")):
        checkout.mkdir()
        (checkout / ".env").write_text(
            f"POSTGRES_USER=u\nDATABASE_URL='postgresql://u:secret@localhost:5432/{name}'\n",
            encoding="utf-8",
        )
    dev = guard.dev_databases([main, branch, tmp_path / "missing"])
    assert dev == {"ai_workforce_mine_ui", "ai_workforce_other_ui"}
    for name in dev:
        with pytest.raises(guard.Refused, match="points at"):
            guard.check_name(name, dev)
    assert guard.check_name("ai_workforce_states_ui1", dev) == "ai_workforce_states_ui1"


def test_only_a_marked_database_is_served() -> None:
    assert guard.is_marked(guard.marker("seeded by seed_review_states.py at 15a0a1c"))
    for comment in (None, "", "a database", "AI-WORKFORCE SYNTHETIC REVIEW STATES"):
        assert not guard.is_marked(comment)
        with pytest.raises(guard.Refused, match="no synthetic marker"):
            guard.check_marked("ai_workforce_states_ui1", comment)
    # What the marker records is kept to plain characters.
    assert "'" not in guard.marker("it's; DROP")


@pytest.mark.parametrize("port", [8000, 3000, 80, 1024, 70000])
def test_the_development_stacks_ports_and_odd_ports_are_refused(port: int) -> None:
    with pytest.raises(guard.Refused):
        guard.check_port(port)
    assert guard.check_port(8030) == 8030


def test_the_url_keeps_the_server_and_names_only_the_database() -> None:
    url = guard.with_database(
        "postgresql://u:p%40ss@localhost:5432/ai_workforce_fresh?x=1", "ai_workforce_states_ui1"
    )
    assert url == "postgresql://u:p%40ss@127.0.0.1:5432/ai_workforce_states_ui1"
    assert guard.database_of(url) == "ai_workforce_states_ui1"
    with pytest.raises(guard.Refused):
        guard.with_database("mysql://u:p@h/x", "ai_workforce_states_ui1")
    ipv6 = guard.with_database("postgresql://u:p@[::1]:5432/x", "ai_workforce_states_ui1")
    assert guard.database_of(ipv6) == "ai_workforce_states_ui1"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@db.example.com:5432/ai_workforce_fresh",
        "postgresql://u:p@10.0.0.5:5432/ai_workforce_fresh",
        "postgresql://u:p@127.0.0.2:5432/ai_workforce_fresh",
        "postgresql://u:p@localhost.example.com/ai_workforce_fresh",
        "postgresql:///ai_workforce_fresh",
    ],
)
def test_only_a_database_server_on_this_machine_is_used(url: str, tmp_path: Path) -> None:
    with pytest.raises(guard.Refused):
        guard.with_database(url, "ai_workforce_states_ui1")
    (tmp_path / ".env").write_text(f"DATABASE_URL={url}\n", encoding="utf-8")
    with pytest.raises(guard.Refused):
        guard.server_url([tmp_path])


def test_env_values_are_read_as_bash_writes_them(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text(
        "# DATABASE_URL=postgresql://u:p@127.0.0.1/commented\n"
        "export DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/ai_workforce_one_ui'\n"
        '  DATABASE_URL="postgresql://u:p@127.0.0.1:5432/ai_workforce_two_ui"\n'
        "DATABASE_URL_OTHER=postgresql://u:p@127.0.0.1/no\n",
        encoding="utf-8",
    )
    # The last assignment wins, as when bash reads the file; a comment and a longer name
    # are not it.
    assert guard.env_value(env, "DATABASE_URL").endswith("/ai_workforce_two_ui")
    env.write_text("export DATABASE_URL=postgresql://u:p@127.0.0.1/ai_workforce_x_ui\n")
    assert guard.dev_databases([tmp_path]) == {"ai_workforce_x_ui"}


def test_the_api_process_finds_any_variable_the_stack_did_not_give() -> None:
    url = "postgresql://u:p@127.0.0.1:5432/ai_workforce_states_ui1"
    given = guard.api_env({"PATH": "/usr/bin"}, url, ROOT, 3030, False)
    assert guard.env_differences(given, ROOT) == []
    assert guard.env_differences({**given, "__PYVENV_LAUNCHER__": "x"}, ROOT) == []
    for key, value in (
        ("WORKFLOW_ADDRESS", "127.0.0.1:7233"),
        ("S3_BUCKET", "evidence"),
        ("SMTP_PASSWORD", "x"),
        ("GOOGLE_CLIENT_SECRET", "x"),
        ("MODEL_API_KEY", "x"),
        ("MODEL_DEEP", "x"),
        ("EMAIL_LIVE_SEND_ENABLED", "true"),
        ("EMAIL_PROVIDER", "smtp"),
    ):
        assert guard.env_differences({**given, key: value}, ROOT) == [key], key
    missing = {k: v for k, v in given.items() if k != "REVIEW_INDEPENDENCE_REQUIRED"}
    assert guard.env_differences(missing, ROOT) == ["REVIEW_INDEPENDENCE_REQUIRED"]


def test_only_next_devs_own_rewrite_of_a_web_file_is_put_back() -> None:
    before = (
        '{\n  "include": [\n    ".next/types/**/*.ts",\n    ".next/dev/types/**/*.ts"\n  ]\n}\n'
    )
    rewritten = before.replace(
        '".next/dev/types/**/*.ts"\n',
        '".next/dev/types/**/*.ts",\n    ".next-review/3030/dev/types/**/*.ts"\n',
    )
    assert guard.only_build_folder_lines(before, rewritten)
    env_before = 'import "./.next/dev/types/routes.d.ts";\n'
    env_after = 'import "./.next-review/3030/dev/types/routes.d.ts";\n'
    assert guard.only_build_folder_lines(env_before, env_after)
    # A person's edit made while the server ran is not overwritten.
    edited = rewritten.replace('"include"', '"compilerOptions": {"strict": true},\n  "include"')
    assert not guard.only_build_folder_lines(before, edited)


def test_no_developer_setting_reaches_a_scratch_process() -> None:
    # Every setting the API reads, set by a developer's shell or .env to a live value.
    leaked = {name.upper(): "LEAK" for name in Settings.model_fields}
    leaked.update({"PATH": "/usr/bin", "SYSTEMROOT": "C:\\Windows", "ANTHROPIC_API_KEY": "LEAK"})
    url = "postgresql://u:p@127.0.0.1:5432/ai_workforce_states_ui1"
    api = guard.api_env(leaked, url, ROOT, 3030, False)
    assert "LEAK" not in api.values(), sorted(k for k, v in api.items() if v == "LEAK")
    assert api["DATABASE_URL"] == url
    assert api["PATH"] == "/usr/bin" and api["SYSTEMROOT"] == "C:\\Windows"
    assert api["PYTHONPATH"] == str(ROOT / "services" / "api")
    assert (api["MODEL_PROVIDER"], api["MODEL_API_KEY"], api["EMAIL_PROVIDER"]) == ("", "", "")
    assert api["EMAIL_LIVE_SEND_ENABLED"] == "false"
    assert api["LOCAL_WORKER_ENABLED"] == "false"
    assert api["REVIEW_INDEPENDENCE_REQUIRED"] == "true"
    assert "S3_BUCKET" not in api and "SMTP_PASSWORD" not in api
    assert guard.api_env(leaked, url, ROOT, 3030, True)["LOCAL_WORKER_ENABLED"] == "true"
    # The settings it gives are the API's own, and valid.
    settings = Settings(
        **{k.lower(): v for k, v in api.items() if k.lower() in Settings.model_fields}
    )
    assert settings.model_api_key == "" and settings.email_live_send_enabled is False
    assert settings.local_worker_enabled is False and settings.s3_bucket == ""

    web = guard.web_env(leaked, 8030, 3030)
    assert "LEAK" not in web.values()
    assert web["API_BASE_URL"] == "http://127.0.0.1:8030"
    assert web["NEXT_DIST_DIR"] == ".next-review/3030"
    assert "DATABASE_URL" not in web


def test_the_scratch_files_are_git_ignored() -> None:
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    for folder in ("tmp/", ".next-review/", "test-results/"):
        assert folder in ignored, folder
    assert guard.state_dir(ROOT).relative_to(ROOT).parts[0] == "tmp"
    assert guard.review_dir(ROOT).relative_to(ROOT).parts[0] == "tmp"
