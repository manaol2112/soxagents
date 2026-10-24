/**
 * Withdrawing, restoring, and replacing an evidence file (Milestone 8.3b). The custody
 * record stays: a withdrawn file is kept, read-only, with who withdrew it and why, and a
 * replacement takes the old file's place as a new file. This builds the writes and turns
 * the API's answer into one of a fixed set of notices.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL =
  /(?:api[_-]?key|client[_-]?secret|refresh[_-]?token|access[_-]?token|password\s*[:=]|private[_-]?key)/i;

export type ChangeIntent = "withdraw" | "restore";

/** Where a change sends the person back to: the evidence page or a control's tab. */
export type ChangeReturn =
  | { to: "evidence"; file: string | null; keep: Record<string, string> }
  | { to: "control"; control: string };

/** A reason as the API takes it: one plain line, 3 to 500 characters. */
export function cleanReason(value: string): string | null {
  // Control characters become spaces, so the reason is one plain line.
  const plain = [...value]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  const reason = plain.replace(/\s+/g, " ").trim();
  if (reason.length < 3 || reason.length > 500 || CREDENTIAL.test(reason)) {
    return null;
  }
  return reason;
}

export type ChangeWrite =
  | { error: "invalid" }
  | {
      intent: ChangeIntent;
      path: string;
      body: { reason: string };
    };

export function changeWrite(fields: Record<string, string>): ChangeWrite {
  const organization = fields.organization_id ?? "";
  const project = fields.project_id ?? "";
  const file = fields.file_id ?? "";
  const intent = fields.intent ?? "";
  // A withdrawal's reason is optional (22 Oct 2026); the API records that none was given.
  const given = (fields.reason ?? "").trim();
  const reason =
    intent === "withdraw" && given === "" ? "" : cleanReason(given);
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(file) ||
    (intent !== "withdraw" && intent !== "restore") ||
    reason === null
  ) {
    return { error: "invalid" };
  }
  return {
    intent,
    path: `/organizations/${organization}/projects/${project}/evidence-files/${file}/${intent}`,
    body: { reason },
  };
}

const KEEP = ["queue", "q", "group"] as const;

export function changeReturn(fields: Record<string, string>): ChangeReturn {
  const control = fields.control_id ?? "";
  if (UUID.test(control)) {
    return { to: "control", control };
  }
  const file = fields.file_id ?? "";
  const keep: Record<string, string> = {};
  for (const key of KEEP) {
    const value = (fields[key] ?? "").slice(0, 120);
    if (value !== "") {
      keep[key] = value;
    }
  }
  return { to: "evidence", file: UUID.test(file) ? file : null, keep };
}

export type ReplaceTarget =
  | { error: "invalid" }
  | { path: string; query: string };

/** The API call for a replacement, from the replace route's query. */
export function replaceTarget(params: URLSearchParams): ReplaceTarget {
  const organization = params.get("organization") ?? "";
  const project = params.get("project") ?? "";
  const file = params.get("file") ?? "";
  const name = params.get("name") ?? "";
  const reason = cleanReason(params.get("reason") ?? "");
  if (
    !UUID.test(organization) ||
    !UUID.test(project) ||
    !UUID.test(file) ||
    name.trim() === "" ||
    name.length > 200 ||
    reason === null
  ) {
    return { error: "invalid" };
  }
  return {
    path: `/organizations/${organization}/projects/${project}/evidence-files/${file}/replace`,
    query: new URLSearchParams({ name, reason }).toString(),
  };
}

export type ChangeNotice =
  | "withdrawn"
  | "restored"
  | "replaced"
  | "reading"
  | "review-signed"
  | "sample-drawn"
  | "testing-signed"
  | "workpaper-prepared"
  | "same-file"
  | "was-replaced"
  | "already"
  | "denied"
  | "invalid"
  | "unavailable";

export const CHANGE_NOTICES: Record<ChangeNotice, string> = {
  withdrawn:
    "File withdrawn. It is off its request, testing, and workpapers, and kept under Withdrawn with your reason.",
  restored:
    "File restored. It is back on its control, and the tester looks at it again.",
  replaced:
    "File replaced. The new version took the old one's place; the agent is reading it, and the old one is kept under Withdrawn.",
  reading: "The agent is still reading this file. Try again in a moment.",
  "review-signed":
    "Its screenshot review is signed off, so the file stays. Reopen the review first.",
  "sample-drawn": "An approved sample was drawn from this file, so it stays.",
  "testing-signed":
    "The control's testing is signed off, so the file stays. Reopen the testing first, with a reason.",
  "workpaper-prepared":
    "A workpaper for the control is prepared, so the file stays. Reopen the workpaper first.",
  "same-file": "That is the same file. Choose the corrected one.",
  "was-replaced":
    "This file was replaced. Withdraw its newer version to use this one again.",
  already: "That file changed. Refresh and try again.",
  denied: "That is not available to you.",
  invalid: "Give a reason of at least three characters, and choose a file.",
  unavailable: "The evidence register could not be reached. Try again.",
};

/** The notice for the API's answer. A 409 says why in plain words; it is matched, never shown. */
export function changeNoticeFor(
  intent: ChangeIntent | "replace",
  status: number,
  detail: string,
): ChangeNotice {
  if (status === 200) {
    return intent === "withdraw"
      ? "withdrawn"
      : intent === "restore"
        ? "restored"
        : "replaced";
  }
  if (status === 409) {
    const why = detail.toLowerCase();
    if (why.includes("still reading")) {
      return "reading";
    }
    if (why.includes("screenshot review")) {
      return "review-signed";
    }
    if (why.includes("approved sample")) {
      return "sample-drawn";
    }
    if (why.includes("testing for")) {
      return "testing-signed";
    }
    if (why.includes("workpaper")) {
      return "workpaper-prepared";
    }
    if (why.includes("same file")) {
      return "same-file";
    }
    if (why.includes("was replaced")) {
      return "was-replaced";
    }
    return "already";
  }
  if (status === 403 || status === 404) {
    return "denied";
  }
  if (status === 422) {
    return "invalid";
  }
  return "unavailable";
}

const DONE = new Set<ChangeNotice>(["withdrawn", "restored", "replaced"]);

export function changeNoticeOk(notice: ChangeNotice): boolean {
  return DONE.has(notice);
}

/** Change notices travel as "change-<notice>", apart from the page's other notices. */
export function changeNoticeParam(notice: ChangeNotice): string {
  return `change-${notice}`;
}

export function parseChangeNotice(value: string | null): ChangeNotice | null {
  return (
    (Object.keys(CHANGE_NOTICES) as ChangeNotice[]).find(
      (notice) => value === changeNoticeParam(notice),
    ) ?? null
  );
}

/** Why a file cannot be withdrawn or replaced from the page, or null when it can. */
export function changeBlocked(file: {
  state: string;
  readStatus: string | null;
  reviewDecision: string | null;
}): string | null {
  if (
    file.state === "READING" ||
    file.readStatus === "PENDING" ||
    file.readStatus === "WORKING"
  ) {
    return "The agent is reading this file. Withdraw or replace it once it is read.";
  }
  if (file.reviewDecision !== null) {
    return "Its screenshot review is signed off, so the file stays.";
  }
  return null;
}
