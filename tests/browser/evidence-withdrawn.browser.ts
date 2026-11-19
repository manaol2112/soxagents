/**
 * The Evidence library's Withdrawn list (seeded state "evidence-withdrawn"): two files
 * withdrawn, one with a long reason and one without, then one file's Restore opened.
 *
 * Known defects on main, found by this check on 19 November 2026 (apps/web/src/
 * evidence-view.tsx WithdrawnTable and the .withdrawn-grid styles):
 * - at 1440 px a long reason is cut mid-word at its column's edge with no ellipsis and no
 *   title: .withdrawn-why is a block, so the cell's text-overflow never shows, and the
 *   rest of the reason cannot be read anywhere;
 * - at 390 px the fixed-layout grid gives the File and "Why it was withdrawn" columns no
 *   width, so neither the file's name nor the reason shows;
 * - with Restore opened, its panel (a <details> menu positioned in .row-menu) is cut by its
 *   own cell (td.col-restore clips overflow), so at 1440 only its top border shows and a
 *   person who clicks Restore sees no form; at 390 the open menu also turns the grid's
 *   scroller off (.grid-scroll:has(.row-menu[open])), so the card cuts the Withdrawn and
 *   Actions columns.
 * Exactly those findings are set aside (KNOWN, per step, counted on each run) and
 * everything else is asserted, so any other defect fails the check. All are in the
 * Withdrawn table the E1 branch rewrites (reason up to two lines with the rest on request,
 * stacked rows under 640 px, Restore as a form in the row, no <details> menu): remove
 * KNOWN when it merges.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { COMBOS, launch, loadSession, open, Recorder, state } from "./lib.ts";
import { PHONE } from "./rules.ts";

const session = loadSession();
const recorder = new Recorder("evidence-withdrawn");
let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  recorder.flush();
  await browser.close();
});

/** The known findings, as the checks word them; nothing else is set aside. */
const KNOWN = {
  // The reason's block is cut by its cell, with no ellipsis.
  wide: [/^cut off: span\.withdrawn-why \[[\d-]+\] cut by td \[[\d-]+\] /],
  // The File and reason columns (header and cells) are 0 px wide.
  phone: [
    /^cut off: th is 0 px wide "(?:File|Why it was withdrawn)"$/,
    /^cut off: td is 0 px wide /,
  ],
  // Restore opened: its panel's label, field and button cut by their own cell.
  restore: [
    /^cut off: (?:label|input|button\.btn-sm) \[[\d-]+\] cut by td\.col-restore \[/,
  ],
  // Restore opened at phone width: the grid stops scrolling and its card cuts it.
  restorePhone: [/^cut off: \S+ \[[\d-]+\] cut by section\.card\.grid-card \[/],
} satisfies Record<string, readonly RegExp[]>;

function known(
  failures: readonly string[],
  width: number,
  step: "list" | "restore-open",
): string[] {
  const phone = width < PHONE;
  const patterns = [
    ...KNOWN.wide,
    ...(phone ? KNOWN.phone : []),
    ...(step === "restore-open" ? KNOWN.restore : []),
    ...(step === "restore-open" && phone ? KNOWN.restorePhone : []),
  ];
  const set = failures.filter((f) => patterns.some((p) => p.test(f)));
  console.log(JSON.stringify({ known: set.length, step, width }));
  return failures.filter((f) => !set.includes(f));
}

describe("Evidence: the Withdrawn list and a file's Restore", () => {
  const facts = state(session, "evidence-withdrawn");
  const files = facts.files as string[];
  const reasons = facts.reasons as string[];
  for (const combo of COMBOS) {
    it(`${combo.theme} ${combo.width}`, async () => {
      const opened = await open(
        browser,
        session,
        "evidence-withdrawn",
        combo,
        "table.withdrawn-grid",
      );
      const { page } = opened;
      try {
        // The table and the tab rows scroll sideways at phone width, by design.
        const scrollers = [".grid-scroll", "nav.page-tabs", "nav.view-tabs"];
        const count = String(files.length);
        const listed = await recorder.check(
          opened,
          "withdrawn",
          "list",
          combo,
          {
            scrollers,
            // The queue's count, the list's count and the rows say the same thing.
            shows: [
              `Withdrawn ${count}`,
              `${count} withdrawn`,
              ...files,
              ...reasons,
            ],
            never: ["Nothing withdrawn"],
            extra:
              (await page.locator("table.withdrawn-grid tbody tr").count()) ===
              files.length
                ? []
                : [`the list shows ${count} withdrawn but not ${count} rows`],
          },
        );
        await page
          .locator("table.withdrawn-grid summary", { hasText: "Restore" })
          .first()
          .click();
        await page
          .locator("table.withdrawn-grid details[open] .row-menu-panel")
          .waitFor();
        const restoring = await recorder.check(
          opened,
          "withdrawn",
          "restore-open",
          combo,
          {
            scrollers,
            afterAction: true,
            storyScope: "table.withdrawn-grid details[open]",
            shows: ["Why restore it"],
          },
        );
        assert.deepEqual(
          [
            ...known(listed, combo.width, "list"),
            ...known(restoring, combo.width, "restore-open"),
          ],
          [],
        );
      } finally {
        await opened.context.close();
      }
    });
  }
});
