import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
