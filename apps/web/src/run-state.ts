/** An agent's run on a record: queued for the background, executing now, or neither. */
export type RunState = "IDLE" | "QUEUED" | "RUNNING";

export function parseRunState(value: unknown, running: boolean): RunState {
  if (value === "IDLE" || value === "QUEUED" || value === "RUNNING") {
    return value;
  }
  // An API that only says whether work is pending: call it running.
  return running ? "RUNNING" : "IDLE";
}
