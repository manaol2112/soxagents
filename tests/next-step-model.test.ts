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

  // Rewritten 11 November 2026: the branches open once the attributes are settled (before:
  // once the control was understood), since D&I is a test of one against them.
  it("offers both branches once the attributes are settled, each with its own action", () => {
    const input = fresh({
      setup: understood,
      attributes: { approved: 5, proposed: 0 },
    });
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
      fresh({ setup: understood, attributes: { approved: 5, proposed: 0 } }),
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
    // Rewritten 11 November 2026 (product owner: "after control understanding, why am I
    // being asked to release the evidence"). Old expectation: only the first branch with a
    // next step was "here" ([done, done, here, todo, todo]), so Test read as coming after
    // D&I. New: every stage holding a next step is current, since the D&I and OE branches
    // run side by side once the control is understood.
    // The Attributes step (11 November 2026) sits in the Understand stage: understood but
    // not settled, the control is still there; settled, both branches are current.
    assert.deepEqual(
      journey(workflowOf(fresh({ setup: understood }))).map(
        (stage) => stage.state,
      ),
      ["done", "here", "todo", "todo", "todo"],
    );
    const branches = journey(
      workflowOf(
        fresh({ setup: understood, attributes: { approved: 5, proposed: 0 } }),
      ),
    );
    assert.deepEqual(
      branches.map((stage) => stage.state),
      ["done", "done", "here", "here", "todo"],
    );
  });

  it("asks for the attributes before the D&I release (11 November 2026)", () => {
    // Understood, with a proposed attribute: D&I is a test of one against the attributes,
    // so its release waits for them, and the one next step is deciding them.
    const input = fresh({
      setup: understood,
      attributes: { approved: 4, proposed: 1 },
      plan: { exists: true, approved: false, pendingReview: false },
      requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
      designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
    });
    const steps = workflowOf(input);
    const evidence = steps.find((step) => step.key === "designevidence");
    assert.equal(evidence?.status, "Waiting on the attributes");
    assert.equal(evidence?.next, false);
    const next = nextStep(steps, input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    // The Attributes step is the one next step (11 November 2026), and Scope & Sampling
    // waits on it too.
    assert.deepEqual(
      next.actions.map((action) => [action.key, action.title]),
      [["attributes", "Decide the attributes"]],
    );
    assert.equal(
      steps.find((step) => step.key === "testdesign")?.status,
      "Waiting on the attributes",
    );
    assert.deepEqual(
      journey(steps).map((stage) => stage.state),
      ["done", "here", "todo", "todo", "todo"],
    );
  });

  // Old expectation: the D&I action was "Release the D&I evidence". New (product owner, 12
  // November 2026: "Why do I need to have the release button? Simplify the workflow."):
  // no release is offered; a ready phase is a settled requests list the server releases
  // itself ("Yes. I don't want a separate D&I release."), so the card asks nothing (the
  // earlier fallback titled it "Draft the D&I requests"). It then read "D&I Evidence is
  // being prepared", as if an agent were at work; now (review finding 4, 12 November 2026) it says
  // an agent works only where the records say one does: an accepted list with nothing
  // at work on it reads "Requests accepted" and waits. Requests still to accept are
  // named as that. Renamed from "offers the release and scope and sampling once the
  // attributes are settled".
  it("offers the D&I requests and scope and sampling once the attributes are settled", () => {
    const input = fresh({
      setup: understood,
      attributes: { approved: 5, proposed: 0 },
      plan: { exists: true, approved: false, pendingReview: false },
      requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
      designRelease: { step: "READY", waitingOn: "" },
    });
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.deepEqual(
      next.actions.map((action) => [action.key, action.title]),
      [
        ["designevidence", "Requests accepted"],
        ["testdesign", "Approve scope and sampling"],
      ],
    );
    const waiting = next.actions.find(
      (action) => action.key === "designevidence",
    );
    // It waits: the card only opens the step, and never says "Start".
    assert.match(waiting?.detail ?? "", /They are drafted next/);
    assert.equal(waiting?.label, "Open D&I Evidence");
    assert.equal(waiting?.flag, "Waiting");
    // The planner still at work on an accepted list: the agents', as the records say.
    const finishing = {
      ...input,
      designRequests: {
        tone: "active" as const,
        status: "Requests accepted",
        line: "Drafting starts when the planner finishes. Each request is approved before it goes to the organization.",
      },
      busy: new Set(["designevidence" as const]),
    };
    const prepared = nextStep(workflowOf(finishing), finishing, about);
    assert.equal(prepared.mode, "next");
    if (prepared.mode !== "next") {
      return;
    }
    const agent = prepared.actions.find(
      (action) => action.key === "designevidence",
    );
    assert.equal(agent?.kind, "agent");
    assert.equal(agent?.title, "D&I Evidence is being prepared");
    for (const action of next.actions) {
      assert.doesNotMatch(
        `${action.title} ${action.detail} ${action.label}`,
        /Draft the D&I requests|Release/,
      );
    }
    const toAccept = {
      ...input,
      designRelease: {
        step: "WAITING" as const,
        waitingOn: "REQUESTS" as const,
      },
      designRequests: { tone: "attention" as const, status: "2 to accept" },
    };
    const accepting = nextStep(workflowOf(toAccept), toAccept, about);
    assert.equal(accepting.mode, "next");
    if (accepting.mode !== "next") {
      return;
    }
    assert.deepEqual(
      accepting.actions.map((action) => [action.key, action.title]),
      [
        ["designevidence", "Accept the D&I requests"],
        ["testdesign", "Approve scope and sampling"],
      ],
    );
  });

  // Regression (independent review, 11 November 2026, H1): the card offered the attributes
  // while the D&I release card said the understanding was not complete (walkthrough
  // questions not answered). Both now name Control Understanding.
  it("names Control Understanding while the D&I release still waits on it", () => {
    const input = fresh({
      setup: understood,
      attributes: { approved: 5, proposed: 0 },
      designRelease: {
        step: "WAITING",
        waitingOn: "UNDERSTANDING",
        waitingFor:
          "Control Understanding is not complete: 4 walkthrough questions are not answered.",
      },
    });
    const next = nextStep(workflowOf(input), input, about);
    assert.equal(next.mode, "next");
    if (next.mode !== "next") {
      return;
    }
    assert.deepEqual(
      next.actions.map((each) => each.key),
      ["understanding"],
    );
  });
});
