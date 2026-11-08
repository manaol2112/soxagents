/**
 * The guided setup of a control's understanding (product owner, 2 November 2026): a
 * wizard that opens on a control until it is ready for evidence gathering, through the
 * test plan's approval. Pure: the steps, where each stands, whose they are, and the
 * answers the agent pre-fills, all read from the records the page already holds. Nothing
 * here saves, approves or decides anything.
 */

export type SetupStepKey =
  | "answers"
  | "process"
  | "attributes"
  | "documents"
  | "plan";

export type SetupStep = {
  key: SetupStepKey;
  title: string;
  /** Where it stands, in a few words. */
  summary: string;
  done: boolean;
  /** Governing documents help the plan but never hold evidence gathering. */
  optional: boolean;
  /** The viewer can do it. */
  mine: boolean;
};

export type SetupInput = {
  /** The control's client-specific questions (its design's fillable slots). A question
   * that asks which policy or procedure governs the control is answered from the
   * documents linked to it, on the Governing documents step (2 November 2026). */
  slots: ReadonlyArray<{
    key: string;
    value: string;
    blocks: boolean;
    document?: boolean;
  }>;
  /** A business process control needs its process understood; an ITGC does not. */
  processRequired: boolean;
  /** Process understanding still waits: not confirmed, a revision proposed, or a
   * question open (control-workspace-model.definitionWork). */
  processPending: boolean;
  approvedAttributes: number;
  proposedAttributes: number;
  /** The questions the agents raised from the records, still open. They are answered with
   * the client-specific questions, on one step (product owner, 4 November 2026). */
  openQuestions: number;
  documents: number;
  unreviewedDocuments: number;
  plan: { exists: boolean; approved: boolean; pendingReview: boolean };
  /** A member who prepares the work (canRequestEvidence). */
  canAct: boolean;
  /** The plan's own rule for who approves it (master plan viewerCanDecide). */
  canApprove: boolean;
};

/** A client without a formal document says so (product owner, 4 November 2026): the same words
 * as the API's control_statements.NO_DOCUMENT, which reads as established practice. */
export const NO_DOCUMENT = "No formal document";

/** The steps that apply, in the order the work is done. */
export function setupSteps(input: SetupInput): SetupStep[] {
  const asked = input.slots.filter((slot) => slot.document !== true);
  const named = input.slots.filter((slot) => slot.document === true);
  const answered = asked.filter((slot) => slot.value.trim() !== "");
  const unanswered = asked.length - answered.length + input.openQuestions;
  const steps: SetupStep[] = [];
  if (asked.length > 0 || input.openQuestions > 0) {
    steps.push({
      key: "answers",
      title: "Control understanding",
      summary:
        input.openQuestions > 0
          ? `${unanswered} to answer`
          : answered.length === asked.length
            ? `All ${asked.length} answered`
            : `${answered.length} of ${asked.length} answered`,
      done: unanswered === 0,
      optional: false,
      mine: input.canAct,
    });
  }
  if (input.processRequired) {
    steps.push({
      key: "process",
      title: "Process understanding",
      summary: input.processPending ? "To confirm" : "Confirmed",
      done: !input.processPending,
      optional: false,
      mine: input.canAct,
    });
  }
  steps.push({
    key: "attributes",
    title: "Attributes",
    summary:
      input.proposedAttributes > 0
        ? `${input.proposedAttributes} proposed to decide`
        : input.approvedAttributes === 0
          ? "None approved yet"
          : `${input.approvedAttributes} approved`,
    done: input.approvedAttributes > 0 && input.proposedAttributes === 0,
    optional: false,
    mine: input.canAct,
  });
  // The policy or procedure the control names comes from a document linked here, so the name
  // and the file never disagree. Always optional: a client may have no formal document.
  const unnamed = named.filter((slot) => slot.value.trim() === "");
  const noDocument =
    named.length > 0 &&
    named.every((slot) => slot.value.trim() === NO_DOCUMENT);
  steps.push({
    key: "documents",
    title: "Governing documents",
    summary:
      unnamed.length > 0
        ? input.documents === 0
          ? "Link the governing policy"
          : unnamed.length === 1
            ? "Choose the governing policy"
            : `Choose ${unnamed.length} governing documents`
        : noDocument
          ? NO_DOCUMENT
          : input.documents === 0
            ? "None linked"
            : input.unreviewedDocuments > 0
              ? `${input.unreviewedDocuments} to review`
              : `${input.documents} linked`,
    done:
      unnamed.length === 0 &&
      (input.documents > 0 ? input.unreviewedDocuments === 0 : noDocument),
    optional: true,
    mine: input.canAct,
  });
  steps.push({
    key: "plan",
    title: "Test plan approval",
    summary: !input.plan.exists
      ? "Being drafted"
      : input.plan.approved
        ? "Approved"
        : input.plan.pendingReview
          ? "Awaiting approval"
          : "Draft to review",
    done: input.plan.approved,
    optional: false,
    mine: input.plan.exists && !input.plan.approved && input.canApprove,
  });
  return steps;
}

