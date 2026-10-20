import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blockersOf,
  completion,
  currentStep,
  needsYou,
  parseJourney,
  phaseItems,
  STEP_TABS,
  stepForTab,
  stepperItems,
} from "../apps/web/src/control-journey-model.ts";

const phase = (
  name: string,
  state: string,
  blockers: string[] = [],
  ready = false,
) => ({
  phase: name,
  label: name === "ROLLFORWARD" ? "Roll-forward operating effectiveness" : name,
  state,
  state_label: state.replace(/_/g, " ").toLowerCase(),
  ready_for_testing: ready,
  blockers,
  released_early: false,
});

const journey = (over: Record<string, unknown> = {}) =>
  parseJourney({
    step: "TEST",
    step_phase: "INTERIM",
    action: "Decide the open test results",
    actor: "PREPARER",
    phases: [
      phase("DESIGN", "SIGNED_OFF"),
      phase("INTERIM", "RESULTS_TO_CONFIRM"),
      phase("ROLLFORWARD", "PLANNED", ["Interim testing is not signed off."]),
    ],
    blockers: ["Roll-forward operating effectiveness: planned, not released"],
    reopened: "",
    stale_results: false,
    final: false,
    not_final_because: ["Interim testing not signed off"],
    conflicts: [],
    ...over,
  });

