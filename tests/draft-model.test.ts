import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  draftLabel,
  parseDrafts,
  redraftNoticeFor,
  redraftTarget,
  requestTitle,
} from "../apps/web/src/draft-model.ts";

const requestId = "11111111-1111-7111-8111-111111111111";
const ids = {
  organization_id: "22222222-2222-7222-8222-222222222222",
  project_id: "33333333-3333-7333-8333-333333333333",
};

function draft(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "44444444-4444-7444-8444-444444444444",
    pbc_request_id: requestId,
    status: "DRAFTED",
    source: "MODEL",
    note: "",
    content: {
      summary: "For our testing of ITGC-AC-01, please provide the population.",
      items: [
        {
          kind: "population",
          title: "Population of new users",
          detail: "Every user created in SAP ERP in FY2027.",
          fields: ["User ID", "Created on"],
        },
      ],
      questions: ["Are users created outside SAP?"],
      assumptions: ["SAP is the only system."],
    },
    ...extra,
  };
}

describe("drafted evidence requests", () => {
  it("parses drafts by request and ignores malformed rows", () => {
    const drafts = parseDrafts([
      draft(),
      { id: "x" },
      draft({ status: "EVIL" }),
    ]);
    assert.equal(drafts.size, 1);
    const parsed = drafts.get(requestId);
    assert.equal(parsed?.items[0]?.fields[1], "Created on");
    assert.equal(parsed?.questions[0], "Are users created outside SAP?");
    assert.equal(parseDrafts("nope").size, 0);
  });

  it("labels each drafting state", () => {
    const drafts = parseDrafts([draft()]);
    assert.equal(
      draftLabel(drafts.get(requestId))?.label,
      "Drafted by an agent",
    );
    const rules = parseDrafts([draft({ source: "RULES" })]).get(requestId);
    assert.equal(draftLabel(rules)?.label, "Drafted from the RCM");
    const pending = parseDrafts([draft({ status: "PENDING", content: null })]);
    assert.equal(draftLabel(pending.get(requestId))?.tone, "info");
    const failed = parseDrafts([draft({ status: "FAILED", content: null })]);
    assert.equal(draftLabel(failed.get(requestId))?.tone, "warning");
    assert.equal(draftLabel(undefined), null);
  });

  it("titles a request by its summary, else its first line", () => {
    const drafted = parseDrafts([draft()]).get(requestId);
    assert.equal(
      requestTitle("long text", drafted),
      "For our testing of ITGC-AC-01, please provide the population.",
    );
    assert.equal(
      requestTitle("\n- Population of users\n- Approvals", undefined),
      "Population of users",
    );
    assert.ok(requestTitle("x".repeat(400), undefined).length <= 160);
  });

  it("builds the redraft call and refuses bad ids", () => {
    assert.deepEqual(redraftTarget({ ...ids, request_id: requestId }), {
      path: `/organizations/${ids.organization_id}/projects/${ids.project_id}/pbc-requests/${requestId}/redraft`,
    });
    assert.equal(redraftTarget({ ...ids, request_id: "../x" }), null);
    assert.equal(redraftNoticeFor(200), "redrafting");
    assert.equal(redraftNoticeFor(403), "denied");
    assert.equal(redraftNoticeFor(409), "redraft-failed");
  });
});
