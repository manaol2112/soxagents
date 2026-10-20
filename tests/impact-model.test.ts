import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adviceWords,
  impactFor,
  impactProblem,
  impactWrite,
  parseImpact,
  resultsWords,
  revisionWords,
} from "../apps/web/src/impact-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a155ff-992f-7342-bc45-127332b008f4";
const ASSESSMENT = "01a12990-0000-7000-8000-000000000001";

const raw = (over: Record<string, unknown> = {}) => ({
  id: ASSESSMENT,
  control_id: "01a12985-c94d-73f6-8007-7d6130692f22",
  control_ref: "ITGC-AC-01",
  test_sheet_id: "01a12990-0000-7000-8000-000000000010",
  test_round_id: null,
  round_kind: null,
  signoff_id: "01a12990-0000-7000-8000-000000000011",
  signed_by: "Dana Preparer",
  signed_at: "2026-10-12T04:39:26Z",
  conclusion: "NOT_EFFECTIVE",
  from_revision: 1,
  to_revision: 2,
  status: "PENDING",
  recommendation: {
    decision: "VALID",
    rationale:
      "Revision 2 changes only another testing phase's procedures or decision (1 item); nothing the interim results rest on changed.",
    changes: [
      {
        section: "PHASE",
        code: "ROLLFORWARD",
        change: "CHANGED",
        detail: "applicability changed",
      },
    ],
    by: "RULES",
  },
  decided_by: null,
  decided_at: null,
  rationale: "",
  viewer_can_decide: true,
  version: 1,
  ...over,
});

describe("plan-revision impact assessments", () => {
  it("reads the API's assessments and keeps the control's, pending first", () => {
    const parsed = parseImpact([
      raw({
        status: "VALID",
        id: "01a12990-0000-7000-8000-000000000002",
        signed_at: "2026-10-13T00:00:00Z",
      }),
      raw(),
      raw({ control_id: "01a12985-0000-7000-8000-000000000099" }),
    ]);
    assert.ok(parsed !== null);
    const mine = impactFor(parsed, "01a12985-c94d-73f6-8007-7d6130692f22");
    assert.deepEqual(
      mine.map((item) => item.status),
      ["PENDING", "VALID"],
    );
    assert.equal(mine[0]?.recommendation.decision, "VALID");
    assert.equal(mine[0]?.recommendation.changes[0]?.code, "ROLLFORWARD");
    assert.equal(parseImpact("no"), null);
    assert.deepEqual(parseImpact([{ id: 1 }]), []);
  });

  it("says what was tested, the revision gap, and the agent's advice as advice", () => {
    const [item] = parseImpact([raw()]) ?? [];
    assert.ok(item);
    assert.equal(
      resultsWords(item),
      "Interim testing signed off not effective by Dana Preparer",
    );
    assert.equal(
      revisionWords(item),
      "tested under revision 1; the plan is now at revision 2",
    );
    assert.equal(
      adviceWords(item).headline,
      "The agent recommends that the results stand (VALID)",
    );
    const [unknown] =
      parseImpact([
        raw({
          from_revision: null,
          recommendation: { decision: null, rationale: "cannot be compared" },
        }),
      ]) ?? [];
    assert.ok(unknown);
    assert.match(revisionWords(unknown), /not recorded/);
    assert.equal(
      adviceWords(unknown).headline,
      "The agent has no recommendation",
    );
    const [round] =
      parseImpact([
        raw({ round_kind: "ROLLFORWARD", conclusion: "EFFECTIVE" }),
      ]) ?? [];
    assert.equal(
      resultsWords(round as NonNullable<typeof round>),
      "Roll-forward signed off effective by Dana Preparer",
    );
  });

  it("checks a decision before it leaves the browser and reads the API's refusal", () => {
    const good = impactWrite({
      organization_id: ORG,
      project_id: PROJECT,
      assessment_id: ASSESSMENT,
      version: 1,
      decision: "REPERFORM",
      rationale: "The attributes changed.",
    });
    assert.ok(!("error" in good));
    assert.equal(
      good.path,
      `/organizations/${ORG}/projects/${PROJECT}/impact/${ASSESSMENT}/decide`,
    );
    assert.deepEqual(good.body, {
      version: 1,
      decision: "REPERFORM",
      rationale: "The attributes changed.",
    });
    for (const bad of [
      { decision: "MAYBE" },
      { rationale: "ok" },
      { rationale: "password: hunter2 is in here" },
      { version: 0 },
      { assessment_id: "nope" },
    ]) {
      assert.deepEqual(
        impactWrite({
          organization_id: ORG,
          project_id: PROJECT,
          assessment_id: ASSESSMENT,
          version: 1,
          decision: "VALID",
          rationale: "Wording only.",
          ...bad,
        }),
        { error: "invalid" },
      );
    }
    assert.equal(impactProblem(200, ""), null);
    assert.equal(
      impactProblem(409, "you signed off this testing"),
      "You signed off this testing. Reload to see what is on record.",
    );
    assert.match(impactProblem(409, "") ?? "", /^The assessment changed\./);
    assert.match(impactProblem(403, "") ?? "", /reviewer decides/);
  });
});
