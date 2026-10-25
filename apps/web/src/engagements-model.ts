/**
 * What the Engagements page shows, kept out of its components: the order of the firm's
 * engagements, the clients table, an engagement's agent work in plain words, and its
 * recent activity with repeats folded together.
 */

import type { Client } from "./client-model.ts";
import { statusOrder } from "./engagement-lifecycle.ts";
import { formatDate } from "./format.ts";

export type EngagementsView = "engagements" | "clients";

export function parseEngagementsView(
  value: string | null | undefined,
): EngagementsView {
  return value === "clients" ? "clients" : "engagements";
}

type Listed = {
  status: string;
  name: string;
  clientName: string;
  periodEnd: string | null;
};

/** Open work first; within a status by client, then the latest period first. */
export function sortEngagements<T extends Listed>(projects: readonly T[]): T[] {
  return [...projects].sort(
    (a, b) =>
      statusOrder(a.status) - statusOrder(b.status) ||
      clientSortKey(a.clientName).localeCompare(clientSortKey(b.clientName)) ||
      (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "") ||
      a.name.localeCompare(b.name),
  );
}

// An engagement without a client sorts after every client.
function clientSortKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed === "" ? "￿" : trimmed;
}

/** Whether a status filter shows an engagement: "All" leaves archived ones to their own. */
export function inFilter(status: string, filter: string): boolean {
  return filter === "ALL" ? status !== "ARCHIVED" : status === filter;
}

/** The engagements still open: everything but the archived. */
export function openEngagements<T extends { status: string }>(
  projects: readonly T[],
): T[] {
  return projects.filter((project) => inFilter(project.status, "ALL"));
}

/** The page's one-line summary: the open engagements, their clients, and how many are archived. */
export function portfolioLine(projects: readonly Listed[]): string {
  if (projects.length === 0) {
    return "No audits in this firm yet.";
  }
  const open = openEngagements(projects);
  const archived = projects.length - open.length;
  const clients = new Set(
    open
      .map((project) => project.clientName.trim().toLowerCase())
      .filter((name) => name !== ""),
  ).size;
  const engagements =
    open.length === 0
      ? "No open engagements"
      : `${open.length} engagement${open.length === 1 ? "" : "s"}`;
  const line =
    clients === 0
      ? engagements
      : `${engagements} across ${clients} client${clients === 1 ? "" : "s"}`;
  return archived === 0 ? line : `${line} · ${archived} archived`;
}

export type ClientRow = {
  id: string;
  name: string;
  version: number;
  count: number;
  latest: {
    id: string;
    name: string;
    status: string;
    periodEnd: string | null;
  } | null;
};

