import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KIND_LABELS,
  STEPS,
  TONE_LABELS,
  type WorkflowInput,
  workflowOf,
} from "../apps/web/src/control-workflow-model.ts";
import {
  basedOnSummary,
  headLabel,
  nextLinks,
  panelHeadOf,
  quietLineOf,
  statusPill,
  takesMinimalLayout,
} from "../apps/web/src/step-frame-model.ts";
import { panelFrame } from "../apps/web/src/step-panel-model.ts";

// A control midway: understood, attributes approved, the D&I conclusion to sign.
function midway(overrides: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    details: [
      { label: "Description", filled: true },
      { label: "Objective", filled: true },
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

describe("the step drawer's header (11 November 2026)", () => {
  it("keeps Control Understanding's own layout, and gives every other step the new one", () => {
    assert.equal(takesMinimalLayout("understanding"), false);
    const others = STEPS.filter((step) => step.key !== "understanding");
    assert.equal(others.length, 11);
    for (const step of others) {
      assert.equal(takesMinimalLayout(step.key), true, step.key);
    }
  });

  it("reads the step back from the drawer's kicker, as the workspace writes it", () => {
    STEPS.forEach((step, at) => {
      const kicker = `${String(at + 1).padStart(2, "0")} · ${KIND_LABELS[step.kind]}`;
      const head = panelHeadOf(kicker);
      assert.ok(head !== null, kicker);
      assert.equal(head.key, step.key);
      assert.equal(head.number, at + 1);
      assert.equal(head.kind, step.kind);
    });
    // Control Understanding is found, so the drawer can keep its own header.
    assert.equal(panelHeadOf("02 · AI agent")?.key, "understanding");
    // The activity is no step; a kicker whose kind disagrees is not trusted.
    assert.equal(panelHeadOf("Record"), null);
    assert.equal(panelHeadOf("03 · AI agent"), null);
    assert.equal(panelHeadOf("13 · Output"), null);
  });

  it("names the step's number and kind, and its branch where it has one", () => {
    assert.equal(headLabel("attributes"), "Step 03 · Human gate");
    assert.equal(headLabel("setup"), "Step 01 · Source");
    assert.equal(
      headLabel("designevidence"),
      "Step 04 · AI agent · D&I branch",
    );
    assert.equal(headLabel("testdesign"), "Step 07 · Human gate · OE branch");
    assert.equal(headLabel("workpaper"), "Step 12 · Output");
  });

  it("shows one status: the step's own words, or its tone's where it has none", () => {
    assert.deepEqual(statusPill("done", "Understood"), {
      label: "Understood",
      tone: "done",
    });
    // The setup's own header left the status empty: the pill still names a state.
    assert.deepEqual(statusPill("attention", " "), {
      label: TONE_LABELS.attention,
      tone: "attention",
    });
  });
});

describe("what the panel says where nothing is needed from the person", () => {
  it("leaves a decision or a flag to the decision row", () => {
    const steps = workflowOf(midway());
    assert.equal(
      quietLineOf(panelFrame("designconclusion", steps, null).need),
      null,
    );
    assert.equal(quietLineOf(panelFrame("oeevidence", steps, null).need), null);
  });

  it("says nothing is needed on a done step, never its status again", () => {
    const steps = workflowOf(midway());
    const need = panelFrame("attributes", steps, null).need;
    assert.equal(need.kind, "done");
    assert.deepEqual(quietLineOf(need), {
      text: "Nothing is needed from you here.",
      working: false,
    });
  });

  it("gives a waiting step's reason with the step to open", () => {
    const steps = workflowOf(
      midway({ requirements: [{ phase: "DESIGN", state: "ACCEPTED" }] }),
    );
    const line = quietLineOf(panelFrame("review", steps, null).need);
    assert.ok(line !== null);
    assert.match(line.text, /D&I Conclusion/);
    assert.equal(line.working, false);
    assert.deepEqual(line.link, {
      label: "Open D&I Conclusion",
      step: "designconclusion",
    });
  });

  it("marks the agent at work for the reading treatment", () => {
    const steps = workflowOf(midway({ busy: new Set(["designassessment"]) }));
    const line = quietLineOf(panelFrame("designassessment", steps, null).need);
    assert.ok(line !== null);
    assert.equal(line.working, true);
    assert.match(line.text, /The agent is preparing this step/);
  });

  // The D&I requests list (product owner, 12 November 2026): the step's pill and its one
  // line come from the list's state, not from a release card.
  it("takes D&I Evidence's pill and line from its requests list", () => {
    const frame = (
      designRequests: NonNullable<WorkflowInput["designRequests"]>,
    ) => {
      const steps = workflowOf(
        midway({
          requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
          designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
          designRequests,
        }),
      );
      const step = steps.find((item) => item.key === "designevidence");
      assert.ok(step !== undefined);
      return {
        pill: statusPill(step.tone, step.status),
        line: quietLineOf(panelFrame("designevidence", steps, null).need),
      };
    };
    // Requests to accept, or an attribute no request addresses: the decision row's.
    const toAccept = frame({ tone: "attention", status: "2 to accept" });
    assert.deepEqual(toAccept.pill, {
      label: "2 to accept",
      tone: "attention",
    });
    assert.equal(toAccept.line, null);
    const uncovered = frame({
      tone: "attention",
      status: "Attribute D is not addressed",
    });
    assert.equal(uncovered.pill.label, "Attribute D is not addressed");
    assert.equal(uncovered.line, null);
    // The planner at work: one quiet line, with the reading treatment.
    const planning = frame({ tone: "active", status: "Being updated" });
    assert.deepEqual(planning.pill, { label: "Being updated", tone: "active" });
    assert.equal(planning.line?.working, true);
    assert.match(
      planning.line?.text ?? "",
      /planner is preparing the requests/,
    );
    // Accepted, and being drafted: one quiet line, never the status again.
    const drafting = frame({ tone: "active", status: "Requests accepted" });
    assert.deepEqual(drafting.pill, {
      label: "Requests accepted",
      tone: "active",
    });
    assert.equal(drafting.line?.working, true);
    assert.match(drafting.line?.text ?? "", /^Drafting the requests\./);
  });
});

describe("the panel's footer", () => {
  it("names the first step it rests on with its status, and counts the others", () => {
    const steps = workflowOf(midway());
    const based = basedOnSummary(panelFrame("attributes", steps, null).basedOn);
    assert.ok(based !== null);
    assert.equal(based.first.key, "understanding");
    // By title alone: the header and canvas carry the numbers (12 November 2026).
    assert.equal(based.label, "Control Understanding · Understood");
    assert.deepEqual(based.more, []);
    // The conclusion rests on both branches: the first, and the rest as a count.
    const conclusion = basedOnSummary(
      panelFrame("conclusion", steps, null).basedOn,
    );
    assert.ok(conclusion !== null);
    assert.ok(conclusion.more.length >= 1);
    // The setup rests on nothing.
    assert.equal(
      basedOnSummary(panelFrame("setup", steps, null).basedOn),
      null,
    );
  });

  it("names each step that follows, with the outcome it follows on", () => {
    const steps = workflowOf(midway());
    assert.deepEqual(
      nextLinks(panelFrame("designconclusion", steps, null).next),
      [
        { key: "oeevidence", label: "If effective", title: "OE Evidence" },
        {
          key: "conclusion",
          label: "If not effective",
          title: "Control Conclusion",
        },
      ],
    );
    // The attributes lead into both branches at once: each link says its branch, and no
    // step number reads as a jump ("Next · 04", "Next · 07"; product owner, 12 November 2026).
    assert.deepEqual(nextLinks(panelFrame("attributes", steps, null).next), [
      { key: "designevidence", label: "D&I branch", title: "D&I Evidence" },
      { key: "testdesign", label: "OE branch", title: "Scope & Sampling" },
    ]);
    for (const key of ["setup", "understanding", "attributes"] as const) {
      for (const link of nextLinks(panelFrame(key, steps, null).next)) {
        assert.doesNotMatch(link.title, /^\d/);
      }
    }
    assert.deepEqual(
      nextLinks(panelFrame("setup", steps, null).next).map(
        (item) => item.label,
      ),
      ["Next"],
    );
    assert.deepEqual(nextLinks(panelFrame("workpaper", steps, null).next), []);
  });
});

describe("the drawer's step comes from its key (11 November 2026)", () => {
  it("names the step from its key, and nothing for the activity or an unknown key", async () => {
    const { panelHeadFor } = await import(
      "../apps/web/src/step-frame-model.ts"
    );
    assert.equal(panelHeadFor("attributes")?.number, 3);
    assert.equal(panelHeadFor("attributes")?.kind, "gate");
    assert.equal(panelHeadFor("designevidence")?.number, 4);
    assert.equal(panelHeadFor(null), null);
    assert.equal(panelHeadFor("activity"), null);
    assert.equal(panelHeadFor("nope"), null);
  });
});
