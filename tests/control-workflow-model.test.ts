import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FRAME_PAD,
  NODE_SIZE,
  openedFrom,
  progressOf,
  READABLE_ZOOM,
  returnStep,
  SECTION_OF,
  STEPS,
  sidewaysLimits,
  type WorkflowInput,
  workflowFrame,
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

// The attributes settled: approved, none proposed, no open question (11 November 2026).
const settled = { approved: 5, proposed: 0 };

const by = (steps: ReturnType<typeof workflowOf>, key: string) =>
  steps.find((step) => step.key === key);
const state = (steps: ReturnType<typeof workflowOf>, key: string) => [
  by(steps, key)?.tone,
  by(steps, key)?.status,
];

describe("the control's workflow", () => {
  // Rewritten 11 November 2026 (product owner: "it does not follow what we've just updated";
  // chose "Attributes step first"). Old: eleven steps, with the attributes inside "Test Design
  // & Approval" on the OE branch, so D&I Evidence did not depend on them. New: twelve, with
  // the Attributes a human gate before both branches, and the OE step "Scope & Sampling".
  it("is the product owner's steps: understanding, the attributes, then two branches", () => {
    assert.deepEqual(
      STEPS.map((step) => step.title),
      [
        "RCM / Control Setup",
        "Control Understanding",
        "Attributes",
        "D&I Evidence",
        "D&I Assessment",
        "D&I Conclusion",
        "Scope & Sampling",
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
    assert.deepEqual(
      STEPS.filter((step) => step.group === "prepare").map((step) => step.key),
      ["setup", "understanding", "attributes"],
    );
    // People decide at the gates.
    assert.deepEqual(
      STEPS.filter((step) => step.kind === "gate").map((step) => step.key),
      ["attributes", "designconclusion", "testdesign", "review"],
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
    // Rewritten 11 November 2026: Scope & Sampling waits on the attributes, which wait on
    // the understanding (before: Test Design waited on the understanding itself).
    assert.deepEqual(state(start, "attributes"), [
      "idle",
      "Waiting on understanding",
    ]);
    assert.deepEqual(state(start, "testdesign"), [
      "idle",
      "Waiting on the attributes",
    ]);
    assert.deepEqual(
      start.filter((step) => step.next).map((step) => step.key),
      ["understanding"],
    );
    // Understood: the attributes are next, alone (before: both branches opened here).
    const understoodOnly = workflowOf(
      fresh({ setup: understood, attributes: { approved: 4, proposed: 1 } }),
    );
    assert.deepEqual(state(understoodOnly, "attributes"), [
      "attention",
      "1 attribute to decide",
    ]);
    assert.deepEqual(
      understoodOnly.filter((step) => step.next).map((step) => step.key),
      ["attributes"],
    );
    // An open question about them holds them too, and so does none approved.
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            setup: understood,
            attributes: { approved: 4, proposed: 0, questions: 2 },
          }),
        ),
        "attributes",
      ),
      ["attention", "2 questions on the attributes"],
    );
    assert.deepEqual(
      state(workflowOf(fresh({ setup: understood })), "attributes"),
      ["attention", "None approved yet"],
    );
    // Approved, but the testers have no criteria tailored to the control for two of them
    // (11 November 2026): not settled.
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            setup: understood,
            attributes: { approved: 5, proposed: 0, untailored: 2 },
          }),
        ),
        "attributes",
      ),
      ["attention", "2 need criteria"],
    );
    // Settled: both branches open.
    const both = workflowOf(fresh({ setup: understood, attributes: settled }));
    assert.deepEqual(state(both, "attributes"), [
      "done",
      "5 attributes settled",
    ]);
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
    // Twelve steps since the Attributes step (11 November 2026; before: eleven).
    assert.deepEqual(progressOf(steps), { done: 12, of: 12 });
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
    // The two steps not performed are neither done nor left to do (twelve steps since 11
    // November 2026, so ten counted; before: nine of eleven).
    assert.equal(progressOf(steps).of, 10);
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
    // Planning is a next step while D&I is under way, once the attributes are settled.
    const planning = workflowOf(
      fresh({ setup: understood, attributes: settled }),
    );
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
  // is understood, and nothing of it is asked before. B2 (product owner, 12 November 2026:
  // "Why do I need to have the release button? Simplify the workflow. After the attributes
  // approval, list down the evidences so that I can add, modify or update, or delete."): no
  // person presses Release. The server releases once the requests list is settled, so the
  // step reads as its list does. Renamed from "holds the D&I evidence for its own release".
  it("holds the D&I evidence until its requests list is settled", () => {
    const before = workflowOf(fresh({ designRelease: { step: "WAITING" } }));
    assert.deepEqual(state(before, "designevidence"), [
      "idle",
      "Waiting on understanding",
    ]);
    // Understood, the attributes not settled: the release waits on them (11 November 2026).
    const unsettled = workflowOf(
      fresh({
        setup: understood,
        attributes: { approved: 4, proposed: 1 },
        designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
      }),
    );
    assert.deepEqual(state(unsettled, "designevidence"), [
      "idle",
      "Waiting on the attributes",
    ]);
    assert.equal(
      unsettled.find((step) => step.key === "designevidence")?.next,
      false,
    );
    // The counts look settled but the server still waits (the agent is updating them).
    const updating = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
      }),
    );
    assert.deepEqual(state(updating, "attributes"), [
      "active",
      "Being updated",
    ]);
    assert.deepEqual(state(updating, "designevidence"), [
      "idle",
      "Waiting on the attributes",
    ]);
    // An approved attribute no D&I request addresses holds the step (12 November 2026).
    // Old expectation: "Not planned against the attributes", when no item evidenced any
    // attribute at all. New: EVIDENCE means any approved attribute is uncovered without a
    // recorded reason ("For each request, I want to show which specific attributes it is
    // addressing to make sure I get coverage"), so the step says attributes are not
    // addressed, and names the attribute where the list was read.
    const untraced = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "WAITING", waitingOn: "EVIDENCE" },
      }),
    );
    assert.deepEqual(state(untraced, "attributes")[0], "done");
    assert.deepEqual(state(untraced, "designevidence"), [
      "attention",
      "Attributes not addressed",
    ]);
    const uncovered = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "WAITING", waitingOn: "EVIDENCE" },
        designRequests: {
          tone: "attention",
          status: "Attribute D is not addressed",
        },
      }),
    );
    assert.deepEqual(state(uncovered, "designevidence"), [
      "attention",
      "Attribute D is not addressed",
    ]);
    // Requests the agent proposed wait for a person: the step says how many, as its list
    // does, or that requests wait where the list was not read.
    const toAccept = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
        designRequests: { tone: "attention", status: "3 to accept" },
      }),
    );
    assert.deepEqual(state(toAccept, "designevidence"), [
      "attention",
      "3 to accept",
    ]);
    assert.ok(toAccept.find((step) => step.key === "designevidence")?.next);
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            setup: understood,
            attributes: settled,
            designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
          }),
        ),
        "designevidence",
      ),
      ["attention", "Requests to accept"],
    );
    // The list never speaks before the steps it rests on: the attributes still hold it.
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            setup: understood,
            attributes: { approved: 4, proposed: 1 },
            designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
            designRequests: { tone: "attention", status: "3 to accept" },
          }),
        ),
        "designevidence",
      ),
      ["idle", "Waiting on the attributes"],
    );
    // The agents are tailoring after the understanding (12 November 2026): the step reads
    // as being updated whatever the counts still say, not "N need criteria".
    const tailoring = workflowOf(
      fresh({
        setup: understood,
        attributes: { approved: 6, proposed: 1, untailored: 6 },
        designRelease: {
          step: "WAITING",
          waitingOn: "ATTRIBUTES",
          waitingFor:
            "The attributes are not settled: the agent is still updating them.",
        },
      }),
    );
    assert.deepEqual(state(tailoring, "attributes"), [
      "active",
      "Being updated",
    ]);
    // Once it finishes the counts speak again.
    const tailored = workflowOf(
      fresh({
        setup: understood,
        attributes: { approved: 6, proposed: 1, untailored: 6 },
        designRelease: {
          step: "WAITING",
          waitingOn: "ATTRIBUTES",
          waitingFor:
            "The attributes are not settled: 1 proposed attribute waits for a decision.",
        },
      }),
    );
    assert.deepEqual(state(tailored, "attributes"), [
      "attention",
      "1 attribute to decide",
    ]);
    const ready = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "READY" },
      }),
    );
    // Old expectation: "To release", the step waiting for a person to press Release. New:
    // a ready phase is a settled list (every request accepted, every attribute addressed),
    // so the step reads "Requests accepted"; there is no Release button to wait for. And
    // it is at rest, not a person's to act on (product owner, 12 November 2026: "Yes. I
    // don't want a separate D&I release."): the server releases it itself. (Between the
    // two, this read ["attention", "Requests accepted"], with a fallback button to draft.)
    assert.deepEqual(state(ready, "designevidence"), [
      "idle",
      "Requests accepted",
    ]);
    assert.ok(ready.find((step) => step.key === "designevidence")?.next);
    // Released: the evidence items decide again, as before B1.
    const released = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "RELEASED" },
      }),
    );
    assert.notEqual(state(released, "designevidence")[1], "Requests accepted");
    assert.deepEqual(
      state(released, "designevidence"),
      state(
        workflowOf(fresh({ setup: understood, attributes: settled })),
        "designevidence",
      ),
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
    // Just released, its requests being drafted: the list is still the step's, at rest.
    const drafting = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: { step: "RELEASED" },
        designRequests: { tone: "active", status: "Requests accepted" },
        requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
      }),
    );
    assert.deepEqual(state(drafting, "designevidence"), [
      "active",
      "Requests accepted",
    ]);
  });

  // Regression (independent review, 11 November 2026, H1): the setup steps done read as
  // "Understood" while the server's gate (phase_release.understanding_waits) still waited on
  // required walkthrough questions, so the Attributes step and the branches opened while the
  // D&I release card said "Complete Control Understanding first".
  it("is not understood while the D&I release still waits on the understanding", () => {
    const walkthrough = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: {
          step: "WAITING",
          waitingOn: "UNDERSTANDING",
          waitingFor:
            "Control Understanding is not complete: 4 walkthrough questions are not answered.",
        },
      }),
    );
    assert.deepEqual(state(walkthrough, "understanding"), [
      "attention",
      "Walkthrough to finish",
    ]);
    assert.deepEqual(state(walkthrough, "attributes"), [
      "idle",
      "Waiting on understanding",
    ]);
    assert.deepEqual(state(walkthrough, "designevidence"), [
      "idle",
      "Waiting on understanding",
    ]);
    assert.deepEqual(state(walkthrough, "testdesign"), [
      "idle",
      "Waiting on the attributes",
    ]);
    // The branches stay closed: the understanding is the one next step.
    assert.deepEqual(
      walkthrough.filter((step) => step.next).map((step) => step.key),
      ["understanding"],
    );
    // Another reason the server holds it (an open question on the control): a short generic
    // status, within the node's room.
    const open = workflowOf(
      fresh({
        setup: understood,
        attributes: settled,
        designRelease: {
          step: "WAITING",
          waitingOn: "UNDERSTANDING",
          waitingFor:
            "Control Understanding is not complete: 2 questions are open.",
        },
      }),
    );
    assert.deepEqual(state(open, "understanding"), [
      "attention",
      "Questions to answer",
    ]);
    for (const steps of [walkthrough, open]) {
      for (const step of steps) {
        assert.doesNotMatch(step.status, /^(Once|When)\b/);
        assert.ok(step.status.length <= 28, `${step.key}: ${step.status}`);
      }
    }
    // The setup steps still decide first, in their own words.
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            designRelease: {
              step: "WAITING",
              waitingOn: "UNDERSTANDING",
              waitingFor:
                "Control Understanding is not complete: 3 questions are not answered.",
            },
          }),
        ),
        "understanding",
      ),
      ["attention", "3 to answer"],
    );
    // Waiting on the attributes only: understood, as before.
    assert.deepEqual(
      state(
        workflowOf(
          fresh({
            setup: understood,
            attributes: settled,
            designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
          }),
        ),
        "understanding",
      ),
      ["done", "Understood"],
    );
  });

  // Regression (independent review, 11 November 2026, H3): once attributes needed criteria
  // tailored to the control, controls already under way (D&I released, plan approved) showed
  // "N need criteria" and no branch step as next. The branches stay open once work on them
  // has started; before then the attributes still gate them.
  it("keeps an in-flight control's branch next steps while its attributes need criteria", () => {
    const needCriteria = { approved: 5, proposed: 0, untailored: 2 };
    const released = workflowOf(
      fresh({
        setup: understood,
        attributes: needCriteria,
        designRelease: { step: "RELEASED" },
        requirements: [{ phase: "DESIGN", state: "RECEIVED" }],
      }),
    );
    assert.deepEqual(state(released, "attributes"), [
      "attention",
      "2 need criteria",
    ]);
    assert.deepEqual(state(released, "designevidence"), [
      "attention",
      "1 item to review",
    ]);
    assert.deepEqual(
      released.filter((step) => step.next).map((step) => step.key),
      ["attributes", "designevidence"],
    );
    const approvedPlan = workflowOf({
      ...midway(),
      attributes: needCriteria,
      designConclusion: signedEffective,
      designRelease: { step: "COMPLETE" },
    });
    assert.deepEqual(state(approvedPlan, "attributes"), [
      "attention",
      "2 need criteria",
    ]);
    assert.deepEqual(
      approvedPlan.filter((step) => step.next).map((step) => step.key),
      ["attributes", "designevidence", "oeevidence"],
    );
    // The plan approved alone keeps the branches open too.
    const planOnly = workflowOf({
      ...midway(),
      attributes: needCriteria,
      designConclusion: signedEffective,
    });
    assert.deepEqual(
      planOnly.filter((step) => step.next).map((step) => step.key),
      ["attributes", "designevidence", "oeevidence"],
    );
    // Before any of that, the attributes still gate both branches.
    const before = workflowOf(
      fresh({
        setup: understood,
        attributes: needCriteria,
        designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
      }),
    );
    assert.deepEqual(
      before.filter((step) => step.next).map((step) => step.key),
      ["attributes"],
    );
    assert.deepEqual(state(before, "testdesign"), [
      "idle",
      "Waiting on the attributes",
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
    assert.equal(placed.length, 12);
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
    assert.equal(edges.length, 13);
  });

  it("drops an effective D&I conclusion straight into OE evidence", () => {
    const gate = edges.find(
      (edge) => edge.id === "e:designconclusion>oeevidence",
    );
    assert.equal(gate?.label, "Effective");
    assert.equal(gate?.sourceHandle, "bottom");
    assert.equal(at("oeevidence").x, at("designconclusion").x);
    assert.ok(at("oeevidence").y > at("designconclusion").y);
    // Scope & Sampling may start once the attributes are settled, beside D&I evidence.
    assert.equal(at("testdesign").x, at("designevidence").x);
    assert.ok(at("designevidence").y < at("testdesign").y);
    // Rewritten 11 November 2026: the Attributes (before: Control Understanding) open both
    // branches from between them, under the understanding; the conclusion joins them there.
    assert.equal(at("attributes").x, at("understanding").x);
    assert.ok(at("understanding").y < at("attributes").y);
    assert.ok(edges.some((edge) => edge.id === "e:attributes>designevidence"));
    assert.ok(edges.some((edge) => edge.id === "e:attributes>testdesign"));
    assert.ok(
      !edges.some(
        (edge) =>
          edge.source === "understanding" && edge.target !== "attributes",
      ),
    );
    for (const key of ["attributes", "conclusion"]) {
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

  it("prepares in order: setup, then the understanding beside it, then the attributes below", () => {
    // Rewritten 11 November 2026 (product owner: the nodes were too small to read). Old: Setup,
    // Control Understanding and the Attributes stacked in one column, two rows above the D&I
    // branch, so the workflow was five rows high and framed at about half size. New: Setup
    // sits beside the understanding on the D&I row, and the Attributes under the
    // understanding, so the workflow is four rows high and is read at full size. The order
    // and the direction of every edge are unchanged.
    assert.equal(at("setup").y, at("understanding").y);
    assert.ok(at("setup").x + NODE_SIZE.width < at("understanding").x);
    assert.equal(at("setup").y, at("designevidence").y);
    const into = (key: string) =>
      edges.filter((edge) => edge.target === key).map((edge) => edge.source);
    assert.deepEqual(into("understanding"), ["setup"]);
    assert.deepEqual(into("attributes"), ["understanding"]);
    // The preparation comes before both branches.
    for (const key of ["setup", "understanding", "attributes"]) {
      assert.ok(at(key).x + NODE_SIZE.width < at("designevidence").x);
    }
    // Review and the workpaper follow below the conclusion.
    assert.equal(at("review").x, at("conclusion").x);
    assert.equal(at("workpaper").x, at("conclusion").x);
    assert.ok(at("conclusion").y < at("review").y);
    assert.ok(at("review").y < at("workpaper").y);
  });

  it("is compact: four rows, every step on the grid", () => {
    const rows = new Set(placed.map((item) => item.y));
    assert.equal(rows.size, 4);
    // Before (8 to 11 November 2026) the workflow was about 1,430 by 730 canvas units and
    // drawn at about 0.55; it is now 1,804 by 602 and drawn at 0.9 or more.
    assert.ok(size.height <= 620, `${size.height} high`);
    assert.ok(size.width <= 1820, `${size.width} wide`);
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

describe("the workflow's first view", () => {
  // Added 11 November 2026 (product owner: "I can't even read the letters on it"). The canvas
  // was 620 px high and framed the whole workflow, at about 0.55, so its 13 px titles read at
  // 7 px. It now opens at the readable zoom or more, and pans sideways where it is wider.
  const { placed, size } = workflowLayout();
  const at = (key: string) =>
    placed.find((item) => item.key === key) as { x: number; y: number };

  it("is never framed below the readable zoom at the usual widths", () => {
    for (const width of [988, 1100, 1146, 1280, 1440]) {
      const frame = workflowFrame(width, size);
      assert.ok(frame.zoom >= READABLE_ZOOM, `${frame.zoom} at ${width}px`);
      assert.ok(frame.zoom >= 0.9);
      assert.ok(frame.zoom <= 1);
    }
    const typical = workflowFrame(1100, size);
    assert.equal(typical.zoom, 0.9);
    // A 16 px title and 13.5 px lines on the node, at that zoom.
    assert.ok(16 * typical.zoom >= 14);
    assert.ok(13.5 * typical.zoom >= 12);
  });

  it("pans sideways where the workflow is wider than the canvas, opening at its start", () => {
    const frame = workflowFrame(1100, size);
    assert.equal(frame.pans, true);
    assert.equal(frame.x, FRAME_PAD * frame.zoom);
    const limits = sidewaysLimits(frame.zoom, 1100, size.width);
    assert.ok(limits !== null);
    // Panned fully, the end of the workflow and its margin are in view.
    assert.equal(limits.min + (size.width + FRAME_PAD) * frame.zoom, 1100);
  });

  it("shows the whole workflow, centred, where it fits", () => {
    const wide = workflowFrame(4000, size);
    assert.equal(wide.zoom, 1);
    assert.equal(wide.pans, false);
    assert.equal(wide.x, (4000 - size.width) / 2);
    assert.equal(sidewaysLimits(1, 4000, size.width), null);
    // Just short of full size, it fits by zooming a little out, not by panning.
    const near = workflowFrame((size.width + FRAME_PAD * 2) * 0.95, size);
    assert.ok(Math.abs(near.zoom - 0.95) < 1e-9);
    assert.equal(near.pans, false);
  });

  it("sizes the canvas to the workflow, with no empty space below it", () => {
    for (const width of [1100, 1440, 4000]) {
      const frame = workflowFrame(width, size);
      assert.equal(
        frame.height,
        Math.round((size.height + FRAME_PAD * 2) * frame.zoom),
      );
      assert.equal(frame.y, FRAME_PAD * frame.zoom);
    }
    assert.ok(workflowFrame(1100, size).height <= 640);
  });

  it("moves on only as far as the step to do next, with what leads into it", () => {
    const step = at("oetesting");
    const frame = workflowFrame(1100, size, {
      x: step.x,
      width: NODE_SIZE.width,
    });
    const right = frame.x + (step.x + NODE_SIZE.width) * frame.zoom;
    const left = frame.x + step.x * frame.zoom;
    assert.ok(right <= 1100, "the step is cut off on the right");
    assert.ok(left >= 0, "the step is cut off on the left");
    assert.ok(left > NODE_SIZE.width * frame.zoom, "nothing leads into it");
    // A step already in view leaves the workflow at its start.
    const first = at("designevidence");
    assert.equal(
      workflowFrame(1100, size, { x: first.x, width: NODE_SIZE.width }).x,
      FRAME_PAD * frame.zoom,
    );
    // The last step never moves the workflow past its end.
    const last = at("workpaper");
    const end = workflowFrame(1100, size, {
      x: last.x,
      width: NODE_SIZE.width,
    });
    const limits = sidewaysLimits(end.zoom, 1100, size.width);
    assert.ok(limits !== null && end.x >= limits.min);
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
