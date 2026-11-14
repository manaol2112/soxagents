/**
 * A control's context, as the control record shows it: its classification, its
 * attributes (approved, proposed, and their history), its process understanding where it
 * depends on one, its supporting documents, the open issues, and its readiness.
 *
 * Attributes belong to the control; documents support it; evidence is judged in testing.
 * None of it needs a process narrative.
 */

import {
  failureNoteOf,
  failureSentence,
  plainNote,
  withNext,
} from "./run-failure.ts";

export const CLASSIFICATIONS = [
  ["ITGC", "IT general control"],
  ["AUTOMATED_APPLICATION", "Automated application control"],
  ["IT_DEPENDENT_MANUAL", "IT-dependent manual control"],
  ["BUSINESS_PROCESS", "Business process control"],
  ["ENTITY_LEVEL", "Entity-level control"],
  ["KEY_REPORT", "Key report"],
  ["MANAGEMENT_REVIEW", "Management review control"],
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number][0];

export const DOCUMENT_KINDS = [
  ["NARRATIVE", "Process narrative"],
  ["POLICY", "Policy"],
  ["PROCEDURE", "Procedure or SOP"],
  ["FLOWCHART", "Flowchart"],
  ["WALKTHROUGH", "Walkthrough notes"],
  ["SYSTEM", "System documentation"],
  ["PRIOR_YEAR", "Prior-year workpaper"],
  ["OTHER", "Other"],
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number][0];

export type ReadinessState =
  | "READY"
  | "NEEDS_INFORMATION"
  | "PLAN_NOT_APPROVED"
  | "PROCESS_UNDERSTANDING_INCOMPLETE"
  | "EVIDENCE_PENDING"
  | "CONFLICT_REQUIRES_REVIEW"
  | "IMPACT_PENDING"
  | "READY_FOR_REVIEW"
  | "CONCLUDED";

export const READINESS_STATES: readonly ReadinessState[] = [
  "READY",
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "EVIDENCE_PENDING",
  "CONFLICT_REQUIRES_REVIEW",
  "IMPACT_PENDING",
  "READY_FOR_REVIEW",
  "CONCLUDED",
];

/** The states that stop testing: samples cannot be approved and the tester waits. */
export const BLOCKING_STATES: readonly ReadinessState[] = [
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "CONFLICT_REQUIRES_REVIEW",
];

export const STATE_LABELS: Record<ReadinessState, string> = {
  READY: "Ready to test",
  NEEDS_INFORMATION: "Needs information",
  PLAN_NOT_APPROVED: "Test plan awaiting approval",
  PROCESS_UNDERSTANDING_INCOMPLETE: "Process understanding incomplete",
  EVIDENCE_PENDING: "Evidence pending",
  CONFLICT_REQUIRES_REVIEW: "Conflict to review",
  IMPACT_PENDING: "Impact assessment pending",
  READY_FOR_REVIEW: "Ready for review",
  CONCLUDED: "Concluded",
};

export type CheckStatus =
  | "OK"
  | "BLOCKED"
  | "WARN"
  | "PENDING"
  | "NOT_APPLICABLE";
export type Blocker = { detail: string; why: string; resolve: string };
export type ReadinessCheck = {
  key: "plan" | "criteria" | "process" | "evidence" | "scope" | "conflicts";
  title: string;
  status: CheckStatus;
  summary: string;
  blockers: Blocker[];
};
export type Readiness = {
  state: ReadinessState;
  label: string;
  processRequired: boolean;
  checks: ReadinessCheck[];
};

export type Attribute = {
  id: string;
  position: number;
  text: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED" | "SUPERSEDED";
  basis: "DOCUMENTED" | "INFERRED";
  sourceKind: "LIBRARY" | "RCM" | "MANUAL" | "AGENT" | "DOCUMENT";
  sourceDocumentId: string | null;
  sourceTitle: string;
  sourceQuote: string;
  note: string;
  proposal: "ADD" | "CHANGE" | "RETIRE" | null;
  replacesId: string | null;
  decidedBy: string | null;
  version: number;
  /** How the attribute is tested, for a library version 3 attribute: the standard's
   * requirement the tailored criteria must meet. */
  definition: AttributeDefinition | null;
  /** The criteria tailored to this control (11 November 2026), what the testers judge
   * evidence against. */
  criteria: AttributeCriteria;
  /** The reviewer agent's verdict on the attribute as it reads now (12 November 2026), or
   * null when it was not reviewed or changed since. Agent output, never an approval. */
  review: AttributeReview | null;
  /** What the agent followed in the confirmed understanding, and what it set aside, where
   * the attribute differs from the RCM record, the library or an earlier answer (product
   * owner, 12 November 2026: the understanding is the authority, the newer answer wins).
   * Agent output; null or absent where it followed nothing over anything. */
  understandingBasis?: UnderstandingBasis | null;
};

export type UnderstandingBasis = {
  summary: string;
  follows: {
    /** The answer as recorded, with its question; the agent's paraphrase beside it. */
    answer: string;
    question: string;
    statement: string;
    confirmedAt: string;
    /** A person confirmed it, or the records filled it in: never worded as a person's
     * confirmation when it is the records'. */
    confirmedBy: "PERSON" | "RECORDS";
  };
  setsAside: Array<{
    kind:
      | "OLDER_ANSWER"
      | "RCM_RECORD"
      | "LIBRARY_WORDING"
      | "APPROVED_ATTRIBUTE";
    /** An older answer as recorded; "" for the other kinds, which carry a statement. */
    answer: string;
    statement: string;
    confirmedAt: string;
  }>;
};

const SET_ASIDE_LABELS: Record<
  UnderstandingBasis["setsAside"][number]["kind"],
  string
> = {
  OLDER_ANSWER: "An earlier answer",
  RCM_RECORD: "The RCM record",
  LIBRARY_WORDING: "The library's wording",
  APPROVED_ATTRIBUTE: "The attribute as it read",
};

/** A day as the line names it ("29 October 2026"), or "" for no date or one not readable. */
function dayOf(value: string): string {
  const at = value === "" ? Number.NaN : Date.parse(value);
  return Number.isNaN(at)
    ? ""
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(at));
}

/**
 * The lines an attribute shows for what the agent followed and set aside: never silent, so
 * the person accepting the attribute sees which answer it rests on. What was confirmed is
 * shown as recorded (the question and its answer), not as the agent put it. Null where there
 * is no record.
 */
export function basisLines(
  basis: UnderstandingBasis | null | undefined,
): { follows: string; setsAside: string[] } | null {
  if (basis === null || basis === undefined) {
    return null;
  }
  const { follows } = basis;
  const said = follows.answer !== "" ? follows.answer : follows.statement;
  const asked =
    follows.answer !== "" && follows.question !== ""
      ? `${follows.question} `
      : "";
  const day = dayOf(follows.confirmedAt);
  const when =
    follows.confirmedBy === "RECORDS"
      ? ` (from the records${day !== "" ? `, ${day}` : ""})`
      : day !== ""
        ? ` (confirmed ${day})`
        : "";
  return {
    follows: `${asked}${said}${when}`,
    setsAside: basis.setsAside.map((item) => {
      const answered = dayOf(item.confirmedAt);
      return `${SET_ASIDE_LABELS[item.kind]}: ${
        item.answer !== "" ? item.answer : item.statement
      }${answered !== "" ? ` (answered ${answered})` : ""}`;
    }),
  };
}

function parseBasis(value: unknown): UnderstandingBasis | null {
  if (!isRecord(value) || !isRecord(value.follows)) {
    return null;
  }
  const follows = {
    answer: str(value.follows.answer),
    question: str(value.follows.question),
    statement: str(value.follows.statement),
    confirmedAt: str(value.follows.confirmed_at),
    confirmedBy: oneOf(
      value.follows.confirmed_by,
      ["PERSON", "RECORDS"] as const,
      "RECORDS",
    ),
  };
  const setsAside = records(value.sets_aside)
    .map((item) => ({
      kind: oneOf(
        item.kind,
        [
          "OLDER_ANSWER",
          "RCM_RECORD",
          "LIBRARY_WORDING",
          "APPROVED_ATTRIBUTE",
        ] as const,
        "OLDER_ANSWER",
      ),
      answer: str(item.answer),
      statement: str(item.statement),
      confirmedAt: str(item.confirmed_at),
    }))
    .filter((item) => item.answer !== "" || item.statement !== "")
    .slice(0, 3);
  if (
    (follows.answer === "" && follows.statement === "") ||
    setsAside.length === 0
  ) {
    return null;
  }
  return { summary: str(value.summary), follows, setsAside };
}

export type AttributeReview = {
  verdict: "OK" | "REVISED" | "CONCERN";
  note: string;
};

/** The reviewer agent's latest review of the control's attributes as a set. */
export type AttributeReviewSummary = {
  status: "REVIEWED" | "NOT_REVIEWED";
  reviewedAt: string;
  reviewer: string;
  note: string;
  findings: string[];
  concerns: number;
};

/** Whether the agents are updating the attributes now, and what they are doing. */
/** STOPPED: their last run did not finish (its process died, it failed, or the planner's
 * answer could not be used); never shown as working. */
export type AttributesRun = "" | "PENDING" | "WORKING" | "STOPPED";
export type AttributesStage = "" | "ATTRIBUTES" | "CRITERIA" | "REVIEW";

/** An attribute's criteria as tailored to the control: who stated them (a person, the
 * planner agent, or the demo), who accepted the agent's, and whether a person owns them
 * (control_attributes.CRITERIA_OWNED_SQL). */
export type AttributeCriteria = {
  objective: string;
  condition: string;
  passCriteria: string;
  failCriteria: string;
  judgmentRequired: boolean | null;
  automatable: boolean | null;
  phases: string[];
  origin: "PERSON" | "AGENT" | "SEEDED" | null;
  acceptedBy: string;
  acceptedAt: string;
  owned: boolean;
};

export type CriteriaState = "OWNED" | "TO_ACCEPT" | "MISSING";

/** Where an approved attribute's criteria stand: owned by a person; tailored by the agent
 * (or prepared with the demo) for a person to accept; or not tailored yet. */
export function criteriaState(criteria: AttributeCriteria): CriteriaState {
  if (criteria.owned) {
    return "OWNED";
  }
  const stated =
    criteria.judgmentRequired === true ||
    (criteria.condition !== "" &&
      criteria.passCriteria !== "" &&
      criteria.failCriteria !== "");
  return stated && (criteria.origin === "AGENT" || criteria.origin === "SEEDED")
    ? "TO_ACCEPT"
    : "MISSING";
}

/** The approved attributes whose criteria a person can accept as they read. */
export function criteriaToAccept(context: {
  approved: Attribute[];
}): Attribute[] {
  return context.approved.filter(
    (item) => criteriaState(item.criteria) === "TO_ACCEPT",
  );
}

/** How many approved attributes have no criteria a person owns yet. */
export function untailored(context: { approved: Attribute[] }): number {
  return context.approved.filter((item) => !item.criteria.owned).length;
}

/** Where a row of the Attributes step stands (product owner, 11 November 2026): an agent
 * proposal to decide, tailored criteria to accept, criteria still to write, or accepted. */
export type AttributeRowState =
  | "PROPOSED"
  | "TO_ACCEPT"
  | "MISSING"
  | "ACCEPTED";

