/**
 * Home's work, as the redesign plan sets it out (docs/home-plan.md): the queue's items
 * arranged around what the viewer can do. The API decides every item's bucket, owner,
 * readiness and whether the viewer may act; nothing here changes them. Home only orders
 * and groups:
 *
 * - Needs you: the viewer's own items, then the held items the viewer may act on (a
 *   hold the viewer clears, such as a missing recipient), in the queue's order;
 * - Blocked: held items no one on the team can act on yet;
 * - Waiting on others and Upcoming, as the queue has them.
 *
 * The console inbox and the register read the same items in their own grouping, so the
 * one queue stays one queue (Milestone 2).
 */
import type { StageKey } from "./home-model.ts";
import {
  collapseRows,
  type Queue,
  type QueueHold,
  type QueueItem,
  queueHref,
} from "./queue-model.ts";
import { destinationHref } from "./routes.ts";
import { testingHref } from "./testing-hub-model.ts";

export type HomeWork = {
  needsYou: QueueItem[];
  blocked: QueueItem[];
  waiting: QueueItem[];
  upcoming: QueueItem[];
};

/** A held item the viewer may act on and can clear in the app: at least one of its holds
 * is not a system condition only an administrator clears (no worker, the outbound
 * recipient allowlist). Without holds from the API, the viewer's say decides. */
export function clearable(item: QueueItem): boolean {
  if (item.bucket !== "BLOCKED" || !item.authorized) {
    return false;
  }
  return item.holds.length === 0 || item.holds.some((hold) => !hold.system);
}

export function homeWork(queue: Queue): HomeWork {
  const mine = queue.items.filter((item) => item.bucket === "MINE");
  return {
    needsYou: [...mine, ...queue.items.filter(clearable)],
    // Everything held that the viewer cannot clear, including work they could act on
    // but for a system condition: it stays visible here, explained once at the top.
    blocked: queue.items.filter(
      (item) => item.bucket === "BLOCKED" && !clearable(item),
    ),
    waiting: queue.items.filter((item) => item.bucket === "WAITING"),
    upcoming: queue.items.filter((item) => item.bucket === "UPCOMING"),
  };
}

const WITH_WORDS: Record<string, string> = {
  PREPARER: "the preparer",
  REVIEWER: "the independent reviewer",
  APPROVER: "an approver",
  CLIENT: "the client",
  OWNER: "the engagement owner",
  AGENT: "an agent",
  NONE: "no one",
};

/** "2 with the preparer · 1 with the client", largest first. */
export function whoseSummary(items: readonly QueueItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.owner.role, (counts.get(item.owner.role) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(
      ([role, count]) =>
        `${count} with ${WITH_WORDS[role] ?? role.toLowerCase()}`,
    )
    .join(" · ");
}

/** Whole days from `today` to `date` (both ISO dates); negative when past. */
export function daysUntil(date: string, today: string): number {
  const to = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(to) || !Number.isFinite(from)) {
    return 0;
  }
  return Math.round((to - from) / 86_400_000);
}

/** "today", "tomorrow", "in 10 days", "3 days overdue". */
export function dueWords(date: string, today: string): string {
  const days = daysUntil(date, today);
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days > 1) {
    return `in ${days} days`;
  }
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}

/** Where each stage of the journey is worked on. */
export function stageHref(
  stage: StageKey,
  organizationId: string,
  projectId: string,
): string {
  switch (stage) {
    case "SETUP":
      return destinationHref(
        "settings",
        "engagement",
        organizationId,
        projectId,
      );
    case "PLANS":
      return testingHref(organizationId, projectId, "plans");
    case "EVIDENCE":
      return `/?${new URLSearchParams({
        organization: organizationId,
        project: projectId,
        section: "evidence",
      }).toString()}`;
    case "TESTING":
      return testingHref(organizationId, projectId, "results");
    case "REVIEW":
      return testingHref(organizationId, projectId, "review");
    case "CLOSE":
      return destinationHref("reports", "status", organizationId, projectId);
  }
}

/** The holds of an item: the API's, or its blockers as holds without a code or a fix
 * (an API without holds). */
