"""The risk-class check: a pull request declares a class at or above its paths' minimum.

Run by .github/workflows/risk.yml on every pull request (docs/test-strategy.md, "The
risk-class check"). Standard library only; it runs in about a second, launches no agent and
runs no test.

1. The minimum comes from the changed paths alone: `.github/risk-paths.toml` maps a path to
   the highest class of every rule that matches it, or to `default` (High) when none does.
   Each path is classified under the mapping at the base AND at the head, and the higher
   counts, so a pull request cannot lower its own minimum. Renames and copies count both
   names; a deleted or moved-away test file is at least Medium.
2. The declaration is the one ticked box of the template's "## Risk class" section. Missing,
   two ticks, or a tick with no class word fails. Declaring below the minimum fails: there
   is no per-PR exception (owner decision M2); a wrong minimum is fixed in the mapping.
3. For High, the evidence must be present and current: a design note (a committed Markdown
   file under docs/, or an inline or private-note summary in the body), the audit
   invariants touched, and a review record whose reviewed commit is in this pull request
   with no High path of it changed since (owner decision M6).

What it cannot prove: that a review happened, who did it, that it was independent, or that
it was any good. Every agent here acts with the owner's credentials, so the body can be
written by the change's own author. The record is only specific, current and auditable
afterwards. It guards against omission and mistakes, not against a hostile pull request.

The body is untrusted: it arrives through an environment variable and is parsed as text,
never evaluated or passed to a shell, by linear scans only.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tomllib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Protocol

CLASSES = ("Low", "Medium", "High")
LOW, MEDIUM, HIGH = 0, 1, 2
MAPPING_PATH = ".github/risk-paths.toml"
INVARIANTS_PATH = "docs/audit-invariants.md"
DEPENDABOT = "dependabot[bot]"
TEST_DIRS = ("services/api/tests/", "tests/")
MAX_LINES = 20
MIN_NOTE_WORDS = 150
MIN_SECTION_WORDS = 50
_RULE_KEYS = frozenset({"class", "why", "paths", "except", "dependabot"})
_TOP_KEYS = frozenset({"version", "default", "rule"})
_DEPENDABOT_KINDS = ("any", "pins")
_SHA = re.compile(r"[0-9a-f]{7,40}")
_TICK = re.compile(r"^\s*[-*]\s*\[[xX]\]\s*(.*)$")
_CLASS_WORD = re.compile(r"(Low|Medium|High)\b")
_FIELD = re.compile(r"^([A-Z][A-Za-z-]*):[ \t]*(.*)$")
_FIXED_IN = re.compile(r"fixed in ([0-9a-fA-F]+)\b")
_INVARIANT_ROW = re.compile(r"^\| (I\d+) \|", re.MULTILINE)
_INVARIANT_ID = re.compile(r"\bI\d+\b")
_NOTE_IN_BODY = re.compile(r"(?:inline|private)(?![\w/.-])", re.IGNORECASE)
_USES_LINE = re.compile(r"^\s*(?:-\s+)?uses:\s*\S+(?:\s+#.*)?$")


class MappingError(ValueError):
    """The mapping file is not well formed."""


@dataclass(frozen=True)
class Rule:
    level: int
    why: str
    paths: tuple[str, ...]
    excepted: tuple[str, ...] = ()
    dependabot: str | None = None

    def matches(self, path: str) -> bool:
        pure = PurePosixPath(path)
        return any(pure.full_match(glob) for glob in self.paths) and not any(
            pure.full_match(glob) for glob in self.excepted
        )


@dataclass(frozen=True)
class Mapping:
    default: int
    rules: tuple[Rule, ...]


@dataclass(frozen=True)
class Change:
    status: str  # A, C, D, M, R, T (git's letter, without its score)
    paths: tuple[str, ...]  # one path, or the old then the new name for R and C


@dataclass
class Report:
    computed: int = LOW
    declared: int | None = None
    effective: int = LOW
    deciding: list[tuple[str, str]] = field(default_factory=list)
    lowered: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    exempt: str | None = None
    changed: int = 0
    notes: list[str] = field(default_factory=list)


class Repo(Protocol):
    """What the check reads from git. `GitRepo` runs git; the tests give a fake."""

    def show(self, rev: str, path: str) -> str | None: ...
    def changes(self, base: str, head: str) -> list[Change]: ...
    def commits(self, base: str, head: str) -> list[str]: ...
    def changed_between(self, older: str, newer: str) -> list[str]: ...
    def tracked(self, rev: str) -> list[str]: ...
    def file_diff(self, base: str, head: str, path: str) -> str: ...


# --- The mapping -----------------------------------------------------------------------


def _level(name: object, where: str) -> int:
    if name not in CLASSES:
        raise MappingError(f"{where}: class {name!r} is not one of {', '.join(CLASSES)}")
    return CLASSES.index(str(name))


def _globs(value: object, where: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or not all(isinstance(g, str) and g for g in value):
        raise MappingError(f"{where}: must be a non-empty list of glob strings")
    return tuple(value)


def parse_mapping(text: str) -> Mapping:
    """The mapping, validated: version 1, a default class, and rules each with a class, a
    reason and at least one path; every `except` entry also matches the rule's own paths;
    no key this check does not read."""
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as error:
        raise MappingError(f"not valid TOML: {error}") from None
    unknown = set(data) - _TOP_KEYS
    if unknown:
        raise MappingError(f"unknown top-level keys: {sorted(unknown)}")
    if data.get("version") != 1:
        raise MappingError("version must be 1")
    default = _level(data.get("default"), "default")
    raw = data.get("rule")
    if not isinstance(raw, list) or not raw:
        raise MappingError("no [[rule]] entries")
    rules: list[Rule] = []
    for index, entry in enumerate(raw, start=1):
        where = f"rule {index}"
        if not isinstance(entry, dict):
            raise MappingError(f"{where}: not a table")
        unknown = set(entry) - _RULE_KEYS
        if unknown:
            raise MappingError(f"{where}: unknown keys {sorted(unknown)}")
        why = entry.get("why")
        if not isinstance(why, str) or not why.strip():
            raise MappingError(f"{where}: needs a non-empty `why`")
        paths = _globs(entry.get("paths"), f"{where} paths")
        excepted = _globs(entry.get("except", []), f"{where} except") if "except" in entry else ()
        for glob in excepted:
            if not any(PurePosixPath(glob.replace("*", "x")).full_match(p) for p in paths):
                raise MappingError(f"{where}: except {glob!r} is outside the rule's own paths")
        bot = entry.get("dependabot")
        if bot is not None and bot not in _DEPENDABOT_KINDS:
            raise MappingError(f"{where}: dependabot must be one of {_DEPENDABOT_KINDS}")
        level = _level(entry.get("class"), where)
        rules.append(Rule(level, why.strip(), paths, excepted, bot))
    return Mapping(default, tuple(rules))


def classify(path: str, mapping: Mapping) -> tuple[int, str]:
    """The highest class of every rule matching `path`, with that rule's reason; the
    default when none matches. Rule order never matters."""
    best: tuple[int, str] | None = None
    for rule in mapping.rules:
        if rule.matches(path) and (best is None or rule.level > best[0]):
            best = (rule.level, rule.why)
    if best is None:
        return mapping.default, "no rule matches this path: the default"
    return best


def explicitly_matched(path: str, mapping: Mapping) -> bool:
    return any(rule.matches(path) for rule in mapping.rules)


def classify_both(path: str, mappings: Sequence[Mapping]) -> tuple[int, str]:
    """The higher of the classes under each mapping (base and head)."""
    return max((classify(path, m) for m in mappings), key=lambda found: found[0])


# --- The diff --------------------------------------------------------------------------


def parse_name_status(text: str) -> list[Change]:
    """`git diff --name-status -z -M -C` output: status, then one path, or two for a rename
    or a copy, each field ending in NUL."""
    fields = text.split("\0")
    if fields and fields[-1] == "":
        fields.pop()
    changes: list[Change] = []
    index = 0
    while index < len(fields):
        status = fields[index].strip()[:1]
        count = 2 if status in ("R", "C") else 1
        paths = tuple(fields[index + 1 : index + 1 + count])
        if not status or len(paths) != count:
            raise ValueError(f"unreadable diff entry at field {index}: {fields[index]!r}")
        changes.append(Change(status, paths))
        index += 1 + count
    return changes


def _in_tests(path: str) -> bool:
    return path.startswith(TEST_DIRS)


def change_level(change: Change, mappings: Sequence[Mapping]) -> tuple[int, str, str]:
    """A change's class: the highest over its paths and mappings; a deleted test file, or
    one moved out of the test directories, is at least Medium. Returns the class, the
    deciding path and its reason."""
    best = (-1, "", "")
    for path in change.paths:
        level, why = classify_both(path, mappings)
        if level > best[0]:
            best = (level, path, why)
    removed = change.status == "D" or (
        change.status == "R" and _in_tests(change.paths[0]) and not _in_tests(change.paths[1])
    )
    if removed and _in_tests(change.paths[0]) and best[0] < MEDIUM:
        best = (MEDIUM, change.paths[0], "a deleted test file is at least Medium")
    return best


def only_pin_lines(diff: str) -> bool:
    """A unified diff whose every added or removed line is a `uses:` line, and that has at
    least one."""
    changed = [
        line[1:]
        for line in diff.splitlines()
        if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))
    ]
    return bool(changed) and all(_USES_LINE.match(line) for line in changed)


def dependabot_exempt(
    repo: Repo, base: str, head: str, changes: Sequence[Change], mappings: Sequence[Mapping]
) -> bool:
    """Owner decision M3: every change modifies a dependency file, or a workflow's `uses:`
    pins only. Anything else (an added, deleted or renamed file, any other line) is handled
    as any pull request is. Both the base and the head mapping must exempt a path, and a
    path that either marks "pins" needs a pins-only diff."""
    if not changes:
        return False
    for change in changes:
        if change.status != "M":
            return False
        path = change.paths[0]
        kinds: set[str] = set()
        for mapping in mappings:  # the stricter of base and head: each must exempt the path
            matching = [rule for rule in mapping.rules if rule.matches(path)]
            found = {rule.dependabot for rule in matching if rule.dependabot is not None}
            if not found or any(r.dependabot is None and r.level == HIGH for r in matching):
                return False
            kinds |= found
        if kinds == {"any"}:
            continue
        if not only_pin_lines(repo.file_diff(base, head, path)):
            return False
    return True


# --- The body --------------------------------------------------------------------------


def strip_comments(body: str) -> str:
    """The body without HTML comments, in one linear pass. An unclosed comment runs to the
    end, as in HTML."""
    out: list[str] = []
    position = 0
    while True:
        start = body.find("<!--", position)
        if start < 0:
            out.append(body[position:])
            return "".join(out)
        out.append(body[position:start])
        end = body.find("-->", start + 4)
        if end < 0:
            return "".join(out)
        position = end + 3


def sections(body: str) -> dict[str, list[str]]:
    """Each `## heading`'s lines, by its heading text (lower case). A repeated heading
    keeps its first occurrence's lines and its later lines too, in order."""
    found: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in body.splitlines():
        if line.startswith("## "):
            current = found.setdefault(line[3:].strip().lower(), [])
        elif current is not None:
            current.append(line)
    return found


