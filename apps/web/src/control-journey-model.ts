import type { DetailTab } from "./engagement-model.ts";

/**
 * The control's journey as the API derives it (control_journey.py): the step the
 * control is at, each testing phase's state and readiness, what is outstanding, and
 * whether the conclusion is final. The workspace reads it; nothing here decides
 * anything, and the stepper it feeds is a map, never a gate.
 */
export const STEPS = ["PLAN", "REQUEST", "TEST", "CONCLUDE", "REVIEW"] as const;
export type Step = (typeof STEPS)[number];
export type JourneyStep = Step | "DONE";

export const STEP_LABELS: Record<Step, string> = {
  PLAN: "Plan",
  REQUEST: "Request",
  TEST: "Test",
  CONCLUDE: "Conclude",
  REVIEW: "Review",
};

export const PHASES = [
  "DESIGN",
  "INTERIM",
  "ROLLFORWARD",
  "REMEDIATION",
  "RETEST",
] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_STATES = [
  "NOT_APPLICABLE",
  "AWAITING_PLAN",
  "PLANNED",
  "RELEASED",
  "REQUESTED",
  "RECEIVED",
  "TESTING",
  "RESULTS_TO_CONFIRM",
  "SIGNED_OFF",
  "REVIEWED",
] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

export type JourneyPhase = {
  phase: Phase;
  label: string;
  state: PhaseState;
  stateLabel: string;
  readyForTesting: boolean;
  blockers: string[];
  releasedEarly: boolean;
};