export type SetupState = {
  /** Nothing holds evidence gathering. */
  complete: boolean;
  /** Something left is the viewer's to do: the wizard opens on its own. */
  opensForViewer: boolean;
  /** What it waits on when nothing left is the viewer's: "" otherwise. */
  waitingOn: string;
  /** The step to open on: the first required one not done, else the first not done. */
  first: SetupStepKey | null;
};

/** Where the setup stands, given the steps and what readiness still holds. */
export function setupState(
  steps: readonly SetupStep[],
  readinessBlocked: boolean,
): SetupState {
  const left = steps.filter((step) => !step.done && !step.optional);
  const complete = left.length === 0 && !readinessBlocked;
  const mine = left.some((step) => step.mine);
  const waiting = left.find((step) => !step.mine);
  return {
    complete,
    opensForViewer: !complete && mine,
    waitingOn:
      !complete && !mine && waiting !== undefined
        ? waiting.key === "plan"
          ? "Waiting for the test plan's approval"
          : `Waiting for ${waiting.title.toLowerCase()}`
        : "",
    first: left[0]?.key ?? steps.find((step) => !step.done)?.key ?? null,
  };
}

/** Readiness states that hold evidence gathering, the setup's to clear. */
export const SETUP_HOLDS = [
  "NEEDS_INFORMATION",
  "CONFLICT_REQUIRES_REVIEW",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
] as const;

export type Prefill = {
  key: string;
  question: string;
  required: boolean;
  /** The answer on record, or the one the agent proposes. */
  value: string;
  /** Where the answer comes from: for an agent's question, its records (SOURCES), the
   * usual practice (TYPICAL), or a conflict the person settles between its sources. */
  source:
    | "RECORDED"
    | "PRIOR_YEAR"
    | "USUAL"
    | "NONE"
    | "SOURCES"
    | "TYPICAL"
    | "CONFLICT";
  /** The prior-year proposal to accept with it, so the decision is on record. */
  proposalId: string | null;
  /** The usual answers to choose from instead. */
  options: string[];
  /** An agent's question: the issue it settles. Absent on a client-specific question. */
  issue?: { id: string; version: number; point: boolean; conflict: boolean };
  /** Why an agent's question matters to testing. */
  why?: string;
  /** What the question rests on, where it is not said in the question itself: the sources'
   * disagreement, or the gap in an older question raised without its wording. */
  context?: string;
  /** An agent wrote this and the reviewer agent has not cleared its wording. */
  unchecked?: boolean;
  /** What the question is about, above it on the screen. */
  topic?: string;
  /** The question as short steps; absent or empty, it is one screen. */
  steps?: readonly InterviewStep[];
};

/** One step of an interview (control-context-model.InterviewStep). */
export type InterviewStep = {
  key: string;
  question: string;
  why: string;
  usual: string;
  basis: string;
  answers: ReadonlyArray<{ label: string; says: string; next: string }>;
};

/** A person's answer on one screen: an answer on offer, or their own words. */
export type Pick = { label: string } | { other: string };
/** A question's answers so far, by step. */
export type RowPicks = Readonly<Record<string, Pick>>;
/** The key a question of one screen keeps its answer under. */
export const ONE_SCREEN = "_";

