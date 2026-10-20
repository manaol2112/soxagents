import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ControlRow } from "../apps/web/src/engagement-model.ts";
import { NO_AUTOMATION } from "../apps/web/src/execution-model.ts";
import { parseQueue } from "../apps/web/src/queue-model.ts";
import type { ControlReview } from "../apps/web/src/review-model.ts";
import type { TestRound } from "../apps/web/src/round-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";
import {
  controlStepHref,
  filterResults,
  filterReviews,
  nextWords,
  parseResultFilter,
  parseTestingView,
  resultCounts,
  resultRows,
  reviewRows,
  testingCounts,
  testingHref,
} from "../apps/web/src/testing-hub-model.ts";

const ORG = "org-1";
const PROJECT = "proj-1";

const control = (over: Partial<ControlRow> = {}): ControlRow =>
  ({
    id: "c1",
    controlRef: "ITGC-AC-01",
    title: "User access provisioning",
    label: "ITGC-AC-01 · SAP ERP",
    applicationName: "SAP ERP",
    included: true,
    conclusion: "NOT_CONCLUDED",
    final: false,
    nextStep: "Test the evidence",
    actor: "AGENT",
    yours: false,
    readinessState: "READY",
    readinessLabel: "",
    testStatus: null,
    sheetStatus: null,
    journey: null,
    ...over,
  }) as ControlRow;

const sheet = (over: Partial<TestSheet> = {}): TestSheet =>
  ({
    id: "s1",
    controlId: "c1",
    controlRef: "ITGC-AC-01",
    method: "SAMPLE",
    attributes: ["a", "b"],
    status: "OPEN",
    running: false,
    runState: "IDLE",
    runNote: "",
    proposedConclusion: "INCOMPLETE",
    conclusion: null,
    signedBy: null,
    signedAt: null,
    signoffNote: "",
    items: [],
    placements: [],
    counts: {
      items: 3,
      tested: 3,
      noEvidence: 0,
      exceptions: 0,
      unable: 0,
      review: 0,
      unplaced: 0,
    },
    blocking: [],
    proposal: null,
    proposalStatus: "NONE",
    ...over,
  }) as TestSheet;

const round = (over: Partial<TestRound> = {}): TestRound =>
  ({
    id: "r1",
    controlId: "c1",
    controlRef: "ITGC-AC-01",
    kind: "RETEST",
    number: 1,
    status: "REQUESTED",
    method: "SAMPLE",
    windowStart: "2026-09-01",
    windowEnd: "2026-12-31",
    testFrom: "2026-11-01",
    sampleSize: 3,
    deficiencyId: "d1",
    deficiencyReference: "D-001",
    requestId: null,
    requestStatus: null,
    testId: null,
    sheetId: null,
    conclusion: null,
    cancelReason: "",
    basis: null,
    version: 1,
    ...over,
  }) as TestRound;

const review = (over: Partial<ControlReview> = {}): ControlReview =>
  ({
    id: "rv1",
    controlId: "c1",
    controlRef: "ITGC-AC-01",
    label: "ITGC-AC-01 · SAP ERP",
    testRoundId: null,
    roundKind: null,
    status: "OPEN",
    reperforming: false,
    reperformState: "IDLE",
    reperformedAt: "2026-10-19T10:00:00Z",
    reperformSource: "RULES",
    reperformNote: "",
    sheetStatus: "SIGNED_OFF",
    sheetSignedBy: "Dana Whitfield",
    sheetVersion: 2,
    sheetVersionReviewed: 2,
    workpapers: [],
    notes: [],
    counts: {},
    blocking: [],
    viewerIsReviewer: false,
    viewerPrepared: false,
    independenceRequired: true,
    signedBy: null,
    signedAt: null,
    signoffNote: "",
    version: 1,
    ...over,
  }) as ControlReview;

