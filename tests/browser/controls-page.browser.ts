/**
 * The Controls page (seeded state "controls"): the register of a launched engagement, then
 * one control's detail row opened from its row.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { COMBOS, launch, loadSession, open, Recorder } from "./lib.ts";
import { storyFindings } from "./rules.ts";

const session = loadSession();
const recorder = new Recorder("controls-page");
let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  recorder.flush();
  await browser.close();
});

/** One count, one word: the in-scope figure, the table's heading and its rows agree. */
async function countsAgree(page: Page): Promise<string[]> {
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const figure = main.match(/(\d+) In scope/)?.[1];
  const heading = main.match(/Controls in scope \((\d+)\)/)?.[1];
  const rows = await page
    .locator("table tbody tr:not(.cpg-detail-row)")
    .filter({ has: page.locator("td.cpg-expand") })
    .count();
  return figure === heading && heading === String(rows)
    ? []
    : [
        `in scope ${figure}, heading ${heading}, rows ${rows}: one count, three answers`,
      ];
}

describe("Controls page: the register and a control's detail row", () => {
  const ref = String(session.states.controls?.expand ?? "ITGC-AC-01");
  for (const combo of COMBOS) {
    it(`${combo.theme} ${combo.width}`, async () => {
      const opened = await open(
        browser,
        session,
        "controls",
        combo,
        "main table",
      );
      const { page } = opened;
      try {
        const scrollers = [".cpg-scroll"];
        const failures = await recorder.check(
          opened,
          "controls",
          "register",
          combo,
          {
            scrollers,
            spans: [["header.page-header", ".cpg"]],
            extra: await countsAgree(page),
          },
        );
        await page.getByRole("button", { name: `Open ${ref}` }).click();
        await page.locator("tr.cpg-detail-row").waitFor();
        // The control's row and its detail tell the same story.
        const row = page.locator(
          `tr:has(> td.cpg-expand button[aria-label="Close ${ref}"])`,
        );
        const detail = page.locator("tr.cpg-detail-row");
        const story = [
          ...storyFindings(await row.innerText(), [
            "Plan: Approved",
            "Testing: Not started",
          ]),
          ...storyFindings(
            await detail.innerText(),
            ["Test plan approved", /Testing\s*Not started/],
            [
              /Testing\s*(?:In progress|Completed)/,
              /Plan\s*(?:to approve|not approved)/,
            ],
          ),
        ];
        failures.push(
          ...(await recorder.check(opened, "controls", `detail-${ref}`, combo, {
            scrollers,
            afterAction: true,
            extra: story,
          })),
        );
        assert.deepEqual(failures, []);
      } finally {
        await opened.context.close();
      }
    });
  }
});
