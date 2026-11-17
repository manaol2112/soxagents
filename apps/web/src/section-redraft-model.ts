/**
 * Redrafting a section a person has edited (docs/design-workpaper.md, section 3.11;
 * product owner, 16 November 2026: "Okay build it after the reorder", over the prototype
 * brief-proto/redraft.png). The editor of a text section the agent drafts offers
 * "Redraft with the agent": one agent run drafts that one section and proposes it beside
 * the person's text. The proposal is the agent's, never a person's: nothing reaches the
 * workpaper until the person chooses "Use the draft" (the editor then holds it, unsaved,
 * kept as a working copy) and presses Save, which is a person's save that names the
 * proposal.
 *
 * Pure: the proposal's strict reading, which sections offer the redraft, the requests and
 * the paths the page's routes validate, the polling plan (and which answers are too old to
 * use), the folded view's first paragraphs, the words, and the refusals. The server
 * decides who may ask, what the agent is given, and what a save takes.
 */

import type { Citation } from "./console-model.ts";
import {
  docFromText,
  parseRich,
  richToText,
  textFromDoc,
} from "./rich-text-model.ts";
import { parseCitations, type WorkpaperSection } from "./workpaper-model.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECTION_KEY = /^[a-z0-9-]{1,60}$/;

/* The proposal --------------------------------------------------------------------------- */

export type ProposalStatus = "PENDING" | "READY" | "FAILED";

/** The agent's proposal for one section, as the server answers it: the caller's own. */
export type Proposal = {
  id: string;
  sectionKey: string;
  /** The workpaper version it was drafted from. */
  basedOn: number;
  status: ProposalStatus;
  /** The proposed text, marks included; "" unless READY. */
  text: string;
  /** Its checked sources, as a text section's are. */
  citations: Citation[];
  words: number;
  requestedAt: string;
  readyAt: string | null;
  /** Why the run gave no draft, in one plain sentence; "" unless FAILED. */
  failure: string;
  /** The sentence of section 3.10 where a quotation was removed from the draft; "". */
  removedNote: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTime = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));

/**
 * A proposal read strictly: every field of its shape and type, or null. A text is shown
 * only for a READY one (a READY one with no text is not one), a failure only for a FAILED
 * one. Its citations are read as a text section's are.
 */
export function parseProposal(value: unknown): Proposal | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    section_key: sectionKey,
    based_on: basedOn,
    status,
    text,
    citations,
    words,
    requested_at: requestedAt,
    ready_at: readyAt,
    failure,
    removed_note: removedNote,
  } = value;
  if (
    typeof id !== "string" ||
    !UUID.test(id) ||
    typeof sectionKey !== "string" ||
    !SECTION_KEY.test(sectionKey) ||
    typeof basedOn !== "number" ||
    !Number.isInteger(basedOn) ||
    basedOn < 1 ||
    (status !== "PENDING" && status !== "READY" && status !== "FAILED") ||
    typeof text !== "string" ||
    !Array.isArray(citations) ||
    typeof words !== "number" ||
    !Number.isInteger(words) ||
    words < 0 ||
    !isTime(requestedAt) ||
    !(readyAt === null || isTime(readyAt)) ||
    typeof failure !== "string" ||
    typeof removedNote !== "string"
  ) {
    return null;
  }
  if (status === "READY" && text.trim() === "") {
    return null;
  }
  return {
    id,
    sectionKey,
    basedOn,
    status,
    text: status === "READY" ? text : "",
    citations: status === "READY" ? parseCitations(citations) : [],
    words: status === "READY" ? words : 0,
    requestedAt,
    readyAt,
    failure: status === "FAILED" ? failure.trim() : "",
    removedNote: status === "READY" ? removedNote.trim() : "",
  };
}

/** The route's answer of a read or a write: its status, the server's sentence for a
 * refusal, and the proposal it holds (null where none stands, or it could not be read). */
export type ProposalAnswer = {
  status: number;
  detail: string;
  proposal: Proposal | null;
};

/** The page's route's answer, read: a 200 whose proposal is there but not of its shape is
 * not taken (status 0: nothing is shown as the agent's that could not be read). */
export function parseProposalAnswer(value: unknown): ProposalAnswer {
  if (!isRecord(value)) {
    return { status: 0, detail: "", proposal: null };
  }
  const status = typeof value.status === "number" ? value.status : 0;
  const detail = typeof value.detail === "string" ? value.detail : "";
  if (
    status !== 200 ||
    value.proposal === null ||
    value.proposal === undefined
  ) {
    return { status, detail, proposal: null };
  }
  const proposal = parseProposal(value.proposal);
  return proposal === null
    ? { status: 0, detail: "", proposal: null }
    : { status, detail, proposal };
}

