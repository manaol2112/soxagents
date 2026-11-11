import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SECTION_OF,
  STEPS,
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  agentNote,
  PREPARED_TITLE,
  panelFrame,
} from "../apps/web/src/step-panel-model.ts";

// A control midway (the product owner's screenshot, 8 November 2026): understood, plan
// approved, one D&I item received to decide, the design workpaper prepared, the D&I
// conclusion awaiting the reviewer, and interim evidence requested before the sign-off.
function midway(overrides: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    details: [
      { label: "Description", filled: true },
      { label: "Objective", filled: false },
      { label: "Frequency", filled: true },
      { label: "Owner", filled: true },
      { label: "Risk", filled: true },
    ],
    setup: [
      {
        key: "answers",
        done: true,
        optional: false,
        mine: false,
        summary: "Answered",
      },
      {
        key: "process",
        done: true,
        optional: false,
        mine: false,
        summary: "Understood",
      },
    ],
    attributes: { approved: 2, proposed: 0 },
    plan: { exists: true, approved: true, pendingReview: false },
    requirements: [
      { phase: "DESIGN", state: "ACCEPTED" },
      { phase: "DESIGN", state: "RECEIVED" },
      { phase: "INTERIM", state: "SENT" },
    ],
    sheet: null,
    rounds: [],
    findings: [],
    reviewStatus: "",
    conclusion: "NOT_CONCLUDED",
    proposedConclusion: null,
    designPaper: { status: "PREPARED", drafting: false },
    designConclusion: {
      status: "TO_SIGN",
      proposed: "EFFECTIVE",
      signed: null,
    },
    effectivenessPaper: null,
    busy: new Set(),
    ...overrides,
  };
}

describe("a step's panel frame", () => {
  it("asks a person for the step's decision, with one action into its work", () => {
    const steps = workflowOf(midway());
    const frame = panelFrame("designconclusion", steps, null);
    assert.equal(frame.need.kind, "act");
    assert.equal(frame.need.title, "Sign off the D&I conclusion");
    assert.equal(frame.need.action?.anchor, "stp-work");
    // What it rests on: the step that leads into it.
    assert.deepEqual(
      frame.basedOn.map((item) => item.key),
      ["designassessment"],
    );
  });

  it("names the step an OE step waits on, and opens it", () => {
    const steps = workflowOf(
      midway({ requirements: [{ phase: "DESIGN", state: "ACCEPTED" }] }),
    );
    const frame = panelFrame("oetesting", steps, null);
    assert.equal(frame.need.kind, "wait");
    assert.equal(frame.need.title, "Waiting on D&I conclusion");
  });

  it("names the step that holds a waiting step, past steps that only wait themselves", () => {
    const steps = workflowOf(
      midway({ requirements: [{ phase: "DESIGN", state: "ACCEPTED" }] }),
    );
    // The review waits on the conclusion, which waits on the D&I sign-off.
    const frame = panelFrame("review", steps, null);
    assert.equal(frame.need.kind, "wait");
    assert.equal(frame.need.action?.step, "designconclusion");
    assert.match(frame.need.detail, /D&I Conclusion/);
  });

  it("flags OE work recorded before the D&I sign-off, and links to the sign-off", () => {
    const steps = workflowOf(midway());
    const frame = panelFrame("oeevidence", steps, null);
    assert.equal(frame.need.kind, "flag");
    assert.equal(frame.need.action?.step, "designconclusion");
  });

  it("follows the D&I verdict: both ways until it is signed, then only the one taken", () => {
    const steps = workflowOf(midway());
    const open = panelFrame("designconclusion", steps, null);
    assert.deepEqual(
      open.next.map((item) => [item.key, item.when]),
      [
        ["oeevidence", "If effective"],
        ["conclusion", "If not effective"],
      ],
    );
    const effective = panelFrame("designconclusion", steps, "EFFECTIVE");
    assert.deepEqual(
      effective.next.map((item) => item.key),
      ["oeevidence"],
    );
    const not = panelFrame("designconclusion", steps, "NOT_EFFECTIVE");
    assert.deepEqual(
      not.next.map((item) => item.key),
      ["conclusion"],
    );
  });

  it("says a step not performed is not performed, with no action", () => {
    const steps = workflowOf(
      midway({
        requirements: [{ phase: "DESIGN", state: "ACCEPTED" }],
        designConclusion: {
          status: "SIGNED_OFF",
          proposed: "NOT_EFFECTIVE",
          signed: "NOT_EFFECTIVE",
        },
      }),
    );
    const frame = panelFrame("oeevidence", steps, "NOT_EFFECTIVE");
    assert.equal(frame.need.kind, "skipped");
    assert.equal(frame.need.action, undefined);
  });

  it("gives every step a title for its work, and its own section", () => {
    for (const step of STEPS) {
      assert.ok(PREPARED_TITLE[step.key].length > 0, step.key);
    }
    // The conclusion and the workpaper have work of their own, no longer another step's.
    assert.equal(SECTION_OF.conclusion, "conclusion");
    assert.equal(SECTION_OF.workpaper, "workpaper");
  });

  it("asks for the D&I release when the evidence waits for it (B1)", () => {
    const steps = workflowOf(
      midway({
        requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
        designRelease: { step: "READY" },
      }),
    );
    const frame = panelFrame("designevidence", steps, null);
    assert.equal(frame.need.kind, "act");
    assert.equal(frame.need.title, "Release the D&I evidence");
    assert.match(frame.need.detail, /approved before it is sent/);
    assert.equal(frame.need.action?.anchor, "stp-work");
  });
});

describe("the agent's strip", () => {
  it("says what the agent did and found, from the records only", () => {
    const input = midway();
    const steps = workflowOf(input);
    const at = (key: string) => {
      const step = steps.find((item) => item.key === key);
      assert.ok(step !== undefined);
      return step;
    };
    assert.deepEqual(agentNote(at("setup"), input).found, [
      "Not in the RCM: objective.",
    ]);
    assert.deepEqual(agentNote(at("designevidence"), input).found, [
      "2 evidence items planned, 1 accepted.",
      "1 item received and read, to decide.",
    ]);
    assert.deepEqual(agentNote(at("designconclusion"), input).found, [
      "Proposed: effective.",
    ]);
    assert.deepEqual(agentNote(at("oetesting"), input).found, [
      "No samples are drawn yet.",
    ]);
    for (const step of steps) {
      const note = agentNote(step, input);
      assert.ok(note.did.endsWith("."), step.key);
      // Neutral voice: never the agent in the first person.
      // ("D&I" is the branch, not the first person.)
      assert.doesNotMatch(note.did, /(^|\s)(I|I'm|I've|we|We)(\s|$)/, step.key);
    }
  });
});
