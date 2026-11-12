/**
 * The control as its workflow (product owner, 8 November 2026; docs/control-workflow-plan.md): setup
 * and understanding, then two branches side by side, design and implementation (D&I) and
 * operating effectiveness (OE), each with its own evidence, joining at the control's conclusion,
 * its independent review, and the final workpaper. Evidence is one service: D&I's is the plan's
 * Design phase, OE's its Interim and Roll-forward phases. Pure: every status is read from the
 * records the page already holds, and laid out here so the canvas only draws it.
 */

import type {
  DesignConclusionStatus,
  DesignVerdict,
} from "./design-conclusion-model.ts";
import type { RequirementState } from "./evidence-plan-model.ts";

export type StepKey =
  | "setup"
  | "understanding"
  | "attributes"
  | "designevidence"
  | "designassessment"
  | "designconclusion"
  | "testdesign"
  | "oeevidence"
  | "oetesting"
  | "conclusion"
  | "review"
  | "workpaper";

export type Kind = "source" | "agent" | "gate" | "output";

export const KIND_LABELS: Record<Kind, string> = {
  source: "Source",
  agent: "AI agent",
  gate: "Human gate",
  output: "Output",
};

export type Tone =
  | "done"
  | "active"
  | "attention"
  | "blocked"
  | "idle"
  | "skipped";

export const TONE_LABELS: Record<Tone, string> = {
  done: "Done",
  active: "In progress",
  attention: "Needs attention",
  blocked: "Blocked",
  idle: "Not started",
  skipped: "Not performed",
};

export type Group = "prepare" | "design" | "operating" | "conclude";

export const GROUPS: ReadonlyArray<{ key: Group; label: string }> = [
  { key: "prepare", label: "Understand" },
  { key: "design", label: "D&I branch" },
  { key: "operating", label: "OE branch" },
  { key: "conclude", label: "Conclude" },
];

export const STEPS: ReadonlyArray<{
  key: StepKey;
  group: Group;
  kind: Kind;
  title: string;
  /** What the step covers, in a few words. */
  covers: string;
  /** How a step that waits on this one names it. */
  short: string;
}> = [
  {
    key: "setup",
    group: "prepare",
    kind: "source",
    title: "RCM / Control Setup",
    covers: "ID · Objective · Owner",
    short: "setup",
  },
  {
    key: "understanding",
    group: "prepare",
    kind: "agent",
    title: "Control Understanding",
    covers: "Walkthrough · Narrative",
    short: "understanding",
  },
  // The attributes before both branches (product owner, 11 November 2026): D&I is a test of
  // one against them, and they decide the evidence asked for; OE tests each sample against
  // them. The standard's come approved (L3e); a person decides the agent's tailoring.
  {
    key: "attributes",
    group: "prepare",
    kind: "gate",
    title: "Attributes",
    covers: "Standard · Tailored · Settled",
    short: "the attributes",
  },
  {
    key: "designevidence",
    group: "design",
    kind: "agent",
    title: "D&I Evidence",
    covers: "Policies · Walkthrough",
    short: "D&I evidence",
  },
  {
    key: "designassessment",
    group: "design",
    kind: "agent",
    title: "D&I Assessment",
    covers: "Design · Implementation",
    short: "D&I assessment",
  },
  {
    key: "designconclusion",
    group: "design",
    kind: "gate",
    title: "D&I Conclusion",
    covers: "Reviewer sign-off",
    short: "D&I conclusion",
  },
  {
    key: "testdesign",
    group: "operating",
    kind: "gate",
    title: "Scope & Sampling",
    covers: "Scope · Sampling · Periods",
    short: "plan approval",
  },
  {
    key: "oeevidence",
    group: "operating",
    kind: "agent",
    title: "OE Evidence",
    covers: "Population · Tickets · Logs",
    short: "OE evidence",
  },
  {
    key: "oetesting",
    group: "operating",
    kind: "agent",
    title: "OE Testing",
    covers: "Samples · Exceptions · Retest",
    short: "OE testing",
  },
  {
    key: "conclusion",
    group: "conclude",
    kind: "agent",
    title: "Control Conclusion",
    covers: "D&I · OE · Deficiencies",
    short: "the conclusion",
  },
  {
    key: "review",
    group: "conclude",
    kind: "gate",
    title: "Independent Review",
    covers: "Reviewer challenge",
    short: "the review",
  },
  {
    key: "workpaper",
    group: "conclude",
    kind: "output",
    title: "Final Workpaper",
    covers: "Evidence · Traceability",
    short: "the workpaper",
  },
];

type Paper = { status: "DRAFT" | "PREPARED"; drafting: boolean };

