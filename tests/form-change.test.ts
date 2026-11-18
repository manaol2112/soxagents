import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formSignature } from "../apps/web/src/form-change.ts";

describe("a form's unsaved changes", () => {
  it("reads the same fields in another order as unchanged", () => {
    assert.equal(
      formSignature([
        ["scope", "ITGCs"],
        ["period_end", "2026-12-31"],
      ]),
      formSignature([
        ["period_end", "2026-12-31"],
        ["scope", "ITGCs"],
      ]),
    );
  });

  it("reads an edited value, an added or removed choice, or a reordered list as a change", () => {
    const shown = formSignature([
      ["scope", "ITGCs"],
      ["system", "SAP"],
      ["system", "Okta"],
    ]);
    assert.notEqual(
      formSignature([
        ["scope", "ITGCs and BPCs"],
        ["system", "SAP"],
        ["system", "Okta"],
      ]),
      shown,
    );
    assert.notEqual(
      formSignature([
        ["scope", "ITGCs"],
        ["system", "SAP"],
      ]),
      shown,
    );
    assert.notEqual(
      formSignature([
        ["scope", "ITGCs"],
        ["system", "Okta"],
        ["system", "SAP"],
      ]),
      shown,
    );
  });
});
