/**
 * The control's journey as the API derives it (control_journey.py): the step the
 * control is at, each testing phase's state and readiness, what is outstanding, and
 * whether the conclusion is final. The workspace reads it; nothing here decides
 * anything, and the stepper it feeds is a map, never a gate.
 */
export const STEPS = ["PLAN", "REQUEST", "TEST", "CONCLUDE", "REVIEW"] as const;
export type Step = (typeof STEPS)[number];
export type JourneyStep = Step | "DONE";

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