describe("the Testing destination", () => {
  it("names its views and addresses, and opens the guided workspace", () => {
    assert.equal(parseTestingView("review"), "review");
    assert.equal(parseTestingView("elsewhere"), "plans");
    assert.equal(parseTestingView(null), "plans");
    assert.equal(
      testingHref(ORG, PROJECT, "plans"),
      "/?organization=org-1&project=proj-1&section=testing",
    );
    assert.equal(
      testingHref(ORG, PROJECT, "results", { filter: "mine" }),
      "/?organization=org-1&project=proj-1&section=testing&view=results&filter=mine",
    );
    assert.equal(
      controlStepHref(ORG, PROJECT, "c1", "test"),
      "/?organization=org-1&project=proj-1&section=controls&control=c1&step=test",
    );
    assert.equal(parseResultFilter("signed"), "signed");
    assert.equal(parseResultFilter("x"), "all");
  });

  it("reads each control's testing from its sheet, round and register row", () => {
    const rows = resultRows({
      controls: [
        control(),
        control({
          id: "c2",
          controlRef: "ITGC-AC-02",
          label: "ITGC-AC-02 · SAP ERP",
          nextStep: "Decide the open test results",
          actor: "PREPARER",
          yours: true,
        }),
        control({
          id: "c3",
          controlRef: "ITGC-CM-01",
          label: "ITGC-CM-01 · SAP ERP",
          conclusion: "EXCEPTION",
          final: false,
          nextStep: "Finish the retest testing and sign it off",
          actor: "PREPARER",
          yours: true,
          journey: {
            step: "TEST",
            stepPhase: "RETEST",
            action: "",
            actor: "PREPARER",
            phases: [],
            blockers: [],
            reopened: "",
            staleResults: false,
            final: false,
            notFinalBecause: ["Retest outstanding"],
          },
        }),
        control({ id: "c4", controlRef: "OUT", included: false }),
        control({
          id: "c5",
          controlRef: "ITGC-PD-01",
          label: "ITGC-PD-01 · SAP ERP",
          readinessState: "PLAN_NOT_APPROVED",
          readinessLabel: "Test plan not approved",
          nextStep: "Approve the test plan",
          actor: "PREPARER",
          yours: true,
        }),
      ],
      sheets: [
        sheet({ running: true, runState: "QUEUED" }),
        sheet({
          id: "s2",
          controlId: "c2",
          counts: {
            items: 3,
            tested: 3,
            noEvidence: 0,
            exceptions: 1,
            unable: 0,
            review: 1,
            unplaced: 0,
          },
        }),
        sheet({
          id: "s3",
          controlId: "c3",
          status: "SIGNED_OFF",
          conclusion: "NOT_EFFECTIVE",
          counts: {
            items: 3,
            tested: 3,
            noEvidence: 0,
            exceptions: 1,
            unable: 0,
            review: 0,
            unplaced: 0,
          },
        }),
      ],
      rounds: [round({ controlId: "c3", status: "TESTING", sheetId: "s3b" })],
      automation: NO_AUTOMATION,
      organizationId: ORG,
      projectId: PROJECT,
    });
    assert.deepEqual(
      rows.map((row) => [row.controlRef, row.state, row.stateLabel, row.phase]),
      [
        // Queued for the tester, no worker: said as such, never "running".
        [
          "ITGC-AC-01",
          "TESTING",
          "Run queued · automation unavailable",
          "INTERIM",
        ],
        ["ITGC-AC-02", "TO_DECIDE", "1 result to decide", "INTERIM"],
        // The open retest round names the phase; its own sheet is not loaded, so the
        // control's latest sheet stands in.
        ["ITGC-CM-01", "SIGNED_OFF", "Signed off · not effective", "RETEST"],
        ["ITGC-PD-01", "BLOCKED", "Test plan not approved", "INTERIM"],
      ],
    );
    assert.equal(rows[1]?.exceptions, 1);
    assert.equal(rows[2]?.result, "EXCEPTION");
    assert.equal(
      rows[2]?.href,
      "/?organization=org-1&project=proj-1&section=controls&control=c3&step=test",
    );
    assert.equal(
      nextWords({ actor: "AGENT", yours: false }),
      "Waits on an agent",
    );
    assert.equal(nextWords({ actor: "PREPARER", yours: true }), "Yours");
    const counts = resultCounts(rows);
    assert.equal(counts.all, 4);
    assert.equal(counts.testing, 1);
    assert.equal(counts.decide, 1);
    assert.equal(counts.signed, 1);
    assert.equal(counts.exceptions, 2);
    assert.equal(counts.mine, 3);
    assert.deepEqual(
      filterResults(rows, "all", "pd-01").map((row) => row.controlRef),
      ["ITGC-PD-01"],
    );
  });

  it("lists the reviews with the queue's own action on each", () => {
    const queue = parseQueue({
      items: [
        {
          id: "review:rv1",
          kind: "review",
          obligation: "CONTROL_REVIEW",
          source: { type: "control_review", id: "rv1" },
          stage: "REVIEW",
          control_id: "c1",
          control_ref: "ITGC-AC-01",
          phase: "INTERIM",
          title: "Decide 2 reviewer notes on ITGC-AC-01 · SAP ERP",
          reason: "Proposed by the reviewer agent.",
          owner: { role: "REVIEWER", names: [] },
          authorized: true,
          ready: true,
          blockers: [],
          blocks: false,
          bucket: "MINE",
          link: {
            section: "controls",
            query: { control: "c1", step: "review" },
          },
        },
        {
          id: "coverage:rv2",
          kind: "coverage",
          obligation: "COVERAGE_ASSESSMENT",
          source: { type: "control_review", id: "rv2" },
          stage: "REVIEW",
          control_id: "c2",
          control_ref: "ITGC-AC-02",
          phase: "INTERIM",
          title: "Assess whether the signed-off review covers the current work",
          reason: "The design workpaper changed since the review covered it.",
          owner: { role: "REVIEWER", names: [] },
          authorized: false,
          ready: true,
          blockers: [],
          blocks: true,
          bucket: "WAITING",
          link: {
            section: "controls",
            query: { control: "c2", step: "review" },
          },
        },
      ],
      counts: {},
      generated_at: "",
    });
    const rows = reviewRows({
      reviews: [
        review({
          id: "rv2",
          controlId: "c2",
          controlRef: "ITGC-AC-02",
          label: "ITGC-AC-02 · SAP ERP",
          status: "SIGNED_OFF",
          signedBy: "Priya Natarajan",
          signedAt: "2026-10-18T09:00:00Z",
        }),
        review({
          id: "rv3",
          controlId: "c3",
          controlRef: "ITGC-CM-01",
          label: "ITGC-CM-01 · SAP ERP",
          roundKind: "RETEST",
          testRoundId: "r1",
          reperforming: true,
          reperformState: "QUEUED",
        }),
        review({
          notes: [
            { status: "PROPOSED" } as ControlReview["notes"][number],
            { status: "PROPOSED" } as ControlReview["notes"][number],
            { status: "CLEARED" } as ControlReview["notes"][number],
          ],
        }),
      ],
      queue,
      organizationId: ORG,
      projectId: PROJECT,
    });
    // Open reviews first, the viewer's own leading; signed-off last.
    assert.deepEqual(
      rows.map((row) => [row.controlRef, row.stage, row.next, row.owner]),
      [
        [
          "ITGC-AC-01",
          "2 proposed to decide",
          "Decide 2 reviewer notes on ITGC-AC-01 · SAP ERP",
          "Yours",
        ],
        ["ITGC-CM-01", "Re-performance queued", "", ""],
        [
          "ITGC-AC-02",
          "Signed off",
          "Assess whether the signed-off review covers the current work",
          "Waits on the independent reviewer",
        ],
      ],
    );
    assert.equal(rows[0]?.openNotes, 2);
    assert.equal(rows[1]?.round, "RETEST");
    assert.equal(rows[2]?.signedBy, "Priya Natarajan");
    // "Open" keeps the signed-off review whose coverage is still to assess.
    assert.deepEqual(
      filterReviews(rows, "open").map((row) => row.controlRef),
      ["ITGC-AC-01", "ITGC-CM-01", "ITGC-AC-02"],
    );
    assert.deepEqual(
      filterReviews(rows, "mine").map((row) => row.controlRef),
      ["ITGC-AC-01"],
    );
    assert.deepEqual(
      filterReviews(rows, "signed").map((row) => row.controlRef),
      ["ITGC-AC-02"],
    );
    assert.deepEqual(testingCounts({ results: [], reviews: rows }), {
      results: 0,
      review: 3,
    });
  });
});