/** Where the next step leads: the answer's own way on; for the person's own words, the way the
 * usual answer goes, so what they wrote is followed up as that would be. */
function nextKey(step: InterviewStep, pick: Pick): string {
  if ("label" in pick) {
    return step.answers.find((item) => item.label === pick.label)?.next ?? "";
  }
  const usual = step.answers.find((item) => item.label === step.usual);
  return (
    usual?.next ?? step.answers.find((item) => item.next !== "")?.next ?? ""
  );
}

/** The steps this person's answers lead through, and whether they reach the end. An answer
 * changed earlier takes another way: what was answered on the old way no longer counts. */
export function walkInterview(
  steps: readonly InterviewStep[],
  picks: RowPicks,
): { visited: InterviewStep[]; complete: boolean } {
  const visited: InterviewStep[] = [];
  let step = steps[0];
  while (step !== undefined) {
    visited.push(step);
    const pick = picks[step.key];
    if (pick === undefined) {
      return { visited, complete: false };
    }
    const next = nextKey(step, pick);
    step = next === "" ? undefined : steps.find((item) => item.key === next);
  }
  return { visited, complete: true };
}

/** The sentences a person's answers mean, in order: what is recorded. Their own words are kept
 * with the question they answer. */
export function interviewAnswer(
  steps: readonly InterviewStep[],
  picks: RowPicks,
): string {
  return walkInterview(steps, picks)
    .visited.flatMap((step) => {
      const pick = picks[step.key];
      if (pick === undefined) {
        return [];
      }
      if ("label" in pick) {
        const says = step.answers.find((item) => item.label === pick.label);
        return says === undefined ? [] : [says.says];
      }
      const words = pick.other.trim();
      return [`${step.question} ${words}${/[.!?]$/.test(words) ? "" : "."}`];
    })
    .join(" ");
}

/** What a person clicked, in a few words, for the summary. */
export function interviewShort(
  steps: readonly InterviewStep[],
  picks: RowPicks,
): string {
  return walkInterview(steps, picks)
    .visited.flatMap((step) => {
      const pick = picks[step.key];
      return pick === undefined
        ? []
        : ["label" in pick ? pick.label : pick.other.trim()];
    })
    .join(" · ");
}

export type Screen = { row: number; step: string };

export type Draft = {
  /** Each question's answers so far, by its key. */
  picks: Readonly<Record<string, RowPicks>>;
  /** Questions marked as not applicable. */
  dismissed: readonly string[];
};

/** Whether a question has what it needs: answered in full, on record, or set aside. */
export function rowComplete(row: Prefill, draft: Draft): boolean {
  if (row.source === "RECORDED" || draft.dismissed.includes(row.key)) {
    return true;
  }
  const picks = draft.picks[row.key] ?? {};
  return row.steps !== undefined && row.steps.length > 0
    ? walkInterview(row.steps, picks).complete
    : picks[ONE_SCREEN] !== undefined;
}

/** The screens the answers so far lead through, in order, ending at the first still to answer.
 * Branching decides how long this is, so the list is read again after every answer. */
export function screensFor(rows: readonly Prefill[], draft: Draft): Screen[] {
  const screens: Screen[] = [];
  for (const [at, row] of rows.entries()) {
    const steps = row.steps ?? [];
    if (
      steps.length > 0 &&
      row.source !== "RECORDED" &&
      !draft.dismissed.includes(row.key)
    ) {
      for (const step of walkInterview(steps, draft.picks[row.key] ?? {})
        .visited) {
        screens.push({ row: at, step: step.key });
      }
    } else {
      screens.push({ row: at, step: steps[0]?.key ?? ONE_SCREEN });
    }
    if (!rowComplete(row, draft)) {
      break;
    }
  }
  return screens;
}

/** Where the person is sent next: the first screen still to answer, or none: the summary. */
export function firstToAnswer(
  rows: readonly Prefill[],
  draft: Draft,
): number | null {
  if (rows.every((row) => rowComplete(row, draft))) {
    return null;
  }
  return screensFor(rows, draft).length - 1;
}

/** The screen after an answer; null is the summary. An edit goes on only to what the changed
 * answer now needs, then back to the summary. Otherwise the person walks on through the screens,
 * and reaches the summary after the last. */
