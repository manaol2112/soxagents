// The independent review of a control instance (Milestone 9.1): the agent's
// re-performance, the review notes, and the reviewer's sign-off.

import { failureNoteOf, plainNote } from "./run-failure.ts";
import {
  type CancelState,
  parseCancelState,
  parseRunState,
  type RunState,
} from "./run-state.ts";

/** The review's one sentence when the agent's re-performance ended without a usable
 * answer, or null while it works, when it finished, or once the review is signed off: why
 * (the server's failure sentence, else its note), that the testing stands as the preparer
 * left it, and "Re-perform", the step's action beside it. A signed review is not a failure
 * to act on (the server says no failure note over it either, reperform_failure_note):
 * decided here from the typed status for every reader, the review's banner and the
 * reviewer lane (code review, 20 November 2026; before, a signed review whose last
 * re-performance gave up still said "Re-perform to try again" beside "Reviewed"). */
export function runFailureLine(
  review: Pick<
    ControlReview,
    | "status"
    | "reperforming"
    | "reperformState"
    | "reperformNote"
    | "failureNote"
    | "reperformance"
  >,
  failureNote: string = review.failureNote ?? "",
): string | null {
  if (
    review.status === "SIGNED_OFF" ||
    review.reperforming ||
    review.reperformState !== "IDLE"
  ) {
    return null;
  }
  const said = plainNote(failureNote);
  if (said !== "") {
    return said;
  }
  // The typed record says a re-performance gave up (control_reviews.fail_reperformance,
  // FO-1, 19 November 2026); before, the note's wording was matched.
  if (review.reperformance?.failed !== true) {
    return null;
  }
  return (
    plainNote(review.reperformNote) ||
    "The re-performance did not finish, so the testing stands as the preparer left it. Re-perform to try again."
  );
}

/** The one banner the review card shows about the agent's re-performance, or null: the
 * failure line as a warning while there is a failure to act on (runFailureLine), else the
 * run's own note as information, never a note from a run that gave up. A failed run's note
 * ("Re-perform to try again") is a failure, not information, so it is not shown over a
 * signed review or while the agent re-performs again. Decided here from the typed status
 * and record for every reader (code review, 20 November 2026; before, the view showed the
 * raw note on its own condition, so a signed review over a failed run said "Re-perform to
 * try again" as information beside "Reviewed"). */
export type ReviewBanner = { tone: "warning" | "info"; text: string };

export function reviewBanner(
  review: Pick<
    ControlReview,
    | "status"
    | "reperforming"
    | "reperformState"
    | "reperformNote"
    | "failureNote"
    | "reperformance"
  >,
): ReviewBanner | null {
  const failure = runFailureLine(review);
  if (failure !== null) {
    return { tone: "warning", text: failure };
  }
  if (review.reperformance?.failed === true) {
    return null;
  }
  const note = plainNote(review.reperformNote);
  return note === "" ? null : { tone: "info", text: note };
}

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

/** The reviewer agent's last re-performance as its run recorded it (FO-1, UH-9): the
 * items due on the sheet it read, those it re-performed, whether it stopped at its cap,
 * notes past the note limit, and whether a later attempt gave up. `known` is false for a
 * review re-performed before the record was kept. */
export type Reperformance = {
  known: boolean;
  source: string | null;
  due: number;
  done: number;
  capped: boolean;
  dropped: number;
  failed: boolean;
};

export function parseReperformance(value: unknown): Reperformance | null {
  if (!isRecord(value)) {
    return null;
  }
  const count = (entry: unknown) =>
    typeof entry === "number" && Number.isInteger(entry) && entry >= 0
      ? entry
      : 0;
  return {
    known: value.known === true,
    source: typeof value.source === "string" ? value.source : null,
    due: count(value.due),
    done: count(value.done),
    capped: value.capped === true,
    dropped: count(value.dropped),
    failed: value.failed === true,
  };
}

/** What the reviewer agent's re-performance did, said once from its typed record
 * (FO-26, 19 November 2026): nothing, part of the items, or all of them with or without
 * differences. Before, "no differences" was said whenever a re-performance had run, also
 * when the model re-performed nothing. */
