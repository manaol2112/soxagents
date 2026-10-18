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
- **Motion.** Transitions are short and decorative only. `prefers-reduced-motion: reduce` turns all of them off.
