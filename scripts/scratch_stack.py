"""A scratch API and web server for THIS checkout against a named synthetic database.

    python scripts/scratch_stack.py start --db ai_workforce_states_ui1 --api-port 8030 \\
        --web-port 3030 [--worker]
    python scripts/scratch_stack.py status
    python scripts/scratch_stack.py stop [--port 8030 ...]
    python scripts/scratch_stack.py mark --db NAME   (an older scratch DB; at a terminal)

Testing assessment, 19 November 2026, step 4: agents started servers by hand, once against
the owner's development database. This script is the only way a scratch stack starts, and
it refuses anything but a synthetic database (scripts/review_guard.py):

- the name rules (only ai_workforce_<words>_ui, optionally numbered; never the owner's
  development, demo, scale or walkthrough databases, never the database any checkout's
  .env names) and a database server on this machine only;
- the synthetic marker on the database itself, which the seeder writes;
- the database's migrations are exactly this checkout's (no branch code on another
  branch's schema);
- never the development stack's ports (8000, 3000);
- an allowlisted environment: no model key, no email, no object store, no durable engine,
  the worker off unless --worker; PYTHONPATH is this checkout's services/api (the shared
  .venv otherwise imports the main checkout's code), checked again inside the API process.

The API process checks again from its own environment before it serves (its port, the
server's host, the database's name and marker, and every application variable against
what api_env gives), and writes its record (port, pid, start time, database name,
checkout) itself; `stop` kills only a process whose start time is the recorded one.
`status` reads those records and prints the database's name only, never its URL. Records
and logs are in
tmp/scratch-stack/ (git-ignored). Runs with any Python: it re-runs itself with the
repository's .venv when psycopg is not importable.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import review_guard as guard  # noqa: E402

ROOT = guard.ROOT
STATE = guard.state_dir(ROOT)


def _say(text: str) -> None:
    print(text, flush=True)


# --- the database --------------------------------------------------------------------------


def _admin_url() -> tuple[str, set[str]]:
    paths = guard.checkouts(ROOT)
    return guard.with_database(guard.server_url(paths), "postgres"), guard.dev_databases(paths)


def _comment(admin_url: str, name: str) -> tuple[bool, str | None]:
    import psycopg

    with psycopg.connect(admin_url, connect_timeout=5) as connection:
        row = connection.execute(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = %s",
            (name,),
        ).fetchone()
    return (row is not None, None if row is None else row[0])


def _migrations_differ(url: str) -> list[str]:
    """What the database's applied migrations and this checkout's files disagree on."""
    import psycopg

    files = {path.stem for path in (ROOT / "migrations").glob("*.sql")}
    with psycopg.connect(url, connect_timeout=5) as connection:
        rows = connection.execute("SELECT version FROM schema_migrations").fetchall()
    applied = {str(row[0]) for row in rows}
    missing = sorted(files - applied)
    extra = sorted(applied - files)
    out = []
    if missing:
        out.append(f"not applied: {', '.join(missing[:5])}{' ...' if len(missing) > 5 else ''}")
    if extra:
        out.append(f"from another checkout: {', '.join(extra[:5])}")
    return out


def checked_database(name: str) -> str:
    """The database's URL, if a scratch process may serve it; Refused otherwise."""
    admin, dev = _admin_url()
    guard.check_name(name, dev)
    exists, comment = _comment(admin, name)
    if not exists:
        raise guard.Refused(f"there is no database {name} (seed it: scripts/seed_review_states.py)")
    guard.check_marked(name, comment)
    return guard.with_database(admin, name)


# --- processes -----------------------------------------------------------------------------


def _in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _image(pid: int) -> str | None:
    """The running process's program name, or None when no such process runs."""
    if sys.platform == "win32":
        listed = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            check=False,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if not listed.startswith('"'):
            return None
        return listed.split('","', 1)[0].strip('"').lower()
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    try:
        return Path(f"/proc/{pid}/comm").read_text().strip().lower()
    except OSError:
        return "unknown"


