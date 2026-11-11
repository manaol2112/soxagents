import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  journey,
  nextStep,
  nodeFlags,
} from "../apps/web/src/next-step-model.ts";

const about = { ref: "ITGC-AC-02", system: "Workday HCM" };

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

// A control just mapped to a system: set up from the RCM, nothing understood yet.
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

describe("the control's next step (product owner, 10 November 2026)", () => {
  it("tells a new control where to start: its understanding, in plain words", () => {
    const input = fresh();
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.equal(next.actions.length, 1);
    const [first] = next.actions;
    assert.equal(first?.key, "understanding");
    assert.equal(first?.title, "Confirm how ITGC-AC-02 runs on Workday HCM");
    assert.equal(first?.label, "Start: Control Understanding");
    assert.equal(first?.flag, "Start here");
    assert.equal(first?.kind, "act");
    assert.equal(first?.kindLabel, "AI agent");
    // What the records show, never an invented estimate.
    assert.ok((first?.facts.length ?? 0) > 0);
    assert.deepEqual(nodeFlags(next), { understanding: "Start here" });
  });

  it("names the control when its RCM details are what is missing", () => {
    const input = fresh({
      details: [
        { label: "Description", filled: true },
        { label: "Owner", filled: false },
      ],
    });
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.equal(next.actions[0]?.key, "setup");
    assert.equal(next.actions[0]?.title, "Complete ITGC-AC-02's details");
    assert.equal(next.actions[0]?.label, "Start: RCM / Control Setup");
  });

  it("says when an agent is preparing the step, and asks nothing of the person", () => {
    const input = fresh({ busy: new Set(["understanding"]) });
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.equal(next.actions[0]?.kind, "agent");
    assert.equal(
      next.actions[0]?.title,
      "Control Understanding is being prepared",
    );
    assert.equal(next.actions[0]?.flag, "Being prepared");
  });

  it("offers both branches once the control is understood, each with its own action", () => {
    const input = fresh({ setup: understood });
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.deepEqual(
      next.actions.map((each) => each.key),
      ["designevidence", "testdesign"],
    );
    assert.deepEqual(nodeFlags(next), {
      designevidence: "Ready",
      testdesign: "Ready",
    });
    // Two at once: each button names its own action, not "Start".
    assert.ok(next.actions.every((each) => !each.label.startsWith("Start:")));
  });

  it("is never out of step with the nodes: it names exactly the steps marked next", () => {
    for (const input of [
      fresh(),
      fresh({ setup: understood }),
      fresh({ busy: new Set(["understanding"]) }),
    ]) {
      const steps = workflowOf(input);
      const next = nextStep(steps, input, about);
      assert.deepEqual(
        Object.keys(nodeFlags(next)).sort(),
        steps
          .filter((step) => step.next)
          .map((step) => step.key)
          .sort(),
      );
    }
  });

  it("says when every step is done, and when nothing is for the person yet", () => {
    const input = fresh();
    const all = workflowOf(input).map((step) => ({
      ...step,
      tone: "done" as const,
      next: false,
    }));
    assert.deepEqual(nextStep(all, input, about), { mode: "done" });
    const held = workflowOf(input).map((step) => ({ ...step, next: false }));
    assert.equal(nextStep(held, input, about).mode, "waiting");
    assert.deepEqual(nodeFlags({ mode: "done" }), {});
  });

  it("puts the eleven steps in five stages, with where the control is", () => {
    const start = journey(workflowOf(fresh()));
    assert.deepEqual(
      start.map((stage) => [stage.label, stage.state]),
      [
        ["Set up", "done"],
        ["Understand", "here"],
        ["D&I evidence", "todo"],
        ["Test", "todo"],
        ["Conclude", "todo"],
      ],
    );
    const branches = journey(workflowOf(fresh({ setup: understood })));
    assert.deepEqual(
      branches.map((stage) => stage.state),
      ["done", "done", "here", "todo", "todo"],
    );
  });
});
