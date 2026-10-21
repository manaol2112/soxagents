// The independent review of a control instance (Milestone 9.1): the agent's
// re-performance, the review notes, and the reviewer's sign-off.

import {
  type CancelState,
  parseCancelState,
  parseRunState,
  type RunState,
} from "./run-state.ts";

export type NoteSeverity = "MUST_FIX" | "SHOULD_FIX" | "OBSERVATION";
export type NoteStatus =
  | "PROPOSED"
  | "OPEN"
  | "RESPONDED"
  | "CLEARED"
  | "DISMISSED"
  | "WITHDRAWN";
export type NoteTarget =
  | "RESULT"
  | "SAMPLE"
  | "WORKPAPER"
  | "DEFICIENCY"
  | "GENERAL";

export type ReviewCitation = {
  fileId: string;
  fileName: string;
  quote: string;
  found: boolean;
  location: string;
  page: number | null;
};

export type ReviewNote = {
  id: string;
  number: number;
  targetKind: NoteTarget;
  /** The item, attribute indexes, and workpaper the note is about. */
  itemId: string | null;
  indexes: number[];
  workpaperId: string | null;
  reviewerResult: string | null;
  citations: ReviewCitation[];
  text: string;
  severity: NoteSeverity;
  status: NoteStatus;
  raisedBy: "AGENT" | "PERSON";
  raisedByName: string | null;
  raisedAt: string;
  decidedByName: string | null;
  decisionReason: string;
  response: string;
  respondedByName: string | null;
  respondedAt: string | null;
  clearedByName: string | null;
  clearedAt: string | null;
  clearReason: string;
  reopened: string[];
  version: number;
};

export type ControlReview = {
  id: string;
  controlId: string;
  controlRef: string;
  label: string;
  /** The testing round this review covers (roll-forward or retest), or null for the
   * control's own review of its interim testing (workflow integrity W2). */
  testRoundId?: string | null;
  roundKind?: "ROLLFORWARD" | "RETEST" | null;
  /** What a signed review covered: the sheet and its version, the round, the workpaper
   * versions. A prior review never covers later work. */
  coverage?: Record<string, unknown>;
  status: "OPEN" | "SIGNED_OFF";
  reperforming: boolean;
  reperformState: RunState;
  reperformedAt: string | null;
  /** FALLBACK: the rules' checks stand; the model did not re-perform the items. */
  reperformSource: "MODEL" | "RULES" | "FALLBACK" | null;
  reperformNote: string;
  cancelState?: CancelState;
  sheetStatus: string | null;
  sheetSignedBy: string | null;
  sheetVersion: number | null;
  sheetVersionReviewed: number | null;
  workpapers: Array<{
    id: string;
    stage: string;
    status: string;
    preparedBy: string | null;
  }>;
  notes: ReviewNote[];
  counts: Record<string, number>;
  blocking: string[];
  viewerIsReviewer: boolean;
  viewerPrepared: boolean;
  /** False only in development: a preparer may then review their own work. */
  independenceRequired: boolean;
  signedBy: string | null;
  signedAt: string | null;
  signoffNote: string;
  version: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const maybe = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const SEVERITIES: NoteSeverity[] = ["MUST_FIX", "SHOULD_FIX", "OBSERVATION"];
const STATUSES: NoteStatus[] = [
  "PROPOSED",
  "OPEN",
  "RESPONDED",
  "CLEARED",
  "DISMISSED",
  "WITHDRAWN",
];
const TARGETS: NoteTarget[] = [
  "RESULT",
  "SAMPLE",
  "WORKPAPER",
  "DEFICIENCY",
  "GENERAL",
];

function parseNote(value: unknown): ReviewNote | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  const target = isRecord(value.target) ? value.target : {};
  const severity = SEVERITIES.find((item) => item === value.severity);
  const status = STATUSES.find((item) => item === value.status);
  const kind = TARGETS.find((item) => item === value.target_kind);
  if (
    severity === undefined ||
    status === undefined ||
    kind === undefined ||
    typeof value.raised_at !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    number: num(value.number),
    targetKind: kind,
    itemId: maybe(target.item_id),
    indexes: Array.isArray(target.indexes)
      ? target.indexes.filter(
          (item): item is number => typeof item === "number",
        )
      : [],
    workpaperId: maybe(target.workpaper_id),
    reviewerResult: maybe(target.reviewer_result),
    citations: (Array.isArray(target.citations) ? target.citations : [])
      .filter(isRecord)
      .map((item) => ({
        fileId: str(item.file_id),
        fileName: str(item.file_name),
        quote: str(item.quote),
        found: item.found === true,
        location: str(item.location),
        page: typeof item.page === "number" ? item.page : null,
      })),
    text: str(value.text),
    severity,
    status,
    raisedBy: value.raised_by === "PERSON" ? "PERSON" : "AGENT",
    raisedByName: maybe(value.raised_by_name),
    raisedAt: value.raised_at,
    decidedByName: maybe(value.decided_by_name),
    decisionReason: str(value.decision_reason),
    response: str(value.response),
    respondedByName: maybe(value.responded_by_name),
    respondedAt: maybe(value.responded_at),
    clearedByName: maybe(value.cleared_by_name),
    clearedAt: maybe(value.cleared_at),
    clearReason: str(value.clear_reason),
    reopened: Array.isArray(value.reopened)
      ? value.reopened.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    version: num(value.version) || 1,
  };
}

