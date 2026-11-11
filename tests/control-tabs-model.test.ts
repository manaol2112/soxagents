import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalRows,
  STEP_TAB,
  WORKSPACE_TABS,
} from "../apps/web/src/control-tabs-model.ts";

describe("the control workspace's tabs", () => {
  it("are the reference's tabs, in its order", () => {
    assert.deepEqual(
      WORKSPACE_TABS.map((tab) => tab.label),
      [
        "Flow",
        "Overview",
        "Risk & Scoping",
        "Design & Implementation",
        "Testing",
        "Evidence",
        "Findings & Issues",
        "Approvals",
        "History",
      ],
    );
  });
});

describe("the Approvals tab's list", () => {
  it("says where each person's decision stands and where it is made", () => {
    const rows = approvalRows({
      planStatus: "APPROVED",
      approvedRevision: 2,
      requestsToApprove: 1,
      sheetStatus: "SIGNED_OFF",
      sheetSignedBy: "Morgan Lee",
      reviewStatus: "OPEN",
      reviewSignedBy: "",
      conclusion: "NOT_CONCLUDED",
    });
    assert.deepEqual(
      rows.map((row) => [row.title, row.state, row.detail, row.tab]),
      [
        ["Test plan", "done", "Approved (revision 2)", "design"],
        [
          "Evidence requests",
          "waiting",
          "1 awaiting approval to send",
          "evidence",
        ],
        ["Testing sign-off", "done", "Signed off by Morgan Lee", "testing"],
        ["Independent review", "waiting", "In review", "approvals"],
        ["Conclusion", "todo", "Not concluded", "approvals"],
      ],
    );
    const fresh = approvalRows({
      planStatus: null,
      approvedRevision: null,
      requestsToApprove: 0,
      sheetStatus: null,
      sheetSignedBy: "",
      reviewStatus: null,
      reviewSignedBy: "",
      conclusion: "EXCEPTION",
    });
    assert.deepEqual(
      fresh.map((row) => row.detail),
      [
        "Not drafted yet",
        "None awaiting approval",
        "Not started",
        "Opens once testing is signed off",
        "Concluded with exceptions",
      ],
    );
  });
});

// Kept from the case that also covered the retired tab addresses (cleanup, 9 November 2026).
describe("a step's section", () => {
  it("holds the Plan step's work in the design section", () => {
    assert.equal(STEP_TAB.PLAN, "design");
  });
});
