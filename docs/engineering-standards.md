# Engineering standards

How a change is made here, by a person or an agent. `AGENTS.md` holds the short rules that
are always in force; this file holds the detail and is read when a rule needs it.
Adopted 17 November 2026 after the governance assessment. It adds to the milestone, UI
review and test-tier rules in `AGENTS.md` and `docs/test-strategy.md`; it replaces none.

## 1. Find what exists before writing

Before new code:

1. Find the owning area in `docs/architecture.md`.
2. Find the function, component or query that already does this or nearly does. Search
   by behaviour, not only by name.
3. Read the tests that cover it.
4. Choose the smallest change that fits the owning module.

A new module, dependency, table, background job type or abstraction needs one sentence
of reason in the change's description. "It was easier" is not a reason. A second
implementation of something that exists is a defect, not a style choice.

## 2. Risk class

Classify by what could go wrong, not by how many files change.

| Class | It is this when | What it requires |
| --- | --- | --- |
| Low | Local and reversible. No effect on security, stored data, or another module's interface | Targeted tests for the change |
| Medium | Changes behaviour that several screens or modules share, or an interface between modules | A short impact note (what else calls this, what could regress) before coding; tests for the affected callers |
| High | Touches any of: authorization or sessions; tenant scoping; a migration or stored data; approvals, sign-offs or review independence; outbound email or anything a client receives; model prompts, tools or budgets; the background workers; a public API body; a destructive command | A written design and risk note agreed before coding; the critical tier; independent review (section 5) |

When unsure between two classes, take the higher.

## 3. Scope

- Do what the acceptance criteria say. No unrelated refactoring, renaming or reformatting.
- No speculative features or options nobody asked for.
- Say so when the work had to depart from the agreed approach, before finishing.
- Leave stable interfaces alone unless the change is about them.

## 4. Defects: fix the cause

1. Reproduce it, or describe exactly when it happens.
2. Trace the path to the first wrong value or decision.
3. Fix that, in the module that owns it.
4. Add a test that fails without the fix.
5. Check the neighbours: the same mistake elsewhere, and the callers of what changed.

Do not add a fallback, a retry or a broad `except` that makes the symptom disappear. A
failure that is hidden is harder to fix than one that is shown.

## 5. Independent review

- **UI changes:** the `ui-reviewer` agent, as `AGENTS.md` already requires.
- **High-risk changes:** a reviewer that did not write the change, given the diff and the
  design note, not the author's conclusion. It checks correctness, the security and data
  rules in `AGENTS.md`, regression risk, test adequacy, needless complexity and scope.
- Findings cite the file and line and carry a severity. "No findings" is a valid result.
  A review is not repeated to look thorough: after three rounds without convergence, stop
  and re-plan.

## 6. Done

A change is done when all of these hold:

- [ ] The acceptance criteria are met.
- [ ] Existing code was reused where it fit; anything new is justified.
- [ ] The checks for its risk class ran and their results are stated. Nothing is called
      passing that was not seen to pass.
- [ ] Any failure is either fixed or already in `docs/test-baseline.md`.
- [ ] Authorization, tenant scope and approval boundaries are as they were, or the change
      to them was the approved purpose.
- [ ] Failure paths that matter are handled and visible.
- [ ] The diff holds nothing unintended.
- [ ] What is not done, and any limitation, is written down.

## 7. Several agents at once

- **One writer per file.** Agents that write in parallel get separate worktrees or
  branches, or file lists that do not overlap.
- **Shared contracts change one at a time:** migrations, the scheduler interface, API
  bodies, design tokens, the Makefile, `AGENTS.md`.
- **A migration gets its number when it is integrated,** from the coordinator. Applied
  migrations are never edited or renumbered.
- **The coordinator integrates:** resolves conflicts, runs the affected tests, and is the
  only one that starts, stops or restarts servers. After an API change, confirm the
  development server really reloaded before testing against it.
- **Commit each accepted change.** Work does not pile up uncommitted across changes.
- **Do not spend twice:** one discovery of an area, shared; parallel agents only for
  independent work; no reviewer launched for show.

## 8. What needs a person's approval

- A migration, or any change to stored data.
- A change to an authorization, approval or independence boundary.
- A new dependency or a new piece of infrastructure.
- A destructive command (`make reset`, dropping a database, rewriting git history).
- Pushing, merging to a protected branch, or deploying.
- Anything that sends a real message to someone outside the team.
- An exception to a rule in this file or in `AGENTS.md`.

## 9. What is enforced by a check, not by this file

| Rule | Check |
| --- | --- |
| Every test file belongs to a tier | `services/api/tests/test_test_tiers.py` |
| `make reset` cannot delete data by accident | `tests/data-protection.test.ts` |
| No API route serves another firm, and every route outside an organization is listed with a reason | `services/api/tests/test_route_authorization.py` |
| Applied migrations are contiguous and unchanged | `services/api/tests/test_migrations.py` |
| Line endings | `.gitattributes` |
| Format, lint, types, critical tests, all node tests | `.github/workflows/ci.yml` |
| Client-facing copy, design tokens, button hover | The guard tests under `tests/` |

Planned, not yet built: a test that web proxies call routes that exist; a secret scan in CI.
