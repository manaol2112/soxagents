import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Deficiency } from "../apps/web/src/engagement-model.ts";
import {
  controlStepHref,
  remediationHistory,
} from "../apps/web/src/remediation-model.ts";
import type { ControlReview } from "../apps/web/src/review-model.ts";
import type { TestRound } from "../apps/web/src/round-model.ts";
import type { TestSheet } from "../apps/web/src/sheet-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";

const deficiency: Deficiency = {
  id: "d1",
  reference: "D-001",
  controlId: CONTROL,
  controlRef: "NS-AC-02",
  controlLabel: "NS-AC-02 · SAP S/4HANA",
  title: "Late access termination",
  condition: "Two leavers kept access past three business days.",
  criteria: "Access removed within three business days.",
  cause: "HR feed delay.",
  effect: "Unauthorised access possible.",
  type: "OPERATING",
  likelihood: "REASONABLY_POSSIBLE",
  magnitude: "MORE_THAN_INCONSEQUENTIAL",
  severity: "SIGNIFICANT_DEFICIENCY",
  suggestedSeverity: "SIGNIFICANT_DEFICIENCY",
  compensating: "",
  status: "CLOSED",
  remediationOwner: "Priya Natarajan",
  remediationPlan: "Automate the leaver feed and add a daily reconciliation.",
  remediationDue: "2027-10-31",
  retestResult: "PASSED",
  retestedAt: "2027-12-10",
  remediatedOn: "2027-10-18",
  source: "TESTING",
  pending: null,
  identifiedBy: "Morgan Lee",
  identifiedAt: "2027-10-02T10:00:00Z",
  closedAt: "2027-12-14T09:00:00Z",
  version: 7,
  canDecide: false,
};

const sheet = (
  id: string,
  conclusion: "EFFECTIVE" | "NOT_EFFECTIVE",
  exceptions: number,
): TestSheet =>
  ({
    id,
    controlId: CONTROL,
    controlRef: "NS-AC-02",
    method: "SAMPLE",
    attributes: ["a"],
    status: "SIGNED_OFF",
    running: false,
    runState: "IDLE",
    runNote: "",
    proposedConclusion: conclusion,
    conclusion,
    signedBy: "Morgan Lee",
    signedAt:
      conclusion === "EFFECTIVE"
        ? "2027-12-10T12:00:00Z"
        : "2027-10-01T12:00:00Z",
    signoffNote: "",
    items: [],
    placements: [],
    counts: {
      items: 25,
      tested: 25,
      noEvidence: 0,
      exceptions,
      unable: 0,
      review: 0,
      unplaced: 0,
    },
    blocking: [],
    proposal: null,
    proposalStatus: "NONE",
  }) as unknown as TestSheet;

const round: TestRound = {
  id: "r1",
  controlId: CONTROL,
  controlRef: "NS-AC-02",
  kind: "RETEST",
  number: 1,
  status: "SIGNED_OFF",
  method: "SAMPLE",
  windowStart: "2027-10-18",
  windowEnd: "2027-12-15",
  testFrom: "2027-10-18",
  sampleSize: 25,
  deficiencyId: "d1",
  deficiencyReference: "D-001",
  requestId: "q1",
  requestStatus: "RECEIVED",
  testId: null,
  sheetId: "s-retest",
  conclusion: "EFFECTIVE",
  cancelReason: "",
  basis: null,
  version: 1,
};

const review = (testRoundId: string | null): ControlReview =>
  ({
    id: `rev-${testRoundId ?? "interim"}`,
    controlId: CONTROL,
    controlRef: "NS-AC-02",
    label: "",
    testRoundId,
    status: "SIGNED_OFF",
    reperforming: false,
    reperformState: "IDLE",
    reperformedAt: null,
    reperformSource: "SEEDED",
    reperformNote: "",
    sheetStatus: "SIGNED_OFF",
    sheetSignedBy: "Morgan Lee",
    sheetVersion: 1,
    sheetVersionReviewed: 1,
    workpapers: [],
    notes: [],
    counts: {},
    blocking: [],
    viewerIsReviewer: false,
    viewerPrepared: false,
    independenceRequired: true,
    signedBy: "Riley Okafor",
  }) as unknown as ControlReview;

describe("a deficiency's remediation history", () => {
  it("reads every step from the records and keeps the original failure", () => {
    const history = remediationHistory(
      deficiency,
      {
        sheets: [
          sheet("s-interim", "NOT_EFFECTIVE", 2),
          sheet("s-retest", "EFFECTIVE", 0),
        ],
        rounds: [round],
        reviews: [review(null), review("r1")],
      },
      { organizationId: ORG, projectId: PROJECT },
    );
    assert.deepEqual(
      history.steps.map((step) => [step.key, step.state]),
      [
        ["failed", "failed"],
        ["logged", "done"],
        ["response", "done"],
        ["remediated", "done"],
        ["evidence", "done"],
        ["retested", "done"],
        ["reviewed", "done"],
        ["closed", "done"],
      ],
    );
    assert.match(history.steps[0]?.detail ?? "", /2 of 25 items/);
    assert.match(history.steps[3]?.detail ?? "", /2027-10-18/);
    assert.match(
      history.steps[5]?.detail ?? "",
      /Retest 1 concluded effective/,
    );
    assert.match(history.steps[7]?.detail ?? "", /2027-12-14/);
    assert.equal(history.original?.result, "NOT_EFFECTIVE");
    assert.equal(history.original?.exceptions, 2);
    assert.equal(history.original?.reviewed, true);
    assert.equal(history.retest?.result, "EFFECTIVE");
    assert.equal(history.retest?.label, "Retest 1");
    assert.equal(history.retest?.reviewed, true);
    assert.match(history.steps[0]?.href ?? "", /step=test/);
  });

  it("shows what is still to come for an open deficiency, inferring nothing", () => {
    const open: Deficiency = {
      ...deficiency,
      status: "REMEDIATION_IN_PROGRESS",
      remediatedOn: null,
      retestResult: "NOT_STARTED",
      retestedAt: null,
      closedAt: null,
      pending: null,
    };
    const history = remediationHistory(
      open,
      {
        sheets: [sheet("s-interim", "NOT_EFFECTIVE", 1)],
        rounds: [],
        reviews: [],
      },
      { organizationId: ORG, projectId: PROJECT },
    );
    assert.deepEqual(
      history.steps.map((step) => step.state),
      [
        "failed",
        "done",
        "done",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
      ],
    );
    assert.equal(history.retest, null);
    assert.equal(history.original?.reviewed, false);
    // A pending closure names the reviewer's decision.
    const asked = remediationHistory(
      {
        ...open,
        pending: {
          kind: "CLOSE",
          severity: null,
          reason: "Fixed",
          requestedAt: "",
        },
      },
      { sheets: null, rounds: null, reviews: null },
      { organizationId: ORG, projectId: PROJECT },
    );
    assert.match(asked.steps[7]?.detail ?? "", /reviewer decides/);
    assert.match(asked.steps[0]?.detail ?? "", /No interim test sheet/);
  });

  it("links to the control's steps only when there is a control", () => {
    assert.match(
      controlStepHref(ORG, PROJECT, CONTROL, "review") ?? "",
      /step=review/,
    );
    assert.equal(controlStepHref(ORG, PROJECT, null, "test"), null);
  });
});
