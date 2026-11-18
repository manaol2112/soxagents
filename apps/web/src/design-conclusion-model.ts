/**
 * The D&I conclusion a reviewer signs (product owner, 8 November 2026; the API's
 * design_conclusions.py, migration 0143). The records propose the verdict once the design
 * workpaper is prepared; a reviewer who did not prepare it signs that verdict off, and OE is
 * cleared only by an effective one. This shapes the API's body for the page and builds the
 * writes.
 */

import { DW_SECTION } from "./design-workpaper-sections.ts";
import {
  defaultReviewerOf,
  type LastReturn,
  lastReturnOf,
  type ReviewerOption,
  type ReviewRequest,
  reviewersOf,
  reviewFlowOf,
  reviewRequestOf,
} from "./review-request-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type DesignVerdict = "EFFECTIVE" | "NOT_EFFECTIVE";
export type DesignConclusionStatus =
  | "NOT_READY"
  | "TO_SIGN"
  | "SIGNED_OFF"
  | "OUT_OF_DATE";

/** The preparer's conclusion (docs/design-workpaper.md, section 3.6;
 * design_conclusions.DesignConclusionKind). The first four can be signed off. */
export const CONCLUSION_KINDS = [
  "EFFECTIVE",
  "EXCEPTIONS_NOTED",
  "NOT_EFFECTIVE",
  "NO_INSTANCE",
  "NOT_CONCLUDED",
] as const;
export type ConclusionKind = (typeof CONCLUSION_KINDS)[number];
export type SignedKind = Exclude<ConclusionKind, "NOT_CONCLUDED">;
/** What a conclusion of "Not effective" rests on. */
export const CONCLUSION_BASES = ["DESIGN", "IMPLEMENTATION", "BOTH"] as const;
export type ConclusionBasis = (typeof CONCLUSION_BASES)[number];
/** The design or the implementation result of the control (section 3.6). */
export type ResultKind = "IN_PLACE" | "DESIGNED" | "EXCEPTIONS" | "OPEN";

/** The contract's words for each conclusion, exactly. */
export const CONCLUSION_WORDS: Readonly<Record<ConclusionKind, string>> = {
  EFFECTIVE: "Effective",
  EXCEPTIONS_NOTED: "Exceptions noted",
  NOT_EFFECTIVE: "Not effective",
  NO_INSTANCE: "Design effective, no instance to walk through",
  NOT_CONCLUDED: "Not concluded",
};

/** The contract's words for what a conclusion of "Not effective" rests on. */
export const BASIS_WORDS: Readonly<Record<ConclusionBasis, string>> = {
  DESIGN: "Design",
  IMPLEMENTATION: "Implementation",
  BOTH: "Design and implementation",
};

/** The preparer's conclusion that stands (`choice`). `reason` is the person's own text,
 * shown as text; `recordedBy` the name the server gives, "" where none. */
export type ConclusionChoice = {
  id: string;
  kind: ConclusionKind;
  basis: ConclusionBasis | null;
  reason: string;
  proposedKind: ConclusionKind | null;
  recordedBy: string;
  recordedAt: string;
  workpaperVersion: number | null;
};

/** The design or the implementation result, with the server's sentence and the letters
 * of the attributes not yet settled for it. */
export type ConclusionResult = {
  result: ResultKind;
  sentence: string;
  open: string[];
};

export type DesignSignoff = {
  id: string;
  verdict: DesignVerdict;
  /** The conclusion the reviewer signed (section 3.6); null where the server does not
   * say, or says a kind this page does not know (then only `verdict` is read). */
  conclusion: SignedKind | null;
  /** The server names a conclusion on the sign-off that this page cannot read: a kind
   * it does not know, or one that disagrees with `verdict`. It is then said as "Not
   * stated", never by its verdict as effective. */
  conclusionUnread: boolean;
  basis: ConclusionBasis | null;
  reason: string;
  workpaperVersion: number;
  deficiencies: string[];
  signedBy: string;
  signedAt: string;
  note: string;
  reopenedAt: string | null;
  reopenedBy: string;
  reopenReason: string;
  reopenedFrom: "PERSON" | "WORKPAPER" | "SUPERSEDED" | null;
};

/** An exception a person recorded on an attribute (a tickmark of kind EXCEPTION) that
 * the design workpaper reads, as the server lists it (`exceptions`). */
export type RecordedException = {
  attributeId: string;
  /** The attribute's letter. */
  code: string;
  requirementId: string;
  recordedBy: string;
  recordedAt: string;
  reason: string;
  /** Whether its request's check is current. True where the server does not say: it
   * lists the exceptions standing on a current check. */
  checkCurrent: boolean;
};

export type DesignConclusion = {
  controlId: string;
  status: DesignConclusionStatus;
  proposed: DesignVerdict | null;
  workpaper: {
    id: string;
    status: string;
    preparedBy: string;
    preparedVersion: number | null;
  } | null;
  deficiencies: Array<{ reference: string; title: string; status: string }>;
  signed: DesignSignoff | null;
  outOfDate: string[];
  blocking: string[];
  /** The exceptions a person recorded; empty where the server sends none, or does not
   * send the list at all. It decides nothing here: `blocking` says what holds. */
  exceptions: RecordedException[];
  viewerIsReviewer: boolean;
  viewerPrepared: boolean;
  /** The viewer recorded the standing conclusion (section 3.6, "Tightened after the
   * independent review"): where independence is required they cannot sign it. */
  viewerRecorded: boolean;
  independenceRequired: boolean;
  canSign: boolean;
  history: DesignSignoff[];
  /** The conclusion the records propose now, and why (section 3.6); null where the
   * server does not say, or says a kind this page does not know. */
  proposedConclusion: ConclusionKind | null;
  proposedReasons: string[];
  /** The preparer's conclusion that stands; null where none does, or where the server
   * sends one this page cannot read (an unknown kind is never read as effective). */
  choice: ConclusionChoice | null;
  /** The server sent a standing conclusion this page cannot read (a kind it does not
   * know, or no id): one stands, and it is never said as "none recorded". */
  choiceUnread: boolean;
  /** The body follows section 3.6: it names the conclusion (it carries
   * `proposed_conclusion` or `choice`). The two-value `proposed` is then never read for
   * the conclusion's words or tone; it is on a body from before 3.6 only. */
  namesConclusion: boolean;
  /** Whether the viewer may record the conclusion now: the server's word only. */
  canChoose: boolean;
  design: ConclusionResult | null;
  implementation: ConclusionResult | null;
  /** The body follows docs/design-workpaper.md section 3.8 (one D&I step: the preparer
   * sends the workpaper for review): it names the request, or that none stands. A body
   * from before it is read as before: the preparer prepares, a reviewer signs. */
  reviewFlow: boolean;
  /** The review request that stands; null where none does. */
  reviewRequest: ReviewRequest | null;
  /** The reviewer's last return to the preparer, with the reason; null where none. */
  lastReturn: LastReturn | null;
  /** Who the preparer may send it to, and who is shown but not offered, with why. */
  reviewers: ReviewerOption[];
  /** The reviewer the picker starts on, where the server names one. */
  defaultReviewerId: string | null;
  /** Who is reading: the body's `viewer_id` where the server sends it, else the session's
   * own user (load-engagement), so that the reviewer a request names is known without the
   * review notes' route, and never inferred from `can_sign` (which a hold makes false).
   * Null where neither is known. */
  viewerId: string | null;
  /** The server's word on whether the viewer may change the reviewer or remind them
   * (`can_manage_request`); null where the body does not carry it. */
  canManageRequest: boolean | null;
};

