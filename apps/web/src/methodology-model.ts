/**
 * The firm's testing methodology (product owner, 8 November 2026; the API's methodology.py,
 * migration 0142): the rules that size and conclude testing, in versions. Pure: what the page
 * reads, the change a person drafts and whether it can be sent, and the requests the route
 * forwards. Nothing here decides a size; the API applies the version an engagement follows.
 */

export const FREQUENCIES = [
  "ANNUAL",
  "QUARTERLY",
  "MONTHLY",
  "WEEKLY",
  "DAILY",
  "RECURRING",
  "EVENT_DRIVEN",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  ANNUAL: "Annual",
  QUARTERLY: "Quarterly",
  MONTHLY: "Monthly",
  WEEKLY: "Weekly",
  DAILY: "Daily",
  RECURRING: "Several times a day",
  EVENT_DRIVEN: "As needed (event-driven)",
};

export type Retest = { size: number; days: number };

export type Rules = {
  sampleSizes: Record<Frequency, number>;
  rollforwardSizes: Record<Frequency, number>;
  retest: Record<Frequency, Retest>;
  tolerance: "ZERO";
  automated: "TEST_OF_ONE";
};

export type VersionStatus =
  | "PLATFORM_DEFAULT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN";

export type MethodologyVersion = {
  id: string;
  number: number;
  status: VersionStatus;
  rules: Rules;
  rationale: string;
  basedOn: number | null;
  proposedBy: string;
  proposedAt: string;
  decidedBy: string;
  decidedAt: string;
  decisionNote: string;
  engagements: number;
  version: number;
};

export type Methodology = {
  current: MethodologyVersion;
  pending: MethodologyVersion | null;
  history: MethodologyVersion[];
  canPropose: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  independence: boolean;
  maxSample: number;
  maxWaitDays: number;
};

export type EngagementMethodology = {
  applied: MethodologyVersion;
  label: string;
  pinned: boolean;
  choices: MethodologyVersion[];
  canMove: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const STATUSES: readonly VersionStatus[] = [
  "PLATFORM_DEFAULT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
];

function rules(raw: unknown): Rules {
  const value = record(raw);
  const sizes = record(value.sample_sizes);
  const rolled = record(value.rollforward_sizes);
  const retest = record(value.retest);
  return {
    sampleSizes: Object.fromEntries(
      FREQUENCIES.map((key) => [key, num(sizes[key])]),
    ) as Record<Frequency, number>,
    rollforwardSizes: Object.fromEntries(
      FREQUENCIES.map((key) => [key, num(rolled[key])]),
    ) as Record<Frequency, number>,
    retest: Object.fromEntries(
      FREQUENCIES.map((key) => {
        const rule = record(retest[key]);
        return [key, { size: num(rule.size), days: num(rule.days) }];
      }),
    ) as Record<Frequency, Retest>,
    tolerance: "ZERO",
    automated: "TEST_OF_ONE",
  };
}

export function parseVersion(raw: unknown): MethodologyVersion {
  const value = record(raw);
  const status = str(value.status) as VersionStatus;
  return {
    id: str(value.id),
    number: num(value.number),
    status: STATUSES.includes(status) ? status : "PLATFORM_DEFAULT",
    rules: rules(value.rules),
    rationale: str(value.rationale),
    basedOn: typeof value.based_on === "number" ? value.based_on : null,
    proposedBy: str(value.proposed_by),
    proposedAt: str(value.proposed_at),
    decidedBy: str(value.decided_by),
    decidedAt: str(value.decided_at),
    decisionNote: str(value.decision_note),
    engagements: num(value.engagements),
    version: num(value.version),
  };
}

export function parseMethodology(raw: unknown): Methodology | null {
  const value = record(raw);
  if (Object.keys(record(value.current)).length === 0) {
    return null;
  }
  return {
    current: parseVersion(value.current),
    pending: value.pending == null ? null : parseVersion(value.pending),
    history: Array.isArray(value.history)
      ? value.history.map(parseVersion)
      : [],
    canPropose: value.can_propose === true,
    canDecide: value.can_decide === true,
    canWithdraw: value.can_withdraw === true,
    independence: value.independence !== false,
    maxSample: num(value.max_sample) || 200,
    maxWaitDays: num(value.max_wait_days) || 365,
  };
}

export function parseEngagement(raw: unknown): EngagementMethodology | null {
  const value = record(raw);
  if (Object.keys(record(value.applied)).length === 0) {
    return null;
  }
  return {
    applied: parseVersion(value.applied),
    label: str(value.label),
    pinned: value.pinned === true,
    choices: Array.isArray(value.choices)
      ? value.choices.map(parseVersion)
      : [],
    canMove: value.can_move === true,
  };
}

/** A version's standing, in a few words. */
export function standing(version: MethodologyVersion): {
  label: string;
  tone: "warning" | "success" | "info" | "muted";
} {
  switch (version.status) {
    case "PLATFORM_DEFAULT":
      return {
        label: "Platform default, not approved by the firm",
        tone: "warning",
      };
    case "APPROVED":
      return { label: "Approved", tone: "success" };
    case "PENDING":
      return { label: "Waiting for approval", tone: "info" };
    case "REJECTED":
      return { label: "Rejected", tone: "muted" };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "muted" };
  }
}