export function nextScreen(
  rows: readonly Prefill[],
  draft: Draft,
  from: number,
  editing: boolean,
): number | null {
  const left = firstToAnswer(rows, draft);
  if (editing) {
    return left;
  }
  return left === null && from >= screensFor(rows, draft).length - 1
    ? null
    : from + 1;
}

export type SummaryRow = {
  key: string;
  /** What was asked, in a few words. */
  title: string;
  /** What the person chose, in a few words. */
  short: string;
  /** The sentence it records; "" when it says no more than the choice. */
  full: string;
  /** Already on record: an agent's question cannot be answered twice. */
  locked: boolean;
};

/** The summary before anything is confirmed: every question, what was chosen, what it means.
 * What confirming saves comes first; what is already on record follows. */
export function summaryRows(
  rows: readonly Prefill[],
  draft: Draft,
): SummaryRow[] {
  const onRecord = (row: Prefill) =>
    row.issue === undefined || row.source === "RECORDED";
  const ordered = [
    ...rows.filter((row) => !onRecord(row)),
    ...rows.filter(onRecord),
  ];
  return ordered.map((row) => {
    const base = {
      key: row.key,
      title: row.topic || row.question,
      locked: row.issue !== undefined && row.source === "RECORDED",
    };
    if (draft.dismissed.includes(row.key)) {
      return { ...base, short: "Not applicable", full: "" };
    }
    const picks = draft.picks[row.key] ?? {};
    if (row.steps !== undefined && row.steps.length > 0 && !base.locked) {
      return {
        ...base,
        short: interviewShort(row.steps, picks),
        full: interviewAnswer(row.steps, picks),
      };
    }
    const one = picks[ONE_SCREEN];
    const value =
      one === undefined
        ? row.value
        : "label" in one
          ? one.label
          : one.other.trim();
    return { ...base, short: value, full: "" };
  });
}

export type ConfirmPlan = {
  /** Narrative points, confirmed as one decision. */
  points: Array<{ issue_id: string; version: number; answer: string }>;
  /** Other questions, each on its own record. */
  resolved: Array<{ issueId: string; version: number; note: string }>;
  dismissed: Array<{ issueId: string; version: number; note: string }>;
  /** What each question's answer is, to keep it on screen once saved. */
  settled: Record<string, string>;
};

/** What confirming the summary saves. A client-specific question was saved as it was answered;
 * an agent's question is held until now, since it cannot be changed once resolved. */
export function confirmPlan(
  rows: readonly Prefill[],
  draft: Draft,
): ConfirmPlan {
  const plan: ConfirmPlan = {
    points: [],
    resolved: [],
    dismissed: [],
    settled: {},
  };
  for (const row of rows) {
    if (row.issue === undefined || row.source === "RECORDED") {
      continue;
    }
    const { id, version, point, conflict } = row.issue;
    if (draft.dismissed.includes(row.key)) {
      plan.dismissed.push({
        issueId: id,
        version,
        note: conflict
          ? "Dismissed in the control setup."
          : "Marked not applicable in the control setup.",
      });
      plan.settled[row.key] = conflict ? "Dismissed" : "Not applicable";
      continue;
    }
    const picks = draft.picks[row.key] ?? {};
    const answer =
      row.steps !== undefined && row.steps.length > 0
        ? interviewAnswer(row.steps, picks)
        : (summaryRows([row], draft)[0]?.short ?? "");
    if (answer === "") {
      continue;
    }
    plan.settled[row.key] = answer;
    if (point) {
      plan.points.push({ issue_id: id, version, answer });
    } else {
      plan.resolved.push({ issueId: id, version, note: answer });
    }
  }
  return plan;
}

/** Where this browser tab keeps answers not yet confirmed, so Skip for now loses no clicks. */
export function setupDraftKey(controlId: string): string {
  return `control-setup-draft:${controlId}`;
}

/** What an answer's tag says: where the choice already made comes from. */
export function choiceTag(row: Prefill, basis: string): string {
  const source = basis || row.source;
  return source === "SOURCES" || source === "RECORDED"
    ? "From the records"
    : source === "PRIOR_YEAR"
      ? "Prior year"
      : source === "TYPICAL" || source === "USUAL"
        ? "Usual"
        : "";
}

