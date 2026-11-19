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
    // Rewritten 17 November 2026 (owner's shadcn/ui decision and design audit). Old:
    // "Being prepared". New: "Agent working", the one short word for an agent at work
    // across the step panel, the next step card and the workflow's flag.
    assert.equal(next.actions[0]?.flag, "Agent working");
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

// Product owner, 17 November 2026 ("make sure that things like this will never show up in my
// app"): while the planner draws up the test plan, no card asks a person to approve it.
describe("the next-step card while the planner drafts the test plan", () => {
  it("says the agent is at work on Scope & Sampling, never Approve", () => {
    const input = fresh({
      setup: understood,
      attributes: { approved: 5, proposed: 0 },
      plan: {
        exists: false,
        approved: false,
        pendingReview: false,
        drafting: true,
      },
    });
    const steps = workflowOf(input);
    assert.equal(
      steps.find((step) => step.key === "testdesign")?.status,
      "Plan being drafted",
    );
    const next = nextStep(steps, input, about);
    assert.equal(next.mode, "next");
    const scope =
      next.mode === "next"
        ? next.actions.find((each) => each.key === "testdesign")
        : undefined;
    assert.ok(scope !== undefined);
    assert.equal(scope.kind, "agent");
    assert.equal(scope.flag, "Agent working");
    assert.doesNotMatch(scope.title, /^Approve/);
  });
});

describe("the next step while the review waits on a person's choice", () => {
  it("offers that choice, never 'Start: Control Understanding'", () => {
    // Re-shoot r9, 19 November 2026 (H1, H2, F1): the card's title and line were the
    // review's, but its action still read "Start: Control Understanding".
    const choice =
      "The review is held on attribute B: run it again, or proceed without it and record the reason.";
    for (const questionPass of ["HELD", "FAILED"] as const) {
      const input = fresh({
        setup: understood,
        understanding: { completedAt: null, questionPass, choice },
      });
      const next = nextStep(workflowOf(input), input, about);
      assert.equal(next.mode, "next");
      if (next.mode !== "next") {
        return;
      }
      const [action] = next.actions;
      assert.ok(action !== undefined);
      assert.equal(action.key, "understanding");
      assert.equal(action.detail, choice);
      assert.equal(action.label, "Run again or proceed");
      assert.equal(action.anchor, "ur-review-choice");
      assert.doesNotMatch(action.label, /^Start:/);
    }
  });
});

describe("the next step's card", () => {
  it("opens the place its action names, and the review's choice carries that place", async () => {
    const { readFileSync } = await import("node:fs");
    const card = readFileSync(
      new URL("../apps/web/src/next-step.tsx", import.meta.url),
      "utf8",
    );
    assert.match(card, /`\$\{hrefs\[action\.key\]\}#\$\{action\.anchor\}`/);
    const failed = readFileSync(
      new URL("../apps/web/src/understanding-specialist.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      failed,
      /className="ur-end ur-review-failed"\s*id=\{REVIEW_CHOICE_ANCHOR\}/,
    );
  });
});

describe("the next step when the review can only proceed", () => {
  it("offers the end card's own action", async () => {
    // Re-shoot r10, 19 November 2026 (H2): after two reads the end card offers only
    // Proceed, and the next step said "Run again or proceed".
    const words = await import(
      "../apps/web/src/understanding-specialist-model.ts"
    );
    assert.equal(words.runsAgain(null), true);
    assert.equal(words.runsAgain({ runAgain: false }), false);
    assert.equal(words.reviewChoiceAction(false), "Proceed without it");
    assert.equal(words.reviewChoiceAction(false), words.PROCEED_WITHOUT);
    assert.equal(words.reviewChoiceAction(true), "Run again or proceed");
    const input = fresh({
      setup: understood,
      understanding: {
        completedAt: null,
        questionPass: "HELD",
        choice:
          "The review is held on attribute B. It has run twice and cannot run again: proceed without it and record the reason.",
        choiceAction: words.reviewChoiceAction(false),
      },
    });
    const next = nextStep(workflowOf(input), input, about);
    assert.ok(next.mode === "next");
    assert.equal(next.actions[0]?.label, "Proceed without it");
  });

  it("lands on the end card's first useful control, its actions in view", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), "utf8");
    const panel = read("control-workflow.tsx");
    // Rewritten (re-shoot r11, 19 November 2026: in the browser the end card renders about a
    // second after the panel opens, so a check on open found nothing and focus stayed on the
    // title). Old: one check as the panel opened. New: the title first, then the panel
    // watches until the place renders (watchArrival), and focuses its marked control while
    // focus is still on the title, the link just clicked, or nowhere. Rewritten again (the
    // same day): also with the panel already open, on a link to a place on the page or a
    // change of the address's place.
    assert.match(
      panel,
      /useEffect\(\(\) => \{\s*heading\.current\?\.focus\(\);[\s\S]{0,400}start\(window\.location\.hash\.slice\(1\), null\);/,
    );
    assert.match(panel, /window\.addEventListener\("hashchange", onHash\);/);
    assert.match(panel, /document\.addEventListener\("click", onClick\);/);
    assert.match(
      panel,
      /if \(to\.hash\.length > 1 && to\.pathname === window\.location\.pathname\) \{\s*start\(decodeURIComponent\(to\.hash\.slice\(1\)\), link\);/,
    );
    assert.match(panel, /watchArrival\(id, root, \[heading\.current, from\]\)/);
    assert.match(
      panel,
      /if \(at === null \|\| at === document\.body \|\| from\.includes\(at\)\) \{\s*control\.focus\(\{ preventScroll: true \}\);/,
    );
    assert.match(
      panel,
      /querySelector\("\[data-arrive-view\]"\) \?\? place\)\.scrollIntoView\(\{\s*block: "end",/,
    );
    assert.match(
      panel,
      /const timer = window\.setTimeout\(\(\) => stop\(\), ARRIVE_MS\);/,
    );
    // One scroll owner: the router does not scroll to the place.
    const nextCard = read("next-step.tsx");
    assert.match(nextCard, /scroll=\{false\}/);
    const css = readFileSync(
      new URL("../apps/web/app/control-setup.css", import.meta.url),
      "utf8",
    );
    assert.match(
      css,
      /\.ur-review-failed \[data-arrive-view\] \{\s*scroll-margin-bottom: 24px;/,
    );
    const card = read("understanding-specialist.tsx");
    // The reason box when proceeding needs one; else Run again; else Proceed.
    assert.match(
      card,
      /value=\{reason\}\s*disabled=\{sending !== null \|\| done\}\s*data-arrive=""/,
    );
    assert.match(
      card,
      /data-arrive=\{!asksReason && !runAgain \? "" : undefined\}/,
    );
    assert.match(card, /data-arrive=\{asksReason \? undefined : ""\}/);
    assert.match(card, /<div className="ur-foot-actions" data-arrive-view="">/);
    assert.match(card, /const runAgain = runsAgain\(held\);/);
    assert.match(
      read("controls-view.tsx"),
      /choiceAction: reviewChoiceAction\(\s*runsAgain\(/,
    );
  });
});