export function parseReviews(value: unknown): ControlReview[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const reviews: ControlReview[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.control_id !== "string"
    ) {
      return null;
    }
    reviews.push({
      id: item.id,
      controlId: item.control_id,
      controlRef: str(item.control_ref),
      label: str(item.label) || str(item.control_ref),
      testRoundId: maybe(item.test_round_id),
      roundKind:
        item.round_kind === "ROLLFORWARD" || item.round_kind === "RETEST"
          ? item.round_kind
          : null,
      coverage: isRecord(item.coverage) ? item.coverage : {},
      status: item.status === "SIGNED_OFF" ? "SIGNED_OFF" : "OPEN",
      reperforming: item.reperforming === true,
      reperformState: parseRunState(
        item.reperform_state,
        item.reperforming === true,
      ),
      reperformedAt: maybe(item.reperformed_at),
      reperformSource:
        item.reperform_source === "MODEL" ||
        item.reperform_source === "RULES" ||
        item.reperform_source === "FALLBACK"
          ? item.reperform_source
          : null,
      reperformNote: str(item.reperform_note),
      cancelState: parseCancelState(item.cancel_state),
      sheetStatus: maybe(item.sheet_status),
      sheetSignedBy: maybe(item.sheet_signed_by),
      sheetVersion:
        typeof item.sheet_version === "number" ? item.sheet_version : null,
      sheetVersionReviewed:
        typeof item.sheet_version_reviewed === "number"
          ? item.sheet_version_reviewed
          : null,
      workpapers: (Array.isArray(item.workpapers) ? item.workpapers : [])
        .filter(isRecord)
        .map((paper) => ({
          id: str(paper.id),
          stage: str(paper.stage),
          status: str(paper.status),
          preparedBy: maybe(paper.prepared_by),
        })),
      notes: (Array.isArray(item.notes) ? item.notes : [])
        .map(parseNote)
        .filter((note): note is ReviewNote => note !== null),
      counts: isRecord(item.counts)
        ? Object.fromEntries(
            Object.entries(item.counts).map(([key, count]) => [
              key,
              num(count),
            ]),
          )
        : {},
      blocking: Array.isArray(item.blocking)
        ? item.blocking.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [],
      viewerIsReviewer: item.viewer_is_reviewer === true,
      viewerPrepared: item.viewer_prepared === true,
      independenceRequired: item.independence_required !== false,
      signedBy: maybe(item.signed_by),
      signedAt: maybe(item.signed_at),
      signoffNote: str(item.signoff_note),
      version: num(item.version) || 1,
    });
  }
  return reviews;
}

