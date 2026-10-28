/**
 * The client-specific walkthrough (decided by the product owner on 26 October 2026, from
 * the walkthrough reference): the control's client questions asked one at a time, each
 * with the answer to start from and where it came from, answered, chosen, typed or
 * skipped, and saved as it is confirmed. Suggestions come only from what the records
 * hold: the agent's prior-year proposal for the question, with the passage it quotes, and
 * then the answers clients usually give. Nothing here decides or saves an answer.
 */

export type WalkSlot = {
  key: string;
  question: string;
  hint: string;
  example: string;
  /** The answers clients usually give (slot_options.py), the first the most usual. */
  options: string[];
  /** Testing waits for it. */
  blocks: boolean;
  value: string;
  filledBy: string | null;
  /** A question the narrative's agents raised (0117): answered by resolving its issue. */
  issue?: { id: string; version: number };
};

/** The key a raised question goes by in the walkthrough. */
export const issueKey = (id: string) => `issue-${id}`;

/** The agent's prior-year proposal of an answer (prior_year.py). */
export type WalkProposal = {
  id: string;
  slotKey: string;
  value: string;
  quote: string;
  status: "PROPOSED" | "ACCEPTED" | "DISMISSED";
};

export type Suggestion = {
  value: string;
  source: "PRIOR_YEAR" | "USUAL";
  /** Where it came from, in words. */
  label: string;
  /** The passage the prior year states it in; "" for a usual answer. */
  quote: string;
  /** The prior-year proposal to accept with it, so the decision is on record. */
  proposalId: string | null;
};

export type WalkStatus = "CONFIRMED" | "IN_PROGRESS" | "SKIPPED" | "PENDING";

export type WalkFilter = "all" | "required" | "open";

/** The answer to start from: the agent's prior-year proposal still waiting, else the most
 * usual answer; none for a question only the client's documents can answer. */
export function suggestionFor(
  slot: WalkSlot,
  proposals: readonly WalkProposal[],
): Suggestion | null {
  const prior = proposals.find(
    (item) =>
      item.slotKey === slot.key &&
      item.status === "PROPOSED" &&
      item.value.trim() !== "",
  );
  if (prior !== undefined) {
    return {
      value: prior.value.trim(),
      source: "PRIOR_YEAR",
      label: "Proposed from the prior-year workpaper",
      quote: prior.quote,
      proposalId: prior.id,
    };
  }
  const usual = slot.options[0]?.trim() ?? "";
  if (usual === "") {
    return null;
  }
  return {
    value: usual,
    source: "USUAL",
    label:
      slot.options.length > 1
        ? `The usual answer, one of ${slot.options.length}`
        : "The usual answer",
    quote: "",
    proposalId: null,
  };
}

/** The other answers to choose from: the usual ones the suggestion is not. */
export function alternativesFor(
  slot: WalkSlot,
  suggestion: Suggestion | null,
): string[] {
  const taken = (suggestion?.value ?? "").toLowerCase();
  return [
    ...new Set(
      slot.options
        .map((item) => item.trim())
        .filter((item) => item !== "" && item.toLowerCase() !== taken),
    ),
  ];
}

/** The questions the filter keeps, in their order. */
export function walkSlots(
  slots: readonly WalkSlot[],
  filter: WalkFilter,
): WalkSlot[] {
  return slots.filter((slot) =>
    filter === "required"
      ? slot.blocks
      : filter === "open"
        ? slot.value.trim() === ""
        : true,
  );
}

/** Where each question stands: answered, the one asked now, skipped, or still to ask. */
export function walkStatus(
  slot: WalkSlot,
  current: string | null,
  skipped: ReadonlySet<string>,
): WalkStatus {
  if (slot.key === current) {
    return "IN_PROGRESS";
  }
  if (slot.value.trim() !== "") {
    return "CONFIRMED";
  }
  return skipped.has(slot.key) ? "SKIPPED" : "PENDING";
}

/** The next question to ask: the first unanswered and not skipped after the one given,
 * then from the start, then a skipped one; null once every question is answered. */
export function nextQuestion(
  slots: readonly WalkSlot[],
  skipped: ReadonlySet<string>,
  after: string | null = null,
  answered: ReadonlySet<string> = new Set(),
): string | null {
  const open = (slot: WalkSlot) =>
    slot.value.trim() === "" && !answered.has(slot.key);
  const start =
    after === null ? 0 : slots.findIndex((s) => s.key === after) + 1;
  const ordered = [...slots.slice(start), ...slots.slice(0, start)];
  return (
    ordered.find(
      (slot) => open(slot) && !skipped.has(slot.key) && slot.key !== after,
    )?.key ??
    ordered.find((slot) => open(slot) && slot.key !== after)?.key ??
    null
  );
}

/** How far the walkthrough is: answered of all, and the share. */
export function walkProgress(slots: readonly WalkSlot[]): {
  done: number;
  total: number;
  percent: number;
} {
  const done = slots.filter((slot) => slot.value.trim() !== "").length;
  return {
    done,
    total: slots.length,
    percent: slots.length === 0 ? 0 : Math.round((done / slots.length) * 100),
  };
}

/** A typed message that asks rather than answers: it goes to the agent console. */
export function isQuestion(text: string): boolean {
  const clean = text.trim();
  return (
    clean.endsWith("?") ||
    /^(what|why|how|which|who|where|when|can|could|should|is|are|does|do)\b/i.test(
      clean,
    )
  );
}

