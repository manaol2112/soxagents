/**
 * The engagement lifecycle (Milestones 8.13 and 8.14), in one place for every page. It
 * mirrors the API's rules (`projects.py` `_TRANSITIONS`, `engagement_close.py`, migrations
 * 0067 and 0068): a draft becomes active only by launching it from setup, which happens
 * once; an active engagement can be paused and resumed; it is completed when its work is
 * done, which makes it read-only until an owner or admin reopens it; archiving closes it
 * for good. A draft that never launched can be deleted by an owner or admin. Pages ask
 * this module what the engagement is and what it allows, and none of them compares
 * statuses on its own.
 */

export type EngagementStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED";

/**
 * Where the engagement is: being set up, ready to launch, running, paused, completed, or
 * closed (archived). A closed engagement may never have run.
 */
export type EngagementPhase =
  | "setup"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "closed";

export type LifecycleFacts = {
  status: string;
  /** The kickoff is on record (the API's `started`). */
  started: boolean;
  /** Every setup step is complete (the API's `ready`). */
  ready: boolean;
};

/** The status changes a person makes outside launching, from the engagement's settings. */
export type StatusAction = "pause" | "resume" | "archive";

const TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  DRAFT: ["DRAFT", "ARCHIVED"],
  ACTIVE: ["ACTIVE", "PAUSED", "ARCHIVED"],
  PAUSED: ["PAUSED", "ACTIVE", "ARCHIVED"],
  // Completing and reopening have their own actions; from settings it is archived only.
  COMPLETED: ["COMPLETED", "ARCHIVED"],
  ARCHIVED: [],
};

const ACTION_STATUS: Record<StatusAction, EngagementStatus> = {
  pause: "PAUSED",
  resume: "ACTIVE",
  archive: "ARCHIVED",
};

export function isEngagementStatus(value: string): value is EngagementStatus {
  return value in TRANSITIONS;
}

/** Whether the engagement has launched. The API makes a launched one active, never a draft. */
export function hasLaunched(
  facts: Pick<LifecycleFacts, "status" | "started">,
): boolean {
  return (
    facts.started ||
    facts.status === "ACTIVE" ||
    facts.status === "PAUSED" ||
    facts.status === "COMPLETED"
  );
}

/** Completed and archived engagements are read-only: the API refuses every change. */
export function isClosed(status: string): boolean {
  return status === "COMPLETED" || status === "ARCHIVED";
}

/**
 * Whether Home lists work to do and a next action. A paused engagement adds nothing new
 * until it is resumed, and a completed or archived one is read-only, so Home shows where
 * it stands instead (docs/home-plan.md, "One Home in every state").
 */
export function homeListsWork(status: string): boolean {
  return status !== "PAUSED" && !isClosed(status);
}

export function engagementPhase(facts: LifecycleFacts): EngagementPhase {
  if (facts.status === "ARCHIVED") {
    return "closed";
  }
  if (facts.status === "COMPLETED") {
    return "completed";
  }
  if (hasLaunched(facts)) {
    return facts.status === "PAUSED" ? "paused" : "running";
  }
  return facts.ready ? "ready" : "setup";
}

/** Setup (profile, scope, templates) changes only before launch, and never once closed. */
export function setupOpen(phase: EngagementPhase): boolean {
  return phase === "setup" || phase === "ready";
}

/** Systems, controls, and the team stay open after launch, until it completes or closes. */
export function scopeOpen(phase: EngagementPhase): boolean {
  return phase !== "closed" && phase !== "completed";
}

/** The launch is offered once, when setup is complete and nothing has launched it yet. */
export function canLaunch(phase: EngagementPhase): boolean {
  return phase === "ready";
}

/** The status changes the settings offer for an engagement in this status. */
export function statusActions(status: string): StatusAction[] {
  if (!isEngagementStatus(status)) {
    return [];
  }
  return (Object.keys(ACTION_STATUS) as StatusAction[]).filter((action) => {
    const target = ACTION_STATUS[action];
    return target !== status && TRANSITIONS[status].includes(target);
  });
}