export function attributeRowState(
  item: Pick<Attribute, "status" | "criteria">,
): AttributeRowState {
  if (item.status === "PROPOSED") {
    return "PROPOSED";
  }
  const state = criteriaState(item.criteria);
  return state === "OWNED" ? "ACCEPTED" : state;
}

/** Each row's chip: its state in words, and the tone that repeats it. Agent output that no
 * person has decided is violet; it is never styled as accepted. */
export const ATTRIBUTE_ROW_CHIPS: Record<
  AttributeRowState,
  { label: string; tone: "ai" | "warning" | "success" }
> = {
  PROPOSED: { label: "Proposed", tone: "ai" },
  TO_ACCEPT: { label: "To accept", tone: "ai" },
  MISSING: { label: "Needs criteria", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "success" },
};

/** One list for the Attributes step (product owner, 12 November 2026: "I don't want it to
 * show propose then the user would have to approve separately"): the attributes as the
 * agent proposes them to stand. An addition is a row of its own, a rewording shows its new
 * wording in the place of the attribute it replaces, and a retirement marks the attribute
 * it would remove. The agent's changes are still proposals on the record until a person
 * accepts the row; the list only shows them where they would land. */
export type UnifiedKind = "APPROVED" | "ADDED" | "REWORDED" | "REMOVAL";

export type UnifiedRow = {
  /** The record the row's decision applies to: the approved attribute, or the proposal. */
  item: Attribute;
  kind: UnifiedKind;
  /** The approved attribute a rewording replaces or a retirement removes. */
  target: Attribute | null;
  /** The row's letter: its place among the approved attributes; an addition takes the next
   * letter after them, the one it will have once accepted (product owner, 12 November
   * 2026: "if you are proposing, there should be an assigned letter"). */
  letter: string;
};

export function unifiedRows(context: {
  approved: Attribute[];
  proposed: Attribute[];
}): UnifiedRow[] {
  const taken = new Set<string>();
  const byTarget = new Map<string, Attribute>();
  for (const proposal of context.proposed) {
    const target = proposal.replacesId;
    if (
      (proposal.proposal === "CHANGE" || proposal.proposal === "RETIRE") &&
      target !== null &&
      !byTarget.has(target) &&
      context.approved.some((item) => item.id === target)
    ) {
      byTarget.set(target, proposal);
      taken.add(proposal.id);
    }
  }
  const rows: UnifiedRow[] = context.approved.map((item, index) => {
    const letter = attributeLetter(index);
    const proposal = byTarget.get(item.id);
    return proposal === undefined
      ? { item, kind: "APPROVED", target: null, letter }
      : {
          item: proposal,
          kind: proposal.proposal === "RETIRE" ? "REMOVAL" : "REWORDED",
          target: item,
          letter,
        };
  });
  // Additions follow as rows of their own. So does a change or a retirement that has no
  // row to sit in (its attribute was decided meanwhile, or it is a second proposal for the
  // same attribute): it is shown as what it is, never as an addition.
  let next = context.approved.length;
  for (const proposal of context.proposed) {
    if (!taken.has(proposal.id)) {
      rows.push({
        item: proposal,
        kind:
          proposal.proposal === "RETIRE"
            ? "REMOVAL"
            : proposal.proposal === "CHANGE"
              ? "REWORDED"
              : "ADDED",
        target: null,
        letter: attributeLetter(next),
      });
      next += 1;
    }
  }
  return rows;
}

/** Where a row of the unified list stands. The agent's changes and its tailored criteria
 * both wait for one acceptance; nothing an agent wrote reads as accepted. */
export type UnifiedState = "UPDATING" | "TO_ACCEPT" | "MISSING" | "ACCEPTED";

export function unifiedState(row: UnifiedRow, running: boolean): UnifiedState {
  if (running) {
    return "UPDATING";
  }
  if (row.kind !== "APPROVED") {
    return "TO_ACCEPT";
  }
  const state = criteriaState(row.item.criteria);
  return state === "OWNED" ? "ACCEPTED" : state;
}

export const UNIFIED_CHIPS: Record<
  UnifiedState,
  { label: string; tone: "ai" | "warning" | "success" }
> = {
  UPDATING: { label: "Updating…", tone: "ai" },
  TO_ACCEPT: { label: "To accept", tone: "ai" },
  MISSING: { label: "Needs criteria", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "success" },
};

/** What the agent did to the row, under its wording; "" for an attribute it left alone. */
export const UNIFIED_ORIGINS: Record<UnifiedKind, string> = {
  APPROVED: "",
  ADDED: "Added by the agent",
  REWORDED: "Reworded by the agent",
  REMOVAL: "Agent suggests removing",
};

/** The rows one acceptance covers: every change the agent proposed, and every approved
 * attribute whose tailored criteria wait. Each at the version shown. */
export function acceptableRows(rows: readonly UnifiedRow[]): UnifiedRow[] {
  return rows.filter((row) => unifiedState(row, false) === "TO_ACCEPT");
}

export function acceptItems(
  rows: readonly UnifiedRow[],
): Array<{ attribute_id: string; version: number }> {
  return acceptableRows(rows).map((row) => ({
    attribute_id: row.item.id,
    version: row.item.version,
  }));
}

/** The first row of the unified list that waits on a person, to start open. */
export function firstUnifiedToDecide(
  rows: readonly UnifiedRow[],
): string | null {
  return (
    rows.find((row) => unifiedState(row, false) !== "ACCEPTED")?.item.id ?? null
  );
}

/** When the reviewer agent's review did not finish: said as the run's status, so nobody
 * takes the attributes as reviewed. Null otherwise. The reviewer's own notes (its verdicts,
 * reasons and findings) are kept on the record and not shown here (product owner, 12
 * November 2026: "I don't need to see this note from the reviewer agent. Any note from the
 * reviewer."). */
export function reviewUnfinished(
  summary: AttributeReviewSummary | null,
): string | null {
  if (summary === null || summary.status === "REVIEWED") {
    return null;
  }
  return "The reviewer agent did not finish, so these are not reviewed.";
}

/** What the agents are doing while they update the attributes, or null when they are not. */
export function attributesWorking(
  run: AttributesRun,
  stage: AttributesStage,
): string | null {
  if (run === "" || run === "STOPPED") {
    return null;
  }
  if (run === "PENDING") {
    return "Queued: the agents will update the attributes from the understanding";
  }
  switch (stage) {
    case "ATTRIBUTES":
      return "Proposing attributes from the understanding";
    case "CRITERIA":
      return "Tailoring pass/fail criteria";
    case "REVIEW":
      return "Reviewing against the control and its understanding";
    default:
      return "The planner is tailoring the attributes and their criteria from the understanding";
  }
}

/** What to say when the agents' last run did not finish, or null: the server's note, so
 * the step never shows a run as working once nobody is working on it. */
export function attributesStopped(
  run: AttributesRun,
  note: string,
  rerunUseful: boolean | null = null,
): string | null {
  // Nothing waits on the agents: a stopped run is not this person's problem to read about
  // (product owner, 12 November 2026: "Why do I also keep getting this error?").
  if (run !== "STOPPED" || rerunUseful === false) {
    return null;
  }
  return note !== "" ? note : "The run stopped before it finished. Run again.";
}

/** The context's field for the attributes run's failure sentence: the run's record is
 * flattened onto the context, as `attributes_run_note` is (run-failure.ts). */
export const ATTRIBUTES_FAILURE_FIELD = "attributes_failure_note";

/** The planner's answer was rejected and the plan kept as it was: the server's notes for
 * it (UNUSABLE_NOTE and KEPT_NOTE in evidence_plans) both start so. */
const PLANNER_UNUSABLE = /^The planner's answer could not be used\b/;

/** What the Attributes step says when "Run again" finished and the planner's answer could
 * not be used while an attribute still needs criteria (product owner, 13 November 2026). */
export const CRITERIA_NOT_WRITTEN =
  "The planner's answer could not be used, so the criteria were not written. The earlier plan is kept. Run again, or write the criteria yourself.";

const STOPPED_LINE = "The run stopped before it finished. Run again.";
const CRITERIA_NEXT = "Run again, or write the criteria yourself.";

/** The approved attributes with no criteria a tester can apply, in their order, each with
 * its letter: what "Write criteria" opens. */
export function needingCriteria(context: {
  approved: Attribute[];
}): Array<{ item: Attribute; letter: string }> {
  return context.approved
    .map((item, index) => ({ item, letter: attributeLetter(index) }))
    .filter(({ item }) => criteriaState(item.criteria) === "MISSING");
}

/** An attribute whose criteria the planner wrote into a change to a person-approved test
 * plan (the plan's pending revision): written, and waiting for that change to be decided. */
export type PendingCriteria = { attributeId: string; code: string };

type PendingInput = {
  approved: Attribute[];
  attributesPendingCriteria?: readonly PendingCriteria[];
  planRevisionPending?: boolean | null;
};

/** The attributes that need criteria because the planner's criteria wait in the plan's
 * pending revision, in their order with their letters; empty where no revision waits. */
export function pendingCriteria(
  context: PendingInput,
): Array<{ item: Attribute; letter: string }> {
  const waiting = new Set(
    (context.attributesPendingCriteria ?? []).map((item) => item.attributeId),
  );
  if (waiting.size === 0 || context.planRevisionPending === false) {
    return [];
  }
  return needingCriteria(context).filter(({ item }) => waiting.has(item.id));
}

/** The attributes that need criteria a person writes, or a run writes again: those not
 * waiting in the plan's pending revision. What "Write criteria" opens. */
export function criteriaToWrite(
  context: PendingInput,
): Array<{ item: Attribute; letter: string }> {
  const pending = new Set(pendingCriteria(context).map(({ item }) => item.id));
  return needingCriteria(context).filter(({ item }) => !pending.has(item.id));
}

const lettersSaid = (letters: readonly string[]): string =>
  letters.length === 1
    ? (letters[0] ?? "")
    : `${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}`;

/** What the Attributes step says when the planner's criteria wait in a change to the test
 * plan (product owner's case, 13 November 2026: the criteria were written, but into the
 * approved plan's pending revision), or null. The step links to where the change is
 * decided. */
export function pendingCriteriaLine(context: PendingInput): string | null {
  const pending = pendingCriteria(context);
  if (pending.length === 0) {
    return null;
  }
  return `The planner proposed criteria for ${lettersSaid(pending.map(({ letter }) => letter))} in a change to the test plan. Review the change to apply them.`;
}

/** One agent's part in the latest attributes run (`attributes_agent_notes`). */
export type AttributesAgentNote = {
  agent: string;
  step: string;
  /** What failed, in a sentence; "" when the agent's part did not fail. */
  failed: string;
  /** What was kept, in a sentence; "" when nothing needed keeping. */
  kept: string;
  nextStep: string;
  sentence: string;
  at: string;
};

/** The failed agents' sentences of the latest run, each with what was kept, joined: what
 * stands in where the run sent no failure sentence of its own; "" when no agent failed. */
export function agentNotesSentence(
  notes: readonly AttributesAgentNote[] | undefined,
): string {
  const parts: string[] = [];
  for (const note of notes ?? []) {
    if (note.failed.trim() === "") {
      continue;
    }
    const what = plainNote(note.sentence) || plainNote(note.failed);
    const kept = plainNote(note.kept);
    for (const part of [what, kept]) {
      if (part !== "" && !parts.some((each) => each.includes(part))) {
        parts.push(part);
      }
    }
  }
  return plainNote(parts.join(" "));
}