export function reperformedWords(
  record: Reperformance | null | undefined,
  source: ControlReview["reperformSource"],
  differences: number,
): string {
  const found =
    differences === 0
      ? "no differences from the preparer's results"
      : `${differences} difference${differences === 1 ? "" : "s"} from the preparer's results`;
  if (source === "SEEDED") {
    return `Re-performed the testing: ${found}`;
  }
  if (record === null || record === undefined || !record.known) {
    return "The reviewer agent's re-performance has no record of the items it re-performed";
  }
  // The last attempt gave up (fail_reperformance): said as the banner says it, never as
  // the earlier run's count (code review, 20 November 2026; before, "Re-performed 1 of 3
  // items" stood above "The re-performance did not finish").
  if (record.failed) {
    return "The re-performance did not finish";
  }
  if (record.due === 0) {
    return "No tested item with evidence to re-perform";
  }
  if (record.done === 0) {
    // The banner's words (control_reviews.not_reperformed): "the items", one word for
    // one meaning (design review, 20 November 2026; before, "the testing").
    return "The reviewer agent did not re-perform the items";
  }
  if (record.done < record.due) {
    return `Re-performed ${record.done} of ${record.due} items: ${found}`;
  }
  return `Re-performed the testing: ${found}`;
}

/** The result notes where the reviewer agent's result differs from the preparer's and
 * still stands: the differences `reperformedWords` counts. One count for the review's
 * header and the reviewer lane. */
export function reviewDifferences(notes: readonly ReviewNote[]): number {
  return notes.filter(
    (note) =>
      note.targetKind === "RESULT" &&
      note.reviewerResult !== null &&
      note.status !== "DISMISSED" &&
      note.status !== "WITHDRAWN",
  ).length;
}

/** What an open review's sign-off still waits for from the re-performance, from the
 * server's typed `attestationNeeded` and the run record (design review, 20 November
 * 2026): before, the pill said "Ready to sign off" over a partial or failed
 * re-performance whose sign-off needs the reviewer's record by hand. A last attempt that
 * gave up holds it whatever the earlier run did, as the server's run_lets_sign withholds
 * "Sign off the review" from the queue (code review, 20 November 2026; before, a failure
 * after a full run read "Ready to sign off"). Null when the re-performance holds nothing.
 * The run's own words are the banner's and the header's (`reperformedWords`), so the
 * sign-off form does not repeat them. */
export function reperformHold(
  review: Pick<ControlReview, "attestationNeeded" | "reperformance">,
): string | null {
  if (review.reperformance?.failed === true) {
    return "Re-performance did not finish";
  }
  return review.attestationNeeded === true ? "Re-perform needed" : null;
}

/** The review header's pill: its words and tone, from the review's typed state. */
export function reviewPill(
  review: Pick<
    ControlReview,
    "status" | "reperforming" | "attestationNeeded" | "reperformance"
  >,
  {
    waiting,
    outstanding,
    unavailable,
  }: { waiting: number; outstanding: boolean; unavailable: boolean },
): { words: string; tone: "" | "tone-warning" | "tone-success" } {
  if (review.status === "SIGNED_OFF") {
    return outstanding
      ? { words: REVIEW_OUTSTANDING, tone: "tone-warning" }
      : { words: "Reviewed", tone: "tone-success" };
  }
  if (review.reperforming) {
    return {
      words: unavailable
        ? "Re-performance queued · automation unavailable"
        : "Re-performing",
      tone: waiting > 0 ? "tone-warning" : "",
    };
  }
  if (waiting > 0) {
    return { words: "Notes open", tone: "tone-warning" };
  }
  const hold = reperformHold(review);
  return hold === null
    ? { words: "Ready to sign off", tone: "" }
    : { words: hold, tone: "tone-warning" };
}

/** The shortest sign-off note over a re-performance by hand (control_reviews.MIN_ATTESTATION). */
export const ATTESTATION_MIN = 10;

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
  /** FALLBACK: the rules' checks stand; the reviewer agent did not re-perform the items. */
  reperformSource: "MODEL" | "RULES" | "FALLBACK" | "SEEDED" | null;
  reperformNote: string;
  /** The server's failure sentence for a re-performance that ended without a usable
   * answer (run-failure.ts); absent otherwise. */
  failureNote?: string;
  /** The last re-performance's typed record, or null when the server sent none. */
  reperformance?: Reperformance | null;
  /** Signing needs the reviewer's record of a re-performance by hand (FO-1). */
  attestationNeeded?: boolean;
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
        item.reperform_source === "FALLBACK" ||
        item.reperform_source === "SEEDED"
          ? item.reperform_source
          : null,
      reperformNote: str(item.reperform_note),
      ...(failureNoteOf(item) !== ""
        ? { failureNote: failureNoteOf(item) }
        : {}),
      reperformance: parseReperformance(item.reperformance),
      attestationNeeded: item.attestation_needed === true,
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

/** Where the Review step's decision line lands: the reopen form on the control's own
 * review, and its coverage form. Each holds a `data-arrive` control that takes focus. */
