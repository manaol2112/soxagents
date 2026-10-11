import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analysisFor,
  analysisInProgress,
  analysisNoticeFor,
  analysisWrite,
  parseAnalyses,
  parseEvidenceSettings,
  parseReviews,
  readingLabel,
  reviewFor,
} from "../apps/web/src/analysis-model.ts";

const ids = {
  organization_id: "11111111-1111-7111-8111-111111111111",
  project_id: "22222222-2222-7222-8222-222222222222",
};
const analysisId = "33333333-3333-7333-8333-333333333333";
const fileId = "44444444-4444-7444-8444-444444444444";

const row = {
  id: analysisId,
  evidence_file_id: fileId,
  pbc_request_id: null,
  status: "READY",
  attempts: 1,
  extraction: "OCR",
  extraction_status: "EXTRACTED",
  ocr_engine: "LOCAL",
  text_excerpt: "Minimum password length 12",
  text_length: 26,
  text_truncated: false,
  content_redacted: true,
  page_count: 1,
  row_count: null,
  columns: [],
  classification: {
    kind: "configuration",
    confidence: "medium",
    summary: "A settings screenshot.",
    reason: "",
    items: [
      { index: 0, title: "Password settings", coverage: "COVERED", note: "" },
      { index: 1, title: "Bad", coverage: "MAYBE", note: "" },
    ],
    gaps: ["Ask for the lockout setting.", 4],
    period: "",
  },
  source: "RULES",
  note: "",
  confirmed_kind: null,
  confirmed_note: "",
  confirmed_at: null,
  confirmed_by_name: null,
  version: 3,
};