/**
 * The status a settings action moves to, or null when the current status does not allow
 * it. Saving the details ("update") keeps the status. Activating is not here: a draft
 * becomes active only by launching it from setup.
 */
export function statusAfter(
  intent: string,
  current: string,
): EngagementStatus | null {
  if (!isEngagementStatus(current) || current === "ARCHIVED") {
    return null;
  }
  if (intent === "update") {
    // A completed engagement keeps its details as they were completed.
    return current === "COMPLETED" ? null : current;
  }
  if (intent === "pause" || intent === "resume" || intent === "archive") {
    return statusActions(current).includes(intent)
      ? ACTION_STATUS[intent]
      : null;
  }
  return null;
}

/** Whether the engagement's details (name, owner, dates) can still be edited. */
export function detailsEditable(status: string): boolean {
  return isEngagementStatus(status) && !isClosed(status);
}

/** What a status means for the people running the engagement. */
export function statusMeaning(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Being set up. It becomes active when you launch it from setup.";
    case "ACTIVE":
      return "Running. The agents work on it and evidence can be added.";
    case "PAUSED":
      return "Paused. Nothing new is added until it is resumed.";
    case "COMPLETED":
      return "Completed. Its work is done and it is read-only. An owner or admin can reopen it.";
    case "ARCHIVED":
      return "Closed for good. Its records stay readable.";
    default:
      return "";
  }
}

/** Why new evidence requests cannot be made now, or null when they can. */
export function requestsClosedReason(status: string): string | null {
  switch (status) {
    case "ACTIVE":
      return null;
    case "PAUSED":
      return "The engagement is paused. Resume it under Engagements to request evidence. Existing requests stay visible.";
    case "COMPLETED":
      return "The engagement is completed and read-only. Its requests stay visible.";
    case "ARCHIVED":
      return "The engagement is archived and closed for good. Its requests stay visible.";
    default:
      return "Requests open when the engagement launches. Finish setup and launch it.";
  }
}

/**
 * What the setup page's header leads to next. On the launch step itself the launch is on
 * the page, so the header leads nowhere rather than back to the same page.
 */
export function setupHeadAction(
  phase: EngagementPhase,
  launched: boolean,
  onLaunchStep = false,
): "dashboard" | "launch" | "continue" | null {
  if (phase === "running" || phase === "paused" || phase === "completed") {
    return "dashboard";
  }
  if (phase === "closed") {
    return launched ? "dashboard" : null;
  }
  if (phase === "ready") {
    return onLaunchStep ? null : "launch";
  }
  return "continue";
}

/** The label of the link to the launch step: what is there depends on whether it ran. */
export function launchStepLabel(phase: EngagementPhase): string {
  return setupOpen(phase) ? "Review and launch" : "Launch summary";
}

/** What an archive confirmation says it does. */
export function archiveConsequence(launched: boolean): string {
  return launched
    ? "Archiving closes the engagement for good. Its controls, evidence, workpapers, and history stay readable, but nothing can be added or changed, and it cannot be reopened."
    : "Archiving closes this draft for good. It was never launched, so no work was handed to the agents. It cannot be reopened.";
}

/** Why a closed engagement cannot change, for the banner on its pages; null while open. */
export function closedNotice(status: string): string | null {
  if (status === "COMPLETED") {
    return "This engagement is completed and read-only. An owner or admin can reopen it under Engagements.";
  }
  if (status === "ARCHIVED") {
    return "This engagement is archived and read-only. Its records stay readable.";
  }
  return null;
}

/** What Home says while the engagement is paused, or null when it is not. */
export function pausedNotice(status: string): string | null {
  return status === "PAUSED"
    ? "This engagement is paused. Nothing new is added until an owner or admin resumes it under Engagements."
    : null;
}