export type ControlJourney = {
  step: JourneyStep;
  stepPhase: Phase | null;
  action: string;
  actor: string;
  phases: JourneyPhase[];
  blockers: string[];
  reopened: string;
  staleResults: boolean;
  final: boolean;
  notFinalBecause: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function parseJourney(value: unknown): ControlJourney | null {
  if (!isRecord(value)) {
    return null;
  }
  const step = value.step;
  if (!STEPS.includes(step as Step) && step !== "DONE") {
    return null;
  }
  const phases: JourneyPhase[] = [];
  for (const item of Array.isArray(value.phases) ? value.phases : []) {
    if (!isRecord(item)) {
      continue;
    }
    const phase = PHASES.find((name) => name === item.phase);
    const state = PHASE_STATES.find((name) => name === item.state);
    if (phase === undefined || state === undefined) {
      continue;
    }
    phases.push({
      phase,
      label: str(item.label) || phase,
      state,
      stateLabel: str(item.state_label),
      readyForTesting: item.ready_for_testing === true,
      blockers: strings(item.blockers),
      releasedEarly: item.released_early === true,
    });
  }
  return {
    step: step as JourneyStep,
    stepPhase: PHASES.find((name) => name === value.step_phase) ?? null,
    action: str(value.action),
    actor: str(value.actor),
    phases,
    blockers: strings(value.blockers),
    reopened: str(value.reopened),
    staleResults: value.stale_results === true,
    final: value.final === true,
    notFinalBecause: strings(value.not_final_because),
  };
}

/** The step a link asked for (?step=), else the journey's own; Done opens Review. */
export function currentStep(
  journey: ControlJourney | null,
  asked: string | null,
): Step {
  const wanted = STEPS.find((step) => step === (asked ?? "").toUpperCase());
  if (wanted !== undefined) {
    return wanted;
  }
  if (journey === null || journey.step === "DONE") {
    return "REVIEW";
  }
  return journey.step;
}

export type StepperItem = {
  step: Step;
  label: string;
  /** Where the control is: done (behind the journey's step), current, or upcoming. A
   * reopened step is current again; nothing here stops a step being opened. */
  status: "done" | "working" | "current" | "upcoming";
  /** The one-line receipt under a done step, or the state under the current one. */
  note: string;
};

/** The five steps with where the control stands, from the journey alone. */
export function stepperItems(journey: ControlJourney | null): StepperItem[] {
  const at =
    journey === null
      ? -1
      : journey.step === "DONE"
        ? STEPS.length
        : STEPS.indexOf(journey.step);
  // A step behind the journey's with work still in hand (testing in progress, a review
  // not signed off) is open, not done: the stepper never shows it as complete.
  const working = new Set<Step>();
  for (const text of journey?.final === false ? journey.notFinalBecause : []) {
    if (/ (in progress|not signed off)$/.test(text)) {
      working.add(stepForReason(text));
    }
  }
  return STEPS.map((step, index) => {
    const status: StepperItem["status"] =
      journey === null
        ? "upcoming"
        : index < at
          ? working.has(step)
            ? "working"
            : "done"
          : index === at
            ? "current"
            : "upcoming";
    return {
      step,
      label: STEP_LABELS[step],
      status,
      note: stepNote(journey, step, status),
    };
  });
}

function stepNote(
  journey: ControlJourney | null,
  step: Step,
  status: StepperItem["status"],
): string {
  if (journey === null) {
    return "";
  }
  if (step === "REVIEW" && journey.step === "DONE") {
    return journey.final ? "Final" : "Concluded, not final";
  }
  if (status === "working") {
    return (
      journey.notFinalBecause.find(
        (text) =>
          / (in progress|not signed off)$/.test(text) &&
          stepForReason(text) === step,
      ) ?? ""
    );
  }
  if (status === "current") {
    const phase = journey.phases.find(
      (item) => item.phase === journey.stepPhase,
    );
    return phase !== undefined
      ? `${phase.label}: ${phase.stateLabel.toLowerCase()}`
      : "";
  }
  return "";
}

/** The classic tab each step opens by default, and the step each classic tab is part of. */
export const STEP_TABS: Record<Step, DetailTab> = {
  PLAN: "design",
  REQUEST: "evidence",
  TEST: "testing",
  CONCLUDE: "findings",
  REVIEW: "review",
};
const TAB_STEPS: Record<DetailTab, Step> = {
  overview: "PLAN",
  design: "PLAN",
  evidence: "REQUEST",
  testing: "TEST",
  findings: "CONCLUDE",
  review: "REVIEW",
  activity: "REVIEW",
};

export function stepForTab(tab: DetailTab): Step {
  return TAB_STEPS[tab];
}

/** The phases shown on the strip: every phase the journey lists (retest and remediation
 * appear only once opened), with its state in words and whether it holds testing. */
export function phaseItems(journey: ControlJourney | null): JourneyPhase[] {
  return journey === null
    ? []
    : journey.phases.filter((item) => item.state !== "NOT_APPLICABLE");
}

export type Blocker = {
  text: string;
  /** The step where it is resolved. */
  step: Step;
  /** Whether it holds the control's completion (a not-final reason) rather than one phase. */
  holdsConclusion: boolean;
};

const PHASE_STEP: Record<PhaseState, Step> = {
  NOT_APPLICABLE: "PLAN",
  AWAITING_PLAN: "PLAN",
  PLANNED: "REQUEST",
  RELEASED: "REQUEST",
  REQUESTED: "REQUEST",
  RECEIVED: "TEST",
  TESTING: "TEST",
  RESULTS_TO_CONFIRM: "TEST",
  SIGNED_OFF: "CONCLUDE",
  REVIEWED: "REVIEW",
};

const PHASE_WORDS: Record<Phase, string> = {
  DESIGN: "design",
  INTERIM: "interim",
  ROLLFORWARD: "roll-forward",
  REMEDIATION: "remediation",
  RETEST: "retest",
};

/**
 * Everything outstanding on the control, each cause once, in plain words, with the step
 * where it is resolved. What holds the conclusion comes first (a plan revision, a
 * review, a coverage gap), then what holds each open phase, one line per cause with the
 * phases it holds. Work a later phase has simply not reached yet is not a blocker.
 */
export function blockersOf(journey: ControlJourney | null): Blocker[] {
  if (journey === null) {
    return [];
  }
  const found: Blocker[] = [];
  const seen = new Set<string>();
  const add = (text: string, step: Step, holdsConclusion: boolean) => {
    if (text !== "" && !seen.has(text)) {
      seen.add(text);
      found.push({ text, step, holdsConclusion });
    }
  };
  for (const text of journey.notFinalBecause) {
    // "… testing outstanding" is a phase not yet reached: its own line below says what
    // it waits for; "… not signed off" or "in progress" is current work, not a blocker.
    if (/ testing (outstanding|not signed off|in progress)$/.test(text)) {
      continue;
    }
    // At Plan, the unapproved plan is the action itself, not a blocker beside it.
    if (journey.step === "PLAN" && stepForReason(text) === "PLAN") {
      continue;
    }
    add(text, stepForReason(text), true);
  }
  const causes = new Map<string, { step: Step; phases: Phase[] }>();
  for (const phase of journey.phases) {
    const cause = phase.blockers[0];
    if (phase.state === "NOT_APPLICABLE" || cause === undefined) {
      continue;
    }
    const entry = causes.get(cause) ?? {
      step: PHASE_STEP[phase.state],
      phases: [],
    };
    entry.phases.push(phase.phase);
    causes.set(cause, entry);
  }
  const open = new Set(journey.phases.map((item) => item.label));
  for (const [cause, entry] of causes) {
    const holds = entry.phases.map((name) => PHASE_WORDS[name]).join(", ");
    add(`${cause} (holds ${holds})`, entry.step, false);
  }
  const impactHeld = journey.notFinalBecause.some((text) =>
    text.includes("impact assessment"),
  );
  for (const text of journey.blockers) {
    // The API's phase lines ("Interim …: planned, not released") repeat what the phase's
    // own cause above already says, as its impact line repeats the not-final reason;
    // anything else is kept.
    const label = text.split(":")[0] ?? "";
    if (open.has(label) && causes.size > 0) {
      continue;
    }
    if (impactHeld && text.toLowerCase().includes("impact")) {
      continue;
    }
    add(text, stepForReason(text), false);
  }
  return found;
}

function stepForReason(text: string): Step {
  const lower = text.toLowerCase();
  if (lower.includes("test plan") || lower.includes("impact assessment")) {
    return "PLAN";
  }
  if (lower.includes("review")) {
    return "REVIEW";
  }
  if (lower.includes("deficienc") || lower.includes("workpaper")) {
    return "CONCLUDE";
  }
  if (lower.endsWith("testing in progress")) {
    return "TEST";
  }
  if (
    lower.includes("requested") ||
    lower.includes("not released") ||
    lower.includes("request")
  ) {
    return "REQUEST";
  }
  return "TEST";
}

export type NeedsYou = {
  /** The one thing that moves the control forward, in the register's words. */
  title: string;
  /** "You" when the viewer may do it, else who it waits on. */
  who: string;
  /** "the preparer (Dana Whitfield)": the role and, when assigned, the people; "" when
   * the step is the viewer's or no one's. */
  waitsOn: string;
  mine: boolean;
  /** Why it is open, when the step was reopened or the conclusion is held. */
  reason: string;
  /** The step the action belongs to. */
  step: Step;
};

const ACTOR_WORDS: Record<string, string> = {
  PREPARER: "The preparer",
  APPROVER: "An approver",
  REVIEWER: "The reviewer",
  CLIENT: "The control owner (client)",
  AGENT: "An agent",
  NONE: "No one",
};

/** The Needs-you card: role-aware, from the register's next step and the journey. */
export function needsYou(input: {
  nextStep: string;
  actor: string;
  yours: boolean;
  journey: ControlJourney | null;
  /** The viewer is the reviewer who may decide a pending impact assessment. */
  decideImpact?: boolean;
  /** Who the control's work is assigned to, when the step is not the viewer's. */
  assignees?: string[];
}): NeedsYou {
  const journey = input.journey;
  if (input.decideImpact === true) {
    // The reviewer's decision comes before anything the preparer does with the results.
    return {
      title:
        "Decide whether the signed-off results stand under the revised plan",
      who: "You",
      waitsOn: "",
      mine: true,
      reason:
        "The test plan changed after results were signed off. Nothing relies on them until you decide; the agent's recommendation is advice.",
      step: "PLAN",
    };
  }
  const step =
    journey === null
      ? "PLAN"
      : journey.step === "DONE"
        ? "REVIEW"
        : journey.step;
  // Why the step is open, when that is not the action itself: reopened testing, results
  // awaiting an impact decision, or (once the opinion is reached) what keeps it from
  // being final.
  const reason =
    journey === null
      ? ""
      : journey.reopened !== ""
        ? `Testing reopened: ${journey.reopened}`
        : journey.staleResults
          ? "Results were signed off before the plan changed; they are not relied on until a reviewer decides."
          : journey.step === "DONE" ||
              journey.step === "REVIEW" ||
              journey.step === "CONCLUDE"
            ? (journey.notFinalBecause[0] ?? "")
            : "";
  const who = input.yours ? "You" : (ACTOR_WORDS[input.actor] ?? input.actor);
  const names = (input.assignees ?? []).filter((name) => name !== "");
  return {
    title: input.nextStep,
    who,
    waitsOn:
      input.yours || input.actor === "NONE"
        ? ""
        : `${who.charAt(0).toLowerCase()}${who.slice(1)}${names.length > 0 ? ` (${names.join(", ")})` : ""}`,
    mine: input.yours,
    reason,
    step,
  };
}

/** The three things a control can be, kept apart: testing complete, review complete,
 * final conclusion. */
export function completion(journey: ControlJourney | null): {
  testing: boolean;
  review: boolean;
  final: boolean;
} {
  if (journey === null) {
    return { testing: false, review: false, final: false };
  }
  const applicable = journey.phases.filter(
    (item) => item.state !== "NOT_APPLICABLE",
  );
  const testing =
    applicable.length > 0 &&
    applicable.every(
      (item) => item.state === "SIGNED_OFF" || item.state === "REVIEWED",
    );
  const review =
    applicable.length > 0 &&
    applicable.every((item) => item.state === "REVIEWED");
  return { testing, review, final: journey.final };
}