export const REVIEW_REOPEN_ANCHOR = "cw-review-reopen";
export const REVIEW_COVERAGE_ANCHOR = "cw-review-coverage";

/** The Review step's status while a reason holds a signed review (design review, 19
 * November 2026: "Signed off" and "Nothing is needed from you here" beside "review
 * outstanding" said two things at once). */
export const REVIEW_OUTSTANDING = "Review outstanding";

/** What holds the control's own signed review, from the typed reasons (never their
 * wording): `reopen` where only a review signed again clears it, `coverage` where a
 * reviewer's coverage assessment can; and whether the viewer can act on it now. */
export type ReviewHold = {
  reason: string;
  clears: "reopen" | "coverage";
  viewerActs: boolean;
};

/** Whether the viewer may record a coverage assessment on a signed review: its reviewer,
 * independent of the work where independence is required (the API checks it again). */
export function mayAssessCoverage(
  review: Pick<
    ControlReview,
    "viewerIsReviewer" | "viewerPrepared" | "independenceRequired"
  >,
  canAct: boolean,
): boolean {
  return (
    canAct &&
    review.viewerIsReviewer &&
    (!review.viewerPrepared || !review.independenceRequired)
  );
}

/** The hold on the control's own signed review, or null where none stands. A reason only a
 * review signed again clears comes first: reopening clears a coverage gap with it, and a
 * coverage assessment never clears that reason. */
export function reviewHoldOf(input: {
  signed: boolean;
  /** control.reviewHeldBy: the first reason a coverage assessment does not clear. */
  held: string;
  /** coverageGapsOf(control).control: the gap a coverage assessment answers. */
  gap: string;
  review: Pick<
    ControlReview,
    "viewerIsReviewer" | "viewerPrepared" | "independenceRequired"
  > | null;
  canAct: boolean;
}): ReviewHold | null {
  if (!input.signed) {
    return null;
  }
  const review = input.review;
  if (input.held !== "") {
    return {
      reason: input.held,
      clears: "reopen",
      // The reopen form's own condition (ReviewTab): the signed review's reviewer.
      viewerActs: input.canAct && review?.viewerIsReviewer === true,
    };
  }
  if (input.gap !== "") {
    return {
      reason: input.gap,
      clears: "coverage",
      viewerActs: review !== null && mayAssessCoverage(review, input.canAct),
    };
  }
  return null;
}

/** The reviewer agent's task chip on the Independent review row, or none while a hold
 * stands (design review, 19 November 2026, fix first: "Independent reviewer · Complete"
 * under "Needs attention" read as the review being both complete and outstanding). The
 * agent's re-performance stays under the step and in AI activity. */
export function reviewRowTask<T>(
  task: T | undefined,
  hold: ReviewHold | null,
): T | undefined {
  return hold === null ? task : undefined;
}

/** What a signed review's coverage card says (coverage-form.tsx). `said` is true where the
 * Review step's decision line already gives the reason and how it clears (the control's
 * own review while its hold stands): the card then gives only the version it covered and
 * the form, never the same two sentences again (design review, 19 November 2026, fix
 * first). A round's review has no decision line, so its card says both. */
export function coverageCardOf(input: {
  /** review.coverage.sheet_version: a number where the version was recorded. */
  covered: unknown;
  gap: string;
  held: string;
  said: boolean;
}): { state: string; offered: boolean; remedy: boolean } {
  const reason = input.held !== "" ? input.held : input.gap;
  const version =
    typeof input.covered === "number"
      ? `Signed off against testing version ${input.covered}.`
      : "The version this review covered was not recorded.";
  const tail =
    reason === ""
      ? " Nothing has changed since."
      : input.said
        ? ""
        : ` ${reason}.`;
  return {
    state: `${version}${tail}`,
    // A reason a coverage assessment does not clear comes first (reviewHoldOf):
    // reopening clears a gap with it, so the form is offered only where it clears what
    // holds the review.
    offered: input.gap !== "" && input.held === "",
    remedy: reason !== "" && !input.said,
  };
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
    // A sign-off over a re-performance by hand says what was re-performed (FO-1): at
    // least ATTESTATION_MIN characters, as the server's sign-off checks.
    const byHand = fields.reperformed_by_hand === "on";
    if (byHand && text.length < ATTESTATION_MIN) {
      return { error: "invalid" };
    }
    return {
      intent,
      path: `${base}/sign-off`,
      body: byHand
        ? { version, note: text, reperformed_by_hand: true }
        : { version, note: text },
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