/** The proposal of an answer, where it is the section's: one of another section is none
 * of the editor's. */
export function proposalOf(
  answer: ProposalAnswer,
  sectionKey: string,
): Proposal | null {
  return answer.proposal !== null && answer.proposal.sectionKey === sectionKey
    ? answer.proposal
    : null;
}

/* Which sections offer it ---------------------------------------------------------------- */

/**
 * Whether the editor of a stored section offers "Redraft with the agent": a text section
 * the agent drafts, whoever wrote it last (workpaper_service.drafted_by_agent without its
 * source): a narrative, and never an effectiveness conclusion, which is derived from the
 * signed-off testing. The workpaper's own state (a draft, not being drafted, editable by
 * this person) is the editor's rule, which already holds where an editor is open.
 */
export function redraftable(
  section: Pick<WorkpaperSection, "kind" | "narrative" | "key"> | undefined,
  stage: "DESIGN" | "EFFECTIVENESS",
): boolean {
  return (
    section !== undefined &&
    section.kind === "text" &&
    section.narrative === true &&
    !(stage === "EFFECTIVENESS" && section.key.includes("conclusion"))
  );
}

/* The calls ------------------------------------------------------------------------------ */

type Scope = { organizationId: string; projectId: string };

/** Where a proposal is asked for, read and ended: the workpaper and its section. */
export type ProposalPlace = {
  workpaperId: string;
  sectionKey: string;
};

/** The body the page posts to `/workspace/workpapers/redraft`. */
export function redraftRequest(
  scope: Scope,
  place: ProposalPlace,
  workpaperVersion: number,
): Record<string, unknown> {
  return {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    workpaper_id: place.workpaperId,
    section: place.sectionKey,
    workpaper_version: workpaperVersion,
  };
}

/** The query the page reads its proposal with, from `/workspace/workpapers/proposal`. */
export function proposalQuery(scope: Scope, place: ProposalPlace): string {
  return new URLSearchParams({
    organization: scope.organizationId,
    project: scope.projectId,
    workpaper: place.workpaperId,
    section: place.sectionKey,
  }).toString();
}

/** The body the page posts to `/workspace/workpapers/keep-mine`. */
export function keepMineRequest(
  scope: Scope,
  place: ProposalPlace,
  proposalId: string,
): Record<string, unknown> {
  return {
    organization_id: scope.organizationId,
    project_id: scope.projectId,
    workpaper_id: place.workpaperId,
    section: place.sectionKey,
    proposal_id: proposalId,
  };
}

/** A save's body, naming the agent's draft the editor holds where it holds one: the
 * server then notes the version as from that draft and ends the proposal USED. */
export function withProposal(
  body: Record<string, unknown>,
  used: { id: string } | null,
): Record<string, unknown> {
  return used === null ? body : { ...body, proposal_id: used.id };
}

/* The route's side ---------------------------------------------------------------------- */

const sectionPath = (
  organization: unknown,
  project: unknown,
  paper: unknown,
  key: unknown,
): string | null =>
  typeof organization === "string" &&
  UUID.test(organization) &&
  typeof project === "string" &&
  UUID.test(project) &&
  typeof paper === "string" &&
  UUID.test(paper) &&
  typeof key === "string" &&
  SECTION_KEY.test(key)
    ? `/organizations/${organization}/projects/${project}/workpapers/${paper}/sections/${key}`
    : null;

export type ProposalWrite =
  | { error: "invalid" }
  | { path: string; body: Record<string, unknown> };

/** The API call that asks for a redraft: three ids, the section's key and the workpaper's
 * current version the editor shows. Anything else is refused here and never sent. */
export function redraftWrite(fields: Record<string, unknown>): ProposalWrite {
  const path = sectionPath(
    fields.organization_id,
    fields.project_id,
    fields.workpaper_id,
    fields.section,
  );
  const version = fields.workpaper_version;
  if (
    path === null ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { error: "invalid" };
  }
  return { path: `${path}/redraft`, body: { workpaper_version: version } };
}

/** The API path of the caller's proposal for a section, or null where an id or the key
 * is not one. */
export function proposalPath(params: URLSearchParams): string | null {
  const path = sectionPath(
    params.get("organization"),
    params.get("project"),
    params.get("workpaper"),
    params.get("section"),
  );
  return path === null ? null : `${path}/proposal`;
}

