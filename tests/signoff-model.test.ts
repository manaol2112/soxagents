import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseSignoffs,
  receipts,
  receiptText,
  reopenText,
} from "../apps/web/src/signoff-model.ts";

const sheetSignoff = {
  id: "01a12990-0000-7000-8000-000000000001",
  test_sheet_id: "01a12990-0000-7000-8000-000000000010",
  test_round_id: null,
  round_kind: null,
  sheet_version: 7,
  conclusion: "NOT_EFFECTIVE",
  signed_by: "Dana Preparer",
  signed_at: "2026-10-12T04:39:26Z",
  signoff_note: "Live check.",
  plan_revision: 2,
  reopened_at: "2026-10-19T19:00:00Z",
  reopened_by: "Mira Reviewer",
  reopen_reason: "Review note: T-0 approved by the requester",
  reopened_from: "REVIEW_NOTE",
};

const reviewSignoff = {
  id: "01a12990-0000-7000-8000-000000000002",
  control_review_id: "01a12990-0000-7000-8000-000000000020",
  test_round_id: "01a12990-0000-7000-8000-000000000030",
  round_kind: "ROLLFORWARD",
  review_version: 5,
  signed_by: "Mira Reviewer",
  signed_at: "2026-10-18T10:00:00Z",
  signoff_note: "",
  coverage: { sheet_version: 3 },
  reopened_at: null,
  reopened_by: null,
  reopen_reason: "",
  reopened_from: null,
};

describe("sign-off receipts", () => {
  it("reads sheet and review sign-offs and orders them oldest first", () => {
    const testing = parseSignoffs([sheetSignoff], "TESTING");
    const review = parseSignoffs([reviewSignoff], "REVIEW");
    assert.ok(testing !== null && review !== null);
    assert.equal(testing[0]?.version, 7);
    assert.equal(review[0]?.version, 5);
    assert.equal(review[0]?.roundKind, "ROLLFORWARD");
    assert.deepEqual(
      receipts(testing, review).map((item) => item.kind),
      ["TESTING", "REVIEW"],
    );
    assert.equal(parseSignoffs("no", "TESTING"), null);
    assert.deepEqual(parseSignoffs([{ id: 1 }], "TESTING"), []);
  });

  it("says what was signed, by whom, at which version, and why it was reopened", () => {
    const [testing] = parseSignoffs([sheetSignoff], "TESTING") ?? [];
    const [review] = parseSignoffs([reviewSignoff], "REVIEW") ?? [];
    assert.ok(testing && review);
    assert.equal(
      receiptText(testing),
      "Interim testing signed off not effective by Dana Preparer (version 7, plan revision 2)",
    );
    assert.equal(
      reopenText(testing),
      "Reopened by a review note: Review note: T-0 approved by the requester",
    );
    assert.equal(
      receiptText(review),
      "Review of the roll-forward round signed off by Mira Reviewer (version 5)",
    );
    assert.equal(reopenText(review), "");
  });
});