/** What the Attributes step says, quietly, when the agents' last run could not be used and
 * every attribute has its criteria (lead's decision, 13 November 2026): a run a person
 * asked for never ends in silence, but settled work shows no error and no Run again (the
 * 12 November rule). */
export const SETTLED_RUN_LEAD =
  "The agents' last run could not be used. Your attributes and criteria are unchanged.";

/** The server's failure sentence for the attributes run: its own, else its agents'. */
function attributesFailureOf(context: {
  attributesFailureNote?: string;
  attributesAgentNotes?: readonly AttributesAgentNote[];
}): string {
  return (
    plainNote(context.attributesFailureNote) ||
    agentNotesSentence(context.attributesAgentNotes)
  );
}

/** The quiet line for a run that could not be used on attributes that all have their
 * criteria, or null: SETTLED_RUN_LEAD, then the server's sentence. Never while the agents
 * work, and never with an action. */
export function settledRunLine(
  context: {
    attributesRun: AttributesRun;
    attributesFailureNote?: string;
    attributesAgentNotes?: readonly AttributesAgentNote[];
    approved: Attribute[];
  },
  failureNote: string = attributesFailureOf(context),
): string | null {
  if (
    context.attributesRun === "PENDING" ||
    context.attributesRun === "WORKING"
  ) {
    return null;
  }
  const said = plainNote(failureNote);
  if (said === "" || !allHaveCriteria(context)) {
    return null;
  }
  // The line offers no Run again, so the server's own "Run again" is not repeated.
  const why = withoutRunAgain(said);
  return why === "" ? SETTLED_RUN_LEAD : `${SETTLED_RUN_LEAD} ${why}`;
}

/** Settled for the quiet line: the control has approved attributes and every one has its
 * criteria. A control with none gets the failure line with its Run again. */
function allHaveCriteria(context: { approved: Attribute[] }): boolean {
  return context.approved.length > 0 && needingCriteria(context).length === 0;
}

/** A sentence without its closing call to run the agents again: a last sentence that
 * starts "Run again" (or "Run them again"), or a last clause such as ", so run them
 * again". What remains is plain; "" when nothing does. */
export function withoutRunAgain(text: string): string {
  const parts = plainNote(text).split(/(?<=[.!?])\s+/);
  const last = parts.at(-1) ?? "";
  if (/^(?:Please )?run (?:it |them |the agents )?again\b/i.test(last)) {
    parts.pop();
  } else if (parts.length > 0) {
    parts[parts.length - 1] = last.replace(
      /[,;:]?\s*(?:(?:so|and|or|then|please)\s+)?run (?:it |them |the agents )?again\b[^.!?]*([.!?])$/i,
      "$1",
    );
  }
  return plainNote(parts.join(" "));
}

/**
 * The Attributes step's one sentence for an agents' run that ended without a usable
 * answer, or null while they work or when nothing needs saying. The server's failure
 * sentence (`failureNote`, else the context's own) leads, then the run's note. When an
 * approved attribute still needs criteria, the sentence says so with both ways on: run
 * again, or write the criteria (the step offers both beside it). A run that stopped on
 * settled work is not shown (attributesStopped); one that left criteria missing always is,
 * even where nothing the agents read has changed since.
 */
export function runFailureLine(
  context: {
    attributesRun: AttributesRun;
    attributesRunNote: string;
    attributesRerunUseful?: boolean | null;
    attributesFailureNote?: string;
    attributesAgentNotes?: readonly AttributesAgentNote[];
    attributesPendingCriteria?: readonly PendingCriteria[];
    planRevisionPending?: boolean | null;
    approved: Attribute[];
    proposed: Attribute[];
    reviewSummary: AttributeReviewSummary | null;
  },
  failureNote: string = attributesFailureOf(context),
): string | null {
  const run = context.attributesRun;
  if (run === "PENDING" || run === "WORKING") {
    return null;
  }
  const said = plainNote(failureNote);
  const note = plainNote(context.attributesRunNote);
  // Criteria waiting in the plan's pending revision were written: said by
  // pendingCriteriaLine, never as an answer that could not be used.
  const missing = criteriaToWrite(context);
  const waiting = pendingCriteria(context).length > 0;
  const settled = context.attributesRerunUseful === false;
  // Every attribute has its criteria and the server said why the run could not be used:
  // the quiet settledRunLine, never an error.
  if (said !== "" && allHaveCriteria(context)) {
    return null;
  }
  if (run === "STOPPED" || said !== "") {
    const unusable = PLANNER_UNUSABLE.test(said) || PLANNER_UNUSABLE.test(note);
    // Settled work shows no error (12 November 2026); a control with no approved
    // attribute is not settled, and gets this line with its Run again.
    if (
      missing.length === 0 &&
      ((settled && context.approved.length > 0) || (waiting && unusable))
    ) {
      return null;
    }
    if (missing.length > 0) {
      return unusable
        ? CRITERIA_NOT_WRITTEN
        : withNext(failureSentence(STOPPED_LINE, said, note), CRITERIA_NEXT);
    }
    return failureSentence(STOPPED_LINE, said, note);
  }
  // The run finished as far as the server says, nothing the agents read has changed since,
  // and still an attribute has no criteria: their last run did not write them. Said, so
  // the step never ends a run with "Needs criteria" and nothing else.
  if (missing.length > 0 && settled && agentRan(context)) {
    const letters = missing.map(({ letter }) => letter);
    const which =
      letters.length === 1
        ? `attribute ${letters[0]}`
        : `attributes ${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}`;
    return `The agents' last run did not write the criteria for ${which}, so ${letters.length === 1 ? "it still needs" : "they still need"} criteria. ${CRITERIA_NEXT}`;
  }
  return null;
}

/**
 * Whether the list offers the agents: always the first time ("Propose with the agent"), and
 * again ("Run again") only when it would do something. On settled work, with nothing the
 * agents read changed, the action is not shown (product owner, 12 November 2026: "If
 * attributes are all accepted, do you think it's worth showing the run again?"). A change to
 * the understanding starts the run by itself.
 */
export function offersAgentRun(
  ran: boolean,
  rerunUseful: boolean | null | undefined,
): boolean {
  return !ran || rerunUseful !== false;
}

/**
 * The agents' open questions that can change the attributes, said where the attributes are
 * accepted (product owner, 14 November 2026: "I don't want to have any follow-up questions
 * when the attributes are already approved and accepted"). The guided setup asks them in
 * Control Understanding; accepting the attributes closes them on the server
 * (control_attributes.close_questions_once_accepted), and a run on accepted attributes asks
 * none. The same questions the server closes: the agents' own, on the attributes, their
 * sources or the process (control_context.FOLLOW_UP_ORIGINS). Null when none is open.
 */
export function openAttributeQuestionsLine(
  issues: ReadonlyArray<
    Pick<ContextIssue, "origin" | "status" | "topic" | "raisedBy">
  >,
  toAccept: boolean,
): string | null {
  const open = issues.filter(
    (issue) => issue.status === "OPEN" && issue.raisedBy === "AGENT",
  );
  if (open.length === 0) {
    return null;
  }
  const topics = open
    .slice(0, 3)
    .map((issue) => issue.topic.trim())
    .filter((topic) => topic !== "");
  const more = open.length > topics.length ? "; and more" : "";
  const about = topics.length > 0 ? ` (${topics.join("; ")}${more})` : "";
  const asked =
    open.length === 1
      ? `The agents raised a question that can change these attributes${about}.`
      : `The agents raised ${open.length} questions that can change these attributes${about}.`;
  const them = open.length === 1 ? "it" : "them";
  return toAccept
    ? `${asked} Answer ${them} in Control Understanding, or accept the attributes as they are: accepting closes ${them}.`
    : `${asked} Answer ${them} in Control Understanding.`;
}

/** Whether an agent has already worked on the attributes, so asking again is a re-run. */
export function agentRan(context: {
  approved: Attribute[];
  proposed: Attribute[];
  reviewSummary: AttributeReviewSummary | null;
  attributesRun?: AttributesRun;
}): boolean {
  return (
    context.attributesRun === "STOPPED" ||
    context.reviewSummary !== null ||
    context.proposed.some((item) => item.sourceKind !== "MANUAL") ||
    context.approved.some(
      (item) => item.criteria.origin === "AGENT" || item.sourceKind === "AGENT",
    )
  );
}

/** The row that starts open: the first, in the list's order, that waits on a person. */
export function firstToDecide(
  items: readonly Pick<Attribute, "id" | "status" | "criteria">[],
): string | null {
  return (
    items.find((item) => attributeRowState(item) !== "ACCEPTED")?.id ?? null
  );
}

/** Which rows are open: the ones the person chose, once they have opened or closed one;
 * until then the first that waits on a person, so it follows the list as decisions land. */
export function openRows(
  chosen: ReadonlySet<string> | null,
  items: readonly Pick<Attribute, "id" | "status" | "criteria">[],
): ReadonlySet<string> {
  if (chosen !== null) {
    return chosen;
  }
  const first = firstToDecide(items);
  return new Set(first !== null ? [first] : []);
}

/** Where the wording came from, as a row's small line. */
const SOURCE_LINES: Record<Attribute["sourceKind"], string> = {
  LIBRARY: "Library standard",
  RCM: "Organization's RCM",
  MANUAL: "Written by the team",
  AGENT: "Drafted by the agent",
  DOCUMENT: "Supporting document",
};

/** A row's source line: where the wording came from, then who tailored the criteria (an
 * approved attribute) or whether a proposal is inferred rather than stated in a source. */
export function attributeSourceLine(
  item: Pick<
    Attribute,
    "status" | "sourceKind" | "sourceTitle" | "basis" | "criteria"
  >,
): string {
  const from =
    item.sourceKind === "DOCUMENT" && item.sourceTitle.trim() !== ""
      ? `From ${item.sourceTitle.trim()}`
      : SOURCE_LINES[item.sourceKind];
  if (item.status === "PROPOSED") {
    return item.basis === "INFERRED" ? `${from} · inferred` : from;
  }
  const origin = item.criteria.origin;
  if (origin === "AGENT" || origin === "SEEDED") {
    return `${from} · tailored by the agent`;
  }
  if (origin === "PERSON" && item.sourceKind !== "MANUAL") {
    return `${from} · criteria by the team`;
  }
  return from;
}

export type Confidence = "HIGH" | "MODERATE" | "LOW" | "NOT_ESTABLISHED";
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  HIGH: "High confidence",
  MODERATE: "Moderate confidence",
  LOW: "Low confidence",
  NOT_ESTABLISHED: "Not established",
};

export type AttributeDefinition = {
  key: string;
  confidence: Confidence;
  condition: string;
  why: string;
  evidence: string[];
  extract: string[];
  compare: string;
  passes: string;
  fails: string;
  insufficient: string;
  review: string;
  notInfer: string;
  basis: string[];
  question: string;
  blocks: boolean;
};

export type Procedure = {
  key: string;
  phase: "DESIGN" | "OPERATING" | "ROLLFORWARD";
  objective: string;
  action: string;
  evidence: string[];
  attributes: string[];
  limitation: string;
};

export const PROCEDURE_PHASES: Record<Procedure["phase"], string> = {
  DESIGN: "Design",
  OPERATING: "Operating effectiveness",
  ROLLFORWARD: "Roll-forward",
};