/** What a completion confirmation says it does. */
export const COMPLETE_CONSEQUENCE =
  "Completing marks the engagement's work as done. It becomes read-only: nothing can be added or changed, and the agents' remaining open tasks are cancelled. An owner or admin can reopen it with a reason.";

/** What a delete confirmation says it does. */
export function deleteConsequence(name: string): string {
  return `Deleting removes ${name} and its setup: systems, controls, team, and uploaded files. It never launched, so no client work is lost. Only the audit record of its creation and deletion is kept. This cannot be undone.`;
}

/** Only owners and admins reopen a completed engagement or delete a draft. */
export function canCloseOut(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export type OpenItem = {
  kind: "TEST" | "REVIEW" | "DEFICIENCY" | "REQUEST" | "RUNNING";
  label: string;
  controlId: string | null;
};

export type Reopening = {
  reason: string;
  reopenedBy: string;
  reopenedAt: string;
};

/** Where the engagement stands on completion (`GET …/completion`). */
export type Completion = {
  status: string;
  version: number;
  canComplete: boolean;
  openCount: number;
  openItems: OpenItem[];
  completedAt: string | null;
  completedBy: string;
  reopenings: Reopening[];
  deletable: boolean;
};

const OPEN_KINDS = new Set([
  "TEST",
  "REVIEW",
  "DEFICIENCY",
  "REQUEST",
  "RUNNING",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseCompletion(value: unknown): Completion | null {
  const body = record(value);
  if (
    body === null ||
    typeof body.status !== "string" ||
    typeof body.version !== "number" ||
    typeof body.can_complete !== "boolean" ||
    typeof body.open_count !== "number" ||
    !Array.isArray(body.open_items) ||
    !Array.isArray(body.reopenings) ||
    typeof body.deletable !== "boolean"
  ) {
    return null;
  }
  const openItems: OpenItem[] = [];
  for (const raw of body.open_items) {
    const item = record(raw);
    if (
      item === null ||
      typeof item.kind !== "string" ||
      !OPEN_KINDS.has(item.kind) ||
      typeof item.label !== "string"
    ) {
      return null;
    }
    openItems.push({
      kind: item.kind as OpenItem["kind"],
      label: item.label,
      controlId: typeof item.control_id === "string" ? item.control_id : null,
    });
  }
  const reopenings: Reopening[] = [];
  for (const raw of body.reopenings) {
    const item = record(raw);
    if (
      item === null ||
      typeof item.reason !== "string" ||
      typeof item.reopened_by !== "string" ||
      typeof item.reopened_at !== "string"
    ) {
      return null;
    }
    reopenings.push({
      reason: item.reason,
      reopenedBy: item.reopened_by,
      reopenedAt: item.reopened_at,
    });
  }
  return {
    status: body.status,
    version: body.version,
    canComplete: body.can_complete,
    openCount: body.open_count,
    openItems,
    completedAt:
      typeof body.completed_at === "string" ? body.completed_at : null,
    completedBy: typeof body.completed_by === "string" ? body.completed_by : "",
    reopenings,
    deletable: body.deletable,
  };
}

/** Every status, in the order lists show them, with its label. */
export const ENGAGEMENT_STATUSES: ReadonlyArray<[EngagementStatus, string]> = [
  ["ACTIVE", "Active"],
  ["DRAFT", "Draft"],
  ["PAUSED", "Paused"],
  ["COMPLETED", "Completed"],
  ["ARCHIVED", "Archived"],
];

export function statusLabel(status: string): string {
  return ENGAGEMENT_STATUSES.find(([key]) => key === status)?.[1] ?? status;
}

/** Where an engagement sorts in a list: running work first, closed work last. */
export function statusOrder(status: string): number {
  const index = ENGAGEMENT_STATUSES.findIndex(([key]) => key === status);
  return index === -1 ? ENGAGEMENT_STATUSES.length : index;
}
