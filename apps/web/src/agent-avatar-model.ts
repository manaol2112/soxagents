/**
 * The agent's look by what it is doing (product owner, 2 November 2026: agents that
 * look and move like what they are doing). Pure: the state for a task's status, how it
 * reads, and how much detail a size can carry.
 */

export type AgentState = "idle" | "thinking" | "working" | "done" | "attention";

/** How each state reads, after the agent's name ("Audit Agent, working"). */
export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  idle: "ready",
  thinking: "thinking",
  working: "working",
  done: "done",
  attention: "needs you",
};

const THINKING = new Set(["PENDING", "QUEUED", "STARTING", "ANALYZING"]);
const WORKING = new Set(["WORKING", "RUNNING", "IN_PROGRESS", "DRAFTING"]);
const DONE = new Set(["DONE", "COMPLETED", "SUCCEEDED", "READY"]);
const ATTENTION = new Set([
  "FAILED",
  "NEEDS_INPUT",
  "NEEDS_REVIEW",
  "BLOCKED",
  "SETUP_REQUIRED",
]);

/** The state for an agent run's or a task's status; ready when it names none. */
export function agentStateOf(status: string | null | undefined): AgentState {
  const key = (status ?? "").trim().toUpperCase();
  if (THINKING.has(key)) {
    return "thinking";
  }
  if (WORKING.has(key)) {
    return "working";
  }
  if (DONE.has(key)) {
    return "done";
  }
  if (ATTENTION.has(key)) {
    return "attention";
  }
  return "idle";
}

/** Below this size the hands, orbiting sparks and badges would be noise: the head,
 * visor, eyes and antenna carry the state alone. */
export const COMPACT_BELOW = 30;

export function avatarDetail(size: number): "full" | "compact" {
  return size < COMPACT_BELOW ? "compact" : "full";
}

/** What the agent shows when clicked, by its state: what it is doing, in a line, in
 * the product's neutral voice. A screen's own line (`says`) takes its place where it
 * knows more. */
export const AGENT_SAYS: Record<AgentState, string> = {
  idle: "Ready to help with this engagement.",
  thinking: "Reviewing the details…",
  working: "Working on this now. The result appears here when it is ready.",
  done: "Finished and ready for review.",
  attention: "A few details are needed to continue.",
};

/** How it reacts to a click, in turn: a hop, a wink, a little love, a spin. */
export const REACTIONS = ["hop", "wink", "love", "spin"] as const;
export type Reaction = (typeof REACTIONS)[number];

export function nextReaction(clicks: number): Reaction {
  return REACTIONS[clicks % REACTIONS.length] ?? "hop";
}

/** Below this size the agent is a mark inside another control, never its own button. */
export function clickableAt(size: number): boolean {
  return size > COMPACT_BELOW;
}