export function holdsOf(item: QueueItem): QueueHold[] {
  return item.holds.length > 0
    ? item.holds
    : item.blockers.map((text) => ({
        code: "STEP",
        text,
        fix: null,
        system: false,
      }));
}

/** What holds a set of items, each distinct hold once with how many items it holds and
 * where it is cleared, the largest first: many held rows usually share a few causes. */
export function holdCounts(items: readonly QueueItem[]): Array<{
  hold: string;
  count: number;
  fix: QueueHold["fix"];
  system: boolean;
}> {
  const found = new Map<
    string,
    { count: number; fix: QueueHold["fix"]; system: boolean }
  >();
  for (const item of items) {
    for (const hold of holdsOf(item)) {
      const seen = found.get(hold.text);
      found.set(hold.text, {
        count: (seen?.count ?? 0) + 1,
        fix: seen?.fix ?? hold.fix,
        system: hold.system,
      });
    }
  }
  return [...found.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([hold, entry]) => ({ hold, ...entry }));
}

/** The system conditions holding work, once each by code: what Home says in a notice at
 * the top rather than on every row. */
export function systemConditions(
  queue: Queue | null,
): Array<{ code: string; items: number; texts: string[] }> {
  const found = new Map<string, { items: Set<string>; texts: Set<string> }>();
  for (const item of queue?.items ?? []) {
    for (const hold of item.holds) {
      if (!hold.system) {
        continue;
      }
      const entry = found.get(hold.code) ?? {
        items: new Set(),
        texts: new Set(),
      };
      entry.items.add(item.id);
      entry.texts.add(hold.text);
      found.set(hold.code, entry);
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, entry]) => ({
      code,
      items: entry.items.size,
      texts: [...entry.texts].sort(),
    }));
}

/** The recipients a domain allowlist holds, named once each, from the API's own words
 * ("<address> cannot receive evidence requests."); other wording is kept whole. */
export function heldRecipients(texts: readonly string[]): string[] {
  const suffix = " cannot receive evidence requests.";
  return [
    ...new Set(
      texts.map((text) =>
        text.endsWith(suffix) ? text.slice(0, -suffix.length) : text,
      ),
    ),
  ];
}

/** The Test plans page's plans still awaiting a decision or a revision (its "Ready for
 * review", "Needs clarification" and "Changes requested" figures, planning-model
 * QUEUE_FIGURES): every plan a PLAN_APPROVAL item can be about. */
const PLANS_OPEN =
  "PENDING_REVIEW,DRAFT_READY,NEEDS_CLARIFICATION,CHANGES_REQUESTED";

/**
 * Where a step repeated across controls is done for all of them together, when a page
 * does that, or null when each opens on its own. Test plans are reviewed, and approved
 * as a selection (each recorded on its own), on the Test plans page.
 */
export function groupAction(
  items: readonly QueueItem[],
  organizationId: string,
  projectId: string,
): { label: string; href: string } | null {
  if (
    items.length > 1 &&
    items.every((item) => item.obligation === "PLAN_APPROVAL")
  ) {
    return {
      label: `Review all ${items.length} plans`,
      href: testingHref(organizationId, projectId, "plans", {
        filter: PLANS_OPEN,
      }),
    };
  }
  return null;
}

/** The header's primary action: the first row of Needs you, and for a repeated step,
 * where it is done for all of its controls together when a page does that. */
export function headerAction(
  queue: Queue | null,
  organizationId: string,
  projectId: string,
): { label: string; title: string; href: string } | null {
  if (queue === null) {
    return null;
  }
  const [first] = collapseRows(homeWork(queue).needsYou);
  if (first === undefined) {
    return null;
  }
  if (first.kind === "group") {
    const action = groupAction(first.items, organizationId, projectId);
    const item = first.items[0] as QueueItem;
    return action !== null
      ? {
          label: `${first.title} (${first.items.length})`,
          title: action.label,
          href: action.href,
        }
      : {
          label: first.title,
          title: first.title,
          href: queueHref(item, organizationId, projectId),
        };
  }
  return {
    label: first.item.title,
    title: first.item.title,
    href: queueHref(first.item, organizationId, projectId),
  };
}
