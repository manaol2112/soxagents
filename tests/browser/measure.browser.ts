/**
 * The measurements themselves, on small pages with one known defect each: every check
 * must fail on its defect and pass on the clean page. Needs the system Chrome, not the
 * stack (the pages are set inline).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { launch, measure, SHELL_SCROLLERS, watch } from "./lib.ts";
import { layoutFindings } from "./rules.ts";

let browser: Browser;
let page: Page;

before(async () => {
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
});
after(async () => {
  await browser.close();
});

const BASE = "<style>body{margin:0}main{padding:0 16px}</style>";

async function findings(
  html: string,
  scrollers: readonly string[] = [],
  focus = false,
): Promise<string[]> {
  await page.setContent(`${BASE}<main>${html}</main>`);
  return layoutFindings(
    await measure(page, "main", [...SHELL_SCROLLERS, ...scrollers], focus),
  );
}

describe("the layout measurements", () => {
  it("pass a clean phone-width page", async () => {
    assert.deepEqual(
      await findings("<p>Every control is planned.</p><button>Open</button>"),
      [],
    );
  });

  it("find a page that scrolls sideways", async () => {
    const found = await findings('<div style="width:600px">wide</div>');
    assert.ok(
      found.some((f) => f.startsWith("the page scrolls sideways")),
      found.join("; "),
    );
  });

  it("find text across the 16px gutter", async () => {
    const found = await findings(
      '<p style="margin-left:-12px">Too close to the edge</p>',
    );
    assert.ok(
      found.some((f) => f.startsWith("crosses the 16px gutter")),
      found.join("; "),
    );
  });

  it("find a container that scrolls sideways unless it is declared", async () => {
    const html =
      '<div class="tabs" style="overflow-x:auto"><div style="width:900px">Tabs</div></div>';
    const found = await findings(html);
    assert.ok(
      found.some((f) => f.startsWith("scrolls sideways, not declared")),
      found.join("; "),
    );
    assert.deepEqual(await findings(html, [".tabs"]), []);
  });

  it("find words a container cuts off, but not an ellipsis", async () => {
    const cut = await findings(
      '<div style="overflow:hidden;width:120px"><span style="display:inline-block;width:300px">A panel wider than its card</span></div>',
    );
    assert.ok(
      cut.some((f) => f.startsWith("cut off:")),
      cut.join("; "),
    );
    const ellipsis = await findings(
      '<div style="overflow:hidden;width:120px;white-space:nowrap;text-overflow:ellipsis"><span>A long file name cut on purpose.txt</span></div>',
    );
    assert.deepEqual(ellipsis, []);
    // The cell declares an ellipsis, but the text is in a block child: it is cut bare.
    const bare = await findings(
      '<div style="overflow:hidden;width:120px;white-space:nowrap;text-overflow:ellipsis"><span style="display:block">A long reason cut mid-word without an ellipsis</span></div>',
    );
    assert.ok(
      bare.some((f) => f.startsWith("cut off:")),
      bare.join("; "),
    );
    const own = await findings(
      '<div style="width:120px"><span style="display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">A long name cut with its own ellipsis</span></div>',
    );
    assert.deepEqual(own, []);
    // Declaring a scroller lets it scroll sideways; what is cut inside it is still cut.
    const inScroller = await findings(
      '<div class="grid" style="overflow-x:auto;width:200px"><div style="overflow:hidden;width:120px;white-space:nowrap"><span style="display:block">A long reason cut mid-word without an ellipsis</span></div></div>',
      [".grid"],
    );
    assert.ok(
      inScroller.some((f) => f.startsWith("cut off:")),
      inScroller.join("; "),
    );
    // The body of a closed <details> is not on the screen.
    const closed = await findings(
      '<div style="overflow:hidden;width:120px"><details><summary>Restore</summary><label style="display:inline-block;width:300px">Why restore it</label></details></div>',
    );
    assert.deepEqual(closed, []);
    // A menu panel positioned against an outer box escapes a clipping cell in between;
    // positioned against the clipping cell itself, it is cut.
    const panel =
      '<div class="menu" style="position:absolute;top:20px;right:0;width:200px"><button>Restore the file</button></div>';
    const escapes = await findings(
      `<div style="position:relative;width:340px;height:80px"><div style="overflow:hidden;width:60px;margin-left:260px">x${panel}</div></div>`,
    );
    assert.deepEqual(escapes, []);
    const clipped = await findings(
      `<div style="width:340px;height:80px"><div style="position:relative;overflow:hidden;width:60px;height:60px;margin-left:260px">x${panel}</div></div>`,
    );
    assert.ok(
      clipped.some((f) => f.startsWith("cut off:")),
      clipped.join("; "),
    );
  });
  it("find a table column given no width", async () => {
    const found = await findings(
      '<table style="table-layout:fixed;width:300px"><colgroup><col><col style="width:300px"></colgroup>' +
        '<tr><td style="overflow:hidden">user listing.csv</td><td>ITGC-AC-01</td></tr></table>',
    );
    assert.ok(
      found.some((f) => f.includes("is 0 px wide")),
      found.join("; "),
    );
  });

  it("find focus left on the body after an action", async () => {
    await page.setContent(`${BASE}<main><button id="b">Open</button></main>`);
    await page.click("#b");
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    const lost = layoutFindings(await measure(page, "main", [], true));
    assert.ok(
      lost.includes("focus is on the page body after the action"),
      lost.join("; "),
    );
    await page.focus("#b");
    assert.deepEqual(layoutFindings(await measure(page, "main", [], true)), []);
  });
});

describe("what the page reports going wrong", () => {
  async function reported(script: string): Promise<string[]> {
    const fresh = await browser.newPage();
    const errors = watch(fresh);
    await fresh.setContent(`<main>ok</main><script>${script}</script>`);
    await fresh.waitForTimeout(100);
    await fresh.close();
    return errors;
  }

  it("fails on React's update-depth warning, a console error and an uncaught error", async () => {
    const loop = await reported(
      "console.warn('Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect');",
    );
    assert.equal(loop.length, 1, loop.join("; "));
    assert.match(loop[0] ?? "", /^console warning: .*Maximum update depth/);
    assert.match(
      (await reported("console.error('Failed to load the plan');"))[0] ?? "",
      /^console error: Failed to load the plan/,
    );
    assert.match(
      (await reported("setTimeout(() => { throw new Error('boom'); });"))[0] ??
        "",
      /^page error: .*boom/,
    );
  });

  it("passes the development tooling's own lines and ordinary warnings", async () => {
    assert.deepEqual(
      await reported(
        "console.error('Download the React DevTools for a better development experience');" +
          "console.log('[HMR] connected'); console.warn('A deprecated option was used');",
      ),
      [],
    );
  });
});