/** The API call that ends a proposal as "Keep mine": the ids, the key and the proposal's
 * own id; its body is empty. */
export function keepMineWrite(fields: Record<string, unknown>): ProposalWrite {
  const path = sectionPath(
    fields.organization_id,
    fields.project_id,
    fields.workpaper_id,
    fields.section,
  );
  const id = fields.proposal_id;
  if (path === null || typeof id !== "string" || !UUID.test(id)) {
    return { error: "invalid" };
  }
  return { path: `${path}/proposal/${id}/keep-mine`, body: {} };
}

/** The proposal a save names, as the section route takes it: absent or null for none, or
 * the proposal's id; anything else is not a save the route sends. */
export function proposalIdOf(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "string" && UUID.test(value) ? value : "invalid";
}

/* Polling -------------------------------------------------------------------------------- */

/** How often a drafting proposal is read again. */
export const POLL_MS = 3_000;

/** When the proposal is read next: in POLL_MS while it drafts; never once it is ready,
 * has failed, or there is none (and the editor's going stops it too). */
export function pollDelay(proposal: Proposal | null): number | null {
  return proposal !== null && proposal.status === "PENDING" ? POLL_MS : null;
}

/**
 * The requests of one editor, numbered in the order they were sent, so an answer that
 * comes back after a later one is not used: a read sent before a redraft or a "Keep mine"
 * never puts back the proposal those ended. `writing` is the write that is out, if one
 * is: no read is sent while it is, and a read that was out when it went is not used.
 */
export type Sequence = {
  sent: number;
  applied: number;
  writing: number | null;
};

export const SEQUENCE: Sequence = { sent: 0, applied: 0, writing: null };

/** A request goes: its number, and the sequence with it. */
export function sent(
  sequence: Sequence,
  kind: "read" | "write",
): { sequence: Sequence; number: number } {
  const number = sequence.sent + 1;
  return {
    number,
    sequence: {
      ...sequence,
      sent: number,
      writing: kind === "write" ? number : sequence.writing,
    },
  };
}

/** An answer came back: whether it is used (nothing later answered first, and for a read,
 * no write is out), and the sequence after it. A write's answer, used or not, ends that
 * write. */
export function answered(
  sequence: Sequence,
  number: number,
  kind: "read" | "write",
): { sequence: Sequence; use: boolean } {
  const writing =
    kind === "write" && sequence.writing === number ? null : sequence.writing;
  const use =
    number > sequence.applied &&
    (kind === "write" || sequence.writing === null);
  return {
    use,
    sequence: {
      ...sequence,
      writing,
      applied: use ? number : sequence.applied,
    },
  };
}

/** Whether a read may be sent now: never while a write is out. */
export const mayRead = (sequence: Sequence): boolean =>
  sequence.writing === null;

/* What the card shows -------------------------------------------------------------------- */

/** How many of the draft's paragraphs (or lists) the card shows before "Show all". */
export const FOLDED_BLOCKS = 2;

/** The first paragraphs of the draft, as stored text, and whether there is more. Read by
 * the formatting grammar (section 3.3): a list is one block, as a paragraph is. */
export function folded(
  text: string,
  blocks: number = FOLDED_BLOCKS,
): { head: string; more: boolean } {
  const all = parseRich(text);
  return all.length <= blocks
    ? { head: text, more: false }
    : { head: richToText(all.slice(0, blocks)), more: true };
}

const CITED = /\[\^(\d{1,2})\]/g;

/** The citations a text carries a mark of ("[^2]"), in their order: the folded view lists
 * the sources of what it shows. */
export function citedIn(
  text: string,
  citations: readonly Citation[],
): Citation[] {
  const numbers = new Set(
    [...text.matchAll(CITED)].map((match) => Number(match[1])),
  );
  return citations.filter((citation) => numbers.has(citation.number));
}

export const PROPOSAL_TITLE = "The agent's draft";

/** "from the confirmed understanding and the evidence · 412 words". */
export function proposalMeta(proposal: Pick<Proposal, "words">): string {
  const words =
    proposal.words === 1
      ? "1 word"
      : `${proposal.words.toLocaleString("en-US")} words`;
  return `from the confirmed understanding and the evidence · ${words}`;
}

