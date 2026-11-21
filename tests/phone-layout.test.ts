import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The rules that keep the test sheet's result panel and the effectiveness workpaper inside
// a phone's screen (UI-1 and UI-2 in docs/known-defects.md). The layout itself was checked
// in a browser at 390 px; this keeps the rules from being dropped.
const globals = readFileSync("apps/web/app/globals.css", "utf8");
const workspace = readFileSync("apps/web/app/control-workspace.css", "utf8");

/** The body of every `@media (max-width: N)` block, joined. */
function phoneBlocks(css: string, width: number): string {
  const opener = `@media (max-width: ${width}px) {`;
  const bodies: string[] = [];
  let from = css.indexOf(opener);
  while (from >= 0) {
    let depth = 0;
    let end = from + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    bodies.push(css.slice(from + opener.length, end));
    from = css.indexOf(opener, end);
  }
  return bodies.join("\n");
}

/** The declarations of the first rule for `selector` in `css`. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no rule for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("phone layout", () => {
  it("shows a result panel as a sheet inside the screen, with its own close", () => {
    const phone = phoneBlocks(globals, 640);
    assert.match(rule(phone, ".cell-panel"), /position: fixed;/);
    assert.match(rule(phone, ".cell-panel"), /left: 0\.75rem;/);
    assert.match(
      rule(phone, ".grid-scroll:has(.cell-pop[open])"),
      /overflow-x: auto;/,
    );
    assert.match(rule(phone, ".cell-close"), /display: block;/);
    assert.match(rule(globals, ".cell-close"), /display: none;/);
    const sheet = readFileSync("apps/web/src/sheet-view.tsx", "utf8");
    assert.match(sheet, /<div className="cell-panel">\s*<PanelClose \/>/);
  });

  it("keeps the workpaper inside its frame, its tables scrolling in their own boxes", () => {
    assert.match(
      rule(globals, ".workbook"),
      /grid-template-columns: minmax\(0, 1fr\);/,
    );
    const phone = phoneBlocks(globals, 640);
    assert.match(
      rule(phone, ".wp-section.workpaper-section > header"),
      /flex-wrap: wrap;/,
    );
    assert.match(rule(phone, ".workpaper-table"), /width: auto;/);
    const narrow = phoneBlocks(workspace, 760);
    assert.match(rule(narrow, ".cw-body .workpaper-table"), /display: table;/);
  });
});

// Retired 9 November 2026: the governing documents card in the assistant rail (its
// .cw-docs-list rules) was removed with the rail; the governing documents are asked in
// Control Understanding's documents step instead.

describe("the control bar hides what scrolls under it (28 October 2026)", () => {
  // Found by the product owner: through the glass bar, the question's text scrolling under
  // it showed as smeared letters. Checked in a browser on the record page.
  it("is opaque", () => {
    const css = readFileSync("apps/web/app/control-workspace.css", "utf8");
    const at = css.indexOf(".cw-bar {");
    const rule = css.slice(at, css.indexOf("}", at));
    assert.match(rule, /background: var\(--surface\);/);
    assert.doesNotMatch(rule, /surface-glass|backdrop-filter/);
  });
});

describe("the test plan's figures fit their card (28 October 2026)", () => {
  // Found by the product owner: five equal columns in a narrow card pushed "Moderate" out of
  // its cell. The figures now take as many columns as fit at a readable width.
  it("wraps to another row instead of squeezing", () => {
    const css = readFileSync("apps/web/app/control-plan.css", "utf8");
    const at = css.indexOf(".pr-figures {");
    const rule = css.slice(at, css.indexOf("}", at));
    assert.match(rule, /repeat\(auto-fit, minmax\(11rem, 1fr\)\)/);
    assert.doesNotMatch(css, /repeat\(var\(--pr-count/);
  });
});

describe("an opened criteria change in the History (20 November 2026)", () => {
  // Found in design review: the comparison opened inside the row's title column, a 160 px
  // wide block at 390 beside the time, and the row's centred icon and time drifted down the
  // opened row. The comparison is the row's own second line and the first line stays put.
  const css = readFileSync("apps/web/app/control-plan.css", "utf8");
  const view = readFileSync("apps/web/src/control-workspace.tsx", "utf8");

  it("opens as a direct child of the row, not inside the title's column", () => {
    const row = view.slice(
      view.indexOf("function HistoryRow("),
      view.indexOf("export function ControlHistory("),
    );
    const text = row.slice(row.indexOf('<div className="ph-text">'));
    const textEnd = text.indexOf("</div>");
    assert.doesNotMatch(text.slice(0, textEnd), /CriteriaChangePanel/);
    assert.match(
      row,
      /<\/time>\s*\{open && item\.criteria !== null \? \(\s*<CriteriaChangePanel/,
    );
  });

  it("spans under the title and the time, under the icon too on a phone", () => {
    assert.match(
      rule(css, ".ph-day li > .ph-change"),
      /grid-row: 2;\s*grid-column: 3 \/ -1;/,
    );
    assert.match(
      rule(phoneBlocks(css, 640), ".ph-day li > .ph-change"),
      /grid-column: 2 \/ -1;/,
    );
  });

  it("opens from a link-like button with no button shadow under its words", () => {
    // Found in the browser: the global button's shadow showed as a faint bar under "Show the
    // criteria" (and under every other .tas-link); the 32 px button height stays its target.
    const list = readFileSync("apps/web/app/attribute-list.css", "utf8");
    const link = rule(list, ".tas-link");
    assert.match(link, /box-shadow: none;/);
    assert.doesNotMatch(link, /height:/);
    assert.match(view, /className="tas-link ph-open"/);
  });

  it("keeps every first-line item on the first line, each in its own column", () => {
    // A set row with an automatic column is placed before the automatic items, so the time
    // took the title's column and pushed the title off the row (found in the browser at 1440).
    // Each item therefore names its row and its column.
    const placed: [string, string][] = [
      [".ph-day li > .ph-dot", "1 / 1"],
      [".ph-day li > .ph-icon", "1 / 2"],
      [".ph-day li > .ph-text", "1 / 3"],
      [".ph-day li > time", "1 / 4"],
    ];
    for (const [selector, area] of placed) {
      assert.match(rule(css, selector), new RegExp(`grid-area: ${area};`));
    }
    assert.match(
      rule(css, ".ph-day li"),
      /grid-template-columns: 36px minmax\(0, 1fr\) auto;/,
    );
    assert.match(
      css,
      /\.ph-day li \{\s*grid-template-columns: 12px 36px minmax\(0, 1fr\) auto;/,
    );
  });
});
