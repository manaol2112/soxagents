# The control as a node flow: plan

Status: **superseded on 8 November 2026 by [control-workflow-plan.md](control-workflow-plan.md)**: the Flow tab was removed before review. Previously: increments 1 and 2 built, not committed. Started on the product owner's go-ahead ("Design it in the current existing style but I want you to do it correctly"). What was built, and where it differs from this plan, is under *Built* below.

Asked for by the product owner on 8 November 2026: "revamp my UI in the control view to be a node data flow like how comfy ui, n8n, make, and langflow does it". Decided by the product owner (answers to four questions):

1. **A new Flow view, tabs kept.** The Flow is the control's default view; selecting a node opens its detail in a side panel; the existing tabs (Overview, Risk & Scoping, Design & Implementation, Testing, Evidence, Findings & Issues, Approvals, History) stay reachable for deep work.
2. **Stage nodes that expand to items.** One node per stage, each with its counts and status; a stage expands into its items (each attribute, evidence item, file, sample, finding), with edges showing which file supports which attribute for which sample.
3. **Read and act through panels.** Pan, zoom, select, follow edges. Every action (approve, request, link a file, decide a finding) happens in the node's side panel through the actions, approvals and audit that exist today. Positions are laid out automatically. No drag-to-connect.
4. **React Flow** (`@xyflow/react`, MIT) for the canvas: pan, zoom, minimap, keyboard handling.

## What the flow shows

The audit trail of one control, left to right:

```
[Risk] ─▶ [Control & attributes] ─▶ [Evidence requests] ─▶ [Evidence]
                                                               │
[Review] ◀─ [Conclusion] ◀─ [Findings] ◀─ [Samples & testing] ◀┘
```

| Stage node | Shows | Expands to |
| --- | --- | --- |
| Risk | the risk and its system | (no items) |
| Control & attributes | approved / proposed attributes, open questions | each attribute (A1, A2...) |
| Evidence requests | requests by phase: planned, sent, received | each evidence item, with its request |
| Evidence | files received, accepted, findings raised | each file |
| Samples & testing | samples tested, results per attribute | each sample |
| Findings | open / decided findings and deficiencies | each finding |
| Conclusion | the sheet's conclusion per phase | (no items) |
| Review | independent review status | (no items) |

**Edges come from records the page already reads** (`WorkspaceInput`): an evidence item lists the attribute codes it serves; a request names its evidence item; files answer evidence items; a sample lists its files and its result per attribute; a finding names its file and evidence item. No new API.

**The point of the picture is where the chain breaks**, marked on the node and its edge: an attribute no evidence item serves; an evidence item with no request or no file; a file serving no attribute; a sample without a result; an exception without a finding. Each node's status uses the existing tones (complete, in progress, attention, blocked).

## How it is built

- `control-flow-model.ts`: pure. From `WorkspaceInput`, the stage nodes (status, counts), item nodes when a stage is expanded, the edges, the breaks, and a deterministic column layout (stages in columns, items stacked in their column). Unit-tested like the other models.
- `control-flow-view.tsx`: the React Flow canvas, loaded only when the Flow view opens (dynamic import, so other pages pay nothing), with custom node components in the existing design tokens, the minimap, and fit-to-view.
- **Side panel:** the selected node's detail reuses the panels that exist (attributes, evidence items and files, the test sheet, findings, review), so the same rules, approvals and audit apply. Actions refetch only what changed.
- **Phone and accessibility:** below 768 px the flow reads as a vertical list of the same stages (a canvas is not usable on a phone). On a desktop, nodes are reachable by keyboard, each has a name and status for screen readers, and a "Show as list" switch gives the same content without the canvas. Motion follows the design system and stops under reduced motion.
- **Scale:** stages start collapsed; a stage with many items (a population of 25 samples) shows them stacked with a count, and the canvas stays smooth with the control's largest realistic set.

## Increments

1. **The canvas and its stages.** Flow view as the default tab, eight stage nodes with status and counts, edges between stages, the side panel with the existing detail, the phone list. Acceptance: every stage's figures match the tabs; selecting a node shows its detail and its actions work as on the tab; no other page loads React Flow.
2. **Items and the trace.** Expand a stage into its items; item-level edges (attribute ↔ evidence item ↔ file ↔ sample ↔ finding); breaks marked. Acceptance: for a synthetic control with a deliberate gap of each kind, each gap is marked on the right node.
3. **Polish.** Minimap, keyboard navigation, remembered expand state per control, "Show as list", both themes at 1440 / 1366 / 390, the design system's UI acceptance checklist.

## Risks and costs

- **Dependency:** `@xyflow/react` adds roughly 50 kB gzipped to the Flow view only (loaded on demand). Its React 19 support is checked when it is added.
- **Duplication:** the side panels reuse the tabs' components rather than copying them; where a panel is tied to its tab's layout, it is split, not forked.
- **Not in scope:** editing by drawing edges, freely arranged node positions saved per user, and a flow across controls (the engagement as a graph). Each can follow if the first three increments prove useful.

## Built (8 November 2026)

- **Flow is the first tab and the default** (`control-tabs-model.ts`: an address with no `?step=` opens it; `?step=overview` opens the Overview). The canvas and React Flow load only when the Flow view opens (`next/dynamic`, no server render); `@xyflow/react` 12.12.0, pinned.
- **Stages:** eight stage nodes in two rows that run back (Risk → Control & attributes → Evidence requests → Evidence, then Samples & testing → Findings → Conclusion → Independent review), each with its headline, detail, status and breaks. The figures come from the page's records: the control's own conclusion, the interim sheet with its later rounds, and exceptions raised or dismissed (`control-flow-model.ts`, `stagesOf`).
- **Trace:** five columns (attributes, evidence items, files, samples, findings) with item edges, breaks first in each column, and a column longer than eight folded into "+N more". The plan names an item's attributes by code or by their text; both resolve to the code (`attributeCodes`). A file counts as in the chain when it is on an evidence item or on any sample of the control's sheets, rounds included.
- **Breaks marked:** an attribute no evidence item serves; an item insufficient, for follow-up, or overdue; a file on no item and no sample; a sample with no evidence or whose test did not run; an exception neither raised nor dismissed.
- **Detail panel:** it opens over the canvas's right edge when a node is selected, or from the toolbar's breaks count. The selected node pans clear of it; Escape or × closes it. Selecting a trace item lights its chain both ways.
- **Framing:** the stages show whole at full size from 1366 px; the trace shows as large as stays readable (at least 82%), and the person pans and zooms for the rest. The view is framed again only when the layout changes, not on a refresh of the same records.
- **List:** below 768 px, and with "Show as list" on a desktop, the same stages read as a numbered vertical list.

**Differences from the plan, for the product owner's review:**

- **The panel reads; it does not act yet.** Decision 3 was "read and act through panels". The panel shows the detail and opens the tab where the work is done ("Open in Evidence", "Open Testing"); approving, requesting, linking and deciding still happen on the tab. Moving those actions into the panel (reusing the tabs' components) is the next increment.
- **No minimap.** The canvas is at most five columns; a minimap added little, so it was left out. The zoom and fit controls stay.
- **Not remembered:** the view (Stages or Trace) and the selection are not kept per control.
- **React Flow's attribution is shown**, as its licence asks of anyone not on its Pro plan.
- **Not measured:** the bundle size React Flow adds to the Flow view.

Found while verifying (not changed here): the Overview tab's attribute lines match evidence items by attribute code, but the plan names them by text. So on a concluded control the Overview reads "No attribute has sufficient evidence yet". The Flow resolves both (`attributeCodes`); the Overview can use the same resolution.