/** How a library control is tested under version 3. */
export type Testing = {
  version: number;
  objective: string;
  controlType: string;
  population: string;
  sampling: string;
  procedures: Procedure[];
  designConfirmation: string;
  assumptions: string[];
  questions: string[];
  notApplicable: string[];
};

export type LibraryChange = {
  change: "KEEP" | "REWORD" | "ADD" | "PROPOSE" | "RETIRE";
  key: string;
  text: string;
  was: string;
  reason: string;
  confidence: string;
};

/** What adopting the current library version would change on an older copy. */
export type LibraryUpdate = {
  libraryVersion: number;
  currentVersion: number;
  items: LibraryChange[];
  note: string;
  /** Changes to the control's own description (title, activity, risk, frequency, nature). */
  fields: Array<{ field: string; was: string; now: string }>;
  /** Controls split out of this one, added when it is adopted. */
  splits: Array<{ controlRef: string; title: string; reason: string }>;
};

/** A value only the client knows, filled at setup (milestone 8.9). */
export type DesignSlot = {
  key: string;
  label: string;
  kind: string;
  why: string;
  example: string;
  blocks: boolean;
  value: string;
  automatic: boolean;
  filledBy: string | null;
  /** When its answer was last saved, as an ISO time, or "". */
  filledAt: string;
  version: number;
  /** The answers usually given, to choose from (slot_options.py). */
  options: string[];
  /** The value as a question to the client (slot_questions.py). */
  question: string;
  /** How to answer it, for whoever fills it in (slot_questions.hint_for). */
  hint: string;
  /** A governing document's name, answered from a document linked to the control
   * (slot_questions.asks_for_document). */
  document: boolean;
};

/** The control's design, as its documentation states it, with the client's values. */
export type Design = {
  text: string;
  risk: string;
  itRisk: string;
  principle: string;
  assertions: string[];
  controlType: string;
  nature: string;
  frequency: string;
  operator: string;
  reviewer: string;
  owner: string;
  authority: string;
  judgment: string;
  judgmentNote: string;
  precision: string;
  investigation: string;
  information: Array<{
    name: string;
    kind: string;
    elements: string[];
    ipe: string;
  }>;
  itgcs: string[];
  evidence: string;
  appliesWhen: string;
  slots: DesignSlot[];
  missing: string[];
};

export const TYPE_LABELS: Record<string, string> = {
  PREVENTIVE: "Preventive",
  DETECTIVE: "Detective",
};
export const NATURE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  AUTOMATED: "Automated",
  IT_DEPENDENT_MANUAL: "IT-dependent manual",
};
export const FREQUENCY_LABELS: Record<string, string> = {
  ANNUAL: "Annual",
  QUARTERLY: "Quarterly",
  MONTHLY: "Monthly",
  WEEKLY: "Weekly",
  DAILY: "Daily",
  RECURRING: "Each transaction",
  EVENT_DRIVEN: "Each occurrence",
};

export type InterviewStep = {
  key: string;
  question: string;
  why: string;
  /** The label the records or usual practice point to; "" when none does. */
  usual: string;
  basis: string;
  answers: Array<{
    label: string;
    /** The full sentence this answer means: what the audit file records. */
    says: string;
    /** The next step's key; "" ends the interview. */
    next: string;
  }>;
};

export type ContextIssue = {
  id: string;
  origin: "ATTRIBUTES" | "PROCESS" | "SOURCES";
  kind: "MISSING" | "AMBIGUOUS" | "CONFLICT";
  topic: string;
  detail: string;
  why: string;
  resolve: string;
  quotes: Array<{ source: string; title: string; quote: string }>;
  raisedBy: "AGENT" | "RULES";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolutionNote: string;
  version: number;
  /** A question the narrative's agents need the client to answer (0117), and the answers
   * the records suggest; empty for any other issue. */
  question: string;
  suggestions: string[];
  /** A point to confirm (0118): the agents' statement of the fact (empty when the question
   * is asked open), the narrative section and attribute codes it serves, its round, and
   * whether it is a missing fact or a contradiction. */
  proposal: string;
  section: string;
  attributes: string[];
  round: number;
  pointKind: "" | "MISSING" | "CONTRADICTION";
  /** Where the statement comes from (0121): the client's records and answers, or the
   * usual practice for a control of its kind; "" when asked open. */
  proposalBasis: "" | "SOURCES" | "TYPICAL";
  /** The reviewer agent wrote its interview and the checks cleared it (0140, 0141). */
  wordingReviewed?: boolean;
  /** The question as short steps, each answer leading on or ending it; [] until written. */
  interview?: InterviewStep[];
};

export type SupportingDocument = {
  id: string;
  kind: DocumentKind;
  title: string;
  fileName: string;
  origin: "UPLOAD" | "WRITTEN" | "AGENT";
  characters: number;
  excerpt: string;
  createdBy: string | null;
  controlIds: string[];
  reviewed: boolean;
};

export type StepBasis = "DOCUMENTED" | "INFERRED" | "TEAM";
export type ProcessStep = {
  key: string;
  description: string;
  actor: string;
  system: string;
  controlPoint: boolean;
  basis: StepBasis;
  source: string;
  sourceTitle: string;
  quote: string;
  /** The codes of the control's attributes evaluated at this step (A1, A2, ...). */
  attributes: string[];
  /** The diagram (27 October 2026): a short title, empty on a flow built before then. */
  title: string;
  /** A DECISION branches: yes and no are the step numbers each answer leads to (1 is the
   * first step), 0 for the next step. */
  kind: "STEP" | "DECISION";
  yes: number;
  no: number;
  /** The records the step leaves that an auditor could inspect. */
  evidence: string[];
};

/** One version of the process narrative (0116): its words and steps, who made it, when. */
export type NarrativeVersion = {
  version: number;
  kind: "BUILT" | "PROPOSED" | "SAVED" | "CONFIRMED" | "ADOPTED";
  builtBy: string;
  summary: string;
  sections: NarrativeSection[];
  steps: ProcessStep[];
  actor: string | null;
  at: string;
};

export const VERSION_KIND_LABELS: Record<NarrativeVersion["kind"], string> = {
  BUILT: "Drafted",
  PROPOSED: "Redrafted beside the current",
  SAVED: "Saved as draft",
  CONFIRMED: "Approved",
  ADOPTED: "Redraft taken",
};

export function parseVersions(value: unknown): NarrativeVersion[] {
  return records(value)
    .map((item) => ({
      version: num(item.version),
      kind: oneOf(
        item.kind,
        ["BUILT", "PROPOSED", "SAVED", "CONFIRMED", "ADOPTED"] as const,
        "SAVED",
      ),
      builtBy: str(item.built_by),
      summary: str(item.summary),
      sections: parseSections(item.sections),
      steps: records(item.steps).map(parseStep),
      actor: typeof item.actor === "string" ? item.actor : null,
      at: str(item.created_at),
    }))
    .filter((item) => item.version > 0);
}

/** The API path that lists a control's narrative versions, checked; null when invalid. */
export function versionsPath(fields: Fields): string | null {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  if (![organizationId, projectId, controlId].every((id) => UUID.test(id))) {
    return null;
  }
  return `/organizations/${organizationId}/projects/${projectId}/controls/${controlId}/process/versions`;
}

/** The narrative's fixed sections (0117), in order. */
export const NARRATIVE_SECTIONS = [
  ["PURPOSE", "Purpose and scope"],
  ["INITIATION", "Initiation"],
  ["APPROVAL", "Review and approval"],
  ["EXECUTION", "Execution"],
  ["RECORDING", "Recording and evidence"],
  ["EXCEPTIONS", "Exceptions and escalation"],
  ["MONITORING", "Monitoring and oversight"],
] as const;
export type SectionKey = (typeof NARRATIVE_SECTIONS)[number][0];
export const SECTION_HEADINGS = Object.fromEntries(
  NARRATIVE_SECTIONS,
) as Record<SectionKey, string>;

export type NarrativeSection = {
  key: SectionKey;
  heading: string;
  text: string;
  attributes: string[];
};

/** The narrative's background run: drafting, reviewing, or done. */
export type NarrativeRun = {
  status: "IDLE" | "PENDING" | "WORKING" | "FAILED";
  /** PLAN updates the test plan from the approved narrative (0120). */
  mode: "DRAFT" | "REVIEW" | "PLAN";
  stage:
    | ""
    | "PREPARING"
    | "DRAFTING"
    | "REVIEWING"
    | "CHECKING"
    | "ATTRIBUTES"
    | "EVIDENCE";
  round: number;
  note: string;
  /** The server's sentence for a run that ended without a usable answer, or ""
   * (run-failure.ts); absent from an older API. */
  failureNote?: string;
  /** What the last update of the test plan from the narrative did, or null. */
  planOutcome: {
    attributes: number;
    evidence: number;
    evidenceProposed: number;
    /** The planner did not answer; the rules planned without the narrative. */
    evidenceFallback: boolean;
    note: string;
  } | null;
  /** When the run and its stage began (0118), as ISO times, or "". */
  startedAt: string;
  stageAt: string;
  /** What the run works from. */
  progress: {
    answers: number;
    documents: number;
    attributes: number;
    points: number;
  };
};

const RUN_STAGES = [
  "",
  "PREPARING",
  "DRAFTING",
  "REVIEWING",
  "CHECKING",
  "ATTRIBUTES",
  "EVIDENCE",
] as const;

/** What an update of the test plan from the approved narrative did, in one line. */
export function planOutcomeLine(
  outcome: NonNullable<NarrativeRun["planOutcome"]>,
): string {
  const parts = [
    outcome.attributes > 0
      ? `${plural(outcome.attributes, "attribute change")} to decide on the Attributes tab`
      : "",
    outcome.evidenceProposed > 0
      ? `${plural(outcome.evidenceProposed, "evidence change")} to accept on the Evidence tab`
      : "",
    outcome.evidence > 0
      ? `${plural(outcome.evidence, "evidence item")} updated in the draft plan`
      : "",
  ].filter((part) => part !== "");
  if (outcome.evidenceFallback) {
    return `The evidence planner did not finish, so the evidence was not updated from the approved narrative${
      parts.length > 0 ? ` (${parts.join("; ")})` : ""
    }. Update the plan again.`;
  }
  return parts.length === 0
    ? "The test plan was checked against the approved narrative: it already matches how the control operates."
    : `The test plan was updated from the approved narrative: ${parts.join("; ")}.`;
}

const NARRATIVE_FAILED: Record<NarrativeRun["mode"], string> = {
  DRAFT:
    "The narrative could not be drafted, so the earlier narrative is kept. Draft it again, or edit it yourself.",
  REVIEW:
    "The review of the narrative did not finish, so it is not reviewed. The narrative is kept as it was. Draft it again.",
  PLAN: "The test plan was not updated from the approved narrative, so the plan is kept as it was. Update the plan again.",
};

/** The Control Understanding narrative's one sentence for a run that ended without a
 * usable answer (it failed), or null: the server's failure sentence, else the run's note,
 * else this step's words for the run's mode. An evidence planner that did not finish an
 * update of the plan is said by planOutcomeLine, with its own action. */
export function narrativeFailureLine(
  run: Pick<NarrativeRun, "status" | "mode" | "note" | "failureNote"> | null,
  failureNote: string = run?.failureNote ?? "",
): string | null {
  if (run === null || run.status === "PENDING" || run.status === "WORKING") {
    return null;
  }
  const said = plainNote(failureNote);
  if (said !== "") {
    return said;
  }
  return run.status === "FAILED"
    ? failureSentence(NARRATIVE_FAILED[run.mode], run.note)
    : null;
}

