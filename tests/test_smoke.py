"""Repository foundation checks. These do not require PostgreSQL."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

BLANK_KEYS = (
    "POSTGRES_PASSWORD",
    "OIDC_CLIENT_SECRET",
    "S3_SECRET_ACCESS_KEY",
    "GRAPH_CLIENT_SECRET",
    "MODEL_API_KEY",
)


def env_assignments(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "" or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator != "=":
            continue
        values[key] = value
    return values


def recipe(target: str, makefile: str) -> str:
    collecting = False
    lines: list[str] = []
    for line in makefile.splitlines():
        if not collecting:
            if line.startswith(f"{target}:") or line.startswith(f"{target} "):
                collecting = True
            continue
        if line.startswith("\t"):
            lines.append(line)
            continue
        if line.strip() == "":
            continue
        break
    return "\n".join(lines)


def test_env_template_keeps_secrets_blank_and_email_disabled() -> None:
    values = env_assignments(ROOT / ".env.example")
    for key in BLANK_KEYS:
        assert values[key] == ""
    assert values["EMAIL_LIVE_SEND_ENABLED"] == "false"


def test_compose_pins_postgres_and_keeps_a_health_check() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "image: postgres:18.6" in compose
    assert "postgres:latest" not in compose
    assert "healthcheck:" in compose
    assert "name: ai_workforce_postgres_data" in compose
    assert "sleep " not in compose


def test_start_waits_for_health_and_reset_is_the_only_volume_delete() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    start = recipe("start", makefile)
    reset = recipe("reset", makefile)
    assert "--wait" in start
    assert "down -v" not in start
    assert "python -m ai_workforce_api.migrate" in start
    assert "down -v" in reset


def test_ci_workflow_runs_the_local_baseline() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    for command in ("make check", "make install", "make lint", "make typecheck", "make test"):
        assert command in workflow
    assert "openssl rand -hex 24" in workflow
    assert "::add-mask::" in workflow
    assert "local-dev-only" not in workflow
    assert "EMAIL_LIVE_SEND_ENABLED=false" in workflow


def test_platform_decisions_are_accepted() -> None:
    for name in (
        "0002-workflow-engine.md",
        "0003-agent-orchestration.md",
        "0004-authentication-provider.md",
        "0005-object-storage.md",
    ):
        text = (ROOT / "docs/decisions" / name).read_text(encoding="utf-8")
        status = text.split("## Decision", maxsplit=1)[0]
        assert "Accepted" in status
        assert "Deferred" not in status