/** The facts the workflow reads, from the page's records. */
export type WorkflowInput = {
  /** The control's setup details (from the RCM), and whether each is recorded. */
  details: ReadonlyArray<{ label: string; filled: boolean }>;
  /** The guided setup's steps (control-setup-model.setupSteps). */
  setup: ReadonlyArray<{
    key: "answers" | "process" | "attributes" | "documents" | "plan";
    done: boolean;
    optional: boolean;
    mine: boolean;
    summary: string;
  }>;
  /** The control's attributes: approved, proposed for a decision, and the open questions
   * about them (origin ATTRIBUTES or SOURCES), which also hold them. */
  attributes: {
    approved: number;
    proposed: number;
    questions?: number;
    /** Approved attributes with no criteria a person owns, tailored to the control
     * (11 November 2026). */
    untailored?: number;
  };
  plan: { exists: boolean; approved: boolean; pendingReview: boolean };
  /** The evidence items, each in its phase (DESIGN, INTERIM, ROLLFORWARD). */
  requirements: ReadonlyArray<{ phase: string; state: RequirementState }>;
  /** The D&I evidence's own release (phase_release, B1): where it stands for the control.
   * Undefined or null when it could not be read: the evidence items alone decide then. */
  designRelease?: {
    step:
      | "NOT_APPLICABLE"
      | "AWAITING_PLAN"
      | "WAITING"
      | "READY"
      | "RELEASED"
      | "COMPLETE";
    /** What a waiting release waits on (11 November 2026): the attributes, once the
     * control is understood. Absent when not read. */
    waitingOn?: "" | "UNDERSTANDING" | "ATTRIBUTES" | "EVIDENCE";
    /** What it waits for, in the server's sentence (phase_release.understanding_waits). */
    waitingFor?: string;
  } | null;
  /** The interim test sheet: null until samples are drawn. */
  sheet: {
    method: "SAMPLE" | "TEST_OF_ONE";
    status: "OPEN" | "SIGNED_OFF";
    items: number;
    tested: number;
    exceptions: number;
    running: boolean;
    /** Its exceptions were raised as a finding or dismissed with a reason. */
    decided: boolean;
    reference: string | null;
  } | null;
  rounds: ReadonlyArray<{
    kind: "ROLLFORWARD" | "RETEST";
    status: "OPEN" | "SIGNED_OFF";
    conclusion: "EFFECTIVE" | "NOT_EFFECTIVE" | null;
  }>;
  /** Findings, with their type: DESIGN for a design deficiency. */
  findings: ReadonlyArray<{ reference: string; status: string; type: string }>;
  reviewStatus: string;
  conclusion: "NOT_CONCLUDED" | "EFFECTIVE" | "EXCEPTION";
  /** The verdict the server proposes for the control (control-conclusion-model; migration
   * 0144): null when it is not loaded or still waits on something. */
  proposedConclusion: "EFFECTIVE" | "NOT_EFFECTIVE" | null;
  /** The design workpaper (the D&I assessment) and the effectiveness one. */
  designPaper: Paper | null;
  /** The D&I conclusion a reviewer signs (design-conclusion-model; migration 0143): null when
   * it could not be read. */
  designConclusion: {
    status: DesignConclusionStatus;
    /** The verdict the records support now. */
    proposed: DesignVerdict | null;
    /** The verdict signed off, current or out of date. */
    signed: DesignVerdict | null;
  } | null;
  effectivenessPaper: Paper | null;
  /** Steps an agent is working on now. */
  busy: ReadonlySet<StepKey>;
};

export type WorkflowStep = (typeof STEPS)[number] & {
  number: number;
  tone: Tone;
  /** Where it stands: a state, never an instruction. */
  status: string;
  agent: boolean;
  /** A step to take up next: one per branch while both are open. */
  next: boolean;
};

const GONE: readonly RequirementState[] = [
  "CANCELLED",
  "REMOVED",
  "NOT_APPLICABLE",
];
const STALLED: readonly RequirementState[] = [
  "INSUFFICIENT",
  "FOLLOW_UP_REQUIRED",
  "OVERDUE",
];
const TO_REVIEW: readonly RequirementState[] = [
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "UNDER_REVIEW",
];
const NOT_YET: readonly RequirementState[] = [
  "NOT_GENERATED",
  "AWAITING_DEPENDENCY",
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVAL_PENDING",
];
const OPEN_FINDING = (status: string) =>
  status !== "REMEDIATED" && status !== "CLOSED";

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