describe("evidence reading model", () => {
  it("parses analyses and drops what it does not know", () => {
    const parsed = parseAnalyses([row]);
    assert.ok(parsed !== null);
    const [first] = parsed;
    assert.equal(first?.classification?.kind, "configuration");
    assert.deepEqual(
      first?.classification?.items.map((item) => item.coverage),
      ["COVERED"],
    );
    assert.deepEqual(first?.classification?.gaps, [
      "Ask for the lockout setting.",
    ]);
    assert.equal(first?.ocrEngine, "LOCAL");
    assert.equal(analysisFor(parsed, fileId)?.id, analysisId);
    assert.equal(analysisFor(parsed, analysisId), null);
    assert.equal(
      readingLabel(first ?? (parsed[0] as never)),
      "Read by local OCR · 1 page",
    );
    const unknown = parseAnalyses([
      { ...row, classification: { ...row.classification, kind: "invoice" } },
    ]);
    assert.equal(unknown?.[0]?.classification, null);
    assert.equal(parseAnalyses([{ ...row, status: "DONE" }]), null);
    assert.equal(parseAnalyses({}), null);
    assert.equal(
      analysisInProgress(parseAnalyses([{ ...row, status: "WORKING" }])),
      true,
    );
    assert.equal(analysisInProgress(parsed), false);
    assert.equal(analysisInProgress(null), false);
  });

  it("parses the firm setting", () => {
    assert.deepEqual(
      parseEvidenceSettings({
        ocr_engine: "MODEL",
        version: 2,
        model_configured: true,
        local_ocr_available: false,
      }),
      {
        ocrEngine: "MODEL",
        version: 2,
        modelConfigured: true,
        localOcrAvailable: false,
      },
    );
    assert.equal(
      parseEvidenceSettings({ ocr_engine: "CLOUD", version: 1 }),
      null,
    );
  });

  it("builds each write and refuses bad input", () => {
    const base = `/organizations/${ids.organization_id}/projects/${ids.project_id}/evidence-analyses/${analysisId}`;
    assert.deepEqual(
      analysisWrite({
        ...ids,
        intent: "confirm",
        analysis_id: analysisId,
        version: "3",
        kind: "report",
        note: "  It is the key report. ",
      }),
      {
        intent: "confirm",
        section: "evidence",
        method: "POST",
        path: `${base}/confirm`,
        body: { version: 3, kind: "report", note: "It is the key report." },
      },
    );
    assert.deepEqual(
      analysisWrite({
        ...ids,
        intent: "reanalyze",
        analysis_id: analysisId,
        version: "3",
      }),
      {
        intent: "reanalyze",
        section: "evidence",
        method: "POST",
        path: `${base}/reanalyze`,
        body: { version: 3 },
      },
    );
    assert.deepEqual(
      analysisWrite({
        organization_id: ids.organization_id,
        intent: "ocr-engine",
        ocr_engine: "MODEL",
        version: "0",
      }),
      {
        intent: "ocr-engine",
        section: "agents",
        method: "PUT",
        path: `/organizations/${ids.organization_id}/evidence-settings`,
        body: { ocr_engine: "MODEL", version: 0 },
      },
    );
    for (const bad of [
      {
        ...ids,
        intent: "confirm",
        analysis_id: analysisId,
        version: "3",
        kind: "invoice",
      },
      {
        ...ids,
        intent: "confirm",
        analysis_id: analysisId,
        version: "3",
        kind: "report",
        note: "password = Hunter2024x",
      },
      {
        ...ids,
        intent: "confirm",
        analysis_id: "../x",
        version: "3",
        kind: "report",
      },
      { ...ids, intent: "reanalyze", analysis_id: analysisId, version: "0" },
      { ...ids, intent: "reanalyze", analysis_id: analysisId, version: "x" },
      {
        organization_id: "x",
        intent: "ocr-engine",
        ocr_engine: "LOCAL",
        version: "0",
      },
      { ...ids, intent: "ocr-engine", ocr_engine: "CLOUD", version: "0" },
      { ...ids, intent: "delete", analysis_id: analysisId, version: "1" },
    ]) {
      assert.deepEqual(analysisWrite(bad), { error: "invalid" });
    }
  });

  it("maps results to notices", () => {
    assert.equal(analysisNoticeFor("confirm", 200), "classified");
    assert.equal(analysisNoticeFor("reanalyze", 200), "reading");
    assert.equal(analysisNoticeFor("ocr-engine", 200), "ocr-saved");
    assert.equal(analysisNoticeFor("confirm", 409), "analysis-changed");
    assert.equal(analysisNoticeFor("ocr-engine", 409), "ocr-changed");
    assert.equal(analysisNoticeFor("ocr-engine", 403), "denied");
    assert.equal(analysisNoticeFor("confirm", 422), "invalid");
    assert.equal(analysisNoticeFor("confirm", 0), "unavailable");
  });
  it("parses reviews and keeps only known results", () => {
    const reviews = parseReviews([
      {
        id: analysisId,
        evidence_analysis_id: analysisId,
        evidence_file_id: fileId,
        status: "READY",
        checks: [
          { check: "legibility", result: "OK", note: "" },
          { check: "date_period", result: "ISSUE", note: "No clock." },
          { check: "vibes", result: "OK" },
        ],
        attributes: [
          { index: 0, attribute: "Settings meet policy", result: "PASS" },
          { index: 1, attribute: "Bad", result: "MAYBE" },
        ],
        proposed: "CANNOT_CONCLUDE",
        feedback: "Undated.",
        follow_up_request_id: fileId,
        follow_up_status: "DRAFT",
        note: "",
        decision: null,
        conclusion: null,
        decision_note: "",
        decided_by_name: null,
        decided_at: null,
        version: 2,
      },
    ]);
    assert.ok(reviews !== null);
    assert.deepEqual(
      reviews.map((review) => review.checks.map((check) => check.check)),
      [["legibility", "date_period"]],
    );
    assert.equal(reviews[0]?.attributes.length, 1);
    assert.equal(reviews[0]?.followUpStatus, "DRAFT");
    assert.equal(reviewFor(reviews, fileId)?.id, analysisId);
    assert.equal(
      parseReviews([
        {
          id: analysisId,
          evidence_file_id: fileId,
          status: "READY",
          proposed: "MAYBE",
        },
      ]),
      null,
    );
  });

  it("builds the sign-off and needs a reason to override", () => {
    const path = `/organizations/${ids.organization_id}/projects/${ids.project_id}/evidence-reviews/${analysisId}/decide`;
    assert.deepEqual(
      analysisWrite({
        ...ids,
        intent: "decide",
        analysis_id: analysisId,
        version: "2",
        decision: "ACCEPTED",
        conclusion: "EXCEPTION",
      }),
      {
        intent: "decide",
        section: "evidence",
        method: "POST",
        path,
        body: { version: 2, decision: "ACCEPTED", note: "" },
      },
    );
    assert.deepEqual(
      analysisWrite({
        ...ids,
        intent: "decide",
        analysis_id: analysisId,
        version: "2",
        decision: "OVERRIDDEN",
        conclusion: "NO_EXCEPTION",
        note: "Approved exception",
      }),
      {
        intent: "decide",
        section: "evidence",
        method: "POST",
        path,
        body: {
          version: 2,
          decision: "OVERRIDDEN",
          conclusion: "NO_EXCEPTION",
          note: "Approved exception",
        },
      },
    );
    for (const bad of [
      {
        ...ids,
        intent: "decide",
        analysis_id: analysisId,
        version: "2",
        decision: "OVERRIDDEN",
        conclusion: "NO_EXCEPTION",
        note: "",
      },
      {
        ...ids,
        intent: "decide",
        analysis_id: analysisId,
        version: "2",
        decision: "OVERRIDDEN",
        conclusion: "MAYBE",
        note: "Because",
      },
      {
        ...ids,
        intent: "decide",
        analysis_id: analysisId,
        version: "2",
        decision: "MAYBE",
      },
    ]) {
      assert.deepEqual(analysisWrite(bad), { error: "invalid" });
    }
    assert.equal(analysisNoticeFor("decide", 200), "signed-off");
    assert.equal(analysisNoticeFor("decide", 409), "review-changed");
    assert.equal(analysisNoticeFor("decide", 403), "denied");
  });
});
