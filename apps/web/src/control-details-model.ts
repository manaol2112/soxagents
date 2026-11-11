/**
 * A control's RCM details, completed from step 01 of its workflow (product owner, 10 November
 * 2026: "says start here but there are no actual section where I can put my answers or what
 * are the things that are needed"). Pure: the requests the panel sends, what comes back, and
 * what is missing. Decided by the product owner: a detail recorded here applies to this
 * system's control; the same control on other systems is offered it where empty, one system
 * at a time, and never overwritten (the API: control_details).
 */

export type DetailField = "owner" | "frequency" | "nature";

export type DetailsTarget = {
  controlId: string;
  system: string;
  /** What a copy fills there now: details held here that it lacks. */
  fills: DetailField[];
  /** What it lacks, held here or not: what it can be offered. */
  lacks: DetailField[];
};

export type Details = {
  version: number;
  ownerName: string;
  ownerEmail: string;
  frequency: string;
  nature: string;
  canEdit: boolean;
  targets: DetailsTarget[];
};

/** One detail of the control as recorded, for the panel's record and its questions. */
export type DetailRow = {
  key: "description" | "objective" | "risk" | DetailField;
  label: string;
  value: string;
  missing: boolean;
  /** Recorded here; description, objective and risk come from the library or the RCM. */
  editable: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;
const FIELDS: readonly DetailField[] = ["owner", "frequency", "nature"];

export type DetailsRequest =
  | { error: "invalid" }
  | {
      method: "GET" | "PUT";
      path: string;
      body: Record<string, unknown> | null;
    };

/** The API call for a read or a save, checked before it is sent. */
export function detailsRequest(
  fields: Record<string, unknown>,
  frequencies: readonly string[],
  natures: readonly string[],
): DetailsRequest {
  const text = (name: string) =>
    typeof fields[name] === "string" ? (fields[name] as string) : null;
  const org = text("organization_id") ?? "";
  const project = text("project_id") ?? "";
  const control = text("control_id") ?? "";
  if (!UUID.test(org) || !UUID.test(project) || !UUID.test(control)) {
    return { error: "invalid" };
  }
  const path = `/organizations/${org}/projects/${project}/controls/${control}/details`;
  if (fields.intent === "read") {
    return { method: "GET", path, body: null };
  }
  if (fields.intent !== "save") {
    return { error: "invalid" };
  }
  const version = fields.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { error: "invalid" };
  }
  const body: Record<string, unknown> = { version };
  const name = text("owner_name");
  const email = text("owner_email");
  if (name !== null) {
    if (name.trim().length > 200 || SECRET.test(name)) {
      return { error: "invalid" };
    }
    body.owner_name = name.trim();
  }
  if (email !== null) {
    const clean = email.trim().toLowerCase();
    if (clean.length > 200 || (clean !== "" && !EMAIL.test(clean))) {
      return { error: "invalid" };
    }
    body.owner_email = clean;
  }
  const frequency = text("frequency");
  if (frequency !== null) {
    if (!frequencies.includes(frequency)) {
      return { error: "invalid" };
    }
    body.frequency = frequency;
  }
  const nature = text("nature");
  if (nature !== null) {
    if (!natures.includes(nature)) {
      return { error: "invalid" };
    }
    body.nature = nature;
  }
  if (Object.keys(body).length === 1) {
    return { error: "invalid" };
  }
  const copy = Array.isArray(fields.copy_to)
    ? fields.copy_to.filter(
        (item): item is string => typeof item === "string" && UUID.test(item),
      )
    : [];
  if (copy.length > 50) {
    return { error: "invalid" };
  }
  if (copy.length > 0) {
    body.copy_to = [...new Set(copy)];
  }
  return { method: "PUT", path, body };
}

/** The details from the API's answer; null when it cannot be read. */
export function parseDetails(body: unknown): Details | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const item = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const fields = (value: unknown): DetailField[] =>
    Array.isArray(value)
      ? value.filter((each): each is DetailField =>
          FIELDS.some((field) => field === each),
        )
      : [];
  if (typeof item.version !== "number" || !Array.isArray(item.targets)) {
    return null;
  }
  const targets: DetailsTarget[] = [];
  for (const raw of item.targets as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const target = raw as Record<string, unknown>;
    if (typeof target.control_id !== "string") {
      continue;
    }
    targets.push({
      controlId: target.control_id,
      system: text(target.system),
      fills: fields(target.fills),
      lacks: fields(target.lacks),
    });
  }
  return {
    version: item.version,
    ownerName: text(item.owner_name),
    ownerEmail: text(item.owner_email),
    frequency: text(item.frequency),
    nature: text(item.nature),
    canEdit: item.can_edit === true,
    targets,
  };
}

/** The other systems a detail can be offered to: those that lack it. */
export function offerFor(
  details: Details,
  field: DetailField,
): DetailsTarget[] {
  return details.targets.filter((target) => target.lacks.includes(field));
}

/** The details the person is asked, in order: the missing ones first, those recorded here
 * before those that come from the RCM. */
export function toAsk(rows: readonly DetailRow[]): DetailRow[] {
  const missing = rows.filter((row) => row.missing);
  return [
    ...missing.filter((row) => row.editable),
    ...missing.filter((row) => !row.editable),
  ];
}

/** The owner as one line: the name, then the email in brackets. */
export function ownerText(name: string, email: string): string {
  const who = name.trim();
  const mail = email.trim();
  return who !== "" && mail !== ""
    ? `${who} (${mail})`
    : who !== ""
      ? who
      : mail;
}

/** The record with the API's values for what is recorded here: owner, frequency and nature
 * are read from the API, which is current after a save; the rest from the page. */
export function recordWith(
  rows: readonly DetailRow[],
  details: Details | null,
  frequencies: ReadonlyArray<readonly [string, string]>,
  natures: ReadonlyArray<readonly [string, string]>,
): DetailRow[] {
  if (details === null) {
    return [...rows];
  }
  const label = (
    options: ReadonlyArray<readonly [string, string]>,
    key: string,
  ) => options.find(([value]) => value === key)?.[1] ?? "";
  return rows.map((row) => {
    const value =
      row.key === "owner"
        ? ownerText(details.ownerName, details.ownerEmail)
        : row.key === "frequency"
          ? label(frequencies, details.frequency)
          : row.key === "nature"
            ? label(natures, details.nature)
            : null;
    return value === null ? row : { ...row, value, missing: value === "" };
  });
}
