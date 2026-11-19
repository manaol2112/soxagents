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

// The Evidence page's view: its tab (the Evidence Library is "files"), queue, search and
// grouping, so a change made there comes back to the same view with its notice.
const KEEP = ["tab", "queue", "q", "group"] as const;

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

/**
 * The page a withdrawal or a restoration comes back to, with its notice, as a path on this
 * app: the control's workflow step it was made on (`step`, as control-workflow-model
 * .returnStep reads it; else its Evidence tab) with its files open; or the Evidence page
 * with the view kept (its tab, so the Evidence Library stays the Library, its queue,
 * search and grouping) and the file open unless it was just withdrawn (18 November 2026:
 * a withdrawal and a restoration in the Library landed on Requests, with no banner).
 */
export function changeLanding(
  fields: Record<string, string>,
  notice: ChangeNotice,
  step: string | null,
): string {
  const params = new URLSearchParams();
  for (const [field, param] of [
    ["organization_id", "organization"],
    ["project_id", "project"],
  ] as const) {
    const value = fields[field] ?? "";
    if (UUID.test(value)) {
      params.set(param, value);
    }
  }
  const target = changeReturn(fields);
  if (target.to === "control") {
    params.set("section", "controls");
    params.set("control", target.control);
    // Back to the step the file was changed on: D&I Evidence or OE Evidence.
    if (step !== null) {
      params.set("step", step);
    } else {
      params.set("tab", "evidence");
    }
    // The notice shows with the control's files: open them.
    params.set("ev", "files");
  } else {
    params.set("section", "evidence");
    for (const [key, value] of Object.entries(target.keep)) {
      params.set(key, value);
    }
    if (target.file !== null && notice !== "withdrawn") {
      params.set("file", target.file);
    }
  }
  params.set("notice", changeNoticeParam(notice));
  return `/?${params.toString()}`;
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
  | "item-accepted"
  | "testing-signed"
  | "workpaper-prepared"
  | "tickmark"
  | "reliability"
  | "walkthrough-pick"
  | "conclusion-signed"
  | "finding-held"
  | "same-file"
  | "was-replaced"
  | "already"
  | "denied"
  | "invalid"
  | "unavailable";

export const CHANGE_NOTICES: Record<ChangeNotice, string> = {
  // Changed 18 November 2026 (E1). Old: "... and kept under Withdrawn with your reason."
  // New: no reason is claimed, since a withdrawal may be made without one.
  // Changed again 18 November 2026 (E1 design review). Old: "File withdrawn. It is off
  // its request, testing, and workpapers, ...", untrue for a file on no request, and
  // worded apart from the line said where the person acted. New: those same words
  // (evidence-impact-model.withdrawnMessage, restoredMessage), with "The file".
  withdrawn:
    "The file was withdrawn. It is kept under Withdrawn and can be restored.",
  restored:
    "The file was restored. It is back on its control and is tested again.",
  replaced:
    "File replaced. The new version took the old one's place; the agent is reading it, and the old one is kept under Withdrawn.",
  reading: "The agent is still reading this file. Try again in a moment.",
  "review-signed":
    "Its screenshot review is signed off, so the file stays. Reopen the review first.",
  "sample-drawn": "An approved sample was drawn from this file, so it stays.",
  "item-accepted":
    "An evidence item was accepted with this file, so the file stays. Change that decision first.",
  "testing-signed":
    "Signed-off testing used this file, so the file stays. Reopen the testing first, with a reason.",
  "workpaper-prepared":
    "A prepared workpaper cites this file, so the file stays. Reopen the workpaper first.",
  // The reliances added by E1 (18 November 2026), for a page reloaded with its notice; a
  // form that changes the file in place shows the server's own sentence instead.
  tickmark:
    "A person's tickmark on this file shows an attribute, so the file stays. Reopen that decision first.",
  reliability:
    "A person's decision on whether this file is reliable stands, so the file stays. Reopen that decision first.",
  "walkthrough-pick":
    "The walkthrough instance was picked from this file, so the file stays. Pick it again from another file first.",
  "conclusion-signed":
    "A signed design conclusion rests on this file, so the file stays. Reopen that conclusion first.",
  "finding-held":
    "An open finding on this file was decided or sent to the organization, so the file stays. Close that finding first.",
  "same-file": "That is the same file. Choose the corrected one.",
  // Changed 18 November 2026 (E1), to the API's own sentence. Old: "Withdraw its newer
  // version to use this one again", which never restored it.
  "was-replaced":
    "This file was replaced. A replaced file stays in its version history and cannot be restored; to use it again, upload it again under another file name.",
  already: "That file changed. Refresh and try again.",
  denied: "That is not available to you.",
  invalid: "Give a reason of at least three characters, and choose a file.",
  unavailable: "The evidence register could not be reached. Try again.",
};

/** The notice for the API's answer, for a page reloaded with it (only a fixed set travels
 * in the address). A 409 says why in plain words; it is matched here, and a form that
 * changes the file in place shows the sentence itself (`changeProblem`). */
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
    if (why.includes("was accepted with it")) {
      return "item-accepted";
    }
    if (why.includes("testing for")) {
      return "testing-signed";
    }
    if (why.includes("workpaper")) {
      return "workpaper-prepared";
    }
    if (why.includes("tickmark")) {
      return "tickmark";
    }
    if (why.includes("whether it is reliable")) {
      return "reliability";
    }
    if (why.includes("walkthrough instance")) {
      return "walkthrough-pick";
    }
    if (why.includes("signed design conclusion")) {
      return "conclusion-signed";
    }
    if (why.includes("the finding")) {
      return "finding-held";
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

/** What a form that changes a file in place says when the change did not go through:
 * the server's own sentence where it refused with one (E1, 18 November 2026: every
 * refusal names the reliance and how to clear it), else the notice's words. */
export function changeProblem(notice: ChangeNotice, detail: string): string {
  return detail.trim() === "" ? CHANGE_NOTICES[notice] : asSentence(detail);
}

/** How the API starts its refusal to read a file again whose reading a decision rests
 * on (evidence_reliance.REFUSED["REREAD"]), told apart from its other refusals. */
export const RELIED_ON_READING = "This file's reading is relied on: ";

/** A server sentence as a screen shows it: a capital first, a full stop last (the API
 * words its refusals lower case, with no full stop). */
export function asSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") {
    return "";
  }
  const first = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** Whether a change route answers with the notice as JSON, for a form that withdraws in
 * place (31 Oct 2026: a refusal sent by page reload landed in a closed section, unseen),
 * rather than reloading the page with it. */
export function answersInPlace(accept: string | null): boolean {
  return (accept ?? "").includes("application/json");
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
