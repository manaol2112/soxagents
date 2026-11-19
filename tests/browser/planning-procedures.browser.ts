/**
 * Planning, a control's Procedures tab (seeded state "planning-procedures"), then the first
 * procedure opened from its row.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { COMBOS, launch, loadSession, open, Recorder } from "./lib.ts";

const session = loadSession();
const recorder = new Recorder("planning-procedures");
let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  recorder.flush();
  await browser.close();
});

/** One count, one word: the tab's count, each phase's "N procedures" and the rows agree. */
async function countsAgree(page: Page): Promise<string[]> {
  const found: string[] = [];
  const tab = (await page.locator(".pl-tabs").innerText()).replace(/\s+/g, " ");
  const total = tab.match(/Procedures (\d+)/)?.[1];
  const rows = await page.locator("details.pl-row").count();
  if (total !== String(rows)) {
    found.push(`the Procedures tab says ${total}, the list holds ${rows}`);
  }
  for (const phase of await page.locator("section.pl-phase").all()) {
    const text = (await phase.innerText()).replace(/\s+/g, " ");
    const said = text.match(/(\d+) procedures?\b/)?.[1];
    const held = await phase.locator("details.pl-row").count();
    if (said !== String(held)) {
      found.push(`"${text.slice(0, 40)}" says ${said}, holds ${held}`);
    }
  }
  return found;
}

describe("Planning: the Procedures tab and an opened procedure", () => {
  for (const combo of COMBOS) {
    it(`${combo.theme} ${combo.width}`, async () => {
      const opened = await open(
        browser,
        session,
        "planning-procedures",
        combo,
        "details.pl-row",
      );
      const { page } = opened;
      try {
        // The tab row scrolls sideways at phone width, by design.
        const scrollers = [".pl-tabs"];
        const failures = await recorder.check(
          opened,
          "planning",
          "procedures",
          combo,
          {
            scrollers,
            extra: await countsAgree(page),
            shows: [
              "Design and implementation",
              "Interim operating effectiveness",
              "Roll-forward",
            ],
          },
        );
        const first = page.locator("details.pl-row").first();
        await first.locator("> summary").click();
        await page.locator("details.pl-row[open]").first().waitFor();
        failures.push(
          ...(await recorder.check(
            opened,
            "planning",
            "procedure-open",
            combo,
            {
              scrollers,
              afterAction: true,
              storyScope: "details.pl-row[open]",
              shows: ["Edit", "Remove"],
            },
          )),
        );
        assert.deepEqual(failures, []);
      } finally {
        await opened.context.close();
      }
    });
  }
});
