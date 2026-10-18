// The public landing page: the demo request form, and what the page says afterwards.

export type DemoWrite =
  | { error: "invalid" }
  | {
      body: {
        name: string;
        email: string;
        firm: string;
        message: string;
        website: string;
      };
    };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CREDENTIAL =
  /(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b/i;

/** The form's fields, checked the way the API checks them, so a bad request never leaves. */
export function demoWrite(fields: Record<string, string>): DemoWrite {
  const name = (fields.name ?? "").trim();
  const email = (fields.email ?? "").trim();
  const firm = (fields.firm ?? "").trim();
  const message = (fields.message ?? "").trim();
  const website = (fields.website ?? "").trim();
  if (
    name === "" ||
    name.length > 200 ||
    !EMAIL.test(email) ||
    email.length > 200 ||
    firm.length > 200 ||
    message.length > 2000 ||
    CREDENTIAL.test(`${name}\n${firm}\n${message}`)
  ) {
    return { error: "invalid" };
  }
  return { body: { name, email, firm, message, website } };
}

export type WelcomeNotice = "sent" | "invalid" | "busy" | "unavailable";

export const WELCOME_NOTICES: Record<WelcomeNotice, string> = {
  sent: "Thanks. We read every request and will be in touch within two working days.",
  invalid:
    "Check the fields: a name and a work email are needed, and the message cannot hold a credential.",
  busy: "Too many requests from here just now. Try again in an hour.",
  unavailable: "The request could not be saved. Try again in a moment.",
};

export function welcomeNoticeFor(status: number): WelcomeNotice {
  if (status === 201) {
    return "sent";
  }
  if (status === 422) {
    return "invalid";
  }
  if (status === 429) {
    return "busy";
  }
  return "unavailable";
}

export function parseWelcomeNotice(value: string | null): WelcomeNotice | null {
  return (
    (Object.keys(WELCOME_NOTICES) as WelcomeNotice[]).find(
      (notice) => notice === value,
    ) ?? null
  );
}

/** The library figures on the landing page, read from the API so they never drift. */
export type LibrarySummary = {
  controls: number;
  areas: number;
  agents: number;
};

export function parseLibrarySummary(value: unknown): LibrarySummary | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { controls, areas, agents } = value as Record<string, unknown>;
  if (
    typeof controls !== "number" ||
    typeof areas !== "number" ||
    typeof agents !== "number" ||
    controls < 1 ||
    areas < 1 ||
    agents < 1
  ) {
    return null;
  }
  return { controls, areas, agents };
}
