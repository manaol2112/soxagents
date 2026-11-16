// A person's working copy of a section they are editing (docs/design-workpaper.md,
// section 3.4): what they typed, kept on the server as they type, private to them, and not
// the workpaper. A version is added to the workpaper only when they save. Pure: the
// answer the page reads, what an editor opens with, when a copy is kept or dropped, the
// calls the route sends, and the words the bar says. Nothing here says "saved" of a
// working copy as if it were the workpaper.

import {
  attributeRow,
  changed,
  type Draft,
  draftProblem,
  EDIT_LIMITS,
  type EditSource,
  type SectionEditor,
  saveRequest,
  sectionWrite,
} from "./section-edit-model.ts";

/** A working copy as the server holds it: the body a save would send, and when. */
export type WorkingCopy = {
  /** The stored section's key. */
  section: string;
  /** The workpaper's version when it was started. */
  basedOn: number;
  text: string | null;
  rows: string[][] | null;
  /** When it was last kept (a UTC timestamp). */
  updatedAt: string;
};

const KEY = /^[a-z0-9-]{1,60}$/;

/** The caller's working copies, read cautiously: an entry that is not one is left out,
 * never guessed at. */
export function parseWorkingCopies(value: unknown): WorkingCopy[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const found: WorkingCopy[] = [];
  for (const item of value.slice(0, 60)) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const { section, based_on: basedOn, text, rows } = entry;
    const updatedAt = entry.updated_at;
    if (
      typeof section !== "string" ||
      !KEY.test(section) ||
      typeof basedOn !== "number" ||
      !Number.isInteger(basedOn) ||
      basedOn < 1 ||
      typeof updatedAt !== "string"
    ) {
      continue;
    }
    const asText =
      typeof text === "string" && text.length <= EDIT_LIMITS.text ? text : null;
    const asRows =
      Array.isArray(rows) &&
      rows.length <= EDIT_LIMITS.rows &&
      rows.every(
        (row): row is string[] =>
          Array.isArray(row) &&
          row.length <= EDIT_LIMITS.columns &&
          row.every((cell) => typeof cell === "string"),
      )
        ? rows.map((row) => [...row])
        : null;
    // Exactly one of them: anything else is not a working copy this page can open.
    if ((asText === null) === (asRows === null)) {
      continue;
    }
    if (found.some((other) => other.section === section)) {
      continue;
    }
    found.push({ section, basedOn, text: asText, rows: asRows, updatedAt });
  }
  return found;
}

/** The working copy an editor would open with: the one of its section, of its kind. */
export function copyFor(
  editor: Pick<SectionEditor, "key" | "kind">,
  copies: readonly WorkingCopy[],
): WorkingCopy | null {
  const copy = copies.find((item) => item.section === editor.key);
  if (copy === undefined) {
    return null;
  }
  return (editor.kind === "text") === (copy.text !== null) ? copy : null;
}

/** What the editor shows when it opens with a working copy: what the person had typed. */
export function restoredDraft(editor: SectionEditor, copy: WorkingCopy): Draft {
  if (editor.kind === "text") {
    return { kind: "text", text: copy.text ?? editor.text };
  }
  const width = editor.columns.length;
  const rows = (copy.rows ?? editor.rows).map((row) =>
    [...row, ...Array<string>(width).fill("")].slice(0, width),
  );
  if (editor.kind === "grid") {
    return { kind: "grid", rows };
  }
  // The notes are read from the copy's rows as they are from the stored ones.
  return {
    kind: "notes",
    notes: Object.fromEntries(
      editor.items.map((item) => {
        const row = attributeRow(rows, item.code, item.text);
        return [
          item.id,
          row === null ? "" : (rows[row]?.[editor.noteAt] ?? ""),
        ];
      }),
    ),
  };
}

/** The workpaper has another version than the one the working copy was started from:
 * the section may have changed since, and a save replaces it with what is in the editor. */
export function copyIsStale(
  copy: Pick<WorkingCopy, "basedOn">,
  source: Pick<EditSource, "basedOn">,
): boolean {
  return copy.basedOn !== source.basedOn;
}

