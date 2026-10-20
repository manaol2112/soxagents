/**
 * The engagement's one queue (queue.py, Milestone 2a), as the web reads it: every open
 * obligation once, with its record, the control, phase or round it belongs to, the
 * action and its reason, whose it is, whether the viewer may act, and where it is done.
 * The web groups and links; it never decides whose an item is or whether it is ready.
 */
export type QueueBucket = "MINE" | "WAITING" | "BLOCKED";

export type QueueItem = {
  id: string;
  kind: string;
  source: { type: string; id: string };
  stage: "SETUP" | "PLANS" | "EVIDENCE" | "TESTING" | "REVIEW" | "CLOSE";
  controlId: string | null;
  controlRef: string | null;
  phase: string | null;
  roundId: string | null;
  roundKind: string | null;
  title: string;
  reason: string;
  owner: { role: string; names: string[] };
  authorized: boolean;
  ready: boolean;
  blockers: string[];
  blocks: boolean;
  bucket: QueueBucket;
  link: { section: string; query: Record<string, string> };
  at: string | null;
};

export type Queue = {
  items: QueueItem[];
  counts: Record<QueueBucket, number>;
  generatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const maybe = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const STAGES = new Set([
  "SETUP",
  "PLANS",
  "EVIDENCE",
  "TESTING",
  "REVIEW",
  "CLOSE",
]);
const BUCKETS = new Set<QueueBucket>(["MINE", "WAITING", "BLOCKED"]);
// The pages a link may open, and the query keys it may carry; anything else is dropped.
const SECTIONS = new Set([
  "controls",
  "evidence",
  "approvals",
  "plan",
  "setup",
  "console",
  "overview",
]);
const QUERY_KEYS = new Set(["control", "step", "tab", "request", "filter"]);
const QUERY_VALUE = /^[A-Za-z0-9_,-]{1,200}$/;

export function parseQueue(value: unknown): Queue | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  const items: QueueItem[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.id !== "string" || str(raw.title) === "") {
      continue;
    }
    const stage = str(raw.stage);
    const bucket = str(raw.bucket) as QueueBucket;
    const link = isRecord(raw.link) ? raw.link : {};
    const section = str(link.section);
    const query: Record<string, string> = {};
    if (isRecord(link.query)) {
      for (const [key, text] of Object.entries(link.query)) {
        if (
          QUERY_KEYS.has(key) &&
          typeof text === "string" &&
          QUERY_VALUE.test(text)
        ) {
          query[key] = text;
        }
      }
    }
    const owner = isRecord(raw.owner) ? raw.owner : {};
    const source = isRecord(raw.source) ? raw.source : {};
    if (!STAGES.has(stage) || !BUCKETS.has(bucket) || !SECTIONS.has(section)) {
      continue;
    }
    items.push({
      id: raw.id,
      kind: str(raw.kind),
      source: { type: str(source.type), id: str(source.id) },
      stage: stage as QueueItem["stage"],
      controlId: maybe(raw.control_id),
      controlRef: maybe(raw.control_ref),
      phase: maybe(raw.phase),
      roundId: maybe(raw.round_id),
      roundKind: maybe(raw.round_kind),
      title: str(raw.title),
      reason: str(raw.reason),
      owner: {
        role: str(owner.role) || "NONE",
        names: Array.isArray(owner.names)
          ? owner.names.filter((n): n is string => typeof n === "string")
          : [],
      },
      authorized: raw.authorized === true,
      ready: raw.ready !== false,
      blockers: Array.isArray(raw.blockers)
        ? raw.blockers.filter((b): b is string => typeof b === "string")
        : [],
      blocks: raw.blocks === true,
      bucket,
      link: { section, query },
      at: maybe(raw.at),
    });
  }
  const counts = isRecord(value.counts) ? value.counts : {};
  const count = (key: QueueBucket) =>
    typeof counts[key] === "number"
      ? (counts[key] as number)
      : items.filter((item) => item.bucket === key).length;
  return {
    items,
    counts: {
      MINE: count("MINE"),
      WAITING: count("WAITING"),
      BLOCKED: count("BLOCKED"),
    },
    generatedAt: str(value.generated_at),
  };
}

export const BUCKET_LABELS: Record<QueueBucket, string> = {
  MINE: "My actions",
  WAITING: "Waiting on others",
  BLOCKED: "Blocked",
};

export const BUCKET_NOTES: Record<QueueBucket, string> = {
  MINE: "Yours to do now: the role is yours by assignment or engagement role, and the record is ready.",
  WAITING:
    "Someone else's: the client, the preparer, the independent reviewer or an approver.",
  BLOCKED: "Nothing can be done yet: what holds each item is listed on it.",
};

const ROLE_WORDS: Record<string, string> = {
  PREPARER: "the preparer",
  REVIEWER: "the independent reviewer",
  APPROVER: "an approver",
  CLIENT: "the control owner (client)",
  OWNER: "the engagement owner",
  AGENT: "an agent",
  NONE: "no one",
};

