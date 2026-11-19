"""Which databases a scratch stack or a review-state seed may touch, and the environment
they run in (testing assessment, 19 November 2026, step 4).

The owner's development database holds real-looking engagements. On 18 November a branch
API was pointed at it by hand. Everything here exists so that cannot happen again:

- A name passes only if it is a valid identifier and matches `ai_workforce_<words>_ui`,
  optionally numbered: a suffix none of the owner's own databases use. The owner's
  development, demo, scale and walkthrough databases are denied by name and by word, and so
  is the database any checkout's `.env` points at.
- The server is this machine's: a DATABASE_URL whose host is not 127.0.0.1, localhost or
  ::1 is refused.
- A database is served only if it also carries the synthetic marker: a database comment the
  seeder writes when it creates the database (`COMMENT ON DATABASE`, not a schema change).
  Marking an older database by hand needs a passing name and a person typing the name at
  an interactive terminal (scratch_stack.py mark).
- The environment is an allowlist: only the operating system's own variables are kept and
  every application setting is set here. A developer's model key, email account, object
  store or worker switch in the shell or in `.env` never reaches a scratch process.

Pure functions only, apart from reading `.env` files (never printed) and `git worktree
list`. The rules are tested in services/api/tests/test_review_guard.py.
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent

PREFIX = "ai_workforce_"
# The development databases by name, whatever any .env says (docs/development.md; the dev
# database is ai_workforce_fresh since 28 October, ai_workforce kept as the way back).
# The owner's demo, scale and walkthrough databases are synthetic but the owner's own (they
# back docs/review screenshots and demos): never served or written by a scratch process.
DENIED = frozenset(
    {
        "ai_workforce", "ai_workforce_fresh", "postgres", "template0", "template1",
        "ai_workforce_demo", "ai_workforce_scale", "ai_workforce_scale400",
        "ai_workforce_walk", "ai_workforce_m3c_demo",
    }
)  # fmt: skip
# Words that never belong in a scratch database's name (anywhere after the prefix).
DENIED_WORDS = ("fresh", "prod", "backup", "restorecheck", "demo", "scale", "walk")
# ai_workforce_<words>_ui, optionally numbered: ai_workforce_states_ui1, ai_workforce_q_ui4.
SYNTHETIC = re.compile(r"ai_workforce_[a-z0-9]+(?:_[a-z0-9]+)*_ui\d*")
IDENTIFIER = re.compile(r"[a-z][a-z0-9_]{0,62}")
# The database server must be this machine's.
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

# The database comment that marks a synthetic database (written by the seeder).
MARKER = "ai-workforce synthetic review states"

# The ports of the developer's own stack (make go): never taken by a scratch stack.
DEV_PORTS = frozenset({3000, 8000})


class Refused(Exception):
    """A database, port or environment a scratch process must not use."""


def check_name(name: str, dev_names: Iterable[str] = ()) -> str:
    """The name, if a scratch process may use a database of that name; Refused otherwise.

    `dev_names`: the databases the checkouts' .env files point at (dev_databases())."""
    if not IDENTIFIER.fullmatch(name):
        raise Refused(f"{name!r} is not a database name (lower-case letters, digits, _)")
    if name in DENIED:
        raise Refused(f"{name} is a development database: never served or seeded by a script")
    if name in set(dev_names):
        raise Refused(f"{name} is the database a checkout's .env points at: refused")
    if not name.startswith(PREFIX):
        raise Refused(f"{name} does not start with {PREFIX}")
    for word in DENIED_WORDS:
        if word in name[len(PREFIX) :]:
            raise Refused(f"{name} contains {word!r}: not a synthetic database name")
    if not SYNTHETIC.fullmatch(name):
        raise Refused(
            f"{name} is not a scratch database name: use ai_workforce_<words>_ui, optionally "
            "numbered, e.g. ai_workforce_states_ui1"
        )
    return name


def is_marked(comment: str | None) -> bool:
    return comment is not None and comment.startswith(MARKER)


def marker(source: str) -> str:
    """The comment a seeded database carries: the marker, then where it came from."""
    clean = re.sub(r"[^A-Za-z0-9 ._:/@+-]", "", source)[:200]
    return f"{MARKER}: {clean}"