export type ProgressStep = {
  key: string;
  label: string;
  detail: string;
  state: "done" | "active" | "pending";
  /** Seconds in the step while it is active; 0 otherwise. */
  seconds: number;
};

const since = (from: string, now: number) => {
  const at = Date.parse(from);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.round((now - at) / 1000));
};

/** A narrative paragraph without the attribute codes the agents cite in it ("(A2, A3)"),
 * for reading it as a document; the codes come back with Show attributes (27 October
 * 2026). Display only: the narrative's text is unchanged. */
export function withoutCodes(text: string): string {
  return text.replace(/\s*\((?:A\d+[a-z]?(?:\s*(?:,|and|&)\s*)?)+\)/g, "");
}

/** The run's progress as the steps a person follows (decided by the product owner on 26
 * October 2026: "a real status so that the user knows what's happening"): what each step
 * does, which is done, which is under way and for how long. */
export function narrativeProgress(
  run: NarrativeRun,
  now: number,
): { steps: ProgressStep[]; seconds: number } {
  if (run.mode === "PLAN") {
    return planProgress(run, now);
  }
  const { answers, documents, attributes } = run.progress;
  const reading =
    answers + documents + attributes > 0
      ? `${plural(answers, "answer")}, ${plural(documents, "document")} and ${plural(attributes, "attribute")}`
      : "The organization's answers, the documents and the attributes";
  const plan: Array<{ key: string; label: string; detail: string }> = [
    {
      key: "PREPARING",
      label: "Gathering the facts",
      detail: reading,
    },
    run.mode === "REVIEW"
      ? {
          key: "DRAFTING",
          label: "Reading the narrative",
          detail: "The narrative as it stands, for the reviewer",
        }
      : {
          key: "DRAFTING",
          label: "Drafting the narrative",
          detail: "Seven sections, every attribute explained",
        },
    {
      key: "REVIEWING-1",
      label: "Independent review",
      detail: "Checks each fact and attribute, and fixes the draft",
    },
    ...(run.stage === "REVIEWING" && run.round >= 2
      ? [
          {
            key: "REVIEWING-2",
            label: "Second review",
            detail: "Checks the fixes made in the first review",
          },
        ]
      : []),
    {
      key: "CHECKING",
      label: "Final checks",
      detail: "Structure and coverage, then the points for the organization",
    },
  ];
  const at =
    run.status === "PENDING" || run.stage === "" || run.stage === "PREPARING"
      ? 0
      : run.stage === "DRAFTING"
        ? 1
        : run.stage === "REVIEWING"
          ? run.round >= 2
            ? 3
            : 2
          : plan.length - 1;
  const working = run.status === "WORKING" || run.status === "PENDING";
  const active = working ? at : plan.length;
  const stageSeconds = run.status === "WORKING" ? since(run.stageAt, now) : 0;
  return {
    steps: plan.map((step, index) => ({
      ...step,
      state: index < active ? "done" : index === active ? "active" : "pending",
      seconds: index === active ? stageSeconds : 0,
    })),
    seconds: run.status === "WORKING" ? since(run.startedAt, now) : 0,
  };
}

/** The steps of an update of the test plan from the approved narrative. */
function planProgress(
  run: NarrativeRun,
  now: number,
): { steps: ProgressStep[]; seconds: number } {
  const plan = [
    {
      key: "PREPARING",
      label: "Reading the approved narrative",
      detail: "How the control operates, its steps and control points",
    },
    {
      key: "ATTRIBUTES",
      label: "Attributes",
      detail: "Proposes the changes that test the control as it operates",
    },
    {
      key: "EVIDENCE",
      label: "Evidence",
      detail: "Plans the evidence again from the narrative",
    },
  ];
  const at = run.stage === "EVIDENCE" ? 2 : run.stage === "ATTRIBUTES" ? 1 : 0;
  const working = run.status === "WORKING" || run.status === "PENDING";
  const active = working ? at : plan.length;
  const stageSeconds = run.status === "WORKING" ? since(run.stageAt, now) : 0;
  return {
    steps: plan.map((step, index) => ({
      ...step,
      state: index < active ? "done" : index === active ? "active" : "pending",
      seconds: index === active ? stageSeconds : 0,
    })),
    seconds: run.status === "WORKING" ? since(run.startedAt, now) : 0,
  };
}

/** 75 → "1:15". */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The last review of the narrative, and the version it reviewed. */
export type NarrativeReview = {
  passed: boolean;
  reviewer: "AGENT" | "RULES";
  rounds: number;
  coverage: Array<{ code: string; sections: string[]; steps: number[] }>;
  /** What still falls short in the narrative as it stands. */
  findings: string[];
  /** What the reviewer corrected, across its rounds. */
  fixes: string[];
  /** Facts still to come from the client, asked in the walkthrough. */
  questions: number;
  /** The reviewer agent did not finish; the review is to be run again. */
  incomplete: boolean;
  version: number;
};

/** What the review box offers, so a held review always has a way forward: run the
 * review again, answer the client's questions in the walkthrough, or redraft. */
export type ReviewAction = "review" | "answer" | "redraft";

export const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  review: "Run the review again",
  answer: "Confirm the points",
  redraft: "Redraft and review",
};

export function reviewActions(
  review: NarrativeReview,
  version: number,
): ReviewAction[] {
  if (review.version < 0) {
    // Use the newer draft, beside the narrative, is the way forward.
    return [];
  }
  if (review.version !== version) {
    return ["review"];
  }
  if (review.passed) {
    return [];
  }
  const answer: ReviewAction[] = review.questions > 0 ? ["answer"] : [];
  if (review.incomplete) {
    return ["review", ...answer];
  }
  if (review.reviewer === "RULES") {
    // No model is configured: running the rules again changes nothing.
    return answer;
  }
  return [
    ...answer,
    ...(review.findings.length > 0 ? ["redraft" as const] : []),
  ];
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** The review's one-line verdict for the narrative at `version`. */
export function reviewHeadline(
  review: NarrativeReview,
  version: number,
): string {
  if (review.version < 0) {
    // The review is of the newer draft placed beside this narrative.
    return review.passed
      ? "The newer draft beside this one passed its review. Use the newer draft to take it with its review."
      : "The newer draft beside this one has been reviewed. Use the newer draft to see what the review found.";
  }
  if (review.version !== version) {
    return "Changed since the review. Review it again before approving.";
  }
  if (review.passed) {
    return `Reviewed: every attribute covered${
      review.rounds > 1 ? ` after ${review.rounds} rounds of fixes` : ""
    }.`;
  }
  if (review.incomplete) {
    return `The reviewer agent did not finish its review. Run it again${
      review.questions > 0
        ? `; ${plural(review.questions, "point")} also wait for the organization's confirmation`
        : ""
    }.`;
  }
  if (review.reviewer === "RULES") {
    return "Checked by the rules only: no model reviewed it.";
  }
  if (review.questions > 0) {
    const points = plural(review.questions, "point");
    return review.findings.length > 0
      ? `${plural(review.findings.length, "issue")} to resolve, and ${points} for the organization to confirm in the walkthrough.`
      : `Waiting on ${points} for the organization to confirm in the walkthrough. The narrative is drafted again once they are confirmed.`;
  }
  return "The review found issues to resolve before approval.";
}

const SECTION_KEYS = NARRATIVE_SECTIONS.map(([key]) => key);

function parseSections(value: unknown): NarrativeSection[] {
  return records(value)
    .filter((item) => SECTION_KEYS.includes(item.key as SectionKey))
    .map((item) => ({
      key: item.key as SectionKey,
      heading: str(item.heading) || SECTION_HEADINGS[item.key as SectionKey],
      text: str(item.text),
      attributes: (Array.isArray(item.attributes) ? item.attributes : [])
        .filter((code): code is string => typeof code === "string")
        .slice(0, 12),
    }));
}

function parseRun(value: unknown): NarrativeRun | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    status: oneOf(
      value.status,
      ["IDLE", "PENDING", "WORKING", "FAILED"] as const,
      "IDLE",
    ),
    mode: oneOf(value.mode, ["DRAFT", "REVIEW", "PLAN"] as const, "DRAFT"),
    stage: oneOf(value.stage, RUN_STAGES, ""),
    round: num(value.round),
    note: str(value.note),
    ...(failureNoteOf(value) !== ""
      ? { failureNote: failureNoteOf(value) }
      : {}),
    startedAt: str(value.started_at),
    stageAt: str(value.stage_at),
    progress: {
      answers: num(isRecord(value.progress) ? value.progress.answers : 0),
      documents: num(isRecord(value.progress) ? value.progress.documents : 0),
      attributes: num(isRecord(value.progress) ? value.progress.attributes : 0),
      points: num(isRecord(value.progress) ? value.progress.points : 0),
    },
    planOutcome: isRecord(value.plan_outcome)
      ? {
          attributes: num(value.plan_outcome.attributes),
          evidence: num(value.plan_outcome.evidence),
          evidenceProposed: num(value.plan_outcome.evidence_proposed),
          evidenceFallback: value.plan_outcome.evidence_fallback === true,
          note: str(value.plan_outcome.note),
        }
      : null,
  };
}

function parseReview(value: unknown): NarrativeReview | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    passed: value.passed === true,
    reviewer: value.reviewer === "AGENT" ? "AGENT" : "RULES",
    rounds: num(value.rounds),
    coverage: records(value.coverage).map((item) => ({
      code: str(item.code),
      sections: (Array.isArray(item.sections) ? item.sections : []).filter(
        (key): key is string => typeof key === "string",
      ),
      steps: (Array.isArray(item.steps) ? item.steps : []).filter(
        (step): step is number => typeof step === "number",
      ),
    })),
    findings: (Array.isArray(value.findings) ? value.findings : []).filter(
      (item): item is string => typeof item === "string",
    ),
    fixes: (Array.isArray(value.fixes) ? value.fixes : []).filter(
      (item): item is string => typeof item === "string",
    ),
    questions: num(value.questions),
    incomplete: value.incomplete === true,
    version: num(value.version),
  };
}

export type Understanding = {
  status: "NONE" | "DRAFT" | "CONFIRMED";
  summary: string;
  sections: NarrativeSection[];
  proposedSections: NarrativeSection[] | null;
  run: NarrativeRun | null;
  review: NarrativeReview | null;
  steps: ProcessStep[];
  builtBy: "PERSON" | "AGENT" | "RULES" | "LEGACY" | "FALLBACK";
  proposedSummary: string;
  proposedSteps: ProcessStep[] | null;
  proposedNote: string;
  confirmedBy: string | null;
  /** When it was approved, as an ISO time, or "". */
  confirmedAt: string;
  version: number;
};

export type ControlContext = {
  controlId: string;
  classifications: Classification[];
  derivedClassifications: Classification[];
  classificationsOverridden: boolean;
  processRequired: boolean;
  readiness: Readiness | null;
  approved: Attribute[];
  proposed: Attribute[];
  history: Attribute[];
  issues: ContextIssue[];
  documents: SupportingDocument[];
  understanding: Understanding;
  testing: Testing | null;
  libraryUpdate: LibraryUpdate | null;
  design: Design | null;
  /** The reviewer agent's review of the attributes, or null when there was none. */
  reviewSummary: AttributeReviewSummary | null;
  /** The agents are updating the attributes and criteria now (the Attributes step shows
   * it working and reads again). */
  attributesRun: AttributesRun;
  attributesStage: AttributesStage;
  /** For a stopped run: what happened and what a person does next. */
  attributesRunNote: string;
  /** Whether running the agents again would do anything: something they read changed since
   * their last finished run, or a run stopped before finishing work still needed. False on
   * settled work; null or absent when the API does not say (then asking stays offered). */
  attributesRerunUseful?: boolean | null;
  /** The server's sentence for an attributes run that ended without a usable answer
   * (ATTRIBUTES_FAILURE_FIELD), or "" (run-failure.ts). */
  attributesFailureNote?: string;
  /** Each agent's part in the latest attributes run, its failure said plainly. */
  attributesAgentNotes?: AttributesAgentNote[];
  /** The attributes whose criteria the planner wrote into the plan's pending revision. */
  attributesPendingCriteria?: PendingCriteria[];
  /** A change to the person-approved test plan waits to be decided. */
  planRevisionPending?: boolean;
  note: string;
};

export const BASIS_LABELS: Record<StepBasis, string> = {
  DOCUMENTED: "Documented",
  INFERRED: "Inferred",
  TEAM: "From the team",
};

export const SOURCE_LABELS: Record<Attribute["sourceKind"], string> = {
  LIBRARY: "Control library",
  RCM: "Organization's RCM",
  MANUAL: "Written by the team",
  AGENT: "Agent",
  DOCUMENT: "Supporting document",
};

/** The longest wording an attribute takes (the API's limit). */
export const ATTRIBUTE_MAX = 300;

/** An attribute's place in the test, as the list letters it: A, B, … Z, then AA. */
export function attributeLetter(index: number): string {
  const first = Math.floor(index / 26);
  const letter = String.fromCharCode(65 + (index % 26));
  return first === 0 ? letter : `${String.fromCharCode(64 + first)}${letter}`;
}

/** Where the wording came from, inside a sentence. */
const SOURCE_PHRASES: Record<Attribute["sourceKind"], string> = {
  LIBRARY: "the control library",
  RCM: "the organization's RCM",
  MANUAL: "the team",
  AGENT: "the agent",
  DOCUMENT: "supporting documents",
};

function listed(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The recommendation above the attributes: what is approved and where it came from, and
 * what waits on a decision. Neutral, and only what the records say. */
export function attributesSummary(context: {
  approved: Attribute[];
  proposed: Attribute[];
}): string {
  const approved = context.approved.length;
  const waiting = context.proposed.length;
  const sources = [
    ...new Set(context.approved.map((item) => SOURCE_PHRASES[item.sourceKind])),
  ];
  const parts: string[] = [];
  if (approved > 0) {
    parts.push(
      `${approved} approved testing attribute${approved === 1 ? "" : "s"}, from ${listed(sources)}.`,
    );
  }
  if (waiting > 0) {
    parts.push(
      `${waiting} proposed change${waiting === 1 ? " waits" : "s wait"} on a decision.`,
    );
  }
  return parts.length > 0
    ? parts.join(" ")
    : "No testing attributes yet. Propose them with the agent, or add one.";
}

export type AttributeDecisionKind = "APPROVE" | "REJECT" | "RETIRE";

/** What a selection of attributes can do as one decision: decide the selected proposals,
 * or retire the selected approved attributes. A control keeps at least one attribute. */
export function selectionPlan(
  selected: ReadonlySet<string>,
  context: { approved: Attribute[]; proposed: Attribute[] },
): {
  proposals: Attribute[];
  approved: Attribute[];
  retireBlocked: boolean;
} {
  const proposals = context.proposed.filter((item) => selected.has(item.id));
  const approved = context.approved.filter((item) => selected.has(item.id));
  return {
    proposals,
    approved,
    retireBlocked:
      approved.length > 0 && approved.length >= context.approved.length,
  };
}

/** The confirmation once the server has applied a decision. */
export function decidedNote(
  decision: AttributeDecisionKind,
  count: number,
): string {
  const noun =
    decision === "RETIRE"
      ? `attribute${count === 1 ? "" : "s"}`
      : `proposal${count === 1 ? "" : "s"}`;
  const verb =
    decision === "APPROVE"
      ? "approved"
      : decision === "REJECT"
        ? "rejected"
        : "retired";
  const kept =
    decision === "RETIRE"
      ? count === 1
        ? " It stays in the history."
        : " They stay in the history."
      : "";
  return `${count} ${noun} ${verb}.${kept}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Raw[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((item) => item === value) ?? fallback;
}

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string",
  );

function parseDefinition(value: unknown): AttributeDefinition | null {
  if (!isRecord(value) || typeof value.key !== "string") {
    return null;
  }
  return {
    key: value.key,
    confidence: oneOf(
      value.confidence,
      ["HIGH", "MODERATE", "LOW", "NOT_ESTABLISHED"] as const,
      "NOT_ESTABLISHED",
    ),
    condition: str(value.condition),
    why: str(value.why),
    evidence: strings(value.evidence),
    extract: strings(value.extract),
    compare: str(value.compare),
    passes: str(value.passes),
    fails: str(value.fails),
    insufficient: str(value.insufficient),
    review: str(value.review),
    notInfer: str(value.not_infer),
    basis: strings(value.basis),
    question: str(value.question),
    blocks: value.blocks === true,
  };
}

function parseTesting(value: unknown): Testing | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    version: num(value.version),
    objective: str(value.objective),
    controlType: str(value.control_type),
    population: str(value.population),
    sampling: str(value.sampling),
    procedures: records(value.procedures).map((item) => ({
      key: str(item.key),
      phase: oneOf(
        item.phase,
        ["DESIGN", "OPERATING", "ROLLFORWARD"] as const,
        "OPERATING",
      ),
      objective: str(item.objective),
      action: str(item.action),
      evidence: strings(item.evidence),
      attributes: strings(item.attributes),
      limitation: str(item.limitation),
    })),
    designConfirmation: str(value.design_confirmation),
    assumptions: strings(value.assumptions),
    questions: strings(value.questions),
    notApplicable: strings(value.not_applicable),
  };
}