/** What the page does about the working copy once the typing has paused: keep what was
 * changed, drop a copy of something changed back to what is stored, or nothing. What a
 * save could not send (a credential, a limit passed) is not sent as a copy either: a copy
 * already there stays as it was. */
export function keepAction(
  editor: SectionEditor,
  draft: Draft,
  hasCopy: boolean,
): "keep" | "discard" | "none" {
  if (changed(editor, draft)) {
    return draftProblem(editor, draft) === "" ? "keep" : "none";
  }
  return hasCopy ? "discard" : "none";
}

/** The typing has paused for this long before a working copy is sent. */
export const KEEP_AFTER_MS = 1500;
/** A working copy that could not be kept is tried again after this long. */
export const KEEP_RETRY_MS = 15_000;

/* The calls ------------------------------------------------------------------------------ */

type Scope = { organizationId: string; projectId: string };

/** The body the page posts to `/workspace/workpapers/draft` to keep a working copy: a
 * save's own body, and the intent. */
export function keepRequest(
  scope: Scope,
  source: EditSource,
  editor: SectionEditor,
  draft: Draft,
): Record<string, unknown> {
  return { intent: "keep", ...saveRequest(scope, source, editor, draft) };
}

export function discardRequest(
  scope: Scope,
  source: Pick<EditSource, "workpaperId">,
  editor: Pick<SectionEditor, "key">,
): Record<string, unknown> {
  return {
    intent: "discard",
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    workpaper_id: source.workpaperId,
    section: editor.key,
  };
}

/** The query the page reads its working copies of a workpaper with. */
export function copiesQuery(scope: Scope, workpaperId: string): string {
  return new URLSearchParams({
    organization: scope.organizationId,
    project: scope.projectId,
    workpaper: workpaperId,
  }).toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The API path of a workpaper's working copies, or null when an id is not one. */
export function copiesPath(params: URLSearchParams): string | null {
  const id = (key: string) => {
    const value = params.get(key) ?? "";
    return UUID.test(value) ? value : null;
  };
  const organization = id("organization");
  const project = id("project");
  const paper = id("workpaper");
  return organization === null || project === null || paper === null
    ? null
    : `/organizations/${organization}/projects/${project}/workpapers/${paper}/drafts`;
}

export type CopyWrite =
  | { error: "invalid" }
  | { method: "PUT"; path: string; body: Record<string, unknown> }
  | { method: "DELETE"; path: string };

/**
 * The API call for keeping or discarding a working copy, from what the page posted. A
 * copy is kept under the same checks as a save (three ids, the section's key, the version,
 * a text or rows within the limits, never a credential); discarding takes the ids and the
 * key. Anything else is refused here and never sent.
 */
export function copyWrite(fields: Record<string, unknown>): CopyWrite {
  if (fields.intent === "keep") {
    const { intent: _intent, ...rest } = fields;
    const write = sectionWrite(rest);
    return "error" in write
      ? write
      : { method: "PUT", path: `${write.path}/draft`, body: write.body };
  }
  if (fields.intent === "discard") {
    // The same ids and key, checked by the same reader: a discard carries nothing else.
    const write = sectionWrite({
      organization_id: fields.organization_id,
      project_id: fields.project_id,
      workpaper_id: fields.workpaper_id,
      section: fields.section,
      based_on: 1,
      text: "",
    });
    return "error" in write
      ? write
      : { method: "DELETE", path: `${write.path}/draft` };
  }
  return { error: "invalid" };
}

/* What the bar says ---------------------------------------------------------------------- */

/** Where the working copy of the open editor stands. */
export type Keeping =
  | { state: "none" }
  /** Changed, and waiting for the typing to pause or for the request to answer. */
  | { state: "keeping" }
  | { state: "kept"; at: string }
  /** Not kept: the server could not be reached, or would not take it (its sentence). */
  | { state: "failed"; detail: string }
  /** Keeping is off for this editor: the page could not check for an earlier working copy
   * ("unread"), or found one the editor did not open with and the person has not chosen
   * yet ("found"). Nothing is kept over a copy that may be there. */
  | { state: "off"; why: KeepingOff };

/** Why keeping is off for the open editor (independent review, 15 November 2026). */
export type KeepingOff = "unread" | "found";

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

/** "10:42 AM" for a time today, "14 Nov, 10:42 AM" for another day; "" where it is not
 * a time. In the browser's own time zone. */
export function keptWhen(at: string, now: Date = new Date()): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) {
    return "";
  }
  const when = new Date(time);
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  if (sameDay) {
    return TIME.format(when);
  }
  const [month, day] = DAY.format(when).split(" ");
  return `${day} ${month}, ${TIME.format(when)}`;
}

