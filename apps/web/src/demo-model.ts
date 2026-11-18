// The synthetic demo as the web shows it (Trial Management and Synthetic Demo Experience,
// Step 3): the first-login invitation, the account menu's way back to it, the demo
// engagement told apart from the firm's own, and the words for what the server answered.
// The server decides eligibility, who may start it and what exists (demo.py); this only
// reads what it says.

import {
  refusalFrom,
  refusalWords,
  type SubscriptionSummary,
} from "./trial-model.ts";

export type DemoSummary = {
  /** NOT_INITIALIZED, INITIALIZING, READY, FAILED, ARCHIVED; NONE when unknown. */
  state: string;
  eligible: boolean;
  canInitialize: boolean;
  invitation: "PENDING" | "ACCEPTED" | "DISMISSED";
  /** The server's own answer to "show the invitation to this person now". */
  invited: boolean;
  datasetAvailable: boolean;
  datasetComplete: boolean;
  projectId: string | null;
  /** The replacements made and left during the trial (Step 6), and whether this
   * person may make one now. */
  resets: number;
  resetsLeft: number;
  canReset: boolean;
};

export const DEFAULT_DEMO: DemoSummary = {
  state: "NONE",
  eligible: false,
  canInitialize: false,
  invitation: "PENDING",
  invited: false,
  datasetAvailable: false,
  datasetComplete: false,
  projectId: null,
  resets: 0,
  resetsLeft: 0,
  canReset: false,
};

export const DEMO_CLIENT = "Northstar Technologies";