function list(words: readonly string[]): string {
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

type State = { tone: Tone; status: string };

/** The D&I Evidence step's state while its evidence waits for a person's release (B1). */
export const TO_RELEASE = "To release";

const waiting = (on: StepKey): State => ({
  tone: "idle",
  status: `Waiting on ${STEPS.find((step) => step.key === on)?.short ?? on}`,
});

function setupState(input: WorkflowInput): State {
  const missing = input.details
    .filter((item) => !item.filled)
    .map((item) => item.label);
  if (missing.length === 0) {
    return {
      tone: "done",
      status: `${plural(input.details.length, "detail")} recorded`,
    };
  }
  return {
    tone: "attention",
    status: `${missing.length > 2 ? `${missing.slice(0, 2).join(", ")} and ${missing.length - 2} more` : list(missing)} to record`,
  };
}

function understandingState(input: WorkflowInput): State {
  const open = input.setup.find(
    (step) =>
      (step.key === "answers" || step.key === "process") &&
      !step.optional &&
      !step.done,
  );
  if (open !== undefined) {
    return { tone: open.mine ? "attention" : "active", status: open.summary };
  }
  // The setup steps are done, but the server's gate still waits (phase_release.
  // understanding_waits also holds it for an open question on the control and for every
  // required walkthrough question not answered): not understood, so the attributes wait and
  // the next-step card agrees with the D&I release card.
  if (input.designRelease?.waitingOn === "UNDERSTANDING") {
    return {
      tone: "attention",
      status: /walkthrough/i.test(input.designRelease.waitingFor ?? "")
        ? "Walkthrough to finish"
        : "Questions to answer",
    };
  }
  return { tone: "done", status: "Understood" };
}

/** One branch's evidence: its own phases' items, as the shared evidence service holds them. */
function evidenceState(
  items: ReadonlyArray<{ state: RequirementState }>,
  before: StepKey,
  ready: boolean,
): State {
  const current = items.filter((item) => !GONE.includes(item.state));
  if (current.length === 0) {
    return ready
      ? { tone: "idle", status: "No evidence planned yet" }
      : waiting(before);
  }
  const accepted = current.filter((item) => item.state === "ACCEPTED").length;
  const stalled = current.filter((item) => STALLED.includes(item.state)).length;
  const review = current.filter((item) =>
    TO_REVIEW.includes(item.state),
  ).length;
  const sent = current.filter((item) => item.state === "SENT").length;
  const later = current.filter((item) => NOT_YET.includes(item.state)).length;
  if (stalled > 0) {
    return {
      tone: "blocked",
      status: `${plural(stalled, "item")} not sufficient`,
    };
  }
  if (review > 0) {
    return { tone: "attention", status: `${plural(review, "item")} to review` };
  }
  if (sent > 0) {
    return {
      tone: "active",
      status:
        accepted > 0
          ? `${sent} with client · ${accepted} accepted`
          : `${sent} with the client`,
    };
  }
  if (accepted === 0) {
    return ready
      ? { tone: "attention", status: `${plural(later, "item")} to request` }
      : waiting(before);
  }
  return {
    tone: "done",
    status:
      later > 0
        ? `${accepted} accepted · ${later} later`
        : `${accepted} of ${current.length} accepted`,
  };
}

function assessmentState(input: WorkflowInput, evidence: State): State {
  const paper = input.designPaper;
  if (paper === null) {
    return evidence.tone === "done"
      ? { tone: "idle", status: "Not started" }
      : waiting("designevidence");
  }
  if (paper.drafting) {
    return { tone: "active", status: "Being drafted" };
  }
  return paper.status === "PREPARED"
    ? { tone: "done", status: "Assessed" }
    : { tone: "attention", status: "Draft to review" };
}

/** The D&I verdict that clears or stops OE: the one a reviewer signed off, while it holds.
 * Null until then: a prepared design workpaper alone concludes nothing. */
export function designVerdict(input: WorkflowInput): DesignVerdict | null {
  const conclusion = input.designConclusion;
  return conclusion?.status === "SIGNED_OFF" ? conclusion.signed : null;
}

// OE is tested only for a control designed effectively (product owner, 8 November 2026: "OE
// can't start if design is failing"; AS 2201): its evidence and testing wait for a D&I
// conclusion a reviewer signed off as effective, and are not performed when it is signed off
// as not effective.
const NOT_PERFORMED: State = {
  tone: "skipped",
  status: "Design not effective",
};
// OE work recorded before the D&I sign-off is flagged rather than shown as progress.
const EARLY: State = {
  tone: "attention",
  status: "Started before D&I sign-off",
};
// OE work recorded before the design was signed off as not effective: kept, not relied on.
const NOT_RELIED: State = { tone: "attention", status: "Not relied on" };

const VERDICT_WORDS: Record<DesignVerdict, string> = {
  EFFECTIVE: "Effective",
  NOT_EFFECTIVE: "Not effective",
};

function designConclusionState(input: WorkflowInput): State {
  const conclusion = input.designConclusion;
  if (conclusion === null) {
    return input.designPaper?.status === "PREPARED"
      ? { tone: "attention", status: "To sign off" }
      : waiting("designassessment");
  }
  if (conclusion.status === "NOT_READY") {
    return waiting("designassessment");
  }
  if (conclusion.status === "SIGNED_OFF" && conclusion.signed !== null) {
    return {
      tone: "done",
      status: `${VERDICT_WORDS[conclusion.signed]} · signed off`,
    };
  }
  if (conclusion.status === "OUT_OF_DATE") {
    return { tone: "attention", status: "Out of date · to sign again" };
  }
  return {
    tone: "attention",
    status:
      conclusion.proposed === null
        ? "To sign off"
        : `${VERDICT_WORDS[conclusion.proposed]} · to sign off`,
  };
}

/** The attributes, settled before both branches (11 November 2026), as the D&I release
 * reads them (phase_release.attribute_waits): approved, none proposed, no open question. */
function attributesState(input: WorkflowInput, understanding: State): State {
  const { approved, proposed } = input.attributes;
  const questions = input.attributes.questions ?? 0;
  if (understanding.tone !== "done") {
    return waiting("understanding");
  }
  // The agents are at work on the attributes and their criteria (12 November 2026): the
  // server says so in what the release waits for, and the counts follow when they finish.
  if (
    input.designRelease?.waitingOn === "ATTRIBUTES" &&
    /still updating/i.test(input.designRelease.waitingFor ?? "")
  ) {
    return { tone: "active", status: "Being updated" };
  }
  if (proposed > 0) {
    return {
      tone: "attention",
      status: `${plural(proposed, "attribute")} to decide`,
    };
  }
  if (questions > 0) {
    return {
      tone: "attention",
      status: `${plural(questions, "question")} on the attributes`,
    };
  }
  if (approved === 0) {
    return { tone: "attention", status: "None approved yet" };
  }
  // The testers judge evidence against each attribute's tailored criteria.
  const untailored = input.attributes.untailored ?? 0;
  if (untailored > 0) {
    return {
      tone: "attention",
      status: `${untailored} need${untailored === 1 ? "s" : ""} criteria`,
    };
  }
  // The counts say settled, but the server still waits: the agent is updating them.
  if (input.designRelease?.waitingOn === "ATTRIBUTES") {
    return { tone: "active", status: "Being updated" };
  }
  return { tone: "done", status: `${plural(approved, "attribute")} settled` };
}

/** Scope and sampling (OE's): the rest of the test plan, once the attributes are settled. */
function testDesignState(input: WorkflowInput, attributes: State): State {
  const { approved } = input.attributes;
  if (input.plan.approved) {
    return {
      tone: "done",
      status: `Approved · ${plural(approved, "attribute")}`,
    };
  }
  if (attributes.tone !== "done") {
    return waiting("attributes");
  }
  if (input.plan.pendingReview) {
    return { tone: "attention", status: "Awaiting approval" };
  }
  if (input.plan.exists) {
    return { tone: "active", status: "Plan being drafted" };
  }
  return { tone: "idle", status: "Not started" };
}

function oeTestingState(input: WorkflowInput, evidence: State): State {
  const sheet = input.sheet;
  if (sheet === null) {
    return evidence.tone === "done"
      ? { tone: "idle", status: "Not started" }
      : waiting("oeevidence");
  }
  const open = input.findings.filter(
    (item) => OPEN_FINDING(item.status) && item.type !== "DESIGN",
  );
  const retest = input.rounds.filter((round) => round.kind === "RETEST");
  const last = retest[retest.length - 1];
  if (sheet.running || sheet.tested < sheet.items) {
    return {
      tone: "active",
      status: `${sheet.tested} of ${sheet.items} tested`,
    };
  }
  if (sheet.exceptions > 0 && !sheet.decided) {
    return {
      tone: "attention",
      status: `${plural(sheet.exceptions, "exception")} to decide`,
    };
  }
  if (open.length > 0) {
    return {
      tone: "attention",
      status: `${plural(open.length, "finding")} to resolve`,
    };
  }
  if (retest.some((round) => round.status === "OPEN")) {
    return { tone: "active", status: "Retest in progress" };
  }
  if (sheet.status !== "SIGNED_OFF") {
    return {
      tone: "attention",
      status: `${sheet.tested} tested · to sign off`,
    };
  }
  if (last !== undefined) {
    return {
      tone: "done",
      status:
        last.conclusion === "EFFECTIVE"
          ? "Retest effective"
          : "Retest not effective",
    };
  }
  return {
    tone: "done",
    status:
      sheet.exceptions > 0
        ? `${plural(sheet.exceptions, "exception")}${sheet.reference !== null ? ` · ${sheet.reference}` : ""}`
        : `${sheet.tested} tested · no exceptions`,
  };
}

function conclusionState(
  input: WorkflowInput,
  verdict: ReturnType<typeof designVerdict>,
  testing: State,
): State {
  if (input.conclusion === "EFFECTIVE") {
    return { tone: "done", status: "Effective" };
  }
  if (input.conclusion === "EXCEPTION") {
    return { tone: "done", status: "Not effective" };
  }
  if (verdict === null) {
    return waiting("designconclusion");
  }
  // A design not effective decides the conclusion without OE.
  if (verdict === "NOT_EFFECTIVE") {
    return { tone: "active", status: "Proposed: not effective" };
  }
  if (testing.tone !== "done") {
    return waiting("oetesting");
  }
  // Both branches are done: the conclusion the records support, final once reviewed. The
  // server's proposal decides; without it, as the server does, a deficiency not closed
  // makes the control not effective, and exceptions retested effective do not.
  const proposed =
    input.proposedConclusion ??
    (input.findings.some((item) => item.status !== "CLOSED")
      ? "NOT_EFFECTIVE"
      : "EFFECTIVE");
  return {
    tone: "active",
    status:
      proposed === "NOT_EFFECTIVE"
        ? "Proposed: not effective"
        : "Proposed: effective",
  };
}

function reviewState(input: WorkflowInput): State {
  if (input.reviewStatus === "SIGNED_OFF") {
    return { tone: "done", status: "Signed off" };
  }
  return input.reviewStatus === "OPEN"
    ? { tone: "attention", status: "In review" }
    : waiting("conclusion");
}

function workpaperState(input: WorkflowInput): State {
  const paper = input.effectivenessPaper;
  if (paper === null) {
    return waiting("review");
  }
  if (paper.drafting) {
    return { tone: "active", status: "Being drafted" };
  }
  return paper.status === "PREPARED"
    ? { tone: "done", status: "Prepared" }
    : { tone: "active", status: "Draft" };
}

/** Every step with where it stands, and the steps to take up next. */
export function workflowOf(input: WorkflowInput): WorkflowStep[] {
  const understanding = understandingState(input);
  const attributes = attributesState(input, understanding);
  const phase = (phases: readonly string[]) =>
    input.requirements.filter((item) => phases.includes(item.phase));
  // D&I evidence has its own release, once the control is understood (B1) and its attributes
  // are settled (11 November 2026): until a person releases it, nothing of it is requested.
  const unreleased =
    input.designRelease?.step === "READY" ||
    input.designRelease?.step === "WAITING";
  const designEvidence: State = unreleased
    ? understanding.tone !== "done"
      ? waiting("understanding")
      : attributes.tone !== "done"
        ? waiting("attributes")
        : input.designRelease?.waitingOn === "EVIDENCE"
          ? // No D&I item evidences an approved attribute: an exception, not a release.
            { tone: "attention", status: "Not planned against the attributes" }
          : { tone: "attention", status: TO_RELEASE }
    : evidenceState(
        phase(["DESIGN"]),
        "understanding",
        // Released early, with the reason, the D&I evidence is under way before the
        // control is fully understood.
        understanding.tone === "done" ||
          input.designRelease?.step === "RELEASED",
      );
  const verdict = designVerdict(input);
  const oeItems = phase(["INTERIM", "ROLLFORWARD"]);
  // OE evidence requested, or OE samples drawn: OE work on record.
  const oeStarted = oeItems.some(
    (item) => !GONE.includes(item.state) && !NOT_YET.includes(item.state),
  );
  const tested = input.sheet !== null;
  const oeEvidence: State =
    verdict === "NOT_EFFECTIVE"
      ? oeStarted
        ? NOT_RELIED
        : NOT_PERFORMED
      : verdict === null
        ? oeStarted
          ? EARLY
          : waiting("designconclusion")
        : evidenceState(oeItems, "testdesign", input.plan.approved);
  const oeTesting: State =
    verdict === "NOT_EFFECTIVE"
      ? tested
        ? NOT_RELIED
        : NOT_PERFORMED
      : verdict === null
        ? tested
          ? EARLY
          : waiting("designconclusion")
        : oeTestingState(input, oeEvidence);
  const states: Record<StepKey, State> = {
    setup: setupState(input),
    understanding,
    attributes,
    designevidence: designEvidence,
    designassessment: assessmentState(input, designEvidence),
    designconclusion: designConclusionState(input),
    testdesign: testDesignState(input, attributes),
    oeevidence: oeEvidence,
    oetesting: oeTesting,
    conclusion: conclusionState(input, verdict, oeTesting),
    review: reviewState(input),
    workpaper: workpaperState(input),
  };
  const steps: WorkflowStep[] = STEPS.map((step, at) => ({
    ...step,
    number: at + 1,
    tone: states[step.key].tone,
    status: states[step.key].status,
    agent: input.busy.has(step.key),
    next: false,
  }));
  // The next steps: the first open step before the branches; once the attributes are settled,
  // the first open step in each branch as well (OE work flagged as started early is not one:
  // the D&I sign-off is); once the branches are done, the first open step to conclude. A
  // design signed off as not effective ends the OE branch.
  const settled = (step: WorkflowStep) =>
    step.tone === "done" || step.tone === "skipped";
  const open = (group: Group) =>
    steps.find(
      (step) =>
        step.group === group &&
        !settled(step) &&
        !step.status.startsWith("Waiting on") &&
        step.status !== EARLY.status &&
        step.status !== NOT_RELIED.status,
    );
  // The branches open once the attributes are settled (11 November 2026), and stay open once
  // work on them has started (the D&I evidence released or complete, or the plan approved):
  // a control already under way keeps its branches' next steps while its attributes still
  // need finishing (criteria tailored to the control, 11 November 2026), which the Attributes
  // step shows as work to finish alongside, not as a gate.
  const branchesOpen =
    attributes.tone === "done" ||
    input.designRelease?.step === "RELEASED" ||
    input.designRelease?.step === "COMPLETE" ||
    input.plan.approved;
  const done = (group: Group) =>
    steps.every((step) => step.group !== group || settled(step));
  const branchesDone =
    verdict === "NOT_EFFECTIVE"
      ? done("design")
      : verdict === "EFFECTIVE" && done("design") && done("operating");
  const nexts = [
    open("prepare"),
    ...(branchesOpen
      ? [
          open("design"),
          ...(verdict === "NOT_EFFECTIVE" ? [] : [open("operating")]),
        ]
      : []),
    ...(branchesDone ? [open("conclude")] : []),
  ];
  const marked = new Set(
    nexts.filter((step) => step !== undefined).map((step) => step.key),
  );
  return steps.map((step) =>
    marked.has(step.key) ? { ...step, next: true } : step,
  );
}

/** Where the control's work stands, for the header. */
export function progressOf(steps: readonly WorkflowStep[]): {
  done: number;
  of: number;
} {
  // A step not performed is neither done nor left to do.
  const counted = steps.filter((step) => step.tone !== "skipped");
  return {
    done: counted.filter((step) => step.tone === "done").length,
    of: counted.length,
  };
}

/** The panels a person can open beyond the steps. */
export type Opened = StepKey | "activity";

// Addresses from before (the tabs, the guided steps, and the 14-step workflow) open the step
// that holds their work now.
const LEGACY: Record<string, Opened> = {
  overview: "setup",
  risk: "setup",
  design: "designassessment",
  plan: "testdesign",
  approval: "testdesign",
  scope: "testdesign",
  evidence: "oeevidence",
  intake: "oeevidence",
  request: "oeevidence",
  population: "oeevidence",
  testing: "oetesting",
  test: "oetesting",
  samples: "oetesting",
  execute: "oetesting",
  results: "oetesting",
  resolution: "oetesting",
  findings: "oetesting",
  conclude: "conclusion",
  approvals: "review",
  workpapers: "workpaper",
  signoff: "workpaper",
  history: "activity",
  activity: "activity",
};

/** The panel an address opens (?step=), or null for the workflow alone. */
export function openedFrom(
  step: string | null,
  legacyTab: string | null,
): Opened | null {
  const asked = (step ?? "").toLowerCase();
  const named = STEPS.find((item) => item.key === asked);
  if (named !== undefined) {
    return named.key;
  }
  return LEGACY[asked] ?? LEGACY[(legacyTab ?? "").toLowerCase()] ?? null;
}

/** The step a form was posted from, to return to (?step=): one of the steps, else null. A
 * route redirects with it so a change made on D&I Evidence or the D&I Assessment comes back
 * to that step, not to the OE step an older ?tab= opens. */
export function returnStep(value: string | null | undefined): StepKey | null {
  const asked = (value ?? "").toLowerCase();
  return STEPS.find((item) => item.key === asked)?.key ?? null;
}

/** What each step's panel shows: the guided setup's screens, the control's sections, or both. */
export type Section =
  | "risk"
  | "setup-answers"
  | "setup-attributes"
  | "setup-plan"
  | "evidence"
  | "design"
  | "design-conclusion"
  | "testing"
  | "approvals"
  | "conclusion"
  | "workpaper"
  | "history";

export const SECTION_OF: Record<Opened, Section> = {
  setup: "risk",
  understanding: "setup-answers",
  attributes: "setup-attributes",
  designevidence: "evidence",
  designassessment: "design",
  designconclusion: "design-conclusion",
  testdesign: "setup-plan",
  oeevidence: "evidence",
  oetesting: "testing",
  conclusion: "conclusion",
  review: "approvals",
  workpaper: "workpaper",
  activity: "history",
};

/** What a step's panel says is not built yet, so it is never mistaken for done. */
export const NOT_YET_BUILT: Partial<Record<StepKey, string>> = {
  oeevidence:
    "Checks of the population's completeness and accuracy are not available yet.",
  workpaper:
    "The final sign-off, lock and retention of the workpaper are not available yet.",
};

// Layout: positions in canvas units, so the canvas draws what is decided here.

/** How the canvas marks each kind of step (an icon beside its label). */
export const KIND_ICON = {
  source: "database",
  agent: "sparkles",
  gate: "shield",
  output: "file",
} as const satisfies Record<Kind, string>;

// Sized to be read (product owner, 11 November 2026: "I can't even read the letters on it"):
// at the readable zoom below, a title is 14.4 px on screen and every other line 12.15 px.
export const NODE_SIZE = { width: 224, height: 120 };
/** Between two steps side by side, in a branch or in the preparation. */
const GAP_X = 28;
/** Between a stage and the one beside it, wide enough for the fork and the join. */
const GAP_BAND = 48;
/** Between two steps stacked in a column. */
const GAP_Y = 24;
/** Room above a band's steps for its label. */
export const BAND_HEAD = 36;
const BAND_PAD = 14;

export type Placed = { key: StepKey; x: number; y: number };

export type WorkflowEdge = {
  id: string;
  source: StepKey;
  target: StepKey;
  sourceHandle: "right" | "left" | "bottom";
  targetHandle: "left" | "right" | "top";
  /** The outcome an edge is taken on, where a step decides between two. */
  label?: string;
};

export type Band = {
  key: Group;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Time runs left to right and every edge runs forward or down (product owner, 8 November
 * 2026: the flow has to read the way the audit is done), on a grid of rows (11 November 2026:
 * compact enough to be read without shrinking). Setup leads into Control Understanding beside
 * it, and the understanding down into the Attributes, which open the two branches from the row
 * between them. D&I runs along the top row and OE along the third; OE starts one column later
 * than D&I: Scope & Sampling may begin once the attributes are settled, but OE Evidence sits
 * directly under the D&I Conclusion, whose effective verdict drops straight into it. A
 * not-effective verdict and OE Testing join at the Control Conclusion on the middle row, and
 * the review and the final workpaper follow below it.
 */
export function workflowLayout(): {
  placed: Placed[];
  bands: Band[];
  edges: WorkflowEdge[];
  size: { width: number; height: number };
} {
  const { width, height } = NODE_SIZE;
  const across = width + GAP_X;
  const row = (at: number) => at * (height + GAP_Y);
  // Columns: the preparation's two, four for the branches, and the conclusion.
  const prepareX = (at: number) => at * across;
  const branchX = (at: number) => prepareX(1) + width + GAP_BAND + at * across;
  const concludeX = branchX(3) + width + GAP_BAND;
  // Rows: D&I on the first, OE on the third; the fork and the join between them.
  const designY = row(0);
  const middle = row(1);
  const operatingY = row(2);
  const at: Record<StepKey, { x: number; y: number }> = {
    setup: { x: prepareX(0), y: designY },
    understanding: { x: prepareX(1), y: designY },
    attributes: { x: prepareX(1), y: middle },
    designevidence: { x: branchX(0), y: designY },
    designassessment: { x: branchX(1), y: designY },
    designconclusion: { x: branchX(2), y: designY },
    testdesign: { x: branchX(0), y: operatingY },
    oeevidence: { x: branchX(2), y: operatingY },
    oetesting: { x: branchX(3), y: operatingY },
    conclusion: { x: concludeX, y: middle },
    review: { x: concludeX, y: operatingY },
    workpaper: { x: concludeX, y: row(3) },
  };
  const band = (key: Group): Band => {
    const held = STEPS.filter((item) => item.group === key).map(
      (item) => at[item.key],
    );
    const left = Math.min(...held.map((item) => item.x));
    const right = Math.max(...held.map((item) => item.x)) + width;
    const top = Math.min(...held.map((item) => item.y));
    const bottom = Math.max(...held.map((item) => item.y)) + height;
    return {
      key,
      label: GROUPS.find((group) => group.key === key)?.label ?? key,
      x: left - BAND_PAD,
      y: top - BAND_HEAD,
      width: right - left + BAND_PAD * 2,
      height: bottom - top + BAND_HEAD + BAND_PAD,
    };
  };
  const rawBands = GROUPS.map((group) => band(group.key));
  // Everything moves so the band furthest up and left starts at the origin.
  const left = Math.min(...rawBands.map((item) => item.x));
  const top = Math.min(...rawBands.map((item) => item.y));
  const placed = STEPS.map((item) => ({
    key: item.key,
    x: at[item.key].x - left,
    y: at[item.key].y - top,
  }));
  const bands = rawBands.map((item) => ({
    ...item,
    x: item.x - left,
    y: item.y - top,
  }));
  const edge = (
    source: StepKey,
    target: StepKey,
    sourceHandle: WorkflowEdge["sourceHandle"] = "right",
    targetHandle: WorkflowEdge["targetHandle"] = "left",
  ): WorkflowEdge => ({
    id: `e:${source}>${target}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  });
  const edges = [
    // Rewritten 11 November 2026: Setup sits beside the understanding (before: above it).
    edge("setup", "understanding"),
    edge("understanding", "attributes", "bottom", "top"),
    edge("attributes", "designevidence"),
    edge("attributes", "testdesign"),
    edge("designevidence", "designassessment"),
    edge("designassessment", "designconclusion"),
    {
      ...edge("designconclusion", "oeevidence", "bottom", "top"),
      label: "Effective",
    },
    {
      ...edge("designconclusion", "conclusion"),
      label: "Not effective",
    },
    edge("testdesign", "oeevidence"),
    edge("oeevidence", "oetesting"),
    edge("oetesting", "conclusion"),
    edge("conclusion", "review", "bottom", "top"),
    edge("review", "workpaper", "bottom", "top"),
  ];
  return {
    placed,
    bands,
    edges,
    size: {
      width: Math.max(...bands.map((item) => item.x + item.width)),
      height: Math.max(...bands.map((item) => item.y + item.height)),
    },
  };
}

// Framing: how the canvas first shows the workflow. Pure, so the canvas and the height of its
// frame agree, and the rule is tested.

/** The smallest zoom the workflow is first shown at: its words stay readable, and a workflow
 * wider than the canvas pans sideways rather than shrinking (11 November 2026). */
export const READABLE_ZOOM = 0.9;
/** The room around the workflow, in canvas units. */
export const FRAME_PAD = 24;

export type Frame = {
  zoom: number;
  x: number;
  y: number;
  /** The canvas's height in pixels: the workflow's, at that zoom. */
  height: number;
  /** The workflow is wider than the canvas, so it pans sideways. */
  pans: boolean;
};

/** How far the workflow may pan sideways at a zoom, or null where all of it is in view. */
export function sidewaysLimits(
  zoom: number,
  canvasWidth: number,
  contentWidth: number,
): { min: number; max: number } | null {
  const max = FRAME_PAD * zoom;
  const min = canvasWidth - (contentWidth + FRAME_PAD) * zoom;
  return min < max - 0.5 ? { min, max } : null;
}

/**
 * The first view of a workflow `content` wide and high in a canvas `canvasWidth` wide: as large
 * as fits, never past full size and never under the readable zoom. Where it pans, it opens at
 * the start, moved on only as far as it takes to show `focus` (the step to do next, or the one
 * open), with a little of what leads into it.
 */
export function workflowFrame(
  canvasWidth: number,
  content: { width: number; height: number },
  focus: { x: number; width: number } | null = null,
): Frame {
  const fit = canvasWidth / (content.width + FRAME_PAD * 2);
  const zoom = Math.min(1, Math.max(READABLE_ZOOM, fit));
  const height = Math.round((content.height + FRAME_PAD * 2) * zoom);
  const y = FRAME_PAD * zoom;
  const limits = sidewaysLimits(zoom, canvasWidth, content.width);
  if (limits === null) {
    return {
      zoom,
      x: (canvasWidth - content.width * zoom) / 2,
      y,
      height,
      pans: false,
    };
  }
  let x = limits.max;
  if (focus !== null) {
    const right = x + (focus.x + focus.width + FRAME_PAD * 2) * zoom;
    if (right > canvasWidth) {
      x = Math.max(limits.min, x - (right - canvasWidth));
    }
  }
  return { zoom, x, y, height, pans: true };
}
