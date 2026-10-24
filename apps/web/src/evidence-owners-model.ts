// Owner assignment for requests addressed to no one (Release 2b): the suggestions read
// from the API, the person's choices, and what is confirmed.

import type { Contact } from "./request-details-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SOURCES = new Set([
  "CONTROL_OWNER",
  "SAME_CONTROL",
  "CONTACT",
  "SAME_SYSTEM",
]);
const CONTACT_SOURCES = new Set([
  "OWNER",
  "COORDINATOR",
  "CONTACT",
  "RECIPIENT",
]);

export type Suggestion = {
  name: string;
  email: string;
  source: "CONTROL_OWNER" | "SAME_CONTROL" | "CONTACT" | "SAME_SYSTEM";
  /** Where it comes from, in words. */
  label: string;
};

export type Unassigned = {
  id: string;
  version: number;
  reference: string;
  controlRef: string;
  controlTitle: string;
  system: string;
  phase: string | null;
  suggestion: Suggestion | null;
};

export type Owners = {
  items: Unassigned[];
  contacts: Contact[];
  domains: string[];
};

/** The person's choice for one request: who it goes to, and whether to confirm it now. */
export type Choice = { recipient: string; include: boolean };
export type Choices = Record<string, Choice>;

export type Section = {
  /** The suggested address; "" for the requests with no suggestion. */
  email: string;
  name: string;
  labels: string[];
  items: Unassigned[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

function parseSuggestion(value: unknown): Suggestion | null {
  if (
    !isRecord(value) ||
    !EMAIL.test(str(value.email)) ||
    !SOURCES.has(str(value.source))
  ) {
    return null;
  }
  return {
    name: str(value.name),
    email: str(value.email).toLowerCase(),
    source: str(value.source) as Suggestion["source"],
    label: str(value.label),
  };
}

/** The API's list, or null when it is not well formed. */
export function parseOwners(value: unknown): Owners | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  return {
    items: records(value.items)
      .filter(
        (item) => UUID.test(str(item.id)) && typeof item.version === "number",
      )
      .map((item) => ({
        id: str(item.id),
        version: item.version as number,
        reference: str(item.reference),
        controlRef: str(item.control_ref),
        controlTitle: str(item.control_title),
        system: str(item.system),
        phase: typeof item.phase === "string" ? item.phase : null,
        suggestion: parseSuggestion(item.suggestion),
      })),
    contacts: records(value.contacts)
      .filter((item) => EMAIL.test(str(item.email)))
      .map((item) => ({
        name: str(item.name),
        email: str(item.email).toLowerCase(),
        role: str(item.role),
        source: (CONTACT_SOURCES.has(str(item.source))
          ? str(item.source)
          : "CONTACT") as Contact["source"],
      })),
    domains: Array.isArray(value.domains)
      ? value.domains.filter((item): item is string => typeof item === "string")
      : [],
  };
}

/** Suggestions start confirmed; a request with no suggestion waits for a person's pick. */
export function initialChoices(items: Unassigned[]): Choices {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        recipient: item.suggestion?.email ?? "",
        include: item.suggestion !== null,
      },
    ]),
  );
}

/** One section per suggested person, then the requests with no suggestion. */
export function sections(items: Unassigned[]): Section[] {
  const found = new Map<string, Section>();
  for (const item of items) {
    const email = item.suggestion?.email ?? "";
    const section = found.get(email) ?? {
      email,
      name: item.suggestion?.name ?? "",
      labels: [],
      items: [],
    };
    if (
      item.suggestion !== null &&
      !section.labels.includes(item.suggestion.label)
    ) {
      section.labels.push(item.suggestion.label);
    }
    if (section.name === "" && item.suggestion?.name) {
      section.name = item.suggestion.name;
    }
    section.items.push(item);
    found.set(email, section);
  }
  return [...found.values()].sort(
    (a, b) =>
      Number(a.email === "") - Number(b.email === "") ||
      (a.name || a.email).localeCompare(b.name || b.email),
  );
}

/** Someone chosen for every request in a section: each is confirmed with them. */
export function chooseAll(
  choices: Choices,
  ids: string[],
  email: string,
): Choices {
  const next = { ...choices };
  for (const id of ids) {
    next[id] = { recipient: email.toLowerCase(), include: true };
  }
  return next;
}

/** What is confirmed: each included request that has someone to go to. */
export function chosen(
  items: Unassigned[],
  choices: Choices,
): { id: string; version: number; recipient: string }[] {
  return items
    .filter((item) => {
      const choice = choices[item.id];
      return choice?.include === true && EMAIL.test(choice.recipient);
    })
    .map((item) => ({
      id: item.id,
      version: item.version,
      recipient: (choices[item.id] as Choice).recipient,
    }));
}

/** What a confirmation did, in one line. */
export function assignSummary(done: number, refused: number): string {
  const n = (count: number) => `${count} request${count === 1 ? "" : "s"}`;
  return refused > 0
    ? `${n(done)} assigned; ${n(refused)} could not change.`
    : `${n(done)} assigned.`;
}