/** The invitation's words, as the product owner set them (29 October 2026). */
export const DEMO_COPY = {
  eyebrow: "Free trial",
  title: "Experience Audit Workforce in action",
  lead: "Explore a complete AI-powered audit engagement, from planning and evidence collection through testing, review, and reporting.",
  detail:
    "See how specialized AI agents collaborate with your audit team using realistic synthetic data. No setup required.",
  explore: "Explore demo",
  own: "Start my own engagement",
  note: "Your demo workspace is separate from your own engagements and uses entirely synthetic information.",
  preparingTitle: "Demo coming soon",
  preparing: `The ${DEMO_CLIENT} demo engagement is being prepared. Your own trial engagement is ready to start now.`,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDemo(value: unknown): DemoSummary {
  if (!isRecord(value)) {
    return DEFAULT_DEMO;
  }
  const invitation = value.invitation;
  return {
    state:
      typeof value.state === "string" && value.state !== ""
        ? value.state
        : "NONE",
    eligible: value.eligible === true,
    canInitialize: value.can_initialize === true,
    invitation:
      invitation === "ACCEPTED" || invitation === "DISMISSED"
        ? invitation
        : "PENDING",
    invited: value.invited === true,
    datasetAvailable: value.dataset_available === true,
    datasetComplete: value.dataset_complete === true,
    projectId: typeof value.project_id === "string" ? value.project_id : null,
    resets: count(value.resets),
    resetsLeft: count(value.resets_left),
    canReset: value.can_reset === true,
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/** Whether the firm's demo is worth asking the API about: only a firm on a running
 * trial is offered one, so no other firm pays the extra request. */
export function offersDemo(
  organizations: unknown,
  organizationId: string,
): boolean {
  if (!Array.isArray(organizations)) {
    return false;
  }
  return organizations.some(
    (item) =>
      isRecord(item) &&
      item.id === organizationId &&
      item.subscription_state === "TRIAL" &&
      item.plan_type === "TRIAL",
  );
}

/** Whether the server's answer names a demo engagement that exists now. */
export function demoReady(value: unknown): boolean {
  const demo = parseDemo(value);
  return demo.state === "READY" && demo.projectId !== null;
}

/**
 * Whether the invitation opens on this page: asked again from the account menu, when the
 * person may still start it; otherwise only while the server says so (eligible, allowed,
 * unanswered, no demo yet), never over another dialog and never inside the demo itself.
 */
export function showsInvitation(
  demo: DemoSummary,
  context: { reopened: boolean; dialogOpen: boolean; inDemo: boolean },
): boolean {
  if (context.reopened) {
    return demo.eligible && demo.canInitialize;
  }
  return demo.invited && !context.dialogOpen && !context.inDemo;
}

export type DemoMenuEntry = { kind: "open" | "invite"; label: string };

/** The account menu's entry while the trial runs: the demo to open, or the invitation
 * to take up; nothing for a firm that is not offered one. */
export function demoMenuEntry(
  demo: DemoSummary,
  subscription: SubscriptionSummary,
): DemoMenuEntry | null {
  if (
    subscription.planType !== "TRIAL" ||
    subscription.state !== "TRIAL" ||
    !demo.eligible
  ) {
    return null;
  }
  if (demo.state === "READY" && demo.projectId !== null) {
    return { kind: "open", label: "Open the demo" };
  }
  return demo.canInitialize
    ? { kind: "invite", label: "Explore the demo" }
    : null;
}

/** The demo engagement's own page. */
export function demoHref(organizationId: string, projectId: string): string {
  return `/?${new URLSearchParams({ section: "overview", organization: organizationId, project: projectId })}`;
}

export type DemoOutcome =
  | { kind: "ready"; href: string }
  | { kind: "preparing"; words: string }
  | { kind: "refused"; words: string }
  | { kind: "failed"; words: string };

/** What the server's answer to "explore the demo" means for the dialog. */
export function demoOutcome(
  status: number,
  body: unknown,
  organizationId: string,
): DemoOutcome {
  if (status === 200 && isRecord(body)) {
    const demo = parseDemo(body);
    if (demo.state === "READY" && demo.projectId !== null) {
      return { kind: "ready", href: demoHref(organizationId, demo.projectId) };
    }
    if (!demo.datasetAvailable) {
      return { kind: "preparing", words: DEMO_COPY.preparing };
    }
    return {
      kind: "failed",
      words: "The demo could not be prepared. Try again in a moment.",
    };
  }
  const refusal = refusalFrom(status, body);
  if (refusal !== null) {
    return { kind: "refused", words: refusalWords(refusal) };
  }
  if (status === 403) {
    return {
      kind: "refused",
      words:
        isRecord(body) && body.code === "DEMO_NOT_AVAILABLE"
          ? "The demo is offered to firms on the free trial."
          : "Only a member who can create engagements can start the demo.",
    };
  }
  if (status === 503) {
    return {
      kind: "failed",
      words: "The demo could not be prepared. Try again in a moment.",
    };
  }
  return {
    kind: "failed",
    words: "The demo could not be started. Check the connection and try again.",
  };
}

export type ResetOutcome =
  | { kind: "ready"; projectId: string }
  | { kind: "refused"; words: string }
  | { kind: "failed"; words: string };

/** What the server's answer to "reset the demo" means for the card (Step 6). */
export function resetOutcome(status: number, body: unknown): ResetOutcome {
  if (status === 200 && isRecord(body)) {
    const demo = parseDemo(body);
    if (demo.state === "READY" && demo.projectId !== null) {
      return { kind: "ready", projectId: demo.projectId };
    }
    return {
      kind: "failed",
      words: "The new demo could not be prepared. Try again in a moment.",
    };
  }
  if (status === 409 && isRecord(body)) {
    const reason = body.reason;
    return {
      kind: "refused",
      words:
        reason === "resets-exhausted"
          ? "The trial's three demo resets are used. The demo stays open to explore."
          : reason === "already-reset"
            ? "The demo was reset a moment ago. Reload the page to open the new one."
            : "There is no demo engagement to reset right now.",
    };
  }
  const refusal = refusalFrom(status, body);
  if (refusal !== null) {
    return { kind: "refused", words: refusalWords(refusal) };
  }
  if (status === 403) {
    return {
      kind: "refused",
      words:
        isRecord(body) && body.code === "DEMO_NOT_AVAILABLE"
          ? "The demo and its reset are for firms on the free trial."
          : "Only a member who can create engagements can reset the demo.",
    };
  }
  if (status === 503) {
    return {
      kind: "failed",
      words:
        "The new demo could not be prepared; the current one is unchanged. Try again in a moment.",
    };
  }
  return {
    kind: "failed",
    words: "The demo could not be reset. Check the connection and try again.",
  };
}

/** The line above every page of the demo engagement, so it is never taken for a real
 * one; while the dataset is a placeholder, it says so. */
export function demoStrip(
  project: { demo: boolean } | null,
  demo: DemoSummary,
): string | null {
  if (project === null || !project.demo) {
    return null;
  }
  // The demo's record is read only for a firm on a running trial; without it (the trial
  // ended), the engagement is still the synthetic demo it was.
  return demo.datasetComplete || demo.state === "NONE"
    ? `Synthetic demo engagement for ${DEMO_CLIENT}. Nothing here is real organization data. Simulated FY2027 audit scenario: system activity timestamps reflect when this demo was generated.`
    : `Demo preparation: a placeholder engagement for the ${DEMO_CLIENT} demo. The complete dataset is not available yet; nothing here is real organization data.`;
}