export const REDRAFT = "Redraft with the agent";
export const DRAFTING = "Drafting…";
export const USE_DRAFT = "Use the draft";
export const KEEP_MINE = "Keep mine";
export const TRY_AGAIN = "Try again";
export const SHOW_ALL = "Show all";
export const SHOW_LESS = "Show less";
/** Where the editor holds the agent's draft: it is not in the workpaper yet. */
export const IN_EDITOR =
  "The agent's draft is in the editor. It is not in the workpaper until you save.";
/** Why "Redraft with the agent" is off while the editor holds a draft not saved yet: a new
 * request would end the one the editor's text came from. */
export const SAVE_FIRST =
  "The agent's draft is in the editor: save or cancel before asking again.";

/** What a screen reader hears as the proposal changes: drafting (asked, or PENDING), then
 * ready or the failure; "" where none stands. */
export function proposalAnnouncement(
  proposal: Pick<Proposal, "status" | "failure"> | null,
  asking = false,
): string {
  if (asking || proposal?.status === "PENDING") {
    return "Drafting… The agent is drafting this section.";
  }
  if (proposal === null) {
    return "";
  }
  return proposal.status === "READY"
    ? "The agent's draft is ready."
    : failureLine(proposal);
}

/** A failed run's one line: the server's sentence, or the page's where it sent none. */
export function failureLine(proposal: Pick<Proposal, "failure">): string {
  return proposal.failure !== ""
    ? proposal.failure
    : "The agent could not draft this section.";
}

/**
 * Why a redraft, a read or a "Keep mine" was not taken, in one sentence; "" where it was.
 * The server's own sentence where it gave one for a refusal it words (403, 404, 409);
 * the page's otherwise.
 */
export function redraftProblem(status: number, detail: string): string {
  if (status === 200) {
    return "";
  }
  const said = detail.trim();
  if ((status === 403 || status === 404 || status === 409) && said !== "") {
    return said;
  }
  if (status === 401) {
    return "Your session has ended. Sign in again in another tab, then try again.";
  }
  if (status === 403) {
    return "You may not edit this workpaper.";
  }
  if (status === 404) {
    return "This workpaper is no longer here.";
  }
  if (status === 409) {
    return "The workpaper cannot be redrafted now.";
  }
  if (status === 422) {
    return "The server did not take this request. Try again.";
  }
  return "The server could not be reached. Try again.";
}

/** A save refused because the proposal it named is no longer the caller's standing,
 * ready one ("The agent's draft changed; read it again."). */
export function draftChanged(status: number, detail: string): boolean {
  return status === 409 && /\bagent's draft\b/i.test(detail);
}

/* Using the draft ------------------------------------------------------------------------ */

/** The draft's text as the editor writes it back (section 3.3), so what is kept and saved
 * after "Use the draft" is the editor's own text, and its formatting reads the same. */
export function editorText(text: string): string {
  return textFromDoc(docFromText(text));
}

/** The agent's draft the editor holds: which proposal, what it put there, and what the
 * editor held before. `off` while the editor's text is back to what it held before (undo):
 * a save then does not name the proposal. */
export type UsedDraft = {
  id: string;
  /** The text "Use the draft" put in the editor (editorText of the proposal's). */
  text: string;
  /** What the editor held just before. */
  before: string;
  /** When the agent drafted it (the proposal's ready time, else its request's). */
  at: string;
  off: boolean;
};

/** "Use the draft": what the editor now holds, and what it remembers of it. */
export function draftUsed(
  proposal: Pick<Proposal, "id" | "text" | "readyAt" | "requestedAt">,
  before: string,
): UsedDraft {
  return {
    id: proposal.id,
    text: editorText(proposal.text),
    before,
    at: proposal.readyAt ?? proposal.requestedAt,
    off: false,
  };
}

/**
 * What the editor remembers of the agent's draft after a change: back to the text it held
 * before (an undo) and a save no longer names it; back to the draft (a redo) and it does
 * again; any other change keeps what it was (an edit after "Use the draft" is still from
 * the draft; typing after an undo is the person's own).
 */
export function usedAfter<Used extends UsedDraft>(
  used: Used | null,
  text: string,
): Used | null {
  if (used === null) {
    return null;
  }
  const now = editorText(text);
  if (now === editorText(used.before)) {
    return used.off ? used : { ...used, off: true };
  }
  if (now === used.text) {
    return used.off ? { ...used, off: false } : used;
  }
  return used;
}

/** The draft a save names: the one the editor holds, unless it is back to the person's. */
export const namedDraft = (used: UsedDraft | null): { id: string } | null =>
  used === null || used.off ? null : { id: used.id };
