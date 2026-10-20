/**
 * An agent's execution state, in words a person can rely on (Milestone 1d). The lease
 * status on a record (queued, working) says what was handed to the background; whether
 * anything will pick it up depends on an agent worker being configured. "Running" is
 * said only when a run record is active and a worker exists; with no worker, automated
 * execution is unavailable and the block says so instead of implying work.
 */
export type RunState = "IDLE" | "QUEUED" | "RUNNING";

export type Automation = {
  /** A worker or workflow engine will pick up queued runs. */
  available: boolean;
  provider: "workflow" | "local" | "none";
  detail: string;
};

export type ExecutionState =
  | "READY"
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "UNAVAILABLE";

export type Execution = {
  state: ExecutionState;
  /** One short label, such as "Running" or "Automation unavailable". */
  label: string;
  /** One plain sentence on what that means for the work. */
  detail: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseAutomation(value: unknown): Automation | null {
  if (!isRecord(value) || typeof value.available !== "boolean") {
    return null;
  }
  const provider =
    value.provider === "workflow" || value.provider === "local"
      ? value.provider
      : "none";
  return {
    available: value.available,
    provider,
    detail: typeof value.detail === "string" ? value.detail : "",
  };
}

/** Unknown automation (the route did not answer) is treated as unavailable: nothing is
 * said to be running that cannot be shown to be. */
export const NO_AUTOMATION: Automation = {
  available: false,
  provider: "none",
  detail: "The automation status could not be read.",
};

const AGENT_WORDS = {
  tester: { noun: "the tester", work: "testing" },
  reviewer: { noun: "the reviewer agent", work: "re-performance" },
  drafter: { noun: "the drafting agent", work: "drafting" },
  reader: { noun: "the evidence reader", work: "reading" },
} as const;

export type AgentKind = keyof typeof AGENT_WORDS;

/**
 * The execution state of one agent's run from its record and the automation status.
 * `done` says the work's output is complete (all items tested, re-performed, drafted);
 * `failed` that the run stopped before finishing.
 */
export function executionOf(input: {
  agent: AgentKind;
  run: RunState;
  automation: Automation | null;
  done?: boolean;
  failed?: boolean;
}): Execution {
  const words = AGENT_WORDS[input.agent];
  const automation = input.automation ?? NO_AUTOMATION;
  if (input.failed === true) {
    return {
      state: "FAILED",
      label: "Stopped",
      detail: `${capital(words.noun)} stopped before finishing; a person runs it again.`,
    };
  }
  if (input.run === "QUEUED" || input.run === "RUNNING") {
    if (!automation.available) {
      return {
        state: "UNAVAILABLE",
        label: "Automation unavailable",
        detail: `A ${words.work} run is queued, but no agent worker is configured, so it will not start.`,
      };
    }
    return input.run === "RUNNING"
      ? {
          state: "RUNNING",
          label: "Running",
          detail: `${capital(words.noun)} is ${words.work} now; results appear as they finish.`,
        }
      : {
          state: "QUEUED",
          label: "Queued",
          detail: `Queued for ${words.noun}; the ${automation.provider === "local" ? "local worker" : "workflow engine"} starts it next.`,
        };
  }
  if (input.done === true) {
    return {
      state: "COMPLETED",
      label: "Completed",
      detail: `${capital(words.noun)} finished its ${words.work}; the results are on record.`,
    };
  }
  return {
    state: "READY",
    label: automation.available ? "Ready to run" : "Ready; no worker",
    detail: automation.available
      ? `Nothing is running; a person starts ${words.noun} when ready.`
      : `Nothing is running. No agent worker is configured, so ${words.noun} cannot be started here.`,
  };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
