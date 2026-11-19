"""Create a synthetic database of review states for the browser checks and design reviews.

    python scripts/seed_review_states.py create --db ai_workforce_states_ui1
    python scripts/seed_review_states.py session --db ai_workforce_states_ui1   (new token)

Testing assessment, 19 November 2026, step 4: the screenshot rounds rebuilt their states by
hand four times. This builds them once, from this checkout's code, the same way every time:

- refuses a name that is not synthetic (scripts/review_guard.py) and any database that
  already exists, then creates it, applies this checkout's migrations and seeds it;
- seeds through the real code paths only, with the test suite's own helpers
  (services/api/tests: an engagement launched and its evidence plans approved as the
  owner would, files added and withdrawn over the API, files read by the rules), in the
  allowlisted environment of review_guard.api_env: no model, no email, no worker, no
  object store (evidence bytes are rows of this database);
- marks the database synthetic (its comment) only when every state is built; a failed
  seed drops the database it created;
- writes the states' URLs and an owner sign-in token to tmp/review-states/<db>.json
  (git-ignored; the token lasts 8 hours: `session` makes a new one).

The states (each a URL in the session file, with the facts a check may assert):

- controls             the Controls page of a launched engagement (SAP ERP, FY2027)
- planning-procedures  ITGC-AC-01's Procedures tab in Planning
- evidence-withdrawn   the Evidence library's Withdrawn list: one file withdrawn with a long
                       reason, one without a reason

Adding states on a branch: put a module in scripts/review_states/ (one file per branch, so
branches never edit the same file) with `def build(seed: Seed) -> None`; it uses the same
helpers and calls seed.add(name, url, **facts). Modules run in name order after the states
above. Use only what the branch's code has, and keep each state small.
"""

from __future__ import annotations

import importlib.util
import json
import os
import secrets
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import review_guard as guard  # noqa: E402

ROOT = guard.ROOT
API = ROOT / "services" / "api"
TOKEN_HOURS = 8

WITHDRAWN_REASON = (
    "Superseded by the signed access management standard the control owner sent on "
    "14 March 2027; this draft was never approved and is not relied on for the design "
    "assessment or any sample"
)


@dataclass
class Seed:
    """What a state builder works with: the database, the launched engagement, the owner's
    API client and its scheduler (analyses the rules read with read_all)."""

    url: str
    database: Any
    team: dict[str, Any]
    client: Any
    scheduler: Any
    states: dict[str, dict[str, Any]] = field(default_factory=dict)

    def href(self, team: dict[str, Any] | None = None, **params: str) -> str:
        """A workspace URL (path and query) on this engagement, or another one."""
        on = self.team if team is None else team
        query = {"organization": str(on["org"]), "project": str(on["project"]), **params}
        return "/?" + urlencode(query)

    def add(self, name: str, url: str, **facts: Any) -> None:
        if name in self.states:
            raise ValueError(f"state {name} is built twice")
        self.states[name] = {"url": url, **facts}

    def base(self, team: dict[str, Any] | None = None) -> str:
        on = self.team if team is None else team
        return f"/organizations/{on['org']}/projects/{on['project']}"


def _hermetic(url: str) -> None:
    """This process's environment becomes the scratch API's (before the app is imported)."""
    environment = guard.api_env(os.environ, url, ROOT, None, False)
    environment["APP_ENV"] = "test"
    os.environ.clear()
    os.environ.update(environment)
    sys.path[:0] = [str(API), str(API / "tests")]


def _commit() -> str:
    found = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return found or "unknown"


def _admin_and_dev() -> tuple[str, set[str]]:
    paths = guard.checkouts(ROOT)
    return guard.with_database(guard.server_url(paths), "postgres"), guard.dev_databases(paths)


# --- the states on main ----------------------------------------------------------------------


def core_states(seed: Seed) -> None:
    from test_evidence_plans import _control, _phase, _plan
    from test_testing_engine import _read_all

    control = _control(seed.database, seed.team, "ITGC-AC-01")
    seed.add("controls", seed.href(section="register"), expand="ITGC-AC-01")
    seed.add(
        "planning-procedures",
        seed.href(section="planning", control=control, tab="procedures"),
        control="ITGC-AC-01",
    )

    design = _phase(_plan(seed.client, seed.team, control), "DESIGN")
    request_id = design["requests"][0]["id"]
    files = {
        "access management standard (draft).txt": (
            b"Draft. Managers approve access requests before access is granted.\n",
            WITHDRAWN_REASON,
        ),
        "user listing 2027-01.csv": (b"User ID,Name,Role\nu1,A. Example,Clerk\n", ""),
    }
    withdrawn: list[str] = []
    for name, (content, _reason) in files.items():
        added = seed.client.post(
            f"{seed.base()}/evidence-uploads",
            params={"batch_id": str(UUID(int=len(withdrawn) + 1)), "name": name,
                    "request_id": request_id},
            content=content,
            headers={"content-type": "text/csv" if name.endswith(".csv") else "text/plain"},
        )  # fmt: skip
        assert added.status_code == 200, added.text
        withdrawn.append(added.json()["file_id"])
    _read_all(seed.database, seed.scheduler)
    for file_id, (_content, reason) in zip(withdrawn, files.values(), strict=True):
        body = {"reason": reason} if reason else {}
        done = seed.client.post(f"{seed.base()}/evidence-files/{file_id}/withdraw", json=body)
        assert done.status_code == 200, done.text
    seed.add(
        "evidence-withdrawn",
        seed.href(section="evidence", tab="files", queue="withdrawn"),
        files=list(files),
        reasons=[WITHDRAWN_REASON, "No reason given."],
        control="ITGC-AC-01",
    )


