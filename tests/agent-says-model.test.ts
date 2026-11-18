import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reviewForStep,
  sheetForStep,
} from "../apps/web/src/agent-says-model.ts";
import { parseJourney } from "../apps/web/src/control-journey-model.ts";
import type { ControlReview } from "../apps/web/src/review-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";

const journey = parseJourney({
  step: "TEST",
  step_phase: "INTERIM",
  action: "Decide the open test results",
  actor: "PREPARER",
  phases: [],
  blockers: [],
  reopened: "",
  stale_results: false,
  final: false,
  not_final_because: [],
  conflicts: [],
});

const cell = (
  index: number,
  proposed: "PASS" | "EXCEPTION" | "REVIEW",
  files: string[] = [],
  final: "PASS" | "EXCEPTION" | null = null,
) => ({
  index,
  proposed,
  note: "",
  final,
  overrideReason: "",
  overriddenBy: null,
  observed: "",
  expected: "",
  limitations: "",
  checks: [],
  citations: files.map((fileName) => ({
    fileId: "f",
    fileName,
    quote: "approved by",
    found: true,
    location: "",
    page: null,
    box: null,
    label: `A${index + 1}`,
  })),
});

const sheet = (over: Partial<TestSheet> = {}): TestSheet => ({
  id: "s1",
  controlId: "c1",
  controlRef: "ITGC-AC-01",
  testRoundId: null,
  roundKind: null,
  waitingNote: "",
  runNote: "",
  method: "SAMPLE",
  attributes: ["A request exists", "The request was approved"],
  status: "OPEN",
  running: false,
  runState: "IDLE",
  proposedConclusion: "NOT_EFFECTIVE",
  conclusion: null,
  signedBy: null,
  signedAt: null,
  signoffNote: "",
  items: [
    {
      id: "i1",
      position: 1,
      label: "u0001",
      detail: [],
      files: [],
      state: "TESTED",
      source: null,
      note: "",
      cells: [
        cell(0, "PASS", ["tickets.csv"]),
        cell(1, "PASS", ["tickets.csv"]),
      ],
      version: 1,
    },
    {
      id: "i2",
      position: 2,
      label: "u0002",
      detail: [],
      files: [],
      state: "TESTED",
      source: null,
      note: "",
      cells: [cell(0, "EXCEPTION", ["tickets.csv"]), cell(1, "REVIEW")],
      version: 1,
    },
  ],
  placements: [],
  counts: {
    items: 2,
    tested: 2,
    noEvidence: 0,
    exceptions: 1,
    unable: 0,
    review: 1,
    unplaced: 0,
  },
  blocking: [],
  proposal: null,
  proposalStatus: "NONE",
  proposalReason: "",
  deficiencyReference: null,
  version: 3,
  ...over,
});

describe("the agent block", () => {
  it("picks the round's sheet and review when the journey is at a round", () => {
    const control = sheet();
    const retest = sheet({
      id: "s2",
      testRoundId: "round-1",
    } as Partial<TestSheet>);
    const atRetest = parseJourney({
      step: "TEST",
      step_phase: "RETEST",
      phases: [],
      blockers: [],
      not_final_because: [],
      conflicts: [],
    });
    assert.equal(
      sheetForStep(
        [control, retest],
        [{ id: "round-1", kind: "RETEST", sheetId: "s2" }],
        atRetest,
      )?.id,
      "s2",
    );
    assert.equal(sheetForStep([control, retest], [], journey)?.id, "s1");
    const own = {
      id: "r1",
      testRoundId: null,
      roundKind: null,
    } as unknown as ControlReview;
    const round = {
      id: "r2",
      testRoundId: "round-1",
      roundKind: "RETEST",
    } as unknown as ControlReview;
    assert.equal(reviewForStep([own, round], atRetest)?.id, "r2");
    assert.equal(reviewForStep([own, round], journey)?.id, "r1");
    // No review of the control's own yet: a round's open review is the step's work.
    const openRound = {
      id: "r3",
      testRoundId: "round-2",
      roundKind: "ROLLFORWARD",
      status: "OPEN",
    } as unknown as ControlReview;
    assert.equal(reviewForStep([openRound], journey)?.id, "r3");
    assert.equal(reviewForStep([], journey), null);
  });
});