export const KEEPING = "Keeping your changes…";
export const NOT_IN_WORKPAPER = "Not in the workpaper until you save.";
export const NOT_KEPT =
  "Your changes are not kept yet: the server could not be reached.";
/** The bar, where the page could not check for an earlier working copy. */
export const CANNOT_KEEP =
  "Your changes cannot be kept right now: save them to keep them.";
/** The bar, where an earlier working copy was found after the editor opened. */
export const CHOOSE_FIRST =
  "Your changes are not kept until you choose what to do with the earlier ones.";

/** The bar's line about the working copy; "" where there is nothing to say. Never
 * "saved": a working copy is not the workpaper. */
export function keepingWords(keeping: Keeping, now: Date = new Date()): string {
  if (keeping.state === "keeping") {
    return KEEPING;
  }
  if (keeping.state === "kept") {
    const when = keptWhen(keeping.at, now);
    return `Changes kept${when === "" ? "" : ` at ${when}`}. ${NOT_IN_WORKPAPER}`;
  }
  if (keeping.state === "failed") {
    return keeping.detail === ""
      ? NOT_KEPT
      : `Your changes are not kept: ${keeping.detail}`;
  }
  if (keeping.state === "off") {
    return keeping.why === "unread" ? CANNOT_KEEP : CHOOSE_FIRST;
  }
  return "";
}

/** Why a working copy was not kept, from the route's answer; null for one that was. The
 * server's refusals are final until something changes (a prepared workpaper is not kept
 * again by trying); the rest are tried again. */
export function keepProblem(
  status: number,
  detail: string,
): { detail: string; retry: boolean } | null {
  if (status === 200) {
    return null;
  }
  if (status === 409) {
    const said = detail.trim().replace(/[.\s]+$/, "");
    return {
      detail: said === "" ? "the workpaper cannot be changed now." : `${said}.`,
      retry: false,
    };
  }
  if (status === 401) {
    return {
      detail: "your session has ended. Sign in again in another tab.",
      retry: true,
    };
  }
  if (status === 403 || status === 404 || status === 422) {
    return {
      detail: "this section cannot be edited here any more.",
      retry: false,
    };
  }
  return { detail: "", retry: true };
}

/** Over an editor that opened with a working copy. */
export function restoredWords(
  copy: Pick<WorkingCopy, "updatedAt">,
  now: Date = new Date(),
): string {
  const when = keptWhen(copy.updatedAt, now);
  return when === ""
    ? "Your earlier changes are restored."
    : `Your changes from ${when} are restored.`;
}
/** Over an editor that opened before its working copy was known, when a later read found
 * one: what the person had typed, which they may use or discard. */
export function foundWords(
  copy: Pick<WorkingCopy, "updatedAt">,
  now: Date = new Date(),
): string {
  const when = keptWhen(copy.updatedAt, now);
  return when === ""
    ? "You have earlier changes that were not saved."
    : `You have changes from ${when} that were not saved.`;
}
export const USE_COPY = "Use them";
export const STALE_COPY =
  "This section may have changed since. Saving replaces it with what is here.";
export const DISCARD_COPY = "Discard them";
/** Beside the "Edit" link of a section that has a working copy and no open editor. */
export const HAS_COPY = "Unsaved changes";
export const CONTINUE_EDITING = "Continue editing";

