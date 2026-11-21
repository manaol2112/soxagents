/**
 * The Attributes step, Review attributes (seeded state "attributes-review", product owner,
 * 19 November 2026, approved prototype): the step opens on "Review attributes" with its
 * "Reviewed n/N" bar, the first row to review open (an "Assumes … Unconfirmed" row in it)
 * and Accept all's unconfirmed assumptions said beside it; then, at one width, the open row
 * is accepted, and only once the server has confirmed it does the row read "Accepted just
 * now", the next row to review open, and the bar count one more.
 *
 * The acceptance is recorded on the seeded database, so the accept step needs a row still
 * to review: on a database where every row is accepted it fails and says to seed a new
 * one. The read-only checks assert what the screen says against itself (one count, one
 * word), not fixed numbers, so they hold on either.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { COMBOS, launch, loadSession, open, Recorder } from "./lib.ts";

const session = loadSession();
const recorder = new Recorder("attributes-review");
const DRAWER = ".wf-panel";
const LIST = ".cc-attributes.is-embedded";
let browser: Browser;

before(async () => {
  browser = await launch();
});
after(async () => {
  recorder.flush();
  await browser.close();
});

type Said = {
  reviewed: number | null;
  total: number | null;
  rows: number;
  toReview: number;
  pill: string;
  open: string[];
};

/** What the step says about itself: the bar's count, the rows and their chips, the
 * header's pill, and which rows are open. */
async function said(page: Page): Promise<Said> {
  return page.evaluate(
    ({ drawer, list }) => {
      const root = document.querySelector(list);
      const value =
        root?.querySelector(".tar-progress-value")?.textContent ?? "";
      const [reviewed, total] = value.split("/").map((n) => Number(n));
      const rows = [...(root?.querySelectorAll(".tar-list > li.tar") ?? [])];
      const chips = rows.map(
        (row) => row.querySelector(".tar-chip")?.textContent?.trim() ?? "",
      );
      const pill =
        document
          .querySelector(`${drawer} .wf-panel-head`)
          ?.textContent?.match(/(\d+) to review/)?.[0] ?? "";
      return {
        reviewed: Number.isFinite(reviewed) ? (reviewed as number) : null,
        total: Number.isFinite(total) ? (total as number) : null,
        rows: rows.length,
        toReview: chips.filter((chip) => chip === "To review").length,
        pill,
        open: rows
          .filter((row) => row.classList.contains("is-open"))
          .map((row) => row.id),
      };
    },
    { drawer: DRAWER, list: LIST },
  );
}

/** One count, one word: the bar's N is the rows listed, its n the rows not to review, and
 * the header's pill counts the same "To review" rows. */
function agree(now: Said): string[] {
  const found: string[] = [];
  if (now.total !== now.rows) {
    found.push(`Reviewed says of ${now.total}, the list holds ${now.rows}`);
  }
  if (now.reviewed !== null && now.rows - now.reviewed !== now.toReview) {
    found.push(
      `Reviewed ${now.reviewed}/${now.total} beside ${now.toReview} rows to review`,
    );
  }
  if (now.toReview > 0 && now.pill !== `${now.toReview} to review`) {
    found.push(`the pill says "${now.pill}", ${now.toReview} rows to review`);
  }
  return found;
}