function parseUpdate(value: unknown): LibraryUpdate | null {
  if (!isRecord(value) || value.available !== true) {
    return null;
  }
  return {
    libraryVersion: num(value.library_version),
    currentVersion: num(value.current_version),
    items: records(value.items).map((item) => ({
      change: oneOf(
        item.change,
        ["KEEP", "REWORD", "ADD", "PROPOSE", "RETIRE"] as const,
        "KEEP",
      ),
      key: str(item.key),
      text: str(item.text),
      was: str(item.was),
      reason: str(item.reason),
      confidence: str(item.confidence),
    })),
    note: str(value.note),
    fields: records(value.fields).map((item) => ({
      field: str(item.field),
      was: str(item.was),
      now: str(item.now),
    })),
    splits: records(value.splits).map((item) => ({
      controlRef: str(item.control_ref),
      title: str(item.title),
      reason: str(item.reason),
    })),
  };
}

function parseDesign(value: unknown): Design | null {
  if (!isRecord(value) || typeof value.text !== "string") {
    return null;
  }
  return {
    text: value.text,
    risk: str(value.risk),
    itRisk: str(value.it_risk),
    principle: str(value.principle),
    assertions: strings(value.assertions),
    controlType: str(value.control_type),
    nature: str(value.nature),
    frequency: str(value.frequency),
    operator: str(value.operator),
    reviewer: str(value.reviewer),
    owner: str(value.owner),
    authority: str(value.authority),
    judgment: str(value.judgment),
    judgmentNote: str(value.judgment_note),
    precision: str(value.precision),
    investigation: str(value.investigation),
    information: records(value.information).map((item) => ({
      name: str(item.name),
      kind: str(item.kind),
      elements: strings(item.elements),
      ipe: str(item.ipe),
    })),
    itgcs: strings(value.itgcs),
    evidence: str(value.evidence),
    appliesWhen: str(value.applies_when),
    slots: records(value.slots)
      .filter((item) => typeof item.key === "string")
      .map((item) => ({
        key: str(item.key),
        label: str(item.label),
        kind: str(item.kind),
        why: str(item.why),
        example: str(item.example),
        blocks: item.blocks === true,
        value: str(item.value),
        automatic: item.automatic === true,
        filledBy: typeof item.filled_by === "string" ? item.filled_by : null,
        filledAt: str(item.filled_at),
        version: num(item.version),
        options: strings(item.options).slice(0, 6),
        question: str(item.question),
        hint: str(item.hint),
        document: item.document === true,
      })),
    missing: strings(value.missing),
  };
}

const CLASSIFICATION_KEYS = CLASSIFICATIONS.map(([key]) => key);
const DOCUMENT_KEYS = DOCUMENT_KINDS.map(([key]) => key);

function parseAttribute(item: Raw): Attribute {
  return {
    id: str(item.id),
    position: num(item.position),
    text: str(item.text),
    status: oneOf(
      item.status,
      ["PROPOSED", "APPROVED", "REJECTED", "RETIRED", "SUPERSEDED"] as const,
      "APPROVED",
    ),
    basis: oneOf(item.basis, ["DOCUMENTED", "INFERRED"] as const, "INFERRED"),
    sourceKind: oneOf(
      item.source_kind,
      ["LIBRARY", "RCM", "MANUAL", "AGENT", "DOCUMENT"] as const,
      "MANUAL",
    ),
    sourceDocumentId:
      typeof item.source_document_id === "string"
        ? item.source_document_id
        : null,
    sourceTitle: str(item.source_title),
    sourceQuote: str(item.source_quote),
    note: str(item.note),
    proposal:
      item.proposal === "ADD" ||
      item.proposal === "CHANGE" ||
      item.proposal === "RETIRE"
        ? item.proposal
        : null,
    replacesId: typeof item.replaces_id === "string" ? item.replaces_id : null,
    decidedBy: typeof item.decided_by === "string" ? item.decided_by : null,
    version: num(item.version),
    definition: parseDefinition(item.definition),
    criteria: {
      objective: str(item.objective),
      condition: str(item.condition),
      passCriteria: str(item.pass_criteria),
      failCriteria: str(item.fail_criteria),
      judgmentRequired:
        typeof item.judgment_required === "boolean"
          ? item.judgment_required
          : null,
      automatable:
        typeof item.automatable === "boolean" ? item.automatable : null,
      phases: Array.isArray(item.phases)
        ? item.phases.filter((each): each is string => typeof each === "string")
        : [],
      origin:
        item.criteria_origin === "PERSON" ||
        item.criteria_origin === "AGENT" ||
        item.criteria_origin === "SEEDED"
          ? item.criteria_origin
          : null,
      acceptedBy: str(item.criteria_accepted_by),
      acceptedAt: str(item.criteria_accepted_at),
      owned: item.criteria_owned === true,
    },
    review: isRecord(item.review)
      ? {
          verdict: oneOf(
            item.review.verdict,
            ["OK", "REVISED", "CONCERN"] as const,
            "CONCERN",
          ),
          note: str(item.review.note),
        }
      : null,
    understandingBasis: parseBasis(item.understanding_basis),
  };
}

function parseReviewSummary(value: unknown): AttributeReviewSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    status: value.status === "REVIEWED" ? "REVIEWED" : "NOT_REVIEWED",
    reviewedAt: str(value.reviewed_at),
    reviewer: str(value.reviewer),
    note: str(value.note),
    findings: strings(value.findings).slice(0, 8),
    concerns: num(value.concerns),
  };
}

