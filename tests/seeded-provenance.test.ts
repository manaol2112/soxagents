import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAnalyses } from "../apps/web/src/analysis-model.ts";
import { draftLabel, parseDrafts } from "../apps/web/src/draft-model.ts";

// SEEDED (migration 0129, Step 4A): an output prepared with the demo dataset, never a
// fresh model result, the rules, a fallback or a failure. Each parser keeps the value
// instead of dropping it or folding it into another, and the label says what it is.

const requestId = "11111111-1111-7111-8111-111111111111";

function draft(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "44444444-4444-7444-8444-444444444444",
    pbc_request_id: requestId,
    status: "DRAFTED",
    source: "SEEDED",
    note: "",
    content: {
      summary: "For our testing of NS-AC-01, please provide the population.",
      items: [
        {
          kind: "population",
          title: "Population of access requests",
          detail: "Every SAP access request closed in FY2027.",
          fields: ["Request", "Provisioned On"],
        },
      ],
      questions: [],
      assumptions: [],
    },
    ...extra,
  };
}

describe("the SEEDED provenance", () => {
  it("is kept by the request draft parser and labelled as prepared", () => {
    const seeded = parseDrafts([draft()]).get(requestId);
    assert.equal(seeded?.source, "SEEDED");
    assert.deepEqual(draftLabel(seeded), {
      label: "Prepared with the demo",
      tone: "neutral",
    });
    // The other values keep their meanings.
    assert.equal(
      parseDrafts([draft({ source: "FALLBACK" })]).get(requestId)?.source,
      "FALLBACK",
    );
    assert.equal(
      parseDrafts([draft({ source: "OTHER" })]).get(requestId)?.source,
      null,
    );
  });

  it("is kept by the evidence analysis parser", () => {
    const parsed = parseAnalyses([
      {
        id: "55555555-5555-7555-8555-555555555555",
        evidence_file_id: "66666666-6666-7666-8666-666666666666",
        status: "READY",
        extraction: "TABLE",
        extraction_status: "EXTRACTED",
        extracted_text: "User ID | Full Name",
        text_truncated: false,
        page_count: null,
        row_count: 550,
        columns: ["User ID", "Full Name"],
        classification: {
          kind: "population",
          confidence: "medium",
          summary: "A user listing.",
          reason: "",
          items: [],
          gaps: [],
        },
        source: "SEEDED",
        note: "",
        confirmed_kind: null,
        confirmed_note: "",
      },
    ]);
    assert.equal(parsed?.[0]?.source, "SEEDED");
  });
});