def check_marked(name: str, comment: str | None) -> None:
    if not is_marked(comment):
        raise Refused(
            f"{name} has no synthetic marker. Seed it with scripts/seed_review_states.py, or, "
            "for an older synthetic database, mark it at a terminal: scratch_stack.py mark "
            "--db NAME"
        )


def check_port(port: int) -> int:
    if port in DEV_PORTS:
        raise Refused(f"port {port} belongs to the development stack (make go)")
    if not 1024 < port < 65536:
        raise Refused(f"port {port} is out of range")
    return port


def database_of(url: str) -> str:
    """The database a PostgreSQL URL names (the path, without a query)."""
    return urlsplit(url).path.lstrip("/")


def check_host(url: str) -> str:
    """The URL, if it is a PostgreSQL URL on this machine; Refused otherwise (only the host
    is named, never the URL)."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        raise Refused("DATABASE_URL is not a URL") from None
    if not parts.scheme.startswith("postgres") or host is None:
        raise Refused("DATABASE_URL is not a PostgreSQL URL")
    if host.lower() not in LOCAL_HOSTS:
        raise Refused(f"the database server {host} is not this machine's: refused")
    return url


def with_database(url: str, name: str) -> str:
    """The same server and credentials, another database; localhost becomes 127.0.0.1 as
    settings.loopback_database_url does. Only a server on this machine."""
    check_host(url)
    parts = urlsplit(url)
    netloc = parts.netloc
    if (parts.hostname or "").lower() == "localhost":
        netloc = netloc.replace("@localhost", "@127.0.0.1", 1)
    return urlunsplit((parts.scheme, netloc, "/" + name, "", ""))


def env_value(path: Path, key: str) -> str:
    """One setting from a .env file, read as text (never sourced, never printed)."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    pattern = re.compile(rf"\s*(?:export\s+)?{re.escape(key)}\s*=(.*)")
    value = ""
    for line in lines:
        found = pattern.fullmatch(line)
        if found is not None:
            value = found.group(1).strip().strip("'\"")
    return value


