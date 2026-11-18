import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchesSummary,
  parseStandardMatches,
} from "../apps/web/src/standard-matches-model.ts";

// The client's controls that match a firm standard (decided by the product owner on 25
// October 2026): one grouped decision for the strong matches.

const strong = {
  control_id: "c1",
  control_ref: "AC 1.01",
  title: "Managers approve new access.",
  system: "SAP ERP",
  library_key: "access-provisioning",
  standard_ref: "ITGC-AC-01",
  standard_title: "User Access Provisioning and Approval",
  rationale: "The area, the nature and the words agree. A person confirms.",
};

describe("the client's controls and the firm's standards", () => {
  it("reads the strong matches and counts the rest", () => {
    const found = parseStandardMatches({
      strong: [strong, { nothing: true }],
      partial: 2,
      none: 1,
      unmatched: 0,
    });
    assert.ok(found);
    assert.equal(found.strong.length, 1);
    assert.equal(found.strong[0]?.standardRef, "ITGC-AC-01");
    assert.equal(parseStandardMatches(null), null);
  });

  it("asks to follow the strong matches, or to match what was never matched", () => {
    const both = matchesSummary(
      parseStandardMatches({
        strong: [strong],
        partial: 1,
        none: 0,
        unmatched: 0,
      }),
    );
    assert.equal(both?.title, "1 imported control matches a firm standard");
    assert.match(both?.detail ?? "", /1 other control matched only partly/);
    const never = matchesSummary(
      parseStandardMatches({ strong: [], partial: 0, none: 0, unmatched: 12 }),
    );
    assert.equal(
      never?.title,
      "12 imported controls have not been matched to the firm's standards",
    );
    assert.equal(
      matchesSummary(
        parseStandardMatches({ strong: [], partial: 3, none: 2, unmatched: 0 }),
      ),
      null,
    );
  });
});
