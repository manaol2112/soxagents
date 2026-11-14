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

  // Old expectation (B1): a ready phase asked the person to "Release the D&I evidence",
  // with a "Review and release" action. New (product owner, 12 November 2026: "Why do I
  // need to have the release button? Simplify the workflow."): the panel asks for what its
  // requests list needs, in the list's words, and never for a release. A ready phase is a
  // settled list, which the server releases itself ("Yes. I don't want a separate D&I
  // release."): the panel only says it waits; the earlier fallback, an act titled "Draft
  // the D&I requests", is gone. It then said "Drafting starts when the planner finishes"
  // for every settled list; now (review finding 4, 12 November 2026) the planner is named
  // only where the list's own line says it is at work, and otherwise the step waits in
  // the server's sentence or in plain words. Renamed from "asks for the D&I release when
  // the evidence waits for it (B1)".
  it("asks for what the D&I requests list needs, never for a release", () => {
    const steps = workflowOf(
      midway({
        requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
        designRelease: { step: "READY" },
      }),
    );
    const frame = panelFrame("designevidence", steps, null);
    assert.equal(frame.need.kind, "wait");
    assert.equal(frame.need.title, "Requests accepted");
    assert.match(frame.need.detail, /They are drafted next/);
    assert.doesNotMatch(frame.need.detail, /planner/);
    // Kept: each drafted request is still approved before it goes out.
    assert.match(
      frame.need.detail,
      /approved before it goes to the organization/,
    );
    // The list's own line is the step's, where it has one.
    const said = (line: string, tone: "active" | "idle") =>
      panelFrame(
        "designevidence",
        workflowOf(
          midway({
            requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
            designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
            designRequests: { tone, status: "Requests accepted", line },
          }),
        ),
        null,
      ).need;
    const held = said(
      "The requests wait for a person who may accept them to accept the list.",
      "idle",
    );
    assert.equal(held.kind, "wait");
    assert.equal(
      held.detail,
      "The requests wait for a person who may accept them to accept the list.",
    );
    assert.equal(held.action, undefined);
    const finishing = said(
      "Drafting starts when the planner finishes. Each request is approved before it goes to the organization.",
      "active",
    );
    assert.equal(finishing.kind, "agent");
    assert.match(
      finishing.detail,
      /^Drafting starts when the planner finishes\./,
    );
    // Nothing is asked: no action, and no draft or release in its words.
    assert.equal(frame.need.action, undefined);
    assert.doesNotMatch(
      `${frame.need.title} ${frame.need.detail}`,
      /Draft the D&I requests|release/i,
    );
    // Requests the agent proposed: the panel asks a person to accept them.
    const toAccept = panelFrame(
      "designevidence",
      workflowOf(
        midway({
          requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
          designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
          designRequests: { tone: "attention", status: "2 to accept" },
        }),
      ),
      null,
    );
    assert.equal(toAccept.need.kind, "act");
    assert.equal(toAccept.need.title, "Accept the D&I requests");
    assert.match(toAccept.need.detail, /approved before it is sent/);
    assert.doesNotMatch(
      `${toAccept.need.title} ${toAccept.need.detail}`,
      /release/i,
    );
    // An approved attribute no request addresses is the step's one exception.
    const uncovered = panelFrame(
      "designevidence",
      workflowOf(
        midway({
          requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
          designRelease: { step: "WAITING", waitingOn: "EVIDENCE" },
          designRequests: {
            tone: "attention",
            status: "Attribute D is not addressed",
          },
        }),
      ),
      null,
    );
    assert.equal(uncovered.need.kind, "act");
    assert.equal(uncovered.need.title, "Attribute D is not addressed");
    assert.match(uncovered.need.detail, /record why/);
    // The planner at work, and the requests being drafted: the agent's, in one line.
    const drafting = panelFrame(
      "designevidence",
      workflowOf(
        midway({
          requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
          designRelease: { step: "RELEASED" },
          designRequests: { tone: "active", status: "Requests accepted" },
        }),
      ),
      null,
    );
    assert.equal(drafting.need.kind, "agent");
    assert.match(drafting.need.detail, /^Drafting the requests\./);
    // Nothing is drafted yet, so the agent's line does not say it drafted them.
    const beingDrafted = midway({
      requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
      designRelease: { step: "RELEASED" },
      designRequests: { tone: "active", status: "Requests accepted" },
    });
    const draftingStep = workflowOf(beingDrafted).find(
      (step) => step.key === "designevidence",
    );
    assert.ok(draftingStep !== undefined);
    assert.match(agentNote(draftingStep, beingDrafted).did, /^Planned the D&I/);
    const planning = panelFrame(
      "designevidence",
      workflowOf(
        midway({
          designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
          designRequests: { tone: "active", status: "Being planned" },
        }),
      ),
      null,
    );
    assert.equal(planning.need.kind, "agent");
    // Once drafted, the step asks for its evidence decisions, as before.
    const drafted = panelFrame(
      "designevidence",
      workflowOf(
        midway({
          requirements: [{ phase: "DESIGN", state: "RECEIVED" }],
          designRelease: { step: "RELEASED" },
        }),
      ),
      null,
    );
    assert.equal(drafted.need.title, "Decide the D&I evidence");
    // Before its requests are drafted nothing is requested, so the agent's note says so,
    // not "0 accepted". Old wording: "2 evidence items planned, requested once released."
    // New: they are drafted once the list is accepted; no release is waited for.
    const input = midway({
      requirements: [
        { phase: "DESIGN", state: "NOT_GENERATED" },
        { phase: "DESIGN", state: "NOT_GENERATED" },
      ],
      designRelease: { step: "READY" },
    });
    const evidence = workflowOf(input).find(
      (step) => step.key === "designevidence",
    );
    assert.ok(evidence !== undefined);
    assert.deepEqual(agentNote(evidence, input).found, [
      "2 requests planned, drafted once the list is accepted.",
    ]);
  });

  it("waits on the attributes before the D&I release, and points to them (11 November 2026)", () => {
    const steps = workflowOf(
      midway({
        attributes: { approved: 4, proposed: 1 },
        requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
        designRelease: { step: "WAITING", waitingOn: "ATTRIBUTES" },
      }),
    );
    const frame = panelFrame("designevidence", steps, null);
    assert.equal(frame.need.kind, "wait");
    assert.equal(frame.need.title, "Waiting on the attributes");
    assert.deepEqual(frame.need.action, {
      label: "Open Attributes",
      step: "attributes",
    });
    // The Attributes step asks a person to decide them; D&I Evidence is based on it.
    const attributes = panelFrame("attributes", steps, null);
    assert.equal(attributes.need.kind, "act");
    assert.equal(attributes.need.title, "Decide the attributes");
    assert.deepEqual(
      frame.basedOn.map((item) => item.key),
      ["attributes"],
    );
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

describe("Scope & Sampling holds one primary action (11 November 2026)", () => {
  it("says what is needed without a second button: the plan review approves", async () => {
    const { workflowOf } = await import(
      "../apps/web/src/control-workflow-model.ts"
    );
    const steps = workflowOf(
      midway({
        attributes: { approved: 5, proposed: 0 },
        plan: { exists: true, approved: false, pendingReview: true },
      }),
    );
    const frame = panelFrame("testdesign", steps, null);
    assert.equal(frame.need.kind, "act");
    assert.equal(frame.need.action, undefined);
  });
});

describe("D&I Evidence once its requests are drafted (12 November 2026)", () => {
  // Product owner, 12 November 2026: "This view is again so heavy and a lot of duplicates
  // labels and purpose. Just simplify this". Old expectation: a released D&I phase asked
  // the person to "Decide the D&I evidence", with a "Review evidence" button that jumped
  // to the work under it, and the agent's strip counted items ("2 evidence items planned,
  // 1 accepted."). New, where the step's evidence list is read: the list's own decision
  // line with no button in it (the list holds Approve and send; each row its Upload and
  // Accept), and the agent's line for the state the rows are in. Where the list is not
  // read, the old wording still stands (asserted above: "Decide the D&I evidence").
  const header: NonNullable<WorkflowInput["designEvidence"]> = {
    tone: "attention",
    status: "1 file to review",
    need: {
      kind: "act",
      title: "Review 1 file.",
      detail:
        "The agent read it and proposes: sufficient. Nothing is accepted until you accept it.",
    },
    agent: {
      did: "Read 1 file: 1 sufficient.",
      found: ["2 requests against 2 approved attributes."],
    },
  };

  it("takes the list's decision line, with no button in it", () => {
    const input = midway({
      designRelease: { step: "RELEASED" },
      designEvidence: header,
    });
    const steps = workflowOf(input);
    const frame = panelFrame("designevidence", steps, null);
    assert.equal(frame.need.action, undefined);
    assert.deepEqual(frame.need, header.need);
    const step = steps.find((item) => item.key === "designevidence");
    assert.ok(step !== undefined);
    assert.equal(step.status, "1 file to review");
    assert.equal(step.tone, "attention");
    assert.deepEqual(agentNote(step, input), header.agent);
  });

  it("is quiet while the owner has the requests, and when all is accepted", () => {
    const waiting = workflowOf(
      midway({
        designRelease: { step: "RELEASED" },
        designEvidence: {
          tone: "active",
          status: "2 with the owner",
          need: {
            kind: "wait",
            title: "With the owner",
            detail:
              "With Maria Keller since Nov 12, 2026, due Nov 26, 2026. Upload what you receive on its row.",
          },
          agent: { did: "Reads each file as it arrives.", found: [] },
        },
      }),
    );
    const need = panelFrame("designevidence", waiting, null).need;
    assert.equal(need.kind, "wait");
    assert.equal(need.action, undefined);
    assert.match(need.detail, /^With Maria Keller since/);
    const done = workflowOf(
      midway({
        designRelease: { step: "COMPLETE" },
        designEvidence: {
          tone: "done",
          status: "2 of 2 accepted",
          need: { kind: "done", title: "2 of 2 accepted", detail: "" },
          agent: {
            did: "Read 2 files; all accepted by a person.",
            found: [],
          },
        },
      }),
    );
    assert.equal(panelFrame("designevidence", done, null).need.kind, "done");
  });

  it("keeps the requests list's own words until the requests are drafted", () => {
    // The phase is not released: the evidence list's header is not the step's yet.
    const input = midway({
      requirements: [{ phase: "DESIGN", state: "NOT_GENERATED" }],
      designRelease: { step: "WAITING", waitingOn: "REQUESTS" },
      designEvidence: header,
    });
    const steps = workflowOf(input);
    const step = steps.find((item) => item.key === "designevidence");
    assert.ok(step !== undefined);
    assert.equal(step.need, undefined);
    assert.notEqual(step.status, "1 file to review");
    assert.notDeepEqual(agentNote(step, input), header.agent);
  });
});
