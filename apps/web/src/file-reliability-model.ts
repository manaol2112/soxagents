/**
 * A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14),
 * in words: the two decisions, how an ended one ended, what is offered, and what a draft
 * is sent with. Where the check's review says a file's reliability is not established
 * (a source prepared by management, of an unknown source, a report whose basis is not
 * shown or shown in part), a person who may decide evidence records "Reliability
 * established on my review" (with what was relied on) or "Not relied on". A decision
 * never changes what the check found, and never counts anything as more shown.
 *
 * Pure. The server decides what may be recorded and refuses the rest in its own sentence;
 * this module only says what the form itself can know.
 */
import {
  RELIABILITY_BOUNDS,
  RELIABILITY_KINDS,
  type ReliabilityDecision,
  type ReliabilityEnding,
  type ReliabilityKind,
  type ReliabilityLine,
  type RequestCheck,
  type Tone,
} from "./evidence-assurance-model.ts";
import { formatDate } from "./format.ts";
import type { IconName } from "./icon-name.ts";

/** Each decision in words: `label` as the person records it, `shown` as it is said once
 * recorded, a one-line hint, the quiet line's words after the file's reference, and its
 * mark. Never a success tone: a person's decision does not show anything the check did
 * not. */
export const RELIABILITY_WORDS: Record<
  ReliabilityKind,
  {
    label: string;
    shown: string;
    hint: string;
    quiet: string;
    icon: IconName;
    tone: Tone;
  }
> = {
  ESTABLISHED_ON_REVIEW: {
    label: "Reliability established on my review",
    shown: "Reliability established on review",
    hint: "You established the report's completeness and accuracy another way: you watched it run, inspected its parameters, or the owner confirmed them.",
    quiet: "reliability established on your review",
    icon: "user",
    tone: "neutral",
  },
  NOT_RELIED_ON: {
    label: "Not relied on",
    shown: "Not relied on",
    hint: "The conclusion does not depend on this file. Wherever it is cited, it is said to be not relied on.",
    quiet: "not relied on",
    icon: "minusCircle",
    tone: "neutral",
  },
};

/** The bold line of a file's item under "Needs attention". */
export const reliabilityHeadline = (name: string) =>
  `Reliability of ${name} not established`;
/** The item's control. */
export const RELIABILITY_DECIDE = "Decide";

/** A decided file on the quiet line, in its own words: "E6 reliability established on
 * your review", "E6 not relied on"; by its name where it has no reference. */
export function reliabilityQuiet(
  ref: string,
  name: string,
  kind: ReliabilityKind,
): string {
  return `${ref !== "" ? ref : name} ${RELIABILITY_WORDS[kind].quiet}`;
}

/** How an ended decision ended, as a neutral label; the server's reason follows. */
export const RELIABILITY_ENDING_WORDS: Record<ReliabilityEnding, string> = {
  REPLACED: "Replaced",
  REOPENED: "Reopened",
  FILE_GONE: "Ended: the file is no longer on the request",
  OTHER: "No longer stands",
};

/** Who recorded it and when: "Dana Lee · Nov 14, 2026". */
export function decidedLine(
  by: string | null,
  at: string,
  nobody = "No one",
): string {
  return [by ?? nobody, at === "" ? "" : formatDate(at)]
    .filter((part) => part !== "")
    .join(" · ");
}

/** How an ended decision ended, in one line: the label, who ended it and when, and the
 * server's reason where it gave one. A file no longer on the request names no person. */
export function reliabilityEndingLine(item: {
  endedAs: ReliabilityEnding;
  endedBy: string | null;
  endedAt: string;
  endedReason: string;
}): string {
  const reason = item.endedReason.replace(/\s+/g, " ").trim();
  const who =
    item.endedBy === null
      ? item.endedAt === ""
        ? ""
        : formatDate(item.endedAt)
      : decidedLine(item.endedBy, item.endedAt);
  return `${RELIABILITY_ENDING_WORDS[item.endedAs]}${who === "" ? "" : ` (${who})`}${reason === "" ? "." : `: ${reason}`}`;
}

/** What the person is offered on a file; null where nothing is: for a person who may not
 * decide evidence, where the check is not finished and current, or where the file is no
 * longer in force on the request. Both decisions otherwise (the server checks again). */
export type ReliabilityOffer = { kinds: ReliabilityKind[] };
export function reliabilityOffer(
  check: Pick<RequestCheck, "standing">,
  line: Pick<ReliabilityLine, "inForce">,
  canAct: boolean,
): ReliabilityOffer | null {
  return canAct && check.standing === "REVIEWED" && line.inForce
    ? { kinds: [...RELIABILITY_KINDS] }
    : null;
}

/** A decision as the person drafts it. */
export type ReliabilityDraft = {
  kind: ReliabilityKind | null;
  reason: string;
  reliedOn: string;
};

const spoken = (text: string) => text.replace(/\s+/g, " ").trim();

/** What is wrong with a draft, by field; empty where it can be sent. Only what the form
 * itself can know: the server decides the rest. */
export function reliabilityProblems(draft: ReliabilityDraft): {
  kind?: string;
  reason?: string;
  reliedOn?: string;
} {
  const reason = spoken(draft.reason);
  const reliedOn = spoken(draft.reliedOn);
  const bounds = RELIABILITY_BOUNDS;
  return {
    ...(draft.kind === null ? { kind: "Choose what you decided." } : {}),
    ...(reason.length < bounds.reasonMin
      ? {
          reason: `Give the reason in a sentence of at least ${bounds.reasonMin} characters.`,
        }
      : reason.length > bounds.reasonMax
        ? {
            reason: `The reason can be at most ${bounds.reasonMax} characters.`,
          }
        : {}),
    ...(draft.kind === "ESTABLISHED_ON_REVIEW"
      ? reliedOn.length < bounds.reliedOnMin
        ? {
            reliedOn: `Say what you relied on in at least ${bounds.reliedOnMin} characters.`,
          }
        : reliedOn.length > bounds.reliedOnMax
          ? {
              reliedOn: `What you relied on can be at most ${bounds.reliedOnMax} characters.`,
            }
          : {}
      : {}),
  };
}

/** The fields a draft is sent with: only what its kind takes. */
export function reliabilityFields(
  draft: ReliabilityDraft & { kind: ReliabilityKind },
): Record<string, string> {
  return {
    kind: draft.kind,
    reason: spoken(draft.reason),
    ...(draft.kind === "ESTABLISHED_ON_REVIEW"
      ? { relied_on: spoken(draft.reliedOn) }
      : {}),
  };
}

/** A draft from what stands ("Change": the form pre-filled), or empty. */
export function reliabilityDraftFrom(
  decision: ReliabilityDecision | null,
): ReliabilityDraft {
  return decision === null
    ? { kind: null, reason: "", reliedOn: "" }
    : {
        kind: decision.kind,
        reason: decision.reason,
        reliedOn: decision.reliedOn,
      };
}