/* Leaving -------------------------------------------------------------------------------- */

/** The dialog that asks before a person goes elsewhere with changes not in the
 * workpaper. */
export const LEAVE = {
  title: (section: string) => `Save your changes to ${section}?`,
  body: "They are kept as your working copy either way, and are here when you come back. Saving adds them to the workpaper as a new version.",
  save: "Save",
  leave: "Leave without saving",
  stay: "Keep editing",
  /** Where the latest changes are not kept (independent review, 15 November 2026). */
  notKept: "Your latest changes are not kept yet.",
  lose: "Leave and lose these changes",
  unreachable: "The server could not be reached.",
  noAnswer: "The server has not answered yet.",
  unread:
    "Your earlier changes could not be checked, so these cannot be kept now.",
  found: "Choose first what to do with your earlier changes.",
} as const;

/** What the leave dialog says, and what its second button reads. */
export type LeaveWords = { body: string; leave: string; lose: boolean };

const sentence = (said: string) => {
  const text = said.trim();
  return text === "" ? "" : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
};

/**
 * The leave dialog's words, from where the working copy stands (independent review, 15
 * November 2026): where everything is kept, or a keep is on its way with nothing wrong, it
 * says they are kept either way and offers "Leave without saving"; where the latest is not
 * kept (the server could not be reached or refused, a limit or a credential, keeping off,
 * or a "Leave without saving" that waited and was not confirmed) it says so plainly, why in
 * one sentence, and offers "Leave and lose these changes".
 */
export function leaveWords(input: {
  keeping: Keeping;
  /** Why the draft cannot be saved or kept as it is (a limit, a credential); "". */
  problem: string;
  /** Something changed is not what the server holds. */
  unkept: boolean;
  /** A "Leave without saving" waited for the keep, and it was not confirmed. */
  waited: boolean;
}): LeaveWords {
  const lose = (reason: string): LeaveWords => ({
    body: reason === "" ? LEAVE.notKept : `${LEAVE.notKept} ${reason}`,
    leave: LEAVE.lose,
    lose: true,
  });
  const { keeping } = input;
  if (!input.unkept) {
    return { body: LEAVE.body, leave: LEAVE.leave, lose: false };
  }
  if (input.problem !== "") {
    return lose(input.problem);
  }
  if (keeping.state === "failed") {
    return lose(
      keeping.detail === "" ? LEAVE.unreachable : sentence(keeping.detail),
    );
  }
  if (keeping.state === "off") {
    return lose(keeping.why === "unread" ? LEAVE.unread : LEAVE.found);
  }
  if (input.waited) {
    return lose(LEAVE.noAnswer);
  }
  return { body: LEAVE.body, leave: LEAVE.leave, lose: false };
}

/* Deciding what to keep (independent review, 15 November 2026) ----------------------------- */

/** Where the read of the working copies stands for the workpaper on the page (they are the
 * person's own, whatever its version): not answered yet, answered, or failed (and no read
 * of them has answered). */
export type CopiesRead = "reading" | "read" | "failed";

/** Beside "Edit" while the read is out: the editor waits for it, so it never opens without
 * an earlier working copy that is there. */
export const CHECKING_COPIES = "Checking for your unsaved changes…";

/** What "Edit" does: waits while the read is out; opens once it answered; opens with
 * keeping off where it failed (editing is never blocked; the read is tried again). */
export function editGate(read: CopiesRead): "wait" | "open" | "unread" {
  if (read === "reading") {
    return "wait";
  }
  return read === "read" ? "open" : "unread";
}

/** What the open editor knows of the server's working copy of its section: "known" where
 * it opened after the read answered (with that copy, or knowing there was none) or the
 * person chose; "unknown" where the read failed (a copy may be there); "found" where a read
 * that answered after it opened found a copy it did not open with. */
export type CopyKnown =
  | { state: "known" }
  | { state: "unknown" }
  | { state: "found"; copy: WorkingCopy };

