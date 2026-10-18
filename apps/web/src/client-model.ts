/**
 * The firm's clients (Milestone 8.18): each engagement belongs to one. A new engagement
 * for a client takes its details from the client's latest engagement and can start from
 * an earlier one's setup (a roll-forward).
 */

export type ClientEngagement = {
  id: string;
  name: string;
  status: string;
  periodEnd: string | null;
  launched: boolean;
};

export type Client = {
  id: string;
  name: string;
  version: number;
  /** The engagements the person can open, newest first. */
  engagements: ClientEngagement[];
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseClients(value: unknown): Client[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const clients: Client[] = [];
  for (const raw of value) {
    const item = record(raw);
    if (
      item === null ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.version !== "number" ||
      !Array.isArray(item.engagements)
    ) {
      return null;
    }
    const engagements: ClientEngagement[] = [];
    for (const rawEngagement of item.engagements) {
      const engagement = record(rawEngagement);
      if (
        engagement === null ||
        typeof engagement.id !== "string" ||
        typeof engagement.name !== "string" ||
        typeof engagement.status !== "string"
      ) {
        return null;
      }
      engagements.push({
        id: engagement.id,
        name: engagement.name,
        status: engagement.status,
        periodEnd:
          typeof engagement.period_end === "string"
            ? engagement.period_end
            : null,
        launched: engagement.launched === true,
      });
    }
    clients.push({
      id: item.id,
      name: item.name,
      version: item.version,
      engagements,
    });
  }
  return clients;
}

/** A client's name as the API compares it: case and spacing aside. */
export function clientKey(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

/** The firm's client with this name, however it is written. */
export function clientNamed(
  clients: readonly Client[],
  name: string,
): Client | undefined {
  const key = clientKey(name);
  return key === ""
    ? undefined
    : clients.find((c) => clientKey(c.name) === key);
}

/** The engagements a new one can start from: the client's, newest first. */
export function rollforwardSources(
  client: Client | undefined,
): ClientEngagement[] {
  return client === undefined ? [] : client.engagements;
}

/**
 * The period a roll-forward proposes: a year after the earlier engagement's period end. A
 * leap day becomes the last day of February. Null for a date that is not one.
 */
export function nextPeriodEnd(periodEnd: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]) + 1;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

/** Whether a period end entered for a roll-forward covers the same period again or an earlier one. */
export function periodNotAfter(
  entered: string,
  earlier: string | null,
): boolean {
  return (
    earlier !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(entered) &&
    entered <= earlier
  );
}

/** What starting from an engagement copies, and what it never does. */
export const ROLLFORWARD_NOTE =
  "Copies its scope, systems, controls with their owners and attributes, team, and workpaper templates as confirmed, into this draft for you to review. Testing, evidence, and results are never copied.";
