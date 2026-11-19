import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The Controls page's row detail (design review and product owner, 18 November 2026):
// a failed read says it failed, the status card tells one story from the journey, an
// out-of-scope control's card is that fact, the tabs are only those with content of their
// own, and they stay on one line. The layout was checked in a browser at 390 and 1440 px;
// this keeps the rules from coming back.

const page = readFileSync(
  new URL("../apps/web/src/controls-page.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../apps/web/app/controls-page.css", import.meta.url),
  "utf8",
);
const slice = (from: string, to: string) =>
  page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));
const detail = slice("function Detail(", "function StatusCard(");
const card = slice("function StatusCard(", "function Hidden(");

/** A rule's body in the stylesheet. */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, selector);
  return css.slice(at, css.indexOf("}", at));
}

describe("the Controls page's row detail", () => {
  it("says a failed read failed, with Try again, never the empty state", () => {
    // The failed read fell through to "This control has no organization-specific
    // questions.": `loaded` is null on a failure, so the questions read as none.
    const context = detail.slice(
      detail.indexOf('tab === "Organization context"'),
      detail.indexOf("This control has no organization-specific questions."),
    );
    assert.match(context, /context === "failed" \? \(\s*failed\(/);
    const documents = detail.slice(
      detail.indexOf("Loading the documents"),
      detail.indexOf("No policy, procedure, narrative or reference"),
    );
    assert.match(documents, /context === "failed" \? \(\s*failed\(/);
    assert.match(detail, /could not be read\./);
    // Changed 19 November 2026 (E1 design review, round 6). Old: `onClick={retry}`. New:
    // the press gives the focus to what the read then shows (use-focus-return.ts), then
    // tries again.
    assert.match(
      detail,
      /focus\.returnFocus\("answer"\);\s*retry\(\);[\s\S]{0,160}Try again/,
    );
    assert.match(page, /return \[context, \(\) => setContext\(null\)\];/);
  });

  it("keeps each tab's count in place while it is read", () => {
    assert.match(
      detail,
      /<small className="cpg-count-wait" aria-hidden="true" \/>/,
    );
    assert.match(rule(".cpg-tabs .cpg-count-wait"), /width: 1\.15rem;/);
  });

  it("has only the tabs with content of their own, on one line", () => {
    // Plan, Evidence, Testing, Conclusions and History held one line the card says and
    // a link (product owner, 18 November 2026: "remove the repetition").
    assert.match(
      page,
      /const TABS = \[\s*"Overview",\s*"Organization context",\s*"Governing documents",\s*\] as const;/,
    );
    assert.doesNotMatch(page, /TAB_STEP|in the control\s*<UiIcon/);
    const tabs = rule(".cpg-tabs");
    assert.match(tabs, /flex-wrap: nowrap;/);
    assert.match(tabs, /overflow-x: auto;/);
    assert.match(tabs, /scrollbar-width: none;/);
    const button = rule(".cpg-tabs button");
    assert.match(button, /flex: none;/);
    assert.match(button, /white-space: nowrap;/);
    // A tab's one line sits clear of the tab line.
    assert.match(rule(".cpg-tab-note"), /margin: 0\.75rem 0 0;/);
  });

  it("shows only the facts the row above does not", () => {
    for (const label of [
      "System / application",
      '"Process"',
      '"Type"',
      "Key control",
      '"Frequency"',
    ]) {
      assert.ok(!detail.includes(`label: ${label}`), label);
    }
    assert.match(detail, /row\.area !== row\.process/);
  });

  it("draws the status card from the journey's steps, with no greyed button", () => {
    assert.match(card, /statusSteps\(row\)\.map/);
    assert.doesNotMatch(card, /disabled/);
    assert.doesNotMatch(card, /stepStates|phaseLabels/);
    // The step done opens in the control; the control's history opens from the foot.
    assert.match(card, /step\.opens \?/);
    assert.match(card, /tab=activity#activity/);
  });

  it("shows an out-of-scope control's card as that one fact, and bringing it back", () => {
    const out = card.slice(
      card.indexOf("if (!row.included) {"),
      card.indexOf("statusSteps(row)"),
    );
    // Changed (E1 design review): "Out of scope" is said once, by the row's pill; the card
    // says what it means.
    assert.match(out, /<strong>Not tested in this engagement<\/strong>/);
    assert.doesNotMatch(out, /<strong>Out of scope<\/strong>/);
    assert.match(out, /Bring into scope/);
    assert.doesNotMatch(out, /Review plan|Plan to approve/);
  });
});