def section(found: dict[str, list[str]], prefix: str) -> list[str] | None:
    for heading, lines in found.items():
        if heading.startswith(prefix):
            return lines
    return None


def parse_declaration(body: str) -> tuple[int | None, str | None]:
    """(the declared class, None) or (None, why it is missing or malformed)."""
    lines = section(sections(strip_comments(body)), "risk class")
    if lines is None:
        return (
            None,
            "Missing: no '## Risk class' section. Fix: use the PR template and tick one box",
        )
    ticked = [match.group(1).strip() for line in lines if (match := _TICK.match(line))]
    if not ticked:
        return None, "Missing: no box ticked under '## Risk class'. Fix: tick one box"
    if len(ticked) > 1:
        return None, f"Malformed: {len(ticked)} boxes ticked. Fix: tick exactly one"
    word = _CLASS_WORD.match(ticked[0])
    if word is None:
        return (
            None,
            f"Malformed: the ticked line '{ticked[0][:60]}' names no class."
            " Fix: tick Low, Medium or High",
        )
    return CLASSES.index(word.group(1)), None


def fields(lines: Iterable[str]) -> tuple[dict[str, str], list[str]]:
    """`Field: value` lines; a value still holding its `<...>` placeholder is empty. Returns
    the fields and the names given more than once."""
    found: dict[str, str] = {}
    repeated: list[str] = []
    for line in lines:
        match = _FIELD.match(line.strip())
        if match is None:
            continue
        name, value = match.group(1), match.group(2).strip()
        if value.startswith("<") and value.endswith(">"):
            value = ""
        if name in found:
            repeated.append(name)
        found[name] = value
    return found, repeated