/** A short date for the page, from the API's timestamp. */
export function shortDate(iso: string): string {
  if (iso === "") {
    return "";
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  return at.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Who decided a version and when, or who proposed it, in a line. */
export function provenance(version: MethodologyVersion): string {
  if (version.status === "PLATFORM_DEFAULT") {
    return "Supplied by the platform. No auditing standard prescribes these rules.";
  }
  const proposed = `Proposed by ${version.proposedBy || "a team member"}${version.proposedAt ? ` on ${shortDate(version.proposedAt)}` : ""}`;
  if (version.status === "PENDING") {
    return `${proposed}.`;
  }
  const verb =
    version.status === "APPROVED"
      ? "approved"
      : version.status === "REJECTED"
        ? "rejected"
        : "withdrawn";
  return `${proposed}; ${verb} by ${version.decidedBy || "a team member"}${version.decidedAt ? ` on ${shortDate(version.decidedAt)}` : ""}.`;
}

/** The values a person edits: each table as text, so a half-typed number stays as typed. */
export type Draft = {
  sampleSizes: Record<Frequency, string>;
  rollforwardSizes: Record<Frequency, string>;
  retestSizes: Record<Frequency, string>;
  retestDays: Record<Frequency, string>;
  rationale: string;
};

export function draftFrom(base: Rules): Draft {
  const text = (pick: (key: Frequency) => number) =>
    Object.fromEntries(
      FREQUENCIES.map((key) => [key, String(pick(key))]),
    ) as Record<Frequency, string>;
  return {
    sampleSizes: text((key) => base.sampleSizes[key]),
    rollforwardSizes: text((key) => base.rollforwardSizes[key]),
    retestSizes: text((key) => base.retest[key].size),
    retestDays: text((key) => base.retest[key].days),
    rationale: "",
  };
}

export type Column =
  | "sampleSizes"
  | "rollforwardSizes"
  | "retestSizes"
  | "retestDays";

export const COLUMNS: ReadonlyArray<{
  key: Column;
  label: string;
  unit: string;
}> = [
  { key: "sampleSizes", label: "Sample", unit: "items" },
  { key: "rollforwardSizes", label: "Roll-forward", unit: "items" },
  { key: "retestSizes", label: "Retest", unit: "items" },
  { key: "retestDays", label: "Retest after", unit: "days" },
];

/** A table's value from the rules, by column. */
export function cell(base: Rules, column: Column, key: Frequency): number {
  switch (column) {
    case "sampleSizes":
      return base.sampleSizes[key];
    case "rollforwardSizes":
      return base.rollforwardSizes[key];
    case "retestSizes":
      return base.retest[key].size;
    case "retestDays":
      return base.retest[key].days;
  }
}

/** The cells another version changes, as "column:FREQUENCY". */
export function changes(base: Rules, other: Rules): Set<string> {
  const found = new Set<string>();
  for (const { key: column } of COLUMNS) {
    for (const key of FREQUENCIES) {
      if (cell(base, column, key) !== cell(other, column, key)) {
        found.add(`${column}:${key}`);
      }
    }
  }
  return found;
}

const WHOLE = /^\d{1,3}$/;

export type Checked =
  | { ok: true; rules: Rules; changed: number }
  | { ok: false; problems: string[] };

/** Whether a draft can be sent: every value a whole number in its range, a reason given, and
 * something changed. The API checks the same, and is the one that decides. */
export function checkDraft(
  draft: Draft,
  base: Rules,
  limits: { maxSample: number; maxWaitDays: number },
): Checked {
  const problems: string[] = [];
  const read = (column: Column, key: Frequency, low: number, high: number) => {
    const text = draft[column][key].trim();
    const value = WHOLE.test(text) ? Number(text) : Number.NaN;
    if (!(value >= low && value <= high)) {
      const name = COLUMNS.find((item) => item.key === column)?.label ?? column;
      problems.push(
        `${name} for ${FREQUENCY_LABELS[key].toLowerCase()} controls must be a whole number from ${low} to ${high}.`,
      );
      return low;
    }
    return value;
  };
  const sized = (column: Column) =>
    Object.fromEntries(
      FREQUENCIES.map((key) => [key, read(column, key, 1, limits.maxSample)]),
    ) as Record<Frequency, number>;
  const sampleSizes = sized("sampleSizes");
  const rollforwardSizes = sized("rollforwardSizes");
  const retestSizes = sized("retestSizes");
  const retest = Object.fromEntries(
    FREQUENCIES.map((key) => [
      key,
      {
        size: retestSizes[key],
        days: read("retestDays", key, 0, limits.maxWaitDays),
      },
    ]),
  ) as Record<Frequency, Retest>;
  if (draft.rationale.trim().length < 10) {
    problems.push(
      "Say why the methodology changes and what it rests on, such as the section of the firm's methodology manual.",
    );
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const next: Rules = {
    sampleSizes,
    rollforwardSizes,
    retest,
    tolerance: "ZERO",
    automated: "TEST_OF_ONE",
  };
  const changed = changes(base, next).size;
  if (changed === 0) {
    return { ok: false, problems: ["The draft changes nothing yet."] };
  }
  return { ok: true, rules: next, changed };
}

/** The rules as the API reads them. */
export function rulesBody(value: Rules): Record<string, unknown> {
  return {
    sample_sizes: value.sampleSizes,
    rollforward_sizes: value.rollforwardSizes,
    retest: value.retest,
    tolerance: value.tolerance,
    automated: value.automated,
  };
}

// The route's requests

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export function methodologyReadPath(params: URLSearchParams): string | null {
  const organization = id(params.get("organization"));
  if (organization === null) {
    return null;
  }
  const project = params.get("project");
  if (project !== null) {
    const engagement = id(project);
    return engagement === null
      ? null
      : `/organizations/${organization}/projects/${engagement}/testing-methodology`;
  }
  return `/organizations/${organization}/testing-methodology`;
}

export type MethodologyWrite =
  | {
      ok: true;
      path: string;
      method: "POST" | "PUT";
      body: Record<string, unknown>;
    }
  | { ok: false };

function text(value: unknown, limit: number): string | null {
  return typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= limit
    ? value
    : null;
}

function version(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

/** What the page asks for, checked before it is forwarded. */
export function methodologyWrite(
  fields: Record<string, unknown>,
): MethodologyWrite {
  const organization = id(fields.organization_id);
  if (organization === null) {
    return { ok: false };
  }
  const base = `/organizations/${organization}/testing-methodology`;
  switch (fields.intent) {
    case "propose": {
      const basedOn = id(fields.based_on);
      const rationale = text(fields.rationale, 2000);
      const proposed = record(fields.rules);
      if (
        basedOn === null ||
        rationale === null ||
        Object.keys(proposed).length === 0
      ) {
        return { ok: false };
      }
      return {
        ok: true,
        path: `${base}/proposals`,
        method: "POST",
        body: { rules: proposed, rationale, based_on: basedOn },
      };
    }
    case "decide": {
      const target = id(fields.version_id);
      const at = version(fields.version);
      const decision = fields.decision;
      const note =
        typeof fields.note === "string" ? fields.note.slice(0, 1000) : "";
      if (
        target === null ||
        at === null ||
        (decision !== "APPROVE" && decision !== "REJECT")
      ) {
        return { ok: false };
      }
      return {
        ok: true,
        path: `${base}/versions/${target}/decision`,
        method: "POST",
        body: { decision, note, version: at },
      };
    }
    case "withdraw": {
      const target = id(fields.version_id);
      const at = version(fields.version);
      if (target === null || at === null) {
        return { ok: false };
      }
      return {
        ok: true,
        path: `${base}/versions/${target}/withdraw`,
        method: "POST",
        body: { version: at },
      };
    }
    case "move": {
      const project = id(fields.project_id);
      const target = id(fields.version_id);
      const reason = text(fields.reason, 500);
      if (project === null || target === null || reason === null) {
        return { ok: false };
      }
      return {
        ok: true,
        path: `/organizations/${organization}/projects/${project}/testing-methodology`,
        method: "PUT",
        body: { version_id: target, reason },
      };
    }
    default:
      return { ok: false };
  }
}

/** A refusal in words a person can act on. */
export function methodologyProblem(status: number, detail: string): string {
  if (status === 403) {
    return detail.includes("cannot approve")
      ? "The person who proposed a change cannot approve it. Another Owner or Admin decides it."
      : "Only an Owner or Admin can change the firm's testing methodology.";
  }
  if (status === 409 && detail !== "") {
    return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
  }
  if (status === 0) {
    return "The methodology could not be reached. Check the connection and try again.";
  }
  return "The change could not be saved. Refresh the page and try again.";
}

/** Which version an engagement follows, and what that means for it, in a line. */
export function engagementLine(engagement: EngagementMethodology): string {
  const applied = engagement.applied;
  const which =
    applied.status === "PLATFORM_DEFAULT"
      ? `Follows version ${applied.number}, the platform default, not approved by the firm.`
      : `Follows version ${applied.number}, approved by the firm.`;
  return engagement.pinned
    ? `${which} It keeps this version; tests already sized keep their size.`
    : `${which} It takes the version in force when it launches.`;
}