def _started(pid: int) -> int | None:
    """When the process started (an opaque number), or None when no such process runs: a
    recorded pid is only the same process if this matches."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return None
        times = [wintypes.FILETIME() for _ in range(4)]
        try:
            ok = kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in times))
        finally:
            kernel.CloseHandle(handle)
        if not ok:
            return None
        return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    except OSError:
        return None
    return int(fields[19])


def _spawn(command: list[str], env: dict[str, str], cwd: Path, log: Path) -> int:
    log.parent.mkdir(parents=True, exist_ok=True)
    out = log.open("ab")
    kwargs: dict[str, Any] = {
        "cwd": str(cwd),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": out,
        "stderr": subprocess.STDOUT,
    }
    if sys.platform == "win32":
        # Its own process group, detached from this console, and out of the caller's job
        # so it outlives the shell that started it.
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        try:
            process = subprocess.Popen(
                command, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kwargs
            )
        except OSError:
            # The caller's job does not allow breaking away: the servers then stop with it.
            _say("note: the servers stop when this shell's job ends (breakaway not allowed)")
            process = subprocess.Popen(command, creationflags=flags, **kwargs)
    else:
        process = subprocess.Popen(command, start_new_session=True, **kwargs)
    return process.pid


def _kill(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False, capture_output=True)
    else:
        import signal

        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            return  # already gone


def _record_path(kind: str, port: int) -> Path:
    return STATE / f"{kind}-{port}.json"


def _write_record(kind: str, port: int, record: dict[str, Any]) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    _record_path(kind, port).write_text(json.dumps(record, indent=2), encoding="utf-8")


def _records() -> list[dict[str, Any]]:
    found = []
    for path in sorted(STATE.glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except OSError, ValueError:
            continue
        record["_path"] = str(path)
        found.append(record)
    return found


def _answers(url: str) -> int | None:
    """The HTTP status the URL answers with (no redirect followed), or None."""

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args: Any, **kwargs: Any) -> None:
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(url, timeout=60) as response:
            return int(response.status)
    except urllib.error.HTTPError as error:
        return int(error.code)
    except urllib.error.URLError, OSError:
        return None


def _wait(name: str, url: str, pid: int, log: Path, seconds: int, ok: set[int] | None) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if _image(pid) is None:
            tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
            raise guard.Refused(f"the {name} stopped while starting:\n" + "\n".join(tail))
        status = _answers(url)
        if status is not None and (ok is None or status in ok):
            return
        time.sleep(1.5)
    raise guard.Refused(f"the {name} did not answer within {seconds} s (log: {log})")


# --- commands ------------------------------------------------------------------------------


def start(db: str, api_port: int, web_port: int, worker: bool) -> None:
    guard.check_port(api_port)
    guard.check_port(web_port)
    if api_port == web_port:
        raise guard.Refused("the API and the web server need different ports")
    for port in (api_port, web_port):
        if _in_use(port):
            raise guard.Refused(f"port {port} is in use (scratch_stack.py status)")
    for record in _records():
        if record.get("kind") == "web" and _alive(record):
            raise guard.Refused(
                f"a scratch web server already runs from this checkout on :{record['port']}: "
                "next dev rewrites the same tracked files, so stop it first"
            )
    url = checked_database(db)
    differ = _migrations_differ(url)
    if differ:
        raise guard.Refused(
            f"{db} was not migrated by this checkout ({'; '.join(differ)}): seed a database "
            "from this checkout instead"
        )
    python = guard.python_for(ROOT)
    api_log = STATE / f"api-{api_port}.log"
    web_log = STATE / f"web-{web_port}.log"
    api_pid = _spawn(
        [str(python), str(Path(__file__).resolve()), "_api", "--port", str(api_port), "--db", db],
        guard.api_env(os.environ, url, ROOT, web_port, worker),
        ROOT,
        api_log,
    )
    _say(f"api  :{api_port}  starting (pid {api_pid}, log {api_log})")
    try:
        _wait("API", f"http://127.0.0.1:{api_port}/health", api_pid, api_log, 120, {200})
    except guard.Refused:
        _kill(api_pid)
        raise
    next_bin = ROOT / "apps" / "web" / "node_modules" / "next" / "dist" / "bin" / "next"
    node = _which("node")
    _keep_web_files(web_port)
    web_pid = _spawn(
        [node, str(next_bin), "dev", "--hostname", "127.0.0.1", "--port", str(web_port)],
        guard.web_env(os.environ, api_port, web_port),
        ROOT / "apps" / "web",
        web_log,
    )
    _write_record(
        "web",
        web_port,
        {
            "kind": "web",
            "port": web_port,
            "pid": web_pid,
            "created": _started(web_pid),
            "api_port": api_port,
            "db": db,
            "checkout": str(ROOT),
            "started": datetime.now(UTC).isoformat(timespec="seconds"),
        },
    )
    _say(f"web  :{web_port}  starting (pid {web_pid}, log {web_log}); first page compiles")
    try:
        _wait("web server", f"http://127.0.0.1:{web_port}/", web_pid, web_log, 300, None)
    except guard.Refused:
        _kill(web_pid)
        _kill(api_pid)
        _restore_web_files(web_port)
        raise
    _restore_web_files(web_port)
    status()


# next dev points these tracked files at its build folder (.next-review/<port>) when it
# starts; they are put back byte for byte once it answers, and again when it stops, so a
# scratch server never leaves a change in the checkout.
WEB_FILES = ("tsconfig.json", "next-env.d.ts")


def _keep_web_files(web_port: int) -> None:
    kept = STATE / f"web-{web_port}.kept"
    kept.mkdir(parents=True, exist_ok=True)
    for name in WEB_FILES:
        (kept / name).write_bytes((ROOT / "apps" / "web" / name).read_bytes())


def _restore_web_files(web_port: int) -> None:
    """Put the kept copy back, but only when next dev's build-folder lines are all that
    changed; anything else is someone's edit, left as it is with a warning."""
    kept = STATE / f"web-{web_port}.kept"
    for name in WEB_FILES:
        source, target = kept / name, ROOT / "apps" / "web" / name
        if not source.is_file() or target.read_bytes() == source.read_bytes():
            continue
        before = source.read_text(encoding="utf-8")
        after = target.read_text(encoding="utf-8")
        if guard.only_build_folder_lines(before, after):
            target.write_bytes(source.read_bytes())
            _say(f"web  :{web_port}  put back apps/web/{name} (next dev had rewritten it)")
        else:
            _say(
                f"warning: apps/web/{name} changed beyond next dev's build-folder lines while "
                "the scratch server ran; left as it is (its earlier copy: "
                f"{source})"
            )


