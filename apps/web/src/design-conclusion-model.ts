/**
 * The D&I conclusion a reviewer signs (product owner, 8 November 2026; the API's
 * design_conclusions.py, migration 0143). The records propose the verdict once the design
 * workpaper is prepared; a reviewer who did not prepare it signs that verdict off, and OE is
 * cleared only by an effective one. This shapes the API's body for the page and builds the
 * writes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type DesignVerdict = "EFFECTIVE" | "NOT_EFFECTIVE";
export type DesignConclusionStatus =
  | "NOT_READY"
  | "TO_SIGN"
  | "SIGNED_OFF"
  | "OUT_OF_DATE";

export type DesignSignoff = {
  id: string;
  verdict: DesignVerdict;
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
  independenceRequired: boolean;
  canSign: boolean;
  history: DesignSignoff[];
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

function signoffOf(value: unknown): DesignSignoff | null {
  if (!isRaw(value) || typeof value.id !== "string") {
    return null;
  }
  const verdict = verdictOf(value.verdict);
  if (verdict === null || typeof value.workpaper_version !== "number") {
    return null;
  }
  const from = value.reopened_from;
  return {
    id: value.id,
    verdict,
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

export function parseDesignConclusion(value: unknown): DesignConclusion | null {
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
    independenceRequired: value.independence_required !== false,
    canSign: value.can_sign === true,
    history: Array.isArray(value.history)
      ? value.history
          .map(signoffOf)
          .filter((item): item is DesignSignoff => item !== null)
      : [],
  };
}

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
  return conclusion.blocking[0] ?? null;
}

/** What the server says of the workpaper and of a standing sign-off as fragments
 * (design_conclusions.py), in the page's own sentences: each is said once, and never as
 * a fragment beside its sentence. "" where the page already says it another way. */
const BLOCKING_WORDS: Readonly<Record<string, string>> = {
  "the design workpaper is not prepared":
    "The design workpaper is prepared first, in D&I Assessment.",
  "the D&I conclusion is signed off": "",
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
  if (conclusion.status === "SIGNED_OFF") {
    return [];
  }
  const said = (item: string) => (BLOCKING_WORDS[item] ?? item).trim();
  return [signBlockedReason(conclusion) ?? "", ...conclusion.blocking]
    .map(said)
    .filter((item, at, all) => item !== "" && all.indexOf(item) === at);
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
  if (reasons.length > 0) {
    return {
      heading: "D&I conclusion",
      status: EXCEPTION_STATUS,
      statusTone: "excepted",
      tone: "excepted",
      word: EXCEPTION_TO_RESOLVE,
      effect: "",
      reasons,
      next: EXCEPTION_NEXT,
    };
  }
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

/** What holds the sign-off, under the card: every sentence of signHolds that the card
 * does not already give as the exception's reason. */
export function holdsBelow(conclusion: DesignConclusion): string[] {
  const said = exceptionHolds(conclusion);
  return signHolds(conclusion).filter((item) => !said.includes(item));
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
    const verdict = verdictOf(fields.verdict);
    const version = Number(fields.workpaper_version ?? "");
    const note = (fields.note ?? "").trim();
    if (
      verdict === null ||
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
      body: { verdict, workpaper_version: version, note },
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

export function parseDesignConclusionNotice(
  value: string | null,
): DesignConclusionNotice | null {
  return (
    (Object.keys(DESIGN_CONCLUSION_NOTICES) as DesignConclusionNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}
