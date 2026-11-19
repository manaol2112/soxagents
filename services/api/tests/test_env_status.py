"""scripts/env_status.py (make env-status): which checkout, commit and database each local
server runs. No database and no server are used; the parts that read the machine are fed
recorded output.

Workflow improvements, 19 November 2026 (owner-approved): several worktrees each run an API
and a web server, and which code and which database a port serves had to be worked out by
hand. The status must name the database, never print its URL, a password or a token.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]


def _script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("env_status", ROOT / "scripts" / "env_status.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["env_status"] = module
    spec.loader.exec_module(module)
    return module


es = _script()

SECRET_URL = "postgresql://postgres:s3cret-pass@127.0.0.1:5432/ai_workforce_states_ui3"

NETSTAT = """
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9304
  TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       23424
  TCP    127.0.0.1:8000         127.0.0.1:52011        ESTABLISHED     23424
  TCP    127.0.0.1:52011        127.0.0.1:8000         ESTABLISHED     9304
  TCP    [::]:8030              [::]:0                 LISTENING       4410
  UDP    0.0.0.0:5353           *:*                                    2210
"""

PROC_NET_TCP = """  sl  local_address rem_address   st  ...  inode
   0: 0100007F:1F40 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41231 1
   1: 0100007F:1F40 0100007F:CB2B 01 00000000:00000000 00:00000000 00000000  1000        0 41299 1
   2: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41377 1