def subsection_words(lines: Sequence[str], title: str) -> int:
    """The words under `### title` up to the next heading; -1 when there is no such
    subsection."""
    words, inside, seen = 0, False, False
    for line in lines:
        if line.startswith("#"):
            inside = line.lstrip("#").strip().lower() == title.lower() and line.startswith("### ")
            seen = seen or inside
        elif inside:
            words += len(line.split())
    return words if seen else -1


# --- High evidence ---------------------------------------------------------------------


def _resolve(sha: str, commits: Sequence[str]) -> str | None:
    """The one commit of `commits` that `sha` abbreviates, or None."""
    sha = sha.lower()
    if _SHA.fullmatch(sha) is None:
        return None
    hits = [commit for commit in commits if commit.startswith(sha)]
    return hits[0] if len(hits) == 1 else None


def check_design_note(repo: Repo, head: str, found: dict[str, list[str]]) -> list[str]:
    lines = section(found, "design and risk note")
    if lines is None:
        return ["Design note: no '## Design and risk note' section. Fix: add it (PR template)"]
    values, repeated = fields(lines)
    if "Design-note" in repeated:
        return ["Design note: Design-note is given more than once. Fix: give it once"]
    note = values.get("Design-note", "")
    if not note:
        return [
            "Design note: Design-note is missing or still a placeholder."
            " Fix: a docs/ path, inline or private"
        ]
    if _NOTE_IN_BODY.match(note):
        problems = []
        for title in ("What could go wrong", "What happens later"):
            words = subsection_words(lines, title)
            if words < MIN_SECTION_WORDS:
                state = "is missing" if words < 0 else f"has {words} words"
                problems.append(
                    f"Design note: '### {title}' {state}."
                    f" Fix: write it, at least {MIN_SECTION_WORDS} words"
                )
        return problems
    path = note.split()[0].strip("`")
    if path.startswith("private/"):
        return [
            f"Design note: {path[:80]} is git-ignored, so the check cannot see it."
            " Fix: write 'private (owner-held), summary below' and the summary subsections"
        ]
    if not path.startswith("docs/") or not path.endswith(".md"):
        return [
            f"Design note: '{path[:80]}' is not a Markdown file under docs/."
            " Fix: commit it there, or write it inline"
        ]
    text = repo.show(head, path)
    if text is None:
        return [f"Design note: {path} is not in the head commit. Fix: commit it"]
    words = len(text.split())
    if words < MIN_NOTE_WORDS:
        return [f"Design note: {path} has {words} words. Fix: at least {MIN_NOTE_WORDS}"]
    return []


