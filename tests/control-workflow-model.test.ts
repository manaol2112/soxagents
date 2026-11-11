import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  NODE_SIZE,
  openedFrom,
  progressOf,
  returnStep,
  SECTION_OF,
  STEPS,
  TO_RELEASE,
  type WorkflowInput,
  workflowLayout,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";

const understood = [
  {
    key: "answers" as const,
    done: true,
    optional: false,
    mine: true,
    summary: "All 3 answered",
  },
  {
    key: "documents" as const,
    done: false,
    optional: true,
    mine: true,
    summary: "None linked",
  },
];

// A control just set up from the RCM: nothing understood, planned or requested yet.
function fresh(overrides: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    details: [
      { label: "Description", filled: true },
      { label: "Objective", filled: true },
      { label: "Frequency", filled: true },
      { label: "Owner", filled: true },
      { label: "Risk", filled: true },
    ],
    setup: [
      {
        key: "answers",
        done: false,
        optional: false,
        mine: true,
        summary: "3 to answer",
      },
      {
        key: "documents",
        done: false,
        optional: true,
        mine: true,
        summary: "None linked",
      },
    ],
    attributes: { approved: 0, proposed: 0 },
    plan: { exists: false, approved: false, pendingReview: false },
    requirements: [],
    sheet: null,
    rounds: [],
    findings: [],
    reviewStatus: "",
    conclusion: "NOT_CONCLUDED",
    proposedConclusion: null,
    designPaper: null,
    designConclusion: null,
    effectivenessPaper: null,
    busy: new Set(),
    ...overrides,
  };
}

// The D&I conclusion as a reviewer left it (design_conclusions, migration 0143).
const toSign = {
  status: "TO_SIGN" as const,
  proposed: "EFFECTIVE" as const,
  signed: null,
};
const signedEffective = {
  status: "SIGNED_OFF" as const,
  proposed: "EFFECTIVE" as const,
  signed: "EFFECTIVE" as const,
};
const signedNotEffective = {
  status: "SIGNED_OFF" as const,
  proposed: "NOT_EFFECTIVE" as const,
  signed: "NOT_EFFECTIVE" as const,
};

// The product owner's screenshot (8 November 2026): plan approved, one design item received to
// review, the design workpaper prepared, nothing tested yet.
function midway(): WorkflowInput {
  return fresh({
    setup: understood,
    attributes: { approved: 5, proposed: 0 },
    plan: { exists: true, approved: true, pendingReview: false },
    requirements: [
      { phase: "DESIGN", state: "ACCEPTED" },
      { phase: "DESIGN", state: "RECEIVED" },
      { phase: "INTERIM", state: "SENT" },
      { phase: "INTERIM", state: "NOT_GENERATED" },
      { phase: "ROLLFORWARD", state: "NOT_GENERATED" },
    ],
    designPaper: { status: "PREPARED", drafting: false },
    designConclusion: toSign,
  });
}

// The synthetic demo's concluded control: two exceptions raised as D-001, closed, retested.
function concluded(): WorkflowInput {
  return fresh({
    setup: understood,
    attributes: { approved: 3, proposed: 0 },
    plan: { exists: true, approved: true, pendingReview: false },
    requirements: [
      { phase: "DESIGN", state: "ACCEPTED" },
      { phase: "DESIGN", state: "ACCEPTED" },
      { phase: "INTERIM", state: "ACCEPTED" },
      { phase: "INTERIM", state: "ACCEPTED" },
      { phase: "ROLLFORWARD", state: "NOT_GENERATED" },
      { phase: "ROLLFORWARD", state: "AWAITING_DEPENDENCY" },
    ],
    sheet: {
      method: "SAMPLE",
      status: "SIGNED_OFF",
      items: 25,
      tested: 25,
      exceptions: 2,
      running: false,
      decided: true,
      reference: "D-001",
    },
    rounds: [{ kind: "RETEST", status: "SIGNED_OFF", conclusion: "EFFECTIVE" }],
    findings: [{ reference: "D-001", status: "CLOSED", type: "OPERATING" }],
    reviewStatus: "SIGNED_OFF",
    conclusion: "EFFECTIVE",
    designPaper: { status: "PREPARED", drafting: false },
    designConclusion: signedEffective,
    effectivenessPaper: { status: "PREPARED", drafting: false },
  });
}

