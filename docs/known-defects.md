# Known defects

Defects recorded by the product owner's decision, with the workstream that will address
them. A defect that prevents a person from completing a required audit action is fixed in
the milestone that finds it; the others wait for their workstream.

| Id | Found | Defect | Impact | Workstream | Status |
| --- | --- | --- | --- | --- | --- |
| UI-1 | M3c (21 October 2026) | At phone width (390 px), opening a result's panel on the test sheet widens the page (to 794 px): a rule from 18 October 2026 lets the panel show outside the table's scroll box (`.grid-scroll:has(.cell-pop[open])`). | The page scrolls sideways while a panel is open; nothing is hidden or blocked. | UI hardening (future) | Open |
| UI-2 | M3c (21 October 2026) | At phone width, the effectiveness workpaper's frame is about 20 px wider than the screen and clips the right edge of every section (badges, wide tables). | Section badges and the last table columns are partly cut off; the table columns can still be read on a wider screen or in the downloaded workbook. | UI hardening (future) | Open; the Prepare action and its rationale confirmation were moved to start at the left on narrow screens in the M3c closure, so the required action is fully visible. |