export const VERDICT_LABELS: Record<DesignVerdict, string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
};

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const verdictOf = (value: unknown): DesignVerdict | null =>
  value === "EFFECTIVE" || value === "NOT_EFFECTIVE" ? value : null;
const STATUSES: readonly DesignConclusionStatus[] = [
  "NOT_READY",
  "TO_SIGN",
  "SIGNED_OFF",
  "OUT_OF_DATE",
];

/** A conclusion's kind, or null for anything this page does not know. */
export function conclusionKindOf(value: unknown): ConclusionKind | null {
  return CONCLUSION_KINDS.find((kind) => kind === value) ?? null;
}

export function basisOf(value: unknown): ConclusionBasis | null {
  return CONCLUSION_BASES.find((basis) => basis === value) ?? null;
}

const RESULT_KINDS: readonly ResultKind[] = [
  "IN_PLACE",
  "DESIGNED",
  "EXCEPTIONS",
  "OPEN",
];

/** The design or the implementation result as the server sends it; null where it is
 * missing or of a kind this page does not know (never read as settled). */
export function conclusionResultOf(value: unknown): ConclusionResult | null {
  if (!isRaw(value)) {
    return null;
  }
  const result = RESULT_KINDS.find((kind) => kind === value.result);
  if (result === undefined) {
    return null;
  }
  return {
    result,
    sentence: text(value.sentence).trim().slice(0, 600),
    open: strings(value.open)
      .map((code) => code.trim().slice(0, 8))
      .filter((code) => code !== "")
      .slice(0, 240),
  };
}

/** The preparer's standing conclusion as the server sends it (`choice`); null where it
 * is missing, has no id, or a kind this page does not know. */
export function conclusionChoiceOf(value: unknown): ConclusionChoice | null {
  if (!isRaw(value) || typeof value.id !== "string") {
    return null;
  }
  const kind = conclusionKindOf(value.kind);
  if (kind === null || !UUID.test(value.id)) {
    return null;
  }
  return {
    id: value.id,
    kind,
    // A basis is only ever one of "Not effective".
    basis: kind === "NOT_EFFECTIVE" ? basisOf(value.basis) : null,
    reason: text(value.reason).trim().slice(0, 1000),
    proposedKind: conclusionKindOf(value.proposed_kind),
    recordedBy: text(value.recorded_by).trim().slice(0, 200),
    recordedAt: text(value.recorded_at).slice(0, 40),
    workpaperVersion:
      typeof value.workpaper_version === "number" &&
      Number.isInteger(value.workpaper_version)
        ? value.workpaper_version
        : null,
  };
}

function signoffOf(value: unknown): DesignSignoff | null {
  if (!isRaw(value) || typeof value.id !== "string") {
    return null;
  }
  const verdict = verdictOf(value.verdict);
  if (verdict === null || typeof value.workpaper_version !== "number") {
    return null;
  }
  const from = value.reopened_from;
  const signedKind = conclusionKindOf(value.conclusion);
  // The signed conclusion is read only where it agrees with the two-value verdict the
  // OE gate reads: an answer that disagrees with itself is read by its verdict alone.
  const conclusion: SignedKind | null =
    signedKind === null || signedKind === "NOT_CONCLUDED"
      ? null
      : (signedKind === "NOT_EFFECTIVE") === (verdict === "NOT_EFFECTIVE")
        ? signedKind
        : null;
  return {
    id: value.id,
    verdict,
    conclusion,
    conclusionUnread:
      conclusion === null &&
      value.conclusion !== undefined &&
      value.conclusion !== null,
    basis: conclusion === "NOT_EFFECTIVE" ? basisOf(value.basis) : null,
    reason: text(value.reason).trim().slice(0, 1000),
    workpaperVersion: value.workpaper_version,
    deficiencies: Array.isArray(value.deficiencies)
      ? value.deficiencies.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    signedBy: text(value.signed_by),
    signedAt: text(value.signed_at),
    note: text(value.signoff_note),
    reopenedAt:
      typeof value.reopened_at === "string" ? value.reopened_at : null,
    reopenedBy: text(value.reopened_by),
    reopenReason: text(value.reopen_reason),
    reopenedFrom:
      from === "PERSON" || from === "WORKPAPER" || from === "SUPERSEDED"
        ? from
        : null,
  };
}

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function parseDesignConclusion(
  value: unknown,
  /** The session's own user, where the page knows it: who is reading, unless the body
   * names them (`viewer_id`). */
  sessionUserId: string | null = null,
): DesignConclusion | null {
  if (!isRaw(value) || typeof value.control_id !== "string") {
    return null;
  }
  const status = STATUSES.find((item) => item === value.status);
  if (status === undefined) {
    return null;
  }
  const paper = value.workpaper;
  return {
    controlId: value.control_id,
    status,
    proposed: verdictOf(value.proposed),
    workpaper:
      isRaw(paper) && typeof paper.id === "string"
        ? {
            id: paper.id,
            status: text(paper.status),
            preparedBy: text(paper.prepared_by),
            preparedVersion:
              typeof paper.prepared_version === "number"
                ? paper.prepared_version
                : null,
          }
        : null,
    deficiencies: Array.isArray(value.deficiencies)
      ? value.deficiencies.filter(isRaw).map((item) => ({
          reference: text(item.reference),
          title: text(item.title),
          status: text(item.status),
        }))
      : [],
    signed: signoffOf(value.signed),
    outOfDate: strings(value.out_of_date),
    blocking: strings(value.blocking),
    exceptions: Array.isArray(value.exceptions)
      ? value.exceptions.filter(isRaw).map((item) => ({
          attributeId: text(item.attribute_id),
          code: text(item.code),
          requirementId: text(item.requirement_id),
          recordedBy: text(item.recorded_by_name),
          recordedAt: text(item.recorded_at),
          reason: text(item.reason),
          checkCurrent: item.check_current !== false,
        }))
      : [],
    viewerIsReviewer: value.viewer_is_reviewer === true,
    viewerPrepared: value.viewer_prepared === true,
    viewerRecorded: value.viewer_recorded === true,
    independenceRequired: value.independence_required !== false,
    canSign: value.can_sign === true,
    history: Array.isArray(value.history)
      ? value.history
          .map(signoffOf)
          .filter((item): item is DesignSignoff => item !== null)
      : [],
    proposedConclusion: conclusionKindOf(value.proposed_conclusion),
    proposedReasons: strings(value.proposed_reasons)
      .map((item) => item.trim().slice(0, 600))
      .filter((item) => item !== "")
      .slice(0, 12),
    choice: conclusionChoiceOf(value.choice),
    choiceUnread:
      isRaw(value.choice) && conclusionChoiceOf(value.choice) === null,
    namesConclusion: "proposed_conclusion" in value || "choice" in value,
    canChoose: value.can_choose === true,
    design: conclusionResultOf(value.design),
    implementation: conclusionResultOf(value.implementation),
    reviewFlow: reviewFlowOf(value),
    reviewRequest: reviewRequestOf(value.review_request),
    lastReturn: lastReturnOf(value.last_return),
    reviewers: reviewersOf(value.reviewers),
    defaultReviewerId: defaultReviewerOf(value.default_reviewer_id),
    viewerId:
      typeof value.viewer_id === "string" && UUID.test(value.viewer_id)
        ? value.viewer_id
        : sessionUserId !== null && UUID.test(sessionUserId)
          ? sessionUserId
          : null,
    canManageRequest:
      typeof value.can_manage_request === "boolean"
        ? value.can_manage_request
        : null,
  };
}

