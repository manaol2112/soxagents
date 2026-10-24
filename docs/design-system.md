# Workspace design system

The workspace (everything behind sign-in) uses one design system. The public landing and sign-in pages keep their own marketing styles (`welcome.css`, `sign-in.css`).

## Where it lives

- **Tokens:** the `:root` block at the top of `apps/web/app/globals.css`. It is the only place a color, type size, radius, or shadow value is defined.
- **Scoped modules:** `controls.css` (`.cx`), `console.css` (`.cv`), and `engagements.css` (`.eg`) keep their own variable names, but each name is an alias of a root token (`--cx-accent: var(--accent)`). New rules use the root tokens directly.
- **Shared components:** `PageHeader`, `CardHeader`, `Metric` (the KPI tile), `StatusPill`, `EmptyState`, and `Banner` in `apps/web/src/workspace-view.tsx`.

A new rule never introduces a hex value. If a color is missing, add a token.

## Tokens

| Group | Tokens | Use |
|---|---|---|
| Surfaces | `--canvas`, `--surface`, `--surface-muted`, `--surface-sunken`, `--surface-hover` | Page background, cards, table headers, wells, row hover |
| Text | `--text-strong`, `--text`, `--text-secondary`, `--text-tertiary`, `--text-disabled` | Headings, body, supporting copy, metadata, disabled. All but disabled meet WCAG 2.2 AA (4.5:1) on `--surface` |
| Lines | `--border`, `--border-strong`, `--border-subtle` | Card edges, input edges, dividers inside cards |
| Primary | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-border` | The one primary action per area, links, selection, focus |
| Status | `--success*`, `--warning*`, `--danger*`, `--info*`, `--neutral*` | Each has a strong tone (text, icons), `-soft` (fill), and `-border` |
| Agent output | `--ai`, `--ai-soft`, `--ai-border` | Something an agent proposed that no person has decided yet |
| Type | `--fs-2xs` 11px to `--fs-display` 28px | Labels and metadata up to page and record titles |
| Shape | `--radius-sm` 6, `--radius` 8, `--radius-lg` 10, `--radius-xl` 14 | Badges; buttons and inputs; cards; dialogs and the composer |
| Elevation | `--shadow-xs`, `--shadow-sm`, `--shadow-lg`, `--shadow-pop`, `--ring` | Controls, cards, raised panels, popovers, keyboard focus |

## Components

- **Page header.** Every page uses `PageHeader`: an uppercase eyebrow naming where you are (the engagement or the firm; shown only below 821px, where the top-bar breadcrumb is cut short), the page title, one line on what the page is for, and the page's actions on the right. KPIs go in a `kpis` strip under the header, not inside it.
- **Buttons.** `.btn` or `<button>` is the primary action (accent, 32px), and an area has one. `.btn-secondary` is for the rest, `.btn-ghost` for quiet actions in rows and toolbars, and `.btn-danger` for what cannot be undone. `.btn-sm` is 28px. A link styled as a button behaves like one.
- **Badges.** `.pill` with a tone: `tone-success`, `tone-warning`, `tone-danger`, `tone-info`, `tone-neutral`, `tone-ai`. A badge always names its state in words; the dot and the color repeat it and never replace it.
- **Links to other pages.** `.text-link` is accent text with a chevron. Add `.is-plain` when the link does not lead on, such as Close.
- **Cards.** `.card` with `CardHeader` (title, one-line description, an aside for a count or a `.text-link`). `.card-disclosure` is a settled section that opens on request.
- **Tables.** Wrap them in `.table-wrap` or `.grid-scroll`: they scroll sideways inside the card and never widen the page. In a fixed grid, a `.cell-sub` with a `title` truncates with an ellipsis.
- **Agent presence.** The console orb and agent avatars use the agent tokens (violet on a soft fill), not gradients. Nothing about an agent is decorative: it marks who produced something.
- **Agent proposals.** `.ai-mark` beside a proposal says who made it: the agent (violet, with a sparkle) or the standard checks. A person's decision is shown separately ("Selected by …"). Agent output is never styled as approved.

## Layout and interaction

- **Workpapers fold what is finished.** A control record step that is done folds to its heading line (`PhaseStep`), so the step that needs work comes up the page; it stays open while it shows the notice of something just done in it.
- **Empty is quiet.** A list with nothing in it, such as Waiting on you or a review not yet started, is one line, not a card-sized empty state.
- **Pages are built around their main task.** A form that is not the page's main job, such as logging a deficiency, changing a milestone date, or editing a settled contact, opens on request. The project plan opens on the phases under way.
- **Phones.** Where the controls list is under 640px wide, each control becomes a small stack, and the register's menus open as a sheet along the bottom. Tab strips scroll sideways without a scrollbar. A page never scrolls sideways.
- **Focus.** Buttons and inputs show `--ring` on keyboard focus; links show an outline.

## Product standards (decided by the product owner, 23 October 2026)

These apply to every feature and every control type. `AGENTS.md` carries the short form.

### Before building

1. Review the existing patterns on the page and in the components above.
2. Write the simplest user journey: who acts, the one primary action, what the agent prepares first, and what opens only on request.
3. Reuse components and tokens; add a token rather than a value.
4. Decide what loads, what updates in place, and what the server must confirm.
5. Decide where motion makes a change easier to follow; nowhere else.
6. Name the likely bottleneck at scale (a list of hundreds, an agent run) and how it stays fast.
7. Name the unit, targeted integration, and UI checks that will cover it.

Five questions every screen answers: Is it understood in five seconds? Is the next action obvious? Which clicks or entries can go? Can the agent prepare this before the user is involved? Is each item shown because it is useful, not because it exists? A screen that fails them gets a simpler workflow, not more styling.

### Layout and disclosure

- One primary action per area; the rest secondary or in a row's menu.
- Exceptions first: what needs a person leads; what is settled folds to a line.
- Detail by progressive disclosure: a one-line summary, the reasons and metadata on request. No repeated metadata, no long expanded lists, no wall of tables.
- The same layout, controls, type, and spacing for every control type. Questions and fields adapt to the control's classification (ITGC, ITAC, business process, MRC, ITDM, IPE, entity-level) inside one consistent experience, never a separate one per type.

### Motion

Motion explains a change: something opened, moved, finished, or is being worked on. It never delays an action and never bounces.

| Interaction | Duration |
|---|---|
| Hover and press feedback | 100–150 ms |
| Expand and collapse | 150–250 ms |
| Dialogs, drawers, popovers | 200–300 ms |
| Page and step transitions | 150–250 ms |

Use CSS transitions and keyframes with the existing tokens (no animation library). Loading uses skeletons shaped like the content; agent work in progress uses the reading treatment (a sweep on the line, an AI mark that pulses, rising dots; `control-workspace.css`); a completed action gets a brief, quiet confirmation. `prefers-reduced-motion: reduce` turns every animation off and keeps the words.

### State and reloads

- A small change does not reload the page: update the affected component, refetch only the data it changed, and keep the scroll, open sections, filters, and form input.
- Optimistic updates only where a rollback is safe and visible (a filter, a fold, a draft). Approvals, sends, sign-offs, withdrawals, and any change to an audit record show success only after the server confirms it, and show the server's reason when it refuses.
- Background revalidation instead of blocking spinners; a partial loading state where data is loading, never the whole page.
- Overlapping requests: the last one wins; a stale response never overwrites a newer state.

### Performance at scale

Engagements may hold thousands of controls, requirements, and results. Lists page on the server; long lists are virtualized or paged, never hundreds of expanded cards; search is debounced; detail loads when opened; queries are targeted and indexed; agent work runs in the background with visible progress.

### Agentic experience

Before asking a person anything, the agent analyzes what is on record, reuses verified context, identifies the real exceptions, and prepares a recommendation with its reasons. The person is asked only for missing facts or professional judgment. Where a grouped decision is legitimate, it is one decision with an individual, traceable record per item behind it (see `docs/workflow-integrity.md`); agent proposals stay visibly separate from human decisions.

### UI acceptance checklist

A feature is complete only when:

- [ ] Its primary action is immediately understandable.
- [ ] Repetitive steps are removed; the agent prepares what it can.
- [ ] Advanced information is hidden until needed.
- [ ] Loading states are informative and do not block the page where avoidable.
- [ ] Changes update in place, without unnecessary full-page reloads.
- [ ] Motion is purposeful, within the durations above, and off under reduced motion.
- [ ] It stays usable with large datasets.
- [ ] Error messages say how to recover.
- [ ] Audit-critical actions show success only on server confirmation.
- [ ] It works by keyboard and at 390 px and 1440 px, with no sideways page scroll.
- [ ] Existing navigation and workflows still work.

Known gap, to be closed as screens are touched (not by redesigning unrelated screens): several forms still post and redirect, reloading the page (for example, setting a file's application), and lists such as the controls register load in full.
