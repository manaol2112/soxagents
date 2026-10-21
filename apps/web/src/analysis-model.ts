/** Evidence reading: what the evidence coordinator read from each stored file. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*\S{8,}|password\s*[:=]\s*(?=\S*[0-9])(?=\S*[A-Za-z])\S{6,}|(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/i;

export const EVIDENCE_KINDS = [
  "population",
  "walkthrough",
  "design",
  "configuration",
  "change_history",
  "report",
  "policy",
  "sample",
  "other",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  population: "Population or listing",
  walkthrough: "Walkthrough evidence",
  design: "Design evidence",
  configuration: "Configuration or settings",
  change_history: "Change history or audit log",
  report: "Key report or query",
  policy: "Policy or procedure",
  sample: "Sample evidence",
  other: "Other",
};

export type Coverage = "COVERED" | "PARTIAL" | "NOT_COVERED";
export type AnalysisStatus = "PENDING" | "WORKING" | "READY" | "FAILED";
export type OcrEngine = "LOCAL" | "MODEL";

export type ItemCoverage = {
  index: number;
  title: string;
  coverage: Coverage;
  note: string;
};

export type Classification = {
  kind: EvidenceKind;
  confidence: "high" | "medium" | "low";
  summary: string;
  reason: string;
  items: ItemCoverage[];
  gaps: string[];
  period: string;
};

export type EvidenceAnalysis = {
  id: string;
  fileId: string;
  requestId: string | null;
  status: AnalysisStatus;
  extraction: string | null;
  extractionStatus: string | null;
  ocrEngine: OcrEngine | null;
  excerpt: string;
  textLength: number;
  truncated: boolean;
  redacted: boolean;
  pages: number | null;
  rows: number | null;
  columns: string[];
  classification: Classification | null;
  /** MODEL: the model's checked answer. RULES: the rules by design. FALLBACK: the rules
   * after a model failure. FAILED: the model failed and nothing stands in. */
  source: "MODEL" | "RULES" | "FALLBACK" | "FAILED" | null;
  note: string;
  confirmedKind: EvidenceKind | null;
  confirmedNote: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  version: number;
};

export type EvidenceSettings = {
  ocrEngine: OcrEngine;
  version: number;
  modelConfigured: boolean;
  localOcrAvailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function maybe(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): T | null {
  return options.find((option) => option === value) ?? null;
}

function parseClassification(value: unknown): Classification | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = oneOf(value.kind, EVIDENCE_KINDS);
  if (kind === null) {
    return null;
  }
  const items: ItemCoverage[] = [];
  if (Array.isArray(value.items)) {
    for (const item of value.items) {
      if (!isRecord(item)) {
        continue;
      }
      const coverage = oneOf(item.coverage, [
        "COVERED",
        "PARTIAL",
        "NOT_COVERED",
      ] as const);
      const index = count(item.index);
      if (coverage === null || index === null) {
        continue;
      }
      items.push({
        index,
        title: str(item.title),
        coverage,
        note: str(item.note),
      });
    }
  }
  return {
    kind,
    confidence:
      oneOf(value.confidence, ["high", "medium", "low"] as const) ?? "low",
    summary: str(value.summary),
    reason: str(value.reason),
    items,
    gaps: Array.isArray(value.gaps)
      ? value.gaps.filter((gap): gap is string => typeof gap === "string")
      : [],
    period: str(value.period),
  };
}

export function parseAnalyses(value: unknown): EvidenceAnalysis[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: EvidenceAnalysis[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      typeof item.evidence_file_id !== "string" ||
      !UUID.test(item.evidence_file_id)
    ) {
      return null;
    }
    const status = oneOf(item.status, [
      "PENDING",
      "WORKING",
      "READY",
      "FAILED",
    ] as const);
    if (status === null) {
      return null;
    }
    items.push({
      id: item.id,
      fileId: item.evidence_file_id,
      requestId: maybe(item.pbc_request_id),
      status,
      extraction: maybe(item.extraction),
      extractionStatus: maybe(item.extraction_status),
      ocrEngine: oneOf(item.ocr_engine, ["LOCAL", "MODEL"] as const),
      excerpt: str(item.text_excerpt),
      textLength: count(item.text_length) ?? 0,
      truncated: item.text_truncated === true,
      redacted: item.content_redacted === true,
      pages: count(item.page_count),
      rows: count(item.row_count),
      columns: Array.isArray(item.columns)
        ? item.columns.filter((c): c is string => typeof c === "string")
        : [],
      classification: parseClassification(item.classification),
      source: oneOf(item.source, [
        "MODEL",
        "RULES",
        "FALLBACK",
        "FAILED",
      ] as const),
      note: str(item.note),
      confirmedKind: oneOf(item.confirmed_kind, EVIDENCE_KINDS),
      confirmedNote: str(item.confirmed_note),
      confirmedAt: maybe(item.confirmed_at),
      confirmedBy: maybe(item.confirmed_by_name),
      version: count(item.version) ?? 1,
    });
  }
  return items;
}

