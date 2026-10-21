import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentInput,
  agentSays,
  reviewForStep,
  sheetForStep,
} from "../apps/web/src/agent-says-model.ts";
import { parseJourney } from "../apps/web/src/control-journey-model.ts";
import { parseImpact } from "../apps/web/src/impact-model.ts";
import type { ControlReview } from "../apps/web/src/review-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";

const hrefs = {
  PLAN: "/plan",
  REQUEST: "/request",
  TEST: "/test",
  CONCLUDE: "/conclude",
  REVIEW: "/review",
} as const;

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

const base = (over: Partial<AgentInput> = {}): AgentInput => ({
  step: "TEST",
  journey,
  controlRef: "ITGC-AC-01",
  sheet: sheet(),
  review: null,
  impact: [],
  plan: null,
  activity: [],
  deficiencies: [],
  hrefs,
  automation: null,
  ...over,
});

describe("the agent block", () => {
  it("states what was tested, proposes a conclusion as a proposal and names the pending decision", () => {
    const says = agentSays(base());
    assert.match(
      says.did[0] ?? "",
      /^Tested 2 of 2 samples against 2 attributes, citing 3 passages in 1 evidence file/,
    );
    assert.equal(says.recommends, "Proposes a conclusion of not effective");
    assert.match(
      says.because,
      /1 exception, 0 with insufficient evidence, 1 needing a person's review/,
    );
    assert.deepEqual(
      says.supports.map((ref) => ref.label),
      ["Attribute A1: exception", "tickets.csv"],
    );
    assert.match(says.decision ?? "", /^1 result needs a person's decision/);
    assert.equal(says.insufficient, null);
  });

  it("offers to cancel a queued or running run and shows a pending cancellation", () => {
    // Milestone 3a: the execution line names the job a person may cancel; once asked,
    // it says the tester stops at its next check; an idle sheet offers nothing.
    const running = agentSays(
      base({ sheet: sheet({ running: true, runState: "RUNNING" }) }),
    );
    assert.deepEqual(running.execution?.cancel, {
      kind: "test-sheet",
      id: "s1",
    });
    const requested = agentSays(
      base({
        sheet: sheet({
          running: true,
          runState: "RUNNING",
          cancelState: "REQUESTED",
        }),
      }),
    );
    assert.match(requested.execution?.detail ?? "", /Cancellation requested/);
    const idle = agentSays(base());
    assert.equal(idle.execution?.cancel, undefined);
  });

  it("says when there is no basis instead of recommending", () => {
    const none = agentSays(base({ sheet: null }));
    assert.equal(none.recommends, null);
    assert.match(none.insufficient ?? "", /No test sheet yet/);
    const untested = agentSays(
      base({
        sheet: sheet({
          items: [],
          counts: {
            items: 3,
            tested: 0,
            noEvidence: 3,
            exceptions: 0,
            unable: 0,
            review: 0,
            unplaced: 0,
          },
        }),
      }),
    );
    assert.equal(untested.recommends, null);
    assert.match(untested.insufficient ?? "", /No results yet/);
    // Results that cite nothing are flagged as unsupported, not hidden.
    const uncited = agentSays(
      base({
        sheet: sheet({
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
              cells: [cell(0, "PASS"), cell(1, "PASS")],
              version: 1,
            },
          ],
          counts: {
            items: 1,
            tested: 1,
            noEvidence: 0,
            exceptions: 0,
            unable: 0,
            review: 0,
            unplaced: 0,
          },
          proposedConclusion: "EFFECTIVE",
        }),
      }),
    );
    assert.match(uncited.insufficient ?? "", /cite no evidence passages/);
  });

  it("never presents signed-off testing as the agent's doing", () => {
    const signed = agentSays(
      base({
        sheet: sheet({
          status: "SIGNED_OFF",
          conclusion: "NOT_EFFECTIVE",
          signedBy: "Dana Whitfield",
          signedAt: "2026-10-20T04:50:00Z",
        }),
      }),
    );
    assert.equal(signed.recommends, null);
    assert.ok(
      signed.did.some((line) =>
        /A person signed the testing off \(Dana Whitfield\)/.test(line),
      ),
    );
    assert.equal(signed.decision, null);
  });

  it("at Plan, carries the impact recommendation as advice and the reviewer's decision", () => {
    const impact = parseImpact([
      {
        id: "a1",
        control_id: "c1",
        test_sheet_id: "s1",
        status: "PENDING",
        from_revision: 1,
        to_revision: 2,
        signed_by: "Dana Whitfield",
        signed_at: "2026-10-20T04:50:00Z",
        conclusion: "NOT_EFFECTIVE",
        recommendation: {
          decision: "VALID",
          rationale: "Revision 2 changes only the roll-forward procedures.",
          changes: [
            {
              section: "PHASE",
              code: "ROLLFORWARD",
              change: "CHANGED",
              detail: "",
            },
          ],
        },
        viewer_can_decide: true,
        version: 1,
      },
    ]);
    const says = agentSays(base({ step: "PLAN", impact: impact ?? [] }));
    assert.match(
      says.did[0] ?? "",
      /Compared plan revision 1 with revision 2 item by item: 1 change found/,
    );
    assert.equal(
      says.recommends,
      "Proposes that the signed-off results stand under the revised plan (VALID)",
    );
    assert.equal(
      says.because,
      "Revision 2 changes only the roll-forward procedures.",
    );
    assert.ok(
      says.supports.some((ref) => ref.label === "phase ROLLFORWARD changed"),
    );
    assert.match(
      says.decision ?? "",
      /Your decision as the independent reviewer/,
    );
    // No recommendation from the agent: said as such, with its reason.
    const judgement = parseImpact([
      {
        id: "a2",
        control_id: "c1",
        test_sheet_id: "s1",
        status: "PENDING",
        from_revision: null,
        to_revision: 3,
        recommendation: {
          decision: null,
          rationale: "The change is a matter of judgement.",
          changes: [],
        },
        viewer_can_decide: false,
        version: 1,
      },
    ]);
    const none = agentSays(base({ step: "PLAN", impact: judgement ?? [] }));
    assert.equal(none.recommends, null);
    assert.equal(
      none.insufficient,
      "No recommendation: The change is a matter of judgement.",
    );
    assert.match(none.decision ?? "", /The independent reviewer decides/);
  });

  it("at Review, reports the re-performance and the proposed notes as proposals", () => {
    const review = {
      id: "r1",
      controlId: "c1",
      controlRef: "ITGC-AC-01",
      label: "ITGC-AC-01",
      testRoundId: null,
      roundKind: null,
      status: "OPEN",
      reperforming: false,
      reperformState: "IDLE",
      reperformedAt: "2026-10-20T04:55:00Z",
      reperformSource: "RULES",
      reperformNote: "",
      sheetStatus: "SIGNED_OFF",
      sheetSignedBy: "Dana Whitfield",
      sheetVersion: 3,
      sheetVersionReviewed: 3,
      workpapers: [],
      notes: [
        {
          id: "n1",
          number: 1,
          targetKind: "SAMPLE",
          itemId: "i2",
          indexes: [0],
          workpaperId: null,
          reviewerResult: null,
          citations: [
            {
              fileId: "f",
              fileName: "tickets.csv",
              quote: "q",
              found: true,
              location: "",
              page: null,
            },
          ],
          text: "The sheet tests 2 items; the standard sample is 25.",
          severity: "MUST_FIX",
          status: "PROPOSED",
          raisedBy: "AGENT",
          raisedByName: null,
          raisedAt: "2026-10-20T04:55:00Z",
          decidedByName: null,
          decisionReason: "",
          response: "",
          respondedByName: null,
          respondedAt: null,
          clearedByName: null,
          clearedAt: null,
        },
      ],
      counts: {},
      blocking: [],
      viewerIsReviewer: true,
      viewerPrepared: false,
      independenceRequired: true,
      signedBy: null,
      signedAt: null,
      signoffNote: "",
      version: 2,
    } as unknown as ControlReview;
    const says = agentSays(base({ step: "REVIEW", review }));
    assert.match(
      says.did[0] ?? "",
      /^Re-performed the testing from the evidence \(rules only\).*raised 1 review note/,
    );
    assert.equal(says.recommends, "Proposes 1 review note (1 must fix)");
    assert.match(says.because, /^#1: The sheet tests 2 items/);
    assert.deepEqual(
      says.supports.map((ref) => ref.label),
      ["Note #1 on A1, citing tickets.csv"],
    );
    assert.match(
      says.decision ?? "",
      /^You accept or dismiss each note and sign the review off; the agent cannot sign/,
    );
    const absent = agentSays(base({ step: "REVIEW", review: null }));
    assert.match(absent.insufficient ?? "", /No independent review has opened/);
  });

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