function parseStep(item: Raw): ProcessStep {
  return {
    key: str(item.key),
    description: str(item.description),
    actor: str(item.actor),
    system: str(item.system),
    controlPoint: item.control_point === true,
    basis: oneOf(
      item.basis,
      ["DOCUMENTED", "INFERRED", "TEAM"] as const,
      "TEAM",
    ),
    source: str(item.source),
    sourceTitle: str(item.source_title),
    quote: str(item.quote),
    attributes: (Array.isArray(item.attributes) ? item.attributes : [])
      .filter((code): code is string => typeof code === "string")
      .slice(0, 12),
    title: str(item.title),
    kind: item.kind === "DECISION" ? "DECISION" : "STEP",
    yes: stepNumber(item.yes),
    no: stepNumber(item.no),
    evidence: (Array.isArray(item.evidence) ? item.evidence : [])
      .filter((text): text is string => typeof text === "string" && text !== "")
      .slice(0, 3),
  };
}

/** A branch's step number: a whole number from 1 to 15, else 0 (the next step). */
function stepNumber(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 15
    ? value
    : 0;
}

function parseReadiness(value: unknown): Readiness | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = oneOf(value.state, READINESS_STATES, "READY");
  return {
    state,
    label: str(value.label) || STATE_LABELS[state],
    processRequired: value.process_required === true,
    checks: records(value.checks).map((check) => ({
      key: oneOf(
        check.key,
        [
          "plan",
          "criteria",
          "process",
          "evidence",
          "scope",
          "conflicts",
        ] as const,
        "criteria",
      ),
      title: str(check.title),
      status: oneOf(
        check.status,
        ["OK", "BLOCKED", "WARN", "PENDING", "NOT_APPLICABLE"] as const,
        "PENDING",
      ),
      summary: str(check.summary),
      blockers: records(check.blockers).map((item) => ({
        detail: str(item.detail),
        why: str(item.why),
        resolve: str(item.resolve),
      })),
    })),
  };
}

export function parseContext(value: unknown): ControlContext | null {
  if (!isRecord(value) || typeof value.control_id !== "string") {
    return null;
  }
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  const understanding = isRecord(value.understanding)
    ? value.understanding
    : {};
  const classes = (raw: unknown): Classification[] =>
    (Array.isArray(raw) ? raw : []).filter((item): item is Classification =>
      CLASSIFICATION_KEYS.some((key) => key === item),
    );
  return {
    controlId: value.control_id,
    classifications: classes(value.classifications),
    derivedClassifications: classes(value.derived_classifications),
    classificationsOverridden: value.classifications_overridden === true,
    processRequired: value.process_required === true,
    readiness: parseReadiness(value.readiness),
    approved: records(attributes.approved).map(parseAttribute),
    proposed: records(attributes.proposed).map(parseAttribute),
    history: records(attributes.history).map(parseAttribute),
    issues: records(value.issues).map((item) => ({
      id: str(item.id),
      origin: oneOf(
        item.origin,
        ["ATTRIBUTES", "PROCESS", "SOURCES"] as const,
        "SOURCES",
      ),
      kind: oneOf(
        item.kind,
        ["MISSING", "AMBIGUOUS", "CONFLICT"] as const,
        "AMBIGUOUS",
      ),
      topic: str(item.topic),
      detail: str(item.detail),
      why: str(item.why),
      resolve: str(item.resolve),
      quotes: records(item.quotes).map((quote) => ({
        source: str(quote.source),
        title: str(quote.title),
        quote: str(quote.quote),
      })),
      raisedBy: item.raised_by === "AGENT" ? "AGENT" : "RULES",
      status: oneOf(
        item.status,
        ["OPEN", "RESOLVED", "DISMISSED"] as const,
        "OPEN",
      ),
      resolutionNote: str(item.resolution_note),
      version: num(item.version),
      question: str(item.question),
      suggestions: (Array.isArray(item.suggestions) ? item.suggestions : [])
        .filter((answer): answer is string => typeof answer === "string")
        .slice(0, 4),
      proposal: str(item.proposal),
      section: str(item.section),
      attributes: strings(item.attributes).slice(0, 12),
      round: num(item.round),
      pointKind: oneOf(
        item.point_kind,
        ["", "MISSING", "CONTRADICTION"] as const,
        "",
      ),
      proposalBasis: oneOf(
        item.proposal_basis,
        ["", "SOURCES", "TYPICAL"] as const,
        "",
      ),
      wordingReviewed: item.wording_reviewed === true,
      interview: records(item.interview).map((step) => ({
        key: str(step.key),
        question: str(step.question),
        why: str(step.why),
        usual: str(step.usual),
        basis: str(step.basis),
        answers: records(step.answers).map((answer) => ({
          label: str(answer.label),
          says: str(answer.says),
          next: str(answer.next),
        })),
      })),
    })),
    documents: records(value.documents).map((item) => ({
      id: str(item.id),
      kind: oneOf(item.kind, DOCUMENT_KEYS, "OTHER"),
      title: str(item.title),
      fileName: str(item.file_name),
      origin: oneOf(
        item.origin,
        ["UPLOAD", "WRITTEN", "AGENT"] as const,
        "WRITTEN",
      ),
      characters: num(item.characters),
      excerpt: str(item.excerpt),
      createdBy: typeof item.created_by === "string" ? item.created_by : null,
      controlIds: (Array.isArray(item.control_ids)
        ? item.control_ids
        : []
      ).filter((id): id is string => typeof id === "string"),
      reviewed: item.reviewed === true,
    })),
    understanding: {
      status: oneOf(
        understanding.status,
        ["NONE", "DRAFT", "CONFIRMED"] as const,
        "NONE",
      ),
      summary: str(understanding.summary),
      sections: parseSections(understanding.sections),
      proposedSections: Array.isArray(understanding.proposed_sections)
        ? parseSections(understanding.proposed_sections)
        : null,
      run: parseRun(understanding.run),
      review: parseReview(understanding.review),
      steps: records(understanding.steps).map(parseStep),
      builtBy: oneOf(
        understanding.built_by,
        ["PERSON", "AGENT", "RULES", "LEGACY", "FALLBACK"] as const,
        "PERSON",
      ),
      proposedSummary: str(understanding.proposed_summary),
      proposedSteps: Array.isArray(understanding.proposed_steps)
        ? records(understanding.proposed_steps).map(parseStep)
        : null,
      proposedNote: str(understanding.proposed_note),
      confirmedBy:
        typeof understanding.confirmed_by === "string"
          ? understanding.confirmed_by
          : null,
      confirmedAt: str(understanding.confirmed_at),
      version: num(understanding.version),
    },
    testing: parseTesting(value.testing),
    libraryUpdate: parseUpdate(value.library_update),
    design: parseDesign(value.design),
    reviewSummary: parseReviewSummary(attributes.review_summary),
    attributesRun: oneOf(
      value.attributes_run,
      ["", "PENDING", "WORKING", "STOPPED"] as const,
      "",
    ),
    attributesRunNote: str(value.attributes_run_note),
    attributesFailureNote: plainNote(str(value[ATTRIBUTES_FAILURE_FIELD])),
    attributesAgentNotes: records(value.attributes_agent_notes).map((item) => ({
      agent: str(item.agent),
      step: str(item.step),
      failed: str(item.failed),
      kept: str(item.kept),
      nextStep: plainNote(str(item.next_step)),
      sentence: plainNote(str(item.sentence)),
      at: str(item.at),
    })),
    attributesPendingCriteria: records(value.attributes_pending_criteria)
      .filter((item) => UUID.test(str(item.attribute_id)))
      .map((item) => ({
        attributeId: str(item.attribute_id),
        code: str(item.code),
      })),
    planRevisionPending: value.plan_revision_pending === true,
    attributesRerunUseful:
      typeof value.attributes_rerun_useful === "boolean"
        ? value.attributes_rerun_useful
        : null,
    attributesStage: oneOf(
      value.attributes_stage,
      ["", "ATTRIBUTES", "CRITERIA", "REVIEW"] as const,
      "",
    ),
    note: str(value.note),
  };
}

export type ContextIntent =
  | "classify"
  | "attribute-add"
  | "attribute-edit"
  | "attribute-retire"
  | "attribute-decide"
  | "attributes-decide"
  | "attributes-accept"
  | "attributes-generate"
  | "library-adopt"
  | "values-set"
  | "process-save"
  | "process-build"
  | "process-narrate"
  | "process-review"
  | "process-update-plan"
  | "process-points"
  | "process-adopt"
  | "review"
  | "issue-resolve"
  | "document-write"
  | "document-link"
  | "document-unlink";

export type ContextWrite =
  | { error: "invalid" }
  | {
      intent: ContextIntent;
      method: "POST" | "PUT" | "PATCH";
      path: string;
      body: Record<string, unknown>;
      /** Calls that wait for the agent get longer to answer. */
      slow: boolean;
    };

type Fields = Record<string, unknown>;
const text = (fields: Fields, name: string): string =>
  typeof fields[name] === "string" ? (fields[name] as string).trim() : "";
const version = (fields: Fields): number | null => {
  const value = Number(fields.version);
  return Number.isInteger(value) && value >= 0 ? value : null;
};
const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(
    (item): item is string => typeof item === "string" && UUID.test(item),
  );

