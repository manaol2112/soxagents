/**
 * The setup agent through onboarding (decided by the product owner): from the moment an
 * engagement is created until it is launched, onboarding is its own space, with the cycle
 * across the top and the agent beside each step. Onboarding is the client and scope (the
 * New engagement page, and the profile only when it still needs something), the team,
 * and launch; the systems, controls, and workpaper templates are set up in Controls
 * after launch. Worded from setup's own readiness; no model is called, and the copy keeps
 * the product's neutral voice.
 */

import type { CycleStage } from "./engagement-guide-model.ts";
import {
  launchReport,
  type Onboarding,
  SETUP_STEPS,
  type SetupStep,
  stepReadiness,
} from "./onboarding-model.ts";

/** The steps onboarding asks for before launch. */
export const ONBOARDING_STEPS: readonly SetupStep[] = ["profile", "team"];

/** What each step settles, as its brief and the agent state it. */
export const STEP_OUTCOME: Record<Exclude<SetupStep, "overview">, string> = {
  profile:
    "Agree the methodology, the period end, and the scope the engagement covers.",
  team: "Name who leads, prepares, and independently reviews the engagement.",
  controls:
    "Decide which systems and controls are in scope, with one accountable record for each.",
  workpapers:
    "The workpapers testing is documented in. The standard templates apply unless you customise or upload your firm's; preview them with a real control.",
  launch:
    "Check the plan and launch. The engagement starts; the systems, controls, and workpaper templates are then set up in Controls.",
};

const STEP_TIP: Record<Exclude<SetupStep, "overview">, string> = {
  profile:
    "The client and scope were entered when the engagement was created; this step holds only what still needs attention.",
  team: "The independent reviewer cannot also prepare the engagement's work; the lead approves the kickoff plan.",
  controls:
    "Add the in-scope systems first: controls that run on a system get one record per system. Load the standard library, or upload the client's RCM instead.",
  workpapers:
    "Preview a template with one of the engagement's own controls before confirming it.",
  launch:
    "Each control set up after launch gets its walkthrough, evidence request, test, and review. Nothing is requested until a plan is approved, and nothing is sent until an approver confirms it.",
};

function title(step: SetupStep): string {
  return step === "profile"
    ? "Client and scope"
    : (SETUP_STEPS.find((item) => item.id === step)?.title ?? step);
}

function complete(onboarding: Onboarding, step: SetupStep): boolean {
  return step === "launch"
    ? onboarding.started
    : stepReadiness(onboarding, step).complete;
}

/** The first onboarding step with something to do; null when all are ready. */
function nextOpen(onboarding: Onboarding): SetupStep | null {
  return ONBOARDING_STEPS.find((step) => !complete(onboarding, step)) ?? null;
}

/**
 * The step onboarding shows. Its overview is not a stop of its own: it opens on the first
 * onboarding step with something to do, or on launch when everything is ready.
 */
export function guidedStep(
  onboarding: Onboarding,
  requested: SetupStep,
): SetupStep {
  return requested === "overview"
    ? (nextOpen(onboarding) ?? "launch")
    : requested;
}

/** The onboarding cycle in guided setup: the client and scope, the team, and launch;
 * each done once ready, and the step open current. */
export function setupCycle(
  onboarding: Onboarding,
  current: SetupStep,
): CycleStage[] {
  return ([...ONBOARDING_STEPS, "launch"] as SetupStep[]).map(
    (step): CycleStage => {
      const ready = complete(onboarding, step);
      const issues =
        step === "launch" ? [] : stepReadiness(onboarding, step).issues;
      return {
        id: step,
        title: title(step),
        detail: ready
          ? step === "launch"
            ? "Launched"
            : step === "profile"
              ? "Entered"
              : "Ready"
          : issues.length > 0
            ? `${issues.length} to do`
            : step === "launch" && onboarding.ready
              ? "Ready to launch"
              : (SETUP_STEPS.find((item) => item.id === step)?.detail ?? ""),
        where: "here",
        state: step === current ? "current" : ready ? "done" : "upcoming",
      };
    },
  );
}

export type SetupBrief = {
  title: string;
  outcome: string;
  /** What the step still needs before launch. */
  todo: string[];
  /** What is worth checking, though it does not hold launch. */
  worth: string[];
  ready: boolean;
  progress: string;
  /** Where to go once this step is ready: the next step with something to do. */
  next: { step: SetupStep; label: string } | null;
  tip: string;
};

function progressLine(onboarding: Onboarding): string {
  const done = ONBOARDING_STEPS.filter((step) =>
    complete(onboarding, step),
  ).length;
  return `${done} of ${ONBOARDING_STEPS.length} onboarding steps ready.`;
}

/** What the agent says beside a step of onboarding. */
export function setupBrief(
  onboarding: Onboarding,
  step: SetupStep,
): SetupBrief {
  const shown = step === "overview" ? guidedStep(onboarding, step) : step;
  const key = shown === "overview" ? "launch" : shown;
  if (key === "launch") {
    const report = launchReport(onboarding);
    return {
      title: title("launch"),
      outcome: STEP_OUTCOME.launch,
      todo: report.blocking.map((line) => `${line.title}: ${line.message}`),
      worth: report.warnings.map((line) => `${line.title}: ${line.message}`),
      ready: onboarding.ready,
      progress: progressLine(onboarding),
      next: null,
      tip: STEP_TIP.launch,
    };
  }
  const state = stepReadiness(onboarding, key);
  // Once this step is ready: the first other onboarding step with something to do, else
  // launch.
  const open = ONBOARDING_STEPS.find(
    (item) => item !== key && !complete(onboarding, item),
  );
  return {
    title: title(key),
    outcome: STEP_OUTCOME[key],
    todo: state.issues,
    worth: state.advisories,
    ready: state.complete,
    progress: progressLine(onboarding),
    next: state.complete
      ? open !== undefined
        ? { step: open, label: `Continue: ${title(open)}` }
        : { step: "launch", label: "Review and launch" }
      : null,
    tip: STEP_TIP[key],
  };
}