const by = (steps: ReturnType<typeof workflowOf>, key: string) =>
  steps.find((step) => step.key === key);
const state = (steps: ReturnType<typeof workflowOf>, key: string) => [
  by(steps, key)?.tone,
  by(steps, key)?.status,
];

describe("the control's workflow", () => {
  it("is the product owner's nine steps and two branches", () => {
    assert.deepEqual(
      STEPS.map((step) => step.title),
      [
        "RCM / Control Setup",
        "Control Understanding",
        "D&I Evidence",
        "D&I Assessment",
        "D&I Conclusion",
        "Test Design & Approval",
        "OE Evidence",
        "OE Testing",
        "Control Conclusion",
        "Independent Review",
        "Final Workpaper",
      ],
    );
    assert.deepEqual(
      STEPS.filter((step) => step.group === "design").map((step) => step.key),
      ["designevidence", "designassessment", "designconclusion"],
    );
    assert.deepEqual(
      STEPS.filter((step) => step.group === "operating").map(
        (step) => step.key,
      ),
      ["testdesign", "oeevidence", "oetesting"],
    );
    // People decide at the gates.
    assert.deepEqual(
      STEPS.filter((step) => step.kind === "gate").map((step) => step.key),
      ["designconclusion", "testdesign", "review"],
    );
  });

  it("shows a state for every step, never an instruction", () => {
    const failed: WorkflowInput = {
      ...midway(),
      findings: [{ reference: "D-007", status: "OPEN", type: "DESIGN" }],
      designConclusion: signedNotEffective,
    };
    const stale: WorkflowInput = {
      ...concluded(),
      designConclusion: { ...signedEffective, status: "OUT_OF_DATE" },
    };
    for (const input of [fresh(), midway(), concluded(), failed, stale]) {
      for (const step of workflowOf(input)) {
        assert.doesNotMatch(
          step.status,
          /^(Once|When)\b/,
          `${step.key}: ${step.status}`,
        );
        assert.ok(
          step.status.length <= 28,
          `${step.key} is too long for its node: ${step.status}`,
        );
      }
    }
  });

  it("starts with understanding, and opens both branches once it is done", () => {
    const start = workflowOf(fresh());
    assert.deepEqual(state(start, "understanding"), [
      "attention",
      "3 to answer",
    ]);
    assert.deepEqual(state(start, "designevidence"), [
      "idle",
      "Waiting on understanding",
    ]);
    assert.deepEqual(state(start, "testdesign"), [
      "idle",
      "Waiting on understanding",
    ]);
    assert.deepEqual(
      start.filter((step) => step.next).map((step) => step.key),
      ["understanding"],
    );
    const both = workflowOf(fresh({ setup: understood }));
    assert.deepEqual(
      both.filter((step) => step.next).map((step) => step.key),
      ["designevidence", "testdesign"],
    );
  });

  // Rewritten 8 November 2026 for the D&I sign-off (B2, product owner: "the node does not show
  // that"). Before: a prepared design workpaper read as "Effective · unreviewed" and cleared OE,
  // so the interim item with the client showed as normal progress. Now: the conclusion waits on
  // a reviewer's sign-off, and OE work recorded before it is flagged, not shown as progress.
  it("reads the screenshot's control as the two branches stand", () => {
    const steps = workflowOf(midway());
    // D&I: its own evidence, not the OE items.
    assert.deepEqual(state(steps, "designevidence"), [
      "attention",
      "1 item to review",
    ]);
    assert.deepEqual(state(steps, "designassessment"), ["done", "Assessed"]);
    assert.deepEqual(state(steps, "designconclusion"), [
      "attention",
      "Effective · to sign off",
    ]);
    // OE: planning approved; the interim item sent before the D&I sign-off is flagged, and
    // testing waits on the sign-off.
    assert.deepEqual(state(steps, "testdesign"), [
      "done",
      "Approved · 5 attributes",
    ]);
    assert.deepEqual(state(steps, "oeevidence"), [
      "attention",
      "Started before D&I sign-off",
    ]);
    assert.deepEqual(state(steps, "oetesting"), [
      "idle",
      "Waiting on D&I conclusion",
    ]);
    // The design workpaper no longer makes the final workpaper look done.
    assert.deepEqual(state(steps, "workpaper"), [
      "idle",
      "Waiting on the review",
    ]);
    assert.deepEqual(state(steps, "conclusion"), [
      "idle",
      "Waiting on D&I conclusion",
    ]);
    // Flagged OE work is not a next step: D&I is.
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["designevidence"],
    );
    // Once the reviewer signs it off as effective, the same OE item is progress.
    const cleared = workflowOf({
      ...midway(),
      designConclusion: signedEffective,
    });
    assert.deepEqual(state(cleared, "designconclusion"), [
      "done",
      "Effective · signed off",
    ]);
    assert.deepEqual(state(cleared, "oeevidence"), [
      "active",
      "1 with the client",
    ]);
    assert.deepEqual(
      cleared.filter((step) => step.next).map((step) => step.key),
      ["designevidence", "oeevidence"],
    );
  });

  it("makes the D&I sign-off the next step once its assessment is done", () => {
    const steps = workflowOf({
      ...midway(),
      requirements: [
        { phase: "DESIGN", state: "ACCEPTED" },
        { phase: "INTERIM", state: "NOT_GENERATED" },
      ],
    });
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["designconclusion"],
    );
    assert.equal(by(steps, "oeevidence")?.status, "Waiting on D&I conclusion");
  });

  it("holds OE again when the D&I sign-off no longer holds", () => {
    const steps = workflowOf({
      ...concluded(),
      conclusion: "NOT_CONCLUDED",
      reviewStatus: "",
      designConclusion: { ...signedEffective, status: "OUT_OF_DATE" },
    });
    assert.deepEqual(state(steps, "designconclusion"), [
      "attention",
      "Out of date · to sign again",
    ]);
    assert.deepEqual(state(steps, "oeevidence"), [
      "attention",
      "Started before D&I sign-off",
    ]);
    assert.deepEqual(state(steps, "oetesting"), [
      "attention",
      "Started before D&I sign-off",
    ]);
    assert.deepEqual(state(steps, "conclusion"), [
      "idle",
      "Waiting on D&I conclusion",
    ]);
  });

  it("never treats a prepared design workpaper alone as a D&I conclusion", () => {
    // The conclusion could not be read: the step asks for the sign-off, and OE stays held.
    const steps = workflowOf({ ...midway(), designConclusion: null });
    assert.deepEqual(state(steps, "designconclusion"), [
      "attention",
      "To sign off",
    ]);
    assert.equal(
      by(steps, "oeevidence")?.status,
      "Started before D&I sign-off",
    );
  });

  it("reads a concluded control as done, its D&I signed off", () => {
    const steps = workflowOf(concluded());
    assert.deepEqual(state(steps, "designevidence"), [
      "done",
      "2 of 2 accepted",
    ]);
    assert.deepEqual(state(steps, "designconclusion"), [
      "done",
      "Effective · signed off",
    ]);
    assert.deepEqual(state(steps, "oeevidence"), [
      "done",
      "2 accepted · 2 later",
    ]);
    assert.deepEqual(state(steps, "oetesting"), ["done", "Retest effective"]);
    assert.deepEqual(state(steps, "conclusion"), ["done", "Effective"]);
    assert.deepEqual(state(steps, "workpaper"), ["done", "Prepared"]);
    assert.deepEqual(progressOf(steps), { done: 11, of: 11 });
    assert.equal(
      steps.some((step) => step.next),
      false,
    );
  });

  // Rewritten 8 November 2026 for the product owner's correction: "OE can't start if design is
  // failing". Before: the branches ran in parallel, and with a design deficiency OE testing
  // still waited on OE evidence. Now: OE is not performed when D&I is concluded not effective,
  // and the control's conclusion is proposed on the design deficiency alone.
  it("does not perform OE when the design is not effective", () => {
    const steps = workflowOf({
      ...midway(),
      requirements: [
        { phase: "DESIGN", state: "ACCEPTED" },
        { phase: "INTERIM", state: "NOT_GENERATED" },
      ],
      findings: [{ reference: "D-007", status: "OPEN", type: "DESIGN" }],
      designConclusion: signedNotEffective,
    });
    assert.deepEqual(state(steps, "designconclusion"), [
      "done",
      "Not effective · signed off",
    ]);
    assert.deepEqual(state(steps, "oeevidence"), [
      "skipped",
      "Design not effective",
    ]);
    assert.deepEqual(state(steps, "oetesting"), [
      "skipped",
      "Design not effective",
    ]);
    assert.deepEqual(state(steps, "conclusion"), [
      "active",
      "Proposed: not effective",
    ]);
    // The two steps not performed are neither done nor left to do.
    assert.equal(progressOf(steps).of, 9);
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["conclusion"],
    );
  });

  it("holds OE evidence and testing until D&I is concluded, while planning may go ahead", () => {
    const steps = workflowOf(
      fresh({
        setup: understood,
        attributes: { approved: 3, proposed: 0 },
        plan: { exists: true, approved: true, pendingReview: false },
        requirements: [
          { phase: "DESIGN", state: "SENT" },
          { phase: "INTERIM", state: "NOT_GENERATED" },
        ],
      }),
    );
    assert.deepEqual(state(steps, "testdesign"), [
      "done",
      "Approved · 3 attributes",
    ]);
    assert.deepEqual(state(steps, "oeevidence"), [
      "idle",
      "Waiting on D&I conclusion",
    ]);
    assert.deepEqual(state(steps, "oetesting"), [
      "idle",
      "Waiting on D&I conclusion",
    ]);
    // Only D&I can move: OE waits on it.
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["designevidence"],
    );
    // Planning is a next step while D&I is under way.
    const planning = workflowOf(fresh({ setup: understood }));
    assert.ok(planning.find((step) => step.key === "testdesign")?.next);
  });

  // Rewritten 8 November 2026 (B2). Before: OE work done before a design found not effective
  // showed as done. Now it is kept and named "Not relied on": never "not performed", which would
  // hide work on record, and never done, since the conclusion does not rest on it.
  it("never calls OE work already done 'not performed', and does not rely on it", () => {
    const steps = workflowOf({
      ...concluded(),
      conclusion: "NOT_CONCLUDED",
      reviewStatus: "",
      findings: [{ reference: "D-007", status: "OPEN", type: "DESIGN" }],
      designConclusion: signedNotEffective,
    });
    assert.deepEqual(state(steps, "oeevidence"), [
      "attention",
      "Not relied on",
    ]);
    assert.deepEqual(state(steps, "oetesting"), ["attention", "Not relied on"]);
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["conclusion"],
    );
  });

  // Rewritten 8 November 2026 (B2). Before: OE evidence requested before the gate showed as it
  // stood ("1 with the client"). Now it is flagged, so OE run ahead of D&I is never read as
  // normal progress.
  it("flags OE evidence requested before the D&I sign-off", () => {
    const steps = workflowOf(
      fresh({
        setup: understood,
        plan: { exists: true, approved: true, pendingReview: false },
        requirements: [{ phase: "INTERIM", state: "SENT" }],
      }),
    );
    assert.deepEqual(state(steps, "oeevidence"), [
      "attention",
      "Started before D&I sign-off",
    ]);
    assert.equal(by(steps, "oeevidence")?.next, false);
  });

  it("asks a person to decide exceptions and resolve findings, inside OE Testing", () => {
    const sheet = {
      method: "SAMPLE" as const,
      status: "OPEN" as const,
      items: 10,
      tested: 10,
      exceptions: 1,
      running: false,
      decided: false,
      reference: null,
    };
    const base = { ...midway(), designConclusion: signedEffective };
    assert.equal(
      by(workflowOf({ ...base, sheet }), "oetesting")?.status,
      "1 exception to decide",
    );
    const raised = workflowOf({
      ...base,
      sheet: { ...sheet, decided: true, reference: "D-002" },
      findings: [{ reference: "D-002", status: "OPEN", type: "OPERATING" }],
    });
    assert.deepEqual(state(raised, "oetesting"), [
      "attention",
      "1 finding to resolve",
    ]);
    const testing = workflowOf({
      ...base,
      sheet: { ...sheet, tested: 4, exceptions: 0 },
    });
    assert.deepEqual(state(testing, "oetesting"), ["active", "4 of 10 tested"]);
  });

  it("proposes the conclusion once both branches are done, final at the review", () => {
    // Rewritten 9 November 2026 (bug hunt): before, the demo's control with D-001 closed
    // and its retest signed off effective was "Proposed: not effective" because every
    // finding counted; now it is "Proposed: effective", because the server's proposal
    // (control_conclusions.propose) counts only deficiencies not closed and treats
    // exceptions retested effective as effective.
    const steps = workflowOf({
      ...concluded(),
      conclusion: "NOT_CONCLUDED",
      reviewStatus: "",
    });
    assert.deepEqual(state(steps, "conclusion"), [
      "active",
      "Proposed: effective",
    ]);
    assert.deepEqual(state(steps, "review"), [
      "idle",
      "Waiting on the conclusion",
    ]);
    assert.equal(
      by(steps, "designconclusion")?.status,
      "Effective · signed off",
    );
  });

  // Regression (8 November 2026, NS-AC-06): a missing RCM detail marked only Setup as next,
  // hiding an insufficient OE evidence item and a sheet to sign off.
  it("marks each open branch's next step even while a setup detail is missing", () => {
    const steps = workflowOf({
      ...midway(),
      designConclusion: signedEffective,
      details: [
        { label: "Description", filled: true },
        { label: "Objective", filled: false },
      ],
    });
    assert.deepEqual(
      steps.filter((step) => step.next).map((step) => step.key),
      ["setup", "designevidence", "oeevidence"],
    );
    // Rewritten 8 November 2026 (B2). Before: a D&I conclusion waiting on the later review was
    // not a next step, and OE evidence was. Now the reviewer's D&I sign-off is the next step, and
    // OE evidence sent before it is flagged instead.
    const designDone = workflowOf({
      ...midway(),
      requirements: [
        { phase: "DESIGN", state: "ACCEPTED" },
        { phase: "INTERIM", state: "SENT" },
      ],
    });
    assert.deepEqual(
      designDone.filter((step) => step.next).map((step) => step.key),
      ["designconclusion"],
    );
  });

  it("marks the steps an agent is working on", () => {
    const steps = workflowOf(fresh({ busy: new Set(["oetesting"]) }));
    assert.equal(by(steps, "oetesting")?.agent, true);
    assert.equal(by(steps, "designassessment")?.agent, false);
  });

  // B1 (product owner, 8 November 2026): D&I evidence has its own release, once the control
  // is understood. Until a person releases it, the step says so, and nothing of it is asked.
  it("holds the D&I evidence for its own release", () => {
    const before = workflowOf(fresh({ designRelease: { step: "WAITING" } }));
    assert.deepEqual(state(before, "designevidence"), [
      "idle",
      "Waiting on understanding",
    ]);
    const ready = workflowOf(
      fresh({ setup: understood, designRelease: { step: "READY" } }),
    );
    assert.deepEqual(state(ready, "designevidence"), ["attention", TO_RELEASE]);
    assert.ok(ready.find((step) => step.key === "designevidence")?.next);
    // Released: the evidence items decide again, as before B1.
    const released = workflowOf(
      fresh({ setup: understood, designRelease: { step: "RELEASED" } }),
    );
    assert.notEqual(state(released, "designevidence")[1], TO_RELEASE);
    assert.deepEqual(
      state(released, "designevidence"),
      state(workflowOf(fresh({ setup: understood })), "designevidence"),
    );
    // Released early, before the control is understood: under way, not waiting.
    const early = workflowOf(
      fresh({
        designRelease: { step: "RELEASED" },
        requirements: [{ phase: "DESIGN", state: "DRAFT" }],
      }),
    );
    assert.deepEqual(state(early, "designevidence"), [
      "attention",
      "1 item to request",
    ]);
  });
});

