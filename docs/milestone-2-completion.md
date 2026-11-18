# Milestone 2 completion report: one application

**Accepted by the product owner on 21 October 2026** (the M2d report conditionally, the closure report on the same day). Presented for the product owner's review on 21 October 2026. Milestone 2 ran in four
stages, each reviewed before the next: M2a the engagement's one queue (commit 2d5a086),
M2b queue completeness, the four buckets and the Testing destination (3309686), M2c the
six destinations and the redirects (6480232), M2d the guided workspace as the one control
interface, the plan review inside it, the inbox from the queue alone and direct internal
links (uncommitted, this report). The design is [milestone-2-plan.md](milestone-2-plan.md)
(§11 to §15 record what was built); the parity inventory is
[milestone-2-parity.md](milestone-2-parity.md); the evidence is under `docs/review/m2a`
to `m2d`, indexed in `docs/review/README.md`.

## What the application is now

- **One menu, six destinations**: Home, Controls, Testing, Evidence, Reports, Settings.
  Reports (Deficiencies, Schedule, Timeline, Status and reports) and Settings (Engagement,
  Library, AI workforce, Tasks, Engagements) are tabs over the pages that existed. The
  fourteen older section addresses answer 307 from the edge proxy to the destination that
  holds their page, with the record kept; internal links name the destinations directly.
- **One queue**: every actionable obligation, read from its own record and the rule that
  decides it, once, with its owner, bucket (MINE, WAITING, BLOCKED, UPCOMING), hold and
  destination. Home, the console inbox and the register read it; the obligation-to-item
  mapping is §12; the reconciliation across three viewers is in `docs/review/m2d/`.
- **One control interface**: Plan → Request → Test → Conclude → Review, with the plan
  reviewed and approved inside the Plan step by the same component Testing › Plans uses,
  the Needs-you card, Agent says, the trace rail, and the activity record below the steps.
  The classic tabs are retired; their links open the step that holds the work.
- **One Testing destination**: Plans, Phases, Results and Review across every control,
  built from the existing components, folding to cards at phone width.

## Acceptance criteria (milestone-2-plan.md §7)

| Criterion | Result | Evidence |
| --- | --- | --- |
| One queue: Home, the inbox and the register show identical items for a viewer; every inbox kind and approvals row is in the queue with the same link | PASS | `test_queue.py` (seven tests), `docs/review/m2d/queue-reconciliation.md` (three viewers, counts and identities), the console's own derivations deleted |
| Every action of Test plans, Approvals, Project plan, Timeline, Deficiencies and the classic tabs is available in the destinations or the queue | PASS | `milestone-2-parity.md`; the cross-role walkthroughs performed the actions through the new pages; the approvals page and the agent console remain reachable where the queue and Reports › Status lead to them |
| No page recomputes a control's stage, step or next action on the client | PASS | The client-side `attentionQueue` and the register's row-derived action center were deleted in M2a; the workspace, register and queue read the journey and the register row; the Testing Results row reads the sheet, round and row |
| Every old section URL and stored link shape lands on the right record | PASS | `shell-model.test.ts` (fourteen sections, nine stored link shapes), `docs/review/m2c/redirects.md` and `m2d/redirects.md` (live 307s) |
| Batch approvals record one decision per plan version; the requester never approves their own request; a reviewer is offered only controls they may act on | PASS | Unchanged routes and tests (`test_master_plans`, `test_approvals`, `test_independence`); the queue's authorization follows the same rules (`test_queue.py`); walkthrough J2's refused sign-off |
| Agent says and the activity record say what the agents did, propose and wait for, with the execution state from the run records; nothing shown as running without a worker | PASS | M1c/M1d tests kept; the queue's UPCOMING/BLOCKED reading of queued agent work; "Automation unavailable" on the scale engagement |
| Desktop and mobile screenshots of each destination; no horizontal overflow at 390; keyboard paths | PASS with a note | Screenshots in `m2b`, `m2c`, `m2d`; document width 390 measured on Home, Testing, Reports, Settings and the control record; keyboard paths were not exercised by an automated test (the rail, tabs and queue are links and buttons, so the browser's own tab order applies) |

## Retired and retained

Retired: the classic control tab bar and its seven tab pages as destinations, the audit
progress bar, the overview's next-action panel, summary metrics and agent roster, the
"All details" link, the `?tab=` page mode; the Test plans, Project plan, Timeline,
Deficiencies, Engagement settings, Library, AI workforce and Engagements menu entries
(their pages live under Testing, Reports and Settings); the client-side queue
derivations and the console's own waiting derivation.

Retained, out of the menu and reachable from the pages that lead to them: the agent
console (the five engagement reports are produced there; Milestone 3 makes it the
companion panel), the approvals page (every approval item opens it), the engagements page
(behind the switcher and Settings › Engagements).

## Testing (risk-based; the full legacy suite was not run)

| Stage | Critical set | Fast set | Whole Node set |
| --- | --- | --- | --- |
| M2a | 358 passed | 87 Python, 108 Node | 706 |
| M2b | 362 passed | 87 Python, 112 Node | 711 |
| M2c | 363 passed | 87 Python, 112 Node | 714 |
| M2d | 363 passed (4 min 59 s) | 87 Python, 112 Node | 714 |

Type checks clean at each stage; lint clean except the known `biome.json` line endings.
Legacy expectations rewritten, each with its justification in `docs/test-strategy.md`
§5: the inbox lists per-request items and reads the queue (`test_evidence_flow`,
`test_waiting`), the next-steps link names Testing (`test_next_steps`), addresses name
the destinations (Node `directory`, `library-model`, `planning-model`), the client-side
queue tests retired with the deleted function (M2a). No audit-integrity assertion was
weakened.

## Safeguards

No authorization, tenant isolation, segregation of duties, evidence custody, approval
gate, version check, immutable history, deficiency closure or independent review rule
changed in Milestone 2. The queue reads the same rules the actions apply and never acts;
every write still goes through its registered route to the API, which checks them again
and records the audit event. No workflow engine or new backend state was introduced
(the one migration of the period, 0093, predates Milestone 2 and belongs to the
acceptance follow-ups).

## Scale

155 and 403 controls: `GET /queue` 231 ms and 350 ms median, 166 and 246 statements;
growth well under linear; the Plans view's `planning-review` read is the one to revisit
first (§14).

## Remaining limitations and technical debt

- The queue's readiness for a drafted request does not read the approval checks the page
  applies (recipient allowlist, request quality); an item can be MINE while the page
  refuses until the checks pass.
- The console page still exists as a destination with its own chat and activity list;
  its inbox is the queue. Milestone 3 turns it into the companion panel.
- Settings › Engagement is the setup wizard's step pages, which still read as a wizard
  after launch.
- The API's `next_steps` remains beside the queue for Home's journey bar (figures only).
- Opening a control reads the master plan and the phase progress for the embedded plan
  review, about two reads more than before.
- The portal's final "Submit evidence" step was not exercised in the walkthroughs (the
  upload itself reached the team); keyboard paths were not automated.