def _branch_states(seed: Seed) -> None:
    folder = HERE / "review_states"
    for path in sorted(folder.glob("*.py")) if folder.is_dir() else []:
        spec = importlib.util.spec_from_file_location(f"review_states_{path.stem}", path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.build(seed)


# --- create, session -------------------------------------------------------------------------


def _token(url: str, user_id: object) -> str:
    from ai_workforce_api.auth import token_hash
    from ai_workforce_api.db import connect

    token = secrets.token_urlsafe(32)
    with connect(url) as connection:
        connection.execute(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) "
            f"VALUES (%s, %s, clock_timestamp() + interval '{TOKEN_HOURS} hours')",
            (user_id, token_hash(token)),
        )
        connection.commit()
    return token


def _session_path(name: str) -> Path:
    return guard.review_dir(ROOT) / f"{name}.json"


def _write_session(name: str, body: dict[str, Any]) -> Path:
    path = _session_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, indent=2, default=str), encoding="utf-8")
    return path


def _seed(url: str) -> dict[str, Any]:
    import ai_workforce_api

    module = Path(ai_workforce_api.__file__).resolve()
    if not module.is_relative_to(ROOT):
        raise guard.Refused(f"the API code is not this checkout's ({module})")
    from support import Database
    from test_evidence_intake import _engagement

    from ai_workforce_api import evidence_assurance, independence
    from ai_workforce_api.db import connect
    from ai_workforce_api.migrate import apply_migrations, migrations_dir

    independence.configure(True)
    evidence_assurance._process_settings.cache_clear()
    if not migrations_dir().is_relative_to(ROOT):
        raise guard.Refused("the migrations are not this checkout's")
    applied = apply_migrations(url, migrations_dir())
    print(f"migrations applied: {len(applied)} (to {applied[-1]})", flush=True)

    database = Database(url)
    team, client, scheduler = _engagement(database, "review-states")
    seed = Seed(url, database, team, client, scheduler)
    core_states(seed)
    _branch_states(seed)

    with connect(url) as connection:
        connection.execute(
            "UPDATE organizations SET name = 'Example Audit Firm' WHERE id = %s", (team["org"],)
        )
        connection.execute(
            "UPDATE users SET display_name = 'Engagement lead', "
            "email = 'engagement.lead@example.com' WHERE id = %s",
            (team["owner_id"],),
        )
        connection.execute(
            "UPDATE users SET display_name = 'Engagement reviewer', "
            "email = 'engagement.reviewer@example.com' WHERE id = %s",
            (team["reviewer_id"],),
        )
        connection.commit()
    return {
        "organization": str(team["org"]),
        "project": str(team["project"]),
        "owner_user_id": str(team["owner_id"]),
        "states": seed.states,
    }


def create(name: str) -> None:
    import psycopg
    from psycopg import sql

    admin, dev = _admin_and_dev()
    guard.check_name(name, dev)
    url = guard.with_database(admin, name)
    with psycopg.connect(admin, autocommit=True, connect_timeout=5) as connection:
        found = connection.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
        if found.fetchone() is not None:
            raise guard.Refused(f"{name} already exists: choose a new name (nothing was changed)")
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    print(f"created {name}", flush=True)
    _hermetic(url)
    try:
        body = _seed(url)
        body["owner"] = _token(url, body["owner_user_id"])
    except BaseException:
        with psycopg.connect(admin, autocommit=True, connect_timeout=5) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
            )
        print(f"the seed failed: {name}, created by this run, was dropped", flush=True)
        raise
    commit = _commit()
    with psycopg.connect(admin, autocommit=True, connect_timeout=5) as connection:
        connection.execute(
            sql.SQL("COMMENT ON DATABASE {} IS {}").format(
                sql.Identifier(name),
                sql.Literal(guard.marker(f"seeded by seed_review_states.py at {commit}")),
            )
        )
    body.update(
        {
            "db": name,
            "cookie": "aw_session",
            "commit": commit,
            "seeded_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
    )
    path = _write_session(name, body)
    print(f"seeded {len(body['states'])} states: {', '.join(body['states'])}", flush=True)
    print(f"session file: {path}", flush=True)


def session(name: str) -> None:
    import psycopg

    admin, dev = _admin_and_dev()
    guard.check_name(name, dev)
    with psycopg.connect(admin, connect_timeout=5) as connection:
        row = connection.execute(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = %s",
            (name,),
        ).fetchone()
    if row is None:
        raise guard.Refused(f"there is no database {name}")
    guard.check_marked(name, row[0])
    path = _session_path(name)
    if not path.is_file():
        raise guard.Refused(f"no session file for {name} at {path}: seed it from this checkout")
    body = json.loads(path.read_text(encoding="utf-8"))
    url = guard.with_database(admin, name)
    _hermetic(url)
    body["owner"] = _token(url, body["owner_user_id"])
    _write_session(name, body)
    print(f"new owner session for {name}, valid {TOKEN_HOURS} hours: {path}", flush=True)


def main(argv: list[str]) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Seed synthetic review states.")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("create", "session"):
        sub = commands.add_parser(command)
        sub.add_argument("--db", required=True)
    args = parser.parse_args(argv)
    try:
        create(args.db) if args.command == "create" else session(args.db)
    except guard.Refused as refused:
        print(f"refused: {refused}", file=sys.stderr, flush=True)
        return 2
    return 0


if __name__ == "__main__":
    rerun = guard.with_repository_python(Path(__file__), sys.argv[1:])
    sys.exit(main(sys.argv[1:]) if rerun is None else rerun)