/** The control's own review (of its interim testing); a round's review never stands
 * for it. */
export function reviewFor(
  reviews: ControlReview[] | null,
  controlId: string,
): ControlReview | null {
  return (
    reviews?.find(
      (review) =>
        review.controlId === controlId && (review.testRoundId ?? null) === null,
    ) ?? null
  );
}

/** The reviews of the control's testing rounds, in the order they opened. */
export function roundReviewsFor(
  reviews: ControlReview[] | null,
  controlId: string,
): ControlReview[] {
  return (reviews ?? []).filter(
    (review) =>
      review.controlId === controlId && (review.testRoundId ?? null) !== null,
  );
}

/** Notes that still need someone: the reviewer's decision, an answer, or clearing. */
export function openNotes(review: ControlReview): ReviewNote[] {
  return review.notes.filter(
    (note) =>
      note.status === "PROPOSED" ||
      note.status === "OPEN" ||
      note.status === "RESPONDED",
  );
}

export const SEVERITY_LABEL: Record<NoteSeverity, string> = {
  MUST_FIX: "Must fix",
  SHOULD_FIX: "Should fix",
  OBSERVATION: "Observation",
};

export const NOTE_STATUS_LABEL: Record<NoteStatus, string> = {
  PROPOSED: "Proposed by the reviewer agent",
  OPEN: "Open",
  RESPONDED: "Answered",
  CLEARED: "Cleared",
  DISMISSED: "Dismissed",
  WITHDRAWN: "Withdrawn",
};

export const TARGET_LABEL: Record<NoteTarget, string> = {
  RESULT: "Test result",
  SAMPLE: "Sample",
  WORKPAPER: "Workpaper",
  DEFICIENCY: "Deficiency",
  GENERAL: "General",
};

// Writes

export type ReviewIntent =
  | "reperform"
  | "note"
  | "accept"
  | "dismiss"
  | "respond"
  | "clear"
  | "return"
  | "sign-off"
  | "reopen"
  | "coverage";

