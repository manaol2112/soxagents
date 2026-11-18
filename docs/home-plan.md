# Home: review and redesign plan

Prepared at the owner's request, 21 October 2026.

This plan is grounded in the code (`engagement-view.tsx`, `home-view.tsx`, `queue-panel.tsx`, `queue.py`, `workspace-view.tsx`) and in the Milestone 2 decisions it must keep. It was checked against the synthetic demonstration engagements as the preparer and owner, as the reviewer, and on an engagement with nothing planned, at 1440 and 390 px.

Nothing here is built yet.

## 1. What Home is for

Home answers four questions, in this order. Everything else lives in its destination.

1. **What needs me now?** The viewer's own next actions, the first one obvious.
2. **What is stuck, and what clears it?** Held work, grouped by cause, each cause with its one fix.
3. **Where does the engagement stand?** The six stages, shown once.
4. **What is at risk, and what is due?** Deficiencies by severity, the next milestones, and the schedule.

The questions are the same for every role; the answers differ because the queue is computed per viewer:

- **Preparer or lead:** mostly the first two questions.
- **Independent reviewer:** reviews to decide and sign off.
- **Manager or admin reading without being on the team:** mostly the last two.

## 2. Constraints kept (decided in Milestone 2)

- **One queue.** Home, the agent console's inbox and the register show identical items for the same viewer (`test_queue`, the M2d reconciliation, and M3e's acceptance). A change to which items exist, or to their bucket, is made once in `queue.py`, never in one page.
- **No client recomputation.** No page works out a control's stage, step, next action, owner or readiness. The web groups, orders and links the API's items.
- **One overview.** Home is the only dashboard. Its figures come from the dashboard API, read with the queue.
- **Repeated steps fold** into one expandable row with their count.
- **Phone:** rows stack the title, whose it is and the one action; nothing needs hover.
- **Copy** is client-facing and neutral; it never explains the system's internals.

## 3. Findings

| # | Finding | Cause in the code |
| --- | --- | --- |
| F1 | The first action is not the first thing seen. Three rows of filter chips come before any work; on a phone the first action is about 900 px down. The header's primary button is "Project plan". | `QueuePanel` puts the filters first; `EngagementDashboard` hard-codes the header actions. |
| F2 | Three different "open" figures on one page: "126 of 126 tasks open", "64 open", and "63 tasks waiting on earlier work". | The header counts the launch work plan's tasks (people's and agents'); the Work card counts queue obligations; the agent card counts agent tasks. |
| F3 | 61 rows are held by one cause with one fix, and Home shows neither. Each says "Waits on the preparer. Open for the list." | Every drafted request carries the blocker "Assign a recipient" (no evidence coordinator). The dashboard has a banner naming the cause and the fix ("Assign the evidence coordinator"), but it is switched off whenever the queue is shown (`home == null`). |
| F4 | "Blocked" mixes work the viewer can clear with work nobody can act on. The preparer's 61 requests read as stuck. The reviewer, with nothing to do, sees 62 "blocked" items first. | `_bucket`: any item not ready is BLOCKED, whoever resolves it. The items do carry `authorized` (the viewer may act) and `blockers`. |
| F5 | A system condition is repeated inside work items, in red: "Held by: Automation unavailable: no worker is configured…". | `NO_WORKER` is added to each queued agent item's blockers. |
| F6 | The same progress appears three or four times: evidence in the journey bar, a health figure and the Evidence card; testing in the journey bar, a health figure and Control testing progress; review in the journey bar and a seven-tile card. | `EngagementDashboard` composes all of them under the journey bar. |
| F7 | **Two Homes.** Before kickoff, Home is a different, older page with its own five-step "Audit lifecycle" (Scope, Evidence, Test, Review, Report) under the six-stage journey bar. It also has a second "Waiting on you" list, its own figures and an "Agent controls" explainer. | `workspace-view` renders `CommandCenter` unless `dashboard.started`. |
| F8 | Figures that read wrongly. "Testing concluded 0 · 0% · 1 with exceptions" is in red: no control is concluded, and red signals a risk that is not there. | The exception count is controls with exceptions so far, shown beside the concluded count; the tone is red whenever exceptions exist. |
| F9 | Low-value or empty content: business process and key report rows saying "0 of 0, none in scope"; a seven-colour legend for a bar showing two; seven review tiles that are mostly zero; per-agent backlog bars. | Categories and tiles are always rendered; "Open work by agent" is a workforce view. |
| F10 | The schedule has no dates or axis; long phase names are cut ("Roll-forward and year-end t…"); the red today line is unlabelled. | `MiniTimeline` draws bars without an axis, and the labels have a fixed width. |
| F11 | Copy that describes the implementation: "One list: the register, the agent console and this page read the same records"; "the role is yours by assignment or engagement role, and the record is ready"; "Yours." on rows. | Bucket notes and card descriptions in `queue-model` and `queue-panel`. |
| F12 | On a phone the page is about 4,700 px long. The health figures become five tall cards, the review card seven tiles, and the filters wrap to three chip rows. | No phone-specific folding. |

