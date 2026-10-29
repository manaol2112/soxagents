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

describe("the governing documents card stays inside its column (28 October 2026)", () => {
  // Found by the product owner: a long file name widened the list past the card. The layout
  // was checked in a browser at the rail's width; this keeps the rules from being dropped.
  const plan = readFileSync("apps/web/app/control-plan.css", "utf8");
  const rule = (selector: string) => {
    const at = plan.indexOf(`${selector} {`);
    return at < 0 ? "" : plan.slice(at, plan.indexOf("}", at));
  };

  it("holds one column no wider than the card, and long names wrap or end in an ellipsis", () => {
    assert.match(
      rule(".cw-docs-list"),
      /grid-template-columns: minmax\(0, 1fr\)/,
    );
    assert.match(rule(".cw-docs-list strong"), /overflow-wrap: anywhere/);
    assert.match(rule(".cw-docs-list small"), /text-overflow: ellipsis/);
  });
});

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
