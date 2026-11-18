import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  controlKeys,
  filterRows,
  parseControlsFor,
  withControlsFor,
} from "../apps/web/src/scope-controls-model.ts";

// The Controls tab as the one place controls are managed (decided by the product owner on
// 26 October 2026): a system or a process opens it filtered to its own controls.

const SAP = "11111111-1111-7111-8111-111111111111";
const LEASES = "22222222-2222-7222-8222-222222222222";

describe("the Controls tab's filter to one system or process", () => {
  it("reads the filter an address names, and nothing else", () => {
    assert.deepEqual(parseControlsFor(`system:${SAP}`), {
      kind: "system",
      id: SAP,
    });
    assert.deepEqual(parseControlsFor("process:ORDER_TO_CASH"), {
      kind: "process",
      id: "ORDER_TO_CASH",
    });
    assert.equal(parseControlsFor("control:1"), null);
    assert.equal(parseControlsFor("system:<script>"), null);
    assert.equal(parseControlsFor(null), null);
  });

  it("keys a control to its systems and its process, or its standard cycle", () => {
    assert.deepEqual(
      controlKeys({ applicationIds: [SAP], processId: null, domain: "ACCESS" }),
      [`system:${SAP}`, "process:ACCESS"],
    );
    assert.deepEqual(
      controlKeys({
        applicationIds: [],
        processId: LEASES,
        domain: "OTHER_BUSINESS",
      }),
      [`process:${LEASES}`],
    );
  });

  it("shows the filtered rows, or all of them once cleared", () => {
    const rows = [
      { id: "a", keys: [`system:${SAP}`, "process:ACCESS"] },
      { id: "b", keys: [`process:${LEASES}`] },
    ];
    assert.deepEqual(
      filterRows(rows, { kind: "system", id: SAP }).map((row) => row.id),
      ["a"],
    );
    assert.deepEqual(
      filterRows(rows, null).map((row) => row.id),
      ["a", "b"],
    );
  });

  it("keeps the filter in the address, and clears it", () => {
    const set = withControlsFor(
      "/?organization=o&section=controls&pane=systems",
      {
        kind: "system",
        id: SAP,
      },
    );
    const params = new URLSearchParams(set.split("?")[1]);
    // The Controls page holds the filter; no tab of Systems & Processes does.
    assert.equal(params.get("pane"), null);
    assert.equal(params.get("for"), `system:${SAP}`);
    assert.equal(params.get("organization"), "o");
    const cleared = new URLSearchParams(
      withControlsFor(set, null).split("?")[1],
    );
    assert.equal(cleared.get("for"), null);
    assert.equal(cleared.get("pane"), null);
  });
});
