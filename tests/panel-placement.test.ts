import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { panelPlacement } from "../apps/web/src/panel-placement.ts";

// A request's detail beside the list is never a scroll area of its own (decided by the
// product owner on 28 October 2026: "is there any way to avoid any scrolling?").

const base = {
  viewportHeight: 900,
  // The top bar (48) and the control's bar (52).
  stickyTop: 100,
  itemTop: 600,
  listHeight: 2400,
};

describe("where the request's detail sits", () => {
  it("stays in view while it fits below the sticky bars", () => {
    assert.deepEqual(panelPlacement({ ...base, panelHeight: 700 }), {
      mode: "pinned",
      offset: 0,
    });
  });

  it("opens beside the request picked when it is taller, and scrolls with the page", () => {
    assert.deepEqual(panelPlacement({ ...base, panelHeight: 1200 }), {
      mode: "beside",
      offset: 600,
    });
  });

  it("never runs past the list's end, nor above its start", () => {
    // The fifth of five requests near the bottom: lifted so the page grows no taller.
    assert.deepEqual(
      panelPlacement({ ...base, panelHeight: 1200, itemTop: 2000 }),
      { mode: "beside", offset: 1200 },
    );
    assert.deepEqual(
      panelPlacement({ ...base, panelHeight: 1200, itemTop: -40 }),
      { mode: "beside", offset: 0 },
    );
    // A detail taller than the list itself starts with the list.
    assert.deepEqual(
      panelPlacement({ ...base, panelHeight: 3000, listHeight: 1000 }),
      { mode: "beside", offset: 0 },
    );
  });
});

describe("the detail's styles", () => {
  const css = readFileSync("apps/web/app/evidence-requests.css", "utf8");
  const panel = css.slice(
    css.indexOf(".er-panel {"),
    css.indexOf("}", css.indexOf(".er-panel {")),
  );

  it("has no height cap and no scroll of its own", () => {
    assert.doesNotMatch(panel, /max-height|overflow/);
  });

  it("stays below both the top bar and the control's bar while pinned", () => {
    assert.match(
      css,
      /\.er-panel-slot\.is-pinned \{\s*position: sticky;\s*top: calc\(var\(--header-height, 48px\) \+ var\(--cw-bar-h, 0px\) \+ 0\.75rem\);/,
    );
  });
});