describe("the workflow's addresses", () => {
  it("opens a step by its key", () => {
    assert.equal(openedFrom("designevidence", null), "designevidence");
    assert.equal(openedFrom(null, null), null);
    assert.equal(openedFrom("nonsense", null), null);
  });

  it("opens the step that now holds an earlier tab's, guided step's, or step's work", () => {
    assert.equal(openedFrom("overview", null), "setup");
    assert.equal(openedFrom("design", null), "designassessment");
    assert.equal(openedFrom("evidence", null), "oeevidence");
    assert.equal(openedFrom("testing", null), "oetesting");
    assert.equal(openedFrom("findings", null), "oetesting");
    assert.equal(openedFrom("approvals", null), "review");
    assert.equal(openedFrom("PLAN", null), "testdesign");
    assert.equal(openedFrom("history", null), "activity");
    // The 14-step workflow's steps of the same day.
    assert.equal(openedFrom("intake", null), "oeevidence");
    assert.equal(openedFrom("execute", null), "oetesting");
    assert.equal(openedFrom("signoff", null), "workpaper");
  });

  it("shows each step the section that holds its work", () => {
    assert.equal(SECTION_OF.setup, "risk");
    assert.equal(SECTION_OF.understanding, "setup-answers");
    assert.equal(SECTION_OF.designevidence, "evidence");
    assert.equal(SECTION_OF.designassessment, "design");
    assert.equal(SECTION_OF.designconclusion, "design-conclusion");
    assert.equal(SECTION_OF.testdesign, "setup-plan");
    assert.equal(SECTION_OF.oetesting, "testing");
    assert.equal(SECTION_OF.review, "approvals");
    assert.equal(SECTION_OF.activity, "history");
  });

  // Regression (8 November 2026): the address kept ?step= only up to 10 letters, so a longer
  // step's key opened nothing.
  it("keeps every step's key in the engagement's address check", () => {
    const source = readFileSync("apps/web/src/load-engagement.ts", "utf8");
    const pattern = /\/\^\[a-z\]\{1,(\d+)\}\$\/\.test\(query\.step\)/.exec(
      source,
    );
    assert.ok(
      pattern !== null,
      "the step check is a lower-case letters pattern",
    );
    const most = Number(pattern?.[1]);
    for (const step of STEPS) {
      assert.match(step.key, /^[a-z]+$/);
      assert.ok(
        step.key.length <= most,
        `${step.key} is longer than the address keeps`,
      );
    }
  });
});

