import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  needsYou,
  parseJourney,
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
});