def check_invariants(repo: Repo, head: str, found: dict[str, list[str]]) -> list[str]:
    lines = section(found, "audit invariants touched")
    text = "\n".join(lines or []).strip()
    if not text:
        return [
            "Invariants: '## Audit invariants touched' is missing or empty."
            " Fix: name the ids, or none and why"
        ]
    named = sorted(set(_INVARIANT_ID.findall(text)), key=lambda ident: int(ident[1:]))
    if not named:
        first = text.splitlines()[0].strip().lower()
        reason = re.sub(r"^none\b[\s:.,;-]*", "", first) if first.startswith("none") else ""
        if not first.startswith("none"):
            return [
                "Invariants: no invariant id named. Fix: name the ids (I1 to I16), or none and why"
            ]
        if len(reason.split()) < 2:
            return ["Invariants: 'none' gives no reason. Fix: say why on the same line"]
        return []
    document = repo.show(head, INVARIANTS_PATH) or ""
    known = set(_INVARIANT_ROW.findall(document))
    unknown = [ident for ident in named if ident not in known]
    if unknown:
        return [f"Invariants: {', '.join(unknown)} not in {INVARIANTS_PATH}. Fix: use its ids"]
    return []


def check_review(
    repo: Repo,
    base: str,
    head: str,
    found: dict[str, list[str]],
    pr_paths: set[str],
    mappings: Sequence[Mapping],
) -> list[str]:
    lines = section(found, "independent review")
    if lines is None:
        return [
            "Review: no '## Independent review' section. Fix: add the review record (PR template)"
        ]
    values, repeated = fields(lines)
    names = ("Reviewed-commit", "Reviewer", "Verdict", "Findings")
    problems = [
        f"Review: {name} is given more than once. Fix: give it once"
        for name in names
        if name in repeated
    ]
    for name in names:
        if not values.get(name):
            problems.append(f"Review: {name} is missing or still a placeholder. Fix: fill it in")
    if values.get("Verdict") and values["Verdict"] != "SHIP":
        problems.append(
            f"Review: the verdict is '{values['Verdict'][:30]}', not SHIP."
            " Fix: review again after the fixes"
        )
    sha = values.get("Reviewed-commit", "")
    if not sha:
        return problems
    commits = repo.commits(base, head)
    reviewed = _resolve(sha, commits)
    if reviewed is None:
        problems.append(
            f"Review: {sha[:40]} is not a commit of this pull request."
            " Fix: name the reviewed commit"
        )
        return problems
    stale = sorted(
        path
        for path in set(repo.changed_between(reviewed, head)) & pr_paths
        if classify_both(path, mappings)[0] == HIGH
    )
    if stale:
        shown = ", ".join(stale[:3]) + (f" and {len(stale) - 3} more" if len(stale) > 3 else "")
        problems.append(
            f"Review: {len(stale)} High paths changed after the review of {reviewed[:7]}:"
            f" {shown}. Fix: review again"
        )
    upto = set(repo.commits(base, reviewed))
    for fix in _FIXED_IN.findall(values.get("Findings", "")):
        if _resolve(fix, sorted(upto)) is None:
            problems.append(
                f"Review: the fix {fix[:12]} is not in the reviewed code."
                " Fix: review again, or correct the record"
            )
    return problems


