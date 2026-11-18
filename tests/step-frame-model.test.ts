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
  nextLinks as namedNext,
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
    // Old: 11. New: 10, "D&I Conclusion and Review" being part of D&I Assessment
    // (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    assert.equal(others.length, 10);
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
    // Old: "Step 07" and "Step 12". New: one step fewer before them
    // (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    assert.equal(headLabel("testdesign"), "Step 06 · Human gate · OE branch");
    assert.equal(headLabel("workpaper"), "Step 11 · Output");
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
    // Old: the "designconclusion" step's decision. New: D&I Assessment's, which carries
    // the sign-off (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    assert.equal(
      quietLineOf(panelFrame("designassessment", steps, null).need),
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
    // Rewritten. Old: /D&I Conclusion/. New: the step that holds it is D&I Assessment,
    // where the sign-off is (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    assert.match(line.text, /D&I Assessment/);
    assert.equal(line.working, false);
    // Rewritten 15 November 2026. Old: "Open D&I Conclusion". New: "Open D&I Conclusion
    // and Review", the step's new title (product owner, 15 November 2026,
    // docs/design-workpaper.md section 3.5/3.6).
    // Rewritten again. Old: "Open D&I Conclusion and Review", step "designconclusion".
    // New: "Open D&I Assessment" (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
    assert.deepEqual(line.link, {
      label: "Open D&I Assessment",
      step: "designassessment",
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
    // Accepted, the planner still at work: one quiet working line and no action ("Yes. I
    // don't want a separate D&I release."). Said by the list's own line, so only while
    // the server says the planner is at work (review finding 4, 12 November 2026).
    const finishing = frame({
      tone: "active",
      status: "Requests accepted",
      line: "Drafting starts when the planner finishes. Each request is approved before it goes to the organization.",
    });
    assert.equal(finishing.line?.working, true);
    assert.match(
      finishing.line?.text ?? "",
      /^Drafting starts when the planner finishes\./,
    );
    // Accepted, nothing at work: the server's sentence, at rest, with nothing to open.
    const held = frame({
      tone: "idle",
      status: "Requests accepted",
      line: "The requests wait for a person who may accept them to accept the list.",
    });
    assert.deepEqual(held.line, {
      text: "The requests wait for a person who may accept them to accept the list.",
      working: false,
    });
    const settled = frame({ tone: "idle", status: "Requests accepted" });
    assert.deepEqual(settled.pill, {
      label: "Requests accepted",
      tone: "idle",
    });
    // No sentence from the server: plain words, at rest. Old expectation: the working
    // treatment and "Drafting starts when the planner finishes", whether or not the
    // planner was at work.
    assert.equal(settled.line?.working, false);
    assert.match(settled.line?.text ?? "", /They are drafted next/);
    assert.doesNotMatch(settled.line?.text ?? "", /planner/);
    assert.equal(settled.line?.link, undefined);
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
    // Rewritten 17 November 2026 (design review: "Next · D&I Assessment" pointed to a step
    // "Waiting on D&I evidence" that asks nothing). Old: each link was { key, label, title }.
    // New: it also carries the step's status, checked in the test below; the names and the
    // labels here are unchanged, so the status is set aside to compare them.
    const nextLinks = (next: Parameters<typeof namedNext>[0]) =>
      namedNext(next).map(({ key, label, title }) => ({ key, label, title }));
    assert.deepEqual(
      // Old: from "designconclusion". New: from D&I Assessment, whose verdict decides the
      // way on (product owner, 16 November 2026, docs/design-workpaper.md section 3.8).
      nextLinks(panelFrame("designassessment", steps, null).next),
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

  it("names each step that follows with the status its node shows, never a bare 'Next' (design review, 17 November 2026)", () => {
    const mixes = {
      midway: workflowOf(midway()),
      "nothing started": workflowOf(
        midway({
          attributes: { approved: 0, proposed: 0 },
          plan: { exists: false, approved: false, pendingReview: false },
          requirements: [],
          designPaper: null,
          designConclusion: null,
          designRelease: { step: "WAITING", waitingOn: "UNDERSTANDING" },
        }),
      ),
    };
    for (const [name, steps] of Object.entries(mixes)) {
      for (const step of steps) {
        for (const link of namedNext(panelFrame(step.key, steps, null).next)) {
          const shown = steps.find((each) => each.key === link.key);
          assert.ok(shown !== undefined, `${name}: ${link.key}`);
          // The footer says what the canvas node says, so a step that asks nothing reads so.
          assert.equal(link.status, shown.status, `${name}: ${link.key}`);
          assert.notEqual(link.status, "", `${name}: ${link.key}`);
        }
      }
    }
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
