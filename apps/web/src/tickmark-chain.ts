/**
 * What one press of "Record" on a tickmark does (docs/evidence-assurance.md, section
 * 10.15, items 1 and 2): the tickmark, then the dismissal of the check's proposed
 * finding, then the acceptance of the request's evidence, each through the row's own
 * call, each sent only after the one before it was confirmed, and each said as done only
 * after its own answer. Pure: the three calls are given, so the order and every stop are
 * tested by running it (tests/tickmark-chain.test.ts). The form only draws what it says.
 *
 * Nothing here claims an outcome the server did not confirm. A call whose answer did
 * not arrive is neither a success nor a refusal: it is said as not known, the list is
 * read again, and nothing that depends on it is sent.
 */

/** A call's answer: confirmed by the server, refused in the server's own sentence, or
 * not known (the answer did not arrive, so the act may or may not have been done). */
export type ChainAnswer =
  | { outcome: "confirmed" }
  | { outcome: "refused"; sentence: string }
  | { outcome: "unknown" };

export const CONFIRMED: ChainAnswer = { outcome: "confirmed" };
export const UNKNOWN: ChainAnswer = { outcome: "unknown" };
export const refusedWith = (sentence: string): ChainAnswer => ({
  outcome: "refused",
  sentence,
});

/**
 * Whether a call's outcome is not known from the status its route answered with: no
 * answer arrived at all (0: the browser's call, or the route's own call to the server,
 * failed or ran out of time after the server may have acted), or a gateway answered in
 * the server's place (502, 503, 504). Anything else is the server's own answer, a
 * failure it reports (500) included.
 */
export const outcomeUnknown = (status: number): boolean =>
  status === 0 || status === 502 || status === 503 || status === 504;

/** What a row's action says of its own call whose answer did not arrive: neither that
 * it was saved nor that it was not. */
export const ANSWER_LOST =
  "The answer did not arrive, so it is not known whether this was saved. Refresh the page to see where it stands.";

/** An answer from what a row's call gives back: null once the server confirmed it, its
 * refusal in one sentence otherwise, and whether the outcome is not known. */
export function answerOf(
  refusal: string | null,
  unknown: boolean,
): ChainAnswer {
  return unknown
    ? UNKNOWN
    : refusal === null
      ? CONFIRMED
      : refusedWith(refusal);
}

export type ChainKey = "record" | "dismiss" | "accept";

/** One line of what the press did, as it is said: at work, done (only once the server
 * confirmed it), refused (the server's sentence), not sent (an earlier step stopped
 * it), or not known. */
export type ChainStep = {
  key: ChainKey;
  state: "working" | "done" | "refused" | "held" | "unknown";
  text: string;
};

export const TICKMARK_RECORDED = "Tickmark recorded.";
export const FINDING_DISMISSING = "Dismissing the check's proposed finding…";
export const FINDING_DISMISSED =
  "Proposed finding dismissed, with this reason.";
export const EVIDENCE_ACCEPTING = "Accepting the evidence…";
export const EVIDENCE_ACCEPTED = "Evidence accepted.";
/** The acceptance is not sent once the dismissal was refused: the finding still waits. */
export const ACCEPT_HELD =
  "The evidence was not accepted, because the finding was not dismissed. Decide the finding, then accept from the summary.";
/** The acceptance is not sent while it is not known whether the finding was dismissed. */
export const ACCEPT_NOT_SENT =
  "The acceptance was not sent, because it is not known whether the finding was dismissed. Once the list shows where the finding stands, accept from the summary.";

/** Said where a call's answer did not arrive: never that it failed, never that it was
 * done. The list is read again, which shows what the server holds. */
const notKnown = (whether: string) =>
  `The answer did not arrive, so it is not known whether ${whether}. The list is read again.`;
export const RECORD_UNKNOWN = notKnown("the tickmark was recorded");
export const DISMISS_UNKNOWN = notKnown("the finding was dismissed");
export const ACCEPT_UNKNOWN = notKnown("the evidence was accepted");