def _which(program: str) -> str:
    import shutil

    found = shutil.which(program)
    if found is None:
        raise guard.Refused(f"{program} is not on the PATH")
    return found


def status() -> None:
    records = _records()
    if not records:
        _say("no scratch stack recorded for this checkout")
    for record in records:
        alive = _alive(record)
        listening = _in_use(int(record["port"]))
        state = "up" if alive and listening else "starting" if alive else "stopped"
        if record.get("kind") == "api":
            worker = "worker on" if record.get("worker") else "worker off"
            _say(
                f"api  :{record['port']}  db {record['db']}  {worker}  pid {record['pid']}  {state}"
            )
        else:
            _say(
                f"web  :{record['port']}  -> api :{record['api_port']}  db {record['db']}  "
                f"pid {record['pid']}  {state}"
            )


def _alive(record: dict[str, Any]) -> bool:
    """The recorded process still runs: the same pid, a python or node program, and the
    start time recorded when it started (a pid Windows reused is another process)."""
    pid = int(record["pid"])
    image = _image(pid)
    if image is None or not ("python" in image or "node" in image):
        return False
    created = record.get("created")
    return created is not None and _started(pid) == created


def stop(ports: list[int]) -> None:
    for record in _records():
        if ports and int(record["port"]) not in ports:
            continue
        pid = int(record["pid"])
        if _alive(record):
            _kill(pid)
            _say(f"{record['kind']}  :{record['port']}  stopped (pid {pid})")
        elif _image(pid) is not None:
            _say(
                f"{record['kind']}  :{record['port']}  pid {pid} is now another process: "
                "not stopped"
            )
        else:
            _say(f"{record['kind']}  :{record['port']}  was not running")
        if record["kind"] == "web":
            _restore_web_files(int(record["port"]))
        Path(record["_path"]).unlink(missing_ok=True)


