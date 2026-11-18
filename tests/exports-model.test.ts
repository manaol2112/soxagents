import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  exportDownloadHref,
  FORMAT_WORDS,
  parseExports,
  reportsFirst,
} from "../apps/web/src/exports-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const listed = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    dataset: "evidence_requests",
    title: "Evidence requests",
    file_format: "xlsx",
    file_name: "requests.xlsx",
    created_at: "2026-10-29T18:00:00Z",
    created_by: "Dana Whitfield",
    as_of: "2026-10-29T18:00:00Z",
    row_count: 58,
    narrative: false,
    available: true,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    dataset: "status_report",
    title: "Engagement status report",
    file_format: "pdf",
    file_name: "status.pdf",
    created_at: "2026-10-29T17:00:00Z",
    created_by: "Dana Whitfield",
    as_of: "2026-10-29T17:00:00Z",
    row_count: 14,
    narrative: true,
    available: false,
  },
];

describe("the exports on record", () => {
  it("reads the listing and refuses a malformed one", () => {
    const parsed = parseExports(listed);
    assert.equal(parsed?.length, 2);
    assert.equal(parsed?.[1]?.title, "Engagement status report");
    assert.equal(parsed?.[1]?.narrative, true);
    assert.equal(parsed?.[1]?.available, false);
    assert.equal(parsed?.[0]?.rows, 58);
    assert.equal(parseExports("no"), null);
    assert.equal(parseExports([{ id: "not-a-uuid" }]), null);
    assert.deepEqual(parseExports([]), []);
  });

  it("puts the reports first and downloads through the workspace", () => {
    const parsed = parseExports(listed) ?? [];
    assert.deepEqual(
      reportsFirst(parsed).map((item) => item.dataset),
      ["status_report", "evidence_requests"],
    );
    assert.equal(
      exportDownloadHref(parsed[0]?.id ?? "", ORG, PROJECT),
      `/workspace/exports/${parsed[0]?.id}?organization=${ORG}&project=${PROJECT}`,
    );
    assert.equal(FORMAT_WORDS.docx, "Word");
  });
});