/** A refusal as a sentence of its own. */
const closed = (text: string) => {
  const said = text.replace(/\s+/g, " ").trim();
  return said === "" || /[.!?…]$/.test(said) ? said : `${said}.`;
};
/** A dismissal the server refused: its sentence, and that the tickmark stands. */
export const findingKept = (refusal: string) =>
  `The proposed finding was not dismissed. ${closed(refusal)} The tickmark stays.`;
/** An acceptance the server refused: its sentence, and that the tickmark stands. */
export const evidenceNotAccepted = (refusal: string) =>
  `The evidence was not accepted. ${closed(refusal)} The tickmark stays.`;

/** The row's three calls, each made at most once and never again. */
export type ChainCalls = {
  record: () => Promise<ChainAnswer>;
  dismiss: () => Promise<ChainAnswer>;
  accept: () => Promise<ChainAnswer>;
};

/** What the person left ticked, as the form stood at the press. */
export type ChainAlso = { dismiss: boolean; accept: boolean };

export type ChainEnd = {
  /** The tickmark's own answer. */
  record: ChainAnswer;
  /** Every line said, the last word on each step, in the order the steps ran. */
  steps: ChainStep[];
};

/** A call that throws gave no answer: its outcome is not known. */
async function answered(
  call: () => Promise<ChainAnswer>,
): Promise<ChainAnswer> {
  try {
    return await call();
  } catch {
    return UNKNOWN;
  }
}

/**
 * Runs the press: the tickmark; then, only once the server confirmed it and only for
 * what was left ticked, the finding's dismissal and then the acceptance.
 *
 * - A tickmark that was refused, or whose answer did not arrive, ends it: nothing follows
 *   a tickmark that is not confirmed.
 * - A dismissal that was refused, or whose answer did not arrive, holds the acceptance:
 *   the request is not accepted over a finding that may still wait.
 * - `say` is given each line as it changes ("working" before a call, its last word after
 *   the answer). `reread` is called once for each answer that did not arrive, so the
 *   list shows what the server holds.
 */
export async function tickmarkChain(
  calls: ChainCalls,
  also: ChainAlso,
  on: { say?: (step: ChainStep) => void; reread?: () => void } = {},
): Promise<ChainEnd> {
  const steps: ChainStep[] = [];
  const say = (step: ChainStep) => {
    const at = steps.findIndex((each) => each.key === step.key);
    if (at < 0) {
      steps.push(step);
    } else {
      steps[at] = step;
    }
    on.say?.(step);
  };
  const unknown = (key: ChainKey, text: string) => {
    say({ key, state: "unknown", text });
    on.reread?.();
  };

  const record = await answered(calls.record);
  if (record.outcome === "unknown") {
    unknown("record", RECORD_UNKNOWN);
    return { record, steps };
  }
  if (record.outcome === "refused") {
    say({ key: "record", state: "refused", text: record.sentence });
    return { record, steps };
  }
  say({ key: "record", state: "done", text: TICKMARK_RECORDED });

  // Why the acceptance is not sent, where the dismissal did not go through.
  let held: string | null = null;
  if (also.dismiss) {
    say({ key: "dismiss", state: "working", text: FINDING_DISMISSING });
    const dismissed = await answered(calls.dismiss);
    if (dismissed.outcome === "confirmed") {
      say({ key: "dismiss", state: "done", text: FINDING_DISMISSED });
    } else if (dismissed.outcome === "refused") {
      say({
        key: "dismiss",
        state: "refused",
        text: findingKept(dismissed.sentence),
      });
      held = ACCEPT_HELD;
    } else {
      unknown("dismiss", DISMISS_UNKNOWN);
      held = ACCEPT_NOT_SENT;
    }
  }
  if (also.accept && held !== null) {
    say({ key: "accept", state: "held", text: held });
  } else if (also.accept) {
    say({ key: "accept", state: "working", text: EVIDENCE_ACCEPTING });
    const accepted = await answered(calls.accept);
    if (accepted.outcome === "confirmed") {
      say({ key: "accept", state: "done", text: EVIDENCE_ACCEPTED });
    } else if (accepted.outcome === "refused") {
      say({
        key: "accept",
        state: "refused",
        text: evidenceNotAccepted(accepted.sentence),
      });
    } else {
      unknown("accept", ACCEPT_UNKNOWN);
    }
  }
  return { record, steps };
}