/** The server's sentence for a viewer who recorded the standing conclusion
 * (design_conclusions, tightened 15 November 2026), as the page shows it. */
export const RECORDED_BY_VIEWER =
  "You recorded this conclusion; another reviewer must sign it off.";

/** Why the viewer cannot sign, in the page's words; null when they can. */
export function signBlockedReason(conclusion: DesignConclusion): string | null {
  if (conclusion.canSign) {
    return null;
  }
  if (conclusion.status === "SIGNED_OFF") {
    return null;
  }
  if (conclusion.status === "NOT_READY") {
    return "The design workpaper is prepared first, in D&I Assessment.";
  }
  if (!conclusion.viewerIsReviewer) {
    return "A team member with the reviewer role signs off the D&I conclusion.";
  }
  if (conclusion.viewerPrepared && conclusion.independenceRequired) {
    return "The preparer of the design workpaper cannot sign off its conclusion. Another reviewer signs.";
  }
  if (conclusion.viewerRecorded && conclusion.independenceRequired) {
    // The server's own sentence, as the page shows it: said once with `blocking`'s.
    return RECORDED_BY_VIEWER;
  }
  return conclusion.blocking[0] ?? null;
}

/* The conclusion that stands (docs/design-workpaper.md, section 3.6) ------------------- */

/** A conclusion the server names that this page cannot read. */
export type StandingKind = ConclusionKind | "NOT_STATED";

/** In place of a conclusion's words: none is recorded, or the one on record is of a
 * kind this page does not know (never said as effective). */
export const NO_CONCLUSION_YET = "No conclusion recorded yet";
export const NO_CONCLUSION = "No conclusion recorded";
export const NOT_STATED = "Not stated";

/**
 * The conclusion the step speaks of, on a body that follows section 3.6: the one the
 * reviewer signed while the sign-off stands, otherwise the preparer's that stands.
 * `null` where none is recorded; "NOT_STATED" where one is, of a kind this page cannot
 * read; `undefined` on a body from before 3.6, which names none (its two-value verdict
 * is read as before). The two-value `proposed` is never read here: what the records
 * propose is not what anyone concluded.
 */
export function standingKind(
  conclusion: DesignConclusion,
): StandingKind | null | undefined {
  if (!conclusion.namesConclusion) {
    return undefined;
  }
  const chosen: StandingKind | null =
    conclusion.choice?.kind ?? (conclusion.choiceUnread ? "NOT_STATED" : null);
  const signed = conclusion.signed;
  if (conclusion.status !== "SIGNED_OFF" || signed === null) {
    return chosen;
  }
  if (signed.conclusion !== null) {
    return signed.conclusion;
  }
  if (signed.conclusionUnread) {
    return "NOT_STATED";
  }
  // A sign-off that names no conclusion: the preparer's that it signed, or the one
  // conclusion its verdict can only be; never "Effective" on the verdict alone.
  return (
    chosen ??
    (signed.verdict === "NOT_EFFECTIVE" ? "NOT_EFFECTIVE" : "NOT_STATED")
  );
}

/** The words of the conclusion that stands. */
export function standingWords(standing: StandingKind | null): string {
  return standing === null
    ? NO_CONCLUSION
    : standing === "NOT_STATED"
      ? NOT_STATED
      : CONCLUSION_WORDS[standing];
}

/** Whether a reviewer can be asked to sign the conclusion that stands: one of the four
 * that are signed, read by this page. */
export function signableKind(standing: StandingKind | null): SignedKind | null {
  return standing === null ||
    standing === "NOT_STATED" ||
    standing === "NOT_CONCLUDED"
    ? null
    : standing;
}

/** What the workflow and the step's strip read of a body that follows section 3.6
 * (control-workflow-model, step-panel-model): the conclusion that stands and what the
 * records propose. `undefined` on a body from before 3.6. */
export function namedConclusion(
  conclusion: DesignConclusion,
):
  | { standing: StandingKind | null; proposed: ConclusionKind | null }
  | undefined {
  const standing = standingKind(conclusion);
  return standing === undefined
    ? undefined
    : { standing, proposed: conclusion.proposedConclusion };
}

/** The server's fragment where no conclusion stands (design_conclusions.NO_CHOICE). The
 * step's card says it itself, with the way to section 7, wherever none is recorded. */
const NO_CHOICE = "the preparer has not recorded a conclusion";

/** What the server says of the workpaper and of a standing sign-off as fragments
 * (design_conclusions.py), in the page's own sentences: each is said once, and never as
 * a fragment beside its sentence. "" where the page already says it another way. A
 * sentence that is not listed here is shown as the server sent it: nothing it sends is
 * hidden. */