/** A read of the copies answered while the editor was open. For an editor that knows, the
 * page's own writes are what is known (the read changes nothing for it); for one that does
 * not, a copy of its section is offered (never put in place of what it holds), and none
 * means there is nothing to keep over. */
export function afterRead(
  known: CopyKnown,
  editor: Pick<SectionEditor, "key" | "kind">,
  read: readonly WorkingCopy[],
): CopyKnown {
  if (known.state === "known") {
    return known;
  }
  const copy = copyFor(editor, read);
  return copy === null ? { state: "known" } : { state: "found", copy };
}

/** Keeping is off while the editor does not know what the server holds for it. */
export function keepingOff(known: CopyKnown): KeepingOff | null {
  if (known.state === "unknown") {
    return "unread";
  }
  return known.state === "found" ? "found" : null;
}

/** What a keep is based on: while the editor holds a restored copy, the version that copy
 * was started from (so a copy started on an older version stays said to be one); otherwise
 * the version the editor opened on. A save is always based on the latter. */
export function keepBasis(
  source: EditSource,
  restored: Pick<WorkingCopy, "basedOn"> | null,
): EditSource {
  return restored === null ? source : { ...source, basedOn: restored.basedOn };
}

/** May anything (a keep, or the discard of a copy changed back) be sent for the open editor
 * now: only while it is being edited (never while a save is out, or after one the server
 * confirmed), with keeping on, and not after the server refused in its own words. */
export function mayKeep(
  open: { phase: "editing" | "saving" | "refreshing"; off: KeepingOff | null },
  flags: { blocked: boolean; saved: boolean },
): boolean {
  return (
    open.phase === "editing" &&
    open.off === null &&
    !flags.blocked &&
    !flags.saved
  );
}

/** How many keeps were sent, and how many have answered. */
export type KeepCount = { sent: number; answered: number };

/** A save the server confirmed deletes the working copy; a keep that was out when the save
 * was sent, or sent after it, may have landed after it and made the copy again: the copy is
 * then discarded, after it. */
export function copyMayOutliveSave(atSave: KeepCount, now: KeepCount): boolean {
  return atSave.answered < atSave.sent || now.sent > atSave.sent;
}

/** A keep with `keepalive` is not sent by the browser over about 64 KB: a body over this is
 * kept as the tab is hidden instead, and is not kept until the server answered. */
export const KEEPALIVE_MAX_BYTES = 60_000;

/** The size of a body as it is sent. */
export function bodyBytes(body: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/**
 * What is sent as the page goes, or the editor goes with it, for the latest that is not
 * kept: "keepalive" as the page is hidden for good (pagehide), for a body the browser will
 * send so; "queue" (a keep in the page's own queue, kept only once the server answered) when
 * the tab is hidden with a body too large for keepalive, or the editor went without being
 * asked (the Back button); "none" otherwise: nothing may be kept, nothing is unkept, what
 * would be sent is not a keep, it went already, or it is on its way.
 */
export function goingKeep(input: {
  when: "pagehide" | "hidden" | "unmount";
  may: boolean;
  unkept: boolean;
  action: "keep" | "discard" | "none";
  key: string;
  beaconed: string | null;
  sending: string | null;
  bytes: number;
}): "keepalive" | "queue" | "none" {
  if (
    !input.may ||
    !input.unkept ||
    input.action !== "keep" ||
    input.key === input.beaconed
  ) {
    return "none";
  }
  const large = input.bytes > KEEPALIVE_MAX_BYTES;
  if (input.when === "pagehide") {
    return large ? "none" : "keepalive";
  }
  if (input.key === input.sending) {
    return "none";
  }
  if (input.when === "hidden") {
    return large ? "queue" : "none";
  }
  return "queue";
}

/** A working copy discarded by any way (Discard them, Cancel, a change back to what is
 * stored, a save): the editor no longer says it was restored. */
export function dropRestored<
  T extends { editor: { key: string }; restored: WorkingCopy | null },
>(open: T | null, section: string): T | null {
  return open === null || open.restored === null || open.editor.key !== section
    ? open
    : { ...open, restored: null };
}
