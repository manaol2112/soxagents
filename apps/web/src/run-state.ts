/** An agent's run on a record: queued for the background, executing now, or neither. */
export type RunState = "IDLE" | "QUEUED" | "RUNNING";

/** A person's cancellation of an agent job (Milestone 3a): asked for and pending,
 * carried out, or neither. */
export type CancelState = "NONE" | "REQUESTED" | "CANCELLED";

export function parseCancelState(value: unknown): CancelState {
  return value === "REQUESTED" || value === "CANCELLED" ? value : "NONE";
}

export function parseRunState(value: unknown, running: boolean): RunState {
  if (value === "IDLE" || value === "QUEUED" || value === "RUNNING") {
    return value;
  }
  // An API that only says whether work is pending: call it running.
  return running ? "RUNNING" : "IDLE";
}