describe("the workflow's layout", () => {
  // Rewritten 8 November 2026 (product owner: "the flow does not make sense"). The earlier
  // layout ran the branches column for column, so the "Effective" edge ran back from the D&I
  // Conclusion to OE Evidence, "Not effective" ran round the outside, and the conclusion row
  // ran right to left. The approved layout reads the way the audit is done: time runs left to
  // right, every edge runs forward or down, and OE Evidence sits directly under the D&I
  // Conclusion that clears it.
  const { placed, bands, edges, size } = workflowLayout();
  const at = (key: string) =>
    placed.find((item) => item.key === key) as { x: number; y: number };
  const inside = (
    point: { x: number; y: number },
    box: { x: number; y: number; width: number; height: number },
  ) =>
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height;

  it("places every step once, with no step overlapping another", () => {
    assert.equal(placed.length, 11);
    for (const a of placed) {
      for (const b of placed) {
        if (a !== b) {
          assert.ok(
            Math.abs(a.x - b.x) >= NODE_SIZE.width ||
              Math.abs(a.y - b.y) >= NODE_SIZE.height,
            `${a.key} overlaps ${b.key}`,
          );
        }
      }
    }
  });

  it("runs every edge forward or down, never back", () => {
    for (const edge of edges) {
      const from = at(edge.source);
      const to = at(edge.target);
      assert.ok(
        to.x > from.x || (to.x === from.x && to.y > from.y),
        `${edge.id} runs back`,
      );
    }
    assert.equal(edges.length, 12);
  });

  it("drops an effective D&I conclusion straight into OE evidence", () => {
    const gate = edges.find(
      (edge) => edge.id === "e:designconclusion>oeevidence",
    );
    assert.equal(gate?.label, "Effective");
    assert.equal(gate?.sourceHandle, "bottom");
    assert.equal(at("oeevidence").x, at("designconclusion").x);
    assert.ok(at("oeevidence").y > at("designconclusion").y);
    // Test design may start once the control is understood, beside D&I evidence.
    assert.equal(at("testdesign").x, at("designevidence").x);
    assert.ok(at("designevidence").y < at("testdesign").y);
    // Understanding opens both branches from between them; the conclusion joins them there.
    for (const key of ["understanding", "conclusion"]) {
      assert.ok(
        at(key).y > at("designevidence").y && at(key).y < at("testdesign").y,
        `${key} is not between the branches`,
      );
    }
  });

  it("joins a not-effective verdict and OE testing at the conclusion", () => {
    const skip = edges.find(
      (edge) => edge.id === "e:designconclusion>conclusion",
    );
    assert.equal(skip?.label, "Not effective");
    assert.ok(edges.some((edge) => edge.id === "e:oetesting>conclusion"));
    // Regression (8 November 2026): the "Not effective" label sat under OE Testing and read
    // "lot effective". The label sits halfway along its edge, clear of every step.
    const from = at("designconclusion");
    const to = at("conclusion");
    const label = {
      x: (from.x + NODE_SIZE.width + to.x) / 2,
      y: (from.y + to.y) / 2 + NODE_SIZE.height / 2,
    };
    for (const item of placed) {
      assert.ok(
        !inside(label, { ...item, ...NODE_SIZE }),
        `the label sits on ${item.key}`,
      );
    }
  });

  it("draws a band round each stage, holding its own steps only", () => {
    assert.deepEqual(
      bands.map((band) => band.label),
      ["Understand", "D&I branch", "OE branch", "Conclude"],
    );
    for (const step of STEPS) {
      const box = { ...at(step.key), ...NODE_SIZE };
      for (const band of bands) {
        const corners = [
          { x: box.x, y: box.y },
          { x: box.x + box.width, y: box.y + box.height },
        ];
        const held = corners.every((corner) => inside(corner, band));
        assert.equal(
          held,
          band.key === step.group,
          `${step.key} and the ${band.label} band`,
        );
      }
    }
    // The canvas frames all of it, from the origin.
    for (const band of bands) {
      assert.ok(band.x >= 0 && band.y >= 0);
      assert.ok(band.x + band.width <= size.width);
      assert.ok(band.y + band.height <= size.height);
    }
  });
});