## 4. The redesigned Home

### Layout

- **Desktop (≥ 1200 px):** two columns. The main column, about two thirds wide, holds the work. A right rail holds status and dates.
- **Below 1200 px:** one column, in the same order.

```
┌ Header ──────────────────────────────────────────────────────────────┐
│ SOX 2027 · Active          [Primary: the viewer's top action]   ⋯    │
│ Period ends 31 Dec 2027 · Evidence stage · Next: first evidence due   │
│ 31 Oct (10 days)                                                      │
├ Notices (only when a condition exists) ──────────────────────────────┤
├ Journey: six stages, each with its figure and link ──────────────────┤
├───────────────────────────────────────────┬──────────────────────────┤
│ Needs you (top 5)                          │ Engagement at a glance   │
│ Stuck, by cause                            │   4 figures              │
│ Waiting on others (summary)                │ Next milestones          │
│ Upcoming (summary)                         │ Deficiencies             │
│ [Show all work]                            │ Schedule (with axis)     │
└───────────────────────────────────────────┴──────────────────────────┘
```

### Sections

1. **Header.**
   - Engagement name and status.
   - One line: the period end, the current stage, and the next milestone with its date and the days left. This replaces "126 of 126 tasks open".
   - The primary button opens the viewer's top action, the first row of Needs you. With nothing to do, there is no primary button.
   - Timeline and Project plan move to an overflow menu (they are also under Reports).
2. **Notices.** One banner per condition, each saying what it holds and how to clear it:
   - "Agent work cannot start: no worker is configured" (once, not on every row);
   - "61 drafted requests have no recipient: assign the evidence coordinator";
   - period conflicts;
   - controls without an evidence plan.
   These banners already exist; the plan restores the recipient banner and gathers the rest in one place.
3. **Journey bar.** The only progress display, kept as it is: six stages, each with its figure, the current one marked, each a link.
4. **Needs you.**
   - **What it holds:** the queue's MINE items, plus BLOCKED items the viewer may act on (`authorized`), labelled "Clear the hold". Grouping and ordering only; the bucket is not changed.
   - **Rows:** the first five rows, repeated steps folded.
   - **Each row:** control and phase, what to do, why in one plain sentence, and one action button.
   - **"Show all"** opens the full list with filters.
   - **Empty state:** "Nothing needs you now." plus the engagement's next date.
5. **Stuck.**
   - **Grouping:** the remaining BLOCKED items, grouped by cause: "1 re-performance waiting for an agent worker". Each cause with its count and fix.
   - **Collapsed by default** when Needs you has items.
6. **Waiting on others and Upcoming.** One line each, with counts by whose turn it is ("2 with the preparer · 1 with the client"), expandable.
7. **At a glance (right rail).** Four figures, each with one clear definition:
   - **Testing:** "0 of 31 concluded", with "1 control with exceptions so far" as a neutral detail. Red only for risk.
   - **Evidence:** "4 of 65 received · 0 overdue".
   - **Deficiencies:** open, with the most severe named.
   - **Schedule:** "On track", or "N phases behind".
   Colour carries meaning only: red for risk, amber for due soon, green for done or on track.
8. **Next milestones** (right rail). The next three, with dates and days remaining; a status pill only for due soon or overdue.
9. **Schedule** (right rail).
   - **Axis:** a month axis, and a labelled "Today" line.
   - **Labels:** phase names wrap instead of being cut.
   - **Link:** to Timeline.
   - **Phone:** hidden, leaving the link.
