/**
 * The Evidence library's Withdrawn list (seeded state "evidence-withdrawn"): two files
 * withdrawn, one with a long reason and one without, then one file's Restore opened.
 *
 * Defects found by this check on main on 19 November 2026, fixed by the E1 branch's
 * rewrite of the Withdrawn table (apps/web/src/evidence-change.tsx WithdrawnRows and the
 * .withdrawn-grid styles), and now asserted like everything else:
 * - at 1440 px a long reason was cut mid-word at its column's edge, with no way to read the
 *   rest (now up to two lines, the rest under its row on request);
 * - at 390 px the File and "Why it was withdrawn" columns had no width (now stacked rows);
 * - Restore opened a <details> menu its own cell cut (now a form in a row of its own).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser } from "playwright-core";
import { COMBOS, launch, loadSession, open, Recorder, state } from "./lib.ts";

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
        // Restore opens its form in a row of its own, under the file's row.
        await page
          .locator("table.withdrawn-grid tbody tr")
          .first()
          .getByRole("button", { name: /^Restore$/ })
          .click();
        await page
          .locator(
            "table.withdrawn-grid tr.withdrawn-row-extra form.change-form",
          )
          .waitFor();
        const restoring = await recorder.check(
          opened,
          "withdrawn",
          "restore-open",
          combo,
          {
            scrollers,
            afterAction: true,
            storyScope: "table.withdrawn-grid tr.withdrawn-row-extra",
            shows: ["Why restore it"],
          },
        );
        assert.deepEqual([...listed, ...restoring], []);
      } finally {
        await opened.context.close();
      }
    });
  }
});