/** A document the records link to the control: a policy, procedure, narrative or diagram. */
export type WalkDocument = {
  id: string;
  title: string;
  detail: string;
  kind: string;
};

const DOCUMENT_WORDS = /\b(polic(y|ies)|procedures?|standards?)\b/i;

/** Whether a question asks for the client's document (which policy, which procedure). */
export function asksForDocument(slot: WalkSlot): boolean {
  return DOCUMENT_WORDS.test(
    `${slot.key.replaceAll("-", " ")} ${slot.question}`,
  );
}

/** The control's own policies and procedures to answer a document question with, the
 * policies first; none for any other question. */
export function documentsFor(
  slot: WalkSlot,
  documents: readonly WalkDocument[],
): WalkDocument[] {
  if (!asksForDocument(slot)) {
    return [];
  }
  const rank = (kind: string) =>
    kind === "POLICY" ? 0 : kind === "PROCEDURE" ? 1 : 2;
  return documents
    .filter((item) => item.kind === "POLICY" || item.kind === "PROCEDURE")
    .sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** The person's initials, from a name or an email address, for the conversation. */
export function initialsOf(who: string): string {
  const base = who.includes("@") ? (who.split("@")[0] ?? "") : who;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * A point the narrative's agents need the client to confirm (decided by the product owner
 * on 26 October 2026): their best understanding stated as a fact, or, where the records
 * suggest none, the question asked open. A round's points are shown together and confirmed
 * as one decision.
 */
export type WalkPoint = {
  id: string;
  version: number;
  topic: string;
  /** The statement to confirm; "" when the question is asked open. */
  statement: string;
  /** Where the statement comes from: the client's records and answers, or the usual
   * practice for a control of its kind (27 October 2026). */
  basis: "" | "SOURCES" | "TYPICAL";
  /** Other common answers, to pick instead of writing one. */
  options: string[];
  question: string;
  why: string;
  /** The narrative section it serves, as its heading; "" when none. */
  section: string;
  attributes: string[];
  contradiction: boolean;
};

type PointIssue = {
  id: string;
  version: number;
  status: string;
  topic: string;
  question: string;
  why: string;
  proposal: string;
  proposalBasis: "" | "SOURCES" | "TYPICAL";
  suggestions: string[];
  section: string;
  attributes: string[];
  pointKind: string;
};

/** The points still waiting for the client, in the order they were raised. */
export function walkPoints(
  issues: readonly PointIssue[],
  headings: Readonly<Record<string, string>>,
): WalkPoint[] {
  return issues
    .filter((issue) => issue.status === "OPEN" && issue.question !== "")
    .map((issue) => ({
      id: issue.id,
      version: issue.version,
      topic: issue.topic,
      statement: issue.proposal,
      basis: issue.proposal === "" ? "" : issue.proposalBasis || "TYPICAL",
      options: issue.suggestions.filter(
        (option) =>
          option.trim() !== "" && option.trim() !== issue.proposal.trim(),
      ),
      question: issue.question,
      why: issue.why,
      section: headings[issue.section] ?? "",
      attributes: issue.attributes,
      contradiction: issue.pointKind === "CONTRADICTION",
    }));
}

/** What a round's answers are, ready to send: each point's statement as confirmed, or the
 * person's correction. Null while a point asked open has no answer yet. */
export function pointAnswers(
  points: readonly WalkPoint[],
  edits: Readonly<Record<string, string>>,
): Array<{ issue_id: string; version: number; answer: string }> | null {
  const answers = points.map((point) => ({
    issue_id: point.id,
    version: point.version,
    answer: (edits[point.id] ?? point.statement).trim(),
  }));
  return answers.every((item) => item.answer !== "") ? answers : null;
}

/** "Confirmed 3 points." / "Confirmed 2 points and corrected 1." */
export function pointsSaid(
  points: readonly WalkPoint[],
  edits: Readonly<Record<string, string>>,
): string {
  const corrected = points.filter(
    (point) =>
      edits[point.id] !== undefined &&
      edits[point.id]?.trim() !== point.statement.trim(),
  ).length;
  const confirmed = points.length - corrected;
  const many = (count: number) => `${count} point${count === 1 ? "" : "s"}`;
  if (corrected === 0) {
    return `Confirmed ${many(confirmed)}.`;
  }
  if (confirmed === 0) {
    return `Answered ${many(corrected)}.`;
  }
  return `Confirmed ${many(confirmed)} and corrected ${corrected}.`;
}

/**
 * Where the client's answers stand once the narrative is approved (product owner, 27
 * October 2026: "if process narrative is already completed and approved do you still need
 * to show the client specific information?"): settled when the narrative is approved, every
 * question has its answer and no point waits, so the conversation folds to one line; and
 * the questions whose answer was saved after the approval, which the approved narrative
 * may no longer match.
 */
export function walkSettled(
  slots: ReadonlyArray<{ question: string; value: string; filledAt: string }>,
  narrative: { status: string; confirmedAt: string },
  points: number,
): { settled: boolean; answered: number; changed: string[] } {
  const approved = narrative.status === "CONFIRMED";
  const since = Date.parse(narrative.confirmedAt);
  const changed =
    approved && !Number.isNaN(since)
      ? slots
          .filter((slot) => {
            const at = Date.parse(slot.filledAt);
            return slot.value.trim() !== "" && !Number.isNaN(at) && at > since;
          })
          .map((slot) => slot.question)
      : [];
  const answered = slots.filter((slot) => slot.value.trim() !== "").length;
  return {
    settled: approved && points === 0 && answered === slots.length,
    answered,
    changed,
  };
}
