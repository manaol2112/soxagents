/**
 * The control's next step, said plainly above its workflow (product owner, 10 November 2026:
 * "it's not very clear what the user would do to begin the setup"; mock-up approved the same
 * day). Pure: it reads the workflow the nodes are drawn from, the step panels' own needs and
 * the agents' notes, so the card never disagrees with the nodes and never claims what the
 * records do not show. Nothing opens by itself: the card and the node point; the person
 * starts.
 */

import {
  KIND_LABELS,
  type StepKey,
  type WorkflowInput,
  type WorkflowStep,
} from "./control-workflow-model.ts";
import { agentNote, panelFrame } from "./step-panel-model.ts";

export type NextKind = "act" | "agent" | "flag";

export type NextAction = {
  key: StepKey;
  /** What the person does, as a title. */
  title: string;
  /** Why it matters, in a sentence. */
  detail: string;
  /** What the records show for the step: the agent's findings. */
  facts: string[];
  kind: NextKind;
  /** The step's kind, as the canvas names it (AI agent, Human gate, …). */
  kindLabel: string;
  /** The button that opens the step. */
  label: string;
  /** The words on the step's node. */
  flag: string;
};

export type NextStep =
  | { mode: "next"; actions: NextAction[] }
  | { mode: "done" }
  | { mode: "waiting"; title: string; detail: string };

export type Stage = {
  label: string;
  state: "done" | "here" | "todo";
};

/** The control the card names. */
export type About = { ref: string; system: string };

const STAGES: ReadonlyArray<{ label: string; keys: readonly StepKey[] }> = [
  { label: "Set up", keys: ["setup"] },
  { label: "Understand", keys: ["understanding", "attributes"] },
  {
    label: "D&I evidence",
    keys: ["designevidence", "designassessment", "designconclusion"],
  },
  { label: "Test", keys: ["testdesign", "oeevidence", "oetesting"] },
  { label: "Conclude", keys: ["conclusion", "review", "workpaper"] },
];

const settled = (step: WorkflowStep) =>
  step.tone === "done" || step.tone === "skipped";

/** One next step: what to do, why, what the records show, and the button that opens it. */
function actionOf(
  step: WorkflowStep,
  steps: readonly WorkflowStep[],
  input: WorkflowInput,
  about: About,
  several: boolean,
  fresh: boolean,
): NextAction {
  const need = panelFrame(step.key, steps, null).need;
  // An agent is at work on the step, or the step only waits on one (a settled D&I
  // requests list the server releases itself): nothing is asked of the person.
  const kind: NextKind =
    step.agent || need.kind === "agent"
      ? "agent"
      : need.kind === "flag"
        ? "flag"
        : "act";
  const on = about.system === "" ? "" : ` on ${about.system}`;
  const title =
    kind === "agent"
      ? `${step.title} is being prepared`
      : step.key === "understanding"
        ? `Confirm how ${about.ref} runs${on}`
        : step.key === "setup" && need.kind === "act"
          ? `Complete ${about.ref}'s details`
          : need.title;
  const detail =
    kind === "agent"
      ? "An agent is preparing this step. Nothing is needed from you yet; this card shows the next action when it is ready."
      : need.detail;
  return {
    key: step.key,
    title,
    detail,
    facts: agentNote(step, input).found.filter((line) => line !== ""),
    kind,
    kindLabel: KIND_LABELS[step.kind],
    label:
      kind === "agent"
        ? `Open ${step.title}`
        : several
          ? (need.action?.label ?? `Open ${step.title}`)
          : `Start: ${step.title}`,
    flag:
      kind === "agent"
        ? "Being prepared"
        : kind === "flag"
          ? "Needs attention"
          : several
            ? "Ready"
            : fresh
              ? "Start here"
              : "Next",
  };
}

/** The control's next step, from its workflow. */
export function nextStep(
  steps: readonly WorkflowStep[],
  input: WorkflowInput,
  about: About,
): NextStep {
  const nexts = steps.filter((step) => step.next);
  if (nexts.length === 0) {
    if (steps.length > 0 && steps.every(settled)) {
      return { mode: "done" };
    }
    // Every open step waits on something outside this control's own work.
    const held = steps.find((step) => !settled(step));
    return {
      mode: "waiting",
      title: held === undefined ? "Nothing to do yet" : held.status,
      detail:
        "Nothing is needed from you on this control now. This card shows the next action when there is one.",
    };
  }
  // A control with only its setup done is new: its first step is where to start.
  const fresh = steps.filter((step) => step.tone === "done").length <= 1;
  return {
    mode: "next",
    actions: nexts.map((step) =>
      actionOf(step, steps, input, about, nexts.length > 1, fresh),
    ),
  };
}

/** The flags on the nodes: the same next steps the card names, in the card's words. */
export function nodeFlags(next: NextStep): Partial<Record<StepKey, string>> {
  return next.mode === "next"
    ? Object.fromEntries(next.actions.map((each) => [each.key, each.flag]))
    : {};
}

/** The eleven steps as five plain stages, with where the control is: every stage that holds
 * a next step (the D&I and OE branches run side by side, so both can be current). */
export function journey(steps: readonly WorkflowStep[]): Stage[] {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const of = (keys: readonly StepKey[]) =>
    keys
      .map((key) => byKey.get(key))
      .filter((step): step is WorkflowStep => step !== undefined);
  return STAGES.map((stage) => {
    const all = of(stage.keys);
    const here = all.some((step) => step.next);
    const done = all.length > 0 && all.every(settled);
    return {
      label: stage.label,
      state: here ? "here" : done ? "done" : "todo",
    };
  });
}