def checkouts(root: Path = ROOT) -> list[Path]:
    """This checkout and every other worktree of the same repository."""
    found = [root]
    listed = subprocess.run(
        ["git", "-C", str(root), "worktree", "list", "--porcelain"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout
    for line in listed.splitlines():
        if line.startswith("worktree "):
            path = Path(line.removeprefix("worktree ").strip())
            if path not in found:
                found.append(path)
    return found


def dev_databases(paths: Iterable[Path]) -> set[str]:
    """The databases the checkouts' .env files point at: each is somebody's working data."""
    names = set()
    for path in paths:
        url = env_value(path / ".env", "DATABASE_URL")
        if url:
            names.add(database_of(url))
    return names


def server_url(paths: Iterable[Path]) -> str:
    """The first .env DATABASE_URL among the checkouts: the server and credentials used."""
    for path in paths:
        url = env_value(path / ".env", "DATABASE_URL")
        if url:
            return check_host(url)
    raise Refused("no .env with a DATABASE_URL in this checkout or its worktrees")


# The operating system's variables a child process needs; nothing else is inherited.
OS_KEYS = frozenset(
    {
        "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP",
        "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
        "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "USERNAME",
        "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "NUMBER_OF_PROCESSORS", "OS",
        "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "SHELL", "TERM",
    }
)  # fmt: skip


def base_env(environ: Mapping[str, str]) -> dict[str, str]:
    return {key: value for key, value in environ.items() if key.upper() in OS_KEYS}


def api_env(
    environ: Mapping[str, str],
    database_url: str,
    checkout: Path,
    web_port: int | None,
    worker: bool,
) -> dict[str, str]:
    """A scratch API's environment: this checkout's code, the named database, no model, no
    email, no object store, no durable engine, the worker only when asked for. The seeder
    runs in the same environment, with no web server (web_port None)."""
    web = "" if web_port is None else f"http://127.0.0.1:{web_port}"
    env = base_env(environ)
    env.update(
        {
            "PYTHONPATH": str(checkout / "services" / "api"),
            "PYTHONUTF8": "1",
            "DATABASE_URL": database_url,
            "APP_ENV": "development",
            "APP_BASE_URL": web,
            "PUBLIC_BASE_URL": web,
            "REVIEW_INDEPENDENCE_REQUIRED": "true",
            "SESSION_COOKIE_SECURE": "false",
            "PREVIEW_LOGIN_ENABLED": "false",
            "LOCAL_WORKER_ENABLED": "true" if worker else "false",
            "MODEL_PROVIDER": "",
            "MODEL_API_KEY": "",
            "MODEL_ALLOW_UNMETERED": "false",
            "EMAIL_PROVIDER": "",
            "EMAIL_LIVE_SEND_ENABLED": "false",
            "EMAIL_MOCK_INBOUND_ENABLED": "false",
            "SUPPORT_NOTIFY_EMAIL": "",
            "WORKFLOW_PROVIDER": "",
            "WORKFLOW_ADDRESS": "",
            "DEMO_DATASET": "",
            "TRUSTED_PROXIES": "",
        }
    )
    return env


# Variables Windows' venv launcher adds to the process it starts.
LAUNCHER_KEYS = frozenset({"__PYVENV_LAUNCHER__"})


def env_differences(environ: Mapping[str, str], checkout: Path) -> list[str]:
    """Inside a scratch API: the application variables of this process that differ from
    what api_env gives for the same database, web port and worker switch (names only, never
    values). Any variable api_env does not set (S3_*, SMTP_*, GOOGLE_*, a model tier...) is
    a difference."""
    web = urlsplit(environ.get("APP_BASE_URL", "")).port
    expected = api_env(
        environ,
        environ.get("DATABASE_URL", ""),
        checkout,
        web,
        environ.get("LOCAL_WORKER_ENABLED") == "true",
    )

    def app(env: Mapping[str, str]) -> dict[str, str]:
        return {k: v for k, v in env.items() if k.upper() not in OS_KEYS and k not in LAUNCHER_KEYS}

    have, want = app(environ), app(expected)
    return sorted(k for k in have.keys() | want.keys() if have.get(k) != want.get(k))


def web_env(environ: Mapping[str, str], api_port: int, web_port: int) -> dict[str, str]:
    """A scratch web server's environment: it calls the scratch API only, and builds into
    its own folder so the checkout's `make web` files are never replaced."""
    env = base_env(environ)
    env.update(
        {
            "API_BASE_URL": f"http://127.0.0.1:{api_port}",
            "PUBLIC_BASE_URL": f"http://127.0.0.1:{web_port}",
            "WEB_ALLOWED_ORIGINS": "",
            "NEXT_DIST_DIR": f".next-review/{web_port}",
            "NEXT_TELEMETRY_DISABLED": "1",
        }
    )
    return env


def only_build_folder_lines(before: str, after: str) -> bool:
    """Whether next dev's own rewrite is all that changed in a tracked web file: every line
    added or removed (trailing commas and spaces aside) names a build folder (.next/ or
    .next-review/). Anything else is a person's edit and must not be overwritten."""
    from collections import Counter

    def lines(text: str) -> Counter[str]:
        return Counter(line.strip().rstrip(",").strip() for line in text.splitlines())

    old, new = lines(before), lines(after)
    changed = (old - new) + (new - old)
    return all(".next-review/" in line or ".next/" in line for line in changed)


def state_dir(checkout: Path = ROOT) -> Path:
    """Where the scratch processes' records and logs go (tmp/ is git-ignored)."""
    return checkout / "tmp" / "scratch-stack"


def review_dir(checkout: Path = ROOT) -> Path:
    """Where seeded states' session files go (git-ignored; they hold a sign-in token)."""
    return checkout / "tmp" / "review-states"


def python_for(checkout: Path = ROOT) -> Path:
    """The repository's virtual environment: this checkout's, else the main checkout's (a
    worktree has none of its own). PYTHONPATH then makes it import this checkout's code."""
    for path in checkouts(checkout):
        venv = path / ".venv"
        for candidate in (venv / "Scripts" / "python.exe", venv / "bin" / "python"):
            if candidate.is_file():
                return candidate
    raise Refused("no .venv in this checkout or its worktrees (make install)")


def with_repository_python(script: Path, argv: list[str]) -> int | None:
    """The exit code of the script re-run under the repository's .venv, when this Python
    has no psycopg; None when this Python will do."""
    try:
        import psycopg  # noqa: F401
    except ImportError:
        python = python_for(ROOT)
        if Path(sys.executable).resolve() == python.resolve():
            raise
        return subprocess.run([str(python), str(script.resolve()), *argv]).returncode
    return None
