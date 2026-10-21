import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mappingSummary,
  parseEvidenceMapping,
} from "../apps/web/src/evidence-mapping-model.ts";

const file = "11111111-1111-7111-8111-111111111111";

const run = {
  id: "22222222-2222-7222-8222-222222222222",
  control_id: "33333333-3333-7333-8333-333333333333",
  plan_revision: 2,
  attributes_sha256: "a".repeat(64),
  created_at: "2026-10-21T10:00:00Z",
  requested_by: "Dana Whitfield",
  source: "MODEL",
  note: "",
  files: [
    {
      file_id: file,
      file_name: "approvals.xlsx",
      sha256: "b".repeat(64),
      readable: true,
      kind: "sample",
    },
  ],
  mappings: [
    {
      attribute_index: 1,
      attribute_text: "The approval is dated on or before the grant",
      status: "CONTRADICTORY",
      required: "Access request and approval",
      candidates: [
        {
          file_id: file,
          file_name: "approvals.xlsx",
          sha256: "b".repeat(64),
          readable: true,
          kind: "sample",
        },
      ],
      references: [
        {
          file_id: file,
          file_name: "approvals.xlsx",
          quote: "REQ-3 | Dana | 2027-03-15",
          location: "Sheet Approvals, row 2, column Ticket",
          page: null,
          sheet: "Approvals",
          row: 2,
          column: "Ticket",
          cell: "A3",
          found: true,
        },
        {
          file_id: file,
          file_name: "email.pdf",
          quote: "created on 2027-03-10",
          location: "Page 1",
          page: 1,
          sheet: null,
          row: null,
          column: null,
          cell: null,
          found: true,
        },
      ],
      facts: [{ text: "Approved on 15 March", reference: 0 }],
      inferences: ["U-0003 and u0003 are the same person"],
      missing: [],
      conflicts: [{ text: "Approved after the grant", references: [0, 1] }],
      note: "",
      source: "MODEL",
      model_call_id: null,
    },
    {
      attribute_index: 0,
      attribute_text: "A request exists",
      status: "POTENTIALLY_SUFFICIENT",
      required: "",
      candidates: [],
      references: [],
      facts: [],
      inferences: [],
      missing: [],
      conflicts: [],
      note: "",
      source: "MODEL",
      model_call_id: null,
    },
    { attribute_index: 2, attribute_text: "x", status: "NOT_A_STATUS" },
  ],
  stale: true,
  stale_reasons: ["A mapped file was replaced by a newer version."],
};

describe("evidence mapping model", () => {
  it("parses a run, keeps only known statuses and orders attributes", () => {
    const parsed = parseEvidenceMapping(run);
    assert.ok(parsed !== null);
    assert.equal(parsed.mappings.length, 2);
    assert.deepEqual(
      parsed.mappings.map((m) => m.index),
      [0, 1],
    );
    const second = parsed.mappings[1];
    assert.ok(second);
    assert.equal(second.status, "CONTRADICTORY");
    assert.equal(second.references[0]?.cell, "A3");
    assert.equal(second.references[1]?.page, 1);
    assert.deepEqual(second.conflicts[0]?.references, [0, 1]);
    assert.equal(parsed.stale, true);
    assert.equal(parsed.staleReasons.length, 1);
    assert.equal(parsed.files[0]?.fileName, "approvals.xlsx");
  });

  it("summarises the statuses and answers null for no run", () => {
    const parsed = parseEvidenceMapping(run);
    assert.ok(parsed !== null);
    assert.equal(
      mappingSummary(parsed),
      "1 contradictory · 1 potentially sufficient",
    );
    assert.equal(parseEvidenceMapping(null), null);
    // An execution failure is kept as its own status, never as an evidence finding.
    const failed = parseEvidenceMapping({
      ...run,
      mappings: [
        {
          attribute_index: 0,
          attribute_text: "A request exists",
          status: "NOT_MAPPED",
          source: "FAILED",
          note: "Not mapped: the model's answer could not be used.",
        },
      ],
    });
    assert.equal(failed?.mappings[0]?.status, "NOT_MAPPED");
    assert.ok(failed !== null);
    assert.equal(
      mappingSummary(failed),
      "1 not mapped (the model call failed)",
    );
    assert.equal(parseEvidenceMapping({ id: 5 }), null);
  });
});