describe("the proposed control conclusion", () => {
  const done = () => ({
    ...concluded(),
    conclusion: "NOT_CONCLUDED" as const,
    reviewStatus: "",
  });

  it("is not effective while a deficiency is not closed", () => {
    const steps = workflowOf({
      ...done(),
      findings: [
        { reference: "D-001", status: "REMEDIATED", type: "OPERATING" },
      ],
    });
    assert.deepEqual(state(steps, "conclusion"), [
      "active",
      "Proposed: not effective",
    ]);
  });

  it("shows the verdict the server proposes when it is loaded", () => {
    const effective = workflowOf({
      ...done(),
      proposedConclusion: "EFFECTIVE",
    });
    assert.equal(by(effective, "conclusion")?.status, "Proposed: effective");
    // Exceptions neither dismissed nor retested, with no finding: the server decides.
    const not = workflowOf({
      ...done(),
      findings: [],
      proposedConclusion: "NOT_EFFECTIVE",
    });
    assert.equal(by(not, "conclusion")?.status, "Proposed: not effective");
  });
});

describe("returnStep", () => {
  it("names the step a form was posted from, and nothing else", () => {
    // Bug hunt 9 November 2026: the routes redirected with ?tab=workpapers or ?tab=evidence,
    // which open the OE steps, so work done on a D&I step landed on the OE one.
    assert.equal(returnStep("designassessment"), "designassessment");
    assert.equal(returnStep("DesignEvidence"), "designevidence");
    assert.equal(
      openedFrom(returnStep("designevidence"), "evidence"),
      "designevidence",
    );
    for (const value of [
      "",
      "request",
      "activity",
      "evidence",
      null,
      undefined,
    ]) {
      assert.equal(returnStep(value), null);
    }
  });
});