/** What the wizard reads of a control's issue (control-context-model.ContextIssue). */
export type SetupIssue = {
  id: string;
  origin: string;
  kind: string;
  topic: string;
  detail: string;
  why: string;
  quotes: ReadonlyArray<{ source: string; title: string; quote: string }>;
  status: string;
  version: number;
  question: string;
  suggestions: readonly string[];
  proposal: string;
  proposalBasis: string;
  raisedBy?: string;
  wordingReviewed?: boolean;
  interview?: readonly InterviewStep[];
};

/**
 * The agents' questions as answers to give: the fact asked, with the agent's statement
 * chosen and its alternatives beside it. A conflict has no statement to prefer: its
 * sources are the choices, and a person chooses. `settled` holds what was answered in this
 * visit, so Back shows it read-only while the page's records catch up. An issue settles
 * through the narrative's points when it is one (they redraft the narrative once none is
 * left), and through its own resolution otherwise; the audit is the same.
 */
export function agentQuestions(
  issues: readonly SetupIssue[],
  settled: Readonly<Record<string, string>> = {},
): Prefill[] {
  return issues
    .filter((issue) => issue.status === "OPEN" || issue.id in settled)
    .map((issue): Prefill => {
      const conflict = issue.kind === "CONFLICT";
      const proposal = conflict ? "" : issue.proposal.trim();
      const answer = settled[issue.id];
      const asked = issue.question.trim();
      const detail = issue.detail.trim();
      const base = {
        key: issue.id,
        // Never a statement as the heading: a conflict asks for the person's decision, and
        // an older question raised without its wording is headed by its topic.
        question:
          asked !== ""
            ? asked
            : conflict
              ? "Which of these reflects how the control runs?"
              : issue.topic.trim() || detail,
        context: asked === "" && detail !== issue.topic.trim() ? detail : "",
        topic: issue.topic.trim(),
        steps: conflict ? [] : (issue.interview ?? []),
        unchecked: issue.raisedBy === "AGENT" && issue.wordingReviewed !== true,
        required: true,
        proposalId: null,
        why: issue.why.trim(),
        issue: {
          id: issue.id,
          version: issue.version,
          point: issue.origin === "PROCESS" && issue.question.trim() !== "",
          conflict,
        },
      };
      if (answer !== undefined) {
        return { ...base, value: answer, source: "RECORDED", options: [] };
      }
      const options = conflict
        ? issue.quotes.map((item) => `${item.title}: "${item.quote}"`)
        : issue.suggestions;
      return {
        ...base,
        value: proposal,
        source: conflict
          ? "CONFLICT"
          : proposal === ""
            ? "NONE"
            : issue.proposalBasis === "SOURCES"
              ? "SOURCES"
              : "TYPICAL",
        options: [
          ...new Set(options.map((item) => item.trim()).filter(Boolean)),
        ].filter((item) => item !== proposal),
      };
    });
}

/** Answers too long for two to a row, such as a full statement to confirm or a quote. */
export function longChoices(choices: readonly string[]): boolean {
  return choices.some((item) => item.length > 48);
}

/**
 * Every client-specific question with its answer: the one on record, else the agent's
 * prior-year proposal, else the most usual answer; required ones first. A question with
 * none of these is left for the person to type.
 */
export function prefillAnswers(
  slots: ReadonlyArray<{
    key: string;
    question: string;
    label: string;
    value: string;
    blocks: boolean;
    options: readonly string[];
  }>,
  proposals: ReadonlyArray<{
    id: string;
    slotKey: string;
    value: string;
    status: string;
  }>,
): Prefill[] {
  const rows = slots.map((slot): Prefill => {
    const options = [
      ...new Set(slot.options.map((item) => item.trim()).filter(Boolean)),
    ];
    const base = {
      key: slot.key,
      question: slot.question.trim() || slot.label,
      required: slot.blocks,
      options,
    };
    if (slot.value.trim() !== "") {
      return {
        ...base,
        value: slot.value.trim(),
        source: "RECORDED",
        proposalId: null,
      };
    }
    const prior = proposals.find(
      (item) =>
        item.slotKey === slot.key &&
        item.status === "PROPOSED" &&
        item.value.trim() !== "",
    );
    if (prior !== undefined) {
      return {
        ...base,
        value: prior.value.trim(),
        source: "PRIOR_YEAR",
        proposalId: prior.id,
      };
    }
    const usual = options[0] ?? "";
    return {
      ...base,
      value: usual,
      source: usual === "" ? "NONE" : "USUAL",
      proposalId: null,
    };
  });
  return [
    ...rows.filter((row) => row.required),
    ...rows.filter((row) => !row.required),
  ];
}