/** The clients table: by name, each with its latest engagement the person can open. */
export function clientRows(
  clients: readonly Client[],
  query = "",
): ClientRow[] {
  const needle = query.trim().toLowerCase();
  return clients
    .filter(
      (client) =>
        needle === "" ||
        client.name.toLowerCase().includes(needle) ||
        client.engagements.some((e) => e.name.toLowerCase().includes(needle)),
    )
    .map((client) => {
      const latest = client.engagements[0];
      return {
        id: client.id,
        name: client.name,
        version: client.version,
        count: client.engagements.length,
        latest:
          latest === undefined
            ? null
            : {
                id: latest.id,
                name: latest.name,
                status: latest.status,
                periodEnd: latest.periodEnd,
              },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const DONE = new Set(["SUCCEEDED"]);
const MOVING = new Set(["QUEUED", "RUNNING", "WAITING", "REVIEW"]);
const STUCK = new Set(["BLOCKED", "FAILED"]);
const NOT_COUNTED = new Set(["CANCELLED"]);

export type WorkSummary = {
  total: number;
  done: number;
  moving: number;
  stuck: number;
  toDo: number;
  /** Done as a share of the work, 0 to 100. */
  percent: number;
};

/** An engagement's agent tasks as done, under way, needing attention, and still to do. */
export function workSummary(
  progress: ReadonlyArray<{ status: string; count: number }>,
): WorkSummary {
  let done = 0;
  let moving = 0;
  let stuck = 0;
  let toDo = 0;
  for (const item of progress) {
    if (NOT_COUNTED.has(item.status)) {
      continue;
    }
    if (DONE.has(item.status)) {
      done += item.count;
    } else if (MOVING.has(item.status)) {
      moving += item.count;
    } else if (STUCK.has(item.status)) {
      stuck += item.count;
    } else {
      toDo += item.count;
    }
  }
  const total = done + moving + stuck + toDo;
  return {
    total,
    done,
    moving,
    stuck,
    toDo,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export type Activity = {
  action: string;
  occurredAt: string;
  actorName: string;
};
export type FoldedActivity = Activity & { times: number };

/** The system's own bookkeeping, not something a person on the engagement did. */
function internal(action: string): boolean {
  return action === "model.called" || action.endsWith("agent_instance.staffed");
}

/**
 * The latest activity, newest first, with repeats folded: the same action by the same
 * person on the same day shows once, at its latest time, with how many times it happened.
 */
export function foldActivity(
  activity: readonly Activity[],
  limit = 5,
): FoldedActivity[] {
  const visible = activity.filter((item) => !internal(item.action));
  const shown = visible.length > 0 ? visible : activity;
  const folded: FoldedActivity[] = [];
  const byKey = new Map<string, FoldedActivity>();
  for (const item of shown) {
    const key = `${item.action}\u0000${item.actorName}\u0000${item.occurredAt.slice(0, 10)}`;
    const seen = byKey.get(key);
    if (seen !== undefined) {
      seen.times += 1;
    } else if (folded.length < limit) {
      const entry = { ...item, times: 1 };
      folded.push(entry);
      byKey.set(key, entry);
    }
  }
  return folded;
}

type Signalled = {
  overdueRequests: number;
  missedMilestones: number;
  nextMilestone: { name: string; due: string } | null;
};

export type CardSignal = { tone: "warn" | "plain"; text: string };

/**
 * What a card flags under its numbers: evidence past due and missed milestones first,
 * since those need someone; otherwise the next milestone, so the card says what is coming.
 */
export function cardSignals(project: Signalled): CardSignal[] {
  const signals: CardSignal[] = [];
  const { overdueRequests: late, missedMilestones: missed } = project;
  if (late > 0) {
    signals.push({
      tone: "warn",
      text: `${late} evidence request${late === 1 ? "" : "s"} overdue`,
    });
  }
  if (missed > 0) {
    signals.push({
      tone: "warn",
      text: `${missed} milestone${missed === 1 ? "" : "s"} missed`,
    });
  }
  if (signals.length === 0 && project.nextMilestone !== null) {
    signals.push({
      tone: "plain",
      text: `Next: ${project.nextMilestone.name}, ${formatDate(project.nextMilestone.due)}`,
    });
  }
  return signals;
}

/** When anything last happened on an engagement, as people say it. */
export function updatedLabel(at: string | null, now: string): string {
  if (at === null) {
    return "No activity yet";
  }
  const minutes = Math.floor((Date.parse(now) - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes)) {
    return "";
  }
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
  }
  return `Updated ${formatDate(at)}`;
}

/** Where a card leads: a draft back into setup, anything launched to its overview. */
export function cardEntry(status: string): {
  section: "setup" | "overview";
  label: string;
} {
  return status === "DRAFT"
    ? { section: "setup", label: "Continue setup" }
    : { section: "overview", label: "Open the engagement" };
}

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

/**
 * The audit period, as the year that ends on the period end (the rule the plans use):
 * "Jan – Dec 2027", or "Jul 2026 – Jun 2027" when it spans two years.
 */
export function auditPeriod(periodEnd: string | null): string {
  const end =
    periodEnd !== null && /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      ? new Date(`${periodEnd}T00:00:00Z`)
      : null;
  if (end === null || Number.isNaN(end.getTime())) {
    return "Not set";
  }
  const start = new Date(end);
  start.setUTCFullYear(end.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  const from = MONTH.format(start);
  const to = MONTH.format(end);
  return start.getUTCFullYear() === end.getUTCFullYear()
    ? `${from} – ${to} ${end.getUTCFullYear()}`
    : `${from} ${start.getUTCFullYear()} – ${to} ${end.getUTCFullYear()}`;
}

type Risked = {
  status: string;
  overdueRequests: number;
  missedMilestones: number;
};

/** At risk: running work with evidence past due or a milestone missed. */
export function atRisk(project: Risked): boolean {
  return (
    project.status === "ACTIVE" &&
    (project.overdueRequests > 0 || project.missedMilestones > 0)
  );
}

/** Why an engagement is at risk, in words, for its badge; "" when it is not. */
export function riskReason(project: Risked & Signalled): string {
  if (!atRisk(project)) {
    return "";
  }
  return cardSignals(project)
    .filter((signal) => signal.tone === "warn")
    .map((signal) => signal.text)
    .join(" · ");
}

/** A status, or the engagements at risk, as the page filters them. */
export type EngagementFilter =
  | "ALL"
  | "AT_RISK"
  | "ACTIVE"
  | "DRAFT"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED";

export function matchesFilter(
  project: Risked,
  filter: EngagementFilter,
): boolean {
  return filter === "AT_RISK"
    ? atRisk(project)
    : inFilter(project.status, filter);
}

export type PortfolioCounts = {
  /** Every engagement not archived. */
  open: number;
  active: number;
  completed: number;
  atRisk: number;
  draft: number;
  paused: number;
  archived: number;
};

/** The headline counts above the list. */
export function portfolioCounts(projects: readonly Risked[]): PortfolioCounts {
  const count = (status: string) =>
    projects.filter((project) => project.status === status).length;
  return {
    open: openEngagements(projects).length,
    active: count("ACTIVE"),
    completed: count("COMPLETED"),
    atRisk: projects.filter(atRisk).length,
    draft: count("DRAFT"),
    paused: count("PAUSED"),
    archived: count("ARCHIVED"),
  };
}

export const ENGAGEMENT_SORTS = [
  ["status", "Status"],
  ["activity", "Latest activity"],
  ["milestone", "Next milestone"],
  ["progress", "Progress"],
  ["period", "Period end"],
  ["name", "Name"],
] as const;
export type EngagementSort = (typeof ENGAGEMENT_SORTS)[number][0];

export function parseEngagementSort(
  value: string | null | undefined,
): EngagementSort {
  return ENGAGEMENT_SORTS.some(([key]) => key === value)
    ? (value as EngagementSort)
    : "status";
}

type Sortable = Listed & {
  lastActivityAt: string | null;
  nextMilestone: { name: string; due: string } | null;
  progress: ReadonlyArray<{ status: string; count: number }>;
};

/**
 * The list in the chosen order. Status keeps the page's usual order (open work first, by
 * client); the others put the most pressing or most recent first, and what has no value
 * last.
 */
export function sortBy<T extends Sortable>(
  projects: readonly T[],
  sort: EngagementSort,
): T[] {
  const usual = sortEngagements(projects);
  if (sort === "status") {
    return usual;
  }
  const rank = new Map(usual.map((project, index) => [project, index]));
  const tie = (a: T, b: T) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  const last = "￿";
  const key: Record<
    Exclude<EngagementSort, "status">,
    (a: T, b: T) => number
  > = {
    activity: (a, b) =>
      (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    milestone: (a, b) =>
      (a.nextMilestone?.due ?? last).localeCompare(
        b.nextMilestone?.due ?? last,
      ),
    progress: (a, b) =>
      workSummary(b.progress).percent - workSummary(a.progress).percent,
    period: (a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""),
    name: (a, b) =>
      `${a.name} ${a.clientName}`.localeCompare(`${b.name} ${b.clientName}`),
  };
  return [...projects].sort((a, b) => key[sort](a, b) || tie(a, b));
}

/** Whether a milestone's date has passed, against the day the page was made. */
export function isPastDue(due: string, now: string): boolean {
  return due < now.slice(0, 10);
}

const TYPE_SHORT: Record<string, string> = {
  SOX_FULL: "SOX: ITGC and BP",
  SOX_ITGC: "SOX: ITGC",
  IT_AUDIT: "IT audit",
};

/** The engagement type in a few words, for a list row; the code itself when unknown. */
export function engagementTypeShort(code: string): string {
  return TYPE_SHORT[code] ?? code;
}

/** Two letters for a client or engagement tile: the initials of a longer name, or the
 * first two letters of a one-word name. */
export function nameMark(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word));
  const letters =
    words.length >= 2
      ? `${words[0]?.match(/[A-Za-z]/)?.[0] ?? ""}${words[1]?.match(/[A-Za-z]/)?.[0] ?? ""}`
      : (words[0] ?? "").replace(/[^A-Za-z]/g, "").slice(0, 2);
  return letters === "" ? "?" : letters.toUpperCase();
}