def mark(db: str) -> None:
    """Mark an older scratch database synthetic: a passing name, and a person typing the
    name at an interactive terminal (no script or agent can answer the prompt)."""
    if not (sys.stdin.isatty() and sys.stdout.isatty()):
        raise guard.Refused("mark asks a person at a terminal; it cannot run unattended")
    admin, dev = _admin_url()
    guard.check_name(db, dev)
    exists, comment = _comment(admin, db)
    if not exists:
        raise guard.Refused(f"there is no database {db}")
    if guard.is_marked(comment):
        _say(f"{db} is already marked synthetic")
        return
    typed = input(f"Type {db} to confirm it holds synthetic data only: ").strip()
    if typed != db:
        raise guard.Refused("the name typed does not match: nothing was marked")
    import psycopg
    from psycopg import sql

    with psycopg.connect(admin, autocommit=True, connect_timeout=5) as connection:
        connection.execute(
            sql.SQL("COMMENT ON DATABASE {} IS {}").format(
                sql.Identifier(db),
                sql.Literal(guard.marker("marked by hand with scratch_stack.py")),
            )
        )
    _say(f"{db} marked synthetic")


def serve_api(port: int, db: str) -> None:
    """Inside the API process: check what this process is about to serve, from its own
    environment, record it, serve. Run directly, it refuses just the same."""
    import ai_workforce_api

    guard.check_port(port)
    module = Path(ai_workforce_api.__file__).resolve()
    if not module.is_relative_to(ROOT):
        raise guard.Refused(f"the API code is not this checkout's ({module})")
    url = guard.check_host(os.environ.get("DATABASE_URL", ""))
    name = guard.database_of(url)
    if name != db:
        raise guard.Refused(f"this process's DATABASE_URL names {name}, not {db}")
    web = os.environ.get("APP_BASE_URL", "")
    if web:
        guard.check_port(int(web.rsplit(":", 1)[1]))
    differ = guard.env_differences(os.environ, ROOT)
    if differ:
        raise guard.Refused(f"not the scratch environment: {', '.join(differ)}")
    checked_database(name)
    _write_record(
        "api",
        port,
        {
            "kind": "api",
            "port": port,
            "pid": os.getpid(),
            "created": _started(os.getpid()),
            "db": name,
            "worker": os.environ.get("LOCAL_WORKER_ENABLED") == "true",
            "checkout": str(ROOT),
            "code": str(module.parent),
            "started": datetime.now(UTC).isoformat(timespec="seconds"),
        },
    )
    import uvicorn

    uvicorn.run("ai_workforce_api.main:app", host="127.0.0.1", port=port, log_level="info")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else "")
    commands = parser.add_subparsers(dest="command", required=True)
    begin = commands.add_parser("start")
    begin.add_argument("--db", required=True)
    begin.add_argument("--api-port", type=int, required=True)
    begin.add_argument("--web-port", type=int, required=True)
    begin.add_argument("--worker", action="store_true")
    commands.add_parser("status")
    end = commands.add_parser("stop")
    end.add_argument("--port", type=int, action="append", default=[])
    marking = commands.add_parser("mark")
    marking.add_argument("--db", required=True)
    inner = commands.add_parser("_api")
    inner.add_argument("--port", type=int, required=True)
    inner.add_argument("--db", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "start":
            start(args.db, args.api_port, args.web_port, args.worker)
        elif args.command == "status":
            status()
        elif args.command == "stop":
            stop(args.port)
        elif args.command == "mark":
            mark(args.db)
        else:
            serve_api(args.port, args.db)
    except guard.Refused as refused:
        print(f"refused: {refused}", file=sys.stderr, flush=True)
        return 2
    return 0


if __name__ == "__main__":
    rerun = guard.with_repository_python(Path(__file__), sys.argv[1:])
    sys.exit(main(sys.argv[1:]) if rerun is None else rerun)