export type ReviewWrite =
  | { error: "invalid" }
  | {
      intent: ReviewIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/i;

export function reviewWrite(fields: Record<string, string>): ReviewWrite {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const reviewId = fields.review_id ?? "";
  const noteId = fields.note_id ?? "";
  const intent = fields.intent ?? "";
  const controlId = UUID.test(fields.control_id ?? "")
    ? (fields.control_id ?? null)
    : null;
  const raw = fields.version ?? "";
  if (
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !UUID.test(reviewId) ||
    !/^\d{1,6}$/.test(raw) ||
    Number(raw) < 1
  ) {
    return { error: "invalid" };
  }
  const version = Number(raw);
  const base = `/organizations/${organizationId}/projects/${projectId}/reviews/${reviewId}`;
  const reason = (fields.reason ?? "").trim();
  const text = (fields.text ?? "").trim();
  const plain = (value: string, limit: number) =>
    value.length <= limit && !CREDENTIAL.test(value);
  if (!plain(reason, 500) || !plain(text, 2000)) {
    return { error: "invalid" };
  }
  if (intent === "reperform") {
    return { intent, path: `${base}/reperform`, body: { version }, controlId };
  }
  if (intent === "sign-off") {
    if (!plain(text, 1000)) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/sign-off`,
      body: { version, note: text },
      controlId,
    };
  }
  if (intent === "reopen") {
    if (reason.length < 3) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/reopen`,
      body: { version, reason },
      controlId,
    };
  }
  if (intent === "coverage") {
    // A qualified reviewer's documented coverage assessment of a signed review (W3
    // follow-up): COVERS or REQUIRES_REVIEW, with why. The API checks the role again.
    const decision = fields.decision ?? "";
    if (
      (decision !== "COVERS" && decision !== "REQUIRES_REVIEW") ||
      reason.length < 3
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/coverage`,
      body: { version, decision, rationale: reason },
      controlId,
    };
  }
  if (intent === "note") {
    const severity = SEVERITIES.find((item) => item === fields.severity);
    const kind = TARGETS.find((item) => item === fields.target_kind);
    const itemId = fields.item_id ?? "";
    const workpaperId = fields.workpaper_id ?? "";
    if (
      text.length < 3 ||
      severity === undefined ||
      kind === undefined ||
      (itemId !== "" && !UUID.test(itemId)) ||
      (workpaperId !== "" && !UUID.test(workpaperId))
    ) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/notes`,
      body: {
        version,
        target_kind: kind,
        severity,
        text,
        item_id: itemId === "" ? null : itemId,
        workpaper_id: workpaperId === "" ? null : workpaperId,
      },
      controlId,
    };
  }
  if (!UUID.test(noteId)) {
    return { error: "invalid" };
  }
  const note = `${base}/notes/${noteId}`;
  if (intent === "accept" || intent === "dismiss") {
    if (intent === "dismiss" && reason.length < 3) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${note}/decide`,
      body: { version, action: intent.toUpperCase(), reason },
      controlId,
    };
  }
  if (intent === "respond") {
    if (text.length < 3) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${note}/respond`,
      body: { version, response: text },
      controlId,
    };
  }
  if (intent === "clear" || intent === "return") {
    if (intent === "return" && reason.length < 3) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${note}/clear`,
      body: { version, action: intent.toUpperCase(), reason },
      controlId,
    };
  }
  return { error: "invalid" };
}

export type ReviewNotice =
  | "review-reperform"
  | "review-noted"
  | "review-accepted"
  | "review-dismissed"
  | "review-responded"
  | "review-cleared"
  | "review-returned"
  | "review-signed"
  | "review-reopened"
  | "review-covered"
  | "review-blocked"
  | "review-denied"
  | "review-invalid"
  | "review-unavailable";

export const REVIEW_NOTICES: Record<ReviewNotice, string> = {
  "review-reperform":
    "The reviewer agent is re-performing the testing. Its notes appear when it finishes.",
  "review-noted":
    "Review note raised. A must-fix note reopens the testing or the workpaper it is about.",
  "review-accepted": "Note accepted. It is open for the preparer to address.",
  "review-dismissed": "Note dismissed. Your reason is recorded.",
  "review-responded":
    "Your answer is recorded. The reviewer clears or returns the note.",
  "review-cleared": "Note cleared.",
  "review-returned":
    "Note returned to the preparer with what is still missing.",
  "review-signed": "Review signed off. The control is concluded.",
  "review-reopened": "The review is open again.",
  "review-covered": "The coverage assessment is recorded on the review.",
  "review-blocked":
    "That could not be done yet: the review changed, notes are still open, or the work is not ready for review. Refresh and check what is left.",
  "review-denied":
    "Only a team member with the reviewer role, who did not prepare the work, can do this.",
  "review-invalid":
    "Check the fields. A reason is needed to dismiss or return a note.",
  "review-unavailable": "That could not be saved. Try again.",
};

const DONE: Record<ReviewIntent, ReviewNotice> = {
  reperform: "review-reperform",
  note: "review-noted",
  accept: "review-accepted",
  dismiss: "review-dismissed",
  respond: "review-responded",
  clear: "review-cleared",
  return: "review-returned",
  "sign-off": "review-signed",
  reopen: "review-reopened",
  coverage: "review-covered",
};

export function reviewNoticeFor(
  intent: ReviewIntent,
  status: number,
): ReviewNotice {
  if (status === 200) {
    return DONE[intent];
  }
  if (status === 409) {
    return "review-blocked";
  }
  if (status === 403 || status === 404) {
    return "review-denied";
  }
  if (status === 422) {
    return "review-invalid";
  }
  return "review-unavailable";
}

export function parseReviewNotice(value: string | null): ReviewNotice | null {
  return (
    (Object.keys(REVIEW_NOTICES) as ReviewNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
