"""Every agent file names a model and effort Claude Code accepts. No database is used.

docs/engineering-standards.md §12 (20 November 2026): each `.claude/agents/*.md` names its
`model` as an alias, so it follows model releases and never pins an identifier that does not
exist. A misspelt model or effort is caught here rather than when the agent is launched.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AGENTS = ROOT / ".claude" / "agents"

# The aliases the Claude Code documentation lists for agent frontmatter (code.claude.com,
# sub-agents and model-config, read 20 November 2026). Full model IDs are allowed by Claude
# Code but not here: an alias keeps the file current when a model is released.
MODELS = {"sonnet", "opus", "fable", "haiku", "inherit"}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}


def _frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"{path.name}: no frontmatter"
    block = text[4 : text.index("\n---", 4)]
    fields: dict[str, str] = {}
    for line in block.splitlines():
        key, sep, value = line.partition(":")
        if sep and not line.startswith((" ", "\t")):
            fields[key.strip()] = value.strip()
    return fields


def _agent_files() -> list[Path]:
    return sorted(AGENTS.glob("*.md"))


def test_the_guard_reads_the_agent_files() -> None:
    assert _agent_files(), "no agent files found; the guard is reading the wrong directory"


def test_every_agent_names_a_known_model_alias() -> None:
    for path in _agent_files():
        fields = _frontmatter(path)
        assert fields.get("model") in MODELS, f"{path.name}: model {fields.get('model')!r}"


def test_an_agent_effort_is_a_known_level() -> None:
    for path in _agent_files():
        effort = _frontmatter(path).get("effort")
        assert effort is None or effort in EFFORTS, f"{path.name}: effort {effort!r}"