- Live model responses, a running worker and outbound email remain unvalidated in this
  environment; the walkthroughs say where a record was simulated.

## Closure (after the M2d review)

M2d is committed as e818eae. The closure activities asked for are complete; their detail
is [milestone-2-plan.md §16](milestone-2-plan.md) and the evidence is under
`docs/review/m2-closure/`.

- **Evidence-request approval readiness.** The queue no longer says a drafted request is
  the approver's to act on when the approval endpoint would refuse it. It reads
  `request_details.draft_blockers`, the endpoint's own rule (planning hold, recipient and
  allowlist, request type, phase release, period, plan mapping, duplicates, wording)
  batched for the engagement, with the deciding functions shared with the single-request
  path and a test that the two agree for every draft under two allowlists. A held draft
  is BLOCKED with the endpoint's words and belongs to the preparer who resolves it; the
  endpoint applies the rule again, with its own settings and the record's version, when
  the action is taken; the requester-approver separation is the endpoint's and unchanged.
  Before and after (`queue-readiness.md`): at 155 controls, 287 drafts all MINE before;
  after, 283 MINE and 4 BLOCKED with their reasons; under an allowlist naming another
  domain, 287 BLOCKED. Queue time 205 ms → 581 ms at 155 controls, 297 ms → 808 ms at
  403 (17 statements for the whole rule). Tests: allowed and blocked domains, a missing
  recipient, a member who may prepare but not approve (403), the allowlist changed between
  the queue's reading and the action (409), a stale version (409), the approval (200).
- **Client portal final submission** (`portal-smoke.md`): the owner opened the authorized
  link, confirmed identity with the previewed one-time code, uploaded a file to each
  required item, submitted through the confirmation dialog and saw "Submitted" with the
  date; the team's record shows the submission time, the `evidence.portal_submitted`
  audit event and both files on the right request of the right engagement; a wrong
  token and a revoked link are refused. Outbound email was not exercised (no sender).
- **Keyboard accessibility** (`keyboard.md`): the stepper, the plan review's actions, the
  queue, the phone-width Details disclosures and the close-out dialog work by keyboard
  with visible focus; no material blocker. Noncritical debt: Space on a Details
  disclosure under the driver, focus after Escape returning to the document, "Log a
  deficiency" reloading the page, and one unplaced stop in the portal dialog's Tab trail
  to confirm by hand.
- **Preserved**: the console reporting interface, the Settings wizard pages and the
  embedded plan review are unchanged; their limitations and the extra reads stand.
- **Tests**: `make test-critical` 365 passed, 0 failed (5 min 1 s); `make test-fast` 87 Python and 112 Node
  passed; type checks clean; lint clean except the known `biome.json` endings. One
  expectation rewritten (`test_evidence_flow`: the inbox states the planning hold in the
  approval endpoint's words).
- **Unresolved critical issues**: none.

## Remaining noncritical limitations at acceptance

- The queue's drafted-request readiness rule costs about 0.35 s per queue read at 155
  controls (0.5 s at 403); the per-draft wording parse and classification are the
  remaining cost, to optimise if engagements grow.
- Opening a control reads the master plan and the phase progress for the embedded plan
  review, two reads more than before.
- The console page remains a destination with its own chat and activity list (its inbox
  is the queue); Milestone 3's companion panel is deferred behind the agent work.
- Settings › Engagement is the setup wizard's step pages, which still read as a wizard
  after launch.
- The API's `next_steps` remains beside the queue for Home's journey bar (figures only).
- Keyboard: Space on a Details disclosure was not confirmed under the driver (Enter
  works); focus after Escape on the close-out dialog returns to the document; "Log a
  deficiency" reloads the page with the form open; one stop in the portal dialog's Tab
  trail is to be confirmed by hand.
- Outbound email, a running worker and live model responses remain unvalidated; the
  walkthroughs state where a record was simulated.

## Recommended next

Milestone 3: the Agent Companion panel in place of the console page, with the queue's
items as its thread list, and the two queue readiness gaps above. Nothing from Milestone
3 has been started.