export function parseEvidenceSettings(value: unknown): EvidenceSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  const engine = oneOf(value.ocr_engine, ["LOCAL", "MODEL"] as const);
  const version = count(value.version);
  if (engine === null || version === null) {
    return null;
  }
  return {
    ocrEngine: engine,
    version,
    modelConfigured: value.model_configured === true,
    localOcrAvailable: value.local_ocr_available === true,
  };
}

export function analysisFor(
  analyses: readonly EvidenceAnalysis[],
  fileId: string,
): EvidenceAnalysis | null {
  return analyses.find((item) => item.fileId === fileId) ?? null;
}

export function analysisInProgress(
  analyses: readonly EvidenceAnalysis[] | null,
): boolean {
  return (analyses ?? []).some(
    (item) => item.status === "PENDING" || item.status === "WORKING",
  );
}

/** How the file was read, in plain words. */
export function readingLabel(analysis: EvidenceAnalysis): string {
  const shape =
    analysis.rows !== null
      ? `${analysis.rows.toLocaleString("en-US")} row${analysis.rows === 1 ? "" : "s"}${analysis.columns.length > 0 ? `, ${analysis.columns.length} column${analysis.columns.length === 1 ? "" : "s"}` : ""}`
      : analysis.pages !== null
        ? `${analysis.pages} page${analysis.pages === 1 ? "" : "s"}`
        : "";
  const how =
    analysis.extraction === "OCR"
      ? analysis.ocrEngine === "MODEL"
        ? "Read by model OCR"
        : "Read by local OCR"
      : analysis.extractionStatus === "NEEDS_OCR"
        ? "Waiting for a person to read the images"
        : analysis.extractionStatus === "UNSUPPORTED"
          ? "Not a file type the agent reads"
          : analysis.extractionStatus === "UNREADABLE"
            ? "Could not be read"
            : analysis.extraction === "TABLE"
              ? "Read as a table"
              : analysis.extraction === "PDF_TEXT"
                ? "Read from the PDF text"
                : "Read as text";
  const partial = analysis.extractionStatus === "PARTIAL" ? " (partly)" : "";
  return [how + partial, shape].filter((part) => part !== "").join(" · ");
}

export const REVIEW_CHECKS = [
  "legibility",
  "system",
  "date_period",
  "editing",
  "applicability",
] as const;
export type ReviewCheckKey = (typeof REVIEW_CHECKS)[number];
export const REVIEW_CHECK_LABELS: Record<ReviewCheckKey, string> = {
  legibility: "Legible and complete",
  system: "System and environment",
  date_period: "Date and period",
  editing: "No signs of editing",
  applicability: "Applies to the control",
};
export const CONCLUSIONS = [
  "NO_EXCEPTION",
  "EXCEPTION",
  "CANNOT_CONCLUDE",
] as const;
export type Conclusion = (typeof CONCLUSIONS)[number];
export const CONCLUSION_LABELS: Record<Conclusion, string> = {
  NO_EXCEPTION: "No exception",
  EXCEPTION: "Exception",
  CANNOT_CONCLUDE: "Cannot conclude yet",
};

export type ReviewCheck = {
  check: ReviewCheckKey;
  result: "OK" | "ISSUE" | "UNCLEAR";
  note: string;
};

export type AttributeTest = {
  index: number;
  attribute: string;
  result: "PASS" | "EXCEPTION" | "NOT_DETERMINABLE";
  observed: string;
  expected: string;
  note: string;
};

export type EvidenceReview = {
  id: string;
  analysisId: string;
  fileId: string;
  status: "READY" | "NEEDS_PERSON";
  checks: ReviewCheck[];
  attributes: AttributeTest[];
  proposed: Conclusion;
  feedback: string;
  followUpId: string | null;
  followUpStatus: string | null;
  note: string;
  decision: "ACCEPTED" | "OVERRIDDEN" | null;
  conclusion: Conclusion | null;
  decisionNote: string;
  decidedBy: string | null;
  decidedAt: string | null;
  version: number;
};

export function parseReviews(value: unknown): EvidenceReview[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const reviews: EvidenceReview[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      typeof item.evidence_file_id !== "string" ||
      !UUID.test(item.evidence_file_id)
    ) {
      return null;
    }
    const status = oneOf(item.status, ["READY", "NEEDS_PERSON"] as const);
    const proposed = oneOf(item.proposed, CONCLUSIONS);
    if (status === null || proposed === null) {
      return null;
    }
    const checks: ReviewCheck[] = [];
    for (const check of Array.isArray(item.checks) ? item.checks : []) {
      if (!isRecord(check)) {
        continue;
      }
      const key = oneOf(check.check, REVIEW_CHECKS);
      const result = oneOf(check.result, ["OK", "ISSUE", "UNCLEAR"] as const);
      if (key !== null && result !== null) {
        checks.push({ check: key, result, note: str(check.note) });
      }
    }
    const attributes: AttributeTest[] = [];
    for (const test of Array.isArray(item.attributes) ? item.attributes : []) {
      if (!isRecord(test)) {
        continue;
      }
      const result = oneOf(test.result, [
        "PASS",
        "EXCEPTION",
        "NOT_DETERMINABLE",
      ] as const);
      const index = count(test.index);
      if (result !== null && index !== null) {
        attributes.push({
          index,
          attribute: str(test.attribute),
          result,
          observed: str(test.observed),
          expected: str(test.expected),
          note: str(test.note),
        });
      }
    }
    reviews.push({
      id: item.id,
      analysisId: str(item.evidence_analysis_id),
      fileId: item.evidence_file_id,
      status,
      checks,
      attributes,
      proposed,
      feedback: str(item.feedback),
      followUpId: maybe(item.follow_up_request_id),
      followUpStatus: maybe(item.follow_up_status),
      note: str(item.note),
      decision: oneOf(item.decision, ["ACCEPTED", "OVERRIDDEN"] as const),
      conclusion: oneOf(item.conclusion, CONCLUSIONS),
      decisionNote: str(item.decision_note),
      decidedBy: maybe(item.decided_by_name),
      decidedAt: maybe(item.decided_at),
      version: count(item.version) ?? 1,
    });
  }
  return reviews;
}