const BLOCKING_WORDS: Readonly<Record<string, string>> = {
  "the design workpaper is not prepared":
    "The design workpaper is prepared first, in D&I Assessment.",
  "the D&I conclusion is signed off": "",
  [NO_CHOICE]: "The preparer has not recorded a conclusion.",
  "the preparer's conclusion is “Not concluded”, which is never signed":
    "The preparer's conclusion is “Not concluded”, which is never signed off.",
  "log the design deficiency first":
    "A conclusion of “Not effective” is signed off once the design deficiency is logged.",
  "the preparer's conclusion was recorded after the design workpaper was prepared; reopen the workpaper and prepare it again":
    "The preparer's conclusion was recorded after the design workpaper was prepared. Reopen the workpaper and prepare it again.",
};

/**
 * Everything that holds the sign-off, each sentence once and whole, for every viewer:
 * the viewer's own reason first (signBlockedReason), then every sentence the server
 * gives in `blocking` as it sent it (docs/evidence-assurance.md, section 10.15, item 5:
 * "An exception is recorded on attribute B. Log a design deficiency for it, or change the
 * tickmark with your reason."). The person who must act on such a sentence is often not
 * the reviewer, so it is not kept behind the reviewer's own reason. Nothing once the
 * conclusion is signed off. It decides nothing: the server's `can_sign` does.
 */
export function signHolds(conclusion: DesignConclusion): string[] {
  return holds(conclusion).map((item) => item.shown);
}

/** A sentence of the server's as the page shows it: whole, its first letter a capital,
 * ended where it is not. Its words are never changed. */
