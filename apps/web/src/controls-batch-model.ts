/**
 * The Controls register's batch actions, checked before they reach the API: submitting
 * drafted requests for approval together (each still approved on its own), and setting
 * the owner of chosen controls. The API runs each item through the same checks as one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SECRET =
  /(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*\S|sk-[A-Za-z0-9]{10,}/i;

export const MAX_BATCH = 500;

export type BatchWrite =
  | { error: "invalid" }
  | {
      path: string;
      body: Record<string, unknown>;
    };

type Raw = Record<string, unknown>;

export function batchWrite(fields: Raw): BatchWrite {
  const org =
    typeof fields.organization_id === "string" ? fields.organization_id : "";
  const project =
    typeof fields.project_id === "string" ? fields.project_id : "";
  if (!UUID.test(org) || !UUID.test(project)) {
    return { error: "invalid" };
  }
  const base = `/organizations/${org}/projects/${project}`;
  if (fields.intent === "submit") {
    const items = Array.isArray(fields.items) ? fields.items : [];
    const clean = items.flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }
      const { request_id: id, version } = item as Raw;
      return typeof id === "string" &&
        UUID.test(id) &&
        typeof version === "number" &&
        Number.isInteger(version) &&
        version >= 1
        ? [{ request_id: id, version }]
        : [];
    });
    if (
      clean.length === 0 ||
      clean.length !== items.length ||
      clean.length > MAX_BATCH
    ) {
      return { error: "invalid" };
    }
    return {
      path: `${base}/pbc-request-batches/submit`,
      body: { items: clean },
    };
  }
  if (fields.intent === "owner") {
    const ids = Array.isArray(fields.control_ids) ? fields.control_ids : [];
    const name =
      typeof fields.owner_name === "string" ? fields.owner_name.trim() : "";
    const email =
      typeof fields.owner_email === "string"
        ? fields.owner_email.trim().toLowerCase()
        : "";
    if (
      ids.length === 0 ||
      ids.length > 2000 ||
      !ids.every((id) => typeof id === "string" && UUID.test(id)) ||
      name.length < 1 ||
      name.length > 200 ||
      !EMAIL.test(email) ||
      email.length > 200 ||
      SECRET.test(name)
    ) {
      return { error: "invalid" };
    }
    return {
      path: `${base}/onboarding/controls/owner-batch`,
      body: { control_ids: ids, owner_name: name, owner_email: email },
    };
  }
  return { error: "invalid" };
}

export type BatchOutcome = {
  submitted: number;
  failed: number;
  /** Why each one that could not go did not, in words. */
  problems: string[];
};

const DETAILS: Record<string, string> = {
  "pbc request changed": "it changed since the page loaded",
  "request is already sent": "it was already sent",
  "recipient is not allowed": "its recipient is not allowed",
  "request not found": "it was not found",
  "the request is too long to send": "it is too long to send",
};

/** What a batch submission did, from the API's answer. */
export function parseSubmitResult(value: unknown): BatchOutcome | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Raw;
  if (typeof raw.submitted !== "number" || typeof raw.failed !== "number") {
    return null;
  }
  const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
  const problems = outcomes.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const { ok, detail } = item as Raw;
    return ok === true
      ? []
      : [
          DETAILS[typeof detail === "string" ? detail : ""] ??
            "it could not be submitted",
        ];
  });
  return { submitted: raw.submitted, failed: raw.failed, problems };
}

/** One line for what a batch did, with partial success said plainly. */
export function outcomeLine(outcome: BatchOutcome): string {
  const done = `${outcome.submitted} request${outcome.submitted === 1 ? "" : "s"} submitted for approval`;
  if (outcome.failed === 0) {
    return `${done}.`;
  }
  const counts = new Map<string, number>();
  for (const problem of outcome.problems) {
    counts.set(problem, (counts.get(problem) ?? 0) + 1);
  }
  const why = [...counts.entries()]
    .map(([problem, count]) => `${count} because ${problem}`)
    .join("; ");
  return `${done}. ${outcome.failed} could not be: ${why}.`;
}

export function batchProblem(status: number): string | null {
  if (status === 200) {
    return null;
  }
  if (status === 403 || status === 404) {
    return "Your role cannot do this for these controls.";
  }
  if (status === 422) {
    return "Check the entry: a name, a valid email address, and no credential.";
  }
  return "That did not go through. Refresh and try again.";
}