describe("the control's journey", () => {
  it("reads the API's journey and refuses what it cannot place", () => {
    const found = journey();
    assert.ok(found !== null);
    assert.equal(found.step, "TEST");
    assert.deepEqual(
      found.phases.map((item) => item.state),
      ["SIGNED_OFF", "RESULTS_TO_CONFIRM", "PLANNED"],
    );
    assert.equal(parseJourney({ step: "ELSEWHERE" }), null);
    assert.equal(parseJourney(null), null);
    // An unknown phase or state is left out rather than guessed.
    assert.equal(
      journey({ phases: [phase("MYSTERY", "TESTING")] })?.phases.length,
      0,
    );
  });

  it("marks the steps behind the journey's step done, never gating the rest", () => {
    assert.deepEqual(
      stepperItems(journey()).map((item) => `${item.step}:${item.status}`),
      [
        "PLAN:done",
        "REQUEST:done",
        "TEST:current",
        "CONCLUDE:upcoming",
        "REVIEW:upcoming",
      ],
    );
    const done = stepperItems(
      journey({ step: "DONE", step_phase: null, final: true }),
    );
    assert.ok(done.every((item) => item.status === "done"));
    assert.equal(done[4]?.note, "Final");
    const concluded = stepperItems(journey({ step: "DONE", step_phase: null }));
    assert.equal(concluded[4]?.note, "Concluded, not final");
    assert.equal(
      stepperItems(journey())[2]?.note,
      "INTERIM: results to confirm",
    );
    assert.ok(stepperItems(null).every((item) => item.status === "upcoming"));
  });

  it("opens the step a link asks for, else the journey's own, and Done opens Review", () => {
    assert.equal(currentStep(journey(), null), "TEST");
    assert.equal(currentStep(journey(), "plan"), "PLAN");
    assert.equal(currentStep(journey(), "nonsense"), "TEST");
    assert.equal(currentStep(journey({ step: "DONE" }), null), "REVIEW");
    assert.equal(currentStep(null, null), "REVIEW");
    assert.equal(STEP_TABS.PLAN, "design");
    assert.equal(stepForTab("testing"), "TEST");
    assert.equal(stepForTab("activity"), "REVIEW");
  });

  it("shows every applicable phase and lists what is outstanding with where it is resolved", () => {
    const found = journey({
      phases: [
        phase("DESIGN", "NOT_APPLICABLE"),
        phase("INTERIM", "RESULTS_TO_CONFIRM"),
        phase("ROLLFORWARD", "PLANNED", ["Interim testing is not signed off."]),
      ],
    });
    assert.deepEqual(
      phaseItems(found).map((item) => item.phase),
      ["INTERIM", "ROLLFORWARD"],
    );
    // Current work ("not signed off") is not a blocker; each cause appears once with the
    // phases it holds; the API's "planned, not released" line repeats that cause.
    assert.deepEqual(
      blockersOf(found).map((item) => [
        item.text,
        item.step,
        item.holdsConclusion,
      ]),
      [
        [
          "Interim testing is not signed off. (holds roll-forward)",
          "REQUEST",
          false,
        ],
      ],
    );
    const unapproved = blockersOf(
      journey({
        step: "PLAN",
        step_phase: null,
        phases: [
          phase("DESIGN", "AWAITING_PLAN", ["Approve the test plan"]),
          phase("INTERIM", "AWAITING_PLAN", ["Approve the test plan"]),
          phase("ROLLFORWARD", "AWAITING_PLAN", ["Approve the test plan"]),
        ],
        blockers: [],
        not_final_because: [
          "Test plan not approved at its current revision",
          "Interim testing outstanding",
          "Design and implementation testing outstanding",
          "Roll-forward testing outstanding",
        ],
      }),
    );
    // At Plan the unapproved plan is the action, not a blocker beside it.
    assert.deepEqual(
      unapproved.map((item) => item.text),
      ["Approve the test plan (holds design, interim, roll-forward)"],
    );
    const impact = blockersOf(
      journey({
        not_final_because: [
          "Test plan revised since the interim results were signed off: impact assessment pending a reviewer's decision",
          "Independent review of the roll-forward round outstanding",
        ],
      }),
    );
    assert.equal(impact[0]?.step, "PLAN");
    assert.equal(impact[1]?.step, "REVIEW");
    assert.deepEqual(blockersOf(null), []);
    // The API's own impact line repeats the not-final reason: one line, not two.
    const once = blockersOf(
      journey({
        blockers: [
          "The test plan changed after results were signed off: assess the impact before relying on them",
        ],
        not_final_because: [
          "Test plan revised since the interim results were signed off: impact assessment pending a reviewer's decision",
        ],
      }),
    );
    assert.equal(once.filter((item) => /impact/i.test(item.text)).length, 1);
  });

  it("keeps a step behind the journey's open while its work is in hand", () => {
    // The opinion is reached and the review is the step, but the retest round is still
    // testing: Test is working, not done, and says why.
    const items = stepperItems(
      journey({
        step: "REVIEW",
        step_phase: null,
        not_final_because: [
          "Independent review not signed off",
          "Retest testing in progress",
        ],
      }),
    );
    assert.equal(items[2]?.status, "working");
    assert.equal(items[2]?.note, "Retest testing in progress");
    assert.equal(items[3]?.status, "done");
    assert.equal(items[4]?.status, "current");
  });

  it("puts a reviewer's pending impact decision first", () => {
    const decide = needsYou({
      nextStep: "Log the proposed deficiency",
      actor: "PREPARER",
      yours: false,
      journey: journey({ step: "CONCLUDE", stale_results: true }),
      decideImpact: true,
    });
    assert.equal(decide.mine, true);
    assert.equal(decide.step, "PLAN");
    assert.match(decide.title, /signed-off results stand/);
    assert.match(decide.reason, /recommendation is advice/);
  });

  it("says who the next action waits on, and why the step is open", () => {
    const mine = needsYou({
      nextStep: "Decide the open test results",
      actor: "PREPARER",
      yours: true,
      journey: journey(),
    });
    assert.deepEqual(
      [mine.title, mine.who, mine.mine, mine.step],
      ["Decide the open test results", "You", true, "TEST"],
    );
    // At Test the action is the reason; nothing is repeated under it.
    assert.equal(mine.reason, "");
    const theirs = needsYou({
      nextStep: "Waiting for evidence",
      actor: "CLIENT",
      yours: false,
      journey: journey({ reopened: "Item 2 approval is missing" }),
    });
    assert.equal(theirs.who, "The control owner (client)");
    assert.equal(theirs.reason, "Testing reopened: Item 2 approval is missing");
    const stale = needsYou({
      nextStep: "Approve the test plan",
      actor: "PREPARER",
      yours: false,
      journey: journey({ stale_results: true }),
    });
    assert.match(stale.reason, /not relied on until a reviewer decides/);
    const held = needsYou({
      nextStep: "Independent review of the roll-forward round outstanding",
      actor: "REVIEWER",
      yours: false,
      journey: journey({
        step: "REVIEW",
        not_final_because: [
          "Independent review of the roll-forward round outstanding",
        ],
      }),
    });
    assert.equal(
      held.reason,
      "Independent review of the roll-forward round outstanding",
    );
  });

  it("keeps testing complete, review complete and final apart", () => {
    const tested = journey({
      phases: [phase("DESIGN", "SIGNED_OFF"), phase("INTERIM", "SIGNED_OFF")],
    });
    assert.deepEqual(completion(tested), {
      testing: true,
      review: false,
      final: false,
    });
    const reviewed = journey({
      step: "DONE",
      phases: [phase("DESIGN", "REVIEWED"), phase("INTERIM", "REVIEWED")],
      not_final_because: [
        "Plan revision the interim results were tested under is not recorded: impact assessment outstanding",
      ],
    });
    assert.deepEqual(completion(reviewed), {
      testing: true,
      review: true,
      final: false,
    });
    // Remediation is evidence of a fix, reviewed through the retest's review: it never
    // keeps the review open on its own.
    const remediated = journey({
      step: "DONE",
      final: true,
      phases: [
        phase("DESIGN", "REVIEWED"),
        phase("INTERIM", "REVIEWED"),
        phase("REMEDIATION", "SIGNED_OFF"),
        phase("RETEST", "REVIEWED"),
      ],
    });
    assert.deepEqual(completion(remediated), {
      testing: true,
      review: true,
      final: true,
    });
    assert.deepEqual(
      completion(
        journey({
          step: "DONE",
          final: true,
          phases: [phase("INTERIM", "REVIEWED")],
        }),
      ),
      {
        testing: true,
        review: true,
        final: true,
      },
    );
    assert.deepEqual(completion(null), {
      testing: false,
      review: false,
      final: false,
    });
  });
});