export function reviewFor(
  reviews: readonly EvidenceReview[],
  fileId: string,
): EvidenceReview | null {
  return reviews.find((item) => item.fileId === fileId) ?? null;
}

export type AnalysisIntent = "confirm" | "reanalyze" | "ocr-engine" | "decide";

export type AnalysisWrite =
  | { error: "invalid" }
  | {
      intent: AnalysisIntent;
      section: "evidence" | "agents";
      method: "POST" | "PUT";
      path: string;
      body: Record<string, unknown>;
    };

/** Turn one form into one API call. Every value is checked before it is sent. */
export function analysisWrite(fields: Record<string, string>): AnalysisWrite {
  const organizationId = fields.organization_id ?? "";
  const intent = fields.intent ?? "";
  const raw = fields.version ?? "";
  if (!UUID.test(organizationId) || !/^\d{1,6}$/.test(raw)) {
    return { error: "invalid" };
  }
  const version = Number(raw);
  if (intent === "ocr-engine") {
    const engine = oneOf(fields.ocr_engine, ["LOCAL", "MODEL"] as const);
    if (engine === null) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: "agents",
      method: "PUT",
      path: `/organizations/${organizationId}/evidence-settings`,
      body: { ocr_engine: engine, version },
    };
  }
  const projectId = fields.project_id ?? "";
  const analysisId = fields.analysis_id ?? "";
  if (!UUID.test(projectId) || !UUID.test(analysisId) || version < 1) {
    return { error: "invalid" };
  }
  const path = `/organizations/${organizationId}/projects/${projectId}/evidence-analyses/${analysisId}`;
  if (intent === "reanalyze") {
    return {
      intent,
      section: "evidence",
      method: "POST",
      path: `${path}/reanalyze`,
      body: { version },
    };
  }
  if (intent === "decide") {
    const decision = oneOf(fields.decision, [
      "ACCEPTED",
      "OVERRIDDEN",
    ] as const);
    const note = (fields.note ?? "").trim();
    const reviewPath = `/organizations/${organizationId}/projects/${projectId}/evidence-reviews/${analysisId}/decide`;
    if (decision === "ACCEPTED") {
      if (note.length > 1000 || CREDENTIAL.test(note)) {
        return { error: "invalid" };
      }
      return {
        intent,
        section: "evidence",
        method: "POST",
        path: reviewPath,
        body: { version, decision, note },
      };
    }
    const conclusion = oneOf(fields.conclusion, CONCLUSIONS);
    if (
      decision === null ||
      conclusion === null ||
      note.length < 3 ||
      note.length > 1000 ||
      CREDENTIAL.test(note)
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: "evidence",
      method: "POST",
      path: reviewPath,
      body: { version, decision, conclusion, note },
    };
  }
  if (intent === "confirm") {
    const kind = oneOf(fields.kind, EVIDENCE_KINDS);
    const note = (fields.note ?? "").trim();
    if (kind === null || note.length > 500 || CREDENTIAL.test(note)) {
      return { error: "invalid" };
    }
    return {
      intent,
      section: "evidence",
      method: "POST",
      path: `${path}/confirm`,
      body: { version, kind, note },
    };
  }
  return { error: "invalid" };
}

export type AnalysisNotice =
  | "classified"
  | "reading"
  | "analysis-changed"
  | "signed-off"
  | "review-changed"
  | "ocr-saved"
  | "ocr-changed"
  | "denied"
  | "invalid"
  | "unavailable";

export function analysisNoticeFor(
  intent: AnalysisIntent,
  status: number,
): AnalysisNotice {
  if (intent === "decide") {
    return status === 200
      ? "signed-off"
      : status === 409
        ? "review-changed"
        : status === 403 || status === 404
          ? "denied"
          : status === 422
            ? "invalid"
            : "unavailable";
  }
  if (status === 200) {
    return intent === "confirm"
      ? "classified"
      : intent === "reanalyze"
        ? "reading"
        : "ocr-saved";
  }
  if (status === 409) {
    return intent === "ocr-engine" ? "ocr-changed" : "analysis-changed";
  }
  if (status === 403 || status === 404) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}
