import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  designConclusionNoticeFor,
  designConclusionWrite,
  parseDesignConclusion,
  signBlockedReason,
} from "../apps/web/src/design-conclusion-model.ts";

const ORG = "01900000-0000-7000-8000-000000000001";
const PROJECT = "01900000-0000-7000-8000-000000000002";
const CONTROL = "01900000-0000-7000-8000-000000000003";

// The API's body for a control whose design workpaper is prepared and not yet signed off.
function body(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    control_id: CONTROL,
    status: "TO_SIGN",
    proposed: "EFFECTIVE",
    workpaper: {
      id: "01900000-0000-7000-8000-000000000004",
      status: "PREPARED",
      drafting: false,
      prepared_by: "Dana Preparer",
      prepared_version: 2,
    },
    deficiencies: [],
    signed: null,
    out_of_date: [],
    blocking: [],
    viewer_is_reviewer: true,
    viewer_prepared: false,
    independence_required: true,
    can_sign: true,
    history: [],
    ...overrides,
  };
}

const signoff = {
  id: "01900000-0000-7000-8000-000000000005",
  verdict: "NOT_EFFECTIVE",
  workpaper_version: 2,
  deficiencies: ["D-901"],
  signed_by: "Riley Reviewer",
  signed_at: "2026-11-08T15:00:00Z",
  signoff_note: "Walkthrough reviewed.",
  reopened_at: null,
  reopened_by: null,
  reopen_reason: "",
  reopened_from: null,
};

describe("the D&I conclusion", () => {
  it("reads the API's body", () => {
    const parsed = parseDesignConclusion(
      body({
        status: "SIGNED_OFF",
        proposed: "NOT_EFFECTIVE",
        signed: signoff,
        history: [signoff, { ...signoff, id: "x", reopened_from: "BOGUS" }],
      }),
    );
    assert.ok(parsed !== null);
    assert.equal(parsed.status, "SIGNED_OFF");
    assert.equal(parsed.signed?.verdict, "NOT_EFFECTIVE");
    assert.deepEqual(parsed.signed?.deficiencies, ["D-901"]);
    assert.equal(parsed.workpaper?.preparedVersion, 2);
    // An unknown reopening source is never trusted as one of ours.
    assert.equal(parsed.history[1]?.reopenedFrom, null);
  });

  it("rejects a body that is not a D&I conclusion", () => {
    assert.equal(parseDesignConclusion(null), null);
    assert.equal(parseDesignConclusion(body({ status: "DONE" })), null);
    assert.equal(parseDesignConclusion({ status: "TO_SIGN" }), null);
    // A signed verdict outside the two is dropped, never read as effective.
    const odd = parseDesignConclusion(
      body({ signed: { ...signoff, verdict: "MAYBE" } }),
    );
    assert.equal(odd?.signed, null);
  });

  it("says why the viewer cannot sign", () => {
    const parse = (overrides: Record<string, unknown>) => {
      const parsed = parseDesignConclusion(body(overrides));
      assert.ok(parsed !== null);
      return parsed;
    };
    assert.equal(signBlockedReason(parse({})), null);
    assert.match(
      signBlockedReason(
        parse({ can_sign: false, viewer_is_reviewer: false }),
      ) ?? "",
      /reviewer role/,
    );
    assert.match(
      signBlockedReason(parse({ can_sign: false, viewer_prepared: true })) ??
        "",
      /preparer/,
    );
    assert.match(
      signBlockedReason(parse({ can_sign: false, status: "NOT_READY" })) ?? "",
      /D&I Assessment/,
    );
  });

  it("builds the sign-off and the reopening, and nothing else", () => {
    const ids = {
      organization_id: ORG,
      project_id: PROJECT,
      control_id: CONTROL,
    };
    const signed = designConclusionWrite({
      ...ids,
      intent: "sign",
      verdict: "EFFECTIVE",
      workpaper_version: "2",
      note: " Reviewed. ",
    });
    assert.deepEqual(signed, {
      intent: "sign",
      path: `/organizations/${ORG}/projects/${PROJECT}/design-conclusions/${CONTROL}/sign-off`,
      body: { verdict: "EFFECTIVE", workpaper_version: 2, note: "Reviewed." },
      controlId: CONTROL,
    });
    const reopened = designConclusionWrite({
      ...ids,
      intent: "reopen",
      reason: "The walkthrough must be performed again.",
    });
    assert.ok(!("error" in reopened) && reopened.path.endsWith("/reopen"));
    for (const fields of [
      { ...ids, intent: "sign", verdict: "PASS", workpaper_version: "2" },
      { ...ids, intent: "sign", verdict: "EFFECTIVE", workpaper_version: "0" },
      {
        ...ids,
        intent: "sign",
        verdict: "EFFECTIVE",
        workpaper_version: "2",
        note: "password: hunter2",
      },
      { ...ids, intent: "reopen", reason: "Too short" },
      { ...ids, intent: "approve" },
      {
        ...ids,
        control_id: "../../users",
        intent: "reopen",
        reason: "x".repeat(20),
      },
    ]) {
      assert.deepEqual(designConclusionWrite(fields), { error: "invalid" });
    }
  });

  it("shows success only once the API confirms it", () => {
    assert.equal(designConclusionNoticeFor("sign", 200, ""), "dc-signed");
    assert.equal(designConclusionNoticeFor("reopen", 200, ""), "dc-reopened");
    assert.equal(
      designConclusionNoticeFor(
        "sign",
        409,
        "you prepared the design workpaper; another reviewer must sign off",
      ),
      "dc-denied",
    );
    assert.equal(
      designConclusionNoticeFor("sign", 409, "the design workpaper changed"),
      "dc-blocked",
    );
    assert.equal(designConclusionNoticeFor("sign", 422, ""), "dc-invalid");
    assert.equal(
      designConclusionNoticeFor("sign", 402, "subscription inactive"),
      "dc-trial-ended",
    );
    assert.equal(designConclusionNoticeFor("sign", 0, ""), "dc-unavailable");
  });
});