/** The API call for one action on a control's context, checked before it is sent. */
export function contextWrite(fields: Fields): ContextWrite {
  const organizationId = text(fields, "organization_id");
  const projectId = text(fields, "project_id");
  const controlId = text(fields, "control_id");
  const intent = text(fields, "intent") as ContextIntent;
  if (!UUID.test(organizationId) || !UUID.test(projectId)) {
    return { error: "invalid" };
  }
  const project = `/organizations/${organizationId}/projects/${projectId}`;
  const control = `${project}/controls/${controlId}`;
  const needsControl = !intent.startsWith("document-");
  if (needsControl && !UUID.test(controlId)) {
    return { error: "invalid" };
  }
  const ok = (
    method: "POST" | "PUT" | "PATCH",
    path: string,
    body: Record<string, unknown> = {},
    slow = false,
  ): ContextWrite => ({ intent, method, path, body, slow });
  const attributeId = text(fields, "attribute_id");
  const wording = text(fields, "text");
  const clean = (value: string) =>
    value !== "" && value.length <= 300 && !SECRET.test(value);
  switch (intent) {
    case "classify": {
      const chosen = (
        Array.isArray(fields.classifications) ? fields.classifications : []
      ).filter(
        (item): item is Classification =>
          typeof item === "string" &&
          CLASSIFICATION_KEYS.some((key) => key === item),
      );
      return ok("PUT", `${control}/classifications`, {
        classifications: chosen.length > 0 ? chosen : null,
      });
    }
    case "attribute-add":
      return clean(wording)
        ? ok("POST", `${control}/attributes`, { text: wording })
        : { error: "invalid" };
    case "attribute-edit": {
      const at = version(fields);
      return clean(wording) && UUID.test(attributeId) && at !== null && at >= 1
        ? ok("PATCH", `${control}/attributes/${attributeId}`, {
            text: wording,
            version: at,
          })
        : { error: "invalid" };
    }
    case "attribute-retire": {
      const at = version(fields);
      return UUID.test(attributeId) && at !== null && at >= 1
        ? ok("POST", `${control}/attributes/${attributeId}/retire`, {
            version: at,
          })
        : { error: "invalid" };
    }
    case "attribute-decide": {
      const at = version(fields);
      const decision = text(fields, "decision");
      if (
        !UUID.test(attributeId) ||
        at === null ||
        at < 1 ||
        (decision !== "APPROVE" && decision !== "REJECT") ||
        (wording !== "" && !clean(wording))
      ) {
        return { error: "invalid" };
      }
      return ok("POST", `${control}/attributes/${attributeId}/decide`, {
        decision,
        version: at,
        ...(wording !== "" ? { text: wording } : {}),
      });
    }
    case "attributes-decide": {
      // Several attributes as one decision (decide-many): every item checked here.
      const raw = Array.isArray(fields.items) ? fields.items : [];
      const items = raw.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }
        const at = Number(item.version);
        const decision = item.decision;
        return typeof item.attribute_id === "string" &&
          UUID.test(item.attribute_id) &&
          Number.isInteger(at) &&
          at >= 1 &&
          (decision === "APPROVE" ||
            decision === "REJECT" ||
            decision === "RETIRE")
          ? [{ attribute_id: item.attribute_id, decision, version: at }]
          : [];
      });
      const distinct = new Set(items.map((item) => item.attribute_id));
      return items.length > 0 &&
        items.length === raw.length &&
        items.length <= 100 &&
        distinct.size === items.length
        ? ok("POST", `${control}/attributes/decide-many`, { items })
        : { error: "invalid" };
    }
    case "attributes-accept": {
      // One decision per attribute, one call for the set: the agent's change is approved
      // and its criteria accepted together (12 November 2026). Every item checked here.
      const raw = Array.isArray(fields.items) ? fields.items : [];
      const items = raw.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }
        const at = Number(item.version);
        return typeof item.attribute_id === "string" &&
          UUID.test(item.attribute_id) &&
          Number.isInteger(at) &&
          at >= 1
          ? [{ attribute_id: item.attribute_id, version: at }]
          : [];
      });
      const distinct = new Set(items.map((item) => item.attribute_id));
      return items.length > 0 &&
        items.length === raw.length &&
        items.length <= 100 &&
        distinct.size === items.length
        ? ok("POST", `${control}/attributes/accept`, { items })
        : { error: "invalid" };
    }
    case "attributes-generate":
      // `force` runs the agents although nothing they read has changed: a person's own
      // decision, offered quietly on settled work (12 November 2026).
      return ok(
        "POST",
        `${control}/attributes/generate`,
        fields.force === true ? { force: true } : {},
        true,
      );
    case "library-adopt":
      return ok("POST", `${control}/library-update/adopt`);
    case "values-set": {
      const raw = isRecord(fields.values) ? fields.values : {};
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (!/^[a-z][a-z0-9-]{1,40}$/.test(key) || typeof value !== "string") {
          return { error: "invalid" };
        }
        const trimmed = value.trim();
        if (trimmed.length > 300 || SECRET.test(trimmed)) {
          return { error: "invalid" };
        }
        values[key] = trimmed;
      }
      if (Object.keys(values).length === 0 || Object.keys(values).length > 40) {
        return { error: "invalid" };
      }
      return ok("PUT", `${control}/values`, {
        values,
        everywhere: fields.everywhere === true || fields.everywhere === "true",
      });
    }
    case "process-build":
      return ok("POST", `${control}/process/build`, {}, true);
    case "review":
      return ok("POST", `${control}/review`, {}, true);
    case "process-narrate":
      return ok("POST", `${control}/process/narrate`);
    case "process-review":
      return ok("POST", `${control}/process/review-narrative`);
    case "process-update-plan":
      return ok("POST", `${control}/process/update-plan`);
    case "process-points": {
      // A round of points confirmed or corrected as one decision.
      const raw = Array.isArray(fields.items) ? fields.items : [];
      const items = raw.filter(isRecord).map((item) => ({
        issue_id: str(item.issue_id),
        version: num(item.version),
        answer: str(item.answer).trim().slice(0, 1000),
      }));
      return items.length >= 1 &&
        items.length <= 12 &&
        items.length === raw.length &&
        items.every(
          (item) =>
            UUID.test(item.issue_id) &&
            Number.isInteger(item.version) &&
            item.version >= 1 &&
            item.answer !== "" &&
            !SECRET.test(item.answer),
        )
        ? ok("POST", `${control}/process/points`, { items })
        : { error: "invalid" };
    }
    case "process-adopt": {
      const at = version(fields);
      return at !== null && at >= 1
        ? ok("POST", `${control}/process/adopt`, { version: at })
        : { error: "invalid" };
    }
    case "process-save": {
      const at = version(fields);
      const steps = (Array.isArray(fields.steps) ? fields.steps : [])
        .filter(isRecord)
        .map((step) => ({
          description: str(step.description).trim().slice(0, 400),
          actor: str(step.actor).trim().slice(0, 120),
          system: str(step.system).trim().slice(0, 120),
          control_point: step.controlPoint === true,
          basis: oneOf(
            step.basis,
            ["DOCUMENTED", "INFERRED", "TEAM"] as const,
            "TEAM",
          ),
          source: str(step.source).slice(0, 60),
          quote: str(step.quote).slice(0, 200),
          attributes: (Array.isArray(step.attributes) ? step.attributes : [])
            .filter(
              (code): code is string =>
                typeof code === "string" &&
                /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/.test(code),
            )
            .slice(0, 12),
          // The diagram's fields travel with a person's save, so editing a step's words
          // keeps its title, its branches and its evidence.
          title: str(step.title).trim().slice(0, 60),
          kind: step.kind === "DECISION" ? "DECISION" : "STEP",
          yes: stepNumber(step.yes),
          no: stepNumber(step.no),
          evidence: (Array.isArray(step.evidence) ? step.evidence : [])
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().slice(0, 80))
            .filter((item) => item !== "")
            .slice(0, 3),
        }))
        .filter((step) => step.description !== "");
      const summary = text(fields, "summary");
      const sections = (Array.isArray(fields.sections) ? fields.sections : [])
        .filter(isRecord)
        .filter((item) => SECTION_KEYS.includes(item.key as SectionKey))
        .map((item) => ({
          key: item.key as SectionKey,
          text: str(item.text).trim().slice(0, 3000),
          attributes: (Array.isArray(item.attributes) ? item.attributes : [])
            .filter(
              (code): code is string =>
                typeof code === "string" &&
                /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/.test(code),
            )
            .slice(0, 12),
        }))
        .filter((item) => item.text !== "");
      const reason = text(fields, "override_reason");
      if (
        at === null ||
        steps.length > 15 ||
        sections.length > SECTION_KEYS.length ||
        reason.length > 1000 ||
        SECRET.test(reason) ||
        sections.some((item) => SECRET.test(item.text)) ||
        summary.length > 20000 ||
        SECRET.test(summary) ||
        steps.some((step) => SECRET.test(step.description))
      ) {
        return { error: "invalid" };
      }
      return ok("PUT", `${control}/process`, {
        summary,
        sections,
        steps,
        version: at,
        confirm: fields.confirm === true || fields.confirm === "true",
        ...(reason !== "" ? { override_reason: reason } : {}),
      });
    }
    case "issue-resolve": {
      const at = version(fields);
      const issueId = text(fields, "issue_id");
      const status = text(fields, "status");
      const note = text(fields, "note");
      return UUID.test(issueId) &&
        at !== null &&
        at >= 1 &&
        (status === "RESOLVED" || status === "DISMISSED") &&
        note !== "" &&
        note.length <= 1000
        ? ok("POST", `${control}/issues/${issueId}/resolve`, {
            status,
            note,
            version: at,
          })
        : { error: "invalid" };
    }
    case "document-write": {
      const kind = text(fields, "kind");
      const title = text(fields, "title");
      const body = text(fields, "body");
      const controls = ids(fields.control_ids);
      if (
        !DOCUMENT_KEYS.some((key) => key === kind) ||
        title === "" ||
        title.length > 200 ||
        body === "" ||
        body.length > 100_000 ||
        SECRET.test(body)
      ) {
        return { error: "invalid" };
      }
      return ok("POST", `${project}/source-documents`, {
        kind,
        title,
        text: body,
        control_ids: controls,
      });
    }
    case "document-link": {
      const documentId = text(fields, "document_id");
      const controls = ids(fields.control_ids);
      return UUID.test(documentId) && controls.length > 0
        ? ok("POST", `${project}/source-documents/${documentId}/links`, {
            control_ids: controls,
          })
        : { error: "invalid" };
    }
    case "document-unlink": {
      const documentId = text(fields, "document_id");
      return UUID.test(documentId) && UUID.test(controlId)
        ? ok("POST", `${project}/source-documents/${documentId}/unlink`, {
            control_id: controlId,
          })
        : { error: "invalid" };
    }
    default:
      return { error: "invalid" };
  }
}

export const MAX_UPLOAD = 5 * 1024 * 1024;

/** Where an uploaded supporting document goes, when it can be sent. */
export function documentUploadTarget(
  fields: Record<string, string>,
  controlIds: string[],
  file: { name: string; size: number } | null,
): { path: string } | null {
  const organizationId = fields.organization_id ?? "";
  const projectId = fields.project_id ?? "";
  const kind = fields.kind ?? "";
  if (
    file === null ||
    file.size === 0 ||
    file.size > MAX_UPLOAD ||
    !UUID.test(organizationId) ||
    !UUID.test(projectId) ||
    !DOCUMENT_KEYS.some((key) => key === kind)
  ) {
    return null;
  }
  const params = new URLSearchParams({
    kind,
    title: (fields.title ?? "").trim().slice(0, 200) || file.name.slice(0, 200),
    file_name: file.name.slice(0, 200),
  });
  for (const id of controlIds.filter((item) => UUID.test(item))) {
    params.append("control_id", id);
  }
  return {
    path: `/organizations/${organizationId}/projects/${projectId}/source-documents/upload?${params.toString()}`,
  };
}

/** What to tell the team when a call did not succeed. */
export function contextProblem(status: number, detail = ""): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const known: Record<string, string> = {
      "attribute exists": "That attribute is already on the control.",
      "attribute changed":
        "An attribute changed while you were working. Nothing was saved; refresh and try again.",
      "the attribute it replaces changed":
        "The attribute a proposal replaces has changed. Nothing was saved; refresh and try again.",
      "an attribute is listed twice":
        "An attribute was chosen twice. Nothing was saved; choose again.",
      "a control keeps at least one attribute":
        "A control keeps at least one attribute. Add its replacement first.",
      "mark the step where the control operates":
        "Mark the step where the control operates before confirming.",
      "add the process steps before confirming":
        "Add the process steps before confirming.",
      "there is no proposed map": "There is no proposed map to adopt.",
      "a value cannot hold a credential":
        "A value cannot hold a password or key.",
      "unknown value": "That value is not part of this control's statement.",
      "no library update for this control":
        "This control is already on the current library version.",
      "the control changed":
        "This control changed while you were working. Refresh and try again.",
    };
    return (
      known[detail] ??
      "This changed while you were working. Refresh and try again."
    );
  }
  if (status === 403 || status === 404) {
    return "Your role cannot change this control.";
  }
  if (status === 413) {
    return "That file is larger than 5 MB. Upload a shorter document, or paste the text.";
  }
  if (status === 422) {
    return "Check the entry: it needs some text, within the length limits, and no credential.";
  }
  return "That could not be saved. Try again.";
}
