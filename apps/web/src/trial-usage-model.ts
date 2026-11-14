// The free trial's usage as the web shows it (Trial Management, Step 6): the trial's
// standing, and each allowance beside what the firm has used of it, every figure from
// the subscription route (subscriptions.py). Nothing is worked out here but the words
// and the share of a meter; the server decides the limits and counts the usage.

import { PLANS_HREF, type SubscriptionSummary } from "./trial-model.ts";

export type TrialUsage = {
  state: string;
  planType: string;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
  daysLeft: number | null;
  writable: boolean;
  limits: {
    engagements: number | null;
    systems: number | null;
    controls: number | null;
    members: number | null;
    uploads: number | null;
    uploadBytes: number | null;
    aiBudgetMicros: number | null;
    aiRunLimit: number | null;
    aiConcurrentRuns: number | null;
  };
  usage: {
    engagements: number;
    systems: number;
    controls: number;
    members: number;
    uploads: number;
    uploadBytes: number;
    aiSpentMicros: number;
    aiReservedMicros: number;
    aiRuns: number;
    aiActiveRuns: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const limit = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
const when = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;

export function parseTrialUsage(value: unknown): TrialUsage | null {
  if (!isRecord(value) || !isRecord(value.limits) || !isRecord(value.usage)) {
    return null;
  }
  const limits = value.limits;
  const usage = value.usage;
  return {
    state: typeof value.state === "string" ? value.state : "NONE",
    planType: typeof value.plan_type === "string" ? value.plan_type : "TRIAL",
    trialStartedAt: when(value.trial_started_at),
    trialExpiresAt: when(value.trial_expires_at),
    daysLeft: limit(value.days_left),
    writable: value.writable === true,
    limits: {
      engagements: limit(limits.engagements),
      systems: limit(limits.systems),
      controls: limit(limits.controls),
      members: limit(limits.members),
      uploads: limit(limits.uploads),
      uploadBytes: limit(limits.upload_bytes),
      aiBudgetMicros: limit(limits.ai_budget_micros),
      aiRunLimit: limit(limits.ai_run_limit),
      aiConcurrentRuns: limit(limits.ai_concurrent_runs),
    },
    usage: {
      engagements: whole(usage.engagements),
      systems: whole(usage.systems),
      controls: whole(usage.controls),
      members: whole(usage.members),
      uploads: whole(usage.uploads),
      uploadBytes: whole(usage.upload_bytes),
      aiSpentMicros: whole(usage.ai_spent_micros),
      aiReservedMicros: whole(usage.ai_reserved_micros),
      aiRuns: whole(usage.ai_runs),
      aiActiveRuns: whole(usage.ai_active_runs),
    },
  };
}

/** Dollars from micro-dollars, to the cent: "$1.20". */
export function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/** Megabytes to one decimal below 10 MB, whole above: "4.2 MB", "250 MB". */
export function megabytes(bytes: number): string {
  const value = bytes / 1_000_000;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
}

export type UsageMeter = {
  key: string;
  label: string;
  /** "$1.20 of $5.00 used", "6 of 20 used", "1 of 1", or "4 in use" without a limit. */
  words: string;
  /** The share of the allowance used, 0 to 1; null without a limit. */
  share: number | null;
  tone: "info" | "warning" | "danger";
  /** What the figure counts, for the small line beneath. */
  note: string;
};

function tone(share: number | null): UsageMeter["tone"] {
  if (share === null || share < 0.8) {
    return "info";
  }
  return share >= 1 ? "danger" : "warning";
}

function meter(
  key: string,
  label: string,
  used: number,
  allowed: number | null,
  note: string,
  show: (value: number) => string = (value) => String(value),
  verb = "used",
): UsageMeter {
  const share =
    allowed === null || allowed === 0 ? null : Math.min(1, used / allowed);
  // A resource fully in use (the one engagement, the one seat) is the trial as designed,
  // so it reads as a warning; an allowance used up (spend, runs, uploads) is the limit.
  const shade = tone(share);
  return {
    key,
    label,
    words:
      allowed === null
        ? `${show(used)} ${verb === "used" ? "used" : "in use"}`
        : `${show(used)} of ${show(allowed)}${verb === "used" ? " used" : ""}`,
    share,
    tone: verb !== "used" && shade === "danger" ? "warning" : shade,
    note,
  };
}

/** The AI allowance meters first, then the engagement's resources. Every figure is the
 * server's; reserved spend counts against the allowance while a run is in flight. */
export function usageMeters(usage: TrialUsage): UsageMeter[] {
  const spent = usage.usage.aiSpentMicros + usage.usage.aiReservedMicros;
  return [
    meter(
      "ai",
      "AI usage",
      spent,
      usage.limits.aiBudgetMicros,
      usage.usage.aiReservedMicros > 0
        ? `${dollars(usage.usage.aiSpentMicros)} settled, ${dollars(usage.usage.aiReservedMicros)} reserved for runs in flight. Estimated from the model's own prices.`
        : "Settled model calls, estimated from the model's own prices.",
      dollars,
    ),
    meter(
      "runs",
      "Agent executions",
      usage.usage.aiRuns,
      usage.limits.aiRunLimit,
      usage.usage.aiActiveRuns > 0
        ? `${usage.usage.aiActiveRuns} running now; the trial runs ${usage.limits.aiConcurrentRuns ?? 1} at a time.`
        : `The trial runs ${usage.limits.aiConcurrentRuns ?? 1} at a time.`,
    ),
    meter(
      "engagements",
      "Engagements",
      usage.usage.engagements,
      usage.limits.engagements,
      "Your own engagements; the demo is not counted.",
      String,
      "in use",
    ),
    meter(
      "systems",
      "Systems",
      usage.usage.systems,
      usage.limits.systems,
      "Applications in scope across your engagements.",
      String,
      "in use",
    ),
    meter(
      "controls",
      "Controls",
      usage.usage.controls,
      usage.limits.controls,
      "Distinct controls in your largest engagement.",
      String,
      "in use",
    ),
    meter(
      "uploads",
      "Evidence uploads",
      usage.usage.uploads,
      usage.limits.uploads,
      "Evidence files stored, every version counted once.",
    ),
    meter(
      "storage",
      "Storage",
      usage.usage.uploadBytes,
      usage.limits.uploadBytes,
      "Evidence, request attachments, governing documents and workpaper templates.",
      megabytes,
    ),
    meter(
      "members",
      "Workspace members",
      usage.usage.members,
      usage.limits.members,
      "Members of your firm; the demo's people are not counted.",
      String,
      "in use",
    ),
  ];
}

/** Whether the AI allowance is spent: the budget or the runs. */
export function aiAllowanceReached(usage: TrialUsage): boolean {
  const spent = usage.usage.aiSpentMicros + usage.usage.aiReservedMicros;
  return (
    (usage.limits.aiBudgetMicros !== null &&
      spent >= usage.limits.aiBudgetMicros) ||
    (usage.limits.aiRunLimit !== null &&
      usage.usage.aiRuns >= usage.limits.aiRunLimit)
  );
}

export const AI_REACHED_COPY = {
  title: "AI trial allowance reached",
  body: "You've used the available AI executions for your trial. You can continue exploring prepared demo results and previously generated workpapers. To continue running AI agents, explore the available plans.",
  action: "Explore plans",
  href: PLANS_HREF,
} as const;

export const TRIAL_ENDED_COPY = {
  title: "Your free trial has ended",
  body: "Your existing work remains available to review. Upgrade to continue creating engagements and running AI-powered audit workflows.",
  action: "Explore plans",
  href: PLANS_HREF,
} as const;

/** The trial's standing line: "Free trial · 5 days left · ends 12 Nov 2026". */
export function standing(usage: TrialUsage): {
  title: string;
  detail: string;
  tone: "info" | "warning" | "danger";
} {
  if (usage.planType !== "TRIAL") {
    return {
      title: `${usage.planType === "PAID" ? "Paid plan" : "Plan"}: ${usage.state.toLowerCase().replace(/_/g, " ")}`,
      detail: "",
      tone: "info",
    };
  }
  const ends =
    usage.trialExpiresAt === null
      ? ""
      : new Date(usage.trialExpiresAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
  if (usage.state === "TRIAL_EXPIRED") {
    return {
      title: "Free trial ended",
      detail: ends === "" ? "" : `Ended ${ends}`,
      tone: "danger",
    };
  }
  const days = usage.daysLeft;
  const left =
    days === null
      ? ""
      : days <= 0
        ? "ends today"
        : `${days} ${days === 1 ? "day" : "days"} left`;
  return {
    title: "Free trial",
    detail: [left, ends === "" ? "" : `ends ${ends}`]
      .filter(Boolean)
      .join(" · "),
    tone: days !== null && days <= 2 ? "warning" : "info",
  };
}

/** Where the trial's usage is read: Settings › Free trial. */
export function usageHref(
  organizationId: string,
  projectId: string | null,
): string {
  const params = new URLSearchParams({
    section: "settings",
    view: "trial",
    organization: organizationId,
  });
  if (projectId !== null) {
    params.set("project", projectId);
  }
  return `/?${params}`;
}

/** Whether the firm is on the trial plan at all (the tab, the badge, the menu entry). */
export function onTrialPlan(subscription: SubscriptionSummary): boolean {
  return subscription.planType === "TRIAL";
}
