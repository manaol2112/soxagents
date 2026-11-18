import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributesWorking,
  contextProblem,
} from "../apps/web/src/control-context-model.ts";
import {
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import { planningProblem } from "../apps/web/src/planning-model.ts";
import { panelFrame } from "../apps/web/src/step-panel-model.ts";

// Product owner, 14 November 2026: "if the attributes are still being updated, they should
// not be accepted. Second, when this specific window is showing up, D&I section says waiting
// on the attributes." The root cause: two rules for "being updated". The D&I release held
// the attributes for any narrative run; the Attributes step's run state only for one at its
// attribute stage, so a redraft from the latest answers showed "Being updated" over a
// "Decide the attributes" bar and accept buttons that worked. Now one rule, the release's.

function input(overrides: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    details: [{ label: "Owner", filled: true }],
    setup: [
      { key: "answers", done: true, optional: false, mine: false, summary: "" },
    ],
    attributes: { approved: 4, proposed: 0 },
    plan: { exists: true, approved: false, pendingReview: false },
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
  } as WorkflowInput;
}

describe("attributes the agents are updating", () => {
  it("the Attributes step says the agents are at work, never to decide", () => {
    const steps = workflowOf(
      input({
        designRelease: {
          step: "WAITING",
          waitingOn: "ATTRIBUTES",
          waitingFor:
            "The attributes are not settled: the agent is still updating them.",
        },
      }),
    );
    const step = steps.find((item) => item.key === "attributes");
    assert.equal(step?.status, "Being updated");
    const frame = panelFrame("attributes", steps, null);
    assert.equal(frame.need.kind, "agent");
    assert.equal(frame.need.title, "Being updated");
    assert.equal(frame.need.action, undefined);
    assert.doesNotMatch(frame.need.detail, /decide what the agent proposed/);
  });

  it("once settled, the step is done, not a call to decide", () => {
    const steps = workflowOf(input());
    assert.notEqual(panelFrame("attributes", steps, null).need.kind, "agent");
  });

  it("a redraft of the understanding reads as the agents at work on the attributes", () => {
    assert.equal(
      attributesWorking("WORKING", "UNDERSTANDING"),
      "Updating from the latest answers to the understanding",
    );
  });

  it("a decision the server refuses meanwhile says why, and that nothing was accepted", () => {
    const said =
      "The agents are updating the attributes from the latest answers. Nothing was accepted; decide once they finish.";
    assert.equal(contextProblem(409, "the attributes are being updated"), said);
    assert.equal(
      planningProblem(409, "the attributes are being updated"),
      said,
    );
  });
});