# --- The whole check -------------------------------------------------------------------


def load_mappings(repo: Repo, base: str, head: str, override: str | None) -> list[Mapping]:
    if override is not None:
        return [parse_mapping(override)]
    texts = [
        text for text in (repo.show(base, MAPPING_PATH), repo.show(head, MAPPING_PATH)) if text
    ]
    if not texts:
        raise MappingError(f"{MAPPING_PATH} is in neither the base nor the head commit")
    return [parse_mapping(text) for text in texts]


def evaluate(
    repo: Repo,
    base: str,
    head: str,
    body: str,
    author: str,
    mapping_override: str | None = None,
) -> Report:
    report = Report()
    try:
        mappings = load_mappings(repo, base, head, mapping_override)
    except MappingError as error:
        report.computed = report.effective = HIGH
        report.failures.append(f"Mapping: {error}. Fix: correct {MAPPING_PATH}")
        return report
    changes = repo.changes(base, head)
    report.changed = len(changes)
    ranked: list[tuple[int, str, str]] = [change_level(change, mappings) for change in changes]
    report.computed = max((level for level, _path, _why in ranked), default=LOW)
    report.deciding = [
        (path, why) for level, path, why in sorted(ranked, key=lambda r: r[1])
        if level == report.computed and changes
    ][:5]  # fmt: skip
    pr_paths = {path for change in changes for path in change.paths}
    if MAPPING_PATH in pr_paths and len(mappings) == 2:
        old, new = mappings
        report.lowered = [
            path for path in repo.tracked(head) if classify(path, new)[0] < classify(path, old)[0]
        ]
        if report.lowered:
            report.computed = HIGH
    if author == DEPENDABOT and dependabot_exempt(repo, base, head, changes, mappings):
        report.exempt = (
            "a Dependabot update of dependency files or workflow pins only (decision M3)"
        )
        report.effective = report.computed
        return report
    declared, problem = parse_declaration(body)
    report.declared = declared
    if problem is not None:
        report.failures.append(f"Declaration: {problem}")
    if declared is not None and declared < report.computed:
        report.failures.append(
            f"Declaration: declared {CLASSES[declared]},"
            f" the paths require {CLASSES[report.computed]}."
            " Fix: tick the higher class (a wrong minimum is fixed in the mapping, a High change)"
        )
    report.effective = max(report.computed, declared if declared is not None else LOW)
    if report.effective == HIGH:
        found = sections(strip_comments(body))
        report.failures += check_design_note(repo, head, found)
        report.failures += check_invariants(repo, head, found)
        report.failures += check_review(repo, base, head, found, pr_paths, mappings)
    return report