10. **Removed from Home:**
    - **Control testing progress and the Independent review card:** their figures are on the journey stages; the detail is in Testing and Review.
    - **The Evidence card:** its figures are in "At a glance" and Evidence.
    - **"Open work by agent":** moves to Settings › AI workforce, beside the agents it describes.
    - **Category rows with nothing in scope:** hidden.

### Filters

The three chip rows become:

- one segmented control: **Needs you · Stuck · Waiting · Upcoming · All**;
- one "Filter" disclosure holding stage and phase (a GET form, the same query parameters).

They appear only in "Show all", not on the default Home.

### One Home in every state

`CommandCenter` is retired. Each state uses the layout above:

- **Before launch:** the journey bar shows Set up as current. Needs you holds the setup steps (the queue's setup items). A "Review and launch" notice appears when setup is ready. The "Agent controls" explainer moves to Settings › AI workforce; "Recent activity" keeps a folded place at the foot of Home in every state.
- **Running:** as above.
- **Paused, completed or archived:** a read-only notice at the top. No Needs you. The figures and reports link remain.

### Phone (390 px)

- **Order:** the header (the primary action full width), notices, journey (a 2×3 grid), Needs you (three rows and "Show all"), Stuck (one summary line), At a glance (2×2 figures), Next milestones.
- **Schedule:** a link to Timeline.
- **Target:** under about 2,000 px by default, and the first action visible without scrolling.

### Copy

Plain and neutral. For example:

- the Work description becomes "What is open on this engagement, by whose it is";
- "Yours." on rows is dropped, since Needs you is by definition the viewer's;
- bucket notes become one short sentence each.

## 5. What needs the API, and the owner's decisions

| # | Decision | Recommended | Alternative |
| --- | --- | --- | --- |
| D1 | **Cause and fix for held work.** To group Stuck by cause and link each cause to its fix without the page knowing the rules, each blocker needs a stable code and a fix link from the API (`queue.py`, additive: blockers become `{code, text, fix}`). | Add it: a small, additive API change, tested in `test_queue`, identical for the inbox and the register. | Presentation only: group by the blocker's text, and link to one example item instead of the fix. Works today; weaker, and more fragile. |
| D2 | **Work the viewer can clear.** | Show BLOCKED items with `authorized` true under Needs you as "Clear the hold". Presentation only; the queue's buckets and counts are unchanged everywhere. | Change `_bucket` so such items are MINE for every consumer. Cleaner semantics, but it changes the Milestone 2 queue baseline, so `test_queue`, the reconciliation and the inbox are all re-validated. |
| D3 | **The header's primary action** is the viewer's top queue item. | Yes. | Keep "Project plan". |
| D4 | **Retire `CommandCenter`** so Home is one page in every state. | Yes. | Keep the older pre-launch page. |
| D5 | **"Open work by agent"** moves to Settings › AI workforce. | Yes. | Keep it on Home, folded. |

**Decided by the owner (21 October 2026):**

- **D1:** add blocker codes and fix links to the queue API.
- **D2:** holds the viewer can clear appear under Needs you; the queue's buckets are unchanged.
- **D3:** the header's primary button is the viewer's top action, and Timeline and Project plan move to an overflow menu.
- **D4:** one Home in every state; `CommandCenter` is retired.
- **D5:** "Open work by agent" moves to Settings › AI workforce.

## 6. Stages

1. **H1, presentation only (no API change).**
   - **Layout:** the new layout and its sections; the header line and primary action (D3).
   - **Notices:** gathered in one place, with the recipient banner restored.
   - **Needs you:** includes "Clear the hold" (D2, recommended form).
   - **Status:** the progress duplicates removed; figures given clear definitions and colours.
   - **Schedule:** an axis and wrapped labels.
   - **Copy:** rewritten.
   - **Phone:** folded as above.
2. **H2, the API (if D1 is approved).** Blocker codes and fix links in `queue.py`; Stuck grouped by cause; `NO_WORKER` shown once as a notice instead of on rows.
3. **H3, one Home.** `CommandCenter` retired (D4); the before-launch and closed states built on the same layout; "Agent controls" and "Open work by agent" moved (D5).

## 7. Validation

- **States**, each with synthetic data from the scale or test databases, never the development database:
  - before launch, part set up;
  - before launch, ready to launch;
  - launched with requests drafted (the demonstration);
  - mid-testing with exceptions;
  - in review with notes to decide;
  - a deficiency in remediation;
  - completed.
- **Roles:** lead or preparer, independent reviewer, approver, and an admin off the team.
- **Widths:** 1440 and 390 px, every combination screenshotted and measured: no horizontal overflow, the first action above the fold, page length.
- **Tests:**
  - Node: `home-model` and `queue-model` (grouping, Needs you including clearable holds, cause grouping);
  - a test that the header's figures reconcile with the queue's counts;
  - `test_queue` and the Home, inbox and register reconciliation (unchanged under D2's recommended form; extended for D1);
  - the form and autofill check;
  - `make test-fast` and `make test-critical`.

## 8. Success criteria

- The viewer's first action is visible without scrolling at 1440×900 and 390×844.
- One definition of "open" on the page, and every figure reconciles with the queue.
- Each progress figure appears once.
- Every held group names its cause and leads to its fix (with D1), or to its items.
- No system condition repeated on rows.
- The same Home structure before launch, while running, and after completion.
- Home, the console inbox and the register still show identical items for the same viewer.
- Phone page length by default under about 2,000 px.

## 9. Progress

**H1 (presentation only): built, 21 October 2026, pending the owner's review.**

- **New files:** `home-work-model.ts` (the sections, the next action, whose turn, due words, stage links, hold counts) and `home-work.tsx`.
- **Restructured:**
  - **`EngagementDashboard`:** the header line and the next action as the primary button, with Timeline and Project plan under More; notices before the journey, with the recipient notice restored; the journey stages as links; the work, and a rail with four figures, milestones, deficiencies and a schedule with an axis.
  - **The removed duplicates:** testing progress, the review tiles and the evidence card.
  - **`QueuePanel`, the full list:** a segmented bucket filter, with stage and phase under one disclosure.
- **Copy:** the bucket notes and descriptions rewritten.
- **Tests:** `tests/home-work-model.test.ts` (6) is added to the fast Node set; every Node test passes (734).

**Checked on the synthetic demonstration engagement (launched, requests drafted)** at 1440×900 and 390×844, as the preparer and owner and as the independent reviewer:

- **Desktop:** no horizontal overflow; page length 2,125 → 1,469 px; the first action at 336 px.
- **Phone:** page length 4,717 → 2,239 px; the next action is the full-width button under the header.
- **The reviewer:** sees "Nothing needs you now", and the preparer's held work folded below.

**Not yet checked:** the other states of the validation matrix (mid-testing, in review, remediation, completed) and the approver and admin-off-team roles. They need synthetic data for those states, built for the final check after H3.

**H2 (hold codes and their fixes): built, 22 October 2026, pending the owner's review.**

- **API (`queue.py`, `request_details.py`):** each queue item now also carries `holds`. A hold has:
  - a stable `code`;
  - its text;
  - a `fix` link to where it is cleared;
  - `system`, which marks the conditions of the environment that no engagement step clears.
  - **System holds:** NO_WORKER and RECIPIENT_NOT_ALLOWED. They have no fix.
  - **Holds with a fix:**
    - RECIPIENT_MISSING opens the evidence requests;
    - planning holds open the control's plan step;
    - task and request-check holds open the item itself.
  - **Unchanged:** `blockers`, buckets, readiness and ordering, which still come from the one queue.
- **Home:**
  - **Needs you** lists only holds the viewer can clear, and each row's Resolve opens the fix.
  - **A group of held rows** names its causes once each, with a count and a Resolve link.
  - **System conditions** are stated once in a notice at the top, naming who clears them: an administrator starts the worker or allows the domain. The rows they hold show "Held by a condition described at the top of the page." and are listed under Blocked; they are never dropped.
  - **The full list's Blocked note** counts clearable holds by the same rule.
- **A defect found and fixed during H2:** work the viewer is authorized for but held only by a system condition was in no section of Home. It is now under Blocked, and the test asserts that every item is in exactly one section.
- **Tests:**
  - `test_queue.py` covers each blocker as a coded hold with its fix.
  - The queue, request-details and drafting API tests pass (44).
  - `tests/home-work-model.test.ts` grows to 11 tests: system-only holds, `holdsOf`, `systemConditions`, `heldRecipients` and `linkHref`.
  - Every Node test passes (739). Ruff, mypy, biome and tsc are clean.

**Checked on the synthetic demonstration engagement:**

- **The owner:**
  - **Desktop:** Needs you went from 63 items to 2 real actions. The 61 requests held by the allowed-domain rule appear under one notice naming the three addresses, and under Blocked.
  - **Phone:** no horizontal overflow.
- **The independent reviewer:** "Nothing needs you now", with Blocked open and both held rows pointing to the notice.
- **The full list (`filter=all`):** each held row keeps its own words, and the Blocked note no longer counts system-held work as clearable.

**H3 (one Home): built, 22 October 2026, pending the owner's review.**

- **`CommandCenter` is retired (D4).** Every engagement that reaches Home now uses the one layout:
  - **Running:** as built in H1 and H2.
  - **Launched without a kickoff on record:** this is where the older page still appeared. It now shows the same Home.
  - **Paused:** a notice at the top (`pausedNotice`). No Needs you, no next action, and no notices that lead to work (system holds, missing recipients, unplanned controls, missing plan). Recent activity is open as the main content; the figures, milestones and schedule remain.
  - **Completed or archived:** the same, under the shell's existing read-only strip (not repeated). Milestones and the "Next:" date are dropped, since nothing is ahead.
  - **No engagement yet:** a short page with "Create an engagement".
  - Whether Home lists work is one lifecycle rule, `homeListsWork` in `engagement-lifecycle.ts`, tested.
- **Departure from §4, before launch.** A draft engagement never reaches Home: an earlier milestone's tested gate (`lockedBeforeLaunch`) sends it to setup with "This engagement has not launched yet". H3 keeps that gate, so the planned setup notice on Home is not built. The old setup callout was already unreachable, because a launched engagement is never in setup, so it was removed. Opening Home before launch would reverse the earlier decision, and is left to the owner.
- **Moved (D5):**
  - "Agent controls" and "Open work by agent" are now on Settings › AI workforce, side by side under the agent tables. The loader reads the dashboard there for the work by agent.
  - "Agent controls" has its own list class (`loop-steps`). An older `.steps` rule, left from a retired chat panel, had drawn a clipped box around it on the old Home.
- **Also:**
  - **Recent activity** is folded at the foot of Home in every state; its chevron turns when opened.
  - **The Schedule figure** reads "Not planned" when an engagement has no phases, instead of "On track".
- **Tests:**
  - `tests/engagement-lifecycle.test.ts` covers `homeListsWork` and `pausedNotice`, and is added to the fast Node set.
  - Every Node test passes (740). Biome and tsc are clean.

**Checked on a synthetic copy of the demonstration database** (`ai_workforce_h3`; never the development database). The states were set there under the database's lifecycle guard, with a recorded completion and a recorded reopening.

- **Running:** the owner and the reviewer at 1440, and the owner at 390. These are unchanged from H2: the phone page is 2,454 px, with no horizontal overflow.
- **Launched without a kickoff, nothing in scope:** the one Home, with "Not planned".
- **Paused and completed:** at 1440, and completed at 390.
- **Settings › AI workforce:** with the running engagement selected.
- **The draft:** confirmed on the setup gate.

**Grouped steps (after H3, 22 October 2026, from the owner's review of "Approve the test plan · 19 controls").**

- **The cause:** one library control scoped to several applications is several controls with one ID (Milestone 8.5), but queue items carried only the ID, so a group listed "ITGC-AC-06" twice. Each row also repeated the group's title. The expanded list was only as wide as its text, and the group offered only one "Open" per control.
- **Fixed:**
  - The queue now sends `control_label`: the control's ID, then its application, by the same rule as every other page (`control_instances.control_label`). Rows read "ITGC-AC-06 · SAP ECC · Interim".
  - Grouped rows show that label alone, span the row, and fold under "Show the N controls". The count names requests when the group is of drafted requests.
  - A group of plan approvals leads with "Review all N plans", which opens Test plans on the plans awaiting a decision or a revision, where a selection is approved together (each recorded on its own). When that group comes first, the header's button goes there too.
  - The older "Waiting on you" list appears only when the queue cannot be read.
- **Tests:**
  - `test_queue.py`: an item's label matches the register's label.
  - `tests/home-work-model.test.ts`: the header action, the group action, the instance label and the count wording.
- **Checked on a migrated copy of the scale database** (403 controls on 13 applications; since dropped), as the owner at 1440 and 390.