/** "Waits on the preparer (Dana Whitfield)" or "Yours". */
export function ownerWords(item: QueueItem): string {
  if (item.bucket === "MINE") {
    return "Yours";
  }
  const role = ROLE_WORDS[item.owner.role] ?? item.owner.role.toLowerCase();
  const names = item.owner.names.filter((name) => name !== "");
  return `Waits on ${role}${names.length > 0 ? ` (${names.join(", ")})` : ""}`;
}

const PHASE_WORDS: Record<string, string> = {
  DESIGN: "Design & implementation",
  INTERIM: "Interim",
  ROLLFORWARD: "Roll-forward",
  REMEDIATION: "Remediation",
  RETEST: "Retest",
};

/** "ITGC-AC-01 · Retest round" or "ITGC-AC-01 · Interim". */
export function whereWords(item: QueueItem): string {
  const parts: string[] = [];
  if (item.controlRef !== null) {
    parts.push(item.controlRef);
  }
  if (item.roundKind !== null) {
    parts.push(`${PHASE_WORDS[item.roundKind] ?? item.roundKind} round`);
  } else if (item.phase !== null) {
    parts.push(PHASE_WORDS[item.phase] ?? item.phase);
  }
  return parts.join(" · ");
}

export type QueueFilter = {
  bucket: QueueBucket | null;
  stage: QueueItem["stage"] | null;
  phase: string | null;
};

export function parseQueueFilter(
  value: string | null | undefined,
): QueueFilter {
  const filter: QueueFilter = { bucket: null, stage: null, phase: null };
  for (const part of (value ?? "").split(",")) {
    const [key, text] = part.split(":");
    if (key === "bucket" && BUCKETS.has(text as QueueBucket)) {
      filter.bucket = text as QueueBucket;
    } else if (key === "stage" && STAGES.has(text ?? "")) {
      filter.stage = text as QueueItem["stage"];
    } else if (
      key === "phase" &&
      text !== undefined &&
      /^[A-Z]{5,12}$/.test(text)
    ) {
      filter.phase = text;
    }
  }
  return filter;
}

export function filterWords(filter: QueueFilter): string {
  const parts: string[] = [];
  if (filter.bucket !== null) {
    parts.push(`bucket:${filter.bucket}`);
  }
  if (filter.stage !== null) {
    parts.push(`stage:${filter.stage}`);
  }
  if (filter.phase !== null) {
    parts.push(`phase:${filter.phase}`);
  }
  return parts.join(",");
}

/** The items a filter keeps; grouping by bucket in the queue's own order. */
export function groupQueue(
  queue: Queue,
  filter: QueueFilter,
): Array<{ bucket: QueueBucket; items: QueueItem[] }> {
  const kept = queue.items.filter(
    (item) =>
      (filter.bucket === null || item.bucket === filter.bucket) &&
      (filter.stage === null || item.stage === filter.stage) &&
      (filter.phase === null || item.phase === filter.phase),
  );
  return (["MINE", "BLOCKED", "WAITING"] as const)
    .map((bucket) => ({
      bucket,
      items: kept.filter((item) => item.bucket === bucket),
    }))
    .filter((group) => group.items.length > 0);
}

/** The queue's items for one control, the viewer's first. */
export function queueFor(queue: Queue | null, controlId: string): QueueItem[] {
  return (queue?.items ?? []).filter((item) => item.controlId === controlId);
}

/** Where an item is done: the control's step, or the page the API names. */
export function queueHref(
  item: QueueItem,
  organizationId: string,
  projectId: string,
): string {
  const params = new URLSearchParams();
  params.set("organization", organizationId);
  params.set("project", projectId);
  params.set("section", item.link.section);
  for (const [key, value] of Object.entries(item.link.query)) {
    params.set(key, value);
  }
  return `/?${params.toString()}`;
}

export type QueueRowGroup =
  | { kind: "item"; item: QueueItem }
  | { kind: "group"; title: string; items: QueueItem[] };

/** Rows for display: a control's next step repeated across many controls (such as
 * "Approve the test plan" on every unapproved control) is shown once with its count,
 * opened for the controls; every other item stands alone. Identity is kept per item. */
export function collapseRows(
  items: readonly QueueItem[],
  least = 3,
): QueueRowGroup[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.kind === "control-step") {
      counts.set(item.title, (counts.get(item.title) ?? 0) + 1);
    }
  }
  const rows: QueueRowGroup[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const count =
      item.kind === "control-step" ? (counts.get(item.title) ?? 0) : 0;
    if (count < least) {
      rows.push({ kind: "item", item });
      continue;
    }
    if (placed.has(item.title)) {
      continue;
    }
    placed.add(item.title);
    rows.push({
      kind: "group",
      title: item.title,
      items: items.filter(
        (other) => other.kind === "control-step" && other.title === item.title,
      ),
    });
  }
  return rows;
}