function wholeSentence(said: string): string {
  const trimmed = said.trim();
  if (trimmed === "") {
    return "";
  }
  const capital = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/** Each sentence that holds the sign-off, as the server sent it (`raw`) and as it is
 * shown, once. */
function holds(
  conclusion: DesignConclusion,
): Array<{ raw: string; shown: string }> {
  if (conclusion.status === "SIGNED_OFF") {
    return [];
  }
  return [signBlockedReason(conclusion) ?? "", ...conclusion.blocking]
    .map((item) => ({
      raw: item.trim(),
      shown: Object.hasOwn(BLOCKING_WORDS, item.trim())
        ? (BLOCKING_WORDS[item.trim()] ?? "")
        : wholeSentence(item),
    }))
    .filter(
      (item, at, all) =>
        item.shown !== "" &&
        all.findIndex((other) => other.shown === item.shown) === at,
    );
}

// An exception a person recorded holds the sign-off (docs/evidence-assurance.md, section
// 10.15, item 5)

/** The server's sentence for an exception that holds the sign-off
 * (design_conclusions.exception_sentence): "An exception is recorded on attribute B. Log
 * a design deficiency for it, or change the tickmark with your reason." */
const EXCEPTION_SENTENCE = /\ban exception is recorded on\b/i;

/** The status in place of "Awaiting reviewer sign-off" while one holds. */
export const EXCEPTION_STATUS = "Exception recorded: not ready to sign";
/** The step's status on the workflow (D&I Assessment and D&I Conclusion), and the
 * panel's word in place of the verdict. */
export const EXCEPTION_TO_RESOLVE = "Exception to resolve";
/** Under the server's sentences: who acts, what they do, and what waits meanwhile. */
export const EXCEPTION_NEXT =
  "What the preparer does next: log a design deficiency for the attribute, or change its tickmark on the request in D&I Evidence, with a reason. Until then no verdict can be signed off, and OE evidence and testing wait.";

/**
 * The sentences of `blocking` that say an exception a person recorded holds the
 * sign-off, each whole and once, in the server's order. The server refuses every
 * sign-off while one is there, whichever verdict, so nothing is "awaiting sign-off" and
 * nothing is "effective, to sign off" then. Empty once signed off, and while the design
 * workpaper is not prepared (that comes first, and says so).
 */
export function exceptionHolds(conclusion: {
  status: DesignConclusionStatus;
  blocking: readonly string[];
}): string[] {
  if (conclusion.status !== "TO_SIGN" && conclusion.status !== "OUT_OF_DATE") {
    return [];
  }
  return conclusion.blocking
    .map((item) => item.trim())
    .filter(
      (item, at, all) =>
        EXCEPTION_SENTENCE.test(item) && all.indexOf(item) === at,
    );
}

/** How the conclusion's card reads: the verdict's tone, or held by an exception (never
 * the green of an effective verdict). */
export type ConclusionTone =
  | "effective"
  | "not_effective"
  | "none"
  | "excepted";

export type ConclusionHead = {
  heading: string;
  /** The status beside the heading, and the class that tones it. */
  status: string;
  statusTone:
    | "signed_off"
    | "out_of_date"
    | "to_sign"
    | "not_ready"
    | "excepted";
  tone: ConclusionTone;
  /** The large word: the verdict, "Not concluded", or "Exception to resolve". */
  word: string;
  /** What the verdict means for OE; "" where an exception holds the sign-off (the
   * reasons and what to do next are said instead). */
  effect: string;
  /** The server's sentences for the exceptions that hold the sign-off, whole. */
  reasons: string[];
  /** What the preparer does next; "" where no exception holds it. */
  next: string;
};

/** The status in place of "Awaiting reviewer sign-off" while no conclusion that can be
 * signed stands: none recorded, "Not concluded", or one this page cannot read. */
export const NOT_READY_TO_SIGN = "Not ready to sign";

const STATUS_WORDS: Record<DesignConclusionStatus, string> = {
  SIGNED_OFF: "Signed off",
  OUT_OF_DATE: "Out of date",
  TO_SIGN: "Awaiting reviewer sign-off",
  NOT_READY: "Not ready",
};

/**
 * The head of the conclusion's card, in the page's words. Where an exception a person
 * recorded holds the sign-off: "Exception recorded: not ready to sign", with the
 * server's sentence(s) as the reason and what the preparer does next; never "Awaiting
 * reviewer sign-off", never "Once signed off, OE evidence and testing are cleared to
 * proceed", and never toned as effective. It decides nothing: the server's `blocking`
 * and `can_sign` do.
 */
export function conclusionHead(conclusion: DesignConclusion): ConclusionHead {
  const signedOff = conclusion.status === "SIGNED_OFF";
  const heading =
    signedOff || conclusion.status === "NOT_READY"
      ? "D&I conclusion"
      : "Proposed D&I conclusion";
  const reasons = exceptionHolds(conclusion);
  const standing = standingKind(conclusion);
  if (reasons.length > 0) {
    return {
      heading: "D&I conclusion",
      status: EXCEPTION_STATUS,
      statusTone: "excepted",
      tone: "excepted",
      // The preparer's conclusion, where one stands, is still what the card says it is
      // (section 3.6); the status and the reasons say it cannot be signed off now.
      word:
        standing === null || standing === undefined
          ? EXCEPTION_TO_RESOLVE
          : standingWords(standing),
      effect: "",
      reasons,
      next: EXCEPTION_NEXT,
    };
  }
  // Section 3.6: the conclusion is the preparer's, and the reviewer signs it. On a body
  // that names it, the card says the one that stands and nothing else: the two-value
  // `proposed` is what the records propose, never what was concluded, so it gives the
  // card neither its words nor its tone.
  if (standing !== undefined) {
    const signable = signableKind(standing);
    // Nothing awaits the reviewer while there is no conclusion that can be signed.
    const waits = conclusion.status === "TO_SIGN" && signable === null;
    const common = {
      heading: "D&I conclusion",
      status: waits ? NOT_READY_TO_SIGN : STATUS_WORDS[conclusion.status],
      statusTone: (waits
        ? "not_ready"
        : conclusion.status.toLowerCase()) as ConclusionHead["statusTone"],
      reasons: [],
      next: "",
    };
    if (standing === null) {
      return {
        ...common,
        tone: "none",
        word: NO_CONCLUSION_YET,
        effect:
          "OE evidence and testing wait until a conclusion is recorded and signed off.",
      };
    }
    if (standing === "NOT_STATED") {
      return {
        ...common,
        tone: "none",
        word: NOT_STATED,
        effect:
          "The conclusion on record is one this page cannot read, so nothing is signed off from here. Refresh the page.",
      };
    }
    return {
      ...common,
      tone:
        standing === "NOT_EFFECTIVE"
          ? "not_effective"
          : // Green is for "Effective", and only once signed: exceptions noted, no
            // instance and not concluded are never toned as effective.
            signedOff && standing === "EFFECTIVE"
            ? "effective"
            : "none",
      word: CONCLUSION_WORDS[standing],
      effect: KIND_EFFECTS[standing](signedOff),
    };
  }
  // A body from before section 3.6 names no conclusion: its two-value verdict, as before.
  const verdict = signedOff
    ? (conclusion.signed?.verdict ?? null)
    : conclusion.proposed;
  return {
    heading,
    status: STATUS_WORDS[conclusion.status],
    statusTone: conclusion.status.toLowerCase() as ConclusionHead["statusTone"],
    tone:
      verdict === null
        ? "none"
        : (verdict.toLowerCase() as "effective" | "not_effective"),
    word: verdict === null ? "Not concluded" : VERDICT_LABELS[verdict],
    effect:
      verdict === "NOT_EFFECTIVE"
        ? "OE is not performed. The control concludes not effective on the design deficiency, which goes to remediation; D&I is assessed again before OE."
        : verdict === "EFFECTIVE"
          ? signedOff
            ? "OE evidence and testing are cleared to proceed."
            : "Once signed off, OE evidence and testing are cleared to proceed."
          : "OE evidence and testing wait for a signed-off effective D&I conclusion.",
    reasons: [],
    next: "",
  };
}

/** What a conclusion means for OE, once signed off or before (section 3.6). */
const KIND_EFFECTS: Readonly<
  Record<ConclusionKind, (signedOff: boolean) => string>
> = {
  EFFECTIVE: (signedOff) =>
    signedOff
      ? "OE evidence and testing are cleared to proceed."
      : "Once signed off, OE evidence and testing are cleared to proceed.",
  EXCEPTIONS_NOTED: (signedOff) =>
    signedOff
      ? "The exceptions are concluded on as not a design deficiency. OE evidence and testing are cleared to proceed."
      : "Once signed off, the exceptions are concluded on as not a design deficiency, and OE evidence and testing are cleared to proceed.",
  NOT_EFFECTIVE: () =>
    "OE is not performed. The control concludes not effective on the design deficiency, which goes to remediation; D&I is assessed again before OE.",
  NO_INSTANCE: (signedOff) =>
    signedOff
      ? "The design is effective and no instance occurred to walk through. OE evidence and testing are cleared to proceed."
      : "Once signed off, the design is concluded effective with no instance to walk through, and OE evidence and testing are cleared to proceed.",
  NOT_CONCLUDED: () =>
    "“Not concluded” is never signed off. OE evidence and testing wait until the preparer records a conclusion that can be.",
};

/** What holds the sign-off, under the card: every sentence of signHolds that the card
 * does not already give, as the exception's reason or (where no conclusion is recorded)
 * as its own sentence with the way to section 7. Nothing else the server sends is left
 * out. */
export function holdsBelow(conclusion: DesignConclusion): string[] {
  const said = exceptionHolds(conclusion);
  const none = standingKind(conclusion) === null;
  return holds(conclusion)
    .filter(
      (item) =>
        !said.includes(item.raw) &&
        !said.includes(item.shown) &&
        !(none && item.raw === NO_CHOICE),
    )
    .map((item) => item.shown);
}

/** What to do about a sign-off that no longer holds, after its reasons (`out_of_date`,
 * the server's sentences). Where no conclusion stands (a sign-off from before the
 * preparer recorded one, section 3.6) there is nothing to sign again yet, and it says
 * what comes first. */
export function outOfDateNext(conclusion: DesignConclusion): string {
  const standing = standingKind(conclusion);
  if (standing === undefined || signableKind(standing) !== null) {
    return "OE waits until a reviewer signs off again.";
  }
  if (standing === "NOT_STATED") {
    return "OE waits until a reviewer signs off again. Refresh the page to read the conclusion on record.";
  }
  // A conclusion is recorded on the draft: a prepared workpaper is reopened first.
  const reopen = conclusion.workpaper?.status === "PREPARED";
  return `What to do: ${reopen ? "reopen the design workpaper, record" : "record"} a conclusion in section ${DW_SECTION.conclusion} of D&I Assessment, and prepare the workpaper${reopen ? " again" : ""}. OE waits until a reviewer signs that conclusion off.`;
}

/** "Attribute B · Dana Lee on Nov 15, 2026": who recorded an exception, and when. The
 * date is given by the caller (formatDate), so this stays free of the clock. */
export function exceptionLine(
  item: RecordedException,
  date: (at: string) => string,
): string {
  const by = [
    item.recordedBy,
    item.recordedAt === "" ? "" : date(item.recordedAt),
  ]
    .filter((part) => part !== "")
    .join(" on ");
  return [
    item.code === "" ? "An attribute" : `Attribute ${item.code}`,
    by,
    item.checkCurrent ? "" : "its request is to be checked again",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

export type DesignConclusionIntent = "sign" | "reopen";

export type DesignConclusionWrite =
  | { error: "invalid" }
  | {
      intent: DesignConclusionIntent;
      path: string;
      body: Record<string, unknown>;
      controlId: string;
    };

export function designConclusionWrite(
  fields: Record<string, string>,
): DesignConclusionWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const control = fields.control_id ?? "";
  if (!UUID.test(organization) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const path = `/organizations/${organization}/projects/${project}/design-conclusions/${control}`;
  if (fields.intent === "sign") {
    // Section 3.6: the reviewer signs the preparer's conclusion, named by its kind and
    // by its id (`choice_id`, the standing choice's: the server refuses any other, so a
    // conclusion changed since the page read it is never signed). "Not concluded" is
    // never signed, so it is never sent; with no standing choice there is no id, and
    // nothing is sent.
    const named = conclusionKindOf(fields.conclusion);
    const conclusion = named === "NOT_CONCLUDED" ? null : named;
    const choice = fields.choice_id ?? "";
    const version = Number(fields.workpaper_version ?? "");
    const note = (fields.note ?? "").trim();
    // Section 3.8: the request the sign-off ends, where one stands (the server refuses a
    // stale one). Absent where none stands, as before.
    const request = fields.request_id ?? "";
    if (
      conclusion === null ||
      (request !== "" && !UUID.test(request)) ||
      !UUID.test(choice) ||
      !Number.isInteger(version) ||
      version < 1 ||
      note.length > 1000 ||
      CREDENTIAL.test(note)
    ) {
      return { error: "invalid" };
    }
    return {
      intent: "sign",
      path: `${path}/sign-off`,
      body: {
        conclusion,
        choice_id: choice,
        workpaper_version: version,
        note,
        ...(request === "" ? {} : { request_id: request }),
      },
      controlId: control,
    };
  }
  if (fields.intent === "reopen") {
    const reason = (fields.reason ?? "").trim();
    if (reason.length < 10 || reason.length > 500 || CREDENTIAL.test(reason)) {
      return { error: "invalid" };
    }
    return {
      intent: "reopen",
      path: `${path}/reopen`,
      body: { reason },
      controlId: control,
    };
  }
  return { error: "invalid" };
}

export type DesignConclusionNotice =
  | "dc-signed"
  | "dc-reopened"
  | "dc-blocked"
  | "dc-denied"
  | "dc-invalid"
  | "dc-trial-ended"
  | "dc-unavailable";

export const DESIGN_CONCLUSION_NOTICES: Record<DesignConclusionNotice, string> =
  {
    "dc-signed": "D&I conclusion signed off.",
    "dc-reopened":
      "D&I conclusion reopened. OE waits until it is signed off again.",
    "dc-blocked":
      "That could not be done: the design workpaper or its deficiencies changed, or the conclusion was already signed off. Review it again.",
    "dc-denied":
      "Only a team member with the reviewer role, who did not prepare the design workpaper, signs off the D&I conclusion.",
    "dc-invalid":
      "Check the entry and try again. A reason of at least 10 characters is needed to reopen.",
    "dc-trial-ended":
      "The free trial has ended. Everything here stays to read; explore plans to keep working.",
    "dc-unavailable": "That could not be saved. Try again.",
  };

const DONE: Record<DesignConclusionIntent, DesignConclusionNotice> = {
  sign: "dc-signed",
  reopen: "dc-reopened",
};

export function designConclusionNoticeFor(
  intent: DesignConclusionIntent,
  status: number,
  detail: string,
): DesignConclusionNotice {
  if (status === 200) {
    return DONE[intent];
  }
  if (status === 409) {
    return /reviewer|prepared the design/.test(detail)
      ? "dc-denied"
      : "dc-blocked";
  }
  // The subscription refused the change (subscriptions.py).
  if (status === 402) {
    return "dc-trial-ended";
  }
  if (status === 403 || status === 404) {
    return "dc-denied";
  }
  if (status === 422) {
    return "dc-invalid";
  }
  return "dc-unavailable";
}

/** Why a sign-off or a reopening was not taken, in the server's own sentence, shown at
 * once in place of the page's general notice: "Not signed off: the preparer's conclusion
 * changed; read it again." "" where the server gave none, and where it was taken. */
export function designConclusionRefusal(
  intent: DesignConclusionIntent,
  notice: DesignConclusionNotice,
  detail: string,
): string {
  if (notice === DONE[intent]) {
    return "";
  }
  const said = detail.trim().replace(/[.\s]+$/, "");
  return said === ""
    ? ""
    : `${intent === "sign" ? "Not signed off" : "Not reopened"}: ${said}.`;
}

export function parseDesignConclusionNotice(
  value: string | null,
): DesignConclusionNotice | null {
  return (
    (Object.keys(DESIGN_CONCLUSION_NOTICES) as DesignConclusionNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}

/* The preparer's conclusion (docs/design-workpaper.md, section 3.6) -------------------- */

/** A conclusion's reason, in characters, as the server bounds it. */
export const REASON_MIN = 10;
export const REASON_MAX = 1000;
/** The conclusions that always need the preparer's reason, whatever the proposal. */
const REASON_ALWAYS: ReadonlySet<ConclusionKind> = new Set([
  "EXCEPTIONS_NOTED",
  "NOT_EFFECTIVE",
  "NO_INSTANCE",
]);

/** One line under each conclusion of the radio group: what choosing it says. */
export const CONCLUSION_HINTS: Readonly<Record<ConclusionKind, string>> = {
  EFFECTIVE:
    "Designed to address the risk and in place in the instance walked through.",
  EXCEPTIONS_NOTED:
    "Exceptions stand, and you conclude they are not a design deficiency.",
  NOT_EFFECTIVE:
    "A design deficiency stands: the design, the implementation, or both fail.",
  NO_INSTANCE:
    "The design is shown, and no instance occurred in the period to walk through.",
  NOT_CONCLUDED: "Not ready to conclude yet. It is never signed off.",
};

/** What the page knows of the records the server's rules read (section 3.6): whether a
 * design deficiency stands, the letters of the attributes an exception stands on, the
 * design and the implementation results (null where not known), the letters not yet
 * shown at all (as designed or in an instance: the design result's `open`) and the
 * letters not yet shown in an instance. */
export type ChoiceFacts = {
  deficiency: boolean;
  exceptions: readonly string[];
  design: ResultKind | null;
  implementation: ResultKind | null;
  designOpen: readonly string[];
  implementationOpen: readonly string[];
};

export type ChoiceDraft = {
  kind: ConclusionKind | null;
  basis: ConclusionBasis | null;
  reason: string;
};

export type ChoiceProblems = {
  /** Why each conclusion is not offered now, mirroring the server's refusals; "" where
   * it is offered. The server stays the authority. */
  unavailable: Readonly<Record<ConclusionKind, string>>;
  /** What is missing or wrong, by field; "" where nothing is. */
  kind: string;
  basis: string;
  reason: string;
  /** Whether the draft needs a reason, and why (said in the box's label). */
  reasonNeeded: boolean;
  reasonWhy: string;
  /** Nothing stands in the way of "Record conclusion". */
  ready: boolean;
};

/** "A", "A and B", "A, B and C", "A, B, C and 2 more": the server's listing. */
function listedCodes(codes: readonly string[]): string {
  const shown = codes.slice(0, 3);
  const more = codes.length - shown.length;
  if (more > 0) {
    return `${shown.join(", ")} and ${more} more`;
  }
  return shown.length <= 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] ?? ""}`;
}

function attributesWord(codes: readonly string[]): string {
  return `${codes.length === 1 ? "Attribute" : "Attributes"} ${listedCodes(codes)}`;
}

/** The server's sentence for "Exceptions noted" without an exception, or with another
 * attribute still open (design_conclusions, tightened 15 November 2026). */
export const EXCEPTIONS_NEED =
  "Exceptions noted needs an exception on record and every other attribute shown or settled.";

/** Why a conclusion cannot be recorded on the records as the page knows them: the
 * server's own sentences (design_conclusions.choice_refusal), as a sentence. "" where it
 * can. Not effective and not concluded are never refused here. The server stays the
 * authority: what it refuses beyond this is shown in its own sentence. */
export function kindRefusal(kind: ConclusionKind, facts: ChoiceFacts): string {
  const words = CONCLUSION_WORDS[kind];
  const deficiency = `A design deficiency is logged, so the conclusion cannot be “${words}”.`;
  if (kind === "EFFECTIVE") {
    if (facts.deficiency) {
      return deficiency;
    }
    if (
      facts.exceptions.length > 0 ||
      facts.design === "EXCEPTIONS" ||
      facts.implementation === "EXCEPTIONS"
    ) {
      return facts.exceptions.length === 0
        ? `An exception stands, so the conclusion cannot be “${words}”.`
        : `An exception stands on ${attributesWord(facts.exceptions).replace(/^A/, "a")}, so the conclusion cannot be “${words}”.`;
    }
    if (facts.design !== "DESIGNED" || facts.implementation !== "IN_PLACE") {
      const open = facts.implementationOpen;
      if (open.length === 0) {
        return facts.design === null || facts.implementation === null
          ? `The design and implementation results are not known yet, so the conclusion cannot be “${words}”.`
          : `No attribute of the control is approved yet, so the conclusion cannot be “${words}”.`;
      }
      return `${attributesWord(open)} ${open.length === 1 ? "is" : "are"} not yet shown in the records of an instance, so the conclusion cannot be “${words}”.`;
    }
    return "";
  }
  if (kind === "EXCEPTIONS_NOTED") {
    if (facts.deficiency) {
      return deficiency;
    }
    // Tightened after the independent review (15 November 2026): it needs an exception
    // on record, and every other attribute shown or settled by a closing tickmark. The
    // others are judged only where the page knows which attributes the exceptions stand
    // on (an excepted attribute is itself listed as open); where it does not, the server
    // decides. "Shown" is shown in the records of an instance, as the server's
    // `others_open` reads it (independent review, 16 November 2026: old, the letters not
    // shown at all, `designOpen`, so an attribute shown only as designed was let through
    // and refused by the server; new, `implementationOpen`, the server's own list).
    const excepted =
      facts.exceptions.length > 0 ||
      facts.design === "EXCEPTIONS" ||
      facts.implementation === "EXCEPTIONS";
    const others =
      facts.exceptions.length === 0
        ? []
        : facts.implementationOpen.filter(
            (code) => !facts.exceptions.includes(code),
          );
    if (!excepted || others.length > 0) {
      return EXCEPTIONS_NEED;
    }
  }
  if (kind === "NO_INSTANCE") {
    if (facts.deficiency) {
      return deficiency;
    }
    if (facts.design !== "DESIGNED") {
      return "The design is not shown yet: Design effective needs every attribute shown as designed or settled by a tickmark.";
    }
  }
  return "";
}

/**
 * What stands in the way of "Record conclusion" (section 3.6), before anything is sent:
 * the conclusions not offered now, each with the server's reason; a basis for "Not
 * effective"; and a reason of 10 to 1000 characters where one is needed (always for
 * exceptions noted, not effective and no instance; for effective and not concluded where
 * the choice differs from the agent's proposal, or the proposal is not known). It decides
 * nothing: the server refuses what it refuses, and its sentence is shown.
 */
export function choiceProblems(
  draft: ChoiceDraft,
  proposal: ConclusionKind | null,
  facts: ChoiceFacts,
): ChoiceProblems {
  const unavailable = Object.fromEntries(
    CONCLUSION_KINDS.map((kind) => [kind, kindRefusal(kind, facts)]),
  ) as Record<ConclusionKind, string>;
  const kind = draft.kind;
  const reason = draft.reason.trim();
  const reasonNeeded =
    kind !== null && (REASON_ALWAYS.has(kind) || kind !== proposal);
  const reasonWhy =
    kind === null || !reasonNeeded
      ? ""
      : kind === "EXCEPTIONS_NOTED"
        ? "why the exceptions are not a design deficiency"
        : kind === "NOT_EFFECTIVE"
          ? "what is not effective, and why"
          : kind === "NO_INSTANCE"
            ? "why there is no instance to walk through"
            : proposal === null
              ? "why you conclude this"
              : `why it differs from the agent's proposal (${CONCLUSION_WORDS[proposal]})`;
  const kindProblem =
    kind === null ? "Choose a conclusion." : unavailable[kind];
  const basisProblem =
    kind === "NOT_EFFECTIVE" && draft.basis === null
      ? "Say whether the design, the implementation or both are not effective."
      : "";
  // Where no reason is needed none is asked for, shown or sent: what was typed for
  // another conclusion is not this one's reason.
  const reasonProblem = !reasonNeeded
    ? ""
    : reason.length > REASON_MAX
      ? `The reason can be at most ${REASON_MAX.toLocaleString("en-US")} characters.`
      : CREDENTIAL.test(reason)
        ? "This reads as a credential (a password, key or token). Remove it."
        : reason.length < REASON_MIN
          ? `Give the reason in a sentence of at least ${REASON_MIN} characters.`
          : "";
  return {
    unavailable,
    kind: kindProblem,
    basis: basisProblem,
    reason: reasonProblem,
    reasonNeeded,
    reasonWhy,
    ready: kindProblem === "" && basisProblem === "" && reasonProblem === "",
  };
}

/** The reasons typed in this session, each kept under the conclusion it was typed for. */
export type TypedReasons = Readonly<Partial<Record<ConclusionKind, string>>>;

/**
 * The reason the box holds when a conclusion is chosen: a reason belongs to the
 * conclusion it was written for. What the person typed for this conclusion in this
 * session; else, for the conclusion that stands, its own recorded reason; else nothing.
 * A reason written for another conclusion is never carried over.
 */
export function reasonOnChoosing(
  kind: ConclusionKind,
  typed: TypedReasons,
  standing: Pick<ConclusionChoice, "kind" | "reason"> | null,
): string {
  return typed[kind] ?? (standing?.kind === kind ? standing.reason : "");
}

/**
 * Whether the draft is the conclusion that stands, so that there is nothing to record:
 * the same conclusion, the same basis of "Not effective", and the same reason where the
 * draft needs one. Where it needs none, a reason recorded with the standing conclusion
 * is not something the draft changes: recording it again would only drop that reason
 * without anyone having chosen to, so "Record conclusion" stays off until something
 * really changes.
 */
export function draftUnchanged(
  draft: ChoiceDraft,
  reasonNeeded: boolean,
  standing: Pick<ConclusionChoice, "kind" | "basis" | "reason"> | null,
): boolean {
  return (
    sameAsStanding(draft, reasonNeeded, standing) &&
    !recordsAgain(draft, reasonNeeded, standing)
  );
}

function sameAsStanding(
  draft: ChoiceDraft,
  reasonNeeded: boolean,
  standing: Pick<ConclusionChoice, "kind" | "basis" | "reason"> | null,
): boolean {
  return (
    standing !== null &&
    draft.kind === standing.kind &&
    (draft.kind !== "NOT_EFFECTIVE" || draft.basis === standing.basis) &&
    (!reasonNeeded || draft.reason.trim() === standing.reason.trim())
  );
}

/**
 * Whether the draft is the standing "Exceptions noted", word for word, which is still
 * worth recording: the server's own fix where an exception was noted after it was
 * recorded (design_conclusions.EXCEPTION_SINCE: "the preparer records it again"), which
 * this page cannot see, as it is not told when a check's run finished. The button then
 * reads "Record again" (independent review, 16 November 2026: before, "Nothing changed
 * yet" kept it off, and only rewording the reason let the preparer through).
 */
export function recordsAgain(
  draft: ChoiceDraft,
  reasonNeeded: boolean,
  standing: Pick<ConclusionChoice, "kind" | "basis" | "reason"> | null,
): boolean {
  return (
    draft.kind === "EXCEPTIONS_NOTED" &&
    sameAsStanding(draft, reasonNeeded, standing)
  );
}

/** What "Record again" says beside it: why the same conclusion is recorded once more. */
export const RECORD_AGAIN_HINT =
  "Records the same conclusion again, now: needed where an exception was noted after it was recorded.";

/** A 200 whose body the page could not read: the conclusion is recorded, and nothing the
 * page holds is taken as gone. */
export const RECORDED_UNREAD =
  "Recorded, but the page could not read it again. It is being read again: what you chose is still here.";

/** Another conclusion was read while this one was being chosen (after a refusal, or
 * recorded by someone else): it is shown as what stands, and replacing it is a new
 * decision. */
export function anotherStands(choice: Pick<ConclusionChoice, "recordedBy">) {
  return `${choice.recordedBy === "" ? "Another conclusion was recorded" : `${choice.recordedBy} recorded another conclusion`} meanwhile, and it stands now. Read it, then press Change to replace it.`;
}

export type ChoiceWrite =
  | { error: "invalid" }
  | { path: string; body: Record<string, unknown>; controlId: string };

/**
 * The preparer's conclusion as the route sends it: `POST …/design-conclusions/{control}/
 * choice` with `{kind, basis?, reason?, replaces}` and nothing else (the server forbids
 * any other field). Refused here: an id that is not one, a kind outside the five, a basis
 * other than the three or given for anything but "Not effective", a reason over 1000
 * characters or that reads as a credential, and a `replaces` that is neither an id nor
 * null. Whether a reason is needed, and every rule of the records, is the server's.
 */
export function choiceWrite(fields: Record<string, unknown>): ChoiceWrite {
  const id = (value: unknown) =>
    typeof value === "string" && UUID.test(value) ? value : null;
  const organization = id(fields.organization_id);
  const project = id(fields.project_id);
  const control = id(fields.control_id);
  const kind = conclusionKindOf(fields.kind);
  if (organization === null || project === null || control === null) {
    return { error: "invalid" };
  }
  if (kind === null) {
    return { error: "invalid" };
  }
  const replaces = fields.replaces === null ? null : id(fields.replaces);
  if (replaces === null && fields.replaces !== null) {
    return { error: "invalid" };
  }
  const body: Record<string, unknown> = { kind };
  if (fields.basis !== undefined && fields.basis !== null) {
    const basis = basisOf(fields.basis);
    if (basis === null || kind !== "NOT_EFFECTIVE") {
      return { error: "invalid" };
    }
    body.basis = basis;
  }
  if (fields.reason !== undefined && fields.reason !== null) {
    if (typeof fields.reason !== "string") {
      return { error: "invalid" };
    }
    const reason = fields.reason.trim();
    if (reason.length > REASON_MAX || CREDENTIAL.test(reason)) {
      return { error: "invalid" };
    }
    if (reason !== "") {
      body.reason = reason;
    }
  }
  body.replaces = replaces;
  return {
    path: `/organizations/${organization}/projects/${project}/design-conclusions/${control}/choice`,
    body,
    controlId: control,
  };
}

/** A sentence of the server's, as the page shows it: its first letter a capital, ended
 * once. "" for nothing. */
export function asSentence(said: string): string {
  const trimmed = said.trim().replace(/[.\s]+$/, "");
  if (trimmed === "") {
    return "";
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

/** Why "Record conclusion" was not taken, in one sentence: for a refusal (409, 422) the
 * server's own sentence; otherwise this page's. "" where it was taken. */
export function choiceRefusal(status: number, detail: string): string {
  if (status === 200) {
    return "";
  }
  // The server's sentence as it sent it, ended once: its refusals are written to be read.
  const said = detail.trim().replace(/[.\s]+$/, "");
  if ((status === 409 || status === 422) && said !== "") {
    return `Not recorded: ${said}.`;
  }
  if (status === 422) {
    return "Not recorded: the server did not take this as written. Check the conclusion and the reason, and try again.";
  }
  if (status === 409) {
    return "Not recorded: the conclusion cannot be recorded now. Read the workpaper again and try once more.";
  }
  if (status === 401) {
    return "Not recorded: your session has ended. Sign in again in another tab, then record the conclusion: what you chose is still here.";
  }
  if (status === 402) {
    return "Not recorded: the free trial has ended. Everything here stays to read.";
  }
  if (status === 403 || status === 404) {
    return "Not recorded: you may not record the conclusion of this control, or it is no longer here.";
  }
  return "Not recorded: the server could not be reached. What you chose is still here: try again.";
}
