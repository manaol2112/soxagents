// The free trial as the web shows it (Trial Management, Step 2; the product owner's
// decisions of 28 October 2026): the badge beside the notifications, the strip above the
// page once the trial has ended, and the words for a change the subscription refused.
// The server decides all of it (subscriptions.py); this only reads what it says.

export type SubscriptionSummary = {
  /** TRIAL, TRIAL_EXPIRED, ACTIVE, PAST_DUE, CANCELED, SUSPENDED; NONE when unknown. */
  state: string;
  planType: string;
  trialExpiresAt: string | null;
};

export const DEFAULT_SUBSCRIPTION: SubscriptionSummary = {
  state: "NONE",
  planType: "TRIAL",
  trialExpiresAt: null,
};

/** Where to go for more than the trial: the pricing section of the landing page. */
export const PLANS_HREF = "/welcome#pricing";

const DAY = 24 * 60 * 60 * 1000;

export function parseSubscription(
  item: Record<string, unknown>,
): SubscriptionSummary {
  const state = item.subscription_state;
  const planType = item.plan_type;
  const expires = item.trial_expires_at;
  return {
    state: typeof state === "string" && state !== "" ? state : "NONE",
    planType:
      typeof planType === "string" && planType !== "" ? planType : "TRIAL",
    trialExpiresAt:
      typeof expires === "string" && !Number.isNaN(Date.parse(expires))
        ? expires
        : null,
  };
}

/** Whole days until the trial ends, counting a started day; 0 once it has ended. */
export function daysLeft(
  subscription: SubscriptionSummary,
  now: Date,
): number | null {
  if (
    subscription.planType !== "TRIAL" ||
    subscription.trialExpiresAt === null
  ) {
    return null;
  }
  const left = (Date.parse(subscription.trialExpiresAt) - now.getTime()) / DAY;
  return Math.max(0, Math.ceil(left));
}

export type TrialBadge = {
  kind: string;
  detail: string;
  tone: "info" | "warning";
  title: string;
};

/** The badge for a firm on the trial; nothing for every other firm. */
export function trialBadge(
  subscription: SubscriptionSummary,
  now: Date,
): TrialBadge | null {
  if (subscription.planType !== "TRIAL") {
    return null;
  }
  if (subscription.state === "TRIAL_EXPIRED") {
    return {
      kind: "Free trial",
      detail: "ended",
      tone: "warning",
      title: "The free trial has ended. Explore plans to keep working.",
    };
  }
  if (subscription.state !== "TRIAL") {
    return null;
  }
  const days = daysLeft(subscription, now);
  if (days === null) {
    return {
      kind: "Free trial",
      detail: "",
      tone: "info",
      title: "This workspace is on the free trial. Explore plans.",
    };
  }
  const detail =
    days <= 0 ? "ends today" : `${days} ${days === 1 ? "day" : "days"} left`;
  return {
    kind: "Free trial",
    detail,
    tone: days <= 2 ? "warning" : "info",
    title: `The free trial ${detail === "ends today" ? "ends today" : `has ${detail}`}. Explore plans.`,
  };
}

const INACTIVE_WORDS: Record<string, string> = {
  TRIAL_EXPIRED:
    "Your free trial has ended. Your existing work remains available to review. Upgrade to continue creating engagements and running AI-powered audit workflows.",
  SUSPENDED:
    "This workspace is suspended. Everything here stays to read; contact support to restore it.",
  CANCELED:
    "This subscription was cancelled. Everything here stays to read; explore plans to start again.",
};

/** The line above every page while the subscription allows no change. */
export function trialStrip(subscription: SubscriptionSummary): string | null {
  return INACTIVE_WORDS[subscription.state] ?? null;
}

export type Refusal =
  | { kind: "limit"; resource: string; allowed: number }
  | { kind: "inactive"; state: string };

/** What a 402 from the API means; null for any other answer. */
export function refusalFrom(status: number, body: unknown): Refusal | null {
  if (status !== 402 || typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.code === "TRIAL_LIMIT") {
    const resource = record.resource;
    const allowed = record.allowed;
    return {
      kind: "limit",
      resource: typeof resource === "string" ? resource : "subscription",
      allowed: typeof allowed === "number" ? allowed : 0,
    };
  }
  if (record.code === "SUBSCRIPTION_INACTIVE") {
    const state = record.state;
    return {
      kind: "inactive",
      state: typeof state === "string" ? state : "TRIAL_EXPIRED",
    };
  }
  return null;
}

const RESOURCE_NOUNS: Record<string, [string, string]> = {
  engagements: ["engagement", "engagements"],
  systems: ["system", "systems"],
  controls: ["control", "controls"],
  members: ["team member", "team members"],
  uploads: ["evidence file", "evidence files"],
};

/** The words for a refused change, for a notice beside the control that asked. */
export function refusalWords(refusal: Refusal): string {
  if (refusal.kind === "inactive") {
    return (
      INACTIVE_WORDS[refusal.state] ??
      "The subscription allows no change. Explore plans to keep working."
    );
  }
  if (refusal.resource === "storage") {
    const megabytes = Math.max(1, Math.round(refusal.allowed / 1_000_000));
    return `The free trial includes ${megabytes} MB of stored documents. To store more, explore plans.`;
  }
  if (refusal.resource === "ai") {
    return "AI trial allowance reached. You've used the available AI executions for your trial; prepared demo results and previously generated workpapers stay open. To continue running AI agents, explore the available plans.";
  }
  const nouns = RESOURCE_NOUNS[refusal.resource];
  if (nouns === undefined || refusal.allowed <= 0) {
    return "This is more than the free trial includes. Explore plans to add more.";
  }
  const [one, many] = nouns;
  const count =
    refusal.allowed === 1 ? `one ${one}` : `${refusal.allowed} ${many}`;
  return `The free trial includes ${count}. To add more, explore plans.`;
}
