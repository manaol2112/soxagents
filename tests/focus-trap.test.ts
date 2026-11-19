import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  controlKey,
  escapeGate,
  FOCUS_ANSWERS,
  focusLost,
  focusReturnTarget,
} from "../apps/web/src/focus-return.ts";
import {
  FOCUSABLE,
  isTopmost,
  trapTarget,
} from "../apps/web/src/focus-trap.ts";

describe("keyboard focus stays inside an open modal dialog (WCAG 2.4.3, 2.4.11)", () => {
  it("wraps Tab from the last control to the first, and Shift+Tab back", () => {
    assert.equal(trapTarget(3, 2, false), 0);
    assert.equal(trapTarget(3, 0, true), 2);
  });

  it("leaves the browser to move between controls in the middle", () => {
    assert.equal(trapTarget(3, 0, false), null);
    assert.equal(trapTarget(3, 1, true), null);
  });

  it("brings focus in from the dialog itself or from outside it", () => {
    assert.equal(trapTarget(3, -1, false), 0);
    assert.equal(trapTarget(3, -1, true), 2);
    assert.equal(trapTarget(3, 7, false), 0);
  });

  it("keeps focus on a dialog with no controls", () => {
    assert.equal(trapTarget(0, -1, false), -1);
  });

  it("lets only the topmost open dialog keep the focus", () => {
    const setup = { name: "setup" };
    const documents = { name: "documents" };
    assert.equal(isTopmost([setup], setup), true);
    assert.equal(isTopmost([setup, documents], setup), false);
    assert.equal(isTopmost([setup, documents], documents), true);
    assert.equal(isTopmost([], setup), true);
  });

  it("reaches links, enabled fields and buttons, never a hidden input", () => {
    assert.match(FOCUSABLE, /button:not\(\[disabled\]\)/);
    assert.match(
      FOCUSABLE,
      /input:not\(\[disabled\]\):not\(\[type="hidden"\]\)/,
    );
    assert.match(FOCUSABLE, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
  });
});

describe("keyboard focus comes back after a form opened from a row (WCAG 2.4.3)", () => {
  // E1 design review, round 4, 18 November 2026: after Close, Cancel, a confirmation and
  // a refusal, focus fell to the page's body in every area.
  const opener = { name: "opener" };
  const standIn = { name: "the opener drawn again" };
  const answer = { name: "the confirmation" };
  const row = { name: "row" };

  it("goes back to what opened the form when it closes, never to an answer", () => {
    assert.equal(
      focusReturnTarget("back", { answer, opener, standIn, row }),
      opener,
    );
  });

  it("goes to the answer the server gave, once there is one", () => {
    assert.equal(
      focusReturnTarget("answer", { answer, opener, standIn, row }),
      answer,
    );
    assert.equal(
      focusReturnTarget("answer", { answer: null, opener, standIn, row }),
      opener,
    );
  });

  it("finds the opener drawn again, then the row, when it has left the page", () => {
    assert.equal(
      focusReturnTarget("back", { answer: null, opener: null, standIn, row }),
      standIn,
    );
    assert.equal(
      focusReturnTarget("back", {
        answer: null,
        opener: null,
        standIn: null,
        row,
      }),
      row,
    );
  });

  it("moves focus only when it was lost", () => {
    const body = { isConnected: true };
    assert.equal(focusLost(null, body), true);
    assert.equal(focusLost(body, body), true);
    assert.equal(focusLost({ isConnected: false }, body), true);
    assert.equal(focusLost({ isConnected: true }, body), false);
  });

  it("knows a control drawn again by its kind and its name", () => {
    assert.equal(
      controlKey("BUTTON", "  More for  a.png "),
      controlKey("button", "More for a.png"),
    );
    assert.notEqual(controlKey("button", "Move"), controlKey("a", "Move"));
    // The confirmation lines every form already draws are its answers.
    assert.match(FOCUS_ANSWERS, /\[data-focus-return\]/);
    assert.match(FOCUS_ANSWERS, /\.ep-done\[role="status"\]/);
  });
});

describe("Escape in a dialog closes only the dialog (WCAG 2.4.3)", () => {
  it("leaves the page's panel open when a dialog was open as the key went down", () => {
    // E1 design review, round 10: Escape in a file's preview closed the preview, and the
    // step panel behind it then found no dialog and closed too; focus fell to the page.
    let dialog = true;
    const gate = escapeGate(() => dialog);
    const esc = { key: "Escape", defaultPrevented: false };
    gate.press(esc);
    dialog = false; // the preview's own listener closes it before the panel's runs
    assert.equal(gate.acts(esc), false);
    // With nothing open, the panel closes; never on an Escape another part took.
    gate.press(esc);
    assert.equal(gate.acts(esc), true);
    assert.equal(gate.acts({ ...esc, defaultPrevented: true }), false);
    assert.equal(gate.acts({ ...esc, isComposing: true }), false);
  });

  it("closes each page-wide panel on Escape through that one gate", () => {
    for (const path of ["control-workflow.tsx", "console-panel.tsx"]) {
      const source = readFileSync(`apps/web/src/${path}`, "utf8");
      assert.match(source, /onPageEscape\(/, path);
      assert.doesNotMatch(source, /event\.key === "Escape"/, path);
    }
  });
});
