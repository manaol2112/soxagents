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
| High | Touches any of: authorization or sessions; tenant scoping; a migration or stored data; approvals, sign-offs or review independence; outbound email or anything a client receives; model prompts, tools or budgets; the background workers; a public API body; a destructive command | A written design and risk note agreed before coding; the critical tier, which CI runs on every push and pull request (G4), while locally G1 runs the touched area's safeguard tests (`docs/test-strategy.md` §1); independent review (section 5) |

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

## 9. Prompt versions

Each prompt builder records a version (`PROMPT_VERSION` or an inline label such as
`attributes/9`) with every model call, so the record shows which instructions produced an
answer. Some versions are also compared: the evidence assurance check treats a run whose
prompt versions differ from `ENGINE_PROMPTS` as out of date, and offers to run it again.

**Bump a builder's version when what it asks the model changes:** its instructions, its
output schema, the facts it includes or how it lays them out, or how its own code prepares
the data. Bump it in the same commit, with a dated comment.

**Do not bump it when its code is unchanged** and only shared behaviour beneath it changed,
such as how `prompt_data.neutral()` makes tag-shaped text inert. Ordinary data reaches the
model exactly as before; only hostile or tag-like text is quoted differently, so the
builder's instructions and answers do not change. Bumping would mark existing runs out of
date and ask people to repeat work for no change in what is asked.

Decided by the product owner on 18 November 2026, after `neutral()` was widened (governance
finding S1): the twenty builders whose own code changed were bumped; control-tester,
evidence-mapping, the evidence-assurance assessor and reviewer, workpaper-preparer,
evidence-reader, evidence-review and console were not, their code being unchanged. The same
rule was followed on 17 November when `neutral()` was first added to those builders. A
contractual or regulatory requirement to version every change of input would override this.

## 10. What is enforced by a check, not by this file

| Rule | Check |
| --- | --- |
| Every test file belongs to a tier | `services/api/tests/test_test_tiers.py` |
| `make reset` cannot delete data by accident | `tests/data-protection.test.ts` |
| No API route serves another firm, and every route outside an organization is listed with a reason | `services/api/tests/test_route_authorization.py` |
| Applied migrations are contiguous and unchanged | `services/api/tests/test_migrations.py` |
| Line endings | `.gitattributes` |
| Format, lint, types, critical tests, all node tests | `.github/workflows/ci.yml` |
| Client-facing copy, design tokens, button hover | The guard tests under `tests/` |
| A request that changes something comes from the workspace's own origin | `apps/web/src/origin-guard.ts`, applied in `apps/web/proxy.ts`; `tests/origin-guard.test.ts` |
| The API paths the web spells out exist in the API | `services/api/tests/test_web_calls_api_routes.py` (paths built elsewhere are counted, not followed) |
| Both background workers offer the same jobs, and every job looked up by name exists | `services/api/tests/test_scheduler_parity.py` |
| Every request status change follows the transition table or a named service move | `services/api/tests/test_request_status_moves.py` |
| No secret in any commit | `.github/workflows/security.yml` (gitleaks over the whole history; checked false positives in `.gitleaksignore`) |
| No known advisory in a locked dependency | `.github/workflows/security.yml` (`pnpm audit`, `pip-audit`), on lockfile changes and weekly; updates proposed by `.github/dependabot.yml` |
| Every audit invariant is held by a critical-tier test, and every open part names its increment | `services/api/tests/test_audit_invariants.py` |
| Every model entry point fails closed against the hostile model | `services/api/tests/test_model_contract.py` |

## 11. Fail closed

Decided by the product owner on 19 November 2026 (the process change: audit rules,
fail-closed, a hostile test model).

A step that can be incomplete is complete only when it shows it is. When a model call, a
check, a comparison, a reviewer or a refresh fails, times out, is cut off, is malformed, or
returns nothing or only part of what it was asked, the result is the open state: UNABLE or
REVIEW for a test result, CANNOT_TELL or UNSETTLED for a D&I element, NOT_REVIEWED for a
review, still due for a refresh. The earlier state is kept only while its basis is
unchanged: when the rerun was triggered by a change to its basis (evidence replaced or
withdrawn, a placeholder filled, an attribute or criterion reworded), the earlier favourable
result is open, as stale, until a run on the current basis succeeds. It is never a pass, a
covered or verified item, a completed review, "nothing to add" or "nothing due".

- Count what came back against what was asked. Every in-scope item has its own verdict, or
  the whole is not reviewed. An empty list, a missing key or an id that was not asked about
  is not an answer.
- A fallback, a default or a rules-only path never reports more than it checked, and never
  clears a gate that the agent's work would have cleared.
- Absence is not a finding either way: missing evidence is NOT_DEMONSTRATED or UNABLE,
  never a pass and never an exception (docs/audit-invariants.md I3).
- A later run that did less never undoes an earlier finding. A note, a flag or a due state
  is withdrawn only by a run that covered the same item, or by a person.
- Every model-facing entry point is shown to fail closed against
  `services/api/tests/hostile_model.py` (`services/api/tests/test_model_contract.py`). A new
  entry point joins that registry in the same change.
- Reviewers ask of each new branch: what does it record when its input is empty, partial or
  malformed?
