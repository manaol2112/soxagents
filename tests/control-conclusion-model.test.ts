import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conclusionNoticeFor,
  parseControlConclusion,
  rateWrite,
  ratingState,
} from "../apps/web/src/control-conclusion-model.ts";

const ORG = "01900000-0000-7000-8000-000000000001";
const PROJECT = "01900000-0000-7000-8000-000000000002";
const CONTROL = "01900000-0000-7000-8000-000000000003";
const DEFICIENCY = "01900000-0000-7000-8000-000000000004";

// The API's body for a control whose interim testing found an exception (B3).
function body(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    control_id: CONTROL,
    status: "PROPOSED",
    proposed: "NOT_EFFECTIVE",
    reasons: [
      "The D&I conclusion is signed off as effective.",
      "Interim testing found exceptions.",
    ],
    waiting: [],
    design: "EFFECTIVE",
    phases: [
      {
        phase: "INTERIM",
        label: "Interim testing",
        state: "SIGNED_OFF",
        conclusion: "NOT_EFFECTIVE",
        retested: false,
      },
      {
        phase: "ROLLFORWARD",
        label: "Roll-forward testing",
        state: "NOT_APPLICABLE",
        conclusion: null,
      },
    ],
    deficiencies: [
      {
        id: DEFICIENCY,
        reference: "D-001",
        title: "Access granted without approval",
        type: "OPERATING",
        status: "OPEN",
        severity: "CONTROL_DEFICIENCY",
        likelihood: "REASONABLY_POSSIBLE",
        magnitude: "MORE_THAN_INCONSEQUENTIAL",
        suggested_severity: "SIGNIFICANT_DEFICIENCY",
        suggestion_reason:
          "A reasonably possible likelihood reads as a significant deficiency.",
        pending_severity: null,
        rated: false,
        rating: null,
        version: 3,
      },
    ],
    to_rate: 1,
    review: null,
    final: null,
    viewer_can_rate: true,
    ...overrides,
  };
}

describe("the control's conclusion", () => {
  it("reads the API's body", () => {
    const parsed = parseControlConclusion(body());
    assert.ok(parsed !== null);
    assert.equal(parsed.proposed, "NOT_EFFECTIVE");
    assert.equal(parsed.phases.length, 2);
    assert.equal(parsed.deficiencies[0]?.suggested, "SIGNIFICANT_DEFICIENCY");
    assert.equal(parsed.toRate, 1);
    assert.equal(parsed.canRate, true);
  });

  it("drops what is not a conclusion, and never reads an unknown verdict as effective", () => {
    assert.equal(parseControlConclusion(null), null);
    assert.equal(parseControlConclusion(body({ status: "DONE" })), null);
    const odd = parseControlConclusion(body({ proposed: "MAYBE" }));
    assert.equal(odd?.proposed, null);
    const unknown = parseControlConclusion(
      body({
        deficiencies: [
          {
            ...(body().deficiencies as Array<Record<string, unknown>>)[0],
            severity: "MINOR",
          },
        ],
      }),
    );
    assert.deepEqual(unknown?.deficiencies, []);
  });

  it("says where each rating stands", () => {
    const parsed = parseControlConclusion(body());
    assert.ok(parsed !== null);
    const item = parsed.deficiencies[0];
    assert.ok(item !== undefined);
    assert.deepEqual(ratingState(item), {
      tone: "attention",
      label: "To rate",
    });
    assert.equal(
      ratingState({ ...item, pending: "SIGNIFICANT_DEFICIENCY", rated: true })
        .label,
      "Significant deficiency: awaiting the reviewer",
    );
    assert.equal(
      ratingState({ ...item, rated: true }).label,
      "Rated Control deficiency",
    );
  });

  it("builds a rating, and nothing else", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
      deficiency_id: DEFICIENCY,
    };
    assert.deepEqual(
      rateWrite({
        ...ids,
        severity: "SIGNIFICANT_DEFICIENCY",
        version: "3",
        rationale: " Affects financial reporting access. ",
      }),
      {
        path: `/organizations/${ORG}/projects/${PROJECT}/control-conclusions/${CONTROL}/deficiencies/${DEFICIENCY}/rate`,
        body: {
          severity: "SIGNIFICANT_DEFICIENCY",
          version: 3,
          rationale: "Affects financial reporting access.",
        },
        controlId: CONTROL,
      },
    );
    for (const fields of [
      { ...ids, severity: "MINOR", version: "3", rationale: "x".repeat(20) },
      {
        ...ids,
        severity: "CONTROL_DEFICIENCY",
        version: "0",
        rationale: "x".repeat(20),
      },
      {
        ...ids,
        severity: "CONTROL_DEFICIENCY",
        version: "3",
        rationale: "Too short",
      },
      {
        ...ids,
        severity: "CONTROL_DEFICIENCY",
        version: "3",
        rationale: "password: hunter2 is in the note",
      },
      {
        ...ids,
        deficiency_id: "../x",
        severity: "CONTROL_DEFICIENCY",
        version: "3",
        rationale: "x".repeat(20),
      },
    ]) {
      assert.deepEqual(rateWrite(fields), { error: "invalid" });
    }
  });

  it("shows success only once the API confirms it", () => {
    assert.equal(conclusionNoticeFor(200, false), "cc-rated");
    assert.equal(conclusionNoticeFor(200, true), "cc-review");
    assert.equal(conclusionNoticeFor(409, false), "cc-blocked");
    assert.equal(conclusionNoticeFor(402, false), "cc-trial-ended");
    assert.equal(conclusionNoticeFor(422, false), "cc-invalid");
    assert.equal(conclusionNoticeFor(0, false), "cc-unavailable");
  });
});
