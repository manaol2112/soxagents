/**
 * A control's RCM details, completed from step 01 of its workflow (product owner, 10 November
 * 2026: "says start here but there are no actual section where I can put my answers or what
 * are the things that are needed"). Pure: the requests the panel sends, what comes back, and
 * what is missing. Decided by the product owner: a detail recorded here applies to this
 * system's control; the same control on other systems is offered it where empty, one system
 * at a time, and never overwritten (the API: control_details).
 *
 * The owner is suggested (product owner, 11 November 2026: "All controls require me to input
 * the process owner. Most of the time it's the same for one system unless the user wanted to
 * change it."): a control with no owner opens on the owner most used by the other controls on
 * its system, marked as a suggestion until the server records it, and a saved owner is also
 * given to the other controls on that system that have none, unless the person says not to.
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

/** The owner most used by the other controls on this control's system in the engagement,
 * offered when this control has none; how many of them it owns. */
export type OwnerSuggestion = {
  name: string;
  email: string;
  controls: number;
};

export type Details = {
  version: number;
  ownerName: string;
  ownerEmail: string;
  frequency: string;
  nature: string;
  canEdit: boolean;
  targets: DetailsTarget[];
  /** Null when the control has an owner or no other control on the system has one. */
  ownerSuggestion: OwnerSuggestion | null;
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
  // Whether the owner also goes to the other controls on this system that have none: said
  // explicitly with every owner save, so the record shows what the person chose.
  const apply = fields.apply_to_system;
  if (apply !== undefined && typeof apply !== "boolean") {
    return { error: "invalid" };
  }
  if (name !== null || email !== null) {
    body.apply_to_system = apply === true;
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
    ownerSuggestion: parseOwnerSuggestion(item.owner_suggestion),
  };
}

/** The suggested owner from the API's answer, checked as untrusted data: null when it is
 * absent or cannot be read, so nothing malformed is offered as an owner. */
export function parseOwnerSuggestion(value: unknown): OwnerSuggestion | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.name !== "string" ||
    typeof item.email !== "string" ||
    typeof item.controls !== "number" ||
    !Number.isInteger(item.controls) ||
    item.controls < 1
  ) {
    return null;
  }
  const name = item.name.trim();
  const email = item.email.trim().toLowerCase();
  if (
    (name === "" && email === "") ||
    name.length > 200 ||
    email.length > 200 ||
    SECRET.test(name) ||
    (email !== "" && !EMAIL.test(email))
  ) {
    return null;
  }
  return { name, email, controls: item.controls };
}

/** The owner form as it opens: the recorded owner, or, when there is none, the suggestion,
 * marked as one so it is never shown as recorded before the server confirms it. */
export type OwnerForm = {
  name: string;
  email: string;
  suggestion: OwnerSuggestion | null;
};

export function initialOwnerForm(details: Details): OwnerForm {
  const recorded =
    details.ownerName.trim() !== "" || details.ownerEmail.trim() !== "";
  if (recorded || details.ownerSuggestion === null) {
    return {
      name: details.ownerName,
      email: details.ownerEmail,
      suggestion: null,
    };
  }
  return {
    name: details.ownerSuggestion.name,
    email: details.ownerSuggestion.email,
    suggestion: details.ownerSuggestion,
  };
}

/** Why the suggestion is offered, in one line: "Owner of 8 other controls on SAP S/4HANA". */
export function suggestionNote(
  suggestion: OwnerSuggestion,
  system: string,
): string {
  const where = system.trim() !== "" ? system.trim() : "this system";
  return `Owner of ${suggestion.controls} other ${suggestion.controls === 1 ? "control" : "controls"} on ${where}`;
}

/** How many other controls on the system got the owner, from the save's answer; 0 when it
 * cannot be read. */
export function appliedTo(body: unknown): number {
  if (typeof body !== "object" || body === null) {
    return 0;
  }
  const value = (body as Record<string, unknown>).applied_to;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

/** How many other systems the save actually copied the value to (`copied_to`); null when the
 * answer does not say, so the caller can fall back to what it asked for. */
export function copiedTo(body: unknown): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const value = (body as Record<string, unknown>).copied_to;
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

const NAMES: Record<DetailField, string> = {
  owner: "Owner",
  frequency: "Frequency",
  nature: "Nature",
};

/** The note shown once the server confirms a save: where the detail was recorded, the same
 * control on other systems it was copied to, and, for the owner, the other controls on this
 * system that had none. */
export function savedNote(
  field: DetailField,
  system: string,
  copied: number,
  applied: number,
): string {
  const where = system.trim() !== "" ? system.trim() : "this system";
  const others =
    copied > 0
      ? ` and ${copied} other ${copied === 1 ? "system" : "systems"} where it was empty`
      : "";
  const same =
    field === "owner" && applied > 0
      ? `, and on ${applied} other ${applied === 1 ? "control" : "controls"} on ${where} that had none`
      : "";
  return `${NAMES[field]} recorded on ${where}${others}${same}.`;
}

/** What the person is told when a save is refused: the server's reason when it gives one,
 * then how to recover. */
export function saveProblem(status: number, detail: unknown): string {
  const reason =
    typeof detail === "string"
      ? detail
          .replace(/\s+/g, " ")
          .split("")
          .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
          .join("")
          .trim()
          .slice(0, 300)
      : "";
  const said = reason === "" ? "" : `${reason.replace(/[.!?]$/, "")}. `;
  if (status === 409) {
    return `${said || "The control changed since it was read. "}It is read again; check the detail and save it once more.`;
  }
  if (status === 403 || status === 404) {
    return `${said}Only an engagement owner, admin or project manager can record a control's details. Ask one of them, or reload the page if your role changed.`;
  }
  if (status === 422) {
    return `${said || "That detail cannot be recorded as given. "}Check it and try again.`;
  }
  if (status === 0) {
    return "The detail could not be saved: the server did not answer. Check the connection and try again.";
  }
  return `${said || "The detail could not be saved. "}Try again.`;
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