describe("Attributes: Review attributes", () => {
  for (const combo of COMBOS) {
    it(`${combo.theme} ${combo.width}`, async () => {
      const opened = await open(
        browser,
        session,
        "attributes-review",
        combo,
        `${LIST} .tar-list`,
      );
      const { page } = opened;
      try {
        const now = await said(page);
        const failures = await recorder.check(
          opened,
          "attributes",
          "review",
          combo,
          {
            scope: LIST,
            storyScope: DRAWER,
            scrollers: [".control-tabs", ".wf-steps", "nav"],
            shows: ["Review attributes", "Reviewed", /\d+ attributes?/],
            // The old words, and a decision eyebrow, never come back here.
            never: [
              "To accept",
              "Retire",
              "Your decision is needed",
              "YOUR DECISION",
              "Decide the attributes",
            ],
            extra: agree(now),
          },
        );
        if (now.toReview > 0) {
          // The first row to review is open, with what it rests on said in it.
          if (now.open.length !== 1) {
            failures.push(
              `${now.open.length} rows open, not the first to review`,
            );
          }
          const note = await page
            .locator(`${LIST} .tar-all-note`)
            .first()
            .textContent()
            .catch(() => null);
          if (
            now.toReview >= 2 &&
            !/unconfirmed assumptions?/.test(note ?? "")
          ) {
            failures.push(
              `Accept all does not say its unconfirmed assumptions (${note})`,
            );
          }
        }
        assert.deepEqual(failures, []);
      } finally {
        await opened.context.close();
      }
    });
  }

  it("accepts the open row once the server confirms it, and opens the next", async () => {
    const combo = { theme: "light", width: 1440 } as const;
    const opened = await open(
      browser,
      session,
      "attributes-review",
      combo,
      `${LIST} .tar-list`,
    );
    const { page } = opened;
    try {
      const before = await said(page);
      assert.ok(
        before.toReview >= 2,
        "no two rows left to review: seed a new database (scripts/seed_review_states.py)",
      );
      const first = before.open[0];
      assert.ok(first !== undefined, "no row to review is open");
      const row = page.locator(`[id="${first}"]`);
      // Nothing reads as accepted before the server answers: the call is held, the row
      // read while it waits, then the call let through.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      let sent = false;
      await page.route("**/workspace/control-context", async (route) => {
        sent = true;
        await gate;
        await route.continue();
      });
      await row.locator(".tar-acts button", { hasText: /^Accept$/ }).click();
      for (let waited = 0; !sent && waited < 10_000; waited += 50) {
        await page.waitForTimeout(50);
      }
      assert.ok(sent, "the acceptance was not sent to the server");
      const waiting = await row.innerText();
      assert.doesNotMatch(waiting, /Accepted just now/);
      assert.match(waiting, /To review/);
      release();
      await row
        .locator(".tar-source", { hasText: "Accepted just now" })
        .waitFor({ timeout: 30_000 });
      await page.unroute("**/workspace/control-context");
      await page.waitForFunction(
        ({ list, id }) => {
          const open = document.querySelectorAll(
            `${list} .tar-list > li.is-open`,
          );
          return open.length === 1 && open[0]?.id !== id;
        },
        { list: LIST, id: first },
        { timeout: 30_000 },
      );
      // The step's pill is read again from the server (the page refetches in place): the
      // check reads the screen once it has.
      await page.waitForFunction(
        ({ drawer, list }) => {
          const left = [
            ...document.querySelectorAll(
              `${list} .tar-list > li.tar .tar-chip`,
            ),
          ].filter((chip) => chip.textContent?.trim() === "To review").length;
          const pill =
            document
              .querySelector(`${drawer} .wf-panel-head`)
              ?.textContent?.match(/(\d+) to review/)?.[1] ?? "";
          return pill === String(left);
        },
        { drawer: DRAWER, list: LIST },
        { timeout: 30_000 },
      );
      const after = await said(page);
      const failures = await recorder.check(
        opened,
        "attributes",
        "accepted-one",
        combo,
        {
          scope: LIST,
          storyScope: DRAWER,
          scrollers: [".control-tabs", ".wf-steps", "nav"],
          afterAction: true,
          // Accept all is offered while two rows or more are left to review.
          shows: [
            "Accepted just now",
            ...(after.toReview >= 2 ? ["Accept remaining"] : []),
          ],
          never: ["To accept", "Retire"],
          extra: agree(after),
        },
      );
      if (after.reviewed !== (before.reviewed ?? 0) + 1) {
        failures.push(
          `Reviewed went from ${before.reviewed} to ${after.reviewed}, not one more`,
        );
      }
      assert.deepEqual(failures, []);
      // F1 (19 November 2026): an accepted attribute, opened again, keeps quiet Edit and
      // Remove beside "Accepted just now", never Accept. A decided row that left the set (a
      // removal accepted) has no body and no actions.
      const head = row.locator(".tar-head");
      if ((await head.count()) === 1) {
        await head.click();
        await row.locator(".tar-acts").first().waitFor({ timeout: 30_000 });
        assert.equal(
          await row
            .locator(".tar-acts button", { hasText: /^Accept$/ })
            .count(),
          0,
          "the accepted row offers Accept again",
        );
        assert.equal(
          await row
            .locator(".tar-acts button.btn-ghost", { hasText: /^Remove$/ })
            .count(),
          1,
          "the accepted row keeps no quiet Remove",
        );
      }
    } finally {
      await opened.context.close();
    }
  });
});