/** The documents a document question is answered with: the control's own policies,
 * then procedures, then standards and the rest it holds as governing. */
export function documentChoices(
  documents: ReadonlyArray<{ id: string; title: string; kind: string }>,
): Array<{ id: string; title: string; kind: string }> {
  const rank = (kind: string) =>
    kind === "POLICY" ? 0 : kind === "PROCEDURE" ? 1 : 2;
  return [...documents]
    .filter((item) => item.title.trim() !== "")
    .sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** One question's choices: the usual answers, with the agent's answer first when it is
 * not one of them. */
export function answerChoices(row: Prefill): string[] {
  return row.value !== "" && !row.options.includes(row.value)
    ? [row.value, ...row.options]
    : [...row.options];
}

/** Where the questions start: the first not on record, else the first. */
export function firstOpenQuestion(rows: readonly Prefill[]): number {
  const at = rows.findIndex((row) => row.source !== "RECORDED");
  return at < 0 ? 0 : at;
}

export type SaveOne =
  | { kind: "none" }
  | {
      kind: "issue";
      issueId: string;
      version: number;
      answer: string;
      /** Settles through the narrative's points, not the issue's own resolution. */
      point: boolean;
    }
  | { kind: "accept"; proposalId: string }
  | { kind: "value"; value: string };

/** What saving one answer does: nothing when it is the answer already on record; the
 * prior-year proposal accepted (so the decision is on record with it) when the answer is
 * still the proposal's; else the answer saved as the person's. */
export function saveOne(row: Prefill, chosen: string): SaveOne {
  const value = chosen.trim();
  if (row.issue !== undefined) {
    return row.source === "RECORDED"
      ? { kind: "none" }
      : {
          kind: "issue",
          issueId: row.issue.id,
          version: row.issue.version,
          answer: value,
          point: row.issue.point,
        };
  }
  if (row.source === "RECORDED" && value === row.value) {
    return { kind: "none" };
  }
  if (
    row.source === "PRIOR_YEAR" &&
    row.proposalId !== null &&
    value === row.value
  ) {
    return { kind: "accept", proposalId: row.proposalId };
  }
  return { kind: "value", value };
}

/** Each step in a line, for the introduction before the wizard (product owner,
 * 2 November 2026: context first, then Let's begin opens the wizard). */
export const STEP_BRIEF: Record<SetupStepKey, string> = {
  answers: "Confirm key details and settle what the records leave open.",
  process: "Confirm how the process runs.",
  attributes: "Confirm and refine test attributes.",
  documents: "Link any governing policies the client has.",
  plan: "Approve procedures and evidence requests.",
};

/** The questions still to answer: those not on record, the governing documents not yet
 * named, and what the agents raised from the records. */
export function questionsLeft(input: SetupInput): number {
  return (
    input.slots.filter((slot) => slot.value.trim() === "").length +
    input.openQuestions
  );
}

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

/** A small count in words ("four quick questions"); larger ones as digits. */
export function countWord(count: number): string {
  return WORDS[count] ?? String(count);
}

/** The introduction's headline: what the person is asked to do. */
export function introHeadline(questions: number): string {
  return questions > 0
    ? `Answer ${countWord(questions)} quick question${questions === 1 ? "" : "s"} to help prepare a client-specific setup.`
    : "Review what the agent prepared to complete a client-specific setup.";
}

/** Where this browser remembers that the person began a control's setup, so the
 * introduction gives way to the wizard on later visits. */
export function setupBegunKey(controlId: string): string {
  return `control-setup-begun:${controlId}`;
}
