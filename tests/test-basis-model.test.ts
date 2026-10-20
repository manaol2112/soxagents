import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  basisLine,
  basisProblem,
  basisWrite,
  parseTestBasis,
  standardNote,
} from "../apps/web/src/test-basis-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";

function body(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    control_id: CONTROL,
    source: "UPLOAD",
    basis: "CLIENT",
    decided: false,
    decided_by: null,
    decided_at: null,
    note: "",
    standard: null,
    client_procedures_stated: false,
    client_procedures: [
      "The control operated as described in the control activity.",
    ],
    run: null,
    candidates: [],
    can_decide: true,
    model_available: false,
    ...fields,
  };
}

describe("a control's test basis", () => {
  it("reads the default, the decision, the standard, and the candidates", () => {
    const basis = parseTestBasis(
      body({
        basis: "STANDARD",
        decided: true,
        decided_by: "Dana",
        decided_at: "2026-10-18T00:00:00Z",
        standard: {
          library_key: "access-termination",
          control_ref: "ITGC-AC-02",
          title: "Leavers lose access promptly",
          library_status: "PENDING_REVIEW",
        },
        run: {
          decided_by: "MODEL",
          note: "",
          no_match: false,
          computed_at: "2026-10-18T00:00:00Z",
        },
        candidates: [
          {
            library_key: "access-termination",
            control_ref: "ITGC-AC-02",
            title: "Leavers lose access promptly",
            objective:
              "Leavers' access is removed within the period the policy allows.",
            rank: 1,
            status: "STRONG",
            rationale:
              "Accounts are locked within 1 business day of the termination date.",
            applicable: ["ac02-removed"],
            excluded: [
              { key: "ac02-days", reason: "No policy period is stated." },
            ],
            missing: ["Record the number of days the policy allows."],
            library_status: "PENDING_REVIEW",
          },
          {
            library_key: "x",
            control_ref: "X",
            title: "x",
            rank: 2,
            status: "WHAT",
          },
        ],
      }),
    );
    assert.ok(basis !== null);
    assert.equal(basis.basis, "STANDARD");
    assert.equal(basis.standard?.controlRef, "ITGC-AC-02");
    assert.equal(basis.run?.decidedBy, "MODEL");
    assert.equal(basis.candidates[0]?.status, "STRONG");
    assert.equal(basis.candidates[0]?.excluded[0]?.key, "ac02-days");
    // An unknown status is never read as a match.
    assert.equal(basis.candidates[1]?.status, "NONE");
    assert.equal(
      basisLine(basis),
      "Standard: ITGC-AC-02 Leavers lose access promptly.",
    );
    assert.equal(standardNote("PENDING_REVIEW"), "Pending methodology review");
    assert.equal(standardNote("APPROVED"), "");
    assert.equal(parseTestBasis({ basis: "CLIENT" }), null);
  });

  it("says when the client's RCM states no procedure of its own", () => {
    const placeholder = parseTestBasis(body({}));
    assert.ok(placeholder !== null);
    assert.match(basisLine(placeholder), /no specific test procedure/);
    const stated = parseTestBasis(
      body({
        client_procedures_stated: true,
        client_procedures: [
          "Agree the termination date to the disable date.",
          "Check the ticket.",
        ],
      }),
    );
    assert.ok(stated !== null);
    assert.equal(
      basisLine(stated),
      "Client's procedures: the client's RCM states 2 test procedures.",
    );
  });

  it("builds the calls to find a standard and to decide the basis", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    assert.deepEqual(basisWrite({ ...ids, intent: "match" }), {
      method: "POST",
      path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/test-basis/match`,
      body: {},
    });
    assert.deepEqual(
      basisWrite({
        ...ids,
        intent: "basis",
        basis: "CUSTOM",
        library_key: "access-termination",
        note: "Tailored for the 1-day SLA",
      }),
      {
        method: "PUT",
        path: `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/test-basis`,
        body: {
          basis: "CUSTOM",
          library_key: "access-termination",
          note: "Tailored for the 1-day SLA",
        },
      },
    );
    const client = basisWrite({
      ...ids,
      intent: "basis",
      basis: "CLIENT",
      library_key: "",
    });
    assert.ok(!("error" in client));
    assert.equal(client.body.library_key, null);
    assert.deepEqual(basisWrite({ ...ids, intent: "basis", basis: "OTHER" }), {
      error: "invalid",
    });
    assert.deepEqual(basisWrite({ organization_id: "x", intent: "match" }), {
      error: "invalid",
    });
    assert.equal(basisProblem(200, ""), null);
    assert.equal(
      basisProblem(409, "choose the standard to follow first"),
      "Choose the standard to follow first",
    );
    assert.match(basisProblem(403, "") ?? "", /update the engagement/);
  });
});
