import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalRows,
  attributeInsight,
  attributeLines,
  fileStatus,
  insightTone,
  nextActionButton,
  phaseCounts,
  STEP_TAB,
  scopeSummary,
  WORKSPACE_TABS,
  workspaceTab,
} from "../apps/web/src/control-tabs-model.ts";
import type { TraceRow } from "../apps/web/src/trace-model.ts";

const row = (code: string, exceptions = 0): TraceRow => ({
  code,
  attribute: "",
  evidence: [],
  pass: 0,
  exceptions,
  unable: 0,
  review: 0,
  untested: 0,
  exceptionItems: [],
});

describe("the control workspace's tabs", () => {
  it("are the reference's tabs, in its order", () => {
    assert.deepEqual(
      WORKSPACE_TABS.map((tab) => tab.label),
      [
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

  it("opens the tab an address names, and earlier links where their work now is", () => {
    assert.equal(workspaceTab(null, null), "overview");
    assert.equal(workspaceTab("risk", null), "risk");
    assert.equal(workspaceTab("approvals", null), "approvals");
    // A step's link opens the tab holding its work.
    assert.equal(workspaceTab("plan", null), "design");
    assert.equal(workspaceTab("request", null), "evidence");
    assert.equal(workspaceTab("TEST", null), "testing");
    assert.equal(workspaceTab("conclude", null), "findings");
    assert.equal(workspaceTab("review", null), "approvals");
    // A classic ?tab= link, and the activity record.
    assert.equal(workspaceTab(null, "review"), "approvals");
    assert.equal(workspaceTab(null, "activity"), "history");
    assert.equal(workspaceTab("nonsense", "nonsense"), "overview");
    assert.equal(STEP_TAB.PLAN, "design");
  });
});

describe("each attribute's evidence on the Overview", () => {
  const attributes = [
    { code: "A1", text: "Policy is current" },
    { code: "A2", text: "Requests are approved" },
    { code: "A3", text: "Access matches the approval" },
    { code: "A4", text: "Reviews are performed" },
  ];
  const evidence = [
    { id: "e1", attributeCodes: ["A1"] },
    { id: "e2", attributeCodes: ["A2", "A3"] },
    { id: "e3", attributeCodes: ["A3"] },
    { id: "e4", attributeCodes: ["A4"] },
  ];

  it("reads ready, in progress, not started and exceptions from the records", () => {
    const lines = attributeLines(
      attributes,
      evidence,
      [
        { id: "e1", state: "ACCEPTED", files: 1 },
        { id: "e2", state: "ACCEPTED", files: 1 },
        { id: "e3", state: "RECEIVED", files: 1 },
        { id: "e4", state: "NOT_GENERATED", files: 0 },
      ],
      [],
    );
    assert.deepEqual(
      lines.map((line) => line.status),
      ["READY", "READY", "IN_PROGRESS", "NOT_STARTED"],
    );
    assert.equal(
      attributeInsight(lines),
      "2 of 4 attributes have sufficient evidence and are ready for testing.",
    );
    const tested = attributeLines(
      attributes.slice(0, 1),
      evidence,
      [{ id: "e1", state: "ACCEPTED", files: 1 }],
      [row("A1", 2)],
    );
    assert.equal(tested[0]?.status, "EXCEPTION");
    assert.equal(
      attributeInsight(tested),
      "No attribute has sufficient evidence yet (1 planned). 1 attribute has an exception in testing.",
    );
  });

  it("does not hold an attribute back for an item not asked for yet", () => {
    const lines = attributeLines(
      attributes.slice(2, 3),
      evidence,
      [
        { id: "e2", state: "ACCEPTED", files: 2 },
        { id: "e3", state: "NOT_GENERATED", files: 0 },
      ],
      [],
    );
    assert.equal(lines[0]?.status, "READY");
    // Waived items count as complete, but one must be accepted.
    const waived = attributeLines(
      attributes.slice(0, 1),
      evidence,
      [{ id: "e1", state: "NOT_APPLICABLE", files: 0 }],
      [],
    );
    assert.equal(waived[0]?.status, "NOT_STARTED");
    assert.equal(attributeInsight([]), "");
  });

  it("marks a file verified only once an item it serves is accepted", () => {
    const items = [
      { state: "ACCEPTED" as const, fileIds: ["f1"] },
      { state: "RECEIVED" as const, fileIds: ["f2"] },
    ];
    assert.equal(fileStatus("f1", "READY", items), "VERIFIED");
    assert.equal(fileStatus("f2", "READY", items), "REVIEW");
    assert.equal(fileStatus("f3", "PENDING", items), "READING");
    assert.equal(fileStatus("f3", null, items), "READING");
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

describe("the insight's tone", () => {
  const line = (status: "READY" | "IN_PROGRESS" | "EXCEPTION") => ({
    code: "A1",
    text: "",
    status,
  });
  it("is good only when every attribute is ready, and warns on an exception", () => {
    assert.equal(insightTone([line("READY"), line("READY")]), "good");
    assert.equal(insightTone([line("READY"), line("IN_PROGRESS")]), "neutral");
    assert.equal(insightTone([line("READY"), line("EXCEPTION")]), "warn");
    assert.equal(insightTone([]), "neutral");
  });
});

describe("the Risk & Scoping summary", () => {
  it("says the scope with how the control operates, and the phases in short", () => {
    assert.deepEqual(
      scopeSummary({
        included: true,
        nature: "Manual",
        phases: [
          { phase: "DESIGN", applicability: "APPLICABLE" },
          { phase: "INTERIM", applicability: "CONDITIONAL" },
          { phase: "ROLLFORWARD", applicability: "NOT_APPLICABLE" },
        ],
      }),
      { scope: "In scope · Manual", phases: "Design, Interim" },
    );
    assert.deepEqual(
      scopeSummary({ included: false, nature: "", phases: [] }),
      {
        scope: "Out of scope",
        phases: "Set with the test plan",
      },
    );
  });
});

describe("the Overview's next action and activity filters", () => {
  it("names the button by where the action is done", () => {
    assert.equal(
      nextActionButton(
        "/?section=controls&step=evidence#cw-work",
        "Review the design evidence",
      ),
      "Review evidence",
    );
    // Evidence still to come is opened, not reviewed.
    assert.equal(
      nextActionButton(
        "/?step=request",
        "Roll-forward requested, evidence outstanding",
      ),
      "Open evidence",
    );
    assert.equal(nextActionButton("/?step=design"), "Review the plan");
    assert.equal(nextActionButton("/?step=approvals"), "Open approvals");
    assert.equal(nextActionButton("/?section=approvals"), "Open");
  });

  it("counts the procedures by phase, in the phases' order", () => {
    assert.deepEqual(
      phaseCounts([
        { phase: "INTERIM" },
        { phase: "DESIGN" },
        { phase: "ROLLFORWARD" },
        { phase: "INTERIM" },
      ]),
      [
        { phase: "DESIGN", count: 1 },
        { phase: "INTERIM", count: 2 },
        { phase: "ROLLFORWARD", count: 1 },
      ],
    );
  });
});