"""


def test_the_ports_are_the_development_and_scratch_pairs_or_the_ones_given() -> None:
    assert es.DEFAULT_PORTS[:6] == (8000, 3000, 8010, 3010, 8020, 3020)
    for port in (8030, 3030, 8041, 3041, 8050, 3050):
        assert port in es.DEFAULT_PORTS
    assert len(es.DEFAULT_PORTS) == len(set(es.DEFAULT_PORTS))
    assert es.parse_ports("8000, 3000,8030-8032 8000") == [8000, 3000, 8030, 8031, 8032]
    for bad in ("80a0", "8050-8030", "0", "70000", "8000-"):
        with pytest.raises(ValueError):
            es.parse_ports(bad)


def test_listening_sockets_are_read_from_netstat_and_proc() -> None:
    assert es.parse_netstat(NETSTAT) == {3000: 9304, 8000: 23424, 8030: 4410}
    assert es.parse_proc_net_tcp(PROC_NET_TCP) == {8000: 41231, 3000: 41377}


def test_an_environment_block_is_read_by_name() -> None:
    block = "=C:=C:\\work\0PATH=C:\\bin\0DATABASE_URL=" + SECRET_URL + "\0\0"
    env = es.parse_environment_block(block)
    assert env["DATABASE_URL"] == SECRET_URL and env["PATH"] == "C:\\bin"
    assert all(key for key in env)


def test_the_role_and_the_served_checkout_come_from_the_process() -> None:
    api = '"C:\\x\\.venv\\Scripts\\python.exe" -m uvicorn ai_workforce_api.main:app --port 8000'
    web = (
        '"C:\\Users\\R J\\soxagents-q\\node_modules\\.pnpm\\next@16\\node_modules\\next\\'
        'dist\\server\\lib\\start-server.js"'
    )
    assert es.role_of("python.exe", api) == "api"
    assert es.role_of("python3.14", "python scripts/scratch_stack.py serve-api") == "api"
    assert es.role_of("node.exe", web) == "web"
    assert es.role_of("postgres", "postgres -D /data") == "postgres"
    # An API serves the checkout its PYTHONPATH names (a scratch stack), else its cwd.
    other = Path(ROOT.anchor, "work", "soxagents-q")
    env = {"PYTHONPATH": os.pathsep.join(["", str(other / "services" / "api")])}
    served = es.Process(1, "python.exe", api, str(ROOT), env)
    assert es.served_directory("api", served) == str(other)
    assert es.served_directory("api", es.Process(1, "python.exe", api, str(ROOT), {})) == str(ROOT)
    assert es.served_directory("api", es.Process(1, "python.exe", api, None, None)) is None
    # A web server runs from its checkout's node_modules.
    node = es.Process(2, "node.exe", web, "C:\\elsewhere", None)
    assert es.served_directory("web", node) == "C:\\Users\\R J\\soxagents-q"
    linux = es.Process(2, "node", "node /home/r/soxagents/node_modules/next/dist/x.js", None, None)
    assert es.served_directory("web", linux) == "/home/r/soxagents"


def test_only_the_database_name_is_ever_taken_from_a_url(tmp_path: Path) -> None:
    assert es.database_name(SECRET_URL) == "ai_workforce_states_ui3"
    assert es.database_name("postgresql://u:p@h/") is None
    assert es.database_name("postgresql://u:p@h/a;b") is None
    process = es.Process(7, "python.exe", "", None, {"DATABASE_URL": SECRET_URL})
    assert es.database_of(process, None, 8030) == "ai_workforce_states_ui3"
    # Without a readable environment, a scratch API's own record, if it is this process's.
    checkout = es.Checkout(tmp_path, "b", "abc1234", 0, 0)
    records = tmp_path / "tmp" / "scratch-stack"
    records.mkdir(parents=True)
    unreadable = es.Process(7, "python.exe", "", None, None)
    assert es.database_of(unreadable, checkout, 8030) == "unknown"
    (records / "api-8030.json").write_text('{"pid": 7, "db": "ai_workforce_s_ui1"}', "utf-8")
    assert es.database_of(unreadable, checkout, 8030) == "ai_workforce_s_ui1 (scratch record)"
    (records / "api-8030.json").write_text('{"pid": 8, "db": "ai_workforce_s_ui1"}', "utf-8")
    assert es.database_of(unreadable, checkout, 8030) == "unknown"


def test_the_version_route_s_answer_is_shown_only_in_its_shape() -> None:
    body = {"commit": "4431a3f0c1d2", "branch": "main", "migrations_head": "0175_plan_run"}
    assert es.read_version(body) == "4431a3f mig 0175"
    assert es.read_version({"commit": "<script>", "migrations_head": None}) == "? mig ?"
    assert es.read_version(["x"]) == "-"
    row = es.Row(8000, "api", es.Checkout(ROOT, "main", "d370566", 0, 0), "db", "4431a3f mig 0175")
    assert es.stale(row)
    assert not es.stale(es.Row(8000, "api", row.checkout, "db", "d370566 mig 0175"))
    assert not es.stale(es.Row(8000, "api", row.checkout, "db", "-"))


def test_a_checkout_s_branch_commit_and_changes_come_from_git(tmp_path: Path) -> None:
    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(tmp_path), *args], check=True, capture_output=True)

    git("init", "-q", "-b", "trial")
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty",
        "-m", "one")  # fmt: skip
    (tmp_path / "new.txt").write_text("x", "utf-8")
    (tmp_path / "sub").mkdir()
    found = es.checkout_state(tmp_path / "sub")
    assert found is not None
    assert Path(found.path).resolve() == tmp_path.resolve()
    assert found.branch == "trial" and len(found.commit) >= 7
    assert found.uncommitted == 1
    assert found.behind is None, "no origin/main here"
    assert es.checkout_state(Path(tmp_path.anchor) / "no-such-place-env-status") is None


def test_the_report_names_each_server_and_never_a_url_or_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(es, "listening", lambda: {8030: 11, 3030: 12, 5432: 13})
    api = '"python.exe" -m uvicorn ai_workforce_api.main:app --port 8030'
    env = {"DATABASE_URL": SECRET_URL, "MODEL_API_KEY": "sk-live-token-value"}
    processes: dict[int, Any] = {
        11: es.Process(11, "python.exe", api, str(ROOT), env),
        12: es.Process(12, "node.exe", f'"{ROOT / "node_modules" / "next" / "x.js"}"', None, None),
    }
    monkeypatch.setattr(es, "process", lambda pid: processes[pid])
    monkeypatch.setattr(es, "running_version", lambda port: "4431a3f mig 0175")
    checkout = es.Checkout(ROOT, "workflow-env-ci", "d370566", 3, 2)
    monkeypatch.setattr(es, "checkout_state", lambda directory: checkout)
    lines = es.status([8030, 3030, 8000])
    assert len(lines) == 3, "a header and one line per listening port of the set"
    assert lines[1].split()[:8] == [
        "8030", "api", "workflow-env-ci", "d370566", "3", "2", "ai_workforce_states_ui3",
        "4431a3f",
    ]  # fmt: skip
    assert "(older code)" in lines[1]
    assert lines[2].split()[:2] == ["3030", "web"] and str(ROOT) in lines[2]
    text = "\n".join(lines)
    for secret in ("s3cret-pass", "postgresql://", "sk-live-token-value", "5432"):
        assert secret not in text
    monkeypatch.setattr(es, "listening", lambda: {})
    assert es.status([8000]) == ["Nothing listens on 8000."]