def render(report: Report, report_only: bool = False) -> list[str]:
    """At most 20 lines: the verdict, the classes, the deciding paths and every failure
    with its fix (the runner's convention)."""
    verdict = "FAIL" if report.failures else "PASS"
    mode = " (report only: not enforced)" if report_only else ""
    declared = "none" if report.declared is None else CLASSES[report.declared]
    lines = [
        f"Risk class: {verdict}{mode}",
        f"Computed minimum {CLASSES[report.computed]} from {report.changed} changes;"
        f" declared {declared}; effective {CLASSES[report.effective]}",
    ]
    if report.exempt:
        lines.append(f"No declaration needed: {report.exempt}")
    for path, why in report.deciding:
        lines.append(f"  {path}: {why}")
    if report.lowered:
        shown = ", ".join(report.lowered[:3])
        lines.append(f"This mapping lowers {len(report.lowered)} tracked files ({shown}): High")
    room = MAX_LINES - len(lines)
    failures = report.failures
    if len(failures) > room:
        failures = [*failures[: room - 1], f"... and {len(failures) - room + 1} more failures"]
    lines += [f"- {failure}" for failure in failures]
    return lines[:MAX_LINES]


# --- git -------------------------------------------------------------------------------


class GitRepo:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.root,
            check=check,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def show(self, rev: str, path: str) -> str | None:
        found = self._git("show", f"{rev}:{path}", check=False)
        return found.stdout if found.returncode == 0 else None

    def changes(self, base: str, head: str) -> list[Change]:
        out = self._git("diff", "--name-status", "-z", "-M", "-C", f"{base}...{head}").stdout
        return parse_name_status(out)

    def commits(self, base: str, head: str) -> list[str]:
        return self._git("rev-list", f"{base}..{head}").stdout.split()

    def changed_between(self, older: str, newer: str) -> list[str]:
        out = self._git("diff", "--name-only", "-z", "--no-renames", older, newer).stdout
        return [path for path in out.split("\0") if path]

    def tracked(self, rev: str) -> list[str]:
        out = self._git("ls-tree", "-r", "-z", "--name-only", rev).stdout
        return [path for path in out.split("\0") if path]

    def file_diff(self, base: str, head: str, path: str) -> str:
        return self._git("diff", "-U0", f"{base}...{head}", "--", path).stdout


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--base", required=True, help="the pull request's base commit")
    parser.add_argument("--head", required=True, help="the pull request's head commit")
    parser.add_argument("--repo", default=".", help="the repository (default: here)")
    parser.add_argument(
        "--mapping",
        help="read the mapping from this file for both base and head (a dry run of older pull"
        " requests, which have none)",
    )
    parser.add_argument(
        "--report-only", action="store_true", help="report the verdict, exit 0 whatever it is"
    )
    args = parser.parse_args(argv)
    repo = GitRepo(Path(args.repo))
    override = Path(args.mapping).read_text(encoding="utf-8") if args.mapping else None
    body = os.environ.get("BODY", "")
    author = os.environ.get("AUTHOR", "")
    report = evaluate(repo, args.base, args.head, body, author, override)
    lines = render(report, args.report_only)
    print("\n".join(lines))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("```\n" + "\n".join(lines) + "\n```\n")
    if report.failures and args.report_only and os.environ.get("GITHUB_ACTIONS"):
        print(
            "::warning title=Risk class (report only)::"
            f"{len(report.failures)} failures; see the job summary"
        )
    return 1 if report.failures and not args.report_only else 0


if __name__ == "__main__":
    sys.exit(main())
